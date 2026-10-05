/**
 * W6：倒数日（`EVENT`）是日历的**第二个事件源**
 * ==============================================
 *
 * 这个文件只钉一件事，而它是整单的立论：
 *
 * > 🔴 **一条没有截止日的倒数日也能上日历。**
 *
 * 为什么这一句需要**宿主级**的证据（而不只是 `packages/ui/tests/calendar-cell-bars.spec.ts`
 * 那批模型判据）：模型层能证明"给它一个事件数组它会出条"，但它证明不了
 * **宿主真的把事件数组递过来了**。所以这里挂真 `<App/>`、走真 op-log、
 * 用产品自己的写入口 `useCountdownStore.addEvent(...)` 建那条倒数日，然后断言
 * **一件任务都不存在**（`useTaskStore` 里 0 条）时格子里已经画出了它 ——
 * 于是"画出来"只剩一个可能来源。
 *
 * ## 为什么这里不需要"给它补一个 dueDate"
 *
 * `CountdownEvent` 这个类型**没有** `dueDate` 这个键。任务那条聚合
 * （`model.ts#groupTasksByDueDate`）的第一句就是 `if (task.dueDate === undefined) continue`，
 * 倒数日**接不进**那条 `if` —— 它走的是 `groupEventsForGrid` 那份区间枚举。
 * 所以这条判据不是"配了个开关让它显示"，是"两个源各有其路"。
 * 变异臂正是拿这句话去问代码：把事件源改成"有截止时间才显示"，本文件第一条必须红。
 *
 * ## 顺带钉住的四条宿主契约
 *
 * 1. **`events` 是必填 prop**：`CalendarBoard` 少传它，`pnpm -r typecheck` 当场红
 *    （§7 第 195 条 —— "默认值等于原值的可选 prop"会把"宿主根本没接"伪装成
 *    "这天没有倒数日"，而界面上这两种情况长得一模一样）。
 * 2. **两块面共用一份分桶**：主网格与侧栏那张迷你月历，同一天必须同时有东西。
 * 3. **当天那个数字是 tasks + events**：只数任务的那个数字现在是**错的**，
 *    而它错得难看 —— 格子里明明有一条，标题旁边写着 0。
 * 4. **日档里它落在"全天带"**：倒数日没有"几点"，落进小时轴等于替用户发明一个时刻。
 *
 * ⚠️ 颜色与几何（那颗点是不是主蓝、条有没有被裁一半）**不在这里**：jsdom 里所有
 *   rect 都是 0（§7 元规则 2）。那两条由真浏览器套件与 §6.2 规定一的截图复核负责。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FULL_SCOPE, addDays, toLocalDate, type LocalDate } from '@heyta/domain';
import { formatDayTitleText } from '@heyta/ui';
/**
 * 🔴 期望串一律从**词条表**取，不在这里抄任何一句界面文字
 *   （与 `calendar-day-view.spec.tsx` 同一条纪律：抄进测试的第二份从改名那天起就开始漂）。
 */
import { translate, zhCN, type I18nValue, type Locale } from '@heyta/i18n';

import { enableModules } from './enable-all-modules.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { applyLocale } = await import('../src/lib/locale.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { useCalendarViewStore } = await import('../src/features/calendar/store.js');
const { useCountdownStore } = await import('../src/features/countdown/store.js');

const t: I18nValue['t'] = (key, vars) => translate('zh-CN', key, vars);

let root: Root | undefined;
let container: HTMLDivElement | undefined;
/** 每个用例一个独立库名：共用库会让上一例写的倒数日活在这一例的格子里。 */
let dbName: string;
let today: LocalDate;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function need<T extends HTMLElement = HTMLElement>(testId: string): T {
  const el = container!.querySelector<T>(`[data-testid="${testId}"]`);
  expect(el, `找不到 [data-testid="${testId}"]`).not.toBeNull();
  return el!;
}

/** 轮询"这条倒数日真的落库并进 store 了"（固定两次 tick 在负载下会读到上一轮，§7 第 149 条）。 */
async function waitEvent(title: string): Promise<string> {
  const deadline = Date.now() + 5000;
  for (;;) {
    await flush();
    const found = useCountdownStore.getState().events.find((e) => e.title === title);
    if (found !== undefined) return found.id;
    if (Date.now() > deadline) throw new Error(`等不到倒数日「${title}」落库`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function mount(locale: Locale = 'zh-CN'): Promise<void> {
  // 🔴 语言的**来源**要写清楚：jsdom 的 `navigator.language` 恰好是 `en-US`，
  //   用它来证明"界面是中文"测的是环境不是产品。走产品自己的写入口 `applyLocale`。
  applyLocale(locale);
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
  const label = zhCN['web.shell.modules.calendar.label'];
  const tab = [...(container?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') ?? [])].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(tab, `rail 上找不到「${label}」`).toBeDefined();
  await act(async () => {
    tab!.click();
  });
  await flush();
}

/** 用页头那个档位下拉切档（**不**直接 setState —— 要验的就是入口真的接通）。 */
async function selectView(view: 'day' | 'year'): Promise<void> {
  const select = need<HTMLSelectElement>('calendar-view-select');
  await act(async () => {
    select.value = view;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

/** 走产品入口建一条倒数日并等它进 store。 */
async function addEvent(title: string, date: LocalDate): Promise<string> {
  await act(async () => {
    await useCountdownStore.getState().addEvent(title, date);
  });
  return waitEvent(title);
}

const miniCell = (date: LocalDate): HTMLElement => need(`calendar-mini-day-${date}`);
const miniDotCount = (date: LocalDate): number =>
  miniCell(date).querySelectorAll('.ht-sidebar__day-dots > i').length;

beforeEach(async () => {
  __resetOpLogForTests();
  localStorage.clear();
  // 🔴 关掉的模块根本不进 DOM，"找不到日历"会报成 `expect(null).not.toBeNull()`
  //    （`enable-all-modules.ts` 文件头记的就是这个）。
  enableModules(['calendar']);
  dbName = `calendar-event-source-${Math.random().toString(36).slice(2)}`;
  await initOpLog(dbName);
  today = toLocalDate(Date.now());
  useTaskStore.setState({ now: Date.now() });
  useCalendarViewStore.setState({
    cursor: today,
    selected: today,
    scope: FULL_SCOPE,
    view: 'month',
    captureOpen: false,
  });
  // 🔴 每个用例从"没有任何倒数日"起算：store 是模块级的，上一例写的那条会活在这一例里，
  //   而"格子里只有一条"这种断言就会变成对着两条数据打分。
  useCountdownStore.setState({ events: [], archivedEvents: [] });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
});

describe('🔴 核心判据：没有截止日的倒数日也能上日历', () => {
  it('一条倒数日、零条任务：今天的格子里已经有了它', async () => {
    await mount();
    await openCalendar();
    await addEvent('妈妈生日', today);

    // 排他证据：这个库里**一条任务都没有**。于是"格子里出现了字"不可能是任务那条路。
    expect(Object.keys(useTaskStore.getState().entities.tasks)).toHaveLength(0);
    expect(need(`calendar-cell-${today}-bar-title`).textContent).toBe('妈妈生日');
  });

  it('同一条倒数日在**当天那块**也有自己的一行（不是只出现在格子里）', async () => {
    await mount();
    await openCalendar();
    const id = await addEvent('结婚纪念日', today);

    expect(need(`calendar-board-day-events-${id}-title`).textContent).toBe('结婚纪念日');
    // 只画一遍：同一条不许在当天那块出现两次。
    expect(
      container!.querySelectorAll('[data-testid^="calendar-board-day-events-"]').length,
    ).toBe(2); // 行 + 行里的标题各一个锚点
    expect(
      container!.querySelectorAll('[data-testid="calendar-board-day-events-' + id + '"]'),
    ).toHaveLength(1);
  });

  it('🔴 当天标题旁边那个数字数的是**任务 + 倒数日**（只数任务的那个数字在说谎）', async () => {
    await mount();
    await openCalendar();
    await addEvent('发布倒数', today);
    await act(async () => {
      await useTaskStore.getState().addTask('顺手一条任务', { dueDate: Date.now() });
    });

    const count = need('calendar-board-day-title').parentElement?.lastElementChild;
    expect(count?.textContent, '当天那个数字没把倒数日算进去').toBe('2');
  });

  it('反面（阳性对照）：既没任务也没倒数日的那一格一条都不画', async () => {
    await mount();
    await openCalendar();
    const far = addDays(today, 20);
    expect(container!.querySelector(`[data-testid="calendar-cell-${far}-bar"]`)).toBeNull();
  });
});

describe('两块面共用同一份分桶（各自推一遍区间，迟早有一处漏）', () => {
  it('🔴 主网格画了它的那天，侧栏那张迷你月历**同一天**也要有那颗点', async () => {
    await mount();
    await openCalendar();
    await addEvent('外婆生日', today);

    expect(need(`calendar-cell-${today}-bar-title`).textContent).toBe('外婆生日');
    expect(
      miniDotCount(today),
      '主网格有那条倒数日、侧栏那颗点却没有 —— 两处各自数了一遍',
    ).toBeGreaterThan(0);
  });

  it('侧栏那个读屏名也把它数进去了（有倒数日时不许说"这天没有安排"）', async () => {
    await mount();
    await openCalendar();
    await addEvent('搬家倒数', today);

    expect(miniCell(today).getAttribute('aria-label')).toBe(
      t('web.calendar.a11y.dayWithTasksOne', { date: formatDayTitleText(today, t), count: 1 }),
    );
    // 阳性对照：同一张迷你月历里**没有**东西的那一天还是那句"没有安排"。
    // 少了这一句，上面那条会因为侧栏把每天都写成"有 1 件"而照样绿。
    const empty = [...container!.querySelectorAll<HTMLElement>('[data-testid^="calendar-mini-day-"]')]
      .map((el) => el.dataset.testid!.replace('calendar-mini-day-', ''))
      .find((date) => date !== today);
    expect(empty).toBeDefined();
    expect(miniCell(empty as LocalDate).getAttribute('aria-label')).toBe(
      t('web.calendar.a11y.dayNoTasks', { date: formatDayTitleText(empty as LocalDate, t) }),
    );
  });
});

describe('日档、年档与"每年重复"：倒数日落在它该在的形状里', () => {
  it('🔴 日档里它在**全天带**（倒数日没有"几点"，落进小时轴等于发明一个时刻）', async () => {
    await mount();
    await openCalendar();
    const id = await addEvent('体检倒数', today);
    await selectView('day');

    expect(need(`calendar-board-day-all-day-events-${id}-title`).textContent).toBe('体检倒数');
    // 而且它**只**在全天带：24 行小时轴里不许出现这条标题。
    expect(need('calendar-board-day-axis').textContent ?? '').not.toContain('体检倒数');
  });

  it('🔴 锚在 25 年前、每年重复：今年这一格照样有它（任务那条聚合做不到这件事）', async () => {
    await mount();
    await openCalendar();
    const id = await addEvent('每年生日', today);
    // 走产品自己的写入口把它变成"锚在 2001 年 + 每年"（`yearly` 的 RRULE 由宿主构造，
    // 测试里不手拼规则串 —— 词表是业务语义，展示层给不出也不该给出一条规则串）。
    const anchor = `2001-${today.slice(5)}` as LocalDate;
    await act(async () => {
      await useCountdownStore.getState().patchEvent(id, { date: anchor, yearly: true });
    });
    await flush();

    expect(useCountdownStore.getState().events[0]?.recurrence).toBeDefined();
    expect(need(`calendar-cell-${today}-bar-title`).textContent).toBe('每年生日');
  });

  it('年档那块板也认第二个源：12 张缩略卡里的点不是另一套数', async () => {
    await mount();
    await openCalendar();
    await addEvent('结婚周年', today);
    await selectView('year');

    expect(
      container!.querySelector(`[data-testid="calendar-board-year-day-${today}-dot"]`),
      '年档没把这条倒数日画进点里',
    ).not.toBeNull();
  });
});
