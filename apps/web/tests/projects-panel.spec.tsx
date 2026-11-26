/**
 * 判据：**清单 / 标签的行只有 `packages/ui` 那一份实现**
 * ==========================================================
 *
 * 出处：`docs/plans/multi-platform-adaptation.md` 的 M3「每轮的固定流程」
 * 第 1–2 步，以及 §判据 A「该特性在 `apps/web` 与 `apps/mobile` 下
 * **不再各有一份实现**」。
 *
 * 迁移前 web 的侧栏自己拼行（`<button class="ht-nav__item">` + `countIn`），
 * 移动端「我的」页又是一份（kit `Text` 平表、没有计数、没有层级）——
 * 两端对"清单有且只有一层嵌套"这条**领域规则**有两种界面表现，而差异
 * **不会让任何测试变红**。现在两端都渲染 `@heyta/ui` 的 `OrganizerList`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 判据怎么定的
 *
 *   A. **层级**：顶层行是列表的直接子节点，子清单行嵌在缩进容器里。
 *   B. **计数口径**：未完成 + 未删除 + 属于这条清单；`0` 不渲染计数位
 *      （与 `App.tsx` 的 `NavButton` 同一条 `count > 0`）。
 *   C. **点一行报给宿主**：`onFilterWith` 收到的是**用户选了哪个**，
 *      不是组件自己改筛选（见 `ProjectsPanel.tsx` 文件头 —— 直接 `setFilter`
 *      会让"人在习惯页点清单"看起来点了没反应）。
 *   D. **删除走宿主 action**：组件不写库。
 *   E. **标签与清单走同一棵骨架**：标签行也有删除、也可点，**也有计数位**。
 *      （2026-10-01 改：这条以前钉的是"标签**没有**计数位"，理由写的是
 *      "标签没有未完成任务数这个概念" —— 参照图（滴答侧栏）逐行都有数字，
 *      而那个概念在领域里本来就成立（一条任务挂着 `tagIds`）。
 *      真正缺的从来不是语义，是**没人算过**。）
 *   F. **web 侧只剩接线**：源码里不再出现行骨架（`ht-nav__item` / `countIn`）。
 *
 * ⚠️ RNW 的 `Pressable` 渲染成 `<div role="button">`（不是 `<button>`），
 * 所以下面一律用 `testID`（RNW → `data-testid`）寻址。
 *
 * ⚠️ 本测试用 `@heyta/ui` 的 **`dist/`**（package exports）。
 * 改完 `packages/ui` 源码必须先 `pnpm --filter @heyta/ui build`，
 * 否则看到的是**上一次构建**的结果。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project, Tag, Task } from '@heyta/domain';
import { I18nProvider } from '@heyta/i18n';

const NOW = 1_700_000_000_000;

/** 动作桩 —— 写入路径本身由 `@heyta/app-host` 的测试覆盖。 */
const actions = vi.hoisted(() => ({
  addProject: vi.fn(() => Promise.resolve(undefined as string | undefined)),
  addTag: vi.fn(() => Promise.resolve(undefined as string | undefined)),
  deleteProject: vi.fn(() => Promise.resolve()),
  deleteTag: vi.fn(() => Promise.resolve()),
  setProjectColor: vi.fn(() => Promise.resolve()),
  setProjectParent: vi.fn(() => Promise.resolve()),
  renameProject: vi.fn(() => Promise.resolve()),
  archiveProject: vi.fn(() => Promise.resolve()),
}));

const projectsState = vi.hoisted(() => ({
  projects: [] as unknown[],
  tags: [] as unknown[],
}));

/** 任务表也放进 hoisted 状态：mock 工厂在 import 之前就执行，闭包变量拿不到。 */
const tasksState = vi.hoisted(() => ({ entities: { tasks: {} as Record<string, unknown> } }));

vi.mock('../src/features/projects/store.js', () => ({
  useProjectStore: () => ({ ...projectsState, ...actions }),
}));

vi.mock('../src/features/tasks/store.js', () => ({
  useTaskStore: () => tasksState,
}));

const { ProjectsPanel } = await import('../src/features/projects/ProjectsPanel.js');

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * 只读接缝，只给故障注入用（把目录复制到 `/tmp`、改一处、指过去，
 * 证明"真实现漂了 → 红"）。不设它们时就是真实路径。
 */
const WEB_SRC = process.env.HEYTA_PROJECTS_WEB_SRC ?? resolve(HERE, '../src');
const UI_SRC = process.env.HEYTA_PROJECTS_UI_SRC ?? resolve(HERE, '../../../packages/ui/src');

function project(over: Partial<Project> & { id: string; name: string }): Project {
  return { createdAt: NOW, updatedAt: NOW, ...over };
}

function tag(id: string, name: string): Tag {
  return { id, name, createdAt: NOW, updatedAt: NOW };
}

function task(over: Partial<Task> & { id: string }): Task {
  return { createdAt: NOW, updatedAt: NOW, title: over.id, ...over };
}

/**
 * 样例数据：
 *   p1「工作」← 顶层，3 条任务里**只有 1 条计入**（另 1 完成 / 1 删除）
 *   p1a「汇报」← p1 的子清单，0 条 → **不该有计数位**
 *   p2「生活」← 顶层，1 条计入
 */
function seed(tasks: Task[] = []): void {
  projectsState.projects = [
    project({ id: 'p1', name: '工作' }),
    project({ id: 'p1a', name: '汇报', parentId: 'p1' }),
    project({ id: 'p2', name: '生活' }),
    project({ id: 'p9', name: '旧项目', archived: true }),
  ];
  projectsState.tags = [tag('g1', '紧急'), tag('g2', '等回复')];
  tasksState.entities.tasks = Object.fromEntries(tasks.map((t) => [t.id, t]));
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let selected: unknown[] = [];

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

beforeEach(() => {
  selected = [];
  tasksState.entities.tasks = {};
  for (const fn of Object.values(actions)) fn.mockClear();
});

afterEach(() => {
  if (root !== undefined) {
    act(() => {
      root?.unmount();
    });
    root = undefined;
  }
  container?.remove();
  container = undefined;
});

function render(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <I18nProvider locale="zh-CN">
        <ProjectsPanel
          onFilterWith={(filter) => {
            selected.push(filter);
          }}
        />
      </I18nProvider>,
    );
  });
  return container;
}

function byTestId(el: HTMLElement, id: string): HTMLElement | null {
  return el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function click(el: HTMLElement | null): void {
  expect(el, '要点的元素不存在 —— 判据锚点已失效').not.toBeNull();
  act(() => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('A/B 清单：层级 + 计数口径', () => {
  it('顶层清单渲染成行；子清单也渲染，但它**不是列表的直接子节点**（缩进一层）', () => {
    seed([
      task({ id: 't1', projectId: 'p1' }),
      task({ id: 't2', projectId: 'p1', completedAt: NOW }),
      task({ id: 't3', projectId: 'p1', deletedAt: NOW }),
      task({ id: 't4', projectId: 'p2' }),
    ]);
    const view = render();
    const list = byTestId(view, 'projects-list');
    expect(list).not.toBeNull();

    const top = byTestId(view, 'project-p1-row');
    const child = byTestId(view, 'project-p1a-row');
    expect(top, '顶层清单 p1 没渲染').not.toBeNull();
    expect(child, '子清单 p1a 没渲染 —— 层级被压平了').not.toBeNull();
    // 归档清单**不渲染**（aliveProjects 的语义）。
    expect(byTestId(view, 'project-p9-row')).toBeNull();

    // 🔴 缩进是真的：子行不在列表的直接子层（中间有一层 children 容器）。
    expect(child!.parentElement).not.toBe(list);
    expect(list!.contains(child!)).toBe(true);
    // 顶层行与子行**是同一棵骨架**（同一个 testID 命名空间），只是缩进不同。
    expect(top!.parentElement).toBe(list);
  });

  it('计数 = 未完成 + 未删除 + 属于这条清单；`0` 不渲染计数位', () => {
    seed([
      task({ id: 't1', projectId: 'p1' }),
      task({ id: 't2', projectId: 'p1', completedAt: NOW }),
      task({ id: 't3', projectId: 'p1', deletedAt: NOW }),
      task({ id: 't4', projectId: 'p2' }),
      task({ id: 't5' }), // 收集箱，不算任何清单
    ]);
    const view = render();
    expect(byTestId(view, 'project-p1-count')?.textContent).toBe('1');
    expect(byTestId(view, 'project-p2-count')?.textContent).toBe('1');
    // p1a 没有任务 → 计数位**不存在**（不是显示 0）。
    expect(byTestId(view, 'project-p1a-count')).toBeNull();
  });
});

describe('C/D 清单：点一行报给宿主，删除走 action', () => {
  it('点清单行 → `onFilterWith` 收到 `{ kind: "project", projectId }`', () => {
    seed();
    const view = render();
    click(byTestId(view, 'project-p1-select'));
    expect(selected).toEqual([{ kind: 'project', projectId: 'p1' }]);
  });

  it('点子清单行 → 报的是子清单自己的 id（不是父的）', () => {
    seed();
    const view = render();
    click(byTestId(view, 'project-p1a-select'));
    expect(selected).toEqual([{ kind: 'project', projectId: 'p1a' }]);
  });

  it('删除要**两步**：第一下只出确认行，第二下才调宿主的 `deleteProject`，且全程不触发 onFilterWith', () => {
    seed();
    const view = render();
    click(byTestId(view, 'project-p1-remove'));
    expect(actions.deleteProject, '一次点击就写 op —— 这条清单底下还挂着子清单').not.toHaveBeenCalled();
    expect(byTestId(view, 'project-p1-confirm'), '确认行没出现').not.toBeNull();
    click(byTestId(view, 'project-p1-confirm-yes'));
    expect(actions.deleteProject).toHaveBeenCalledWith('p1');
    expect(selected).toEqual([]);
  });
});

describe('E 标签：与清单同一棵骨架，计数口径也是同一套', () => {
  it('标签行渲染、可点；删除要**两步**（W4b 之后）', () => {
    seed();
    const view = render();
    expect(byTestId(view, 'tag-g1-row')).not.toBeNull();

    click(byTestId(view, 'tag-g2-select'));
    expect(selected).toEqual([{ kind: 'tag', tagId: 'g2' }]);

    // 🔴 这一条**改过**（原话是"点 `tag-g1-remove` → `deleteTag('g1')`"）。
    // 改它不是因为测试坏了，是因为**产品语义变了**：§7.1 P-1 拍板标签不进回收站
    // （重建成本≈0），于是删之前告知影响面是唯一的防护 —— 而按下即写 op 时，
    // 那句告知没有任何一处能出现。判据跟着改成"点删除只出确认行"，
    // 完整的两步在下面的 `W4b` 那一块逐条钉。
    click(byTestId(view, 'tag-g1-remove'));
    expect(actions.deleteTag).not.toHaveBeenCalled();
    expect(byTestId(view, 'tag-g1-confirm')).not.toBeNull();
  });

  it('计数 = 挂着这个标签的未完成任务；一条任务挂两个标签则**两边各 +1**', () => {
    seed([
      task({ id: 't1', tagIds: ['g1'] }),
      task({ id: 't2', tagIds: ['g1', 'g2'] }),
      task({ id: 't3', tagIds: ['g1'], completedAt: NOW }),
      task({ id: 't4', tagIds: ['g1'], deletedAt: NOW }),
      task({ id: 't5' }), // 没挂任何标签
    ]);
    const view = render();
    expect(byTestId(view, 'tag-g1-count')?.textContent).toBe('2');
    expect(byTestId(view, 'tag-g2-count')?.textContent).toBe('1');
  });

  it('没有任务的标签**不渲染计数位**（与清单行同一条 `count > 0`）', () => {
    seed([task({ id: 't1', tagIds: ['g1'] })]);
    const view = render();
    expect(byTestId(view, 'tag-g1-count')?.textContent).toBe('1');
    expect(byTestId(view, 'tag-g2-count')).toBeNull();
  });
});

/**
 * E2 空态卡：一条清单/标签都没有时，**这两块不许是空白**。
 *
 * 共享层 `OrganizerList` 早就支持 `labels.empty/emptyHint`，但 web 侧栏
 * 过去只传了 `removeLabel` —— 于是"还没有清单"这个状态在界面上表现为
 * 一块什么都没有的空白，而移动端同一状态有一句说明。参照图（滴答 macOS 端）
 * 明确给了一张占位说明卡，所以这一条按**渲染结果**钉，而不是按源码里
 * 有没有那几个字（源码级断言在 `apps/mobile/tests/projects-sections.spec.ts`）。
 */
describe('E2 空态：一块空白不算空态', () => {
  it('零清单零标签时，两块各给一句标题 + 一句说明', () => {
    projectsState.projects = [];
    projectsState.tags = [];
    const view = render();
    const text = view.textContent ?? '';
    // 标题 + hint 都要在：只有标题的话，用户仍然不知道"没清单"意味着什么。
    /*
      ⚠️ 2026-11-16：说明文案跟着**新建入口**换过一次。

      从前入口是"右侧那颗 +"，所以 hint 写的是「点右侧 + 新建清单。」；
      如果再照旧写"点右侧 +"，用户会去找一颗不存在的按钮。

      这条测试守的东西没变：标题 + hint **两句都要在**（只有标题的话，
      用户仍然不知道"没清单"意味着什么）。
    */
    expect(text).toContain('还没有清单');
    expect(text).toContain('还没有标签');
  });

  it('有数据时空态不许留着（否则"删光了"和"还有东西"长得一样）', () => {
    seed();
    const text = render().textContent ?? '';
    expect(text).not.toContain('还没有清单');
    expect(text).not.toContain('还没有标签');
  });
});

/**
 * D3 分组说明（2026-11-25 起删除）。
 *
 * AGENTS §0.2：界面不写解释文字。分组头下不再挂"这一格装的是什么"，
 * 有内容时它本来就是噪音，空着时也由空白与 `+` 表达。
 */
describe('D3 分组说明已移除', () => {
  it('有清单、有标签时，分组头下没有说明文字', () => {
    seed();
    const view = render();
    expect(view.querySelector('[data-testid="projects-heading-hint"]')).toBeNull();
    expect(view.querySelector('[data-testid="tags-heading-hint"]')).toBeNull();
  });

  it('空列表时也没有说明文字，只留空态事实', () => {
    projectsState.projects = [];
    projectsState.tags = [];
    const view = render();
    expect(view.querySelector('[data-testid="projects-heading-hint"]')).toBeNull();
    expect(view.querySelector('[data-testid="tags-heading-hint"]')).toBeNull();
    expect(view.textContent ?? '').toContain('还没有清单');
  });
});
