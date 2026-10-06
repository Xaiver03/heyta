/**
 * 日视图（R11 批四）—— Web 上真的把"一天"摊开了吗
 * ==================================================
 *
 * 产品负责人 2026-10-03 给了一张滴答「日」的截图并说：
 * **"看一下日的定义就是这样子的，就是铺满整面的。"**
 * 同一句里还有一条交互：**"点今天，那个今天就自动跳转到今天来了。"**
 *
 * ## 这个文件钉的是哪几件事
 *
 * 1. **形状**：全天带 + `HOURS_IN_DAY` 行小时轴，而月历网格**不在**这一档里；
 * 2. 🔴 **没有"同形状的第二份"**：板子下面那块"当天标题 + 当天清单"必须消失。
 *    留着的话同一屏会出现**两份当天的账**（一份在带里、一份在下面），
 *    而两边可以各自都"看着对"—— 本仓 §3.5 记的那类漂移就是这个形状；
 * 3. **分桶落进 DOM**：零点那条在全天带、9:30 那条在 9 点那一格 ——
 *    数据层的判断在 `packages/ui/tests/calendar-day-buckets.spec.ts`，
 *    这里要的是**它真的被界面用上了**（有实现没消费者 = 仍没覆盖）；
 * 4. **轴空白时那句必须说**（反过来说：两条带都空时**不许**说，那时空态已经说了）；
 * 5. 🔴 **游标与选中同一天**：日档里翻一天，侧栏迷你月历的高亮必须跟着走。
 *    这条是本档最容易静默失效的地方 —— 轴读游标、侧栏读选中，
 *    两份状态各指一天时**没有任何一层会报错**，用户只看到"我翻了天，日历还圈着昨天"。
 *
 * ⚠️ 几何（"铺满整面"）与真拖拽**不在这里测**：jsdom 里所有 rect 都是 0，
 *   在这儿写"高度足够"会得到一条恒真判据（§7 元规则 2）。
 *   那两条在 `e2e/tests/calendar-day.spec.ts`。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { enableModules } from './enable-all-modules.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { useCalendarViewStore } = await import('../src/features/calendar/store.js');
const { startOfMonth, toLocalDate, FULL_SCOPE } = await import('@heyta/domain');
/** 🔴 行数**从共享层取**，不在测试里抄一个 24 —— 抄件一定会漂。 */
const { HOURS_IN_DAY } = await import('@heyta/ui');
const { applyLocale } = await import('../src/lib/locale.js');
/**
 * 🔴 期望串一律从**词条表**取（`en` / `zhCN` 就是 `packages/i18n` 的那两份真身），
 * 不在这个文件里抄任何一句界面文字 —— 抄进测试的第二份，从词条改名那天起就开始漂。
 */
import { en, zhCN, type Locale } from '@heyta/i18n';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let dbName: string;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** 轮询"这条写入真的落库了"—— 固定两次 tick 在负载下会读到上一轮的状态（§7 第 149 条）。 */
async function waitTitle(title: string): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    await flush();
    const found = Object.values(useTaskStore.getState().entities.tasks).some(
      (t) => t.title === title,
    );
    if (found) return;
    if (Date.now() > deadline) throw new Error(`等不到任务「${title}」落库`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function mount(locale?: Locale): Promise<void> {
  // 🔴 语言的**来源**要写清楚：`resolveInitialLocale` 的第 1 层是显式偏好
  // （`locale.ts:72-73` 读 `localStorage['heyta.locale']`），它胜过 `?lang=` 与系统语言。
  // jsdom 的 `navigator.language` 恰好是 `en-US`，所以"界面是英文"这件事**不能**由它来证明 ——
  // 那样测的是环境，不是产品。这里走产品自己的写入口 `applyLocale`（第 1 层的唯一合法作者），
  // 而不是在测试里抄一遍那个 storage key（`STORAGE_KEY` 是模块私有常量，抄第二次就会漂）。
  if (locale !== undefined) applyLocale(locale);
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

async function openCalendar(
  tabLabel: string = zhCN['web.shell.modules.calendar.label'],
): Promise<void> {
  const tab = [...(container?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') ?? [])].find(
    (b) => b.textContent?.trim() === tabLabel,
  );
  expect(tab, `rail 上找不到「${tabLabel}」`).toBeDefined();
  await act(async () => {
    tab!.click();
  });
  await flush();
}

/** 用页头那个档位下拉切到日档（**不**直接 setState —— 要验的就是入口真的接通）。 */
async function selectDayView(): Promise<void> {
  const select = container!.querySelector<HTMLSelectElement>('[data-testid="calendar-view-select"]');
  expect(select, '页头没有档位下拉').not.toBeNull();
  await act(async () => {
    select!.value = 'day';
    select!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

function q<T extends HTMLElement = HTMLElement>(testId: string): T | null {
  return container!.querySelector<T>(`[data-testid="${testId}"]`);
}

/** 一条带截止时间的任务（`dueDate` 直接写进 store，绕开捕获那条解析链）。 */
async function seed(title: string, dueDate: number | undefined): Promise<void> {
  await act(async () => {
    await useTaskStore.getState().addTask(title, { dueDate });
  });
  await waitTitle(title);
}

/** 某个时刻的 epoch ms（本地）。 */
const at = (day: string, hour: number, minute = 0): number => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!, hour, minute, 0, 0).getTime();
};

beforeEach(async () => {
  __resetOpLogForTests();
  localStorage.clear();
  // 🔴 关掉的模块**根本不进 DOM**，"找不到日历"会报成 `expect(null).not.toBeNull()`，
  //    看起来像日历被删了（`enable-all-modules.ts` 文件头记的就是这个）。
  enableModules(['calendar']);
  dbName = `calendar-day-${Math.random().toString(36).slice(2)}`;
  await initOpLog(dbName);
  const today = toLocalDate(Date.now());
  useTaskStore.setState({ now: Date.now() });
  useCalendarViewStore.setState({
    cursor: today,
    selected: today,
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

describe('日视图的形状', () => {
  it('🔴 切到日档：全天带 + 24 行小时轴出现，月历网格消失', async () => {
    await mount();
    await openCalendar();
    await selectDayView();

    expect(q('calendar-board-day'), '没有渲染出日档的板子').not.toBeNull();
    expect(q('calendar-board-day-all-day'), '没有「全天」那条带').not.toBeNull();
    expect(q('calendar-board-day-axis'), '没有小时轴').not.toBeNull();
    expect(q('calendar-board-month-card'), '日档里月历网格还在（这一档是换布局，不是叠加）').toBeNull();

    // 行数从 `HOURS_IN_DAY` 推导。写死 24 的话，改了那一档这里照样绿。
    for (let hour = 0; hour < HOURS_IN_DAY; hour += 1) {
      const pad = String(hour).padStart(2, '0');
      expect(
        q(`calendar-board-day-hour-${pad}`),
        `小时轴缺第 ${pad} 行（轴上的行数是 24 的定义）`,
      ).not.toBeNull();
    }
  });

  it('🔴 这一档**不重画**"当天标题 + 当天清单"（否则同一屏两份当天的账）', async () => {
    await mount();
    await openCalendar();
    await seed('带在选中那天', at(toLocalDate(Date.now()), 0));
    await selectDayView();

    expect(q('calendar-board-day-title'), '月档那块当天标题还在日档里').toBeNull();
    expect(q('calendar-board-day-section'), '月档那块当天清单还在日档里').toBeNull();
    expect(q('calendar-board-day-list'), '月档那份当天清单列表还在日档里').toBeNull();
    // 而它**没有丢**：那条任务在同一天，必须出现在全天带里。
    const band = q('calendar-board-day-all-day-list');
    expect(band, '撤掉当天清单时把任务一起撤掉了').not.toBeNull();
    expect(band!.textContent).toContain('带在选中那天');
  });

  it('🔴 工具栏标题说的是**那一天**，不是本月（切档而标题不换 = 看着像坏了）', async () => {
    await mount();
    await openCalendar();
    await selectDayView();
    const title = q('calendar-toolbar-month')!.textContent ?? '';
    // 日档复用 `dayTitle`：中文口径是「10月3日 星期六」。
    expect(title, `日档的标题不是"某一天"的形状：「${title}」`).toMatch(
      /^\d{1,2}月\d{1,2}日 星期[一二三四五六日]$/,
    );
  });
});

describe('分桶真的落进界面', () => {
  it('零点那条在**全天带**，不挂在 00:00 那一格', async () => {
    const today = toLocalDate(Date.now());
    await mount();
    await openCalendar();
    await seed('只排了日期', at(today, 0));
    await selectDayView();

    expect(q('calendar-board-day-all-day-list')!.textContent).toContain('只排了日期');
    const zero = q('calendar-board-day-hour-00')!;
    expect(zero.textContent, '没有时刻的任务被挂到了 00:00 那一格').not.toContain('只排了日期');
  });

  it('带时刻那条挂在**它自己的那一小时**，而**不在**全天带', async () => {
    const today = toLocalDate(Date.now());
    await mount();
    await openCalendar();
    await seed('九点半的会', at(today, 9, 30));
    await selectDayView();

    expect(q('calendar-board-day-hour-09')!.textContent).toContain('九点半的会');
    // 🔴 断的是**那条带**（容器），不是带里那个列表 —— 全天带空的时候渲染的是
    //   共享 `EmptyState`（`-all-day-list` 根本不存在），那时对 null 取 textContent
    //   只会得到一个 `TypeError`，长得像"界面坏了"而不是"这条断言写错了"。
    expect(
      q('calendar-board-day-all-day')!.textContent,
      '有时刻的任务被塞进了全天带',
    ).not.toContain('九点半的会');
    expect(q('calendar-board-day-all-day-empty'), '全天带空了却没走共享空态').not.toBeNull();
  });

  it('🔴 只有那条带空、轴上有东西 ⇒ 空态**不许**说"这一天没有到期的任务"', async () => {
    /*
     * R14 之前这一屏几乎量不到（手工输入进不去时刻，带时刻的任务基本不存在），
     * 所以这句"这天没到期任务"一直是对的。现在一条定在 16:00 的任务就在
     * 它下面 20 行，同屏两句互相打脸 —— 这一条钉的就是那句改口。
     */
    const today = toLocalDate(Date.now());
    await mount();
    await openCalendar();
    await seed('十六点的活', at(today, 16));
    await selectDayView();

    const empty = q('calendar-board-day-all-day-empty');
    expect(empty, '全天带空了却没走共享空态').not.toBeNull();
    expect(
      empty!.textContent,
      '那条带空 ≠ 这一天空：说"这一天没有到期的任务"就是谎话',
    ).not.toContain('这一天没有到期的任务');
    expect(empty!.textContent).toContain('下面那条轴');
  });
});

describe('轴空白时的那句话', () => {
  it('🔴 带有东西而轴整列空 ⇒ 必须说出"这些都在全天里"（不说就等于"这档没接上"）', async () => {
    const today = toLocalDate(Date.now());
    await mount();
    await openCalendar();
    await seed('只排了日期', at(today, 0));
    await selectDayView();

    const note = q('calendar-board-day-no-timed');
    expect(note, '轴整列空白却没有那一句说明').not.toBeNull();
    /*
     * 🔴 原来这里只写 `toContain('全天')` —— 那是一条**弱断言**：把这句换成空态那句
     *   （`web.calendar.dayEmpty` =「这一天没有到期的任务。」）它照样绿，而那正是
     *   R16 要防的"每块区域只说自己那一份"被破掉的样子。现在**逐字等于表里那条**，
     *   并配一条"两个候选键的值互不相等"的对照 —— 没有对照，逐字相等可能只是
     *   两条句子本来一样（§7 元规则 2）。
     */
    expect(note!.textContent).toBe(zhCN['common.calendar.dayNoTimed']);
    expect(
      zhCN['common.calendar.dayNoTimed'],
      '对照失效：这两条句子若相等，上面那条逐字断言就分不清键了',
    ).not.toBe(zhCN['web.calendar.dayEmpty']);
  });

  /**
   * R16 · 英文会话的日档（jsdom 这一层）。
   *
   * 这一条**不**替掉 `e2e/tests/calendar-day-en.spec.ts`：那条量的是几何（会不会溢出、
   * 被裁、画成省略号），jsdom 里所有 rect 都是 0，写"高度够"就是恒真判据（§7 元规则 2）。
   * 这条钉的是**内容**：切到英文之后，那三句真的来自 en 那本表，而不是
   * "值没换过去"（`check:ui-language` 只保证中英**键集**对等，管不到值）。
   * 内容这一半常驻在 `pnpm -r test` 里 —— 浏览器那条跑不跑得起来，都不影响它守得住。
   */
  it('🔴 英文会话（第 1 层偏好）⇒ 日档那三句逐字来自 en 表，且这一屏零中文残留', async () => {
    const today = toLocalDate(Date.now());
    await mount('en');
    await openCalendar(en['web.shell.modules.calendar.label']);
    await seed(`en-${Math.random().toString(36).slice(2, 8)}`, at(today, 0));
    await selectDayView();

    // ① 壳真的按解析结果写了 `<html lang>`（`locale.ts:92`）—— 不是"看起来是英文"
    expect(document.documentElement.lang).toBe('en');

    const board = q('calendar-board-day');
    expect(board, '英文会话下日档没画出来').not.toBeNull();
    // ② 全天带那句
    expect(q('calendar-board-day-all-day-label')!.textContent).toBe(
      en['common.calendar.dayAllDay'],
    );
    // ③ 🔴 那条最长的说明：**整句**等于 en 表里那条（不是包含、不是开头）
    const sentence = en['common.calendar.dayNoTimed'];
    const note = q('calendar-board-day-no-timed');
    expect(note, '英文会话下轴空白时那句说明没出现').not.toBeNull();
    expect(note!.textContent).toBe(sentence);

    // ④ 三条对照：任何一条相等，上面的"逐字等于 en"就退化成"随便说点什么"
    expect(sentence).not.toBe(zhCN['common.calendar.dayNoTimed']);
    expect(sentence).not.toBe(en['web.calendar.dayEmpty']);
    expect(en['common.calendar.dayAllDay']).not.toBe(zhCN['common.calendar.dayAllDay']);

    /*
     * ⑤ 这一屏**不许有中文残留**。两种形状分开写（22:1x 现量把它们的归属分清了）：
     *   a) 词条的 en 值被填成中文 ⇒ `check:ui-language` **自己会红**（V4 实测 rc=1），
     *      这条腿只是第二层；
     *   b) 组件里复用/写死中文字面量 ⇒ 门禁**看不见**（V5 实测：把
     *      `useCalendarLabels.ts:72` 换成逐字相同的 zh 句子 ⇒ `check:ui-language` rc=0），
     *      🔴 这一类只有这里守。台账 E2/E3 两支臂打的就是 b。
     *   种子标题刻意是 ASCII（`en-` + 随机），否则这条会被我自己的种子打到 ——
     *   那不是产品结论。捕获语法目前只有中文那一套（§6 第 6 行），所以这里
     *   **绕开捕获**，直接 `seed()` 写 store。
     */
    const cjk: string[] = [];
    const walker = document.createTreeWalker(board!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const text = (n.nodeValue ?? '').trim();
      if (/[㐀-䶿一-鿿　-〿＀-￯]/u.test(text)) cjk.push(text.slice(0, 40));
    }
    expect(cjk, `英文日档里残留了中文：${cjk.join(' | ')}`).toEqual([]);
  });

  it('🔴 两条带都空 ⇒ **不许**说那句（那时空态已经说了"这天没到期任务"，说两遍就是两份口径）', async () => {
    await mount();
    await openCalendar();
    await selectDayView();

    expect(q('calendar-board-day-all-day-empty'), '空态没走共享实现').not.toBeNull();
    // 分裂的另一半：整天都空时**该说**那句（上面那条钉的是"不该说"）。
    expect(q('calendar-board-day-all-day-empty')!.textContent).toContain('这一天没有到期的任务');
    expect(q('calendar-board-day-no-timed', )?.textContent ?? '', '空一天时那句"都在全天里"是谎话').toBe('');
  });
});

describe('🔴 游标与选中：日档里必须同一天', () => {
  it('翻一天 ⇒ 轴、页头标题、侧栏迷你月历的高亮**指同一日**', async () => {
    const today = toLocalDate(Date.now());
    await mount();
    await openCalendar();
    await selectDayView();

    // 用**页头的 `>`**翻到明天：那是这一档的主入口，走的是 `setCursor`。
    const next = q('calendar-toolbar-next')!;
    await act(async () => {
      next.click();
    });
    await flush();

    const state = useCalendarViewStore.getState();
    const tomorrowTitle = q('calendar-toolbar-month')!.textContent ?? '';
    expect(state.cursor, '游标没走').not.toBe(today);
    expect(state.selected, '日档里翻了游标，选中的那天没跟上 ⇒ 侧栏与轴各指一天').toBe(state.cursor);
    expect(tomorrowTitle, `标题没说选中那天：「${tomorrowTitle}」`).toContain(
      `${String(Number(state.selected.slice(5, 7)))}月`,
    );
    // 侧栏迷你月历里"当前看的是哪天"那一格，必须是同一天。
    // ⚠️ 它用的是 `aria-current="date"` 而不是 `aria-pressed`（`CalendarSidebar:120-122`
    //    记的理由：`pressed` 会把一组日期念成可切换按钮）。
    const selectedCell = container!.querySelector('[aria-current="date"]');
    expect(
      selectedCell?.getAttribute('data-testid'),
      `侧栏没有"当前那天"那一格，或它圈的日期与轴不同：${String(selectedCell?.getAttribute('data-testid'))}`,
    ).toBe(`calendar-mini-day-${state.selected}`);
  });

  it('「今天」在日档把这天带回今天（她的原话："点今天，那个今天就自动跳转到今天来了"）', async () => {
    await mount();
    await openCalendar();
    await selectDayView();
    const today = toLocalDate(useTaskStore.getState().now);

    // 先翻走两步，再点「今天」。
    const next = q('calendar-toolbar-next')!;
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        next.click();
      });
      await flush();
    }
    expect(useCalendarViewStore.getState().cursor).not.toBe(today);

    const todayButton = q('calendar-toolbar-today')!;
    await act(async () => {
      todayButton.click();
    });
    await flush();

    const state = useCalendarViewStore.getState();
    expect(state.cursor, '点了「今天」而轴没回到今天').toBe(today);
    expect(state.selected).toBe(today);
    // 轴里现在看的那一天就是今天 ⇒ 现在线该出现（宿主给的是任务 store 的 `now`）。
    expect(q('calendar-board-day-now-line'), '回到今天之后"现在"线没画出来').not.toBeNull();
  });
});

describe('现在线', () => {
  it('🔴 只有"看的就是今天"才画，且位置落在**当前那一小时那一截**', async () => {
    const today = toLocalDate(Date.now());
    await mount();
    await openCalendar();
    await selectDayView();

    const line = q('calendar-board-day-now-line');
    expect(line, '看今天时没有现在线').not.toBeNull();
    // 位置由 `HOURS_IN_DAY` 那一行的行高推导（56 = `size.row-min-height`）。
    // 断言的是"落在当前小时这一格内"，不是某个像素值 —— 抄像素值的话改了行高照样绿。
    const top = Number.parseFloat(line!.style.top);
    const now = new Date(useTaskStore.getState().now);
    expect(Number.isFinite(top), `现在线的 top 读不到：${line!.style.top}`).toBe(true);
    const rowHeight = top / (now.getHours() + now.getMinutes() / 60);
    expect(top).toBeGreaterThanOrEqual(rowHeight * now.getHours());
    expect(top).toBeLessThan(rowHeight * (now.getHours() + 1));
  });

  it('翻到别的日子 ⇒ 现在线**消失**（它是"现在"，不是"那一天"）', async () => {
    await mount();
    await openCalendar();
    await selectDayView();
    const next = q('calendar-toolbar-next')!;
    await act(async () => {
      next.click();
    });
    await flush();
    expect(q('calendar-board-day-now-line'), '现在线跟着游标一起翻到别的日子去了').toBeNull();
  });
});
