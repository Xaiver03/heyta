/**
 * 导出文档的契约
 * =================
 *
 * 这个文件守的是 `README.md` 设计原则第 5 条（**导出自由**）里最容易被做假的
 * 两件事：
 *
 *   1. **已删除的记录必须在导出里。** 一个悄悄丢掉墓碑的"备份"无法被完整还原，
 *      而且用户看不到自己丢了什么。这一条有专门的用例，并且做过变异验证：
 *      把墓碑过滤掉 → 断言变红。
 *   2. **导出必须能证明自己完整。** 计数（每类实体、op 总数）让用户/测试能核对
 *      "导全了"这句话，而不是只能相信。同样有变异验证：少导一类实体 → 变红。
 */

import { Priority } from '@heyta/domain';
import { MODELED_ENTITY_TYPES, emptyState, replayOperations } from '@heyta/op-log';
import type { MaterializedState } from '@heyta/op-log';
import { CURRENT_SCHEMA_VERSION, type EntityType } from '@heyta/shared-schema';
import { OpType, type Operation } from '@heyta/sync-core';
import { describe, expect, it } from 'vitest';

import {
  EXPORT_APP_NAME,
  EXPORT_FORMAT_VERSION,
  buildExportDocument,
  buildTaskExportRows,
  exportFileName,
  renderTasksMarkdown,
  serializeExportDocument,
  type TasksMarkdownCopy,
} from '../src/export-dump.js';

let opCounter = 0;

/** 造一条合法 op。id / 时钟都由计数器派生 —— 避免随机 id 造成 flaky（AGENTS.md #25）。 */
function makeOp(input: {
  entityType: EntityType;
  entityId: string;
  opType?: OpType;
  payload?: unknown;
  timestamp?: number;
}): Operation<string> {
  opCounter += 1;
  const opType = input.opType ?? OpType.Create;
  return {
    id: `op-${String(opCounter).padStart(4, '0')}`,
    opType,
    actionType: `${opType}_${input.entityType}`,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: input.payload ?? {},
    clientId: 'test-client',
    vectorClock: { 'test-client': opCounter },
    timestamp: input.timestamp ?? opCounter,
    schemaVersion: 1,
  };
}

function stateFrom(ops: readonly Operation<string>[]): MaterializedState {
  return replayOperations(emptyState(), ops);
}

const EXPORTED_AT = 1_800_000_000_000;

describe('buildExportDocument', () => {
  it('文档是自描述的：格式版本、应用标识、时间、schema 版本都在', () => {
    const doc = buildExportDocument({ state: emptyState(), ops: [], exportedAt: EXPORTED_AT });

    expect(doc.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    // 🔴 导出格式自己的版本与 op schema 版本是两个字段，不能合并成一个数字。
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.app.name).toBe(EXPORT_APP_NAME);
    expect(doc.app.host).toBeUndefined();
    expect(doc.exportedAt).toBe(new Date(EXPORTED_AT).toISOString());
    expect(doc.opLog).toEqual([]);
    expect(doc.counts.totalOps).toBe(0);
    expect(doc.counts.totalEntities).toBe(0);
  });

  it('可带宿主名（诊断用）', () => {
    const doc = buildExportDocument({
      state: emptyState(),
      ops: [],
      exportedAt: EXPORTED_AT,
      host: 'web',
    });
    expect(doc.app).toEqual({ name: EXPORT_APP_NAME, host: 'web' });
  });

  it('🔴 包含已删除（墓碑）记录 —— 丢掉它们的"备份"无法完整还原', () => {
    const create = makeOp({
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { title: '会被删掉的任务' },
    });
    const remove = makeOp({ entityType: 'TASK', entityId: 'task-1', opType: OpType.Delete });
    // 另有一条活着，用来证明墓碑是"额外包含"而不是"全都当墓碑"。
    const keep = makeOp({ entityType: 'TASK', entityId: 'task-2', payload: { title: '留着' } });
    const ops = [create, remove, keep];
    const state = stateFrom(ops);

    const doc = buildExportDocument({ state, ops, exportedAt: EXPORTED_AT });

    const exported = doc.entities['TASK'] as Array<Record<string, unknown>>;
    expect(exported).toHaveLength(2);

    const tombstone = exported.find((row) => row['id'] === 'task-1');
    expect(tombstone).toBeDefined();
    expect(tombstone?.['deletedAt']).toBeTypeOf('number');

    expect(doc.counts.entities['TASK']).toEqual({ total: 2, deleted: 1 });
    expect(doc.counts.totalDeleted).toBe(1);
    expect(doc.counts.totalEntities).toBe(2);
  });

  it('op-log 完整：全部 op 都在，计数与数组长度自洽', () => {
    const ops = [
      makeOp({ entityType: 'TASK', entityId: 'task-1', payload: { title: 'a' } }),
      makeOp({
        entityType: 'TASK',
        entityId: 'task-1',
        opType: OpType.Update,
        payload: { title: 'b' },
      }),
      makeOp({ entityType: 'PROJECT', entityId: 'project-1', payload: { name: 'p' } }),
      makeOp({ entityType: 'TAG', entityId: 'tag-1', payload: { name: 't' } }),
    ];
    const doc = buildExportDocument({ state: stateFrom(ops), ops, exportedAt: EXPORTED_AT });

    expect(doc.opLog).toHaveLength(ops.length);
    expect(doc.counts.totalOps).toBe(ops.length);
    expect(doc.counts.opsByEntityType).toEqual({ PROJECT: 1, TAG: 1, TASK: 2 });

    // 计数必须能与数组核对 —— 否则"导全了"只能靠信。
    const summed = Object.values(doc.counts.entities).reduce((sum, c) => sum + c.total, 0);
    const deleted = Object.values(doc.counts.entities).reduce((sum, c) => sum + c.deleted, 0);
    const opSum = Object.values(doc.counts.opsByEntityType).reduce((sum, n) => sum + n, 0);
    expect(summed).toBe(doc.counts.totalEntities);
    expect(deleted).toBe(doc.counts.totalDeleted);
    expect(opSum).toBe(doc.counts.totalOps);
  });

  it('🔴 覆盖每一个被物化的实体类型 —— 少导一类就必须能被发现', () => {
    // 每一类都放一条：只要导出漏掉某一类，下面的循环立刻红。
    const ops = MODELED_ENTITY_TYPES.map((entityType, index) =>
      makeOp({ entityType: entityType as EntityType, entityId: `entity-${String(index)}` }),
    );
    const doc = buildExportDocument({ state: stateFrom(ops), ops, exportedAt: EXPORTED_AT });

    for (const entityType of MODELED_ENTITY_TYPES) {
      expect(Object.keys(doc.entities)).toContain(entityType);
      expect(doc.counts.entities[entityType]?.total).toBe(1);
    }
    expect(doc.counts.totalEntities).toBe(MODELED_ENTITY_TYPES.length);
  });

  it('序列化是确定性的：同样的数据逐字节相同（key 顺序 / 输入顺序都无关）', () => {
    const create = makeOp({
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { title: 'a', dueDate: 123 },
    });
    const second = makeOp({
      entityType: 'TAG',
      entityId: 'tag-1',
      payload: { name: 't', color: '#fff' },
    });

    const forward = buildExportDocument({
      state: stateFrom([create, second]),
      ops: [create, second],
      exportedAt: EXPORTED_AT,
    });
    // op 输入顺序反过来 —— 序列化结果必须一致。
    const backward = buildExportDocument({
      state: stateFrom([create, second]),
      ops: [second, create],
      exportedAt: EXPORTED_AT,
    });
    expect(serializeExportDocument(backward)).toBe(serializeExportDocument(forward));

    // payload 的 key 顺序不同 —— 同一条 op 的字段其余全同，只有 key 顺序变了。
    const reordered: Operation<string> = {
      ...create,
      payload: { dueDate: 123, title: 'a' },
    };
    const shuffled = buildExportDocument({
      state: stateFrom([reordered, second]),
      ops: [reordered, second],
      exportedAt: EXPORTED_AT,
    });
    expect(serializeExportDocument(shuffled)).toBe(serializeExportDocument(forward));
  });
});

describe('buildTaskExportRows / renderTasksMarkdown（人能直接看的那一份）', () => {
  const create = makeOp({
    entityType: 'TASK',
    entityId: 'task-1',
    payload: { title: '写报告', priority: Priority.High, dueDate: 1_700_000_000_000 },
  });
  const remove = makeOp({ entityType: 'TASK', entityId: 'task-1', opType: OpType.Delete });
  const ops = [create, remove];

  it('🔴 人类可读清单**不含**墓碑（与完整保真那一份刻意相反）', () => {
    const state = stateFrom(ops);
    expect(state.tasks['task-1']?.['deletedAt']).toBeTypeOf('number');

    // 完整保真那份带着墓碑……
    const doc = buildExportDocument({ state, ops, exportedAt: EXPORTED_AT });
    expect(doc.entities['TASK']).toHaveLength(1);
    expect(doc.counts.totalDeleted).toBe(1);

    // ……给人看的这份不带（一个人不想在清单里看到已删任务）。
    expect(buildTaskExportRows(state)).toEqual([]);
  });

  it('解析清单名与标签名，并按创建时间排序', () => {
    const build = [
      makeOp({ entityType: 'PROJECT', entityId: 'p1', payload: { name: '工作' } }),
      makeOp({ entityType: 'TAG', entityId: 't1', payload: { name: '紧急' } }),
      // ⚠️ 顺序刻意如此：`createdAt` 来自各条 op 的时间戳，
      // 所以"第一"必须先被创建，排序断言才有确定含义（否则测的是巧合）。
      makeOp({ entityType: 'TASK', entityId: 'task-a', payload: { title: '第一' } }),
      makeOp({
        entityType: 'TASK',
        entityId: 'task-b',
        payload: { title: '第二', projectId: 'p1', tagIds: ['t1'], priority: Priority.Low },
      }),
    ];
    const rows = buildTaskExportRows(stateFrom(build));

    expect(rows.map((r) => r.title)).toEqual(['第一', '第二']);
    expect(rows[1]?.projectName).toBe('工作');
    expect(rows[1]?.tagNames).toEqual(['紧急']);
    expect(rows[1]?.priority).toBe(Priority.Low);
  });

  const copy: TasksMarkdownCopy = {
    heading: '# 任务清单',
    generatedAt: '导出时间：{at}',
    empty: '（没有任务）',
    open: '未完成',
    done: '已完成',
    none: '—',
    footer: '这是导出文件。',
    columns: {
      title: '标题',
      status: '状态',
      due: '截止',
      priority: '优先级',
      project: '清单',
      tags: '标签',
    },
    priorityLabel: (priority) => String(priority),
  };

  it('渲染成 Markdown 表格，并转义单元格里的竖线', () => {
    const build = [
      makeOp({ entityType: 'TASK', entityId: 'task-1', payload: { title: 'a|b' } }),
    ];
    const text = renderTasksMarkdown(
      buildTaskExportRows(stateFrom(build)),
      copy,
      '2026-01-01T00:00:00.000Z',
    );

    expect(text).toContain('# 任务清单');
    expect(text).toContain('导出时间：2026-01-01T00:00:00.000Z');
    expect(text).toContain('| 标题 | 状态 |');
    expect(text).toContain('a\\|b');
    expect(text).toContain('> 这是导出文件。');
  });

  it('空清单走诚实的空状态，而不是留一个空表', () => {
    const text = renderTasksMarkdown([], copy, '2026-01-01T00:00:00.000Z');
    expect(text).toContain('（没有任务）');
    expect(text).not.toContain('| --- |');
  });

  it('🔴 时刻不丢：有时刻的那格带 HH:MM，没时刻的一格都不多写', () => {
    // 用**本地**时钟构造（`new Date(y, m, d, h, mi)` 就是本地那一时刻），
    // 所以期望值与运行时区无关，也不是从被测函数推出来的。
    const timed = makeOp({
      entityType: 'TASK',
      entityId: 'task-timed',
      payload: { title: '接孩子', dueDate: new Date(2026, 2, 15, 16, 0, 0, 0).getTime() },
    });
    const allDay = makeOp({
      entityType: 'TASK',
      entityId: 'task-allday',
      payload: { title: '交房租', dueDate: new Date(2026, 2, 16, 0, 0, 0, 0).getTime() },
    });
    const rows = buildTaskExportRows(stateFrom([timed, allDay]));
    const timedRow = rows[0]!;
    const allDayRow = rows[1]!;
    // 先钉住"索引 == 这一条"的前提，否则下面的断言可能在比错的对象。
    expect([timedRow.title, allDayRow.title]).toEqual(['接孩子', '交房租']);

    expect(timedRow.dueDate).toBe('2026-03-15');
    expect(timedRow.dueTime).toBe('16:00');
    expect(allDayRow.dueDate).toBe('2026-03-16');
    // "只到日"落成**键缺席**而不是空串：空串会让两种情况走同一条渲染分支，
    // 于是"丢了时刻"和"本来就没时刻"在清单里长得一样 —— 那就是静默有损。
    expect(Object.hasOwn(allDayRow, 'dueTime')).toBe(false);

    const text = renderTasksMarkdown(rows, copy, '2026-01-01T00:00:00.000Z');
    expect(text).toContain('| 接孩子 | 未完成 | 2026-03-15 16:00 |');
    expect(text).toContain('| 交房租 | 未完成 | 2026-03-16 |');
    expect(text).not.toContain('2026-03-16 00:00');

    // 表的形状没变（本批改的是单元格内容，不是列数）。
    for (const line of text.split('\n').filter((l) => l.startsWith('| '))) {
      expect((line.match(/\|/g) ?? []).length, line).toBe(7);
    }
  });
});

describe('exportFileName', () => {
  it('给 json / md 两个格式稳定命名', () => {
    const at = Date.UTC(2026, 0, 2, 3, 4, 5);
    expect(exportFileName('json', at)).toBe('heyta-export-2026-01-02T03-04-05-000Z.json');
    expect(exportFileName('markdown', at)).toBe('heyta-export-2026-01-02T03-04-05-000Z.md');
  });
});
