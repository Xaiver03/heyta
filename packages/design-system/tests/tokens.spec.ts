/**
 * 设计系统契约测试
 * ================
 *
 * 这些测试的价值不在于"跑绿"，而在于**让规范不可违背**：
 *
 *   1. 对比度 —— UIX Pro 把可访问性列为 CRITICAL，但"4.5:1"写在文档里
 *      等于没有约束。这里**真的解析 tokens.css 并计算 WCAG 对比度**。
 *      配色改坏会在 CI 失败，而不是等用户看不清文字。
 *
 *   2. token 同步 —— registry（tokens.ts）与 tokens.css 是唯一的漂移风险点。
 *      双向断言：registry 里的每个 token 必须在 CSS 存在，反之亦然。
 *
 *   3. 主题完整性 —— 暗色主题必须覆盖**全部语义颜色**。
 *      漏掉一个的后果是该元素在暗色下保持亮色值（刺眼白块），
 *      这类 bug 只在手动切换主题时才能发现。
 *
 * ⚠️ 解析器与对比度公式已抽到 `src/css-tokens.ts`，由这里与生成器
 * （`src/generate.ts`）共用。**不要在本文件里重新定义它们** ——
 * 两套解析实现迟早会对同一份 tokens.css 给出不同结果。
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  contrast,
  colorOf,
  extractVars,
  resolveVar,
} from '../src/css-tokens.js';
import {
  AA_PAIRS,
  GRAPHIC_PAIRS,
  TOKEN_GROUPS,
  allTokenNames,
  cssVar,
  cssVarName,
} from '../src/tokens.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../src/tokens.css'), 'utf8');

// ─────────────────────────────────────────────────────────────
// 测试
// ─────────────────────────────────────────────────────────────

describe('对比度（WCAG AA）', () => {
  const vars = extractVars(CSS);

  it.each(AA_PAIRS)('$fg on $bg ≥ $min:1（$why）', ({ fg, bg, min }) => {
    const ratio = contrast(colorOf(fg, vars), colorOf(bg, vars));
    // 失败时把实测值打出来，便于直接判断差多少
    expect(
      Number(ratio.toFixed(2)),
      `${fg} on ${bg} 实测 ${ratio.toFixed(2)}:1，要求 ≥ ${min}:1`,
    ).toBeGreaterThanOrEqual(min);
  });

  it.each(GRAPHIC_PAIRS)('$fg on $bg ≥ $min:1（$why）', ({ fg, bg, min }) => {
    const ratio = contrast(colorOf(fg, vars), colorOf(bg, vars));
    expect(
      Number(ratio.toFixed(2)),
      `${fg} on ${bg} 实测 ${ratio.toFixed(2)}:1，要求 ≥ ${min}:1`,
    ).toBeGreaterThanOrEqual(min);
  });
});

describe('暗色主题对比度（必须独立验证，不能从亮色推断）', () => {
  const dark = extractVars(CSS, 'dark');

  it.each(AA_PAIRS)('$fg on $bg ≥ $min:1（$why）', ({ fg, bg, min }) => {
    const ratio = contrast(colorOf(fg, dark), colorOf(bg, dark));
    expect(
      Number(ratio.toFixed(2)),
      `暗色 ${fg} on ${bg} 实测 ${ratio.toFixed(2)}:1，要求 ≥ ${min}:1`,
    ).toBeGreaterThanOrEqual(min);
  });
});

describe('token 与 CSS 同步（防漂移）', () => {
  const vars = extractVars(CSS);

  it('registry 里的每个 token 都真实存在于 tokens.css', () => {
    const missing = allTokenNames().filter(
      (t) => !vars.has(cssVarName(t)),
    );
    expect(missing, `这些 token 在 registry 里有、CSS 里没有：${missing.join(', ')}`).toEqual([]);
  });

  it('tokens.css 的每个变量都在 registry 里登记', () => {
    const registered = new Set(allTokenNames().map((t) => cssVarName(t)));
    // 原始色阶（--ht-blue-600 等）是内部实现，允许不进 registry。
    //
    // ⚠️ 判据是**结构**（色相名 + 数字档位），不是一张色相清单。
    // 原先这里枚举了 `blue|slate|red|amber|emerald|sky`，于是**每加一种新色相
    // 都要回来改这个正则** —— 而漏改的症状是"新色阶被当成没登记的语义变量"，
    // 与真正的漏登记长得一模一样。清单会腐烂，结构不会。
    const INTERNAL = /^--ht-(?!color-)[a-z]+-\d+$|^--ht-white$/;
    const unregistered = [...vars.keys()].filter(
      (v) => !registered.has(v) && !INTERNAL.test(v),
    );
    expect(
      unregistered,
      `这些 CSS 变量没进 registry，组件无法类型安全地引用：${unregistered.join(', ')}`,
    ).toEqual([]);
  });

  it('cssVar() 对合法 token 返回 var() 表达式', () => {
    expect(cssVar('color.primary')).toBe('var(--ht-color-primary)');
    expect(cssVar('space.4')).toBe('var(--ht-space-4)');
  });

  it('cssVar() 对非法 token 抛错（而不是静默返回坏值）', () => {
    expect(() => cssVar('color.primry' as never)).toThrow(/未知设计 token/);
  });
});

describe('暗色主题覆盖完整性', () => {
  const light = extractVars(CSS);
  const dark = extractVars(CSS, 'dark');

  it('每个语义颜色都要有暗色覆盖', () => {
    const colorTokens = TOKEN_GROUPS.color.map((n) => `--ht-color-${n}`);
    const missing = colorTokens.filter((v) => !dark.has(v));
    expect(
      missing,
      `暗色主题漏了这些颜色，会导致暗色下出现亮色块：${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('暗色与亮色的取值必须有实际差异（防止复制粘贴后忘改）', () => {
    // 显式例外：这些 token 在两个主题下**故意**取同值。每条都必须写理由。
    const SAME_IN_BOTH = new Set([
      // blue-500 在近白与近黑底上都够亮，无需分主题
      '--ht-color-heat-3',
    ]);
    const colorTokens = TOKEN_GROUPS.color.map((n) => `--ht-color-${n}`);
    const identical = colorTokens.filter(
      (v) => dark.get(v) === light.get(v) && !SAME_IN_BOTH.has(v),
    );
    expect(
      identical,
      `这些颜色在暗色下与亮色完全相同，几乎肯定是漏改：${identical.join(', ')}`,
    ).toEqual([]);
  });
});

describe('非颜色 token 的尺度合理性', () => {
  const vars = extractVars(CSS);

  it('间距 token 全部是 4px 的整数倍（4/8dp 节奏）', () => {
    for (const name of TOKEN_GROUPS.space) {
      const raw = resolveVar(vars.get(`--ht-space-${name}`)!, vars);
      // 0 是合法值，不需要单位
      const px = raw === '0' ? 0 : (() => {
        const m = raw.match(/^([\d.]+)rem$/);
        expect(m, `--ht-space-${name} 应为 rem 值，实际 ${raw}`).toBeTruthy();
        return Number(m![1]) * 16;
      })();
      expect(px % 4, `--ht-space-${name} = ${px}px，不是 4 的倍数`).toBe(0);
    }
  });

  it('字号呈单调递增（防止有人插错位置）', () => {
    const sizes = TOKEN_GROUPS['font-size'].map((n) => {
      const raw = resolveVar(vars.get(`--ht-font-size-${n}`)!, vars);
      return Number(raw.replace('rem', '')) * 16;
    });
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!, `字号在索引 ${i} 处未递增`).toBeGreaterThan(sizes[i - 1]!);
    }
  });

  it('动效时长都在 150–300ms 区间内（或明确标注的极短/退出值）', () => {
    // 豁免项不是"为了变绿"，而是这些时长**不受 150–300ms 规律约束**：
    //   instant —— 刻意极短的按压反馈
    //   exit    —— 刻意更快的退出（退出慢会读起来像卡住）
    //   press   —— 按下反馈。UIX Pro Max 的 150–300ms 管的是**过渡动画**；
    //              按压反馈按 Apple《Designing Fluid Interfaces》必须即刻出现，
    //              超过 ~100ms 就开始"发木"。它属于另一条规律，不是更快的过渡。
    const exempt = new Set(['instant', 'exit', 'press']);
    for (const name of TOKEN_GROUPS.duration) {
      if (exempt.has(name)) continue;
      const raw = resolveVar(vars.get(`--ht-duration-${name}`)!, vars);
      const ms = Number(raw.replace('ms', ''));
      expect(ms, `--ht-duration-${name} = ${ms}ms 超出 150–300ms`).toBeGreaterThanOrEqual(150);
      expect(ms, `--ht-duration-${name} = ${ms}ms 超出 150–300ms`).toBeLessThanOrEqual(300);
    }
  });

  it('z-index 阶梯严格递增（防止层叠顺序错乱）', () => {
    const zs = TOKEN_GROUPS.z.map((n) => Number(vars.get(`--ht-z-${n}`)!));
    for (let i = 1; i < zs.length; i++) {
      expect(zs[i]!, `z 阶梯在 ${TOKEN_GROUPS.z[i]} 处未递增`).toBeGreaterThan(zs[i - 1]!);
    }
  });

  it('触控目标不小于 44px（可访问性硬下限）', () => {
    const raw = resolveVar(vars.get('--ht-touch-target-min')!, vars);
    const px = Number(raw.replace('rem', '')) * 16;
    expect(px, `触控目标 ${px}px 低于 44px 硬下限`).toBeGreaterThanOrEqual(44);
  });
});
