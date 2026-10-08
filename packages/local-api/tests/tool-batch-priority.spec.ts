import { describe, expect, it } from 'vitest';

import {
  hasInputSchemaFor,
  LOCAL_API_TOOLS,
  MAX_TASKS_PER_BATCH_PRIORITY,
  toWriteIntent,
} from '../src/index.js';

function priorityIntent(args: Record<string, unknown>) {
  const outcome = toWriteIntent('set_task_priorities', args);
  if (!outcome.ok) throw new Error(`期望通过，实际被拒：${outcome.message}`);
  return outcome.intent;
}

describe('set_task_priorities', () => {
  it('登记为默认关闭的写工具，且有参数 schema', () => {
    expect(LOCAL_API_TOOLS.find((tool) => tool.name === 'set_task_priorities')).toMatchObject({
      kind: 'write',
      defaultEnabled: false,
      egressFields: [],
    });
    expect(hasInputSchemaFor('set_task_priorities')).toBe(true);
  });

  it('保留顺序并裁剪 taskId 与 priority 的两端空白', () => {
    expect(
      priorityIntent({
        entries: [
          { taskId: ' task-1 ', priority: ' HIGH ' },
          { taskId: 'task-2', priority: 'none' },
        ],
      }),
    ).toEqual({
      action: 'set-task-priorities',
      entries: [
        { taskId: 'task-1', priority: 'high' },
        { taskId: 'task-2', priority: 'none' },
      ],
    });
  });

  it('拒绝空范围、坏成员、未知优先级、重复任务与超限输入', () => {
    const rejected = [
      {},
      { entries: [] },
      { entries: [{ taskId: 't1', priority: 'urgent' }] },
      { entries: [{ taskId: 't1', priority: 'high' }, { taskId: 't1', priority: 'low' }] },
      { entries: [{ taskId: ' ', priority: 'high' }] },
      { entries: [{ taskId: 't1', priority: 1 }] },
      { entries: [{ taskId: 't1', priority: 'high' }, null] },
      {
        entries: Array.from({ length: MAX_TASKS_PER_BATCH_PRIORITY + 1 }, (_, index) => ({
          taskId: `t${String(index)}`,
          priority: 'high',
        })),
      },
    ];
    for (const args of rejected) expect(toWriteIntent('set_task_priorities', args).ok).toBe(false);
    expect(
      toWriteIntent('set_task_priorities', {
        entries: Array.from({ length: MAX_TASKS_PER_BATCH_PRIORITY }, (_, index) => ({
          taskId: `t${String(index)}`,
          priority: 'high',
        })),
      }).ok,
    ).toBe(true);
  });

  it('拒绝顶层和条目中的未知字段，以及缺失/错误类型', () => {
    const rejected = [
      { entries: [{ taskId: 't1', priority: 'high', extra: true }] },
      { entries: [{ taskId: 't1' }] },
      { entries: [{ priority: 'high' }] },
      { entries: [{ taskId: 't1', priority: 'high' }], extra: true },
    ];
    for (const args of rejected) expect(toWriteIntent('set_task_priorities', args).ok).toBe(false);
  });
});

describe('create_task 参数边界', () => {
  it('拒绝未知字段与错误类型的可选参数', () => {
    for (const args of [
      { title: '任务', extra: true },
      { title: '任务', dueDate: 1 },
      { title: '任务', priority: null },
      { title: '任务', projectId: false },
    ]) {
      expect(toWriteIntent('create_task', args).ok).toBe(false);
    }
  });
});
