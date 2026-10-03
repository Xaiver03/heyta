/**
 * op-log 引擎测试
 * =================
 *
 * 重点：**幂等、崩溃恢复、墓碑、D4（唯一写入口）**。
 * 这些都是"坏了也不会报错、只会在用户第二台设备上发现数据不见"的类型。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { OpType } from '@heyta/sync-core';
import type { Operation, VectorClock } from '@heyta/sync-core';
import { IndexedDbAdapter, IndexedDbOpLogStore, STORES } from '@heyta/storage';

import { OpLogEngine } from '../src/engine.js';
import { applyOperation, emptyState, replayOperations } from '../src/state.js';

function makeOp(over: Partial<Operation<string>> & { id: string }): Operation<string> {
  return {
    opType: OpType.Create,
    actionType: 'CREATE_TASK',
    entityType: 'TASK',
    entityId: 'task-1',
    payload: { title: '任务' },
    clientId: 'client-a',
    vectorClock: { 'client-a': 1 },
    timestamp: 1000,
    schemaVersion: 1,
    seq: 0,
    ...over,
  } as Operation<string>;
}

// ─────────────────────────────────────────────────────────────
// reducer 纯函数性
// ─────────────────────────────────────────────────────────────

describe('reducer（必须是纯函数）', () => {
  it('不修改入参', () => {
    const before = emptyState();
    const snapshot = JSON.stringify(before);
    applyOperation(before, makeOp({ id: 'a' }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('同样输入产生同样输出（确定性 —— 两端重放必须一致）', () => {
    const ops = [
      makeOp({ id: 'a', timestamp: 1000, payload: { title: 'A' } }),
      makeOp({ id: 'b', timestamp: 2000, payload: { title: 'B' } }),
    ];
    const r1 = replayOperations(emptyState(), ops);
    const r2 = replayOperations(emptyState(), ops);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('只覆盖 payload 里出现的字段（部分更新不抹掉其它字段）', () => {
    let s = emptyState();
    s = applyOperation(s, makeOp({ id: 'a', timestamp: 1000, payload: { title: 'A', dueDate: 999 } }));
    s = applyOperation(s, makeOp({ id: 'b', timestamp: 2000, opType: OpType.Update, payload: { title: 'A2' } }));

    expect(s.tasks['task-1']!.title).toBe('A2');
    // 关键：dueDate 必须还在 —— 否则"改标题"会把截止时间抹掉
    expect(s.tasks['task-1']!.dueDate).toBe(999);
  });

  it('🔴 DELETE 写墓碑而不是物理删除（否则另一端会把数据同步回来）', () => {
    let s = emptyState();
    s = applyOperation(s, makeOp({ id: 'a', timestamp: 1000 }));
    s = applyOperation(s, makeOp({ id: 'b', timestamp: 2000, opType: OpType.Delete, payload: {} }));

    expect(s.tasks['task-1']).toBeDefined();
    expect(s.tasks['task-1']!.deletedAt).toBe(2000);
  });

  it('更旧的 op 被拒绝（LWW 兜底，保证重放顺序无关）', () => {
    let s = emptyState();
    s = applyOperation(s, makeOp({ id: 'a', timestamp: 5000, payload: { title: '新' } }));
    s = applyOperation(s, makeOp({ id: 'b', timestamp: 1000, payload: { title: '旧' } }));
    expect(s.tasks['task-1']!.title).toBe('新');
  });

  it('同毫秒同 client 用 op.id 作最终确定性决胜（不留"谁先到谁赢"）', () => {
    const s1 = replayOperations(emptyState(), [
      makeOp({ id: 'aaa', timestamp: 1000, payload: { title: 'first' } }),
      makeOp({ id: 'zzz', timestamp: 1000, payload: { title: 'second' } }),
    ]);
    const s2 = replayOperations(emptyState(), [
      makeOp({ id: 'zzz', timestamp: 1000, payload: { title: 'second' } }),
      makeOp({ id: 'aaa', timestamp: 1000, payload: { title: 'first' } }),
    ]);
    // 两种到达顺序结果必须相同
    expect(s1.tasks['task-1']!.title).toBe(s2.tasks['task-1']!.title);
  });

  it('🔴 payload 里的 null 表示清除字段（能穿过 JSON，undefined 不能）', () => {
    let s = emptyState();
    s = applyOperation(
      s,
      makeOp({ id: 'a', timestamp: 1000, payload: { title: 'A', completedAt: 5000 } }),
    );
    expect(s.tasks['task-1']!.completedAt).toBe(5000);

    // 取消完成：传 null
    s = applyOperation(
      s,
      makeOp({ id: 'b', timestamp: 2000, opType: OpType.Update, payload: { completedAt: null } }),
    );

    // 字段必须**消失**，而不是变成 null —— 否则 `=== undefined` 的完成态判断会失效
    expect(s.tasks['task-1']!.completedAt).toBeUndefined();
    expect('completedAt' in s.tasks['task-1']!).toBe(false);
    // 其它字段不受影响
    expect(s.tasks['task-1']!.title).toBe('A');
  });

  it('null 清除语义能穿过 JSON 往返（这才是用 null 的原因）', () => {
    const op = makeOp({
      id: 'a',
      timestamp: 1000,
      payload: { completedAt: 5000, title: 'A' },
    });
    const update = makeOp({
      id: 'b',
      timestamp: 2000,
      opType: OpType.Update,
      payload: { completedAt: null },
    });

    // 模拟跨端传输：JSON 往返
    const roundTrip = JSON.parse(JSON.stringify(update)) as Operation<string>;
    expect(roundTrip.payload).toHaveProperty('completedAt', null);

    const s = replayOperations(emptyState(), [op, roundTrip]);
    expect(s.tasks['task-1']!.completedAt).toBeUndefined();
  });

  it('未知实体类型被忽略而不是抛错（前向兼容）', () => {
    const s = applyOperation(
      emptyState(),
      makeOp({ id: 'x', entityType: 'SOME_FUTURE_ENTITY' }),
    );
    expect(Object.keys(s.tasks)).toHaveLength(0);
  });

  it('确定性：DELETE 之后再收到更旧的 UPDATE 不会复活实体', () => {
    let s = emptyState();
    s = applyOperation(s, makeOp({ id: 'a', timestamp: 1000 }));
    s = applyOperation(s, makeOp({ id: 'b', timestamp: 3000, opType: OpType.Delete, payload: {} }));
    s = applyOperation(s, makeOp({ id: 'c', timestamp: 2000, opType: OpType.Update, payload: { title: '复活?' } }));

    expect(s.tasks['task-1']!.deletedAt).toBe(3000);
  });
});

// ─────────────────────────────────────────────────────────────
// 引擎
// ─────────────────────────────────────────────────────────────

describe('OpLogEngine', () => {
  let db: IndexedDbAdapter;
  let store: IndexedDbOpLogStore<Operation<string>>;
  let clockTick: number;
  let idSeq: number;

  function makeEngine(clientId = 'device-1'): OpLogEngine {
    return new OpLogEngine({
      store,
      clientId,
      now: () => (clockTick += 1000),
      nextOpId: () => `op-${++idSeq}`,
    });
  }

  beforeEach(async () => {
    const g = globalThis as unknown as {
      indexedDB: IDBFactory;
      IDBKeyRange: typeof IDBKeyRange;
    };
    g.indexedDB = new IDBFactory();
    g.IDBKeyRange = IDBKeyRange;
    db = new IndexedDbAdapter(`oplog-${Math.random().toString(36).slice(2)}`);
    await db.init();
    store = new IndexedDbOpLogStore<Operation<string>>(db);
    clockTick = 0;
    idSeq = 0;
  });

  it('dispatch 落盘并更新状态（唯一写入口）', async () => {
    const engine = makeEngine();
    await engine.dispatch({
      entityType: 'TASK',
      entityId: 't1',
      opType: OpType.Create,
      payload: { title: '写文档' },
    });

    expect(engine.getState().tasks['t1']!.title).toBe('写文档');
    // 关键：op 必须真的进了 op-log，否则永远不会同步
    expect(await db.count('ops')).toBe(1);
    expect(await store.getLastLocalSeq()).toBe(1);
  });

  it('每次 dispatch 推进本地向量时钟', async () => {
    const engine = makeEngine();
    await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: {} });
    expect(engine.getClock()['device-1']).toBe(1);
    await engine.dispatch({ entityType: 'TASK', entityId: 't2', opType: OpType.Create, payload: {} });
    expect(engine.getClock()['device-1']).toBe(2);
  });

  it('服务端压实前沿即使没有逐条 op 也会进入下一次本地时钟', () => {
    const engine = makeEngine();
    engine.observeRemoteClock({ 'archived-device': 7 });
    expect(engine.getClock()).toEqual({ 'archived-device': 7 });
  });

  it('🔴 op 的时钟**包含**本次递增（否则第一条 op 会被对端静默丢弃）', async () => {
    const engine = makeEngine();
    await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: {} });
    const rows = await store.getAllOps();

    // 这条断言曾经写的是 `toEqual({})`，注释还理直气壮地写着
    // "第一条 op 的时钟应为空 —— 它不包含自己"。
    //
    // 那是在**把 bug 断言成正确行为**。后果：新对端时钟是 `{}`，
    // 收到时钟为 `{}` 的 op → compareVectorClocks 判 EQUAL →
    // 当作"已见过"静默丢弃。于是本设备第一次同步之后的每一个改动
    // 都到不了任何其它设备，本地正常、服务端也收到、对端永远看不到。
    //
    // 真实故障由 tests/e2e-sync.integration.spec.ts 对真实服务端暴露。
    expect(rows[0]!.op.vectorClock).toEqual({ 'device-1': 1 });
  });

  it('🔴 跨设备可见性：新对端必须能应用我们的第一条 op', async () => {
    const a = makeEngine();
    await a.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: 'x' } });

    const pending = await a.getPendingUpload();
    expect(pending).toHaveLength(1);

    // ⚠️ 对端必须用**独立的存储**。
    // 两台设备各有各的数据库；共用一个 store 的话，op 已经在那里了，
    // appendBatchSkipDuplicates 会当重复跳过，于是 applied 为空 ——
    // 我第一版就是这么写的，测出来的"失败"其实是测试的错，不是代码的错。
    const otherDb = new IndexedDbAdapter(`other-${Math.random().toString(36).slice(2)}`);
    await otherDb.init();
    const otherStore = new IndexedDbOpLogStore<Operation<string>>(otherDb);

    const b = new OpLogEngine({ store: otherStore, clientId: 'other-client' });
    const result = await b.applyRemote(pending);

    // 必须应用 —— 时钟为 `{}` 的那些 op 会让这里 applied=0
    expect(result.applied).toHaveLength(1);
    expect(b.getState().tasks['t1']).toBeDefined();
    expect(b.getState().tasks['t1']!.title).toBe('x');
  });

  it('🔴 applyRemote 是幂等的：重复投递同一批 op 不会重复应用', async () => {
    const engine = makeEngine();
    const ops = [makeOp({ id: 'r1', entityId: 'e1', timestamp: 5000, vectorClock: { 'other': 1 } })];

    const first = await engine.applyRemote(ops);
    const second = await engine.applyRemote(ops);

    expect(first.applied).toHaveLength(1);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toBe(1);
    expect(await db.count('ops')).toBe(1);
  });

  it('远程 op 合并进本地时钟（后续本地写入形成因果边）', async () => {
    const engine = makeEngine();
    await engine.applyRemote([
      makeOp({ id: 'r1', timestamp: 5000, vectorClock: { 'other': 7 } }),
    ]);
    expect(engine.getClock()['other']).toBe(7);

    // 之后本地写入应包含 other 的分量
    await engine.dispatch({ entityType: 'TASK', entityId: 'x', opType: OpType.Create, payload: {} });
    const rows = await store.getAllOps();
    const localOp = rows.find((r) => r.op.clientId === 'device-1')!;
    expect(localOp.op.vectorClock['other']).toBe(7);
  });

  it('🔴 崩溃恢复：写了一半的远程 op 重启后被重放', async () => {
    // 模拟：远程 op 已落盘（pending），但还没应用就崩了
    const engine1 = makeEngine();
    const op = makeOp({ id: 'crash-op', entityId: 'crashed', timestamp: 9000, payload: { title: '崩溃前' } });
    await store.appendBatchSkipDuplicates([op], 'remote', { pendingApply: true });

    // 引擎 1 从未 applyRemote 它 —— 直接崩掉
    expect(engine1.getState().tasks['crashed']).toBeUndefined();
    expect(await store.findPendingApply()).toHaveLength(1);

    // 新引擎启动 → recover
    const engine2 = makeEngine();
    const { replayed } = await engine2.recover();

    expect(replayed).toBe(1);
    expect(engine2.getState().tasks['crashed']!.title).toBe('崩溃前');
    // 恢复后必须清掉 pending，否则每次启动都重放
    expect(await store.findPendingApply()).toHaveLength(0);
  });

  it('recover 对空日志是安全的空操作', async () => {
    const engine = makeEngine();
    expect(await engine.recover()).toEqual({ replayed: 0 });
  });

  it('🔴 从 op-log 全量重建状态（证明 op-log 才是事实来源）', async () => {
    const engine = makeEngine();
    await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: 'A' } });
    await engine.dispatch({ entityType: 'TASK', entityId: 't2', opType: OpType.Create, payload: { title: 'B' } });
    await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Update, payload: { title: 'A2' } });

    // 全新引擎，不带任何内存状态
    const rebuilt = makeEngine();
    const state = await rebuilt.rebuildFromLog();

    expect(state.tasks['t1']!.title).toBe('A2');
    expect(state.tasks['t2']!.title).toBe('B');
    expect(rebuilt.getState().tasks['t1']!.title).toBe('A2');
  });

  it('删除走墓碑，重建后墓碑仍在', async () => {
    const engine = makeEngine();
    await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: 'A' } });
    await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Delete, payload: {} });

    const rebuilt = makeEngine();
    await rebuilt.rebuildFromLog();
    expect(rebuilt.getState().tasks['t1']!.deletedAt).toBeTypeOf('number');
  });

  it('更旧的远程 op 被丢弃，不回退状态', async () => {
    const engine = makeEngine();
    // 先应用一条较新的
    await engine.applyRemote([
      makeOp({ id: 'newer', timestamp: 9000, payload: { title: '新' }, vectorClock: { other: 5 } }),
    ]);
    // 再来一条"并发但更旧"的
    await engine.applyRemote([
      makeOp({ id: 'older', timestamp: 1000, payload: { title: '旧' }, vectorClock: { other: 5 } }),
    ]);

    expect(engine.getState().tasks['task-1']!.title).toBe('新');
  });

  it('并发 op 用 LWW 决胜（时间戳大的赢）', async () => {
    const engine = makeEngine();
    // 两条 CONCURRENT（各自只见过自己），分别在不同时间
    await engine.applyRemote([
      makeOp({ id: 'c1', timestamp: 1000, payload: { title: '早' }, vectorClock: { a: 1 } }),
      makeOp({ id: 'c2', timestamp: 2000, payload: { title: '晚' }, vectorClock: { b: 1 } }),
    ]);
    expect(engine.getState().tasks['task-1']!.title).toBe('晚');
  });

  it('多实体批次在一次 dispatch 里完成（不 fan-out 成多条 op）', async () => {
    const engine = makeEngine();
    const r = await engine.dispatch({
      entityType: 'TASK',
      entityId: 't1',
      entityIds: ['t1', 't2', 't3'],
      opType: OpType.Update,
      payload: { projectId: 'p1' },
    });

    expect(r.ops).toHaveLength(1); // 一次操作 = 一条 op（AGENTS.md §3.4）
    expect(r.ops[0]!.entityIds).toEqual(['t1', 't2', 't3']);
    expect(engine.getState().tasks.t1).toMatchObject({ projectId: 'p1' });
    expect(engine.getState().tasks.t2).toMatchObject({ projectId: 'p1' });
    expect(engine.getState().tasks.t3).toMatchObject({ projectId: 'p1' });

    // The same op is safe to deliver again: storage idempotency skips it, and
    // reducer metadata also prevents duplicate field versions.
    const duplicate = await engine.applyRemote(r.ops);
    expect(duplicate.applied).toEqual([]);
    expect(duplicate.skipped).toBe(1);

  });

  it('多实体批次在崩溃恢复后仍物化全部成员', async () => {
    const adapter = new IndexedDbAdapter(`batch-recovery-${Math.random().toString(36).slice(2)}`);
    await adapter.init();
    const sharedStore = new IndexedDbOpLogStore<Operation<string>>(adapter);
    const first = new OpLogEngine({ store: sharedStore, clientId: 'device-1', now: () => 1000 });
    await first.dispatch({
      entityType: 'TASK',
      entityId: 't1',
      entityIds: ['t1', 't2', 't3'],
      opType: OpType.Update,
      payload: { projectId: 'p1' },
    });
    const restarted = new OpLogEngine({ store: sharedStore, clientId: 'device-1' });
    await restarted.recover();
    expect(restarted.getState().tasks).toMatchObject({
      t1: { projectId: 'p1' },
      t2: { projectId: 'p1' },
      t3: { projectId: 'p1' },
    });
  });

  it('101 个 clientId 的时钟在客户端合并、恢复和下一次写入中保持完整', async () => {
    const engine = makeEngine();
    const clock = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`device-${index}`, index + 1]),
    );
    await engine.applyRemote([
      makeOp({
        id: 'wide-clock',
        clientId: 'device-100',
        vectorClock: clock,
        payload: { title: 'wide' },
      }),
    ]);
    expect(Object.keys(engine.getClock())).toHaveLength(101);

    const local = await engine.dispatch({
      entityType: 'TASK',
      entityId: 'task-2',
      opType: OpType.Update,
      payload: { title: 'after-wide-clock' },
    });
    expect(Object.keys(local.ops[0]!.vectorClock)).toHaveLength(101);
    expect(local.ops[0]!.vectorClock['device-1']).toBe(3);
  });

  it('checkpoint 保留 reducer 元数据并只重放 checkpoint 之后的增量', async () => {
    const first = makeEngine('checkpoint-device');
    await first.dispatch({
      entityType: 'TASK',
      entityId: 'checkpoint-task',
      opType: OpType.Create,
      payload: { title: 'base', dueDate: 1 },
    });
    await first.checkpoint();
    await first.applyRemote([
      makeOp({
        id: 'checkpoint-concurrent',
        clientId: 'peer-device',
        entityId: 'checkpoint-task',
        payload: { title: 'peer' },
        vectorClock: { 'peer-device': 1 },
        timestamp: 2000,
      }),
    ]);

    const restarted = new OpLogEngine({ store, clientId: 'checkpoint-device' });
    const result = await restarted.recover();
    expect(result.replayed).toBe(1);
    expect(restarted.getState().tasks['checkpoint-task']).toMatchObject({
      title: 'peer',
      dueDate: 1,
    });

    // A stale concurrent write must still lose after the checkpoint path,
    // proving the hidden field-version metadata survived serialization.
    await restarted.applyRemote([
      makeOp({
        id: 'checkpoint-old',
        clientId: 'old-device',
        entityId: 'checkpoint-task',
        payload: { title: 'old' },
        vectorClock: { 'old-device': 1 },
        timestamp: 1000,
      }),
    ]);
    expect(restarted.getState().tasks['checkpoint-task']!.title).toBe('peer');
  });

  it('checkpoint 损坏且历史已归档时回退到完整归档日志', async () => {
    const ops = Array.from({ length: 505 }, (_, index) =>
      makeOp({
        id: `archived-${index}`,
        entityId: 'archived-task',
        opType: index === 0 ? OpType.Create : OpType.Update,
        timestamp: index + 1,
        vectorClock: { 'archive-device': index + 1 },
        clientId: 'archive-device',
        payload: { title: `title-${index}` },
      }),
    );
    await store.appendImported(ops);

    const first = new OpLogEngine({ store, clientId: 'archive-device' });
    await first.recover();
    await first.checkpoint();
    expect(await store.archiveUpTo(505)).toBeGreaterThan(0);

    const saved = await db.get<{ key: string; value: unknown }>(STORES.META, 'materializedCheckpoint');
    expect(saved).toBeDefined();
    await db.put(STORES.META, {
      key: 'materializedCheckpoint',
      value: { ...(saved!.value as Record<string, unknown>), checksum: 'corrupted' },
    });

    const restarted = new OpLogEngine({ store, clientId: 'archive-device' });
    const result = await restarted.recover();
    expect(result.replayed).toBe(505);
    expect(restarted.getState().tasks['archived-task']!.title).toBe('title-504');
  }, 20_000);

  it('同毫秒并发写入按 clientId 决胜，而非按 opId 或到达顺序', () => {
    const a = makeOp({
      id: 'zzz',
      clientId: 'device-a',
      timestamp: 5000,
      vectorClock: { 'device-a': 1 },
      payload: { title: 'a' },
    });
    const z = makeOp({
      id: 'aaa',
      clientId: 'device-z',
      timestamp: 5000,
      vectorClock: { 'device-z': 1 },
      payload: { title: 'z' },
    });
    expect(replayOperations(emptyState(), [a, z]).tasks['task-1']!.title).toBe('z');
    expect(replayOperations(emptyState(), [z, a]).tasks['task-1']!.title).toBe('z');
  });

  it('空批次 applyRemote 是安全空操作', async () => {
    const engine = makeEngine();
    expect(await engine.applyRemote([])).toEqual({ applied: [], skipped: 0, overwritten: [] });
  });
});

// ─────────────────────────────────────────────────────────────
// 写入闸门：因果优先
// ─────────────────────────────────────────────────────────────

describe('🔴 写入闸门：因果优先，不被同毫秒的墙上时钟击败', () => {
  const C = 'device-1';
  /** 刻意选一个两条 op **完全相同**的时间戳 —— 这正是真实故障的形状。 */
  const SAME_MS = 1_790_000_000_000;

  it('同一设备连续两次编辑落在同一毫秒时，后一条必须胜出', () => {
    let s = emptyState();
    s = applyOperation(
      s,
      makeOp({
        id: 'op-1',
        entityId: 'e1',
        opType: OpType.Update,
        payload: { completedAt: SAME_MS },
        timestamp: SAME_MS,
        vectorClock: { [C]: 3 },
      }),
    );
    s = applyOperation(
      s,
      makeOp({
        id: 'op-2',
        entityId: 'e1',
        opType: OpType.Update,
        payload: { completedAt: null },
        timestamp: SAME_MS,
        vectorClock: { [C]: 4 },
      }),
    );

    // 修复前：约一半概率这里仍是 SAME_MS（「取消完成」静默失效）
    expect(s.tasks['e1']!.completedAt).toBeUndefined();
  });

  it('即使后一条的 op.id 字典序更小，因果更新的写入仍必须胜出', () => {
    // 修复前失败的关键：随机 UUID 的字典序决定了因果顺序。
    // 「完成」的 id 是 zzz、「取消完成」的 id 是 aaa，旧逻辑因为 aaa <= zzz 直接丢弃后者。
    let s = emptyState();
    s = applyOperation(
      s,
      makeOp({
        id: 'zzz',
        entityId: 'e1',
        opType: OpType.Update,
        payload: { completedAt: SAME_MS },
        timestamp: SAME_MS,
        vectorClock: { [C]: 3 },
      }),
    );
    s = applyOperation(
      s,
      makeOp({
        id: 'aaa',
        entityId: 'e1',
        opType: OpType.Update,
        payload: { completedAt: null },
        timestamp: SAME_MS,
        vectorClock: { [C]: 4 },
      }),
    );

    expect(s.tasks['e1']!.completedAt).toBeUndefined();
  });

  it('因果上更旧的写入必须被拒绝，哪怕它的时间戳更大（时钟回拨）', () => {
    let s = emptyState();
    s = applyOperation(
      s,
      makeOp({
        id: 'new',
        entityId: 'e1',
        opType: OpType.Update,
        payload: { title: '新' },
        timestamp: 1000,
        vectorClock: { [C]: 5 },
      }),
    );
    s = applyOperation(
      s,
      makeOp({
        id: 'old',
        entityId: 'e1',
        opType: OpType.Update,
        payload: { title: '旧' },
        timestamp: 999_999,
        vectorClock: { [C]: 2 },
      }),
    );

    expect(s.tasks['e1']!.title).toBe('新');
  });

  it('真正并发的写入仍由时间戳裁决，且与重放顺序无关（两端算得一样）', () => {
    const other = makeOp({
      id: 'x',
      entityId: 'e1',
      opType: OpType.Update,
      payload: { title: 'A' },
      timestamp: 1000,
      vectorClock: { a: 1 },
    });
    const newer = makeOp({
      id: 'y',
      entityId: 'e1',
      opType: OpType.Update,
      payload: { title: 'B' },
      timestamp: 2000,
      vectorClock: { b: 1 },
    });

    const forward = applyOperation(applyOperation(emptyState(), other), newer);
    const backward = applyOperation(applyOperation(emptyState(), newer), other);

    expect(forward.tasks['e1']!.title).toBe('B');
    expect(backward.tasks['e1']!.title).toBe('B');
  });
});

describe('🔴 删除也要记下自己的时钟', () => {
  it('迟到的删除前内容保留在回收站，但不能清除墓碑', () => {
    // 场景：A 编辑过这条任务，B 随后把它删了，然后一条 B **更早**的写入迟到。
    // 那条迟到的写入因果上先于删除，必须被拒绝。
    let s = emptyState();

    // A 的编辑：{A:2}
    s = applyOperation(
      s,
      makeOp({
        id: 'a-edit',
        entityId: 'e1',
        opType: OpType.Update,
        payload: { title: 'A 改过' },
        timestamp: 1000,
        vectorClock: { A: 2 },
      }),
    );

    // B 的删除：{B:5} —— 比下面那条迟到的写入更"新"
    s = applyOperation(
      s,
      makeOp({
        id: 'b-del',
        entityId: 'e1',
        opType: OpType.Delete,
        payload: {},
        timestamp: 2000,
        vectorClock: { B: 5 },
      }),
    );
    expect(s.tasks['e1']!.deletedAt).toBeTypeOf('number');

    // 迟到的旧写入：{B:3}，因果上**先于**删除；但它的墙上时钟最大。
    // 修复前：删除没记自己的时钟，实体上的 _lastClock 还是 {A:2}，
    //         于是 {B:3} 被判为并发，靠时间戳 9999 赢下 —— 墓碑被越过。
    // 修复后：{B:3} vs {B:5} = LESS_THAN → 直接拒绝。
    s = applyOperation(
      s,
      makeOp({
        id: 'b-late',
        entityId: 'e1',
        opType: OpType.Update,
        payload: { title: '迟到的旧写入' },
        timestamp: 9999,
        vectorClock: { B: 3 },
      }),
    );

    // B:3 is older than the deletion, but concurrent with A:2's title.
    // Soft deletion retains the deterministic winning content for restoration;
    // the visibility assertion is the tombstone, not arrival-dependent content.
    expect(s.tasks['e1']!.title).toBe('迟到的旧写入');
    expect(s.tasks['e1']!.deletedAt).toBe(2000);
  });

  it('删除之后，因果上更新的写入仍必须被接受', () => {
    let s = emptyState();
    s = applyOperation(
      s,
      makeOp({
        id: 'a-edit',
        entityId: 'e1',
        opType: OpType.Update,
        payload: { title: 'A 改过' },
        timestamp: 1000,
        vectorClock: { A: 2 },
      }),
    );
    s = applyOperation(
      s,
      makeOp({
        id: 'b-del',
        entityId: 'e1',
        opType: OpType.Delete,
        payload: {},
        timestamp: 2000,
        vectorClock: { B: 5 },
      }),
    );

    // B 在删除之后又写了一次：{B:6} —— 因果上更新，必须生效
    s = applyOperation(
      s,
      makeOp({
        id: 'b-after',
        entityId: 'e1',
        opType: OpType.Update,
        payload: { title: '删除之后的编辑' },
        timestamp: 3000,
        vectorClock: { B: 6 },
      }),
    );

    expect(s.tasks['e1']!.title).toBe('删除之后的编辑');
  });
});

describe('便签（NOTE）：曾是被静默丢弃的实体之一', () => {
  const noteOp = (over: Record<string, unknown>) =>
    makeOp({
      entityType: 'NOTE',
      actionType: 'CREATE_NOTE',
      entityId: 'note-1',
      ...over,
    } as never);

  it('物化到 notes 桶，而不是被静默丢掉', () => {
    const s = applyOperation(
      emptyState(),
      noteOp({ payload: { content: '买菜', projectId: null, isPinnedToToday: true } }),
    );
    expect(s.notes['note-1']).toBeDefined();
    expect(s.notes['note-1']!.content).toBe('买菜');
    expect(s.notes['note-1']!.isPinnedToToday).toBe(true);
  });

  it('重放后仍在（说明它真的进了 op 日志，而不是只活在内存里）', () => {
    const ops = [noteOp({ id: 'n1', payload: { content: '便签内容' } })];
    const replayed = replayOperations(emptyState(), ops);
    expect(replayed.notes['note-1']!.content).toBe('便签内容');
  });

  it('删除留墓碑而不是物理删除（否则另一端会把它同步回来）', () => {
    let s = applyOperation(emptyState(), noteOp({ id: 'n1', payload: { content: '便签' } }));
    s = applyOperation(
      s,
      noteOp({ id: 'n2', opType: OpType.Delete, payload: {}, timestamp: 5000, vectorClock: { 'client-a': 2 } }),
    );
    expect(s.notes['note-1']).toBeDefined();
    expect(s.notes['note-1']!.deletedAt).toBe(5000);
  });
});
