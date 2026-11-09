/**
 * 弹簧换算：Apple 参数 → 二阶系统物理三件套
 * ==========================================
 *
 * 🔴 这个文件的存在理由是**唯一事实源**：换算此前在
 * `apps/landing/src/lib/motion.ts` 与 `packages/ui/src/overlay/spring-physics.ts`
 * 各有一份逐字相同的实现，靠各自的测试钉同一条恒等式 —— 但设计系统改公式时
 * **不会有任何一处报错**。现在两边都 import `toSpringPhysics`，
 * 这里就是那条恒等式唯一的判据。
 *
 * 钉住的四件事，全部是**不变量**，不是"当前取值"：
 *
 *   1. 换算是二阶系统的数学恒等式 —— 临界阻尼必然 `damping = 2√stiffness`。
 *   2. `ω₀ = 2π/response`，且 `stiffness = ω₀²`、`damping = 2ζω₀`。
 *   3. `mass` 恒为 1，且**换质量单位不改变物理**（RN 源码：轨迹只由 ζ、ω₀ 决定）。
 *   4. 参数确实被消费：改 ζ 或 response 必须得到不同的结果
 *      （否则它就是一組新硬编码，测试必须能红）。
 *
 * ⚠️ 本测试刻意不 import 任何消费方（web / RN），只测纯函数 ——
 * 这样它在 node 环境下就能跑，也正是换算被抽成纯函数的理由。
 */

import { describe, expect, it } from 'vitest';

import { toSpringPhysics } from '../src/spring-physics.js';

describe('toSpringPhysics：Apple 参数 → 二阶系统', () => {
  it('ω₀ = 2π / response，且 stiffness = ω₀²、damping = 2ζω₀、mass = 1', () => {
    const response = 0.3;
    const dampingRatio = 1;
    const omega = (2 * Math.PI) / response;

    const physics = toSpringPhysics(dampingRatio, response);

    expect(physics.mass).toBe(1);
    expect(physics.stiffness).toBeCloseTo(omega * omega, 10);
    expect(physics.damping).toBeCloseTo(2 * dampingRatio * omega, 10);
  });

  it('🔴 临界阻尼（ζ=1）满足 damping = 2√stiffness —— 这条恒等式保证"不过冲"', () => {
    for (const response of [0.2, 0.3, 0.4, 0.5, 1]) {
      const { stiffness, damping } = toSpringPhysics(1, response);
      expect(damping).toBeCloseTo(2 * Math.sqrt(stiffness), 10);
    }
  });

  it('ζ < 1 时阻尼更小（会过冲）；响应越短刚度越大（单调）', () => {
    const critical = toSpringPhysics(1, 0.4);
    const momentum = toSpringPhysics(0.8, 0.4);
    expect(momentum.stiffness).toBeCloseTo(critical.stiffness, 10); // 响应相同
    expect(momentum.damping).toBeLessThan(critical.damping);

    expect(toSpringPhysics(1, 0.3).stiffness).toBeGreaterThan(toSpringPhysics(1, 0.6).stiffness);
  });

  it('🔴 换质量单位不改变物理：mass=1 的 (k/m, c/m) 与 mass=m 的 (k, c) 等效', () => {
    // RN 源码 SpringAnimation.js：zeta = c/(2√(km))、omega0 = √(k/m)。
    // 令 k' = k/m、c' = c/m（mass' = 1），则 zeta 与 omega0 逐字不变 ——
    // 所以 `mass: 0.7` 那组硬编码不是"另一个手感"，只是同一个物理的另一组单位。
    //
    // 🔴 注意方向：是**除以** m，不是乘以 m。除以 m 才同时保持
    //    ζ = c/(2√(km)) 与 ω₀ = √(k/m) 不变；乘以 m 会把两者都改掉。
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

  it('🔴 参数确实被消费 —— 改 ζ 或 response 必须改变结果', () => {
    const doubled = toSpringPhysics(1, 0.6);
    const base = toSpringPhysics(1, 0.3);
    // 响应翻倍 ⇒ 角频率减半 ⇒ 刚度降到 1/4
    expect(base.stiffness).toBeCloseTo(doubled.stiffness * 4, 10);
    expect(doubled.stiffness).not.toBeCloseTo(base.stiffness, 3);

    // ζ 只影响阻尼，不影响刚度
    expect(toSpringPhysics(0.8, 0.4).stiffness).toBeCloseTo(toSpringPhysics(1, 0.4).stiffness, 10);
    expect(toSpringPhysics(0.8, 0.4).damping).not.toBeCloseTo(toSpringPhysics(1, 0.4).damping, 3);
  });

  it('与 tokens.css 当前取值一致：ζ=1/response=0.4 ⇒ 临界阻尼且不过冲', () => {
    const physics = toSpringPhysics(1, 0.4);
    const zeta = physics.damping / (2 * Math.sqrt(physics.stiffness * physics.mass));
    expect(zeta).toBeCloseTo(1, 10);
    // 反解回响应，必须还是 0.4
    expect((2 * Math.PI) / Math.sqrt(physics.stiffness / physics.mass)).toBeCloseTo(0.4, 10);
  });
});
