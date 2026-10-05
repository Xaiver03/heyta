import { ICON_SIZE } from '@heyta/design-system';
/**
 * 日历页的侧栏（Web 壳）—— 迷你月历 + 显示范围
 * ==============================================
 *
 * 产品负责人 2026-09-30 给的参考图里，日历视图左边那一列不是清单/标签的
 * 任务筛选，而是**两样东西**：上面一个可以点着翻月的迷你月历，下面一组
 * 决定"日历上看得见谁"的复选框（「所有」+ 清单 + 标签）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 数学与色调**一行都不在这里**
 *
 * * 格子怎么排（周一开头、补白格归哪个月）→ `@heyta/domain` 的 `monthGrid`；
 * * 点是什么颜色 → `@heyta/ui` 的 `calendarDayTone`（与主区同一条，**两个来源**：
 *   任务 + 倒数日，W6）；分组走同一个 `groupEventsForGrid`；
 *   **颗数在这里固定为一颗** —— 侧栏可拖到 12rem，那时一格只有二十来像素，
 *   主区那 1–3 颗会糊成一条线，"3 件事"和"1 件事"看起来一样；
 * * 哪些任务在范围内 → `@heyta/domain` 的 `scopeTasks`；
 * * 日期怎么说 → `@heyta/ui` 的 `formatDayTitleText`（与主区同一份措辞）。
 *
 * 这一列与主区的月历**必须同色同点同措辞**，否则"侧栏说这天有三件事、
 * 主区只列出一件"就是界面在说谎。所以这里只画，不判断。
 *
 * 🔴 迷你月历的列头是**周一开头**，不是参考图的周日开头
 *
 * `monthGrid` 是周一开头（`isoWeekday` 1..7）。列头写成周日开头不会报错，
 * 只会让整列**错位一格** —— 而错位后的界面看上去仍然像个正常日历。
 * 照抄参考图的排布是这里最容易犯的错。
 *
 * ⚠️ 参考图里的**节假日 / 农历 / 休班标记本轮没做**：那需要一份节假日数据源
 * （法定节假日每年由国务院办公厅发布、还要算调休），而 AGENTS §3.1/§3.2
 * 两道门目前没有任何满足条件的库可引，手写表则会在明年静默过期。
 * 这不是"忘了"，是**缺来源**。
 */

import { useMemo } from 'react';

import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import {
  addMonths,
  isScopeEmpty,
  isoWeekday,
  monthGrid,
  scopeTasks,
  toLocalDate,
  type LocalDate,
  type Task,
} from '@heyta/domain';
import {
  calendarDayTone,
  formatDayTitleText,
  formatMonthTitleText,
  groupEventsForGrid,
  groupTasksByDueDate,
  toOrganizerTree,
  toTagItems,
  WEEKDAY_MESSAGE_KEYS,
  type CalendarDayTone,
} from '@heyta/ui';
import { Check, ChevronLeft, ChevronRight, Circle } from 'lucide-react';

import { SidebarResizer } from '../shell/SidebarResizer.js';
import { useCountdownStore } from '../countdown/store.js';
import { useProjectStore } from '../projects/store.js';
import { useTaskStore } from '../tasks/store.js';
import { useWheelMonthNav } from './useWheelMonthNav.js';
import { useCalendarViewStore } from './store.js';

/** 一行范围候选。`depth` 只服务缩进，不参与筛选判断。 */
interface ScopeRow {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
}

/** 色调 → token 名。**不写裸色值**（§5），且与共享板 `DayCell` 同一张表。 */
const DOT_TOKEN: Record<CalendarDayTone, 'color.danger' | 'color.primary' | 'color.foreground-subtle' | null> =
  {
    danger: 'color.danger',
    primary: 'color.primary',
    subtle: 'color.foreground-subtle',
    plain: null,
  };

/**
 * 迷你月历里的一天。
 *
 * ⚠️ 提到模块级而不是写在组件里：内联定义组件每次渲染都是**新类型**，
 * 42 个格子的按下反馈会被丢掉（共享板 `DayCell` 的同一条理由）。
 */
function MiniDay({
  date,
  inMonth,
  isToday,
  isSelected,
  tone,
  label,
  onPress,
}: {
  date: LocalDate;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  tone: CalendarDayTone;
  label: string;
  onPress: (date: LocalDate) => void;
}): React.JSX.Element {
  const dotToken = DOT_TOKEN[tone];

  return (
    <button
      type="button"
      className={[
        'ht-sidebar__day',
        inMonth ? '' : ' ht-sidebar__day--outside',
        isToday ? ' ht-sidebar__day--today' : '',
        isSelected ? ' ht-sidebar__day--selected' : '',
      ]
        .join('')
        .trim()}
      aria-label={label}
      // 🔴 选中态用 `aria-current="date"` 而不是 `aria-pressed`：这一格说的是
      // "当前看的是哪天"，`pressed` 说的是开关，读屏会把它念成一组可切换按钮。
      aria-current={isSelected ? 'date' : undefined}
      data-testid={`calendar-mini-day-${date}`}
      onClick={() => {
        onPress(date);
      }}
    >
      <span className="ht-sidebar__day-num">{Number(date.slice(8, 10))}</span>
      {/*
        🔴 **一颗点，不是一到三颗**：点只回答"这天有没有事、大致什么状态"。
        侧栏宽度是用户可拖的（`--ht-layout-sidebar-min/max-width`），最窄时一格只有
        二十来像素，主区那 1–3 颗在这里会糊成一条线 —— "3 件事"和"1 件事"看起来一样，
        用户得到的信息反而更少。点径用的是 `--ht-size-badge-dot`，
        它登记的语义本来就是"只表示「有」、不表示「多少」"。
      */}
      <span className="ht-sidebar__day-dots" aria-hidden="true">
        {dotToken === null ? null : <i style={{ background: cssVar(dotToken) }} />}
      </span>
    </button>
  );
}

/** 一个分组（清单 / 标签）：标题 + 总勾 + 逐行复选框。空组不进 DOM。 */
function ScopeGroup({
  heading,
  groupLabel,
  rows,
  selectedIds,
  itemLabel,
  onToggleItem,
  onToggleGroup,
}: {
  heading: string;
  /** 分组头总勾的可访问名（「全选或清空清单」）。 */
  groupLabel: string;
  rows: readonly ScopeRow[];
  selectedIds: readonly string[];
  itemLabel: (name: string) => string;
  onToggleItem: (id: string) => void;
  onToggleGroup: () => void;
}): React.JSX.Element | null {
  if (rows.length === 0) return null;
  const selectedCount = rows.filter((row) => selectedIds.includes(row.id)).length;
  const allSelected = selectedCount === rows.length;

  return (
    <div className="ht-sidebar__scope-group">
      <div className="ht-sidebar__scope-heading">
        <span className="ht-nav__section ht-type-group-label">{heading}</span>
        <input
          type="checkbox"
          aria-label={groupLabel}
          checked={allSelected}
          // 🔴 半选态必须真的设上：`indeterminate` 没有对应的 HTML 属性，
          // 只写 `checked` 的话"5 个标签勾了 2 个"与"一个都没勾"长得一模一样。
          ref={(el) => {
            if (el !== null) el.indeterminate = selectedCount > 0 && !allSelected;
          }}
          onChange={onToggleGroup}
          data-testid={`calendar-scope-group-${heading}`}
        />
      </div>
      {rows.map((row) => (
        <label
          key={row.id}
          className={`ht-sidebar__scope-row${row.depth > 0 ? ' ht-sidebar__scope-row--child' : ''}`}
        >
          <input
            type="checkbox"
            aria-label={itemLabel(row.name)}
            checked={selectedIds.includes(row.id)}
            onChange={() => {
              onToggleItem(row.id);
            }}
            data-testid={`calendar-scope-${row.id}`}
          />
          <span className="ht-sidebar__scope-name">{row.name}</span>
        </label>
      ))}
    </div>
  );
}

export function CalendarSidebar(): React.JSX.Element {
  const { t } = useI18n();
  const tasks = useTaskStore();
  const projects = useProjectStore();
  const view = useCalendarViewStore();

  const today = toLocalDate(tasks.now);
  /**
   * 🔴 侧栏的点与主区的格子读**同一份**"范围之后"的任务。
   * 各自算一遍的话，"侧栏说这天有 3 件事、点进去只列出 1 件"这种谎
   * 不会有任何一层报错。
   */
  const scoped = useMemo(
    () => scopeTasks(Object.values(tasks.entities.tasks), view.scope),
    [tasks.entities.tasks, view.scope],
  );
  const byDate = useMemo(() => groupTasksByDueDate(scoped), [scoped]);
  const weeks = useMemo(() => monthGrid(view.cursor), [view.cursor]);
  /*
   * 倒数日（日历的第二个事件源，W6）。数据与主区月历读**同一个 store**，
   * 分组走**同一个** `groupEventsForGrid`（传进这屏的 `weeks` 与选中的那天）。
   * 🔴 这两处任何一处"自己再算一遍"，症状都是侧栏与主区对同一天说不一样的话。
   */
  const events = useCountdownStore((s) => s.events);
  const eventsByDate = useMemo(
    () => groupEventsForGrid(events, weeks, view.selected),
    [events, weeks, view.selected],
  );

  /** 一层嵌套摊平成带 `depth` 的行（与任务侧栏同一条层级语义：子清单缩进）。 */
  const projectRows = useMemo<ScopeRow[]>(
    () =>
      toOrganizerTree(projects.projects).flatMap((node) => [
        { id: node.id, name: node.name, depth: 0 },
        ...node.children.map((child) => ({ id: child.id, name: child.name, depth: 1 })),
      ]),
    [projects.projects],
  );
  const tagRows = useMemo<ScopeRow[]>(
    () => toTagItems(projects.tags).map((item) => ({ id: item.id, name: item.name, depth: 0 })),
    [projects.tags],
  );

  /**
   * 格子的读屏名：完整日期 + 这天有没有事、有几件。
   *
   * 🔴 那个 `count` 是**任务 + 倒数日**两个来源之和（调用处算），与主区格子的
   *   `bars.length + hidden` 同一条口径。少算一边不会报错，只会让两列对同一天
   *   说出两个数 —— 而这一列存在的理由正是"与主区同色同点同措辞"。
   *
   * 🔴 单复数是**两条词条**，且每条都写成一次 `t('字面量', …)`。
   * 把 key 塞进三元表达式（`t(cond ? 'a' : 'b', …)`）会被 `check:ui-language`
   * 判成"用户可见的硬编码字面量" —— 它认的是 `t()` 的**第一个实参是不是字面量**，
   * 不是这一行有没有走词条表。
   */
  const dayLabel = (date: LocalDate, count: number): string => {
    const title = formatDayTitleText(date, t);
    if (count === 0) return t('web.calendar.a11y.dayNoTasks', { date: title });
    if (count === 1) return t('web.calendar.a11y.dayWithTasksOne', { date: title, count: 1 });
    return t('web.calendar.a11y.dayWithTasks', { date: title, count });
  };

  /**
   * 滚轮翻月（与主区月历同一条规则：**指针在月历格子上，滚轮就归月历**）。
   *
   * ⚠️ 这意味着迷你月历那一块**不再能滚侧栏**（下面的范围清单照常能滚）。
   * 这不是遗漏，是让一条规则学得会：两列里凡是月历格子，滚轮都翻月。
   * 两列各自累计、各自锁定，但写的是**同一个** `cursor` —— 所以在侧栏滚完，
   * 主区的月份跟着走，反之也一样。
   */
  const wheelHost = useWheelMonthNav((step) => {
    view.setCursor(addMonths(view.cursor, step));
  });

  return (
    <nav className="ht-sidebar ht-sidebar--calendar" aria-label={t('web.calendar.side.aria')}>
      {/* 🔴 滚动的是**这一层**，不是 `<nav>` 自己：把手（`SidebarResizer`）必须留在
          滚动区之外。把手有 4px 骑在这一列的右边缘**外面**，而 `overflow-y: auto`
          会连带把横轴裁掉 —— 症状是"把手在那儿、几何中心按下去拖不动"（真浏览器实测）。 */}
      <div className="ht-sidebar__calendar-body">
        {/* ── 迷你月历 ─────────────────────────────────────────── */}
        <div className="ht-sidebar__month" ref={wheelHost}>
          <div className="ht-sidebar__month-head">
            <span className="ht-sidebar__month-title" data-testid="calendar-mini-title">
              {formatMonthTitleText(view.cursor, t)}
            </span>
            <div className="ht-sidebar__month-nav">
              <button
                type="button"
                className="ht-sidebar__month-nav-btn"
                aria-label={t('web.calendar.prevMonth')}
                data-testid="calendar-mini-prev"
                onClick={() => {
                  view.setCursor(addMonths(view.cursor, -1));
                }}
              >
                <ChevronLeft size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ht-sidebar__month-nav-btn"
                aria-label={t('web.calendar.backToToday')}
                data-testid="calendar-mini-today"
                onClick={() => {
                  view.goToToday(today);
                }}
              >
                <Circle size={ICON_SIZE.xs} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ht-sidebar__month-nav-btn"
                aria-label={t('web.calendar.nextMonth')}
                data-testid="calendar-mini-next"
                onClick={() => {
                  view.setCursor(addMonths(view.cursor, 1));
                }}
              >
                <ChevronRight size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="ht-sidebar__month-weekdays">
            {WEEKDAY_MESSAGE_KEYS.map((key, i) => (
              <span
                key={key}
                // 今天所在那一列的列头上主色（与共享板同一条：一眼看出"今天是星期几"）。
                style={i === isoWeekday(today) - 1 ? { color: cssVar('color.primary') } : undefined}
              >
                {t(key)}
              </span>
            ))}
          </div>

          <div className="ht-sidebar__month-grid" aria-label={t('web.calendar.mini.aria')}>
            {weeks.map((week) => (
              <div className="ht-sidebar__month-row" key={week[0]!.date}>
                {week.map((cell) => {
                  const cellTasks = byDate.get(cell.date) ?? [];
                  const cellEvents = eventsByDate.get(cell.date) ?? [];
                  return (
                    <MiniDay
                      key={cell.date}
                      date={cell.date}
                      inMonth={cell.inMonth}
                      isToday={cell.date === today}
                      isSelected={cell.date === view.selected}
                      tone={calendarDayTone(cellTasks, cellEvents, today, cell.date)}
                      label={dayLabel(cell.date, cellTasks.length + cellEvents.length)}
                      onPress={view.selectDay}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* ── 显示范围 ─────────────────────────────────────────── */}
        <div className="ht-sidebar__scope">
          <button
            type="button"
            className={`ht-sidebar__scope-all${isScopeEmpty(view.scope) ? ' ht-sidebar__scope-all--on' : ''}`}
            aria-pressed={isScopeEmpty(view.scope)}
            aria-label={t('web.calendar.scope.allAria')}
            data-testid="calendar-scope-all"
            onClick={view.resetScope}
          >
            <span>{t('web.calendar.scope.all')}</span>
            {isScopeEmpty(view.scope) ? <Check size={ICON_SIZE.sm} aria-hidden="true" /> : null}
          </button>

          <ScopeGroup
            heading={t('web.projects.heading')}
            groupLabel={t('web.calendar.scope.groupProject')}
            rows={projectRows}
            selectedIds={view.scope.projectIds}
            itemLabel={(name) => t('web.calendar.scope.project', { name })}
            onToggleItem={(id) => {
              view.toggleScopeItem('project', id);
            }}
            onToggleGroup={() => {
              view.setScopeGroup(
                'project',
                projectRows.map((row) => row.id),
              );
            }}
          />

          <ScopeGroup
            heading={t('web.tags.heading')}
            groupLabel={t('web.calendar.scope.groupTag')}
            rows={tagRows}
            selectedIds={view.scope.tagIds}
            itemLabel={(name) => t('web.calendar.scope.tag', { name })}
            onToggleItem={(id) => {
              view.toggleScopeItem('tag', id);
            }}
            onToggleGroup={() => {
              view.setScopeGroup(
                'tag',
                tagRows.map((row) => row.id),
              );
            }}
          />
        </div>
      </div>

      <SidebarResizer />
    </nav>
  );
}
