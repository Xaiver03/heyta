/**
 * 页面留白阶梯的判据
 * ===================
 *
 * 这条测试钉的是一件**跨两个世界**的事：`tokens.css` 的媒体查询（Web 用）
 * 与 `SCREEN_GUTTER_STEPS`（原生用）必须是**同一张表**。
 *
 * 它们天然会漂：CSS 里只能写裸 `48rem`，TS 里只能写 `768`，两边没有共同的
 * 类型系统约束。改一边而忘另一边时，症状是"Web 上是 24、iPad 上是 32"——
 * 没有任何构建会红，只有把两个设备并排看才发现。
 *
 * 所以这里逐档断言：**CSS 里那条 media query 的值 == TS 阶梯里那一档的值**。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractVars, resolveVar } from '../src/css-tokens.js';
import { SCREEN_GUTTER_STEPS, resolveScreenGutter, withResolvedScreenGutter } from '../src/screen-gutter.js';
import type { HeytaNativeTokens } from '../src/native.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../src/tokens.css'), 'utf8');

/** tokens.css 是 rem 基准 16px —— 与生成器同一换算（见 `generate.ts` 的 LENGTH_GROUPS）。 */
const REM_PX = 16;
const pv = (value: string, vars: Map<string, string>): number =>
  Number(resolveVar(value, vars).replace('rem', '')) * REM_PX;

/** 造一张最小的 token 表：只填留白这三档，其余不参与计算。 */
function fakeTokens(values: { base: number; md: number; lg: number }): HeytaNativeTokens {
  return {
    'screen.gutter': values.base,
    'screen.gutter-md': values.md,
    'screen.gutter-lg': values.lg,
  } as unknown as HeytaNativeTokens;
}

describe('页面留白阶梯：CSS 与原生共用一张表', () => {
  const vars = extractVars(CSS);

  it('锚点：三档都在 tokens.css 里（改名就红，不静默跳过）', () => {
    for (const name of ['--ht-screen-gutter', '--ht-screen-gutter-md', '--ht-screen-gutter-lg']) {
      expect(vars.has(name), `tokens.css 缺少 ${name}`).toBe(true);
    }
  });

  it('阶梯表恰好三档，且递增', () => {
    expect(SCREEN_GUTTER_STEPS).toHaveLength(3);
    const widths = SCREEN_GUTTER_STEPS.map((s) => s.minWidth);
    expect(widths, '阶梯必须按宽度递增，否则 resolveScreenGutter 的循环会取错档').toEqual([
      ...widths,
    ].sort((a, b) => a - b));
    expect(widths[0], '第一档必须是 0（基准，任何宽度都成立）').toBe(0);
  });

  it('每一档的在 0 宽度下的取值 == tokens.css 里同名变量的基准值', () => {
    // 基准档（:root 里那个）—— 生成器只解析第一个 :root，原生默认值也是它。
    expect(pv(vars.get('--ht-screen-gutter')!, vars)).toBe(16);
    expect(pv(vars.get('--ht-screen-gutter-md')!, vars)).toBe(24);
    expect(pv(vars.get('--ht-screen-gutter-lg')!, vars)).toBe(32);
  });

  it('CSS 媒体查询的断点与阶梯表的 minWidth 一一对应', () => {
    for (const step of SCREEN_GUTTER_STEPS) {
      if (step.cssBreakpointRem === null) continue;
      // 断言这条 @media 真的存在，且里面的覆盖值与 token 的三档一致。
      const rem = step.cssBreakpointRem;
      const block = new RegExp(
        `@media \\(min-width: ${rem}rem\\)\\s*\\{[\\s\\S]*?--ht-screen-gutter:\\s*([^;]+);`,
      ).exec(CSS);
      expect(block, `tokens.css 缺少 @media (min-width: ${rem}rem) 的 --ht-screen-gutter 覆盖`).not.toBeNull();
      const cssPx = pv(block![1]!.trim(), vars);
      const tokenPx = pv(vars.get(`--ht-${cssVarSuffix(step.token)}`)!, vars);
      expect(
        cssPx,
        `@media ${rem}rem 写的是 ${cssPx}px，而阶梯表指向 ${step.token} = ${tokenPx}px —— 两边漂了`,
      ).toBe(tokenPx);
    }
  });

  it('resolveScreenGutter 在每个断点上取到正确的档', () => {
    const t = fakeTokens({ base: 16, md: 24, lg: 32 });
    expect(resolveScreenGutter(0, t)).toBe(16);
    expect(resolveScreenGutter(390, t), 'iPhone 竖').toBe(16);
    expect(resolveScreenGutter(767, t)).toBe(16);
    expect(resolveScreenGutter(768, t), '恰好等于断点就进下一档').toBe(24);
    expect(resolveScreenGutter(834, t), 'iPad 竖').toBe(24);
    expect(resolveScreenGutter(1023, t)).toBe(24);
    expect(resolveScreenGutter(1024, t)).toBe(32);
    expect(resolveScreenGutter(1194, t), 'iPad 横').toBe(32);
    expect(resolveScreenGutter(1920, t), '桌面').toBe(32);
  });

  it('withResolvedScreenGutter 只换那一格，且不改入参', () => {
    const t = fakeTokens({ base: 16, md: 24, lg: 32 });
    const out = withResolvedScreenGutter(t, 1024);
    expect(out['screen.gutter']).toBe(32);
    expect(t['screen.gutter'], '入参不许被就地改（token 表在 Provider 之间共享引用）').toBe(16);
  });

  it('宽度未知 / 非法时原样返回（不猜成 32，也不炸成 NaN）', () => {
    const t = fakeTokens({ base: 16, md: 24, lg: 32 });
    for (const bad of [undefined, Number.NaN, 0, -100]) {
      expect(withResolvedScreenGutter(t, bad as number | undefined)['screen.gutter']).toBe(16);
    }
  });
});

/** `screen.gutter-md` → `screen-gutter-md`（token 名是点分，CSS 是连字符）。 */
function cssVarSuffix(token: string): string {
  return token.replace(/\./g, '-');
}
