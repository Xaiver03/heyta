/**
 * 落地页入口。
 *
 * 与 `apps/web` 的入口一致地**先引 token 再引组件样式** ——
 * 顺序反过来会让组件样式里的 `var(--ht-*)` 在首帧解析不到值。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { I18nProvider } from '@heyta/i18n';

import '@heyta/design-system/tokens.css';
import '@heyta/design-system/reset.css';
import './styles/landing.css';

import { Landing } from './Landing.js';
import { localeFromPath } from './lib/locale.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('找不到挂载点 #root');
}

/**
 * 语言**由路径决定**，只在这里读一次。
 *
 * `/en/` → 英文，其余 → 中文。不用 localStorage，也不按 Accept-Language 自动跳转 ——
 * 理由写在 `src/lib/locale.ts` 的文件头（一句话：中英两版要能各自被收录、各自被分享）。
 *
 * 组件树一行都不用知道这件事：`useI18n` 从 context 取语言。
 */
const locale = localeFromPath(window.location.pathname);

createRoot(container).render(
  <StrictMode>
    <I18nProvider locale={locale}>
      <Landing />
    </I18nProvider>
  </StrictMode>,
);
