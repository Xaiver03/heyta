/**
 * CSS → React Native 的值归一化层
 * =================================
 *
 * 🔴 为什么必须有这一层
 *
 * `tokens.css` 是**唯一事实源**，生成器把它的值原样搬进 `tokens.native.ts`。
 * 这保证了四端同源 —— 但也意味着**表里有一部分值只在 CSS 里合法**：
 *
 * | token | tokens.css 里的值 | React Native |
 * |---|---|---|
 * | `font.sans` | `'Plus Jakarta Sans', -apple-system, …, sans-serif` | ❌ 只接受**单个**字体名 |
 * | `shadow.md` | `0 2px 8px rgb(15 23 42 / 0.08)` | ❌ 要 `{shadowColor,shadowOffset,…}` |
 * | `ease.standard` | `cubic-bezier(0.2, 0, 0.2, 1)` | ❌ 要数值控制点 |
 *
 * 实测后果（真机，小米 Android 16）：把整个字体栈当 `fontFamily` 传进去，
 * **不报错**，只是字体解析失败 —— 屏幕上是**条纹状的乱码文字**。
 * 这类"不报错但画错"的问题，靠读代码是发现不了的。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 这里是**纯函数，不 import React Native**
 *
 * 两个理由：
 * 1. 它必须能在 Node 里跑测试 —— 值解析的正确性不该靠真机截图来验。
 * 2. 它同时服务 iOS / Android / 鸿蒙三个 RN 宿主。放进任何 `apps/*` 都是
 *    把共享逻辑拷三份（ADR-0003 §2.1 / AGENTS.md §3.5）。
 *
 * 返回值刻意用**中性结构**（元组、普通对象），由各宿主自己映射到
 * `Easing.bezier(...)` 这类平台 API —— 这样这一层不绑定任何 RN 版本。
 */

/** RN 的阴影结构（iOS 用前四个，Android 用 elevation）。 */
export interface RnShadow {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowRadius: number;
  shadowOpacity: number;
  /** Android 专用。由 blur 半径粗略换算。 */
  elevation: number;
}

/** `cubic-bezier` 的四个控制点。宿主自己交给 `Easing.bezier(...)`。 */
export type CubicBezier = readonly [number, number, number, number];

/**
 * 从 CSS 字体栈里取出 RN 可用的字体名。
 *
 * 🔴 **不是**取第一项就完事。CSS 栈里的泛型族
 * （`sans-serif` / `system-ui` / `-apple-system` / `BlinkMacSystemFont` / `monospace`）
 * **不是字体名**，把它们当 `fontFamily` 传给 RN 同样会解析失败 —— 只是这次
 * 失败得没那么显眼。真正的字体名只有两种来源：
 *
 * 1. **平台内置字体**（`PingFang SC` / `Hiragino Sans GB` / `Microsoft YaHei`），
 *    只在对应平台上存在，别处传了就是无效；
 * 2. **应用自带字体**（`Plus Jakarta Sans` / `JetBrains Mono`），
 *    必须真的打进包里才可用。
 *
 * 所以这个函数**只返回第一项**，而且必须调用方确认它已经被打包。
 * 拿不准就返回 `undefined` —— RN 拿 `undefined` 会用系统字体，
 * 这是**永远安全**的默认，而系统字体在 iOS/Android 上对中文的支持本来就好。
 *
 * @param packagedFamilies 应用**实际打包进去了**的字体名。没登记的字体不会被选中。
 */
/**
 * CSS 的**泛型字体族**。这些不是字体名，任何平台上都不能当 `fontFamily` 用。
 *
 * 🔴 必须**无条件**拒绝，不能因为调用方把它写进了打包清单就放行 ——
 * 早期版本就是这么错的：`resolveFontFamily('sans-serif', ['sans-serif'])`
 * 返回了 `'sans-serif'`，而 RN 拿到它同样解析不出字体。
 */
const GENERIC_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  '-apple-system',
  'blinkmacsystemfont',
  'inherit',
  'initial',
  'unset',
]);

export function resolveFontFamily(
  cssStack: string,
  packagedFamilies: readonly string[] = [],
): string | undefined {
  const first = cssStack.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
  if (first === '') return undefined;
  if (GENERIC_FAMILIES.has(first.toLowerCase())) return undefined;
  return packagedFamilies.includes(first) ? first : undefined;
}

/** 解析 `rgb(r g b / a)` 与 `rgb(r, g, b)`、`#rrggbb`。返回 `#rrggbb` 与 alpha。 */
export function parseCssColor(value: string): { hex: string; alpha: number } | null {
  const trimmed = value.trim();

  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(trimmed);
  if (hex) {
    return { hex: `#${hex[1]!.toLowerCase()}`, alpha: hex[2] ? parseInt(hex[2], 16) / 255 : 1 };
  }

  // ⚠️ 数字要允许**负号**：`rgb(300 -5 42)` 在 CSS 里合法（会被夹紧到 0）。
  // 早期版本写成 `[\d.]+`，负号直接让整个匹配失败 → 返回 null → 静默丢色。
  const rgb = /^rgba?\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)(?:\s*[/,]\s*(-?[\d.]+%?))?\s*\)$/i.exec(
    trimmed,
  );
  if (!rgb) return null;

  const part = (s: string): number => Math.max(0, Math.min(255, Math.round(Number(s))));
  const [r, g, b] = [part(rgb[1]!), part(rgb[2]!), part(rgb[3]!)];
  let alpha = 1;
  if (rgb[4] !== undefined) {
    alpha = rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
  }
  const to2 = (n: number): string => n.toString(16).padStart(2, '0');
  return { hex: `#${to2(r)}${to2(g)}${to2(b)}`, alpha };
}

/**
 * 解析 CSS `box-shadow` 的**单层**形式：`<x> <y> <blur> [spread]? <color>`。
 *
 * ⚠️ 只支持单层。`tokens.css` 里全是单层，所以够用；遇到多层直接返回 `null`，
 * **不猜** —— 猜错的阴影会被当成"设计如此"而长期留着。
 */
export function parseCssShadow(value: string): RnShadow | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'none') return null;

  // 颜色可能在开头或结尾，先摘出来。
  const colorMatch =
    /(rgb[a]?\([^)]*\)|#[0-9a-f]{3,8})\s*$/i.exec(trimmed) ??
    /^(rgb[a]?\([^)]*\)|#[0-9a-f]{3,8})\s*/i.exec(trimmed);
  if (!colorMatch) return null;

  const color = parseCssColor(colorMatch[1]!);
  if (color === null) return null;

  const rest = trimmed.replace(colorMatch[0], ' ').trim();
  const nums = rest.split(/\s+/).filter((s) => s !== '');
  // 需要 x / y / blur 三个长度；spread 可选。
  if (nums.length < 3) return null;

  // ⚠️ CSS 允许**无单位的 0**：`0 0 0 3px rgb(...)` 是合法的 box-shadow
  // （`shadow.focus` 就是长这样）。早期版本要求三个长度都带 `px` 后缀，
  // 于是所有 shadow token 都解析成 null。
  const px = (s: string): number | null => {
    if (s === '0' || s === '-0') return 0;
    const m = /^(-?[\d.]+)px$/.exec(s);
    return m ? Number(m[1]) : null;
  };
  const [x, y, blur] = [px(nums[0]!), px(nums[1]!), px(nums[2]!)];
  if (x === null || y === null || blur === null) return null;
  if (nums.length >= 4 && px(nums[3]!) === null) return null;

  return {
    shadowColor: color.hex,
    shadowOffset: { width: x, height: y },
    shadowRadius: blur,
    shadowOpacity: color.alpha,
    // Android 的 elevation 没有模糊半径的概念，用一个粗略但单调的换算：
    // 保证"更大的阴影 token → 更大的 elevation"，不做视觉等价承诺。
    elevation: Math.max(0, Math.round((y + blur) / 2)),
  };
}

/**
 * 解析 `cubic-bezier(a, b, c, d)` → 四个控制点。
 *
 * 非 `cubic-bezier` 的写法（`linear` / `ease-in` / `steps(...)`）返回 `null`：
 * 那些需要宿主自己映射，硬编码一个等价曲线会**悄悄改掉设计意图**。
 */
export function parseCubicBezier(value: string): CubicBezier | null {
  const m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/i.exec(
    value.trim(),
  );
  if (!m) return null;
  const nums = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

/**
 * `duration.*` 不需要解析 —— 生成器已经把 CSS 时长转成了**毫秒数字**
 * （`duration.fast` 就是 `150`，不是 `'150ms'`）。
 * 这里保留一个显式断言，是为了在生成器将来改回字符串时**立刻红**，
 * 而不是让某个调用方静默拿到一个字符串当数字用。
 */
export function assertDurationMs(value: number | string, tokenName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(
      `${tokenName} 期望毫秒数字，实际拿到 ${typeof value}（${String(value)}）。` +
        `duration.* 由生成器转成数字，若这里变了说明生成器改了输出格式。`,
    );
  }
  return value;
}

/**
 * 把 `line-height.*`（**倍数**）换算成 RN 需要的**绝对行高**。
 *
 * 🔴 这是个真会画错的坑：CSS 的 `line-height: 1.5` 是相对于字号的无单位倍数，
 * 而 RN 的 `lineHeight` 是**点数**。把 1.5 直接传给 RN 不是"行距紧一点"，
 * 而是**行高塌成 1.5pt**，文字会被裁掉或挤成一团 —— 而且不报任何错。
 *
 * 之所以不在生成器里就乘好：字号与行高是两个独立 token，只有消费时才配得起来。
 */
export function resolveLineHeight(multiplier: number, fontSize: number): number {
  return Math.round(multiplier * fontSize);
}

/**
 * 把 `tracking.*`（**em 比例**）换算成 RN / SwiftUI / ArkTS 需要的**点值字距**。
 *
 * 🔴 与 `resolveLineHeight` 的关键差别：**这里不能取整。**
 * 字距的绝对值本来就小于 1pt —— 典型值 `-0.022em` 在 16px 字号下是
 * `-0.352pt`。`Math.round(-0.352)` 得到 `-0`，字距**完全消失**，
 * 而且不报错、不告警，视觉上只是"标题看起来松了一点"。
 *
 * 因此保留小数并限到 3 位（RN 的 letterSpacing 接受浮点；
 * 3 位远高于任何屏幕能分辨的精度，同时避免浮点尾巴进产物 diff）。
 *
 * 与行高一样，不在生成器里预先算好：字号与字距是两个独立 token，
 * 只有消费时才知道配的是哪一级字号。
 */
export function resolveTracking(emRatio: number, fontSize: number): number {
  return Number((emRatio * fontSize).toFixed(3));
}