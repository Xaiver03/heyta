import { describe, expect, it } from 'vitest';
import {
  appendChecklistItem,
  checklistItemReminder,
  checklistItemsWithReminder,
  checklistProgress,
  isChecklistComplete,
  readChecklist,
  removeChecklistItem,
  reorderChecklistItem,
  setChecklistItemReminder,
  shouldAutoCompleteFromChecklist,
  toggleChecklistItem,
  updateChecklistItemText,
  type TaskChecklistItem,
} from '../src/checklist.js';

const item = (id: string, text: string, done = false): TaskChecklistItem => ({ id, text, done });

describe('readChecklist', () => {
  it('结构化优先', () => {
    const task = { checklist: [item('a', '甲', true), item('b', '乙')], note: '- [ ] 旧' };
    expect(readChecklist(task)).toEqual([
      { id: 'a', text: '甲', done: true },
      { id: 'b', text: '乙', done: false },
    ]);
  });
  it('无结构化字段 → 回退 note 的 - [ ] / - [x]', () => {
    expect(readChecklist({ note: '- [ ] 甲\n- [x] 乙' })).toEqual([
      { id: 'note-0', text: '甲', done: false },
      { id: 'note-1', text: '乙', done: true },
    ]);
  });
  it('note 无清单 / 空 → []', () => {
    expect(readChecklist({ note: '随便写写' })).toEqual([]);
    expect(readChecklist({})).toEqual([]);
  });
});

describe('checklistProgress / isChecklistComplete', () => {
  it('n/m', () => {
    expect(checklistProgress([item('a', '', true), item('b', ''), item('c', '', true)])).toEqual({ done: 2, total: 3 });
    expect(checklistProgress([])).toEqual({ done: 0, total: 0 });
  });
  it('全勾判定：空清单不算完成', () => {
    expect(isChecklistComplete([])).toBe(false);
    expect(isChecklistComplete([item('a', '', true), item('b', '', true)])).toBe(true);
    expect(isChecklistComplete([item('a', '', true), item('b', '')])).toBe(false);
  });
});

describe('增删改勾排序（不可变）', () => {
  const base = [item('a', '甲'), item('b', '乙'), item('c', '丙')];
  it('append 不改原数组', () => {
    const next = appendChecklistItem(base, item('d', '丁'));
    expect(next.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(base).toHaveLength(3);
  });
  it('update text', () => {
    expect(updateChecklistItemText(base, 'b', '乙2').find((x) => x.id === 'b')?.text).toBe('乙2');
  });
  it('remove', () => {
    expect(removeChecklistItem(base, 'b').map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('toggle', () => {
    expect(toggleChecklistItem(base, 'a', true).find((x) => x.id === 'a')?.done).toBe(true);
  });
  it('reorder 到指定位置 / 越界夹取 / 未找到原样', () => {
    expect(reorderChecklistItem(base, 'a', 2).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(reorderChecklistItem(base, 'c', 99).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(reorderChecklistItem(base, 'zzz', 0).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('shouldAutoCompleteFromChecklist', () => {
  const normal = {};
  it('全勾 + 普通任务 → true', () => {
    expect(shouldAutoCompleteFromChecklist(normal, [item('a', '', true)])).toBe(true);
  });
  it('未全勾 / 空 → false', () => {
    expect(shouldAutoCompleteFromChecklist(normal, [item('a', '', true), item('b', '')])).toBe(false);
    expect(shouldAutoCompleteFromChecklist(normal, [])).toBe(false);
  });
  it('重复任务 / 已放弃 / 已完成 → false', () => {
    const items = [item('a', '', true)];
    expect(shouldAutoCompleteFromChecklist({ repeatRule: 'FREQ=DAILY' }, items)).toBe(false);
    expect(shouldAutoCompleteFromChecklist({ abandonedAt: 1 }, items)).toBe(false);
    expect(shouldAutoCompleteFromChecklist({ completedAt: 1 }, items)).toBe(false);
  });
});

describe('检查项级提醒（#29，与任务级 Reminder 区分）', () => {
  const base = [item('a', '甲'), item('b', '乙')];

  it('set 写到指定条目，且不改原数组', () => {
    const next = setChecklistItemReminder(base, 'a', 1_700_000_000_000);
    expect(next.find((x) => x.id === 'a')?.reminderAt).toBe(1_700_000_000_000);
    expect(next.find((x) => x.id === 'b')?.reminderAt).toBeUndefined();
    // 不可变：原数组那一条不带提醒
    expect(base[0]?.reminderAt).toBeUndefined();
  });

  it('clear 是把字段摘掉（不是写成 0）', () => {
    const withRem = setChecklistItemReminder(base, 'a', 1_700_000_000_000);
    const cleared = setChecklistItemReminder(withRem, 'a', undefined);
    expect('reminderAt' in (cleared.find((x) => x.id === 'a')!)).toBe(false);
  });

  it('找不到 id → 原样返回副本（不是同一个数组引用）', () => {
    const next = setChecklistItemReminder(base, 'zzz', 123);
    expect(next).toEqual(base);
    expect(next).not.toBe(base);
  });

  it('checklistItemsWithReminder 只取有提醒的；checklistItemReminder 读缺省为 undefined', () => {
    const list = setChecklistItemReminder(base, 'b', 42);
    expect(checklistItemsWithReminder(list).map((x) => [x.id, x.reminderAt])).toEqual([['b', 42]]);
    expect(checklistItemReminder(list.find((x) => x.id === 'a')!)).toBeUndefined();
  });
});
