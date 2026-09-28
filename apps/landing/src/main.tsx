/**
 * 落地页入口。
 *
 * 与 `apps/web` 的入口一致地**先引 token 再引组件样式** ——
 * 顺序反过来会让组件样式里的 `var(--ht-*)` 在首帧解析不到值。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **这个文件只回答两个问题：这是哪一页、哪种语言。**
 *
 * 两者都从**地址**读出来（`pageFromPath` / `localeFromPath`），因为它们是
 * URL 的两个维度：`/features/` 与 `/en/features/` 是同一页的两种语言版本，
 * 而不是两页。所以页面注册表里的 `path` **不含语言前缀** ——
 * 写成 `/en/features` 两条，语言切换器、hreflang、sitemap 就都要各自判断一次，
 * 而那三处必然漂移（理由见 `src/site/pages.ts` 的 `SitePage.path`）。
 *
 * 分派之后交给 `SiteLayout`：导航、页脚、主题都只有那一份。
 * 于是**新增页面拿不到"自己画一个导航"的机会**，也拿不到"忘了放页脚"的机会。
 *
 * 入口 HTML 由 `scripts/gen-entries.mjs` 从同一份注册表生成（12 份 =
 * 6 个页面 × 2 种语言 + 首页两版），所以这里的每一页都有一个**真静态地址**：
 * 首屏不用等 JS、爬虫拿到的是完整 head。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { I18nProvider } from '@heyta/i18n';

import '@heyta/design-system/tokens.css';
import '@heyta/design-system/reset.css';
import './styles/landing.css';

import { PAGE_COMPONENTS } from './pages/index.js';
import { SiteLayout } from './site/SiteLayout.js';
import { localeFromPath, pageFromPath } from './site/paths.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('找不到挂载点 #root');
}

/**
 * 语言**由路径决定**，只在这里读一次。
 *
 * `/en/` → 英文，其余 → 中文。不用 localStorage，也不按 Accept-Language
 * 自动跳转 —— 理由写在 `src/lib/locale.ts` 的文件头（一句话：中英两版要能
 * 各自被收录、各自被分享）。组件树一行都不用知道这件事：`useI18n` 从 context 取。
 */
const locale = localeFromPath(window.location.pathname);

/**
 * 当前页面。**认不出就回落到首页**（`pageFromPath` 的契约）——
 * 访客可能访问了一个旧链接、拼错的地址，或将来某个被删掉的页面，
 * 那时应当渲染首页（nginx 的 SPA 兜底本来也是这样），而不是白屏。
 */
const page = pageFromPath(window.location.pathname);
const Page = PAGE_COMPONENTS[page.id];

createRoot(container).render(
  <StrictMode>
    <I18nProvider locale={locale}>
      <SiteLayout page={page}>
        <Page page={page} />
      </SiteLayout>
    </I18nProvider>
  </StrictMode>,
);
