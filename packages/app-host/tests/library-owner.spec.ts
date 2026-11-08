/**
 * 本机库归属（R1 / ADR-0084）
 * ===========================
 *
 * 判据形状：**存储层**看不到另一个账号的数据，而不是"界面不显示"。
 * 这里用真实 SQLite 文件（`NodeSqliteDriver`），因为要证明的正是"磁盘上那份库"。
 *
 * 🔴 故障注入：把 `host.dispatch` 里的 `requireLibraryOwner()` 注掉，
 * 「B 写不进 A 的库」那一条必须红（读数记在 A 包计划 §5）。
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OpType } from '@heyta/sync-core';
import { DbOpLogStore, INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LocalLibraryOwnedByAnotherAccountError,
  LocalLibraryOwnerUnreadableError,
  assertLibraryOwner,
  claimLibraryOwner,
  planLibraryPurge,
  purgeLocalLibrary,
  readLibraryOwner,
} from '../src/library-owner.js';
import { registerLocalEraser } from '../src/local-erasure.js';
import { openAppHost, type AppHost } from '../src/host.js';

const identity = (accountId: string, serverOrigin = 'https://sync.example.test') => ({
  accountId,
  serverOrigin,
});

async function memoryStore(): Promise<{ store: DbOpLogStore; close: () => void }> {
  const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await db.init();
  return { store: new DbOpLogStore(db), close: () => db.close() };
}

describe('归属记录本身', () => {
  it('匿名库第一次认领 = bound；同一身份再来 = same；不刷新 boundAt', async () => {
    const { store, close } = await memoryStore();
    try {
      expect(await readLibraryOwner(store)).toBeUndefined();
      expect(await claimLibraryOwner(store, identity('acct-a'), 1000)).toBe('bound');
      const first = await readLibraryOwner(store);
      expect(first).toEqual({ accountId: 'acct-a', serverOrigin: 'https://sync.example.test', boundAt: 1000 });

      expect(await claimLibraryOwner(store, identity('acct-a'), 9999)).toBe('same');
      // boundAt 是"第一次归谁"的证据，不是心跳：再认领一次不许把它改掉。
      expect((await readLibraryOwner(store))?.boundAt).toBe(1000);
    } finally {
      close();
    }
  });

  it('换账号 = mismatch，且**没有副作用**（记录还是原来那个）', async () => {
    const { store, close } = await memoryStore();
    try {
      await claimLibraryOwner(store, identity('acct-a'), 1000);
      expect(await claimLibraryOwner(store, identity('acct-b'), 2000)).toBe('mismatch');
      expect((await readLibraryOwner(store))?.accountId).toBe('acct-a');
    } finally {
      close();
    }
  });

  it('同 accountId 换服务器 = mismatch（另一台服务器上的同 id 是另一个账号）', async () => {
    const { store, close } = await memoryStore();
    try {
      await claimLibraryOwner(store, identity('acct-a', 'https://one.example.test'), 1000);
      expect(await claimLibraryOwner(store, identity('acct-a', 'https://two.example.test'), 2000)).toBe('mismatch');
    } finally {
      close();
    }
  });

  it('归属记录损坏 ⇒ fail closed（不把它当匿名库悄悄认领给别人）', async () => {
    const { store, close } = await memoryStore();
    try {
      await store.setMetaValue('localLibraryOwnerV1', '{not-json');
      await expect(readLibraryOwner(store)).rejects.toBeInstanceOf(LocalLibraryOwnerUnreadableError);
      await expect(claimLibraryOwner(store, identity('acct-b'))).rejects.toBeInstanceOf(LocalLibraryOwnerUnreadableError);
    } finally {
      close();
    }
  });

  it('assertLibraryOwner 在 mismatch 时抛出的错误里带**当前 owner**（界面要说清属于谁）', async () => {
    const { store, close } = await memoryStore();
    try {
      await claimLibraryOwner(store, identity('acct-a'), 1000);
      const error = await assertLibraryOwner(store, identity('acct-b')).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LocalLibraryOwnedByAnotherAccountError);
      const typed = error as LocalLibraryOwnedByAnotherAccountError;
      expect(typed.owner.accountId).toBe('acct-a');
      expect(typed.attempted.accountId).toBe('acct-b');
      expect(typed.code).toBe('LOCAL_LIBRARY_OWNED_BY_ANOTHER_ACCOUNT');
    } finally {
      close();
    }
  });
});

describe('销毁前的事实清单', () => {
  it('空库 = nothing-to-erase；有未上传 = requiresConfirmation；传完 = 不需要确认', async () => {
    const { store, close } = await memoryStore();
    try {
      expect(await planLibraryPurge(store)).toEqual({ status: 'nothing-to-erase' });

      const engineOps = [{ id: 'op-1', uploadStatus: 'pending' as const }];
      void engineOps;
      await store.appendLocal([{
        id: 'op-1',
        actionType: 'CRT_TASK',
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: 't1',
        payload: { title: 'A' },
        clientId: 'device-a',
        vectorClock: { 'device-a': 1 },
        timestamp: 1000,
        schemaVersion: 1,
      } as never]);

      const pending = await planLibraryPurge(store);
      expect(pending).toMatchObject({ status: 'ready', pendingUpload: 1, totalOps: 1, requiresConfirmation: true });

      await store.markUploaded(new Map([['op-1', 7]]));
      expect(await planLibraryPurge(store)).toMatchObject({ status: 'ready', pendingUpload: 0, requiresConfirmation: false });
    } finally {
      close();
    }
  });

  it('没有注册销毁器 = no-eraser（**不是**"清过了"）', async () => {
    registerLocalEraser(undefined);
    try {
      expect(await purgeLocalLibrary()).toEqual({ status: 'no-eraser' });
    } finally {
      registerLocalEraser(undefined);
    }
  });
});

describe('宿主：归属闸门 + 登出销毁（存储层判据）', () => {
  let dir: string;
  let dbPath: string;
  let host: AppHost | undefined;

  const open = (accountId?: string) => openAppHost({
    dbPath,
    driverFactory: () => new NodeSqliteDriver(dbPath),
    serverUrl: 'https://sync.example.test',
    ...(accountId !== undefined ? { accountId } : {}),
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'heyta-library-owner-'));
    dbPath = join(dir, 'heyta.db');
    // 每个用例都要自己的兜底销毁器（它是全局注册表，会跨用例残留）。
    registerLocalEraser(undefined);
  });

  afterEach(() => {
    try { host?.close(); } catch { /* 销毁过的宿主 close 可能拒绝 */ }
    host = undefined;
    registerLocalEraser(undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it('🔴 A 写 3 条 → 销毁 → 库为空（不是"界面不显示"）；B 认领匿名库', async () => {
    host = await open('acct-a');
    for (const id of ['t1', 't2', 't3']) {
      await host.dispatch({ entityType: 'TASK', entityId: id, opType: OpType.Create, payload: { title: id } });
    }
    expect(Object.keys(host.getState().tasks)).toHaveLength(3);
    expect((await host.libraryOwner())?.accountId).toBe('acct-a');

    expect(await host.libraryPurgePlan()).toMatchObject({ status: 'ready', pendingUpload: 3, requiresConfirmation: true });
    expect((await host.purgeLibrary()).status).toBe('purged');
    expect(existsSync(dbPath)).toBe(false);
    host = undefined;

    // 重开 = 一份全新空库；B 可以认领。
    host = await open('acct-b');
    expect(await host.pendingUploadCount()).toBe(0);
    expect(host.getState().tasks).toEqual({});
    expect(await host.claimLibrary()).toBe('bound');
    expect((await host.libraryOwner())?.accountId).toBe('acct-b');
  });

  it('库属于 A 时，B 的写入与同步都拒绝（且错误可判别）', async () => {
    host = await open('acct-a');
    await host.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: 'A 的任务' } });
    host.close();
    host = undefined;

    const other = await openAppHost({
      dbPath,
      driverFactory: () => new NodeSqliteDriver(dbPath),
      serverUrl: 'https://sync.example.test',
      accountId: 'acct-b',
    });
    try {
      const writeError = await other.dispatch({
        entityType: 'TASK', entityId: 'b1', opType: OpType.Create, payload: { title: 'B 的任务' },
      }).catch((e: unknown) => e);
      expect(writeError).toBeInstanceOf(LocalLibraryOwnedByAnotherAccountError);

      /**
       * 🔴 **同步不再"抛"，而是"分档返回"**（2026-11-08 改）。
       *
       * 原来这里断言 `sync()` 抛 `LocalLibraryOwnedByAnotherAccountError`。
       * 那个形状本身是对的（拒绝就是拒绝），但**下游把它归成了 `'unexpected'`**：
       * 壳只把 `host.sync()` 包在 `try` 里，抛出来的错误一律变成
       * `{reason:'unexpected', retryable:true}`。两个后果都实测过：
       *   1. 「本机库属于别的账号」与「网络抖了」在界面上**长得一样**；
       *   2. `retryable:true` 让重试调度器永远退避重试一个永远不会成功的请求。
       *
       * ⇒ 现在由**宿主**把它翻成 `'library-owner-mismatch'`（`retryable:false`），
       * 壳只管照着渲染。判据从"抛的是哪个类"收紧成"返回的是哪个原因、能不能重试" ——
       * **比原来更严**：原来只证明"拒绝了"，现在还钉住"拒绝被正确地分档"。
       *
       * 写入那一条**仍然抛**（`dispatch` 的契约是"拒绝就抛"，上面那行没动）：
       * 同步是一次可重试的操作，写入是一次调用，两者的错误契约本来就不同。
       */
      const syncStatus = await other.sync();
      expect(syncStatus).toEqual({
        kind: 'error',
        reason: 'library-owner-mismatch',
        retryable: false,
      });

      // 判据是"存储层查不到"：这条写入没有发生，A 那个任务还在且没被改。
      expect(Object.keys(other.getState().tasks)).toEqual(['t1']);
      expect(other.getState().tasks['b1']).toBeUndefined();
      expect((await other.libraryOwner())?.accountId).toBe('acct-a');
    } finally {
      other.close();
    }
  });

  it('匿名库（没有 accountId）不写归属、也不拦写入', async () => {
    host = await open();
    await host.dispatch({ entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: '本地' } });
    expect(await host.libraryOwner()).toBeUndefined();
    expect(await host.claimLibrary()).toBe('anonymous');
  });
});
