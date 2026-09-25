/**
 * Node 宿主
 * ==========
 *
 * 目的**不是**做一个 Node 产品，而是给 ADR-0003 §2.1 一个可执行的判据：
 *
 * > 所有业务逻辑必须在 `packages/` 里，`apps/*` 只允许放平台外壳与 UI 绑定。
 *
 * 这个文件是整套分层里唯一属于「Node 平台外壳」的东西。它做的事只有一件：
 * 把已经存在的、宿主无关的零件接起来 ——
 *
 *   NodeSqliteDriver → SqliteAdapter → DbOpLogStore → OpLogEngine → SyncClient
 *
 * 它**没有**重写任何业务逻辑：op 的构造、向量时钟、冲突判定、上传/下载编排
 * 全部来自 `packages/`。如果哪天有逻辑只能在浏览器里跑，这个文件就会接不起来 ——
 * 那时暴露出来的正是「分层是假的」这个事实。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 与 Web 宿主的唯一区别是**注入的具体实现**：
 *
 *   | 维度     | Web（apps/web/src/lib/oplog.ts） | Node（本文件）            |
 *   |----------|----------------------------------|---------------------------|
 *   | 存储     | IndexedDbAdapter                 | SqliteAdapter（真实文件） |
 *   | 设备 id  | meta store                       | 同一个 meta store         |
 *   | 网络     | 浏览器 fetch                     | globalThis.fetch（Node 22）|
 *
 * 设备 id 的生成与游标存取用**同一套 `META_KEYS`**，所以两端的本地库
 * 结构完全一致 —— 这不是巧合，是「换存储实现上层一行不用改」的直接结果。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { Priority, type Task } from '@heyta/domain';
import { OpLogEngine, type MaterializedState, type OpIntent } from '@heyta/op-log';
import type { EntityType } from '@heyta/shared-schema';
import {
  DbOpLogStore,
  INDEXEDDB_SCHEMA,
  META_KEYS,
  STORES,
  SqliteAdapter,
  type DbAdapter,
} from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { SyncClient, type SyncStatus } from '@heyta/sync-client';
import { OpType } from '@heyta/sync-core';
import type { Operation } from '@heyta/sync-core';

export interface NodeHostOptions {
  /** **真实 SQLite 文件**路径。不要传 `:memory:` —— 那证明不了持久化。 */
  dbPath: string;
  /** 同步服务端根地址。离线只读/只写时可以省略。 */
  serverUrl?: string;
  /** 访问令牌。 */
  token?: string;
  /** E2EE 口令。缺失时同步会明确失败，**不会降级成明文**。 */
  password?: string;
  /**
   * 覆盖设备 id。
   *
   * 默认 persist 在 meta store 里：同一台「设备」跨进程重启必须拿到**同一个**
   * clientId，否则 LWW 决胜依据会漂移。只有测试需要固定值时才传。
   */
  clientId?: string;
  /** 网络实现，默认 `globalThis.fetch`。仅用于测试注入。 */
  fetchImpl?: typeof fetch;
}

export interface NodeHost {
  readonly dbPath: string;
  readonly clientId: string;
  /** 底层引擎。读状态用它，**写状态一律走 dispatch / 下面的意图方法**。 */
  readonly engine: OpLogEngine;

  /** 创建任务。返回新任务的实体 id。 */
  addTask(title: string): Promise<string>;
  /** 改标题（UPD op）。 */
  renameTask(entityId: string, title: string): Promise<void>;
  /** 完成 / 取消完成（UPD op）。 */
  setCompleted(entityId: string, completed: boolean): Promise<void>;
  /** 未删除的任务，按创建时间排序。 */
  listTasks(): Task[];

  /**
   * **唯一写入入口。**
   *
   * 与 Web 宿主的 `dispatchIntent()` 是同一条纪律（AGENTS.md §3.4）：
   * CLI 不得绕过它直接改状态。
   */
  dispatch(intent: OpIntent): Promise<void>;

  /** 与真实服务端完整同步一次。 */
  sync(): Promise<SyncStatus>;
  /** 待上传队列长度（离线队列是否清空，同步后应该为 0）。 */
  pendingUploadCount(): Promise<number>;

  /** 关闭 SQLite 连接。之后不可再用。 */
  close(): void;
}

/**
 * 读取或生成稳定的设备 clientId。
 *
 * **一经生成不可更改** —— 它是 LWW 冲突的确定性决胜依据。
 * 存在 `meta` store（与 Web 宿主同一个键），所以同一条 SQLite 文件
 * 每次打开都拿到同一个 id。
 */
async function resolveClientId(adapter: DbAdapter): Promise<string> {
  const existing = await adapter.get<{ key: string; value: string }>(
    STORES.META,
    META_KEYS.CLIENT_ID,
  );
  if (existing !== undefined && typeof existing.value === 'string') {
    return existing.value;
  }

  const fresh = globalThis.crypto.randomUUID();
  await adapter.put(STORES.META, { key: META_KEYS.CLIENT_ID, value: fresh });
  return fresh;
}

/**
 * 打开一个 Node 宿主。
 *
 * 🔴 **崩溃恢复在接受任何新写入之前完成**（`engine.recover()`）。
 * 顺序不可换：否则「已落盘未应用」的 op 会占着 seq 却永不生效 —— 静默丢数据。
 */
export async function openNodeHost(options: NodeHostOptions): Promise<NodeHost> {
  const adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    // 注入**工厂**而不是实例：驱动 close() 后由工厂透明重开。
    driverFactory: () => new NodeSqliteDriver(options.dbPath),
  });
  await adapter.init();

  const store = new DbOpLogStore<Operation<string>>(adapter);
  const clientId = options.clientId ?? (await resolveClientId(adapter));

  const engine = new OpLogEngine({ store, clientId });
  await engine.recover();

  // ── 同步游标：与 Web 宿主同一个 meta store / 同一个键 ──
  const readCursor = async (): Promise<number> => {
    const rec = await adapter.get<{ key: string; value: number }>(
      STORES.META,
      META_KEYS.LAST_SERVER_SEQ,
    );
    return rec?.value ?? 0;
  };
  const writeCursor = async (seq: number): Promise<void> => {
    await adapter.put(STORES.META, { key: META_KEYS.LAST_SERVER_SEQ, value: seq });
  };

  /**
   * 同步客户端是**宿主无关**的业务逻辑（`packages/sync-client`）。
   * 这里只注入平台差异：网络、令牌、口令、存储回调。
   */
  const client = new SyncClient({
    baseUrl: options.serverUrl ?? '',
    clientId,
    getToken: async () => options.token,
    getPassword: async () => options.password,
    getLastServerSeq: readCursor,
    setLastServerSeq: writeCursor,
    // 待上传队列直接来自存储的上传状态索引，不是内存列表 ——
    // 内存列表崩溃后就丢了，而「哪些还没上传」正是崩溃后最需要的信息。
    getLocalOps: () => engine.getPendingUpload(),
    markUploaded: (seqs) => engine.markUploaded(seqs),
    applyRemote: async (ops) => {
      await engine.applyRemote(ops);
    },
    redispatch: async (op) => {
      await engine.redispatch(op);
    },
    discardLocal: (ids) => engine.discardPendingUpload(ids),
    getOpsForEntity: (entityType, entityId) =>
      engine.getOpsForEntity(entityType as EntityType, entityId),
    getOpById: (opId) => engine.getOpById(opId),
    redispatchPayload: async (intent) => {
      // 冲突判定为「保留远端」时，把远端载荷表达成本地的一条新 op。
      // 直接改状态是 D4 禁止的绕开 op-log 的写入。
      await engine.dispatch({
        entityType: intent.entityType as EntityType,
        entityId: intent.entityId,
        opType: intent.opType as OpType,
        payload: intent.payload,
      });
    },
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  const requireTask = (entityId: string): Task => {
    const task = engine.getState().tasks[entityId];
    if (task === undefined || task.deletedAt !== undefined) {
      throw new Error(`找不到任务「${entityId}」`);
    }
    return task;
  };

  return {
    dbPath: options.dbPath,
    clientId,
    engine,

    async dispatch(intent: OpIntent): Promise<void> {
      await engine.dispatch(intent);
    },

    async addTask(title: string): Promise<string> {
      const trimmed = title.trim();
      if (trimmed === '') throw new Error('任务标题不能为空');

      const entityId = `task-${globalThis.crypto.randomUUID()}`;
      await engine.dispatch({
        entityType: 'TASK',
        entityId,
        opType: OpType.Create,
        payload: { title: trimmed, priority: Priority.None },
      });
      return entityId;
    },

    async renameTask(entityId: string, title: string): Promise<void> {
      requireTask(entityId);
      const trimmed = title.trim();
      if (trimmed === '') throw new Error('任务标题不能为空');
      await engine.dispatch({
        entityType: 'TASK',
        entityId,
        opType: OpType.Update,
        payload: { title: trimmed },
      });
    },

    async setCompleted(entityId: string, completed: boolean): Promise<void> {
      requireTask(entityId);
      // `null` 表示**显式清除该字段**。用 undefined 的话 JSON 会丢掉它，
      // 「取消完成」在另一端静默失效（reducer 把 null 翻译成真删除）。
      await engine.dispatch({
        entityType: 'TASK',
        entityId,
        opType: OpType.Update,
        payload: { completedAt: completed ? Date.now() : null },
      });
    },

    listTasks(): Task[] {
      return Object.values(engine.getState().tasks)
        .filter((task) => task.deletedAt === undefined)
        .sort((a, b) => {
          if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
    },

    sync: () => client.sync(),

    async pendingUploadCount(): Promise<number> {
      return (await engine.getPendingUpload()).length;
    },

    close(): void {
      adapter.close();
    },
  };
}

/** 当前物化状态（诊断用）。 */
export function materializedState(host: NodeHost): MaterializedState {
  return host.engine.getState();
}
