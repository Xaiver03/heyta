/**
 * 站点页面注册表 —— **站点结构的唯一事实源**
 * ==============================================
 *
 * 🔴 **这个文件存在的理由，是把「不许有孤立路由」从一句主张变成一条结构。**
 *
 * 在此之前，"站点有哪些页面"这件事散在四处，彼此没有任何约束关系：
 *   1. `vite.config.ts` 的 `input`（构建入口）
 *   2. `index.html` / `en/index.html`（手写的 `<title>` / `<meta>` / hreflang）
 *   3. `Nav.tsx` 里那张手写的链接表
 *   4. `Footer.tsx` 里那两组手写的链接
 *   5. `public/sitemap.xml`（又是手写的一份 URL 清单）
 *
 * 五份清单 = 五处漂移点。而漂移的形态正是产品负责人明令禁止的那一类：
 * **加了一个页面，某一份清单忘了改** —— 于是页面存在、URL 能打开
 * （SPA 兜底让它返回 200），但**没有任何地方链得到它**。那就是"孤立路由"。
 *
 * 现在它们**全部由这一份派生**：入口、HTML 头部、导航、页脚、sitemap、
 * 以及"没有孤立路由"的判据（见下方说明）。
 *
 * 🔴 **可达性判据目前住在测试里、没有独立脚本。** 本仓库的计划 §9 曾把
 * `check:site-reachability` 列为一门独立门禁，但**它尚未落地**（归 W4/A8）——
 * 现在管这件事的是两处**测试**：站点内部由 `render.spec.tsx` 从渲染出的 DOM 走，
 * `apps/web` 那一半由 `app-mount.spec.tsx` 走真实 App。ADR-0033 §5 已如实登记。
 * ⚠️ 不要在这里写成"有一道门禁" —— 引用一个不存在的脚本会让下一个人
 * 以为这块有人管着，而那正是本仓库最忌讳的失效。
 *
 * > **没有一条路径能新增页面而不出现在导航里** —— 因为导航是这个数组的**函数**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 加一个页面时要做什么（清单，只有三步）
 *
 * 1. 在这里加一条（含 `group` / `inNav` / `inFooter` / 三个词条 key）；
 * 2. 在 `packages/i18n` 的 zh/en **两张表都**加词条（漏一边编译期就红）；
 * 3. 在 `src/pages/` 加该页的组件，并在 `main.tsx` 的 `PAGES` 映射里登记。
 *
 * 然后跑 `pnpm --filter @heyta/landing gen:entries`（生成 HTML 入口与 sitemap）。
 * 🔴 **不需要**去改导航、页脚、sitemap 或 vite 配置 —— 那正是本文件的收益。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 与 [ADR-0033](../../../../docs/adr/0033-multi-page-site-and-bidirectional-reachability.md) 的关系
 *
 * 那份 ADR 选的是"多 HTML 入口"，但**入口必须由注册表生成而不是手写**。
 * 手写 12 份 HTML（6 页 × 2 语言）必然漂移，而漂移的头部元信息会让中英两版
 * 互相抢排名（`tests/seo-head.spec.ts` 现在只有 2 个入口可查，扩到 12 个之后
 * 手写是不可维护的）。
 */

import { LOCALES, type Locale, type MessageKey } from '@heyta/i18n/provider';

/**
 * 🔴 **本文件不许有任何相对的运行时导入 —— 这条不是风格，是构建能不能跑的前提。**
 *
 * `scripts/gen-entries.mjs` 用 Node 的类型擦除**直接**加载本文件（它是构建**之前**
 * 的一步，不能先要求一次 tsc）。而 Node 的 ESM 解析器**不会**把仓库惯例的
 * `./docs.js` 映射回 `./docs.ts` —— 实测 `ERR_MODULE_NOT_FOUND`（2026-09-30，
 * Node 24.2；Vite 与 vitest 两种写法都认，所以这个差别**只在生成器这条路上**）。
 *
 * 于是：`import type { … } from './x.js'` 可以（类型擦除后根本不存在），
 * `import { VALUE } from './x.js'` 不行。要往注册表加数据，就把数据**写在这里**，
 * 让别的文件反过来 import 本文件（`docs.ts` / `content.ts` 就是这么做的 ——
 * 它们不在生成器的运行时图上，`content.ts` 只被生成器读到它自己那份派生值）。
 *
 * 好消息是这条漏法**响亮**：它红在 `check:entries`（`pnpm check` 的第一道门禁），
 * 不会静默生成一份错的入口。
 */

/**
 * 页脚/导航里的分组。
 *
 * 🔴 **这四组是对标滴答清单站点后定下来的**（见
 * `docs/research/site-ia-and-landing-audit.md` §1.2）：它的页脚是
 * Products / Support / Resources / About / Legal 五组。
 * 我们**刻意不照抄 About 与 Resources** ——
 * 媒体资料包与 URL Scheme 都被判定为"暂缓/形态不同"（见那份文档 §3.2 的 #10 与 #12）。
 */
export type SiteGroup = 'product' | 'support' | 'legal';

/**
 * 一个站点页面。
 *
 * ⚠️ `path` **不含语言前缀**：语言是路径的**另一个维度**，由 `lib/locale.ts` 处理。
 * 把 `/en/features` 写成两条注册项会让"同一页的两个语言版本"变成两个页面 ——
 * 于是 hreflang、语言切换器、sitemap 全都要各自判断一次，而那三处必然漂移。
 */
export interface SitePage {
  /** 稳定标识，同时是词条命名空间（`site.<id>.*`）与组件映射的键。 */
  readonly id: string;
  /** 站点路径。`/` 表示首页。**不含语言前缀**。 */
  readonly path: string;
  readonly group: SiteGroup;
  /**
   * 是否出现在顶部导航。首页为 `false` —— 字标就是首页入口，不必再列一条。
   *
   * 🔴 `inNav` 与 `inFooter` **不是两个装饰位，而是 N2 那条约束的落点**：
   * 一条路由只要两个都是 `false`，它就只存在于 URL 里 —— 能打开、能返回 200、
   * 但没有任何地方链得到它。**这种页面会被 `render.spec.tsx` 的 N2 用例判红**
   * （它渲染每一页、遍历真实 DOM 里访客点得到的链接）。
   * 所以"某个页面要不要出现在导航里"是**可以讨论**的，"两个都不出现"是不行的。
   */
  readonly inNav: boolean;
  /** 是否出现在页脚。首页在页脚里用字标表达，不另列。 */
  readonly inFooter: boolean;
  /**
   * 顶部导航里**哪一项该被标成"当前"**。
   *
   * 🔴 只在"这一页不是导航项本身"时才需要写。文档文章（`/help/passphrase/`）
   * 不进导航（六条同类链接会把导航挤成一列侧栏），但它语义上属于「帮助」那一节 ——
   * 不标出来，访客在这一页就看不到自己在哪，而"我在哪"是导航的第二职责
   * （第一条是"能去哪"）。
   *
   * ⚠️ 类型是 `string` 而不是 `SitePageId`：`SitePageId` 由 `SITE_PAGES` 派生，
   * 而 `SITE_PAGES` 的元素类型是 `SitePage` —— 让接口反过来引用派生类型会构成
   * 自引用，TS 会把 `SITE_PAGES` 推成隐式 `any`（那等于把这条结构整个取消）。
   * 值写错的风险由 `Nav.tsx` 的判据承担：它只在 `navPages()` 的结果里找，
   * 找不到就是不高亮，而不会崩。
   */
  readonly navActiveId?: string;
  /**
   * 文档中心里这一页是**哪一层** —— `article`（有正文的一篇）还是 `category`
   * （一个分类的落地页）。非文档中心的页面不写。
   *
   * 🔴 **这条判据以前是路径形状，现在形状不够用了。** 文章一直是
   * 「`/help/` 开头」，而 `docs.ts` 正是用这个形状从注册表**反推**
   * "哪些页面必须有正文"（`DOCS_ENTRIES` 的键类型由它派生）。分类页
   * `/help/sync` 同样以 `/help/` 开头，于是它会被那道 `Extract` 一起捞进去，
   * 被迫配一份它根本不该有的正文 —— 要么编译期红，要么写一个假条目骗过类型。
   * 加一层显式标记后，"什么算一篇文章"有了唯一来源，而**分类页没有正文**
   * 这件事在类型上就说清了。
   *
   * ⚠️ 它是**可选**的：首页、`/features`、帮助中心 hub 都既不是文章也不是分类。
   * 于是"忘标"的表现不是静默当成文章，而是**从文章清单里消失** —— 而
   * `DocsArticlePage` 取不到正文会响亮抛错（见 `docs.ts` 的 `docsArticleById`）。
   */
  /**
   * 🔴 'hub' = 文档中心的枢纽（/docs）。它与其余落地页走**不同的外壳**：
   * `main.tsx` 按「有没有 docsKind」选择 `DocsShell`（帮助中心自己的
   * topnav/搜索/页脚，SSOS 文档站同构）或营销站的 `SiteLayout`。
   */

  readonly docsKind?: 'hub' | 'article' | 'category';
  /**
   * 这一页渲染 `@heyta/legal` 里的**哪一份**对外文本（`/legal/<docId>/`）。
   *
   * 🔴 **为什么是字符串而不是 import 那个包的类型**：本文件被
   * `scripts/gen-entries.mjs` 用 Node 的类型擦除**直接**加载（见文件头那条
   * "不许有相对的运行时导入"）。写 `import { LEGAL_DOCUMENTS } from '@heyta/legal'`
   * 会让生成器去要一个**构建产物** `dist/`，而 `pnpm check` 的第一道门禁
   * 就跑在 `pnpm build` **之前** —— 干净检出上那里是空的，生成器直接红。
   *
   * ⚠️ 所以这条字符串的**正确性有闸门，但不在编译期**：
   * `tests/legal-pages.spec.ts` 对每一个 `legalDocId` 调 `legalDocumentById()`
   * （取不到就抛），并核对九份文本一份都不许漏挂。
   */
  readonly legalDocId?: string;
  /** 导航/页脚里的标签。 */
  readonly labelKey: MessageKey;
  /**
   * 页面 `<h1>`。**与 `titleKey` 分开**：`<title>` 要带品牌与关键词
   * （搜索引擎看的是它），`<h1>` 是给人读的一句话（进页面第一眼看到的是它）。
   * 合成一条会逼出一句两边都不称职的文案 —— 通常是 `<h1>` 里塞进品牌名。
   */
  readonly headingKey: MessageKey;
  /** 页面引言，紧跟在 `<h1>` 后面。 */
  readonly ledeKey: MessageKey;
  /** 该页 `<title>` 的词条 key。 */
  readonly titleKey: MessageKey;
  /** 该页 `<meta name="description">` 的词条 key。 */
  readonly descriptionKey: MessageKey;
}

/**
 * 文档中心外壳判据（`main.tsx` 用它选 `DocsShell` 还是营销站的 `SiteLayout`）。
 * 🔴 用 `in` 而不是取属性：注册表是字面量联合，没有 docsKind 的成员
 * 根本不存在这个键，直接点属性是编译错误。
 */
export function isDocsShellPage(page: SitePage): boolean {
  return 'docsKind' in page;
}

/**
 * 全部站点页面。**加页面只改这里**（外加词条与组件，见文件头）。
 *
 * 顺序即导航与页脚的展示顺序。
 */
export const SITE_PAGES = [
  {
    id: 'home',
    path: '/',
    /**
     * ⚠️ 首页的 `<h1>` 是**两句拼起来的**（`Hero.tsx`：`titleLead` + 斜体的
     * `titleEmphasis`），所以注册表里记的是它的**前半句**。
     * 这一页不渲染 `PageHead`（英雄区自己画 h1），这两个字段在这里的作用是
     * 让"每一页都有 h1 与引言"这条不变量在类型上成立 —— 而不是声称首页的标题
     * 只有半句。
     */
    group: 'product',
    inNav: false,
    inFooter: false,
    labelKey: 'site.nav.home',
    headingKey: 'landing.hero.titleLead',
    ledeKey: 'landing.hero.lede',
    titleKey: 'site.home.seo.title',
    descriptionKey: 'site.home.seo.description',
  },
  {
    id: 'features',
    path: '/features',
    group: 'product',
    inNav: true,
    inFooter: true,
    labelKey: 'site.nav.features',
    headingKey: 'site.features.title',
    ledeKey: 'site.features.lede',
    titleKey: 'site.features.seo.title',
    descriptionKey: 'site.features.seo.description',
  },
  {
    id: 'platforms',
    path: '/platforms',
    group: 'product',
    inNav: true,
    inFooter: true,
    labelKey: 'site.nav.platforms',
    headingKey: 'site.platforms.title',
    ledeKey: 'site.platforms.lede',
    titleKey: 'site.platforms.seo.title',
    descriptionKey: 'site.platforms.seo.description',
  },
  {
    id: 'pricing',
    path: '/pricing',
    group: 'product',
    inNav: true,
    inFooter: true,
    labelKey: 'site.nav.pricing',
    headingKey: 'site.pricing.title',
    ledeKey: 'site.pricing.lede',
    titleKey: 'site.pricing.seo.title',
    descriptionKey: 'site.pricing.seo.description',
  },
  {
    id: 'integrations',
    path: '/integrations',
    group: 'product',
    /**
     * 🔴 `inNav: true` **就是反孤岛那一项**（硬约束 2）：这一页讲的是
     * "我们独有、而滴答清单没有"的能力，只有让访客在导航里一眼看到，
     * 它才不是一块只能靠手打 URL 到达的孤岛。
     */
    inNav: true,
    inFooter: true,
    labelKey: 'site.nav.integrations',
    headingKey: 'site.integrations.title',
    ledeKey: 'site.integrations.lede',
    titleKey: 'site.integrations.seo.title',
    descriptionKey: 'site.integrations.seo.description',
  },
  {
    id: 'help',
    path: '/docs',
    group: 'support',
    inNav: true,
    inFooter: true,
    docsKind: 'hub',
    labelKey: 'site.nav.help',
    headingKey: 'site.help.title',
    ledeKey: 'site.help.lede',
    titleKey: 'site.help.seo.title',
    descriptionKey: 'site.help.seo.description',
  },
  {
    id: 'changelog',
    path: '/changelog',
    group: 'support',
    /**
     * 不进顶部导航，只进页脚。
     *
     * 判据是**它服务的是谁**：导航栏是给第一次来的访客用的（他要知道这东西
     * 能干什么、多少钱、在哪下），而"更新动态"只有已经用过的人才关心 ——
     * 那种人是从**应用里**点进来的（A6-6），或者顺手在页脚找。
     * 把它塞进导航会让导航从 4 项变成 6 项，而多出来的两项都不解决首访问题。
     */
    inNav: false,
    inFooter: true,
    labelKey: 'site.nav.changelog',
    headingKey: 'site.changelog.title',
    ledeKey: 'site.changelog.lede',
    titleKey: 'site.changelog.seo.title',
    descriptionKey: 'site.changelog.seo.description',
  },
  {
    id: 'signin',
    path: '/signin',
    group: 'support',
    /**
     * 不进导航链接组，但**一定在导航里** —— 它以「登录」的形式挂在
     * 导航右侧的操作位（`Nav.tsx`），与「立即使用」并列，而不是消失在
     * 一列同质的链接里。
     *
     * 依据 A5-2：回访用户要一眼找到它；而它与「立即使用」是两个不同的意图
     * （"我已有账号"vs"我要开始用"），**不能合并成一个按钮**。
     */
    inNav: false,
    inFooter: true,
    labelKey: 'site.nav.signin',
    headingKey: 'site.signin.title',
    ledeKey: 'site.signin.lede',
    titleKey: 'site.signin.seo.title',
    descriptionKey: 'site.signin.seo.description',
  },
  /**
   * ─────────────────────────────────────────────────────────────────────
   * 文档中心的**分类页** —— 一个分类一层深度，`/help/<分类>`，**五个分类五张页**。
   *
   * 🔴 **只给「有文章的分类」建页。** 这条不是省工：帮助中心那一侧的五条分类
   * 名共用一份词表（`content.ts` 的 `HELP_MODULES`），如果某个空分类建了页，
   * 那张就是一页**只有标题没有内容**的入口 —— 而"没有内容就不出现链接"
   * 是 `/features` 与侧栏共用的那条纪律（`docs.ts` 文件头）。
   * ⚠️ 顺序也要对上：这五张页的成员与顺序**由 `docs.ts` 的
   * `DOCS_CATEGORY_MODULES` 在编译期钉住**（少绑一个编译不过），所以这里
   * 加一张分类页而不写正文，红在编译器而不是红在访客看到的空页上。
   *
   * ⚠️ **`labelKey` / `headingKey` 复用 `site.help.module.*`**，不另起一套分类名 ——
   * 否则「同步与账号」在 hub 上叫这个、在分类页的 `<h1>` 上叫那个，
   * 而访客要找的是同一件事。这一层只新增引言与 `<title>` 两条文案。
   *
   * 🔴 `inNav: false` + `inFooter: false` **不是孤立路由**（N2 会判红那种）：
   * 分类页被**每一篇文章的侧栏分组标题**链住，也被帮助中心那一节的标题链住 ——
   * 两处都是从注册表派生的链接，而 N2 判据是从渲染出的 DOM 里走真实 href。
   */
  {
    id: 'start',
    path: '/docs/start',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'category',
    labelKey: 'site.help.module.start',
    headingKey: 'site.help.module.start',
    ledeKey: 'site.docs.cat.start.sum',
    titleKey: 'site.docs.cat.start.seo.title',
    descriptionKey: 'site.docs.cat.start.sum',
  },
  {
    id: 'sync',
    path: '/docs/sync',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'category',
    labelKey: 'site.help.module.sync',
    headingKey: 'site.help.module.sync',
    ledeKey: 'site.docs.cat.sync.sum',
    titleKey: 'site.docs.cat.sync.seo.title',
    descriptionKey: 'site.docs.cat.sync.sum',
  },
  {
    id: 'organize',
    path: '/docs/organize',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'category',
    labelKey: 'site.help.module.organize',
    headingKey: 'site.help.module.organize',
    ledeKey: 'site.docs.cat.organize.sum',
    titleKey: 'site.docs.cat.organize.seo.title',
    descriptionKey: 'site.docs.cat.organize.sum',
  },
  {
    id: 'data',
    path: '/docs/data',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'category',
    labelKey: 'site.help.module.data',
    headingKey: 'site.help.module.data',
    ledeKey: 'site.docs.cat.data.sum',
    titleKey: 'site.docs.cat.data.seo.title',
    descriptionKey: 'site.docs.cat.data.sum',
  },
  {
    id: 'trust',
    path: '/docs/trust',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'category',
    labelKey: 'site.help.module.trust',
    headingKey: 'site.help.module.trust',
    ledeKey: 'site.docs.cat.trust.sum',
    titleKey: 'site.docs.cat.trust.seo.title',
    descriptionKey: 'site.docs.cat.trust.sum',
  },
  /**
   * ─────────────────────────────────────────────────────────────────────
   * 文档中心 —— `/help` 的第二层深度。**十四条文章路由，十四条都注册在这里**
   * （start 2 / sync 4 / organize 3 / data 3 / trust 2，每个分类都 ≥ 2 篇）。
   *
   * 🔴 **这一段的顺序就是阅读顺序，而且是唯一一份顺序**：侧栏分组里的排列、
   * 帮助中心卡片组的排列、以及配图图号里的"第几章"（`图 <文章注册序>-<n>`）
   * 全部从它派生。想调顺序**只改这里**，改一处三处跟着走；
   * 在别处再排一次就是第二份清单 —— 它会忘记自己已经过时。
   *
   * 🔴 **判据是 `docsKind: 'article'`，不是另列一份 id 清单。** "什么算一篇文章"
   * 由这一层标记**决定**（`docs.ts` 仍用 `Extract` 从 `SITE_PAGES` 反向取出这个联合，
   * 所以 id 清单**还是只有一份**），加一篇文章 = 在这里加一条 + 在 `docs.ts`
   * 给它写正文，**不存在第三份清单**。第三份清单是漂移的起点：它会忘记自己已经过时。
   * ⚠️ 以前这条判据是"`path` 以 `/help/` 开头"，而分类页也是 —— 形状判据会把
   * 它一起捞进"必须有正文"的那一批。见上面 `SitePage.docsKind`。
   *
   * ⚠️ 这里只写**结构**（路径、五个词条 key、归属哪个分组），
   * 正文（`SectionSpec`）住在 `docs.ts` —— 与 `/features`、`/platforms` 的
   * 正文住在 `content.ts` 是同一个分工。
   *
   * 🔴 `inNav: false` + `inFooter: false` **不是"孤立路由"**（N2 会判红那种）：
   * 文章由帮助中心的**卡片**与文档侧栏**链住**，两处都是从这份注册表派生的。
   * 不进顶部导航的理由是容量 —— 十四条同类链接会把导航挤成一列侧栏，
   * 而侧栏在这一层是**文章内的地图**，不是站点级的。
   * 代偿是 `navActiveId: 'help'`：顶部导航仍然亮着「帮助」。
   *
   * 每条 key 都**逐字写出来**（不拼 `` `site.docs.${id}.title```）：模板字面量
   * 表达式的类型是 `string`，拼出来的 key 会绕过 `MessageKey` 检查 ——
   * 而"词条 key 拼错"在这套派生结构里恰恰是唯一会**静默**失败的地方
   * （渲染时回落成 key 本身，中英两版同时变成 `site.docs.how.title`）。
   */
  {
    id: 'first-run',
    path: '/docs/first-run',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.first-run.title',
    headingKey: 'site.docs.first-run.title',
    ledeKey: 'site.docs.first-run.sum',
    titleKey: 'site.docs.first-run.seo.title',
    descriptionKey: 'site.docs.first-run.sum',
  },
  {
    id: 'concepts',
    path: '/docs/concepts',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.concepts.title',
    headingKey: 'site.docs.concepts.title',
    ledeKey: 'site.docs.concepts.sum',
    titleKey: 'site.docs.concepts.seo.title',
    descriptionKey: 'site.docs.concepts.sum',
  },
  {
    id: 'how',
    path: '/docs/how',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.how.title',
    headingKey: 'site.docs.how.title',
    ledeKey: 'site.docs.how.sum',
    titleKey: 'site.docs.how.seo.title',
    descriptionKey: 'site.docs.how.sum',
  },
  {
    id: 'account',
    path: '/docs/account',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.account.title',
    headingKey: 'site.docs.account.title',
    ledeKey: 'site.docs.account.sum',
    titleKey: 'site.docs.account.seo.title',
    descriptionKey: 'site.docs.account.sum',
  },
  {
    id: 'passphrase',
    path: '/docs/passphrase',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.passphrase.title',
    headingKey: 'site.docs.passphrase.title',
    ledeKey: 'site.docs.passphrase.sum',
    titleKey: 'site.docs.passphrase.seo.title',
    descriptionKey: 'site.docs.passphrase.sum',
  },
  {
    id: 'conflict',
    path: '/docs/conflict',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.conflict.title',
    headingKey: 'site.docs.conflict.title',
    ledeKey: 'site.docs.conflict.sum',
    titleKey: 'site.docs.conflict.seo.title',
    descriptionKey: 'site.docs.conflict.sum',
  },
  {
    id: 'views',
    path: '/docs/views',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.views.title',
    headingKey: 'site.docs.views.title',
    ledeKey: 'site.docs.views.sum',
    titleKey: 'site.docs.views.seo.title',
    descriptionKey: 'site.docs.views.sum',
  },
  {
    id: 'repeat',
    path: '/docs/repeat',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.repeat.title',
    headingKey: 'site.docs.repeat.title',
    ledeKey: 'site.docs.repeat.sum',
    titleKey: 'site.docs.repeat.seo.title',
    descriptionKey: 'site.docs.repeat.sum',
  },
  {
    id: 'reminders',
    path: '/docs/reminders',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.reminders.title',
    headingKey: 'site.docs.reminders.title',
    ledeKey: 'site.docs.reminders.sum',
    titleKey: 'site.docs.reminders.seo.title',
    descriptionKey: 'site.docs.reminders.sum',
  },
  {
    id: 'selfhost',
    path: '/docs/selfhost',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.selfhost.title',
    headingKey: 'site.docs.selfhost.title',
    ledeKey: 'site.docs.selfhost.sum',
    titleKey: 'site.docs.selfhost.seo.title',
    descriptionKey: 'site.docs.selfhost.sum',
  },
  {
    id: 'transfer',
    path: '/docs/transfer',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.transfer.title',
    headingKey: 'site.docs.transfer.title',
    ledeKey: 'site.docs.transfer.sum',
    titleKey: 'site.docs.transfer.seo.title',
    descriptionKey: 'site.docs.transfer.sum',
  },
  {
    id: 'trash',
    path: '/docs/trash',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.trash.title',
    headingKey: 'site.docs.trash.title',
    ledeKey: 'site.docs.trash.sum',
    titleKey: 'site.docs.trash.seo.title',
    descriptionKey: 'site.docs.trash.sum',
  },
  {
    id: 'privacy',
    path: '/docs/privacy',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.privacy.title',
    headingKey: 'site.docs.privacy.title',
    ledeKey: 'site.docs.privacy.sum',
    titleKey: 'site.docs.privacy.seo.title',
    descriptionKey: 'site.docs.privacy.sum',
  },
  {
    id: 'loss',
    path: '/docs/loss',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    docsKind: 'article',
    labelKey: 'site.docs.loss.title',
    headingKey: 'site.docs.loss.title',
    ledeKey: 'site.docs.loss.sum',
    titleKey: 'site.docs.loss.seo.title',
    descriptionKey: 'site.docs.loss.sum',
  },
  {
    id: 'legal-terms',
    path: '/legal/terms',
    group: 'legal',
    inNav: false,
    inFooter: true,
    legalDocId: 'terms',
    labelKey: 'site.footer.legal.terms',
    headingKey: 'site.legal.terms.title',
    ledeKey: 'site.legal.terms.lede',
    titleKey: 'site.legal.terms.seo.title',
    descriptionKey: 'site.legal.terms.seo.description',
  },
  {
    id: 'legal-privacy',
    path: '/legal/privacy',
    group: 'legal',
    inNav: false,
    inFooter: true,
    legalDocId: 'privacy',
    labelKey: 'site.footer.legal.privacy',
    headingKey: 'site.legal.privacy.title',
    ledeKey: 'site.legal.privacy.lede',
    titleKey: 'site.legal.privacy.seo.title',
    descriptionKey: 'site.legal.privacy.seo.description',
  },
  {
    id: 'legal-personal-info-list',
    path: '/legal/personal-info-list',
    group: 'legal',
    inNav: false,
    inFooter: true,
    legalDocId: 'personal-info-list',
    labelKey: 'site.footer.legal.personal-info-list',
    headingKey: 'site.legal.personal-info-list.title',
    ledeKey: 'site.legal.personal-info-list.lede',
    titleKey: 'site.legal.personal-info-list.seo.title',
    descriptionKey: 'site.legal.personal-info-list.seo.description',
  },
  {
    id: 'legal-permissions',
    path: '/legal/permissions',
    group: 'legal',
    inNav: false,
    inFooter: true,
    legalDocId: 'permissions',
    labelKey: 'site.footer.legal.permissions',
    headingKey: 'site.legal.permissions.title',
    ledeKey: 'site.legal.permissions.lede',
    titleKey: 'site.legal.permissions.seo.title',
    descriptionKey: 'site.legal.permissions.seo.description',
  },
  {
    id: 'legal-third-parties',
    path: '/legal/third-parties',
    group: 'legal',
    inNav: false,
    inFooter: true,
    legalDocId: 'third-parties',
    labelKey: 'site.footer.legal.third-parties',
    headingKey: 'site.legal.third-parties.title',
    ledeKey: 'site.legal.third-parties.lede',
    titleKey: 'site.legal.third-parties.seo.title',
    descriptionKey: 'site.legal.third-parties.seo.description',
  },
  {
    id: 'legal-ai-and-transfer',
    path: '/legal/ai-and-transfer',
    group: 'legal',
    inNav: false,
    inFooter: true,
    legalDocId: 'ai-and-transfer',
    labelKey: 'site.footer.legal.ai-and-transfer',
    headingKey: 'site.legal.ai-and-transfer.title',
    ledeKey: 'site.legal.ai-and-transfer.lede',
    titleKey: 'site.legal.ai-and-transfer.seo.title',
    descriptionKey: 'site.legal.ai-and-transfer.seo.description',
  },
  {
    id: 'legal-minors',
    path: '/legal/minors',
    group: 'legal',
    inNav: false,
    inFooter: true,
    legalDocId: 'minors',
    labelKey: 'site.footer.legal.minors',
    headingKey: 'site.legal.minors.title',
    ledeKey: 'site.legal.minors.lede',
    titleKey: 'site.legal.minors.seo.title',
    descriptionKey: 'site.legal.minors.seo.description',
  },
  {
    id: 'legal-subscription-refund',
    path: '/legal/subscription-refund',
    group: 'legal',
    inNav: false,
    inFooter: true,
    legalDocId: 'subscription-refund',
    labelKey: 'site.footer.legal.subscription-refund',
    headingKey: 'site.legal.subscription-refund.title',
    ledeKey: 'site.legal.subscription-refund.lede',
    titleKey: 'site.legal.subscription-refund.seo.title',
    descriptionKey: 'site.legal.subscription-refund.seo.description',
  },
  {
    id: 'legal-data-rights',
    path: '/legal/data-rights',
    group: 'legal',
    inNav: false,
    inFooter: true,
    legalDocId: 'data-rights',
    labelKey: 'site.footer.legal.data-rights',
    headingKey: 'site.legal.data-rights.title',
    ledeKey: 'site.legal.data-rights.lede',
    titleKey: 'site.legal.data-rights.seo.title',
    descriptionKey: 'site.legal.data-rights.seo.description',
  },
] as const satisfies readonly SitePage[];

/**
 * 九份对外法律文本的页面清单（页脚 legal 组与 `docRef` 解析都从这里取）。
 *
 * 🔴 **URL 里那一段就是 `@heyta/legal` 的文档 id，而且它一旦发布就是承诺。**
 * 这些地址会被写进：应用内「设置 → 关于」的链接、注册时勾选条款的那条链接、
 * 各应用商店的隐私政策字段、以及工信部备案材料。改版时**只改文档内容
 * 与 `version`，不改 `path`** —— 换 URL 等于把已经发出去的所有引用作废，
 * 而商店与备案表格里那一行没有人会替我们回来改。
 */
export type LegalSitePage = SitePage & { readonly legalDocId: string };

/**
 * ⚠️ 过滤前先**拓宽成 `readonly SitePage[]`**，不能直接对 `SITE_PAGES` 用
 * 类型谓词：注册表是 `as const`，它的元素类型是**三十二条字面量形状**的联合，
 * 而谓词的类型必须能赋给它 —— `SitePage & {legalDocId}` 里那个 `id: string`
 * 对不上 `id: 'loss'`，编译期直接报 TS2677（实测）。
 * 拓宽之后谓词只需要是 `SitePage` 的子型，同时 `filter` 的返回值就是
 * 精确的 `LegalSitePage[]` —— 不需要任何断言。
 */
const ALL_PAGES: readonly SitePage[] = SITE_PAGES;

export const LEGAL_PAGES = ALL_PAGES.filter(
  (page): page is LegalSitePage => page.legalDocId !== undefined,
);

/** 「文档 id → 站点页面」。`docRef` 块靠它把引用解析成同语言的站内地址。 */
export function legalPageByDocId(docId: string): LegalSitePage | undefined {
  return LEGAL_PAGES.find((page) => page.legalDocId === docId);
}

/**
 * 编译期兜底：`SITE_PAGES` 里漏了 `SitePage` 的字段、或写错类型，这里会报错。
 *
 * ⚠️ 这条断言的意义不是"类型安全"那么抽象 —— 它是**加页面时最容易漏的东西**
 * （词条 key 拼错、忘了 `inNav`）在**编译期**而不是"上线后发现导航里没有它"时暴露。
 */
type AllPagesAreWellFormed = (typeof SITE_PAGES)[number] extends SitePage ? true : never;
const allPagesAreWellFormed: AllPagesAreWellFormed = true;
void allPagesAreWellFormed;

/**
 * 注册表里**真实存在**的那些页面 —— 一个具体页面的联合类型，
 * 不是宽泛的 `SitePage`。
 *
 * 🔴 差别在 `id`：`SitePage.id` 是 `string`（注册表的元素类型要允许新页面），
 * 而 `RegisteredSitePage.id` 是那七个字面量的联合。后端凡是"只会返回注册表
 * 里某一项"的函数（`pageById` / `pageFromPath`）都该返回这个类型 ——
 * 于是"用这个 id 去查 `PAGE_COMPONENTS`"不需要任何断言，
 * 而**写错 id** 是编译期错误。
 */
export type RegisteredSitePage = (typeof SITE_PAGES)[number];

/** 按 `id` 取页面。**找不到就抛** —— 找不到说明代码写错了，不该静默回落。 */
export function pageById(id: SitePageId): RegisteredSitePage {
  const found = SITE_PAGES.find((page) => page.id === id);
  if (found === undefined) {
    throw new Error(
      `站点注册表里没有页面 "${id}"。加页面要改 src/site/pages.ts（见该文件头）。`,
    );
  }
  return found;
}

/**
 * 全部页面 id 的联合类型。
 *
 * 🔴 它的用处只有一个，但很关键：`PAGE_COMPONENTS` 那张"id → 组件"的映射表
 * 用 `Record<SitePageId, …>` 声明，于是**往注册表里加一条、却忘了写页面组件**
 * 是**编译期**报错，而不是上线后发现在浏览器里是一片空白。
 */
export type SitePageId = (typeof SITE_PAGES)[number]['id'];

/** 导航项。顺序即 `SITE_PAGES` 的顺序。 */
export function navPages(): readonly SitePage[] {
  return SITE_PAGES.filter((page) => page.inNav);
}

/**
 * 页脚分组。**空组不出现** —— 一个只有标题没有链接的分组看起来像渲染坏了。
 */
export function footerGroups(): readonly { group: SiteGroup; pages: readonly SitePage[] }[] {
  const order: readonly SiteGroup[] = ['product', 'support', 'legal'];
  return order
    .map((group) => ({
      group,
      pages: SITE_PAGES.filter((page) => page.inFooter && page.group === group),
    }))
    .filter((entry) => entry.pages.length > 0);
}

/**
 * Vite 的多入口映射：`{ 'features': 'features/index.html', 'en/features': ... }`。
 *
 * 🔴 **构建配置也从注册表派生** —— 手写 `input` 的话，加页面时忘了改这里，
 * 结果是"页面组件写好了、HTML 生成了、但构建产物里根本没有它"，
 * 而表现是线上 404（或更糟：SPA 兜底返回首页）。
 */
export function viteInputEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const page of SITE_PAGES) {
    // 🔴 语言清单来自 `@heyta/i18n` 的 `LOCALES`，不在这里再写一遍
    // `['zh-CN', 'en']`（R9）—— 加第三种语言时，抄的那份不会跟着变，
    // 而它的表现是"新语言没有入口文件"，只在线上 404 时才被发现。
    for (const locale of LOCALES) {
      const dir = entryDir(page, locale);
      // Vite 的键名决定输出路径。中文版用页面路径，英文版加 `en/` 前缀。
      entries[dir === '' ? 'main' : dir] = `${dir === '' ? '' : `${dir}/`}index.html`;
    }
  }
  return entries;
}

/** 某个页面在某个语言下的入口目录（相对站点根，末尾无斜杠；首页为 `''`）。 */
export function entryDir(page: SitePage, locale: Locale): string {
  const segments = page.path.split('/').filter((s) => s !== '');
  const base = locale === 'en' ? ['en', ...segments] : segments;
  return base.join('/');
}

/**
 * 构建产物里的 URL 路径（相对站点根，**带前后斜杠**）。
 *
 * 与 `entryDir` 分开是因为两者**不总是相同**：首页的 `entryDir` 是 `''`（写文件用），
 * 而它的 URL 是 `/`（链接、canonical、sitemap 用）。把两者合成一个函数，
 * 就必然要在某个调用点补一个 `|| '/'`，而那个补丁会被漏掉一次。
 */
export function hrefPath(page: SitePage, locale: Locale): string {
  const dir = entryDir(page, locale);
  return dir === '' ? '/' : `/${dir}/`;
}
