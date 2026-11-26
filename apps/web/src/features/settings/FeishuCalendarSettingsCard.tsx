/**
 * 设置 ·「飞书日程」连接（低频集成）
 * ================================
 *
 * 这里只管三件事：**凭据**（Hub 地址 + 访问令牌，读写 `hub-connection` 的
 * META）、**保存并同步**、以及「最近一次成功同步」的读数。判断一行都不在这里
 * （未配置零请求、失败不动缓存……全在 `@heyta/app-host` 的 `calendar-mirror.ts`）。
 *
 * ## 为什么收在设置里，而不是日历侧栏
 *
 * 它需要两个参数（地址 + 令牌）、且**不是高频动作** —— 按 `docs/agents/entry-layers.md`
 * 「需要参数的动作从全局/视图层消失」「频次决定进不进更多」：这类连接的配置属于
 * **设置**，与「数据与同步」里其它"连到哪"的凭据同层。日历侧栏只在**连上之后**
 * 显示只读议程（见 `features/calendar/CalendarHubPanel.tsx`），未连接时那块整个不渲染。
 *
 * ## 保存后为什么要广播一个事件
 *
 * 设置是浮层，打开时日历侧栏仍挂在下面（`useHubConnection` 只在挂载时读一次凭据）。
 * 保存成功后广播 `heyta:calendar-hub-changed`，侧栏据此重读凭据，收起设置就能看到议程，
 * 不必刷新页面。
 */

import { CalendarClock } from 'lucide-react';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { META_KEYS } from '@heyta/storage';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '../../components/hta/index.js';
import { FormField } from '../../lib/form/FormField.js';
import { requireStore } from '../../lib/oplog.js';
import {
  loadHubConnection,
  parseLastSyncMs,
  runCalendarMirror,
  saveHubConnection,
  syncAge,
} from '../calendar/hub-connection.js';

type PanelStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'syncing' }
  | { readonly kind: 'synced'; readonly added: number; readonly updated: number; readonly deleted: number }
  | { readonly kind: 'notModified' }
  | { readonly kind: 'network' }
  | { readonly kind: 'http' }
  | { readonly kind: 'shape' }
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'failed' };

/** 广播给日历侧栏：凭据变了，重读一次。纯浏览器事件，不跨端。 */
function notifyHubChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('heyta:calendar-hub-changed'));
}

async function readLastSync(): Promise<number | undefined> {
  try {
    return parseLastSyncMs(await requireStore().getMetaValue(META_KEYS.CALENDAR_MIRROR_LAST_SYNC));
  } catch {
    return undefined;
  }
}

export function FeishuCalendarSettingsCard({
  active = true,
}: {
  active?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const [configured, setConfigured] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [lastSyncMs, setLastSyncMs] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<PanelStatus>({ kind: 'idle' });

  // 进入这一节时按当前配置播种。token 从不回填 —— 它只是"要换的时候重输一遍"。
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    void Promise.all([loadHubConnection(), readLastSync()])
      .then(([connection, storedLastSync]) => {
        if (!alive) return;
        setBaseUrl(connection.baseUrl);
        setConfigured(connection.baseUrl !== '' && connection.token !== '');
        setLastSyncMs(storedLastSync);
      })
      .catch(() => {
        // 引擎没就绪 / 读不出来：保持"未配置"，用户可以直接填。
      });
    return () => {
      alive = false;
    };
  }, [active]);

  const statusText = (value: PanelStatus): string => {
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
      case 'unconfigured':
        return t('web.calendar.hub.status.unconfigured');
      case 'failed':
        return t('web.calendar.hub.status.failed');
      default:
        return '';
    }
  };

  const lastSyncText = (): string => {
    const age = syncAge(lastSyncMs, Date.now());
    switch (age.kind) {
      case 'never':
        return t('web.calendar.hub.lastSyncNever');
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
    }
  };

  const applyResult = (result: Awaited<ReturnType<typeof runCalendarMirror>>): void => {
    switch (result.kind) {
      case 'ok':
        setStatus({
          kind: 'synced',
          added: result.added,
          updated: result.updated,
          deleted: result.deleted,
        });
        return;
      case 'not-modified':
        setStatus({ kind: 'notModified' });
        return;
      case 'unconfigured':
        setStatus({ kind: 'unconfigured' });
        return;
      case 'unavailable':
        setStatus({
          kind: result.cause === 'network' ? 'network' : result.cause === 'http-status' ? 'http' : 'shape',
        });
        return;
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busy) return;
    const nextBaseUrl = baseUrl.trim();
    const nextToken = token.trim();
    if (nextBaseUrl === '' || nextToken === '') {
      setStatus({ kind: 'unconfigured' });
      return;
    }
    void (async () => {
      setBusy(true);
      setStatus({ kind: 'syncing' });
      try {
        await saveHubConnection(nextBaseUrl, nextToken);
        // 保存成功才丢掉内存里的 token：表单不再需要它。
        setToken('');
        setConfigured(true);
        notifyHubChanged();
        applyResult(await runCalendarMirror());
      } catch {
        setStatus({ kind: 'failed' });
      } finally {
        setBusy(false);
        setLastSyncMs(await readLastSync());
      }
    })();
  };

  const onSync = (): void => {
    if (busy) return;
    void (async () => {
      setBusy(true);
      setStatus({ kind: 'syncing' });
      try {
        applyResult(await runCalendarMirror());
      } catch {
        setStatus({ kind: 'failed' });
      } finally {
        setBusy(false);
        setLastSyncMs(await readLastSync());
      }
    })();
  };

  return (
    <section
      className="ht-settings__data-card"
      data-testid="feishu-calendar-settings"
      aria-label={t('web.calendar.hub.title')}
    >
      <header className="ht-settings__data-card-header">
        <div>
          <h3 className="ht-settings__data-card-title ht-type-headline">
            <CalendarClock size={ICON_SIZE.sm} aria-hidden="true" />
            {t('web.calendar.hub.title')}
          </h3>
        </div>
      </header>
      <div className="ht-settings">
        <form onSubmit={onSubmit} noValidate>
          <FormField id="feishu-hub-base-url" label={t('web.calendar.hub.baseUrl')} required>
            {(field) => (
              <input
                {...field}
                type="url"
                value={baseUrl}
                autoComplete="off"
                onChange={(changed) => {
                  setBaseUrl(changed.target.value);
                }}
                data-testid="feishu-hub-base-url"
              />
            )}
          </FormField>
          <FormField id="feishu-hub-token" label={t('web.calendar.hub.token')} required>
            {(field) => (
              <input
                {...field}
                type="password"
                value={token}
                autoComplete="off"
                onChange={(changed) => {
                  setToken(changed.target.value);
                }}
                data-testid="feishu-hub-token"
              />
            )}
          </FormField>
          <div className="ht-settings__actions">
            <Button type="submit" tone="primary" size="sm" loading={busy} data-testid="feishu-hub-connect">
              {t('web.calendar.hub.connect')}
            </Button>
            {configured ? (
              <Button
                type="button"
                tone="ghost"
                size="sm"
                disabled={busy}
                data-testid="feishu-hub-sync"
                onClick={onSync}
              >
                {t('web.calendar.hub.sync')}
              </Button>
            ) : null}
          </div>
        </form>
        {configured && lastSyncMs !== undefined ? (
          <p className="ht-settings__data-status" role="status" data-settings-readout>
            {lastSyncText()}
          </p>
        ) : null}
        {status.kind === 'idle' ? null : (
          <p className="ht-settings__data-status" role="status">
            {statusText(status)}
          </p>
        )}
      </div>
    </section>
  );
}
