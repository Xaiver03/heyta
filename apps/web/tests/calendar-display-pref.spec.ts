/**
 * 日历「显示设置」—— 模型层判据（覆盖图谱 #40）
 * ==============================================
 *
 * 钉三件事，全部是**能失败的模型层断言**，不靠渲染层钉形状：
 *
 * 1. `parseCalendarDisplayPref` 的**逐字段兜底**：坏值 / 缺字段 / 非对象都退默认，
 *    且"一个字段坏了不连累其它字段"。
 * 2. `save` → `load` 的**往返**与**键名**（`heyta.` 前缀 —— 本地数据销毁按前缀清）。
 * 3. `resolveCalendarBarAccent` 的三档**真效果**：off→undefined、priority→优先级色、
 *    list→清单色、无清单→undefined。
 * 4. store 的三项 setter **真写回** `localStorage`（"界面变了但没存"这一类回归）。
 */

import { Priority } from '@heyta/domain';
import type { Task } from '@heyta/domain';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  CALENDAR_DISPLAY_STORAGE_KEY,
  DEFAULT_CALENDAR_DISPLAY,
  loadCalendarDisplayPref,
  parseCalendarDisplayPref,
  resolveCalendarBarAccent,
  saveCalendarDisplayPref,
} from '../src/features/calendar/calendar-display-pref.js';

function taskWith(patch: Partial<Task>): Task {
  return { id: 't1', title: 'x', ...patch } as unknown as Task;
}

beforeEach(() => {
  localStorage.clear();
});

describe('parseCalendarDisplayPref', () => {
  it('非对象 / null / 数组 ⇒ 全默认', () => {
    expect(parseCalendarDisplayPref(null)).toEqual(DEFAULT_CALENDAR_DISPLAY);
    expect(parseCalendarDisplayPref('nope')).toEqual(DEFAULT_CALENDAR_DISPLAY);
    expect(parseCalendarDisplayPref([1, 2])).toEqual(DEFAULT_CALENDAR_DISPLAY);
    expect(parseCalendarDisplayPref(undefined)).toEqual(DEFAULT_CALENDAR_DISPLAY);
  });

  it('逐字段兜底：只把坏掉的字段退默认，其它字段保留', () => {
    const parsed = parseCalendarDisplayPref({
      showCompleted: false, // 合法
      showCountdown: 'yes', // 坏：非布尔 ⇒ 默认 true
      colorBy: 'rainbow', // 坏：不在三档 ⇒ 默认 list
    });
    expect(parsed).toEqual({ showCompleted: false, showCountdown: true, colorBy: 'list' });
  });

  it('三档颜色模式都认', () => {
    expect(parseCalendarDisplayPref({ colorBy: 'priority' }).colorBy).toBe('priority');
    expect(parseCalendarDisplayPref({ colorBy: 'off' }).colorBy).toBe('off');
    expect(parseCalendarDisplayPref({ colorBy: 'list' }).colorBy).toBe('list');
  });
});

describe('save / load 往返', () => {
  it('存进 heyta. 前缀键，读回来一致', () => {
    saveCalendarDisplayPref({ showCompleted: false, showCountdown: false, colorBy: 'priority' });
    // 🔴 键必须带 `heyta.` 前缀：本地数据销毁只按前缀清（lib/local-data-destruction.ts）。
    expect(localStorage.getItem(CALENDAR_DISPLAY_STORAGE_KEY)).toContain('showCompleted');
    expect(loadCalendarDisplayPref()).toEqual({
      showCompleted: false,
      showCountdown: false,
      colorBy: 'priority',
    });
  });

  it('没有存过 ⇒ 默认值', () => {
    expect(loadCalendarDisplayPref()).toEqual(DEFAULT_CALENDAR_DISPLAY);
  });

  it('存了坏 JSON ⇒ 退回默认，不抛', () => {
    localStorage.setItem(CALENDAR_DISPLAY_STORAGE_KEY, '{ not json');
    expect(loadCalendarDisplayPref()).toEqual(DEFAULT_CALENDAR_DISPLAY);
  });
});

describe('resolveCalendarBarAccent（配色三档真效果）', () => {
  const accentOf = (projectId: string): 'color.category-2' | undefined =>
    projectId === 'p1' ? 'color.category-2' : undefined;

  it('off ⇒ 不着色（undefined）', () => {
    expect(resolveCalendarBarAccent('off', taskWith({ projectId: 'p1', priority: Priority.High }), accentOf)).toBeUndefined();
  });

  it('priority ⇒ 复用优先级色（High / None 各一条）', () => {
    expect(resolveCalendarBarAccent('priority', taskWith({ priority: Priority.High }), accentOf)).toBe('color.priority-high');
    expect(resolveCalendarBarAccent('priority', taskWith({ priority: Priority.None }), accentOf)).toBe('color.priority-none');
    // undefined 优先级与 None 同值（priority-color.ts 的收敛点）。
    expect(resolveCalendarBarAccent('priority', taskWith({}), accentOf)).toBe('color.priority-none');
  });

  it('list ⇒ 所属清单色；无清单 ⇒ undefined', () => {
    expect(resolveCalendarBarAccent('list', taskWith({ projectId: 'p1' }), accentOf)).toBe('color.category-2');
    expect(resolveCalendarBarAccent('list', taskWith({ projectId: 'p2' }), accentOf)).toBeUndefined();
    expect(resolveCalendarBarAccent('list', taskWith({}), accentOf)).toBeUndefined();
  });
});

describe('store setter 真把偏好写回本地存储', () => {
  it('setShowCompleted / setColorBy 之后 load 读得到', async () => {
    const { useCalendarViewStore } = await import('../src/features/calendar/store.js');
    useCalendarViewStore.getState().setShowCompleted(false);
    useCalendarViewStore.getState().setColorBy('priority');
    const persisted = loadCalendarDisplayPref();
    expect(persisted.showCompleted).toBe(false);
    expect(persisted.colorBy).toBe('priority');
    // 未动的字段保持默认（不因为改别的字段被清空）。
    expect(persisted.showCountdown).toBe(true);
  });
});
