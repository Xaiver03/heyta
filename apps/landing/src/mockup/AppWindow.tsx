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
 * 尺寸策略：stage 固定 80rem × 50rem（应用在 1280×800 下的真实布局），
 * 用 ResizeObserver 算出等比缩放 —— 这样**比例与应用逐像素一致**，
 * 而不是"重新做一套看着差不多的响应式布局"。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  CalendarDays,
  ChartGantt,
  Check,
  CircleDot,
  Inbox,
  Moon,
  Plus,
  RefreshCw,
  Settings,
  Sun,
  Timer,
  Trash2,
  TrendingUp,
  Zap,
} from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import './mockup.css';

import { TaskList } from './TaskList.js';
import { QuadrantGrid } from './QuadrantGrid.js';
import { HabitHeatmap } from './HabitHeatmap.js';
import { FocusRing } from './FocusRing.js';

/** 应用的桌面视图。与 `App.tsx` 的 `ViewKey` 一致（少了「设置」，展示用不到）。 */
export type MockView = 'tasks' | 'quadrant' | 'habits' | 'focus';

/** stage 的设计尺寸，单位 rem。与 `mockup.css` 的 `.mk-stage` 必须一致。 */
const STAGE_WIDTH_REM = 80;

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
   * 视图切换条。
   *
   * 🔴 **8 项，与 `apps/web/src/App.tsx` 的 `VIEW_TABS` 逐项对齐。**
   * 复数过一次：这里原来只有 4 项（任务/四象限/习惯/番茄钟），而复刻出来的界面
   * 因此**比真应用好看** —— 访客在页面上看到 4 个干净的标签，装上应用拿到 8 个。
   * 详见 `docs/research/showcase-fidelity-audit.md` §2。
   *
   * 标签直接用**应用自己的词条 key**（`web.shell.*` / `web.trash.*`），
   * 而不是另写一份 `landing.*`：同一个界面元素用同一份文案，
   * **改词的人不可能只改一边**。这也是这条漂移最不容易被注意到的地方 ——
   * 4 项 vs 8 项是结构差异，肉眼扫一眼看不出来。
   *
   * 后 4 项（时间线/成长/回收站/设置）在这一屏里**没有对应内容**，
   * 它们只是外壳的一部分（复刻刻意不可交互，见文件头）。
   */
  const viewTabs = useMemo<{ label: string; Icon: typeof Inbox; view?: MockView }[]>(
    () => [
      { view: 'tasks', label: t('web.shell.nav.tasks'), Icon: Inbox },
      { view: 'quadrant', label: t('web.shell.nav.quadrant'), Icon: CircleDot },
      { view: 'habits', label: t('web.shell.views.habits'), Icon: Check },
      { view: 'focus', label: t('web.shell.views.focus'), Icon: Sun },
      { label: t('web.shell.views.timeline'), Icon: ChartGantt },
      { label: t('web.shell.views.growth'), Icon: TrendingUp },
      { label: t('web.trash.nav'), Icon: Trash2 },
      { label: t('web.shell.views.settings'), Icon: Settings },
    ],
    [t],
  );

  /**
   * 顶部标题。
   *
   * 🔴 与 `VIEW_TABS` 同理：用**应用自己的词条 key**，不另写一份 `landing.*`。
   * 原来这里四个标题走的是 `landing.mock.inbox` / `landing.feature.*`，
   * 而它们的值与 `web.shell.*` 逐字相同 —— 同一句话写两遍就是下一个漂移源。
   */
  const titles = useMemo<Record<MockView, string>>(
    () => ({
      tasks: t('web.shell.nav.inbox'),
      quadrant: t('web.shell.nav.quadrant'),
      habits: t('web.shell.views.habits'),
      focus: t('web.shell.views.focus'),
    }),
    [t],
  );

  /**
   * 今日进度卡（复现 `features/motivation/TodayProgressCard.tsx` 的 `.ht-today`）。
   *
   * 🔴 真应用在**任务 / 四象限 / 习惯 / 番茄钟**四个视图上都常驻这张卡
   * （`App.tsx` 的 `view !== 'settings' && … && <TodayProgressCard />`），
   * 而复刻原来四屏**一张都没有**。
   *
   * 数值是**示例数据**，与下面那些示例任务标题同一性质 —— 界面元素是真的，
   * 填进去的数字是编的。这与之前被删掉的"象限计数"不一样：**那张卡上确实有数字位**，
   * 而 `QUADRANT_NAV` 上根本没有计数位。区别是"往真有的位置填样例" vs "造一个不存在的位置"。
   */
  const today = useMemo(() => ({ done: 2, total: 5, remaining: 3 }), []);

  return (
    <div ref={frameRef} className={`mk-frame${className !== undefined ? ` ${className}` : ''}`}>
      <div className="mk-stage" style={{ '--mk-scale': String(scale) } as React.CSSProperties}>
        <div className="mk-app">
          <nav className="mk-sidebar">
            <div className="mk-brand">
              <span className="mk-brand__dot" />
              {t('common.brand')}
            </div>

            <div className="mk-nav">
              <NavItem icon={<Inbox size={16} />} label={t('web.shell.nav.inbox')} active={view === 'tasks'} />
              <NavItem icon={<Sun size={16} />} label={t('web.shell.nav.today')} />
              {/* 🔴 「已完成」原来**漏了**。真应用的 PRIMARY_NAV 是三项
                  （收集箱 / 今天 / 已完成）—— 少画一个入口是"不完整"，
                  而下面那几个编出来的计数是"不诚实"，后者更要先修。 */}
              <NavItem icon={<Check size={16} />} label={t('web.shell.nav.completed')} />
            </div>

            <div className="mk-nav__section">{t('web.shell.nav.quadrant')}</div>
            <div className="mk-nav">
              {/*
                🔴 这里原来给四个象限各画了一个计数（3 / 5 / 2 / 1）。
                真应用的 `QUADRANT_NAV` **根本没有 count 字段** —— 那四个数字
                是凭空编的，访客会以为界面上有它们。
                **手抄的复刻可以编造产品没做的 UI，截图不可能** ——
                这是复刻这条路线唯一真正的风险。
              */}
              <NavItem swatch="mk-swatch--q1" label={t('web.shell.nav.q1')} />
              <NavItem swatch="mk-swatch--q2" label={t('web.shell.nav.q2')} />
              <NavItem swatch="mk-swatch--q3" label={t('web.shell.nav.q3')} />
              <NavItem swatch="mk-swatch--q4" label={t('web.shell.nav.q4')} />
            </div>

            {/*
              清单与标签。真应用里这两块都是 `ProjectsPanel`（aria-label「清单与标签」），
              每块 = 标题 + **输入框形态的「新…」+ `+`**。
              复刻原来把清单画成三行静态名字（工作 / 个人 / 读书），**标签整块没有**。
            */}
            <div className="mk-projects">
              <div className="mk-nav__section">{t('web.projects.heading')}</div>
              <div className="mk-field">
                <span className="mk-field__box">{t('web.projects.newPlaceholder')}</span>
                <span className="mk-field__add">
                  <Plus size={14} />
                </span>
              </div>
            </div>

            <div className="mk-projects">
              <div className="mk-nav__section">{t('web.tags.heading')}</div>
              <div className="mk-field">
                <span className="mk-field__box">{t('web.tags.newPlaceholder')}</span>
                <span className="mk-field__add">
                  <Plus size={14} />
                </span>
              </div>
            </div>
          </nav>

          <main className="mk-main">
            <header className="mk-header">
              <h1 className="mk-header__title">{titles[view]}</h1>

              <div className="mk-viewtabs">
                {viewTabs.map((tab) => (
                  <div
                    key={tab.label}
                    className={`mk-viewtab${
                      tab.view === view ? ' mk-viewtab--active' : ''
                    }`}
                  >
                    <tab.Icon size={14} />
                    {tab.label}
                  </div>
                ))}
              </div>

              <div className="mk-header__actions">
                <div className="mk-viewtabs">
                  <div className="mk-viewtab mk-viewtab--active">
                    <CalendarDays size={14} />
                    {t('web.shell.dueMode.date')}
                  </div>
                  <div className="mk-viewtab">
                    <Timer size={14} />
                    {t('web.shell.dueMode.countdown')}
                  </div>
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
              <section className="mk-today" aria-label={t('web.progress.aria')}>
                <div className="mk-today__label">{t('web.progress.today')}</div>
                <div className="mk-today__count">
                  <span>{today.done}</span>
                  <span className="mk-today__count-total">/ {today.total}</span>
                </div>
                <div className="mk-today__hint">
                  {t('web.progress.hint.remaining', { count: today.remaining })}
                </div>
                <div className="mk-today__bar">
                  <span
                    className="mk-today__bar-fill"
                    style={{ transform: `scaleX(${String(today.done / today.total)})` }}
                  />
                </div>
              </section>

              <div className="mk-compose">
                <div className="mk-input">{t('web.capture.placeholder')}</div>
                <div className="mk-btn-primary">
                  <Plus size={16} />
                  {t('web.capture.add')}
                </div>
              </div>

              {view === 'tasks' && <TaskList />}
              {view === 'quadrant' && <QuadrantGrid />}
              {view === 'habits' && <HabitHeatmap />}
              {view === 'focus' && <FocusRing />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
