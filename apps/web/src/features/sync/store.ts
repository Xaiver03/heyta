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
import type { Operation } from '@heyta/sync-core';

import { SyncClient, createRetryScheduler, type SyncStatus } from './client.js';

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

  configure: (baseUrl: string, token: string, password: string) => void;
  clearCredentials: () => void;
  syncNow: () => Promise<SyncStatus>;
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

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  status: { kind: 'idle' },
  baseUrl: '',

  configure: (baseUrl, token, password) => {
    set({ baseUrl, token, password, status: { kind: 'idle' } });
  },

  clearCredentials: () => {
    retry?.stop();
    retry = undefined;
    set({ token: undefined, password: undefined, status: { kind: 'idle' } });
  },

  syncNow: async () => {
    const { baseUrl, token } = get();

    if (baseUrl === '' || token === undefined) {
      const s: SyncStatus = { kind: 'error', message: '未配置同步服务', retryable: false };
      set({ status: s });
      return s;
    }

    const engine = requireEngine();

    // ⚠️ 客户端每次重建，不缓存。
    // 缓存的话 configure() 改了地址/令牌后旧客户端还在用旧值 ——
    // 而"令牌过期后同步一直失败"是最难排查的一类问题。
    const c = new SyncClient({
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
    });

    const status = await c.sync((s) => {
      set({ status: s });
    });

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
    case 'error':
      return 'color.danger';
    case 'idle':
      return 'color.foreground-muted';
  }
}
