import { ICON_SIZE } from '@heyta/design-system';
/**
 * 文档中心的独立外壳（SSOS 文档站同构）
 * =====================================
 *
 * 🔴 **文档中心不再是营销站的一页。** 2026-10-01 产品负责人对照 SSOS 帮助中心
 * （docs.finlaw.cloud）拍板：文档站要有**自己的外壳** —— 自己的 topnav
 * （帮助中心 logo + 搜索 + 明暗切换 + 「打开 heyta」）、自己的页脚，
 * 与营销官网彻底分离；正文是**三列**：左＝全站文章目录，中＝文章，
 * 右＝文章内部的目录（`DocsToc`，sticky + 滚动跟随高亮）。
 *
 * 与营销站 `SiteLayout` 的分界写在 `main.tsx`：注册表条目**有 `docsKind`**
 * 就走这个外壳，没有就走 `SiteLayout`。枢纽（/docs）与文章、分类页同用一个
 * 外壳 —— 访客从营销站点「帮助」进来之后，就一直待在文档站的语境里，
 * 直到点「打开 heyta」回到应用。
 *
 * ⚠️ 搜索从正文区**搬进 topnav**（SSOS 同位）：它属于"这个站的全局工具"，
 * 不属于某一页的正文；搬进去之后全页恰好一个搜索框的判据继续成立，
 * 且窄屏不再有"想搜索先开抽屉"的问题。
 */

import type { ReactNode } from 'react';

import { useI18n } from '@heyta/i18n/provider';
import { Moon, Sun } from 'lucide-react';

import { startCta } from '../lib/app-url.js';
import { useTheme } from '../lib/theme.js';
import { GITHUB_URL } from '../lib/repo.js';
import { DocsSearch } from './DocsSearch.js';
import '../styles/docs-layout.css';
import { pageById } from './pages.js';
import { siteHref } from './paths.js';

export function DocsShell({ children }: { children: ReactNode }): React.JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const { t, locale } = useI18n();
  const hub = pageById('help');
  const home = pageById('home');

  // 主题按钮的可访问名取决于当前主题（说的是"切到哪去"）——与营销站 Nav 同一条纪律。
  const themeToggleLabel =
    theme === 'light' ? t('common.a11y.toDarkTheme') : t('common.a11y.toLightTheme');

  // 「打开 heyta」与营销站 Nav 的 CTA 同一个判据（lib/app-url.ts）：
  // 未配置 VITE_APP_URL 时整条入口不渲染 —— 仓库默认构建就是未配置，这是故意的。
  const cta = startCta(locale);

  return (
    <div className="lp-docs-site">
      <a className="lp-skip" href="#main">
        {t('landing.skipLink')}
      </a>

      <header className="lp-docs-topnav">
        <div className="lp-docs-topnav__inner">
          <a className="lp-docs-topnav__logo" href={siteHref(hub, locale)}>
            <span className="lp-docs-topnav__brand">{t('common.brand')}</span>
            <span className="lp-docs-topnav__site">{t('site.docs.shell.title')}</span>
          </a>

          <a className="lp-docs-topnav__home" href={siteHref(home, locale)}>
            {t('site.docs.nav.home')}
          </a>

          <DocsSearch />

          <div className="lp-docs-topnav__actions">
            <button
              type="button"
              className="lp-docs-topnav__theme"
              aria-label={themeToggleLabel}
              onClick={toggleTheme}
            >
              {theme === 'light' ? <Moon size={ICON_SIZE.sm} aria-hidden="true" /> : <Sun size={ICON_SIZE.sm} aria-hidden="true" />}
            </button>
            {cta.external ? (
              <a className="lp-docs-topnav__cta" href={cta.href} rel="noopener noreferrer">
                {t(cta.labelKey)}
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="lp-docs-footer">
        <div className="lp-docs-footer__inner">
          <p className="lp-docs-footer__brand">{t('common.brand')}</p>
          <p className="lp-docs-footer__meta">{t('landing.footer.licenseNote')}</p>
          <a
            className="lp-docs-footer__link"
            href={GITHUB_URL}
          >
            {t('landing.footer.viewOnGithub')}
          </a>
        </div>
      </footer>
    </div>
  );
}
