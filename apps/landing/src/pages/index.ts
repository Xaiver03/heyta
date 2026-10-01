/**
 * 「页面 id → 页面组件」的映射
 * ================================
 *
 * 🔴 **`Record<SitePageId, …>` 不是类型体操，它是"忘了写组件"这条漏法的封堵。**
 *
 * 站点注册表（`src/site/pages.ts`）决定有哪些路由，而路由要能打开，还得有人
 * 画出它的正文。这两件事分在两层是必须的（注册表不该 import React），
 * 代价是"注册了页面但没写组件"成为一种可能。用 `Record<SitePageId, …>`
 * 之后，那条漏法是**编译期**错误（`tsc -b` 直接失败），而不是
 * "线上打开是一个空白页、而所有测试都绿"——空白页恰恰是本轮要根除的形态。
 *
 * 加一个页面的完整清单（也是 `pages.ts` 文件头里那三步）：
 *   1. `src/site/pages.ts` 加一条（含 headingKey / ledeKey / 三个 seo 词条 key）；
 *   2. `packages/i18n` 的 zh/en **两张表都**加词条；
 *   3. 在这里登记组件（漏了这一步编译不过），以及它的正文 key 清单
 *      （`src/site/content.ts`）。
 * 然后跑 `pnpm --filter @heyta/landing gen:entries` 生成入口与 sitemap。
 * 🔴 **不需要**改导航、页脚、sitemap 或 vite 配置。
 */

import type { ComponentType } from 'react';

import { Landing } from '../Landing.js';
import { ChangelogPage } from './ChangelogPage.js';
import { DocsArticlePage } from './DocsArticlePage.js';
import { DocsCategoryPage } from './DocsCategoryPage.js';
import { FeaturesPage } from './FeaturesPage.js';
import { HelpPage } from './HelpPage.js';
import { IntegrationsPage } from './IntegrationsPage.js';
import { LegalDocumentPage } from './LegalDocumentPage.js';
import { PlatformsPage } from './PlatformsPage.js';
import { PricingPage } from './PricingPage.js';
import { SigninPage } from './SigninPage.js';
import type { SitePage, SitePageId } from '../site/pages.js';

type PageComponent = ComponentType<{ page: SitePage }>;

export const PAGE_COMPONENTS: Record<SitePageId, PageComponent> = {
  home: Landing,
  features: FeaturesPage,
  platforms: PlatformsPage,
  pricing: PricingPage,
  integrations: IntegrationsPage,
  help: HelpPage,
  changelog: ChangelogPage,
  signin: SigninPage,
  /**
   * 🔴 **十四篇文章 → 同一个组件**是刻意的，不是偷懒。
   *
   * 文章之间的差异全部是**数据**（标题、引言、分区的正文 key），住在注册表里
   * （`src/site/docs.ts`）；如果每篇各有一个组件，"这一篇的排版跟别人不一样"
   * 就会变成一个可以悄悄发生的选项 —— 而文档中心的全部价值恰恰在于
   * **每一篇读起来是同一套东西**（N4）。
   *
   * 加一篇文章因此只需要在 `docs.ts` 加一条 + 两张词条表加 key：
   * 这里必须跟着多写一行（`Record<SitePageId, …>` 会拦住不写的人），
   * 但写的是同一个名字，所以排版不可能分叉。
   *
   * ⚠️ 下面十四行的**顺序跟着注册表**排（start → sync → organize → data → trust），
   * 不是为了好看：读者在文件里扫一遍，应当和访客在侧栏里扫一遍读到的是同一套 IA。
   */
  'first-run': DocsArticlePage,
  concepts: DocsArticlePage,
  how: DocsArticlePage,
  account: DocsArticlePage,
  passphrase: DocsArticlePage,
  conflict: DocsArticlePage,
  views: DocsArticlePage,
  repeat: DocsArticlePage,
  reminders: DocsArticlePage,
  selfhost: DocsArticlePage,
  transfer: DocsArticlePage,
  trash: DocsArticlePage,
  privacy: DocsArticlePage,
  loss: DocsArticlePage,
  /**
   * 五个分类页 → 同一个组件，与上面十四行同一个理由：
   * 分类之间的差异（归属哪个模块、下面挂哪几篇、哪两条速答）全部是**数据**，
   * 住在 `src/site/docs.ts` 的 `DOCS_CATEGORY_MODULES` 与注册表里。
   * ⚠️ 只给"有文章"的分类登记 —— 只有速答的分类出不了分类页（它上面没东西可看）。
   */
  start: DocsCategoryPage,
  sync: DocsCategoryPage,
  organize: DocsCategoryPage,
  data: DocsCategoryPage,
  trust: DocsCategoryPage,
  /**
   * 九份对外法律文本 → 同一个组件，与上面两批同一个理由：**差异全是数据**。
   *
   * 🔴 这里比文档中心多担一件事：每份文本的**正文本身**也不在这个仓库里，
   * 它在 `@heyta/legal`（唯一事实源，见那个包的文件头）。所以这一批登记
   * 少写一行的后果不是"空白页"，而是"某个法务承诺在网站上根本不存在" ——
   * `tests/legal-pages.spec.ts` 因此除了编译期兜底还要**逐份核对九份都挂上了**。
   *
   * ⚠️ 顺序跟着 `@heyta/legal` 的 `LEGAL_DOCUMENTS`（= 页脚 legal 组的展示顺序）：
   * 服务条款在前，隐私政策紧随，因为备案与商店表单要按这个次序引用它们。
   */
  'legal-terms': LegalDocumentPage,
  'legal-privacy': LegalDocumentPage,
  'legal-personal-info-list': LegalDocumentPage,
  'legal-permissions': LegalDocumentPage,
  'legal-third-parties': LegalDocumentPage,
  'legal-ai-and-transfer': LegalDocumentPage,
  'legal-minors': LegalDocumentPage,
  'legal-subscription-refund': LegalDocumentPage,
  'legal-data-rights': LegalDocumentPage,
};
