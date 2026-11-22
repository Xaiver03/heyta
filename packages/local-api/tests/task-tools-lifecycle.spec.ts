/**
 * 任务生命周期写工具（P0）的参数层判据
 * ======================================
 *
 * 契约见 `docs/plans/2026-11-22-tool-layer-p0-p1-contract.md` §3（task.ts 表）：
 * `trash_task` / `restore_task` / `archive_task` / `unarchive_task` /
 * `move_task` / `uncomplete_task` 六个写工具。
 *
 * 这里只测**参数 → 写入意图**这一个纯函数（`toWriteIntent`）：
 *
 *   1. 🔴 每个工具都登记进目录，`kind:'write'`、`egressFields:[]`、`defaultEnabled:false`、
 *      `risk` 与契约表逐条一致 —— 写工具的结果不回送模型，所以它不贡献出境字段；
 *   2. 正确参数产出契约 §1 对应的 intent（形状逐字对齐，不多字段不少字段）；
 *   3. 🔴 **严格参数白名单**：schema 之外的键 ⇒ `{ok:false}` 且报错点名那个键，
 *      不许"忽略它照样执行"（那会把模型打错的一个参数伪装成一次成功写入）；
 *   4. 缺必填 ⇒ 拒，而不是产出一个 taskId 是 undefined 的 intent。
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

/** 只带 `taskId` 的那一批工具（白名单 = 只有 taskId）。 */
const TASK_ID_ONLY = [
  'trash_task',
  'restore_task',
  'archive_task',
  'unarchive_task',
  'uncomplete_task',
] as const;

describe('目录登记：六个生命周期工具都在，且形状与契约表一致', () => {
  const RISK_BY_NAME: Readonly<Record<string, string>> = {
    trash_task: 'destructive-reversible',
    restore_task: 'write',
    archive_task: 'destructive-reversible',
    unarchive_task: 'destructive-reversible',
    move_task: 'destructive-reversible',
    uncomplete_task: 'write',
  };

  it('六条都登记为写工具，写工具不出境任何字段、默认关，risk 逐条对齐契约', () => {
    for (const [name, expectedRisk] of Object.entries(RISK_BY_NAME)) {
      const tool = LOCAL_API_TOOLS.find((entry) => entry.name === name);
      expect(tool, `目录里没有「${name}」`).toBeDefined();
      expect(tool).toMatchObject({
        kind: 'write',
        egressFields: [],
        defaultEnabled: false,
        risk: expectedRisk,
      });
      // 说明要出境给模型：不能是空串，且要能说清参数（至少有 taskId）。
      expect(tool?.description.length, `${name} 的说明不能为空`).toBeGreaterThan(10);
      expect(tool?.description, `${name} 的说明要写明 taskId`).toContain('taskId');
    }
  });

  it('六条都暴露了 inputSchema（object + additionalProperties:false）', () => {
    for (const name of Object.keys(RISK_BY_NAME)) {
      expect(hasInputSchemaFor(name), `${name} 必须暴露 inputSchema`).toBe(true);
    }
  });
});

describe('trash / restore / archive / unarchive / uncomplete：一个 taskId → 对应 intent', () => {
  const ACTION_BY_NAME: Readonly<Record<string, string>> = {
    trash_task: 'trash-task',
    restore_task: 'restore-task',
    archive_task: 'archive-task',
    unarchive_task: 'unarchive-task',
    uncomplete_task: 'uncomplete-task',
  };

  it('正确参数产出契约 §1 的 intent（形状逐字对齐）', () => {
    for (const [name, action] of Object.entries(ACTION_BY_NAME)) {
      expect(intentOf(name, { taskId: 't1' })).toEqual({ action, taskId: 't1' });
    }
  });

  it('taskId 两端空白被裁掉（intent 里的 id 是干净的）', () => {
    expect(intentOf('trash_task', { taskId: ' t1 ' })).toEqual({ action: 'trash-task', taskId: 't1' });
  });
});

describe('move_task：taskId 必填，projectId 可选', () => {
  it('带 projectId → move-task 且保留 projectId', () => {
    expect(intentOf('move_task', { taskId: 't1', projectId: 'p2' })).toEqual({
      action: 'move-task',
      taskId: 't1',
      projectId: 'p2',
    });
  });

  it('省略 projectId → move-task 且不带该键（= 移出清单）', () => {
    expect(intentOf('move_task', { taskId: 't1' })).toEqual({ action: 'move-task', taskId: 't1' });
  });
});

describe('🔴 严格参数白名单：schema 之外的键一律拒，且报错点名', () => {
  it('只带 taskId 的工具：多给一个键就拒', () => {
    for (const name of TASK_ID_ONLY) {
      const message = rejection(name, { taskId: 't1', extra: true });
      expect(message).toContain('不支持这些参数');
      expect(message).toContain('extra');
    }
  });

  it('move_task：多给一个键就拒', () => {
    const message = rejection('move_task', { taskId: 't1', projectId: 'p2', extra: true });
    expect(message).toContain('不支持这些参数');
    expect(message).toContain('extra');
  });
});

describe('缺必填 / 类型错 ⇒ 拒（不许产出半成品 intent）', () => {
  it('缺 taskId ⇒ 拒', () => {
    for (const name of [...TASK_ID_ONLY, 'move_task']) {
      expect(rejection(name, {}), `${name} 缺 taskId 应被拒`).toContain('taskId');
    }
  });

  it('taskId 不是字符串 / 是空串 / 全是空白 ⇒ 拒', () => {
    for (const name of [...TASK_ID_ONLY, 'move_task']) {
      expect(rejection(name, { taskId: 42 })).toContain('taskId');
      expect(rejection(name, { taskId: '' })).toContain('taskId');
      expect(rejection(name, { taskId: '   ' })).toContain('taskId');
    }
  });

  it('move_task 的 projectId 不是字符串或空串 ⇒ 拒（要移出清单应省略它）', () => {
    expect(rejection('move_task', { taskId: 't1', projectId: 42 })).toContain('projectId');
    expect(rejection('move_task', { taskId: 't1', projectId: '' })).toContain('projectId');
  });
});
