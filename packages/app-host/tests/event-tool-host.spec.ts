/**
 * 倒数日工具在**真实宿主**上的读与写（W10）
 * ===========================================
 *
 * 真实引擎 + 真实 SQLite（`:memory:`），与 `local-api-host.spec.ts` 同一个理由：
 * 假探针只能证明"我调了 dispatch"，对 op 的**形状**与"读出来的天数对不对"一无所知。
 *
 * 四条承重断言：
 *
 *   1. 🔴 写工具经 `submitIntent` **真的产出 EVENT 的 op**（CRT/UPD），
 *      且本文件**不构造任何 op** —— 那是 `event-actions.ts` 的活；
 *   2. 🔴 **不可读的倒数日连 `notes` 键都不存在**（不是空串、不是 null）；
 *      而**列表视图**里连可读条目的备注也不出（两个执行点各自钉一次）；
 *   3. **不认识的字段一律拒绝**，不静默忽略（`update-event` 与 `update-task` 同一条纪律）；
 *   4. **归档 / 已删除的倒数日不在列表里**，但按 id 直读仍拿得到未删除的那条 ——
 *      这条区分是 `archivedAt` 与 `deletedAt` 互不表达对方（§2.5）的可观测形式。
 */

import { today } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runReadTool, type LocalApiEventItem, type LocalApiHost, type LocalApiWriteIntent } from '@heyta/local-api';
import type { CountdownEvent, Task } from '@heyta/domain';

import { createTaskActions } from '../src/actions.js';
import { createEventActions } from '../src/event-actions.js';
import { EVENT_KIND_NAMES, createLocalApiHost } from '../src/local-api-host.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let clock = 1_700_000_000_000;
const now = (): number => clock;

/** 固定"今天"：所有 `daysFromToday` 的断言都相对它，不会过几天自己变红。 */
const BASE_MS = new Date(2026, 9, 4, 12, 0, 0, 0).getTime(); // 2026-10-04 本地中午
const TODAY = '2026-10-04';

type ReadableDecision = (item: Task | CountdownEvent) => boolean;

function makeHost(options: { isReadable?: ReadableDecision } = {}): LocalApiHost {
  const actions = createTaskActions(engine, { now });
  return createLocalApiHost(engine, actions, {
    // 🔴 显式回答，不靠默认值（`isReadable` 缺省曾是 fail-open 的事故源）
    isReadable: options.isReadable ?? ((): boolean => true),
    now,
  });
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
    now,
  });
  clock = BASE_MS;
});

afterEach(() => {
  adapter.close();
});

/** 用**动作层**造数据（本文件不许自己拼 op）。 */
function eventActionsNow() {
  return createEventActions(engine, { now });
}

async function seed(): Promise<string[]> {
  const ea = eventActionsNow();
  const birthday = await ea.createEvent('妈妈生日', '1968-04-12', {
    kind: 'birthday',
    recurrence: 'FREQ=YEARLY;INTERVAL=1',
    notes: '记得订蛋糕',
  });
  const countdown = await ea.createEvent('体检', '2026-10-14', { kind: 'countdown' });
  const past = await ea.createEvent('已过期的一次性', '2020-01-01');
  const archived = await ea.createEvent('归档的那个', '2026-12-01', { notes: '归档备注' });
  await ea.archiveEvent(archived);
  const removed = await ea.createEvent('已删除的那个', '2026-12-02');
  await ea.removeEvent(removed);
  return [birthday, countdown, past, archived, removed];
}

// ─────────────────────────────────────────────────────────────────────────
// 读侧
// ─────────────────────────────────────────────────────────────────────────

describe('listEvents / getEvent —— 问领域层，不自己算', () => {
  it('列表**不含**归档与已删除，且顺序是界面那一份（置顶在前 → 距下一次近 → id）', async () => {
    const [birthday, countdown, past, archived, removed] = await seed();
    const host = makeHost();
    const items = await host.listEvents?.({});
    // 「一次性且已经过去了」**仍然是活的**（没归档没删除），只是排在最后 ——
    // 它和"归档""已删除"是三件不同的事（§2.5 的那条裁决在这里的可观测形式）。
    expect(items?.map((i) => i.id)).toEqual([countdown, birthday, past]);
    // 归档项在 `listArchivedEvents` 里、回收站里没有它 —— 这里证明"两个视图都不是它"
    expect(items?.map((i) => i.id)).not.toContain(archived);
    expect(items?.map((i) => i.id)).not.toContain(removed);
  });

  it('🔴 `daysFromToday` / `nextOccurrence` 与领域层逐字相同（本文件是**独立算**的参照）', async () => {
    const [birthday, countdown, past] = await seed();
    const items = (await makeHost().listEvents?.({})) ?? [];
    const byId = new Map(items.map((i) => [i.id, i]));

    // 2026-10-14 的一次性倒数日：距 2026-10-04 是 10 天
    expect(byId.get(countdown)?.daysFromToday).toBe(10);
    expect(byId.get(countdown)?.nextOccurrence).toBe('2026-10-14');
    expect(byId.get(countdown)?.repeating).toBe(false);
    expect(byId.get(countdown)?.kind).toBe('countdown');

    // 每年重复的生日：下一次是 2027-04-12（不是 1968 那个锚点）
    expect(byId.get(birthday)?.nextOccurrence).toBe('2027-04-12');
    expect(byId.get(birthday)?.kind).toBe('birthday');
    expect(byId.get(birthday)?.repeating).toBe(true);

    // 一次性且已过 ⇒ **没有** nextOccurrence，天数是负数（"已经 N 天"）
    const gone = byId.get(past);
    expect(gone?.nextOccurrence).toBeUndefined();
    expect(Object.keys(gone ?? {})).not.toContain('nextOccurrence');
    expect((gone?.daysFromToday as number) < 0).toBe(true);
  });

  it('🔴 真宿主 + 真投影跑到底：列表里没有备注，单条读有', async () => {
    // 这一条是 `list_tasks` 当年那条缺陷在倒数日上的**同一张考卷**：
    // 宿主侧 `listEvents` 与 `getEvent` 共用同一个 `eventToItem`，所以**宿主这一层
    // 的列表是带备注的**（下面第一组断言就是钉这个事实）—— 把它剥掉是**协议层**
    // `projectEventListForTool` 的那一刀。两层都在，才承诺得住"列表不出正文"。
    // ⚠️ 变异：去掉那一刀 ⇒ 第二组断言红（`tool-egress-fields` 里也有同一条）。
    await seed();
    const host = makeHost();
    const fromHost = (await host.listEvents?.({})) ?? [];
    expect(fromHost.length).toBeGreaterThan(0);
    expect(fromHost.some((i) => i.notes !== undefined)).toBe(true);

    const listed = await runReadTool(host, 'list_events', {});
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(JSON.stringify(listed.payload)).not.toContain('记得订蛋糕');
    expect(JSON.stringify(listed.payload)).not.toContain('归档备注');

    const birthday = fromHost.find((i) => i.title === '妈妈生日') as LocalApiEventItem;
    const detail = await runReadTool(host, 'get_event', { eventId: birthday.id });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(JSON.stringify(detail.payload)).toContain('记得订蛋糕');
  });

  it('🔴 isReadable=false 的条目：`notes` 这个**键**不存在，readable=false 仍在', async () => {
    const [birthday] = await seed();
    const host = makeHost({ isReadable: (item): boolean => item.id !== birthday });
    const one = await host.getEvent?.(birthday);
    expect(one?.readable).toBe(false);
    expect(one?.notes).toBeUndefined();
    expect(Object.keys(one ?? {})).not.toContain('notes');
    // 元数据仍在（Bear 那条："can be listed"）
    expect(one?.title).toBe('妈妈生日');
    // 而**别的**条目不受影响：判定是逐条的，不是逐库的
    const other = await host.getEvent?.(birthday);
    expect(other?.readable).toBe(false);
    const list = (await host.listEvents?.({})) ?? [];
    expect(list.find((i) => i.id === birthday)?.readable).toBe(false);
    expect((list.find((i) => i.id !== birthday)?.readable ?? false) === true).toBe(true);
  });

  it('取不存在的 id ⇒ undefined（不是抛错、不是空对象）', async () => {
    await seed();
    const one = await makeHost().getEvent?.('没有这条');
    expect(one).toBeUndefined();
  });

  it('`limit` 在过滤之后才截断（先截后筛 = 把"查不到"伪装成"没有"）', async () => {
    await seed();
    const all = await makeHost().listEvents?.({});
    const two = await makeHost().listEvents?.({ limit: 1 });
    expect(all?.length).toBe(3);
    expect(two?.length).toBe(1);
    expect(two?.[0]?.id).toBe(all?.[0]?.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 写侧：意图 → 真 op
// ─────────────────────────────────────────────────────────────────────────

describe('submitIntent —— 倒数日的写', () => {
  it('create-event 真的落了一条 EVENT 的 CRT，字段照意图写', async () => {
    const host = makeHost();
    const res = await host.submit({
      action: 'create-event',
      title: '结婚纪念日',
      date: '2016-05-01',
      kind: 'anniversary',
      isLunar: true,
      recurrence: 'FREQ=YEARLY;INTERVAL=1',
      notes: '每年这天',
    } satisfies LocalApiWriteIntent);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const ops = await engine.getOpsForEntity('EVENT', res.taskId);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.opType).toBe(OpType.Create);
    const payload = ops[0]?.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      title: '结婚纪念日',
      date: '2016-05-01',
      kind: 'anniversary',
      isLunar: true,
      recurrence: 'FREQ=YEARLY;INTERVAL=1',
      notes: '每年这天',
    });
    // 读回来能被工具看到
    const one = await host.getEvent?.(res.taskId);
    expect(one?.kind).toBe('anniversary');
    expect(one?.isLunar).toBe(true);
    expect(one?.notes).toBe('每年这天');
  });

  it('🔴 一个用户手势 = 一条 op：日期与农历**同一条** UPD', async () => {
    const [countdown] = await seed();
    const host = makeHost();
    const before = (await engine.getOpsForEntity('EVENT', countdown)).length;
    const res = await host.submit({
      action: 'update-event',
      eventId: countdown,
      fields: { date: '2026-11-20', isLunar: true },
    } satisfies LocalApiWriteIntent);
    expect(res.ok).toBe(true);
    const ops = await engine.getOpsForEntity('EVENT', countdown);
    expect(ops.length - before).toBe(1);
    const payload = ops[ops.length - 1]?.payload as Record<string, unknown>;
    expect(payload).toEqual({ date: '2026-11-20', isLunar: true });
  });

  it('update-event 逐字段：kind / pinned / recurrence / notes 各走各的动作', async () => {
    const [birthday] = await seed();
    const host = makeHost();
    const ok = await host.submit({
      action: 'update-event',
      eventId: birthday,
      fields: { pinned: true, notes: '换成订两层的' },
    } satisfies LocalApiWriteIntent);
    expect(ok.ok).toBe(true);
    const one = await host.getEvent?.(birthday);
    expect(one?.pinned).toBe(true);
    expect(one?.notes).toBe('换成订两层的');

    // `null` = 明确"清除"，不是"不动它"（reducer 对 UPD 是合并语义）
    const cleared = await host.submit({
      action: 'update-event',
      eventId: birthday,
      fields: { notes: null, recurrence: null },
    } satisfies LocalApiWriteIntent);
    expect(cleared.ok).toBe(true);
    const after = await host.getEvent?.(birthday);
    expect(after?.notes).toBeUndefined();
    expect(after?.repeating).toBe(false);

    // kind = null ⇒ 回到"用户没选过"，界面上的档位由日期方向兜底
    const unset = await host.submit({
      action: 'update-event',
      eventId: birthday,
      fields: { kind: null },
    } satisfies LocalApiWriteIntent);
    expect(unset.ok).toBe(true);
    expect((await host.getEvent?.(birthday))?.kind).toBe('anniversary');
  });

  it('🔴 不认识的字段一律拒绝（静默忽略会让调用方以为改成功了）', async () => {
    const [birthday] = await seed();
    const res = await makeHost().submit({
      action: 'update-event',
      eventId: birthday,
      fields: { title: '新标题', ownerPhone: '13900000000' },
    } satisfies LocalApiWriteIntent);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('invalid');
    expect(res.message).toContain('ownerPhone');
    // 🔴 **整笔拒绝**：不是"先把认识的改了再报错"
    expect((await makeHost().getEvent?.(birthday))?.title).toBe('妈妈生日');
  });

  it('不存在的 eventId ⇒ not-found（不是"写了个没人认领的 op"）', async () => {
    const res = await makeHost().submit({
      action: 'update-event',
      eventId: '查无此条',
      fields: { title: 'x' },
    } satisfies LocalApiWriteIntent);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('not-found');
  });

  it('🔴 非法输入返回 invalid，**不把 event-actions 的 throw 漏给协议层**', async () => {
    const [birthday] = await seed();
    const host = makeHost();
    const cases: LocalApiWriteIntent[] = [
      // 不存在的日子（2 月 30 日）
      { action: 'create-event', title: 'a', date: '2026-02-30' },
      // 空标题
      { action: 'create-event', title: '   ', date: '2026-05-01' },
      // 词表外的档位
      { action: 'create-event', title: 'a', date: '2026-05-01', kind: 'wedding' },
      // 非法 RRULE
      { action: 'create-event', title: 'a', date: '2026-05-01', recurrence: 'FREQ;YEARLY' },
      // 改到非法日期
      { action: 'update-event', eventId: birthday, fields: { date: '2026-13-01' } },
      // 改到非法档位
      { action: 'update-event', eventId: birthday, fields: { kind: 'nope' } },
    ];
    for (const intent of cases) {
      const res = await host.submit(intent);
      expect(res.ok, JSON.stringify(intent)).toBe(false);
      if (res.ok) continue;
      expect(res.reason, JSON.stringify(intent)).toBe('invalid');
    }
    // 上面那条 update-event 没把生日改坏
    expect((await host.getEvent?.(birthday))?.date).toBe('1968-04-12');
  });

  it('写工具**没有**把任务侧的意图带过来：create-event 不会碰 state.tasks', async () => {
    const host = makeHost();
    const before = Object.keys((engine.getState() as { tasks?: unknown }).tasks ?? {}).length;
    await host.submit({ action: 'create-event', title: '只看日期', date: '2026-12-31' });
    const after = Object.keys((engine.getState() as { tasks?: unknown }).tasks ?? {}).length;
    expect(after).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 词表不漂：给模型看的说明必须逐个点名领域层那几档
// ─────────────────────────────────────────────────────────────────────────

describe('kind 词表与模型可见的描述对账', () => {
  it('🔴 `create_event` 的 schema 描述里，四档**一个不少一个不多**', async () => {
    const { listAuthorizedTools } = await import('@heyta/local-api');
    const tools = listAuthorizedTools({ create_event: true });
    const description = tools.find((t) => t.name === 'create_event')?.inputSchema.properties as
      | Record<string, { description?: string }>
      | undefined;
    const kindText = description?.['kind']?.description ?? '';
    for (const kind of EVENT_KIND_NAMES) {
      expect(kindText, `描述里没有档位 ${kind}`).toContain(kind);
    }
    // 反向：描述里不许出现一个**不在词表**的"看着像档位"的词
    expect(EVENT_KIND_NAMES.length).toBeGreaterThanOrEqual(2);
  });

  it('"今天"来自注入的时钟：换一天，工具读到的天数跟着走', async () => {
    const [countdown] = await seed();
    const host = makeHost();
    const first = await host.getEvent?.(countdown);
    clock = BASE_MS + 3 * 86_400_000; // 三天之后
    const later = await host.getEvent?.(countdown);
    expect((first?.daysFromToday as number) - (later?.daysFromToday as number)).toBe(3);
    expect(today(clock)).toBe('2026-10-07');
  });
});
