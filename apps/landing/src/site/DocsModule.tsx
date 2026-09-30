/**
 * 一个分类的那一块（速答 + 深读卡片）
 * ====================================
 *
 * 🔴 **它是 `/help` 与分类页共用的一块，不是两份长得一样的代码。**
 *
 * 分类页（`/help/sync`）要画的東西和帮助中心里那一个模块**完全相同**：
 * 同一组速答、同一组文章卡、同样的"速答在前、深读在后"的顺序。
 * 复制一份的话，"卡片上一句话摘要的字数要求""没有文章就不出小标题"
 * 这些纪律就有了第二个住处 —— 而第二个住处最先过期。
 *
 * 两页唯一的差别是**标题要不要再链一次**：
 *   - 在 `/help` 上，模块标题是那一分类的唯一入口，所以它链向分类页；
 *   - 在分类页上，标题已经是页头的 `<h1>`，再画一个 `<h3>` 并链回自己
 *     等于在同一页里摆了三个同名链接（h1 / h3 / 侧栏）。
 * 所以标题由 `withHeading` 控制，而不是在分类页里藏一个 `<h3 style=hidden>`。
 *
 * ⚠️ 「速答」小标题只在**有文章**的分类出现（`HelpPage` 文件头记着这条裁决的缘由：
 * 标签的作用是把两种东西分开，不是给一种东西命名）。这里保持同一个判据。
 */

import { useI18n, useLocale } from '@heyta/i18n/provider';

import { docsCategoryOfModule, type DocsArticle } from './docs.js';
import type { HelpModule } from './content.js';
import { FaqList } from './FaqList.js';
import { RichText } from './PageSections.js';
import { siteHref } from './paths.js';

export function DocsModuleBlock({
  module,
  articles,
  withHeading = true,
}: {
  module: HelpModule;
  /** 这一分类下的全部文章（顺序 = 注册表顺序，由 `docsOutline()` 给）。 */
  articles: readonly DocsArticle[];
  withHeading?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();
  const hasDeepRead = articles.length > 0;
  const category = docsCategoryOfModule(module.id);
  const title = <RichText text={t(module.titleKey)} />;

  return (
    <section id={module.id} className="lp-help__module">
      {withHeading ? (
        <h3 className="lp-h3">
          {category === undefined ? (
            title
          ) : (
            <a className="lp-help__module-link" href={siteHref(category.page, locale)}>
              {title}
            </a>
          )}
        </h3>
      ) : null}

      {hasDeepRead ? <p className="lp-docs__eyebrow">{t('site.docs.hub.faq')}</p> : null}
      <FaqList pairs={module.pairs} />

      {hasDeepRead ? (
        <div className="lp-docs__hub">
          <p className="lp-docs__eyebrow">{t('site.docs.hub.articles')}</p>
          <ul className="lp-docs__cards">
            {articles.map((article) => (
              <li key={article.id} className="lp-docs__card">
                <a className="lp-docs__card-link" href={siteHref(article, locale)}>
                  <span className="lp-docs__card-title">{t(article.labelKey)}</span>
                  <span className="lp-docs__card-sum">
                    <RichText text={t(article.ledeKey)} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
