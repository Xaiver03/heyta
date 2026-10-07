/**
 * 各页面的正文结构
 * ==================
 *
 * 🔴 **这里一个字面文案都没有，只有词条 key。** 正文的每一句话都在
 * `packages/i18n` 的中英两张表里 —— 于是"给页面加一段话"这件事**只能**
 * 通过改词条表完成，而两张表漏一边是**编译期**报错（`en.ts` 用
 * `satisfies Record<MessageKey, string>`，缺一条就红）。
 *
 * 为什么结构与文案要分开：`t()` 只返回字符串，所以"有几个分区、每个分区
 * 叫什么、下面有几条"必然留在代码里。留在这里的好处是它**能一眼看完** ——
 * 每个页面就是一张十来行的 key 清单，加了一项忘了加词条会立刻编译失败。
 *
 * ⚠️ key 的命名是 `site.<页面>.<部分>`，与词条表里那一大段的组织方式一致。
 * 本节**不新增任何 key**：词条已经写好，这里只是把它们**排成页面的形状**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **内容纪律（对标研究的直接结论）**：`/features` 只写**已实现**的能力。
 * 收录未实现的功能就是说谎，而落地页是最容易被截图传播的界面。
 * 每一项都能在 `docs/research/dida365-feature-benchmark.md` §2 找到 ✅ 依据。
 * 反过来，「还没做的」那一节也必须**逐条对过码** —— 2026-09-30 实测发现它把
 * 提醒、子任务、搜索、Web 日历列成了"没做"，而这四件两端都有真 Action 与真 UI，
 * 于是 `/features` 与 `/docs` 的两篇文章直接互相打脸。
 * 当前真没做的只有：习惯的频率目标、移动端的系统通知投递、自定义筛选器、
 * 看板视图、批量操作。**改这一节前先跑一遍码，别照旧文案抄。**
 */

import type { MessageKey } from '@heyta/i18n/provider';

import type { SectionSpec } from './PageSections.js';

/** `/features`：按**功能模块**组织，不按技术分层（依据 A1-1）。 */
export const FEATURE_SECTIONS: readonly SectionSpec[] = [
  {
    id: 'tasks',
    titleKey: 'site.features.section.tasks',
    itemKeys: [
      'site.features.item.task.fields',
      'site.features.item.task.repeat',
      'site.features.item.task.projects',
      'site.features.item.task.trash',
      'site.features.item.task.export',
    ],
    mockView: 'tasks',
  },
  {
    id: 'views',
    titleKey: 'site.features.section.views',
    itemKeys: [
      'site.features.item.view.quadrant',
      'site.features.item.view.timeline',
      'site.features.item.view.today',
    ],
    mockView: 'quadrant',
  },
  {
    id: 'habits',
    titleKey: 'site.features.section.habits',
    itemKeys: [
      'site.features.item.habit.model',
      'site.features.item.habit.streak',
      'site.features.item.habit.heat',
    ],
    mockView: 'habits',
  },
  {
    id: 'focus',
    titleKey: 'site.features.section.focus',
    itemKeys: ['site.features.item.focus.timer', 'site.features.item.focus.link'],
    mockView: 'focus',
  },
  {
    id: 'growth',
    titleKey: 'site.features.section.growth',
    itemKeys: [
      'site.features.item.growth.feedback',
      'site.features.item.growth.narrative',
      'site.features.item.growth.colors',
    ],
  },
  {
    id: 'sync',
    titleKey: 'site.features.section.sync',
    itemKeys: [
      'site.features.item.sync.e2ee',
      'site.features.item.sync.offline',
      'site.features.item.sync.conflict',
      'site.features.item.sync.selfhost',
    ],
  },
  {
    id: 'ai',
    titleKey: 'site.features.section.ai',
    itemKeys: [
      'site.features.item.ai.byok',
      'site.features.item.ai.gate',
      'site.features.item.ai.features',
    ],
  },
  {
    id: 'api',
    titleKey: 'site.features.section.api',
    itemKeys: ['site.features.item.api.mcp', 'site.features.item.api.local'],
  },
  /**
   * 🔴 「还没做的」与「明确不做的」属于**同一页**，不是"以后再做"的占位：
   * 一个只讲自己有什么的功能页不值得相信，所以把这两类并排写在这里，
   * 代价是不好看，收益是这一页说的别的都可信。
   */
  {
    id: 'pending',
    titleKey: 'site.features.pending.title',
    bodyKeys: ['site.features.pending.body'],
  },
  {
    id: 'not-doing',
    titleKey: 'site.features.notdoing.title',
    bodyKeys: ['site.features.notdoing.body'],
  },
];

/** `/features` 页末的说明（`.lp-note`，不进正文流）。 */
export const FEATURE_NOTES: readonly MessageKey[] = ['site.features.note'];

/** `/platforms`：**不叫"下载"**。 */
export const PLATFORM_SECTIONS: readonly SectionSpec[] = [
  {
    id: 'web',
    status: 'available',
    titleKey: 'site.platforms.web.name',
    bodyKeys: ['site.platforms.web.body'],
  },
  {
    id: 'android',
    status: 'partial',
    titleKey: 'site.platforms.android.name',
    bodyKeys: ['site.platforms.android.body'],
  },
  {
    id: 'ios',
    status: 'partial',
    titleKey: 'site.platforms.ios.name',
    bodyKeys: ['site.platforms.ios.body'],
  },
  {
    id: 'desktop',
    status: 'partial',
    titleKey: 'site.platforms.desktop.name',
    bodyKeys: ['site.platforms.desktop.body'],
  },
  {
    id: 'harmony',
    status: 'blocked',
    titleKey: 'site.platforms.harmony.name',
    bodyKeys: ['site.platforms.harmony.body'],
  },
  {
    id: 'selfhost',
    status: 'partial',
    titleKey: 'site.platforms.selfhost.name',
    bodyKeys: ['site.platforms.selfhost.body'],
  },
];

/** `/platforms` 页末说明。 */
export const PLATFORM_NOTES: readonly MessageKey[] = ['site.platforms.note'];

/**
 * `/integrations`：**我们独有、而滴答清单没有的能力**（A7）。
 *
 * 🔴 素材来自 `docs/research/dida365-feature-benchmark.md` §5 的九条，
 * 但这一页**不是把那九条抄一遍**：它们按 A7 的三条判据重新组织成
 * **用户能自己走的动作** ——
 *
 *   · A7-1 **数据主权**：端到端加密（`e2ee`）· 自建服务器（`selfhost`）·
 *     本机 API + MCP（`local-api`）· BYOK（`byok`）· 导出（`export`）；
 *   · A7-3 **对照滴答**：默认关 + 逐工具授权（写在 `local-api` 的正文里）·
 *     不按功能收费（`pricing`）· 四象限是派生视图（`quadrant`）；
 *   · 其余两条独立成节：习惯韧性（`resilience`）· 冲突解决可视化（`conflict`）。
 *
 * ⚠️ **内容纪律**：只收录**已实现**的能力。
 * 🔴 2026-09-29 起公页**不再渲染「验证方式」**—— `pnpm …` 与仓库路径是
 * 贡献者语言，对用户就是内部黑话（那次退役的完整缘由写在
 * `scripts/check-claims.mjs` 的文件头）；**也不出现竞品名**——
 * 这一页的立意是"数据在你手里"，靠自身成立，不靠对照竞品成立。
 */
export const INTEGRATION_SECTIONS: readonly SectionSpec[] = [
  {
    id: 'e2ee',
    titleKey: 'site.integrations.e2ee.title',
    bodyKeys: ['site.integrations.e2ee.body'],
    itemKeys: ['site.integrations.e2ee.item.ingress', 'site.integrations.e2ee.item.keys'],
  },
  {
    id: 'selfhost',
    titleKey: 'site.integrations.selfhost.title',
    bodyKeys: ['site.integrations.selfhost.body'],
    itemKeys: ['site.integrations.selfhost.item.compose', 'site.integrations.selfhost.item.free'],
  },
  {
    id: 'local-api',
    titleKey: 'site.integrations.localApi.title',
    bodyKeys: ['site.integrations.localApi.body'],
    itemKeys: ['site.integrations.localApi.item.tools', 'site.integrations.localApi.item.gate'],
  },
  {
    id: 'byok',
    titleKey: 'site.integrations.byok.title',
    bodyKeys: ['site.integrations.byok.body'],
    itemKeys: ['site.integrations.byok.item.presets', 'site.integrations.byok.item.nosdk'],
  },
  {
    id: 'export',
    titleKey: 'site.integrations.export.title',
    bodyKeys: ['site.integrations.export.body'],
    itemKeys: ['site.integrations.export.item.json', 'site.integrations.export.item.markdown'],
  },
  {
    id: 'pricing-model',
    titleKey: 'site.integrations.pricing.title',
    bodyKeys: ['site.integrations.pricing.body'],
    itemKeys: ['site.integrations.pricing.item.nogate', 'site.integrations.pricing.item.onlytwo'],
  },
  {
    id: 'quadrant',
    titleKey: 'site.integrations.quadrant.title',
    bodyKeys: ['site.integrations.quadrant.body'],
    itemKeys: ['site.integrations.quadrant.item.derived', 'site.integrations.quadrant.item.nodrift'],
  },
  {
    id: 'resilience',
    titleKey: 'site.integrations.resilience.title',
    bodyKeys: ['site.integrations.resilience.body'],
    itemKeys: [
      'site.integrations.resilience.item.states',
      'site.integrations.resilience.item.nocurrency',
    ],
  },
  {
    id: 'conflict',
    titleKey: 'site.integrations.conflict.title',
    bodyKeys: ['site.integrations.conflict.body'],
    itemKeys: ['site.integrations.conflict.item.visible', 'site.integrations.conflict.item.lww'],
  },
];

/** `/integrations` 页末说明。 */
export const INTEGRATION_NOTES: readonly MessageKey[] = ['site.integrations.note'];

/**
 * 一个问答对（词条表里就是成对写的 q/a）。
 *
 * `id` 落在 `<dt>` 上，所以 `/{locale}/docs/#sync` 是一个**能落在具体问题上**
 * 的地址 —— 应用里那句"同步出错了"的提示可以直接指到这里，
 * 而不是把人丢在帮助页顶部让他自己找。
 */
export interface FaqPair {
  readonly id: string;
  readonly questionKey: MessageKey;
  readonly answerKey: MessageKey;
}

/**
 * 帮助中心的**分类词表**。
 *
 * 🔴 **它住在这里而不是 `docs.ts`，因为这一份才是那张被两处读取的表**：
 * `HELP_MODULES` 定义了速答怎么分组，文档中心要按**同一套**分组挂深读。
 * 写成 `string` 的话这套分组就没有边界 —— 在 `docs.ts` 里新造一个
 * `'multidevice'` 编译期不会红，运行时也照样渲染，但访客看到的是两个中心
 * 各有一套分类名（那正是本轮 IA 改造要根除的形态）。
 * 收窄成字面量联合后，`HELP_MODULES` 里拼错一个 id、或文档侧引用一个
 * 不存在的分类，都是**编译期**错误。
 *
 * ⚠️ 加一个新分类要同时想清楚它的速答 —— 只有名字没有内容的分类，
 * 界面上不该出现（见下方 `render.spec.tsx` 对空模块的判据）。
 */
export type HelpModuleId = 'start' | 'sync' | 'organize' | 'data' | 'trust';

/**
 * `/docs` 的一个**功能模块**：一段小标题 + 它下面的问答（A4-1）。
 *
 * 🔴 组织方式是**按你在做什么**，不是按文档类型 —— 这是滴答清单帮助中心的
 * 实测结论（`docs/research/dida365-help-center-ia.md`）。所以"同步 / 口令 /
 * 通行密钥"三问归在同一个模块下，而不是散在三处各写一遍。
 */
export interface HelpModule {
  readonly id: HelpModuleId;
  readonly titleKey: MessageKey;
  readonly pairs: readonly FaqPair[];
}

/**
 * `/docs`：用户最会撞到的十个问题（依据 A4-2），按功能模块组织（A4-1）。
 *
 * 🔴 **这里是问答清单的唯一事实源**：`HELP_QUESTIONS` 由它 `flatMap` 出来，
 * 而 `gen-entries.mjs` 的 `FAQPage` JSON-LD 与 `render.spec.tsx` 都读那一份 ——
 * 两处各写一份必然漂移，而漂移的那一份恰好是搜索引擎读到的那一份。
 *
 * ⚠️ 首版把答案写在**这一页里**，没有拆成文章路由 —— 十篇文章就是十条新路由，
 * 而"文章还没写"的那些链接会变成 404。一个帮助中心里最不能出现的
 * 就是"点了没反应的问题"。体积长大之后再拆，届时用同一份清单派生即可。
 *
 * ⚠️ **内容的时效判据**：写"某个功能还没做"之前必须先核对该功能的真实状态 ——
 * `notify`（"为什么没有提醒"）曾写着"因为还没做"，而提醒在 2026-10-02 已经落地，
 * 那句就变成了假话。所以它被移除，不再占据一个"问题"位。
 */
export const HELP_MODULES: readonly HelpModule[] = [
  {
    id: 'start',
    titleKey: 'site.help.module.start',
    pairs: [{ id: 'create', questionKey: 'site.help.q.create', answerKey: 'site.help.a.create' }],
  },
  {
    id: 'sync',
    titleKey: 'site.help.module.sync',
    pairs: [
      { id: 'sync', questionKey: 'site.help.q.sync', answerKey: 'site.help.a.sync' },
      {
        id: 'passphrase',
        questionKey: 'site.help.q.passphrase',
        answerKey: 'site.help.a.passphrase',
      },
      { id: 'passkey', questionKey: 'site.help.q.passkey', answerKey: 'site.help.a.passkey' },
    ],
  },
  {
    id: 'organize',
    titleKey: 'site.help.module.organize',
    pairs: [
      {
        id: 'quadrant',
        questionKey: 'site.help.q.quadrant',
        answerKey: 'site.help.a.quadrant',
      },
      { id: 'repeat', questionKey: 'site.help.q.repeat', answerKey: 'site.help.a.repeat' },
      { id: 'focus', questionKey: 'site.help.q.focus', answerKey: 'site.help.a.focus' },
    ],
  },
  {
    id: 'data',
    titleKey: 'site.help.module.data',
    pairs: [
      { id: 'export', questionKey: 'site.help.q.export', answerKey: 'site.help.a.export' },
      { id: 'selfhost', questionKey: 'site.help.q.selfhost', answerKey: 'site.help.a.selfhost' },
    ],
  },
  {
    id: 'trust',
    titleKey: 'site.help.module.trust',
    pairs: [{ id: 'privacy', questionKey: 'site.help.q.privacy', answerKey: 'site.help.a.privacy' }],
  },
];

/** 扁平的问答清单 —— 从 `HELP_MODULES` 派生，供 JSON-LD 与判据使用。 */
export const HELP_QUESTIONS: readonly FaqPair[] = HELP_MODULES.flatMap((module) => module.pairs);

/** `/pricing` 的常见问题（依据 A3-3；词条表里成对写）。 */
export const PRICING_QUESTIONS: readonly FaqPair[] = [
  { id: 'faq-expire', questionKey: 'site.pricing.faq.expire.q', answerKey: 'site.pricing.faq.expire.a' },
  { id: 'faq-where', questionKey: 'site.pricing.faq.where.q', answerKey: 'site.pricing.faq.where.a' },
  { id: 'faq-export', questionKey: 'site.pricing.faq.export.q', answerKey: 'site.pricing.faq.export.a' },
  { id: 'faq-buy', questionKey: 'site.pricing.faq.buy.q', answerKey: 'site.pricing.faq.buy.a' },
];

/**
 * `/pricing` 的「自建 vs 我们托管」对照表（依据 A3-2 / D3）。
 *
 * 🔴 对照的是**运维责任**，不是功能多少 —— 我们不按功能收费
 * （[ADR-0020] §3.2），所以一张"哪档少哪个功能"的表在本产品里是**做不到**的，
 * 硬做出来就是撒谎。
 *
 * ⚠️ `same` 这一列存在的意义：功能、锁定这两行的两边答案**是同一句话**。
 * 把它拆成两栏各写一遍，就会出现"两边措辞不同 → 被读成不一样"。
 */
export interface CompareRow {
  readonly labelKey: MessageKey;
  /** 两栏答案相同时只给这一条；否则给 `diyKey` / `hostedKey`。 */
  readonly sameKey?: MessageKey;
  readonly diyKey?: MessageKey;
  readonly hostedKey?: MessageKey;
}

export const PRICING_COMPARE_ROWS: readonly CompareRow[] = [
  {
    labelKey: 'site.pricing.compare.row.function',
    sameKey: 'site.pricing.compare.function.same',
  },
  {
    labelKey: 'site.pricing.compare.row.server',
    diyKey: 'site.pricing.compare.server.diy',
    hostedKey: 'site.pricing.compare.server.hosted',
  },
  {
    labelKey: 'site.pricing.compare.row.data',
    diyKey: 'site.pricing.compare.data.diy',
    hostedKey: 'site.pricing.compare.data.hosted',
  },
  {
    labelKey: 'site.pricing.compare.row.ai',
    diyKey: 'site.pricing.compare.ai.diy',
    hostedKey: 'site.pricing.compare.ai.hosted',
  },
  {
    labelKey: 'site.pricing.compare.row.lockin',
    sameKey: 'site.pricing.compare.lockin.same',
  },
];

/**
 * `/changelog` 的条目。
 *
 * 🔴 日期**不进词条表**：它是与语言无关的数据，而放进两张表里就多了一处
 * 可以漂移的地方（同一件事在中英两版记成两个日期）。这里是唯一先例 ——
 * 其它任何面向用户的文字都必须在词条表里，`check:ui-language` 管着。
 *
 * 同一天有多条时**并列**（2026-09-28 有三条），而不是压成一段：
 * 那三条是三件独立的事，合并会让人以为是一件事的三个部分。
 */
export interface ChangelogEntry {
  /** ISO 日期。与语言无关，见上。 */
  readonly date: string;
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
}

export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    date: '2026-10-05',
    titleKey: 'site.changelog.20261005.title',
    bodyKey: 'site.changelog.20261005.body',
  },
  {
    date: '2026-10-02',
    titleKey: 'site.changelog.20261002.title',
    bodyKey: 'site.changelog.20261002.body',
  },
  {
    date: '2026-09-28',
    titleKey: 'site.changelog.20260928.title',
    bodyKey: 'site.changelog.20260928.body',
  },
  {
    date: '2026-09-28',
    titleKey: 'site.changelog.20260928b.title',
    bodyKey: 'site.changelog.20260928b.body',
  },
  {
    date: '2026-09-28',
    titleKey: 'site.changelog.20260928c.title',
    bodyKey: 'site.changelog.20260928c.body',
  },
  {
    date: '2026-09-27',
    titleKey: 'site.changelog.20260927.title',
    bodyKey: 'site.changelog.20260927.body',
  },
  {
    date: '2026-09-26',
    titleKey: 'site.changelog.20260926.title',
    bodyKey: 'site.changelog.20260926.body',
  },
];

/** `/changelog` 页末说明（指向更早的记录在哪）。 */
export const CHANGELOG_NOTES: readonly MessageKey[] = ['site.changelog.note'];
