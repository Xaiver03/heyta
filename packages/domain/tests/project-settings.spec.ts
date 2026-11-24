/**
 * 清单设置（图标闭集 / 视图枚举 / 类型枚举 / 缺省）测试
 * ====================================================
 *
 * 这个模块错了不报错，只在界面上"看起来有点怪"或"设了没生效"，所以逐条钉住：
 *
 * **图标词表**：必须是闭集 key，且解析不认识的值返回 `undefined` —— 不许回退成第一项
 * （回退的症状是一堆不相干的清单全变成同一个图标，任何一层都不报错）。
 *
 * **视图 / 类型枚举**：非白名单值必须被拒（`undefined`），因为它们最终要写进磁盘并
 * 被四个端解析；放行一个拼错的 `'kanban'` 会让"设了看板但没变"。
 *
 * **缺省**：`viewMode` 缺省 list、`kind` 缺省 tasks、`showInSmartList` 缺省 true。
 * 缺省只有一个出口（`*Of`），测试钉住它，防止各端自己写 `?? 'list'` 漂成第二份。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_KIND,
  DEFAULT_PROJECT_SHOW_IN_SMART_LIST,
  DEFAULT_PROJECT_VIEW_MODE,
  PROJECT_ICONS,
  PROJECT_KINDS,
  PROJECT_VIEW_MODES,
  parseProjectIcon,
  parseProjectKind,
  parseProjectViewMode,
  projectKindOf,
  projectShowInSmartListOf,
  projectViewModeOf,
} from '../src/project-settings.js';

describe('图标词表（闭集）', () => {
  it('是有限的闭集，且每项都是短的非空 key（不是字形名、不是颜色）', () => {
    expect(PROJECT_ICONS.length).toBeGreaterThan(0);
    for (const key of PROJECT_ICONS) {
      expect(typeof key).toBe('string');
      expect(key.trim()).toBe(key);
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('词表内去重（重复项会让选择器里出现两个一样的图标）', () => {
    expect(new Set(PROJECT_ICONS).size).toBe(PROJECT_ICONS.length);
  });

  it('认识的 key 解析回自身', () => {
    for (const key of PROJECT_ICONS) {
      expect(parseProjectIcon(key)).toBe(key);
    }
  });

  it('🔴 不认识的值一律 `undefined`（不回退第一项、不抛错）', () => {
    expect(parseProjectIcon('not-an-icon')).toBeUndefined();
    expect(parseProjectIcon('')).toBeUndefined();
    expect(parseProjectIcon(undefined)).toBeUndefined();
    expect(parseProjectIcon(null)).toBeUndefined();
    expect(parseProjectIcon(123)).toBeUndefined();
    // 字形名不是 key —— 存进磁盘等于换库就改数据
    expect(parseProjectIcon('Briefcase')).toBeUndefined();
  });

  it('前后空白会被剪掉再匹配', () => {
    expect(parseProjectIcon('  star  ')).toBe('star');
  });
});

describe('视图类型枚举', () => {
  it('只认 list / board / calendar / timeline', () => {
    expect(PROJECT_VIEW_MODES).toEqual(['list', 'board', 'calendar', 'timeline']);
    for (const mode of PROJECT_VIEW_MODES) {
      expect(parseProjectViewMode(mode)).toBe(mode);
    }
  });

  it('🔴 非白名单值被拒（拼错的枚举不许落库）', () => {
    expect(parseProjectViewMode('kanban')).toBeUndefined();
    expect(parseProjectViewMode('grid')).toBeUndefined();
    expect(parseProjectViewMode('')).toBeUndefined();
    expect(parseProjectViewMode(undefined)).toBeUndefined();
    expect(parseProjectViewMode(1)).toBeUndefined();
  });
});

describe('清单类型枚举', () => {
  it('只认 tasks / notes', () => {
    expect(PROJECT_KINDS).toEqual(['tasks', 'notes']);
    for (const kind of PROJECT_KINDS) {
      expect(parseProjectKind(kind)).toBe(kind);
    }
  });

  it('🔴 非白名单值被拒', () => {
    expect(parseProjectKind('note')).toBeUndefined();
    expect(parseProjectKind('TASKS')).toBeUndefined();
    expect(parseProjectKind('')).toBeUndefined();
    expect(parseProjectKind(undefined)).toBeUndefined();
  });
});

describe('运行时缺省（唯一出口）', () => {
  it('没设过时：视图 list / 类型 tasks / 智能清单 true', () => {
    expect(DEFAULT_PROJECT_VIEW_MODE).toBe('list');
    expect(DEFAULT_PROJECT_KIND).toBe('tasks');
    expect(DEFAULT_PROJECT_SHOW_IN_SMART_LIST).toBe(true);

    expect(projectViewModeOf({})).toBe('list');
    expect(projectKindOf({})).toBe('tasks');
    expect(projectShowInSmartListOf({})).toBe(true);
  });

  it('设过就用显式值；非法值退回缺省', () => {
    expect(projectViewModeOf({ viewMode: 'board' })).toBe('board');
    expect(projectKindOf({ kind: 'notes' })).toBe('notes');
    expect(projectShowInSmartListOf({ showInSmartList: false })).toBe(false);

    // 磁盘上的脏值（历史 / 手改）退回缺省，不崩
    expect(projectViewModeOf({ viewMode: 'nope' })).toBe('list');
    expect(projectKindOf({ kind: 'nope' })).toBe('tasks');
  });
});
