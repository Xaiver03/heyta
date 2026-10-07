import { ICON_SIZE } from '@heyta/design-system';
/**
 * 真实界面复现：桌面外壳
 * =========================
 *
 * 复现对象：`apps/web/src/App.tsx` 的 `.ht-app` 网格
 * （rail + 当前视图范围侧栏 + 主区 + 详情栏；主区里是标题栏 / 内容区）。
 *
 * ⚠️ 这是**复现**，不是应用本身 —— 详见 `mockup.css` 文件头。
 * 默认不可交互（外框 `pointer-events: none`）：静态复现不该让人以为能点。
 * 展厅可显式传 `interactive` 开启导航与任务勾选；视图里的编辑控件仍是
 * 产品形态的静态复现。这样访客能在同一份演示数据里浏览页面、感受任务完成如何
 * 改变列表与四象限，而不会误以为落地页已经接入真实账户或持久化。
 *
 * 🔴 **外壳结构不在这里手写**：导航项、视图 tab、面板区块全部从
 * `./app-shell-shape.js` 的登记处派生，而那份登记由
 * `tests/mockup-shell-shape.spec.tsx` 与 `apps/web/src/App.tsx` 的源码逐项对账。
 * 四象限的计数同理，从 `./showcase-data.js` 的同一份样例任务派生。
 * 复刻原来在这几处各手抄了一份，于是漂移了五项而没有任何门禁看得见
 * （`docs/research/showcase-fidelity-audit.md` §2 与 §6.2）。
 *
 * 尺寸策略：stage 固定 80rem × 50rem（应用在 1280×800 下的真实布局），
 * 用 ResizeObserver 算出等比缩放 —— 这样**比例与应用逐像素一致**，
 * 而不是"重新做一套看着差不多的响应式布局"。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  CalendarDays,
  CalendarRange,
  ChartGantt,
  Check,
  CheckCircle2,
  CircleDot,
  CircleHelp,
  Folder,
  MoreHorizontal,
  RefreshCw,
  UserRound,
  Inbox,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
  Sun,
  StickyNote,
  Tag as TagIcon,
  Trash2,
  TrendingUp,
  X,
  type LucideIcon,
} from 'lucide-react';

import { useI18n, type MessageKey } from '@heyta/i18n/provider';

import './mockup.css';

import {
  SHELL_HEADER_ACTIONS,
  SHELL_PANEL_SECTIONS,
  SHELL_PRIMARY_NAV,
  SHELL_QUADRANT_NAV,
  SHELL_QUADRANT_SECTION_KEY,
  SHELL_VIEW_TABS,
  MOCKUP_PREVIEW_TABS,
  type MockView,
  type ShellNavIconId,
  type ShellViewKey,
} from './app-shell-shape.js';
import {
  MOCK_CAPTURE_ADD_ICON_SIZE,
  MOCK_CAPTURE_CAN_SUBMIT,
  MOCK_CAPTURE_CLASS,
  MOCK_CAPTURE_KEYS,
  mockCaptureAddClass,
} from './capture-shape.js';
import { SHOWCASE_TASKS, showcaseQuadrantCounts } from './showcase-data.js';
import { TaskList } from './TaskList.js';
import { QuadrantGrid } from './QuadrantGrid.js';
import { HabitHeatmap } from './HabitHeatmap.js';
import { FocusRing } from './FocusRing.js';
import { TimelineBoard } from './TimelineBoard.js';

export type { MockView } from './app-shell-shape.js';

/** stage 的设计尺寸，单位 rem。与 `mockup.css` 的 `.mk-stage` 必须一致。 */
const STAGE_WIDTH_REM = 80;

/** 图标 id → 真实图标组件。纯数据模块不 import React，所以映射放在宿主。 */
const SHELL_ICONS: Record<ShellNavIconId, LucideIcon> = {
  inbox: Inbox,
  'calendar-days': CalendarDays,
  'calendar-range': CalendarRange,
  search: Search,
  sun: Sun,
  'check-circle': CheckCircle2,
  'circle-dot': CircleDot,
  check: Check,
  'chart-gantt': ChartGantt,
  'trending-up': TrendingUp,
  'sticky-note': StickyNote,
  trash: Trash2,
  settings: Settings,
};

/**
 * 等比缩放。
 *
 * 🔴 用 ResizeObserver 而不是监听 `window.resize`：
 * 窗口没变但容器变了（比如进入分栏、或字体缩放）时，`resize` 不会触发，
 * 界面就会保持一个错的缩放比 —— 而那种错看起来像"布局写死了"。
 */
function useStageScale(
  frameRef: RefObject<HTMLDivElement | null>,
  mobileMinimum = 0,
): number {
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = frameRef.current;
    if (el === null) return;

    const compute = (): void => {
      const rootFontSize = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const stageWidth = STAGE_WIDTH_REM * rootFontSize;
      const available = el.clientWidth;
      const isNarrow = typeof window.matchMedia === 'function' &&
        window.matchMedia('(max-width: 40rem)').matches;
      if (available > 0 && stageWidth > 0) {
        setScale(Math.max(available / stageWidth, isNarrow ? mobileMinimum : 0));
      }
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [frameRef]);

  // 首帧 scale 为 0 会让内容整个塌掉；先按 1 渲染，测量完再收敛。
  return scale > 0 ? scale : 1;
}

function NavItem({
  icon,
  label,
  count,
  active,
  swatch,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  swatch?: string;
  onClick?: () => void;
}): React.JSX.Element {
  const content = (
    <>
      {swatch !== undefined ? <span className={`mk-swatch ${swatch}`} /> : (icon ?? null)}
      {label}
      {/* 与真应用 `NavButton` 同一条判据：**只有 > 0 才渲染计数位**。
          空账号的计数恒为 0，所以审计那张截图上一个数字都没有 ——
          那不是"产品没有这个位"，是"位在、值为 0"。 */}
      {count !== undefined && count > 0 && <span className="mk-nav__count">{count}</span>}
    </>
  );
  return onClick === undefined ? (
    <div className={`mk-nav__item${active === true ? ' mk-nav__item--active' : ''}`}>{content}</div>
  ) : (
    <button type="button" className={`mk-nav__item${active === true ? ' mk-nav__item--active' : ''}`} onClick={onClick}>
      {content}
    </button>
  );
}

export function AppWindow({
  view = 'tasks',
  className,
  interactive = false,
  onViewChange,
}: {
  view?: MockView;
  className?: string;
  interactive?: boolean;
  onViewChange?: (view: MockView) => void;
}): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const scale = useStageScale(frameRef, interactive ? 1 : 0);
  const { t } = useI18n();
  const [completedIds, setCompletedIds] = useState<ReadonlySet<string>>(
    () => new Set(SHOWCASE_TASKS.filter((task) => task.done === true).map((task) => task.id)),
  );
  const [activeView, setActiveView] = useState<MockView>(view);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState('mk-weekly');
  const [detailOpen, setDetailOpen] = useState(false);
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (detailOpen && window.matchMedia('(max-width: 40rem)').matches) {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [detailOpen, selectedTaskId]);

  useEffect(() => {
    setActiveView(view);
  }, [view]);

  const navigate = useCallback((next: MockView): void => {
    const focusedRail = frameRef.current?.contains(document.activeElement) === true &&
      document.activeElement instanceof HTMLButtonElement;
    setActiveView(next);
    setDetailOpen(false);
    setOverflowOpen(false);
    onViewChange?.(next);
    if (focusedRail) {
      // The selected overflow item is reparented into the primary rail after
      // navigation. Restore focus after that commit so keyboard users do not
      // fall back to document.body when the overflow menu closes.
      window.setTimeout(() => {
        const button = [...(frameRef.current?.querySelectorAll<HTMLButtonElement>('[data-view-key]') ?? [])]
          .find((candidate) => candidate.dataset.viewKey === next);
        button?.focus();
      }, 0);
    }
  }, [onViewChange]);

  const isMockView = (key: ShellViewKey): key is MockView =>
    key === 'tasks' || key === 'quadrant' || key === 'habits' || key === 'focus' || key === 'timeline';

  const toggleTask = useCallback((id: string): void => {
    setCompletedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedTask = SHOWCASE_TASKS.find((task) => task.id === selectedTaskId) ?? SHOWCASE_TASKS[0]!;
  const selectedTaskDone = completedIds.has(selectedTask.id);

  /**
   * 顶部标题。
   *
   * 🔴 与视图 tab 同源：`titles` 从 `SHELL_VIEW_TABS` 派生，用**应用自己的词条 key**。
   * 「任务」视图的标题是「收集箱」（`web.shell.nav.inbox`），其余直接用 tab 的 key ——
   * 这一条对应 `App.tsx` 的 `title` 推导（任务 / 四象限的标题更具体）。
   *
   * ⚠️ 覆盖**全部视图 key**（`Record<ShellViewKey, …>`），不是只覆盖展厅当前能画的
   * 几个。只填已展示视图时，`titles[view]` 对其他合法 key 会是 `undefined`
   * 并静默回落成别的标题 —— 加了「便签」这一项之后，那正是会发生的漂移。
   */
  const titles = useMemo<Record<ShellViewKey, string>>(() => {
    const byKey = new Map(SHELL_VIEW_TABS.map((tab) => [tab.key, tab.labelKey]));
    const fromTab = (key: ShellViewKey, fallback: MessageKey): string =>
      t(byKey.get(key) ?? fallback);
    return {
      tasks: t('web.shell.nav.inbox'),
      // 日历：与 web 壳同一波加进 rail 的（滴答 rail 的「日历」那一格）。
      calendar: fromTab('calendar', 'web.calendar.title'),
      search: fromTab('search', 'web.search.title'),
      quadrant: fromTab('quadrant', 'web.shell.nav.quadrant'),
      habits: fromTab('habits', 'web.shell.views.habits'),
      focus: fromTab('focus', 'web.shell.views.focus'),
      timeline: fromTab('timeline', 'web.shell.views.timeline'),
      growth: fromTab('growth', 'web.shell.views.growth'),
      notes: fromTab('notes', 'web.shell.views.notes'),
      trash: fromTab('trash', 'web.trash.nav'),
      settings: fromTab('settings', 'web.shell.views.settings'),
    };
  }, [t]);

  /**
   * 侧栏四象限的计数。
   *
   * 🔴 数值**从样例任务派生**（`showcase-data.ts` 的唯一一份），与四象限看板上的
   * 卡片数结构上一致。复刻原来在这里写死了 3 / 5 / 2 / 1，与真应用算出来的不一致
   * （§2 #2）。已完成任务不计入 —— 与 `bucketByQuadrant()` 同一条语义。
   */
  const counts = useMemo(
    () =>
      showcaseQuadrantCounts(
        SHOWCASE_TASKS.map((task) =>
          ({ ...task, done: completedIds.has(task.id) }),
        ),
      ),
    [completedIds],
  );

  // The real Web shell is rail → scope sidebar → main → detail.  The rail
  // keeps four high-frequency destinations on the surface and moves the rest
  // behind “More”; an active overflow view is promoted so its location remains
  // visible.  This is deliberately derived from the same default rail list
  // used by the shell shape registry rather than drawing a second tab strip in
  // the header.
  const railTabs = useMemo(() => {
    const visible = [...(interactive ? MOCKUP_PREVIEW_TABS : SHELL_VIEW_TABS)]
      .filter((tab) => !interactive || isMockView(tab.key));
    const pinned = new Set<ShellViewKey>(['tasks', 'calendar', 'habits', 'search']);
    const primary = visible
      .filter((tab) => pinned.has(tab.key))
      .slice(0, 4)
      .concat(visible.filter((tab) => !pinned.has(tab.key)).slice(0, 4))
      .slice(0, 4);
    const primaryKeys = new Set(primary.map((tab) => tab.key));
    const overflow = visible.filter((tab) => !primaryKeys.has(tab.key));
    if (overflow.some((tab) => tab.key === activeView)) {
      const promoted = overflow.find((tab) => tab.key === activeView);
      const replaced = primary[primary.length - 1];
      if (promoted !== undefined && replaced !== undefined) {
        return { primary: [...primary.slice(0, -1), promoted], overflow: [replaced, ...overflow.filter((tab) => tab.key !== activeView)] };
      }
    }
    return { primary, overflow };
  }, [activeView, interactive]);

  const renderRailTab = (
    tab: (typeof MOCKUP_PREVIEW_TABS)[number],
    menuItem = false,
  ): React.JSX.Element => {
    const Icon = SHELL_ICONS[tab.icon];
    const destination = isMockView(tab.key) ? tab.key : undefined;
    const tabClass = `mk-rail__tab${tab.key === activeView ? ' mk-rail__tab--active' : ''}`;
    const content = <><Icon size={ICON_SIZE.sm} /><span>{t(tab.labelKey)}</span></>;
    if (!interactive) {
      return <div key={tab.key} data-view-key={tab.key} className={tabClass}>{content}</div>;
    }
    return (
      <button
        key={tab.key}
        type="button"
        data-view-key={tab.key}
        className={tabClass}
        aria-label={t(tab.labelKey)}
        title={t(tab.labelKey)}
        role={menuItem ? 'menuitem' : undefined}
        aria-current={tab.key === activeView ? 'page' : undefined}
        onClick={destination === undefined ? undefined : () => navigate(destination)}
      >
        {content}
      </button>
    );
  };

  return (
    <div
      ref={frameRef}
      className={`mk-frame${interactive ? ' mk-frame--interactive' : ''}${className !== undefined ? ` ${className}` : ''}`}
    >
      <div className="mk-stage" style={{ '--mk-scale': String(scale) } as React.CSSProperties}>
        <div className={`mk-app${activeView === 'tasks' ? ' mk-app--with-sidebar' : ''}`}>
          <nav className="mk-rail" onKeyDown={(event) => {
            if (event.key === 'Escape' && overflowOpen) {
              setOverflowOpen(false);
              frameRef.current?.querySelector<HTMLButtonElement>('.mk-rail__more')?.focus();
            }
          }} onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOverflowOpen(false);
          }}>
            <div className="mk-rail__top">
              <span className="mk-avatar" aria-label={t('web.shell.account.aria')}><UserRound size={ICON_SIZE.sm} /></span>
            </div>
            <div className="mk-rail__tabs">
              {railTabs.primary.map((tab) => renderRailTab(tab))}
              {railTabs.overflow.length > 0 && !interactive ? (
                <div className="mk-rail__more"><MoreHorizontal size={ICON_SIZE.sm} /><span>{t('web.shell.views.groupMore')}</span></div>
              ) : railTabs.overflow.length > 0 ? (
                <button
                  type="button"
                  className="mk-rail__more"
                  aria-label={t('web.shell.views.groupMore')}
                  title={t('web.shell.views.groupMore')}
                  aria-expanded={overflowOpen}
                  aria-haspopup="menu"
                  onClick={() => setOverflowOpen((open) => !open)}
                >
                  <MoreHorizontal size={ICON_SIZE.sm} />
                  <span>{t('web.shell.views.groupMore')}</span>
                </button>
              ) : null}
              {overflowOpen && railTabs.overflow.length > 0 ? (
                <div className="mk-rail__overflow" role="menu">
                  {railTabs.overflow.map((tab) => renderRailTab(tab, true))}
                </div>
              ) : null}
            </div>
            <div className="mk-rail__tools">
              {interactive ? null : renderRailTab(SHELL_VIEW_TABS.find((tab) => tab.key === 'trash') ?? SHELL_VIEW_TABS[0]!)}
              <div className="mk-rail__tab"><CircleHelp size={ICON_SIZE.sm} /><span>{t('web.shell.nav.help')}</span></div>
              <div className="mk-rail__sync"><RefreshCw size={ICON_SIZE.xs} /><span>{t('web.sync.status.synced')}</span></div>
            </div>
          </nav>

          {activeView === 'tasks' ? <nav className="mk-sidebar">

            {/*
              🔴 主导航三项（今天 / 最近 7 天 / 已完成），从 `SHELL_PRIMARY_NAV` 派生。
              「已完成」原来是漏的（§2 #1）—— 少画一个入口是"不完整"。
              ⚠️ 2026-10-04：「收集箱」那一行被删（与页头标题重复），所以这一组里
              **没有会高亮的一项** —— 真应用也一样：停在收集箱时高亮的是 rail 的
              「任务」，侧栏那三条都是"另有筛选"时才亮。
            */}
            <div className="mk-nav">
              {SHELL_PRIMARY_NAV.map((item) => {
                const ItemIcon = SHELL_ICONS[item.icon];
                return (
                  <NavItem
                    key={item.labelKey}
                    icon={<ItemIcon size={ICON_SIZE.sm} />}
                    label={t(item.labelKey)}
                    active={false}
                    onClick={interactive ? () => navigate('tasks') : undefined}
                  />
                );
              })}
            </div>

            {/* ⚠️ 分区标题用 `web.shell.nav.quadrantSection`，不是 `web.shell.nav.quadrant`
                （两者中文都是「四象限」，所以抄错不会有视觉差异）。 */}
            <div className="mk-nav__section">{t(SHELL_QUADRANT_SECTION_KEY)}</div>
            {/*
              🔴 四象限导航从 `SHELL_QUADRANT_NAV` 派生，且 `count` 由样例任务算出。
              真应用的 `NavEntry` 本身**没有 count 字段** —— 计数是单独算出来传进去的。
            */}
            <div className="mk-nav">
              {SHELL_QUADRANT_NAV.map((item) => (
                <NavItem
                  key={item.labelKey}
                  swatch={`mk-swatch--${item.swatch}`}
                  label={t(item.labelKey)}
                  count={counts[item.quadrant]}
                  onClick={interactive ? () => navigate('quadrant') : undefined}
                />
              ))}
            </div>

            {/*
              清单与标签。真实 Web 是「分区标题 + OrganizerList 行 + 标题级创建按钮」；
              创建表单在点击 `+` 后才出现，由宿主对话框承载。静态展厅因此只保留真实的
              行层级和创建入口，不画一个看起来随时可输入、却没有行为的假输入框。
            */}
            {SHELL_PANEL_SECTIONS.map((section) => (
              <div key={section.id} className="mk-projects">
                <div className="mk-nav__section mk-projects__heading">
                  <span>{t(section.headingKey)}</span>
                  <span className="mk-field__add" aria-label={t(section.createLabelKey)}>
                    <Plus size={ICON_SIZE.xs} />
                  </span>
                </div>
                <div className="mk-projects__rows">
                  {section.sampleNameKeys.map((nameKey) => (
                    <div key={nameKey} className="mk-projects__row">
                      {section.id === 'projects' ? (
                        <Folder size={ICON_SIZE.xs} aria-hidden="true" />
                      ) : (
                        <TagIcon size={ICON_SIZE.xs} aria-hidden="true" />
                      )}
                      <span>{t(nameKey)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </nav> : null}

          <main className="mk-main">
            <header className="mk-header">
              <h1 className="mk-header__title">{titles[activeView]}</h1>

              <div className="mk-header__actions">
                {/*
                  🔴 这一排**从登记处派生**，不再手抄。
                  它原来在这里画着六件早已不在页头的东西：同步状态胶囊、「立即同步」、
                  同步设置齿轮、两枚语言按钮、主题按钮（后两枚 2026-10-06 搬进
                  设置 → 显示，同步那三枚同一天下移 rail 底部；「日期 / 倒计时」
                  更早在 2026-09-30 就进了设置）。而当时那条判据是** positively 要求**
                  这六件都在的 —— 于是 26 条展厅测试全绿，图上却是过时的形状。
                  逐件去向写在 `SHELL_HEADER_MOVED_OUT`，对账与反向判据在
                  `tests/mockup-shell-shape.spec.tsx` 的 #7 那一组。
                */}
                {SHELL_HEADER_ACTIONS.filter(
                  (action) =>
                    action.mockedInLanding !== false &&
                    (action.onlyForView === undefined || action.onlyForView === activeView),
                ).map((action) =>
                  action.kind === 'bulk-toolbar' ? (
                    <div key={action.id} className="mk-bulk" data-testid="bulk-toolbar">
                      <span className="mk-bulk__select">{t(action.labelKey)}</span>
                    </div>
                  ) : action.kind === 'sort-select' ? (
                    <div key={action.id} className="mk-sort">
                      {/* 与真应用同一条：**带可见的文字标签**，不是光秃秃一枚下拉。 */}
                      <span className="mk-sort__label">{t(action.labelKey)}</span>
                      <span className="mk-sort__value">{t(action.optionKey ?? action.labelKey)}</span>
                    </div>
                  ) : (
                    <div
                      key={action.id}
                      className="mk-iconbtn"
                      role="img"
                      aria-label={t(action.labelKey)}
                    >
                      <PanelRightOpen size={ICON_SIZE.md} />
                    </div>
                  ),
                )}
              </div>
            </header>

            {/*
              🔴 内容区的顺序照抄 `apps/web/src/App.tsx`：**捕获输入框 → 视图内容**。

              ⚠️ 这里**没有**今日进度卡，是刻意的而不是漏画：产品侧 R6 那一刀把它从
              "做事"的四个视图撤了（理由写在 `App.tsx:2288-2304` —— 把三个位置该说的数字
              压成一个谁都不看的分数，且 0/0 时它说的是"你什么都没安排"）。共享卡片本身
              没删，它现在只住成长页。展厅这五屏全是"做事"屏 ⇒ 一张都不该画。
              这条边界由 `tests/mockup-fidelity.spec.tsx` 反向钉住，并且**从产品源码派生**：
              哪天真应用把卡放回做事视图，那条判据会先红，而不是让这里悄悄落后。
            */}
            <div className="mk-content">
              {/*
                🔴 捕获输入行从 `./capture-shape.js` 的登记处派生。
                它原来手抄了 `.mk-input` / `.mk-btn-primary` 两个类名，而那一族
                属于 `FocusPanel` 的按钮（`space.4` / `space.2`）——
                于是捕获这一块的每个数值都是隔壁组件抄来的，且没有任何门禁看得见。
                修饰类 `--capture` 承载捕获自己的取值（`size.field-padding-x` /
                `space.1` / `font-weight.regular`），基础规则留给 `FocusRing`。

                ⚠️ 这里画的是**空输入框**（只有 placeholder）：共享组件在
                `chips.length > 0` 之外不渲染识别芯片与「实际标题」预览，
                所以本行**恰好两个子元素**是对的，不是漏画。按钮的 `--off`
                也来自同一个事实 —— 空标题下真实现给的是 `state.disabled-opacity`。
              */}
              {activeView === 'tasks' ? (
                <div className={MOCK_CAPTURE_CLASS.row}>
                  <div className={MOCK_CAPTURE_CLASS.input}>{t(MOCK_CAPTURE_KEYS.placeholder)}</div>
                  <div className={mockCaptureAddClass(MOCK_CAPTURE_CAN_SUBMIT)}>
                    <Plus size={MOCK_CAPTURE_ADD_ICON_SIZE} />
                    {t(MOCK_CAPTURE_KEYS.add)}
                  </div>
                </div>
              ) : null}

              {activeView === 'tasks' && (
                <TaskList
                  completedIds={completedIds}
                  onTaskToggle={interactive ? toggleTask : undefined}
                  selectedId={selectedTask.id}
                  onSelect={interactive ? (id) => { setSelectedTaskId(id); setDetailOpen(true); } : undefined}
                />
              )}
              {activeView === 'quadrant' && <QuadrantGrid completedIds={completedIds} />}
              {activeView === 'habits' && <HabitHeatmap interactive={interactive} />}
              {activeView === 'focus' && <FocusRing />}
              {activeView === 'timeline' && <TimelineBoard />}
            </div>
          </main>

          {activeView === 'tasks' ? (
            <aside ref={detailRef} tabIndex={-1} data-open={detailOpen} className="mk-detail" aria-label={t('web.tasks.detail.section.basic')}>
              <div className="mk-detail__task-title">
                <span className={`mk-detail__status${selectedTaskDone ? ' mk-detail__status--done' : ''}`} aria-hidden="true"><Check size={ICON_SIZE.xs} /></span>
                <strong>{t(selectedTask.titleKey)}</strong>
                {interactive && <button type="button" className="mk-detail__close" aria-label={t('web.inbox.close')}
                  onClick={() => {
                    setDetailOpen(false);
                    frameRef.current?.querySelector<HTMLButtonElement>('.mk-task__body[aria-pressed="true"]')?.focus();
                  }}><X size={ICON_SIZE.sm} /></button>}
              </div>

              <section className="mk-detail__group">
                <h2>{t('web.tasks.detail.section.basic')}</h2>
                <div className="mk-detail__field">
                  <span className="mk-detail__label">{t('web.note.toggle')}</span>
                  <span className="mk-detail__value">{t('web.note.placeholder')}</span>
                </div>
              </section>

              <section className="mk-detail__group">
                <h2>{t('web.tasks.detail.section.time')}</h2>
                <div className="mk-detail__field">
                  <span className="mk-detail__label">{t('web.due.trigger')}</span>
                  <span className="mk-detail__value">{selectedTask.dueKey === undefined ? t('web.ai.capture.priority.none') : t(selectedTask.dueKey)}</span>
                </div>
              </section>

              <section className="mk-detail__group">
                <h2>{t('web.tasks.detail.section.organize')}</h2>
                <div className="mk-detail__field">
                  <span className="mk-detail__label">{t('web.organize.projectLabel')}</span>
                  <span className="mk-detail__value">{selectedTask.projectKey === undefined ? t('web.ai.capture.priority.none') : t(selectedTask.projectKey)}</span>
                </div>
                <div className="mk-detail__field">
                  <span className="mk-detail__label">{t('web.subtask.none')}</span>
                  <span className="mk-detail__value">{t('web.subtask.none')}</span>
                </div>
                <div className="mk-detail__field">
                  <span className="mk-detail__label">{t('web.ai.capture.field.priority')}</span>
                  <span className="mk-detail__value">{selectedTask.priority === undefined ? t('web.ai.prioritize.priority.none') : t(`web.ai.prioritize.priority.${selectedTask.priority === 3 ? 'high' : selectedTask.priority === 2 ? 'medium' : 'low'}` as MessageKey)}</span>
                </div>
              </section>

              <section className="mk-detail__group">
                <h2>{t('web.tasks.detail.section.automation')}</h2>
                <div className="mk-detail__field">
                  <span className="mk-detail__label">{t('web.tasks.detail.section.automation')}</span>
                  <span className="mk-detail__value">{t('web.repeat.none')}</span>
                </div>
              </section>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
