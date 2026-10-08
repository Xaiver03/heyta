// Schema version constants
export {
  INBOUND_MAX_PLAINTEXT_BYTES,
  inboundKeyScopeSchema, inboundEnvelopeContextSchema,
  inboundEnvelopeSchema, inboundWrappedKeySchema,
  type InboundKeyScope, type InboundEnvelopeContext, type InboundEnvelope, type InboundWrappedKey,
} from './inbound-crypto-contract';
export {
  TASK_MIN_DURATION_MINUTES, TASK_MAX_DURATION_MINUTES,
  TASK_BATCH_MAX_ITEMS, TASK_BATCH_MAX_TITLE_LENGTH, TASK_BATCH_MAX_NOTE_LENGTH,
  taskAutomationSourceSchema, taskBatchItemSchema, heytaTaskBatchPayloadSchema,
  hasTaskBatchMarker, parseTaskBatchOperation,
  taskBatchOperationId, taskBatchItemId,
  type TaskAutomationSource, type TaskBatchItem, type HeytaTaskBatchPayload,
} from './task-batch-contract';
export {
  taskPriorityBatchItemSchema, heytaTaskPriorityBatchPayloadSchema,
  hasTaskPriorityBatchMarker, parseTaskPriorityBatchOperation,
  type TaskPriorityBatchItem, type HeytaTaskPriorityBatchPayload,
} from './task-priority-batch-contract';
export {
  heytaTaskRepeatCompletionPayloadSchema,
  hasTaskRepeatCompletionMarker,
  parseTaskRepeatCompletionOperation,
  type TaskRepeatCompletionTaskPatch,
  type TaskRepeatCompletionReminderPatch,
  type HeytaTaskRepeatCompletionPayload,
} from './task-repeat-completion-contract';
export { reminderOwnerFromId, validateReminderOwnerOperation } from './reminder-owner-contract';
export { isHeytaFullStatePayload, type HeytaFullStatePayload } from './full-state-payload';
export {
  CURRENT_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from './schema-version';

// Types
export type {
  OperationLike,
  SchemaMigration,
  MigrationResult,
  MigratableStateCache,
} from './migration.types';

// Migration functions
export {
  migrateState,
  migrateOperation,
  migrateOperations,
  stateNeedsMigration,
  operationNeedsMigration,
  validateMigrationRegistry,
  getCurrentSchemaVersion,
} from './migrate';

// Migration registry (for inspection/debugging)
export { MIGRATIONS } from './migrations/index';

// Entity types (shared between client and server)
export type { EntityType } from './entity-types';
export { ENTITY_TYPES, isEntityType } from './entity-types';

// SuperSync HTTP contract (shared between client and server)
export {
  SUPER_SYNC_CLIENT_ID_REGEX,
  SUPER_SYNC_MAX_CLIENT_ID_LENGTH,
  SUPER_SYNC_MAX_OPS_PER_UPLOAD,
  SUPER_SYNC_MAX_ENTITY_IDS_PER_OP,
  SUPER_SYNC_OP_TYPES,
  SUPER_SYNC_IMPORT_REASONS,
  SUPER_SYNC_SNAPSHOT_REASONS,
  SUPER_SYNC_SNAPSHOT_OP_TYPES,
  SUPER_SYNC_ERROR_CODES,
  SuperSyncVectorClockSchema,
  SuperSyncCausalFrontierSchema,
  SuperSyncClientIdSchema,
  SuperSyncOperationSchema,
  SuperSyncUploadOperationSchema,
  SuperSyncUploadOpsRequestSchema,
  SuperSyncInboundCommitProofsSchema,
  SuperSyncInboundUploadAuthorizationSchema,
  SuperSyncDownloadOpsQuerySchema,
  SuperSyncUploadSnapshotRequestSchema,
  SuperSyncOperationResponseSchema,
  SuperSyncServerOperationSchema,
  SuperSyncUploadResultSchema,
  SuperSyncUploadOpsResponseSchema,
  SuperSyncDownloadOpsResponseSchema,
  SuperSyncSnapshotResponseSchema,
  SuperSyncSnapshotUploadResponseSchema,
  SuperSyncStatusResponseSchema,
  SuperSyncDeviceSchema,
  SuperSyncDevicesResponseSchema,
  SuperSyncRevokeDeviceResponseSchema,
  SuperSyncReplaceTokenResponseSchema,
  SuperSyncRestorePointSchema,
  SuperSyncRestorePointsResponseSchema,
  SuperSyncRestoreSnapshotResponseSchema,
  SuperSyncDeleteAllDataResponseSchema,
} from './supersync-http-contract';
export type {
  SuperSyncOpType,
  SuperSyncImportReason,
  SuperSyncSnapshotReason,
  SuperSyncSnapshotOpType,
  SuperSyncErrorCode,
  SuperSyncOperation,
  SuperSyncUploadOpsRequest,
  SuperSyncInboundUploadAuthorization,
  SuperSyncDownloadOpsQuery,
  SuperSyncUploadSnapshotRequest,
  SuperSyncServerOperation,
  SuperSyncUploadResult,
  SuperSyncUploadOpsResponse,
  SuperSyncDownloadOpsResponse,
  SuperSyncSnapshotResponse,
  SuperSyncSnapshotUploadResponse,
  SuperSyncStatusResponse,
  SuperSyncDevice,
  SuperSyncDevicesResponse,
  SuperSyncRevokeDeviceResponse,
  SuperSyncReplaceTokenResponse,
  SuperSyncRestorePoint,
  SuperSyncRestorePointsResponse,
  SuperSyncRestoreSnapshotResponse,
  SuperSyncDeleteAllDataResponse,
  SuperSyncCausalFrontier,
} from './supersync-http-contract';

// Auth HTTP contract（邮箱+口令那条路：路径 / 机器码词表 / 长度界限）
export {
  AUTH_PASSWORD_PATHS,
  PASSWORD_AUTH_ERROR_CODES,
  PASSWORD_POLICY_CODES,
  AUTH_PASSWORD_MIN_CODE_POINTS,
  AUTH_PASSWORD_MAX_CODE_POINTS,
  EMAIL_PASSWORD_REGISTRATION_ERROR_CODES,
  EMAIL_PASSWORD_REGISTRATION_CODE_LENGTH,
  EMAIL_PASSWORD_REGISTRATION_CODE_TTL_MS,
  EMAIL_PASSWORD_REGISTRATION_RESEND_COOLDOWN_MS,
} from './auth-http-contract';
export type {
  PasswordAuthErrorCode,
  PasswordPolicyCode,
  EmailPasswordRegistrationErrorCode,
  EmailPasswordRegistrationChallengeResponse,
  EmailPasswordRegistrationVerifyRequest,
} from './auth-http-contract';

// 账号资料（R10）：昵称 + 头像的路径 / 长度界限 / 响应形状。
// ⚠️ 与上面 `AUTH_PASSWORD_*_CODE_POINTS` 同一档 —— 那才是"两端共用一个常量"的**正确**住处；
// `HOSTED_PASSKEY_NAME_MAX_LENGTH` 住在 app-host 而服务端零 import，是同一件事的**错误**住处
//（见 account-profile-contract.ts 文件头那段）。
export {
  ACCOUNT_PROFILE_PATHS,
  ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS,
  ACCOUNT_AVATAR_MAX_CIPHER_BASE64_BYTES,
  ACCOUNT_AVATAR_MAX_SOURCE_BYTES,
  ACCOUNT_AVATAR_EDGE_PX,
  ACCOUNT_AVATAR_CONTENT_TYPES,
  avatarPayloadSchema,
  parseAvatarPayload,
  base64DecodedBytes,
  isAvatarContentType,
  avatarOutputContentType,
  planAvatarUpload,
  avatarInitialFromEmail,
  avatarDataUri,
  displayNameCodePoints,
  accountDisplayNameSchema,
  accountProfileUpdateSchema,
  accountProfileResponseSchema,
  accountAvatarUpdateSchema,
} from './account-profile-contract';

// Opaque E2EE key-package transport. Root keys and recovery codes never cross
// this boundary; the service may persist only the wrapped package.
export {
  VAULT_KEY_PATHS,
  wrappedVaultKeySchema,
  vaultKeyPackageSchema,
  vaultKeyPackageUploadSchema,
  vaultKeyPackageResponseSchema,
} from './vault-key-contract';
export type {
  WrappedVaultKeyContract,
  VaultKeyPackageContract,
  VaultKeyPackageUpload,
  VaultKeyPackageResponse,
} from './vault-key-contract';
export {
  vaultKeyMigrationOperationSchema,
  vaultKeyMigrationRequestIdSchema,
  vaultKeyMigrationRequestSchema,
  vaultKeyMigrationResponseSchema,
  vaultKeyMigrationManifestSchema,
  vaultKeyMigrationChunkOperationSchema,
  vaultKeyMigrationChunkSchema,
  vaultKeyMigrationCommitSchema,
  vaultKeyMigrationCancelSchema,
  vaultKeyMigrationStageResponseSchema,
  vaultKeyMigrationInventoryOperationSchema,
  vaultKeyMigrationInventorySnapshotSchema,
  vaultKeyMigrationInventoryPageSchema,
} from './vault-key-migration-contract';
export type {
  VaultKeyMigrationOperation,
  VaultKeyMigrationRequest,
  VaultKeyMigrationResponse,
  VaultKeyMigrationManifest,
  VaultKeyMigrationChunkOperation,
  VaultKeyMigrationChunk,
  VaultKeyMigrationStageResponse,
  VaultKeyMigrationInventoryOperation,
  VaultKeyMigrationInventorySnapshot,
  VaultKeyMigrationInventoryPage,
} from './vault-key-migration-contract';
export type {
  AccountAvatarContentType,
  AccountProfileUpdate,
  AccountProfileResponse,
  AccountAvatarUpdate,
  AvatarPayload,
  AvatarRejectReason,
  AvatarUploadPlan,
} from './account-profile-contract';

// 纪念卡片成品图的导出契约（批次二 W7）。
// ⚠️ 与头像那一组同一档：**边长 / 比例 / 格式是产品规格**，所以住在契约层；
// "怎么把卡片栅格化成那张图"是平台调用，住各自的壳（`avatar-encode.ts` 的同一条分界）。
// 这一批**没有**动线协议、没有动 schema 版本 —— 它导出的是设备本地产物。
export {
  EXPORT_CARD_EDGE_PX,
  EXPORT_CARD_ASPECT_W,
  EXPORT_CARD_ASPECT_H,
  EXPORT_CARD_HEIGHT_PX,
  EXPORT_CARD_REF_WIDTH_DP,
  EXPORT_CARD_SCALE,
  EXPORT_CARD_CONTENT_TYPE,
  EXPORT_CARD_FILE_STEM_MAX_CODE_POINTS,
  EXPORT_CARD_SIZE,
} from './card-export-contract';
export type { ExportCardSize } from './card-export-contract';

// 调休/补班（公共事实，W4b）：路径 / 年份区间 / 逐日形状 / 两个响应体 / 门禁的形状登记表。
// 🔴 这一份是 heyta **第一条匿名只读的服务端→客户端内容通道**的契约。
// 定性与"为什么它不违反 AGENTS §1 那句云端不是事实源"见 docs/adr/0052；
// `PUBLIC_FACT_SHAPES` 是 `pnpm check:public-facts` 的被检查对象 ——
// 往公共事实里加第二种形状，那条门禁必须红。
export {
  HOLIDAY_ADJUSTMENT_PATHS,
  HOLIDAY_DATE_RE,
  isRealCalendarDay,
  HOLIDAY_ADJUSTMENT_YEAR_MIN,
  HOLIDAY_ADJUSTMENT_YEAR_MAX,
  HOLIDAY_ADJUSTMENT_MAX_DAYS_PER_YEAR,
  HOLIDAY_ADJUSTMENT_MIN_PAPERS,
  HOLIDAY_ADJUSTMENT_MAX_PAPERS,
  HOLIDAY_PAPER_PROTOCOLS,
  isHttpPaperUrl,
  HOLIDAY_ADJUSTMENT_NOTE_MAX_CHARS,
  holidayAdjustmentDaySchema,
  holidayAdjustmentYearSchema,
  holidayYearPutSchema,
  holidayAdjustmentsResponseSchema,
  holidayAdjustmentsAdminListSchema,
  holidayAdjustmentAdminDeleteQuerySchema,
  PUBLIC_FACT_SHAPES,
} from './holiday-adjustment-contract';
export type {
  HolidayAdjustmentDay,
  HolidayAdjustmentYear,
  HolidayAdjustmentsResponse,
  HolidayAdjustmentsAdminList,
} from './holiday-adjustment-contract';
