/**
 * 勾选动效的判定表
 * ==================
 *
 * 钉住的是**真值表**，不是当前取值：
 *
 *   1. 首次挂载不播 —— 已完成的行滚进视口时不该弹（长列表里这条最容易漏，
 *      漏了的表现不是报错，是"滚到哪都在抖"）。
 *   2. 值没变不播。
 *   3. 减动效下**任何**变化都不播（不是"播得快一点"）。
 *   4. 勾上与撤销**不对称**：勾上缩 0.8 再弹回 1，撤销不缩放。
 *   5. 弹簧真的从 token 取 —— 喂不同的 token 必须得到不同结果，
 *      否则它就是一组新硬编码（与 `overlay-spring-physics.spec.ts` 同一条判据）。
 *   6. 换算仍是临界阻尼恒等式 `damping = 2√stiffness`。
 *
 * 🔴 本测试刻意不 import `react-native`：node 环境解析不了它的 Flow 源码。
 * 这也正是动效被抽成纯函数的理由。
 */

import { describe, expect, it } from 'vitest';

import {
  CHECK_FROM_SCALE,
  checkboxSpring,
  planCheckboxMotion,
} from '../src/control/checkbox-motion.js';
import { springTokensOf, type SpringTokens } from '../src/overlay/spring-physics.js';

const TOKENS: SpringTokens = {
  dampingDefault: 1,
  dampingMomentum: 0.8,
  responseMove: 0.4,
  responseSheet: 0.3,
  responseRotation: 0.4,
};

describe('planCheckboxMotion：什么时候播', () => {
  it('首次挂载不播（已完成的行滚进视口时不该弹）', () => {
    // 🔴 必须是 **previous ≠ next** 的输入。第一版写的是 (true, true, false) ——
    // 它确实返回 none，但返回原因是"值没变"，`mounted` 这一支根本没被走到：
    // 把 `if (!mounted)` 整行删掉，那个用例照样绿。一条永远通过的判据比没有更糟。
    expect(planCheckboxMotion(false, true, false, false)).toEqual({ kind: 'none' });
    expect(planCheckboxMotion(true, false, false, false)).toEqual({ kind: 'none' });
  });

  it('值没变不播（重渲染不等于状态变化）', () => {
    expect(planCheckboxMotion(true, true, true, false)).toEqual({ kind: 'none' });
  });

  it('减动效下任何变化都不播 —— 包括勾上', () => {
    expect(planCheckboxMotion(false, true, true, true)).toEqual({ kind: 'none' });
    expect(planCheckboxMotion(true, false, true, true)).toEqual({ kind: 'none' });
  });
});

describe('planCheckboxMotion：两个方向不对称', () => {
  it('勾上：从 0.8 弹回 1，勾从 0 淡入', () => {
    expect(planCheckboxMotion(false, true, true, false)).toEqual({
      kind: 'check',
      fromScale: CHECK_FROM_SCALE,
      toScale: 1,
      tickFrom: 0,
      tickTo: 1,
    });
  });

  it('撤销：不缩放，只把勾淡出', () => {
    const motion = planCheckboxMotion(true, false, true, false);
    expect(motion.kind).toBe('uncheck');
    if (motion.kind !== 'uncheck') throw new Error('unreachable');
    expect(motion.fromScale).toBe(motion.toScale);
    expect(motion.tickFrom).toBe(1);
    expect(motion.tickTo).toBe(0);
  });

  it('勾上的起手缩放确实小于 1（否则"弹"这个描述不成立）', () => {
    expect(CHECK_FROM_SCALE).toBeLessThan(1);
  });
});

describe('checkboxSpring：从 token 取，不硬编码', () => {
  it('临界阻尼恒等式：damping = 2√stiffness，mass = 1', () => {
    const config = checkboxSpring(TOKENS);
    expect(config.mass).toBe(1);
    expect(config.damping).toBeCloseTo(2 * Math.sqrt(config.stiffness), 10);
  });

  it('喂不同的 response 必须得到不同的刚度（否则就是硬编码）', () => {
    const faster = checkboxSpring({ ...TOKENS, responseMove: 0.2 });
    const slower = checkboxSpring({ ...TOKENS, responseMove: 0.8 });
    expect(faster.stiffness).toBeGreaterThan(slower.stiffness);
    // response 减半 ⇒ ω₀ 翻倍 ⇒ stiffness 变四倍。
    expect(faster.stiffness / slower.stiffness).toBeCloseTo(16, 10);
  });

  it('ζ 从 damping-default 取：改成 0.8 时阻尼随之下降', () => {
    const under = checkboxSpring({ ...TOKENS, dampingDefault: 0.8 });
    expect(under.damping).toBeLessThan(checkboxSpring(TOKENS).damping);
  });
});

describe('springTokensOf：五个 key 一个不落', () => {
  it('按 token 名逐个取值，漏一个会得到 undefined 而不是默认值', () => {
    const bag = {
      'motion.spring-damping-default': 1,
      'motion.spring-damping-momentum': 0.8,
      'motion.spring-response-move': 0.4,
      'motion.spring-response-sheet': 0.3,
      'motion.spring-response-rotation': 0.4,
    };
    expect(springTokensOf(bag)).toEqual(TOKENS);
  });

  it('返回值直接喂 springFor 时不报错且形状正确', () => {
    const tokens = springTokensOf({
      'motion.spring-damping-default': 1,
      'motion.spring-damping-momentum': 0.8,
      'motion.spring-response-move': 0.4,
      'motion.spring-response-sheet': 0.3,
      'motion.spring-response-rotation': 0.4,
    });
    expect(Object.keys(tokens).sort()).toEqual(
      ['dampingDefault', 'dampingMomentum', 'responseMove', 'responseRotation', 'responseSheet'].sort(),
    );
  });
});
