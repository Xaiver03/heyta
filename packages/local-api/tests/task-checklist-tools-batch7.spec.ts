/** 任务结构化子项工具（批7）形状判据。 */
import { describe, expect, it } from 'vitest';
import { LOCAL_API_TOOLS, findTool, toWriteIntent } from '../src/index.js';

function intentOf(name: string, args: Record<string, unknown>): Record<string, unknown> & { action: string } {
  const o = toWriteIntent(name, args);
  expect(o.ok, `期望 ${name} 合法：${JSON.stringify({ args, o })}`).toBe(true);
  if (!o.ok) throw new Error(o.message);
  return o.intent as Record<string, unknown> & { action: string };
}
function rejected(name: string, args: Record<string, unknown>, m?: string): void {
  const o = toWriteIntent(name, args);
  expect(o.ok, `期望 ${name} 拒绝：${JSON.stringify(args)}`).toBe(false);
  if (!o.ok && m !== undefined) expect(o.message).toContain(m);
}

describe('set_task_checklist', () => {
  it('items 覆盖 → set-task-checklist', () => {
    expect(intentOf('set_task_checklist', { taskId: 't1', items: [{ text: '甲' }, { text: '乙', done: true }] })).toEqual({
      action: 'set-task-checklist',
      taskId: 't1',
      items: [{ text: '甲' }, { text: '乙', done: true }],
    });
  });
  it('空数组 = 清空', () => {
    expect(intentOf('set_task_checklist', { taskId: 't1', items: [] })).toEqual({ action: 'set-task-checklist', taskId: 't1', items: [] });
  });
  it('未知/缺 taskId/items 非数组/子项 text 空/子项多字段 ⇒ 拒', () => {
    rejected('set_task_checklist', { taskId: 't1', items: [], x: 1 }, 'x');
    rejected('set_task_checklist', { items: [] }, 'taskId');
    rejected('set_task_checklist', { taskId: 't1', items: 'x' }, 'items');
    rejected('set_task_checklist', { taskId: 't1', items: [{ text: '' }] }, 'text');
    rejected('set_task_checklist', { taskId: 't1', items: [{ text: 'a', z: 1 }] }, 'z');
    rejected('set_task_checklist', { taskId: 't1', items: [{ text: 'a', done: 'yes' }] }, 'done');
  });
});

describe('toggle_checklist_item', () => {
  it('产出 toggle-checklist-item', () => {
    expect(intentOf('toggle_checklist_item', { taskId: 't1', itemText: '甲', done: true })).toEqual({
      action: 'toggle-checklist-item', taskId: 't1', itemText: '甲', done: true,
    });
  });
  it('未知/缺项/类型错 ⇒ 拒', () => {
    rejected('toggle_checklist_item', { taskId: 't1', itemText: '甲', done: true, x: 1 }, 'x');
    rejected('toggle_checklist_item', { itemText: '甲', done: true }, 'taskId');
    rejected('toggle_checklist_item', { taskId: 't1', done: true }, 'itemText');
    rejected('toggle_checklist_item', { taskId: 't1', itemText: '甲', done: 'yes' }, 'done');
  });
});

describe('set_checklist_item_reminder（#29 检查项级提醒）', () => {
  it('date + time ⇒ set-checklist-item-reminder', () => {
    expect(
      intentOf('set_checklist_item_reminder', { taskId: 't1', itemText: '甲', date: '2027-06-01', time: '09:30' }),
    ).toEqual({
      action: 'set-checklist-item-reminder', taskId: 't1', itemText: '甲', date: '2027-06-01', time: '09:30',
    });
  });
  it('clear:true ⇒ 清除意图', () => {
    expect(intentOf('set_checklist_item_reminder', { taskId: 't1', itemText: '甲', clear: true })).toEqual({
      action: 'set-checklist-item-reminder', taskId: 't1', itemText: '甲', clear: true,
    });
  });
  it('未知/缺项/只给 date 或 time/clear 与 date 冲突/类型错 ⇒ 拒', () => {
    rejected('set_checklist_item_reminder', { taskId: 't1', itemText: '甲', date: '2027-06-01', time: '09:30', x: 1 }, 'x');
    rejected('set_checklist_item_reminder', { itemText: '甲', date: '2027-06-01', time: '09:30' }, 'taskId');
    rejected('set_checklist_item_reminder', { taskId: 't1', date: '2027-06-01', time: '09:30' }, 'itemText');
    rejected('set_checklist_item_reminder', { taskId: 't1', itemText: '甲', date: '2027-06-01' }, 'date');
    rejected('set_checklist_item_reminder', { taskId: 't1', itemText: '甲', clear: true, date: '2027-06-01', time: '09:30' }, '二选一');
    rejected('set_checklist_item_reminder', { taskId: 't1', itemText: '甲' }, 'date');
    rejected('set_checklist_item_reminder', { taskId: 't1', itemText: '甲', clear: 'yes' }, 'clear');
  });
});

describe('目录声明', () => {
  for (const name of ['set_task_checklist', 'toggle_checklist_item', 'set_checklist_item_reminder']) {
    it(name, () => {
      const t = findTool(name);
      expect(t?.kind).toBe('write');
      expect(t?.risk).toBe('write');
      expect(t?.egressFields).toEqual([]);
      expect(t?.defaultEnabled).toBe(false);
      expect(LOCAL_API_TOOLS.map((x) => x.name)).toContain(name);
    });
  }
});
