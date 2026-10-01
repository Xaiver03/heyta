/**
 * 全局搜索 —— **"我记得写过一句话，在哪？"**
 * ==============================================
 *
 * ## 这个文件防的是什么
 *
 * 2026-09-29 的实测起点：两端**都有**搜索，但都是"当前列表的内联筛选"
 *（web 顶栏那个输入框、mobile 任务页那个输入框），共用 `@heyta/domain` 的 `searchTasks`。
 * 而 **便签完全没有搜索入口** —— `NotesView` / `NotesBoard` 里一个 `query` 都没有。
 *
 * ⇒ 所以这一组里**最重要的一条是"便签能被搜到"**，而不是"任务能被搜到"
 *（后者当时顶栏那个输入框就能做）。那条断言如果写成"搜到了一条任务"，
 * 在"便签搜索根本没接"时**照样绿** —— 那正是本仓反复记的假通过。
 *
 * ## 2026-10-01：形态改成聚焦搜索，同屏只剩一个搜索框
 *
 * 顶栏那个内联框**已删除**（一个应用只有一个搜索入口：rail 上的「搜索」/ ⌘K），
 * 面板改成 macOS 聚焦搜索的形态。于是这一组同时管两件事：
 * **搜得到什么**（便签 / 任务 / AND 语义 / 两种空）与
 * **键盘怎么用**（⌘K、↑↓、↵、快速跳转）。
 *
 * ⚠️ 键盘那几条**只钉得住"接线在不在"**：jsdom 里往 window 派发 keydown 时
 * 捕获与冒泡两个阶段都收得到，所以它证不了"宿主挂**捕获**才赢得过输入框的
 * `stopPropagation()`"（§7 第 80 条）。那半边只有真浏览器能证
 * —— `e2e/tests/search-overlay.spec.ts`。
 *
 * ## 判据都是渲染出来的东西
 *
 * 不看 `searchNotes` 有没有被调用（那是实现细节），看**结果区里有没有那行文本**，
 * 看**光标那一行有没有被滚进视野**（滚动在这里是可观察的效果，比"高亮"断言得动）。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { useNoteStore } = await import('../src/features/notes/store.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;
/** 🔴 每个用例一个独立库名（共享默认库名会让上一个用例的数据漏进来）。 */
let dbName: string;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * 等**一帧**。
 *
 * 🔴 jsdom 的 `requestAnimationFrame` 是一个 ~16ms 的计时器，上面那个 `flush()`
 * 里的 `setTimeout(0)` **覆盖不到它** —— 而 ↵ 打开任务之后的那次滚动正是挂在 rAF 里的
 *（`App.tsx`：这一帧 React 还没把新筛选下的行画出来，滚早了找不到行）。
 * 不等这一帧的话，判据看到的是"没滚"，而实际是"还没轮到它滚" —— 假红。
 */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
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
  await flush();
}

/** 切到搜索视图（rail 上的 `role=tab`）。 */
async function openSearch(): Promise<void> {
  const tab = [...(container?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') ?? [])].find(
    (b) => b.textContent?.trim() === '搜索',
  );
  expect(tab, 'rail 上找不到「搜索」—— 这个入口就不存在').toBeDefined();
  await act(async () => {
    tab!.click();
  });
  await flush();
}

/**
 * 往搜索框里打字。
 *
 * 🔴 直接 `input.value = '…'` + 派发 `input` 事件**不会**触发 React 的 `onChange` ——
 * 必须用原型上的原生 value setter（React 覆写了实例上的那个）。这是本仓已经踩过一次
 * 的坑（见 `apps/web/tests` 里别处同样的写法）。
 */
async function type(text: string): Promise<void> {
  const input = container!.querySelector<HTMLInputElement>('[data-testid="search-panel-input"]');
  expect(input, '搜索面板里没有输入框').not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(input, text);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

function panelText(): string {
  return container!.querySelector('[data-testid="search-panel"]')?.textContent ?? '';
}

/**
 * 按一个键。
 *
 * ⚠️ 这里是**派发到 window**，而宿主把监听挂在 window 的**捕获阶段** ——
 * jsdom 里两种阶段在 window 上都收得到，所以这一组只钉**接线在不在**
 *（监听有没有挂、分派对不对），钉不了"捕获赢过输入框的 `stopPropagation()`"。
 * 后者只有真浏览器能证：`e2e/tests/search-overlay.spec.ts`。
 */
async function press(key: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
    await Promise.resolve();
  });
  await flush();
}

/** rail 上当前选中的那个 tab 的名字。 */
function selectedTab(): string | undefined {
  return [...container!.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
    (b) => b.getAttribute('aria-selected') === 'true',
  )?.textContent?.trim();
}

/**
 * jsdom **没有实现** `Element.prototype.scrollIntoView`（浏览器专有）。
 *
 * 宿主在两处要滚动：光标落在某条结果上时把它滚进面板视野（`App.tsx` 里那个
 * effect），以及 ↵ 打开任务后把列表里那一行滚到中间。不补的话测试不是"断言失败"
 * 而是**崩在 effect 里**（`scrollIntoView is not a function`），报错指不到产品行为。
 *
 * 🔴 补在**测试这边**，不是把宿主代码改成 `?.scrollIntoView?.()`：
 * 真浏览器里这个方法一定存在，加可选调用是**为不存在的场景写兜底**，
 * 而且会把"到底滚没滚"变成永远看不出。（`features/settings/AiSettings.tsx`
 * 里那种可选调用有它自己的理由 —— 它断言的是 `data-focused`，不是滚动。）
 *
 * 这里顺手把它做成**带归属的记录器**：面板里的任务行与下面列表里的行
 * **共用同一个** `data-testid="task-item-<id>"`（浮层是非模态的，下层继续渲染），
 * 所以光记 testid 分不出"滚的是面板里那条"还是"滚的是列表里那条" ——
 * 而 ↵ 那条判据要的正是后者（"打开=切回列表并把它滚进视野"）。
 * 于是每条记录加上它当时属于哪一屏。
 */
const scrolledTo: string[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;

/** `panel:<testid>` = 浮层里那一行；`list:<testid>` = 下面那一屏的那一行。 */
function recordScroll(el: Element): string {
  const testID = el.getAttribute('data-testid') ?? el.tagName;
  return `${el.closest('[data-testid="search-panel"]') ? 'panel' : 'list'}:${testID}`;
}

beforeEach(async () => {
  scrolledTo.length = 0;
  Element.prototype.scrollIntoView = function (this: Element): void {
    scrolledTo.push(recordScroll(this));
  };
  __resetOpLogForTests();
  localStorage.clear();
  dbName = `search-panel-${Math.random().toString(36).slice(2)}`;
  await initOpLog(dbName);
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('全局搜索', () => {
  it('🔴 rail 上有「搜索」，点了真的渲染出面板', async () => {
    await mount();
    await openSearch();
    expect(container!.querySelector('[data-testid="search-panel"]'), '没有渲染出搜索面板')
      .not.toBeNull();
  });

  it('🔴 **便签能被搜到** —— 这是它补的那个缺口（顶栏那个输入框够不到便签）', async () => {
    await useNoteStore.getState().addNote('买咖啡豆的店在巷子尽头');
    await mount();
    await openSearch();

    // 搜之前：便签不该出现在结果里（还没输入）。
    expect(panelText()).not.toContain('买咖啡豆');

    await type('咖啡豆');

    expect(
      panelText(),
      `搜「咖啡豆」之后没找到那条便签。面板实际文本：${panelText().slice(0, 300)}`,
    ).toContain('买咖啡豆');
  });

  it('任务也能搜到，而且与便签**分组**列出（不是混成一堆）', async () => {
    await useTaskStore.getState().addTask('整理季度报告');
    await useNoteStore.getState().addNote('季度报告的素材在这个便签里');
    await mount();
    await openSearch();
    await type('季度报告');

    const panel = panelText();
    expect(panel, '没搜到任务').toContain('整理季度报告');
    expect(panel, '没搜到便签').toContain('素材在这个便签里');
    // 两个分组标题都在 —— 否则用户分不清哪条是任务、哪条是便签。
    expect(panel).toContain('任务');
    expect(panel).toContain('便签');
  });

  it('🔴「还没输入」与「没找到」是**两种不同的空**（文案不许合并）', async () => {
    await mount();
    await openSearch();

    const prompt = panelText();
    await type('一个绝对不存在的词xyzzy');
    const noResult = panelText();

    expect(noResult, '搜不到时不该还显示"还没输入"那句提示').not.toBe(prompt);
    // 两种状态各有自己的 testid —— 合并成一句会让用户以为库里真的什么都没有。
    expect(container!.querySelector('[data-testid="search-panel-prompt"]'), '输入后提示应当消失')
      .toBeNull();
    expect(container!.querySelector('[data-testid="search-panel-empty"]'), '应当显示"没找到"')
      .not.toBeNull();
  });

  it('🔴 多词是 **AND**（都要包含）—— "收窄"是这个框唯一说得通的语义', async () => {
    await useTaskStore.getState().addTask('写周报');
    await useTaskStore.getState().addTask('写月报');
    await mount();
    await openSearch();

    await type('写 周报');
    const panel = panelText();
    expect(panel, 'AND 没生效：搜「写 周报」时「写月报」不该出现').not.toContain('写月报');
    expect(panel).toContain('写周报');
  });

  it('清空输入之后回到「还没输入」，不会把整个库列出来', async () => {
    await useTaskStore.getState().addTask('一条会被列出来的任务');
    await mount();
    await openSearch();
    await type('一');
    expect(panelText()).toContain('一条会被列出来的任务');

    await type('');
    expect(panelText(), '清空后不该列出全部').not.toContain('一条会被列出来的任务');
    expect(container!.querySelector('[data-testid="search-panel-prompt"]')).not.toBeNull();
  });

  /**
   * 🔴 ⌘K 是**第二条入口**，而且它与点 rail 那个放大镜**同形**：
   * 开的时候不清查询词，关的时候走同一个 `closeSecondarySurface`（回到"从哪来"）。
   *
   * 为什么要钉"不清词"：Spotlight 的用法是「打开→看一眼→关掉→再打开」，
   * 每次关掉都清空的话，第二次就得重新打字 —— 那条快捷键就废了一半。
   * 变异：把 ⌘K 的打开分支写成 `goToView('search')` 之前先 `setSearchQuery('')` ⇒ 最后那条红。
   */
  it('🔴 ⌘K 开、⌘K 关；再开时查询词还在（两条入口同形）', async () => {
    await useTaskStore.getState().addTask('季度复盘的待办');
    await mount();

    expect(container!.querySelector('[data-testid="search-overlay-surface"]'), '初始不该开着')
      .toBeNull();

    await press('k', { metaKey: true });
    expect(
      container!.querySelector('[data-testid="search-overlay-surface"]'),
      '⌘K 没把浮层打开 —— 键盘用户找搜索的第一反应落空',
    ).not.toBeNull();

    await type('季度');
    await press('k', { metaKey: true });
    expect(
      container!.querySelector('[data-testid="search-overlay-surface"]'),
      '⌘K 应当也能关（与 Esc / 点 scrim 同一个出口）',
    ).toBeNull();
    expect(selectedTab(), '关掉之后要回到开搜索前那一屏').toBe('任务');

    await press('k', { metaKey: true });
    const input = container!.querySelector<HTMLInputElement>('[data-testid="search-panel-input"]');
    expect(input?.value, '重新打开时查询词被清空了 —— 两条入口不同形')
      .toBe('季度');
  });

  /**
   * 🔴 回车在两态下是**两件事**：光标还在输入框里 = 想接着打字（什么都不做）；
   * 光标落在某条结果上 = 打开它。
   *
   * 后半句同时钉住"↵ 与鼠标点共用同一条分派"：`openSearchEntry` 对任务是
   * "切回列表并关掉浮层"，写错的话要么浮层关不掉、要么直接把查询词当提交。
   *
   * 🔴 光"浮层关掉了 + 在任务视图"挡不住那条 2026-09-30 的旧 bug —— 当时这里
   * 只 `setView('tasks')` 就把 `taskId` 丢了，症状正是"点了没反应"（搜索是全库，
   * 列表可能停在「今天」，命中的那条压根不在屏幕上）。所以两条滚动判据各自钉一处
   * 调用：↓ 之后滚的是**面板里**那一行（`panel:`），↵ 之后滚的是**下面列表里**那一行
   * （`list:`）。两处的 `data-testid` 一模一样，靠记录器标的归属分开。
   */
  it('🔴 光标在输入框里时 ↵ 什么都不做；↓ 之后 ↵ 打开高亮那条并关掉浮层', async () => {
    await useTaskStore.getState().addTask('整理季度报告');
    await useTaskStore.getState().addTask('季度预算');
    await mount();
    await openSearch();
    await type('季度');
    expect(panelText(), '两条都该在结果里').toContain('整理季度报告');

    /**
     * 光标 ↓ 第一步会落在哪一条 = 面板任务区的第一行（`buildResultEntries` 的顺序
     * 与面板渲染的顺序同源，宿主不重新排）。必须在按之前就读到 —— ↵ 之后浮层就没了。
     */
    const targetId = container!
      .querySelector<HTMLElement>('[data-testid="search-panel-tasks"] [data-testid^="task-item-"]')
      ?.getAttribute('data-testid')
      ?.replace('task-item-', '');
    expect(targetId, '面板里没有任务行').toBeTruthy();

    await press('Enter');
    expect(
      container!.querySelector('[data-testid="search-overlay-surface"]'),
      '光标还没离开输入框，回车不该把浮层关掉（那是"提交"，不是"打开"）',
    ).not.toBeNull();
    expect(
      scrolledTo,
      `光标还在输入框里时不该滚动：${scrolledTo.join(' | ')}`,
    ).not.toContain(`panel:task-item-${targetId}`);

    await press('ArrowDown');
    expect(
      scrolledTo,
      `↓ 之后应当把高亮那一行滚进面板视野：${scrolledTo.join(' | ')}`,
    ).toContain(`panel:task-item-${targetId}`);

    await press('Enter');
    await nextFrame();
    expect(
      container!.querySelector('[data-testid="search-overlay-surface"]'),
      '↵ 打开任务之后浮层应当关掉',
    ).toBeNull();
    expect(selectedTab(), '打开任务要回到任务视图').toBe('任务');
    expect(
      scrolledTo,
      `↵ 之后应当把**列表里**那一行滚进视野（只切视图不滚 = "点了没反应"）：${scrolledTo.join(' | ')}`,
    ).toContain(`list:task-item-${targetId}`);
  });

  /**
   * 🔴「快速跳转」是**导航**不是搜索条件的联表匹配。
   *
   * `domain/search.ts` 文件头拒绝的是"在任务搜索里匹配清单名/标签名"，
   * 它给出的替代正是"想按清单找就点清单" —— 这一组就是那个"点"。
   * 变异：把跳转项的 `onSelect` 换成空操作 ⇒ 最后那条红（面板会关掉但视图不动，
   * 而"点了没反应"正是本仓反复登记的那类缺陷）。
   */
  it('「快速跳转」里点日历真的切到日历视图（它是导航，不是又一个筛选）', async () => {
    await mount();
    await openSearch();
    await type('calendar');

    expect(panelText(), '没有渲染「快速跳转」分组').toContain('快速跳转');
    const row = container!.querySelector<HTMLElement>(
      '[data-testid="search-panel-quick-view:calendar"]',
    );
    expect(row, '跳转项没有可寻址的行 —— 鼠标点不到它').not.toBeNull();

    await act(async () => {
      row!.click();
    });
    await flush();
    expect(container!.querySelector('[data-testid="calendar-board"]'), '点完没进日历').not.toBeNull();
    expect(
      container!.querySelector('[data-testid="search-overlay-surface"]'),
      '跳转之后浮层应当关掉',
    ).toBeNull();
  });

  /**
   * 键位提示芯片行：**只有 web 传 `keyHints`**。
   *
   * 共享层对没传的那一项**不渲染**（触屏端画「esc 关闭」是谎报能力），
   * 所以这条判据是双向的：宿主没给 ⇒ 面板上就没有；给了 ⇒ 三条都在。
   */
  it('底部键位提示有且只有三枚芯片（↑↓ / ↵ / esc）', async () => {
    await mount();
    await openSearch();

    const keys = container!.querySelector('[data-testid="search-panel-keys"]');
    expect(keys, '键盘端不显示键位提示，等于把这套快捷键藏起来').not.toBeNull();
    const chips = [...keys!.children].map((c) => c.textContent?.trim() ?? '');
    expect(chips.length, `键位芯片应当正好三枚：${chips.join(' | ')}`).toBe(3);
    expect(chips.join(' ')).toContain('esc');
  });
});
