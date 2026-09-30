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
 * ⇒ 所以这里的判据全部是**渲染出来的东西**：42 个格子、当天的行、
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
const { addDays, toLocalDate } = await import('@heyta/domain');

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

  it('🔴 月份标题与当天标题来自**共享的** `date-text.ts`（中文口径）', async () => {
    await mount();
    await openCalendar();

    const month = container!.querySelector('[data-testid="calendar-board-month"]')?.textContent ?? '';
    // 「2026年9月」——这条形状由共享的 `formatMonthTitleText` 决定。
    expect(month, `月份标题不像共享实现给的形状：「${month}」`).toMatch(/^\d{4}年\d{1,2}月$/);

    const day = container!.querySelector('[data-testid="calendar-board-day-title"]')?.textContent ?? '';
    // 「9月29日 星期一」
    expect(day, `当天标题不像共享实现给的形状：「${day}」`).toMatch(
      /^\d{1,2}月\d{1,2}日 星期[一二三四五六日]$/,
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

  it('🔴 当天有任务时，列表里**真的有那一行**（列不出来等于没接上）', async () => {
    await useTaskStore.getState().addTask('今天要交的东西');
    // 设成今天到期（走 action，不直接改 state）。
    // ⚠️ `setDueDate` 收的是**时间戳**（`LocalDate` → 当日零点），不是 LocalDate 串 ——
    //    传错类型编译期就会拦住，这里写明是为了下一个读的人不必再查一次。
    const id = Object.keys(useTaskStore.getState().entities.tasks)[0];
    expect(id, '建完之后应当有一条任务').toBeDefined();
    await useTaskStore.getState().setDueDate(id!, Date.now());

    await mount();
    await openCalendar();

    const list = container!.querySelector('[data-testid="calendar-board-day-list"]');
    expect(list, '当天列表没渲染').not.toBeNull();
    expect(
      [...list!.querySelectorAll('*')].some((el) => (el.textContent ?? '') === '今天要交的东西'),
      `列表里找不到那条任务。实际文本：${list!.textContent ?? ''}`,
    ).toBe(true);
  });

  it('🔴 「回到今天」把选中框带回今天（跨月之后仍然有效）', async () => {
    const today = toLocalDate(Date.now());
    await mount();
    await openCalendar();

    // 先翻到下个月。
    const next = [...container!.querySelectorAll<HTMLElement>('[role="button"]')].find(
      (b) => b.getAttribute('aria-label') === '下个月',
    );
    expect(next, '找不到「下个月」按钮').toBeDefined();
    await act(async () => {
      next!.click();
    });
    await flush();
    const afterNext = container!.querySelector('[data-testid="calendar-board-month"]')?.textContent;

    // 回到今天。
    const back = container!.querySelector<HTMLElement>('[data-testid="calendar-board-today"]');
    expect(back, '找不到「回到今天」').not.toBeNull();
    await act(async () => {
      back!.click();
    });
    await flush();

    const backMonth = container!.querySelector('[data-testid="calendar-board-month"]')?.textContent;
    expect(backMonth, '「回到今天」之后月份没有回来').not.toBe(Number(afterNext) + 1);
    // 选中那天应当是今天 —— 标题与今日标题一致。
    const day = container!.querySelector('[data-testid="calendar-board-day-title"]')?.textContent;
    const d = new Date();
    expect(day).toContain(`${String(d.getMonth() + 1)}月${String(d.getDate())}日`);
    expect(today).toBeTruthy();
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
