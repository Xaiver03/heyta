/**
 * op-log 编排引擎
 * =================
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 **本引擎的 `dispatch()` 是本地状态的唯一写入口（P1 决策 D4）。**
 *
 * UI 不得绕开它直接改状态。理由不是洁癖，而是三条具体后果：
 *
 *   1. 绕过去 = 这次变更**不会进 op-log** = 永远不会同步到其它设备，
 *      而且本地看起来完全正常。用户会在第二台设备上发现数据不见了。
 *   2. 绕过去 = 没有向量时钟记录 = 后续与该实体的并发变更会被判成
 *      "无冲突"，静默覆盖掉这次改动。
 *   3. 绕过去 = 崩溃恢复无法重放它，重启即丢。
 * ═════════════════════════════════════════════════════════════════════════
 *
 * 本引擎**编排** sync-core 的原语（向量时钟比较/合并/限长），不重新实现它们。
 */

import type { EntityType } from '@heyta/shared-schema';
import {
  hasTaskBatchMarker,
  parseTaskBatchOperation,
  taskBatchOperationId,
  hasTaskPriorityBatchMarker,
  parseTaskPriorityBatchOperation,
  hasTaskRepeatCompletionMarker,
  parseTaskRepeatCompletionOperation,
  validateReminderOwnerOperation,
  type HeytaTaskBatchPayload,
} from '@heyta/shared-schema';
import type { Operation, VectorClock } from '@heyta/sync-core';
import {
  OpType,
  VectorClockComparison,
  compareVectorClocks,
  mergeVectorClocks,
} from '@heyta/sync-core';
import {
  checkpointChecksum,
  isValidCheckpoint,
  type OpLogStore,
} from '@heyta/storage';

import {
  applyOperation,
  bucketFor,
  emptyState,
  replayOperations,
  deserializeMaterializedState,
  serializeMaterializedState,
  isFullStateOperation,
  type FullStatePayload,
  type MaterializedState,
} from './state.js';
import {
  buildHistoryEntry,
  checkInverseStillValid,
  historyTargetOf,
  HISTORY_LIMIT,
  type HistoryEntry,
  type HistoryState,
  type UndoOutcome,
} from './history.js';

/** 一次本地意图 → 一条 op。 */
export interface OpIntent {
  entityType: EntityType;
  entityId: string;
  /**
   * ⚠️ 用 sync-core 的 `OpType`，**不要**自造 'CREATE'/'UPDATE'/'DELETE'。
   *
   * 我第一版就是这么写的，而且单测全绿 —— 因为我按自己的理解写了 mock。
   * 真实服务端的词表是 `CRT`/`UPD`/`DEL`（见 SUPER_SYNC_OP_TYPES），
   * 它逐条以 `INVALID_OP_TYPE` 拒绝了**每一个** op。
   * 两套并行词表迟早会漂移；线协议词表只有一份，就该只有一份定义。
   */
  opType: OpType;
  payload?: unknown;
  /** 一次意图涉及多个实体时列出全部（单次操作，不 fan-out）。 */
  entityIds?: string[];
}

/**
 * Synchronous read/decide step executed inside the engine's mutation queue.
 * The builder must not await or dispatch; its optional intent is committed by
 * the queue immediately after the decision is made against the current state.
 */
export type CheckedDispatchBuilder<T> = (
  state: MaterializedState,
) => { intent?: OpIntent; value: T };

export interface OpLogEngineOptions {
  store: OpLogStore<Operation<string>>;
  /** 本设备稳定 id。LWW 决胜依据，**一经生成不可更改**。 */
  clientId: string;
  /** 读取物化状态的初始快照（通常来自 STATE store）。 */
  initialState?: MaterializedState;
  /** 时间源。注入以便测试；生产用 Date.now。 */
  now?: () => number;
  /** op id 生成器。注入以便测试确定性。 */
  nextOpId?: () => string;
}

export interface DispatchResult {
  ops: Operation<string>[];
  seqs: number[];
}

export interface RemoteApplyResult {
  applied: Operation<string>[];
  skipped: number;
  /** 被判为并发、且我们的版本更旧而被远端覆盖的实体。 */
  overwritten: Array<{ entityType: string; entityId: string }>;
}

/** {@link OpLogEngine.importOperations} 的结果。 */
export interface ImportOpsResult {
  /** 真正写进日志的 op 条数。 */
  imported: number;
  /** 因为 `opId` 已存在而跳过的条数（同一份导出导入两次时全在这里）。 */
  skipped: number;
}

/**
 * Clone the JSON-shaped values crossing the op-log boundary.
 *
 * An intent can sit in the serialized write queue before it is persisted. A
 * shallow copy would still let caller-owned arrays (notably tag ids) mutate
 * the eventual op and reducer state during that wait.
 */
function cloneBoundaryValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneBoundaryValue(item)) as T;
  if (value !== null && typeof value === 'object') {
    // Object.fromEntries creates own data properties, so a JSON key named
    // `__proto__` cannot invoke the legacy prototype setter on `{}`.
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneBoundaryValue(item)]),
    ) as T;
  }
  return value;
}

function cloneIntent(intent: OpIntent): OpIntent {
  return cloneBoundaryValue(intent);
}

function cloneOperation<T extends Operation<string>>(op: T): T {
  return cloneBoundaryValue(op);
}

/**
 * 栈里最近一条**真的能撤**的条目。
 *
 * 不能只看 `length > 0`：栈顶可能是一条批量/快照写入（`inverse === undefined`），
 * 那样 `canUndo` 会亮着、按下去却什么也不发生 —— 一个必然被点穿的假按钮。
 */
function lastUndoable(stack: HistoryEntry[]): HistoryEntry | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = stack[index];
    if (entry !== undefined && entry.inverse !== undefined) return entry;
  }
  return undefined;
}

export class OpLogEngine {
  private state: MaterializedState;
  /** 本地向量时钟。每次本地写入递增自己的分量。 */
  private clock: VectorClock = {};
  /**
   * 已经应用过的 op id 集合。
   *
   * 这是**幂等的第一道闸门**：重放/重复投递同一个 op 时直接短路。
   * 不靠 reducer 去重，因为 reducer 只保证"同一个实体"的先后，
   * 分不清"这条 op 我处理过没有"。
   */
  private appliedOpIds = new Set<string>();
  private opCounter = 0;
  private appliedSeq = 0;
  private checkpointSeq = 0;
  private mutationQueue: Promise<unknown> = Promise.resolve();
  /**
   * 会话内撤销/重做栈。
   *
   * 🔴 **内存，不落盘。** 撤销是"刚才那一下"的便利，不是审计日志；
   * 重启之后靠回收站（墓碑）兜底。把它落盘会引入一个新的、需要清理的持久面，
   * 而它的价值只覆盖本次会话。
   */
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(work);
    this.mutationQueue = result.catch(() => undefined);
    return result;
  }
  /** Checkpoint cadence; zero disables automatic checkpoint writes. */
  private readonly checkpointEvery: number;

  constructor(private readonly options: OpLogEngineOptions) {
    this.state = options.initialState ?? emptyState();
    this.checkpointEvery = 250;
  }

  private async writeCheckpoint(coveredSeq: number): Promise<void> {
    const write = this.options.store.writeCheckpoint;
    if (write === undefined || coveredSeq <= 0) return;
    // A later successful dispatch does not prove that an earlier persisted
    // remote op was applied. Keep the previous cache until that hole recovers.
    const pending = await this.options.store.findPendingApply();
    if (pending.some((row) => row.seq <= coveredSeq && !this.appliedOpIds.has(row.op.id))) return;
    const base = {
      formatVersion: 1 as const,
      coveredSeq,
      state: serializeMaterializedState(this.state),
      clock: this.getClock(),
      appliedOpIds: [...this.appliedOpIds],
    };
    await write.call(this.options.store, { ...base, checksum: checkpointChecksum(base) });
    this.checkpointSeq = coveredSeq;
  }

  private async maybeCheckpoint(coveredSeq: number): Promise<void> {
    if (this.checkpointEvery > 0 && coveredSeq - this.checkpointSeq >= this.checkpointEvery) {
      try {
        await this.writeCheckpoint(coveredSeq);
      } catch (error) {
        // Checkpoints accelerate recovery but never make a committed op fail.
        console.warn('[heyta] checkpoint write skipped; next startup will replay the log', error);
      }
    }
  }

  /** Explicit checkpoint hook for maintenance and tests. */
  checkpoint(): Promise<void> {
    return this.serialize(() => this.writeCheckpoint(this.appliedSeq));
  }

  /** Queue a causal maintenance snapshot only after the local upload queue drains. */
  createSyncCheckpoint(): Promise<DispatchResult> {
    return this.serialize(async () => {
      if (this.options.store.hasIncompleteHistory === undefined ||
          this.appliedSeq !== await this.options.store.getLastLocalSeq() ||
          await this.options.store.hasIncompleteHistory()) {
        throw new Error('Sync checkpoint requires completely materialized history');
      }
      // 🔴 队列判定只需要"空不空"，所以走索引计数。
      // 之前这里是 `findPendingUpload().length > 0` —— 把整条待上传队列
      // （含密文正文）物化进内存，只为了回答一个 `> 0`。
      // 检查点会在每次同步后尝试，于是这个成本是**周期性**的。
      // ⚠️ 下面那处 `getAllOps()` **不是**同一件事：那是维护扫描，
      // 它真的要逐条看 `source` / `uploadStatus`，不能换成计数。
      if ((await this.options.store.countPendingUpload()) > 0 ||
          (await this.options.store.countPendingApply()) > 0) {
        throw new Error('Sync checkpoint requires drained upload and apply queues');
      }
      // An older reducer may retain future entities in the log without knowing
      // how to materialize them. Never let its snapshot authorize their erasure.
      // This scan is explicit maintenance work, not part of cold-start hydration.
      for (const { op, source, uploadStatus } of await this.options.store.getAllOps()) {
        // Maintenance cannot turn a local-only import or a rejected intention
        // into newly published data. Explicit backup restoration is a different
        // user action. Stale maintenance snapshots contain no new intentions.
        if (source === 'import' || (uploadStatus === 'rejected' && !isFullStateOperation(op))) {
          throw new Error('Sync checkpoint requires server-accepted history, not local-only or rejected data');
        }
        if (!isFullStateOperation(op) && bucketFor(this.state, op.entityType) === undefined) {
          throw new Error(`Sync checkpoint cannot represent entity type: ${op.entityType}`);
        }
      }
      const payload: FullStatePayload = {
        isFullState: true,
        heytaStateVersion: 1,
        state: serializeMaterializedState(this.state),
        repairBaseServerSeq: await this.options.store.getLastServerSeq(),
      };
      return this.dispatchLocked(
        { entityType: 'ALL', entityId: '*', opType: OpType.Repair, payload },
        undefined,
        // 维护快照不是用户意图：不进撤销栈（进了就会把整库回滚当成一次撤销）。
        false,
      );
    });
  }

  /** Preserve every causal dimension; resource limits must reject explicitly. */
  private trimClock(clock: VectorClock): VectorClock {
    // Causal history is lossless. The old top-K helper silently deleted client
    // dimensions and could make a valid offline write permanently concurrent
    // with the server head. Resource limits belong at ingress (explicit reject),
    // never in this stateful clock merge.
    return { ...clock };
  }

  // ── 读 ──────────────────────────────────────────────────

  /** 当前物化状态。**只读** —— 调用方不得直接改它。 */
  getState(): MaterializedState {
    return this.state;
  }

  /** 本设备的 clientId。同步客户端需要它（协议要求每个请求带上）。 */
  getClientId(): string {
    return this.options.clientId;
  }

  /**
   * 待上传的本地 op（离线队列）。
   *
   * 直接读存储的上传状态索引，**不是**在内存里维护一份列表 ——
   * 内存列表在崩溃后会丢，而"哪些 op 还没上传"恰恰是崩溃后最重要的信息。
   */
  async getPendingUpload(): Promise<Operation<string>[]> {
    const rows = await this.options.store.findPendingUpload();
    return rows.filter((r) => r.source === 'local').map((r) => r.op);
  }

  /**
   * 待上传队列的**条数**，不物化任何 op。
   *
   * 🔴 界面上那个「待上传 N 项」徽标以前调的是 `getPendingUpload().length` ——
   * 每次刷新都把整条队列（含密文正文）读进内存，只为了显示一个数字。
   * 计数与上面那个列表的等价性前提是「`uploadStatus==='pending'` 只可能出现在
   * `source==='local'` 的行上」，它由 `@heyta/storage` 的契约测试钉住，
   * 不是靠这句注释自称成立。
   */
  async countPendingUpload(): Promise<number> {
    return this.options.store.countPendingUpload();
  }

  /**
   * 标记 op 已上传，并记录服务端分配的序号。
   *
   * 由同步客户端在上传成功后调用。**上传成功与本地记录必须一致**：
   * 上传了但没标记，下次会重复上传（服务端会去重，但浪费配额）；
   * 标记了但没上传，数据永远不上云 —— 后者严重得多。
   */
  async markUploaded(serverSeqsByOpId: ReadonlyMap<string, number>): Promise<void> {
    await this.options.store.markUploaded(serverSeqsByOpId);
  }

  /**
   * 把一条已有 op **重新派发**成一条新 op（冲突判定为本地胜出时用）。
   *
   * 为什么必须新建而不是改旧 op：
   *   1. op 是**不可变**的 —— 它是事实日志，改一条已落盘的 op 会让
   *      所有已重放它的设备与我们对不上。
   *   2. 新 op 会被打上**当前**时钟。而下载阶段已经把远程时钟并进来了，
   *      所以新 op 天然压过服务端的既有版本，重传即被接受。
   *
   * 只有实体级意图（entityType/entityId/opType/payload）被保留，
   * 这是"一个用户意图 = 一个 op"的体现：重新表达同一个意图。
   */
  async redispatch(op: Operation<string>): Promise<DispatchResult> {
    if (op.entityId === undefined) {
      throw new Error(
        `无法重新派发缺少 entityId 的 op（${op.id}）—— 多实体 op 需要显式意图`,
      );
    }

    return this.dispatch({
      entityType: op.entityType as EntityType,
      entityId: op.entityId,
      opType: op.opType as OpType,
      payload: op.payload,
      ...(op.entityIds !== undefined ? { entityIds: op.entityIds } : {}),
    });
  }

  /** 丢弃待上传的本地 op（冲突判定为远端胜出时用）。 */
  async discardPendingUpload(opIds: string[]): Promise<void> {
    await this.options.store.discardPendingUpload(opIds);
  }

  /**
   * 把「服务端永久拒绝」的 op 移出上传队列（**不删除** op、**不标成已上传**）。
   *
   * 与 {@link discardPendingUpload} 是两件事，别合并：那个表达"我们不再想上传它"，
   * 这个表达"服务端说它永远不会被接受"。混成一个会让"数据在云上吗"无法回答。
   */
  async markRejected(opIds: string[]): Promise<void> {
    await this.options.store.markRejected(opIds);
  }

  /** 按 op id 取回本地 op（用户手动解决冲突时用它重新派发）。 */
  async getOpById(opId: string): Promise<Operation<string> | undefined> {
    const all = await this.options.store.getAllOps();
    return all.find((r) => r.op.id === opId)?.op;
  }

  /**
   * 读**完整**本地 op-log（只读，不改任何状态）。
   *
   * 备份**导出**要用它（`app-host` 的 `export-dump`）。
   * ⚠️ 还原的「目标必须真的是空库」判定**不再**用它 —— 那个只需要一个数，
   * 见 {@link countStoredOps}。留在这里是因为导出真的要把每一条都带走。
   */
  async getAllOps(): Promise<Operation<string>[]> {
    const all = await this.options.store.getAllOps();
    return all.map((r) => r.op);
  }

  /**
   * 本地日志的**条数**（热区 + 归档），不物化任何一行。
   *
   * 🔴 存在的理由：空库守卫以前是 `getAllOps().length > 0` —— 为了回答
   * "这台设备有没有数据"，把整库含密文正文读进内存。在备份还原那个场景里，
   * 用户点下"还原"的那一次会把**他正要保护的那份数据**整个搬一遍。
   * 计数必须**含归档**，否则有归档历史的设备会被判成空库（见接口上的注释）。
   */
  async countStoredOps(): Promise<number> {
    return this.options.store.countAllOps();
  }

  /** 取某实体的全部本地 op（冲突解决要用它比对时间戳）。 */
  async getOpsForEntity(
    entityType: EntityType,
    entityId: string,
  ): Promise<Operation<string>[]> {
    const rows = await this.options.store.getOpsForEntity(entityType, entityId);
    return rows.map((r) => r.op);
  }

  /** 当前向量时钟快照。 */
  getClock(): VectorClock {
    return { ...this.clock };
  }

  /**
   * Observe a server-provided causal frontier (for example the clock attached
   * to a compacted snapshot). The frontier is evidence about history that may
   * no longer be present in the downloaded page; it must advance the next
   * local op's clock even when no individual op was applied.
   */
  observeRemoteClock(clock: VectorClock): void {
    this.clock = this.trimClock(mergeVectorClocks(this.clock, clock));
  }

  /** Persist snapshot-only history before the download cursor can advance. */
  observeRemoteClockDurably(clock: VectorClock): Promise<void> {
    return this.serialize(async () => {
      if (this.options.store.mergeObservedClock === undefined) {
        throw new Error('Storage cannot persist a server causal frontier');
      }
      await this.options.store.mergeObservedClock(clock);
      this.observeRemoteClock(clock);
    });
  }

  /** A skipped encrypted delta must never be erased by a future server drain. */
  markHistoryIncomplete(): Promise<void> {
    return this.serialize(async () => {
      if (this.options.store.markHistoryIncomplete === undefined) {
        throw new Error('Storage cannot persist incomplete sync history');
      }
      await this.options.store.markHistoryIncomplete();
    });
  }

  // ── 写（唯一入口） ───────────────────────────────────────

  /**
   * 派发一个本地意图。
   *
   * 顺序很关键：**先落盘，再改内存状态。**
   * 反过来的话，落盘失败时内存已经变了 —— 用户看到改动生效，
   * 刷新后消失，而且 op-log 里没有痕迹（无法恢复）。
   */
  dispatch(intent: OpIntent): Promise<DispatchResult> {
    const snapshot = cloneIntent(intent);
    return this.serialize(() => this.dispatchLocked(snapshot));
  }

  /** Host-owned local preconditions run under the same serialization as writes.
   * Recovery of an already committed intent does not rerun creation preconditions.
   */
  dispatchValidated(intent: OpIntent, validate: (state: MaterializedState) => void): Promise<DispatchResult> {
    const snapshot = cloneIntent(intent);
    return this.serialize(() => this.dispatchLocked(snapshot, validate));
  }

  /**
   * Run a synchronous state-dependent decision and, when requested, commit its
   * intent without leaving the mutation queue. This is the CAS-like primitive
   * for actions whose payload depends on the latest materialized value.
   */
  dispatchChecked<T>(build: CheckedDispatchBuilder<T>): Promise<T> {
    return this.serialize(async () => {
      const result = build(this.state);
      if (result.intent === undefined) return result.value;
      await this.dispatchLocked(result.intent);
      return result.value;
    });
  }

  // ── 撤销 / 重做（会话内） ─────────────────────────────────

  /**
   * 撤销最近一次**可撤销**的本地写入。
   *
   * 走的是与普通写入完全相同的串行队列：撤销不是"改内存"，它是**一条新的 op**。
   * 因此它也进 op-log、也进上传队列、也参与向量时钟 —— 别的设备会看到"撤销"
   * 这个事实，而不是本地状态与日志对不上。
   */
  undo(): Promise<UndoOutcome> {
    return this.serialize(() => this.stepHistory('undo'));
  }

  /** 重做最近一次被撤销的写入（撤销的撤销 = 再写一条反向 op）。 */
  redo(): Promise<UndoOutcome> {
    return this.serialize(() => this.stepHistory('redo'));
  }

  /**
   * 栈的只读快照。界面用它决定 ⌘Z 是否可用、以及那句"刚刚做了什么"。
   *
   * ⚠️ 不可撤销的条目（批量/快照）**不参与** canUndo 判定：把它们算成"可撤销"
   * 会让按钮亮着而按下去什么也不发生。
   */
  historyState(): HistoryState {
    const undo = lastUndoable(this.undoStack);
    const redo = lastUndoable(this.redoStack);
    return {
      canUndo: undo !== undefined,
      canRedo: redo !== undefined,
      ...(undo !== undefined ? { undo: historyTargetOf(undo.intent, undo.timestamp) } : {}),
      ...(redo !== undefined ? { redo: historyTargetOf(redo.intent, redo.timestamp) } : {}),
    };
  }

  /** 清空历史（账号切换 / 库销毁 / 测试收尾）。**不动 op-log 本身。** */
  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * 撤销栈的可序列化快照（R19：让 ⌘Z 活过刷新）。
   *
   * ## 为什么这件事是安全的
   *
   * 栈里每一条只有 `{opId, intent, inverse, timestamp}`，全都是普通对象 ——
   * `intent` / `inverse` 就是 `dispatchIntent()` 收到的那个结构，本来就是数据。
   * **它不是审计日志**：`HISTORY_LIMIT` 仍然只保留最近的 100 条。
   *
   * ## 为什么恢复不会撤回"别人改过的"东西
   *
   * 恢复的条目在真正撤销时仍要过 `checkInverseStillValid`：
   * 实体没了 / 被别的设备改过 ⇒ 返回 `stale`，条目**留在栈上**并如实告诉用户。
   * 所以"刷新前算出的反向意图"在刷新后变旧，是**被检查覆盖**的情形，不是漏洞。
   *
   * ⚠️ 调用方负责把快照和**同一个库**绑在一起（账号切换、库销毁后不许再恢复）——
   * 引擎不知道 `dbName`，也不想在这一层猜。
   */
  exportHistory(): { undo: HistoryEntry[]; redo: HistoryEntry[] } {
    return { undo: [...this.undoStack], redo: [...this.redoStack] };
  }

  /**
   * 用 {@link exportHistory} 的快照替换当前栈。
   *
   * 🔴 只替换，**不合并**：合并会让"刷新前撤销过的条目"在刷新后重新出现，
   * 用户会看到一条已经被自己撤掉的记录又冒上来。旧快照的识别交给调用方的 schema 版本。
   */
  restoreHistory(snapshot: { undo?: HistoryEntry[]; redo?: HistoryEntry[] } | undefined): void {
    this.undoStack = snapshot?.undo ? [...snapshot.undo] : [];
    this.redoStack = snapshot?.redo ? [...snapshot.redo] : [];
    // 恢复的快照可能比上限长（旧版本写的），按上限截掉最旧的。
    if (this.undoStack.length > HISTORY_LIMIT) {
      this.undoStack = this.undoStack.slice(-HISTORY_LIMIT);
    }
    if (this.redoStack.length > HISTORY_LIMIT) {
      this.redoStack = this.redoStack.slice(-HISTORY_LIMIT);
    }
  }

  private async stepHistory(direction: 'undo' | 'redo'): Promise<UndoOutcome> {
    const source = direction === 'undo' ? this.undoStack : this.redoStack;
    const destination = direction === 'undo' ? this.redoStack : this.undoStack;
    let skipped: HistoryEntry['reason'];

    while (source.length > 0) {
      const entry = source[source.length - 1]!;
      if (entry.inverse === undefined) {
        // 不可撤销的条目直接跳过：用户按 ⌘Z 的意思是"撤回上一次能撤的"，
        // 不是"停在这条不能撤的记录上"。
        skipped = entry.reason;
        source.pop();
        continue;
      }
      const stale = checkInverseStillValid(this.state, entry);
      if (stale !== undefined) {
        // 条目**留在栈上**：这条被别的设备改过，但用户可能先解决冲突再来撤。
        return { status: 'stale', reason: stale };
      }
      const before = this.state;
      source.pop();
      const result = await this.dispatchLocked(entry.inverse, undefined, false);
      const applied = result.ops[0]!;
      // 反向 op 自己也是一条可撤销的写入 —— 这就是重做。
      const counterpart = buildHistoryEntry(before, entry.inverse, applied);
      destination.push(counterpart);
      if (destination.length > HISTORY_LIMIT) destination.shift();
      return { status: 'applied', opId: applied.id, target: historyTargetOf(entry.intent, entry.timestamp) };
    }

    return skipped === undefined ? { status: 'empty' } : { status: 'unsupported', reason: skipped };
  }

  private async dispatchLocked(
    intent: OpIntent,
    validate?: (state: MaterializedState) => void,
    /**
     * `false` = 这条 op 不是"用户刚做的一件事"（维护快照、撤销自己派发的反向 op）。
     * 这类 op **不进**历史栈：撤销栈里出现一条"撤销"会让 ⌘Z 变成俄罗斯套娃。
     */
    recordHistory = true,
  ): Promise<DispatchResult> {
    intent = cloneIntent(intent);
    // Ingress-only validation.  The reducer itself must remain able to replay
    // historical operations written before the canonical reminder owner
    // contract existed; otherwise an old log becomes a restart poison pill.
    validateReminderOwnerOperation(intent);
    if (hasTaskPriorityBatchMarker(intent.payload)) {
      parseTaskPriorityBatchOperation({ ...intent, payload: intent.payload });
    }
    if (hasTaskRepeatCompletionMarker(intent.payload)) {
      parseTaskRepeatCompletionOperation({ ...intent, payload: intent.payload });
    }
    const batch = hasTaskBatchMarker(intent.payload)
      ? parseTaskBatchOperation({ ...intent, payload: intent.payload })
      : undefined;
    // Do not retain caller-owned arrays/objects across the indexed lookup await.
    if (batch !== undefined) intent = {
      entityType: 'TASK', opType: OpType.Batch, entityId: batch.tasks[0]!.id,
      entityIds: batch.tasks.slice(1).map((task) => task.id), payload: batch,
    };
    const fixedId = batch === undefined ? undefined : taskBatchOperationId(batch.source.eventId);
    if (batch !== undefined && fixedId !== undefined) {
      const recovered = await this.recoverTaskBatchDispatch(fixedId, batch);
      if (recovered !== undefined) return recovered;
      // A snapshot can contain a receipt without the original local log row.
      // Absence of the row does not authorize recreating a completed event.
      if (this.appliedOpIds.has(fixedId) || batch.tasks.some((task) => this.state.tasks[task.id] !== undefined)) {
        throw new Error('Task batch needs original operation reconciliation');
      }
    }
    // 先算出**本次写入之后**的时钟；op 与本地时钟用同一个值。
    const clock = this.trimClock({
      ...this.clock,
      [this.options.clientId]: (this.clock[this.options.clientId] ?? 0) + 1,
    });
    const op = this.buildOp(intent, clock, fixedId);
    // Validate pure reduction before persisting; an unsupported snapshot must
    // not poison every subsequent recovery of this log.
    // Keep reducer state, persisted op, and the object returned to callers
    // independent. Reducers intentionally retain payload values in field
    // history, so sharing one mutable payload would reintroduce the same leak.
    const nextState = applyOperation(this.state, cloneOperation(op));
    validate?.(this.state);
    // 反向意图必须从**应用这条 op 之前**的状态里取旧值。
    const historyEntry = recordHistory ? buildHistoryEntry(this.state, intent, op) : undefined;

    // 1. 落盘（原子、单调 seq）
    const persistedOp = cloneOperation(op);
    const seqs = await this.options.store.appendLocal([persistedOp]);
    if (seqs.length === 0 && batch !== undefined && fixedId !== undefined) {
      // A second host instance may have won the database unique-index race.
      const recovered = await this.recoverTaskBatchDispatch(fixedId, batch);
      if (recovered !== undefined) return recovered;
    }
    if (seqs.length !== 1) {
      throw new Error(
        `本地 op 写入失败：期望 1 个 seq，实际 ${seqs.length} 个。` +
          `这通常意味着 opId 冲突（op id 生成器可能不唯一）。`,
      );
    }

    // 2. 推进本地时钟
    this.clock = mergeVectorClocks(this.clock, clock);

    // 3. 应用（纯函数）
    this.state = nextState;
    this.appliedOpIds.add(op.id);

    this.appliedSeq = seqs[0]!;
    await this.maybeCheckpoint(this.appliedSeq);

    /**
     * 🔴 历史只在**落盘且应用都成功之后**才记。反过来（先记后写）的后果是：
     * 写入失败时栈里留了一条"你以为你能撤"的记录，而它对应的 op 不存在。
     * 新动作发生时**清空 redo** —— 这是撤销栈的常规语义：分叉之后旧的重做路径失效。
     */
    if (historyEntry !== undefined) {
      this.undoStack.push(historyEntry);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
    }

    return { ops: [cloneOperation(op)], seqs };
  }

  private async recoverTaskBatchDispatch(id: string, batch: HeytaTaskBatchPayload): Promise<DispatchResult | undefined> {
    const stored = await this.options.store.getOpById(id);
    if (stored === undefined) return undefined;
    if (stored.op.clientId !== this.options.clientId ||
        JSON.stringify(parseTaskBatchOperation(stored.op)) !== JSON.stringify(batch)) {
      throw new Error('Task batch submission identity conflict');
    }
    if (!this.appliedOpIds.has(id)) await this.recoverLocked();
    return { ops: [stored.op], seqs: [stored.seq] };
  }

  /** 构造 op。向量时钟在这里 snapshot —— 之后不再变。 */
  private buildOp(intent: OpIntent, vectorClock: VectorClock, fixedId?: string): Operation<string> {
    this.opCounter += 1;
    const timestamp = (this.options.now ?? Date.now)();
    const id = fixedId ?? (this.options.nextOpId
      ? this.options.nextOpId()
      : `${this.options.clientId}-${String(timestamp)}-${String(this.opCounter)}`);

    // 🔴 op 的时钟包含本次写入自己的递增 —— 由 dispatch 算好后传进来。
    //
    // 我第一版在这里写成 "{ ...this.clock }"（写入**前**的时钟），理由
    // 是"避免自回环产生虚假因果边"。推理听着合理，后果是灾难性的：
    // 每台设备的**第一条 op 时钟是 `{}`**，而新对端的时钟也是 `{}`，
    // compareVectorClocks 判 EQUAL → 当作"已见过"**静默丢弃**。
    //
    // 即：本设备第一次同步之后的每一个改动都到不了任何其它设备。
    // 本地正常、服务端也收到，只有对端永远看不到，且不报错。
    //
    // 自回环另有兜底：appliedOpIds 挡重复应用，上传/下载用 excludeClient。

    return {
      id,
      opType: intent.opType,
      actionType: `${intent.opType}_${intent.entityType}`,
      entityType: intent.entityType,
      entityId: intent.entityId,
      ...(intent.entityIds !== undefined ? { entityIds: intent.entityIds } : {}),
      payload: intent.payload ?? {},
      clientId: this.options.clientId,
      vectorClock,
      timestamp,
      schemaVersion: 1,
      // 注意：**不写 seq**。`Operation` 是线协议类型，没有这个字段；
      // 服务端序号由存储层的 `serverSeq` 单独保存（见 StoredOperation）。
    };
  }

  // ── 远程 op ─────────────────────────────────────────────

  /**
   * 应用一批远程 op。
   *
   * 崩溃安全协议（**顺序不可换**）：
   *   1. 先落盘并标记 pendingApply
   *   2. 再逐个冲突判定 + 应用
   *   3. 最后 markApplied
   *
   * 若在 2 与 3 之间崩溃，重启时 `recover()` 会扫到 pending 的 op 并重放 ——
   * 这正是"已落盘但没应用"不会静默丢数据的原因。
   */
  applyRemote(ops: Operation<string>[]): Promise<RemoteApplyResult> {
    const snapshot = ops.map((op) => cloneOperation(op));
    return this.serialize(() => this.applyRemoteLocked(snapshot));
  }

  private async applyRemoteLocked(ops: Operation<string>[]): Promise<RemoteApplyResult> {
    if (ops.length === 0) return { applied: [], skipped: 0, overwritten: [] };
    for (const op of ops) {
      validateReminderOwnerOperation(op);
      if (isFullStateOperation(op) || hasTaskBatchMarker(op.payload) || hasTaskPriorityBatchMarker(op.payload) ||
          hasTaskRepeatCompletionMarker(op.payload)) {
        applyOperation(emptyState(), op);
      }
    }

    // 1. 落盘（幂等：重复 op 会被跳过）
    const { writtenOps, skippedCount, seqs } = await this.options.store.appendBatchSkipDuplicates(
      ops,
      'remote',
      { pendingApply: true },
    );

    // A retry may find a row written by a failed previous attempt. A duplicate
    // id proves persistence, not reducer commit; finish those pending rows too.
    const incomingIds = new Set(ops.map((op) => op.id));
    const newIds = new Set(writtenOps.map((op) => op.id));
    const retried = (await this.options.store.findPendingApply())
      .filter((row) => incomingIds.has(row.op.id) && !newIds.has(row.op.id));
    const toApply = [...writtenOps.map((op, i) => ({ op, seq: seqs[i]! })), ...retried]
      .sort((a, b) => a.seq - b.seq);

    // 2. 应用
    const applied: Operation<string>[] = [];
    const overwritten: RemoteApplyResult['overwritten'] = [];

    for (const { op } of toApply) {
      const outcome = this.applyOne(op);
      overwritten.push(...outcome.overwritten);
      if (outcome.didApply) {
        applied.push(cloneOperation(op));
        // 合并远程时钟：让后续本地写入与这些远程 op 形成正确的因果关系
        this.observeRemoteClock(op.vectorClock ?? {});
      }
    }

    // 3. 标记已应用。**这一步之后崩溃才是安全的。**
    if (toApply.length > 0) {
      await this.options.store.markApplied(toApply.map((row) => row.seq));
      this.appliedSeq = Math.max(this.appliedSeq, ...toApply.map((row) => row.seq));
      await this.maybeCheckpoint(this.appliedSeq);
    }

    return { applied, skipped: skippedCount, overwritten };
  }

  // ── 导入 / 还原 ─────────────────────────────────────────

  /**
   * 从一份**导出文档的 op-log** 还原本机数据。
   *
   * ═════════════════════════════════════════════════════════════════════
   * 🔴 **这是"导入"这条产品路径的引擎原语，但它自己不做产品判断。**
   *
   * 它只回答一个问题："把这些**已经存在的 op** 当成事实追加进日志，
   * 然后让状态与时钟跟上它们。" 至于"目标是空库还是合并""文档版本对不对"
   * "结果与导出是否逐项一致" —— 全是产品语义，留在 `@heyta/app-host`。
   * ═════════════════════════════════════════════════════════════════════
   *
   * 为什么**必须**在追加后调用 `recover()`，而不能只 `applyOperation()` 一遍：
   *
   *   - `recover()` 会从**整个日志**重建物化状态、重建 `appliedOpIds`、
   *     并把每条 op 的向量时钟并进 `this.clock`。
   *   - 🔴 少了"并时钟"这一步，接下来这台设备的**每一次本地写入都会时钟回退**：
   *     新 op 的时钟是从 `{}` 长出来的，与导入的时钟**并发**甚至更旧，
   *     于是 reducer 的写入闸门（`shouldAcceptWrite`）会把它们判成"更旧"而
   *     **静默丢弃** —— 数据写进了日志、界面就是不动，且不报错。
   *   - 墓碑语义也在这里被保住：导出里带着 `DEL` op，重放它就得到 `deletedAt`。
   *     任何"只搬 entities 不搬 op"的还原都会让已删数据复活（见 export-dump.ts 文件头）。
   *
   * ⚠️ 导入的 op **不进上传队列**（`source: 'import'`）—— 原因见
   * `OpLogStore.appendImported`：它们带着别的设备的 `clientId`，服务端会拒绝。
   */
  importOperations(ops: readonly Operation<string>[]): Promise<ImportOpsResult> {
    const snapshot = ops.map((op) => cloneOperation(op));
    return this.serialize(() => this.importOperationsLocked(snapshot));
  }

  private async importOperationsLocked(ops: readonly Operation<string>[]): Promise<ImportOpsResult> {
    if (ops.length === 0) return { imported: 0, skipped: 0 };
    /**
     * 🔴 入盘前**逐条预演一遍整个 reducer**，一条都不许跳。
     *
     * 【为什么（崩溃审计 2026-11-08 · B.1）】
     *
     * 这里原来的 `if (isFullStateOperation(...) || hasTaskBatchMarker(...) ...)`
     * 只校验了 full-state / task-batch / priority-batch / repeat-completion **四类**，
     * 普通实体 op（CRT/UPD/DEL）**完全跳过**就直接进了 `appendImported`。
     *
     * 而 reducer 对普通实体 op 也会抛：`applyOperationToEntity` 里字段版本桶
     * 曾用普通对象承载，payload 出现 `Object.prototype` 成员名
     * （`constructor` / `__proto__` / `toString` …）时
     * `fieldVersions[key] ??= []` 会取到继承来的 `Object` 函数，
     * 随即 `versions.some is not a function` —— 一个**同步 TypeError**。
     *
     * 后果链正是上面注释警告的那件事，只是原来的防护漏了这一类：
     * 坏 op **先落盘** → `recoverLocked()` 才抛 → 本次导入失败 →
     * **此后每次冷启动都在同一处抛，重装都无效**（数据在本地库里）。
     *
     * 所以这里改成无条件预演：`applyOperation(emptyState(), op)` 对所有
     * op 类型都跑一遍。这条预演是**状态无关**的（三条 throw 的判据分别看
     * payload 形状、因果边界、batch 身份，都不依赖累积状态），因此在空状态上
     * 能过 ⇒ 在回放时也能过；在空状态上就抛 ⇒ 现在就地拦下，不落盘。
     *
     * 性能上可以接受：导入是用户显式发起的一次性动作，预演只是把
     * `recoverLocked()` 本来就要做的回放提前跑一遍前面那一段。
     */
    for (const op of ops) {
      validateReminderOwnerOperation(op);
      try {
        applyOperation(emptyState(), op);
      } catch (cause) {
        // 指名道姓地失败：调用方要能告诉用户"备份里哪一条坏了"，
        // 而不是拿到一句 TypeError。
        //
        // 🔴 原始 message **必须**原样带上（不吞）：`applyOperation` 内部抛的是
        // 有诊断价值的句子（如 `Task repeat completion missing task scope`），
        // 外层调用方与既有测试都按它断言。包装只加前缀，不改原文。
        const original = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `导入被拒绝：操作 ${op.id}（${op.entityType}/${op.opType}）无法被当前版本的 reducer 解析` +
            `（${original}）。这条操作没有被写入本地库 —— 拒绝整份导入是为了避免它污染之后的每一次冷启动。`,
          { cause },
        );
      }
    }

    const result = await this.options.store.appendImported([...ops]);

    // 追加之后，状态与时钟都必须从**完整日志**重建 —— 见上面的注释。
    await this.recoverLocked();

    return { imported: result.appended.length, skipped: result.skipped.length };
  }

  /**
   * 应用单条 op，带冲突判定。
   *
   * 冲突判定语义（复用 sync-core 的 compareVectorClocks）：
   *   - GREATER_THAN → 远端更新，应用
   *   - LESS_THAN    → 远端更旧，**丢弃**（我们的版本更新）
   *   - EQUAL        → 已见过，跳过
   *   - CONCURRENT   → 真并发，LWW + clientId 确定性决胜
   */
  private applyOne(op: Operation<string>): {
    didApply: boolean;
    overwritten: RemoteApplyResult['overwritten'];
  } {
    // 幂等闸门：这条 op 处理过了
    if (this.appliedOpIds.has(op.id)) {
      return { didApply: false, overwritten: [] };
    }


    // An unseen operation must still reach the reducer, even when its clock
    // is below the aggregate clock we already know. A device can receive a
    // later causal operation before an earlier one (pagination, retry, or a
    // reconnect can reorder delivery). The aggregate clock proves that the
    // event is not newer than everything we know; it does not prove that this
    // specific op was applied. The reducer's per-entity clock gate handles the
    // actual stale-write decision, while appliedOpIds remains the idempotency
    // gate.
    //
    // GREATER_THAN, LESS_THAN, EQUAL, and CONCURRENT therefore all flow
    // through applyOperation. Skipping unseen LESS_THAN/EQUAL ops here would
    // silently drop valid data when an op arrives after one of its causal
    // descendants.
    const ids = [...new Set([...(op.entityId === undefined ? [] : [op.entityId]), ...(op.entityIds ?? [])])];
    const before = bucketFor(this.state, op.entityType);
    const snapshots = ids.map((entityId) => ({ entityId, entity: before?.[entityId] }));
    // The reducer retains payload values in field history. Keep its copy
    // separate from the stored operation and from the object returned below.
    this.state = applyOperation(this.state, cloneOperation(op));
    this.appliedOpIds.add(op.id);

    const after = bucketFor(this.state, op.entityType);
    return {
      didApply: true,
      overwritten: snapshots.filter(({ entityId, entity }) => {
        if (entity === undefined) return false;
        const previousClock = (entity['_lastClock'] ?? {}) as VectorClock;
        return compareVectorClocks(op.vectorClock ?? {}, previousClock) === VectorClockComparison.CONCURRENT &&
          this.entityContent(entity) !== this.entityContent(after?.[entityId]);
      }).map(({ entityId }) => ({ entityType: op.entityType, entityId })),
    };
  }

  private entityContent(entity: Record<string, unknown> | undefined): string {
    return JSON.stringify(Object.entries(entity ?? {})
      .filter(([key]) => !key.startsWith('_') && key !== 'updatedAt')
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }

  // ── 崩溃恢复 ────────────────────────────────────────────

  /**
   * 启动时调用。
   *
   * 找出"已落盘但未应用"的 op 并重放。**必须在接受新同步之前完成** ——
   * 否则那些 op 占着 seq 却永不生效，等于静默丢数据。
   */
  recover(): Promise<{ replayed: number }> {
    return this.serialize(() => this.recoverLocked());
  }

  private async recoverLocked(): Promise<{ replayed: number }> {
    // 🔴 启动时必须从**整个日志**重建内存状态，不能只看 pendingApply。
    //
    // 我第一版只重放了 `pendingApply`（"写了但没应用"的远程 op）。
    // 本地 op 是在 dispatch 时就标成 `applied` 的，所以它们**一条都不会被重放**。
    // 后果：刷新页面后内存状态是空的 —— 磁盘上数据一条没少，界面上一条没有。
    // 这正是"op-log 是事实来源"必须能兑现的地方，而我把它走成了摆设。
    //
    // `rebuildFromLog()` 本来就写好了，只是没有被 recover 用上。
    this.appliedOpIds.clear();
    this.clock = {};
    this.checkpointSeq = 0;
    const observedClock = await this.options.store.readObservedClock?.() ?? {};

    let checkpoint;
    let checkpointState: MaterializedState | undefined;
    try {
      checkpoint = await this.options.store.readCheckpoint?.();
      checkpointState = checkpoint === undefined
        ? undefined
        : deserializeMaterializedState(checkpoint.state);
    } catch {
      // A malformed checkpoint is only a cache miss. The complete op-log is
      // still authoritative and will be replayed below.
      checkpointState = undefined;
    }
    const pendingAtStart = await this.options.store.findPendingApply();
    const checkpointValid = checkpointState !== undefined &&
      isValidCheckpoint(checkpoint, await this.options.store.getLastLocalSeq()) &&
      pendingAtStart.every((row) => row.seq > checkpoint.coveredSeq || checkpoint.appliedOpIds.includes(row.op.id));

    if (checkpointValid && checkpointState !== undefined && checkpoint !== undefined) {
      const loadedCheckpoint = checkpoint;
      this.state = checkpointState;
      this.clock = mergeVectorClocks(loadedCheckpoint.clock, observedClock);
      for (const opId of loadedCheckpoint.appliedOpIds) this.appliedOpIds.add(opId);
      this.appliedSeq = loadedCheckpoint.coveredSeq;
      this.checkpointSeq = loadedCheckpoint.coveredSeq;
      let replayed = 0;
      for (;;) {
        const tail = await this.options.store.getOpsSince(this.appliedSeq, 250);
        if (tail.length === 0) break;
        replayed += tail.length;
        for (const record of tail.sort((a, b) => a.seq - b.seq)) {
          if (this.appliedOpIds.has(record.op.id)) continue;
          this.state = applyOperation(this.state, record.op);
          this.appliedOpIds.add(record.op.id);
          this.clock = this.trimClock(mergeVectorClocks(this.clock, record.op.vectorClock ?? {}));
        }
        this.appliedSeq = tail.at(-1)!.seq;
      }
      const pending = await this.options.store.findPendingApply();
      if (pending.length > 0) await this.options.store.markApplied(pending.map((r) => r.seq));
      await this.maybeCheckpoint(this.appliedSeq);
      return { replayed };
    }

    const all = await this.options.store.getAllOps();

    // 按 seq 升序 —— 顺序错了 LWW 的结果就会不同
    const sorted = [...all].sort((a, b) => a.seq - b.seq);

    this.state = replayOperations(
      emptyState(),
      sorted.map((r) => r.op),
    );

    // 重建幂等闸门与向量时钟。两者都必须从日志恢复：
    //   - appliedOpIds 不恢复 → 重复投递的 op 会被再应用一次
    //   - clock 不恢复 → 后续本地写入无法在因果上压过已见过的一切，
    //     并发判定会把"我们早就知道的事"当成并发
    for (const record of sorted) {
      this.appliedOpIds.add(record.op.id);
      this.clock = this.trimClock(mergeVectorClocks(this.clock, record.op.vectorClock ?? {}));
    }
    this.observeRemoteClock(observedClock);

    // 崩溃时"写了但没应用"的远程 op：虽然上面已经从日志重放过了，
    // 但仍要把它们从 pendingApply 队列里清掉 —— 否则每次启动都重复处理。
    const pending = await this.options.store.findPendingApply();
    if (pending.length > 0) {
      await this.options.store.markApplied(pending.map((r) => r.seq));
    }

    if (sorted.length >= this.checkpointEvery && sorted.at(-1)?.seq !== undefined) {
      try {
        await this.writeCheckpoint(sorted.at(-1)!.seq);
      } catch (error) {
        console.warn('[heyta] checkpoint write skipped after recovery', error);
      }
    }

    this.appliedSeq = sorted.at(-1)?.seq ?? 0;
    return { replayed: sorted.length };
  }

  /**
   * 从 op-log 全量重建状态。
   *
   * 用于：数据库损坏修复、快照校验、"清除本地缓存后恢复"。
   * 这条路径能跑通，才说明 op-log 真的是事实来源。
   */
  rebuildFromLog(): Promise<MaterializedState> {
    return this.serialize(() => this.rebuildFromLogLocked());
  }

  private async rebuildFromLogLocked(): Promise<MaterializedState> {
    const all = await this.options.store.getAllOps();
    const sorted = [...all].sort((a, b) => a.seq - b.seq);
    this.state = replayOperations(emptyState(), sorted.map((r) => r.op));
    this.appliedOpIds = new Set(sorted.map((r) => r.op.id));
    this.clock = await this.options.store.readObservedClock?.() ?? {};
    for (const row of sorted) this.observeRemoteClock(row.op.vectorClock ?? {});
    this.appliedSeq = sorted.at(-1)?.seq ?? 0;
    return this.state;
  }
}
