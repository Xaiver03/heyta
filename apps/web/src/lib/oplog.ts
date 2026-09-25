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
import { IndexedDbAdapter, IndexedDbOpLogStore, STORES } from '@heyta/storage';
import type { Operation } from '@heyta/sync-core';

let engine: OpLogEngine | undefined;
let db: IndexedDbAdapter | undefined;
let initPromise: Promise<void> | undefined;

/** 设备身份在 meta store 里的键名。 */
const CLIENT_ID_KEY = 'clientId';

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

/** 读取或生成稳定的设备 clientId。**一经生成不可更改**（LWW 决胜依据）。 */
async function resolveClientId(
  adapter: IndexedDbAdapter,
  key: string,
): Promise<string> {
  const existing = await adapter.get<{ key: string; value: string }>(STORES.META, key);
  if (existing !== undefined && typeof existing.value === 'string') {
    return existing.value;
  }
  const fresh =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `client-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  await adapter.put(STORES.META, { key, value: fresh });
  return fresh;
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

    const store = new IndexedDbOpLogStore<Operation<string>>(db);
    const clientId = await resolveClientId(db, CLIENT_ID_KEY);

    engine = new OpLogEngine({ store, clientId });
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
  initPromise = undefined;
  // ⚠️ **不要清空 listeners。**
  // 订阅是模块级注册的（各 store 在模块加载时订阅一次），
  // 清空之后重新 initOpLog() 也不会再注册 —— 于是重置一次之后
  // 所有 store 永久失去同步，界面看起来正常但数据不再更新。
  // 这是我实际踩到并修掉的一个 bug。
}
