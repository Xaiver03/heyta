import { ICON_SIZE } from '@heyta/design-system';
/**
 * 文档中心的外壳（侧栏 + 正文 + 窄屏抽屉）
 * =========================================
 *
 * 这一层存在的唯一理由：**分组折叠的状态要有一个人持有。**
 *
 * 侧栏在窄屏出现两次（正文左边那一列 + 抽屉那一层）。如果每份 `DocsNav`
 * 自己 `useState` 存"哪些组收起来了"，那么人在抽屉里收起「同步与账号」、
 * 关掉抽屉后左边那一列还是摊开的 —— 同一个界面里两个"事实源"，
 * 而人看到的是同一个控件。所以状态**提上来**，两份侧栏接同一份。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 四条版面纪律（都被 `e2e/landing/docs-centre.spec.ts` 钉着）：
 *
 *   1. **抽屉是覆盖层，不是栅格的一列。** 触发按钮与抽屉都是 `position: fixed`
 *      的孙子节点 —— fixed 元素不参与 grid 布局，所以 `.lp-docs` 的
 *      `sidebar | 1fr` 两列不会因为多了两个子节点而变形。
 *   2. **抽屉里的内容按需挂载**（`drawerOpen ? … : null`）。常驻的话
 *      `#main .lp-docs__link` 会一次数出两倍，"侧栏就是六篇地图"那条判据
 *      就从"检查结构"退化成"检查我没写错选择器"。
 *   3. **不藏那一列。** 抽屉打开时靠遮罩盖住底下的正文，而不是给
 *      `.lp-docs__nav` 加 `display: none` —— 后者会让栅格只剩一个在流里的
 *      子节点，正文于是掉进**侧栏那一列**（宽度 `--ht-layout-sidebar-width`），
 *      那是手机上最难看的坏法，而且只在抽屉打开的瞬间出现。
 *   4. **搜索框在外壳的 topnav 里**（`DocsShell`，SSOS 文档站同位）——
 *      它是"这个站的全局工具"，不属于某一页的正文；2026-10-01 起
 *      DocsLayout 不再持有它（原先挂在 `.lp-wrap` 兄弟层）。
 *
 * ⚠️ Esc 关抽屉挂在 `window` 的**冒泡**监听上。落地页没有 react-native-web 的
 * `TextInput`（§7 第 80 条那个吞 keydown 的就是它），所以这里不需要捕获阶段。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '@heyta/i18n/provider';
import { Menu } from 'lucide-react';

import { DocsNav } from './DocsNav.js';
import type { SitePage } from './pages.js';

export function DocsLayout({
  page,
  toc,
  children,
}: {
  page: SitePage;
  /** 右栏的文章内目录（`DocsToc`）。不传 = 两列布局（分类页、无目录的页）。 */
  readonly toc?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  /** 收起的分组 id；空数组 = 全摊开（首屏就能看见全部文章，这是刻意的默认值）。 */
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggleGroup = useCallback((moduleId: string) => {
    setCollapsed((current) =>
      current.includes(moduleId) ? current.filter((id) => id !== moduleId) : [...current, moduleId],
    );
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onClose = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onClose);
    // 焦点进抽屉：抽屉是覆盖层，留在原地会让人在遮罩底下按 Tab。
    drawerRef.current?.focus();
    return () => window.removeEventListener('keydown', onClose);
  }, [drawerOpen]);

  return (
    <>
      <div className={toc ? 'lp-docs lp-docs--with-toc' : 'lp-docs'}>
        <DocsNav page={page} collapsed={collapsed} onToggle={toggleGroup} />
        {children}
        {toc}

        <button
          type="button"
          ref={triggerRef}
          className="lp-docs__menu"
          aria-label={t('site.docs.nav.open')}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu size={ICON_SIZE.sm} aria-hidden="true" />
          <span>{t('site.docs.nav.title')}</span>
        </button>

        {drawerOpen ? (
          <>
            <button
              type="button"
              className="lp-docs__scrim"
              aria-label={t('site.docs.nav.close')}
              onClick={() => {
                setDrawerOpen(false);
                triggerRef.current?.focus();
              }}
            />
            <div className="lp-docs__drawer" ref={drawerRef} tabIndex={-1}>
              <DocsNav page={page} collapsed={collapsed} onToggle={toggleGroup} />
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
