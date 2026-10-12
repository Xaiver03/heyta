/**
 * rail 与通知面板的键盘漫游焦点（§8.2 第 13 条）
 * ============================================
 *
 * 分两层，各挡一种不同的坏法：
 *
 * - **A/B 层（`tab-roving` 本体）**：方向键语义、回绕、Home/End、轴不共用、
 *   dialog 排除、被 `defaultPrevented` 时让位。这层只证"这段逻辑是对的"。
 * - **C 层（真组件渲染出来的 DOM）**：rail 与面板**各自**恰好只有一枚 `tabIndex="0"`。
 *   🔴 这层不能省 —— 只测 A/B 的话，`RailNavigation.tsx` 里**一处 `tabIndex` 都没接**
 *   也照样全绿（那正是 `mockup-shell-shape` 那条"按常量对账 ≠ 按渲染对账"缺口的形状）。
 *
 * 另有两条**行为**判据（不只是属性）：漫游**不激活**视图（`onNavigate` 零调用），
 * 以及"当前视图不在 rail 顺序里"时 0 落回第一枚 —— 后者是"整段导航 Tab 到不了"
 * 那条真缺陷的钉子。
 *
 * ⚠️ `preventDefault` 的判据读的是**原生事件**的 `defaultPrevented`，不是 React 合成对象的
 * 返回值（合成对象的 `defaultPrevented` getter 有可能自己就报 true，那什么也没钉住）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { onTabRovingKeyDown, rovingTabKey, type TabRovingOrientation } from '../src/lib/tab-roving.js';
import { RailNavigation } from '../src/features/shell/RailNavigation.js';
import { TOOL_VIEW_TABS, VIEW_TABS, type ViewKey } from '../src/features/shell/view-tabs.js';
import { InboxBell } from '../src/features/inbox/InboxBell.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function render(node: React.JSX.Element): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<I18nProvider locale="zh-CN">{node}</I18nProvider>);
    await Promise.resolve();
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  document.body.innerHTML = '';
});

/** 真按键：走 DOM 冒泡，让 React 的根监听器分发（不走这条路就测不到 dnd-kit 抢在前面那种事）。 */
function press(element: HTMLElement, key: string): { defaultPrevented: boolean } {
  const native = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  element.focus();
  act(() => {
    element.dispatchEvent(native);
  });
  return { defaultPrevented: native.defaultPrevented };
}

function tabsOf(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('[role="tab"]'));
}

/**
 * 与 rail **同形**的夹具：`<nav>` 里一段 `role="tablist"` + **tablist 外面**一枚工具标签
 *（真实 rail 就是这两段），可选再嵌一个自有一套 tablist 的 dialog（真实通知面板就是它）。
 */
function Fixture({
  orientation = 'vertical',
  withDialog = false,
  consumeKeys = false,
}: {
  orientation?: TabRovingOrientation;
  withDialog?: boolean;
  consumeKeys?: boolean;
}): React.JSX.Element {
  const tab = (label: string) => (
    <button
      type="button"
      role="tab"
      data-label={label}
      tabIndex={-1}
      onKeyDown={consumeKeys ? (event) => event.preventDefault() : undefined}
    >
      {label}
    </button>
  );
  return (
    <nav data-testid="fixture" onKeyDown={(event) => onTabRovingKeyDown(event, orientation)}>
      <div role="tablist">
        {tab('a')}
        {tab('b')}
      </div>
      {tab('c')}
      {withDialog ? (
        <div role="dialog" aria-label="面板">
          <div role="tablist" onKeyDown={(event) => onTabRovingKeyDown(event, 'horizontal')}>
            {tab('d')}
            {tab('e')}
          </div>
        </div>
      ) : null}
    </nav>
  );
}

const byLabel = (label: string): HTMLElement =>
  container!.querySelector<HTMLElement>(`[data-label="${label}"]`)!;

describe('A. 漫游语义（tab-roving 本体，经真事件）', () => {
  it('ArrowDown 移焦点，并且 preventDefault（不防就会同时滚页）', async () => {
    await render(<Fixture />);
    const { defaultPrevented } = press(byLabel('a'), 'ArrowDown');
    expect(document.activeElement).toBe(byLabel('b'));
    expect(defaultPrevented).toBe(true);
  });

  it('tablist **外面**的工具标签在同一组里', async () => {
    await render(<Fixture />);
    press(byLabel('b'), 'ArrowDown');
    expect(document.activeElement).toBe(byLabel('c'));
  });

  it('两端回绕：末枚 ArrowDown 回首枚，首枚 ArrowUp 到末枚', async () => {
    await render(<Fixture />);
    press(byLabel('c'), 'ArrowDown');
    expect(document.activeElement).toBe(byLabel('a'));
    press(byLabel('a'), 'ArrowUp');
    expect(document.activeElement).toBe(byLabel('c'));
  });

  it('Home / End 到组的两端', async () => {
    await render(<Fixture />);
    press(byLabel('b'), 'End');
    expect(document.activeElement).toBe(byLabel('c'));
    press(byLabel('c'), 'Home');
    expect(document.activeElement).toBe(byLabel('a'));
  });

  it('横竖两条轴不共用：纵向组里 ArrowRight 无事发生', async () => {
    await render(<Fixture />);
    const { defaultPrevented } = press(byLabel('a'), 'ArrowRight');
    expect(document.activeElement).toBe(byLabel('a'));
    expect(defaultPrevented).toBe(false);
  });

  it('嵌在容器里的 dialog **不属于**外层组（两个焦点圈不能并成一个）', async () => {
    await render(<Fixture withDialog />);
    press(byLabel('c'), 'ArrowDown');
    expect(document.activeElement).toBe(byLabel('a'));
    expect(document.activeElement).not.toBe(byLabel('d'));
  });

  it('dialog 自己那两枚是它自己的组（外层 handler 不抢，横向轴归面板）', async () => {
    await render(<Fixture withDialog />);
    press(byLabel('d'), 'ArrowRight');
    expect(document.activeElement).toBe(byLabel('e'));
    press(byLabel('e'), 'ArrowRight');
    expect(document.activeElement).toBe(byLabel('d'));
  });

  it('焦点不在 tab 上时不动它', async () => {
    await render(
      <nav data-testid="plain" onKeyDown={(event) => onTabRovingKeyDown(event, 'vertical')}>
        <button type="button" data-label="plain">
          普通按钮
        </button>
      </nav>,
    );
    const { defaultPrevented } = press(byLabel('plain'), 'ArrowDown');
    expect(document.activeElement).toBe(byLabel('plain'));
    expect(defaultPrevented).toBe(false);
  });

  it('🔴 上一跳已被消费（dnd-kit KeyboardSensor 拖拽中）时漫游**让位**', async () => {
    await render(<Fixture consumeKeys />);
    press(byLabel('a'), 'ArrowDown');
    expect(document.activeElement).toBe(byLabel('a'));
  });

  it('不认识的键不吞事件（否则输入框/嵌套组件的键会被吃掉）', async () => {
    await render(<Fixture />);
    expect(press(byLabel('a'), 'ArrowDownToTheMoon').defaultPrevented).toBe(false);
    expect(press(byLabel('a'), 'Enter').defaultPrevented).toBe(false);
  });
});

describe('B. 哪一枚进 Tab 序列（rovingTabKey）', () => {
  it('选中项在组里时就是它', () => {
    expect(rovingTabKey(['tasks', 'calendar'], 'calendar')).toBe('calendar');
  });

  it('选中项**不在**组里（设置/成长这类不进 rail 的视图）时落回首枚 —— 不是 null', () => {
    expect(rovingTabKey(['tasks', 'calendar'], 'settings')).toBe('tasks');
  });

  it('没有选中项时也有且只有一枚可达', () => {
    expect(rovingTabKey(['tasks', 'calendar'], null)).toBe('tasks');
    expect(rovingTabKey([], 'tasks')).toBeNull();
  });
});

const mainTabs = VIEW_TABS.filter((tab) => tab.key !== 'settings' && tab.key !== 'trash').slice(0, 3);

async function renderRail(view: ViewKey = 'tasks', assistantActive = false): Promise<{ nav: HTMLElement; onNavigate: ReturnType<typeof vi.fn> }> {
  const onNavigate = vi.fn();
  await render(
    <RailNavigation
      view={view}
      visibleMainTabs={mainTabs}
      visibleToolTabs={TOOL_VIEW_TABS}
      syncNeedsSignIn
      growthEnabled={false}
      onNavigate={onNavigate}
      onResetTasks={vi.fn()}
      onSignIn={vi.fn()}
      onOpenSettings={vi.fn()}
      onOpenProfile={vi.fn()}
      onOpenProfileCenter={vi.fn()}
      onOpenGrowth={vi.fn()}
      onSignOut={vi.fn()}
      onOpenHelp={vi.fn()}
      onOpenAssistant={vi.fn()}
      assistantActive={assistantActive}
    />,
  );
  return { nav: container!.querySelector<HTMLElement>('nav.ht-rail')!, onNavigate };
}

describe('C. 真组件渲染出来的那一格', () => {
  it('rail：`role="tab"` 里**恰好一枚** `tabIndex="0"`，且是当前视图那枚', async () => {
    const { nav } = await renderRail('tasks');
    const tabs = tabsOf(nav);
    expect(tabs.length).toBeGreaterThan(2);
    const zeroth = tabs.filter((tab) => tab.getAttribute('tabindex') === '0');
    expect(zeroth).toHaveLength(1);
    expect(zeroth[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('rail：ArrowDown 移动焦点，但**不切换视图**（onNavigate 零调用）', async () => {
    const { nav, onNavigate } = await renderRail('tasks');
    const [first, second] = tabsOf(nav);
    press(first!, 'ArrowDown');
    expect(document.activeElement).toBe(second);
    expect(nav.contains(document.activeElement)).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('🔴 当前视图不在 rail 上（设置页）时，0 落回首枚 —— 整段不许一个 Tab 都到不了', async () => {
    const { nav } = await renderRail('settings');
    const tabs = tabsOf(nav);
    const focusable = tabs.filter((tab) => tab.getAttribute('tabindex') === '0');
    expect(focusable).toHaveLength(1);
    expect(focusable[0]).toBe(tabs[0]);
    expect(focusable[0]?.getAttribute('aria-selected')).toBe('false');
  });

  it('助手开着时 0 落在助手那枚（它占组里的一格，不是组外的孤立按钮）', async () => {
    const { nav } = await renderRail('tasks', true);
    const assistant = nav.querySelector<HTMLElement>('[data-testid="rail-assistant"]');
    expect(assistant?.getAttribute('tabindex')).toBe('0');
    expect(tabsOf(nav).filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('工具标签也在同一组里（按到底能走到回收站）', async () => {
    const { nav } = await renderRail('tasks');
    const tabs = tabsOf(nav);
    const trash = nav.querySelector<HTMLElement>('.ht-rail__tab--tool[role="tab"]');
    expect(trash).toBeDefined();
    expect(tabs[tabs.length - 1]).toBe(trash);
    press(tabs[tabs.length - 2]!, 'ArrowDown');
    expect(document.activeElement).toBe(trash);
  });

  it('通知面板打开后：两枚 tab 里恰好一枚 0，ArrowRight 走到「活动」', async () => {
    await render(<InboxBell />);
    const trigger = container!.querySelector<HTMLElement>('[data-testid="inbox-trigger"]')!;
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const panel = container!.querySelector<HTMLElement>('[data-testid="inbox-panel"]');
    expect(panel).not.toBeNull();
    const tabs = tabsOf(panel!);
    expect(tabs.filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1);
    press(tabs[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(tabs[1]);
    press(tabs[1]!, 'ArrowDown');
    expect(document.activeElement).toBe(tabs[1]);
  });
});
