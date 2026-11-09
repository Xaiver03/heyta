/**
 * 流式揭示引擎 —— 「已到达」与「已显示」之间的那一层
 * ==================================================
 *
 * ## 为什么需要它
 *
 * `apps/web` 的流式链路是**齐的**：`packages/ai/src/stream.ts` 解 SSE →
 * `packages/app-host` 归约成 `AssistantTurnEvent` → `reduceAssistantLive()`
 * 把片段拼成 `live.text`。缺的只有最后一跳：**`live.text` 是整段直接渲染的**，
 * 于是模型吐多快就闪多快 —— 一帧到 200 字与一帧到 5 字，屏上是同一种"唰"。
 *
 * 本文件补的就是那一跳：把「已到达的完整文本」按节奏**逐字揭示**。
 *
 * ## 🔴 第一原则：数据层不滞后，只有显示层滞后
 *
 * `reduceAssistantLive()` 保持纯函数、保持"到达即完整" —— 它是**数据契约**，
 * 测试断言的是它。本引擎只产出**显示用**的文本，绝不回写数据层。
 * 这条界线是刻意的：一个"连数据都变慢"的动效会让测试、历史、可访问性一起变脆。
 *
 * ## 算法来源与它解决的问题
 *
 * 手法取自 assistant-ui 的 `useSmooth`（MIT，commit `29638c4e`，
 * 见 `docs/research/ai-chat-motion-source-study.md` §2.2）：**自适应追赶**。
 *
 * ```text
 * baseTimePerChar = min(maxCharIntervalMs, drainMs / remainingChars)
 * ```
 *
 * 积压越多 → 每字越快 → 在 `drainMs` 内排空。**结果是恒定的"排空时间"，
 * 而不是恒定的"打字速度"。** 定速打字机（ant-design/x 的固定
 * `interval:100/step:6`）在积压时只会越拖越久，最后与内容脱节。
 *
 * ## 🔴 为什么不是"照搬"assistant-ui
 *
 * 1. **它是 DOM 专属的**。`useSmooth` 用 `performance.now()` + `requestAnimationFrame`
 *    直接驱动 React state；它的官方 RN 绑定 `@assistant-ui/react-native` 里
 *    **一行动效都没有**（实测 grep `useSmooth|Animated|reanimated` 零命中）。
 * 2. **`packages/ui` 是单份代码跑 web + RN**（无 `.native/.web` 分叉），
 *    所以这里写成**平台无关的纯逻辑 + 注入时钟**：RN 与 DOM 用同一个引擎，
 *    测试用假时钟推进，不需要真的等 250ms。
 *
 * ## 一张必须被钉住的判据
 *
 * 🔴 **任何时刻 `revealed` 都必须 `target.startsWith(revealed)`** ——
 * 揭示的是**前缀**，不是"另一段文字"。内容被整体换掉（换会话、换消息）时
 * 必须**重置**，不能续着往下吐，否则屏上会出现两段内容拼起来的幻觉文本。
 */

/**
 * 平台无关的最小时钟。
 *
 * 🔴 **不直接用 `performance.now` / `requestAnimationFrame`**：那样这个模块
 * 在 RN（有 rAF 但没有 DOM event）与测试（要可控推进）里就没法跑同一份逻辑。
 * 注入是这里唯一的可测性设计。
 */
export interface RevealClock {
  /** 单调递增的毫秒读数。 */
  now(): number;
  /**
   * 安排下一帧，返回取消函数。
   *
   * ⚠️ 返回取消函数而不是"id"：调用方（React effect / RN Animated）各自
   * 有不同的句柄类型（`number` / `Animated.CompositeAnimation`），
   * 统一成"一个能取消的函数"让本模块不需要知道它们。
   */
  schedule(frame: () => void): () => void;
}

/** 揭示节奏的可调参数。全部有默认值，且**默认值不是拍的**（见下方各自出处）。 */
export interface RevealOptions {
  /**
   * 排空积压的**目标时间**（毫秒）。
   *
   * assistant-ui 的默认是 250 —— 那是为 DOM 渲染调的。这里取 **200**：
   * 与 `--ht-duration-normal`（`tokens.css`）同档，理由是我们的流式片段
   * 到达间隔比 assistant-ui 的默认场景密（app-host 逐 `delta` 回调），
   * 250ms 会让"最后一个字"在流结束后还多拖一会儿。
   */
  readonly drainMs?: number | undefined;
  /**
   * 每字**最慢**间隔（毫秒）。积压少时揭示速度的下限。
   *
   * 5 是 assistant-ui 的默认值，也是"人眼读得出在动"的下限附近；
   * 再大（如 16）在 60fps 下会退化成"每帧一个字"，看起来发顿。
   */
  readonly maxCharIntervalMs?: number | undefined;
  /** 每帧最多揭示几个字。默认不限制（`Infinity`）。 */
  readonly maxCharsPerFrame?: number | undefined;
}

/** 已冻结的默认值。导出是为了让测试断言"默认就是这几个数"，而不是抄一遍。 */
export const REVEAL_DEFAULTS = {
  drainMs: 200,
  maxCharIntervalMs: 5,
} as const;

/**
 * 一次揭示的**推进结果**。
 *
 * 纯数据，不含任何 React —— 于是"推进一帧"这件事可以在 node 里测穿，
 * 不需要渲染任何组件，也不需要真的过 16ms。
 */
export interface RevealStep {
  /** 这一帧之后应该显示的文本（永远是 `target` 的前缀）。 */
  readonly revealed: string;
  /** 这一帧又吐出了几个字。0 = 这一帧什么都没吐。 */
  readonly added: number;
  /** 是否已经追上 `target`。true 之后不必再排帧。 */
  readonly done: boolean;
}

/**
 * 揭示引擎的**纯逻辑**：给定当前已显示的长度与目标文本，算出这一帧推进到哪。
 *
 * 🔴 这是本模块的心脏，也是唯一值得单独测的部分。它**不持有状态** ——
 * 状态（`revealedLength` / `lastFrameTime`）由调用方（`createReveal` 或 hook）
 * 拿着，这样同一个函数既能被 hook 用，也能被测试直接调。
 *
 * @param revealedLength 当前已显示的**字符数**（不是字节、不是码点 ——
 *   与 `String.prototype.slice` 同一口径，中文与 emoji 才不会被切坏）。
 * @param target 已到达的完整文本。
 * @param elapsedMs 距上一帧经过的毫秒。
 * @param options 节奏参数。
 */
export function advanceReveal(
  revealedLength: number,
  target: string,
  elapsedMs: number,
  options: RevealOptions = {},
): RevealStep {
  const drainMs = options.drainMs ?? REVEAL_DEFAULTS.drainMs;
  const maxCharIntervalMs = options.maxCharIntervalMs ?? REVEAL_DEFAULTS.maxCharIntervalMs;
  const maxCharsPerFrame = options.maxCharsPerFrame ?? Infinity;

  // 🔴 负的 elapsed（时钟回拨、测试乱序推进）当成 0，不要当成"倒欠时间"。
  // 一个负的 elapsed 会让 `while` 一次都不进，症状是"动画卡住不动"，
  // 而根因在时钟不在算法 —— 这里挡掉它，让卡住只可能是别的原因。
  let timeToConsume = elapsedMs > 0 ? elapsedMs : 0;

  const remaining = target.length - revealedLength;

  // 已经追上：done，且不再消耗时间。
  if (remaining <= 0) {
    return { revealed: target.slice(0, revealedLength), added: 0, done: true };
  }

  /**
   * 自适应核心：积压越多，每字耗时越短。
   *
   * `drainMs / remaining` 就是"想在 drainMs 内排空，每字该分到多少毫秒"；
   * 用 `maxCharIntervalMs` 封顶（取 min）保证积压少时不过快 ——
   * 只剩 2 个字时不该用 0.001ms/字闪过去，那看起来像瞬移。
   */
  const baseTimePerChar = Math.min(maxCharIntervalMs, drainMs / remaining);

  const frameLimit = Math.min(remaining, maxCharsPerFrame);
  let charsToAdd = 0;
  while (timeToConsume >= baseTimePerChar && charsToAdd < frameLimit) {
    charsToAdd += 1;
    timeToConsume -= baseTimePerChar;
  }

  /**
   * ⚠️ 关于"被截断的帧不结转剩余时间"——**本函数里这件事不存在，别照搬**。
   *
   * assistant-ui 的 `useSmooth.ts:99-103` 有这条纪律，因为它的动画器**持有**
   * `lastUpdateTime` 并把没用完的时间写回去。本函数是**纯函数**：
   * `timeToConsume` 是局部变量，下一次调用会被 `elapsedMs` 完全覆盖，
   * 所以"结转"在结构上就不可能发生 —— 上限天然就是上限。
   *
   * 我最初把那条纪律连同归零语句一起搬了过来，并写了一条测试声称在测它；
   * **变异测试证明那条测试抓不住删除归零语句**（因为删了行为也不变）。
   * 现在归零语句被删掉了 —— 留一段"防一个不会发生的事"的代码只会误导后来者。
   */

  const nextLength = Math.min(revealedLength + charsToAdd, target.length);
  return {
    revealed: target.slice(0, nextLength),
    added: charsToAdd,
    done: nextLength >= target.length,
  };
}

/**
 * 一个可驱动的揭示器：把 `advanceReveal` 的纯逻辑接到真实时钟上。
 *
 * `schedule` 是**注入**的，所以：
 *   · web 传 `requestAnimationFrame` → 与显示器同步；
 *   · RN 传 `requestAnimationFrame`（RN 有）或 `Animated` 驱动的 tick；
 *   · 测试传手动推进的假时钟 → 不需要真的等 200ms。
 */
export interface Reveal {
  /** 告诉引擎"目标文本变成了这个"。幂等；同值重复调用不会有副作用。 */
  setTarget(target: string): void;
  /** 立即把已显示的补成完整目标（不播放）。用于降级、卸载、流结束兜底。 */
  finish(): void;
  /** 当前应该显示的文本。 */
  current(): string;
  /**
   * 开始推进。重复调用安全（已经在跑就什么都不做）。
   *
   * `onReveal` 在**文本真的变了**时才回调 —— 不是每帧都回调。
   * 这条很重要：每帧回调会让 React 每帧重渲染，而其中大多数帧
   * `added === 0`（未到 interval），白白重排。
   */
  start(onReveal: (revealed: string) => void): void;
  /** 停表并解绑。之后 `current()` 仍可读，但不会再推进。 */
  stop(): void;
}

/**
 * 造一个揭示器。
 *
 * @param clock 注入时钟。见 `RevealClock` 的注释（为什么不直接用全局的）。
 * @param initial 初始已显示的文本（通常是空串 —— 一轮开始时屏上什么都没有）。
 */
export function createReveal(clock: RevealClock, initial = ''): Reveal {
  let target = initial;
  let revealed = initial;
  let lastFrameTime = clock.now();
  let cancel: (() => void) | null = null;
  let running = false;

  const invoke = (onReveal: (revealed: string) => void): void => {
    running = false;
    cancel = null;

    const now = clock.now();
    const step = advanceReveal(revealed.length, target, now - lastFrameTime);
    /**
     * 🔴 `lastFrameTime` 的推进方式：`now`，**不是** `now - 剩余时间`。
     *
     * assistant-ui 那边用 `currentTime - timeToConsume` 把"没用完的时间"
     * 结转到下一帧，对**每帧都跑**的 rAF 是对的。但我们的实现只在
     * "文本真的变了"时才重排下一帧（见上面 `onReveal` 的注释），
     * 中间那些空帧根本不进入调度 —— 于是结转没有意义，还会把
     * 攒下的时间一次性爆发。用 `now` 最简单也最不会错。
     */
    lastFrameTime = now;

    if (step.added > 0) {
      revealed = step.revealed;
      onReveal(revealed);
    }

    if (!step.done) {
      running = true;
      cancel = clock.schedule(() => invoke(onReveal));
    }
  };

  return {
    setTarget(next: string): void {
      /**
       * 🔴 目标**不再是已显示内容的前缀** ⇒ 这是一次换内容，不是续写。
       *
       * 典型场景：切会话、重挂载后拿到另一条消息。续着往下吐会把两段内容
       * 拼成一段屏上从未真实存在过的文本 —— 那比不做动效危险得多。
       */
      if (!next.startsWith(revealed)) {
        revealed = '';
        lastFrameTime = clock.now();
      }
      target = next;
    },
    finish(): void {
      if (cancel !== null) {
        cancel();
        cancel = null;
      }
      running = false;
      target = target;
      revealed = target;
    },
    current(): string {
      return revealed;
    },
    start(onReveal: (revealed: string) => void): void {
      if (running) return;
      lastFrameTime = clock.now();
      running = true;
      cancel = clock.schedule(() => invoke(onReveal));
    },
    stop(): void {
      if (cancel !== null) {
        cancel();
        cancel = null;
      }
      running = false;
    },
  };
}
