/**
 * 文档中心的一篇文章
 * ====================
 *
 * 布局是 SSOS 那套帮助文档的形状：**页头通栏，正文两栏**（左：文档中心地图，
 * 右：这一篇），窄屏退回单栏并把侧栏**放到正文之后** ——
 * 手机上先给答案，"接下来读什么"是读完了才需要的事。
 * 这一层由 `DocsLayout` 持有（它还要管分组折叠与移动端抽屉，见那个文件头）。
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
 * ⚠️ 正文上方那一排是 `DocsToc`：条目**直接从 `article.sections` 推出来**，
 * 和下面渲染出的 `<section id>` 是同一份数据，所以"目录少了新的一节"
 * 这种事结构上发生不了。
 *
 * 🔴 **配图只挂在 `zh-CN`**。这不是省事，是那一层唯一的图**全是中文界面**：
 * 采集脚本把 `locale: 'zh-CN'` 写死在判卷文件里（`scripts/screenshots/capture.mjs`，
 * 本轮不许改），18 张产物都是中文 UI。把中文界面放进英文文章，等于让访客自己
 * 脑补"我那个英文按钮在这儿长什么样"。缺的是**英文界面的采集能力**，不是配图 ——
 * 补法与影响记在 `BLOCKED.md`；判据（哪一版渲染图）就在下面这一行，不在样式表里。
 */

import { useLocale } from '@heyta/i18n/provider';

import { DocsLayout } from '../site/DocsLayout.js';
import { docsArticleById, docsFiguresOf } from '../site/docs.js';
import { DocsToc } from '../site/DocsToc.js';
import { PageHead, PageSections } from '../site/PageSections.js';
import type { SitePage } from '../site/pages.js';

export function DocsArticlePage({ page }: { page: SitePage }): React.JSX.Element {
  const article = docsArticleById(page.id);
  const locale = useLocale();

  return (
    <>
      <PageHead page={page} cta={false} />
      <div className="lp-section">
        <DocsLayout page={page}>
          <div className="lp-docs__body">
            <DocsToc sections={article.sections} />
            <PageSections
              sections={article.sections}
              figures={locale === 'zh-CN' ? docsFiguresOf(article) : []}
            />
          </div>
        </DocsLayout>
      </div>
    </>
  );
}
