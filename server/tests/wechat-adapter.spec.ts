import { describe, it, expect } from 'vitest';
import { createSign, createVerify } from 'node:crypto';
import {
  WECHAT_API_BASE_URL,
  WECHAT_NATIVE_PATH,
  WECHAT_PROVIDER,
  WECHAT_SIGNATURE_MAX_AGE_MS,
  buildRequestSignatureMessage,
  buildWechatAuthorizationHeader,
  buildWechatOutTradeNo,
  buildWebhookSignatureMessage,
  createWechatBillingAdapter,
  decryptWechatResource,
  isWechatTimestampFresh,
  normalizePemKey,
  parseUserIdFromAttach,
  parseUserIdFromOutTradeNo,
  parseWechatTime,
  signWechatRequest,
  verifyWechatSignature,
} from '../src/billing/wechat.adapter';
import {
  TEST_WECHAT_API_V3_KEY,
  TEST_WECHAT_APP_ID,
  TEST_WECHAT_MCH_ID,
  TEST_WECHAT_NOTIFY_URL,
  TEST_WECHAT_SERIAL_NO,
  buildWechatPaymentWebhook,
  createWechatTestKeyPair,
  encryptWechatResource,
} from './wechat-test-fixture.helper';

/**
 * 微信 adapter 的**纯函数层 + 协议层**测试。
 *
 * 🔴 全程**不用真实凭证、不发任何真实网络请求**：
 * - RSA 密钥是这里现生成的（`generateKeyPairSync`）；
 * - AES-256-GCM 密文是这里用同一个 APIv3 密钥现加密的；
 * - `createCheckout` 的 fetch 是 stub，只检查我们**发出去**的字节与签名。
 *
 * 也就是说：这些测试证明的是"我们实现的协议与微信文档一致"，
 * **不是**"微信真的会接受它" —— 后者只有真实商户号跑真单才能证明。
 */
const API_V3_KEY = TEST_WECHAT_API_V3_KEY;
const APP_ID = TEST_WECHAT_APP_ID;
const MCH_ID = TEST_WECHAT_MCH_ID;
const SERIAL_NO = TEST_WECHAT_SERIAL_NO;
const NOTIFY_URL = TEST_WECHAT_NOTIFY_URL;

const { privateKey, publicKey } = createWechatTestKeyPair();

const createAdapter = (overrides: Record<string, unknown> = {}) =>
  createWechatBillingAdapter({
    appId: APP_ID,
    mchId: MCH_ID,
    serialNo: SERIAL_NO,
    apiV3Key: API_V3_KEY,
    privateKey,
    publicKey,
    notifyUrl: NOTIFY_URL,
    ...overrides,
  });

/** 用同一个 APIv3 密钥构造 `base64(密文 || authTag)`，与微信的格式一致。 */
const encryptResource = (
  plaintext: string,
  nonce: string,
  associatedData: string,
): string => encryptWechatResource(plaintext, nonce, associatedData, API_V3_KEY);

interface WebhookFixture {
  readonly body: Buffer;
  readonly headers: Record<string, string>;
}

const buildPaymentWebhook = (opts: {
  outTradeNo?: string;
  attach?: string | null;
  successTime?: string;
  timestampSeconds: number;
  nonce?: string;
  resourceNonce?: string;
  associatedData?: string;
  signingPrivateKey?: string;
  eventType?: string;
  tradeState?: string;
  omitSuccessTime?: boolean;
}): WebhookFixture =>
  buildWechatPaymentWebhook({
    privateKey: opts.signingPrivateKey ?? privateKey,
    timestampSeconds: opts.timestampSeconds,
    outTradeNo:
      opts.outTradeNo ?? buildWechatOutTradeNo(42, 1_700_000_000_000, 'deadbeef'),
    ...(opts.attach === undefined ? {} : { attach: opts.attach }),
    successTime: opts.successTime,
    nonce: opts.nonce,
    resourceNonce: opts.resourceNonce,
    associatedData: opts.associatedData,
    eventType: opts.eventType,
    tradeState: opts.tradeState,
    omitSuccessTime: opts.omitSuccessTime,
  });

describe('wechat adapter — 请求签名串', () => {
  it('拼接形状是 method\\nurl\\ntimestamp\\nnonce\\nbody\\n（末尾换行不能少）', () => {
    expect(
      buildRequestSignatureMessage({
        method: 'post',
        url: '/v3/pay/transactions/native',
        timestamp: 1_700_000_000,
        nonce: 'abc',
        body: '{"a":1}',
      }),
    ).toBe('POST\n/v3/pay/transactions/native\n1700000000\nabc\n{"a":1}\n');
  });

  it('签名能用对应公钥验回（RSA-SHA256）', () => {
    const input = {
      method: 'POST',
      url: WECHAT_NATIVE_PATH,
      timestamp: 1_700_000_000,
      nonce: 'nonce-1',
      body: '{"hello":"世界"}',
    };
    const signature = signWechatRequest(input, privateKey);
    const message = Buffer.from(buildRequestSignatureMessage(input), 'utf8');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(message);
    verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64'))).toBe(true);
  });

  it('Authorization 头带全四个字段 + 固定 scheme', () => {
    const header = buildWechatAuthorizationHeader({
      mchId: MCH_ID,
      serialNo: SERIAL_NO,
      nonce: 'n1',
      timestamp: 1_700_000_000,
      signature: 'c2ln',
    });
    expect(header).toBe(
      'WECHATPAY2-SHA256-RSA2048 ' +
        `mchid="${MCH_ID}",nonce_str="n1",signature="c2ln",timestamp="1700000000",serial_no="${SERIAL_NO}"`,
    );
  });
});

describe('wechat adapter — 回调验签', () => {
  it('验签串是 timestamp\\nnonce\\nbody\\n，且 body 是原始字节', () => {
    const message = buildWebhookSignatureMessage(
      { timestamp: '1700000000', nonce: 'n1' },
      Buffer.from('{"a":1}', 'utf8'),
    );
    expect(message.toString('utf8')).toBe('1700000000\nn1\n{"a":1}\n');
  });

  it('正确签名 → true；改一个字节的 body → false', () => {
    const raw = Buffer.from('{"a":1}', 'utf8');
    const message = buildWebhookSignatureMessage(
      { timestamp: '1700000000', nonce: 'n1' },
      raw,
    );
    const signature = createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
    expect(
      verifyWechatSignature({ message, signature, publicKeyPem: publicKey }),
    ).toBe(true);

    const tampered = Buffer.from('{"a":2}', 'utf8');
    expect(
      verifyWechatSignature({
        message: buildWebhookSignatureMessage(
          { timestamp: '1700000000', nonce: 'n1' },
          tampered,
        ),
        signature,
        publicKeyPem: publicKey,
      }),
    ).toBe(false);
  });

  it('密钥不是合法 PEM 时**返回 false 而不是抛异常**（fail-closed）', () => {
    expect(
      verifyWechatSignature({
        message: Buffer.from('x'),
        signature: 'AAAA',
        publicKeyPem: 'not-a-pem',
      }),
    ).toBe(false);
  });

  it('时间戳时效：窗口内通过，过旧 / 过于超前都拒绝，非数字拒绝', () => {
    const now = 1_700_000_000_000;
    const seconds = now / 1000;

    expect(isWechatTimestampFresh(String(seconds), now)).toBe(true);
    expect(
      isWechatTimestampFresh(String(seconds - WECHAT_SIGNATURE_MAX_AGE_MS / 1000), now),
    ).toBe(true);
    expect(
      isWechatTimestampFresh(String(seconds - WECHAT_SIGNATURE_MAX_AGE_MS / 1000 - 1), now),
    ).toBe(false);
    // 超前同样拒绝：否则一个"100 年后"的时间戳能把重放窗口变成永远。
    expect(
      isWechatTimestampFresh(String(seconds + WECHAT_SIGNATURE_MAX_AGE_MS / 1000 + 1), now),
    ).toBe(false);
    expect(isWechatTimestampFresh('not-a-number', now)).toBe(false);
    expect(isWechatTimestampFresh('', now)).toBe(false);
    expect(isWechatTimestampFresh('-1', now)).toBe(false);
  });
});

describe('wechat adapter — AES-256-GCM 回调解密', () => {
  const plaintext = '{"out_trade_no":"hy1x1xdeadbeef","trade_state":"SUCCESS"}';

  it('解出原文（ciphertext = 密文 || 16 字节 authTag）', () => {
    const ciphertext = encryptResource(plaintext, 'nonce1234567', 'transaction');
    const decrypted = decryptWechatResource(
      { ciphertext, nonce: 'nonce1234567', associatedData: 'transaction' },
      API_V3_KEY,
    );
    expect(decrypted.toString('utf8')).toBe(plaintext);
  });

  it('associated_data 缺失时按空串处理', () => {
    const ciphertext = encryptResource(plaintext, 'nonce1234567', '');
    expect(
      decryptWechatResource({ ciphertext, nonce: 'nonce1234567' }, API_V3_KEY).toString(
        'utf8',
      ),
    ).toBe(plaintext);
  });

  it('🔴 密文被篡改 → **抛异常**（认证失败不静默）', () => {
    const ciphertext = encryptResource(plaintext, 'nonce1234567', 'transaction');
    const raw = Buffer.from(ciphertext, 'base64');
    raw[0] ^= 0xff;
    expect(() =>
      decryptWechatResource(
        { ciphertext: raw.toString('base64'), nonce: 'nonce1234567', associatedData: 'transaction' },
        API_V3_KEY,
      ),
    ).toThrow();
  });

  it('AAD 对不上 → 抛异常', () => {
    const ciphertext = encryptResource(plaintext, 'nonce1234567', 'transaction');
    expect(() =>
      decryptWechatResource(
        { ciphertext, nonce: 'nonce1234567', associatedData: 'other' },
        API_V3_KEY,
      ),
    ).toThrow();
  });

  it('APIv3 密钥不是 32 字节 → 明确报错（不静默用截断密钥）', () => {
    const ciphertext = encryptResource(plaintext, 'nonce1234567', 'transaction');
    expect(() =>
      decryptWechatResource(
        { ciphertext, nonce: 'nonce1234567', associatedData: 'transaction' },
        'too-short',
      ),
    ).toThrow(/32/);
  });
});

describe('wechat adapter — 工具纯函数', () => {
  it('normalizePemKey 接受多行 PEM / 转义 PEM / PEM 的 base64', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----';
    expect(normalizePemKey(pem, 'k')).toBe(pem);
    expect(normalizePemKey(pem.replace(/\n/g, '\\n'), 'k')).toBe(pem);
    expect(normalizePemKey(Buffer.from(pem, 'utf8').toString('base64'), 'k')).toBe(pem);
    expect(() => normalizePemKey('garbage', 'WX_PRIVATE_KEY')).toThrow(/WX_PRIVATE_KEY/);
  });

  it('out_trade_no 编解码往返，且能识别非本格式', () => {
    const order = buildWechatOutTradeNo(42, 1_700_000_000_000, 'deadbeef');
    expect(order).toMatch(/^hy[0-9a-z]+x[0-9a-z]+xdeadbeef$/);
    expect(order.length).toBeLessThanOrEqual(32);
    expect(parseUserIdFromOutTradeNo(order)).toBe(42);
    expect(parseUserIdFromOutTradeNo('some-other-order')).toBeNull();
  });

  it('attach 只在纯十进制正整数时被接受', () => {
    expect(parseUserIdFromAttach('42')).toBe(42);
    expect(parseUserIdFromAttach(' 7 ')).toBe(7);
    expect(parseUserIdFromAttach('uid_42')).toBeNull();
    expect(parseUserIdFromAttach('-1')).toBeNull();
    expect(parseUserIdFromAttach(undefined)).toBeNull();
  });

  it('parseWechatTime 认 ISO 8601（含 +08:00 偏移）', () => {
    expect(parseWechatTime('2026-09-26T12:00:00+08:00')).toBe(
      Date.parse('2026-09-26T04:00:00Z'),
    );
    expect(parseWechatTime('nonsense')).toBeUndefined();
    expect(parseWechatTime(undefined)).toBeUndefined();
  });
});

describe('wechat adapter — createCheckout（stub fetch，🔴 没有真网络）', () => {
  const NOW = 1_700_000_000_000;

  it('POST /v3/pay/transactions/native，返回 code_url → qrCode 支', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({ code_url: 'weixin://wxpay/bizpayurl?pr=abc123' }),
      };
    }) as unknown as typeof fetch;

    const adapter = createAdapter({ fetchImpl, now: () => NOW });
    const result = await adapter.createCheckout({
      userId: 42,
      priceId: 'annual',
      successUrl: 'https://app.example.test/ok',
      cancelUrl: 'https://app.example.test/cancel',
    });

    expect(result).toEqual({ qrCode: 'weixin://wxpay/bizpayurl?pr=abc123' });
    expect(captured!.url).toBe(`${WECHAT_API_BASE_URL}${WECHAT_NATIVE_PATH}`);

    const body = JSON.parse(String(captured!.init.body)) as Record<string, unknown>;
    expect(body.appid).toBe(APP_ID);
    expect(body.mchid).toBe(MCH_ID);
    expect(body.amount).toEqual({ total: 9_900, currency: 'CNY' });
    expect(body.attach).toBe('42');
    expect(body.notify_url).toBe(NOTIFY_URL);
    expect(parseUserIdFromOutTradeNo(String(body.out_trade_no))).toBe(42);

    // 🔴 发出去的 Authorization 必须能被我们的公钥验回 ——
    // 证明"签的串"与"发的 body / url / timestamp / nonce"完全一致。
    const headers = captured!.init.headers as Record<string, string>;
    const auth = headers.Authorization;
    const fields = Object.fromEntries(
      [...auth.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    const expectedSignature = signWechatRequest(
      {
        method: 'POST',
        url: WECHAT_NATIVE_PATH,
        timestamp: Number(fields.timestamp),
        nonce: fields.nonce_str,
        body: String(captured!.init.body),
      },
      privateKey,
    );
    expect(fields.signature).toBe(expectedSignature);
    expect(fields.mchid).toBe(MCH_ID);
    expect(fields.serial_no).toBe(SERIAL_NO);
  });

  it('未知 priceId → 明确抛错，不按 0 元下单', async () => {
    const adapter = createAdapter({
      fetchImpl: (async () => {
        throw new Error('不该发请求');
      }) as unknown as typeof fetch,
    });
    await expect(
      adapter.createCheckout({
        userId: 1,
        priceId: 'nope',
        successUrl: 'https://a.test',
        cancelUrl: 'https://a.test',
      }),
    ).rejects.toThrow(/priceId/);
  });

  it('微信返回非 2xx → WechatApiError 带状态码与 code', async () => {
    const adapter = createAdapter({
      fetchImpl: (async () => ({
        ok: false,
        status: 402,
        json: async () => ({ code: 'NO_AUTH', message: '签名错误' }),
      })) as unknown as typeof fetch,
    });
    await expect(
      adapter.createCheckout({
        userId: 1,
        priceId: 'annual',
        successUrl: 'https://a.test',
        cancelUrl: 'https://a.test',
      }),
    ).rejects.toMatchObject({ httpStatus: 402, apiCode: 'NO_AUTH' });
  });

  it('2xx 但没有 code_url → 抛错（不返回空二维码）', async () => {
    const adapter = createAdapter({
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      })) as unknown as typeof fetch,
    });
    await expect(
      adapter.createCheckout({
        userId: 1,
        priceId: 'annual',
        successUrl: 'https://a.test',
        cancelUrl: 'https://a.test',
      }),
    ).rejects.toMatchObject({ apiCode: 'MISSING_CODE_URL' });
  });
});

describe('wechat adapter — verifyWebhook 的失败路径（fail-closed）', () => {
  const NOW = Date.parse('2026-09-26T12:00:00+08:00');
  const adapter = createAdapter({ now: () => NOW });

  it('缺 header → missing-signature-headers', async () => {
    const result = await adapter.verifyWebhook(Buffer.from('{}'), {});
    expect(result).toEqual({ ok: false, reason: 'missing-signature-headers' });
  });

  it('时间戳过期 → stale-timestamp（在验签之前就拒）', async () => {
    const fixture = buildPaymentWebhook({
      timestampSeconds: Math.floor(NOW / 1000) - 3600,
    });
    await expect(adapter.verifyWebhook(fixture.body, fixture.headers)).resolves.toEqual({
      ok: false,
      reason: 'stale-timestamp',
    });
  });

  it('签名被改过一个字符 → invalid-signature', async () => {
    const fixture = buildPaymentWebhook({ timestampSeconds: Math.floor(NOW / 1000) });
    const broken = {
      ...fixture.headers,
      'wechatpay-signature': `A${fixture.headers['wechatpay-signature'].slice(1)}`,
    };
    await expect(adapter.verifyWebhook(fixture.body, broken)).resolves.toEqual({
      ok: false,
      reason: 'invalid-signature',
    });
  });

  it('body 被篡改 → invalid-signature（签名覆盖原始字节）', async () => {
    const fixture = buildPaymentWebhook({ timestampSeconds: Math.floor(NOW / 1000) });
    const tampered = Buffer.from(fixture.body.toString('utf8').replace('notif', 'notiF'));
    await expect(adapter.verifyWebhook(tampered, fixture.headers)).resolves.toEqual({
      ok: false,
      reason: 'invalid-signature',
    });
  });

  it('签名合法但用别的私钥签的 → invalid-signature', async () => {
    const other = createWechatTestKeyPair();
    const fixture = buildPaymentWebhook({
      timestampSeconds: Math.floor(NOW / 1000),
      signingPrivateKey: other.privateKey,
    });
    await expect(adapter.verifyWebhook(fixture.body, fixture.headers)).resolves.toEqual({
      ok: false,
      reason: 'invalid-signature',
    });
  });

  it('AES 密钥与密文不匹配 → decrypt-failed', async () => {
    const wrongKeyAdapter = createAdapter({
      now: () => NOW,
      apiV3Key: 'b'.repeat(32),
    });
    const fixture = buildPaymentWebhook({ timestampSeconds: Math.floor(NOW / 1000) });
    await expect(
      wrongKeyAdapter.verifyWebhook(fixture.body, fixture.headers),
    ).resolves.toEqual({ ok: false, reason: 'decrypt-failed' });
  });

  it('只认 TRANSACTION.SUCCESS；其它事件类型明确拒绝', async () => {
    const fixture = buildPaymentWebhook({
      timestampSeconds: Math.floor(NOW / 1000),
      eventType: 'REFUND.SUCCESS',
    });
    await expect(adapter.verifyWebhook(fixture.body, fixture.headers)).resolves.toEqual({
      ok: false,
      reason: 'unsupported-event-type',
    });
  });

  it('trade_state 不是 SUCCESS → unsupported-trade-state', async () => {
    const fixture = buildPaymentWebhook({
      timestampSeconds: Math.floor(NOW / 1000),
      tradeState: 'NOTPAY',
    });
    await expect(adapter.verifyWebhook(fixture.body, fixture.headers)).resolves.toEqual({
      ok: false,
      reason: 'unsupported-trade-state',
    });
  });

  it('没有 success_time → invalid-event-time（不拿到达时间顶替）', async () => {
    const fixture = buildPaymentWebhook({
      timestampSeconds: Math.floor(NOW / 1000),
      omitSuccessTime: true,
    });
    await expect(adapter.verifyWebhook(fixture.body, fixture.headers)).resolves.toEqual({
      ok: false,
      reason: 'invalid-event-time',
    });
  });
});

describe('wechat adapter — verifyWebhook 的成功路径与归一化', () => {
  const NOW = Date.parse('2026-09-26T12:00:00+08:00');
  const adapter = createAdapter({ now: () => NOW });

  it('归一化：无订阅引用 / 无状态 / 无周期，只带 oneTimeGrant', async () => {
    const outTradeNo = buildWechatOutTradeNo(42, 1_700_000_000_000, 'deadbeef');
    const fixture = buildPaymentWebhook({
      outTradeNo,
      timestampSeconds: Math.floor(NOW / 1000),
    });
    const result = await adapter.verifyWebhook(fixture.body, fixture.headers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.provider).toBe(WECHAT_PROVIDER);
    expect(result.event.eventType).toBe('payment_succeeded');
    // 🔴 幂等键 = out_trade_no（带归一化事件类型前缀）。
    expect(result.event.providerEventId).toBe(`payment_succeeded:${outTradeNo}`);
    expect(result.event.externalSubscriptionId).toBeNull();
    expect(result.event.status).toBeNull();
    expect(result.event.currentPeriodEnd).toBeNull();
    expect(result.event.userId).toBe(42);
    expect(result.event.oneTimeGrant).toEqual({ periodDays: 365 });
    expect(result.event.occurredAt).toBe(Date.parse('2026-09-26T04:00:00Z'));
  });

  it('attach 缺失时从 out_trade_no 兜底取 userId', async () => {
    const outTradeNo = buildWechatOutTradeNo(42, 1_700_000_000_000, 'deadbeef');
    const fixture = buildPaymentWebhook({
      outTradeNo,
      attach: null,
      timestampSeconds: Math.floor(NOW / 1000),
    });
    const result = await adapter.verifyWebhook(fixture.body, fixture.headers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.userId).toBe(42);
  });

  it('attach 与订单号都取不到 userId 时 userId = null（不猜）', async () => {
    const fixture = buildPaymentWebhook({
      outTradeNo: 'third-party-order',
      attach: 'nonsense',
      timestampSeconds: Math.floor(NOW / 1000),
    });
    const result = await adapter.verifyWebhook(fixture.body, fixture.headers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.userId).toBeNull();
  });

  it('header 名大小写不敏感（Node/Fastify 可能给大写）', async () => {
    const fixture = buildPaymentWebhook({ timestampSeconds: Math.floor(NOW / 1000) });
    const upper = {
      'Wechatpay-Signature': fixture.headers['wechatpay-signature'],
      'Wechatpay-Timestamp': fixture.headers['wechatpay-timestamp'],
      'Wechatpay-Nonce': fixture.headers['wechatpay-nonce'],
    };
    const result = await adapter.verifyWebhook(fixture.body, upper);
    expect(result.ok).toBe(true);
  });
});

describe('wechat adapter — 接口语义', () => {
  it('mapSubscriptionState 恒 null（微信没有订阅状态机）', () => {
    const adapter = createAdapter();
    expect(adapter.mapSubscriptionState('SUCCESS')).toBeNull();
    expect(adapter.mapSubscriptionState({ any: 'thing' })).toBeNull();
    expect(adapter.mapSubscriptionState(undefined)).toBeNull();
  });

  it('revokeEntitlement 走注入端口；未注入时是空操作且**没有任何删除**', async () => {
    const seen: unknown[] = [];
    const withPort = createAdapter({
      onRevoke: async (input) => {
        seen.push(input);
      },
    });
    await withPort.revokeEntitlement({
      externalSubscriptionId: '',
      reason: 'refund',
      occurredAt: 1,
    });
    expect(seen).toHaveLength(1);

    const bare = createAdapter();
    // adapter 上不存在任何 delete；回收只改状态（无端口时什么都不做）。
    expect(Object.keys(bare).sort()).toEqual([
      'createCheckout',
      'mapSubscriptionState',
      'provider',
      'revokeEntitlement',
      'verifyWebhook',
    ]);
    await expect(
      bare.revokeEntitlement({ externalSubscriptionId: '', reason: 'refund', occurredAt: 1 }),
    ).resolves.toBeUndefined();
  });

  it('provider 名是 wechat（与 /webhooks/wechat 路径一致）', () => {
    expect(createAdapter().provider).toBe('wechat');
  });
});

describe('wechat adapter — 🔴 金额校验（付的钱必须落在价目表上）', () => {
  const NOW = Date.parse('2026-09-26T12:00:00+08:00');
  const adapter = createAdapter({ now: () => NOW });

  const fixtureWithAmount = (amountFen: number | undefined, opts: Record<string, unknown> = {}) =>
    buildWechatPaymentWebhook({
      privateKey,
      timestampSeconds: Math.floor(NOW / 1000),
      outTradeNo: buildWechatOutTradeNo(42, 1_700_000_000_000, 'deadbeef'),
      ...(amountFen === undefined ? {} : { amountFen }),
      ...opts,
    });

  it('付对金额（9_900 = ¥99）→ 授予 365 天', async () => {
    const f = fixtureWithAmount(9_900);
    const r = await adapter.verifyWebhook(f.body, f.headers);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.eventType).toBe('payment_succeeded');
    expect(r.event.oneTimeGrant).toEqual({ periodDays: 365 });
  });

  it('🔴 只付 ¥1 → **不授予任何权益**，并落成金额不符事件', async () => {
    const f = fixtureWithAmount(1);
    const r = await adapter.verifyWebhook(f.body, f.headers);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 这是这个校验存在的全部理由：一笔错价的订单不许换来整整一年。
    expect(r.event.oneTimeGrant).toBeNull();
    // 但要留下可查的痕迹，而不是悄悄当成正常支付。
    expect(r.event.eventType).toBe('payment_amount_mismatch');
  });

  it('金额字段缺失 → 同样不授予（不因为"没写"就放行）', async () => {
    const f = fixtureWithAmount(undefined, { omitAmount: true });
    const r = await adapter.verifyWebhook(f.body, f.headers);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.oneTimeGrant).toBeNull();
    expect(r.event.eventType).toBe('payment_amount_mismatch');
  });

  it('金额为 0 → 不授予', async () => {
    const f = fixtureWithAmount(0);
    const r = await adapter.verifyWebhook(f.body, f.headers);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.oneTimeGrant).toBeNull();
  });

  it('篡改金额过不了验签（密文受签名保护）', async () => {
    const f = fixtureWithAmount(9_900);
    const tampered = Buffer.from(f.body.toString('utf8').replace('ciphertext', 'ciphertexT'));
    await expect(adapter.verifyWebhook(tampered, f.headers)).resolves.toEqual({
      ok: false,
      reason: 'invalid-signature',
    });
  });

  it('运营者自定义价目表时，按自定义金额校验', async () => {
    const custom = createAdapter({
      now: () => NOW,
      prices: { annual: { totalFen: 19_900, description: '促销' } },
    });

    const ok = fixtureWithAmount(19_900);
    const r1 = await custom.verifyWebhook(ok.body, ok.headers);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.event.oneTimeGrant).toEqual({ periodDays: 365 });

    // 默认的 9_900 在自定义价目表下**不再**被接受 —— 证明校验读的是
    // 实际生效的价目表，而不是写死的 9900。
    const stale = fixtureWithAmount(9_900);
    const r2 = await custom.verifyWebhook(stale.body, stale.headers);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.event.oneTimeGrant).toBeNull();
  });

  it('金额不符的事件仍然通过验签与幂等（是"拒绝授予"，不是"拒绝事件"）', async () => {
    const f = fixtureWithAmount(1);
    const r = await adapter.verifyWebhook(f.body, f.headers);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 事件本身照常落库（幂等键还是 out_trade_no）—— 我们要能**查到**这笔异常，
    // 但是不授予权益。把它整个丢掉会让"有人付错价"变成一个看不见的事件。
    expect(r.event.providerEventId).toBe(
      `payment_succeeded:${buildWechatOutTradeNo(42, 1_700_000_000_000, 'deadbeef')}`,
    );
    expect(r.event.userId).toBe(42);
    expect(r.event.provider).toBe('wechat');
  });
});

