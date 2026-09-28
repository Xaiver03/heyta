/**
 * 任务备注编辑
 * ==============
 *
 * 🔴 这个文件钉的是一处**真实空洞**：`Task.note` 存在、`setNote` 存在、
 * 导出与同步都覆盖它 —— 但 Web 上**没有任何用户输入框**，
 * `setNote` 的唯一调用点是 AI 拆解与 AI 估时。于是"我自己能不能在任务上写点东西"
 * 的答案是"不能"（见 `docs/research/dida365-feature-benchmark.md` §3 #4）。
 *
 * 补上之后要保证的四件事，缺一件这个功能就是假的：
 *   1. **真的写进 op-log** —— 只改本地 store 的字段的话，刷新就没了、也同步不出去；
 *   2. **清空 = 清除**（传 `undefined`，`app-host` 写成 `null`），不是留一个空串；
 *   3. **没改就不写 op** —— 否则"点开又点走"会给每个任务白写一条；
 *   4. **有备注时 chip 上看得见** —— 否则扫一眼列表不知道哪些任务写过东西。
 *
 * 用的是**真的 op-log 与真的 store**（`fake-indexeddb`），不是 mock：
 * 第 1 条只有真的落盘才验得了。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IndexedDbAdapter, IndexedDbOpLogStore } from '@heyta/storage';
import { emptyState } from '@heyta/op-log';
import { I18nProvider } from '@heyta/i18n';
import type { Operation } from '@heyta/sync-core';

import {
  __resetOpLogForTests,
  initOpLog,
  useTaskStore,
} from '../src/features/tasks/store.js';

const { NoteEditor } = await import('../src/features/tasks/NoteEditor.js');

let dbName: string;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
/**
 * 最近一次由界面触发的写入。
 *
 * 🔴 **必须攥住这个 promise 并 await 它。** `dispatchIntent` 是
 * "await 引擎 → notify()"，而 `notify()` 会去读引擎；如果写入还在飞的时候
 * 下一条用例的 `beforeEach` 把引擎重置了，`notify()` 就会抛
 * "op-log 引擎尚未初始化" —— 表现为**一条与断言无关的 Unhandled Rejection**，
 * 而且它挂在前一条用例名下，非常难归因。
 *
 * `act()` 只管 React 的更新，不会去等一个被 `void` 丢掉的 IndexedDB 写入。
 */
let pendingWrite: Promise<void> | undefined;

async function allOps(): Promise<Operation<string>[]> {
  const db = new IndexedDbAdapter(dbName);
  await db.init();
  const store = new IndexedDbOpLogStore<Operation<string>>(db);
  const rows = await store.getAllOps();
  db.close();
  return rows.map((r) => r.op);
}

beforeEach(async () => {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof IDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;

  dbName = `note-test-${Math.random().toString(36).slice(2)}`;
  __resetOpLogForTests();
  useTaskStore.setState({
    entities: emptyState(),
    filter: { kind: 'all' },
    now: Date.now(),
    ready: false,
  });
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

/**
 * 挂一个**真的接在 store 上**的备注编辑器。
 *
 * 刻意不 mock `onSetNote`：那样只能证明"组件会调回调"，
 * 而这条测试要证明的是**回调走到了 op-log**。
 */
async function mountFor(taskId: string): Promise<HTMLDivElement> {
  // 同一个用例里可能挂两次（比较"有备注 / 没备注"两种 chip）。先把上一次卸掉，
  // 否则它仍然订阅着 store —— 后面的写入会让一个已经没人看的树重新渲染。
  act(() => {
    root?.unmount();
  });
  container?.remove();

  const task = useTaskStore.getState().entities.tasks[taskId];
  expect(task, '夹具任务不存在').toBeDefined();

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <NoteEditor
          task={task!}
          onSetNote={(note) => {
            // 攥住 promise（见 `pendingWrite` 的说明），不要 `void` 掉。
            pendingWrite = useTaskStore.getState().setNote(taskId, note);
          }}
        />
      </I18nProvider>,
    );
  });
  return container;
}

function textarea(el: HTMLElement): HTMLTextAreaElement {
  const field = el.querySelector<HTMLTextAreaElement>('textarea');
  expect(field, '备注输入框没渲染出来').not.toBeNull();
  return field!;
}

/**
 * 打字 + 离开输入框。
 *
 * 🔴 **`await` 是必需的，不是保险。** `onSetNote` 落进 op-log 是一条异步链
 * （`dispatchIntent` → 引擎 → IndexedDB）。只在同步的 `act()` 里派发事件，
 * 断言会跑在写入完成**之前** —— 症状是"偶发红"或"单跑绿、全跑红"。
 * 用 `await act(async …)` 把这条链跑完。
 */
async function typeAndLeave(el: HTMLTextAreaElement, value: string): Promise<void> {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    // 🔴 React 的 onBlur 挂在原生 `focusout`（冒泡）上，不是不冒泡的 `blur`。
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  // 等界面触发的那次写入真的落盘 —— 否则下一条用例会踩到"引擎已被重置"。
  await act(async () => {
    await pendingWrite;
    pendingWrite = undefined;
  });
}

/**
 * 建一条任务并返回**它自己的** id。
 *
 * ⚠️ 不能取 `Object.keys(...)[0]` —— 第二个用例建第二条任务时，键 0 仍然是
 * 第一条，于是"比较两条任务"的断言会拿同一条任务比两次，看起来像组件坏了。
 */
async function addTask(title: string): Promise<string> {
  const before = new Set(Object.keys(useTaskStore.getState().entities.tasks));
  await act(async () => {
    await useTaskStore.getState().addTask(title);
  });
  const created = Object.keys(useTaskStore.getState().entities.tasks).find(
    (id) => !before.has(id),
  );
  expect(created, '没找到刚建出来的任务').toBeDefined();
  return created!;
}

describe('任务备注编辑', () => {
  it('🔴 写下备注会真的落进 op-log（不是只改本地字段）', async () => {
    const id = await addTask('写周报');
    const before = (await allOps()).length;

    const el = await mountFor(id);
    await typeAndLeave(textarea(el), '记得带上上周的指标');

    expect(useTaskStore.getState().entities.tasks[id]?.note).toBe('记得带上上周的指标');

    const ops = await allOps();
    expect(ops.length, '备注应当写出一条新的 op').toBe(before + 1);
    const noteOp = ops.at(-1);
    expect(noteOp?.entityType).toBe('TASK');
    expect((noteOp?.payload as { note?: string }).note).toBe('记得带上上周的指标');
  });

  it('🔴 清空备注 = 清除（载荷里是 null），不是留一个空串', async () => {
    const id = await addTask('写周报');
    await act(async () => {
      await useTaskStore.getState().setNote(id, '先写一句');
    });

    const el = await mountFor(id);
    await typeAndLeave(textarea(el), '   ');

    const ops = await allOps();
    const last = ops.at(-1);
    expect(last?.entityType).toBe('TASK');
    // `app-host` 的契约：`undefined` → 写成 `null`（"键存在且为 null"才能表达清除）
    expect((last?.payload as { note?: string | null }).note).toBeNull();
    expect('note' in (last?.payload as object)).toBe(true);
  });

  it('🔴 没改动就不写 op（"点开又点走"不该产生记录）', async () => {
    const id = await addTask('写周报');
    await act(async () => {
      await useTaskStore.getState().setNote(id, '原样');
    });
    const before = (await allOps()).length;

    const el = await mountFor(id);
    await typeAndLeave(textarea(el), '原样');

    expect((await allOps()).length).toBe(before);
  });

  it('🔴 有备注时 chip 上看得见（否则扫一眼列表不知道哪些任务写过东西）', async () => {
    const id = await addTask('写周报');
    await act(async () => {
      await useTaskStore.getState().setNote(id, '带上上周的指标');
    });

    const el = await mountFor(id);
    const summary = el.querySelector('summary');
    expect(summary?.textContent ?? '').toContain('带上上周的指标');

    // 没有备注时 chip 退回到通用词条，不显示空白
    const other = await addTask('没有备注的任务');
    const el2 = await mountFor(other);
    expect(el2.querySelector('summary')?.textContent ?? '').toContain('备注');
  });

  it('长备注的预览被截断，且只取第一行', async () => {
    const id = await addTask('写周报');
    await act(async () => {
      await useTaskStore
        .getState()
        .setNote(id, `${'很长的第一行'.repeat(10)}\n第二行不该出现在 chip 里`);
    });

    const el = await mountFor(id);
    const text = el.querySelector('summary')?.textContent ?? '';
    expect(text).toContain('…');
    expect(text).not.toContain('第二行');
  });
});
