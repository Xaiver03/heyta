/**
 * `/features`：功能介绍
 * ========================
 *
 * 写作纪律全在 `src/site/content.ts` 里（只收录已实现的能力）。
 * 这个文件刻意只有一行 —— 页面是"页头 + 一张 key 清单"的函数，
 * 而清单在 `content.ts`、文案在词条表。
 *
 * A1-2 要求每个模块配**真实界面**的素材。现在已经有的 DOM 复现件
 * （`src/mockup/`）挂在首页的展厅里；把其中几件搬进这一页属于 W2 的内容工作，
 * 而**不能**用截图代替 —— 截图会过期，DOM 复现件跟着设计系统走。
 */

import { SiteSubPage } from '../site/PageSections.js';
import {FEATURE_SECTIONS, FEATURE_NOTES} from '../site/content.js';
import type { SitePage } from '../site/pages.js';

export function FeaturesPage({ page }: { page: SitePage }): React.JSX.Element {
  return <SiteSubPage page={page} notes={FEATURE_NOTES} sections={FEATURE_SECTIONS} />;
}
