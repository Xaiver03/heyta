/**
 * 日历板的**纯逻辑**与文案契约
 * ==============================
 *
 * ## 为什么日历终于进了共享层
 *
 * `apps/mobile` 从 2026-09 起就有一个 439 行的月历（`screens/CalendarScreen.tsx`），
 * 而 `apps/web` **一个日历都没有** —— 产品负责人 2026-09-29 给的参考 IA 里，
 * 日历是 5 个主菜单之一（任务 / 日历 / 四象限 / 习惯 / 搜索）。
 *
 * 更糟的是它的分母：那份月历的**数学**（`monthGrid` / `startOfMonth` / `addMonths`
 * / `isoWeekday`）一直在 `@heyta/domain`，两端本该共用；而**渲染**只在移动端。
 * 于是"网页上没有日历"不是缺一行入口，是缺一整块 UI。
 *
 * ⇒ 这一刀把它提上来。日历里会**静默算错**的东西全都集中在数学那几行
 *（补白格属于上月还是本月、周一还是周日开头、1 月 31 日加一个月落到哪天），
 * 而那些一行都不在本目录 —— 全部来自 `@heyta/domain`。
 *
 * ## 🔴 文案**必须由宿主注入**，本目录不许 `import '@heyta/i18n'`
 *
 * 这是 `packages/ui` 的既定边界（见 `src/index.ts` 文件头）：引 i18n 会拖进
 * **第二份 React**，而两份 React 的 context 不共享 —— 症状是"语言切换在这个组件里不生效"，
 * 且只在某些打包顺序下出现。
 *
 * ⚠️ 所以这里的 `labels` 不是一份 `{key: string}` 词条表，而是**函数**：
 * 日期标题、星期列头、"这天有几件事"都是**动态**的，宿主拿到 `LocalDate` 之后
 * 用自己的 i18n 说出来。这与 `timeline/model.ts` 的 `TimelineViewLabels` 同一形状。
 */

import {
  addDays,
  addMonths,
  DAYS_PER_WEEK,
  toLocalDate,
  type LocalDate,
  type Task,
} from '@heyta/domain';

import type { TaskListLabels } from '../task-list/TaskList.js';

/**
 * 一个格子里最多画几条任务条。
 *
 * 原来是 `MAX_CALENDAR_DOTS = 3` 个**圆点**，而圆点不回答"这天有什么事" ——
 * 产品负责人 2026-10-02 对标滴答的那五张图里，格子里写的是任务标题。
 * 她说"内容永远不会被截断"在 heyta **不是一个已存在的缺陷**（格子里本来没有一个字），
 * 真缺陷是**格子里没有东西可读**。所以这一档从"点数"改成"可见条数"，
 * 而"不截断"变成**验收条件**：超出的一律折成 `+N`，绝不出现半条。
 *
 * 为什么还是 3：月格一行的高度 = 日期 + 3 条 + 可能的 `+N`，再高就会把
 * 6 行月历顶出视口 —— 那等于用"看得见标题"换掉"看得见整月"，不划算。
 */
export const MAX_CALENDAR_BARS = 3;

/**
 * 周视图一格里的条数上限（批三）。
 *
 * 🔴 它**不是**"月档那个数乘个倍数"那种看着推导、实际是拍的数 ——
 *   真正的约束是**这一格画得下几行**，而那由视口高度决定，不由档位数决定。
 *   取值过程（实测 1280×720 / 1280×1200 两张图，见
 *   `docs/plans/ui-review-fill-zh-timeline.md` §9.9）：
 *   周档那一格在 720 上约 `H` px 高、一条 ≈ 22px ⇒ 能完整画出 ⌊H/22⌋ 条。
 *   取 **6**：再多就已经超出"当天清单"自己那一屏的容量 ——
 *   周视图的作用是"一眼看完这一周"，不是"把清单搬进格子"。
 *   ⚠️ 判据一律**从这个常量推导**（`apps/web/tests/calendar-week-view.spec.tsx`
 *      与 `e2e/tests/calendar-week.spec.ts`），不许在测试里再抄一个 6。
 */
export const MAX_WEEK_CALENDAR_BARS = 6;

/** 格子里一条任务条需要的最小事实。🔴 不是 `Task`：格子只画标题与两个状态。 */
export type CalendarCellBar = {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  readonly overdue: boolean;
};

/**
 * 把当天的任务折成"可见条 + 被折叠数"。
 *
 * 排序是**有内容的**：逾期 → 未做 → 已做。
 * 理由是格子只有 3 个位置，把已完成的排进来等于用掉一个"这天还有什么要做"的信号，
 * 而那个信号才是她翻日历时想要的东西。
 *
 * ⚠️ `hidden` 是**从数据算出来的**（`tasks.length - visible.length`），
 * 不是界面数 DOM 数出来的 —— 后者会让"3 条 + +0"这种废话出现在界面上。
 */
export function calendarCellBars(
  tasks: readonly Task[],
  today: LocalDate,
  date: LocalDate,
  max: number = MAX_CALENDAR_BARS,
): { readonly bars: readonly CalendarCellBar[]; readonly hidden: number } {
  const decorated = tasks.map((task) => {
    const done = task.completedAt !== undefined;
    // 逾期 = 截止时间在今天之前**且还没做完**。已完成的不再算逾期 ——
    // 给一件做完的事标红是噪音，而红色在这个应用里只表示"要注意"（见 `calendarDayTone`）。
    return {
      id: task.id,
      title: task.title,
      done,
      overdue: !done && date < today,
    } satisfies CalendarCellBar;
  });
  const rank = (bar: CalendarCellBar): number => (bar.overdue ? 0 : bar.done ? 2 : 1);
  decorated.sort((a, b) => rank(a) - rank(b));
  const bars = decorated.slice(0, Math.max(0, max));
  return { bars, hidden: decorated.length - bars.length };
}

/**
 * 一天的状态色。**三档而不是五种**：格子里只有 4px 的点，再细分就分不出来了。
 */
export type CalendarDayTone = 'plain' | 'primary' | 'danger' | 'subtle';

/**
 * 从当天的任务推出格子里点的颜色。
 *
 * 🔴 逾期用 `danger`：它是**需要被注意到**的状态，不是一种分类。
 * 而"全做完了"给 `subtle` 而不是 `plain` —— 两者在视觉上都"没有待办"，
 * 但"这天清空了"值得一个不同的档（与"这天本来就没安排"区分开）。
 */
export function calendarDayTone(
  tasks: readonly Task[],
  today: LocalDate,
  date: LocalDate,
): CalendarDayTone {
  if (tasks.length === 0) return 'plain';
  const pending = tasks.filter((task) => task.completedAt === undefined);
  if (pending.length === 0) return 'subtle';
  return date < today ? 'danger' : 'primary';
}

/**
 * 日历板的全部文案 —— **宿主注入**（见文件头）。
 *
 * ⚠️ 动态的那几条是函数，不是带占位符的字符串：本层不知道宿主的插值语法
 *（词条表刻意没有 ICU），而且日期本身也要按语言格式化。
 */
/**
 * 日历档位。**只列真的实现出来的**（§9.3 那条明确不做的事：
 * 一排点了没反应的菜单项就是"零件在、最后一米没接"）。
 *
 * 🔴 类型定义在共享层：板子、工具栏、两个宿主的 store 都要用它，
 *   而"这一档到底存不存在"是**产品语义**，不是某个壳的偏好（AGENTS §3.5）。
 */
export type CalendarViewKind = 'month' | 'week';

/**
 * 游标走 **N 段**：月档一段 = 一个月，周档一段 = 一整周（7 天）。
 *
 * 🔴 为什么单独成一个函数，而不是"工具栏里写一遍、滚轮里再写一遍"：
 *   这两处都在回答同一个问题 ——「`>` 或滚一格之后，我在看哪一段」。
 *   两份实现的漂移形状是"点箭头翻一周、滚轮翻一月"，而两边各自都"看着对"。
 *   （`addMonths` / `addDays` 本身仍在 `@heyta/domain` —— 这里只决定"一段多长"。）
 */
export function stepCalendarCursor(
  view: CalendarViewKind,
  cursor: LocalDate,
  segments: number,
): LocalDate {
  return view === 'week'
    ? addDays(cursor, segments * DAYS_PER_WEEK)
    : addMonths(cursor, segments);
}

export interface CalendarBoardLabels {
  /** 月份标题，如「2026 年 9 月」。 */
  readonly monthTitle: (date: LocalDate) => string;
  /** 某一天的标题，如「9 月 29 日 周二」。 */
  readonly dayTitle: (date: LocalDate) => string;
  /**
   * 星期列头，**必须是周一开头的 7 个**。
   *
   * 🔴 顺序不许在这里重排：`monthGrid` 固定周一开头，列头一旦写成周日开头，
   * 整个日历会**整体错位一格** —— 而两边看起来都是正常的日历。
   * 宿主那边同理（见移动端 `lib/date.ts` 的 `WEEKDAY_MESSAGE_KEYS`）。
   */
  readonly weekdays: readonly [string, string, string, string, string, string, string];
  /** 格子读屏名：这天有 N 件事。 */
  readonly dayWithTasks: (args: { readonly date: string; readonly count: number }) => string;
  /** 格子读屏名：这天没有事。 */
  readonly dayNoTasks: (args: { readonly date: string }) => string;
  /**
   * 格子里被折叠掉的那几条的读屏名（视觉上是 `+3`，但 `+3` 不该被念成"加三"）。
   *
   * ⚠️ 刻意**可选**：`+N` 这个符号本身不需要翻译，所以没有它界面也完整 ——
   * 缺的只是读屏用户的一句解释。做成必填会让两端同时红
   * （AGENTS §3.3 那条"新增必填字段会在 hydration 炸"的 UI 版：新 props 一律可选）。
   * 两个宿主目前都传了，但**类型上仍然不许 required**：第三方宿主拆掉它不该编译不过。
   */
  readonly moreTasks?: (count: number) => string;
  readonly prevMonth: string;
  readonly nextMonth: string;
  /**
   * 周视图的标题与两个箭头的读屏名（批三）。
   *
   * ⚠️ 三条都**可选**，理由与 `moreTasks` 一样：新 props 一律可选，否则
   *   只实现月视图的宿主会当场编译不过（AGENTS §3.3 的 UI 版）。
   *   🔴 代价是"切到周视图却没给 `weekTitle`"在类型上合法 —— 那种状态下
   *   标题会退回月份（`2026年10月` 配一行 7 天，看着像坏了）。
   *   所以这条**由判据兜**：`e2e/tests/calendar-week.spec.ts` 断言周视图的
   *   标题里出现的是**周区间**，不是月份。
   */
  readonly weekTitle?: (date: LocalDate) => string;
  readonly prevWeek?: string;
  readonly nextWeek?: string;
  readonly backToToday: string;
  /**
   * 周次列的文案（滴答式："31周" / "W31"）。**可选** ——
   * 不给时整列不渲染（移动端屏窄，周次列省下的宽度给日期格）。
   * 入参是**这一行第一天**的日期（网格周一开头）。
   */
  readonly weekNumber?: (weekStart: LocalDate) => string;
  /** 选中的那天没有任何任务。 */
  readonly dayEmpty: string;
  /**
   * 页脚那句"这一页看不到什么"。
   *
   * 🔴 它不是装饰：**没设截止时间的任务不会出现在日历上**，
   * 不说清楚的话"任务没设时间"会被读成"任务丢了"。
   */
  readonly footnote: string;
  /** 当日列表里那些行自己的文案（勾选框读屏名等）—— 原样转交给共享 `TaskList`。 */
  readonly taskRow: TaskListLabels;
}

/**
 * 顶部工具栏只要这四条文案（`CalendarToolbar.tsx`）。
 *
 * 🔴 用 `Pick` 从 `CalendarBoardLabels` 上**取**，不是另写一份同形状的接口 ——
 * 后者会变成"同一句文案的两份契约"：板子改了名字，工具栏还按旧的要，
 * 编译期不报错，直到某个宿主发现自己少传了一条。
 */
export type CalendarToolbarLabels = Pick<
  CalendarBoardLabels,
  'monthTitle' | 'prevMonth' | 'nextMonth' | 'backToToday' | 'weekTitle' | 'prevWeek' | 'nextWeek'
>;

/**
 * 按**本地日期**把任务分到各天。
 *
 * ⚠️ 用 `toLocalDate` 而不是 `new Date(ms).getDate()`：后者要自己拼回字符串，
 * 而拼的过程中极易用上 UTC 口径 —— 结果是"凌晨到期的任务落到前一天"，
 * 且只对某些时区的用户复现。
 *
 * 🔴 **没有 `dueDate` 的任务不会出现在日历上** —— 所以宿主必须把
 * `labels.footnote` 显示出来（见那里）。这不是可以省的一句客套话：
 * 不说的话，"任务没设截止时间"会被读成"任务丢了"。
 */
export function groupTasksByDueDate(tasks: readonly Task[]): Map<LocalDate, Task[]> {
  const map = new Map<LocalDate, Task[]>();
  for (const task of tasks) {
    if (task.dueDate === undefined) continue;
    const key = toLocalDate(task.dueDate);
    const list = map.get(key);
    if (list === undefined) map.set(key, [task]);
    else list.push(task);
  }
  return map;
}

/** `dayMarker` 能答的三种说法（`undefined` = 这一天在公共事实里没有它）。 */
export type CalendarDayMarker = 'off' | 'work';

/** 格子里那一枚标记要摆的东西。 */
export interface CalendarDayMarkerView {
  /** 实际写字的那个字符（或降级用的一颗点）。 */
  readonly text: string;
  /** 用哪个语义色 —— 只能取 token 名，组件里不许出现裸色。 */
  readonly colorToken: 'color.success-strong' | 'color.warning-strong';
  /**
   * 这一格该不该被**念出来**。
   *
   * 🔴 与 `text` 分开是刻意的：词表没给时 `text` 退化成一颗点，而点不该进读屏名 ——
   * 念成"2026年10月10日，没有事，圆点"是噪声。读屏只念真的有字的时候。
   */
  readonly spoken: string | undefined;
}

/**
 * 把"休 / 班"这一档换算成格子里要摆的东西。
 *
 * 判断全部留在这里（本包文件头那条边界：有分支的逻辑进 model，组件只留摆放层），
 * 于是它能用 node 环境一次测穿，不需要整套 DOM 夹具。
 *
 * @param kind   `dayMarker(date)` 的答案。`undefined` ⇒ 返回 `undefined`，一格都不画。
 * @param labels 宿主的词表。缺省时标记只剩颜色 —— 那是 AGENTS §5 禁的接法，
 *               所以它**能被测出来**（判据在 `tests/calendar-day-marker.spec.ts`），
 *               而不是悄悄当成正常状态。
 */
export function calendarDayMarkerView(
  kind: CalendarDayMarker | undefined,
  labels: Readonly<{ off: string; work: string }> | undefined,
): CalendarDayMarkerView | undefined {
  if (kind === undefined) return undefined;
  const word = labels?.[kind];
  return {
    text: word ?? '●',
    colorToken: kind === 'off' ? 'color.success-strong' : 'color.warning-strong',
    spoken: word,
  };
}
