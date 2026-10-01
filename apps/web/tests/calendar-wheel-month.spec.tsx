/**
 * 滚轮翻月（Web）
 * ================
 *
 * 产品负责人 2026-10-01 定的交互模型：**指针在月历格子上，滚轮就归月历** ——
 * 上滚 = 上一月，下滚 = 下一月，页面不跟着滚。先例是 macOS「日历」设置里那条
 * "使用滚动滚轮来更改月份"，采的是同一套语义（**指针持有**，不是"整页可滚"）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 两部分判据，各守一类失效
 *
 * **A. `readWheelMonth`（纯函数）** 守的是**单位与节奏**：
 * `deltaMode` 三种取值给的是不同单位，直接看 `deltaY` 在 Firefox 上一格会翻三次、
 * 触控板一推会翻八个月。这两类症状都不会报错，只会让人觉得"这日历疯了"。
 * `now` 显式传入正是为了让锁定窗口可测 —— 判据里读时钟就测不了。
 *
 * **B. 渲染级** 守的是**接线**：`ref` 挂没挂上、`within` 圈得对不对、
 * 两列写的是不是**同一个** `cursor`。
 * ⚠️ jsdom **不实现 passive 监听选项**，所以"`preventDefault` 到底有没有生效"
 * 这一条只能看 `event.defaultPrevented`（证明我们调用过），
 * **不能**证明真浏览器里页面没滚走 —— 那一条钉在 `e2e/tests/calendar-wheel.spec.ts`。
 *
 * ## 🔴 方向写反是抓得住的
 *
 * 把"下滚 = 未来"写成"下滚 = 过去"，界面照样翻月、没有任何一层会报错。
 * 所以断言的是**月份标题的具体值**（`2026年10月` / `2026年8月`），不是"标题变了"。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  IDLE_WHEEL_ACCUMULATOR,
  WHEEL_MONTH_LOCK_MS,
  WHEEL_MONTH_NOTCH_PX,
  readWheelMonth,
  type WheelSignal,
} from '../src/features/calendar/wheel-month.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, currentState, initOpLog } = await import('../src/lib/oplog.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { useProjectStore } = await import('../src/features/projects/store.js');
const { useCalendarViewStore } = await import('../src/features/calendar/store.js');
const { FULL_SCOPE } = await import('@heyta/domain');

// ───────────────────────────────────────────────────────────────────────────
// A. 判据
// ───────────────────────────────────────────────────────────────────────────

/** 造一个信号，默认值是"Chrome 里一格鼠标滚轮"。 */
function signal(over: Partial<WheelSignal> = {}): WheelSignal {
  return {
    deltaY: WHEEL_MONTH_NOTCH_PX,
    deltaX: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    ...over,
  };
}

describe('readWheelMonth（滚轮翻月的判据）', () => {
  it('一格下滚 = 往后一个月，并且这一格被吃掉', () => {
    const r = readWheelMonth(signal({ deltaY: 100 }), IDLE_WHEEL_ACCUMULATOR, 1_000);
    expect(r.step).toBe(1);
    expect(r.consume).toBe(true);
    // 🔴 锁定窗口从**事件时刻**起算，不是从 0 起算 —— 写成 `WHEEL_MONTH_LOCK_MS`
    //     这种绝对值，真机上（`Date.now()` 是万亿量级）会永远不锁。
    expect(r.accumulator.lockedUntil).toBe(1_000 + WHEEL_MONTH_LOCK_MS);
  });

  it('一格上滚 = 往前一个月', () => {
    expect(readWheelMonth(signal({ deltaY: -100 }), IDLE_WHEEL_ACCUMULATOR, 1_000).step).toBe(-1);
  });

  it('触控板的小步要攒满一格才翻，攒不满不翻', () => {
    let acc = IDLE_WHEEL_ACCUMULATOR;
    const steps: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const r = readWheelMonth(signal({ deltaY: 3 }), acc, 1_000);
      steps.push(r.step);
      acc = r.accumulator;
      if (r.step !== 0) break;
    }
    // 20 × 3 = 60 已过一格的阈值，所以**恰好翻一次**，而且翻完就进锁定期。
    expect(steps.filter((s) => s !== 0)).toEqual([1]);
    expect(acc.acc).toBe(0);
  });

  it('🔴 Firefox（行模式）一格只翻一次，不是三格翻三次', () => {
    // Firefox 一格报 3 行 ⇒ 折成像素恰好等于阈值。拿 `deltaY > 0` 直接翻月
    // 在这里会变成 step=1（看起来"对"），但**每一行**都会翻 —— 所以喂三条一行。
    let acc = IDLE_WHEEL_ACCUMULATOR;
    const flips: number[] = [];
    for (const at of [1_000, 1_000 + WHEEL_MONTH_LOCK_MS + 1, 1_000 + (WHEEL_MONTH_LOCK_MS + 1) * 2]) {
      const r = readWheelMonth(signal({ deltaY: 1, deltaMode: 1 }), acc, at);
      flips.push(r.step);
      acc = r.accumulator;
    }
    // 一条一行不够（16 < 48）⇒ 只有最后累计越过阈值那一次会翻。
    expect(flips.filter((s) => s !== 0)).toHaveLength(1);
  });

  it('一格行模式（3 行）正好等于一格', () => {
    const r = readWheelMonth(signal({ deltaY: 3, deltaMode: 1 }), IDLE_WHEEL_ACCUMULATOR, 1_000);
    expect(r.step).toBe(1);
  });

  it('差一点点不算一格（阈值是"至少"，不是"大于"）', () => {
    expect(
      readWheelMonth(signal({ deltaY: WHEEL_MONTH_NOTCH_PX - 1 }), IDLE_WHEEL_ACCUMULATOR, 1_000)
        .step,
    ).toBe(0);
    expect(
      readWheelMonth(signal({ deltaY: WHEEL_MONTH_NOTCH_PX }), IDLE_WHEEL_ACCUMULATOR, 1_000).step,
    ).toBe(1);
  });

  it('🔴 翻完之后的惯性尾巴被锁定期吃掉，不会排队成第二次翻月', () => {
    const first = readWheelMonth(signal({ deltaY: 100 }), IDLE_WHEEL_ACCUMULATOR, 1_000);
    // 手指已经离开触控板，浏览器还在派发递减的事件 —— 必须**吃掉**（不滚页）但**不翻**。
    const momentum = readWheelMonth(signal({ deltaY: 100 }), first.accumulator, 1_050);
    expect(momentum.step).toBe(0);
    expect(momentum.consume).toBe(true);
    expect(momentum.accumulator.acc).toBe(0);
    // 锁定期一过，同一格又能翻 —— 证明丢掉的不是能力，只是排队。
    const after = readWheelMonth(signal({ deltaY: 100 }), momentum.accumulator, 1_500);
    expect(after.step).toBe(1);
  });

  it('反向滚动重新起算，不会正负抵消后按最后一次的方向翻', () => {
    const down = readWheelMonth(
      signal({ deltaY: WHEEL_MONTH_NOTCH_PX - 8 }),
      IDLE_WHEEL_ACCUMULATOR,
      1_000,
    );
    expect(down.step).toBe(0);
    const up = readWheelMonth(signal({ deltaY: -(WHEEL_MONTH_NOTCH_PX - 8) }), down.accumulator, 1_010);
    // 写成"累加不清零"的话这里会得到 0（抵消）→ 不翻；再滚一下就可能翻错方向。
    expect(up.accumulator.acc).toBe(-(WHEEL_MONTH_NOTCH_PX - 8));
    expect(up.step).toBe(0);
  });

  it('触控板横向手势让出去（不翻也不吃）', () => {
    const r = readWheelMonth(
      signal({ deltaY: 20, deltaX: 120 }),
      { acc: 30, lockedUntil: 0 },
      1_000,
    );
    expect(r.step).toBe(0);
    expect(r.consume).toBe(false);
    expect(r.accumulator.acc).toBe(0);
  });

  it('⌘/Ctrl + 滚轮（浏览器缩放）让出去', () => {
    for (const mod of [
      { ctrlKey: true },
      { metaKey: true },
    ] as const) {
      const r = readWheelMonth(signal({ deltaY: 100, ...mod }), IDLE_WHEEL_ACCUMULATOR, 1_000);
      expect(r.step).toBe(0);
      expect(r.consume).toBe(false);
    }
  });

  it('零位移不翻也不吃，也不动累计量', () => {
    const prev = { acc: 20, lockedUntil: 5_000 };
    const r = readWheelMonth(signal({ deltaY: 0 }), prev, 6_000);
    expect(r).toEqual({ step: 0, consume: false, accumulator: prev });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B. 接线
// ───────────────────────────────────────────────────────────────────────────

/** 2026 年 9 月的某天中午（避开时区边界：中午怎么换算都还是这一天）。 */
const SEPT = (day: number): number => new Date(2026, 8, day, 12, 0, 0).getTime();
const TODAY = '2026-09-28';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function resetStores(): Promise<void> {
  __resetOpLogForTests();
  localStorage.clear();
  await initOpLog(`calendar-wheel-${Math.random().toString(36).slice(2)}`);
  useTaskStore.setState({ entities: currentState(), now: SEPT(28) });
  useProjectStore.setState({ projects: [], tags: [] });
  useCalendarViewStore.setState({ cursor: '2026-09-01', selected: TODAY, scope: FULL_SCOPE });
  // 🔴 必须有一条**今天**的任务：当天清单那一块只在"这天有点"时才在 DOM 里
  //    （没任务时渲染的是空态），而"指针在清单上滚轮不归月历"那条判据的靶子就是它。
  await act(async () => {
    await useTaskStore.getState().addTask('周报', { dueDate: SEPT(28) });
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function need(testId: string): HTMLElement {
  const el = container!.querySelector(`[data-testid="${testId}"]`);
  expect(el, `找不到 ${testId}`).not.toBeNull();
  return el as HTMLElement;
}

/**
 * 派发一次滚轮。
 *
 * ⚠️ 用 `Event` + 手工挂字段，不用 `new WheelEvent(...)`：jsdom 的 `WheelEvent`
 * 初始化字典对 `deltaMode` 的支持不完整，构造出来 `deltaMode` 会是 `undefined`，
 * 于是**判据拿到的永远是像素模式** —— 行模式那条路在测试里根本没走过。
 */
async function wheelOn(
  testId: string,
  init: { deltaY: number; deltaX?: number; deltaMode?: number; ctrlKey?: boolean; metaKey?: boolean },
): Promise<boolean> {
  const target = need(testId);
  const event = new Event('wheel', { bubbles: true, cancelable: true });
  Object.assign(event, {
    deltaY: init.deltaY,
    deltaX: init.deltaX ?? 0,
    deltaMode: init.deltaMode ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await flush();
  return event.defaultPrevented;
}

function monthTitles(): { main: string; mini: string } {
  return {
    main: need('calendar-board-month').textContent?.trim() ?? '',
    mini: need('calendar-mini-title').textContent?.trim() ?? '',
  };
}

describe('滚轮翻月（接线）', () => {
  beforeEach(async () => {
    await resetStores();
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
    await flush();
    const tab = [...(container?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') ?? [])].find(
      (b) => b.textContent?.trim() === '日历',
    );
    expect(tab, 'rail 上找不到「日历」').toBeDefined();
    await act(async () => {
      tab!.click();
    });
    await flush();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it('指针停在主区月历格子上：下滚翻到 10 月，两列一起走', async () => {
    expect(monthTitles()).toEqual({ main: '2026年9月', mini: '2026年9月' });
    const prevented = await wheelOn('calendar-board-month-card', { deltaY: 100 });
    // 🔴 方向判据：写反了界面照样动，所以钉的是**月份名**，不是"变了"。
    expect(monthTitles()).toEqual({ main: '2026年10月', mini: '2026年10月' });
    expect(prevented, '归月历的滚轮必须被吃掉，否则页面会同时滚走').toBe(true);
  });

  it('上滚翻到 8 月（而不是也翻到 10 月）', async () => {
    await wheelOn('calendar-board-month-card', { deltaY: -100 });
    expect(monthTitles()).toEqual({ main: '2026年8月', mini: '2026年8月' });
  });

  it('侧栏迷你月历上滚同样翻月，主区跟着走', async () => {
    await wheelOn('calendar-mini-title', { deltaY: 100 });
    expect(monthTitles()).toEqual({ main: '2026年10月', mini: '2026年10月' });
  });

  it('🔴 指针在当天清单上：滚轮不归月历（不翻、也不吃掉页面滚动）', async () => {
    const prevented = await wheelOn('calendar-board-day-list', { deltaY: 100 });
    expect(monthTitles()).toEqual({ main: '2026年9月', mini: '2026年9月' });
    expect(prevented, '把清单上的滚轮吃掉 = 那一块再也滚不动页面').toBe(false);
  });

  it('触控板横向手势不翻月', async () => {
    const prevented = await wheelOn('calendar-board-month-card', { deltaY: 10, deltaX: 120 });
    expect(monthTitles()).toEqual({ main: '2026年9月', mini: '2026年9月' });
    expect(prevented).toBe(false);
  });

  it('⌘ + 滚轮（缩放）不翻月', async () => {
    const prevented = await wheelOn('calendar-board-month-card', { deltaY: 100, metaKey: true });
    expect(monthTitles()).toEqual({ main: '2026年9月', mini: '2026年9月' });
    expect(prevented).toBe(false);
  });

  it('不够一格的轻推不翻月（阈值在渲染路径上同样生效）', async () => {
    await wheelOn('calendar-board-month-card', { deltaY: 12 });
    expect(monthTitles()).toEqual({ main: '2026年9月', mini: '2026年9月' });
  });

  it('选中的那一天不跟月份走（翻月 ≠ 翻日子）', async () => {
    await wheelOn('calendar-board-month-card', { deltaY: 100 });
    expect(useCalendarViewStore.getState().selected).toBe(TODAY);
    expect(need('calendar-board-day-title').textContent ?? '').toContain('9月28日');
  });
});
