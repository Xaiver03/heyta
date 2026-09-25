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
  cssVar,
  cssVarName,
  allTokenNames,
} from './tokens.js';

export type { TokenGroup, TokenName } from './tokens.js';
