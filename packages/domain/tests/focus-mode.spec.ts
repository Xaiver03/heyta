/**
 * 专注 · 双模（倒计时 / 正计时）的领域测试
 * ===========================================
 *
 * 挑的都是**能编译、能运行、只会在屏幕上呈现成另一件事**的边界：
 * 正计时起点是 00:00 而不是 25:00；暂停后秒表必须冻住；
 * 「结束」正计时应当记成一次完成；而倒计时的既有行为一个字节都不许变。
 */

import { describe, expect, it } from 'vitest';
import {
  abort,
  focusDisplayMs,
  focusElapsedMs,
  focusProgress,
  initialFocusState,
  isFinished,
  pause,
  remainingMs,
  resume,
  selectMode,
  start,
  type FocusState,
} from '@heyta/domain';

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

function countupIdle(): FocusState {
  return selectMode(initialFocusState(), 'countup');
}

describe('selectMode（只在 idle 生效）', () => {
  it('idle 时切到正计时；运行中切换被忽略', () => {
    expect(countupIdle().mode).toBe('countup');
    const running = start(initialFocusState(), T0);
    expect(selectMode(running, 'countup').mode).toBe('countdown');
  });

  it('切到相同模式返回原对象（不制造无谓重渲染）', () => {
    const idle = initialFocusState();
    expect(selectMode(idle, 'countdown')).toBe(idle);
  });
});

describe('倒计时行为不变（回归）', () => {
  it('空闲显示整轮 25:00；开始后按时长倒数', () => {
    expect(focusDisplayMs(initialFocusState(), T0)).toBe(25 * MINUTE);
    const running = start(initialFocusState(), T0);
    expect(remainingMs(running, T0 + 5 * MINUTE)).toBe(20 * MINUTE);
    expect(focusProgress(running, T0 + 5 * MINUTE)).toBeCloseTo(0.2, 5);
    expect(isFinished(running, T0 + 25 * MINUTE)).toBe(true);
  });

  it('倒计时中止记成 completed:false（放弃），actualMs=已走时长', () => {
    const running = start(initialFocusState(), T0);
    const { finished } = abort(running, T0 + 5 * MINUTE);
    expect(finished?.completed).toBe(false);
    expect(finished?.actualMs).toBe(5 * MINUTE);
  });
});

describe('正计时', () => {
  it('空闲显示 00:00（秒表起点是 0，不是整轮时长）', () => {
    expect(focusDisplayMs(countupIdle(), T0)).toBe(0);
    expect(focusElapsedMs(countupIdle(), T0)).toBe(0);
    expect(focusProgress(countupIdle(), T0)).toBe(0);
  });

  it('开始后从 0 累加；进度恒 0、永不自然到时', () => {
    const running = start(countupIdle(), T0);
    expect(focusDisplayMs(running, T0)).toBe(0);
    expect(focusDisplayMs(running, T0 + 7 * MINUTE + 30_000)).toBe(7 * MINUTE + 30_000);
    expect(focusProgress(running, T0 + 7 * MINUTE)).toBe(0);
    // 即便过了「整轮」时长，正计时也不会自然结束。
    expect(isFinished(running, T0 + 10 * 60 * MINUTE)).toBe(false);
    // 正计时没有「剩余」。
    expect(remainingMs(running, T0 + 5 * MINUTE)).toBe(0);
  });

  it('暂停冻住已走量；恢复后继续从冻结点累加', () => {
    const paused = pause(start(countupIdle(), T0), T0 + 5 * MINUTE);
    expect(focusElapsedMs(paused, T0 + 5 * MINUTE)).toBe(5 * MINUTE);
    expect(focusElapsedMs(paused, T0 + 30 * MINUTE)).toBe(5 * MINUTE);

    const resumed = resume(paused, T0 + 30 * MINUTE);
    // 暂停了 25 分钟不该被计入专注；恢复后再走 2 分钟 = 7 分钟。
    expect(focusElapsedMs(resumed, T0 + 32 * MINUTE)).toBe(7 * MINUTE);
  });

  it('「结束」正计时记成 completed:true，actualMs=已走时长', () => {
    const running = start(countupIdle(), T0);
    const { finished } = abort(running, T0 + 12 * MINUTE);
    expect(finished?.completed).toBe(true);
    expect(finished?.actualMs).toBe(12 * MINUTE);
    expect(finished?.kind).toBe('work');
  });

  it('正计时暂停后结束，记录的是暂停前已走的量', () => {
    const paused = pause(start(countupIdle(), T0), T0 + 9 * MINUTE);
    const { finished } = abort(paused, T0 + 40 * MINUTE);
    expect(finished?.actualMs).toBe(9 * MINUTE);
  });
});
