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
import {
  createWorkerOpLogSession,
  IndexedDbAdapter,
  IndexedDbOpLogStore,
  type OpLogStore,
} from '@heyta/storage';
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
 * ⚠️ 类型是 `OpLogStore`（接口），**不是** 某个具体实现 ——
 * 因为现在有两个实现：IndexedDB（旧）与 Worker 里的 SQLite（M4）。
 * 两者同型是刻意的：`apps/web` 换存储是"换实现"，不是"改架构"。
 *
 * 保留引用是因为「构造同步客户端」需要它来读写**同步游标** ——
 * `getLastServerSeq`/`setLastServerSeq` 是 `OpLogStore` 接口的正式成员。
 * 此前同步 store 绕过它、自己再开一个 adapter 去读 `meta`，
 * 等于把游标键名知识复制了第二份。
 */
let opLogStore: OpLogStore<Operation<string>> | undefined;
let initPromise: Promise<void> | undefined;

/**
 * 选哪条存储路径。
 *
 * 默认 `sqlite` —— 那是 M4 的方向。`indexeddb` 是**回退开关**，
 * 保留到迁移被验证通过之后（见 `docs/plans/multi-platform-adaptation.md` M4-3）。
 * 用环境变量而不是运行时探测：**探测会让"这次到底用了哪条路"变得不可知**，
 * 而排查存储问题时，第一个要回答的就是这个问题。
 */
export type StorageBackend = 'sqlite' | 'indexeddb';

export function resolveStorageBackend(): StorageBackend {
  const raw = import.meta.env?.VITE_HEYTA_STORAGE;
  return raw === 'indexeddb' ? 'indexeddb' : 'sqlite';
}

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
 * 打开存储，返回 `{ store, clientId }`。
 *
 * 两条路径在这里分流，**其余代码完全不知道差别**。
 */
async function openStorage(
  dbName: string,
): Promise<{ store: OpLogStore<Operation<string>>; clientId: string }> {
  if (resolveStorageBackend() === 'indexeddb') {
    db = new IndexedDbAdapter(dbName);
    await db.init();
    const store = new IndexedDbOpLogStore<Operation<string>>(db);
    return { store, clientId: await resolveClientId(db) };
  }

  /**
   * 🔴 **Worker 的 URL 必须写成 `new URL(..., import.meta.url)` 这个字面量形式。**
   * Vite 靠**静态识别这个模式**来决定"要单独打一个 worker chunk"。
   * 换成变量、或拼字符串，它会静默地不打这个 chunk ——
   * 表现为运行时 404，而不是构建报错。
   */
  const worker = new Worker(new URL('../worker/storage.worker.ts', import.meta.url), {
    type: 'module',
  });

  /**
   * ⚠️ **顺序不能反**：`createWorkerOpLogSession` 会**同步**挂上监听，
   * 所以必须在 `await` 任何东西之前调用。先 await 再挂，Worker 的
   * `ready` 可能在监听装上之前就发出，那条消息会**直接丢失** ——
   * 表现为永远卡在 `ready`，而不是一个错误。
   */
  const session = createWorkerOpLogSession<Operation<string>>(worker);

  /** 等交握：`clientId` 由**库**给出，不能拿一个还没定的值去建向量时钟。 */
  const { clientId } = await session.ready;

  await migrateLegacyIndexedDb(session.store, dbName);

  return { store: session.store, clientId };
}

/**
 * 把**旧 IndexedDB 里的 op** 一次性搬进 SQLite。
 *
 * 🔴 没有这一步，切到 SQLite 的用户会看到**一个空应用** ——
 * 而且不报任何错。"数据看起来没了"是比崩溃更难挽回的一类故障。
 *
 * 两条守卫，缺一不可：
 *  1. **只在目标是空库时导入。** 否则每次启动都会把旧库再灌一遍，
 *     变成一个自我复制的数据源。判据用 `getLastLocalSeq() === 0`
 *     而不是"表里有几条" —— 前者是存储层自己的账，不会因过滤条件而失真。
 *  2. 旧库不存在 / 没有 op 时**安静返回**。首次安装的用户就属于这一类，
 *     不该在控制台留下任何"迁移失败"的噪音。
 *
 * ⚠️ 用 `appendImported` 而不是 `appendLocal`：这些 op **不是本地新写的**，
 * 它们带着自己原来的因果与 clientId。用 `appendLocal` 会把它们伪装成"本机刚产生"，
 * 同步层随后对它们的处理就会错。
 *
 * ⚠️ **不删旧库。** 迁移期间两个来源都可能被读到，删掉就无法回退
 * （`docs/plans/multi-platform-adaptation.md` M4-3「两者可并存一个版本周期」）。
 */
async function migrateLegacyIndexedDb(
  target: OpLogStore<Operation<string>>,
  dbName: string,
): Promise<void> {
  if ((await target.getLastLocalSeq()) > 0) return;

  let legacy: IndexedDbAdapter | undefined;
  try {
    legacy = new IndexedDbAdapter(dbName);
    await legacy.init();
    const legacyStore = new IndexedDbOpLogStore<Operation<string>>(legacy);
    const ops = (await legacyStore.getAllOps()).map((row) => row.op);
    if (ops.length === 0) return;

    const result = await target.appendImported(ops);
    // eslint-disable-next-line no-console -- 迁移必须留下可见痕迹：它是不可逆的数据事件。
    console.info(
      `[heyta] 已把旧 IndexedDB 的 ${ops.length} 条 op 导入 SQLite（新增 ${result.appended.length}、已存在 ${result.skipped.length}）`,
    );
  } catch (error) {
    /**
     * 🔴 **迁移失败不能阻断启动。** 旧库读不出来（版本不符、被占用、浏览器策略）
     * 时，正确行为是"从空库开始"而不是"应用打不开" —— 后者会让用户
     * 连导出/反馈的入口都没有。失败必须留痕，因为它意味着数据可能要看一眼。
     */
    // eslint-disable-next-line no-console
    console.error('[heyta] 旧 IndexedDB 迁移失败，将从空 SQLite 库开始', error);
  } finally {
    legacy?.close();
  }
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
    const backend = resolveStorageBackend();
    const opened = await openStorage(dbName);
    opLogStore = opened.store;

    /**
     * 🔴 **把"这次到底用了哪条存储路径"暴露到 `window` 上。**
     *
     * 不是为了调试方便 —— 是因为**这个切换本身无法从行为上区分**：
     * 两条路径都能让 e2e 全绿，所以"测试通过"证明不了真的切过去了。
     * 静默回退到 IndexedDB 时，一切看起来都正常，只有这一处会说真话。
     *
     * 与 `verify-universal-slice` 里"探针必须自己报出它验的是什么"同一条道理：
     * **可观测的断言 > 间接的行为推论。**
     */
    (globalThis as { __heytaStorage?: unknown }).__heytaStorage = {
      backend,
      clientId: opened.clientId,
    };

    engine = new OpLogEngine({ store: opLogStore, clientId: opened.clientId });
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
export function requireStore(): OpLogStore<Operation<string>> {
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
