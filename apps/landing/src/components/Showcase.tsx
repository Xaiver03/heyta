/**
 * 真实界面展厅
 * ==============
 *
 * 展厅是一个产品预览，不是第二个应用。它只挂载一个活动窗口，
 * 让访客直接使用窗口里的导航，在五种真实视图中的呈现之间移动：
 * 任务、四象限、习惯、专注和时间线。
 *
 * 旧版用 300vh sticky + 3D coverflow 同时挂载五个窗口。那套动效把滚动距离
 * 变成了导航成本，还让访客误以为五个窗口是五个独立产品。这里改为直接探索：
 * 键盘、触屏和减少动效偏好下都走同一条路径；窗口内容仍来自 mockup，
 * 导航与任务勾选都只作用于演示数据，不会写入真实账户。
 */

import { useMemo, useState } from 'react';

import { useI18n } from '@heyta/i18n/provider';

import { AppWindow, type MockView } from '../mockup/AppWindow.js';
import './showcase-interactive.css';

interface Screen {
  view: MockView;
  label: string;
  title: string;
  body: string;
}

export function Showcase(): React.JSX.Element {
  const { t } = useI18n();
  const [active, setActive] = useState<MockView>('tasks');

  const screens = useMemo<readonly [Screen, ...Screen[]]>(
    () => [
      {
        view: 'tasks',
        label: t('landing.feature.tasks'),
        title: t('landing.hero.titleLead') + t('landing.hero.titleEmphasis'),
        body: t('landing.hero.lede'),
      },
      {
        view: 'quadrant',
        label: t('landing.feature.quadrant'),
        title: t('landing.showcase.quadrant.title'),
        body: t('landing.showcase.quadrant.body'),
      },
      {
        view: 'habits',
        label: t('landing.feature.habits'),
        title: t('landing.showcase.habits.title'),
        body: t('landing.showcase.habits.body'),
      },
      {
        view: 'focus',
        label: t('landing.feature.focus'),
        title: t('landing.showcase.focus.title'),
        body: t('landing.showcase.focus.body'),
      },
      {
        view: 'timeline',
        label: t('web.shell.views.timeline'),
        title: t('landing.showcase.timeline.title'),
        body: t('landing.showcase.timeline.body'),
      },
    ],
    [t],
  );

  const current = screens.find((screen) => screen.view === active) ?? screens[0];

  return (
    <section
      className="lp-showcase-interactive"
      id="showcase"
      aria-labelledby="showcase-title"
    >
      <div className="lp-wrap lp-showcase-interactive__inner">
        <div className="lp-showcase-interactive__header">
          <div className="lp-showcase-interactive__copy">
            <p className="lp-showcase-interactive__eyebrow">{t('landing.nav.showcase')}</p>
            <h2 className="lp-h2" id="showcase-title">{t('landing.showcase.title')}</h2>
            <p className="lp-section__lede">{t('landing.showcase.lede')}</p>
          </div>

        </div>

        <div className="lp-showcase-interactive__body">
          <div className="lp-showcase-interactive__stage">
            <div className="lp-showcase-interactive__panel">
              <AppWindow
                view={current.view}
                interactive
                onViewChange={setActive}
              />
            </div>
          </div>

          <div className="lp-showcase-interactive__detail" aria-live="polite">
            <span className="lp-showcase-interactive__status">
              {t('landing.showcase.hint', { label: current.label })}
            </span>
            <h3>{current.title}</h3>
            <p>{current.body}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
