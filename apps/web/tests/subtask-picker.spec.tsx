/**
 * 子任务界面（⑩-2 的"最后一米"）
 * ==================================
 *
 * 🔴 这个文件钉的是一处**真实空洞**：`packages/domain/src/subtasks.ts`（616 行，
 * 建树 + 环防护 + 深度/子数上限）与 `app-host` 的 `setParent` **都已经写好**，
 * 但 Web 上一次调用点都没有 —— 于是"模型支持、树能建、**用户没有任何办法
 * 造出一个子任务**"，而且**不报错**，只是这个功能不存在。
 *
 * 补上之后要保证的五件事，缺一件这个功能就是假的：
 *
 *   1. **真的写进 op-log** —— 只改本地 store 的话刷新就没了、也同步不出去；
 *   2. 🔴 **候选里选不到自己、也选不到自己的后代** —— 选得到就说明预过滤没用
 *      领域层的 `canSetParent`，而那是**造出环**的唯一入口（环 ⇒ 树无限递归）；
 *   3. **"（顶级任务）"这一项真的能提为顶级**（传 `undefined`，app-host 写成 `null`）；
 *   4. **拒绝时显示的是人话，不是诊断串** —— `cause.message` 里有原始 id
 *      （`改父被拒绝（cycle）：a → b`），渲染它等于把内部标识符给用户看；
 *   5. **重开仍在** —— 证明它落盘了，不只是内存里对。
 *
 * 用的是**真的 op-log 与真的 store**（`fake-indexeddb`），不是 mock：
 * 第 1、5 条只有真的落盘才验得了。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import { emptyState } from '@heyta/op-log';

import { __resetOpLogForTests, initOpLog, useTaskStore } from '../src/features/tasks/store.js';

const { SubtaskPicker } = await import('../src/features/tasks/SubtaskPicker.js');

let dbName: string;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
/**
 * 最近一次由界面触发的写入。
 *
 * 🔴 与 `note-editor.spec.tsx` 同一个理由：`dispatchIntent` 是
 * "await 引擎 → notify()"，`act()` 只管 React 更新、**不会等一个被丢掉的
 * IndexedDB 写入**。攥住它并 await，否则会在下一条用例里以一条与断言无关的
 * Unhandled Rejection 的形式炸出来。
 */
let pendingWrite: Promise<void> | undefined;

beforeEach(async () => {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof IDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;

  dbName = `subtask-test-${Math.random().toString(36).slice(2)}`;
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
  pendingWrite = undefined;
});

/** 挂一个**真的接在 store 上**的子任务选择器。 */
async function mountFor(taskId: string): Promise<HTMLDivElement> {
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
        <SubtaskPicker
          task={task!}
          onSetParent={(parentId) => {
            const p = useTaskStore.getState().setParent(taskId, parentId);
            pendingWrite = p;
            return p;
          }}
        />
      </I18nProvider>,
    );
  });
  return container;
}

/** 建一棵 A → B → C 的链（B 是 A 的子，C 是 B 的子）。 */
async function makeChain(): Promise<{ a: string; b: string; c: string }> {
  const store = useTaskStore.getState();
  await store.addTask('A');
  await store.addTask('B');
  await store.addTask('C');
  const ids = useTaskStore
    .getState()
    .entities.tasks !== undefined
    ? Object.values(useTaskStore.getState().entities.tasks)
        .sort((x, y) => x.createdAt - y.createdAt)
        .map((t) => t.id)
    : [];
  const [a, b, c] = ids as [string, string, string];
  await useTaskStore.getState().setParent(b, a);
  await useTaskStore.getState().setParent(c, b);
  return { a, b, c };
}

/** 某个 select 的候选 value 列表（`''` = 顶级那一项）。 */
function optionValues(el: HTMLElement, taskId: string): string[] {
  const select = el.querySelector(`[data-testid="subtask-select-${taskId}"]`);
  expect(select, `找不到 ${taskId} 的 select`).not.toBeNull();
  return Array.from(select!.querySelectorAll('option')).map((o) => o.getAttribute('value') ?? '');
}

function selectOption(el: HTMLElement, taskId: string, value: string): void {
  const select = el.querySelector<HTMLSelectElement>(`[data-testid="subtask-select-${taskId}"]`)!;
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('SubtaskPicker —— 用户真的能造出子任务', () => {
  it('🔴 候选里**选不到自己、也选不到自己的后代**（选得到就能造出环）', async () => {
    const { a, b, c } = await makeChain();
    const el = await mountFor(a);

    const values = optionValues(el, a);

    // 自己是 a ⇒ a 不能在候选里
    expect(values, '自己出现在候选里').not.toContain(a);
    // b 是 a 的子、c 是 a 的孙 ⇒ 都是后代，都不能在候选里（选任一个都会成环）
    expect(values, '子任务出现在候选里').not.toContain(b);
    expect(values, '孙任务出现在候选里').not.toContain(c);
    // 但"（顶级任务）"这一项必须在
    expect(values).toContain('');
  });

  it('选中一个合法父 ⇒ **真的写进 op-log**，且重开仍在', async () => {
    const store = useTaskStore.getState();
    await store.addTask('父');
    await store.addTask('子');
    const [parent, child] = Object.values(useTaskStore.getState().entities.tasks)
      .sort((x, y) => x.createdAt - y.createdAt)
      .map((t) => t.id) as [string, string];

    const el = await mountFor(child);
    selectOption(el, child, parent);
    await act(async () => {
      await pendingWrite;
    });

    expect(useTaskStore.getState().entities.tasks[child]!.parentId).toBe(parent);

    // 重开：全新的引擎，走完整的 recover() 路径
    __resetOpLogForTests();
    useTaskStore.setState({ entities: emptyState(), ready: false });
    await initOpLog(dbName);
    expect(useTaskStore.getState().entities.tasks[child]!.parentId).toBe(parent);
  });

  it('选「（顶级任务）」⇒ 提为顶级（清除引用，不是留一个悬空 id）', async () => {
    const { a, b } = await makeChain();
    const el = await mountFor(b);
    expect(useTaskStore.getState().entities.tasks[b]!.parentId).toBe(a);

    selectOption(el, b, '');
    await act(async () => {
      await pendingWrite;
    });

    expect(useTaskStore.getState().entities.tasks[b]!.parentId).toBeUndefined();
  });

  it('🔴 归属**常驻可见**：chip 上写着当前父的标题（不是只在展开面板里）', async () => {
    const { a, b } = await makeChain();
    const el = await mountFor(b);

    const chip = el.querySelector(`[data-testid="subtask-trigger-${b}"]`);
    expect(chip, 'chip 不存在').not.toBeNull();
    // 扫一眼列表就该看得出"B 属于 A"
    expect(chip!.textContent ?? '').toContain('A');
  });

  it('顶层任务的 chip 说"子任务"，不编一个父名', async () => {
    const { a } = await makeChain();
    const el = await mountFor(a);

    const chip = el.querySelector(`[data-testid="subtask-trigger-${a}"]`);
    expect(chip!.textContent ?? '').toContain('子任务');
  });

  it('🔴 被拒绝时显示的是**人话**，不是 `cause.message` 那段诊断串', async () => {
    const { a, b } = await makeChain();

    /**
     * 🔴 **为什么这里必须注入一个会 reject 的 handler，而不是从 `<select>` 里选一个非法项**：
     *
     * 候选是**预过滤**过的（用领域层的 `canSetParent`）—— 所以"自己"和"后代"
     * **根本不在选项里**，用户从界面**选不出**非法项。那是刻意的设计，
     * 也正是上面那条断言在验的东西。
     *
     * 但预过滤与真正写入之间仍可能被**别的设备改掉**（跨端同步），
     * 所以 `setParent` 的 throw **必须有落点**。这里直接模拟那个竞态：
     * 让 handler 抛一条**与 app-host 逐字同形**的错误。
     */
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const task = useTaskStore.getState().entities.tasks[b]!;
    await act(async () => {
      root?.render(
        <I18nProvider locale="zh-CN">
          <SubtaskPicker
            task={task}
            onSetParent={() =>
              // 与 `packages/app-host/src/actions.ts` 抛的那句**同形**
              // （原因在中文全角括号里，后面是可定位的上下文）。
              Promise.reject(new Error(`改父被拒绝（cycle）：${b} → ${a}`))
            }
          />
        </I18nProvider>,
      );
    });

    const el = container;
    selectOption(el, b, a);
    await act(async () => {
      // 让 rejection 的回调跑完
      await Promise.resolve();
    });

    const err = el.querySelector(`[data-testid="subtask-error-${b}"]`);
    expect(err, '被拒绝后没有显示任何提示').not.toBeNull();
    const text = err!.textContent ?? '';
    // 显示的是词条里那句人话……
    expect(text).toContain('环');
    // ……而**不是**诊断串（里面有原始 id 与英文原因码）
    expect(text, '把诊断串渲染给用户看了').not.toMatch(/改父被拒绝|cycle|→|task_not_found/);
  });
});
