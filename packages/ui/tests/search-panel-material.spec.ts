/**
 * 搜索浮层的底色 —— **"没有模糊就不许用半透明材质"的判据**
 * =======================================================
 *
 * 出处：2026-10-01 Android 模拟器实测（`apps/mobile/evidence/android-search-*.png`）。
 * 共享层把玻璃做成"半透明 tint + `backdrop-filter: blur()`"两半，而 RN 原生**没有**
 * `backdrop-filter` 这个属性 —— 结果原生端拿到的是只剩一半的材质：
 * 顶栏图标与大号日期标题穿过卡片印在前景上，"关闭"的 ✕ 与底下的同步图标重叠成
 * 一个字形。而这件事**没有任何一层会报错**：对比度是随机数，取决于底下排了什么。
 *
 * 🔴 三层，缺一不可（少了任何一层，"改回无条件 tint"都能骗过去）：
 *   A. 生产函数在**有** blur 时给出 tint，且那个 tint 确实是半透明的
 *      （否则 web 那一半材质被悄悄换成了实色，e2e ⑧ 会红而这里不会）。
 *   B. 生产函数在**没有** blur 时给出的颜色必须**不透明**，两个主题各查一次。
 *      这一条才是本次缺陷的直接判据：把无 blur 分支改回 `chrome-tint` ⇒ 红。
 *   C. 组件必须真的调用它、真的把 blur 能力交进去（源码级，剥注释）。
 *      没有 C，函数可以是一具没人消费的尸体，A/B 全绿而界面上还是老样子。
 *
 * ⚠️ 与 `task-row-density.spec.ts` 同一类限制：`packages/ui` 的单测不 render、
 * 不引 jsdom，所以 C 是**源码级**判据。像素级的"到底看不穿"由真机截图负责（§6.2 规定一）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { darkTokens, lightTokens, type ThemeName } from '@heyta/design-system';
import { describe, expect, it } from 'vitest';

import { panelSurfaceColor } from '../src/search/panel-surface.js';

/**
 * 取一个 CSS 颜色的 alpha。
 *
 * 只认 token 表里实际出现的三种形态（`#rgb` / `#rrggbb` / `rgba(...)`）——
 * 认不出来就抛，**不返回 1**。返回 1 会让"表里冒出一个没见过的写法"
 * 变成一条永远通过的判据，而那正是本文件要防的东西。
 */
function alphaOf(color: string): number {
  const rgba = /rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(color);
  if (rgba) return Number(rgba[1]);
  if (/^#[0-9a-f]{6}$/i.test(color)) return 1;
  if (/^#[0-9a-f]{8}$/i.test(color)) return parseInt(color.slice(7, 9), 16) / 255;
  throw new Error(`不认识的颜色形态，无法判断透明度：${color}`);
}

const TABLES: readonly [ThemeName, typeof lightTokens][] = [
  ['light', lightTokens],
  ['dark', darkTokens],
];

const source = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/search/${file}`, import.meta.url)), 'utf8');

function stripComments(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
}

describe('SearchPanel 的底色按 blur 能力分支', () => {
  it('A. 有 blur ⇒ 玻璃 tint，且它确实是半透明的（材质两半没被换成实色）', () => {
    for (const [theme, tokens] of TABLES) {
      const color = panelSurfaceColor(tokens, true);
      expect(color, `${theme}：有 blur 时应当用 chrome-tint`).toBe(tokens['material.chrome-tint']);
      expect(alphaOf(color), `${theme}：chrome-tint 不再是半透明 ⇒ 玻璃的两半塌了一半`)
        .toBeLessThan(1);
    }
  });

  it('B. 没有 blur ⇒ 必须**不透明**（本次缺陷的直接判据，两个主题各查一次）', () => {
    for (const [theme, tokens] of TABLES) {
      const color = panelSurfaceColor(tokens, false);
      expect(
        alphaOf(color),
        `${theme}：RN 原生没有 backdrop-filter，半透明面会让下层内容穿过卡片`,
      ).toBe(1);
      // 而且必须是登记过对比度的那一档（正文（浮层）= foreground on surface-raised）。
      expect(color).toBe(tokens['color.surface-raised']);
    }
  });

  it('B2. 两个分支给出的必须**不是同一个值**（否则分支是装饰）', () => {
    for (const [theme, tokens] of TABLES) {
      expect(
        panelSurfaceColor(tokens, true),
        `${theme}：blur 与否给出同一张面 —— 分支没有效果`,
      ).not.toBe(panelSurfaceColor(tokens, false));
    }
  });

  it('C. 组件真的调用它，并把 blur 能力作为第二个参数交出（函数没人用会红）', () => {
    const panel = stripComments(source('SearchPanel.tsx'));
    expect(panel).toMatch(/panelSurfaceColor\(\s*tokens\s*,/);
    // 底色不许再无条件写死成 tint —— 那正是本次缺陷的形状。
    expect(panel).not.toMatch(/backgroundColor:\s*tokens\['material\.chrome-tint'\]/);
    // 谓词来自渲染目标（CSS 才有 backdrop-filter），不是猜某个产品端。
    const surface = stripComments(source('panel-surface.ts'));
    expect(surface).toContain("'color.surface-raised'");
  });
});
