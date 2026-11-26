/**
 * 日历订阅的**后台自动同步**（挂到日历视图）
 * ========================================
 *
 * 与 `useHubConnection` 的自动同步同一套节流语义（`shouldAutoSync`，最小间隔 5 分钟），
 * 只是数据源换成"本机的订阅列表"：挂载 / 回前台·聚焦 / 定时 / 列表变更 时，对**已启用且到期**
 * 的订阅逐条 `refreshCalendarSubscription`。失败不推进游标（下次再试），与 Hub 镜像同源。
 *
 * 选择"哪些该同步"是纯函数 `dueSubscriptions`（有单测）；本文件只负责把浏览器时机接到它上面。
 */

import { CALENDAR_AUTO_SYNC_MIN_INTERVAL_MS, loadCalendarSubscriptions, refreshCalendarSubscription, shouldAutoSync, type CalendarSubscriptionRecord } from '@heyta/app-host';
import { META_KEYS } from '@heyta/storage';
import { useEffect } from 'react';

import { currentState, dispatchIntent, requireStore } from '../../lib/oplog.js';

export interface DueSubscriptionsInput {
  readonly subscriptions: readonly CalendarSubscriptionRecord[];
  readonly lastSyncById: Readonly<Record<string, number | undefined>>;
  readonly nowMs: number;
  readonly minIntervalMs?: number;
}

/** 纯函数：哪些订阅这一时刻该自动同步。 */
export function dueSubscriptions(input: DueSubscriptionsInput): CalendarSubscriptionRecord[] {
  return input.subscriptions.filter((subscription) => {
    if (!subscription.enabled) return false;
    return shouldAutoSync({
      lastSyncMs: input.lastSyncById[subscription.id],
      nowMs: input.nowMs,
      ...(input.minIntervalMs === undefined ? {} : { minIntervalMs: input.minIntervalMs }),
    });
  });
}

function readLastSyncMap(raw: string | number | undefined): Record<string, number | undefined> {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number | undefined> = {};
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const lastSyncMs = (entry as { lastSyncMs?: unknown }).lastSyncMs;
      out[id] = typeof lastSyncMs === 'number' && Number.isFinite(lastSyncMs) ? lastSyncMs : undefined;
    }
    return out;
  } catch {
    return {};
  }
}

const syncPort = () => ({
  getState: currentState,
  dispatch: dispatchIntent,
  getMetaValue: (key: string) => requireStore().getMetaValue(key),
  setMetaValue: (key: string, value: string | number) => requireStore().setMetaValue(key, value),
});

/**
 * 无 UI 的副作用组件：挂载即生效，返回 null。
 */
export function CalendarSubscriptionsAutoSync(): null {
  useEffect(() => {
    let disposed = false;

    const runAll = async (): Promise<void> => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const store = requireStore();
      const subscriptions = await loadCalendarSubscriptions(store);
      if (disposed) return;
      const lastSyncById = readLastSyncMap(await store.getMetaValue(META_KEYS.CALENDAR_SUBSCRIPTION_STATE));
      const due = dueSubscriptions({ subscriptions, lastSyncById, nowMs: Date.now() });
      for (const subscription of due) {
        if (disposed) break;
        try {
          await refreshCalendarSubscription(
            { subscription: { id: subscription.id, name: subscription.name, url: subscription.url } },
            syncPort(),
          );
        } catch {
          // 单个订阅失败不影响其它订阅；游标未推进，下次再试。
        }
      }
    };

    void runAll();

    const onVisible = (): void => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void runAll();
    };
    const onFocus = (): void => void runAll();
    const onChanged = (): void => void runAll();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('heyta:calendar-subscription-changed', onChanged);
    const timer = setInterval(onVisible, CALENDAR_AUTO_SYNC_MIN_INTERVAL_MS);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('heyta:calendar-subscription-changed', onChanged);
      clearInterval(timer);
    };
  }, []);

  return null;
}
