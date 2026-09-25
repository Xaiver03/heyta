/**
 * 共享的 op-log 引擎单例
 * =========================
 *
 * 所有 feature store 共用一个引擎实例。
 *
 * ⚠️ **必须共用**：引擎持有本地向量时钟与 `appliedOpIds`。
 * 每个 store 各建一个引擎的话，时钟会各自为政 ——
 * A store 写的 op 对 B store 的引擎是"没见过的因果"，冲突判定随即失真。
 *
 * 这里只负责**初始化与读取**。写入路径统一走 `dispatchIntent()`，
 * 它是 D4 在本仓库的落点：任何绕过它的实体写入都不会进 op-log。
 */

import { OpLogEngine, type MaterializedState, type OpIntent } from '@heyta/op-log';
import { IndexedDbAdapter, IndexedDbOpLogStore } from '@heyta/storage';
import type { Operation } from '@heyta/sync-core';
// 🔴 **clientId 的生成只有一份实现**，在 `@heyta/app-host`。
// 这里原本自己写了一份：回退用 `Math.random()`、格式也不同，
// 而 `ids.ts` 的文件头那张"漂移对照表"里**已经列过它**。
// 两份实现的差距不是风格问题 —— clientId 是 LWW 冲突的决胜依据。
import { resolveClientId } from '@heyta/app-host';

let engine: OpLogEngine | undefined;
let db: IndexedDbAdapter | undefined;
/**
 * op-log 存储实例。
 *
 * 保留引用是因为「构造同步客户端」需要它来读写**同步游标** ——
 * `getLastServerSeq`/`setLastServerSeq` 是 `OpLogStore` 接口的正式成员。
 * 此前同步 store 绕过它、自己再开一个 adapter 去读 `meta`，
 * 等于把游标键名知识复制了第二份。
 */
let opLogStore: IndexedDbOpLogStore<Operation<string>> | undefined;
let initPromise: Promise<void> | undefined;

/** 事件监听器：状态变化后通知各 store 刷新。 */
type Listener = () => void;
const listeners = new Set<Listener>();

/** 订阅引擎状态变化。返回取消订阅函数。 */
export function onEngineChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

/**
 * 初始化引擎。幂等，可并发调用。
 *
 * 🔴 **崩溃恢复在接受任何新写入之前完成。** 顺序不可换：
 * 否则那些"已落盘未应用"的 op 会占着 seq 却永不生效 —— 静默丢数据。
 */
export function initOpLog(dbName = 'heyta'): Promise<void> {
  if (initPromise !== undefined) return initPromise;

  initPromise = (async () => {
    db = new IndexedDbAdapter(dbName);
    await db.init();

    opLogStore = new IndexedDbOpLogStore<Operation<string>>(db);
    // 与原生宿主同一个键（`META_KEYS.CLIENT_ID` = 'clientId'），
    // 所以这次切换**不需要任何数据迁移** —— 已有值会被原样读回。
    const clientId = await resolveClientId(db);

    engine = new OpLogEngine({ store: opLogStore, clientId });
    await engine.recover();
    notify();
  })();

  return initPromise;
}

export function requireEngine(): OpLogEngine {
  if (engine === undefined) {
    throw new Error(
      'op-log 引擎尚未初始化。请先 await initOpLog()（应用入口应已完成）。',
    );
  }
  return engine;
}

/** op-log 存储。同步接线用它读写游标 —— 不要绕过它直接碰 adapter。 */
export function requireStore(): IndexedDbOpLogStore<Operation<string>> {
  if (opLogStore === undefined) {
    throw new Error(
      'op-log 存储尚未初始化。请先 await initOpLog()（应用入口应已完成）。',
    );
  }
  return opLogStore;
}

export function currentState(): MaterializedState {
  return requireEngine().getState();
}

/**
 * **唯一的写入入口（D4）。**
 *
 * 任何实体变更都必须经过这里。绕过它 = 改动不进 op-log =
 * 永不同步、无向量时钟记录、崩溃恢复无法重放，而界面看起来完全正常。
 */
export async function dispatchIntent(intent: OpIntent): Promise<void> {
  await requireEngine().dispatch(intent);
  notify();
}

/** 应用一批远程 op（3.3 同步客户端会调用）。 */
export async function applyRemoteOps(ops: Operation<string>[]): Promise<void> {
  await requireEngine().applyRemote(ops);
  notify();
}

/** 仅供测试：重置模块级单例。 */
export function __resetOpLogForTests(): void {
  engine = undefined;
  db = undefined;
  opLogStore = undefined;
  initPromise = undefined;
  // ⚠️ **不要清空 listeners。**
  // 订阅是模块级注册的（各 store 在模块加载时订阅一次），
  // 清空之后重新 initOpLog() 也不会再注册 —— 于是重置一次之后
  // 所有 store 永久失去同步，界面看起来正常但数据不再更新。
  // 这是我实际踩到并修掉的一个 bug。
}
