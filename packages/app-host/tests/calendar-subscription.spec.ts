/**
 * ICS 日历订阅同步管道判据
 * ========================
 * 未配置零请求 / 去抖（内容同→零 op）/ 坏数据不动缓存 / 删除只在本订阅窗口交集里 /
 * 不误删别的源（按 accountId 隔离）/ 全天日程派生 startDate。
 *
 * 夹具状态用真 reducer 累起来（`applyOperation`），不是手搓：`null` 清字段、墓碑复活
 * 这些语义只在 reducer 里成立。
 */

import { calendarEventId } from '@heyta/domain';
import { applyOperation, emptyState, type MaterializedState, type OpIntent } from '@heyta/op-log';
import { META_KEYS } from '@heyta/storage';
import { OpType, type Operation } from '@heyta/sync-core';
import { describe, expect, it } from 'vitest';

import { refreshCalendarSubscription, type CalendarSubscriptionSyncPort } from '../src/connectors/calendar-subscription.js';

const T0 = Date.UTC(2026, 10, 24); // 2026-11-24
const SUB = { id: 'sub-1', name: '团队日历', url: 'https://example.com/team.ics' };

function fakePort(initial: MaterializedState = emptyState()) {
  let state = initial;
  const intents: OpIntent[] = [];
  const meta = new Map<string, string | number>();
  let seq = 0;
  const port: CalendarSubscriptionSyncPort & { intents: OpIntent[]; meta: Map<string, string | number> } = {
    intents,
    meta,
    getState: () => state,
    dispatch: async (intent: OpIntent) => {
      intents.push(intent);
      seq += 1;
      state = applyOperation(state, {
        id: `op-${String(seq)}`,
        actionType: 'calendar-subscription',
        opType: intent.opType,
        entityType: intent.entityType,
        entityId: intent.entityId,
        payload: intent.payload,
        clientId: 'test-device',
        vectorClock: { test: seq },
        timestamp: T0 + seq,
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

interface RawEvent {
  readonly uid: string;
  readonly summary: string;
  readonly dstart: string;
  readonly dend: string;
}

function ics(events: readonly RawEvent[]): string {
  const body = events
    .map((e) =>
      ['BEGIN:VEVENT', `UID:${e.uid}`, `SUMMARY:${e.summary}`, `DTSTART:${e.dstart}`, `DTEND:${e.dend}`, 'END:VEVENT'].join(
        '\r\n',
      ),
    )
    .join('\r\n');
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
}

function serve(outcome: () => string | 'network' | 'http500') {
  const seen: string[] = [];
  const impl: typeof fetch = async (input) => {
    seen.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const value = outcome();
    if (value === 'network') throw new TypeError('fetch failed');
    if (value === 'http500') return new Response('boom', { status: 500 });
    return new Response(value, { status: 200, headers: { 'content-type': 'text/calendar' } });
  };
  return { impl, seen };
}

const options = (fetchImpl: typeof fetch, over: { url?: string; now?: number } = {}) => ({
  subscription: { ...SUB, url: over.url ?? SUB.url },
  now: () => over.now ?? T0,
  fetchImpl,
});

const evt = (uid: string, summary: string, start: string, end: string): RawEvent => ({
  uid,
  summary,
  dstart: start,
  dend: end,
});

describe('refreshCalendarSubscription', () => {
  it('未配置：url 为空 ⇒ 零请求、零 op', async () => {
    const port = fakePort();
    const { impl, seen } = serve(() => ics([evt('e1', 'A', '20261125T020000Z', '20261125T030000Z')]));
    const result = await refreshCalendarSubscription(options(impl, { url: '   ' }), port);
    expect(result.kind).toBe('unconfigured');
    expect(seen.length).toBe(0);
    expect(port.intents.length).toBe(0);
  });

  it('两行 → 2 CREATE；同一 feed 再来一轮 → 0 op（内容相同不写）', async () => {
    const port = fakePort();
    const { impl } = serve(() =>
      ics([
        evt('e1', '周会', '20261125T020000Z', '20261125T030000Z'),
        evt('e2', '评审', '20261126T060000Z', '20261126T070000Z'),
      ]),
    );
    const first = await refreshCalendarSubscription(options(impl), port);
    expect(first).toMatchObject({ kind: 'ok', added: 2, updated: 0, deleted: 0 });
    expect(port.intents.map((i) => i.opType)).toEqual([OpType.Create, OpType.Create]);

    const before = port.intents.length;
    const second = await refreshCalendarSubscription(options(impl), port);
    expect(second).toMatchObject({ kind: 'ok', added: 0, updated: 0, deleted: 0 });
    expect(port.intents.length).toBe(before);
  });

  it('非日历响应 ⇒ unavailable bad-shape、零 op', async () => {
    const port = fakePort();
    const { impl } = serve(() => '<html>oops</html>');
    const result = await refreshCalendarSubscription(options(impl), port);
    expect(result).toEqual({ kind: 'unavailable', cause: 'bad-shape' });
    expect(port.intents.length).toBe(0);
  });

  it('第二轮少了一条 ⇒ 只对这条写墓碑（删除对账）', async () => {
    const port = fakePort();
    let round = 0;
    const { impl } = serve(() => {
      round += 1;
      return round === 1
        ? ics([
            evt('e1', '周会', '20261125T020000Z', '20261125T030000Z'),
            evt('e2', '评审', '20261126T060000Z', '20261126T070000Z'),
          ])
        : ics([evt('e1', '周会', '20261125T020000Z', '20261125T030000Z')]);
    });
    await refreshCalendarSubscription(options(impl), port);
    const second = await refreshCalendarSubscription(options(impl), port);
    expect(second).toMatchObject({ kind: 'ok', deleted: 1 });
    const gone = port.getState().calendarEvents[calendarEventId('ics:sub-1', 'sub-1', 'e2')];
    expect(gone?.deletedAt).toBeDefined();
  });

  it('不误删别的源：accountId 不是本订阅的事件即便本轮缺席也保留', async () => {
    const port = fakePort();
    const hubId = calendarEventId('foundu', 'primary', 'hub-1');
    await port.dispatch({
      entityType: 'CALENDAR_EVENT' as never,
      entityId: hubId,
      opType: OpType.Create,
      payload: {
        id: hubId,
        accountId: 'foundu',
        calendarId: 'primary',
        sourceEventId: 'hub-1',
        summary: 'Hub 会',
        start: Date.UTC(2026, 10, 25, 2),
        end: Date.UTC(2026, 10, 25, 3),
      },
    });
    let round = 0;
    const { impl } = serve(() => {
      round += 1;
      return round === 1
        ? ics([
            evt('e1', '周会', '20261125T020000Z', '20261125T030000Z'),
            evt('e2', '评审', '20261126T060000Z', '20261126T070000Z'),
          ])
        : ics([evt('e1', '周会', '20261125T020000Z', '20261125T030000Z')]);
    });
    await refreshCalendarSubscription(options(impl), port);
    await refreshCalendarSubscription(options(impl), port);
    expect(port.getState().calendarEvents[hubId]?.deletedAt).toBeUndefined();
  });

  it('全天事件派生 startDate（事件时区口径）', async () => {
    const port = fakePort();
    const text = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ad-1\r\nSUMMARY:假期\r\nDTSTART;VALUE=DATE:20261125\r\nDTEND;VALUE=DATE:20261126\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    const { impl } = serve(() => text);
    await refreshCalendarSubscription(options(impl), port);
    const event = port.getState().calendarEvents[calendarEventId('ics:sub-1', 'sub-1', 'ad-1')];
    expect(event?.allDay).toBe(true);
    expect(event?.startDate).toBe('2026-11-25');
    expect(event?.endDateExclusive).toBe('2026-11-26');
  });

  it('状态按订阅落盘（CALENDAR_SUBSCRIPTION_STATE 有本条窗口）', async () => {
    const port = fakePort();
    const { impl } = serve(() => ics([evt('e1', '周会', '20261125T020000Z', '20261125T030000Z')]));
    await refreshCalendarSubscription(options(impl), port);
    const raw = port.meta.get(META_KEYS.CALENDAR_SUBSCRIPTION_STATE);
    expect(typeof raw).toBe('string');
    const map = JSON.parse(String(raw)) as Record<string, { fromMs: number; toMs: number }>;
    expect(map['sub-1']?.fromMs).toBe(T0 - 14 * 86_400_000);
    expect(map['sub-1']?.toMs).toBe(T0 + 60 * 86_400_000);
  });
});
