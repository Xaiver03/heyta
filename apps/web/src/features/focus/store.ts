/**
 * 番茄钟 store
 * ==============
 *
 * 状态机（开始/暂停/恢复/推进）**全部来自 `@heyta/domain` 的 focus.ts**。
 * 这里只做两件事：
 *   1. 按真实时间驱动 UI 重绘
 *   2. 把 `advance()` 返回的 `FocusSession` 经 D4 落盘
 *
 * ⚠️ 注意 `advance()` 已经负责构造 FocusSession（含 completed/actualMs/
 * 轮次判定）。**不要自己再拼一份** —— 两处构造逻辑迟早会不一致。
 *
 * ⚠️ 倒计时**不靠 setInterval 累减**。累减会随浏览器节流、切后台而走慢。
 * 这里每次都从 `remainingMs(state, now)` **重算**，interval 只触发重绘。
 */

import { create } from 'zustand';

import {
  DEFAULT_FOCUS_CONFIG,
  abort as abortFn,
  advance,
  initialFocusState,
  isFinished,
  pause as pauseFn,
  remainingMs,
  resume as resumeFn,
  start as startFn,
  type FocusConfig,
  type FocusSession,
  type FocusState,
} from '@heyta/domain';

import { dispatchIntent } from '../../lib/oplog.js';

interface FocusStoreState {
  config: FocusConfig;
  state: FocusState;
  completedToday: number;
  /** 重绘节拍。值本身无意义，只用于让组件重新计算 remainingMs。 */
  tick: number;
  /** 落盘失败时的错误。**必须显式暴露**，不能静默。 */
  error?: string;

  start: (taskId?: string) => void;
  pause: () => void;
  resume: () => void;
  /** 中止并落盘（记为未自然完成）。 */
  abort: () => Promise<void>;
  setConfig: (partial: Partial<FocusConfig>) => void;
  /** 由计时循环调用：推进状态并落盘。 */
  tickOnce: () => Promise<void>;
}

let sessionCounter = 0;
let tickHandle: ReturnType<typeof setInterval> | undefined;

/** 落盘一段已结束的专注。 */
async function persist(session: FocusSession, id: string): Promise<void> {
  await dispatchIntent({
    entityType: 'FOCUS_SESSION',
    entityId: id,
    opType: 'CREATE',
    payload: {
      kind: session.kind,
      plannedMs: session.plannedMs,
      actualMs: session.actualMs,
      completed: session.completed,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      // undefined 时不放进 payload —— 我们的 null 语义表示"清除字段"，
      // 而这里根本没这个字段可清除
      ...(session.taskId !== undefined ? { taskId: session.taskId } : {}),
    },
  });
}

export const useFocusStore = create<FocusStoreState>((set, get) => ({
  config: DEFAULT_FOCUS_CONFIG,
  state: initialFocusState(),
  completedToday: 0,
  tick: 0,

  start: (taskId) => {
    const now = Date.now();
    set({
      state: startFn(get().state, now, get().config, taskId),
      tick: get().tick + 1,
    });
    ensureTicking(get, set);
  },

  pause: () => {
    set({ state: pauseFn(get().state, Date.now()), tick: get().tick + 1 });
  },

  resume: () => {
    const now = Date.now();
    set({ state: resumeFn(get().state, now, get().config), tick: get().tick + 1 });
    ensureTicking(get, set);
  },

  abort: async () => {
    const now = Date.now();
    // ⚠️ abort() 已经算好 elapsed 并构造了 FocusSession（completed:false）。
    // 我第一版又自己拼了一份 —— 重复的构造逻辑迟早会不一致。
    const { next, finished } = abortFn(get().state, now);

    stopTicking();
    set({ state: next, tick: get().tick + 1 });

    // idle 中止不产生记录（finished 为 null）
    if (finished === null) return;

    sessionCounter += 1;
    await persist(finished, `focus-${String(now)}-${String(sessionCounter)}`);
  },

  setConfig: (partial) => {
    set({ config: { ...get().config, ...partial } });
  },

  tickOnce: async () => {
    const { state, config } = get();
    const now = Date.now();

    if (!isFinished(state, now)) {
      // 未到时也要重绘 —— 否则进度环不走
      set({ tick: get().tick + 1 });
      return;
    }

    // advance() 已经算好下一阶段与轮次，**不要自己再判一次**
    const { next, finished } = advance(state, now, config);
    stopTicking();
    set({ state: next, tick: get().tick + 1 });

    if (finished === null) return;

    // 只对**工作段**落盘：休息不是用户的专注成果，
    // 存下来会让统计里一半是休息。
    if (finished.kind !== 'work') return;

    sessionCounter += 1;
    try {
      await persist(finished, `focus-${String(now)}-${String(sessionCounter)}`);
      set({ completedToday: get().completedToday + 1, error: undefined });
    } catch (error: unknown) {
      // 🔴 必须捕获。persist 在**定时器回调**里执行，未捕获的拒绝会变成
      // unhandledRejection —— 在浏览器里可能悄无声息，在 Node 里直接终止进程。
      // 存储故障不该让整个应用崩掉，但也不能静默：写进 error 供 UI 展示。
      stopTicking();
      set({
        error: `专注记录保存失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  },
}));

function ensureTicking(
  get: () => FocusStoreState,
  set: (partial: Partial<FocusStoreState>) => void,
): void {
  if (tickHandle !== undefined) return;
  tickHandle = setInterval(() => {
    void get().tickOnce();
  }, 250);
}

function stopTicking(): void {
  if (tickHandle === undefined) return;
  clearInterval(tickHandle);
  tickHandle = undefined;
}

/** 仅供测试：停止计时并复位。 */
export function __resetFocusForTests(): void {
  stopTicking();
  useFocusStore.setState({
    config: DEFAULT_FOCUS_CONFIG,
    state: initialFocusState(),
    completedToday: 0,
    tick: 0,
    error: undefined,
  });
}

// ─────────────────────────────────────────────────────────────
// 选择器
// ─────────────────────────────────────────────────────────────

/** 剩余毫秒（每次由领域层重算，不累减）。 */
export function selectRemaining(s: FocusStoreState, now: number): number {
  return remainingMs(s.state, now);
}

/** 进度 0–1，供环形进度条使用。 */
export function selectProgress(s: FocusStoreState, now: number): number {
  if (s.state.phase === 'idle') return 0;
  const total = s.state.plannedMs;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remainingMs(s.state, now) / total));
}

/** 当前阶段是否是工作段（决定配色）。 */
export function isWorkPhase(s: FocusStoreState): boolean {
  return s.state.kind === 'work';
}
