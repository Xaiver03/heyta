/**
 * 五个新实体（TAG / NOTE / HABIT_LOG / FOCUS_SESSION / REMINDER）的**宿主层行为判据**
 * ==========================================================================
 *
 * 台架与 `local-api-host-project-habit.spec.ts` 同一个（真引擎 + 真 SQLite `:memory:`），
 * 因为要证的是同一件事：**"我调了个函数"不算，磁盘上多了一条 op 才算。**
 * 假宿主只能证明"我没调它"，证明不了"落下来的那条 op 形状对"。
 *
 * 这批用例针对的是每条新通道**各自最贵**的那个失败形状：
 *
 *   1. 🔴 TAG：`set-task-tags` 是**整组覆盖**。一个悬空 id 必须让**整次写入不落地**
 *      （部分生效 = 界面上标签少了一半，而 op-log 里只有一条正常的 UPD）
 *   2. 🔴 NOTE：正文**不在列表里、在单条里**。这句出境承诺唯一的执行点是投影函数，
 *      所以判据必须两边各量一次（只量一边时，"两边都带正文"和"两边都不带"都能过）
 *   3. 🔴 HABIT_LOG：同一天重复打卡是**幂等成功**，且**不产生第二条 op**（ADR-0009 那个形状）。
 *      报 `ok:false` 会让用户以为没打上，而再点一次也还是"打上"
 *   4. 🔴 FOCUS_SESSION：写侧收**分钟**、读侧回**毫秒**（换算只允许住在宿主这一处），
 *      而"没有 taskId"必须是**键不存在**、不是 `null`（`null` 会原样进 JSON 出境）
 *   5. 🔴 REMINDER：`minutesBeforeDue` 落的是 **offset**不是算好的绝对时刻（否则重复任务
 *      顺延后提醒留在旧时刻）；上限与"已过 / 太远"由领域层判，**数字不许抄在这一层**
 *
 * 时钟是注入的（`options.now`），所以"今天"由测试定，不由跑测试那一刻的墙上时钟定。
 */

import {
  DAY_MS,
  MAX_REMINDER_LEAD_MS,
  MAX_REMINDERS_PER_TASK,
  NOTE_MAX_CONTENT_LENGTH,
  localDateTimeToEpoch,
  today,
} from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions } from '../src/actions.js';
import { habitLogId } from '../src/habit-actions.js';
import { createLocalApiHost } from '../src/local-api-host.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let clock = 1_700_000_000_000;
const now = (): number => clock;

function makeHost() {
  return createLocalApiHost(engine, createTaskActions(engine, { now }), {
    isReadable: () => true,
    now,
  });
}

/** 未删除的条数 —— "拒绝的那一次什么都没写"要数得出分母。 */
function alive<K extends keyof ReturnType<OpLogEngine['getState']>>(key: K): number {
  const record = engine.getState()[key] as Record<string, { deletedAt?: number }>;
  return Object.values(record).filter((x) => x.deletedAt === undefined).length;
}

async function opsOf(entityType: Parameters<OpLogEngine['getOpsForEntity']>[0], entityId: string): Promise<Operation<string>[]> {
  return engine.getOpsForEntity(entityType, entityId);
}

/** 落一条任务并返回它的 id（标签、提醒、专注都要挂在真任务上）。 */
async function newTask(title = '写周报'): Promise<string> {
  const result = await makeHost().submit({ action: 'create-task', title });
  if (!result.ok) throw new Error(`前置任务没建出来：${result.message}`);
  return result.taskId;
}

async function newHabit(name = '喝水', target = 8): Promise<string> {
  const result = await makeHost().submit({ action: 'create-habit', name, target });
  if (!result.ok) throw new Error(`前置习惯没建出来：${result.message}`);
  return result.taskId;
}

async function newTag(name: string): Promise<string> {
  const result = await makeHost().submit({ action: 'create-tag', name });
  if (!result.ok) throw new Error(`前置标签没建出来：${result.message}`);
  return result.taskId;
}

/** 从注入的时钟往后数 n 天，返回本机的 `YYYY-MM-DD`。 */
function dayAfter(clockMs: number, days: number): string {
  return today(clockMs + days * 86_400_000);
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-test',
    now: () => clock,
  });
  clock = 1_700_000_000_000;
});

afterEach(() => {
  adapter.close();
});

// ───────────────────────────────────────────────────────────────────────────
describe('TAG：建标签与整组覆盖任务的标签', () => {
  it('create-tag 产出一条 TAG CRT，名字 trim 后落盘，且 listTags 立刻读得回来', async () => {
    const host = makeHost();
    const result = await host.submit({ action: 'create-tag', name: '  重要  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ops = await opsOf('TAG', result.taskId);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.opType).toBe(OpType.Create);
    expect(ops[0]?.payload).toEqual({ name: '重要' });

    // 🔴 写→读闭环：这条挡的是"op 落对了但投影漏搬一个字段" ——
    // 那种情况界面看得见、AI 看不见，两边都不报错。
    expect(await host.listTags()).toEqual([{ id: result.taskId, name: '重要' }]);
    expect(result.entityType).toBe('TAG');
    expect(result.entityId).toBe(result.taskId);
  });

  it('🔴 空白名拒绝，且**一条 op 都没写**（不落成空标签）', async () => {
    const before = alive('tags');
    const result = await makeHost().submit({ action: 'create-tag', name: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
    expect(alive('tags')).toBe(before);
  });

  it('🔴 set-task-tags 是**整组覆盖**：第二次只交 b，a 就真的没了', async () => {
    const host = makeHost();
    const taskId = await newTask();
    const a = await newTag('a');
    const b = await newTag('b');

    expect((await host.submit({ action: 'set-task-tags', taskId, tagIds: [a, b] })).ok).toBe(true);
    expect(engine.getState().tasks[taskId]?.tagIds).toEqual([a, b]);

    const second = await host.submit({ action: 'set-task-tags', taskId, tagIds: [b] });
    expect(second.ok).toBe(true);
    // 不是"追加"：a 被摘掉了。这是界面里那个动作的唯一语义。
    expect(engine.getState().tasks[taskId]?.tagIds).toEqual([b]);
  });

  it('🔴 悬空 id ⇒ 拒绝并**点名是哪一个**，而任务上原有的标签一字未改', async () => {
    const host = makeHost();
    const taskId = await newTask();
    const real = await newTag('真实');
    await host.submit({ action: 'set-task-tags', taskId, tagIds: [real] });

    const before = engine.getState().tasks[taskId]?.tagIds;
    const result = await host.submit({
      action: 'set-task-tags',
      taskId,
      tagIds: [real, 'tag-不存在'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not-found');
      // 读者是用户：他要的是"哪一个"，不是整句"找不到标签"。
      expect(result.message).toContain('tag-不存在');
    }
    // 🔴 这一句才是这条用例的重心：部分写入不会报错，只会让界面上"少了一个标签"。
    expect(engine.getState().tasks[taskId]?.tagIds).toEqual(before);
  });

  it('空数组 = 清空（合法动作）：原有标签真的没了，而且之后还能再挂上', async () => {
    const host = makeHost();
    const taskId = await newTask();
    const tag = await newTag('要摘掉');
    await host.submit({ action: 'set-task-tags', taskId, tagIds: [tag] });

    const result = await host.submit({ action: 'set-task-tags', taskId, tagIds: [] });
    expect(result.ok).toBe(true);
    // 🔴 `setTags` 交出去的是 `tagIds: null`（它的 payload 纪律：空集合写 `null`，
    // 见 actions.ts 的接口注释），而 reducer 把 `null` 读成**清除这个字段** ——
    // 所以物化状态里是"键不存在"。断言写成 `[]` 会挡住真正要防的那件事：
    // 清空没生效、界面上标签还挂着。
    expect(engine.getState().tasks[taskId]?.tagIds).toBeUndefined();

    // 第二腿：清空不是一次性的。少了这条，"写坏了字段、以后再也挂不上"也能过第一腿。
    const again = await host.submit({ action: 'set-task-tags', taskId, tagIds: [tag] });
    expect(again.ok).toBe(true);
    expect(engine.getState().tasks[taskId]?.tagIds).toEqual([tag]);
  });

  it('🔴 重复的 tag id 不会写出 `[a, a]`（去重由 `setTags` 做，这里验它真的做了）', async () => {
    const host = makeHost();
    const taskId = await newTask();
    const tag = await newTag('同一个');
    const result = await host.submit({ action: 'set-task-tags', taskId, tagIds: [tag, tag] });
    expect(result.ok).toBe(true);
    expect(engine.getState().tasks[taskId]?.tagIds).toEqual([tag]);
  });

  it('任务不存在 ⇒ not-found 且不写 op', async () => {
    const tag = await newTag('留着');
    const result = await makeHost().submit({
      action: 'set-task-tags',
      taskId: 'task-不存在',
      tagIds: [tag],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('软删除的标签不能挂上去（悬空引用的另一种面目）', async () => {
    const host = makeHost();
    const taskId = await newTask();
    const tag = await newTag('会删的');
    await engine.dispatch({
      entityType: 'TAG',
      entityId: tag,
      opType: OpType.Delete,
      payload: {},
    });

    const result = await host.submit({ action: 'set-task-tags', taskId, tagIds: [tag] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(tag);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('NOTE：正文只在单条里出来', () => {
  it('🔴 create-note 落一条 CRT；列表行**没有正文**，get_note **有**', async () => {
    const host = makeHost();
    const result = await host.submit({ action: 'create-note', content: '买咖啡豆' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ops = await opsOf('NOTE', result.taskId);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.payload).toMatchObject({ content: '买咖啡豆' });
    expect(result.entityType).toBe('NOTE');

    // 两条腿都要量：只量"列表没有"时，"get 也没有"能一起过；
    // 只量"get 有"时，"列表把正文也带出去"能一起过 —— 而后者是出境数据变多。
    const rows = await host.listNotes(10);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['id', 'isPinnedToToday', 'projectId', 'updatedAt']);
    expect(JSON.stringify(rows)).not.toContain('买咖啡豆');

    const single = await host.getNote(result.taskId);
    expect(single?.content).toBe('买咖啡豆');
  });

  it('未归属的便签在出境数据里 `projectId` 是 `null`，不是**整个键消失**', async () => {
    const host = makeHost();
    const created = await host.submit({ action: 'create-note', content: '随手记' });
    if (!created.ok) throw new Error('前置便签没建出来');

    const row = (await host.listNotes(10))[0];
    // 实体里"未归属"是**缺字段**，而 `JSON.stringify` 会把 `undefined` 整个吞掉 ——
    // 那样"未归属"和"这次没算出来"在出境的 JSON 里长得一模一样。
    expect(row).toHaveProperty('projectId', null);
    expect(Object.keys(row ?? {})).toContain('projectId');
  });

  it('归属与钉今天**逐字进 payload**，并且读得回来', async () => {
    const host = makeHost();
    const project = await host.submit({ action: 'create-project', name: '家' });
    if (!project.ok) throw new Error('前置清单没建出来');

    const created = await host.submit({
      action: 'create-note',
      content: '交电费',
      projectId: project.taskId,
      isPinnedToToday: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect((await opsOf('NOTE', created.taskId))[0]?.payload).toMatchObject({
      content: '交电费',
      projectId: project.taskId,
      isPinnedToToday: true,
    });

    const row = (await host.listNotes(10)).find((x) => x.id === created.taskId);
    expect(row?.projectId).toBe(project.taskId);
    expect(row?.isPinnedToToday).toBe(true);
  });

  it('🔴 空正文与只有空格都拒绝，且不写 op（不建出一条空白便签）', async () => {
    const host = makeHost();
    for (const content of ['', '   ']) {
      const before = alive('notes');
      const result = await host.submit({ action: 'create-note', content });
      expect(result.ok, JSON.stringify(content)).toBe(false);
      if (!result.ok) expect(result.reason).toBe('invalid');
      expect(alive('notes'), `正文 ${JSON.stringify(content)} 之后不该多一条便签`).toBe(before);
    }
  });

  it('🔴 超长拒绝，且拒绝话里的数字**就是领域层那个**（这一层不抄长度）', async () => {
    const host = makeHost();
    const tooLong = '字'.repeat(NOTE_MAX_CONTENT_LENGTH + 1);
    const result = await host.submit({ action: 'create-note', content: tooLong });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(String(NOTE_MAX_CONTENT_LENGTH));
      expect(alive('notes')).toBe(0);
    }
  });

  it('恰好等于上限是**合法**的（边界不许偷偷收紧）', async () => {
    const result = await makeHost().submit({
      action: 'create-note',
      content: '字'.repeat(NOTE_MAX_CONTENT_LENGTH),
    });
    expect(result.ok).toBe(true);
  });

  it('不存在的 projectId ⇒ not-found 且不写便签', async () => {
    const host = makeHost();
    const before = alive('notes');
    const result = await host.submit({
      action: 'create-note',
      content: '放进没建的清单',
      projectId: 'project-不存在',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
    expect(alive('notes')).toBe(before);
  });

  it('🔴 update-note：不存在拒绝；空正文拒绝且**原正文没被改**；成功则 get 读回新正文', async () => {
    const host = makeHost();
    const created = await host.submit({ action: 'create-note', content: '原文' });
    if (!created.ok) throw new Error('前置便签没建出来');
    const noteId = created.taskId;

    const missing = await host.submit({ action: 'update-note', noteId: 'note-不存在', content: '改点东西' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe('not-found');

    const empty = await host.submit({ action: 'update-note', noteId, content: '  ' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe('invalid');
    // 🔴 重心在这一句：校验顺序错了的话，正文已经被清空、然后才报错。
    expect((await host.getNote(noteId))?.content).toBe('原文');

    const ok = await host.submit({ action: 'update-note', noteId, content: '改过了' });
    if (!ok.ok) throw new Error(`update-note 该成功：${ok.message}`);
    expect(ok.entityType).toBe('NOTE');
    expect((await host.getNote(noteId))?.content).toBe('改过了');
    const ops = await opsOf('NOTE', noteId);
    expect(ops).toHaveLength(2);
    expect(ops[1]?.opType).toBe(OpType.Update);
  });

  it('删掉的便签读不到正文（getNote 回 undefined，不是抛错也不是空便签）', async () => {
    const host = makeHost();
    const created = await host.submit({ action: 'create-note', content: '会删' });
    if (!created.ok) throw new Error('前置便签没建出来');
    await engine.dispatch({
      entityType: 'NOTE',
      entityId: created.taskId,
      opType: OpType.Delete,
      payload: {},
    });
    expect(await host.getNote(created.taskId)).toBeUndefined();
    expect(await host.listNotes(10)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('HABIT_LOG：打卡落的是记录，同一天不产生第二条', () => {
  it('🔴 不传 date ⇒ 落在**注入时钟的那一天**，value 缺省取该习惯自己的目标', async () => {
    const host = makeHost();
    const habitId = await newHabit('喝水', 8);

    const result = await host.submit({ action: 'record-checkin', habitId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const day = today(clock);
    // 🔴 断言的是"用了宿主的注入时钟"，不是"用了某天的日历"。
    // 拿掉 `options.now` 时这里会读成跑测试那一刻的今天，而它和 clock 不同一天。
    expect(result.entityId).toBe(habitLogId(habitId, day));
    expect(result.entityType).toBe('HABIT_LOG');

    const ops = await opsOf('HABIT_LOG', result.entityId ?? '');
    expect(ops).toHaveLength(1);
    expect(ops[0]?.payload).toMatchObject({ habitId, date: day, value: 8 });

    const logs = await host.listHabitLogs(habitId, 10);
    expect(logs).toEqual([{ habitId, date: day, value: 8 }]);
  });

  it('🔴 同一天再打一次：仍是 `ok: true` 且**记录只有一条**，幂等挡的是"没有变化"', async () => {
    const host = makeHost();
    const habitId = await newHabit('冥想');

    const first = await host.submit({ action: 'record-checkin', habitId, date: '2024-03-01', value: 1 });
    if (!first.ok) throw new Error(`第一次打卡该成功：${first.message}`);
    const logId = first.entityId;

    // 同一天**同一个量** ⇒ 幂等成功，一条 op 都不许多写（ADR-0009 那一族）。
    const same = await host.submit({ action: 'record-checkin', habitId, date: '2024-03-01', value: 1 });
    expect(same.ok).toBe(true);
    expect(same.entityId).toBe(logId);
    expect(await opsOf('HABIT_LOG', logId ?? '')).toHaveLength(1);

    // 同一天**另一个量** ⇒ 改当日那条的量，仍然不多出一条记录。
    // ⚠️ 这一句是合并时改写的：原来这里断的是"第二次的 value 没落进去"，
    // 因为当时 `checkIn` 遇到已有记录一律 return false —— 那是**能力缺失**（界面上改不了当日的量），
    // 不是这条用例要守的承诺。它守的是"标识 = (习惯, 日期)、重复调用不会多出第二条"，
    // 而详情面 W6 之后那个承诺依然成立，op 数从 1 变 2 是改量应有的形状。
    const second = await host.submit({ action: 'record-checkin', habitId, date: '2024-03-01', value: 5 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.entityId).toBe(logId);
    expect(await host.listHabitLogs(habitId, 10)).toHaveLength(1);
    expect((await host.listHabitLogs(habitId, 10))[0]?.value).toBe(5);
    expect(await opsOf('HABIT_LOG', logId ?? '')).toHaveLength(2);
  });

  it('不同日期各一条（幂等只挡同一天，不许把整个习惯锁住）', async () => {
    const host = makeHost();
    const habitId = await newHabit('晨跑');
    expect((await host.submit({ action: 'record-checkin', habitId, date: '2024-03-01' })).ok).toBe(true);
    expect((await host.submit({ action: 'record-checkin', habitId, date: '2024-03-02' })).ok).toBe(true);
    expect(await host.listHabitLogs(habitId, 10)).toHaveLength(2);
    expect(alive('habitLogs')).toBe(2);
  });

  it('🔴 非法数值一律拒绝且**不写 op**；0 是合法的（`atMost` 的"今天一次都没碰"）', async () => {
    const host = makeHost();
    const habitId = await newHabit('不碰手机');
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const before = alive('habitLogs');
      const result = await host.submit({ action: 'record-checkin', habitId, value });
      expect(result.ok, String(value)).toBe(false);
      if (!result.ok) expect(result.reason, String(value)).toBe('invalid');
      expect(alive('habitLogs'), `value=${String(value)} 之后不该多一条`).toBe(before);
    }
    expect((await host.submit({ action: 'record-checkin', habitId, value: 0 })).ok).toBe(true);
  });

  it('习惯不存在 ⇒ not-found 且不写；不存在的 habit 不许被"顺手建出来"', async () => {
    const before = alive('habitLogs');
    const result = await makeHost().submit({ action: 'record-checkin', habitId: 'habit-不存在' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
    expect(alive('habitLogs')).toBe(before);
  });

  it('🔴 listHabitLogs 只出 habitId / date / value —— 打卡备注一个字段都不出去', async () => {
    const host = makeHost();
    const habitId = await newHabit('喝水');
    const created = await host.submit({ action: 'record-checkin', habitId, date: '2024-03-01', value: 3 });
    if (!created.ok) throw new Error('前置打卡没落下来');

    // 直接对实体写一条带备注的状态（模拟用户在界面上写了备注）。
    await engine.dispatch({
      entityType: 'HABIT_LOG',
      entityId: created.entityId ?? '',
      opType: OpType.Update,
      payload: { note: '今天状态很好', count: 9 },
    });

    const logs = await host.listHabitLogs(habitId, 10);
    expect(logs).toHaveLength(1);
    expect(Object.keys(logs[0] ?? {}).sort()).toEqual(['date', 'habitId', 'value']);
    expect(JSON.stringify(logs)).not.toContain('今天状态很好');
  });

  it('不传 habitId 过滤时读到全部习惯的日志，按 limit 截', async () => {
    const host = makeHost();
    const a = await newHabit('甲');
    const b = await newHabit('乙');
    await host.submit({ action: 'record-checkin', habitId: a, date: '2024-03-01' });
    await host.submit({ action: 'record-checkin', habitId: b, date: '2024-03-01' });

    expect(await host.listHabitLogs(a, 10)).toHaveLength(1);
    expect(await host.listHabitLogs(undefined, 10)).toHaveLength(2);
    expect(await host.listHabitLogs(undefined, 1)).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('FOCUS_SESSION：写分钟、读毫秒，且换算只住在一处', () => {
  it('🔴 plannedMinutes 25 ⇒ payload.plannedMs 1_500_000，读回来还是毫秒', async () => {
    const host = makeHost();
    const result = await host.submit({ action: 'log-focus', kind: 'work', plannedMinutes: 25 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.entityType).toBe('FOCUS_SESSION');
    const ops = await opsOf('FOCUS_SESSION', result.taskId);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.payload).toMatchObject({ plannedMs: 1_500_000, kind: 'work' });

    const listed = await host.listFocusSessions(10);
    expect(listed[0]?.plannedMs).toBe(1_500_000);
  });

  it('actualMinutes 给了才进 payload（省略时不出现，也不按 planned 推算）', async () => {
    const host = makeHost();
    const withActual = await host.submit({
      action: 'log-focus',
      kind: 'work',
      plannedMinutes: 25,
      actualMinutes: 18,
    });
    expect(withActual.ok).toBe(true);
    if (!withActual.ok) return;
    expect((await opsOf('FOCUS_SESSION', withActual.taskId))[0]?.payload).toMatchObject({
      plannedMs: 1_500_000,
      actualMs: 1_080_000,
    });

    await host.submit({ action: 'log-focus', kind: 'shortBreak', plannedMinutes: 5 });
    const listed = await host.listFocusSessions(10);
    const breakRow = listed.find((x) => x.kind === 'shortBreak');
    expect(breakRow).toBeDefined();
    expect('actualMs' in (breakRow ?? {})).toBe(false);
  });

  it('🔴 不传 taskId ⇒ 读回来的对象里**没有 taskId 这个键**（不是 `null`）', async () => {
    const host = makeHost();
    const result = await host.submit({ action: 'log-focus', kind: 'work', plannedMinutes: 25 });
    if (!result.ok) throw new Error('前置专注没落下来');

    // `focus-actions` 写出的 payload 是 `taskId: session.taskId ?? null`，而 reducer 把
    // payload 里的 `null` 翻译成**删除键**（`packages/op-log/src/state.ts:279-285`）。
    // 所以这一条量的是**出境结果**：投影哪天改成 `session.taskId ?? null`，
    // 出境 JSON 里就会多出 `"taskId": null` —— 模型会把它读成"有一条任务，但没说清是哪条"。
    // （变异实测：那样写时这两句一起红。）
    const row = (await host.listFocusSessions(10))[0] ?? {};
    expect('taskId' in row).toBe(false);
    expect(JSON.stringify(row)).not.toContain('null');
  });

  it('挂在真任务上时 taskId 出去；completed 省略 = **false**（不是"没走完时按实际时长推算"）', async () => {
    const host = makeHost();
    const taskId = await newTask();
    const result = await host.submit({
      action: 'log-focus',
      kind: 'work',
      plannedMinutes: 45,
      taskId,
    });
    expect(result.ok).toBe(true);
    const row = (await host.listFocusSessions(10))[0];
    expect(row?.taskId).toBe(taskId);
    // `completed` 是实体上的必填布尔，所以它**总在**出境数据里；省略就是"没走完"。
    // 这条断言钉的是那个默认值没有被"看起来更聪明"地推成 true（工具描述对用户承诺的就是这个）。
    expect(row?.completed).toBe(false);

    const done = await host.submit({
      action: 'log-focus',
      kind: 'longBreak',
      plannedMinutes: 15,
      completed: true,
    });
    expect(done.ok).toBe(true);
  });

  it('🔴 专注类型不认识 ⇒ invalid 且不写 op（不静默降级成 work）', async () => {
    const host = makeHost();
    const before = alive('focusSessions');
    const result = await host.submit({ action: 'log-focus', kind: 'jogging', plannedMinutes: 25 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
      // 报错要说清"是这个取值不认识"。它退化成"内部错误"时模型会原样重试同一个 kind。
      expect(result.message).toContain('不认识');
    }
    expect(alive('focusSessions')).toBe(before);
  });

  it('🔴 计划时长不大于 0 ⇒ invalid 且不写（不记成一条长度为 0 的记录）', async () => {
    const host = makeHost();
    for (const plannedMinutes of [0, -25, Number.NaN]) {
      const before = alive('focusSessions');
      const result = await host.submit({ action: 'log-focus', kind: 'work', plannedMinutes });
      expect(result.ok, String(plannedMinutes)).toBe(false);
      if (!result.ok) expect(result.reason, String(plannedMinutes)).toBe('invalid');
      expect(alive('focusSessions'), `planned=${String(plannedMinutes)} 之后不该多一条`).toBe(before);
    }
  });

  it('宿主时钟给不出有效记录时刻 ⇒ 响亮地拒绝，不写一条坏记录', async () => {
    // `log-focus` 的 `createdAt` 由宿主填 `now()`；时钟坏成 0 时领域层会拒。
    // 这条用例存在的理由是那个 catch 分支**必须有腿**：否则"写成功了但记录是坏的"
    // 会变成界面上看不到、op-log 里躺着的一条 op。
    clock = 0;
    const before = alive('focusSessions');
    const result = await makeHost().submit({ action: 'log-focus', kind: 'work', plannedMinutes: 25 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
    expect(alive('focusSessions')).toBe(before);
    clock = 1_700_000_000_000;
  });

  it('listFocusSessions 的字段就是那份封闭白名单（startNote 之类不出去）', async () => {
    const host = makeHost();
    const created = await host.submit({ action: 'log-focus', kind: 'work', plannedMinutes: 25 });
    if (!created.ok) throw new Error('前置专注没落下来');
    await engine.dispatch({
      entityType: 'FOCUS_SESSION',
      entityId: created.taskId,
      opType: OpType.Update,
      payload: { startNote: '随手写的', interruptedAt: clock },
    });

    const row = (await host.listFocusSessions(10))[0] ?? {};
    expect(Object.keys(row).sort()).toEqual(['completed', 'kind', 'plannedMs']);
    expect(JSON.stringify(row)).not.toContain('随手写的');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('REMINDER：绝对时刻与"提前 N 分钟"两种形态', () => {
  it('🔴 date + time 落的是**本机**那一时刻（不是 UTC 同日同时刻）', async () => {
    const host = makeHost();
    const taskId = await newTask();
    const day = dayAfter(clock, 200);

    const result = await host.submit({
      action: 'create-reminder',
      taskId,
      date: day,
      time: '09:30',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 测试自己用 `new Date(y, m-1, d, h, min)`（本地时区的字面表达式）算期望，
    // 不复用 `localDateTimeToEpoch` —— 否则实现换成按 UTC 解析时这里照样绿。
    const parts = day.split('-').map(Number);
    const expected = new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1, 9, 30, 0, 0).getTime();
    expect(result.entityType).toBe('REMINDER');

    const listed = await host.listReminders(taskId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.triggerAt).toBe(expected);
    // 与领域换算一致（同一处所有者），并且和本地字面量相等 —— 两边都钉住时
    // 换 UTC 解析会同时打破这两句里的一句。
    expect(localDateTimeToEpoch(`${day}T09:30`)).toBe(expected);
    expect((await opsOf('REMINDER', listed[0]?.id ?? ''))[0]?.payload).toMatchObject({
      taskId,
      triggerAt: expected,
    });
  });

  it('🔴 minutesBeforeDue 落的是 **offsetMs**，不是算好的绝对时刻', async () => {
    const host = makeHost();
    const due = dayAfter(clock, 30);
    const created = await host.submit({ action: 'create-task', title: '交税', dueDate: due });
    if (!created.ok) throw new Error(`前置任务没带上截止日：${created.ok ? '' : created.message}`);

    const result = await host.submit({
      action: 'create-reminder',
      taskId: created.taskId,
      minutesBeforeDue: 30,
    });
    if (!result.ok) throw new Error(`提前 30 分的提醒该建得出来：${result.message}`);

    const ops = await opsOf('REMINDER', result.taskId);
    expect(ops).toHaveLength(1);
    // 🔴 这一句是这条用例的重心：自己算 `dueDate - 30min` 会落出一条**没有 offset** 的记录，
    // 界面与统计看不出问题，而重复任务每次顺延后提醒都留在**上一个周期**的时刻。
    expect(ops[0]?.payload).toMatchObject({ offsetMs: 30 * 60_000 });
    expect(ops[0]?.payload).toHaveProperty('triggerAt');
  });

  it('没有截止时间的任务给不了"提前多少分钟"，且报错说清缺的是哪一件事', async () => {
    const host = makeHost();
    const taskId = await newTask('没有截止日的任务');
    const before = alive('reminders');
    const result = await host.submit({ action: 'create-reminder', taskId, minutesBeforeDue: 30 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
      expect(result.message).toContain('截止时间');
    }
    expect(alive('reminders')).toBe(before);
  });

  it('🔴 两个锚点都不给 ⇒ 拒绝（宿主这条腿单独成立：MCP 调用方不经过助手）', async () => {
    const host = makeHost();
    const taskId = await newTask();
    const before = alive('reminders');
    // pack 的 `toIntent` 先挡一次；这里直接把只带 taskId 的意图交给宿主。
    const result = await host.submit({ action: 'create-reminder', taskId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('date');
    expect(alive('reminders')).toBe(before);
  });

  it('🔴 时刻已过 ⇒ 拒绝，且不写一条"永远不会响"的记录', async () => {
    const host = makeHost();
    const taskId = await newTask();
    const before = alive('reminders');
    const result = await host.submit({
      action: 'create-reminder',
      taskId,
      date: '2023-01-01',
      time: '09:00',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
      expect(result.message).toContain('已经过了');
    }
    expect(alive('reminders')).toBe(before);
  });

  it('提醒太远 ⇒ 拒绝（上限由领域层判，这一层只把天数念出来）', async () => {
    const host = makeHost();
    const taskId = await newTask();
    const before = alive('reminders');
    // 领域上限之外的一天：从常量推出来，不写死年份 —— 上限放宽时这条用例跟着走，
    // 收紧时它会先红（那正是该重新拍一次的时候）。
    // 领域上限之外**三天**：留余量是因为这条要跨时区成立 ——
    // "上限 + 一天"在 UTC-11 上会因为当天 09:00 比注入时钟少两个小时而落回上限之内。
    const farDay = today(clock + MAX_REMINDER_LEAD_MS + 3 * DAY_MS);
    const result = await host.submit({
      action: 'create-reminder',
      taskId,
      date: farDay,
      time: '09:00',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
      expect(result.message).toContain(String(Math.round(MAX_REMINDER_LEAD_MS / DAY_MS)));
    }
    expect(alive('reminders')).toBe(before);
  });

  it('日期或时间形状不成立 ⇒ invalid（宿主这条腿是第二道，不是唯一一道）', async () => {
    const host = makeHost();
    const taskId = await newTask();
    const result = await host.submit({
      action: 'create-reminder',
      taskId,
      date: '2024-02-30',
      time: '09:00',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('2024-02-30');
    expect(alive('reminders')).toBe(0);
  });

  it('🔴 每条任务的提醒有上限：填满后下一条拒绝，且**第 N+1 条没落库**', async () => {
    const host = makeHost();
    const taskId = await newTask();
    for (let i = 0; i < MAX_REMINDERS_PER_TASK; i += 1) {
      const result = await host.submit({
        action: 'create-reminder',
        taskId,
        date: dayAfter(clock, 10 + i),
        time: '09:00',
      });
      expect(result.ok, `第 ${String(i + 1)} 条应该建得出来`).toBe(true);
    }
    expect(alive('reminders')).toBe(MAX_REMINDERS_PER_TASK);

    const before = alive('reminders');
    const overflow = await host.submit({
      action: 'create-reminder',
      taskId,
      date: dayAfter(clock, 99),
      time: '09:00',
    });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.message).toContain(String(MAX_REMINDERS_PER_TASK));
    // 上限这条判据的意义在这一句：拒绝之后**计数没变**，而不是"写进去了但报错"。
    expect(alive('reminders')).toBe(before);
  });

  it('不同任务的提醒各自计数（上限是 per-task，不是全局）', async () => {
    const host = makeHost();
    const a = await newTask('甲');
    const b = await newTask('乙');
    for (let i = 0; i < MAX_REMINDERS_PER_TASK; i += 1) {
      await host.submit({ action: 'create-reminder', taskId: a, date: dayAfter(clock, 10 + i), time: '09:00' });
    }
    expect((await host.listReminders(a))?.length).toBe(MAX_REMINDERS_PER_TASK);
    const onB = await host.submit({ action: 'create-reminder', taskId: b, date: dayAfter(clock, 10), time: '09:00' });
    expect(onB.ok).toBe(true);
  });

  it('任务不存在 ⇒ not-found 且不写提醒', async () => {
    const before = alive('reminders');
    const result = await makeHost().submit({
      action: 'create-reminder',
      taskId: 'task-不存在',
      date: '2024-06-01',
      time: '09:00',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
    expect(alive('reminders')).toBe(before);
  });

  it('🔴 listReminders 按提醒时刻从早到晚（描述对用户承诺的就是这个）', async () => {
    const host = makeHost();
    const a = await newTask('甲');
    const b = await newTask('乙');
    // 故意先建"晚"的、再建"早"的：id 是 `任务:时刻` 拼的，按 id 排会读成按任务分组。
    await host.submit({ action: 'create-reminder', taskId: b, date: dayAfter(clock, 40), time: '09:00' });
    await host.submit({ action: 'create-reminder', taskId: a, date: dayAfter(clock, 10), time: '09:00' });

    const listed = await host.listReminders(undefined);
    expect(listed).toHaveLength(2);
    expect(listed[0]?.taskId).toBe(a);
    const times = listed.map((r) => r.triggerAt);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    // `phase` 由领域层算（这里钟点还没到），三个原始时间戳不许出现在出境数据里。
    expect(listed[0]?.phase).toBe('scheduled');
    const json = JSON.stringify(listed);
    expect(json).not.toContain('firedAt');
    expect(json).not.toContain('snoozedUntil');
    expect(json).not.toContain('dismissedAt');
  });

  it('已忽略的提醒不再出现在列表里（与其余读侧同一条墓碑规则）', async () => {
    const host = makeHost();
    const taskId = await newTask();
    const created = await host.submit({
      action: 'create-reminder',
      taskId,
      date: dayAfter(clock, 10),
      time: '09:00',
    });
    if (!created.ok) throw new Error('前置提醒没落下来');
    await engine.dispatch({
      entityType: 'REMINDER',
      entityId: created.taskId,
      opType: OpType.Delete,
      payload: {},
    });
    expect(await host.listReminders(taskId)).toEqual([]);
  });
});
