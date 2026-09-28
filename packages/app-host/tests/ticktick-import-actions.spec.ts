/**
 * 滴答导入「计划 → op 批次」构造器 —— 判据
 * ============================================
 *
 * 真实引擎 + 真实 SQLite（`:memory:`），与 `project-actions.spec.ts` 同一个取舍：
 * 要证明的是"这批 op 真的写进去了、真的可同步"，假探针只能证明"我调了 dispatch"。
 *
 * 本文件钉四条判据，每条都做过**故障注入**（改实现一处 → 看到红 → 改回；
 * 逐条真实输出见 `docs/plans/site-and-parity-alignment.md` 第十三轮）：
 *
 *   1. **引用完整性顺序**：清单 / 标签先于任务；清单内父先于子。
 *      顺序错了**不会报错** —— reducer 不校验跨实体引用 ——
 *      只会产生"挂着一个查不到的清单/标签"的孤儿任务。
 *   2. **幂等**：稳定 id 已存在就不构造 op。同一份文件导两次，第二次 `opCount === 0`。
 *   3. **不静默丢数据**：domain 的 `report` 原样交回（同一引用），派发前先验引用。
 *   4. **特殊字符**：标题里的逗号 / 换行 / emoji 原样落库，不被截断或转义坏。
 */

import {
  Priority,
  TICKTICK_COLUMNS,
  TICKTICK_IMPORT_ID_NAMESPACE,
  dueDateToEpoch,
  parseTickTickCsv,
  stableTickTickId,
  tickTickProjectSourceKey,
  toLocalDate,
  type TickTickImportPlan,
  type TickTickImportReport,
} from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions } from '../src/actions.js';
import {
  TICKTICK_IMPORT_ORDER,
  createTickTickImportActions,
  planTickTickImportBatch,
  tickTickTaskPayload,
  type TickTickImportActions,
} from '../src/ticktick-import-actions.js';

/** 固定导入时刻：domain 不许读时钟，所有「现在」都由调用方注入。 */
const NOW = new Date(2026, 0, 1, 12, 0, 0).getTime();

// ── 夹具 ─────────────────────────────────────────────────────

const HEADER: readonly string[] = Object.values(TICKTICK_COLUMNS);
type RowSpec = Partial<Record<string, string>>;

/** 最小 CSV 序列化：含 `,` / `"` / 换行的字段加引号，`"` 翻倍。 */
function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(rows: readonly RowSpec[]): string {
  const lines = [HEADER.map(cell).join(',')];
  for (const row of rows) {
    lines.push(HEADER.map((column) => cell(row[column] ?? '')).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** 🔴 标题里带**逗号 + 换行 + emoji** —— 第 4 条判据的夹具。 */
const SPECIAL_TITLE = 'Buy milk, eggs\nand 🎉 celebrate';

/**
 * 夹具行：
 *   - row1 文件夹 + 清单下的任务：特殊字符标题、两个标签、备注、优先级 5、
 *     日期型截止、有 `taskId`。
 *   - row2 同一清单里的第二条（触发"清单只建一次、被两条任务引用"）。
 *   - row3 收件箱任务：提醒（无归宿 → 进报告）、已完成、重复规则。
 *   - row4 没有 `taskId` → 报告里必须有 `missingSourceId`。
 */
const ROWS: readonly RowSpec[] = [
  {
    'Folder Name': 'Work',
    'List Name': 'Projects',
    Title: SPECIAL_TITLE,
    Tags: 'Work, urgent, 🎉party',
    Content: 'line one, with comma',
    'Due Date': '2026-03-02',
    'Is All Day': 'Y',
    Priority: '5',
    Status: '0',
    'Created Time': '2026-01-02T03:04:05+0000',
    Order: '0',
    taskId: 't-ship',
  },
  {
    'Folder Name': 'Work',
    'List Name': 'Projects',
    Title: 'Second task in same list',
    Priority: '0',
    Status: '0',
    Order: '1',
    taskId: 't-second',
  },
  {
    'List Name': 'Personal',
    Title: 'Reminder task',
    Tags: 'Home',
    'Due Date': '2026-03-02T09:30:00+0800',
    Reminder: 'TRIGGER:-PT30M',
    Repeat: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
    Priority: '3',
    Status: '1',
    'Completed Time': '2026-01-06T00:00:00+0000',
    taskId: 't-reminder',
  },
  {
    'List Name': 'Personal',
    Title: 'Row without taskId',
    Priority: '0',
    Status: '0',
  },
];

const FIXTURE = toCsv(ROWS);

function parseFixture(): {
  plan: TickTickImportPlan;
  report: TickTickImportReport;
} {
  const result = parseTickTickCsv(FIXTURE, { now: NOW });
  if (!result.ok) throw new Error(`夹具应当解析成功，实际失败：${result.reason}`);
  return { plan: result.plan, report: result.report };
}

/** 从计划里按标题找任务 draft（找不到就炸，避免测试静默通过）。 */
function taskDraft(plan: TickTickImportPlan, title: string) {
  const draft = plan.tasks.find((task) => task.title === title);
  if (draft === undefined) throw new Error(`计划里没有标题为「${title}」的任务`);
  return draft;
}

function projectIdOf(plan: TickTickImportPlan, name: string): string {
  const draft = plan.projects.find((project) => project.name === name);
  if (draft === undefined) throw new Error(`计划里没有名为「${name}」的清单`);
  return draft.id;
}

// ── 引擎夹具 ─────────────────────────────────────────────────

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TickTickImportActions;

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-ticktick',
    now: () => NOW,
  });
  actions = createTickTickImportActions(engine);
});

afterEach(() => {
  adapter.close();
});

// ── 1. 顺序与引用完整性 ──────────────────────────────────────

describe('🔴 引用完整性：清单 / 标签必须先于任务', () => {
  it('批次顺序由 TICKTICK_IMPORT_ORDER 决定，不依赖 plan 的字段顺序', () => {
    const { plan } = parseFixture();
    const batch = planTickTickImportBatch(plan, engine.getState());

    const kinds = batch.entries.map((entry) => entry.kind);
    // 每一类都真的出现（否则下面的顺序断言可能是空集上的恒真）。
    expect(kinds.filter((k) => k === 'project')).toHaveLength(plan.projects.length);
    expect(kinds.filter((k) => k === 'tag')).toHaveLength(plan.tags.length);
    expect(kinds.filter((k) => k === 'task')).toHaveLength(plan.tasks.length);

    // 最后一个 project 必须排在第一个 tag 之前，最后一个 tag 排在第一个 task 之前。
    const lastProject = kinds.lastIndexOf('project');
    const firstTag = kinds.indexOf('tag');
    const lastTag = kinds.lastIndexOf('tag');
    const firstTask = kinds.indexOf('task');
    expect(lastProject).toBeLessThan(firstTag);
    expect(lastTag).toBeLessThan(firstTask);

    // 顺序常量本身是承重的：拼接结果必须与它逐类一致。
    expect(kinds).toEqual(
      TICKTICK_IMPORT_ORDER.flatMap((kind) => kinds.filter((k) => k === kind)),
    );
  });

  it('每个任务 op 都排在其引用的清单 / 标签 op **之后**（不依赖顺序常量）', () => {
    const { plan } = parseFixture();
    const batch = planTickTickImportBatch(plan, engine.getState());
    const at = new Map(batch.entries.map((entry, index) => [entry.entityId, index]));

    let checkedRefs = 0;
    batch.entries.forEach((entry, index) => {
      const payload = entry.intent.payload as Record<string, unknown>;
      if (entry.kind === 'task') {
        if (typeof payload.projectId === 'string') {
          expect(at.get(payload.projectId)).toBeLessThan(index);
          checkedRefs += 1;
        }
        for (const tagId of (payload.tagIds as string[] | undefined) ?? []) {
          expect(at.get(tagId)).toBeLessThan(index);
          checkedRefs += 1;
        }
      }
      if (entry.kind === 'project' && typeof payload.parentId === 'string') {
        expect(at.get(payload.parentId)).toBeLessThan(index);
        checkedRefs += 1;
      }
    });
    // 非空性：夹具真的产生了被检查的引用，而不是一个都没走到。
    expect(checkedRefs).toBeGreaterThan(0);
  });

  it('清单内部**父先于子** —— 即使计划把子清单排在前面', () => {
    const folderId = 'p-folder';
    const childId = 'p-child';
    const handMade: TickTickImportPlan = {
      // 故意逆序：子在前、父在后。
      projects: [
        { id: childId, name: '子清单', parentId: folderId, sourceKey: 'c', order: 1 },
        { id: folderId, name: '文件夹', sourceKey: 'f', order: 0 },
      ],
      tags: [],
      tasks: [],
    };

    const batch = planTickTickImportBatch(handMade, engine.getState());
    const emitted = batch.entries.filter((e) => e.kind === 'project').map((e) => e.entityId);
    expect(emitted).toEqual([folderId, childId]);
  });

  it('导入后每个任务引用的清单 / 标签都真的存在（不是孤儿）', async () => {
    const { plan, report } = parseFixture();
    await actions.importPlan(plan, report);

    const state = engine.getState();
    const tasks = Object.values(state.tasks);
    // 先证明夹具非空：至少一条带 projectId、至少一条带 tagIds。
    expect(tasks.some((task) => task.projectId !== undefined)).toBe(true);
    expect(tasks.some((task) => (task.tagIds ?? []).length > 0)).toBe(true);

    for (const task of tasks) {
      if (task.projectId !== undefined) {
        expect(Object.keys(state.projects)).toContain(task.projectId);
      }
      for (const tagId of task.tagIds ?? []) {
        expect(Object.keys(state.tags)).toContain(tagId);
      }
    }
  });

  it('任务引用一个不存在（且不在本批）的清单 → 构造批次就抛错', () => {
    const orphan: TickTickImportPlan = {
      projects: [],
      tags: [],
      tasks: [
        {
          id: 'tt1-task-orphan',
          title: '孤儿任务',
          projectId: 'project-从未存在',
          sourceKey: 'x',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    };

    expect(() => planTickTickImportBatch(orphan, engine.getState())).toThrow(/不存在的清单/);
  });

  it('名下没有目标的标签 id → 也抛错', () => {
    const orphan: TickTickImportPlan = {
      projects: [],
      tags: [],
      tasks: [
        {
          id: 'tt1-task-orphan',
          title: '孤儿任务',
          tagIds: ['tag-从未存在'],
          sourceKey: 'x',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    };

    expect(() => planTickTickImportBatch(orphan, engine.getState())).toThrow(/不存在的标签/);
  });

  it('🔴 引用校验失败时**一个 op 都不写**（不会留下半截状态）', async () => {
    const { report } = parseFixture();
    const orphan: TickTickImportPlan = {
      projects: [],
      tags: [],
      tasks: [
        {
          id: 'tt1-task-orphan',
          title: '孤儿任务',
          projectId: 'project-从未存在',
          sourceKey: 'x',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    };

    await expect(actions.importPlan(orphan, report)).rejects.toThrow(/不存在的清单/);
    expect(await engine.getPendingUpload()).toHaveLength(0);
    expect(Object.keys(engine.getState().tasks)).toHaveLength(0);
  });

  it('previewPlan 只读不写 —— 预览一次之后库里还是空的', () => {
    const { plan } = parseFixture();
    const batch = actions.previewPlan(plan);
    expect(batch.entries.length).toBeGreaterThan(0);
    expect(Object.keys(engine.getState().projects)).toHaveLength(0);
    expect(Object.keys(engine.getState().tasks)).toHaveLength(0);
  });
});

// ── 2. 幂等 ──────────────────────────────────────────────────

describe('🔴 幂等：同一份文件导两次，第二次不产生任何 op', () => {
  it('第二次 opCount === 0、added 全 0、skipped 等于总数、实体数不变', async () => {
    const { plan, report } = parseFixture();
    const total = plan.projects.length + plan.tags.length + plan.tasks.length;

    const first = await actions.importPlan(plan, report);
    expect(first.opCount).toBe(total);
    expect(first.added).toEqual({
      projects: plan.projects.length,
      tags: plan.tags.length,
      tasks: plan.tasks.length,
    });

    const uploadsAfterFirst = (await engine.getPendingUpload()).length;
    const entitiesAfterFirst =
      Object.keys(engine.getState().projects).length +
      Object.keys(engine.getState().tags).length +
      Object.keys(engine.getState().tasks).length;

    const second = await actions.importPlan(plan, report);
    expect(second.opCount).toBe(0);
    expect(second.added).toEqual({ projects: 0, tags: 0, tasks: 0 });
    expect(second.skipped).toEqual({
      projects: plan.projects.length,
      tags: plan.tags.length,
      tasks: plan.tasks.length,
    });
    // op 层判据：没有新 op 落盘。
    expect((await engine.getPendingUpload()).length).toBe(uploadsAfterFirst);
    // 实体层判据：没有新实体。
    expect(
      Object.keys(engine.getState().projects).length +
        Object.keys(engine.getState().tags).length +
        Object.keys(engine.getState().tasks).length,
    ).toBe(entitiesAfterFirst);
  });

  it('稳定 id 是幂等的唯一依据：id 由 domain 派生，构造器不另生成', async () => {
    const { plan, report } = parseFixture();
    const first = await actions.importPlan(plan, report);

    // 写进去的实体 id 必须**逐字**等于计划里的稳定 id。
    for (const draft of plan.projects) {
      expect(Object.keys(engine.getState().projects)).toContain(draft.id);
    }
    for (const draft of plan.tasks) {
      expect(Object.keys(engine.getState().tasks)).toContain(draft.id);
    }
    // 而且它们确实是 domain 的 stableTickTickId 形状（不是构造器自造的时间戳 id）。
    const shipId = taskDraft(plan, SPECIAL_TITLE).id;
    expect(first.plan.tasks.map((t) => t.id)).toContain(shipId);
    expect(shipId).toMatch(/^tt1-task-[0-9a-f]{16}$/);
  });

  it('🔴 已软删除的 id 也算"已存在" —— 再导一次**不复活**用户的删除', async () => {
    const { plan, report } = parseFixture();
    await actions.importPlan(plan, report);

    const ship = engine.getState().tasks[taskDraft(plan, SPECIAL_TITLE).id];
    expect(ship).toBeDefined();
    const shipId = ship!.id;

    const tasks = createTaskActions(engine, { now: () => NOW });
    await tasks.remove(shipId);
    expect(engine.getState().tasks[shipId]?.deletedAt).toBeDefined();

    const second = await actions.importPlan(plan, report);
    expect(second.opCount).toBe(0);
    // 墓碑还在：跳过而不是复活。
    expect(engine.getState().tasks[shipId]?.deletedAt).toBeDefined();
  });
});

// ── 3. 报告原样交回 ─────────────────────────────────────────

describe('🔴 不静默丢数据：report 原样交回', () => {
  it('返回的是**同一个 report 对象**（`toBe`），不是复制品', async () => {
    const { plan, report } = parseFixture();
    const result = await actions.importPlan(plan, report);
    expect(result.report).toBe(report);
  });

  it('report.unmapped 的原值一个都不少（提醒 / 缺 taskId）', async () => {
    const { plan, report } = parseFixture();
    // 夹具必须真的产出"没有归宿"的东西，否则下面是无意义的断言。
    expect(report.unmapped.length).toBeGreaterThan(0);
    expect(report.unmapped.some((entry) => entry.field === 'reminder')).toBe(true);
    expect(report.unmapped.some((entry) => entry.field === 'missingSourceId')).toBe(true);

    const before = JSON.stringify(report);
    const result = await actions.importPlan(plan, report);
    // 既原样返回，也**没有被 importPlan 改写**。
    expect(JSON.stringify(result.report)).toBe(before);
    expect(result.report.unmapped).toEqual(report.unmapped);
  });

  it('contains 守恒律在导入后仍然成立（报告没被吞掉一半）', async () => {
    const { plan, report } = parseFixture();
    await actions.importPlan(plan, report);
    expect(report.dataRows).toBe(report.tasks + report.skipped.length);
  });
});

// ── 4. 特殊字符 ─────────────────────────────────────────────

describe('🔴 中文 / 逗号 / 换行 / emoji 原样落库', () => {
  it('标题里的逗号、换行、emoji 一个字符都不少', async () => {
    const { plan, report } = parseFixture();
    await actions.importPlan(plan, report);

    const shipId = taskDraft(plan, SPECIAL_TITLE).id;
    const task = engine.getState().tasks[shipId];
    expect(task).toBeDefined();
    expect(task!.title).toBe(SPECIAL_TITLE);
    // 逐项再核一次：逗号没被当分隔符、换行没被吃掉、emoji 没被转义坏。
    expect(task!.title).toContain(',');
    expect(task!.title).toContain('\n');
    expect(task!.title).toContain('🎉');
  });

  it('备注里的逗号也原样保留；emoji 标签名可正常引用', async () => {
    const { plan, report } = parseFixture();
    await actions.importPlan(plan, report);

    const ship = engine.getState().tasks[taskDraft(plan, SPECIAL_TITLE).id];
    expect(ship?.note).toBe('line one, with comma');

    // emoji 标签：domain 解析出名字，构造器建出实体，任务引用得到。
    const party = Object.values(engine.getState().tags).find((tag) => tag.name === '🎉party');
    expect(party).toBeDefined();
    expect(ship?.tagIds).toContain(party!.id);
  });

  it('`tickTickTaskPayload` 不 trim / 不截断标题（纯函数判据）', () => {
    const payload = tickTickTaskPayload({
      id: 'tt1-task-x',
      title: SPECIAL_TITLE,
      sourceKey: 'x',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(payload.title).toBe(SPECIAL_TITLE);
  });
});

// ── 5. 字段落点 + 与既有动作家族一致 ────────────────────────

describe('字段落点', () => {
  it('任务 draft 的字段逐个落到实体上', async () => {
    const { plan, report } = parseFixture();
    await actions.importPlan(plan, report);

    const state = engine.getState();
    const shipDraft = taskDraft(plan, SPECIAL_TITLE);
    const ship = state.tasks[shipDraft.id]!;

    expect(ship.title).toBe(SPECIAL_TITLE);
    expect(ship.priority).toBe(Priority.High);
    expect(ship.note).toBe('line one, with comma');
    expect(ship.dueDate).toBe(dueDateToEpoch('2026-03-02'));
    expect(ship.order).toBe(0);
    expect(ship.projectId).toBe(projectIdOf(plan, 'Projects'));
    expect(ship.tagIds).toHaveLength(3);

    const reminderDraft = taskDraft(plan, 'Reminder task');
    const reminder = state.tasks[reminderDraft.id]!;
    // 已完成的唯一信号（heyta 用 `completedAt` 的有无）。
    expect(typeof reminder.completedAt).toBe('number');
    // `RRULE:` 前缀由 domain 剥掉，构造器只搬运。
    expect(reminder.repeatRule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(reminder.repeatDtstart).toBe(toLocalDate(reminder.dueDate!));
  });

  it('清单 / 标签的载荷与 `createProjectActions` 形状一致', async () => {
    const { plan, report } = parseFixture();
    await actions.importPlan(plan, report);

    const state = engine.getState();
    const folder = state.projects[projectIdOf(plan, 'Work')]!;
    const list = state.projects[projectIdOf(plan, 'Projects')]!;

    expect(folder.name).toBe('Work');
    expect(folder.parentId).toBeUndefined();
    // 子清单指向文件夹 —— 引用完整性在**实体层**也成立。
    expect(list.parentId).toBe(folder.id);
    expect(Object.values(state.tags).map((tag) => tag.name).sort()).toEqual(
      ['Home', 'Work', 'urgent', '🎉party'].sort(),
    );
  });

  it('与 `createTaskActions.create` 的共享字段落点一致（防两份语义漂移）', async () => {
    const { plan, report } = parseFixture();
    await actions.importPlan(plan, report);

    const manualId = 'task-manual-parity';
    const tasks = createTaskActions(engine, { now: () => NOW, newTaskId: () => manualId });
    const importedProjectId = projectIdOf(plan, 'Projects');
    await tasks.create('Manual', {
      priority: Priority.High,
      dueDate: dueDateToEpoch('2026-03-02'),
      projectId: importedProjectId,
      note: 'n',
    });

    const state = engine.getState();
    const manual = state.tasks[manualId]!;
    const ship = state.tasks[taskDraft(plan, SPECIAL_TITLE).id]!;

    // 同一批产品语义：优先级是离散值、清单 id 直接引用、同一约定算出的截止日。
    expect(ship.priority).toBe(manual.priority);
    expect(ship.projectId).toBe(manual.projectId);
    expect(ship.dueDate).toBe(manual.dueDate);

    // 🔴 备注字段名两边都是 **`note`（单数）**，且 `notes` 这个错名一个都没留下 ——
    // 这正是 `actions.ts` 文件头记的那次事故（数据同步到了每台设备，
    // 却没有任何视图读得到）。
    expect(manual.note).toBe('n');
    expect(ship.note).toBe('line one, with comma');
    expect((manual as unknown as Record<string, unknown>).notes).toBeUndefined();
    expect((ship as unknown as Record<string, unknown>).notes).toBeUndefined();
  });

  it('没给的字段**不放键**，而不是写 `undefined` / `null`', () => {
    const payload = tickTickTaskPayload({
      id: 'tt1-task-min',
      title: '只有标题',
      sourceKey: 'x',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(payload).toEqual({ title: '只有标题', priority: Priority.None });
    expect('note' in payload).toBe(false);
    expect('completedAt' in payload).toBe(false);
    expect('tagIds' in payload).toBe(false);
  });
});

// ── 6. 不吞异常 ─────────────────────────────────────────────

describe('🔴 派发失败必须原样抛出', () => {
  it('引擎抛错 → importPlan rejects（不许吞掉后返回"成功"）', async () => {
    const { plan, report } = parseFixture();
    const failing = createTickTickImportActions({
      dispatch: () => Promise.reject(new Error('引擎挂了')),
      getState: () => engine.getState(),
    });

    await expect(failing.importPlan(plan, report)).rejects.toThrow('引擎挂了');
  });
});

// ── 7. 反静默丢弃：另一台设备真的能物化 ─────────────────────

describe('🔴 反静默丢弃：另一台设备真的能物化整批导入', () => {
  it('A 导入 → B 应用远端 → B 上清单 / 标签 / 任务都在，引用也能解析', async () => {
    const adapterB = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(':memory:'),
    });
    await adapterB.init();
    const engineB = new OpLogEngine({
      store: new DbOpLogStore<Operation<string>>(adapterB),
      clientId: 'client-ticktick-other',
      now: () => NOW,
    });

    const { plan, report } = parseFixture();
    const result = await actions.importPlan(plan, report);
    expect(result.opCount).toBeGreaterThan(0);

    const pending = await engine.getPendingUpload();
    const applied = await engineB.applyRemote(pending);
    expect(applied.applied).toHaveLength(pending.length);

    const stateB = engineB.getState();
    expect(Object.keys(stateB.projects)).toHaveLength(plan.projects.length);
    expect(Object.keys(stateB.tags)).toHaveLength(plan.tags.length);
    expect(Object.keys(stateB.tasks)).toHaveLength(plan.tasks.length);

    const shipOnB = stateB.tasks[taskDraft(plan, SPECIAL_TITLE).id]!;
    expect(shipOnB.title).toBe(SPECIAL_TITLE);
    const shipProjectId = shipOnB.projectId;
    expect(shipProjectId).toBeDefined();
    expect(stateB.projects[shipProjectId as string]).toBeDefined();
    for (const tagId of shipOnB.tagIds ?? []) {
      expect(stateB.tags[tagId]).toBeDefined();
    }

    adapterB.close();
  });

  it('稳定 id 与 domain 的派生规则逐字一致（跨端不会算出不同 id）', () => {
    const { plan } = parseFixture();
    const expected = stableTickTickId(
      TICKTICK_IMPORT_ID_NAMESPACE,
      'project',
      tickTickProjectSourceKey('Work', 'Projects'),
    );
    expect(projectIdOf(plan, 'Projects')).toBe(expected);
  });
});
