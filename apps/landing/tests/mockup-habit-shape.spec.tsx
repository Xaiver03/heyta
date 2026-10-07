/**
 * 习惯热力图复刻件与真实现之间的**会红约束**
 * ==================================================
 *
 * 背景：`docs/plans/multi-platform-adaptation.md` 的 M3 每轮固定流程**第 3.5 步**
 * （「把 landing 上对应那一块也换成真组件 / 补上同步判据」）。
 *
 * 🔴 为什么不是"把复刻件换成真组件"：`docs/research/dida-view-unification.md`
 * §9.1 是**永久判决** —— `apps/landing/src/mockup/**` 静态 import `@heyta/ui`
 * 会让首屏 **+61.9 kB gzip（+31%）**。替代约束是「**纯数据登记处 + 会红判据**」，
 * 与 `mockup-quadrant-shape.spec.tsx` / `mockup-focus-ring.spec.tsx` 同一形状。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一刀本身带的重要变化：热力图**不再是 `react-activity-calendar`**
 *
 * M3 第七刀把热力图收进 `@heyta/ui`，改为 **RN 原语自绘**
 * （DOM 库装不进共享层）。所以这里钉的"真实现"是
 * `packages/ui/src/habits/{model.ts,HabitBoard.tsx}`，而不是那个库。
 *
 * | 漂移的形状 | 这里怎么红 |
 * |---|---|
 * | 真实现换回 `react-activity-calendar`（或重新长出 DOM 依赖） | 共享层源码里出现该 import |
 * | 强度色阶换了 token（`.mk-heat__cell--N` 抄成别的色） | 该规则的 `background` ≠ `var(--ht-color-heat-N)` |
 * | 空档从 `heat-0` 换成 `surface-sunken`（暗色下格子会看不见） | 基础格子的 `background` 对不上 |
 * | 真实现的"档位 → token"映射被删/改名 | `model.ts` 的锚点扫不到 |
 * | 复刻件自己给格子加了点击/悬停交互（真实现没有） | `HabitHeatmap.tsx` 里出现 `onClick` / `data-cell-title` |
 * | 复刻件开始"随机"生成图案（同一次渲染换一副图） | 出现 `Math.random` |
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这道判据**不**断言什么（如实写下来，别当它是全覆盖）
 *
 *   1. **窗口长度**：复刻件是 26 周的**示意**图案（假数据、固定种子），
 *      真实现是 **90 天**（`HABIT_HEATMAP_DAYS`）。两者刻意不同 ——
 *      复刻件是营销页的静态插图，不是"最近 90 天"的读数。硬把 90 天
 *      与 26 周对齐只会让两边都变难看，而且那不是判据要管的事。
 *   2. **月份标签**：真实现有（`HEATMAP_MONTH_KEYS`），复刻件没有 ——
 *      它是已知的观感落差（不是"漂移"，复刻件从不声称自己是 90 天窗口）。
 *   3. **数值**：复刻件的完成密度是编的，不与任何真数据对账。
 *
 * ⚠️ 两个只读接缝（故障注入专用）：`HEYTA_MOCKUP_UI_SRC` / `HEYTA_MOCKUP_WEB_SRC`
 * —— 把目录复制到 `/tmp`、改一处、指过去，证明"真实现改了而复刻没跟 → 红"，
 * 而**不碰共享工作区**。不设它们时就是真实路径。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { HEAT_TOKENS, cssVarName, type TokenName } from '@heyta/design-system';
import { I18nProvider } from '@heyta/i18n';

import { AppWindow } from '../src/mockup/AppWindow.js';
import {
  MOCK_HABIT_HEAT_CELL_CLASS,
  MOCK_HABIT_HEAT_LEVELS,
  MOCK_HABIT_HEAT_WEEKS,
  MOCK_HABIT_KEYS,
  mockHeatCellClass,
} from '../src/mockup/habit-shape.js';
import { readUiSource, readWebSource } from './helpers/source-text.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO = resolve(HERE, '../../..');

// 两枚注入接缝的唯一所有者是 `./helpers/source-text.ts`（理由见那份文件头）。
const readUi = readUiSource;
const readWeb = readWebSource;

const habitsModelSource = (): string => readUi('habits/model.ts');
const habitBoardSource = (): string => readUi('habits/HabitBoard.tsx');
const webHostSource = (): string => readWeb('features/habits/HabitsView.tsx');
const mockupSource = (): string =>
  readFileSync(join(APP, 'src/mockup/HabitHeatmap.tsx'), 'utf8');
const mockupCss = (): string => readFileSync(join(APP, 'src/mockup/mockup.css'), 'utf8');

/**
 * 去掉注释再做"有没有出现某个词"的断言。
 *
 * 🔴 这一步是**必须的**，不是保险：`HabitHeatmap.tsx` 的注释里写着
 * 「不能用 `Math.random()`」—— 直接对全文断言会**假红**（第一版实测）。
 * 同类的坑在 web 那边也踩过一次（文件头提到 `react-activity-calendar`）。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * jsdom 不实现 `ResizeObserver`，而 `AppWindow` 用它算缩放比。
 * 这是**测试环境的缺口**，不是产品缺陷 —— 补一个空实现让 effect 跑完
 * （与 `mockup-quadrant-shape.spec.tsx` 同一处取舍）。
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

/** 渲染展厅里「习惯」那一幕（真数据是编的，但**结构**来自登记处）。 */
function renderMockup(): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <AppWindow view="habits" />
      </I18nProvider>,
    );
  });
  return container;
}

/** 取某条 CSS 规则的规则体（第一条匹配）。 */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`mockup.css 里找不到规则：${selector}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/** 规则体 → `属性 → 值`（不用 `toContain`，它回答的不是"这一项取值对"）。 */
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
function expectVar(css: string, selector: string, property: string, token: TokenName): void {
  const value = cssDeclarations(ruleBody(css, selector)).get(property);
  expect(value, `${selector} 的 ${property} 必须恰好是 var(${cssVarName(token)})`).toBe(
    `var(${cssVarName(token)})`,
  );
}

describe('真实现的锚点还在，而且热力图是**自绘**的', () => {
  it('共享层：档位 → token 的映射与周列排法都在 `habits/model.ts`', () => {
    const model = habitsModelSource();
    expect(model).toContain('export function heatmapLevelToken');
    expect(model).toContain('export function toHeatmapWeeks');
    expect(model).toContain('export const HEATMAP_MONTH_KEYS');
    expect(model).toContain('export const HABIT_HEATMAP_DAYS');
    // 档位色只有一处定义（设计系统的 `HEAT_TOKENS`）。
    expect(model).toContain('HEAT_TOKENS');
  });

  it('共享层组件：cells 由 `toHeatmapWeeks` + `heatmapLevelToken` 画出来', () => {
    const board = habitBoardSource();
    expect(board).toContain('toHeatmapWeeks');
    expect(board).toContain('heatmapLevelToken');
  });

  it('🔴 真实现与 web 宿主都不再 import `react-activity-calendar`（DOM 库）', () => {
    // 判据盯 import 语句：文件头的说明里就写着这个名字（第一版因此假红）。
    expect(habitBoardSource()).not.toMatch(/from\s+['"]react-activity-calendar['"]/);
    expect(webHostSource()).not.toMatch(/from\s+['"]react-activity-calendar['"]/);
    // web 宿主必须换成共享 `HabitBoard`。
    expect(webHostSource()).toContain('HabitBoard');
  });
});

describe('复刻件的色阶 = 真实现那一族 `color.heat-*`', () => {
  it('四个强度档逐条对账（`--1..4`），基础格子是空档 `heat-0`', () => {
    const css = mockupCss();
    for (const level of [1, 2, 3, 4] as const) {
      expectVar(css, `.mk-heat__cell--${String(level)}`, 'background', HEAT_TOKENS[level]);
    }
    // 🔴 空档必须是 `heat-0`，不能拿 `surface-sunken` 顶替：
    // 暗色主题里它比卡片底还暗，空格子会看不见。
    expectVar(css, '.mk-heat__cell', 'background', HEAT_TOKENS[0]);
  });

  it('格子尺寸与圆角走 token（不写死 rem）', () => {
    const css = mockupCss();
    expectVar(css, '.mk-heat__cell', 'inline-size', 'space.3');
    expectVar(css, '.mk-heat__cell', 'block-size', 'space.3');
    expectVar(css, '.mk-heat__cell', 'border-radius', 'radius.sm');
  });

  it('`HEAT_TOKENS` 恰好 5 档（0=没记录 … 4=最多）', () => {
    expect(HEAT_TOKENS).toHaveLength(5);
  });
});

describe('复刻件与真实现都不许"手抄一套交互/随机"', () => {
  it('静态复刻的格子不占键盘焦点；也不产出 `data-cell-title`（那是 web 的悬停通道）', () => {
    const code = stripComments(mockupSource());
    expect(code).toContain('onClick');
    expect(code).not.toContain('data-cell-title');
    // 🔴 图案必须确定（`determinism.spec.ts` 也钉了 `levelFor`）：
    // 随机会让每次重渲染换一副图，看起来像数据在乱跳。
    expect(code).not.toContain('Math.random');
    const view = renderMockup();
    const cells = [...view.querySelectorAll('.mk-habit .mk-heat > .mk-heat__cell')];
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((cell) => cell.tagName === 'SPAN')).toBe(true);
    expect(view.querySelectorAll('.mk-heat button')).toHaveLength(0);
    expect(view.querySelectorAll('.mk-habit__check-in')).toHaveLength(0);
  });

  it('复刻件的每个习惯卡都有"名字 + 连续"两件事（与真实现的卡头同结构）', () => {
    const source = mockupSource();
    expect(source).toContain('mk-habit__name');
    expect(source).toContain('mk-habit__streak');
    expect(source).toContain('mk-habit__head');
  });

  it('图例的档位来自登记处（0–4 五档，顺序即数组顺序），不是手抄的 5 个 span', () => {
    // 判据锚点：登记处必须真的覆盖 0–4，且是**显式数组**（顺序是语义）。
    expect([...MOCK_HABIT_HEAT_LEVELS]).toEqual([0, 1, 2, 3, 4]);
    // 0 档是基础类，1–4 各带一个修饰类 —— 与 `mockup.css` 那四条规则一一对应。
    expect(mockHeatCellClass(0)).toBe(MOCK_HABIT_HEAT_CELL_CLASS);
    for (const level of [1, 2, 3, 4] as const) {
      expect(mockHeatCellClass(level)).toBe(
        `${MOCK_HABIT_HEAT_CELL_CLASS} ${MOCK_HABIT_HEAT_CELL_CLASS}--${String(level)}`,
      );
    }
  });

  it('渲染出来的图例恰好 5 格，且四档修饰类各一次（DOM 与登记处一致）', () => {
    const view = renderMockup();
    const legend = view.querySelector('.mk-heat__legend');
    expect(legend, '渲染结果里没有图例 —— 判据锚点已失效').not.toBeNull();
    const swatches = [...(legend?.querySelectorAll('.mk-heat__cell') ?? [])];
    expect(swatches).toHaveLength(MOCK_HABIT_HEAT_LEVELS.length);
    for (const level of MOCK_HABIT_HEAT_LEVELS) {
      const cls = mockHeatCellClass(level);
      const matched = swatches.filter((el) => el.getAttribute('class') === cls);
      expect(matched, `档位 ${String(level)} 的色块必须恰好一个`).toHaveLength(1);
    }
  });

  it('图例的"少 / 多"两端走登记处的词条 key（不是散落的字面量）', () => {
    const source = mockupSource();
    expect(source).toContain('MOCK_HABIT_KEYS.less');
    expect(source).toContain('MOCK_HABIT_KEYS.more');
    expect(MOCK_HABIT_KEYS.less).toBe('landing.mock.heat.less');
    expect(MOCK_HABIT_KEYS.more).toBe('landing.mock.heat.more');
  });
});

describe('覆盖边界（写进断言，免得读的人以为它管得更宽）', () => {
  it('复刻件是 26 周示意图案，真实现是 90 天窗口 —— 两者刻意不同，不在这里对账', () => {
    expect(MOCK_HABIT_HEAT_WEEKS).toBe(26);
    expect(habitsModelSource()).toContain('export const HABIT_HEATMAP_DAYS = 90');
    // 复刻件从登记处取窗口（不再自己写一个 `WEEKS = 26`）。
    expect(mockupSource()).toContain('MOCK_HABIT_HEAT_WEEKS');
  });
});
