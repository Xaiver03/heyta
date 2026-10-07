import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';

/** Keep the same scope controls; small windows present them on demand. */
export function ScopeDrawer({ open, onClose, children }: {
  open: boolean; onClose: () => void; children: ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 768px)').matches);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(max-width: 768px)');
    const change = (event: MediaQueryListEvent) => {
      if (!event.matches) {
        dialog.current?.close();
        closeRef.current();
      }
      setNarrow(event.matches);
    };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!narrow || !element) return;
    if (!open) { if (element.open) element.close(); return; }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
      requestAnimationFrame(() => {
        if (previous?.isConnected && previous.getClientRects().length > 0) previous.focus();
        else document.querySelector<HTMLElement>('.ht-sidebar button')?.focus();
      });
    };
  }, [open, narrow]);
  if (!narrow) return <>{children}</>;
  return (
    <dialog ref={dialog} className="ht-scope-drawer" aria-labelledby="scope-drawer-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ht-scope-drawer__content">
        <header className="ht-scope-drawer__header">
          <h2 id="scope-drawer-title" className="ht-type-section-title">{t('web.shell.nav.scopeAria')}</h2>
          <button type="button" className="ht-btn ht-btn--ghost" aria-label={t('web.inbox.close')} onClick={onClose}>
            <X size={ICON_SIZE.md} aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
