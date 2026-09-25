/**
 * 宿主无关的应用接线
 * ====================
 *
 * ADR-0003 §2.1 说：**所有业务逻辑必须在 `packages/` 里，`apps/*` 只允许放平台外壳。**
 *
 * 这条规则一直有个说不清的地方：把零件接起来（打开存储 → 建引擎 → 接同步客户端）
 * 到底算"业务逻辑"还是"平台外壳"？它显然不是业务逻辑（真正的判定在
 * `packages/sync-client` 里），但它也不是平台差异 —— 除了**注入哪个 SQLite 驱动**，
 * 每个宿主要做的事**一模一样**。
 *
 * 结果是同一个接线被抄了第二遍（`apps/web/src/lib/oplog.ts`、`apps/node-host/src/host.ts`）。
 * 第三遍就是移动端。所以这里把它收敛成一份：
 *
 *     driverFactory（平台唯一差异）
 *          ↓
 *     SqliteAdapter → DbOpLogStore → OpLogEngine → SyncClient
 *
 * 宿主现在只需要提供三样东西：一个驱动工厂、一个库路径、同步参数。
 * **其余一行都不该由宿主自己写。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这个文件里有两处顺序是**不能换**的，两处都是踩过的坑：
 *
 * 1. `engine.recover()` 必须在接受任何新写入**之前**完成。
 *    否则「已落盘未应用」的 op 会占着 seq 却永不生效 —— 静默丢数据。
 *
 * 2. 同步游标读写必须走**同一个 meta store / 同一个键**
 *    （`STORES.META` + `META_KEYS.LAST_SERVER_SEQ`）。换存储实现时
 *    上层一行不用改，正是因为它没被任何平台特化。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { OpLogEngine, type MaterializedState, type OpIntent } from '@heyta/op-log';
import type { EntityType } from '@heyta/shared-schema';
import {
  DbOpLogStore,
  INDEXEDDB_SCHEMA,
  META_KEYS,
  STORES,
  SqliteAdapter,
  type DbAdapter,
  type SqliteDriver,
} from '@heyta/storage';
import { SyncClient, type SyncStatus } from '@heyta/sync-client';
import { OpType, type Operation } from '@heyta/sync-core';

export interface AppHostOptions {
  /**
   * 🔴 **唯一的平台差异。**
   *
   * 必须传**工厂**而不是实例：`SqliteAdapter.close()` 之后靠这个工厂透明重开，
   * 而 `NodeSqliteDriver` / `op-sqlite` / `expo-sqlite` 的实例都是一次性的。
   * 传实例会在第一次 `close()` 后炸在"已关闭的驱动"上。
   */
  driverFactory: () => SqliteDriver;
  /**
   * 存储位置的**人类可读标识**（真实文件路径 / 设备上的库名 / `:memory:`）。
   *
   * 只为诊断与断言保留，接线本身不消费它 —— 位置已经由 `driverFactory` 闭包决定。
   */
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
   * 默认 persist 在 meta store 里：同一台「设备」跨重启必须拿到**同一个**
   * clientId，否则 LWW 决胜依据会漂移。只有测试需要固定值时才传。
   */
  clientId?: string;
  /** 网络实现，默认 `globalThis.fetch`。仅用于测试注入。 */
  fetchImpl?: typeof fetch;
  /**
   * 时间源，默认 `Date.now`。**透传给 `OpLogEngine`**，理由见其 `now` 选项。
   *
   * 不透传的后果实测过：`createdAt` / `_lastOpId` 会带上真实时钟，
   * 于是"手写接线与 openAppHost 等价"这类测试**必然**对不上 ——
   * 差异全在时间戳里，看起来像行为漂移，其实是时钟没被控制。
   */
  now?: () => number;
}

export interface AppHost {
  readonly dbPath: string;
  readonly clientId: string;
  /** 底层引擎。读状态用它，**写状态一律走 dispatch / 各动作方法**。 */
  readonly engine: OpLogEngine;

  /**
   * 当前物化状态。
   *
   * 与 `dispatch` 配对构成 `ActionContext`，于是 `createTaskActions(host)`
   * 可以直接用 —— 宿主不需要自己写 `() => host.engine.getState()` 这种胶水。
   */
  getState(): MaterializedState;

  /**
   * **唯一写入入口。**
   *
   * 与 Web 宿主的 `dispatchIntent()` 是同一条纪律（AGENTS.md §3.4）：
   * 任何宿主都不得绕过它直接改状态。
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
export async function resolveClientId(adapter: DbAdapter): Promise<string> {
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
 * 打开一个宿主。**所有平台共用这一条路径。**
 *
 * 🔴 **崩溃恢复在接受任何新写入之前完成**（`engine.recover()`）。
 */
export async function openAppHost(options: AppHostOptions): Promise<AppHost> {
  const adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: options.driverFactory,
  });
  await adapter.init();

  const store = new DbOpLogStore<Operation<string>>(adapter);
  const clientId = options.clientId ?? (await resolveClientId(adapter));

  const engine = new OpLogEngine({
    store,
    clientId,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  await engine.recover();

  // ── 同步游标：所有宿主共用同一个 meta store / 同一个键 ──
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
   * 这里只注入平台差异：网络、令牌、口令。
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

  return {
    dbPath: options.dbPath,
    clientId,
    engine,

    async dispatch(intent: OpIntent): Promise<void> {
      await engine.dispatch(intent);
    },

    getState: () => engine.getState(),

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
export function materializedState(host: AppHost): MaterializedState {
  return host.engine.getState();
}
