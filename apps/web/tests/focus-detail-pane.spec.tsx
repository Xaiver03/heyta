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
    ...over,
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
  useFocusStore.setState({ overview: overview() });
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

  it('🔴 四张卡是**四张**，且标签各自不同 —— 少一张卡不会报错，只会让人以为没做', async () => {
    const el = await mount(<FocusDetailPane />);
    const cards = el.querySelectorAll('.ht-app__detail-card');
    expect(cards).toHaveLength(4);
    const labels = [...cards].map(
      (c) => c.querySelector<HTMLElement>('.ht-app__detail-card-label')?.textContent ?? '',
    );
    expect(new Set(labels).size, `卡标签有重复：${labels.join(' / ')}`).toBe(4);
  });
});

describe('B 专注记录列表', () => {
  it('渲染条数 == 出口给的条数（界面不再自己筛、也不切前 N 条）', async () => {
    useFocusStore.setState({
      overview: overview({
        totalCount: 3,
        records: [
          { id: 'r1', at: Date.now(), actualMs: 25 * MIN, completed: true, taskTitle: '写周报' },
          { id: 'r2', at: Date.now(), actualMs: 8 * MIN, completed: false, taskTitle: null },
          { id: 'r3', at: Date.now(), actualMs: 25 * MIN, completed: true, taskTitle: '读论文' },
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
        records: [{ id: 'r1', at: Date.now(), actualMs: 25 * MIN, completed: true, taskTitle: null }],
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
          { id: 'done', at: Date.now(), actualMs: 25 * MIN, completed: true, taskTitle: 'A' },
          { id: 'early', at: Date.now(), actualMs: 6 * MIN, completed: false, taskTitle: 'B' },
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
});

describe('C 这一栏只在专注面出现（其他视图不许借它的位置）', () => {
  beforeEach(async () => {
    __resetOpLogForTests();
    await initOpLog();
    useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
    // 番茄钟默认是**关**的（关掉的模块不进 DOM），所以这里要显式打开。
    // 写"显式覆盖"而不是整个集合，是 `features/shell/modules.ts` 文件头定的形状。
    localStorage.setItem('heyta.shell.modules', JSON.stringify({ focus: true }));
  });

  it('默认那一面（任务）里这一栏是空的', async () => {
    const el = await mountApp(false);
    const column = el.querySelector<HTMLElement>('[data-testid="detail-column"]');
    expect(column, '详情列没渲染出来（W2 那格被弄坏了？）').not.toBeNull();
    expect((column?.textContent ?? '').trim(), '任务面就出现了专注概览').toBe('');
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
    const tab = [...container.querySelectorAll('button')].find(
      (b) => (b.textContent ?? '').includes('番茄钟'),
    );
    expect(tab, 'rail 上没有「番茄钟」入口（模块开关没生效？）').not.toBeUndefined();
    await act(async () => {
      (tab as HTMLButtonElement).click();
    });
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
