import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('日历周条跟手动效', () => {
  it('渲染前后一周与当前周，拖动时连续跟手', () => {
    const code = source('../src/screens/CalendarWeekPager.tsx');
    expect(code).toContain('addDays(weekStart, -7)');
    expect(code).toContain('addDays(weekStart, 7)');
    expect(code).toContain('onPanResponderMove');
    expect(code).toContain('translateX');
  });

  it('松手按动量选页，并把速度交给设计系统弹簧', () => {
    const code = source('../src/screens/CalendarWeekPager.tsx');
    expect(code).toContain('adjacentPageForRelease');
    expect(code).toContain("springFor('move'");
    expect(code).toContain('velocity:');
    expect(code).toContain('reducedMotion');
    expect(code).toContain('gesture.dx - gestureOrigin.current');
    expect(code).toContain('pendingReset');
  });

  it('CalendarScreen 使用周条分页器，不再只监听松手', () => {
    const code = source('../src/screens/CalendarScreen.tsx');
    expect(code).toContain('<CalendarWeekPager');
    expect(code).not.toContain('const weekSwipe = useMemo');
  });
});
