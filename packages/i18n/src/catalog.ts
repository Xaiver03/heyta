/**
 * 词条取用逻辑 —— **不认识任何一份具体词条表**（R7 的落地件）
 * ==============================================================
 *
 * 🔴 为什么要把这一层单独拆出来：`translate.ts` 里那句
 * `import { en } from './locales/en.js'` 会让**每一个** import 本包的模块
 * 同时拖进中英两份词条 —— 而落地页是**多 HTML 入口**的静态站，
 * 每个入口只服务一种语言：`/signin/` 永远不需要英文表，`/en/signin/` 永远
 * 不需要中文表。实测这两份加一起在落地页主包里约 **93 KB gz / 205 KB gz**。
 *
 * 拆开之后：
 *   · `translate.ts`（默认表）+ `index.ts` 保持**逐字不变的行为**（web / mobile
 *     照旧 `import { I18nProvider } from '@heyta/i18n'`）；
 *   · 落地页走 `@heyta/i18n/provider`（本层 + React 绑定，不含任何词条表）
 *     + **动态** import 当前语言的那一份 ⇒ 另一种语言的表根本不会被下载。
 *
 * ⚠️ 本文件**不许** import `./locales/**` 或 `./translate.js` —— 那会把
 * 刚拆掉的两份表又拉回来，而症状是"代码看着对了，包一点没小"。
 */

import type { MessageKey } from './locales/zh-CN.js';
import type { Locale, MessageVars } from './types.js';

/** 一份词条表。`Record<MessageKey, string>` 的形状由调用方保证（各 locale 文件已 `satisfies`）。 */
export type Catalog = Readonly<Record<MessageKey, string>>;

/** `{name}` 形状的占位符。只认单词字符，避免误吃 `{ a.b }` 这类代码片段。 */
const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * 从**给定的一份表**里取词条并做插值。
 *
 * 🔴 查不到词条时**抛错，不返回 undefined，也不返回 key 本身**：
 *   - 返回 `undefined` → React 静默渲染成空白（**最初就是这样，被测试抓到**）；
 *   - 返回 key 本身   → 把 `landing.not.a.real.key` 这种内部标识符渲染给用户；
 *   - 抛错           → 立刻定位到是哪条 key、哪种语言。
 * 这是刻意选的"响"，与仓库其它地方（门禁全为红而非黄）同一取向。
 *
 * @param catalog 当前语言的表（**必须**与 `locale` 对应，调用方负责）
 * @param vars    插值变量；缺变量时**保留原占位符**（`{name}`），
 *                而不是渲染成 `undefined` —— 前者一眼能看出是漏了变量，
 *                后者会被误认为是一句正常文案。
 */
export function translateIn(
  catalog: Catalog,
  locale: Locale,
  key: MessageKey,
  vars?: MessageVars,
): string {
  // 显式标成 `string | undefined`：类型上这里是 string，但那个保证来自
  // MessageKey 这个联合类型；一旦有人 `as MessageKey` 绕过去，运行时就是 undefined。
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
