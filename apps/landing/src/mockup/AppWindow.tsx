import { ICON_SIZE } from '@heyta/design-system';
/**
 * 真实界面复现：桌面外壳
 * =========================
 *
 * 复现对象：`apps/web/src/App.tsx` 的 `.ht-app` 网格
 * （侧栏 + 主区；主区里是标题栏 / 视图切换 / 内容区）。
 *
 * ⚠️ 这是**复现**，不是应用本身 —— 详见 `mockup.css` 文件头。
 * 它刻意不可交互（外框 `pointer-events: none`）：展示品不该让人以为能点。
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

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  CalendarDays,
  CalendarRange,
  ChartGantt,
  Check,
  CheckCircle2,
  CircleDot,
  Inbox,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
  Sun,
  StickyNote,
  Trash2,
  TrendingUp,
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
import { showcaseQuadrantCounts } from './showcase-data.js';
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
      const available = el.getBoundingClientRect().width;
      if (available > 0 && stageWidth > 0) setScale(available / stageWidth);
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
}: {
  icon?: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  swatch?: string;
}): React.JSX.Element {
  return (
    <div className={`mk-nav__item${active === true ? ' mk-nav__item--active' : ''}`}>
      {swatch !== undefined ? (
        <span className={`mk-swatch ${swatch}`} />
      ) : (
        (icon ?? null)
      )}
      {label}
      {/* 与真应用 `NavButton` 同一条判据：**只有 > 0 才渲染计数位**。
          空账号的计数恒为 0，所以审计那张截图上一个数字都没有 ——
          那不是"产品没有这个位"，是"位在、值为 0"。 */}
      {count !== undefined && count > 0 && <span className="mk-nav__count">{count}</span>}
    </div>
  );
}

export function AppWindow({
  view = 'tasks',
  className,
}: {
  view?: MockView;
  className?: string;
}): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const scale = useStageScale(frameRef);
  const { t } = useI18n();

  /**
   * 顶部标题。
   *
   * 🔴 与视图 tab 同源：`titles` 从 `SHELL_VIEW_TABS` 派生，用**应用自己的词条 key**。
   * 「任务」视图的标题是「收集箱」（`web.shell.nav.inbox`），其余直接用 tab 的 key ——
   * 这一条对应 `App.tsx` 的 `title` 推导（任务 / 四象限的标题更具体）。
   *
   * ⚠️ 覆盖**全部 9 个 tab**（`Record<ShellViewKey, …>`），不是只覆盖复刻能画内容的
   * 那 4 个。只填 4 个时，`titles[view]` 对没登记的那个 key 会是 `undefined`
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
  const counts = useMemo(() => showcaseQuadrantCounts(), []);

  return (
    <div ref={frameRef} className={`mk-frame${className !== undefined ? ` ${className}` : ''}`}>
      <div className="mk-stage" style={{ '--mk-scale': String(scale) } as React.CSSProperties}>
        <div className="mk-app">
          <nav className="mk-sidebar">
            <div className="mk-brand">
              <span className="mk-brand__dot" />
              {t('common.brand')}
            </div>

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
                />
              ))}
            </div>

            {/*
              清单与标签。真应用里这两块都是 `ProjectsPanel`（aria-label「清单与标签」），
              每块 = 标题 + **输入框形态的「新…」+ `+`**。
              复刻原来把清单画成三行静态名字，**标签整块没有**（§2 #3/#4）。
            */}
            {SHELL_PANEL_SECTIONS.map((section) => (
              <div key={section.id} className="mk-projects">
                <div className="mk-nav__section">{t(section.headingKey)}</div>
                <div className="mk-field">
                  <span className="mk-field__box">{t(section.newPlaceholderKey)}</span>
                  <span className="mk-field__add">
                    <Plus size={ICON_SIZE.xs} />
                  </span>
                </div>
              </div>
            ))}
          </nav>

          <main className="mk-main">
            <header className="mk-header">
              <h1 className="mk-header__title">{titles[view]}</h1>

              {/*
                🔴 **9 项，与 `apps/web/src/App.tsx` 的 `VIEW_TABS` 逐项对齐**，
                从 `SHELL_VIEW_TABS` 派生。复刻原来只有 4 项，于是复刻出来的界面
                **比真应用好看** —— 访客在页面上看到 4 个干净的标签，装上应用拿到 9 个（§2 #5）。
                后 5 项（时间线/成长/便签/回收站/设置）在这一屏里没有对应内容，
                它们只是外壳的一部分（复刻刻意不可交互，见文件头）。
              */}
              <div className="mk-viewtabs">
                {SHELL_VIEW_TABS.map((tab) => {
                  const TabIcon = SHELL_ICONS[tab.icon];
                  return (
                    <div
                      key={tab.key}
                      className={`mk-viewtab${
                        tab.key === view ? ' mk-viewtab--active' : ''
                      }`}
                    >
                      <TabIcon size={ICON_SIZE.xs} />
                      {t(tab.labelKey)}
                    </div>
                  );
                })}
              </div>

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
                  (action) => action.onlyForView === undefined || action.onlyForView === view,
                ).map((action) =>
                  action.kind === 'sort-select' ? (
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
              <div className={MOCK_CAPTURE_CLASS.row}>
                <div className={MOCK_CAPTURE_CLASS.input}>{t(MOCK_CAPTURE_KEYS.placeholder)}</div>
                <div className={mockCaptureAddClass(MOCK_CAPTURE_CAN_SUBMIT)}>
                  <Plus size={MOCK_CAPTURE_ADD_ICON_SIZE} />
                  {t(MOCK_CAPTURE_KEYS.add)}
                </div>
              </div>

              {view === 'tasks' && <TaskList />}
              {view === 'quadrant' && <QuadrantGrid />}
              {view === 'habits' && <HabitHeatmap />}
              {view === 'focus' && <FocusRing />}
              {view === 'timeline' && <TimelineBoard />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
