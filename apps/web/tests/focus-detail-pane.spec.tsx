/**
 * 判据：专注详情面（工单 W7 的 web 半边）
 * =======================================
 *
 * 对应 `docs/plans/detail-pane-alignment.md` W7 的三条判据里能在 jsdom 这层证的：
 * - **① 四张卡的数与领域函数逐字同源**：这里证的是"界面读的是那个出口，
 *   不是自己算的" —— 用 `setState` 换一组值，DOM 必须跟着换；
 *   再加一条**源码级**判据（本文件最后一组）：这个组件里不许出现 reduce /
 *   `focusStatsForDay` / `computeActivityTotals`。
 * - **② 记录列表渲染条数 == 出口给的条数**：断的是"界面没有再筛一遍/切一刀"。
 *
 * 🔴 这里**证不了两件事**，别把本文件的绿读成 W7 做完：
 * 1. **数对不对** —— 四个数怎么算出来在 `packages/app-host/tests/focus-overview.spec.ts`
 *    （真引擎 + 真 SQLite）。这一层 mock 的是那个出口的**输出**，
 *    它对"口径错"完全无感。
 * 2. **画出来长什么样** —— AGENTS §6.2 规定一：界面结论只能由截图作证，
 *    见 `e2e/tests/focus-detail-pane.spec.ts`。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FocusOverview } from '@heyta/app-host';
import { FocusDetailPane } from '../src/features/focus/FocusDetailPane.js';
import { useFocusStore } from '../src/features/focus/store.js';
import { DETAIL_FITS_QUERY } from '../src/lib/breakpoints.js';
import { LocaleHost } from '../src/lib/locale-host.js';
import { emptyState } from '@heyta/op-log';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { useTaskStore } from '../src/features/tasks/store.js';

const MIN = 60 * 1000;

function overview(over: Partial<FocusOverview> = {}): FocusOverview {
  return {
    todayCount: 0,
    todayFocusMs: 0,
    todayAbortedCount: 0,
    totalCount: 0,
    totalFocusMs: 0,
    records: [],
    days: [],
    ...over,
  };
}

/**
 * 一条记录。`energyLevel` 现在是 `FocusRecord` 的必填字段（由 `focusOverview`
 * 按"相对记录里最长的一段"分档），所以夹具必须带上 —— 省掉它会让类型检查红，
 * 而那不是本文件的判据在说话。
 */
function record(over: Partial<FocusOverview['records'][number]> = {}): FocusOverview['records'][number] {
  return {
    id: 'r',
    at: Date.now(),
    actualMs: 25 * MIN,
    completed: true,
    taskTitle: '写周报',
    energyLevel: 4,
    ...over,
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const originalMatchMedia = window.matchMedia;

async function mount(node: React.JSX.Element): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<LocaleHost>{node}</LocaleHost>);
  });
  return container;
}

function textOf(el: HTMLElement, testId: string): string {
  const node = el.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  expect(node, `界面上找不到 ${testId}`).not.toBeNull();
  return (node as HTMLElement).textContent ?? '';
}

function countOf(el: HTMLElement, testId: string): number {
  return el.querySelectorAll(`[data-testid="${testId}"]`).length;
}

beforeEach(async () => {
  localStorage.clear();
  // #50：详情面新挂了统计图表（读引擎现取序列），挂载前必须有引擎；
  // 这里只补测试前置，不改本文件任何断言。
  __resetOpLogForTests();
  await initOpLog();
  // 这组接线判据覆盖桌面三栏：任务无选中时，详情列由单一 AI Agent 占位。
  // 直接挂 FocusDetailPane 的单元测试不依赖这个媒体查询。
  window.matchMedia = ((query: string) => ({
    matches: query === DETAIL_FITS_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
  useFocusStore.setState({ overview: overview() });
  window.matchMedia = originalMatchMedia;
  __resetOpLogForTests();
});

describe('A 四张卡读的是那个出口，不是自己算的', () => {
  it('四个值逐字来自 store.overview（换一组数，DOM 必须跟着换）', async () => {
    useFocusStore.setState({
      overview: overview({
        todayCount: 3,
        todayFocusMs: 58 * MIN,
        totalCount: 12,
        totalFocusMs: 80 * MIN,
      }),
    });
    const el = await mount(<FocusDetailPane />);

    expect(textOf(el, 'focus-card-today-count')).toBe('3');
    expect(textOf(el, 'focus-card-today-duration')).toBe('58 分钟');
    expect(textOf(el, 'focus-card-total-count')).toBe('12');
    // 分档口径来自 `durationParts`：满一小时走"小时 + 分"那一档。
    expect(textOf(el, 'focus-card-total-duration')).toBe('1 小时 20 分');

    // 🔴 必须包在 `act` 里：不包的话 React 只是 warn 一句"更新没被 act 包住"，
    //    而 DOM **还是旧的** —— 于是这条判据会读成"界面不跟着数变"，
    //    把测试自己的缺陷报成产品的缺陷（实测就是 Expected 4 / Received 3）。
    await act(async () => {
      useFocusStore.setState({
        overview: overview({ todayCount: 4, todayFocusMs: 90 * MIN, totalCount: 0, totalFocusMs: 0 }),
      });
    });
    expect(textOf(el, 'focus-card-today-count')).toBe('4');
    expect(textOf(el, 'focus-card-today-duration')).toBe('1 小时 30 分');
    expect(textOf(el, 'focus-card-total-count')).toBe('0');
    expect(textOf(el, 'focus-card-total-duration')).toBe('0 分钟');
  });

  /**
   * 🔴 这一条是本轮重设计的**核心判据**：今日实时 与 历史累计
   * 不许再拿到同一种容器、同一种视觉权重。
   *
   * 旧布局是 2×2 四个同款灰框，两个 `today*` 与两个 `total*` 长得一模一样 ——
   * 于是"今天做了多少"这个每天都要看的数，跟"累计账本"一样抢不到注意力。
   * 现在：`today*` 必须落在 hero 里（有底色、大号读数），
   * `total*` 必须落在账本行里（无底色、紧凑）。**两个容器不能是同一个**。
   */
  it('今日的两个读数在 hero 里，累计的两个读数在账本行里 —— 不是同一批卡片', async () => {
    const el = await mount(<FocusDetailPane />);
    const hero = el.querySelectorAll('.ht-app__detail-hero-cell');
    const ledger = el.querySelectorAll('.ht-app__detail-ledger-row');
    expect(hero, '今日 Hero 应有 2 格').toHaveLength(2);
    expect(ledger, '累计账本应有 2 行').toHaveLength(2);

    // 今日两格：一个装今日番茄、一个装今日时长。
    const heroIds = [...hero].map(
      (c) => c.querySelector<HTMLElement>('.ht-app__detail-hero-value')?.dataset.testid ?? '',
    );
    expect(heroIds.sort()).toEqual(['focus-card-today-count', 'focus-card-today-duration']);

    // 累计两行：一个装总番茄、一个装总时长。
    const ledgerIds = [...ledger].map(
      (r) => r.querySelector<HTMLElement>('.ht-app__detail-ledger-value')?.dataset.testid ?? '',
    );
    expect(ledgerIds.sort()).toEqual(['focus-card-total-count', 'focus-card-total-duration']);

    // 反向：`total*` 不许出现在 hero 里、`today*` 不许出现在账本里。
    expect(el.querySelector('.ht-app__detail-hero [data-testid="focus-card-total-count"]')).toBeNull();
    expect(el.querySelector('.ht-app__detail-ledger [data-testid="focus-card-today-count"]')).toBeNull();
  });

  it('四个标签各自不同 —— 少一个读数不会报错，只会让人以为没做', async () => {
    const el = await mount(<FocusDetailPane />);
    const labels = [
      ...el.querySelectorAll<HTMLElement>('.ht-app__detail-hero-label'),
      ...el.querySelectorAll<HTMLElement>('.ht-app__detail-ledger-label'),
    ].map((n) => n.textContent ?? '');
    expect(labels).toHaveLength(4);
    expect(new Set(labels).size, `标签有重复：${labels.join(' / ')}`).toBe(4);
  });
});

describe('B 专注记录列表', () => {
  it('渲染条数 == 出口给的条数（界面不再自己筛、也不切前 N 条）', async () => {
    useFocusStore.setState({
      overview: overview({
        totalCount: 3,
        records: [
          record({ id: 'r1', actualMs: 25 * MIN, completed: true, taskTitle: '写周报' }),
          record({ id: 'r2', actualMs: 8 * MIN, completed: false, taskTitle: null, energyLevel: 1 }),
          record({ id: 'r3', actualMs: 25 * MIN, completed: true, taskTitle: '读论文' }),
        ],
      }),
    });
    const el = await mount(<FocusDetailPane />);
    expect(countOf(el, 'focus-record')).toBe(3);
    expect(countOf(el, 'focus-records-empty')).toBe(0);
  });

  it('一条记录都没有时说的是那句话，而不是留一块空白', async () => {
    const el = await mount(<FocusDetailPane />);
    expect(countOf(el, 'focus-record')).toBe(0);
    expect(textOf(el, 'focus-records-empty')).toContain('还没有专注记录');
  });

  it('没关联任务的行说「未关联任务」；留空读起来像数据丢了', async () => {
    useFocusStore.setState({
      overview: overview({
        records: [record({ id: 'r1', taskTitle: null })],
      }),
    });
    const el = await mount(<FocusDetailPane />);
    const task = el.querySelector<HTMLElement>('.ht-app__detail-record-task');
    expect(task?.textContent).toBe('未关联任务');
  });

  it('「中途放弃」只标在没完成的行上', async () => {
    useFocusStore.setState({
      overview: overview({
        records: [
          record({ id: 'done', actualMs: 25 * MIN, completed: true, taskTitle: 'A' }),
          record({ id: 'early', actualMs: 6 * MIN, completed: false, taskTitle: 'B', energyLevel: 1 }),
        ],
      }),
    });
    const el = await mount(<FocusDetailPane />);
    expect(countOf(el, 'focus-record')).toBe(2);
    const rows = [...el.querySelectorAll<HTMLElement>('.ht-app__detail-record')];
    const aborted = rows.filter((r) => r.querySelector('.ht-app__detail-record-aborted') !== null);
    expect(aborted).toHaveLength(1);
    expect(aborted[0]?.querySelector('.ht-app__detail-record-task')?.textContent).toBe('B');
  });

  /**
   * 🔴 能量条：25 分钟与 50 分钟必须一眼分得开。
   *
   * 以前两行只写文字时长，差一倍得靠读数字才看得出来 —— 而这一栏的作用
   * 正是"扫一眼就知道今天怎么过的"。这里断的是"档位被画进 DOM"：
   * 每行的能量条 `data-level` 必须等于出口给的 `energyLevel`。
   * （颜色映射在 CSS；jsdom 不解析样式表，所以断言落在属性上。）
   */
  it('每行的能量条 data-level == 出口给的 energyLevel（长段与短段分得开）', async () => {
    useFocusStore.setState({
      overview: overview({
        records: [
          record({ id: 'long', actualMs: 50 * MIN, energyLevel: 4 }),
          record({ id: 'short', actualMs: 25 * MIN, energyLevel: 2 }),
        ],
      }),
    });
    const el = await mount(<FocusDetailPane />);
    const levels = [...el.querySelectorAll<HTMLElement>('.ht-app__detail-record-energy')].map(
      (n) => n.dataset.level,
    );
    expect(levels).toEqual(['4', '2']);
  });
});

/**
 * 七日脉搏：给"今天"一个参照系。
 *
 * 🔴 这一条守的是"补天由生产者做"：`days` 有几格 (7) 就画几格，
 * 界面不自己补、也不自己截。以及"今天在最右一格"—— 那是它作为今日
 * Hero 时间锚点的唯一依据。
 */
describe('E 七日脉搏', () => {
  function days(): FocusOverview['days'] {
    return [
      { date: '2026-09-18', focusMs: 0, completedCount: 0, level: 0 },
      { date: '2026-09-19', focusMs: 10 * MIN, completedCount: 1, level: 1 },
      { date: '2026-09-20', focusMs: 0, completedCount: 0, level: 0 },
      { date: '2026-09-21', focusMs: 45 * MIN, completedCount: 2, level: 4 },
      { date: '2026-09-22', focusMs: 20 * MIN, completedCount: 1, level: 2 },
      { date: '2026-09-23', focusMs: 30 * MIN, completedCount: 1, level: 3 },
      { date: '2026-09-24', focusMs: 12 * MIN, completedCount: 1, level: 1 },
    ];
  }

  it('有几格画几格，每格的 data-level 等于出口给的 level', async () => {
    useFocusStore.setState({ overview: overview({ days: days() }) });
    const el = await mount(<FocusDetailPane />);
    const cells = [...el.querySelectorAll<HTMLElement>('[data-testid="focus-pulse-day"]')];
    expect(cells).toHaveLength(7);
    expect(cells.map((c) => c.dataset.level)).toEqual(['0', '1', '0', '4', '2', '3', '1']);
  });

  it('今天是最右一格（`data-today` 只在末位）', async () => {
    useFocusStore.setState({ overview: overview({ days: days() }) });
    const el = await mount(<FocusDetailPane />);
    const cells = [...el.querySelectorAll<HTMLElement>('[data-testid="focus-pulse-day"]')];
    const today = cells.filter((c) => c.hasAttribute('data-today'));
    expect(today).toHaveLength(1);
    expect(cells[cells.length - 1]?.hasAttribute('data-today')).toBe(true);
  });

  it('`days` 为空（引擎还没就绪）时整条不画 —— 七根空柱子会谎称"这周没专注"', async () => {
    const el = await mount(<FocusDetailPane />);
    expect(countOf(el, 'focus-pulse')).toBe(0);
  });

  it('每一格都有可读出的文字事实（不靠颜色单独传达）', async () => {
    useFocusStore.setState({ overview: overview({ days: days() }) });
    const el = await mount(<FocusDetailPane />);
    const legends = [...el.querySelectorAll<HTMLElement>('.ht-app__detail-pulse-legend')].map(
      (n) => n.textContent ?? '',
    );
    expect(legends).toHaveLength(7);
    // 末位是今天（12 分钟）：周几 + 时长都要在。
    expect(legends[6]).toContain('12 分钟');
  });
});

describe('C 详情列按视图交给对应面板；任务面默认显示单一 AI Agent', () => {
  beforeEach(async () => {
    __resetOpLogForTests();
    await initOpLog();
    useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
    // 番茄钟默认是**关**的（关掉的模块不进 DOM），所以这里要显式打开。
    // 写"显式覆盖"而不是整个集合，是 `features/shell/modules.ts` 文件头定的形状。
    localStorage.setItem('heyta.shell.modules', JSON.stringify({ focus: true }));
  });

  it('默认那一面（任务）里详情列显示 Chatbot，而不是空栏', async () => {
    const el = await mountApp(false);
    const column = el.querySelector<HTMLElement>('[data-testid="detail-column"]');
    expect(column, '详情列没渲染出来（W2 那格被弄坏了？）').not.toBeNull();
    expect(
      column?.querySelector('[data-testid="ai-agent-surface"]'),
      '任务面无选中态时应由同一格显示 AI Agent',
    ).not.toBeNull();
    expect(
      column?.querySelector('[data-testid="ai-assistant"]'),
      '任务面详情列应显示统一 Chatbot 面板',
    ).not.toBeNull();
    expect(column?.querySelector('[data-testid="focus-detail-pane"]')).toBeNull();
  });

  it('切到专注面之后，概览与记录出现在**同一格里**', async () => {
    const el = await mountApp(true);
    const column = el.querySelector<HTMLElement>('[data-testid="detail-column"]');
    expect(column, '详情列没渲染出来').not.toBeNull();
    expect(
      column?.querySelector('[data-testid="focus-detail-pane"]'),
      '专注面没进详情列 —— 接线没接上',
    ).not.toBeNull();
  });
});

/**
 * 按看得见的文字点 rail 上的目的地（W1 之后 rail 上段 = 主段 ≤4 + 「更多」菜单）。
 *
 * 🔴 低频视图（番茄钟/时间线/成长/便签/倒数日）现在住在「更多」菜单里，而菜单
 * 只在点开「更多」后才进 DOM —— 所以主段找不到时先点 `.ht-rail__more button`
 * 再在 `[role="menuitem"]` 里找、点它。判据语义不变："用户点的是写着 X 的那颗"
 * —— 菜单项也是写着 X 的那颗。
 */
async function clickRailDestination(el: HTMLElement, label: string): Promise<void> {
  const mainTab = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (mainTab !== undefined) {
    await act(async () => {
      mainTab.click();
    });
    return;
  }
  const more = el.querySelector<HTMLButtonElement>('.ht-rail__more button');
  expect(more, `rail 主段没有「${label}」、也没有「更多」入口（模块开关没生效？）`).not.toBeNull();
  await act(async () => {
    more!.click();
  });
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) =>
    (b.textContent ?? '').includes(label),
  );
  expect(item, `「更多」菜单里没有「${label}」`).not.toBeUndefined();
  await act(async () => {
    item!.click();
  });
}

/**
 * 挂整棵 `App` 的那两条用例用的挂载。
 *
 * ⚠️ 必须走 App：判据是"这一栏在**哪个视图**里出现"，而那个条件写在 `App.tsx`。
 *    直接挂 `FocusDetailPane` 只能证组件自己会画，证不了接线 ——
 *    那正是 §8 里 W1 记过的"零件都在、没人接"的形状。
 */
async function mountApp(focusView: boolean): Promise<HTMLDivElement> {
  const { App } = await import('../src/App.js');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
  if (focusView) {
    // 按**看得见的文字**定位，不按 testid：rail 上那一排没有逐颗 testid，
    // 而"用户点的是写着番茄钟的那颗"本身就是这条判据的一部分。
    // （W1 后番茄钟落在「更多」菜单里 —— 开菜单再点的适配在 helper 里。）
    await clickRailDestination(container!, '番茄钟');
  }
  return container;
}

describe('D 源码级：这个界面不许自己算数', () => {
  it('FocusDetailPane.tsx 里没有 reduce / 自己调领域聚合函数', () => {
    const src = readFileSync(
      resolve(__dirname, '../src/features/focus/FocusDetailPane.tsx'),
      'utf8',
    );
    // 注释里会出现这些词（说明"为什么不许用"），所以先剥掉注释再扫。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const needle of ['.reduce(', 'focusStatsForDay', 'computeActivityTotals', 'listSessions']) {
      expect(code, `界面里出现了 ${needle} —— 数必须来自 focusOverview 那一个出口`).not.toContain(
        needle,
      );
    }
    /*
     * 正向对照。🔴 它要指**代码里真有的东西**：第一版这里写的是
     * `expect(code).toContain('focusOverview')`，而那个词只出现在被剥掉的注释里
     * —— 于是"剥注释 + 扫违禁词"这半边永远红，红的还不是缺陷。
     * 组件读的是 store 上的 `overview` 字段，所以对照就写这两件。
     */
    expect(code).toContain('useFocusStore');
    expect(code).toMatch(/s\)\.overview|s\) => s\.overview/);
  });
});
