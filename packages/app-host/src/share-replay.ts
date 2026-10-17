/**
 * 共享域的 **op-log → 物化**（ADR-0062 决策 4；计划 W3-T1 第二片）。
 * ================================================================
 *
 * 这一片把上一片的纯核接到**同一枚 reducer** 上，落实计划 §3-W3 的那条硬判据：
 *
 * > reducer **零改动**（或 diff 里逐行说明为什么必须改）
 *
 * 做法就是**什么都不碰**：`packages/op-log/src/state.ts:622` 的
 * `applyOperation(state, op): MaterializedState` 本来就是"纯函数按 entityType 分桶"，
 * 共享域只是**换一条 op 流**喂它 —— 不新增 reducer、不 fork 一份 state 形状、
 * 不给实体类型开特例。这样"共享清单里的任务"和"我自己的任务"最终落在
 * **同一个 `MaterializedState`** 里（计划 §2.2 的物化分区目标），
 * 于是所有既有读路径（含 `check:materialized-reads` 那条门禁）对共享实体同样成立。
 *
 * 为什么必须有**重放全序**：LWW 的判据是 `(向量时钟可比性 → timestamp → clientId)`
 * （`state.ts:229-232`），也就是说"两个并发写谁赢"最终由 timestamp 与 clientId 决定 ——
 * 喂进去的顺序**不能**参与决策，否则两台设备会把同一组 op 物化成两种状态。
 * 所以这里只用 `shareReplayOrder`（上一片那条全序），**不用到达顺序**。
 */

import { applyOperation, emptyState, type MaterializedState } from '@heyta/op-log';

import { foldShareOps, shareLogClock, type ShareLogOp, type ShareLogState } from './share-op-log.js';

/**
 * 一条**已解密**的共享 op：share 域日志的形状 + reducer 要的字段。
 *
 * ⚠️ 字段集是"两条线的最小并集"，不是我挑的：
 * `id` / `clientId` / `timestamp` / `vectorClock` 是 share 日志要的（定序与合钟），
 * 其余是 `Operation<string>`（`sync-core/src/operation.types.ts`）要的。
 * `payload` 在这里**必然已是明文** —— 解密发生在本函数之前（密文进不了 reducer）。
 */
export interface DecryptedShareOp extends ShareLogOp {
  readonly actionType: string;
  readonly opType: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly entityIds?: readonly string[];
  readonly schemaVersion: number;
  readonly payload: unknown;
}

export interface ShareReplayResult {
  readonly state: MaterializedState;
  /** 折叠后的 share 日志（含时钟与重复计数），供下一批继续喂。 */
  readonly log: ShareLogState;
  /** 这一趟真的过了 reducer 的 op 数（去重后的）。 */
  readonly applied: number;
}

/** 剥掉 share 域自己的外壳，喂 reducer 要吃的那一份（**不复制** payload）。 */
function toReducerOperation(op: DecryptedShareOp) {
  return {
    id: op.id,
    actionType: op.actionType,
    opType: op.opType,
    entityType: op.entityType,
    ...(op.entityId === undefined || op.entityId === null ? {} : { entityId: op.entityId }),
    // `Operation.entityIds` 声明的是**可变**数组，而共享域那边给的是只读 ⇒ 这里复制一份
    // （复制的是**字符串数组**，不是 payload：`payload` 按引用传递，不做深拷贝）。
    ...(op.entityIds === undefined ? {} : { entityIds: [...op.entityIds] }),
    payload: op.payload,
    clientId: op.clientId,
    vectorClock: shareLogClock(op.vectorClock),
    timestamp: op.timestamp ?? 0,
    schemaVersion: op.schemaVersion,
  };
}

/**
 * 把若干批已解密的共享 op 折进状态。
 *
 * 性质（判据见 `tests/share-replay.spec.ts`）：
 * - **与到达顺序/分批无关**：同一组 op 无论怎么排、怎么分批，物化结果与时钟都一样；
 * - **幂等**：同一批再喂一次，状态与时钟都不动；
 * - **只过既有 reducer**：`applyOperation` 的调用点是本文件唯一一处，且不改它。
 */
export function replayShareOps(
  initial: MaterializedState,
  batches: readonly (readonly DecryptedShareOp[])[],
  baseline: ShareLogState | undefined = undefined,
): ShareReplayResult {
  let log = baseline ?? { ops: [], clock: {}, duplicates: 0 };
  for (const batch of batches) log = foldShareOps(log, batch);

  let state = initial;
  /*
   * ⚠️ **这里不排第二次序**：`foldShareOps` 出来时 `log.ops` **已经是重放全序**
   *（全序由 `share-op-log.ts` 的 `shareReplayOrder` 在折叠时执行）。
   * 先前这行还多排了一遍，看起来更安全，实际是有害的冗余：它让"全序到底在哪承重"变得含糊，
   * 于是我第一次打变异臂（拿掉这里的排序）**全绿**，一度以为全序不重要（实测教训）。
   * 承重点只有一处，判据也就该只钉那一处。
   */
  for (const op of log.ops as readonly DecryptedShareOp[]) {
    state = applyOperation(state, toReducerOperation(op));
  }
  return { state, log, applied: log.ops.length };
}

/** 从空状态起跑（"新设备第一次拉到一整条 share 日志"的形状）。 */
export function replayShareOpsFromScratch(
  batches: readonly (readonly DecryptedShareOp[])[],
): ShareReplayResult {
  return replayShareOps(emptyState(), batches);
}
