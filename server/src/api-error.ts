/**
 * 全局错误响应信封的**唯一出口**（信封契约在 `@heyta/shared-schema`）
 * ================================================================
 *
 * 🔴 路由里**不许再出现** `send({ error: … })`：那一半形状已经被
 * `scripts/check-server-error-shape.mjs` 钉死（含自检）。所有错误一律
 *
 *      return sendError(reply, 404, 'share_not_found');
 *
 * 它做三件事：拼 `{ code, message }`、把可选的 `retryAfterSeconds` 写进
 * **HTTP 标准的 `Retry-After` 头**（不进响应体 —— 体里的秒数没有客户在读，
 * 头才是通用 HTTP 层认的那个）、把可选上下文（`policyCode` 等）与 code/message 平级展开。
 *
 * `message` 是给人与日志兜底的英文串，**不是界面文案**：客户端按 `code`
 * 白名单取 i18n 词条，认不出的 code 退回按状态码分类。所以 message 只要求
 * "排障时读得懂"，不要求被界面展示。
 */
import type { FastifyReply } from 'fastify';

export interface SendErrorOptions {
  /** 走 `Retry-After` 头（429 限速 / 503 过载）。正整数秒。 */
  readonly retryAfterSeconds?: number;
  /** 与 `code`/`message` 平级的上下文字段（如 `policyCode: 'too_short'`）。 */
  readonly details?: Readonly<Record<string, unknown>>;
}

export const sendError = (
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  options?: SendErrorOptions,
): unknown => {
  if (options?.retryAfterSeconds !== undefined) {
    reply.header('retry-after', String(options.retryAfterSeconds));
  }
  return reply.status(status).send({
    code,
    message,
    ...(options?.details ?? {}),
  });
};

/**
 * error handler 兜底用的**状态码 → 通用码**映射。
 *
 * 只覆盖"没有更具体的话可说"的那几档；有具体码的错误**必须**在路由层给。
 */
export const GENERIC_ERROR_CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'rate_limited',
};
