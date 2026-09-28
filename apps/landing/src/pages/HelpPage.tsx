/**
 * `/help`：帮助中心
 * ====================
 *
 * 组织方式是**按你在做什么**（问题模块），不是按文档类型 —— 借滴答清单帮助中心
 * 实测出来的结论（`docs/research/dida365-help-center-ia.md`），但内容**另写**：
 * `docs/` 里有 ADR、迁移纪律、环境陷阱，直接暴露既看不懂又泄露实现细节。
 *
 * ⚠️ 首版把答案写在**这一页里**，没有拆成文章路由 —— 十篇文章就是十条新路由，
 * 而"文章还没写"的那些链接会变成 404。一个帮助中心里最不能出现的
 * 就是"点了没反应的问题"。体积长大之后再拆，届时用同一份清单派生。
 *
 * 🔴 **模块划分与问答清单都在 `src/site/content.ts`**（`HELP_MODULES`），
 * 这个文件只负责画出来 —— 于是"加一篇帮助"永远只有一处要改，
 * 而 `FAQPage` 结构化数据与页面用的是同一份清单。
 */

import { FaqList } from '../site/FaqList.js';
import { PageHead } from '../site/PageSections.js';
import { HELP_MODULES } from '../site/content.js';
import { useI18n } from '@heyta/i18n';
import type { SitePage } from '../site/pages.js';

export function HelpPage({ page }: { page: SitePage }): React.JSX.Element {
  const { t } = useI18n();

  return (
    <>
      <PageHead page={page} />
      <div className="lp-section">
        <div className="lp-wrap">
          <h2 className="lp-h2">{t('site.help.topics.title')}</h2>
          {HELP_MODULES.map((module) => (
            <section key={module.id} id={module.id} className="lp-help__module">
              <h3 className="lp-h3">{t(module.titleKey)}</h3>
              <FaqList pairs={module.pairs} />
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
