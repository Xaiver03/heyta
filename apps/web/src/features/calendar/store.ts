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
import type { CalendarViewKind } from '@heyta/ui';

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
  /**
   * 公共事实（调休 / 补班）覆盖表的**变更计数**（W4b）。
   *
   * 🔴 为什么是计数而不是布尔：覆盖表住在 `@heyta/domain` 的模块级状态里，React 看不见它。
   * 每装一次 / 每拉到新版都要让那 42 个格子重算，而 `CalendarView` 把 `dayMarker`
   * 的**函数身份**挂在这个数上 —— 于是无论格子有没有被 memo 包住都会重读 `adjustmentOn()`。
   * 布尔的坏法是"第二次装成同样的值 ⇒ 不触发"，而"部署方改了公告又改回来"正是这种第二次。
   */
  publicFactsEpoch: number;
}

interface CalendarViewActions {
  /**
   * 换月。参数是**该月里的任意一天**，与共享板 `onCursorChange` 给的东西一致。
   *
   * ⚠️ 只动 `cursor`，**不动 `selected`** —— 翻去看别的月，不等于改选中的那天。
   * 侧栏的两个箭头自己调 `addMonths(cursor, ±1)` 再把结果交进来：
   * 月份算术是领域层的，这里不替它算第二遍。
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
  /** 公共事实覆盖表变了 —— 让日历重算（见 `publicFactsEpoch`）。 */
  bumpPublicFactsEpoch: () => void;
}

function idsOf(scope: TaskScope, kind: ScopeKind): readonly string[] {
  return kind === 'project' ? scope.projectIds : scope.tagIds;
}

/**
 * 「要让 `date` 这一天天可见，游标该放哪」—— **只此一处**。
 *
 * 🔴 这条规则被 `selectDay` / `goToToday` / `setView` 三个动作共用。写成三份的
 *   下场本文件已经记过一次（"两处各写一遍迟早有一边忘"），而这次是三份。
 *   周档返回 `date` 本身：游标的约定是"这一段里的任意一天"，
 *   而 `weekGrid` 会自己回到周一 —— 不需要在这里算周首。
 */
function cursorFor(view: CalendarViewKind, date: LocalDate): LocalDate {
  return view === 'week' ? date : startOfMonth(date);
}

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
  publicFactsEpoch: 0,

  setCursor: (date) => {
    set({ cursor: date });
  },

  selectDay: (date) => {
    set((state) => ({ selected: date, cursor: cursorFor(state.view, date) }));
  },

  goToToday: (today) => {
    set((state) => ({ selected: today, cursor: cursorFor(state.view, today) }));
  },

  setView: (view) => {
    set((state) => ({ view, cursor: cursorFor(view, state.selected) }));
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

  bumpPublicFactsEpoch: () => {
    set((state) => ({ publicFactsEpoch: state.publicFactsEpoch + 1 }));
  },
}));
