// Operation log primitives — the generic, app-agnostic core of the sync engine.
export {
  OpType,
  isMultiEntityPayload,
  isLwwUpdatePayload,
  extractActionPayload,
  extractEntityFromPayload,
  extractUpdateChanges,
} from './operation.types';
export type {
  VectorClock,
  Operation,
  OperationLogEntry,
  EntityConflict,
  ConflictResult,
  EntityChange,
  MultiEntityPayload,
  LwwUpdateMode,
  LwwUpdatePayload,
} from './operation.types';

// Vector-clock algorithms — single source of truth for client/server parity.
export {
  compareVectorClocks,
  mergeVectorClocks,
  limitVectorClockSize,
  MAX_VECTOR_CLOCK_SIZE,
} from './vector-clock';
export { VectorClockComparison } from './vector-clock';

// Full-state import clean-slate vector-clock decisions.
export { classifyOpAgainstSyncImport } from './sync-import-filter';

// Host-configured sync file prefix helpers.
export { createSyncFilePrefixHelpers } from './sync-file-prefix';
export type {
  SyncFileHeadShape,
  SyncFilePrefixInvalidPrefixDetails,
  SyncFilePrefixParams,
  SyncFilePrefixParamsOutput,
} from './sync-file-prefix';

// Gzip compression helpers.
export {
  compressWithGzip,
  compressWithGzipToString,
  decompressGzipFromString,
} from './compression';

// Encryption primitives — Argon2id KDF + AES-GCM, Web Crypto with @noble fallback.
// See packages/sync-core/src/encryption.ts for the wire-format contract and
// the legacy-KDF warning side-channel.
export {
  encrypt,
  decrypt,
  encryptBatch,
  decryptBatch,
  decryptBatchSettled,
  deriveKeyFromPassword,
  clearSessionKeyCache,
  getSessionKeyCacheStats,
  getArgon2Params,
  getArgon2Backend,
  isArgon2SlowBackend,
  setArgon2Provider,
  getArgon2Provider,
  isCryptoSubtleAvailable,
  setArgon2ParamsForTesting,
  setLegacyKdfWarningHandler,
} from './encryption';

/**
 * 裸的 AES-GCM 原语与字节/Base64 互转 —— 给**小组件快照**这类
 * "自带信封格式、只是需要一次 AES-GCM" 的调用方用。
 *
 * ## 为什么要开这个口子
 *
 * 上面那组 `encrypt` / `decrypt` 是**口令式**的（`string → string`）：它们自己
 * 管 Argon2id 派生、盐、版本前缀。小组件快照用不上那一整套 ——
 * 它的密钥是**设备密钥**（不经口令派生），而它的信封格式由
 * `@heyta/widget-core` 的契约定义、还要把明文信封绑进 AAD。
 *
 * 可选做法是让它自己引一个 AES 库，但那会在本仓出现**第二份 AES-GCM 实现** ——
 * 两份实现最难查的不是"哪份错了"，而是**它们对 AAD / tag 长度的默认值不一样**，
 * 于是 iOS 能解、Android 解不开，而症状只是"组件没数据"。
 * 所以这里把**已有的那一份**导出，而不是再写一份。
 *
 * ⚠️ 导出的是原语，**没有任何口令派生** —— 调用方自己负责密钥的来源与生命周期。
 */
export {
  aesEncrypt,
  aesDecrypt,
  encodeBase64,
  decodeBase64,
  getRandomBytes,
} from './encryption/web-crypto';
export type {
  DerivedKey,
  DecryptSettledItem,
  Argon2Backend,
  Argon2Input,
  Argon2Provider,
} from './encryption';

// Structural ciphertext-transport classifier — used by the SuperSync server's
// encrypted-only ingress gate (E2EE_REQUIRED). Shape check only, never proof.
export {
  isEncryptedPayloadTransportShape,
  MIN_ENCRYPTED_PAYLOAD_TRANSPORT_BYTES,
} from './encryption/transport-shape';

// Generic error helpers.
export { extractErrorMessage } from './error.util';
export { WebCryptoNotAvailableError } from './web-crypto-error';

// Full-state operation classification helper. Hosts supply their own op strings.
export { createFullStateOpTypeHelpers } from './full-state-op-types';
export type { FullStateOpTypeHelpers } from './full-state-op-types';

// LWW (Last-Writer-Wins) update action-type helpers — factory parameterized by
// the host application's entity-type list, so the lib stays domain-agnostic.
export { createLwwUpdateActionTypeHelpers } from './lww-update-action-types';
export type { LwwUpdateActionTypeHelpers } from './lww-update-action-types';

// Apply-operation result and option types.
export type {
  ApplyOperationsResult,
  ApplyOperationsOptions,
  OperationApplyFailure,
} from './apply.types';

// Generic operation replay coordinator.
export { replayOperationBatch } from './replay-coordinator';

// Remote operation application coordinator.
export { applyRemoteOperations } from './remote-apply';
export type {
  ApplyRemoteOperationsOptions,
  RemoteOperationApplyStorePort,
} from './remote-apply';

// Upload planning helpers.
export {
  planRegularOpsAfterFullStateUpload,
  planUploadLastServerSeqUpdate,
} from './upload-planning';

// Download planning helpers.
export {
  planDownloadFullStateUpload,
  planDownloadGapReset,
  planDownloadedDataEncryptionState,
  planSnapshotHydration,
} from './download-planning';

// Port contracts for app-side orchestration adapters.
export type {
  ActionDispatchPort,
  ArchiveSideEffectPort,
  ConflictUiDialogRequest,
  ConflictUiPort,
  DeferredLocalActionsPort,
  OperationApplyPort,
  ReducerCommitAwareOperationApplyPort,
  RemoteApplyWindowPort,
  SyncActionLike,
} from './ports';

// Conflict-resolution helpers.
export {
  convertLocalDeleteRemoteUpdatesToLww,
  deepEqual,
  isIdenticalConflict,
  partitionLwwResolutions,
  planLwwConflictResolutions,
  suggestConflictResolution,
} from './conflict-resolution';
export type {
  ConflictResolutionSuggestion,
  EntityConflictLike,
  LwwConflictResolutionPlan,
  LwwConflictResolutionReason,
  LwwResolvedConflict,
} from './conflict-resolution';

// Entity-frontier and clock-corruption helpers (per-entity vector-clock domain).
export { adjustForClockCorruption, buildEntityFrontier } from './entity-frontier';

// Entity-registry contracts.
export {
  getEntityConfig,
  getPayloadKey,
  isAdapterEntity,
  isSingletonEntity,
  isMapEntity,
  isArrayEntity,
  isVirtualEntity,
  getAllPayloadKeys,
} from './entity-registry.types';
export type {
  EntityStoragePattern,
  BaseEntity,
  EntityDictionary,
  EntityConfig,
  EntityRegistry,
} from './entity-registry.types';

// Privacy-aware logger port.
export { NOOP_SYNC_LOGGER, toSyncLogError } from './sync-logger';
export type { SyncLogError, SyncLogMeta, SyncLogger } from './sync-logger';

// Entity key encoding helpers.
export { toEntityKey, parseEntityKey } from './entity-key.util';
