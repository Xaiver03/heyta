/**
 * 表单行的**判断**（两端共用）
 * ============================
 *
 * 这里只回答"这一行显示了什么、读屏念什么"，**不画任何东西**。
 * 渲染器有两位：web 的 `apps/web/src/lib/form/FormField.tsx`（HTML）与
 * 移动端的 `./Field.tsx`（RN）。它们共用本文件 —— 因为"错误出现了，说明就该让位"
 * 这类判断一旦各写一份，两个端迟早说两句不同的话，而两边都不报错。
 *
 * ## 为什么解剖只有两种
 *
 * | `layout` | 用在哪 | 出处 |
 * |---|---|---|
 * | `stacked` 标签在上 | 表单页（一次录入一组新数据） | [GOV.UK Question pages](https://design-system.service.gov.uk/patterns/question-pages/) |
 * | `inline` 标签在左 | 设置 / 属性面板（扫读已有值） | [Apple HIG Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables) |
 *
 * 🔴 **不许加第三档**。加之前先回答："这一屏的用户是在录入，还是在扫读已有值？"
 * 答不出来就不该加 —— 全仓 6 种解剖就是这么长出来的。
 * 规则与事故记录：[`docs/agents/ux-principles.md`](../../../../docs/agents/ux-principles.md)。
 *
 * ## 三条判断（都有测试）
 *
 * 1. **错误优先，说明让位**：错误出现时 `aria-describedby` 指向错误那一句。
 *    同时念两句会让读屏用户自己找哪句是坏事。
 * 2. **`invalid` 是布尔，不是"有没有值"**：缺省也要显式说 `false`，
 *    否则读屏会沿用上一次的状态（屏幕阅读器不会替你清空）。
 * 3. **必填星号只给视觉**：无障碍侧靠 `required` / `aria-required`，
 *    星号必须 `aria-hidden`，否则被念成"名称 星号"。
 */

/** 两种解剖。见文件头那张表 —— **不许加第三档**。 */
export type FieldLayout = 'stacked' | 'inline';

export const FIELD_LAYOUTS: readonly FieldLayout[] = ['stacked', 'inline'] as const;

export interface FieldChromeInput {
  /** 常驻说明。 */
  hint?: string;
  /** 就地错误。空串与 `undefined` 同义。 */
  error?: string;
  required?: boolean;
}

export interface FieldChrome {
  layout: FieldLayout;
  /** 读屏要念的那一句的属性名。`null` = 这一行既没有说明也没有错误。 */
  describedBy: 'hint' | 'error' | null;
  /** 错误是否生效（渲染器据此决定画不画红色那一行）。 */
  invalid: boolean;
  /** 说明是否**画**得出来 —— 错误生效时为 `false`（让位）。 */
  showHint: boolean;
  /** 画不画星号。 */
  showRequiredMark: boolean;
  /** 星号必须 `aria-hidden` / `accessibilityElementsHidden`。 */
  requiredAriaHidden: true;
}

/** 把三种输入解成"这一行显示什么"。渲染器**不许**再自己判一遍。 */
export function resolveFieldChrome(
  input: FieldChromeInput,
  layout: FieldLayout = 'stacked',
): FieldChrome {
  const hasError = input.error !== undefined && input.error !== '';
  const hasHint = input.hint !== undefined && input.hint !== '';
  return {
    layout,
    describedBy: hasError ? 'error' : hasHint ? 'hint' : null,
    invalid: hasError,
    showHint: hasHint && !hasError,
    showRequiredMark: input.required === true,
    requiredAriaHidden: true,
  };
}

/**
 * 这一行的 `aria-describedby` 该指向哪个 id。
 *
 * 渲染器各自拼 id（web 用 `htmlFor`，RN 用 `accessibilityLabelledBy`），
 * 但**"指向谁"这个判断只在这里**。没有可指的东西时返回 `undefined`
 * —— 不是空字符串：空串会被当成一个存在的 id 去解析。
 */
export function fieldDescribedById(
  id: string,
  chrome: FieldChrome,
): string | undefined {
  if (chrome.describedBy === null) return undefined;
  return `${id}-${chrome.describedBy}`;
}
