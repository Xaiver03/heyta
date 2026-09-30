/**
 * `/help`：帮助中心 —— **速答 + 文档中心的两层入口**
 * ====================================================
 *
 * 组织方式是**按你在做什么**（问题模块），不是按文档类型 —— 借滴答清单帮助中心
 * 实测出来的结论（`docs/research/dida365-help-center-ia.md`），但内容**另写**：
 * `docs/` 里有 ADR、迁移纪律、环境陷阱，直接暴露既看不懂又泄露实现细节。
 *
 * 🔴 **这一页现在是两层深度的共同入口**：
 *   - **速答**：每个模块下那两条一问一答（`HELP_MODULES`，住在 `content.ts`）；
 *   - **深读**：同一模块下的文档文章卡片（文章注册在 `pages.ts`，分组与正文在
 *      `docs.ts`，两者由 `docsOutline()` 配成一对）。
 * 原来的"首版把答案都写在这一页里、没有拆成文章路由"已经不成立 —— 六篇文章
 * 各自有地址、各自进 sitemap 与 hreflang。
 *
 * ⚠️ **顺序是速答在前、深读在后。** 到这个页面的人手上有一个具体问题，
 * 先给他能立刻用的答案；"顺便把原理讲清楚"是他读完答案还愿意往下走时才给的。
 * 反过来排会让帮助页首屏全是"更多阅读"，那是一篇文章的目录，不是一个答案。
 *
 * 🔴 **分组词表与文档中心共用，且这一页只走 `docsOutline()` 一份。**
 * 模块 id、`site.help.module.*` 标题、模块顺序、每个模块下的文章全部来自同一份
 * 派生结果 —— 帮助中心与文档中心是**同一个 IA 的两层深度**，不是两个中心。
 * 一旦两处各有一套分类名，"同步"在一处叫「同步与账号」、在另一处叫「多设备」，
 * 而访客找的是同一件事。
 *
 * 🔴 **「速答」这个小标题只在有文章的模块出现。** 五个模块里有三个只有问答 ——
 * 给它们也标一次"速答"，等于对着唯一的一种内容宣布"这是速答"，
 * 那是给读者加噪音；标签的作用是把**两种**东西分开，不是给一种东西命名。
 *
 * 🔴 **模块划分、问答清单在 `src/site/content.ts`，文章清单在 `src/site/docs.ts`。**
 * 这个文件只负责画出来，于是 `FAQPage` 结构化数据与页面用的是同一份清单。
 */

import { useLocale, useI18n } from '@heyta/i18n/provider';

import { FaqList } from '../site/FaqList.js';
import { docsOutline } from '../site/docs.js';
import { PageHead, RichText } from '../site/PageSections.js';
import { siteHref } from '../site/paths.js';
import type { SitePage } from '../site/pages.js';

export function HelpPage({ page }: { page: SitePage }): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();

  return (
    <>
      <PageHead page={page} />
      <div className="lp-section">
        <div className="lp-wrap">
          <h2 className="lp-h2">{t('site.help.topics.title')}</h2>
          {docsOutline().map(({ module, articles }) => {
            const hasDeepRead = articles.length > 0;
            return (
              <section key={module.id} id={module.id} className="lp-help__module">
                <h3 className="lp-h3">{t(module.titleKey)}</h3>

                {hasDeepRead ? (
                  <p className="lp-docs__eyebrow">{t('site.docs.hub.faq')}</p>
                ) : null}
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
          })}
        </div>
      </div>
    </>
  );
}
