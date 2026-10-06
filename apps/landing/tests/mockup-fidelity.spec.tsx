/**
 * 界面复刻的保真度（回归钉）
 * ============================
 *
 * 这一条钉的是 **mockup 与真应用是不是同一个东西**，而不是"页面能不能渲染"。
 * 背景与实测数据见 `docs/research/showcase-fidelity-audit.md`。
 *
 * ## 为什么需要它
 *
 * 展厅里的三块界面是**手抄的真应用复刻**（`mockup/AppWindow.tsx` 复现
 * `apps/web/src/App.tsx` 的 `.ht-app` 网格）。手抄就会漂移，而当时
 * **五项同时漂了、没有一条门禁看得见**：
 *
 * | 漂移 | 形状 |
 * |---|---|
 * | 漏「已完成」 | 真应用 `PRIMARY_NAV` 三项，复刻两项 |
 * | 编造象限计数 | 真应用的计数由 `bucketByQuadrant()` 算出，复刻画了写死的 3/5/2/1 |
 * | 漏「标签」整块 | 真应用 `ProjectsPanel` 有「标签」区，复刻没有 |
 * | 清单形态不同 | 真应用是「新清单」输入框 + `+`，复刻是三行静态名字 |
 * | 只画 4 个视图 tab | 真应用 `VIEW_TABS` 是 **8 个** |
 *
 * 已有三道相关门禁都管不到：`check:design` 管的是**取值来源**（不许硬编码颜色/间距）、
 * `check:ui-language` 管的是**有没有硬编码文案**、`check:widgets` 管小组件契约。
 * 没有一个在问"复刻画的是不是产品真有的 UI"。
 *
 * ## 判据为什么这样写
 *
 * 标签**不写成字符串字面量**，而是从 `@heyta/i18n` 的 `zhCN` 里按键取 ——
 * 那正是真应用渲染时用的同一份词条。于是：
 *   - 改词的人不可能只改一边（两边本来就是同一份）；
 *   - 这里不会出现"测试里抄了一份文案、产品改了词、测试还绿着"。
 * 真正被钉住的是**结构**：8 项、有「已完成」、有「标签」、计数从样例任务派生。
 * （更权威的对账在 `tests/mockup-shell-shape.spec.tsx` —— 它直接读 web 源码。）
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { I18nProvider, zhCN } from '@heyta/i18n';

import { AppWindow } from '../src/mockup/AppWindow.js';
import {
  SHELL_HEADER_ACTIONS,
  SHELL_PRIMARY_NAV,
  SHELL_QUADRANT_NAV,
  SHELL_VIEW_TABS,
} from '../src/mockup/app-shell-shape.js';
import { showcaseQuadrantCounts, SHOWCASE_TODAY_PROGRESS } from '../src/mockup/showcase-data.js';
import { MOCK_TIMELINE_ROWS } from '../src/mockup/timeline-shape.js';

/**
 * 🔴 **这里曾经各抄了一份 `VIEW_TABS` / `PRIMARY_NAV`**（产品决策 P6）。
 *
 * 那正是 showcase 那几处漂移的**产生机制**：两处定义、只有一处生效，
 * 于是真漂移只能靠运气被发现 —— 实测就是这样漏掉了「已完成」与「视图 tab 4 vs 8」。
 *
 * 现在两份都在 `app-shell-shape.ts`（外壳结构的**唯一登记处**，纯数据、
 * 不 import React），这里**只做推导**。而"登记处与真应用是否一致"由
 * `mockup-shell-shape.spec.tsx` 对账 `apps/web/src/App.tsx` 的**源码文本**来钉。
 *
 * ⚠️ 所以：**本文件不再是权威**。它测的是"渲染出来的东西 = 登记处"，
 * 不测"登记处 = 真应用" —— 后者是那份新 spec 的职责，别在这里再抄一份。
 */
const APP_VIEW_TABS = SHELL_VIEW_TABS.map((tab) => tab.labelKey);
const APP_PRIMARY_NAV = SHELL_PRIMARY_NAV.map((item) => item.labelKey);

/**
 * jsdom 不实现 `ResizeObserver`，而 `AppWindow` 用它算缩放比。
 * 这是**测试环境的缺口**，不是产品缺陷 —— 补一个空实现让 effect 跑完。
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  if (root !== null) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
});

function renderMockup(
  view: 'tasks' | 'quadrant' | 'habits' | 'focus' | 'timeline' = 'quadrant',
): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <AppWindow view={view} />
      </I18nProvider>,
    );
  });
  return container;
}

/**
 * 真应用 `App.tsx` 里**四个"做事"的视图都常驻**的两件东西：
 * `TodayProgressCard` 与 `CaptureComposer`。
 * 复刻原来只在"任务"那一屏画了输入框、四屏一张进度卡都没有。
 */
const VIEWS_WITH_TODAY_AND_COMPOSER = ['tasks', 'quadrant', 'habits', 'focus'] as const;

describe('展厅复刻与应用一致', () => {
  it('四个视图都常驻「今天进度卡 + 捕获输入框」', () => {
    for (const v of VIEWS_WITH_TODAY_AND_COMPOSER) {
      const view = renderMockup(v);
      const today = view.querySelector('.mk-today');
      expect(today, `${v} 缺今天进度卡`).not.toBeNull();
      // 🔴 M3 第十一刀之后卡片来自共享 `TodayProgressCard`：它**没有**"今天"标签
      // （迁移前 web 的 `.ht-today__label` 有），比例是 `done/total` 一整段。
      // 结构/token 的权威对账在 `mockup-today-shape.spec.tsx`。
      expect(today?.querySelector('.mk-today__count')?.textContent?.trim()).toMatch(
        /^\d+\/\d+$/u,
      );
      expect(today?.textContent ?? '').toContain(
        zhCN['web.progress.hint.remaining'].replace(
          '{count}',
          String(SHOWCASE_TODAY_PROGRESS.remaining),
        ),
      );
      expect(view.querySelector('.mk-compose'), `${v} 缺捕获输入框`).not.toBeNull();
      // 输入框里的提示语必须是应用自己的那条
      expect(view.querySelector('.mk-input')?.textContent?.trim()).toBe(
        zhCN['web.capture.placeholder'],
      );
      // 每渲染一个视图就卸载一次，避免容器累积
      act(() => {
        root?.unmount();
      });
      root = null;
      container?.remove();
      container = null;
    }
  });

  it('四象限底部有 footnote —— 它解释「紧急度由截止时间推导」这条核心不变量', () => {
    const view = renderMockup('quadrant');
    const note = view.querySelector('.mk-quadrant__footnote');
    expect(note).not.toBeNull();
    expect(note?.textContent?.trim()).toBe(zhCN['web.quadrant.footnote']);
  });

  it('页头右侧画的就是登记处那几件，且搬走的四件一张都不许出现', () => {
    const view = renderMockup('tasks');
    const actions = view.querySelector('.mk-header__actions');
    expect(actions, '页头动作区没画出来 ⇒ 这一条没有基准').not.toBeNull();

    // 数量从登记处推导，不写死 —— 写死的数字就是下一次搬控件时的第三个漂移点。
    // "登记本身对不对"由 `mockup-shell-shape.spec.tsx` #7 与 `App.tsx` 逐字对账负责。
    // ⚠️ 任务视图：产品那边 `task-sort` 的条件是 `contentView === 'tasks' && visible.length > 0`，
    // 所以这一屏应当是**全两件**；换一屏就不是这个数（那条条件判据在 #7 的另一条里）。
    const shownOnTasks = SHELL_HEADER_ACTIONS.filter(
      (a) => a.onlyForView === undefined || a.onlyForView === 'tasks',
    );
    expect(actions?.children.length, `页头画多了：${actions?.innerHTML ?? ''}`).toBe(
      shownOnTasks.length,
    );
    const text = actions?.textContent ?? '';
    const labels = [...(actions?.querySelectorAll('[aria-label]') ?? [])].map((el) =>
      el.getAttribute('aria-label'),
    );
    for (const action of shownOnTasks) {
      expect(
        text.includes(zhCN[action.labelKey]) || labels.includes(zhCN[action.labelKey]),
        `页头少了 ${action.id}（${zhCN[action.labelKey]}）`,
      ).toBe(true);
    }

    // 🔴 反向：这四件早已搬走，只验"登记处都在"挡不住"把旧的加回来"。
    // 「立即同步」的可访问名在整个仓库此刻只剩这张复刻在用 —— 它在这里消失，
    // 才算真的搬完了（工单 H9 第 1 刀的收尾）。
    for (const gone of [
      zhCN['web.sync.a11y.syncNow'],
      zhCN['web.sync.settings.title'],
      zhCN['web.sync.status.synced'],
      zhCN['common.lang.en'],
    ]) {
      expect(text, `页头里还能读到「${gone}」—— 搬走没生效`).not.toContain(gone);
      expect(labels, `页头里还有「${gone}」这枚控件`).not.toContain(gone);
    }
  });

  it('视图切换条与登记处同项同序，且整个窗口里没有多画一组 tab', () => {
    const view = renderMockup();
    const tabs = [...view.querySelectorAll('.mk-viewtab')].map((el) => el.textContent?.trim() ?? '');

    // 视图那一组在**真应用**里是 rail（不是页头 tab 条）；项数与顺序由
    // `mockup-shell-shape.spec.tsx` #5 与 `view-tabs.ts` + `modules.ts` 的默认开关逐字对账。
    const bar = view.querySelector('.mk-header__viewtabs, .mk-viewtabs');
    expect(bar).not.toBeNull();
    const viewTabBar = view.querySelectorAll('.mk-header .mk-viewtabs')[0];
    expect(viewTabBar).toBeDefined();
    const labels = [...(viewTabBar?.querySelectorAll('.mk-viewtab') ?? [])].map(
      (el) => el.textContent?.trim() ?? '',
    );

    expect(labels).toHaveLength(APP_VIEW_TABS.length);
    expect(labels).toEqual(APP_VIEW_TABS.map((key) => zhCN[key]));
    // 🔴 原来这里写的是「视图 N + 2」—— 那两枚是页头上的「日期 / 倒计时」，
    // 它们 2026-09-30 就搬进 设置 → 显示 了。现在整窗口里只剩视图那一组：
    // 数量仍从登记处推导，写死的 +2 会把下一次"再搬一枚"读成"复刻少画了"。
    expect(tabs).toHaveLength(APP_VIEW_TABS.length);
  });

  it('侧栏主导航把登记的每一项都画出来了，含「已完成」', () => {
    const view = renderMockup();
    const items = [...view.querySelectorAll('.mk-sidebar .mk-nav__item')].map(
      (el) => el.textContent?.trim() ?? '',
    );
    for (const key of APP_PRIMARY_NAV) {
      expect(items.some((t) => t.startsWith(zhCN[key]))).toBe(true);
    }
  });

  it('四象限显示计数，且计数是**从样例任务算出来的**（不是手写的那四个数）', () => {
    const view = renderMockup();
    // 🔴 这里曾经断言「一个计数都不显示」，理由是"真应用 QUADRANT_NAV 没有 count 字段"。
    //    那是一条**钉住错误事实**的判据：字段确实不在 `QUADRANT_NAV` 上，但计数是
    //    `selectQuadrantCounts()`（→ `bucketByQuadrant()`）在渲染时算出来、单独传进
    //    `NavButton` 的；`NavButton` 只在 `count > 0` 时渲染，所以**空账号的截图里
    //    一个数字都没有** —— 审计当时把"位在、值为 0"读成了"产品没有这个位"。
    //    正确的修法不是删掉计数位，而是让它**从同一份样例任务派生**。
    //    判据的权威版本在 `tests/mockup-shell-shape.spec.tsx`（用领域层重算）。
    const counts = showcaseQuadrantCounts();
    const rendered = [...view.querySelectorAll('.mk-sidebar .mk-nav__count')].map(
      (el) => el.textContent?.trim() ?? '',
    );
    const expected = SHELL_QUADRANT_NAV.map((q) => counts[q.quadrant]).filter((n) => n > 0);
    expect(rendered).toEqual(expected.map(String));
    // 编造的那四个数不许作为一组回来。
    expect(rendered.join(',')).not.toBe('3,5,2,1');
  });

  it('清单与标签两区都在，且都是「输入框 + 加号」的形态', () => {
    const view = renderMockup();
    const sidebarText = view.querySelector('.mk-sidebar')?.textContent ?? '';
    expect(sidebarText).toContain(zhCN['web.projects.heading']);
    expect(sidebarText).toContain(zhCN['web.tags.heading']);

    const boxes = [...view.querySelectorAll('.mk-field__box')].map((el) => el.textContent?.trim());
    expect(boxes).toEqual([zhCN['web.projects.newPlaceholder'], zhCN['web.tags.newPlaceholder']]);
    expect(view.querySelectorAll('.mk-field__add')).toHaveLength(2);
  });

  it('时间线视图真的画出了条 —— 不是白屏', () => {
    const view = renderMockup('timeline');
    /*
      🔴 这一条钉的是**最后一米**：登记处与 CSS 对得上（`mockup-timeline-shape.spec`），
      不代表 `AppWindow` 真的把它挂上了 —— `{view === 'timeline' && <TimelineBoard />}`
      漏掉时，页面照样渲染成功，只是那一档**什么都没画**（视图标题还在，
      看起来像"这个视图本来就是空的"）。条的数必须等于登记处的行数。
    */
    expect(view.querySelectorAll('.mk-timeline__bar')).toHaveLength(MOCK_TIMELINE_ROWS.length);
    // 每条样例的标题也都在（否则是"有条无题"的另一半白屏）。
    const timelineText = view.querySelector('.mk-timeline')?.textContent ?? '';
    expect(timelineText).toContain(zhCN['landing.mock.task.q4Draft']);
  });
});
