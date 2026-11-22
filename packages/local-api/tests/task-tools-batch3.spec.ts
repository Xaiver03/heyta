/**
 * 子任务 / 备注 / 重复写工具（批次 3）的参数层判据
 * ================================================
 *
 * 契约见 `docs/plans/2026-11-22-tool-layer-batch3-contract.md` §3（task.ts 表）：
 * `create_subtask` / `set_task_note` / `set_task_repeat` 三个写工具。
 *
 * 这里只测**参数 → 写入意图**这一个纯函数（`toWriteIntent`）：
 *
 *   1. 🔴 每个工具都登记进目录，`kind:'write'`、`egressFields:[]`、`defaultEnabled:false`、
 *      `risk:'write'` —— 写工具的结果不回送模型，所以它不贡献出境字段；
 *   2. 正确参数产出契约 §1 对应的 intent（形状逐字对齐，不多字段不少字段）；
 *   3. 🔴 **严格参数白名单**：schema 之外的键 ⇒ `{ok:false}` 且报错点名那个键，
 *      不许"忽略它照样执行"；
 *   4. 缺必填 / 类型错 ⇒ 拒，而不是产出一个字段是 undefined / 类型不对的 intent；
 *   5. 🔴 `set_task_note` 省略 `note`、`set_task_repeat` 省略 `rule` 时，
 *      intent **不带该键**（= 清除），而不是带一个 `undefined`；
 *   6. `set_task_repeat` 的 `rule` 原样传：合法性由动作层判，参数层不裁不改。
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

describe('目录登记：三个批次 3 写工具都在，且形状与契约表一致', () => {
  const ID_PARAM_BY_NAME: Readonly<Record<string, string>> = {
    create_subtask: 'parentId',
    set_task_note: 'taskId',
    set_task_repeat: 'taskId',
  };

  it('三条都登记为写工具，写工具不出境任何字段、默认关、risk 为 write', () => {
    for (const [name, idParam] of Object.entries(ID_PARAM_BY_NAME)) {
      const tool = LOCAL_API_TOOLS.find((entry) => entry.name === name);
      expect(tool, `目录里没有「${name}」`).toBeDefined();
      expect(tool).toMatchObject({
        kind: 'write',
        egressFields: [],
        defaultEnabled: false,
        risk: 'write',
      });
      // 说明要出境给模型：不能是空串，且要能说清参数（至少提到主 id 参数）。
      expect(tool?.description.length, `${name} 的说明不能为空`).toBeGreaterThan(10);
      expect(tool?.description, `${name} 的说明要写明 ${idParam}`).toContain(idParam);
    }
  });

  it('三条都暴露了 inputSchema（object + additionalProperties:false）', () => {
    for (const name of Object.keys(ID_PARAM_BY_NAME)) {
      expect(hasInputSchemaFor(name), `${name} 必须暴露 inputSchema`).toBe(true);
    }
  });
});

describe('create_subtask：parentId + title 必填 → create-subtask', () => {
  it('正确参数产出契约 §1 的 intent（形状逐字对齐）', () => {
    expect(intentOf('create_subtask', { parentId: 'p1', title: '买牛奶' })).toEqual({
      action: 'create-subtask',
      parentId: 'p1',
      title: '买牛奶',
    });
  });

  it('parentId 两端空白被裁掉（intent 里的 id 是干净的）', () => {
    expect(intentOf('create_subtask', { parentId: ' p1 ', title: '买牛奶' })).toEqual({
      action: 'create-subtask',
      parentId: 'p1',
      title: '买牛奶',
    });
  });
});

describe('set_task_note：taskId 必填，note 可选（省略 = 清除备注）', () => {
  it('带 note → set-task-note 且保留 note', () => {
    expect(intentOf('set_task_note', { taskId: 't1', note: '记得带伞' })).toEqual({
      action: 'set-task-note',
      taskId: 't1',
      note: '记得带伞',
    });
  });

  it('省略 note → set-task-note 且不带该键（= 清除备注）', () => {
    const intent = intentOf('set_task_note', { taskId: 't1' });
    expect(intent).toEqual({ action: 'set-task-note', taskId: 't1' });
    expect('note' in intent).toBe(false);
  });

  it('taskId 两端空白被裁掉', () => {
    expect(intentOf('set_task_note', { taskId: ' t1 ', note: 'x' })).toEqual({
      action: 'set-task-note',
      taskId: 't1',
      note: 'x',
    });
  });
});

describe('set_task_repeat：taskId 必填，rule 可选（省略 = 清除重复；rule 原样传）', () => {
  it('带 rule → set-task-repeat 且保留 rule', () => {
    expect(intentOf('set_task_repeat', { taskId: 't1', rule: 'FREQ=DAILY' })).toEqual({
      action: 'set-task-repeat',
      taskId: 't1',
      rule: 'FREQ=DAILY',
    });
  });

  it('省略 rule → set-task-repeat 且不带该键（= 清除重复）', () => {
    const intent = intentOf('set_task_repeat', { taskId: 't1' });
    expect(intent).toEqual({ action: 'set-task-repeat', taskId: 't1' });
    expect('rule' in intent).toBe(false);
  });

  it('rule 原样传：不裁空白、不改大小写（合法性由动作层判）', () => {
    expect(intentOf('set_task_repeat', { taskId: 't1', rule: ' FREQ=WEEKLY;BYDAY=MO ' })).toEqual({
      action: 'set-task-repeat',
      taskId: 't1',
      rule: ' FREQ=WEEKLY;BYDAY=MO ',
    });
  });
});

describe('🔴 严格参数白名单：schema 之外的键一律拒，且报错点名', () => {
  const cases: readonly [string, Record<string, unknown>][] = [
    ['create_subtask', { parentId: 'p1', title: 'x', extra: true }],
    ['set_task_note', { taskId: 't1', note: 'x', extra: true }],
    ['set_task_repeat', { taskId: 't1', rule: 'FREQ=DAILY', extra: true }],
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
  it('create_subtask：缺 parentId / 非字符串 / 空串 / 全空白 ⇒ 拒', () => {
    for (const args of [{ title: 'x' }, { parentId: 42, title: 'x' }, { parentId: '', title: 'x' }, { parentId: '   ', title: 'x' }]) {
      expect(rejection('create_subtask', args)).toContain('parentId');
    }
  });

  it('create_subtask：缺 title / 非字符串 / 空串 / 全空白 ⇒ 拒', () => {
    for (const args of [{ parentId: 'p1' }, { parentId: 'p1', title: 42 }, { parentId: 'p1', title: '' }, { parentId: 'p1', title: '   ' }]) {
      expect(rejection('create_subtask', args)).toContain('title');
    }
  });

  it('set_task_note：缺 taskId / 非字符串 / 空串 / 全空白 ⇒ 拒', () => {
    for (const args of [{}, { taskId: 42 }, { taskId: '' }, { taskId: '   ' }]) {
      expect(rejection('set_task_note', args)).toContain('taskId');
    }
  });

  it('set_task_note：note 给了但不是字符串 ⇒ 拒（要清除备注应省略它）', () => {
    expect(rejection('set_task_note', { taskId: 't1', note: 42 })).toContain('note');
    expect(rejection('set_task_note', { taskId: 't1', note: null })).toContain('note');
  });

  it('set_task_repeat：缺 taskId / 非字符串 / 空串 / 全空白 ⇒ 拒', () => {
    for (const args of [{}, { taskId: 42 }, { taskId: '' }, { taskId: '   ' }]) {
      expect(rejection('set_task_repeat', args)).toContain('taskId');
    }
  });

  it('set_task_repeat：rule 给了但不是字符串 ⇒ 拒（要清除重复应省略它）', () => {
    expect(rejection('set_task_repeat', { taskId: 't1', rule: 42 })).toContain('rule');
    expect(rejection('set_task_repeat', { taskId: 't1', rule: null })).toContain('rule');
  });
});
