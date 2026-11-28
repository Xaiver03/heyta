/**
 * 「飞书日程」面板（Web 宿主的阶段 A）
 * ==================================
 *
 * 这一块只做**只读议程**：把物化状态里的 `CALENDAR_EVENT` 摊成「今天 / 最近 7 天」两组
 * （分组是纯函数 `agenda.ts`，跨天与全天都在那里判）；标签勾选交给 `@heyta/app-host` 的
 * `setCalendarEventTags`（唯一可写的一格，op 形状/去重/空集合写 `null` 都不在本文件里）。
 *
 * 🔴 **连接的配置不在这里**：Hub 地址 + 令牌在「设置 → 数据与同步」的
 * `FeishuCalendarSettingsCard`（低频、需要参数的动作属于设置层）。本面板只在**已连接**时
 * 渲染；未连接时整块不画 —— 否则侧栏会常驻一个低频的配置表单，入口就过浅了。
 *
 * ## 不画什么（都是刻意的）
 *
 * · **没有「完成」按钮**：这是只读镜像，完成与否归飞书，heyta 写回去只会让
 *   下一次同步把它冲掉，而用户以为自己已经打勾了（ADR-0089 §2.1）。
 * · **不能拖拽改时间**：同上。日程行是 `<button>`，不是 `draggable`。
 * · **详情只读**：标题 / 时间 / 地点 / 描述 / 参会人没有编辑控件；唯一可写的
 *   是标签复选框。少一个输入框，就少一处"改了但没保存"的疑案。
 *
 * ## 交互（为什么是这样）
 *
 * · 已连接 = 今天 / 最近 7 天两个档。默认「今天」：这一屏的入口是"今天的会"，
 *   七天是展开而不是默认。
 * · 一条点开才画详情。列表态只有时间、标题、日历/组织、标签 chip —— 扫一眼够用，
 *   详情不占所有人的纵向空间。
 * · 空态是一句话，不是一个空框：最近 7 天里一条都没有时就该这么说。
 */

import { setCalendarEventTags } from '@heyta/app-host';
import { ICON_SIZE } from '@heyta/design-system';
import { indexTags, resolveTagIds, resolveTags, toLocalDate, type CalendarEvent } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { formatDayTitleText } from '@heyta/ui';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button, IconButton } from '../../components/hta/index.js';
import { currentState, dispatchIntent } from '../../lib/oplog.js';
import { useProjectStore } from '../projects/store.js';
import { useTaskStore } from '../tasks/store.js';
import { agendaDays, agendaGroups, type AgendaRange } from './agenda.js';
import { syncAge, useHubConnection } from './hub-connection.js';

/** 标签写入的上下文。与 `features/projects/store.ts` 同一个形状，只含函数引用。 */
const actionContext = { dispatch: dispatchIntent, getState: currentState };

type PanelStatus =
  | { readonly kind: 'syncing' }
  | { readonly kind: 'synced'; readonly added: number; readonly updated: number; readonly deleted: number }
  | { readonly kind: 'notModified' }
  | { readonly kind: 'network' }
  | { readonly kind: 'http' }
  | { readonly kind: 'shape' }
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'tagFailed' };

/** 事件开始/结束那一刻的钟点。`locale` 进 memo：切语言时 12/24 小时制跟着走。 */
function useClock(locale: string): (ms: number) => string {
  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    return (ms: number) => formatter.format(new Date(ms));
  }, [locale]);
}

export function CalendarHubPanel(): React.JSX.Element | null {
  const { t, locale } = useI18n();
  const hub = useHubConnection();
  const now = useTaskStore((s) => s.now);
  const calendarEvents = useTaskStore((s) => s.entities.calendarEvents);
  const tags = useProjectStore((s) => s.tags);
  const clock = useClock(locale);

  const [range, setRange] = useState<AgendaRange>('today');
  const [expandedRow, setExpandedId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [tagBusyId, setTagBusyId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<PanelStatus | undefined>(undefined);

  const today = toLocalDate(now);
  const groups = useMemo(
    () => agendaGroups(Object.values(calendarEvents), agendaDays(today, range)),
    [calendarEvents, range, today],
  );
  const tagIndex = useMemo(() => indexTags(tags), [tags]);

  if (!hub.ready) return null;

  const configured = hub.connection.baseUrl !== '' && hub.connection.token !== '';
  // 未连接时侧栏**不画任何配置界面**：连接的配置入口在「设置 → 数据与同步」。
  if (!configured) return null;

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
      case 'tagFailed':
        return t('web.calendar.hub.status.tagFailed');
      default:
        return t('web.calendar.hub.status.failed');
    }
  };

  /**
   * 「最近一次成功同步」那一行。分档由纯函数 `syncAge` 给，措辞在 i18n：
   * 「已同步 · 3 分钟前」/「尚未同步」。它描述的**不是本轮结果**（那由 `status` 管），
   * 而是"上一次拉通是什么时候" —— 自动同步失败时它不动，恰好就是"这轮没成功"的证据。
   */
  const lastSyncText = (): string => {
    const age = syncAge(hub.lastSyncMs, now);
    switch (age.kind) {
      case 'never':
        return t('web.calendar.hub.lastSyncNever');
      case 'justNow':
        return t('web.calendar.hub.lastSyncWithAgo', {
          ago: t('web.calendar.hub.lastSyncJustNow'),
        });
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

  /** 同步一轮并把结果翻译成一句话。保存与手动同步两条路径共用。 */
  const syncAndReport = async (): Promise<void> => {
    setBusy(true);
    setStatus({ kind: 'syncing' });
    try {
      const result = await hub.sync();
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
          setStatus({ kind: result.cause === 'network' ? 'network' : result.cause === 'http-status' ? 'http' : 'shape' });
          return;
      }
    } catch {
      // 存储读写出错（不是网络那几档）—— 不渲染内部错误原文，只给"再试一次"。
      setStatus({ kind: 'failed' });
    } finally {
      setBusy(false);
    }
  };

  /** 勾选一次 = 整组交给动作层（`setCalendarEventTags` 写一条 UPD）。 */
  const onToggleTag = (event: CalendarEvent, tagId: string, checked: boolean): void => {
    if (tagBusyId !== undefined) return;
    const effective = resolveTagIds(event.tagIds, tagIndex);
    const next = checked ? [...effective, tagId] : effective.filter((id) => id !== tagId);
    setTagBusyId(event.id);
    void setCalendarEventTags(actionContext, event.id, next)
      .then(() => {
        // 上一次"标签没保存"如果还挂着，成功后要收掉 —— 否则它会一直留在面板底部。
        setStatus((current) => (current?.kind === 'tagFailed' ? undefined : current));
      })
      .catch(() => {
        setStatus({ kind: 'tagFailed' });
      })
      .finally(() => {
        setTagBusyId(undefined);
      });
  };

  const timeLabelOf = (event: CalendarEvent): string => {
    if (event.allDay === true) return t('web.calendar.hub.allDay');
    if (event.start === undefined) return '';
    if (event.end === undefined) return clock(event.start);
    return `${clock(event.start)}–${clock(event.end)}`;
  };

  const timeRangeOf = (event: CalendarEvent): string => {
    if (event.allDay === true) {
      const start = event.startDate;
      const endExclusive = event.endDateExclusive;
      if (start === undefined) return t('web.calendar.hub.allDay');
      return endExclusive === undefined || endExclusive === start
        ? `${t('web.calendar.hub.allDay')} · ${formatDayTitleText(start, t)}`
        : `${t('web.calendar.hub.allDay')} · ${formatDayTitleText(start, t)} – ${formatDayTitleText(endExclusive, t)}`;
    }
    if (event.start === undefined) return '';
    const startDay = toLocalDate(event.start);
    const endDay = event.end === undefined ? startDay : toLocalDate(event.end);
    const startText =
      startDay === today || endDay === startDay
        ? clock(event.start)
        : `${formatDayTitleText(startDay, t)} ${clock(event.start)}`;
    if (event.end === undefined) return startText;
    const endText =
      endDay === startDay ? clock(event.end) : `${formatDayTitleText(endDay, t)} ${clock(event.end)}`;
    return `${startText} – ${endText}`;
  };

  const sourceOf = (event: CalendarEvent): string =>
    [event.accountId, event.calendarId, event.sourceEventId].filter((part) => part !== undefined && part !== '').join(' · ');

  const titleOf = (event: CalendarEvent): string => event.summary ?? t('web.calendar.hub.untitled');

  return (
    <section className="ht-sidebar__agenda" aria-label={t('web.calendar.hub.title')} data-testid="calendar-hub-panel">
      <div className="ht-sidebar__agenda-head">
        <span className="ht-nav__section ht-type-group-label">{t('web.calendar.hub.title')}</span>
        <span className="ht-sidebar__agenda-actions">
          <IconButton
            label={t('web.calendar.hub.sync')}
            icon={<RefreshCw size={ICON_SIZE.sm} aria-hidden="true" />}
            size="sm"
            disabled={busy}
            data-testid="calendar-hub-sync"
            onClick={() => {
              if (busy) return;
              void syncAndReport();
            }}
          />
        </span>
      </div>

      <>
          <div
            className="ht-sidebar__agenda-range"
            role="group"
            aria-label={t('web.calendar.hub.rangeAria')}
          >
            <Button
              tone={range === 'today' ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={range === 'today'}
              data-testid="calendar-hub-range-today"
              onClick={() => {
                setRange('today');
              }}
            >
              {t('web.calendar.hub.rangeToday')}
            </Button>
            <Button
              tone={range === 'next7' ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={range === 'next7'}
              data-testid="calendar-hub-range-next7"
              onClick={() => {
                setRange('next7');
              }}
            >
              {t('web.calendar.hub.rangeNext7')}
            </Button>
          </div>

          {groups.length === 0 ? (
            <p className="ht-sidebar__agenda-empty" data-testid="calendar-hub-empty">
              {t('web.calendar.hub.empty')}
            </p>
          ) : (
            <div className="ht-sidebar__agenda-groups">
              {groups.map((group) => (
                <div className="ht-sidebar__agenda-group" key={group.date}>
                  <div className="ht-sidebar__agenda-day">{formatDayTitleText(group.date, t)}</div>
                  <ul className="ht-sidebar__agenda-list">
                    {group.events.map((event) => {
                      const expanded = expandedRow === event.id;
                      const assignedTags = resolveTags(event.tagIds, tagIndex);
                      const effectiveTagIds = resolveTagIds(event.tagIds, tagIndex);
                      const detailId = `calendar-hub-detail-${event.id}`;
                      return (
                        <li className="ht-sidebar__agenda-item" key={event.id}>
                          <button
                            type="button"
                            className="ht-sidebar__agenda-row"
                            aria-expanded={expanded}
                            aria-controls={expanded ? detailId : undefined}
                            data-testid={`calendar-hub-event-${event.id}`}
                            onClick={() => {
                              setExpandedId(expanded ? undefined : event.id);
                            }}
                          >
                            <span className="ht-sidebar__agenda-time">{timeLabelOf(event)}</span>
                            <span className="ht-sidebar__agenda-title">{titleOf(event)}</span>
                            <span className="ht-sidebar__agenda-meta">
                              {[event.calendarId, event.accountId]
                                .filter((part) => part !== undefined && part !== '')
                                .join(' · ')}
                            </span>
                            {assignedTags.length === 0 ? null : (
                              <span className="ht-sidebar__agenda-chips">
                                {assignedTags.map((tag) => (
                                  <span className="ht-sidebar__agenda-chip" key={tag.id}>
                                    {tag.name}
                                  </span>
                                ))}
                              </span>
                            )}
                          </button>

                          {expanded ? (
                            <div
                              className="ht-sidebar__agenda-detail"
                              id={detailId}
                              data-testid={`calendar-hub-detail-${event.id}`}
                            >
                              <dl className="ht-sidebar__agenda-facts">
                                <dt>{t('web.calendar.hub.detail.time')}</dt>
                                <dd>{timeRangeOf(event)}</dd>
                                {event.location === undefined ? null : (
                                  <>
                                    <dt>{t('web.calendar.hub.detail.location')}</dt>
                                    <dd>{event.location}</dd>
                                  </>
                                )}
                                {event.description === undefined ? null : (
                                  <>
                                    <dt>{t('web.calendar.hub.detail.description')}</dt>
                                    <dd className="ht-sidebar__agenda-pre">{event.description}</dd>
                                  </>
                                )}
                                {event.attendees === undefined || event.attendees.length === 0 ? null : (
                                  <>
                                    <dt>{t('web.calendar.hub.detail.attendees')}</dt>
                                    <dd>
                                      {event.attendees
                                        .map((attendee) => attendee.name ?? attendee.id ?? '')
                                        .filter((name) => name !== '')
                                        .join(' · ')}
                                    </dd>
                                  </>
                                )}
                                <dt>{t('web.calendar.hub.detail.source')}</dt>
                                <dd>{sourceOf(event)}</dd>
                              </dl>

                              {tags.length === 0 ? (
                                <p className="ht-sidebar__agenda-note">{t('web.calendar.hub.noTags')}</p>
                              ) : (
                                <fieldset className="ht-sidebar__agenda-tags">
                                  <legend className="ht-sidebar__agenda-legend">
                                    {t('web.calendar.hub.tags')}
                                  </legend>
                                  {tags.map((tag) => (
                                    <label className="ht-sidebar__agenda-tag" key={tag.id}>
                                      <input
                                        type="checkbox"
                                        checked={effectiveTagIds.includes(tag.id)}
                                        disabled={tagBusyId !== undefined}
                                        aria-label={t('web.calendar.hub.tagToggle', {
                                          name: tag.name,
                                          title: titleOf(event),
                                        })}
                                        onChange={(changed) => {
                                          onToggleTag(event, tag.id, changed.target.checked);
                                        }}
                                      />
                                      <span>{tag.name}</span>
                                    </label>
                                  ))}
                                </fieldset>
                              )}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>

      {/* 「最近一次成功同步」：已配置就常驻一行；自动同步失败时它不动，就是"没成功"的证据。 */}
      <p className="ht-sidebar__agenda-status" data-testid="calendar-hub-last-sync">
        {lastSyncText()}
      </p>

      {status === undefined && !hub.autoSyncing ? null : (
        <p className="ht-sidebar__agenda-status" role="status" data-testid="calendar-hub-status">
          {hub.autoSyncing && status?.kind !== 'syncing'
            ? t('web.calendar.hub.autoSyncing')
            : statusText(status ?? { kind: 'syncing' })}
        </p>
      )}
    </section>
  );
}
