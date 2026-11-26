/**
 * 设置 ·「日历订阅」（ICS / webcal）管理卡片
 * ==========================================
 *
 * 列出本机已配的日历订阅，支持添加 / 启停 / 删除 / 手动同步。配置与同步的**判断**
 * 都在 `@heyta/app-host`（`connectors/*`）；本文件只做三件事：列表渲染、把用户动作
 * 转成一次保存/同步、把结果翻成一句话。连接配置是低频动作，收在「数据与同步」里，
 * 不放在日历侧栏常驻。
 */

import { CalendarPlus } from 'lucide-react';
import { ICON_SIZE } from '@heyta/design-system';
import { tasksToIcs } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { META_KEYS } from '@heyta/storage';
import {
  addCalendarSubscription,
  loadCalendarSubscriptions,
  refreshCalendarSubscription,
  removeCalendarSubscription,
  saveCalendarSubscriptions,
  updateCalendarSubscription,
  type CalendarSubscriptionRecord,
} from '@heyta/app-host';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '../../components/hta/index.js';
import { FormField } from '../../lib/form/FormField.js';
import { currentState, dispatchIntent, requireStore } from '../../lib/oplog.js';
import { useTaskStore } from '../tasks/store.js';
import { useSyncStore } from '../sync/store.js';
import { syncAge } from '../calendar/hub-connection.js';
import { downloadTextFile } from './export-download.js';

type SyncStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'syncing' }
  | { readonly kind: 'synced'; readonly added: number; readonly updated: number; readonly deleted: number }
  | { readonly kind: 'notModified' }
  | { readonly kind: 'network' }
  | { readonly kind: 'http' }
  | { readonly kind: 'shape' }
  | { readonly kind: 'failed' };

const EMPTY: SyncStatus = { kind: 'idle' };

function readLastSyncMap(raw: string | number | undefined): Record<string, number> {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const lastSyncMs = (entry as { lastSyncMs?: unknown }).lastSyncMs;
      if (typeof lastSyncMs === 'number' && Number.isFinite(lastSyncMs)) out[id] = lastSyncMs;
    }
    return out;
  } catch {
    return {};
  }
}

/** 同步端口：读状态 + 派发 + 一对 META 读写（与 hub-connection 同一形状）。 */
const syncPort = () => ({
  getState: currentState,
  dispatch: dispatchIntent,
  getMetaValue: (key: string) => requireStore().getMetaValue(key),
  setMetaValue: (key: string, value: string | number) => requireStore().setMetaValue(key, value),
});

export function CalendarSubscriptionsCard({ active = true }: { active?: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const sync = useSyncStore();
  const [ready, setReady] = useState(false);
  const [subs, setSubs] = useState<CalendarSubscriptionRecord[]>([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [statuses, setStatuses] = useState<Record<string, SyncStatus>>({});
  const [lastSync, setLastSync] = useState<Record<string, number>>({});
  const [formError, setFormError] = useState(false);
  const [feedUrl, setFeedUrl] = useState<string | undefined>(undefined);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedError, setFeedError] = useState(false);

  const refreshLastSync = async (): Promise<void> => {
    try {
      setLastSync(readLastSyncMap(await requireStore().getMetaValue(META_KEYS.CALENDAR_SUBSCRIPTION_STATE)));
    } catch {
      // 存储没就绪就维持现状。
    }
  };

  /** 列表变了就通知后台自动同步组件重读（`useCalendarSubscriptionsAutoSync`）。 */
  const notify = (): void => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('heyta:calendar-subscription-changed'));
  };

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    void loadCalendarSubscriptions(requireStore())
      .then((list) => {
        if (alive) {
          setSubs([...list]);
        }
        return refreshLastSync();
      })
      .catch(() => {
        // 读不出来按空列表处理；用户可以重新添加。
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const statusText = (value: SyncStatus): string => {
    switch (value.kind) {
      case 'syncing':
        return t('web.calendar.hub.status.syncing');
      case 'synced':
        return t('web.calendar.hub.status.synced', {
          added: value.added,
          updated: value.updated,
          deleted: value.deleted,
        });
      case 'notModified':
        return t('web.calendar.hub.status.notModified');
      case 'network':
        return t('web.calendar.hub.status.network');
      case 'http':
        return t('web.calendar.hub.status.http');
      case 'shape':
        return t('web.calendar.hub.status.shape');
      case 'failed':
        return t('web.calendar.hub.status.failed');
      default:
        return '';
    }
  };

  const lastSyncText = (id: string): string => {
    const ms = lastSync[id];
    if (ms === undefined) return t('web.calendar.hub.lastSyncNever');
    const age = syncAge(ms, Date.now());
    switch (age.kind) {
      case 'justNow':
        return t('web.calendar.hub.lastSyncWithAgo', { ago: t('web.calendar.hub.lastSyncJustNow') });
      case 'minutes':
        return t('web.calendar.hub.lastSyncWithAgo', {
          ago: t('web.calendar.hub.lastSyncAgoMinutes', { minutes: age.minutes }),
        });
      case 'hours':
        return t('web.calendar.hub.lastSyncWithAgo', {
          ago: t('web.calendar.hub.lastSyncAgoHours', { hours: age.hours }),
        });
      case 'days':
        return t('web.calendar.hub.lastSyncWithAgo', {
          ago: t('web.calendar.hub.lastSyncAgoDays', { days: age.days }),
        });
      default:
        return t('web.calendar.hub.lastSyncNever');
    }
  };

  const syncOne = async (record: CalendarSubscriptionRecord): Promise<void> => {
    if (busyId !== undefined) return;
    setBusyId(record.id);
    setStatuses((current) => ({ ...current, [record.id]: { kind: 'syncing' } }));
    try {
      const result = await refreshCalendarSubscription(
        { subscription: { id: record.id, name: record.name, url: record.url } },
        syncPort(),
      );
      const next: SyncStatus =
        result.kind === 'ok'
          ? { kind: 'synced', added: result.added, updated: result.updated, deleted: result.deleted }
          : result.kind === 'unconfigured'
            ? { kind: 'idle' }
            : { kind: result.cause === 'network' ? 'network' : result.cause === 'http-status' ? 'http' : 'shape' };
      setStatuses((current) => ({ ...current, [record.id]: next }));
      await refreshLastSync();
    } catch {
      setStatuses((current) => ({ ...current, [record.id]: { kind: 'failed' } }));
    } finally {
      setBusyId(undefined);
    }
  };

  const onAdd = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (adding) return;
    const trimmedUrl = url.trim();
    if (trimmedUrl === '') {
      setFormError(true);
      return;
    }
    setFormError(false);
    setAdding(true);
    void (async () => {
      try {
        const { list, record } = addCalendarSubscription(subs, { name, url: trimmedUrl });
        await saveCalendarSubscriptions(requireStore(), list);
        setSubs(list);
        notify();
        setUrl('');
        setName('');
        await syncOne(record);
      } catch {
        setFormError(true);
      } finally {
        setAdding(false);
      }
    })();
  };

  const onRemove = (id: string): void => {
    void (async () => {
      const next = removeCalendarSubscription(subs, id);
      await saveCalendarSubscriptions(requireStore(), next);
      setSubs(next);
      notify();
      setStatuses((current) => {
        const copy = { ...current };
        delete copy[id];
        return copy;
      });
    })();
  };

  const onToggle = (record: CalendarSubscriptionRecord): void => {
    void (async () => {
      const next = updateCalendarSubscription(subs, record.id, { enabled: !record.enabled });
      await saveCalendarSubscriptions(requireStore(), next);
      setSubs(next);
      notify();
    })();
  };

  /** 导出本机任务为 .ics（未完成 + 有日期），供导入到其它日历。 */
  const onExportIcs = (): void => {
    const tasks = Object.values(useTaskStore.getState().entities.tasks);
    downloadTextFile('heyta-calendar.ics', tasksToIcs(tasks, { now: Date.now() }), 'text/calendar');
  };

  /** 向服务端换取本账号的只读订阅 URL（token 保护），并尝试复制。 */
  const onGetFeedUrl = (): void => {
    if (feedBusy) return;
    const baseUrl = sync.baseUrl.trim().replace(/\/+$/u, '');
    const token = sync.token;
    if (baseUrl === '' || token === undefined || token === '') {
      setFeedError(true);
      return;
    }
    setFeedError(false);
    setFeedBusy(true);
    void (async () => {
      try {
        const response = await fetch(`${baseUrl}/api/calendar/feed-token`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          setFeedError(true);
          return;
        }
        const body: unknown = await response.json();
        const url = (body as { url?: unknown }).url;
        if (typeof url === 'string' && url !== '') {
          setFeedUrl(url);
          try {
            await globalThis.navigator?.clipboard?.writeText(url);
          } catch {
            // 剪贴板不可用不影响拿到 URL。
          }
        } else {
          setFeedError(true);
        }
      } catch {
        setFeedError(true);
      } finally {
        setFeedBusy(false);
      }
    })();
  };

  return (
    <section
      className="ht-settings__data-card"
      data-testid="calendar-subscriptions-settings"
      aria-label={t('web.calendar.sub.title')}
    >
      <header className="ht-settings__data-card-header">
        <div>
          <h3 className="ht-settings__data-card-title ht-type-headline">
            <CalendarPlus size={ICON_SIZE.sm} aria-hidden="true" />
            {t('web.calendar.sub.title')}
          </h3>
        </div>
      </header>
      <div className="ht-settings">
        <div className="ht-settings__actions">
          <Button tone="ghost" size="sm" data-testid="calendar-sub-export" onClick={onExportIcs}>
            {t('web.calendar.sub.exportIcs')}
          </Button>
          <Button
            tone="ghost"
            size="sm"
            loading={feedBusy}
            disabled={feedBusy}
            data-testid="calendar-sub-feed-url"
            onClick={onGetFeedUrl}
          >
            {t('web.calendar.sub.getFeed')}
          </Button>
        </div>
        {feedUrl !== undefined ? (
          <p className="ht-settings__data-status" data-settings-readout data-testid="calendar-sub-feed-value">
            {feedUrl}
          </p>
        ) : null}
        {feedError ? (
          <p className="ht-settings__data-status" role="status" data-testid="calendar-sub-feed-error">
            {t('web.calendar.sub.feedFailed')}
          </p>
        ) : null}
        <form onSubmit={onAdd} noValidate>
          <FormField id="calendar-sub-url" label={t('web.calendar.sub.url')} required>
            {(field) => (
              <input
                {...field}
                type="url"
                value={url}
                autoComplete="off"
                onChange={(changed) => {
                  setUrl(changed.target.value);
                }}
                data-testid="calendar-sub-url"
              />
            )}
          </FormField>
          <FormField id="calendar-sub-name" label={t('web.calendar.sub.name')}>
            {(field) => (
              <input
                {...field}
                type="text"
                value={name}
                autoComplete="off"
                onChange={(changed) => {
                  setName(changed.target.value);
                }}
                data-testid="calendar-sub-name"
              />
            )}
          </FormField>
          <div className="ht-settings__actions">
            <Button type="submit" tone="primary" size="sm" loading={adding} data-testid="calendar-sub-add">
              {t('web.calendar.sub.add')}
            </Button>
          </div>
          {formError ? (
            <p className="ht-settings__data-status" role="status">
              {t('web.calendar.sub.invalid')}
            </p>
          ) : null}
        </form>

        {ready && subs.length === 0 ? (
          <p className="ht-settings__data-status" data-settings-readout>
            {t('web.calendar.sub.empty')}
          </p>
        ) : (
          <div className="ht-settings__data-status">
            {subs.map((record) => {
              const status = statuses[record.id] ?? EMPTY;
              return (
                <div className="ht-settings__data-status-item" key={record.id} data-testid={`calendar-sub-${record.id}`}>
                  <span className="ht-settings__data-status-value">{record.name}</span>
                  <span className="ht-settings__data-status-label">{record.url}</span>
                  <div className="ht-settings__actions">
                    <Button
                      tone="ghost"
                      size="sm"
                      disabled={busyId !== undefined}
                      data-testid={`calendar-sub-sync-${record.id}`}
                      onClick={() => {
                        void syncOne(record);
                      }}
                    >
                      {t('web.calendar.sub.sync')}
                    </Button>
                    <Button
                      tone="ghost"
                      size="sm"
                      data-testid={`calendar-sub-toggle-${record.id}`}
                      onClick={() => {
                        onToggle(record);
                      }}
                    >
                      {record.enabled ? t('web.calendar.sub.disable') : t('web.calendar.sub.enable')}
                    </Button>
                    <Button
                      tone="ghost"
                      size="sm"
                      data-testid={`calendar-sub-remove-${record.id}`}
                      onClick={() => {
                        onRemove(record.id);
                      }}
                    >
                      {t('web.calendar.sub.remove')}
                    </Button>
                  </div>
                  <span className="ht-settings__data-status-label" data-settings-readout>
                    {lastSyncText(record.id)}
                  </span>
                  {status.kind === 'idle' ? null : (
                    <span className="ht-settings__data-status-label" role="status">
                      {statusText(status)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
