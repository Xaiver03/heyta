import { describe, expect, it } from 'vitest';

import {
  emptyShareLogState,
  foldShareOpBatches,
  foldShareOps,
  shareReplayOrder,
  type ShareLogOp,
} from '../src/share-op-log.js';

/**
 * W3-T1 纯核的判据（计划 §3-W3："固定 seed 双引擎乱序/重复/先于 CREATE 收敛对账"）。
 * 每一条都能红 —— 变异臂见 `dedupe` 那一枚（拿掉去重 ⇒ 幂等那条红）。
 */
const op = (id: string, clientId: string, timestamp: number | null, clock: Record<string, number>): ShareLogOp => ({
  id,
  clientId,
  timestamp,
  vectorClock: clock,
});

const A = op('op-a', 'device-A', 1_700_000_000_000, { 'device-A': 1 });
const B = op('op-b', 'device-B', 1_700_000_000_500, { 'device-B': 1 });
const C = op('op-c', 'device-A', 1_700_000_001_000, { 'device-A': 2 });

/** 所有排列（3 枚 = 6 种，够证"与到达顺序无关"）。 */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

describe('share-op-log 纯核（W3-T1）', () => {
  it('重放全序是 (timestamp, clientId, id)，且与输入排列无关', () => {
    const stable = shareReplayOrder([A, B, C]).map((o) => o.id);
    expect(stable).toEqual(['op-a', 'op-b', 'op-c']);
    for (const p of permutations([A, B, C])) {
      expect(shareReplayOrder(p).map((o) => o.id), '任何到达顺序都得到同一个重放序').toEqual(stable);
    }
    // 同一 clientId、同一毫秒 ⇒ 靠 id 定序（否则 sort 的稳定性会把到达顺序带进物化结果）。
    const t1 = op('op-z', 'device-A', 5, { 'device-A': 1 });
    const t2 = op('op-y', 'device-A', 5, { 'device-A': 2 });
    expect(shareReplayOrder([t1, t2]).map((o) => o.id)).toEqual(['op-y', 'op-z']);
    expect(shareReplayOrder([t2, t1]).map((o) => o.id)).toEqual(['op-y', 'op-z']);
  });

  it('幂等：同一批折两次 = 折一次（重复计数会涨，ops/clock 不动）', () => {
    const once = foldShareOps(emptyShareLogState(), [A, B]);
    const twice = foldShareOps(once, [A, B]);
    expect(twice.ops.map((o) => o.id)).toEqual(once.ops.map((o) => o.id));
    expect(twice.clock).toEqual(once.clock);
    expect(twice.duplicates, '重复数是可观测的').toBe(2);
  });

  it('与到达顺序无关：任意排列、任意分批 ⇒ 同一集合与同一时钟', () => {
    const whole = foldShareOpBatches([[A, B, C]]);
    for (const p of permutations([A, B, C])) {
      expect(foldShareOpBatches([p]).ops.map((o) => o.id)).toEqual(whole.ops.map((o) => o.id));
      expect(foldShareOpBatches([p]).clock).toEqual(whole.clock);
    }
    // 分批（含重叠与乱序）：
    const batched = foldShareOpBatches([[B], [C, A, B], [A]]);
    expect(batched.ops.map((o) => o.id)).toEqual(whole.ops.map((o) => o.id));
    expect(batched.clock).toEqual(whole.clock);
    expect(batched.duplicates).toBeGreaterThan(0);
  });

  it('时钟逐维最大：低值不许把高值压下去，且非法维度不折成 0', () => {
    const high = foldShareOps(emptyShareLogState(), [C]);
    const low = foldShareOps(high, [op('op-d', 'device-A', 1_700_000_002_000, { 'device-A': 1 })]);
    expect(low.clock).toEqual({ 'device-A': 2 });
    const junk = foldShareOps(emptyShareLogState(), [
      op('op-e', 'device-A', 1, { 'device-A': 3, 'device-B': 0, 'device-C': -1, 'device-D': Number.NaN }),
    ]);
    expect(junk.clock, '0 / 负数 / NaN 不是合法维度计数').toEqual({ 'device-A': 3 });
  });
});
