/**
 * 🔴 信息架构：**搜索是浮层，不是一路由** —— 判据同设置 sheet：「下层可见」。
 *
 * ## 为什么要有这一组
 *
 * 滴答 §11.5（`docs/research/dida-capture/INTERFACE-NOTES.md`）的规律：
 * **次级表面（搜索 / 通知 / 设置）里做的事都需要"回头看下面"**，
 * 所以它们**不离开当前视图**。设置 2026-09-29 已改成 sheet（见
 * `settings-sheet-ia.spec.tsx`），搜索 2026-09-30 补齐：卡片 + scrim，
 * 下层视图透出。
 *
 * 🔴 2026-10-01 改成**聚焦搜索（Spotlight）形态**：卡片**贴顶**，
 * 面板自己**没有 ✕** —— 退出口只有 **Esc / 点 scrim / ⌘K** 三条，
 * 全部走 `closeSecondarySurface`（回到开浮层前的那个视图）。
 *
 * ## 这组判据能因注入故障而转红
 *
 * - 把 `App.tsx` 的 `contentView` 泛化改回去（搜索时渲染 'search' 自身）
 *   → 「下层仍在 DOM」那条红 —— 下层被换掉了；
 * - 把 Esc / scrim / ⌘K 任何一个关法改回 `setView('tasks')`（写死）
 *   → 「回到开搜索前的视图」那条红 —— 从日历开搜索、关掉后跑到任务页去了。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initOpLog, __resetOpLogForTests } from '../src/lib/oplog.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { usePrivacyStore } from '../src/features/privacy/store.js';
import { emptyState } from '@heyta/op-log';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
// 🔴 用**线上同一个**壳（`main.tsx` 也用它）—— 在测试里自己拼 Provider 就是第二份接线。
import { LocaleHost } from '../src/lib/locale-host.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('privacy.consent', JSON.stringify({ decision: 'local-only', decidedAt: new Date().toISOString() }));
  usePrivacyStore.setState({ open: false, reason: 'first-launch', notPersisted: false });
  __resetOpLogForTests();
  await initOpLog(`search-ia-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

async function mountApp(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
  return container;
}

/** 走真实入口：点 rail 上「搜索」那个 tab。 */
async function openSearch(el: HTMLElement): Promise<void> {
  const tab = [...el.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
    (b) => b.textContent?.trim() === '搜索',
  );
  expect(tab, 'rail 上找不到「搜索」—— 这个入口就不存在').toBeDefined();
  await act(async () => {
    tab!.click();
  });
}

async function pressEscape(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await Promise.resolve();
  });
}

/**
 * ⌘K（macOS / Windows 桌面壳上都是 command 键）—— 第三条退出口，也是第二条**入口**。
 *
 * 🔴 宿主的那个监听挂在**捕获阶段**（`addEventListener('keydown', fn, true)`，§7 第 80 条：
 * RN-web 的输入框在冒泡阶段无条件 `stopPropagation()`）。这里直接朝 window 派发，
 * 事件的目标就是 window 本身 ⇒ 捕获与冒泡监听都会收到，**测的是"接线在不在"，
 * 不是"捕获有没有赢过输入框"** —— 后者只有真浏览器能证（`e2e/tests/search-panel.spec.ts`）。
 */
async function pressMetaK(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    await Promise.resolve();
  });
}

describe('搜索浮层的 IA：下层必须可见', () => {
  it('打开搜索后，**浮层开了**（role=dialog），且**下层视图与 rail 都还在 DOM 里**', async () => {
    // 🔴 先种一条任务再挂载：「task-list」这个标记只在有任务时渲染
    //    （空库是 <EmptyState>）—— 锚点必须先证明它存在，判据才有意义。
    useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
    await act(async () => {
      await useTaskStore.getState().addTask('搜索浮层判据的锚点任务');
    });

    const el = await mountApp();
    expect(el.querySelector('[data-testid="task-list"]'), '任务列表本来就在').not.toBeNull();

    await openSearch(el);

    // ① 浮层真的开了：贴顶卡片 + scrim，是一个**非模态** dialog。
    const surface = el.querySelector('[data-testid="search-overlay-surface"]');
    expect(surface, '搜索应当作为一个浮层出现').not.toBeNull();
    expect(surface?.getAttribute('role')).toBe('dialog');
    // 下层可操作 ⇒ 不能声明成 aria-modal=true（那会告诉读屏"外面不可用"）。
    expect(surface?.getAttribute('aria-modal')).toBe('false');

    // ② 🔴 **判据本体：下层还看得见。** 这两条就是"浮层"与"应用内一路由"的分界。
    expect(
      el.querySelector('[data-testid="task-list"]'),
      '任务视图的标记必须仍在 DOM 里 —— 搜索是盖在它上面的，不是替换它',
    ).not.toBeNull();
    expect(
      el.querySelector('.ht-rail__tabs'),
      'rail 必须仍在 DOM 里 —— 用户在搜索里也要看得到自己在哪个视图',
    ).not.toBeNull();
  });

  it('⌘K 能关（它同时是第二条入口），且**回到开搜索前的那个视图**（不是写死回任务页）', async () => {
    const el = await mountApp();
    // 先去日历 —— 从日历开搜索，关掉后应该**还在日历**。
    const calendarTab = [...el.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
      (b) => b.textContent?.trim() === '日历',
    );
    expect(calendarTab, '日历模块默认开，rail 上应该有「日历」').toBeDefined();
    await act(async () => {
      calendarTab!.click();
    });
    expect(el.querySelector('[data-testid="calendar-board"]'), '日历本来就在').not.toBeNull();

    await openSearch(el);
    expect(el.querySelector('[data-testid="search-overlay-surface"]')).not.toBeNull();

    // 🔴 面板**没有 ✕**（2026-10-01 改成聚焦搜索形态时删掉了：一个浮层里
    // "点外面能关"与"×能关"是同一件事的两个说法）。这条断言留着，
    // 是为了让"再加一个关闭控件"这件事**会红**，而不是悄悄长回来。
    expect(
      el.querySelector('[data-testid="search-panel-close"]'),
      '聚焦搜索形态不该有 ✕ —— 退出口是 Esc / scrim / ⌘K 三条',
    ).toBeNull();

    await pressMetaK();

    expect(el.querySelector('[data-testid="search-overlay-surface"]'), '⌘K 之后浮层应当关掉')
      .toBeNull();
    expect(
      el.querySelector('[data-testid="calendar-board"]'),
      '关掉后必须回到**开搜索前**的日历 —— 写死 setView(\'tasks\') 会让这条红',
    ).not.toBeNull();
  });

  it('Esc 能关，且**同样回到开搜索前的视图**', async () => {
    const el = await mountApp();
    // 与 ⌘K 那条同一招：从日历开搜索 —— Esc 写死 setView('tasks') 会让这条红。
    const calendarTab = [...el.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
      (b) => b.textContent?.trim() === '日历',
    );
    expect(calendarTab, '日历模块默认开，rail 上应该有「日历」').toBeDefined();
    await act(async () => {
      calendarTab!.click();
    });
    await openSearch(el);
    expect(el.querySelector('[data-testid="search-overlay-surface"]')).not.toBeNull();

    await pressEscape();

    expect(el.querySelector('[data-testid="search-overlay-surface"]'), 'Esc 之后浮层应当关掉')
      .toBeNull();
    expect(
      el.querySelector('[data-testid="calendar-board"]'),
      'Esc 关掉后必须回到**开搜索前**的日历',
    ).not.toBeNull();
  });

  it('点 scrim 本身能关（点到卡片内部不能关）', async () => {
    const el = await mountApp();
    await openSearch(el);
    const surface = el.querySelector<HTMLElement>('[data-testid="search-overlay-surface"]');
    expect(surface).not.toBeNull();

    // 点在卡片里（冒泡上来的 click 的 target 不是 overlay 自己）⇒ 不关。
    const input = el.querySelector<HTMLElement>('[data-testid="search-panel-input"]');
    expect(input).not.toBeNull();
    await act(async () => {
      input!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(el.querySelector('[data-testid="search-overlay-surface"]'), '点卡片内部不能关浮层')
      .not.toBeNull();

    // 点在 scrim 本身 ⇒ 关。
    await act(async () => {
      surface!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(el.querySelector('[data-testid="search-overlay-surface"]'), '点 scrim 应当关掉浮层')
      .toBeNull();
  });
});
