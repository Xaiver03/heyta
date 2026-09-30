/**
 * 文档中心 —— 帮助中心的**第二层深度**
 * =========================================
 *
 * 🔴 **这一层只有两样东西：分组归属与正文。** 文章**本身**（路径、五个词条 key）
 * 是注册表条目，住在 [`pages.ts`](./pages.ts)。这里不重复登记它们，
 * 只按 id 挂上"归哪个分类"和"正文由哪些分区组成"。
 *
 * 为什么这样切：**一篇文章需要的一切都是注册表给的** —— 入口 HTML、
 * `<title>`/description、canonical、hreflang、sitemap、语言切换器的落点、
 * 以及"没有孤立路由"那条判据（N2）。要是文档站另立一张路由表，那张表就得
 * 把这六件事各 reimplement 一遍，而"文档站有一套自己的入口生成"恰恰是
 * 漂移开始的地方（SSOS 那套 91 页的文档站之所以只有一份 `sidebar.js`，
 * 是同一个理由）。
 *
 * 被三处读取：
 *   1. `DocsArticlePage.tsx` 取这一篇的分区清单去渲染；
 *   2. `DocsNav.tsx` 用它画侧栏；
 *   3. `HelpPage.tsx` 用它画帮助中心首页上那一组卡片。
 *
 * ⚠️ 它**不在** `gen-entries.mjs` 的运行时图上（生成器只读 `pages.ts` 与
 * `content.ts` 的派生值），所以本文件可以正常相对导入 —— 与 `pages.ts`
 * 那条"不许有相对运行时导入"的约束无关。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * **IA 是怎么定的（对标 SSOS 帮助中心后的结论）**
 *
 * 🔴 **分组词表一个新词都没造，也没有再列一遍。** 五个分类就是
 * `content.ts` 里 `HELP_MODULES` 那五个 id（start / sync / organize / data / trust），
 * 由 `HelpModuleId` 这个字面量联合钉住：这里若写一个不存在的分类，**编译期就红**。
 *
 * 这是这一轮改造里最值钱的一条约束。帮助中心与文档中心若是**两个中心**，
 * 就会有两套分类名，然后开始漂移（"同步"在一处叫「同步与账号」、在另一处叫
 * 「多设备」，而访客要找的是同一件事）。现在它们是**同一个 IA 的两层深度**：
 * 速答在前（读完就能用）、深读在后（读完还愿意往下走的人看这个），共用一套分组。
 *
 * ⚠️ **只有两个分类下有文章**（sync 四篇、data 两篇），另外三个只放速答。
 * 这不是留空位：`/features` 那条内容纪律同样适用于导航 ——
 * **没有内容就不许出现链接**，所以空分类不渲染卡片，只渲染它自己的问题。
 */

import type { HelpModule, HelpModuleId } from './content.js';
import { HELP_MODULES } from './content.js';
import type { SectionSpec } from './PageSections.js';
import { SITE_PAGES } from './pages.js';

/** 文章路由的形状：`/help/<id>`。这一条形状**就是**"什么算一篇文章"的判据。 */
const DOCS_PATH_PREFIX = '/help/';

/**
 * 注册表里那些"是文章"的页面。
 *
 * 🔴 用模板字面量类型 `Extract` 出来而不是再抄一份 id 清单，是为了**消灭第三份清单**：
 * 抄的那份会忘记自己已经过时，而这里加一篇文章若忘了配正文，
 * `DOCS_ENTRIES`（`Record<DocsArticleId, …>`）会**直接编译不过**。
 * 顺带两个性质：`'/help'` 本身不匹配（它要求还有一段），
 * 以及 id 保持**字面量联合** —— 所以 `SitePageId` 里那六个新 id 仍在，
 * "注册了页面却没写组件"那道拦截继续有效。
 */
type ArticlePage = Extract<(typeof SITE_PAGES)[number], { path: `${typeof DOCS_PATH_PREFIX}${string}` }>;

/** 文档中心全部文章的 id —— 从注册表派生，不是这里声明的。 */
export type DocsArticleId = ArticlePage['id'];

/** 一篇文章在文档中心里的那一半信息：归哪个分类、由哪些分区组成。 */
interface DocsEntry {
  /** 归属的帮助中心模块（速答与深读共用的那个分类）。 */
  readonly moduleId: HelpModuleId;
  readonly sections: readonly SectionSpec[];
}

/**
 * 一篇文章 = 注册表条目 + 文档中心的这一半。
 *
 * ⚠️ `sections` 复用 `content.ts` 那套 `SectionSpec`（由 `PageSections.tsx` 渲染），
 * 所以文章与 `/features`、`/platforms` 用的是**同一套正文渲染器** ——
 * 分区标题、段落、并列条目、锚点 id 全都同一个形状（N4：不出现两个站点拼起来）。
 */
export type DocsArticle = ArticlePage & DocsEntry;

/**
 * 每篇文档的分组归属与正文。**顺序不在这里决定**（顺序 = 注册表里的顺序），
 * 这里只回答"它属于哪个分类"和"它的正文是什么"。
 *
 * 每条 key 都**逐字写出来**（不拼 `` `site.docs.${id}.s1` ``）：模板字面量表达式
 * 在类型上是 `string`，拼出来的 key 会绕过 `MessageKey` 的检查 —— 而"词条 key 拼错"
 * 恰恰是这套派生结构里唯一会静默失败的地方（渲染时回落成 key 本身）。
 *
 * 顺序从"这是什么原理"排到"我要动手的事"（sync 四篇、data 两篇）。
 */
const DOCS_ENTRIES: Record<DocsArticleId, DocsEntry> = {
  how: {
    moduleId: 'sync',
    sections: [
      {
        id: 'local-first',
        titleKey: 'site.docs.how.s1',
        bodyKeys: ['site.docs.how.s1p1', 'site.docs.how.s1p2', 'site.docs.how.s1p3'],
      },
      {
        id: 'when-it-syncs',
        titleKey: 'site.docs.how.s2',
        bodyKeys: ['site.docs.how.s2p1'],
        itemKeys: ['site.docs.how.s2i1', 'site.docs.how.s2i2', 'site.docs.how.s2i3'],
      },
      {
        id: 'what-the-server-cannot-see',
        titleKey: 'site.docs.how.s3',
        bodyKeys: ['site.docs.how.s3p1', 'site.docs.how.s3p2'],
      },
    ],
  },
  account: {
    moduleId: 'sync',
    sections: [
      {
        id: 'three-fields',
        titleKey: 'site.docs.account.s1',
        bodyKeys: ['site.docs.account.s1p1'],
        itemKeys: [
          'site.docs.account.s1i1',
          'site.docs.account.s1i2',
          'site.docs.account.s1i3',
        ],
      },
      {
        id: 'no-password',
        titleKey: 'site.docs.account.s2',
        bodyKeys: ['site.docs.account.s2p1'],
        itemKeys: [
          'site.docs.account.s2i1',
          'site.docs.account.s2i2',
          'site.docs.account.s2i3',
        ],
      },
      {
        id: 'desktop-shells',
        titleKey: 'site.docs.account.s3',
        bodyKeys: ['site.docs.account.s3p1'],
      },
      {
        id: 'whose-terms',
        titleKey: 'site.docs.account.s4',
        bodyKeys: ['site.docs.account.s4p1'],
      },
    ],
  },
  passphrase: {
    moduleId: 'sync',
    sections: [
      {
        id: 'what-it-is',
        titleKey: 'site.docs.passphrase.s1',
        bodyKeys: ['site.docs.passphrase.s1p1', 'site.docs.passphrase.s1p2'],
      },
      {
        id: 'no-recovery',
        titleKey: 'site.docs.passphrase.s2',
        bodyKeys: ['site.docs.passphrase.s2p1'],
        itemKeys: [
          'site.docs.passphrase.s2i1',
          'site.docs.passphrase.s2i2',
          'site.docs.passphrase.s2i3',
        ],
      },
      {
        id: 'when-it-is-wrong',
        titleKey: 'site.docs.passphrase.s3',
        bodyKeys: ['site.docs.passphrase.s3p1', 'site.docs.passphrase.s3w1'],
      },
    ],
  },
  conflict: {
    moduleId: 'sync',
    sections: [
      {
        id: 'why-they-exist',
        titleKey: 'site.docs.conflict.s1',
        bodyKeys: ['site.docs.conflict.s1p1'],
      },
      {
        id: 'how-it-decides',
        titleKey: 'site.docs.conflict.s2',
        bodyKeys: ['site.docs.conflict.s2p1'],
      },
      {
        id: 'what-you-see',
        titleKey: 'site.docs.conflict.s3',
        bodyKeys: ['site.docs.conflict.s3p1'],
      },
    ],
  },
  selfhost: {
    moduleId: 'data',
    sections: [
      {
        id: 'difficulty',
        titleKey: 'site.docs.selfhost.s1',
        bodyKeys: ['site.docs.selfhost.s1p1'],
        itemKeys: [
          'site.docs.selfhost.s1i1',
          'site.docs.selfhost.s1i2',
          'site.docs.selfhost.s1i3',
          'site.docs.selfhost.s1i4',
        ],
      },
      {
        id: 'what-to-configure',
        titleKey: 'site.docs.selfhost.s2',
        itemKeys: [
          'site.docs.selfhost.s2i1',
          'site.docs.selfhost.s2i2',
          'site.docs.selfhost.s2i3',
          'site.docs.selfhost.s2i4',
        ],
      },
      {
        id: 'full-steps',
        titleKey: 'site.docs.selfhost.s3',
        bodyKeys: ['site.docs.selfhost.s3p1', 'site.docs.selfhost.s3w1'],
      },
    ],
  },
  transfer: {
    moduleId: 'data',
    sections: [
      {
        id: 'export',
        titleKey: 'site.docs.transfer.s1',
        bodyKeys: ['site.docs.transfer.s1p1'],
        itemKeys: [
          'site.docs.transfer.s1i1',
          'site.docs.transfer.s1i2',
          'site.docs.transfer.s1i3',
        ],
      },
      {
        id: 'import',
        titleKey: 'site.docs.transfer.s2',
        bodyKeys: ['site.docs.transfer.s2p1', 'site.docs.transfer.s2w1'],
      },
      {
        id: 'not-only-backups',
        titleKey: 'site.docs.transfer.s3',
        bodyKeys: ['site.docs.transfer.s3p1'],
      },
    ],
  },
};

/** 某个路径是不是文章路由。 */
function isDocsPath(path: string): boolean {
  return path.startsWith(DOCS_PATH_PREFIX);
}

/** 注册表里的全部文章，**顺序即注册表的顺序**（侧栏与卡片都按它排）。 */
function articlePages(): readonly ArticlePage[] {
  return SITE_PAGES.filter((page): page is ArticlePage => isDocsPath(page.path));
}

function toArticle(page: ArticlePage): DocsArticle {
  return { ...page, ...DOCS_ENTRIES[page.id] };
}

/**
 * 按 id 取一篇文章。**找不到就抛** —— 与 `pages.ts` 的 `pageById` 同一条纪律：
 * 走到这里却没找到，说明 `PAGE_COMPONENTS` 里把一篇非文章登记成了
 * `DocsArticlePage`，那是代码写错，静默渲染半页只会让人去查文案。
 *
 * ⚠️ 参数是 `string` 而不是 `DocsArticleId`：页面组件拿到的 `page.id` 在类型上
 * 就是 `string`（注册表的元素类型），调用方没有更窄的信息可给。
 */
export function docsArticleById(id: string): DocsArticle {
  const page = articlePages().find((article) => article.id === id);
  if (page === undefined) {
    throw new Error(
      `"${id}" 不是文档中心的文章。文章要在 src/site/pages.ts 注册且路径以 ${DOCS_PATH_PREFIX} 开头（见该文件头）。`,
    );
  }
  return toArticle(page);
}

/**
 * 某个分类下的全部文章（侧栏与卡片用）。
 *
 * ⚠️ 空数组是**合法且常见**的结果（五个分类里只有两个有文章）——
 * 调用方据此不渲染标题与卡片，而不是显示一个空盒子。
 */
export function docsArticlesOf(moduleId: HelpModuleId): readonly DocsArticle[] {
  return articlePages()
    .filter((page) => DOCS_ENTRIES[page.id].moduleId === moduleId)
    .map(toArticle);
}

/**
 * 全部分类（带各自的文章清单），**顺序与成员都来自 `HELP_MODULES`** ——
 * 帮助中心改一个分类名或调一次顺序，文档侧栏跟着变，不需要在两边各改一遍。
 */
export function docsOutline(): readonly {
  module: HelpModule;
  articles: readonly DocsArticle[];
}[] {
  return HELP_MODULES.map((module) => ({
    module,
    articles: docsArticlesOf(module.id),
  }));
}
