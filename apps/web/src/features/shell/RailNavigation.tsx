import { AssistantIcon } from '../ai/AssistantIcon.js';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, pointerWithin, PointerSensor, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  CircleHelp,
  MoreHorizontal,
  Pin,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ShellModuleKey } from './modules.js';
import { AccountMenu } from './AccountMenu.js';
import { InboxBell } from '../inbox/InboxBell.js';
import { SyncBar } from '../sync/SyncBar.js';
import { clearRailPreference, loadRailPreference, saveRailPreference, type RailPreference } from './rail-pref.js';
import { anchorRailLabelElement, splitRailTabs, type ViewKey, type ViewTab } from './view-tabs.js';
import { useNarrowLayout } from './useNarrowLayout.js';
import { CompactRailNavigation } from './CompactRailNavigation.js';

const REQUIRED_RAIL_KEYS = new Set<ViewKey>(['tasks', 'search']);
const PRIMARY_ZONE = 'rail-zone-primary';
const OVERFLOW_ZONE = 'rail-zone-overflow';

const railCollisionDetection: CollisionDetection = (args) => {
  const intersections = pointerWithin(args);
  // The primary zone contains the More drop zone. Prefer an actual sortable item
  // first, then the explicit zone, so nested droppables do not swallow the drop.
  const item = intersections.find(({ id }) => id !== PRIMARY_ZONE && id !== OVERFLOW_ZONE && id !== args.active.id);
  if (item !== undefined) return [item];
  const zone = intersections.find(({ id }) => id === PRIMARY_ZONE || id === OVERFLOW_ZONE);
  if (zone !== undefined) return [zone];
  return args.pointerCoordinates === null ? closestCenter(args) : [];
};

export type RailNavigationProps = {
  view: ViewKey;
  visibleMainTabs: readonly ViewTab[];
  visibleToolTabs: readonly ViewTab[];
  syncEmail?: string;
  syncNeedsSignIn: boolean;
  growthEnabled: boolean;
  onNavigate: (key: ViewKey) => void;
  onResetTasks: () => void;
  onSignIn: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onOpenProfileCenter: () => void;
  onOpenGrowth: () => void;
  onSignOut: () => void;
  onOpenHelp: () => void;
  onOpenAssistant?: () => void;
  assistantActive?: boolean;
};

function tokenPx(name: string): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

function SortableRailButton({
  tab,
  active,
  onActivate,
  customize,
  canMoveToMore,
  onMoveToMore,
  onMoveUp,
  onMoveDown,
  dropBefore,
}: {
  tab: ViewTab;
  active: boolean;
  dropBefore: boolean;
  onActivate: () => void;
  customize: boolean;
  canMoveToMore: boolean;
  onMoveToMore: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const sortable = useSortable({ id: tab.key, data: { zone: 'primary' } });
  const { role: _role, ...sortableAttributes } = sortable.attributes;
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  return (
    <div ref={sortable.setNodeRef} style={style} className={`ht-rail__item${sortable.isDragging ? ' ht-rail__item--dragging' : ''}${dropBefore ? ' ht-rail__item--insert-before' : ''}`}>
      <button
        ref={sortable.setActivatorNodeRef}
        type="button"
        role="tab"
        aria-selected={active}
        className={`ht-rail__tab${active ? ' ht-rail__tab--active' : ''}`}
        data-testid={`rail-view-${tab.key}`}
        onClick={onActivate}
        {...sortableAttributes}
        {...sortable.listeners}
      >
        <tab.Icon size={ICON_SIZE.sm} aria-hidden="true" />
        <span className="ht-rail__label ht-type-caption">{t(tab.labelKey)}</span>
      </button>
      {customize ? (
        <span className="ht-rail__customize-actions" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" className="ht-rail__customize-action" aria-label={t('web.shell.rail.moveUp')} onClick={onMoveUp}><ArrowUp size={ICON_SIZE.xs} aria-hidden="true" /></button>
          <button type="button" className="ht-rail__customize-action" aria-label={t('web.shell.rail.moveDown')} onClick={onMoveDown}><ArrowDown size={ICON_SIZE.xs} aria-hidden="true" /></button>
          {canMoveToMore ? (
            <button
              type="button"
              className="ht-rail__customize-action"
              aria-label={t('web.shell.rail.moveMore')}
              title={t('web.shell.rail.moveMore')}
              onClick={onMoveToMore}
            >
              <ArrowDownToLine size={ICON_SIZE.xs} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function SortableMoreItem({
  tab,
  customize,
  onActivate,
  onPin,
  onMoveUp,
  onMoveDown,
}: {
  tab: ViewTab;
  customize: boolean;
  onActivate: () => void;
  onPin: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const sortable = useSortable({ id: tab.key, data: { zone: 'overflow' } });
  const { role: _role, ...sortableAttributes } = sortable.attributes;
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  return (
    <div ref={sortable.setNodeRef} style={style} className={`ht-rail__more-row${sortable.isDragging ? ' ht-rail__more-row--dragging' : ''}`}>
      <button ref={sortable.setActivatorNodeRef} type="button" role="menuitem" className="ht-rail__more-item" onClick={onActivate} {...sortableAttributes} {...sortable.listeners}>
        <tab.Icon size={ICON_SIZE.sm} aria-hidden="true" />
        <span>{t(tab.labelKey)}</span>
      </button>
      {customize ? (
        <span className="ht-rail__customize-actions" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" className="ht-rail__customize-action" onClick={onMoveUp} aria-label={t('web.shell.rail.moveUp')}><ArrowUp size={ICON_SIZE.xs} aria-hidden="true" /></button>
          <button type="button" className="ht-rail__customize-action" onClick={onMoveDown} aria-label={t('web.shell.rail.moveDown')}><ArrowDown size={ICON_SIZE.xs} aria-hidden="true" /></button>
          {!REQUIRED_RAIL_KEYS.has(tab.key) ? (
            <button
              type="button"
              className="ht-rail__customize-action"
              aria-label={t('web.shell.rail.pin')}
              title={t('web.shell.rail.pin')}
              onClick={onPin}
            >
              <Pin size={ICON_SIZE.xs} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

type RailDropZoneRenderProps = {
  readonly primaryDropRef: (element: HTMLElement | null) => void;
  readonly overflowDropRef: (element: HTMLElement | null) => void;
  readonly primaryIsOver: boolean;
  readonly overflowIsOver: boolean;
};

function RailDropZones({
  children,
}: {
  children: (props: RailDropZoneRenderProps) => React.JSX.Element;
}): React.JSX.Element {
  const { setNodeRef: primaryDropRef, isOver: primaryIsOver } = useDroppable({ id: PRIMARY_ZONE });
  const { setNodeRef: overflowDropRef, isOver: overflowIsOver } = useDroppable({ id: OVERFLOW_ZONE });
  return children({ primaryDropRef, overflowDropRef, primaryIsOver, overflowIsOver });
}

export function RailNavigation(props: RailNavigationProps): React.JSX.Element {
  const narrow = useNarrowLayout();
  return narrow ? <CompactRailNavigation {...props} /> : <DesktopRailNavigation {...props} />;
}

function DesktopRailNavigation({
  view,
  visibleMainTabs,
  visibleToolTabs,
  syncEmail,
  syncNeedsSignIn,
  growthEnabled,
  onNavigate,
  onResetTasks,
  onSignIn,
  onOpenSettings,
  onOpenProfile,
  onOpenProfileCenter,
  onOpenGrowth,
  onSignOut,
  onOpenHelp,
  onOpenAssistant,
  assistantActive = false,
}: RailNavigationProps): React.JSX.Element {
  const { t } = useI18n();
  const [preference, setPreference] = useState<RailPreference | undefined>(() => loadRailPreference());
  const [moreOpen, setMoreOpen] = useState(false);
  const [draggedKey, setDraggedKey] = useState<ViewKey | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [customize, setCustomize] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const activeRailTabRef = useRef<HTMLElement | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | undefined>(undefined);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const railTabs = splitRailTabs(visibleMainTabs, view, preference);

  const updatePreference = useCallback((next: RailPreference): void => {
    setPreference(next);
    saveRailPreference(next);
  }, []);

  const currentPreference = useCallback((): RailPreference => preference ?? {
    primary: railTabs.primary.map((tab) => tab.key),
    overflow: railTabs.overflow.map((tab) => tab.key),
  }, [preference, railTabs]);

  const anchorLabel = useCallback((event: SyntheticEvent<HTMLElement>): void => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('.ht-rail__tab');
    if (tab === null) return;
    activeRailTabRef.current = tab;
    anchorRailLabelElement(tab);
  }, []);

  // Fixed labels must follow the button when the rail's own scroll container or
  // the viewport moves. This also covers WebKit, which does not consistently
  // re-dispatch pointerover while a scroll gesture moves the hovered tab.
  useEffect(() => {
    const update = (): void => {
      const tab = activeRailTabRef.current;
      if (tab !== null) anchorRailLabelElement(tab);
    };
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, []);

  const moveBetween = useCallback((key: ViewKey, target: 'primary' | 'overflow', index?: number): void => {
    const current = currentPreference();
    const primary = current.primary.filter((item) => item !== key);
    const overflow = current.overflow.filter((item) => item !== key);
    if (target === 'primary') {
      const nextIndex = Math.min(index ?? primary.length, primary.length);
      primary.splice(nextIndex, 0, key);
    } else {
      const nextIndex = Math.min(index ?? overflow.length, overflow.length);
      overflow.splice(nextIndex, 0, key);
    }
    for (const required of REQUIRED_RAIL_KEYS) {
      const at = overflow.indexOf(required);
      if (at >= 0) {
        const moved = overflow.splice(at, 1)[0];
        if (moved !== undefined) primary.push(moved);
      }
    }
    updatePreference({ primary, overflow });
  }, [currentPreference, updatePreference]);

  const moveWithin = useCallback((key: ViewKey, direction: -1 | 1, zone: 'primary' | 'overflow'): void => {
    const current = currentPreference();
    const list = [...(zone === 'primary' ? current.primary : current.overflow)];
    const index = list.indexOf(key);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= list.length) return;
    const moved = arrayMove(list, index, next);
    updatePreference(zone === 'primary' ? { primary: moved, overflow: current.overflow } : { primary: current.primary, overflow: moved });
  }, [currentPreference, updatePreference]);

  const onDragEnd = useCallback((event: DragEndEvent): void => {
    setDraggedKey(null);
    setDropKey(null);
    const active = String(event.active.id) as ViewKey;
    const over = event.over === null ? undefined : String(event.over.id);
    if (over === undefined) return;
    const current = currentPreference();
    if (over === PRIMARY_ZONE) return moveBetween(active, 'primary');
    if (over === OVERFLOW_ZONE) return moveBetween(active, 'overflow');
    const source = current.primary.includes(active) ? 'primary' : 'overflow';
    const target = current.primary.includes(over as ViewKey) ? 'primary' : 'overflow';
    if (source !== target) return moveBetween(active, target, (target === 'primary' ? current.primary : current.overflow).indexOf(over as ViewKey));
    const list = [...(target === 'primary' ? current.primary : current.overflow)];
    const from = list.indexOf(active);
    const to = list.indexOf(over as ViewKey);
    if (from < 0 || to < 0 || from === to) return;
    const next = arrayMove(list, from, to);
    updatePreference(target === 'primary' ? { primary: next, overflow: current.overflow } : { primary: current.primary, overflow: next });
  }, [currentPreference, moveBetween, updatePreference]);

  useLayoutEffect(() => {
    if (!moreOpen) return;
    const update = (): void => {
      const trigger = moreButtonRef.current;
      const panel = moreMenuRef.current;
      if (trigger === null || panel === null) return;
      const rect = trigger.getBoundingClientRect();
      const gap = tokenPx('--ht-space-2');
      const edge = tokenPx('--ht-space-2');
      // Keep the actual drop destination clear: right of a vertical rail,
      // above the horizontal bottom navigation on compact windows.
      const rail = trigger.closest('nav')?.getBoundingClientRect() ?? rect;
      const horizontal = rail.width > rail.height;
      const sideLeft = rail.right + gap;
      panel.style.maxInlineSize = `${Math.max(0, horizontal ? window.innerWidth - edge * 2 : window.innerWidth - sideLeft - edge)}px`;
      panel.style.maxBlockSize = `${Math.max(0, horizontal ? rail.top - gap - edge : window.innerHeight - edge * 2)}px`;
      const panelRect = panel.getBoundingClientRect();
      const left = horizontal ? Math.max(edge, Math.min(rect.left, window.innerWidth - edge - panelRect.width)) : sideLeft;
      const top = horizontal
        ? Math.max(edge, rail.top - gap - panelRect.height)
        : Math.max(edge, Math.min(rect.top, window.innerHeight - edge - panelRect.height));
      setPanelPosition({ top, left });
    };
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [moreOpen, customize, railTabs.overflow.length]);

  useLayoutEffect(() => {
    if (!moreOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMoreOpen(false);
      setCustomize(false);
      moreButtonRef.current?.focus();
    };
    // Capture here because react-native-web inputs can consume bubbling key events.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [moreOpen]);

  useLayoutEffect(() => {
    if (!moreOpen) return;
    (moreMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]') ?? moreMenuRef.current?.querySelector<HTMLElement>('.ht-rail__customize-toggle'))?.focus();
  }, [moreOpen]);

  // The menu is portalled into document.body. A browser can finish that
  // commit after the rail layout effect, so repeat the handoff on the next
  // frame; this keeps keyboard opening deterministic without stealing focus
  // during drag or resize.
  useEffect(() => {
    if (!moreOpen) return;
    const frame = requestAnimationFrame(() => {
      (moreMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]') ?? moreMenuRef.current?.querySelector<HTMLElement>('.ht-rail__customize-toggle'))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [moreOpen]);

  useEffectOutside(moreOpen, moreButtonRef, moreMenuRef, () => setMoreOpen(false));

  const draggedTab = visibleMainTabs.find((tab) => tab.key === draggedKey);

  const activate = (key: ViewKey): void => {
    if (key === 'tasks' && view === 'tasks') onResetTasks();
    else onNavigate(key);
    setMoreOpen(false);
  };

  return (
    <nav
      className="ht-rail"
      aria-label={t('web.shell.nav.aria')}
      onPointerOver={anchorLabel}
      onFocus={anchorLabel}
    >
      <div className="ht-rail__top">
      <AccountMenu email={syncEmail} showSignIn={syncNeedsSignIn} onSignIn={onSignIn} onOpenSettings={onOpenSettings} onOpenProfile={onOpenProfile} onOpenProfileCenter={onOpenProfileCenter} onOpenGrowth={onOpenGrowth} growthEnabled={growthEnabled} onSignOut={onSignOut} />
      </div>
      <DndContext sensors={sensors} collisionDetection={railCollisionDetection} onDragEnd={onDragEnd}
        onDragStart={({ active }) => setDraggedKey(String(active.id) as ViewKey)}
        onDragOver={({ over }) => setDropKey(over === null ? null : String(over.id))}
        onDragCancel={() => { setDraggedKey(null); setDropKey(null); }}
      >
        <RailDropZones>
          {({ primaryDropRef, overflowDropRef, primaryIsOver, overflowIsOver }) => <div ref={primaryDropRef} role="tablist" aria-label={t('web.shell.views.aria')} className={`ht-rail__tabs${primaryIsOver ? ' ht-rail__tabs--drop-target' : ''}`}>
          <SortableContext items={railTabs.primary.map((tab) => tab.key)} strategy={verticalListSortingStrategy}>
            {railTabs.primary.map((tab) => (
              <SortableRailButton key={tab.key} tab={tab} dropBefore={draggedKey !== null && draggedKey !== tab.key && dropKey === tab.key} active={!assistantActive && view === tab.key} onActivate={() => activate(tab.key)} customize={customize} canMoveToMore={!REQUIRED_RAIL_KEYS.has(tab.key)} onMoveToMore={() => moveBetween(tab.key, 'overflow')} onMoveUp={() => moveWithin(tab.key, -1, 'primary')} onMoveDown={() => moveWithin(tab.key, 1, 'primary')} />
            ))}
          </SortableContext>
          {onOpenAssistant !== undefined ? <button type="button" role="tab" aria-selected={assistantActive} data-testid="rail-assistant" className={`ht-rail__tab${assistantActive ? ' ht-rail__tab--active' : ''}`} onClick={onOpenAssistant}>
            <AssistantIcon size={ICON_SIZE.sm} aria-hidden="true" />
            <span className="ht-rail__label ht-type-caption">{t('web.ai.assistant.title')}</span>
          </button> : null}
          {visibleMainTabs.length > 4 || preference !== undefined ? (
            <div ref={overflowDropRef} className={`ht-rail__more${overflowIsOver ? ' ht-rail__more--drop-target' : ''}`}>
              <button ref={moreButtonRef} type="button" className={`ht-rail__tab${moreOpen ? ' ht-rail__tab--active' : ''}`} aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => { setPanelPosition(undefined); setMoreOpen((open) => !open); }}>
                <MoreHorizontal size={ICON_SIZE.sm} aria-hidden="true" />
                <span className="ht-rail__label ht-type-caption">{t('web.shell.views.groupMore')}</span>
              </button>
              {moreOpen ? createPortal(
                <div ref={moreMenuRef} className={`ht-rail__more-menu${panelPosition === undefined ? ' ht-rail__more-menu--measuring' : ''}`} role="menu" aria-label={t('web.shell.views.groupMore')} style={panelPosition === undefined ? undefined : { top: panelPosition.top, left: panelPosition.left }} onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  event.stopPropagation();
                  setMoreOpen(false);
                  setCustomize(false);
                  moreButtonRef.current?.focus({ preventScroll: true });
                }}>
                  <div className="ht-rail__more-header">
                    <button
                      type="button"
                      className="ht-rail__customize-toggle"
                      aria-pressed={customize}
                      aria-label={customize ? t('web.shell.rail.customizeDone') : t('web.shell.rail.customize')}
                      title={customize ? t('web.shell.rail.customizeDone') : t('web.shell.rail.customize')}
                      onClick={() => setCustomize((value) => !value)}
                    >
                      <SlidersHorizontal size={ICON_SIZE.xs} aria-hidden="true" />
                      <span>{customize ? t('web.shell.rail.customizeDone') : t('web.shell.rail.customize')}</span>
                    </button>
                  </div>
                  <SortableContext items={railTabs.overflow.map((tab) => tab.key)} strategy={verticalListSortingStrategy}>
                    {railTabs.overflow.map((tab) => <SortableMoreItem key={tab.key} tab={tab} customize={customize} onActivate={() => activate(tab.key)} onPin={() => moveBetween(tab.key, 'primary')} onMoveUp={() => moveWithin(tab.key, -1, 'overflow')} onMoveDown={() => moveWithin(tab.key, 1, 'overflow')} />)}
                  </SortableContext>
                  {customize ? (
                    <button
                      type="button"
                      className="ht-rail__reset"
                      onClick={() => { clearRailPreference(); setPreference(undefined); setCustomize(false); }}
                    >
                      <RotateCcw size={ICON_SIZE.xs} aria-hidden="true" />
                      <span>{t('web.shell.rail.reset')}</span>
                    </button>
                  ) : null}
                </div>, document.body,
              ) : null}
            </div>
          ) : null}
          </div>}
        </RailDropZones>
        {createPortal(<DragOverlay dropAnimation={null}>
          {draggedTab !== undefined ? <div className="ht-rail__drag-preview" aria-hidden="true">
            <draggedTab.Icon size={ICON_SIZE.sm} />
          </div> : null}
        </DragOverlay>, document.body)}
      </DndContext>
      {visibleToolTabs.map((tab, index) => <button key={tab.key} type="button" role="tab" aria-selected={!assistantActive && view === tab.key} className={`ht-rail__tab ht-rail__tab--tool${index === 0 ? ' ht-rail__tab--tool-start' : ''}${!assistantActive && view === tab.key ? ' ht-rail__tab--active' : ''}`} onClick={() => onNavigate(tab.key)}><tab.Icon size={ICON_SIZE.sm} aria-hidden="true" /><span className="ht-rail__label ht-type-caption">{t(tab.labelKey)}</span></button>)}
      <InboxBell />
      <button type="button" data-testid="rail-help" className="ht-rail__tab ht-rail__tab--tool" onClick={onOpenHelp}><CircleHelp size={ICON_SIZE.sm} aria-hidden="true" /><span className="ht-rail__label ht-type-caption">{t('web.shell.nav.help')}</span></button>
      <SyncBar />
    </nav>
  );
}

function useEffectOutside(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useLayoutEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, triggerRef, panelRef, close]);
}
