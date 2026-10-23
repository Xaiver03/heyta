import { describe, expect, it } from 'vitest';

import {
  DETENT_FRACTION,
  SHEET_DETENTS,
  detentForHeight,
  detentHeight,
  dismissThresholdPx,
  nextDetent,
  normalizeDetents,
  resolveInitialDetent,
  shouldDismissOnRelease,
  type SheetDetent,
} from '../src/overlay/sheet-detents.js';

/** 规范档位集合。`SHEET_DETENTS` 是 `as const`，测试用例里要当数组用。 */
const ALL: readonly SheetDetent[] = SHEET_DETENTS;

describe('sheet-detents · 归一化', () => {
  it('空集合回落成单档 medium，而不是静默变成全档', () => {
    // 🔴 这是本文件最重要的一条：宿主写"这层只允许一档"而归一化悄悄还给三档，
    // 等于宿主那句约束没有生效 —— 空集合必须是"没有把手可拖"那一类。
    expect(normalizeDetents([])).toEqual(['medium']);
  });

  it('按规范顺序排序并去重，不管宿主怎么传', () => {
    expect(normalizeDetents(['large', 'small'])).toEqual(['small', 'large']);
    expect(normalizeDetents(['large', 'small', 'large'])).toEqual(['small', 'large']);
  });

  it('集合外的档位被丢掉而不是保留', () => {
    // @ts-expect-error 故意传一个不在类型里的值：运行时也要拦住，不能信类型。
    expect(normalizeDetents(['small', 'enormous'])).toEqual(['small']);
  });
});

describe('sheet-detents · 把手循环', () => {
  it('单档时点把手返回自己 —— 不凭空多出一档', () => {
    expect(nextDetent('medium', ['medium'])).toBe('medium');
  });

  it('往上一档，到顶回到最小档', () => {
    expect(nextDetent('small', ALL)).toBe('medium');
    expect(nextDetent('medium', ALL)).toBe('large');
    expect(nextDetent('large', ALL)).toBe('small');
  });

  it('当前档已不在允许集合里时从头开始，而不是"点了没反应"', () => {
    expect(nextDetent('large', ['small', 'medium'])).toBe('small');
  });
});

describe('sheet-detents · 吸附', () => {
  it('落在最近的允许档', () => {
    expect(detentForHeight(detentHeight('small', 800), 800, ALL)).toBe('small');
    expect(detentForHeight(detentHeight('large', 800), 800, ALL)).toBe('large');
  });

  it('拖拽能拖到 0 或拖过头，返回值必然仍在集合内', () => {
    expect(ALL).toContain(detentForHeight(0, 800, ALL));
    expect(ALL).toContain(detentForHeight(-400, 800, ALL));
    expect(ALL).toContain(detentForHeight(99_999, 800, ALL));
  });

  it('宿主只给两档时不会吸附到被禁用的那一档', () => {
    const allowed: readonly SheetDetent[] = ['small', 'large'];
    // 0.6 * 800 = 480，正落在 medium 上；medium 不在集合里 ⇒ 必须去 small 或 large。
    expect(detentForHeight(480, 800, allowed)).not.toBe('medium');
  });
});

describe('sheet-detents · 记忆档位', () => {
  it('记忆生效时用它', () => {
    expect(resolveInitialDetent('small', ALL)).toBe('small');
  });

  it('没有记忆时用最大档（本仓这批面板是从 90% 迁来的）', () => {
    expect(resolveInitialDetent(undefined, ALL)).toBe('large');
  });

  it('记忆失效（不在允许集合内）时回落，不让记忆绕过档位约束', () => {
    expect(resolveInitialDetent('large', ['small', 'medium'])).toBe('medium');
  });
});

describe('sheet-detents · 下拉关闭阈值', () => {
  it('阈值是最小档的一半，不是写死的像素', () => {
    // small = 0.3 * 800 = 240 ⇒ 阈值 120
    expect(dismissThresholdPx(ALL, 800)).toBe(120);
  });

  it('矮于阈值才关，等于阈值不关', () => {
    expect(shouldDismissOnRelease(119, ALL, 800)).toBe(true);
    expect(shouldDismissOnRelease(120, ALL, 800)).toBe(false);
  });
});

describe('sheet-detents · 表本身的形状', () => {
  it('每个档位都有占比 —— 加档忘了定占比会在这里红', () => {
    for (const detent of ALL) {
      expect(typeof DETENT_FRACTION[detent]).toBe('number');
    }
  });

  it('最大档必须留出一条缝，否则没有"背景"可点', () => {
    // `dismissal.ts` 里 bottom-sheet 的 scrim 是 `dismiss` —— 贴满 100% 就没有背景了。
    expect(DETENT_FRACTION.large).toBeLessThan(1);
  });

  it('三档严格递增', () => {
    expect(DETENT_FRACTION.small).toBeLessThan(DETENT_FRACTION.medium);
    expect(DETENT_FRACTION.medium).toBeLessThan(DETENT_FRACTION.large);
  });
});
