/**
 * RN 侧的主题预设（R13b native 半，2026-11-09）
 * ==========================================
 *
 * 背景：`warm` / `mist` 这两个表面预设**只有 CSS 一种落地形式**
 * （`tokens.css` 的 `[data-theme-preset='…']` 块，由 web 的 `applyThemePreset()` 写到 `<html>`）。
 * 而 `@heyta/ui` 的主题轴原先只有 `scheme` / `reducedMotion` / `reducedTransparency` /
 * `packagedFonts` —— **没有 preset 轴**，所以移动端拿到的一直是基准表面色。
 *
 * 这一轮的处置不是"把 CSS 抄进 RN"（那会造出**第二份表面色表**，`check:theme` 会红，
 * 而且两份一定漂），而是：
 *
 *   1. 生成器从**同一份 `tokens.css`** 发射 `presetTokens`（稀疏覆盖，亮暗各一份）；
 *   2. `tokensForTheme(theme, preset)` 按"基准 → 预设"合并；
 *   3. `resolveHeytaUiTheme({ preset })` 把它透出给 `useHeytaTokens()`。
 *
 * 判据因此分成三组：
 *   · **同源**：产物里的每个值 == 从 CSS 预设块重新解析的值（逐字节）；
 *   · **稀疏**：产物里的键集合 == CSS 预设块里写出的 token（不多不少 ——
 *     用合并表去判会把每个 token 都算成"有覆盖"，产出一张与基准等大的假预设表）；
 *   · **正交且可读**：预设 × 明暗四种组合都成立，且换预设**不改语义色**（primary 不动）。
 *
 * 判据能红的实证：把 `buildPresetTokens()` 里的 `extractPresetOverridesVars` 换成
 * `extractPresetVars`（合并表）⇒ "稀疏"那两条立刻红（产物会多出几百个键）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { extractPresetOverridesVars, extractPresetVars, normalizeColor, resolveVar } from '../src/css-tokens.js';
import { generateAll } from '../src/generate.js';
import { buildNativeTokens, PRESET_NAMES } from '../src/generate.js';
import { tokensForTheme } from '../src/native.js';
import { allTokenNames, cssVarName, type TokenName } from '../src/tokens.js';
import { presetTokens } from '../src/generated/tokens.native.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../src/tokens.css'), 'utf8');

/** CSS 变量名 → registry 里的 token 名。生成器与测试共用这张映射，别各写一份。 */
const TOKEN_OF_CSS = new Map(allTokenNames().map((t) => [cssVarName(t), t]));

describe('预设表与 tokens.css 同源（逐字节 round-trip）', () => {
  for (const preset of PRESET_NAMES) {
    for (const theme of ['light', 'dark'] as const) {
      it(`${preset}/${theme}：产物值 == CSS 解析值`, () => {
        const merged = extractPresetVars(CSS, preset, theme);
        const emitted = presetTokens[preset][theme];
        const keys = Object.keys(emitted);
        expect(keys.length, `${preset}/${theme} 预设表是空的 —— 选择器名对不上？`).toBeGreaterThan(0);
        for (const token of keys) {
          const cssName = cssVarName(token as never);
          const expected = normalizeColor(resolveVar(merged.get(cssName)!, merged));
          expect(emitted[token as keyof typeof emitted], `${preset}/${theme} ${token}`).toBe(expected);
        }
      });
    }
  }
});

describe('预设表是**稀疏**的（不是基准表的副本）', () => {
  for (const preset of PRESET_NAMES) {
    for (const theme of ['light', 'dark'] as const) {
      it(`${preset}/${theme}：键集合 == CSS 预设块写出的 token`, () => {
        const explicit = extractPresetOverridesVars(CSS, preset, theme);
        const expected = new Set(
          // 🔴 谓词必须写 `TokenName` 而不是 `string`（2026-11-10）：
          // `TOKEN_OF_CSS` 是 `Map<string, TokenName>`（值来自 `allTokenNames(): TokenName[]`），
          // 所以 `.get()` 的类型是 `TokenName | undefined`。写成 `t is string` 会被 TS 拒
          //（TS2677：谓词类型必须可赋给参数类型）—— 那不是狭窄，是**放宽**。
          [...explicit.keys()]
            .map((cssName) => TOKEN_OF_CSS.get(cssName))
            .filter((t): t is TokenName => t !== undefined),
        );
        expect(Object.keys(presetTokens[preset][theme]).sort()).toEqual([...expected].sort());
        // 而且它必须远小于全量 registry —— 否则"预设"就退化成"第二份基准表"。
        expect(expected.size).toBeLessThan(allTokenNames().length / 4);
      });
    }
  }
});

describe('合并规则：基准 → 预设，明暗各一套', () => {
  it('light + warm：base 的 primary 不动，surface 换成暖纸', () => {
    const base = tokensForTheme('light');
    const warm = tokensForTheme('light', 'warm');
    expect(warm['color.primary']).toBe(base['color.primary']);
    expect(warm['color.surface']).not.toBe(base['color.surface']);
    expect(warm['color.surface']).toBe(presetTokens.warm.light['color.surface']);
  });

  it('dark + mist：暗版覆盖生效（不是"亮版预设套到暗色上"）', () => {
    const base = tokensForTheme('dark');
    const mist = tokensForTheme('dark', 'mist');
    for (const [key, value] of Object.entries(presetTokens.mist.dark)) {
      expect(mist[key as keyof typeof mist], `暗版覆盖没生效：${key}`).toBe(value);
    }
    // 🔴 正交性：暗色 + 预设 ≠ 亮色的那个预设值。
    expect(mist['color.surface']).not.toBe(presetTokens.mist.light['color.surface']);
    // ⚠️ 这里**不**对 surface 断言"必与基准不同"：暗色下 mist 的 surface 与基准同为 ink-900，
    // 那是 `tokens.css` 的取值（雾青在暗色里靠**边框** teal-600 表达），不是漏覆盖。
    expect(mist['color.border']).not.toBe(base['color.border']);
  });

  it('省略 preset === 基准表（同引用，不额外分配）', () => {
    expect(tokensForTheme('light', undefined)).toBe(tokensForTheme('light'));
  });
});

describe('预设不改语义色、不改排版（换的是表面，不是意义）', () => {
  it.each(PRESET_NAMES)('%s：danger / success / primary 与基准同值', (preset) => {
    const base = tokensForTheme('light');
    const themed = tokensForTheme('light', preset);
    for (const key of ['color.primary', 'color.danger', 'color.success', 'color.warning'] as const) {
      expect(themed[key], `${preset} 擅自改了 ${key}`).toBe(base[key]);
    }
  });

  it.each(PRESET_NAMES)('%s：字号/间距一个都不在覆盖表里', (preset) => {
    const keys = Object.keys(presetTokens[preset].light);
    expect(keys.every((k) => k.startsWith('color.'))).toBe(true);
  });
});

describe('生成器不因为加了预设而改变既有产物', () => {
  it('原有 8 个目标都在，且 token 数量不变', () => {
    const bundle = generateAll(CSS);
    expect(bundle.tokens.length).toBe(buildNativeTokens(CSS).length);
    expect(Object.keys(bundle)).toEqual(
      expect.arrayContaining(['swift', 'arkts', 'json', 'native', 'typographyCss', 'xaml', 'gtkCss', 'gtkHeader']),
    );
  });
});
