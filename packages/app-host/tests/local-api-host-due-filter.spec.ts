/**
 * `list_tasks` 的日期过滤 —— **断言结果集**
 * ==========================================
 *
 * 🔴🔴 这个文件存在的理由是**判据换了层**。
 *
 * 原缺陷（AI-G3 / 计划 W3）之所以能一直绿，是因为既有测试**只断言 args**：
 * 规则传了什么参数、执行器收到了什么参数 —— 全对，但"今天有什么任务"
 * 拿回来的仍然是**全量前 N 条**。参数层的断言对这件事**结构上看不见**，
 * 因为它压根没读数据。
 *
 * 所以这里的每一条判据都是**结果**：造了几条哪几天的任务，就必须**恰好**拿到
 * 那几条。强度全在"恰好"上 —— "包含"和"不为空"都挡不住原缺陷，
 * 因为全量前 N 条**也包含**今天的那几条。
 *
 * 三条最容易糊过去的事，分别钉死：
 *
 *   1. **过滤先于 `limit`**。这条自带"前提断言"：先证明那条今天的任务确实排在
 *      第 50 位**之后**，再证明带着 `limit: 50` 仍然读得到它。
 *      少了前半句，后半句可能只是它压根不需要过滤就绿了（AGENTS §7 元规则第 2 条）。
 *   2. **闭区间两端都含**。只测区间的中间，挡不住 ±1 天。
 *   3. **按本地日历日比**，与机器时区无关；而比较用的换算与投影字段用的是**同一个**
 *      （`toLocalDateString`）—— 不会出现"筛 15 号，返回里写着 15 号的那条被漏掉"。
 */

import { addDays, parseLocalDate, Priority, today } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runReadTool, type LocalApiHost, type LocalApiItem } from '@heyta/local-api';

import { createTaskActions, type TaskActions } from '../src/actions.js';
import { resolveToolSelection } from '../src/ai-tool-selection.js';
import { createLocalApiHost, toLocalDateString } from '../src/local-api-host.js';

/**
 * 固定"今天"：**注入时钟，不读真实时间** ——
 * 否则这些用例在几天之后会自己变红（与 `ToolSelectionContext.now` 同一条理由）。
 */
const BASE_CLOCK = 1_700_000_000_000;
let clock = BASE_CLOCK;
const now = (): number => clock;

let idSeq = 0;
const makeId = (): string => {
  idSeq += 1;
  return `task-${String(idSeq).padStart(3, '0')}`;
};

/** 这一组用例里的"今天"。 */
const TODAY = today(BASE_CLOCK);
const TOMORROW = addDays(TODAY, 1);

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TaskActions;
let host: LocalApiHost;

/** 重新接上引擎与宿主（`clock` 被改过之后要用它重建"今天"）。 */
function rewire(): void {
  engine = new OpLogEngine({ store: new DbOpLogStore(adapter), clientId: 'client-test', now });
  actions = createTaskActions(engine, { now, newTaskId: makeId });
  host = createLocalApiHost(engine, actions, { isReadable: () => true });
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  clock = BASE_CLOCK;
  idSeq = 0;
  rewire();
});

afterEach(() => {
  adapter.close();
});

/** 某个本地日历日的**当天 0 点**（epoch ms）。 */
const epochOf = (day: string): number => parseLocalDate(day).getTime();

/** 建成 `day` 这天到期的一条任务，返回它的 id。 */
async function createDue(title: string, day: string): Promise<string> {
  return actions.create(title, { dueDate: epochOf(day) });
}

/** 结果的 id 列表（"恰好"比较用的东西）。 */
function ids(items: readonly { id: string }[]): string[] {
  return items.map((i) => i.id);
}

const sorted = (values: readonly string[]): string[] => [...values].sort();

// ─────────────────────────────────────────────────────────────────────────
// 1. `dueOn`：恰好是那几条（这条缺陷的原形）
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 dueOn 的结果集', () => {
  it('造 3 条今天 + 2 条明天 ⇒ dueOn=今天**恰好**返回那 3 条', async () => {
    const t1 = await createDue('今天的 1', TODAY);
    const t2 = await createDue('今天的 2', TODAY);
    const t3 = await createDue('今天的 3', TODAY);
    await createDue('明天的 1', TOMORROW);
    await createDue('明天的 2', TOMORROW);

    const items = await host.listTasks({ dueOn: TODAY });

    // 🔴 是"恰好"，不是"包含"：全量前 N 条**也包含**这三条 ——
    // 当初那种断言正是原缺陷能一直绿的原因。
    expect(sorted(ids(items))).toEqual(sorted([t1, t2, t3]));
    // 返回里显示的日期与筛的那一天是同一个日子（口径没漂）
    for (const item of items) expect(item.dueDate).toBe(TODAY);
  });

  it('明天那条**一条都不许**出现（正反两向都断）', async () => {
    const todayId = await createDue('今天的', TODAY);
    const tomorrowId = await createDue('明天的', TOMORROW);

    const items = await host.listTasks({ dueOn: TODAY });
    expect(ids(items)).toEqual([todayId]);
    expect(ids(items)).not.toContain(tomorrowId);
  });

  it('🔴 没有截止日的任务不属于任何一天，但不过滤时它必须还在', async () => {
    const undated = await actions.create('收件箱里的一条');
    const dueToday = await createDue('今天的', TODAY);

    // 筛"今天" ⇒ 收件箱那条不在
    expect(ids(await host.listTasks({ dueOn: TODAY }))).toEqual([dueToday]);
    // 不筛 ⇒ 它还在。排除是**筛掉**的，不是被过滤顺手删掉的
    const all = await host.listTasks({});
    expect(ids(all)).toEqual([undated, dueToday]);
    expect(all.find((i) => i.id === undated)?.dueDate).toBeUndefined();
  });

  it('日期过滤与 completed / projectId **叠加**而不是互相覆盖', async () => {
    const doneToday = await createDue('今天且完成', TODAY);
    const openToday = await createDue('今天未完成', TODAY);
    await actions.create('别的事');
    await actions.setCompleted(doneToday, true);

    expect(ids(await host.listTasks({ dueOn: TODAY, completed: true }))).toEqual([doneToday]);
    expect(ids(await host.listTasks({ dueOn: TODAY, completed: false }))).toEqual([openToday]);
    // 不存在的清单 ⇒ 交集为空。这是**筛出来的**空，不是报错，也不是"忽略该条件"
    expect(await host.listTasks({ dueOn: TODAY, projectId: 'nope' })).toEqual([]);
  });

  it('筛出来空列表时是**真的**没有那天的任务（而不是过滤没生效）', async () => {
    await createDue('明天的', TOMORROW);
    await actions.create('没日子');
    expect(await host.listTasks({ dueOn: TODAY })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. 🔴 先按日期过滤、**再**应用 limit —— 这条缺陷的第二副面孔
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 过滤先于 limit', () => {
  it('今天那条排在**第 61 位**时，`limit: 50` 仍然必须返回它', async () => {
    // 60 条**不是今天**的（明天到期）—— 它们决定了截断点
    for (let i = 0; i < 60; i += 1) await createDue(`背景 ${String(i)}`, TOMORROW);
    const todayId = await createDue('今天但排在最后', TODAY);

    // 🔴 **前提断言**：先证明"先截断再筛"确实会把它筛没。
    // 没有这一句，下面那条断言可能只是"它本来就排在前面"而绿。
    const truncatedFirst = await host.listTasks({ limit: 50 });
    expect(truncatedFirst).toHaveLength(50);
    expect(ids(truncatedFirst)).not.toContain(todayId);

    // 要的结论：带日期过滤 + 同一个 limit ⇒ 那条**仍然在**
    const items = await host.listTasks({ dueOn: TODAY, limit: 50 });
    expect(ids(items)).toEqual([todayId]);
  });

  it('默认上限 50 也不许把靠后的今天的任务吞掉', async () => {
    for (let i = 0; i < 60; i += 1) await createDue(`背景 ${String(i)}`, TOMORROW);
    const todayId = await createDue('今天', TODAY);

    // 不传 limit ⇒ 宿主默认 50。截断发生在过滤**之后**，所以结果就这一条。
    expect(ids(await host.listTasks({ dueOn: TODAY }))).toEqual([todayId]);
  });

  it('过滤后的条数**多于** limit 时才截断（截的是结果，不是候选）', async () => {
    const todayIds: string[] = [];
    for (let i = 0; i < 70; i += 1) todayIds.push(await createDue(`今天 ${String(i)}`, TODAY));
    for (let i = 0; i < 30; i += 1) await createDue(`明天 ${String(i)}`, TOMORROW);

    const items = await host.listTasks({ dueOn: TODAY, limit: 50 });
    expect(items).toHaveLength(50);
    // 而且这 50 条**全都是**今天的：截断没有把明天的混进来、也没有漏掉今天的
    for (const item of items) expect(item.dueDate).toBe(TODAY);
    expect(new Set(ids(items)).size).toBe(50);
    for (const item of items) expect(todayIds).toContain(item.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. 闭区间：两端都含
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 dueFrom / dueTo 是**闭**区间', () => {
  it('起点那天与终点那天都在结果里，区间外的两条都不在', async () => {
    const from = TODAY;
    const to = addDays(TODAY, 6);
    const middle = addDays(TODAY, 3);

    const beforeId = await createDue('区间前', addDays(TODAY, -1));
    const fromId = await createDue('起点这天', from);
    const middleId = await createDue('中间这天', middle);
    const toId = await createDue('终点这天', to);
    const afterId = await createDue('区间后', addDays(TODAY, 7));

    const items = await host.listTasks({ dueFrom: from, dueTo: to });

    // 🔴 两端**各自**断言：只测"中间那条在"挡不住 ±1 天
    expect(sorted(ids(items))).toEqual(sorted([fromId, middleId, toId]));
    expect(ids(items)).not.toContain(beforeId);
    expect(ids(items)).not.toContain(afterId);
  });

  it('同一天当两端 ⇒ 就是那一天（跨度 1 天）', async () => {
    const only = await createDue('就今天', TODAY);
    await createDue('明天', TOMORROW);
    expect(ids(await host.listTasks({ dueFrom: TODAY, dueTo: TODAY }))).toEqual([only]);
  });

  it('14 天（含两端）能筛出跨两周的结果，第 15 天不在', async () => {
    const first = await createDue('第 1 天', TODAY);
    const last = await createDue('第 14 天', addDays(TODAY, 13));
    await createDue('第 15 天', addDays(TODAY, 14));

    const items = await host.listTasks({ dueFrom: TODAY, dueTo: addDays(TODAY, 13) });
    expect(sorted(ids(items))).toEqual(sorted([first, last]));
  });

  it('跨年 / 跨月的范围按日历连续（不在这里被切成两段）', async () => {
    const before = await createDue('12-31', '2025-12-31');
    const after = await createDue('01-01', '2026-01-01');
    await createDue('12-30', '2025-12-30');

    const items = await host.listTasks({ dueFrom: '2025-12-31', dueTo: '2026-01-01' });
    expect(sorted(ids(items))).toEqual(sorted([before, after]));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. 时区：按**本地日历日**，与机器时区无关
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 本地日界的两侧', () => {
  it('🔴 本地 23:30 归前一天、次日 00:30 归后一天', async () => {
    // 用**本地**构造器：无论 CI 在 UTC 还是 UTC+8，两天的归属都一致。
    const eveningId = await actions.create('深夜的那条', {
      dueDate: new Date(2026, 2, 15, 23, 30, 0, 0).getTime(),
    });
    const earlyId = await actions.create('凌晨的那条', {
      dueDate: new Date(2026, 2, 16, 0, 30, 0, 0).getTime(),
    });

    expect(ids(await host.listTasks({ dueOn: '2026-03-15' }))).toEqual([eveningId]);
    expect(ids(await host.listTasks({ dueOn: '2026-03-16' }))).toEqual([earlyId]);
    // 两端各归一天 ⇒ 一个范围把它们都收进来
    expect(sorted(ids(await host.listTasks({ dueFrom: '2026-03-15', dueTo: '2026-03-16' })))).toEqual(
      sorted([eveningId, earlyId]),
    );
  });

  it('🔴 "今天"这个锚点**跨日界**时不漏掉深夜那条', async () => {
    // 把时钟推到本地 23:59：此时 `today(now())` 仍是 15 号，
    // 而 UTC 写法早把它算成 16 号了 —— 那条 23:30 的任务就会凭空从"今天"消失。
    clock = new Date(2026, 2, 15, 23, 59, 0, 0).getTime();
    rewire();

    const lateId = await actions.create('今天深夜到期', {
      dueDate: new Date(2026, 2, 15, 23, 30, 0, 0).getTime(),
    });

    const items = await host.listTasks({ dueOn: today(now()) });
    expect(ids(items)).toEqual([lateId]);
    expect(items[0]?.dueDate).toBe('2026-03-15');
  });

  it('过滤口径与**投影字段**口径一致：筛哪天，返回里的 dueDate 就是哪天', async () => {
    const due = await createDue('对照', TODAY);
    expect(toLocalDateString(epochOf(TODAY))).toBe(TODAY);

    const [item] = await host.listTasks({ dueOn: TODAY });
    expect(item?.id).toBe(due);
    expect(item?.dueDate).toBe(TODAY);
  });

  it('已完成但**今天到期**的任务仍在日期结果里（完成态是另一个条件）', async () => {
    const due = await createDue('今天但已完成', TODAY);
    await actions.setCompleted(due, true);

    expect(ids(await host.listTasks({ dueOn: TODAY }))).toEqual([due]);
    expect(ids(await host.listTasks({ dueOn: TODAY, completed: false }))).toEqual([]);
  });

  it('优先级不影响日期过滤', async () => {
    const due = await actions.create('今天且高优先级', {
      dueDate: epochOf(TODAY),
      priority: Priority.High,
    });

    const [item] = await host.listTasks({ dueOn: TODAY });
    expect(item?.id).toBe(due);
    expect(item?.priority).toBe('high');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. 🔴 同进程端到端：**一句"今天有什么任务" → 结果集**
// ─────────────────────────────────────────────────────────────────────────
//
// 上面两层各自都有判据，但这条缺陷的原形恰恰是**层与层之间的缝**：
// 规则传了参数、执行器收到了参数、宿主也返回了东西 —— 每一层单看都"没错"，
// 用户拿到的却是全量前 N 条。所以这里把**三层接在一起**跑一遍：
//
//   `resolveToolSelection`（选工具 + 出参数）
//     → `runReadTool`（契约级校验，`@heyta/local-api` 的唯一执行核）
//       → `createLocalApiHost`（真的读物化状态并过滤）
//
// 任何一层退回原样（参数变空、校验被拿掉、过滤被拿掉），这里都会红。

describe('🔴🔴 端到端（同进程）：规则 → 执行核 → 结果集', () => {
  const GRANTS = { list_tasks: true } as const;

  /** 把三层接起来跑一次，返回**用户实际拿到的**条目。 */
  async function ask(text: string): Promise<readonly LocalApiItem[]> {
    const selection = resolveToolSelection(text, { grants: GRANTS, now });
    if (selection.kind !== 'tool') throw new Error(`没选中工具：${JSON.stringify(selection)}`);
    const outcome = await runReadTool(host, selection.tool, selection.args);
    if (!outcome.ok) throw new Error(`执行失败：${outcome.kind} ${outcome.message}`);
    return outcome.payload as readonly LocalApiItem[];
  }

  it('🔴 "今天有什么任务"返回**那三条今天的**，不是全量前 N 条', async () => {
    const t1 = await createDue('今天的 1', TODAY);
    const t2 = await createDue('今天的 2', TODAY);
    const t3 = await createDue('今天的 3', TODAY);
    for (let i = 0; i < 60; i += 1) await createDue(`背景 ${String(i)}`, TOMORROW);

    const items = await ask('今天有什么任务');
    expect(sorted(ids(items))).toEqual(sorted([t1, t2, t3]));

    // 🔴 反面判据：**同一份数据**，问法不同 ⇒ 答案必须不同。
    // 原缺陷的形状就是这两者**逐字相同**（都是全量前 50 条）。
    const everything = await ask('列出所有任务');
    expect(everything).toHaveLength(50);
    expect(ids(everything)).not.toEqual(ids(items));
  });

  it('🔴 "列出任务"仍然返回全量（今日那条规则不许把普通列表也一起筛了）', async () => {
    await createDue('今天的', TODAY);
    for (let i = 0; i < 5; i += 1) await createDue(`明天 ${String(i)}`, TOMORROW);

    const items = await ask('列出所有任务');
    expect(items).toHaveLength(6);
  });

  it('问未来某天 ⇒ 拿到的是那天的，不是今天顺延的', async () => {
    const dayAfter = addDays(TODAY, 2);
    const future = await actions.create('后天的一条', { dueDate: epochOf(dayAfter) });
    await createDue('今天的', TODAY);

    const items = await host.listTasks({ dueOn: dayAfter });
    expect(ids(items)).toEqual([future]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. 🔴 投影在过滤之后仍然成立（过滤不许绕过"受保护条目"那道闸）
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 日期过滤不绕过 readable 判定', () => {
  it('今天那条若不可读，正文连字段都不存在', async () => {
    await createDue('今天的私密', TODAY);
    const protectedHost = createLocalApiHost(engine, actions, {
      isReadable: (task) => !task.title.startsWith('私密'),
    });
    await actions.create('私密的一条', { dueDate: epochOf(TODAY), note: '不该被读出来的正文' });

    const items = await protectedHost.listTasks({ dueOn: TODAY });
    expect(items).toHaveLength(2);
    const secret = items.find((i) => i.title === '私密的一条');
    expect(secret?.readable).toBe(false);
    expect('body' in (secret ?? {})).toBe(false);
    expect(JSON.stringify(items)).not.toContain('不该被读出来的正文');
  });
});
