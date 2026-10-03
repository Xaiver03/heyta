/**
 * 日历页的**界面状态**（Web 壳）
 * ==============================
 *
 * 滴答式外壳把日历拆成两列：左边一列是「迷你月历 + 范围勾选」，右边是月历与
 * 当天清单。两列**必须共享同一个 cursor / selected** —— 否则在侧栏翻到 11 月，
 * 主区还停在 10 月，而两边的圆点各指各的。所以这份状态不能留在 `CalendarView`
 * 的 `useState` 里（它只能被主区看见），也不能提到 `App.tsx`（那会让外壳
 * 长出一份只服务一个视图的状态）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这里**没有**任何"哪些任务算在范围内"的判断
 *
 * 那条是产品语义，住在 `@heyta/domain` 的 `scopeTasks`（理由见那个函数）。
 * 本文件只存**用户勾了什么**，以及"翻月/选日"这两件事怎么联动。
 *
 * ⚠️ 与 `store.filter`（任务页的筛选）**刻意不共用**：任务页是**单选**判别联合
 * （`TaskFilter`），日历侧栏是**多选**复选框。把两者压成一个形状会得到
 * "既不是单选也不是多选"的第三种，而它的症状是勾第二个把第一个顶掉。
 *
 * ⚠️ 这份状态**不落盘**：它是"这一屏看到哪儿"，不是偏好。刷新回到今天与
 * 全范围，是滴答同款行为，也是用户重新打开应用时预期的起点。
 */

import { create } from 'zustand';

import {
  FULL_SCOPE,
  startOfMonth,
  toLocalDate,
  type LocalDate,
  type TaskScope,
} from '@heyta/domain';
import {
  calendarCursorFor,
  calendarMonthDrill,
  calendarSelectedForCursor,
  type CalendarViewKind,
} from '@heyta/ui';

type ScopeKind = 'project' | 'tag';

interface CalendarViewState {
  /** 正在显示的月份（用该月里任意一天表示，与共享板同一个约定）。 */
  cursor: LocalDate;
  /** 选中的那一天。 */
  selected: LocalDate;
  scope: TaskScope;
  /**
   * 主区看的是**一个月**还是**一周**。
   *
   * 🔴 它住在界面状态里而不是共享板里，是因为**这一屏有三个消费者**：
   *   主区的板、页头那个档位下拉、以及滚轮翻月那条手势（`useWheelMonthNav`）。
   *   留在板内部 `useState` 的话，后两个看不见它 —— 那正是 R11 批二
   *   把工具栏搬进页头时踩过的形状（"两份状态"的症状是滚轮翻月而标题不动）。
   */
  view: CalendarViewKind;
  /**
   * 「往选中那天加一条」那行输入框开着没有（R11 批五）。
   *
   * ⚠️ 它和 `view` 一样住在 store 里，因为**开关在页头、输入框在主区** ——
   *   用 `useState` 就得把它提到 `App.tsx`，那等于让外壳长出一份
   *   只服务一个视图的状态（本文件文件头记过这个理由）。
   */
  captureOpen: boolean;
}

interface CalendarViewActions {
  /**
   * 换月。参数是**该月里的任意一天**，与共享板 `onCursorChange` 给的东西一致。
   *
   * ⚠️ 月/周档**只动 `cursor`，不动 `selected`** —— 翻去看别的月，不等于改选中的那天。
   * 侧栏的两个箭头自己调 `addMonths(cursor, ±1)` 再把结果交进来：
   * 月份算术是领域层的，这里不替它算第二遍。
   * 🔴 **日档是例外**（游标即那一天，两个名字必须同一天），实现里写了原因。
   */
  setCursor: (date: LocalDate) => void;
  /**
   * 选某一天。
   *
   * 🔴 必须**同时把月份跟过去**：点到迷你月历里的补白格（上月 30 号 / 下月 2 号）
   * 是合法意图，只改 `selected` 会让主区列着 10 月的任务、侧栏圈着 9 月的格子。
   * 这条与共享板 `pickDay` 是同一条纪律，两处各写一遍迟早有一边忘。
   */
  selectDay: (date: LocalDate) => void;
  /** 「回到今天」：迷你月历的 ○ 与主区的按钮走同一条路径。 */
  goToToday: (today: LocalDate) => void;
  /**
   * 换档位。**换的那一瞬间要把游标搬到"新档位看得见 selected 的地方"**：
   * 月档游标是"那个月的 1 号"，周档游标是"那一周里的任意一天"。
   * 不搬的症状：选了 10-25 再切到周视图，画面停在月初那一周，
   * 而下面的清单列着 10-25 —— 共享板 `pickDay` 那条纪律的反面。
   */
  setView: (view: CalendarViewKind) => void;
  /**
   * 从年档点进某一个月（R13）。**要改什么由共享层决定**（`calendarMonthDrill`），
   * 这里只负责把它写进状态 —— 包括"选中那天不动"那一条：那个函数返回的对象里
   * 根本没有 `selected`，所以不是"我记得别改"。
   */
  drillIntoMonth: (monthFirstDay: LocalDate) => void;
  /** 开/关那一行输入。开着再点 `+` 就是收起 —— 一屏只有一行输入框。 */
  toggleCapture: () => void;
  /** 勾/去掉一条清单或一个标签。 */
  toggleScopeItem: (kind: ScopeKind, id: string) => void;
  /**
   * 分组头的**总勾**：整组已全选 ⇒ 清空这一组，否则整组全选。
   * `ids` 由宿主给（"这一组现在有哪些"是数据问题，不是这里的判断）。
   */
  setScopeGroup: (kind: ScopeKind, ids: readonly string[]) => void;
  /** 「所有」那一行：清掉全部勾选 = 显示全部。 */
  resetScope: () => void;
}

function idsOf(scope: TaskScope, kind: ScopeKind): readonly string[] {
  return kind === 'project' ? scope.projectIds : scope.tagIds;
}

/**
 * 🔴 游标规则（"要让某天可见，游标放哪"）与日档那条"游标带走选中"**不在本文件**：
 *   它们在 `@heyta/ui` 的 `calendar/model.ts`（`calendarCursorFor` /
 *   `calendarSelectedForCursor`）。这里原来有一份本地 `cursorFor`，
 *   移动端补上档位入口时就要抄第二份 —— 已删，两端共用那一份（AGENTS §3.5）。
 */
function withIds(scope: TaskScope, kind: ScopeKind, ids: readonly string[]): TaskScope {
  return kind === 'project' ? { ...scope, projectIds: ids } : { ...scope, tagIds: ids };
}

export const useCalendarViewStore = create<CalendarViewState & CalendarViewActions>((set) => ({
  // ⚠️ 这里读一次时钟是**给界面播种**，不是业务判断 —— 领域层的
  // "now 显式传入、不在函数里读时钟"那条纪律针对的是判据，不是首屏渲染。
  cursor: startOfMonth(toLocalDate(Date.now())),
  selected: toLocalDate(Date.now()),
  scope: FULL_SCOPE,
  view: 'month',
  captureOpen: false,

  setCursor: (date) => {
    // 🔴 游标怎么归一、选中跟不跟着走，两条规则都在 `@heyta/ui`（本文件不再抄一份）。
    //   日档里"游标必须带走选中"的理由与它的判据写在那里（`calendarSelectedForCursor`），
    //   症状是**安静地各指一天**：轴翻到 10-05、侧栏还圈着 10-03、新任务写进了 10-03。
    //   判据：`apps/web/tests/calendar-day-view.spec.tsx`（含变异臂 Z）。
    set((state) => ({
      cursor: calendarCursorFor(state.view, date),
      selected: calendarSelectedForCursor(state.view, date, state.selected),
    }));
  },

  selectDay: (date) => {
    set((state) => ({ selected: date, cursor: calendarCursorFor(state.view, date) }));
  },

  goToToday: (today) => {
    set((state) => ({ selected: today, cursor: calendarCursorFor(state.view, today) }));
  },

  setView: (view) => {
    set((state) => ({ view, cursor: calendarCursorFor(view, state.selected) }));
  },

  drillIntoMonth: (monthFirstDay) => {
    set(() => ({ ...calendarMonthDrill(monthFirstDay) }));
  },

  toggleCapture: () => {
    set((state) => ({ captureOpen: !state.captureOpen }));
  },

  toggleScopeItem: (kind, id) => {
    set((state) => {
      const current = idsOf(state.scope, kind);
      const next = current.includes(id)
        ? current.filter((existing) => existing !== id)
        : [...current, id];
      return { scope: withIds(state.scope, kind, next) };
    });
  },

  setScopeGroup: (kind, ids) => {
    set((state) => {
      const current = idsOf(state.scope, kind);
      const allSelected = ids.length > 0 && ids.every((id) => current.includes(id));
      return { scope: withIds(state.scope, kind, allSelected ? [] : [...ids]) };
    });
  },

  resetScope: () => {
    set({ scope: FULL_SCOPE });
  },
}));
