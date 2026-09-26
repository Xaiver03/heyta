/**
 * 番茄钟 store（Web 壳）
 * ========================
 *
 * 状态机（开始/暂停/恢复/推进）、进度、"哪一段该落盘"**全部来自 `@heyta/domain`**；
 * op 的构造**全部来自 `@heyta/app-host` 的 `createFocusActions`**。
 *
 * 这里只做两件事：
 *   1. 按真实时间驱动 UI 重绘
 *   2. 把 `advance()` 返回的 `FocusSession` 交给动作层落盘
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个文件被**改造过**，改的是一处真实的架构违规（不是顺手整理）：
 *
 * 它原先自己拼 `FOCUS_SESSION` 的 op（`entityType: 'FOCUS_SESSION'` 的字面量
 * 就写在这个文件里）。那是 AGENTS.md §3.5 明令禁止的 —— "这个实体该写哪些字段"
 * 是产品语义，属于 `packages/`。`apps/web/src/features/tasks/store.ts` 里
 * 同样的写法有 7 处，**而 `createTaskActions` 早就存在、移动端一直在用**。
 *
 * 收编时把两处**已经漂移**的地方对齐了，这两处都是真分歧，不是风格差异：
 *
 * | 行为 | 旧（apps/web 自己拼） | 新（app-host 单一实现） |
 * |---|---|---|
 * | 未关联任务的 `taskId` | **不放进 payload** | 写 `null` |
 * | session id | `focus-${now}-${counter}` | `focus-${randomId()}`（带 RN 安全回退）|
 *
 * 选 `null` 而不是省略，是为了与 `actions.ts` 文件头第 2 条一致：载荷里
 * "这个键存在且为 null"能穿过 JSON 表达"清除"，而"键不存在"在更新场景下
 * 表达不了清除。两端口径必须一样 —— 这正是统一到一处要解决的问题。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ 倒计时**不靠 setInterval 累减**。累减会随浏览器节流、切后台而走慢。
 * 这里每次都从 `remainingMs(state, now)` **重算**，interval 只触发重绘。
 */

import { create } from 'zustand';

import {
  DEFAULT_FOCUS_CONFIG,
  abort as abortFn,
  advance,
  focusProgress,
  focusStatsForDay,
  initialFocusState,
  isFinished,
  pause as pauseFn,
  remainingMs,
  resume as resumeFn,
  shouldPersistSession,
  start as startFn,
  type FocusConfig,
  type FocusSession,
  type FocusState,
} from '@heyta/domain';
import { createFocusActions, type ActionContext } from '@heyta/app-host';

import { currentState, dispatchIntent, onEngineChange } from '../../lib/oplog.js';

interface FocusStoreState {
  config: FocusConfig;
  state: FocusState;
  /**
   * 今天完成了几个专注。
   *
   * 🔴 **由 op-log 派生，不是自增计数器。**
   *
   * 它原先是一个 `set({ completedToday: get().completedToday + 1 })` —— 那意味着
   * **刷新页面就归零**，而且与另外两台设备看到的数字不同。专注记录已经落在
   * op-log 里了，界面上的数字就该从那里算出来（`focusStatsForDay`），
   * 顺带自动获得"与同步一致"这个性质。
   */
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

/**
 * 动作层的宿主上下文。
 *
 * `apps/web` 的 `dispatchIntent` / `currentState` 就是它的两个能力 ——
 * 于是这个 store **不再需要知道** op 长什么样。
 */
const actionContext: ActionContext = {
  dispatch: dispatchIntent,
  getState: currentState,
};

const focusActions = createFocusActions(actionContext);

let tickHandle: ReturnType<typeof setInterval> | undefined;

/** 落盘一段已结束的专注。字段与 id **全部由动作层决定**。 */
async function persist(session: FocusSession): Promise<void> {
  await focusActions.log(session);
}

/** 从 op-log 里算出今天完成了几个专注。 */
function deriveCompletedToday(): number {
  const sessions = Object.values(currentState().focusSessions);
  return focusStatsForDay(sessions, Date.now()).completedWorkCount;
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
    // 自己再拼一份 —— 重复的构造逻辑迟早会不一致。
    const { next, finished } = abortFn(get().state, now);

    stopTicking();
    set({ state: next, tick: get().tick + 1 });

    // idle 中止不产生记录（finished 为 null）
    if (finished === null) return;

    await runPersist(set, finished);
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
    // 只对**工作段**落盘。这条判断在领域层（`shouldPersistSession`），
    // 不在这里 —— 移动端要写同一段逻辑时就是第二次。
    if (!shouldPersistSession(finished)) return;

    await runPersist(set, finished);
  },
}));

/**
 * 落盘 + 统一处理失败。
 *
 * 🔴 `persist` 在**定时器回调**里执行，未捕获的拒绝会变成 unhandledRejection ——
 * 在浏览器里可能悄无声息。存储故障不该让整个应用崩掉，但也不能静默：
 * 写进 `error` 供 UI 展示，并停表（继续跑下去只会一次又一次地失败）。
 */
async function runPersist(
  set: (partial: Partial<FocusStoreState>) => void,
  finished: FocusSession,
): Promise<void> {
  try {
    await persist(finished);
    set({ completedToday: deriveCompletedToday(), error: undefined });
  } catch (error: unknown) {
    stopTicking();
    set({
      error: `专注记录保存失败：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/**
 * 引擎变化 → 重算"今天完成几个"。
 *
 * 这条订阅让同步回来的专注记录（另一台设备记的）也计入今天的数字 ——
 * 自增计数器做不到这一点。
 */
onEngineChange(() => {
  useFocusStore.setState({ completedToday: deriveCompletedToday() });
});

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

/**
 * 进度 0–1，供环形进度条使用。
 *
 * 实现已移到 `@heyta/domain` 的 `focusProgress()` —— 移动端要有同一个数，
 * 两处各写一份的话，症状是"网页的环走完了、手机的还差一点"，且不报错。
 */
export function selectProgress(s: FocusStoreState, now: number): number {
  return focusProgress(s.state, now);
}

/** 当前阶段是否是工作段（决定配色）。 */
export function isWorkPhase(s: FocusStoreState): boolean {
  return s.state.kind === 'work';
}
