import * as fs from 'fs';
import * as path from 'path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { Logger } from './logger';

/**
 * 在服务端进程里服务共享 UI（`apps/web` 的生产产物）。
 * ==========================================
 *
 * ## 这一份存在的理由
 *
 * 自托管的配置文件早就齐了（compose、Caddyfile、env.example、helm、迁移脚本），
 * 但里面**没有一个是客户端**：`server/Caddyfile` 只 `reverse_proxy supersync:1900`，
 * `server/public/` 只有凭据页。结果是外人把整套跑起来之后手上是一个**没有界面的 API** ——
 * 这是"能不能自托管"这条路的主要长度来源，也是业界六个同类项目里五个把前端
 * bake 进服务端镜像的原因（证据与出处见 `docs/research/self-host-distribution-audit.md` §2.2、§4）。
 *
 * ## 为什么开关是"目录在不在"而不是 `*_ENABLED`
 *
 * 布尔开着而目录不存在时，服务照常起、`/health` 200、`/app/` 404 ——
 * 与"界面对用户说谎"是本仓库反复出事的同一类。所以这里由**产物本身的存在**决定挂不挂，
 * 而两种状态都必须在启动日志里看得见（那条日志是 `info` 不是 `debug`，
 * debug 级的"没有界面"等于没有说）。
 *
 * ## 挂载路径要与产物对上
 *
 * 产物是 `HEYTA_WEB_BASE=/app/ vite build` 打的，挂在别的前缀下样式与 worker 会拿到 HTML。
 * 这件事**不在运行时猜**：`scripts/check-web-artifact.mjs` 在构建期反推产物声明的挂载路径并核对
 * （镜像构建里跑，红则打不出包）。
 */

/** 一台实例上共享 UI 的位置。 */
export interface WebAppMount {
  /** 产物目录（绝对路径）。 */
  dir: string;
  /** 对外挂载路径，首尾都带斜杠。 */
  prefix: string;
}

/**
 * 不许占用的顶层前缀。
 *
 * 🔴 这不是防御性的清单，每一条都有东西会被它顶掉：
 * `/api`、`/health`、`/live` 是路由本身；`/` 会把凭据页与法务页整个盖住
 * （`public/` 用 prefix `/` 注册，同前缀再注册一次是重复路由）。
 */
const RESERVED_FIRST_SEGMENTS = new Set(['api', 'health', 'live', 'ws', '']);

/**
 * 共享 UI 自己的 CSP。
 *
 * 不复用 `SERVER_HELMET_CONFIG` 那份，因为那一份是为**凭据页**写的，而它会把应用打死：
 *
 * - 没有 `'wasm-unsafe-eval'` ⇒ **WebAssembly 直接不执行**，而 SQLite 存储就是一个 wasm
 *   （`@sqlite.org/sqlite-wasm`）。症状是"应用能开，但存储起不来"。
 * - `worker-src` 只能跟着 `default-src 'self'` ⇒ Vite 用 `new URL(…, import.meta.url)`
 *   + blob 方式起的 module worker 会被拦。
 * - `img-src`/`connect-src` 不放 `blob:` ⇒ 导出下载（`URL.createObjectURL`）失败。
 *
 * `style-src 'unsafe-inline'` 保留：React Native Web 注入内联样式，去掉它整页无样式。
 * ⚠️ 这三条不是推理，是 §6.2 规定一的真浏览器实测对象 —— 改这份 CSP 之前先看
 * `server/tests/web-app-serving.spec.ts` 里那几条判据，再自己起一次浏览器。
 */
export const WEB_APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * 决定这台实例要不要服务共享 UI。
 *
 * @returns 挂载信息；目录或 `index.html` 不存在时 `null`（= 这台实例只有 API）。
 */
export const resolveWebAppMount = (config: {
  webAppDir: string;
  webAppPath: string;
}): WebAppMount | null => {
  const dir = config.webAppDir.trim();
  const prefix = config.webAppPath.trim();

  if (dir === '') {
    Logger.info('[web-app] WEB_APP_DIR 为空 —— 这台实例不服务共享 UI，只提供 API。');
    return null;
  }

  const firstSegment = prefix.split('/').filter(Boolean)[0] ?? '';
  if (RESERVED_FIRST_SEGMENTS.has(firstSegment)) {
    // 🔴 报错而不是"退到别的前缀"：静默换一个挂载路径会得到一个
    // "服务起来了、链接全 404、而没人知道链接是从哪儿来的"的实例。
    throw new Error(
      `WEB_APP_PATH=${JSON.stringify(prefix)} 与保留路径冲突（/api、/health、/live、/ws 与站点根）。` +
        ' 共享 UI 要挂在一个独立的前缀下，例如 /app/。',
    );
  }

  const indexPath = path.join(dir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    Logger.info(
      `[web-app] ${dir} 下没有 index.html —— 这台实例只有 API，没有共享 UI。` +
        ' 要带上界面：用带 web 阶段构建的镜像，或把 HEYTA_WEB_BASE 对应前缀的产物放进这里。',
    );
    return null;
  }

  return { dir, prefix };
};

/**
 * 把共享 UI 挂上去。
 *
 * 全程在一个 **encapsulated scope** 里做，两个理由：
 *
 * 1. CSP 只该改给 `/app/*` 的响应，凭据页与法务页继续用全局那份（它们不需要 wasm，
 *    多给一档权限就是白给）。
 * 2. SPA 兜底（未知路径回 index.html）只在该前缀内成立。挂在全局会让
 *    `/api/nope` 这类拼错的请求也拿到一个 200 的 HTML —— 那是最难归因的一种假象：
 *    客户端看到 200 + HTML，报出来的却是 MIME 错误。
 */
export const registerWebApp = async (
  server: FastifyInstance,
  mount: WebAppMount | null,
): Promise<void> => {
  if (mount === null) return;

  await server.register(
    async (scope) => {
      scope.addHook('onSend', async (_request, reply, payload) => {
        reply.header('content-security-policy', WEB_APP_CSP);
        // HTML 入口不许被缓存住：应用一变，`index.html` 引用的资源哈希就全变了，
        // 拿着一份旧的入口等于拿着一串取不到的哈希。
        // ⚠️ 这条必须写在 `onSend` 里而不是兜底 handler 里 —— 实测 `reply.sendFile()`
        // 会自己盖一个 `cache-control: public, max-age=0`，handler 里设的先就被盖掉了
        // （判据 `web-app-serving.spec.ts` 就是在这里变红的，不是为了让它变绿才这么写）。
        // 只改 HTML：`/app/assets/*-<hash>.js` 那些是内容寻址的，缓存越久越好。
        if (String(reply.getHeader('content-type') ?? '').includes('text/html')) {
          reply.header('cache-control', 'no-cache');
        }
        return payload;
      });

      // 前缀由下面的 `register(..., { prefix })` 给，这里必须用 `/`：
      // 两处都写会拼成 `/app/app/`（Fastify 的封装前缀是**叠加**的）。
      await scope.register(fastifyStatic, {
        root: mount.dir,
        prefix: '/',
        index: ['index.html'],
      });

      // SPA 兜底：前缀内的未知路径回 index.html（应用自己按 hash/路由再分）。
      scope.setNotFoundHandler(async (request, reply) => {
        if (request.method !== 'GET' || !request.url.startsWith(mount.prefix)) {
          return reply.code(404).send({ error: 'Not Found' });
        }
        // 缓存口径由上面那个 onSend 统一管（HTML 一律 no-cache），这里不再设第二遍。
        return reply.sendFile('index.html');
      });
    },
    { prefix: mount.prefix },
  );

  Logger.info(`[web-app] 共享 UI 挂在 ${mount.prefix}（来自 ${mount.dir}）`);
};
