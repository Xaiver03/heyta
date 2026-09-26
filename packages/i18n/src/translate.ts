import { en } from './locales/en.js';
import { zhCN, type MessageKey } from './locales/zh-CN.js';
import { DEFAULT_LOCALE, type Locale, type MessageVars } from './types.js';

/**
 * 语言 → 词条表。`satisfies` 保证**每一种 Locale 都有表**：
 * 往 `types.ts` 的 Locale 联合里加一种语言却忘记建表，这里就编译不过。
 */
export const CATALOGS = {
  'zh-CN': zhCN,
  en,
} as const satisfies Record<Locale, Record<MessageKey, string>>;

/** `{name}` 形状的占位符。只认单词字符，避免误吃 `{ a.b }` 这类代码片段。 */
const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * 取一条词条并做插值。
 *
 * 🔴 查不到词条时**抛错，不返回 undefined，也不返回 key 本身**。
 * 类型系统已经保证正常调用不会走到这里（`MessageKey` 是从词条表推导出的联合类型），
 * 能走到只有一种可能：有人用 `as MessageKey` 绕过了类型。
 * 那种情况下：
 *   - 返回 `undefined` → React 静默渲染成空白（**最初就是这样，被测试抓到**）；
 *   - 返回 key 本身   → 把 `landing.not.a.real.key` 这种内部标识符渲染给用户；
 *   - 抛错           → 立刻定位到是哪条 key、哪种语言。
 * 这是刻意选的"响"，与仓库其它地方（门禁全为红而非黄）同一取向。
 *
 * @param locale 目标语言
 * @param key    词条 key，编译期校验
 * @param vars   插值变量；缺变量时**保留原占位符**（`{name}`），
 *               而不是渲染成 `undefined` —— 前者一眼能看出是漏了变量，
 *               后者会被误认为是一句正常文案。
 */
export function translate(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const catalog = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  // 显式标成 `string | undefined`：类型上这里是 string，但那个保证来自
  // MessageKey 这个联合类型；一旦有人 `as MessageKey` 绕过去，运行时就是 undefined。
  // 不这么标，TS 会认为下面那次比较"不可能成立"而报错。
  const template: string | undefined = catalog[key];
  if (template === undefined) {
    throw new Error(`[@heyta/i18n] 词条不存在：${locale} / ${key}`);
  }
  if (vars === undefined) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}
