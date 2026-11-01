/**
 * ADR-0080 S4：账号是**明文模式**（readable）时客户端的写/读行为。
 *
 * 三条判据，每一条都是"错了会静默丢数据"的那一类：
 *   ① 上传必须写 `isPayloadEncrypted: false` 与**明文 JSON**，而不是先加密再让服务端 400；
 *   ② 明文模式读到密文行必须**报错**，不能静默跳过（那等于悄悄丢掉历史）；
 *   ③ 明文模式**不需要**任何钥匙 —— 但它也不是"没钥匙时的降级"。
 */

import { describe, expect, it } from 'vitest';

import type { Operation } from '@heyta/sync-core';
import { OpType } from '@heyta/sync-core';

import { SyncClient, type SyncStatus } from '../src/client.js';

const BASE = 'http://127.0.0.1:3000';

const localOp = (): Operation<string> => ({
  id: 'op-1',
  clientId: 'device-a',
  actionType: 'CREATE_TASK',
  opType: OpType.Create,
  entityType: 'TASK',
  entityId: 't1',
  payload: { title: '买牛奶' },
  vectorClock: { 'device-a': 1 },
  timestamp: 1000,
  schemaVersion: 1,
}) as Operation<string>;

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

interface Harness {
  client: SyncClient;
  uploads: Array<Record<string, unknown>>;
  applied: Operation<string>[][];
}

function makePlainClient(
  handler: (url: string, init?: RequestInit) => Response,
  ops: Operation<string>[] = [localOp()],
): Harness {
  const uploads: Harness['uploads'] = [];
  const applied: Harness['applied'] = [];
  let cursor = 0;

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      uploads.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    }
    return handler(url, init);
  }) as unknown as typeof fetch;

  const client = new SyncClient({
    baseUrl: BASE,
    clientId: 'device-a',
    // 🔴 关键：明文模式 —— 没有 getPassword 的实际使用，也没有 payload cipher。
    encryptionMode: 'plain',
    getToken: async () => 'test-token',
    fetchImpl,
    getPassword: async () => undefined,
    getLastServerSeq: async () => cursor,
    setLastServerSeq: async (seq) => { cursor = seq; },
    getLocalOps: async () => ops,
    markUploaded: async () => {},
    applyRemote: async (remote) => { applied.push(remote); },
    redispatch: async () => {},
    discardLocal: async () => {},
    markRejected: async () => {},
    redispatchPayload: async () => {},
    getOpsForEntity: async () => [],
    getOpById: async (id) => ops.find((op) => op.id === id),
  });

  return { client, uploads, applied };
}

describe('明文模式的写侧（ADR-0080 S4）', () => {
  it('上传的是明文 JSON，且显式标记 isPayloadEncrypted: false', async () => {
    const { client, uploads } = makePlainClient((url) =>
      url.includes('/ops') && url.includes('upload')
        ? okJson({ results: [{ opId: 'op-1', accepted: true, serverSeq: 1 }], latestSeq: 1 })
        : okJson({ ops: [], hasMore: false, latestSeq: 1, serverTime: Date.now() }),
    );

    await client.sync();

    expect(uploads).toHaveLength(1);
    const wireOps = uploads[0]!.ops as Array<Record<string, unknown>>;
    expect(wireOps).toHaveLength(1);
    // 明文就是明文 —— 不是"把明文 base64 一下冒充密文"。
    expect(wireOps[0]!.payload).toBe(JSON.stringify({ title: '买牛奶' }));
    expect(wireOps[0]!.isPayloadEncrypted).toBe(false);
  });

  it('明文模式不需要钥匙：没有 getPayloadCipher 也能同步', async () => {
    const { client } = makePlainClient(() =>
      okJson({ ops: [], hasMore: false, latestSeq: 0, serverTime: Date.now() }),
    );

    const status: SyncStatus = await client.sync();

    // `no-encryption-password` 是"加密账号但没解锁"，明文账号不该落到那一档。
    expect(status.kind === 'error' && status.reason === 'no-encryption-password').toBe(false);
  });
});

describe('明文模式的读侧（ADR-0080 S4）', () => {
  it('读到密文行 ⇒ 明确报错，且不把它交给 op-log（不静默跳过）', async () => {
    const { client, applied, uploads } = makePlainClient(() =>
      okJson({
        ops: [{
          serverSeq: 1,
          receivedAt: Date.now(),
          op: {
            id: 'remote-1',
            clientId: 'device-b',
            actionType: 'CREATE_TASK',
            opType: 'CRT',
            entityType: 'TASK',
            entityId: 't9',
            payload: Buffer.alloc(44, 7).toString('base64'),
            isPayloadEncrypted: true,
            vectorClock: { 'device-b': 1 },
            timestamp: 1,
            schemaVersion: 1,
          },
        }],
        hasMore: false,
        latestSeq: 1,
        serverTime: Date.now(),
      }),
    );

    const status = await client.sync();

    expect(status.kind).toBe('error');
    // 🔴 断言的是**分类**，不是"反正报错了"：没有这一层，任何崩溃（比如访问
    // 不存在的 cipher）都会让这条测试变绿，而它本来要拦的正是"模式错配"。
    // 一个原因归错档，界面就会叫用户"核对口令" —— 而明文账号根本没有口令。
    expect(status.kind === 'error' ? status.reason : undefined).toBe('payload-mode-mismatch');
    expect(uploads).toHaveLength(1);
    expect(applied).toHaveLength(0);
  });
});
