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
      if ((await this.options.store.findPendingUpload()).length > 0 ||
          (await this.options.store.findPendingApply()).length > 0) {
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
      return this.dispatchLocked({ entityType: 'ALL', entityId: '*', opType: OpType.Repair, payload });
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
   * 备份还原的「目标必须真的是空库」判定要用它
   * （`app-host` 的 `restoreIntoEmptyTarget` 经宿主的 `ImportTarget.readOpLog`
   * 到这里）—— 写之前必须知道目标里已有什么，而 pending 只是它的一个子集。
   */
  async getAllOps(): Promise<Operation<string>[]> {
    const all = await this.options.store.getAllOps();
    return all.map((r) => r.op);
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
    return this.serialize(() => this.dispatchLocked(intent));
  }

  private async dispatchLocked(intent: OpIntent): Promise<DispatchResult> {
    // 先算出**本次写入之后**的时钟；op 与本地时钟用同一个值。
    const clock = this.trimClock({
      ...this.clock,
      [this.options.clientId]: (this.clock[this.options.clientId] ?? 0) + 1,
    });
    const op = this.buildOp(intent, clock);
    // Validate pure reduction before persisting; an unsupported snapshot must
    // not poison every subsequent recovery of this log.
    const nextState = applyOperation(this.state, op);

    // 1. 落盘（原子、单调 seq）
    const seqs = await this.options.store.appendLocal([op]);
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

    return { ops: [op], seqs };
  }

  /** 构造 op。向量时钟在这里 snapshot —— 之后不再变。 */
  private buildOp(intent: OpIntent, vectorClock: VectorClock): Operation<string> {
    this.opCounter += 1;
    const timestamp = (this.options.now ?? Date.now)();
    const id = this.options.nextOpId
      ? this.options.nextOpId()
      : `${this.options.clientId}-${String(timestamp)}-${String(this.opCounter)}`;

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
    return this.serialize(() => this.applyRemoteLocked(ops));
  }

  private async applyRemoteLocked(ops: Operation<string>[]): Promise<RemoteApplyResult> {
    if (ops.length === 0) return { applied: [], skipped: 0, overwritten: [] };
    for (const op of ops) {
      if (isFullStateOperation(op)) applyOperation(emptyState(), op);
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
        applied.push(op);
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
    return this.serialize(() => this.importOperationsLocked(ops));
  }

  private async importOperationsLocked(ops: readonly Operation<string>[]): Promise<ImportOpsResult> {
    if (ops.length === 0) return { imported: 0, skipped: 0 };
    // Imported snapshots follow the same pre-persistence validation as remote
    // snapshots. Otherwise a bad backup poisons every subsequent cold start.
    for (const op of ops) {
      if (isFullStateOperation(op)) applyOperation(emptyState(), op);
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
    this.state = applyOperation(this.state, op);
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
