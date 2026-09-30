/**
 * `/features`：功能介绍
 * ========================
 *
 * 写作纪律全在 `src/site/content.ts` 里（只收录已实现的能力）。
 * 页面是"页头 + 一张 key 清单"的函数：清单在 `content.ts`、文案在词条表。
 *
 * 🔴 页头配**真实界面**的复现件（`src/mockup/`），不用截图 ——
 * 截图会过期，DOM 复现件跟着设计系统走。选 `quadrant` 视图与首页 Hero
 * 的 `tasks` 区分开：这一页的论点是"多种视图、一种数据"。
 */

import { AppWindow } from '../mockup/AppWindow.js';
import { SiteSubPage } from '../site/PageSections.js';
import { FEATURE_SECTIONS, FEATURE_NOTES } from '../site/content.js';
import type { SitePage } from '../site/pages.js';

export function FeaturesPage({ page }: { page: SitePage }): React.JSX.Element {
  return (
    <SiteSubPage
      page={page}
      notes={FEATURE_NOTES}
      sections={FEATURE_SECTIONS}
      visual={<AppWindow view="quadrant" />}
    />
  );
}
