import { describe, expect, it } from 'vitest';
import { classifyShareOpSignature, deriveShareIdentityKeyPair } from '@heyta/sync-core';
// 🔴 从**主入口**取 `ShareApiClient`：`@heyta/sync-client` 的 `exports` 只登记了 `"."`
// （`packages/sync-client/package.json`），子路径 `./share-api-client.js` 不在表里 ⇒
// 动态 import 会在 vite 解析期就报 "is not exported under the conditions"。主入口
// `index.ts:23` 有 `export * from './share-api-client.js'`，所以走主入口即可。
import { ShareApiClient } from '@heyta/sync-client';

import {
  createShareOpDispatcher,
  shareActionTypeFor,
  ShareOpNotAcceptedError,
  ShareOpUnsignableError,
  type ShareOpWireIdentity,
} from '../src/share-client.js';

/**
 * 签名件夹具：真派生一枚 Ed25519（固定种子），签的走生产原语 `signShareOpWire`。
 *
 * ⚠️ 载荷侧仍用 `ct:` 替身加密器：签名域**不解析信封**（世代不单列，见
 * `ShareOpSignatureParts`），所以替身签得出来 —— 而"签的那一份字节 == 存下来再读回来的
 * 那一份"由 `classifyShareOpSignature` 这一枚生产分类器在本文件里现验。
 */
const author = deriveShareIdentityKeyPair(new Uint8Array(32).fill(21));
const signerFor = async (): Promise<{ memberId: string; ed25519SecretKey: Uint8Array }> => ({
  memberId: 'member-1',
  ed25519SecretKey: author.ed25519SecretKey,
});
const toB64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/**
 * W2-T1 的判据（计划 §3-W2 点名：**「未登录不发请求」短路在 `share-client.ts`**）。
 *
 * 🔴 钉的是**网络边界**：用真的 `fetch` 替身数请求数、看 URL/方法/头/体，
 * 而不是"函数返回了什么"。判据钉错层是 admin-console 那次留下的教训。
 */
function makeFetchRecorder(): { calls: Array<{ url: string; method: string; body: string; auth: string | undefined }>; fetchImpl: typeof fetch } {
  const calls: Array<{ url: string; method: string; body: string; auth: string | undefined }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    calls.push({
      url: String(input),
      method: String(init?.method ?? 'GET'),
      body,
      auth: (init?.headers as Record<string, string> | undefined)?.['Authorization'],
    });
    // 替身 = "全收的假服务端"：把请求体里那批 op 的 id 逐条回执。
    // ⚠️ 形状必须是真实的 `accepted: [{id, serverSeq}]` —— dispatcher 判"写成功"读的就是这一格，
    // 替身给一个别的形状等于让判据验的是替身而不是线协议。
    const ops = (JSON.parse(body || '{}') as { ops?: Array<{ id: string }> }).ops ?? [];
    return new Response(JSON.stringify({
      accepted: ops.map((op, index) => ({ id: op.id, serverSeq: index + 1 })),
      rejected: [],
      latestServerSeq: ops.length,
    }), {
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
    let clockReads = 0;
    // 用**真客户端** + 替身 fetch：断言对象是"网络边上有没有请求"，不是"函数返回了什么"。
    const api = new ShareApiClient({ baseUrl: 'https://x', getToken: () => '', fetchImpl });
    const dispatcher = createShareOpDispatcher({
      signerFor,
      api: api as never,
      cipher,
      clientId: 'device-A1',
      schemaVersion: 1,
      isSignedIn: () => false,
      baseClock: () => {
        clockReads += 1;
        return {};
      },
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
    expect(clockReads, '未登录时不读因果时钟（读了就等于给一条没发出去的 op 占了一个序）').toBe(0);
  });

  it('登录 ⇒ 恰好一次 POST，体里的 op 形状逐字段对，且加密与上线共用同一份 identity', async () => {
    const { calls, fetchImpl } = makeFetchRecorder();
    const { seen, cipher } = makeRecordingCipher();
    const api = new ShareApiClient({ baseUrl: 'https://x', getToken: () => 't', fetchImpl });
    const dispatcher = createShareOpDispatcher({
      signerFor,
      api: api as never,
      cipher,
      clientId: 'device-A1',
      schemaVersion: 7,
      isSignedIn: () => true,
      baseClock: () => ({}),
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
    // ⚠️ `signature` 也剔掉：它是**上线那一条**的字段，不是 AAD 身份的一部分。
    // 加密发生在签之前（签的就是加密后的那份身份），所以两边本来就不可能同形。
    const {
      payload: _payload, vectorClock: _clock, isPayloadEncrypted: _flag, signature: _signature,
      ...wireIdentity
    } = op;
    expect(wireIdentity).toEqual(seen[0]);
  });

  it('因果时钟 = 基准逐维带过 + 本地那一维自增（ADR-0067 裁决二）', async () => {
    const { calls, fetchImpl } = makeFetchRecorder();
    const { cipher } = makeRecordingCipher();
    const api = new ShareApiClient({ baseUrl: 'https://x', getToken: () => 't', fetchImpl });
    const dispatcher = createShareOpDispatcher({
      signerFor,
      api: api as never,
      cipher,
      clientId: 'device-A1',
      schemaVersion: 1,
      isSignedIn: () => true,
      // 基准里已经有"别人那一维"和"我自己那一维"（真日志折出来就是这形状）。
      baseClock: () => ({ 'device-B2': 4, 'device-A1': 2 }),
      now: () => 1_700_000_000_000,
      newId: () => 'op-77',
    });
    await dispatcher.dispatch('share-1', { entityType: 'COMMENT', entityId: 'c-1', opType: 'CRT', payload: { body: 'x' } });

    const body = JSON.parse(calls[0]!.body) as { ops: Array<{ vectorClock: Record<string, number> }> };
    expect(body.ops[0]!.vectorClock, '别人的维原样带过（那是我看见它的证据），只有本地维 +1').toEqual({
      'device-B2': 4,
      'device-A1': 3,
    });
  });

  it('未登记的 opType ⇒ 写之前就红（不静默造动作名）', () => {
    expect(() => shareActionTypeFor('COMMENT', 'CRT')).not.toThrow();
    // M2 起任务/便签/标签族也必须登记（评论那三个标签字符串逐字不许改：它进 AAD）。
    expect(() => shareActionTypeFor('TASK', 'CRT')).not.toThrow();
    expect(() => shareActionTypeFor('NOTE', 'UPD')).not.toThrow();
    expect(() => shareActionTypeFor('TAG', 'CRT')).not.toThrow();
    // 🔴 清单**不在**这张表里：它不是共享内容（ADR-0068 裁决一）。留一行没人走的键
    // 等于把"清单可以共享写"这个口径继续摆在协议边上，所以这一枚必须是**抛**。
    expect(() => shareActionTypeFor('PROJECT', 'UPD')).toThrow(/Unregistered share actionType/);
    expect(() => shareActionTypeFor('COMMENT', 'LWW_BULK')).toThrow(/Unregistered share actionType/);
  });
});

describe('逐 op 签名（ADR-0069 裁决三/四 · 宿主层这一格）', () => {
  /** 装配一台只用来签名的 dispatcher，并把网络边上的请求体交出来。 */
  const build = (over: Partial<Parameters<typeof createShareOpDispatcher>[0]> = {}) => {
    const { calls, fetchImpl } = makeFetchRecorder();
    const { seen, cipher } = makeRecordingCipher();
    const api = new ShareApiClient({ baseUrl: 'https://x', getToken: () => 't', fetchImpl });
    let idCalls = 0;
    let clockReads = 0;
    let signerCalls = 0;
    const dispatcher = createShareOpDispatcher({
      api: api as never,
      cipher,
      clientId: 'device-A1',
      schemaVersion: 1,
      isSignedIn: () => true,
      baseClock: () => {
        clockReads += 1;
        return {};
      },
      now: () => 1_700_000_000_000,
      newId: () => {
        idCalls += 1;
        return 'op-9';
      },
      signerFor: async () => {
        signerCalls += 1;
        return signerFor();
      },
      ...over,
    });
    return { dispatcher, calls, seen, ids: () => idCalls, clocks: () => clockReads, signers: () => signerCalls };
  };

  const intent = { entityType: 'TASK', entityId: 'task-1', opType: 'CRT', payload: { title: '买漆' } } as const;

  /** 服务端上传边界那一份映射（照 `share.routes.ts`：作者取**认证**出来的成员行）。 */
  const classifyAsServer = (op: Record<string, unknown>) => classifyShareOpSignature({
    signingPublicKey: toB64(author.ed25519PublicKey),
    shareId: 'share-9',
    signerMemberId: 'member-1',
    signature: op['signature'],
    wire: {
      id: String(op['id']),
      clientId: String(op['clientId']),
      actionType: String(op['actionType']),
      opType: String(op['opType']),
      entityType: String(op['entityType']),
      entityId: (op['entityId'] as string | undefined) ?? null,
      entityIds: (op['entityIds'] as string[] | undefined) ?? null,
      payload: op['payload'],
      vectorClock: op['vectorClock'],
      vectorClockEncoding: (op['vectorClockEncoding'] as string | undefined) ?? null,
      isPayloadEncrypted: op['isPayloadEncrypted'] as boolean | undefined,
      schemaVersion: Number(op['schemaVersion']),
      // 服务端存这一格时做的正是 `BigInt(Math.trunc(...))`，验签前也这样归一：
      // 签的必须等于存的。
      clientTimestamp: Math.trunc(Number(op['timestamp'])),
    },
  });

  it('上线那一条带签名，且服务端用同一份分类器读成 verified', async () => {
    const { dispatcher, calls } = build();
    const result = await dispatcher.dispatch('share-9', intent);

    const op = (JSON.parse(calls[0]!.body) as { ops: Array<Record<string, unknown>> }).ops[0]!;
    expect(typeof op['signature'], '线协议上没有无签通道这一档').toBe('string');
    expect(op['signature']).not.toBe('');
    expect(classifyAsServer(op), '宿主签的那一份字节 == 服务端据以判定的那一份').toBe('verified');
    // 交回本地的线 op 与上线那一条是同一枚签名（不许出现第二份 op 形状）。
    expect(result.op?.signature).toBe(op['signature']);
  });

  it('载荷里改一个字节 ⇒ 服务端那份分类器读成 invalid（签名真的绑住了密文）', async () => {
    const { dispatcher, calls } = build();
    await dispatcher.dispatch('share-9', intent);
    const op = (JSON.parse(calls[0]!.body) as { ops: Array<Record<string, unknown>> }).ops[0]!;
    expect(classifyAsServer({ ...op, payload: `${String(op['payload'])}x` })).toBe('invalid');
  });

  it('拿不到签名件 ⇒ 具名失败，且网络/加密/id/时钟一位都不动', async () => {
    let signerAsked = 0;
    const { dispatcher, calls, seen, ids, clocks } = build({
      signerFor: async () => {
        signerAsked += 1;
        return undefined;
      },
    });
    await expect(dispatcher.dispatch('share-9', intent)).rejects.toBeInstanceOf(ShareOpUnsignableError);
    expect(calls, '一条注定被服务端拒的 op 不许上线').toHaveLength(0);
    expect(seen, '没签成就不该解清单钥、加密载荷').toHaveLength(0);
    expect(ids(), '不消耗 op id').toBe(0);
    expect(clocks(), '不读因果时钟（读了就等于给一条没发出去的 op 占了一个序）').toBe(0);
    expect(signerAsked, '登录了才问签名件——这一问是真的发生了').toBe(1);
  });

  it('未登录的短路排在签名件之前（signerFor 一次都不该被问）', async () => {
    const { dispatcher, calls, signers } = build({ isSignedIn: () => false });
    const result = await dispatcher.dispatch('share-9', intent);
    expect(result.skipped).toBe(true);
    expect(calls).toHaveLength(0);
    expect(signers(), '会话没登录就别去碰保险库').toBe(0);
  });

  it('服务端逐 op 拒绝 ⇒ 具名错误，这条不交回给本地折叠（共享腿的"永久拒绝"= 别落进日志）', async () => {
    const rejectFetch = (async () => new Response(JSON.stringify({
      accepted: [],
      rejected: [{ id: 'op-9', code: 'SHARE_OP_SIGNATURE_INVALID' }],
      latestServerSeq: 0,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const api = new ShareApiClient({ baseUrl: 'https://x', getToken: () => 't', fetchImpl: rejectFetch });
    const { seen, cipher } = makeRecordingCipher();
    const dispatcher = createShareOpDispatcher({
      signerFor,
      api: api as never,
      cipher,
      clientId: 'device-A1',
      schemaVersion: 1,
      isSignedIn: () => true,
      baseClock: () => ({}),
      now: () => 1_700_000_000_000,
      newId: () => 'op-9',
    });
    // ⚠️ 这里不许只断言"抛了"：判据是**没有 op 交回**。`share-comments` 拿 `result.op`
    // 折本地日志，交回去就等于把一条被服务端拒掉的改动画成"改好了"。
    await expect(dispatcher.dispatch('share-9', intent)).rejects.toMatchObject({
      name: 'ShareOpNotAcceptedError',
      code: 'SHARE_OP_SIGNATURE_INVALID',
      opId: 'op-9',
    });
    await expect(dispatcher.dispatch('share-9', intent)).rejects.toBeInstanceOf(ShareOpNotAcceptedError);
  });

  it('对照臂：服务端回执少给一枚码（形状外的收件缺失）也照样是具名失败，不是静默成功', async () => {
    const silentFetch = (async () => new Response(JSON.stringify({ accepted: [], rejected: [], latestServerSeq: 0 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    const api = new ShareApiClient({ baseUrl: 'https://x', getToken: () => 't', fetchImpl: silentFetch });
    const { cipher } = makeRecordingCipher();
    const dispatcher = createShareOpDispatcher({
      signerFor, api: api as never, cipher, clientId: 'device-A1', schemaVersion: 1,
      isSignedIn: () => true, baseClock: () => ({}), now: () => 1_700_000_000_000, newId: () => 'op-9',
    });
    await expect(dispatcher.dispatch('share-9', intent)).rejects.toMatchObject({
      name: 'ShareOpNotAcceptedError',
      // 没给码 ⇒ 归一成 NO_ACK：这一格必须有名，不然界面只能说"不知道成没成"。
      code: 'NO_ACK',
    });
  });

  it('now() 带小数 ⇒ 签名域那一份与线上/库里那一份都是截断值', async () => {
    const { dispatcher, calls, seen } = build({ now: () => 1_700_000_000_000.7 });
    await dispatcher.dispatch('share-9', intent);
    const op = (JSON.parse(calls[0]!.body) as { ops: Array<Record<string, unknown>> }).ops[0]!;
    // 服务端把这一枚存成 `client_timestamp` 时做的正是 `BigInt(Math.trunc(...))`。
    // 写侧不先截断 ⇒ 签的是带小数的、存的是截断的，读侧重建出的域与写侧差在小数上，
    // 每台非签名者的设备把自己人的合法签名读成失败。
    expect(op['timestamp'], '线上送出去的必须是整数毫秒').toBe(1_700_000_000_000);
    expect(seen[0]!.timestamp, 'AAD 里那一份与签名域里那一份是同一个数').toBe(1_700_000_000_000);
    expect(classifyAsServer(op)).toBe('verified');
  });
});
