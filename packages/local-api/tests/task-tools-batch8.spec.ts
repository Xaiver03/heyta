/**
 * 任务指派写工具（批次 8）的参数层判据
 * ======================================
 *
 * 契约：ADR-0062 决策 7 / ADR-0088。`set_task_assignee` 把 `Task.assigneeUserId`
 * 从"全仓零写点"变成一个有真实写入通道的字段，从而让通知「任务提醒」档有输入。
 *
 * 这里只测**参数 → 写入意图**这一个纯函数（`toWriteIntent`）：
 *
 *   1. 🔴 工具登记进目录：`kind:'write'`、`egressFields:[]`、`defaultEnabled:false`、`risk:'write'`；
 *   2. 给 `assigneeUserId` → intent 带该键；省略 / 空串 / 全空白 ⇒ **intent 不带该键**（= 清除，写 `null`）；
 *   3. `taskId` / `assigneeUserId` 两端空白被裁掉；
 *   4. 🔴 严格参数白名单：schema 之外的键 ⇒ `{ok:false}` 且点名那个键；
 *   5. 缺必填 taskId / 非字符串 ⇒ 拒；`assigneeUserId` 传非字符串 ⇒ 拒。
 *
 * 落库侧（`submitIntent` 把 intent 翻成 op）在 `local-api-host` 里，不在本文件范围。
 */

import { describe, expect, it } from 'vitest';

import { hasInputSchemaFor, LOCAL_API_TOOLS, toWriteIntent } from '../src/index.js';

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

describe('目录登记：set_task_assignee 是写工具，形状与契约一致', () => {
  it('登记为写工具，写工具不出境任何字段、默认关、risk=write，说明非空', () => {
    const tool = LOCAL_API_TOOLS.find((entry) => entry.name === 'set_task_assignee');
    expect(tool, '目录里没有「set_task_assignee」').toBeDefined();
    expect(tool).toMatchObject({
      kind: 'write',
      egressFields: [],
      defaultEnabled: false,
      risk: 'write',
    });
    expect(tool?.description.length, 'set_task_assignee 的说明不能为空').toBeGreaterThan(10);
  });

  it('暴露了 inputSchema（object + additionalProperties:false）', () => {
    expect(hasInputSchemaFor('set_task_assignee')).toBe(true);
  });
});

describe('set_task_assignee：taskId + 可选 assigneeUserId → set-task-assignee', () => {
  it('给 assigneeUserId → intent 带该键（指派）', () => {
    expect(intentOf('set_task_assignee', { taskId: 't1', assigneeUserId: 'u1' })).toEqual({
      action: 'set-task-assignee',
      taskId: 't1',
      assigneeUserId: 'u1',
    });
  });

  it('🔴 省略 assigneeUserId → intent 不带该键（= 清除）', () => {
    const intent = intentOf('set_task_assignee', { taskId: 't1' });
    expect(intent).toEqual({ action: 'set-task-assignee', taskId: 't1' });
    expect('assigneeUserId' in intent).toBe(false);
  });

  it('🔴 空串 / 全空白 assigneeUserId → intent 不带该键（= 清除）', () => {
    for (const value of ['', '   ']) {
      const intent = intentOf('set_task_assignee', { taskId: 't1', assigneeUserId: value });
      expect(intent).toEqual({ action: 'set-task-assignee', taskId: 't1' });
      expect('assigneeUserId' in intent).toBe(false);
    }
  });

  it('taskId / assigneeUserId 两端空白被裁掉', () => {
    expect(intentOf('set_task_assignee', { taskId: ' t1 ', assigneeUserId: ' u1 ' })).toEqual({
      action: 'set-task-assignee',
      taskId: 't1',
      assigneeUserId: 'u1',
    });
  });
});

describe('🔴 严格参数白名单：schema 之外的键一律拒，且点名', () => {
  it('多给一个 schema 外的键就拒，并点名那个键', () => {
    const message = rejection('set_task_assignee', { taskId: 't1', assigneeUserId: 'u1', extra: true });
    expect(message).toContain('不支持这些参数');
    expect(message).toContain('extra');
  });
});

describe('缺必填 / 类型错 ⇒ 拒（不许产出半成品 intent）', () => {
  it('缺 taskId / 非字符串 / 空串 / 全空白 ⇒ 拒', () => {
    for (const args of [
      { assigneeUserId: 'u1' },
      { taskId: 42, assigneeUserId: 'u1' },
      { taskId: '', assigneeUserId: 'u1' },
      { taskId: '   ', assigneeUserId: 'u1' },
    ]) {
      expect(rejection('set_task_assignee', args)).toContain('taskId');
    }
  });

  it('assigneeUserId 给了但不是字符串 ⇒ 拒', () => {
    for (const value of [42, true, null, {}]) {
      expect(rejection('set_task_assignee', { taskId: 't1', assigneeUserId: value })).toContain('assigneeUserId');
    }
  });
});
