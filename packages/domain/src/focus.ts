/**
 * 番茄钟状态机
 * =============
 *
 * ⚠️ **最重要的一条设计判断：剩余时间由「结束时间戳 - 现在」计算，
 * 绝不用 setInterval 每秒减一。**
 *
 * 为什么：浏览器会给后台标签页的定时器降频（可能降到 1 次/分钟）。
 * 用累加方式的话，用户切到别的标签页 10 分钟，回来会发现番茄钟只走了 1 分钟。
 * 基于时间戳则在任何节流下都准确。
 *
 * 本模块是**纯函数状态机**，不碰 DOM、不碰定时器。
 * 调用方负责按需重绘（例如 requestAnimationFrame 或每秒 tick 一次用于显示）。
 */

import type { FocusSession, FocusSessionKind } from './entities.js';

/** 番茄钟配置。 */
export interface FocusConfig {
  /** 专注时长（ms）。经典番茄钟是 25 分钟。 */
  workMs: number;
  /** 短休息（ms）。 */
  shortBreakMs: number;
  /** 长休息（ms）。 */
  longBreakMs: number;
  /** 每完成几个专注后进入长休息。 */
  longBreakEvery: number;
}

export const DEFAULT_FOCUS_CONFIG: FocusConfig = {
  workMs: 25 * 60 * 1000,
  shortBreakMs: 5 * 60 * 1000,
  longBreakMs: 15 * 60 * 1000,
  longBreakEvery: 4,
};

export type FocusPhase = 'idle' | 'running' | 'paused';

export interface FocusState {
  phase: FocusPhase;
  kind: FocusSessionKind;
  /** 本轮计划时长（ms）。 */
  plannedMs: number;
  /**
   * 本轮结束的绝对时间戳（epoch ms）。
   * 暂停时为 undefined —— 暂停会清掉它，恢复时重新计算。
   */
  endsAt?: number;
  /**
   * 暂停时已累积的剩余量（ms）。
   * 存在它才能实现"暂停再恢复不丢失已过去的进度"。
   */
  remainingMsOnPause?: number;
  /** 本轮开始时间戳。 */
  startedAt?: number;
  /** 已完成几个专注（用于决定下一次是不是长休息）。 */
  completedWorkCount: number;
  /** 关联任务。 */
  taskId?: string;
}

export function initialFocusState(): FocusState {
  return {
    phase: 'idle',
    kind: 'work',
    plannedMs: DEFAULT_FOCUS_CONFIG.workMs,
    completedWorkCount: 0,
  };
}

/** 开始一轮。 */
export function start(
  state: FocusState,
  now: number,
  config: FocusConfig = DEFAULT_FOCUS_CONFIG,
  taskId?: string,
): FocusState {
  const plannedMs = durationFor(state.kind, config);
  return {
    ...state,
    phase: 'running',
    plannedMs,
    startedAt: now,
    endsAt: now + plannedMs,
    remainingMsOnPause: undefined,
    taskId: taskId ?? state.taskId,
  };
}

/** 暂停。把剩余量记下来，然后清掉 endsAt。 */
export function pause(state: FocusState, now: number): FocusState {
  if (state.phase !== 'running') return state;
  return {
    ...state,
    phase: 'paused',
    remainingMsOnPause: Math.max(0, (state.endsAt ?? now) - now),
    endsAt: undefined,
  };
}

/** 从暂停恢复。用记下的剩余量重算 endsAt。 */
export function resume(
  state: FocusState,
  now: number,
  config: FocusConfig = DEFAULT_FOCUS_CONFIG,
): FocusState {
  if (state.phase !== 'paused') return state;
  const remaining = state.remainingMsOnPause ?? durationFor(state.kind, config);
  return {
    ...state,
    phase: 'running',
    endsAt: now + remaining,
    remainingMsOnPause: undefined,
  };
}

/**
 * 剩余时间（ms）。
 *
 * **这是整个模块的核心**：纯计算，不依赖任何 tick。
 * 即使调用方 5 秒才重绘一次，结果也是准的。
 */
export function remainingMs(state: FocusState, now: number): number {
  if (state.phase === 'idle') return 0;
  if (state.phase === 'paused') return state.remainingMsOnPause ?? state.plannedMs;
  return Math.max(0, (state.endsAt ?? now) - now);
}

/** 是否已到时。 */
export function isFinished(state: FocusState, now: number): boolean {
  return state.phase === 'running' && remainingMs(state, now) === 0;
}

/**
 * 推进到下一轮（专注结束 → 休息；休息结束 → 专注）。
 *
 * 返回新状态**和**一个待写入的 FocusSession 记录。
 * 分开返回的理由：状态机不做持久化，op-log 才是唯一写入口（P1 D4）。
 */
export function advance(
  state: FocusState,
  now: number,
  config: FocusConfig = DEFAULT_FOCUS_CONFIG,
): { next: FocusState; finished: FocusSession | null } {
  if (!isFinished(state, now)) {
    return { next: state, finished: null };
  }

  const actualMs = state.plannedMs;
  const finished: FocusSession = {
    id: '', // 由调用方生成 —— 状态机不产生 ID，避免引入随机源
    kind: state.kind,
    taskId: state.taskId,
    plannedMs: state.plannedMs,
    actualMs,
    completed: true,
    createdAt: state.startedAt ?? now,
    updatedAt: now,
    startedAt: state.startedAt,
    endedAt: now,
  };

  const completedWorkCount =
    state.kind === 'work' ? state.completedWorkCount + 1 : state.completedWorkCount;

  const nextKind: FocusSessionKind =
    state.kind === 'work'
      ? completedWorkCount % config.longBreakEvery === 0
        ? 'longBreak'
        : 'shortBreak'
      : 'work';

  return {
    next: {
      phase: 'idle',
      kind: nextKind,
      plannedMs: durationFor(nextKind, config),
      completedWorkCount,
      taskId: state.taskId,
    },
    finished,
  };
}

/** 中止当前轮（用户手动停止）。 */
export function abort(
  state: FocusState,
  now: number,
): { next: FocusState; finished: FocusSession | null } {
  if (state.phase === 'idle') return { next: state, finished: null };

  const elapsed =
    state.phase === 'paused'
      ? state.plannedMs - (state.remainingMsOnPause ?? state.plannedMs)
      : state.plannedMs - remainingMs(state, now);

  const finished: FocusSession = {
    id: '',
    kind: state.kind,
    taskId: state.taskId,
    plannedMs: state.plannedMs,
    actualMs: Math.max(0, elapsed),
    completed: false, // 手动中止 —— 与自然完成区分，统计时要用
    createdAt: state.startedAt ?? now,
    updatedAt: now,
    startedAt: state.startedAt,
    endedAt: now,
  };

  return { next: initialFocusState(), finished };
}

function durationFor(kind: FocusSessionKind, config: FocusConfig): number {
  switch (kind) {
    case 'work':
      return config.workMs;
    case 'shortBreak':
      return config.shortBreakMs;
    case 'longBreak':
      return config.longBreakMs;
  }
}

/**
 * 格式化为 `MM:SS`。
 *
 * ⚠️ 用 `ceil` 而不是 `floor`：剩 59.4 秒时应显示 01:00 而不是 00:59。
 * 用 floor 的话计时器会从 00:01 直接跳到 00:00 并停留两倍时长，看起来像卡住。
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
