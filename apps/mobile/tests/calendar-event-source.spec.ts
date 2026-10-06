/**
 * 倒数日**真的进得了**移动端的日历吗（批次二 W6 的移动端那一半）
 * =================================================================
 *
 * 🔴 **这个文件存在的理由**（不是"共享组件支持了 prop，所以 W6 做完了"）：
 * `packages/ui` 的共享 `CalendarBoard` 在 2026-10-04 拿到两个**可选** prop
 * （`events` / `eventLabels`，默认值都等于"一条都不画"）。这条缝是对的，
 * 但它也意味着**宿主不接，什么都不会坏**：类型检查绿、构建绿、共享层自己的
 * 判据绿，而手机上的日历**安静地一个倒数日都没有**。
 * 本仓把这件事记过五次了（AGENTS §3.5 末尾两段、§7 里"零件都在、线没接"那族、
 * roadmap §5.1 的断点 2/3）。所以这里测的**不是**共享投影算得对不对
 * （那在 `packages/ui/tests/` 与 `packages/domain/tests/`），而是：
 *
 *   1. **存在性**：把一个任务都没有、只有一个倒数日的那天摊到**这一屏真的画出的
 *      42 格**上，那一行出现了（判据是"那一行在不在"，不是"字怎么写"——
 *      存在性先于取值；`e2e` 那边 W5 看图照出"少了一整行日期"同一条教训）。
 *      其中一格刻意取**补白格**（不属于显示月、但照样渲染照样可点）——
 *      宿主要是按可见月先筛一遍，只有这一格会红。
 *   2. **宿主真的把 `events` 交了出去**（把屏里那个 prop 删掉，本文件必须红）。
 *   3. **归档的那条不许出现在日历上**（反向对照，两层：动作层的列表 + 共享投影
 *      各挡一次，少一层另一层还在）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 两层判据、两种手段，理由各自要说清：
 *
 * · **数据与投影**用真跑：真 op-log 引擎 + 真 SQLite `:memory:` + 真 `@heyta/app-host`
 *   动作层（与 `note-edit.spec.ts` 逐字同一套 harness），共享投影**也是真的**
 *   （`vi.mock` 把裸导入指到 `packages/ui/src/calendar/model` 那份**同一实现**的源码，
 *   不是重写一份 mock —— 理由与 `sync-status-text.spec.ts` 相同：本包的测试跑在 node，
 *   而 `@heyta/ui` 的**桶**顶层 import `react-native`，值导入会让整个文件转译失败）。
 * · **接线**读源码：移动端没有 React 渲染器（`react-test-renderer` / RNTL 都不在
 *   devDependencies，加它要先过 AGENTS §3.1 可维护性与 §3.2 许可证两道门并逐项登记），
 *   所以这一层按本目录既有约定钉形状（`calendar-view-entry.spec.ts` 同一条路）。
 *   它证明"prop 传了、列表取对了、数学没在宿主重抄一份"，**不**证明
 *   "手机上眼睛看得见"—— 那一半是真机取证（`pnpm verify:mobile-*`），本文件不冒充。
 *
 * ⚠️ 源码判据一律跑在**剥掉注释**的文本上：这些文件里写满了"不许在这里另算一遍
 *   `diffDays`"，连着注释一起扫会让判据自己误报。
 *
 * ✅ **变异验证**（2026-10-04 实测：基线 **13 passed** → 每条注入 → 跑 → 按 sha256 恢复，
 * 恢复后与开场**逐字节相同**；harness 不接管道，理由见 §7 那条 SIGPIPE 事故）：
 *
 * | 注入 | 红的用例（实测） |
 * |---|---|
 * | M1 屏里删掉 `events={events}` | **恰好 1 红**：宿主接线那条 |
 * | M2 屏里删掉 `eventLabels={eventLabels}` | **恰好 1 红**：宿主接线那条（词表是**单独**一颗牙，M1 挡不住它） |
 * | M3 `listEvents(today)` 换成 `listArchivedEvents(today)` | **恰好 1 红**：取的是活列表（`listArchivedEvents` 一出现在本屏就红） |
 * | M4 取数后加一道 `.filter((e) => startOfMonth(e.date) === cursor)` | 2 红：取的是活列表（正则不再匹配）+ 不许在宿主按月筛 |
 * | M5 删掉 `setEvents(…)` 那一行（state 永远是空数组） | **恰好 1 红**：`events={events}` 还挂着，但取数没了 |
 * | M6 把投影区间从「42 格的首末格」改成「显示月」 | **恰好 1 红**：补白格那天那条 —— 也就是"宿主按可见月筛一次"唯一的现形方式 |
 *
 * ⚠️ M6 是唯一一条动**判据自身输入**的注入（它改的是本文件里的 `project()`）：
 * 那一维度的真身在共享层与领域层（`packages/ui/tests/`、`packages/domain/tests/`），
 * 本文件不动它们，只证"这条存在性判据不是永远通过的装饰"。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  monthGrid,
  startOfMonth,
  type CountdownEvent,
  type LocalDate,
  type Task,
} from '@heyta/domain';
import { createEventActions, createTaskActions, type EventActions, type TaskActions } from '@heyta/app-host';
import { translate, type MessageKey } from '@heyta/i18n';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import {
  MAX_CALENDAR_BARS,
  calendarCellBars,
  groupEventsByOccurrence,
  groupTasksByDueDate,
  type CalendarCellBar,
  type CalendarDayEvent,
  type CalendarEventBarLabels,
} from '@heyta/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 见文件头：把 `@heyta/ui` 指向共享层那份**纯**日历模型的源码（同一实现，不是 mock 品）。 */
vi.mock('@heyta/ui', () => import('../../../packages/ui/src/calendar/model'));

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREEN = resolve(HERE, '../src/screens/CalendarScreen.tsx');
const BOARD = resolve(HERE, '../../../packages/ui/src/calendar/CalendarBoard.tsx');
const LOCALES = resolve(HERE, '../../../packages/i18n/src/locales');

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

const screen = codeOf(SCREEN);
const board = codeOf(BOARD);

const zh = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);
const en = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('en', key, vars);

/**
 * 宿主注入的那三个说法 —— 与屏里 `eventLabels` 取的是**同一批 key**。
 * 这里不钉字面内容（存在性先于取值），钉的是"三条都在、两边都非空"。
 */
const eventLabels = (): CalendarEventBarLabels => ({
  today: zh('common.calendar.event.today'),
  until: (days: number) => zh('common.calendar.event.until', { days }),
  since: (days: number) => zh('common.calendar.event.since', { days }),
});

/**
 * 锚定的"今天"：2026-10-15（周四）。月历是**固定 6×7 = 42 格、周一开头**，
 * 所以这一屏画出的区间是 2026-09-28 … 2026-11-08（补白格也算）。
 * 下面三个日子都从这份真实网格里取，不硬写区间。
 */
const TODAY: LocalDate = '2026-10-15';
const CURSOR = startOfMonth(TODAY);
const WEEKS = monthGrid(CURSOR);
const RANGE_FROM = WEEKS[0]?.[0]?.date as LocalDate;
const RANGE_TO = (() => {
  const lastWeek = WEEKS[WEEKS.length - 1];
  return lastWeek?.[lastWeek.length - 1]?.date as LocalDate;
})();

/** 显示月里的一天，格子里**没有任何任务**。 */
const EVENT_DATE: LocalDate = '2026-10-28';
/** **补白格**里的一天（属于下个月，但这一屏照样画、照样可点）。 */
const PADDING_DATE: LocalDate = (() => {
  for (const week of WEEKS) {
    for (const cell of week) {
      if (!cell.inMonth && cell.date > TODAY) return cell.date;
    }
  }
  throw new Error('月历里没有晚于今天的补白格 —— 判据锚点已失效');
})();
/** 归档对照用的那天（同样是"零任务"的一天）。 */
const ARCHIVED_DATE: LocalDate = '2026-10-27';
/** 唯一那条**有**任务的日子，用来证明"倒数日那行不是因为那天恰好有任务才出现的"。 */
const TASK_DATE: LocalDate = '2026-10-20';

const localMs = (date: LocalDate): number => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y as number, (m as number) - 1, d as number, 9, 0, 0).getTime();
};

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let eventActions: EventActions;
let taskActions: TaskActions;
let clock = 1_700_000_000_000;
let seq = 0;

/** 屏里那条取数路径：`listEvents(today)` 的全量活列表 → 共享投影（区间 = 这一屏的 42 格）。 */
const project = (events: readonly CountdownEvent[]): Map<LocalDate, CalendarDayEvent[]> =>
  groupEventsByOccurrence(events, TODAY, RANGE_FROM, RANGE_TO);

/** 一格最终交给板子摆的东西（与 `CalendarBoard` 月档那次调用逐字同一串参数）。 */
const barsOfCell = (
  date: LocalDate,
  tasks: readonly Task[],
  eventsByDate: Map<LocalDate, CalendarDayEvent[]>,
): readonly CalendarCellBar[] =>
  calendarCellBars(tasks, TODAY, date, MAX_CALENDAR_BARS, eventsByDate.get(date), eventLabels()).bars;

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore(adapter),
    clientId: 'client-calendar-event',
    now: () => clock,
  });
  clock = 1_700_000_000_000;
  seq = 0;
  const newEventId = (): string => {
    seq += 1;
    return `cal-event-${String(seq).padStart(3, '0')}`;
  };
  eventActions = createEventActions(engine, { newEventId, now: () => clock });
  taskActions = createTaskActions(engine, { now: () => clock });
});

afterEach(async () => {
  await adapter.close();
});

describe('存在性判据：格子里那一行到底有没有出现', () => {
  it('🔴 前提确实成立：四个日子都在这一屏画出的 42 格里，而补白格那天确实不属于显示月', () => {
    // AGENTS §7 元规则 2：判据必须**断言前提成立** ——
    // 否则"那天本来就不在网格里"会被读成"倒数日没出现"（假红），
    // 而"那天本来就有任务"会被读成"倒数日出现了"（假绿）。
    const rendered = new Set(WEEKS.flatMap((week) => week.map((cell) => cell.date)));
    for (const date of [EVENT_DATE, ARCHIVED_DATE, PADDING_DATE, TASK_DATE]) {
      expect(rendered.has(date), `${date} 不在渲染区间内`).toBe(true);
      expect(date >= RANGE_FROM && date <= RANGE_TO, `${date} 落在投影区间外`).toBe(true);
    }
    // 补白格那天的全部意义：**在网格里、但不在显示月**。宿主按月先筛一次，
    // 只有这一格会空 —— 所以得先确认它真的不是本月的。
    expect(startOfMonth(PADDING_DATE), '补白格那天落在了显示月里，那条判据白写').not.toBe(CURSOR);
  });

  it('🔴 只有倒数日、零任务的那天：那一行出现了（不是"混在任务里被算成有内容"）', async () => {
    await taskActions.create('买牛奶', { dueDate: localMs(TASK_DATE) });
    await eventActions.createEvent('结婚纪念日', EVENT_DATE);

    const byDate = project(eventActions.listEvents(TODAY));
    const cellTasks = groupTasksByDueDate(taskActions.listTasks()).get(EVENT_DATE) ?? [];
    expect(cellTasks, '前提：那天确实一个任务都没有').toHaveLength(0);

    const bars = barsOfCell(EVENT_DATE, cellTasks, byDate);
    const eventRows = bars.filter((bar) => bar.event === true);
    expect(eventRows, '那天零任务，倒数日那一行却没出现').toHaveLength(1);
    // 存在性再往前一步：整格**只有**那一行（任务行一条都不许混进来顶包）。
    expect(bars).toHaveLength(1);
    expect(bars[0]?.id).toBe(eventRows[0]?.id);
  });

  it('🔴 补白格那天（不属于显示月、照样渲染）也要有那一行 —— 宿主不许先按月筛', async () => {
    await eventActions.createEvent('补白格纪念日', PADDING_DATE);

    const byDate = project(eventActions.listEvents(TODAY));
    const cellTasks = groupTasksByDueDate(taskActions.listTasks()).get(PADDING_DATE) ?? [];
    expect(cellTasks, '前提：补白格那天确实没有任务').toHaveLength(0);

    const bars = barsOfCell(PADDING_DATE, cellTasks, byDate);
    expect(bars.filter((bar) => bar.event === true), '按可见月筛过的症状就是这一格空着').toHaveLength(1);
  });

  it('注入了词表时那一行**不只是标题**（"看不出是不是好日子"是测得出来的）', async () => {
    await eventActions.createEvent('结婚纪念日', EVENT_DATE);
    const byDate = project(eventActions.listEvents(TODAY));
    const [row] = barsOfCell(EVENT_DATE, [], byDate);
    expect(row?.title).toContain('结婚纪念日');
    // 词表真的接上了：比裸标题长（`还有 N 天` 那半句在里面）。
    // ⚠️ 刻意不钉具体字面 —— 措辞改了这条不该红。
    expect((row?.title ?? '').length).toBeGreaterThan('结婚纪念日'.length);
  });
});

describe('反向对照：归档与删除的都不许进日历', () => {
  it('🔴 归档那条：动作层的列表里没有，投影出来的格子里也没有', async () => {
    const id = await eventActions.createEvent('不想再看到的日子', ARCHIVED_DATE);
    await eventActions.archiveEvent(id);

    const alive = eventActions.listEvents(TODAY);
    expect(alive.some((event) => event.id === id), '归档后仍在活列表里').toBe(false);

    const byDate = project(alive);
    expect(byDate.get(ARCHIVED_DATE), '归档的倒数日还出现在日历上').toBeUndefined();
    const bars = barsOfCell(ARCHIVED_DATE, [], byDate);
    expect(bars).toHaveLength(0);
    // 而它**确实**在归档列表里（否则上面那条"没有"只是因为根本没建成功）。
    expect(eventActions.listArchivedEvents(TODAY).some((event) => event.id === id)).toBe(true);
  });

  it('🔴 第二层兜底：就算宿主误把归档列表交出去，共享投影也把它丢掉（`aliveEvents` 口径）', async () => {
    const id = await eventActions.createEvent('已归档但仍被传入', ARCHIVED_DATE);
    await eventActions.archiveEvent(id);
    const archived = eventActions.listArchivedEvents(TODAY);
    expect(archived.some((event) => event.id === id), '前提：归档列表里确实有它').toBe(true);
    const byDate = project(archived);
    expect(byDate.get(ARCHIVED_DATE)).toBeUndefined();
    expect(barsOfCell(ARCHIVED_DATE, [], byDate)).toHaveLength(0);
  });

  it('软删除（回收站）同样不进日历', async () => {
    const id = await eventActions.createEvent('删掉的日子', EVENT_DATE);
    await eventActions.removeEvent(id);
    expect(eventActions.listEvents(TODAY).some((event) => event.id === id)).toBe(false);
    expect(barsOfCell(EVENT_DATE, [], project(eventActions.listEvents(TODAY)))).toHaveLength(0);
  });
});

describe('宿主接线：`CalendarScreen` 真的把第二个源交给了共享板', () => {
  it('🔴 `<CalendarBoard>` 同时传了 `events` 与 `eventLabels`（删掉任何一个本条必须红）', () => {
    const call = /<CalendarBoard[\s\S]*?\/>/.exec(screen)?.[0] ?? '';
    expect(call, '找不到 <CalendarBoard> 调用').not.toBe('');
    expect(call).toContain('events={events}');
    expect(call).toContain('eventLabels={eventLabels}');
  });

  it('🔴 取的是 `listEvents(today)`（活列表），不是归档列表，也不是自己拼 op', () => {
    expect(screen).toMatch(/setEvents\(\s*eventActions\.listEvents\(\s*today\s*\)\s*\)/);
    // 归档列表在本屏**一次都不许读**（读了就等于把"删掉了还在"接进日历）。
    expect(screen, '宿主把归档列表也交给了日历').not.toContain('listArchivedEvents');
    // `check:layering` 的 `no-op-construction-in-apps`：外壳不许自己拼 EVENT 的 op。
    expect(screen).not.toContain("entityType: 'EVENT'");
  });

  it('🔴 宿主不筛月、不重复投影：按月筛/算发生日的三样东西都不许出现在取数路径里', () => {
    // 全量交给板子：哪几天落在这一屏由 `groupEventsByOccurrence` 决定。
    expect(screen, '宿主对 events 做了 filter ⇒ 又长回第二份数学').not.toMatch(
      /events\s*\.filter\(|listEvents\([^)]*\)\s*\.filter\(/,
    );
    expect(screen).not.toContain('eventOccurrencesInRange');
    expect(screen).not.toContain('aliveEvents');
    // 天数那句话里的 `days` 是共享层算好传进来的，宿主一次都不算。
    expect(screen).not.toMatch(/until:\s*\(days: number\)[\s\S]{0,120}diffDays\(/);
  });

  it('同步完成后重读倒数日（`dataRevision` 没接上时，冷启动切回来是空的）', () => {
    expect(screen).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?refresh\(\);[\s\S]*?\},\s*\[host,\s*refresh,\s*dataRevision\]\)/);
    // 取数函数按 `today` 重建：跨零点/回前台后"距下一次"与投影都得跟着重算。
    expect(screen).toMatch(/const refresh = useCallback\([\s\S]*?\},\s*\[[^\]]*today[^\]]*\]\)/);
  });

  it('三个说法走 `common.calendar.event.*`（与 Web 同一批 key，中英都非空）', () => {
    for (const key of ['today', 'until', 'since']) {
      // 只钉"这个 key 被取了"（`until` / `since` 带插值参数，写死成 `t('…')` 会假红）。
      expect(screen, `屏里没有注入 common.calendar.event.${key}`).toContain(
        `t('common.calendar.event.${key}'`,
      );
    }
    // 词条两边都在且非空（缺 key 会让 `translate` 抛，那本身就是判据）。
    expect(zh('common.calendar.event.today')).not.toBe('');
    expect(zh('common.calendar.event.until', { days: 3 })).toContain('3');
    expect(en('common.calendar.event.until', { days: 3 })).toContain('3');
    expect(zh('common.calendar.event.since', { days: 7 })).toContain('7');
    expect(en('common.calendar.event.since', { days: 7 })).toContain('7');
    // 反向：不许给移动端另抄一套 `mobile.calendar.event.*`（那是同一句话两个来源）。
    const zhTable = codeOf(resolve(LOCALES, 'zh-CN.ts'));
    expect(zhTable, '词条表里另长了一份 mobile.calendar.event.*').not.toContain(
      "'mobile.calendar.event.",
    );
  });

  it('那一行的 testID 在板子里叫 `-event`（不叫 `-bar`）—— 判据才问得出"这格有没有那个日子"', () => {
    // 与 web/e2e 那侧同名判据对齐：共用 `-bar` 的话，"宿主没接第二个源"
    // 会被"任务条画出来了"读成通过。
    expect(board).toMatch(/testIDOf\(date\)\}-\$\{bar\.event === true \? 'event' : 'bar'\}/);
    expect(board).toMatch(/const testIDOf = \(date: LocalDate\): string => `calendar-cell-\$\{date\}`/);
    // 于是这条倒数日行的 testID 就是 `calendar-cell-<YYYY-MM-DD>-event`（标题再带 `-title`）。
    expect(`calendar-cell-${EVENT_DATE}-event`).toBe('calendar-cell-2026-10-28-event');
  });
});
