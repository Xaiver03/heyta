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

import {
  OpLogEngine,
  type CheckedDispatchBuilder,
  type HistoryState,
  type MaterializedState,
  type OpIntent,
  type UndoOutcome,
} from '@heyta/op-log';
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
import { decodeBase64 } from '@heyta/sync-core';
import type { Operation } from '@heyta/sync-core';
import type { VaultKeyMigrationResponse } from '@heyta/shared-schema';
import { randomId } from './ids.js';
import { hasLocalEraser, registerLocalEraser } from './local-erasure.js';
import {
  assertLibraryOwner,
  claimLibraryOwner,
  planLibraryPurge,
  purgeLocalLibrary,
  LocalLibraryOwnedByAnotherAccountError,
  readLibraryOwner,
  type ClaimLibraryResult,
  type LibraryOwner,
  type LibraryPurgePlan,
  type LibraryPurgeResult,
} from './library-owner.js';
import { createSyncClient } from './sync-wiring.js';
import { readRemotePayloadMode, type HostPayloadMode } from './payload-mode-client.js';
import { disableVaultPayloadEncryption, enableVaultPayloadEncryption } from './payload-mode-migration.js';
import type { SyncClientOptions } from '@heyta/sync-client';
import {
  createVaultKeyMigrationRemote,
  createVaultMigrationInventorySource,
  createVaultMigrationJournal,
  acknowledgeVaultPayloadMigration,
  cancelVaultPayloadMigrationForScope,
  migrateVaultPayloads,
  type VaultMigrationProgress,
} from './vault-migration.js';
import {
  createVaultKeyPackageRemote,
  createVaultKeySession,
  type VaultKeyPackageRemote,
  type VaultKeySession,
} from './vault-session.js';
import { createVaultPayloadCipher } from '@heyta/sync-client';
import type { PendingVaultCreation } from './vault-session.js';
import { createVaultKeyPackageStore } from './vault-key-package-store.js';
import type { VaultKeyPackageScope } from './vault-key-package-store.js';
import type { AiRoutingConfig, EgressConsent, SecretStore } from '@heyta/ai';
import { generateInboundKeyPair, inboundPublicKey, type InboundAutomationField } from '@heyta/inbound-core';
import {
  createInboundRecipientKeyStore,
  type InboundRecipientKeyScope,
} from './inbound-key-store.js';
import {
  createInboundCommitJournal,
  createVaultWrappedAutomationWorkerStore,
} from './inbound-secret-store.js';
import {
  processInboundAutomationEvent,
  type ProcessInboundAutomationOptions,
} from './inbound-process.js';
// 🔴 这枚契约的真源在 `inbound-host-options.ts`（`index.ts` 也从那里对外导出）。
// `host.ts` 以前留过一份逐字重复的副本 —— 双事实源，改一处不会让另一处响。
import type { InboundAutomationHostOptions } from './inbound-host-options.js';
import {
  registerAutomationWorker,
  createInboundUploadAuthorization,
  type AutomationWorkerCredential,
} from './inbound-worker.js';
import {
  createInboundRecipientRemote,
  InboundRecipientRemoteError,
  type InboundRecipientRegistration,
} from './inbound-recipient-remote.js';

/** Stable account binding used in inbound envelope AAD; vault account ids stay numeric. */
const inboundAccountId = (value: string): string => /^\d+$/.test(value) ? `user-${value}` : value;

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
/** 「我的数据现在是什么状态」的本地读数（R7）。 */
export interface HostDataStatus {
  /**
   * 还在**待上传队列**里的本地 op 条数（`uploadStatus === 'pending'`）。
   *
   * 🔴 **它不是"没到服务端"的全部**：服务端永久拒绝的 op 会被 `markRejected`
   * 移出这个队列（改成 `'rejected'`），所以"我的改动在不在云上"这个问题
   * 的正确读数是 `pendingUpload + rejectedUpload`。两个数都留在这里，
   * 界面按自己的口径取（当前 web 那一句「N 项还没上传」取的是两者之和）。
   */
  readonly pendingUpload: number;
  /**
   * 服务端**永久拒绝**、已移出待上传队列的本地 op 条数
   * （`uploadStatus === 'rejected'`；这些数据没上云，也不会自动补传）。
   */
  readonly rejectedUpload: number;
  /** 最后一次**成功**同步的本地毫秒时刻；从没成功过就是 `undefined`。 */
  readonly lastSyncedAt?: number;
  /** 本机库归属（ADR-0084）；匿名库是 `undefined`。 */
  readonly owner?: LibraryOwner;
}

export interface SyncConfig {
  serverUrl: string;
  token?: string;
  password?: string;
  /** Stable authenticated account id; its presence selects vault mode. */
  accountId?: string;
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
  /** Stable authenticated account id; when set, the host uses vault mode. */
  accountId?: string;
  /**
   * Optional platform secure-storage read port. The host owns when it is
   * consulted: before the first vault sync, never from a settings screen.
   * The returned base64 value is wiped from the decoded buffer after the
   * session consumes it; the port must not persist it in ordinary storage.
   */
  vaultRootKeyStore?: {
    load(scope: VaultKeyPackageScope): Promise<string | undefined>;
    /** `true` must be the safe default when the marker cannot be read. */
    isAutoUnlockDisabled?(scope: VaultKeyPackageScope): Promise<boolean>;
  };
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
  /**
   * 本机明文**销毁成功之后**的宿主回调（批次 E2 口径 B）。
   *
   * 🔴 为什么要有这个钩子，而不是让共享层自己去清：
   * 宿主常常把 adapter 缓存成**单例**（移动端的 `open-host.ts` 用 `pending`/`resolvedHost`，
   * 全部屏共用一个 `AppHost`）。`destroy()` 之后再把同一个实例交出去，
   * 在口径 B 之前是"静默把刚删掉的空壳建回盘上"（§10.146 那枚 73728 字节），
   * 加了守卫之后是"下一次读当场抛" —— 两者都不是"这台设备回到全新空库"。
   * 而"要作废哪些缓存"是**宿主自己的生命周期知识**（AGENTS §3.5 的分界），
   * 所以这里开一个钩子，不在共享层复制一份。
   *
   * 语义：只在**这条兜底销毁器**（没人自己注册时）真的把 `adapter.destroy()` 跑成之后调一次；
   * 销毁抛错时不调（那份库还在，宿主不该假装清过）。
   */
  onLocalDataErased?: () => void;
  /** Platform secret/journal bridge for inbound automation uploads. */
  getInboundUploadAuthorization?: SyncClientOptions['getInboundUploadAuthorization'];
}

export interface AppHost {
  readonly dbPath: string;
  readonly clientId: string;
  /** 底层引擎。读状态用它，**写状态一律走 dispatch / 各动作方法**。 */
  readonly engine: OpLogEngine;

  /** Current account-bound vault session, or undefined before authenticated setup. */
  getVaultSession(): Promise<VaultKeySession | undefined>;
  /** Opaque package transport for the current authenticated server. */
  getVaultKeyPackageRemote(): VaultKeyPackageRemote | undefined;
  /** Synchronously fences and invalidates the current vault session. */
  invalidateVaultSession(): void;
  /** Prepare a new random root; no server mutation occurs until confirmation. */
  beginVaultRootRotation(newPassphrase: string): Promise<PendingVaultCreation | undefined>;
  /** Confirm the recovery code and atomically migrate/publish all ciphertext. */
  confirmVaultRootRotation(
    pending: PendingVaultCreation,
    enteredRecoveryCode: string,
    onProgress?: (progress: VaultMigrationProgress) => void,
    options?: VaultRootRotationOptions,
  ): Promise<VaultKeyMigrationResponse>;
  /** Release any staged root migration and remove its local encrypted draft. */
  cancelVaultRootRotation(): Promise<void>;

  /**
   * 这个账号当前在服务端上的载荷模式（ADR-0080）。界面只用来显示；
   * 写路径上的一次判定在 `sync()` 里做，且**读失败按 e2ee**。
   */
  getPayloadMode(): Promise<HostPayloadMode>;

  /**
   * 关掉端到端加密：把服务端上全部保留历史解密重传（ADR-0080 §5.2）。
   *
   * 🔴 不可撤销的那一半：已经进了每日备份/快照的明文收不回来。
   * 所以这个方法只负责做事，**要问的话在上面问**（危险确认在界面）。
   * 调用前必须已解锁 —— 没解锁就没有能解密的钥匙，会直接拒绝。
   */
  disablePayloadEncryption(
    onProgress?: (progress: { completed: number; total: number }) => void,
  ): Promise<{ requestId: string; migratedOperationCount: number }>;

  /**
   * 重新开启加密的**第一步**：只生成本地 root 与包，不碰服务端。
   *
   * 与 `beginVaultRootRotation` 同形：先拿到 pending（含一次性恢复码），
   * 用户把恢复码抄下来并回填之后，才走第二步去真的迁移。
   */
  beginPayloadEncryption(passphrase: string): Promise<PendingVaultCreation>;

  /**
   * 重新开启加密的**第二步**：全量重加密并原子发布首包与世代 1。
   *
   * 🔴 这一步会改写云端全部历史（明文 → 密文）。失败则整体不发布，
   * 账号仍停在明文模式 —— 不允许出现半密半明。
   */
  confirmPayloadEncryption(
    pending: PendingVaultCreation,
    enteredRecoveryCode: string,
    onProgress?: (progress: { completed: number; total: number }) => void,
  ): Promise<{ keyVersion: number; payloadKeyVersion: number }>;

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
  dispatchChecked<T>(build: CheckedDispatchBuilder<T>): Promise<T>;

  /**
   * 与真实服务端完整同步一次。
   *
   * 未配置同步服务时返回 `{ kind: 'error', reason: 'not-configured' }` ——
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

  /**
   * 「我的数据现在是什么状态」的**本地读数**（R7）：零网络、零副作用。
   *
   * `pendingUpload` 是"还没上去的条数"（本地索引计数）；`lastSyncedAt` 来自
   * META 的 `LAST_SYNCED_AT`（断网时它停在最后一次成功，这正是要给人看的事实）。
   */
  dataStatus(): Promise<HostDataStatus>;

  /** 撤销最近一次本地写入（反向 op；会话内）。 */
  undo(): Promise<UndoOutcome>;
  /** 重做最近一次被撤销的写入。 */
  redo(): Promise<UndoOutcome>;
  /** 撤销栈的只读快照（按钮可用性与"刚才做了什么"）。 */
  historyState(): HistoryState;

  /**
   * 本机库的归属（ADR-0084）。`undefined` = 匿名库（纯本地使用，没被账号认领过）。
   *
   * 界面用它回答「这台机器上的数据属于谁」—— 一个本地优先产品必须能回答的问题。
   */
  libraryOwner(): Promise<LibraryOwner | undefined>;

  /**
   * 认领/确认本机库归属。`mismatch` 时**没有副作用**，由调用方去问用户。
   *
   * 需要已配置 `accountId`；没有身份时返回 `'anonymous'`（不写归属）。
   */
  claimLibrary(): Promise<ClaimLibraryResult | 'anonymous'>;

  /** 登出前的销毁前事实：有没有东西还没上传、要不要用户确认。 */
  libraryPurgePlan(): Promise<LibraryPurgePlan>;

  /** 销毁本机库（登出 = 这台设备上不再留这个账号的数据）。 */
  purgeLibrary(): Promise<LibraryPurgeResult>;

  /** Register a durable inbound worker bound to this account/device. */
  registerInboundWorker(input: { userId: string; databaseEpoch: string }): Promise<AutomationWorkerCredential>;
  /** Persist the X25519 recipient key under the current Vault root. */
  saveInboundRecipientKey(key: InboundRecipientKeyScope, privateKey: Uint8Array): Promise<void>;
  /** Load a recipient key only while the Vault is unlocked. */
  loadInboundRecipientKey(key: InboundRecipientKeyScope): Promise<Uint8Array | undefined>;
  /** Read the authenticated public registration; no private key is returned. */
  getInboundRecipientRegistration(): Promise<InboundRecipientRegistration | undefined>;
  /** Create the first recipient epoch, refusing to overwrite an existing remote key. */
  ensureInboundRecipientKey(): Promise<InboundRecipientRegistration>;
  /** Rotate the recipient epoch with a package-version CAS, retaining old epochs for queued events. */
  rotateInboundRecipientKey(): Promise<InboundRecipientRegistration>;
  /** Claim and process at most one inbound event using the shared protocol. */
  processInboundAutomation(options: InboundAutomationHostOptions): Promise<Awaited<ReturnType<typeof processInboundAutomationEvent>>>;

  /**
   * 读**完整** op-log（导出/备份用），按本地 `seq` 升序。
   *
   * 🔴 这是刻意的"读全库"入口，与 `getPendingUpload()`（只读待上传队列）不同。
   * 导出必须能看到**全部** op，包括已上传、已应用、被拒绝的 —— 少了任何一类，
   * 导出的"完整"就是假的。
   */
  readOpLog(): Promise<Operation<string>[]>;

  /** 关闭 SQLite 连接。之后不可再用。 */
  close(): void;
}

/**
 * Optional bridge for accounts whose retained payloads still use the legacy
 * password cipher. The value is supplied by the explicit migration UI and is
 * never persisted in the sync configuration.
 */
export interface VaultRootRotationOptions {
  legacyPassword?: string;
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
/**
 * 打开**只是存储**的那一半（适配器 + store + clientId），**不建引擎**。
 *
 * 🔴 为什么单独要有它：桌面壳（M2：原生壳 + 壳内共享 UI）里**只允许有一个引擎**。
 * `openAppHost()` 会建 `OpLogEngine` 并 `recover()`；而桌面壳的 `app` 模式里，
 * 引擎属于**页侧的真应用**（它才有 feature store / 冲突解决 / 实时通道），
 * 壳的角色是"一个跑在原生 SQLite 上的 store"。
 *
 * 两个引擎同库会各自为政 —— 本仓反复记过同一件事：
 * 各建引擎则 `appliedOpIds` 与向量时钟漂移，冲突判定随即失真。
 * 所以壳那条路要的是**这一半**，不是 `openAppHost()`。
 *
 * ⚠️ 与 `openAppHost()` **共用同一段配方**（adapter → store → clientId），
 * 不复制第二份：复制会漂移，而漂移的表现是两边的 clientId 或 schema 对不上。
 */
export async function openOpLogStore<
  TOperation extends Operation<string> = Operation<string>,
>(options: {
  driverFactory: () => SqliteDriver;
  clientId?: string;
}): Promise<{
  adapter: SqliteAdapter;
  store: DbOpLogStore<TOperation>;
  clientId: string;
}> {
  const adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: options.driverFactory,
  });
  await adapter.init();

  const store = new DbOpLogStore<TOperation>(adapter);
  const clientId = options.clientId ?? (await resolveClientId(adapter));
  return { adapter, store, clientId };
}

export async function openAppHost(options: AppHostOptions): Promise<AppHost> {
  const { adapter, store, clientId } = await openOpLogStore({
    driverFactory: options.driverFactory,
    ...(options.clientId !== undefined ? { clientId: options.clientId } : {}),
  });

  /**
   * 本机数据销毁器的**兜底注册**（E2）。
   *
   * 🔴 为什么在宿主内部注册，而不是要求每个壳自己传一个回调：
   * `createSyncClient()` 的构造点有四个宿主（node-host、移动端、两个桌面壳），
   * 而它们都经这一个函数拿到 adapter。写在这里，"这个宿主忘了接"就**不是**
   * 一个可能的状态 —— 那正是 §10.2 那条取证量的东西（信号收到了、没人清）。
   *
   * ⚠️ **只在没人注册时注册**：Web 有自己的销毁器（要清 OPFS/`localStorage`/
   * SW 那四类，adapter 一份清不完），它先注册 ⇒ 这里就不许把它盖掉。
   * 反过来如果这里无条件注册，症状是"Web 注销后 OPFS 里那份库还在"。
   */
  if (!hasLocalEraser()) {
    registerLocalEraser(async () => {
      const report = await adapter.destroy();
      // 🔴 顺序：**销毁成功之后**才通知，且抛错时一句都不通知。
      // 理由是这一格真正防的那件事：宿主把 adapter  caches 在单例里
      // （移动端 `open-host.ts` 的 `pending`/`resolvedHost` 就是全部屏共用的那一个）。
      // 销毁之后继续把同一个实例交出去，在口径 B 之前是"静默把空壳建回盘上"，
      // 之后是"下一次读当场抛 `AdapterDestroyedError`" —— 两种都不是注销完该有的样子，
      // 政策承诺的是这台设备回到**全新空库**（计划 §10.188）。
      // 共享层**不自己清单例**：哪些东西要作废是宿主的生命周期知识（AGENTS §3.5）。
      options.onLocalDataErased?.();
      return [report];
    });
  }

  const engine = new OpLogEngine({
    store,
    clientId,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  /**
   * 🔴 恢复失败必须**先把库关掉再抛**，不能让它裸穿出去。
   *
   * 【为什么（崩溃审计 2026-11-08 · B.1/B.5/E2）】
   *
   * `engine.recover()` 是真实 I/O：`readObservedClock` / `readCheckpoint` /
   * `findPendingApply` / `getAllOps` 都会走到盘上；而且**回放路径本身会抛** ——
   * `applyOperation` 在 `state.ts` 有三处同步 `throw`（不支持的 full-state、
   * 因果边界越界、非法的 task batch），reducer 对 `Object.prototype` 成员名
   * 还有过原型链污染导致的 TypeError（已修，见 `nullProtoMap`）。
   *
   * 它此前是**裸调用**，于是失败时这一串后果同时发生：
   *
   *   1. `openAppHost()` reject ⇒ 宿主对象不存在 ⇒ **没有任何 UI 能报错**；
   *   2. 但第 503 行打开的 adapter **已经拿到连接**，且因为作用域退出而
   *      **永远不会 `close()`** —— 移动端的 `open-host.ts` 会把 `pending` 置 null
   *      允许重试，于是第二次在**同一个库文件**上再开一条连接。
   *      这正是本文件 99–105 行注释警告的那件事：多连接同一库 ⇒
   *      向量时钟互相覆盖 ⇒ 数据损坏。
   *
   * 所以这里做两件事，缺一不可：**关掉连接**（防多连接），**包成可判别的错误**
   * （让壳能说"本地数据读不出来"而不是抛一句 TypeError）。
   *
   * ⚠️ `close()` 的契约是"后续操作透明重开"，所以它**不是** `destroy()` ——
   * 我们只释放连接，一条用户数据都不删。重试会得到一条干净的新连接。
   */
  try {
    await engine.recover();
  } catch (cause) {
    try {
      adapter.close();
    } catch {
      // 连 close() 都失败时，原始失败信息更有价值 —— 不要让它被这里盖掉。
    }
    throw new Error(
      '本地数据库恢复失败：读不出已存在的操作日志。' +
        '这通常意味着本地库被写坏，或某个版本的写入无法被当前版本解析。' +
        '请先导出备份后再尝试修复；如果反复出现，请带着这个错误报告。',
      { cause },
    );
  }

  const vaultStore = createVaultKeyPackageStore(adapter);
  const vaultMigrationJournal = createVaultMigrationJournal(adapter);
  let vaultSession: VaultKeySession | undefined;
  let vaultSessionScope: string | undefined;
  let vaultSessionBinding: string | undefined;
  let vaultEpoch = 0;
  let autoUnlockDisabledScope: string | undefined;
  let vaultExclusiveTail: Promise<void> = Promise.resolve();

  const withVaultExclusive = async <T>(action: () => Promise<T>): Promise<T> => {
    const previous = vaultExclusiveTail;
    let release!: () => void;
    vaultExclusiveTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  };

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
      ...(options.accountId !== undefined ? { accountId: options.accountId } : {}),
    };
  };

  /* ── 本机库归属（ADR-0084） ─────────────────────────────── */

  /** 当前认证会话的身份；`undefined` = 匿名/本地模式（没有"换账号"语义）。 */
  const currentAccountIdentity = (): { accountId: string; serverOrigin: string } | undefined => {
    const config = readSyncConfig();
    const accountId = config.accountId?.trim();
    if (accountId === undefined || accountId === '') return undefined;
    if (config.serverUrl.trim() === '') return undefined;
    let serverOrigin: string;
    try {
      serverOrigin = new URL(config.serverUrl).origin;
    } catch {
      return undefined;
    }
    return { accountId, serverOrigin };
  };

  /**
   * 上一次判定过的身份。命中缓存就**不再读 META** —— 每次本地写入都去查一次归属
   * 会让"建一条任务"多一次异步读；而归属在会话内不会变（变了 key 就对不上）。
   */
  let ownerGuardKey: string | undefined;
  let ownerGuardOwner: LibraryOwner | undefined;

  /**
   * 写路径与同步路径的**共同闸门**：库不是这个账号的就拒绝。
   *
   * 🔴 为什么写路径也要拦：拒绝同步只挡住"数据出去/进来"，挡不住 B 把新任务写进
   * A 的库里 —— 等 A 回来就会看到一堆不属于自己的东西。两种方向都要 fail closed。
   */
  const requireLibraryOwner = async (): Promise<void> => {
    const identity = currentAccountIdentity();
    if (identity === undefined) return;
    const key = `${identity.accountId}\u0000${identity.serverOrigin}`;
    if (ownerGuardKey === key && ownerGuardOwner !== undefined) return;
    ownerGuardOwner = await assertLibraryOwner(store, identity);
    ownerGuardKey = key;
  };

  const readVaultSession = async (): Promise<VaultKeySession | undefined> => {
    const config = readSyncConfig();
    const accountId = config.accountId?.trim();
    if (accountId === undefined || accountId === '' || config.serverUrl.trim() === '') {
      return undefined;
    }
    let serverOrigin: string;
    try {
      serverOrigin = new URL(config.serverUrl).origin;
    } catch {
      throw new Error('Invalid vault server URL');
    }
    const scopeKey = `${accountId}\u0000${serverOrigin}`;
    const bindingKey = `${scopeKey}\u0000${config.token ?? ''}`;
    if (vaultSession !== undefined && vaultSessionBinding === bindingKey) {
      return vaultSession;
    }
    // A changed server/token binding must never inherit an old in-memory
    // session, even when a caller accidentally retained the same account id.
    if (vaultSession !== undefined) {
      vaultEpoch += 1;
      vaultSession.lock();
      vaultSession = undefined;
      vaultSessionScope = undefined;
      vaultSessionBinding = undefined;
    }
    {
      const epoch = ++vaultEpoch;
      const nextSession = await createVaultKeySession({
        store: vaultStore,
        scope: { accountId, serverOrigin },
      });
      // The server's active payload generation is independent from the local
      // wrapper revision. Load it before the first cipher is handed to sync;
      // otherwise a passphrase re-wrap would make new uploads use the wrapper
      // revision and hit the generation gate after an atomic migration.
      if (config.token !== undefined && config.token !== '') {
        const remote = createVaultKeyPackageRemote({
          baseUrl: config.serverUrl,
          getToken: async () => readSyncConfig().token,
          ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
        });
        await nextSession.refreshFromRemote(remote);
      }
      if (epoch !== vaultEpoch) {
        nextSession.lock();
        return undefined;
      }
      const disabled = autoUnlockDisabledScope === scopeKey ||
        (options.vaultRootKeyStore?.isAutoUnlockDisabled !== undefined &&
          await options.vaultRootKeyStore.isAutoUnlockDisabled({ accountId, serverOrigin }));
      if (epoch !== vaultEpoch) {
        nextSession.lock();
        return undefined;
      }
      if (!disabled && nextSession.keyPackage !== undefined && options.vaultRootKeyStore !== undefined) {
        const remembered = await options.vaultRootKeyStore.load({ accountId, serverOrigin });
        if (epoch !== vaultEpoch) {
          nextSession.lock();
          return undefined;
        }
        if (remembered !== undefined) {
          const root = new Uint8Array(decodeBase64(remembered));
          try {
            nextSession.unlockWithRootKey(root);
            await nextSession.restorePendingRootRotation();
          } finally {
            root.fill(0);
          }
        }
      }
      if (epoch !== vaultEpoch) {
        nextSession.lock();
        return undefined;
      }
      vaultSession = nextSession;
      vaultSessionScope = scopeKey;
      vaultSessionBinding = bindingKey;
    }
    return vaultSession;
  };

  const readVaultRemote = (): VaultKeyPackageRemote | undefined => {
    const config = readSyncConfig();
    if (config.serverUrl.trim() === '' || config.token === undefined || config.token === '') return undefined;
    return createVaultKeyPackageRemote({
      baseUrl: config.serverUrl,
      getToken: async () => readSyncConfig().token,
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    });
  };

  // Inbound worker secrets and the commit journal share the same durable meta
  // store as the op-log. Tokens/private keys are only persisted wrapped by the
  // live Vault root; a locked Vault therefore fails closed.
  const inboundWorkerSecrets = createVaultWrappedAutomationWorkerStore(adapter, async () => {
    try {
      const session = await readVaultSession();
      if (session?.state !== 'unlocked') return undefined;
      const root = session.copyUnlockedRootKey();
      try { return root; } catch { root.fill(0); return undefined; }
    } catch { return undefined; }
  });
  const inboundCommitJournal = createInboundCommitJournal(adapter);
  const inboundRecipientKeys = createInboundRecipientKeyStore(adapter);

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
  /**
   * 读一次服务端载荷模式（ADR-0080）。**默认 e2ee**，读失败也回 e2ee。
   *
   * 🔴 故意**不留缓存**：`sync()` / `resolveConflict()` 每次都会先读一次再用，
   * 任何"上次读到的值"都会在读取前被覆盖 —— 那种缓存是死代码，而它看起来
   * 像是安全措施，比没有更糟（这一段是实测发现的：摘掉赋值，测试照样绿）。
   */
  const refreshPayloadMode = async (): Promise<HostPayloadMode> => {
    const config = readSyncConfig();
    /**
     * 🔴 只要求**令牌**（问"我是哪种账号"是一次带鉴权的请求），**不要求 `accountId`**。
     *
     * 这一行原来把 `accountId` 也当成前置，于是"手填地址 + 令牌"那条路
     * （`accountId` 只有登录会话才写得进）在这里就直接回落 `'e2ee'` ——
     * 连问都不问服务端。下游 `buildSyncClient` 于是按 vault 加密发，
     * 服务端以 `PLAINTEXT_REQUIRED` 拒掉每一条，`latestSeq` 恒 0。
     * 真机现量与三个独立信源见 `docs/plans/mobile-plaintext-sync-gap-2026-11-08.md`。
     *
     * `accountId` 是**本机库归属**用的（ADR-0084），不是"账号模式"的前置条件；
     * 把它俩绑在一起，就是把"我不知道自己属于谁"误当成"我是加密账号"。
     */
    if (config.token === undefined || config.token === '') {
      return 'e2ee';
    }
    return readRemotePayloadMode({
      baseUrl: config.serverUrl,
      token: config.token,
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    });
  };

  /**
   * 立即作废当前会话并写下 auto-unlock fence（ADR-0050 的顺序）。
   *
   * 抽成局部函数是因为两个调用点（对象方法本身、以及"关掉加密之后"）必须
   * **逐字相同**：任何一处少写一根字段，症状都是"登出后还能自动解锁"。
   */
  const invalidateVaultSessionNow = (): void => {
    vaultEpoch += 1;
    const config = readSyncConfig();
    let scopeKey = vaultSessionScope;
    if (scopeKey === undefined && config?.accountId !== undefined && config.serverUrl.trim() !== '') {
      try {
        scopeKey = `${config.accountId.trim()}\u0000${new URL(config.serverUrl).origin}`;
      } catch {
        // Invalid configuration is cleared by the caller.
      }
    }
    if (scopeKey !== undefined) autoUnlockDisabledScope = scopeKey;
    vaultSession?.lock();
    vaultSession = undefined;
    vaultSessionScope = undefined;
    vaultSessionBinding = undefined;
  };

  const buildSyncClient = (payloadMode: HostPayloadMode): SyncClient | undefined => {
    const config = readSyncConfig();
    // 口令可以不填（那样同步会在 E2EE 那一步明确失败，且不会降级成明文），
    // 但地址与令牌缺一不可 —— 没有它们连请求都发不出去。
    if (config.serverUrl === '' || config.token === undefined) return undefined;

    /**
     * 🔴 **账号模式决定写什么形状 —— 与"这台设备有没有 `accountId`"无关。**
     *
     * 这一条是 2026-11-08 在真机上量出来的缺陷的修法
     * （`docs/plans/mobile-plaintext-sync-gap-2026-11-08.md`）：
     * 原来 `payloadMode === 'plain'` 的判断**嵌在 `accountId !== undefined` 里面**，
     * 于是"手填服务器地址 + 令牌"那条路（`accountId` 只有登录会话才写得进）
     * 一路走到第三支，那里 `getPassword: () => config.password` ⇒ **有口令就 vault 加密**
     * ⇒ 服务端每次都以 `PLAINTEXT_REQUIRED` 拒掉、`latestSeq` 恒 0，而界面只说"同步失败"。
     *
     * 判据：`packages/app-host/tests/payload-mode-host.spec.ts` 的
     * 「readable 账号 + 活配置 + 没有 accountId ⇒ 仍必须发明文」（修之前是红的）。
     *
     * ⚠️ 为什么以**服务端**为准而不是以"用户填了口令"为准：
     * 账号的 `payload_mode` 是服务端权威的（ADR-0080 §S1），两个方向都拒错配；
     * 用户填了口令只说明"他想要加密"，而"这个账号是不是加密账号"不是本机能定的。
     * 冲突时**按服务端写**、并在界面上如实说明（见 `sync` 那一支的分档），
     * 而不是发一个注定被拒的形状然后报"同步失败"。
     */
    const inboundAuth = config.accountId !== undefined && config.accountId.trim() !== ''
      ? (options.getInboundUploadAuthorization ?? createInboundUploadAuthorization({
          userId: config.accountId, secrets: inboundWorkerSecrets, journal: inboundCommitJournal,
        }))
      : options.getInboundUploadAuthorization;

    if (payloadMode === 'plain') {
      return createSyncClient({
        engine,
        store,
        baseUrl: config.serverUrl,
        getToken: async () => readSyncConfig().token,
        getPassword: async () => undefined,
        encryptionMode: 'plain',
        applyRemote: async (ops) => {
          await engine.applyRemote(ops);
        },
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
        ...(inboundAuth !== undefined ? { getInboundUploadAuthorization: inboundAuth } : {}),
      });
    }

    if (config.accountId !== undefined && config.accountId.trim() !== '') {
      return createSyncClient({
        engine,
        store,
        baseUrl: config.serverUrl,
        getToken: async () => readSyncConfig().token,
        getPassword: async () => undefined,
        encryptionMode: 'vault',
        getPayloadCipher: async () => (await readVaultSession())?.getPayloadCipher() ?? undefined,
        applyRemote: async (ops) => {
          await engine.applyRemote(ops);
        },
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
        getInboundUploadAuthorization: options.getInboundUploadAuthorization ?? createInboundUploadAuthorization({
          userId: config.accountId, secrets: inboundWorkerSecrets, journal: inboundCommitJournal,
        }),
      });
    }

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
      ...(options.getInboundUploadAuthorization !== undefined
        ? { getInboundUploadAuthorization: options.getInboundUploadAuthorization } : {}),
    });
  };

  /** 未配置同步时的统一答复。**明确说"未配置"，不说"已同步"。** */
  const notConfigured = (): SyncStatus => ({
    kind: 'error',
    reason: 'not-configured',
    retryable: false,
  });

  return {
    dbPath: options.dbPath,
    clientId,
    engine,

    getVaultSession: readVaultSession,
    getVaultKeyPackageRemote: readVaultRemote,

    invalidateVaultSession(): void {
      invalidateVaultSessionNow();
    },

    async beginVaultRootRotation(newPassphrase: string): Promise<PendingVaultCreation | undefined> {
      return (await readVaultSession())?.beginRootRotation(newPassphrase);
    },

    async getPayloadMode(): Promise<HostPayloadMode> {
      return refreshPayloadMode();
    },

    async disablePayloadEncryption(
      onProgress?: (progress: { completed: number; total: number }) => void,
    ): Promise<{ requestId: string; migratedOperationCount: number }> {
      return withVaultExclusive(async () => {
        const session = await readVaultSession();
        if (session === undefined || session.state !== 'unlocked') {
          // 没有解锁就没有能解密的钥匙。绝不允许"因为解不开就跳过"——
          // 那会发布一份半密半明的历史。
          throw new Error('Vault must be unlocked before encryption can be turned off');
        }
        const cipher = await session.getPayloadCipher();
        const keyPackage = session.keyPackage;
        if (cipher === undefined || keyPackage === undefined) {
          throw new Error('Vault key package is unavailable');
        }
        const config = readSyncConfig();
        if (config.token === undefined || config.token === '' || config.serverUrl.trim() === '') {
          throw new Error('Sync credentials are unavailable');
        }
        const remoteOptions = {
          baseUrl: config.serverUrl,
          getToken: async () => config.token as string,
          ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
        };
        const result = await disableVaultPayloadEncryption({
          inventory: createVaultMigrationInventorySource(remoteOptions),
          remote: createVaultKeyMigrationRemote(remoteOptions),
          expectedKeyVersion: keyPackage.keyVersion,
          requestId: `turnoff_${String(Date.now())}_${Math.random().toString(36).slice(2, 10)}`,
          decrypt: async (ciphertext, operation) => cipher.decrypt(ciphertext, {
            id: operation.id,
            clientId: operation.clientId,
            actionType: operation.actionType,
            opType: operation.opType,
            entityType: operation.entityType,
            ...(operation.entityId === undefined ? {} : { entityId: operation.entityId }),
            ...(operation.entityIds === undefined ? {} : { entityIds: operation.entityIds }),
            timestamp: operation.timestamp,
            schemaVersion: operation.schemaVersion,
          }),
          ...(onProgress === undefined ? {} : { onProgress }),
        });
        // 包已经在服务端被删掉，本地会话里的那一份从此无效：锁掉。
        // （模式不在这里"记住"——下一次 sync() 会自己读一次服务端事实。）
        invalidateVaultSessionNow();
        return { requestId: result.requestId, migratedOperationCount: result.migratedOperationCount };
      });
    },

    async beginPayloadEncryption(passphrase: string): Promise<PendingVaultCreation> {
      const session = await readVaultSession();
      if (session === undefined) throw new Error('Vault session is unavailable');
      // 有包就不该走这条路（那是 root 轮换）。这条守卫与 session 里那条互为表里。
      if (session.keyPackage !== undefined) {
        throw new Error('Re-encryption requires an account without a key package');
      }
      return session.beginCreation(passphrase);
    },

    async confirmPayloadEncryption(
      pending: PendingVaultCreation,
      enteredRecoveryCode: string,
      onProgress?: (progress: { completed: number; total: number }) => void,
    ): Promise<{ keyVersion: number; payloadKeyVersion: number }> {
      return withVaultExclusive(async () => {
        const session = await readVaultSession();
        if (session === undefined) throw new Error('Vault session is unavailable');
        const config = readSyncConfig();
        if (config.token === undefined || config.token === '' || config.serverUrl.trim() === '') {
          throw new Error('Sync credentials are unavailable');
        }
        const remoteOptions = {
          baseUrl: config.serverUrl,
          getToken: async () => config.token as string,
          ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
        };
        const result = await session.confirmAndMigrateReEncryption(pending, enteredRecoveryCode, async (input) => {
          const cipher = createVaultPayloadCipher({
            current: { keyVersion: 1, rootKey: input.targetRootKey },
          });
          await enableVaultPayloadEncryption({
            inventory: createVaultMigrationInventorySource(remoteOptions),
            remote: createVaultKeyMigrationRemote(remoteOptions),
            package: input.targetPackage,
            requestId: `turnon_${String(Date.now())}_${Math.random().toString(36).slice(2, 10)}`,
            encrypt: async (plaintext, operation) => cipher.encrypt(plaintext, {
              id: operation.id,
              clientId: operation.clientId,
              actionType: operation.actionType,
              opType: operation.opType,
              entityType: operation.entityType,
              ...(operation.entityId === undefined ? {} : { entityId: operation.entityId }),
              ...(operation.entityIds === undefined ? {} : { entityIds: operation.entityIds }),
              timestamp: operation.timestamp,
              schemaVersion: operation.schemaVersion,
            }),
            ...(onProgress === undefined ? {} : { onProgress }),
          });
          return { keyVersion: 1, payloadKeyVersion: 1 };
        });
        return result;
      });
    },

    async confirmVaultRootRotation(
      pending: PendingVaultCreation,
      enteredRecoveryCode: string,
      onProgress?: (progress: VaultMigrationProgress) => void,
      rotationOptions?: VaultRootRotationOptions,
    ): Promise<VaultKeyMigrationResponse> {
      return withVaultExclusive(async () => {
        const session = await readVaultSession();
        if (session === undefined) throw new Error('Vault session is unavailable');
        const config = readSyncConfig();
        if (config.token === undefined || config.token === '' || config.serverUrl.trim() === '') {
          throw new Error('Vault migration credentials are unavailable');
        }
        const oldRoot = session.state === 'unlocked' ? session.copyUnlockedRootKey() : undefined;
        const serverOrigin = new URL(config.serverUrl).origin;
        const priorWorker = oldRoot === undefined || config.accountId === undefined
          ? undefined
          : await inboundWorkerSecrets.load({ userId: config.accountId, clientId, serverOrigin });
        try {
        const migrationEpoch = vaultEpoch;
        const migrationToken = config.token;
        const currentPayloadKeyVersion = session.payloadKeyVersion ?? null;
        const targetPayloadKeyVersion = (session.payloadKeyVersion ?? 0) + 1;
        const legacyPassword = rotationOptions?.legacyPassword ?? config.password;
        const remoteOptions = {
          baseUrl: config.serverUrl,
          getToken: async () => migrationToken,
          ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
        };
        const inventory = createVaultMigrationInventorySource(remoteOptions);
        const migrationRemote = createVaultKeyMigrationRemote(remoteOptions);
        const journalScope = `${session.scope.accountId}\u0000${session.scope.serverOrigin}`;
        let published: VaultKeyMigrationResponse | undefined;
        await session.confirmAndMigrateRootRotation(pending, enteredRecoveryCode, async (input) => {
          published = await migrateVaultPayloads({
            inventory,
            remote: migrationRemote,
            package: input.targetPackage,
            expectedKeyVersion: input.currentPackage.keyVersion,
            currentPayloadKeyVersion,
            targetPayloadKeyVersion,
            currentRootKey: input.currentRootKey,
            targetRootKey: input.targetRootKey,
            ...(currentPayloadKeyVersion === null && legacyPassword !== undefined
              ? { legacyPassword }
              : {}),
            journal: vaultMigrationJournal,
            journalScope,
            clearJournalOnPublished: false,
            onProgress,
          });
          return published;
        });
        if (migrationEpoch !== vaultEpoch) throw new Error('Vault migration was invalidated by credential changes');
        if (published === undefined) throw new Error('Vault migration did not publish a result');
        // The migration journal is acknowledged only after confirmAndMigrate...
        // has atomically installed the package, payload generation, and root.
        await acknowledgeVaultPayloadMigration(vaultMigrationJournal, journalScope, published.requestId);
        // The root rotation changes the wrapping key for local automation
        // credentials as well. Re-wrap both durable secrets before exposing the
        // new session to the next worker cycle; plaintext keys never leave this
        // closure and are wiped on every path.
        if (oldRoot !== undefined) {
          const newRoot = session.copyUnlockedRootKey();
          try {
            if (inboundWorkerSecrets.rewrap !== undefined && config.accountId !== undefined) {
              await inboundWorkerSecrets.rewrap({ userId: config.accountId, clientId, serverOrigin }, oldRoot, newRoot);
            } else if (priorWorker !== undefined) {
              await inboundWorkerSecrets.save(priorWorker);
            }
            await inboundRecipientKeys.rewrap(oldRoot, newRoot, { ...session.scope, accountId: inboundAccountId(session.scope.accountId) });
          } finally { newRoot.fill(0); }
        }
        return published;
        } finally { oldRoot?.fill(0); }
      });
    },

    async cancelVaultRootRotation(): Promise<void> {
      await withVaultExclusive(async () => {
        const session = await readVaultSession();
        if (session === undefined) return;
        const config = readSyncConfig();
        const remote = config.token === undefined || config.token === '' || config.serverUrl.trim() === ''
          ? undefined
          : createVaultKeyMigrationRemote({
            baseUrl: config.serverUrl,
            getToken: async () => config.token,
            ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
          });
        const journalScope = `${session.scope.accountId}\u0000${session.scope.serverOrigin}`;
        if (remote !== undefined) await cancelVaultPayloadMigrationForScope(remote, vaultMigrationJournal, journalScope);
        await session.cancelPendingRootRotation();
      });
    },

    async dispatch(intent: OpIntent): Promise<void> {
      await requireLibraryOwner();
      await engine.dispatch(intent);
    },

    async dispatchChecked<T>(build: CheckedDispatchBuilder<T>): Promise<T> {
      await requireLibraryOwner();
      return engine.dispatchChecked(build);
    },

    getState: () => engine.getState(),

    async sync(): Promise<SyncStatus> {
      return withVaultExclusive(async () => {
        // 归属不符 ⇒ 一个请求都不发（连"未配置"都不算：这是明确的拒绝）。
        //
        // 🔴 **必须在这里翻成分档，不能让它抛出去**（2026-11-08）：
        // 抛出去之后壳的 `catch` 会把它归成 `'unexpected'`（`retryable: true`），
        // 于是「本机库不属于这个账号」在界面上与「网络抖了」同形，
        // 而且重试调度器会永远退避重试一个永远不会成功的请求。
        // 判据：`packages/app-host/tests/library-owner-sync-reason.spec.ts`。
        try {
          await requireLibraryOwner();
        } catch (error: unknown) {
          if (error instanceof LocalLibraryOwnedByAnotherAccountError) {
            return {
              kind: 'error',
              reason: 'library-owner-mismatch',
              retryable: false,
            };
          }
          throw error;
        }
        const client = buildSyncClient(await refreshPayloadMode());
        if (client === undefined) return notConfigured();
        return client.sync();
      });
    },

    async resolveConflict(
      conflict: ConflictInfo,
      choice: 'keep-local' | 'keep-remote',
    ): Promise<SyncStatus> {
      return withVaultExclusive(async () => {
        await requireLibraryOwner();
        const client = buildSyncClient(await refreshPayloadMode());
        if (client === undefined) return notConfigured();
        return client.resolveConflict(conflict, choice);
      });
    },

    /**
     * 界面上那个「待上传 N 项」徽标。
     *
     * 🔴 走计数，不走 `getPendingUpload().length` —— 后者每次刷新都把整条队列
     * 连密文正文一起物化进内存，只为了显示一个数字。这个数还在同步前后各读一次。
     */
    async pendingUploadCount(): Promise<number> {
      return engine.countPendingUpload();
    },

    async dataStatus(): Promise<HostDataStatus> {
      const [pendingUpload, rejectedUpload, lastSyncedAt, owner] = await Promise.all([
        engine.countPendingUpload(),
        // 服务端永久拒绝的那一档：它已被移出 pending 队列，所以**必须单独读**。
        // 只报 pending 会让"一次上传被永久拒绝"看起来像"待上传数少了"，
        // 而实际上一条都没上去（A 包验收记录 §三 第 4 条）。
        store.countRejectedUpload(),
        store.getMetaValue(META_KEYS.LAST_SYNCED_AT),
        readLibraryOwner(store),
      ]);
      return {
        pendingUpload,
        rejectedUpload,
        ...(typeof lastSyncedAt === 'number' ? { lastSyncedAt } : {}),
        ...(owner !== undefined ? { owner } : {}),
      };
    },

    undo(): Promise<UndoOutcome> {
      return engine.undo();
    },

    redo(): Promise<UndoOutcome> {
      return engine.redo();
    },

    historyState(): HistoryState {
      return engine.historyState();
    },

    async libraryOwner(): Promise<LibraryOwner | undefined> {
      return readLibraryOwner(store);
    },

    async claimLibrary(): Promise<ClaimLibraryResult | 'anonymous'> {
      const identity = currentAccountIdentity();
      if (identity === undefined) return 'anonymous';
      const result = await claimLibraryOwner(store, identity);
      // 认领成功就把缓存点亮，省掉下一次写入前的那次读。
      if (result !== 'mismatch') {
        ownerGuardKey = `${identity.accountId}\u0000${identity.serverOrigin}`;
        ownerGuardOwner = await readLibraryOwner(store);
      }
      return result;
    },

    async libraryPurgePlan(): Promise<LibraryPurgePlan> {
      return planLibraryPurge(store);
    },

    async purgeLibrary(): Promise<LibraryPurgeResult> {
      const result = await purgeLocalLibrary();
      // 库已经不在（或正在被销毁）⇒ 归属缓存必须作废：留着它会让下一次写入
      // 以为"还是那个账号的库"，而那个库已经不存在了。
      if (result.status === 'purged') {
        ownerGuardKey = undefined;
        ownerGuardOwner = undefined;
      }
      return result;
    },

    async registerInboundWorker(input): Promise<AutomationWorkerCredential> {
      const config = readSyncConfig();
      if (config.serverUrl.trim() === '' || config.token === undefined || config.token === '') {
        throw new Error('Inbound automation credentials are unavailable');
      }
      return registerAutomationWorker({
        baseUrl: config.serverUrl,
        token: config.token,
        userId: input.userId,
        clientId,
        databaseEpoch: input.databaseEpoch,
        secrets: inboundWorkerSecrets,
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      });
    },

    async saveInboundRecipientKey(key, privateKey): Promise<void> {
      const session = await readVaultSession();
      if (session?.state !== 'unlocked') throw new Error('Vault is locked');
      const root = session.copyUnlockedRootKey();
      try {
        const scope = { ...key, accountId: inboundAccountId(key.accountId) };
        if (scope.accountId !== inboundAccountId(session.scope.accountId) || scope.serverOrigin !== session.scope.serverOrigin) throw new Error('Inbound key scope mismatch');
        await inboundRecipientKeys.save(scope, privateKey, root);
      }
      finally { root.fill(0); }
    },

    async loadInboundRecipientKey(key): Promise<Uint8Array | undefined> {
      const session = await readVaultSession();
      if (session?.state !== 'unlocked') return undefined;
      const root = session.copyUnlockedRootKey();
      try {
        const scope = { ...key, accountId: inboundAccountId(key.accountId) };
        if (scope.accountId !== inboundAccountId(session.scope.accountId) || scope.serverOrigin !== session.scope.serverOrigin) throw new Error('Inbound key scope mismatch');
        return await inboundRecipientKeys.load(scope, root);
      }
      finally { root.fill(0); }
    },

    async getInboundRecipientRegistration(): Promise<InboundRecipientRegistration | undefined> {
      const config = readSyncConfig();
      if (config.serverUrl.trim() === '' || config.token === undefined || config.token === '') {
        throw new Error('Inbound automation credentials are unavailable');
      }
      return createInboundRecipientRemote({
        baseUrl: config.serverUrl, getToken: async () => config.token,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      }).get();
    },

    async ensureInboundRecipientKey(): Promise<InboundRecipientRegistration> {
      return withVaultExclusive(async () => {
        const config = readSyncConfig();
        if (!config.accountId?.trim() || !config.serverUrl.trim() || !config.token) throw new Error('Inbound automation credentials are unavailable');
        const session = await readVaultSession();
        if (session?.state !== 'unlocked') throw new Error('Vault is locked');
        const epoch = vaultEpoch;
        const assertCurrent = (): void => {
          const live = readSyncConfig();
          if (epoch !== vaultEpoch || session.state !== 'unlocked' || live.accountId !== config.accountId || live.serverUrl !== config.serverUrl || live.token !== config.token) {
            throw new Error('Inbound recipient session changed');
          }
        };
        assertCurrent();
        const remote = createInboundRecipientRemote({
          baseUrl: config.serverUrl,
          getToken: async () => { assertCurrent(); return config.token; },
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        });
        const existing = await remote.get();
        assertCurrent();
        const scope = { accountId: inboundAccountId(config.accountId), serverOrigin: session.scope.serverOrigin, keyEpoch: existing?.keyEpoch ?? 1 };
        const root = session.copyUnlockedRootKey();
        let privateKey: Uint8Array | undefined;
        try {
          privateKey = await inboundRecipientKeys.load(scope, root);
          assertCurrent();
          if (existing !== undefined) {
            if (privateKey === undefined || inboundPublicKey(privateKey).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== existing.publicKey) {
              throw new Error('Inbound recipient key recovery is required');
            }
            return existing;
          }
          // Reuse a durable candidate after a lost PUT response. Never delete
          // its private key merely because the network outcome is unknown.
          if (privateKey === undefined) {
            privateKey = generateInboundKeyPair().privateKey;
            await inboundRecipientKeys.save(scope, privateKey, root);
            assertCurrent();
          }
          const candidate = { keyEpoch: 1, packageVersion: 1,
            publicKey: inboundPublicKey(privateKey).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
          try {
            const published = await remote.put(candidate, null);
            assertCurrent();
            return published;
          } catch (error) {
            if (!(error instanceof InboundRecipientRemoteError) || error.code !== 'conflict') throw error;
            const winner = await remote.get();
            assertCurrent();
            if (winner?.publicKey === candidate.publicKey && winner.keyEpoch === candidate.keyEpoch) return winner;
            throw new Error('Inbound recipient key recovery is required');
          }
        } finally { privateKey?.fill(0); root.fill(0); }
      });
    },

    async rotateInboundRecipientKey(): Promise<InboundRecipientRegistration> {
      return withVaultExclusive(async () => {
        const config = readSyncConfig();
        if (!config.accountId?.trim() || !config.serverUrl.trim() || !config.token) throw new Error('Inbound automation credentials are unavailable');
        const session = await readVaultSession();
        if (session?.state !== 'unlocked') throw new Error('Vault is locked');
        const epoch = vaultEpoch;
        const assertCurrent = (): void => {
          const live = readSyncConfig();
          if (epoch !== vaultEpoch || session.state !== 'unlocked' || live.accountId !== config.accountId || live.serverUrl !== config.serverUrl || live.token !== config.token) {
            throw new Error('Inbound recipient session changed');
          }
        };
        assertCurrent();
        const remote = createInboundRecipientRemote({
          baseUrl: config.serverUrl,
          getToken: async () => { assertCurrent(); return config.token; },
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        });
        const existing = await remote.get();
        assertCurrent();
        if (existing === undefined) throw new Error('Inbound recipient key is not registered');
        const serverOrigin = session.scope.serverOrigin;
        const accountId = inboundAccountId(config.accountId);
        const root = session.copyUnlockedRootKey();
        let currentPrivate: Uint8Array | undefined;
        let candidatePrivate: Uint8Array | undefined;
        try {
          currentPrivate = await inboundRecipientKeys.load({ accountId, serverOrigin, keyEpoch: existing.keyEpoch }, root);
          if (currentPrivate === undefined || inboundPublicKey(currentPrivate).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== existing.publicKey) {
            throw new Error('Inbound recipient key recovery is required');
          }
          const candidateScope = { accountId, serverOrigin, keyEpoch: existing.keyEpoch + 1 };
          candidatePrivate = await inboundRecipientKeys.load(candidateScope, root);
          if (candidatePrivate === undefined) {
            candidatePrivate = generateInboundKeyPair().privateKey;
            await inboundRecipientKeys.save(candidateScope, candidatePrivate, root);
          }
          assertCurrent();
          const candidate = {
            keyEpoch: candidateScope.keyEpoch,
            packageVersion: existing.packageVersion + 1,
            publicKey: inboundPublicKey(candidatePrivate).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
          };
          try {
            const published = await remote.put(candidate, existing.packageVersion);
            assertCurrent();
            return published;
          } catch (error) {
            if (!(error instanceof InboundRecipientRemoteError) || error.code !== 'conflict') throw error;
            const winner = await remote.get();
            assertCurrent();
            if (winner?.keyEpoch === candidate.keyEpoch && winner.packageVersion === candidate.packageVersion && winner.publicKey === candidate.publicKey) return winner;
            // A different device won. Keep the current epoch for queued work,
            // but remove only this unpublishable candidate.
            await inboundRecipientKeys.remove(candidateScope);
            throw new Error('Inbound recipient key rotation lost a concurrent update');
          }
        } finally {
          currentPrivate?.fill(0);
          candidatePrivate?.fill(0);
          root.fill(0);
        }
      });
    },

    async processInboundAutomation(inbound): Promise<Awaited<ReturnType<typeof processInboundAutomationEvent>>> {
      const config = readSyncConfig();
      if (config.serverUrl.trim() === '' || config.token === undefined || config.token === '') {
        throw new Error('Inbound automation credentials are unavailable');
      }
      const session = await readVaultSession();
      const epoch = vaultEpoch;
      const assertActive = (): void => {
        const live = readSyncConfig();
        if (live.accountId !== inbound.userId || live.accountId !== config.accountId ||
            live.serverUrl !== config.serverUrl || live.token !== config.token ||
            session?.state !== 'unlocked' || vaultSession !== session || vaultEpoch !== epoch) {
          throw new Error('Inbound processing session is no longer active');
        }
      };
      assertActive();
      const worker = await inboundWorkerSecrets.load({
        userId: inbound.userId,
        clientId,
        serverOrigin: new URL(config.serverUrl).origin,
      });
      if (worker === undefined) throw new Error('Inbound worker is not registered or Vault is locked');
      let privateKey = inbound.privateKey;
      let privateKeyOwned = false;
      if (privateKey === undefined) {
        const session = await readVaultSession();
        if (session?.state !== 'unlocked') throw new Error('Vault is locked');
        const root = session.copyUnlockedRootKey();
        try {
          privateKey = await inboundRecipientKeys.load({
            accountId: inboundAccountId(inbound.userId),
            serverOrigin: new URL(config.serverUrl).origin,
            keyEpoch: inbound.keyEpoch,
          }, root);
        } finally { root.fill(0); }
        privateKeyOwned = true;
      }
      if (privateKey === undefined) throw new Error('Inbound recipient key is unavailable');
      try {
        const taskBatch = { dispatchValidated: engine.dispatchValidated.bind(engine) };
        const loadPrivateKey = async (keyEpoch: number): Promise<Uint8Array | undefined> => {
          const session = await readVaultSession();
          if (session?.state !== 'unlocked') return undefined;
          const root = session.copyUnlockedRootKey();
          try {
            return await inboundRecipientKeys.load({
              accountId: inboundAccountId(inbound.userId),
              serverOrigin: new URL(config.serverUrl).origin,
              keyEpoch,
            }, root);
          } finally { root.fill(0); }
        };
        return await processInboundAutomationEvent({
          assertActive,
          baseUrl: config.serverUrl,
          token: config.token,
          worker,
          journal: inboundCommitJournal,
          privateKey,
          accountId: inboundAccountId(inbound.userId),
          keyEpoch: inbound.keyEpoch,
          allowedFields: inbound.allowedFields,
          ...(inbound.targetProjectId === undefined ? {} : { targetProjectId: inbound.targetProjectId }),
          ...(inbound.maxItems === undefined ? {} : { maxItems: inbound.maxItems }),
          routing: inbound.routing,
          secretStore: inbound.secretStore,
          consents: inbound.consents,
          systemPrompt: inbound.systemPrompt,
          parseVersion: inbound.parseVersion,
          ...(inbound.timezone === undefined ? {} : { timezone: inbound.timezone }),
          ...(inbound.eventId === undefined ? {} : { eventId: inbound.eventId }),
          taskBatch,
          loadPrivateKey,
          ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
        });
      } finally {
        if (privateKeyOwned) privateKey.fill(0);
      }
    },

    async readOpLog(): Promise<Operation<string>[]> {
      // `getAllOps()` 已按 seq 升序，并且是"读全库"的正式入口。
      const rows = await store.getAllOps();
      return rows.map((row) => row.op);
    },

    close(): void {
      vaultEpoch += 1;
      vaultSession?.lock();
      adapter.close();
    },
  };
}

/** 当前物化状态（诊断用）。 */
export function materializedState(host: AppHost): MaterializedState {
  return host.engine.getState();
}
