/**
 * Node 宿主：真实 SQLite 文件上的读写与持久化。
 *
 * 本地存储路径**没有 mock**：每个用例都打开一个临时目录里的真实 `.sqlite` 文件。
 * 远端 Vault HTTP 仅在需要构造失败路径时注入最小 `fetchImpl` fixture；因此它证明不了
 * 真实同步（那需要真实服务端，见 `scripts/verify-p2-node-host.mjs`），但能证明本地这一半：
 * 写入经 op-log 落盘、重启后从**整个日志**重建，以及构造失败会关闭生产 SQLite 驱动。
 */

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openNodeHost, type NodeHost } from '../src/host.js';
import { createVaultKeyPackage, getArgon2Params, setArgon2ParamsForTesting } from '@heyta/sync-core';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';

const tempDirs: string[] = [];
const opened: NodeHost[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-node-host-'));
  tempDirs.push(dir);
  return join(dir, 'heyta.sqlite');
}

afterEach(() => {
  for (const host of opened.splice(0)) host.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Node 宿主：真实 SQLite 文件', () => {
  it('stops worker timers on close and rejects restarting a closed host', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    opened.push(host);
    vi.useFakeTimers();
    try {
      const runnable = vi.fn(() => false);
      const options = { userId: '1', keyEpoch: 1, allowedFields: ['title'] as const,
        routing: { enabled: false, allowRemote: false, endpoints: [], routes: {} },
        consents: [], systemPrompt: '', parseVersion: 1, intervalMs: 10, isRunnable: runnable };
      host.startInboundWorker(options);
      expect(runnable).toHaveBeenCalledTimes(1);
      host.close();
      await vi.advanceTimersByTimeAsync(100);
      expect(runnable).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(() => host.startInboundWorker(options)).toThrow('Host is closed');
    } finally { vi.useRealTimers(); }
  });

  it.each([
    ['远端 Vault refresh 失败', async () => new Response('upstream unavailable', { status: 503 })],
    ['Vault 解锁失败', async () => {
      const created = await createVaultKeyPackage('right passphrase');
      return new Response(JSON.stringify({ package: created.package, payloadKeyVersion: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }],
  ])('%s 时保持本地宿主可打开，并由显式 sync 暴露失败', async (_label, response) => {
    const previousArgon2 = getArgon2Params();
    const closeSpy = vi.spyOn(NodeSqliteDriver.prototype, 'close');
    try {
      setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
      const dbPath = tempDbPath();
      const fetchMock = vi.fn(async () => response());
      const fetchImpl = fetchMock as unknown as typeof fetch;

      const host = await openNodeHost({
        dbPath,
        serverUrl: 'https://sync.example.test',
        token: 'test-token',
        accountId: 'test-account',
        password: 'wrong passphrase',
        fetchImpl,
      });
      // Opening and reading a local SQLite file is a local-first operation;
      // Vault refresh/unlock belongs to the explicit sync boundary.
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await host.addTask('本地任务')).length).toBeGreaterThan(0);
      expect(host.listTasks().map((task) => task.title)).toEqual(['本地任务']);
      expect(await host.pendingUploadCount()).toBe(1);
      expect((await host.exportDocument()).counts.totalOps).toBeGreaterThan(0);
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(host.sync()).rejects.toBeDefined();
      expect(fetchMock).toHaveBeenCalled();
      host.close();

      // The caller owns the host and closes it after the failed explicit
      // operation; reopening is a secondary persistence sanity check.
      expect(closeSpy).toHaveBeenCalledTimes(1);
      const reopened = await openNodeHost({ dbPath });
      opened.push(reopened);
      expect(reopened.listTasks().map((task) => task.title)).toEqual(['本地任务']);
    } finally {
      setArgon2ParamsForTesting(previousArgon2);
      closeSpy.mockRestore();
    }
  });

  it('add → 关闭 → 重开新引擎：任务仍在（从整个日志重建，不是内存缓存）', async () => {
    const dbPath = tempDbPath();

    const first = await openNodeHost({ dbPath });
    opened.push(first);
    const id = await first.addTask('买牛奶');

    expect(first.listTasks().map((task) => task.title)).toEqual(['买牛奶']);
    const firstClientId = first.clientId;
    first.close();

    // 文件真的非空 —— 数据在磁盘上，不在内存里
    expect(statSync(dbPath).size).toBeGreaterThan(0);

    // 「重开」= 新的适配器 + 新的引擎，内存里一无所有
    const second = await openNodeHost({ dbPath });
    opened.push(second);

    const tasks = second.listTasks();
    expect(tasks.map((task) => task.id)).toEqual([id]);
    expect(tasks[0]!.title).toBe('买牛奶');

    // 设备 id 也是持久的：LWW 决胜依据不能每次重开就换一个
    expect(second.clientId).toBe(firstClientId);
  });

  it('改名与完成也是 op，重开后状态一致', async () => {
    const dbPath = tempDbPath();

    const first = await openNodeHost({ dbPath });
    opened.push(first);
    const id = await first.addTask('原始标题');
    await first.renameTask(id, '改过的标题');
    await first.setCompleted(id, true);
    first.close();

    const second = await openNodeHost({ dbPath });
    opened.push(second);
    const task = second.listTasks()[0]!;
    expect(task.title).toBe('改过的标题');
    expect(task.completedAt).toBeTypeOf('number');

    // 「取消完成」用 null 表达显式清除，重开后必须真的被清掉
    await second.setCompleted(id, false);
    second.close();

    const third = await openNodeHost({ dbPath });
    opened.push(third);
    expect(third.listTasks()[0]!.completedAt).toBeUndefined();
  });

  it('未登录/无口令时同步明确失败，不假装成功', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    opened.push(host);
    await host.addTask('离线任务');

    // 没有 token → SyncClient 返回 error（不是 offline，也不是 synced）
    const status = await host.sync();
    expect(status.kind).toBe('error');

    // 离线写入必须仍在待上传队列里，不能因为同步失败丢了
    expect(await host.pendingUploadCount()).toBe(1);
  });

  it('收件私钥与 worker 凭据只在 Vault 解锁时可用，并跨真实 SQLite 重启恢复', async () => {
    const previousArgon2 = getArgon2Params();
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
    try {
      const dbPath = tempDbPath();
      const created = await createVaultKeyPackage('node-passphrase');
      let registeredClientId: string | undefined;
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/sync/key-package') {
          return new Response(JSON.stringify({ package: created.package, payloadKeyVersion: 1 }), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        if (path === '/api/automation/worker/register') {
          return new Response(JSON.stringify({ workerId: '11111111-1111-4111-8111-111111111111',
            workerToken: 'a'.repeat(64), syncClientId: registeredClientId ?? 'missing-client', databaseEpoch: 'epoch-1' }), { status: 201 });
        }
        if (path === '/api/automation/events/claim' && init?.method === 'POST') {
          return new Response(JSON.stringify({ state: 'empty' }), { status: 200 });
        }
        return new Response('offline', { status: 503 });
      }) as unknown as typeof fetch;
      const options = {
        dbPath,
        serverUrl: 'https://sync.example.test',
        token: 'account-token',
        accountId: 'account-1',
        password: 'node-passphrase',
        fetchImpl,
      };
      const first = await openNodeHost(options);
      opened.push(first);
      registeredClientId = first.clientId;
      expect((await first.sync()).kind).toBe('error');
      // A deterministic 32-byte X25519 private key is sufficient here; the
      // app-host key store validates and derives its public key on wrap.
      const pair = { privateKey: new Uint8Array(32).fill(7) };
      const scope = { accountId: 'account-1', serverOrigin: 'https://sync.example.test', keyEpoch: 1 };
      await first.saveInboundRecipientKey(scope, pair.privateKey);
      const loaded = await first.loadInboundRecipientKey(scope);
      expect(Buffer.from(loaded ?? []).equals(Buffer.from(pair.privateKey))).toBe(true);
      const registered = await first.registerInboundWorker({ userId: 'account-1', databaseEpoch: 'epoch-1' });
      expect(registered.workerToken).toHaveLength(64);
      first.close();

      const second = await openNodeHost(options);
      opened.push(second);
      expect((await second.sync()).kind).toBe('error');
      const loadedAfterRestart = await second.loadInboundRecipientKey(scope);
      expect(Buffer.from(loadedAfterRestart ?? []).equals(Buffer.from(pair.privateKey))).toBe(true);
      const processed = await second.processInboundAutomation({
        userId: 'account-1', keyEpoch: 1, allowedFields: ['title'],
        routing: { enabled: false, allowRemote: false, endpoints: [], routes: {} },
        consents: [], systemPrompt: 'test', parseVersion: 1, privateKey: pair.privateKey,
      });
      expect(processed).toEqual({ state: 'empty' });
      pair.privateKey.fill(0);
      loaded?.fill(0);
      loadedAfterRestart?.fill(0);
    } finally {
      setArgon2ParamsForTesting(previousArgon2);
    }
  });

  it('recovers recipient publication after a lost response using the same persisted private key', async () => {
    const params = getArgon2Params();
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
    try {
      const created = await createVaultKeyPackage('recipient-passphrase');
      let remote: { keyEpoch: number; packageVersion: number; publicKey: string } | undefined;
      let publications = 0;
      const fetchImpl: typeof fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/sync/key-package') return new Response(JSON.stringify({ package: created.package, payloadKeyVersion: 1 }));
        if (path === '/api/automation/recipient-key') {
          expect(new Headers(init?.headers).get('authorization')).toBe('Bearer account-token');
          if (init?.method === 'PUT') {
            const body = JSON.parse(String(init.body));
            remote = { keyEpoch: body.keyEpoch, packageVersion: body.packageVersion, publicKey: body.publicKey };
            publications += 1;
            throw new Error('response lost after server commit');
          }
          return new Response(JSON.stringify(remote ?? {}), { status: remote ? 200 : 404 });
        }
        return new Response('', { status: 503 });
      };
      const options = { dbPath: tempDbPath(), serverUrl: 'https://sync.example.test', token: 'account-token', accountId: '7', password: 'recipient-passphrase', fetchImpl };
      const first = await openNodeHost(options); opened.push(first);
      await expect(first.ensureInboundRecipientKey()).rejects.toMatchObject({ code: 'transport' });
      const scope = { accountId: '7', serverOrigin: options.serverUrl, keyEpoch: 1 };
      const candidate = await first.loadInboundRecipientKey(scope);
      expect(candidate).toHaveLength(32);
      first.close();
      const reopened = await openNodeHost(options); opened.push(reopened);
      expect(await reopened.ensureInboundRecipientKey()).toEqual(remote);
      const recovered = await reopened.loadInboundRecipientKey(scope);
      expect(recovered).toEqual(candidate);
      expect(publications).toBe(1);
      const fresh = await openNodeHost({ ...options, dbPath: tempDbPath() }); opened.push(fresh);
      await expect(fresh.ensureInboundRecipientKey()).rejects.toThrow('recovery is required');
      expect(publications).toBe(1);
      candidate?.fill(0); recovered?.fill(0);
    } finally { setArgon2ParamsForTesting(params); }
  });

  it('rotates recipient epochs with CAS and retains the old key for queued events', async () => {
    const params = getArgon2Params();
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
    try {
      const created = await createVaultKeyPackage('rotate-passphrase');
      let remote: { keyEpoch: number; packageVersion: number; publicKey: string } | undefined;
      let putCount = 0;
      const fetchImpl: typeof fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/sync/key-package') return new Response(JSON.stringify({ package: created.package, payloadKeyVersion: 1 }));
        if (path === '/api/automation/recipient-key') {
          expect(new Headers(init?.headers).get('authorization')).toBe('Bearer rotate-token');
          if (init?.method === 'PUT') {
            const body = JSON.parse(String(init.body)) as { keyEpoch: number; packageVersion: number; publicKey: string; expectedPackageVersion: number | null };
            expect(body.expectedPackageVersion).toBe(remote?.packageVersion ?? null);
            putCount += 1;
            remote = { keyEpoch: body.keyEpoch, packageVersion: body.packageVersion, publicKey: body.publicKey };
            return new Response(JSON.stringify(remote));
          }
          return remote === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(remote));
        }
        return new Response('', { status: 503 });
      };
      const options = { dbPath: tempDbPath(), serverUrl: 'https://sync.example.test', token: 'rotate-token', accountId: '9', password: 'rotate-passphrase', fetchImpl };
      const host = await openNodeHost(options); opened.push(host);
      await host.sync();
      expect(await host.ensureInboundRecipientKey()).toEqual(remote);
      const rotated = await host.rotateInboundRecipientKey();
      expect(rotated).toEqual(remote);
      expect(rotated.keyEpoch).toBe(2);
      expect(putCount).toBe(2);
      const old = await host.loadInboundRecipientKey({ accountId: '9', serverOrigin: options.serverUrl, keyEpoch: 1 });
      const next = await host.loadInboundRecipientKey({ accountId: '9', serverOrigin: options.serverUrl, keyEpoch: 2 });
      expect(old).toHaveLength(32);
      expect(next).toHaveLength(32);
      old?.fill(0); next?.fill(0);
    } finally { setArgon2ParamsForTesting(params); }
  });

  it('空标题不建任务（抛错而不是静默忽略）', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    opened.push(host);
    await expect(host.addTask('   ')).rejects.toThrow('任务标题不能为空');
    expect(host.listTasks()).toEqual([]);
  });
});
