/**
 * 弹簧换算：Apple 参数 → RN 物理三件套
 * ======================================
 *
 * 这里钉住四件事，全部是**不变量**或**实测读数**，不是"当前取值"：
 *
 *   1. 换算是二阶系统的数学恒等式 —— 临界阻尼必然 `damping = 2√stiffness`。
 *   2. `mass` 恒为 1，且**换质量单位不改变物理**（RN 源码：轨迹只由 ζ、ω₀ 决定）。
 *      这条正面回答了"原来写 0.7，为什么现在写 1"。
 *   3. `springFor` 真的从 token 读数走 —— 喂不同的 token 必须得到不同的结果
 *      （否则它就是一组新硬编码，测试必须能红）。
 *   4. 与 `BottomSheet` 原来那组硬编码 `320/32/0.7` 的**实测差异**在容差内。
 *      这条是"该不该换"的判据本身，不写下来就只能靠口头断言。
 *
 * 🔴 本测试刻意不 import `react-native`：`packages/ui/vitest.config.ts` 是 node
 * 环境，解析不了 RN 的 Flow 源码。这也正是换算被抽成纯函数的理由。
 */

import { describe, expect, it } from 'vitest';

import { springFor, toSpringConfig, type SpringTokens } from '../src/overlay/spring-physics.js';

/** tokens.css 当前的五个弹簧读数（与 `generated/tokens.native.ts` 一致）。 */
const TOKENS: SpringTokens = {
  dampingDefault: 1,
  dampingMomentum: 0.8,
  responseMove: 0.4,
  responseSheet: 0.3,
  responseRotation: 0.4,
};

describe('toSpringConfig：Apple 参数 → 二阶系统', () => {
  it('ω₀ = 2π / response，且 stiffness = ω₀²、damping = 2ζω₀、mass = 1', () => {
    const response = 0.3;
    const dampingRatio = 1;
    const omega = (2 * Math.PI) / response;

    const config = toSpringConfig(dampingRatio, response);

    expect(config.mass).toBe(1);
    expect(config.stiffness).toBeCloseTo(omega * omega, 10);
    expect(config.damping).toBeCloseTo(2 * dampingRatio * omega, 10);
  });

  it('临界阻尼（ζ=1）满足 damping = 2√stiffness —— 这条恒等式保证"不过冲"', () => {
    for (const response of [0.2, 0.3, 0.4, 0.5, 1]) {
      const { stiffness, damping } = toSpringConfig(1, response);
      expect(damping).toBeCloseTo(2 * Math.sqrt(stiffness), 10);
    }
  });

  it('ζ < 1 时阻尼更小（会过冲）；响应越短刚度越大（单调）', () => {
    const critical = toSpringConfig(1, 0.4);
    const momentum = toSpringConfig(0.8, 0.4);
    expect(momentum.stiffness).toBeCloseTo(critical.stiffness, 10); // 响应相同
    expect(momentum.damping).toBeLessThan(critical.damping);

    expect(toSpringConfig(1, 0.3).stiffness).toBeGreaterThan(toSpringConfig(1, 0.6).stiffness);
  });

  it('🔴 换质量单位不改变物理：mass=1 的 (k/m, c/m) 与 mass=m 的 (k, c) 等效', () => {
    // RN 源码 SpringAnimation.js：zeta = c/(2√(km))、omega0 = √(k/m)。
    // 令 k' = k/m、c' = c/m（mass' = 1），则 zeta 与 omega0 逐字不变 ——
    // 所以原来那组 mass:0.7 不是"另一个手感"，只是同一个物理的另一组单位。
    //
    // 🔴 注意方向：是**除以** m，不是乘以 m。除以 m 才同时保持
    //    ζ = c/(2√(km)) 与 ω₀ = √(k/m) 不变；乘以 m 会把两者都改掉。
    //    （这一条是实测撞出来的：写成 `k * m` 时本用例立刻变红，
    //      报 zeta 0.748 ≠ 1.069 —— 恒等式测试的价值正在于此。）
    const m = 0.7;
    const ratioOf = (k: number, c: number, mass: number) => ({
      zeta: c / (2 * Math.sqrt(k * mass)),
      omega0: Math.sqrt(k / mass),
    });
    const original = ratioOf(320, 32, m);
    const normalized = ratioOf(320 / m, 32 / m, 1);

    expect(normalized.zeta).toBeCloseTo(original.zeta, 10);
    expect(normalized.omega0).toBeCloseTo(original.omega0, 10);

    // 反面：只把 mass 改成 1、k/c 不动，是**另一个物理**（zeta 降到 0.894）
    expect(ratioOf(320, 32, 1).zeta).not.toBeCloseTo(original.zeta, 3);
  });
});

describe('springFor：从 token 读数取弹簧', () => {
  it('sheet 档 = damping-default + response-sheet', () => {
    expect(springFor('sheet', TOKENS)).toEqual(toSpringConfig(TOKENS.dampingDefault, TOKENS.responseSheet));
  });

  it('move / rotation 各读自己那一格响应 —— 不许都落到同一个数', () => {
    // rotation 今天恰好与 move 同值（都是 0.4）。这里断言的是
    // **它们读的是各自的 token**：改掉 rotation 必须只影响 rotation。
    const changed: SpringTokens = { ...TOKENS, responseRotation: 0.55 };
    expect(springFor('rotation', changed)).toEqual(toSpringConfig(1, 0.55));
    expect(springFor('move', changed)).toEqual(toSpringConfig(1, TOKENS.responseMove));
  });

  it('🔴 默认不过冲；只有显式 momentum 才用阻尼比 0.8', () => {
    const calm = springFor('sheet', TOKENS);
    const momentum = springFor('sheet', TOKENS, { momentum: true });

    expect(calm.damping).toBeCloseTo(2 * Math.sqrt(calm.stiffness), 10); // 临界阻尼
    expect(momentum.stiffness).toBeCloseTo(calm.stiffness, 10); // 响应不变
    expect(momentum.damping).toBeLessThan(calm.damping); // 会过冲
    expect(momentum.damping / calm.damping).toBeCloseTo(0.8, 10); // 就是 ζ 之比
  });

  it('🔴 喂不同的 token 必须得到不同的结果 —— 否则它就是一组新硬编码', () => {
    const doubled: SpringTokens = { ...TOKENS, responseSheet: 0.6 };
    expect(springFor('sheet', doubled).stiffness).not.toBeCloseTo(springFor('sheet', TOKENS).stiffness, 3);
    // 响应翻倍 ⇒ 角频率减半 ⇒ 刚度降到 1/4
    expect(springFor('sheet', doubled).stiffness).toBeCloseTo(springFor('sheet', TOKENS).stiffness / 4, 10);
  });
});

describe('实测校准：由 token 换算出来的值 vs BottomSheet 原来那组硬编码', () => {
  /** 原来写死在 `BottomSheet.tsx` 里的那一组。 */
  const LEGACY = { stiffness: 320, damping: 32, mass: 0.7 } as const;

  /** 反解出等效的 (ζ, response) —— 与 RN 源码同一组式子。 */
  const legacyApple = {
    zeta: LEGACY.damping / (2 * Math.sqrt(LEGACY.stiffness * LEGACY.mass)),
    response: (2 * Math.PI) / Math.sqrt(LEGACY.stiffness / LEGACY.mass),
  };

  it('反解读数：ζ≈1.069、response≈0.294s（与 tokens 的 1.0 / 0.3 很近）', () => {
    expect(legacyApple.zeta).toBeCloseTo(1.069, 3);
    expect(legacyApple.response).toBeCloseTo(0.2939, 3);
  });

  it('🔴 差异在 3% 以内 —— 这是"可以直接换"的判据', () => {
    const token = springFor('sheet', TOKENS);
    const tokenApple = {
      zeta: token.damping / (2 * Math.sqrt(token.stiffness * token.mass)),
      response: (2 * Math.PI) / Math.sqrt(token.stiffness / token.mass),
    };

    expect(tokenApple.zeta).toBeCloseTo(1, 10);
    expect(tokenApple.response).toBeCloseTo(0.3, 10);

    // 响应：硬编码比 token 快 2.04%
    const responseDrift = Math.abs(legacyApple.response - tokenApple.response) / tokenApple.response;
    expect(responseDrift).toBeLessThan(0.03);

    // 刚度：归一化到 mass=1 后差 4.22%（同一条 2% 响应的平方效应）
    const legacyStiffnessNormalized = legacyApple.response ** -2 * (2 * Math.PI) ** 2;
    const stiffnessDrift = Math.abs(legacyStiffnessNormalized - token.stiffness) / token.stiffness;
    expect(stiffnessDrift).toBeLessThan(0.05);
  });

  it('两者都不过冲（ζ ≥ 1）—— 换过去不会引入新的过冲', () => {
    const token = springFor('sheet', TOKENS);
    const tokenZeta = token.damping / (2 * Math.sqrt(token.stiffness * token.mass));
    expect(tokenZeta).toBeGreaterThanOrEqual(1);
    expect(legacyApple.zeta).toBeGreaterThanOrEqual(1);
  });

  it('⚠️ 若面板误用 response-move(0.4)，会明显更慢 —— 所以档位选择有意义', () => {
    const sheet = springFor('sheet', TOKENS);
    const move = springFor('move', TOKENS);
    expect(move.stiffness).toBeLessThan(sheet.stiffness);
    // ω₀ 之比 = 0.3/0.4 = 0.75 ⇒ 收敛时间大约慢 1/0.75 - 1 ≈ 33%
    const ratio = Math.sqrt(move.stiffness) / Math.sqrt(sheet.stiffness);
    expect(ratio).toBeCloseTo(0.3 / 0.4, 10);
  });
});
