/**
 * 横向拖拽换天的**绑定**（Web 壳；判据在 `drag-day.ts`）
 * =====================================================
 *
 * 只做一件事：把"按住 → 抬手"折成"往哪边一段"，交回宿主。
 * 走多远不在这里（`stepCalendarCursor`），算不算拖拽也不在这里（`readDragSegments`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 移动与抬手挂在 **window**，不是挂在宿主上
 *
 * 宿主是内容区那一层，而"往左拖"的**自然做法就是把指针拖出内容区**（越过侧栏）。
 * 挂在宿主上时那些事件落在侧栏子树里、冒不到这个宿主，
 * 症状是"轻轻拖有用、大幅度拖没反应"。
 * 第一版 e2e 正是大幅度那一下红的 —— **它红的是产品，不是判据**
 * （取证见 `docs/plans/ui-review-fill-zh-timeline.md` §9.12）。
 *
 * ⚠️ 刻意**不用** `setPointerCapture`：那会抢走 RN-web `Pressable` 已经拿到的指针，
 *   连带改变 `click` 的落点 —— 为一个手势改坏点击不值。
 *
 * ## 这里**没有**"吃掉拖完之后那次 click"的逻辑，因为实测它不会发生
 *
 * 直觉上必须防："指针从一行任务上横着拖过去，抬手时浏览器补发一次 `click`
 * ⇒ 翻了一天的同时把那条任务勾成完成"。2026-10-03 在 Chromium 上实测（探针挂在
 * `document` 的**捕获**阶段，任何 handler 吃掉都看得见）：
 *
 * · 起终点都在同一行内的 100px 短拖 ⇒ **一次 `click` 都没有派发**（`clicks=[]`），
 *   因为合格的那一下拖拽必然换天，而换天会替换掉那一屏的行元素，
 *   浏览器算不出"按下与抬起的公共祖先"还落在同一行上；
 * · 拖到内容区外同理。
 *
 * 所以那段吞 click 的代码是**为一个不会发生的场景写的分支**，删掉了。
 * ⚠️ 它回来的条件写清楚：如果哪天日档里出现**跨天仍然保持同一 DOM 元素**的行
 *   （比如"钉住的任务"那种常驻行），上面那条实测就不再成立，得把吞 click 加回来。
 *   界面上"拖拽不许改动任务"这条**不变量本身**由 e2e 的第三条判据守着，不靠这里。
 */

import { useEffect, useRef } from 'react';

import { readDragSegments } from './drag-day.js';

export interface DragDayNavOptions {
  /**
   * 只有落在这个选择器命中的元素**内部**（含自身）的按下才算这一档的手势。
   * 不给 = 挂在哪个元素上就整块都算。
   */
  readonly within?: string | undefined;
  /** 关掉时**完全不挂监听**（不是"挂了但返回"）：别的档位里这就是一个陌生手势。 */
  readonly enabled?: boolean | undefined;
}

/**
 * @param onStep `-1` 往过去一段 / `+1` 往未来一段。
 * @param hostRef 起手挂在哪个元素上（与滚轮那一层同一个宿主）。
 */
export function useDragDayNav(
  hostRef: React.RefObject<HTMLElement | null>,
  onStep: (step: -1 | 1) => void,
  options: DragDayNavOptions = {},
): void {
  const { within, enabled = true } = options;
  const stepRef = useRef(onStep);
  stepRef.current = onStep;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || !enabled) return;

    let startX = 0;
    let startY = 0;
    let down = false;

    const onPointerDown = (event: PointerEvent) => {
      // 只认鼠标左键 / 触摸 / 笔。右键留给上下文菜单，中键是"在新标签打开"。
      if (event.button !== 0) return;
      if (within !== undefined) {
        if (!(event.target instanceof Element) || event.target.closest(within) === null) return;
      }
      down = true;
      startX = event.clientX;
      startY = event.clientY;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!down) return;
      // 已经明显是横向拖拽了才取消选中：轻点时这句是空操作，不碰用户的选区。
      if (readDragSegments(event.clientX - startX, event.clientY - startY) !== 0) {
        window.getSelection()?.removeAllRanges();
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!down) return;
      down = false;
      const step = readDragSegments(event.clientX - startX, event.clientY - startY);
      if (step === 0) return;
      stepRef.current(step);
    };

    const onCancel = () => {
      down = false;
    };

    host.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [hostRef, within, enabled]);
}
