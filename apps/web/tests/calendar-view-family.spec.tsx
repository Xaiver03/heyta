/**
 * 「按时间看」这一族的档位下拉（R11 批五下半 · §9.3 差异化第 3 条）
 * ==================================================================
 *
 * 产品负责人挑的差异化第 3 条原话是**"视图族可以多一档「时间线」"**，
 * 理由是"『按时间看』的两个入口合成一族，比硬凑日/周/年更有辨识度"。
 * 于是月 / 周 / 时间线 **共用页头那一个下拉**。
 *
 * ## 这个文件钉的是哪三件事
 *
 * 1. **点了真能走**：选「时间线」⇒ 渲染出时间线那一屏。
 *    这条是"一排点了没反应的菜单项"（§9.3 明确不做的事）的反面判据。
 * 2. 🔴 **它不进日历 store**：那次分叉必须真的分叉。
 *    如果有人图省事把 `'timeline'` 交给 `setView`，就得到
 *    "下拉显示时间线、日历还是月历"的第三态 —— **两头都不报错**，
 *    所以这里显式断言 `store.view` 仍然是 `CalendarViewKind`。
 *    ⚠️ 判据 1 单独**挡不住**这种写法（臂 R 实测：面板照样切过去，① 照样绿，
 *      红的是 ②），两条要一起看。
 * 3. **模块关掉时这一档不出现**：功能模块「时间线」关掉的设备上是**两档**。
 *    这条不是审美 —— `contentView` 只看 `view`、不看开关，
 *    所以下拉是**唯一**需要自己判断的地方；漏了就等于给了用户一条绕过开关的路。
 *
 * ⚠️ 真浏览器那一份在 `e2e/tests/calendar-week.spec.ts` 最后一例
 *   （断的是**看得见的字**：`['月','周','时间线']`）。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { useCalendarViewStore } = await import('../src/features/calendar/store.js');
const { startOfMonth, toLocalDate, FULL_SCOPE } = await import('@heyta/domain');

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let dbName: string;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * 写功能模块开关（**显式覆盖**，与 `modules.ts` 的存储形状一致）。
 *
 * ⚠️ 不复用 `tests/enable-all-modules.js`：那个助手只写 `true`，
 * 而本文件有一半的判据要的就是"某一项明确为 `false`"。
 */
function setModules(overrides: Record<string, boolean>): void {
  localStorage.setItem('heyta.shell.modules', JSON.stringify(overrides));
}

async function mount(): Promise<void> {
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
}

const q = <T extends HTMLElement>(testId: string): T | null =>
  container!.querySelector<T>(`[data-testid="${testId}"]`);

async function click(el: HTMLElement | null): Promise<void> {
  expect(el, '判据要点的控件不在 DOM 里').not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

async function openCalendar(): Promise<void> {
  const tab = [...(container?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') ?? [])].find(
    (b) => b.textContent?.trim() === '日历',
  );
  expect(tab, 'rail 上找不到「日历」').toBeDefined();
  // click 的签名是 `HTMLElement | null`（见上）—— 传 undefined 绕过了它自带的非空断言。
  await click(tab ?? null);
  expect(q('calendar-board'), '切过去后月历没渲染').not.toBeNull();
}

/** 档位下拉里的**可见文字**（用户点的就是这个，不是 value）。 */
function viewOptionLabels(): string[] {
  const select = q<HTMLSelectElement>('calendar-view-select');
  expect(select, '页头没有档位下拉').not.toBeNull();
  return [...select!.options].map((o) => o.textContent?.trim() ?? '');
}

/** 选一档（原生 `<select>`：改 value + 发 `change`，React 认这条）。 */
async function chooseView(value: string): Promise<void> {
  const select = q<HTMLSelectElement>('calendar-view-select');
  expect(select, '页头没有档位下拉').not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(select, value);
    select!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

beforeEach(async () => {
  __resetOpLogForTests();
  localStorage.clear();
  setModules({ calendar: true, timeline: true });
  dbName = `calendar-family-${Math.random().toString(36).slice(2)}`;
  await initOpLog(dbName);
  useTaskStore.setState({ now: Date.now() });
  useCalendarViewStore.setState({
    cursor: startOfMonth(toLocalDate(Date.now())),
    selected: toLocalDate(Date.now()),
    scope: FULL_SCOPE,
    view: 'month',
    captureOpen: false,
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('日历页头的「按时间看」档位下拉', () => {
  it('🔴 选「时间线」⇒ 真的切到时间线那一屏，而日历 store 里**没有** timeline 这个档位', async () => {
    await mount();
    await openCalendar();
    expect(viewOptionLabels()).toEqual(['月', '周', '时间线']);

    await chooseView('timeline');

    // ① 点了真能走：时间线那一屏在 DOM 里，月历**不在**了。
    expect(q('timeline-view'), '选了「时间线」却没有切过去（点了没反应的那一档）').not.toBeNull();
    expect(q('calendar-board'), '切到时间线后月历还在内容区').toBeNull();

    // ② 🔴 那条分叉：`'timeline'` 是**外壳的视图**，不是日历 store 的字段。
    //    把它写进 store 会得到"下拉显示时间线、日历还是月历"的第三态，
    //    而类型上合法（`as CalendarViewKind`）、界面上也不报错 —— 只能这样钉。
    expect(['month', 'week']).toContain(useCalendarViewStore.getState().view);

    // ③ 不是一扇单向门：走 rail 回日历，档位还是原来那一档。
    await openCalendar();
    expect(q<HTMLSelectElement>('calendar-view-select')!.value).toBe('month');
  });

  it('🔴 功能模块「时间线」关掉 ⇒ 下拉里**不出现**这一档（不给用户第二条绕过开关的路）', async () => {
    localStorage.clear();
    setModules({ calendar: true, timeline: false });
    await mount();
    await openCalendar();
    expect(viewOptionLabels()).toEqual(['月', '周']);

    // 而且这不是"字没了但还能选"：value 上也没有这个取值。
    const select = q<HTMLSelectElement>('calendar-view-select');
    expect([...select!.options].map((o) => o.value)).not.toContain('timeline');
  });

  it('「周」那一档走的仍然是日历 store（新增一档没有把原有的两条路并成一条）', async () => {
    await mount();
    await openCalendar();
    await chooseView('week');
    expect(useCalendarViewStore.getState().view).toBe('week');
    expect(q('timeline-view'), '切周档不该把时间线拉出来').toBeNull();
    const cells = container!.querySelectorAll('[data-testid^="calendar-cell-"][role="button"]');
    expect(cells).toHaveLength(7);
  });
});
