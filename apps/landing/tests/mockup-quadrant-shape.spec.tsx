/**
 * 四象限复刻件与真实现之间的**会红约束**
 * ==================================================
 *
 * 背景：`docs/plans/multi-platform-adaptation.md` 的 M3 每轮固定流程**第 3.5 步**
 * （「把 landing 上对应那一块也换成真组件 / 补上同步判据」），以及 M3 第六刀
 * 自己在收尾时明确记下的未做项：
 *
 * > **landing 第 3.5 步未做**：`apps/landing/src/mockup/QuadrantGrid.tsx` 的手抄四象限
 * > **没有**加同步判据（focus 那一刀补过 `mockup-focus-ring.spec.tsx`，quadrant 这一块仍是漏的）。
 *
 * 本文件补的就是它。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么不是"把复刻件换成真组件"
 *
 * `docs/research/dida-view-unification.md` §9.1 是**永久判决**：`apps/landing/src/mockup/**`
 * 静态 import `@heyta/ui` 会让首屏 **+61.9 kB gzip（+31%）**，懒加载孤岛也救不了。
 * landing 的替代约束是「**纯数据登记处 + 会红判据**」：
 *
 *   · `src/mockup/quadrant-shape.ts` —— 四格的顺序 / 色块 / 标题 key / 说明 key；
 *   · 本文件 —— 把它与真实现的**源码文本**逐项对账，并与**领域层实算**对账。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 逐条会漂的东西 → 这里怎么红
 *
 * | 漂移的形状 | 这里怎么红 |
 * |---|---|
 * | 真实现改了四格**顺序**，复刻没跟 | 登记处的 slot 序列 ≠ `QUADRANT_ORDER` 重算的序列 |
 * | 真实现把象限指到**别的颜色 token** | `.mk-swatch--qN` 的背景 ≠ `QUADRANT_SLOT_TOKEN` 的答案 |
 * | web 改了**标题/说明词条 key**，复刻没跟 | 登记处的 key ≠ `copy.ts` 的 `QUADRANT_TITLE_KEY` / `QUADRANT_HINT_KEY` |
 * | web 改了**空格 / 无障碍 / footnote** 的 key | 登记处的 key ≠ `copy.ts` 里 `t(...)` 的实参 |
 * | 复刻"摆错格"或**格内顺序**漂了 | 渲染出的卡 ≠ `bucketByQuadrant()` 的实算（含顺序） |
 * | 真实现的空态是**纯文字**，复刻自己加了图标 | 空格子里出现了 `<svg>`（**真实发生过**） |
 * | 真实现有**整格无障碍名**，复刻没有 | 每格 `aria-label` 对不上 `web.quadrant.a11y.cell` 的模板 |
 * | 色块 / 说明 / 空态**抄成别的 token** | `mockup.css` 缺少真实现用的那个 `var(--ht-…)` |
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 两个只读接缝（故障注入专用，与 `mockup-shell-shape.spec.tsx` 同一约定）
 *
 * · `HEYTA_MOCKUP_WEB_SRC` —— 把 `apps/web/src` 复制到 `/tmp`、改一处、指过去，
 *   证明"真应用改了而复刻没跟 → 红"，而**不碰共享工作区**。
 * · `HEYTA_MOCKUP_UI_SRC` —— 同上，针对 `packages/ui/src`（`quadrant/model.ts` 等）。
 *
 * 不设它们时就是真实路径。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cssVarName, TASK_ROW_SHAPE, TEXT_STYLES, type TokenName } from '@heyta/design-system';
import { I18nProvider, zhCN } from '@heyta/i18n';

import { Priority, Quadrant, type Task } from '../../../packages/domain/src/entities.js';
import { bucketByQuadrant } from '../../../packages/domain/src/quadrant.js';
import { AppWindow } from '../src/mockup/AppWindow.js';
import { SHELL_QUADRANT_NAV } from '../src/mockup/app-shell-shape.js';
import {
  MOCK_QUADRANT_EMPTY_HAS_ICON,
  MOCK_QUADRANT_KEYS,
  MOCK_QUADRANT_SHAPE,
  type MockQuadrantShape,
} from '../src/mockup/quadrant-shape.js';
import { SHOWCASE_NOW, SHOWCASE_TASKS } from '../src/mockup/showcase-data.js';
import { readUiSource, readWebSource } from './helpers/source-text.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

/** 接缝与读取器的唯一所有者在 `./helpers/source-text.ts`（两份定义会让注入台架只重定向其中一份）。 */
const readWeb = readWebSource;
const readUi = readUiSource;

const quadrantModelSource = (): string => readUi('quadrant/model.ts');
const quadrantBoardSource = (): string => readUi('quadrant/QuadrantBoard.tsx');
const quadrantCopySource = (): string => readWeb('features/quadrant/copy.ts');
const taskListSource = (): string => readUi('task-list/TaskList.tsx');
const mockupCss = (): string => readFileSync(join(APP, 'src/mockup/mockup.css'), 'utf8');

/**
 * 从 `copy.ts` 返回的那个对象里切出**某个字段**的初始化表达式（到下一个同缩进字段为止）。
 *
 * 为什么不用一条正则直接取词条：`empty` 有过两种形状 —— `empty: () => t('k')` 与
 * `empty: (quadrant) => quadrant === firstEmpty ? t('k') : ''`。写死其中一种，
 * 别人把"四个空格各念一遍引导句"改成"只给第一个空象限念"时，这条对账会把
 * **产品的形状变化**报成**复刻坏了**。判的是词条 key，不是括号的写法。
 */
function copyFieldExpr(copy: string, field: string): string | undefined {
  const start = new RegExp(`\\n\\s{4}${field}:`).exec(copy);
  if (!start) return undefined;
  const rest = copy.slice(start.index + start[0].length);
  const end = /\n\s{4}[A-Za-z_$][\w$]*:/.exec(rest);
  return (end ? rest.slice(0, end.index) : rest).trim();
}

/** 那段表达式里**第一个** `t('…')` 的 key。 */
function firstKeyIn(expr: string | undefined): string | undefined {
  return expr === undefined ? undefined : /t\('([^']+)'/.exec(expr)?.[1];
}

/** 从源码里切出一个 `const X: Record<…> = { … };` 登记块。 */
function recordBlock(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`找不到 ${declaration} —— 判据锚点已失效`);
  const end = source.indexOf('};', start);
  if (end < 0) throw new Error(`${declaration} 之后找不到 \`};\` —— 判据锚点已失效`);
  return source.slice(start, end);
}

/** 真实现 `QUADRANT_ORDER` 的象限名，按展示顺序。 */
function realQuadrantOrder(): string[] {
  const source = quadrantModelSource();
  const start = source.indexOf('const QUADRANT_ORDER');
  if (start < 0) throw new Error('model.ts 里找不到 `const QUADRANT_ORDER` —— 判据锚点已失效');
  // ⚠️ 它写成 `] as const;`（不是 `];`），所以不能像 `arrayBlock` 那样找 `];` ——
  //    那会一路吃到后面某个真正的 `];`，把别的 `Quadrant.*` 也算进来（实测踩过）。
  const end = source.indexOf('as const', start);
  if (end < 0) throw new Error('`QUADRANT_ORDER` 之后找不到 `as const` —— 判据锚点已失效');
  return [...source.slice(start, end).matchAll(/Quadrant\.(\w+)/g)].map((match) => match[1] ?? '');
}

/** `[Quadrant.X]: '…' | N` 的键值对。 */
function enumLiteralPairs(block: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const match of block.matchAll(/\[Quadrant\.(\w+)\]:\s*(?:'([^']+)'|(\d+))/g)) {
    pairs.set(match[1] ?? '', match[2] ?? match[3] ?? '');
  }
  return pairs;
}

function realSlotByName(): Map<string, string> {
  return enumLiteralPairs(recordBlock(quadrantModelSource(), 'const QUADRANT_SLOT:'));
}

function realTokenByName(): Map<string, string> {
  return enumLiteralPairs(recordBlock(quadrantModelSource(), 'const QUADRANT_SLOT_TOKEN:'));
}

/** web `copy.ts` 的 `QUADRANT_TITLE_KEY` / `QUADRANT_HINT_KEY`。 */
function realTitleKeyByName(): Map<string, string> {
  return enumLiteralPairs(recordBlock(quadrantCopySource(), 'const QUADRANT_TITLE_KEY:'));
}

function realHintKeyByName(): Map<string, string> {
  return enumLiteralPairs(recordBlock(quadrantCopySource(), 'const QUADRANT_HINT_KEY:'));
}

/**
 * 槽位号 → 该槽位的象限名。
 *
 * 🔴 从真实现的 `QUADRANT_SLOT` 反查，而不是在测试里另写一张表 ——
 * 这张表若与真实现不一致，下面的顺序断言会先红。
 */
function realNameBySlot(): Map<number, string> {
  const byName = realSlotByName();
  const bySlot = new Map<number, string>();
  for (const [name, slot] of byName) bySlot.set(Number(slot), name);
  return bySlot;
}

/** 取某条 CSS 规则的规则体（第一条匹配）。 */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`mockup.css 里找不到规则：${selector}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/**
 * 把规则体拆成 `属性 → 值`。
 *
 * 🔴 为什么不用 `toContain('var(--ht-icon-sm)')`：一条规则有多个属性时，
 * `toContain` 只要求**任意一处**命中 —— 实测把 `inline-size` 改成别的 token、
 * `block-size` 留着不动，断言照样全绿。**"包含"回答的不是"这一项取值对"。**
 */
function cssDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return declarations;
}

/** 某个属性的值必须**恰好**是 `var(<token>)`。 */
function expectVar(css: string, selector: string, property: string, token: string): void {
  const value = cssDeclarations(ruleBody(css, selector)).get(property);
  expect(value, `${selector} 的 ${property} 必须恰好是 var(${cssVarName(token as TokenName)})`).toBe(
    `var(${cssVarName(token as TokenName)})`,
  );
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

function renderMockup(view: 'tasks' | 'quadrant' = 'quadrant'): HTMLElement {
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
    dueDate: task.dueInDays === undefined ? undefined : SHOWCASE_NOW + task.dueInDays * MS_PER_DAY,
    completedAt: task.done === true ? SHOWCASE_NOW : undefined,
  };
}

/** 领域层对同一批样例任务的实算（含每格成员与格内顺序）。 */
function realBuckets(): ReturnType<typeof bucketByQuadrant> {
  return bucketByQuadrant(SHOWCASE_TASKS.map(toDomainTask), { now: SHOWCASE_NOW });
}

/** 取某一格在真实现里的任务标题（按领域层给的顺序）。 */
function expectedCardTitles(shape: MockQuadrantShape): string[] {
  const tasks = realBuckets()[shape.slot as Quadrant];
  expect(tasks, `真实现里没有槽位 ${String(shape.slot)} 这一格`).toBeDefined();
  return tasks.map((task) => zhCN[task.title as keyof typeof zhCN]);
}

/** 用 `web.quadrant.a11y.cell` 的模板给出一格的期望无障碍名。 */
function expectedA11yLabel(title: string, hint: string): string {
  return zhCN[MOCK_QUADRANT_KEYS.cellA11y]
    .replace('{title}', title)
    .replace('{hint}', hint);
}

describe('四象限的展示顺序 = 真实现 `QUADRANT_ORDER`', () => {
  it('真实现的顺序锚点还在（`QUADRANT_ORDER` / `QUADRANT_SLOT` / `quadrantSlotToken`）', () => {
    const model = quadrantModelSource();
    expect(model).toContain('export const QUADRANT_ORDER');
    expect(model).toContain('const QUADRANT_SLOT:');
    expect(model).toContain('const QUADRANT_SLOT_TOKEN:');
    expect(model).toContain('export function quadrantSlotToken');
    expect(model).toContain('export function toQuadrantCards');
    // 锚点不是空壳：解析出来的东西必须真的存在。
    expect(realQuadrantOrder()).toHaveLength(4);
    expect(realSlotByName().size).toBe(4);
    expect(realTokenByName().size).toBe(4);
  });

  it('登记处的 slot 序列 = `QUADRANT_ORDER` 用 `QUADRANT_SLOT` 重算出来的序列', () => {
    const order = realQuadrantOrder();
    const byName = realSlotByName();
    const expected = order.map((name) => Number(byName.get(name)));
    // 真实现的顺序本身就是产品语义：Q1 → Q2 → Q3 → Q4。
    expect(expected).toEqual([1, 2, 3, 4]);
    expect(MOCK_QUADRANT_SHAPE.map((shape) => shape.slot)).toEqual(expected);
  });

  it('登记处的四个象限与侧栏 `SHELL_QUADRANT_NAV` 是同一组（没有第二份"有哪几格"）', () => {
    const registry = MOCK_QUADRANT_SHAPE.map((shape) => shape.quadrant).sort();
    const sidebar = SHELL_QUADRANT_NAV.map((item) => item.quadrant).sort();
    expect(registry).toEqual(sidebar);
    // 色块命名与象限 id 同源（侧栏是 `.mk-swatch--qN`，看板共用同一族类名）。
    for (const shape of MOCK_QUADRANT_SHAPE) {
      expect(shape.swatch).toBe(shape.quadrant);
    }
  });
});

describe('象限 → 颜色 token = 真实现 `QUADRANT_SLOT_TOKEN`', () => {
  it('每个 `.mk-swatch--qN` 的背景 = 真实现给那一格的 `--ht-color-quadrant-*`', () => {
    const bySlot = realNameBySlot();
    const tokenByName = realTokenByName();
    const css = mockupCss();
    for (const shape of MOCK_QUADRANT_SHAPE) {
      const name = bySlot.get(shape.slot);
      const token = name === undefined ? undefined : tokenByName.get(name);
      expect(token, `槽位 ${String(shape.slot)} 在真实现里没有颜色 token`).toBeDefined();
      expectVar(css, `.mk-swatch--${shape.swatch}`, 'background', token ?? '');
    }
  });
});

describe('每格的标题 / 说明 / 空态 / 无障碍 = web `copy.ts`', () => {
  it('web 的 `QUADRANT_TITLE_KEY` / `QUADRANT_HINT_KEY` 还在，且与登记处逐项同 key', () => {
    const bySlot = realNameBySlot();
    const titleByName = realTitleKeyByName();
    const hintByName = realHintKeyByName();
    expect(titleByName.size).toBe(4);
    expect(hintByName.size).toBe(4);

    const expectedTitle = MOCK_QUADRANT_SHAPE.map((shape) =>
      titleByName.get(bySlot.get(shape.slot) ?? ''),
    );
    const expectedHint = MOCK_QUADRANT_SHAPE.map((shape) =>
      hintByName.get(bySlot.get(shape.slot) ?? ''),
    );
    expect(MOCK_QUADRANT_SHAPE.map((shape) => shape.titleKey)).toEqual(expectedTitle);
    expect(MOCK_QUADRANT_SHAPE.map((shape) => shape.hintKey)).toEqual(expectedHint);
    // 顺带钉住：登记处不许再走 landing 自己的命名空间（那是上一处漂移）。
    for (const shape of MOCK_QUADRANT_SHAPE) {
      expect(shape.titleKey.startsWith('web.quadrant.')).toBe(true);
      expect(shape.hintKey.startsWith('web.quadrant.')).toBe(true);
    }
  });

  it('`cellA11y` / `empty` / `footnote` 三个 key = `copy.ts` 里 `t(...)` 的实参', () => {
    const copy = quadrantCopySource();
    const cell = firstKeyIn(copyFieldExpr(copy, 'cellA11y'));
    const empty = firstKeyIn(copyFieldExpr(copy, 'empty'));
    expect(cell, 'copy.ts 里找不到 cellA11y 的词条实参').toBeDefined();
    expect(empty, 'copy.ts 里找不到 empty 的词条实参').toBeDefined();
    expect(MOCK_QUADRANT_KEYS.cellA11y).toBe(cell);
    expect(MOCK_QUADRANT_KEYS.empty).toBe(empty);

    const footnoteExpr = copyFieldExpr(copy, 'footnote');
    if (footnoteExpr === undefined) {
      // 🔴 **方向从产品源码读出来**，不是写死"这一行一定在"（与今天 #24 那条同一口径）：
      // 产品哪天不再给 footnote，复刻就不许画它。
      const view = renderMockup('quadrant');
      expect(
        view.querySelector('.mk-quadrant__footnote'),
        '产品侧 `copy.ts` 已经没有 `footnote` 这一项，而复刻还在画 `.mk-quadrant__footnote`。' +
          '要撤的有三处：`AppWindow.tsx` 里那个节点、`mockup.css` 里那条规则、' +
          '`mockup-fidelity.spec.tsx` 的「四象限底部有 footnote」那一条。' +
          '⚠️ 若产品侧那半**还没入库**（现量：`git status --porcelain -- apps/web/src/features/quadrant/copy.ts`），' +
          '这条红说的是"提交那一笔要同时改复刻"，不是"复刻坏了"。',
      ).toBeNull();
      return;
    }
    const footnote = firstKeyIn(footnoteExpr);
    expect(footnote, 'copy.ts 里有 footnote 这一项，但取不到它的词条实参').toBeDefined();
    expect(MOCK_QUADRANT_KEYS.footnote).toBe(footnote);
  });

  it('真实现的空态是**纯文字**（登记处说不许有图标，真实现的文件里也没有图标）', () => {
    expect(MOCK_QUADRANT_EMPTY_HAS_ICON).toBe(false);
    const taskList = taskListSource();
    expect(taskList).toContain('ListEmptyComponent');
    // `TaskList` 的空态只有 `View` + `Text` —— 复刻曾自己加了一只 CheckCircle2。
    expect(taskList).not.toContain('CheckCircle');
  });

  it('渲染出的四格：顺序、标题、说明、整格无障碍名全部对得上', () => {
    const view = renderMockup('quadrant');
    const cells = [...view.querySelectorAll('.mk-quad')];
    expect(cells).toHaveLength(MOCK_QUADRANT_SHAPE.length);

    cells.forEach((cell, index) => {
      const shape = MOCK_QUADRANT_SHAPE[index];
      if (shape === undefined) throw new Error('登记处比渲染出的格子少');
      const title = zhCN[shape.titleKey];
      const hint = zhCN[shape.hintKey];
      expect(cell.querySelector('.mk-quad__head')?.textContent?.trim()).toBe(title);
      expect(cell.querySelector('.mk-quad__hint')?.textContent?.trim()).toBe(hint);
      expect(cell.getAttribute('aria-label')).toBe(expectedA11yLabel(title, hint));
      // 色块类名 = 登记处那一族。
      expect(cell.querySelector('.mk-quad__swatch')?.classList.contains(`mk-swatch--${shape.swatch}`)).toBe(
        true,
      );
    });
  });
});

describe('每格的卡 = 领域层 `bucketByQuadrant` 的实算（含格内顺序）', () => {
  it('渲染出的卡与领域层实算逐格、逐条同序 —— 摆错格 / 顺序漂了都会红', () => {
    const view = renderMockup('quadrant');
    const cells = [...view.querySelectorAll('.mk-quad')];
    MOCK_QUADRANT_SHAPE.forEach((shape, index) => {
      const cell = cells[index];
      if (cell === undefined) throw new Error(`第 ${String(index)} 格没有渲染`);
      const rendered = [...cell.querySelectorAll('.mk-quad__card')].map(
        (el) => el.textContent?.trim() ?? '',
      );
      expect(rendered, `第 ${String(shape.slot)} 格的卡对不上领域层实算`).toEqual(
        expectedCardTitles(shape),
      );
    });
  });

  it('计数口径：四格卡片数之和 = 未完成样例任务数（已完成任务不计入）', () => {
    const view = renderMockup('quadrant');
    const rendered = [...view.querySelectorAll('.mk-quad__card')].length;
    const buckets = realBuckets();
    const total = [Quadrant.UrgentImportant, Quadrant.ImportantNotUrgent, Quadrant.UrgentNotImportant, Quadrant.Neither]
      .map((quadrant) => buckets[quadrant].length)
      .reduce((sum, n) => sum + n, 0);
    expect(total).toBe(SHOWCASE_TASKS.filter((task) => task.done !== true).length);
    expect(rendered).toBe(total);
    expect(total).toBeLessThan(SHOWCASE_TASKS.length);
  });

  it('空格占位：只有领域层算出来为空的格子才有空态，且是纯文字', () => {
    const view = renderMockup('quadrant');
    const cells = [...view.querySelectorAll('.mk-quad')];
    let emptyCells = 0;
    MOCK_QUADRANT_SHAPE.forEach((shape, index) => {
      const cell = cells[index];
      if (cell === undefined) throw new Error(`第 ${String(index)} 格没有渲染`);
      const empty = cell.querySelector('.mk-quad__empty');
      if (expectedCardTitles(shape).length === 0) {
        emptyCells += 1;
        expect(empty, `第 ${String(shape.slot)} 格该是空的却没有空态`).not.toBeNull();
        expect(empty?.textContent?.trim()).toBe(zhCN[MOCK_QUADRANT_KEYS.empty]);
        // 🔴 复刻曾自己加了一只图标（并被注释成"与真应用同一个图标"）—— 不许回来。
        expect(empty?.querySelectorAll('svg').length, '空格占位又画图标了').toBe(0);
      } else {
        expect(empty, `第 ${String(shape.slot)} 格有任务却画了空态`).toBeNull();
      }
    });
    // 这条断言先证明**空态这一幕真的被演练到了** —— 否则上面那半条是空转。
    expect(emptyCells).toBeGreaterThan(0);
  });
});

describe('`mockup.css` 用的是真实现那一组 token', () => {
  it('色块尺寸 = 真实现给看板色块的 `icon.sm`（侧栏那族是另一处，不许混）', () => {
    // 先确认真实现真的用的是 `icon.sm`（锚点，不是我们以为的）。
    expect(quadrantBoardSource()).toContain("tokens['icon.sm']");
    const css = mockupCss();
    expectVar(css, '.mk-quad__swatch', 'inline-size', 'icon.sm');
    expectVar(css, '.mk-quad__swatch', 'block-size', 'icon.sm');
    // 侧栏 `.mk-swatch` 保持 `.ht-swatch` 的那一族（space.2），两处都不许被对方改掉。
    expectVar(css, '.mk-swatch', 'inline-size', 'space.2');
    expectVar(css, '.mk-swatch', 'block-size', 'space.2');
  });

  it('格子最小高度 = 真实现的 `layout.quadrant-min-height`', () => {
    expect(quadrantBoardSource()).toContain("tokens['layout.quadrant-min-height']");
    expectVar(mockupCss(), '.mk-quad', 'min-block-size', 'layout.quadrant-min-height');
  });

  it('标题 / 说明 / 空态 / footnote 的排版 = 真实现用的语义文字样式', () => {
    const caption = TEXT_STYLES.caption;
    const rowMeta = TEXT_STYLES['row-meta'];
    const css = mockupCss();

    // 大标题：`row-meta` 的 size/leading/tracking + semibold 覆盖（真实现的 strongWeight）。
    expectVar(css, '.mk-quad__head', 'font-size', rowMeta.size);
    expectVar(css, '.mk-quad__head', 'line-height', rowMeta.leading);
    expectVar(css, '.mk-quad__head', 'letter-spacing', rowMeta.tracking);
    expectVar(css, '.mk-quad__head', 'font-weight', 'font-weight.semibold');

    // 说明 / 空态 / footnote：`caption` 的四个 token，逐属性对账。
    for (const selector of ['.mk-quad__hint', '.mk-quad__empty', '.mk-quadrant__footnote']) {
      expectVar(css, selector, 'font-size', caption.size);
      expectVar(css, selector, 'font-weight', caption.weight);
      expectVar(css, selector, 'line-height', caption.leading);
      expectVar(css, selector, 'letter-spacing', caption.tracking);
    }
  });

  it('格里的列表行间距 = 共享 `TaskList` 的 `TASK_ROW_SHAPE.listGap`', () => {
    expectVar(mockupCss(), '.mk-quad__list', 'gap', TASK_ROW_SHAPE.listGap);
  });
});
