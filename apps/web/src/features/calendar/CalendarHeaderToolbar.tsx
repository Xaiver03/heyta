/**
 * 页头那个日历工具栏（Web 宿主）—— 两层顶栏（macOS 日历 × 滴答清单综合体，2026-11-22）
 * ================================================================================
 *
 * 产品负责人 2026-11-22：「完全对齐 macOS 日历 + 滴答清单的综合体；左右分栏 + 顶部导航栏
 * 才是对的」，并要求「UI/UX 全部借鉴」。据此把这一格从“一条挤满控件的行”改成**两层**：
 *
 *   第①层（工具条）：视图分段 `日 周 月 年` · 新建 `＋` · `⋮`（低频项都在这里）
 *   第②层（大标题）：`当前范围大标题` ………………………… `‹  今天  ›`
 *
 * 为什么这样分：macOS 日历就是“控件在工具条、大标题在下面、`‹今天›` 跟大标题同排”。
 * 标题因此能做大、做稳，不会被一串控件挤小；控件也不必和标题抢同一行。
 *
 * 🔴 三条实现纪律（别改回去）：
 *  1. **testid 契约不变**：`calendar-toolbar-prev/month/next/today`、`calendar-view-select`、
 *     `calendar-capture-toggle`、`calendar-menu-open`、`calendar-scope-*` 全部照旧。
 *     e2e 光读这些 id 的就有十几处 —— 摆位变了、id 不能变。
 *  2. **原生 `<select data-testid="calendar-view-select">` 保留但视觉隐藏**（`.ht-content__cal-sr-only`）。
 *     它是**可访问的表单回退**（键盘/Tab/读屏仍能选档），同时让“按 value 切档”的既有判据继续成立；
 *     可见的分段控件 `CalendarViewTabs` 与它绑同一个 `view.view`。两者都是真控件，不是假控件。
 *  3. 「时间线」不是 `CalendarViewKind`（见下），仍只从 `⋮` 进，不进分段。
 */

import { ICON_SIZE } from '@heyta/design-system';
import { dueDateToEpoch, isScopeEmpty, scopeTasks, toLocalDate, type Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { useMemo, useRef, useState } from 'react';
import {
  CALENDAR_VIEW_LABEL_KEYS,
  CALENDAR_VIEW_ORDER,
  CalendarViewTabs,
  groupTasksByCalendarDate,
  stepCalendarCursor,
  type CalendarViewKind,
} from '@heyta/ui';

import { useTaskStore } from '../tasks/store.js';
import { useProjectStore } from '../projects/store.js';
import { useCalendarLabels } from './useCalendarLabels.js';
import { useCalendarViewStore } from './store.js';
import {
  RotateCcw,
  MoreHorizontal,
  CalendarRange,
  CalendarPlus,
  Share2,
  ChevronLeft,
  ChevronRight,
  Clock,
  SlidersHorizontal,
  Link2,
} from 'lucide-react';
import { AnchoredMenu, MenuItem, MenuSection, MenuSeparator } from '../../lib/menu/AnchoredMenu.js';
import { Button, SideSheet } from '../../components/hta/index.js';
import { CalendarDisplaySettingsSheet } from './CalendarDisplaySettingsSheet.js';
import { CalendarSubscriptionsCard } from '../settings/CalendarSubscriptionsCard.js';

/** 「时间线」那个 `<option value>`——刻意不是 `CalendarViewKind`，绝不交给 `store.setView`。 */
const TIMELINE_VALUE = 'timeline';

export interface CalendarHeaderToolbarProps {
  /** 功能模块「时间线」是否开着 —— 关掉时 `⋮` 里**不出现**这一档。 */
  timelineEnabled: boolean;
  /** 切到时间线视图（与 rail 上那个 tab 同一条路：`App.goToView('timeline')`）。 */
  onOpenTimeline: () => void;
}

export function CalendarHeaderToolbar({
  timelineEnabled,
  onOpenTimeline,
}: CalendarHeaderToolbarProps): React.JSX.Element {
  const view = useCalendarViewStore();
  const labels = useCalendarLabels();
  const { t } = useI18n();
  /** “今天”只有一个来源：任务 store 的 `now`（与主区同一份）。 */
  const now = useTaskStore((s) => s.now);
  const projects = useProjectStore((s) => s.projects);
  const tags = useProjectStore((s) => s.tags);

  /** 第②层的大标题文字：与共享 `CalendarToolbar` 的 `copyFor` 同一套取值来源（labels）。 */
  const rangeTitle = useMemo(() => {
    switch (view.view) {
      case 'week':
        return labels.weekTitle?.(view.cursor) ?? labels.monthTitle(view.cursor);
      case 'day':
        return labels.dayTitle(view.cursor);
      case 'year':
        return labels.yearTitle?.(view.cursor) ?? labels.monthTitle(view.cursor);
      default:
        return labels.monthTitle(view.cursor);
    }
  }, [labels, view.cursor, view.view]);

  const step = (dir: number): void => {
    view.setCursor(stepCalendarCursor(view.view, view.cursor, dir));
  };
  const prevLabel =
    view.view === 'week'
      ? labels.prevWeek ?? labels.prevMonth
      : view.view === 'day'
        ? labels.prevDay ?? labels.prevMonth
        : view.view === 'year'
          ? labels.prevYear ?? labels.prevMonth
          : labels.prevMonth;
  const nextLabel =
    view.view === 'week'
      ? labels.nextWeek ?? labels.nextMonth
      : view.view === 'day'
        ? labels.nextDay ?? labels.nextMonth
        : view.view === 'year'
          ? labels.nextYear ?? labels.nextMonth
          : labels.nextMonth;

  const hasScope = !isScopeEmpty(view.scope);
  const activeScopeNames = useMemo(() => {
    const names = [
      ...view.scope.projectIds.flatMap((id) => {
        const project = projects.find((item) => item.id === id);
        return project === undefined ? [] : [t('web.calendar.scope.projectSummary', { name: project.name })];
      }),
      ...view.scope.tagIds.flatMap((id) => {
        const tag = tags.find((item) => item.id === id);
        return tag === undefined ? [] : [t('web.calendar.scope.tagSummary', { name: tag.name })];
      }),
    ];
    return names.length === 0
      ? t('web.calendar.scope.activeCount', {
          count: view.scope.projectIds.length + view.scope.tagIds.length,
        })
      : names.join(t('web.calendar.scope.separator'));
  }, [projects, tags, t, view.scope.projectIds, view.scope.tagIds]);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  /** 「显示设置」抽屉（覆盖图谱 #40）。 */
  const [displayOpen, setDisplayOpen] = useState(false);
  /** 「日历订阅」抽屉（覆盖图谱 #41）：宿主复用设置里那份订阅管理卡片。 */
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false);

  const allTasks = useTaskStore((s) => s.entities.tasks);
  const setDueDate = useTaskStore((s) => s.setDueDate);

  const unscheduled = useMemo(() => {
    const scoped = scopeTasks(Object.values(allTasks), view.scope);
    return scoped
      .filter((task) => task.dueDate === undefined && task.dueDateLocal === undefined)
      .filter((task) => task.completedAt === undefined)
      .slice(0, 8);
  }, [allTasks, view.scope]);

  const selectedDayTasks = useMemo(() => {
    const scoped = scopeTasks(Object.values(allTasks), view.scope).filter(
      (task) => view.showCompleted || task.completedAt === undefined,
    );
    const grouped = groupTasksByCalendarDate(scoped, view.selected, view.selected);
    return grouped.get(view.selected) ?? [];
  }, [allTasks, view.scope, view.selected, view.showCompleted]);

  const scheduleToSelected = (task: Task): void => {
    void setDueDate(task.id, dueDateToEpoch(view.selected), view.selected);
  };

  const copySelectedDay = (): void => {
    const title = labels.dayTitle(view.selected);
    const lines =
      selectedDayTasks.length === 0
        ? [t('web.calendar.more.noTasksToday')]
        : selectedDayTasks.map((task) => `- ${task.title}`);
    const text = `${title}\n${lines.join('\n')}`;
    void (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard')))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => { setCopied(false); }, 2500);
      })
      .catch(() => {
        window.alert(text);
      });
  };

  return (
    <div className="ht-header__calendar-toolbar">
      {/* 第①层：视图分段 + 新建 + ⋮（低频项进 ⋮） */}
      <div className="ht-content__cal-band ht-content__cal-band--tools">
        <div className="ht-content__cal-seg">
          <CalendarViewTabs
            view={view.view}
            options={CALENDAR_VIEW_ORDER}
            onViewChange={(next) => {
              view.setView(next);
            }}
            labels={{
              group: t('common.calendar.view.aria'),
              name: (kind) => t(CALENDAR_VIEW_LABEL_KEYS[kind]),
            }}
            testID="calendar-view-tabs"
          />
        </div>

        {hasScope ? (
          <div className="ht-header__calendar-scope" data-testid="calendar-scope-summary" role="status">
            <span>{t('web.calendar.scope.active', { names: activeScopeNames })}</span>
            <button
              type="button"
              className="ht-header__calendar-scope-reset"
              data-testid="calendar-scope-reset"
              aria-label={t('web.calendar.scope.reset')}
              onClick={() => {
                view.resetScope();
              }}
            >
              <RotateCcw size={ICON_SIZE.xs} aria-hidden="true" />
              <span>{t('web.calendar.scope.reset')}</span>
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="ht-header__capture"
          data-testid="calendar-capture-toggle"
          aria-label={t('web.calendar.capture.add')}
          aria-expanded={view.captureOpen}
          onClick={() => {
            view.toggleCapture();
          }}
        >
          +
        </button>
        <Button
          ref={menuTriggerRef}
          tone="ghost"
          data-testid="calendar-menu-open"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t('web.calendar.more.label')}
          onClick={() => { setMenuOpen((open) => !open); }}
          leadingIcon={<MoreHorizontal size={ICON_SIZE.md} aria-hidden="true" />}
        />
        {copied ? (
          <span className="ht-header__calendar-scope" role="status" data-testid="calendar-share-copied">
            {t('web.calendar.more.copied')}
          </span>
        ) : null}

        {/* 可访问的视图回退：视觉隐藏，但键盘/读屏/按 value 切档的判据都仍成立。 */}
        <label className="ht-header__view ht-content__cal-sr-only" data-testid="calendar-view-switch">
          {t('common.calendar.view.aria')}
          <select
            aria-label={t('common.calendar.view.aria')}
            data-testid="calendar-view-select"
            value={view.view}
            onChange={(e) => {
              const next = e.target.value;
              if (next === TIMELINE_VALUE) {
                onOpenTimeline();
                return;
              }
              view.setView(next as CalendarViewKind);
            }}
          >
            {CALENDAR_VIEW_ORDER.map((kind) => (
              <option key={kind} value={kind}>
                {t(CALENDAR_VIEW_LABEL_KEYS[kind])}
              </option>
            ))}
            {timelineEnabled ? (
              <option value={TIMELINE_VALUE}>{t('web.shell.views.timeline')}</option>
            ) : null}
          </select>
        </label>
      </div>

      {/* 第②层：大标题 + ‹ 今天 › */}
      <div className="ht-content__cal-band ht-content__cal-band--title">
        <h2 className="ht-content__cal-bigtitle" data-testid="calendar-toolbar-month">
          {rangeTitle}
        </h2>
        <div className="ht-content__cal-nav">
          <button
            type="button"
            className="ht-content__cal-navbtn"
            aria-label={prevLabel}
            role="button"
            data-testid="calendar-toolbar-prev"
            onClick={() => { step(-1); }}
          >
            <ChevronLeft size={ICON_SIZE.sm} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ht-content__cal-today"
            role="button"
            data-testid="calendar-toolbar-today"
            onClick={() => {
              view.goToToday(toLocalDate(now));
            }}
          >
            {labels.backToToday}
          </button>
          <button
            type="button"
            className="ht-content__cal-navbtn"
            aria-label={nextLabel}
            role="button"
            data-testid="calendar-toolbar-next"
            onClick={() => { step(1); }}
          >
            <ChevronRight size={ICON_SIZE.sm} aria-hidden="true" />
          </button>
        </div>
      </div>

      <AnchoredMenu
        open={menuOpen}
        onClose={() => { setMenuOpen(false); }}
        triggerRef={menuTriggerRef}
        label={t('web.calendar.more.label')}
        testID="calendar-menu"
      >
        <MenuSection>{t('web.calendar.more.displaySection')}</MenuSection>
        <MenuItem
          testID="calendar-open-display-settings"
          icon={<SlidersHorizontal size={ICON_SIZE.sm} aria-hidden="true" />}
          onSelect={() => { setDisplayOpen(true); }}
        >
          {t('web.calendar.more.openDisplay')}
        </MenuItem>
        <MenuSeparator />
        <MenuSection>{t('web.calendar.more.scopeSection')}</MenuSection>
        <MenuItem
          testID="calendar-edit-scope"
          icon={<CalendarRange size={ICON_SIZE.sm} aria-hidden="true" />}
          onSelect={() => { view.setCalendarSidebarOpen(true); }}
        >
          {t('web.calendar.more.editScope')}
        </MenuItem>
        <MenuSeparator />
        <MenuSection>{t('web.calendar.more.arrangeSection')}</MenuSection>
        {unscheduled.length === 0 ? (
          <MenuSection>{t('web.calendar.more.noUnscheduled')}</MenuSection>
        ) : (
          unscheduled.map((task) => (
            <MenuItem
              key={task.id}
              testID={`calendar-arrange-${task.id}`}
              icon={<CalendarPlus size={ICON_SIZE.sm} aria-hidden="true" />}
              onSelect={() => { scheduleToSelected(task); }}
            >
              {t('web.calendar.more.arrangeTo', {
                title: task.title,
                date: labels.dayTitle(view.selected),
              })}
            </MenuItem>
          ))
        )}
        <MenuSeparator />
        <MenuItem
          testID="calendar-share-copy"
          icon={<Share2 size={ICON_SIZE.sm} aria-hidden="true" />}
          onSelect={() => { copySelectedDay(); }}
        >
          {t('web.calendar.more.share')}
        </MenuItem>
        {timelineEnabled ? (
          <>
            <MenuSeparator />
            <MenuItem
              testID="calendar-open-timeline"
              icon={<Clock size={ICON_SIZE.sm} aria-hidden="true" />}
              onSelect={() => { onOpenTimeline(); }}
            >
              {t('web.shell.views.timeline')}
            </MenuItem>
          </>
        ) : null}
        <MenuSeparator />
        <MenuItem
          testID="calendar-open-subscriptions"
          icon={<Link2 size={ICON_SIZE.sm} aria-hidden="true" />}
          onSelect={() => { setSubscriptionsOpen(true); }}
        >
          {t('web.calendar.more.subscribe')}
        </MenuItem>
      </AnchoredMenu>

      <CalendarDisplaySettingsSheet
        open={displayOpen}
        onClose={() => { setDisplayOpen(false); }}
      />
      {subscriptionsOpen ? (
        <SideSheet
          testId="calendar-subscriptions-sheet"
          labelledBy="calendar-subscriptions-sheet-title"
          title={t('web.calendar.sub.title')}
          onCancel={() => { setSubscriptionsOpen(false); }}
        >
          <CalendarSubscriptionsCard />
        </SideSheet>
      ) : null}
    </div>
  );
}
