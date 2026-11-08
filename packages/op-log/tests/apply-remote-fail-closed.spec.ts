/**
 * `applyRemote` 的 **fail-closed** 契约 —— 一条"别再改回去"的判据
 * =================================================================
 *
 * 【这份测试为什么存在（而不是把决定写在注释里就完事）】
 *
 * 崩溃审计（2026-11-08）在这一处**判断错了一次**：
 *
 *   诊断：`applyRemoteLocked` 的入盘前校验循环没有 try/catch，
 *         一条畸形远端 op 会让整批 reject；而 `sync()` 的 catch 只把
 *         它转成 `{kind:'error'}`，**游标不推进** ⇒ 下次重拉同一条 ⇒ 永久失败。
 *         这个诊断是对的。
 *
 *   提出的修法：逐 op try/catch，坏的塞进 `rejected[]` 跳过，好的继续落盘。
 *
 *   结果：**10 条既有用例当场变红**（`full-state-recovery` / `task-batch` /
 *         `engine`），因为它们明确断言这些路径必须 reject。
 *
 * 那些用例不是"过时的实现细节"，而是 `ADR-0016` fail-closed 的判据：
 * 被跳过的若是 full-state / batch op，代价不是"少一条数据"，而是
 * **可能丢掉整份库**（承载全量快照的正是那一类 op）。
 *
 * 所以修法回退了。要真正解决"永久焊死"，缺的不是一个 try/catch，
 * 而是一份**隔离协议**（隔离表放哪、谁批准跳过、怎么让用户知道、
 * 坏 op 怎么导出）—— 那是 ADR 级别的问题。
 *
 * 【这份文件的作用】
 *
 * 把"回退"这个事实变成**能失败的判据**：谁再把它改成"跳过并继续"，
 * 这里会点名说是哪一类 op 被放行了。注释会被跳过，测试不会。
 */

import { describe, expect, it } from 'vitest';

import { DbOpLogStore, INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';
import { OpType, type Operation } from '@heyta/sync-core';

import { OpLogEngine } from '../src/index.js';

const db = async (): Promise<{
  engine: InstanceType<typeof OpLogEngine>;
  store: DbOpLogStore<Operation<string>>;
  close: () => void;
}> => {
  const adapter = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await adapter.init();
  const store = new DbOpLogStore<Operation<string>>(adapter);
  return {
    engine: new OpLogEngine({ store, clientId: 'device-a' }),
    store,
    close: () => {
      adapter.close();
    },
  };
};

/** reducer 一定解析不了：full-state 路由类型 + 不合法载荷。 */
const poisonSnapshot = (id: string) =>
  ({
    id,
    actionType: 'REPAIR_ALL',
    opType: 'REPAIR',
    entityType: 'ALL',
    payload: { not: 'a valid full state' },
    clientId: 'device-b',
    vectorClock: { 'device-b': 99 },
    timestamp: 1_700_000_000_099,
    schemaVersion: 1,
  }) as const;

const goodTask = (id: string, entityId: string, clock: number) =>
  ({
    id,
    actionType: 'CRT_TASK',
    opType: OpType.Create,
    entityType: 'TASK',
    entityId,
    payload: { title: entityId },
    clientId: 'device-b',
    vectorClock: { 'device-b': clock },
    timestamp: 1_700_000_000_000 + clock,
    schemaVersion: 1,
  }) as const;

describe('applyRemote 是 fail-closed（ADR-0016）—— 不要改成"跳过并继续"', () => {
  it('🔴 批次里有不可解析的 op ⇒ 整批 reject（不是跳过它继续）', async () => {
    const { engine, close } = await db();
    try {
      await expect(
        engine.applyRemote([goodTask('op-good', 't1', 1), poisonSnapshot('op-poison')] as never),
      ).rejects.toThrow(/full-state|Invalid|Unsupported/i);
    } finally {
      close();
    }
  });

  it('🔴 被拒之后**一条都没落盘** —— 整批不应用，游标不动', async () => {
    const { engine, store, close } = await db();
    try {
      await expect(
        engine.applyRemote([goodTask('op-good', 't1', 1), poisonSnapshot('op-poison')] as never),
      ).rejects.toThrow();

      const stored = await store.getAllOps();
      // 关键：连"好的那条"也不许落盘 —— 否则就是部分应用（fail-closed 的反面）。
      expect(stored).toHaveLength(0);
      // 状态里也不该有那条任务
      expect(engine.getState().tasks['t1']).toBeUndefined();
    } finally {
      close();
    }
  });

  it('🔴 同一批里 bad 在前 / good 在后，同样整批 reject', async () => {
    const { engine, store, close } = await db();
    try {
      await expect(
        engine.applyRemote([poisonSnapshot('op-poison'), goodTask('op-good', 't2', 2)] as never),
      ).rejects.toThrow();
      expect(await store.getAllOps()).toHaveLength(0);
    } finally {
      close();
    }
  });

  it('结果形状里**没有** `rejected` 字段（别再把它加回来当"隔离"用）', async () => {
    const { engine, close } = await db();
    try {
      const result = await engine.applyRemote([goodTask('op-a', 't1', 1)] as never);
      // 这批全是好的 ⇒ 正常返回，但形状必须是既有的三字段。
      expect(Object.keys(result).sort()).toEqual(['applied', 'overwritten', 'skipped']);
    } finally {
      close();
    }
  });

  it('普通实体 op 的原型链键**不再**触发 TypeError（这是真正修掉的那一半）', async () => {
    const { engine, close } = await db();
    try {
      // 审计发现的实际机制：payload 里的 `constructor` 让字段版本桶取到继承来的
      // Object 函数 → `versions.some is not a function`。修在 `nullProtoMap`。
      const poisoned = {
        ...goodTask('op-proto', 't3', 3),
        payload: JSON.parse('{"constructor":1,"title":"留着"}') as unknown,
      } as const;
      await expect(engine.applyRemote([poisoned] as never)).resolves.toBeDefined();
      const task = engine.getState().tasks['t3'] as unknown as Record<string, unknown>;
      expect(task['title']).toBe('留着');
    } finally {
      close();
    }
  });
});
