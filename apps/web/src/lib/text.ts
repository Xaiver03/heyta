/**
 * 语义文字样式的 Web 消费入口
 * ============================
 *
 * 为什么需要这个文件：设计系统已经用 `TEXT_STYLES` 把"字号 + 字重 + 行高 + 字距"
 * 定义成一个**不可分割的整体**（`packages/design-system/src/typography.ts`），
 * 并明确要求组件只说"这是 section-title"，不说四个数字。
 *
 * 但 `TEXT_STYLES` 的消费方**只有移动端**（`apps/mobile/src/theme.tsx`）。
 * Web 这边每个组件各自拼 `{fontSize, fontWeight}` —— 而字距（`tracking`）
 * **一次都没被拼过**。后果不是"不好看"：Apple 的规则是字距随字号变
 * （大字收紧、小字放宽），漏掉字距等于所有字号都用同一个默认字距，
 * 于是大标题必然松散、小字必然发挤 —— 而且没有任何一处会报错。
 *
 * 🔴 这里**不引入任何新取值**：四个属性全部从 `TEXT_STYLES` 里读 token 名，
 * 再去 `tokens.css` 取值。改 tokens.css，这里跟着变。
 *
 * ⚠️ 刻意不做成"给每个样式生成一个 CSS 类"：那需要在构建期把 tokens.css 的
 * 取值抄进 app.css，等于制造第二个事实源。行内 style 读的是 CSS 变量本身。
 */

import {
  TEXT_STYLES,
  cssVar,
  type TextStyleName,
  type TextStyleSpec,
} from '@heyta/design-system';
import type { CSSProperties } from 'react';

/**
 * 把语义文字样式展开成 `CSSProperties`。
 *
 * ```tsx
 * <h2 style={{ ...text('section-title'), color: cssVar('color.foreground') }} />
 * ```
 *
 * ⚠️ 上面写成自闭合标签是**故意的**：文案门禁会把 `>…<` 之间的东西当成
 * JSX 文本节点（它按源码扫描，看不出这是注释）—— 在示例里塞一句中文，
 * 门禁就会报一处不存在的硬编码文案。
 *
 * `line-height` 与 `letter-spacing` 直接吃 token 值：
 * tokens.css 里前者是**无单位倍数**（`1.5`），后者是 **em 比例**（`-0.022em`）——
 * 两者都是 CSS 原生接受的形状，不需要换算。
 * （原生端才需要换算成点值，见 `native-values.ts`。）
 */
export function text(name: TextStyleName): CSSProperties {
  /**
   * ⚠️ 这里必须**显式标注** `TextStyleSpec`。
   *
   * `TEXT_STYLES` 是 `as const satisfies ...`，于是它的类型是**九个具体字面量
   * 对象组成的联合**：只有 `badge` / `numeric-*` 那几个才带 `tabularNums`。
   * 直接读 `TEXT_STYLES[name].tabularNums` 会报"该属性不存在"——
   * 因为联合里的大多数成员确实没有它。标注成 `TextStyleSpec`（可选属性）
   * 之后才是一次合法的窄化。
   */
  const spec: TextStyleSpec = TEXT_STYLES[name];
  return {
    fontSize: cssVar(spec.size),
    fontWeight: cssVar(spec.weight),
    lineHeight: cssVar(spec.leading),
    letterSpacing: cssVar(spec.tracking),
    // 等宽数字：计时器与统计数字不加时，每跳一个数整个版面都会横向抖动。
    // 这不是审美问题，是缺陷 —— 所以由样式本身携带，而不是靠调用方记得加。
    ...(spec.tabularNums === true ? { fontVariantNumeric: 'tabular-nums' as const } : {}),
  };
}