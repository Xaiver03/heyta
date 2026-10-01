/**
 * 一份对外法律文本
 * =================
 *
 * 🔴 **九份文本 → 同一个组件**，与文档中心十四篇文章同一个理由：
 * 差异全部是**数据**，住在 `@heyta/legal` 那份事实源里。如果每份各有一个
 * 组件，"这一份的排版跟别人不一样"就成了一个可以悄悄发生的选项 ——
 * 而法律文本的全部价值恰恰在于**九份读起来是一套东西**（同一批术语、
 * 同一批锚点形状、同一个"什么时候生效"的位置）。
 *
 * ── 正文为什么不在词条表里
 *
 * `packages/i18n` 管界面文案；法律文本是**对外承诺**，要带版本号进同意记录
 *（理由与例外声明写在 `packages/legal/src/types.ts` 文件头）。
 * 这一页的**页眉与页脚外壳**（H1、引言、草案横幅、"版本 / 更新于"那一行）
 * 仍然是界面文案，所以它们走 `page.headingKey` 与 `site.legal.*` 那几条词条。
 *
 * 🔴 **块类型是封闭集合，未覆盖的一律抛错。**
 * `LegalBlock` 加一种 `kind` 而这里没跟上时，静默的做法是"这一段不渲染" ——
 * 那是一句用户看得见的法律承诺**凭空消失**，而页面其余部分完全正常。
 * 宁可红在控制台与 `render.spec.tsx` 上。
 */

import { useI18n, useLocale, type Locale } from '@heyta/i18n/provider';
import { legalDocumentById, type LegalBlock, type LegalSection } from '@heyta/legal';

import { PageHead, RichText } from '../site/PageSections.js';
import { legalPageByDocId, type SitePage } from '../site/pages.js';
import { siteHref } from '../site/paths.js';

export function LegalDocumentPage({ page }: { page: SitePage }): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();
  // 🔴 取不到 `legalDocId` 时**不许**回落到 `page.id`：那会把「注册表里漏写这个字段」
  // 报成「@heyta/legal 里没有这篇文档」，而后者听起来像文档 id 拼错了 —— 真正的原因
  // 在另一层。（`LEGAL_PAGES` 与 `PAGE_COMPONENTS` 的一致性由 `tests/legal-pages.spec.ts` 钉。）
  const docId = page.legalDocId;
  if (docId === undefined) {
    throw new Error(`站点页面 "${page.id}" 没有 legalDocId，却挂在了法律文本组件上。`);
  }
  const document = legalDocumentById(docId);
  const sections = document.sections[locale];

  return (
    <>
      <PageHead page={page} cta={false} />

      <div className="lp-legal">
        <p className="lp-legal__meta">
          <RichText text={t('site.legal.meta', { version: document.version, date: document.updatedDate })} />
        </p>

        {document.status === 'draft' ? (
          // 🔴 横幅而不是脚注：一份还没生效的文本被人当成已生效，
          // 后果是我们替用户承诺了没有复核过的规则。
          <p className="lp-legal__banner" role="note">
            <RichText text={t('site.legal.draft.banner')} />
          </p>
        ) : null}

        {sections.length > 1 ? (
          <nav className="lp-legal__toc" aria-label={t('site.legal.toc')}>
            <p className="lp-legal__toc-title">{t('site.legal.toc')}</p>
            <ol>
              {sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    <RichText text={section.title} />
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        {sections.map((section) => (
          <LegalSectionView key={section.id} section={section} depth={0} locale={locale} />
        ))}
      </div>
    </>
  );
}

/** `h2` 给顶层小节，`h3` 给子小节 —— 与文档中心同一套层级，且**每页只有一个 `h1`**。 */
function LegalSectionView({
  section,
  depth,
  locale,
}: {
  section: LegalSection;
  depth: number;
  locale: Locale;
}): React.JSX.Element {
  const Heading = depth === 0 ? 'h2' : 'h3';
  return (
    <section className="lp-legal__section" id={section.id}>
      <Heading className="lp-legal__h">
        <RichText text={section.title} />
      </Heading>
      {(section.blocks ?? []).map((block, index) => (
        <LegalBlockView key={`${section.id}-${index}`} block={block} locale={locale} />
      ))}
      {(section.subsections ?? []).map((child) => (
        <LegalSectionView key={child.id} section={child} depth={depth + 1} locale={locale} />
      ))}
    </section>
  );
}

function LegalBlockView({
  block,
  locale,
}: {
  block: LegalBlock;
  locale: Locale;
}): React.JSX.Element {
  switch (block.kind) {
    case 'p':
      return (
        <p className="lp-legal__p">
          <RichText text={block.text} />
        </p>
      );
    case 'ul':
      return (
        <ul className="lp-legal__list">
          {block.items.map((item, index) => (
            <li key={index}>
              <RichText text={item} />
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="lp-legal__list">
          {block.items.map((item, index) => (
            <li key={index}>
              <RichText text={item} />
            </li>
          ))}
        </ol>
      );
    case 'callout':
      return (
        <aside className="lp-legal__callout">
          <RichText text={block.text} />
        </aside>
      );
    case 'docRef': {
      const target = legalPageByDocId(block.docId);
      if (target === undefined) {
        // 与 `legalDocumentById` 同一个立场：引用一份不存在的文件是代码写错，
        // 不是"这一条不显示"。（正常路径由 `@heyta/legal` 的结构测试挡住。）
        throw new Error(`法律文本引用了站点上不存在的一份文件 "${block.docId}"。`);
      }
      return (
        <p className="lp-legal__ref">
          <a href={siteHref(target, locale)}>
            <RichText text={block.text} />
          </a>
        </p>
      );
    }
    case 'table':
      return (
        <div className="lp-legal__table-wrap">
          <table className="lp-legal__table">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index} scope="col">
                    <RichText text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <RichText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default: {
      // ⚠️ 这里读的是**整个块**而不是 `block.kind`：所有 kind 都覆盖时 TS 把 `block`
      // 收窄成 `never`，而对 `never` 取属性是编译错误（实测 TS2339）。
      // 加一种新 kind 而这里没跟上时，`const unhandled: never = block` 立刻红。
      const unhandled: never = block;
      throw new Error(`@heyta/legal 出现了一种本组件不会渲染的块：${JSON.stringify(unhandled)}`);
    }
  }
}
