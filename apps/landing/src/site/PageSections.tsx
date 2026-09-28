/**
 * 子页面的通用件：富文本、页头、分区正文
 * ==========================================
 *
 * 🔴 **为什么要通用件，而不是六个页面各写一遍。**
 *
 * 站点会长出十几个页面，如果每页都自己写 `<h1>` + 引言 + 一段段正文，那么
 * "页面之间长得像不像一个产品"就取决于每页作者当时的心情 —— 这正是 N4
 * 要禁止的"两个站点拼起来"的观感。所以这里只做三件事：
 *
 *   1. 富文本（`**粗**` / `` `代码` ``）只有一种实现；
 *   2. 页头（H1 / 引言 / 行动点）只有一种画法；
 *   3. 分区正文只接受**词条 key**（`MessageKey`），一个字面量都不接。
 *
 * 第 3 条不只是为了 `check:ui-language` 能过，而是为了让"给页面加一段文案"
 * 这件事**只能**通过改词条表完成 —— 硬编码在组件里的文案，中英两版一定漂移，
 * 而漂移的那一版恰恰是搜索引擎读到的那一版。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要 `RichText`
 *
 * 词条表里已经写了不少 `**推导**`、`` `docs/research/…` `` 这类标记
 * （它们是给 HTML 渲染器看的，不是给 `t()` 看的）。**不处理它们的后果是把
 * 星号和反引号原样显示给用户** —— 而那种错误在所有测试里都不会红：
 * 文本非空、key 存在、门禁只看有没有硬编码。
 *
 * 所以这里做一次最小的行内解析：`**x**` → `<strong>`、`` `x` `` → `<code>`。
 * 用**返回 React 节点**的方式而不是 `dangerouslySetInnerHTML` ——
 * 文案将来可能来自贡献者，而"文案里能注入 HTML"是没必要冒的风险。
 */

import type { ReactNode } from 'react';

import { useI18n, useLocale, type MessageKey } from '@heyta/i18n';

import { AppWindow, type MockView } from '../mockup/AppWindow.js';
import { siteCta } from './cta.js';
import type { SitePage } from './pages.js';

/** 一个行内片段：普通文字 / 粗体 / 代码。 */
type InlineToken = { kind: 'text' | 'strong' | 'code'; value: string };

/**
 * 把一条词条拆成行内片段。
 *
 * 单次扫描（而不是链式 `split`）：链式处理在"粗体里套代码"这类输入上
 * 会因为第二次处理踩到第一次产出的片段而错位，而那种输入是人会写出来的。
 */
function tokenize(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      tokens.push({ kind: 'text', value: text.slice(cursor, match.index) });
    }
    const [, bold, code] = match;
    if (bold !== undefined) tokens.push({ kind: 'strong', value: bold });
    else if (code !== undefined) tokens.push({ kind: 'code', value: code });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) tokens.push({ kind: 'text', value: text.slice(cursor) });
  return tokens;
}

export function RichText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {tokenize(text).map((token, index) => {
        const key = `${index}-${token.kind}`;
        if (token.kind === 'strong') return <strong key={key}>{token.value}</strong>;
        if (token.kind === 'code') return <code key={key}>{token.value}</code>;
        return <span key={key}>{token.value}</span>;
      })}
    </>
  );
}

/** 渲染一条词条 key 的富文本。 */
export function KeyText({ messageKey }: { messageKey: MessageKey }): React.JSX.Element {
  const { t } = useI18n();
  return <RichText text={t(messageKey)} />;
}

/**
 * 一个分区。
 *
 * `id` 会变成 `id="..."`，所以它同时是**深链接的落点** —— 应用里的
 * 「帮助 → 怎么同步」这类入口可以直接落到 `/{locale}/help/#sync`，
 * 而不必只是把人丢到帮助页顶部。
 *
 * 三个正文位分开，是为了让**每一条文案都带着自己的语气**：
 *   - `bodyKeys`：成段的说明；
 *   - `itemKeys`：一串并列的能力（词条表里写的就是短句，渲染成列表才读得下去）；
 *   - `evidenceKeys`：验证方式（等宽字体 + 更弱的颜色，因为它不是给人读的
 *     卖点，而是给人**复制去跑**的）。
 */
export interface SectionSpec {
  readonly id: string;
  readonly titleKey: MessageKey;
  readonly bodyKeys?: readonly MessageKey[];
  readonly itemKeys?: readonly MessageKey[];
  readonly evidenceKeys?: readonly MessageKey[];
  /**
   * 该分区配的真实界面复现件（`src/mockup/`）。
   *
   * 🔴 A1-2 要求每个模块配**真实界面素材**，而判据是"不用截图" ——
   * 截图会过期，DOM 复现件跟着设计系统走。所以这里是**组件名**而不是图片路径。
   *
   * ⚠️ 为什么通用的分区渲染器知道"复现件"这件事：因为全站只有这一套复现件
   * （`AppWindow` 的四种视图），而它是**同一份应用布局**的复现 ——
   * 把它藏在一个回调后面只会让"哪个分区配了图"变得看不出来。
   */
  readonly mockView?: MockView;
  /**
   * 这一节该显示的状态徽标。
   *
   * 🔴 **它是「平台状态」这一页的核心视觉**，而在此之前这一页**没有状态**：
   * `site.platforms.status.*` 与 `site.platforms.legend.*` 六条词条写好了、
   * 门禁也绿，但 `SectionSpec` 上没有 `status` 字段 —— 结构上渲染不出来。
   * 这不是"配色没调好"，是**一页的招牌信息缺了**：访客只能读散文才能知道
   * 某个平台到底能不能用，而这一页存在的全部意义就是让他**一眼看出来**。
   *
   * 只有 `/platforms` 会设置它；其它页面留空即不渲染徽标。
   */
  readonly status?: PlatformStatus;
}

/**
 * 平台状态三档。**与页面上的图例逐条对应**（`site.platforms.legend.*`）。
 *
 * ⚠️ 三档的判据写在词条里，而不是这里 —— "能用，且有端到端验收"是一句
 * **对用户说的话**，属于文案；这里只负责"有哪几档"。
 */
export type PlatformStatus = 'available' | 'partial' | 'blocked';

/** 状态档位 → 词条 key。**映射只有一份**，图例与徽标都从这里取。 */
export const PLATFORM_STATUS_KEYS: Record<PlatformStatus, MessageKey> = {
  available: 'site.platforms.status.available',
  partial: 'site.platforms.status.partial',
  blocked: 'site.platforms.status.blocked',
};

/**
 * 状态徽标。
 *
 * 用 `data-status` 而不是三个 CSS class：样式表按属性选择器取色，
 * 加一档时**只改一处**（`PLATFORM_STATUS_KEYS` + 样式表），不会出现
 * "新档忘了写 class 于是没有颜色"。
 */
export function StatusBadge({ status }: { status: PlatformStatus }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <span className="lp-status" data-status={status}>
      {t(PLATFORM_STATUS_KEYS[status])}
    </span>
  );
}

/**
 * 页头。
 *
 * `headingKey` 与 `ledeKey` 由页面注册表提供（`SitePage`）——
 * 于是"某一页没有 H1"在结构上不可能发生：注册表里那两个字段是必填的。
 */
export function PageHead({ page }: { page: SitePage }): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();
  const cta = siteCta(page, locale);

  return (
    <header className="lp-page__head">
      <div className="lp-wrap">
        <h1 className="lp-h1">
          <KeyText messageKey={page.headingKey} />
        </h1>
        <p className="lp-lede lp-lede--wide">
          <KeyText messageKey={page.ledeKey} />
        </p>
        {/*
          🔴 行动点的规则与导航里那条**完全一致**（都走 `siteCta`）：
          没配 `VITE_APP_URL` 时指向首页的自建那一节，配了就是应用本身。
          两处各判一次就会出现"导航说能开始用、页头说去自建"的矛盾。
        */}
        <p className="lp-page__cta">
          <a
            className="lp-btn lp-btn--primary"
            href={cta.href}
            {...(cta.external ? { rel: 'noopener noreferrer' } : {})}
          >
            {t(cta.labelKey)}
          </a>
        </p>
      </div>
    </header>
  );
}

/** 分区正文。`children` 用来插入页面独有的区块（例如价格对照表）。 */
export function PageSections({
  sections,
  notes = [],
  children,
}: {
  sections: readonly SectionSpec[];
  /** 页末的提醒/免责说明。渲染成 `.lp-note`：它读起来就不是正文的一部分。 */
  notes?: readonly MessageKey[];
  children?: ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="lp-wrap">
      <div className="lp-rows">
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="lp-row">
            <h2 className="lp-h2">
              <KeyText messageKey={section.titleKey} />
              {section.status === undefined ? null : <StatusBadge status={section.status} />}
            </h2>

            {(section.bodyKeys ?? []).map((key) => (
              <p key={key} className="lp-prose">
                <KeyText messageKey={key} />
              </p>
            ))}

            {(section.itemKeys ?? []).length > 0 ? (
              <ul className="lp-list">
                {(section.itemKeys ?? []).map((key) => (
                  <li key={key} className="lp-list__item">
                    <KeyText messageKey={key} />
                  </li>
                ))}
              </ul>
            ) : null}

            {(section.evidenceKeys ?? []).map((key) => (
              // 🔴 前缀「验证方式」由**一条共享词条**提供，而不是写进每条证据里：
              // 证据的值只能是命令或路径（不翻译），标签才是要翻译的那部分。
              // 把标签塞进值里，中英两表就会出现两条除了标签只差命令的串，
              // 而命令一旦有一条被"顺手翻译"过，它就跑不起来了。
              <p key={key} className="lp-evidence">
                <span className="lp-evidence__label">{t('site.evidence.label')}</span>
                <KeyText messageKey={key} />
              </p>
            ))}

            {section.mockView === undefined ? null : (
              <div className="lp-row__visual">
                <AppWindow view={section.mockView} />
              </div>
            )}
          </section>
        ))}
      </div>

      {notes.length > 0 ? (
        <div className="lp-notes">
          {notes.map((key) => (
            <p key={key} className="lp-note">
              <RichText text={t(key)} />
            </p>
          ))}
        </div>
      ) : null}

      {children}
    </div>
  );
}

/**
 * 一个标准子页面：页头 + 分区正文。
 *
 * 需要插入自有区块的页面（`/pricing` 的价格卡与对照表、`/help` 的问答、
 * `/changelog` 的日期）通过 `children` 插进来，而**不是另写一套页头** ——
 * 一旦允许"另写一套页头"，各页的 `<h1>` 排版就会开始分叉，而那是 N4 的判据。
 */
export function SiteSubPage({
  page,
  sections,
  notes,
  children,
}: {
  page: SitePage;
  sections: readonly SectionSpec[];
  notes?: readonly MessageKey[];
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <>
      <PageHead page={page} />
      <div className="lp-section">
        <PageSections sections={sections} notes={notes}>
          {children}
        </PageSections>
      </div>
    </>
  );
}
