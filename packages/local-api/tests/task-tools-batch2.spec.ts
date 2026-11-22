/**
 * 任务层级 / 批量删除恢复 / 排序写工具（批次 2）的参数层判据
 * ============================================================
 *
 * 契约见 `docs/plans/2026-11-22-tool-layer-batch2-contract.md` §3（task.ts 表）：
 * `set_task_parent` / `trash_tasks` / `restore_tasks` / `reorder_task` 四个写工具。
 *
 * 这里只测**参数 → 写入意图**这一个纯函数（`toWriteIntent`）：
 *
 *   1. 🔴 每个工具都登记进目录，`kind:'write'`、`egressFields:[]`、`defaultEnabled:false`、
 *      `risk` 与契约表逐条一致 —— 写工具的结果不回送模型，所以它不贡献出境字段；
 *   2. 正确参数产出契约 §1 对应的 intent（形状逐字对齐，不多字段不少字段）；
 *   3. 🔴 **严格参数白名单**：schema 之外的键 ⇒ `{ok:false}` 且报错点名那个键，
 *      不许"忽略它照样执行"（那会把模型打错的一个参数伪装成一次成功写入）；
 *   4. 缺必填 / 类型错 ⇒ 拒，而不是产出一个字段是 undefined / 类型不对的 intent；
 *   5. `trash_tasks` / `restore_tasks` 的 `taskIds` 必须是非空字符串数组
 *      —— 空数组、非数组一律拒；`reorder_task` 的 `order` 必须是有限数（NaN / Infinity 拒）。
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

describe('目录登记：四个批次 2 写工具都在，且形状与契约表一致', () => {
  const RISK_BY_NAME: Readonly<Record<string, string>> = {
    set_task_parent: 'write',
    trash_tasks: 'destructive-reversible',
    restore_tasks: 'write',
    reorder_task: 'write',
  };

  it('四条都登记为写工具，写工具不出境任何字段、默认关，risk 逐条对齐契约', () => {
    for (const [name, expectedRisk] of Object.entries(RISK_BY_NAME)) {
      const tool = LOCAL_API_TOOLS.find((entry) => entry.name === name);
      expect(tool, `目录里没有「${name}」`).toBeDefined();
      expect(tool).toMatchObject({
        kind: 'write',
        egressFields: [],
        defaultEnabled: false,
        risk: expectedRisk,
      });
      // 说明要出境给模型：不能是空串，且要能说清参数（至少提到 taskId）。
      expect(tool?.description.length, `${name} 的说明不能为空`).toBeGreaterThan(10);
      expect(tool?.description, `${name} 的说明要写明 taskId`).toContain('taskId');
    }
  });

  it('四条都暴露了 inputSchema（object + additionalProperties:false）', () => {
    for (const name of Object.keys(RISK_BY_NAME)) {
      expect(hasInputSchemaFor(name), `${name} 必须暴露 inputSchema`).toBe(true);
    }
  });
});

describe('set_task_parent：taskId 必填，parentId 可选（省略 = 提为顶级）', () => {
  it('带 parentId → set-task-parent 且保留 parentId', () => {
    expect(intentOf('set_task_parent', { taskId: 't1', parentId: 'p2' })).toEqual({
      action: 'set-task-parent',
      taskId: 't1',
      parentId: 'p2',
    });
  });

  it('省略 parentId → set-task-parent 且不带该键（= 提为顶级）', () => {
    const intent = intentOf('set_task_parent', { taskId: 't1' });
    expect(intent).toEqual({ action: 'set-task-parent', taskId: 't1' });
    expect(Object.keys(intent)).not.toContain('parentId');
  });

  it('taskId / parentId 两端空白被裁掉（intent 里的 id 是干净的）', () => {
    expect(intentOf('set_task_parent', { taskId: ' t1 ', parentId: ' p2 ' })).toEqual({
      action: 'set-task-parent',
      taskId: 't1',
      parentId: 'p2',
    });
  });
});

describe('trash_tasks / restore_tasks：taskIds → 对应 intent', () => {
  it('正确参数产出契约 §1 的 intent（形状逐字对齐）', () => {
    expect(intentOf('trash_tasks', { taskIds: ['t1', 't2'] })).toEqual({
      action: 'trash-tasks',
      taskIds: ['t1', 't2'],
    });
    expect(intentOf('restore_tasks', { taskIds: ['t1', 't2'] })).toEqual({
      action: 'restore-tasks',
      taskIds: ['t1', 't2'],
    });
  });

  it('taskIds 里的两端空白被裁掉', () => {
    expect(intentOf('trash_tasks', { taskIds: [' t1 ', 't2 '] })).toEqual({
      action: 'trash-tasks',
      taskIds: ['t1', 't2'],
    });
  });
});

describe('reorder_task：taskId + 有限数 order → reorder-task', () => {
  it('正确参数产出契约 §1 的 intent（形状逐字对齐）', () => {
    expect(intentOf('reorder_task', { taskId: 't1', order: 3 })).toEqual({
      action: 'reorder-task',
      taskId: 't1',
      order: 3,
    });
  });

  it('order 允许小数与负数（只要有限）', () => {
    expect(intentOf('reorder_task', { taskId: 't1', order: 2.5 })).toEqual({
      action: 'reorder-task',
      taskId: 't1',
      order: 2.5,
    });
    expect(intentOf('reorder_task', { taskId: 't1', order: -1 })).toEqual({
      action: 'reorder-task',
      taskId: 't1',
      order: -1,
    });
  });
});

describe('🔴 严格参数白名单：schema 之外的键一律拒，且报错点名', () => {
  const cases: readonly [string, Record<string, unknown>][] = [
    ['set_task_parent', { taskId: 't1', parentId: 'p2', extra: true }],
    ['trash_tasks', { taskIds: ['t1'], extra: true }],
    ['restore_tasks', { taskIds: ['t1'], extra: true }],
    ['reorder_task', { taskId: 't1', order: 1, extra: true }],
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
  it('set_task_parent：缺 taskId / 非字符串 / 空串 / 全空白 ⇒ 拒', () => {
    for (const args of [{}, { taskId: 42 }, { taskId: '' }, { taskId: '   ' }]) {
      expect(rejection('set_task_parent', args)).toContain('taskId');
    }
  });

  it('set_task_parent：parentId 非字符串或空串 ⇒ 拒（要提为顶级应省略它）', () => {
    expect(rejection('set_task_parent', { taskId: 't1', parentId: 42 })).toContain('parentId');
    expect(rejection('set_task_parent', { taskId: 't1', parentId: '' })).toContain('parentId');
    expect(rejection('set_task_parent', { taskId: 't1', parentId: '   ' })).toContain('parentId');
  });

  it('trash_tasks / restore_tasks：缺 taskIds / 非数组 / 空数组 ⇒ 拒', () => {
    for (const name of ['trash_tasks', 'restore_tasks'] as const) {
      expect(rejection(name, {}), `${name} 缺 taskIds 应被拒`).toContain('taskIds');
      expect(rejection(name, { taskIds: 't1' }), `${name} 非数组应被拒`).toContain('taskIds');
      expect(rejection(name, { taskIds: [] }), `${name} 空数组应被拒`).toContain('taskIds');
    }
  });

  it('trash_tasks / restore_tasks：数组里含非字符串或空串 ⇒ 拒', () => {
    for (const name of ['trash_tasks', 'restore_tasks'] as const) {
      expect(rejection(name, { taskIds: ['t1', 42] }), `${name} 含非字符串应被拒`).toContain('taskIds');
      expect(rejection(name, { taskIds: ['t1', ''] }), `${name} 含空串应被拒`).toContain('taskIds');
      expect(rejection(name, { taskIds: ['   '] }), `${name} 含全空白应被拒`).toContain('taskIds');
    }
  });

  it('reorder_task：缺 taskId / 缺 order ⇒ 拒', () => {
    expect(rejection('reorder_task', { order: 1 })).toContain('taskId');
    expect(rejection('reorder_task', { taskId: 't1' })).toContain('order');
  });

  it('reorder_task：order 非数字 / NaN / Infinity ⇒ 拒', () => {
    expect(rejection('reorder_task', { taskId: 't1', order: '1' })).toContain('order');
    expect(rejection('reorder_task', { taskId: 't1', order: Number.NaN })).toContain('order');
    expect(rejection('reorder_task', { taskId: 't1', order: Number.POSITIVE_INFINITY })).toContain('order');
    expect(rejection('reorder_task', { taskId: 't1', order: Number.NEGATIVE_INFINITY })).toContain('order');
  });
});
