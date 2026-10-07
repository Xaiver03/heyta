/**
 * 🔴 信息架构：**设置是浮层，不是一路由** —— 判据是「下层可见」。
 *
 * ## 为什么单独有一条判据
 *
 * 对照滴答清单实测：它的设置是**从右侧滑出的浮层面板**，左 rail 与列表明明还在
 *（`docs/research/dida-capture/INTERFACE-NOTES.md` §11.5）。
 * 而我们此前把它做成 `ViewKey` 之一 —— **打开它会把内容区整个换掉**，下层就没了。
 *
 * 规律（同一节）：**次级表面（搜索 / 通知 / 设置）里做的事都需要"回头看下面"**，
 * 所以它们**不离开当前视图**；主视图之间切换不需要这种回头，才留在应用内。
 *
 * ## 这条判据能因注入故障而转红
 *
 * 把 `App.tsx` 里的 `contentView` 换回 `view`（= 让下层不再渲染），
 * 下面「下层仍在 DOM 里」那两条就会红 —— 已实测。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initOpLog, __resetOpLogForTests } from '../src/lib/oplog.js';
import { useTaskStore } from '../src/features/tasks/store.js';
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
  __resetOpLogForTests();
  await initOpLog();
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
  return container;
}

/** 走真实入口：点开头像 → 点「设置」。 */
async function openSettings(el: HTMLElement): Promise<void> {
  const avatar = el.querySelector('[data-testid="account-menu-avatar"]');
  expect(avatar, '头像入口必须在（设置收在它里面，不占 rail）').not.toBeNull();
  await act(async () => {
    avatar?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    avatar?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  const item = document.querySelector('[data-testid="account-menu-settings"]');
  expect(item, '头像菜单里必须有「设置」').not.toBeNull();
  await act(async () => {
    item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('设置浮层的 IA：下层必须可见', () => {
  it('打开设置后，**侧栏与当前视图都还在 DOM 里**（不是被换掉）', async () => {
    // 🔴 先种一条任务再挂载：「task-list」这个标记**只在有任务时渲染**
    //    （空库是 <EmptyState>）。锚点必须先证明它存在，判据才有意义 ——
    //    否则"锚点不在 DOM"会同时伪装成"下层被换掉了"。
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    __resetOpLogForTests();
    useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
    await initOpLog(`sheet-ia-${Math.random().toString(36).slice(2)}`);
    await act(async () => {
      await useTaskStore.getState().addTask('设置浮层判据的锚点任务');
    });

    const el = await mountApp();

    // 起点：任务视图的标记
    const before = {
      sidebar: el.querySelector('.ht-sidebar'),
      tasks: el.querySelector('[data-testid="task-list"]'),
      rail: el.querySelector('.ht-rail__tabs'),
    };
    expect(before.rail, 'rail 本来就在').not.toBeNull();
    expect(before.tasks, '任务列表本来就在（种子任务已落库）').not.toBeNull();

    await openSettings(el);

    // ① 浮层真的开了
    expect(
      el.querySelector('[data-testid="settings-sheet"]'),
      '设置应当作为一个浮层出现',
    ).not.toBeNull();

    // ② 🔴 **判据本体：下层还看得见。**
    //    这两条就是"浮层"与"应用内一路由"的分界 —— 路由会把它们换成设置内容。
    expect(
      el.querySelector('[data-testid="task-list"]'),
      '任务视图的标记必须仍在 DOM 里 —— 设置是盖在它上面的，不是替换它',
    ).not.toBeNull();
    expect(
      el.querySelector('.ht-rail__tabs'),
      'rail 必须仍在 DOM 里 —— 用户在设置里也要看得到自己在哪个视图',
    ).not.toBeNull();
  });

  it('浮层不是模态：`aria-modal=false`，且**能回到原来那个视图**', async () => {
    const el = await mountApp();
    await openSettings(el);
    const sheet = el.querySelector('[data-testid="settings-sheet"]');
    expect(sheet?.getAttribute('role')).toBe('dialog');
    // 下层可操作 ⇒ 不能声明成 aria-modal=true（那会告诉读屏"外面不可用"）。
    expect(sheet?.getAttribute('aria-modal')).toBe('false');
    expect(sheet?.getAttribute('aria-label')).toBe('设置');
  });
});

/**
 * 2026-09-30 补：**浮层必须出得去**。
 *
 * 在这个之前，设置浮层**没有任何退出口** —— 没 Esc、没 ✕、点空白也不关
 *（它 `inset: 0` 盖满内容区，点哪儿都是它自己）。唯一的出路是去点 rail 上
 * 另一个视图。对键盘/读屏用户那就是"进得去出不来"。
 *
 * 判据两条：**Esc 能关**（快捷）与 **✕ 能关**（看得见）—— 浮层的标准出口
 * 是"两个都要有"，只给一个都会在某一类用户那里变成死路。
 * ⚠️ Esc 必须挂**捕获阶段**（RN-web 的 `TextInput` 无条件吞 keydown 冒泡，
 * 见 `App.tsx` 的那段注释）；这里 jsdom 直接派发事件**测不到那个坑**，
 * 真浏览器那条在 `e2e/tests/search-overlay.spec.ts` 里。
 */
describe('设置浮层的退出口：Esc 与 ✕ 都要能关', () => {
  it('Esc 关掉设置，回到"开设置前"的那个视图（下层还在）', async () => {
    const el = await mountApp();
    await openSettings(el);
    expect(el.querySelector('[data-testid="settings-sheet"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(
      el.querySelector('[data-testid="settings-sheet"]'),
      'Esc 之后浮层必须消失',
    ).toBeNull();
    // 关回去是"原来那个视图"（任务），不是被换成别的。
    expect(el.querySelector('[data-testid="task-list"],.ht-empty')).not.toBeNull();
  });

  it('点 ✕ 也能关（不是只有键盘用户出得去）', async () => {
    const el = await mountApp();
    await openSettings(el);

    const close = el.querySelector<HTMLButtonElement>('[data-testid="settings-sheet-close"]');
    expect(close, '浮层必须有一个**看得见的**关闭按钮').not.toBeNull();
    expect(close!.getAttribute('aria-label'), '图标按钮必须有可访问名').toBe('关闭设置');

    await act(async () => {
      close!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(el.querySelector('[data-testid="settings-sheet"]')).toBeNull();
  });
});
