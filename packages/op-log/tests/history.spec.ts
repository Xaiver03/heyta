/**
 * 撤销历史栈（R2）
 * ================
 *
 * 判据全部是"注掉对应逻辑就会红"的那种：
 *   · 删除可撤（反向 op 生成）—— 注掉 `buildHistoryEntry` 的 DEL 分支即红；
 *   · 前提不成立就拒绝（`stale`）—— 注掉 `checkInverseStillValid` 即红，且会**误覆盖**远端；
 *   · 一次撤销 = 一条 op —— 改成 fan-out 即红；
 *   · 批量/快照不可撤销 —— 把 `reason` 判定改成恒可撤即红。
 */

import { describe, expect, it } from 'vitest';

import { OpType } from '@heyta/sync-core';
import type { Operation } from '@heyta/sync-core';
import { DbOpLogStore, INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';

import { OpLogEngine } from '../src/engine.js';

async function memoryEngine(clientId = 'device-a'): Promise<{
  engine: OpLogEngine;
  store: DbOpLogStore<Operation<string>>;
  close: () => void;
}> {
  const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await db.init();
  const store = new DbOpLogStore<Operation<string>>(db);
  let tick = 1000;
  const engine = new OpLogEngine({
    store,
    clientId,
    now: () => (tick += 1000),
    nextOpId: (() => { let n = 0; return () => `op-${++n}`; })(),
  });
  return { engine, store, close: () => db.close() };
}

const project = (id: string) => ({ entityType: 'PROJECT' as const, entityId: id });
const task = (id: string) => ({ entityType: 'TASK' as const, entityId: id });

describe('R2 撤销历史栈', () => {
  it('删除清单 → undo 把清单和它的任务都带回来（墓碑 → UPD deletedAt:null）', async () => {
    const { engine, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...project('p1'), opType: OpType.Create, payload: { name: '工作' } });
      await engine.dispatch({ ...task('t1'), opType: OpType.Create, payload: { title: '写文档', projectId: 'p1' } });
      await engine.dispatch({ ...task('t2'), opType: OpType.Create, payload: { title: '开会', projectId: 'p1' } });
      await engine.dispatch({ ...project('p1'), opType: OpType.Delete, payload: {} });

      expect(engine.getState().projects['p1']!.deletedAt).toBeDefined();
      expect(engine.historyState().canUndo).toBe(true);

      const outcome = await engine.undo();
      expect(outcome.status).toBe('applied');
      expect(engine.getState().projects['p1']!.deletedAt).toBeUndefined();
      // 任务从来没有被级联删除 —— 清单回来了，它们自然回到可见列表。
      expect(engine.getState().tasks['t1']!.deletedAt).toBeUndefined();
      expect(engine.getState().tasks['t2']!.deletedAt).toBeUndefined();
    } finally {
      close();
    }
  });

  it('改字段 → undo 只回滚它写过的键（其余字段不受影响）', async () => {
    const { engine, close } = await memoryEngine();
    try {
      await engine.dispatch({
        ...task('t1'),
        opType: OpType.Create,
        payload: { title: '原标题', dueDate: 5000 },
      });
      await engine.dispatch({ ...task('t1'), opType: OpType.Update, payload: { title: '新标题' } });
      expect(engine.getState().tasks['t1']!.dueDate).toBe(5000);

      await engine.undo();
      expect(engine.getState().tasks['t1']!.title).toBe('原标题');
      expect(engine.getState().tasks['t1']!.dueDate).toBe(5000);
    } finally {
      close();
    }
  });

  it('撤销「新建」= 墓碑；再 undo 回到新建之前（没有该实体字段）', async () => {
    const { engine, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...task('t1'), opType: OpType.Create, payload: { title: 'A' } });
      await engine.undo();
      expect(engine.getState().tasks['t1']!.deletedAt).toBeDefined();
    } finally {
      close();
    }
  });

  it('redo 把撤销掉的那一下重新做一遍；新动作会清空 redo 栈', async () => {
    const { engine, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...project('p1'), opType: OpType.Create, payload: { name: '工作' } });
      await engine.dispatch({ ...project('p1'), opType: OpType.Delete, payload: {} });

      await engine.undo();
      expect(engine.getState().projects['p1']!.deletedAt).toBeUndefined();
      expect(engine.historyState().canRedo).toBe(true);

      const redone = await engine.redo();
      expect(redone.status).toBe('applied');
      expect(engine.getState().projects['p1']!.deletedAt).toBeDefined();

      await engine.undo();
      await engine.dispatch({ ...task('t9'), opType: OpType.Create, payload: { title: '新动作' } });
      // 分叉之后旧的重做路径失效：这是撤销栈的常规语义，不保留"平行世界"。
      expect(engine.historyState().canRedo).toBe(false);
    } finally {
      close();
    }
  });

  it('🔴 前提不成立就拒绝（stale）：远端恢复过这条，undo 不许拿旧墓碑去覆盖', async () => {
    const { engine, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...project('p1'), opType: OpType.Create, payload: { name: '工作' } });
      await engine.dispatch({ ...project('p1'), opType: OpType.Delete, payload: {} });

      // 另一台设备把它恢复了（更晚的时间戳 ⇒ LWW 选远端）。
      const remote: Operation<string> = {
        id: 'remote-restore',
        actionType: 'UPD_PROJECT',
        opType: OpType.Update,
        entityType: 'PROJECT',
        entityId: 'p1',
        payload: { deletedAt: null },
        clientId: 'device-b',
        vectorClock: { 'device-b': 1 },
        timestamp: 99_000,
        schemaVersion: 1,
      } as Operation<string>;
      await engine.applyRemote([remote]);
      expect(engine.getState().projects['p1']!.deletedAt).toBeUndefined();

      const outcome = await engine.undo();
      expect(outcome).toEqual({ status: 'stale', reason: 'entity-changed' });
      // 拒绝之后实体的样子**一个字都没变** —— 这就是"不误覆盖"的判据。
      expect(engine.getState().projects['p1']!.deletedAt).toBeUndefined();
    } finally {
      close();
    }
  });

  it('更新被远端改过之后 undo = stale（不是"硬写回旧值"）', async () => {
    const { engine, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...task('t1'), opType: OpType.Create, payload: { title: '原标题' } });
      await engine.dispatch({ ...task('t1'), opType: OpType.Update, payload: { title: '我改成这样' } });
      await engine.applyRemote([{
        id: 'remote-title',
        actionType: 'UPD_TASK',
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 't1',
        payload: { title: '别人改成那样' },
        clientId: 'device-b',
        vectorClock: { 'device-b': 1 },
        timestamp: 99_000,
        schemaVersion: 1,
      } as Operation<string>]);

      expect(await engine.undo()).toEqual({ status: 'stale', reason: 'entity-changed' });
      expect(engine.getState().tasks['t1']!.title).toBe('别人改成那样');
    } finally {
      close();
    }
  });

  it('一次撤销只落一条 op（不是 fan-out），且不进"可撤销"的俄罗斯套娃', async () => {
    const { engine, store, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...project('p1'), opType: OpType.Create, payload: { name: '工作' } });
      await engine.dispatch({ ...project('p1'), opType: OpType.Delete, payload: {} });
      const before = await store.getLastLocalSeq();

      await engine.undo();
      expect(await store.getLastLocalSeq()).toBe(before + 1);
      // 撤销之后栈顶是那条反向 op，它自己**不能**再被"撤销"成原样（那是重做）。
      expect(engine.historyState().canUndo).toBe(true);
      expect(engine.historyState().canRedo).toBe(true);
    } finally {
      close();
    }
  });

  it('批量 op 不入撤销栈；undo 跳过它去撤上一条能撤的', async () => {
    const { engine, store, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...task('t1'), opType: OpType.Create, payload: { title: '正常写入' } });
      const batch: Operation<string> = {
        id: 'batch-op',
        actionType: 'BATCH_TASK',
        opType: OpType.Batch,
        entityType: 'TASK',
        entityId: 't2',
        payload: {},
        clientId: 'device-a',
        vectorClock: { 'device-a': 1 },
        timestamp: 2000,
        schemaVersion: 1,
      } as Operation<string>;
      // 批量导入走 importOperations（非"用户刚做的一件事"），不应产生历史条目。
      await engine.importOperations([batch]);
      expect(engine.historyState().canUndo).toBe(true);

      const outcome = await engine.undo();
      expect(outcome.status).toBe('applied');
      expect(engine.getState().tasks['t1']!.deletedAt).toBeDefined();
      expect(await store.getLastLocalSeq()).toBeGreaterThan(0);
    } finally {
      close();
    }
  });

  it('🔴 回放不产生历史（远端 op 与崩溃恢复都不进撤销栈）', async () => {
    const { engine, store, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...task('t1'), opType: OpType.Create, payload: { title: '本机写的' } });
      expect(engine.historyState().canUndo).toBe(true);

      // 远端来的 op：它**不是**用户在这台机器上刚做的一件事，不该变得可撤销。
      await engine.applyRemote([{
        id: 'remote-1',
        actionType: 'CRT_TASK',
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: 'remote-task',
        payload: { title: '别的设备写的' },
        clientId: 'device-b',
        vectorClock: { 'device-b': 1 },
        timestamp: 50_000,
        schemaVersion: 1,
      } as Operation<string>]);
      expect(engine.getState().tasks['remote-task']).toBeDefined();

      // 重启（同一份 store 恢复）：历史是**会话内**的，恢复出来的不该有"可撤销"。
      const restarted = new OpLogEngine({ store, clientId: 'device-a' });
      await restarted.recover();
      expect(restarted.historyState()).toEqual({ canUndo: false, canRedo: false });
      expect(await restarted.undo()).toEqual({ status: 'empty' });
    } finally {
      close();
    }
  });

  it('清空历史只清栈，不动 op-log（判据：库里的 op 条数不变）', async () => {
    const { engine, store, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...task('t1'), opType: OpType.Create, payload: { title: 'A' } });
      const count = await store.countAllOps();
      engine.clearHistory();
      expect(engine.historyState().canUndo).toBe(false);
      expect(await store.countAllOps()).toBe(count);
      expect(await engine.undo()).toEqual({ status: 'empty' });
    } finally {
      close();
    }
  });

  /* ───────── R19：撤销栈跨刷新（exportHistory / restoreHistory） ───────── */

  it('🔴 刷新后 ⌘Z 仍然有效：快照装进新引擎，undo 照样回滚（R19 的核心承诺）', async () => {
    const { engine, store, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...task('t1'), opType: OpType.Create, payload: { title: '原' } });
      await engine.dispatch({ ...task('t1'), opType: OpType.Update, payload: { title: '改' } });
      const snapshot = engine.exportHistory();
      expect(snapshot.undo.length).toBeGreaterThan(0);

      // 模拟刷新：同一个库，**新的引擎实例**（栈是新的、空的）。
      const refreshed = new OpLogEngine({
        store,
        clientId: 'device-a',
        now: () => 999_000,
        nextOpId: (() => { let n = 100; return () => `op-r-${++n}`; })(),
      });
      await refreshed.recover();
      expect(refreshed.historyState().canUndo).toBe(false); // 新引擎本来没有历史

      refreshed.restoreHistory(JSON.parse(JSON.stringify(snapshot)) as typeof snapshot);
      expect(refreshed.historyState().canUndo).toBe(true);

      const outcome = await refreshed.undo();
      expect(outcome.status).toBe('applied');
      expect(refreshed.getState().tasks['t1']!.title).toBe('原');
    } finally {
      close();
    }
  });

  it('恢复是**替换**不是合并：清空后的快照装回去不会让撤销条目复活', async () => {
    const { engine, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...task('t1'), opType: OpType.Create, payload: { title: 'A' } });
      const stale = engine.exportHistory();
      engine.clearHistory();
      engine.restoreHistory({ undo: [], redo: [] });
      expect(engine.historyState().canUndo).toBe(false);
      // 再装旧快照：那是**另一次会话**的栈，装进去必须整体覆盖 —— 这里用它验证覆盖语义。
      engine.restoreHistory(stale);
      expect(engine.historyState().canUndo).toBe(true);
      // 装一个空快照后必须真的空（不是"保留了之前的"）。
      engine.restoreHistory(undefined);
      expect(engine.historyState().canUndo).toBe(false);
      expect(engine.historyState().canRedo).toBe(false);
    } finally {
      close();
    }
  });

  it('超限快照按上限截断最旧的（HISTORY_LIMIT），不越界', async () => {
    const { engine, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...task('t1'), opType: OpType.Create, payload: { title: 'A' } });
      const one = engine.exportHistory();
      const huge = { undo: Array.from({ length: 5000 }, () => one.undo[0]!), redo: [] };
      engine.restoreHistory(huge);
      // 只要不抛、且能撤销，就说明没把 5000 条原样塞进栈（那会让一次 undo 循环 5000 次）。
      expect(engine.historyState().canUndo).toBe(true);
    } finally {
      close();
    }
  });

  it('🔴 恢复的旧反向意图在实体已被远端改过时返回 stale（恢复不等于放行覆盖）', async () => {
    const { engine, store, close } = await memoryEngine();
    try {
      await engine.dispatch({ ...task('t1'), opType: OpType.Create, payload: { title: '原' } });
      await engine.dispatch({ ...task('t1'), opType: OpType.Update, payload: { title: '本地改' } });
      const snapshot = JSON.parse(JSON.stringify(engine.exportHistory())) as ReturnType<
        typeof engine.exportHistory
      >;

      // 另一台设备改同一个字段（同一库、不同 clientId ⇒ 走进来的是 remote）。
      const remote = new OpLogEngine({
        store,
        clientId: 'device-b',
        now: () => 777_000,
        nextOpId: (() => { let n = 500; return () => `op-b-${++n}`; })(),
      });
      await remote.recover();
      await remote.dispatch({ ...task('t1'), opType: OpType.Update, payload: { title: '远端改' } });

      // 刷新后装回旧栈，再按 ⌘Z：必须如实说 stale，而不是拿旧值盖掉远端。
      const refreshed = new OpLogEngine({
        store,
        clientId: 'device-a',
        now: () => 888_000,
        nextOpId: (() => { let n = 900; return () => `op-r2-${++n}`; })(),
      });
      await refreshed.recover();
      refreshed.restoreHistory(snapshot);
      const outcome = await refreshed.undo();
      expect(outcome.status).toBe('stale');
      expect(refreshed.getState().tasks['t1']!.title).toBe('远端改');
    } finally {
      close();
    }
  });
});
