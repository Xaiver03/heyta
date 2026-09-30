/**
 * 全局搜索 —— **"我记得写过一句话，在哪？"**
 * ==============================================
 *
 * ## 这个文件防的是什么
 *
 * 2026-09-29 实测：两端**都有**搜索，但都是"当前列表的内联筛选"
 *（web 顶栏那个输入框、mobile 任务页那个输入框），共用 `@heyta/domain` 的 `searchTasks`。
 * 而 **便签完全没有搜索入口** —— `NotesView` / `NotesBoard` 里一个 `query` 都没有。
 *
 * ⇒ 所以这一组里**最重要的一条是"便签能被搜到"**，而不是"任务能被搜到"
 *（后者顶栏那个输入框早就能做）。那条断言如果写成"搜到了一条任务"，
 * 在"便签搜索根本没接"时**照样绿** —— 那正是本仓反复记的假通过。
 *
 * ## 判据都是渲染出来的东西
 *
 * 不看 `searchNotes` 有没有被调用（那是实现细节），看**结果区里有没有那行文本**。
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

beforeEach(async () => {
  __resetOpLogForTests();
  localStorage.clear();
  dbName = `search-panel-${Math.random().toString(36).slice(2)}`;
  await initOpLog(dbName);
});

afterEach(() => {
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
});
