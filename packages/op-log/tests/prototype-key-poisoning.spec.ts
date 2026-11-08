/**
 * reducer 的**原型链污染**回归尺（崩溃审计 B.1）
 * ==============================================
 *
 * 【这条尺防的是什么】
 *
 * `applyOperationToEntity` 里字段版本桶是这样取值的：
 *
 *     const versions = (fieldVersions[key] ??= []);
 *     addUnique(versions, ...);          // 内部第一句就是 versions.some(...)
 *
 * `fieldVersions` 是**普通对象**（`legacyFieldVersions` 的两条分支都返回 `{}` 形状）。
 * 于是当 op 的 payload 出现任何 `Object.prototype` 成员名（`constructor` /
 * `__proto__` / `toString` / `valueOf` …）时：
 *
 *   1. `fieldVersions['constructor']` 读到的是**继承来的** `Object` 函数（truthy）；
 *   2. `??=` **不会**赋值（左值已"有值"）；
 *   3. `versions` 就是那个函数 → `versions.some is not a function` → **TypeError**。
 *
 * 【为什么这能变成"应用永久无法启动"】
 *
 * 这条 TypeError 是**同步抛**的，而它在回放路径上没有任何一层接住：
 *
 *   `openAppHost()` → `engine.recover()`（无 try/catch）
 *     → `recoverLocked()` → `applyOperation(...)`（无 try/catch）→ TypeError
 *
 * 更关键的是**它是状态无关的** —— 空状态上也会炸。所以：
 *
 *   - 远端路径：`applyRemoteLocked` 的入盘前校验（`applyOperation(emptyState(), op)`）
 *     会在**落盘之前**抛 → 同步永久停在错误上；
 *   - 导入路径：`importOperationsLocked` 的入盘前校验**只覆盖 full-state / batch 三类**，
 *     普通实体 op 直接 `appendImported` → 落盘之后 `recoverLocked()` 才炸
 *     → **坏 op 留在盘上，此后每次冷启动都在同一处抛**。
 *
 * 【为什么必须是 `JSON.parse` 造键】
 *
 * 字面量 `{ constructor: 1 }` 在 JS 里也是自有属性，但真实数据来自
 * `JSON.parse`（导入的备份 / 服务端下发的 op payload），所以这里刻意用
 * `JSON.parse` 造，证明**一段完全合法的 JSON 就能触发**。
 *
 * 【它现在为什么是绿的】
 *
 * 修复把两个版本桶都改成 null-prototype 对象（`Object.create(null)`），
 * `fieldVersions['constructor']` 于是是 `undefined`，`??= []` 正常生效。
 * 把 `nullProtoMap()` 换回 `{}` ⇒ 本文件立刻变红。
 */

import { describe, expect, it } from 'vitest';

import { DbOpLogStore, INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';
import { OpType, type Operation } from '@heyta/sync-core';

import { applyOperation, emptyState, OpLogEngine, replayOperations } from '../src/index.js';

/** 与原型链成员同名的 payload 键 —— 全部是 `Object.prototype` 上的真成员。 */
const HOSTILE_KEYS = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'] as const;

function opWithPayload(payload: unknown, entityId = 't1') {
  return {
    id: `op-${entityId}`,
    actionType: 'CRT_TASK',
    opType: OpType.Create,
    entityType: 'TASK',
    entityId,
    payload,
    clientId: 'client-a',
    vectorClock: { 'client-a': 1 },
    timestamp: 1_700_000_000_000,
    schemaVersion: 1,
  } as const;
}

describe('reducer 对原型链成员名 payload 键的防御（B.1）', () => {
  for (const key of HOSTILE_KEYS) {
    it(`payload 含 {${key}} 时 applyOperation 不得抛 TypeError`, () => {
      // 用 JSON.parse 造 —— 与真实数据同源（导入的备份 / 服务端下发的 op）
      const payload = JSON.parse(`{"${key}":1,"title":"真字段"}`) as Record<string, unknown>;

      // 先证明这段 JSON 确实带一个自有属性叫 key —— 否则本用例在测空气。
      expect(Object.keys(payload)).toContain(key);

      expect(() => applyOperation(emptyState(), opWithPayload(payload))).not.toThrow();
    });
  }

  it('原型链键与真字段共存时，真字段仍然被物化', () => {
    const payload = JSON.parse('{"constructor":{"evil":true},"title":"留住我","priority":3}') as Record<
      string,
      unknown
    >;

    const state = applyOperation(emptyState(), opWithPayload(payload));
    const task = state.tasks['t1'] as unknown as Record<string, unknown>;

    // 真字段必须活下来 —— 修完之后不能因为"跳过可疑键"把正常数据一起丢了。
    expect(task['title']).toBe('留住我');
    expect(task['priority']).toBe(3);
  });

  it('replayOperations 连续回放含原型链键的 op 不抛（冷启动路径）', () => {
    const ops = HOSTILE_KEYS.map((key, index) =>
      opWithPayload(JSON.parse(`{"${key}":1,"title":"t${String(index)}"}`), `task-${String(index)}`),
    );

    expect(() => replayOperations(emptyState(), ops)).not.toThrow();
  });

  it('同一实体上的原型链键 op 之后，正常 op 仍能覆盖字段（版本桶没被污染）', () => {
    const poisoned = opWithPayload(JSON.parse('{"constructor":1,"title":"旧"}') as unknown);
    const normal = {
      ...opWithPayload({ title: '新' }),
      id: 'op-t1-second',
      opType: OpType.Update,
      vectorClock: { 'client-a': 2 },
      timestamp: 1_700_000_001_000,
    } as const;

    const state = replayOperations(emptyState(), [poisoned, normal]);
    const task = state.tasks['t1'] as unknown as Record<string, unknown>;

    // 后写的 op 时钟更大 ⇒ 必须赢。若版本桶被原型链成员占位，这里会读到"旧"。
    expect(task['title']).toBe('新');
  });

  /**
   * 🔴 这条是整个 B.1 的**止血判据**：坏 op 落地之后，冷启动必须仍然活着。
   *
   * 【修之前】
   * `importOperationsLocked` 只对 full-state / task-batch / priority-batch /
   * repeat-completion 四类做入盘前预演，**普通实体 op 直接 `appendImported`**。
   * 一条 payload 带 `constructor` 的普通 op 会先写进库，之后 `recoverLocked()`
   * 才抛 ⇒ 坏 op 留在盘上 ⇒ 此后**每次冷启动都在同一处炸**。
   *
   * 【修之后】
   * reducer 的版本桶改成 null-prototype，原型链键不再致 TypeError；
   * 并且导入前对**所有** op 无条件预演一遍。于是这种 op 变成了**无害数据**：
   * 导入成功、字段被安全跳过、`recover()` 照样能跑完。
   *
   * 所以这里测的不是"必须拒绝"（拒绝只是兜底），而是两条更本质的保证：
   *   1. 导入之后 `recover()` 不抛 —— 冷启动活着；
   *   2. 那个想污染原型的键**没有变成实体字段**。
   *
   * 把 `nullProtoMap()` 换回 `{}` ⇒ 本用例会红在"不进库/冷启动"那一侧。
   */
  it('🔴 导入含原型链键的普通 op 之后，冷启动仍可恢复且原型未被污染', async () => {
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await db.init();
    try {
      const store = new DbOpLogStore<Operation<string>>(db);
      const engine = new OpLogEngine({ store, clientId: 'device-a' });

      // 一条合法 op 先入盘，用来证明坏 op 不会连累已有数据。
      await engine.dispatch({
        entityType: 'TASK',
        entityId: 'good',
        opType: OpType.Create,
        payload: { title: '合法' },
      });
      const before = (await store.getAllOps()).length;
      expect(before).toBeGreaterThan(0);

      const poisoned = {
        ...opWithPayload(JSON.parse('{"constructor":{"polluted":true},"title":"也留住"}') as unknown, 'poison'),
        opType: OpType.Update,
      };

      // 修完之后这条**应当成功** —— 原型链键不再致 TypeError。
      await expect(engine.importOperations([poisoned as never])).resolves.toBeDefined();

      // ① 冷启动活着：recover() 能在含这条 op 的日志上跑完。
      await expect(engine.recover()).resolves.toBeDefined();

      // ② 已有数据还在。
      const after = await store.getAllOps();
      expect(after.length).toBeGreaterThanOrEqual(before);

      // ③ 原型没被污染：想塞进去的 `polluted` 绝不能出现在实体上，
      //    而且实体自己的 constructor 不能被换成 payload 里那个对象。
      const task = engine.getState().tasks['poison'] as unknown as Record<string, unknown>;
      expect(task['polluted']).toBeUndefined();
      expect(task['constructor']).not.toEqual({ polluted: true });
      // ④ 同一条 op 里的正常字段仍然要活下来 —— 修复不能靠"整条丢掉"。
      expect(task['title']).toBe('也留住');
    } finally {
      db.close();
    }
  });
});
