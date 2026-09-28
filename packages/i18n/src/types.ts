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

/**
 * 另一种语言。
 *
 * 🔴 **这个函数存在的唯一理由是"只有一份写法"。** 站点里"切到另一种语言"
 * 这个判断此前在 `site/paths.ts` 与 `Nav.tsx` 各写了一遍
 * （`locale === 'en' ? 'zh-CN' : 'en'`）—— 两份写法必然漂移，而漂移的表现是
 * **语言切换器指向自己**（点了没反应），这种错误在所有断言里都不显眼。
 *
 * 实现按 `LOCALES` 而不是硬编码两个字面量：将来加第三种语言时，
 * 这里的行为（回落到顺序上的下一个）仍然是确定的，而硬编码会**静默**只认前两种。
 */
export function otherLocale(locale: Locale): Locale {
  const rest = LOCALES.filter((candidate) => candidate !== locale);
  return rest[0] ?? DEFAULT_LOCALE;
}

/** 插值变量。`{name}` 形状的占位符由这些值替换。 */
export type MessageVars = Record<string, string | number>;
