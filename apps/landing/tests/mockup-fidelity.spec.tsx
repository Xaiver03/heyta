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
 * | 编造象限计数 | 真应用 `QUADRANT_NAV` **没有 count 字段**，复刻画了 3/5/2/1 |
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
 * 真正被钉住的是**结构**：8 项、有「已完成」、有「标签」、没有计数。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { I18nProvider, zhCN } from '@heyta/i18n';

import { AppWindow } from '../src/mockup/AppWindow.js';

/** 真应用 `apps/web/src/App.tsx` 的 `VIEW_TABS`，按顺序。 */
const APP_VIEW_TABS = [
  'web.shell.nav.tasks',
  'web.shell.nav.quadrant',
  'web.shell.views.habits',
  'web.shell.views.focus',
  'web.shell.views.timeline',
  'web.shell.views.growth',
  'web.trash.nav',
  'web.shell.views.settings',
] as const;

/** 真应用 `apps/web/src/App.tsx` 的 `PRIMARY_NAV`，按顺序。 */
const APP_PRIMARY_NAV = [
  'web.shell.nav.inbox',
  'web.shell.nav.today',
  'web.shell.nav.completed',
] as const;

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

function renderMockup(view: 'tasks' | 'quadrant' | 'habits' | 'focus' = 'quadrant'): HTMLElement {
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
      expect(today?.textContent ?? '').toContain(zhCN['web.progress.today']);
      expect(today?.textContent ?? '').toContain(zhCN['web.progress.hint.remaining'].replace('{count}', '3'));
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

  it('顶栏右侧是完整的四件：同步状态 + 立即同步 + 设置 + 语言 + 主题', () => {
    const view = renderMockup();
    const actions = view.querySelector('.mk-header__actions');
    expect(actions).not.toBeNull();
    const text = actions?.textContent ?? '';
    expect(text).toContain(zhCN['web.sync.status.synced']);
    // 语言按钮上是**另一种语言自己的名字**
    expect(text).toContain(zhCN['common.lang.en']);
    const labels = [...(actions?.querySelectorAll('[aria-label]') ?? [])].map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(labels).toContain(zhCN['web.sync.a11y.syncNow']);
    expect(labels).toContain(zhCN['web.sync.settings.title']);
  });

  it('视图切换条是 8 项，且标签逐字等于应用自己的词条', () => {
    const view = renderMockup();
    const tabs = [...view.querySelectorAll('.mk-viewtab')].map((el) => el.textContent?.trim() ?? '');

    // 真应用的顶栏是 8 个视图 tab（不含右侧的「日期 / 倒计时」，那是另一组）
    const bar = view.querySelector('.mk-header__viewtabs, .mk-viewtabs');
    expect(bar).not.toBeNull();
    const viewTabBar = view.querySelectorAll('.mk-header .mk-viewtabs')[0];
    expect(viewTabBar).toBeDefined();
    const labels = [...(viewTabBar?.querySelectorAll('.mk-viewtab') ?? [])].map(
      (el) => el.textContent?.trim() ?? '',
    );

    expect(labels).toHaveLength(APP_VIEW_TABS.length);
    expect(labels).toEqual(APP_VIEW_TABS.map((key) => zhCN[key]));
    // 顺带确认没有多画：整个窗口里的 tab 总数 = 视图 8 + 日期/倒计时 2
    expect(tabs).toHaveLength(APP_VIEW_TABS.length + 2);
  });

  it('侧栏主导航是三项，含「已完成」', () => {
    const view = renderMockup();
    const items = [...view.querySelectorAll('.mk-sidebar .mk-nav__item')].map(
      (el) => el.textContent?.trim() ?? '',
    );
    for (const key of APP_PRIMARY_NAV) {
      expect(items.some((t) => t.startsWith(zhCN[key]))).toBe(true);
    }
  });

  it('四象限**不显示计数** —— 真应用的 QUADRANT_NAV 没有 count 字段', () => {
    const view = renderMockup();
    // 复刻曾经在这里画了 3 / 5 / 2 / 1 四个数字，而产品界面上没有它们。
    // 「多出来」比「少」更该先修：少一个入口是不完整，多一个数字是不诚实。
    expect(view.querySelectorAll('.mk-nav__count')).toHaveLength(0);
    const sidebarText = view.querySelector('.mk-sidebar')?.textContent ?? '';
    for (const n of ['3', '5', '2', '1']) {
      expect(sidebarText.includes(n), `侧栏不该出现凭空编的计数 ${n}`).toBe(false);
    }
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
});
