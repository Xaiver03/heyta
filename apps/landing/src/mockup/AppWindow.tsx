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
  ChartGantt,
  Check,
  CheckCircle2,
  CircleDot,
  Inbox,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  StickyNote,
  Sun,
  Timer,
  Trash2,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { useI18n, type MessageKey } from '@heyta/i18n/provider';

import './mockup.css';

import {
  SHELL_DUE_MODE_TABS,
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
import { SHOWCASE_TODAY_PROGRESS, showcaseQuadrantCounts } from './showcase-data.js';
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
  const { t, locale } = useI18n();

  /**
   * 语言切换按钮上的词 = **另一种语言自己的名字**（与 `LanguageSwitcher.tsx`
   * 同一条规则：用目标语言的发音规则读它，所以中文界面显示 "English"）。
   *
   * ⚠️ 分支写在 `t(...)` **外面** —— `check:ui-language` 只认"字面量紧跟 `t(`"，
   * `t(cond ? 'a' : 'b')` 那种写法它认不出来（真应用那个组件里也留了同样的注释）。
   */
  const otherLangLabel = locale === 'zh-CN' ? t('common.lang.en') : t('common.lang.zh');

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
              🔴 主导航三项（收集箱 / 今天 / 已完成），从 `SHELL_PRIMARY_NAV` 派生。
              「已完成」原来是漏的（§2 #1）—— 少画一个入口是"不完整"。
            */}
            <div className="mk-nav">
              {SHELL_PRIMARY_NAV.map((item) => {
                const ItemIcon = SHELL_ICONS[item.icon];
                return (
                  <NavItem
                    key={item.labelKey}
                    icon={<ItemIcon size={16} />}
                    label={t(item.labelKey)}
                    active={item.labelKey === 'web.shell.nav.inbox' && view === 'tasks'}
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
                    <Plus size={14} />
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
                      <TabIcon size={14} />
                      {t(tab.labelKey)}
                    </div>
                  );
                })}
              </div>

              <div className="mk-header__actions">
                <div className="mk-viewtabs">
                  {SHELL_DUE_MODE_TABS.map((tab, index) => (
                    <div
                      key={tab.labelKey}
                      className={`mk-viewtab${index === 0 ? ' mk-viewtab--active' : ''}`}
                    >
                      {index === 0 ? <CalendarDays size={14} /> : <Timer size={14} />}
                      {t(tab.labelKey)}
                    </div>
                  ))}
                </div>
                <div className="mk-sync mk-sync--ok">
                  <Zap size={12} />
                  {t('web.sync.status.synced')}
                </div>
                {/*
                  🔴 这三件原来都漏了。真应用的顶栏右侧是
                  **SyncBar（状态 + 立即同步 + 设置）+ LanguageSwitcher + 主题**，
                  而复刻只画了状态那一个胶囊。
                  文案用应用自己的 key，图标与真应用同一套（lucide）。
                */}
                <div className="mk-iconbtn" role="img" aria-label={t('web.sync.a11y.syncNow')}>
                  <RefreshCw size={14} />
                </div>
                <div className="mk-iconbtn" role="img" aria-label={t('web.sync.settings.title')}>
                  <Settings size={14} />
                </div>
                <div className="mk-lang" lang={locale === 'zh-CN' ? 'en' : 'zh-CN'}>
                  {otherLangLabel}
                </div>
                <div className="mk-iconbtn">
                  <Moon size={18} />
                </div>
              </div>
            </header>

            {/*
              🔴 内容区的顺序照抄 `apps/web/src/App.tsx`：
              **今天进度卡 → 捕获输入框 → 视图内容**。
              复刻原来只在"任务"那一屏画了输入框、四屏都没有进度卡 ——
              而真应用两者在四个视图上**都在**。
            */}
            <div className="mk-content">
              {/*
                🔴 M3 第十一刀（motivation）之后这张卡是**共享组件**
                （`packages/ui/src/motivation/TodayProgressCard.tsx`），
                结构变了：
                  · **没有"今天"这个标签** —— 共享卡片只画"比例 + 提示 + 横条"；
                  · 比例是 `done/total` **一整段**（`numeric-display`），不是"大数字 + 小分母"；
                  · 提示与比例**并排**（head 是一行，`align-items: flex-end`），不换行到下面；
                  · 横条填充用 `inline-size` 而不是 `scaleX`（RN 的 scaleX 以中心为原点）。
                取值仍来自 `SHOWCASE_TODAY_PROGRESS`（产品决策 P5）。
                token 逐个对账的判据在 `tests/mockup-today-shape.spec.tsx`。

                ⚠️ 共享卡片在 `total > 0` 时还会画"习惯/任务/计划外"明细行，`focusMinutes > 0`
                时画专注行，闭环时画闭环句 —— 展厅样例数据里没有这三组取值
                （`SHOWCASE_TODAY_PROGRESS` 只有 done/total/remaining，见 `showcase-data.ts`），
                故**未复刻**；补齐方式见上面那份 spec 的说明。
              */}
              <section className="mk-today" aria-label={t('web.progress.aria')}>
                <div className="mk-today__head">
                  <div className="mk-today__count">
                    {today.done}/{today.total}
                  </div>
                  <div className="mk-today__hint">
                    {t('web.progress.hint.remaining', { count: today.remaining })}
                  </div>
                </div>
                <div className="mk-today__bar">
                  <span
                    className="mk-today__bar-fill"
                    style={{ width: `${String((today.done / today.total) * 100)}%` }}
                  />
                </div>
              </section>

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

/**
 * 今日进度卡（复现共享 `packages/ui/src/motivation/TodayProgressCard.tsx`）。
 *
 * 🔴 真应用在**任务 / 四象限 / 习惯 / 番茄钟**四个视图上都常驻这张卡
 * （`App.tsx` 的 `view !== 'settings' && … && <TodayProgressBanner />`，
 * banner 是共享卡片的接线层），而复刻原来四屏**一张都没有**。
 *
 * ⚠️ M3 第十一刀之后它的来源是 `@heyta/ui`（web 侧不再有 `.ht-today` DOM/CSS），
 * 所以结构/取值的权威对照是共享组件本身 —— 逐 token 对账见
 * `tests/mockup-today-shape.spec.tsx`。
 *
 * 🔴 数值来自 `showcase-data.ts` 的 `SHOWCASE_TODAY_PROGRESS`（产品决策 P5）——
 * 那不是"随手写在渲染文件里的魔数"，而是**集中登记 + 有注释说明为何不可派生**的样例数据。
 * 详见那个常量上的说明。
 */
const today = SHOWCASE_TODAY_PROGRESS;
