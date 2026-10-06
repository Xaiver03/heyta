/**
 * 外壳与样例数据的**会红约束**（landing 复刻 ⟷ 真应用）
 * ======================================================
 *
 * 背景：`docs/research/showcase-fidelity-audit.md` §2（五项漂移）与 §6.2
 * （「这条门禁还没做」）。`mockup-fidelity.spec.tsx` 是上一轮的回归钉，
 * 但它把 `APP_VIEW_TABS` / `APP_PRIMARY_NAV` **又抄了一份**在测试里 ——
 * 于是真应用改了、复刻没改时，它**照样全绿**。§6.2 要的正是那一步：
 *
 * > 从 `apps/web/src/features/shell/view-tabs.ts` 读出 `PRIMARY_NAV` / `QUADRANT_NAV` / `VIEW_TABS`（2026-10-02 前在 App.tsx）
 * > 的**项数与标签 key**，与 `apps/landing/src/mockup/AppWindow.tsx` 里引用的
 * > key 集合比对，不等就红。
 *
 * 本文件就是它，并且把"事实"提成了两个**纯数据模块**（都不 import React）：
 *
 *   · `src/mockup/app-shell-shape.ts` —— 外壳结构（导航项 / 视图 tab / 面板区块）；
 *   · `src/mockup/showcase-data.ts`  —— 唯一一份样例任务 + 由它派生的象限计数。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么本文件不 import `@heyta/domain`
 *
 * `@heyta/domain` 没有声明为 `apps/landing` 的依赖，而本轮的写入租约
 * **不允许改 `pnpm-lock.yaml`**（只许动 `apps/landing/**`）。所以这里用
 * **相对路径**直取领域层的纯源码 —— 这是**测试专用**的接缝：领域层是纯 TS、
 * 无框架依赖（见 `packages/domain/src/quadrant.ts` 文件头），能在 vitest 里加载；
 * 而**生产代码一行也不引它**（落地页首屏不为一个展示件多背字节）。
 * 这一步换来的是：象限计数不是"再抄一份阈值"，而是**用产品自己的函数重算一遍**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 逐条漂移 → 这里怎么红
 *
 * | 漂移（审计 §2） | 这里怎么红 |
 * |---|---|
 * | #1 漏「已完成」/ 漏「最近 7 天」 | 登记处与 `PRIMARY_NAV` 逐项对不上 → 红 |
 * | #2 编造象限计数 | 渲染出的计数 ≠ `bucketByQuadrant(SHOWCASE_TASKS)` → 红 |
 * | #4 漏标签区 | 登记处与 `ProjectsPanel` 的两块区块对不上 → 红 |
 * | #5 视图 tab 4 vs 9 | 登记处与 `VIEW_TABS` 的九项对不上 → 红 |
 * | 另外：web 改了而复刻没跟 | 上面每一条都会红（对账的是 web 的**源码文本**） |
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { I18nProvider, zhCN } from '@heyta/i18n';

import { bucketByQuadrant, classifyQuadrant } from '../../../packages/domain/src/quadrant.js';
import { Priority, type Task } from '../../../packages/domain/src/entities.js';
import { AppWindow } from '../src/mockup/AppWindow.js';
import {
  SHELL_HEADER_ACTIONS,
  SHELL_HEADER_MOVED_OUT,
  SHELL_PANEL_SECTIONS,
  SHELL_PRIMARY_NAV,
  SHELL_QUADRANT_NAV,
  SHELL_QUADRANT_SECTION_KEY,
  SHELL_VIEW_TABS,
} from '../src/mockup/app-shell-shape.js';
import {
  SHOWCASE_NOW,
  SHOWCASE_TASKS,
  showcaseQuadrantCounts,
} from '../src/mockup/showcase-data.js';
import { readWebAppSource, readWebSource, stripComments } from './helpers/source-text.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');

/**
 * 真应用源码的位置与读取器住在 `./helpers/source-text.ts` —— `HEYTA_MOCKUP_WEB_SRC`
 * 那枚故障注入接缝（把 `apps/web/src` 复制到临时树、在副本上改一处、再把本变量指过去，
 * 就能证明"真应用改了而复刻没跟 → 会红"，而不必碰共享工作区里的 `apps/web`）也在那里，
 * 两份判据共用同一枚旋钮、同一套剥注释规则。
 */
const appSource = readWebAppSource;

/** 视图/导航登记（2026-10-02 起从 App.tsx 抽到独立文件，声明逐字未动）。 */
function viewTabsSource(): string {
  return readWebSource('features/shell/view-tabs.ts');
}

/** NavButton（计数位的 `count > 0` / `ht-nav__count` 在这份文件里）。 */
function navButtonSource(): string {
  return readWebSource('features/shell/NavButton.tsx');
}

function projectsPanelSource(): string {
  return readWebSource('features/projects/ProjectsPanel.tsx');
}

function taskStoreSource(): string {
  return readWebSource('features/tasks/store.ts');
}

/** 从源码里切出一个 `const X = [ … ];` 数组登记块。切不到 = 报错，不是"跳过"。 */
function arrayBlock(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`源码里找不到 ${declaration} —— 判据锚点已失效`);
  const end = source.indexOf('];', start);
  if (end < 0) throw new Error(`${declaration} 之后找不到 \`];\` —— 判据锚点已失效`);
  return source.slice(start, end);
}

/** 抽出块里全部 `field: '…'` 的值，按出现顺序。 */
function fieldValues(block: string, field: string): string[] {
  return [...block.matchAll(new RegExp(`(?<![A-Za-z])${field}:\\s*'([^']+)'`, 'g'))].map(
    (match) => match[1] ?? '',
  );
}

/**
 * 真应用的**默认 rail** 的 `key` / `labelKey`，按 DOM 顺序。
 *
 * 🔴 **2026-09-29 起它不再是"`VIEW_TABS` 的全部 9 项"。**
 * 产品负责人要求"左侧按钮尽可能地减少"，于是加了**功能模块开关**
 * （`apps/web/src/features/shell/modules.ts`）：关掉的模块**根本不进 DOM**。
 * 所以访客看到的那张界面图应当画**默认**（新装用户看到的）那一份：
 *
 * ```
 * 上段  任务 + 默认开启的模块（四象限 / 习惯 / 时间线）
 * 下段  工具（回收站 / 设置）—— 贴底
 * ```
 *
 * ⚠️ **这里必须读第二份源码**（`shell/modules.ts` 的 `defaultOn`）。
 * 只读 `App.tsx` 的话，"默认开哪几个"这个事实不在这份文件里，
 * 而对账就会退化成"数一数有几个常量"—— 那正是这条门禁被发明出来要防的东西。
 */
function appDefaultRail(): { keys: string[]; labelKeys: string[] } {
  const source = viewTabsSource();

  const pairsOf = (declaration: string): { key: string; labelKey: string }[] =>
    [
      ...arrayBlock(source, declaration).matchAll(
        /\{\s*key:\s*'([^']+)',\s*labelKey:\s*'([^']+)'/g,
      ),
    ].map((match) => ({ key: match[1] ?? '', labelKey: match[2] ?? '' }));

  const alwaysOn = pairsOf('const ALWAYS_ON_VIEW_TABS');
  const modules = pairsOf('const MODULE_VIEW_TABS');
  // 🔴 「搜索」是**单个对象**（不是一个数组），而且它常驻。
  // 它一度是硬编码在 JSX 里的按钮，于是这条对账**看不见它** ——
  // rail 上多了一个 tab 而门禁照样绿。现在它也是常量，必须一起算进来。
  //
  // ⚠️ 它**不能**用 `pairsOf`：那个走 `arrayBlock`（找 `];`），而单个对象以 `};` 结尾 ——
  //    会一路吃到下一个 `];`，把后面的常量全吞进来（实测：算出 8 项而不是 7 项）。
  const search = ((): { key: string; labelKey: string }[] => {
    const src = viewTabsSource();
    const start = src.indexOf('const SEARCH_VIEW_TAB');
    if (start < 0) throw new Error('view-tabs.ts 里找不到 const SEARCH_VIEW_TAB —— 判据锚点已失效');
    const end = src.indexOf('};', start);
    if (end < 0) throw new Error('const SEARCH_VIEW_TAB 之后找不到 `};` —— 判据锚点已失效');
    return [
      ...src.slice(start, end).matchAll(/\{\s*key:\s*'([^']+)',\s*labelKey:\s*'([^']+)'/g),
    ].map((m) => ({ key: m[1] ?? '', labelKey: m[2] ?? '' }));
  })();
  const tools = pairsOf('const TOOL_VIEW_TABS');

  // 模块的默认开关 —— 从 `modules.ts` 的 registry 里抠（key 与 defaultOn 配对，
  // 顺序在这份文件里是"先 key 后 defaultOn"）。
  const modulesSource = readFileSync(
    resolve(HERE, '../../web/src/features/shell/modules.ts'),
    'utf8',
  );
  const defaults = new Map(
    [
      ...arrayBlock(modulesSource, 'const SHELL_MODULES').matchAll(
        /key:\s*'([^']+)'[\s\S]*?defaultOn:\s*(true|false)/g,
      ),
    ].map((match) => [match[1] ?? '', match[2] === 'true']),
  );

  const enabledModules = modules.filter((m) => defaults.get(m.key) === true);
  const shown = [...alwaysOn, ...enabledModules, ...search, ...tools];
  return { keys: shown.map((p) => p.key), labelKeys: shown.map((p) => p.labelKey) };
}

/**
 * jsdom 不实现 `ResizeObserver`，而 `AppWindow` 用它算缩放比。
 * 这是**测试环境的缺口**，不是产品缺陷 —— 补一个空实现让 effect 跑完。
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  if (root !== null) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
});

function renderMockup(view: 'tasks' | 'quadrant' | 'habits' | 'focus' = 'tasks'): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <AppWindow view={view} />
      </I18nProvider>,
    );
  });
  return container;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 把展厅样例任务翻译成领域层的 `Task`（`dueInDays` → `dueDate`）。 */
function toDomainTask(task: (typeof SHOWCASE_TASKS)[number]): Task {
  return {
    id: task.id,
    createdAt: SHOWCASE_NOW,
    updatedAt: SHOWCASE_NOW,
    title: task.titleKey,
    priority: task.priority as Priority | undefined,
    important: task.important,
    dueDate:
      task.dueInDays === undefined
        ? undefined
        : SHOWCASE_NOW + task.dueInDays * MS_PER_DAY,
    completedAt: task.done === true ? SHOWCASE_NOW : undefined,
  };
}

describe('#1 主导航：登记处 ⟷ 真应用 `PRIMARY_NAV`', () => {
  it('登记的每一项与 `App.tsx` 的 `PRIMARY_NAV` 逐项同 key、同序', () => {
    const appKeys = fieldValues(arrayBlock(viewTabsSource(), 'const PRIMARY_NAV'), 'labelKey');
    // ⚠️ 「收集箱」在 2026-10-04 被删（产品负责人：与页头标题重复 = 同一目的地两个入口）。
    // 这条字面清单是**解析器的阳性对照**：它证明上面那串真读出了东西，
    // 而不是在 `PRIMARY_NAV` 改名/挪位置之后恒返回空集。
    expect(appKeys).toEqual([
      'web.shell.nav.today',
      'web.shell.nav.next7Days',
      'web.shell.nav.completed',
    ]);
    expect(SHELL_PRIMARY_NAV.map((item) => item.labelKey)).toEqual(appKeys);
  });

  it('渲染出的侧栏主导航含「已完成」，且登记的每一项都在', () => {
    const view = renderMockup();
    // 只取第一组 `.mk-nav`（主导航）—— 第二组是四象限。
    const navItems = [...view.querySelectorAll('.mk-sidebar .mk-nav')][0]?.querySelectorAll(
      '.mk-nav__item',
    );
    const labels = [...(navItems ?? [])].map((el) => el.textContent?.trim() ?? '');
    // 数量从登记处推导，不写死 —— 写死的数字就是下一次加导航项时的第三个漂移点。
    // "登记本身对不对"由上面那条与 `App.tsx` 逐字对账负责，这里只管"画全了没有"。
    expect(labels).toHaveLength(SHELL_PRIMARY_NAV.length);
    for (const item of SHELL_PRIMARY_NAV) {
      expect(labels.some((label) => label.startsWith(zhCN[item.labelKey]))).toBe(true);
    }
  });
});

describe('#2 四象限计数：登记值 ⟷ 领域层 `bucketByQuadrant` 实算', () => {
  it('真应用**确实显示**计数，且是算出来的（不是"产品没有这个位"）', () => {
    const app = appSource();
    const store = taskStoreSource();
    // 计数从 store 的 selector 来，而那个 selector 调的就是 `bucketByQuadrant`。
    expect(store).toContain('export function selectQuadrantCounts');
    expect(store).toContain('bucketByQuadrant(');
    expect(app).toContain('selectQuadrantCounts');
    expect(app).toContain('counts[entry.filter.quadrant]');
    // `NavButton` 只在 > 0 时渲染计数位 —— 空账号的截图里因此一个数字都没有。
    //（2026-10-02 起它在 features/shell/NavButton.tsx，对账跟着读那份文件。）
    const navButton = navButtonSource();
    expect(navButton).toContain('count > 0');
    expect(navButton).toContain('ht-nav__count');
  });

  it('每条样例任务登记的象限 = 领域层算出来的象限', () => {
    for (const task of SHOWCASE_TASKS) {
      const domainTask = toDomainTask(task);
      const actual = classifyQuadrant(domainTask, { now: SHOWCASE_NOW });
      // q1..q4 ↔ Quadrant 1..4
      expect(
        actual,
        `样例任务 ${task.id} 登记为 ${task.quadrant}，而 bucketByQuadrant 把它算进 Quadrant.${String(actual)}`,
      ).toBe(SHELL_QUADRANT_NAV.findIndex((q) => q.quadrant === task.quadrant) + 1);
    }
  });

  it('侧栏计数 = 领域层对同一批任务的实算，且已完成任务不计入', () => {
    const buckets = bucketByQuadrant(SHOWCASE_TASKS.map(toDomainTask), { now: SHOWCASE_NOW });
    const expected = {
      q1: buckets[1].length,
      q2: buckets[2].length,
      q3: buckets[3].length,
      q4: buckets[4].length,
    };
    expect(showcaseQuadrantCounts()).toEqual(expected);

    const active = SHOWCASE_TASKS.filter((task) => task.done !== true).length;
    expect(expected.q1 + expected.q2 + expected.q3 + expected.q4).toBe(active);
    // 已完成那条**必须**被排除 —— 否则就是"把完成的任务也算进待办象限"。
    expect(active).toBeLessThan(SHOWCASE_TASKS.length);
  });

  it('渲染出的计数 = 派生值（> 0 才渲染，与真应用 `count > 0` 同一条）', () => {
    const view = renderMockup();
    const counts = showcaseQuadrantCounts();
    const rendered = [...view.querySelectorAll('.mk-sidebar .mk-nav__count')].map(
      (el) => el.textContent?.trim() ?? '',
    );
    const expected = SHELL_QUADRANT_NAV.map((q) => counts[q.quadrant]).filter((n) => n > 0);
    expect(rendered).toEqual(expected.map(String));
  });

  it('`AppWindow.tsx` 的计数是**派生**的，没有写死的数字', () => {
    const source = readFileSync(join(HERE, '../src/mockup/AppWindow.tsx'), 'utf8');
    expect(source).toContain('showcaseQuadrantCounts');
    expect(source).toContain('count={counts[item.quadrant]}');
    // 复刻曾经写死 3 / 5 / 2 / 1。`count={3}` 这种形态不许回来。
    expect(source).not.toMatch(/count=\{\s*\d/);
  });
});

describe('#4 标签区：登记处 ⟷ 真应用 `ProjectsPanel`', () => {
  it('真应用的清单区与标签区都还在（两块同形区块）', () => {
    const panel = projectsPanelSource();
    expect(panel).toContain("t('web.projects.heading')");
    expect(panel).toContain("t('web.projects.newPlaceholder')");
    expect(panel).toContain("t('web.tags.heading')");
    expect(panel).toContain("t('web.tags.newPlaceholder')");
  });

  it('登记的两块区块与 `ProjectsPanel` 逐项同 key', () => {
    expect(SHELL_PANEL_SECTIONS.map((section) => section.headingKey)).toEqual([
      'web.projects.heading',
      'web.tags.heading',
    ]);
    expect(SHELL_PANEL_SECTIONS.map((section) => section.newPlaceholderKey)).toEqual([
      'web.projects.newPlaceholder',
      'web.tags.newPlaceholder',
    ]);
  });

  it('渲染出的侧栏有「清单 + 标签」两块，且都是「输入框 + 加号」形态', () => {
    const view = renderMockup();
    const sidebarText = view.querySelector('.mk-sidebar')?.textContent ?? '';
    expect(sidebarText).toContain(zhCN['web.projects.heading']);
    expect(sidebarText).toContain(zhCN['web.tags.heading']);
    const boxes = [...view.querySelectorAll('.mk-field__box')].map((el) => el.textContent?.trim());
    expect(boxes).toEqual([
      zhCN['web.projects.newPlaceholder'],
      zhCN['web.tags.newPlaceholder'],
    ]);
    expect(view.querySelectorAll('.mk-field__add')).toHaveLength(SHELL_PANEL_SECTIONS.length);
  });
});

/**
 * 🔴 **"复刻 = 常量 = 渲染"这条链是闭的 —— 而它是靠两边各钉一半关起来的。**
 *
 * 本文件读的是 `apps/web/src/App.tsx` 的**常量数组**（跨应用不能 import），
 * 所以它**看不见真应用多渲染了什么**。那一半在
 * `apps/web/tests/app-mount.spec.tsx` 里 —— 它断言**渲染出来的 rail 标签与顺序**
 * 逐字等于一个写死的字面量。
 *
 * ```
 *   渲染 == 字面量        ← apps/web/tests/app-mount.spec.tsx
 *   常量 == 字面量        ← 本文件（下面第一条断言）
 *   登记处 == 常量        ← 本文件（下面第二、三条断言）
 *   ⇒ 登记处 == 渲染
 * ```
 *
 * ⚠️ **两半都做过故障注入**（2026-09-29）：
 *   · 真应用 rail 里插一个硬编码 `role="tab"` ⇒ `app-mount.spec` **红**
 *     （`expected [ '顺手加的', '任务', …(4) ] to deeply equal [ Array(7) ]`）；
 *   · 登记处多一项而常量没有 ⇒ **本文件红**
 *     （`expected [ 'tasks', 'calendar', …(6) ] to deeply equal […(5) ]`）。
 *
 * ⇒ 这一条曾经被记成"残余缺口"（"按常量对账 ≠ 按渲染对账"）。
 * **它其实已经关掉了**，只是关在另一个文件里 —— 所以那半边的判据不能删，
 * 删了这条链就断在最看不见的一段上。
 */
describe('#5 视图 tab：登记处 ⟷ 真应用 `VIEW_TABS`', () => {
  it('真应用的**默认 rail** 与登记处逐项同 key、同序', () => {
    const app = appDefaultRail();
    // 🔴 **默认 rail**（新装用户看到的）= 任务 + 默认开启的模块 + 工具。
    // 不再是全部 9 个 —— 番茄钟/成长/便签默认关，**不在 DOM 里**。
    // ⚠️ **不含 `settings`**：它在 `VIEW_TABS` 里（供 `labelKey` 查表）但**不在 rail 上**
    // —— 设置收进了顶部的头像菜单。所以"在 VIEW_TABS 里"与"在 rail 上"是两回事，
    // 判据必须按**实际渲染的那几个**算。
    expect(app.keys).toEqual([
      'tasks',
      'calendar',
      'quadrant',
      'habits',
      'timeline',
      'search',
      'trash',
    ]);
    expect(SHELL_VIEW_TABS.map((tab) => tab.key)).toEqual(app.keys);
    expect(SHELL_VIEW_TABS.map((tab) => tab.labelKey)).toEqual(app.labelKeys);
  });

  it('渲染出的默认 rail 是 7 项，标签逐字等于应用词条', () => {
    const view = renderMockup();
    const bar = view.querySelectorAll('.mk-header .mk-viewtabs')[0];
    const labels = [...(bar?.querySelectorAll('.mk-viewtab') ?? [])].map(
      (el) => el.textContent?.trim() ?? '',
    );
    expect(labels).toHaveLength(7);
    // ⚠️ `web.shell.nav.quadrant`（视图 tab）与 `web.shell.nav.quadrantSection`（侧栏分区）
    // 中文逐字相同 —— 所以只比渲染出的文本抓不到"抄错 key"。文本相等 + key 对账两条一起才够。
    expect(labels).toEqual(SHELL_VIEW_TABS.map((tab) => zhCN[tab.labelKey]));
    expect(SHELL_VIEW_TABS.map((tab) => zhCN[tab.labelKey])).toEqual(
      appDefaultRail().labelKeys.map((key) => zhCN[key as keyof typeof zhCN]),
    );
  });

  it('侧栏四象限分区的标题用的是 `quadrantSection`，不是 `quadrant`', () => {
    const app = appSource();
    expect(app).toContain("t('web.shell.nav.quadrantSection')");
    expect(SHELL_QUADRANT_SECTION_KEY).toBe('web.shell.nav.quadrantSection');
    // 两个 key 的中文逐字相同 —— 这正是它容易被抄错、且抄错看不出来的原因。
    expect(zhCN['web.shell.nav.quadrantSection']).toBe(zhCN['web.shell.nav.quadrant']);
    const source = readFileSync(join(HERE, '../src/mockup/AppWindow.tsx'), 'utf8');
    expect(source).toContain('t(SHELL_QUADRANT_SECTION_KEY)');
    expect(source).not.toContain("t('web.shell.nav.quadrant')}");
  });
});

describe('外壳结构只从登记处派生', () => {
  it('`AppWindow.tsx` 引用了登记处的每一项，而不是各抄一份数组', () => {
    const source = readFileSync(join(HERE, '../src/mockup/AppWindow.tsx'), 'utf8');
    for (const symbol of [
      'SHELL_PRIMARY_NAV',
      'SHELL_QUADRANT_NAV',
      'SHELL_QUADRANT_SECTION_KEY',
      'SHELL_VIEW_TABS',
      'SHELL_PANEL_SECTIONS',
      'SHELL_HEADER_ACTIONS',
    ]) {
      expect(source, `AppWindow.tsx 没有从登记处取 ${symbol}`).toContain(symbol);
    }
    // 视图 tab 的 labelKey 不许再手写一份字面量。
    expect(source).not.toContain("t('web.shell.views.timeline')");
    expect(source).not.toContain("t('web.trash.nav')");
    // 页头那一排也不许再各抄一份（这批漂移就是这么产生的）。
    expect(source).not.toMatch(/className="mk-sync/);
    expect(source).not.toMatch(/className=\{?['"]mk-lang/);
  });

  it('四象限导航登记项**没有** count 字段（计数不是结构的一部分）', () => {
    for (const item of SHELL_QUADRANT_NAV) {
      expect(Object.keys(item).sort()).toEqual(['labelKey', 'quadrant', 'swatch']);
    }
  });
});

/**
 * #7 页头右侧那一排。
 *
 * 🔴 这一组是 2026-10-06 补的，因为**原来没有任何一层在管它**：
 * 那一段是手抄在渲染文件里的，于是复刻画着六件产品早已搬走的东西
 * （同步状态 / 立即同步 / 同步设置 / 语言 / 主题 / 日期-倒计时），
 * 而展厅 26 条测试全绿 —— 其中一条 positively 要求那六件都在。
 * 一条把过时形状钉成期望的判据，比没有判据更糟（AGENTS §8 第 3 条）。
 *
 * 两道一起才关得住：
 *   · **正向**：登记处的锚点 ⟷ 产品页头那一段里实际出现的 `data-testid`（双向等集）；
 *   · **反向**：`SHELL_HEADER_MOVED_OUT` 里每一件，产品侧的源码与复刻侧的图都不许再有。
 *     只验"该在的都在"挡不住"把旧的加回来"（与 `e2e/tests/shell-sync-rail.spec.ts` S1
 *     同一条理由）。
 */
describe('#7 页头右侧：登记处 ⟷ 真应用 `.ht-header__actions`', () => {
  /**
   * 产品页头那一段，**注释已剥掉**。
   *
   * 🔴 剥注释不是洁癖：那段里留着一句"原本平铺着 状态 / 立即同步 / 同步设置 / 语言 /
   * 详情开关 / 主题"的历史说明，里面写着 `<SyncBar/>` 与 `web.sync.a11y.syncNow` ——
   * 不剥的话这条反向判据会在**产品是对的**那一天就红，而红字指向产品。
   */
  function headerActionsSource(): string {
    const app = appSource();
    const start = app.indexOf('<div className="ht-header__actions">');
    if (start < 0) throw new Error('App.tsx 里找不到 .ht-header__actions —— 判据锚点已失效');
    const end = app.indexOf('<div className="ht-content">', start);
    if (end < 0) throw new Error('.ht-header__actions 之后找不到 .ht-content —— 判据锚点已失效');
    return stripComments(app.slice(start, end));
  }

  function webTestids(): string[] {
    return [...headerActionsSource().matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1] ?? '');
  }

  it('解析器读得出东西（阳性对照：挡"改名/挪走之后恒返回空集，于是双向都绿"）', () => {
    expect(webTestids()).toEqual(['task-sort', 'task-sort-select', 'detail-pane-toggle']);
  });

  it('登记处的锚点与产品页头实际出现的 testid 是同一批（双向等集，不是子集）', () => {
    const registered = SHELL_HEADER_ACTIONS.flatMap((action) => [...action.anchors]);
    expect(registered.sort()).toEqual(webTestids().sort());
    // 登记处内部不许重复登记同一枚锚点 —— 重复会让上面那条在"少一件 + 重一件"时仍然等长。
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('每一件的可访问名，产品那边确实按那个 key 在渲染', () => {
    const app = appSource();
    for (const action of SHELL_HEADER_ACTIONS) {
      expect(
        app.includes(`'${action.labelKey}'`) || app.includes(`'${action.optionKey ?? ''}'`),
        `${action.id} 登记的词条 ${action.labelKey} 在产品源码里找不到`,
      ).toBe(true);
    }
    // 排序那一档的**可见标签**是真应用与复刻共用的一条（裸 chip 的教训）。
    expect(app).toContain("t('web.shell.sort.aria')");
  });

  it('复刻页头画的就是登记的这一批，数量与顺序逐字一致', () => {
    const view = renderMockup('tasks');
    const actions = view.querySelector('.mk-header__actions');
    expect(actions, '复刻的页头动作区没画出来').not.toBeNull();
    const aria = [...(actions?.querySelectorAll('[aria-label]') ?? [])].map(
      (el) => el.getAttribute('aria-label') ?? '',
    );
    const text = actions?.textContent ?? '';
    const shown = SHELL_HEADER_ACTIONS.filter((a) => a.onlyForView === undefined || a.onlyForView === 'tasks');
    expect(actions?.children.length).toBe(shown.length);
    for (const action of shown) {
      const label = zhCN[action.labelKey];
      expect(
        aria.includes(label) || text.includes(label),
        `复刻页头里没有 ${action.id}（${label}）`,
      ).toBe(true);
    }
  });

  it('非任务视图里那一枚按产品的条件消失，详情开关仍在（条件不许抄错）', () => {
    const view = renderMockup('quadrant');
    const actions = view.querySelector('.mk-header__actions');
    const conditional = SHELL_HEADER_ACTIONS.filter((a) => a.onlyForView !== undefined);
    const unconditional = SHELL_HEADER_ACTIONS.length - conditional.length;
    expect(
      actions?.children.length,
      `条件件数 ${String(conditional.length)} 在未命中视图里没被滤掉（实际 ${String(actions?.children.length)}）`,
    ).toBe(unconditional);
  });

  it('🔴 搬走的四件：产品页头那一段里没有，复刻的图上也没有', () => {
    const webHeader = headerActionsSource();
    const view = renderMockup('tasks');
    const actions = view.querySelector('.mk-header__actions');
    const mockText = `${actions?.textContent ?? ''} ${[
      ...(actions?.querySelectorAll('[aria-label]') ?? []),
    ]
      .map((el) => el.getAttribute('aria-label') ?? '')
      .join(' ')}`;

    for (const moved of SHELL_HEADER_MOVED_OUT) {
      for (const needle of moved.absentInWeb) {
        expect(webHeader, `产品页头又出现了 ${needle}（${moved.what} → ${moved.nowIn}）`)
          .not.toContain(needle);
      }
      for (const key of moved.absentInMock) {
        expect(mockText, `复刻页头又画了「${zhCN[key]}」（${moved.what} → ${moved.nowIn}）`)
          .not.toContain(zhCN[key]);
      }
    }
    // 阳性对照：上面那三串"不许出现"里，至少有一条**今天仍在 App.tsx 的别处**
    // —— 否则这几条反向判据可能只是在"字符串在整个仓库里不存在"上恒真。
    const app = appSource();
    expect(app).toContain('LanguageSwitcher');
    expect(app).toContain("'web.shell.dueMode.date'");
  });
});

