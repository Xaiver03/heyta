/**
 * heyta 本地数据库的 store 与索引定义。
 *
 * ⚠️ 这是**持久化结构**，属于"不可逆层"——一旦发布就很难改。
 * 改动前请读 `packages/shared-schema/src/schema-version.ts` 的版本政策。
 */

import type { Operation } from '@heyta/sync-core';

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

/**
 * `ops` store 的字段名。
 *
 * 🔴 **这些常量必须和 `@heyta/sync-core` 的 `Operation` 契约字段名严格一致。**
 *
 * 我第一版把它们写成普通字符串（`OP_ID: 'opId'`），而 `Operation` 的字段其实叫
 * `id`。结果是唯一索引的 keyPath 指向一个不存在的字段 ——
 * **IndexedDB 对 undefined 不建索引条目，不报错**，于是去重完全失效：
 * 同一个 op 可以被无限写入，而所有测试之外的地方都看不出来。
 *
 * 修法不是改对字符串就完事，而是**让它们在类型层面被约束**：
 * 下面用 `satisfies` 把每个字段名绑定到 `Operation` 的 key，
 * 写错字段名会**编译失败**，而不是等到运行时静默失效。
 */
export const OP_FIELDS = {
  /**
   * ⚠️ **本地**自增序号。
   *
   * 注意与 `Operation.seq`（**服务端**序号）区分：两者名字一样但含义不同。
   * 本常量指顶层 `StoredOperation.seq`（存储记录的主键），
   * 不是嵌套的 `op.seq`。索引 keyPath 因此写顶层 `'seq'`。
   */
  SEQ: 'seq',
  /** 操作业务 id（客户端生成的 UUID v7），**唯一索引** —— 用于去重。 */
  OP_ID: 'id',
  ENTITY_TYPE: 'entityType',
  ENTITY_ID: 'entityId',
  /** 多实体批次操作涉及的全部实体 id，**multiEntry 索引**。 */
  ENTITY_IDS: 'entityIds',
  PAYLOAD: 'payload',
  VECTOR_CLOCK: 'vectorClock',
  CLIENT_ID: 'clientId',
  CLIENT_TIMESTAMP: 'timestamp',
  SCHEMA_VERSION: 'schemaVersion',
  /**
   * 上传状态，**字符串不是布尔**。
   *
   * 同一个理由再踩一次就太蠢了：IndexedDB 不能索引布尔值 ——
   * `true` 不是合法的 IDB key，索引里不会产生条目，查询恒返回空**且不报错**。
   */
  UPLOAD_STATUS: 'uploadStatus',
  /**
   * 🔴 应用状态。**必须用字符串，不能用布尔。**
   *
   * 为什么：**IndexedDB 不允许布尔值作为键** —— `true` 不是合法的 IDB key，
   * 所以对布尔字段建索引时，索引条目会被**静默跳过**（不报错，只是查不到）。
   * 我第一版就是用 `pendingApply: true` 建索引，结果 `findPendingApply()`
   * 永远返回空数组 —— 崩溃恢复完全失效，而且没有任何错误提示。
   *
   * 取值见 {@link ApplyStatus}。
   */
  APPLY_STATUS: 'applyStatus',
} as const;

/**
 * 应用状态机。
 *
 *   pending  —— 已落盘，等待 reducer 提交（崩溃恢复要扫这个）
 *   applied  —— 已应用，安全
 *   failed   —— 应用失败，已隔离
 */
export type ApplyStatus = 'pending' | 'applied' | 'failed';

/**
 * 上传状态。
 *
 * `pending`   —— 尚未成功上传给服务端（离线队列就是它）
 * `uploaded`  —— 服务端已接受
 * `rejected`  —— 服务端**永久拒绝**，已移出队列
 *
 * 为什么不用 `op.seq === 0` 表示"没上传"：那样无法**建索引**，
 * 每次同步都要全表扫描。而且服务端理论上可能分配 seq 0。
 * 显式状态比特判可靠。
 *
 * 🔴 **`rejected` 不能并进 `uploaded`。**
 *
 * 服务端可能**永久拒绝**一条 op：`INVALID_CLIENT_ID` 说明这条 op 根本不属于本机
 * （比如本地库里混进了另一台设备的残留 op），`INVALID_OP_ID` 说明这个 id 已经被
 * 另一个 op 占用。这类 op 重试多少次都不会被接受，所以**必须移出待上传队列** ——
 * 否则它会每次同步都被重传、每次都被拒，设备永远卡在"同步失败 + 待上传数不减"。
 *
 * 但它**不是上传成功**。标成 `uploaded` 等于说"这条数据在云上"，而那是假话：
 * 待上传数会归零，数据却哪都没去，用户再也没机会知道它丢了。
 * 所以它是**第三种状态**：不在队列里，也不声称成功。
 */
export type UploadStatus = 'pending' | 'uploaded' | 'rejected';

export const UPLOAD_STATUSES: readonly UploadStatus[] = ['pending', 'uploaded', 'rejected'];

/**
 * 把上面那些「指向 Operation 内部字段」的常量在类型层面钉死。
 *
 * 这一句的价值：任何字段名拼错、或上游改了 `Operation` 的形状，
 * 都会在 `pnpm -r typecheck` 阶段报错，而不是变成
 * 「索引静默失效 → 去重失效 → 数据重复」这类线上事故。
 */
type OpFieldName = keyof Operation;
const _opFieldShape = {
  OP_ID: OP_FIELDS.OP_ID,
  ENTITY_TYPE: OP_FIELDS.ENTITY_TYPE,
  ENTITY_ID: OP_FIELDS.ENTITY_ID,
  ENTITY_IDS: OP_FIELDS.ENTITY_IDS,
  PAYLOAD: OP_FIELDS.PAYLOAD,
  VECTOR_CLOCK: OP_FIELDS.VECTOR_CLOCK,
  CLIENT_ID: OP_FIELDS.CLIENT_ID,
  CLIENT_TIMESTAMP: OP_FIELDS.CLIENT_TIMESTAMP,
  SCHEMA_VERSION: OP_FIELDS.SCHEMA_VERSION,
} satisfies Record<string, OpFieldName>;
void _opFieldShape;

/** 索引名称。 */
export const OP_INDEXES = {
  /** 唯一：同一 op 不得写入两次。 */
  OP_ID: 'by_opId',
  /** 按实体查询：['entityType','entityId'] 复合索引。 */
  ENTITY: 'by_entity',
  /** 多实体批次：multiEntry，用于 GIN 式查询的对等物。 */
  ENTITY_IDS: 'by_entityIds',
  /** 崩溃恢复扫描：找出所有 applyStatus='pending' 的记录。 */
  PENDING_APPLY: 'by_applyStatus',
  /** 按上传状态查待同步的 op（离线队列）。 */
  PENDING_UPLOAD: 'by_uploadStatus',
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
 * 原先这一节写的是"这些是**同步协议的关键状态**，不是普通配置"。那句话到今天
 * 已经窄了一格：`PUBLIC_FACTS_*` 不是同步协议状态，它也不是用户配置 ——
 * 它是**部署方下发的公共事实**的本地缓存（ADR-0052 §2.5）。
 *
 * 🔴 它进这里而不进 op-log 的理由（ADR-0052 原文）：这条下行不是"用户的某个意图"，
 * 写进 op-log 会让另一台设备回放它时产生一个**从未发生过的用户动作**，违反
 * AGENTS §3.4 那条"被回放的 op 不得再触发副作用"。所以它也不跨设备、不 bump
 * `CURRENT_SCHEMA_VERSION`（AGENTS §3.3）。
 *
 * 值的形状：`DbAdapter.put(store, value: unknown, key?)` 本来就吃得下字符串，
 * `resolveClientId()`（`packages/app-host/src/host.ts`）就是往这里放字符串的先例。
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
  /** 上一次成功拉到的公共事实响应体（`HolidayAdjustmentsResponse` 的 JSON）。 */
  PUBLIC_FACTS_JSON: 'publicFactsJson',
  /** 它对应的版本令牌（服务端 ETag 的候选值），条件请求时原样回传。 */
  PUBLIC_FACTS_ETAG: 'publicFactsEtag',
  /** 那次拉取的本地毫秒时间戳（只用于"缓存多旧"，不参与任何裁决）。 */
  PUBLIC_FACTS_FETCHED_AT: 'publicFactsFetchedAt',
} as const;

export type MetaKey = (typeof META_KEYS)[keyof typeof META_KEYS];

/** `meta` 记录形状。 */
export interface MetaRecord<T = unknown> {
  key: string;
  value: T;
}
