/**
 * 表单行原语（web）—— **一张表单长什么样，只在这里定义**
 * ==========================================================
 *
 * ## 为什么需要它
 *
 * 2026-10-24 的实测：全仓填表界面有 **6 种解剖**、**4 种 label 内距**、
 * **5 套高度权威**，`apps/web/src` 里有 **84 处手写 `<label>`**。
 * 于是"这个表单长得对不对"没有任何判据能回答 —— 每一处都可以合法地长得不一样。
 * 那个「添加习惯」对话框就是这么长出来的（11 控件平铺、标签在控件上方、
 * 动作按钮滚出视口），而 `check:design` / `check:l4` / `check:overlay` 全绿。
 *
 * ## 两种解剖，按**任务类型**选，不按作者口味选
 *
 * 这是本文件唯一一个"要判断"的地方，所以理由写在这里：
 *
 * | `layout` | 用在哪 | 为什么 | 出处 |
 * |---|---|---|---|
 * | `stacked`（标签在上） | **表单页**：一次录入一组新数据（新建、注册、结算） | 标签在上时行高稳定、可换行、长文案与翻译不会挤压控件；一次只看一个字段的路径更短 | [GOV.UK — 一次只做一件事][govuk-one-thing]、[GOV.UK text input][govuk-input] |
 * | `inline`（标签在左） | **属性/设置面板**：改同一个对象的几个属性（滴答的添加习惯、macOS 系统设置） | 这里用户的动作是**扫读已有值**，左列标签给出稳定的"属性名 → 值"映射，行距可压到 44+8 | [Apple HIG — Lists and tables][hig-lists]（grouped list 的 leading label / trailing value） |
 *
 * 🔴 **两档之外不许有第三档。** 想加档之前先回答："这一屏的用户是在**录入**，还是在**扫读已有值**？"
 * 答不出来就不该加档 —— 那正是"6 种解剖"的来历。
 *
 * ## 🔴 这里**不做**的三件事（都是刻意，不是漏）
 *
 * 1. **不画静止态描边**。产品负责人 2026-10-07 定的「无描边交互」，而
 *    WCAG 1.4.11 的 Boundaries 一节明写边界**不是**必需的（只要控件有可见内容可识别）。
 *    ⇒ 字段的可识别性由**填充色**承担（`surface-sunken` 对 `surface-raised`）。
 * 2. **但焦点环必须有**，且由 `borderless-controls.css` 全局给出（键盘 `:focus-visible`，
 *    主色 5.17:1）。焦点**不在**本组件里画：画在这里就会与全局那条 `!important` 打架。
 * 3. **不收 `children` 的裸节点**，只收 render prop。理由见下。
 *
 * ## 为什么是 render prop 而不是 `cloneElement`
 *
 * 控件的形状不止一种：裸 `<input>`、`<div><select/><ChevronDown/></div>`、
 * 一对并排的 input。`cloneElement` 只能把 `id` / `aria-*` 注入**最外层**，
 * 而最外层是 `<div>` 时那些属性到不了真正可聚焦的元素上 —— 症状是
 * "读屏念不出必填"、"点标签不聚焦"，而测试全绿。
 * 所以这里把 `field` 交给调用方**自己摊到真正的控件上**：类型逼着人做对。
 *
 * 出处与数值：
 * - 44pt 触控下限：[Apple HIG — Layout][hig-layout]；本项目 token `--ht-size-field-height`。
 * - 错误就地 + `aria-describedby`：[WCAG 3.3.1 错误识别][wcag-331]、[Material — field grouping][md-fields]。
 * - 必填标记：[WCAG 3.3.2 标签或说明][wcag-332]。
 *
 * [govuk-one-thing]: https://design-system.service.gov.uk/patterns/question-pages/
 * [govuk-input]: https://design-system.service.gov.uk/components/text-input/
 * [hig-lists]: https://developer.apple.com/design/human-interface-guidelines/lists-and-tables
 * [hig-layout]: https://developer.apple.com/design/human-interface-guidelines/layout
 * [wcag-331]: https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html
 * [wcag-332]: https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html
 * [md-fields]: https://m3.material.io/components/text-fields/guidelines
 */

import type { ReactNode } from 'react';

// 🔴 **判断不在这份文件里**：`resolveFieldChrome` 住在 `@heyta/ui`，移动端的
//    `Field.tsx` 消费同一个函数。两端各写一份"错误出现时说明让位"的话，
//    迟早说两句不同的话，而两边都不报错。
import {
  fieldDescribedById,
  resolveFieldChrome,
  type FieldLayout,
} from '@heyta/ui';

/** 两种解剖（类型与词表都来自共享层，见 `@heyta/ui#FieldLayout`）。 */
export type FormFieldLayout = FieldLayout;

/** 交给 render prop 的那些属性：调用方必须摊到**真正可聚焦**的那个元素上。 */
export interface FormFieldControlProps {
  id: string;
  required: boolean;
  'aria-required': boolean;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

export interface FormFieldProps {
  /** 必填：`htmlFor` / `id` 都从它来。全仓不许再手拼字符串 id。 */
  id: string;
  label: string;
  /** 缺省 `stacked`（表单页）。设置/属性面板显式写 `inline`。 */
  layout?: FormFieldLayout;
  /** 常驻说明。与错误**互斥显示**：错误出现时说明让位（同一行不许说两句话）。 */
  hint?: string;
  /** 就地错误。`undefined` / 空串 = 没有错误。 */
  error?: string;
  required?: boolean;
  /**
   * 标签那一格里放别的东西（头像、色块…）。给了就**不画 label 文字**，
   * 但 `aria-label` 必须由调用方给到控件上 —— 本组件不会替你编一个名字。
   */
  leading?: ReactNode;
  /** 控件区。`field` 必须摊到真正的 `<input>` / `<select>` 上。 */
  children: (field: FormFieldControlProps) => ReactNode;
  testID?: string;
}

/**
 * 一行字段。
 *
 * ⚠️ 样式类在 `apps/web/src/styles/app/form.css`（`.ht-input-field*`）——
 * 与全仓其它界面同一条纪律：**样式不写在 TSX 里**（`check:l4`）。
 */
export function FormField({
  id,
  label,
  layout = 'stacked',
  hint,
  error,
  required = false,
  leading,
  children,
  testID,
}: FormFieldProps): React.JSX.Element {
  const chrome = resolveFieldChrome({ hint, error, required }, layout);
  const describedBy = fieldDescribedById(id, chrome);
  const invalid = chrome.invalid;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const usesLabelElement = leading === undefined;

  return (
    <div
      className={`ht-input-field ht-input-field--${layout}`}
      data-invalid={invalid ? '' : undefined}
      {...(testID === undefined ? {} : { 'data-testid': testID })}
    >
      {usesLabelElement ? (
        <label className="ht-input-field__label" htmlFor={id}>
          {label}
          {chrome.showRequiredMark ? (
            <span className="ht-input-field__required" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : (
        <span className="ht-input-field__label">{leading}</span>
      )}
      <div className="ht-input-field__control">
        {children({
          id,
          required,
          'aria-required': required,
          'aria-invalid': invalid,
          'aria-describedby': describedBy,
        })}
        {chrome.invalid ? (
          <p className="ht-input-field__error" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
        {chrome.showHint ? (
          <p className="ht-input-field__hint" id={hintId}>
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
