/**
 * 账号安全面（换绑登录邮箱 + 登录会话）的 HTTP 路由。工单 W1 / W2 / W3。
 *
 * 裁决在 [ADR-0063](../../../docs/adr/0063-email-rebinding-and-per-session-revocation.md)。
 *
 * ## 为什么这是一枚单独的文件，而不是 `api.ts` 里再插两段
 *
 * 与 `account-profile.routes.ts`（R10）同一个理由：**路径只有一个来源**。
 * 服务端注册的字符串与客户端请求的字符串都从 `@heyta/shared-schema` 的那两枚常量取，
 * 而契约与实现漂移的症状是 404，不是报错。
 *
 * ## 🔴 鉴权边界：哪几条要 Bearer，为什么
 *
 * | 路由 | 要 Bearer | 为什么 |
 * |---|---|---|
 * | `email/change/request` | ✅ | 改的是账号身份，必须已经是你 |
 * | `email/change/confirm` | ❌ | 点邮件链接的人**手上没有会话**（可能在另一台设备上）。这与 `/password/reset` 同构 |
 * | `email/change/status` | ✅ | 它回的是"待绑地址"原值 |
 * | `email/change/cancel` | ✅ | 只能撤销自己那张 |
 * | `auth/sessions` 三条 | ✅ | 会话属于某个人 |
 *
 * 唯一那条不要 Bearer 的，因此**必须**是反枚举那一族的形状：查不到 / 过期 / 已用过 /
 * 已被撤销，四种同一个码同一句话（`account/email-change.ts` 文件头写了为什么）。
 *
 * ## 身份一律取自令牌，不取自输入
 *
 * 每一条都只看 `getAuthUser(req).userId`。**没有**任何一条接受 `userId` / `email` 参数，
 * 所以"替别人换绑"在这套路由里**写不出来** —— 与 `account-profile.routes.ts` 同一条手法。
 * 会话撤销那一条还多一层：`where` 里同时有 `jtiHash` 与 `userId`，别人的那一行删不动。
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { EMAIL_CHANGE_PATHS, SESSION_PATHS } from '@heyta/shared-schema';

import { Logger } from '../logger';
import { authenticate, getAuthUser } from '../middleware';
import { authCache } from '../auth-cache';
import { revokeAllTokens } from '../auth';
import { localeFromRequest } from '../request-locale.js';
import {
  EMAIL_CHANGE_HTTP_STATUS_BY_CODE,
  EmailChangeError,
  cancelEmailChange,
  confirmEmailChange,
  getEmailChangeStatus,
  requestEmailChange,
} from './email-change';
import { listSessions, revokeAllDeviceSessions, revokeSession } from './access-sessions';
import { emailFieldSchema } from './email-normalize';

const EmailChangeRequestSchema = z.object({ newEmail: emailFieldSchema });
const EmailChangeConfirmSchema = z.object({ token: z.string().min(16) });
/** `sessionId` 是 SHA-256 hex；按**形状**先拦一道，不让任意字符串进 `where`。 */
const SessionIdParamsSchema = z.object({ sessionId: z.string().regex(/^[0-9a-f]{64}$/) });

const sendEmailChangeError = (
  reply: FastifyReply,
  err: EmailChangeError,
): FastifyReply => {
  const status = EMAIL_CHANGE_HTTP_STATUS_BY_CODE[err.code] ?? 400;
  if (err.retryAfterSeconds !== undefined) {
    void reply.header('Retry-After', String(err.retryAfterSeconds));
  }
  return reply.status(status).send({ error: err.message, code: err.code });
};

export async function accountSecurityRoutes(fastify: FastifyInstance): Promise<void> {
  // ── 换绑登录邮箱 ─────────────────────────────────────────────────
  fastify.post<{ Body: unknown }>(
    `/${EMAIL_CHANGE_PATHS.request}`,
    {
      preHandler: authenticate,
      // 5/15min：锚的是 `/replace-token` 那一档（**它会发信**、且是高权限动作），不是拍的。
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const parsed = EmailChangeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      const userId = getAuthUser(req).userId;
      try {
        return reply.send(
          await requestEmailChange({
            userId,
            newEmail: parsed.data.newEmail,
            locale: localeFromRequest(req),
          }),
        );
      } catch (err) {
        if (err instanceof EmailChangeError) {
          Logger.warn(`Email change request rejected (${err.code})`);
          return sendEmailChangeError(reply, err);
        }
        throw err;
      }
    },
  );

  /**
   * 🔴 这一条**不要求** Bearer（见文件头那张表）。它由邮件里那一封信触发。
   *
   * 它同时是**生效那一步的执行者**：两边都点齐时，最后那一次点击就地改 `users.email`。
   * 但它**绝不返回会话** —— 点链接不等于登录（J14，与 `/password/reset` 逐字同一条理由：
   * 能点开信意味着持有收件箱，而收件箱是可以被旁观的）。
   */
  fastify.post<{ Body: unknown }>(
    `/${EMAIL_CHANGE_PATHS.confirm}`,
    {
      config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const parsed = EmailChangeConfirmSchema.safeParse(req.body);
      if (!parsed.success) {
        // 与"链接无效"**同一句话、同一个码**：一个畸形的请求体与一枚查不到的令牌，
        // 对点链接的人来说处置完全一样（回界面重新发起一次）。分开报就是给枚举留门。
        return reply
          .status(400)
          .send({ error: 'That link is not valid. Start the change again from the app.', code: 'invalid_change_link' });
      }
      try {
        return reply.send(
          await confirmEmailChange(parsed.data.token, localeFromRequest(req)),
        );
      } catch (err) {
        if (err instanceof EmailChangeError) {
          Logger.warn(`Email change confirm rejected (${err.code})`);
          return sendEmailChangeError(reply, err);
        }
        throw err;
      }
    },
  );

  fastify.get(
    `/${EMAIL_CHANGE_PATHS.status}`,
    { preHandler: authenticate },
    async (req) => getEmailChangeStatus(getAuthUser(req).userId),
  );

  fastify.post(
    `/${EMAIL_CHANGE_PATHS.cancel}`,
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (req) => cancelEmailChange(getAuthUser(req).userId),
  );

  // ── 登录会话 ────────────────────────────────────────────────────
  fastify.get(
    `/${SESSION_PATHS.list}`,
    { preHandler: authenticate },
    async (req) => {
      const user = getAuthUser(req);
      return {
        sessions: await listSessions(
          user.userId,
          user.tokenVersion ?? 0,
          user.sessionId ?? null,
        ),
      };
    },
  );

  fastify.delete<{ Params: { sessionId: string } }>(
    `/${SESSION_PATHS.list}/:sessionId`,
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const parsed = SessionIdParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'That session is not valid.', code: 'unknown_session' });
      }
      const user = getAuthUser(req);
      const revoked = await revokeSession(user.userId, parsed.data.sessionId);
      // AUTH_CACHE_INVALIDATION: 撤销**一枚**也要失效缓存，否则那一枚在 30 s 内还能用，
      // 而"我点了退出，它还在"正是本笔要修的那句话。
      authCache.invalidate(user.userId);
      if (!revoked) {
        // 🔴 与"不存在""不是你的""已经撤过"同一句、同一个码。
        return reply
          .status(400)
          .send({ error: 'That session is not valid.', code: 'unknown_session' });
      }
      // 实时通道由 `revokeSession` 在那一行真删掉时关掉**那一枚自己的**连接
      // （`closeForSession(userId, sessionId)`），这里不重复做、也**不该**做 `closeForUser` ——
      // 那是 `revoke-all` 的语义，"退出这一台"不许把别的设备一起踢下线。
      // ⚠️ 本轮之前签的令牌没有 `jti` ⇒ 那一枚会话认不出对应哪条连接，只能等它自己重连（ADR-0063 §4 第 1 条）。
      Logger.audit({ event: 'SESSION_REVOKED', userId: user.userId });
      return reply.send({ success: true });
    },
  );

  /**
   * 「登出所有设备」——这条能力**早就存在**（`POST /api/replace-token`），
   * 缺的只是把它做成一个用户动作：`packages/app-host` 里连 `replaceToken` 函数都没有，
   * 而 `sync-client` 的测试注释已经把这个按钮当作既有事实在描述。
   */
  fastify.post(
    `/${SESSION_PATHS.revokeAll}`,
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (req) => {
      const user = getAuthUser(req);
      // 行删掉只让**带 jti 的**令牌失效；本轮之前那些没有 jti 的只能靠计数器（ADR-0063 §4 第 1 条）。
      await revokeAllTokens(user.userId);
      // 行 + 通道是一个助手（`revokeAllDeviceSessions`）：两半分开写就是这一族漏东西的形状。
      const count = await revokeAllDeviceSessions(user.userId);
      Logger.audit({ event: 'SESSIONS_REVOKED_ALL', userId: user.userId });
      return { success: true, count };
    },
  );

  /**
   * 「退出登录」真正该做的事：**撤销手上这一枚**，然后客户端自己清本机凭据。
   *
   * 在这一笔之前它什么都不撤销 —— `apps/web/src/App.tsx:2146` 是 `clearCredentials()`，
   * 而服务端那枚令牌**仍然有效 365 天**。共享电脑上"我已经退出了"是一句界面在说谎。
   *
   * ⚠️ `sessionId === null`（本轮之前签的、没有 `jti` 的令牌）时**仍然回 200**：
   * 对客户端来说结果一样（本机凭据该清），而"这一枚我撤不掉"是一句对用户没有行动价值的
   * 内部事实。它记在日志与 ADR 的边界里，不记在界面上。
   */
  fastify.post(
    `/${SESSION_PATHS.logout}`,
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (req) => {
      const user = getAuthUser(req);
      const sessionId = user.sessionId ?? null;
      if (sessionId !== null) {
        await revokeSession(user.userId, sessionId);
        authCache.invalidate(user.userId);
        // 本机这一枚的通道由 `revokeSession` 关掉（按 session id 精确匹配），
        // 这里同样**不**关整个账号 —— 别的设备不该为"这一台退出登录"买单。
        Logger.audit({ event: 'SESSION_LOGOUT', userId: user.userId });
      } else {
        Logger.info(`Legacy token without jti logged out locally (ID: ${user.userId})`);
      }
      return { message: 'Signed out.' };
    },
  );
}


