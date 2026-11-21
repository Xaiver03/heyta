/**
 * 飞书网页应用登录的 HTTP 入口（`/api/auth/feishu/*`）。
 * ======================================================
 *
 * 三条路由，两条挂载点共用同一套实现（靠 `scope` 区分 `app` / `admin`）：
 *   - `GET /auth/feishu/status`   这台实例配好没有（宿主据此决定显示不显示入口）。
 *   - `GET /auth/feishu/start`    种一次性 state cookie 后 302 到飞书授权页。
 *   - `GET /auth/feishu/callback` 校验 state、换令牌、落地账号，最后 302 回产物页。
 *
 * ## 为什么是**顶层 GET 跳转**，不是 fetch
 *
 * 飞书授权与回调都是浏览器顶层导航（跨站 GET），fetch 做不到也拿不到 Cookie 语义。
 * 所以前端只做"跳过去"，回程由服务端把**会话**投进产物页的 URL `fragment`：
 * `#sessionToken=<JWT>&loginBaseUrl=<origin>&loginEmail=<email>`。
 *
 * 🔴 fragment（`#` 之后）**不会发给服务器、不进 Referer、不进任何访问日志**，
 * 而且跨 agent cluster 一定跟得过来 —— 这正是本仓库既有的两条投递通道
 *（邮件确认页 / 桌面壳回跳，见 `apps/web/src/features/auth/pending-login.ts`）用的同一形状。
 * 前端读完**立刻** `history.replaceState` 抹掉（`takePendingSessionFromFragment` 已实现）。
 *
 * ## 防 CSRF 两道（缺一不可）
 *
 *   ① 一次性 state（HMAC 签名 + 10 分钟过期，见 `feishu-state.ts`）；
 *   ② 与本浏览器绑定的 HttpOnly `heyta_feishu_state` cookie（/start 种下、/callback 要求相等、用完即清）。
 * 只校验 state 字符串而不绑定浏览器，会被「回调 URL 转发」攻击登录成别人的账号。
 *
 * ## 安全边界
 *
 *   - 回跳路径只接受站内绝对路径（`sanitizeLanding`）。
 *   - 上游错误码与自由文本**不回显**：只回传 `FEISHU_AUTH_ERROR_CODES` 里的固定枚举。
 *   - 管理面绝不自动建号、绝不提权（见 `feishu-auth-service.ts` 的归属规则）。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FEISHU_AUTH_PATHS, type FeishuAuthErrorCode, type FeishuAuthScope } from '@heyta/shared-schema';

import { prisma } from '../db';
import { Logger } from '../logger';
import { getJwtSecret, issueSession } from '../auth';
import { sessionMetaFromRequest } from '../account/access-sessions';
import { loadFeishuLoginConfig } from './feishu-config';
import { buildAuthorizeUrl, exchangeCode, fetchUserInfo, FeishuOAuthError } from './feishu-oauth-client';
import { resolveFeishuLogin } from './feishu-auth-service';
import { createFeishuPrismaRepository, digestOpenId } from './feishu-prisma-repository';
import {
  createState,
  readCookie,
  sanitizeLanding,
  secureCookies,
  serializeCookie,
  verifyState,
} from './feishu-state';

export interface FeishuRoutesOptions {
  /** 对外可达的站点 origin（`PUBLIC_URL`）。 */
  readonly publicUrl: string;
  /** 共享 UI 的挂载路径（如 `/app/`）；普通面成功/失败都回到它。 */
  readonly webAppPath: string;
}

const STATE_COOKIE = 'heyta_feishu_state';
const STATE_COOKIE_MAX_AGE = 600;

function landingFor(scope: FeishuAuthScope, webAppPath: string): string {
  if (scope === 'admin') return '/admin';
  const path = (webAppPath || '').trim();
  return path.startsWith('/') && path !== '' ? path : '/';
}

function scopeFromQuery(raw: unknown): FeishuAuthScope {
  return raw === 'admin' ? 'admin' : 'app';
}

function withErrorParam(origin: string, landing: string, code: FeishuAuthErrorCode): string {
  try {
    const url = new URL(landing.startsWith('/') ? landing : '/', origin);
    url.searchParams.set('feishu_error', code);
    return url.toString();
  } catch {
    return `${origin}${landing}?feishu_error=${code}`;
  }
}

function withSessionFragment(origin: string, landing: string, jwt: string, email: string): string {
  const base = `${origin}${landing.startsWith('/') ? landing : '/'}`;
  const hash =
    `sessionToken=${encodeURIComponent(jwt)}` +
    `&loginBaseUrl=${encodeURIComponent(origin)}` +
    `&loginEmail=${encodeURIComponent(email)}`;
  return `${base}#${hash}`;
}

function cookieHeader(value: string, origin: string): string {
  return serializeCookie(STATE_COOKIE, value, {
    maxAgeSeconds: STATE_COOKIE_MAX_AGE,
    secure: secureCookies(origin),
  });
}

function clearedCookieHeader(origin: string): string {
  return serializeCookie(STATE_COOKIE, '', { maxAgeSeconds: 0, secure: secureCookies(origin) });
}

export async function feishuRoutes(fastify: FastifyInstance, opts: FeishuRoutesOptions): Promise<void> {
  const { publicUrl, webAppPath } = opts;

  // 每次按环境重读配置：改了环境变量重启即生效，不需要把配置存成模块级单例。
  const config = () => loadFeishuLoginConfig(publicUrl);

  fastify.get(FEISHU_AUTH_PATHS.status, { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (_req, reply) => {
    return reply.send({ enabled: config() !== null });
  });

  fastify.get(
    FEISHU_AUTH_PATHS.start,
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as Record<string, unknown>;
      const scope = scopeFromQuery(query.scope);
      const landing = sanitizeLanding(query.redirect, landingFor(scope, webAppPath));

      const cfg = config();
      if (cfg === null) {
        return reply.code(503).send({ code: 'not_configured', message: 'Feishu login is not configured.' });
      }

      const secret = getJwtSecret();
      const { state, nonce } = createState({ scope, redirectPath: landing }, secret);
      let authorizeUrl: string;
      try {
        authorizeUrl = buildAuthorizeUrl(cfg, { redirectUri: cfg.redirectUri, state, scope: cfg.scope });
      } catch (error) {
        Logger.error(`[feishu-login] 生成授权地址失败: ${error instanceof Error ? error.message : String(error)}`);
        return reply.code(503).send({ code: 'not_configured', message: 'Feishu login is not configured.' });
      }
      reply.header('Set-Cookie', cookieHeader(nonce, cfg.origin));
      return reply.code(302).header('Location', authorizeUrl).send();
    },
  );

  fastify.get(
    FEISHU_AUTH_PATHS.callback,
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as Record<string, unknown>;
      const rawState = String(query.state ?? '');
      const cfg = config();

      // 先确定 landing：配置存在时用 state 验出来的；配置缺失时只能回默认 app 页。
      const fallbackLanding = landingFor('app', webAppPath);
      const fail = (code: FeishuAuthErrorCode, landing: string = fallbackLanding) => {
        const origin = cfg?.origin ?? publicUrl;
        if (cfg) reply.header('Set-Cookie', clearedCookieHeader(origin));
        return reply.code(302).header('Location', withErrorParam(origin, landing, code)).send();
      };

      if (cfg === null) return fail('not_configured');

      // ① 浏览器绑定：cookie 里的 nonce 必须存在，且与 state 里的 nonce 相等。
      const cookieNonce = readCookie(req.headers.cookie, STATE_COOKIE);
      const payload = verifyState(rawState, getJwtSecret());
      if (payload === null || cookieNonce === null || cookieNonce !== payload.nonce) {
        return fail('invalid_state', landingFor('app', webAppPath));
      }
      const landing = sanitizeLanding(payload.redirectPath, landingFor(payload.scope, webAppPath));

      if (query.error) return fail('access_denied', landing);
      const code = String(query.code ?? '');
      if (!code) return fail('missing_code', landing);

      // ② 换令牌 + 取用户信息。
      let profile;
      try {
        const token = await exchangeCode({ config: cfg, code, redirectUri: cfg.redirectUri });
        profile = await fetchUserInfo({ accessToken: token.accessToken, config: cfg });
      } catch (error) {
        const detail = error instanceof FeishuOAuthError && error.code !== null ? `code=${error.code}` : '';
        Logger.error(`[feishu-login] 换取用户信息失败: ${detail} ${error instanceof Error ? error.message : String(error)}`);
        return fail('auth_failed', landing);
      }

      // ③ 落地成账号。
      let outcome;
      try {
        outcome = await resolveFeishuLogin({
          profile,
          scope: payload.scope,
          repo: createFeishuPrismaRepository(),
          policy: {
            adminOpenIds: cfg.adminOpenIds,
            tenantKey: cfg.tenantKey,
            autoProvision: cfg.autoProvision,
          },
          digest: digestOpenId,
        });
      } catch (error) {
        Logger.error(`[feishu-login] 账号落地失败: ${error instanceof Error ? error.message : String(error)}`);
        return fail('login_failed', landing);
      }
      if (!outcome.ok) return fail(outcome.code, landing);

      // ④ 签发会话并投递到产物页 fragment。
      try {
        const jwt = await issueSession({ id: outcome.userId }, sessionMetaFromRequest(req));
        const user = await prisma.user.findUnique({ where: { id: outcome.userId }, select: { email: true } });
        const email = user?.email ?? '';
        reply.header('Set-Cookie', clearedCookieHeader(cfg.origin));
        Logger.info(`[feishu-login] 登录成功 (scope=${payload.scope}, created=${outcome.created})`);
        return reply.code(302).header('Location', withSessionFragment(cfg.origin, landing, jwt, email)).send();
      } catch (error) {
        Logger.error(`[feishu-login] 签发会话失败: ${error instanceof Error ? error.message : String(error)}`);
        return fail('login_failed', landing);
      }
    },
  );
}
