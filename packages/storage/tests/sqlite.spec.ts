/**
 * SQLite 独有的行为 —— 共享契约**覆盖不到**的部分。
 *
 * 共享契约在 `:memory:` 上跑，因此它无法证明"数据真的落到了磁盘、下次还能读回来"。
 * 那恰恰是本地优先应用的生命线，也是 ADR-0003 §2.2 点名 SQLite 的原因
 * （IndexedDB 在原生端不存在 / 会被 OS 回收）。
 *
 * 所以这里用**临时文件**（不是 `:memory:`）覆盖：
 *   1. close() 后重开同一文件，数据仍在（含自增计数器）
 *   2. schema 在重开时幂等创建（`CREATE ... IF NOT EXISTS`），包括唯一索引
 *   3. 复合主键的排序不是 JSON 字符串排序（`10` 不能排到 `2` 前面）
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { INDEXEDDB_SCHEMA } from '../src/indexeddb/indexeddb-adapter.js';
import { NodeSqliteDriver } from '../src/sqlite/node-sqlite-driver.js';
import { SqliteAdapter } from '../src/sqlite/sqlite-adapter.js';
import { OP_FIELDS, OP_INDEXES, STORES } from '../src/stores.js';

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-sqlite-'));
  tempDirs.push(dir);
  return join(dir, 'heyta.sqlite');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 每次调用都新建一个 SQLite 驱动（重开 = 真的重新打开文件）。 */
async function openFileDb(path: string): Promise<SqliteAdapter> {
  const db = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(path),
  });
  await db.init();
  return db;
}

function opRecord(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    op: {
      id,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { title: '任务' },
      clientId: 'client-a',
      timestamp: 1_000,
      vectorClock: { 'client-a': 1 },
      ...over,
    },
    source: 'local',
    applyStatus: 'applied',
    uploadStatus: 'pending',
  };
}

describe('SqliteAdapter 持久化（临时文件，不是 :memory:）', () => {
  it('close() 后重开同一文件，数据仍然存在', async () => {
    const path = tempDbPath();

    const first = await openFileDb(path);
    await first.add(STORES.OPS, opRecord('persist-1'));
    await first.add(STORES.OPS, opRecord('persist-2'));
    await first.put(STORES.META, { key: 'clientId', value: 'client-a' });
    await first.put(STORES.STATE, { entityType: 'TASK', entityId: 't1', data: { title: 'A' } });
    first.close();

    const second = await openFileDb(path);
    try {
      expect(await second.count(STORES.OPS)).toBe(2);

      const rows = await second.getAll<Record<string, unknown>>(STORES.OPS);
      expect(rows.map((r) => r[OP_FIELDS.SEQ])).toEqual([1, 2]);

      // 索引也要能重新命中（说明索引结构本身也持久化了）
      const byOpId = await second.getFromIndex<Record<string, unknown>>(
        STORES.OPS,
        OP_INDEXES.OP_ID,
        'persist-2',
      );
      expect((byOpId?.op as Record<string, unknown>)['id']).toBe('persist-2');

      expect(await second.get<{ value: string }>(STORES.META, 'clientId')).toEqual({
        key: 'clientId',
        value: 'client-a',
      });
      expect(
        (await second.get<{ data: { title: string } }>(STORES.STATE, ['TASK', 't1'] as never))?.data
          .title,
      ).toBe('A');
    } finally {
      second.close();
    }
  });

  it('自增计数器跨重开继续单调递增（不复用旧 seq）', async () => {
    const path = tempDbPath();

    const first = await openFileDb(path);
    await first.add(STORES.OPS, opRecord('a'));
    await first.add(STORES.OPS, opRecord('b'));
    first.close();

    const second = await openFileDb(path);
    try {
      // 重开后新写入必须是 3，而不是从 1 再来
      expect(await second.add(STORES.OPS, opRecord('c'))).toBe(3);
    } finally {
      second.close();
    }
  });

  it('重开时幂等建 schema（含唯一索引），且唯一性仍然生效', async () => {
    const path = tempDbPath();

    const first = await openFileDb(path);
    await first.add(STORES.OPS, opRecord('uniq'));
    first.close();

    // 再开两次，并并发 init —— `CREATE ... IF NOT EXISTS` 必须容忍重复执行
    const second = await openFileDb(path);
    try {
      await Promise.all([second.init(), second.init(), second.init()]);
      await expect(second.add(STORES.OPS, opRecord('uniq'))).rejects.toThrow();
      expect(await second.count(STORES.OPS)).toBe(1);
    } finally {
      second.close();
    }

    const third = await openFileDb(path);
    try {
      expect(await third.count(STORES.OPS)).toBe(1);
    } finally {
      third.close();
    }
  });

  it('multiEntry 索引跨重开仍然按数组元素展开', async () => {
    const path = tempDbPath();

    const first = await openFileDb(path);
    await first.add(STORES.OPS, opRecord('m1', { entityIds: ['x', 'y'] }));
    await first.add(STORES.OPS, opRecord('m2', { entityIds: ['y', 'z'] }));
    first.close();

    const second = await openFileDb(path);
    try {
      expect(
        await second.countFromIndex(STORES.OPS, OP_INDEXES.ENTITY_IDS, 'y'),
      ).toBe(2);
    } finally {
      second.close();
    }
  });

  it('🔴 复合主键按**分量数值**排序，不是按 JSON 字符串排序（10 不能排在 2 前）', async () => {
    const path = tempDbPath();
    const db = await openFileDb(path);
    try {
      // 故意乱序写入。复合主键是 [entityType, entityId]。
      await db.put(STORES.STATE, { entityType: 'T', entityId: 10, data: {} });
      await db.put(STORES.STATE, { entityType: 'T', entityId: 2, data: {} });
      await db.put(STORES.STATE, { entityType: 'A', entityId: 9, data: {} });

      const rows = await db.getAll<{ entityType: string; entityId: number }>(STORES.STATE);
      // JSON.stringify(['T',10]) = '["T",10]'，按字符串排会得到 ['T',10] 在 ['T',2] 之前；
      // 按分量排序才是正确的 [ 'A'/9, 'T'/2, 'T'/10 ]。
      expect(rows.map((r) => `${r.entityType}/${r.entityId}`)).toEqual(['A/9', 'T/2', 'T/10']);
    } finally {
      db.close();
    }
  });
});
