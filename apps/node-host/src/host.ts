/**
 * Node 宿主
 * ==========
 *
 * 目的**不是**做一个 Node 产品，而是给 ADR-0003 §2.1 一个可执行的判据：
 *
 * > 所有业务逻辑必须在 `packages/` 里，`apps/*` 只允许放平台外壳与 UI 绑定。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个文件在本轮被**大幅削薄**了，原因值得记下来。
 *
 * 它原本有 270 行：自己的 `resolveClientId`、自己的游标读写、自己把
 * `SyncClientOptions` 那十几个回调接一遍、自己的任务 op 构造、自己的
 * `crypto.randomUUID()`。当时这是可以接受的 —— 因为只有两个宿主，
 * 而且两端行为分别被 `verify:p1` 与 `verify:p2` 钉着。
 *
 * 但移动端是**第三个**宿主。再抄一遍就意味着：
 *
 *   - 同一套接线有三份，改一处要记得改三处；
 *   - 两边**已经开始漂移**了 —— 这个文件用 `crypto.randomUUID()` 生成 entityId，
 *     而 `apps/web` 用 `Date.now()+counter`；`apps/web` 有 randomUUID 缺失时的回退，
 *     这个文件**没有**（在 Hermes 上会直接抛）。
 *
 * 所以接线与动作都提到了 `@heyta/app-host`。**现在这里只剩平台差异**：
 * 用哪个 SQLite 驱动、库文件在哪。
 *
 * 判断这个文件是否还"薄"的标准很简单：**它有没有任何一行在决定"业务上该怎么做"？**
 * 有，就说明提取得不够。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 与 Web 宿主的唯一区别现在是**一行**：
 *
 *   | 维度     | Web（apps/web/src/lib/oplog.ts） | Node（本文件）            |
 *   |----------|----------------------------------|---------------------------|
 *   | 存储     | IndexedDbAdapter                 | NodeSqliteDriver（文件）  |
 *
 * 设备 id、游标、op 构造、上传/下载编排全部来自 `packages/` ——
 * 所以两端的本地库结构完全一致。这不是巧合。
 */

import {
  createTaskActions,
  materializedState,
  openAppHost,
  type AppHost,
} from '@heyta/app-host';
import type { Task } from '@heyta/domain';
import type { OpIntent } from '@heyta/op-log';
import type { EntityType } from '@heyta/shared-schema';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import type { SyncStatus } from '@heyta/sync-client';

export interface NodeHostOptions {
  /** **真实 SQLite 文件**路径。不要传 `:memory:` —— 那证明不了持久化。 */
  dbPath: string;
  /** 同步服务端根地址。离线只读/只写时可以省略。 */
  serverUrl?: string;
  /** 访问令牌。 */
  token?: string;
  /** E2EE 口令。缺失时同步会明确失败，**不会降级成明文**。 */
  password?: string;
  /** 覆盖设备 id。默认 persist 在 meta store 里（跨重启不变）。 */
  clientId?: string;
  /** 网络实现，默认 `globalThis.fetch`。仅用于测试注入。 */
  fetchImpl?: typeof fetch;
}

export interface NodeHost {
  readonly dbPath: string;
  readonly clientId: string;
  readonly engine: AppHost['engine'];

  /** 创建任务。返回新任务的实体 id。 */
  addTask(title: string): Promise<string>;
  /** 改标题（UPD op）。 */
  renameTask(entityId: string, title: string): Promise<void>;
  /** 完成 / 取消完成（UPD op）。 */
  setCompleted(entityId: string, completed: boolean): Promise<void>;
  /** 未删除的任务，按创建时间排序。 */
  listTasks(): Task[];

  /** **唯一写入入口**（AGENTS.md §3.4）。 */
  dispatch(intent: OpIntent): Promise<void>;

  /** 与真实服务端完整同步一次。 */
  sync(): Promise<SyncStatus>;
  /** 待上传队列长度（同步后应该为 0）。 */
  pendingUploadCount(): Promise<number>;

  /** 关闭 SQLite 连接。之后不可再用。 */
  close(): void;
}

export async function openNodeHost(options: NodeHostOptions): Promise<NodeHost> {
  // 平台差异只有这一处注入。
  const app = await openAppHost({
    dbPath: options.dbPath,
    driverFactory: () => new NodeSqliteDriver(options.dbPath),
    ...(options.serverUrl !== undefined ? { serverUrl: options.serverUrl } : {}),
    ...(options.token !== undefined ? { token: options.token } : {}),
    ...(options.password !== undefined ? { password: options.password } : {}),
    ...(options.clientId !== undefined ? { clientId: options.clientId } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  const actions = createTaskActions(app);

  return {
    dbPath: app.dbPath,
    clientId: app.clientId,
    engine: app.engine,

    addTask: (title) => actions.create(title),
    renameTask: (entityId, title) => actions.rename(entityId, title),
    setCompleted: (entityId, completed) => actions.setCompleted(entityId, completed),
    listTasks: () => actions.listTasks(),

    dispatch: (intent) => app.dispatch(intent),
    sync: () => app.sync(),
    pendingUploadCount: () => app.pendingUploadCount(),
    close: () => {
      app.close();
    },
  };
}

/** 当前物化状态（诊断用）。 */
export { materializedState };
export type { EntityType };
