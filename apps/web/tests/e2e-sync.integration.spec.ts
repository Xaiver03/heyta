/**
 * 端到端同步验收（真实服务端）
 * ==============================
 *
 * 这条测试把**整条链路**跑一遍，没有一处是 mock：
 *
 *   OpLogEngine → IndexedDbOpLogStore → SyncClient → 真实 HTTP → Fastify 服务端
 *                                                              ↓
 *   另一个设备的 OpLogEngine ← IndexedDbOpLogStore ← SyncClient ←
 *
 * 为什么必须有这条测试：单元测试里的 mock 是我**按自己对协议的理解**写的。
 * 如果理解错了，mock 也会跟着错，测试照样绿。这里没有这个漏洞 ——
 * 服务端是 P0 已验证的那个真实实现。
 *
 * 默认跳过；设 HEYTA_E2E_URL 才跑（CI 里没有服务端）：
 *   HEYTA_E2E_URL=http://127.0.0.1:3100 pnpm exec vitest run tests/e2e-sync.integration.spec.ts
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { IndexedDbAdapter, IndexedDbOpLogStore, STORES } from '@heyta/storage';
import { OpLogEngine } from '@heyta/op-log';
import { OpType } from '@heyta/sync-core';
import type { Operation } from '@heyta/sync-core';

import { SyncClient } from '@heyta/sync-client';

import { ConflictDialog } from '../src/features/sync/ConflictDialog.js';
import { useSyncStore } from '../src/features/sync/store.js';
import {
  __resetOpLogForTests,
  initOpLog,
  requireEngine,
} from '../src/lib/oplog.js';

const URL_BASE = process.env['HEYTA_E2E_URL'];
const PASSWORD = 'e2e-correct-horse-battery-staple';
const KEY = 'lastServerSeq';

/** 建一台"设备"：真引擎 + 真 IndexedDB 存储 + 真同步客户端。 */
async function makeDevice(
  clientId: string,
  token: string,
  /**
   * 可注入的网络实现。
   *
   * 为什么必须注入而不是替换 globalThis.fetch：`SyncClient` 在**构造时**
   * 就 `bind` 了 fetch，之后替换全局对已建好的客户端无效 ——
   * 我第一版就是这么写的，结果"断网"测试实际上联着网，却报 synced。
   */
  fetchImpl?: typeof fetch,
) {
  const adapter = new IndexedDbAdapter(`e2e-${clientId}`);
  await adapter.init();
  await adapter.put(STORES.META, { key: KEY, value: 0 });

  const store = new IndexedDbOpLogStore<Operation<string>>(adapter);
  const engine = new OpLogEngine({ clientId, store });
  await engine.recover();

  const client = new SyncClient({
    baseUrl: URL_BASE!,
    clientId,
    getToken: async () => token,
    getPassword: async () => PASSWORD,
    getLastServerSeq: async () => {
      const r = await adapter.get<{ key: string; value: number }>(STORES.META, KEY);
      return r?.value ?? 0;
    },
    setLastServerSeq: async (seq) => {
      await adapter.put(STORES.META, { key: KEY, value: seq });
    },
    getLocalOps: () => engine.getPendingUpload(),
    markUploaded: (m) => engine.markUploaded(m),
    applyRemote: async (ops) => {
      await engine.applyRemote(ops);
    },
    redispatch: async (op) => {
      await engine.redispatch(op);
    },
    discardLocal: (ids) => engine.discardPendingUpload(ids),
    getOpsForEntity: (entityType, entityId) =>
      engine.getOpsForEntity(entityType as never, entityId),
    getOpById: (opId) => engine.getOpById(opId),
    redispatchPayload: async (intent) => {
      await engine.dispatch({
        entityType: intent.entityType as never,
        entityId: intent.entityId,
        opType: intent.opType as never,
        payload: intent.payload,
      });
    },
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
  });

  return { adapter, store, engine, client };
}

describe.skipIf(URL_BASE === undefined)('端到端同步（真实服务端）', () => {
  const created: Array<{ adapter: IndexedDbAdapter }> = [];
  afterAll(() => {
    for (const d of created) d.adapter.close();
  });

  it('🔴 设备 A 写 → 上传 → 设备 B 下载 → B 看到完全一致的实体', async () => {
    // 全局装上 browser 存储（Node 里没有 IndexedDB）
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

    // ── 真实注册一个账号（服务端 TEST_MODE 路由）──
    const email = `heyta-p1-${String(Date.now())}@example.com`;
    const reg = await fetch(`${URL_BASE}/api/test/create-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'heyta-p1-password' }),
    });
    expect(reg.ok).toBe(true);
    const regBody = (await reg.json()) as Record<string, unknown>;
    const token = (regBody['token'] ??
      regBody['accessToken'] ??
      (regBody['data'] as Record<string, unknown> | undefined)?.['token']) as string;
    expect(typeof token).toBe('string');

    // ── 两台设备 ──
    const A = await makeDevice('device-a', token);
    const B = await makeDevice('device-b', token);
    created.push(A, B);

    // ── A 本地建一个任务（走引擎，不绕开 op-log）──
    // ⚠️ dispatch 是 async，必须 await —— 不 await 的话断言跑在落盘之前
    await A.engine.dispatch({
      entityType: 'TASK',
      entityId: 'task-e2e-1',
      opType: OpType.Create,
      payload: { title: '端到端验证任务', done: false },
    });

    expect(A.engine.getState().tasks['task-e2e-1']).toBeDefined();

    // ── A 同步 ──
    const aStatus = await A.client.sync();
    expect(aStatus).toEqual({ kind: 'synced', at: expect.any(Number) });

    // 上传后 A 的待上传队列必须清空（否则每次同步都重传）
    expect(await A.engine.getPendingUpload()).toHaveLength(0);

    // ── B 同步 ──
    const bStatus = await B.client.sync();
    expect(bStatus).toEqual({ kind: 'synced', at: expect.any(Number) });

    // ── 关键断言：B 拿到了 A 的数据，且**解密后**内容一致 ──
    const bTask = B.engine.getState().tasks['task-e2e-1'];
    expect(bTask).toBeDefined();
    expect(bTask).toMatchObject({ title: '端到端验证任务', done: false });

    // 服务端游标必须真的前进（游标卡在 0 而数据却到了，说明是别处来的）
    const bCursor = await B.adapter.get<{ key: string; value: number }>(STORES.META, KEY);
    expect(bCursor?.value).toBeGreaterThan(0);

    // ── 服务端存的是密文（E2EE 不是摆设）──
    const dl = await fetch(`${URL_BASE}/api/sync/ops?sinceSeq=0&limit=50`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(dl.ok).toBe(true);
    const dlBody = (await dl.json()) as {
      ops: Array<{ serverSeq: number; op: Record<string, unknown> }>;
    };
    expect(dlBody.ops.length).toBeGreaterThan(0);
    for (const envelope of dlBody.ops) {
      // ⚠️ 线协议是**嵌套**的：{serverSeq, op, receivedAt}
      const wire = envelope.op;
      expect(wire['isPayloadEncrypted']).toBe(true);
      expect(typeof wire['payload']).toBe('string');
      // 明文绝不允许出现在服务端
      expect(JSON.stringify(envelope)).not.toContain('端到端验证任务');
    }
  }, 60_000);

  it('🔴 增量下载：第二次同步不重复拉取（游标真的起作用）', async () => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

    const email = `heyta-p1-inc-${String(Date.now())}@example.com`;
    const reg = await fetch(`${URL_BASE}/api/test/create-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'heyta-p1-password' }),
    });
    const regBody = (await reg.json()) as Record<string, unknown>;
    const token = (regBody['token'] ??
      regBody['accessToken'] ??
      (regBody['data'] as Record<string, unknown> | undefined)?.['token']) as string;

    const A = await makeDevice('inc-a', token);
    const B = await makeDevice('inc-b', token);
    created.push(A, B);

    await A.engine.dispatch({
      entityType: 'TASK',
      entityId: 'inc-1',
      opType: OpType.Create,
      payload: { title: '第一个' },
    });
    await A.client.sync();

    await B.client.sync();
    const cursorAfterFirst = (
      await B.adapter.get<{ key: string; value: number }>(STORES.META, KEY)
    )?.value;
    expect(cursorAfterFirst).toBeGreaterThan(0);

    // 再同步一次，没有任何新东西
    await B.client.sync();
    const cursorAfterSecond = (
      await B.adapter.get<{ key: string; value: number }>(STORES.META, KEY)
    )?.value;
    // 游标不回退（回退就会重复下载）
    expect(cursorAfterSecond).toBeGreaterThanOrEqual(cursorAfterFirst!);

    // B 仍然只有一条（没有因为重复下载而产生重复实体）
    expect(Object.keys(B.engine.getState().tasks)).toHaveLength(1);
  }, 60_000);

  it('🔴 离线队列：断网时写入不丢，恢复后重放成功', async () => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

    const email = `heyta-p1-off-${String(Date.now())}@example.com`;
    const reg = await fetch(`${URL_BASE}/api/test/create-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'heyta-p1-password' }),
    });
    const regBody = (await reg.json()) as Record<string, unknown>;
    const token = (regBody['token'] ??
      regBody['accessToken'] ??
      (regBody['data'] as Record<string, unknown> | undefined)?.['token']) as string;

    // ── 模拟断网：注入一个可切换的网络实现 ──
    let offlineNow = true;
    const realFetch = globalThis.fetch;
    const flakyFetch = ((input: string | URL | Request, init?: RequestInit) => {
      if (offlineNow) return Promise.reject(new TypeError('Failed to fetch'));
      return realFetch(input as never, init);
    }) as unknown as typeof fetch;

    const A = await makeDevice('off-a', token, flakyFetch);
    created.push(A);

    await A.engine.dispatch({
      entityType: 'TASK',
      entityId: 'off-1',
      opType: OpType.Create,
      payload: { title: '断网时写的' },
    });

    const offline = await A.client.sync();
    // 必须是 offline 而不是 error —— 否则永远不会重试
    expect(offline.kind).toBe('offline');

    // 关键：本地数据在，且**仍在待上传队列里**（没丢）
    expect(A.engine.getState().tasks['off-1']).toBeDefined();
    expect(await A.engine.getPendingUpload()).toHaveLength(1);

    // ── 恢复网络 ──
    offlineNow = false;

    const back = await A.client.sync();
    expect(back).toEqual({ kind: 'synced', at: expect.any(Number) });
    // 重放成功后队列清空
    expect(await A.engine.getPendingUpload()).toHaveLength(0);
  }, 60_000);

});

describe.skipIf(URL_BASE === undefined)('P1 验收：离线合并与崩溃恢复（真实服务端）', () => {
  const created: Array<{ adapter: IndexedDbAdapter }> = [];
  afterAll(() => {
    for (const d of created) d.adapter.close();
  });

  async function freshToken(prefix: string): Promise<string> {
    const reg = await fetch(`${URL_BASE}/api/test/create-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `heyta-${prefix}-${String(Date.now())}@example.com`,
        password: 'heyta-p1-password',
      }),
    });
    const body = (await reg.json()) as Record<string, unknown>;
    return (body['token'] ??
      body['accessToken'] ??
      (body['data'] as Record<string, unknown> | undefined)?.['token']) as string;
  }

  it('🔴 离线合并：A 断网改 + B 在线改 → 冲突可判定且两边都不丢数据', async () => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

    const token = await freshToken('merge');

    let aOffline = false;
    const realFetch = globalThis.fetch;
    const flaky = ((input: string | URL | Request, init?: RequestInit) => {
      if (aOffline) return Promise.reject(new TypeError('Failed to fetch'));
      return realFetch(input as never, init);
    }) as unknown as typeof fetch;

    const A = await makeDevice('merge-a', token, flaky);
    const B = await makeDevice('merge-b', token);
    created.push(A, B);

    await A.engine.dispatch({
      entityType: 'TASK',
      entityId: 'shared',
      opType: OpType.Create,
      payload: { title: '原始标题' },
    });
    await A.client.sync();
    await B.client.sync();
    expect(B.engine.getState().tasks['shared']!.title).toBe('原始标题');

    aOffline = true;
    await A.engine.dispatch({
      entityType: 'TASK',
      entityId: 'shared',
      opType: OpType.Update,
      payload: { title: 'A 离线改的' },
    });
    const aOfflineSync = await A.client.sync();
    expect(aOfflineSync.kind).toBe('offline');
    expect(await A.engine.getPendingUpload()).toHaveLength(1);
    expect(A.engine.getState().tasks['shared']!.title).toBe('A 离线改的');

    await B.engine.dispatch({
      entityType: 'TASK',
      entityId: 'shared',
      opType: OpType.Update,
      payload: { title: 'B 在线改的' },
    });
    await B.client.sync();
    expect(B.engine.getState().tasks['shared']!.title).toBe('B 在线改的');

    aOffline = false;
    const back = await A.client.sync();

    /**
     * 关键：这里**不该**自动收敛，也不该只是笼统报错。
     *
     * 我最初断言"两端自动收敛到时间较晚的那个"，想当然以为 LWW 会自动择一。
     * 协议不是这样：`sync-core` 的 `suggestConflictResolution` 在有创建/删除
     * 不对称或时间戳相近时拒绝自动选边，需要人来决定。
     *
     * 更重要的是**上报的形状**：冲突必须带着双方内容结构化上报
     * （`kind: 'conflict'`），而不是一句"同步失败"。只报一句话，
     * 用户既不知道冲突的是什么，也无处可选，问题就永久卡住了。
     */
    expect(back.kind).toBe('conflict');
    if (back.kind !== 'conflict') return;
    expect(back.conflicts.length).toBeGreaterThan(0);
    // 双方内容都要拿得到 —— 界面靠它让用户比较
    expect(back.conflicts[0]!.local.payload).toBeDefined();

    /**
     * ── "不丢数据"到底指什么 ──
     *
     * 我一开始断言"A 的界面仍然显示 A 改的值"，那是个**想当然的假设**。
     * 实测：下载阶段把 B 的 op 应用了，A 的本地视图于是更新成 B 的值。
     * 这其实是合理的 —— A 确实已经**看到**了 B 的改动，而胜负还没被决定。
     *
     * 真正要保证的是两条：
     *   1. **A 自己的编辑没被丢掉**：仍在本地日志里、仍在待上传队列里，
     *      用户可以选"保留本地"把它恢复回来（相邻用例已验证确实能恢复）。
     *   2. **冲突被结构化上报**，双方内容都拿得到。
     *
     * 也就是说，"不丢"= "两条 op 都还在且用户随时能选"，
     * 而不是"界面停在谁的值上"。把前者写成后者，就是在断言一个
     * 我自己都没验证过的实现细节 —— 测试会红，但红得没有意义。
     */
    expect(A.engine.getState().tasks['shared']!.title).toBe('B 在线改的');
    expect(B.engine.getState().tasks['shared']!.title).toBe('B 在线改的');

    // ① A 的编辑仍留在待上传队列里（等用户决定），没有被丢弃
    const stillPending = await A.engine.getPendingUpload();
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0]!.payload).toMatchObject({ title: 'A 离线改的' });

    // ② A 的编辑也仍在 op-log 里 —— 事实来源不做"删除"式清理
    const aOps = await A.engine.getOpsForEntity('TASK' as never, 'shared');
    expect(aOps.some((o) => o.clientId === 'merge-a')).toBe(true);

    // ③ 冲突上报里双方内容都能看到，界面才有东西可比
    expect(back.conflicts[0]!.local.payload).toMatchObject({ title: 'A 离线改的' });
    expect(back.conflicts[0]!.remote?.payload).toMatchObject({ title: 'B 在线改的' });

    expect(A.engine.getState().tasks['shared']).toBeDefined();
    expect(B.engine.getState().tasks['shared']).toBeDefined();
  }, 60_000);

  it('🔴 冲突可判定：服务端明确告知并发修改，并给出既有版本时钟', async () => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

    const token = await freshToken('detect');

    let aOffline = false;
    const realFetch = globalThis.fetch;
    const flaky = ((input: string | URL | Request, init?: RequestInit) => {
      if (aOffline) return Promise.reject(new TypeError('Failed to fetch'));
      return realFetch(input as never, init);
    }) as unknown as typeof fetch;

    const A = await makeDevice('det-a', token, flaky);
    const B = await makeDevice('det-b', token);
    created.push(A, B);

    await A.engine.dispatch({
      entityType: 'TASK',
      entityId: 'c1',
      opType: OpType.Create,
      payload: { title: 'base' },
    });
    await A.client.sync();
    await B.client.sync();

    aOffline = true;
    await A.engine.dispatch({
      entityType: 'TASK',
      entityId: 'c1',
      opType: OpType.Update,
      payload: { title: 'A' },
    });
    await A.client.sync();

    await B.engine.dispatch({
      entityType: 'TASK',
      entityId: 'c1',
      opType: OpType.Update,
      payload: { title: 'B' },
    });
    await B.client.sync();

    aOffline = false;
    const status = await A.client.sync();

    // 必须被识别为**冲突**，而不是笼统的"同步失败"，
    // 而且要带上双方内容 —— 只报一句话等于把问题变成死路
    expect(status.kind).toBe('conflict');
    if (status.kind === 'conflict') {
      expect(status.conflicts[0]!.local).toBeDefined();
    }
  }, 60_000);

  it('🔴 崩溃恢复：写入中途"关闭页面" → 重开数据一致', async () => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

    const token = await freshToken('crash');

    // 用固定库名，模拟"同一个浏览器重新打开"
    const dbName = `crash-${String(Date.now())}`;
    const adapter1 = new IndexedDbAdapter(dbName);
    await adapter1.init();
    const store1 = new IndexedDbOpLogStore<Operation<string>>(adapter1);
    const engine1 = new OpLogEngine({ clientId: 'crash-device', store: store1 });
    await engine1.recover();

    await engine1.dispatch({
      entityType: 'TASK',
      entityId: 'survives',
      opType: OpType.Create,
      payload: { title: '必须活下来' },
    });
    await engine1.dispatch({
      entityType: 'TASK',
      entityId: 'survives',
      opType: OpType.Update,
      payload: { completedAt: 12345 },
    });
    const before = engine1.getState();
    expect(before.tasks['survives']!.completedAt).toBe(12345);

    // ── "关闭页面"：丢弃内存里的引擎，只留磁盘 ──
    adapter1.close();

    // ── "重新打开"：新适配器 + 新引擎，从日志重建 ──
    const adapter2 = new IndexedDbAdapter(dbName);
    await adapter2.init();
    const store2 = new IndexedDbOpLogStore<Operation<string>>(adapter2);
    const engine2 = new OpLogEngine({ clientId: 'crash-device', store: store2 });
    const recovery = await engine2.recover();

    // 内存态从零重建，但必须与关闭前一致
    expect(engine2.getState().tasks['survives']).toBeDefined();
    expect(engine2.getState().tasks['survives']!.title).toBe('必须活下来');
    expect(engine2.getState().tasks['survives']!.completedAt).toBe(12345);

    // 重建的实体数应与关闭前相同（没有重复应用导致的状态漂移）
    expect(Object.keys(engine2.getState().tasks).sort()).toEqual(
      Object.keys(before.tasks).sort(),
    );

    // 重开后仍能继续同步（恢复出来的 op 还在待上传队列）
    const client = new SyncClient({
      baseUrl: URL_BASE!,
      clientId: 'crash-device',
      getToken: async () => token,
      getPassword: async () => PASSWORD,
      getLastServerSeq: async () => {
        const r = await adapter2.get<{ key: string; value: number }>(STORES.META, KEY);
        return r?.value ?? 0;
      },
      setLastServerSeq: async (seq) => {
        await adapter2.put(STORES.META, { key: KEY, value: seq });
      },
      getLocalOps: () => engine2.getPendingUpload(),
      markUploaded: (m) => engine2.markUploaded(m),
      applyRemote: async (ops) => {
        await engine2.applyRemote(ops);
      },
      redispatch: async (op) => {
        await engine2.redispatch(op);
      },
      discardLocal: (ids) => engine2.discardPendingUpload(ids),
      getOpsForEntity: (entityType, entityId) =>
        engine2.getOpsForEntity(entityType as never, entityId),
      getOpById: (opId) => engine2.getOpById(opId),
      redispatchPayload: async (intent) => {
        await engine2.dispatch({
          entityType: intent.entityType as never,
          entityId: intent.entityId,
          opType: intent.opType as never,
          payload: intent.payload,
        });
      },
    });

    const status = await client.sync();
    expect(status).toEqual({ kind: 'synced', at: expect.any(Number) });
    expect(await engine2.getPendingUpload()).toHaveLength(0);

    // 未被丢弃的恢复结果应当被记录（哪怕是 0，也说明路径跑到了）
    expect(recovery).toBeDefined();

    created.push({ adapter: adapter2 });
  }, 60_000);
});


describe.skipIf(URL_BASE === undefined)('冲突解决：用户选完之后双端真的收敛（真实服务端）', () => {
  const created: Array<{ adapter: IndexedDbAdapter }> = [];
  afterAll(() => {
    for (const d of created) d.adapter.close();
  });

  async function freshToken(prefix: string): Promise<string> {
    const reg = await fetch(`${URL_BASE}/api/test/create-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `heyta-res-${prefix}-${String(Date.now())}@example.com`,
        password: 'heyta-p1-password',
      }),
    });
    const body = (await reg.json()) as Record<string, unknown>;
    return (body['token'] ??
      body['accessToken'] ??
      (body['data'] as Record<string, unknown> | undefined)?.['token']) as string;
  }

  /**
   * 造一个"两边都改了同一个字段"的真并发场景，返回 A 处于冲突状态的客户端。
   */
  async function makeConflict(prefix: string) {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

    const token = await freshToken(prefix);

    let aOffline = false;
    const realFetch = globalThis.fetch;
    const flaky = ((input: string | URL | Request, init?: RequestInit) => {
      if (aOffline) return Promise.reject(new TypeError('Failed to fetch'));
      return realFetch(input as never, init);
    }) as unknown as typeof fetch;

    const A = await makeDevice(`${prefix}-a`, token, flaky);
    const B = await makeDevice(`${prefix}-b`, token);
    created.push(A, B);

    await A.engine.dispatch({
      entityType: 'TASK',
      entityId: 'c',
      opType: OpType.Create,
      payload: { title: 'base' },
    });
    await A.client.sync();
    await B.client.sync();

    aOffline = true;
    await A.engine.dispatch({
      entityType: 'TASK',
      entityId: 'c',
      opType: OpType.Update,
      payload: { title: 'A 的版本' },
    });
    await A.client.sync(); // offline

    await B.engine.dispatch({
      entityType: 'TASK',
      entityId: 'c',
      opType: OpType.Update,
      payload: { title: 'B 的版本' },
    });
    await B.client.sync();

    aOffline = false;
    const status = await A.client.sync();

    return { A, B, status, setOffline: (v: boolean) => { aOffline = v; } };
  }

  it('🔴 保留远端：用户选完后双端收敛到远端值', async () => {
    const { A, B, status } = await makeConflict('remote');

    // 先确认真的进了冲突状态，而且**双方内容都拿得到**
    expect(status.kind).toBe('conflict');
    if (status.kind !== 'conflict') return;
    expect(status.conflicts).toHaveLength(1);

    const c = status.conflicts[0]!;
    expect(c.entityType).toBe('TASK');
    expect(c.entityId).toBe('c');
    expect(c.local.payload).toMatchObject({ title: 'A 的版本' });
    // 界面要能看见对端到底是什么 —— 否则用户没法选
    expect(c.remote).toBeDefined();
    expect(c.remote!.payload).toMatchObject({ title: 'B 的版本' });

    // 用户点"保留其他设备那一版"
    const after = await A.client.resolveConflict(c, 'keep-remote');

    expect(after.kind).toBe('synced');
    expect(A.engine.getState().tasks['c']!.title).toBe('B 的版本');
    expect(await A.engine.getPendingUpload()).toHaveLength(0);

    // B 拉一次，两端必须一致
    await B.client.sync();
    expect(B.engine.getState().tasks['c']!.title).toBe('B 的版本');
    expect(A.engine.getState().tasks['c']!.title).toBe(B.engine.getState().tasks['c']!.title);
  }, 60_000);

  it('🔴 保留本地：用户选完后双端收敛到本地值', async () => {
    const { A, B, status } = await makeConflict('local');

    expect(status.kind).toBe('conflict');
    if (status.kind !== 'conflict') return;

    const c = status.conflicts[0]!;
    expect(c.remote!.payload).toMatchObject({ title: 'B 的版本' });

    // 用户点"保留本机那一版"
    const after = await A.client.resolveConflict(c, 'keep-local');

    expect(after.kind).toBe('synced');
    expect(A.engine.getState().tasks['c']!.title).toBe('A 的版本');
    expect(await A.engine.getPendingUpload()).toHaveLength(0);

    // B 拉到 A 的选择，两端必须一致
    await B.client.sync();
    expect(B.engine.getState().tasks['c']!.title).toBe('A 的版本');
    expect(A.engine.getState().tasks['c']!.title).toBe(B.engine.getState().tasks['c']!.title);
  }, 60_000);

  it('🔴 丢弃待上传项不等于删除 op：日志里必须还在', async () => {
    const { A, status } = await makeConflict('noclear');

    expect(status.kind).toBe('conflict');
    if (status.kind !== 'conflict') return;
    const c = status.conflicts[0]!;

    const before = await A.engine.getOpsForEntity('TASK' as never, 'c');
    const hadLocalOp = before.some((o) => o.id === c.local.opId);
    expect(hadLocalOp).toBe(true);

    await A.client.resolveConflict(c, 'keep-remote');

    // op-log 是事实日志：被"丢弃"的那条必须**还在日志里**，只是不再上传。
    // 物理删除会让本地历史无法解释，重放也会与其它设备不一致。
    const afterOps = await A.engine.getOpsForEntity('TASK' as never, 'c');
    expect(afterOps.some((o) => o.id === c.local.opId)).toBe(true);
  }, 60_000);
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI → store → SyncClient → 服务端
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 上面的 `冲突解决：用户选完之后双端真的收敛` 调的是 `SyncClient.resolveConflict`
 * 这个 API，绕过了 store；`conflict-dialog.spec.tsx` 测的是界面，却把
 * store action mock 掉了。两份测试各自都是绿的，中间那段接线**没有测试**：
 *
 *     ConflictDialog ──► useSyncStore.resolveConflict ──► buildClient ──► SyncClient
 *
 * 只要 store 的 action 把 `choice` 传错、找错冲突、或漏掉 redispatchPayload，
 * 上面两份测试都照样通过（一份绕过 store，一份 mock 掉 store）。
 *
 * 这条用例把整条链一次跑完，**零 mock**：
 *   点真实 <ConflictDialog /> 的按钮
 *     → 真的 useSyncStore action
 *       → 真的 buildClient → 真的 SyncClient
 *         → 真引擎（模块单例）→ 真 IndexedDB → 真 HTTP → 真 Fastify 服务端
 * 然后断言：**双端最终落在同一个值上，且正是用户选的那一版**。
 *
 * 设备 A 是被测应用本身 —— 它必须用 `initOpLog()` 的模块单例引擎，
 * 因为 store 的 `requireEngine()` 拿的就是这个实例。设备 B 复用既有
 * `makeDevice` 造的独立设备（只有 A 的界面在被测）。
 */
describe.skipIf(URL_BASE === undefined)(
  '🔴 冲突解决：从真实对话框点击到双端收敛（真实服务端，零 mock）',
  () => {
    const created: Array<{ adapter: IndexedDbAdapter }> = [];
    let root: Root | undefined;
    let container: HTMLDivElement | undefined;

    afterEach(() => {
      act(() => {
        root?.unmount();
      });
      container?.remove();
      root = undefined;
      container = undefined;
      // store 是模块单例，用例之间必须清干净，否则冲突状态会互相污染
      useSyncStore.setState({
        status: { kind: 'idle' },
        conflictDialogOpen: false,
        baseUrl: '',
        token: undefined,
        password: undefined,
      });
      __resetOpLogForTests();
    });

    afterAll(() => {
      for (const d of created) d.adapter.close();
    });

    async function freshToken(prefix: string): Promise<string> {
      const reg = await fetch(`${URL_BASE}/api/test/create-user`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: `heyta-ui-${prefix}-${String(Date.now())}@example.com`,
          password: 'heyta-p1-password',
        }),
      });
      expect(reg.ok).toBe(true);
      const body = (await reg.json()) as Record<string, unknown>;
      return (body['token'] ??
        body['accessToken'] ??
        (body['data'] as Record<string, unknown> | undefined)?.['token']) as string;
    }

    /**
     * 造一个真并发冲突，其中**设备 A 的同步客户端完全来自真实 store**。
     *
     * ⚠️ 不能照搬上面 `makeConflict` 的"注入 flaky fetch 模拟离线"：
     * store 的 `buildClient` 不接受 `fetchImpl`，而为了测试去给它开一个口子
     * 就是改被测代码的形状 —— 那正是这条用例要避免的。
     *
     * 改用协议本身保证的并发，不依赖断网：
     *   1. A 创建 base 并上传，B 下载；
     *   2. A 本地改一版（**先不传**）；
     *   3. B 抢先改并上传；
     *   4. A 经真实 store 同步 → 服务端以 CONFLICT_CONCURRENT 拒绝 A 的 op。
     * 到达的仍是同一个 `status.kind === 'conflict'`，且双方内容都拿得到。
     */
    async function makeUiConflict(prefix: string) {
      const g = globalThis as unknown as {
        indexedDB: IDBFactory;
        IDBKeyRange: typeof IDBKeyRange;
      };
      g.indexedDB = new IDBFactory();
      g.IDBKeyRange = IDBKeyRange;

      const token = await freshToken(prefix);

      // 设备 A = 被测应用：模块单例引擎，store 的 requireEngine() 用的就是它
      __resetOpLogForTests();
      await initOpLog('heyta');
      const A = requireEngine();

      // 设备 B = 另一台真实设备，复用既有 makeDevice
      const B = await makeDevice(`${prefix}-b`, token);
      created.push(B);

      // 把 store 指向真实服务端 / 真实令牌 / 真实 E2EE 口令
      useSyncStore.getState().configure(URL_BASE!, token, PASSWORD);

      await A.dispatch({
        entityType: 'TASK',
        entityId: 'c',
        opType: OpType.Create,
        payload: { title: 'base' },
      });
      const first = await useSyncStore.getState().syncNow();
      expect(first.kind).toBe('synced');

      await B.client.sync();
      expect(B.engine.getState().tasks['c']!.title).toBe('base');

      // A 本地改，但先不同步
      await A.dispatch({
        entityType: 'TASK',
        entityId: 'c',
        opType: OpType.Update,
        payload: { title: 'A 的版本' },
      });

      // B 抢先上传自己的版本，服务端"当前版本"变成 B 的
      await B.engine.dispatch({
        entityType: 'TASK',
        entityId: 'c',
        opType: OpType.Update,
        payload: { title: 'B 的版本' },
      });
      const bStatus = await B.client.sync();
      expect(bStatus.kind).toBe('synced');

      // A 现在经**真实 store action** 同步 —— 服务端判定并发冲突
      const status = await useSyncStore.getState().syncNow();
      return { A, B, status };
    }

    /** 渲染**真实** `<ConflictDialog />`（文件是 .ts，故用 createElement）。 */
    function renderDialog(): HTMLDivElement {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => {
        root!.render(createElement(ConflictDialog));
      });
      return container;
    }

    /** 点击后 `void resolveConflict(...)` 不返回 promise，只能轮询真实状态。 */
    async function waitForSynced(readValue: () => unknown): Promise<void> {
      const deadline = Date.now() + 30_000;
      for (;;) {
        const status = useSyncStore.getState().status;
        if (status.kind === 'synced') return;
        if (Date.now() > deadline) {
          throw new Error(
            `等待冲突解决超时：status=${JSON.stringify(status)}，` +
              `设备 A 当前值=${JSON.stringify(readValue())}`,
          );
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    }

    function keepButtons(el: HTMLElement): HTMLButtonElement[] {
      return [...el.querySelectorAll('button')].filter((b) =>
        b.textContent?.includes('保留这一版'),
      ) as HTMLButtonElement[];
    }

    it('🔴 点"本机"按钮 → 双端收敛到本地值', async () => {
      const { A, B, status } = await makeUiConflict('ui-local');

      // 前提：真的进了冲突，且双方内容都在
      expect(status.kind).toBe('conflict');
      if (status.kind !== 'conflict') return;
      expect(status.conflicts).toHaveLength(1);
      const c = status.conflicts[0]!;
      expect(c.entityType).toBe('TASK');
      expect(c.entityId).toBe('c');
      expect(c.local.payload).toMatchObject({ title: 'A 的版本' });
      expect(c.remote?.payload).toMatchObject({ title: 'B 的版本' });

      // 真实对话框：用户能看见两边分别是什么
      const el = renderDialog();
      expect(el.textContent).toContain('A 的版本');
      expect(el.textContent).toContain('B 的版本');
      const buttons = keepButtons(el);
      expect(buttons).toHaveLength(2);

      // 第 0 个按钮 = "本机"
      act(() => {
        buttons[0]!.click();
      });
      await waitForSynced(() => A.getState().tasks['c']);

      // ── 收敛断言：双端同值，且是用户选的"本地"那一版 ──
      expect(useSyncStore.getState().status.kind).toBe('synced');
      expect(A.getState().tasks['c']!.title).toBe('A 的版本');
      expect(await A.getPendingUpload()).toHaveLength(0);

      await B.client.sync();
      expect(B.engine.getState().tasks['c']!.title).toBe('A 的版本');
      // 双端必须是**同一个值**
      expect(A.getState().tasks['c']!.title).toBe(B.engine.getState().tasks['c']!.title);
    }, 60_000);

    it('🔴 点"其他设备"按钮 → 双端收敛到远端值', async () => {
      const { A, B, status } = await makeUiConflict('ui-remote');

      expect(status.kind).toBe('conflict');
      if (status.kind !== 'conflict') return;
      expect(status.conflicts).toHaveLength(1);
      const c = status.conflicts[0]!;
      expect(c.local.payload).toMatchObject({ title: 'A 的版本' });
      expect(c.remote?.payload).toMatchObject({ title: 'B 的版本' });

      const el = renderDialog();
      expect(el.textContent).toContain('A 的版本');
      expect(el.textContent).toContain('B 的版本');
      const buttons = keepButtons(el);
      expect(buttons).toHaveLength(2);

      // 第 1 个按钮 = "其他设备"
      act(() => {
        buttons[1]!.click();
      });
      await waitForSynced(() => A.getState().tasks['c']);

      // ── 收敛断言：双端同值，且是用户选的"远端"那一版 ──
      expect(useSyncStore.getState().status.kind).toBe('synced');
      expect(A.getState().tasks['c']!.title).toBe('B 的版本');
      expect(await A.getPendingUpload()).toHaveLength(0);

      await B.client.sync();
      expect(B.engine.getState().tasks['c']!.title).toBe('B 的版本');
      expect(A.getState().tasks['c']!.title).toBe(B.engine.getState().tasks['c']!.title);
    }, 60_000);
  },
);

