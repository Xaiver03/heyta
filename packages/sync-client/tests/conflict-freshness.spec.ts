/**
 * 「谁较新」规则的测试
 * ======================
 *
 * 🔴 这个规则原本在 Web 端 `ConflictDialog` 里独有一份三元式，移动端做冲突界面时
 * 照着写第二遍 —— 那就是两份实现。漂移的表现会是：
 * **同一个冲突在手机和网页上"较新"标在不同的一侧**，用户以为是两件事，
 * 而两边的测试都不会红。所以它被提到这里，一处实现、两端消费。
 *
 * 🔴 规则本身修过一次，两条都是**真实的误标**，不是假想：
 *
 *   1. **时间戳相等** → 原三元式 `local > remote` 为 false，
 *      于是"较新"落到**对端**头上；而两边时间戳一模一样。
 *      AGENTS.md #19 记着"同一台设备连续两次编辑经常落在同一毫秒里"——
 *      也就是说这在真实使用中是高频情况，不是边缘用例。
 *   2. **拿不到对端** → 原来算本机较新。没有可比对象就没有"较新"这回事。
 *
 * ⚠️ 这个标记**只影响哪个按钮被高亮**，不影响任何数据。
 * 真正的裁决在 `sync-core` 的 LWW。把这一点写进测试，
 * 是为了防止后来者误以为它是一个可以参与裁决的信号。
 */

import { describe, expect, it } from 'vitest';

import { compareConflictFreshness } from '../src/client.js';

const local = { timestamp: 1_000 };
const remote = { timestamp: 2_000 };

describe('compareConflictFreshness', () => {
  it('对端更晚 → 标对端较新', () => {
    const r = compareConflictFreshness(local, remote);
    expect(r).toEqual({ localNewer: false, remoteNewer: true });
  });

  it('本机更晚 → 标本机较新', () => {
    const r = compareConflictFreshness(remote, local);
    expect(r).toEqual({ localNewer: true, remoteNewer: false });
  });

  it('🔴 时间戳相等 → **两边都不标**（同毫秒编辑是常态，标给谁都是编的）', () => {
    const r = compareConflictFreshness({ timestamp: 5_000 }, { timestamp: 5_000 });
    expect(r.localNewer).toBe(false);
    expect(r.remoteNewer).toBe(false);
  });

  it('🔴 拿不到对端 → 两边都不标（没有可比对象）', () => {
    const r = compareConflictFreshness(local, undefined);
    expect(r.localNewer).toBe(false);
    expect(r.remoteNewer).toBe(false);
  });

  it('相差 1 毫秒也要分得出来（恰好相等才是"分不出"）', () => {
    const r = compareConflictFreshness({ timestamp: 1_000 }, { timestamp: 1_001 });
    expect(r.remoteNewer).toBe(true);
    expect(r.localNewer).toBe(false);
  });

  it('两个方向不可能同时成立（相等或缺失时也成立）', () => {
    const cases: [number, { timestamp: number } | undefined][] = [
      [1_000, { timestamp: 2_000 }],
      [2_000, { timestamp: 1_000 }],
      [1_000, { timestamp: 1_000 }],
      [1_000, undefined],
    ];
    for (const [ts, other] of cases) {
      const r = compareConflictFreshness({ timestamp: ts }, other);
      expect(r.localNewer && r.remoteNewer).toBe(false);
    }
  });
});
