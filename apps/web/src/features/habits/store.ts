import { OpType } from '@heyta/sync-core';
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
 * 🔴 本文件被**改造过**：它原先自己拼 `HABIT` / `HABIT_LOG` 的 op（4 处）。
 * 这些全是产品语义，现在全部委托给 `@heyta/app-host` 的 `createHabitActions`：
 *
 *   - 打卡记录的 id = `${habitId}:${date}`（幂等性的来源）
 *   - "今天已经打过卡了"的判定
 *   - 打卡值缺省落在 `habit.target` 上
 *
 * 上面任何一条在这里重写一遍，都会让移动端和网页端**对同一次打卡
 * 生成不同的 op** —— 而这正是同步系统里最难查的一类问题。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { create } from 'zustand';

import {
  addDays,
  completionRatio,
  toLocalDate,
  type CategorySlot,
  type Habit,
  type HabitLog,
  type HabitResilienceView,
  type LocalDate,
  type StreakResult,
} from '@heyta/domain';
import {
  createHabitActions,
  habitGrowth,
  type ActionContext,
  type NewHabitFields,
} from '@heyta/app-host';

import { currentState, dispatchIntent, onEngineChange } from '../../lib/oplog.js';

export interface HabitWithProgress {
  habit: Habit;
  /** 今天是否已打卡。 */
  doneToday: boolean;
  /** 今日完成比例（0–1）。 */
  todayRatio: number;
  /** 连续天数结果（current / longest / lastDate）。 */
  streak: StreakResult;
  /** 今日打卡记录（可能不存在）。 */
  todayLog?: HabitLog;
  /**
   * 韧性与修复机会（冻结 / 续接 / 重新开始）。
   *
   * 🔴 它与 `streak` **并存**，两者在界面上各有各的位置：
   * `streak.current` 是**日历口径**（"昨天漏了"就归零），
   * `resilience.current` 是**算上冻结之后**的连续 —— 界面上显示的是后者，
   * 因为"冻结保住了它"正是这个机制存在的意义。
   *
   * ⚠️ 但**不要**用 `resilience.current - streak.current` 去算"冻结保住了几天"：
   * 两个数来自不同口径，差值不是事实（实测会把 1 天算成 7 天）。
   * 那个数在 `resilience.frozenInCurrentRun` 里，是扫描过程中直接数出来的。
   */
  resilience: HabitResilienceView;
}

interface HabitState {
  habits: Habit[];
  logs: HabitLog[];
  /**
   * ⚠️ 这个字段目前**没有任何消费者**，也没有任何地方把它设成 true。
   * 保留是因为它曾经打算用来串行化"同一天双击打卡"——
   * 而真正解决那个问题的机制是**打卡记录的复合 id**（见 `createHabitActions`）：
   * 两次打卡落到同一个实体上，LWW 收敛成一条，不需要外部串行化。
   * 留着它是为了不悄悄改掉一个导出接口；下次清理时可以直接删。
   */
  busy: boolean;
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
  busy: false,

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
// 选择器（纯计算，不改状态）
// ─────────────────────────────────────────────────────────────

/**
 * 计算每个习惯的进度与连续天数。
 *
 * `now` 显式传入而不是内部读 `Date.now()`：
 * 否则同一次渲染里不同习惯可能跨过午夜，显示不一致；
 * 而且测试无法稳定断言。
 *
 * 🔴 `streak` 与 `resilience` 的**配对**委托给
 * `@heyta/app-host#habitGrowth`：移动端的成长屏要画同一对数字，
 * 而"两个数字用同一份日志、同一个 today 算出来"这件事
 * **分成两处写就是漂移的开始**（结果是同一张卡片上两个数对不上账，
 * 而两边都不报错）。这里只补本屏独有的 `todayLog` / `todayRatio`。
 */
export function selectHabitProgress(
  state: HabitState,
  now: number,
): HabitWithProgress[] {
  const today = toLocalDate(now);

  return state.habits.map((habit) => {
    const todayLog = state.logs.find((l) => l.habitId === habit.id && l.date === today);
    // ⚠️ 传 HabitLog[] 而不是日期字符串数组 —— 领域层需要看 value 与
    // deletedAt 才能判定"是否达成"，只给日期会丢掉目标值信息
    const { streak, resilience } = habitGrowth(habit, state.logs, today);

    return {
      habit,
      todayLog,
      doneToday: todayLog !== undefined,
      // 传 undefined 表示"今天还没打卡" —— 领域层会按 value 0 算
      todayRatio: completionRatio(habit, todayLog),
      streak,
      resilience,
    };
  });
}

/** 近 N 天的打卡热力数据，供 react-activity-calendar 消费。 */
export function selectHeatmap(
  state: HabitState,
  habitId: string,
  now: number,
  days = 90,
): Array<{ date: string; count: number; level: 0 | 1 | 2 | 3 | 4 }> {
  const today = toLocalDate(now);
  const done = new Set(
    state.logs.filter((l) => l.habitId === habitId).map((l) => l.date),
  );

  const out: Array<{ date: string; count: number; level: 0 | 1 | 2 | 3 | 4 }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const count = done.has(date) ? 1 : 0;
    out.push({ date, count, level: count === 0 ? 0 : 4 });
  }
  return out;
}
