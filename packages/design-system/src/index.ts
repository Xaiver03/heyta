/**
 * @heyta/design-system
 *
 * heyta 的设计变量唯一事实源（蓝白色系）。
 *
 * 消费方式：
 *
 * ```ts
 * // 1. 引入 token 变量与基线样式（只在应用入口做一次）
 * import '@heyta/design-system/tokens.css';
 * import '@heyta/design-system/reset.css';
 *
 * // 2. 组件里**永远不要**写裸值
 * import { cssVar } from '@heyta/design-system';
 * const style = { color: cssVar('color.foreground') };   // ✅ 类型安全
 * const bad = { color: '#0f172a' };                      // ❌ 检查器会拦
 * ```
 *
 * 为什么要有这个包，而不是让 app 直接写 CSS 变量：
 *   CSS 变量在 TS 里无类型，写错名字不会报错，只会在浏览器里静默失效。
 *   把 token 名做成数据后，拼错会在**编译期**失败。
 */

export {
  TOKEN_GROUPS,
  AA_PAIRS,
  GRAPHIC_PAIRS,
  CATEGORY_SLOT_TOKENS,
  CATEGORY_SLOT_TOKEN_BY_SLOT,
  HEAT_TOKENS,
  UNSET_CATEGORY_TOKEN,
  cssVar,
  cssVarName,
  allTokenNames,
} from './tokens.js';

export type { TokenGroup, TokenName } from './tokens.js';

// ── React Native ──────────────────────────────────────────────
// RN 没有 var()/层叠，因此不能复用 cssVar()：它需要的是**展开后的字面值**
// 加一套显式的主题解析。数据来自同一份 tokens.css，与 Web/Swift/ArkTS 同源。
export {
  THEME_NAMES,
  lightTokens,
  darkTokens,
  reducedMotionTokens,
  reducedTransparencyLightTokens,
  reducedTransparencyDarkTokens,
  resolveThemeName,
  tokensForTheme,
  resolveNativeTokens,
} from './native.js';
export type { HeytaNativeTokens, ThemeName, ColorSchemeLike } from './native.js';

// CSS → RN 的值归一化。
// tokens.css 是唯一事实源，但**有一部分值只在 CSS 里合法**（字体栈 /
// box-shadow / cubic-bezier），原样塞给 RN 会"不报错但画错"。这里是转换层，
// 纯函数、不依赖 RN，所以能单测、也能同时服务 iOS/Android/鸿蒙。
export {
  resolveFontFamily,
  parseCssColor,
  parseCssShadow,
  parseCubicBezier,
  assertDurationMs,
  resolveLineHeight,
  resolveTracking,
} from './native-values.js';
export type { RnShadow, CubicBezier } from './native-values.js';

// 语义文字样式（Apple semantic typography）。
// 把"字号 + 字重 + 行高 + 字距"作为一个整体命名，组件只说"这是 row-title"，
// 不说四个数字 —— 否则同一段文字在不同界面必然漂移，且没有任何一处会报错。
// 它只**组合**已有 token，不引入新取值，因此不构成第二个事实源。
export { TEXT_STYLES, resolveTextStyle, resolveAllTextStyles } from './typography.js';

// 图标尺寸的数值形态（lucide 的 size prop 需要 SVG 属性数字，CSS 变量帮不上）。
// 视图住在 L0 内部（宿主直接拿表建视图被 check:theme 的 R3 禁止）。
export { ICON_SIZE, type IconSizeName } from './icon-size.js';

// 品牌 mark 的**几何真源**（一份「h」，各端图标都从它栅格化）。
// 动机是实测出的两种失效：手抄一份路径数据（落地页 favicon 与 PWA 图标曾是两枚
// 不同的 mark），或用脚手架默认图（Android 的 ic_launcher 曾是 React Native 模板）。
// 🔴 这里只有几何、没有颜色 —— 颜色由调用方从 token 传进来，不构成第二份配色表。
export {
  BRAND_MARK_CANVAS,
  BRAND_MARK_RADIUS,
  BRAND_MARK_SAFE,
  BRAND_MARK_PWA_SAFE,
  BRAND_MARK_ANDROID_SAFE,
  brandMarkRects,
  brandMarkSvg,
  brandMarkCircleSvg,
  brandMarkGlyphSvg,
} from './brand-mark.js';
export type { BrandMarkOptions, BrandMarkTransform } from './brand-mark.js';
export type { TextStyleName, TextStyleSpec, RnTextStyle } from './typography.js';

/**
 * tokens.css 的**读取层**。
 *
 * 为什么把它导出来：`scripts/gen-app-icons.mjs` 与 `scripts/gen-boot-splash.mjs`
 * 要把 token 的字面 CSS 值搬到"运行时读不到 tokens.css"的地方（内联在 HTML 里的
 * 首屏样式、Android 主题项）。那些搬运**不许自带一份解析器** —— 自写正则读
 * tokens.css 就是第二个事实源，而它坏的方式是"静默搬错值"，不是报错。
 * 用这里这份，等于和生成 Swift/ArkTS 产物走的是同一个解析器。
 */
export { extractVars, extractReducedMotion, resolveAllVars } from './css-tokens.js';

// 任务行的**形状契约**（一行用哪些 token / 哪条语义文字样式）。
// 🔴 它只**登记**已有取值，不引入新取值 —— 但它让"共享的 RN 行"与
// "落地页的 DOM 复刻件"能从**同一份**形状派生，而不是各抄一组字号与间距。
// 动机与那次实测漂移（勾选框 20 vs 22px、标题 sm vs base）见该文件头。
export { TASK_ROW_SHAPE, TASK_ROW_TEXT } from './task-row-shape.js';
