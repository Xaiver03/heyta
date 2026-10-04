/**
 * P1-10 在引擎侧的落点：三个消费者不再物化全表
 * =============================================
 *
 * 审计文档那条判据写的是：「断言取待上传条数时被物化的 `StoredOperation`
 * 对象数 = 0，并断言接口上存在 `count*` 形状的方法。今天两条都红。」
 *
 * 存储层那一半（计数**算法**对不对、有没有归档漏算）在
 * `packages/storage/tests/contract/op-log-store.contract.ts` 里跑遍三个后端。
 * 本文件钉的是**另一半**，而它才是界面上真付钱的那一半：
 *
 *   - 消费者有没有真的改用计数？（改了实现、消费者还在 `getAllOps().length`
 *     等于没做 —— 本仓库为这个形状记过不止一次）
 *   - 计数与物化方法必须**同数**（换错了方向就是徽标说谎）
 *
 * ⚠️ 探针的"能不能失败"由文件末尾那条阳性对照回答：同一个 spy 必须**数得到**
 *    物化调用。数不到的话上面那一片 0 全是假的。
 */

import { describe, expect, it, vi } from 'vitest';

import { OpLogEngine } from '../src/engine.js';
import { DbOpLogStore } from '@heyta/storage';
import { INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';
import { OpType, type Operation } from '@heyta/sync-core';

interface Fixture {
  engine: OpLogEngine;
  store: DbOpLogStore<Operation<string>>;
  /** 只 spy 那两个"把行读回来"的入口，不改变行为。 */
  getAllOps: ReturnType<typeof vi.spyOn>;
  findPendingUpload: ReturnType<typeof vi.spyOn>;
  findPendingApply: ReturnType<typeof vi.spyOn>;
}

async function device(clientId = 'client-a'): Promise<Fixture> {
  const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await db.init();
  const store = new DbOpLogStore<Operation<string>>(db);
  const engine = new OpLogEngine({ store, clientId, now: () => 1_000 });
  await engine.recover();
  return {
    engine,
    store,
    getAllOps: vi.spyOn(store, 'getAllOps'),
    findPendingUpload: vi.spyOn(store, 'findPendingUpload'),
    findPendingApply: vi.spyOn(store, 'findPendingApply'),
  };
}

const zero = (spy: ReturnType<typeof vi.spyOn>): number => spy.mock.calls.length;

describe('P1-10 引擎与宿主的读侧', () => {
  it('🔴 countPendingUpload 与列表同数，且一个物化调用都不发生', async () => {
    const f = await device();
    await f.engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: '甲' } });
    await f.engine.dispatch({ entityType: 'TASK', entityId: 't2', opType: OpType.Create, payload: { title: '乙' } });

    const listed = (await f.engine.getPendingUpload()).length;
    expect(listed).toBeGreaterThan(0);

    f.findPendingUpload.mockClear();
    f.getAllOps.mockClear();
    const counted = await f.engine.countPendingUpload();

    expect(counted, '计数与物化方法必须同数').toBe(listed);
    // 🔴 这一条才是 P1-10：徽标每次刷新都不该把整条队列搬进内存。
    expect(zero(f.findPendingUpload), '还在走 findPendingUpload().length ⇒ 队列被整个物化').toBe(0);
    expect(zero(f.getAllOps), '取一个条数却读了全库 ⇒ 比原来更糟').toBe(0);
  });

  it('🔴 countStoredOps 与 getAllOps 同数，且不读回任何行', async () => {
    const f = await device();
    await f.engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: '甲' } });

    const materialized = (await f.engine.getAllOps()).length;
    expect(materialized).toBeGreaterThan(0);

    f.getAllOps.mockClear();
    const counted = await f.engine.countStoredOps();
    expect(counted, '空库守卫拿到的数必须和读全库一致').toBe(materialized);
    expect(zero(f.getAllOps), '点一次"还原"就把整库连密文搬进内存数一遍').toBe(0);

    // 阳性对照：同一个 spy 必须**数得到**物化读，否则上面那个 0 不算证据。
    f.getAllOps.mockClear();
    await f.engine.getAllOps();
    expect(zero(f.getAllOps), '探针看不见 getAllOps 调用 ⇒ 这一整组 0 都是假的').toBe(1);
  });

  it('🔴 检查点前置判定：队列未排空时用计数拒绝，不物化任何行', async () => {
    const f = await device();
    await f.engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: '还没上传' } });

    f.getAllOps.mockClear();
    f.findPendingUpload.mockClear();
    f.findPendingApply.mockClear();

    // 待上传队列非空 ⇒ 必须在**第一道**就被挡住。
    await expect(f.engine.createSyncCheckpoint()).rejects.toThrow(/drained upload and apply queues/);

    expect(zero(f.findPendingUpload), '队列判定又把整条队列读回来 ⇒ P1-10 没做完').toBe(0);
    expect(zero(f.findPendingApply), '队列判定又把整条队列读回来 ⇒ P1-10 没做完').toBe(0);
    // 那道维护扫描（真的要逐条看 source/uploadStatus）此时**不该**被走到 ——
    // 它排在队列闸门后面。走到说明闸门没挡住。
    expect(zero(f.getAllOps), '还没过队列闸门就付了维护扫描的钱').toBe(0);
  });

  it('🔴 计数方法在接口上真的存在（不是只长在实现上，上层拿不到）', async () => {
    const f = await device();
    expect(typeof f.store.countAllOps).toBe('function');
    expect(typeof f.store.countPendingUpload).toBe('function');
    expect(typeof f.store.countPendingApply).toBe('function');
    expect(await f.store.countAllOps()).toBe(0);
    expect(await f.store.countPendingUpload()).toBe(0);
    expect(await f.store.countPendingApply()).toBe(0);
  });
});
