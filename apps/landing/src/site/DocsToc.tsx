/**
 * 文章页的页内目录 —— **右栏独立一列**（SSOS 文档站同位）
 * =========================================================
 *
 * 🔴 **条目清单是从 `article.sections` 推出来的，不是手写第二份。**
 *
 * 页内目录是全站最容易悄悄过期的东西：手抄一份"这一页有哪几节"，
 * 那么改 `docs.ts` 加一节而忘了改目录时，**界面上没有任何异常** ——
 * 目录少了那一条，读者以为这一页只有两节。而 `docs.ts` 里的 `id`
 * 同时是正文那 `<section id>` 的锚点（也是 e2e 逐字钉住的那三条），
 * 用同一份数据之后，"目录与正文不一致"在结构上不可能发生。
 *
 * 🔴 **2026-10-01 起它是右栏 sticky 列，不再是正文顶部的一个盒子**
 * （产品负责人对照 SSOS 帮助中心拍板的 IA：左＝全站文章目录，
 * 右＝本页目录，中间是文章）。布局列在 `DocsLayout` 的栅格里
 * （`.lp-docs--with-toc` 三列）；本组件只负责目录本身。
 *
 * 🔴 **滚动跟随高亮**：读到哪一节，右栏就点亮那一节 —— SSOS 同款行为，
 * 实现用确定性滚动判定（阅读线 = 吸顶导航高度；滚到底判为最后一节）。
 * 没有它，右栏只是一张静态小目录；有了它，读者在长文里随时知道自己在哪。
 *
 * ⚠️ 链接是 `#锚点` 而不是按钮 + `scrollIntoView`：锚点**可分享**
 * （`/docs/how/#local-first` 落到具体那一节），而 JS 滚动做不到这一点。
 * 顶端留白由 `.lp-row` 已有的 `scroll-margin-block-start` 负责（吸顶导航不压字）。
 */

import { useEffect, useState } from 'react';

import { useI18n } from '@heyta/i18n/provider';

import { KeyText } from './PageSections.js';
import type { SectionSpec } from './PageSections.js';

export function DocsToc({
  sections,
}: {
  sections: readonly SectionSpec[];
}): React.JSX.Element | null {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');

  useEffect(() => {
    if (sections.length < 2) return;
    const targets = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) return;

    // 🔴 滚动跟随用**确定性算法**，不用 IntersectionObserver 的观察带：
    // 「当前读到的节」= 顶边已越过阅读线（视口顶部 80px，即吸顶导航的高度）的
    // 最后一节。SSOS 用的观察带（rootMargin -80px / -70%）有一个修不掉的边界：
    // **最后一节**常常够不着观察带（文档到头了，它的顶边停在带下方），
    // 于是点目录最后一条、页面也滚到了底，右栏却还亮着倒数第二节 ——
    // 实测就是这么红的。页面滚到底时直接判为最后一节。
    const READ_LINE = 80;
    const compute = () => {
      let current = targets[0]?.id;
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= READ_LINE) current = target.id;
        else break;
      }
      const doc = document.documentElement;
      const atBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 2;
      const last = targets[targets.length - 1];
      if (atBottom && last !== undefined) current = last.id;
      if (current !== undefined) setActiveId(current);
    };

    compute();
    window.addEventListener('scroll', compute, { passive: true });
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
    };
  }, [sections]);

  // 只有一节的文章不需要目录 —— 标题下面直接就是正文，
  // 给一条链接做导航等于在页面上摆一个只指向自己的菜单。
  if (sections.length < 2) return null;

  return (
    <nav className="lp-docs__toc" aria-label={t('site.docs.toc.title')}>
      <p className="lp-docs__toc-title">{t('site.docs.toc.title')}</p>
      <ul className="lp-docs__toc-list">
        {sections.map((section) => {
          const active = activeId === section.id;
          return (
            <li key={section.id}>
              <a
                className={active ? 'lp-docs__toc-link lp-docs__toc-link--active' : 'lp-docs__toc-link'}
                href={`#${section.id}`}
                {...(active ? { 'aria-current': 'location' as const } : {})}
              >
                <KeyText messageKey={section.titleKey} />
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
