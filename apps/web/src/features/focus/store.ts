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
  initialFocusState,
  isFinished,
  pause as pauseFn,
  resume as resumeFn,
  shouldPersistSession,
  start as startFn,
  type FocusConfig,
  type FocusSession,
  type FocusState,
} from '@heyta/domain';
import {
  createFocusActions,
  focusLogFailureCode,
  focusOverview,
  type ActionContext,
  type FocusLogFailureCode,
  type FocusOverview,
} from '@heyta/app-host';

import { currentState, dispatchIntent, dispatchChecked, onEngineChange } from '../../lib/oplog.js';
import { loadFocusConfig, saveFocusConfig } from '../../lib/focus-config.js';

interface FocusStoreState {
  config: FocusConfig;
  state: FocusState;
  /**
   * 概览四数 + 专注记录（工单 W7）。
   *
   * 🔴 **由 `@heyta/app-host#focusOverview` 现算，这里一个数都不自己 reduce。**
   *
   * 它的前身是一个叫 `completedToday` 的字段，值来自本文件里直接调
   * `focusStatsForDay` —— 那是"同一个口径写两遍"的形状：移动端要显示同一组数时
   * 就是第二次，而两端口径不同的症状是"手机说今天 4 个番茄、网页说 3 个"
   * （AGENTS §3.5）。W7 的判据 ③ 要求两端**同一个出口**，所以收尾动作是
   * **把本文件那处推导删掉**，不是再写一个更好的版本。
   *
   * ⚠️ 与 `completedToday` 一样：它**不是自增计数器**，刷新页面不会归零，
   * 别的设备同步下来的记录也会算进来（见文件末尾那条 `onEngineChange` 订阅）。
   * ⚠️ 派生时机是"引擎变了"，不是"墙上时钟走了"：跨过零点而没有任何写入时，
   * 这一组数会停在昨天 —— 那条边界原样继承自 `completedToday`，
   * 要修就一起修，别在这里另开一套。
   */
  overview: FocusOverview;
  /** 重绘节拍。值本身无意义，只用于让组件重新计算 remainingMs。 */
  tick: number;
  /**
   * 落盘失败时的错误。**必须显式暴露**，不能静默。
   *
   * ⚠️ 只带**原因**（底层实现的原始文本，是数据），不带整句文案 ——
   * 这个 store 拿不到 `t`，句子由 `FocusTimer` 用词条表拼出来。
   * 存成拼好的中文句子会让英文界面漏出一句中文
   * （与移动端 `apps/mobile/src/lib/focus-timer.ts` 同形）。
   *
   * `code` 是给界面的**可辨识部分**：`focus-actions` 的三条校验失败各有一个码，
   * 界面据此说清"为什么没记上"（类型不认识 / 时长不是正数 / 缺产生时间）。
   * 认不出来的异常没有码，只能落到那句带 `{reason}` 的通用句。
   */
  error?: { code?: FocusLogFailureCode; reason: string };

  start: (taskId?: string) => void;
  pause: () => void;
  resume: () => void;
  /** 中止并落盘（记为未自然完成）。 */
  abort: () => Promise<void>;
  /**
   * 改时长设置。**只在 idle 时生效**，且会持久化到 `localStorage`。
   *
   * @returns `true` = 改了；`false` = 计时进行中，**没有改**（调用方必须解释原因）。
   */
  setConfig: (partial: Partial<FocusConfig>) => boolean;
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
  dispatchChecked,
  getState: currentState,
};

const focusActions = createFocusActions(actionContext);

let tickHandle: ReturnType<typeof setInterval> | undefined;

/** 落盘一段已结束的专注。字段与 id **全部由动作层决定**。 */
async function persist(session: FocusSession): Promise<void> {
  await focusActions.log(session);
}

/**
 * 空概览。只用于"引擎还没就绪时的那一份初值" —— 四个 0 与一个空列表，
 * 不含任何口径（口径全在 `@heyta/app-host#focusOverview`）。
 */
const EMPTY_OVERVIEW: FocusOverview = {
  todayCount: 0,
  todayFocusMs: 0,
  todayAbortedCount: 0,
  totalCount: 0,
  totalFocusMs: 0,
  records: [],
};

/** 从 op-log 现算概览四数与记录列表（本文件不做任何 reduce）。 */
function deriveOverview(): FocusOverview {
  return focusOverview(actionContext, Date.now());
}

export const useFocusStore = create<FocusStoreState>((set, get) => ({
  /**
   * 🔴 从 `localStorage` 读，**不是** `DEFAULT_FOCUS_CONFIG`。
   *
   * 在此之前这个字段永远是默认值，因为 `setConfig` 没有任何调用点 ——
   * 用户改不了时长。补上 UI 之后，"改完刷新就没了"会让设置变成一个假控件，
   * 所以持久化必须和 UI 一起落地（读写的形状与校验在 `lib/focus-config.ts`）。
   */
  config: loadFocusConfig(),
  state: initialFocusState(),
  overview: EMPTY_OVERVIEW,
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
    /**
     * 🔴 停表必须和"进入暂停态"是**同一个动作**，不是两件先后做的事。
     *
     * 漏掉这一行时 interval 继续跑，`tickOnce()` 每一发都走"未到点也要重绘"那一支
     * 把 `tick` 自增 ⇒ 订阅整个 focus store 的 `FocusTimer` 以 4Hz 重渲染，
     * **而且跨视图不停**（切到任务页它还在转），直到用户点中止。
     * 暂停的语义就是"没有时间在走"，所以这里没有需要保留的定时器。
     */
    stopTicking();
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
    /**
     * 🔴 进行中拒绝改时长，而且**不是静默拒绝**。
     *
     * 本轮的计划时长在 `start()` 那一刻就冻结进了 `state.plannedMs`
     * （进度环、`FocusSession.plannedMs` 都用它）。进行中改 config 只有两种结果：
     * 本轮不变（用户以为改了、其实没改），或者本轮跟着变（进度环跳一下、
     * 而落盘的计划时长与实际不符）。两种都比"暂时不让改"更坏。
     *
     * 返回 `false` 让调用方能给出解释 —— 灰掉一个控件却不说为什么，
     * 是这个仓库反复记过的最坏做法（对照 `roadmap.md` §5.1.1）。
     */
    if (get().state.phase !== 'idle') return false;
    const config = { ...get().config, ...partial };
    saveFocusConfig(config);
    set({ config });
    return true;
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
    set({ overview: deriveOverview(), error: undefined });
  } catch (error: unknown) {
    stopTicking();
    set({
      error: {
        code: focusLogFailureCode(error),
        reason: error instanceof Error ? error.message : String(error),
      },
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
  useFocusStore.setState({ overview: deriveOverview() });
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
    overview: EMPTY_OVERVIEW,
    tick: 0,
    error: undefined,
  });
}
