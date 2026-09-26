/**
 * Vector Clock types and comparison functions for distributed synchronization.
 *
 * A vector clock is a data structure used to determine the partial ordering of events
 * in a distributed system and detect causality violations.
 *
 * Each process/device maintains its own component in the vector, incrementing it
 * on local updates. This allows us to determine if two states are:
 * - EQUAL: Same vector values
 * - LESS_THAN: A happened before B
 * - GREATER_THAN: B happened before A
 * - CONCURRENT: Neither happened before the other (true conflict)
 *
 * IMPORTANT: This module is the single source of truth for generic client and
 * server vector-clock algorithms. Any changes must be compatible with both
 * environments.
 */

/**
 * Vector clock data structure.
 * Maps client IDs to their respective clock values.
 */
export interface VectorClock {
  [clientId: string]: number;
}

/**
 * Result of comparing two vector clocks.
 */
export const VectorClockComparison = {
  EQUAL: 'EQUAL',
  LESS_THAN: 'LESS_THAN',
  GREATER_THAN: 'GREATER_THAN',
  CONCURRENT: 'CONCURRENT',
} as const;

export type VectorClockComparison =
  (typeof VectorClockComparison)[keyof typeof VectorClockComparison];

/**
 * Maximum number of entries in a vector clock.
 * Shared between client and server to ensure consistent pruning.
 *
 * 🔴 heyta 把上游的 **20 提到了 100**。理由不是"20 有点紧"，而是
 * **实测证明 20 会致命**。
 *
 * 上游注释写的是"个人效率应用里用户要有 21 个以上不同 clientId 才会触发裁剪，
 * 极不可能" —— 那是**假设**。heyta 的零 mock E2E 在验收账号累积到 21 个
 * clientId 时就撞上了它（每跑一轮 +2：手机装一次包、笔记本建一次库），
 * 而后果不是"稍微不准"：
 *
 *   服务端的 head 自己也被裁到 20 条，客户端也裁到 20 条，而**两边决定
 *   "保留哪 20 条"的规则不一样** —— 服务端保护 `op.clientId + protectedIds`
 *   （即 head 已知的那些），客户端**只保护自己的 clientId**。
 *   于是只要真实时钟超过上限，两边就可能对同一份因果事实得出不同结论：
 *   客户端少一个 head 里有的键 → 它的时钟不再支配 head → 服务端把该设备写的
 *   **每一条** op 判成 `CONFLICT_CONCURRENT` 并**永久拒绝**。
 *   客户端只会表现为"同步不上"，看起来像网络或协议问题。
 *
 * 提到 100 之后，这堵墙从"21 个 clientId"挪到"101 个"——对个人任务应用
 * 实际上不可达（一次安装/一个浏览器会话才 +1）。代价：最坏情况一个时钟
 * ~100 条 ≈ 1.6 KB（6 字符 id），相对 op 载荷可以忽略。
 *
 * ⚠️ **这是把墙挪远，不是把墙拆掉。** 只要时钟还有上限，"客户端与服务端
 * 各自裁剪"这个形状就还在。真正的修法是因果安全的压缩（见 ADR-0008），
 * **没有做**。所以 `limitVectorClockSize` 现在在真的发生裁剪时会**打一条
 * warning**：上一次这个故障最毒的地方就是它**完全静默**。
 *
 * At 6-char client IDs, a 100-entry clock is ~1.6 KB — negligible bandwidth.
 */
export const MAX_VECTOR_CLOCK_SIZE = 100;

/**
 * Compare two vector clocks to determine their relationship.
 *
 * CRITICAL: This algorithm must produce identical results on client and server.
 * Client and server code should import or re-export this implementation to
 * ensure consistency.
 *
 * Standard vector clock comparison: missing keys mean "genuinely zero".
 * Comparison stays pruning-unaware by design. Pruning is rare (needs 21+
 * unique client IDs) but real; when it fires, correctness rests on the
 * preserve set — both server and client keep their own id plus the active
 * full-state author (#9089, #9096) — and on the counter-based rescue
 * predicates in sync-import-filter.ts absorbing residual pruning artifacts.
 *
 * @param a First vector clock
 * @param b Second vector clock
 * @returns The comparison result
 */
export const compareVectorClocks = (
  a: VectorClock,
  b: VectorClock,
): VectorClockComparison => {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aGreater = false;
  let bGreater = false;

  for (const key of allKeys) {
    const aVal = a[key] ?? 0;
    const bVal = b[key] ?? 0;
    if (aVal > bVal) aGreater = true;
    if (bVal > aVal) bGreater = true;
    if (aGreater && bGreater) return 'CONCURRENT';
  }

  if (aGreater) return 'GREATER_THAN';
  if (bGreater) return 'LESS_THAN';
  return 'EQUAL';
};

/**
 * Merge two vector clocks, taking the maximum value for each client.
 * Creates a new clock that dominates both inputs.
 *
 * @param a First vector clock
 * @param b Second vector clock
 * @returns A new merged vector clock
 */
export const mergeVectorClocks = (a: VectorClock, b: VectorClock): VectorClock => {
  const merged: VectorClock = { ...a };

  for (const [key, value] of Object.entries(b)) {
    merged[key] = Math.max(merged[key] ?? 0, value);
  }

  return merged;
};

/**
 * Limits vector clock size by keeping only the most active clients.
 * Used by the server (when storing ops after comparison) and the client.
 *
 * @param clock The vector clock to limit
 * @param preserveClientIds Client IDs to always keep (e.g., current client)
 * @returns A clock with at most MAX_VECTOR_CLOCK_SIZE entries
 */
export const limitVectorClockSize = (
  clock: VectorClock,
  preserveClientIds: string[] = [],
): VectorClock => {
  const entries = Object.entries(clock);
  if (entries.length <= MAX_VECTOR_CLOCK_SIZE) {
    return clock;
  }

  // 🔴 走到这里就意味着**正在丢因果信息**，必须让人看见。
  //
  // 上一次这个故障是**完全静默**的：客户端只报"同步不上"，服务端报
  // `CONFLICT_CONCURRENT`，没有任何一层提到"你的时钟被裁掉了一项"。
  // 排查方向因此被带到同步协议上去，花了很多轮才落到这一行。
  //
  // 这条 warning 不是"多余的日志" —— 它是这个已知限制**唯一的出口信号**。
  // 详见 ADR-0008。若在真实用户环境看到它，说明这个上限已经不够用了。
  console.warn(
    `[heyta] 向量时钟有 ${entries.length} 条，超过上限 ${MAX_VECTOR_CLOCK_SIZE}，` +
      '正在裁剪 —— 这会丢失因果信息，可能导致该设备写入被服务端永久拒绝。见 ADR-0008。',
  );

  const alwaysPreserve = new Set(preserveClientIds);

  // Sort by value descending to keep most active clients.
  // Secondary sort by client ID for deterministic tie-breaking when values are equal.
  entries.sort(
    ([keyA, a], [keyB, b]) => b - a || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0),
  );

  const limited: VectorClock = {};

  // Add preserved IDs first, but cap at MAX_VECTOR_CLOCK_SIZE.
  // If preserveClientIds itself exceeds MAX, only the first MAX are kept.
  let count = 0;
  for (const id of alwaysPreserve) {
    if (clock[id] !== undefined && count < MAX_VECTOR_CLOCK_SIZE) {
      limited[id] = clock[id];
      count++;
    }
  }

  // Fill remaining slots with most active non-preserved clients
  for (const [clientId, value] of entries) {
    if (count >= MAX_VECTOR_CLOCK_SIZE) break;
    if (!alwaysPreserve.has(clientId)) {
      limited[clientId] = value;
      count++;
    }
  }

  return limited;
};
