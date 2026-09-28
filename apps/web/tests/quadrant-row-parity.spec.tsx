/**
 * 判据：**四象限卡里的行 = 列表里的行**
 * =======================================
 *
 * 出处：`docs/research/dida-view-unification.md` §4.2 ——
 *
 * > **判据**：四象限卡里的行 = `<TaskRow density="compact" />`，
 * > 日历格里的行 = `<TaskRow density="minimal" />`。**不是三份 JSX。**
 *
 * 这一条为什么值得单独一个测试：迁移前两端各有一份"更短的行"
 *（web 的 `DraggableTask` 只有一行标题文字，连完成都勾不了）。
 * 那样的重复**不会让任何现有测试变红** —— 它只是让象限里的行与列表里的行
 * 慢慢长得不一样，而"不一样"本身没有断言。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 判据怎么定的（三道，缺一不可）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **A. 同一档位 → 逐字节相同**：用**同一组 props**、**同一档位（`compact`）**
 *    分别渲染 `TaskList` 与 `QuadrantBoard`，取出两边那颗 `task-item-<id>`，
 *    断言 `outerHTML` 完全相同。它抓的是"看起来差不多但其实是另一份 JSX"——
 *    包括行内间距、勾选框几何、标题的语义文字样式、无障碍 role/state。
 *    ⚠️ 光有 A 是**不够**的（这正是本用例 2026-09-28 晚被改的原因）：
 *    象限不传 `density` 时两边都走默认档，A **照样绿** —— 它证明的只是
 *    "象限没有另写行"，**没有**证明"象限用的是 `compact` 那一档"。
 *
 * **A2. 不同档位 → 必须不同**（`density` 不许是装饰）：同一实体分别按
 *    `compact` 与**默认档**渲染，两颗行的 `outerHTML` **必须不同**。
 *    象限的那颗行（现在是 `compact`）必须**等于** `compact` 列表行、
 *    **不等于**默认档列表行。这一条把 A 的缺口补上：
 *      · 象限把 `density` 退回默认档 → A 与 A2 同时红；
 *      · `DENSITY_SPEC` 三档被做成同一份规格 → A2 红（density 变成装饰）。
 *    判据出处：`docs/research/dida-view-unification.md` §4.2 +
 *    `docs/plans/multi-platform-adaptation.md`「§4.2 的 `density` 契约」。
 *
 * **B. 行确实是共享行**：象限格里那颗行必须**带** `task-toggle-<id>`
 *    （勾选框的 pressable，只有 `TaskList` 产出它）。迁移前的
 *    `DraggableTask` 没有勾选框，所以只写 A 的话，"把行换成手写的一份、
 *    但没有勾选框"会被 A 抓到；B 是让报告**一眼指出缺的是什么**，
 *    而不是只丢一句"两个字符串不一样"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这道判据**抓不到**什么（如实写下来，别当它是全覆盖）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 如果有人把 `TaskList` 的行 JSX **逐字复制**进 `quadrant/QuadrantBoard.tsx`，
 * A / A2 / B 都会绿 —— 因为渲染结果真的完全一样。
 * 抓这种"逐字复制"的是**另一道**：`check:row-single-source` 的断言 A
 *（「任务行 JSX 全仓只出现在 `packages/ui`」），但它只到**文件**粒度、
 * 不区分 `packages/ui` 内部的两份。所以这条缺口是**已知且未被覆盖的**，
 * 这里如实记下，不假装它不存在。
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
  QuadrantBoard,
  TaskList,
  type QuadrantBoardLabels,
  type TaskRow,
} from '@heyta/ui';

import { useTaskStore } from '../src/features/tasks/store.js';

/**
 * 🔴 **web 宿主**必须**动态** import：它在模块顶层就把 store 拉进来，
 * 而 store 要用 IndexedDB —— 所以上面那两行 `globalThis` 必须先跑完。
 * （与 `categories.spec.tsx` / `trash.spec.tsx` 同一个写法。）
 */
const { QuadrantBoard: WebQuadrantBoard } = await import(
  '../src/features/quadrant/QuadrantBoard.js'
);

/** 稳定的"现在"：2026-09-24 10:00。**不读 `Date.now()`**（否则用例不可复现）。 */
const NOW = new Date(2026, 8, 24, 10, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;

function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: '写方案', createdAt: 0, updatedAt: 0, ...over };
}

/**
 * **两边完全相同的一组 props。**
 *
 * 判据要成立，唯一的变量必须是"谁渲染的行"；所以 `renderMeta` /
 * `renderTrailing` / `labels` 两侧传同一份 —— 否则差异可能来自宿主插槽，
 * 而那不是本判据要管的事。
 */
function sharedRowProps() {
  return {
    onToggleTask: () => undefined,
    labels: {
      toggleOn: (row: TaskRow) => `完成：${row.title}`,
      toggleOff: (row: TaskRow) => `取消完成：${row.title}`,
    },
    renderMeta: (row: TaskRow) => <span data-testid="meta">{row.title}</span>,
    renderTrailing: () => <span data-testid="trail">尾</span>,
  };
}

const LABELS: QuadrantBoardLabels = {
  title: (quadrant) => `标题-${String(quadrant)}`,
  hint: (quadrant) => `说明-${String(quadrant)}`,
  cellA11y: ({ title, hint }) => `象限：${title}，${hint}`,
  empty: () => '拖任务到这里',
  footnote: '底部说明',
};

let roots: Root[] = [];
let containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<HeytaUiProvider>{node}</HeytaUiProvider>);
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
});

/** 取出那颗行（行体外的容器由 `TaskList` 自己给：`task-item-<id>`）。 */
function rowHtml(container: HTMLElement, id: string): string {
  const el = container.querySelector(`[data-testid="task-item-${id}"]`);
  expect(el, `没找到 task-item-${id}`).not.toBeNull();
  return el === null ? '' : el.outerHTML;
}

describe('四象限卡里的行 = 列表里的行', () => {
  it('A. 同一档位（compact）下，两边的行 DOM 逐字节相同', () => {
    const t = task({ important: true, dueDate: NOW + HOUR });
    const props = sharedRowProps();

    // 🔴 列表这一侧必须**显式**传 `density="compact"` —— 象限卡用的就是这一档。
    //    不传（走默认档）时这条断言会红，那正是"象限偷偷退回默认档"的判据。
    const listContainer = mount(<TaskList tasks={[t]} density="compact" {...props} />);
    const boardContainer = mount(
      <QuadrantBoard
        tasks={[t]}
        now={NOW}
        labels={LABELS}
        taskLabels={props.labels}
        onToggleTask={props.onToggleTask}
        renderMeta={props.renderMeta}
        renderTrailing={props.renderTrailing}
      />,
    );

    expect(rowHtml(boardContainer, 't1')).toBe(rowHtml(listContainer, 't1'));
  });

  /**
   * 🔴 **本次最重要的判据**：不同密度必须产生**不同的行**。
   *
   * 上面那条 A 只证明"象限没有另写行" —— 它在象限**根本不传 density** 时
   * 也是绿的（两边都走默认档，DOM 自然一样）。所以 A 单独存在时守不住
   * §4.2 的 `density="compact"` 契约。这一条把"档位真的生效"钉住：
   *
   *   1. 象限那颗行 == `compact` 列表那颗行（同一档位 → 逐字节相同）；
   *   2. 象限那颗行 != **默认档**列表那颗行（不同档位 → 必须不同）。
   *
   * 变异验证（实测，见计划文档的进度行）：
   *   · 把 `QuadrantBoard` 的 `density="compact"` 删掉 → 1 与 2 同时红；
   *   · 把 `DENSITY_SPEC` 的 `compact` 做成与 `comfortable` 相同 → 2 红。
   *
   * ───────────────────────────────────────────────────────────────────
   * 🔴 **这条断言的三条边界（只读审计 2026-09-28 指出，如实记下，不许当它更强）**
   *
   *   (a) **它比的是 RNW 的原子 class 名，不是计算样式。** 实测两档的 class
   *       确实不同（`r-minHeight-peo1c` vs `r-minHeight-10gryf7`），且那些 class
   *       携带真实差异（44px vs 56px、paddingBlock 4px vs 8px）—— 所以它**不是空断言**；
   *       但**被改坏的 class 名同样会让它通过**。
   *   (b) **它不校验方向与幅度。** `compact` 哪天变得比 `comfortable` **更高**，
   *       这条照样绿。真正的方向由 `density.ts` 的 `DENSITY_SPEC` 决定，
   *       而那里目前**只有 `minHeight` 与 `bodyPaddingBlock` 两项真的不同**。
   *   (c) ⚠️ **"结构"这个词说过头了**：两档的 **DOM 树结构完全相同**
   *       （同元素、同 testID、同 role、同插槽），差的是**样式声明**。
   *       真正改结构的只有 `minimal`（`showMeta=false` / `showTrailing=false`）。
   *       ⇒ 所以下面这条 `it` 的**标题**按实测改成"必须不同"，不写"结构"。
   */
  it('A2. 不同档位必须产生不同的行（象限的 compact ≠ 默认档 —— 否则 density 是装饰）', () => {
    const t = task({ important: true, dueDate: NOW + HOUR });
    const props = sharedRowProps();

    const boardContainer = mount(
      <QuadrantBoard
        tasks={[t]}
        now={NOW}
        labels={LABELS}
        taskLabels={props.labels}
        onToggleTask={props.onToggleTask}
        renderMeta={props.renderMeta}
        renderTrailing={props.renderTrailing}
      />,
    );
    // 列表侧的两个档位，用**同一组 props**、同一个实体，唯一变量是 `density`。
    const compactContainer = mount(<TaskList tasks={[t]} density="compact" {...props} />);
    const defaultContainer = mount(<TaskList tasks={[t]} {...props} />);

    const boardRow = rowHtml(boardContainer, 't1');
    const compactRow = rowHtml(compactContainer, 't1');
    const defaultRow = rowHtml(defaultContainer, 't1');

    // 1. 同一档位 → 逐字节相同（与 A 同义，这里再钉一次，失败信息更直白）。
    expect(boardRow, '象限的行与 compact 档的列表行不同 —— 象限没有用 compact').toBe(compactRow);
    // 2. 不同档位 → 结构必须不同。相等就说明 density 只是个装饰参数。
    expect(
      defaultRow,
      '默认档与 compact 档渲染出了逐字节相同的行 —— density 是装饰，不是一个真的维度',
    ).not.toBe(compactRow);
    expect(
      boardRow,
      '象限的行与默认档逐字节相同 —— 象限把密度退回默认档了',
    ).not.toBe(defaultRow);
  });

  it('B. 象限格里的行带勾选框（迁移前那份手写的行没有）', () => {
    const t = task({ important: true, dueDate: NOW + HOUR });
    const props = sharedRowProps();
    const boardContainer = mount(
      <QuadrantBoard
        tasks={[t]}
        now={NOW}
        labels={LABELS}
        taskLabels={props.labels}
        onToggleTask={props.onToggleTask}
      />,
    );

    const toggle = boardContainer.querySelector('[data-testid="task-toggle-t1"]');
    expect(toggle, '象限格里没有勾选框 —— 那一行不是共享 TaskList 渲染的').not.toBeNull();
    // 它真的落在第 1 格（重要且紧急）里，而不是掉在别处。
    expect(boardContainer.querySelector('[data-testid="quadrant-cell-1"]')?.contains(toggle)).toBe(
      true,
    );
  });

  it('四格都在（空格也保留 —— 矩阵的价值就是四格同时在场）', () => {
    const boardContainer = mount(
      <QuadrantBoard
        tasks={[task({ important: true, dueDate: NOW + HOUR })]}
        now={NOW}
        labels={LABELS}
        onToggleTask={() => undefined}
      />,
    );
    const cells = ['1', '2', '3', '4'].map((n) =>
      boardContainer.querySelector(`[data-testid="quadrant-cell-${n}"]`),
    );
    expect(cells.every((c) => c !== null)).toBe(true);
  });
});

/**
 * C. 结构判据（补 A/B 的缺口）：象限组件**自己不许写行**。
 *
 * A 抓不到"逐字复制"（见文件头），所以这里直接盯着源码：
 * `quadrant/QuadrantBoard.tsx` 必须渲染 `TaskList`，并且**不许**出现
 * 任务行的三个特征 —— `accessibilityRole="checkbox"`、`task-toggle-`、
 * 以及行体的 `styles.row`。把卡里的行换成手写的一份，这一条立刻红。
 *
 * ⚠️ 它是**源码级**的（不是行为级），所以刻意窄：只看"有没有自己画一行"。
 * 行别的地方怎么变，它都不管。
 */
describe('四象限组件不自己写行（源码级）', () => {
  /**
   * ⚠️ 用 `process.cwd()` 而不是 `import.meta.url`：本套件跑在 **jsdom** 里，
   * `import.meta.url` 不是 `file:` 协议，`new URL(..., import.meta.url)` +
   * `readFileSync` 会报 `The URL must be of scheme file`（实测）。
   * vitest 的 cwd 是包根（`apps/web`），所以往上是仓库根。
   */
  const SOURCE = readFileSync(
    resolve(process.cwd(), '../../packages/ui/src/quadrant/QuadrantBoard.tsx'),
    'utf8',
  );

  /**
   * 🔴 **先去掉注释再判**。
   *
   * 本文件（和 `QuadrantBoard.tsx` 的文件头）会在注释里**引用**那些"痕迹"
   * 来讲解判据 —— 实测直接扫全文会把文件头里的 `<View><Text>{task.title}
   * </Text></View>` 当成真代码，于是**判据自己被自己的说明文字弄红**。
   * 注释不是实现，判据就不该看它。
   */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('渲染共享 TaskList', () => {
    /**
     * 🔴 断言的是**用**了它（`<TaskList`），不是"import 了它"。
     *
     * 第一版写的是 `toContain("from '../task-list/TaskList.js'")` ——
     * 实测把行换成手写的一份之后**它照样绿**（import 还留着）。
     * "有没有 import"回答的不是"是不是同一个实现"。
     */
    expect(CODE).toContain('<TaskList');
  });

  it('没有任何"自己画一行"的痕迹', () => {
    expect(CODE).not.toContain('accessibilityRole="checkbox"');
    expect(CODE).not.toContain('task-toggle-');
    expect(CODE).not.toContain('TASK_ROW_SHAPE');
    // 手写的行会自己渲染 `task.title`；共享层把它包在 `TaskList` 里。
    expect(CODE).not.toMatch(/\{task\.title\}/);
  });

  it('把档位显式标成 compact（§4.2 的契约：象限卡 = <TaskRow density="compact" />）', () => {
    // 它是"容器决定密度"里**象限这一侧**的落点。改成别档、或删掉这行
    // （退回默认档），行为级的 A/A2 会红，这里给出一条**指到行**的失败信息。
    expect(CODE).toMatch(/density="compact"/);
  });
});

/**
 * D. web 宿主（`features/quadrant/QuadrantBoard.tsx`）**真的接上了**。
 *
 * A/B/C 测的是**共享组件**；宿主那一层（store → 任务、i18n → 文案、
 * dnd-kit → `renderCellOverlay`）如果接错，A/B/C 全都不会红 ——
 * 它们根本不会渲染 web 宿主。所以这里挂一次真宿主，断言四格与格里的行
 * 真的出现在文档里。
 *
 * ⚠️ 它**不**断言交互（拖放、勾选）：那要真浏览器（`e2e/`），
 * 本刀没跑，别把这个冒烟当成"交互验过了"。
 */
describe('web 换装：宿主渲染出四格与共享行', () => {
  it('store 里的一条任务出现在第 1 格，且那一行是共享行', () => {
    const t = task({ important: true, dueDate: NOW + HOUR });
    useTaskStore.setState({
      entities: { ...emptyState(), tasks: { [t.id]: t } },
      now: NOW,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<WebQuadrantBoard />);
    });
    roots.push(root);
    containers.push(container);

    const cell = container.querySelector('[data-testid="quadrant-cell-1"]');
    expect(cell, '四象限里没有第 1 格').not.toBeNull();
    expect(cell?.querySelector('[data-testid="task-item-t1"]'), '格里没有那条任务').not.toBeNull();
    // 共享行的勾选框 —— 宿主传了 `onToggleTask`，所以它必须可点。
    expect(cell?.querySelector('[data-testid="task-toggle-t1"]')).not.toBeNull();
    // 行尾是 web 特有的拖拽握把（整行不可拖，见 web 宿主文件头）。
    expect(container.querySelector('[data-testid="quadrant-drag-t1"]')).not.toBeNull();
  });
});
