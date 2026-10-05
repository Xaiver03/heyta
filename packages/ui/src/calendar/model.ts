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
  MONTHS_PER_YEAR,
  startOfMonth,
  toLocalDate,
  type CountdownEvent,
  type LocalDate,
  type MonthGridCell,
  type Task,
  eventOccurrencesInRange,
} from '@heyta/domain';

import { isAllDayMs } from '../timeline/board-model.js';
import { formatClock, MINUTES_PER_HOUR } from '../timeline/model.js';
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
 *   ⚠️ 判据一律**从这个常量推导**（`apps/web/tests/calendar-view.spec.tsx`
 *      与 `e2e/tests/calendar-week.spec.ts`），不许在测试里再抄一个 6。
 */
export const MAX_WEEK_CALENDAR_BARS = 6;

/**
 * 格子里一条任务条需要的最小事实。🔴 不是 `Task`：格子只画标题与两个状态。
 *
 * ⚠️ 倒数日进来时**不需要一个新字段**：它在这四个字段里的形状就是
 * `done: false, overdue: false`（一件"到那天就发生"的事没有"做完"，
 * 也不该因为过了正日子被标红）。界面上要区分它，靠的是**标题本身**
 *（判据按"这一格里出现了这条倒数日的标题"来断言），不是靠一个只有代码知道的标记位。
 */
export type CalendarCellBar = {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  readonly overdue: boolean;
};

/**
 * 把当天**两个来源**折成"可见条 + 被折叠数"。
 *
 * 排序是**有内容的**：逾期 → 未做 → 已做。
 * 理由是格子只有 3 个位置，把已完成的排进来等于用掉一个"这天还有什么要做"的信号，
 * 而那个信号才是她翻日历时想要的东西。
 *
 * 🔴 倒数日排在"未做"那一档，且**永不进 `overdue`**：
 *   正日子过了就是过了，把它标红等于替用户审判一件他没做错的事（§2.7）。
 *
 * ⚠️ `hidden` 是**从数据算出来的**（`entries.length - visible.length`），
 * 不是界面数 DOM 数出来的 —— 后者会让"3 条 + +0"这种废话出现在界面上。
 *
 * @param events 这一天的倒数日。**必填**（没有就给 `[]`）——
 *   刻意不做成可选 prop：那条"默认值等于原值的可选参数"会把"宿主没接"
 *   伪装成"做完了"，而 typecheck 与既有门禁两边都不响。
 */
export function calendarCellBars(
  tasks: readonly Task[],
  events: readonly CountdownEvent[],
  today: LocalDate,
  date: LocalDate,
  max: number = MAX_CALENDAR_BARS,
): { readonly bars: readonly CalendarCellBar[]; readonly hidden: number } {
  const decorated: CalendarCellBar[] = tasks.map((task) => {
    const done = task.completedAt !== undefined;
    // 逾期 = 截止时间在今天之前**且还没做完**。已完成的不再算逾期 ——
    // 给一件做完的事标红是噪音，而红色在这个应用里只表示"要注意"（见 `calendarDayTone`）。
    return {
      id: task.id,
      title: task.title,
      done,
      overdue: !done && date < today,
    };
  });
  for (const event of events) {
    decorated.push({
      id: event.id,
      title: event.title,
      done: false,
      overdue: false,
    });
  }
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
 * 从当天的**两个来源**推出格子里点的颜色。
 *
 * 🔴 逾期用 `danger`：它是**需要被注意到**的状态，不是一种分类。
 * 而"全做完了"给 `subtle` 而不是 `plain` —— 两者在视觉上都"没有待办"，
 * 但"这天清空了"值得一个不同的档（与"这天本来就没安排"区分开）。
 *
 * ⚠️ 倒数日（第二个事件源，W6）只有两条影响，且**都不是红色**：
 *  · 它把"本来空着的一天"变成"有安排的一天"（`plain` → `primary`）——
 *    只有一条生日的那天不是"清空了"，把它画成 `subtle`（灰字、无点）
 *    等于对着用户说这天什么都没有；
 *  · 它**永不**把这天判成逾期。`danger` 说的是"有件事你没做"，
 *    而正日子过了不是用户做错的一件事（§2.7 那条"从不制造愧疚"）。
 *
 * 🔴 有倒计任务时**任务赢**：`pending.length > 0` 那两档不看事件 ——
 * 一格里既有逾期的活又有生日时，要被注意到的是前者。
 *
 * @param events 这一天的倒数日。**必填**，理由同 `calendarCellBars`。
 */
export function calendarDayTone(
  tasks: readonly Task[],
  events: readonly CountdownEvent[],
  today: LocalDate,
  date: LocalDate,
): CalendarDayTone {
  if (tasks.length === 0 && events.length === 0) return 'plain';
  const pending = tasks.filter((task) => task.completedAt === undefined);
  if (pending.length === 0) return events.length > 0 ? 'primary' : 'subtle';
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
 *
 * ⚠️ 「时间线」**不在这里**，而且永远不会：它不是日历的一档，是外壳的另一个视图，
 *   下拉里那一项点了是**跳转**（不写日历 store）。把它混进这个联合类型，
 *   就等于宣布"切到时间线也算一次档位切换"，而游标、选中、`stepCalendarCursor`
 *   全都要跟着替一个不存在的时间线编一套语义。判据在
 *   `apps/web/tests/calendar-view-family.spec.tsx`。
 */
export type CalendarViewKind = 'month' | 'week' | 'day' | 'year';

/**
 * 每一档**叫什么**（i18n 键名）。R17 收成这一份。
 *
 * 🔴 为什么原来要两份：web 的下拉写了一张 `{kind, key}[]`，移动端的切换器写了
 * 一张 `CalendarViewKind[]` 加一张「档位 → 键」的表 —— 三处共同回答同一个问题，
 * 而 R13 加年档时**三处都靠人记着改**。同形状的第三次就是 AGENTS §3.5 说的
 * "抽取的收尾动作是删掉旧的那份并加门禁"，这里补上那一步。
 *
 * 🔴 `Record<CalendarViewKind, …>` 不是随手选的类型，它就是守卫本身：
 * 往上面那个联合类型添一档而这里少一条 ⇒ **编译不过**（原先那条"兜底念成「日」"
 * 的三层三元表达式，移动端作者换成按键取值就是为了拿到这颗牙 —— 现在两端都拿到）。
 *
 * ⚠️ 这里存的是**关名，不是文案值**：共享层不许 `import '@heyta/i18n'`
 *   （会把第二份 React 拖进来），所以两个宿主仍然各自 `t()`，值只有一本表。
 */
export type CalendarViewLabelKey =
  | 'common.calendar.view.month'
  | 'common.calendar.view.week'
  | 'common.calendar.view.day'
  | 'common.calendar.view.year';

export const CALENDAR_VIEW_LABEL_KEYS: Record<CalendarViewKind, CalendarViewLabelKey> = {
  month: 'common.calendar.view.month',
  week: 'common.calendar.view.week',
  day: 'common.calendar.view.day',
  year: 'common.calendar.view.year',
};

/**
 * 下拉与切换器里的**顺序**：`month → week → day → year`，**年排在最后**。
 * 插在中间会读成"半年"（两端在 R13 之前各自表述过这条，理由只有一个）。
 *
 * 顺序与"有哪些档"是两件事，所以分成两个常量，但它们的**集合必须相同** ——
 * 那条一致判据在 `packages/ui/tests/calendar-view-step.spec.ts`，它从这两份共享事实
 * 自己推导，不在测试里再抄一份四档字面量（那会是第四份抄件）。
 */
export const CALENDAR_VIEW_ORDER: readonly CalendarViewKind[] = ['month', 'week', 'day', 'year'];

/**
 * 游标走 **N 段**：月档一段 = 一个月，周档一段 = 一整周（7 天），
 * 日档一段 = 一天，年档一段 = **一整年（12 个月）**。
 *
 * 🔴 为什么单独成一个函数，而不是"工具栏里写一遍、滚轮里再写一遍"：
 *   这两处都在回答同一个问题 ——「`>` 或滚一格之后，我在看哪一段」。
 *   两份实现的漂移形状是"点箭头翻一周、滚轮翻一月"，而两边各自都"看着对"。
 *   （`addMonths` / `addDays` 本身仍在 `@heyta/domain` —— 这里只决定"一段多长"。）
 *
 * ⚠️ 日档那一支同时是**横向拖拽**的落点：手势只算"往哪边、几格"，
 *   走多远仍然由这里决定（见 §9.12 —— 拖拽与滚轮/箭头必须共用这一份）。
 *
 * 🔴 年档那一支**必须是显式 `case`**。这里的 `default` 是"月"，所以漏写年档不会报错、
 *   不会编译不过，只会**安静地按月走**：用户在年视图里点 `›`，画面上的 12 个月
 *   一张都没换（因为它们还是同一年），而标题也没变 —— 症状是"这一档坏了、点了没反应"。
 *   这正是 `CalendarToolbar.tsx` 那段注释警告的形状，也是本批变异臂要抓的那一支。
 */
export function stepCalendarCursor(
  view: CalendarViewKind,
  cursor: LocalDate,
  segments: number,
): LocalDate {
  switch (view) {
    case 'week':
      return addDays(cursor, segments * DAYS_PER_WEEK);
    case 'day':
      return addDays(cursor, segments);
    case 'year':
      return addMonths(cursor, segments * MONTHS_PER_YEAR);
    default:
      return addMonths(cursor, segments);
  }
}

/**
 * 「要让 `date` 这一天天可见，游标该放哪」—— **两端只此一份**。
 *
 * 🔴 它原来住在 `apps/web` 的日历 store 里（那里的注释写着"只此一处"，
 *   意思是"web 的三个动作共用一处"）。移动端补上档位入口之后，它变成了
 *   **两个宿主都要做的同一件事** —— 那就是 AGENTS §3.5 说的"同形状的第二次"，
 *   而它的必然下场是：一边把游标归到月首、另一边不归，
 *   于是同一个日子在两端显示成不同的月份/不同的选中框。
 *
 * 周档、日档与**年档**返回 `date` 本身：游标的约定是"这一段里的任意一天"，
 * `weekGrid` 会自己回到周一、`yearGrid`（即 `monthsOfYear`）会自己回到 1 月，
 * 而日档那一段只有一天。
 * ⚠️ 月档是这一规则的**唯一例外**（归到月首），因为它的游标在界面上被读成"哪个月"，
 *   不归一的话"选了 10 月 30 日"会让月份翻到 11 月（月格里 30 日是补白格，
 *   属于下个月的视线范围）。
 */
export function calendarCursorFor(view: CalendarViewKind, date: LocalDate): LocalDate {
  return view === 'month' ? startOfMonth(date) : date;
}

/**
 * 游标走到 `cursorDate` 之后，**选中的那天**该是什么。
 *
 * 🔴 日档里两者必须一起走。这一档界面上有**三个**消费者：小时轴读游标，
 *   侧栏迷你月历的高亮与「说一句话落进选中那格」的 `anchorDate` 读选中。
 *   只动游标的症状不是崩溃，是**安静地各指一天**（轴翻到 10-05、侧栏还圈着 10-03），
 *   而没有任何一层会报错 —— 判据见 §9.12 与变异臂 Z。
 *   月/周/年档没有这个问题：那里"显示的段"和"选中的一天"本来就是两件事，
 *   所以**不许**跟着动（跟着动会让用户点一次箭头就换掉他要写任务的那一天）。
 */
export function calendarSelectedForCursor(
  view: CalendarViewKind,
  cursorDate: LocalDate,
  selected: LocalDate,
): LocalDate {
  return view === 'day' ? cursorDate : selected;
}

/**
 * 年视图一行摆几张月卡 —— **只取能整除 12 的那些**。
 *
 * 🔴 为什么"整除"是硬规矩而不是好看：12 张卡摆 5 列会剩两张孤零零挂在最后一行，
 *   而那块空白在界面上读起来像"这一年只有 12 个月里的 10 个月有东西、剩下两格坏了"。
 *   这不是审美：日历上任何一处"看着像缺了什么"都会被当成数据没了 ——
 *   本仓为这一类症状记过一整页（`labels.footnote` 存在的理由就是它）。
 *   所以候选只有 1 / 2 / 3 / 4 / 6 / 12（12 的约数），取**装得下的那个里最大的**。
 *
 * ⚠️ 入参 `fits` 是宿主量出来的"这一宽能塞几张"（见 `CalendarYearBoard` 文件头：
 *   视口是壳才有的概念，共享层不猜，与 `QuadrantBoard` 的 `twoColumns` 同一条纪律）。
 *   给它 `0` 或负数会得到 1 —— 那对应"窄到一张都放不下"，此时也要有一张能看，
 *   而不能渲染出一个空的年（空的年视图与"这一档没接上"在界面上又是同一副长相）。
 */
export function calendarYearColumns(fits: number): number {
  let columns = Math.floor(fits);
  if (!Number.isFinite(columns) || columns < 1) return 1;
  if (columns > MONTHS_PER_YEAR) columns = MONTHS_PER_YEAR;
  while (columns > 1 && MONTHS_PER_YEAR % columns !== 0) columns -= 1;
  return columns;
}

/**
 * 点年档里的一张月卡之后，界面状态该长成什么样。
 *
 * 🔴 它是**产品语义**，所以在这里，不在某个壳的 store 里（AGENTS §3.5）：
 *   两个宿主都要回答"点月卡去哪"，各写一遍的下场是一边切到月档、另一边只挪游标，
 *   而两边看着都像是"年档的钻取"。这里给的形状是**只返回要改的那几项** ——
 *   `selected` 刻意不在返回值里，所以"选中那天不动"这条在**类型上**成立，
 *   不靠调用方记得别写它。
 *
 * ⚠️ 游标走 `calendarCursorFor('month', ...)`（同一条归一化规则），不在这里
 *   `startOfMonth` 一遍：两条规则各指一次月首，将来一边改成"周首"就是漂移。
 */
export function calendarMonthDrill(monthFirstDay: LocalDate): {
  readonly view: 'month';
  readonly cursor: LocalDate;
} {
  return { view: 'month', cursor: calendarCursorFor('month', monthFirstDay) };
}

// ─────────────────────────────────────────────────────────────────────────
// 日视图（R11 批四）：一天怎么摊开
// ─────────────────────────────────────────────────────────────────────────

/** 小时轴的行数。**24 是"一天"的定义**，不是可调的显示参数。 */
export const HOURS_IN_DAY = 24;

/**
 * 日视图的分桶结果：**顶部那条"全天" + 24 个小时格**。
 *
 * 🔴 这个形状是产品负责人 2026-10-03 用一张滴答日视图截图拍的板，
 *   它同时回答了我先前登记的那个二选一（"小时网格在当前模型下是空的"
 *   vs "把当天清单放大"）：**两样都要** —— 没有时刻的落在顶部那条带里，
 *   有时刻的才挂到小时格上。所以"轴上大多是空的"**不是缺陷**，
 *   是这一档与竞品共同的形状（那张参考图里也是五条全在顶部带、轴上只有今天线）。
 */
export interface CalendarDayBuckets {
  /** 当天**没有时刻**（本地 0 点整）或没有截止但属于这一天的任务，按原顺序。 */
  readonly allDay: readonly Task[];
  /** 长度恒为 `HOURS_IN_DAY`；第 h 项 = 落在 h 点的那些任务（可能为空数组）。 */
  readonly hours: readonly (readonly Task[])[];
  /**
   * 轴上挂到了东西的小时数。
   *
   * 🔴 它存在的原因是**界面上要说这句话**：整轴空白时，用户需要知道
   *   "这一天没有定时任务"与"这一档没接上"是两件事（后者本仓登记过一整页）。
   */
  readonly timedCount: number;
}

/**
 * 把一组任务分到"全天带 / 某个小时格"。
 *
 * 🔴 **"有没有时刻"复用时间线那一份判定 `isAllDayMs`，不在这里另写一遍**
 *   （`packages/ui/src/timeline/board-model.ts`）—— 两个 seam 各自判"0 点整"
 *   的漂移形状是"时间线画在正午、日视图画在 00:00 那一行"，
 *   而两边看起来都"合理"。
 *
 * ⚠️ 只取 `dueDate`：`startDate` 是**时间线排期**的语义（ADR-0043），
 *   与"什么时候到期"互不推导，塞进同一根轴等于替用户发明关系。
 */
export function calendarDayBuckets(
  tasks: readonly Task[],
  day: LocalDate,
): CalendarDayBuckets {
  const allDay: Task[] = [];
  const hours: Task[][] = Array.from({ length: HOURS_IN_DAY }, () => []);
  let timedCount = 0;
  for (const task of tasks) {
    if (task.dueDate === undefined || toLocalDate(task.dueDate) !== day) continue;
    if (isAllDayMs(task.dueDate)) {
      allDay.push(task);
      continue;
    }
    const hour = new Date(task.dueDate).getHours();
    const bucket = hours[hour];
    if (bucket === undefined) continue; // `noUncheckedIndexedAccess`：越界即跳过
    if (bucket.length === 0) timedCount += 1;
    bucket.push(task);
  }
  return { allDay, hours, timedCount };
}

/**
 * 日档小时轴那一行的刻度（`9:00`）。
 *
 * 🔴 **复用时间线那一份 `formatClock`**，不在日历里再拼一次 `HH:mm`：
 *   两根轴在同一个产品里说的是同一件事（几点），各拼一遍的漂移形状是
 *   "日视图写 `09:00`、甘特那条写 `9:00`" —— 同一屏两种时刻写法，而两边都不报错。
 *   ⚠️ 于是小时**不补零** —— 这是**跟着已有那根轴**的代价，不是这里的选择；
 *      "0 点那一行的字比 23 点短"由**列宽**吸收（见 `CalendarDayBoard` 的 `hourLabel`），
 *      而不是在这里给数字补一个 0。
 *
 * ⚠️ 宿主想要 12 小时制（`9 AM`）就在自己的 `labels.hourLabel` 里给一条别的 ——
 *   那条留在契约里就是为了这个，本层不替英文/中文拍"该用几小时制"。
 */
export function calendarHourMark(hour: number): string {
  return formatClock(hour * MINUTES_PER_HOUR);
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
  /**
   * 日档的读屏箭头名（**标题不需要新的** —— 复用已有的 `dayTitle`，
   * 它就是「10月3日 星期六」这一句，而日档说的正是这一天）。
   *
   * ⚠️ 可选的理由与 `prevWeek` 同一条：新标签一律可选，否则两端同时红（§9.1）。
   */
  readonly prevDay?: string;
  readonly nextDay?: string;
  /**
   * 年档的标题（「2026年」）。**可选**，理由与 `weekTitle` 同一条（新标签一律可选，§9.1）。
   *
   * 🔴 但它**不能被 `monthTitle` 顶掉** —— 年档摊开的是整年 12 个月，标题却写
   *   「2026年10月」会把人指回某一个格子，而那一格子在 12 张卡里并不更显眼。
   *   所以缺省时的降级是**故意难看**的（月份照旧），配合判据"年档标题里出现的是年、
   *   不是某一个月"，让漏传在测试里响亮地红，而不是在界面上安静地误导。
   */
  readonly yearTitle?: (date: LocalDate) => string;
  readonly prevYear?: string;
  readonly nextYear?: string;
  /**
   * 年档里那张月卡顶上的**短月份名**（「10月」/ `Oct`）。
   *
   * 🔴 刻意是**函数**而不是 12 个字符串的数组：数组会变成"词条表的一份抄件"，
   *   而月份名这个数据在仓里**已经有一份**（时间线那套 `labels.monthNames`，
   *   两个宿主都从同一批词条 key 建）。宿主把它按 `LocalDate` 现取现说，
   *   这一层就只多了一个"怎么问"的形状，没有多第二份"是什么"。
   *
   * ⚠️ 不给时降级成 `monthTitle`（「2026年10月」）—— 长，但读得出，且不编造。
   */
  readonly yearMonthTitle?: (date: LocalDate) => string;
  /**
   * 日档顶部那条带的名字（「全天」）。**可选**：不给就不画那一句标签，
   * 带本身照旧 —— 与 `weekNumber` 同一纪律（新标签一律可选，§9.1）。
   */
  readonly dayAllDay?: string;
  /**
   * 「全天」那条带**自己**的空态。
   *
   * 🔴 不能复用 `dayEmpty`（"这一天没有到期的任务"）：R14 之后一条任务可以
   *   定在 16:00 —— 那时带是空的而**这一天不空**，同屏就会出现
   *   "上面说没有到期的任务、下面 20 行挂着一条到期的任务"。
   *   与 `dayNoTimed` 是同一条立场的两半：每块区域只说自己那一份。
   * 可选（§9.1：新标签一律可选，带本身照旧），不给时退回 `dayEmpty`。
   */
  readonly dayAllDayEmpty?: string;
  /**
   * 小时轴整列空白时界面上要说的那一句。
   *
   * 🔴 这条不是装饰：**"这一天没定到具体时刻"与"这一档没接上数据"在界面上长得一样**，
   *   而后者本仓为它记过一整页账。见 `CalendarDayBoard` 文件头。
   */
  readonly dayNoTimed?: string;
  /**
   * 小时轴那一行的时刻名（「09:00」）。
   *
   * ⚠️ 刻意是**函数**而不是 `HH:mm` 的字面量拼接：阿拉伯数字与冒号在所有语言里
   *   同形，但**前导零与上下午**不是（`9 AM` / `09:00`），而这里恰好是个语言问题。
   *   不给时那一格留空 —— 轴仍然可读，因为任务条自带时刻文案。
   */
  readonly hourLabel?: (hour: number) => string;
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
  | 'monthTitle'
  | 'prevMonth'
  | 'nextMonth'
  | 'backToToday'
  | 'weekTitle'
  | 'prevWeek'
  | 'nextWeek'
  | 'dayTitle'
  | 'prevDay'
  | 'nextDay'
  | 'yearTitle'
  | 'prevYear'
  | 'nextYear'
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

/**
 * 日历的**第二个事件源**（W6）：把倒数日按"发生日"分到 `[from, to]` 这段格子里。
 *
 * 🔴 它与 `groupTasksByDueDate` 不是"同一件事写两遍"：分日归属的**依据**不同 ——
 * 任务看它自己的 `dueDate`（一个绝对时刻），倒数日看"这一条规则/锚点在这段时间的
 * 哪几天落地"（可以一年两次，也可以一次都没有）。把两者压成同一个函数，
 * 要么给倒数日发明一个它没有的 `dueDate`，要么让农历 `both` 档丢掉第二个正日子。
 *
 * ⚠️ 区间枚举本身在 `@heyta/domain`（`eventOccurrencesInRange`）—— 这里不重新判断
 * 农历、闰月档位或规则解析（AGENTS §3.5：业务语义不许出现在摆放层）。
 * 归档与已删除的条目也不由这里挡：宿主传进来的就该是 `aliveEvents` 的结果，
 * 两道过滤各判一次，就会有"归档的生日还在日历上"这种两边都绿的状态。
 */
export function groupEventsByOccurrence(
  events: readonly CountdownEvent[],
  from: LocalDate,
  to: LocalDate,
): Map<LocalDate, CountdownEvent[]> {
  const map = new Map<LocalDate, CountdownEvent[]>();
  if (to < from) return map;
  for (const event of events) {
    for (const date of eventOccurrencesInRange(event, from, to)) {
      const list = map.get(date);
      if (list === undefined) map.set(date, [event]);
      else list.push(event);
    }
  }
  return map;
}

/**
 * 把倒数日分到**一屏网格**覆盖的那段日子里。
 *
 * 🔴 它是 `groupEventsByOccurrence` 之上的唯一一层"这段是哪几天"：
 * 板子（月/周两档 42 格或 7 格）与 Web 侧栏那张迷你月历**共用这一份**。
 * 各自推一遍区间的下场是某一处忘了补白格 —— 症状是"点上月 30 号，主区有那条生日、
 * 侧栏那颗点没有"，而两处单测都数得出自己的格子数。
 *
 * @param weeks 屏幕上的那些行（`monthGrid` / `weekGrid` 的原样输出）。
 * @param include 额外要含进来的一天（月/周档传 `selected`）：`byDate` 那份是从**全量任务**
 *   建的，选中哪天都有它的任务，事件这一份若只按网格枚举，选中落在网格外时
 *   就会出现"格子那套数、下面那块另一套数"。
 */
export function groupEventsForGrid(
  events: readonly CountdownEvent[],
  weeks: readonly (readonly MonthGridCell[])[],
  include?: LocalDate,
): Map<LocalDate, CountdownEvent[]> {
  let from: LocalDate | undefined;
  let to: LocalDate | undefined;
  for (const week of weeks) {
    for (const cell of week) {
      if (from === undefined || cell.date < from) from = cell.date;
      if (to === undefined || cell.date > to) to = cell.date;
    }
  }
  if (include !== undefined) {
    if (from === undefined || include < from) from = include;
    if (to === undefined || include > to) to = include;
  }
  if (from === undefined || to === undefined) return new Map();
  return groupEventsByOccurrence(events, from, to);
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
