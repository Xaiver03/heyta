/**
 * 「跳过这一次」（R3）—— 行为判据
 * ================================
 *
 * 盯四件会**静默出错**的事：
 *
 *   1. **跳过一次只去掉那一次**。其它日期一次都不许动（判据 R3-①）。
 *      🔴 关掉 `recurrence.ts` 的 `exDates` 过滤，这条必须红。
 *   2. **一条 op**：`{ exDates, dueDate }` 同一条载荷里原子生效（§3.4）。
 *   3. **可撤销**：它是普通单实体 `UPD`，`history.ts` 的 `undo()` 必须算得出反向意图
 *      （判据 R3-②）。如果哪天有人给它加上宽带标记（`heytaTaskRepeatCompletion` 那种），
 *      撤销会**静默失效**（历史栈把宽带 op 判成 `batch` 跳过）—— 这条测试就是那道门。
 *   4. **跳完再完成，不会掉回被跳过的那一天**（否则用户跳过两次就在原地打转）。
 *
 * 时钟注入（`now`），日期全是有意义的周一 —— 用真实时钟的话这条只能在某个特定日子通过。
 */

import { Recurrence, parseLocalDate, toLocalDate } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';

/** 2026-09-14 / 21 / 28 都是周一。 */
const MONDAY = '2026-09-14';
const NEXT_MONDAY = '2026-09-21';
const THIRD_MONDAY = '2026-09-28';
const EVERY_MONDAY = Recurrence.weekly(['MO']);

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TaskActions;
let clock = 0;
const now = (): number => clock;
let idSeq = 0;
const makeId = (): string => {
  idSeq += 1;
  return `task-skip-${String(idSeq).padStart(3, '0')}`;
};

function noonOf(date: string): number {
  return parseLocalDate(date).getTime() + 12 * 60 * 60 * 1000;
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-skip-test',
    now,
  });
  clock = noonOf(MONDAY);
  idSeq = 0;
  actions = createTaskActions(engine, { now, newTaskId: makeId });
});

afterEach(() => {
  adapter.close();
});

function payloadOf(op: Operation<string>): Record<string, unknown> {
  return op.payload as Record<string, unknown>;
}

async function opsOf(entityId: string): Promise<Operation<string>[]> {
  return engine.getOpsForEntity('TASK', entityId);
}

/** 一条"每周一"的任务，到期日 = `MONDAY`。 */
async function makeWeekly(): Promise<string> {
  const id = await actions.create('每周一交周报', { dueDate: noonOf(MONDAY) });
  await actions.setRepeat(id, EVERY_MONDAY);
  return id;
}

describe('R3-① 跳过一次：只去掉那一次，其它次不受影响', () => {
  it('跳掉 9/21 ⇒ 到期日变成 9/28，9/14 与 10/5 仍按规则出现', async () => {
    const id = await makeWeekly();
    // 先走到"当前那一次"是 9/21（模拟一周过去了）。
    await engine.dispatch({
      entityType: 'TASK' as never,
      entityId: id,
      opType: OpType.Update,
      payload: { dueDate: noonOf(NEXT_MONDAY), dueDateLocal: NEXT_MONDAY },
    });

    const result = await actions.skipOccurrence(id);
    expect(result).toEqual({ skipped: NEXT_MONDAY, next: THIRD_MONDAY });

    const task = actions.findTask(id)!;
    expect(toLocalDate(task.dueDate!)).toBe(THIRD_MONDAY);
    expect(task.dueDateLocal).toBe(THIRD_MONDAY);
    expect(task.exDates).toEqual([NEXT_MONDAY]);
    // 「跳过」不是完成 —— 它必须仍然是待办，否则它从列表里彻底消失。
    expect(task.completedAt).toBeUndefined();
    // 规则本身一个字都没动（跳过一次不改节奏）。
    expect(task.repeatRule).toBe(EVERY_MONDAY);
    expect(task.repeatDtstart).toBe(MONDAY);
  });

  it('连跳两次 ⇒ 两次都不出现，第三次照旧', async () => {
    const id = await makeWeekly();
    await engine.dispatch({
      entityType: 'TASK' as never,
      entityId: id,
      opType: OpType.Update,
      payload: { dueDate: noonOf(NEXT_MONDAY), dueDateLocal: NEXT_MONDAY },
    });
    await actions.skipOccurrence(id); // 跳过 9/21 → 9/28
    const second = await actions.skipOccurrence(id); // 跳过 9/28 → 10/5
    expect(second).toEqual({ skipped: THIRD_MONDAY, next: '2026-10-05' });

    const task = actions.findTask(id)!;
    expect(task.exDates).toEqual([NEXT_MONDAY, THIRD_MONDAY]);
    expect(task.dueDateLocal).toBe('2026-10-05');
  });

  it('规则走到尽头时拒绝，且**零 op**（凭空造一个 exDate 只会留个死角）', async () => {
    const id = await actions.create('只做三次', { dueDate: noonOf(MONDAY) });
    await actions.setRepeat(id, 'FREQ=WEEKLY;BYDAY=MO;COUNT=1');
    const before = (await opsOf(id)).length;

    await expect(actions.skipOccurrence(id)).rejects.toThrow(/没有下一次/);
    expect((await opsOf(id)).length, '拒绝时不许写 op').toBe(before);
    expect(actions.findTask(id)!.exDates).toBeUndefined();
  });

  it('不是重复任务时拒绝（"这一次"这个概念不存在）', async () => {
    const id = await actions.create('一次性任务', { dueDate: noonOf(MONDAY) });
    await expect(actions.skipOccurrence(id)).rejects.toThrow(/没有重复规则/);
  });
});

describe('R3 §3.4 一条 op', () => {
  it('跳过一次只产生**一条** op，且载荷同时含 exDates 与 dueDate', async () => {
    const id = await makeWeekly();
    await engine.dispatch({
      entityType: 'TASK' as never,
      entityId: id,
      opType: OpType.Update,
      payload: { dueDate: noonOf(NEXT_MONDAY), dueDateLocal: NEXT_MONDAY },
    });
    const before = (await opsOf(id)).length;

    await actions.skipOccurrence(id);

    const ops = await opsOf(id);
    expect(ops.length, '跳过这一次只允许产生一条 op').toBe(before + 1);
    const op = ops.find((item) => 'exDates' in payloadOf(item))!;
    expect(op).toBeDefined();
    // 两个字段必须在**同一条** op 里：分开写会留下"记了跳过、日期没动"的中间态。
    expect(payloadOf(op)['exDates']).toEqual([NEXT_MONDAY]);
    expect(payloadOf(op)['dueDateLocal']).toBe(THIRD_MONDAY);
    expect(payloadOf(op)['dueDate']).toBe(parseLocalDate(THIRD_MONDAY).getTime());
  });
});

describe('R3-② 可撤销：它是普通单实体 UPD，不进"不可撤销"那一档', () => {
  it('undo() 能把 exDates 与到期日一起写回去', async () => {
    const id = await makeWeekly();
    await engine.dispatch({
      entityType: 'TASK' as never,
      entityId: id,
      opType: OpType.Update,
      payload: { dueDate: noonOf(NEXT_MONDAY), dueDateLocal: NEXT_MONDAY },
    });
    await actions.skipOccurrence(id);
    expect(actions.findTask(id)!.exDates).toEqual([NEXT_MONDAY]);
    expect(engine.historyState().canUndo).toBe(true);

    const outcome = await engine.undo();
    /**
     * 🔴 这条断言是**设计门**，不是形式检查：`undo()` 对宽带标记
     * （`heytaTaskBatch` / `heytaTaskPriorityBatch` / `heytaTaskRepeatCompletion`）
     * 一律返回 `unsupported` —— 也就是说"跳过这一次"只要哪天被人改成
     * 带 `heytaTaskRepeatCompletion`（为了顺手重排提醒），撤销就会**静默失效**，
     * 而界面上只是在按 ⌘Z 时什么都不发生。
     */
    expect(outcome.status, '跳过一次必须可撤销（否则 R3-② 失败）').toBe('applied');

    const after = actions.findTask(id)!;
    expect(after.exDates, '撤销后这一天不再是"跳过的"').toBeUndefined();
    expect(toLocalDate(after.dueDate!)).toBe(NEXT_MONDAY);
  });
});

describe('跳完再完成：不会掉回被跳过的那一天', () => {
  it('跳过 9/21 → 完成 9/28 ⇒ 下一次是 10/5（不是 10/5 之前再撞一次 9/21 区间）', async () => {
    const id = await makeWeekly();
    // ⚠️ 这一条**刻意不写 `dueDateLocal`**：带 `dueDateLocal` 的重复任务一勾完成
    // 就会撞上 `packages/shared-schema` 的一个**既有**契约缺口（见下面那条 `it.fails`）。
    // 这里要证的只是"跳过之后完成不会回到被跳过的那一天"，与那个缺口无关。
    await engine.dispatch({
      entityType: 'TASK' as never,
      entityId: id,
      opType: OpType.Update,
      payload: { dueDate: noonOf(NEXT_MONDAY) },
    });
    await actions.skipOccurrence(id); // → 9/28，exDates=[9/21]
    await actions.toggleCompleted(id); // 完成 9/28（固定排期 ⇒ 从当前到期日往后推）

    const task = actions.findTask(id)!;
    expect(task.completedAt, '重复任务完成不写 completedAt').toBeUndefined();
    expect(toLocalDate(task.dueDate!)).toBe('2026-10-05');
    expect(task.exDates, '跳过的记录留着（撤销与审计都要它）').toEqual([NEXT_MONDAY]);
  });

  /**
   * 2026-11-06 **已修**（总包动的不可逆层）：`packages/shared-schema` 的
   * `task-repeat-completion-contract.ts` 的 `taskPatch` 收了**可选** `dueDateLocal`
   * （并加了一条"它与 `dueDate` 必须同一天"的不变量）。
   *
   * 修之前这里的形状是：`taskPatch` 是 `.strict()` 且只允许
   * `{ dueDate, widgetCompletionReceipts }`，而 `completeTask` 会把 `dueDateLocal`
   * 一起写进载荷（那是**对的**：不写它 `dueLocalDateOf` 会优先读旧值，任务显示在
   * 错误的日期上）⇒ 任何带 `dueDateLocal` 的重复任务一勾完成就抛
   * `Invalid or unsupported task repeat completion`。
   * 这条用例当初用 `it.fails` 登记那个缺口（"哪天它开始通过，这一格就会红"）；
   * 缺口修好之后按约定翻成正常的 `it` —— 它现在钉的是**修好之后的形状**：
   * 跳过 + 完成这条路上，`dueDateLocal` 被正确推进，且不触发契约校验。
   */
  it('带 dueDateLocal 的重复任务也能完成：到期日推到 10/5（2026-11-06 修好的那条契约）', async () => {
    const id = await makeWeekly();
    await engine.dispatch({
      entityType: 'TASK' as never,
      entityId: id,
      opType: OpType.Update,
      payload: { dueDate: noonOf(NEXT_MONDAY), dueDateLocal: NEXT_MONDAY },
    });
    await actions.skipOccurrence(id);
    await actions.toggleCompleted(id);
    const task = actions.findTask(id)!;
    expect(toLocalDate(task.dueDate!)).toBe('2026-10-05');
    expect(task.dueDateLocal, 'dueDateLocal 必须跟着到期日一起推进（否则界面显示在旧日期上）').toBe('2026-10-05');
    expect(task.exDates).toEqual([NEXT_MONDAY]);
  });

  it('事后把 9/21 重新变回"要做的"：把 exDates 清掉，规则立刻又给出它', async () => {
    const id = await makeWeekly();
    await engine.dispatch({
      entityType: 'TASK' as never,
      entityId: id,
      opType: OpType.Update,
      payload: { dueDate: noonOf(NEXT_MONDAY), dueDateLocal: NEXT_MONDAY },
    });
    await actions.skipOccurrence(id);
    await engine.dispatch({
      entityType: 'TASK' as never,
      entityId: id,
      opType: OpType.Update,
      payload: { exDates: null },
    });
    const repeat = actions.repeatOf(id)!;
    expect(repeat.exDates).toEqual([]);
  });
});
