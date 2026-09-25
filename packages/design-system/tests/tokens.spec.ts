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
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
// 解析 tokens.css
// ─────────────────────────────────────────────────────────────

/**
 * 按**花括号深度**切出顶层块，返回 [选择器, 块体] 列表。
 *
 * 为什么必须按深度：文件末尾有
 *     @media (prefers-reduced-motion: reduce) { :root { --ht-duration-fast: 1ms; } }
 * 这是**合法的、故意的**覆盖（尊重用户的减少动效设置）。
 * 但它里面的 `:root` 在深度 1，不是基准 token 块。
 * 第一版提取器没有深度概念，于是把时长全读成 1ms，测试报"超出 150-300ms" ——
 * 那是**测试错了，不是 CSS 错了**。
 */
function topLevelBlocks(css: string): Array<[string, string]> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<[string, string]> = [];
  let depth = 0;
  let buf = '';
  let selectorStart = 0;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (ch === '{') {
      if (depth === 0) {
        const selector = clean.slice(selectorStart, i).trim();
        // 找到配对的闭合括号
        let d = 1;
        let j = i + 1;
        for (; j < clean.length && d > 0; j++) {
          if (clean[j] === '{') d++;
          else if (clean[j] === '}') d--;
        }
        out.push([selector, clean.slice(i + 1, j - 1)]);
        i = j - 1;
        selectorStart = j;
        continue;
      }
      depth++;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) selectorStart = i + 1;
    }
    buf += ch;
  }
  return out;
}

/**
 * 抽取变量。
 *
 * ⚠️ 主题必须**基于基准合并**，不能独立抽取。
 * 原因：暗色块只覆盖语义变量，它引用的原始色阶（--ht-blue-400 等）仍然定义在
 * 亮色的 :root 里。只读暗色块的话，resolveVar 会一路走到 --ht-blue-400 就找不到，
 * 报「引用了未定义的 token」—— 这是**测试的实现问题，不是 CSS 的问题**。
 */
function extractVars(css: string, theme?: string): Map<string, string> {
  const out = new Map<string, string>();

  // 第一遍：基准 :root
  for (const [selector, body] of topLevelBlocks(css)) {
    if (selector !== ':root') continue;
    for (const [, name, value] of body.matchAll(/(--ht-[\w-]+)\s*:\s*([^;]+);/g)) {
      if (name && value) out.set(name, value.trim());
    }
  }

  // 第二遍：主题覆盖（叠在基准之上）
  if (theme !== undefined) {
    for (const [selector, body] of topLevelBlocks(css)) {
      if (selector !== `[data-theme='${theme}']`) continue;
      for (const [, name, value] of body.matchAll(/(--ht-[\w-]+)\s*:\s*([^;]+);/g)) {
        if (name && value) out.set(name, value.trim());
      }
    }
  }

  return out;
}

/**
 * 把值里的 var(--x) 递归展开成原始值。
 *
 * 必须递归：语义层引用原始色阶（--ht-color-primary → var(--ht-blue-600) → #2563eb），
 * 只展开一层的话拿到的是 `var(--ht-blue-600)`，没法算对比度。
 */
function resolveVar(
  value: string,
  vars: Map<string, string>,
  depth = 0,
): string {
  if (depth > 10) throw new Error(`var() 展开过深，可能存在循环引用：${value}`);
  const m = value.match(/^var\((--ht-[\w-]+)\)$/);
  if (!m) return value;

  const next = vars.get(m[1]!);
  if (next === undefined) {
    throw new Error(`引用了未定义的 token：${m[1]}`);
  }
  return resolveVar(next, vars, depth + 1);
}

/** 把颜色字面量转成 [r,g,b]（0-255）。支持 hex 与 rgb()/rgb( / ) 两种写法。 */
function parseColor(input: string): [number, number, number] {
  const v = input.trim();

  const hex = v.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6); // 丢弃 alpha
    if (h.length !== 6) throw new Error(`无法解析颜色：${input}`);
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  }

  // rgb(15 23 42 / 0.5) 或 rgb(15, 23, 42)
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgb) {
    return [
      Math.round(Number(rgb[1])),
      Math.round(Number(rgb[2])),
      Math.round(Number(rgb[3])),
    ];
  }

  throw new Error(`无法解析颜色：${input}`);
}

/**
 * WCAG 相对亮度与对比度。
 * 公式取自 WCAG 2.2 §1.4.3 定义（sRGB 通道先线性化）。
 */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function colorOf(token: string, vars: Map<string, string>): [number, number, number] {
  const name = cssVarName(token as never);
  const raw = vars.get(name);
  if (raw === undefined) throw new Error(`tokens.css 缺少 ${name}`);
  return parseColor(resolveVar(raw, vars));
}

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
    // 原始色阶（--ht-blue-600 等）是内部实现，允许不进 registry
    const INTERNAL = /^--ht-(blue|slate|red|amber|emerald|sky)-|^--ht-white$/;
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
    // instant 是刻意极短的按压反馈；exit 是刻意的快速退出
    const exempt = new Set(['instant', 'exit']);
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
