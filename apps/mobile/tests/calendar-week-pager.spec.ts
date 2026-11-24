import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

/**
 * 周历条的判据：它必须是**虚拟化原生滚动**，而不是"一格一周 + 等弹簧跑完才提交"。
 *
 * 为什么钉这个形状：旧实现把提交换周挂在弹簧完成回调上，快速连拨时新拖拽会
 * `stopAnimation` 打断弹簧 → 那一次翻周被丢掉（实测 5 次快拨只前进 2 周），
 * 体感就是"只能到下一周"。改用系统滚动后，手势/动量/吸附都是原生的，连拨不丢。
 */
describe('周历条无限滚动（虚拟化原生分页）', () => {
  it('用横向虚拟化列表 + 固定页宽布局，任意周索引 O(1) 定位', () => {
    const code = source('../src/screens/CalendarWeekPager.tsx');
    expect(code).toContain('<FlatList');
    expect(code).toContain('horizontal');
    expect(code).toContain('getItemLayout');
    expect(code).toContain('initialScrollIndex');
    expect(code).toContain('snapToInterval');
    expect(code).toContain('keyExtractor');
  });

  it('松手吸附后按落点页数回调，而不是"一次手势只翻一周"', () => {
    const code = source('../src/screens/CalendarWeekPager.tsx');
    expect(code).toContain('onMomentumScrollEnd');
    expect(code).toContain('weekIndexAtOffset');
    expect(code).toContain('onShiftWeeks(landed - previous)');
  });

  it('索引 ↔ 日期换算走共享纯函数，不在组件里重写日期数学', () => {
    const code = source('../src/screens/CalendarWeekPager.tsx');
    expect(code).toContain("from '@heyta/ui'");
    expect(code).toContain('weekStartForIndex');
    expect(code).toContain('weekIndexFor');
  });

  it('不再把提交换周挂在弹簧完成回调上（那正是丢手势的根因）', () => {
    const code = source('../src/screens/CalendarWeekPager.tsx');
    expect(code).not.toContain('pendingReset');
    expect(code).not.toContain('Animated.spring');
    expect(code).not.toContain('if (finished)');
  });

  it('CalendarScreen 用周条分页器，并按"周数差"移动选中', () => {
    const screen = source('../src/screens/CalendarScreen.tsx');
    expect(screen).toContain('<CalendarWeekPager');
    expect(screen).toContain('onShiftWeeks={shiftWeek}');
    expect(screen).not.toContain('onShiftWeek={shiftWeek}');
    // 多周一次更新（乘法），不是循环 setState
    expect(screen).toContain('addDays(selected, 7 * weeks)');
  });

  it('周条每一页都 memo 化，翻周时不连带重渲染不动的那几页', () => {
    const strip = source('../src/screens/CalendarWeekStrip.tsx');
    expect(strip).toContain('React.memo(');
  });
});
