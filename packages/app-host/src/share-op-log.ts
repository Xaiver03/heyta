/**
 * 共享域的 **op-log 纯核**（ADR-0062 决策 4/5；计划 W3-T1 的第一片）。
 * ================================================================
 *
 * 这一片只做**与到达顺序无关**的三件事，全部是纯函数：
 *
 * 1. **去重**：`ShareOperation` 的表有 `@@unique([shareId, serverSeq])`，
 *    但客户端还会遇到"同一 op 经两条路回来"（重试、断线重连后的补拉）——
 *    判据是**重放同一批不产生新状态**（计划 §3-W3："重试无新状态"）。
 *
 * 2. **合钟**：share 域有**自己的向量时钟**（维度仍是 `clientId`），
 *    合并规则 = **逐维最大** —— 直接复用 `@heyta/sync-core` 的 `mergeVectorClocks`
 *    （`vector-clock.ts:120`），**不在这里写第二份**（两套钟迟早漂移，
 *    `op-log/src/engine.ts` 里 `OpIntent.opType` 那条教训的成本就是这么来的）。
 *    ⚠️ rekey 时时钟**按 epoch 重置**（计划 §2.2），所以本模块的 `keyEpoch` 是状态的一部分：
 *    不同 epoch 的 op **不许混进同一条链**（混了就是拿两把钥匙解一段历史）。
 *
 * 3. **重放全序**：喂给 reducer 的顺序必须是**全序且与到达顺序无关**，
 *    否则两台设备会把并发写物化成两种状态，而向量时钟只判"并发"、不定"谁先"。
 *    次序键 = `(timestamp, clientId, id)` —— 前两段是仓库既有的 LWW 平局规则
 *    （"向量时钟判并发，LWW 加 `clientId` 确定性打破平局"，AGENTS §1），第三段保证**全序**
 *    （同一 clientId 同一毫秒的两条 op 也能定序；少了它，`Array.prototype.sort` 的稳定性
 *    会把"到达顺序"偷偷带进物化结果）。
 */

import { mergeVectorClocks, type VectorClock } from '@heyta/sync-core';

/**
 * 折叠需要看到的最小 op 形状（结构上 `@heyta/sync-client` 的 `ShareOpWire` 就满足）。
 *
 * ⚠️ 只声明**真的用到**的字段：多声明一个字段就等于把"线协议里必须有它"写进类型里，
 * 而线协议词表的唯一来源是服务端的校验（`server/src/shares/`），不是这里。
 */
export interface ShareLogOp {
  readonly id: string;
  readonly clientId: string;
  readonly timestamp: number | null;
  readonly vectorClock?: unknown;
}

export interface ShareLogState {
  /** 已收下的 op（**不是**按到达顺序，而是重放全序）。 */
  readonly ops: readonly ShareLogOp[];
  /** share 域的向量时钟（逐维最大）。 */
  readonly clock: VectorClock;
  /** 这一批里被丢掉的**重复** op 数（可观测：用来证明"重试无新状态"）。 */
  readonly duplicates: number;
}

export const emptyShareLogState = (): ShareLogState => ({ ops: [], clock: {}, duplicates: 0 });

/** 把线上 op 的 `vectorClock: unknown` 收成 `VectorClock`（形状不对的维度**直接丢**，不折成 0）。 */
function normalizeClock(value: unknown): VectorClock {
  if (value === null || typeof value !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [clientId, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) out[clientId] = count;
  }
  return out;
}

/**
 * 重放全序：`(timestamp, clientId, id)`。
 *
 * `timestamp === null`（服务端还没盖时间戳的本地 op）排在最前：它们是这一段的**因**，
 * 必须排在由它们派生的远端 op 之前；同为空时用 `clientId`、`id` 定序。
 */
export function shareReplayOrder<T extends ShareLogOp>(ops: readonly T[]): T[] {
  return [...ops].sort((a, b) => {
    const at = a.timestamp;
    const bt = b.timestamp;
    if (at === null && bt !== null) return -1;
    if (at !== null && bt === null) return 1;
    if (at !== null && bt !== null && at !== bt) return at - bt;
    if (a.clientId !== b.clientId) return a.clientId < b.clientId ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * 把一批线上 op 折进 share 域的状态。
 *
 * 性质（每条都有判据，见 `tests/share-op-log.spec.ts`）：
 * - **幂等**：同一批折两次 = 折一次（`duplicates` 会涨，`ops`/`clock` 不动）；
 * - **顺序无关**：任意排列、任意分批 ⇒ 同一个 `ops` 集合与同一个 `clock`；
 * - **时钟逐维最大**：低值的维度不许把高值压下去；
 * - `ops` 出来后**已按重放全序排好**。
 */
export function foldShareOps(state: ShareLogState, incoming: readonly ShareLogOp[]): ShareLogState {
  const seen = new Set(state.ops.map((op) => op.id));
  const added: ShareLogOp[] = [];
  let duplicates = state.duplicates;
  for (const op of incoming) {
    if (seen.has(op.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(op.id);
    added.push(op);
  }
  if (added.length === 0 && duplicates === state.duplicates) return state;

  let clock = state.clock;
  for (const op of added) clock = mergeVectorClocks(clock, normalizeClock(op.vectorClock));
  return { ops: shareReplayOrder([...state.ops, ...added]), clock, duplicates };
}

/** 折叠整条链（按给定顺序喂多批）—— 用于"下载→解密→回放"那条路的可测部分。 */
export function foldShareOpBatches(batches: readonly (readonly ShareLogOp[])[]): ShareLogState {
  let state = emptyShareLogState();
  for (const batch of batches) state = foldShareOps(state, batch);
  return state;
}
