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
import {
  DbOpLogStore,
  INDEXEDDB_SCHEMA,
  META_KEYS,
  STORES,
  SqliteAdapter,
  type DbAdapter,
  type SqliteDriver,
} from '@heyta/storage';
import {
  type ConflictInfo,
  type SyncClient,
  type SyncStatus,
} from '@heyta/sync-client';
import type { Operation } from '@heyta/sync-core';
import { randomId } from './ids.js';
import { createSyncClient } from './sync-wiring.js';

/**
 * 一次同步所需的全部凭据。
 *
 * 🔴 **为什么它是可变的、而不是 `openAppHost` 的静态字段：**
 *
 * 服务器地址、访问令牌、E2EE 口令都只能由**用户在应用启动之后**输入 ——
 * 启动时没有任何办法拿到它们。而 `openAppHost()` 在启动时就跑完了。
 *
 * 实测后果（移动壳）：`serverUrl` 传进去了，但 `token` / `password` 永远是
 * `undefined`，于是 `sync()` 永远以"未登录"失败 —— 而 `openHost` 里唯一的
 * 现象是"从不调用 sync()"，看起来像 UI 漏了按钮，实际是**接线拿不到凭据**。
 *
 * Web 宿主早就有这个问题，它的解法是在 store 里每次重建客户端并注入
 * `getToken: async () => get().token` 这样的**活取值器**。这里把同一个解法
 * 提到宿主层，好让原生宿主也能用同一条路。
 */
export interface SyncConfig {
  serverUrl: string;
  token?: string;
  password?: string;
}

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
   * **运行时可变**的同步凭据。给了它就**取代**上面的 `serverUrl` / `token` / `password`。
   *
   * 移动端必须用这个：用户是在应用起来之后才在「我的」里填服务器和口令的。
   * 不传则退回静态字段（Node 验收壳与测试用的就是静态路径）。
   */
  getSyncConfig?: () => SyncConfig | undefined;
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

  /**
   * 与真实服务端完整同步一次。
   *
   * 未配置同步服务时返回 `{ kind: 'error', message: '未配置同步服务' }` ——
   * **不会**返回"已同步"，因为那会把"没配置"伪装成"同步成功且没有新数据"。
   */
  sync(): Promise<SyncStatus>;

  /**
   * 用户手动解决一处冲突。
   *
   * 两个方向都走 op-log 重新派发（`sync-client` 的 `resolveConflict`），
   * 宿主不得直接改状态 —— 那正是 D4 禁止的绕开 op-log 的写入。
   */
  resolveConflict(
    conflict: ConflictInfo,
    choice: 'keep-local' | 'keep-remote',
  ): Promise<SyncStatus>;

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
 *
 * 🔴 **必须走 `randomId()`，不能直接 `globalThis.crypto.randomUUID()`。**
 *
 * 这里原来是后者，而且**在真机上炸了**（小米 Android 16，Hermes）：
 *
 *     打开本地数据库失败
 *     Cannot read property 'randomUUID' of undefined
 *
 * Hermes 里连 `globalThis.crypto` 都不存在，所以是读 `undefined` 的属性，
 * 不是"函数不存在"。`ids.ts` 就是为这件事写的、还专门写了文档解释 ——
 * 但 host.ts 是后来才抽出来的，**自己又写了一份绕过守卫的实现**。
 *
 * 这正是 AGENTS.md §3.5 记的那个形状：**同一个决定有两个实现，然后漂移**。
 * 而且它比 §3.5 原文预言的还早一步 —— 原文说会在"用户点新建任务"时炸，
 * 实际在启动解析 clientId 时就炸，应用直接停在错误页。
 *
 * ⚠️ 回退路径**不是密码学随机**（见 `ids.ts` 文件头的取舍说明）。
 * 对 clientId 这是有代价的，但"起不来"是确定发生的坏结果，两害相权取此。
 */
export async function resolveClientId(adapter: DbAdapter): Promise<string> {
  const existing = await adapter.get<{ key: string; value: string }>(
    STORES.META,
    META_KEYS.CLIENT_ID,
  );
  if (existing !== undefined && typeof existing.value === 'string') {
    return existing.value;
  }

  const fresh = randomId();
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

  /**
   * 读取当前生效的同步凭据。
   *
   * `getSyncConfig` 给了就用它（运行时可变，移动端走这条）；
   * 否则退回静态字段（Node 验收壳与测试走这条）。
   */
  const readSyncConfig = (): SyncConfig => {
    const live = options.getSyncConfig?.();
    if (live !== undefined) return live;
    return {
      serverUrl: options.serverUrl ?? '',
      ...(options.token !== undefined ? { token: options.token } : {}),
      ...(options.password !== undefined ? { password: options.password } : {}),
    };
  };

  /**
   * 构造一个**当前配置下**的同步客户端。
   *
   * 🔴 **每次同步重建，不缓存。** 缓存会让用户在「我的」里改完服务器地址或口令后，
   * 旧客户端继续用旧值 —— 而"改了设置但同步还是失败"是最难排查的一类问题。
   * `SyncClient` 自身没有连接状态，重建是廉价的（`apps/web` 早就是这个做法）。
   *
   * 未配置时返回 `undefined`，**不返回一个"什么也不做"的客户端** ——
   * 后者会把"没配置"伪装成"同步成功且没有新数据"，那是最坏的一类静默失败。
   */
  const buildSyncClient = (): SyncClient | undefined => {
    const config = readSyncConfig();
    // 口令可以不填（那样同步会在 E2EE 那一步明确失败，且不会降级成明文），
    // 但地址与令牌缺一不可 —— 没有它们连请求都发不出去。
    if (config.serverUrl === '' || config.token === undefined) return undefined;

    return createSyncClient({
      engine,
      store,
      baseUrl: config.serverUrl,
      getToken: async () => config.token,
      getPassword: async () => config.password,
      // 原生宿主没有订阅层：状态由调用方主动 `getState()` 拉取，
      // 因此应用远端之后**不需要**通知任何人。
      applyRemote: async (ops) => {
        await engine.applyRemote(ops);
      },
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    });
  };

  /** 未配置同步时的统一答复。**明确说"未配置"，不说"已同步"。** */
  const notConfigured = (): SyncStatus => ({
    kind: 'error',
    message: '未配置同步服务',
    retryable: false,
  });

  return {
    dbPath: options.dbPath,
    clientId,
    engine,

    async dispatch(intent: OpIntent): Promise<void> {
      await engine.dispatch(intent);
    },

    getState: () => engine.getState(),

    async sync(): Promise<SyncStatus> {
      const client = buildSyncClient();
      if (client === undefined) return notConfigured();
      return client.sync();
    },

    async resolveConflict(
      conflict: ConflictInfo,
      choice: 'keep-local' | 'keep-remote',
    ): Promise<SyncStatus> {
      const client = buildSyncClient();
      if (client === undefined) return notConfigured();
      return client.resolveConflict(conflict, choice);
    },

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
