/**
 * 番茄钟时长设置
 * =================
 *
 * 这一组钉的是 `setConfig` **零调用点**那个洞（见
 * `docs/research/dida365-feature-benchmark.md` §3 #8）：store 一直有 `setConfig`，
 * 但没有任何界面调用它，于是时长永远 25/5/15。
 *
 * 补 UI 之后真正要保证的是三件事，缺一件这个功能就是假的：
 *   1. **改了真的生效** —— 下一轮 `plannedMs` 用新值（不是只改了 store 里的字段）；
 *   2. **刷新后还在** —— 否则"设置"是个假控件；
 *   3. **进行中改不了，而且不是静默拒绝** —— 返回 `false` 让界面能解释。
 *
 * 外加一条容易漏的：**输入越界要被夹住**，不能出现 0 分钟的番茄钟
 * （那会让计时器一开始就结束，疯狂落盘垃圾 `FOCUS_SESSION`）。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_FOCUS_CONFIG } from '@heyta/domain';

import {
  __clearFocusConfigForTests,
  FOCUS_CONFIG_BOUNDS,
  clampFocusDraft,
  draftToFocusConfig,
  focusConfigToDraft,
  loadFocusConfig,
  saveFocusConfig,
} from '../src/lib/focus-config.js';
import { __resetFocusForTests, useFocusStore } from '../src/features/focus/store.js';

const MINUTE_MS = 60_000;

beforeEach(() => {
  __clearFocusConfigForTests();
  __resetFocusForTests();
});

describe('时长设置的合法性（纯函数）', () => {
  it('越界值被夹到边界，而不是被拒绝或原样接受', () => {
    const clamped = clampFocusDraft({
      workMinutes: 0,
      shortBreakMinutes: 999,
      longBreakMinutes: -3,
      longBreakEvery: 1,
    });
    expect(clamped.workMinutes).toBe(FOCUS_CONFIG_BOUNDS.workMinutes.min);
    expect(clamped.shortBreakMinutes).toBe(FOCUS_CONFIG_BOUNDS.shortBreakMinutes.max);
    expect(clamped.longBreakMinutes).toBe(FOCUS_CONFIG_BOUNDS.longBreakMinutes.min);
    expect(clamped.longBreakEvery).toBe(FOCUS_CONFIG_BOUNDS.longBreakEvery.min);
  });

  it('🔴 非整数与非法类型回落到默认值（`2.5` 个专注没有意义）', () => {
    const clamped = clampFocusDraft({
      workMinutes: 2.5,
      shortBreakMinutes: Number.NaN,
      longBreakMinutes: Number.POSITIVE_INFINITY,
    });
    const defaults = focusConfigToDraft(DEFAULT_FOCUS_CONFIG);
    expect(clamped.workMinutes).toBe(defaults.workMinutes);
    expect(clamped.shortBreakMinutes).toBe(defaults.shortBreakMinutes);
    expect(clamped.longBreakMinutes).toBe(defaults.longBreakMinutes);
  });

  it('毫秒与分钟的往返不丢精度', () => {
    const config = { workMs: 40 * MINUTE_MS, shortBreakMs: 7 * MINUTE_MS, longBreakMs: 20 * MINUTE_MS, longBreakEvery: 3 };
    expect(draftToFocusConfig(focusConfigToDraft(config))).toEqual(config);
  });
});

describe('时长设置的持久化', () => {
  it('没存过时读回默认值', () => {
    expect(loadFocusConfig()).toEqual(DEFAULT_FOCUS_CONFIG);
  });

  it('存了就读得回来', () => {
    saveFocusConfig(draftToFocusConfig({ workMinutes: 40 }));
    expect(loadFocusConfig().workMs).toBe(40 * MINUTE_MS);
  });

  it('🔴 存进去的永远是夹取后的值 —— 非法值到不了磁盘', () => {
    // 绕过 UI 直接写一个越界值（模拟别处误用）
    saveFocusConfig({ workMs: 0, shortBreakMs: 0, longBreakMs: 0, longBreakEvery: 0 });
    const loaded = loadFocusConfig();
    expect(loaded.workMs).toBe(FOCUS_CONFIG_BOUNDS.workMinutes.min * MINUTE_MS);
    expect(loaded.longBreakEvery).toBe(FOCUS_CONFIG_BOUNDS.longBreakEvery.min);
  });

  it('🔴 坏掉的 JSON 不会让整份设置丢掉（逐字段回落）', () => {
    localStorage.setItem('heyta.focus-config', '{ 这不是 JSON');
    expect(loadFocusConfig()).toEqual(DEFAULT_FOCUS_CONFIG);
  });

  it('🔴 只写坏一个字段时，其余字段保留用户的值', () => {
    localStorage.setItem(
      'heyta.focus-config',
      JSON.stringify({ workMinutes: 40, shortBreakMinutes: 'x', longBreakMinutes: 20, longBreakEvery: 3 }),
    );
    const loaded = loadFocusConfig();
    expect(loaded.workMs).toBe(40 * MINUTE_MS);
    expect(loaded.longBreakMs).toBe(20 * MINUTE_MS);
    // 坏的那一个回落，其余不受影响
    expect(loaded.shortBreakMs).toBe(DEFAULT_FOCUS_CONFIG.shortBreakMs);
  });
});

describe('store：改了真的生效', () => {
  it('🔴 改时长之后，下一轮的 plannedMs 用新值（不是只改了 store 字段）', () => {
    const ok = useFocusStore.getState().setConfig({ workMs: 40 * MINUTE_MS });
    expect(ok).toBe(true);
    expect(useFocusStore.getState().config.workMs).toBe(40 * MINUTE_MS);

    useFocusStore.getState().start();
    // 判据取 `plannedMs`：进度环与落盘的 FocusSession 都用它，
    // 所以它变了才叫"真的生效"。
    expect(useFocusStore.getState().state.plannedMs).toBe(40 * MINUTE_MS);
  });

  it('🔴 改完刷新还在（走 localStorage，不是只活在内存里）', () => {
    useFocusStore.getState().setConfig({ workMs: 45 * MINUTE_MS });
    // 直接读持久化层：等价于"下一次冷启动时 store 初始化读到的东西"
    expect(loadFocusConfig().workMs).toBe(45 * MINUTE_MS);
  });

  it('🔴 计时进行中拒绝改，并返回 false（让界面能解释为什么灰着）', () => {
    useFocusStore.getState().start();
    expect(useFocusStore.getState().state.phase).toBe('running');

    const ok = useFocusStore.getState().setConfig({ workMs: 99 * MINUTE_MS });

    expect(ok).toBe(false);
    expect(useFocusStore.getState().config.workMs).toBe(DEFAULT_FOCUS_CONFIG.workMs);
    // 而且**没有**落盘 —— 否则刷新后这个被拒绝的值会偷偷生效
    expect(loadFocusConfig().workMs).toBe(DEFAULT_FOCUS_CONFIG.workMs);
  });

  it('中止之后又能改了', async () => {
    useFocusStore.getState().start();
    expect(useFocusStore.getState().setConfig({ workMs: 99 * MINUTE_MS })).toBe(false);

    await useFocusStore.getState().abort();

    expect(useFocusStore.getState().state.phase).toBe('idle');
    expect(useFocusStore.getState().setConfig({ workMs: 99 * MINUTE_MS })).toBe(true);
  });
});
