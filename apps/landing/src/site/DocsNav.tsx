/**
 * 文档中心的侧栏
 * ================
 *
 * 🔴 **它画的不是"这一篇的目录"，而是整个文档中心的形状。**
 *
 * 两种侧栏看起来都合理，作用完全不同：
 *   - 「本页内容」(目录) 帮的是**正在读这一篇**的人；
 *   - 「全部文档」(地图) 帮的是**读完了这一篇、接下来读什么**的人。
 * 帮助中心只有六篇文章、每篇三节，目录的信息量抵不上它在页面上占的那一列；
 * 而"原来还有这一篇"才是这个站点此刻缺的东西 —— 读者是从一个具体问题进来的，
 * 他不知道旁边还站着四个他没问的问题。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 两条来自 `docs.ts` 的结构约束，这里是它们的落点：
 *
 *   1. **分组词表一个词都没造、也没再列一遍** —— 侧栏的分组与顺序就是
 *      `docsOutline()` 给的，而它派生自 `content.ts` 的 `HELP_MODULES`。
 *      帮助中心改一个分类名或调一次顺序，这一列跟着变。帮助中心与文档中心是
 *      **同一个 IA 的两层深度**，两套分类名必然漂移。
 *   2. **没有内容就不出现链接** —— 只有 `sync` / `data` 两个模块下有文章，
 *      另外三个模块在这里**不渲染标题**（一个只有标题没有条目的分组，
 *      读起来像渲染坏了）。
 *
 * ⚠️ 当前文章用 `aria-current="page"` 标出来，样式走**属性选择器**
 * （`.lp-docs__link[aria-current]`）而不是再打一个 class ——
 * 与 `.lp-status[data-status]` 同一条纪律：状态只有一份事实源，
 * 加一档/一态时不会出现"新状态忘了写 class 于是没有样式"。
 */

import { useI18n, useLocale } from '@heyta/i18n/provider';

import { docsOutline } from './docs.js';
import { pageById, type SitePage } from './pages.js';
import { siteHref } from './paths.js';

export function DocsNav({ page }: { page: SitePage }): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();
  /** 侧栏顶部那条回帮助中心的链接 —— 落点是注册表里的 `help`，不是写死的 `/help`。 */
  const hub = pageById('help');

  return (
    <nav className="lp-docs__nav" aria-label={t('site.docs.nav.title')}>
      <a className="lp-docs__back" href={siteHref(hub, locale)}>
        {t('site.docs.nav.back')}
      </a>

      {docsOutline().map(({ module, articles }) => {
        if (articles.length === 0) return null;
        return (
          <div key={module.id} className="lp-docs__group">
            <p className="lp-docs__group-title">{t(module.titleKey)}</p>
            <ul className="lp-docs__list">
              {articles.map((article) => (
                <li key={article.id}>
                  <a
                    className="lp-docs__link"
                    href={siteHref(article, locale)}
                    {...(article.id === page.id ? { 'aria-current': 'page' as const } : {})}
                  >
                    {t(article.labelKey)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
