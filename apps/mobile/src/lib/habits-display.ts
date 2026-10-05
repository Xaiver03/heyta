/**
 * 习惯的文案接线（移动壳）
 * ==========================
 *
 * M3 第七刀（habits）的移动端那一半。结构在 `@heyta/ui`（`HabitBoard` +
 * `habits/model.ts`），这里只剩"把语义结果映射到本端词条"这一层 ——
 * 所以它是 `HabitBoardLabels` 的构造器，字段与共享层一一对应，
 * 少给一个**编译期**就会报（共享层的 `labels` 是必填的）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 已知命名残差：这些键本该叫 `common.habits.*`
 *
 * 复用的全是 **`web.habits.*`**（与 `lib/quadrant-display.ts` 复用
 * `web.quadrant.*` 是同一个先例）：`packages/i18n` 不在本刀白名单，
 * 而"习惯"这件事四端完全同义，它不属于任何一端。
 *
 * 刻意**不新增**第二条同义键 —— 否则会出现同一句话的两个键。
 * 将来合并命名空间时，这一处是**纯改名**（键名换、文案不动）。
 *
 * ⚠️ 例外：**整块热力图的无障碍名与每一格的悬停文案是本刀新加的两条键**
 * （`web.habits.heatmap.a11y` / `.cell`），因为原来那条
 * `web.habits.heatmap` 用的是 `{{count}}`（react-activity-calendar 自己的
 * 占位符），自绘热力图复用它只会渲染出字面的 `{5}`。两条新键**中英同步已加**，
 * 并已 `pnpm --filter @heyta/i18n build`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件不做任何领域判断
 *
 * 什么算连续、冻结能保住几天、补上之后是几天、什么时候该给"重新开始"
 * 全在 `@heyta/domain`（`computeStreak` / `describeHabitResilience`），
 * 配对在 `@heyta/app-host#habitGrowth`（宿主注入给共享组件）。
 * 这里只搬字。
 */

import type { I18nValue, MessageKey } from '@heyta/i18n';
import type { HabitDayState, LocalDate } from '@heyta/domain';
import {
  CALENDAR_VIEW_LABEL_KEYS,
  WEEKDAY_MESSAGE_KEYS,
  formatDayTitleText,
  formatMonthTitleText,
  type CalendarViewTabsLabels,
  type HabitBoardLabels,
  type HabitMonthLabels,
  type HabitYearLabels,
  type HabitProgressListLabels,
} from '@heyta/ui';

/**
 * 月份词条 key（1 月 → 12 月，下标 = 月份 − 1）。
 *
 * 🔴 **共享层有一份**（`packages/ui/src/habits/model.ts` 的 `HEATMAP_MONTH_KEYS`），
 * 而这里为什么还有一份副本：
 *
 * 移动端的单测跑在 **vitest / node** 里，而 `@heyta/ui` 的 `dist` 顶层 import
 * `react-native`（Flow 源码）—— node 解析不了它。所以：
 *   · `import type { HabitBoardLabels }` 没问题（类型在编译期被擦除）；
 *   · `import { HEATMAP_MONTH_KEYS }`（**值**）会把整条 react-native 依赖拉进来，
 *     整个 spec 文件**转译失败**（实测：`0 test`，报 Flow 语法错误）。
 *
 * ⇒ 只能写副本。**副本的漂移由测试兜住**：
 * `tests/habits-display.spec.ts` 读 `packages/ui/src/habits/model.ts` 的
 * **源码文本**，断言两张表逐项相同（与 landing 的 mockup spec 同一手法）。
 * 只改共享层那一份 → 移动端测试红。
 */
export const MOBILE_HEATMAP_MONTH_KEYS = [
  'web.heatmap.month.1',
  'web.heatmap.month.2',
  'web.heatmap.month.3',
  'web.heatmap.month.4',
  'web.heatmap.month.5',
  'web.heatmap.month.6',
  'web.heatmap.month.7',
  'web.heatmap.month.8',
  'web.heatmap.month.9',
  'web.heatmap.month.10',
  'web.heatmap.month.11',
  'web.heatmap.month.12',
] as const satisfies readonly MessageKey[];

/**
 * 三个指标各自的一句话。
 *
 * 🔴 词条表没有 ICU：连续 1 天时英文必须走**单数兄弟词条**
 * （"Streak 1 days" 是一眼可见的坏句子）。三个数字各自分支，
 * 因为它们完全可能一个是 1、另一个不是。
 *
 * ⚠️ 与 web 宿主（`features/habits/HabitsView.tsx`）里那三个函数逐字同形状；
 * 两处都不能少分支。防漂移的判据在 `tests/habits-display.spec.ts`：
 * 它断言 `count === 1` 时拿到的是单数词条。
 */
function currentStreakText(count: number, t: I18nValue['t']): string {
  return count === 1
    ? t('web.habits.streak.currentOne', { count })
    : t('web.habits.streak.current', { count });
}

function longestStreakText(count: number, t: I18nValue['t']): string {
  return count === 1
    ? t('web.habits.streak.longestOne', { count })
    : t('web.habits.streak.longest', { count });
}

function totalCheckInText(count: number, t: I18nValue['t']): string {
  return count === 1
    ? t('web.habits.streak.totalOne', { count })
    : t('web.habits.streak.total', { count });
}

/** 打卡按钮的无障碍名："撤销今日打卡" / "为它打卡" 是两句话，各自成词条。 */
function checkInLabel(name: string, doneToday: boolean, t: I18nValue['t']): string {
  return doneToday
    ? t('web.habits.a11y.undo', { name })
    : t('web.habits.a11y.checkIn', { name });
}

/**
 * 构造共享 `HabitBoard` 需要的全部文案。
 *
 * 共享层**不 import i18n**（见它的文件头），所以模板留在这里；
 * 字段名必须与 `HabitBoardLabels` 逐项对上 —— 漏了编译不过。
 */
export function habitBoardLabels(t: I18nValue['t']): HabitBoardLabels {
  return {
    checkIn: t('web.habits.checkIn'),
    checkedIn: t('web.habits.checkedIn'),
    checkInA11y: ({ name, doneToday }) => checkInLabel(name, doneToday, t),
    streakCurrent: (count) => currentStreakText(count, t),
    streakLongest: (count) => longestStreakText(count, t),
    streakTotal: (count) => totalCheckInText(count, t),
    /*
      数量行（工单 W6）—— 与 web 那份 `habitBoardLabels` **同一批 key**
      （`common.habits.amount.*`），一条新键都没加：同一条习惯在两端说出
      两个样子的"今天记了几格"，是这个数最容易被打折的地方。
      单位为空的 fallback 也复用同一条 `web.habits.goal.defaultUnit`。
    */
    amount: ({ value, target, unit }) =>
      t('common.habits.amount.today', {
        value,
        target,
        unit: unit === '' ? t('web.habits.goal.defaultUnit') : unit,
      }),
    amountPlusA11y: ({ name }) => t('common.habits.amount.plus', { name }),
    amountMinusA11y: ({ name }) => t('common.habits.amount.minus', { name }),
    /*
      工单 W8 的四格 —— 与 web 那份 `habitBoardLabels` **同一批 key**
      （`web.habits.stats.*`），一条新键都没加：同一个月的同一组数字在两端
      说出两句话，是这批格子最容易被打折的地方。字段必填，少接编译就红。
      单位为空时退化成不带单位的句子（与 web 逐字同形状）。
    */
    monthDays: (count) => t('web.habits.stats.monthDays', { count }),
    monthRate: (percent) => t('web.habits.stats.monthRate', { percent }),
    monthRatePending: t('web.habits.stats.monthRatePending'),
    monthValue: ({ value, unit }) =>
      unit === ''
        ? t('web.habits.stats.monthValue', { value })
        : t('web.habits.stats.monthValueUnit', { value, unit }),
    totalValue: ({ value, unit }) =>
      unit === ''
        ? t('web.habits.stats.totalValue', { value })
        : t('web.habits.stats.totalValueUnit', { value, unit }),
    freeze: (count) => t('web.habits.freeze', { count }),
    repair: ({ date, count }) => t('web.habits.repair', { date, count }),
    repairAction: t('web.habits.repairAction'),
    repairA11y: ({ date, name }) => t('web.habits.a11y.repair', { date, name }),
    freshStart: ({ days, longest, total }) =>
      t('web.habits.freshStart', { days, longest, total }),
    freshStartAction: t('web.habits.freshStartAction'),
    freshStartA11y: (name) => t('web.habits.a11y.freshStart', { name }),
    empty: t('web.habits.empty'),
    heatmap: {
      // 月份 key 的表是**上面那份副本**（共享层那份在 node 下 import 不了，
      // 理由见那张表的注释）；漂移由 `tests/habits-display.spec.ts` 兜住。
      // ⚠️ 兜底写字面量：下标越界时 `… [0]` 在 `noUncheckedIndexedAccess`
      // 下仍是 `… | undefined`，编译不过。
      month: (month) => t(MOBILE_HEATMAP_MONTH_KEYS[month - 1] ?? 'web.heatmap.month.1'),
      grid: ({ name, total, days }) => t('web.habits.heatmap.a11y', { name, count: total, days }),
      /**
       * 🔴 **刻意不传 `cellTooltip`。**
       *
       * 它是**悬停**提示（`data-cell-title` + 宿主 CSS 的 `::after`），
       * 而手机上**没有鼠标** —— 传了就是承诺一个不存在的交互。
       * 共享层据此完全不产出那个属性（判据见
       * `apps/web/tests/habits-board.spec.tsx` 的 A2）。
       */
      less: t('web.heatmap.less'),
      more: t('web.heatmap.more'),
    },
  };
}

/**
 * 构造共享 `HabitProgressList`（清单那一层）需要的全部文案。
 *
 * 🔴 复用的是 **web 那份 DOM 清单已经在用的同一批 key**
 * （`web.habits.list.aria` / `.row.aria` / `.row.selectA11y`），一条新键都没加：
 * 同一句话在两端长成两个样子，是"列表 + 窗格"这形态最容易被悄悄做坏的地方 ——
 * 而词条表里多一条同义键不会让任何测试变红。
 *
 * ⚠️ 三个数字的句子走**同一对单复数分支**（`currentStreakText` 等，与详情板共用），
 * 因为清单上的 chip 只放数字，完整句子只有这里能给读屏。
 */
export function habitListLabels(t: I18nValue['t']): HabitProgressListLabels {
  return {
    list: t('web.habits.list.aria'),
    // 🔴 与详情板同一个既有 key：共享清单自己渲染空态，视图里不留手写空态。
    empty: t('web.habits.empty'),
    row: ({ name, current, longest, total }) =>
      t('web.habits.row.aria', { name, current, longest, total }),
    selectA11y: (name) => t('web.habits.row.selectA11y', { name }),
    streakCurrent: (count) => currentStreakText(count, t),
    streakLongest: (count) => longestStreakText(count, t),
    streakTotal: (count) => totalCheckInText(count, t),
  };
}

/**
 * 构造共享 `HabitMonthBoard`（月历 + 可点补打卡，工单 H4）需要的文案。
 *
 * 🔴 六档句子与 web 用的是**同一批 `web.habits.month.*` key**（本文件开头那条
 * "命名残差"在这里继续成立）：月历格子上说的是"这天能不能补"，四端同一个事实。
 * 在移动端另开一组 `mobile.habits.month.*` 会出现"同一个 too-old，
 * web 说『已超过补打卡窗口』、手机说『太久了』"，而词条表多几条同义键不会让
 * 任何测试变红。
 *
 * ⚠️ 移动端**不注入** `cellTitle`：那是悬停提示，触屏没有悬停
 * （与 `HabitBoard` 的 `cellTooltip` 同一条约定 —— 不传就完全不产出属性）。
 */
const MONTH_STATE_KEYS = {
  logged: 'web.habits.month.logged',
  today: 'web.habits.month.today',
  backfillable: 'web.habits.month.backfillable',
  'not-scheduled': 'web.habits.month.notScheduled',
  future: 'web.habits.month.future',
  'too-old': 'web.habits.month.tooOld',
} as const satisfies Record<HabitDayState, MessageKey>;

export function habitMonthLabels(t: I18nValue['t']): HabitMonthLabels {
  return {
    grid: ({ name, month }) => t('web.habits.month.grid', { name, month }),
    weekdays: WEEKDAY_MESSAGE_KEYS.map((key) => t(key)),
    monthTitle: (date) => formatMonthTitleText(date, t),
    prevMonth: t('mobile.common.prevMonth'),
    nextMonth: t('mobile.common.nextMonth'),
    windowHint: (days) => t('web.habits.month.window', { n: days }),
    // 每档的句子**自带 `{date}`**（与 web 那份同一个形状）：这里只把日期用共享的
    // `formatDayTitleText` 说出来，不参与拼装。
    day: ({ date, state }) =>
      t(MONTH_STATE_KEYS[state], { date: formatDayTitleText(date, t) }),
    // 补白格另有一句：上一月视图里"今天"是一格尾随补白，按状态念会变成
    // "今天还没打卡"而点不动 —— 那句话必须是"它不在这个月里"。
    outOfMonth: ({ date }) =>
      t('web.habits.month.outOfMonth', { date: formatDayTitleText(date, t) }),
  };
}

/**
 * 年那一档的文案（工单 H7，移动端）。
 *
 * 🔴 与 web 那份**各自存在**是刻意的：两端的构造器都要吃自己那侧的 `t`，
 * 而共享层不许 import i18n（第二份 React）。相同的是**关名表**：
 * 档位名走共享层那一份 `CALENDAR_VIEW_LABEL_KEYS`，月份名走共享的
 * `formatMonthTitleText` —— 两端都没有第二套"月份/档位叫什么"。
 */
export function habitYearLabels(t: I18nValue['t']): HabitYearLabels {
  return {
    grid: ({ name, year }) => t('web.habits.year.grid', { name, year }),
    yearTitle: (year) => t('common.date.yearTitle', { year }),
    monthName: (monthKey) => formatMonthTitleText(`${monthKey}-01` as LocalDate, t),
    achieved: (days) => t('web.habits.year.achieved', { n: days }),
    rate: (percent) => t('web.habits.year.rate', { n: percent }),
    noDenominator: t('web.habits.year.none'),
    future: t('web.habits.year.future'),
    card: ({ monthName, achievedDays, rateText }) =>
      t('web.habits.year.card', { month: monthName, state: rateText, achieved: achievedDays }),
    prevYear: t('common.calendar.prevYear'),
    nextYear: t('common.calendar.nextYear'),
    summary: ({ achievedDays, rateText }) =>
      t('web.habits.year.summary', { achieved: achievedDays, state: rateText }),
  };
}

/** 「月 ⇄ 年」那排切换器：档位名取共享层那一张表，不新增词条。 */
export function habitTrendTabs(t: I18nValue['t']): CalendarViewTabsLabels {
  return {
    group: t('common.calendar.view.aria'),
    name: (kind) => t(CALENDAR_VIEW_LABEL_KEYS[kind]),
  };
}
