/**
 * 文档中心的一个分类页（`/docs/sync`、`/docs/data`）
 * ==================================================
 *
 * 🔴 **它是"这一分类的全部"，不是又一篇长文。**
 *
 * 访客从这里得到的东西和从 `/docs` 那一块得到的完全一样（同一组速答 + 同一组
 * 文章卡），只是**独占一页** —— 于是"同步"这件事有了一个可以发出去的地址：
 * 应用里那句"同步出错了"能落到 `/docs/sync/`，而不是落到帮助中心整页
 * 让人自己滚。正文块本身**不在这里重写**，走 `DocsModuleBlock`（理由见那个文件头）。
 *
 * ⚠️ **只给"有文章"的分类建页**（`docs.ts` 的 `DOCS_CATEGORY_MODULES` 就是那份清单）。
 * 只有速答的分类出一张分类页，页面上会是一个重复的标题加一份重复的问答 ——
 * 而 `/docs` 上那个入口就变成"点了没反应的问题"，那正是帮助内容最不能有的形态。
 *
 * ⚠️ 侧栏用的是**文章页那一套**（`DocsLayout`）：分类页不是文档中心之外的一页，
 * 它就是那一列地图上当前的**分组**。当前分组的高亮走 `aria-current="true"`
 * （不是 `"page"` —— 那个值留给"就是这一篇"，见 `DocsNav.tsx` 文件头）。
 */

import { DocsLayout } from '../site/DocsLayout.js';
import { docsCategoryById } from '../site/docs.js';
import { DocsModuleBlock } from '../site/DocsModule.js';
import { PageHead } from '../site/PageSections.js';
import type { SitePage } from '../site/pages.js';

export function DocsCategoryPage({ page }: { page: SitePage }): React.JSX.Element {
  const { module, articles } = docsCategoryById(page.id);

  return (
        <DocsLayout page={page}>
          <article className="lp-docs__body">
            <PageHead page={page} cta={false} />
            <DocsModuleBlock module={module} articles={articles} withHeading={false} />
          </article>
        </DocsLayout>
  );
}
