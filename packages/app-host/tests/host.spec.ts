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
import { encodeBase64, setArgon2ParamsForTesting, type Operation } from '@heyta/sync-core';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter, STORES, META_KEYS } from '@heyta/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions } from '../src/actions.js';
import { openAppHost, type AppHost, type SyncConfig } from '../src/host.js';

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
  beforeEach(() => {
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
  });

  it('在首次 vault sync 前从注入的安全存储恢复 root，不依赖设置界面', async () => {
    const first = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      accountId: 'account-1',
    });
    const firstSession = await first.getVaultSession();
    expect(firstSession).toBeDefined();
    const pending = await firstSession!.beginCreation('passphrase');
    await firstSession!.confirmAndPublish(pending, pending.recoveryCode);
    const root = firstSession!.copyUnlockedRootKey();
    firstSession!.lock();
    first.close();
    host = undefined;

    const remembered = encodeBase64(root);
    root.fill(0);
    let loads = 0;
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      token: 'token',
      accountId: 'account-1',
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
      vaultRootKeyStore: {
        load: async (scope) => {
          loads += 1;
          expect(scope).toEqual({ accountId: 'account-1', serverOrigin: 'https://sync.example.test' });
          return remembered;
        },
      },
    });

    const restored = await host.getVaultSession();
    expect(loads).toBe(1);
    expect(restored?.state).toBe('unlocked');
  });

  it('remembered-unlock fence 为真时不读取安全存储，且保持 locked', async () => {
    const first = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      accountId: 'account-1',
    });
    const firstSession = await first.getVaultSession();
    const pending = await firstSession!.beginCreation('passphrase');
    await firstSession!.confirmAndPublish(pending, pending.recoveryCode);
    const root = firstSession!.copyUnlockedRootKey();
    first.close();
    host = undefined;

    let loads = 0;
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      accountId: 'account-1',
      vaultRootKeyStore: {
        isAutoUnlockDisabled: async () => true,
        load: async () => {
          loads += 1;
          return encodeBase64(root);
        },
      },
    });
    const restored = await host.getVaultSession();
    expect(restored?.state).toBe('locked');
    expect(loads).toBe(0);
    root.fill(0);
  });

  it('invalidateVaultSession 是同步 fence，后续读取不会自动重新解锁', async () => {
    let loads = 0;
    const first = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      accountId: 'account-1',
    });
    const firstSession = await first.getVaultSession();
    const pending = await firstSession!.beginCreation('passphrase');
    await firstSession!.confirmAndPublish(pending, pending.recoveryCode);
    const root = firstSession!.copyUnlockedRootKey();
    first.close();
    host = undefined;

    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      accountId: 'account-1',
      vaultRootKeyStore: {
        load: async () => {
          loads += 1;
          return encodeBase64(root);
        },
      },
    });
    expect((await host.getVaultSession())?.state).toBe('unlocked');
    expect(loads).toBe(1);
    host.invalidateVaultSession();
    expect((await host.getVaultSession())?.state).toBe('locked');
    expect(loads).toBe(1);
    root.fill(0);
  });

  it('invalidateVaultSession 会丢弃在途的 remembered-root 加载', async () => {
    let release!: (value: string | undefined) => void;
    const loading = new Promise<string | undefined>((resolve) => {
      release = resolve;
    });
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      serverUrl: 'https://sync.example.test',
      accountId: 'account-1',
      vaultRootKeyStore: {
        load: async () => loading,
      },
    });
    const reading = host.getVaultSession();
    host.invalidateVaultSession();
    release(undefined);
    expect(await reading).toBeUndefined();
    expect((await host.getVaultSession())?.state).toBe('locked');
  });

  it('server/token 绑定改变时丢弃旧 session，不继承旧认证上下文', async () => {
    let config: SyncConfig = {
      serverUrl: 'https://sync.example.test',
      accountId: 'account-1',
    };
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      getSyncConfig: () => config,
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });
    const first = await host.getVaultSession();
    config = { ...config, token: 'new-token' };
    const second = await host.getVaultSession();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(second?.state).toBe('locked');
  });

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
    if (status.kind !== 'error') throw new Error('unreachable');
    // 🔴 第 13 轮：钉子从**散文**换成**结构**。
    //
    // 原来断言 `status.message` 里有「口令/加密」这几个字 —— 而那句话是
    // `packages/sync-client` 里的中文文案，现在整句搬到词条表了
    //（`common.sync.error.noPassword`，两个壳共用）。
    // 换结构断言不是"为了过测试而放宽"，而是**更强**：
    // 以前换一种说法（`密码`、`passphrase`）测试照样绿，现在必须是**这个原因**。
    expect(status.reason, '必须是「缺口令」这一种，而不是别的失败').toBe(
      'no-encryption-password',
    );
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

/**
 * 运行时可变凭据（`getSyncConfig`）
 * ==================================
 *
 * 🔴 **这组测试存在的理由是一个真实的功能缺口。**
 *
 * 移动壳把 `serverUrl` 传给了 `openAppHost`，但**从不调用 `sync()`、也从没有
 * token / 口令** —— 因为那些只能由用户在应用启动**之后**输入，而
 * `openAppHost()` 在启动时就跑完并闭包捕获了静态字段。
 * 于是移动端"能建任务、能勾选、能删除"，但一条都同步不出去。
 *
 * 静态字段那条路（上面的用例）永远测不出这个问题：测试可以在
 * `openAppHost` 之前把凭据准备好，而真实用户不能。
 */
describe('运行时可变同步凭据', () => {
  /** 记录每次请求的 URL，并回一个**成功但无数据**的同步响应。 */
  function recordingFetch(): { fetchImpl: typeof fetch; urls: string[] } {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({ ops: [], hasMore: false, latestSeq: 0, results: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    return { fetchImpl, urls };
  }

  it('没给凭据时同步**明确说"未配置"**，不假装成功', async () => {
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      // 活配置存在但还没填 —— 正是应用刚启动、用户还没进「我的」时的状态。
      getSyncConfig: () => undefined,
    });

    const status = await host.sync();

    // 关键不是"失败了"，而是**说清了是哪一种失败**：
    // `synced` 会把"没配置"伪装成"同步成功且没有新数据"，那是最坏的一类静默失败。
    expect(status.kind).toBe('error');
    if (status.kind !== 'error') throw new Error('unreachable');
    expect(status.retryable, '用户没配置不是可重试的错误，重试一万次也一样').toBe(false);
    // 🔴 同上：句子搬到词条表了（`common.sync.error.notConfigured`），
    // 这里钉结构化原因 —— 它同时排除了"报成别的失败"这种更隐蔽的错法。
    expect(status.reason).toBe('not-configured');
  });

  it('只有地址没有令牌时也算未配置（不能只查地址）', async () => {
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      getSyncConfig: () => ({ serverUrl: 'http://127.0.0.1:3210' }),
    });

    const status = await host.sync();
    expect(status.kind).toBe('error');
  });

  it('活配置**覆盖**静态字段（静态那份是坏的，活的那份才会被用）', async () => {
    const { fetchImpl, urls } = recordingFetch();
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      // 静态字段刻意填一个不可达端口：如果活配置没生效，请求会打到它上面。
      serverUrl: 'http://127.0.0.1:9',
      token: 'static-token',
      getSyncConfig: () => ({
        serverUrl: 'http://127.0.0.1:3210',
        token: 'live-token',
        password: 'pw',
      }),
      fetchImpl,
    });

    await host.sync();

    expect(urls.length, '应该真的发出了请求').toBeGreaterThan(0);
    for (const url of urls) {
      expect(url, '用了静态字段说明活配置没生效').toContain('127.0.0.1:3210');
      expect(url).not.toContain('127.0.0.1:9');
    }
  });

  it('🔴 改了配置之后，**下一次同步必须用新值**（客户端不得被缓存）', async () => {
    const { fetchImpl, urls } = recordingFetch();
    // 模拟用户在「我的」里改服务器地址：这是**同一台设备、同一个 host 实例**内发生的。
    let live = { serverUrl: 'http://127.0.0.1:3210', token: 't1', password: 'pw' };

    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      getSyncConfig: () => live,
      fetchImpl,
    });

    await host.sync();
    const firstBatch = [...urls];
    expect(firstBatch.some((u) => u.includes(':3210'))).toBe(true);

    // 用户改地址
    live = { serverUrl: 'http://127.0.0.1:4321', token: 't2', password: 'pw' };
    urls.length = 0;
    await host.sync();

    // 缓存客户端的话，这里还会打 :3210 —— 而现象是"改了设置但同步还是连旧服务器"，
    // 最难排查的一类问题（设置界面看起来完全正常）。
    expect(urls.length, '第二次也必须真的发请求').toBeGreaterThan(0);
    for (const url of urls) {
      expect(url, '缓存了旧客户端 → 还在打旧地址').toContain('127.0.0.1:4321');
    }
  });

  it('未配置时 resolveConflict 也返回"未配置"，而不是抛异常', async () => {
    host = await openAppHost({
      dbPath,
      driverFactory: driverFor(dbPath),
      getSyncConfig: () => undefined,
    });

    const status = await host.resolveConflict(
      {
        entityType: 'TASK',
        entityId: 'x',
        reason: 'concurrent-update',
        local: { payload: {}, clock: {} },
        remote: { payload: {}, clock: {} },
      } as never,
      'keep-local',
    );

    // UI 在这种情况下已经在渲染冲突对话框了 —— 抛异常会把整个界面打白。
    expect(status.kind).toBe('error');
  });
});
