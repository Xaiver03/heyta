import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp, MoreHorizontal } from 'lucide-react';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { AccountMenu } from './AccountMenu.js';
import { AssistantIcon } from '../ai/AssistantIcon.js';
import { InboxBell } from '../inbox/InboxBell.js';
import { SyncBar } from '../sync/SyncBar.js';
import type { RailNavigationProps } from './RailNavigation.js';
import type { ViewKey } from './view-tabs.js';

/** Compact destinations stay stable. Desktop pin order is not overwritten. */
export function CompactRailNavigation(props: RailNavigationProps): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [bottom, setBottom] = useState(0);
  const primary = props.visibleMainTabs.filter(({ key }) => key === 'tasks' || key === 'calendar');
  const overflow = [...props.visibleMainTabs.filter((tab) => !primary.includes(tab)), ...props.visibleToolTabs];
  const activeInMore = !props.assistantActive && overflow.some(({ key }) => key === props.view);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rail = trigger.current?.closest('nav')?.getBoundingClientRect();
      if (rail !== undefined) setBottom(window.innerHeight - rail.top);
    };
    update();
    panel.current?.querySelector<HTMLButtonElement>('.ht-compact-rail__destinations button')?.focus();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      // Let the inner notification/auth dialog handle its own Escape first.
      if (event.key !== 'Escape' || panel.current?.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keyboard);
    };
  }, [open]);

  const navigate = (key: ViewKey) => {
    if (key === 'tasks' && props.view === 'tasks') props.onResetTasks();
    else props.onNavigate(key);
    setOpen(false);
  };

  return <>
    <nav className="ht-rail ht-compact-rail" aria-label={t('web.shell.nav.aria')}>
      <div className="ht-rail__top">
        <AccountMenu email={props.syncEmail} showSignIn={props.syncNeedsSignIn} onSignIn={props.onSignIn} onOpenSettings={props.onOpenSettings} onOpenProfile={props.onOpenProfile} onOpenProfileCenter={props.onOpenProfileCenter} onOpenGrowth={props.onOpenGrowth} growthEnabled={props.growthEnabled} onSignOut={props.onSignOut} />
      </div>
      {primary.map((tab) => <button key={tab.key} type="button" data-testid={`rail-view-${tab.key}`} aria-current={!props.assistantActive && props.view === tab.key ? 'page' : undefined} className="ht-rail__tab" onClick={() => navigate(tab.key)}>
        <tab.Icon size={ICON_SIZE.sm} aria-hidden="true" /><span className="ht-rail__label ht-type-caption">{t(tab.labelKey)}</span>
      </button>)}
      {props.onOpenAssistant ? <button type="button" data-testid="rail-assistant" aria-current={props.assistantActive ? 'page' : undefined} className="ht-rail__tab" onClick={() => { setOpen(false); props.onOpenAssistant?.(); }}>
        <AssistantIcon size={ICON_SIZE.sm} aria-hidden="true" /><span className="ht-rail__label ht-type-caption">{t('web.ai.assistant.title')}</span>
      </button> : null}
      <button type="button" ref={trigger} data-testid="compact-rail-more" className="ht-rail__tab" aria-expanded={open} aria-controls="compact-rail-destinations" aria-current={activeInMore ? 'page' : undefined} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={ICON_SIZE.sm} aria-hidden="true" /><span className="ht-rail__label ht-type-caption">{t('web.shell.views.groupMore')}</span>
      </button>
      <InboxBell />
      <SyncBar />
    </nav>
    {createPortal(<div ref={panel} className={`ht-compact-rail__panel${open ? ' ht-compact-rail__panel--open' : ''}`} style={{ bottom }}>
      <div id="compact-rail-destinations" className="ht-compact-rail__destinations" hidden={!open}>
        {overflow.map((tab) => <button key={tab.key} type="button" data-testid={`rail-view-${tab.key}`} aria-current={!props.assistantActive && props.view === tab.key ? 'page' : undefined} onClick={() => navigate(tab.key)}>
          <tab.Icon size={ICON_SIZE.sm} aria-hidden="true" /><span>{t(tab.labelKey)}</span>
        </button>)}
        <button type="button" data-testid="rail-help" onClick={() => { setOpen(false); props.onOpenHelp(); }}><CircleHelp size={ICON_SIZE.sm} aria-hidden="true" /><span>{t('web.shell.nav.help')}</span></button>
      </div>
    </div>, document.body)}
  </>;
}
