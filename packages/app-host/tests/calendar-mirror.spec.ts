/**
 * 外部日历镜像管道（宿主机半）
 * ===========================
 *
 * 六条判据，每条都对着一种"界面上看起来只是少了一条会议"的失败：
 *
 *   1. 未配置 ⇒ **零请求**（自托管没接 Hub 时不该产生流量）；
 *   2. 200 两行 ⇒ 两条 op；同一快照再来一轮 ⇒ **零 op**（这条通道唯一的去抖）；
 *   3. 一行坏键 ⇒ 只跳过那一行，其余照常入库；
 *   4. 304 / 网络失败 ⇒ op 零条、状态与 META 一个字节都不动；
 *   5. 窗口滑动 ⇒ 滑出去的**不判删**，交集里真消失的才写墓碑，母事件永不删；
 *   6. 源侧复活 ⇒ 一条 `{deletedAt: null}` 把它从回收站捞回来。
 *
 * 夹具状态用**真的 reducer**（`applyOperation`）累起来，不是手搓一个假状态：
 * "载荷里写 null 会清掉那格"这条语义只在 reducer 里成立，假状态会把它测成真的。
 */

import { OpType, type Operation } from '@heyta/sync-core';
import { applyOperation, emptyState, type MaterializedState, type OpIntent } from '@heyta/op-log';
import { META_KEYS } from '@heyta/storage';
import { calendarEventId } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import { refreshCalendarMirror, type CalendarMirrorPort } from '../src/calendar-mirror.js';

// ── 夹具 ────────────────────────────────────────────────────────────

/** Hub 的一行（字段按 Hub `docs/api.md` 响应样例）。 */
function hubRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const startMs = Date.UTC(2026, 10, 24, 2);
  const endMs = startMs + 3_600_000;
  return {
    id: 'foundu:evt-1',
    orgId: 'foundu',
    orgLabel: '找到你',
    eventId: 'evt-1',
    calendarId: 'primary',
    calendar: { id: 'primary', summary: '主日历', type: '', color: '', role: '' },
    summary: '周会',
    description: '',
    location: '',
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    startMs,
    endMs,
    allDay: false,
    timezone: 'Asia/Shanghai',
    status: 'confirmed',
    visibility: 'default',
    freeBusyStatus: 'busy',
    attendees: [],
    reminders: [],
    attachments: [],
    recurrence: '',
    recurringEventId: '',
    originalTime: 0,
    isException: false,
    ...over,
  };
}

const urlOf = (input: URL | RequestInfo): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

/** 一个把 op 真喂给 reducer 的端口 —— 于是"再跑一轮会不会再写 op"测的是真语义。 */
function fakePort(initial: MaterializedState = emptyState()) {
  let state = initial;
  const intents: OpIntent[] = [];
  const meta = new Map<string, string | number>();
  let seq = 0;

  const port: CalendarMirrorPort & { intents: OpIntent[]; meta: Map<string, string | number> } = {
    intents,
    meta,
    getState: () => state,
    dispatch: async (intent: OpIntent) => {
      intents.push(intent);
      seq += 1;
      state = applyOperation(state, {
        id: `op-${String(seq)}`,
        actionType: 'calendar-mirror',
        opType: intent.opType,
        entityType: intent.entityType,
        entityId: intent.entityId,
        payload: intent.payload,
        clientId: 'test-device',
        vectorClock: { test: seq },
        timestamp: 1_700_000_000_000 + seq,
        schemaVersion: 1,
      } as Operation<string>);
    },
    getMetaValue: async (key: string) => meta.get(key),
    setMetaValue: async (key: string, value: string | number) => {
      meta.set(key, value);
    },
  };
  return port;
}

/** 抓请求、回固定 body 的 fetch 桩（签名照实收 `RequestInfo`，不然 tsconfig.spec 会红）。 */
function fetchRows(rows: () => readonly Record<string, unknown>[] | 'network' | 'bad-json') {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const impl: typeof fetch = async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url: urlOf(input), headers });
    const outcome = rows();
    if (outcome === 'network') throw new TypeError('fetch failed');
    if (outcome === 'bad-json') return new Response('<html>', { status: 200 });
    return new Response(JSON.stringify({ from: '', to: '', expand: true, events: outcome, warnings: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: '"v1"' },
    });
  };
  return { impl, seen };
}

const T0 = Date.UTC(2026, 10, 24);
const options = (fetchImpl: typeof fetch, over: { now?: number; baseUrl?: string; token?: string } = {}) => ({
  baseUrl: over.baseUrl ?? 'http://127.0.0.1:8787',
  token: over.token ?? 'hub-token',
  now: () => over.now ?? T0,
  fetchImpl,
});

// ── 判据 ────────────────────────────────────────────────────────────

describe('拉取与去抖', () => {
  it('未配置：baseUrl 或 token 为空时**一个请求都不发**', async () => {
    for (const over of [{ baseUrl: '  ' }, { token: '  ' }]) {
      const port = fakePort();
      const { impl, seen } = fetchRows(() => [hubRow()]);
      const result = await refreshCalendarMirror(options(impl, over), port);
      expect(result.kind).toBe('unconfigured');
      expect(seen.length, `未配置却发了 ${String(seen.length)} 个请求`).toBe(0);
      expect(port.intents.length).toBe(0);
    }
  });

  it('200 两行 → 2 条 CREATE；同一快照再来一轮 → 0 条 op（内容相同不写）', async () => {
    const port = fakePort();
    const { impl, seen } = fetchRows(() => [hubRow(), hubRow({ eventId: 'evt-2', summary: '评审' })]);

    const first = await refreshCalendarMirror(options(impl), port);
    expect(first).toEqual({ kind: 'ok', added: 2, updated: 0, deleted: 0, skipped: 0 });
    expect(port.intents.map((intent) => intent.opType)).toEqual([OpType.Create, OpType.Create]);
    expect(Object.keys(port.getState().calendarEvents)).toHaveLength(2);
    // 请求形状：expand=true + 窗口两端；带 Bearer。
    expect(seen[0]!.url).toContain('/api/v1/events?expand=true&from=');
    expect(seen[0]!.url).toContain(`to=${String(T0 + 60 * 86_400_000)}`);
    expect(seen[0]!.headers['authorization']).toBe('Bearer hub-token');
    // 基线落 META（窗口 + ETag），下一轮才可能命中 304。
    expect(port.meta.has(META_KEYS.CALENDAR_MIRROR_WINDOW)).toBe(true);
    expect(port.meta.get(META_KEYS.CALENDAR_MIRROR_ETAG)).toBe('"v1"');

    const second = await refreshCalendarMirror(options(impl), port);
    expect(second).toEqual({ kind: 'ok', added: 0, updated: 0, deleted: 0, skipped: 0 });
    expect(port.intents.length, '同一快照第二轮又写了 op —— 去抖失效').toBe(2);
  });

  it('一行坏键 → 只跳过那一行（skipped=1），其余照常入库', async () => {
    const port = fakePort();
    const { impl } = fetchRows(() => [
      hubRow({ summary: '   ' }),
      hubRow({ eventId: 'evt-2', summary: '评审' }),
      hubRow({ eventId: 'evt-3', summary: '复盘' }),
    ]);

    const result = await refreshCalendarMirror(options(impl), port);
    expect(result).toEqual({ kind: 'ok', added: 2, updated: 0, deleted: 0, skipped: 1 });
    expect(Object.keys(port.getState().calendarEvents)).toHaveLength(2);
  });

  it('200 但 body 不是 `{events: [...]}` ⇒ bad-shape，且不吃掉已有数据', async () => {
    const port = fakePort();
    const seeded = await refreshCalendarMirror(options(fetchRows(() => [hubRow()]).impl), port);
    expect(seeded.kind).toBe('ok');
    const before = JSON.stringify(port.getState().calendarEvents);
    const metaBefore = JSON.stringify([...port.meta.entries()]);

    const result = await refreshCalendarMirror(options(fetchRows(() => 'bad-json').impl), port);
    expect(result).toEqual({ kind: 'unavailable', cause: 'bad-shape' });
    expect(JSON.stringify(port.getState().calendarEvents)).toBe(before);
    expect(JSON.stringify([...port.meta.entries()])).toBe(metaBefore);
    expect(port.intents.length).toBe(1);
  });

  it('304 与网络失败：op 零条、状态与 META 不动', async () => {
    const port = fakePort();
    await refreshCalendarMirror(options(fetchRows(() => [hubRow()]).impl), port);
    const stateBefore = JSON.stringify(port.getState().calendarEvents);
    const metaBefore = JSON.stringify([...port.meta.entries()]);

    // 条件请求命中：桩只看有没有带 if-none-match。
    const notModified: typeof fetch = async (_input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['if-none-match']).toBe('"v1"');
      return new Response(null, { status: 304 });
    };
    expect(await refreshCalendarMirror(options(notModified), port)).toEqual({ kind: 'not-modified' });

    const offline = await refreshCalendarMirror(options(fetchRows(() => 'network').impl), port);
    expect(offline).toEqual({ kind: 'unavailable', cause: 'network' });

    expect(JSON.stringify(port.getState().calendarEvents)).toBe(stateBefore);
    expect(JSON.stringify([...port.meta.entries()]), '失败时动了 META —— 下一轮的删除基线会被带偏').toBe(metaBefore);
    expect(port.intents.length).toBe(1);
  });
});

describe('窗口滑动与删除', () => {
  /** 第 1 轮：中心、左边缘外、母事件。第 2 轮：只剩中心（其余"消失"）。 */
  const day = 86_400_000;
  const center = hubRow({ eventId: 'center', startMs: T0 + day, endMs: T0 + day + 3_600_000 });
  const edgeOut = hubRow({
    eventId: 'edge',
    startMs: T0 - 14 * day + 3_600_000,
    endMs: T0 - 14 * day + 2 * 3_600_000,
  });
  const mother = hubRow({
    eventId: 'mother',
    summary: '每周站会',
    recurrence: 'FREQ=WEEKLY;BYDAY=MO',
    startMs: T0 + 2 * day,
    endMs: T0 + 2 * day + 1_800_000,
  });

  it('滑出去的与母事件都不判删；交集里真消失的才写墓碑', async () => {
    const port = fakePort();
    const first = await refreshCalendarMirror(
      options(fetchRows(() => [center, edgeOut, mother]).impl),
      port,
    );
    expect(first).toMatchObject({ kind: 'ok', added: 3 });

    // 滑一天：窗口 [T-14,T+60] → [T-13,T+61]，交集 [T-13,T+60]。
    const second = await refreshCalendarMirror(
      options(fetchRows(() => [center]).impl, { now: T0 + day }),
      port,
    );
    expect(second).toMatchObject({ kind: 'ok', added: 0, deleted: 0 });
    const afterSlide = port.getState().calendarEvents;
    expect(afterSlide[calendarEventId('foundu', 'primary', 'edge')]?.deletedAt, '滑出窗口的日程被误删').toBeUndefined();
    expect(afterSlide[calendarEventId('foundu', 'primary', 'mother')]?.deletedAt, '母事件被误删').toBeUndefined();

    // 第三轮：中心那条在交集里消失 ⇒ 才允许写墓碑。
    const third = await refreshCalendarMirror(
      options(fetchRows(() => []).impl, { now: T0 + day }),
      port,
    );
    expect(third).toMatchObject({ kind: 'ok', deleted: 1 });
    expect(port.getState().calendarEvents[calendarEventId('foundu', 'primary', 'center')]?.deletedAt).toBe(T0 + day);
  });

  it('源侧复活 ⇒ 一条 `{deletedAt: null}` 把它捞回来，且不重写内容', async () => {
    const port = fakePort();
    const row = hubRow({ eventId: 'revive' });
    await refreshCalendarMirror(options(fetchRows(() => [row]).impl), port);
    await refreshCalendarMirror(options(fetchRows(() => []).impl, { now: T0 + 1 }), port);
    const id = calendarEventId('foundu', 'primary', 'revive');
    expect(port.getState().calendarEvents[id]?.deletedAt).toBe(T0 + 1);

    const intentsBefore = port.intents.length;
    const revived = await refreshCalendarMirror(
      options(fetchRows(() => [row]).impl, { now: T0 + 2 }),
      port,
    );
    expect(revived).toMatchObject({ kind: 'ok', added: 0, updated: 1, deleted: 0 });
    expect(port.intents.length).toBe(intentsBefore + 1);
    expect(port.intents.at(-1)?.payload).toEqual({ deletedAt: null });
    const entity = port.getState().calendarEvents[id];
    expect(entity?.deletedAt).toBeUndefined();
    expect(entity?.summary).toBe('周会');
  });
});

describe('最近一次成功同步时间（lastSync）', () => {
  it('ok 写入 lastSync=本轮 now；下一轮 ok 把它推进到新的 now', async () => {
    const port = fakePort();
    const first = await refreshCalendarMirror(
      options(fetchRows(() => [hubRow()]).impl, { now: T0 }),
      port,
    );
    expect(first.kind).toBe('ok');
    expect(port.meta.get(META_KEYS.CALENDAR_MIRROR_LAST_SYNC)).toBe(T0);

    const second = await refreshCalendarMirror(
      options(fetchRows(() => [hubRow()]).impl, { now: T0 + 5_000 }),
      port,
    );
    expect(second.kind).toBe('ok');
    expect(port.meta.get(META_KEYS.CALENDAR_MIRROR_LAST_SYNC)).toBe(T0 + 5_000);
  });

  it('not-modified（304）也刷新 lastSync —— 它同样是"这一轮拉通了"', async () => {
    const port = fakePort();
    await refreshCalendarMirror(options(fetchRows(() => [hubRow()]).impl, { now: T0 }), port);
    // 抹掉，证明 304 自己会把它写回来（而不是靠上一轮残留）。
    port.meta.delete(META_KEYS.CALENDAR_MIRROR_LAST_SYNC);

    const notModified: typeof fetch = async () => new Response(null, { status: 304 });
    expect(await refreshCalendarMirror(options(notModified, { now: T0 }), port)).toEqual({
      kind: 'not-modified',
    });
    expect(port.meta.get(META_KEYS.CALENDAR_MIRROR_LAST_SYNC)).toBe(T0);
  });

  it('unavailable 死活不写：从没成功过就没有这个键；成功过就停在旧值', async () => {
    // 从没成功过：网络失败一轮，键仍缺席。
    const fresh = fakePort();
    const failedFresh = await refreshCalendarMirror(
      options(fetchRows(() => 'network').impl, { now: T0 }),
      fresh,
    );
    expect(failedFresh).toEqual({ kind: 'unavailable', cause: 'network' });
    expect(fresh.meta.has(META_KEYS.CALENDAR_MIRROR_LAST_SYNC)).toBe(false);

    // 成功过一轮后失败：停在上一轮的值，不被这一轮的 now 覆盖。
    const port = fakePort();
    await refreshCalendarMirror(options(fetchRows(() => [hubRow()]).impl, { now: T0 }), port);
    const before = port.meta.get(META_KEYS.CALENDAR_MIRROR_LAST_SYNC);
    const failed = await refreshCalendarMirror(
      options(fetchRows(() => 'bad-json').impl, { now: T0 + 9_000 }),
      port,
    );
    expect(failed).toEqual({ kind: 'unavailable', cause: 'bad-shape' });
    expect(port.meta.get(META_KEYS.CALENDAR_MIRROR_LAST_SYNC)).toBe(before);
  });
});
