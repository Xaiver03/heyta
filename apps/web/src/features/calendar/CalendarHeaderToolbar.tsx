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
import { addDays, dueDateToEpoch, isScopeEmpty, scopeTasks, toLocalDate, type Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  SlidersHorizontal,
} from 'lucide-react';
import { AnchoredMenu, MenuItem, MenuSection, MenuSeparator } from '../../lib/menu/AnchoredMenu.js';
import { Button } from '../../components/hta/index.js';

/** 「时间线」那个 `<option value>`——刻意不是 `CalendarViewKind`，绝不交给 `store.setView`。 */
const TIMELINE_VALUE = 'timeline';

/**
 * 视图下拉上组的四个基础档，**顺序就是菜单顺序**（日 周 月 年）。
 * ⚠️ 与切换器的 `CALENDAR_VIEW_ORDER` 不同：那个是分段控件的顺序（月 周 日 年），
 * 这里是「按时间粒度从细到粗」，同一份档位表、两种摆放。
 */
const VIEW_MENU_KINDS = ['day', 'week', 'month', 'year'] as const satisfies readonly CalendarViewKind[];

/** 菜单里那枚快捷键提示（`D/1` = 字母键或数字键都能到这一档）。 */
const VIEW_SHORTCUT_HINT: Readonly<Record<(typeof VIEW_MENU_KINDS)[number], string>> = {
  day: 'D / 1',
  week: 'W / 2',
  month: 'M / 3',
  year: 'Y / 4',
};

/**
 * 快捷键真表：字母与数字两套并列，与上面的提示**一一对应**。
 * 🔴 提示画在界面上就必须真的能按 —— 不然那是一句假承诺。
 */
const VIEW_SHORTCUTS: Readonly<Record<string, CalendarViewKind | 'agenda'>> = {
  d: 'day',
  '1': 'day',
  w: 'week',
  '2': 'week',
  m: 'month',
  '3': 'month',
  y: 'year',
  '4': 'year',
  a: 'agenda',
  '5': 'agenda',
};

/** 焦点在可编辑控件里时，快捷键必须让路（否则打字会翻日历）。 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

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

  /** 大标题文字：与共享 `CalendarToolbar` 的 `copyFor` 同一套取值来源（labels）。 */
  const rangeTitle = useMemo(() => {
    if (view.extendedView !== 'none') {
      return labels.monthTitle(view.cursor);
    }
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
  }, [labels, view.cursor, view.extendedView, view.view]);

  const step = (dir: number): void => {
    if (view.extendedView === 'multiDay') {
      view.setCursor(addDays(view.cursor, dir * view.multiDayCount));
      return;
    }
    if (view.extendedView === 'multiWeek') {
      view.setCursor(addDays(view.cursor, dir * view.multiWeekCount * 7));
      return;
    }
    if (view.extendedView === 'agenda') {
      view.setCursor(stepCalendarCursor('month', view.cursor, dir));
      return;
    }
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

  /** 视图下拉（5 + 2 分组）自己一份开关与锚点 —— 与 `⋮` 那份互不干扰。 */
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewTriggerRef = useRef<HTMLButtonElement>(null);

  /** 触发按钮上显示的名字：扩展档优先，否则是基础档。 */
  const currentViewLabel = useMemo(() => {
    switch (view.extendedView) {
      case 'agenda':
        return t('web.calendar.view.agenda');
      case 'multiDay':
        return `${t('web.calendar.view.multiDay')} (${t('web.calendar.view.multiDayValue', { n: view.multiDayCount })})`;
      case 'multiWeek':
        return `${t('web.calendar.view.multiWeek')} (${t('web.calendar.view.multiWeekValue', { n: view.multiWeekCount })})`;
      default:
        return t(CALENDAR_VIEW_LABEL_KEYS[view.view]);
    }
  }, [t, view.extendedView, view.multiDayCount, view.multiWeekCount, view.view]);

  /*
   * 菜单里承诺的快捷键（D/1 … A/5）。用 `getState()` 而不是闭包里的 `view`：
   * 这里不需要订阅，也不会拿到过期快照。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      const next = VIEW_SHORTCUTS[event.key.toLowerCase()];
      if (next === undefined) return;
      event.preventDefault();
      if (next === 'agenda') {
        useCalendarViewStore.getState().setExtendedView('agenda');
      } else {
        useCalendarViewStore.getState().setView(next);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const [copied, setCopied] = useState(false);

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

  /** 剪贴板不可用时的兜底文本：就地给一份可手动复制的原文，不弹系统框。 */
  const [copyFallback, setCopyFallback] = useState<string | null>(null);

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
        setCopyFallback(text);
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

        {/*
          视图下拉：5 + 2 分组（日/周/月/年/日程 —— 多日/多周）。
          分段控件只放基础档；扩展档（日程/多日/多周）没有隐形入口，都从这里进。
        */}
        <Button
          ref={viewTriggerRef}
          tone="ghost"
          size="sm"
          className="ht-content__cal-viewtrigger"
          data-testid="calendar-view-dropdown-trigger"
          aria-haspopup="menu"
          aria-expanded={viewMenuOpen}
          aria-label={t('common.calendar.view.aria')}
          onClick={() => { setViewMenuOpen((open) => !open); }}
        >
          <span className="ht-content__cal-viewtrigger-label">{currentViewLabel}</span>
          <ChevronDown size={ICON_SIZE.xs} aria-hidden="true" />
        </Button>

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

        {copyFallback === null ? null : (
          <div className="ht-header__calendar-scope" role="status" data-testid="calendar-copy-fallback">
            {/* 剪贴板不可用（权限/非安全上下文）时，把原文就地给出来手动复制 —— 不弹系统框。 */}
            <textarea
              className="ht-input"
              readOnly
              rows={3}
              value={copyFallback}
              aria-label={t('web.calendar.more.share')}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button tone="ghost" onClick={() => { setCopyFallback(null); }}>
              {t('web.filter.cancel')}
            </Button>
          </div>
        )}

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

      {/* 左侧大标题 */}
      <div className="ht-content__cal-band ht-content__cal-band--title">
        <h2 className="ht-content__cal-bigtitle" data-testid="calendar-toolbar-month">
          {rangeTitle}
        </h2>
      </div>

      {/*
        视图下拉：上组 5 档（基础四档 + 日程），分割线，下组 2 档（多日 / 多周）。
        🔴 基础档走 `setView`（它会把 `extendedView` 归零），扩展档走 `setExtendedView`；
           `'timeline'` 仍只能从 `⋮` 进，绝不混进这份菜单。
      */}
      <AnchoredMenu
        open={viewMenuOpen}
        onClose={() => { setViewMenuOpen(false); }}
        triggerRef={viewTriggerRef}
        label={t('common.calendar.view.aria')}
        align="start"
        testID="calendar-view-dropdown"
      >
        {VIEW_MENU_KINDS.map((kind) => (
          <MenuItem
            key={kind}
            testID={`calendar-view-${kind}`}
            checked={view.extendedView === 'none' && view.view === kind}
            onSelect={() => { view.setView(kind); }}
          >
            {t(CALENDAR_VIEW_LABEL_KEYS[kind])}
            <span className="ht-content__cal-viewhint" aria-hidden="true">
              {VIEW_SHORTCUT_HINT[kind]}
            </span>
          </MenuItem>
        ))}
        <MenuItem
          testID="calendar-view-agenda"
          checked={view.extendedView === 'agenda'}
          onSelect={() => {
            view.setExtendedView('agenda');
            setViewMenuOpen(false);
          }}
        >
          {t('web.calendar.view.agenda')}
          <span className="ht-content__cal-viewhint" aria-hidden="true">
            A / 5
          </span>
        </MenuItem>
        <MenuSeparator />
        <div
          className="ht-content__cal-view-stepper-row"
          data-testid="calendar-view-multiDay"
          data-checked={view.extendedView === 'multiDay' ? 'true' : 'false'}
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={view.extendedView === 'multiDay'}
            className="ht-content__cal-view-stepper-main"
            onClick={() => {
              view.setExtendedView('multiDay');
              setViewMenuOpen(false);
            }}
          >
            <span className="ht-content__cal-view-stepper-check" aria-hidden="true">
              {view.extendedView === 'multiDay' ? '✓' : ''}
            </span>
            <span>{t('web.calendar.view.multiDay')}</span>
          </button>
          <div className="ht-content__cal-view-stepper-controls">
            <button
              type="button"
              className="ht-content__cal-view-stepper-btn"
              data-testid="calendar-view-multiDay-dec"
              aria-label={t('web.calendar.view.multiDay')}
              disabled={view.multiDayCount <= 2}
              onClick={(e) => {
                e.stopPropagation();
                view.setMultiDayCount(view.multiDayCount - 1);
              }}
            >
              −
            </button>
            <span className="ht-content__cal-view-stepper-count" data-testid="calendar-view-multiDay-count">
              {t('web.calendar.view.multiDayValue', { n: view.multiDayCount })}
            </span>
            <button
              type="button"
              className="ht-content__cal-view-stepper-btn"
              data-testid="calendar-view-multiDay-inc"
              aria-label={t('web.calendar.view.multiDay')}
              disabled={view.multiDayCount >= 14}
              onClick={(e) => {
                e.stopPropagation();
                view.setMultiDayCount(view.multiDayCount + 1);
              }}
            >
              +
            </button>
          </div>
        </div>
        <div
          className="ht-content__cal-view-stepper-row"
          data-testid="calendar-view-multiWeek"
          data-checked={view.extendedView === 'multiWeek' ? 'true' : 'false'}
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={view.extendedView === 'multiWeek'}
            className="ht-content__cal-view-stepper-main"
            onClick={() => {
              view.setExtendedView('multiWeek');
              setViewMenuOpen(false);
            }}
          >
            <span className="ht-content__cal-view-stepper-check" aria-hidden="true">
              {view.extendedView === 'multiWeek' ? '✓' : ''}
            </span>
            <span>{t('web.calendar.view.multiWeek')}</span>
          </button>
          <div className="ht-content__cal-view-stepper-controls">
            <button
              type="button"
              className="ht-content__cal-view-stepper-btn"
              data-testid="calendar-view-multiWeek-dec"
              aria-label={t('web.calendar.view.multiWeek')}
              disabled={view.multiWeekCount <= 2}
              onClick={(e) => {
                e.stopPropagation();
                view.setMultiWeekCount(view.multiWeekCount - 1);
              }}
            >
              −
            </button>
            <span className="ht-content__cal-view-stepper-count" data-testid="calendar-view-multiWeek-count">
              {t('web.calendar.view.multiWeekValue', { n: view.multiWeekCount })}
            </span>
            <button
              type="button"
              className="ht-content__cal-view-stepper-btn"
              data-testid="calendar-view-multiWeek-inc"
              aria-label={t('web.calendar.view.multiWeek')}
              disabled={view.multiWeekCount >= 6}
              onClick={(e) => {
                e.stopPropagation();
                view.setMultiWeekCount(view.multiWeekCount + 1);
              }}
            >
              +
            </button>
          </div>
        </div>
      </AnchoredMenu>

      <AnchoredMenu
        open={menuOpen}
        onClose={() => { setMenuOpen(false); }}
        triggerRef={menuTriggerRef}
        label={t('web.calendar.more.label')}
        testID="calendar-menu"
      >
        <MenuSection>{t('web.calendar.more.displaySection')}</MenuSection>
        <MenuItem
          testID="calendar-toggle-completed"
          checked={view.showCompleted}
          onSelect={() => { view.setShowCompleted(!view.showCompleted); }}
        >
          {t('web.calendar.more.showCompleted')}
        </MenuItem>
        <MenuItem
          testID="calendar-toggle-countdown"
          checked={view.showCountdown}
          onSelect={() => { view.setShowCountdown(!view.showCountdown); }}
        >
          {t('web.calendar.more.showCountdown')}
        </MenuItem>
        <MenuItem
          testID="calendar-open-display-settings"
          icon={<SlidersHorizontal size={ICON_SIZE.sm} aria-hidden="true" />}
          onSelect={() => { view.setDisplaySettingsOpen(true); }}
        >
          {t('web.calendar.more.openDisplaySettings')}
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
        <MenuSection>{t('web.calendar.more.subscribeSection')}</MenuSection>
        <MenuSection>{t('web.calendar.more.subscribeHint')}</MenuSection>
      </AnchoredMenu>
    </div>
  );
}
