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

import { OpLogEngine, type MaterializedState, type OpIntent, type CheckedDispatchBuilder } from '@heyta/op-log';
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
import { createSyncClient } from './sync-wiring.js';
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

/** Configuration for one host-owned inbound automation cycle. */
export interface InboundAutomationHostOptions {
  userId: string;
  keyEpoch: number;
  allowedFields: readonly InboundAutomationField[];
  targetProjectId?: string;
  maxItems?: number;
  routing: AiRoutingConfig;
  secretStore?: SecretStore;
  consents: readonly EgressConsent[];
  systemPrompt: string;
  parseVersion: number;
  timezone?: string;
  eventId?: string;
  /** A private key supplied by the host's secure-store bridge. */
  privateKey?: Uint8Array;
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
  await engine.recover();

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
  const buildSyncClient = (): SyncClient | undefined => {
    const config = readSyncConfig();
    // 口令可以不填（那样同步会在 E2EE 那一步明确失败，且不会降级成明文），
    // 但地址与令牌缺一不可 —— 没有它们连请求都发不出去。
    if (config.serverUrl === '' || config.token === undefined) return undefined;

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
      vaultEpoch += 1;
      // Record the fence synchronously even when the first load is still in
      // flight and has not installed a session yet.
      const config = readSyncConfig();
      let scopeKey = vaultSessionScope;
      if (scopeKey === undefined && config?.accountId !== undefined && config.serverUrl.trim() !== '') {
        try {
          scopeKey = `${config.accountId.trim()}\u0000${new URL(config.serverUrl).origin}`;
        } catch {
          // Invalid configuration is cleared by the caller; no scope can be
          // safely associated with it here.
        }
      }
      if (scopeKey !== undefined) autoUnlockDisabledScope = scopeKey;
      vaultSession?.lock();
      vaultSession = undefined;
      vaultSessionScope = undefined;
      vaultSessionBinding = undefined;
    },

    async beginVaultRootRotation(newPassphrase: string): Promise<PendingVaultCreation | undefined> {
      return (await readVaultSession())?.beginRootRotation(newPassphrase);
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
      await engine.dispatch(intent);
    },

    dispatchChecked<T>(build: CheckedDispatchBuilder<T>): Promise<T> {
      return engine.dispatchChecked(build);
    },

    getState: () => engine.getState(),

    async sync(): Promise<SyncStatus> {
      return withVaultExclusive(async () => {
        const client = buildSyncClient();
        if (client === undefined) return notConfigured();
        return client.sync();
      });
    },

    async resolveConflict(
      conflict: ConflictInfo,
      choice: 'keep-local' | 'keep-remote',
    ): Promise<SyncStatus> {
      return withVaultExclusive(async () => {
        const client = buildSyncClient();
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
