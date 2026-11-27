/**
 * 任务模板（`TASK_TEMPLATE`）领域逻辑
 * ====================================
 *
 * 钉三件事：
 *
 *   1. **名校验**（空 / 超长拒绝）；
 *   2. 🔴 **"保存任务为模板"只抓允许的字段**（不抓 `projectId` / `dueDate` /
 *      `completedAt` / 清单条目 id —— 这些是"某条具体任务此刻的状态"，不是模板内容）；
 *   3. **"从模板建任务"只搬有值的键**，标题缺省用模板名兜底，并给清单条目重新生成 id。
 *
 * 每条都得能失败：把 `templatePayloadFromTask` 改成"整个 task 展开"、或把
 * `taskFieldsFromTemplate` 改成"把 undefined 也写进去"，下面的断言都会红。
 */

import { describe, expect, it } from 'vitest';

import { Priority, type Task } from '../src/entities.js';
import {
  TEMPLATE_NAME_MAX_LENGTH,
  aliveTemplates,
  templateNameRejection,
  templatePayloadFromTask,
  taskFieldsFromTemplate,
} from '../src/task-template.js';

const baseTask = (over: Partial<Task> = {}): Task =>
  ({
    id: 'task-1',
    title: '周报',
    priority: Priority.High,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as Task;

describe('templateNameRejection', () => {
  it('空 / 全空白 ⇒ empty', () => {
    expect(templateNameRejection('')).toBe('empty');
    expect(templateNameRejection('   ')).toBe('empty');
  });

  it('超长 ⇒ too-long；边界长度合法', () => {
    expect(templateNameRejection('x'.repeat(TEMPLATE_NAME_MAX_LENGTH + 1))).toBe('too-long');
    expect(templateNameRejection('x'.repeat(TEMPLATE_NAME_MAX_LENGTH))).toBeUndefined();
  });

  it('正常名字 ⇒ 合法', () => {
    expect(templateNameRejection('出差打包')).toBeUndefined();
  });
});

describe('aliveTemplates 规范顺序', () => {
  type Row = { id: string; name: string; order?: number; deletedAt?: number; purgedAt?: number };
  it('过滤软删 / 彻底删，按 order→name→id 排序，缺 order 排最后', () => {
    const rows: Row[] = [
      { id: 'b', name: '乙', order: 2 },
      { id: 'a', name: '甲', order: 1 },
      { id: 'c', name: '丙' }, // 无 order，排最后
      { id: 'd', name: '删', order: 0, deletedAt: 5 },
      { id: 'e', name: '彻', order: 0, purgedAt: 5 },
    ];
    expect(aliveTemplates(rows).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('同 order 按名字，再按 id 确定性打破平局', () => {
    const rows: Row[] = [
      { id: 'x2', name: 'same', order: 1 },
      { id: 'x1', name: 'same', order: 1 },
      { id: 'y', name: 'aaa', order: 1 },
    ];
    expect(aliveTemplates(rows).map((r) => r.id)).toEqual(['y', 'x1', 'x2']);
  });
});

describe('templatePayloadFromTask —— 只抓允许的字段', () => {
  it('抓标题/备注/优先级/重要/标签/清单/时长', () => {
    const task = baseTask({
      note: '本周完成项',
      important: true,
      tagIds: ['t1', 't1', 't2'],
      checklist: [
        { id: 'chk-old', text: '汇总', done: true },
        { id: 'chk-old2', text: '发邮件', done: false },
      ],
      durationMinutes: 30,
    });
    const payload = templatePayloadFromTask(task, '周报模板');
    expect(payload).toEqual({
      name: '周报模板',
      title: '周报',
      note: '本周完成项',
      priority: Priority.High,
      important: true,
      tagIds: ['t1', 't2'],
      checklist: [
        { text: '汇总', done: true },
        { text: '发邮件', done: false },
      ],
      durationMinutes: 30,
    });
  });

  it('🔴 不抓 projectId / dueDate / completedAt / parentId / repeatRule / 清单条目 id', () => {
    const task = baseTask({
      projectId: 'proj-9',
      dueDate: 1_700_000_000_000,
      completedAt: 123,
      parentId: 'task-parent',
      repeatRule: 'FREQ=WEEKLY',
      repeatDtstart: '2026-01-01',
      checklist: [{ id: 'chk-old', text: '汇总', done: false }],
    });
    const payload = templatePayloadFromTask(task, 'T');
    expect(payload).not.toHaveProperty('projectId');
    expect(payload).not.toHaveProperty('dueDate');
    expect(payload).not.toHaveProperty('completedAt');
    expect(payload).not.toHaveProperty('parentId');
    expect(payload).not.toHaveProperty('repeatRule');
    expect(payload).not.toHaveProperty('repeatDtstart');
    // 清单条目只留 text/done，不搬条目 id
    expect(payload.checklist).toEqual([{ text: '汇总', done: false }]);
    expect((payload.checklist?.[0] as Record<string, unknown>).id).toBeUndefined();
  });

  it('空标题 / 空备注 / 空清单 / 零时长 ⇒ 不写这些键（不是写空串/空数组）', () => {
    const task = baseTask({
      title: '   ',
      note: '',
      checklist: [],
      durationMinutes: 0,
      priority: undefined,
    });
    const payload = templatePayloadFromTask(task, 'T');
    expect(payload).toEqual({ name: 'T' });
    expect(payload).not.toHaveProperty('title');
    expect(payload).not.toHaveProperty('note');
    expect(payload).not.toHaveProperty('checklist');
    expect(payload).not.toHaveProperty('durationMinutes');
  });
});

describe('taskFieldsFromTemplate —— 建任务的字段', () => {
  let seq = 0;
  const genId = (): string => {
    seq += 1;
    return `chk-new-${seq}`;
  };

  it('title 缺省用模板名兜底；清单条目重新生成 id', () => {
    seq = 0;
    const fields = taskFieldsFromTemplate(
      {
        name: '出差打包',
        checklist: [{ text: '充电器', done: false }],
      },
      genId,
    );
    expect(fields['title']).toBe('出差打包');
    expect(fields['checklist']).toEqual([{ id: 'chk-new-1', text: '充电器', done: false }]);
  });

  it('只写有值的键（priority 可为 0 / None 也要保留，undefined 不写）', () => {
    const fields = taskFieldsFromTemplate(
      { name: 'T', title: '做这件事', priority: Priority.None },
      genId,
    );
    expect(fields['title']).toBe('做这件事');
    expect(fields['priority']).toBe(Priority.None);
    expect(fields).not.toHaveProperty('note');
    expect(fields).not.toHaveProperty('tagIds');
  });
});
