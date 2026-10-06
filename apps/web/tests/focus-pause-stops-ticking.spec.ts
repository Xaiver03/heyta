/**
 * 番茄钟的暂停必须**把表也停掉**
 * ==============================
 *
 * ## 这条用例钉的是哪一笔真实的钱
 *
 * `pause()` 原先只写状态机，不管那个 250ms 的 `setInterval` —— 而 interval 的回调
 * `tickOnce()` 在"还没到点"那一支也会 `tick + 1`（注释写着"否则进度环不走"）。
 * 于是点暂停之后：
 *
 *   - interval 继续跑，**每秒 4 次**把 `tick` 自增；
 *   - `FocusTimer` 订阅的是整个 store ⇒ 每 250ms 重渲染一次；
 *   - 切到别的视图它也不停 —— 暂停着的人不在看计时器，浏览器却在替他重渲染。
 *
 * 直到用户点中止才会 `stopTicking()`。这不是"稍微浪费"，是**一个状态语义写错形状**：
 * 暂停的定义就是"没有时间在走"。
 *
 * ## 三段为什么缺一不可
 *
 * 只断"暂停后 `tick` 不动"是**不能自证**的：如果定时器从来就没装上，
 * 或者 `tick` 字段被改名，读数同样是"不动" —— 而那是个假绿。
 * 所以两边各加一条活体证据：
 *
 *   1. 启动后推进 1 秒 ⇒ `tick` **必须**在涨（表装上了、探针够得着）；
 *   2. 暂停后推进 2 秒 ⇒ `tick` **恰好**不动（这一条才是要修的洞）；
 *   3. 恢复后再推进 1 秒 ⇒ `tick` 重新在涨（暂停不是把表拆了）。
 *
 * ⚠️ 第 1 段断的是"至少涨了 3 次"而不是"正好 4 次"：4 是由 `store.ts` 里那个
 * 字面量 250 推导的，把它写死会让"把周期改成 200ms"这种合法改动变成红 ——
 * 判据要钉的是"表在走"，不是"表今天走多快"。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __clearFocusConfigForTests } from '../src/lib/focus-config.js';
import { __resetFocusForTests, useFocusStore } from '../src/features/focus/store.js';

beforeEach(() => {
  __clearFocusConfigForTests();
  __resetFocusForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  __resetFocusForTests();
});

const tick = (): number => useFocusStore.getState().tick;

describe('🔴 暂停 = 表停', () => {
  it('启动在走表 → 暂停后 2 秒一次都不涨 → 恢复后又开始走', () => {
    const store = useFocusStore.getState();

    // ① 活体证据：表确实装上了
    store.start();
    const beforeRun = tick();
    vi.advanceTimersByTime(1000);
    expect(
      tick() - beforeRun,
      '启动后 1 秒内 `tick` 没涨 ⇒ 定时器没装或探针失效，下面那条 0 就不成立',
    ).toBeGreaterThanOrEqual(3);

    // ② 正题：暂停之后不许再涨
    store.pause();
    const atPause = tick();
    vi.advanceTimersByTime(2000);
    expect(
      tick() - atPause,
      '暂停后 `tick` 还在涨 ⇒ 250ms 的 interval 没停，4Hz 空转且跨视图不停',
    ).toBe(0);

    // ③ 反向活体证据：停的是表，不是把表拆了
    store.resume();
    const afterResume = tick();
    vi.advanceTimersByTime(1000);
    expect(
      tick() - afterResume,
      '恢复后表没重新走 ⇒ 上面那个 0 是"根本没在走"而不是"停下来了"',
    ).toBeGreaterThanOrEqual(3);
  });

  it('中止同样停表，而且停的是同一个句柄（不是靠 abort 兜住 pause 的漏）', () => {
    const store = useFocusStore.getState();
    store.start();
    vi.advanceTimersByTime(500);
    store.pause();
    const atPause = tick();

    // 暂停后再中止：如果 `pause()` 没停表，这里就会留下一条已经指向
    // "已复位状态"的 interval —— 它会在下一条用例里继续写 `tick`。
    void store.abort();
    vi.advanceTimersByTime(1000);
    expect(tick() - atPause, '中止之后还在涨 ⇒ 有第二个没被摘掉的句柄').toBeLessThanOrEqual(1);
  });
});
