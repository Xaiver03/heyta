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
} from '../../lib/oplog.js';
import { META_KEYS, STORES, IndexedDbAdapter } from '@heyta/storage';
import type { EntityType } from '@heyta/shared-schema';
import type { Operation, OpType } from '@heyta/sync-core';

import {
  SyncClient,
  createRetryScheduler,
  type ConflictInfo,
  type SyncStatus,
} from '@heyta/sync-client';

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
/** 游标存在 meta store，跨刷新保留 —— 断点续传的前提。 */
const LAST_SERVER_SEQ_KEY = 'lastServerSeq';

async function withMeta<T>(
  fn: (db: IndexedDbAdapter) => Promise<T>,
): Promise<T> {
  // 复用 op-log 已经打开的库名，避免开第二个数据库
  const db = new IndexedDbAdapter('heyta');
  await db.init();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

async function readCursor(): Promise<number> {
  const rec = await withMeta((db) =>
    db.get<{ key: string; value: number }>(STORES.META, LAST_SERVER_SEQ_KEY),
  );
  return rec?.value ?? 0;
}

async function writeCursor(seq: number): Promise<void> {
  await withMeta((db) =>
    db.put(STORES.META, { key: LAST_SERVER_SEQ_KEY, value: seq }),
  );
}

/**
 * 构造一个同步客户端。
 *
 * ⚠️ **每次重建，不缓存。** 缓存的话 configure() 改了地址/令牌后旧客户端
 * 还在用旧值 —— 而"令牌过期后同步一直失败"是最难排查的一类问题。
 *
 * 抽成工厂是因为"手动解决冲突"也需要一个客户端，
 * 而它不能自己再写一遍全部接线 —— 两套接线一定会漂移。
 */
function buildClient(
  get: () => SyncStoreState,
  set: (partial: Partial<SyncStoreState>) => void,
): SyncClient | undefined {
  const { baseUrl, token } = get();
  if (baseUrl === '' || token === undefined) return undefined;

  const engine = requireEngine();

  return new SyncClient({
    baseUrl,
    clientId: engine.getClientId(),
    getToken: async () => get().token,
    getPassword: async () => get().password,
    getLastServerSeq: readCursor,
    setLastServerSeq: writeCursor,
    // 待上传队列直接来自存储的上传状态索引，不是内存列表 ——
    // 内存列表崩溃后就丢了，而"哪些还没上传"正是崩溃后最需要的信息
    getLocalOps: () => engine.getPendingUpload(),
    markUploaded: (seqs) => engine.markUploaded(seqs),
    applyRemote: applyRemoteOps,
    // 冲突判定为本地胜出 → 重新派发（新 op，时钟已压过远端）
    redispatch: async (op) => {
      await engine.redispatch(op);
    },
    discardLocal: (ids) => engine.discardPendingUpload(ids),
    getOpsForEntity: (entityType, entityId) =>
      engine.getOpsForEntity(entityType as EntityType, entityId),
    getOpById: (opId) => engine.getOpById(opId),
    redispatchPayload: async (intent) => {
      // 用户选择"保留远端"：把远端载荷表达成本地的一条新 op。
      // 直接改状态是不行的 —— 那正是 D4 禁止的绕开 op-log 的写入。
      await engine.dispatch({
        entityType: intent.entityType as EntityType,
        entityId: intent.entityId,
        opType: intent.opType as OpType,
        payload: intent.payload,
      });
    },
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
