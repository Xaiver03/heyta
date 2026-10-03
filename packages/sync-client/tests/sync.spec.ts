/**
 * 同步客户端测试
 * =================
 *
 * 这里测的都是"坏了不会报错"的行为：
 *   - 明文上传被拒绝（服务端强制 E2EE 且无开关）
 *   - 未知实体类型在上传前被拦住（线协议不校验）
 *   - 已上传的 op 不会被重传（游标/标记的一致性）
 *   - 离线与"服务端拒绝"要区分开（否则重试白费配额）
 */

import { describe, expect, it, vi } from 'vitest';

import { OpType, decrypt, encrypt } from '@heyta/sync-core';
import type { Operation } from '@heyta/sync-core';

import { SyncClient, createRetryScheduler, isNetworkError, type SyncStatus } from '../src/client.js';
import { createVaultPayloadCipher, type SyncPayloadCipher } from '../src/payload-cipher.js';

const PASSWORD = 'correct horse battery staple';
const BASE = 'http://127.0.0.1:3000';

function makeOp(over: Partial<Operation<string>> = {}): Operation<string> {
  return {
    id: 'op-1',
    clientId: 'device-a',
    actionType: 'CREATE_TASK',
    opType: OpType.Create,
    entityType: 'TASK',
    entityId: 't1',
    payload: { title: '写文档' },
    vectorClock: { 'device-a': 1 },
    timestamp: 1000,
    schemaVersion: 1,
    ...over,
  } as Operation<string>;
}

interface Harness {
  client: SyncClient;
  uploads: Array<{ url: string; body: Record<string, unknown> }>;
  downloads: string[];
  marked: Array<ReadonlyMap<string, number>>;
  historyIncomplete: { value: number };
  events: string[];
  /** `markRejected` 的调用记录（按批）。用于断言"永久拒绝被移出队列"。 */
  rejected: string[][];
  applied: Operation<string>[][];
  mergedClocks: Array<Record<string, number>>;
  cursor: { value: number };
}

interface HarnessOptions {
  getPayloadCipher?: () => Promise<SyncPayloadCipher | undefined>;
  password?: string | undefined;
  ops?: Operation<string>[];
  /** Omit the durable incomplete-history hook to exercise fail-closed behavior. */
  withoutHistoryMarker?: boolean;
  /** Make the durable incomplete-history hook fail after recording the attempt. */
  failHistoryMarker?: boolean;
  /** Omit the durable snapshot frontier hook to exercise fail-closed behavior. */
  withoutMergeRemoteClock?: boolean;
}

function makeHarness(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  opts: HarnessOptions = {},
): Harness {
  const uploads: Harness['uploads'] = [];
  const downloads: string[] = [];
  const marked: Harness['marked'] = [];
  const historyIncomplete = { value: 0 };
  const events: string[] = [];
  const rejected: Harness['rejected'] = [];
  const applied: Harness['applied'] = [];
  const mergedClocks: Harness['mergedClocks'] = [];
  const cursor = { value: 0 };

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      uploads.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    } else {
      downloads.push(url);
    }
    return handler(url, init);
  }) as unknown as typeof fetch;

  const client = new SyncClient({
    baseUrl: BASE,
    clientId: 'device-a',
    getToken: async () => 'test-token',
    getPassword: async () => ('password' in opts ? opts.password : PASSWORD),
    ...(opts.getPayloadCipher ? { encryptionMode: 'vault' as const, getPayloadCipher: opts.getPayloadCipher } : { encryptionMode: 'password' as const }),
    getLastServerSeq: async () => cursor.value,
    setLastServerSeq: async (s) => {
      events.push(`cursor:${String(s)}`);
      cursor.value = s;
    },
    getLocalOps: async () => opts.ops ?? [],
    markUploaded: async (m) => {
      marked.push(m);
    },
    applyRemote: async (ops) => {
      events.push('apply-remote');
      applied.push(ops);
    },
    ...(opts.withoutMergeRemoteClock ? {} : {
      mergeRemoteClock: async (clock: Record<string, number>) => {
        events.push('merge-remote-clock');
        mergedClocks.push(clock);
      },
    }),
    ...(opts.withoutHistoryMarker ? {} : {
      markHistoryIncomplete: async () => {
        events.push('mark-history-incomplete');
        historyIncomplete.value += 1;
        if (opts.failHistoryMarker) throw new Error('incomplete-history persistence failed');
      },
    }),
    redispatch: async () => undefined,
    discardLocal: async () => undefined,
    markRejected: async (ids) => {
      rejected.push([...ids]);
    },
    getOpsForEntity: async () => [],
    getOpById: async () => undefined,
    redispatchPayload: async () => undefined,
    fetchImpl,
  });

  return {
    client,
    uploads,
    downloads,
    marked,
    historyIncomplete,
    events,
    rejected,
    applied,
    mergedClocks,
    cursor,
  };
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('同步客户端 — E2EE 强制', () => {
  it('🔴 没有口令时**拒绝同步**，绝不以明文上传', async () => {
    const h = makeHarness(() => okJson({}), { password: undefined });
    const status = await h.client.sync();

    expect(status.kind).toBe('error');
    if (status.kind === 'error') expect(status.retryable).toBe(false);
    // 关键断言：一个请求都没发出去
    expect(h.uploads).toHaveLength(0);
    expect(h.downloads).toHaveLength(0);
  });

  it('空口令同样拒绝（空字符串不是"没设置"的合法替代）', async () => {
    const h = makeHarness(() => okJson({}), { password: '' });
    const status = await h.client.sync();
    expect(status.kind).toBe('error');
    expect(h.uploads).toHaveLength(0);
  });

  it('上传的 payload 是**密文**且 isPayloadEncrypted 显式为 true', async () => {
    const h = makeHarness(
      () => okJson({ results: [], latestSeq: 1 }),
      { ops: [makeOp()] },
    );
    await h.client.sync();

    expect(h.uploads).toHaveLength(1);
    const ops = h.uploads[0]!.body['ops'] as Array<Record<string, unknown>>;
    const sent = ops[0]!;

    // 服务端要求显式 true（缺失算违规，不是"当作 false"）
    expect(sent['isPayloadEncrypted']).toBe(true);
    expect(typeof sent['payload']).toBe('string');
    // 明文不能出现在请求体里
    expect(JSON.stringify(sent)).not.toContain('写文档');

    // 而且必须真能解回来
    const plain = await decrypt(sent['payload'] as string, PASSWORD);
    expect(JSON.parse(plain)).toEqual({ title: '写文档' });
  });

  it('🔴 未知实体类型在上传**之前**被拦住（线协议不校验成员）', async () => {
    const h = makeHarness(
      () => okJson({ results: [], latestSeq: 1 }),
      { ops: [makeOp({ entityType: 'TASKK' })] }, // 拼错
    );
    const status = await h.client.sync();

    expect(status.kind).toBe('error');
    // 一个请求都不该发出去 —— 否则服务端会逐条拒绝
    expect(h.uploads).toHaveLength(0);
  });
});

describe('同步客户端 — 因果前沿协议', () => {
  it('compacts only operations that already dominate a negotiated frontier', async () => {
    const pending: Operation<string>[] = [];
    const h = makeHarness((_url, init) => init?.method === 'POST'
      ? okJson({ results: [], latestSeq: 12 })
      : okJson({ ops: [], hasMore: false, latestSeq: 12,
          capabilities: { causalFrontierDelta: true },
          causalFrontier: { token: 'cf1.test', vectorClock: { remote: 4, old: 2 } } }),
      { ops: pending });
    await h.client.sync();
    pending.push(makeOp({ id: 'dominates', vectorClock: { 'device-a': 3, remote: 4, old: 2, newDevice: 1 } }),
      makeOp({ id: 'offline', vectorClock: { 'device-a': 2, remote: 3 } }));
    await h.client.sync();
    const request = h.uploads[0]!.body;
    const sent = request['ops'] as Array<Record<string, unknown>>;
    expect(request['causalFrontierToken']).toBe('cf1.test');
    expect(sent[0]!['vectorClockEncoding']).toBe('frontier-delta');
    expect(sent[0]!['vectorClock']).toEqual({ 'device-a': 3, newDevice: 1 });
    expect(sent[1]!['vectorClockEncoding']).toBeUndefined();
    expect(sent[1]!['vectorClock']).toEqual(pending[1]!.vectorClock);
  });
});

describe('frontier compatibility failures', () => {
  it('does not skip an unreadable full-state prefix even when a later delta decrypts', async () => {
    const cipher = await encrypt('{}', PASSWORD);
    const h = makeHarness(() => okJson({
      ops: [
        { serverSeq: 1, op: { ...makeOp({ id: 'snapshot', opType: 'REPAIR', entityType: 'ALL' }), payload: 'bad-cipher', isPayloadEncrypted: true } },
        { serverSeq: 2, op: { ...makeOp({ id: 'tail' }), payload: cipher, isPayloadEncrypted: true } },
      ], latestSeq: 2, hasMore: false, snapshotVectorClock: { lost: 10 },
    }));
    expect((await h.client.sync()).kind).toBe('error');
    expect(h.cursor.value).toBe(0);
    expect(h.applied).toEqual([]);
    expect(h.mergedClocks).toEqual([]);
  });

  for (const failureStatus of [400, 404]) {
    it(`retries full immutable operations after compact endpoint returns ${failureStatus}`, async () => {
      const pending: Operation<string>[] = [];
      const h = makeHarness((url, init) => {
        if (init?.method !== 'POST') return okJson({ ops: [], latestSeq: 4,
          capabilities: { causalFrontierDelta: true },
          causalFrontier: { token: 'cf1.test', vectorClock: { remote: 4 } } });
        if (url.endsWith('/causal')) return new Response('{}', { status: failureStatus });
        return okJson({ results: [{ opId: 'op-1', accepted: true, serverSeq: 5 }], latestSeq: 5 });
      }, { ops: pending });
      await h.client.sync();
      pending.push(makeOp({ vectorClock: { remote: 4, 'device-a': 1 } }));
      expect((await h.client.sync()).kind).toBe('synced');
      expect(h.uploads).toHaveLength(2);
      expect(h.uploads[0]!.url).toContain('/ops/causal');
      expect(h.uploads[1]!.url.endsWith('/ops')).toBe(true);
      const compact = (h.uploads[0]!.body['ops'] as Array<Record<string, unknown>>)[0]!;
      const full = (h.uploads[1]!.body['ops'] as Array<Record<string, unknown>>)[0]!;
      expect(full['vectorClock']).toEqual(pending[0]!.vectorClock);
      expect(full['vectorClockEncoding']).toBeUndefined();
      expect(full['payload']).toBe(compact['payload']);
      expect(full['id']).toBe(compact['id']);
    });
  }

  it('does not enable compaction without explicit server capability', async () => {
    const pending: Operation<string>[] = [];
    const h = makeHarness(() => okJson({ ops: [], latestSeq: 1,
      causalFrontier: { token: 'cf1.test', vectorClock: { remote: 4 } } }), { ops: pending });
    await h.client.sync();
    pending.push(makeOp({ vectorClock: { remote: 4, 'device-a': 1 } }));
    await h.client.sync();
    const sent = (h.uploads[0]!.body['ops'] as Array<Record<string, unknown>>)[0]!;
    expect(sent['vectorClockEncoding']).toBeUndefined();
    expect(sent['vectorClock']).toEqual(pending[0]!.vectorClock);
  });
});

describe('同步客户端 — 压实因果前沿', () => {
  it('消费 snapshotVectorClock，即使本页没有对应的 op', async () => {
    const h = makeHarness(() =>
      okJson({
        ops: [],
        hasMore: false,
        latestSeq: 42,
        snapshotVectorClock: { 'archived-device': 9 },
      }),
    );

    const status = await h.client.sync();

    expect(status.kind).toBe('synced');
    expect(h.mergedClocks).toEqual([{ 'archived-device': 9 }]);
  });

  it('🔴 snapshotVectorClock 没有 durable merge hook 时失败且不推进游标', async () => {
    const h = makeHarness(() => okJson({
      ops: [],
      hasMore: false,
      latestSeq: 42,
      snapshotVectorClock: { 'archived-device': 9 },
    }), { withoutMergeRemoteClock: true });

    const status = await h.client.sync();

    expect(status).toMatchObject({ kind: 'error', reason: 'unexpected' });
    expect(h.cursor.value).toBe(0);
    expect(h.mergedClocks).toEqual([]);
  });
});

describe('同步客户端 — 上传与游标', () => {
  it('🔴 上传响应 gapDetected 时先持久化 incomplete-history，再提交游标', async () => {
    const h = makeHarness(
      (url, init) => init?.method === 'POST'
        ? okJson({
            results: [{ opId: 'op-1', accepted: true, serverSeq: 3 }],
            latestSeq: 3,
            gapDetected: true,
          })
        : okJson({ ops: [], hasMore: false, latestSeq: 3 }),
      { ops: [makeOp()] },
    );

    const status = await h.client.sync();

    expect(status.kind).toBe('synced');
    expect(h.historyIncomplete.value).toBe(1);
    expect(h.cursor.value).toBe(3);
    expect(h.events.indexOf('mark-history-incomplete')).toBeLessThan(
      h.events.findIndex((event) => event.startsWith('cursor:')),
    );
  });

  it('🔴 上传响应 gapDetected 时 durable marker 失败就不推进游标', async () => {
    const h = makeHarness(
      (_url, init) => init?.method === 'POST'
        ? okJson({
            results: [{ opId: 'op-1', accepted: true, serverSeq: 3 }],
            latestSeq: 3,
            gapDetected: true,
          })
        : okJson({ ops: [], hasMore: false, latestSeq: 3 }),
      { ops: [makeOp()], failHistoryMarker: true },
    );

    const status = await h.client.sync();

    expect(status).toMatchObject({ kind: 'error', reason: 'unexpected' });
    expect(h.historyIncomplete.value).toBe(1);
    expect(h.cursor.value).toBe(0);
  });

  it('上传成功后标记 op 已同步（否则下次会重传）', async () => {
    const h = makeHarness(
      () =>
        okJson({
          results: [{ opId: 'op-1', accepted: true, serverSeq: 42 }],
          latestSeq: 42,
        }),
      { ops: [makeOp()] },
    );
    const status = await h.client.sync();

    expect(status.kind).toBe('synced');
    expect(h.marked).toHaveLength(1);
    expect(h.marked[0]!.get('op-1')).toBe(42);
  });

  it('🔴 一批里有永久拒绝时：已接受的落盘、被拒的**移出队列**、且**下载照常**', async () => {
    // 现场：一台设备的队列里混进了一条 clientId 不属于本机的 op。
    // 服务端逐条判定，接受 op-1、拒绝 op-2 —— 而响应整体是 HTTP 200。
    //
    // 🔴 这条用例是**改写过的**。它原来断言的是「抛错 + 文案里点明同批接受了几条」，
    // 而那个"抛错"本身就是缺陷：抛出点在 `download()` **之前**，于是
    // **一条永远传不上去的 op 就让这台设备再也拉不到任何远端数据**
    // （实测：连续两次同步都是 error、待上传数恒为 1、设备再没下载过东西）。
    // 所以判据从"错误文案好不好看"改成了三条实质行为：
    //   ① 已接受的照旧落盘；② 被拒的进 `rejected`（而不是 `uploaded`）；
    //   ③ **下载仍然执行** —— 这一条才是"设备不会变聋"的正面证据。
    const h = makeHarness(
      (url) =>
        url.includes('/ops')
          ? okJson({
              results: [
                { opId: 'op-1', accepted: true, serverSeq: 42 },
                {
                  opId: 'op-2',
                  accepted: false,
                  errorCode: 'INVALID_CLIENT_ID',
                  error: 'Operation clientId does not match request clientId',
                },
              ],
              latestSeq: 42,
            })
          : okJson({ ops: [], latestSeq: 42, hasMore: false }),
      { ops: [makeOp({ id: 'op-1' }), makeOp({ id: 'op-2' })] },
    );
    const status = await h.client.sync();

    // 被拒的那条仍必须让用户知道 —— 不要为了"看起来成功"把错误吞掉
    expect(status.kind).toBe('error');
    if (status.kind === 'error') {
      expect(status.reason).toBe('upload-rejected');
      // 永久拒绝：重试无意义，界面不该劝用户重试
      expect(status.retryable).toBe(false);
      // 要点名是哪一条，否则用户无从查起
      expect(status.message).toContain('op-2');
    }

    // 已被接受的那条**绝不能**留在待上传队列里
    expect(h.marked).toHaveLength(1);
    expect(h.marked[0]!.get('op-1')).toBe(42);
    // 被拒的那条**不许**被误标成已上传（标了就等于说"它在云上"，那是假话）
    expect(h.marked[0]!.has('op-2')).toBe(false);

    // 被拒的那条要**移出队列**，否则每次同步都会被重传并被拒
    expect(h.rejected).toEqual([['op-2']]);

    // 🔴 核心：上传出了被拒的事，**下载也必须跑过**。
    // 少了这一条，前面几条全绿也可能只是"把错误显示得更好看"。
    expect(h.downloads.length).toBeGreaterThan(0);

    // 🔴 游标不能推进：这条路径下面还有 piggyback 的 newOps 没被应用，
    // 先推进会跳过它们（那是真的丢数据，比"多下几次"严重得多）。
    //
    // ⚠️ 这里只在**搭车 op 整批解不开**时才要求不推进；本条没有搭车 op，
    // 所以 latestSeq 正常推进。真正不能推进的那条用例在下面（"整批都解不开"）。
    expect(h.cursor.value).toBe(42);
  });

  it('🔴 只是"暂时被挡"（限流）时：op **留在队列里**，且 retryable=true', async () => {
    // 与永久拒绝相反的一侧。两者都报 `upload-rejected`，但处置完全相反：
    // 限流等一会儿就好，把它也移出队列就等于**丢掉一条本来能上去的改动**。
    const h = makeHarness(
      (url) =>
        url.includes('/ops')
          ? okJson({
              results: [
                { opId: 'op-1', accepted: false, errorCode: 'RATE_LIMITED', error: 'slow down' },
              ],
              latestSeq: 3,
            })
          : okJson({ ops: [], latestSeq: 3, hasMore: false }),
      { ops: [makeOp({ id: 'op-1' })] },
    );
    const status = await h.client.sync();

    expect(status.kind).toBe('error');
    if (status.kind === 'error') {
      expect(status.reason).toBe('upload-rejected');
      expect(status.retryable).toBe(true);
    }
    // 关键：**没有**被移出队列 —— 下次同步还要重传它
    expect(h.rejected).toEqual([]);
    expect(h.marked).toEqual([]);
    // 下载同样必须跑（上传被挡不该影响拉取）
    expect(h.downloads.length).toBeGreaterThan(0);
  });

  it('🔴 未知错误码按"暂时"处理（判错方向要选"多试一次"而不是"丢掉"）', async () => {
    // 名单只收"重试无意义"的码。拿不准的留在暂时那一类：
    // 判成永久会丢一条本来能上去的改动，而"多试几次"已经不会再卡死设备了。
    const h = makeHarness(
      (url) =>
        url.includes('/ops')
          ? okJson({
              results: [
                { opId: 'op-1', accepted: false, errorCode: 'SOME_NEW_CODE', error: '?' },
              ],
              latestSeq: 3,
            })
          : okJson({ ops: [], latestSeq: 3, hasMore: false }),
      { ops: [makeOp({ id: 'op-1' })] },
    );
    await h.client.sync();
    expect(h.rejected).toEqual([]);
  });

  it('🔴 上传响应搭车回来的 op 里有一条解不开时，**不能拖垮整次同步**（下载必须照常执行）', async () => {
    /**
     * 现场（Android 模拟器 + 真实服务端）：手机上有 3 条待上传的 op，
     * 上传成功后服务端在**同一个响应**里搭车回了 14 条新 op，其中 2 条是
     * 换口令之前写下的（AES-GCM 认证失败）。这里原来是无保护的
     * `Promise.all(body.newOps.map((o) => decodeServerOp(o, password)))` ——
     * 一条抛错整次同步作废：
     *
     *   1. 抛在 `sync()` 的 **upload 阶段**，于是 `download()` 根本没执行，
     *      设备一条远端数据都没拉到（实测本地库里远端 op 数 = 0）；
     *   2. 界面只显示"同步失败"，而且被归成 `unexpected` + `retryable: true`，
     *      用户重试多少次都一样；
     *   3. `upload()` 在没有待上传 op 时**提前 return**（见该方法开头），
     *      所以拿干净数据库复现永远踩不到 —— 这正是它一直没被发现的原因。
     *
     * 这和 `download()` 里被 ADR-0016 修掉的那处是同一个形状。
     * 期望的契约：能读的应用、读不了的跳过并如实上报，且**下载照常执行**。
     */
    const good = await encrypt(JSON.stringify({ title: '搭车能读的' }), PASSWORD);
    const bad = await encrypt('{}', 'an-old-password');

    const poisonOp = (serverSeq: number) => ({
      serverSeq,
      receivedAt: serverSeq,
      op: {
        id: 'poison-piggy',
        clientId: 'other',
        actionType: 'CREATE_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'e-poison',
        payload: bad,
        vectorClock: { other: 1 },
        timestamp: 200,
        schemaVersion: 1,
        isPayloadEncrypted: true,
      },
    });

    const h = makeHarness(
      (_url, init) => {
        if (init?.method === 'POST') {
          return okJson({
            results: [{ opId: 'op-1', accepted: true, serverSeq: 40 }],
            latestSeq: 50,
            newOps: [
              {
                serverSeq: 45,
                receivedAt: 45,
                op: {
                  id: 'good-piggy',
                  clientId: 'other',
                  actionType: 'CREATE_TASK',
                  opType: 'CRT',
                  entityType: 'TASK',
                  entityId: 'e-good',
                  payload: good,
                  vectorClock: { other: 1 },
                  timestamp: 100,
                  schemaVersion: 1,
                  isPayloadEncrypted: true,
                },
              },
              poisonOp(46),
            ],
          });
        }
        return okJson({ ops: [], hasMore: false, latestSeq: 50 });
      },
      { ops: [makeOp()] },
    );

    const status = await h.client.sync();

    // 1. 🔴 关键判据：下载**真的执行了**。修之前整次同步死在 upload 阶段。
    expect(h.downloads.length).toBeGreaterThan(0);

    // 2. 搭车里能读的那条确实进了 op-log（不是"整批放弃"）
    const appliedIds = h.applied.flat().map((o) => o.id);
    expect(appliedIds).toContain('good-piggy');

    // 3. 上传本身仍然算成功：op-1 必须被标记，否则下次重传
    expect(h.marked).toHaveLength(1);
    expect(h.marked[0]!.get('op-1')).toBe(40);

    // 4. 有的解开、有的解不开 → 游标推进（否则永久卡在同一批上）
    expect(h.cursor.value).toBe(50);
    // The durable marker must be committed before the transport cursor crosses
    // the unreadable history. Otherwise a crash after this sync would make the
    // server-side repair path believe the prefix was complete.
    expect(h.historyIncomplete.value).toBe(1);
    expect(h.events.indexOf('mark-history-incomplete')).toBeGreaterThanOrEqual(0);
    expect(h.events.indexOf('mark-history-incomplete')).toBeLessThan(
      h.events.findIndex((event) => event.startsWith('cursor:')),
    );

    // 5. 状态结构化地点名读不了的那条，而不是报 synced / 报"未知错误"
    expect(status).toMatchObject({
      kind: 'error',
      reason: 'undecryptable-ops',
      retryable: false,
    });
    expect(status.kind === 'error' ? status.message : '').toContain('poison-piggy');
  });

  it('🔴 搭车 op 整批都解不开时不推进游标，把判断交给 download（口令不对只有一个策略）', async () => {
    // 整批解不开最常见的原因是口令打错。ADR-0016 规定这种情况**不许推进游标**，
    // 否则一次手滑就静默跳过大段历史。搭车路径同理，而且这里**不自己再判一次**：
    // 把游标留在原位，让紧随其后的 `download()` 用同一套策略给出正确区分
    //（"口令不对"还是"历史里混着别的口令"）。两套策略迟早会漂移。
    const bad = await encrypt('{}', 'an-old-password');
    const poison = (serverSeq: number) => ({
      serverSeq,
      receivedAt: serverSeq,
      op: {
        id: `poison-${String(serverSeq)}`,
        clientId: 'other',
        actionType: 'CREATE_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'e-poison',
        payload: bad,
        vectorClock: { other: 1 },
        timestamp: 200,
        schemaVersion: 1,
        isPayloadEncrypted: true,
      },
    });

    const h = makeHarness(
      (_url, init) =>
        init?.method === 'POST'
          ? okJson({
              results: [{ opId: 'op-1', accepted: true, serverSeq: 40 }],
              latestSeq: 50,
              newOps: [poison(45), poison(46)],
            })
          : okJson({ ops: [poison(45), poison(46)], hasMore: false, latestSeq: 50 }),
      { ops: [makeOp()] },
    );

    const status = await h.client.sync();

    // 游标停在原位 —— 这批 op 还看得见，没有被静默跳过
    expect(h.cursor.value).toBe(0);
    // 下载照常执行，并且给出的是 download() 那套"整页解不开"的**有分类**诊断。
    // ⚠️ 这里原来断言 `status.message` 含中文"口令"。那个契约被本次修复替换了：
    // 整页解不开现在归到 `'undecryptable-page'`，壳用**词条**渲染整句，
    // `message` 只作日志（因此必须是可机器定位、非中文的），不能再被当成用户文案。
    expect(h.downloads.length).toBeGreaterThan(0);
    expect(status).toMatchObject({
      kind: 'error',
      reason: 'undecryptable-page',
      retryable: false,
    });
    if (status.kind === 'error') {
      // 诊断可定位到具体 op，且**不混进中文**（否则英文界面会中英混排）
      expect(status.message).toContain('poison-45');
      expect(status.message ?? '').not.toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('🔴 搭车部分解密失败时没有 durable marker 就 fail-closed，不能跳过历史', async () => {
    const good = await encrypt(JSON.stringify({ title: '搭车能读的' }), PASSWORD);
    const bad = await encrypt('{}', 'an-old-password');
    const h = makeHarness(
      (_url, init) => init?.method === 'POST'
        ? okJson({
            results: [{ opId: 'op-1', accepted: true, serverSeq: 40 }],
            latestSeq: 50,
            newOps: [
              {
                serverSeq: 45,
                receivedAt: 45,
                op: {
                  id: 'good-piggy-without-marker',
                  clientId: 'other',
                  actionType: 'CREATE_TASK',
                  opType: 'CRT',
                  entityType: 'TASK',
                  entityId: 'e-good',
                  payload: good,
                  vectorClock: { other: 1 },
                  timestamp: 100,
                  schemaVersion: 1,
                  isPayloadEncrypted: true,
                },
              },
              {
                serverSeq: 46,
                receivedAt: 46,
                op: {
                  id: 'bad-piggy-without-marker',
                  clientId: 'other',
                  actionType: 'CREATE_TASK',
                  opType: 'CRT',
                  entityType: 'TASK',
                  entityId: 'e-bad',
                  payload: bad,
                  vectorClock: { other: 2 },
                  timestamp: 200,
                  schemaVersion: 1,
                  isPayloadEncrypted: true,
                },
              },
            ],
          })
        : okJson({ ops: [], hasMore: false, latestSeq: 50 }),
      { ops: [makeOp()], withoutHistoryMarker: true },
    );

    const status = await h.client.sync();

    expect(status).toMatchObject({ kind: 'error', reason: 'unexpected' });
    expect(h.applied.flat().map((op) => op.id)).toEqual(['good-piggy-without-marker']);
    expect(h.cursor.value).toBe(0);
  });

  it('🔴 游标用 latestSeq 推进，而不是最后一条 op 的 serverSeq', async () => {
    // 服务端说最新到 100，但只返回了 serverSeq 5 的 op（并发写入被过滤）
    const h = makeHarness(() =>
      okJson({
        ops: [
          {
            serverSeq: 5,
            receivedAt: 1,
            op: {
              id: 'r1',
              clientId: 'other',
              actionType: 'CREATE_TASK',
              opType: 'CRT',
              entityType: 'TASK',
              entityId: 'e1',
              payload: 'x',
              vectorClock: { other: 1 },
              timestamp: 1,
              schemaVersion: 1,
              isPayloadEncrypted: false,
            },
          },
        ],
        hasMore: false,
        latestSeq: 100,
      }),
    );
    await h.client.sync();

    // 用 serverSeq(5) 就落后了，下次会重复下载
    expect(h.cursor.value).toBe(100);
  });

  it('🔴 搭车返回还有下一页（hasMorePiggyback）时，游标只推进到最后一条搭车 op', async () => {
    /**
     * 复现（临时探针实测）：
     *   上传响应 latestSeq=600、newOps=seq 2..501、hasMorePiggyback=true
     *   → 旧实现把游标推到 600，紧跟的 download() 用 sinceSeq=600
     *   → 502..600 的 op 一次都没被拉取，**永久静默丢失**。
     *
     * 契约：hasMorePiggyback=true 时游标只能推进到**最后一条已应用的搭车 op**；
     * 剩下的交给紧跟其后的 `download()` 分页拉取。
     */
    const newOps = Array.from({ length: 500 }, (_, i) => ({
      serverSeq: 2 + i, // 2..501
      receivedAt: 1,
      op: {
        id: `p${String(2 + i)}`,
        clientId: 'other',
        actionType: 'CREATE_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: `e${String(2 + i)}`,
        payload: {},
        vectorClock: {},
        timestamp: 1,
        schemaVersion: 1,
        isPayloadEncrypted: false,
      },
    }));

    const h = makeHarness(
      (_url, init) => {
        if (init?.method === 'POST') {
          return okJson({
            results: [{ opId: 'op-1', accepted: true, serverSeq: 1 }],
            latestSeq: 600,
            newOps,
            hasMorePiggyback: true,
          });
        }
        return okJson({ ops: [], hasMore: false, latestSeq: 600 });
      },
      { ops: [makeOp()] },
    );

    await h.client.sync();

    expect(h.downloads.length).toBeGreaterThanOrEqual(1);
    // 搭车页只到 501 —— 用 600 会把 502..600 整段跳过
    expect(h.downloads[0]).toContain('sinceSeq=501');
    expect(h.downloads[0]).not.toContain('sinceSeq=600');
  });

  it('无本地 op 时不发上传请求（省一次往返）', async () => {
    const h = makeHarness(() => okJson({ ops: [], hasMore: false, latestSeq: 0 }), {
      ops: [],
    });
    await h.client.sync();
    expect(h.uploads).toHaveLength(0);
  });

  it('下载请求带上 excludeClient，避免拉回自己的 op', async () => {
    const h = makeHarness(() => okJson({ ops: [], hasMore: false, latestSeq: 0 }));
    await h.client.sync();

    expect(h.downloads).toHaveLength(1);
    expect(h.downloads[0]).toContain('excludeClient=device-a');
    expect(h.downloads[0]).toContain('sinceSeq=0');
  });
});

describe('同步客户端 — 下载与解密', () => {
  it('🔴 下载 gapDetected 时先持久化 incomplete-history，再提交游标', async () => {
    const h = makeHarness(() => okJson({
      ops: [],
      hasMore: false,
      latestSeq: 9,
      gapDetected: true,
    }));

    const status = await h.client.sync();

    expect(status.kind).toBe('synced');
    expect(h.historyIncomplete.value).toBe(1);
    expect(h.cursor.value).toBe(9);
    expect(h.events.indexOf('mark-history-incomplete')).toBeLessThan(
      h.events.findIndex((event) => event.startsWith('cursor:')),
    );
  });

  it('🔴 下载 gapDetected 时 durable marker 失败就不推进游标', async () => {
    const h = makeHarness(() => okJson({
      ops: [],
      hasMore: false,
      latestSeq: 9,
      gapDetected: true,
    }), { failHistoryMarker: true });

    const status = await h.client.sync();

    expect(status).toMatchObject({ kind: 'error', reason: 'unexpected' });
    expect(h.historyIncomplete.value).toBe(1);
    expect(h.cursor.value).toBe(0);
  });

  it('下载的加密 op 被解密后交给 op-log', async () => {
    const cipher = await encrypt(JSON.stringify({ title: '远端任务' }), PASSWORD);
    const h = makeHarness(() =>
      okJson({
        ops: [
          {
            serverSeq: 1,
            receivedAt: 1,
            op: {
              id: 'r1',
              clientId: 'other',
              actionType: 'CREATE_TASK',
              opType: 'CRT',
              entityType: 'TASK',
              entityId: 'e1',
              payload: cipher,
              vectorClock: { other: 1 },
              timestamp: 5000,
              schemaVersion: 1,
              isPayloadEncrypted: true,
            },
          },
        ],
        hasMore: false,
        latestSeq: 1,
      }),
    );
    await h.client.sync();

    expect(h.applied).toHaveLength(1);
    // 交给 op-log 的必须是**明文 payload**，不是密文
    expect(h.applied[0]![0]!.payload).toEqual({ title: '远端任务' });
  });

  it('🔴 解密失败必须报错，不能静默丢弃（丢弃 = 用户数据凭空消失）', async () => {
    const h = makeHarness(async () =>
      okJson({
        ops: [
          {
            serverSeq: 1,
            receivedAt: 1,
            op: {
              id: 'bad',
              clientId: 'other',
              actionType: 'CREATE_TASK',
              opType: 'CRT',
              entityType: 'TASK',
              entityId: 'e1',
              // 用另一个口令加密 → 用当前口令解不开
              payload: await encrypt('{}', 'a-different-password'),
              vectorClock: { other: 1 },
              timestamp: 1,
              schemaVersion: 1,
              isPayloadEncrypted: true,
            },
          },
        ],
        hasMore: false,
        latestSeq: 1,
      }),
    );
    const status = await h.client.sync();

    expect(status.kind).toBe('error');
    expect(h.applied).toHaveLength(0);
  });

  it('🔴 整页一条都解不开时**不推进游标**（口令打错绝不能静默跳过整段历史）', async () => {
    // 这一条是上一条的另一半：拒绝整页之后，游标必须**原地不动**。
    // 如果这里推进了，一次口令手滑 = 用户的历史被永久跳过。
    const h = makeHarness(() =>
      okJson({
        ops: [
          {
            serverSeq: 1,
            receivedAt: 1,
            op: {
              id: 'bad',
              clientId: 'other',
              actionType: 'CREATE_TASK',
              opType: 'CRT',
              entityType: 'TASK',
              payload: 'not-even-valid-ciphertext',
              vectorClock: { other: 1 },
              timestamp: 1,
              schemaVersion: 1,
              isPayloadEncrypted: true,
            },
          },
        ],
        hasMore: false,
        latestSeq: 77,
      }),
    );
    const status = await h.client.sync();

    expect(status.kind).toBe('error');
    expect(h.cursor.value).toBe(0);
  });

  it('🔴 混着"解得开"和"解不开"时：能读的应用、读不了的跳过，并如实上报', async () => {
    /**
     * 实测场景（真实服务端 + 真机模拟器）：
     * 服务端上混着两条**另一个口令**写下的 op。原来的实现是
     * `Promise.all(ops.map(decodeServerOp))` —— 一条抛错整页作废，
     * 而且抛在 `setLastServerSeq` 之前，于是**游标永远不推进**、
     * 每次同步都在同一个位点再撞一次，设备**永久**同步不了。
     *
     * 这里的期望就是修复后的契约：
     *   1. 好的那条**真的被应用**（不是"整页放弃"）；
     *   2. 坏的那些**被跳过**（重试也不会变好）；
     *   3. 游标**推进**（否则还是永久卡死）；
     *   4. 状态**不是 `synced`** —— 报"已是最新"等于无声的数据丢失。
     */
    const good = await encrypt(JSON.stringify({ title: '能读的' }), PASSWORD);
    const bad = await encrypt('{}', 'an-old-password');
    const h = makeHarness(() =>
      okJson({
        ops: [
          {
            serverSeq: 1,
            receivedAt: 1,
            op: {
              id: 'good',
              clientId: 'other',
              actionType: 'CREATE_TASK',
              opType: 'CRT',
              entityType: 'TASK',
              entityId: 'e1',
              payload: good,
              vectorClock: { other: 1 },
              timestamp: 100,
              schemaVersion: 1,
              isPayloadEncrypted: true,
            },
          },
          {
            serverSeq: 2,
            receivedAt: 2,
            op: {
              id: 'poison',
              clientId: 'other',
              actionType: 'CREATE_TASK',
              opType: 'CRT',
              entityType: 'TASK',
              entityId: 'e2',
              // 另一个口令写的 → 用当前口令解不开（AES-GCM 认证失败）
              payload: bad,
              vectorClock: { other: 1 },
              timestamp: 200,
              schemaVersion: 1,
              isPayloadEncrypted: true,
            },
          },
        ],
        hasMore: false,
        latestSeq: 2,
      }),
    );
    const status = await h.client.sync();

    // 1. 能读的那条确实进了 op-log（payload 是明文）
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0]!.map((o) => o.id)).toEqual(['good']);

    // 2. 游标推进 —— 否则下次同步再撞同一条，永久卡死
    expect(h.cursor.value).toBe(2);
    expect(h.historyIncomplete.value).toBe(1);
    expect(h.events.indexOf('mark-history-incomplete')).toBeLessThan(
      h.events.findIndex((event) => event.startsWith('cursor:')),
    );

    // 3. 状态结构化地说明"有东西没读进来"，而不是报 synced
    expect(status).toMatchObject({
      kind: 'error',
      reason: 'undecryptable-ops',
      retryable: false,
    });
    // 诊断信息要**可定位**到具体是哪条 op
    expect(status.kind === 'error' ? status.message : '').toContain('poison');
  });

  it('🔴 下载部分解密失败时，持久化 incomplete-history 失败就不推进游标', async () => {
    const good = await encrypt(JSON.stringify({ title: '能读的' }), PASSWORD);
    const bad = await encrypt('{}', 'an-old-password');
    const h = makeHarness(
      () => okJson({
        ops: [
          {
            serverSeq: 1,
            receivedAt: 1,
            op: {
              id: 'good-before-marker-failure',
              clientId: 'other',
              actionType: 'CREATE_TASK',
              opType: 'CRT',
              entityType: 'TASK',
              entityId: 'e-good',
              payload: good,
              vectorClock: { other: 1 },
              timestamp: 100,
              schemaVersion: 1,
              isPayloadEncrypted: true,
            },
          },
          {
            serverSeq: 2,
            receivedAt: 2,
            op: {
              id: 'bad-before-marker-failure',
              clientId: 'other',
              actionType: 'CREATE_TASK',
              opType: 'CRT',
              entityType: 'TASK',
              entityId: 'e-bad',
              payload: bad,
              vectorClock: { other: 2 },
              timestamp: 200,
              schemaVersion: 1,
              isPayloadEncrypted: true,
            },
          },
        ],
        hasMore: false,
        latestSeq: 2,
      }),
      { failHistoryMarker: true },
    );

    const status = await h.client.sync();

    expect(status).toMatchObject({ kind: 'error', reason: 'unexpected' });
    expect(h.historyIncomplete.value).toBe(1);
    expect(h.applied.flat().map((op) => op.id)).toEqual(['good-before-marker-failure']);
    expect(h.cursor.value).toBe(0);
    expect(h.events).not.toContain('cursor:2');
  });

  it('🔴 下载部分解密失败时没有 durable marker 就 fail-closed，不能跳过历史', async () => {
    const good = await encrypt(JSON.stringify({ title: '能读的' }), PASSWORD);
    const bad = await encrypt('{}', 'an-old-password');
    const h = makeHarness(
      () => okJson({
        ops: [
          {
            serverSeq: 1,
            receivedAt: 1,
            op: {
              id: 'good-without-marker',
              clientId: 'other',
              actionType: 'CREATE_TASK',
              opType: 'CRT',
              entityType: 'TASK',
              entityId: 'e-good',
              payload: good,
              vectorClock: { other: 1 },
              timestamp: 100,
              schemaVersion: 1,
              isPayloadEncrypted: true,
            },
          },
          {
            serverSeq: 2,
            receivedAt: 2,
            op: {
              id: 'bad-without-marker',
              clientId: 'other',
              actionType: 'CREATE_TASK',
              opType: 'CRT',
              entityType: 'TASK',
              entityId: 'e-bad',
              payload: bad,
              vectorClock: { other: 2 },
              timestamp: 200,
              schemaVersion: 1,
              isPayloadEncrypted: true,
            },
          },
        ],
        hasMore: false,
        latestSeq: 2,
      }),
      { withoutHistoryMarker: true },
    );

    const status = await h.client.sync();

    expect(status).toMatchObject({ kind: 'error', reason: 'unexpected' });
    expect(h.applied.flat().map((op) => op.id)).toEqual(['good-without-marker']);
    expect(h.cursor.value).toBe(0);
  });

  it('解不开的计数是每次同步现算的，不会跨次累积', async () => {
    // 否则一旦出现过一次解不开的 op，界面会永远挂着那句提示。
    const good = await encrypt(JSON.stringify({ title: 'ok' }), PASSWORD);
    const bad = await encrypt('{}', 'an-old-password');
    let page = 0;
    const h = makeHarness(() => {
      page += 1;
      if (page === 1) {
        return okJson({
          ops: [
            {
              serverSeq: 1,
              receivedAt: 1,
              op: {
                id: 'good-1',
                clientId: 'other',
                actionType: 'CREATE_TASK',
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'e1',
                payload: good,
                vectorClock: {},
                timestamp: 1,
                schemaVersion: 1,
                isPayloadEncrypted: true,
              },
            },
            {
              serverSeq: 2,
              receivedAt: 2,
              op: {
                id: 'poison',
                clientId: 'other',
                actionType: 'CREATE_TASK',
                opType: 'CRT',
                entityType: 'TASK',
                entityId: 'e2',
                payload: bad,
                vectorClock: {},
                timestamp: 2,
                schemaVersion: 1,
                isPayloadEncrypted: true,
              },
            },
          ],
          hasMore: false,
          latestSeq: 2,
        });
      }
      // 第二次同步：服务端已经没有任何解不开的东西
      return okJson({ ops: [], hasMore: false, latestSeq: 2 });
    });

    const first = await h.client.sync();
    expect(first.kind).toBe('error');

    const second = await h.client.sync();
    expect(second.kind).toBe('synced');
  });

  it('标记为加密但 payload 不是字符串时明确报错', async () => {
    const h = makeHarness(() =>
      okJson({
        ops: [
          {
            serverSeq: 1,
            receivedAt: 1,
            op: {
              id: 'bad2',
              clientId: 'other',
              actionType: 'x',
              opType: 'CRT',
              entityType: 'TASK',
              payload: { title: '明文对象' },
              vectorClock: {},
              timestamp: 1,
              schemaVersion: 1,
              isPayloadEncrypted: true,
            },
          },
        ],
        hasMore: false,
        latestSeq: 1,
      }),
    );
    const status = await h.client.sync();
    expect(status.kind).toBe('error');
  });

  it('🔴 hasMore=true 时游标只推进到本页最后一条 op，不能跳到 latestSeq（否则中间整段永久跳过）', async () => {
    /**
     * 复现（临时探针实测）：
     *   第 1 页 seq 4..203、hasMore=true、latestSeq=600
     *   → 旧实现把游标推到 600，第 2 次下载的 sinceSeq 变成了 600
     *   → 204..600 的 op 一次都没被拉取，**永久静默丢失**。
     *
     * 契约：hasMore=true 时游标只能推进到**本页已消费的最后一条 op**；
     * 只有最后一页（hasMore=false）才允许用 latestSeq
     * —— 见上面那条「游标用 latestSeq 推进」，它约束的是最后一页。
     */
    const ops = Array.from({ length: 200 }, (_, i) => ({
      serverSeq: 4 + i, // 4..203
      receivedAt: 1,
      op: {
        id: `r${String(4 + i)}`,
        clientId: 'other',
        actionType: 'CREATE_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: `e${String(4 + i)}`,
        payload: {},
        vectorClock: {},
        timestamp: 1,
        schemaVersion: 1,
        isPayloadEncrypted: false,
      },
    }));

    let page = 0;
    const h = makeHarness(() => {
      page += 1;
      if (page === 1) return okJson({ ops, hasMore: true, latestSeq: 600 });
      return okJson({ ops: [], hasMore: false, latestSeq: 600 });
    });

    await h.client.sync();

    expect(h.downloads.length).toBeGreaterThanOrEqual(2);
    // 第 2 次必须从 203 继续，而不是从 600 —— 600 会把 204..600 整段跳过
    expect(h.downloads[1]).toContain('sinceSeq=203');
    expect(h.downloads[1]).not.toContain('sinceSeq=600');
  });

  it('hasMore 为真且有空页时终止（避免死循环）', async () => {
    let calls = 0;
    const h = makeHarness(() => {
      calls += 1;
      // 一直说还有更多，但永远返回空页 —— 没有终止条件就会无限循环
      return okJson({ ops: [], hasMore: true, latestSeq: 5 });
    });
    await h.client.sync();
    expect(calls).toBe(1);
  });
});

describe('同步客户端 — 离线与错误区分', () => {
  it('网络错误 → offline（不是 error），因为要重试', async () => {
    const h = makeHarness(() => {
      throw new TypeError('Failed to fetch');
    });
    const status = await h.client.sync();
    expect(status.kind).toBe('offline');
  });

  it('服务端 4xx → error（重试不会成功）', async () => {
    const h = makeHarness(() => new Response('{"error":"E2EE_REQUIRED"}', { status: 400 }));
    const status = await h.client.sync();

    expect(status.kind).toBe('error');
    // 错误信息必须带上服务端给的原因，否则没法排查
    if (status.kind === 'error') expect(status.message).toContain('400');
  });

  /**
   * 🔴 401 必须**单独成类**，不能落进 `'unexpected'` + `retryable: true`。
   *
   * 那条通道的后果是实测推出来的（不是推测）：`createRetryScheduler` 见
   * `retryable: true` 就继续退避重试（上限 60s），于是**拿着一个已作废的令牌
   * 永远打一个永远不可能成功的请求**，界面上是一句分不清和网络抖动区别的
   * "同步失败"。而"作废"是这里的常态 —— 在别的设备点「登出所有设备」之后，
   * 这一台的令牌当场失效。
   *
   * 所以这句必须说"重新登录"，而且必须**停下**。
   */
  it('401 → reason `unauthorized` 且 retryable: false（不是"稍后重试"）', async () => {
    for (const status of [401, 403]) {
      const h = makeHarness(
        () => new Response('{"error":"Missing or invalid Authorization header"}', { status }),
      );
      const result = await h.client.sync();
      expect(result.kind, String(status)).toBe('error');
      if (result.kind === 'error') {
        expect(result.reason, String(status)).toBe('unauthorized');
        expect(result.retryable, String(status)).toBe(false);
      }
    }
  });

  it('401 不判成 offline（分类顺序：状态码先于 message 正则）', async () => {
    // 服务端在 401 的 error 文案里写 "network" 是有可能的；
    // 那不该把"令牌作废"读成"这台设备没网"。
    const h = makeHarness(
      () => new Response('{"error":"token rejected by network policy"}', { status: 401 }),
    );
    const status = await h.client.sync();
    expect(status.kind).toBe('error');
    if (status.kind === 'error') expect(status.reason).toBe('unauthorized');
  });

  it('🔴 下载段的 401 也算 —— 只有上传段会 401 是不完整的判定', async () => {
    // 上传 200、下载 401：真实形态是令牌在两次请求之间失效（另一台设备改了口令）。
    const h = makeHarness((url) =>
      url.includes('sinceSeq')
        ? new Response('{"error":"Missing or invalid Authorization header"}', { status: 401 })
        : okJson({ results: [] }),
    );
    const status = await h.client.sync();
    expect(status.kind).toBe('error');
    if (status.kind === 'error') expect(status.reason).toBe('unauthorized');
  });

  it('5xx 仍然可重试（不许把"服务端挂了"说成"请你重新登录"）', async () => {
    const h = makeHarness(() => new Response('{"error":"boom"}', { status: 503 }));
    const status = await h.client.sync();
    expect(status.kind).toBe('error');
    if (status.kind === 'error') {
      expect(status.reason).not.toBe('unauthorized');
      expect(status.retryable).toBe(true);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // 🔴 平台策略拦截 ≠ 离线。
  //
  // 原来的判据是 /failed to fetch|network|offline|ECONNREFUSED/i，
  // 里面的裸 `network` 会命中 Android 的
  //   "CLEARTEXT communication to 10.0.2.2 not permitted by network security policy"
  // 于是"系统不允许明文 HTTP"被报成「当前离线」。实测就是这个现象：
  // 服务端 curl 正常、应用坚称离线，排查方向被带偏。
  // ────────────────────────────────────────────────────────────────────────
  it('Android 明文策略拦截 → error，不是 offline', async () => {
    const h = makeHarness(() => {
      throw new TypeError(
        'CLEARTEXT communication to 10.0.2.2 not permitted by network security policy',
      );
    });
    const status = await h.client.sync();

    expect(status.kind).toBe('error');
    // 原因必须原样透出，否则用户无法从「当前离线」看出真实问题
    if (status.kind === 'error') expect(status.message).toMatch(/cleartext/i);
  });

  it('iOS ATS 拦截 → error，不是 offline', () => {
    expect(
      isNetworkError(
        new TypeError(
          'The resource could not be loaded because the App Transport Security policy requires the use of a secure connection.',
        ),
      ),
    ).toBe(false);
  });

  it('分类器：策略拦截优先于 TypeError 分支（顺序不能换）', () => {
    // 两者都是 TypeError；差别只在消息。先判 TypeError 就会把它归成离线。
    expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkError(new TypeError('CLEARTEXT communication to x not permitted'))).toBe(false);
  });

  it('分类器：真离线仍然判离线', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkError(new Error('ECONNREFUSED 127.0.0.1:3000'))).toBe(true);
    expect(isNetworkError(new Error('device is offline'))).toBe(true);
  });

  it('分类器：不含网络语义的服务端错误不算离线', () => {
    // 裸 `network` 的另一个坑：服务端错误文案里出现这个词就会被误判成离线而白白重试
    expect(isNetworkError(new Error('同步请求失败：HTTP 500 — network overloaded'))).toBe(false);
    expect(isNetworkError(new Error('同步请求失败：HTTP 401 — token expired'))).toBe(false);
    expect(isNetworkError(new Error('payload is not encrypted'))).toBe(false);
  });

  it('未登录时不发请求', async () => {
    const uploads: string[] = [];
    const client = new SyncClient({
      baseUrl: BASE,
      clientId: 'device-a',
      getToken: async () => undefined,
      getPassword: async () => PASSWORD,
      getLastServerSeq: async () => 0,
      setLastServerSeq: async () => undefined,
      getLocalOps: async () => [makeOp()],
      markUploaded: async () => undefined,
      applyRemote: async () => undefined,
      redispatch: async () => undefined,
      discardLocal: async () => undefined,
      markRejected: async () => undefined,
      getOpsForEntity: async () => [],
      getOpById: async () => undefined,
      redispatchPayload: async () => undefined,
      fetchImpl: (async (input: string | URL | Request) => {
        uploads.push(String(input));
        return okJson({});
      }) as unknown as typeof fetch,
    });

    const status = await client.sync();
    expect(status.kind).toBe('error');
    // 🔴 断言**结构化原因**，不只是 `kind`：壳靠它取词条，
    // 而这个字段以前没有任何测试钉着 —— 改错了不会有测试红。
    expect(status).toMatchObject({ kind: 'error', reason: 'not-signed-in' });
    expect(uploads).toHaveLength(0);
  });

  it('🔴 有 token 但没设加密口令时：明确失败，且一条 op 都不上传', async () => {
    // 🔴 这条是"绝不降级成明文"的最后一道闸。服务端本来也会 400 E2EE_REQUIRED，
    // 但更糟的是"看起来同步成功" —— 所以必须在**本地**就停下，
    // 而且要给壳一个能说清原因的结构化 `reason`（不是一句笼统的"同步失败"）。
    const h = makeHarness(() => okJson({}), { password: undefined, ops: [makeOp()] });
    const status = await h.client.sync();

    expect(status).toMatchObject({ kind: 'error', reason: 'no-encryption-password' });
    expect(h.uploads).toHaveLength(0);
  });

  it('口令是空串也当作没设（空串不是"没有口令"的合法表达）', async () => {
    const h = makeHarness(() => okJson({}), { password: '', ops: [makeOp()] });
    const status = await h.client.sync();

    expect(status).toMatchObject({ kind: 'error', reason: 'no-encryption-password' });
    expect(h.uploads).toHaveLength(0);
  });
});

describe('离线重试调度', () => {
  it('同步成功后停止重试', async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(async (): Promise<SyncStatus> => ({ kind: 'synced', at: 1 }));
      const s = createRetryScheduler(run, { baseDelayMs: 10 });
      s.start();

      await vi.advanceTimersByTimeAsync(100);
      // 成功一次即停止，不再继续调度
      expect(run).toHaveBeenCalledTimes(1);
      s.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('不可重试的错误停止重试（省配额）', async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(
        async (): Promise<SyncStatus> => ({
          kind: 'error',
          reason: 'not-signed-in',
          retryable: false,
        }),
      );
      const s = createRetryScheduler(run, { baseDelayMs: 10 });
      s.start();

      await vi.advanceTimersByTimeAsync(500);
      expect(run).toHaveBeenCalledTimes(1);
      s.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('离线时持续重试并退避', async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(async (): Promise<SyncStatus> => ({ kind: 'offline', since: 1 }));
      const s = createRetryScheduler(run, { baseDelayMs: 10, maxDelayMs: 50 });
      s.start();

      await vi.advanceTimersByTimeAsync(1000);
      // 应重试多次
      expect(run.mock.calls.length).toBeGreaterThan(1);
      s.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});


describe('vault production sync wiring', () => {
  it('reports key-provider failures as locked without a rejected promise or network write', async () => {
    const h = makeHarness(() => okJson({}), { ops: [makeOp()], getPayloadCipher: async () => { throw new Error('secure-store unavailable'); } });
    expect(await h.client.sync()).toMatchObject({ kind: 'error', reason: 'no-encryption-password' });
    expect(h.uploads).toHaveLength(0);
    expect(h.downloads).toHaveLength(0);
  });

  it('refuses a configured but locked vault even with a legacy password present', async () => {
    const h = makeHarness(() => okJson({}), {
      ops: [makeOp()], getPayloadCipher: async () => undefined,
    });
    expect(await h.client.sync()).toMatchObject({ kind: 'error', reason: 'no-encryption-password' });
    expect(h.uploads).toHaveLength(0);
    expect(h.downloads).toHaveLength(0);
  });

  it('uploads and downloads through the captured vault session with no password', async () => {
    const codec = createVaultPayloadCipher({ current: { keyVersion: 1, rootKey: new Uint8Array(32).fill(13) } });
    const local = makeOp();
    const remote = makeOp({ id: 'remote-op', clientId: 'device-b', entityId: 'remote-task', vectorClock: { 'device-b': 1 } });
    const remoteCipher = await codec.encrypt(JSON.stringify(remote.payload), remote);
    const getCipher = vi.fn(async () => codec);
    const h = makeHarness((_url, init) => init?.method === 'POST'
      ? okJson({ results: [{ opId: local.id, accepted: true, serverSeq: 1 }], latestSeq: 1 })
      : okJson({ ops: [{ serverSeq: 2, receivedAt: 1000, op: { ...remote, payload: remoteCipher, isPayloadEncrypted: true } }], latestSeq: 2, hasMore: false }),
      { password: undefined, ops: [local], getPayloadCipher: getCipher });
    expect(await h.client.sync()).toMatchObject({ kind: 'synced' });
    expect(getCipher).toHaveBeenCalledTimes(1);
    const sent = (h.uploads[0]!.body['ops'] as Array<Record<string, unknown>>)[0]!;
    expect(await codec.decrypt(sent['payload'] as string, local)).toBe(JSON.stringify(local.payload));
    expect(h.applied.flat().map((op) => op.payload)).toContainEqual(remote.payload);
    expect(h.cursor.value).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// §2.1 的硬顺序：服务端词表落后于客户端（W2 判据 ②）
//
// 加一个新实体时，"老服务端 + 新客户端"是**一定会出现**的组合（自托管部署者
// 天然落后）。这条组合下服务端回 `INVALID_ENTITY_TYPE`，客户端把它算永久拒绝 ——
// 数据不会丢（还在本机），但**必须说得出下一步动作是"升级服务端"**。
//
// 🔴 两条用例是一对：第二条是阴性对照。如果那句提示挂在任何永久拒绝上，
// 用户就会拿着一枚作废的 clientId 去升级服务器 —— 那比不提示更糟。
// ─────────────────────────────────────────────────────────────────────────
describe('§2.1 服务端词表落后于客户端', () => {
  const rejectedUpload = (errorCode: string, error: string) =>
    makeHarness(
      (url) =>
        url.includes('/ops')
          ? okJson({
              results: [{ opId: 'op-1', accepted: false, errorCode, error }],
              latestSeq: 0,
            })
          : okJson({ ops: [], latestSeq: 0, hasMore: false }),
      { ops: [makeOp({ entityType: 'EVENT', entityId: 'e1', payload: { title: '结婚纪念日', date: '2020-05-01' } })] },
    );

  it('INVALID_ENTITY_TYPE：报永久拒绝，且说得出"升级服务端"与"数据仍在本地"', async () => {
    const h = rejectedUpload('INVALID_ENTITY_TYPE', 'Invalid entityType: EVENT');
    const status = await h.client.sync();

    expect(status.kind).toBe('error');
    if (status.kind !== 'error') return;
    expect(status.reason).toBe('upload-rejected');
    expect(status.retryable).toBe(false);
    expect(status.message).toContain('不认识它的实体类型');
    expect(status.message).toContain('请先升级服务端');
    expect(status.message).toContain('仍完整保存在本机');
    // 数据没上云 ⇒ 不许标成已上传，必须走 markRejected
    expect(h.marked).toHaveLength(0);
    expect(h.rejected.flat()).toEqual(['op-1']);
  });

  it('阴性对照：INVALID_CLIENT_ID 不许被套上同一句"升级服务端"', async () => {
    const h = rejectedUpload('INVALID_CLIENT_ID', 'Operation clientId does not match request clientId');
    const status = await h.client.sync();

    expect(status.kind).toBe('error');
    if (status.kind !== 'error') return;
    expect(status.reason).toBe('upload-rejected');
    expect(status.message).toContain('INVALID_CLIENT_ID');
    expect(status.message).not.toContain('升级服务端');
  });
});
