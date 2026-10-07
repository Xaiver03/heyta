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
 * * 点是否存在 → 当前日期是否有任务或倒数日；点的颜色始终使用主蓝；
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
 * ⚠️ 侧栏同时显示**休 / 班标记**与节日辅助名：事实分别来自 `adjustmentOn` / `festivalsOn`，
 * 文案来自 i18n；这里不重新实现节日算法。
 */

import { useMemo } from 'react';

import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import {
  addMonths,
  adjustmentOn,
  festivalsOn,
  isScopeEmpty,
  isoWeekday,
  monthGrid,
  scopeTasks,
  toLocalDate,
  type FestivalId,
  type LocalDate,
  type Task,
} from '@heyta/domain';
import {
  calendarDayMarkerView,
  formatDayTitleText,
  formatMonthTitleText,
  groupEventsByOccurrence,
  groupTasksByCalendarDate,
  toOrganizerTree,
  toTagItems,
  WEEKDAY_MESSAGE_KEYS,
} from '@heyta/ui';
import type { MessageKey } from '@heyta/i18n';
import { Check, ChevronLeft, ChevronRight, Circle } from 'lucide-react';

import { SidebarResizer } from '../shell/ColumnResizer.js';
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

/** 节日事实 id → 用户可见词条。算法在 domain，名称在 i18n，组件只负责组合。 */
const FESTIVAL_MESSAGE_KEYS: Record<FestivalId, MessageKey> = {
  'new-year': 'common.calendar.festival.newYear',
  'spring-festival': 'common.calendar.festival.springFestival',
  qingming: 'common.calendar.festival.qingming',
  'labour-day': 'common.calendar.festival.labourDay',
  'dragon-boat': 'common.calendar.festival.dragonBoat',
  'mid-autumn': 'common.calendar.festival.midAutumn',
  'national-day': 'common.calendar.festival.nationalDay',
};

/**
 * 「休 / 班」用哪个 class —— **这里不判颜色**。
 *
 * 🔴 键就是共享层 `calendarDayMarkerView` 返回的那个 token 名，尾巴抄进 class 名，
 *    所以"休与班使用专用日期语义色"这句话全仓库只有一处（RN 那侧走 `tokens[token]`）。
 *    写成**全覆盖的 Record** 而不是查表 + 兜底：共享层哪天多给一个 token，
 *    这一侧编译不过，而不是悄悄画成默认色（§7 那条"跨端常量抄件"的形状）。
 */
const MARKER_CLASS: Record<
  'color.calendar-day-off' | 'color.calendar-day-work',
  string
> = {
  'color.calendar-day-off': 'ht-sidebar__day-marker--off',
  'color.calendar-day-work': 'ht-sidebar__day-marker--work',
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
  label,
  festivalNames,
  marker,
  hasTask,
  hasEvent,
  onPress,
}: {
  date: LocalDate;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  label: string;
  /** 节日名是辅助信息，视觉上低于日期数字，但在读屏名称中完整保留。 */
  festivalNames: readonly string[];
  /** 「休 / 班」那一枚标记（没说法时不给 ⇒ 一个节点都不画）。 */
  marker?: { readonly text: string; readonly colorToken: 'color.calendar-day-off' | 'color.calendar-day-work' } | undefined;
  /** 这天有没有范围内的任务。 */
  hasTask: boolean;
  /** 这天有没有倒数日（W6）。 */
  hasEvent: boolean;
  onPress: (date: LocalDate) => void;
}): React.JSX.Element {
  // 点只回答"这天有没有日历内容"，不表达逾期或完成状态。
  const hasContent = hasTask || hasEvent;

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
      {festivalNames.length === 0 ? null : (
        <span className="ht-sidebar__day-aux" aria-hidden="true">
          {festivalNames.join(' · ')}
        </span>
      )}
      {/*
        🔴 **一颗点，不是一到三颗**：点只回答"这天有没有事、大致什么状态"。
        侧栏宽度是用户可拖的（`--ht-layout-sidebar-min/max-width`），最窄时一格只有
        二十来像素，主区那 1–3 颗在这里会糊成一条线 —— "3 件事"和"1 件事"看起来一样，
        用户得到的信息反而更少。点径用的是 `--ht-size-badge-dot`，
        它登记的语义本来就是"只表示「有」、不表示「多少」"。
      */}
      <span className="ht-sidebar__day-dots" aria-hidden="true">
        {hasContent ? (
          /* 🔴 这颗点带自己的 testID：判据问的是"这一天有没有被标出来"，
             而按 class 数会连容器一起数（`-dots` 那一层每天都画）。 */
          <i data-testid={`calendar-mini-dot-${date}`} style={{ background: cssVar('color.primary') }} />
        ) : null}
        {/*
          「休 / 班」（W6 补齐的那半：原先只有主区月历画，侧栏说"这天有没有事"，
          却不说"这天是不是班"）。词与颜色都来自共享层同一个
          `calendarDayMarkerView` —— 这里只搬它给的 token 名，不再判一次。

          🔴 它和那颗点**共用这一行**，不是下面另起一行：另起一行会把格子撑高，
          而这一列宽只有 ~27px（`--ht-layout-sidebar-min-width` 192px / 7），
          2026-10-04 实测那样会把七列撑歪、整张月历溢出侧栏
          （取证见 `sidebar.css` 里 `.ht-sidebar__day` 那条记录）。
        */}
        {marker === undefined ? null : (
          <span
            className={`ht-sidebar__day-marker ${MARKER_CLASS[marker.colorToken]}`}
            data-testid={`calendar-mini-marker-${date}`}
          >
            {marker.text}
          </span>
        )}
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
  const weeks = useMemo(() => monthGrid(view.cursor), [view.cursor]);
  const byDate = useMemo(() => {
    const first = weeks[0]?.[0]?.date;
    const lastWeek = weeks[weeks.length - 1];
    const last = lastWeek?.[lastWeek.length - 1]?.date;
    if (first === undefined || last === undefined) return new Map<LocalDate, Task[]>();
    return groupTasksByCalendarDate(scoped, first, last);
  }, [scoped, weeks]);

  /**
   * 侧栏迷你月历里**有倒数日的那些天**（W6）。
   *
   * 🔴 与主区月历同一条理由：主区格子里画了那条日子，侧栏那一格却说"这天没事"，
   *   就是同一屏两份当天的账（本轮已在"选中那天的清单"上抓到过一次同形状）。
   * ⚠️ 只取**哪些天**，不取标题与天数：这一格只有一个点，它回答的是"有没有"。
   *   区间取整张迷你月历（含补白格），与主区月历那条"少画的是看得见的格子"同口径。
   */
  const countdownEvents = useCountdownStore((s) => s.events);
  const eventDates = useMemo(() => {
    const first = weeks[0]?.[0]?.date;
    const lastWeek = weeks[weeks.length - 1];
    const last = lastWeek?.[lastWeek.length - 1]?.date;
    if (first === undefined || last === undefined) return new Set<LocalDate>();
    return new Set(groupEventsByOccurrence(countdownEvents, today, first, last).keys());
  }, [countdownEvents, today, weeks]);

  /**
   * 「休 / 班」的词表（与主区月历**同一批词条**）。
   *
   * ⚠️ 函数身份挂在 `publicFactsEpoch` 上（与 `CalendarView` 同一条理由）：
   *   覆盖表是领域层的模块级状态，React 看不见它 —— 不换一次函数身份，
   *   部署方改了录入之后侧栏会停在旧的那几个字，而界面上没有任何东西说"这是旧的"。
   */
  const markerLabels = useMemo(
    () => ({
      off: t('common.calendar.dayMarker.off'),
      work: t('common.calendar.dayMarker.work'),
    }),
    [t, view.publicFactsEpoch],
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
   * 🔴 单复数是**两条词条**，且每条都写成一次 `t('字面量', …)`。
   * 把 key 塞进三元表达式（`t(cond ? 'a' : 'b', …)`）会被 `check:ui-language`
   * 判成"用户可见的硬编码字面量" —— 它认的是 `t()` 的**第一个实参是不是字面量**，
   * 不是这一行有没有走词条表。
   */
  const dayLabel = (
    date: LocalDate,
    list: readonly Task[],
    spoken?: string,
    hasEvent = false,
    festivalNames: readonly string[] = [],
  ): string => {
    const title = formatDayTitleText(date, t);
    // 数的是**这天有几个条目**（任务 + 倒数日）：只数任务的话，读屏念"没有安排"，
    // 而眼睛看见的是一颗点 —— 同一格两个说法，且只有看不见的人被少报了。
    const count = list.length + (hasEvent ? 1 : 0);
    const base =
      count === 0
        ? t('web.calendar.a11y.dayNoTasks', { date: title })
        : count === 1
          ? t('web.calendar.a11y.dayWithTasksOne', { date: title, count: 1 })
          : t('web.calendar.a11y.dayWithTasks', { date: title, count });
    // 标记不进这句就只剩看得见的人知道（与共享板同一条），而词表没给时**不拼**：
    // 那颗点不该被念成"圆点"。
    const details = [...(spoken === undefined ? [] : [spoken]), ...festivalNames];
    return details.length === 0 ? base : `${base} ${details.join(' ')}`;
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
    <nav
      id="calendar-sidebar"
      className="ht-sidebar ht-sidebar--calendar"
      aria-label={t('web.calendar.side.aria')}
    >
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
                  const marker = calendarDayMarkerView(adjustmentOn(cell.date), markerLabels);
                  const festivalNames = festivalsOn(cell.date).map((id) => t(FESTIVAL_MESSAGE_KEYS[id]));
                  const hasEvent = eventDates.has(cell.date);
                  return (
                    <MiniDay
                      key={cell.date}
                      date={cell.date}
                      inMonth={cell.inMonth}
                      isToday={cell.date === today}
                      isSelected={cell.date === view.selected}
                      label={dayLabel(cell.date, cellTasks, marker?.spoken, hasEvent, festivalNames)}
                      festivalNames={festivalNames}
                      marker={marker}
                      hasTask={cellTasks.length > 0}
                      hasEvent={hasEvent}
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
