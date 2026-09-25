/**
 * op-log 引擎测试
 * =================
 *
 * 重点：**幂等、崩溃恢复、墓碑、D4（唯一写入口）**。
 * 这些都是"坏了也不会报错、只会在用户第二台设备上发现数据不见"的类型。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Operation, VectorClock } from '@heyta/sync-core';
import { IndexedDbAdapter, IndexedDbOpLogStore } from '@heyta/storage';

import { OpLogEngine } from '../src/engine.js';
import { applyOperation, emptyState, replayOperations } from '../src/state.js';

function makeOp(over: Partial<Operation<string>> & { id: string }): Operation<string> {
  return {
    opType: 'CREATE',
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
    s = applyOperation(s, makeOp({ id: 'b', timestamp: 2000, opType: 'UPDATE', payload: { title: 'A2' } }));

    expect(s.tasks['task-1']!.title).toBe('A2');
    // 关键：dueDate 必须还在 —— 否则"改标题"会把截止时间抹掉
    expect(s.tasks['task-1']!.dueDate).toBe(999);
  });

  it('🔴 DELETE 写墓碑而不是物理删除（否则另一端会把数据同步回来）', () => {
    let s = emptyState();
    s = applyOperation(s, makeOp({ id: 'a', timestamp: 1000 }));
    s = applyOperation(s, makeOp({ id: 'b', timestamp: 2000, opType: 'DELETE', payload: {} }));

    expect(s.tasks['task-1']).toBeDefined();
    expect(s.tasks['task-1']!.deletedAt).toBe(2000);
  });

  it('更旧的 op 被拒绝（LWW 兜底，保证重放顺序无关）', () => {
    let s = emptyState();
    s = applyOperation(s, makeOp({ id: 'a', timestamp: 5000, payload: { title: '新' } }));
    s = applyOperation(s, makeOp({ id: 'b', timestamp: 1000, payload: { title: '旧' } }));
    expect(s.tasks['task-1']!.title).toBe('新');
  });

  it('同毫秒用 op.id 确定性决胜（不留"谁先到谁赢"）', () => {
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
      makeOp({ id: 'b', timestamp: 2000, opType: 'UPDATE', payload: { completedAt: null } }),
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
      opType: 'UPDATE',
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
    s = applyOperation(s, makeOp({ id: 'b', timestamp: 3000, opType: 'DELETE', payload: {} }));
    s = applyOperation(s, makeOp({ id: 'c', timestamp: 2000, opType: 'UPDATE', payload: { title: '复活?' } }));

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
      opType: 'CREATE',
      payload: { title: '写文档' },
    });

    expect(engine.getState().tasks['t1']!.title).toBe('写文档');
    // 关键：op 必须真的进了 op-log，否则永远不会同步
    expect(await db.count('ops')).toBe(1);
    expect(await store.getLastLocalSeq()).toBe(1);
  });

  it('每次 dispatch 推进本地向量时钟', async () => {
    const engine = makeEngine();
    await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: 'CREATE', payload: {} });
    expect(engine.getClock()['device-1']).toBe(1);
    await engine.dispatch({ entityType: 'TASK', entityId: 't2', opType: 'CREATE', payload: {} });
    expect(engine.getClock()['device-1']).toBe(2);
  });

  it('op 自带的时钟是"写入前"的（不含本次递增）', async () => {
    const engine = makeEngine();
    await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: 'CREATE', payload: {} });
    const rows = await store.getAllOps();
    // 第一条 op 的时钟应为空 —— 它不包含自己
    expect(rows[0]!.op.vectorClock).toEqual({});
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
    await engine.dispatch({ entityType: 'TASK', entityId: 'x', opType: 'CREATE', payload: {} });
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
    await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: 'CREATE', payload: { title: 'A' } });
    await engine.dispatch({ entityType: 'TASK', entityId: 't2', opType: 'CREATE', payload: { title: 'B' } });
    await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: 'UPDATE', payload: { title: 'A2' } });

    // 全新引擎，不带任何内存状态
    const rebuilt = makeEngine();
    const state = await rebuilt.rebuildFromLog();

    expect(state.tasks['t1']!.title).toBe('A2');
    expect(state.tasks['t2']!.title).toBe('B');
    expect(rebuilt.getState().tasks['t1']!.title).toBe('A2');
  });

  it('删除走墓碑，重建后墓碑仍在', async () => {
    const engine = makeEngine();
    await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: 'CREATE', payload: { title: 'A' } });
    await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: 'DELETE', payload: {} });

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
      opType: 'UPDATE',
      payload: { projectId: 'p1' },
    });

    expect(r.ops).toHaveLength(1); // 一次操作 = 一条 op（AGENTS.md §3.4）
    expect(r.ops[0]!.entityIds).toEqual(['t1', 't2', 't3']);
  });

  it('空批次 applyRemote 是安全空操作', async () => {
    const engine = makeEngine();
    expect(await engine.applyRemote([])).toEqual({ applied: [], skipped: 0, overwritten: [] });
  });
});
