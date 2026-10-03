/**
 * 日历侧栏（Web）—— 迷你月历 + 显示范围
 * ======================================
 *
 * 产品负责人 2026-09-30 给的参考图：日历页的**第二列**是「迷你月历 + 「所有」
 * + 清单/标签复选框」。这一列不是装饰 —— 它是"日历上看得见谁"的唯一开关。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 判据全部是**渲染出来的东西**
 *
 * 和 `calendar-view.spec.tsx` 同一条理由：字符串命中不算。所以这里断言的是
 * 格子清单（与 `monthGrid` 逐格对齐）、每格 `<i>` 的颗数与颜色、复选框的
 * `checked` / `indeterminate`、以及**主区当日列表里那几行在不在**。
 *
 * ## 🔴 这一组用例守的是三种"静默失效"
 *
 * 1. **两列各存一份月/日** —— 侧栏翻到 8 月、主区还停在 9 月。
 *    单看任何一列都"像个正常日历"，没有任何一层会报错。
 * 2. **列头写成周日开头**（照抄参考图）—— 整个日历**错位一格**，
 *    而错位后看上去仍然对。所以列头顺序是**手写的**，不从
 *    `WEEKDAY_MESSAGE_KEYS` 推：从它推就是同义反复，抓不住它自己被人重排。
 * 3. **勾选只筛主区、不筛格子**（或反过来）—— 侧栏说这天有点、点进去空的。
 *    这条只有"同一格在勾选前后点数变了"能抓住。
 *
 * ## ⚠️ 日期为什么钉死
 *
 * `today` 来自 `useTaskStore().now`（可注入），夹具全落在 2026-09。
 * 2026-09-28 是**周一**（`isoWeekday` = 1），迷你月历的网格因此从
 * 补白格 **2026-08-31** 开始 —— 那一格正好用来验"点了补白格，月份必须跟过去"。
 * 用真实"今天"写用例的话，跨过某些日期后夹具会自己漂走，而症状看起来像功能坏了。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, currentState, initOpLog } = await import('../src/lib/oplog.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { useProjectStore } = await import('../src/features/projects/store.js');
const { useCalendarViewStore } = await import('../src/features/calendar/store.js');
const { FULL_SCOPE, monthGrid } = await import('@heyta/domain');

/** 2026 年 9 月的某天中午（避开时区边界：中午怎么换算都还是这一天）。 */
const SEPT = (day: number): number => new Date(2026, 8, day, 12, 0, 0).getTime();
const TODAY = '2026-09-28';
/** 钉死"今天"之后的网格起点（补白格，2026-08-31 = 周一）。 */
const OUTSIDE_PREV = '2026-08-31';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let dbName: string;
/** 每个用例一份独立库（同 `calendar-view.spec.tsx`：共用库会让上一轮的任务漏进这一轮）。 */
async function resetStores(): Promise<void> {
  __resetOpLogForTests();
  localStorage.clear();
  dbName = `calendar-sidebar-${Math.random().toString(36).slice(2)}`;
  await initOpLog(dbName);
  // 🔴 三个 store 都是**模块级单例**，不随库重置。上一轮勾的清单、翻到的月份
  //     会漏进这一轮 —— 症状是"这一轮的断言看着像范围筛错了"。
  useTaskStore.setState({ entities: currentState(), now: SEPT(28) });
  useProjectStore.setState({ projects: [], tags: [] });
  useCalendarViewStore.setState({ cursor: '2026-09-01', selected: TODAY, scope: FULL_SCOPE });
}

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

/**
 * rail 上的标签**是翻译过的**，所以入口按语言给名字。
 * （英文用例里还找「日历」会红，而红的原因不是缺陷。）
 */
async function openCalendar(tabLabel = '日历'): Promise<void> {
  const tab = [...(container?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') ?? [])].find(
    (b) => b.textContent?.trim() === tabLabel,
  );
  expect(tab, `rail 上找不到「${tabLabel}」`).toBeDefined();
  await act(async () => {
    tab!.click();
  });
  await flush();
}

async function click(testId: string): Promise<void> {
  const el = byTestId(testId);
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

function byTestId(testId: string): Element | null {
  return container!.querySelector(`[data-testid="${testId}"]`);
}

function need(testId: string): HTMLElement {
  const el = byTestId(testId);
  expect(el, `找不到 ${testId}`).not.toBeNull();
  return el as HTMLElement;
}

/** 迷你月历里某一天的格子。 */
function miniCell(date: string): HTMLElement {
  return need(`calendar-mini-day-${date}`);
}

/** 那一格画了几颗点。 */
function dots(date: string): number {
  return miniCell(date).querySelectorAll('.ht-sidebar__day-dots > i').length;
}

/** 那一格那颗点的颜色（读回 `cssVar()` 给的 `var(--ht-…)`，不猜十六进制）。 */
function dotColor(date: string): string {
  const dot = miniCell(date).querySelector<HTMLElement>('.ht-sidebar__day-dots > i');
  return dot?.style.background ?? '';
}

function miniDays(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('[data-testid^="calendar-mini-day-"]')];
}

/** 主区当日列表里有没有那一行（与 `calendar-view.spec.tsx` 同一条判据形状）。 */
function hasRow(title: string): boolean {
  const list = byTestId('calendar-board-day-list');
  if (list === null) return false;
  return [...list.querySelectorAll('*')].some((el) => (el.textContent ?? '') === title);
}

function checkbox(testId: string): HTMLInputElement {
  return need(testId) as HTMLInputElement;
}

async function toggle(testId: string): Promise<void> {
  const el = checkbox(testId);
  await act(async () => {
    el.click();
  });
  await flush();
}

/** 按名字取清单 / 标签 id（id 是 `project-${randomId()}`，测试里不猜它）。 */
function projectId(name: string): string {
  const found = useProjectStore.getState().projects.find((p) => p.name === name);
  expect(found, `清单「${name}」没建出来`).toBeDefined();
  return found!.id;
}

function tagId(name: string): string {
  const found = useProjectStore.getState().tags.find((t) => t.name === name);
  expect(found, `标签「${name}」没建出来`).toBeDefined();
  return found!.id;
}

async function taskId(title: string): Promise<string> {
  const found = Object.values(useTaskStore.getState().entities.tasks).find(
    (t) => t.title === title,
  );
  expect(found, `任务「${title}」没建出来`).toBeDefined();
  return found!.id;
}

/**
 * 夹具：三条同一天（分别属于两个清单 + 一个标签），另加逾期 / 已完成 / 别天各一条。
 *
 * | 任务 | 到期 | 归属 | 侧栏格子里应当是 |
 * |---|---|---|---|
 * | 周报 | 09-28（今天） | 清单 工作 | 主色点（与买菜、修电脑挤成**一颗**） |
 * | 买菜 | 09-28 | 清单 生活 | 同上 |
 * | 修电脑 | 09-28 | 标签 紧急（无清单） | 同上 |
 * | 月结 | 09-05（周六） | 清单 生活 | 主色点 |
 * | 逾期的事 | 09-20（已过） | 清单 工作 | danger 点 |
 * | 已完成的事 | 09-10 | 清单 工作，勾完 | subtle 点（**不是没有点**） |
 */
async function seedFull(): Promise<void> {
  await act(async () => {
    await useProjectStore.getState().addProject('工作');
    await useProjectStore.getState().addProject('生活');
    await useProjectStore.getState().addProject('汇报', projectId('工作'));
    await useProjectStore.getState().addTag('紧急');
  });
  await act(async () => {
    await useTaskStore.getState().addTask('周报', { dueDate: SEPT(28), projectId: projectId('工作') });
    await useTaskStore.getState().addTask('买菜', { dueDate: SEPT(28), projectId: projectId('生活') });
    await useTaskStore.getState().addTask('修电脑', { dueDate: SEPT(28) });
    await useTaskStore.getState().addTask('月结', { dueDate: SEPT(5), projectId: projectId('生活') });
    await useTaskStore.getState().addTask('逾期的事', { dueDate: SEPT(20), projectId: projectId('工作') });
    await useTaskStore.getState().addTask('已完成的事', { dueDate: SEPT(10), projectId: projectId('工作') });
  });
  await useTaskStore.getState().setTags(await taskId('修电脑'), [tagId('紧急')]);
  await useTaskStore.getState().toggleComplete(await taskId('已完成的事'));
  await flush();
}

beforeEach(async () => {
  await resetStores();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('日历侧栏（Web）', () => {
  it('🔴 迷你月历的格子与 `monthGrid` **逐格对齐**，列头是**周一开头**', async () => {
    await seedFull();
    await mount();
    await openCalendar();

    expect(byTestId('calendar-mini-title'), '没有迷你月历').not.toBeNull();
    expect(need('calendar-mini-title').textContent).toBe('2026年9月');

    // 判据来自被约束的那个常量本身，不是这里手写一个 35。
    const expected = monthGrid('2026-09-01').flatMap((week) => week.map((cell) => cell.date));
    const rendered = miniDays().map((el) =>
      (el.getAttribute('data-testid') ?? '').replace('calendar-mini-day-', ''),
    );
    expect(rendered.length, '一个格子都没有').toBeGreaterThan(0);
    expect(rendered, '侧栏的格子与领域层 monthGrid 不一致（补白格归哪月、几行都在这）').toEqual(
      expected,
    );
    // 补白格必须在（它是下一个用例的入口）。
    expect(rendered).toContain(OUTSIDE_PREV);

    const headers = [...container!.querySelectorAll('.ht-sidebar__month-weekdays > span')].map(
      (el) => el.textContent,
    );
    // ⚠️ **故意写死**这个顺序，不从 `WEEKDAY_MESSAGE_KEYS` 推：从它推就是同义反复，
    //    抓不住"照抄参考图改成周日开头"这一格错位 —— 而那正是这条用例存在的理由。
    expect(headers, '列头不是周一开头（整个日历会静默错位一格）').toEqual([
      '一',
      '二',
      '三',
      '四',
      '五',
      '六',
      '日',
    ]);
  });

  it('🔴 今天所在那一列的列头上主色（2026-09-28 是周一 ⇒ 第一列）', async () => {
    await seedFull();
    await mount();
    await openCalendar();

    const headers = [...container!.querySelectorAll<HTMLElement>('.ht-sidebar__month-weekdays > span')];
    const colored = headers.map((el) => el.style.color);
    expect(colored[0], '今天那一列的列头没有主色').toBe('var(--ht-color-primary)');
    expect(colored.filter((c) => c === 'var(--ht-color-primary)').length, '主色列头不止一个').toBe(1);
  });

  it('🔴 侧栏与主区**共用同一份**月与日（翻月 / 点补白格 / 回到今天）', async () => {
    await seedFull();
    await mount();
    await openCalendar();

    // 侧栏点一天 → 主区当天标题跟着变。
    await click(`calendar-mini-day-${'2026-09-05'}`);
    expect(need('calendar-board-day-title').textContent).toContain('9月5日');

    // 侧栏翻月 → 两列的月份标题**同时**变（各存一份的话这里必红）。
    await click('calendar-mini-prev');
    expect(need('calendar-mini-title').textContent).toBe('2026年8月');
    expect(need('calendar-toolbar-month').textContent).toBe('2026年8月');

    // 点补白格（8月31日，出现在 9 月的网格里）：选中跟过去，**月份也必须跟过去**。
    await click('calendar-mini-next');
    await click(`calendar-mini-day-${OUTSIDE_PREV}`);
    expect(need('calendar-board-day-title').textContent).toContain('8月31日');
    expect(
      need('calendar-toolbar-month').textContent,
      '点了补白格只改选中日、没改月份 —— 主区列着 9 月、侧栏圈着 8 月',
    ).toBe('2026年8月');

    // ○ 回到今天：两列一起回。
    await click('calendar-mini-today');
    expect(need('calendar-mini-title').textContent).toBe('2026年9月');
    expect(need('calendar-toolbar-month').textContent).toBe('2026年9月');
    expect(need('calendar-board-day-title').textContent).toContain('9月28日');
    expect(miniCell(TODAY).getAttribute('aria-current')).toBe('date');
  });

  it('🔴 一天**一颗**点，颜色来自共享 `calendarDayTone`，没安排的日子没有点', async () => {
    await seedFull();
    await mount();
    await openCalendar();

    // 今天挤了 3 条任务，仍然只有一颗 —— 侧栏能拖到 12rem，
    // 那时一格只有二十来像素，主区那 1–3 颗会糊成一条线（"3 件"和"1 件"看起来一样）。
    expect(dots(TODAY), '今天有 3 条任务却画了多颗点').toBe(1);
    expect(dotColor(TODAY)).toBe('var(--ht-color-primary)');
    expect(dots('2026-09-05')).toBe(1);
    expect(dots('2026-09-20'), '逾期应当是 danger 色').toBe(1);
    expect(dotColor('2026-09-20')).toBe('var(--ht-color-danger)');
    // 全部做完的那天给 subtle，而不是"没有点"：这天清空了 ≠ 这天本来没安排。
    expect(dots('2026-09-10')).toBe(1);
    expect(dotColor('2026-09-10')).toBe('var(--ht-color-foreground-subtle)');
    expect(dots('2026-09-15'), '没安排的日子不该有点').toBe(0);

    // 总数：颗数 = **有任务的天数**（4 天：05 / 10 / 20 / 28），不是任务条数。
    const withDots = miniDays().filter((el) => el.querySelectorAll('.ht-sidebar__day-dots > i').length > 0);
    expect(withDots.length).toBe(4);
    expect(
      miniDays().every((el) => el.querySelectorAll('.ht-sidebar__day-dots > i').length <= 1),
      '有格子画了不止一颗点',
    ).toBe(true);
  });

  it('🔴 勾选范围**同时**筛掉主区列表与格子里的点', async () => {
    await seedFull();
    await mount();
    await openCalendar();

    expect([hasRow('周报'), hasRow('买菜'), hasRow('修电脑')]).toEqual([true, true, true]);

    const live = projectId('生活');
    const work = projectId('工作');
    const urgent = tagId('紧急');

    // 只勾「生活」：主区只剩买菜。
    await toggle(`calendar-scope-${live}`);
    expect([hasRow('周报'), hasRow('买菜'), hasRow('修电脑')], '勾了生活，主区没跟着筛').toEqual([
      false,
      true,
      false,
    ]);

    // 再去掉「生活」、只勾「工作」：只剩周报（子清单 汇报 不算，见下一条）。
    await toggle(`calendar-scope-${live}`);
    await toggle(`calendar-scope-${work}`);
    expect([hasRow('周报'), hasRow('买菜'), hasRow('修电脑')]).toEqual([true, false, false]);
    // 点也跟着筛：买菜所属的那天（09-05 是生活、09-28 仍在因为周报在）。
    expect(dots('2026-09-05'), '勾了工作之后，属于「生活」的那天该没点了').toBe(0);
    expect(dots(TODAY)).toBe(1);

    // 🔴 **并集不是交集**：勾上「工作」+「紧急」时，
    //     周报（只属于工作）与修电脑（只打了标签）都得在。
    //     写成交集的话这一天会整个空掉，而界面看起来"筛得好好的"。
    await toggle(`calendar-scope-${urgent}`);
    expect([hasRow('周报'), hasRow('修电脑')], '清单与标签应当取并集').toEqual([true, true]);
    expect(hasRow('买菜'), '没勾的清单不该出现在日历上').toBe(false);
  });

  it('子清单只算自己：勾「汇报」看不到父清单「工作」的任务', async () => {
    await seedFull();
    await mount();
    await openCalendar();

    const report = projectId('汇报');
    await toggle(`calendar-scope-${report}`);
    expect(hasRow('周报'), '父清单的任务被算进了子清单').toBe(false);
    expect(hasRow('买菜')).toBe(false);
    expect(dots(TODAY), '这一天空了，格子里不该还有点').toBe(0);
    // 缩进行确实分了层（与任务侧栏同一条"只有一层嵌套"的语义）。
    expect(need(`calendar-scope-${report}`).closest('label')?.className).toContain(
      'ht-sidebar__scope-row--child',
    );
  });

  it('总勾：半选 → 整组全选 → 再点清空', async () => {
    await seedFull();
    await mount();
    await openCalendar();

    const master = 'calendar-scope-group-清单';
    const work = projectId('工作');

    await toggle(`calendar-scope-${work}`);
    expect(checkbox(master).checked, '只勾了 3 条里的 1 条，总勾不该是全选').toBe(false);
    // 🔴 半选态：没有 HTML 属性，只能靠 `ref` 赋 DOM 属性。没赋上的话
    //     "勾了 1 个"和"一个没勾"长得一模一样，用户不知道自己筛过。
    expect(checkbox(master).indeterminate, '部分勾选时总勾没有半选态').toBe(true);

    await toggle(master);
    expect(checkbox(master).indeterminate).toBe(false);
    expect(checkbox(master).checked, '点总勾应当整组全选').toBe(true);
    for (const name of ['工作', '生活', '汇报']) {
      expect(checkbox(`calendar-scope-${projectId(name)}`).checked).toBe(true);
    }
    // 全选 = 组里全在里面 ⇒ 标签那条（无清单）不在，主区只剩两条。
    expect([hasRow('周报'), hasRow('买菜'), hasRow('修电脑')]).toEqual([true, true, false]);

    await toggle(master);
    expect(checkbox(master).checked, '再点一次应当清空整组').toBe(false);
    expect(checkbox('calendar-scope-all').getAttribute('aria-pressed')).toBe('true');
    expect(hasRow('修电脑'), '清空勾选 = 显示全部').toBe(true);
  });

  it('「所有」清掉全部勾选，并把对勾留在自己身上', async () => {
    await seedFull();
    await mount();
    await openCalendar();

    const all = 'calendar-scope-all';
    expect(checkbox(all).getAttribute('aria-pressed'), '默认范围就是「所有」').toBe('true');
    expect(need(all).querySelector('svg'), '「所有」生效时应有对勾').not.toBeNull();

    await toggle(`calendar-scope-${projectId('生活')}`);
    expect(checkbox(all).getAttribute('aria-pressed')).toBe('false');
    expect(need(all).querySelector('svg'), '范围不是「所有」时对勾不该出现').toBeNull();

    await click(all);
    expect(checkbox(all).getAttribute('aria-pressed')).toBe('true');
    expect(checkbox(`calendar-scope-${projectId('生活')}`).checked).toBe(false);
    expect(hasRow('周报')).toBe(true);
  });

  it('空组不进 DOM：没有标签时，「标签」那一组根本不出现', async () => {
    await act(async () => {
      await useProjectStore.getState().addProject('工作');
    });
    await act(async () => {
      await useTaskStore.getState().addTask('周报', {
        dueDate: SEPT(28),
        projectId: useProjectStore.getState().projects[0]!.id,
      });
    });
    await mount();
    await openCalendar();

    expect(byTestId('calendar-scope-group-清单'), '有清单就该有那一组').not.toBeNull();
    expect(
      byTestId('calendar-scope-group-标签'),
      '一个标签都没有还挂个空标题 + 总勾，等于多一个能点坏的控制',
    ).toBeNull();
  });

  it('🔴 英文界面：一条任务说 "1 task"，三条说 "3 tasks"', async () => {
    localStorage.setItem('heyta.locale', 'en');
    await seedFull();
    await mount();
    await openCalendar('Calendar');

    const single = miniCell('2026-09-05').getAttribute('aria-label') ?? '';
    const many = miniCell(TODAY).getAttribute('aria-label') ?? '';
    // 词条表刻意没有 ICU，单复数只能靠调用方分支。
    // `toContain('1 task')` 挡不住这条（"1 tasks" 里就有 "1 task"），
    // 承重的是这个负向断言。
    expect(single, `一条任务说成了复数：「${single}」`).toMatch(/1 task(?!s)/);
    expect(many, `三条任务没走复数词条：「${many}」`).toContain('3 tasks');
  });

  it('日历那一列也带宽度把手（与任务页同一份宽度状态）', async () => {
    await seedFull();
    await mount();
    await openCalendar();

    const side = need('calendar-mini-title').closest('nav');
    expect(side, '迷你月历不在侧栏那一列里').not.toBeNull();
    // 手柄本身（`SidebarResizer`）的行为由任务页那组用例覆盖；
    // 这里只钉"日历这一列**也**带一个" —— 参考图里这一列是可调的。
    expect(side!.querySelector('[role="separator"]'), '日历那一列没有宽度把手').not.toBeNull();
  });

  it('范围不落盘：刷新回到今天与全部', async () => {
    await seedFull();
    await mount();
    await openCalendar();
    await toggle(`calendar-scope-${projectId('工作')}`);
    await click('calendar-mini-prev');

    // 换一个库重新 init（= 用户重开应用）：界面状态不是偏好，不该被带回来。
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    container = undefined;
    root = undefined;
    await resetStores();
    await mount();
    await openCalendar();

    expect(need('calendar-mini-title').textContent).toBe('2026年9月');
    expect(checkbox('calendar-scope-all').getAttribute('aria-pressed')).toBe('true');
  });

  it('没有 dueDate 的任务不参与侧栏（页脚那句话仍然要说出来）', async () => {
    await act(async () => {
      await useTaskStore.getState().addTask('没设时间的事');
    });
    await mount();
    await openCalendar();

    expect(need('calendar-board-footnote').textContent).toContain('未设截止时间');
    expect(dots(TODAY)).toBe(0);
    expect(hasRow('没设时间的事')).toBe(false);
    expect(miniDays().every((el) => el.querySelectorAll('.ht-sidebar__day-dots > i').length === 0)).toBe(
      true,
    );
  });
});
