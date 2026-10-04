/**
 * 导入 / 还原的契约
 * ===================
 *
 * 这个文件守四件事，每一件都是"错了会静默出坏结果"的那种：
 *
 *   1. **墓碑必须活着回来。** 导出里含墓碑是故意的（`export-dump.ts` 文件头）。
 *      丢掉墓碑的还原会让已删数据**复活** —— 而用户会以为删除是可靠的。
 *      所以有一条用例专门断言：还原之后，被删的那条仍然是墓碑。
 *   2. **只还原到空库，且绝不动现有数据。** 目标已有 op 时必须拒绝，
 *      并且**一个字节都不能写**。这不是靠界面拦，是靠 `restoreIntoEmptyTarget` 拦。
 *   3. **时钟不能回退。** 导入的 op 带着别的设备的向量时钟；本机接下来的写入
 *      必须因果上压过它们，否则 reducer 的写入闸门会**静默丢弃**用户的编辑。
 *      用例刻意把导出时间戳放到未来，好让"没有并时钟"这个变异真的变红。
 *   4. **文档自相矛盾时先拒绝、不写。** 重放 op-log 得不到它自己声称的状态，
 *      说明文件被改坏/半截 —— 此时必须拒绝，而不是"尽力而为地导入一部分"。
 *
 * 用**真实 SQLite**（`:memory:`）+ 真实引擎，不是假探针：这些结论全都关于
 * "op 真的进了日志、reducer 真的重放了它"，假探针证明不了任何一条。
 */

import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions } from '../src/actions.js';
import { buildExportDocument, type ExportDocument } from '../src/export-dump.js';
import {
  parseExportDocument,
  restoreIntoEmptyTarget,
  stateMatchesDocument,
  type ExportImportFailureReason,
  type ImportTarget,
  type ParseExportResult,
} from '../src/import-dump.js';

/**
 * 断言解析失败并给出**具体原因**。
 *
 * ⚠️ 必须走这个收窄的辅助函数，不能写 `result.reason`：`ParseExportResult` 是
 * 判别联合，成功那一支没有 `reason`。vitest 会剥掉类型、测试照样绿，
 * **只有 `typecheck` 会红**（AGENTS.md §7 开头那条：类型错误会藏在绿色测试背后）。
 */
function expectParseReason(result: ParseExportResult, reason: ExportImportFailureReason): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.reason).toBe(reason);
}

/**
 * 一台"设备"：真实引擎 + 真实存储 + 一个满足 `ImportTarget` 的薄适配。
 *
 * `now` **可注入** —— 见第 3 条契约：只有控制时钟才能造出"导入的 op 时间戳在未来"
 * 这个能把"没并时钟"的缺陷区分出来的场景（AGENTS.md #25：不能失败的测试没有价值）。
 */
interface Device {
  engine: OpLogEngine;
  target: ImportTarget;
  ops(): Promise<Operation<string>[]>;
  close(): void;
}

let devices: Device[] = [];

async function device(clientId: string, now: () => number): Promise<Device> {
  const adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();

  const store = new DbOpLogStore<Operation<string>>(adapter);
  const engine = new OpLogEngine({ store, clientId, now });
  // 与 openAppHost 同一条纪律：崩溃恢复必须在接受任何写入之前完成。
  await engine.recover();

  const ops = async (): Promise<Operation<string>[]> => {
    const rows = await store.getAllOps();
    return rows.map((row) => row.op);
  };

  const created: Device = {
    engine,
    // 🔴 目标只交引擎 —— `ImportTarget` 上已经没有"读全库"的口子了
    // （空库守卫改成条数判定），所以这里连 `readOpLog` 都不用再提供。
    target: { engine },
    ops,
    close: () => adapter.close(),
  };
  devices.push(created);
  return created;
}

beforeEach(() => {
  devices = [];
});

afterEach(() => {
  for (const d of devices) d.close();
  devices = [];
});

const EXPORTED_AT = 2_000_000_000_000;

/** 造一份"有活着的、也有已删除的"导出 —— 完整保真那一份。 */
async function buildExportWithTombstone(
  clientId = 'device-a',
  at = EXPORTED_AT,
): Promise<ExportDocument> {
  const source = await device(clientId, () => at);
  const actions = createTaskActions(source.engine, {
    now: () => at,
    newTaskId: makeSequenceId(),
  });

  await actions.create('活着的任务');
  const doomedId = await actions.create('会被删掉的任务');
  await actions.remove(doomedId);

  return buildExportDocument({
    state: source.engine.getState(),
    ops: await source.ops(),
    exportedAt: at,
    host: 'test',
  });
}

/** 可预测的 id，避免随机 id 让断言 flaky（AGENTS.md #25）。 */
function makeSequenceId(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `task-${String(n).padStart(3, '0')}`;
  };
}

describe('parseExportDocument', () => {
  it('拒绝不是 JSON 的文本', () => {
    expectParseReason(parseExportDocument('这是中文，不是 JSON'), 'invalid-json');
  });

  it('拒绝不是 heyta 导出的文档', async () => {
    const doc = await buildExportWithTombstone();
    const foreign = { ...doc, app: { name: 'someone-else' } };
    expectParseReason(parseExportDocument(JSON.stringify(foreign)), 'wrong-application');
  });

  it('拒绝不认识的 formatVersion', async () => {
    const doc = await buildExportWithTombstone();
    const future = { ...doc, formatVersion: doc.formatVersion + 1 };
    expectParseReason(
      parseExportDocument(JSON.stringify(future)),
      'unsupported-format-version',
    );
  });

  it('拒绝 schemaVersion 不同的文档（跨版本还原本轮不做）', async () => {
    const doc = await buildExportWithTombstone();
    const other = { ...doc, schemaVersion: doc.schemaVersion + 1 };
    expectParseReason(
      parseExportDocument(JSON.stringify(other)),
      'unsupported-schema-version',
    );
  });

  it('拒绝自相矛盾的计数（totalOps 与 opLog 长度不符）', async () => {
    const doc = await buildExportWithTombstone();
    const tampered = {
      ...doc,
      counts: { ...doc.counts, totalOps: doc.counts.totalOps + 1 },
    };
    expectParseReason(parseExportDocument(JSON.stringify(tampered)), 'inconsistent-document');
  });

  it('🔴 拒绝词表外的 opType（不要自造词，也不要静默忽略）', async () => {
    const doc = await buildExportWithTombstone();
    const ops = doc.opLog.map((op, index) =>
      index === 0 ? { ...op, opType: 'CREATE' } : op,
    );
    expectParseReason(parseExportDocument(JSON.stringify({ ...doc, opLog: ops })), 'invalid-document');
  });

  it('接受一份真实的导出（往返的入口）', async () => {
    const doc = await buildExportWithTombstone();
    const parsed = parseExportDocument(JSON.stringify(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.document.counts.totalOps).toBe(doc.counts.totalOps);
  });
});

describe('restoreIntoEmptyTarget', () => {
  it('🔴 还原之后墓碑仍然是墓碑 —— 已删数据不许复活', async () => {
    const doc = await buildExportWithTombstone();
    const target = await device('device-b', () => 1_000_000_000_000);
    const result = await restoreIntoEmptyTarget(target.target, doc);

    expect(result.ok, '空库还原必须成功').toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.importedOps).toBe(doc.counts.totalOps);
    expect(result.entities).toBe(doc.counts.totalEntities);
    // 这个数字是"墓碑语义没丢"的直接证据。
    expect(result.deleted).toBe(doc.counts.totalDeleted);
    expect(result.deleted).toBe(1);

    // 逐项一致：物化状态与导出完全对上（含墓碑）。
    expect(stateMatchesDocument(target.engine.getState(), doc)).toBe(true);

    const actions = createTaskActions(target.engine);
    const alive = actions.listTasks();
    expect(alive.map((t) => t.title)).toEqual(['活着的任务']);

    // 被删的那条：不在活动清单里，但**在回收站里、带着墓碑**。
    const trashed = actions.listTrashed();
    expect(trashed.map((t) => t.title)).toEqual(['会被删掉的任务']);
    expect(trashed[0]?.deletedAt).toBeTypeOf('number');
  });

  it('🔴 导入的 op 不进上传队列（它们的 clientId 属于别的设备）', async () => {
    const doc = await buildExportWithTombstone();
    const target = await device('device-b', () => 1_000_000_000_000);
    await restoreIntoEmptyTarget(target.target, doc);

    // 服务端会逐条以 INVALID_CLIENT_ID 拒绝 op.clientId 与本机不符的 op，
    // 把它们排进队列只会得到一批永久拒绝。所以必须是 0。
    expect(await target.engine.getPendingUpload()).toHaveLength(0);

    const rows = await target.ops();
    expect(rows.length).toBe(doc.counts.totalOps);
  });

  it('🔴 目标是空库才叫还原：已有数据时拒绝，且**一个字节都不写**', async () => {
    const doc = await buildExportWithTombstone();
    const target = await device('device-b', () => 1_000_000_000_000);
    const actions = createTaskActions(target.engine);
    await actions.create('本机原有的任务');
    const before = await target.ops();

    const result = await restoreIntoEmptyTarget(target.target, doc);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('target-not-empty');

    // 现有数据没有被清空、也没有被导入的东西污染。
    const after = await target.ops();
    expect(after.map((op) => op.id)).toEqual(before.map((op) => op.id));
    expect(createTaskActions(target.engine).listTasks().map((t) => t.title)).toEqual([
      '本机原有的任务',
    ]);
  });

  it('🔴 时钟不回退：还原之后本机的编辑必须生效（否则会被静默丢弃）', async () => {
    // 导出侧的时钟在**未来**，而本机时钟在过去。
    // 若 `importOperations` 没有把导入 op 的向量时钟并进本机时钟，
    // 本机的新编辑会是 CONCURRENT 且时间戳更旧 → reducer 的闸门拒绝它 → 静默丢数据。
    const doc = await buildExportWithTombstone('device-a', 2_000_000_000_000);
    const target = await device('device-b', () => 1_000_000_000_000);
    await restoreIntoEmptyTarget(target.target, doc);

    const actions = createTaskActions(target.engine, { now: () => 1_000_000_000_000 });
    const aliveId = actions.listTasks()[0]?.id;
    expect(aliveId).toBeTypeOf('string');
    await actions.rename(aliveId as string, '改过的标题');

    expect(
      target.engine.getState().tasks[aliveId as string]?.title,
      '导入之后本机的编辑被时钟闸门挡住了 —— 这是静默丢数据',
    ).toBe('改过的标题');
  });

  it('🔴 文档自相矛盾时先拒绝：状态对不上就不写一个字', async () => {
    const doc = await buildExportWithTombstone();

    // 把墓碑从 entities 里拿掉 —— 于是"重放 opLog"与"它自己声称的状态"对不上。
    const tasks = (doc.entities['TASK'] as Array<Record<string, unknown>>).filter(
      (row) => row['deletedAt'] === undefined,
    );
    const tampered: ExportDocument = {
      ...doc,
      entities: { ...doc.entities, TASK: tasks },
      counts: {
        ...doc.counts,
        entities: { ...doc.counts.entities, TASK: { total: tasks.length, deleted: 0 } },
        totalEntities: doc.counts.totalEntities - 1,
        totalDeleted: 0,
      },
    };

    const target = await device('device-b', () => 1_000_000_000_000);
    const result = await restoreIntoEmptyTarget(target.target, tampered);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('inconsistent-document');
    // 关键：目标仍然是空的。
    expect(await target.ops()).toHaveLength(0);
  });

  it('同一份导出导入第二次会被跳过（幂等由 store 的唯一索引保证）', async () => {
    const doc = await buildExportWithTombstone();
    const target = await device('device-b', () => 1_000_000_000_000);
    const first = await target.engine.importOperations(doc.opLog);
    const second = await target.engine.importOperations(doc.opLog);

    expect(first.imported).toBe(doc.opLog.length);
    expect(first.skipped).toBe(0);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(doc.opLog.length);
    expect(await target.ops()).toHaveLength(doc.opLog.length);
  });
});

describe('stateMatchesDocument（判据本身能否失败）', () => {
  it('多一条、少一条、或墓碑状态不同，都必须判为不一致', async () => {
    const doc = await buildExportWithTombstone();
    const target = await device('device-b', () => 1_000_000_000_000);
    await restoreIntoEmptyTarget(target.target, doc);
    const state = target.engine.getState();

    expect(stateMatchesDocument(state, doc)).toBe(true);

    // 少一条
    const fewer = {
      ...doc,
      entities: {
        ...doc.entities,
        TASK: (doc.entities['TASK'] as unknown[]).slice(0, 1),
      },
    } as ExportDocument;
    expect(stateMatchesDocument(state, fewer)).toBe(false);

    // 把墓碑的 deletedAt 抹掉 —— "已删数据复活"必须被判为不一致。
    const resurrected = {
      ...doc,
      entities: {
        ...doc.entities,
        TASK: (doc.entities['TASK'] as Array<Record<string, unknown>>).map((row) => {
          const { deletedAt: _drop, ...rest } = row;
          return rest;
        }),
      },
    } as ExportDocument;
    expect(stateMatchesDocument(state, resurrected)).toBe(false);
  });
});
