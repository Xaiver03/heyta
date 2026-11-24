/**
 * 里程碑维度色契约测试
 * ====================
 *
 * 四档维度色（打卡 / 专注 / 完成 / 天数）是**产品既定**的含义，不由用户赋义 ——
 * 这一点与 `color.category-1..8` 相反，所以约束也不同：
 *
 *   · 分类色要「用户随便赋予含义也能两两分清」⇒ 必须算色盲模拟下的 ΔE；
 *   · 维度色只有四个固定维度 ⇒ 只需保证**每一档自己看得见**，
 *     且四档在正常视觉下互不相同（同一份图里会同时出现）。
 *
 * 为什么写成测试而不是写在手册里：手册里的 `3.19:1` 是快照，改色的人不会回头读它。
 * 这四档里余量最小的正是 `milestone-days`（亮色 3.19:1，只比 3:1 高 0.19）——
 * 一次"顺手调深/调浅"就会把它压到门槛以下，而**界面上看不出任何异常**，
 * 只有色弱或强光屏用户会发现"看不出哪些档达成了"。
 *
 * 判据取自 WCAG 1.4.11（非文本对比度 3:1）：这四个值只出现在圆点与档位描边上，
 * **不当正文色**，所以门槛是 3:1 而不是 4.5:1。
 * 宁可让它们不够当正文 —— 也不许有人把它们直接写进 `<Text style={{ color }}>`。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { colorOf, contrast, extractVars } from '../src/css-tokens.js';
import { TOKEN_GROUPS } from '../src/tokens.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../src/tokens.css'), 'utf8');

/** 四档维度色。与 `packages/ui/src/motivation/MilestoneMap.tsx` 的 `KIND_ACCENT` 一一对应。 */
const MILESTONE_TOKENS = [
  'color.milestone-checkin',
  'color.milestone-focus',
  'color.milestone-tasks',
  'color.milestone-days',
] as const;

const MIN_GRAPHIC = 3;

/**
 * Viénot / Brettel / Mollon (1999) 二色觉模拟矩阵，作用在**线性 RGB** 上。
 * 与 `category-colors.spec.ts` 同一套口径与同一条理由：
 * 直接在 sRGB 上乘矩阵会得到系统性偏亮的假结果。
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

/** 色盲模拟：线性 RGB 上乘矩阵，再转回 sRGB 0–255。 */
function simulate(rgb: [number, number, number], m: readonly (readonly number[])[]): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const back = (v: number) => {
    const c = Math.max(0, Math.min(1, v));
    return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
  };
  const src = rgb.map(lin) as [number, number, number];
  return [0, 1, 2].map((r) =>
    back((m[r] as readonly number[]).reduce((acc, k, c) => acc + k * src[c]!, 0)),
  ) as [number, number, number];
}

/** CIE76 ΔE*ab（与 `category-colors.spec.ts` 同一套口径）。 */
function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const xyz = (c: [number, number, number]) => {
    const [r, g, bl] = c.map(lin) as [number, number, number];
    return [
      (r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047,
      r * 0.2126 + g * 0.7152 + bl * 0.0722,
      (r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883,
    ];
  };
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const lab = (c: [number, number, number]) => {
    const [x, y, z] = xyz(c).map(f) as [number, number, number];
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

describe('里程碑维度色：登记在册', () => {
  it('四个 token 都在 registry 的 color 组里（组件才能类型安全引用）', () => {
    const registered = new Set<string>(TOKEN_GROUPS.color);
    const missing = MILESTONE_TOKENS.map((t) => t.replace('color.', '')).filter(
      (n) => !registered.has(n),
    );
    expect(missing, `未登记的维度色：${missing.join(', ')}`).toEqual([]);
  });
});

describe.each([
  ['亮色', undefined],
  ['暗色', 'dark'],
] as const)('%s主题', (_label, theme) => {
  const vars = extractVars(CSS, theme);

  it(`每档维度色与 surface 的对比度 ≥ ${String(MIN_GRAPHIC)}:1（图形门槛）`, () => {
    const surface = colorOf('color.surface', vars);
    for (const token of MILESTONE_TOKENS) {
      const ratio = contrast(colorOf(token, vars), surface);
      expect(
        Number(ratio.toFixed(2)),
        `${token} 与 surface 实测 ${ratio.toFixed(2)}:1，要求 ≥ ${String(MIN_GRAPHIC)}:1`,
      ).toBeGreaterThanOrEqual(MIN_GRAPHIC);
    }
  });

  it('四档两两可区分（最差一对 ΔE ≥ 10）', () => {
    const entries = MILESTONE_TOKENS.map((t) => ({ name: t, rgb: colorOf(t, vars) }));
    let worst = { pair: '', value: Number.POSITIVE_INFINITY };
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const value = deltaE(entries[i]!.rgb, entries[j]!.rgb);
        if (value < worst.value) {
          worst = { pair: `${entries[i]!.name} ↔ ${entries[j]!.name}`, value };
        }
      }
    }
    expect(Number(worst.value.toFixed(1)), `最差一对：${worst.pair}`).toBeGreaterThanOrEqual(10);
  });

  it.each([
    ['红色盲', PROTANOPIA],
    ['绿色盲', DEUTERANOPIA],
  ] as const)('🔴 %s模拟下四档仍可区分（最差一对 ΔE ≥ 10）', (label, matrix) => {
    const entries = MILESTONE_TOKENS.map((t) => ({
      name: t,
      rgb: simulate(colorOf(t, vars), matrix),
    }));
    let worst = { pair: '', value: Number.POSITIVE_INFINITY };
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const value = deltaE(entries[i]!.rgb, entries[j]!.rgb);
        if (value < worst.value) {
          worst = { pair: `${entries[i]!.name} ↔ ${entries[j]!.name}`, value };
        }
      }
    }
    expect(
      Number(worst.value.toFixed(1)),
      `${label}下最差一对：${worst.pair}`,
    ).toBeGreaterThanOrEqual(10);
  });

  it('🔴 四档互不相同（暗色与亮色各自内部不能重复）', () => {
    const hexes = MILESTONE_TOKENS.map((t) => colorOf(t, vars).join(','));
    expect(new Set(hexes).size, '有两档取到了同一个颜色，维度区分就失效了').toBe(hexes.length);
  });
});

describe('暗色覆盖', () => {
  const light = extractVars(CSS);
  const dark = extractVars(CSS, 'dark');

  it('每一档都有暗色覆盖', () => {
    for (const token of MILESTONE_TOKENS) {
      expect(
        dark.has(`--ht-${token.replace('.', '-')}`),
        `${token} 没有暗色覆盖`,
      ).toBe(true);
    }
  });

  it('🔴 暗色与亮色的取值必须有实际差异（防止复制粘贴后忘改）', () => {
    for (const token of MILESTONE_TOKENS) {
      const a = colorOf(token, light).join(',');
      const b = colorOf(token, dark).join(',');
      expect(a, `${token} 在暗色下与亮色完全相同`).not.toBe(b);
    }
  });
});
