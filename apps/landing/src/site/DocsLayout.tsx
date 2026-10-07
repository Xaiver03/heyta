import { ICON_SIZE } from '@heyta/design-system';
/** Shared desktop navigation and an accessible mobile drawer.
 * Collapsed groups share one state; narrow layouts show navigation only in the drawer.
 * Site-wide search belongs to DocsShell's top navigation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '@heyta/i18n/provider';
import { Menu, X } from 'lucide-react';

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
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        triggerRef.current?.focus();
      }
      if (event.key === 'Tab') {
        const items = [...(drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? [])]
          .filter((node) => node.getClientRects().length > 0);
        const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === drawerRef.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === drawerRef.current)) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onClose);
    // 焦点进抽屉：抽屉是覆盖层，留在原地会让人在遮罩底下按 Tab。
    drawerRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onClose);
    };
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
            <div className="lp-docs__drawer" ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('site.docs.nav.title')}>
              <button type="button" className="lp-docs__drawer-close" aria-label={t('site.docs.nav.close')} onClick={() => { setDrawerOpen(false); triggerRef.current?.focus(); }}>
                <X size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
              <DocsNav page={page} collapsed={collapsed} onToggle={toggleGroup} />
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
