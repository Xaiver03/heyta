/**
 * 习惯面单的**落点**（详情列那一格 / 列表右边）
 * ============================================
 *
 * 工单 C1 拍板 #1："选中某条 = 同一格换成该实体面单，不另开第三处"。
 * 习惯这一格今天装的是 `HabitDetailCard`（板子 + 图标/改名/删除那一排）。
 * 它必须同时满足：
 *
 *   1. 详情列**看得见**时，面单在那一栏里，而列表右边那一枚**不存在** ——
 *      不是"两处都有"（那就是第三处）；
 *   2. 看不见时（窄屏 / 太矮 / 用户主动收起）面单回到列表右边 ——
 *      🔴 不能只靠 CSS 藏：`display:none` 里那枚板子意味着"选中态进了模型、
 *      界面上什么都没有"，那是界面在说谎；
 *   3. 无论落在哪一支，**全页只有一块** `[data-testid="habit-board"]`，
 *      内容跟着共享选中态走（这一条与 `e2e/tests/motivation.spec.ts` 的白屏检测同判据）；
 *   4. "放不放得下"仍然只有一个算法（`../src/features/shell/detail-pane-visible.ts`），
 *      那一档由 `note-editor-placement.spec.tsx` 的 P1 组钉着，本文件不重复量。
 *
 * ⚠️ 与便签那一套（`note-editor-placement.spec.tsx`）的**分工**：那边的 P1 量的是
 * 规则本身（查询串与 `narrow.css` 同源），这边量的是习惯这一面自己的形状
 * （板子始终挂载、两条空态不互相冒充、`data-pane` 那个开关）。两边各挂各的组件，
 * 谁也不替谁作证。
 *
 * 🔴 落点的真浏览器读数在 `e2e/tests/detail-pane-habit.spec.ts`（H1–H5）。
 * jsdom 不做布局，所以"清单那一列有没有留下一根空轨道"这一类只能读源码形状（R 组）。
 *
 * 数据走**真 op-log**（`addHabit` / `deleteHabit`），不往 store 里塞假对象 ——
 * 与 `habits-list-pane.spec.tsx` 同一条纪律：靠探针写进去的数据渲染出的界面，
 * 证明不了用户点出来的数据能渲染。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { I18nProvider } = await import('@heyta/i18n');
const { selection } = await import('../src/lib/selection.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { NOW_STATE_KEY, useHabitStore } = await import('../src/features/habits/store.js');
const { HabitsView } = await import('../src/features/habits/HabitsView.js');
const { HabitDetailCard } = await import('../src/features/habits/HabitDetailCard.js');

const NOW = new Date(2026, 8, 28, 12, 0, 0).getTime();

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function until(label: string, cond: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error(
    `等待「${label}」超时\n当前界面文本：\n${(container?.textContent ?? '').slice(0, 400)}`,
  );
}

function habitIdOf(name: string): string {
  const h = useHabitStore.getState().habits.find((x) => x.name === name);
  if (h === undefined) throw new Error(`store 里没有习惯「${name}」`);
  return h.id;
}

const inRoot = <T extends Element>(selector: string, scope: ParentNode = container ?? document): T[] =>
  [...scope.querySelectorAll<T>(selector)];

/** 挂一棵树，返回它自己的容器（两支落点各挂各的，不共享 DOM）。 */
async function mount(node: React.JSX.Element): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<I18nProvider locale="zh-CN">{node}</I18nProvider>);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class NoopResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
});

beforeEach(async () => {
  sessionStorage.setItem(NOW_STATE_KEY, String(NOW));
  __resetOpLogForTests();
  await initOpLog(`habits-card-${Math.random().toString(36).slice(2)}`);
  await useHabitStore.getState().addHabit('喝水');
  await useHabitStore.getState().addHabit('阅读');
  selection.select('habit', null);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  selection.select('habit', null);
  useHabitStore.setState({ habits: [], logs: [] });
});

describe('Q. 落点：面单要么在栏里，要么在列表右边，不会两处都有', () => {
  it('`paneInColumn=true` ⇒ 视图里那一枚面单**不存在**', async () => {
    await act(async () => {
      selection.select('habit', habitIdOf('喝水'));
    });
    const view = await mount(<HabitsView paneInColumn />);
    expect(
      inRoot('.ht-habit__pane', view),
      '栏里那一支还开着 ⇒ 同一块面单在两处渲染（拍板 #1 说的"第三处"就是这个形状）',
    ).toHaveLength(0);
    expect(inRoot('[data-testid="habit-board"]', view), '视图里还挂着一块板').toHaveLength(0);
    // 清单本身照常在工作。
    expect(inRoot('.ht-habit__item', view)).toHaveLength(2);
  });

  it('`paneInColumn=false` ⇒ 列表右边恰好一枚面单、恰好一块板', async () => {
    await act(async () => {
      selection.select('habit', habitIdOf('喝水'));
    });
    const view = await mount(<HabitsView paneInColumn={false} />);
    expect(inRoot('.ht-habit__pane', view)).toHaveLength(1);
    expect(inRoot('[data-testid="habit-board"]', view)).toHaveLength(1);
  });

  it('🔴 面单跟着共享选中态换人，与落点无关（W1b 第 2 条腿的规则半边）', async () => {
    const view = await mount(<HabitDetailCard inset={false} />);
    // 没选中时板子里一张卡片都没有（不是"默认画第一条"—— §8.131 撤掉的就是那一档）。
    expect(inRoot('[data-testid^="habit-card-"]', view)).toHaveLength(0);
    await act(async () => {
      selection.select('habit', habitIdOf('阅读'));
    });
    const ids = inRoot<HTMLElement>('[data-testid^="habit-card-"]', view).map((el) =>
      (el.getAttribute('data-testid') ?? '').replace('habit-card-', ''),
    );
    expect(ids, '面单里不是恰好一张卡片').toEqual([habitIdOf('阅读')]);
    await act(async () => {
      selection.select('habit', habitIdOf('喝水'));
    });
    expect(
      inRoot<HTMLElement>('[data-testid^="habit-card-"]', view).map((el) => el.getAttribute('data-testid')),
    ).toEqual([`habit-card-${habitIdOf('喝水')}`]);
    expect(inRoot('[data-testid="habit-board"]', view), '换选中时多出一块板').toHaveLength(1);
  });

  it('🔴 未选中时板子照常挂载，说的是「选一条习惯」而不是列表里那两条', async () => {
    const view = await mount(<HabitDetailCard inset />);
    expect(inRoot('[data-testid="habit-board"]', view), '白屏检测那条要求板子始终一枚').toHaveLength(1);
    const text = view.textContent ?? '';
    expect(text).toContain('选一条习惯');
    expect(text).not.toContain('喝水');
    expect(text).not.toContain('阅读');
    // 两条空态不许互相冒充：有习惯时不许说"还没有习惯"。
    expect(text).not.toContain('还没有习惯');
  });

  it('列表**真的空了**时那句换成「还没有习惯」（两条空态各归各）', async () => {
    for (const name of ['喝水', '阅读']) {
      await act(async () => {
        await useHabitStore.getState().deleteHabit(habitIdOf(name));
      });
    }
    await until('两条习惯都落墓碑', () => useHabitStore.getState().habits.length === 0);
    const view = await mount(<HabitDetailCard inset />);
    const text = view.textContent ?? '';
    expect(text).toContain('还没有习惯');
    expect(text).not.toContain('选一条习惯');
    expect(inRoot('[data-testid="habit-board"]', view)).toHaveLength(1);
  });

  it('🔴 inset 只有栏里那一支拿到，而且两支是**同一枚元素**换类名，不是多一层壳', async () => {
    await act(async () => {
      selection.select('habit', habitIdOf('喝水'));
    });
    const inColumn = await mount(<HabitDetailCard inset />);
    const shell = inColumn.querySelector<HTMLElement>('.ht-habit__pane');
    expect(shell, '栏里那一支找不到面单').not.toBeNull();
    expect(shell?.className, '面单没带详情列的内边距类 ⇒ 板子会贴住窗口右边缘被切').toContain(
      'ht-app__detail-habit',
    );
    // 面单就是根节点本身：多包一层 `<div>` 会让窄屏那条 border-top 算错参照。
    expect(inColumn.firstElementChild, '落点靠包壳实现 ⇒ 面单不再是同一枚元素').toBe(shell);

    act(() => {
      root?.unmount();
    });
    root = undefined;
    container = undefined;
    const fallback = await mount(<HabitDetailCard inset={false} />);
    const plain = fallback.querySelector<HTMLElement>('.ht-habit__pane');
    expect(plain).not.toBeNull();
    expect(
      plain?.className,
      '回落那一支也带了栏里的内边距 ⇒ 列表右边的形状被这一单顺手改了',
    ).toBe('ht-habit__pane');
  });

  it('无障碍名跟着选中，两种落点都有（未选中时没有名字，不指着不存在的那一条）', async () => {
    await act(async () => {
      selection.select('habit', habitIdOf('阅读'));
    });
    for (const [where, inset] of [
      ['栏里', true],
      ['列表右边', false],
    ] as const) {
      act(() => {
        root?.unmount();
      });
      root = undefined;
      container = undefined;
      const view = await mount(<HabitDetailCard inset={inset} />);
      expect(
        view.querySelector('.ht-habit__pane')?.getAttribute('aria-label'),
        `${where}那一支的面单没有跟着选中说`,
      ).toBe('「阅读」的打卡记录');
    }
    await act(async () => {
      selection.select('habit', null);
    });
    expect(
      container?.querySelector('.ht-habit__pane')?.hasAttribute('aria-label'),
      '未选中时面单还挂着一个指着某条习惯的名字',
    ).toBe(false);
  });
});

describe('S. 面单的头行：名字在左、三颗工具在右，同一行（工单 §8.134）', () => {
  /* 🔴 这一族量的是**归属**，不是像素。§8.133 看图照出来的那个坏形状（三颗工具浮在栏顶、
     与页头同高，读起来像页头的工具条）在 jsdom 里量不到高度 —— 高度由
     `e2e/tests/detail-pane-habit.spec.ts` H6 量。这里能钉住的是"工具挂在哪一行的**结构**"：
     摘掉头行、把工具挪回头行外面、未选中时还把这一行画出来，三档都在这里红。 */
  const head = (view: ParentNode): Element | undefined =>
    view.querySelector('.ht-habit__pane-head') ?? undefined;

  it('标题行 = 所选那条的名字 + 三颗工具同一行，且板子不在这行里', async () => {
    await act(async () => {
      selection.select('habit', habitIdOf('阅读'));
    });
    const view = await mount(<HabitDetailCard inset />);
    const row = head(view);
    expect(row, '面单没有头行 ⇒ 三颗工具又回到"浮在栏顶"那一档').not.toBeNull();
    expect(
      row?.querySelector('.ht-habit__pane-title')?.textContent?.trim(),
      '头行的标题不是所选那条（用户不知道这三颗工具改的是谁）',
    ).toBe('阅读');
    const tools = row?.querySelector('.ht-habit__pane-tools');
    expect(tools, '三颗工具不在头行里').not.toBeNull();
    // 图标那颗 + 改名 + 删除 = 三颗，一个都不许多（多一颗说明工具行在往页头靠）。
    expect(tools?.children.length, `工具行里有 ${String(tools?.children.length)} 颗`).toBe(3);
    expect(
      row?.querySelector('[data-testid="habit-board"]'),
      '板子被画进了头行 ⇒ 这一行不再是"标题行"而是整栏',
    ).toBeNull();
  });

  it('🔴 未选中时这一行整个不存在（不许画一条指着没选中的那条的头行）', async () => {
    const view = await mount(<HabitDetailCard inset />);
    expect(head(view), '未选中时仍有头行').toBeUndefined();
    // 与 Q 组那条同一件事的另一面：这里钉的是**结构**（那一行不在），
    // Q 组钉的是**文本**（说的是「选一条习惯」）。两档各挡一种坏：
    // 只查文本的话，"头行写着第一条的名字、板子写着选一条习惯"这种分裂界面照样绿。
    expect(inRoot('.ht-habit__pane-tools', view)).toHaveLength(0);
    expect(inRoot('.ht-habit__pane-title', view)).toHaveLength(0);
  });
});

describe('R. 宿主接线与布局开关（直接挂组件的用例看不见这一层）', () => {
  /* 🔴 先剥注释（§8.130 为此撞过两处）：这些判据读的是代码形状，而注释里会引用
     被禁的那个写法本身。行注释只认行首的。 */
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (rel: string): string => stripComments(readFileSync(resolve(here, rel), 'utf8'));

  const app = read('../src/App.tsx');
  const asideStart = app.indexOf('<aside className="ht-app__detail"');
  const aside = app.slice(asideStart, app.indexOf('</aside>', asideStart));

  it('详情列那一支带的是**视图 + 几何/收起**两个条件，且槽里没有手写标记', () => {
    expect(aside, '详情列里找不到 HabitDetailCard').toContain('<HabitDetailCard inset');
    expect(aside).toContain("contentView === 'habits' && detailColumnShown");
    expect(aside, '装配处手写了 div ⇒ 内边距那一层该回到生产者里').not.toMatch(/<div\b/);
  });

  it('递给 HabitsView 的是同一个布尔，而不是又算一遍 / 写死', () => {
    expect(app.match(/paneInColumn=\{detailColumnShown\}/g) ?? []).toHaveLength(1);
  });

  it('`paneInColumn` 是必填 prop（默认值等于原行为那一档会把"宿主没接"伪装成"做完了"）', () => {
    const src = read('../src/features/habits/HabitsView.tsx');
    expect(src).toContain('paneInColumn: boolean');
    expect(src).not.toContain('paneInColumn?:');
  });

  it('🔴 面单搬走之后，`.ht-habit` 必须收成单列（否则留一根 5fr 的空轨道）', () => {
    const css = readFileSync(resolve(here, '../src/styles/app/habits.css'), 'utf8');
    const at = css.indexOf(".ht-habit[data-pane='column']");
    expect(at, 'habits.css 里没有那条单列覆盖 ⇒ 清单只占 2/7 宽、右边一整块空白').toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('}', at));
    expect(block).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(block, '单列那条里还留着 2fr ⇒ 覆盖根本没生效').not.toContain('2fr');
    // 开关的两档由同一个布尔推出来，不许写死。
    expect(read('../src/features/habits/HabitsView.tsx')).toContain(
      "data-pane={paneInColumn ? 'column' : 'pane'}",
    );
  });
});
