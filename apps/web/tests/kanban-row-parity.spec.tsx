/**
 * 判据：**看板列里的行 = 列表里的行**（B274 的收口）
 * =====================================================
 *
 * 出处：`BLOCKED.md` 的 B274 —— 那一节把三笔债归到**同一个根**：
 * `apps/web/src/features/kanban/KanbanView.tsx` 没有复用 `packages/ui` 的
 * `TaskRow`，而是自己写了一张卡（卡里只有一个 `<span>{task.title}</span>`）。于是：
 *
 *   · `check:l4` 的 4 处内联样式（78 > 基线 74）；
 *   · `ht-kanban*` 两个**惰性钩子**（有类名、没有规则）；
 *   · `check:selection-single-source` 只能登记成 `row-actions-only`；
 *   · 卡的 testid 是 `kanban-card-*`，不在共享行的 `task-item-*` 那一族。
 *
 * 这一份是它与四象限的**同一把尺**（模板：`quadrant-row-parity.spec.tsx`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 判据怎么定的（四组，缺一不可）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **A. 同一档位 → 逐字节相同**：用**同一组 props**、**同一档位（`compact`）**
 *    分别渲染 `TaskList` 与 `TaskBoard`，取两边那颗 `task-item-<id>`，断言
 *    `outerHTML` 完全相同。它抓的是"看起来差不多但其实是另一份 JSX"（行内间距、
 *    勾选框几何、标题的语义文字样式、无障碍 role/state 都会进这个字符串）。
 *
 * **A2. 不同档位 → 必须不同**：`TaskBoard` 的行必须**等于** `compact` 档、
 *    **不等于**默认档。这一条防的是"`density` 只是个装饰参数"——
 *    没有它，A 在看板偷偷退回默认档时**照样绿**（两边都走默认档，DOM 自然一样）。
 *
 * **B. 行确实是共享行**：列里的行必须**带** `task-toggle-<id>`
 *    （勾选框的 pressable，只有 `TaskList` 产出它）。迁移前那张卡没有勾选框。
 *
 * **C. 三个旧锚点一个都没丢**：`kanban-view` / `kanban-col-<id>` / `kanban-card-<id>`。
 *    它们是既有 e2e 与截图找人的方式。换组件时锚点**换挂点可以，改名不行** ——
 *    改名会让按旧名字找人的判据静默失效（而那正是"判据被改松"的典型形状）。
 *
 * **D. 选中接上了**：看板是同一批任务的第四种投影，必须跟随**同一枚**共享选中 ——
 *    ① 宿主递的选中 ⇒ **只有那一条**带底色；② 点行 ⇒ 宿主收到那一条的 id。
 *    ⚠️ 这一组必须挂**web 宿主**（`WebKanbanView`），不能只挂共享板子：
 *    2026-10-03 的事故正是宿主把 `onOpenTask` / `activeTaskId` 声明了、也解构了，
 *    **唯独没往共享层传** —— 只挂共享层的用例照样全绿，而界面上四象限不跟随选中。
 *
 * 外加**源码级**的一组：`KanbanView.tsx` 自己不许画行、不许写内联样式。
 * A/B 抓不到"逐字复制一份行"；`check:row-single-source` 只到文件粒度。
 * 而"不许写内联样式"那一条是本单**最承重**的一条判据：`check:l4` 只数
 * `style={{` 这一种写法（traps #671 的已知缝），把人挡住的是这里。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这道判据**抓不到**什么（如实写下来，别当它是全覆盖）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * · **拖放的行为**（跨列 ⇒ 改 `projectId`）要真浏览器：`pointerWithin` 靠真实
 *   `getBoundingClientRect`，jsdom 里每个矩形都是 0。所以本文件只断言**接线在位**
 *   （投放层、`data.column`、`SortableContext`），不断言"拖过去真的写了 op"——
 *   那一条今天没有自动化判据（e2e 不在本单范围）。
 * · **视觉**（列的表面色/圆角/标题字号）：那是共享层的 `makeStyles`，由
 *   `check:design` 的 token 纪律与真浏览器看图管，不在这一份里。
 *
 * ⚠️ 本测试用 `@heyta/ui` 的 **`dist/`**（package exports）。
 * 改完 `packages/ui` 源码必须先 `pnpm --filter @heyta/ui build`，
 * 否则看到的是**上一次构建**的结果（假红或假绿都可能）。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

import type { Task } from '@heyta/domain';
import { emptyState } from '@heyta/op-log';
import {
  HeytaUiProvider,
  TaskBoard,
  TaskList,
  type TaskBoardColumn,
  type TaskBoardLabels,
  type TaskRow,
} from '@heyta/ui';

import { selection } from '../src/lib/selection.js';
import { useTaskStore } from '../src/features/tasks/store.js';

/**
 * 🔴 **web 宿主**必须**动态** import：它在模块顶层就把 store 拉进来，
 * 而 store 要用 IndexedDB —— 上面那两行 `globalThis` 必须先跑完。
 * （与 `quadrant-row-parity.spec.tsx` 同一个写法。）
 */
const { KanbanView: WebKanbanView } = await import('../src/features/kanban/KanbanView.js');

/** 稳定的"现在"：2026-09-24 10:00。**不读 `Date.now()`**（否则用例不可复现）。 */
const NOW = new Date(2026, 8, 24, 10, 0, 0).getTime();

function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: '写方案', createdAt: 0, updatedAt: 0, ...over };
}

/**
 * **两边完全相同的一组 props。**
 *
 * 判据要成立，唯一的变量必须是"谁渲染的行"；所以 `renderTrailing` / `labels`
 * 两侧传同一份 —— 否则差异可能来自宿主插槽，而那不是本判据要管的事。
 */
function sharedRowProps() {
  return {
    onToggleTask: () => undefined,
    labels: {
      toggleOn: (row: TaskRow) => `完成：${row.title}`,
      toggleOff: (row: TaskRow) => `取消完成：${row.title}`,
    },
    renderTrailing: () => <span data-testid="trail">尾</span>,
  };
}

const LABELS: TaskBoardLabels = {
  columnA11y: (column) => `列：${column.title}`,
};

function column(id: string, title: string, tasks: readonly Task[]): TaskBoardColumn {
  return { id, title, tasks };
}

let roots: Root[] = [];
let containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode, wrap = true): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(wrap ? <HeytaUiProvider>{node}</HeytaUiProvider> : <>{node}</>);
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
  selection.clear();
  document.body.innerHTML = '';
});

/** 取出那颗行（行的容器由 `TaskList` 自己给：`task-item-<id>`）。 */
function rowHtml(container: HTMLElement, id: string): string {
  const el = container.querySelector(`[data-testid="task-item-${id}"]`);
  expect(el, `没找到 task-item-${id}`).not.toBeNull();
  return el === null ? '' : el.outerHTML;
}

describe('看板列里的行 = 列表里的行', () => {
  it('A. 同一档位（compact）下，两边的行 DOM 逐字节相同', () => {
    const t = task({ projectId: 'p1' });
    const props = sharedRowProps();

    // 🔴 列表这一侧必须**显式**传 `density="compact"` —— 看板列用的就是这一档。
    const listContainer = mount(<TaskList tasks={[t]} density="compact" {...props} />);
    const boardContainer = mount(
      <TaskBoard
        columns={[column('p1', '工作', [t])]}
        labels={LABELS}
        onToggleTask={props.onToggleTask}
        taskLabels={props.labels}
        renderTrailing={props.renderTrailing}
      />,
    );

    expect(rowHtml(boardContainer, 't1')).toBe(rowHtml(listContainer, 't1'));
  });

  it('A2. 看板的行等于 compact 档、不等于默认档（density 不是装饰）', () => {
    const t = task({ projectId: 'p1' });
    const props = sharedRowProps();

    const boardContainer = mount(
      <TaskBoard
        columns={[column('p1', '工作', [t])]}
        labels={LABELS}
        onToggleTask={props.onToggleTask}
        taskLabels={props.labels}
        renderTrailing={props.renderTrailing}
      />,
    );
    const compactContainer = mount(<TaskList tasks={[t]} density="compact" {...props} />);
    const defaultContainer = mount(<TaskList tasks={[t]} {...props} />);

    const boardRow = rowHtml(boardContainer, 't1');
    expect(boardRow, '看板的行与 compact 档的列表行不同 —— 看板没有用 compact').toBe(
      rowHtml(compactContainer, 't1'),
    );
    expect(
      rowHtml(defaultContainer, 't1'),
      '默认档与 compact 档渲染出了逐字节相同的行 —— density 是装饰，不是一个真的维度',
    ).not.toBe(rowHtml(compactContainer, 't1'));
    expect(boardRow, '看板的行与默认档逐字节相同 —— 看板把密度退回默认档了').not.toBe(
      rowHtml(defaultContainer, 't1'),
    );
  });

  it('B. 列里的行带勾选框（迁移前那张卡只有一个 span）', () => {
    const t = task({ projectId: 'p1' });
    const props = sharedRowProps();
    const boardContainer = mount(
      <TaskBoard
        columns={[column('p1', '工作', [t])]}
        labels={LABELS}
        onToggleTask={props.onToggleTask}
        columnTestID={(c) => `kanban-col-${c.id}`}
      />,
    );

    const toggle = boardContainer.querySelector('[data-testid="task-toggle-t1"]');
    expect(toggle, '列里没有勾选框 —— 那一行不是共享 TaskList 渲染的').not.toBeNull();
    // 它真的落在这一列里，而不是掉在别处。
    expect(
      boardContainer.querySelector('[data-testid="kanban-col-p1"]')?.contains(toggle),
    ).toBe(true);
  });

  it('列头有列名与条数（它不再是四条没有规则的 className）', () => {
    const boardContainer = mount(
      <TaskBoard
        columns={[
          column('p1', '工作', [task({ projectId: 'p1' })]),
          column('p2', '生活', []),
        ]}
        labels={LABELS}
        onToggleTask={() => undefined}
        columnTestID={(c) => `kanban-col-${c.id}`}
      />,
    );
    const work = boardContainer.querySelector('[data-testid="kanban-col-p1"]');
    expect(work?.textContent, '列头没有「工作」这个列名').toContain('工作');
    expect(work?.textContent, '列头没有条数 1').toContain('1');
    // 空列照样在（看板的价值就是"一屏几列"）
    expect(boardContainer.querySelector('[data-testid="kanban-col-p2"]')).not.toBeNull();
  });
});

/**
 * D. 宿主这一层（`apps/web/src/features/kanban/KanbanView.tsx`）**真的接上了**。
 *
 * ⚠️ 这里挂的是**真宿主**，而且**不套外壳 Provider** —— 顺带钉住另一件事：
 * `HeytaUiProvider` 必须挂在看板自己这一处（`App.tsx` 的 Provider 只包了
 * `tasks` 那棵树，看板是兄弟节点）。少了那一层，这里会当场抛
 * 「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」。
 *
 * ⚠️ 它**不**断言拖放与勾选真的写进了 op-log（那要真浏览器），
 * 也别把这个冒烟当成"交互验过了"。
 */
function seed(): void {
  const a = task({ id: 't1', title: '写方案', projectId: 'p1' });
  const b = task({ id: 't2', title: '回邮件', projectId: 'p1' });
  useTaskStore.setState({ entities: { ...emptyState(), tasks: { t1: a, t2: b } }, now: NOW });
}

function mountHost(over: { onOpenTask?: (id: string) => void; onMoveTask?: () => void } = {}) {
  return mount(
    <WebKanbanView
      tasks={Object.values(useTaskStore.getState().entities.tasks)}
      projects={[{ id: 'p1', name: '工作', createdAt: 0, updatedAt: 0 } as never]}
      onMoveTask={over.onMoveTask ?? (() => undefined)}
    />,
    false,
  );
}

describe('web 换装：看板渲染出列与共享行', () => {
  it('三个旧锚点都还在（换挂点，不是改名）', () => {
    seed();
    const container = mountHost();

    expect(container.querySelector('[data-testid="kanban-view"]'), '板根的锚点丢了').not.toBeNull();
    expect(
      container.querySelector('[data-testid="kanban-col-p1"]'),
      '列的锚点丢了（kanban-col-<清单 id>）',
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="kanban-card-t1"]'),
      '卡的锚点丢了（kanban-card-<任务 id>）',
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="task-item-t1"]'),
      '列里没有共享行 —— 卡的那一层不是 TaskList 渲染的',
    ).not.toBeNull();
  });

  it('行尾有拖拽握把，且空列也有投放层（空列收得下东西）', () => {
    seed();
    const container = mountHost();

    expect(
      container.querySelector('[data-testid="kanban-drag-t1"]'),
      '行尾没有拖拽握把 —— 拖放没有 activator',
    ).not.toBeNull();
    // `p1` 里有两张卡，但收集箱那一列是空的：它的投放层必须照样在。
    expect(
      container.querySelector('[data-testid="kanban-col-drop-inbox"]'),
      '空列没有投放层 —— 拖不进空清单，而且不报错',
    ).not.toBeNull();
  });

  it('🔴 选中：宿主读共享选中 ⇒ 只有那一条带底色', () => {
    seed();
    const container = mountHost();
    /** 底色要从 `getComputedStyle` 读：RNW 把样式编译成 class，`el.style.*` 恒为 `''`。 */
    const paint = (id: string): string => {
      const el = container.querySelector<HTMLElement>(`[data-testid="task-item-${id}"]`);
      expect(el, `看板里没有 task-item-${id}`).not.toBeNull();
      return getComputedStyle(el as Element).backgroundColor.trim();
    };
    const TRANSPARENT = 'rgba(0, 0, 0, 0)';

    expect(paint('t2'), '没选中的那条一开始就有底色').toBe(TRANSPARENT);
    act(() => {
      selection.select('task', 't2');
    });
    expect(
      paint('t2'),
      '共享选中换了，看板那一条没有底色 —— 宿主的 `useSelected`/转发断了',
    ).not.toBe(TRANSPARENT);
    expect(paint('t1'), '没选中的那条也画了底色').toBe(TRANSPARENT);
  });

  it('🔴 选中：点一行写的是**共享选中**（同一个出口，不是本文件自己记一条）', () => {
    seed();
    const container = mountHost();
    const body = container.querySelector<HTMLElement>('[data-testid="task-row-t2"]');
    expect(body, '行体没渲染出来').not.toBeNull();
    expect(body?.getAttribute('role'), '行体不是可点区域 —— onOpenTask 没递到共享层').toBe(
      'button',
    );
    act(() => {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
        body!.dispatchEvent(
          type.startsWith('pointer')
            ? new PointerEvent(type, { bubbles: true, pointerId: 1 })
            : new MouseEvent(type, { bubbles: true }),
        );
      }
    });
    expect(selection.get('task'), '点了一行，共享选中没有换人').toBe('t2');
  });
});

/**
 * C. 结构判据（补 A/B 的缺口）：看板组件**自己不许画行**，宿主**不许写内联样式**。
 *
 * ⚠️ 先剥注释再判：本文件与两个组件的文件头里都**引用**了那些"痕迹"来讲解判据，
 * 不剥的话判据会被自己的说明文字弄红（`quadrant-row-parity.spec.tsx` 记过这一条）。
 */
describe('看板的源码形状（源码级）', () => {
  const read = (rel: string): string =>
    readFileSync(resolve(process.cwd(), '../..', rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

  const SHARED = read('packages/ui/src/task-list/TaskBoard.tsx');
  const HOST = read('apps/web/src/features/kanban/KanbanView.tsx');

  it('共享看板容器渲染共享 TaskList（不是自己画一行）', () => {
    expect(SHARED).toContain('<TaskList');
    expect(SHARED).not.toContain('accessibilityRole="checkbox"');
    expect(SHARED).not.toContain('task-toggle-');
    expect(SHARED).not.toContain('TASK_ROW_SHAPE');
  });

  it('宿主渲染共享 TaskBoard，且没有任何"自己画一行"的痕迹', () => {
    expect(HOST).toContain('<TaskBoard');
    expect(HOST).not.toContain('accessibilityRole="checkbox"');
    expect(HOST).not.toContain('task-toggle-');
    expect(HOST).not.toContain('{task.title}');
    expect(HOST).not.toContain('{row.title}');
  });

  /**
   * 🔴 这一条是**本单最承重的一条**：`check:l4` 的断言 C 只数 `style={{` 这一种写法
   * （traps #671 的已知缝：把对象提成常量再 `style={IDENT}` 它看不见）。
   * 看板之所以欠了 4 处内联样式，就是因为它自己定了卡/列/标题/根容器的样式。
   * 判据写成"整个文件不许出现 `style={}`" —— 它不关心写法，只关心
   * **这一层有没有在定样式**（定样式的地方只有 `packages/ui`）。
   */
  it('🔴 宿主里一个 `style={…}` 都不许有（本单要还的就是这 4 笔）', () => {
    expect(
      HOST.match(/\bstyle=\{/g) ?? [],
      'KanbanView 里又出现了内联样式 —— 样式该住 packages/ui（trap #671 的那条缝不在判据里，这条补它）',
    ).toEqual([]);
  });
});
