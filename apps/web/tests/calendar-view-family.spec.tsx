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
const { CALENDAR_VIEW_ORDER } = await import('@heyta/ui');

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
    expect(viewOptionLabels()).toEqual(['月', '周', '日', '年', '时间线']);

    await chooseView('timeline');

    // ① 点了真能走：时间线那一屏在 DOM 里，月历**不在**了。
    expect(q('timeline-view'), '选了「时间线」却没有切过去（点了没反应的那一档）').not.toBeNull();
    expect(q('calendar-board'), '切到时间线后月历还在内容区').toBeNull();

    // ② 🔴 那条分叉：`'timeline'` 是**外壳的视图**，不是日历 store 的字段。
    //    把它写进 store 会得到"下拉显示时间线、日历还是月历"的第三态，
    //    而类型上合法（`as CalendarViewKind`）、界面上也不报错 —— 只能这样钉。
    //    R17：这份清单不再由测试自己抄（批四加 day、R13 加 year 时这里都要手动跟着加一次）。
    //      现在它读的是共享层那份 `CALENDAR_VIEW_ORDER` —— 加一档而这里没跟上，
    //      要么共享层编译不过（`Record` 少一条），要么那条一致判据红，两种都不用有人记得。
    expect(CALENDAR_VIEW_ORDER).toContain(useCalendarViewStore.getState().view);

    // ③ 不是一扇单向门：走 rail 回日历，档位还是原来那一档。
    await openCalendar();
    expect(q<HTMLSelectElement>('calendar-view-select')!.value).toBe('month');
  });

  it('🔴 功能模块「时间线」关掉 ⇒ 下拉里**不出现**这一档（不给用户第二条绕过开关的路）', async () => {
    localStorage.clear();
    setModules({ calendar: true, timeline: false });
    await mount();
    await openCalendar();
    expect(viewOptionLabels()).toEqual(['月', '周', '日', '年']);

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

/**
 * 年档点一张月卡（R13）—— 总览点下去**必须有去处**
 * ===================================================
 *
 * 🔴 这一条测的不是"能点"，是**点下去之后那三样东西各去了哪里**：
 *   档位切成月档、游标落进那个月的月首、**选中的那天不许被顺手改掉**。
 *   第三样最容易写错：图省事复用 `selectDay(monthFirstDay)` 一行就过去了，
 *   症状是"我在年档翻了个月份，结果下面清单里选中的日子换成了那月 1 号"，
 *   而这条判断在类型上合法、界面上也不报错 —— 只能这样钉。
 *
 * ⚠️ 迁移规则本体（该改哪几项）在 `@heyta/ui` 的 `calendarMonthDrill`，
 *   单测在 `packages/ui/tests/calendar-year-model.spec.ts`；
 *   这里钉的是**宿主真的用了它**（有实现没消费者 = 仍没覆盖）。
 */
describe('年档的钻取：点月卡 ⇒ 切到那个月的月档，而选中那天不动', () => {
  it('🔴 点 3 月那张卡之后：档位是月、游标是 3 月 1 号、选中还是原来那天', async () => {
    await mount();
    await openCalendar();

    // 先把"选中"钉在一个与 3 月无关的日子，否则看不出它有没有被顺手改掉。
    // ⚠️ 必须包在 `act` 里：裸 `setState` 会让 React 在下一次 `flush` **之前**
    //   就重渲染（实测报 6 条 "not wrapped in act"），而"没等落位就断言"正是
    //   假绿的形状。
    await act(async () => {
      useCalendarViewStore.setState({
        selected: toLocalDate(new Date(2026, 9, 3).getTime()),
        cursor: startOfMonth(toLocalDate(new Date(2026, 9, 3).getTime())),
      });
    });
    await flush();

    await chooseView('year');
    expect(q('calendar-board-year'), '选了「年」却没出现年视图那块板').not.toBeNull();
    // 标题说的是**一年**：`2026年` 里不该出现月份那一段（漏接 `yearTitle` 会退回月份）。
    expect(q('calendar-toolbar-month')?.textContent).toMatch(/^\d{4}年$/u);

    await click(container!.querySelector<HTMLElement>('[data-testid="calendar-board-year-month-2026-03"]'));

    const state = useCalendarViewStore.getState();
    expect(state.view, '点了月卡，档位却没切过去').toBe('month');
    expect(state.cursor).toBe('2026-03-01');
    expect(state.selected, '点月卡把选中的那天也换掉了 —— 那不是钻取，是劫持').toBe('2026-10-03');
  });

  it('🔴 年档里点箭头是**翻一年**（翻成翻月是这一档最安静的坏法）', async () => {
    await mount();
    await openCalendar();
    await act(async () => {
      useCalendarViewStore.setState({
        cursor: toLocalDate(new Date(2026, 9, 3).getTime()),
        selected: toLocalDate(new Date(2026, 9, 3).getTime()),
      });
    });
    await chooseView('year');

    await click(q('calendar-toolbar-next'));

    const state = useCalendarViewStore.getState();
    expect(state.cursor).toBe('2027-10-03');
    // 卡片跟着换成年：12 张卡里出现的是 2027-01 … 2027-12。
    expect(
      container!.querySelector('[data-testid="calendar-board-year-month-2027-12-body"]'),
      '游标翻到 2027，卡片却还是 2026 的 12 个月',
    ).not.toBeNull();
    // 🔴 换年不许换选中那天（与"翻月不换选中"同一条立场）。
    expect(state.selected).toBe('2026-10-03');
  });
});
