/**
 * 宿主接线的测试
 * ================
 *
 * 用**真实 SQLite 文件**（不是 `:memory:`）—— 因为这里要证明的核心是
 * 「同一台设备跨进程重启拿到同一个 clientId、且数据还在」，
 * 而内存库重启即消失，证明不了任何东西。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OpLogEngine } from '@heyta/op-log';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import type { Operation } from '@heyta/sync-core';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter, STORES, META_KEYS } from '@heyta/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions } from '../src/actions.js';
import { openAppHost, type AppHost } from '../src/host.js';

let dir: string;
let dbPath: string;
let host: AppHost | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'heyta-app-host-'));
  dbPath = join(dir, 'heyta.db');
});

afterEach(() => {
  host?.close();
  host = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const driverFor = (path: string) => () => new NodeSqliteDriver(path);

describe('openAppHost：真实 SQLite 文件', () => {
  it('建任务 → 关闭 → 重开：任务仍在，且 clientId **不变**', async () => {
    host = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });
    const actions = createTaskActions(host);
    const id = await actions.create('跨重启的任务');
    const firstClientId = host.clientId;
    host.close();

    // 重开：全新的引擎、全新的连接，走完整的 recover() 路径。
    host = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });
    const reopened = createTaskActions(host);
    const tasks = reopened.listTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('跨重启的任务');
    expect(tasks[0]!.id).toBe(id);
    // clientId 是 LWW 决胜依据，跨重启漂移会让冲突裁决失去确定性。
    expect(host.clientId).toBe(firstClientId);
  });

  it('offline 时待上传队列非空，且同步明确失败（不假装成功）', async () => {
    host = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });
    const actions = createTaskActions(host);
    await actions.create('未上传');

    expect(await host.pendingUploadCount()).toBe(1);

    const status = await host.sync();
    expect(status.kind, '没有服务端时同步不能报成功').not.toBe('idle');
  });

  it('🔴 没有 E2EE 口令时**在网络之前**就停下，且明说不会以明文上传', async () => {
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'http://127.0.0.1:9',
      token: 'test-token',
      // 故意不给 password
    });
    const status = await host.sync();

    // 必须是 error 而不是 offline：这里**不是网络问题**，
    // 是客户端主动拒绝。报成 offline 会让用户以为"等联网就好了"，
    // 而它永远不会自己好。
    expect(status.kind).toBe('error');
    if (status.kind === 'error') {
      expect(status.message, '必须说清是口令缺失、且不会降级成明文').toMatch(
        /口径|口令|加密/,
      );
    }
  });

  it('给了口令但服务端不可达时报 offline（与上面那条是**不同**的失败）', async () => {
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'http://127.0.0.1:9',
      token: 'test-token',
      password: 'test-password',
    });
    const status = await host.sync();
    expect(status.kind, '连不上服务端应报 offline，而不是假装成功').toBe('offline');
  });

  it('clientId 显式传入时被采用（测试需要确定性）', async () => {
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      clientId: 'device-fixed',
    });
    expect(host.clientId).toBe('device-fixed');
  });

  it('同一个库文件两次打开拿到同一个 clientId（persist 在 meta store）', async () => {
    host = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });
    const a = host.clientId;
    host.close();
    host = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });
    expect(host.clientId).toBe(a);
  });

  it('🔴 `globalThis.crypto` 完全不存在时也能开起来（Hermes 的真实形状）', async () => {
    // 真机实测的失败：
    //     打开本地数据库失败
    //     Cannot read property 'randomUUID' of undefined
    //
    // 起因是 `resolveClientId` 直接调了 `globalThis.crypto.randomUUID()`，
    // 而 Hermes 里连 `globalThis.crypto` 都没有 —— 所以是读 undefined 的属性。
    // `ids.ts` 早就有带守卫的 `randomId()`，但 host.ts 抽出来时**自己又写了一份**。
    //
    // 这条用例把 crypto 整个摘掉，正是当时的运行时形状。
    const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      host = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });
      expect(typeof host.clientId).toBe('string');
      expect(host.clientId.length).toBeGreaterThan(0);
    } finally {
      if (real) Object.defineProperty(globalThis, 'crypto', real);
    }
  });

  it('🔴 `crypto` 在但没有 `randomUUID` 时也不抛（更老的 Hermes）', async () => {
    // 与上一条是**不同**的形状：crypto 存在、有 getRandomValues，但没有 randomUUID。
    // 两种情况必须都不炸 —— 守卫要同时挡住。
    const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: (a: Uint8Array) => a.fill(1) },
      configurable: true,
      writable: true,
    });
    try {
      host = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });
      expect(typeof host.clientId).toBe('string');
    } finally {
      if (real) Object.defineProperty(globalThis, 'crypto', real);
    }
  });

  it('游标走 META store 的同一个键（换存储实现上层不用改）', async () => {
    host = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });
    host.close();

    // 直接开一个适配器读 meta，确认键名与 Web 宿主约定一致。
    const adapter = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: driverFor(dbPath),
    });
    await adapter.init();
    const rec = await adapter.get<{ key: string; value: string }>(
      STORES.META,
      META_KEYS.CLIENT_ID,
    );
    adapter.close();

    expect(rec).toBeDefined();
    expect(typeof rec!.value).toBe('string');
  });

  it('openAppHost 不自己做业务逻辑：它返回的引擎里一条 TASK op 都没有', async () => {
    host = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });
    expect(await host.pendingUploadCount()).toBe(0);
    expect(Object.keys(host.engine.getState().tasks)).toHaveLength(0);
  });
});

describe('openAppHost 与手写接线的等价性', () => {
  /**
   * 这条测试盯的是"抽取时行为漂移"：
   * 手写一遍 `SqliteAdapter → DbOpLogStore → OpLogEngine`，
   * 与 `openAppHost` 产出的状态必须一致。
   * 若哪天有人在 openAppHost 里"顺手"加了个默认值/顺序调整，这里会红。
   *
   * 🔴 **必须给两条路径注入相同的时钟与 id 序列。**
   * 否则这个测试本身就是 flaky 的：两条路径各自用真实 `Date.now()` 和随机 UUID，
   * 同一毫秒内创建的任务排序会退到 id，于是"顺序不同"是随机发生的 ——
   * 我第一版就是这么写的，实测 8 次里红 4 次。**随机失败的测试还不如没有。**
   */
  it('同样的 op 序列下，两条路径物化出**逐字节相同**的任务', async () => {
    /** 每条路径各拿一个独立的确定性序列，两个序列内容相同。 */
    const makeSeq = () => {
      let clock = 1_700_000_000_000;
      let seq = 0;
      return {
        now: () => clock,
        newTaskId: () => `task-${String((seq += 1)).padStart(3, '0')}`,
        tick: () => {
          clock += 1000;
        },
      };
    };

    // ── 路径一：openAppHost ──
    const seqA = makeSeq();
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      clientId: 'c1',
      now: seqA.now,
    });
    const viaHost = createTaskActions(host, { now: seqA.now, newTaskId: seqA.newTaskId });
    const a1 = await viaHost.create('任务甲');
    seqA.tick();
    const a2 = await viaHost.create('任务乙');

    // ── 路径二：手写接线 ──
    const manualPath = join(dir, 'manual.db');
    const adapter = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: driverFor(manualPath),
    });
    await adapter.init();
    const seqB = makeSeq();
    const engine = new OpLogEngine({
      store: new DbOpLogStore<Operation<string>>(adapter),
      clientId: 'c1',
      now: seqB.now,
    });
    await engine.recover();
    const viaManual = createTaskActions(engine, { now: seqB.now, newTaskId: seqB.newTaskId });
    const b1 = await viaManual.create('任务甲');
    seqB.tick();
    const b2 = await viaManual.create('任务乙');
    adapter.close();

    // id、顺序、字段逐个对齐 —— 不是"标题集合相同"这种弱断言。
    expect([a1, a2]).toEqual([b1, b2]);
    expect(viaHost.listTasks()).toEqual(viaManual.listTasks());
    expect(viaHost.listTasks().map((t) => t.title)).toEqual(['任务甲', '任务乙']);
  });
});
