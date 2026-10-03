/**
 * 倒数日动作层的测试（W2 的写路径）
 * =================================
 *
 * 与 `note-actions.spec.ts` / `reminder-actions.spec.ts` 同一取舍：
 * **真实引擎 + 真实 SQLite（`:memory:`）**，零 mock。
 *
 * 盯的是五类**静默失效**（都是"op 写得出来、界面上却不对"的形状）：
 *   1. 一个手势拆成两条 op → 两端各看到一半新状态（农历生日被算成公历生日）；
 *   2. 清除实现成"不放这个键" → 用户点了"无"，图标还留着；
 *   3. 归档实现成软删除 → 归档项出现在回收站，且离线端会把它同步回来；
 *   4. 非法 RRULE / 非法日期被接受 → 构建绿、运行时才炸，或静默变成另一条规则；
 *   5. 🔴 **节假日数据混进 payload**（§2.2）：那是把公共事实抄进用户加密数据，
 *      既污染 E2EE 边界又让每条倒数日 op 背上一年 365 格。
 *      第 5 类由 `EVENT_PAYLOAD_KEYS` 白名单挡，并且**当场喂一条塞了
 *      `days[]` 的载荷做阳性对照** —— 不能失败的白名单等于没有白名单。
 */

import type { CountdownEvent } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventActions, type EventActions } from '../src/event-actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: EventActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;

let seq = 0;
const makeEventId = (): string => {
  seq += 1;
  return `event-t-${String(seq).padStart(3, '0')}`;
};

const state = (): { events: Record<string, CountdownEvent> } =>
  engine.getState() as unknown as { events: Record<string, CountdownEvent> };

const opsOf = async (entityId: string) => engine.getOpsForEntity('EVENT', entityId);
const opCount = async (entityId: string): Promise<number> => (await opsOf(entityId)).length;
const lastPayload = async (entityId: string): Promise<Record<string, unknown>> => {
  const ops = await opsOf(entityId);
  const last = ops.at(-1);
  if (last === undefined) throw new Error(`没找到 ${entityId} 的 op`);
  return last.payload as Record<string, unknown>;
};

/**
 * 🔴 EVENT 的 op payload **只允许这些键**（§2.2 的落地形态）。
 *
 * 为什么用白名单而不是黑名单：黑名单要预先想到所有不该出现的东西，
 * 而"节假日数据"只是其中一种；白名单只需要回答"这个实体的字段有哪些"，
 * 那个问题在 `CountdownEvent` 上已经有唯一答案了。
 */
const EVENT_PAYLOAD_KEYS = new Set([
  'title',
  'date',
  'kind',
  'isLunar',
  'leapMonthPolicy',
  'recurrence',
  'pinnedAt',
  'archivedAt',
  'icon',
  'color',
  'notes',
]);

function assertPayloadAllowed(payload: Record<string, unknown>): void {
  const extra = Object.keys(payload).filter((k) => !EVENT_PAYLOAD_KEYS.has(k));
  if (extra.length > 0) {
    throw new Error(`EVENT payload 里出现了不该有的键：${extra.join(', ')}`);
  }
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore(adapter),
    clientId: 'client-event',
    now,
  });
  clock = 1_700_000_000_000;
  seq = 0;
  actions = createEventActions(engine, { newEventId: makeEventId, now });
});

afterEach(() => {
  adapter.close();
});

describe('新建', () => {
  it('一条 EVENT Create op，字段落进物化状态', async () => {
    const id = await actions.createEvent('结婚纪念日', '2020-05-01', {
      kind: 'anniversary',
      recurrence: 'FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=1',
    });
    const ops = await opsOf(id);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.entityType).toBe('EVENT');
    expect(ops[0]?.opType).toBe(OpType.Create);
    expect(await lastPayload(id)).toMatchObject({
      title: '结婚纪念日',
      date: '2020-05-01',
      kind: 'anniversary',
      isLunar: false,
      recurrence: 'FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=1',
    });
    expect(state().events[id]?.title).toBe('结婚纪念日');
  });

  it('每条 EVENT op 的 payload 都过白名单（§2.2）', async () => {
    const id = await actions.createEvent('生日', '1990-02-17', {
      kind: 'birthday',
      isLunar: true,
      leapMonthPolicy: 'both',
      icon: 'cake',
      color: 3,
      notes: '农历正月十七',
    });
    await actions.setEventPinned(id, true);
    for (const op of await opsOf(id)) assertPayloadAllowed(op.payload as Record<string, unknown>);
  });

  it('阳性对照：把一年的节假日表塞进 payload，白名单必须挡下来', () => {
    const holidayShaped = {
      title: '春节',
      date: '2026-02-17',
      // 这就是 §2.2 明令不许进 op-log 的那种东西
      days: [{ date: '2026-02-16', isOffDay: true }],
    };
    expect(() => assertPayloadAllowed(holidayShaped)).toThrow(/不该有的键：days/);
  });

  it.each([
    ['', '2026-05-01', /标题不能为空/],
    ['   ', '2026-05-01', /标题不能为空/],
    ['ok', '2026-02-30', /不是有效的 YYYY-MM-DD/],
  ])('非法输入 %j/%j 被拒绝，且不留下任何 op', async (title, date, message) => {
    await expect(actions.createEvent(title, date)).rejects.toThrow(message);
    expect(Object.keys(state().events)).toHaveLength(0);
  });

  it('非法 RRULE 在写入侧就拒绝（拼错一个分号不会报错，只会变成另一条规则）', async () => {
    await expect(actions.createEvent('x', '2026-05-01', { recurrence: 'FREQ=YEARLY' })).resolves.toBeTypeOf(
      'string',
    );
    const id = await actions.createEvent('y', '2026-05-01');
    const before = await opCount(id);
    await expect(actions.setEventRecurrence(id, 'FREQ=NONSENSE;BYMONTH=5')).rejects.toThrow(
      /不是合法 RRULE/,
    );
    expect(await opCount(id)).toBe(before);
  });
});

describe('一个手势 = 一条 op', () => {
  it('「编辑日期」把 date 与 isLunar 写进同一条 UPD', async () => {
    const id = await actions.createEvent('农历生日', '1990-02-17');
    const before = await opCount(id);
    await actions.setEventDate(id, '1990-03-03', true);
    expect(await opCount(id)).toBe(before + 1);
    expect(await lastPayload(id)).toEqual({ date: '1990-03-03', isLunar: true });
  });

  it('省略 isLunar 的改名手势不会顺手把历法改掉', async () => {
    const id = await actions.createEvent('a', '1990-02-17', { isLunar: true });
    await actions.renameEvent(id, 'b');
    expect(await lastPayload(id)).toEqual({ title: 'b' });
    expect(state().events[id]?.isLunar).toBe(true);
  });

  it('样式面板的一次保存只产出一条 op', async () => {
    const id = await actions.createEvent('x', '2026-05-01');
    const before = await opCount(id);
    await actions.setEventStyle(id, { icon: 'plane', color: 5 });
    expect(await opCount(id)).toBe(before + 1);
    expect(await lastPayload(id)).toEqual({ icon: 'plane', color: 5 });
  });
});

describe('清除写 null（不是"不放这个键"）', () => {
  it('取消置顶后物化状态里真的没有 pinnedAt 了', async () => {
    const id = await actions.createEvent('x', '2026-05-01', { pinned: true });
    expect(state().events[id]?.pinnedAt).toBe(clock);
    clock += 1000;
    await actions.setEventPinned(id, false);
    expect(await lastPayload(id)).toEqual({ pinnedAt: null });
    expect(state().events[id]?.pinnedAt).toBeUndefined();
  });

  it('去掉图标 / 清空备注 / 改成一次性，都是显式 null', async () => {
    const id = await actions.createEvent('x', '2026-05-01', {
      icon: 'cake',
      notes: '备注',
      recurrence: 'FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=1',
    });
    clock += 1000;
    await actions.setEventStyle(id, { icon: null });
    await actions.setEventNotes(id, null);
    await actions.setEventRecurrence(id, null);
    const e = state().events[id] as CountdownEvent;
    expect(e.icon).toBeUndefined();
    expect(e.notes).toBeUndefined();
    expect(e.recurrence).toBeUndefined();
  });
});

describe('归档 ≠ 删除（§2.5）', () => {
  it('归档只写 archivedAt，绝不碰 deletedAt', async () => {
    const id = await actions.createEvent('x', '2026-05-01');
    clock += 1000;
    await actions.archiveEvent(id);
    const e = state().events[id] as CountdownEvent;
    expect(e.archivedAt).toBe(clock);
    expect(e.deletedAt).toBeUndefined();
    expect(actions.listEvents('2026-10-03').map((x) => x.id)).not.toContain(id);
    expect(actions.listArchivedEvents('2026-10-03').map((x) => x.id)).toContain(id);
  });

  it('取消归档只清 archivedAt；未归档时返回 false 且不产生空 op', async () => {
    const id = await actions.createEvent('x', '2026-05-01');
    expect(await actions.unarchiveEvent(id)).toBe(false);
    expect(await opCount(id)).toBe(1);
    clock += 1000;
    await actions.archiveEvent(id);
    clock += 1000;
    expect(await actions.unarchiveEvent(id)).toBe(true);
    expect(state().events[id]?.archivedAt).toBeUndefined();
    expect(actions.listEvents('2026-10-03').map((x) => x.id)).toContain(id);
  });

  it('归档后再删除，两个标记同时存在；还原只清墓碑', async () => {
    const id = await actions.createEvent('x', '2026-05-01');
    await actions.archiveEvent(id);
    clock += 1000;
    await actions.removeEvent(id);
    const trashed = state().events[id] as CountdownEvent;
    expect(trashed.deletedAt).toBeDefined();
    expect(trashed.archivedAt).toBeDefined();
    expect(actions.listArchivedEvents('2026-10-03')).toHaveLength(0);
    expect(await actions.restoreEvent(id)).toBe(true);
    expect(state().events[id]?.deletedAt).toBeUndefined();
    // 还原回的是**归档视图**，不是主列表 —— 归档态没被"顺手"清掉
    expect(actions.listEvents('2026-10-03')).toHaveLength(0);
    expect(actions.listArchivedEvents('2026-10-03')).toHaveLength(1);
  });
});

describe('删除与撤销', () => {
  it('删除发 DEL，撤销发 UPD deletedAt:null，且不在回收站时不产生空 op', async () => {
    const id = await actions.createEvent('x', '2026-05-01');
    expect(await actions.restoreEvent(id)).toBe(false);
    expect(await opCount(id)).toBe(1);
    await actions.removeEvent(id);
    const ops = await opsOf(id);
    expect(ops.at(-1)?.opType).toBe(OpType.Delete);
    expect(state().events[id]?.deletedAt).toBeDefined();
    expect(await actions.restoreEvent(id)).toBe(true);
    expect(state().events[id]?.deletedAt).toBeUndefined();
  });

  it('对不存在的 id 动手会响亮报错，不静默写一条孤儿 op', async () => {
    await expect(actions.renameEvent('event-nope', 'x')).rejects.toThrow(/找不到倒数日/);
    await expect(actions.archiveEvent('event-nope')).rejects.toThrow(/找不到倒数日/);
    expect(Object.keys(state().events)).toHaveLength(0);
  });
});
