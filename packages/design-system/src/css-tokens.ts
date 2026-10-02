/**
 * tokens.css 解析与 WCAG 对比度工具
 * ==================================
 *
 * 这些函数原本内联在 `tests/tokens.spec.ts` 里。抽出来的唯一理由：
 * **解析逻辑只能有一份。**
 *
 * 生成器（`src/generate.ts`）必须解析**同一份** tokens.css，才能保证
 * 生成的 Swift / ArkTS 值与测试断言的 CSS 值一致。如果生成器自己再写一套
 * 解析器，两套实现迟早对同一份输入给出不同结果 —— 而那种漂移不会让
 * 任何一方报错，只会让产物悄悄偏掉。这正是 AGENTS.md §5 要防的东西。
 *
 * 契约测试（tests/tokens.spec.ts）也直接复用这里的对比度计算，
 * 不重写公式：WCAG 公式写错两次的概率不为零，写错一次就够了。
 */

import { cssVarName } from './tokens.js';

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
export function topLevelBlocks(css: string): Array<[string, string]> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<[string, string]> = [];
  let depth = 0;
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
  }
  return out;
}

/** 从一段块体里抽取所有 `--ht-*: value;` 声明。 */
function varsIn(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [, name, value] of body.matchAll(
    /(--ht-[\w-]+)\s*:\s*([^;]+);/g,
  )) {
    if (name && value) out.push([name, value.trim()]);
  }
  return out;
}

/**
 * 抽取变量。
 *
 * ⚠️ 主题必须**基于基准合并**，不能独立抽取。
 * 原因：暗色块只覆盖语义变量，它引用的原始色阶（--ht-blue-400 等）仍然定义在
 * 亮色的 :root 里。只读暗色块的话，resolveVar 会一路走到 --ht-blue-400 就找不到，
 * 报「引用了未定义的 token」—— 这是**实现问题，不是 CSS 的问题**。
 *
 * @param theme 传入 `'dark'` 时，返回"基准 + 暗色覆盖"的合并结果。
 */
export function extractVars(css: string, theme?: string): Map<string, string> {
  const out = new Map<string, string>();

  // 第一遍：基准 :root
  for (const [selector, body] of topLevelBlocks(css)) {
    if (selector !== ':root') continue;
    for (const [name, value] of varsIn(body)) out.set(name, value);
  }

  // 第二遍：主题覆盖（叠在基准之上）
  if (theme !== undefined) {
    for (const [selector, body] of topLevelBlocks(css)) {
      if (selector !== `[data-theme='${theme}']`) continue;
      for (const [name, value] of varsIn(body)) out.set(name, value);
    }
  }

  return out;
}

/**
 * 只抽取某个主题块**显式写出**的变量（不合并基准）。
 *
 * 与 extractVars(css, theme) 的区别：
 *   - extractVars(css, 'dark')   → 基准 + 覆盖的**合并**结果，用于展开引用
 *   - extractThemeVars(css,'dark') → 仅 `[data-theme='dark']` 里写出的那些
 *
 * 生成器两个都需要：用合并表解析值，用这个判断某个 token 是否真的
 * 需要进 `Dark` 段。拿合并表去判断的话，**每个** token 都会被判成有覆盖。
 */
export function extractThemeVars(css: string, theme: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [selector, body] of topLevelBlocks(css)) {
    if (selector !== `[data-theme='${theme}']`) continue;
    for (const [name, value] of varsIn(body)) out.set(name, value);
  }
  return out;
}

/**
 * 抽取 `@media (prefers-reduced-motion: reduce)` 块里的 `:root` 覆盖。
 *
 * 生成器会把它单独导出一段（ReducedMotion），**不静默丢弃**：
 * 原生平台没有 CSS 媒体查询，必须在运行时读取系统的"减少动效"设置。
 */
export function extractReducedMotion(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [selector, body] of topLevelBlocks(css)) {
    if (!selector.includes('prefers-reduced-motion')) continue;
    for (const [innerSelector, innerBody] of topLevelBlocks(body)) {
      if (innerSelector !== ':root') continue;
      for (const [name, value] of varsIn(innerBody)) out.set(name, value);
    }
  }
  return out;
}

/**
 * 抽取 `@media (prefers-reduced-transparency: reduce)` 块里的 `:root` 覆盖。
 *
 * 与 reducedMotion 同款理由（ADR-0042 §4：材质要能退让）：CSS 驱动的表面
 * 由这条媒体查询直接压值；**RN 侧的 token 表看不见 CSS 媒体查询**，生成器
 * 把这一块导出成 per-theme 覆盖层，由共享层在 web 上用 `matchMedia` 检测后
 * 合并（原生端无此系统偏好可查，保持不动）。
 *
 * ⚠️ 值大多是 `var(--ht-color-surface)` 这类**随主题变**的引用 —— 解析时
 * 必须分别对亮/暗两张表展开，这也是它导出成两份 partial 的原因。
 */
export function extractReducedTransparency(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [selector, body] of topLevelBlocks(css)) {
    if (!selector.includes('prefers-reduced-transparency')) continue;
    for (const [innerSelector, innerBody] of topLevelBlocks(body)) {
      if (innerSelector !== ':root') continue;
      for (const [name, value] of varsIn(innerBody)) out.set(name, value);
    }
  }
  return out;
}

/**
 * 把值里的 var(--x) 递归展开成原始值。
 *
 * 必须递归：语义层引用原始色阶（--ht-color-primary → var(--ht-blue-600) → #2563eb），
 * 只展开一层的话拿到的是 `var(--ht-blue-600)`，没法算对比度。
 *
 * 只处理"整个值就是一个 var()"的形状。混在其它文本里的 var() 用
 * resolveAllVars（生成器需要，因为要保证产物里一个 var( 都不剩）。
 */
export function resolveVar(
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

/**
 * 展开值中**任意位置**的所有 `var(--x)`（可嵌套）。
 *
 * 生成器的用途：产物必须是具体值，一个 `var(` 都不能残留。
 * 当前 tokens.css 里所有引用恰好都是"整个值就是一个 var()"，
 * 但把生成器建立在那个巧合上很脆弱 —— 将来有人写
 * `--ht-shadow-focus: 0 0 0 3px var(--ht-color-ring)`，只支持整值的实现
 * 会把 `var(--ht-color-ring)` 原样写进 Swift，而 Swift 会静默用错颜色。
 */
export function resolveAllVars(
  value: string,
  vars: Map<string, string>,
  depth = 0,
): string {
  if (depth > 20) throw new Error(`var() 展开过深，可能存在循环引用：${value}`);
  if (!value.includes('var(')) return value;

  const replaced = value.replace(/var\((--ht-[\w-]+)\)/g, (_m, name: string) => {
    const next = vars.get(name);
    if (next === undefined) {
      throw new Error(`引用了未定义的 token：${name}`);
    }
    return resolveAllVars(next, vars, depth + 1);
  });
  // 一轮替换可能暴露出新的 var()（被引用值自身含引用），循环到稳定
  return replaced === value ? replaced : resolveAllVars(replaced, vars, depth + 1);
}

/** 把颜色字面量转成 [r,g,b]（0-255）。支持 hex、rgb()/rgba() 两种写法。 */
export function parseColor(input: string): [number, number, number] {
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
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrast(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 取某个 token 的可计算颜色（已展开 var()，已丢弃 alpha）。
 *
 * alpha 被丢弃是**故意的**：DEVICE 对比度定义里前景/背景都是不透明色块，
 * AA/GRAPHIC 配对里也没有半透明 token（overlay 被显式排除）。
 */
export function colorOf(
  token: string,
  vars: Map<string, string>,
): [number, number, number] {
  const name = cssVarName(token as never);
  const raw = vars.get(name);
  if (raw === undefined) throw new Error(`tokens.css 缺少 ${name}`);
  return parseColor(resolveVar(raw, vars));
}

/**
 * 把任意 CSS 颜色（hex / rgb() / rgba()）归一成原生可用的 hex 字面量。
 *
 * 为什么需要：Swift / ArkTS 都不认 CSS 的 `rgb(15 23 42 / 0.5)` 语法。
 * 生成器必须把它转成两端都能直接构造颜色对象的写法。
 * 选择 `#rrggbb` / `#rrggbbaa`，因为它是两种语言唯一**语义完全相同**的
 * 颜色字面量形状。
 *
 * 产物小写，保证字符串比较稳定（`#2563EB` 与 `#2563eb` 是同一个颜色，
 * 但会让 round-trip 断言变成假失败）。
 */
export function normalizeColor(input: string): string {
  const v = input.trim();
  const hex = v.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hex) {
    let h = hex[1]!.toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 6) return `#${h}`;
    if (h.length === 8) {
      // alpha 全不透明时降成 6 位，避免同一颜色出现两种写法
      return h.endsWith('ff') ? `#${h.slice(0, 6)}` : `#${h}`;
    }
    throw new Error(`无法解析颜色：${input}`);
  }

  const m = v.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/,
  );
  if (!m) throw new Error(`无法解析颜色：${input}`);

  const toByte = (n: number) => {
    const c = Math.max(0, Math.min(255, Math.round(n)));
    return c.toString(16).padStart(2, '0');
  };
  const rgb = `${toByte(Number(m[1]))}${toByte(Number(m[2]))}${toByte(Number(m[3]))}`;

  const alphaRaw = m[4];
  if (alphaRaw === undefined) return `#${rgb}`;
  const alpha = alphaRaw.endsWith('%')
    ? Number(alphaRaw.slice(0, -1)) / 100
    : Number(alphaRaw);
  if (!Number.isFinite(alpha) || alpha >= 1) return `#${rgb}`;
  return `#${rgb}${toByte(alpha * 255)}`;
}
