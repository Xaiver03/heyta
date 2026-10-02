/**
 * 图标尺寸常量（数值形态）。
 *
 * 为什么住在 L0：lucide 的 `size` prop 走 SVG 的 width/height **属性**，
 * 属性值不解析 `var()` —— web 侧不能像 CSS 那样用 `var(--ht-icon-*)`，
 * 必须给**数字**。数值只能从 token 表派生，而"宿主直接拿表建视图"被
 * `check:theme` 的分层规则禁止（R3：宿主读取必须走 design-system 的
 * 合法 API）—— 所以这个视图本身就该住在 L0 内部（这里拿表合法），
 * 宿主只消费导出值。
 *
 * 取自 `lightTokens`。图标尺寸不随主题变，因此用亮色表即可，
 * 不构成第二事实源。
 */

import { lightTokens } from './generated/tokens.native.js';

export const ICON_SIZE = {
  /** 装饰性小图标的下限（14）。此前 web 壳长过 12/13 的随手值。 */
  xs: lightTokens['icon.xs'],
  sm: lightTokens['icon.sm'],
  md: lightTokens['icon.md'],
  /** 基准档（24）。 */
  lg: lightTokens['icon.lg'],
  /** 空状态等大图标（32）。 */
  xl: lightTokens['icon.xl'],
} as const;

export type IconSizeName = keyof typeof ICON_SIZE;
