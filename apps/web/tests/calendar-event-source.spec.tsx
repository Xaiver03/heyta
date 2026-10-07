/**
 * 日历的第二个数据源在 **Web 这一端真的接上了吗**（批次二 W6）
 * ==========================================================
 *
 * ## 这个文件防的是什么
 *
 * `CalendarBoard` 这轮拿到的是**两个默认值等于原行为的可选 prop**
 * （`events?` / `eventLabels?`）。这种形状有一种非常具体的假绿：
 *
 * > 共享层测试全绿（`packages/ui/tests/calendar-event-source.spec.ts` 11 条），
 * > 因为共享层**支持**了；而宿主一行没接 ⇒ 界面上一个倒数日都没有，
 * > 而没有任何一层会失败。
 *
 * 所以这里的判据全部是**挂载真 `App`、写真 op、看渲染出来的 DOM**，
 * 字符串在源码里出现过不算。另附一条同族的：侧栏那份迷你月历原先
 * **不跟着画「休 / 班」**（W4b 当场发现、当场登记给 W6），这里一并钉住。
 *
 * 🔴 **四个档位逐个有一条**（月格 / 选中那天的清单 / 日档全天带 / 年档那个点）：
 * 共享板现在有四块屏吃同一个 `events`，只测月档的话，"切到日视图那条日子就没了"
 * 这一类缺陷不会有任何一层失败 —— 而它和"宿主根本没接"在界面上是同一张图。
 *
 * ## 断言口径
 *
 * · **存在性先于取值**：先问"那一格有没有倒数日行"，再问它写了什么；
 * · 那一天**一条任务都没有**（夹具里没有 dueDate），所以那一行的出现
 *   本身就是"第二个源"的证据，而不是任务条的副产物；
 * · 词表由宿主注入 ⇒ 行里必须出现"还有 N 天"，只出现标题就是宿主没接上。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import './enable-all-modules.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { useCountdownStore } = await import('../src/features/countdown/store.js');
const { useCalendarViewStore } = await import('../src/features/calendar/store.js');
const { addDays, startOfMonth, toLocalDate, adjustmentOn, installHolidayAdjustmentOverrides } =
  await import('@heyta/domain');

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let dbName: string;
/** 每个用例一个独立库名：上一个用例建的倒数日会漏进下一个（症状是"多出一行"）。 */
let caseSeq = 0;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
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

async function openCalendar(): Promise<void> {
  const tab = [...(container?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') ?? [])].find(
    (b) => b.textContent?.trim() === '日历',
  );
  expect(tab, 'rail 上找不到「日历」—— 这一页就不存在').toBeDefined();
  await act(async () => {
    tab!.click();
  });
  await flush();
}

/** 事件 id 由 op-log 生成，用例里不猜：按标题从 store 读回来。 */
function eventIdOf(title: string): string {
  const found = useCountdownStore
    .getState()
    .events.find((event) => event.title === title);
  expect(found, `夹具里没找到「${title}」`).toBeDefined();
  return found!.id;
}

beforeEach(async () => {
  __resetOpLogForTests();
  localStorage.clear();
  caseSeq += 1;
  dbName = `calendar-events-${String(caseSeq)}-${Math.random().toString(36).slice(2)}`;
  await initOpLog(dbName);
  const today = toLocalDate(Date.now());
  useTaskStore.setState({ now: Date.now() });
  useCalendarViewStore.setState({
    cursor: startOfMonth(today),
    selected: today,
    view: 'month',
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

describe('倒数日进日历（Web 宿主接线）', () => {
  it('🔴 一条没有截止日的倒数日出现在它那一格（那一天没有任何任务）', async () => {
    await mount();
    await openCalendar();

    const today = toLocalDate(Date.now());
    const day = addDays(today, 5);
    let ok = false;
    await act(async () => {
      ok = await useCountdownStore.getState().addEvent('结婚纪念日', day);
    });
    expect(ok, '倒数日没落库 —— 后面的断言都不用看').toBe(true);
    await flush();

    // 那一天**没有任何任务**：这一行只可能来自第二个源。
    expect(
      container!.querySelector(`[data-testid="calendar-cell-${day}-bar"]`),
      '夹具前提不成立：那天出现了任务条，这一行就证明不了第二个源',
    ).toBeNull();

    const row = container!.querySelector(`[data-testid="calendar-cell-${day}-event"]`);
    expect(row, `那一格里没有倒数日行（${day}）`).not.toBeNull();
    const title = container!.querySelector(`[data-testid="calendar-cell-${day}-event-title"]`);
    expect(title?.textContent, '行里必须有一个字可读').toContain('结婚纪念日');
  });

  it('🔴 那一行说的是"还有 N 天"—— 宿主注入的词表真的接上了', async () => {
    await mount();
    await openCalendar();

    const day = addDays(toLocalDate(Date.now()), 5);
    await act(async () => {
      await useCountdownStore.getState().addEvent('搬家', day);
    });
    await flush();

    const title = container!.querySelector(`[data-testid="calendar-cell-${day}-event-title"]`);
    // 只出现标题 = 共享层画了而宿主没给词表（`calendarEventBarTitle` 的默认分支）。
    expect(title?.textContent, '宿主没注入 eventLabels').toContain('还有 5 天');
  });

  it('归档的倒数日不进日历（面板不显示的东西，日历也不许显示）', async () => {
    await mount();
    await openCalendar();

    const day = addDays(toLocalDate(Date.now()), 6);
    await useCountdownStore.getState().addEvent('要归档的日子', day);
    await flush();
    expect(
      container!.querySelector(`[data-testid="calendar-cell-${day}-event"]`),
      '前置条件：未归档时那一格就该有它',
    ).not.toBeNull();

    const entityId = useCountdownStore
      .getState()
      .events.find((event) => event.title === '要归档的日子')!.id;
    await act(async () => {
      await useCountdownStore.getState().archive(entityId);
    });
    await flush();

    expect(
      container!.querySelector(`[data-testid="calendar-cell-${day}-event"]`),
      '归档之后日历上还挂着它',
    ).toBeNull();
  });

  it('🔴 侧栏那份迷你月历也画「休 / 班」（W4b 欠 W6 的那半）', async () => {
    const today = toLocalDate(Date.now());
    const offDay = addDays(today, 2);
    const year = Number(offDay.slice(0, 4));
    installHolidayAdjustmentOverrides([{ year, offDays: [offDay], workDays: [] }]);
    expect(adjustmentOn(offDay), '夹具前提：覆盖表没装上，这条判据就成了空转').toBe('off');

    await mount();
    await openCalendar();

    const marker = container!.querySelector(`[data-testid="calendar-mini-marker-${offDay}"]`);
    expect(marker, '主区画了而侧栏没画 —— 同一屏两份说法').not.toBeNull();
    expect(marker?.textContent).toBe('休');
  });

  /*
    🔴 下面三条是同一件事的三个面：**四个档位都得认得第二个源**。
    只接月档那种"看得见就算做完"的形状本仓记过很多次 ——
    切到日视图/年视图，那条纪念日凭空消失，而共享层的测试仍然是全绿的
    （它测的是那块板**支持**，不是这一屏**画了**）。
  */

  it('🔴 点进那一天，月格里也有这一行（不是只存在于隐藏清单）', async () => {
    await mount();
    await openCalendar();

    const day = addDays(toLocalDate(Date.now()), 5);
    await act(async () => {
      await useCountdownStore.getState().addEvent('结婚纪念日', day);
    });
    await flush();
    const id = eventIdOf('结婚纪念日');

    // 走真路径点那一格（`pickDay` 会同时把选中与游标跟过去）。
    const cell = container!.querySelector<HTMLElement>(`[data-testid="calendar-cell-${day}"]`);
    expect(cell, `那一格没找到（${day}）`).not.toBeNull();
    await act(async () => {
      cell!.click();
    });
    await flush();

    // 当前 Web 月档不再重复渲染选中日清单；日期内容直接留在月格中，
    // 因此只验证月格里的事件条。日档全天带另有单独用例覆盖。
    expect(
      container!.querySelector('[data-testid="calendar-board-day-list"]'),
      '月档不应再渲染重复的选中日清单',
    ).toBeNull();
    expect(
      container!.querySelector('[data-testid="calendar-board-day-empty"]'),
      '月档不应再渲染选中日空态',
    ).toBeNull();

    const row = container!.querySelector(`[data-testid="calendar-cell-${day}-event-title"]`);
    expect(row, '月格里没有倒数日行').not.toBeNull();
    expect(row?.textContent).toContain('结婚纪念日');
    expect(row?.textContent, '行里没把天数说出来（宿主词表没接到这一屏）').toContain('还有 5 天');
  });

  it('🔴 日档：那一天摊开成全天带时，倒数日也在那一带', async () => {
    await mount();
    await openCalendar();

    const day = addDays(toLocalDate(Date.now()), 5);
    await act(async () => {
      await useCountdownStore.getState().addEvent('搬家', day);
    });
    await flush();
    const id = eventIdOf('搬家');

    // 日档渲染的是**游标**，所以这里写游标（宿主那条同步由 store 保证）。
    await act(async () => {
      useCalendarViewStore.setState({ view: 'day', cursor: day, selected: day });
    });
    await flush();

    const band = container!.querySelector('[data-testid="calendar-board-day-all-day"]');
    expect(band, '没有「全天」那条带 —— 这一档根本没渲染').not.toBeNull();

    const row = container!.querySelector(
      `[data-testid="calendar-board-day-all-day-event-${id}-title"]`,
    );
    expect(row, '切到日视图，那条纪念日就凭空消失了').not.toBeNull();
    expect(row?.textContent).toContain('搬家');
    expect(row?.textContent).toContain('还有 5 天');

    /*
      ⚠️ 那条"这天没有到期的任务"的空态**照旧要在**：它说的是任务，
      把倒数日算进它的分母就是让一句话去数它没提到的东西。
      这条断言防的是反过来那次错 —— 有人为了让空态消失把事件并进了 `buckets.allDay`。
    */
    expect(
      container!.querySelector('[data-testid="calendar-board-day-all-day-empty"]'),
      '全天带的空态被倒数日顶掉了（那句说的是任务）',
    ).not.toBeNull();
  });

  it('🔴 年档：12 张月卡里那一天有一个点', async () => {
    await mount();
    await openCalendar();

    const day = addDays(toLocalDate(Date.now()), 5);
    await act(async () => {
      await useCountdownStore.getState().addEvent('外婆生日', day);
    });
    await flush();

    // 游标放到**那一天所在的月**，于是这 12 张卡覆盖的一定含它（不依赖今天是几号）。
    await act(async () => {
      useCalendarViewStore.setState({ view: 'year', cursor: startOfMonth(day) });
    });
    await flush();

    const dot = container!.querySelector(`[data-testid="calendar-board-year-day-${day}-dot"]`);
    expect(dot, '切到年视图，整年的纪念日一个点都不画').not.toBeNull();
  });

  it('🔴 侧栏那颗迷你月历也标出这一天（正反两腿：隔壁那天不许有）', async () => {
    await mount();
    await openCalendar();

    const today = toLocalDate(Date.now());
    const day = addDays(today, 5);
    const neighbour = addDays(today, 6);
    await act(async () => {
      await useCountdownStore.getState().addEvent('侧栏也要认得', day);
    });
    await flush();

    // 前提：这两天都没有任务 ⇒ 侧栏出现的任何一颗点都只可能来自倒数日。
    expect(
      container!.querySelector(`[data-testid="calendar-cell-${day}-bar"]`),
      '前提不成立：那天有任务',
    ).toBeNull();

    expect(
      container!.querySelector(`[data-testid="calendar-mini-dot-${day}"]`),
      '主区有那条日子，侧栏那一格却说"这天没事"',
    ).not.toBeNull();
    // 反向腿：只画正的那一条挡不住"每天都画"（那等于没有信息）。
    expect(
      container!.querySelector(`[data-testid="calendar-mini-dot-${neighbour}"]`),
      '隔壁那天也被标了 ⇒ 这颗点回答的不是"这天有没有"',
    ).toBeNull();
  });
});
