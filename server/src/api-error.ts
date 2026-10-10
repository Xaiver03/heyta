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
import { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

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
  405: 'method_not_allowed',
  409: 'conflict',
  429: 'rate_limited',
};

/* ========================================================================
 * 全局兜底（error handler + not-found handler）—— **唯一一份**
 * ======================================================================
 *
 * 🔴 2026-10-10 补上的两个洞（都由「真的注入一发」验证，不是读代码推出来的）：
 *
 *   1. **404 不走 setErrorHandler**。Fastify 里路由器没接住的路径交给
 *      not-found handler，而默认的 not-found 响应是
 *      `{ message, error, statusCode }` —— 旧形状。此前只有 web-app 作用域
 *      自己设了 notFoundHandler，`/api/*` 打在未知路径上仍是默认形状。
 *   2. **框架内部码会漏出来**。Fastify 抛的 `FST_ERR_*` 大写串恰好能通过
 *      信封的字符集判定，于是"坏 JSON"会带着 `code: 'FST_ERR_CTP_BAD_JSON'`
 *      出线 —— 形状没错，但客户端的码词表里永远不会有它。框架码一律折进
 *      按状态码的通用码。
 *
 * 路由里有更具体的话要说时，自己在 handler 里 sendError —— 兜底永远只兜
 * "没有更具体的话"的那一档。
 */
import { Logger } from './logger';

export const pickErrorLogLevel = (url: string, statusCode: number): 'error' | 'warn' | 'debug' => {
  if (statusCode >= 500) return 'error';
  if (statusCode === 429 && url.split('?', 1)[0]!.replace(/\/+$/, '') === '/api/sync/ws') {
    return 'debug';
  }
  return 'warn';
};

export const sanitizeRequestUrlForLog = (rawUrl: string): string => {
  const queryStart = rawUrl.indexOf('?');
  return queryStart === -1 ? rawUrl : `${rawUrl.slice(0, queryStart)}?redacted`;
};

const ENVELOPE_CODE_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

const envelopeOfFastifyError = (error: FastifyError): { status: number; code: string; message: string } => {
  const status = error.statusCode ?? 500;
  if (status >= 500) {
    // 5xx 一律脱敏：Prisma 的原始错误会带 DB 主机名与 ORM 调用形状。
    return { status: 500, code: 'internal_error', message: 'Internal Server Error' };
  }
  const generic = GENERIC_ERROR_CODE_BY_STATUS[status];
  // 框架码（FST_ERR_*）不外泄：它们不在任何客户端词表里，折进按状态码的通用码。
  const frameworkInternal = typeof error.code === 'string' && error.code.startsWith('FST_');
  const specific =
    !frameworkInternal && typeof error.code === 'string' && ENVELOPE_CODE_RE.test(error.code)
      ? error.code
      : undefined;
  return {
    status,
    code: specific ?? generic ?? 'request_rejected',
    message: error.message.length > 0 ? error.message : 'Request failed.',
  };
};

/** 给整台服务器挂上全局错误信封（error handler + not-found handler）。 */
export const attachErrorEnvelope = (fastifyServer: FastifyInstance): void => {
  fastifyServer.setErrorHandler((error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode ?? 500;
    const logMessage = `Request failed ${statusCode} ${req.method} ${sanitizeRequestUrlForLog(req.url)}: ${error.name}: ${error.message}`;
    const level = pickErrorLogLevel(req.url, statusCode);
    if (level === 'error') {
      Logger.error(logMessage, error.stack);
    } else if (level === 'debug') {
      Logger.debug(logMessage);
    } else {
      Logger.warn(logMessage);
    }
    const { status, code, message } = envelopeOfFastifyError(error);
    return reply.status(status).send({ code, message });
  });

  // 路由器没接住的路径（含方法不匹配）—— 默认形状是旧三键，这里归一。
  fastifyServer.setNotFoundHandler((_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(404).send({ code: 'not_found', message: 'Not Found' });
  });
};
