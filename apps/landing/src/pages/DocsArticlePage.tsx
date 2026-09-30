/**
 * 文档中心的一篇文章
 * ====================
 *
 * 布局是 SSOS 那套帮助文档的形状：**页头通栏，正文两栏**（左：文档中心地图，
 * 右：这一篇），窄屏退回单栏并把侧栏**放到正文之后** ——
 * 手机上先给答案，"接下来读什么"是读完了才需要的事。
 *
 * 🔴 **正文一格代码都没写在这里。** 它走 `PageSections` —— 与 `/features`、
 * `/platforms` 同一套渲染器（分区标题、段落、并列条目、锚点 `id` 全同形）。
 * 文档中心一旦自己画一遍正文，它就和站点的其它页面开始分叉（字体、行高、
 * 留白各调一套），而那正是 N4 拦的"两个站点拼起来"的观感。
 *
 * 🔴 **页头也只有一份**：`PageHead`，只是把那颗主行动按钮关掉（`cta={false}`）。
 * 读 `/help/passphrase` 的人正在解决一件具体的事 —— 把"立即使用"塞在答案前面
 * 是打断，不是导流（理由写在 `PageHead` 的 `cta` 注释里）。
 *
 * ⚠️ 文章**不配图**：`sections` 里没有 `mockView`。界面复现件是给"这东西长什么样"
 * 用的，而这一层回答的是"这件事怎么办"，配一张图就是装饰。
 */

import { DocsNav } from '../site/DocsNav.js';
import { docsArticleById } from '../site/docs.js';
import { PageHead, PageSections } from '../site/PageSections.js';
import type { SitePage } from '../site/pages.js';

export function DocsArticlePage({ page }: { page: SitePage }): React.JSX.Element {
  const article = docsArticleById(page.id);

  return (
    <>
      <PageHead page={page} cta={false} />
      <div className="lp-section">
        <div className="lp-docs">
          <DocsNav page={page} />
          <PageSections sections={article.sections} />
        </div>
      </div>
    </>
  );
}
