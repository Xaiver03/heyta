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
  addProject: vi.fn(() => Promise.resolve()),
  addTag: vi.fn(() => Promise.resolve()),
  deleteProject: vi.fn(() => Promise.resolve()),
  deleteTag: vi.fn(() => Promise.resolve()),
  setProjectColor: vi.fn(() => Promise.resolve()),
  setProjectParent: vi.fn(() => Promise.resolve()),
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
    expect(text).toContain('还没有清单');
    expect(text).toContain('还没归类的任务都在「收集箱」里，不会丢。');
    expect(text).toContain('还没有标签');
    expect(text).toContain('标签可以跨清单给任务归类');
  });

  it('有数据时空态不许留着（否则"删光了"和"还有东西"长得一样）', () => {
    seed();
    const text = render().textContent ?? '';
    expect(text).not.toContain('还没有清单');
    expect(text).not.toContain('还没有标签');
  });
});

describe('E3 层级：组标题必须压得住它管辖的说明', () => {
  /**
   * 出处：产品负责人 2026-10-02 对着 macOS 壳的侧栏问的
   * 「清单跟标签这两个字应该分别都是标题…那为什么这个标题那么小，
   * 反而是下面说明的文本那么大呢？我们 UI 和 UX 还有设计系统难道没有
   * 定义这种信息的层级的表示吗？」
   *
   * 她那一句里的"难道没有定义"是**问对了的**：侧栏分组头这个角色
   * 在 `TEXT_STYLES` 里从来没有条目，它住在 `sidebar.css` 的三条手写值里
   * （`2xs + semibold + letter-spacing: 0.06em`），而那条组合登记在
   * `check:design` 的豁免表上，理由原文是"档位表无 2xs 档"。
   * 于是"标题"是 11px，"说明"接的是全应用最高频的正文档 `row-title`（16px）。
   *
   * 🔴 三条判据各挡一种回潮：
   *   1. **档位之间存在层级关系** —— 在 `packages/design-system/tests/typography.spec.ts`
   *      （`group-label` 对 `row-meta` / `caption` 必须字号 ≥ 且字重 >）。
   *      没有这条，下一次有人"为了紧凑"把档位调小，界面这边什么都不会红。
   *   2. **DOM 上真的挂着那一档**（下面第一条 it）—— CSS 类已经不自带排版了，
   *      忘挂 `.ht-type-*` 不是"样式没生效"，是**静默回落到继承的 16px 正文**。
   *   3. **每一个用到这个角色的地方都挂了**（遍历那条 it）—— 只测侧栏这一块，
   *      顶栏与日历侧栏就可以各自漏掉，而它们是同一条 CSS 规则。
   */
  it('侧栏的「清单」「标签」标题元素挂着语义档位（CSS 类已不再自带排版）', () => {
    projectsState.projects = [];
    projectsState.tags = [];
    const view = render();
    const headings = [...view.querySelectorAll('h2.ht-nav__section')];
    // 两条，不是一条：「清单」与「标签」必须走同一个角色。
    expect(headings).toHaveLength(2);
    for (const h of headings) {
      expect(h.className, '分组头必须整条消费 .ht-type-* 档位').toContain('ht-type-group-label');
    }
  });

  it('🔴 全 web 壳没有一处 `.ht-nav__section` 漏挂档位（遍历，含顶栏与日历侧栏）', () => {
    /**
     * 为什么遍历而不是逐个点名：漏挂的**症状是静默的** —— 排版从 14/600
     * 变成继承来的 16/400，不报错、不空白，只是层级没了。
     * 而"以后还会有人加一个分组头"是必然的，逐点断言对必然的事没有覆盖力。
     */
    const tsx: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        // ⚠️ 交替里把长的放前面：`.tsx` 先于 `.ts`，否则 `.ts` 会先吃掉 `.tsx`
        //    的前缀，把 .tsx 文件整个漏掉（这条判据就会永远通过）。
        else if (/\.tsx?$/.test(entry.name)) tsx.push(p);
      }
    };
    walk(WEB_SRC);

    const hits: string[] = [];
    const missing: string[] = [];
    for (const file of tsx) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('ht-nav__section')) return;
        hits.push(`${file}:${i + 1}`);
        if (!line.includes('ht-type-')) missing.push(`${file.replace(WEB_SRC, '')}:${i + 1}`);
      });
    }
    // 前提必须成立：一条都没扫到 = 判据不可用（多半是遍历本身坏了）。
    expect(hits.length, '一个 .ht-nav__section 都没扫到 —— 遍历坏了，这条判据不可用').toBeGreaterThan(
      0,
    );
    expect(missing, `漏挂档位的分组头：${missing.join(', ')}`).toEqual([]);
  });

  it('共享空态接的是说明档，不是正文档（`row-title` 不许回来）', () => {
    const component = readFileSync(resolve(UI_SRC, 'projects/OrganizerList.tsx'), 'utf8');
    const emptyBlock = component.slice(
      component.indexOf('if (items.length === 0)'),
      component.indexOf('return (\n    <View style={styles.list}'),
    );
    expect(emptyBlock, '空态主句必须用 row-meta（14），不是 row-title（16）').toContain(
      "text['row-meta']",
    );
    expect(emptyBlock).not.toContain("text['row-title']");
    // 补充句再低一档：caption（12）。三档之间必须仍是单调下降的。
    expect(emptyBlock).toContain('text.caption');

    /*
      🔴 这半条是**本刀自己造出来的**：上面那次变异（把空态换回 row-title）我用的是
      全局字符串替换，它顺手把**行名**的 `row-title` 一起改成了 `row-meta`，
      而 24 条判据**一条都没红** —— 侧栏的清单名当场小一档，没有任何东西拦住。
      "档位被全局替换误伤"不是假想敌，是我十分钟前亲手演示的那件事。
    */
    expect(
      component,
      '行名（清单 / 标签的名字）必须是正文档 row-title',
    ).toContain("text['row-title'], styles.name");
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

/**
 * H「移入文件夹」：按**渲染结果**判，不按源码里有没有那几个字判
 * =============================================================
 *
 * 现场（`seed()`）：p1「工作」= 文件夹（下面挂着 p1a），p1a「汇报」在 p1 里，
 * p2「生活」= 顶级，p9「旧项目」= 已归档。领域规则（`folderTargetsFor`）在这份数据上
 * 给出的答案是三种互不相同的形状，所以下面每条都只钉一个形状：
 *
 *   - **p2**：能进 p1；p1a 不进（它自己就在文件夹里 = 挂过去是第三层）；
 *     p9 不进（归档父默认不画，挂进去这条会从侧栏消失）。
 *   - **p1a**：p1 是它现在的父 —— 候选里但**不许点**（点它 = 写一条内容不变的 UPD，
 *     违反 §3.4"一个用户意图 = 一个 op"）；p2 可点；「不放进文件夹」= 提为顶级，可点。
 *   - **p1**：它是文件夹，`has_children` 把所有目标都挡掉 → 一个候选都没有，
 *     而「不放进文件夹」就是它的当前位置，同样不可点。
 *
 * ⚠️ 这批用例**必须用 `dist/`**（同文件头那条）：改完 `packages/ui` 不 build，
 * 这里验的是上一次构建的组件。
 */
describe('H 移入文件夹：菜单只在选择后出现，选项就是领域给的那些', () => {
  /** 菜单里画出来的候选目标 id（按渲染顺序）。前缀带行 id，所以那个参数是必需的。 */
  const optionIds = (menu: HTMLElement, rowId: string): string[] =>
    Array.from(menu.querySelectorAll(`[data-testid^="web-list-folder-${rowId}-to-"]`)).map((el) =>
      // 🔴 用 `getAttribute` 不用 `dataset.testID`：`data-testid` 在 HTML 里映射成
      // `dataset.testid`（全小写），`dataset.testID` 恒 `undefined` —— 实测那样会得到
      // `Cannot read properties of undefined (reading 'slice')`，症状长得像"候选集坏了"，
      // 而坏的是探针自己。
      el.getAttribute('data-testid')!.slice(`web-list-folder-${rowId}-to-`.length),
    );

  function openFolderMenu(view: HTMLDivElement, id: string): HTMLElement {
    click(byTestId(view, `web-list-folder-${id}-trigger`));
    const menu = byTestId(view, `web-list-folder-${id}-menu`);
    expect(menu, `点「${id}」那行的移入文件夹没有展开菜单`).not.toBeNull();
    return menu!;
  }

  const ariaDisabled = (el: HTMLElement): boolean =>
    el.getAttribute('aria-disabled') === 'true';

  it('没点触发按钮时菜单**不在 DOM 里**（不是"渲染出来但看不见"）', () => {
    seed();
    const view = render();
    expect(byTestId(view, 'web-list-folder-p1-trigger'), '入口没逐行挂上').not.toBeNull();
    expect(byTestId(view, 'web-list-folder-p2-menu')).toBeNull();

    openFolderMenu(view, 'p2');
    expect(byTestId(view, 'web-list-folder-p2-menu')).not.toBeNull();
    // 另一行的菜单不许被一起打开（`open` 是每条行自己的状态）。
    expect(byTestId(view, 'web-list-folder-p1-menu')).toBeNull();
  });

  it('p2 的候选恰好是 p1 —— 别人文件夹里的清单与已归档的清单都不给', () => {
    seed();
    const view = render();
    const menu = openFolderMenu(view, 'p2');
    expect(byTestId(menu, 'web-list-folder-p2-to-p1'), 'p1 是合法目标却没画').not.toBeNull();
    const options = menu.querySelectorAll('[data-testid^="web-list-folder-p2-to-"]');
    expect(
      options,
      `多画了非法目标：${optionIds(menu, 'p2').join(', ') || '（只剩这一条 p1）'}`,
    ).toHaveLength(1);
  });

  it('p1a 的候选 = 它的当前父 p1（标着当前位置、不可点）+ 同为顶级的 p2（可点）', () => {
    seed();
    const view = render();
    const menu = openFolderMenu(view, 'p1a');
    expect(optionIds(menu, 'p1a')).toEqual(['p1', 'p2']);

    const current = byTestId(menu, 'web-list-folder-p1a-to-p1')!;
    expect(ariaDisabled(current), '当前所在文件夹还能点 = 会写一条内容不变的 op').toBe(true);
    expect(current.textContent ?? '').toContain('当前位置');
    expect(ariaDisabled(byTestId(menu, 'web-list-folder-p1a-to-p2')!)).toBe(false);
    // 🔴 光看 `aria-disabled` 不够：那只是"说给自己听的"。真判据是**点它什么都不该发生**
    // —— 把 `disabled` 摘掉而留着 `aria-disabled` 是最坏的一种漂法（读屏说"不可点"，
    // 而鼠标照样能点出一条 no-op op）。
    click(current);
    expect(actions.setProjectParent, '点了"当前位置"却发出了写入').not.toHaveBeenCalled();

    const none = byTestId(menu, 'web-list-folder-p1a-none')!;
    expect(ariaDisabled(none), '在文件夹里的清单应该能提为顶级').toBe(false);
  });

  it('p1 是文件夹：一个候选都没有，而「不放进文件夹」是它的当前位置 → 整块菜单没有可点的', () => {
    seed();
    const view = render();
    const menu = openFolderMenu(view, 'p1');
    expect(menu.querySelectorAll('[data-testid^="web-list-folder-p1-to-"]')).toHaveLength(0);
    const none = byTestId(menu, 'web-list-folder-p1-none')!;
    expect(ariaDisabled(none)).toBe(true);
    expect(none.textContent ?? '').toContain('当前位置');
    click(none);
    expect(actions.setProjectParent, '顶级清单点「不放进文件夹」= 一条 no-op op').not.toHaveBeenCalled();
  });

  it('点候选调 `setProjectParent(这条, 目标)`；点「不放进文件夹」传的是 `undefined` 而不是字符串', () => {
    seed();
    const view = render();

    openFolderMenu(view, 'p2');
    click(byTestId(view, 'web-list-folder-p2-to-p1'));
    expect(actions.setProjectParent).toHaveBeenCalledWith('p2', 'p1');

    openFolderMenu(view, 'p1a');
    click(byTestId(view, 'web-list-folder-p1a-none'));
    // 🔴 必须是 `undefined`：传 `''` 会走到 `parent_not_found`，传 `null` 过不了类型。
    expect(actions.setProjectParent).toHaveBeenLastCalledWith('p1a', undefined);
    // 单独再钉**元数**：`toHaveBeenCalledWith(x, undefined)` 对"只传了一个参数"也成立，
    // 而 `parentId` 键在不在载荷里是动作层文件头第 1 条要区分的那件事。
    const lastCall = actions.setProjectParent.mock.calls.at(-1) as unknown[] | undefined;
    expect(lastCall, '一次都没调用').not.toBeUndefined();
    expect(lastCall!.length, '提到顶级必须显式传第二个参数').toBe(2);
    expect(lastCall![1]).toBeUndefined();
  });

  it('🔴 写失败时，那句"为什么不能移"要出现在界面上（不许只 console）', async () => {
    seed();
    const view = render();
    actions.setProjectParent.mockRejectedValueOnce(
      new Error('改父被拒绝（cycle）：p2 → p1'),
    );

    openFolderMenu(view, 'p2');
    await act(async () => {
      click(byTestId(view, 'web-list-folder-p2-to-p1'));
    });

    const failed = byTestId(view, 'list-folder-failed');
    expect(failed, '移动失败了，但界面上没有任何一句话告诉用户').not.toBeNull();
    // 认的是**机器可读的原因**映射出来的词条原文，不是错误串（里面带着原始 id）。
    expect(failed!.textContent).toBe('这样会形成循环：清单不能放进自己的子清单里');
    expect(failed!.getAttribute('role')).toBe('alert');
  });
});

/**
 * G 新建入口：图标化
 * -------------------
 *
 * 判据来自产品负责人 2026-09-30 的原话：「「+清单」的 UX 设计应该用 icon
 * 或者说是小组件的方式，而不是这么一个东西」—— 迁移前输入框**常驻**在侧栏里，
 * 两个区块各占一行大输入框，把"范围列表"压成了表单页。
 *
 * 所以这里钉的是**形态**，不是"能建清单"（建清单由 E2E `task-organize` 验）：
 *
 *   1. 默认**没有**输入框（不常驻）；
 *   2. 标题右侧的 `+` 是唯一入口，且它展开时 `aria-expanded` 必须变 true；
 *   3. 建完**不收起**（连建几条是常态）；
 *   4. 收起只有两条路：Esc（连草稿一起丢）/ 点到**面板外**（留着草稿）；
 *   5. 🔴 展开按钮与提交按钮**不能同名** —— 同名会让读屏和
 *      `getByRole('button', { name })` 同时命中两个（Playwright strict mode 直接报错）；
 *   6. 🔴 两个区块**一次只开一个 composer**，且互斥必须写在 disclosure 自己的
 *      `onClick` 里，**不许**挂在"点到另一个区块"的 `pointerdown` 上。
 *      真缺陷（2026-09-30 浏览器套件抓到）：清单 composer 开着时点「标签」的 `+`，
 *      区块级收起在 `pointerdown` 就删掉了上面那 52px ⇒ 标签标题整块**往上跳** ⇒
 *      `mouseup` 落在别处 ⇒ `click` 根本不派发给那个按钮 ⇒ "第一下白点"。
 */
describe('G 新建入口：图标化（输入框默认不出现）', () => {
  const inputOf = (view: HTMLElement, label: string) =>
    view.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  const buttonOf = (view: HTMLElement, label: string) =>
    view.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  function type(input: HTMLInputElement, value: string): void {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function submit(view: HTMLElement, label: string): void {
    const form = buttonOf(view, label)!.closest('form')!;
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  }

  it('默认只有 `+`，没有输入框', () => {
    seed();
    const view = render();
    expect(inputOf(view, '新清单名称')).toBeNull();
    expect(inputOf(view, '新标签名称')).toBeNull();
    expect(buttonOf(view, '新建清单')).not.toBeNull();
    expect(buttonOf(view, '新建标签')).not.toBeNull();
    // 🔴 常驻输入框的形态不许回来（placeholder 那一份就是过去的证据）。
    expect(view.querySelector('input[placeholder="新清单"]')).toBeNull();
  });

  it('点 `+` 展开、再点一次收起（`aria-expanded` 跟着走）', () => {
    seed();
    const view = render();
    const reveal = buttonOf(view, '新建清单')!;
    expect(reveal.getAttribute('aria-expanded')).toBe('false');

    click(reveal);
    expect(inputOf(view, '新清单名称')).not.toBeNull();
    expect(buttonOf(view, '新建清单')!.getAttribute('aria-expanded')).toBe('true');

    // 🔴 它是 disclosure 控件，不是只会开的按钮：第二次必须关得掉。
    // （收起不挂在输入框 `blur` 上 —— 点按钮本身就会先 blur，两条逻辑会打架，
    //  症状是"再点一次没反应"。判据就是这一条：把它改回 blur 会红。）
    click(buttonOf(view, '新建清单'));
    expect(inputOf(view, '新清单名称')).toBeNull();
    expect(buttonOf(view, '新建清单')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('提交建一条：走宿主 action、清空草稿、**不收起**', () => {
    seed();
    const view = render();
    click(buttonOf(view, '新建清单'));
    const input = inputOf(view, '新清单名称')!;
    type(input, '深度工作');
    submit(view, '添加清单');

    expect(actions.addProject).toHaveBeenCalledWith('深度工作');
    // 不收起 = 连建几条不用每建一次就重新点开。
    expect(inputOf(view, '新清单名称')).not.toBeNull();
    expect(inputOf(view, '新清单名称')!.value).toBe('');
  });

  it('Esc：清空草稿并收起（这是唯一的显式关闭）', () => {
    seed();
    const view = render();
    click(buttonOf(view, '新建清单'));
    const input = inputOf(view, '新清单名称')!;
    type(input, '没想好');

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(inputOf(view, '新清单名称')).toBeNull();
    expect(buttonOf(view, '新建清单')!.getAttribute('aria-expanded')).toBe('false');

    // 🔴 重新展开必须是**空的**：Esc 说"这次不算"。
    click(buttonOf(view, '新建清单'));
    expect(inputOf(view, '新清单名称')!.value).toBe('');
    expect(actions.addProject).not.toHaveBeenCalled();
  });

  it('点到面板外才收起；草稿不丢', () => {
    seed();
    const view = render();
    click(buttonOf(view, '新建清单'));
    type(inputOf(view, '新清单名称')!, '深度工作');

    const pointerDown = (target: Node) => {
      act(() => {
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      });
    };

    // 🔴 同一个面板内（清单行、色槽、输入框自己、**另一个区块的 `+`**）不许收起 ——
    // 前者会让"给刚建的清单上色"打断表单，后者就是第 6 条判据：区块级收起会把
    // 下一区块的标题顶走，第一下点击白点。
    pointerDown(byTestId(view, 'project-p1-select')!);
    expect(inputOf(view, '新清单名称')).not.toBeNull();

    pointerDown(buttonOf(view, '新建标签')!);
    expect(inputOf(view, '新清单名称')).not.toBeNull();

    pointerDown(document.body);
    expect(inputOf(view, '新清单名称')).toBeNull();
    expect(actions.addProject).not.toHaveBeenCalled();

    // 收起 ≠ 丢弃：重新点开还是那几个字。
    click(buttonOf(view, '新建清单'));
    expect(inputOf(view, '新清单名称')!.value).toBe('深度工作');
  });

  it('一次只开一个 composer：切换在**同一个 click** 里完成', () => {
    seed();
    const view = render();
    click(buttonOf(view, '新建清单'));
    type(inputOf(view, '新清单名称')!, '深度工作');

    // 点「标签」的 `+` 一下：标签 composer 出来，清单 composer 收起。
    // 🔴 变异：拿掉 disclosure onClick 里的 `if (next) setAdding…(false)` ⇒ 这里两个都在。
    click(buttonOf(view, '新建标签'));
    expect(inputOf(view, '新标签名称')).not.toBeNull();
    expect(inputOf(view, '新清单名称')).toBeNull();
    expect(buttonOf(view, '新建清单')!.getAttribute('aria-expanded')).toBe('false');
    expect(buttonOf(view, '新建标签')!.getAttribute('aria-expanded')).toBe('true');

    // 反向再走一次（互斥是对称的，不是只写了半个）。
    click(buttonOf(view, '新建清单'));
    expect(inputOf(view, '新清单名称')).not.toBeNull();
    expect(inputOf(view, '新标签名称')).toBeNull();

    // 被切走的那个只是**收起**，不是丢弃：草稿还在。
    click(buttonOf(view, '新建标签'));
    expect(inputOf(view, '新清单名称')).toBeNull();
    click(buttonOf(view, '新建清单'));
    expect(inputOf(view, '新清单名称')!.value).toBe('深度工作');
  });

  it('标签走同一套形态；可访问名在任何展开态都唯一', () => {
    seed();
    const view = render();
    click(buttonOf(view, '新建标签'));
    expect(inputOf(view, '新标签名称')).not.toBeNull();

    const names = ['新建清单', '添加清单', '新建标签', '添加标签'];
    for (const name of names) {
      expect(view.querySelectorAll(`button[aria-label="${name}"]`).length, name).toBeLessThanOrEqual(
        1,
      );
    }
    // 🔴 一次只开一个 composer ⇒ 切到清单后，标签的提交按钮**不在 DOM 里**。
    // 两个 disclosure 按钮始终各一个（它们是常驻入口），提交按钮只有开着的那个有。
    click(buttonOf(view, '新建清单'));
    expect(view.querySelectorAll('button[aria-label="添加清单"]').length).toBe(1);
    expect(view.querySelectorAll('button[aria-label="添加标签"]').length).toBe(0);
    for (const name of ['新建清单', '新建标签']) {
      expect(view.querySelectorAll(`button[aria-label="${name}"]`).length, name).toBe(1);
    }
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

  it('🔴 侧栏的数据源必须是两路合并（W9 之后开关才有数据可放出来）', () => {
    // `listProjects()` 从 W9 起**不含归档**（归档不进任何出口，P-9），
    // 而本面板的「显示已归档」开关与 `archivedCount` 都要求归档那一路在数据里。
    // 读错那一路的症状不是报错 —— 是"开关按了什么都没出现"。
    const store = readFileSync(resolve(WEB_SRC, 'features/projects/store.ts'), 'utf8');
    expect(store).toContain('projectActions.listAllProjects()');
    expect(store).not.toContain('projectActions.listProjects()');

    const panel = readFileSync(resolve(WEB_SRC, 'features/projects/ProjectsPanel.tsx'), 'utf8');
    expect(panel).toContain('archivedProjects(projects.projects)');
    expect(panel).toContain('includeArchived: showArchived');
  });
});

/**
 * W4b · 标签删除确认（回收站与归档批次 B）
 * ------------------------------------------
 *
 * 产品裁决（§7.1 P-1）：标签**不进回收站**，重建成本≈0，所以唯一的防护是
 * "删之前告诉你影响几条任务"。这一步住在共享 `OrganizerList`（`labels.confirmRemove`），
 * 两端同一份 —— 这里钉的是**渲染结果**，因为坏法恰恰是"确认框画了，按下还是直接删"
 * 和"数字用了行上那个常驻计数"，两者都不报错、都不空白，只有点下去才看得出来。
 *
 * 🔴 变异对照（本轮实测，读数写在计划 §11.12）：
 *   · 把 `onPress` 里的 `setPendingRemove` 换成 `onRemove` ⇒ 前两条红；
 *   · 把宿主传的 `removeImpact` 换成 `tagCounts` ⇒ 只有「两个数字同时在场」那条红
 *     —— 也就是说**这一条是唯一能抓住"口径用错"的**，别把它当冗余删掉。
 */
describe('W4b 标签删除确认：一次点击不许写 op', () => {
  /** g1 上挂：1 条未完成 + 2 条已完成 + 1 条墓碑 ⇒ 影响面 3，常驻计数 1。 */
  function seedImpact(): void {
    seed([
      task({ id: 't1', tagIds: ['g1'] }),
      task({ id: 't2', tagIds: ['g1'], completedAt: NOW }),
      task({ id: 't3', tagIds: ['g1'], deletedAt: NOW }),
      task({ id: 't4', tagIds: ['g1'], completedAt: NOW }),
    ]);
  }

  it('点删除 → 确认行出现，`deleteTag` **一次都没调**', () => {
    seedImpact();
    const view = render();
    click(byTestId(view, 'tag-g1-remove'));
    expect(actions.deleteTag).not.toHaveBeenCalled();
    const confirm = byTestId(view, 'tag-g1-confirm');
    expect(confirm, '确认行没出现').not.toBeNull();
    expect(confirm!.textContent).toContain('确定要删除「紧急」吗？');
    // 原来那个删除按钮**收起来**了：armed 态下再点它不该有第二种含义。
    expect(byTestId(view, 'tag-g1-remove')).toBeNull();
  });

  it('点「确认删除」→ `deleteTag` 恰好一次，确认行随之消失', () => {
    seedImpact();
    const view = render();
    click(byTestId(view, 'tag-g1-remove'));
    click(byTestId(view, 'tag-g1-confirm-yes'));
    expect(actions.deleteTag).toHaveBeenCalledTimes(1);
    expect(actions.deleteTag).toHaveBeenCalledWith('g1');
    expect(byTestId(view, 'tag-g1-confirm')).toBeNull();
  });

  it('点「取消删除」→ 一条 op 都不写，行回到常态', () => {
    seedImpact();
    const view = render();
    click(byTestId(view, 'tag-g1-remove'));
    click(byTestId(view, 'tag-g1-confirm-no'));
    expect(actions.deleteTag).not.toHaveBeenCalled();
    expect(byTestId(view, 'tag-g1-confirm')).toBeNull();
    expect(byTestId(view, 'tag-g1-remove'), '取消后必须还能再删').not.toBeNull();
  });

  it('🔴 那句影响面 = 3（含已完成），同一趟里行上的常驻计数 = 1', () => {
    seedImpact();
    const view = render();
    expect(byTestId(view, 'tag-g1-count')?.textContent).toBe('1');
    click(byTestId(view, 'tag-g1-remove'));
    expect(byTestId(view, 'tag-g1-confirm')?.textContent).toContain('它挂在 3 条任务上');
    // 措辞必须把"任务不会被删除"说出来 —— 只有数字的话读起来仍像"会动那 3 条"。
    expect(byTestId(view, 'tag-g1-confirm')?.textContent).toContain('这些任务不会被删除');
  });

  it('没有存活任务时**不画**那句影响面（宁可少说一句，不编"挂在 0 条上"）', () => {
    seed();
    const view = render();
    click(byTestId(view, 'tag-g2-remove'));
    expect(byTestId(view, 'tag-g2-confirm')?.textContent).toContain('确定要删除「等回复」吗？');
    expect(byTestId(view, 'tag-g2-confirm')?.textContent).not.toContain('它挂在');
  });

  it('一次只 armed 一行（两条同时 armed 时"确认删除"落在哪条只能靠猜）', () => {
    seed();
    const view = render();
    click(byTestId(view, 'tag-g1-remove'));
    expect(byTestId(view, 'tag-g1-confirm')).not.toBeNull();
    click(byTestId(view, 'tag-g2-remove'));
    expect(byTestId(view, 'tag-g1-confirm'), '第一条的确认行没收回').toBeNull();
    expect(byTestId(view, 'tag-g2-confirm')).not.toBeNull();
    expect(actions.deleteTag).not.toHaveBeenCalled();
  });

  it('清单行**不受影响**：仍然一次点击直接删，且没有确认行（默认形态逐字相同）', () => {
    seed();
    const view = render();
    expect(byTestId(view, 'project-p1-confirm')).toBeNull();
    click(byTestId(view, 'project-p1-remove'));
    expect(actions.deleteProject).toHaveBeenCalledWith('p1');
  });
});
