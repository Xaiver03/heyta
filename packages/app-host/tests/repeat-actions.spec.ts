/**
 * 重复任务的测试
 * =================
 *
 * 用**真实引擎 + 真实 SQLite**（`:memory:`），和 `actions.spec.ts` 同一套台架 ——
 * 因为这里要证的是"动作产出了哪种 op"，而假探针对 op 的**形状**一无所知。
 *
 * 这一组测试盯的是四个**会静默出错**的地方：
 *
 *   1. **设一次重复发了几个 op。** 一个用户意图必须是一个 op（§3.4）。
 *      两个 op 就有"第二个没落上"的中间态：任务指着一个不存在的规则。
 *      这条断言会随实现变化而红 —— 它是拦住"顺手拆成两个 op"的那道门。
 *   2. **锚点会不会漂。** `repeatDtstart` 一旦跟着 `dueDate` 走，
 *      "每两周的周三"会在第二次完成之后整体错位一天 —— 而界面看上去完全正常。
 *   3. **完成重复任务会不会把它标成已完成。** 标了就再也不会回到列表里，
 *      用户下周看不到它。
 *   4. **提前勾选会不会不动。** 从"完成时刻"往后推的话，提前一天勾选
 *      算出来的下一个日期仍是原来那天，到期日纹丝不动。
 *
 * 🔴 时钟是**注入**的（`now`）。这一组测试的日期全是有意义的星期一/星期日，
 * 用真实时钟的话它们只能在某个特定日子通过 —— 那还不如不写。
 */

import { Recurrence, parseLocalDate, toLocalDate, type Reminder } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';
import { createReminderActions } from '../src/reminder-actions.js';

/** 2026-09-14 是周一（本仓库已多处锚定 2026-09-26 是周六）。 */
const MONDAY = '2026-09-14';
const NEXT_MONDAY = '2026-09-21';
/** 同一周的前一天（周日）。 */
const SUNDAY = '2026-09-13';

const EVERY_MONDAY = Recurrence.weekly(['MO']);

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TaskActions;
let clock = 0;
const now = (): number => clock;
let idSeq = 0;
const makeId = (): string => {
  idSeq += 1;
  return `task-r-${String(idSeq).padStart(3, '0')}`;
};

/** 某天**正午**的毫秒数 —— 正午做什么时区都不会掉到前一天。 */
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
    clientId: 'client-repeat-test',
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

/**
 * 取"载荷里带某个字段、且值满足条件"的**那一条** op，并断言它唯一。
 *
 * ⚠️ **刻意不用 `ops[len-1]`**：`getOpsForEntity` 的返回顺序在接口上是
 * **未定义**的（见 AGENTS.md §7 第 16 条：IndexedDB 按索引键、SQLite 按主键）。
 * 按位置取会让测试依赖某个存储的实现细节，换适配器就随机红。
 * 按**载荷内容**找是顺序无关的。
 *
 * ⚠️ 唯一性是**场景给的前提**，不是普适规律：一次 `setRepeat` 只该产生一条带
 * `repeatRule` 的 op；而"设一次再清一次"自然有两条（一条写规则、一条写 `null`），
 * 那种场景要用 `match` 区分。第一版没区分，"清除"那条用例因此假红 —— 是**测试**
 * 写错了，不是产品坏了（`repeatRule: null` 正是清字段该有的样子）。
 */
function opCarrying(
  ops: Operation<string>[],
  field: string,
  match: (value: unknown) => boolean = () => true,
): Operation<string> | undefined {
  const hits = ops.filter((op) => field in payloadOf(op) && match(payloadOf(op)[field]));
  expect(hits, `应该有且只有一条 op 满足 ${field} 的条件，实际 ${String(hits.length)} 条`).toHaveLength(1);
  return hits[0];
}

describe('🔴 建任务的可覆盖字段：名字必须与模型一致', () => {
  it('note 落到 `note` 上，而不是 `notes`（差一个字母就静默失效）', async () => {
    // ⚠️ 这条测试守的是**运行时落点**：`create` 把 `over` 原样铺进载荷，
    // 所以载荷的键名决定了 `Task` 上哪个字段被写。实测过它的前身：
    // 接口字段叫 `notes` 时，`create(t, {notes:'x'})` 得到的是
    // `task.notes === 'x'` 而 `task.note === undefined` —— 备注同步到所有设备，
    // 没有任何视图读得到。
    //
    // 🔴 **拦住"改名"的不是这条测试，是 `typecheck`。** 我最初在这里写了
    // "改名会立刻红"，然后真的把接口字段改回 `notes` 跑了一遍 —— **它照样全绿**
    // （测试传的是字面量 `note`，接口怎么声明不影响运行时）。
    // 真正报警的是 `tsc`：`TS2561: 'note' does not exist in type 'NewTaskFields'.`
    // 所以两句话各管一半，别把功劳记错。
    const id = await actions.create('带备注的任务', { note: '记得带伞' });

    const task = actions.findTask(id)! as unknown as Record<string, unknown>;
    expect(task['note'], 'Task.note 必须拿到备注').toBe('记得带伞');
    // 反向断言：不许出现一个没人读的 `notes` 残留字段。
    expect(task['notes'], '不许写一个没人读的 `notes` 字段').toBeUndefined();
  });
});

describe('setRepeat：一个用户意图 = 一个 op', () => {
  it('只产生**一条** op，且载荷同时含 repeatRule 与 repeatDtstart', async () => {
    const id = await actions.create('每周一交周报', { dueDate: parseLocalDate(MONDAY).getTime() });
    const before = (await opsOf(id)).length;

    await actions.setRepeat(id, EVERY_MONDAY);

    const ops = await opsOf(id);
    // 🔴 这条是 §3.4 的门：多出一条 op 就说明"设重复"被拆成了两次写入。
    expect(ops.length, '设重复只允许产生一条 op').toBe(before + 1);

    const op = opCarrying(ops, 'repeatRule')!;
    expect(op.opType).toBe(OpType.Update);
    expect(op.entityType).toBe('TASK');
    expect(payloadOf(op)['repeatRule']).toBe(EVERY_MONDAY);
    // 锚点 = 设规则那一刻的截止日
    expect(payloadOf(op)['repeatDtstart']).toBe(MONDAY);
  });

  it('任务没有截止日时，顺手把截止日补成今天（否则"有规则、没日子"）', async () => {
    const id = await actions.create('每周一交周报');
    await actions.setRepeat(id, EVERY_MONDAY);

    const op = opCarrying(await opsOf(id), 'repeatRule')!;
    expect(payloadOf(op)['repeatDtstart']).toBe(MONDAY);
    expect(op, '没有截止日就必须补一个').toBeDefined();

    const task = actions.findTask(id)!;
    expect(task.dueDate).toBe(parseLocalDate(MONDAY).getTime());
    expect(toLocalDate(task.dueDate!)).toBe(MONDAY);
  });

  it('取消重复会把**两个**字段都写成 null（不是 undefined）', async () => {
    const id = await actions.create('每周一交周报', { dueDate: parseLocalDate(MONDAY).getTime() });
    await actions.setRepeat(id, EVERY_MONDAY);
    await actions.setRepeat(id, undefined);

    const op = opCarrying(await opsOf(id), 'repeatRule', (v) => v === null)!;
    // 🔴 null 才能穿过 JSON —— undefined 会被 stringify 丢掉，
    // 于是对端收到一条**根本没有这个键**的载荷：既不清除也不设置，静默失效。
    // 这里同时断言两个字段都被清 —— 只清一个会留下"有锚点、没规则"的半截状态。
    expect(payloadOf(op)['repeatDtstart']).toBeNull();
    expect(actions.repeatOf(id)).toBeUndefined();
  });

  it('非法规则串被拒（而不是写进去等到某天再炸）', async () => {
    const id = await actions.create('任务', { dueDate: parseLocalDate(MONDAY).getTime() });
    await expect(actions.setRepeat(id, 'FREQ=EVERYDAY')).rejects.toThrow(/无效的重复规则/);
    // 关键：拒绝之后状态里不留半截
    expect(actions.repeatOf(id)).toBeUndefined();
  });
});

describe('repeatOf：坏规则在读取侧退化成"不重复"', () => {
  it('规则串损坏时返回 undefined，**不抛错**', async () => {
    const id = await actions.create('任务', { dueDate: parseLocalDate(MONDAY).getTime() });
    // 直接绕过 setRepeat 的校验写一条坏规则 —— 模拟"别的客户端写进来的"。
    await engine.dispatch({
      entityType: 'TASK' as never,
      entityId: id,
      opType: OpType.Update,
      payload: { repeatRule: '完全不是一条规则', repeatDtstart: MONDAY },
    });

    // 读取侧必须能容忍：occurrencesInRange 对坏规则会抛错，
    // 而"某一条任务坏了"不该让整个日期视图白屏。
    expect(() => actions.repeatOf(id)).not.toThrow();
    expect(actions.repeatOf(id)).toBeUndefined();
  });

  it('缺锚点也算没有规则（两个字段必须成对）', async () => {
    const id = await actions.create('任务', { dueDate: parseLocalDate(MONDAY).getTime() });
    await engine.dispatch({
      entityType: 'TASK' as never,
      entityId: id,
      opType: OpType.Update,
      payload: { repeatRule: EVERY_MONDAY },
    });
    expect(actions.repeatOf(id)).toBeUndefined();
  });
});

describe('🔴 完成一个重复任务：推进到期日，而不是标记完成', () => {
  it('到期日推进到下一次，且 **completedAt 仍然不存在**', async () => {
    const id = await actions.create('每周一交周报', { dueDate: parseLocalDate(MONDAY).getTime() });
    await actions.setRepeat(id, EVERY_MONDAY);

    await actions.toggleCompleted(id);

    const task = actions.findTask(id)!;
    expect(toLocalDate(task.dueDate!)).toBe(NEXT_MONDAY);
    // 标成完成的话它掉进「已完成」而且再也不出来 —— 下周用户就看不到它了。
    expect(task.completedAt, '重复任务勾选后必须仍是待办').toBeUndefined();
  });

  it('**提前**勾选也往后推（基准是到期日，不是完成时刻）', async () => {
    const id = await actions.create('每周一交周报', { dueDate: parseLocalDate(MONDAY).getTime() });
    await actions.setRepeat(id, EVERY_MONDAY);

    // 周日就提前把周一的活干完
    clock = noonOf(SUNDAY);
    await actions.toggleCompleted(id);

    // 从"完成时刻"(周日)往后推的话，下一个周一**就是**原文的 9/14 ——
    // 到期日纹丝不动，用户会以为勾选没生效。
    expect(toLocalDate(actions.findTask(id)!.dueDate!)).toBe(NEXT_MONDAY);
  });

  it('完成多次会连续推进，且锚点不漂', async () => {
    const id = await actions.create('每周一交周报', { dueDate: parseLocalDate(MONDAY).getTime() });
    await actions.setRepeat(id, EVERY_MONDAY);
    const anchor = actions.repeatOf(id)!.dtstart;

    await actions.toggleCompleted(id);
    clock = noonOf(NEXT_MONDAY);
    await actions.toggleCompleted(id);

    const task = actions.findTask(id)!;
    expect(toLocalDate(task.dueDate!)).toBe('2026-09-28');
    // 锚点必须钉在原处：跟着 dueDate 走会让 WEEKDAY/INTERVAL 的选择基准整体漂移。
    expect(task.repeatDtstart).toBe(anchor);
    expect(task.repeatDtstart).toBe(MONDAY);
  });

  it('规则走到尽头就退回普通完成（这是最后一件了）', async () => {
    const id = await actions.create('只此一次', { dueDate: parseLocalDate(MONDAY).getTime() });
    await actions.setRepeat(id, `${EVERY_MONDAY};COUNT=1`);

    await actions.toggleCompleted(id);

    const task = actions.findTask(id)!;
    expect(task.completedAt, '没有下一次就该正常标记完成').toBe(clock);
    expect(toLocalDate(task.dueDate!)).toBe(MONDAY);
  });

  it('**没有规则的普通任务**行为完全不变（回归保护）', async () => {
    const id = await actions.create('普通任务', { dueDate: parseLocalDate(MONDAY).getTime() });
    await actions.toggleCompleted(id);

    const task = actions.findTask(id)!;
    expect(task.completedAt).toBe(clock);
    expect(toLocalDate(task.dueDate!), '普通任务的到期日不该被动').toBe(MONDAY);
  });

  it('取消勾选在重复任务上是空操作，在普通任务上清掉完成态', async () => {
    const rep = await actions.create('每周一交周报', { dueDate: parseLocalDate(MONDAY).getTime() });
    await actions.setRepeat(rep, EVERY_MONDAY);
    await actions.toggleCompleted(rep);
    // 重复任务永远不会进入完成态，所以"取消完成"对它没有意义。
    expect(actions.findTask(rep)!.completedAt).toBeUndefined();

    const plain = await actions.create('普通任务');
    await actions.toggleCompleted(plain);
    expect(actions.findTask(plain)!.completedAt).toBe(clock);
    await actions.toggleCompleted(plain);
    expect(actions.findTask(plain)!.completedAt).toBeUndefined();
  });
});

/**
 * 🔴 这一组补的是一个**实测出来的"最后一米"**。
 *
 * 领域层的 `nextTriggerAfterRepeat` 写了、`reminder-actions.ts` 的
 * `rescheduleForRepeat` 也写了、`reminder-actions.spec.ts` 里还有 3 条单测 ——
 * 而 `grep rescheduleForRepeat` 在**生产代码里零命中**：
 * 完成一个重复任务时，它的提醒**不会**跟着新的截止走。
 *
 * 这个形状的特点是：**每一块单独看都是绿的**。
 * 动作层测试证明"到期日推进了"，提醒层测试证明"顺延函数算得对"，
 * 而两者之间**没有一条调用边** —— 只有把两件事放进**同一个**场景里才看得见。
 * （`docs/research/dida365-feature-benchmark.md` §3 的"基础设施做完了、最后一米没接"。）
 */
describe('🔴 完成重复任务时，它的提醒跟着新的截止走', () => {
  /**
   * 把"现在"从周一**正午**挪到周一**上午 10 点**。
   *
   * 🔴 这不是为了让测试"过得去"，是因为 `createReminderBeforeDue` 对**过去**的
   * 时刻**明确抛错**（领域层的宽限只有 1 分钟，见 `reminderRejection`）。
   * 外层台架把 `clock` 定在 `noonOf(MONDAY)`，那么"截止前 30 分钟"算出的是
   * 11:30 —— 一个**已经过去**的时刻，第一步建提醒就会抛。
   * ⇒ 要测"顺延之后提醒去哪了"，前提是这条提醒**先建得出来**。
   */
  beforeEach(() => {
    clock = noonOf(MONDAY) - 2 * 60 * 60 * 1000;
  });

  /** 与 `reminder-actions.ts` 里 `reminderId` 同形：`${taskId}:${triggerAt}`。 */
  const reminderIdOf = (taskId: string, triggerAt: number): string =>
    `${taskId}:${String(triggerAt)}`;

  /**
   * 顺延之后的到期时刻。
   *
   * 🔴 **它是下一个周一的零点，不是"原来那个时刻顺延一周"。**
   * `nextOccurrence` 返回的是 `LocalDate`（`'2026-09-21'`），
   * 而 `completeTask` 写的是 `parseLocalDate(next).getTime()` —— 于是**时刻被归零**。
   * 既有测试刻意只断言 `toLocalDate(dueDate) === NEXT_MONDAY`（日期级），
   * 所以这一点以前**没有任何判据**。
   *
   * ⚠️ 本轮**不修**它：那是"重复任务的时刻该不该保留"的**产品决定**，
   * 不是提醒接线该顺手改的。本条判据只负责"提醒跟着新的截止走"——
   * 到期日落在哪一刻，提醒就跟到那一刻，这是对的。
   * 该残差已登记到 `docs/plans/site-and-parity-alignment.md` 的欠账。
   */
  const advancedDueMs = parseLocalDate(NEXT_MONDAY).getTime();

  function remindersOf(taskId: string): Reminder[] {
    return Object.values(engine.getState().reminders).filter((r) => r.taskId === taskId);
  }

  it('带 `offsetMs` 的提醒重置到「新截止 − 提前量」', async () => {
    const reminders = createReminderActions(engine, { now });
    const taskId = await actions.create('每周一的会', { dueDate: noonOf(MONDAY) });
    await actions.setRepeat(taskId, EVERY_MONDAY);

    const THIRTY_MIN = 30 * 60 * 1000;
    await reminders.createReminderBeforeDue(taskId, THIRTY_MIN);
    const first = remindersOf(taskId);
    expect(first).toHaveLength(1);
    expect(first[0]?.triggerAt).toBe(noonOf(MONDAY) - THIRTY_MIN);

    await actions.setCompleted(taskId, true);

    // 任务顺延到下一个周一（**零点**，见 `advancedDueMs`）。
    expect(actions.findTask(taskId)!.dueDate).toBe(advancedDueMs);

    const after = remindersOf(taskId);
    expect(after).toHaveLength(1);
    // 🔴 提醒也跟着走 —— 这正是本轮补上的那条调用边。
    expect(after[0]?.triggerAt).toBe(advancedDueMs - THIRTY_MIN);
  });

  it('**绝对时刻**的提醒不动（"9 点提醒我"里的 9 点是绝对时间）', async () => {
    const reminders = createReminderActions(engine, { now });
    const taskId = await actions.create('每周一的会', { dueDate: noonOf(MONDAY) });
    await actions.setRepeat(taskId, EVERY_MONDAY);

    const absolute = noonOf(NEXT_MONDAY) + 3 * 60 * 60 * 1000;
    await reminders.createReminder(taskId, absolute);

    await actions.setCompleted(taskId, true);

    expect(remindersOf(taskId)[0]?.triggerAt).toBe(absolute);
  });

  it('新周期不继承旧 occurrence 的 fired 语义，保留 marker 供领域层判定', async () => {
    const reminders = createReminderActions(engine, { now });
    const taskId = await actions.create('每周一的会', { dueDate: noonOf(MONDAY) });
    await actions.setRepeat(taskId, EVERY_MONDAY);
    const THIRTY_MIN = 30 * 60 * 1000;
    const id = await reminders.createReminderBeforeDue(taskId, THIRTY_MIN);

    // 先让它"已投递"，再顺延 —— trigger 改变后旧 marker 自动失效。
    expect(await reminders.markReminderFired(id)).toBe(true);
    expect(engine.getState().reminders[id]?.firedAt).toBeDefined();

    await actions.setCompleted(taskId, true);

    expect(engine.getState().reminders[id]?.firedAt).toBeDefined();
    expect(engine.getState().reminders[id]?.firedForTriggerAt).toBe(noonOf(MONDAY) - THIRTY_MIN);
    expect(engine.getState().reminders[id]?.triggerAt).toBe(advancedDueMs - THIRTY_MIN);
  });

  it('legacy firedAt 在重复顺延时惰性绑定旧 trigger', async () => {
    const reminders = createReminderActions(engine, { now });
    const taskId = await actions.create('旧提醒', { dueDate: noonOf(MONDAY) });
    await actions.setRepeat(taskId, EVERY_MONDAY);
    const THIRTY_MIN = 30 * 60 * 1000;
    const id = await reminders.createReminderBeforeDue(taskId, THIRTY_MIN);
    const oldTrigger = noonOf(MONDAY) - THIRTY_MIN;

    await engine.dispatch({
      entityType: 'REMINDER', entityId: id, opType: OpType.Update,
      payload: { firedAt: now() },
    });
    await actions.setCompleted(taskId, true);

    const moved = engine.getState().reminders[id]!;
    expect(moved.firedAt).toBeDefined();
    expect(moved.firedForTriggerAt).toBe(oldTrigger);
    expect(moved.triggerAt).toBe(advancedDueMs - THIRTY_MIN);
  });

  it('**没有规则的普通任务**完成时不会碰提醒（回归保护）', async () => {
    const reminders = createReminderActions(engine, { now });
    const taskId = await actions.create('普通任务', { dueDate: noonOf(MONDAY) });
    const id = await reminders.createReminder(taskId, noonOf(MONDAY) + 60 * 60 * 1000);
    const before = engine.getState().reminders[id]?.triggerAt;

    await actions.setCompleted(taskId, true);

    expect(engine.getState().reminders[id]?.triggerAt).toBe(before);
  });

  it('墓碑提醒不会被顺延（不白写 op）', async () => {
    const reminders = createReminderActions(engine, { now });
    const taskId = await actions.create('每周一的会', { dueDate: noonOf(MONDAY) });
    await actions.setRepeat(taskId, EVERY_MONDAY);
    const THIRTY_MIN = 30 * 60 * 1000;
    const id = await reminders.createReminderBeforeDue(taskId, THIRTY_MIN);
    await reminders.removeReminder(id);

    const opsBefore = (await engine.getOpsForEntity('REMINDER', id)).length;
    await actions.setCompleted(taskId, true);

    expect((await engine.getOpsForEntity('REMINDER', id)).length).toBe(opsBefore);
    // 顺带确认 `reminderId` 的形状没变（它是这个用例定位实体的前提）。
    expect(id).toBe(reminderIdOf(taskId, noonOf(MONDAY) - THIRTY_MIN));
  });
});
