import { describe, expect, it } from 'vitest';

import { findHitDayCell, type DayCellRect } from '../src/screens/calendar-drag-hit';

function rect(date: string, x: number, y: number, width: number, height: number): DayCellRect {
  return { date, x, y, width, height };
}

function makeRects(...items: DayCellRect[]): ReadonlyMap<string, DayCellRect> {
  return new Map(items.map((item) => [item.date, item]));
}

describe('findHitDayCell', () => {
  // 2 行网格：上排 11-02 / 11-03，下排 11-04，每格 100×120。
  const rects = makeRects(
    rect('2026-11-02', 0, 0, 100, 120),
    rect('2026-11-03', 100, 0, 100, 120),
    rect('2026-11-04', 0, 120, 100, 120),
  );

  it('命中格子内部返回对应日期', () => {
    expect(findHitDayCell(rects, 50, 60)).toBe('2026-11-02');
    expect(findHitDayCell(rects, 150, 60)).toBe('2026-11-03');
    expect(findHitDayCell(rects, 50, 180)).toBe('2026-11-04');
  });

  it('边界也算命中（闭区间）', () => {
    expect(findHitDayCell(rects, 0, 0)).toBe('2026-11-02');
    expect(findHitDayCell(rects, 100, 120)).toBe('2026-11-02');
    expect(findHitDayCell(rects, 200, 120)).toBe('2026-11-03');
    expect(findHitDayCell(rects, 100, 240)).toBe('2026-11-04');
  });

  it('未命中任何格子返回 null', () => {
    expect(findHitDayCell(rects, -1, 10)).toBeNull();
    expect(findHitDayCell(rects, 250, 10)).toBeNull();
    expect(findHitDayCell(rects, 50, 300)).toBeNull();
  });

  it('空映射返回 null', () => {
    expect(findHitDayCell(new Map<string, DayCellRect>(), 10, 10)).toBeNull();
  });
});
