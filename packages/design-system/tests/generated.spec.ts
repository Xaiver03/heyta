/**
 * 生成产物契约测试
 * ==================
 *
 * 生成器能跑通 ≠ 产物是对的。这个测试盯的是那些**静默失效**：
 *
 *   1. 产物必须覆盖 registry 里的**每一个** token —— 漏一个不会报错，
 *      只会在原生端少一个颜色，改用硬编码「临时补一下」。
 *   2. 产物里**不许残留 `var(`** —— Swift / ArkTS 拿到 `var(--ht-blue-600)`
 *      不会编译失败，只会得到透明/默认色，而且极难定位。
 *   3. round-trip：生成的颜色必须**逐字节**等于从 tokens.css 重新解析的值。
 *   4. 对比度必须用**产物里的值**重算 —— 生成器转错一个 hex
 *      （例如把 alpha 丢掉）会在这里被拦下，而不是在真机上。
 *   5. 暗色 / 减少动效两段必须真的存在，且减少动效说明了原生怎么替代媒体查询。
 *
 * 复用 `src/css-tokens.ts` 的解析与 WCAG 公式：不重写对比度数学。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  contrast,
  extractVars,
  normalizeColor,
  parseColor,
  resolveVar,
} from '../src/css-tokens.js';
import {
  arktsDarkName,
  arktsName,
  arktsReducedMotionName,
  generateAll,
  swiftName,
} from '../src/generate.js';
import {
  AA_PAIRS,
  GRAPHIC_PAIRS,
  TOKEN_GROUPS,
  allTokenNames,
  cssVarName,
} from '../src/tokens.js';
import { TEXT_STYLES } from '../src/typography.js';
import type { TextStyleSpec } from '../src/typography.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../src/tokens.css'), 'utf8');
const GEN_DIR = resolve(HERE, '../generated');

const readGen = (name: string): string => readFileSync(resolve(GEN_DIR, name), 'utf8');

const bundle = generateAll(CSS);
const swiftText = readGen('HeytaTokens.swift');
const arktsText = readGen('HeytaTokens.ets');
const jsonText = readGen('tokens.json');
const typographyCssText = readGen('typography.css');
const xamlText = readGen('HeytaTokens.xaml');
const gtkCssText = readGen('heyta.gtk.css');
const gtkHeaderText = readGen('heyta-tokens.h');

/** 复现生成器里的空白压缩，保证 round-trip 比较的是同一形状。 */
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

// ─────────────────────────────────────────────────────────────
// 把产物解析回 名字 → 值
// ─────────────────────────────────────────────────────────────

const SWIFT_LET = /static let (\w+): (?:String|Double) = ("(?:[^"\\]|\\.)*"|[-\d.]+)/g;
const ARKTS_CONST = /export const (\w+): (?:string|number) = ('(?:[^'\\]|\\.)*'|[-\d.]+);/g;

/** 按 `// SECTION: X` 切出 Swift 里某个 enum 的常量。 */
function swiftSection(text: string, section: string): Map<string, string> {
  const marker = `// SECTION: ${section}`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Swift 产物里找不到 ${marker}`);
  const rest = text.slice(start + marker.length);
  const next = rest.indexOf('// SECTION:');
  const body = next >= 0 ? rest.slice(0, next) : rest;

  const out = new Map<string, string>();
  for (const m of body.matchAll(SWIFT_LET)) {
    const raw = m[2]!;
    // 字符串字面量直接交给 JSON.parse 去反转义（Swift 与 JSON 转义一致）
    out.set(m[1]!, raw.startsWith('"') ? (JSON.parse(raw) as string) : raw);
  }
  return out;
}

/** 解析 ArkTS 的全部 export const（亮/暗/减少动效用不同前缀区分）。 */
function arktsConstants(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(ARKTS_CONST)) {
    const raw = m[2]!;
    out.set(
      m[1]!,
      raw.startsWith("'")
        ? raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\')
        : raw,
    );
  }
  return out;
}

const swiftLight = swiftSection(swiftText, 'Light');
const swiftDark = swiftSection(swiftText, 'Dark');
const swiftReduced = swiftSection(swiftText, 'ReducedMotion');
const arkts = arktsConstants(arktsText);
const json = JSON.parse(jsonText) as {
  light: Record<string, string | number>;
  dark: Record<string, string | number>;
  reducedMotion: Record<string, number>;
};

// 从 tokens.css 独立重新解析出的值
const lightVars = extractVars(CSS);
const darkVars = extractVars(CSS, 'dark');

function resolvedCss(vars: Map<string, string>, token: string): string {
  const raw = vars.get(cssVarName(token as never));
  if (raw === undefined) throw new Error(`tokens.css 缺少 ${cssVarName(token as never)}`);
  return collapse(resolveVar(raw, vars));
}

const COLOR_TOKENS = TOKEN_GROUPS.color.map((n) => `color.${n}` as const);

// ─────────────────────────────────────────────────────────────
// 1. 产物必须是当前 tokens.css 的产物（防止改完忘记重新生成）
// ─────────────────────────────────────────────────────────────

describe('产物与 tokens.css 同步', () => {
  it('提交的 HeytaTokens.swift 与当前 tokens.css 一致', () => {
    expect(swiftText, '产物已过期，跑 `pnpm --filter @heyta/design-system run generate`').toBe(
      bundle.swift,
    );
  });

  it('提交的 HeytaTokens.ets 与当前 tokens.css 一致', () => {
    expect(arktsText, '产物已过期，跑 `pnpm --filter @heyta/design-system run generate`').toBe(
      bundle.arkts,
    );
  });

  it('提交的 tokens.json 与当前 tokens.css 一致', () => {
    expect(jsonText, '产物已过期，跑 `pnpm --filter @heyta/design-system run generate`').toBe(
      bundle.json,
    );
  });

  it('提交的 typography.css 与 TEXT_STYLES 一致，且只引用 var() 不写死数值', () => {
    expect(
      typographyCssText,
      '产物已过期，跑 `pnpm --filter @heyta/design-system run generate`',
    ).toBe(bundle.typographyCss);
    // 每个语义档位都有对应的类；数字类必须带 tabular-nums
    for (const [name, spec] of Object.entries(TEXT_STYLES) as [string, TextStyleSpec][]) {
      expect(typographyCssText, `缺 .ht-type-${name}`).toContain(`.ht-type-${name} {`);
      if (spec.tabularNums === true) {
        expect(typographyCssText, `${name} 必须带 tabular-nums`).toMatch(
          new RegExp(`\\.ht-type-${name} \\{[^}]*tabular-nums`),
        );
      }
    }
    // 🔴 数值只许以 var() 引用出现 —— 一旦手写进数值就是第二事实源
    expect(typographyCssText).not.toMatch(/font-size:\s*[\d.]/);
    expect(typographyCssText).not.toMatch(/font-weight:\s*[\d.]/);
  });

  it('提交的 HeytaTokens.xaml 一致：颜色全是 #AARRGGBB、键覆盖全部 token', () => {
    expect(xamlText, '产物已过期，跑 `pnpm --filter @heyta/design-system run generate`').toBe(
      bundle.xaml,
    );
    // XAML 的字节序是 alpha 在头 —— 换错端会得到全透明或全黑
    expect(xamlText).not.toMatch(/Color="#[0-9a-f]{6}"/);
    expect(xamlText).toMatch(/Color="#FF2563EB"/); // color.primary = blue-600
    const keys = [...xamlText.matchAll(/x:Key="(\w+)"/g)].map((m) => m[1]!);
    expect(keys.length, 'XAML 至少覆盖全部 token（一个 token 一个 key）').toBeGreaterThanOrEqual(
      allTokenNames().length,
    );
    // XML 注释里禁止连续连字符（XML 规范硬性限制，第一版就栽在这）。
    // 注意只查注释**内容**：终结符 --> 自带两个连字符，把它先剥掉再查。
    for (const m of xamlText.matchAll(/<!--([\s\S]*?)-->/g)) {
      expect(m[1], 'XML 注释内容里不许出现 --（XML 规范）').not.toContain('--');
    }
  });

  it('提交的 heyta.gtk.css / heyta-tokens.h 一致：色板全量 + 三个样式类 + 头内嵌同一份 CSS', () => {
    expect(gtkCssText, '产物已过期，跑 `pnpm --filter @heyta/design-system run generate`').toBe(
      bundle.gtkCss,
    );
    expect(gtkHeaderText).toBe(bundle.gtkHeader);
    const palette = [...gtkCssText.matchAll(/@define-color (\w+) /g)];
    expect(palette.length).toBeGreaterThanOrEqual(
      allTokenNames().filter((t) => t.startsWith('color.')).length,
    );
    for (const cls of ['.heyta-window', '.heyta-title', '.heyta-dim']) {
      expect(gtkCssText, `Linux 壳消费的样式类 ${cls} 必须存在`).toContain(`${cls} {`);
    }
    // GTK CSS 不认 border/background 简写 —— 写成简写会被静默丢掉
    expect(gtkCssText).not.toMatch(/^\s*(border|background):/m);
    // 头里的 CSS 必须与 .css 文件同源（换算成 C 字符串后能对上色板首行）
    expect(gtkHeaderText).toContain('@define-color ht_color_primary ');
    expect(gtkHeaderText).toMatch(/static const char HEYTA_TOKENS_CSS\[\]/);
  });

  it('Swift 产物带 Color(hex:) 桥（P0-8：颜色 token 从「可读不可用」变可用）', () => {
    expect(swiftText).toContain('static func color(_ hex: String) -> Color');
    // 8 位 hex 的注释必须写明 alpha 在尾 —— 与 normalizeColor 的产物一致
    expect(swiftText).toContain('#rrggbbaa');
  });
});

// ─────────────────────────────────────────────────────────────
// 2. 覆盖完整性
// ─────────────────────────────────────────────────────────────

describe('覆盖完整性', () => {
  it('Swift Light 覆盖 allTokenNames() 里的每一个 token', () => {
    const missing = allTokenNames().filter((t) => !swiftLight.has(swiftName(t)));
    expect(missing, `Swift Light 漏了：${missing.join(', ')}`).toEqual([]);
  });

  it('ArkTS 亮色常量覆盖 allTokenNames() 里的每一个 token', () => {
    const missing = allTokenNames().filter((t) => !arkts.has(arktsName(t)));
    expect(missing, `ArkTS 漏了：${missing.join(', ')}`).toEqual([]);
  });

  it('tokens.json 的 light 覆盖 allTokenNames() 里的每一个 token', () => {
    const missing = allTokenNames().filter((t) => !(t in json.light));
    expect(missing, `tokens.json light 漏了：${missing.join(', ')}`).toEqual([]);
  });

  it('tokens.json 是扁平的：light 的 key 恰好等于 token 集，值是 string/number', () => {
    expect(Object.keys(json.light).sort()).toEqual([...allTokenNames()].sort());
    for (const [k, v] of Object.entries(json.light)) {
      expect(['string', 'number'], `${k} 的值类型不是 string/number`).toContain(typeof v);
    }
  });

  it('每个暗色覆盖的 token 都出现在 Dark 段（Swift 与 ArkTS）', () => {
    const darkTokens = bundle.tokens.filter((t) => t.dark !== null).map((t) => t.token);
    expect(darkTokens.length, '暗色覆盖数不应为 0').toBeGreaterThan(0);
    const missingSwift = darkTokens.filter((t) => !swiftDark.has(swiftName(t)));
    const missingArk = darkTokens.filter((t) => !arkts.has(arktsDarkName(t)));
    expect(missingSwift, `Swift Dark 漏了：${missingSwift.join(', ')}`).toEqual([]);
    expect(missingArk, `ArkTS Dark 漏了：${missingArk.join(', ')}`).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. 没有未解析的引用
// ─────────────────────────────────────────────────────────────

describe('没有任何未解析的 CSS 变量引用', () => {
  it('Swift 里没有 var( 也没有 --ht-', () => {
    expect(swiftText).not.toMatch(/var\(/);
    expect(swiftText).not.toMatch(/--ht-/);
  });

  it('ArkTS 里没有 var( 也没有 --ht-', () => {
    expect(arktsText).not.toMatch(/var\(/);
    expect(arktsText).not.toMatch(/--ht-/);
  });

  it('tokens.json 里没有 var( 也没有 --ht-', () => {
    expect(jsonText).not.toMatch(/var\(/);
    expect(jsonText).not.toMatch(/--ht-/);
  });

  it('生成器把所有引用的值都解析成了具体值（含链式引用）', () => {
    // color.primary 在 CSS 里是 var(--ht-blue-600) → #2563eb 的双层引用
    const raw = lightVars.get('--ht-color-primary')!;
    expect(raw).toBe('var(--ht-blue-600)');
    expect(swiftLight.get('colorPrimary')).toBe('#2563eb');
    expect(arkts.get('HEYTA_COLOR_PRIMARY')).toBe('#2563eb');
    expect(json.light['color.primary']).toBe('#2563eb');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Round-trip：产物值 == 从 tokens.css 重新解析的值
// ─────────────────────────────────────────────────────────────

describe('round-trip 相等（产物值 == tokens.css 解析值）', () => {
  it.each(COLOR_TOKENS)('亮色 %s 的 hex 与 CSS 解析值一致', (token) => {
    const expected = normalizeColor(resolvedCss(lightVars, token));
    expect(swiftLight.get(swiftName(token)), `Swift Light.${swiftName(token)}`).toBe(expected);
    expect(arkts.get(arktsName(token)), `ArkTS ${arktsName(token)}`).toBe(expected);
    expect(json.light[token], `JSON light.${token}`).toBe(expected);
  });

  it.each(COLOR_TOKENS)('暗色 %s 的 hex 与 CSS 暗色解析值一致', (token) => {
    const expected = normalizeColor(resolvedCss(darkVars, token));
    expect(swiftDark.get(swiftName(token)), `Swift Dark.${swiftName(token)}`).toBe(expected);
    expect(arkts.get(arktsDarkName(token)), `ArkTS ${arktsDarkName(token)}`).toBe(expected);
    expect(json.dark[token as string], `JSON dark.${token}`).toBe(expected);
  });

  it('半透明色保留 alpha（overlay 不得被当成不透明色）', () => {
    // --ht-color-overlay: rgb(15 23 42 / 0.5) → #0f172a80
    expect(swiftLight.get('colorOverlay')).toBe('#0f172a80');
    expect(arkts.get('HEYTA_COLOR_OVERLAY')).toBe('#0f172a80');
  });

  it('rem 尺寸按 16px 基准换算成原生数值', () => {
    // --ht-space-4: 1rem → 16px；--ht-space-1: 0.25rem → 4px
    expect(swiftLight.get('space4')).toBe('16');
    expect(swiftLight.get('space1')).toBe('4');
    expect(swiftLight.get('space0')).toBe('0');
    expect(arkts.get('HEYTA_SPACE_4')).toBe('16');
    // 非整数 rem 不得带浮点噪声
    expect(swiftLight.get('fontSize' + '2xs')).toBe('11');
  });

  it('时长以毫秒数值导出', () => {
    expect(swiftLight.get('durationFast')).toBe('150');
    expect(arkts.get('HEYTA_DURATION_FAST')).toBe('150');
    expect(json.light['duration.fast']).toBe(150);
  });

  it('无原生数值等价物的 token（65ch）是明示的字符串，而不是被硬凑成数字', () => {
    expect(swiftLight.get('layoutProseMax')).toBe('65ch');
    expect(arkts.get('HEYTA_LAYOUT_PROSE_MAX')).toBe('65ch');
    // 并且文件头必须说明它无法映射
    expect(swiftText).toContain('layout.prose-max');
  });
});

// ─────────────────────────────────────────────────────────────
// 5. 对比度：用产物里的值重算（阈值复用 tokens.spec.ts 的那套）
// ─────────────────────────────────────────────────────────────

function ratio(map: Map<string, string>, nameOf: (t: string) => string, fg: string, bg: string): number {
  const fgVal = map.get(nameOf(fg));
  const bgVal = map.get(nameOf(bg));
  if (fgVal === undefined || bgVal === undefined) {
    throw new Error(`产物里缺少 ${fg} 或 ${bg}（${nameOf(fg)} / ${nameOf(bg)}）`);
  }
  return contrast(parseColor(fgVal), parseColor(bgVal));
}

describe('生成产物的对比度（Swift Light）', () => {
  it.each(AA_PAIRS)('$fg on $bg ≥ $min:1（$why）', ({ fg, bg, min, why }) => {
    const r = ratio(swiftLight, swiftName, fg, bg);
    expect(Number(r.toFixed(2)), `SwiftLight ${fg} on ${bg}（${why}）实测 ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });

  it.each(GRAPHIC_PAIRS)('$fg on $bg ≥ $min:1（$why）', ({ fg, bg, min, why }) => {
    const r = ratio(swiftLight, swiftName, fg, bg);
    expect(Number(r.toFixed(2)), `SwiftLight ${fg} on ${bg}（${why}）实测 ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});

describe('生成产物的对比度（Swift Dark）', () => {
  it.each(AA_PAIRS)('$fg on $bg ≥ $min:1（$why）', ({ fg, bg, min, why }) => {
    const r = ratio(swiftDark, swiftName, fg, bg);
    expect(Number(r.toFixed(2)), `SwiftDark ${fg} on ${bg}（${why}）实测 ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});

describe('生成产物的对比度（ArkTS Light）', () => {
  it.each(AA_PAIRS)('$fg on $bg ≥ $min:1（$why）', ({ fg, bg, min, why }) => {
    const r = ratio(arkts, arktsName, fg, bg);
    expect(Number(r.toFixed(2)), `ArkTS ${fg} on ${bg}（${why}）实测 ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});

describe('生成产物的对比度（ArkTS Dark）', () => {
  it.each(AA_PAIRS)('$fg on $bg ≥ $min:1（$why）', ({ fg, bg, min, why }) => {
    const r = ratio(arkts, arktsDarkName, fg, bg);
    expect(Number(r.toFixed(2)), `ArkTS Dark ${fg} on ${bg}（${why}）实测 ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});

// ─────────────────────────────────────────────────────────────
// 6. 减少动效：不能静默丢弃媒体查询
// ─────────────────────────────────────────────────────────────

describe('prefers-reduced-motion 被显式导出并说明原生替代方式', () => {
  it('五个 duration 在 Swift / ArkTS 里都有 ReducedMotion 覆盖，值为 1ms', () => {
    for (const name of TOKEN_GROUPS.duration) {
      const token = `duration.${name}`;
      expect(swiftReduced.get(swiftName(token)), `Swift ReducedMotion.${swiftName(token)}`).toBe('1');
      expect(arkts.get(arktsReducedMotionName(token)), `ArkTS ${arktsReducedMotionName(token)}`).toBe('1');
      expect(json.reducedMotion[token], `JSON reducedMotion.${token}`).toBe(1);
    }
    expect(swiftReduced.size).toBe(TOKEN_GROUPS.duration.length);
  });

  it('文件头说明了原生平台必须读系统辅助功能设置，而不是忽略该查询', () => {
    expect(swiftText).toContain('accessibilityReduceMotion');
    expect(swiftText).toContain('isReduceMotionEnabled');
    expect(arktsText).toContain('accessibilityReduceMotion');
  });
});

/**
 * ArkTS 产物的**语法**门禁。
 *
 * 为什么需要单独一组：本文件其它断言都是**正则**解析 `.ets` —— 它们能证明
 * "每个 token 都在、值也对得上"，但**证明不了这文件语法合法**。
 * 一个拼错的关键字、少了的引号，正则照样能匹配出值，而 ArkTS 编译器会拒绝整个文件。
 *
 * ⚠️ 这条注释原本写的是「本机没有 ArkTS 编译器」—— **那是错的**。
 * DevEco Studio 装在本机（`/Applications/DevEco-Studio.app`），真正的 ArkTS 编译器
 * `es2abc` 也就在里面，只是不在 PATH 上，所以当时没找到就下了结论。
 * 现在**真正的编译器验证**由 `pnpm check:arkts` 负责（见 check-arkts-compile.mjs）。
 *
 * 这里保留 TypeScript 解析器兜底仍有独立价值：它在 `pnpm test` 里就能跑，
 * 不依赖 DevEco，因此开发机上不必等 `pnpm check` 就能发现产物被写坏。
 * 但**它证明的是"TS 能解析"，不是"ArkTS 能编译"** —— 方言终究是方言。
 *
 * 用 TypeScript 的**真实解析器**兜底：
 * ArkTS 是 TypeScript 的方言，纯常量声明部分的语法是同一套。
 *
 * ⚠️ **这不是 ArkTS 编译通过**。它只覆盖"语法"这一层，而且只对得起
 * "本文件只声明常量"这个前提。真正的 ArkTS 集成（`@ohos` 导入、`Color` 类型、
 * 资源引用）没有被验证过 —— 等鸿蒙端落地时必须补上。
 */
describe('ArkTS 产物语法（TypeScript 解析器兜底）', () => {
  it('HeytaTokens.ets 没有任何语法错误', () => {
    // .ets 当 .ts 解析：ScriptKind.TS
    const sf = ts.createSourceFile('HeytaTokens.ts', arktsText, ts.ScriptTarget.Latest, true);

    // `parseDiagnostics` 是 TypeScript 的内部字段，公开 `.d.ts` 里没有它，
    // 所以这里显式收窄类型。用它是**故意的**：我们要的正是"解析器自己是否报错"，
    // 而不是 `ts.transpileModule` 那种把语法错误吞掉的宽松路径。
    const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
    const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    expect(messages, `ArkTS 产物有语法错误：\n${messages.join('\n')}`).toEqual([]);
  });

  it('确实解析出了预期数量的变量声明（防止"零错误"是因为压根没解析）', () => {
    const sf = ts.createSourceFile('HeytaTokens.ts', arktsText, ts.ScriptTarget.Latest, true);

    let decls = 0;
    const walk = (node: ts.Node): void => {
      if (ts.isVariableStatement(node)) decls += node.declarationList.declarations.length;
      ts.forEachChild(node, walk);
    };
    walk(sf);

    // 亮色 + 暗色 + 减少动效，三者之和。写死下限而不是精确值：
    // 精确值会在**故意**加 token 时无谓地报红，而下限仍能抓住"解析不出东西"。
    expect(decls).toBeGreaterThan(150);
  });
});
