/**
 * 专注共享模型的测试
 * ====================
 *
 * 这里挑的都是**不报错、只会画错**的边界：空闲时该显示整轮还是 00:00、
 * 暂停之后主按钮该"继续"还是"重新开始"、秒数该进位还是截断。
 * 它们全都能编译、能运行，只会在屏幕上呈现成另一件事。
 *
 * ⚠️ 这个测试跑在 **node** 环境（`vitest.config.ts` 文件头有理由）：
 * `packages/ui` 不引入 DOM 测试栈，所以"有判断"的部分必须留在 `model.ts`。
 * 一旦有人在 `model.ts` 里 import 了 `react-native`，这里会立刻失败。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOCUS_CONFIG,
  initialFocusState,
  pause,
  start,
  type FocusConfig,
} from '@heyta/domain';

import {
  FOCUS_KIND_ORDER,
  focusDisplayText,
  focusPrimaryAction,
  focusRoundLengthMs,
  focusTone,
  toFocusViewModel,
} from '../src/focus/model.js';

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

describe('focusPrimaryAction', () => {
  it('空闲 → 开始；运行 → 暂停；暂停 → **继续**（不是重新开始）', () => {
    const idle = initialFocusState();
    expect(focusPrimaryAction(idle)).toBe('start');

    const running = start(idle, T0);
    expect(focusPrimaryAction(running)).toBe('pause');

    const paused = pause(running, T0 + 5 * MINUTE);
    expect(focusPrimaryAction(paused)).toBe('resume');
  });
});

describe('toFocusViewModel', () => {
  it('空闲时显示的是**整轮时长**，不是 00:00（静止的 00:00 看起来像坏了）', () => {
    const vm = toFocusViewModel(initialFocusState(), T0);
    expect(vm.displayMs).toBe(DEFAULT_FOCUS_CONFIG.workMs);
    expect(focusDisplayText(initialFocusState(), T0)).toBe('25:00');
    // "还没开始"与"已经走完"必须是两种不同的样子。
    expect(vm.progress).toBe(0);
    expect(vm.percent).toBe(0);
    expect(vm.idle).toBe(true);
    expect(vm.running).toBe(false);
  });

  it('运行中剩余量由时间戳重算，进度随之增长', () => {
    const running = start(initialFocusState(), T0);
    const vm = toFocusViewModel(running, T0 + 5 * MINUTE);
    expect(vm.remainingMs).toBe(20 * MINUTE);
    expect(vm.displayMs).toBe(20 * MINUTE);
    expect(vm.progress).toBeCloseTo(0.2, 5);
    expect(vm.percent).toBe(20);
    expect(vm.running).toBe(true);
  });

  it('暂停后剩余量冻住 —— 时间往前走，显示不变', () => {
    const paused = pause(start(initialFocusState(), T0), T0 + 5 * MINUTE);
    expect(toFocusViewModel(paused, T0 + 5 * MINUTE).remainingMs).toBe(20 * MINUTE);
    expect(toFocusViewModel(paused, T0 + 30 * MINUTE).remainingMs).toBe(20 * MINUTE);
    expect(toFocusViewModel(paused, T0 + 30 * MINUTE).paused).toBe(true);
  });

  it('超过整轮长度也不会把进度推出 0–1（越界在 RN 里不报错，只画错）', () => {
    const running = start(initialFocusState(), T0);
    const vm = toFocusViewModel(running, T0 + 10 * 60 * MINUTE);
    expect(vm.progress).toBe(1);
    expect(vm.percent).toBe(100);
  });
});

describe('focusDisplayText', () => {
  it('秒数用 ceil：剩 59.4 秒显示 01:00，而不是 00:59（否则像卡住）', () => {
    const config: FocusConfig = { ...DEFAULT_FOCUS_CONFIG, workMs: 60_000 };
    const running = start(initialFocusState(), T0, config);
    expect(focusDisplayText(running, T0 + 600)).toBe('01:00');
    expect(focusDisplayText(running, T0 + 59_600)).toBe('00:01');
  });
});

describe('focusTone / focusRoundLengthMs', () => {
  it('工作段与休息段的色语义不同；时长映射只来自领域层', () => {
    expect(focusTone(initialFocusState())).toBe('work');
    expect(focusTone({ ...initialFocusState(), kind: 'shortBreak' })).toBe('break');
    expect(focusTone({ ...initialFocusState(), kind: 'longBreak' })).toBe('break');

    expect(focusRoundLengthMs('work', DEFAULT_FOCUS_CONFIG)).toBe(25 * MINUTE);
    expect(focusRoundLengthMs('shortBreak', DEFAULT_FOCUS_CONFIG)).toBe(5 * MINUTE);
    expect(focusRoundLengthMs('longBreak', DEFAULT_FOCUS_CONFIG)).toBe(15 * MINUTE);
  });

  it('类型顺序里专注排第一 —— 它是默认，也是一个产品决定', () => {
    expect([...FOCUS_KIND_ORDER]).toEqual(['work', 'shortBreak', 'longBreak']);
  });
});
