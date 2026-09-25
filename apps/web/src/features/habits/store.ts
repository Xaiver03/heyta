/**
 * 习惯 store —— 打卡 / 撤销 / 连续天数
 * ======================================
 *
 * 为什么**不能**直接用 Super Productivity 的 SimpleCounter：
 * SP 的计数器只有"加一/减一"，没有目标值、单位、计划频率、补打卡窗口。
 * 而"连续天数"必须有**计划日**概念才能算对 —— 一个"每周三次"的习惯，
 * 周一、周三、周五打卡就是连续，中间的周二不该算断。
 * 没有 frequency 的计数器算不出这个，所以这部分是自研（见计划 3.4）。
 *
 * 写入仍然全部经 `dispatchIntent`（D4）。
 */

import { create } from 'zustand';

import {
  addDays,
  computeStreak,
  completionRatio,
  toLocalDate,
  type Habit,
  type HabitLog,
  type LocalDate,
  type StreakResult,
} from '@heyta/domain';

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
}

interface HabitState {
  habits: Habit[];
  logs: HabitLog[];
  /** 打卡操作会发生"同一天二次打卡"冲突，用它串行化。 */
  busy: boolean;
  error?: string;

  addHabit: (name: string, over?: Partial<Habit>) => Promise<void>;
  /** 打卡。已打卡时是幂等空操作（不产生重复 log）。 */
  checkIn: (habitId: string, date?: LocalDate, value?: number) => Promise<void>;
  /** 撤销打卡。 */
  undoCheckIn: (habitId: string, date?: LocalDate) => Promise<void>;
  deleteHabit: (habitId: string) => Promise<void>;
}

/** 打卡记录的主键：习惯 + 日期。
 *
 * ⚠️ 用 `${habitId}:${date}` 而不是随机 id —— 这样"同一天重复打卡"
 * 天然落到同一条记录上（幂等），而不是产生第二条 log 让计数翻倍。
 */
function logId(habitId: string, date: LocalDate): string {
  return `${habitId}:${date}`;
}

let habitCounter = 0;
function nextHabitId(): string {
  habitCounter += 1;
  return `habit-${String(Date.now())}-${String(habitCounter)}`;
}

export const useHabitStore = create<HabitState>((set, get) => ({
  habits: [],
  logs: [],
  busy: false,

  addHabit: async (name, over = {}) => {
    const trimmed = name.trim();
    if (trimmed === '') return;

    await dispatchIntent({
      entityType: 'HABIT',
      entityId: nextHabitId(),
      opType: 'CREATE',
      payload: { name: trimmed, target: 1, ...over },
    });
    refresh(set);
  },

  checkIn: async (habitId, date, value) => {
    const d = date ?? toLocalDate(Date.now());
    const state = get();
    const habit = state.habits.find((h) => h.id === habitId);
    if (habit === undefined) return;

    // 幂等：今天已经打过卡就什么都不做。
    // 不靠 reducer 去重，因为"第二次打卡"和"改数值"在数据上无法区分 ——
    // 必须在**意图层**就判定。
    const existing = state.logs.find(
      (l) => l.habitId === habitId && l.date === d && l.deletedAt === undefined,
    );
    if (existing !== undefined) return;

    await dispatchIntent({
      entityType: 'HABIT_LOG',
      entityId: logId(habitId, d),
      opType: 'CREATE',
      payload: {
        habitId,
        date: d,
        value: value ?? habit.target ?? 1,
      },
    });
    refresh(set);
  },

  undoCheckIn: async (habitId, date) => {
    const d = date ?? toLocalDate(Date.now());
    const existing = get().logs.find(
      (l) => l.habitId === habitId && l.date === d && l.deletedAt === undefined,
    );
    if (existing === undefined) return;

    // 软删除（墓碑）—— 物理删除会让另一端把打卡同步回来
    await dispatchIntent({
      entityType: 'HABIT_LOG',
      entityId: logId(habitId, d),
      opType: 'DELETE',
      payload: {},
    });
    refresh(set);
  },

  deleteHabit: async (habitId) => {
    await dispatchIntent({
      entityType: 'HABIT',
      entityId: habitId,
      opType: 'DELETE',
      payload: {},
    });
    refresh(set);
  },
}));

function refresh(set: (partial: Partial<HabitState>) => void): void {
  const state = currentState();
  set({
    habits: Object.values(state.habits).filter((h) => h.deletedAt === undefined),
    logs: Object.values(state.habitLogs).filter((l) => l.deletedAt === undefined),
  });
}

// 引擎状态变化时自动刷新（含远程 op 应用后）
onEngineChange(() => {
  const state = currentState();
  useHabitStore.setState({
    habits: Object.values(state.habits).filter((h) => h.deletedAt === undefined),
    logs: Object.values(state.habitLogs).filter((l) => l.deletedAt === undefined),
  });
});

// ─────────────────────────────────────────────────────────────
// 选择器（纯计算，不改状态）
// ─────────────────────────────────────────────────────────────

/**
 * 计算每个习惯的进度与连续天数。
 *
 * `now` 显式传入而不是内部读 `Date.now()`：
 * 否则同一次渲染里不同习惯可能跨过午夜，显示不一致；
 * 而且测试无法稳定断言。
 */
export function selectHabitProgress(
  state: HabitState,
  now: number,
): HabitWithProgress[] {
  const today = toLocalDate(now);

  return state.habits.map((habit) => {
    const habitLogs = state.logs.filter((l) => l.habitId === habit.id);
    const todayLog = habitLogs.find((l) => l.date === today);

    return {
      habit,
      todayLog,
      doneToday: todayLog !== undefined,
      // 传 undefined 表示"今天还没打卡" —— 领域层会按 value 0 算
      todayRatio: completionRatio(habit, todayLog),
      // ⚠️ 传 HabitLog[] 而不是日期字符串数组 —— 领域层需要看 value 与
      // deletedAt 才能判定"是否达成"，只给日期会丢掉目标值信息
      streak: computeStreak(habit, habitLogs, today),
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
