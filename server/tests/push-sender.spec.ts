/**
 * 发送端的承重测试。
 * ==================
 *
 * 这里**不假装能测通推送服务**（本机发不到 WNS）。能测、也必须测的是：
 *
 * 1. **请求的形状**：三个头齐不齐、`Content-Encoding` 对不对；
 * 2. **状态码的分类**：`410` 必须被认成"死订阅"而不是"过会儿再试" ——
 *    这个分错会让一个死订阅被永远重试，每次都跑一遍 ECDH + AES；
 * 3. **一批里一条失败不影响其它**；
 * 4. **发出去的 body 真的是能被 RFC 向量解出来的那个形状**（复用 push-crypto 的断言）。
 */

import { describe, expect, it, vi } from 'vitest';

import { base64UrlDecode, base64UrlEncode, generateServerKeyPair } from '../src/push/push-crypto';
import { sendWidgetPush, sendWidgetPushToAll, type SendWidgetPushInput } from '../src/push/sender';

// 用 RFC 8291 §5 的固定密钥，让"发出去的 body"可以被逐字节核对。
const UA_PUBLIC = base64UrlDecode(
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
);
const AUTH_SECRET = base64UrlDecode('BTBZMqHH6r4Tts7J_aSIgg');
const SALT = base64UrlDecode('DGv6ra1nlYgDCS1FRnbzlw');
const AS_KEYS = {
  privateKey: base64UrlDecode('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
  publicKey: base64UrlDecode(
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ),
};
const ENDPOINT = 'https://wns2-par02p.notify.windows.com/w/?token=abc';
const PLAINTEXT = 'When I grow up, I want to be a watermelon';
const EXPECTED_BODY =
  'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
  'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
  'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

function makeInput(over: Partial<SendWidgetPushInput> = {}): SendWidgetPushInput {
  return {
    subscription: {
      endpoint: ENDPOINT,
      p256dh: base64UrlEncode(UA_PUBLIC),
      auth: base64UrlEncode(AUTH_SECRET),
    },
    plaintext: PLAINTEXT,
    vapid: generateServerKeyPair(),
    subject: 'mailto:push@heyta.app',
    salt: SALT,
    serverKeyPair: AS_KEYS,
    nowSeconds: 1_800_000_000,
    ...over,
  };
}

/** 记下这次 fetch 收到了什么。 */
function spyFetch(status: number) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('请求的形状', () => {
  it('🔴 body 与 RFC 8291 §5 逐字节一致（证明拼的是对的密文）', async () => {
    const { fetchImpl, calls } = spyFetch(201);
    const result = await sendWidgetPush(makeInput({ fetchImpl }));

    const body = calls[0]?.init.body as Uint8Array;
    expect(Buffer.from(body).toString('base64url')).toBe(EXPECTED_BODY);
    expect(result.bodyBytes).toBe(144);
    expect(result.kind).toBe('sent');
  });

  it('🔴 三个头齐备，Content-Encoding 是 aes128gcm', async () => {
    const { fetchImpl, calls } = spyFetch(201);
    await sendWidgetPush(makeInput({ fetchImpl }));

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    // ⚠️ 缺 TTL 会被很多推送服务直接拒（RFC 8030 §5.2 要求它）
    expect(headers['TTL']).toBe(String(12 * 60 * 60));
    expect(headers['Authorization']).toMatch(/^vapid t=.*, k=/);
    // ⚠️ 只是刷新组件，不该用 high 去半夜把设备叫醒
    expect(headers['Urgency']).toBe('normal');
  });

  it('POST 到订阅给的 endpoint，且方法正好是 POST', async () => {
    const { fetchImpl, calls } = spyFetch(201);
    await sendWidgetPush(makeInput({ fetchImpl }));
    expect(calls[0]?.url).toBe(ENDPOINT);
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('TTL 可以覆盖', async () => {
    const { fetchImpl, calls } = spyFetch(201);
    await sendWidgetPush(makeInput({ fetchImpl, ttlSeconds: 60 }));
    expect((calls[0]?.init.headers as Record<string, string>)['TTL']).toBe('60');
  });
});

describe('🔴 状态码分类（分错会让死订阅被永远重试）', () => {
  it.each([
    [201, 'sent'],
    [202, 'sent'],
    [200, 'sent'],
  ])('HTTP %i → %s', async (status, kind) => {
    const { fetchImpl } = spyFetch(status);
    expect((await sendWidgetPush(makeInput({ fetchImpl }))).kind).toBe(kind);
  });

  it.each([404, 410])('HTTP %i → gone（订阅已经死了）', async (status) => {
    const { fetchImpl } = spyFetch(status);
    const result = await sendWidgetPush(makeInput({ fetchImpl }));
    expect(result.kind).toBe('gone');
    // ⚠️ `gone` 必须是独立的类别：把它并进 `retryable` 就等于
    //    永远不再有机会删掉那条订阅，而每次都要重跑一遍密码学。
    expect(result.kind).not.toBe('retryable');
  });

  it.each([429, 500, 502, 503])('HTTP %i → retryable', async (status) => {
    const { fetchImpl } = spyFetch(status);
    expect((await sendWidgetPush(makeInput({ fetchImpl }))).kind).toBe('retryable');
  });

  it.each([400, 401, 403])('HTTP %i → rejected（重试没有意义）', async (status) => {
    const { fetchImpl } = spyFetch(status);
    const result = await sendWidgetPush(makeInput({ fetchImpl }));
    expect(result.kind).toBe('rejected');
    // 401/403 基本就是 VAPID 或 Content-Encoding 的问题，提示里要说出来
    expect(result.kind === 'rejected' && result.reason).toMatch(/VAPID|Content-Encoding/);
  });
});

describe('入参校验（错误要带字段名）', () => {
  it('🔴 p256dh 长度不对时报错里带字段名', async () => {
    const { fetchImpl } = spyFetch(201);
    await expect(
      sendWidgetPush(
        makeInput({ fetchImpl, subscription: { ...makeInput().subscription, p256dh: 'AAAA' } }),
      ),
    ).rejects.toThrow(/p256dh 必须是 65 字节/);
  });

  it('🔴 auth 长度不对时报错里带字段名', async () => {
    const { fetchImpl } = spyFetch(201);
    await expect(
      sendWidgetPush(
        makeInput({ fetchImpl, subscription: { ...makeInput().subscription, auth: 'AAAA' } }),
      ),
    ).rejects.toThrow(/auth 必须是 16 字节/);
  });

  it('🔴 明文超限时早失败，且提示是"快照太大"而不是密码学错误', async () => {
    const { fetchImpl } = spyFetch(201);
    await expect(
      sendWidgetPush(makeInput({ fetchImpl, plaintext: 'x'.repeat(3994) })),
    ).rejects.toThrow(/超过单条推送上限/);
  });
});

describe('批量发送', () => {
  it('🔴 一条死订阅不影响其它订阅', async () => {
    // 这条挡的是"一个用户的设备坏了，所有人的组件都不更新" ——
    // 那种问题几乎不可能从现场信息里定位。
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      return new Response(null, { status: n === 1 ? 410 : 201 });
    }) as unknown as typeof fetch;

    const results = await sendWidgetPushToAll([
      makeInput({ fetchImpl }),
      makeInput({ fetchImpl }),
      makeInput({ fetchImpl }),
    ]);

    expect(results.map((r) => r.kind)).toEqual(['gone', 'sent', 'sent']);
  });

  it('🔴 一条抛异常也不影响其它（入参坏了不能带塌整批）', async () => {
    const { fetchImpl } = spyFetch(201);
    const results = await sendWidgetPushToAll([
      // 第一条 p256dh 是坏的 → 会在加密前抛
      makeInput({ fetchImpl, subscription: { ...makeInput().subscription, p256dh: 'bad' } }),
      makeInput({ fetchImpl }),
    ]);

    expect(results[0]?.kind).toBe('failed');
    expect(results[1]?.kind).toBe('sent');
  });

  it('空批次返回空数组（不是 undefined）', async () => {
    await expect(sendWidgetPushToAll([])).resolves.toEqual([]);
  });
});

describe('VAPID 的 aud 用的是 endpoint 的 origin', () => {
  it('🔴 不是完整 endpoint', async () => {
    const { fetchImpl, calls } = spyFetch(201);
    const vapid = generateServerKeyPair();
    await sendWidgetPush(makeInput({ fetchImpl, vapid }));

    const auth = (calls[0]?.init.headers as Record<string, string>)['Authorization'] ?? '';
    const jwt = auth.replace(/^vapid t=/, '').split(', k=')[0] ?? '';
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString());
    expect(payload.aud).toBe('https://wns2-par02p.notify.windows.com');
    expect(payload.aud).not.toBe(ENDPOINT);
  });
});
