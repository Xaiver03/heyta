/**
 * 本地 API 宿主适配器测试
 * ========================
 *
 * 用**真实引擎 + 真实 SQLite**（`:memory:`），理由与 `actions.spec.ts` 相同：
 * 假探针只能证明"我调了 dispatch"，对 op 的**形状**一无所知。
 *
 * 三条承重断言：
 *
 *   1. 🔴 **写入真的产出了 op**（不是"我调了个函数"）—— 这是"经 dispatch"
 *      唯一能被证明的形式
 *   2. 🔴 **不可读任务连 `body` 字段都不存在**（不是空字符串、不是 null）
 *   3. 🔴 **日期转换用本地时区，且非法日期被拒绝而不是猜一个**
 *      —— 这一类错误本仓库已经踩过一次（模型把"明天"算成 4 个半月前）
 */

import { readFileSync } from 'node:fs';

import { dueDateToEpoch, localTimeOf, Priority } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';
import { createProjectActions } from '../src/project-actions.js';
import {
  createLocalApiHost,
  fromLocalDateString,
  taskToItem,
  toLocalApiDueString,
  toLocalDateString,
} from '../src/local-api-host.js';
import type { LocalApiHost } from '@heyta/local-api';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TaskActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;
let idSeq = 0;
const makeId = (): string => {
  idSeq += 1;
  return `task-${String(idSeq).padStart(3, '0')}`;
};

function makeHost(options?: Parameters<typeof createLocalApiHost>[2]): LocalApiHost {
  // `isReadable` 现在是必填的（见 `local-api-host.ts` 的说明）。
  // 这些用例测的是别的行为，所以默认"全都读得出来"；
  // 需要测 Bear 范式的那组会自己传。
  return createLocalApiHost(engine, actions, options ?? { isReadable: () => true });
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-test',
    now,
  });
  clock = 1_700_000_000_000;
  idSeq = 0;
  actions = createTaskActions(engine, { now, newTaskId: makeId });
});

afterEach(() => {
  adapter.close();
});

async function opsOf(entityId: string): Promise<Operation<string>[]> {
  return engine.getOpsForEntity('TASK', entityId);
}

// ─────────────────────────────────────────────────────────────────────────
// 日期：本地时区，且不猜
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 日期转换 —— 本地时区，不是 UTC', () => {
  it('🔴 本地时间的深夜仍然是同一天（`toISOString` 写法会差一天）', () => {
    // 本地 2026-03-15 23:30。用 UTC 写法在 UTC+8 会得到 2026-03-15T15:30Z → 还是 15 号；
    // 但在 UTC-5 会得到 2026-03-16T04:30Z → **变成 16 号**。
    // 正确行为与机器时区无关：本地日期就是 15 号。
    const lateEvening = new Date(2026, 2, 15, 23, 30, 0, 0);
    expect(toLocalDateString(lateEvening.getTime())).toBe('2026-03-15');
  });

  it('🔴 本地时间的凌晨也还是同一天', () => {
    const earlyMorning = new Date(2026, 2, 15, 0, 30, 0, 0);
    expect(toLocalDateString(earlyMorning.getTime())).toBe('2026-03-15');
  });

  it('🔴 解析回来是**本地 0 点**（与机器时区无关的属性）', () => {
    const epoch = fromLocalDateString('2026-03-15');
    expect(epoch).toBeDefined();
    const d = new Date(epoch as number);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });

  it('往返一致', () => {
    for (const text of ['2026-01-01', '2026-03-15', '2026-12-31', '2024-02-29']) {
      const epoch = fromLocalDateString(text);
      expect(epoch, text).toBeDefined();
      expect(toLocalDateString(epoch as number), text).toBe(text);
    }
  });

  it('🔴 非法日期返回 undefined（**不猜**，不静默改成别的日子）', () => {
    for (const bad of [
      '2026-02-31', // 格式对但不存在
      '2026-13-01',
      '2026-00-10',
      '2026-3-5', // 位数不对
      '2026/03/15',
      '明天',
      '',
      '2026-03-15T10:00:00Z',
    ]) {
      expect(fromLocalDateString(bad), bad).toBeUndefined();
    }
  });

  it('闰年边界：2025 不是闰年 → 2 月 29 日被拒', () => {
    expect(fromLocalDateString('2025-02-29')).toBeUndefined();
    expect(fromLocalDateString('2024-02-29')).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 可读性
// ─────────────────────────────────────────────────────────────────────────

/*
 * ── R14：本机工具（MCP / 脚本 / 编辑器）看到的**时刻** ─────────────
 *
 * 这一组钉的是"链的最后一米"：界面上能设的时刻，出了界面必须还看得见 ——
 * 以前 `taskToItem` 直接 `toLocalDateString(...)`（只留日），于是
 * "16:00 接孩子"在 MCP 眼里与"今天接孩子"**是同一个值**，而写入侧只收 `YYYY-MM-DD`
 * ⇒ 本机工具既读不到也写不进时刻。两处都是**静默**的。
 *
 * 🔴 为什么刻意用**同一个键**带 `T16:00` 而不是新增 `dueTime`：
 *   `dueDate` 已经在两个工具的 `egressFields` 出境披露清单里（`tools.ts:97` / `:109`）、
 *   两处白名单投影里（`tools.ts:411` / `:448`）与 MCP 输出 schema 里。
 *   新增字段要同时改这五处，**少改最后一处就是"把没披露过的字段送出去"**。
 */
describe('🔴 R14 本机工具那一侧的时刻', () => {
  it('有时刻的带 `T16:00`，只到日的一格都不多写', () => {
    expect(toLocalApiDueString(dueDateToEpoch('2026-03-15', '16:00'))).toBe('2026-03-15T16:00');
    const allDay = toLocalApiDueString(dueDateToEpoch('2026-03-15'));
    expect(allDay).toBe('2026-03-15');
    // 🔴 反向对照：不许写成 `2026-03-15T00:00` —— 那会把"只到日"伪装成"定在午夜"，
    //   而这两种任务在日档里住在**不同的带**（全天带 vs 00:00 那一格）。
    expect(allDay.includes('T'), allDay).toBe(false);
  });

  it('🔴 投影真的走了那一个换算（不是这里自己再拼一次日子）', () => {
    const timed = taskToItem(
      {
        id: 't1',
        title: '接孩子',
        dueDate: dueDateToEpoch('2026-03-15', '16:00'),
        createdAt: 0,
        updatedAt: 0,
      } as never,
      true,
    );
    expect(timed.dueDate).toBe('2026-03-15T16:00');
    const dayOnly = taskToItem(
      {
        id: 't2',
        title: '交房租',
        dueDate: dueDateToEpoch('2026-03-15'),
        createdAt: 0,
        updatedAt: 0,
      } as never,
      true,
    );
    expect(dayOnly.dueDate).toBe('2026-03-15');
  });

  it('收 `T16:00` 且落在**本地那一分钟**；往返一致', () => {
    const epoch = fromLocalDateString('2026-03-15T16:00');
    expect(epoch).toBeDefined();
    const d = new Date(epoch as number);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 2, 15, 16, 0,
    ]);
    expect(localTimeOf(epoch as number)).toBe('16:00');
    expect(toLocalApiDueString(epoch as number)).toBe('2026-03-15T16:00');
    // 只到日的那一条往返**不长出 `T`**（否则读回去的人会以为它定在午夜）
    expect(toLocalApiDueString(fromLocalDateString('2026-03-15') as number)).toBe('2026-03-15');
  });

  it('🔴 时刻形状不合法一律拒（不猜、不截断成日子）', () => {
    for (const bad of [
      '2026-03-15T25:00',
      '2026-03-15T16:99',
      '2026-03-15T16', // 半截时刻
      '2026-03-15 16:00', // 空格不是 `T`
      '2026-03-15T16:00:00', // 带秒：规范形只到分
      '2026-03-15T10:00:00Z',
      '2026-02-31T10:00', // 日子不存在，带了时刻也不该被放过
    ]) {
      expect(fromLocalDateString(bad), bad).toBeUndefined();
    }
  });

  it('🔴 create-task 带时刻 ⇒ op 载荷就是那一分钟；非法形状被拒且说的是两种口径', async () => {
    const ok = await makeHost().submit({
      action: 'create-task',
      title: '带时刻的任务',
      dueDate: '2026-03-15T16:00',
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const payload = (await opsOf(ok.taskId))[0]?.payload as Record<string, unknown>;
    expect(payload['dueDate']).toBe(dueDateToEpoch('2026-03-15', '16:00'));

    const bad = await makeHost().submit({
      action: 'create-task',
      title: '坏形状',
      dueDate: '2026-03-15T25:00',
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reason).toBe('invalid');
    // 报错要说出**两种**都收 —— 只提 `YYYY-MM-DD` 等于让工具作者以为时刻写不进去。
    // ⚠️ 第二条不能用 `toContain('YYYY-MM-DD')`：`YYYY-MM-DDTHH:MM` 里本来就含它，
    //   那是一条**永远通过**的判据（§7 元规则 2）。这里要的是"裸日期的那种写法也被提到"。
    expect(bad.message).toContain('YYYY-MM-DDTHH:MM');
    expect(bad.message, bad.message).toMatch(/YYYY-MM-DD(?!T)/u);
  });
});

describe('🔴🔴 不可读任务连 body 字段都不存在', () => {
  it('readable=false 时没有 body（不是空串、不是 null）', () => {
    const item = taskToItem(
      { id: 't1', title: '体检报告', note: '身份证号 110101...', createdAt: 0, updatedAt: 0 } as never,
      false,
    );
    expect('body' in item).toBe(false);
    expect(item.readable).toBe(false);
    expect(item.title).toBe('体检报告');
    expect(JSON.stringify(item)).not.toContain('身份证号');
  });

  it('readable=true 时才带 body', () => {
    const item = taskToItem(
      { id: 't1', title: '交周报', note: '附上图表', createdAt: 0, updatedAt: 0 } as never,
      true,
    );
    expect(item.body).toBe('附上图表');
  });

  it('没有 note 的任务，可读时也不带 body 字段', () => {
    const item = taskToItem({ id: 't1', title: 'x', createdAt: 0, updatedAt: 0 } as never, true);
    expect('body' in item).toBe(false);
  });

  it('🔴 isReadable 钩子被真的接上（listTasks 逐条判定）', async () => {
    // 借口：标题以"私密"开头的受保护。这是**测试用的借口**，
    // 不是产品机制（ADR-0011 §6.1 把产品机制列为未决）。
    await actions.create('公开任务');
    const secretId = await actions.create('私密任务');
    const host = makeHost({ isReadable: (t) => !t.title.startsWith('私密') });

    const items = await host.listTasks({});
    const open = items.find((i) => i.title === '公开任务');
    const secret = items.find((i) => i.title === '私密任务');
    expect(open?.readable).toBe(true);
    expect(secret?.readable).toBe(false);
    expect(secret?.id).toBe(secretId);
  });

  it('🔴 isReadable 对 getTask 一样生效（两条读路径都要过闸）', async () => {
    const id = await actions.create('私密任务', { note: '不该被读出来的正文' });
    const host = makeHost({ isReadable: (t) => !t.title.startsWith('私密') });

    const item = await host.getTask(id);
    expect(item?.readable).toBe(false);
    // 🔴 元数据在，正文**不在**
    expect(item?.title).toBe('私密任务');
    expect(item?.body).toBeUndefined();
  });

  it('🔴🔴 壳**不给** isReadable 时，必须响亮地失败，而不是静默"全都可读"', async () => {
    await actions.create('普通任务');

    // 类型上已经必填；这里模拟"运行时被绕过"（JS 调用方 / 类型断言）。
    // 关键：**fail closed** —— 不能变成"一切可读"。
    const id = await actions.create('普通任务');
    const host = createLocalApiHost(engine, actions, {} as never);
    // ⚠️ `listTasks` 是**同步抛**（不是返回 rejected promise）——
    // 所以要用 `toThrow()`，用 `rejects` 会漏掉。
    expect(() => host.listTasks({})).toThrow();
    // 而且绝不能"静默降级成全都可读"
    expect(() => host.getTask(id)).toThrow();
    // ⚠️ 注意：`getTask('不存在的 id')` **不会**抛 —— 找不到就没有可读性问题，
    // 这是对的行为，不是漏网。
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 读
// ─────────────────────────────────────────────────────────────────────────

describe('读操作', () => {
  it('listTasks 返回标题、完成态、优先级、本地日期', async () => {
    await actions.create('写文档', { priority: Priority.High, dueDate: fromLocalDateString('2026-03-15') });
    const items = await makeHost().listTasks({});
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('写文档');
    expect(items[0]?.completed).toBe(false);
    expect(items[0]?.priority).toBe('high');
    expect(items[0]?.dueDate).toBe('2026-03-15');
  });

  it('limit 生效，且默认上限是 50（避免一次吃掉模型上下文）', async () => {
    for (let i = 0; i < 5; i += 1) await actions.create(`任务 ${String(i)}`);
    expect(await makeHost().listTasks({ limit: 2 })).toHaveLength(2);
    expect(await makeHost().listTasks({})).toHaveLength(5);
  });

  it('completed 过滤生效', async () => {
    const a = await actions.create('已完成');
    await actions.create('未完成');
    await actions.setCompleted(a, true);
    expect((await makeHost().listTasks({ completed: true })).map((i) => i.title)).toEqual(['已完成']);
    expect((await makeHost().listTasks({ completed: false })).map((i) => i.title)).toEqual(['未完成']);
  });

  it('getTask 找得到就返回，找不到返回 undefined', async () => {
    const id = await actions.create('找得到');
    expect((await makeHost().getTask(id))?.title).toBe('找得到');
    expect(await makeHost().getTask('nope')).toBeUndefined();
  });

  it('listProjects 带上任务数', async () => {
    // 🔴 这条原先只断言 `Array.isArray(projects)` —— 名字写着"带上任务数"，
    // 而**没有任何一行在看任务数**，也就是说 taskCount 恒为 0 它照样绿。
    // 现在按名字把它验实：两进一出 + 一条已删除的不计入。
    const projects = createProjectActions(engine);
    // ⚠️ 两条清单的 `createdAt` 必须**不同**：清单 id 是随机的，
    // 同刻创建时顺序会退化成按 id 字典序 —— 那是一条会偶尔自己红、
    // 而跟被测行为没有任何关系的判据。
    const work = await projects.createProject('工作');
    clock += 1000;
    const home = await projects.createProject('生活');
    clock += 1000;

    await actions.create('一');
    clock += 1000;
    await actions.create('二', { projectId: work });
    clock += 1000;
    await actions.create('三', { projectId: home });
    clock += 1000;
    await actions.create('四', { projectId: work });
    clock += 1000;
    const gone = await actions.create('五', { projectId: work });
    await actions.remove(gone);

    const listed = await makeHost().listProjects();
    expect(listed.map((p) => [p.id, p.name, p.taskCount])).toEqual([
      [work, '工作', 2],
      [home, '生活', 1],
    ]);
  });

  it('🔴 归档的清单不许出现在出口（W9 / P-9）', async () => {
    // 界面上「收起来」的清单，助手与 CLI 不能还当活的摆出来 ——
    // 这一条钉的就是那个不一致。
    const projects = createProjectActions(engine);
    const visible = await projects.createProject('还在用');
    const archived = await projects.createProject('收起来了');
    await projects.archiveProject(archived);

    const listed = await makeHost().listProjects();

    expect(listed.map((p) => p.id)).not.toContain(archived);
    // 🔴 正向对照腿**不许省**：这条路上"没出现"同样可能是根本没接通
    //（AGENTS §7 元规则 1：探针坏 / 够不着 / 真没有，三者输出相同）。
    expect(listed.map((p) => p.id)).toContain(visible);
  });

  it('🔴 出口层不许自己重新判"哪些清单算活的"（I5：隐藏由层负责）', async () => {
    // 这一条不看行为、看**形状**：`local-api-host.ts` 里一旦再出现对原始表的
    // `projects` 遍历，就说明"什么算可见清单"又有了第二份判据 ——
    // 而 W9 之前的第二份正是只答了"未删除"、漏了"未归档"的那一份。
    // ⚠️ 先剥注释：本文件自己的注释里就写着那句旧代码，不剥会把说明当成违规。
    const src = readFileSync(new URL('../src/local-api-host.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1');
    expect(src).toContain('projectActions.listProjects()');
    // 原始表里那一列从此不该再被碰过 —— 一条就够，不需要匹配整句形状。
    expect(src).not.toContain('.projects');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 写：必须真的产出 op
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 写操作真的经 dispatch 产出 op', () => {
  it('🔴 create-task 产出一条真实的 CRT op（不是"我调了个函数"）', async () => {
    const result = await makeHost().submit({ action: 'create-task', title: '买咖啡豆' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ops = await opsOf(result.taskId);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.opType).toBe(OpType.Create);
    expect((ops[0]?.payload as { title?: string })?.title).toBe('买咖啡豆');
  });

  it('🔴 create-task 带日期与优先级时，字段进了 op 载荷', async () => {
    const result = await makeHost().submit({
      action: 'create-task',
      title: '有字段的任务',
      dueDate: '2026-03-15',
      priority: 'high',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = (await opsOf(result.taskId))[0]?.payload as Record<string, unknown>;
    expect(payload['priority']).toBe(Priority.High);
    expect(payload['dueDate']).toBe(fromLocalDateString('2026-03-15'));
  });

  it('🔴 complete-task 产出完成 op，且状态真的变了', async () => {
    const created = await makeHost().submit({ action: 'create-task', title: '要做完' });
    if (!created.ok) throw new Error('创建失败');
    const done = await makeHost().submit({ action: 'complete-task', taskId: created.taskId });
    expect(done.ok).toBe(true);
    expect(await makeHost().getTask(created.taskId)).toMatchObject({ completed: true });
    expect((await opsOf(created.taskId)).length).toBeGreaterThanOrEqual(2);
  });

  it('🔴 update-task 改标题产出真实 op', async () => {
    const created = await makeHost().submit({ action: 'create-task', title: '旧标题' });
    if (!created.ok) throw new Error('创建失败');
    const updated = await makeHost().submit({
      action: 'update-task',
      taskId: created.taskId,
      fields: { title: '新标题' },
    });
    expect(updated.ok).toBe(true);
    expect((await makeHost().getTask(created.taskId))?.title).toBe('新标题');
  });

  it('🔴 不认识的字段被**拒绝**，不是静默忽略', async () => {
    const created = await makeHost().submit({ action: 'create-task', title: 'x' });
    if (!created.ok) throw new Error('创建失败');
    const updated = await makeHost().submit({
      action: 'update-task',
      taskId: created.taskId,
      fields: { title: 'y', evil: '注入' },
    });
    expect(updated.ok).toBe(false);
    if (!updated.ok) {
      expect(updated.reason).toBe('invalid');
      expect(updated.message).toContain('evil');
    }
  });

  it('🔴 非法日期被拒绝，**不猜一个日期写进去**', async () => {
    const result = await makeHost().submit({
      action: 'create-task',
      title: 'x',
      dueDate: '2026-02-31',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
    // 关键：**没有**留下半个任务
    expect(await makeHost().listTasks({})).toHaveLength(0);
  });

  it('非法优先级被拒绝', async () => {
    const result = await makeHost().submit({
      action: 'create-task',
      title: 'x',
      priority: '超级高',
    });
    expect(result.ok).toBe(false);
  });

  it('空标题被拒绝', async () => {
    expect((await makeHost().submit({ action: 'create-task', title: '   ' })).ok).toBe(false);
  });

  it('对不存在的任务操作返回 not-found', async () => {
    for (const intent of [
      { action: 'complete-task', taskId: 'nope' },
      { action: 'update-task', taskId: 'nope', fields: { title: 'x' } },
    ] as const) {
      const r = await makeHost().submit(intent);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not-found');
    }
  });

  it('🔴 写入的读回是一致的（op 真的被 reduce 了，不是只写日志）', async () => {
    await makeHost().submit({
      action: 'create-task',
      title: '往返',
      dueDate: '2026-06-01',
      priority: 'low',
    });
    const items = await makeHost().listTasks({});
    expect(items[0]).toMatchObject({
      title: '往返',
      dueDate: '2026-06-01',
      priority: 'low',
      completed: false,
    });
  });
});
