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
import { showcaseQuadrantCounts } from '../src/mockup/showcase-data.js';
import { MOCK_TIMELINE_ROWS } from '../src/mockup/timeline-shape.js';
import { codeOccurrences, readWebAppSource, stripComments } from './helpers/source-text.js';

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
  view: 'tasks' | 'quadrant' | 'habits' | 'focus' | 'timeline' = 'tasks',
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
 * 展厅那五屏**全是**产品的"做事"视图（成长页另说）。
 *
 * 🔴 这张表里刻意**没有**"要不要画今天进度卡"这一列 —— 那个形状漂过一次：
 * 产品 R6 那一刀把常驻卡撤进成长页，而复刻与判据都还写着"四屏常驻"，
 * 于是**正向判据把过时的形状钉成了期望**，26 条测试全绿却人人都在撒谎。
 * 卡片的有无改由下面那条判据**从 `App.tsx` 源码派生**。
 */
const DOING_VIEWS = ['tasks', 'quadrant', 'habits', 'focus'] as const;

describe('展厅复刻与应用一致', () => {
  it('复刻外壳与 Web 一样按视图分层：rail → 范围侧栏 → 主区 → 任务详情栏', () => {
    const tasks = renderMockup('tasks');
    expect(tasks.querySelector('.mk-rail')).not.toBeNull();
    expect(tasks.querySelector('.mk-sidebar')).not.toBeNull();
    expect(tasks.querySelector('.mk-main')).not.toBeNull();
    expect(tasks.querySelector('.mk-detail')).not.toBeNull();
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;

    const quadrant = renderMockup('quadrant');
    expect(quadrant.querySelector('.mk-rail')).not.toBeNull();
    expect(quadrant.querySelector('.mk-sidebar')).toBeNull();
    expect(quadrant.querySelector('.mk-detail')).toBeNull();
  });

  it('捕获输入框四屏常驻；今天进度卡的有无从产品源码派生，不是写死的期望', () => {
    const app = readWebAppSource();
    // 阳性对照：`App.tsx` 里"共享的 TodayProgressCard 没有删"是一段**历史注释**，
    // 字面含那个名字却不是一次引用。不剥注释就会数出 ≥1 ⇒ 这条判据会在**正确**的产品上红。
    expect(app).toContain('TodayProgressCard');
    // 🔴 而"剥注释真的在起作用"本身也要有对照：摘掉那两行 replace 的话，上面那句
    // `toContain` 与下面的计数会同时成立，判据静默退化成"产品画了卡"——方向反了都看不出来。
    expect(stripComments('/* TodayProgressCard */')).not.toContain('TodayProgressCard');
    const productDraws = codeOccurrences(app, 'TodayProgressCard') > 0;

    for (const v of DOING_VIEWS) {
      const view = renderMockup(v);
      const drawn = view.querySelector('.mk-today') !== null;
      expect(
        drawn,
        `${v}：产品${productDraws ? '在' : '不在'}做事视图画今天卡，展厅没跟上一个字节`,
      ).toBe(productDraws);
      const shouldDrawCapture = v === 'tasks';
      expect(view.querySelector('.mk-compose') !== null, `${v} 捕获输入框条件不一致`).toBe(shouldDrawCapture);
      if (shouldDrawCapture) {
        expect(view.querySelector('.mk-input')?.textContent?.trim()).toBe(
          zhCN['web.capture.placeholder'],
        );
      }
      // 每渲染一个视图就卸载一次，避免容器累积
      act(() => {
        root?.unmount();
      });
      root = null;
      container?.remove();
      container = null;
    }
  });

  it('四象限不再重复渲染规则说明 —— 真实应用已将它移入帮助折叠', () => {
    const view = renderMockup('quadrant');
    const note = view.querySelector('.mk-quadrant__footnote');
    expect(note).toBeNull();
  });

  it('页头右侧画的就是登记处那几件，且搬走的四件一张都不许出现', () => {
    const view = renderMockup('tasks');
    const actions = view.querySelector('.mk-header__actions');
    expect(actions, '页头动作区没画出来 ⇒ 这一条没有基准').not.toBeNull();

    // 数量从登记处推导，不写死 —— 写死的数字就是下一次搬控件时的第三个漂移点。
    // "登记本身对不对"由 `mockup-shell-shape.spec.tsx` #7 与 `App.tsx` 逐字对账负责。
    // ⚠️ `assistant-open` 是产品收起详情列时的回退入口；Landing 默认把详情列展示出来，
    // 所以这枚真实存在的条件控件登记在 shape 中，但静态复刻不再伪造一个 AI 按钮。
    const shownOnTasks = SHELL_HEADER_ACTIONS.filter(
      (a) => a.mockedInLanding !== false && (a.onlyForView === undefined || a.onlyForView === 'tasks'),
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
    const tabs = [...view.querySelectorAll('.mk-rail__tab[data-view-key]')].map((el) => el.textContent?.trim() ?? '');

    // 视图那一组在**真应用**里是 rail（不是页头 tab 条）；项数与顺序由
    // `mockup-shell-shape.spec.tsx` #5 与 `view-tabs.ts` + `modules.ts` 的默认开关逐字对账。
    const labels = tabs;
    expect(labels).toEqual([
      zhCN['web.shell.nav.tasks'],
      zhCN['web.calendar.title'],
      zhCN['web.shell.views.habits'],
      zhCN['web.search.title'],
      zhCN['web.trash.nav'],
    ]);
    // 🔴 原来这里写的是「视图 N + 2」—— 那两枚是页头上的「日期 / 倒计时」，
    // 它们 2026-09-30 就搬进 设置 → 显示 了。现在整窗口里只剩视图那一组：
    // 数量仍从登记处推导，写死的 +2 会把下一次"再搬一枚"读成"复刻少画了"。
    expect(tabs).toHaveLength(5);
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

  it('清单与标签两区都在，且是「静态行列表 + 标题级加号」的形态', () => {
    const view = renderMockup();
    const sidebarText = view.querySelector('.mk-sidebar')?.textContent ?? '';
    expect(sidebarText).toContain(zhCN['web.projects.heading']);
    expect(sidebarText).toContain(zhCN['web.tags.heading']);

    const rows = [...view.querySelectorAll('.mk-projects__row')].map((el) => el.textContent?.trim());
    expect(rows).toEqual([
      zhCN['landing.mock.project.work'],
      zhCN['landing.mock.project.personal'],
      zhCN['landing.mock.project.reading'],
      zhCN['landing.mock.tag.deepWork'],
      zhCN['landing.mock.tag.waiting'],
    ]);
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
