/**
 * `/integrations`：我们独有的能力（数据主权 + 对照滴答清单）
 * ============================================================
 *
 * 写作纪律与素材来源全在 `src/site/content.ts` 的 `INTEGRATION_SECTIONS` 上，
 * 这个文件刻意只有一行 —— 页面是"页头 + 一张 key 清单"的函数，
 * 清单在 `content.ts`、文案在词条表。
 *
 * ⚠️ **它不是「集成列表」**：URL 叫 `integrations`，讲的却是
 * "凭什么把数据交给这个产品"（端到端加密 / 自建 / 本机 API / BYOK / 导出）
 * 以及"我们和滴答清单差在哪"（不按功能收费、四象限是派生视图、
 * 默认关 + 逐工具授权）。名字保留是为了不与站点既有链接漂移。
 */

import { SiteSubPage } from '../site/PageSections.js';
import { INTEGRATION_NOTES, INTEGRATION_SECTIONS } from '../site/content.js';
import type { SitePage } from '../site/pages.js';

export function IntegrationsPage({ page }: { page: SitePage }): React.JSX.Element {
  return <SiteSubPage page={page} notes={INTEGRATION_NOTES} sections={INTEGRATION_SECTIONS} />;
}
