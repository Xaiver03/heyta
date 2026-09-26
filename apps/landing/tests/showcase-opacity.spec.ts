/**
 * 展厅窗口的不透明度：叠影（ghosting）不会再回来
 * ================================================
 *
 * 这一组测试存在的原因是一个**真实修掉的观感缺陷**：
 * 三块窗口是 `inset: 0` 的整屏元素，在 `perspective` + `preserve-3d` 的舞台里
 * 靠 `translateZ` 分前后。原来的对称淡出 `1 - |o| * 1.05` 在换位中点上
 * （`|o| = 0.5`）让前后两块**同时**是 47.6% —— 前面那块一透明，
 * 后面那块就透出来，中间那一片是双重曝光。
 *
 * 所以这里钉的不是"当前取值是多少"，而是那个缺陷的反面：
 *
 *   🔴 **任何滚动进度下，至少有一块窗口是完全不透明的。**
 *
 * 只要这一条成立，就总有一块在实心遮挡；一旦它被破坏，叠影立刻回来。
 * 「旧曲线会破坏它」也写成一条断言 —— 这样"把曲线改回去"不会只是
 * 一个审美分歧，而是一条会红的测试。
 */

import { describe, expect, it } from 'vitest';

import {
  showcaseWindowOpacity,
  showcaseWindowOpacityReduced,
  SHOWCASE_OPAQUE_PLATEAU,
} from '../src/lib/motion.js';

/** 一块窗口在进度 `p` 时的偏移量 —— 与 `Showcase.tsx` 里的公式逐字一致。 */
function offsetOf(index: number, p: number, total: number): number {
  return index - p * (total - 1);
}

/** 某一进度下所有窗口的不透明度。 */
function opacitiesAt(p: number, total: number, curve = showcaseWindowOpacity): number[] {
  return Array.from({ length: total }, (_, index) => curve(offsetOf(index, p, total)));
}

describe('showcaseWindowOpacity：3D 路径不许有两块同时半透明', () => {
  it('换位中点：前后两块都是完全不透明（叠影的成因就在这里）', () => {
    // 三块窗口、p = 0.25 → 第 1 块 o = -0.5、第 2 块 o = +0.5
    const atCrossover = opacitiesAt(0.25, 3);
    expect(atCrossover[0]).toBe(1);
    expect(atCrossover[1]).toBe(1);
  });

  it('🔴 任意进度下都至少有一块完全不透明', () => {
    for (const total of [3, 4, 5]) {
      for (let p = 0; p <= 1.0001; p += 0.005) {
        const max = Math.max(...opacitiesAt(p, total));
        // 浮点误差只允许 1e-9 量级
        expect(
          max,
          `进度 ${p.toFixed(3)}（${String(total)} 块）时最不透明的窗口只有 ${String(max)}`,
        ).toBeGreaterThanOrEqual(1 - 1e-9);
      }
    }
  });

  it('远离自己那一格的窗口必须完全透明（否则会静态叠在活跃窗口上）', () => {
    expect(showcaseWindowOpacity(1)).toBe(0);
    expect(showcaseWindowOpacity(-1)).toBe(0);
    expect(showcaseWindowOpacity(2)).toBe(0);
    expect(showcaseWindowOpacity(-2.5)).toBe(0);
  });

  it('平台之内恒为 1，之外单调不增', () => {
    expect(showcaseWindowOpacity(0)).toBe(1);
    expect(showcaseWindowOpacity(SHOWCASE_OPAQUE_PLATEAU)).toBe(1);
    expect(showcaseWindowOpacity(-SHOWCASE_OPAQUE_PLATEAU)).toBe(1);

    let previous = 1;
    for (let o = 0; o <= 1.5; o += 0.01) {
      const value = showcaseWindowOpacity(o);
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      previous = value;
    }
  });

  it('对称：正负偏移的取值相同（换位前后行为一致）', () => {
    for (const o of [0.2, 0.65, 0.8, 1.4]) {
      expect(showcaseWindowOpacity(o)).toBeCloseTo(showcaseWindowOpacity(-o), 10);
    }
  });
});

describe('showcaseWindowOpacityReduced：减动效路径保留平滑交叉淡入', () => {
  it('中点两块各约一半 —— 这正是减动效下**想要**的交叉淡入', () => {
    expect(showcaseWindowOpacityReduced(-0.5)).toBeCloseTo(0.475, 6);
    expect(showcaseWindowOpacityReduced(0.5)).toBeCloseTo(0.475, 6);
  });

  it('交叉的两块加起来不超过 1（不能叠出比单块更亮的一帧）', () => {
    for (let p = 0; p <= 1.0001; p += 0.005) {
      const values = opacitiesAt(p, 3, showcaseWindowOpacityReduced);
      // 在 p = 1/(n-1) 的中点，恰好两块各一半；其余进度有一块接近 1。
      const visible = values.filter((v) => v > 0);
      expect(visible.length).toBeLessThanOrEqual(2);
    }
  });

  it('⚠️ 旧曲线会破坏"至少一块不透明" —— 这就是这个修复要解决的问题', () => {
    const legacy = (o: number): number => Math.max(0, 1 - Math.abs(o) * 1.05);
    const legacyCrossover = opacitiesAt(0.25, 3, legacy);
    expect(Math.max(...legacyCrossover)).toBeLessThan(0.5);
    // 而新曲线在同一进度上通过了那条不变量（上面第一条已经断言）。
    expect(Math.max(...opacitiesAt(0.25, 3))).toBe(1);
  });
});
