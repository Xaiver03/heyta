/**
 * 页面上的「开始使用」与「自建入口」
 * ======================================
 *
 * 与 `lib/app-url.ts` 的关系：那个文件决定**应用在哪**（并在没配置时退回
 * 「开始自建」），本文件只补一件事 —— **那个退回目标在子页面上不存在**。
 *
 * 🔴 这是从首页长出子页面之后才会出现的一类 bug，而且它**看起来是对的**：
 * `startCta()` 在没配 `VITE_APP_URL` 时返回 `#selfhost`，首页上确实有
 * `id="selfhost"` 那一节；但同一段代码搬到 `/features` 上，`#selfhost`
 * 就变成了**点了没有任何反应**的锚点 —— 控制台不报错，而门禁（查的是
 * "页内锚点都有落点"）只查首页，所以它会被一路带上线。
 *
 * 修法不是"子页面不显示 CTA"（那会让没配应用地址时整站失去唯一的行动点），
 * 而是把退回目标改成**首页那一节的绝对地址**：`/#selfhost`。
 * 一个跨页锚点比一个页内死锚点诚实，也比"什么都不显示"更有用。
 *
 * 意图与标签仍然只有一份（`StartCta`）：配了应用就是「立即使用」→ 应用，
 * 没配就是「开始自建」→ 首页的自建那一节。
 */

import { type Locale, useLocale } from '@heyta/i18n/provider';
import { useMemo } from 'react';

import { startCta, type StartCta } from '../lib/app-url.js';
import { pageById, type SitePage } from './pages.js';
import { pageFromPath, siteHref } from './paths.js';

/** 首页上「自建」那一节的 id（`SelfHost.tsx`）。改那边要一起改这里。 */
const SELF_HOST_ANCHOR = 'selfhost';

/**
 * 「自建说明」在某一页上的地址。
 *
 * ⚠️ 这里**确实**有一个分支，而且它与"不许按页分支"那条规则不冲突：
 * 分支改变的只是同一个落点的**链接形态**，不是落点本身。
 *    - 在首页：`#selfhost` —— 同文档跳转，不进历史、不重载，这是锚点的正字法；
 *    - 在别处：`/{locale}/#selfhost` —— 跨页跳转。
 * 如果两边都写成 `/#selfhost`，首页上每次点击都会往历史里塞一条"同一个文档"
 * 的记录（浏览器不重载，但 `pushState` 是真的会发生）。所以这里保住形态差别，
 * 而在**落点**上不分叉：两边都由 `SELF_HOST_ANCHOR` 与首页的地址算出来。
 */
export function selfHostHref(page: SitePage, locale: Locale): string {
  if (page.path === '/') return `#${SELF_HOST_ANCHOR}`;
  return `${siteHref(pageById('home'), locale)}#${SELF_HOST_ANCHOR}`;
}

/**
 * 某一页上的「开始使用」该指向哪。
 *
 * 两条路（配了应用 / 没配）都从 `startCta` 出发，所以**标签与意图只有一份**。
 */
export function siteCta(page: SitePage, locale: Locale): StartCta {
  const cta = startCta(locale);
  if (cta.external) return cta;
  return { ...cta, href: selfHostHref(page, locale) };
}

/**
 * 「现在这一页」。
 *
 * 🔴 有些组件（`Pricing.tsx` 里那个免费档的「开始自建」）的链接目标取决于
 * **它在哪一页上被渲染** —— 而它被首页和 `/pricing` 两处复用。
 * 用地址栏判定而不是加一层 `page` prop：那条 prop 要从 `SiteLayout`
 * 穿过 `Landing` 传到 `Pricing`，三层里任何一层传错都表现为"点了没反应"，
 * 而 URL 是这类判定的**唯一来源**（理由与 `src/lib/locale.ts` 完全相同）。
 */
function useCurrentPage(): SitePage {
  return useMemo(
    () => pageFromPath(typeof window === 'undefined' ? '/' : window.location.pathname),
    [],
  );
}

/** 「自建说明」在**当前这一页**上的地址。给被多页复用的组件用。 */
export function useSelfHostHref(): string {
  const page = useCurrentPage();
  const locale = useLocale();
  return selfHostHref(page, locale);
}
