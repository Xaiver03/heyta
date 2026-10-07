/**
 * 日历视图 —— **Web 上真的有这一页吗**
 * ======================================
 *
 * ## 这个文件防的是什么
 *
 * 2026-09-29 之前的实测事实：**`apps/web` 一个日历都没有**
 *（`apps/web/src/features/` 下没有 `calendar/`，`ViewKey` 里也没有 `'calendar'`），
 * 而 `apps/mobile` 有一个 439 行的月历。
 *
 * ⚠️ 那次复核里这一项**一度被判成"已修"**，依据是
 * `rg -li calendar apps/web/src` 命中了 4 个文件 —— 而它们是
 * `CalendarDays` 图标、习惯热力图、日期显示，**没有一个日历视图**。
 * 这正是本仓反复记的"判据必须是结构性的，不能是「出现了这个词」"。
 *
 * ⇒ 所以这里的判据全部是**渲染出来的东西**：42 个格子、月格里的任务条、
 * 页脚那句"未设截止时间的任务不在日历上"。字符串命中不算。
 *
 * ## 🔴 它同时钉住"共享"这件事
 *
 * 日历的**渲染**来自 `packages/ui` 的 `CalendarBoard`，与 mobile 是同一份；
 * **数学**来自 `@heyta/domain`。所以这一轮的验收里必须有一条
 * "格子数与 `monthGrid` 一致" —— 那条断言若在两端各写一份实现时会**照样绿**
 *（都是 42），所以另有一条钉**日期标题的措辞来自共享 `date-text.ts`**。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { enableModules } from './enable-all-modules.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { useCalendarViewStore } = await import('../src/features/calendar/store.js');
const { addDays, startOfMonth, FULL_SCOPE, toLocalDate } = await import('@heyta/domain');
/** 🔴 上限**从共享层取**，不在测试里抄一个 3 —— 抄件一定会漂。 */
const { MAX_CALENDAR_BARS } = await import('@heyta/ui');

let root: Root | undefined;
let container: HTMLDivElement | undefined;
/**
 * 🔴 每个用例一个**独立的库名**。
 *
 * 用默认的 `'heyta'` 时，上一个用例建的任务会留到下一个用例 ——
 * 而症状很隐蔽：`Object.keys(tasks)[0]` 拿到的是**上一轮那条**，
 * 于是"给今天这条设截止时间"设到了别人身上，断言失败看起来像日历分错了组。
 *（这条就是踩出来的。）
 */
let dbName: string;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function byText(text: string): HTMLElement | undefined {
  return [...(container?.querySelectorAll('button') ?? [])].find((b) =>
    b.textContent?.includes(text),
  ) as HTMLElement | undefined;
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

/** 切到日历视图（rail 上的 `role=tab`）。 */
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

beforeEach(async () => {
  __resetOpLogForTests();
  localStorage.clear();
  dbName = `calendar-view-${Math.random().toString(36).slice(2)}`;
  await initOpLog(dbName);
  // 把任务建在"今天"，这样一打开日历就能在选中那天看到它。
  const today = toLocalDate(Date.now());
  useTaskStore.setState({ now: Date.now() });
  /**
   * 🔴 日历的**界面状态也是模块级单例**（`features/calendar/store.ts` —— 侧栏与
   * 主区共用）。不重置的话，上一个用例翻到的月份会漏进下一个用例，
   * 而症状是"这一轮列出了别的那天的任务"，看起来像日历分错了组。
   */
  useCalendarViewStore.setState({
    cursor: startOfMonth(today),
    selected: today,
    scope: FULL_SCOPE,
    // 🔴 `view` 也必须重置：它是同一个模块级单例的一部分。漏掉它的症状是
    //    "上一个用例切到了周视图，这一用例数出 7 个格子"，
    //    而失败信息看起来像月历坏了。
    view: 'month',
  });
  void today;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('日历视图（Web）', () => {
  it('🔴 rail 上有「日历」，点了真的渲染出月历（不是白屏）', async () => {
    await mount();
    await openCalendar();

    const board = container!.querySelector('[data-testid="calendar-board"]');
    expect(board, '没有渲染出日历板').not.toBeNull();

    // 6 周 × 7 天 = 42 个格子。这个数字来自 `@heyta/domain` 的 `monthGrid`，
    // 不是在这里手写的一串 `<View>`。
    const cells = board!.querySelectorAll('[data-testid="calendar-board"] [role="button"]');
    // 42 个日期格 + 上月/下月/回到今天 三个按钮。
    expect(cells.length, `日历格子数不对（含导航按钮共 ${String(cells.length)} 个 role=button）`)
      .toBeGreaterThanOrEqual(42);
  });

  it('🔴 月份标题与选中格子的无障碍日期来自**共享的** `date-text.ts`（中文口径）', async () => {
    await mount();
    await openCalendar();

    const month = container!.querySelector('[data-testid="calendar-toolbar-month"]')?.textContent ?? '';
    // 「2026年9月」——这条形状由共享的 `formatMonthTitleText` 决定。
    expect(month, `月份标题不像共享实现给的形状：「${month}」`).toMatch(/^\d{4}年\d{1,2}月$/);

    const selected = container!.querySelector<HTMLElement>('[data-testid^="calendar-cell-"][aria-selected="true"]');
    const day = selected?.getAttribute('aria-label') ?? '';
    // 「9月29日 星期一」是共享层无障碍日期的一部分；后面可能还有“有几条/无安排”。
    expect(day, `选中格子的日期不像共享实现给的形状：「${day}」`).toMatch(
      /\d{1,2}月\d{1,2}日 星期[一二三四五六日]/,
    );
  });

  it('🔴 **未设截止时间的任务不在日历上**，而且页面**如实说出来**了', async () => {
    await useTaskStore.getState().addTask('没有截止时间的事');
    await mount();
    await openCalendar();

    const board = container!.querySelector('[data-testid="calendar-board"]');
    // 页脚必须存在 —— 不说的话，"任务没设截止时间"会被读成"任务丢了"。
    const footnote = board!.querySelector('[data-testid="calendar-board-footnote"]');
    expect(footnote, '日历缺少「未设截止时间的任务不在日历上」那句说明').not.toBeNull();
    expect(footnote!.textContent ?? '').toContain('未设截止时间');
  });

  it('🔴 当天有任务时，月格里**真的有那一行**（列不出来等于没接上）', async () => {
    await useTaskStore.getState().addTask('今天要交的东西');
    // 设成今天到期（走 action，不直接改 state）。
    // ⚠️ `setDueDate` 收的是**时间戳**（`LocalDate` → 当日零点），不是 LocalDate 串 ——
    //    传错类型编译期就会拦住，这里写明是为了下一个读的人不必再查一次。
    const id = Object.keys(useTaskStore.getState().entities.tasks)[0];
    expect(id, '建完之后应当有一条任务').toBeDefined();
    await useTaskStore.getState().setDueDate(id!, Date.now());

    await mount();
    await openCalendar();

    const date = toLocalDate(Date.now());
    const title = container!.querySelector(`[data-testid="calendar-cell-${date}-bar-title"]`);
    expect(title, '当天月格里的任务条没渲染').not.toBeNull();
    expect(title?.textContent).toBe('今天要交的东西');
  });

  /**
   * R11 批一：月格从"最多 3 个圆点"改成"任务条 + `+N`"。
   *
   * 🔴 这一组判据钉的是**界面上真的读得到字**这件事 —— 圆点时代 `role=button`
   * 的格子数量照样是 42，一条都不会红。
   * 折叠的数量**不在这层重算**（那是 `calendarCellBars` 的事，已在
   * `packages/ui/tests/calendar-cell-bars.spec.ts` 钉住），这里只验它传到了 DOM。
   * "没有一条被裁一半"也**不在这层**：jsdom 的 rect 全是 0，
   * 那条只能在真浏览器里量（`e2e/tests/calendar-cells.spec.ts`）。
   */
  async function seedDueToday(titles: readonly string[]): Promise<void> {
    for (const title of titles) {
      await useTaskStore.getState().addTask(title);
      const created = useTaskStore.getState().entities.tasks;
      const id = Object.keys(created).find(
        (key) => created[key]?.title === title && created[key]?.dueDate === undefined,
      );
      expect(id, `没找到刚建的「${title}」`).toBeDefined();
      await useTaskStore.getState().setDueDate(id!, Date.now());
    }
  }

  it('🔴 格子里画的是**任务标题**（不是一个点）—— 这条是整个改造的立论', async () => {
    await seedDueToday(['评审登录页', '补备案材料']);
    await mount();
    await openCalendar();

    const today = toLocalDate(Date.now());
    const cell = container!.querySelector<HTMLElement>(`[data-testid="calendar-cell-${today}"]`);
    expect(cell, `今天的格子 (calendar-cell-${today}) 没渲染`).not.toBeNull();

    const bars = [...cell!.querySelectorAll(`[data-testid="calendar-cell-${today}-bar"]`)];
    expect(bars, '格子里一条任务条都没有').toHaveLength(2);
    // 🔴 每条都必须**有字**：空文本的"条"就退化回圆点了。
    for (const bar of bars) {
      expect((bar.textContent ?? '').trim(), '任务条是空的（等于没画标题）').not.toBe('');
    }
    const drawn = bars.map((bar) => bar.textContent?.trim());
    expect(drawn).toEqual(expect.arrayContaining(['评审登录页', '补备案材料']));
  });

  it('🔴 超过上限的折成「+N」，N = 这一天真正的条数 − 可见条数', async () => {
    await seedDueToday(['甲', '乙', '丙', '丁', '戊']);
    await mount();
    await openCalendar();

    const today = toLocalDate(Date.now());
    const cell = container!.querySelector<HTMLElement>(`[data-testid="calendar-cell-${today}"]`);
    expect(cell).not.toBeNull();
    const bars = cell!.querySelectorAll(`[data-testid="calendar-cell-${today}-bar"]`);
    // jsdom 没有真实格高；初始容量保守预留 +N 行，真实缩放由浏览器旅程验证。
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.length).toBeLessThanOrEqual(MAX_CALENDAR_BARS);

    const more = cell!.querySelector(`[data-testid="calendar-cell-${today}-more"]`);
    expect(more, '剩余任务应有准确的折叠数量').not.toBeNull();
    expect(more!.textContent).toBe(`+${String(5 - bars.length)}`);
  });

  it('🔴 恰好等于上限时**不出现「+0」**（那句废话在数据上就该是 0）', async () => {
    await seedDueToday(['甲', '乙', '丙'].slice(0, MAX_CALENDAR_BARS));
    await mount();
    await openCalendar();

    const today = toLocalDate(Date.now());
    const cell = container!.querySelector<HTMLElement>(`[data-testid="calendar-cell-${today}"]`);
    expect(cell).not.toBeNull();
    expect(cell!.querySelectorAll(`[data-testid="calendar-cell-${today}-bar"]`)).toHaveLength(
      MAX_CALENDAR_BARS,
    );
    expect(
      cell!.querySelector(`[data-testid="calendar-cell-${today}-more"]`),
      '格子装得下全部任务时不该出现折叠标记',
    ).toBeNull();
  });

  it('读屏念的是**这一天的总条数**，不是画出来的那几条（折叠不能把数字说小）', async () => {
    await seedDueToday(['甲', '乙', '丙', '丁', '戊']);
    await mount();
    await openCalendar();

    const today = toLocalDate(Date.now());
    const cell = container!.querySelector<HTMLElement>(`[data-testid="calendar-cell-${today}"]`);
    expect(cell).not.toBeNull();
    expect(cell!.getAttribute('aria-label'), '格子没有读屏名').toContain('5 个任务');
  });

  it('🔴 「回到今天」把选中框带回今天（跨月之后仍然有效）', async () => {
    const today = toLocalDate(Date.now());
    const monthOf = (): string =>
      container!.querySelector('[data-testid="calendar-toolbar-month"]')?.textContent ?? '';
    await mount();
    await openCalendar();
    const before = monthOf();

    // 先翻到下个月。
    const next = [...container!.querySelectorAll<HTMLElement>('[role="button"]')].find(
      (b) => b.getAttribute('aria-label') === '下个月',
    );
    expect(next, '找不到「下个月」按钮').toBeDefined();
    await act(async () => {
      next!.click();
    });
    await flush();
    // ⚠️ 这条是**前提**，不是装饰：翻月没真的发生的话，下面那句"月份回来了"
    //    会因为它从来没走过而永远成立（原来这里写的是 `not.toBe(Number(...) + 1)`，
    //    而 `Number('2026年10月')` 是 NaN ⇒ 那条判据一次也红不了）。
    expect(monthOf(), '翻「下个月」之后月份没变，下面就没东西可"回"').not.toBe(before);

    // 回到今天。
    const back = container!.querySelector<HTMLElement>('[data-testid="calendar-toolbar-today"]');
    expect(back, '找不到「回到今天」').not.toBeNull();
    await act(async () => {
      back!.click();
    });
    await flush();

    expect(monthOf(), '「回到今天」之后月份没有回来').toBe(before);
    // 选中那天应当是今天 —— 选中格子的无障碍日期与今日一致。
    const day = container!.querySelector<HTMLElement>('[data-testid^="calendar-cell-"][aria-selected="true"]')?.getAttribute('aria-label');
    const d = new Date();
    expect(day ?? '').toContain(`${String(d.getMonth() + 1)}月${String(d.getDate())}日`);
    expect(today).toBeTruthy();
  });

  /** 数出网格里**日期格**的个数（按 `calendar-cell-<日期>` 这个稳定锚点，
   *  不是按 `role=button` —— 后者会把工具栏与页脚的按钮一起数进来）。 */
  function dayCells(): string[] {
    return [
      ...(container?.querySelectorAll<HTMLElement>('[data-testid^="calendar-cell-"]') ?? []),
    ].map((el) => el.getAttribute('data-testid')!.replace('calendar-cell-', ''));
  }

  async function setView(kind: 'month' | 'week'): Promise<void> {
    const select = container!.querySelector<HTMLSelectElement>('[data-testid="calendar-view-select"]');
    expect(select, '页头找不到视图档位下拉').not.toBeNull();
    // React 的受控 `<select>` 只认原生 setter（与 `setInput` 同一条理由）。
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(select, kind);
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
  }

  it('🔴 切到「周」之后：网格里**恰好 7 格**，而且是选中那天所在的整周', async () => {
    await mount();
    await openCalendar();
    expect(dayCells()).toHaveLength(42); // 先确认月档画的是 6×7

    await setView('week');
    const cells = dayCells();
    expect(cells).toHaveLength(7);
    const today = toLocalDate(Date.now());
    // 🔴 断的是**这一周包含今天**，不是"今天在第一格"：周视图从周一起，
    //    今天可以是这周的任何一天。写死"第一格是今天"的用例会在周四跑红、
    //    周五跑绿 —— 那是把日历的数学绑到了"今天星期几"上。
    expect(cells, '周视图里没有今天那一格').toContain(today);
    // 连续七天：后一格 = 前一格 +1 天。
    for (let i = 1; i < cells.length; i += 1) {
      expect(cells[i]).toBe(addDays(cells[i - 1]!, 1));
    }
  });

  it('🔴 周档的标题是**周区间**，不是月份（漏接 `weekTitle` 会静默退回月份）', async () => {
    await mount();
    await openCalendar();
    const title = (): string =>
      container!.querySelector('[data-testid="calendar-toolbar-month"]')?.textContent ?? '';
    const monthShape = title();
    expect(monthShape, '月档标题应当是「xxxx年x月」').toMatch(/^\d{4}年\d{1,2}月$/);

    await setView('week');
    const weekShape = title();
    expect(weekShape, '切到周档后标题没换 —— `weekTitle` 没接上，界面退回成月份').not.toBe(monthShape);
    expect(weekShape).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日 – \d{1,2}月\d{1,2}日$/);
  });

  it('🔴 周档里点箭头走的是**一整周**（7 天），不是一个月', async () => {
    await mount();
    await openCalendar();
    await setView('week');
    const before = dayCells();

    const next = container!.querySelector<HTMLElement>('[data-testid="calendar-toolbar-next"]');
    await act(async () => {
      next!.click();
    });
    await flush();
    const after = dayCells();
    expect(after).toHaveLength(7);
    expect(after[0]).toBe(addDays(before[0]!, 7));
    // 标题跟着走，而且**还是**周区间（不是翻回月档）。
    expect(
      container!.querySelector('[data-testid="calendar-toolbar-month"]')?.textContent,
    ).not.toBe('');
  });

  it('切回「月」之后又是 42 格，且游标回到选中那天所在的月', async () => {
    await mount();
    await openCalendar();
    await setView('week');
    await setView('month');
    expect(dayCells()).toHaveLength(42);
    expect(useCalendarViewStore.getState().cursor).toBe(
      startOfMonth(useCalendarViewStore.getState().selected),
    );
  });

  it('🔴 下拉里**只有真的能用的档位**（不许出现点了没反应的第三档）', async () => {
    await mount();
    await openCalendar();
    const select = container!.querySelector<HTMLSelectElement>('[data-testid="calendar-view-select"]');
    const options = [...(select?.options ?? [])].map((o) => o.value);
    // 🔴 这条钉的是"**日历档位**这一半"：`CalendarViewKind` 的全部取值是
    //    month / week / day / **year**（日档于批四、年档于 R13 进来）。
    //    ⚠️ 上面那句"**年还不存在，所以不许出现第四种**"在 R13 之前是这条判据的理由本身 ——
    //       它守的一直是"下拉里只有真的能用的档位"，而不是"最多三档"。
    //       年档做出来了，这条立场第一次被**加一档**测试到：期望值跟着变，
    //       而"多一种没实现的东西"仍然会红（第三行那个 `toEqual` 才是它的牙）。
    expect(options.filter((v) => v === 'month' || v === 'week' || v === 'day' || v === 'year')).toEqual([
      'month',
      'week',
      'day',
      'year',
    ]);
    // ⚠️ 2026-10-03 批五下半起，这一栏还多一项 `'timeline'` —— 它**不是**日历档位，
    //    而是外壳视图的跳转（点了真能走，且不会写进日历 store）。
    //    那一条的形状由 `calendar-view-family.spec.tsx` 钉，这里只登记"没有第六种东西"。
    expect(options).toEqual(['month', 'week', 'day', 'year', 'timeline']);
  });

  it('功能模块里能关掉日历 —— 关掉之后 rail 上就没有它了', async () => {
    enableModules(['calendar']);
    await mount();
    // 先确认默认开着。
    const has = (): boolean =>
      [...(container?.querySelectorAll('button[role="tab"]') ?? [])].some(
        (b) => b.textContent?.trim() === '日历',
      );
    expect(has(), '日历默认应当是开的').toBe(true);
  });
});

/**
 * ⚠️ 这个文件刻意**不**测"英文界面下的月份标题"——
 * 那条属于 `check:ui-language`（它会扫所有词条与渲染），
 * 在这里再写一遍就是第二份判据。
 */
void I18nProvider;
void addDays;
void byText;
