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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { LocaleHost } from '../src/lib/locale-host.js';
import { emptyState } from '@heyta/op-log';

import { useTaskStore } from '../src/features/tasks/store.js';
import { useProjectStore } from '../src/features/projects/store.js';

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
    //
    // 🔴 用**线上同一个** `LocaleHost`（`main.tsx` 也用它），而不是在测试里
    // 自己拼一遍 Provider —— 自己拼就是第二份接线，谁改了一处另一处就漂移。
    // 顺便：外壳里的语言切换器要求它在 Provider 之内，缺了会当场抛错。
    await act(async () => {
      root?.render(
        <LocaleHost>
          <App />
        </LocaleHost>,
      );
    });

    expect(container.textContent ?? '').not.toBe('');
  });

  it('🔴 空库也要渲染出视图 tab 与捕获框（不是白屏）', async () => {
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

/**
 * 侧栏导航必须真的把人带到地方
 * ==============================
 *
 * 这两条钉的是同一类失效：**零件全在、最后一米没接**。
 * 详见 `docs/research/dida365-feature-benchmark.md` §3。
 */
describe('侧栏导航', () => {
  /**
   * 页面上渲染出来的任务标题（顺序即 DOM 顺序）。
   *
   * 🔴 选择器跟着迁移换了：以前查 `.ht-task__title`（web 手写的任务行），
   * 现在查共享 `TaskList` 自己打的 `task-row-*` testID —— 那一族的 CSS
   * 已经随迁移删除，`.ht-task__title` 在页面上**不存在了**。
   *
   * 行体里除了标题还有元信息（截止/优先级），但这几条用例的任务都**没有**
   * 徽章，所以 `textContent` 就是标题本身。
   */
  function titles(el: HTMLElement): string[] {
    return [...el.querySelectorAll('[data-testid^="task-row-"]')].map(
      (e) => e.textContent?.trim() ?? '',
    );
  }

  /** 侧栏里按可访问名找一项。找不到就返回 undefined —— 由调用方断言。 */
  function navEntry(el: HTMLElement, label: string): HTMLButtonElement | undefined {
    return [...el.querySelectorAll<HTMLButtonElement>('button.ht-nav__item')].find(
      (b) => b.textContent?.trim() === label,
    );
  }

  async function mount(): Promise<void> {
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
  }

  /**
   * 🔴 每条用例用**自己的库名**。
   *
   * `beforeEach` 里的 `initOpLog()` 用的是默认库名 `heyta`，而
   * `IDBFactory` 在本文件顶层只创建一次 —— 于是用例之间会共享同一份数据。
   * 前两条用例不写数据所以看不出问题，**一旦开始建任务就会互相污染**，
   * 而且症状是"单跑绿、全跑红"那种最难查的。
   */
  async function freshDb(): Promise<void> {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    __resetOpLogForTests();
    /**
     * 🔴 **必须同时把 store 的 UI 状态复位**（`filter` / `entities` / `now`），
     * 不能只换一个空库。
     *
     * 实测代价：新加的那条"点标签筛选"用例把 `filter` 留在了 `{kind:'tag'}`
     * 上，而这里只换了库 —— 于是**下一条用例**（备注输入框）在一个"只显示
     * 某标签任务"的筛选下渲染，新建的任务一个都不匹配、任务行根本不出现，
     * 报的是"没有备注输入框"。**一条用例的残留状态让另一条报了个假故障**，
     * 而失败信息完全指不到真因。
     *
     * 与 `store.spec.ts` 的 `beforeEach` 同一形状 —— 那边早就这么做了。
     */
    useTaskStore.setState({
      entities: emptyState(),
      filter: { kind: 'all' },
      // 🔴 `query` 也必须复位 —— 它后来才加进来，而"漏复位"正是这个函数
      // 上一轮踩过的坑（筛泄漏到下一条用例，报的却是别处的假故障）。
      query: '',
      now: Date.now(),
      ready: false,
    });
    await initOpLog(`nav-test-${Math.random().toString(36).slice(2)}`);
  }

  it('🔴 「已完成」有入口，点它能看到已完成的任务', async () => {
    await freshDb();

    await act(async () => {
      await useTaskStore.getState().addTask('已归档的那件事');
    });
    const id = Object.keys(useTaskStore.getState().entities.tasks)[0];
    expect(id).toBeDefined();
    await act(async () => {
      await useTaskStore.getState().toggleComplete(id!);
    });

    await mount();

    // 收集箱只列未完成 —— 已完成的任务不该在这里出现。
    expect(titles(container!)).not.toContain('已归档的那件事');

    // 🔴 侧栏必须有这一项。它曾经**完全不存在**：`TaskFilter` 的 completed 分支、
    // `selectVisibleTasks` 的筛选、标题逻辑、空态文案全都写好了，
    // 就是没有任何按钮能把 filter 切过去 —— 于是 Web 上已完成的任务永远看不见。
    const entry = navEntry(container!, '已完成');
    expect(
      entry,
      '侧栏缺少「已完成」入口：filter 类型与空态文案都在，但用户切不过去',
    ).toBeDefined();

    await act(async () => {
      entry!.click();
    });

    expect(
      titles(container!),
      '点了「已完成」之后应当列出已完成的任务',
    ).toContain('已归档的那件事');
  });

  it('🔴 在别的视图点侧栏筛选，会切回任务视图（否则看起来是"点了没反应"）', async () => {
    await freshDb();
    await mount();

    // 先离开任务视图。视图 tab 是互斥的一组 `role=tab`。
    const habitsTab = [...container!.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
      (b) => b.textContent?.trim() === '习惯',
    );
    expect(habitsTab).toBeDefined();
    await act(async () => {
      habitsTab!.click();
    });

    const titleEl = (): string =>
      container!.querySelector('.ht-header__title')?.textContent?.trim() ?? '';
    expect(titleEl()).toBe('习惯');

    // 侧栏在所有视图下都渲染，而它的每一项都是**任务筛选**。
    const inbox = navEntry(container!, '收集箱');
    expect(inbox).toBeDefined();
    await act(async () => {
      inbox!.click();
    });

    // 判据是**标题**：它跟视图走（见 `VIEW_TITLED_BY_TAB`）。
    // 修之前这里仍是「习惯」—— 筛选真的变了，但当前视图根本不读它。
    expect(titleEl(), '点侧栏筛选应当切回任务视图，而不是停在原视图').toBe('收集箱');
  });

  /**
   * 🔴 「组件是对的」不等于「用户碰得到它」。
   *
   * `NoteEditor` 有自己的测试，但那些测试是**直接挂组件**的 —— 把
   * `<NoteEditor />` 从 `App.tsx` 里删掉，它们**全部照绿**。
   * 而这恰好就是本仓库最高发的那类失效：零件齐、最后一米没接
   * （`Task.note` 与 `setNote` 都在，唯一调用点是 AI）。
   *
   * 所以这一条断言的是**接线**：任务行里真的有一个备注输入框。
   */
  /**
   * 🔴 标签筛选此前**没有界面**。
   *
   * `TaskFilter` 的 `{ kind: 'tag' }` 分支与 `filterTasks` 的 `tag` 判据
   * 都在 `packages/domain` 里、都有单测 —— 但侧栏的标签名是一个**不可点的
   * `<span>`**，于是没有任何用户能切到那个筛选。这是"看起来有、其实没有"
   * 的另一种形状：**数据和判据都在，缺的是"用户能不能用它"**。
   */
  /**
   * 🔴 搜索此前**根本不存在**（不是"不好用"，是没有任何入口）。
   *
   * 判据在 `packages/domain/src/search.ts`（匹配哪些字段 / 大小写 /
   * 多词是 AND），这份用例只钉**接线**：输入框真的在、打字真的收窄了列表。
   */
  it('🔴 在搜索框里打字能收窄任务列表（此前没有搜索）', async () => {
    await freshDb();
    await act(async () => {
      await useTaskStore.getState().addTask('给客户写周报');
      await useTaskStore.getState().addTask('买牛奶');
    });

    await mount();

    const box = container!.querySelector<HTMLInputElement>('input[type="search"]');
    expect(box, '任务视图里没有搜索框 —— `{query}` 判据在共享层，但没人能用').not.toBeNull();

    // 未搜索时两条都在
    expect(titles(container!).length).toBe(2);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(box!, '周报');
      box!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const shown = titles(container!);
    expect(shown, '搜索应当只留下命中那条').toEqual(['给客户写周报']);
    expect(shown, '不命中的那条要消失').not.toContain('买牛奶');

    // 清除按钮要把查询清掉（否则用户只能一个个删字）
    const clear = container!.querySelector<HTMLButtonElement>('.ht-search__clear');
    expect(clear, '搜索框里没有清除按钮').not.toBeNull();
    await act(async () => {
      clear!.click();
    });
    expect(titles(container!).length, '清除后应当回到全部').toBe(2);
  });

  it('🔴 点侧栏的标签能筛出只带该标签的任务（此前标签名不可点）', async () => {
    await freshDb();

    // 两条任务，只有一条带标签
    await act(async () => {
      await useTaskStore.getState().addTask('带标签的');
      await useTaskStore.getState().addTask('不带标签的');
    });
    await act(async () => {
      await useProjectStore.getState().addTag('工作');
    });
    const tagId = Object.values(useProjectStore.getState().tags)[0]?.id;
    expect(tagId, '标签没建出来').toBeDefined();
    const withTag = Object.values(useTaskStore.getState().entities.tasks).find(
      (t) => t.title === '带标签的',
    );
    await act(async () => {
      await useTaskStore.getState().setTags(withTag!.id, [tagId!]);
    });

    await mount();

    // 侧栏里那个标签必须是**可点**的
    const tagButton = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === '工作',
    );
    expect(
      tagButton,
      '侧栏的标签名不可点 —— `{kind:\'tag\'}` 的判据在共享层，但没人能切过去',
    ).toBeDefined();

    await act(async () => {
      tagButton!.click();
    });

    const shown = titles(container!);
    expect(shown, '标签筛选应当只留下带该标签的任务').toContain('带标签的');
    expect(shown, '不带该标签的任务不该出现在标签视图里').not.toContain('不带标签的');
    // 标题跟着筛选走（标签名是用户自己的字，原样显示）
    expect(
      container!.querySelector('.ht-header__title')?.textContent?.trim(),
    ).toBe('工作');
  });

  it('🔴 任务行上真的有备注输入框（不是只有组件、没人用它）', async () => {
    await freshDb();
    await act(async () => {
      await useTaskStore.getState().addTask('写周报');
    });

    await mount();

    const noteField = container!.querySelector('textarea[aria-label^="编辑"]');
    expect(
      noteField,
      '任务行上没有备注输入框：`NoteEditor` 没被接进 `App.tsx`，' +
        '于是用户还是写不了备注 —— 这正是要修的那个洞',
    ).not.toBeNull();
  });
});

/**
 * 应用 → 站点：产品孤岛的**另一半**
 * ==================================
 *
 * 🔴 这一组钉的是 N3 那条约束里**一直空着的那一半**。
 *
 * 站点 → 应用早就通了（`apps/landing` 的 `VITE_APP_URL`），而应用 → 站点
 * **一行链接都没有**。也就是说：用户在应用里遇到问题找不到帮助，想知道要不要
 * 付费找不到价格，想知道这东西还在不在维护找不到更新动态。
 * 这不叫"还没有帮助中心"，这叫**两个产品**。
 *
 * 🔴 为什么这条必须挂在**整个 App**上，而不是单独挂 `HelpPanel`：
 * `HelpPanel` 自己的测试再全，把 `<HelpPanel />` 从 `App.tsx` 的 settings
 * 分支里删掉，那些测试**一个都不会红**。这正是本仓库最高发的失效形状
 * （零件齐、最后一米没接），也正是"三问"里的第 2 问。
 */
describe('应用 → 站点：孤岛的另一半', () => {
  async function mount(): Promise<void> {
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
  }

  /** 切到设置视图，返回设置页正文里的站内链接。 */
  async function openSettings(): Promise<HTMLAnchorElement[]> {
    await mount();

    const tab = [
      ...container!.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
    ].find((b) => b.textContent?.trim() === '设置');
    expect(tab, '找不到「设置」视图 tab').toBeDefined();

    await act(async () => {
      tab!.click();
    });

    return [...container!.querySelectorAll<HTMLAnchorElement>('[data-testid="about-links"] a')];
  }

  it('🔴 设置页里有指向站点帮助 / 更新动态 / 价格的链接', async () => {
    const links = await openSettings();

    const paths = links.map((a) => a.getAttribute('href') ?? '');
    expect(
      paths,
      '设置页里缺少指向站点的入口 —— 应用与站点仍然是两个孤岛',
    ).toEqual([
      `${window.location.origin}/help`,
      `${window.location.origin}/changelog`,
      `${window.location.origin}/pricing`,
    ]);

    // 外链一律带 noopener：`noopener` 防被打开页面反向操纵本页，
    // `noreferrer` 一起带上是因为 Referer 会泄露用户**在应用的哪一页**。
    for (const link of links) {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('站点的域名由 VITE_SITE_URL 决定（分域名部署时不是写死的那一个）', async () => {
    vi.stubEnv('VITE_SITE_URL', 'https://site.example.com/');
    const links = await openSettings();
    for (const link of links) {
      expect(link.getAttribute('href')?.startsWith('https://site.example.com/')).toBe(true);
    }
    vi.unstubAllEnvs();
  });

  it('「关于」面板里没有假的「检查更新」按钮 —— 应用是 PWA，更新不由用户触发', async () => {
    await openSettings();
    const panel = container!.querySelector('[data-testid="about-panel"]');
    expect(panel).not.toBeNull();
    // 一个点了不会生效的按钮比没有按钮更坏（同 `Pricing.tsx` 不放"立即购买"）。
    const buttons = [...(panel?.querySelectorAll('button') ?? [])];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([]);
  });
});
