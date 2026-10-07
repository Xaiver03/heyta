/**
 * 文档中心 —— 帮助中心的**第二层深度**（独立文档外壳 /docs）
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
 * ⚠️ **分类页只给"有文章"的分类建**（现在五个都有），其余只放速答。
 * 这不是留空位：`/features` 那条内容纪律同样适用于导航 ——
 * **没有内容就不许出现链接**，所以空分类不渲染卡片、不注册入口。
 * 而"哪几个分类有文章"是**从注册表算出来的**（`docsCategoryById`），不是这里手数的一份清单 ——
 * 手数的清单会在下一篇文章落地时过时，而过时的那一面正好是访客看到的那一面。
 * （正因为这条判据在注册表那一侧，本轮把 start / organize / trust 补满文章之后，
 * 五个分类页才同时成立；少一篇，对应那个入口就不该存在。）
 */

import type { Locale, MessageKey } from '@heyta/i18n/provider';

import type { HelpModule, HelpModuleId } from './content.js';
import { HELP_MODULES } from './content.js';
import { HELP_FIGURES, helpFigureSrc, type HelpFigure } from './helpFigures.js';
import type { SectionSpec } from './PageSections.js';
import type { SitePage } from './pages.js';
import { SITE_PAGES } from './pages.js';

/** 文章路由的形状：`/docs/<id>`。这一条形状**就是**"什么算一篇文章"的判据。 */
const DOCS_PATH_PREFIX = '/docs/';

/**
 * 注册表里那些"是文章"的页面。
 *
 * 🔴 用模板字面量类型 `Extract` 出来而不是再抄一份 id 清单，是为了**消灭第三份清单**：
 * 抄的那份会忘记自己已经过时，而这里加一篇文章若忘了配正文，
 * `DOCS_ENTRIES`（`Record<DocsArticleId, …>`）会**直接编译不过**。
 * 顺带两个性质：`'/docs'` 本身不匹配（它要求还有一段），
 * 以及 id 保持**字面量联合** —— 所以 `SitePageId` 里那六个新 id 仍在，
 * "注册了页面却没写组件"那道拦截继续有效。
 *
 * 🔴 **判据是 `docsKind: 'article'`，路径前缀只是加分项。** 分类页 `/docs/sync`
 * 同样以 `/docs/` 开头 —— 只按形状捞，它会被一起拉进"必须有正文"的那一批，
 * 于是分类页被迫配一份它不该有的 `DOCS_ENTRIES` 条目。形状能区分"文章 vs 其它页"，
 * 区分不了"文章 vs 分类"，所以这里要的是**意图**而不是形状（见 `pages.ts` 的 `SitePage.docsKind`）。
 */
type ArticlePage = Extract<
  (typeof SITE_PAGES)[number],
  { path: `${typeof DOCS_PATH_PREFIX}${string}`; docsKind: 'article' }
>;

/**
 * 注册表里那些"是分类页"的页面。
 *
 * ⚠️ 它**不要求**路径前缀：`docsKind: 'category'` 只在文档中心里出现，写错成
 * `docsKind: 'category'` 的首页会在 `DOCS_CATEGORY_MODULES` 那道 `Record` 上编译不过
 * —— 一个不存在的模块 id 比一条错误的形状更值得拦。
 */
type CategoryPage = Extract<(typeof SITE_PAGES)[number], { docsKind: 'category' }>;

/** 文档中心全部文章的 id —— 从注册表派生，不是这里声明的。 */
export type DocsArticleId = ArticlePage['id'];

/** 文档中心全部分类页的 id —— 同样从注册表派生。 */
export type DocsCategoryId = CategoryPage['id'];

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
 * 阅读顺序**不在这里决定**（在 `pages.ts` 的注册顺序里），这里的 key 顺序只是跟着它排：
 * start 两篇 → sync 四篇 → organize 三篇 → data 三篇 → trust 两篇。
 * 每个分类 ≥2 篇，是因为帮助中心那五个卡片若只有一篇有深读，访客点进去就撞上尽头。
 */
const DOCS_ENTRIES: Record<DocsArticleId, DocsEntry> = {
  'first-run': {
    moduleId: 'start',
    sections: [
      {
        id: 'works-without-account',
        titleKey: 'site.docs.first-run.s1',
        bodyKeys: [
          'site.docs.first-run.s1p1',
          'site.docs.first-run.s1p2',
          'site.docs.first-run.s1p3',
        ],
      },
      {
        id: 'sync-is-opt-in',
        titleKey: 'site.docs.first-run.s2',
        bodyKeys: [
          'site.docs.first-run.s2p1',
          'site.docs.first-run.s2p2',
          'site.docs.first-run.s2p3',
          'site.docs.first-run.s2p4',
        ],
      },
      {
        id: 'device-only-toggles',
        titleKey: 'site.docs.first-run.s3',
        bodyKeys: ['site.docs.first-run.s3p1', 'site.docs.first-run.s3p2'],
        itemKeys: [
          'site.docs.first-run.s3i1',
          'site.docs.first-run.s3i2',
          'site.docs.first-run.s3i3',
        ],
      },
      {
        id: 'first-screen',
        titleKey: 'site.docs.first-run.s4',
        bodyKeys: [
          'site.docs.first-run.s4p1',
          'site.docs.first-run.s4p2',
          'site.docs.first-run.s4p3',
        ],
      },
    ],
  },
  concepts: {
    moduleId: 'start',
    sections: [
      {
        id: 'task-fields',
        titleKey: 'site.docs.concepts.s1',
        bodyKeys: [
          'site.docs.concepts.s1p1',
          'site.docs.concepts.s1p2',
          'site.docs.concepts.s1p3',
        ],
      },
      {
        id: 'lists-one-level',
        titleKey: 'site.docs.concepts.s2',
        bodyKeys: ['site.docs.concepts.s2p1', 'site.docs.concepts.s2p2'],
      },
      {
        id: 'tags',
        titleKey: 'site.docs.concepts.s3',
        bodyKeys: [
          'site.docs.concepts.s3p1',
          'site.docs.concepts.s3p2',
          'site.docs.concepts.s3p3',
        ],
      },
      {
        id: 'habits',
        titleKey: 'site.docs.concepts.s4',
        bodyKeys: [
          'site.docs.concepts.s4p1',
          'site.docs.concepts.s4p2',
          'site.docs.concepts.s4p3',
        ],
      },
      {
        id: 'views-are-not-data',
        titleKey: 'site.docs.concepts.s5',
        bodyKeys: [
          'site.docs.concepts.s5p1',
          'site.docs.concepts.s5p2',
          'site.docs.concepts.s5p3',
        ],
      },
    ],
  },
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
      {
        id: 'sync-failure',
        titleKey: 'site.docs.how.s4',
        bodyKeys: [
          'site.docs.how.s4p1',
          'site.docs.how.s4p2',
          'site.docs.how.s4p3',
          'site.docs.how.s4p4',
        ],
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
        // 🔴 这一节过去叫 `no-password`。它管的是"三条登录方式"，而产品的主路
        // 恰恰是邮箱 + 口令 —— 于是**锚点本身**在对访客说一件不成立的事
        // （它出现在 URL 和目录里）。2026-10-03 改成中性名。
        id: 'ways-to-sign-in',
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
      {
        // 从站点 `/signin` 那一页搬进来的（2026-10-03）：那里只留能点的出口，
        // "为什么登录不在网站上"是一段**说明**，说明的归处是文档中心。
        id: 'why-in-app',
        titleKey: 'site.docs.account.s5',
        bodyKeys: ['site.docs.account.s5p1'],
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
  views: {
    moduleId: 'organize',
    sections: [
      {
        id: 'quadrant',
        titleKey: 'site.docs.views.s1',
        bodyKeys: [
          'site.docs.views.s1p1',
          'site.docs.views.s1p2',
          'site.docs.views.s1p3',
        ],
      },
      {
        id: 'calendar',
        titleKey: 'site.docs.views.s2',
        bodyKeys: ['site.docs.views.s2p1', 'site.docs.views.s2p2'],
      },
      {
        id: 'timeline',
        titleKey: 'site.docs.views.s3',
        bodyKeys: [
          'site.docs.views.s3p1',
          'site.docs.views.s3p2',
          'site.docs.views.s3p3',
        ],
      },
      {
        id: 'search',
        titleKey: 'site.docs.views.s4',
        bodyKeys: [
          'site.docs.views.s4p1',
          'site.docs.views.s4p2',
          'site.docs.views.s4p3',
        ],
      },
      {
        id: 'modules-off-are-gone',
        titleKey: 'site.docs.views.s5',
        bodyKeys: ['site.docs.views.s5p1', 'site.docs.views.s5p2'],
      },
    ],
  },
  repeat: {
    moduleId: 'organize',
    sections: [
      {
        id: 'standard-rrule',
        titleKey: 'site.docs.repeat.s1',
        bodyKeys: [
          'site.docs.repeat.s1p1',
          'site.docs.repeat.s1p2',
          'site.docs.repeat.s1p3',
        ],
      },
      {
        id: 'advance-baseline',
        titleKey: 'site.docs.repeat.s2',
        bodyKeys: [
          'site.docs.repeat.s2p1',
          'site.docs.repeat.s2p2',
          'site.docs.repeat.s2p3',
          'site.docs.repeat.s2p4',
        ],
      },
      {
        id: 'when-the-rule-ends',
        titleKey: 'site.docs.repeat.s3',
        bodyKeys: ['site.docs.repeat.s3p1', 'site.docs.repeat.s3p2'],
      },
      {
        id: 'which-platforms',
        titleKey: 'site.docs.repeat.s4',
        bodyKeys: ['site.docs.repeat.s4p1', 'site.docs.repeat.s4w1'],
      },
    ],
  },
  reminders: {
    moduleId: 'organize',
    sections: [
      {
        id: 'not-a-toggle',
        titleKey: 'site.docs.reminders.s1',
        bodyKeys: [
          'site.docs.reminders.s1p1',
          'site.docs.reminders.s1p2',
          'site.docs.reminders.s1p3',
        ],
      },
      {
        id: 'when-it-fires',
        titleKey: 'site.docs.reminders.s2',
        bodyKeys: [
          'site.docs.reminders.s2p1',
          'site.docs.reminders.s2p2',
          'site.docs.reminders.s2p3',
          'site.docs.reminders.s2p4',
        ],
        itemKeys: [
          'site.docs.reminders.s2i1',
          'site.docs.reminders.s2i2',
          'site.docs.reminders.s2i3',
        ],
      },
      {
        id: 'follows-the-repeat',
        titleKey: 'site.docs.reminders.s3',
        bodyKeys: [
          'site.docs.reminders.s3p1',
          'site.docs.reminders.s3p2',
          'site.docs.reminders.s3p3',
        ],
      },
      {
        id: 'the-bell-is-not-a-reminder',
        titleKey: 'site.docs.reminders.s4',
        bodyKeys: ['site.docs.reminders.s4p1', 'site.docs.reminders.s4p2'],
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
        id: 'install-and-update',
        titleKey: 'site.docs.selfhost.s7',
        bodyKeys: [
          'site.docs.selfhost.s7p1',
          'site.docs.selfhost.s7p2',
          'site.docs.selfhost.s7p3',
        ],
        itemKeys: [
          'site.docs.selfhost.s7i1',
          'site.docs.selfhost.s7i2',
        ],
      },
      {
        id: 'environment-variables',
        titleKey: 'site.docs.selfhost.s8',
        bodyKeys: ['site.docs.selfhost.s8p1'],
        itemKeys: [
          'site.docs.selfhost.s8i1',
          'site.docs.selfhost.s8i2',
          'site.docs.selfhost.s8i3',
          'site.docs.selfhost.s8i4',
          'site.docs.selfhost.s8i5',
          'site.docs.selfhost.s8i6',
          'site.docs.selfhost.s8i7',
        ],
      },
      {
        id: 'database-and-migrations',
        titleKey: 'site.docs.selfhost.s9',
        bodyKeys: [
          'site.docs.selfhost.s9p1',
          'site.docs.selfhost.s9p2',
          'site.docs.selfhost.s9p3',
        ],
      },
      {
        id: 'what-the-server-stores',
        titleKey: 'site.docs.selfhost.s10',
        bodyKeys: [
          'site.docs.selfhost.s10p1',
          'site.docs.selfhost.s10p2',
          'site.docs.selfhost.s10p3',
        ],
      },
      {
        id: 'daily-work',
        titleKey: 'site.docs.selfhost.s4',
        bodyKeys: [
          'site.docs.selfhost.s4p1',
          'site.docs.selfhost.s4p2',
          'site.docs.selfhost.s4p3',
        ],
      },
      {
        id: 'backup-is-ciphertext',
        titleKey: 'site.docs.selfhost.s5',
        bodyKeys: [
          'site.docs.selfhost.s5p1',
          'site.docs.selfhost.s5p2',
          'site.docs.selfhost.s5w1',
        ],
      },
      {
        id: 'why-offline',
        titleKey: 'site.docs.selfhost.s6',
        bodyKeys: ['site.docs.selfhost.s6p1', 'site.docs.selfhost.s6p2'],
        itemKeys: ['site.docs.selfhost.s6i1'],
      },
      {
        id: 'command-line-host',
        titleKey: 'site.docs.selfhost.s11',
        bodyKeys: ['site.docs.selfhost.s11p1'],
        itemKeys: [
          'site.docs.selfhost.s11i1',
          'site.docs.selfhost.s11i2',
          'site.docs.selfhost.s11i3',
          'site.docs.selfhost.s11i4',
        ],
      },
      {
        id: 'full-steps',
        titleKey: 'site.docs.selfhost.s3',
        bodyKeys: ['site.docs.selfhost.s3p1', 'site.docs.selfhost.s3w1'],
      },
    ],
  },
  automation: {
    moduleId: 'data',
    sections: [
      {
        id: 'ai-capture-today',
        titleKey: 'site.docs.automation.s1',
        bodyKeys: ['site.docs.automation.s1p1', 'site.docs.automation.s1p2'],
      },
      {
        id: 'local-api-mcp',
        titleKey: 'site.docs.automation.s2',
        bodyKeys: [
          'site.docs.automation.s2p1',
          'site.docs.automation.s2p2',
          'site.docs.automation.s2p3',
        ],
      },
      {
        id: 'planned-webhook',
        titleKey: 'site.docs.automation.s3',
        bodyKeys: [
          'site.docs.automation.s3p1',
          'site.docs.automation.s3p2',
          'site.docs.automation.s3p3',
        ],
      },
      {
        id: 'scenarios',
        titleKey: 'site.docs.automation.s4',
        itemKeys: [
          'site.docs.automation.s4i1',
          'site.docs.automation.s4i2',
          'site.docs.automation.s4i3',
          'site.docs.automation.s4i4',
          'site.docs.automation.s4i5',
          'site.docs.automation.s4i6',
          'site.docs.automation.s4i7',
          'site.docs.automation.s4i8',
        ],
      },
      {
        id: 'privacy-boundary',
        titleKey: 'site.docs.automation.s5',
        bodyKeys: ['site.docs.automation.s5p1', 'site.docs.automation.s5p2'],
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
        id: 'diy-current',
        titleKey: 'site.docs.transfer.diyTitle',
        bodyKeys: ['site.docs.transfer.diyCurrent', 'site.docs.transfer.diyApi'],
      },
      {
        id: 'not-only-backups',
        titleKey: 'site.docs.transfer.s3',
        bodyKeys: ['site.docs.transfer.s3p1'],
      },
      {
        id: 'two-routes',
        titleKey: 'site.docs.transfer.s4',
        bodyKeys: ['site.docs.transfer.s4p1', 'site.docs.transfer.s4p2'],
      },
      {
        id: 'why-empty-only',
        titleKey: 'site.docs.transfer.s5',
        bodyKeys: [
          'site.docs.transfer.s5p1',
          'site.docs.transfer.s5p2',
          'site.docs.transfer.s5w1',
        ],
      },
      {
        id: 'check-after-restore',
        titleKey: 'site.docs.transfer.s6',
        bodyKeys: ['site.docs.transfer.s6p1', 'site.docs.transfer.s6p2'],
        itemKeys: ['site.docs.transfer.s6i1'],
      },
    ],
  },
  trash: {
    moduleId: 'data',
    sections: [
      {
        id: 'what-the-trash-holds',
        titleKey: 'site.docs.trash.s1',
        bodyKeys: ['site.docs.trash.s1p1', 'site.docs.trash.s1p2', 'site.docs.trash.s1p3'],
        itemKeys: [
          'site.docs.trash.s1i1',
          'site.docs.trash.s1i2',
          'site.docs.trash.s1i3',
        ],
      },
      {
        id: 'what-restore-changes',
        titleKey: 'site.docs.trash.s2',
        bodyKeys: [
          'site.docs.trash.s2p1',
          'site.docs.trash.s2p2',
          'site.docs.trash.s2p3',
        ],
      },
      {
        id: 'why-nothing-is-erased',
        titleKey: 'site.docs.trash.s3',
        bodyKeys: [
          'site.docs.trash.s3p1',
          'site.docs.trash.s3p2',
          'site.docs.trash.s3p3',
          'site.docs.trash.s3w1',
        ],
      },
      {
        id: 'what-it-means-for-backups',
        titleKey: 'site.docs.trash.s4',
        bodyKeys: [
          'site.docs.trash.s4p1',
          'site.docs.trash.s4p2',
          'site.docs.trash.s4p3',
        ],
      },
    ],
  },
  privacy: {
    moduleId: 'trust',
    sections: [
      {
        id: 'what-local-first-covers',
        titleKey: 'site.docs.privacy.s1',
        bodyKeys: ['site.docs.privacy.s1p1', 'site.docs.privacy.s1p2'],
      },
      {
        id: 'sync-uploads',
        titleKey: 'site.docs.privacy.s2',
        bodyKeys: [
          'site.docs.privacy.s2p1',
          'site.docs.privacy.s2p2',
          'site.docs.privacy.s2p3',
        ],
      },
      {
        id: 'local-api-and-mcp',
        titleKey: 'site.docs.privacy.s3',
        bodyKeys: [
          'site.docs.privacy.s3p1',
          'site.docs.privacy.s3p2',
          'site.docs.privacy.s3p3',
        ],
      },
      {
        id: 'outbound-ai',
        titleKey: 'site.docs.privacy.s4',
        bodyKeys: [
          'site.docs.privacy.s4p1',
          'site.docs.privacy.s4p2',
          'site.docs.privacy.s4p3',
        ],
      },
      {
        id: 'email',
        titleKey: 'site.docs.privacy.s5',
        bodyKeys: ['site.docs.privacy.s5p1', 'site.docs.privacy.s5p2'],
      },
      {
        id: 'open-source-is-not-trust',
        titleKey: 'site.docs.privacy.s6',
        bodyKeys: ['site.docs.privacy.s6p1'],
      },
    ],
  },
  loss: {
    moduleId: 'trust',
    sections: [
      {
        id: 'lost-device',
        titleKey: 'site.docs.loss.s1',
        bodyKeys: ['site.docs.loss.s1p1', 'site.docs.loss.s1p2'],
      },
      {
        id: 'lost-passkey',
        titleKey: 'site.docs.loss.s2',
        bodyKeys: [
          'site.docs.loss.s2p1',
          'site.docs.loss.s2p2',
          'site.docs.loss.s2p3',
          'site.docs.loss.s2w1',
        ],
      },
      {
        id: 'lost-passphrase',
        titleKey: 'site.docs.loss.s3',
        bodyKeys: [
          'site.docs.loss.s3p1',
          'site.docs.loss.s3p2',
          'site.docs.loss.s3p3',
        ],
      },
      {
        id: 'so-the-order-is',
        titleKey: 'site.docs.loss.s4',
        bodyKeys: [
          'site.docs.loss.s4p1',
          'site.docs.loss.s4p2',
          'site.docs.loss.s4p3',
        ],
      },
    ],
  },
};

/**
 * 分类页 ↔ 帮助中心模块的绑定。**每一条 key 都必须出现**（`Record` 的判据）。
 *
 * 🔴 它存在的意义是拦下两种"结构上对、意义上错"的分类页：
 *   1. 在 `pages.ts` 注册了 `/docs/<某段>` 但这里忘了绑定 —— 编译不过；
 *   2. 绑定了一个 `HelpModuleId` 里不存在的分类 —— 编译不过。
 * 两种的症状都是"页面渲染出来了，但它不属于任何 IA"：侧栏分组与帮助中心的速答
 * 都对不上它，访客从哪儿进来都回不去。让它编译不过，比让它渲染半页强。
 *
 * ⚠️ 这里的 id **必须和文章用的模块一致** —— 一个分类页若绑到自己没有文章的模块上，
 * `DocsCategoryPage` 会在渲染时抛错（文章为空 = 一页没有正文的入口，那是比红更糟的东西）。
 */
const DOCS_CATEGORY_MODULES: Record<DocsCategoryId, HelpModuleId> = {
  start: 'start',
  sync: 'sync',
  organize: 'organize',
  data: 'data',
  trust: 'trust',
};

/**
 * 注册表，按 `SitePage` 这个**接口**读一遍。
 *
 * 🔴 为什么不能直接 `SITE_PAGES.filter(page => page.docsKind === …)`：
 * `SITE_PAGES` 是 `as const` 的元组，它的元素类型是**逐条字面量对象的联合** ——
 * 没标这个字段的成员（首页、`/features`、hub）在类型上**根本没有这条属性**，
 * 点出来就是 TS2339。`SitePage` 上那句 `docsKind?:` 保护不到它们。
 * （试过把一个"只有可选字段"的参数类型当漏斗用，也不行：TS 的 weak type 检测
 * 要求源类型至少有一个属性与之重合，缺字段的那些成员直接被拒。）
 *
 * 所以走接口：`pages.ts` 末尾那条 `AllPagesAreWellFormed` 编译期兜底已经保证
 * 每个成员都满足 `SitePage`，于是这里读到的 `docsKind` 是 `'article' | 'category' | undefined`，
 * "缺字段"回到它应有的语义 —— 既不是文章也不是分类。
 */
const ALL_PAGES: readonly SitePage[] = SITE_PAGES;

/** 注册表里的全部文章，**顺序即注册表的顺序**（侧栏与卡片都按它排）。 */
function articlePages(): readonly ArticlePage[] {
  return ALL_PAGES.filter((page): page is ArticlePage => page.docsKind === 'article');
}

/** 注册表里的全部分类页，同样按注册表顺序。 */
function categoryPages(): readonly CategoryPage[] {
  return ALL_PAGES.filter((page): page is CategoryPage => page.docsKind === 'category');
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
      `"${id}" 不是文档中心的文章。文章要在 src/site/pages.ts 注册且标 docsKind: 'article'，并在 src/site/docs.ts 的 DOCS_ENTRIES 里配正文（见两文件头）。`,
    );
  }
  return toArticle(page);
}

/**
 * 某个分类下的全部文章（侧栏与卡片用）。
 *
 * ⚠️ 空数组仍然是**合法**结果（判据不在这份数据里，调用方拿到的永远是算出来的），
 * 只是本轮补满之后五个分类都有文章了 ——
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

/**
 * ─────────────────────────────────────────────────────────────────────────
 * 搜索：把"文档中心里能被找到的东西"摊平成一份命中清单
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * 一条可命中的条目：`article` = 那一整篇（跳到页面），`section` = 篇内某一节
 * （跳到页面 + 锚点）。
 *
 * ⚠️ 这里给的是**词条 key**，不是文字 —— 与 `docsOutline()` 同一条纪律：
 * 这一层管结构，把 key 变成人读的话是渲染层的事。搜索框在中文页搜中文标题、
 * 在英文页搜英文标题，靠的就是"文字在最后一刻才解析"这一点。
 */
export interface DocsSearchHit {
  readonly kind: 'article' | 'section';
  /** 命中落在哪一篇（渲染层用它算 href）。 */
  readonly article: DocsArticle;
  /** 这一条显示与被匹配的那个标题。 */
  readonly titleKey: MessageKey;
  /** 分区级的锚点（就是正文那个 `<section id>`）；文章级没有。 */
  readonly sectionId?: string;
}

/**
 * 全部可命中的条目：**每篇一条 + 每个分区一条**，顺序 = 阅读顺序。
 *
 * 🔴 **这份清单是渲染时从注册表推出来的，不是一份生成的 `search-index.json`。**
 * 生成物要有人重跑才更新，而"新增一篇文章却忘了重跑"的症状是
 * **搜索静默搜不到那一整篇** —— 段落数、目录、侧栏、sitemap 全都照样对，
 * 没有任何一层会失败。派生则没有那个时刻：文章一旦进注册表，
 * 它同时进了侧栏、目录和搜索（`DOCS_ENTRIES` 少配正文会编译不过）。
 * 代价写进 `BLOCKED.md`：索引随主包发出，而不是一个可缓存的 JSON。
 *
 * ⚠️ 每一条只与**它自己的标题**匹配，不带正文、也不带所属分类的名字。
 * 带上正文会让"搜到一段"和"搜到一篇"分不开；带上分类名会让一个分类下
 * 的每一个分区都命中 —— 两种都是在结果里造噪音。
 */
export function docsSearchHits(): readonly DocsSearchHit[] {
  const hits: DocsSearchHit[] = [];
  for (const article of articlePages().map(toArticle)) {
    hits.push({ kind: 'article', article, titleKey: article.labelKey });
    for (const section of article.sections) {
      hits.push({ kind: 'section', article, titleKey: section.titleKey, sectionId: section.id });
    }
  }
  return hits;
}

/** 一个分类页 = 注册表条目 + 它绑定到哪个模块。 */
export type DocsCategory = CategoryPage & { readonly moduleId: HelpModuleId };

/**
 * 分类页要渲染的**全部**信息：它自己、它对应的模块（速答与标题）、它下面的文章。
 *
 * 🔴 三样一起给，而不是让组件自己去拼：`DocsCategoryPage` 若自己 `find` 模块，
 * 一旦 `DOCS_CATEGORY_MODULES` 绑了一个 `HELP_MODULES` 里查不到的 id（类型上可能，
 * 因为 `HelpModuleId` 是联合而不是 `HELP_MODULES` 的派生），它会静默渲染一张没有速答的页。
 * 这里把它做成一次显式抛错。
 */
export interface DocsCategoryInfo {
  readonly page: DocsCategory;
  readonly module: HelpModule;
  readonly articles: readonly DocsArticle[];
}

function toCategory(page: CategoryPage): DocsCategory {
  return { ...page, moduleId: DOCS_CATEGORY_MODULES[page.id] };
}

function categoryInfo(page: CategoryPage): DocsCategoryInfo {
  const category = toCategory(page);
  const module = HELP_MODULES.find((m) => m.id === category.moduleId);
  if (module === undefined) {
    throw new Error(
      `分类页 "${category.id}" 绑定的模块 "${category.moduleId}" 不在 HELP_MODULES 里（见 src/site/content.ts）。`,
    );
  }
  return { page: category, module, articles: docsArticlesOf(category.moduleId) };
}

/**
 * 某个模块的分类页。**没有就是 `undefined`** —— 只有速答的分类本来就不该有入口，
 * 调用方据此把"分类标题"渲染成普通文字，而不是一个指向不存在的地址的链接。
 */
export function docsCategoryOfModule(moduleId: HelpModuleId): DocsCategoryInfo | undefined {
  const page = categoryPages().find((p) => DOCS_CATEGORY_MODULES[p.id] === moduleId);
  return page === undefined ? undefined : categoryInfo(page);
}

/**
 * 按 id 取分类页。**找不到就抛** —— 与 `docsArticleById` 同一条纪律：
 * 走到这里说明 `PAGE_COMPONENTS` 把一个非分类页渲染成了 `DocsCategoryPage`，
 * 那是代码写错，静默渲染半页只会让人去查文案。
 */
export function docsCategoryById(id: string): DocsCategoryInfo {
  const page = categoryPages().find((category) => category.id === id);
  if (page === undefined) {
    throw new Error(
      `"${id}" 不是文档中心的分类页。分类页要在 src/site/pages.ts 注册且标 docsKind: 'category'，并在 src/site/docs.ts 的 DOCS_CATEGORY_MODULES 里绑定模块。`,
    );
  }
  return categoryInfo(page);
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * 配图：把 `helpFigures.ts` 的意图解析成**可以直接渲染的一件**
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * 图号前缀用哪条词条。**整站一处**，不是每张图各写一遍 ——
 * 五处「图」与五处 "Figure" 会在下一次改文案时漏掉一处，而漏掉的那一处
 * 恰好是访客看到的那个数字前面那个字。
 */
const FIGURE_LABEL_KEY: MessageKey = 'site.docs.figure';

/** 一张解析完成的配图：图号、产物路径、三个词条 key。 */
export interface DocsFigure extends HelpFigure {
  /**
   * 图号的数字部分（`"14-1"`），**由注册表顺序算出来**。
   * 前缀（中文「图」/ 英文 "Figure"）是文案，住在词条里，不拼进这个字符串 ——
   * 拼进去就等于让英文页显示一个中文「图」字。
   */
  readonly number: string;
  /** 站点内的绝对路径（`public/` 下的复制品）。 */
  readonly src: string;
  /** 前缀词条（`图` / `Figure`），与数字分开渲染。 */
  readonly labelKey: MessageKey;
}

/**
 * 一篇文章在注册表里的序号（从 1，**含分类页与其它页面**）—— 图号的"章"。
 *
 * 🔴 用注册表序号而不是"第几篇文档"：注册表顺序就是访客的阅读顺序，
 * 而"章"要能被拿去找上下文（"图 20-1"意味着第 20 个入口那一页）。
 * 换成文档中心的内部序号，两套编号会在加一篇非文档页时静默分叉。
 */
function registryOrdinal(articleId: DocsArticleId): number {
  const index = ALL_PAGES.findIndex((page) => page.id === articleId);
  if (index < 0) {
    throw new Error(
      `"${articleId}" 不在 src/site/pages.ts 的注册表里，无法计算图号（见该文件的 SITE_PAGES）。`,
    );
  }
  return index + 1;
}

/**
 * 一篇文章在**指定语言下**的配图，按 `HELP_FIGURES` 里的书写顺序编号。
 *
 * 🔴 先按 `locale` 过滤再编号：zh 与 en 各自从 1 数，两边的图号因此一致
 * （同一篇的第 1 张在两种语言里都叫 `<章>-1`），而文件互不串——
 * 英文页拿到的 `src` 一定是英文界面那张（成对性由 `assertHelpFigurePairs`
 * 在生成器入口钉住）。
 *
 * 🔴 `sectionId` 找不到就**抛**，不静默丢图。这是这套派生结构里唯一会"看起来正常"
 * 的失败：分区改名后那张图不会报错，只会**从页面上消失**，而配图少一张没有任何
 * 判据会主动喊出来（段落数、目录、卡片数全都不看它）。抛错 + e2e 那条"图数"断言，
 * 才是这一处该有的两道闸。
 */
export function docsFiguresOf(article: DocsArticle, locale: Locale): readonly DocsFigure[] {
  const figures = HELP_FIGURES[article.id].filter((figure) => figure.locale === locale);
  if (figures.length === 0) return [];
  const chapter = registryOrdinal(article.id);
  return figures.map((figure, i) => {
    if (!article.sections.some((section) => section.id === figure.sectionId)) {
      throw new Error(
        `配图 "${figure.targetId}-${figure.slug}" 挂在分区 "${figure.sectionId}" 上，但文章 "${article.id}" 没有这一节（分区清单在 src/site/docs.ts，映射在 src/site/docsFigures.ts）。`,
      );
    }
    return {
      ...figure,
      number: `${chapter}-${i + 1}`,
      src: helpFigureSrc(article.id, figure),
      labelKey: FIGURE_LABEL_KEY,
    };
  });
}
