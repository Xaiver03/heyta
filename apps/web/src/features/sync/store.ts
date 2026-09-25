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

  configure: (baseUrl: string, token: string, password: string) => void;
  clearCredentials: () => void;
  syncNow: () => Promise<SyncStatus>;
  /** 用户手动解决一处冲突。两个方向都走 op-log（重新派发），不直接改状态。 */
  resolveConflict: (
    conflict: ConflictInfo,
    choice: 'keep-local' | 'keep-remote',
  ) => Promise<SyncStatus>;
  openConflictDialog: () => void;
  closeConflictDialog: () => void;
  startAutoRetry: () => void;
  stopAutoRetry: () => void;
}

let retry: { start: () => void; stop: () => void } | undefined;

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

  openConflictDialog: () => {
    set({ conflictDialogOpen: true });
  },

  closeConflictDialog: () => {
    // 只关窗口，**不动 status** —— 冲突还在，SyncBar 仍会提示，还能再打开
    set({ conflictDialogOpen: false });
  },

  configure: (baseUrl, token, password) => {
    set({ baseUrl, token, password, status: { kind: 'idle' } });
  },

  clearCredentials: () => {
    retry?.stop();
    retry = undefined;
    set({ token: undefined, password: undefined, status: { kind: 'idle' } });
  },

  syncNow: async () => {
    const c = buildClient(get, set);
    if (c === undefined) {
      const s: SyncStatus = { kind: 'error', message: '未配置同步服务', retryable: false };
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
      const s: SyncStatus = { kind: 'error', message: '未配置同步服务', retryable: false };
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

/** 人类可读的状态文案。 */
export function describeStatus(status: SyncStatus): string {
  switch (status.kind) {
    case 'idle':
      return '未同步';
    case 'syncing':
      return status.phase === 'upload' ? '正在上传…' : '正在下载…';
    case 'synced':
      return '已同步';
    case 'offline':
      return '离线 · 改动已排队，联网后自动重试';
    case 'conflict':
      return `${String(status.conflicts.length)} 处改动需要你确认`;
    case 'error':
      return status.retryable ? `同步出错：${status.message}` : status.message;
  }
}

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
