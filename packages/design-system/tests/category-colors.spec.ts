/**
 * 分类色槽位契约测试
 * ====================
 *
 * 8 个色槽位是**用户赋义**的（"我把短视频设成 1 号"），所以它们必须满足一件
 * 与审美无关的性质：**两两可区分**。而"可区分"不能靠肉眼看一遍就宣布 ——
 * 那正是本仓库反复记过的形状（写在文档里的 4.5:1 拦不住任何东西）。
 *
 * 这里真的算三件事：
 *
 *   1. **与 surface 的对比度**（亮色与暗色各算一遍）—— 色块得先看得见。
 *   2. **正常视觉下的两两色差**（CIE76 ΔE\*ab）。
 *   3. **色盲模拟下的两两色差** —— 用 Viénot 1999 的红色盲 / 绿色盲矩阵。
 *
 * ## 为什么第 3 条必须有
 *
 * 约 8% 的男性有红绿色觉障碍。8 个颜色里有红、橙、绿、青、蓝、紫、品红、粉 ——
 * **对红绿色盲来说，红/橙/绿会塌缩成同一条"黄"轴**，靠色相区分的那部分信息直接消失。
 * 如果只算正常视觉的色差，我们会在毫不知情的情况下交付一个"对某些人等于单色"的图，
 * 而用户反馈只会是"我看不出来有什么区别"。
 *
 * 所以这 8 个值不是按"好看"挑的：它们是在这条约束下解出来的
 * （见 `docs/plans/activity-categories-and-colors.md`）。
 *
 * 🔴 **模拟器本身也要被验证**（`色盲模拟不是空操作` 那一组）：
 * 一个把输入原样返回的"模拟器"会让第 3 条永远通过 —— 那比没有这条检查更糟。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { colorOf, contrast, extractVars } from '../src/css-tokens.js';
import {
  CATEGORY_SLOT_TOKEN_BY_SLOT,
  CATEGORY_SLOT_TOKENS,
  HEAT_TOKENS,
  TOKEN_GROUPS,
  UNSET_CATEGORY_TOKEN,
} from '../src/tokens.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../src/tokens.css'), 'utf8');

type Rgb = [number, number, number];

// ─────────────────────────────────────────────────────────────
// 色差与色盲模拟
// ─────────────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  const c = Math.max(0, Math.min(1, v));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
}

/** sRGB → CIE L\*a\*b\*（D65）。只为算色差，不追求色彩管理级的精度。 */
function toLab([r, g, b]: Rgb): [number, number, number] {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 色差。够用：我们要判的是"明显不同"，不是"差多少刚好" */
function deltaE(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * Viénot / Brettel / Mollon (1999) 的二色觉模拟。
 *
 * 矩阵作用在**线性 RGB** 上，这是关键 —— 直接在 sRGB 上乘矩阵会得到
 * 系统性偏亮的假结果（"看起来没问题"的那种错）。
 */
const PROTANOPIA: readonly (readonly number[])[] = [
  [0.11238, 0.88762, 0],
  [0.11238, 0.88762, 0],
  [0.00401, -0.00401, 1],
];

const DEUTERANOPIA: readonly (readonly number[])[] = [
  [0.29275, 0.70725, 0],
  [0.29275, 0.70725, 0],
  [-0.02234, 0.02234, 1],
];

function simulate(rgb: Rgb, matrix: readonly (readonly number[])[]): Rgb {
  const lin = rgb.map(srgbToLinear);
  const out = matrix.map((row) => row[0]! * lin[0]! + row[1]! * lin[1]! + row[2]! * lin[2]!);
  return [linearToSrgb(out[0]!), linearToSrgb(out[1]!), linearToSrgb(out[2]!)];
}

// ─────────────────────────────────────────────────────────────
// 门槛
// ─────────────────────────────────────────────────────────────

/**
 * 门槛取值的依据：**实测的最低一对**。
 *
 * | 条件 | 亮色实测最低 | 暗色实测最低 | 门槛 |
 * |---|---|---|---|
 * | 正常视觉 ΔE | 29.2 | 28.2 | **25** |
 * | 红色盲 ΔE | 16.1 | 23.3 | **14** |
 * | 绿色盲 ΔE | 19.7 | 15.3 | **13** |
 *
 * 门槛比实测低一档是**故意的**：它要拦住的是"有人换掉一个值、造出一对
 * 几乎一样的颜色"，而不是让调参变成走钢丝。CIE76 里 ΔE ≈ 2.3 是刚能看出的差别，
 * 25 已经是"绝不是同一个颜色"的量级。
 */
const MIN_NORMAL_DELTA_E = 25;
const MIN_PROTAN_DELTA_E = 14;
const MIN_DEUTAN_DELTA_E = 13;

interface SlotColor {
  name: string;
  rgb: Rgb;
  protan: Rgb;
  deutan: Rgb;
}

function slotColors(vars: Map<string, string>): SlotColor[] {
  return CATEGORY_SLOT_TOKENS.map((token) => {
    const rgb = colorOf(token, vars);
    return {
      name: token,
      rgb,
      protan: simulate(rgb, PROTANOPIA),
      deutan: simulate(rgb, DEUTERANOPIA),
    };
  });
}

/** 两两之间最差的那一对（返回的是"最小色差"，不是平均）。 */
function worstPair(
  colors: readonly SlotColor[],
  pick: (color: SlotColor) => Rgb,
): { value: number; pair: string } {
  let worst = { value: Number.POSITIVE_INFINITY, pair: '' };
  for (let i = 0; i < colors.length; i += 1) {
    for (let j = i + 1; j < colors.length; j += 1) {
      const a = colors[i]!;
      const b = colors[j]!;
      const value = deltaE(pick(a), pick(b));
      if (value < worst.value) worst = { value, pair: `${a.name} / ${b.name}` };
    }
  }
  return worst;
}

// ─────────────────────────────────────────────────────────────
// 测试
// ─────────────────────────────────────────────────────────────

describe('色槽位数量', () => {
  it('恰好 8 个（少一个不够分，多一个保证不了两两可区分）', () => {
    expect(CATEGORY_SLOT_TOKENS).toHaveLength(8);
  });

  it('编号连续且从 1 开始（槽位号是**持久化数据**，不能有洞）', () => {
    expect(CATEGORY_SLOT_TOKENS).toEqual(
      Array.from({ length: 8 }, (_, i) => `color.category-${String(i + 1)}`),
    );
  });

  it('🔴 registry 里的 category-* 与这 8 个**逐项相同**（否则新槽位不会被查对比度）', () => {
    // 上面那个常量是手写的（理由见 tokens.ts：手写才能让拼错变成编译错误）。
    // 手写的代价正是这条断言要兜的：有人加了 `category-9` 进 TOKEN_GROUPS，
    // 却没加进常量 —— 于是它不进 GRAPHIC_PAIRS、**永远不被检查**。
    // 漏登记的那一个不会失败，因为它根本不在清单里。
    const inRegistry = TOKEN_GROUPS.color
      .filter((name) => name.startsWith('category-'))
      .map((name) => `color.${name}`);
    expect(inRegistry.slice().sort()).toEqual(CATEGORY_SLOT_TOKENS.slice().sort());
  });
});

describe.each([
  ['亮色', undefined],
  ['暗色', 'dark'],
] as const)('%s主题', (_label, theme) => {
  const vars = extractVars(CSS, theme);
  const colors = slotColors(vars);

  it('每个槽位与 surface 的对比度 ≥ 3:1（图形门槛，WCAG 1.4.11）', () => {
    const surface = colorOf('color.surface', vars);
    for (const color of colors) {
      const ratio = contrast(color.rgb, surface);
      expect(
        Number(ratio.toFixed(2)),
        `${color.name} 与 surface 实测 ${ratio.toFixed(2)}:1，要求 ≥ 3:1`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it(`🔴 正常视觉下两两可区分（最差一对 ΔE ≥ ${String(MIN_NORMAL_DELTA_E)}）`, () => {
    const worst = worstPair(colors, (c) => c.rgb);
    expect(worst.value, `最差一对：${worst.pair}`).toBeGreaterThanOrEqual(MIN_NORMAL_DELTA_E);
  });

  it(`🔴 红色盲模拟下两两可区分（最差一对 ΔE ≥ ${String(MIN_PROTAN_DELTA_E)}）`, () => {
    const worst = worstPair(colors, (c) => c.protan);
    expect(worst.value, `最差一对：${worst.pair}`).toBeGreaterThanOrEqual(MIN_PROTAN_DELTA_E);
  });

  it(`🔴 绿色盲模拟下两两可区分（最差一对 ΔE ≥ ${String(MIN_DEUTAN_DELTA_E)}）`, () => {
    const worst = worstPair(colors, (c) => c.deutan);
    expect(worst.value, `最差一对：${worst.pair}`).toBeGreaterThanOrEqual(MIN_DEUTAN_DELTA_E);
  });
});

describe('色盲模拟不是空操作', () => {
  it('把红与绿**判别性地**推到一起（否则上面那三条门槛形同虚设）', () => {
    // 纯红 vs 纯绿：正常视觉差得很远，绿色盲下应该明显接近。
    const red: Rgb = [255, 0, 0];
    const green: Rgb = [0, 128, 0];
    const normal = deltaE(red, green);
    const deutan = deltaE(simulate(red, DEUTERANOPIA), simulate(green, DEUTERANOPIA));
    expect(normal).toBeGreaterThan(100);
    expect(deutan).toBeLessThan(normal * 0.75);
  });

  it('把红与蓝**分开**（模拟器不能把什么都压成一样）', () => {
    const red: Rgb = [255, 0, 0];
    const blue: Rgb = [0, 0, 255];
    const deutan = deltaE(simulate(red, DEUTERANOPIA), simulate(blue, DEUTERANOPIA));
    const protan = deltaE(simulate(red, PROTANOPIA), simulate(blue, PROTANOPIA));
    expect(deutan).toBeGreaterThan(50);
    expect(protan).toBeGreaterThan(50);
  });

  it('模拟不改变灰度（无色颜色在任何色觉下都不变）', () => {
    const gray: Rgb = [128, 128, 128];
    for (const matrix of [PROTANOPIA, DEUTERANOPIA]) {
      expect(deltaE(gray, simulate(gray, matrix))).toBeLessThan(1.5);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 共享映射：这里是"只有一份"的机器判据
// ─────────────────────────────────────────────────────────────

/**
 * 这几条不是重复上面的对比度检查，它们钉的是**另一件事**：
 * 各端消费的那张「槽位号 → token」映射，与 `CATEGORY_SLOT_TOKENS` 是不是同一份取值。
 *
 * 为什么需要：在加这几条之前，**移动端手抄了 8 个槽位值 + 5 个 heat 值**。
 * 那种写法有一个不会失败的失败 —— 改掉一个槽位取值后，Web 从常量派生、跟着变；
 * 移动端手抄、**静默保持旧色**；而没有任何测试会红。
 * 现在取值只有一处（`CATEGORY_SLOT_TOKEN_BY_SLOT` / `HEAT_TOKENS`），
 * 这几条就是保证它**继续只有一处**。
 */
describe('共享映射与常量同源', () => {
  it('🔴 槽位映射与 CATEGORY_SLOT_TOKENS **逐项相同**（不是"差不多"）', () => {
    const slots = [1, 2, 3, 4, 5, 6, 7, 8] as const;
    expect(slots.map((slot) => CATEGORY_SLOT_TOKEN_BY_SLOT[slot])).toEqual([
      ...CATEGORY_SLOT_TOKENS,
    ]);
  });

  it('槽位键恰好 1–8：没有洞、没有多余键（槽位号是**持久化数据**）', () => {
    expect(Object.keys(CATEGORY_SLOT_TOKEN_BY_SLOT).map(Number).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('heat 色阶恰好 5 档且按 0–4 排列（顺序即数值，错位会静默画错深浅）', () => {
    expect(HEAT_TOKENS).toHaveLength(5);
    expect([...HEAT_TOKENS]).toEqual([
      'color.heat-0',
      'color.heat-1',
      'color.heat-2',
      'color.heat-3',
      'color.heat-4',
    ]);
  });

  it('heat 色阶每一个都真的在 registry 里（否则 RN 侧取到 undefined，颜色静默变透明）', () => {
    const registered = TOKEN_GROUPS.color.map((name) => `color.${name}`);
    for (const token of HEAT_TOKENS) {
      expect(registered, `${token} 不在 TOKEN_GROUPS.color 里`).toContain(token);
    }
  });

  it('🔴 "未设色"用的 token **不在**分类色板里（否则"没设过色"看起来像第 9 种可选项）', () => {
    expect(CATEGORY_SLOT_TOKENS).not.toContain(UNSET_CATEGORY_TOKEN);
    expect(TOKEN_GROUPS.color.map((name) => `color.${name}`)).toContain(UNSET_CATEGORY_TOKEN);
  });
});
