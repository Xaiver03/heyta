/**
 * heyta 的操作日志存储契约。
 *
 * 这个接口是**同步内核与存储实现之间的接缝**：
 * - 上方：`@heyta/sync-core` 的 `applyRemoteOperations` 等协调器
 * - 下方：IndexedDB / SQLite 等具体实现
 *
 * 它**继承** `RemoteOperationApplyStorePort`（sync-core 定义的崩溃安全存储契约），
 * 并补上 heyta 自己需要的操作。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么必须区分"写入"与"已应用"（这是整个设计的关键）：
 *
 *   远程 op 的落盘与"重放到 reducer"是**两个不同时刻**。如果只有一条路径，
 *   在两者之间崩溃就会导致：op 已落盘但没应用 → 永不再重放 → **静默丢数据**。
 *
 *   因此 `appendBatchSkipDuplicates(..., { pendingApply: true })` 先写入并打标，
 *   只有 reducer 提交被持久化后才 `markApplied`。启动时扫描 `pendingApply`
 *   即可发现"写了一半"的操作并重放。
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { Operation, RemoteOperationApplyStorePort } from '@heyta/sync-core';
import type { EntityType } from '@heyta/shared-schema';
import type { DbKeyRange } from './db.types';
import type { ApplyStatus, UploadStatus } from './stores';

/** 操作的来源。 */
export type OperationSource = 'local' | 'remote' | 'import';

/** 一条持久化后的操作记录。 */
export interface StoredOperation<TOperation extends Operation<string> = Operation> {
  /** 本地自增序号，主键。单调、无空洞。 */
  seq: number;
  op: TOperation;
  source: OperationSource;
  /**
   * 应用状态。**是字符串不是布尔** —— IndexedDB 不能索引布尔值，
   * 见 `stores.ts` 的 {@link ApplyStatus} 注释（这是踩过的坑）。
   */
  applyStatus: ApplyStatus;
  /** 上传状态。见 `stores.ts` 的 {@link UploadStatus}。 */
  uploadStatus: UploadStatus;
  /**
   * 服务端分配的序号（同步游标位置），上传成功后才有。
   *
   * ⚠️ **不能塞进 `op` 里**。`Operation` 是线协议类型，它的字段会被原样
   * 发给服务端；`op.seq` 不在契约里，写进去等于凭空造了个幽灵字段。
   * 服务端序号是**本地存储的元数据**，和 op 内容是两回事。
   *
   * 可选，因为老数据没有它 —— 见 AGENTS.md §3.3。
   */
  serverSeq?: number;
}

/** D1 checkpoint envelope. `state` is reducer-defined and structured-clone safe. */
export interface MaterializedCheckpoint {
  formatVersion: 1;
  coveredSeq: number;
  state: unknown;
  clock: Record<string, number>;
  appliedOpIds: string[];
  checksum: string;
}

/**
 * 一次导入追加的结果。
 *
 * 与 `appendLocal` 只返回 seq 不同：导入必须能**区分"写进去了"与"已经在了"**。
 * 一份导出被导入两次时，第二次全都被跳过 —— 若看不到这个差别，
 * 调用方只能报"成功"，而用户无从知道这次点击其实什么都没做。
 */
export interface ImportedAppendResult<TOperation extends Operation<string> = Operation> {
  /** 真正写进去的 op（按传入顺序）。 */
  appended: TOperation[];
  /** 因为 `opId` 已存在而跳过的 op。 */
  skipped: TOperation[];
  /** 与 `appended` 一一对应的 seq（单调递增、无空洞）。 */
  seqs: number[];
}

/**
 * 操作日志存储。
 *
 * 实现方必须保证：
 * - `appendBatchSkipDuplicates` **原子且幂等**（同一 opId 重复写入不得产生两条）
 * - 所有方法**可安全并发调用**（并发契约见 `DbAdapter`）
 * - 崩溃后，`pendingApply` 标记的记录**必须仍可被查出**
 */
export interface OpLogStore<
  TOperation extends Operation<string> = Operation,
> extends RemoteOperationApplyStorePort<TOperation> {
  // ── 本地写入 ─────────────────────────────────────────────

  /**
   * 追加本地操作。
   * 返回分配到的 seq（单调递增）。
   */
  appendLocal(ops: TOperation[]): Promise<number[]>;

  /**
   * 追加**导入**的操作（从一份导出文档还原本机数据）。
   *
   * 与 {@link appendLocal} 的差别只有两处语义，都很重要：
   *
   *   1. **`source` 记为 `'import'`。** 这不是"本地用户刚做了什么"，
   *      证据链上要能区分"这条是我写的"与"这条是从一份文件里搬回来的"。
   *   2. **不进上传队列。** 导入的 op 带着**原来那台设备**的 `clientId`，
   *      而服务端会逐条以 `INVALID_CLIENT_ID` 拒绝 `op.clientId` 与本机不符的 op
   *      （`server/src/sync/services/validation.service.ts`）。把它们排进上传队列
   *      只会得到一批**永久拒绝**、把"待上传"永远挂在那里 —— 而数据一条也上不去。
   *      所以导入的 op 一律记成 `uploaded`：**不是"它上云了"，是"这台设备不该、
   *      也不能上传它"**。这一点必须在界面上如实说明。
   *
   * 幂等：同一 `opId` 已存在时跳过（复用唯一索引，不做先查后写）。
   */
  appendImported(ops: TOperation[]): Promise<ImportedAppendResult<TOperation>>;

  // ── 读取 ────────────────────────────────────────────────

  /** 按本地 seq 区间读取操作（含下界、不含上界）。 */
  getOpsSince(
    sinceSeq: number,
    limit?: number,
    excludeClient?: string,
  ): Promise<StoredOperation<TOperation>[]>;

  /** 读取某个实体的全部操作，按 seq 升序。用于重放单个实体。 */
  getOpsForEntity(
    entityType: EntityType,
    entityId: string,
  ): Promise<StoredOperation<TOperation>[]>;

  /** 本地已分配的最大 seq。 */
  getLastLocalSeq(): Promise<number>;

  /** 全量操作（用于导出、快照）。**必须分页**，不要一次拉全库。 */
  getAllOps(range?: DbKeyRange, limit?: number): Promise<StoredOperation<TOperation>[]>;

  /**
   * 全库条数（**热区 + 归档**），不物化任何一行。
   *
   * 🔴 为什么接口上必须有它：在此之前，"库里有多少条 / 库里有没有东西"
   * 只能 `getAllOps().length` —— 把**含密文正文的全表**读进内存再数一下。
   * 三个真实消费者都付这份钱：备份还原的空库守卫、同步检查点的前置判定、
   * 以及界面上的待上传数。
   *
   * ⚠️ 必须**含归档**：归档的那些 op 仍然是这台设备的历史。只数热区会让
   * 「还原只允许空库」这条守卫在一台有归档历史的设备上放行，
   * 于是还原把数据写进一个**其实不空**的库。
   *
   * 与 {@link getAllOps} 的语义等价性由契约测试钉住（同一份夹具两条路必须同数）。
   */
  countAllOps(): Promise<number>;

  // ── 崩溃恢复 ─────────────────────────────────────────────

  /**
   * 找出所有"已落盘但未应用"的操作。
   *
   * 启动时调用。返回非空意味着上次运行在应用过程中崩溃了，
   * 必须先把这些 op 重放完，**再**接受新的同步。
   */
  findPendingApply(): Promise<StoredOperation<TOperation>[]>;

  /**
   * 「有没有已落盘未应用的 op」的**便宜版本**（条数，不物化行）。
   *
   * 检查点前置判定只需要一个 `> 0`，而它以前把整条队列（含密文正文）读进内存
   * 再数。语义等价性由契约测试与 {@link findPendingApply} 对账。
   */
  countPendingApply(): Promise<number>;

  /**
   * 待上传的本地 op（离线队列），按本地 seq 升序。
   *
   * ⚠️ 与 {@link findPendingApply} 是**两个不同的队列**，不要混用：
   *   - pendingApply：远程来的、已落盘但还没应用 → 崩溃恢复消费
   *   - pendingUpload：本地产生的、还没上传给服务端 → 同步客户端消费
   * 一条 op 可能同时是"待应用"和"不需要上传"（远程 op），
   * 也可能是"已应用"但"待上传"（本地 op）。这就是为什么它们是两个字段。
   */
  findPendingUpload(): Promise<StoredOperation<TOperation>[]>;

  /**
   * 待上传队列的条数（不物化行）—— 界面上那个「待上传 N 项」徽标要用它。
   *
   * 🔴 它与 `engine.getPendingUpload().length` 的**等价性不是免费的**：
   * 引擎那边会再 `filter(r => r.source === 'local')`。之所以可以直接数索引，
   * 是因为 `uploadStatus === 'pending'` 只在**本地写入**那一处被赋值
   * （`db-op-log-store.ts` 里 `source === 'local' ? 'pending' : 'uploaded'`）。
   * 那条不变量由本包的契约测试钉住 —— 谁哪天让远端 op 也进 pending，
   * 这个计数就会开始多报，而那正是"徽标说谎"的形状。
   */
  countPendingUpload(): Promise<number>;

  /** 标记 op 已上传，并回写服务端分配的 seq。返回更新条数。 */
  markUploaded(serverSeqsByOpId: ReadonlyMap<string, number>): Promise<number>;

  /**
   * 丢弃待上传的本地 op（把它移出上传队列，但**不删除**）。
   *
   * 用于冲突解决判定为"远端胜出"时：本地这条不该再上传，
   * 但 op-log 是事实来源，**不能物理删除** —— 删了就无法解释
   * "为什么本地曾经是这个值"，重放也会与其它设备不一致。
   */
  discardPendingUpload(opIds: string[]): Promise<number>;

  /**
   * 把「服务端**永久拒绝**」的 op 移出上传队列（**不删除** op）。
   *
   * 与 {@link discardPendingUpload} 的区别只在**语义与可观测性**上：
   * `discardPendingUpload` 用于"我们主动决定不再上传这条"（冲突里选了保留远端），
   * 那确实等同于"本机对这条已经没有未完成的上传意图"；
   * 而这里记的是**服务端说它永远不会接受这条** —— 数据没上云。
   *
   * 🔴 为什么必须在存储层区分，而不是复用一个 `'uploaded'`：
   *   1. 界面上的"待上传数"与"已同步"会因此说假话；
   *   2. 这条缺陷的**判据**要能观察到它 —— 如果拒绝态和成功态长得一样，
   *      验收脚本就只能断言"队列空了"，而"队列空了"在**数据被静默丢弃**时同样成立。
   *
   * 为什么不能干脆重试到底（像原来那样抛错）：那会让设备**永久卡死** —— 每次同步
   * 都重传这条、每次都被拒，而抛错发生在下载之前，于是**这台设备再也拉不到任何数据**。
   */
  markRejected(opIds: string[]): Promise<number>;

  // ── 压缩 / 归档 ──────────────────────────────────────────

  /**
   * 把 `upToSeq` 之前的操作移入归档 store。
   *
   * 前提：这些 op 的效果已经被快照或 state 完整捕获。
   * 返回被归档的条数。
   */
  archiveUpTo(upToSeq: number): Promise<number>;

  // ── 簿记 ────────────────────────────────────────────────

  /** 读取同步游标（已拉取到的最大 serverSeq）。 */
  getLastServerSeq(): Promise<number>;

  /** 写入同步游标。 */
  setLastServerSeq(seq: number): Promise<void>;

  /** Optional materialized-state checkpoint hooks (older hosts may omit them). */
  readCheckpoint?(): Promise<MaterializedCheckpoint | undefined>;
  writeCheckpoint?(checkpoint: MaterializedCheckpoint): Promise<void>;

  /**
   * Read the durable server-observed causal frontier.
   *
   * This is deliberately separate from the deletable materialized checkpoint.
   * Older storage hosts may omit the optional hook; implementations that expose
   * it must return an empty clock when no frontier has been recorded.
   */
  readObservedClock?(): Promise<Record<string, number>>;

  /** Merge a server-observed causal frontier using component-wise max. */
  mergeObservedClock?(clock: Record<string, number>): Promise<void>;

  /** Read the durable one-way marker that some history could not be recovered. */
  hasIncompleteHistory?(): Promise<boolean>;

  /** Permanently mark history as incomplete; there is intentionally no clear hook. */
  markHistoryIncomplete?(): Promise<void>;
  /**
   * 读 `STORES.META` 里的一个键（原样返回存的值）。
   *
   * 🔴 为什么把 META 的通用读法开在**这个接口**上，而不是让调用方自己拿 `DbAdapter`：
   *   web 的默认存储路径是 **Worker + OPFS SQLite**，桌面壳那条是**壳里的 SQLite** ——
   *   这两条路上**页侧根本没有 `DbAdapter`**，只有一个 `OpLogStore` 代理。
   *   如果这个能力只存在于 `DbAdapter`，"公共事实缓存在 web 上能用"就会**静默地假**
   *   （ADR-0052 §2.5 点名要进 `STORES.META`，而三条后端路径都得进得了）。
   *   开在接口上之后，桥上的转发列表是**显式列出的**（见 `oplog-worker-bridge.ts` 那条
   *   "不用 Proxy"的理由），漏转发会在**第一次调用时响亮报错**，不是返回空值。
   *
   * 键名只在 `META_KEYS` 定义一次；这里不认识具体键，避免把语义复制进存储层。
   */
  getMetaValue(key: string): Promise<string | number | undefined>;

  /** 写 `STORES.META` 里的一个键。值只允许 `string | number`（要过结构化克隆）。 */
  setMetaValue(key: string, value: string | number): Promise<void>;
}

/** 存储层的失败原因，供上层区分处理。 */
export enum OpLogStoreErrorCode {
  /** 同一 opId 被写入了两次（调用方 bug 或恶意输入）。 */
  DUPLICATE_OP_ID = 'DUPLICATE_OP_ID',
  /** seq 出现空洞 —— 说明发生了非原子写入或数据损坏。 */
  SEQ_GAP = 'SEQ_GAP',
  /** 事务嵌套调用。 */
  NESTED_TRANSACTION = 'NESTED_TRANSACTION',
  /** 存储不可用（配额耗尽、被浏览器回收等）。 */
  STORAGE_UNAVAILABLE = 'STORAGE_UNAVAILABLE',
  /** 归档边界没有被一个完整、可校验的物化检查点覆盖。 */
  ARCHIVE_REQUIRES_CHECKPOINT = 'ARCHIVE_REQUIRES_CHECKPOINT',
}

export class OpLogStoreError extends Error {
  constructor(
    public readonly code: OpLogStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OpLogStoreError';
  }
}
