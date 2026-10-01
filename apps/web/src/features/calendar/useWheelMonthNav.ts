/**
 * 滚轮翻月的**绑定**（Web 壳）
 * ============================
 *
 * 判据全在 `wheel-month.ts`（纯函数、可单测）；这里只做一件事：把 DOM 事件
 * 接到那条判据上，并把结果交回宿主的状态（`useCalendarViewStore.setCursor`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么是 `addEventListener('wheel', …, { passive: false })`，不是 `onWheel`
 *
 * React 把 `wheel` 挂在**根容器**上且注册成 **passive** 监听，而 passive 监听里
 * `preventDefault()` 是**空操作**（规范里它静默返回，不抛）。所以这里必须自己挂
 * 原生监听并显式写 `{ passive: false }`。
 *
 * 🔴 挂成 passive 之后的症状**比"翻月 + 页面一起滚"更糟**，这是 2026-10-01 在
 * Chromium 上实测的形状：浏览器**先在合成线程滚**，再把事件派发回主线程，
 * 而派发时的 `event.target` 是**按滚动后的位置**命中测试出来的 —— 格子已经从
 * 指针底下移走了。于是 `within` 判定失败、`consume` 为假、代码根本走不到
 * `preventDefault()`（控制台因此**一句警告都没有**），症状是"滚轮彻底没反应，
 * 页面倒是滚了"。元素在、监听在、`role` 也对，全都是绿的。
 *
 * ⚠️ jsdom **看得见** passive 这一半（它实现了规范里的 in-passive 标志，
 * `defaultPrevented` 会留在 `false`，单测里那条"归月历的滚轮必须被吃掉"会红），
 * 但看不见另一半：jsdom 没有布局和滚动，事件目标**不会**从格子底下移走，月份照旧翻。
 * ⇒ "滚了页面"这一类只有在真浏览器里才现形，见 `e2e/tests/calendar-wheel.spec.ts`。
 *
 * ⚠️ 挂在**包裹层**上、用 `within` 决定哪些事件归月历：月历卡片下面的
 * 当天清单需要正常滚动，把整块都吃掉的话，指针停在那儿就再也滚不动页面了。
 */

import { useEffect, useRef } from 'react';

import { IDLE_WHEEL_ACCUMULATOR, readWheelMonth, type WheelAccumulator } from './wheel-month.js';

export interface WheelMonthNavOptions {
  /**
   * 只有落在这个选择器命中的元素**内部**（含自身）的滚轮事件才归月历。
   * 不给 = 这一整块都归月历。
   */
  readonly within?: string | undefined;
}

/**
 * @param onStep `-1` 上一月 / `1` 下一月。翻月是**无限**的：不设上下界，
 *               也不碰"选中的那天"（那是另一件事，见 store 里 `setCursor` 的说明）。
 */
export function useWheelMonthNav(
  onStep: (step: -1 | 1) => void,
  options: WheelMonthNavOptions = {},
): React.RefObject<HTMLDivElement | null> {
  const hostRef = useRef<HTMLDivElement | null>(null);
  /** 最新回调放 ref：否则每次渲染都要重新订阅一次监听。 */
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const { within } = options;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    /** 跨事件累计量。放局部而不是模块级：两列（主区月历 / 侧栏迷你月历）各自一套。 */
    let accumulator: WheelAccumulator = IDLE_WHEEL_ACCUMULATOR;

    const onWheel = (event: WheelEvent) => {
      if (
        within !== undefined &&
        (!(event.target instanceof Element) || event.target.closest(within) === null)
      ) {
        accumulator = IDLE_WHEEL_ACCUMULATOR;
        return;
      }
      const next = readWheelMonth(
        {
          deltaY: event.deltaY,
          deltaX: event.deltaX,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
        },
        accumulator,
        Date.now(),
      );
      accumulator = next.accumulator;
      if (!next.consume) return;
      // 🔴 归月历所有的事件必须**先吃掉再翻**：反过来（先翻再吃）在 preventDefault
      // 被浏览器拒绝的那一端就会退化成"翻月 + 滚页"两件事同时发生。
      event.preventDefault();
      if (next.step !== 0) stepRef.current(next.step);
    };

    host.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      host.removeEventListener('wheel', onWheel);
    };
  }, [within]);

  return hostRef;
}
