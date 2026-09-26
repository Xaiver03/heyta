/**
 * 熔断状态落盘测试
 * ==================
 *
 * 🔴 本文件最重要的两组：
 *
 *   1. 🔴🔴 **封顶** —— 一条被写成"十年后"的记录不能让 AI 永久不可用
 *   2. 🔴🔴 **坏数据不抛错，且退化方向是"当作没有熔断"** ——
 *      反过来（当作全部跳闸）会让 AI 永久卡死
 */

import { describe, expect, it } from 'vitest';

import {
  FAILURE_MEMORY_MS,
  HEALTH_SNAPSHOT_VERSION,
  MAX_CIRCUIT_MS,
  MAX_LAST_ERROR_LENGTH,
  describeEndpointHealth,
  fromHealthSnapshot,
  toHealthSnapshot,
} from '../src/health-store.js';
import type { EndpointHealth, HealthMap } from '../src/routing.js';

const NOW = 1_800_000_000_000;

function healthy(id: string): EndpointHealth {
  return { endpointId: id, consecutiveFailures: 0 };
}

function tripped(id: string, until: number, failures = 3): EndpointHealth {
  return { endpointId: id, consecutiveFailures: failures, circuitOpenUntil: until, lastError: 'boom' };
}

describe('toHealthSnapshot —— 存什么', () => {
  it('跳闸中的端点会被存下来', () => {
    const snap = toHealthSnapshot({ a: tripped('a', NOW + 60_000) }, NOW);
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0]?.endpointId).toBe('a');
    expect(snap.entries[0]?.circuitOpenUntil).toBe(NOW + 60_000);
  });

  it('🔴 完全正常的条目**不存**（否则存储无限膨胀）', () => {
    expect(toHealthSnapshot({ a: healthy('a') }, NOW).entries).toHaveLength(0);
  });

  it('🔴 已经过期的跳闸当作已恢复', () => {
    const snap = toHealthSnapshot({ a: tripped('a', NOW - 1) }, NOW);
    expect(snap.entries[0]?.circuitOpenUntil).toBeUndefined();
  });

  it('🔴 太久以前的失败记录丢掉', () => {
    const stale: EndpointHealth = {
      endpointId: 'a',
      consecutiveFailures: 5,
      lastError: 'boom',
      lastSuccessAt: NOW - FAILURE_MEMORY_MS - 1,
    };
    expect(toHealthSnapshot({ a: stale }, NOW).entries).toHaveLength(0);
  });

  it('🔴 `lastError` 会被截断', () => {
    const long: EndpointHealth = {
      endpointId: 'a',
      consecutiveFailures: 1,
      lastError: 'x'.repeat(1000),
    };
    const snap = toHealthSnapshot({ a: long }, NOW);
    expect(snap.entries[0]?.lastError).toHaveLength(MAX_LAST_ERROR_LENGTH);
  });

  it('🔴 顺序稳定（同样的输入总是同样的输出）', () => {
    const health: HealthMap = { c: tripped('c', NOW + 1), a: tripped('a', NOW + 1), b: tripped('b', NOW + 1) };
    expect(toHealthSnapshot(health, NOW).entries.map((e) => e.endpointId)).toEqual(['a', 'b', 'c']);
  });

  it('版本号写进去了', () => {
    expect(toHealthSnapshot({}, NOW).version).toBe(HEALTH_SNAPSHOT_VERSION);
  });
});

describe('🔴🔴 封顶：跳闸不能永久', () => {
  it('🔴🔴 存的时候就把十年后夹到上限', () => {
    const snap = toHealthSnapshot({ a: tripped('a', NOW + 10 * 365 * 24 * 3600 * 1000) }, NOW);
    expect(snap.entries[0]?.circuitOpenUntil).toBe(NOW + MAX_CIRCUIT_MS);
  });

  it('🔴🔴 读的时候**也**夹一次（不能只信存的路径）', () => {
    // 模拟"手改了存储里的值"
    const tampered = {
      version: HEALTH_SNAPSHOT_VERSION,
      entries: [{ endpointId: 'a', consecutiveFailures: 3, circuitOpenUntil: NOW + 10 * 365 * 24 * 3600 * 1000 }],
    };
    const health = fromHealthSnapshot(tampered, NOW);
    expect(health['a']?.circuitOpenUntil).toBe(NOW + MAX_CIRCUIT_MS);
  });

  it('🔴 上限之内的值**不动**', () => {
    const until = NOW + 60_000;
    expect(fromHealthSnapshot({
      version: HEALTH_SNAPSHOT_VERSION,
      entries: [{ endpointId: 'a', consecutiveFailures: 1, circuitOpenUntil: until }],
    }, NOW)['a']?.circuitOpenUntil).toBe(until);
  });
});

describe('🔴🔴 坏数据：不抛错，且退化方向是"会去试"', () => {
  const badInputs: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['字符串', 'not an object'],
    ['数字', 42],
    ['缺 version', { entries: [] }],
    ['version 对不上', { version: 999, entries: [] }],
    ['entries 不是数组', { version: HEALTH_SNAPSHOT_VERSION, entries: 'nope' }],
    ['entries 里有 null', { version: HEALTH_SNAPSHOT_VERSION, entries: [null, 1, 'x'] }],
    ['endpointId 不是字符串', { version: HEALTH_SNAPSHOT_VERSION, entries: [{ endpointId: 42 }] }],
    ['endpointId 是空串', { version: HEALTH_SNAPSHOT_VERSION, entries: [{ endpointId: '' }] }],
  ];

  for (const [label, input] of badInputs) {
    it(`🔴 ${label} → 退化成空状态，不抛错`, () => {
      expect(() => fromHealthSnapshot(input, NOW)).not.toThrow();
      expect(fromHealthSnapshot(input, NOW)).toEqual({});
    });
  }

  it('🔴🔴 坏数据**不能**退化成"全部跳闸"（那会让 AI 永久卡死）', () => {
    const health = fromHealthSnapshot({ version: 999, entries: [{ endpointId: 'a', circuitOpenUntil: NOW + 1e12 }] }, NOW);
    expect(Object.keys(health)).toHaveLength(0);
  });

  it('🔴 单个坏条目不影响同一批里的好条目', () => {
    const health = fromHealthSnapshot({
      version: HEALTH_SNAPSHOT_VERSION,
      entries: [
        { endpointId: 'bad', circuitOpenUntil: 'not a number' },
        { endpointId: 'good', consecutiveFailures: 2 },
      ],
    }, NOW);
    expect(health['bad']?.circuitOpenUntil).toBeUndefined();
    expect(health['good']?.consecutiveFailures).toBe(2);
  });

  it('🔴 负的失败次数被归零（不是当成有失败）', () => {
    expect(fromHealthSnapshot({
      version: HEALTH_SNAPSHOT_VERSION,
      entries: [{ endpointId: 'a', consecutiveFailures: -5 }],
    }, NOW)['a']?.consecutiveFailures).toBe(0);
  });

  it('🔴 NaN / Infinity 被丢掉，不会变成永久跳闸', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const health = fromHealthSnapshot({
        version: HEALTH_SNAPSHOT_VERSION,
        entries: [{ endpointId: 'a', circuitOpenUntil: value }],
      }, NOW);
      expect(health['a']?.circuitOpenUntil).toBeUndefined();
    }
  });

  it('🔴 已经过期的跳闸读回来等于没跳闸', () => {
    expect(fromHealthSnapshot({
      version: HEALTH_SNAPSHOT_VERSION,
      entries: [{ endpointId: 'a', consecutiveFailures: 3, circuitOpenUntil: NOW - 1 }],
    }, NOW)['a']?.circuitOpenUntil).toBeUndefined();
  });

  it('🔴 同一个 id 出现两次时取更保守的（失败次数多的）', () => {
    const health = fromHealthSnapshot({
      version: HEALTH_SNAPSHOT_VERSION,
      entries: [
        { endpointId: 'a', consecutiveFailures: 1, circuitOpenUntil: NOW + 1000 },
        { endpointId: 'a', consecutiveFailures: 5, circuitOpenUntil: NOW + 2000 },
      ],
    }, NOW);
    expect(health['a']?.consecutiveFailures).toBe(5);
    expect(health['a']?.circuitOpenUntil).toBe(NOW + 2000);
  });
});

describe('往返', () => {
  it('🔴 存下来再读回来，跳闸状态还在', () => {
    const before: HealthMap = { a: tripped('a', NOW + 60_000) };
    const after = fromHealthSnapshot(toHealthSnapshot(before, NOW), NOW + 1000);
    expect(after['a']?.circuitOpenUntil).toBe(NOW + 60_000);
    expect(after['a']?.consecutiveFailures).toBe(3);
  });

  it('🔴 往返两次结果相同（幂等）', () => {
    const once = toHealthSnapshot({ a: tripped('a', NOW + 60_000) }, NOW);
    const twice = toHealthSnapshot(fromHealthSnapshot(once, NOW), NOW);
    expect(twice).toEqual(once);
  });

  it('🔴 JSON 往返不丢信息（真的能进 localStorage）', () => {
    const snap = toHealthSnapshot({ a: tripped('a', NOW + 60_000) }, NOW);
    const roundTripped = JSON.parse(JSON.stringify(snap)) as unknown;
    expect(fromHealthSnapshot(roundTripped, NOW)).toEqual(fromHealthSnapshot(snap, NOW));
  });

  it('空 map 往返还是空', () => {
    expect(fromHealthSnapshot(toHealthSnapshot({}, NOW), NOW)).toEqual({});
  });
});

describe('describeEndpointHealth', () => {
  it('跳闸中说人话，且有剩余秒数', () => {
    const text = describeEndpointHealth(tripped('a', NOW + 30_000), NOW);
    expect(text).toContain('暂时停止使用');
    expect(text).toContain('30 秒后重试');
  });

  it('🔴 不出现内部字段名', () => {
    const text = describeEndpointHealth(tripped('a', NOW + 30_000), NOW);
    expect(text).not.toContain('consecutiveFailures');
    expect(text).not.toContain('circuitOpenUntil');
  });

  it('失败过但已恢复 → 说"最近失败过"', () => {
    expect(describeEndpointHealth({ endpointId: 'a', consecutiveFailures: 2 }, NOW)).toContain('最近失败过 2 次');
  });

  it('正常 → "正常"', () => {
    expect(describeEndpointHealth(healthy('a'), NOW)).toBe('正常');
  });

  it('跳闸时间已过 → 不再说"停止使用"', () => {
    expect(describeEndpointHealth(tripped('a', NOW - 1), NOW)).not.toContain('暂时停止使用');
  });
});
