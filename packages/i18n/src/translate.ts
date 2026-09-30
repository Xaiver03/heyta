import { translateIn } from './catalog.js';
import { en } from './locales/en.js';
import { zhCN, type MessageKey } from './locales/zh-CN.js';
import { DEFAULT_LOCALE, type Locale, type MessageVars } from './types.js';

/**
 * 语言 → 词条表。`satisfies` 保证**每一种 Locale 都有表**：
 * 往 `types.ts` 的 Locale 联合里加一种语言却忘记建表，这里就编译不过。
 *
 * ⚠️ 这份表是"全都装进来"的默认实现，供 web / mobile / 测试使用。
 * **落地页不用它** —— 那是多 HTML 入口的静态站，每个入口只服务一种语言，
 * 走 `@heyta/i18n/provider` + 按语言动态 import 单份表（见 `catalog.ts` 文件头）。
 */
export const CATALOGS = {
  'zh-CN': zhCN,
  en,
} as const satisfies Record<Locale, Record<MessageKey, string>>;

/**
 * 取一条词条并做插值（默认全表版）。
 *
 * ⚠️ 逻辑本身在 `catalog.ts` 的 `translateIn` —— 这里只负责"按 locale 选表"。
 * 把逻辑抄成两份的话，落地页那条单表路径与这条会在某个边界上分叉
 * （最典型的是插值占位符的处理），而两边都有测试、都不报错。
 */
export function translate(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const catalog = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  return translateIn(catalog, locale, key, vars);
}
