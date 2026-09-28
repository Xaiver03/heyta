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
 *   C. **点一行报给宿主**：`onSelect` 收到的是**用户选了哪个**，
 *      不是组件自己改筛选（见 `ProjectsPanel.tsx` 文件头 —— 直接 `setFilter`
 *      会让"人在习惯页点清单"看起来点了没反应）。
 *   D. **删除走宿主 action**：组件不写库。
 *   E. **标签与清单走同一棵骨架**：标签行也有删除、也可点，但**没有计数位**。
 *   F. **web 侧只剩接线**：源码里不再出现行骨架（`ht-nav__item` / `countIn`）。
 *
 * ⚠️ RNW 的 `Pressable` 渲染成 `<div role="button">`（不是 `<button>`），
 * 所以下面一律用 `testID`（RNW → `data-testid`）寻址。
 *
 * ⚠️ 本测试用 `@heyta/ui` 的 **`dist/`**（package exports）。
 * 改完 `packages/ui` 源码必须先 `pnpm --filter @heyta/ui build`，
 * 否则看到的是**上一次构建**的结果。
 */

import { readFileSync } from 'node:fs';
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
  addProject: vi.fn(() => Promise.resolve()),
  addTag: vi.fn(() => Promise.resolve()),
  deleteProject: vi.fn(() => Promise.resolve()),
  deleteTag: vi.fn(() => Promise.resolve()),
  setProjectColor: vi.fn(() => Promise.resolve()),
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
          onSelect={(filter) => {
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
  it('点清单行 → `onSelect` 收到 `{ kind: "project", projectId }`', () => {
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

  it('删除按钮 → 调宿主的 `deleteProject`，且**不**触发 onSelect', () => {
    seed();
    const view = render();
    click(byTestId(view, 'project-p1-remove'));
    expect(actions.deleteProject).toHaveBeenCalledWith('p1');
    expect(selected).toEqual([]);
  });
});

describe('E 标签：与清单同一棵骨架，但没有计数位', () => {
  it('标签行渲染、可点、可删', () => {
    seed();
    const view = render();
    expect(byTestId(view, 'tag-g1-row')).not.toBeNull();

    click(byTestId(view, 'tag-g2-select'));
    expect(selected).toEqual([{ kind: 'tag', tagId: 'g2' }]);

    click(byTestId(view, 'tag-g1-remove'));
    expect(actions.deleteTag).toHaveBeenCalledWith('g1');
  });

  it('标签行**没有**计数位（标签没有"未完成任务数"这个概念）', () => {
    seed([task({ id: 't1', projectId: 'p1' })]);
    const view = render();
    expect(byTestId(view, 'tag-g1-count')).toBeNull();
  });
});

describe('取色入口（宿主插槽）逐行挂上', () => {
  it('每条清单行都有一个 `ht-slot-picker`（顶层 + 子级各一）', () => {
    seed();
    const view = render();
    // p1 / p1a / p2 三行（p9 归档不渲染）。
    expect(view.querySelectorAll('.ht-slot-picker')).toHaveLength(3);
  });
});

describe('F 一份实现：web 侧只剩接线', () => {
  it('web 的 ProjectsPanel 从 `@heyta/ui` 取 `OrganizerList`，自己没有行骨架', () => {
    const source = readFileSync(resolve(WEB_SRC, 'features/projects/ProjectsPanel.tsx'), 'utf8');
    expect(source).toContain('OrganizerList');
    expect(source).toContain("from '@heyta/ui'");
    // 🔴 行骨架不许回来：老实现的标记类名与本地计数函数。
    expect(source).not.toContain('ht-nav__item');
    expect(source).not.toContain('countIn');
  });

  it('共享层：层级 / 计数口径的锚点都在 `projects/model.ts`，组件只用它们', () => {
    const model = readFileSync(resolve(UI_SRC, 'projects/model.ts'), 'utf8');
    expect(model).toContain('export function toOrganizerTree');
    expect(model).toContain('export function openTaskCounts');
    expect(model).toContain('export function topLevelProjects');
    expect(model).toContain('export function childProjects');

    const component = readFileSync(resolve(UI_SRC, 'projects/OrganizerList.tsx'), 'utf8');
    expect(component).toContain('export function OrganizerList');
    // 计数由模型算好传进来 —— 组件里不许自己数任务（第二个口径的来源）。
    expect(component).not.toContain('completedAt');
    expect(component).not.toContain('deletedAt');
  });

  it('web 宿主仍带四个词条字面量（landing 外壳判据读的正是它们）', () => {
    const source = readFileSync(resolve(WEB_SRC, 'features/projects/ProjectsPanel.tsx'), 'utf8');
    expect(source).toContain("t('web.projects.heading')");
    expect(source).toContain("t('web.projects.newPlaceholder')");
    expect(source).toContain("t('web.tags.heading')");
    expect(source).toContain("t('web.tags.newPlaceholder')");
  });
});
