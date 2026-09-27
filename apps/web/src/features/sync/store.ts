/**
 * 同步状态 store
 * =================
 *
 * 界面必须能看出四种状态（计划 3.3 的判据）：
 * 已同步 / 同步中 / 冲突 / 离线。
 *
 * 🔴 **E2EE 口令绝不明文长期存储。**
 * localStorage 会被任何同源脚本读到，而口令能解开用户全部数据。
 * 这里只在内存里持有（可选"记住"时也只放 sessionStorage，
 * 关闭标签页即失效）。这是一个刻意的取舍：便利性让位于安全性。
 */

import { create } from 'zustand';

import {
  applyRemoteOps,
  currentState,
  requireEngine,
  requireStore,
} from '../../lib/oplog.js';

import {
  createRetryScheduler,
  type ConflictInfo,
  type SyncClient,
  type SyncStatus,
} from '@heyta/sync-client';
// 🔴 接线只有一份。见下方 `buildClient` 的说明。
import { createSyncClient } from '@heyta/app-host';

interface SyncStoreState {
  status: SyncStatus;
  /** 服务端地址。空字符串 = 未配置。 */
  baseUrl: string;
  /** 访问令牌。和口令一样只放内存。 */
  token?: string;
  /** E2EE 口令。**只在内存**。 */
  password?: string;
  /** 上次同步时间。 */
  lastSyncedAt?: number;
  /**
   * 冲突对话框是否打开。
   *
   * 🔴 **与 `status` 分开**，因为"有没有冲突"和"正在不正在看冲突"是两件事。
   * 我第一版让关闭对话框把 `status` 改回 `idle`，于是用户一按 Esc，
   * 冲突提示就整个消失了 —— 数据还卡在待上传队列里，
   * 但他再也找不到处理的入口，问题从"没法解决"变成"看不见了"，更糟。
   */
  conflictDialogOpen: boolean;
  /**
   * 同步设置对话框是否打开。
   *
   * 🔴 从 `SyncBar` 的局部 state **提到这里**，是因为现在有两个入口要打开它：
   * 同步条自己的齿轮，以及订阅提示的「改用你自己的服务器」。
   * 让两处各持一份 `open` state 就必然漂移（一处打开、另一处不知道），
   * 而这一条正是 `AGENTS.md §3.5` 反复记过的形状。
   */
  settingsOpen: boolean;

  configure: (baseUrl: string, token: string, password: string) => void;
  /**
   * 认证成功后写回同步配置。
   *
   * 🔴 **只动 `baseUrl` 与 `token`。** 口令是用户在设置里另填的一件事，
   * 这里"顺手"把它清掉的话，症状是"登录明明成功了，同步却说自己没配置" ——
   * 而用户刚在上一屏把口令输进去过。所以它是一条**专门的、窄的**动作，
   * 而不是复用 `configure(baseUrl, token, '')`。
   */
  applyAuthToken: (baseUrl: string, token: string) => void;
  clearCredentials: () => void;
  syncNow: () => Promise<SyncStatus>;
  /** 用户手动解决一处冲突。两个方向都走 op-log（重新派发），不直接改状态。 */
  resolveConflict: (
    conflict: ConflictInfo,
    choice: 'keep-local' | 'keep-remote',
  ) => Promise<SyncStatus>;
  openConflictDialog: () => void;
  closeConflictDialog: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  startAutoRetry: () => void;
  stopAutoRetry: () => void;
}

let retry: { start: () => void; stop: () => void } | undefined;

/**
 * 「没配置同步服务」的**错误码**。
 *
 * 🔴 这是个**数据值**，不是文案。这一条错误是我们自己产生的、而且用户能自己修好，
 * 所以它值得一条专门的词条（告诉用户"去填地址和令牌"），但句子属于壳 ——
 * 见 `SyncBar` 的 `describeSyncStatus`。store 里塞中文句子的话，
 * 英文界面会永远漏出一句中文（这正是本轮要修的缺陷）。
 */
// 🔴 原来这里有一个 `SYNC_NOT_CONFIGURED` 哨兵字符串塞在 `message` 里 ——
// 那是"类型里没有结构化原因"的绕路。`SyncStatus` 现在有 `reason` 了，
// 哨兵整个删掉：`message` 是字符串字段，拿它当码用没有任何类型保护。

/**
 * 游标读写**已删除**。
 *
 * 这里原先自己开第二个 `IndexedDbAdapter('heyta')` 去读 `meta` store ——
 * 既重复了 `OpLogStore` 已经提供的 `getLastServerSeq`/`setLastServerSeq`，
 * 又把「游标存在哪个键」这个知识复制了第二份。
 * 现在游标由 `requireStore()` 提供，键名只在 `packages/storage` 里定义一次。
 */

/**
 * 构造一个同步客户端。
 *
 * 🔴 **接线只有一份**，在 `@heyta/app-host` 的 `createSyncClient`。
 * 这里此前手写了全部 12 个回调 —— 与 `packages/app-host/src/host.ts`
 * 里那份**逐字相同，连注释都是复制的**。两套接线一定会漂移，
 * 而 `ids.ts` 已经记过一次同形状的事故。
 *
 * 现在宿主能决定的只剩真正的平台差异：
 * 地址、令牌、口令，以及「应用远端之后要不要通知 UI」。
 *
 * ⚠️ **每次重建，不缓存。** 缓存的话 configure() 改了地址/令牌后旧客户端
 * 还在用旧值 —— 而"令牌过期后同步一直失败"是最难排查的一类问题。
 */
function buildClient(
  get: () => SyncStoreState,
  _set: (partial: Partial<SyncStoreState>) => void,
): SyncClient | undefined {
  const { baseUrl, token } = get();
  if (baseUrl === '' || token === undefined) return undefined;

  return createSyncClient({
    engine: requireEngine(),
    store: requireStore(),
    baseUrl,
    getToken: async () => get().token,
    getPassword: async () => get().password,
    // 🔴 Web 宿主特有的那一步：应用完远端 op 必须通知订阅者。
    // 不通知的话数据到了、界面不动 —— 而原生宿主没有这层订阅，
    // 所以它是**注入项**而不是接线内部的固定行为。
    applyRemote: applyRemoteOps,
  });
}

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  status: { kind: 'idle' },
  baseUrl: '',
  conflictDialogOpen: false,
  settingsOpen: false,

  openConflictDialog: () => {
    set({ conflictDialogOpen: true });
  },

  closeConflictDialog: () => {
    // 只关窗口，**不动 status** —— 冲突还在，SyncBar 仍会提示，还能再打开
    set({ conflictDialogOpen: false });
  },

  openSettings: () => {
    set({ settingsOpen: true });
  },

  closeSettings: () => {
    set({ settingsOpen: false });
  },

  configure: (baseUrl, token, password) => {
    set({ baseUrl, token, password, status: { kind: 'idle' } });
  },

  applyAuthToken: (baseUrl, token) => {
    // 口令与上次同步时间原样保留 —— 见接口上的说明。
    set({ baseUrl, token, status: { kind: 'idle' } });
  },

  clearCredentials: () => {
    retry?.stop();
    retry = undefined;
    set({ token: undefined, password: undefined, status: { kind: 'idle' } });
  },

  syncNow: async () => {
    const c = buildClient(get, set);
    if (c === undefined) {
      const s: SyncStatus = {
        kind: 'error',
        reason: 'not-configured',
        retryable: false,
      };
      set({ status: s });
      return s;
    }

    const status = await c.sync((s) => {
      set({ status: s });
    });

    // 出现冲突就自动打开一次 —— 否则用户只会看到状态栏变了字，
    // 不知道需要自己去点一下
    if (status.kind === 'conflict') set({ conflictDialogOpen: true });
    if (status.kind === 'synced') set({ lastSyncedAt: status.at });
    return status;
  },

  resolveConflict: async (conflict, choice) => {
    const c = buildClient(get, set);
    if (c === undefined) {
      const s: SyncStatus = {
        kind: 'error',
        reason: 'not-configured',
        retryable: false,
      };
      set({ status: s });
      return s;
    }

    set({ status: { kind: 'syncing', phase: 'upload' } });
    const status = await c.resolveConflict(conflict, choice);

    // 解决完后把剩下的冲突（可能还有别的）一并反映到状态里
    set({ status });
    if (status.kind === 'synced') set({ lastSyncedAt: status.at });
    return status;
  },

  startAutoRetry: () => {
    retry ??= createRetryScheduler(() => get().syncNow());
    retry.start();
  },

  stopAutoRetry: () => {
    retry?.stop();
  },
}));

/** 状态对应的语义色 token 名。 */
export function statusColorToken(status: SyncStatus): string {
  switch (status.kind) {
    case 'synced':
      return 'color.success';
    case 'syncing':
      return 'color.info';
    case 'offline':
      return 'color.warning';
    case 'conflict':
      return 'color.warning';
    case 'error':
      return 'color.danger';
    case 'idle':
      return 'color.foreground-muted';
  }
}
