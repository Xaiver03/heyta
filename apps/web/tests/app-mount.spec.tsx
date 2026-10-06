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
import { openSettingsViaAvatar } from './open-settings-via-avatar.js';
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
    // ⚠️ 「设置」**不在这组里** —— 它在头像菜单后面（见 `openSettingsViaAvatar`）。
    expect(tabs, '设置不该再是 rail 上的 tab').not.toContain('设置');
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
   * 现在查共享 `TaskList` 自己打的 `task-title-*` —— 那一族的 CSS
   * 已经随迁移删除，`.ht-task__title` 在页面上**不存在了**。
   *
   * 🔴🔴 为什么不查行体 `task-row-*` 的 `textContent`（这句注释以前是"这几条用例
   * 的任务都没有徽章，所以行体文本就是标题" —— **那句现在不成立了**）：
   * 行内元信息有了常驻的清单归属之后，**每一行**都带徽章，行体文本变成
   * 「买两桶漆」+「家庭装修」连成一串。当时三条用例就是这么红的。
   * ⇒ 标题要有自己的可寻址锚点，判据才不会被旁边那槽的内容带着走。
   */
  function titles(el: HTMLElement): string[] {
    return [...el.querySelectorAll('[data-testid^="task-title-"]')].map(
      (e) => e.textContent?.trim() ?? '',
    );
  }

  /** 侧栏里按可访问名找一项。找不到就返回 undefined —— 由调用方断言。 */
  function navEntry(el: HTMLElement, label: string): HTMLButtonElement | undefined {
    // ⚠️ 前缀匹配而不是全等：2026-09-30 起范围列带**计数**（滴答同款，
    //    "今天 13"），textContent = 标签 + 计数 —— 全等会永远找不到。
    return [...el.querySelectorAll<HTMLButtonElement>('button.ht-nav__item')].find(
      (b) => b.textContent?.trim().startsWith(label),
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

  /**
   * 🔴 侧栏（范围列）**只属于任务视图** —— 2026-09-29 的 IA 改动。
   *
   * 原来这条测试的断言是「在**别的视图**点侧栏筛选会切回任务视图」，
   * 那预设了"侧栏在所有视图下都渲染"。而那个预设正是 IA 混乱的一部分：
   * 每个视图左边都挂着一列**跟它无关**的任务筛选
   *（`dida-view-unification.md` §1.3：滴答的四象限/日历/习惯视图里侧栏是**消失**的）。
   *
   * 现在侧栏只在有范围的视图里出现，所以「在别的视图点它」这个场景**不可达** ——
   * 于是这条测试改成钉**新的正确行为**，而且仍然保留它原本要保护的东西：
   * 「筛选导航同时也是视图切换」这件事没变。
   */
  it('🔴 范围列只属于任务视图，且点它会切回任务视图（"点了没反应"的反面）', async () => {
    await freshDb();
    await mount();

    const titleEl = (): string =>
      container!.querySelector('.ht-header__title')?.textContent?.trim() ?? '';
    // 视图在 **rail** 里（不是顶栏 —— 见 IA 那一组断言）。
    const railTab = (name: string): HTMLButtonElement | undefined =>
      [...container!.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
        (b) => b.textContent?.trim() === name,
      );
    const habitsTab = railTab('习惯');
    const tasksTab = railTab('任务');
    expect(habitsTab, 'rail 上没有「习惯」').toBeDefined();
    expect(tasksTab, 'rail 上没有「任务」').toBeDefined();

    /*
     * 🔴 下面这几步钉的是 2026-10-04 删掉侧栏「收集箱」那一行之后的**两半**，
     * 少任何一半都是半条判据：
     *
     * ① 侧栏**不再有**「收集箱」那一行 —— 产品负责人：「已经有一个收集箱的标题了，
     *    为什么还要个收集箱？在信息架构上面是重复的」（同一屏两个控件指向同一个
     *    目的地、高亮还各自独立）。
     * ② 删掉它换来的**唯一**风险是"停在某个清单/标签上就再也回不去收集箱"，
     *    所以这里必须先把筛选挪走（点「今天」），再验证两条都在：
     *    **离开再回来 = 位置保留**（R9，2026-10-02 同一位产品负责人：回到任务视图
     *    应当看到他离开时停着的那一格），**已经在这儿了再点一次 = 回收集箱**。
     *    ⚠️ 不先挪走筛选，第二条会对着默认的收集箱无条件成立 —— 那就是一条
     *    永远通过的判据（§7 元规则 2）。
     */
    const today = navEntry(container!, '今天');
    expect(today, '侧栏缺少「今天」入口').toBeDefined();
    await act(async () => {
      today!.click();
    });
    expect(titleEl(), '点「今天」之后标题应当跟着筛选走').toBe('今天');

    // ① 侧栏里那行重复的「收集箱」必须不在（不是"渲染了但看不见"）。
    expect(
      navEntry(container!, '收集箱'),
      '侧栏不该再有「收集箱」那一行 —— 与页头同名，是同一个目的地的两个入口',
    ).toBeUndefined();

    // 离开任务视图。
    await act(async () => {
      habitsTab!.click();
    });
    expect(titleEl()).toBe('习惯');

    // 🔴 习惯视图里**没有**范围列（有的话就是"挂着一列跟它无关的东西"）。
    expect(
      container!.querySelector('.ht-sidebar'),
      '习惯视图不该有任务范围列',
    ).toBeNull();
    // 也确认「收集箱」确实**不在这一屏**（不只是类名换了）
    expect(
      [...container!.querySelectorAll('button')].some((b) => b.textContent?.trim() === '收集箱'),
      '收集箱不该出现在习惯视图里',
    ).toBe(false);

    // 回到任务视图：位置必须还在（这条是 R9 的原文，不许被 ② 顶掉）。
    await act(async () => {
      tasksTab!.click();
    });
    expect(titleEl(), '回到任务视图应当看见离开时停着的那一格，不是收集箱').toBe('今天');

    // ② 人已经在任务视图里再点一次「任务」= 回收集箱。
    await act(async () => {
      tasksTab!.click();
    });
    expect(titleEl(), '停在「今天」时再点一次 rail 的「任务」应当回到收集箱').toBe('收集箱');
    expect(
      useTaskStore.getState().filter.kind,
      '标题回到收集箱而筛选没跟着回 —— 那是标题在撒谎',
    ).toBe('all');
  });

  /**
   * 🔴 R9（2026-10-02 产品负责人实测）：页头标题跟着**视图**走，
   * 不许停在上一个视图留下的筛选上。
   *
   * 她报的路径是：在收集箱点「重要不紧急」→ 再去点侧栏别的入口 →
   * 日历已经画出来了，页头却**永远**写着「重要不紧急」。
   *
   * 根因不是"忘了清 filter"，而是标题的默认方向反了：当时有一张
   * `VIEW_TITLED_BY_TAB` 白名单列出"标题跟视图走"的视图，**不在表上的**
   * 回落到读 `store.filter`。日历是后来才加进 `MODULE_VIEW_TABS` 的模块视图，
   * 没人登记它 —— 于是它走了回落那条路。
   *
   * ⚠️ 第 ④ 步和前三步一样重要：**不许用"切视图时清空 filter"来修标题**。
   * 用户回到任务视图应当看到他离开时停着的那一格，那是他的位置，不是垃圾。
   */
  it('🔴 点过象限再切日历/搜索，标题跟着视图换，而筛选留在原处', async () => {
    await freshDb();
    await mount();

    const titleEl = (): string =>
      container!.querySelector('.ht-header__title')?.textContent?.trim() ?? '';
    const railTab = (name: string): HTMLButtonElement | undefined =>
      [...container!.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
        (b) => b.textContent?.trim() === name,
      );

    // ① 先钉住**该保留**的那一半：任务视图里点象限，标题就该是象限名。
    const q2 = navEntry(container!, '重要不紧急');
    expect(q2, '侧栏缺少「重要不紧急」入口').toBeDefined();
    await act(async () => {
      q2!.click();
    });
    expect(titleEl()).toBe('重要不紧急');

    // ② 切日历：内容换成日历，标题必须跟着换。
    await act(async () => {
      railTab('日历')!.click();
    });
    expect(titleEl(), '日历页挂着上一个视图残留的象限名').toBe('日历');

    // ③ 搜索同理 —— 它同样不在那张白名单上。
    await act(async () => {
      railTab('搜索')!.click();
    });
    expect(titleEl(), '搜索页挂着上一个视图残留的象限名').toBe('搜索');

    // ④ 回任务视图：筛选还在象限上，标题也就还是象限名。
    await act(async () => {
      railTab('任务')!.click();
    });
    expect(
      titleEl(),
      '回到任务视图后筛选应当还在原处 —— 标题的修法不是把 filter 清掉',
    ).toBe('重要不紧急');
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
   * 多词是 AND），这份用例只钉**接线**：rail 上那个按钮真的能开浮层、
   * 在浮层里打字真的能筛出结果。
   *
   * 🔴 2026-10-01 形态改了，两条断言跟着改：
   *
   * - **顶栏那个内联输入框删了。** 产品负责人拍板：一个应用只有**一个**搜索入口。
   *   同屏放两个都能打字的框，用户必须先回答"我该在哪个里打字"，而这两个框的
   *   结果还不是一回事（一个筛当前列表、一个跨实体）—— 那是把内部实现的
   *   不一致摆到界面上。所以下面第一条钉的是它的**不存在**：这东西会以
   *   "顺手加个快捷搜索框"的形式复活，而那时没有任何测试会拦。
   * - **查询不再收窄下面的列表**（`selectVisibleTasks` 只看 `filter`）——
   *   搜索是盖在视图上的一层，关掉之后下面还是原来那一屏。
   *
   * ⚠️ 结果断言**全部圈在浮层里面**：`.ht-search-overlay` 是**非模态**的，
   *    下层任务行一直在 DOM 里（那正是"浮层"与"应用内一路由"的分界，判据在
   *    `search-overlay-ia.spec.tsx`）。整页查 `task-row-*` 会同时捞到两层，
   *    "只留下命中那条"就**永远不成立** —— 而失败信息看着像搜索坏了。
   */
  it('🔴 rail 的「搜索」是唯一入口，浮层里打字能命中；顶栏那个框不许回来', async () => {
    await freshDb();
    await act(async () => {
      await useTaskStore.getState().addTask('给客户写周报');
      await useTaskStore.getState().addTask('买牛奶');
    });

    await mount();

    // ① 🔴 第二个入口必须不存在（判据圈在**顶栏**，不是整页 ——
    //    管理后台的用户表自己有一个 `input[type="search"]` 筛选，那是另一个面，
    //    不该被这条断言管；整页判"不存在"迟早会因它红一次并报个假故障）。
    expect(
      container!.querySelector('.ht-search__input'),
      '顶栏的内联搜索框已删除 —— 一个应用只有一个搜索入口',
    ).toBeNull();
    expect(
      container!.querySelector('.ht-header input'),
      '顶栏里不该再有输入框 —— 搜索的唯一入口是 rail 上那个按钮',
    ).toBeNull();

    // ② 唯一入口在 rail 上。
    const searchTab = [...container!.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
      (b) => b.textContent?.trim() === '搜索',
    );
    expect(searchTab, 'rail 上没有「搜索」—— 那这个功能就没有入口了').toBeDefined();
    await act(async () => {
      searchTab!.click();
    });

    const surface = container!.querySelector<HTMLElement>('[data-testid="search-overlay-surface"]');
    expect(surface, '点 rail 的「搜索」应当打开浮层').not.toBeNull();

    // ③ 打字 → 浮层里只剩命中那条。
    const box = surface!.querySelector<HTMLInputElement>('[data-testid="search-panel-input"]');
    expect(box, '浮层里没有输入框 —— `SearchPanel` 的接线断了').not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(box!, '周报');
      box!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const shown = titles(surface!);
    expect(shown, '搜索应当只留下命中那条').toEqual(['给客户写周报']);
    expect(shown, '不命中的那条要消失').not.toContain('买牛奶');

    // 🔴 上面那条为什么必须圈在浮层里，这里就是答案：整页数出来是 **3** 条
    //   （下面 2 条一条没少 + 浮层里 1 条命中）。谁把搜索改回"收窄当前列表"，
    //   这个数字就会变 —— 它是"非模态"这条 IA 的可执行表述，不是仪式。
    expect(
      titles(container!).length,
      '下面那一屏没被搜索改写（2 条）+ 浮层里 1 条命中 ⇒ 整页 3 条',
    ).toBe(3);

    // ④ 🔴 关掉之后，下面那一屏**从来没被搜索改写过**。
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await Promise.resolve();
    });
    expect(
      container!.querySelector('[data-testid="search-overlay-surface"]'),
      'Esc 之后浮层应当关掉',
    ).toBeNull();
    expect(
      titles(container!).length,
      '搜索不该收窄下面的列表 —— 它是浮层，不是当前视图的筛选',
    ).toBe(2);
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

    // 侧栏里那个标签必须是**可点**的。
    // ⚠️ 这里以前是「找 `textContent === '工作'` 的 button」—— 标签行现在多了一个
    // 计数（滴答参照图：侧栏每行右侧都有数字），行的文本变成「工作1」，那个写法
    // 就再也找不到它了。**按文本内容找可点元素本来就脆**（名字是用户自己起的，
    // 计数、图标、徽标都可能改它），共享组件已经给了稳定锚点，就用它。
    const tagButton = container!.querySelector<HTMLElement>(`[data-testid="tag-${tagId}-select"]`);
    expect(
      tagButton,
      '侧栏的标签名不可点 —— `{kind:\'tag\'}` 的判据在共享层，但没人能切过去',
    ).not.toBeNull();
    // 计数位真的出现在**接好线的整棵树**里（不只是 `ProjectsPanel` 单测的隔离环境）。
    expect(container!.querySelector(`[data-testid="tag-${tagId}-count"]`)?.textContent).toBe('1');

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

  /**
   * 把待处理的写入冲干净。
   *
   * 🔴 不是仪式。`CaptureComposer` 的提交按钮**不 await** `onSubmit` 的 promise
   * （用户按回车不该被写库阻塞），而一条 op 落库要过好几个 await。
   * 不冲干净就读 store，读到的是"还没写进去"，而报出来的断言失败长得
   * **像字段被丢了** —— 实测就是被它带偏了一次（去查了 reducer）。
   * 更糟的是：那条在途 promise 会在下一条用例 `freshDb()` 换掉引擎之后才落地，
   * 变成一条指向别的用例的 unhandled rejection。
   */
  async function flush(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  /**
   * 🔴 在某个清单里新建的任务必须**留在这个清单里**。
   *
   * 这一条钉的是"每一段都绿、接起来断"的第 N 次：`addTask` 一直支持
   * `projectId`（`NewTaskFields` 里就有）、侧栏一直能切到 `{kind:'project'}`、
   * `filterTasks` 也一直按 `projectId` 筛 —— 三个零件各有测试。缺的是
   * **捕获框提交时没带那个字段**，于是「在『家庭装修』里回车」建出来的任务
   * 落进收集箱，从刚显示过的列表里消失。界面上没有任何一处说过这件事。
   *
   * 所以这里同时钉两面：**写进去**（真 `projectId`）与**说得出**（占位符点名落点）。
   * 只钉其中一面，另一面可以漂走而全绿。
   */
  it('🔴 停在某个清单时，新建的任务留在该清单，且占位符点名落点', async () => {
    await freshDb();
    await act(async () => {
      await useProjectStore.getState().addProject('家庭装修');
    });
    const projectId = useProjectStore.getState().projects[0]?.id;
    expect(projectId, '清单没建出来').toBeDefined();

    await mount();

    // 真的**点侧栏**切过去（不是往 store 里塞一个 filter —— 那样测不到接线）。
    // ⚠️ 侧栏的清单行是共享 `OrganizerList` 的 `Pressable`（RNW → 带
    // `aria-label` 的角色节点），不是 `button.ht-nav__item` —— 上面那条
    // 标签用例能按 `<button>` 文本命中，是因为它命中的是**任务行上的标签 chip**。
    const listEntry = container!.querySelector<HTMLElement>(
      '[data-testid$="-select"][aria-label="家庭装修"]',
    );
    expect(listEntry, '侧栏里点不到那条清单').not.toBeNull();
    await act(async () => {
      listEntry!.click();
    });

    // ① 占位符点名落点。用户按回车前就该看见"这条会去哪儿"。
    const input = container!.querySelector<HTMLElement>('[data-testid="capture-input"]')!;
    expect(input.getAttribute('placeholder')).toContain('家庭装修');

    // ② 🔴 **从界面里**提交（不是往 store 直接调 `addTask` —— 那绕开了
    // 真正坏掉的那一步：`CaptureComposer` 的 `onSubmit` 没带 `projectId`，
    // 而 `addTask` 一直支持它，直接调 store 永远测不出来）。
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, '买两桶漆');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submitButton = container!.querySelector<HTMLElement>('[data-testid="capture-submit"]')!;
    await act(async () => {
      submitButton.click();
      await flush();
    });

    // 写进去：落点真的是这条清单
    const created = Object.values(useTaskStore.getState().entities.tasks).find(
      (t) => t.title === '买两桶漆',
    );
    expect(created?.projectId, '任务没落进当前清单').toBe(projectId);
    // 而且它出现在眼前这条列表里（不是"写对了但看不见了"）
    expect(titles(container!)).toContain('买两桶漆');
  });

  it('🔴 停在收集箱时不点名落点、也不带 projectId（别把默认值写成某个清单）', async () => {
    await freshDb();
    await act(async () => {
      await useProjectStore.getState().addProject('家庭装修');
    });

    await mount();

    const input = container!.querySelector<HTMLElement>('[data-testid="capture-input"]')!;
    expect(
      input.getAttribute('placeholder'),
      '收集箱里没有"某个清单"可点名，占位符不该出现「到『…』」',
    ).not.toContain('家庭装修');

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, '买牛奶');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container!.querySelector<HTMLElement>('[data-testid="capture-submit"]')!.click();
      await flush();
    });

    const created = Object.values(useTaskStore.getState().entities.tasks).find(
      (t) => t.title === '买牛奶',
    );
    expect(created?.projectId, '收集箱建的任务不该被塞进任何清单').toBeUndefined();
  });

  /**
   * 🔴 抽取的收尾动作是**删掉旧的那份**（AGENTS §3.5）。
   *
   * 归属进了共享元信息槽之后，`TaskOrganizer` 上那枚**常驻**的清单 chip
   * 就成了同一个信息在**同一行里出现两遍**。上面两条用例证明不了这件事 ——
   * 它们各看一个位置；只有**整行**能。
   *
   * ⚠️ 统计范围是"行上**常驻可见**的那部分"：整理面板（`<details>` 里那个清单
   * `<select>`）本来就要把每条清单列一遍，那是**控件的选项**，不是界面上的
   * 第二份归属。把它算进来会让这条判据对正确的实现报红 —— 而"失败得不对"
   * 的判据和没有判据一样糟。
   */
  it('🔴 行上常驻可见的部分里，归属只出现一次', async () => {
    await freshDb();
    await act(async () => {
      await useProjectStore.getState().addProject('家庭装修');
    });
    const projectId = useProjectStore.getState().projects[0]?.id;
    expect(projectId, '清单没建出来').toBeDefined();
    await act(async () => {
      await useTaskStore.getState().addTask('买两桶漆', { projectId });
      await useTaskStore.getState().addTask('买牛奶');
    });

    await mount();

    const visible = (title: string): string => {
      const rows = [...container!.querySelectorAll<HTMLElement>('[data-testid^="task-item-"]')];
      const row = rows.find((el) => titles(el).includes(title));
      expect(row, `没有渲染出「${title}」这一行`).toBeDefined();
      const clone = row!.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('details').forEach((d) => d.remove());
      return clone.textContent ?? '';
    };

    const count = (text: string, needle: string): number => text.split(needle).length - 1;

    expect(
      count(visible('买两桶漆'), '家庭装修'),
      '「家庭装修」在行上出现了不止一次 —— 归属有两份显示',
    ).toBe(1);
    expect(
      count(visible('买牛奶'), '收集箱'),
      '「收集箱」在行上出现了不止一次',
    ).toBe(1);
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
    // 设置收进了头像菜单（见 `openSettingsViaAvatar`）。
    await openSettingsViaAvatar(container!);

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

  /**
   * 🔴 从滴答清单导入（B2-1）的**接线断言**。
   *
   * 与上面那条同一条判据：`TickTickImportPanel` 自己的 5 条测试再全，
   * 把它从 `App.tsx` 的 settings 分支里删掉，它们**一个都不会红** ——
   * 而用户就再也找不到这个入口。"零件齐、最后一米没接"是本仓库最高发的形状，
   * 所以入口的有无必须由**整个 App** 来答。
   */
  it('🔴 设置页里真的有「从滴答清单导入」入口（不是只有一个孤立的面板组件）', async () => {
    await openSettings();
    expect(
      container!.querySelector('[data-testid="ticktick-import-panel"]'),
      '设置页里缺少从滴答清单导入的入口 —— B2-1 的逻辑层因此没有调用点',
    ).not.toBeNull();
  });
});


/**
 * 挂载 `<App />`（用**线上同一个** `LocaleHost`，与上面几条用例一致）。
 *
 * ⚠️ 抽成辅助只是为了下面那一组 IA 断言不用把 6 行样板抄四遍；
 * 挂载方式与上面**逐字相同**，没有第二份接线。
 */
/**
 * 经**头像菜单**进设置页。
 *
 * 🔴 2026-09-29 起「设置」**不在 rail 上**了 —— 它收进了左侧顶部的头像
 *（滴答的做法：rail 是每天点几十次的地方，设置是低频的）。
 * 所以任何"去设置页"的测试都必须走这条路，而不是找 `role=tab` 里那个「设置」。
 */
async function mountApp(): Promise<{ container: HTMLDivElement }> {
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
  return { container };
}

/**
 * 信息架构：视图在 rail、范围在 sidebar、顶栏只放标题与动作
 * ===========================================================
 *
 * 🔴 这一组钉的是 2026-09-29 那次 IA 改动（`dida-view-unification.md` §4.4），
 * 而它防的是一类**具体且已经发生过**的退化：
 *
 *   1. **视图 tab 被搬回顶栏**。搬回去的直接后果是可测的：
 *      `showcase-fidelity-audit.md` §6.3 实测 1280px 下 8 个 tab 只完全可见 5 个
 *      （现在有 9 个）。顶栏是**水平**的，可见宽度有上界；rail 是竖的，没有。
 *   2. **sidebar 在所有视图都画出来**。它只该出现在**有范围的视图**里
 *      （目前只有「任务」）—— 滴答也是这样：四象限/日历/习惯视图里侧栏直接消失。
 *      全都画出来的症状是"每个视图左边都挂着一列跟它无关的东西"。
 *   3. **「四象限」再次变成两个东西**（视图 + 任务筛选）—— 见下面那条断言。
 */
describe('信息架构：rail / sidebar / header 的分工', () => {
  it('🔴 视图 tab 在 **rail** 里，而**顶栏里一个都没有**', async () => {
    const { container } = await mountApp();

    const rail = container.querySelector('.ht-rail');
    expect(rail, '没有 rail').not.toBeNull();
    // 🔴 **默认 7 个 `role=tab`** = 6 个视图（任务/搜索/日历/四象限/习惯/时间线）+ 1 个工具（回收站）。
    // 「搜索」是**常驻**的（不是功能模块，不给关）—— ⚠️ 它在 DOM 里排在那 5 个之后，
    // 所以下面只数个数；顺序由 e2e 的 `TABS` 逐字钉住。
    // 不是 10 —— 10 是"所有功能模块都打开"时才有的数量（见 `shell/modules.ts`）。
    //
    // ⚠️ **「设置」与「帮助」都不在这个数里**：
    //   · 设置收进了**头像菜单**（滴答的做法）；
    //   · 帮助是**动作**（它切到设置页），而动作**不该是 `role=tab`** ——
    //     `role=tab` 的元素必须是"切视图"那一类。
    // 两者都在 rail 上，只是不是 tab。
    // 🔴 **逐字对标签**，不只是数个数。
    //
    // ⚠️ 这一条原本**只数个数**，于是「搜索」被我**硬编码**进 JSX 时它照样绿 ——
    // 而那道改动同时让 `apps/landing` 的外壳对账（读的是 `App.tsx` 的常量数组）
    // 也照样绿。**两条判据都没看见多出来的那个按钮**，是人工比对才发现的。
    // 把期望写死在这里，是成本最低、又能真正盖住"有人在 rail 上顺手加了个按钮"
    // 这一失效模式的做法。
    //
    // 默认 = 5 个模块视图（任务/日历/四象限/习惯/时间线，顺序同 `MODULE_VIEW_TABS`）
    //        + 常驻的「搜索」（排在上段最后）+ 下段工具「回收站」。
    const railLabels = [...rail!.querySelectorAll('button[role="tab"]')].map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(railLabels, '默认 rail 的标签与顺序').toEqual([
      '任务',
      '日历',
      '四象限',
      '习惯',
      '时间线',
      '搜索',
      '回收站',
    ]);

    const header = container.querySelector('.ht-header');
    expect(header, '没有 header').not.toBeNull();
    expect(
      header!.querySelectorAll('button[role="tab"]').length,
      '顶栏里又出现了视图 tab —— 它们在窄屏上装不下（见这条测试的文件头）',
    ).toBe(0);
  });

  it('🔴 「任务」视图有 sidebar（收集箱/今天/已完成…）', async () => {
    const { container } = await mountApp();
    const sidebar = container.querySelector('.ht-sidebar');
    expect(sidebar, '任务视图应当有范围列').not.toBeNull();
    expect(sidebar!.textContent ?? '').toContain('收集箱');
  });

  it('🔴 没有范围的视图（设置）**不画 sidebar**', async () => {
    const { container } = await mountApp();
    await openSettingsViaAvatar(container);

    expect(
      container.querySelector('.ht-sidebar'),
      '设置视图不该有范围列 —— 那列东西与它无关',
    ).toBeNull();
  });

  it('侧栏那一节叫「四象限」，且四个象限都在（产品负责人 2026-09-29 定的名字）', async () => {
    const { container } = await mountApp();
    const sidebar = container.querySelector('.ht-sidebar');
    const text = sidebar!.textContent ?? '';
    // 🔴 名字就应该是「四象限」—— 侧栏列的就是那四个象限，名字直说。
    //
    // ⚠️ 我一度改成「按象限筛选」（理由是它与 rail 里的**四象限视图**同名，
    //    而点它其实会 `setView('tasks')`）。产品负责人否掉了那个改法：
    //    **同名冲突是真的，但解法不是把用户认得的词从侧栏拿掉。**
    expect(text, '侧栏那节应当叫「四象限」').toContain('四象限');
    for (const q of ['重要且紧急', '重要不紧急', '紧急不重要', '不重要不紧急']) {
      expect(text, `缺少象限「${q}」`).toContain(q);
    }
  });
});

/**
 * 功能模块开关：**关掉的模块从 rail 上消失**
 * =============================================
 *
 * 🔴 产品负责人 2026-09-29：「左边的侧边栏那个按钮应该尽可能地减少」+
 * 看完滴答设置页后「就是这样子的自定义也可以」。这一组钉的就是后半句 ——
 * 默认少（上面那条已经钉住），**而且用户能自己再关**。
 *
 * ⚠️ 判据是 **DOM 里有几个 `button[role=tab]`**，不是"有没有被 CSS 藏起来"。
 * 两者的差别是屏幕阅读器还念不念它、Tab 键还停不停在它上面 ——
 * 而"视觉上没了、键盘还能摸到"正是最容易被当成"已经删掉"的假象。
 */
describe('功能模块：关掉的模块从 rail 消失', () => {
  const railTabLabels = (el: HTMLElement): string[] =>
    [...el.querySelectorAll('.ht-rail button[role="tab"]')].map((b) => b.textContent?.trim() ?? '');

  /** 开/关一个模块（设置页里的那个 checkbox）。 */
  async function toggleModule(el: HTMLElement, key: string): Promise<void> {
    await openSettingsViaAvatar(el);
    const box = el.querySelector<HTMLInputElement>(`[data-testid="feature-modules-${key}"]`);
    expect(box, `设置页里没有 ${key} 的开关`).not.toBeNull();
    await act(async () => {
      box!.click();
    });
  }

  it('默认开着「四象限」，可以关掉 —— 关掉之后 rail 上就没有它了', async () => {
    const { container } = await mountApp();
    expect(railTabLabels(container), '四象限默认应当是开的').toContain('四象限');

    await toggleModule(container, 'quadrant');

    expect(railTabLabels(container), '关掉之后 rail 上不该还有四象限').not.toContain('四象限');
  });

  it('默认关着「番茄钟」，可以打开 —— 打开之后 rail 上出现它', async () => {
    const { container } = await mountApp();
    expect(railTabLabels(container), '番茄钟默认应当是关的').not.toContain('番茄钟');

    await toggleModule(container, 'focus');

    expect(railTabLabels(container), '打开之后 rail 上应当出现番茄钟').toContain('番茄钟');
  });

  it('🔴 「任务」「回收站」「设置」**不给关**（它们不是功能模块）', async () => {
    const { container } = await mountApp();
    await openSettingsViaAvatar(container);
    for (const key of ['tasks', 'trash', 'settings']) {
      expect(
        container.querySelector(`[data-testid="feature-modules-${key}"]`),
        `${key} 不该出现在功能模块的开关里`,
      ).toBeNull();
    }
  });

  it('🔴 开关写进了设备本地偏好（重开还在）', async () => {
    const { container } = await mountApp();
    await toggleModule(container, 'quadrant');
    // 存的是**显式覆盖**，不是整个集合（见 modules.ts 的说明）。
    const raw = localStorage.getItem('heyta.shell.modules');
    expect(raw, '开关没有落盘').not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({ quadrant: false });
  });
});
