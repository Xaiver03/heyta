/**
 * `/changelog`：更新动态
 * =========================
 *
 * 🔴 **日期排在标题前面，而且是一条 `<time datetime>`**：这一页唯一的用途是
 * 回答"这东西还在维护吗"，而那个问题的答案就是"最近一次改动是什么时候"。
 * 把日期藏在正文里等于没回答。
 *
 * ⚠️ 首版是**手工整理**的（依据 A4-3），条目清单在 `src/site/content.ts` 的
 * `CHANGELOG_ENTRIES` 里。每一条都对应真实发生过的改动 ——
 * **不写"即将推出"**：一份编年史里最不能出现的是一句还没兑现的承诺。
 *
 * ⚠️ 它**不进顶部导航**（见 `pages.ts` 的 changelog 条目）：更新动态只有用过
 * 的人关心，那种人从应用里点进来（A6-6），或者顺手在页脚找。
 * 而页脚里**一定有一条** —— 那是"没有孤立路由"这条约束的兜底。
 */

import { useI18n } from '@heyta/i18n';

import { KeyText, PageHead, RichText } from '../site/PageSections.js';
import { CHANGELOG_ENTRIES, CHANGELOG_NOTES } from '../site/content.js';
import type { SitePage } from '../site/pages.js';

export function ChangelogPage({ page }: { page: SitePage }): React.JSX.Element {
  const { t } = useI18n();

  return (
    <>
      <PageHead page={page} />
      <div className="lp-section">
        <div className="lp-wrap">
          <ol className="lp-log">
            {/*
              `key` 用「日期 + 标题 key」而不是只用日期：一天里可以有多条
              （2026-09-28 就有三条），只用日期会让 React 把它们当成同一个节点。
            */}
            {CHANGELOG_ENTRIES.map((entry) => (
              <li key={`${entry.date}-${entry.titleKey}`} className="lp-log__item">
                <time className="lp-log__date" dateTime={entry.date}>
                  {entry.date}
                </time>
                <div className="lp-log__body">
                  <h2 className="lp-log__title">
                    <KeyText messageKey={entry.titleKey} />
                  </h2>
                  <p className="lp-prose">
                    <KeyText messageKey={entry.bodyKey} />
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {CHANGELOG_NOTES.map((key) => (
            <p key={key} className="lp-note">
              <RichText text={t(key)} />
            </p>
          ))}
        </div>
      </div>
    </>
  );
}
