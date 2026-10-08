/**
 * W11 批量完成：参数层的全部判据
 * ==============================
 *
 * 这里只测 `toWriteIntent('complete_task', …)` 这一个纯函数**为什么**要这么判：
 *
 * 1. 🔴 **批量是一个参数，不是一个新工具**。`packages/local-api/src/tools/shared.ts`
 *    的 TASK 专属 9 席预算给清单追加与批量优先级工具，而那个文件自己的出路
 *    写得很清楚："第 7 个读法变体应该做成参数，不是做成工具 —— 参数不进逐工具默认关那张清单"。
 *    所以本文件第一条判据是**目录形状**：批量落地之后 TASK 是 7 个工具、
 *    `complete_task` 的 `egressFields` 仍然是空（写工具的结果不回送模型）。
 *    这条不是为了好看：新开一个 `complete_tasks` 工具会让授权清单、能力清单、
 *    覆盖面台账三处同时说谎（用户以为自己开的是两个不同的权限）。
 * 2. **上限按去重后的条数算**，且描述里那个数字与拒判用的数字**是同一个常量**。
 *    描述出境给模型，一个和实际拒判不一致的上限 = 模型每次都要撞一次墙才学会。
 * 3. **"两个都给"必须拒**，不许"挑一个用" —— 那等于让模型的两句话变成两件不同的事。
 *
 * ⚠️ 落库侧（N 条 op、全批预检、已是完成态不重复写）在
 * `packages/app-host/tests/local-api-host.spec.ts` 的 `complete-tasks` 那组，
 * 因为只有真引擎能数出 op 的条数。
 */

import { describe, expect, it } from 'vitest';

import {
  hasInputSchemaFor,
  LOCAL_API_TOOLS,
  MAX_TASK_CHECKLIST_ITEM_LENGTH,
  MAX_TASK_CHECKLIST_ITEMS,
  MAX_TASKS_PER_BATCH_COMPLETE,
  toWriteIntent,
} from '../src/index.js';

const ids = (n: number, prefix = 't'): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1)}`);

function intentOf(args: Record<string, unknown>): Extract<
  ReturnType<typeof toWriteIntent>,
  { ok: true }
>['intent'] {
  const outcome = toWriteIntent('complete_task', args);
  if (!outcome.ok) throw new Error(`期望通过，实际被拒：${outcome.message}`);
  return outcome.intent;
}

function rejection(args: Record<string, unknown>): string {
  const outcome = toWriteIntent('complete_task', args);
  if (outcome.ok) throw new Error(`期望被拒，实际通过了：${JSON.stringify(outcome.intent)}`);
  return outcome.message;
}

describe('目录形状：批量是参数，不是第二个工具', () => {
  it('🔴 TASK 是 7 个工具，且没有多出 complete_tasks', () => {
    const taskTools = LOCAL_API_TOOLS.filter((tool) =>
      [
        'list_tasks',
        'get_task',
        'create_task',
        'update_task',
        'append_task_checklist',
        'complete_task',
        'set_task_priorities',
      ].includes(tool.name),
    );
    expect(taskTools.map((tool) => tool.name).sort()).toEqual([
      'append_task_checklist',
      'complete_task',
      'create_task',
      'get_task',
      'list_tasks',
      'set_task_priorities',
      'update_task',
    ]);
    expect(
      LOCAL_API_TOOLS.filter((tool) => tool.name === 'complete_tasks'),
      '批量如果变成了第二个工具，授权清单就会对同一件事出现两个开关'
    ).toHaveLength(0);
  });

  it('🔴 complete_task 的出境字段仍然是空（写工具的结果不回送模型）', () => {
    const tool = LOCAL_API_TOOLS.find((entry) => entry.name === 'complete_task');
    expect(tool?.egressFields ?? ['<缺失>']).toEqual([]);
  });

  it('🔴 描述里的上限数字与拒判用的常量是同一个（不是抄的）', () => {
    const tool = LOCAL_API_TOOLS.find((entry) => entry.name === 'complete_task');
    expect(tool?.description).toContain(String(MAX_TASKS_PER_BATCH_COMPLETE));
  });
});

describe('单条与批量的形状', () => {
  it('taskId 单条 → complete-task（既有形状一条不动）', () => {
    expect(intentOf({ taskId: 't1' })).toEqual({ action: 'complete-task', taskId: 't1' });
  });

  it('🔴 taskIds 多条 → complete-tasks，且顺序逐字保留', () => {
    expect(intentOf({ taskIds: ['b', 'a', 'c'] })).toEqual({
      action: 'complete-tasks',
      taskIds: ['b', 'a', 'c'],
    });
  });

  it('🔴 去重后只剩一条就塌回单条形状：确认卡上"这条"和"这 1 条"是两句话', () => {
    expect(intentOf({ taskIds: ['t7', 't7', 't7'] })).toEqual({
      action: 'complete-task',
      taskId: 't7',
    });
  });
});

describe('三种"说不清范围"都必须拒，而不是挑一个用', () => {
  it('两个都给 → 拒（不许静默选一个）', () => {
    expect(rejection({ taskId: 't1', taskIds: ['t1', 't2'] })).toContain('只能给一个');
  });

  it('两个都没给 → 拒，且报错说得出给哪个', () => {
    const message = rejection({});
    expect(message).toContain('taskId');
    expect(message).toContain('taskIds');
  });

  it('空数组 → 拒（"一条都不做"不是一种批量）', () => {
    expect(rejection({ taskIds: [] })).toContain('空的');
  });

  it('成员不全是非空字符串 → 拒', () => {
    expect(rejection({ taskIds: ['t1', ''] })).toContain('数组');
    expect(rejection({ taskIds: 't1,t2' })).toContain('数组');
    expect(rejection({ taskIds: ['t1', 42] })).toContain('数组');
  });

  it('taskId 给了空字符串 → 拒', () => {
    expect(rejection({ taskId: '' })).toContain('非空字符串');
  });
});

describe('上限按去重后的条数算', () => {
  it(`🔴 ${String(MAX_TASKS_PER_BATCH_COMPLETE)} 条通过，多一条就拒`, () => {
    expect(intentOf({ taskIds: ids(MAX_TASKS_PER_BATCH_COMPLETE) })).toEqual({
      action: 'complete-tasks',
      taskIds: ids(MAX_TASKS_PER_BATCH_COMPLETE),
    });
    const message = rejection({ taskIds: ids(MAX_TASKS_PER_BATCH_COMPLETE + 1) });
    expect(message).toContain(String(MAX_TASKS_PER_BATCH_COMPLETE));
    // 报错必须解释"为什么有上限"，否则调用方只会重试。
    expect(message).toContain('确认');
  });

  it('🔴 超限的算法口径是**去重后**：同一批点满 25 次（去重 20）不该被拒', () => {
    const repeated = [...ids(MAX_TASKS_PER_BATCH_COMPLETE), ...ids(5)];
    expect(new Set(repeated).size).toBe(MAX_TASKS_PER_BATCH_COMPLETE);
    const intent = intentOf({ taskIds: repeated });
    expect(intent.action).toBe('complete-tasks');
    if (intent.action !== 'complete-tasks') return;
    expect(intent.taskIds).toHaveLength(MAX_TASKS_PER_BATCH_COMPLETE);
  });
});

describe('追加任务清单：参数与目录契约', () => {
  it('登记为独立的写工具，且参数 schema 已暴露', () => {
    const tool = LOCAL_API_TOOLS.find((entry) => entry.name === 'append_task_checklist');
    expect(tool).toMatchObject({ kind: 'write', defaultEnabled: false, egressFields: [] });
    expect(hasInputSchemaFor('append_task_checklist')).toBe(true);
  });

  it('会裁剪任务 id 与条目两端空白，并保留条目顺序', () => {
    expect(
      toWriteIntent('append_task_checklist', {
        taskId: ' task-1 ',
        items: ['  第一项 ', '第二项'],
      }),
    ).toEqual({
      ok: true,
      intent: { action: 'append-task-checklist', taskId: 'task-1', items: ['第一项', '第二项'] },
    });
  });

  it('拒绝空范围、非字符串、空白条目与超限输入', () => {
    const rejected = [
      { taskId: 't1', items: [] },
      { taskId: 't1', items: ['   '] },
      { taskId: 't1', items: ['ok', 1] },
      { taskId: '   ', items: ['ok'] },
      { taskId: 't1', items: ['ok'], extra: true },
      { taskId: 't1', items: Array.from({ length: MAX_TASK_CHECKLIST_ITEMS + 1 }, () => 'x') },
      { taskId: 't1', items: ['x'.repeat(MAX_TASK_CHECKLIST_ITEM_LENGTH + 1)] },
    ];
    for (const args of rejected) expect(toWriteIntent('append_task_checklist', args).ok).toBe(false);
    expect(
      toWriteIntent('append_task_checklist', {
        taskId: 't1',
        items: Array.from({ length: MAX_TASK_CHECKLIST_ITEMS }, () => 'x'),
      }).ok,
    ).toBe(true);
  });

  it('拒绝 schema 之外的字段并指出字段名', () => {
    const result = toWriteIntent('append_task_checklist', {
      taskId: 't1',
      items: ['ok'],
      note: '不支持',
    });
    expect(result).toEqual({
      ok: false,
      message: 'append_task_checklist 不支持这些参数：note。',
    });
  });
});
