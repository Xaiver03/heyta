/**
 * 产品介绍演示入口
 * =================
 *
 * ⚠️ 这一页**不进站点注册表**（`src/site/pages.ts`）—— 它不是站点的一页，
 * 不出现在导航 / 页脚 / sitemap 里，也不参与 `gen:entries`。
 * 它是给演讲用的一份独立产物，由 `apps/landing/vite.pitch.config.ts` 单独打包。
 *
 * 🔴 **界面页一律复用 `src/mockup/` 的真实复现件**，不在这里另画一套 UI。
 * 那批组件从 `app-shell-shape.ts` 的登记处派生，而登记处与 `apps/web/src/App.tsx`
 * 的源码由 `tests/mockup-shell-shape.spec.tsx` 逐项对账 ——
 * 手抄一份 = 立刻失去这道对账，且漂移没有任何门禁看得见。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { I18nCatalogProvider, type Catalog } from '@heyta/i18n/provider';

import '@heyta/design-system/tokens.css';
import '@heyta/design-system/reset.css';
import '@heyta/design-system/typography.css';
import './pitch.css';

import { PitchDeck } from './PitchDeck.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('找不到挂载点 #root');
}

void (async () => {
  // 演示面向中文受众，固定取 zh-CN；与 main.tsx 一样用**静态字面量**的 import()，
  // 拼成变量会让英文表也被打进产物。
  const catalog: Catalog = (await import('@heyta/i18n/zh-CN')).zhCN;
  createRoot(container).render(
    <StrictMode>
      <I18nCatalogProvider locale="zh-CN" catalog={catalog}>
        <PitchDeck />
      </I18nCatalogProvider>
    </StrictMode>,
  );
})();
