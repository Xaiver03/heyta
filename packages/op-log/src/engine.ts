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
  limitVectorClockSize,
  mergeVectorClocks,
} from '@heyta/sync-core';
import type { OpLogStore, StoredOperation } from '@heyta/storage';

import {
  applyOperation,
  emptyState,
  replayOperations,
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

  constructor(private readonly options: OpLogEngineOptions) {
    this.state = options.initialState ?? emptyState();
  }

  /**
   * 裁剪时钟规模。
   *
   * ⚠️ 第二个参数是**要保留的 clientId 列表**，不是上限大小。
   * 自己的 clientId 必须保留 —— 被裁掉的话，本次写入就不再是
   * "自己时钟的递增"，LWW 决胜会退化成不可预测。
   */
  private trimClock(clock: VectorClock): VectorClock {
    return limitVectorClockSize(clock, [this.options.clientId]);
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

  /** 当前向量时钟快照。 */
  getClock(): VectorClock {
    return { ...this.clock };
  }

  // ── 写（唯一入口） ───────────────────────────────────────

  /**
   * 派发一个本地意图。
   *
   * 顺序很关键：**先落盘，再改内存状态。**
   * 反过来的话，落盘失败时内存已经变了 —— 用户看到改动生效，
   * 刷新后消失，而且 op-log 里没有痕迹（无法恢复）。
   */
  async dispatch(intent: OpIntent): Promise<DispatchResult> {
    // 先算出**本次写入之后**的时钟；op 与本地时钟用同一个值。
    const clock = this.trimClock({
      ...this.clock,
      [this.options.clientId]: (this.clock[this.options.clientId] ?? 0) + 1,
    });
    const op = this.buildOp(intent, clock);

    // 1. 落盘（原子、单调 seq）
    const seqs = await this.options.store.appendLocal([op]);
    if (seqs.length !== 1) {
      throw new Error(
        `本地 op 写入失败：期望 1 个 seq，实际 ${seqs.length} 个。` +
          `这通常意味着 opId 冲突（op id 生成器可能不唯一）。`,
      );
    }

    // 2. 推进本地时钟
    this.clock = clock;

    // 3. 应用（纯函数）
    this.state = applyOperation(this.state, op);
    this.appliedOpIds.add(op.id);

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
  async applyRemote(ops: Operation<string>[]): Promise<RemoteApplyResult> {
    if (ops.length === 0) return { applied: [], skipped: 0, overwritten: [] };

    // 1. 落盘（幂等：重复 op 会被跳过）
    const { writtenOps, skippedCount } = await this.options.store.appendBatchSkipDuplicates(
      ops,
      'remote',
      { pendingApply: true },
    );

    // 2. 应用
    const applied: Operation<string>[] = [];
    const overwritten: RemoteApplyResult['overwritten'] = [];

    for (const op of writtenOps) {
      const outcome = this.applyOne(op);
      if (outcome.overwritten) {
        overwritten.push({ entityType: op.entityType, entityId: op.entityId ?? '' });
      }
      if (outcome.didApply) {
        applied.push(op);
        // 合并远程时钟：让后续本地写入与这些远程 op 形成正确的因果关系
        this.clock = this.trimClock(mergeVectorClocks(this.clock, op.vectorClock ?? {}));
      }
    }

    // 3. 标记已应用。**这一步之后崩溃才是安全的。**
    if (writtenOps.length > 0) {
      const stored = await this.options.store.getOpsSince(0);
      const seqs = stored
        .filter((r) => writtenOps.some((o) => o.id === r.op.id))
        .map((r) => r.seq);
      await this.options.store.markApplied(seqs);
    }

    return { applied, skipped: skippedCount, overwritten };
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
    overwritten: boolean;
  } {
    // 幂等闸门：这条 op 处理过了
    if (this.appliedOpIds.has(op.id)) {
      return { didApply: false, overwritten: false };
    }

    const comparison = compareVectorClocks(op.vectorClock ?? {}, this.clock);

    if (comparison === VectorClockComparison.LESS_THAN) {
      // 远端这条比我们已经知道的更旧 —— 应用它会回退状态
      this.appliedOpIds.add(op.id);
      return { didApply: false, overwritten: false };
    }

    if (comparison === VectorClockComparison.EQUAL) {
      this.appliedOpIds.add(op.id);
      return { didApply: false, overwritten: false };
    }

    // GREATER_THAN 或 CONCURRENT：应用。
    // CONCURRENT 的 LWW 决胜**已经下沉到 reducer**（按 timestamp + op.id），
    // 这里不重复实现一遍 —— 两处判定逻辑迟早会不一致。
    const before = op.entityId === undefined ? undefined : this.snapshot(op);
    this.state = applyOperation(this.state, op);
    this.appliedOpIds.add(op.id);

    const after = op.entityId === undefined ? undefined : this.snapshot(op);
    return {
      didApply: true,
      overwritten:
        comparison === VectorClockComparison.CONCURRENT &&
        before !== undefined &&
        after === before,
    };
  }

  private snapshot(op: Operation<string>): string | undefined {
    const bucket = (
      {
        TASK: this.state.tasks,
        PROJECT: this.state.projects,
        TAG: this.state.tags,
        HABIT: this.state.habits,
        HABIT_LOG: this.state.habitLogs,
        FOCUS_SESSION: this.state.focusSessions,
      } as Record<string, Record<string, { updatedAt?: number }>>
    )[op.entityType];
    if (bucket === undefined || op.entityId === undefined) return undefined;
    return String(bucket[op.entityId]?.['updatedAt'] ?? '');
  }

  // ── 崩溃恢复 ────────────────────────────────────────────

  /**
   * 启动时调用。
   *
   * 找出"已落盘但未应用"的 op 并重放。**必须在接受新同步之前完成** ——
   * 否则那些 op 占着 seq 却永不生效，等于静默丢数据。
   */
  async recover(): Promise<{ replayed: number }> {
    const pending = await this.options.store.findPendingApply();
    if (pending.length === 0) return { replayed: 0 };

    // 按 seq 升序重放 —— 顺序错了 LWW 结果会不同
    const sorted = [...pending].sort((a, b) => a.seq - b.seq);

    for (const record of sorted) {
      this.applyOne(record.op);
      this.clock = this.trimClock(mergeVectorClocks(this.clock, record.op.vectorClock ?? {}));
    }

    await this.options.store.markApplied(sorted.map((r) => r.seq));
    return { replayed: sorted.length };
  }

  /**
   * 从 op-log 全量重建状态。
   *
   * 用于：数据库损坏修复、快照校验、"清除本地缓存后恢复"。
   * 这条路径能跑通，才说明 op-log 真的是事实来源。
   */
  async rebuildFromLog(): Promise<MaterializedState> {
    const all = await this.options.store.getAllOps();
    const sorted = [...all].sort((a, b) => a.seq - b.seq);
    this.state = replayOperations(
      emptyState(),
      sorted.map((r: StoredOperation<Operation<string>>) => r.op),
    );
    return this.state;
  }
}
