import {
  FastifyReply,
  FastifyRequest,
  type RequestPayload,
  type preParsingHookHandler,
} from 'fastify';
import { Transform, type TransformCallback } from 'node:stream';
import { z } from 'zod';
import { SUPER_SYNC_MAX_OPS_PER_UPLOAD } from '@heyta/shared-schema';
import { isEncryptedPayloadTransportShape } from '@heyta/sync-core';
import { Logger } from '../logger';
import { type CompressedJsonBodyParseResult } from './compressed-body-parser';
import { SYNC_ERROR_CODES } from './sync.types';

type ZodIssue = z.ZodError['issues'][number];

/**
 * Static client-facing message for encrypted-op snapshot rejection.
 * The thrown error's `message` contains the encrypted-op count and must
 * NOT be echoed to the client (data-volume side-channel).
 */
export const ENCRYPTED_OPS_CLIENT_MESSAGE =
  'Server-side snapshot is unavailable because operations are end-to-end encrypted. ' +
  'Use the client app\'s "Sync Now" button to decrypt and restore locally.';

/**
 * Static client-facing message for the encrypted-only ingress gate.
 * Never include the submitted payload value in the message, logs, or
 * response — the rejected value may be user plaintext.
 */
export const E2EE_REQUIRED_CLIENT_MESSAGE =
  'This server only accepts end-to-end encrypted payloads. ' +
  'Update the app, enable sync encryption, then retry.';

interface E2eeGateItem {
  isPayloadEncrypted?: boolean;
  payload: unknown;
}

/**
 * Encrypted-only ingress gate check for one uploaded payload: the encryption
 * flag must be explicitly true (missing is a violation, not "false-ish OK")
 * and the payload must have the ciphertext transport shape. Shape check only —
 * a lying flag over base64-encoded plaintext is out of scope by design (see
 * docs/e2ee-legacy-data-eradication-plan.md).
 *
 * ADR-0080 起它只是 `payloadGateViolation('e2ee', item)` 的一层皮：账号级模式
 * 决定该收哪种载荷，而**这个函数本身的判据一个字没放宽**。
 */
export const violatesE2eeGate = (item: E2eeGateItem): boolean =>
  item.isPayloadEncrypted !== true || !isEncryptedPayloadTransportShape(item.payload);

/** 闸门结论：放行（`null`）或"这个账号要的是另一种载荷"。 */
export type PayloadGateViolation = 'need-e2ee' | 'need-plaintext';

/**
 * ADR-0080 S1：按**账号模式**判定这次上传该不该收。
 *
 * 两个方向都拒错配，且都要求标志**显式**出现（缺失既不是加密也不是明文）：
 *
 * | 账号模式   | isPayloadEncrypted | 形状          | 结论           |
 * |-----------|--------------------|---------------|----------------|
 * | `e2ee`    | true               | 密文          | 放行           |
 * | `e2ee`    | 其它               | —             | need-e2ee      |
 * | `readable`| false              | 明文          | 放行           |
 * | `readable`| 其它               | —             | need-plaintext |
 *
 * 🔴 为什么"拒错配"而不是"两种都收"：混进来一条另一种形状的行，冲突合并与
 * 快照重放就要各自处理四种组合，而"整库同模式"正是这套设计的承重假设。
 * 让服务端在入口就把混合挡住，客户端就不必证明它不会混。
 */
export const payloadGateViolation = (
  mode: 'e2ee' | 'readable',
  item: E2eeGateItem,
): PayloadGateViolation | null => {
  if (mode === 'e2ee') {
    return item.isPayloadEncrypted === true && isEncryptedPayloadTransportShape(item.payload)
      ? null
      : 'need-e2ee';
  }
  // readable：必须显式 false，且**不得**是密文形状（那是"半开半关"的信号）。
  return item.isPayloadEncrypted === false && !isEncryptedPayloadTransportShape(item.payload)
    ? null
    : 'need-plaintext';
};

/**
 * Rejects an upload at the encrypted-only ingress gate. Callers must invoke
 * this BEFORE request fingerprinting, deduplication, quota work, snapshot
 * preparation, or persistence so a rejected upload leaves no server-side
 * trace. Logs counts only, never payload content.
 */
export const sendE2eeRequiredReply = (
  reply: FastifyReply,
  userId: number,
  context: { clientId: string; surface: 'ops' | 'snapshot'; opsCount: number },
): FastifyReply => {
  Logger.audit({
    event: 'E2EE_REQUIRED',
    userId,
    clientId: context.clientId,
    errorCode: SYNC_ERROR_CODES.E2EE_REQUIRED,
    surface: context.surface,
    opsCount: context.opsCount,
  });
  return reply.status(400).send({
    code: SYNC_ERROR_CODES.E2EE_REQUIRED,
    message: E2EE_REQUIRED_CLIENT_MESSAGE,
  });
};

/**
 * ADR-0080：`readable` 模式下收到密文时的镜像拒绝。
 *
 * 消息里**不含**载荷，理由与 `E2EE_REQUIRED` 同一条：被拒的值可能就是用户正文。
 */
export const PLAINTEXT_REQUIRED_CLIENT_MESSAGE =
  'This account has end-to-end encryption turned off, so this server only accepts plaintext payloads. ' +
  'Enable sync encryption in the app, then retry.';

export const sendPlaintextRequiredReply = (
  reply: FastifyReply,
  userId: number,
  context: { clientId: string; surface: 'ops' | 'snapshot'; opsCount: number },
): FastifyReply => {
  Logger.audit({
    event: 'PLAINTEXT_REQUIRED',
    userId,
    clientId: context.clientId,
    errorCode: SYNC_ERROR_CODES.PLAINTEXT_REQUIRED,
    surface: context.surface,
    opsCount: context.opsCount,
  });
  return reply.status(400).send({
    code: SYNC_ERROR_CODES.PLAINTEXT_REQUIRED,
    message: PLAINTEXT_REQUIRED_CLIENT_MESSAGE,
  });
};

/**
 * Helper to create validation error response.
 * In production, hides detailed Zod error info to prevent schema leakage.
 */
export const createValidationErrorResponse = (
  zodIssues: ZodIssue[],
): { code: string; message: string; details?: ZodIssue[] } => {
  if (process.env.NODE_ENV === 'production') {
    return { code: 'validation_failed', message: 'Validation failed' };
  }
  return { code: 'validation_failed', message: 'Validation failed', details: zodIssues };
};

// Two-stage protection against zip bombs:
// 1. Pre-check: Reject compressed data > limit (typical ratio ~10:1)
// 2. Post-check: Reject decompressed data > limit (catches edge cases)
//
// Different limits for ops vs snapshots:
// - Ops uploads are incremental and smaller
// - Snapshots can be larger for backup/repair imports
export const MAX_COMPRESSED_SIZE_OPS = 10 * 1024 * 1024; // 10MB for /ops
export const MAX_COMPRESSED_SIZE_SNAPSHOT = 30 * 1024 * 1024; // 30MB for /snapshot (matches bodyLimit)
// B9: per-endpoint decompressed caps. A blanket 100MB lets a 10MB gzip body
// expand to 100MB of JSON.parse work, which stalls the event loop. Ops are
// incremental so 30MB raw is plenty (matches the largest expected SYNC_IMPORT
// op fanout); snapshots get 60MB to fit the 50MB cacheable cap plus headroom
// for the JSON-vs-compressed ratio.
export const MAX_DECOMPRESSED_SIZE_OPS = 30 * 1024 * 1024; // 30MB for /ops
export const MAX_DECOMPRESSED_SIZE_SNAPSHOT = 60 * 1024 * 1024; // 60MB for /snapshot
// Route-level guard that mirrors the shared contract but runs before Zod's
// per-op validation and before SyncService can build large conflict-lookup queries.
export const MAX_OPS_PER_BATCH = SUPER_SYNC_MAX_OPS_PER_UPLOAD;

// Fastify's route bodyLimit runs before our parser can decode Android's
// Content-Transfer-Encoding: base64 wrapper. Use the raw base64 envelope limit
// at the HTTP layer, then enforce the true binary gzip limit in
// parseCompressedJsonBody().
export const getMaxRawBodySizeForCompressedPayload = (
  maxCompressedSize: number,
): number => Math.ceil(maxCompressedSize / 3) * 4 + 4;

export const MAX_RAW_BODY_SIZE_OPS = getMaxRawBodySizeForCompressedPayload(
  MAX_COMPRESSED_SIZE_OPS,
);
export const MAX_RAW_BODY_SIZE_SNAPSHOT = getMaxRawBodySizeForCompressedPayload(
  MAX_COMPRESSED_SIZE_SNAPSHOT,
);

type PayloadTooLargeError = Error & {
  code: string;
  statusCode: number;
};

export const createPayloadTooLargeError = (limitBytes: number): PayloadTooLargeError =>
  Object.assign(new Error(`Request body exceeded ${limitBytes} byte limit`), {
    code: 'FST_ERR_CTP_BODY_TOO_LARGE',
    statusCode: 413,
  });

export const getHeaderString = (
  value: string | string[] | number | undefined,
): string | undefined => {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'number') return String(value);
  return value;
};

export const hasHeaderToken = (
  value: string | string[] | number | undefined,
  expectedToken: string,
): boolean =>
  getHeaderString(value)
    ?.split(',')
    .some((token) => token.trim().toLowerCase() === expectedToken) ?? false;

export const getParsedContentLength = (
  value: string | string[] | number | undefined,
): number | null => {
  const contentLength = getHeaderString(value);
  if (contentLength === undefined) return null;

  const parsed = Number.parseInt(contentLength, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

class RawBodyLimitTransform extends Transform {
  receivedEncodedLength = 0;

  constructor(private readonly limitBytes: number) {
    super();
  }

  _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const chunkBytes = Buffer.isBuffer(chunk)
      ? chunk.length
      : Buffer.byteLength(chunk, encoding);
    this.receivedEncodedLength += chunkBytes;

    if (this.receivedEncodedLength > this.limitBytes) {
      callback(createPayloadTooLargeError(this.limitBytes));
      return;
    }

    callback(null, chunk);
  }
}

export const createRawBodyLimitPreParsingHook =
  (maxCompressedSize: number, maxBase64RawSize: number): preParsingHookHandler =>
  (
    request: FastifyRequest,
    _reply: FastifyReply,
    payload: RequestPayload,
    done,
  ): void => {
    const isBase64GzipRequest =
      hasHeaderToken(request.headers['content-encoding'], 'gzip') &&
      hasHeaderToken(request.headers['content-transfer-encoding'], 'base64');
    const rawBodyLimit = isBase64GzipRequest ? maxBase64RawSize : maxCompressedSize;
    const contentLength = getParsedContentLength(request.headers['content-length']);

    if (contentLength !== null && contentLength > rawBodyLimit) {
      done(createPayloadTooLargeError(rawBodyLimit));
      return;
    }

    done(null, payload.pipe(new RawBodyLimitTransform(rawBodyLimit)));
  };

// Error helper
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Unknown error';

type CompressedJsonBodyParseFailure = Extract<
  CompressedJsonBodyParseResult,
  { ok: false }
>;

interface CompressedBodyFailureLogOptions {
  payloadLabel: 'upload' | 'snapshot';
  decompressFailureLabel: 'ops upload' | 'snapshot';
  maxCompressedSize: number;
  maxDecompressedSize: number;
}

export const sendCompressedBodyParseFailure = (
  reply: FastifyReply,
  userId: number,
  failure: CompressedJsonBodyParseFailure,
  options: CompressedBodyFailureLogOptions,
): FastifyReply => {
  if (failure.reason === 'compressed-payload-too-large') {
    Logger.warn(
      `[user:${userId}] Compressed ${options.payloadLabel} too large: ${failure.compressedSize} bytes (max ${options.maxCompressedSize})`,
    );
  } else if (failure.reason === 'decompressed-payload-too-large') {
    Logger.warn(
      `[user:${userId}] Decompressed ${options.payloadLabel} too large: ${failure.decompressedSize} bytes (max ${options.maxDecompressedSize})`,
    );
  } else if (failure.reason === 'decompress-failed') {
    Logger.warn(
      `[user:${userId}] Failed to decompress ${options.decompressFailureLabel}: ${errorMessage(failure.cause)}`,
    );
  } else if (failure.reason === 'invalid-json') {
    Logger.warn(
      `[user:${userId}] Decompressed ${options.decompressFailureLabel} is not valid JSON: ${errorMessage(failure.cause)}`,
    );
  }

  return reply.status(failure.statusCode).send({ code: 'compressed_payload_rejected', message: failure.error });
};
