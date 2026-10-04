/**
 * 同步接线（宿主无关）
 * =========================
 *
 * 🔴 **这个文件存在的理由是消除一份已经漂移过的重复实现。**
 *
 * `SyncClientOptions` 有 12 个回调。在这次抽取之前，它们被**写了两遍**：
 *
 *   | 位置                            | 存储            | clientId 回退        |
 *   |---------------------------------|-----------------|----------------------|
 *   | `packages/app-host/src/host.ts` | SQLite          | `randomId()`（有回退）|
 *   | `apps/web/src/features/sync/store.ts` | IndexedDB | 自己那份 `Math.random()` |
 *
 * 连注释都是复制的。而 `ids.ts` 的文件头里那张"漂移对照表"已经记过一次
 * 同形状的事故（node-host 直接假定 `crypto.randomUUID` 存在，于是在 Hermes
 * 上启动即崩）。**两套接线一定会漂移，只是时间问题** —— 这里把时间问题变成
 * 了结构问题：接线只有一份，宿主只能注入真正的平台差异。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 到底哪些是"真正的平台差异"？逐个交代（判据来自 AGENTS.md §3.5：
 * **这段代码里有没有任何一行在决定"业务上该怎么做"？**）：
 *
 *   | 输入              | 是不是平台差异 | 为什么 |
 *   |-------------------|----------------|--------|
 *   | `engine`          | 否（构造于宿主）| 引擎本身宿主无关，宿主只是持有它 |
 *   | `store`           | 否（构造于宿主）| `OpLogStore` 接口对两套存储同形 |
 *   | `baseUrl`         | **是**         | 自建服务器的地址由用户填 |
 *   | `getToken`        | **是**         | Web 放内存 store，原生放 Keychain |
 *   | `getPassword`     | **是**         | 同上，且 E2EE 口令绝不长期落盘 |
 *   | `applyRemote`     | **是**         | 见下 |
 *   | `fetchImpl`       | **是**         | 原生要注入带证书固定的实现 |
 *
 * 其余 7 个回调（上传队列、标记已上传、重新派发、丢弃、按实体取历史、按 id 取 op、
 * 把远端载荷重新表达成新 op）**全部只是 `engine` 的转发**，一行平台差异都没有。
 * 它们在两个宿主里逐字相同，所以它们不该在两个宿主里各存在一次。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 `applyRemote` 为什么必须由宿主注入，而不是在这里写 `engine.applyRemote`：
 *
 * 它是这张表里**唯一**一个"转发之外还要做点别的"的回调，而那件"别的"恰好是
 * UI 关注点：Web 宿主应用完远端 op 之后必须 `notify()`，否则订阅的 store
 * 不会重渲染 —— 数据到了、界面不动。原生宿主没有这层订阅。
 *
 * 把它写死成 `engine.applyRemote` 就等于**替所有宿主决定了它们该不该通知 UI**。
 * 那正是"组件库替调用方做产品决定"，和 §3.5 要禁止的是同一类错误，
 * 只是发生在比 `apps/*` 更深的层次上。
 */

import type { OpLogEngine } from '@heyta/op-log';
import type { OpLogStore } from '@heyta/storage';
import { eraseLocalData } from './local-erasure.js';
import type { EntityType } from '@heyta/shared-schema';
import type { Operation, OpType } from '@heyta/sync-core';
import {
  createRealtimeClient as createRealtimeClientRaw,
  SyncClient,
  type RealtimeClient,
  type SyncEncryptionOptions,
  type WebSocketFactory,
} from '@heyta/sync-client';

export type SyncWiringOptions = SyncEncryptionOptions & {
  /** op-log 引擎。待上传队列、重新派发、应用远端都从它派生。 */
  engine: OpLogEngine;
  /**
   * op-log 存储。**只用来读写信封游标** ——
   * `getLastServerSeq`/`setLastServerSeq` 是 `OpLogStore` 接口的正式成员，
   * 两个宿主此前都绕过它直接去读 adapter，等于把游标键名知识复制了两份。
   */
  store: OpLogStore<Operation<string>>;
  /** 自建服务器地址。空字符串 = 未配置（→ 同步直接失败，不会假装成功）。 */
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
  getPassword: () => Promise<string | undefined>;
  /**
   * 应用一批远端 op。
   *
   * 🔴 **必须注入**，因为应用之后往往还要做宿主特有的事（Web 上是通知 UI 重渲染）。
   * 详见文件头的说明。
   */
  applyRemote: (ops: Operation<string>[]) => Promise<void>;
  /** 网络实现。原生宿主用它注入证书固定等平台能力。 */
  fetchImpl?: typeof fetch;
  /**
   * 账号注销时要做的本机销毁。**不传就用注册表里的那一个**
   * （`registerLocalEraser`，见 `./local-erasure.ts` 文件头讲的两条理由）。
   *
   * 这里给默认值不是"方便"，是**承重**：`openAppHost()` 与各壳的构造点都在
   * 这个包外面，如果默认值不存在，那条路径上的宿主会静默没有销毁器 ——
   * 而"信号收到了、本机什么都没少"正是这批工单要修的那个缺陷。
   */
  onAccountClosed?: () => Promise<void>;
}

/**
 * 构造同步客户端。**所有宿主共用这一条路径。**
 *
 * ⚠️ **不缓存**：`baseUrl` / 令牌 / 口令都可能变（用户改了地址、令牌过期重登），
 * 缓存会让旧客户端继续用旧值 —— 而"令牌换过之后同步一直失败"是最难排查的一类问题。
 * 调用方每次需要时重建即可；`SyncClient` 自身无连接状态，重建是廉价的。
 */
export function createSyncClient(options: SyncWiringOptions): SyncClient {
  const { engine, store } = options;

  return new SyncClient({
    baseUrl: options.baseUrl,
    clientId: engine.getClientId(),
    getToken: options.getToken,
    getPassword: options.getPassword,
    ...(options.encryptionMode === 'vault'
      ? { encryptionMode: 'vault' as const, getPayloadCipher: options.getPayloadCipher }
      : { encryptionMode: 'password' as const }),
    // 游标走 OpLogStore 接口，不碰 adapter：键名与事务语义只由存储层决定。
    getLastServerSeq: () => store.getLastServerSeq(),
    setLastServerSeq: (seq) => store.setLastServerSeq(seq),
    // 待上传队列直接来自**存储的上传状态索引**，不是内存列表 ——
    // 内存列表崩溃后就丢了，而「哪些还没上传」正是崩溃后最需要的信息。
    getLocalOps: () => engine.getPendingUpload(),
    markUploaded: (seqs) => engine.markUploaded(seqs),
    applyRemote: options.applyRemote,
    mergeRemoteClock: (clock) => engine.observeRemoteClockDurably(clock),
    markHistoryIncomplete: () => engine.markHistoryIncomplete(),
    // 冲突判定为「本地胜出」→ 重新派发（新 op，时钟已压过远端）。
    redispatch: async (op) => {
      await engine.redispatch(op);
    },
    // 冲突判定为「保留远端」→ 把远端载荷表达成本地的一条新 op。
    // 直接改状态是不行的 —— 那正是 D4 禁止的绕开 op-log 的写入。
    discardLocal: (ids) => engine.discardPendingUpload(ids),
    // 服务端**永久拒绝**的 op：移出队列但**不标成已上传** —— 数据没上云，
    // 标成 uploaded 会让"待上传数"和"已同步"同时说假话。
    markRejected: (ids) => engine.markRejected(ids),
    getOpsForEntity: (entityType, entityId) =>
      engine.getOpsForEntity(entityType as EntityType, entityId),
    getOpById: (opId) => engine.getOpById(opId),
    redispatchPayload: async (intent) => {
      await engine.dispatch({
        entityType: intent.entityType as EntityType,
        entityId: intent.entityId,
        opType: intent.opType as OpType,
        payload: intent.payload,
      });
    },
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    // 账号注销 ⇒ 销毁本机明文。**默认值读注册表**，所以经这条路的所有宿主
    // 都有反应，包括构造点在别的文件里、这一轮改不动的那些。
    onAccountClosed: options.onAccountClosed ?? (async () => void (await eraseLocalData())),
  });
}
/**
 * 实时通道的接线选项。
 *
 * 🔴 **它与 `SyncWiringOptions` 是同一件事的两半，所以放在同一个文件里。**
 *
 * `realtime.ts`（450 行、指数退避 + 抖动 + 令牌活取值、自带一整套测试）
 * 在 2026-09 之前**没有任何宿主调用它** —— 于是"在另一台设备上改了，
 * 这边要等很久才出现，而且看起来像同步坏了"。
 * 2026-09-29 web 先接上，当时是**在 web 的 store 里内联**建的；
 * 而那个文件头正好写着"接线只有一份，两套一定会漂移，只是时间问题" ——
 * 所以这里把它也提到共享层，移动端接的是**同一条**。
 */
export interface RealtimeWiringOptions {
  /** op-log 引擎。`clientId` 从它取 —— **不要再自己造一个**。 */
  engine: OpLogEngine;
  /** 自建服务器地址。 */
  baseUrl: string;
  /** **活取值器**，不是当下的值：用户是应用起来之后才填地址/令牌的。 */
  getToken: () => Promise<string | undefined>;
  /** 收到"有新 op"时调用（宿主据此触发一次普通同步）。参数是服务端的 `latestSeq`。 */
  onNewOps: (latestSeq: number) => void;
  /** WebSocket 实现。默认 `globalThis.WebSocket`；原生宿主用它注入平台能力。 */
  WebSocketImpl?: WebSocketFactory;
}

/**
 * 构造实时通道客户端。**所有宿主共用这一条路径。**
 *
 * 🔴 **`clientId` 必须来自引擎**（与 `createSyncClient` 同一个来源）：
 * LWW 的决胜依据是它，两处各造一个会让"本设备"在服务端看起来是两台设备 ——
 * 实测过一次同形状的事故（两台设备共用 clientId ⇒ 双方都同步不了）。
 *
 * ⚠️ 与 `createSyncClient` 一样**不缓存**：地址/令牌变了就要重建，
 * 而"令牌换过之后实时一直连不上"是最难排查的一类问题。
 */
export function createHostRealtimeClient(options: RealtimeWiringOptions): RealtimeClient {
  return createRealtimeClientRaw({
    baseUrl: options.baseUrl,
    getToken: options.getToken,
    clientId: options.engine.getClientId(),
    onNewOps: options.onNewOps,
    ...(options.WebSocketImpl !== undefined ? { WebSocketImpl: options.WebSocketImpl } : {}),
  });
}
