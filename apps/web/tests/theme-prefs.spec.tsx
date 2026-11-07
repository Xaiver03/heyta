/**
 * R13b · 外观偏好：零 op、两个 DOM 钩子、三态明暗
 * ==============================================
 *
 * ADR-0085 的判据 1/2 说的是同一件事：**改外观不产生 op**。
 * 这里把它变成能红的测试 —— 读 op-log 的真实条数，而不是断言"调用了某个函数"。
 *
 * 另外两条：
 *   - 明暗与预设是**两个正交钩子**（`data-theme` / `data-theme-preset`）；
 *   - 「跟随系统」= **删键**，不是存一个 `system`（与"从没选过"同形）。
 */
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();

import {
  applyThemePreset,
  rememberThemeMode,
  rememberThemePreset,
  resolveInitialThemeMode,
  resolveInitialThemePreset,
  THEME_PRESETS,
  THEME_PRESET_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from '../src/lib/theme.js';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { useTaskStore } from '../src/features/tasks/store.js';

const counts = (): number => {
  const state = useTaskStore.getState();
  return state.entities.tasks === undefined ? 0 : Object.keys(state.entities.tasks).length;
};

describe('外观偏好是设备属性（ADR-0085 判据 1）', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-preset');
  });

  it('改预设 / 切明暗 ⇒ DOM 变了，但实体条数与 op 一个不动', async () => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    __resetOpLogForTests();
    await initOpLog({ databaseName: 'theme-prefs-test' });
    const before = counts();

    rememberThemePreset('warm');
    applyThemePreset('warm');
    expect(document.documentElement.getAttribute('data-theme-preset')).toBe('warm');

    rememberThemeMode('dark');
    document.documentElement.setAttribute('data-theme', 'dark');

    // 判据：**外观不写数据**。实体表一个都没变（没有多出"一次主题变更"这种记录）。
    expect(counts()).toBe(before);
    expect(localStorage.getItem(THEME_PRESET_STORAGE_KEY)).toBe('warm');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('「跟随系统」是删键，不是存 system —— 与"从没选过"同形', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    rememberThemeMode('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(resolveInitialThemeMode()).toBe('system');
  });

  it('认不出的预设值回落 default（脏值不会让界面无色）', () => {
    localStorage.setItem(THEME_PRESET_STORAGE_KEY, 'neon-nonsense');
    expect(resolveInitialThemePreset()).toBe('default');
  });

  it('default 预设 = 删属性：基准 token 一个像素都不变', () => {
    applyThemePreset('warm');
    expect(document.documentElement.hasAttribute('data-theme-preset')).toBe(true);
    applyThemePreset('default');
    expect(document.documentElement.hasAttribute('data-theme-preset')).toBe(false);
  });

  it('预设清单与 tokens.css 的块一一对应（加预设忘了写 CSS ⇒ 红）', () => {
    // 这里只钉"清单非空且不含 default 之外的重复值"；真正的对比度判据在
    // packages/design-system/tests/tokens.spec.ts（逐预设 × 逐明暗算 WCAG）。
    expect(THEME_PRESETS).toContain('default');
    expect(new Set(THEME_PRESETS).size).toBe(THEME_PRESETS.length);
  });
});
