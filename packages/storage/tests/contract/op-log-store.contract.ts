/**
 * `OpLogStore` 共享契约
 * =====================
 *
 * `DbAdapter` 是可替换的存储引擎；`OpLogStore` 是它上面的**同步语义**。
 * 两层必须分别被契约锁住 —— 引擎对了不代表同步语义对了。
 *
 * 🔴 **这份契约最重要的作用是证明一件事：op-log 层不绑定 IndexedDB。**
 *
 * 它原本叫 `IndexedDbOpLogStore` 并放在 `indexeddb/` 下，但实测一行
 * IndexedDB API 都没用 —— 只依赖 `DbAdapter`。名字在撒谎，而代价是实质的：
 * 看代码的人会以为换到 SQLite 要**再写一个 op-log store**，
 * 于是真的去写第二份同步逻辑，而两份实现不可能保持一致 ——
 * 那等于数据损坏（ADR-0003 §3.3）。
 *
 * 同一份契约跑在 Memory 与 IndexedDB 两个适配器上，就是"换引擎、零改动"的证据。
 */

import { describe, expect, it } from 'vitest';

import type { Operation } from '@heyta/sync-core';

import type { DbAdapter } from '../../src/db.types.js';
import type { OpLogStore, StoredOperation } from '../../src/op-log-store.js';
import { checkpointChecksum } from '../../src/checkpoint.js';
import { META_KEYS, OP_FIELDS, STORES } from '../../src/stores.js';

export interface OpLogStoreContractOptions {
  name: string;
  /** 造一个**全新且已 init** 的适配器。 */
  createDb: () => Promise<DbAdapter>;
  /** 给定一个适配器，造出对应的 op-log store。 */
  create: (db: DbAdapter) => OpLogStore<Operation<string>>;
}

let opCounter = 0;

export function makeOp(over: Partial<Operation<string>> = {}): Operation<string> {
  opCounter++;
  return {
    id: `op-${opCounter}`,
    entityType: 'TASK',
    entityId: 'task-1',
    opType: 'CRT',
    payload: { title: `任务 ${opCounter}` },
    clientId: 'client-a',
    timestamp: 1_000 + opCounter,
    vectorClock: { 'client-a': opCounter },
    schemaVersion: 1,
    ...over,
  } as Operation<string>;
}

const ids = (rows: StoredOperation<Operation<string>>[]): string[] =>
  rows.map((r) => r.op[OP_FIELDS.OP_ID] as unknown as string);

/**
 * 把探针**下沉到 driver**：数"有多少行离开了存储层"（P1-10b 用）。
 *
 * 🔴 为什么必须下沉：`DbAdapter` 上那两个物化方法（`getAll` / `getAllFromIndex`）不是
 * 行离开存储层的**唯一**出口 —— SQLite 的 `countFromIndex` 走
 * `fetchIndexRecords` → `driver.all`，全程绕开它们。钉在适配器层的探针
 * 看不见这条路，于是"计数不读回行"会在最该红的地方恒绿。
 *
 * ⚠️ `db` 上没有 driver（适配器在 Worker / 宿主另一侧，例如 Worker 桥接那一支）
 * 时返回 `undefined` —— 调用方必须**跳过并打印**，不能把它读成"通过"。
 * 这里刻意从 `db` 上取，而不是给 `DbAdapter` 加一个"只给测试用的钩子"：
 * 那会让判据变成实现的一部分（同一个理由：别给 `countFromIndex` 加 `{countOnly:true}`）。
 */
function driverRowProbe(
  db: DbAdapter,
): { rows: () => number; reset: () => void; restore: () => void } | undefined {
  // 运行时形状：SqliteAdapter 持有 `private driver`（TS 的 private 只是编译期约定）。
  const holder = db as unknown as { driver?: Record<string, unknown> };
  const driver = holder.driver;
  if (driver === undefined || typeof driver['all'] !== 'function') return undefined;

  let rows = 0;
  const restores: (() => void)[] = [];

  for (const key of ['all', 'get'] as const) {
    const original = driver[key];
    if (typeof original !== 'function') continue;
    const hadOwn = Object.prototype.hasOwnProperty.call(driver, key);
    const originalFn = original as (...args: unknown[]) => unknown;
    driver[key] = function patched(this: unknown, ...args: unknown[]): unknown {
      const value = originalFn.apply(this, args);
      if (Array.isArray(value)) rows += value.length;
      else if (value !== undefined && value !== null) rows += 1;
      return value;
    };
    restores.push(() => {
      // 原型方法就删掉自有的那份（回落原型），自有属性就放回去。
      if (hadOwn) driver[key] = original;
      else delete driver[key];
    });
  }

  return {
    rows: () => rows,
    reset: () => {
      rows = 0;
    },
    restore: () => {
      for (const restore of restores) restore();
    },
  };
}

export function runOpLogStoreContract({ name, createDb, create }: OpLogStoreContractOptions): void {
  describe(`OpLogStore 契约 —— ${name}`, () => {
    const withStore = async (
      fn: (store: OpLogStore<Operation<string>>, db: DbAdapter) => Promise<void>,
    ): Promise<void> => {
      const db = await createDb();
      const store = create(db);
      try {
        await fn(store, db);
      } finally {
        db.close();
      }
    };

    // ── 写入：seq 无空洞 ────────────────────────────────────

    it('🔴 appendLocal 返回单调递增、**无空洞**的 seq', async () => {
      await withStore(async (store) => {
        const a = await store.appendLocal([makeOp()]);
        const b = await store.appendLocal([makeOp(), makeOp()]);
        const c = await store.appendLocal([makeOp()]);

        // seq 是同步游标的基础。有空洞 → 增量同步永久漏掉中间的操作 → 静默丢数据。
        expect([...a, ...b, ...c]).toEqual([1, 2, 3, 4]);
      });
    });

    it('getLastLocalSeq 与写入一致', async () => {
      await withStore(async (store) => {
        expect(await store.getLastLocalSeq()).toBe(0);
        await store.appendLocal([makeOp(), makeOp()]);
        expect(await store.getLastLocalSeq()).toBe(2);
      });
    });

    it('空批次是安全的空操作', async () => {
      await withStore(async (store) => {
        expect(await store.appendLocal([])).toEqual([]);
        expect(await store.getLastLocalSeq()).toBe(0);
      });
    });

    it('🔴 同一 opId 写两次只留一条（幂等，靠唯一索引而不是先查后写）', async () => {
      await withStore(async (store) => {
        const op = makeOp();
        await store.appendLocal([op]);
        await store.appendLocal([op]);
        expect(await store.getAllOps()).toHaveLength(1);
      });
    });

    it('🔴 同一批里重复的 opId 也只写一条', async () => {
      await withStore(async (store) => {
        const op = makeOp();
        await store.appendLocal([op, op, op]);
        expect(await store.getAllOps()).toHaveLength(1);
        // 且不能因为跳过而留下空洞
        expect(await store.getLastLocalSeq()).toBe(1);
      });
    });

    it('并发写入同一 opId 仍只留一条', async () => {
      await withStore(async (store) => {
        const op = makeOp();
        await Promise.all([
          store.appendLocal([op]),
          store.appendLocal([op]),
          store.appendLocal([op]),
        ]);
        expect(await store.getAllOps()).toHaveLength(1);
      });
    });

    // ── 读取 ───────────────────────────────────────────────

    it('getOpsSince 是**开区间**（不含 sinceSeq 本身）', async () => {
      await withStore(async (store) => {
        const ops = [makeOp(), makeOp(), makeOp()];
        await store.appendLocal(ops);
        const [a, b, c] = ops.map((o) => o.id);

        expect(ids(await store.getOpsSince(0))).toEqual([a, b, c]);
        expect(ids(await store.getOpsSince(1))).toEqual([b, c]);
        expect(ids(await store.getOpsSince(3))).toEqual([]);
      });
    });

    it('getOpsSince 可以排除自己的客户端（避免回放自己写的东西）', async () => {
      await withStore(async (store) => {
        const other = makeOp({ clientId: 'other' });
        await store.appendLocal([makeOp({ clientId: 'me' }), other]);
        expect(ids(await store.getOpsSince(0, undefined, 'me'))).toEqual([other.id]);
      });
    });

    it('getOpsSince 尊重 limit', async () => {
      await withStore(async (store) => {
        const ops = [makeOp(), makeOp(), makeOp()];
        await store.appendLocal(ops);
        expect(ids(await store.getOpsSince(0, 2))).toEqual([ops[0]!.id, ops[1]!.id]);
      });
    });

    it('getOpsForEntity 只返回该实体、且按 seq 升序', async () => {
      await withStore(async (store) => {
        const first = makeOp({ entityId: 'a' });
        const third = makeOp({ entityId: 'a' });
        await store.appendLocal([first, makeOp({ entityId: 'b' }), third]);

        const rows = await store.getOpsForEntity('TASK' as never, 'a');
        expect(ids(rows)).toEqual([first.id, third.id]);
      });
    });

    it('getAllOps 按 seq 升序返回', async () => {
      await withStore(async (store) => {
        const ops = [makeOp(), makeOp(), makeOp()];
        await store.appendLocal(ops);
        expect(ids(await store.getAllOps())).toEqual(ops.map((o) => o.id));
      });
    });

    it('D1 checkpoint hooks are durable and optional at transport boundaries', async () => {
      await withStore(async (store) => {
        if (store.readCheckpoint === undefined || store.writeCheckpoint === undefined) return;
        await store.appendLocal([makeOp()]);
        const checkpointBase = {
          formatVersion: 1 as const,
          coveredSeq: 1,
          state: { formatVersion: 1, buckets: { tasks: { t1: { data: { id: 't1' }, entityVersions: [], fieldVersions: {} } } } },
          clock: { device: 7 },
          appliedOpIds: ['op-7'],
        };
        const checkpoint = {
          ...checkpointBase,
          checksum: checkpointChecksum(checkpointBase),
        };
        await store.writeCheckpoint(checkpoint);
        expect(await store.readCheckpoint()).toEqual(checkpoint);
      });
    });

    it('observed clock 默认为空，并按组件取 max 合并', async () => {
      await withStore(async (store) => {
        if (store.readObservedClock === undefined || store.mergeObservedClock === undefined) return;

        expect(await store.readObservedClock()).toEqual({});
        await store.mergeObservedClock({ alpha: 4, beta: 2 });
        await store.mergeObservedClock({ alpha: 3, gamma: 9 });
        expect(await store.readObservedClock()).toEqual({ alpha: 4, beta: 2, gamma: 9 });
      });
    });

    it('observed clock 合并是事务化并发安全的，不丢不同维度或更大的计数', async () => {
      await withStore(async (store) => {
        if (store.readObservedClock === undefined || store.mergeObservedClock === undefined) return;

        await Promise.all([
          store.mergeObservedClock({ alpha: 3 }),
          store.mergeObservedClock({ beta: 7 }),
          store.mergeObservedClock({ alpha: 11 }),
          store.mergeObservedClock({ gamma: 5 }),
          store.mergeObservedClock({ beta: 2 }),
        ]);
        expect(await store.readObservedClock()).toEqual({ alpha: 11, beta: 7, gamma: 5 });
      });
    });

    it('observed clock 跨 store reopen 保留，且与损坏 checkpoint 独立', async () => {
      await withStore(async (store, db) => {
        if (store.readObservedClock === undefined || store.mergeObservedClock === undefined) return;

        await store.mergeObservedClock({ device: 42 });
        // 模拟一个损坏的、可删除的 materialized checkpoint；它不应遮蔽前沿。
        await db.put(STORES.META, {
          key: 'materializedCheckpoint',
          value: { formatVersion: 1, coveredSeq: 999, checksum: 'broken' },
        });
        // 重新实例化 store，模拟恢复阶段重新取得存储句柄。各 DbAdapter
        // 的真实 close/reopen 磁盘覆盖由 sqlite 独有持久化测试负责；这里
        // 让同一套契约也覆盖 Worker 代理与内存实现。
        const reopened = create(db);
        expect(await reopened.readObservedClock?.()).toEqual({ device: 42 });
        expect(await reopened.readCheckpoint?.()).toEqual({
          formatVersion: 1,
          coveredSeq: 999,
          checksum: 'broken',
        });
      });
    });

    it('observed clock 拒绝非法、负数、非安全整数且不污染已有值', async () => {
      await withStore(async (store) => {
        if (store.readObservedClock === undefined || store.mergeObservedClock === undefined) return;

        await store.mergeObservedClock({ stable: 8 });
        const invalid = [
          null,
          [],
          'clock',
          { negative: -1 },
          { fraction: 1.5 },
          { nan: Number.NaN },
          { infinity: Number.POSITIVE_INFINITY },
          { tooLarge: Number.MAX_SAFE_INTEGER + 1 },
        ] as unknown[];
        for (const clock of invalid) {
          await expect(
            store.mergeObservedClock(clock as Record<string, number>),
          ).rejects.toThrow();
        }
        expect(await store.readObservedClock()).toEqual({ stable: 8 });
      });
    });

    it('历史不完整标记默认 false、只能置 true，且不受 checkpoint 损坏或删除影响', async () => {
      await withStore(async (store, db) => {
        if (store.hasIncompleteHistory === undefined || store.markHistoryIncomplete === undefined) return;

        expect(await store.hasIncompleteHistory()).toBe(false);
        await store.markHistoryIncomplete();
        expect(await store.hasIncompleteHistory()).toBe(true);

        // checkpoint 损坏时仍必须保留“历史不完整”事实。
        await db.put(STORES.META, {
          key: 'materializedCheckpoint',
          value: { formatVersion: 1, coveredSeq: 999, checksum: 'broken' },
        });
        const afterCorruption = create(db);
        expect(await afterCorruption.hasIncompleteHistory?.()).toBe(true);

        // checkpoint 被删除也不能提供清除标记的旁路。
        await db.delete(STORES.META, 'materializedCheckpoint');
        const afterDeletion = create(db);
        expect(await afterDeletion.hasIncompleteHistory?.()).toBe(true);
      });
    });

    it('历史不完整标记跨 store 重实例化保留', async () => {
      await withStore(async (store, db) => {
        if (store.hasIncompleteHistory === undefined || store.markHistoryIncomplete === undefined) return;

        await store.markHistoryIncomplete();
        const reopened = create(db);
        expect(await reopened.hasIncompleteHistory?.()).toBe(true);
      });
    });

    // ── 崩溃恢复 ───────────────────────────────────────────

    it('本地 op 写入即已应用，不进待应用队列', async () => {
      await withStore(async (store) => {
        await store.appendLocal([makeOp()]);
        expect(await store.findPendingApply()).toHaveLength(0);
      });
    });

    it('🔴 远程 op 进入待应用队列，markApplied 后移出（崩溃恢复闭环）', async () => {
      await withStore(async (store) => {
        const ops = [makeOp(), makeOp()];
        await store.appendBatchSkipDuplicates(ops, 'remote', { pendingApply: true });

        const pending = await store.findPendingApply();
        expect(pending).toHaveLength(2);
        // 用真实 seq，不假设从 1 开始（每个用例是独立的库，但不要依赖这一点）
        const seqs = pending.map((r) => r[OP_FIELDS.SEQ] as number);

        await store.markApplied([seqs[0]!]);
        expect(ids(await store.findPendingApply())).toEqual([ops[1]!.id]);

        await store.markApplied([seqs[1]!]);
        expect(await store.findPendingApply()).toHaveLength(0);
      });
    });

    it('🔴 待应用与待上传是**两个独立队列**', async () => {
      await withStore(async (store) => {
        // 本地 op：待上传，不待应用
        const local = makeOp();
        await store.appendLocal([local]);
        // 远程 op：待应用，不待上传（我们本来就收到了）
        const remote = makeOp();
        await store.appendBatchSkipDuplicates([remote], 'remote', { pendingApply: true });

        expect(ids(await store.findPendingUpload())).toEqual([local.id]);
        expect(ids(await store.findPendingApply())).toEqual([remote.id]);
      });
    });

    // ── 导入（从一份导出文档还原）───────────────────────────
    //
    // 这段契约守的是"还原"路径的两条硬要求：
    //   1. `source` 必须是 `'import'` —— 证据链要能区分"我写的"与"搬回来的"；
    //   2. **不进上传队列** —— 导入的 op 带着别的设备的 `clientId`，
    //      服务端会逐条以 `INVALID_CLIENT_ID` 拒绝（validation.service.ts），
    //      排进队列只会得到一批永久拒绝。这是产品结论，不是实现细节。

    it('🔴 导入的 op 记为 import，且**不进**上传队列', async () => {
      await withStore(async (store) => {
        const op = makeOp({ clientId: 'other-device' });
        const result = await store.appendImported([op]);

        expect(result.appended.map((o) => o.id)).toEqual([op.id]);
        expect(await store.findPendingUpload()).toHaveLength(0);
        expect(await store.findPendingApply()).toHaveLength(0);
        const rows = await store.getAllOps();
        expect(rows[0]?.source).toBe('import');
      });
    });

    it('导入与本地写入共用同一条 seq 序列（仍然无空洞）', async () => {
      await withStore(async (store) => {
        await store.appendLocal([makeOp()]);
        const imported = await store.appendImported([makeOp(), makeOp()]);
        expect(imported.seqs).toEqual([2, 3]);
        expect(await store.getLastLocalSeq()).toBe(3);
      });
    });

    it('重复导入同一 op 被跳过，而不是报错或写第二条', async () => {
      await withStore(async (store) => {
        const op = makeOp();
        const first = await store.appendImported([op]);
        const second = await store.appendImported([op]);

        expect(first.appended).toHaveLength(1);
        expect(first.skipped).toHaveLength(0);
        expect(second.appended).toHaveLength(0);
        expect(second.skipped.map((o) => o.id)).toEqual([op.id]);
        expect(await store.getAllOps()).toHaveLength(1);
        expect(await store.getLastLocalSeq()).toBe(1);
      });
    });

    // ── 上传队列 ───────────────────────────────────────────

    it('🔴 待上传队列按本地 seq 升序（上传顺序必须与产出顺序一致）', async () => {
      await withStore(async (store) => {
        const ops = [makeOp(), makeOp(), makeOp()];
        for (const op of ops) await store.appendLocal([op]);

        const queue = await store.findPendingUpload();
        expect(ids(queue)).toEqual(ops.map((o) => o.id));
        // 上传顺序必须与产出顺序一致
        const seqs = queue.map((r) => r[OP_FIELDS.SEQ] as number);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      });
    });

    it('markUploaded 把 op 移出待上传队列，并回写服务端 seq', async () => {
      await withStore(async (store) => {
        const ops = [makeOp(), makeOp()];
        await store.appendLocal(ops);

        const updated = await store.markUploaded(new Map([[ops[0]!.id, 900]]));
        expect(updated).toBe(1);

        expect(ids(await store.findPendingUpload())).toEqual([ops[1]!.id]);
        const row = (await store.getAllOps()).find((r) => r.op.id === ops[0]!.id);
        expect(row?.serverSeq).toBe(900);
      });
    });

    it('markUploaded 对不存在的 opId 是安全空操作', async () => {
      await withStore(async (store) => {
        await store.appendLocal([makeOp()]);
        expect(await store.markUploaded(new Map([['nope', 1]]))).toBe(0);
        expect(await store.findPendingUpload()).toHaveLength(1);
      });
    });

    it('🔴 discardPendingUpload 只移出队列，**不删除 op**（事实来源不能被清理）', async () => {
      await withStore(async (store) => {
        const ops = [makeOp(), makeOp()];
        await store.appendLocal(ops);

        const n = await store.discardPendingUpload([ops[0]!.id]);
        expect(n).toBe(1);

        // 队列里没了
        expect(ids(await store.findPendingUpload())).toEqual([ops[1]!.id]);
        // 但日志里**还在** —— 这是 op-log 与"删除"的根本区别
        expect(ids(await store.getAllOps())).toEqual(ops.map((o) => o.id));
      });
    });

    it('discardPendingUpload 对不存在的 opId 是安全空操作', async () => {
      await withStore(async (store) => {
        expect(await store.discardPendingUpload(['nope'])).toBe(0);
      });
    });

    it('🔴 markRejected 把 op 移出队列，但**不标成已上传**（拒绝 ≠ 成功）', async () => {
      await withStore(async (store) => {
        const ops = [makeOp(), makeOp()];
        await store.appendLocal(ops);

        const n = await store.markRejected([ops[0]!.id]);
        expect(n).toBe(1);

        // 队列里没了 —— 否则这条永远传不上去的 op 会每次同步都被重传并被拒
        expect(ids(await store.findPendingUpload())).toEqual([ops[1]!.id]);
        // 日志里还在 —— 移出队列 ≠ 删除事实
        expect(ids(await store.getAllOps())).toEqual(ops.map((o) => o.id));

        // 🔴 但它**不是** uploaded：那等于说"这条在云上"，而服务端刚拒绝了它。
        // 这个断言是"拒绝态可观测"的存储层保证 —— 少了它，验收脚本就只能断言
        // "队列空了"，而"队列空了"在**数据被静默丢弃**时同样成立。
        // ⚠️ 记录形状是 `{ op, source, applyStatus, uploadStatus, seq }` ——
        // op 的业务字段是**嵌套**的，`o.id` 永远是 undefined。
        // （我第一版就写成了 `o.id`，于是 find 恒返回 undefined，
        //   断言读到的自然也是 undefined。查 `OpFieldName` 那一段注释。）
        const all = await store.getAllOps();
        const rejected = all.find((o) => o.op.id === ops[0]!.id);
        expect(rejected?.uploadStatus).toBe('rejected');
        const stillPending = all.find((o) => o.op.id === ops[1]!.id);
        expect(stillPending?.uploadStatus).toBe('pending');
      });
    });

    it('markRejected 对不存在的 opId 是安全空操作', async () => {
      await withStore(async (store) => {
        expect(await store.markRejected(['nope'])).toBe(0);
      });
    });

    /**
     * 🔴 A 包验收记录 §三 第 4 条那个缺口的存储层判据：
     * **"没上传" = `pending + rejected`，而两个数必须都读得到。**
     *
     * 为什么这条必须存在（而不是"界面自己减一下"）：`markRejected` 把 op 移出
     * pending 队列，所以只看 `countPendingUpload()` 时，一次永久拒绝会让读数
     * **下降** —— 界面上「3 项没上传」变成「2 项没上传」，而一分数据都没多上去。
     *
     * 能红的注入（本轮实测过）：把 `countRejectedUpload()` 实现里的 `'rejected'`
     * 改回 `'pending'` ⇒ 下面第一条断言读到 3 而不是 0、第二条读到 0 而不是 1。
     * ⚠️ 换成"恒返回 0"也会红在同一条上 —— 但**只有**在真有 rejected 行时才红，
     * 所以下面刻意先断言空库为 0、再造一条，两个方向都量。
     */
    it('🔴 countRejectedUpload 数的是 rejected 那一档，且与原队列此消彼长', async () => {
      await withStore(async (store) => {
        // ① 空库：0（"没有"与"数不出来"在这一格上同形，所以必须接着往下量）
        expect(await store.countRejectedUpload()).toBe(0);

        const ops = [makeOp(), makeOp(), makeOp()];
        await store.appendLocal(ops);
        expect(await store.countPendingUpload()).toBe(3);
        expect(await store.countRejectedUpload()).toBe(0);

        // ② 永久拒绝一条 ⇒ 从 pending 那一档**搬到** rejected 那一档
        expect(await store.markRejected([ops[1]!.id])).toBe(1);
        expect(await store.countPendingUpload()).toBe(2);
        expect(
          await store.countRejectedUpload(),
          'markRejected 之后 rejected 数没涨 ⇒ 界面上"没上传"会凭空少一条',
        ).toBe(1);
        // ③ 两个数之和 == 真正"没到服务端"的条数（界面那句 N 的口径）。
        // 🔴 这里刻意写 **3** 而不是 2：本机产生 3 条、服务端一条都没接受过，
        // 所以"没上传"必须是 3。而 `countPendingUpload()` 此刻只会说 **2** ——
        // 那个差额就是这条方法存在的全部理由。
        expect(
          (await store.countPendingUpload()) + (await store.countRejectedUpload()),
          '没上传 = pending + rejected，这个和必须等于本机产生、服务端没接受的全部 op',
        ).toBe(3);
        expect(
          await store.countPendingUpload(),
          'pending 单项在这一格会**少报一条** —— 这正是 A 包验收记录 §三 第 4 条那个缺口',
        ).toBe(2);

        // ④ 拒绝 ≠ 上传：标成 rejected 的行**不会**让"已上传"看起来多一条
        const all = await store.getAllOps();
        expect(all.filter((o) => o.uploadStatus === 'uploaded')).toHaveLength(0);

        // ⑤ 再拒绝一条：单调累加（本轮**不**解"rejected 永久堆积"那个问题，
        //    但那个事实必须在这里可见 —— 见计划 §6 的残余登记）
        expect(await store.markRejected([ops[2]!.id])).toBe(1);
        expect(await store.countRejectedUpload()).toBe(2);
        expect(await store.countPendingUpload()).toBe(1);
      });
    });

    // ── 归档 ───────────────────────────────────────────────

    it('archiveUpTo 把老 op 移入归档，但日志仍可读', async () => {
      await withStore(async (store) => {
        await store.appendImported(Array.from({ length: 505 }, () => makeOp()));

        const checkpoint = {
          formatVersion: 1 as const,
          coveredSeq: 5,
          state: { formatVersion: 1, buckets: {} },
          clock: { 'client-a': 505 },
          appliedOpIds: [],
        };
        if (store.writeCheckpoint !== undefined) {
          await store.writeCheckpoint({ ...checkpoint, checksum: checkpointChecksum(checkpoint) });
        }

        const archived = await store.archiveUpTo(505);
        expect(archived).toBeGreaterThanOrEqual(1);
        // 无论归档策略如何，**不能丢数据**
        expect(await store.getAllOps()).toHaveLength(505);
      });
    });

    it('没有覆盖归档边界的 checkpoint 时拒绝归档', async () => {
      await withStore(async (store) => {
        await store.appendImported(Array.from({ length: 505 }, () => makeOp()));
        if (store.writeCheckpoint === undefined) return;
        await expect(store.archiveUpTo(505)).rejects.toThrow('需要一个覆盖至少');
      });
    });

    it('archival preserves pending queues and global opId uniqueness', async () => {
      await withStore(async (store) => {
        const ops = Array.from({ length: 505 }, () => makeOp());
        await store.appendLocal(ops);
        await store.markUploaded(new Map(ops.slice(2).map((op, i) => [op.id, i + 3])));
        await store.markRejected([ops[1]!.id]);
        const base = { formatVersion: 1 as const, coveredSeq: 505,
          state: { formatVersion: 1, buckets: {} }, clock: {}, appliedOpIds: [] };
        await store.writeCheckpoint!({ ...base, checksum: checkpointChecksum(base) });
        expect(await store.archiveUpTo(505)).toBe(2);
        expect(ids(await store.findPendingUpload())).toEqual([ops[0]!.id]);
        const result = await store.appendBatchSkipDuplicates([ops[2]!], 'remote', { pendingApply: true });
        expect(result.skippedCount).toBe(1);
        expect(await store.getAllOps()).toHaveLength(505);
        expect((await store.getAllOps())[1]!.uploadStatus).toBe('rejected');
        expect(await store.findPendingApply()).toHaveLength(0);
        expect(ids(await store.getOpsForEntity('TASK', 'task-1'))).toEqual(ops.map((op) => op.id));
        const baseInvalid = { ...base, coveredSeq: 1 };
        await store.writeCheckpoint!({ ...baseInvalid, checksum: checkpointChecksum(baseInvalid) });
        await expect(store.archiveUpTo(505)).rejects.toThrow('需要一个覆盖至少');
      });
    });

    it('clears obsolete full-state rows in both stores and invalidates their checkpoint', async () => {
      await withStore(async (store) => {
        const old = makeOp({ payload: { isFullState: true } });
        const latest = makeOp({ payload: { isFullState: true } });
        await store.appendImported([old, ...Array.from({ length: 503 }, () => makeOp()), latest]);
        const base = { formatVersion: 1 as const, coveredSeq: 4,
          state: { formatVersion: 1, buckets: {} }, clock: {}, appliedOpIds: [] };
        await store.writeCheckpoint!({ ...base, checksum: checkpointChecksum(base) });
        expect(await store.archiveUpTo(505)).toBe(4);
        expect(await store.clearFullStateOpsExcept([latest.id])).toBe(1);
        expect(await store.readCheckpoint!()).toBeUndefined();
        expect(ids(await store.getAllOps()).includes(old.id)).toBe(false);
        expect(ids(await store.getAllOps()).includes(latest.id)).toBe(true);
      });
    });

    // ── 游标 ───────────────────────────────────────────────

    it('同步游标读写', async () => {
      await withStore(async (store) => {
        expect(await store.getLastServerSeq()).toBe(0);
        await store.setLastServerSeq(42);
        expect(await store.getLastServerSeq()).toBe(42);
        await store.setLastServerSeq(7);
        expect(await store.getLastServerSeq()).toBe(7);
      });
    });

    /**
     * META 的通用读写（公共事实缓存的落点，ADR-0052 §2.5）。
     *
     * 🔴 这四条各自挡一种"看起来没事"的坏法：
     *  · 查不存在的键回 `0` / `''` 而不是 `undefined` ⇒ 上层会把"从没缓存过"
     *    读成"缓存了一条空值"，判据①那条"没有覆盖也是正常状态"就没了载体；
     *  · 数字被存成字符串（SQLite 那套最容易）⇒ 上层 `typeof === 'number'` 恒假，
     *    表现为"拉取时间永远是 0"，而界面一个错都不报；
     *  · 实现直接把值写到 OPS / 别的 store ⇒ 会污染 op-log 的账；
     *  · 覆盖写没生效 ⇒ 条件请求拿着旧 ETag 一直 304，部署方改了公告也读不到。
     */
    it('META 通用读写：缺键给 undefined、值型不变、覆盖生效、不碰游标', async () => {
      await withStore(async (store) => {
        expect(await store.getMetaValue('publicFactsEtag')).toBeUndefined();

        await store.setMetaValue('publicFactsEtag', '1730000000000.1.2');
        expect(await store.getMetaValue('publicFactsEtag')).toBe('1730000000000.1.2');

        await store.setMetaValue('publicFactsFetchedAt', 1234);
        const fetchedAt = await store.getMetaValue('publicFactsFetchedAt');
        expect(typeof fetchedAt, `数字存成了 ${typeof fetchedAt} —— 上层的数字判定会恒假`).toBe('number');
        expect(fetchedAt).toBe(1234);

        await store.setMetaValue('publicFactsEtag', '1730000000000.9.9');
        expect(await store.getMetaValue('publicFactsEtag')).toBe('1730000000000.9.9');

        // 游标与公共事实同住 META，但互不打扰。
        expect(await store.getLastServerSeq()).toBe(0);
      });
    });

    /**
     * 计数 / 存在性方法（P1-10）
     * ==========================
     *
     * 这三条各挡一种坏法，缺一条就会有一种"看起来做完了"的假实现过关：
     *
     * ① **数得对不对。** 徽标上那个数字是这条路径的全部产出，数错了界面就开始
     *    说谎，而没有任何一层会报错。同时它证明计数与物化方法**逐字同数** ——
     *    等价性前提（`uploadStatus==='pending'` 只可能是本地写入）也在这里量出来：
     *    谁哪天让远端 op 也进 pending，`countPendingUpload()` 就会开始多报，
     *    而引擎侧那个 `filter(source === 'local')` 会把它遮住。
     * ② **归档必须算进总数。** 只数热区的计数会让「还原只允许空库」那条守卫
     *    在一台**有归档历史**的设备上放行 —— 于是还原把数据写进一个其实不空的库。
     * ③ **不许把行读回来。** 没有这一条，"加一个 count 方法、实现成
     *    `getAllFromIndex(...).length`" 也算"接口上有计数"，而那**正是** P1-10
     *    要修的东西。⚠️ 这一腿量的是**适配器层的物化读**（`getAll` /
     *    `getAllFromIndex` 被调了几次、返回几行）；SQLite 的 `countFromIndex`
     *    内部仍然取回命中行，那是另一条独立的债（审计文档 P1-11），不在这里遮。
     */
    it('🔴 计数与物化同数、含归档、且计数不读回行（P1-10）', async () => {
      await withStore(async (store, db) => {
        let materializedRows = 0;
        const originalGetAll = db.getAll.bind(db);
        const originalGetAllFromIndex = db.getAllFromIndex.bind(db);
        db.getAll = (async (...args: Parameters<DbAdapter['getAll']>) => {
          const rows = await originalGetAll(...args);
          materializedRows += rows.length;
          return rows;
        }) as DbAdapter['getAll'];
        db.getAllFromIndex = (async (...args: Parameters<DbAdapter['getAllFromIndex']>) => {
          const rows = await originalGetAllFromIndex(...args);
          materializedRows += rows.length;
          return rows;
        }) as DbAdapter['getAllFromIndex'];

        // 空库：三个计数都必须是 0（守卫的默认分支就靠这个）。
        expect(await store.countAllOps()).toBe(0);
        expect(await store.countPendingUpload()).toBe(0);
        expect(await store.countPendingApply()).toBe(0);

        const local = [makeOp(), makeOp(), makeOp()];
        await store.appendLocal(local);
        await store.appendBatchSkipDuplicates([makeOp({ entityId: 'task-remote' })], 'remote', {
          pendingApply: true,
        });

        // ① 计数 == 物化方法同数，而且是设计中的那个数
        expect(await store.countPendingUpload()).toBe((await store.findPendingUpload()).length);
        expect(await store.countPendingUpload()).toBe(3);
        expect(await store.countPendingApply()).toBe((await store.findPendingApply()).length);
        expect(await store.countPendingApply()).toBe(1);
        expect(await store.countAllOps()).toBe((await store.getAllOps()).length);
        expect(await store.countAllOps()).toBe(4);

        // ①' 等价性前提现量：pending 队列里不许出现非本地写入的行
        for (const row of await store.findPendingUpload()) {
          expect(row.source, 'pending 里出现了非 local 行 ⇒ countPendingUpload 会开始多报').toBe(
            'local',
          );
        }

        // ③ 计数期间一次物化读都不许发生（前面那些物化调用先把计数清零）
        materializedRows = 0;
        expect(await store.countPendingUpload()).toBe(3);
        expect(await store.countPendingApply()).toBe(1);
        expect(await store.countAllOps()).toBe(4);
        expect(
          materializedRows,
          '计数被实现成"取回全部命中行再数"就还是 P1-10 的病灶',
        ).toBe(0);
        // 阳性对照：同一台探针下，物化方法必须**真的**被数到 ——
        // 否则上面那条 0 是探针坏了，不是实现便宜。
        materializedRows = 0;
        await store.findPendingUpload();
        expect(materializedRows, '探针读不到物化读 ⇒ 上面那条 0 不算证据').toBeGreaterThan(0);

        // ② 归档之后：总数必须仍等于 getAllOps 的长度（含 ARCHIVE 里的行）。
        // 夹具形状照本文件那条归档用例：`archiveKeepRecent` 默认 500，
        // 所以 `archiveUpTo(509)` 的 cutoff 是 9 ⇒ seq 5..8 那四条"已上传且已应用"的
        // 本地行会被移进归档，而前面 3 条待上传与 1 条待应用的留在热区。
        const ops = Array.from({ length: 505 }, () => makeOp());
        await store.appendLocal(ops);
        await store.markUploaded(new Map(ops.map((op, i) => [op.id, i + 5])));
        const base = {
          formatVersion: 1 as const,
          coveredSeq: 509,
          state: { formatVersion: 1, buckets: {} },
          clock: {},
          appliedOpIds: [],
        };
        await store.writeCheckpoint!({ ...base, checksum: checkpointChecksum(base) });
        const archived = await store.archiveUpTo(509);
        expect(archived, '夹具没归档出任何东西 ⇒ 这一腿会空跑').toBeGreaterThan(0);

        materializedRows = 0;
        const counted = await store.countAllOps();
        expect(materializedRows, '归档后的总数也不许靠读回行来数').toBe(0);
        expect(counted).toBe((await store.getAllOps()).length);
        // 🔴 这一条才是"归档必须算进总数"的牙：热区单独计数**必然**小于总数。
        // 把 `countAllOps` 实现成只数 OPS，它当场转红。
        const hotOnly = await db.count(STORES.OPS);
        expect(
          hotOnly,
          `归档了 ${String(archived)} 条却数不出差额 ⇒ 总数没算 ARCHIVE`,
        ).toBeLessThan(counted);
        expect(counted - hotOnly).toBe(archived);
      });
    });

    /**
     * 🔴 P1-10b：上面那条判据的探针**钉错了层**，这一条把它下沉到 driver。
     *
     * ## 洞在哪（实测，不是推测）
     *
     * P1-10 那条 spy 的是 `db.getAll` / `db.getAllFromIndex` —— 两个**物化**方法。
     * 而计数走的是**第三个**接口方法 `db.countFromIndex`；SQLite 那边它是
     * `fetchIndexRecords(...).length`，而 `fetchIndexRecords` 执行的是
     * `SELECT * FROM "ops" WHERE "ix1_0" = ?` 再由 `driver.all` 把**每一行**取回来映射。
     * ⇒ 真正的物化发生在 `countFromIndex` **内部**、经由 **driver**，
     * **全程不经过那两个 spy**。于是"计数期间 materializedRows === 0"在 SQLite 后端上
     * 照样成立，而 SQLite 现在正是"取回命中行再数长度"的实现。
     *
     * 一句话：**探针只能看见它自己钉住的那一个方法**。判据绿着，
     * 于是"这条代价已经修好了"这个误会没人会怀疑 —— 这与 #667（注释里的断言没人核）
     * 是同一族的下一代：**断言钉在接口层，而病灶在接口下面那一层**。
     *
     * ## 这条判据量什么（形状，不是"有没有调用某个方法"）
     *
     * 包住 driver 的 `all` / `get`，数**离开存储层的行数**：按索引键的一次查询
     * 至多带回**命中**的那些行；而全表扫描（或"先 SELECT * 再 filter"）会把
     * 整张表带回来。夹具刻意让两者**量级可分**：3 条 pending + 20 条已上传。
     *
     * ⚠️ 这条判据**不要求 SQLite 现在就做到 0 行**（那是审计文档 P1-11 的债：
     * `countFromIndex` 取整行而不是 `SELECT COUNT(*)`）。它要求的是
     * **行数被索引键界住**，所以它今天绿、而实现一旦退回全表扫描就红。
     * 能红的注入（本轮实测）：把 SQLite 的 `countFromIndex` 改成
     * `fetchRecords(driver, plan, undefined)` 再按索引列过滤 ⇒ 下面第一条当场红。
     *
     * ⚠️ Worker 桥接那一支的适配器在 Worker 里，`db` 上拿不到 driver
     * ⇒ 这一腿**跳过并打印**（跳过是打印出来的，不是安静地过）。
     */
    it('🔴 计数由索引键界住，不是回表扫描（P1-10b，driver 层现量）', async () => {
      await withStore(async (store, db) => {
        // 夹具：3 条待上传 + 20 条"已上传"（导入的行一律 uploaded）。
        // 全表 23 行，命中 3 行 —— 两个量级在这里分开。
        await store.appendLocal([makeOp(), makeOp(), makeOp()]);
        await store.appendImported(Array.from({ length: 20 }, () => makeOp()));
        expect(await store.countAllOps()).toBe(23);
        expect(await store.countPendingUpload()).toBe(3);

        const probe = driverRowProbe(db);
        if (probe === undefined) {
          console.info(
            '[P1-10b] 这一支在 `db` 上拿不到 driver（适配器在 Worker/宿主另一侧）'
            + ' ⇒ driver 层这一腿**跳过**，读数不可用（登记，不静默通过）',
          );
          return;
        }

        let rowsForPending: number;
        let rowsForRejected: number;
        try {
          probe.reset();
          expect(await store.countPendingUpload()).toBe(3);
          rowsForPending = probe.rows();

          probe.reset();
          expect(await store.countRejectedUpload()).toBe(0);
          rowsForRejected = probe.rows();
        } finally {
          probe.restore();
        }

        console.info(
          `[P1-10b] ${name}：全表 23 行 / 命中 3 行 ⇒ `
          + `countPendingUpload 取回 ${String(rowsForPending)} 行，`
          + `countRejectedUpload（命中 0）取回 ${String(rowsForRejected)} 行`,
        );

        expect(
          rowsForPending,
          '计数把整张表都取回来了 ⇒ 那是全表扫描，不是按索引键取命中行（P1-10 的病灶换了一层又回来了）',
        ).toBeLessThanOrEqual(3);
        expect(
          rowsForRejected,
          '命中 0 条却取回了行 ⇒ 这一路没走索引键，量到的不是"命中的那些行"',
        ).toBe(0);
      });
    });
  });
}
