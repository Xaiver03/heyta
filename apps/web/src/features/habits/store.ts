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
import type { CategorySlot, Habit, HabitLog, LocalDate } from '@heyta/domain';
import { habitHeatmap, toHabitProgressRows, type HabitProgressRow } from '@heyta/ui';
import { create } from 'zustand';

import { currentState, dispatchIntent, onEngineChange } from '../../lib/oplog.js';

interface HabitState {
  habits: Habit[];
  logs: HabitLog[];
  error?: string;

  addHabit: (name: string, over?: NewHabitFields) => Promise<void>;
  /** 打卡。已打卡时是幂等空操作（不产生重复 log）。 */
  checkIn: (habitId: string, date?: LocalDate, value?: number) => Promise<void>;
  /** 撤销打卡。 */
  undoCheckIn: (habitId: string, date?: LocalDate) => Promise<void>;
  deleteHabit: (habitId: string) => Promise<void>;
  /** 分类色槽位（1–8），`undefined` 表示清除。存槽位号，不存颜色本身。 */
  setHabitColor: (habitId: string, slot?: CategorySlot) => Promise<void>;
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

  deleteHabit: async (habitId) => {
    // 软删除。打卡记录**不**级联删除 —— 撤销删除后历史还在。
    await habitActions.removeHabit(habitId);
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
