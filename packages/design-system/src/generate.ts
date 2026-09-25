/**
 * 设计 token 生成器
 * =================
 *
 * 把 **唯一事实源** `src/tokens.css` 解析后导出为原生平台常量：
 *
 *   - `generated/HeytaTokens.swift`  iOS / SwiftUI
 *   - `generated/HeytaTokens.ets`    HarmonyOS / ArkUI (ArkTS)
 *   - `generated/tokens.json`        React Native 等 JS 运行时
 *
 * 依据 ADR-0003 §2.4：「值只在 tokens.css 定义一次，其余平台由它**生成**。
 * 不许各端各写一份色值 —— 那就是漂移的开始。」
 *
 * 设计原则：
 *   1. **解析，不复制。** 生成器不存放任何色值/尺寸，全部来自 tokens.css。
 *   2. **展开 var()。** 产物必须是具体值：Swift 拿到 `var(--ht-blue-600)`
 *      不会报错，只会静默变成透明/默认色。
 *   3. **亮暗两套都出。** SwiftUI / ArkUI 没有 `[data-theme]`，必须在运行时
 *      按主题选 `Light` 或 `Dark` 常量。
 *   4. **无等价物的 token 明说。** 字体栈 / box-shadow / cubic-bezier 在两端
 *      没有同名概念，生成器原样导出并在文件头列出，绝不假装映射成功。
 *
 * ⚠️ 解析与对比度公式在 `src/css-tokens.ts`，与契约测试共用同一份实现。
 * 生成器**不得**另写一套解析器 —— 两套实现对同一份 CSS 会给出不同结果，
 * 而那种漂移两边都不会报错。
 */

import {
  extractReducedMotion,
  extractThemeVars,
  extractVars,
  normalizeColor,
  resolveAllVars,
} from './css-tokens.js';
import { allTokenNames, cssVarName } from './tokens.js';
import type { TokenName } from './tokens.js';

// ─────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────

export type NativeKind = 'color' | 'number' | 'string';

/** 一个 token 在原生侧的完整形态。 */
export interface NativeToken {
  /** registry 名，形如 `color.primary`（也是 JSON 的 key）。 */
  token: TokenName;
  /** CSS 变量名，形如 `--ht-color-primary`。 */
  cssName: string;
  /** 分组名（token 的第一段）。 */
  group: string;
  kind: NativeKind;
  /** 数值 token 的单位，仅用于生成注释。 */
  unit?: 'px' | 'ms';
  /** 亮色主题下的值（颜色为 hex 字符串，数值为 number）。 */
  light: string | number;
  /** 暗色主题下被显式覆盖的值；未覆盖为 null（消费方回退 Light）。 */
  dark: string | number | null;
  /** `prefers-reduced-motion` 下的覆盖值（毫秒）；无覆盖为 null。 */
  reducedMotion: number | null;
  /** 无法忠实映射到原生概念时的说明。 */
  note?: string;
}

export interface GeneratedBundle {
  swift: string;
  arkts: string;
  json: string;
  tokens: NativeToken[];
}

// ─────────────────────────────────────────────────────────────
// 值转换
// ─────────────────────────────────────────────────────────────

/** 把 CSS 值里的换行/多空格压成单空格，保证产物字符串稳定。 */
function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * 分组 → 原生大类。
 *
 * 这里按**语义**判断，而不是按值的形状：同一个 `1`，
 * 在 `space.1` 是 4px，在 `z.base` 是无单位层级。
 * 混为一谈会让 Swift 端拿到 4 层级的 z-index。
 */
const GROUP_KIND: Readonly<Record<string, NativeKind>> = {
  color: 'color',
  space: 'number',
  'font-size': 'number',
  radius: 'number',
  icon: 'number',
  'touch-target': 'number',
  'focus-ring': 'number',
  'border-width': 'number',
  layout: 'number',
  duration: 'number',
  z: 'number',
  'line-height': 'number',
  'font-weight': 'number',
  ease: 'string',
  shadow: 'string',
  font: 'string',
};

/** 以 px 为单位的长度的分组（rem 会按 16px 基准换算）。 */
const LENGTH_GROUPS = new Set([
  'space',
  'font-size',
  'radius',
  'icon',
  'touch-target',
  'focus-ring',
  'border-width',
  'layout',
]);

const NOTES: Readonly<Record<string, string>> = {
  font: 'CSS 字体栈不是原生端的字体选择方式；原样导出仅作参考，请配置等价系统字体（iOS: SF Pro / PingFang SC，HarmonyOS: HarmonyOS Sans）。',
  ease: 'cubic-bezier 是 CSS 时序函数，SwiftUI / ArkUI 没有同名类型；已导出控制点，需各端自行映射为动画曲线。',
  shadow: 'box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。',
};

interface Converted {
  kind: NativeKind;
  value: string | number;
  unit?: 'px' | 'ms';
  note?: string;
}

function convertValue(group: string, resolved: string): Converted {
  const kind = GROUP_KIND[group];
  if (kind === undefined) {
    throw new Error(`未知 token 分组：${group}（请在 generate.ts 的 GROUP_KIND 登记）`);
  }

  if (kind === 'color') {
    return { kind, value: normalizeColor(resolved) };
  }

  if (group === 'duration') {
    const m = resolved.match(/^([\d.]+)ms$/);
    if (!m) throw new Error(`duration token 期望 ms 值，实际：${resolved}`);
    return { kind: 'number', value: Number(m[1]), unit: 'ms' };
  }

  if (LENGTH_GROUPS.has(group)) {
    if (resolved === '0') return { kind: 'number', value: 0, unit: 'px' };
    const px = resolved.match(/^([\d.]+)px$/);
    if (px) return { kind: 'number', value: Number(px[1]), unit: 'px' };
    const rem = resolved.match(/^([\d.]+)rem$/);
    if (rem) return { kind: 'number', value: Number((Number(rem[1]) * 16).toFixed(4)), unit: 'px' };
    // ch / em 这类相对单位依赖当前字号，没有忠实的原生数值等价物
    return {
      kind: 'string',
      value: resolved,
      note: '相对单位依赖当前字号，无法换算为原生数值常量；已原样导出为字符串。',
    };
  }

  if (kind === 'number') {
    const n = Number(resolved);
    if (!Number.isFinite(n)) throw new Error(`数值 token 无法解析：${resolved}`);
    return { kind: 'number', value: n };
  }

  // 字符串类（font / ease / shadow）
  return { kind: 'string', value: resolved, note: NOTES[group] };
}

// ─────────────────────────────────────────────────────────────
// 解析 → 原生 token 列表
// ─────────────────────────────────────────────────────────────

export interface ParsedThemes {
  light: Map<string, string>;
  dark: Map<string, string>;
  darkOverrides: Map<string, string>;
  reducedMotion: Map<string, string>;
}

/**
 * 解析 tokens.css 成三套变量表。
 *
 * `dark` 是「基准 + 暗色覆盖」的合并结果，用于**展开引用**
 * （暗色块引用 --ht-blue-400 等原始色阶，那些只定义在基准 :root）。
 * `darkOverrides` 只含暗色块**显式写出的** token，用于判断某个 token
 * 是否真的需要进 Dark 段。两者不能混用：
 * 用合并表判断「有没有被覆盖」会把所有 token 都算成有覆盖。
 */
export function parseTokensCss(css: string): ParsedThemes {
  return {
    light: extractVars(css),
    dark: extractVars(css, 'dark'),
    darkOverrides: extractThemeVars(css, 'dark'),
    reducedMotion: extractReducedMotion(css),
  };
}

/** 解析 + 转换，得到全部原生 token。 */
export function buildNativeTokens(css: string): NativeToken[] {
  const { light, dark, darkOverrides, reducedMotion } = parseTokensCss(css);
  const out: NativeToken[] = [];

  for (const token of allTokenNames()) {
    const cssName = cssVarName(token);
    const rawLight = light.get(cssName);
    if (rawLight === undefined) {
      throw new Error(`tokens.css 缺少 ${cssName}（registry 与 CSS 不同步）`);
    }

    const group = token.slice(0, token.indexOf('.'));
    const resolvedLight = collapse(resolveAllVars(rawLight, light));
    const converted = convertValue(group, resolvedLight);

    let darkValue: string | number | null = null;
    if (darkOverrides.has(cssName)) {
      const rawDark = dark.get(cssName)!;
      const resolvedDark = collapse(resolveAllVars(rawDark, dark));
      darkValue = convertValue(group, resolvedDark).value;
    }

    let reducedMotionValue: number | null = null;
    if (reducedMotion.has(cssName)) {
      const resolved = collapse(resolveAllVars(reducedMotion.get(cssName)!, light));
      const m = resolved.match(/^([\d.]+)ms$/);
      if (!m) {
        throw new Error(`prefers-reduced-motion 里的 ${cssName} 期望 ms 值，实际：${resolved}`);
      }
      reducedMotionValue = Number(m[1]);
    }

    out.push({
      token,
      cssName,
      group,
      kind: converted.kind,
      unit: converted.unit,
      light: converted.value,
      dark: darkValue,
      reducedMotion: reducedMotionValue,
      note: converted.note,
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────
// 命名约定
// ─────────────────────────────────────────────────────────────

function segments(name: string): string[] {
  return name.split(/[.-]/);
}

/**
 * Swift 常量名：`color.primary` → `colorPrimary`，`font-size.2xs` → `fontSize2xs`。
 *
 * 选**扁平 camelCase**（`HeytaTokens.Light.colorPrimary`）而不是按组嵌套
 * （`HeytaTokens.Light.Color.primary`）：分组名 `color` 会与 SwiftUI 的
 * `Color` 类型同名，在泛型/阴影上下文里容易产生歧义；扁平名没有这个风险，
 * 而且测试可以直接用 `swiftName(token)` 做双向映射。
 */
export function swiftName(token: string): string {
  return segments(token)
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
}

/** ArkTS 亮色常量名：`color.primary` → `HEYTA_COLOR_PRIMARY`。 */
export function arktsName(token: string): string {
  return `HEYTA_${segments(token).map((p) => p.toUpperCase()).join('_')}`;
}

/** ArkTS 暗色常量名（亮暗各一套，必须能共存于同一模块）。 */
export function arktsDarkName(token: string): string {
  return `HEYTA_DARK_${segments(token).map((p) => p.toUpperCase()).join('_')}`;
}

/** ArkTS 减少动效常量名。 */
export function arktsReducedMotionName(token: string): string {
  return `HEYTA_REDUCED_MOTION_${segments(token).map((p) => p.toUpperCase()).join('_')}`;
}

/** 确保生成的标识符唯一（重名会静默覆盖，是最难查的一类生成器 bug）。 */
export function assertUniqueNames(tokens: readonly NativeToken[]): void {
  const seen = new Map<string, string>();
  for (const t of tokens) {
    for (const key of [
      swiftName(t.token),
      arktsName(t.token),
      arktsDarkName(t.token),
      arktsReducedMotionName(t.token),
    ]) {
      const prev = seen.get(key);
      if (prev !== undefined) {
        throw new Error(`生成的标识符冲突：${prev} 与 ${t.token} 都映射到 ${key}`);
      }
      seen.set(key, t.token);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 字面量格式化
// ─────────────────────────────────────────────────────────────

/** 数字 → 稳定的字面量（去掉浮点噪声，整数不带 `.0`）。 */
function numberLiteral(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

function swiftStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function arktsStringLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

// ─────────────────────────────────────────────────────────────
// 文件头
// ─────────────────────────────────────────────────────────────

function unmappableNotes(tokens: readonly NativeToken[]): Array<[string, string]> {
  // 按 token 逐条列出，**不按说明文字去重** —— 去重会漏掉同组的第二、三个
  // token（font.sans 与 font.mono 说明相同，只列 sans 会让人以为 mono 已映射）。
  return tokens.filter((t) => t.note).map((t) => [t.token, t.note!]);
}

function commonHeader(prefix: string, tokens: readonly NativeToken[]): string[] {
  const notes = unmappableNotes(tokens);
  const L = (s: string) => `${prefix} ${s}`.trimEnd();
  const lines = [
    `${prefix} ────────────────────────────────────────────────────────────`,
    L('HeytaTokens — heyta 设计系统原生常量'),
    L(''),
    L('⚠️ 本文件由生成器产出，请勿手动编辑。'),
    L('   唯一事实源：packages/design-system/src/tokens.css'),
    L('   重新生成：pnpm --filter @heyta/design-system run generate'),
    L(''),
    L('从 tokens.css 解析并**展开**所有 CSS 变量引用：产物里没有悬空引用，'),
    L('全部是可直接使用的具体值。手改本文件会在下次生成时被覆盖，'),
    L('而且会绕过 tokens.css 的对比度测试（AGENTS.md §5）。'),
    L(''),
    L('主题：Light 是完整集合；Dark 只含 tokens.css 里 [data-theme=\'dark\']'),
    L('      显式覆盖的 token，其余请在运行时回退到 Light。'),
    L(''),
    L('减少动效：tokens.css 的 @media (prefers-reduced-motion: reduce) 单独导出为'),
    L('      ReducedMotion（时长压到 1ms）。CSS 媒体查询在原生不存在 ——'),
    L('      **两端都必须在运行时读取系统辅助功能设置**并在开启时用'),
    L('      ReducedMotion 覆盖 Light 的 duration 常量，而不是忽略 Media Query。'),
    L('      iOS/SwiftUI: @Environment(\\.accessibilityReduceMotion)'),
    L('      HarmonyOS:   accessibility.isReduceMotionEnabled（或等价设置项）'),
  ];

  if (notes.length > 0) {
    lines.push(
      L(''),
      L('以下 token 没有忠实的原生等价物，已原样导出为字符串：'),
    );
    for (const [token, note] of notes) {
      lines.push(L(`  - ${token}: ${note}`));
    }
  }

  lines.push(`${prefix} ────────────────────────────────────────────────────────────`);
  return lines;
}

// ─────────────────────────────────────────────────────────────
// Swift 发射
// ─────────────────────────────────────────────────────────────

function swiftEntry(t: NativeToken, value: string | number): string {
  const isString = t.kind === 'string' || t.kind === 'color';
  const type = isString ? 'String' : 'Double';
  const literal = isString
    ? swiftStringLiteral(value as string)
    : numberLiteral(value as number);
  const suffix = t.unit ? `  // ${t.unit}` : '';
  return `    static let ${swiftName(t.token)}: ${type} = ${literal}${suffix}`;
}

export function toSwift(tokens: readonly NativeToken[]): string {
  assertUniqueNames(tokens);
  const lines: string[] = [`// HeytaTokens.swift`, ...commonHeader('//', tokens), ''];

  lines.push('enum HeytaTokens {');
  lines.push('  // SECTION: Light');
  lines.push('  enum Light {');
  for (const t of tokens) lines.push(swiftEntry(t, t.light));
  lines.push('  }');

  const dark = tokens.filter((t) => t.dark !== null);
  lines.push('');
  lines.push('  // SECTION: Dark');
  lines.push('  enum Dark {');
  for (const t of dark) lines.push(swiftEntry(t, t.dark!));
  lines.push('  }');

  const rm = tokens.filter((t) => t.reducedMotion !== null);
  lines.push('');
  lines.push('  // SECTION: ReducedMotion');
  lines.push('  enum ReducedMotion {');
  for (const t of rm) {
    lines.push(`    static let ${swiftName(t.token)}: Double = ${numberLiteral(t.reducedMotion!)}  // ms`);
  }
  lines.push('  }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// ArkTS 发射
// ─────────────────────────────────────────────────────────────

function arktsEntry(
  name: string,
  t: NativeToken,
  value: string | number,
  suffix = '',
): string {
  const isString = t.kind === 'string' || t.kind === 'color';
  const type = isString ? 'string' : 'number';
  const literal = isString
    ? arktsStringLiteral(value as string)
    : numberLiteral(value as number);
  return `export const ${name}: ${type} = ${literal};${suffix}`;
}

export function toArkTS(tokens: readonly NativeToken[]): string {
  assertUniqueNames(tokens);
  const lines: string[] = [...commonHeader('//', tokens), ''];

  lines.push('// SECTION: Light');
  for (const t of tokens) {
    lines.push(arktsEntry(arktsName(t.token), t, t.light, t.unit ? `  // ${t.unit}` : ''));
  }

  const dark = tokens.filter((t) => t.dark !== null);
  lines.push('');
  lines.push('// SECTION: Dark');
  for (const t of dark) {
    lines.push(arktsEntry(arktsDarkName(t.token), t, t.dark!));
  }

  const rm = tokens.filter((t) => t.reducedMotion !== null);
  lines.push('');
  lines.push('// SECTION: ReducedMotion');
  lines.push('// 需在系统开启「减少动效」时覆盖 Light 的 duration 常量。');
  for (const t of rm) {
    lines.push(
      arktsEntry(arktsReducedMotionName(t.token), t, t.reducedMotion!, '  // ms'),
    );
  }
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// JSON 发射
// ─────────────────────────────────────────────────────────────

export function toJson(tokens: readonly NativeToken[]): string {
  assertUniqueNames(tokens);
  const light: Record<string, string | number> = {};
  const dark: Record<string, string | number> = {};
  const reducedMotion: Record<string, number> = {};

  for (const t of tokens) {
    light[t.token] = t.light;
    if (t.dark !== null) dark[t.token] = t.dark;
    if (t.reducedMotion !== null) reducedMotion[t.token] = t.reducedMotion;
  }

  return `${JSON.stringify({ light, dark, reducedMotion }, null, 2)}\n`;
}

// ─────────────────────────────────────────────────────────────
// 入口
// ─────────────────────────────────────────────────────────────

export function generateAll(css: string): GeneratedBundle {
  const tokens = buildNativeTokens(css);
  return {
    swift: toSwift(tokens),
    arkts: toArkTS(tokens),
    json: toJson(tokens),
    tokens,
  };
}
