/**
 * 移动端日历拖拽 · 命中判定
 * ==========================
 *
 * 纯几何工具：不依赖 React，便于单测。
 * 每个日期格在窗口中的矩形由 `renderDayCellWrapper` 通过 onLayout +
 * measureInWindow 登记到 Map 中；拖动时用触点坐标反查命中的日期。
 */

export interface DayCellRect {
  readonly date: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 长按多久后进入拖拽态。 */
export const LONG_PRESS_DELAY_MS = 350;

/** 长按计时期间允许的手指抖动（超出即取消长按）。 */
export const DRAG_MOVE_TOLERANCE_PX = 8;

/**
 * 用触点坐标反查命中的日期格。
 *
 * 矩形边界取闭区间（含上/下/左/右边界）；若相邻格共享边界，按 Map 的
 * 迭代顺序返回第一个命中的日期。未命中返回 null。
 */
export function findHitDayCell(
  rects: ReadonlyMap<string, DayCellRect>,
  pageX: number,
  pageY: number,
): string | null {
  for (const rect of rects.values()) {
    if (
      pageX >= rect.x &&
      pageX <= rect.x + rect.width &&
      pageY >= rect.y &&
      pageY <= rect.y + rect.height
    ) {
      return rect.date;
    }
  }
  return null;
}
