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
import {
  parseExportDocument,
  resolveClientId,
  restoreIntoEmptyTarget,
  type RestoreExportResult,
} from '@heyta/app-host';

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
 * 记忆层重放事件流时最多回看多少条 op（按本地 seq 的**最近**窗口）。
 *
 * 🔴 **这是一个产品判断，不是性能调参，所以它有名字、有注释、可以被讨论。**
 *
 * 为什么需要上限：`getOpsSince()` 是线性读，全库拉一遍在一个用了两年的
 * 本地库上会变成每次渲染都做一次全表扫描。而 `computeFocusGaps` 只需要
 * **最近**的推迟历史。
 *
 * ⚠️ **截断的含义（必须写清，不许默默截断）**：窗口只覆盖最近
 * `MEMORY_OP_WINDOW` 条 op。若某条任务的"最后一次推迟"发生在窗口之前，
 * 界面会显示 `0` 次 —— 那是**低估**，不是精确值。取 1000 是因为
 * 它远大于"一个人近期改过的截止日期条数"，同时不至于让一次读变成全表扫描。
 * 真正要做精确计数，得先给推迟次数做持久化聚合（本条不授权新增持久化字段）。
 */
export const MEMORY_OP_WINDOW = 1000;

/**
 * 读取**最近**一段 op 窗口，供记忆层推算推迟次数。
 *
 * 三件事值得写下来：
 *   1. `getOpsSince` 返回的是 `StoredOperation`（`{seq, op, ...}`），
 *      领域层的 `MemoryOp` 要的是**裸 `op`** —— 这里替调用方剥掉外壳。
 *   2. 窗口是**按 seq 从后往前**取的：先拿 `getLastLocalSeq()`，再从
 *      `lastSeq - maxOps` 读。⚠️ 直接 `getOpsSince(0, maxOps)` 拿到的是
 *      **最旧**的 N 条（它按 seq 升序切前 N 条），拿它当"最近"是错的。
 *   3. 存储层保证 seq「单调、无空洞」，所以窗口大小是可预期的；
 *      若将来出现空洞，窗口会**少**几条 —— 宁可少算也不假装精确。
 */
export async function readRecentOps(
  maxOps: number = MEMORY_OP_WINDOW,
): Promise<Operation<string>[]> {
  const store = requireStore();
  const lastSeq = await store.getLastLocalSeq();
  const since = Math.max(0, lastSeq - maxOps);
  const rows = await store.getOpsSince(since, maxOps);
  return rows.map((row) => row.op);
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

/**
 * 从一段导出文本**还原到空库**。
 *
 * 🔴 产品语义（能不能导、导到哪里、结果对不对）全在 `@heyta/app-host` 的
 * `parseExportDocument` / `restoreIntoEmptyTarget`。这里只做两件宿主该做的事：
 *
 *   1. **把本地 op-log 递给它** —— 还原要能读"日志里有什么"来决定是否拒绝；
 *   2. **成功后通知各 store 刷新** —— 不通知的话数据在库里、界面不动，
 *      用户会以为还原没生效（同 `dispatchIntent` 的理由）。
 *
 * ⚠️ 它**绝不**先清库：目标非空时 `restoreIntoEmptyTarget` 在写之前就拒绝，
 * 本函数只是如实把结果转发给界面。
 */
export async function restoreFromExport(text: string): Promise<RestoreExportResult> {
  const parsed = parseExportDocument(text);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, detail: parsed.detail };
  }

  const result = await restoreIntoEmptyTarget(
    {
      engine: requireEngine(),
      readOpLog: async () => (await requireStore().getAllOps()).map((row) => row.op),
    },
    parsed.document,
  );
  if (result.ok) notify();
  return result;
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
