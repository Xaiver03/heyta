import { z } from 'zod';
import { SYNC_PAYLOAD_MODES } from './sync-mode-contract';
import { vaultKeyPackageSchema } from './vault-key-contract';

/**
 * ADR-0080：迁移的**目标**载荷模式。缺省 `e2ee` = 今天唯一存在过的行为
 * （改口令包装 / 轮换 root 时全量重新加密）。
 *
 * `readable` 是"关掉端到端加密"那一趟：历史也要解密重传，所以它同样是一次
 * 全量迁移，只是**没有新密钥包、没有目标载荷世代** —— 这两个字段在那一档必须缺席，
 * 由下面的 superRefine 与数据库 CHECK 双重把关。
 */
const migrationTargetModeSchema = z.enum(SYNC_PAYLOAD_MODES).default('e2ee');

/**
 * The server cannot decrypt an E2EE operation.  A migration therefore carries
 * an opaque replacement for every retained operation, bound to its durable
 * `(id, serverSeq)` identity.  The server verifies the complete inventory and
 * publishes all replacements atomically; the unlocked client performs the
 * decrypt/re-encrypt work before sending this envelope.
 */
const safeNonNegativeInteger = z.number().int().nonnegative().refine(
  Number.isSafeInteger,
  'must be a safe integer',
);
const safePositiveInteger = z.number().int().positive().refine(
  Number.isSafeInteger,
  'must be a safe integer',
);

export const vaultKeyMigrationOperationSchema = z.object({
  id: z.string().min(1).max(255),
  serverSeq: safePositiveInteger,
  /** New vault-envelope ciphertext. Its generation is checked server-side. */
  payload: z.string().min(1).max(30 * 1024 * 1024),
}).strict();

export const vaultKeyMigrationRequestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const vaultKeyMigrationRequestSchema = z.object({
  requestId: vaultKeyMigrationRequestIdSchema,
  expectedKeyVersion: safeNonNegativeInteger,
  expectedLatestSeq: safeNonNegativeInteger,
  /** Payload generation is deliberately separate from wrapper keyVersion. */
  targetPayloadKeyVersion: safePositiveInteger,
  package: vaultKeyPackageSchema,
  operations: z.array(vaultKeyMigrationOperationSchema),
}).strict();

/**
 * The durable upload protocol for large vault rotations.  The manifest is
 * deliberately small: ciphertext travels through bounded chunk requests and
 * is never buffered in one HTTP body.
 */
export const vaultKeyMigrationManifestSchema = z.object({
  requestId: vaultKeyMigrationRequestIdSchema,
  targetMode: migrationTargetModeSchema,
  expectedKeyVersion: safeNonNegativeInteger,
  expectedLatestSeq: safeNonNegativeInteger,
  /** 目标载荷世代：只有 `e2ee` 目标才有。 */
  targetPayloadKeyVersion: safePositiveInteger.optional(),
  package: vaultKeyPackageSchema.optional(),
  expectedOperationCount: safeNonNegativeInteger.max(5_000_000),
  /** Sum of UTF-8 JSON bytes of replacement payloads. */
  expectedPayloadBytes: safeNonNegativeInteger.max(50 * 1024 * 1024 * 1024),
}).strict().superRefine((value, ctx) => {
  if (value.targetMode === 'readable') {
    if (value.package !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['package'], message: 'turning encryption off must not carry a new key package' });
    }
    if (value.targetPayloadKeyVersion !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['targetPayloadKeyVersion'], message: 'turning encryption off has no target payload generation' });
    }
    return;
  }
  if (value.package === undefined) {
    ctx.addIssue({ code: 'custom', path: ['package'], message: 'an e2ee migration must carry the next key package' });
  }
  if (value.targetPayloadKeyVersion === undefined) {
    ctx.addIssue({ code: 'custom', path: ['targetPayloadKeyVersion'], message: 'an e2ee migration must name its target payload generation' });
  }
});

const vaultKeyMigrationChunkIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const vaultKeyMigrationChunkOperationSchema = z.object({
  id: z.string().min(1).max(255),
  serverSeq: safePositiveInteger,
  payload: z.string().min(1).max(30 * 1024 * 1024),
}).strict();

export const vaultKeyMigrationChunkSchema = z.object({
  requestId: vaultKeyMigrationRequestIdSchema,
  chunkId: vaultKeyMigrationChunkIdSchema,
  chunkIndex: safeNonNegativeInteger.max(5_000_000),
  operations: z.array(vaultKeyMigrationChunkOperationSchema).min(1).max(1_000),
}).strict();

export const vaultKeyMigrationCommitSchema = z.object({
  requestId: vaultKeyMigrationRequestIdSchema,
}).strict();

export const vaultKeyMigrationCancelSchema = z.object({
  requestId: vaultKeyMigrationRequestIdSchema,
}).strict();

export const vaultKeyMigrationStageResponseSchema = z.object({
  requestId: vaultKeyMigrationRequestIdSchema,
  state: z.enum(['STAGING', 'PUBLISHED', 'CANCELLED', 'EXPIRED']),
  // 缺省 e2ee：老服务端不会发这个字段，而它们的迁移**只可能是** e2ee 那一种。
  targetMode: z.enum(SYNC_PAYLOAD_MODES).default('e2ee'),
  /** `null` = 目标是明文，这一趟没有新的包装版本 / 载荷世代。 */
  keyVersion: safePositiveInteger.nullable(),
  payloadKeyVersion: safePositiveInteger.nullable(),
  expectedLatestSeq: safeNonNegativeInteger,
  expectedOperationCount: safeNonNegativeInteger,
  uploadedOperationCount: safeNonNegativeInteger,
  expectedPayloadBytes: safeNonNegativeInteger,
  uploadedPayloadBytes: safeNonNegativeInteger,
  expiresAt: safePositiveInteger,
  migratedOperationCount: safeNonNegativeInteger,
  latestSeq: safeNonNegativeInteger,
}).strict();

/** Server-owned retained-history page for the client-side migration planner. */
export const vaultKeyMigrationInventoryOperationSchema = z.object({
  id: z.string().min(1).max(255),
  serverSeq: safePositiveInteger,
  clientId: z.string().min(1).max(255),
  actionType: z.string().min(1).max(4096),
  opType: z.string().min(1).max(128),
  entityType: z.string().min(1).max(255),
  entityId: z.string().max(255).optional(),
  entityIds: z.array(z.string().max(255)).max(1000).optional(),
  timestamp: z.number().int().refine(Number.isSafeInteger),
  schemaVersion: safeNonNegativeInteger,
  payload: z.string().min(1).max(30 * 1024 * 1024),
  /** True only for a retained causal full-state replay base. */
  causalFullState: z.boolean(),
}).strict();

export const vaultKeyMigrationInventorySnapshotSchema = z.object({
  present: z.boolean(),
  lastSnapshotSeq: safeNonNegativeInteger.optional(),
  /** The retained causal full-state operation that makes clearing the cache safe. */
  replayBaseServerSeq: safePositiveInteger.optional(),
}).strict();

export const vaultKeyMigrationInventoryPageSchema = z.object({
  operations: z.array(vaultKeyMigrationInventoryOperationSchema).max(1000),
  latestSeq: safeNonNegativeInteger,
  retainedFromSeq: safePositiveInteger,
  complete: z.boolean(),
  nextCursor: z.string().min(1).max(2048).optional(),
  snapshot: vaultKeyMigrationInventorySnapshotSchema,
}).strict();

export const vaultKeyMigrationResponseSchema = z.object({
  requestId: vaultKeyMigrationRequestIdSchema,
  keyVersion: safePositiveInteger,
  payloadKeyVersion: safePositiveInteger,
  latestSeq: safeNonNegativeInteger,
  migratedOperationCount: safeNonNegativeInteger,
}).strict();

export type VaultKeyMigrationOperation = z.infer<typeof vaultKeyMigrationOperationSchema>;
export type VaultKeyMigrationRequest = z.infer<typeof vaultKeyMigrationRequestSchema>;
export type VaultKeyMigrationResponse = z.infer<typeof vaultKeyMigrationResponseSchema>;
export type VaultKeyMigrationManifest = z.infer<typeof vaultKeyMigrationManifestSchema>;
export type VaultKeyMigrationChunkOperation = z.infer<typeof vaultKeyMigrationChunkOperationSchema>;
export type VaultKeyMigrationChunk = z.infer<typeof vaultKeyMigrationChunkSchema>;
export type VaultKeyMigrationStageResponse = z.infer<typeof vaultKeyMigrationStageResponseSchema>;
export type VaultKeyMigrationInventoryOperation = z.infer<typeof vaultKeyMigrationInventoryOperationSchema>;
export type VaultKeyMigrationInventorySnapshot = z.infer<typeof vaultKeyMigrationInventorySnapshotSchema>;
export type VaultKeyMigrationInventoryPage = z.infer<typeof vaultKeyMigrationInventoryPageSchema>;
