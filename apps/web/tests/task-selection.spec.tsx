/**
 * 判据：**选中态是宿主接的，不是界面自己想的**
 * ============================================
 *
 * 对应工单 `docs/plans/detail-pane-alignment.md` W1 的 ①②（③ 键盘那一档拆到 W1b，
 * 理由与解锁条件写在 §8 那一行，不在这里含糊）。共享层自己的规则在
 * `packages/app-host/tests/selection.spec.ts`，**那边证明不了这边接上了** ——
 * 本仓库为这个形状付过两次学费（"抽出了共享实现，但旧那份没删"、
 * "零件都在、没人接线"）。所以这里三组各钉一个宿主侧的事实：
 *
 * **A. 两个列表调用点都接上了。** web 的任务视图有**两条**渲染路径：
 * 不分组的平铺列表与按日期分组的列表。只接一条的后果是"分组的时候点行没反应"，
 * 而分组恰恰是默认形态 —— 所以这条**数两处**，不是 grep 到一个就算过。
 *
 * **B. 真点一行 ⇒ 选中 id 等于那一行。** 通过真实 `TaskList` + RNW 的 `Pressable`
 * 走一次事件，而不是直接调 `selection.select()`。
 * 🔴 自带"动作没有被吞"的总结判据（按下计数器）：事件没到达 `onPress` 时
 * 用例是**红**，而不是"什么都不动但仍然绿"。
 *
 * **C. 回落只认实体存在性，不认筛选可见性。** 这条在界面上的全部表现是
 * "切个筛选，正在看的那条会不会自己关掉"，单看每个视图都不算 bug，
 * 所以它必须被钉在这里 —— 共享层的单测只能证函数，证不了宿主喂进去的谓词。
 *
 * ⚠️ 本文件用 `@heyta/ui` 的 `dist/`：改完 `packages/ui` 要先构建它。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DAY_MS, type Task } from '@heyta/domain';
import { emptyState, type MaterializedState } from '@heyta/op-log';
import { HeytaUiProvider, resolveHeytaUiTheme, TaskList } from '@heyta/ui';

import { pruneSelectionFromEntities, selection, useSelected } from '../src/lib/selection.js';

const THEME = resolveHeytaUiTheme({ scheme: 'light', reducedTransparency: false });
/** 正午的"现在"：跨零点与夏令时都不会把它挪到别的日子。 */
const NOW = new Date(2026, 8, 25, 12, 0, 0).getTime();

/**
 * 读源文件而不是挂整个 App：`app-mount.spec.tsx` 证过它能挂起来，但那一棵树要
 * 真 IndexedDB、真 store、真同步。本组判的是**接线存在**，行为由 B/C 两组用真组件证。
 *
 * ⚠️ vitest 跑在 jsdom 里，`import.meta.url` 是 http 协议，所以按 cwd（= `apps/web`）解析。
 *    下面那条"这个文件里确实有 App 组件"的断言是这种读法的阳性对照 ——
 *    路径写错时读到空串，A 组会因为"找不到两处调用点"而响亮地红，不会假绿。
 */
const APP_SOURCE = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

function task(id: string, over: Partial<Task> = {}): Task {
  return { id, title: `任务 ${id}`, createdAt: 0, updatedAt: NOW, ...over };
}

/** 只填任务桶：其余类别留空，回落不该被这组用例牵动。 */
function entitiesWith(tasks: readonly Task[]): MaterializedState {
  const state = emptyState();
  for (const t of tasks) state.tasks[t.id] = t;
  return state;
}

let roots: Root[] = [];
let containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<HeytaUiProvider value={THEME}>{node}</HeytaUiProvider>);
  });
  roots.push(root);
  containers.push(container);
  return container;
}

afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  for (const container of containers) container.remove();
  roots = [];
  containers = [];
  // 🔴 选中态是**模块级单例**（这正是它能在视图之间保持的原因）。
  //    不清就把上一例的选中带进下一例，而"下一例一开始就是选中的"
  //    在断言里长得和正常情况一模一样。
  selection.clear();
});

/**
 * 走一次真实的按下。
 *
 * ⚠️ 发完整指针序列而不是只发 `click`：只发一种时 RNW 有版本不认，
 *    症状是"用例全绿但一次按下都没发生"。计数器就是这条的阳性对照。
 */
function pressRow(container: HTMLElement, id: string): void {
  const el = container.querySelector<HTMLElement>(`[data-testid="task-row-${id}"]`);
  expect(el, `行 ${id} 没渲染出来（testID 锚点搬家了？）`).not.toBeNull();
  expect(el?.getAttribute('role'), `行 ${id} 的行体不是可点区域`).toBe('button');
  const target = el as HTMLElement;
  act(() => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
      target.dispatchEvent(
        type.startsWith('pointer')
          ? new PointerEvent(type, { bubbles: true, pointerId: 1 })
          : new MouseEvent(type, { bubbles: true }),
      );
    }
  });
}

/** 一个最小的"宿主"：与 App 的接线同形（读选中 → 传 onOpenTask → 回灌光标）。 */
function Host({
  tasks,
  onOpen,
}: {
  readonly tasks: readonly Task[];
  readonly onOpen?: (taskId: string) => void;
}): React.JSX.Element {
  const selectedId = useSelected('task');
  return (
    <div>
      <div data-testid="detail-slot">{selectedId ?? '（没选中）'}</div>
      <TaskList
        tasks={tasks}
        onOpenTask={(taskId) => {
          selection.select('task', taskId);
          onOpen?.(taskId);
        }}
        onToggleTask={() => {}}
        activeTaskId={selectedId}
      />
    </div>
  );
}

describe('A. 任务视图的两条渲染路径都接上了选中', () => {
  it('两处 `<TaskList` 调用、两处 `onOpenTask`，数量相等', () => {
    // 阳性对照：读到的是不是那个文件，先证一次。
    expect(APP_SOURCE).toContain('export function App(');
    const calls = APP_SOURCE.split('<TaskList').length - 1;
    const withOpen = APP_SOURCE.split('onOpenTask={openTask}').length - 1;
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(withOpen).toBe(2);
    // 🔴 "接了一个点漏另一个"就是本仓库那种部分接线的形状：不比这两个数，
    //    第三条渲染路径将来加进去时不会有人发现它没接。
    expect(withOpen).toBe(calls);
  });

  it('行的高亮光标与选中是**同一个值**', () => {
    const withActive = APP_SOURCE.split('activeTaskId={selectedTaskId}').length - 1;
    expect(withActive).toBe(2);
    expect(APP_SOURCE).toContain("const selectedTaskId = useSelected('task');");
  });

  it('回落挂在**数据**变化上，而不是挂在"用户点了关闭"上', () => {
    expect(APP_SOURCE).toContain('pruneSelectionFromEntities(store.entities)');
  });
});

describe('B. 真点一行 = 选中那一条', () => {
  it('点第二行 ⇒ store 与详情槽都是它的 id，且按下确实到达了 onPress', () => {
    const seen: string[] = [];
    const host = mount(<Host tasks={[task('t1'), task('t2')]} onOpen={(id) => seen.push(id)} />);
    pressRow(host, 't2');
    expect(seen, '一次按下没到达 onPress —— 事件被吞了，这条用例没有测任何东西').toEqual(['t2']);
    expect(selection.get('task')).toBe('t2');
    expect(host.querySelector('[data-testid="detail-slot"]')?.textContent).toBe('t2');
  });

  it('换一行是替换，详情槽跟着换', () => {
    const container = mount(<Host tasks={[task('t1'), task('t2')]} />);
    pressRow(container, 't1');
    pressRow(container, 't2');
    expect(selection.snapshot()).toEqual({ task: 't2' });
    expect(container.querySelector('[data-testid="detail-slot"]')?.textContent).toBe('t2');
  });

  it('两处订阅看到同一个选中（"跨视图保持"这件事本身）', () => {
    const a = mount(<Host tasks={[task('t1')]} />);
    const b = mount(<Host tasks={[task('t1')]} />);
    act(() => {
      selection.select('task', 't1');
    });
    expect(a.querySelector('[data-testid="detail-slot"]')?.textContent).toBe('t1');
    expect(b.querySelector('[data-testid="detail-slot"]')?.textContent).toBe('t1');
  });

  it('没传 `onOpenTask` 时行体不可点（钉住共享层这个设计，防它以后加默认值）', () => {
    // `mount()` 已经把 `HeytaUiProvider` 包好了 —— 共享组件缺它会**主动抛错**
    // 而不是静默降级，所以这里不需要再套一层。
    const container = mount(<TaskList tasks={[task('t1')]} onToggleTask={() => {}} />);
    const el = container.querySelector<HTMLElement>('[data-testid="task-row-t1"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('role')).toBeNull();
    pressRowNoAssert(el as HTMLElement);
    expect(selection.get('task')).toBeNull();
  });
});

/** 上面那条负向用例只需要真发事件，不需要 `pressRow` 的存在性断言。 */
function pressRowNoAssert(target: HTMLElement): void {
  act(() => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
      target.dispatchEvent(
        type.startsWith('pointer')
          ? new PointerEvent(type, { bubbles: true, pointerId: 1 })
          : new MouseEvent(type, { bubbles: true }),
      );
    }
  });
}

describe('C. 回落只认实体在不在，不认筛不筛得到', () => {
  it('实体还在、只是不在当前可见列表里 ⇒ 选中**保持**', () => {
    selection.select('task', 't2');
    // 宿主递进来的是**整个物化状态**（App 里就是 `store.entities`），
    // 不是筛选后的 `visible`。变异臂：把这一行的实参换成 [task('t1')] ——
    // "切筛选面板自己关掉"那个坏行为就会立刻红。
    pruneSelectionFromEntities(entitiesWith([task('t1'), task('t2'), task('t3')]));
    expect(selection.get('task')).toBe('t2');
  });

  it('实体被软删（进回收站）⇒ 选中清空', () => {
    selection.select('task', 't1');
    pruneSelectionFromEntities(entitiesWith([task('t1', { deletedAt: NOW })]));
    expect(selection.get('task')).toBeNull();
  });

  it('实体彻底没了 ⇒ 选中清空', () => {
    selection.select('task', 'gone');
    pruneSelectionFromEntities(entitiesWith([task('t1')]));
    expect(selection.get('task')).toBeNull();
  });

  it('本来没选中时一次通知都不发', () => {
    const listener = vi.fn();
    const off = selection.subscribe(listener);
    pruneSelectionFromEntities(entitiesWith([task('t1')]));
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it('口径写死在这里：软删算"不在了"，详情面跟着关，恢复在回收站里做', () => {
    // 改这条口径的人必须**同时**改 web 与 mobile —— 两边的谓词都是活跃集合。
    // 只改一边得到的不是"另一种设计"，而是同一件事在两端有不同表现。
    selection.select('task', 't1');
    pruneSelectionFromEntities(entitiesWith([task('t1', { deletedAt: NOW + DAY_MS })]));
    expect(selection.get('task')).toBeNull();
  });
});
