/**
 * 向量时钟的裁剪上限 —— **当前行为**的钉子 + **旧故障的回归守卫**
 * =================================================================
 *
 * 🔴 这个文件不是"验证正确行为"，而是**把一个已知的产品级限制钉住**，
 * 让任何改动它的人必须先读到这件事，再去决定怎么改。
 *
 * 背景（真机 E2E 实测，见 `docs/plans/phase-2-multi-platform.md` §2.10）：
 *
 *   验收账号每跑一轮就多 2 个 `clientId`（手机装一次包、笔记本建一次库）。
 *   累积到 **21 个** 之后，`limitVectorClockSize` 把每个时钟裁到 20 条，
 *   **削掉计数最低的一项**。被削过的时钟不再支配服务端 head（head 里有那一项），
 *   于是服务端把该设备写的**每一条** op 判成 `CONFLICT_CONCURRENT` 并拒绝 ——
 *   而客户端只能报"同步不上"，表现成"手机没有报冲突"这种指向完全错误的现象。
 *
 *   🔴 更要命的是：**服务端的 head 自己也被裁到同一个上限**，而两边决定
 *   "保留哪些条目"的规则**并不一样** —— 服务端保护 `op.clientId + protectedIds`
 *   （即 head 已知的 id），客户端**只保护自己的 clientId**。
 *   所以"客户端与服务端各自裁剪"这个形状本身就是错的：
 *   只要真实时钟超过上限，永久拒绝是**必然后果**，不是偶发。
 *
 * 已做的决定（**ADR-0008**）：上限从 **20 提到 100**，并在真的裁剪时打 warning。
 * ⚠️ 这是**把墙挪远，不是把墙拆掉**。所以下面同时钉住两件事：
 *
 *   ① 旧故障场景（21 个 client）**现在不再触发裁剪** —— 回归守卫，
 *      它红了就说明上限又被降到 21 以下了；
 *   ② 墙仍然在：到上限+1 时照样会丢因果信息、照样判并发 —— 限制没有被假装解决。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  MAX_VECTOR_CLOCK_SIZE,
  compareVectorClocks,
  limitVectorClockSize,
} from '@heyta/sync-core';
import type { VectorClock } from '@heyta/sync-core';

/**
 * 造一个"服务端 head"：`peerCount` 个历史 client + 手机。
 * 前缀故意用小写字母，保证它们在字典序里排在 `phone` / `laptop` 之前 ——
 * 让"谁会被丢掉"这件事有确定答案，而不是依赖运气。
 */
function makeServerHead(peerCount: number): VectorClock {
  const head: VectorClock = {};
  for (let i = 0; i < peerCount; i += 1) {
    head[`peer-${String(i).padStart(3, '0')}`] = 1;
  }
  head['phone'] = 2;
  return head;
}

describe('向量时钟裁剪上限（已知限制，见 P2 §2.10 / ADR-0008）', () => {
  it('上限就是 100 —— 改这个数字会让本文件变红，那正是它存在的意义', () => {
    expect(MAX_VECTOR_CLOCK_SIZE).toBe(100);
  });

  it('🛡️ 回归守卫：旧故障场景（21 个 client）现在**不再**触发裁剪，写入不再被判并发', () => {
    // 这正是当初必红的那一轮：head 20 项，本设备第 21 项。
    const head = makeServerHead(19);
    const mine = 'laptop';
    const seen: VectorClock = { ...head, [mine]: 1 };

    expect(Object.keys(head)).toHaveLength(20);
    expect(Object.keys(seen)).toHaveLength(21);

    const result = limitVectorClockSize(seen, [mine]);

    // ① 一条都没被丢 —— **这才是"旧故障已不复现"的判据**
    expect(Object.keys(result)).toHaveLength(21);
    // ② 返回的就是原对象（`entries.length <= MAX` 的早退分支）
    expect(result).toBe(seen);
    // ③ 因此它仍然支配 head，服务端不会再判并发
    expect(compareVectorClocks(result, head)).toBe('GREATER_THAN');
  });

  it('🔴 墙还在：到上限+1 时照样削掉一项，同一份输入**不削就支配 head、削了就判并发**', () => {
    // head 正好等于上限，本设备是第 MAX+1 项。
    const head = makeServerHead(MAX_VECTOR_CLOCK_SIZE - 1);
    const mine = 'laptop';
    const seen: VectorClock = { ...head, [mine]: 1 };

    expect(Object.keys(head)).toHaveLength(MAX_VECTOR_CLOCK_SIZE);
    expect(Object.keys(seen)).toHaveLength(MAX_VECTOR_CLOCK_SIZE + 1);

    // ① 不裁剪：本设备的时钟确实支配服务端 head
    expect(compareVectorClocks(seen, head)).toBe('GREATER_THAN');

    // ② 裁剪后（生产里 `recover()` / 每次合并都会过这一道）
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const trimmed = limitVectorClockSize(seen, [mine]);
    warn.mockRestore();

    // 自己的 clientId 必须被保留 —— 被裁掉的话本地写入就不再是自己时钟的递增
    expect(trimmed[mine]).toBe(1);
    expect(Object.keys(trimmed)).toHaveLength(MAX_VECTOR_CLOCK_SIZE);

    // 恰好少了一项，而且少的正是 head 里的一项
    const dropped = Object.keys(seen).filter((k) => trimmed[k] === undefined);
    expect(dropped).toHaveLength(1);
    expect(head[dropped[0]!]).toBeDefined();

    // ③ 于是服务端会判**并发**，并拒绝这条写入 —— 这就是线上故障的形状
    expect(compareVectorClocks(trimmed, head)).toBe('CONCURRENT');
  });

  it('🔔 真的裁剪时必须打 warning —— 上一次这个故障是**静默**的', () => {
    const head = makeServerHead(MAX_VECTOR_CLOCK_SIZE - 1);
    const seen: VectorClock = { ...head, laptop: 1 };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    limitVectorClockSize(seen, ['laptop']);
    expect(warn).toHaveBeenCalledTimes(1);
    // 日志里必须带上实际条数与上限，否则拿到日志也不知道离墙多远
    const msg = String(warn.mock.calls[0]?.[0] ?? '');
    expect(msg).toContain(String(MAX_VECTOR_CLOCK_SIZE + 1));
    expect(msg).toContain(String(MAX_VECTOR_CLOCK_SIZE));
    expect(msg).toContain('ADR-0008');
    warn.mockRestore();
  });

  it('🔕 没超限时**不许**打 warning —— 否则这条日志会变成噪音、被无视', () => {
    const small: VectorClock = { a: 1, b: 2 };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    limitVectorClockSize(small, []);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('被丢掉的规则是可预测的：计数高的优先，同计数时字典序小的优先', () => {
    // 造 MAX+5 个同计数条目，外加一个高计数条目
    const clock: VectorClock = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 5; i += 1) {
      clock[`c-${String(i).padStart(3, '0')}`] = 1;
    }
    clock['hot'] = 9;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const trimmed = limitVectorClockSize(clock, []);
    warn.mockRestore();

    expect(Object.keys(trimmed)).toHaveLength(MAX_VECTOR_CLOCK_SIZE);
    // 计数最高的那条一定在
    expect(trimmed['hot']).toBe(9);
    // 保留的是字典序最小的一批，字典序最大的被丢掉
    expect(trimmed['c-000']).toBe(1);
    expect(trimmed['c-104']).toBeUndefined();
  });

  it('不超过上限时原样返回（不做无谓的重建）', () => {
    const small: VectorClock = { a: 1, b: 2 };
    expect(limitVectorClockSize(small, [])).toBe(small);
  });
});
