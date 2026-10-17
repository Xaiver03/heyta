import { describe, expect, it } from 'vitest';
// 🔴 从**主入口**取 `ShareApiClient`：`@heyta/sync-client` 的 `exports` 只登记了 `"."`
// （`packages/sync-client/package.json`），子路径 `./share-api-client.js` 不在表里 ⇒
// 动态 import 会在 vite 解析期就报 "is not exported under the conditions"。主入口
// `index.ts:23` 有 `export * from './share-api-client.js'`，所以走主入口即可。
import { ShareApiClient } from '@heyta/sync-client';

import {
  createShareOpDispatcher,
  shareActionTypeFor,
  type ShareOpWireIdentity,
} from '../src/share-client.js';

/**
 * W2-T1 的判据（计划 §3-W2 点名：**「未登录不发请求」短路在 `share-client.ts`**）。
 *
 * 🔴 钉的是**网络边界**：用真的 `fetch` 替身数请求数、看 URL/方法/头/体，
 * 而不是"函数返回了什么"。判据钉错层是 admin-console 那次留下的教训。
 */
function makeFetchRecorder(): { calls: Array<{ url: string; method: string; body: string; auth: string | undefined }>; fetchImpl: typeof fetch } {
  const calls: Array<{ url: string; method: string; body: string; auth: string | undefined }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: String(init?.method ?? 'GET'),
      body: String(init?.body ?? ''),
      auth: (init?.headers as Record<string, string> | undefined)?.['Authorization'],
    });
    return new Response(JSON.stringify({ accepted: [], rejected: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** 只记录"加密时拿到的那份 identity"，用来证 AAD 绑定的是**同一份**身份。 */
function makeRecordingCipher(): { seen: ShareOpWireIdentity[]; cipher: { encrypt: (p: string, i: ShareOpWireIdentity) => Promise<string> } } {
  const seen: ShareOpWireIdentity[] = [];
  return {
    seen,
    cipher: {
      encrypt: async (payload: string, identity: ShareOpWireIdentity): Promise<string> => {
        seen.push(identity);
        return `ct:${payload}`;
      },
    },
  };
}

describe('share-client（W2-T1）', () => {
  it('未登录 ⇒ 一个请求都不发，也不构造 op', async () => {
    const { calls, fetchImpl } = makeFetchRecorder();
    const { seen, cipher } = makeRecordingCipher();
    let idCalls = 0;
    // 用**真客户端** + 替身 fetch：断言对象是"网络边上有没有请求"，不是"函数返回了什么"。
    const api = new ShareApiClient({ baseUrl: 'https://x', getToken: () => '', fetchImpl });
    const dispatcher = createShareOpDispatcher({
      api: api as never,
      cipher,
      clientId: 'device-A1',
      schemaVersion: 1,
      isSignedIn: () => false,
      now: () => 1_700_000_000_000,
      newId: () => {
        idCalls += 1;
        return 'op-1';
      },
    });

    const result = await dispatcher.dispatch('share-1', { entityType: 'COMMENT', entityId: 'c-1', opType: 'CRT', payload: { taskId: 't-1', authorUserId: 'u-1', body: 'hi' } });

    expect(result, '未登录必须短路').toEqual({ opId: '', skipped: true });
    expect(calls, '未登录时网络边上一个请求都不许有').toHaveLength(0);
    expect(seen, '未登录时连加密都不该发生（不消耗 id、不碰密钥）').toHaveLength(0);
    expect(idCalls, '未登录时不消耗 op id').toBe(0);
  });

  it('登录 ⇒ 恰好一次 POST，体里的 op 形状逐字段对，且加密与上线共用同一份 identity', async () => {
    const { calls, fetchImpl } = makeFetchRecorder();
    const { seen, cipher } = makeRecordingCipher();
    const api = new ShareApiClient({ baseUrl: 'https://x', getToken: () => 't', fetchImpl });
    const dispatcher = createShareOpDispatcher({
      api: api as never,
      cipher,
      clientId: 'device-A1',
      schemaVersion: 7,
      isSignedIn: () => true,
      now: () => 1_700_000_000_000,
      newId: () => 'op-42',
    });

    const result = await dispatcher.dispatch('share-9', { entityType: 'COMMENT', entityId: 'c-9', opType: 'UPD', payload: { body: 'edited' } });

    // 2026-10-17：返回值多了**有文档**的 `op`（本地物化要复用同一条 op 的身份字段，
    // 免得第二份线 op 形状出现）⇒ 这里不再用 `toEqual` 钉整个对象，改成逐字段**加强**断言：
    // 既钉住原来那两个字段，又钉住新字段真的把线 op 交回来了。
    expect(result.opId).toBe('op-42');
    expect(result.skipped).toBe(false);
    expect(result.op, '要把装配好的线 op 交回来').toBeDefined();
    expect(result.op?.id, '交回来的就是上线的那一条').toBe('op-42');
    expect(result.op?.payload, '交回来的是密文（本地要换明文，见 share-comments）').toBe('ct:{"body":"edited"}');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/api/shares/share-9/ops');
    expect(calls[0]!.method).toBe('POST');
    expect(seen, '加密只发生一次').toHaveLength(1);

    const body = JSON.parse(calls[0]!.body) as { ops: Array<Record<string, unknown>> };
    const op = body.ops[0]!;
    expect(op).toMatchObject({
      id: 'op-42',
      clientId: 'device-A1',
      opType: 'UPD',
      actionType: 'edit comment',
      entityType: 'COMMENT',
      entityId: 'c-9',
      timestamp: 1_700_000_000_000,
      schemaVersion: 7,
      vectorClock: { 'device-A1': 1 },
      isPayloadEncrypted: true,
    });
    // 密文而不是明文；且**加密时那份 identity 与上线那份逐字段相同**（AAD 绑定，见文件头纪律 1）。
    expect(op['payload']).toBe('ct:{"body":"edited"}');
    const { payload: _payload, vectorClock: _clock, isPayloadEncrypted: _flag, ...wireIdentity } = op;
    expect(wireIdentity).toEqual(seen[0]);
  });

  it('未登记的 opType ⇒ 写之前就红（不静默造动作名）', () => {
    expect(() => shareActionTypeFor('CRT')).not.toThrow();
    expect(() => shareActionTypeFor('LWW_BULK')).toThrow(/Unregistered share actionType/);
  });
});
