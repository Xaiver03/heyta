/**
 * 手势结束后的动量与边界反馈。
 *
 * 这里的位移使用 dp，速度使用 dp/s；PanResponder 的 vx/vy 是 dp/ms，
 * 消费方必须在边界上乘 1000。所有判定只吃设计系统给出的减速率。
 */

/** 按指数减速预测手势最终会停在哪里。 */
export function projectGestureOffset(
  offset: number,
  velocityPerSecond: number,
  decelerationRate: number,
): number {
  if (velocityPerSecond === 0) return offset;
  return offset + (velocityPerSecond / 1000) * decelerationRate / (1 - decelerationRate);
}

/** 越过边界后的跟手位移：越拖阻力越大，不会在边界上突然冻住。 */
export function rubberBandOffset(overshoot: number, dimension: number): number {
  if (overshoot <= 0 || dimension <= 0) return 0;
  const resistance = 0.55;
  return (overshoot * dimension * resistance) / (dimension + resistance * overshoot);
}

/**
 * 相邻三页分页器松手后的去向：-1 上一页 / 0 留在当前页 / 1 下一页。
 * offset 是相对当前页的位移，velocityPerMillisecond 直接接 PanResponder 的 vx。
 */
export function adjacentPageForRelease(
  offset: number,
  velocityPerMillisecond: number,
  pageWidth: number,
  decelerationRate: number,
): -1 | 0 | 1 {
  if (pageWidth <= 0) return 0;
  const projected = projectGestureOffset(offset, velocityPerMillisecond * 1000, decelerationRate);
  if (projected <= -pageWidth / 2) return 1;
  if (projected >= pageWidth / 2) return -1;
  return 0;
}
