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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **链接来自站点注册表，不来自这个文件。**
 *
 * 这里曾经是一张手写的链接表（全是 `#capabilities` 这类页内锚点），
 * 在整站只有一页时完全够用。有了子页面之后，手写表就是"孤立路由"的
 * 生产装置：加了页面而忘了改这里，页面就只存在于 URL 里。
 *
 * 现在链接是 `navPages()` 的**函数**（顺序也由注册表决定），所以
 * **没有一条路径能新增页面而不出现在导航里**。加页面只改
 * `src/site/pages.ts` —— 见那个文件的文件头。
 *
 * ⚠️ 两条不在 `navPages()` 里、但**同样由注册表提供**的链接：
 *   - 字标 → 首页（不是 `#top`。子页面上 `#top` 是个死锚点）；
 *   - 「登录」→ `/signin`，挂在右侧操作位（理由见 `pages.ts` 的 signin 条目）。
 * 这两条都不是"手写文案"：标签同样来自词条表。
 */

import { useMemo, useState } from 'react';
import { motion, useMotionValueEvent, useScroll } from 'motion/react';
import { Menu, Moon, Sun } from 'lucide-react';

import { otherLocale, useI18n, useLocale } from '@heyta/i18n';

import { startCta } from '../lib/app-url.js';
import { useMotionPreset } from '../lib/motion.js';
import type { Theme } from '../lib/theme.js';
import { navPages, pageById, type SitePage } from '../site/pages.js';
import { otherLocaleHrefFor, siteHref } from '../site/paths.js';
import { BrandMark } from './BrandMark.js';

/**
 * 🔴 这里**曾经**导出 `GITHUB_URL`，导航、首屏、收尾 CTA、页脚全都指向它。
 * 仓库目前是**私有**的，那个链接对任何访客都是 404 —— 所以整条链路摘掉了。
 *
 * ⚠️ 「摘掉」的范围比链接大：自建区的终端里原本有一行可复制的
 * `git clone https://github.com/Xaiver03/heyta.git`，它同样会把访客送到 404。
 * 现在那里是 `git clone <repo-url>` 占位符。所以**判据是整页文本里不该出现
 * `github.com`**，而不是「不该有指向它的链接」—— `tests/render.spec.tsx`
 * 正是照这个判据断言整页文本的。
 *
 * 公开仓库时要一起做的事（别只把图标放回来）：
 *   1. 这个常量 + 导航的 GitHub 图标 + 首屏 `REPO_URL` + 收尾 CTA 的「先看看代码」
 *      + 页脚的 `viewOnGithub` 与那几组文档链接；
 *   2. `SelfHost.tsx` 的 `git clone <repo-url>` 换成真地址，
 *      并去掉 `landing.selfhost.sourcePending` 那句诚实说明
 *      （源码真的公开了，那句话就不成立了）；
 *   3. 中文词条 `landing.cta.lede` 恢复成「代码是开放的」的说法；
 *   4. `tests/render.spec.tsx` 那条「整页不出现私有仓库地址」换回
 *      「外链必须带 `rel=noopener`」—— 它拦的是原来那个风险，不是这个。
 *
 * ⚠️ 公开仓库还有一条**硬约束**：`.github/workflows/ci.yml` 的 `runs-on`
 * 必须先从自托管 runner 改回 `ubuntu-latest`（见该文件里的说明）。
 *
 * 🔴 另一件事不再是"等仓库公开"：**应用本身的入口**。
 *   这里曾经连"应用部署在哪"都没有一个地方记录 —— 整页 CTA 只落到自建区，
 *   而自建区的第一步是占位命令。现在应用地址是构建期变量 `VITE_APP_URL`
 *   （`lib/app-url.ts`）：配了就多出「立即使用」并指向应用，没配就逐字退回
 *   今天的行为。所以**换域名/换主机是一次构建参数，不是一次改代码**。
 */
export function Nav({
  page,
  theme,
  onToggleTheme,
}: {
  page: SitePage;
  theme: Theme;
  onToggleTheme: () => void;
}): React.JSX.Element {
  const preset = useMotionPreset();
  const { scrollY } = useScroll();
  const [floating, setFloating] = useState(false);
  const { t } = useI18n();
  /**
   * 语言既决定文案，也决定「开始使用」指向的应用地址 —— 英文页必须把 `?lang=en`
   * 带过去，否则访客读完英文页、进应用看到的却是中文（见 `lib/app-url.ts`）。
   * 所以它要在算 `cta` **之前**取到。
   */
  const locale = useLocale();
  // 「开始使用」该指向哪，全站只有这一个判据（见 `lib/app-url.ts`）。
  const cta = startCta(locale);

  /** 站点链接。顺序、标签、是否出现**全部**由注册表决定（见文件头）。 */
  const links = useMemo(
    () =>
      navPages().map((target) => ({
        href: siteHref(target, locale),
        label: t(target.labelKey),
        current: target.id === page.id,
      })),
    [t, locale, page.id],
  );

  /**
   * 「登录」是注册表里的一条页面，但它挂在**操作位**而不是链接组里 ——
   * 它是回访用户的入口，与「立即使用」（新访客的入口）是两个不同的意图，
   * 混进一列同质链接里就没人找得到了（依据 A5-2，见 `pages.ts` 的 signin 条目）。
   */
  const signin = pageById('signin');
  const signinHref = siteHref(signin, locale);
  const signinLabel = t(signin.labelKey);

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
   * 🔴 落点是 `otherLocaleHrefFor(page, locale)` —— **保持当前页面、只换语言**。
   * 这里曾经写死 `/` 或 `/en/`：在 `/features` 上点 English 会被丢回英文首页，
   * 而地址栏看起来完全合理。见 `src/site/paths.ts` 的文件头。
   *
   * 与主题按钮不同，它是 `<a>` 而不是 `<button>`：切换会整页跳到另一个地址
   * （理由见 src/lib/locale.ts），刷新、复制链接、前进后退都符合浏览器预期。
   */
  // 🔴 "另一种语言"只有一份定义（`@heyta/i18n` 的 `otherLocale`，见 R18）：
  // 这里曾经自己写了一遍 `locale === 'en' ? 'zh-CN' : 'en'`，与 `site/paths.ts`
  // 各写一份。两份写法漂移的表现是"语言切换器指向自己"（点了没反应）。
  const targetLocale = otherLocale(locale);
  const langHref = otherLocaleHrefFor(page, locale);
  const langLabel = targetLocale === 'en' ? t('common.lang.en') : t('common.lang.zh');
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
            否则这个链接会变成一个没有名字的控件。
            🔴 落点是**首页**而不是 `#top`：`#top` 只在首页存在，子页面上它是个
            点了没反应的死锚点（导航是每一页共用的，这个差别它看不见）。 */}
        <a
          className="lp-brand"
          href={siteHref(pageById('home'), locale)}
          aria-label={t('common.brand')}
        >
          <BrandMark />
        </a>

        <nav className="lp-nav__links" aria-label={t('landing.nav.ariaLabel')}>
          {links.map((link) => (
            <a
              key={link.href}
              className="lp-nav__link"
              href={link.href}
              // 当前页标出来：读屏软件靠它回答"我在哪"，而不只是"能去哪"。
              {...(link.current ? { 'aria-current': 'page' as const } : {})}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="lp-nav__actions">
          <a className="lp-nav__link lp-nav__signin" href={signinHref}>
            {signinLabel}
          </a>

          {/* 应用真的部署起来了才多这一条。没配置时不出现 —— 一个指向
              「自建」的「立即使用」是骗人的，而导航里本来就有一条自建入口。 */}
          {cta.external ? (
            <a
              className="lp-btn lp-btn--primary lp-nav__cta"
              href={cta.href}
              rel="noopener noreferrer"
            >
              {t(cta.labelKey)}
            </a>
          ) : null}

          {/*
            `hrefLang` 告诉辅助技术与搜索引擎这个链接指向**另一种语言**的页面 ——
            光看链接文字（`English` / `中文`）看不出这一点。
          */}
          <a
            className="lp-lang"
            href={langHref}
            hrefLang={targetLocale}
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

          {/*
            🔴 窄屏下 `.lp-nav__links` 整个被隐藏（≤1024px，见 landing.css）。
            在只有一个页面时那没问题 —— 那些链接本来就是页内锚点。
            有了子页面之后，"隐藏"就等于**窄屏访客没有任何跨页入口**，
            只能在页脚里找。所以这里补一个折叠菜单。

            用 `<details>` 而不是自己写 `useState`：键盘操作、`aria-expanded`、
            焦点顺序都由浏览器给，而自己实现的那三样恰恰是最容易做漏的。
          */}
          <details className="lp-nav__menu">
            <summary className="lp-iconbtn" aria-label={t('site.nav.aria')}>
              <Menu size={18} />
            </summary>
            <nav className="lp-nav__menu-panel" aria-label={t('landing.nav.ariaLabel')}>
              {links.map((link) => (
                <a
                  key={link.href}
                  className="lp-nav__menu-link"
                  href={link.href}
                  {...(link.current ? { 'aria-current': 'page' as const } : {})}
                >
                  {link.label}
                </a>
              ))}
              <a className="lp-nav__menu-link" href={signinHref}>
                {signinLabel}
              </a>
            </nav>
          </details>
        </div>
      </motion.div>
    </header>
  );
}
