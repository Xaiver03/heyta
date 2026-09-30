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

import { toLocalDate, type LocalDate, type Task } from '@heyta/domain';

import type { TaskListLabels } from '../task-list/TaskList.js';

/**
 * 一个格子里最多画几个点。
 *
 * 多于此只会糊成一片色块 —— 那时"这天有 14 件事"和"有 3 件事"看起来一样，
 * 用户得到的信息反而更少。点只回答"这天有没有事、大致什么状态"，
 * 具体有哪几件事由下面的当日列表回答。
 */
export const MAX_CALENDAR_DOTS = 3;

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
  readonly prevMonth: string;
  readonly nextMonth: string;
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
