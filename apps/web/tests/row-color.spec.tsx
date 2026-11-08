/**
 * 行着色三态（**只有清单图标着色**，产品拍板 2026-11-08）
 * ======================================================
 *
 * 三件必须能红的事：
 *   1. **零 op**：改档位只写本机，op-log / 实体条数一个不动（ADR-0085）；
 *   2. **按标签必须经 `resolveTagIds`**：合并过的任务不能读成"没有标签色"；
 *   3. **认不出就回落**：`Project.color` 存的是槽位号，给个非槽位值必须不着色，
 *      而不是随便画一个色。
 */
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();

import { CATEGORY_SLOT_TOKEN_BY_SLOT } from '@heyta/design-system';
import type { TaskRow } from '@heyta/ui';

import {
  loadRowColorMode,
  ROW_COLOR_STORAGE_KEY,
  saveRowColorMode,
  DEFAULT_ROW_COLOR_MODE,
} from '../src/features/tasks/row-color-pref.js';
import { rowIconColorToken, toIconColorToken } from '../src/features/tasks/row-color.js';

/** 造一行最小可用的 `TaskRow`（只填 `rowIconColorToken` 会读到的字段）。 */
function rowOf(source: Partial<Record<string, unknown>>): TaskRow {
  return {
    id: 't1',
    title: 'x',
    done: false,
    important: false,
    dueAt: null,
    source,
  } as unknown as TaskRow;
}

const TAGS = {
  b: { id: 'b', name: 'B', color: '2' },
  // A 合并进了 B（墓碑），而任务的 tagIds 里**仍然留着 A**。
  a: { id: 'a', name: 'A', mergedInto: 'b', deletedAt: 1 },
};

describe('行着色：三态解析', () => {
  it('off ⇒ 不着色（共享层据此**不渲染**节点）', () => {
    const row = rowOf({ projectId: 'p1' });
    expect(
      rowIconColorToken(row, 'off', { projects: { p1: { id: 'p1', name: 'P', color: '1' } }, tags: {} }),
    ).toBeUndefined();
  });

  it('project ⇒ 该清单的色槽位对应的 token', () => {
    const row = rowOf({ projectId: 'p1' });
    expect(
      rowIconColorToken(row, 'project', {
        projects: { p1: { id: 'p1', name: 'P', color: '3' } },
        tags: {},
      }),
    ).toBe(CATEGORY_SLOT_TOKEN_BY_SLOT[3]);
  });

  it('project 档：未归属（收集箱）⇒ 不着色', () => {
    // "未归属" = `projectId` **字段不存在**，不是 null。
    expect(rowIconColorToken(rowOf({}), 'project', { projects: {}, tags: {} })).toBeUndefined();
  });

  it('tag 档：**经 resolveTagIds** —— 只挂着已合并标签 A 的任务仍能拿到 B 的色', () => {
    const row = rowOf({ tagIds: ['a'] });
    expect(rowIconColorToken(row, 'tag', { projects: {}, tags: TAGS })).toBe(
      CATEGORY_SLOT_TOKEN_BY_SLOT[2],
    );
  });

  it('tag 档：反向臂 —— 拿存活表解析会读成"没有色"（这正是不许直接用 tagIds 的理由）', () => {
    const row = rowOf({ tagIds: ['a'] });
    // 只给 B（存活表里没有 A）⇒ A 解析不出来 ⇒ 不着色。
    // 这不是"另一个正确答案"，而是"用错表时的读数"，钉在这里防回归。
    expect(
      rowIconColorToken(row, 'tag', { projects: {}, tags: { b: TAGS.b } }),
    ).toBeUndefined();
  });
});

describe('色值：认不出就回落，不猜', () => {
  it('槽位号 1–8 才映射', () => {
    expect(toIconColorToken('5')).toBe(CATEGORY_SLOT_TOKEN_BY_SLOT[5]);
  });

  it.each(['', '0', '9', 'blue', '#ff0000', 'rgb(1,2,3)'])('认不出的 %j ⇒ undefined', (raw) => {
    expect(toIconColorToken(raw)).toBeUndefined();
  });
});

describe('偏好：设备属性，零 op', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('默认按清单', () => {
    expect(loadRowColorMode()).toBe(DEFAULT_ROW_COLOR_MODE);
    expect(DEFAULT_ROW_COLOR_MODE).toBe('project');
  });

  it('存得进、读得回；脏值回落默认', () => {
    saveRowColorMode('off');
    expect(loadRowColorMode()).toBe('off');
    localStorage.setItem(ROW_COLOR_STORAGE_KEY, JSON.stringify('nonsense'));
    expect(loadRowColorMode()).toBe('project');
  });

  it('改档位**不产生 op**（只写 localStorage）', async () => {
    const { useTaskStore } = await import('../src/features/tasks/store.js');
    const before = Object.keys(useTaskStore.getState().entities.tasks).length;
    saveRowColorMode('tag');
    expect(localStorage.getItem(ROW_COLOR_STORAGE_KEY)).toBe(JSON.stringify('tag'));
    expect(Object.keys(useTaskStore.getState().entities.tasks).length).toBe(before);
  });
});
