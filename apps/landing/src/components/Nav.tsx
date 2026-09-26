/**
 * 悬浮导航
 * ==========
 *
 * 两条来自设计系统的规则，这里必须遵守：
 *   1. **导航高度 ≤ 80px，桌面端单行**（MASTER.md / taste skill 都要求）。
 *      用了 `--ht-layout-header-height`（56px）。
 *   2. 材质只叠在**滚动内容**上，不叠在另一个半透明面上
 *      （tokens.css §3d 硬规则 2）—— 所以这里只有一层。
 *
 * 交互：滚动超过一屏的 24px 后，导航从"贴着页面"变成"浮在内容上"
 * （加重阴影）。这是 Apple 的 **scroll edge effect** ——
 * 用材料变化表达"内容从下面过去了"，而不是加一条硬分割线。
 */

import { useMemo, useState } from 'react';
import { motion, useMotionValueEvent, useScroll } from 'motion/react';
import { Github, Moon, Sun } from 'lucide-react';

import { useI18n, useLocale } from '@heyta/i18n';

import { otherLocaleHref } from '../lib/locale.js';
import { useMotionPreset } from '../lib/motion.js';
import type { Theme } from '../lib/theme.js';
import { BrandMark } from './BrandMark.js';

export const GITHUB_URL = 'https://github.com/Xaiver03/heyta';

export function Nav({
  theme,
  onToggleTheme,
}: {
  theme: Theme;
  onToggleTheme: () => void;
}): React.JSX.Element {
  const preset = useMotionPreset();
  const { scrollY } = useScroll();
  const [floating, setFloating] = useState(false);
  const { t } = useI18n();

  /**
   * 锚点与 `Landing.tsx` 里各区块的 `id` 必须一致 —— 写错了只是"点了没反应"。
   *
   * 挪进组件内是文案迁移的硬要求：模块级拿不到 `t`。取舍见 `Landing.tsx` 文件头。
   */
  const links = useMemo(
    () => [
      { href: '#capabilities', label: t('landing.nav.capabilities') },
      { href: '#showcase', label: t('landing.nav.showcase') },
      { href: '#sync', label: t('landing.nav.sync') },
      { href: '#selfhost', label: t('landing.nav.selfhost') },
    ],
    [t],
  );

  // 主题按钮的可访问名取决于**当前主题**（说的是"切到哪去"）。先把词条取出来再绑。
  // 不要在无障碍名属性的三元分支里直接内联两个 `t(...)`：门禁的花括号扫描会把
  // 分支里的 key 字面量当成硬编码文案（它只认"字面量紧跟在 `t(` 之后"这一种形状）。
  const themeToggleLabel =
    theme === 'light' ? t('common.a11y.toDarkTheme') : t('common.a11y.toLightTheme');

  /**
   * 语言切换器。
   *
   * 🔴 它显示的是**目标语言自己的文字**（`中文` / `English`），不是把"英文"
   * 翻译成当前语言。看不懂当前语言的用户，恰恰是最需要找到这个入口的人 ——
   * 把入口的名字写成他看不懂的另一种文字，等于没给入口。
   * 所以 `common.lang.*` 这两条在中英两表里**刻意是同一个词**，
   * 门禁为此开了一个按 key 的白名单（见 scripts/check-ui-language.mjs）。
   *
   * 与主题按钮不同，它是 `<a>` 而不是 `<button>`：切换会整页跳到另一个地址
   * （理由见 src/lib/locale.ts），刷新、复制链接、前进后退都符合浏览器预期。
   */
  const locale = useLocale();
  const otherLocale = locale === 'en' ? 'zh-CN' : 'en';
  const langHref = otherLocaleHref(locale);
  const langLabel = otherLocale === 'en' ? t('common.lang.en') : t('common.lang.zh');
  const langAria = t('landing.nav.switchLanguage', { language: langLabel });

  // 只在跨过阈值时改变状态；React 对同值 setState 会 bail out，
  // 所以不会每帧重渲染。
  useMotionValueEvent(scrollY, 'change', (value) => {
    setFloating(value > 24);
  });

  return (
    <header className="lp-nav">
      <motion.div
        className="lp-nav__bar"
        initial={preset.reduced ? { opacity: 0 } : { opacity: 0, y: '-140%' }}
        animate={{ opacity: 1, y: 0 }}
        transition={preset.sheet}
        style={{ boxShadow: floating ? 'var(--ht-shadow-lg)' : 'var(--ht-shadow-sm)' }}
      >
        {/* 字标本身标了 aria-hidden，所以链接的可访问名由 aria-label 提供 ——
            否则这个链接会变成一个没有名字的控件。 */}
        <a className="lp-brand" href="#top" aria-label={t('common.brand')}>
          <BrandMark />
        </a>

        <nav className="lp-nav__links" aria-label={t('landing.nav.ariaLabel')}>
          {links.map((link) => (
            <a key={link.href} className="lp-nav__link" href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="lp-nav__actions">
          {/*
            hrefLang 告诉辅助技术与搜索引擎这个链接指向**另一种语言**的页面 ——
            光看链接文字（`English` / `中文`）看不出这一点。
          */}
          <a
            className="lp-lang"
            href={langHref}
            hrefLang={otherLocale}
            aria-label={langAria}
          >
            {langLabel}
          </a>

          <button
            type="button"
            className="lp-iconbtn"
            aria-label={themeToggleLabel}
            onClick={onToggleTheme}
          >
            {/*
              图标在主题切换时**转着换**：月亮与太阳是同一个"光"的两面，
              用旋转表达它们的关系，比淡入淡出更说得通。
              Apple《Spatial consistency》：从哪来回哪去，所以是两个方向相反的旋转。
            */}
            <motion.span
              key={theme}
              initial={preset.reduced ? { opacity: 0 } : { rotate: theme === 'dark' ? -90 : 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              transition={preset.rotation}
              style={{ display: 'grid', placeItems: 'center' }}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </motion.span>
          </button>

          <a
            className="lp-iconbtn"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t('landing.nav.viewSource')}
          >
            <Github size={18} aria-hidden="true" />
          </a>
        </div>
      </motion.div>
    </header>
  );
}
