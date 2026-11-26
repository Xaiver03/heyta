/**
 * ICS 日历订阅 → `CALENDAR_EVENT` 的只读镜像（连接器框架的第一个真实使用者）
 * ======================================================================
 *
 * 与 `calendar-mirror.ts`（Hub）共用同一套领域投影/去抖/删除判定，但数据来源换成
 * 标准 iCalendar（`.ics` / webcal），身份段用「订阅 id」而非 Hub 的 orgId。
 *
 * ## 三条硬约束（与 Hub 镜像同源）
 *
 * 1. **未配置零请求**：url 为空 ⇒ `unconfigured`，一个请求都不发。
 * 2. **失败不动缓存**：网络/非 200/解析不出 ⇒ 不 dispatch、不推进窗口与 lastSync。
 * 3. **删除只在本轮完整遍历后判**：且只对**本订阅自己的**事件判删（按 `accountId` 过滤），
 *    否则一次同步会把别的订阅/Hub 的事件一起误删。
 *
 * ## 身份
 *
 * `accountId = 'ics:' + subscription.id`、`calendarId = subscription.id`。于是同一个
 * `UID` 在不同订阅里是两条独立事件，不会互相覆盖。
 */

import {
  CALENDAR_EVENT_WINDOW_FUTURE_MS,
  CALENDAR_EVENT_WINDOW_PAST_MS,
  calendarEventFromHub,
  calendarEventPatch,
  calendarEventShouldDelete,
  calendarEventWindowIntersection,
  type CalendarEventWindow,
} from '@heyta/domain';
import type { MaterializedState, OpIntent } from '@heyta/op-log';
import type { EntityType } from '@heyta/shared-schema';
import { META_KEYS } from '@heyta/storage';
import { OpType } from '@heyta/sync-core';

import { fetchIcsText, parseIcs, type IcsEvent } from './ics.js';

const CALENDAR_EVENT_ENTITY = 'CALENDAR_EVENT' as EntityType;

export interface CalendarSubscription {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

export interface CalendarSubscriptionSyncPort {
  getState(): MaterializedState;
  dispatch(intent: OpIntent): Promise<unknown>;
  getMetaValue(key: string): Promise<string | number | undefined>;
  setMetaValue(key: string, value: string | number): Promise<void>;
}

export interface CalendarSubscriptionOptions {
  readonly subscription: CalendarSubscription;
  readonly now?: () => number;
  readonly windowPastMs?: number;
  readonly windowFutureMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly log?: (message: string) => void;
}

export type CalendarSubscriptionSyncResult =
  | {
      readonly kind: 'ok';
      readonly added: number;
      readonly updated: number;
      readonly deleted: number;
      readonly skipped: number;
    }
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'unavailable'; readonly cause: 'network' | 'http-status' | 'bad-shape' };

interface SubscriptionState {
  readonly fromMs: number;
  readonly toMs: number;
  readonly lastSyncMs: number;
}

type SubscriptionStateMap = Readonly<Record<string, SubscriptionState>>;

function readStateMap(raw: string | number | undefined): SubscriptionStateMap {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as SubscriptionStateMap;
  } catch {
    return {};
  }
}

/** 一条 ICS 事件 → Hub 行形状（复用 `calendarEventFromHub` 的窄映射，不另造一套）。 */
function rowOf(
  event: IcsEvent,
  accountId: string,
  calendarId: string,
  index: number,
): Record<string, unknown> {
  const eventId =
    event.uid !== undefined && event.uid !== ''
      ? event.uid
      : `${String(event.start)}:${event.summary}:${String(index)}`;
  return {
    orgId: accountId,
    calendarId,
    eventId,
    summary: event.summary,
    description: event.description ?? '',
    location: event.location ?? '',
    startMs: event.start,
    endMs: event.end,
    allDay: event.allDay,
    timezone: event.timezone ?? '',
    status: event.status ?? '',
    recurrence: event.rrule ?? '',
  };
}

/** 拉一轮订阅并落 op。 */
export async function refreshCalendarSubscription(
  options: CalendarSubscriptionOptions,
  port: CalendarSubscriptionSyncPort,
): Promise<CalendarSubscriptionSyncResult> {
  const url = options.subscription.url.trim();
  if (url === '') return { kind: 'unconfigured' };

  const nowMs = (options.now ?? Date.now)();
  const window: CalendarEventWindow = {
    fromMs: nowMs - (options.windowPastMs ?? CALENDAR_EVENT_WINDOW_PAST_MS),
    toMs: nowMs + (options.windowFutureMs ?? CALENDAR_EVENT_WINDOW_FUTURE_MS),
  };

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const fetched = await fetchIcsText(url, fetchImpl);
  if (!fetched.ok) {
    options.log?.(`calendar subscription ${options.subscription.id}: ${fetched.cause}`);
    return { kind: 'unavailable', cause: fetched.cause };
  }
  const parsed = parseIcs(fetched.text);
  if (!parsed.ok) {
    options.log?.(`calendar subscription ${options.subscription.id}: parse ${parsed.reason}`);
    return { kind: 'unavailable', cause: 'bad-shape' };
  }

  const accountId = `ics:${options.subscription.id}`;
  const calendarId = options.subscription.id;
  const stateMap = readStateMap(await port.getMetaValue(META_KEYS.CALENDAR_SUBSCRIPTION_STATE));
  const previous = stateMap[options.subscription.id];
  const previousWindow: CalendarEventWindow | undefined =
    previous === undefined ? undefined : { fromMs: previous.fromMs, toMs: previous.toMs };

  const current = port.getState().calendarEvents;

  const presentIds = new Set<string>();
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const [index, event] of parsed.events.entries()) {
    const projection = calendarEventFromHub(rowOf(event, accountId, calendarId, index));
    if (!projection.ok) {
      skipped += 1;
      if (projection.id !== undefined) presentIds.add(projection.id);
      options.log?.(`calendar subscription skipped: ${projection.code}`);
      continue;
    }
    const next = projection.event;
    // 只收与本轮窗口相交的事件；窗口外的不进 presentIds（与交集无交，不会被判删）。
    if (next.start === undefined || next.end === undefined) continue;
    if (!(next.start < window.toMs && next.end > window.fromMs)) continue;
    presentIds.add(next.id);

    const existing = current[next.id];
    if (existing === undefined) {
      await port.dispatch({
        entityType: CALENDAR_EVENT_ENTITY,
        entityId: next.id,
        opType: OpType.Create,
        payload: { ...next, sourceUpdatedAt: nowMs },
      });
      added += 1;
      continue;
    }

    const patch = calendarEventPatch(existing, next);
    const reviving = existing.deletedAt !== undefined;
    if (patch === undefined && !reviving) continue;
    await port.dispatch({
      entityType: CALENDAR_EVENT_ENTITY,
      entityId: next.id,
      opType: OpType.Update,
      payload:
        patch === undefined
          ? { deletedAt: null }
          : reviving
            ? { ...patch, deletedAt: null, sourceUpdatedAt: nowMs }
            : { ...patch, sourceUpdatedAt: nowMs },
    });
    updated += 1;
  }

  // 约束 3：删除只在两轮窗口交集里判，且只针对本订阅自己的事件（accountId 过滤）。
  const intersection = calendarEventWindowIntersection(previousWindow, window);
  let deleted = 0;
  if (intersection !== undefined) {
    for (const event of Object.values(current)) {
      if (event.accountId !== accountId) continue;
      if (!calendarEventShouldDelete(event, { presentIds, window: intersection })) continue;
      await port.dispatch({
        entityType: CALENDAR_EVENT_ENTITY,
        entityId: event.id,
        opType: OpType.Update,
        payload: { deletedAt: nowMs },
      });
      deleted += 1;
    }
  }

  // 全部 dispatch 成功后才推进基线（中途抛错则窗口停在上一轮，下一轮幂等重覆盖）。
  const nextMap: Record<string, SubscriptionState> = {
    ...stateMap,
    [options.subscription.id]: { fromMs: window.fromMs, toMs: window.toMs, lastSyncMs: nowMs },
  };
  await port.setMetaValue(META_KEYS.CALENDAR_SUBSCRIPTION_STATE, JSON.stringify(nextMap));

  return { kind: 'ok', added, updated, deleted, skipped };
}
