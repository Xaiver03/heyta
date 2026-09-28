/**
 * 站点外壳：导航 + 正文 + 页脚
 * =================================
 *
 * 🔴 **每一页都必须从这里出去。** 这不是为了少写几行 JSX，而是 N4
 * （"不出现两个站点拼起来"）唯一能落地的位置：
 *
 *   - 导航、页脚、跳转链接、主题状态**只有这一份**；
 *   - 新增一个页面时，它拿不到"自己画一个导航"的机会 —— 它也拿不到
 *     "忘了放页脚"的机会。这两种事故就是上一版的形态：整站只有一个页面，
 *     所以 Nav/Footer 写在 `Landing.tsx` 里没出问题；一旦有第二个页面，
 *     它们要么被复制一份（漂移），要么被漏掉（页面没有出口）。
 *
 * 主题状态（`useTheme`）提到这一层同理：它是**每个页面共享**的，
 * 放在页面组件里会让每个页面各自持有一份，而它们是同一个 `<html data-theme>`。
 *
 * 与 `main.tsx` 的分工：`main.tsx` 只负责"这是哪一页、哪种语言"，
 * 然后把它交给这里；这里不读地址栏。
 */

import type { ReactNode } from 'react';

import { useI18n } from '@heyta/i18n';

import { Nav } from '../components/Nav.js';
import { Footer } from '../components/Footer.js';
import type { SitePage } from './pages.js';
import { useTheme } from '../lib/theme.js';

export function SiteLayout({
  page,
  children,
}: {
  page: SitePage;
  children: ReactNode;
}): React.JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();

  /**
   * 首页不加 `.lp-page`。
   *
   * `.lp-page` 只做一件事：给**子页面**补上被固定导航盖住的那段顶部留白。
   * 首页的眉标/H1 在英雄区里已经有自己的节奏，再叠一层会把首屏推下去 ——
   * 而"多了一个类"这种差别在截图里几乎看不出来，所以在这里写明。
   */
  const isHome = page.path === '/';

  return (
    <div className="lp">
      <a className="lp-skip" href="#main">
        {t('landing.skipLink')}
      </a>

      <Nav page={page} theme={theme} onToggleTheme={toggleTheme} />

      <main id="main" {...(isHome ? {} : { className: 'lp-page' })}>
        {children}
      </main>

      <Footer />
    </div>
  );
}
