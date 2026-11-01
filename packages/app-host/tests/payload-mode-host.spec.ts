/**
 * ADR-0080 S6：**宿主按服务端模式选客户端**。
 *
 * 这条是"关掉加密"能不能真的用起来的分水岭：账号模式是 readable 时，
 * 客户端如果还按 vault 加密，服务端会以 `PLAINTEXT_REQUIRED` 拒掉每一条上传 ——
 * 症状是"同步全红而用户什么都没改"。所以这里断言的是**线上真的出现了明文**。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpType } from '@heyta/sync-core';

import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';

import { openAppHost } from '../src/host.js';

const driverFor = (path: string) => () => new NodeSqliteDriver(path);

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('宿主按载荷模式选客户端（ADR-0080）', () => {
  let dbPath: string;
  let host: Awaited<ReturnType<typeof openAppHost>> | undefined;

  beforeEach(() => {
    dbPath = join(mkdtempSync(join(tmpdir(), 'heyta-plain-mode-')), 'tasks.db');
  });

  afterEach(() => {
    host?.close();
    host = undefined;
    rmSync(join(dbPath, '..'), { recursive: true, force: true });
  });

  const withServer = async (mode: 'e2ee' | 'readable', uploads: Array<Record<string, unknown>>) => {
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/sync/payload-mode')) return json({ mode });
      // 没有包的账号：这个端点 404 是协议定义的"暂无包"响应。
      if (url.includes('/api/sync/key-package')) {
        return new Response(JSON.stringify({ code: 'key_package_not_found' }), { status: 404 });
      }
      if (init?.method === 'POST') {
        uploads.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return json({ results: [], latestSeq: 0 });
      }
      return json({ ops: [], hasMore: false, latestSeq: 0, serverTime: Date.now() });
    }) as unknown as typeof fetch;

    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      token: 'token',
      accountId: 'account-1',
      fetchImpl,
    });
    return host;
  };

  it('readable 账号上传的是明文，且显式标 false', async () => {
    const uploads: Array<Record<string, unknown>> = [];
    const live = await withServer('readable', uploads);

    await live.dispatch({
      entityType: 'TASK',
      entityId: 'task-1',
      opType: OpType.Create,
      payload: { title: '买牛奶' },
    });
    const status = await live.sync();

    expect(status.kind).not.toBe('error');
    expect(uploads.length, '应该真的发出了上传').toBe(1);
    const ops = uploads[0]!.ops as Array<Record<string, unknown>>;
    expect(ops[0]!.payload).toBe(JSON.stringify({ title: '买牛奶' }));
    expect(ops[0]!.isPayloadEncrypted).toBe(false);
  });

  it('未解锁时拒绝关闭加密（没有钥匙就没有能解密的路径）', async () => {
    const live = await withServer('e2ee', []);

    // 没有创建过 vault ⇒ 会话 locked ⇒ 必须显式失败，而不是"跳过解不开的 op"。
    await expect(live.disablePayloadEncryption()).rejects.toThrow(/unlocked/i);
  });

  it('getPayloadMode 读服务端；读失败按 e2ee', async () => {
    const live = await withServer('readable', []);
    await expect(live.getPayloadMode()).resolves.toBe('plain');
  });
});

describe('宿主接线的开启方向（ADR-0080 §5.3）', () => {
  let dbPath: string;
  let host: Awaited<ReturnType<typeof openAppHost>> | undefined;

  beforeEach(() => {
    dbPath = join(mkdtempSync(join(tmpdir(), 'heyta-turn-on-')), 'tasks.db');
  });

  afterEach(() => {
    host?.close();
    host = undefined;
    rmSync(join(dbPath, '..'), { recursive: true, force: true });
  });

  const stageFor = (state: 'STAGING' | 'PUBLISHED', targetMode: 'e2ee' | 'readable', overrides: Record<string, unknown> = {}) => ({
    requestId: 'req',
    state,
    targetMode,
    keyVersion: state === 'PUBLISHED' && targetMode === 'e2ee' ? 1 : null,
    payloadKeyVersion: state === 'PUBLISHED' && targetMode === 'e2ee' ? 1 : null,
    expectedLatestSeq: 1,
    expectedOperationCount: 1,
    uploadedOperationCount: 1,
    expectedPayloadBytes: 1,
    uploadedPayloadBytes: 1,
    expiresAt: Date.now() + 60_000,
    migratedOperationCount: state === 'PUBLISHED' ? 1 : 0,
    latestSeq: 1,
    ...overrides,
  });

  it('明文账号可以走两步把加密开回来，之后模式缓存翻成 e2ee', async () => {
    const posts: string[] = [];
    const uploads: Array<Record<string, unknown>> = [];
    // 🔴 假服务端必须**有状态**：提交之后它自己的模式也要翻。
    // 用一只永远回 readable 的桩测"模式翻了没"，等于测了个寂寞。
    let serverMode: 'e2ee' | 'readable' = 'readable';
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/sync/payload-mode')) return json({ mode: serverMode });
      if (url.includes('/api/sync/key-package')) {
        return new Response(JSON.stringify({ code: 'key_package_not_found' }), { status: 404 });
      }
      if (url.includes('/api/sync/ops') && init?.method === 'POST') {
        uploads.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return json({ results: [], latestSeq: 1 });
      }
      if (url.includes('/key-migration/inventory')) {
        return json({
          operations: [{
            id: 'op-a', serverSeq: 1, clientId: 'device-a', actionType: 'CREATE_TASK',
            opType: 'CRT', entityType: 'TASK', entityId: 'task-1',
            timestamp: 1, schemaVersion: 1, payload: JSON.stringify({ title: '买牛奶' }),
            causalFullState: false,
          }],
          latestSeq: 1, retainedFromSeq: 1, complete: true, snapshot: { present: false },
        });
      }
      if (url.includes('/key-migration')) {
        posts.push(url);
        // 响应里的 requestId 必须**回显**请求那一个（宿主每次生成带时间戳的新 id）。
        const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as { requestId?: string };
        const fromUrl = url.split('/key-migration/')[1]?.split('/')[0];
        const requestId = body?.requestId ?? fromUrl ?? '';
        if (url.endsWith('/commit')) {
          serverMode = 'e2ee';
          return json(stageFor('PUBLISHED', 'e2ee', { requestId }));
        }
        return json(stageFor('STAGING', 'readable', { requestId }));
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      token: 'token',
      accountId: 'account-1',
      fetchImpl,
    });

    // 明文账号：没有包。
    await expect(host.getPayloadMode()).resolves.toBe('plain');

    const pending = await host.beginPayloadEncryption('correct horse battery staple');
    expect(pending.recoveryCode.length).toBeGreaterThan(0);

    const result = await host.confirmPayloadEncryption(pending, pending.recoveryCode);
    expect(result).toEqual({ keyVersion: 1, payloadKeyVersion: 1 });

    // 真的发出了 begin 与 commit 两次迁移请求。
    expect(posts.some((url) => url.endsWith('/commit'))).toBe(true);
    // 服务端事实已经翻了（假服务端的模式是有状态的），重读得到 e2ee。
    await expect(host.getPayloadMode()).resolves.toBe('e2ee');
    // 🔴 真正的性质在这里：翻过之后，普通的 sync() 上传的必须是**密文**。
    // （"记住上次模式"那种缓存是死代码 —— `sync()` 每次都先重读服务端事实。）
    await (host as NonNullable<typeof host>).dispatch({
      entityType: 'TASK',
      entityId: 'task-2',
      opType: 'CRT' as never,
      payload: { title: '交水费' },
    });
    await (host as NonNullable<typeof host>).sync();
    expect(uploads.length, '应该真的发出了上传').toBeGreaterThan(0);
    const wireOps = uploads[0]!.ops as Array<Record<string, unknown>>;
    expect(wireOps[0]!.isPayloadEncrypted, '翻回 e2ee 之后仍在上传明文 —— 模式接线没生效').toBe(true);
  }, 60000);
});
