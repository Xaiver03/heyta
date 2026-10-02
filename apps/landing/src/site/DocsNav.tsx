import { ICON_SIZE } from '@heyta/design-system';
/**
 * 文档中心的侧栏
 * ================
 *
 * 🔴 **它画的是整个文档中心的形状，不是"这一篇的目录"。**
 *
 * 两种侧栏看起来都合理，作用完全不同：
 *   - 「本页内容」(目录) 帮的是**正在读这一篇**的人；
 *   - 「全部文档」(地图) 帮的是**读完了这一篇、接下来读什么**的人。
 * 这一列给的是后者，页内目录另有其人（`DocsToc`，在正文那一列的顶部），
 * 两者不冲突：一个回答"我在哪"，一个回答"这一页里我要跳到哪节"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三条来自 `docs.ts` 的结构约束，这里是它们的落点：
 *
 *   1. **分组词表一个词都没造、也没再列一遍** —— 侧栏的分组与顺序就是
 *      `docsOutline()` 给的，而它派生自 `content.ts` 的 `HELP_MODULES`。
 *      帮助中心改一个分类名或调一次顺序，这一列跟着变。帮助中心与文档中心是
 *      **同一个 IA 的两层深度**，两套分类名必然漂移。
 *   2. **没有内容就不出现链接** —— 一个只有标题没有条目的分组，读起来像渲染坏了，
 *      所以标题跟着条目走。⚠️ 2026-09-30 实测**五个分组都有文章**，这条过滤当前
 *      一个都没拦住 —— 保留它是因为哪天某个分类只剩速答时，它仍该是那条规则，
 *      而不是"某个模块硬编码有文章"。
 *   3. **分组标题本身就是那一分类的入口** —— 有分类页时它是 `<a>`，
 *      没有时它是 `<p>`。分类页只给"有文章"的分类建，所以这两档
 *      和上面第 2 条其实是同一个判据的两种写法。
 *
 * ⚠️ 当前文章用 `aria-current="page"` 标出来，样式走**属性选择器**
 * （`.lp-docs__link[aria-current]`）而不是再打一个 class ——
 * 与 `.lp-status[data-status]` 同一条纪律：状态只有一份事实源，
 * 加一档/一态时不会出现"新状态忘了写 class 于是没有样式"。
 * 当前**分类**用的是 `aria-current="true"`（它不是"就是这一页的文章"，
 * 是"这一组正展开着的是本页"）—— 两个值不同，所以"侧栏恰好只高亮一篇"
 * 那条判据不会被分类页顶掉。
 *
 * ⚠️ 折叠状态**不在这里存**（`collapsed` / `onToggle` 由 `DocsLayout` 持有）：
 * 窄屏时侧栏在抽屉里还有一份，各存各的就会出现"抽屉里收了、外面还摊着"。
 */

import { useId } from 'react';

import { useI18n, useLocale } from '@heyta/i18n/provider';
import { ChevronDown } from 'lucide-react';

import { docsCategoryOfModule, docsOutline } from './docs.js';
import { pageById, type SitePage } from './pages.js';
import { siteHref } from './paths.js';

export function DocsNav({
  page,
  collapsed,
  onToggle,
}: {
  page: SitePage;
  /** 收起的分组 id 清单（事实源在 `DocsLayout`，见文件头）。 */
  collapsed: readonly string[];
  onToggle: (moduleId: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();
  /** 侧栏顶部那条回帮助中心的链接 —— 落点是注册表里的 `help`，不是写死的 `/help`。 */
  const hub = pageById('help');
  /**
   * `aria-controls` 要指向一个**本页唯一**的 id，而窄屏时本页有两份侧栏
   * （正文左边 + 抽屉）。用 `useId()` 而不是 `lp-docs-list-${module.id}`，
   * 后者会把 id 撞成两个 —— 撞了 id 的 `aria-controls` 读屏软件只会认第一个。
   */
  const scope = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  return (
    <nav className="lp-docs__nav" aria-label={t('site.docs.nav.title')}>
      <a className="lp-docs__back" href={siteHref(hub, locale)}>
        {t('site.docs.nav.back')}
      </a>

      {docsOutline().map(({ module, articles }) => {
        if (articles.length === 0) return null;
        const category = docsCategoryOfModule(module.id);
        const open = !collapsed.includes(module.id);
        const listId = `lp-docs-${scope}-${module.id}`;
        return (
          <div key={module.id} className="lp-docs__group">
            <div className="lp-docs__group-head">
              {category === undefined ? (
                <p className="lp-docs__group-title">{t(module.titleKey)}</p>
              ) : (
                <a
                  className="lp-docs__group-link"
                  href={siteHref(category.page, locale)}
                  {...(category.page.id === page.id ? { 'aria-current': 'true' as const } : {})}
                >
                  {t(module.titleKey)}
                </a>
              )}
              <button
                type="button"
                className="lp-docs__toggle"
                aria-expanded={open}
                aria-controls={listId}
                aria-label={t('site.docs.nav.toggle')}
                onClick={() => onToggle(module.id)}
              >
                <ChevronDown size={ICON_SIZE.xs} aria-hidden="true" />
              </button>
            </div>
            <ul className="lp-docs__list" id={listId} hidden={!open}>
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
