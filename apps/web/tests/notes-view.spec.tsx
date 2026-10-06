/**
 * 便签视图
 * ==========
 *
 * 🔴 这个文件钉的是**幻觉 #12「笔记模块」**的最后一米：`NOTE` 已建模、
 * 桶存在、能被导出、op 能同步 —— 但没有任何界面能建它。
 *
 * 补上之后要保证的三件事：
 *   1. **空态来自共享层**（`labels.empty` = `notes.empty`），视图里不许
 *      再手写一句"还没有便签"；
 *   2. **输入 + 点「添加便签」真的落进 op-log**（物化状态里多出一条 `notes`），
 *      不是只改了本地数组；
 *   3. **删除之后它从列表里消失**（软删除，不是只从 DOM 里拿掉）。
 *
 * 用的是**真的 op-log 与真的 store**（`fake-indexeddb`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 等的是**条件**，不是固定 tick（这里 flake 过一次，记下来）
 *
 * 界面里的回调是 `void store.addNote(...)`（fire-and-forget），而真正的落盘要
 * 穿过 `dispatch → op-log 引擎 → IndexedDB → notify → refresh` 好几段微/宏任务。
 * 第一版用"两个 `setTimeout(0)`"来等：**空载时刚好够，全量并行跑时不够** ——
 * 表现为断言读到旧状态、随机变红（比没有测试更糟）。
 * 现在改成轮询条件成立 + 超时（照 `motivation-view.spec.tsx` 的既有手法）。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyState } from '@heyta/op-log';
import { I18nProvider, zhCN } from '@heyta/i18n';

import { selection } from '../src/lib/selection.js';
import { __resetOpLogForTests, initOpLog, useTaskStore } from '../src/features/tasks/store.js';
import { useNoteStore } from '../src/features/notes/store.js';

const { NotesView } = await import('../src/features/notes/NotesView.js');

let dbName: string;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(async () => {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof IDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;

  dbName = `notes-test-${Math.random().toString(36).slice(2)}`;
  __resetOpLogForTests();
  useTaskStore.setState({
    entities: emptyState(),
    filter: { kind: 'all' },
    now: Date.now(),
    ready: false,
  });
  useNoteStore.setState({ notes: [], error: undefined });
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

/** 挂一个**真的接在 store 上**的便签视图。 */
async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <I18nProvider locale="zh-CN">
        {/* `editorInColumn={false}` = 编辑卡留在板子上方（窄屏/收起那一档）。
            本文件的用例找的是**板子上方**那枚编辑器，所以取这一支；
            "看得见时进详情列"由 `note-editor-placement.spec.tsx` 判。 */}
        <NotesView editorInColumn={false} />
      </I18nProvider>,
    );
  });
  return container;
}

function byTestId(view: HTMLElement, testId: string): HTMLElement | null {
  return view.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * 轮询等到条件成立。超时带现场 —— 否则失败信息只有"等超时了"。
 *
 * 🔴 默认 2s **必须小于 vitest 的单测超时（5s）**。等同时，超时会在
 * `await act(...)` 中途被强制掐断 —— 那个 act 永远不结算，下一条用例
 * 就会撞上 "overlapping act() calls" 并渲染出**空 DOM**，
 * 表现为一串与被测行为毫无关系的失败（实测踩过）。
 */
async function waitFor(label: string, cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await flush();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(
    `等待「${label}」超时\n当前界面文本：\n${(container?.textContent ?? '').slice(0, 600)}`,
  );
}

/**
 * 往 RNW 的 `TextInput`（渲染成 `<input>`）里打字。
 *
 * 🔴 受控输入必须走原生 value setter + `input` 事件：直接改 `el.value`
 * React 收不到变更（记在 `note-editor.spec.tsx` 的同类做法里）。
 */
function type(view: HTMLElement, value: string): void {
  const input = byTestId(view, 'notes-input') as HTMLInputElement | null;
  expect(input, '便签输入框没渲染出来').not.toBeNull();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(view: HTMLElement, testId: string): void {
  const button = byTestId(view, testId);
  expect(button, `找不到按钮 ${testId}`).not.toBeNull();
  act(() => {
    button!.click();
  });
}

describe('便签视图', () => {
  it('🔴 空态文案来自 `notes.empty`（不是视图手写的第二份）', async () => {
    const view = await mount();
    expect(byTestId(view, 'notes-empty')?.textContent ?? '').toContain(zhCN['notes.empty']);
    expect(useNoteStore.getState().notes).toHaveLength(0);
  });

  it('🔴 输入内容 + 点「添加便签」→ 状态里多出一条 `NOTE`', async () => {
    const view = await mount();
    type(view, '把书还了');
    click(view, 'notes-submit');

    // 等**条件**（真的落盘 + refresh），不等固定 tick —— 见文件头。
    await waitFor('便签写进 store', () => useNoteStore.getState().notes.length === 1);
    await waitFor(
      '便签渲染进列表',
      () => (byTestId(view, 'notes-list')?.textContent ?? '').includes('把书还了'),
    );

    const notes = useNoteStore.getState().notes;
    expect(notes[0]?.content).toBe('把书还了');

    // 物化状态里也是同一条 —— 证明真的走了 op-log，不是只改了 store 数组。
    const materialized = Object.values(useTaskStore.getState().entities.notes);
    expect(materialized).toHaveLength(1);
    expect(materialized[0]?.content).toBe('把书还了');

    // 空态退场。
    expect(byTestId(view, 'notes-empty')).toBeNull();
  });

  it('🔴 点删除 → 那条便签消失（软删除，不是只从 DOM 拿掉）', async () => {
    const view = await mount();
    type(view, '把书还了');
    click(view, 'notes-submit');
    await waitFor('便签写进 store', () => useNoteStore.getState().notes.length === 1);

    const noteId = useNoteStore.getState().notes[0]?.id;
    expect(noteId).toBeDefined();
    click(view, `note-remove-${String(noteId)}`);

    await waitFor('便签从 store 消失', () => useNoteStore.getState().notes.length === 0);
    await waitFor('空态回来', () => byTestId(view, 'notes-empty') !== null);

    // 墓碑还在（软删除）：实体没有消失，只是 `deletedAt` 被写上。
    expect(useTaskStore.getState().entities.notes[noteId!]?.deletedAt).toBeDefined();
  });
});

/**
 * 便签这一类：**"正在编辑哪一条"就是选中**（工单 W1）。
 *
 * 这三条各钉一个此前没有任何一层会失败的空洞：
 *
 * 1. **从别处写进选中 ⇒ 视图打开那一条**。搜索面板点便签时只能把 id 交进选中态
 *    （它没有别的通道），而 `openNoteFromSearch` 此前**签名里不收 id** ——
 *    用户看到的是"视图换了、什么都没打开"。这条不挂搜索，挂的是它唯一的后果：
 *    选中里有 id，界面就必须显示出**那一条**。
 * 2. **关掉面板 = 取消选中**，不是"本地 state 清零"（否则下一个视图读不到收起了）。
 * 3. **实体没了面板自己关**。这条量的是视图侧的回落（`notes.find()` 落空 ⇒ 不渲染
 *    编辑器）—— 只测 `pruneSelection` 那一层证不了界面读的是同一条规则。
 */
describe('便签：正在编辑哪一条 = 选中的那一条', () => {
  afterEach(() => {
    // 🔴 选中态是模块级单例：不清就把这一组的选中带进下一组，
    //    而"一进来就开着面板"在断言里长得和正常情况一模一样。
    selection.clear();
  });

  /** 用真 store 落一条便签，返回它的 id（等条件，不等固定 tick —— 见文件头）。 */
  async function seedNote(content: string): Promise<string> {
    await act(async () => {
      await useNoteStore.getState().addNote(content);
    });
    await waitFor(`便签「${content}」落进 store`, () => useNoteStore.getState().notes.length > 0);
    const id = useNoteStore.getState().notes[0]?.id;
    expect(id, '便签没落库').toBeDefined();
    return String(id);
  }

  it('🔴 选中里有一条便签 ⇒ 挂上视图就打开**那一条**的编辑器', async () => {
    const id = await seedNote('把书还了');
    selection.select('note', id);

    const view = await mount();
    const input = byTestId(view, 'notes-editor-input') as HTMLInputElement | null;
    expect(input, '选中了一条便签，视图却没打开编辑面板').not.toBeNull();
    expect(input?.value).toContain('把书还了');
    expect(selection.get('note')).toBe(id);
  });

  it('点「取消」⇒ 面板关掉，而且清空的是**选中**', async () => {
    const id = await seedNote('买牛奶');
    const view = await mount();
    click(view, `note-edit-${id}`);
    await waitFor('编辑面板出现', () => byTestId(view, 'notes-editor') !== null);

    click(view, 'notes-editor-cancel');
    await waitFor('编辑面板关闭', () => byTestId(view, 'notes-editor') === null);
    expect(selection.get('note'), '面板关了但选中还留着 —— 下一个读选中的界面会以为仍在编辑').toBeNull();
  });

  it('🔴 选中的那条在别处没了 ⇒ 面板自己关，不留指向空 id 的输入框', async () => {
    const id = await seedNote('另一端会删掉的一条');
    const view = await mount();
    click(view, `note-edit-${id}`);
    await waitFor('编辑面板出现', () => byTestId(view, 'notes-editor') !== null);

    // 模拟"另一台设备同步过来的墓碑"：列表里没有它了，而选中里还留着 id。
    await act(async () => {
      useNoteStore.setState({ notes: [] });
    });
    await waitFor('面板随实体消失而关', () => byTestId(view, 'notes-editor') === null);
    expect(view.textContent ?? '').not.toContain('另一端会删掉的一条');
  });
});
