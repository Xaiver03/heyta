/**
 * 站点路径解析 —— 页面 × 语言 → URL
 * =====================================
 *
 * 与 `pages.ts` 分开的理由：那个文件是**结构**（有哪些页），这里是**寻址**
 * （某一页在某种语言下是什么 URL）。合在一起会让"加一个页面"这件事
 * 同时改结构定义与寻址规则 —— 而寻址规则是全局的，不该每加一页就动一次。
 *
 * 🔴 **这个文件修的是一个必然会出现、而且很隐蔽的 bug。**
 *
 * 在此之前 `otherLocaleHref(locale)` 返回的是**写死的** `/` 或 `/en/`：
 * 当时只有一个页面，所以它是对的。一旦站点有了子页面，语言切换器就会变成
 * "在 `/features` 上点 English → 被丢回英文首页" ——
 * 页面换了语言**也换了页面**，而地址栏看起来是合理的（`/en/` 确实存在）。
 *
 * 这就是"孤立路由"的另一种形态：**页面没有孤立，但它的语言版本被孤立了**。
 * 所以语言切换必须**保持当前页面**，只换语言前缀。
 */

import { DEFAULT_LOCALE, otherLocale, type Locale } from '@heyta/i18n/provider';

import { SITE_PAGES, entryDir, type RegisteredSitePage, type SitePage } from './pages.js';

/**
 * 部署基路径。落地页挂在 `heyta.waytofuture.cn` 的根上（`/`），
 * 但历史上也用过 `/landing/` 子路径，所以这里从 Vite 的 base 推导，
 * 而不是把 `/` 写死 —— 写死会让子路径部署时所有互链全部 404。
 */
const BASE = import.meta.env.BASE_URL;

/** 把一段"站点根相对"的路径挂到基路径下。 */
function withBase(path: string): string {
  const trimmedBase = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  return `${trimmedBase}${path}`;
}

/**
 * 某一页在某种语言下的 URL（**带尾斜杠**）。
 *
 * 为什么统一带尾斜杠：产物是 `features/index.html` 这种目录形式，
 * `/features/` 是它的自然地址；`/features`（无斜杠）会多一次
 * 服务器重定向，而重定向的目标是否与 canonical 一致是另一处要维护的东西。
 * 统一成一种，canonical / hreflang / sitemap / 链接就**不可能**各自写一个形状。
 */
export function siteHref(page: SitePage, locale: Locale): string {
  const dir = entryDir(page, locale);
  return withBase(dir === '' ? '/' : `/${dir}/`);
}

/**
 * 当前路径 → 站点页面。**认不出就回落到首页。**
 *
 * ⚠️ 回落而不是抛错，是因为这个函数读的是**浏览器的当前地址**：
 * 用户可能访问了一个旧链接、一个拼错的地址，或者将来某个被删掉的页面。
 * 那时应当渲染首页（`nginx` 的 SPA 兜底本来也是这样），而不是白屏。
 * 而"注册表里查不到某个 id"是**代码写错**，那种情况由 `pageById` 抛错（见 `pages.ts`）。
 *
 * 语言前缀由调用方先剥掉（`localeFromPath` 已经做了这件事的逆运算）。
 */
export function pageFromPath(pathname: string): RegisteredSitePage {
  const rest = stripLocalePrefix(stripBase(pathname));
  const segments = rest.split('/').filter((s) => s !== '');
  // 只取第一段：站点只有一层深度（`/features/`），
  // 深链接（将来的 `/help/xxx/`）会由帮助页自己的锚点或子路由处理。
  const first = segments[0];
  if (first === undefined) return SITE_PAGES[0];
  return SITE_PAGES.find((page) => page.path === `/${first}`) ?? SITE_PAGES[0];
}

function stripBase(pathname: string): string {
  const trimmedBase = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  if (trimmedBase !== '' && pathname.startsWith(trimmedBase)) {
    return pathname.slice(trimmedBase.length);
  }
  return pathname;
}

function stripLocalePrefix(pathname: string): string {
  return pathname === '/en' || pathname.startsWith('/en/')
    ? pathname.slice(3)
    : pathname;
}

/**
 * 「当前这一页的另一种语言地址」。
 *
 * 🔴 它是语言切换器与 hreflang 的**唯一**来源 —— 两处各算一遍必然漂移，
 * 而漂移的表现是"切换器跳到 A、hreflang 声明 B"，搜索引擎会挑一个当成正版。
 */
export function otherLocaleHrefFor(page: SitePage, locale: Locale): string {
  // "另一种语言"只有一个定义（`@heyta/i18n` 的 `otherLocale`）——
  // 这里与 `Nav.tsx` 曾各写一遍 `locale === 'en' ? … : …`（见 R18）。
  return siteHref(page, otherLocale(locale));
}

/**
 * URL → 语言。**只认 `/en/` 整段前缀**，其余一律回落默认语言。
 *
 * 与 `siteHref` 同处一个文件是刻意的：它们是**正反两向的同一个映射**，
 * 分开放就会出现"生成器写 `/en/x/`、解析器认不出"这种一半对一半错的状态 ——
 * 而它的表现是英文页里的链接点进去变中文，或者语言切换器把自己当成了另一种语言。
 *
 * 🔴 前缀必须**整段**匹配：`startsWith('en')` 会把 `/energy`、`/enigma`
 * 静默当成英文版。这类 bug 手工点几下几乎碰不到，一旦有别的路径就发作。
 *
 * 不做「按 Accept-Language 自动跳转」：那会让第一次访问中文站的英文浏览器用户
 * 被弹到 `/en/`，而中文用户分享出去的链接在别人那里变成英文。
 */
export function localeFromPath(pathname: string): Locale {
  const rest = stripBase(pathname);
  return rest === '/en' || rest.startsWith('/en/') ? 'en' : DEFAULT_LOCALE;
}
