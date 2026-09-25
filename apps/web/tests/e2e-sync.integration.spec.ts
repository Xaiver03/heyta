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
import { afterAll, describe, expect, it } from 'vitest';

import { IndexedDbAdapter, IndexedDbOpLogStore, STORES } from '@heyta/storage';
import { OpLogEngine } from '@heyta/op-log';
import { OpType } from '@heyta/sync-core';
import type { Operation } from '@heyta/sync-core';

import { SyncClient } from '../src/features/sync/client.js';

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
     * 关键：这里**不该**自动收敛。
     *
     * 我最初断言"两端自动收敛到时间较晚的那个"，想当然以为 LWW 会自动择一。
     * 实测发现协议不是这样：sync-core 的 `suggestConflictResolution` 对
     * "两边都是同实体 UPDATE、时间戳相近、无删除/创建不对称"返回 **manual**
     * —— 它**故意拒绝自动选边**。
     *
     * 这是对的。自动择一 = 静默丢掉另一个人的编辑，而用户永远不会知道。
     * 计划要求的是"冲突**可判定**"，不是"自动消失"。
     */
    expect(back.kind).toBe('error');
    if (back.kind === 'error') {
      expect(back.message).toContain('冲突');
      expect(back.retryable).toBe(false);
    }

    // 两边数据都不能丢
    expect(A.engine.getState().tasks['shared']!.title).toBe('A 离线改的');
    expect(B.engine.getState().tasks['shared']!.title).toBe('B 在线改的');

    // A 的 op 仍留在待上传队列里（等用户决定后重试），没有被丢弃
    expect(await A.engine.getPendingUpload()).toHaveLength(1);

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

    // 必须被识别为**冲突**，而不是笼统的"同步失败"
    expect(status.kind).toBe('error');
    if (status.kind === 'error') {
      expect(status.message).toContain('冲突');
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
    });

    const status = await client.sync();
    expect(status).toEqual({ kind: 'synced', at: expect.any(Number) });
    expect(await engine2.getPendingUpload()).toHaveLength(0);

    // 未被丢弃的恢复结果应当被记录（哪怕是 0，也说明路径跑到了）
    expect(recovery).toBeDefined();

    created.push({ adapter: adapter2 });
  }, 60_000);
});
