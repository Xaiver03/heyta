import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { placeAnchoredPanel } from '@heyta/ui';
import type { LocalDate } from '@heyta/domain';
import { CaptureComposer } from '../capture/CaptureComposer.js';
import { useDirtyDismissGuard } from '../../lib/form/useDirtyDismissGuard.js';

/** A date-anchored editor; opening or dismissing it never writes a task. */
export function CalendarCapturePopover({ date, title, onClose }: {
  date: LocalDate;
  title: string;
  onClose: () => void;
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  /* 🔴 这一层是**脏锚定层**：草稿住在 `SharedCaptureComposer` 的本地 state，
     卸载即丢、且没有撤销出口 ⇒ 三条通道都得先问一句。
     策略本身不在这里判（也不许在这里判），只查共享那张表：`popover-dirty-form`。
     `isDirty` 用 getter 按 DOM 现读：宿主读不到被包起来的共享组件的 state，
     而 dismiss 发生在事件回调里，快照会过期。 */
  const { requestDismiss, asking, guard } = useDirtyDismissGuard({
    overlay: 'popover-dirty-form',
    isDirty: () => {
      const field = panelRef.current?.querySelector<HTMLInputElement>('input, textarea');
      return (field?.value ?? '').trim() !== '';
    },
    onDismiss: onClose,
  });
  const askingRef = useRef(asking);
  askingRef.current = asking;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const trigger = document.querySelector<HTMLElement>(`[data-testid="calendar-cell-${date}"]`)
      ?? document.querySelector<HTMLElement>('[data-testid="calendar-capture-toggle"]');
    const previousFocus = document.activeElement;
    const place = (): void => {
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const padding = Number.parseFloat(getComputedStyle(panel).paddingLeft) || 0;
      const roomAbove = Math.max(0, rect.top - padding - padding);
      const roomBelow = Math.max(0, window.innerHeight - rect.bottom - padding - padding);
      // The panel is fixed and portalled outside the scrolling content. Its maximum
      // height must follow the side selected by the shared placement model; otherwise
      // a bottom anchored cell can produce a panel that extends below the viewport.
      const availableHeight = Math.max(roomAbove, roomBelow);
      panel.style.maxBlockSize = `${availableHeight}px`;
      const size = panel.getBoundingClientRect();
      const pos = placeAnchoredPanel(rect, size,
        { width: window.innerWidth, height: window.innerHeight },
        { gap: padding, edge: padding });
      panel.style.top = `${pos.top}px`;
      panel.style.left = `${pos.left}px`;
    };
    place();
    panel.querySelector<HTMLInputElement>('input, textarea')?.focus();
    // jsdom and older embedded WebViews may not expose ResizeObserver. Positioning
    // still works from the initial measurement plus scroll/resize listeners; the
    // observer is an enhancement for composer height changes.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    observer?.observe(panel);
    const dismiss = (event: PointerEvent): void => {
      if (askingRef.current) return;
      if (!(event.target instanceof Node) || panel.contains(event.target) || trigger?.contains(event.target)) return;
      // Selecting another date while the editor is open is an intentional re-anchor,
      // not an outside dismissal. `onSelectDay` keeps the popover open and the
      // effect below measures the new cell after React commits the date change.
      if (event.target instanceof Element && event.target.closest('[data-testid^="calendar-cell-"]')) return;
      requestDismiss('scrim');
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // 正在问的时候 Esc 归确认框（它那一档的 Esc = 安全侧的「继续编辑」），
      // 这一层不许在 capture 阶段把它抢走。
      if (askingRef.current) return;
      event.preventDefault(); event.stopPropagation();
      requestDismiss('escape');
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    // Scroll does not bubble from `.ht-content`; capture it at the document so
    // the fixed panel follows the date cell without intercepting wheel behavior.
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      if (trigger?.isConnected) trigger.focus();
      else if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [date, onClose, requestDismiss]);
  return createPortal(
    <>
      <div ref={panelRef} className="ht-content__calendar-capture" data-testid="calendar-capture" role="dialog" aria-label={title}>
        <div className="ht-content__calendar-capture-heading">
          <span className="ht-type-row-title">{title}</span>
          <button type="button" className="ht-btn ht-btn--ghost" aria-label={t('web.calendar.capture.close')} onClick={() => requestDismiss('escape')}>
            <X size={ICON_SIZE.sm} aria-hidden="true" />
          </button>
        </div>
        <CaptureComposer anchorDate={date} />
      </div>
      {guard}
    </>, document.body,
  );
}
