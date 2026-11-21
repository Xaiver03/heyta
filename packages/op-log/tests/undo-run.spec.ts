/**
 * 按 op 整批撤销（undoOperations）—— "撤销这次 AI 操作"的 op-log 底座。
 */
import { describe, expect, it } from 'vitest';

import { OpType } from '@heyta/sync-core';
import type { Operation } from '@heyta/sync-core';
import { DbOpLogStore, INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';

import { OpLogEngine } from '../src/engine.js';

async function memoryEngine() {
  const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await db.init();
  const store = new DbOpLogStore<Operation<string>>(db);
  let tick = 1000;
  const engine = new OpLogEngine({
    store,
    clientId: 'device-a',
    now: () => (tick += 1000),
    nextOpId: (() => { let n = 0; return () => `op-${++n}`; })(),
  });
  return { engine, close: () => db.close() };
}

describe('undoOperations（按 op 整批撤销）', () => {
  it('把一次"建两条 + 改一条"整批抵消', async () => {
    const { engine, close } = await memoryEngine();
    try {
      const c1 = await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: 'A' } });
      const c2 = await engine.dispatch({ entityType: 'TASK', entityId: 't2', opType: OpType.Create, payload: { title: 'B' } });
      const u1 = await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Update, payload: { title: 'A2' } });

      const stateNow = engine.getState() as unknown as { tasks: Record<string, { title?: string; deletedAt?: number }> };
      expect(stateNow.tasks['t1']?.title).toBe('A2');
      expect(stateNow.tasks['t2']?.deletedAt).toBeUndefined();

      const outcome = await engine.undoOperations([c1.ops[0]!.id, c2.ops[0]!.id, u1.ops[0]!.id]);
      expect(outcome.status).toBe('applied');

      const after = engine.getState() as unknown as { tasks: Record<string, { title?: string; deletedAt?: number }> };
      // 更新被反向：标题回到 A
      expect(after.tasks['t1']?.title).toBe('A');
      // 新建被反向：t2 写墓碑（软删），不是物理消失
      expect(after.tasks['t2']?.deletedAt).toBeDefined();
    } finally {
      close();
    }
  });

  it('未跟踪的 opId → partial，且如实列出 unsupported', async () => {
    const { engine, close } = await memoryEngine();
    try {
      await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: 'A' } });
      const outcome = await engine.undoOperations(['does-not-exist']);
      expect(outcome.status).toBe('partial');
      if (outcome.status === 'partial') {
        expect(outcome.applied).toEqual([]);
        expect(outcome.unsupported).toEqual([{ opId: 'does-not-exist', reason: 'not-tracked' }]);
      }
    } finally {
      close();
    }
  });

  it('clearHistory 后按 op 撤销 → not-tracked（不假装成功）', async () => {
    const { engine, close } = await memoryEngine();
    try {
      const c1 = await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: 'A' } });
      engine.clearHistory();
      const outcome = await engine.undoOperations([c1.ops[0]!.id]);
      expect(outcome.status).toBe('partial');
    } finally {
      close();
    }
  });

  it('空列表 → empty', async () => {
    const { engine, close } = await memoryEngine();
    try {
      expect(await engine.undoOperations([])).toEqual({ status: 'empty' });
    } finally {
      close();
    }
  });
});

describe('undoOperations 与普通 undo 的隔离', () => {
  it('普通 undo 之后再用同一 opId 整批撤销 → 不会重复撤销（已从映射移除）', async () => {
    const { engine, close } = await memoryEngine();
    try {
      const c1 = await engine.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: 'A' } });
      expect(await engine.undo()).toMatchObject({ status: 'applied' });
      const outcome = await engine.undoOperations([c1.ops[0]!.id]);
      expect(outcome.status).toBe('partial');
      if (outcome.status === 'partial') {
        expect(outcome.unsupported.map((u) => u.reason)).toEqual(['not-tracked']);
      }
    } finally {
      close();
    }
  });
});
