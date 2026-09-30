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
    path: '/help',
    group: 'support',
    inNav: true,
    inFooter: true,
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
   * 文档中心 —— `/help` 的第二层深度。**六条路由，六条都注册在这里。**
   *
   * 🔴 **判据是路径形状，不是另列一份 id 清单。** "什么算一篇文章"由
   * `path` 以 `/help/` 开头**决定**（`docs.ts` 用模板字面量类型从 `SITE_PAGES`
   * 反向取出这个联合），所以加一篇文章 = 在这里加一条 + 在 `docs.ts` 给它写正文，
   * **不存在第三份清单**。第三份清单是漂移的起点：它会忘记自己已经过时。
   *
   * ⚠️ 这里只写**结构**（路径、五个词条 key、归属哪个分组），
   * 正文（`SectionSpec`）住在 `docs.ts` —— 与 `/features`、`/platforms` 的
   * 正文住在 `content.ts` 是同一个分工。
   *
   * 🔴 `inNav: false` + `inFooter: false` **不是"孤立路由"**（N2 会判红那种）：
   * 文章由帮助中心的**卡片**与文档侧栏**链住**，两处都是从这份注册表派生的。
   * 不进顶部导航的理由是容量 —— 六条同类链接会把导航挤成一列侧栏，
   * 而侧栏在这一层是**文章内的地图**，不是站点级的。
   * 代偿是 `navActiveId: 'help'`：顶部导航仍然亮着「帮助」。
   *
   * 每条 key 都**逐字写出来**（不拼 `` `site.docs.${id}.title```）：模板字面量
   * 表达式的类型是 `string`，拼出来的 key 会绕过 `MessageKey` 检查 ——
   * 而"词条 key 拼错"在这套派生结构里恰恰是唯一会**静默**失败的地方
   * （渲染时回落成 key 本身，中英两版同时变成 `site.docs.how.title`）。
   */
  {
    id: 'how',
    path: '/help/how',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    labelKey: 'site.docs.how.title',
    headingKey: 'site.docs.how.title',
    ledeKey: 'site.docs.how.sum',
    titleKey: 'site.docs.how.seo.title',
    descriptionKey: 'site.docs.how.sum',
  },
  {
    id: 'account',
    path: '/help/account',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    labelKey: 'site.docs.account.title',
    headingKey: 'site.docs.account.title',
    ledeKey: 'site.docs.account.sum',
    titleKey: 'site.docs.account.seo.title',
    descriptionKey: 'site.docs.account.sum',
  },
  {
    id: 'passphrase',
    path: '/help/passphrase',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    labelKey: 'site.docs.passphrase.title',
    headingKey: 'site.docs.passphrase.title',
    ledeKey: 'site.docs.passphrase.sum',
    titleKey: 'site.docs.passphrase.seo.title',
    descriptionKey: 'site.docs.passphrase.sum',
  },
  {
    id: 'conflict',
    path: '/help/conflict',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    labelKey: 'site.docs.conflict.title',
    headingKey: 'site.docs.conflict.title',
    ledeKey: 'site.docs.conflict.sum',
    titleKey: 'site.docs.conflict.seo.title',
    descriptionKey: 'site.docs.conflict.sum',
  },
  {
    id: 'selfhost',
    path: '/help/selfhost',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    labelKey: 'site.docs.selfhost.title',
    headingKey: 'site.docs.selfhost.title',
    ledeKey: 'site.docs.selfhost.sum',
    titleKey: 'site.docs.selfhost.seo.title',
    descriptionKey: 'site.docs.selfhost.sum',
  },
  {
    id: 'transfer',
    path: '/help/transfer',
    group: 'support',
    inNav: false,
    inFooter: false,
    navActiveId: 'help',
    labelKey: 'site.docs.transfer.title',
    headingKey: 'site.docs.transfer.title',
    ledeKey: 'site.docs.transfer.sum',
    titleKey: 'site.docs.transfer.seo.title',
    descriptionKey: 'site.docs.transfer.sum',
  },
] as const satisfies readonly SitePage[];

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
