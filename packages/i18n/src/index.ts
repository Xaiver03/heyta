/**
 * @heyta/i18n —— 中英双语词条表与取词 API。
 *
 * 设计取舍（为什么不用 i18next / react-intl）：
 *   1. **漏翻译必须在编译期就失败。** 库的运行时 fallback 会把"还没翻"
 *      静默降级成另一种语言显示给用户；而这里的 `en` 被约束成
 *      `Record<MessageKey, string>`，少一条就编译不过。
 *   2. **零运行时依赖**：许可证门禁（check:licenses）与体积都不受影响。
 *   3. 落地页与移动端都不需要复数规则；真要用了再加，不提前背 ICU。
 */
export { LOCALES, DEFAULT_LOCALE, otherLocale } from './types.js';
export type { Locale, MessageVars } from './types.js';

export { CATALOGS, translate } from './translate.js';
export { zhCN } from './locales/zh-CN.js';
export type { MessageKey } from './locales/zh-CN.js';
export { en } from './locales/en.js';

export { I18nProvider, useI18n, useLocale } from './react.js';
export type { I18nValue } from './react.js';
