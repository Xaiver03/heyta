/**
 * 国际化的公共类型。
 *
 * 为什么 Locale 是**字面量联合**而不是 `string`：
 * 词条表是 `Record<Locale, ...>`，联合类型让 `CATALOGS[locale]` 在
 * `noUncheckedIndexedAccess` 下**不返回 undefined** —— 少一次无用兜底，
 * 也少一处"写了兜底但其实永远走不到"的死代码。
 */

/** 支持的语言。新增语言时**必须**同时在 locales/ 下加词条表，否则编译不过。 */
export type Locale = 'zh-CN' | 'en';

/** 运行时枚举（语言切换器要遍历它）。与上面的联合类型保持同一份事实。 */
export const LOCALES = ['zh-CN', 'en'] as const satisfies readonly Locale[];

/** 兜底语言。任何查不到的语言都回落到它。 */
export const DEFAULT_LOCALE: Locale = 'zh-CN';

/** 插值变量。`{name}` 形状的占位符由这些值替换。 */
export type MessageVars = Record<string, string | number>;
