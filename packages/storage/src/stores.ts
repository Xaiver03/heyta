/**
 * heyta 本地数据库的 store 与索引定义。
 *
 * ⚠️ 这是**持久化结构**，属于"不可逆层"——一旦发布就很难改。
 * 改动前请读 `packages/shared-schema/src/schema-version.ts` 的版本政策。
 */

/** store 名称。 */
export const STORES = {
  /**
   * 操作日志本体。同步系统的唯一事实来源。
   *
   * 主键是自增的 `seq`（本地单调递增），**不是** op 的业务 id ——
   * 因为同步游标、崩溃恢复都要依赖"单调且无空洞"的本地序号。
   */
  OPS: 'ops',

  /** 物化后的实体状态（把 ops 重放出来的结果）。可从 OPS 完整重建。 */
  STATE: 'state',

  /** 键值型簿记：客户端 id、服务端游标、加密配置等。 */
  META: 'meta',

  /** 已归档/压缩的操作（保留用于恢复点与审计）。 */
  ARCHIVE: 'archive',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/** 全部 store 名称（建库时用）。 */
export const ALL_STORES: StoreName[] = [
  STORES.OPS,
  STORES.STATE,
  STORES.META,
  STORES.ARCHIVE,
];

/** `ops` store 的字段名。 */
export const OP_FIELDS = {
  /** 本地自增序号，主键。 */
  SEQ: 'seq',
  /** 操作业务 id（客户端生成的 UUID v7），**唯一索引**——用于去重。 */
  OP_ID: 'opId',
  ENTITY_TYPE: 'entityType',
  ENTITY_ID: 'entityId',
  /** 多实体批次操作涉及的全部实体 id，**multiEntry 索引**。 */
  ENTITY_IDS: 'entityIds',
  PAYLOAD: 'payload',
  VECTOR_CLOCK: 'vectorClock',
  CLIENT_ID: 'clientId',
  CLIENT_TIMESTAMP: 'clientTimestamp',
  SCHEMA_VERSION: 'schemaVersion',
  /**
   * 崩溃恢复标记。远程 op 先写入但标记为待应用，
   * 只有当 reducer 提交被持久化后才清除。
   *
   * 这是"应用过程中崩溃"不会导致数据不一致的关键。
   */
  PENDING_APPLY: 'pendingApply',
  /** 是否已应用到本地状态。 */
  APPLIED: 'applied',
  /** 应用失败标记（配合 quarantine）。 */
  FAILED: 'failed',
} as const;

/** 索引名称。 */
export const OP_INDEXES = {
  /** 唯一：同一 op 不得写入两次。 */
  OP_ID: 'by_opId',
  /** 按实体查询：['entityType','entityId'] 复合索引。 */
  ENTITY: 'by_entity',
  /** 多实体批次：multiEntry，用于 GIN 式查询的对等物。 */
  ENTITY_IDS: 'by_entityIds',
  /** 崩溃恢复扫描：找出所有 pendingApply 的记录。 */
  PENDING_APPLY: 'by_pendingApply',
} as const;

/** `state` store 的字段名。 */
export const STATE_FIELDS = {
  ENTITY_TYPE: 'entityType',
  ENTITY_ID: 'entityId',
  DATA: 'data',
  /** 最后作用于该实体的 op 的本地 seq，用于快速判断新鲜度。 */
  LAST_SEQ: 'lastSeq',
} as const;

/** 复合主键：state store 用 [entityType, entityId]。 */
export const STATE_KEY_PATH = [STATE_FIELDS.ENTITY_TYPE, STATE_FIELDS.ENTITY_ID] as const;

/** `meta` store：键值对。 */
export const META_FIELDS = {
  KEY: 'key',
  VALUE: 'value',
} as const;

/**
 * `meta` store 中的已知键。
 *
 * 这些是**同步协议的关键状态**，不是普通配置。
 */
export const META_KEYS = {
  /** 本设备的稳定 id。LWW 冲突决胜依据，**一经生成不可更改**。 */
  CLIENT_ID: 'clientId',
  /** 已从服务端拉取到的最大 serverSeq（同步游标）。 */
  LAST_SERVER_SEQ: 'lastServerSeq',
  /** 本地最大的 seq。 */
  LAST_LOCAL_SEQ: 'lastLocalSeq',
  /** 加密是否启用。 */
  ENCRYPTION_ENABLED: 'encryptionEnabled',
  /** 最后成功同步的时间。 */
  LAST_SYNCED_AT: 'lastSyncedAt',
} as const;

export type MetaKey = (typeof META_KEYS)[keyof typeof META_KEYS];

/** `meta` 记录形状。 */
export interface MetaRecord<T = unknown> {
  key: string;
  value: T;
}
