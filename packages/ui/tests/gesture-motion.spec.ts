import { describe, expect, it } from 'vitest';

describe('手势动效数学', () => {
  it('按动量预测落点，而不是只看松手位置', async () => {
    const { projectGestureOffset } = await import('../src/motion/gesture.js');
    expect(projectGestureOffset(20, 0, 0.998)).toBe(20);
    expect(projectGestureOffset(20, 1000, 0.998)).toBeCloseTo(519);
    expect(projectGestureOffset(20, -1000, 0.998)).toBeCloseTo(-479);
  });

  it('越过边界时逐渐增加阻力，而不是硬停', async () => {
    const { rubberBandOffset } = await import('../src/motion/gesture.js');
    expect(rubberBandOffset(0, 800)).toBe(0);
    expect(rubberBandOffset(100, 800)).toBeGreaterThan(0);
    expect(rubberBandOffset(100, 800)).toBeLessThan(100);
    expect(rubberBandOffset(200, 800)).toBeGreaterThan(rubberBandOffset(100, 800));
  });

  it('日历轻甩可以跨页，缓慢短拖会回弹', async () => {
    const { adjacentPageForRelease } = await import('../src/motion/gesture.js');
    expect(adjacentPageForRelease(-20, -0.8, 390, 0.998)).toBe(1);
    expect(adjacentPageForRelease(-20, 0, 390, 0.998)).toBe(0);
    expect(adjacentPageForRelease(-220, 0, 390, 0.998)).toBe(1);
    expect(adjacentPageForRelease(220, 0, 390, 0.998)).toBe(-1);
  });
});
