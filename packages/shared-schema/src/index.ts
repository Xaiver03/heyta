// Schema version constants
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
  SuperSyncClientIdSchema,
  SuperSyncOperationSchema,
  SuperSyncUploadOpsRequestSchema,
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
  SuperSyncReplaceTokenResponse,
  SuperSyncRestorePoint,
  SuperSyncRestorePointsResponse,
  SuperSyncRestoreSnapshotResponse,
  SuperSyncDeleteAllDataResponse,
} from './supersync-http-contract';

// Auth HTTP contract（邮箱+口令那条路：路径 / 机器码词表 / 长度界限）
export {
  AUTH_PASSWORD_PATHS,
  PASSWORD_AUTH_ERROR_CODES,
  PASSWORD_POLICY_CODES,
  AUTH_PASSWORD_MIN_CODE_POINTS,
  AUTH_PASSWORD_MAX_CODE_POINTS,
} from './auth-http-contract';
export type {
  PasswordAuthErrorCode,
  PasswordPolicyCode,
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
  displayNameCodePoints,
  accountDisplayNameSchema,
  accountProfileUpdateSchema,
  accountProfileResponseSchema,
  accountAvatarUpdateSchema,
} from './account-profile-contract';
export type {
  AccountAvatarContentType,
  AccountProfileUpdate,
  AccountProfileResponse,
  AccountAvatarUpdate,
  AvatarPayload,
} from './account-profile-contract';
