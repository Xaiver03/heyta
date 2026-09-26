/**
 * 语言由 **URL 决定**，不由 localStorage 决定。
 * ============================================
 *
 * 这是一个要拿自然流量的页面，所以中英两版必须是**两个可以各自被收录、
 * 各自被分享的地址**（`/` 与 `/en/`）。不用 localStorage 记选择，原因有两条：
 *
 *   1. 用 storage 记语言，搜索引擎只会看到一个版本 —— 英文内容永远进不了索引；
 *   2. 把英文链接发给别人、对方打开却是中文，是真实会发生的尴尬
 *      （对方浏览器里存的是中文）。
 *
 * 所以切换器是一个**链接**（`<a href>`），不是一个开关。代价是切换会整页跳转，
 * 但对落地页来说这恰好是想要的：URL 变了，可以直接复制分享。
 */

import { DEFAULT_LOCALE, type Locale } from '@heyta/i18n';

/**
 * 部署基路径。落地页挂在 `heyta.finlaw.cloud` 的根上（`/`），
 * 但历史上也用过 `/landing/` 子路径，所以这里从 Vite 的 base 推导，
 * 而不是把 `/` 写死 —— 写死会让子路径部署时中英互链全部 404。
 */
const BASE = import.meta.env.BASE_URL;

/** 英文版的路径前缀，相对基路径。 */
const EN_SEGMENT = 'en/';

/**
 * 从路径判断语言。**只认 `/en/` 前缀**，其余一律回落到默认语言。
 *
 * 不做「按 Accept-Language 自动跳转」：那会让第一次访问中文站的英文浏览器用户
 * 被弹到 `/en/`，而中文用户分享出去的链接在别人那里变成英文。
 * 想换语言的人点一下切换器即可，那是一次明确的意图。
 */
export function localeFromPath(pathname: string): Locale {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  return rest === 'en' || rest.startsWith(EN_SEGMENT) ? 'en' : DEFAULT_LOCALE;
}

/** 另一种语言的地址，用于切换器与 hreflang。 */
export function otherLocaleHref(locale: Locale): string {
  return locale === 'en' ? BASE : `${BASE}${EN_SEGMENT}`;
}
