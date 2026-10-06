/**
 * 习惯 store —— 打卡 / 撤销 / 连续天数（Web 壳）
 * ==============================================
 *
 * 为什么**不能**直接用 Super Productivity 的 SimpleCounter：
 * SP 的计数器只有"加一/减一"，没有目标值、单位、计划频率、补打卡窗口。
 * 而"连续天数"必须有**计划日**概念才能算对 —— 一个"每周三次"的习惯，
 * 周一、周三、周五打卡就是连续，中间的周二不该算断。
 * 没有 frequency 的计数器算不出这个，所以这部分是自研（见计划 3.4）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件被**改造过两次**，两次都是为了消掉"同一件事的第二份实现"
 *
 * **第一次**：它原先自己拼 `HABIT` / `HABIT_LOG` 的 op（4 处）。
 * 这些全是产品语义，现在全部委托给 `@heyta/app-host` 的 `createHabitActions`：
 *
 *   - 打卡记录的 id = `${habitId}:${date}`（幂等性的来源）
 *   - "今天已经打过卡了"的判定
 *   - 打卡值缺省落在 `habit.target` 上
 *
 * **第二次（M3 第七刀 habits）**：两个投影 `selectHabitProgress` /
 * `selectHeatmap` 原先住在这里，mobile 一行都没有。现在它们的**实现**搬进了
 * `@heyta/ui` 的 `habits/model.ts`（两端唯一一份），这里只剩**薄转发** ——
 * 因为 `apps/web/tests/stores.spec.ts` 与 `motivation-view.spec.tsx`
 * 是按这两个名字断言 web 行为的（那两份测试不在本刀白名单，不能改）。
 *
 * ⚠️ 转发里**一个判断都不能写**：写一个，web 就又有了一份投影。
 * 判据：本文件里不出现 `addDays` / `computeStreak` / `describeHabitResilience`
 * 之类 —— 只调用共享实现。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  createHabitActions,
  habitGrowth,
  type ActionContext,
  type NewHabitFields,
} from '@heyta/app-host';
import type {
  CategorySlot,
  Habit,
  HabitFrequency,
  HabitGoalType,
  HabitIcon,
  HabitLog,
  LocalDate,
} from '@heyta/domain';
import { habitHeatmap, toHabitProgressRows, type HabitProgressRow } from '@heyta/ui';
import { create } from 'zustand';

import { currentState, dispatchIntent, onEngineChange } from '../../lib/oplog.js';

interface HabitState {
  habits: Habit[];
  logs: HabitLog[];
  /** 🔴 回收站那一路（有墓碑且未彻底删除）。判据与顺序在领域层，这里不写。 */
  trashed: Habit[];
  error?: string;

  addHabit: (name: string, over?: NewHabitFields) => Promise<void>;
  /** 打卡。已打卡时是幂等空操作（不产生重复 log）。 */
  checkIn: (habitId: string, date?: LocalDate, value?: number) => Promise<void>;
  /** 撤销打卡。 */
  undoCheckIn: (habitId: string, date?: LocalDate) => Promise<void>;
  deleteHabit: (habitId: string) => Promise<void>;
  /**
   * 从回收站还原习惯。返回 `false` = 它本来不在回收站里（没有写 op）；
   * 已被彻底删除的那条由动作层**抛错**，界面必须接住并说出来（不许 `void` 掉）。
   */
  restoreHabit: (habitId: string) => Promise<boolean>;
  /**
   * 彻底删除一条习惯：只追加 `purgedAt` 标记，打卡记录一条都不动。
   *
   * 返回 `false` = 它早就被彻底删过（这一句没有写 op）。
   */
  purgeHabit: (habitId: string) => Promise<boolean>;
  /**
   * 改名。**不许**用"删了重建"代替它 —— 打卡记录按 `(习惯 id, 日期)` 寻址，
   * 重建会换 id，于是那条习惯的历史整个清零（`app-host` 侧同一条理由）。
   */
  renameHabit: (habitId: string, name: string) => Promise<void>;
  /** 分类色槽位（1–8），`undefined` 表示清除。存槽位号，不存颜色本身。 */
  setHabitColor: (habitId: string, slot?: CategorySlot) => Promise<void>;
  /**
   * 行首图标（闭集 key）。`undefined` 表示清除 = 回到 `deriveHabitIcon(id)` 派生的那个，
   * **不是**"没有图标"。非法 key 由动作层 `throw`。
   */
  setHabitIcon: (habitId: string, icon?: HabitIcon) => Promise<void>;
  /**
   * 改**频次**（工单 H5）。`undefined` = 清除，回到"每天"。
   *
   * 🔴 这一米存在的全部理由：判定侧（`isScheduledOn` → `computeStreak`）**早就按计划日
   * 数连续天数**了，而在本转发出现之前，全仓库没有任何一条路径能把 `frequency` 写进去 ——
   * 那套口径对界面是不可达的（§7 第 195 条"字段看起来有功能"那个形状）。
   *
   * ⚠️ 校验与归一**不在这里**：非法值 `throw`、`interval:1` 与"七天全选"归一成 `daily`，
   * 全在 `app-host` 的 `normalizeHabitFrequency`（界面里一个判断都不写）。
   */
  setHabitFrequency: (habitId: string, frequency?: HabitFrequency) => Promise<void>;
  /**
   * 改习惯的**目标**（数值 / 单位 / 达成口径）。
   *
   * 🔴 **失败会 `throw`**（目标非法 / 找不到习惯）—— 由界面接住并说清楚，
   * 不许吞成静默空操作（症状会是"用户以为改好了，数字没变"）。
   */
  setHabitGoal: (
    habitId: string,
    goal: { target?: number; unit?: string; goalType?: HabitGoalType },
  ) => Promise<void>;
}

/** 与任务 / 专注 / 清单 store 同一个形状。只含两个函数引用，不含任何判断。 */
const actionContext: ActionContext = {
  dispatch: dispatchIntent,
  getState: currentState,
};

const habitActions = createHabitActions(actionContext);

export const useHabitStore = create<HabitState>(() => ({
  habits: [],
  logs: [],
  trashed: [],

  addHabit: async (name, over) => {
    // 交互决策：空名字什么都不做（动作层对空名字抛错）。
    if (name.trim() === '') return;

    await habitActions.createHabit(name, over);
    refresh();
  },

  checkIn: async (habitId, date, value) => {
    // 幂等判定在动作层 —— 这里不查"今天打过卡没有"（那是产品语义）。
    await habitActions.checkIn(habitId, date, value);
    refresh();
  },

  undoCheckIn: async (habitId, date) => {
    await habitActions.undoCheckIn(habitId, date);
    refresh();
  },

  renameHabit: async (habitId, name) => {
    // 交互决策，不是数据决策：按了空回车就该什么都不发生。
    // 空名字的**校验**在动作层（它会抛错），这里只拦"用户其实没想改"。
    if (name.trim() === '') return;
    await habitActions.renameHabit(habitId, name);
    refresh();
  },

  deleteHabit: async (habitId) => {
    // 软删除。打卡记录**不**级联删除 —— 撤销删除后历史还在。
    await habitActions.removeHabit(habitId);
    refresh();
  },

  restoreHabit: async (habitId) => {
    const changed = await habitActions.restoreHabit(habitId);
    refresh();
    return changed;
  },

  purgeHabit: async (habitId) => {
    // 不 catch：不可逆动作被拒绝（例如它已被别处恢复）必须让界面说给用户。
    const purged = await habitActions.purgeHabit(habitId);
    refresh();
    return purged;
  },

  setHabitGoal: async (habitId, goal) => {
    // 不 catch：拒绝原因要一路冒到界面去说清楚（见接口注释）。
    await habitActions.setHabitGoal(habitId, goal);
  },

  setHabitIcon: async (habitId, icon) => {
    // 闭集校验在动作层：这里不许出现"不认识就当默认"的兜底（那会把用户的
    // 一次点击悄悄吞掉，症状是"点了没反应"）。
    await habitActions.setHabitIcon(habitId, icon);
    refresh();
  },

  setHabitFrequency: async (habitId, frequency) => {
    // 不 catch：非法频次（`每 0 天` / 空的日子集合）必须让界面说给用户，
    // 而不是变成一条"点了没反应"。归一（`interval:1`→每天、七天全选→每天）在动作层。
    await habitActions.setHabitFrequency(habitId, frequency);
    refresh();
  },

  setHabitColor: async (habitId, slot) => {
    await habitActions.setHabitColor(habitId, slot);
    refresh();
  },
}));

/** 从动作层重新读列表 —— "哪些算未删除"是产品语义，不在这里过滤。 */
function refresh(): void {
  useHabitStore.setState({
    habits: habitActions.listHabits(),
    logs: habitActions.listLogs(),
    trashed: habitActions.listTrashedHabits(),
  });
}

// 引擎状态变化时自动刷新（含远程 op 应用后）
onEngineChange(refresh);

// ─────────────────────────────────────────────────────────────
// 薄转发（实现全在 @heyta/ui 的 habits/model.ts）
// ─────────────────────────────────────────────────────────────

/**
 * 计算每个习惯的进度与连续天数。
 *
 * 🔴 实现已经搬进共享层；这个函数**只转发**。留在 web 的理由见文件头第二次改造：
 * `stores.spec.ts` / `motivation-view.spec.tsx` 按这个名字断言 web 行为，
 * 而那两份测试不在本刀白名单里。
 *
 * `now` 显式传入的理由（跨午夜一致、可测）已经写在共享层。
 */
export function selectHabitProgress(state: HabitState, now: number): HabitProgressRow[] {
  return toHabitProgressRows(state.habits, state.logs, now, habitGrowth);
}

/** 近 N 天的打卡热力数据。同样只是转发到共享层。 */
export function selectHeatmap(
  state: HabitState,
  habitId: string,
  now: number,
  days = 90,
): ReturnType<typeof habitHeatmap> {
  return habitHeatmap(state.logs, habitId, now, days);
}

/**
 * 界面里"现在"的取值缝。
 *
 * 🔴 为什么在这里：左列（`HabitsView` 的 7 个点）与面单（`HabitDetailCard` 的 90 天热力图）
 * 必须用**同一个时刻**，否则同一次渲染里跨午夜会让"列表说打过、窗格说没打"。
 * 这一单把面单拆成独立组件之后，那句话不再是"显然成立"—— 两边各写一遍
 * `Number(sessionStorage.getItem('now') ?? Date.now())` 就变成两处可以各自漂移的实现。
 * 留在数据模块而不是新建一个文件，理由是它和这个 store 一样属于"界面读数据时的口径"，
 * 而它**不判断任何业务**（与上面那句"转发里一个判断都不能写"同一条纪律）。
 *
 * ⚠️ 测试经 `sessionStorage['now']` 钉住同一天（`habits-list-pane.spec.tsx` 的 `NOW`）。
 */
export const NOW_STATE_KEY = 'now';

export function readNow(): number {
  return Number(sessionStorage.getItem(NOW_STATE_KEY) ?? Date.now());
}
