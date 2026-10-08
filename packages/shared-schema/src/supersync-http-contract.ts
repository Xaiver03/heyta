import { z } from 'zod';

export const SUPER_SYNC_CLIENT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
export const SUPER_SYNC_MAX_CLIENT_ID_LENGTH = 255;
export const SUPER_SYNC_MAX_OPS_PER_UPLOAD = 100;
export const SUPER_SYNC_MAX_ENTITY_IDS_PER_OP = 1000;

// Upload-only fields must be loose enough to reach per-operation validation,
// but still bounded so one invalid item cannot amplify logs/responses or make
// semantic validation walk an arbitrarily large identifier collection.
const SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH = 4096;
const SUPER_SYNC_MAX_INVALID_ENTITY_IDS_TRANSPORT = SUPER_SYNC_MAX_ENTITY_IDS_PER_OP * 2;

export const SUPER_SYNC_OP_TYPES = [
  'CRT',
  'UPD',
  'DEL',
  'MOV',
  'BATCH',
  'SYNC_IMPORT',
  'BACKUP_IMPORT',
  'REPAIR',
] as const;

/**
 * 整体重建类 op（`SYNC_IMPORT` / `BACKUP_IMPORT` / `REPAIR`）的**原因**词表。
 *
 * 🔴 **每一个成员都必须有一个真实的生产者。** 这份词表是上传方向的
 * **校验集**（`syncImportReason: z.enum(...)`），不是一个"以后可能用得上"的
 * 备案清单：留一个没人发的成员，界面上就永远不会出现它，而读代码的人会
 * 以为那条流程存在 —— 装饰比缺失更坏，因为它给出的是**假的存在性证据**。
 *
 * 已按这条删掉的成员（原注释留在下面，避免有人把它当"漏删"加回来）：
 * - `'PASSWORD_CHANGED'` —— 全仓**零生产者**（连 vendored 的上游克隆里也没有），
 *   只有两个服务端 fixture 顺手拿它当 SYNC_IMPORT 的占位值。
 *   它原本要表达的是"改了端到端口令，所以整库重新加密后再传一遍"。
 *   **ADR-0040 把登录口令和 E2EE 口令解耦之后，改登录口令不需要重传任何东西**
 *   （密文不变，`tokenVersion` 前进只作废令牌）；而"轮换 E2EE 口令"这个功能
 *   本身还没做，真做的时候它需要的是一句跟着那条流程一起设计的标记
 *   （要能表达"新口令解不开旧密文"这种中途失败），不是把这个成员捡回来。
 */
export const SUPER_SYNC_IMPORT_REASONS = [
  'FILE_IMPORT',
  'BACKUP_RESTORE',
  'FORCE_UPLOAD',
  'SERVER_MIGRATION',
  'REPAIR',
] as const;

export const SUPER_SYNC_SNAPSHOT_REASONS = ['initial', 'recovery', 'migration'] as const;

export const SUPER_SYNC_SNAPSHOT_OP_TYPES = [
  'SYNC_IMPORT',
  'BACKUP_IMPORT',
  'REPAIR',
] as const;

/**
 * Structured error codes the SuperSync server attaches to responses
 * (`errorCode` on non-2xx bodies and per-op upload results).
 *
 * This is the producer/comparison vocabulary shared by server and client —
 * NOT a wire validation set. Response schemas keep `errorCode` as a loose
 * `z.string()` so an older client never rejects an otherwise-valid response
 * just because a newer server introduced a code it does not know yet.
 */
export const SUPER_SYNC_ERROR_CODES = {
  // Validation errors (400)
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_OP_ID: 'INVALID_OP_ID',
  INVALID_OP_TYPE: 'INVALID_OP_TYPE',
  INVALID_ENTITY_TYPE: 'INVALID_ENTITY_TYPE',
  INVALID_ENTITY_ID: 'INVALID_ENTITY_ID',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INVALID_VECTOR_CLOCK: 'INVALID_VECTOR_CLOCK',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  MISSING_ENTITY_ID: 'MISSING_ENTITY_ID',
  INVALID_SCHEMA_VERSION: 'INVALID_SCHEMA_VERSION',
  INVALID_CLIENT_ID: 'INVALID_CLIENT_ID',
  // Authorization may recover; never discard the local operation as malformed.
  INBOUND_AUTH_REQUIRED: 'INBOUND_AUTH_REQUIRED',

  // Conflict errors (409)
  CONFLICT_CONCURRENT: 'CONFLICT_CONCURRENT',
  CONFLICT_SUPERSEDED: 'CONFLICT_SUPERSEDED',
  REPAIR_STALE: 'REPAIR_STALE',
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',
  SYNC_IMPORT_EXISTS: 'SYNC_IMPORT_EXISTS',

  // Rate limiting (429)
  RATE_LIMITED: 'RATE_LIMITED',

  // Storage quota (413)
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',

  // Encryption-related errors (400)
  ENCRYPTED_OPS_NOT_SUPPORTED: 'ENCRYPTED_OPS_NOT_SUPPORTED',
  // Encrypted-only ingress gate: upload rejected because a payload is not
  // flagged encrypted or lacks the ciphertext transport shape.
  E2EE_REQUIRED: 'E2EE_REQUIRED',

  // Server errors (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type SuperSyncErrorCode =
  (typeof SUPER_SYNC_ERROR_CODES)[keyof typeof SUPER_SYNC_ERROR_CODES];

/**
 * Constrains client-generated dedup keys to URL-safe chars so they can be
 * embedded in log lines without escape risk and trivially compared on the
 * server. Length is intentionally permissive (1..64) so existing clients
 * keep working; the charset restriction alone closes the log-injection
 * vector that motivated this regex.
 */
const SUPER_SYNC_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

const SuperSyncRequestIdSchema = z.string().regex(SUPER_SYNC_REQUEST_ID_REGEX);

export const SuperSyncVectorClockSchema = z.record(z.string(), z.number());

/**
 * A server-issued, signed causal frontier.  The token binds the clock to the
 * server's retained history; clients must never invent one locally.
 */
export const SuperSyncCausalFrontierSchema = z.object({
  token: z.string().min(1).max(65536),
  vectorClock: SuperSyncVectorClockSchema,
});
export type SuperSyncCausalFrontier = z.infer<typeof SuperSyncCausalFrontierSchema>;

export const SuperSyncClientIdSchema = z
  .string()
  .min(1)
  .max(SUPER_SYNC_MAX_CLIENT_ID_LENGTH)
  .regex(
    SUPER_SYNC_CLIENT_ID_REGEX,
    'clientId must be alphanumeric with underscores/hyphens only',
  );

export const SuperSyncOperationSchema = z.object({
  id: z.string().min(1).max(255),
  clientId: SuperSyncClientIdSchema,
  actionType: z.string().min(1).max(255),
  opType: z.enum(SUPER_SYNC_OP_TYPES),
  entityType: z.string().min(1).max(255),
  entityId: z.string().max(255).optional(),
  entityIds: z
    .array(z.string().max(255))
    .max(SUPER_SYNC_MAX_ENTITY_IDS_PER_OP)
    .optional(),
  payload: z.unknown(),
  vectorClock: SuperSyncVectorClockSchema,
  /** When present, `vectorClock` is a delta against the signed frontier in the
   * upload envelope. Old clients omit this field and send a complete clock. */
  vectorClockEncoding: z.enum(['full', 'frontier-delta']).optional(),
  timestamp: z.number(),
  schemaVersion: z.number().int().min(1).max(100),
  /** Optional (absent on old clients) — readers must sniff the payload type
   * instead of relying on it (android `SuperSyncBackgroundProvider` does). */
  isPayloadEncrypted: z.boolean().optional(),
  syncImportReason: z.enum(SUPER_SYNC_IMPORT_REASONS).optional(),
  /** Server cursor proven to be included in a causally accepted REPAIR snapshot. */
  repairBaseServerSeq: z.number().int().min(0).optional(),
});

// Upload requests are envelopes for independently validated operations. Keep
// structural types and fields that ValidationService does not handle strict,
// but defer semantic operation validation to the server so one malformed op
// cannot reject and stall every valid sibling in the batch. Download/response
// schemas stay structurally strict but keep their VOCABULARY fields loose —
// see SuperSyncOperationResponseSchema.
// 🔴 export（2026-10-08，W2）：share 上传（/api/shares/:id/ops）走同一条
// 「宽松传输 + 严格语义」两段校验，逐 op 直接调用本 schema（跨包只能调方法、
// 不能用另一个 zod 实例组合它 —— 那会踩 `_zod` 双实例内部字段）。
export const SuperSyncUploadOperationSchema = SuperSyncOperationSchema.extend({
  id: z.string().max(SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH),
  clientId: z.string().max(SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH),
  opType: z.string().max(SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH),
  entityType: z.string().max(SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH),
  entityId: z.string().max(SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH).optional(),
  entityIds: z
    .array(z.string().max(SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH))
    .max(SUPER_SYNC_MAX_INVALID_ENTITY_IDS_TRANSPORT)
    .optional(),
  vectorClock: z.record(z.string(), z.unknown()),
  schemaVersion: z.number(),
});

export const SuperSyncInboundCommitProofsSchema = z.record(
  z.string().regex(/^inbound:[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/), z.string().min(1).max(2048),
).refine((proofs) => Object.keys(proofs).length <= SUPER_SYNC_MAX_OPS_PER_UPLOAD);

/** Local transport credentials; never persist these in a business operation. */
export const SuperSyncInboundUploadAuthorizationSchema = z.object({
  workerToken: z.string().regex(/^[0-9a-f]{64}$/),
  databaseEpoch: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  commitProofs: SuperSyncInboundCommitProofsSchema,
}).strict();
export type SuperSyncInboundUploadAuthorization = z.infer<typeof SuperSyncInboundUploadAuthorizationSchema>;

export const SuperSyncUploadOpsRequestSchema = z.object({
  ops: z.array(SuperSyncUploadOperationSchema).min(1).max(SUPER_SYNC_MAX_OPS_PER_UPLOAD),
  clientId: SuperSyncClientIdSchema,
  lastKnownServerSeq: z.number().optional(),
  requestId: SuperSyncRequestIdSchema.optional(),
  /** Signed frontier used by operations encoded as `frontier-delta`. */
  causalFrontierToken: z.string().min(1).max(65536).optional(),
  /** Owner-held commit receipts; transport authorization, never part of an op. */
  inboundCommitProofs: SuperSyncInboundCommitProofsSchema.optional(),
});

export const SuperSyncDownloadOpsQuerySchema = z.object({
  sinceSeq: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  excludeClient: SuperSyncClientIdSchema.optional(),
  /**
   * Bare semver of the calling app (`18.22.0`), recorded per device for the
   * server's checkpoint gate (#9962). A query parameter rather than a header
   * so browser clients need no new CORS allowance from older servers, which
   * strip it as an unknown key. Loosely typed on purpose: the server drops a
   * malformed value instead of failing the download.
   */
  appVersion: z.string().optional(),
});

export const SuperSyncUploadSnapshotRequestSchema = z
  .object({
    state: z.unknown(),
    clientId: SuperSyncClientIdSchema,
    reason: z.enum(SUPER_SYNC_SNAPSHOT_REASONS),
    vectorClock: SuperSyncVectorClockSchema,
    schemaVersion: z.number().int().min(1).max(100).optional(),
    isPayloadEncrypted: z.boolean().optional(),
    syncImportReason: z.enum(SUPER_SYNC_IMPORT_REASONS).optional(),
    opId: z.string().uuid().optional(),
    isCleanSlate: z.boolean().optional(),
    snapshotOpType: z.enum(SUPER_SYNC_SNAPSHOT_OP_TYPES).optional(),
    repairBaseServerSeq: z.number().int().min(0).optional(),
    requestId: SuperSyncRequestIdSchema.optional(),
  })
  .superRefine((request, context) => {
    if (request.isCleanSlate && !request.opId) {
      context.addIssue({
        code: 'custom',
        path: ['opId'],
        message: 'opId is required for clean-slate snapshot idempotency',
      });
    }
  });

/**
 * Vocabulary fields (`opType`, `syncImportReason`, restore-point `type`) are
 * loose strings on the RESPONSE side, mirroring `errorCode`: a client must
 * never reject a whole download page because a newer server relayed a value
 * this client does not know yet. One unknown op would otherwise wedge every
 * not-yet-updated device with a generic parse error, before the schema-version
 * "update your app" path could run (#8764). Unknown values are handled per op
 * after parsing (the receiver blocks at that op and keeps its cursor); the
 * strict enums stay on the REQUEST side, where the server validates per op.
 */
const SUPER_SYNC_MAX_VOCABULARY_TRANSPORT_LENGTH = 255;

export const SuperSyncOperationResponseSchema = SuperSyncOperationSchema.extend({
  opType: z.string().min(1).max(SUPER_SYNC_MAX_VOCABULARY_TRANSPORT_LENGTH),
  syncImportReason: z.string().max(SUPER_SYNC_MAX_VOCABULARY_TRANSPORT_LENGTH).optional(),
}).passthrough();

export const SuperSyncServerOperationSchema = z
  .object({
    serverSeq: z.number(),
    op: SuperSyncOperationResponseSchema,
    receivedAt: z.number(),
  })
  .passthrough();

export const SuperSyncUploadResultSchema = z
  .object({
    opId: z.string(),
    accepted: z.boolean(),
    serverSeq: z.number().optional(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
    existingClock: SuperSyncVectorClockSchema.optional(),
  })
  .passthrough();

export const SuperSyncUploadOpsResponseSchema = z
  .object({
    results: z.array(SuperSyncUploadResultSchema),
    newOps: z.array(SuperSyncServerOperationSchema).optional(),
    latestSeq: z.number(),
    hasMorePiggyback: z.boolean().optional(),
    gapDetected: z.boolean().optional(),
    deduplicated: z.boolean().optional(),
  })
  .passthrough();

export const SuperSyncDownloadOpsResponseSchema = z
  .object({
    ops: z.array(SuperSyncServerOperationSchema),
    hasMore: z.boolean(),
    latestSeq: z.number(),
    gapDetected: z.boolean().optional(),
    snapshotVectorClock: SuperSyncVectorClockSchema.optional(),
    causalFrontier: SuperSyncCausalFrontierSchema.optional(),
    serverTime: z.number().optional(),
    // Capability flags are plain booleans: a `literal(true)` would turn a
    // server that ever reports `false` into a page-wide parse failure.
    capabilities: z
      .object({
        causalRepairSnapshots: z.boolean().optional(),
        causalFrontierDelta: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();

export const SuperSyncSnapshotResponseSchema = z
  .object({
    state: z.unknown(),
    serverSeq: z.number(),
    generatedAt: z.number(),
  })
  .passthrough();

export const SuperSyncSnapshotUploadResponseSchema = z
  .object({
    accepted: z.boolean(),
    serverSeq: z.number().optional(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
  })
  .passthrough();

export const SuperSyncStatusResponseSchema = z
  .object({
    latestSeq: z.number(),
    devicesOnline: z.number(),
    snapshotAge: z.number().optional(),
    storageUsedBytes: z.number(),
    storageQuotaBytes: z.number(),
  })
  .passthrough();

export const SuperSyncDeviceSchema = z
  .object({
    clientId: SuperSyncClientIdSchema,
    /** Unix ms of the device's last sync activity (upload or download). */
    lastSeenAt: z.number(),
  })
  .passthrough();

export const SuperSyncDevicesResponseSchema = z
  .object({
    devices: z.array(SuperSyncDeviceSchema),
  })
  .passthrough();

/**
 * Response of `DELETE /api/sync/devices/:clientId`.
 *
 * Revoking a device invalidates the account token version and therefore
 * deliberately returns a rotation signal instead of pretending that deleting
 * the advisory device row is enough to protect E2EE data already obtained by
 * that device.
 */
export const SuperSyncRevokeDeviceResponseSchema = z
  .object({
    success: z.literal(true),
    clientId: SuperSyncClientIdSchema,
    requiresKeyRotation: z.literal(true),
  })
  .passthrough();

/**
 * Response of `POST /api/replace-token`: a fresh JWT for the calling client.
 * Issuing it bumps the account's `tokenVersion`, signing out every other device.
 */
// Only `token` is validated: it is the only field the client consumes, and
// requiring more would turn a benign server-side response change into a
// hard sign-out failure.
export const SuperSyncReplaceTokenResponseSchema = z
  .object({
    token: z.string().min(1),
  })
  .passthrough();

export const SuperSyncRestorePointSchema = z
  .object({
    serverSeq: z.number(),
    timestamp: z.number(),
    // Loose on purpose (see SuperSyncOperationResponseSchema); the client
    // keeps unknown types — the dialog renders them generically and restore
    // works by serverSeq.
    type: z.string().max(SUPER_SYNC_MAX_VOCABULARY_TRANSPORT_LENGTH),
    clientId: z.string(),
    description: z.string().optional(),
  })
  .passthrough();

export const SuperSyncRestorePointsResponseSchema = z
  .object({
    restorePoints: z.array(SuperSyncRestorePointSchema),
  })
  .passthrough();

export const SuperSyncRestoreSnapshotResponseSchema = SuperSyncSnapshotResponseSchema;

export const SuperSyncDeleteAllDataResponseSchema = z
  .object({
    success: z.boolean(),
  })
  .passthrough();

export type SuperSyncOpType = (typeof SUPER_SYNC_OP_TYPES)[number];
export type SuperSyncImportReason = (typeof SUPER_SYNC_IMPORT_REASONS)[number];
export type SuperSyncSnapshotReason = (typeof SUPER_SYNC_SNAPSHOT_REASONS)[number];
export type SuperSyncSnapshotOpType = (typeof SUPER_SYNC_SNAPSHOT_OP_TYPES)[number];

export type SuperSyncOperation = z.infer<typeof SuperSyncOperationSchema>;
export type SuperSyncUploadOpsRequest = z.infer<typeof SuperSyncUploadOpsRequestSchema>;
export type SuperSyncDownloadOpsQuery = z.infer<typeof SuperSyncDownloadOpsQuerySchema>;
export type SuperSyncUploadSnapshotRequest = z.infer<
  typeof SuperSyncUploadSnapshotRequestSchema
>;
export type SuperSyncServerOperation = z.infer<typeof SuperSyncServerOperationSchema>;
export type SuperSyncUploadResult = z.infer<typeof SuperSyncUploadResultSchema>;
export type SuperSyncUploadOpsResponse = z.infer<typeof SuperSyncUploadOpsResponseSchema>;
export type SuperSyncDownloadOpsResponse = z.infer<
  typeof SuperSyncDownloadOpsResponseSchema
>;
export type SuperSyncSnapshotResponse = z.infer<typeof SuperSyncSnapshotResponseSchema>;
export type SuperSyncSnapshotUploadResponse = z.infer<
  typeof SuperSyncSnapshotUploadResponseSchema
>;
export type SuperSyncStatusResponse = z.infer<typeof SuperSyncStatusResponseSchema>;
export type SuperSyncDevice = z.infer<typeof SuperSyncDeviceSchema>;
export type SuperSyncDevicesResponse = z.infer<typeof SuperSyncDevicesResponseSchema>;
export type SuperSyncRevokeDeviceResponse = z.infer<typeof SuperSyncRevokeDeviceResponseSchema>;
export type SuperSyncReplaceTokenResponse = z.infer<
  typeof SuperSyncReplaceTokenResponseSchema
>;
export type SuperSyncRestorePoint = z.infer<typeof SuperSyncRestorePointSchema>;
export type SuperSyncRestorePointsResponse = z.infer<
  typeof SuperSyncRestorePointsResponseSchema
>;
export type SuperSyncRestoreSnapshotResponse = z.infer<
  typeof SuperSyncRestoreSnapshotResponseSchema
>;
export type SuperSyncDeleteAllDataResponse = z.infer<
  typeof SuperSyncDeleteAllDataResponseSchema
>;
