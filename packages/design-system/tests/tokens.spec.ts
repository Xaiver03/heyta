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
  normalizeColor,
  parseColor,
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

describe('分享卡片的暖纸色（R15）—— 升格为 token 之后必须过对比度', () => {
  /**
   * 🔴 这组纸色此前**硬编码在 `og-card.html` 里**，而 `.html` 不在 `check:design`
   * 的扫描面内 —— 于是"卡片上有一套没人管的颜色"没有任何判据能发现（R15）。
   * 升格成 token 之后，这里按 WCAG 真的算一遍：
   *   · 正文与次要文字必须过 AA（4.5:1）；
   *   · 分隔线是**装饰性**的（WCAG 的非文本对比 3:1 针对的是承载信息的图形，
   *     它不承载），所以这里只兜一个"看得见"的下限 1.3:1 —— 实测 1.39:1。
   *     这不是把阈值迁就取值：`#d8d6d1` 是卡片既有的分隔线色，判据拦的是
   *     "有人把它调到与纸面几乎同色"那种回归。
   */
  const vars = extractVars(CSS);
  const paper = (name: string): [number, number, number] => {
    const value = vars.get(name);
    if (value === undefined) throw new Error(`tokens.css 里没有 ${name}`);
    return parseColor(value);
  };

  const PAIRS = [
    { fg: '--ht-paper-900', bg: '--ht-paper-50', min: 4.5, why: '卡片正文' },
    { fg: '--ht-paper-600', bg: '--ht-paper-50', min: 4.5, why: '卡片次要文字' },
    { fg: '--ht-paper-200', bg: '--ht-paper-50', min: 1.3, why: '分隔线（装饰，只需看得见）' },
    { fg: '--ht-paper-900', bg: '--ht-paper-200', min: 4.5, why: '纸色上的深色文字' },
  ];

  it.each(PAIRS)('$fg on $bg ≥ $min:1（$why）', ({ fg, bg, min, why }) => {
    const ratio = contrast(paper(fg), paper(bg));
    expect(
      Number(ratio.toFixed(2)),
      `${fg} on ${bg}（${why}）实测 ${ratio.toFixed(2)}:1，要求 ≥ ${min}:1`,
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

describe('玻璃材质：tint 合成在最坏背景上的对比度（ADR-0042 §4）', () => {
  /**
   * 🔴 静态 AA_PAIRS 覆盖不了半透明面：玻璃的实际底色是
   * `composite = α·tint + (1−α)·下层内容`，而下层内容**不可控**。
   * 所以这里的判据是「最坏情况下限」：把 token 表里最亮与最暗的两个
   * 色值当作玻璃下方可能出现的极端内容，实算合成后的对比度。
   *
   * 档位契约（与 material-surface.ts 的档位表互为判据）：
   *   · panel / sheet（菜单、下拉、底部面板 —— 承载密集文字）：
   *     主前景色**与次要文字**都必须过 4.5:1；
   *   · chrome（导航条 / 命令面板 —— 只有主前景色）：
   *     只对主前景色把关。
   *
   * ⚠️ 最后一条**反向断言**：muted 在 chrome 上过不了 4.5:1 —— 它不是
   * 失败，是「chrome 不承载次要文字」这条契约的**证据**。哪天有人把
   * chrome-tint 调厚到让这条反向断言翻红（muted 反而过线了），说明
   * chrome 已经厚到可以放开这条限制，应连同 material-surface.ts 的
   * 档位注释一起重审，而不是删掉这条断言。
   */
  const light = extractVars(CSS);
  const dark = extractVars(CSS, 'dark');

  /** 把 token 值拆成 {通道, alpha}。只认 normalizeColor 能产的 hex 形态。 */
  function rgbaOf(value: string): { rgb: [number, number, number]; a: number } {
    const hex = normalizeColor(value);
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) {
      throw new Error(`不认识的颜色形态：${value} → ${hex}`);
    }
    return {
      rgb: parseColor(hex.slice(0, 7)),
      a: hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1,
    };
  }

  /** α 合成：tint 盖在 bg 上之后实际呈现的颜色。 */
  function blend(tintValue: string, bgValue: string): [number, number, number] {
    const t = rgbaOf(tintValue);
    const b = rgbaOf(bgValue);
    const mix = (i: 0 | 1 | 2): number => Math.round(t.rgb[i] * t.a + b.rgb[i] * (1 - t.a));
    return [mix(0), mix(1), mix(2)];
  }

  type Vars = Map<string, string>;
  const tintOf = (vars: Vars, name: string): string => {
    const v = vars.get(name);
    if (v === undefined) throw new Error(`tokens.css 缺 ${name}`);
    return resolveVar(v, vars);
  };
  const fgOf = (vars: Vars, name: string): [number, number, number] =>
    parseColor(resolveVar(vars.get(name)!, vars));

  interface GlassCase {
    theme: string;
    vars: Vars;
    fg: string;
    tier: string;
    tint: string;
    /** 玻璃下方的极端内容色（token 表里的最亮/最暗）。 */
    bg: string;
    bgValue: string;
  }

  const LIGHT_BGS: Array<[string, string]> = [
    ['--ht-white', '页面最亮内容'],
    ['--ht-slate-900', '页面最暗内容'],
  ];
  const DARK_BGS: Array<[string, string]> = [
    ['--ht-slate-50', '下方最亮内容（亮色截图/卡片)'],
    ['--ht-slate-950', '下方最暗内容'],
  ];

  const CASES: GlassCase[] = [];
  for (const [theme, vars, bgs] of [
    ['亮色', light, LIGHT_BGS],
    ['暗色', dark, DARK_BGS],
  ] as Array<[string, Vars, Array<[string, string]>]>) {
    for (const [bgToken, bgWhy] of bgs) {
      const bgValue = tintOf(vars, bgToken);
      const tints: Array<[string, string]> = [
        ['panel', '--ht-material-panel-tint'],
        ['sheet', '--ht-material-sheet-tint'],
      ];
      for (const [tier, tintToken] of tints) {
        CASES.push({
          theme,
          vars,
          fg: '--ht-color-foreground',
          tier,
          tint: tintOf(vars, tintToken),
          bg: `${bgToken}（${bgWhy}）`,
          bgValue,
        });
        CASES.push({
          theme,
          vars,
          fg: '--ht-color-foreground-muted',
          tier,
          tint: tintOf(vars, tintToken),
          bg: `${bgToken}（${bgWhy}）`,
          bgValue,
        });
      }
      // chrome 档只对主前景色把关（契约见 describe 头）。
      CASES.push({
        theme,
        vars,
        fg: '--ht-color-foreground',
        tier: 'chrome',
        tint: tintOf(vars, '--ht-material-chrome-tint'),
        bg: `${bgToken}（${bgWhy}）`,
        bgValue,
      });
    }
  }

  it.each(CASES)(
    '$theme $tier 档：$fg 盖在「$bg」上 ≥ 4.5:1',
    ({ theme, vars, fg, tier, tint, bg, bgValue }) => {
      const ratio = contrast(fgOf(vars, fg), blend(tint, bgValue));
      expect(
        Number(ratio.toFixed(2)),
        `${theme} ${tier} 档 ${fg} × ${bg} 实测 ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('反向证据：muted 在 chrome 档上过不了 4.5:1 —— 这正是「chrome 不承载次要文字」契约的理由', () => {
    // 只找一个足以证明契约存在的取值：亮色 chrome × 最暗内容。
    const tint = tintOf(light, '--ht-material-chrome-tint');
    const bgValue = tintOf(light, '--ht-slate-900');
    const ratio = contrast(fgOf(light, '--ht-color-foreground-muted'), blend(tint, bgValue));
    expect(Number(ratio.toFixed(2)), `实测 ${ratio.toFixed(2)}:1`).toBeLessThan(4.5);
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
    //   splash-* —— 启动那一帧的四个时长。它们不是界面内的过渡，而是被两条
    //              **外部**约束夹住的一帧（Android 建议整段 ≤1000ms、短于 ~300ms
    //              读不出"正在打开"）。豁免不是终点：这一族自己那条规律钉在
    //              下面那条用例里，光摘掉它等于给漏洞上户口。
    //
    // ⚠️ 逐个点名（不是 `^splash-` 前缀匹配）是刻意的：前缀匹配会让"以后任何一枚
    // 时长"都能靠**取名**绕过 150–300ms，而取名不是设计判断。新增一枚要改这里，
    // 成本逼人说清它属于哪条规律。
    const exempt = new Set(['instant', 'exit', 'press', 'splash-enter', 'splash-stagger', 'splash-hold', 'splash-exit']);
    for (const name of TOKEN_GROUPS.duration) {
      if (exempt.has(name)) continue;
      const raw = resolveVar(vars.get(`--ht-duration-${name}`)!, vars);
      const ms = Number(raw.replace('ms', ''));
      expect(ms, `--ht-duration-${name} = ${ms}ms 超出 150–300ms`).toBeGreaterThanOrEqual(150);
      expect(ms, `--ht-duration-${name} = ${ms}ms 超出 150–300ms`).toBeLessThanOrEqual(300);
    }
  });

  it('首屏那一族受它自己那两条外部约束管住', () => {
    // 阈值不是拍的，来自 `docs/plans/brand-icon-and-splash.md` §3 抄下来的平台事实：
    //   · 上限：Android 官方建议整段 ≤1000ms（超了就该换成循环动画）。
    //   · 下限：入场短于 ~300ms 读不出"正在打开"，那一帧就白做。
    // 整段 = enter + stagger×2（三道字形错峰）+ hold，算法与 `gen-boot-splash.mjs`
    // 打印的那个 800ms 同源；这里重新算一遍，而不是抄它输出的数（抄件一定会漂）。
    const ms = (suffix: string) =>
      Number(resolveVar(vars.get(`--ht-duration-${suffix}`)!, vars).replace('ms', ''));
    const enter = ms('splash-enter');
    const stagger = ms('splash-stagger');
    const hold = ms('splash-hold');
    const exit = ms('splash-exit');

    expect(enter, '入场短于 300ms 读不出"正在打开"').toBeGreaterThanOrEqual(300);
    const total = enter + stagger * 2 + hold;
    expect(total, `整段 ${total}ms 超过 Android 建议的 1000ms`).toBeLessThanOrEqual(1000);
    // 遮罩淡出走"退出比进入快"那条纪律，且不得比整段还长（会把启动帧拖成两段）。
    expect(exit, '退场比入场慢').toBeLessThanOrEqual(enter);
    expect(exit, '退场为 0 就等于没有退场').toBeGreaterThan(0);
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
