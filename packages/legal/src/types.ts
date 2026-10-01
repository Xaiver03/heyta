/**
 * 法律文本的结构（schema）
 * =========================
 *
 * 🔴 **为什么法律正文不在 `packages/i18n` 里 —— 这是对「i18n 是唯一文案事实源」
 * 那条纪律的一处**有意例外**，必须说清理由，否则下一个会把它当成漂移。**
 *
 * `packages/i18n` 管的是**界面文案**：短、跨端复用、改一个词要中英同步。
 * 法律文本四条都不符合，而其中两条是硬冲突：
 *
 * 1. **法律文本需要"版本"这个维度，词条表没有它。**
 *    同意留痕的证据必须能回答"他同意的是**哪一版**"（PIPL 第十四条要求同意由
 *    个人在**充分知情**的前提下自愿、明确作出；发生争议时要拿出当时那一版）。
 *    把正文塞进词条表，版本只能靠 git 记录 —— 而生产库里的同意记录要的是一个
 *    **写进数据的版本号**，git 不是数据库能引用的事实源。
 * 2. **审阅路径不同。** 法务/律师要在一份文件里通读全文并逐条改，
 *    而不是在两千行长对象里挑 `site.legal.privacy.s7p3`。
 *    结构化的 `sections/blocks` 让"第 7 条第 3 款"是**文件里的位置**，
 *    而不是一个没有语义的 key 名。
 * 3. 界面文案会跨端复用（web / 移动 / 服务端邮件），法律文本的复用面是
 *    **落地页 + 服务端对外页 + 应用内链接**，三者要的是同一份正文与同一个版本号 ——
 *    这正是本包存在的理由（一份事实源，多个渲染器）。
 * 4. 中英**逐段对齐**由 `tests/structure.spec.ts` 的结构对账保证（段落数、
 *    块类型、表格形状必须逐一对应）。词条表靠 `Record<MessageKey, string>`
 *    的多余属性检查保证同步，这里靠测试保证 —— **不是没有闸门，是换了一种能表达
 *    "结构相同"的闸门**：key 拼错在编译期红，段落漏翻在测试里红。
 *
 * ⚠️ 因此 `check:ui-language` **不扫本包**（它扫各端的 `apps` 下的 `src`）。
 * 📌 那门禁的扫描范围原本是一条通配路径，而**通配符紧跟斜杠的那两个字符会
 * 提前终止块注释** —— TypeScript 随即报「Module declaration names may only
 * use ' or " quoted strings」，症状离原因很远（TS1443 + 一串级联）。
 * 在注释里表达路径一律写汉字或加空格，不要把那个序列写进本文件。
 * 本包里出现的所有文字都是**对外承诺**，不是界面文案 ——
 * 对外承诺的闸门是：每条事实断言要能指回 `docs/research/legal-dataflow-*.md`
 * 里的一条 `文件:行号`，以及上面那个结构对账测试。
 *
 * ── 行内标记
 *
 * 只有 `**粗**` 与 `` `代码` `` 两种，与落地页 `RichText`（`apps/landing/src/site/PageSections.tsx`）
 * **同一套**：不新造一种标记语言，就不需要第二个解析器，也不需要第二个渲染器。
 * 🔴 链接**故意不支持**：法务文本里的链接会在改版时失效，而"点了没反应的法律链接"
 * 与"没有链接"一样是可达性缺陷。需要指向另一份文件时，用 `docRef` 块（渲染器
 * 从注册表解析 URL，所以链接目标永远存在，否则测试判红）。
 */

import type { Locale } from '@heyta/i18n';

/** 一行内允许的标记：`**粗**`、`` `代码` ``。渲染见落地页 `RichText`。 */
export type LegalInlineText = string;

/** 表格的一行：单元格数必须等于 `head` 长度（测试判红）。 */
export type LegalTableRow = readonly LegalInlineText[];

/**
 * 一个正文块。
 *
 *  kinds 是**封闭集合**：渲染器对每种都有分支，加一种而渲染器没跟上
 *  会在测试里红（`未渲染的块类型`），而不是在访客面前静默丢内容。
 */
export type LegalBlock =
  | { readonly kind: 'p'; readonly text: LegalInlineText }
  | { readonly kind: 'ul'; readonly items: readonly LegalInlineText[] }
  | { readonly kind: 'ol'; readonly items: readonly LegalInlineText[] }
  /** 提示框：用于"这一条对你意味着什么"这类需要视觉上分层的说明。 */
  | { readonly kind: 'callout'; readonly text: LegalInlineText }
  /** 指向本包内另一份文件。`docId` 必须是注册表里存在的 id（测试判红）。 */
  | { readonly kind: 'docRef'; readonly docId: string; readonly text: LegalInlineText }
  | {
      readonly kind: 'table';
      readonly head: readonly LegalInlineText[];
      readonly rows: readonly LegalTableRow[];
    };

/**
 * 一条（小节）。
 *
 * `id` 是**深链接的落点**（`/legal/privacy/#s3`），所以它必须短而稳定：
 * 🔴 **改版时不许改 id** —— 改了会把应用内、邮件里、商店描述里已经发出去的
 * 锚点全部变成 404 级别的失效。要调整结构就新增 id，旧的留给渲染器忽略。
 */
export type LegalSection = {
  readonly id: string;
  readonly title: LegalInlineText;
  readonly blocks?: readonly LegalBlock[];
  readonly subsections?: readonly LegalSection[];
};

/** 文档状态。`draft` 会在页面上显示"尚未生效"横幅（见 `LegalBanner`）。 */
export type LegalStatus = 'draft' | 'effective';

export type LegalDocument = {
  /** 稳定标识，同时是 URL 片段（`/legal/<id>/`）与同意记录里引用的名字。 */
  readonly id: string;
  /** 语义版本号。**改版必须 bump**，因为它进同意记录。 */
  readonly version: string;
  readonly status: LegalStatus;
  /** 本文件最后实质修改的日期（`YYYY-MM-DD`）。 */
  readonly updatedDate: string;
  /** `status: 'effective'` 时必填 —— 生效日期是对外承诺的一部分。 */
  readonly effectiveDate?: string;
  /** 页面上给人看的标题（会进 `<h1>`）。 */
  readonly title: Record<Locale, string>;
  /** 一句话摘要：进 `<meta name="description">` 与页脚卡片。 */
  readonly summary: Record<Locale, string>;
  /** 中英两版的**结构必须逐一对应**（`tests/structure.spec.ts`）。 */
  readonly sections: Record<Locale, readonly LegalSection[]>;
};

/** 中英两版共用一个 `Record<Locale, …>`，所以语言清单只有 `@heyta/i18n` 那一份。 */
export type LegalLocale = Locale;
