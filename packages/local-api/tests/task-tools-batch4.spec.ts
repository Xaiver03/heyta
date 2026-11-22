/**
 * 任务标记 / 批量移动写工具（批次 4）的参数层判据
 * ================================================
 *
 * 契约见 `docs/plans/2026-11-22-tool-layer-batch4-contract.md` §3（task.ts 表）：
 * `set_task_important` / `set_task_pinned` / `move_tasks` 三个写工具。
 *
 * 这里只测**参数 → 写入意图**这一个纯函数（`toWriteIntent`）：
 *
 *   1. 🔴 每个工具都登记进目录：`kind:'write'`、`egressFields:[]`、`defaultEnabled:false`，
 *      risk 与契约表一致（important/pinned 是 `write`，move_tasks 是 `destructive-reversible`）；
 *   2. 正确参数产出契约 §1 对应的 intent（形状逐字对齐，不多字段不少字段）；
 *   3. 🔴 **严格参数白名单**：schema 之外的键 ⇒ `{ok:false}` 且报错点名那个键；
 *   4. 缺必填 / 类型错 ⇒ 拒；`important` / `pinned` 传非布尔 ⇒ 拒；`taskIds` 空 / 非数组 ⇒ 拒；
 *   5. 🔴 `move_tasks` 省略 `projectId` 时 intent **不带该键**（= 移出清单），而不是带 `undefined`。
 *
 * 落库侧（`submitIntent` 把 intent 翻成 op）在 seam-owner 的 `local-api-host` 里，
 * 不在本文件范围内 —— 本文件不碰 host，因此不可能改数据。
 */

import { describe, expect, it } from 'vitest';

import { hasInputSchemaFor, LOCAL_API_TOOLS, toWriteIntent } from '../src/index.js';

/** 期望里的 intent 形状（与 shared.ts 的 `LocalApiWriteIntent` 联合成员对齐）。 */
type OkIntent = Extract<ReturnType<typeof toWriteIntent>, { ok: true }>['intent'];

function intentOf(name: string, args: Record<string, unknown>): OkIntent {
  const outcome = toWriteIntent(name, args);
  if (!outcome.ok) throw new Error(`${name} 期望通过，实际被拒：${outcome.message}`);
  return outcome.intent;
}

function rejection(name: string, args: Record<string, unknown>): string {
  const outcome = toWriteIntent(name, args);
  if (outcome.ok) throw new Error(`${name} 期望被拒，实际通过了：${JSON.stringify(outcome.intent)}`);
  return outcome.message;
}

describe('目录登记：三个批次 4 写工具都在，且形状与契约表一致', () => {
  const RISK_BY_NAME: Readonly<Record<string, 'write' | 'destructive-reversible'>> = {
    set_task_important: 'write',
    set_task_pinned: 'write',
    move_tasks: 'destructive-reversible',
  };

  it('三条都登记为写工具，写工具不出境任何字段、默认关，risk 与契约一致', () => {
    for (const [name, risk] of Object.entries(RISK_BY_NAME)) {
      const tool = LOCAL_API_TOOLS.find((entry) => entry.name === name);
      expect(tool, `目录里没有「${name}」`).toBeDefined();
      expect(tool).toMatchObject({
        kind: 'write',
        egressFields: [],
        defaultEnabled: false,
        risk,
      });
      expect(tool?.description.length, `${name} 的说明不能为空`).toBeGreaterThan(10);
    }
  });

  it('三条都暴露了 inputSchema（object + additionalProperties:false）', () => {
    for (const name of Object.keys(RISK_BY_NAME)) {
      expect(hasInputSchemaFor(name), `${name} 必须暴露 inputSchema`).toBe(true);
    }
  });
});

describe('set_task_important：taskId + important(boolean) → set-task-important', () => {
  it('important=true → intent 形状逐字对齐', () => {
    expect(intentOf('set_task_important', { taskId: 't1', important: true })).toEqual({
      action: 'set-task-important',
      taskId: 't1',
      important: true,
    });
  });

  it('important=false 也保留为布尔 false（不是被当成缺省）', () => {
    const intent = intentOf('set_task_important', { taskId: 't1', important: false });
    expect(intent).toEqual({ action: 'set-task-important', taskId: 't1', important: false });
    expect(intent).toHaveProperty('important', false);
  });

  it('taskId 两端空白被裁掉', () => {
    expect(intentOf('set_task_important', { taskId: ' t1 ', important: true })).toEqual({
      action: 'set-task-important',
      taskId: 't1',
      important: true,
    });
  });
});

describe('set_task_pinned：taskId + pinned(boolean) → set-task-pinned', () => {
  it('pinned=true → intent 形状逐字对齐', () => {
    expect(intentOf('set_task_pinned', { taskId: 't1', pinned: true })).toEqual({
      action: 'set-task-pinned',
      taskId: 't1',
      pinned: true,
    });
  });

  it('pinned=false 也保留为布尔 false', () => {
    expect(intentOf('set_task_pinned', { taskId: 't1', pinned: false })).toEqual({
      action: 'set-task-pinned',
      taskId: 't1',
      pinned: false,
    });
  });
});

describe('move_tasks：taskIds(≥1) + 可选 projectId → move-tasks', () => {
  it('给 projectId → intent 带 projectId', () => {
    expect(intentOf('move_tasks', { taskIds: ['t1', 't2'], projectId: 'p1' })).toEqual({
      action: 'move-tasks',
      taskIds: ['t1', 't2'],
      projectId: 'p1',
    });
  });

  it('🔴 省略 projectId → intent 不带该键（= 移出清单）', () => {
    const intent = intentOf('move_tasks', { taskIds: ['t1'] });
    expect(intent).toEqual({ action: 'move-tasks', taskIds: ['t1'] });
    expect('projectId' in intent).toBe(false);
  });

  it('taskIds 元素两端空白被裁掉', () => {
    expect(intentOf('move_tasks', { taskIds: [' t1 ', ' t2 '], projectId: ' p1 ' })).toEqual({
      action: 'move-tasks',
      taskIds: ['t1', 't2'],
      projectId: 'p1',
    });
  });
});

describe('🔴 严格参数白名单：schema 之外的键一律拒，且报错点名', () => {
  const cases: readonly [string, Record<string, unknown>][] = [
    ['set_task_important', { taskId: 't1', important: true, extra: true }],
    ['set_task_pinned', { taskId: 't1', pinned: true, extra: true }],
    ['move_tasks', { taskIds: ['t1'], projectId: 'p1', extra: true }],
  ];

  it('多给一个 schema 外的键就拒，并点名那个键', () => {
    for (const [name, args] of cases) {
      const message = rejection(name, args);
      expect(message, `${name} 应报「不支持这些参数」`).toContain('不支持这些参数');
      expect(message, `${name} 应点名 extra`).toContain('extra');
    }
  });
});

describe('缺必填 / 类型错 ⇒ 拒（不许产出半成品 intent）', () => {
  it('set_task_important：缺 taskId / 非字符串 / 空串 / 全空白 ⇒ 拒', () => {
    for (const args of [{ important: true }, { taskId: 42, important: true }, { taskId: '', important: true }, { taskId: '   ', important: true }]) {
      expect(rejection('set_task_important', args)).toContain('taskId');
    }
  });

  it('set_task_important：important 非布尔 ⇒ 拒', () => {
    for (const value of ['true', 1, null, undefined, {}]) {
      const args: Record<string, unknown> = { taskId: 't1' };
      if (value !== undefined) args['important'] = value;
      expect(rejection('set_task_important', args)).toContain('important');
    }
  });

  it('set_task_pinned：缺 taskId / 非字符串 / 空串 / 全空白 ⇒ 拒', () => {
    for (const args of [{ pinned: true }, { taskId: 42, pinned: true }, { taskId: '', pinned: true }, { taskId: '   ', pinned: true }]) {
      expect(rejection('set_task_pinned', args)).toContain('taskId');
    }
  });

  it('set_task_pinned：pinned 非布尔 ⇒ 拒', () => {
    for (const value of ['false', 0, null, undefined, []]) {
      const args: Record<string, unknown> = { taskId: 't1' };
      if (value !== undefined) args['pinned'] = value;
      expect(rejection('set_task_pinned', args)).toContain('pinned');
    }
  });

  it('move_tasks：缺 taskIds / 空数组 / 非数组 ⇒ 拒', () => {
    for (const args of [{}, { taskIds: [] }, { taskIds: 't1' }, { taskIds: 42 }]) {
      expect(rejection('move_tasks', args)).toContain('taskIds');
    }
  });

  it('move_tasks：taskIds 含非字符串 / 空串元素 ⇒ 拒', () => {
    for (const args of [{ taskIds: [1] }, { taskIds: [''] }, { taskIds: ['t1', '   '] }, { taskIds: [null] }]) {
      expect(rejection('move_tasks', args)).toContain('taskIds');
    }
  });

  it('move_tasks：projectId 给了但不是非空字符串 ⇒ 拒（要移出清单应省略它）', () => {
    expect(rejection('move_tasks', { taskIds: ['t1'], projectId: '' })).toContain('projectId');
    expect(rejection('move_tasks', { taskIds: ['t1'], projectId: '   ' })).toContain('projectId');
    expect(rejection('move_tasks', { taskIds: ['t1'], projectId: 42 })).toContain('projectId');
    expect(rejection('move_tasks', { taskIds: ['t1'], projectId: null })).toContain('projectId');
  });
});
