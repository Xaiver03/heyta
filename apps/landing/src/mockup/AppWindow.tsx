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
  Check,
  CircleDot,
  Inbox,
  Moon,
  Plus,
  Sun,
  Timer,
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
  const { t } = useI18n();

  // 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
  const viewTabs = useMemo<{ key: MockView; label: string; Icon: typeof Inbox }[]>(
    () => [
      { key: 'tasks', label: t('landing.feature.tasks'), Icon: Inbox },
      { key: 'quadrant', label: t('landing.feature.quadrant'), Icon: CircleDot },
      { key: 'habits', label: t('landing.feature.habits'), Icon: Check },
      { key: 'focus', label: t('landing.feature.focus'), Icon: Sun },
    ],
    [t],
  );

  const titles = useMemo<Record<MockView, string>>(
    () => ({
      tasks: t('landing.mock.inbox'),
      quadrant: t('landing.feature.quadrant'),
      habits: t('landing.feature.habits'),
      focus: t('landing.feature.focus'),
    }),
    [t],
  );

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
              <NavItem icon={<Inbox size={16} />} label={t('landing.mock.inbox')} active={view === 'tasks'} />
              <NavItem icon={<Sun size={16} />} label={t('landing.mock.today')} />
            </div>

            <div className="mk-nav__section">{t('landing.feature.quadrant')}</div>
            <div className="mk-nav">
              <NavItem swatch="mk-swatch--q1" label={t('landing.quadrant.q1')} count={3} />
              <NavItem swatch="mk-swatch--q2" label={t('landing.quadrant.q2')} count={5} />
              <NavItem swatch="mk-swatch--q3" label={t('landing.quadrant.q3')} count={2} />
              <NavItem swatch="mk-swatch--q4" label={t('landing.quadrant.q4')} count={1} />
            </div>

            <div className="mk-projects">
              <div className="mk-nav__section">{t('landing.mock.projectsSection')}</div>
              <div className="mk-project">{t('landing.mock.project.work')}</div>
              <div className="mk-project">{t('landing.mock.project.personal')}</div>
              <div className="mk-project">{t('landing.mock.project.reading')}</div>
            </div>
          </nav>

          <main className="mk-main">
            <header className="mk-header">
              <h1 className="mk-header__title">{titles[view]}</h1>

              <div className="mk-viewtabs">
                {viewTabs.map((tab) => (
                  <div
                    key={tab.key}
                    className={`mk-viewtab${
                      tab.key === view ? ' mk-viewtab--active' : ''
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
                    {t('landing.mock.date')}
                  </div>
                  <div className="mk-viewtab">
                    <Timer size={14} />
                    {t('landing.mock.countdown')}
                  </div>
                </div>
                <div className="mk-sync mk-sync--ok">
                  <Zap size={12} />
                  {t('landing.mock.synced')}
                </div>
                <div className="mk-iconbtn">
                  <Moon size={18} />
                </div>
              </div>
            </header>

            <div className="mk-content">
              {view === 'tasks' && (
                <>
                  <div className="mk-compose">
                    <div className="mk-input">
                      {t('landing.mock.composeHint')}
                    </div>
                    <div className="mk-btn-primary">
                      <Plus size={16} />
                      {t('landing.mock.add')}
                    </div>
                  </div>
                  <TaskList />
                </>
              )}
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
