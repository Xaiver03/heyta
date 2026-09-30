/**
 * 文章页的页内目录
 * =================
 *
 * 🔴 **条目清单是从 `article.sections` 推出来的，不是手写第二份。**
 *
 * 页内目录是全站最容易悄悄过期的东西：手抄一份"这一页有哪几节"，
 * 那么改 `docs.ts` 加一节而忘了改目录时，**界面上没有任何异常** ——
 * 目录少了那一条，读者以为这一页只有两节。而 `docs.ts` 里的 `id`
 * 同时是正文那 `<section id>` 的锚点（也是 e2e 逐字钉住的那三条），
 * 用同一份数据之后，"目录与正文不一致"在结构上不可能发生。
 *
 * ⚠️ 落点在**正文那一列的顶部**，不是新开右侧第三列：
 * `.lp-docs` 的两列宽度由 `--ht-layout-sidebar-width` 与 `1fr` 决定，
 * 加第三列要新 token 或改那条共享栅格 —— 而 token 的改动属于
 * `packages/design-system/**`（另一条线的地界，本轮不碰）。
 * 读 SSOS 那套 docs-site 的实际用法也是「目录在正文上方一排」，
 * 而不是所有页都硬撑一根右栏（文章只有三到四节，右栏九成的时间是空的）。
 *
 * ⚠️ 链接是 `#锚点` 而不是按钮 + `scrollIntoView`：锚点**可分享**
 * （`/help/how/#local-first` 落到具体那一节），而 JS 滚动做不到这一点。
 * 顶端留白由 `.lp-row` 已有的 `scroll-margin-block-start` 负责（吸顶导航不压字）。
 */

import { useI18n } from '@heyta/i18n/provider';

import { KeyText } from './PageSections.js';
import type { SectionSpec } from './PageSections.js';

export function DocsToc({
  sections,
}: {
  sections: readonly SectionSpec[];
}): React.JSX.Element | null {
  const { t } = useI18n();

  // 只有一节的文章不需要目录 —— 标题下面直接就是正文，
  // 给一条链接做导航等于在页面上摆一个只指向自己的菜单。
  if (sections.length < 2) return null;

  return (
    <nav className="lp-docs__toc" aria-label={t('site.docs.toc.title')}>
      <p className="lp-docs__toc-title">{t('site.docs.toc.title')}</p>
      <ul className="lp-docs__toc-list">
        {sections.map((section) => (
          <li key={section.id}>
            <a className="lp-docs__toc-link" href={`#${section.id}`}>
              <KeyText messageKey={section.titleKey} />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
