/**
 * `useStreamReveal` —— 把揭示引擎接到 React 上
 * ============================================
 *
 * 引擎本体在 `reveal.ts`（纯逻辑 + 注入时钟）。本文件只做三件事：
 * 拿真实时钟、在文本变化时驱动它、在降级条件下**立刻**给出完整文本。
 *
 * ## 🔴 降级的三条路，都要给出"完整文本"而不是"不显示"
 *
 * | 条件 | 行为 |
 * |---|---|
 * | `prefers-reduced-motion: reduce` | 立即全文（不播动画） |
 * | `enabled === false`（调用方显式关） | 立即全文 |
 * | 组件卸载 / 文本已被完整揭示 | 停表 |
 *
 * ⚠️ 特别注意第一条的**方向**：减少动效的用户要的是"内容照常出现，只是别动"，
 * **不是**"内容慢慢挤出来"。把降级做成"不显示"是一个常见且严重的误实现。
 *
 * ## 🔴 为什么 `enabled` 要显式给、而不是自动判环境
 *
 * 组件测试（`apps/web/tests/ai-assistant-panel.spec.tsx`）断言的是**数据契约**：
 * 流式某一刻屏上的文本等于已到达的文本。若引擎在测试里自动播放，那些断言
 * 会去考"动画播到第几帧"，把数据契约测成时序契约 —— 那是把测试变脆，
 * 不是把功能测严。
 *
 * 所以本 hook 把"要不要播"作为**入参**：生产传 true，组件测试传 false，
 * 而引擎自己的行为由 `ai-reveal.spec.ts` 用假时钟单独测穿。
 * 与 assistant-ui 把 `smooth` 做成 prop 是同一个判断（见
 * `docs/research/ai-chat-motion-source-study.md` §2.2）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { RevealClock, RevealOptions } from './reveal.js';
import { createReveal } from './reveal.js';

/**
 * 真实时钟：`requestAnimationFrame` + `performance.now()`。
 *
 * ⚠️ 两者都不可用时返回 `null`，调用方据此**整体关闭揭示**（退化成"到达即显示"）——
 * 而不是抛错或永久卡住。SSR / 极老运行时 / 某些测试环境都可能缺它们。
 */
function realClock(): RevealClock | null {
  if (typeof requestAnimationFrame !== 'function') return null;
  return {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    schedule: (frame) => {
      const handle = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(handle);
    },
  };
}

export interface UseStreamRevealOptions extends RevealOptions {
  /**
   * 是否播放揭示。
   *
   * 🔴 调用方**必须**把它与 `reducedMotion` 结合后传进来（生产环境）。
   * 写成 `enabled && !reducedMotion` 那一处判断留在调用方，是为了让
   * "这里为什么关了"在调用点一眼可见，而不是藏在 hook 里。
   */
  readonly enabled: boolean;
}

/**
 * 把"已到达的文本"变成"该显示的文本"。
 *
 * @param target 已到达的完整文本（来自 `reduceAssistantLive` 的 `live.text`）。
 * @param options `enabled` 必填；其余节奏参数有默认值。
 * @returns 当前应显示的文本。它**永远是 `target` 的前缀**。
 */
export function useStreamReveal(target: string, options: UseStreamRevealOptions): string {
  const { enabled, drainMs, maxCharIntervalMs, maxCharsPerFrame } = options;

  /**
   * 🔴 `useState` 的初值用**惰性函数**，直接给完整文本还是空串要分情况：
   * 关闭揭示时必须是 `target`（降级 = 立即全文）；开启时从空串开始。
   *
   * ⚠️ 初值只在挂载时算一次，所以它读的是**挂载那一刻**的 `target`。
   * 之后的变化由下面的 effect 处理 —— 这是对的：挂载时这一段流已经跑了多久
   * 我们无从知道，从头播反而会把用户已经看过的字重播一遍。
   */
  const [revealed, setRevealed] = useState(() => (enabled ? '' : target));

  const clockRef = useRef<RevealClock | null>(null);
  const revealRef = useRef<ReturnType<typeof createReveal> | null>(null);

  // 时钟只建一次。`useMemo` 而不是 `useRef`+if：`realClock` 是纯的，
  // 而 useMemo 的语义（"同一依赖下复用"）正好表达"应用生命周期内一个时钟"。
  const clock = useMemo(() => realClock(), []);

  useEffect(() => {
    clockRef.current = clock;
    if (clock === null) {
      // 没有 rAF：退化。把当前目标直接交出去，不做动画。
      revealRef.current = null;
      return undefined;
    }
    const reveal = createReveal(clock);
    revealRef.current = reveal;
    return () => {
      reveal.stop();
      revealRef.current = null;
    };
  }, [clock]);

  useEffect(() => {
    const reveal = revealRef.current;
    if (reveal === null) {
      // 无时钟：永远是"到达即显示"。
      setRevealed(target);
      return undefined;
    }

    if (!enabled) {
      // 降级：立即全文，并停掉可能还在跑的动画。
      reveal.setTarget(target);
      reveal.finish();
      setRevealed(target);
      return undefined;
    }

    reveal.setTarget(target);
    reveal.start((next) => setRevealed(next));
    return () => {
      reveal.stop();
    };
  }, [enabled, target]);

  /**
   * 🔴 卸载即停表。少了这个，一个正在播的动画会在组件消失后继续排帧，
   * 并在下一帧对已卸载的组件 `setState` —— React 18+ 不再警告，
   * 但那段循环会一直跑到追上 target 才自然结束（长文本下就是几百帧的浪费）。
   */
  useEffect(
    () => () => {
      revealRef.current?.stop();
    },
    [],
  );

  return revealed;
}
