/**
 * 真实界面复现：移动端外壳（手机）
 * ===================================
 *
 * 复现对象：`apps/mobile/src/App.tsx` 的「任务」屏 + `apps/mobile/src/nav/TabBar.tsx`。
 * 与 `AppWindow.tsx`（桌面外壳）同一套做法的姊妹件：
 *
 *   - **结构照抄真实页面**：顶部标题条 → 作用域胶囊（今天 / 计划 / 全部 / 旗标）
 *     → 按紧急度分组的任务列表（已过期 / 今天 / 收集箱）→ 底部五个 tab；
 *   - **文案全部取真实词条**（`mobile.tab.*` / `mobile.tasks.*` / `mobile.common.today`），
 *     不写死一句中文 —— 与 `AppWindow` 同一条纪律；
 *   - **样例数据取 `showcase-data` 的同一份 `SHOWCASE_TASKS`**，与桌面的计数同源；
 *   - **取值全部走 `--ht-*` token**，换主题时与真机一起变。
 *
 * ⚠️ 这是**复现**，不是移动端应用本身：落地页不能 import RN 组件（那是另一个 runtime）。
 * 结构与取值的权威仍是 `apps/mobile/`，这里只负责在浏览器里把它画成可信的一屏。
 *
 * 🔴 默认不可交互（`pointer-events: none`）：它是展示品，不让人以为能在落地页上勾任务。
 */

import { ICON_SIZE } from '@heyta/design-system';
import {
  CalendarDays,
  CircleDot,
  Flag,
  ListTodo,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Timer,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useI18n, type MessageKey } from '@heyta/i18n/provider';

import './mobile-mockup.css';

import { SHELL_QUADRANT_NAV } from './app-shell-shape.js';
import { SHOWCASE_TASKS, showcaseQuadrantCounts, type ShowcaseTask } from './showcase-data.js';

export type MobileMockView = 'tasks' | 'quadrant';

/** 底部五个 tab。顺序与文案来自 `apps/mobile/src/nav/TabBar.tsx` 的 `TABS`。 */
const MOBILE_TABS: readonly {
  readonly key: string;
  readonly labelKey: MessageKey;
  readonly Icon: LucideIcon;
}[] = [
  { key: 'tasks', labelKey: 'mobile.tab.tasks', Icon: ListTodo },
  { key: 'calendar', labelKey: 'mobile.tab.calendar', Icon: CalendarDays },
  { key: 'focus', labelKey: 'mobile.tab.focus', Icon: Timer },
  { key: 'ai', labelKey: 'mobile.tab.ai', Icon: Sparkles },
  { key: 'profile', labelKey: 'mobile.tab.profile', Icon: UserRound },
];

type SectionMeta = { readonly titleKey: MessageKey; readonly icon: LucideIcon; readonly tone?: 'danger' | 'primary' };

export function MobileAppWindow({ view = 'tasks' }: { readonly view?: MobileMockView }): React.JSX.Element {
  const { t } = useI18n();
  const counts = showcaseQuadrantCounts(SHOWCASE_TASKS);

  const overdue = SHOWCASE_TASKS.filter((task) => task.done !== true && task.dueTone === 'overdue');
  const dueToday = SHOWCASE_TASKS.filter((task) => task.done !== true && task.dueTone === 'today');
  const inbox = SHOWCASE_TASKS.filter(
    (task) =>
      task.done !== true && task.dueTone !== 'overdue' && task.dueTone !== 'today',
  );

  const allSections: readonly {
    readonly key: string;
    readonly meta: SectionMeta;
    readonly tasks: readonly ShowcaseTask[];
  }[] = [
    { key: 'overdue', meta: { titleKey: 'mobile.tasks.group.overdue', icon: Flag, tone: 'danger' }, tasks: overdue },
    { key: 'today', meta: { titleKey: 'mobile.common.today', icon: CircleDot, tone: 'primary' }, tasks: dueToday },
    { key: 'inbox', meta: { titleKey: 'mobile.tasks.group.inbox', icon: ListTodo }, tasks: inbox },
  ];
  const sections = allSections.filter((section) => section.tasks.length > 0);

  return (
    <div className="mk-phone" data-view={view}>
      <div className="mk-phone__status" aria-hidden="true">
        <span className="mk-phone__clock">9:41</span>
        <span className="mk-phone__status-right">
          <i />
          <i />
          <span className="mk-phone__battery" />
        </span>
      </div>

      <header className="mk-phone__bar">
        <span className="mk-phone__title">{t('mobile.tasks.title')}</span>
        <span className="mk-phone__bar-actions" aria-hidden="true">
          <Search size={ICON_SIZE.sm} />
          <MoreHorizontal size={ICON_SIZE.sm} />
        </span>
      </header>

      <div className="mk-phone__scopes" aria-hidden="true">
        <span className="mk-pchip" data-active="true">
          {t('mobile.common.today')}
        </span>
        <span className="mk-pchip">{t('mobile.tasks.scope.scheduled')}</span>
        <span className="mk-pchip">{t('mobile.tasks.scope.all')}</span>
      </div>

      <div className="mk-phone__scroll">
        {view === 'tasks' ? (
          sections.map((section) => {
            const SectionIcon = section.meta.icon;
            return (
              <section key={section.key} className="mk-pgroup">
                <div className="mk-pgroup__head" data-tone={section.meta.tone}>
                  <SectionIcon size={ICON_SIZE.xs} aria-hidden="true" />
                  <span className="mk-pgroup__title">{t(section.meta.titleKey)}</span>
                  <span className="mk-pgroup__count">{section.tasks.length}</span>
                </div>
                {section.tasks.map((task) => (
                  <div key={task.id} className="mk-prow" data-done={task.done === true ? 'true' : undefined}>
                    <span className="mk-prow__check" aria-hidden="true" />
                    <span className="mk-prow__title">{t(task.titleKey)}</span>
                    {task.dueKey === undefined ? null : (
                      <span className="mk-prow__due" data-tone={task.dueTone ?? 'later'}>
                        {t(task.dueKey)}
                      </span>
                    )}
                  </div>
                ))}
              </section>
            );
          })
        ) : (
          <div className="mk-pquad">
            {SHELL_QUADRANT_NAV.map((quadrant) => (
              <div key={quadrant.quadrant} className="mk-pquad__cell" data-q={quadrant.quadrant}>
                <span className="mk-pquad__label">{t(quadrant.labelKey)}</span>
                <span className="mk-pquad__count">{counts[quadrant.quadrant]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <span className="mk-phone__fab" aria-hidden="true">
        <Plus size={ICON_SIZE.md} />
      </span>

      <nav className="mk-ptabs" aria-hidden="true">
        {MOBILE_TABS.map((tab) => (
          <span key={tab.key} className="mk-ptab" data-active={tab.key === 'tasks' ? 'true' : undefined}>
            <tab.Icon size={ICON_SIZE.sm} />
            <span>{t(tab.labelKey)}</span>
          </span>
        ))}
      </nav>
    </div>
  );
}
