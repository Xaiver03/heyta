/**
 * 玻璃材质表面 —— **"没有模糊就不许用半透明材质"的判据**
 * =======================================================
 *
 * 出处：2026-10-01 Android 模拟器实测（`apps/mobile/evidence/android-search-*.png`）。
 * 共享层把玻璃做成"半透明 tint + `backdrop-filter: blur()`"两半，而 RN 原生**没有**
 * `backdrop-filter` 这个属性 —— 结果原生端拿到的是只剩一半的材质：
 * 顶栏图标与大号日期标题穿过卡片印在前景上，"关闭"的 ✕ 与底下的同步图标重叠成
 * 一个字形。而这件事**没有任何一层会报错**：对比度是随机数，取决于底下排了什么。
 *
 * 🔴 判据分层，缺一不可（少了任何一层，"改回无条件 tint"都能骗过去）：
 *   A. 生产函数在**有** blur 时按档位给出 tint，且 tint 确实是半透明的
 *      （否则 web 那一半材质被悄悄换成了实色，e2e 会红而这里不会）。
 *   B. 生产函数在**没有** blur 时给出的颜色必须**不透明**，两个主题各查一次。
 *      这一条是 Android 穿字缺陷的直接判据：把无 blur 分支改回 tint ⇒ 红。
 *   C. 组件必须真的调用它、真的把 blur 能力交进去（源码级，剥注释）。
 *      没有 C，函数可以是一具没人消费的尸体，A/B 全绿而界面上还是老样子。
 *
 * 2026-10-01 从 `panel-surface.ts`（搜索专用）升级为 `material/material-surface.ts`
 * （ADR-0042：chrome/panel/sheet 三档 + rim 契约）。rim：有 blur 的面用
 * `material.edge-highlight`（光打在材料上），无 blur 的面用 `color.border`
 * （不透明面需要的是分隔线，不是光）。
 *
 * ⚠️ 与 `task-row-density.spec.ts` 同一类限制：`packages/ui` 的单测不 render、
 * 不引 jsdom，所以 C 是**源码级**判据。像素级的"到底看不穿"由真机截图负责（§6.2 规定一）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { darkTokens, lightTokens, resolveNativeTokens, type ThemeName } from '@heyta/design-system';
import { describe, expect, it } from 'vitest';

import { materialSurface, type MaterialTier } from '../src/material/material-surface.js';

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

const TIERS: readonly MaterialTier[] = ['chrome', 'panel', 'sheet'];

const TINT_TOKEN: Record<MaterialTier, 'material.chrome-tint' | 'material.panel-tint' | 'material.sheet-tint'> = {
  chrome: 'material.chrome-tint',
  panel: 'material.panel-tint',
  sheet: 'material.sheet-tint',
};

const source = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');

function stripComments(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
}

describe('materialSurface：按档位与 blur 能力分支', () => {
  it('A. 有 blur ⇒ 对应档位的玻璃 tint，且确实是半透明的（材质两半没被换成实色）', () => {
    for (const [theme, tokens] of TABLES) {
      for (const tier of TIERS) {
        const surface = materialSurface(tokens, tier, true);
        expect(surface.backgroundColor, `${theme}/${tier}：应当用 ${TINT_TOKEN[tier]}`).toBe(
          tokens[TINT_TOKEN[tier]],
        );
        expect(
          alphaOf(surface.backgroundColor),
          `${theme}/${tier}：tint 不再是半透明 ⇒ 玻璃的两半塌了一半`,
        ).toBeLessThan(1);
      }
    }
  });

  it('A2. 有 blur ⇒ rim 是边缘高光（光），不是普通分隔线', () => {
    for (const [theme, tokens] of TABLES) {
      const surface = materialSurface(tokens, 'panel', true);
      expect(surface.borderColor, `${theme}：玻璃 rim 应为 edge-highlight`).toBe(
        tokens['material.edge-highlight'],
      );
    }
  });

  it('B. 没有 blur ⇒ 必须**不透明**（Android 穿字缺陷的直接判据，两个主题各查一次）', () => {
    for (const [theme, tokens] of TABLES) {
      for (const tier of TIERS) {
        const surface = materialSurface(tokens, tier, false);
        expect(
          alphaOf(surface.backgroundColor),
          `${theme}/${tier}：RN 原生没有 backdrop-filter，半透明面会让下层内容穿过卡片`,
        ).toBe(1);
        // 而且必须是登记过对比度的那一档（正文（浮层）= foreground on surface-raised）。
        expect(surface.backgroundColor).toBe(tokens['color.surface-raised']);
        // 不透明的面配普通分隔线，不配"光"。
        expect(surface.borderColor).toBe(tokens['color.border']);
      }
    }
  });

  it('B2. 两个分支给出的必须**不是同一个值**（否则分支是装饰）', () => {
    for (const [theme, tokens] of TABLES) {
      for (const tier of TIERS) {
        expect(
          materialSurface(tokens, tier, true).backgroundColor,
          `${theme}/${tier}：blur 与否给出同一张面 —— 分支没有效果`,
        ).not.toBe(materialSurface(tokens, tier, false).backgroundColor);
      }
    }
  });

  it('C. SearchPanel 真的调用它，档位是 chrome、并把 blur 能力交出（函数没人用会红）', () => {
    const panel = stripComments(source('search/SearchPanel.tsx'));
    expect(panel).toMatch(/materialSurface\(\s*tokens\s*,\s*'chrome'\s*,\s*Platform\.OS === 'web'\s*\)/);
    // 底色不许再无条件写死成 tint —— 那正是 Android 缺陷的形状。
    expect(panel).not.toMatch(/backgroundColor:\s*tokens\['material\.(chrome|panel|sheet)-tint'\]/);
    // 谓词来自渲染目标（CSS 才有 backdrop-filter），不是猜某个产品端。
    const surface = stripComments(source('material/material-surface.ts'));
    expect(surface).toContain("'color.surface-raised'");
  });

  it('D. 「减少透明度」覆盖层合并后，有 blur 的分支也必须给出实色（ADR-0042 §4）', () => {
    // 🔴 这条是 e2e 抓到的真缺陷的钉子：搜索卡片的 tint 来自 RN 内联样式
    // （JS token 表 → 原子类），tokens.css 的媒体查询管不到它 —— 降级必须
    // 走生成式覆盖层 + matchMedia（theme.tsx），这条测试钉住合并后的终值。
    for (const [theme, base] of TABLES) {
      const merged = resolveNativeTokens({ theme, reducedTransparency: true });
      const surface = materialSurface(merged, 'chrome', true);
      expect(
        alphaOf(surface.backgroundColor),
        `${theme}：系统「减少透明度」时，即便端有 blur，tint 也必须是实色`,
      ).toBe(1);
      expect(surface.backgroundColor).toBe(merged['color.surface']);
    }
  });
});
