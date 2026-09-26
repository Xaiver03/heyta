/**
 * 整个 App 必须能挂起来
 * ======================
 *
 * ## 这条测试为什么存在
 *
 * 它是一条**回归钉**，钉的是一个真实发生过、而且藏了很久的 bug：
 *
 * `App.tsx` 用 `useTaskStore(selectVisibleTasks)` 和
 * `useTaskStore(selectQuadrantCounts)` 取派生数据。zustand v5 底层是
 * `useSyncExternalStore`，它要求 selector 结果**引用稳定**；
 * 而这两个 selector 一个返回 `filter()` 的新数组、一个返回新对象 ——
 * 每次调用都是新引用。
 *
 * 后果不是"多渲染几次"，而是 **React 判定快照一直在变 → 无限重渲染 →
 * 抛 `Maximum update depth exceeded`：`<App />` 根本挂不起来。**
 *
 * ## 为什么这么久没被发现
 *
 * 因为**在此之前没有任何测试挂载过整个 App**。
 * 每个特征组件都有自己的测试（`ai-breakdown` 48 条、`ai-settings` 63 条、
 * `memory-panel` 14 条），全绿 —— 但它们挂的都是**单个组件**。
 * 根组件坏掉这件事，只有挂根组件才看得见。
 *
 * 🔴 这就是本仓库最高发的失效形状：**每一段都绿、接起来断**。
 * 所以这条测试**故意不做任何 mock**（真 op-log、真 IndexedDB），
 * 也**故意不依赖真端点** —— 它必须永远在跑。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');

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

describe('根组件', () => {
  it('🔴 <App /> 能挂载（selector 引用不稳会让它无限重渲染）', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    // 不吞异常：挂载失败必须让测试红，而不是打条日志就过去。
    await act(async () => {
      root?.render(<App />);
    });

    expect(container.textContent ?? '').not.toBe('');
  });

  it('🔴 空库也要渲染出视图 tab 与捕获框（不是白屏）', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<App />);
    });

    const tabs = [...container.querySelectorAll('button[role="tab"]')].map((e) =>
      e.textContent?.trim(),
    );
    expect(tabs).toContain('任务');
    expect(tabs).toContain('设置');
    expect(
      container.querySelector('input[placeholder^="添加任务"]'),
      '空库时捕获框仍然要在，否则用户没有入口开始',
    ).not.toBeNull();
  });
});
