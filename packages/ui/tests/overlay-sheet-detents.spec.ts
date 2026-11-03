import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SHEET_DETENT,
  DETENT_FRACTION,
  SHEET_DETENTS,
  detentForHeight,
  detentHeight,
  dismissThresholdPx,
  nextDetent,
  normalizeDetents,
  resolveDetentSeed,
  resolveInitialDetent,
  shouldDismissOnRelease,
  type SheetDetent,
} from '../src/overlay/sheet-detents.js';
import {
  SHEET_DRAG_REGIONS,
  isSheetDragRegion,
  type SheetDragRegion,
} from '../src/overlay/sheet-drag.js';

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

  it('没有记忆时用 medium —— 底部面板的全部意义是底下还看得见上下文', () => {
    // ⚠️ 这一条**曾经是 `large`**，而那个读数把"半屏面板"钉成了"打开即准全屏"。
    // 改它不是"让测试变绿"：是被判的那个默认值本身被推翻了，
    // 依据写在 `sheet-detents.ts` 的 `fallbackDetent` 与
    // `docs/plans/task-detail-ticktick-parity.md` §1.1。
    expect(resolveInitialDetent(undefined, ALL)).toBe('medium');
    // 默认值只有**一个**出口，组件里不许再写第二处 `'large'` / `0.9`。
    expect(DEFAULT_SHEET_DETENT).toBe('medium');
  });

  it('记忆失效（不在允许集合内）时回落，不让记忆绕过档位约束', () => {
    expect(resolveInitialDetent('large', ['small', 'medium'])).toBe('medium');
  });

  it('记忆失效时回落到**允许集合内**的那一档，而不是绕过集合', () => {
    // 🔴 上一那条现在**分不出好坏**：允许集合里有 medium，而默认档也是 medium，
    // 所以"回落对了"与"根本没判允许集合"会给出同一个读数。
    // 这一条换成单档集合：记住的 `large` 不在集合里 ⇒ 只能回落到 `small`，
    // 任何"原样返回记住的那一档"或"返回不在集合里的默认档"都会红。
    expect(resolveInitialDetent('large', ['small'])).toBe('small');
  });
});

describe('sheet-detents · 起始档位优先级（记忆 > 宿主默认 > 模型默认）', () => {
  it('记忆压过宿主写死的默认档 —— 否则每次打开都把手势选择抹掉', () => {
    expect(resolveDetentSeed('small', 'large', ALL)).toBe('small');
  });

  it('没有记忆时用宿主默认档', () => {
    expect(resolveDetentSeed(undefined, 'large', ALL)).toBe('large');
  });

  it('两者都没有时落回模型默认档', () => {
    expect(resolveDetentSeed(undefined, undefined, ALL)).toBe(DEFAULT_SHEET_DETENT);
  });

  it('记忆不在允许集合内时**不**绕过约束（与 `resolveInitialDetent` 同一条不变量）', () => {
    expect(resolveDetentSeed('large', undefined, ['small'])).toBe('small');
  });
});

describe('sheet-drag · 哪些区域能发起拖拽', () => {
  it('把手与标题栏能拖', () => {
    expect(isSheetDragRegion('handle')).toBe(true);
    expect(isSheetDragRegion('header')).toBe(true);
  });

  it('🔴 内容区不接拖拽 —— 没有 gesture-handler 时"想滚却把面板关了"比没有更糟', () => {
    // 这一条是**反向**判据：将来有人"顺手补全"成四区全可拖，它必须红。
    expect(isSheetDragRegion('body')).toBe(false);
  });

  it('🔴 × 不接拖拽 —— 它是宿主唯一的具名出口，被抢走 responder 会变成点了没反应', () => {
    expect(isSheetDragRegion('closeButton')).toBe(false);
  });

  it('可拖集合就是那张表，不靠"除…之外"的补集写法', () => {
    const all: readonly SheetDragRegion[] = ['handle', 'header', 'closeButton', 'body'];
    expect(SHEET_DRAG_REGIONS).toEqual(all.filter(isSheetDragRegion));
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
