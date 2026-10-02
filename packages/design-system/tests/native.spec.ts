/**
 * React Native token 产物的契约测试
 * =================================
 *
 * 盯的是 RN 特有的两类**静默失效**：
 *
 *   1. 🔴 **暗色表的空洞。** `tokens.json` 的 dark 段是**稀疏覆盖**（只含被显式
 *      覆盖的 token）。如果 RN 直接消费它，`dark['color.background']` 会拿到
 *      `undefined` —— 而 **RN 不报错，只是不渲染**。所以本产物必须是**完整**表。
 *      这条测试就是钉死它：dark 的 key 必须与 light **完全一致**。
 *   2. 🔴 **`useColorScheme()` 的 null。** 它的类型是
 *      `'light' | 'dark' | null | undefined`，`null` 表示"系统未指定"。
 *      把它当索引用会得到 `undefined`，同样是静默不渲染。必须归一化。
 *
 * 外加：值必须与 tokens.css 同源（round-trip），且**对比度要用 RN 拿到的值重算** ——
 * 生成器一旦给 RN 转错一个 hex，必须在测试里拦下，而不是等用户在真机上看到。
 *
 * 复用 `src/css-tokens.ts` 的解析与 WCAG 公式：**不重写对比度数学**。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { contrast, parseColor } from '../src/css-tokens.js';
import { generateAll } from '../src/generate.js';
import {
  darkTokens,
  lightTokens,
  reducedMotionTokens,
  reducedTransparencyDarkTokens,
  reducedTransparencyLightTokens,
  resolveNativeTokens,
  resolveThemeName,
  THEME_NAMES,
  tokensForTheme,
  type HeytaNativeTokens,
  type ThemeName,
} from '../src/native.js';
import { AA_PAIRS, GRAPHIC_PAIRS, allTokenNames } from '../src/tokens.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../src/tokens.css'), 'utf8');

const bundle = generateAll(CSS);

const tokenNames = allTokenNames();

// ─────────────────────────────────────────────────────────────
// 1. 结构：暗色必须是完整的，不能有洞
// ─────────────────────────────────────────────────────────────

describe('RN 产物的结构', () => {
  it('🔴 darkTokens 的 key 与 lightTokens **完全一致**（稀疏覆盖会产生静默 undefined）', () => {
    const lightKeys = Object.keys(lightTokens).sort();
    const darkKeys = Object.keys(darkTokens).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it('🔴 用它当索引取任何一个 token 都不会得到 undefined', () => {
    // 这正是 RN 最容易踩的坑：拿到 undefined 不报错，只是不渲染。
    const holes: string[] = [];
    for (const theme of THEME_NAMES) {
      const table = tokensForTheme(theme);
      for (const name of tokenNames) {
        if (table[name as keyof HeytaNativeTokens] === undefined) holes.push(`${theme}:${name}`);
      }
    }
    expect(holes, `以下 token 在某主题下是 undefined：${holes.join(', ')}`).toEqual([]);
  });

  it('两个主题各自覆盖 registry 里的每一个 token', () => {
    for (const table of [lightTokens, darkTokens]) {
      const missing = tokenNames.filter((n) => !(n in table));
      expect(missing, `漏了：${missing.join(', ')}`).toEqual([]);
    }
  });

  it('THEME_NAMES 与主题表一一对应', () => {
    expect(THEME_NAMES).toEqual(['light', 'dark']);
  });

  it('reducedMotionTokens 是 Partial（稀疏是对的，它是覆盖层不是主题）', () => {
    const keys = Object.keys(reducedMotionTokens);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThan(tokenNames.length);
    // 覆盖的必须是 duration 一类的动效 token
    for (const k of keys) expect(k.startsWith('duration.')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. 类型：数值 token 是 number，颜色是 string
// ─────────────────────────────────────────────────────────────

describe('RN 产物的类型', () => {
  it('颜色 token 是 string，数值 token 是 number', () => {
    const wrong: string[] = [];
    for (const t of bundle.tokens) {
      const v = lightTokens[t.token];
      const actual = typeof v;
      const expected = t.kind === 'number' ? 'number' : 'string';
      if (actual !== expected) wrong.push(`${t.token}: 期望 ${expected} 实得 ${actual}`);
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  it('暗色表里同一 token 的类型与亮色一致（不能一个 number 一个 string）', () => {
    const wrong = tokenNames.filter((n) => typeof lightTokens[n] !== typeof darkTokens[n]);
    expect(wrong, `类型不一致：${wrong.join(', ')}`).toEqual([]);
  });

  it('拼错 token 名是**编译期**错误，而不是运行期 undefined', () => {
    // 这个 @ts-expect-error 本身就是断言：如果 native.ts 的类型退化成
    // 索引签名（Record<string, ...>），下面这行会编译通过，tsc 会报
    // "Unused '@ts-expect-error' directive" —— 于是测试红。
    // @ts-expect-error 不存在的 token 名
    const typo = lightTokens['color.foregroudn'];
    expect(typo).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// 3. round-trip：RN 拿到的值必须与 tokens.css 同源
// ─────────────────────────────────────────────────────────────

describe('RN 产物的值（与共享 NativeToken[] 同源）', () => {
  /*
   * 为什么这里**不**重新从 tokens.css 现算，而是与 `bundle.tokens` 对账：
   *
   * CSS → 原生值的转换（rem×16、`rgb(a b c / d)` → 8 位 hex、`65ch` 保持字符串）
   * 是**三端共用**的一段逻辑，产出同一个 `NativeToken[]`。
   * 那段转换的 CSS 级正确性已经由 `generated.spec.ts` 的 round-trip 对
   * Swift / ArkTS 统一验过。在这里再实现一遍换算公式只会制造**第二套定义** ——
   * 而两套实现迟早会对同一份 tokens.css 给出不同结果（这正是本仓库反复强调的）。
   *
   * 这里要盯的是**本产物特有的风险**：`toNativeTS` 是不是真的把
   * `NativeToken[]` 里正确的那个字段、以正确的类型写了出来。
   */
  it('亮色：每个 token 的值与类型都等于共享 NativeToken[]', () => {
    const drift: string[] = [];
    for (const t of bundle.tokens) {
      const actual = lightTokens[t.token];
      if (actual !== t.light) drift.push(`${t.token}: 期望 ${t.light} 实得 ${String(actual)}`);
      else if (typeof actual !== typeof t.light)
        drift.push(`${t.token}: 类型 ${typeof actual} ≠ ${typeof t.light}`);
    }
    expect(drift, drift.join('\n')).toEqual([]);
  });

  it('rem 尺寸按 16px 基准换算（不是原样搬 rem 字符串）', () => {
    expect(lightTokens['space.4']).toBe(16);
    expect(lightTokens['space.1']).toBe(4);
    expect(lightTokens['touch-target.min']).toBe(44);
  });

  it('无原生数值等价物的 65ch 是字符串，没有被硬凑成数字', () => {
    expect(lightTokens['layout.prose-max']).toBe('65ch');
  });

  it('带 alpha 的颜色被转成 8 位 hex，不会原样保留 rgb() 语法', () => {
    // RN 不认识 CSS 的 `rgb(r g b / a)`；必须是 RN 可解析的形状。
    const overlay = lightTokens['color.overlay'];
    expect(typeof overlay).toBe('string');
    expect(String(overlay)).not.toContain('rgb(');
    expect(String(overlay)).toMatch(/^#[0-9a-f]{8}$/i);
  });

  it('数值 token 是裸数字，不带 px/ms 单位后缀', () => {
    const withUnit = bundle.tokens
      .filter((t) => t.kind === 'number')
      .filter((t) => /(px|ms|rem)$/.test(String(lightTokens[t.token])));
    expect(
      withUnit.map((t) => `${t.token}=${String(lightTokens[t.token])}`),
      'RN 的 StyleSheet 数值不能带单位后缀',
    ).toEqual([]);
  });

  it('暗色：被覆盖的用暗色值，未覆盖的回退到亮色值', () => {
    const drift: string[] = [];
    for (const t of bundle.tokens) {
      const expected = t.dark === null ? t.light : t.dark;
      const actual = darkTokens[t.token];
      if (actual !== expected) drift.push(`${t.token}: 期望 ${expected} 实得 ${String(actual)}`);
    }
    expect(drift, drift.join('\n')).toEqual([]);
  });

  it('产物里没有 var( 也没有 --ht-', () => {
    expect(JSON.stringify(lightTokens)).not.toContain('var(');
    expect(JSON.stringify(darkTokens)).not.toContain('var(');
    expect(JSON.stringify(darkTokens)).not.toContain('--ht-');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. RN 运行时语义：useColorScheme 的 null、减少动效的合并
// ─────────────────────────────────────────────────────────────

describe('RN 运行时语义', () => {
  it('🔴 useColorScheme() 返回 null（系统未指定）时回退到亮色，不是 undefined', () => {
    expect(resolveThemeName(null)).toBe('light');
    expect(resolveThemeName(undefined)).toBe('light');
  });

  it('显式的 dark / light 原样保留', () => {
    expect(resolveThemeName('dark')).toBe('dark');
    expect(resolveThemeName('light')).toBe('light');
  });

  it('resolveThemeName 对所有可能的输入都返回合法主题名', () => {
    for (const input of [null, undefined, 'light', 'dark'] as const) {
      const out: ThemeName = resolveThemeName(input);
      expect(THEME_NAMES).toContain(out);
    }
  });

  it('tokensForTheme 返回完整表', () => {
    for (const theme of THEME_NAMES) {
      const table = tokensForTheme(theme);
      expect(Object.keys(table)).toHaveLength(tokenNames.length);
    }
  });

  it('开启减少动效后仍是**完整**表（合并而不是二选一）', () => {
    const withRM = resolveNativeTokens({ theme: 'light', reducedMotion: true });
    expect(Object.keys(withRM)).toHaveLength(tokenNames.length);
    // 被覆盖的 token 真的变了
    const overridden = Object.keys(reducedMotionTokens);
    for (const k of overridden) {
      expect(withRM[k as keyof HeytaNativeTokens]).toBe(
        reducedMotionTokens[k as keyof HeytaNativeTokens],
      );
    }
  });

  it('关闭减少动效时与主题表逐字节一致', () => {
    const off = resolveNativeTokens({ theme: 'dark', reducedMotion: false });
    expect(off).toBe(darkTokens);
  });

  it('减少动效的覆盖不会污染原始主题表（不可变）', () => {
    const before = lightTokens['duration.fast'];
    resolveNativeTokens({ theme: 'light', reducedMotion: true });
    expect(lightTokens['duration.fast']).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────
// 5. 对比度：用 **RN 拿到的值** 重算
// ─────────────────────────────────────────────────────────────

function ratioOf(table: HeytaNativeTokens, fg: string, bg: string): number {
  const fgVal = table[fg as keyof HeytaNativeTokens];
  const bgVal = table[bg as keyof HeytaNativeTokens];
  if (typeof fgVal !== 'string' || typeof bgVal !== 'string') {
    throw new Error(`RN 产物里 ${fg} / ${bg} 不是颜色（${typeof fgVal} / ${typeof bgVal}）`);
  }
  return contrast(parseColor(fgVal), parseColor(bgVal));
}

describe('RN 产物的对比度（Light，用 RN 拿到的值重算）', () => {
  it.each(AA_PAIRS)('$fg on $bg ≥ $min:1（$why）', ({ fg, bg, min, why }) => {
    const r = ratioOf(lightTokens, fg, bg);
    expect(
      Number(r.toFixed(2)),
      `RN Light ${fg} on ${bg}（${why}）实测 ${r.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(min);
  });

  it.each(GRAPHIC_PAIRS)('$fg on $bg ≥ $min:1（$why）', ({ fg, bg, min, why }) => {
    const r = ratioOf(lightTokens, fg, bg);
    expect(
      Number(r.toFixed(2)),
      `RN Light ${fg} on ${bg}（${why}）实测 ${r.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(min);
  });
});

describe('RN 产物的对比度（Dark，用 RN 拿到的值重算）', () => {
  it.each(AA_PAIRS)('$fg on $bg ≥ $min:1（$why）', ({ fg, bg, min, why }) => {
    const r = ratioOf(darkTokens, fg, bg);
    expect(
      Number(r.toFixed(2)),
      `RN Dark ${fg} on ${bg}（${why}）实测 ${r.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(min);
  });
});

describe('「减少透明度」覆盖层（ADR-0042 §4：材质要能退让）', () => {
  const TINTS = [
    'material.chrome-tint',
    'material.chrome-tint-strong',
    'material.panel-tint',
    'material.sheet-tint',
  ] as const;

  it('两个主题的覆盖层都把 tint 压成不透明 hex（8 位带 alpha 的形态不许出现）', () => {
    for (const [name, table] of [
      ['light', reducedTransparencyLightTokens],
      ['dark', reducedTransparencyDarkTokens],
    ] as const) {
      for (const tint of TINTS) {
        const value = table[tint];
        expect(value, `${name} 覆盖层缺 ${tint}`).toBeDefined();
        expect(String(value), `${name} ${tint} 必须是 6 位不透明 hex`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('模糊半径压成 0（backdrop-filter 的合成开销随值一起消失）', () => {
    expect(reducedTransparencyLightTokens['blur.chrome']).toBe(0);
    expect(reducedTransparencyLightTokens['blur.sheet']).toBe(0);
  });

  it('resolveNativeTokens 按主题合并正确的 surface（亮=白、暗=深蓝，不许串档）', () => {
    const light = resolveNativeTokens({ theme: 'light', reducedTransparency: true });
    const dark = resolveNativeTokens({ theme: 'dark', reducedTransparency: true });
    expect(light['material.panel-tint']).toBe(lightTokens['color.surface']);
    expect(dark['material.panel-tint']).toBe(darkTokens['color.surface']);
    expect(light['material.panel-tint']).not.toBe(dark['material.panel-tint']);
    // 不开偏好时原样保留（半透明 tint 不许被静默压掉）
    expect(resolveNativeTokens({ theme: 'light' })['material.panel-tint']).toBe(
      lightTokens['material.panel-tint'],
    );
  });
});
