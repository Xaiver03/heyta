import { beforeEach, describe, expect, it, vi } from 'vitest';

const prefsStore = vi.hoisted(() => ({
  values: new Map<string, string>(),
  writable: true,
}));

vi.mock('../src/prefs/device-prefs', () => ({
  readDevicePref: (key: string) => prefsStore.values.get(key),
  writeDevicePref: (key: string, value: string) => {
    if (!prefsStore.writable) return false;
    prefsStore.values.set(key, value);
    return true;
  },
}));

import {
  DEFAULT_TAB_BAR_WORKSPACES,
  TAB_BAR_WORKSPACE_KEYS,
  PREF_KEY_TAB_BAR_WORKSPACES,
  normalizeWorkspaceKeys,
  readTabBarWorkspaces,
  resetTabBarWorkspaces,
  writeTabBarWorkspaces,
  type WorkspaceKey,
} from '../src/nav/tab-preferences';

beforeEach(() => {
  prefsStore.values.clear();
  prefsStore.writable = true;
});

describe('工作空间清单与默认值', () => {
  it('只允许六个可固定的工作空间，profile 由壳固定而不进入清单', () => {
    expect(TAB_BAR_WORKSPACE_KEYS).toEqual([
      'tasks',
      'calendar',
      'focus',
      'ai',
      'habits',
      'countdown',
    ]);
    expect(TAB_BAR_WORKSPACE_KEYS).not.toContain('profile');
  });

  it('默认前四格依次为 tasks、calendar、focus、ai', () => {
    expect(DEFAULT_TAB_BAR_WORKSPACES).toEqual(['tasks', 'calendar', 'focus', 'ai']);
    expect(normalizeWorkspaceKeys(undefined)).toEqual(DEFAULT_TAB_BAR_WORKSPACES);
    expect(normalizeWorkspaceKeys(undefined)).not.toBe(DEFAULT_TAB_BAR_WORKSPACES);
  });
});

describe('normalizeWorkspaceKeys 严格校验', () => {
  it('重复工作空间视为非法并回默认', () => {
    expect(normalizeWorkspaceKeys(['tasks', 'tasks', 'focus'])).toEqual(
      DEFAULT_TAB_BAR_WORKSPACES,
    );
  });

  it.each([
    ['未知 key', ['tasks', 'unknown']],
    ['profile', ['tasks', 'profile']],
    ['已撤出底栏的 categories', ['tasks', 'categories']],
    ['非字符串成员', ['tasks', 1]],
  ])('%s 回默认', (_name, value) => {
    expect(normalizeWorkspaceKeys(value)).toEqual(DEFAULT_TAB_BAR_WORKSPACES);
  });

  it('接受两个工作空间并保留顺序', () => {
    expect(normalizeWorkspaceKeys(['habits', 'tasks'])).toEqual(['habits', 'tasks']);
  });

  it('接受四个工作空间并保留顺序', () => {
    expect(normalizeWorkspaceKeys(['countdown', 'ai', 'calendar', 'focus'])).toEqual([
      'countdown',
      'ai',
      'calendar',
      'focus',
    ]);
  });

  it.each([
    ['空数组', []],
    ['只有一个', ['tasks']],
    ['超过四个', ['tasks', 'calendar', 'focus', 'ai', 'habits']],
    ['非数组', { workspaces: ['tasks', 'focus'] }],
    ['null', null],
  ])('%s 回默认', (_name, value) => {
    expect(normalizeWorkspaceKeys(value)).toEqual(DEFAULT_TAB_BAR_WORKSPACES);
  });
});

describe('设备本地读写', () => {
  it('没有保存值时读取默认配置', () => {
    expect(readTabBarWorkspaces()).toEqual(DEFAULT_TAB_BAR_WORKSPACES);
  });

  it.each(['', '{broken', 'null', '"tasks"', '[1,2]'])('损坏值 %j 回默认且不抛', (raw) => {
    prefsStore.values.set(PREF_KEY_TAB_BAR_WORKSPACES, raw);
    expect(() => readTabBarWorkspaces()).not.toThrow();
    expect(readTabBarWorkspaces()).toEqual(DEFAULT_TAB_BAR_WORKSPACES);
  });

  it('使用约定键写入 JSON，并可读回相同顺序', () => {
    const value: readonly WorkspaceKey[] = ['habits', 'tasks'];
    expect(writeTabBarWorkspaces(value)).toBe(true);
    expect(PREF_KEY_TAB_BAR_WORKSPACES).toBe('tab-bar.workspaces');
    expect(prefsStore.values.get(PREF_KEY_TAB_BAR_WORKSPACES)).toBe(JSON.stringify(value));
    expect(readTabBarWorkspaces()).toEqual(value);
  });

  it('重排就是按新顺序写入并读回', () => {
    expect(
      writeTabBarWorkspaces(['ai', 'focus', 'calendar', 'tasks']),
    ).toBe(true);
    expect(readTabBarWorkspaces()).toEqual(['ai', 'focus', 'calendar', 'tasks']);
  });

  it('恢复默认会覆盖自定义顺序', () => {
    expect(writeTabBarWorkspaces(['countdown', 'habits'])).toBe(true);
    expect(resetTabBarWorkspaces()).toBe(true);
    expect(readTabBarWorkspaces()).toEqual(DEFAULT_TAB_BAR_WORKSPACES);
  });

  it.each([
    ['重复项', ['tasks', 'tasks']],
    ['非法 key', ['tasks', 'profile']],
    ['数量不足', ['tasks']],
    ['数量过多', ['tasks', 'calendar', 'focus', 'ai', 'habits']],
  ])('拒绝写入%s', (_name, value) => {
    expect(
      writeTabBarWorkspaces(value as unknown as readonly WorkspaceKey[]),
    ).toBe(false);
    expect(prefsStore.values.has(PREF_KEY_TAB_BAR_WORKSPACES)).toBe(false);
  });

  it('底层写入失败时返回 false 且不抛', () => {
    prefsStore.writable = false;
    expect(() => writeTabBarWorkspaces(['tasks', 'focus'])).not.toThrow();
    expect(writeTabBarWorkspaces(['tasks', 'focus'])).toBe(false);
  });
});
