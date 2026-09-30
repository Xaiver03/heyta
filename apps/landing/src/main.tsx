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
 * 入口 HTML 由 `scripts/gen-entries.mjs` 从同一份注册表生成，所以这里的每一页
 * 都有一个**独立地址**，且爬虫拿到的 head 是完整的（title / description /
 * canonical / hreflang / og / JSON-LD 都在静态 HTML 里）。
 *
 * ⚠️ **口径更正（2026-09-28，ADR-0033 §7.1）**：这里原先写的是"首屏不用等 JS"
 * —— **实测证伪**（生成的入口里 `#root` 是空容器，正文仍由 React 挂载）。
 * 兑现的是"静态 head + 独立地址"，不是"无 JS 首屏"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **按语言动态 import 词条表（R7）**
 *
 * 在此之前 `@heyta/i18n` 的根入口同时 import 中英两份表（合计约 **93 KB gz**，
 * 而主包共约 195 KB gz），于是 `/signin/` 要为它永远用不到的英文表付一半体积。
 * 现在：
 *   · hooks 从 `@heyta/i18n/provider` 取（**不含任何表**）；
 *   · 表按当前入口的语言**动态** import —— 另一种语言的 chunk 根本不会被下载；
 *   · `I18nCatalogProvider` 的 `catalog` 必填，所以"忘了给表"是编译期错误，
 *     而不是运行时渲染成另一种语言。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { I18nCatalogProvider, type Catalog, type Locale } from '@heyta/i18n/provider';

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
const locale: Locale = localeFromPath(window.location.pathname);

/**
 * 当前页面。**认不出就回落到首页**（`pageFromPath` 的契约）——
 * 访客可能访问了一个旧链接、拼错的地址，或将来某个被删掉的页面，
 * 那时应当渲染首页（nginx 的 SPA 兜底本来也是这样），而不是白屏。
 */
const page = pageFromPath(window.location.pathname);
const Page = PAGE_COMPONENTS[page.id];

/**
 * 取当前语言的词条表。
 *
 * 🔴 **两个 `import()` 都必须是静态字面量** —— 拼成变量会让打包器无法静态
 * 分析，于是两份表又都进了主包，而症状是**代码看着对了、包一点没小**。
 */
async function loadCatalog(target: Locale): Promise<Catalog> {
  return target === 'en'
    ? (await import('@heyta/i18n/en')).en
    : (await import('@heyta/i18n/zh-CN')).zhCN;
}

void (async () => {
  const catalog = await loadCatalog(locale);
  createRoot(container).render(
    <StrictMode>
      <I18nCatalogProvider locale={locale} catalog={catalog}>
        <SiteLayout page={page}>
          <Page page={page} />
        </SiteLayout>
      </I18nCatalogProvider>
    </StrictMode>,
  );
})();
