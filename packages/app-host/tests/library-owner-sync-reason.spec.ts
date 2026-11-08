/**
 * 归属不符必须**分档**返回，不许落进 `'unexpected'`
 * =================================================
 *
 * 缺陷现量（2026-11-08）：`requireLibraryOwner()` 在归属不符时 **`throw`**，
 * 而壳只把 `host.sync()` 包在 `try` 里 ⇒ 抛出来的错误变成
 * `{reason:'unexpected', retryable:true}`。两个后果：
 *
 *   1. 「本机库属于别的账号」与「网络抖了」在界面上**长得一样**，
 *      而处置完全相反（前者要处理这台设备上的库，后者等一会儿再试）；
 *   2. `retryable:true` 让重试调度器**永远退避重试**一个永远不会成功的请求。
 *
 * 这条判据钉两件事：**原因对**、**不可重试**。
 * 反向臂：把 `retryable` 改成 `true` ⇒ 红；把 `reason` 改回 `'unexpected'` ⇒ 红。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpType } from '@heyta/sync-core';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';

import { openAppHost } from '../src/host.js';

const driverFor = (path: string) => () => new NodeSqliteDriver(path);

describe('归属不符：同步返回分档原因，且不可重试', () => {
  let dbPath: string;
  let host: Awaited<ReturnType<typeof openAppHost>> | undefined;

  beforeEach(() => {
    dbPath = join(mkdtempSync(join(tmpdir(), 'heyta-owner-reason-')), 'tasks.db');
  });

  afterEach(() => {
    host?.close();
    host = undefined;
    rmSync(join(dbPath, '..'), { recursive: true, force: true });
  });

  it('库属于 A、B 来同步 ⇒ {library-owner-mismatch, retryable:false}', async () => {
    // A 先认领这个库。
    const first = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      accountId: 'acct-a',
    });
    await first.dispatch({
      entityType: 'TASK', entityId: 't1', opType: OpType.Create, payload: { title: 'A 的任务' },
    });
    first.close();

    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      accountId: 'acct-b',
    });

    const status = await host.sync();
    expect(status).toEqual({
      kind: 'error',
      reason: 'library-owner-mismatch',
      retryable: false,
    });
  });

  it('反向臂：一个请求都不发（归属不符是拒绝，不是"去问问服务端"）', async () => {
    const first = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      accountId: 'acct-a',
    });
    first.close();

    const calls: string[] = [];
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      accountId: 'acct-b',
      fetchImpl: (async (input: string | URL | Request) => {
        calls.push(String(input));
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });

    await host.sync();
    expect(calls, '归属不符时连 payload-mode 都不该问').toEqual([]);
  });
});
