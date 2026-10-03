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
import { OP_FIELDS } from '../../src/stores.js';

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

export function runOpLogStoreContract({ name, createDb, create }: OpLogStoreContractOptions): void {
  describe(`OpLogStore 契约 —— ${name}`, () => {
    const withStore = async (
      fn: (store: OpLogStore<Operation<string>>) => Promise<void>,
    ): Promise<void> => {
      const db = await createDb();
      const store = create(db);
      try {
        await fn(store);
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

    // ── 归档 ───────────────────────────────────────────────

    it('archiveUpTo 把老 op 移入归档，但日志仍可读', async () => {
      await withStore(async (store) => {
        for (let i = 0; i < 5; i++) await store.appendLocal([makeOp()]);

        const archived = await store.archiveUpTo(3);
        expect(archived).toBeGreaterThanOrEqual(0);
        // 无论归档策略如何，**不能丢数据**
        expect(await store.getAllOps()).toHaveLength(5);
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
  });
}
