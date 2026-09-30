/**
 * 动效物理与降级
 * ================
 *
 * 这里钉住三件事，它们都是**不变量**而不是"当前取值"：
 *
 *   1. Apple 的「阻尼比 + 响应」→ Motion 的「stiffness / damping」换算
 *      是一条数学恒等式，不是拟合值。临界阻尼时必然有 `damping = 2√stiffness`。
 *   2. `prefers-reduced-motion` 下**位移必须消失**，但**透明度必须保留** ——
 *      去掉位移是可达性要求，去掉淡入是功能倒退。
 *   3. 错峰在降级时必须是 0（否则"减少动效"下元素仍然一个个慢慢出现）。
 *   4. 正常模式的入场**必须带 transition** —— 少了它 Motion 会静默回落到
 *      库内置的过冲弹簧（`underDampedSpring`，bounce≈0.44），
 *      整页的入场人格就都跑在 `tokens.css` 之外了。
 */

import { describe, expect, it } from 'vitest';
import type { Transition } from 'motion/react';

import {
  maskedRevealVariants,
  revealVariants,
  staggerContainer,
  toSpringOptions,
  VIEWPORT,
} from '../src/lib/motion.js';

/** 测试用的显式弹簧：与 `preset.ui` 同类（临界阻尼、不过冲）。 */
const TEST_TRANSITION: Transition = { type: 'spring', bounce: 0, duration: 0.4 };

describe('toSpringOptions：Apple 参数 → 二阶系统', () => {
  it('ω₀ = 2π / response，且 stiffness = ω₀²、damping = 2ζω₀', () => {
    const response = 0.4;
    const dampingRatio = 0.8;
    const omega = (2 * Math.PI) / response;

    const options = toSpringOptions(dampingRatio, response);

    expect(options.mass).toBe(1);
    expect(options.stiffness).toBeCloseTo(omega * omega, 10);
    expect(options.damping).toBeCloseTo(2 * dampingRatio * omega, 10);
  });

  it('临界阻尼（ζ=1）满足 damping = 2√stiffness —— 这条恒等式保证"不过冲"', () => {
    for (const response of [0.2, 0.3, 0.4, 0.5, 1]) {
      const { stiffness, damping } = toSpringOptions(1, response);
      // 这是临界阻尼的定义式，不是巧合：stiffness = ω²，damping = 2ω = 2√(ω²)
      expect(damping).toBeCloseTo(2 * Math.sqrt(stiffness), 10);
    }
  });

  it('ζ < 1 时阻尼更小 —— 也就是会过冲（动量手感）', () => {
    const critical = toSpringOptions(1, 0.4);
    const momentum = toSpringOptions(0.8, 0.4);
    expect(momentum.stiffness).toBeCloseTo(critical.stiffness, 10); // 响应相同
    expect(momentum.damping).toBeLessThan(critical.damping);
  });

  it('响应越短刚度越大（单调）', () => {
    const slow = toSpringOptions(1, 0.6);
    const fast = toSpringOptions(1, 0.3);
    expect(fast.stiffness).toBeGreaterThan(slow.stiffness);
  });
});

describe('revealVariants：减少动效时的降级', () => {
  it('正常模式带位移（y）', () => {
    const variants = revealVariants(false, TEST_TRANSITION);
    expect(variants.hidden).toHaveProperty('y');
    expect(variants.visible).toHaveProperty('y');
  });

  it('减少动效时**没有** y —— 位移是前庭不适的主要来源', () => {
    const variants = revealVariants(true, TEST_TRANSITION);
    expect(variants.hidden).not.toHaveProperty('y');
    expect(variants.visible).not.toHaveProperty('y');
  });

  it('减少动效时**保留** opacity —— 去掉淡入会让"状态变了"这条信息一起消失', () => {
    const variants = revealVariants(true, TEST_TRANSITION);
    expect(variants.hidden).toHaveProperty('opacity', 0);
    expect(variants.visible).toHaveProperty('opacity', 1);
  });

  /**
   * 🔴 这条钉的是一个**具体回归**：`revealVariants` 曾经不接收 transition，
   * 于是 `y` 走 Motion 的库默认值 `underDampedSpring`（stiffness 500/damping 25
   * → ζ≈0.56、bounce≈0.44），全页入场都变成过冲的，而且绕开了 tokens.css。
   * 现在 transition 是必填参数，这条断言保证它真的被挂到了 `visible` 上。
   */
  it('正常模式**必须**把调用方给的 transition 挂到 visible 上', () => {
    const variants = revealVariants(false, TEST_TRANSITION);
    const visible = variants['visible'] as { transition?: Transition } | undefined;
    expect(visible?.transition).toBe(TEST_TRANSITION);
  });
});

describe('maskedRevealVariants：遮罩式显现', () => {
  it('正常模式：hidden 在槽外（≥112%，盖住斜体降部余量），visible 归零并挂 transition', () => {
    const variants = maskedRevealVariants(false, TEST_TRANSITION);
    expect(variants['hidden']).toEqual({ y: '112%' });
    const visible = variants['visible'] as { y?: string; transition?: Transition };
    expect(visible.y).toBe('0%');
    expect(visible.transition).toBe(TEST_TRANSITION);
  });

  it('正常模式**不**用 opacity 隐藏 —— 遮罩与淡入的分工：看不见由裁剪表达', () => {
    const variants = maskedRevealVariants(false, TEST_TRANSITION);
    expect(variants['hidden']).not.toHaveProperty('opacity');
  });

  it('减动效：无位移、保留淡入 —— 与 revealVariants 同一条降级规则', () => {
    const variants = maskedRevealVariants(true, TEST_TRANSITION);
    expect(variants['hidden']).toEqual({ opacity: 0 });
    expect(variants['visible']).not.toHaveProperty('y');
    expect(variants['visible']).toMatchObject({ opacity: 1 });
  });
});

describe('staggerContainer', () => {
  /**
   * Motion 的 `Variant` 是一个联合类型（`TargetAndTransition | TargetResolver`），
   * 只有前者有 `transition`。测试里要读它，就得先收窄 —— 用一个显式的小工具，
   * 而不是在断言里到处写 `as`。
   */
  const transitionOf = (variant: unknown): Record<string, unknown> => {
    const holder = variant as { transition?: Record<string, unknown> } | undefined;
    return holder?.transition ?? {};
  };

  it('正常模式按传入值错峰', () => {
    const variants = staggerContainer(false, 0.12);
    expect(transitionOf(variants['visible'])).toMatchObject({ staggerChildren: 0.12 });
  });

  it('减少动效时错峰为 0 —— 否则元素仍然一个个慢慢出现', () => {
    const variants = staggerContainer(true, 0.12);
    expect(transitionOf(variants['visible'])).toMatchObject({
      staggerChildren: 0,
      delayChildren: 0,
    });
  });
});

describe('VIEWPORT', () => {
  it('once 为 true —— 反复进出视口重放会让页面显得神经质', () => {
    expect(VIEWPORT.once).toBe(true);
  });

  it('amount 足够大 —— 只露一个边角不该算"进来了"', () => {
    expect(VIEWPORT.amount).toBeGreaterThanOrEqual(0.2);
  });
});
