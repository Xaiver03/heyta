/**
 * IndexedDB 适配器 + OpLogStore 测试
 * =====================================
 *
 * 用 `fake-indexeddb`（Apache-2.0）在 Node 里跑真实 IndexedDB 语义。
 *
 * ⚠️ 为什么必须用真实实现而不是自己写个 mock：
 * 这里要测的恰恰是 **IndexedDB 自己的行为**（事务自动提交、唯一索引冲突、
 * 游标语义）。用 mock 测等于测自己写的假设，而假设错了测试照样绿。
 */

import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Operation } from '@heyta/sync-core';

import { IndexedDbAdapter } from '../src/indexeddb/indexeddb-adapter.js';
import { DbOpLogStore } from '../src/db-op-log-store.js';
import { META_KEYS, OP_FIELDS, OP_INDEXES, STORES } from '../src/stores.js';

// 每个测试用全新的 IndexedDB 全局，避免互相污染
function freshAdapter(name: string): IndexedDbAdapter {
  // ⚠️ IDBKeyRange 也必须装到全局 —— 适配器用它构造区间。
  // 只装 indexedDB 会在任何区间查询时报 "IDBKeyRange is not defined"。
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof FakeIDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = FakeIDBKeyRange;
  return new IndexedDbAdapter(name);
}

function makeOp(over: Partial<Operation<string>> = {}): Operation<string> {
  return {
    id: `op-${Math.random().toString(36).slice(2, 10)}`,
    entityType: 'TASK',
    entityId: 'task-1',
    payload: { title: '任务' },
    clientId: 'client-a',
    clientTimestamp: 1_000,
    schemaVersion: 1,
    vectorClock: { 'client-a': 1 },
    ...over,
  } as Operation<string>;
}

describe('IndexedDbAdapter', () => {
  let db: IndexedDbAdapter;

  beforeEach(async () => {
    db = freshAdapter(`test-adapter-${Math.random().toString(36).slice(2)}`);
    await db.init();
  });

  it('init 幂等且并发安全（不会开出多个连接）', async () => {
    await Promise.all([db.init(), db.init(), db.init()]);
    await db.put(STORES.META, { key: 'k', value: 'v' });
    expect(await db.get(STORES.META, 'k')).toEqual({ key: 'k', value: 'v' });
  });

  it('事务提交后才决议（不是最后一个 request.onsuccess）', async () => {
    // 事务里写入，返回后立刻在**事务外**读 —— 必须已经可见
    await db.transaction([STORES.META], 'readwrite', async (tx) => {
      await tx.put(STORES.META, { key: 'committed', value: 42 });
    });
    expect(await db.get(STORES.META, 'committed')).toEqual({
      key: 'committed',
      value: 42,
    });
  });

  it('事务里抛错 → 整体回滚，不留半截数据', async () => {
    await expect(
      db.transaction([STORES.META], 'readwrite', async (tx) => {
        await tx.put(STORES.META, { key: 'should-rollback', value: 1 });
        throw new Error('故意失败');
      }),
    ).rejects.toThrow('故意失败');

    // 关键断言：写入必须被回滚
    expect(await db.get(STORES.META, 'should-rollback')).toBeUndefined();
  });

  it('访问未列入事务的 store 会明确报错，而不是让 IDB 抛模糊错误', async () => {
    await expect(
      db.transaction([STORES.META], 'readonly', async (tx) => {
        await tx.get(STORES.OPS, 1);
      }),
    ).rejects.toThrow(/事务未包含 store「ops」/);
  });

  it('区间查询：闭开区间语义正确', async () => {
    await db.put(STORES.META, { key: 'a', value: 1 });
    await db.put(STORES.META, { key: 'b', value: 2 });
    await db.put(STORES.META, { key: 'c', value: 3 });

    const rows = await db.getAll<{ key: string }>(STORES.META, {
      lower: 'a',
      upper: 'c',
      upperOpen: true,
    });
    expect(rows.map((r) => r.key).sort()).toEqual(['a', 'b']);
  });

  it('游标 limit 生效', async () => {
    for (let i = 0; i < 10; i++) {
      await db.put(STORES.META, { key: `k${String(i).padStart(2, '0')}`, value: i });
    }
    const seen: string[] = [];
    await db.iterate<{ key: string }>(STORES.META, { limit: 3 }, (v) => {
      seen.push(v.key);
      return 'continue';
    });
    expect(seen).toHaveLength(3);
  });

  it('游标 limit 非法时立刻抛错（防止扫全表把移动端卡死）', async () => {
    await expect(
      db.iterate(STORES.META, { limit: 0 }, () => 'continue'),
    ).rejects.toThrow(/limit 必须是正整数/);
  });

  it("游标 'delete' 边删边继续，'delete-stop' 删完当前条就停", async () => {
    for (let i = 0; i < 5; i++) {
      await db.put(STORES.META, { key: `d${i}`, value: i });
    }

    // 前两条 delete（各删一条并继续），第三条 delete-stop（删完停）。
    // 所以访问 3 条、删掉 3 条，剩 2 条。
    let visited = 0;
    await db.iterate<{ key: string }>(STORES.META, {}, () => {
      visited += 1;
      if (visited <= 2) return 'delete';
      return 'delete-stop';
    });

    expect(visited).toBe(3);
    // 计数与语义一致：visited 条全被删
    expect(await db.count(STORES.META)).toBe(2);
  });

  it("游标 'stop' 不删任何东西", async () => {
    for (let i = 0; i < 5; i++) {
      await db.put(STORES.META, { key: `s${i}`, value: i });
    }
    let visited = 0;
    await db.iterate<{ key: string }>(STORES.META, {}, () => {
      visited += 1;
      return 'stop';
    });
    expect(visited).toBe(1);
    expect(await db.count(STORES.META)).toBe(5);
  });

  it('并发事务都能正确落盘（不互相覆盖）', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        db.put(STORES.META, { key: `c${i}`, value: i }),
      ),
    );
    expect(await db.count(STORES.META)).toBe(20);
  });
});

describe('DbOpLogStore', () => {
  // ⚠️ 泛型参数必须显式给 `Operation<string>`：默认的 `Operation` 用的是
  // sync-core 内部的 `OpType` 联合，而测试里造的是宽松的 string op。
  // 不写会让 Operation<string> 无法赋给 Operation<OpType>。
  let db: IndexedDbAdapter;
  let store: DbOpLogStore<Operation<string>>;

  beforeEach(async () => {
    db = freshAdapter(`test-oplog-${Math.random().toString(36).slice(2)}`);
    await db.init();
    store = new DbOpLogStore<Operation<string>>(db);
  });

  it('appendLocal 返回单调递增的 seq', async () => {
    const seqs = await store.appendLocal([makeOp(), makeOp(), makeOp()]);
    expect(seqs).toHaveLength(3);
    expect(seqs[1]!).toBeGreaterThan(seqs[0]!);
    expect(seqs[2]!).toBeGreaterThan(seqs[1]!);
  });

  it('getLastLocalSeq 与写入一致（同一个事务）', async () => {
    const seqs = await store.appendLocal([makeOp(), makeOp()]);
    expect(await store.getLastLocalSeq()).toBe(seqs[seqs.length - 1]);
  });

  it('🔴 同一 opId 写两次只留一条（幂等）', async () => {
    const op = makeOp({ id: 'dup-op' });
    await store.appendLocal([op]);
    // 同步会重复投递同一个 op —— 这是正常路径，不是错误
    const result = await store.appendBatchSkipDuplicates([op], 'remote', {
      pendingApply: true,
    });

    expect(result.writtenOps).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
    expect(await db.count(STORES.OPS)).toBe(1);
  });

  it('🔴 同一批里重复的 opId 也只写一条', async () => {
    const op = makeOp({ id: 'same-in-batch' });
    const result = await store.appendBatchSkipDuplicates([op, op, op], 'remote', {
      pendingApply: true,
    });
    expect(result.writtenOps).toHaveLength(1);
    expect(result.skippedCount).toBe(2);
    expect(await db.count(STORES.OPS)).toBe(1);
  });

  it('并发写入同一 opId 仍只留一条（唯一索引，不是先查后写）', async () => {
    // 先查后写会有 TOCTOU 竞态：两个并发都能查到"不存在"
    const op = makeOp({ id: 'race-op' });
    await Promise.all([
      store.appendBatchSkipDuplicates([op], 'remote', { pendingApply: true }),
      store.appendBatchSkipDuplicates([op], 'remote', { pendingApply: true }),
      store.appendBatchSkipDuplicates([op], 'remote', { pendingApply: true }),
    ]);
    expect(await db.count(STORES.OPS)).toBe(1);
  });

  it('🔴 findPendingApply 能找出崩溃时"写了但没应用"的 op', async () => {
    // 模拟：远程 op 已落盘（pendingApply=true），但 reducer 还没提交就崩了
    const op = makeOp({ id: 'pending-op' });
    await store.appendBatchSkipDuplicates([op], 'remote', { pendingApply: true });

    const pending = await store.findPendingApply();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.op.id).toBe('pending-op');
    expect(pending[0]!.applyStatus).toBe('pending');
  });

  it('markApplied 后不再出现在 findPendingApply（崩溃恢复闭环）', async () => {
    const op = makeOp({ id: 'to-apply' });
    const { seqs } = await store.appendBatchSkipDuplicates([op], 'remote', {
      pendingApply: true,
    });
    await store.markApplied(seqs as number[]);

    expect(await store.findPendingApply()).toHaveLength(0);
  });

  it('本地 op 不会出现在 findPendingApply（它写入即已应用）', async () => {
    await store.appendLocal([makeOp()]);
    expect(await store.findPendingApply()).toHaveLength(0);
  });

  it('markFailed 标记失败的 op，且把它移出待应用队列', async () => {
    const op = makeOp({ id: 'bad-op' });
    await store.appendBatchSkipDuplicates([op], 'remote', { pendingApply: true });
    await store.markFailed(['bad-op']);

    expect(await store.findPendingApply()).toHaveLength(0);
    const rec = await db.getFromIndex<{ applyStatus?: string }>(
      STORES.OPS,
      OP_INDEXES.OP_ID,
      'bad-op',
    );
    expect(rec?.applyStatus).toBe('failed');
  });

  it('getOpsSince 是开区间（不含 sinceSeq 本身）', async () => {
    const seqs = await store.appendLocal([makeOp(), makeOp(), makeOp()]);
    const since = seqs[0]!;
    const rows = await store.getOpsSince(since);
    expect(rows.map((r) => r.seq)).toEqual([seqs[1], seqs[2]]);
  });

  it('getOpsSince 可以排除自己的客户端（避免回放自己写的东西）', async () => {
    await store.appendLocal([makeOp({ clientId: 'me' })]);
    await store.appendLocal([makeOp({ clientId: 'other' })]);

    const rows = await store.getOpsSince(0, undefined, 'me');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.op.clientId).toBe('other');
  });

  it('getOpsForEntity 按 seq 升序返回该实体的全部 op', async () => {
    await store.appendLocal([
      makeOp({ entityId: 'a' }),
      makeOp({ entityId: 'b' }),
      makeOp({ entityId: 'a' }),
    ]);
    const rows = await store.getOpsForEntity('TASK', 'a');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.seq).toBeLessThan(rows[1]!.seq);
  });

  it('同步游标读写', async () => {
    expect(await store.getLastServerSeq()).toBe(0);
    await store.setLastServerSeq(12345);
    expect(await store.getLastServerSeq()).toBe(12345);
  });

  it('空批次是安全的空操作', async () => {
    expect(await store.appendLocal([])).toEqual([]);
    const r = await store.appendBatchSkipDuplicates([], 'remote', {
      pendingApply: true,
    });
    expect(r.seqs).toEqual([]);
    expect(r.skippedCount).toBe(0);
  });

  it('archiveUpTo 把老 op 移入归档并保留最近的一批', async () => {
    // 写 20 条，归档阈值设成保留 5 条 → 只有前 15 条真正被归档
    const seqs = await store.appendLocal(Array.from({ length: 20 }, () => makeOp()));
    const lastSeq = seqs[seqs.length - 1]!;

    const store5 = new DbOpLogStore<Operation<string>>(db, 5);
    const archived = await store5.archiveUpTo(lastSeq);

    // cutoff = lastSeq - 5，所以归档的是 seq <= cutoff 的那批
    expect(archived).toBeGreaterThan(0);
    expect(await db.count(STORES.ARCHIVE)).toBe(archived);
    expect(await db.count(STORES.OPS)).toBe(20 - archived);
    // 归档不能丢数据：两个 store 加起来还是 20
    expect((await db.count(STORES.ARCHIVE)) + (await db.count(STORES.OPS))).toBe(20);
  });

  it('archiveUpTo 在没有可归档内容时返回 0，不误删', async () => {
    await store.appendLocal([makeOp()]);
    // 保留 500 条，只有 1 条 → 没有可归档的
    expect(await store.archiveUpTo(1)).toBe(0);
    expect(await db.count(STORES.OPS)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 上传队列（离线同步用）
// ─────────────────────────────────────────────────────────────

describe('DbOpLogStore — 上传队列', () => {
  let db: IndexedDbAdapter;
  let store: DbOpLogStore<Operation<string>>;

  beforeEach(async () => {
    const g = globalThis as unknown as {
      indexedDB: IDBFactory;
      IDBKeyRange: typeof IDBKeyRange;
    };
    g.indexedDB = new IDBFactory();
    g.IDBKeyRange = IDBKeyRange;
    db = new IndexedDbAdapter(`upload-${Math.random().toString(36).slice(2)}`);
    await db.init();
    store = new DbOpLogStore<Operation<string>>(db);
  });

  function op(id: string): Operation<string> {
    return {
      id,
      clientId: 'device-a',
      actionType: 'CREATE_TASK',
      opType: 'CREATE',
      entityType: 'TASK',
      entityId: `e-${id}`,
      payload: { title: id },
      vectorClock: {},
      timestamp: 1,
      schemaVersion: 1,
    } as Operation<string>;
  }

  it('本地 op 进入待上传队列；远程 op 不进（我们本来就收到了）', async () => {
    await store.appendLocal([op('local-1')]);
    await store.appendBatchSkipDuplicates([op('remote-1')], 'remote', {
      pendingApply: true,
    });

    const pending = await store.findPendingUpload();
    expect(pending.map((r) => r.op.id)).toEqual(['local-1']);
  });

  it('🔴 待上传队列按本地 seq 升序（上传顺序必须与产出顺序一致）', async () => {
    // 故意乱序插入
    await store.appendLocal([op('a')]);
    await store.appendLocal([op('b')]);
    await store.appendLocal([op('c')]);

    const pending = await store.findPendingUpload();
    const seqs = pending.map((r) => r.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(pending.map((r) => r.op.id)).toEqual(['a', 'b', 'c']);
  });

  it('markUploaded 把 op 移出待上传队列，并写回服务端 seq', async () => {
    await store.appendLocal([op('a')]);
    expect(await store.findPendingUpload()).toHaveLength(1);

    const updated = await store.markUploaded(new Map([['a', 99]]));
    expect(updated).toBe(1);

    // 已上传 → 不在队列里（否则每次同步都重传）
    expect(await store.findPendingUpload()).toHaveLength(0);

    // 服务端序号写进存储元数据，**不能**污染 op
    const rows = await store.getAllOps();
    expect(rows[0]!.serverSeq).toBe(99);
    expect(rows[0]!.op).not.toHaveProperty('seq');
  });

  it('markUploaded 对不存在的 opId 是安全空操作', async () => {
    const updated = await store.markUploaded(new Map([['nope', 1]]));
    expect(updated).toBe(0);
  });

  it('markUploaded 保留 applyStatus（不能顺手重置它）', async () => {
    await store.appendLocal([op('a')]);
    await store.markUploaded(new Map([['a', 5]]));

    const rows = await store.getAllOps();
    // 本地 op 本来就是 applied；上传不该改变这个
    expect(rows[0]!.applyStatus).toBe('applied');
    expect(rows[0]!.uploadStatus).toBe('uploaded');
  });

  it('待应用与待上传是**两个独立队列**（远程 op 待应用但不上传）', async () => {
    await store.appendBatchSkipDuplicates([op('r1')], 'remote', { pendingApply: true });
    await store.appendLocal([op('l1')]);

    const toApply = await store.findPendingApply();
    const toUpload = await store.findPendingUpload();

    expect(toApply.map((r) => r.op.id)).toEqual(['r1']);
    expect(toUpload.map((r) => r.op.id)).toEqual(['l1']);
  });
});

describe('IndexedDB schema 升级', () => {
  it('🔴 从 v1 库升级到当前版本时，新索引会被补上（否则上传队列恒为空）', async () => {
    const g = globalThis as unknown as {
      indexedDB: IDBFactory;
      IDBKeyRange: typeof IDBKeyRange;
    };
    g.indexedDB = new IDBFactory();
    g.IDBKeyRange = IDBKeyRange;

    const name = `upgrade-${Math.random().toString(36).slice(2)}`;

    // 手工造一个 v1 库：只有 by_opId，**没有** by_uploadStatus
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORES.OPS, {
          keyPath: OP_FIELDS.SEQ,
          autoIncrement: true,
        });
        s.createIndex(OP_INDEXES.OP_ID, `op.${OP_FIELDS.OP_ID}`, { unique: true });
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    // 现在用当前版本打开 → 应触发 onupgradeneeded 补建索引
    const db = new IndexedDbAdapter(name);
    await db.init();
    const store = new DbOpLogStore<Operation<string>>(db);

    const o: Operation<string> = {
      id: 'x',
      clientId: 'c',
      actionType: 'A',
      opType: 'CREATE',
      entityType: 'TASK',
      entityId: 'e',
      payload: {},
      vectorClock: {},
      timestamp: 1,
      schemaVersion: 1,
    } as Operation<string>;

    await store.appendLocal([o]);

    // 如果新索引没建出来，这里会静默返回空数组 —— 这就是本测试的意义
    const pending = await store.findPendingUpload();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.op.id).toBe('x');
  });
});
