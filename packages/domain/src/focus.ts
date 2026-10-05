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
import { dayRange } from './date.js';

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

/**
 * 选择下一轮的类型（专注 / 短休息 / 长休息）。
 *
 * ⚠️ **只在 idle 时生效**：计时中途改类型会让 `plannedMs` 与已经过去的进度对不上，
 * 于是倒计时要么瞬间跳到 0、要么凭空多出一段。运行中要换就先中止。
 *
 * 为什么要暴露这个：`durationFor()` 是私有的，而"短休息是 5 分钟"这个映射
 * 是配置语义 —— 让界面自己查时长就是第二次定义（改配置时只改一处）。
 */
export function selectKind(
  state: FocusState,
  kind: FocusSessionKind,
  config: FocusConfig = DEFAULT_FOCUS_CONFIG,
): FocusState {
  if (state.phase !== 'idle') return state;
  return { ...state, kind, plannedMs: durationFor(kind, config) };
}

/**
 * 清除关联任务。
 *
 * ⚠️ 与 `selectKind` 同样是 **idle 限定**：已经开始的这一轮，它的归属已经定了。
 * 中途解除关联会让"这一段专注记在谁头上"在落盘时刻变得不确定 ——
 * 而落盘时读的是 state，用户看到的却是解除之后的界面。
 */
export function clearTask(state: FocusState): FocusState {
  if (state.phase !== 'idle') return state;
  return { ...state, taskId: undefined };
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
 * 进度 0–1，供进度条 / 进度环使用。
 *
 * 🔴 与 `remainingMs` 一样**每次重算**，不累加。idle 时返回 0（而不是 1）：
 * "还没开始"和"已经走完"在界面上必须是两种不同的样子。
 *
 * 放在领域层而不是各自的选择器里：Web 端的专注 store 里已经有一份
 * `selectProgress`，移动端要用就会变成第二份 —— 两端口径不同的症状是
 * "网页的环走完了、手机的还差一点"，且没有任何一处报错。
 */
export function focusProgress(state: FocusState, now: number): number {
  if (state.phase === 'idle') return 0;
  const total = state.plannedMs;
  // 除零守卫：plannedMs 为 0 时（非法配置/坏数据）返回 0 而不是 NaN。
  // NaN 传进布局会让进度条整条消失，而错误信息不会指向这里。
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remainingMs(state, now) / total));
}

/**
 * 计时器**显示**的毫秒数。
 *
 * 运行/暂停时就是剩余时间；**空闲时是这一轮的计划时长**，不是 0。
 *
 * 🔴 为什么空闲不显示 `00:00`：一个静止不动的 `00:00` 在用户眼里等于
 * "坏了 / 卡住了"，而它的真实含义是"还没开始"。真机验收时我自己看到它
 * 第一反应就是"是不是没跑起来"。番茄钟类的界面都显示 `25:00` ——
 * 空闲时该显示的是"按下开始之后会走多长"。
 *
 * 与 `focusProgress` 放在一起，是为了让两端**用同一个定义**：
 * Web 端若自己写成 `phase === 'idle' ? 0 : remaining`，就会出现
 * "网页显示 00:00、手机显示 25:00"这种没人会报的差异。
 */
export function focusDisplayMs(state: FocusState, now: number): number {
  if (state.phase === 'idle') return state.plannedMs;
  return remainingMs(state, now);
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
 * 某一轮的计划时长（ms）。`durationFor` 的公开版本。
 *
 * 🔴 界面**不要**自己写 `kind === 'work' ? config.workMs : ...` ——
 * 那就是把同一张映射表写了第二遍，而两处不同的症状是
 * "界面写着 25 分钟、计时器却跑 5 分钟"，且没有任何一处报错。
 */
export function focusDurationMs(
  kind: FocusSessionKind,
  config: FocusConfig = DEFAULT_FOCUS_CONFIG,
): number {
  return durationFor(kind, config);
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

// ─────────────────────────────────────────────────────────────
// 统计
// ─────────────────────────────────────────────────────────────
//
// 放在领域层而不是界面里：**"哪些算今天""什么算一次完成的专注"是产品语义**，
// 不是展示细节。写在屏幕组件里，换个端就要重写一遍，
// 而两端口径不同的症状是"手机说今天 4 个番茄、网页说 3 个"（AGENTS.md §3.5）。

/**
 * 一条 session 算在**哪一天**。
 *
 * 🔴 判据是 `endedAt`（没有就退到 `createdAt`），**不是 `startedAt`**。
 *
 * 理由：跨零点的那一轮（23:50 开始、00:15 结束）如果按开始日算，
 * 用户看到的是"昨晚那个番茄今天不在统计里"；按开始日切分又会把一轮
 * 拆成两天、两边都不完整。**记在结束的那一天**是唯一不重不漏的口径，
 * 也与"今天我完成了几个番茄"这个问法一致。
 */
export function focusSessionDay(session: FocusSession): number {
  return session.endedAt ?? session.createdAt;
}

/**
 * 这一段是否值得**落盘**。
 *
 * 🔴 这是产品语义，不是平台细节：**只有工作段落盘，休息不落盘。**
 * 理由：休息不是用户的专注成果。存下来会让"今天专注了几段"里一半是休息，
 * 统计看起来翻倍；而如果只有休息没有工作，这一天仍然是"没专注"。
 *
 * 它原先只写在 `apps/web` 的专注 store 里（`if (finished.kind !== 'work') return;`）。
 * 移动端要写同一段逻辑时就是第二次 —— 而两端口径不同的症状是
 * "手机记了 5 段、网页记了 3 段"，且没有任何一处报错。所以提到这里，
 * 两个壳都调用它（见 AGENTS.md §3.5）。
 */
export function shouldPersistSession(session: FocusSession): boolean {
  return session.kind === 'work';
}

/** 某一天的专注汇总。 */
export interface FocusDayStats {
  /** 自然完成的**专注**轮数（不含休息）。 */
  completedWorkCount: number;
  /** 中途放弃的专注轮数。单独记，因为"完成了 3 个"和"试了 5 次"是两回事。 */
  abortedWorkCount: number;
  /** 实际专注时长合计（ms）。**含中途放弃的那部分** —— 那是真实坐下来的时间。 */
  focusMs: number;
  /** 休息时长合计（ms）。 */
  breakMs: number;
}

/** 空的汇总。所有字段都是 0，方便直接当累加初值。 */
export function emptyFocusDayStats(): FocusDayStats {
  return { completedWorkCount: 0, abortedWorkCount: 0, focusMs: 0, breakMs: 0 };
}

/**
 * 汇总**某一天**的专注。
 *
 * `now` 决定"今天"是哪一天（本地日历日），跨零点的归属见 `focusSessionDay`。
 * 纯函数：同样的输入永远同样的输出，不读系统时间。
 */
export function focusStatsForDay(
  sessions: readonly FocusSession[],
  now: number,
): FocusDayStats {
  const { start, end } = dayRange(now);
  const stats = emptyFocusDayStats();

  for (const session of sessions) {
    const at = focusSessionDay(session);
    if (at < start || at >= end) continue;

    // ⚠️ `actualMs` 缺省时**不能当 0**：老数据或未来写入方可能只填了 plannedMs，
    // 当成 0 会让"今天专注 25 分钟"显示成 0 分钟。缺失时退回 plannedMs 更接近真相。
    const actual = session.actualMs ?? session.plannedMs;

    if (session.kind === 'work') {
      if (session.completed === true) stats.completedWorkCount += 1;
      else stats.abortedWorkCount += 1;
      stats.focusMs += actual;
    } else {
      stats.breakMs += actual;
    }
  }

  return stats;
}

/*
 * 这里**没有**时长的人类可读格式化函数 —— 那是 `activity-categories.ts#durationParts`
 * 的活（先四舍五入到分钟、再分三档，`packages/domain/tests/activity-categories.spec.ts:391`
 * 起有判据）。原来这一层确实有一个 `formatFocusDuration`，返回写死的中文
 * 「1 小时 20 分钟」，而 `apps/web/src/features/categories/copy.ts` 与
 * `apps/web/src/lib/due-display.ts` 两处注释都在提醒"别用它"。
 *
 * 🔴 工单 W7 让 web 与 mobile 第一次**同时**要显示"今日专注时长"，
 * 那就是留一个中文写死版本会开始骗人的时刻 —— 收尾动作是删掉它，
 * 不是再写一个更好的字符串版本（AGENTS §3.5 那条教训）。
 */

