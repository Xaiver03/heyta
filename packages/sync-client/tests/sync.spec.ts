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

import { SyncClient, createRetryScheduler, type SyncStatus } from '../src/client.js';

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
  applied: Operation<string>[][];
  cursor: { value: number };
}

function makeHarness(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  opts: { password?: string | undefined; ops?: Operation<string>[] } = {},
): Harness {
  const uploads: Harness['uploads'] = [];
  const downloads: string[] = [];
  const marked: Harness['marked'] = [];
  const applied: Harness['applied'] = [];
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
    getLastServerSeq: async () => cursor.value,
    setLastServerSeq: async (s) => {
      cursor.value = s;
    },
    getLocalOps: async () => opts.ops ?? [],
    markUploaded: async (m) => {
      marked.push(m);
    },
    applyRemote: async (ops) => {
      applied.push(ops);
    },
    redispatch: async () => undefined,
    discardLocal: async () => undefined,
    getOpsForEntity: async () => [],
    getOpById: async () => undefined,
    redispatchPayload: async () => undefined,
    fetchImpl,
  });

  return { client, uploads, downloads, marked, applied, cursor };
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

describe('同步客户端 — 上传与游标', () => {
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
    expect(uploads).toHaveLength(0);
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
          message: '未登录',
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
