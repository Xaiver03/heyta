import { describe, it, expect } from 'vitest';
import { createSign, createVerify } from 'node:crypto';
import {
  WECHAT_API_BASE_URL,
  WECHAT_NATIVE_PATH,
  WECHAT_PROVIDER,
  WECHAT_REFUND_EVENT_STATUS,
  WECHAT_REFUND_PATH,
  WECHAT_REFUND_STATUS_MAP,
  WECHAT_SIGNATURE_MAX_AGE_MS,
  WECHAT_SUPPORTED_CURRENCIES,
  WechatApiError,
  WechatInvalidRefundNoError,
  WechatRefundExceedsPaymentError,
  WechatUnsupportedCurrencyError,
  buildRequestSignatureMessage,
  buildWechatAuthorizationHeader,
  buildWechatOutTradeNo,
  buildWechatRefundEventId,
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
import type { CreateRefundInput } from '../src/billing/types';
import {
  TEST_WECHAT_API_V3_KEY,
  TEST_WECHAT_APP_ID,
  TEST_WECHAT_MCH_ID,
  TEST_WECHAT_NOTIFY_URL,
  TEST_WECHAT_SERIAL_NO,
  buildWechatPaymentWebhook,
  buildWechatRefundWebhook,
  createWechatTestKeyPair,
  encryptWechatResource,
  type WechatRefundWebhookFixtureOptions,
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
  amountFen?: number;
}): WebhookFixture =>
  buildWechatPaymentWebhook({
    privateKey: opts.signingPrivateKey ?? privateKey,
    timestampSeconds: opts.timestampSeconds,
    outTradeNo:
      opts.outTradeNo ?? buildWechatOutTradeNo(42, 1_700_000_000_000, 'deadbeef'),
    ...(opts.attach === undefined ? {} : { attach: opts.attach }),
    ...(opts.amountFen === undefined ? {} : { amountFen: opts.amountFen }),
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
      priceId: 'hosted-monthly',
      // 🔴 **故意不等于 hosted-monthly 的基线价 500**：这是"¥5 用了 ¥1 券"的一单。
      // adapter 必须签出**传进来的**这个数，而不是自己回价目表里查基线 ——
      // 回查就是"运营者改价之后收银台仍按旧价下单"那个静默少收钱的形状。
      amountMinor: 400,
      currency: 'CNY',
      successUrl: 'https://app.example.test/ok',
      cancelUrl: 'https://app.example.test/cancel',
    });

    expect(result).toEqual({ qrCode: 'weixin://wxpay/bizpayurl?pr=abc123' });
    expect(captured!.url).toBe(`${WECHAT_API_BASE_URL}${WECHAT_NATIVE_PATH}`);

    const body = JSON.parse(String(captured!.init.body)) as Record<string, unknown>;
    expect(body.appid).toBe(APP_ID);
    expect(body.mchid).toBe(MCH_ID);
    // 400 而不是基线 500：金额来自入参（这一单用了 ¥1 券），
    // 价目表只提供 description。
    expect(body.amount).toEqual({ total: 400, currency: 'CNY' });
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

  it('🔴 用调用方冻结的 outTradeNo + 实付金额下单 —— 库里的单与微信的单必须同源', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({ code_url: 'weixin://wxpay/bizpayurl?pr=frozen01' }),
      };
    }) as unknown as typeof fetch;

    // 调用方（计价层）在 `createOrderWithReservation` 时冻结进
    // `checkout_orders.out_trade_no` 的那个号 —— adapter 必须**原样**使用。
    const frozenOutTradeNo = buildWechatOutTradeNo(42, NOW, 'a1b2c3d4e5f60718');
    const adapter = createAdapter({ fetchImpl, now: () => NOW });
    await adapter.createCheckout({
      userId: 42,
      priceId: 'hosted-monthly',
      // ¥5 用 ¥1 券 → 冻结后的实付（400 分，不在价目表上）。
      amountMinor: 400,
      currency: 'CNY',
      outTradeNo: frozenOutTradeNo,
      description: 'heyta 官方托管月付（已用 ¥1 券）',
      successUrl: 'https://app.example.test/ok',
      cancelUrl: 'https://app.example.test/cancel',
    });

    const body = JSON.parse(String(captured!.init.body)) as Record<string, unknown>;
    // ① 订单号是调用方给的那一个，**不是** adapter 自己生成的 ——
    //    否则回调按订单号查 `checkout_orders` 会 `unknown-order`，钱到账却授予不出去。
    expect(body.out_trade_no).toBe(frozenOutTradeNo);
    // ② 金额是**冻结后的实付**，不是价目表全额（这条就是 §5.1 的核心）。
    expect(body.amount).toEqual({ total: 400, currency: 'CNY' });
    // ③ 商品名可覆盖（价目表只提供默认值）。
    expect(body.description).toBe('heyta 官方托管月付（已用 ¥1 券）');
  });

  it('🔴 调用方给的 outTradeNo 不可用 → 在收钱之前就拒', async () => {
    const adapter = createAdapter({
      fetchImpl: (async () => {
        throw new Error('不该发请求');
      }) as unknown as typeof fetch,
      now: () => NOW,
    });

    const bad: readonly (readonly [string, RegExp])[] = [
      ['', /不是非空字符串/],
      ['   ', /不是非空字符串/],
      ['x'.repeat(33), /超过微信上限 32/],
      // 解得出 userId，但是**别人**的（42 的单配了 43 的号）。
      [buildWechatOutTradeNo(43, NOW, 'deadbeef'), /解不出 userId=42/],
      // 解不出 userId 的形状：attach 丢失时这一单会归不到人。
      ['order-123', /解不出 userId=42/],
    ];
    for (const [outTradeNo, message] of bad) {
      await expect(
        adapter.createCheckout({
          userId: 42,
          priceId: 'hosted-monthly',
          amountMinor: 9_900,
          currency: 'CNY',
          outTradeNo,
          successUrl: 'https://a.test',
          cancelUrl: 'https://a.test',
        }),
      ).rejects.toThrow(message);
    }
  });

  it('description 是空串 → 拒（微信要求非空，本地拒比通道拒可读）', async () => {
    const adapter = createAdapter({
      fetchImpl: (async () => {
        throw new Error('不该发请求');
      }) as unknown as typeof fetch,
    });
    await expect(
      adapter.createCheckout({
        userId: 1,
        priceId: 'hosted-monthly',
        amountMinor: 9_900,
        currency: 'CNY',
        description: '  ',
        successUrl: 'https://a.test',
        cancelUrl: 'https://a.test',
      }),
    ).rejects.toThrow(/description/);
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
        amountMinor: 9_900,
        currency: 'CNY',
        successUrl: 'https://a.test',
        cancelUrl: 'https://a.test',
      }),
    ).rejects.toThrow(/priceId/);
  });

  it('🔴 金额不是正整数 → 抛错，绝不"兜"成 0 元或基线价', async () => {
    const adapter = createAdapter({
      fetchImpl: (async () => {
        throw new Error('不该发请求');
      }) as unknown as typeof fetch,
    });

    // 0 / 负数 / 小数 / NaN / 字符串：每一种都必须是硬错误。
    // 0 元单在计价层就被拒（MIN_CHARGEABLE_AMOUNT_MINOR），但 adapter 也不能
    // 依赖上游一定守规矩 —— 它自己是"最后一步"，兜底成基线价就是静默错账。
    for (const bad of [0, -1, 500.5, Number.NaN, Number.POSITIVE_INFINITY, '500']) {
      await expect(
        adapter.createCheckout({
          userId: 1,
          priceId: 'hosted-monthly',
          amountMinor: bad as unknown as number,
          currency: 'CNY',
          successUrl: 'https://a.test',
          cancelUrl: 'https://a.test',
        }),
      ).rejects.toThrow(/金额必须是正整数最小单位/);
    }
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
        priceId: 'hosted-monthly',
        amountMinor: 9_900,
        currency: 'CNY',
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
        priceId: 'hosted-monthly',
        amountMinor: 9_900,
        currency: 'CNY',
        successUrl: 'https://a.test',
        cancelUrl: 'https://a.test',
      }),
    ).rejects.toMatchObject({ apiCode: 'MISSING_CODE_URL' });
  });

  it('🔴 USD 单 → 在签名 / 发请求**之前**就拒（金额数值在币种之间不可比）', async () => {
    // 这个洞的形状：`amountMinor` 只是"最小单位整数"，不带币种。USD 的 500 与
    // CNY 的 500 数值相等、语义差约 7 倍。曾经这个文件把 currency 硬编码成
    // 'CNY'，于是「报价冻了 USD、通道签出 CNY」——金额对得上、币种对不上，
    // 没有任何一层会报错，而结算只比金额，照样授予权益。
    let called = false;
    const adapter = createAdapter({
      now: () => 1_700_000_000_000,
      fetchImpl: (async () => {
        called = true;
        throw new Error('不该发请求');
      }) as unknown as typeof fetch,
    });

    await expect(
      adapter.createCheckout({
        userId: 42,
        priceId: 'hosted-monthly',
        amountMinor: 500,
        currency: 'USD',
        successUrl: 'https://a.test',
        cancelUrl: 'https://a.test',
      }),
    ).rejects.toBeInstanceOf(WechatUnsupportedCurrencyError);

    // 🔴 关键断言：失败发生在**任何网络调用之前**。扣的是本地校验，
    //    不是一笔已经发给微信、用户还能扫码付款的单。
    expect(called).toBe(false);
  });

  it('声明的能力与执行同源：supportedCurrencies 就是那道校验的判据', async () => {
    const adapter = createAdapter({ now: () => 1_700_000_000_000 });

    // 声明本身就是"这个通道能收什么"的事实源，收银台按它选通道。
    expect(adapter.supportedCurrencies).toEqual(['CNY']);
    expect(WECHAT_SUPPORTED_CURRENCIES).toEqual(['CNY']);

    // 反过来：声明里没有的币种，`createCheckout` 一定拒 —— 声明要是装饰，
    // 收银台就会按声明选通道、adapter 却照收（这正是"声明与实现漂移"的形状）。
    await expect(
      adapter.createCheckout({
        userId: 42,
        priceId: 'hosted-monthly',
        amountMinor: 500,
        currency: 'USD',
        successUrl: 'https://a.test',
        cancelUrl: 'https://a.test',
      }),
    ).rejects.toThrow(/只支持 CNY/);
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
    const original = fixture.headers['wechatpay-signature'];

    // 🔴 这里不能写成 `'A' + sig.slice(1)`：签名是 base64，首位本来就有 1/64 的
    // 概率就是 'A'。撞上时"被改坏"的签名与原签名**逐字节相同**，这条断言会悄悄
    // 退化成"原签名能通过" —— 而它全部的意义就是证明原签名不能通过。
    // payload 一变签名就变，所以这是个只要有人改 fixture 就会炸的隐藏地雷：
    // 显式挑一个与原首位**不同**的字符，并把这一点钉住。
    const flippedSignature = `${original[0] === 'A' ? 'B' : 'A'}${original.slice(1)}`;
    expect(flippedSignature).not.toBe(original);

    const broken = { ...fixture.headers, 'wechatpay-signature': flippedSignature };
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

  it('🔴 只认 `TRANSACTION.SUCCESS` 与那三种退款终态；其它事件类型仍然明确拒绝', async () => {
    // 这条以前写的是"只认 TRANSACTION.SUCCESS"，而它当时用的例子就是 `REFUND.SUCCESS`。
    // 2026-10-05 ADR-0053 接进退款通知之后那句话不再成立 —— 改例子，**不改判据的形状**：
    // 词表外的事件仍然必须是 401 而不是静默忽略（静默忽略会落一条 PaymentEvent
    // 却没有对应语义，比 401 更难排查）。
    for (const eventType of [
      'REFUND.PROCESSING',
      'TRADE_CANCEL_SUCCESS',
      'DOWNLOADBILL_SUCCESS',
    ]) {
      const fixture = buildPaymentWebhook({
        timestampSeconds: Math.floor(NOW / 1000),
        eventType,
      });
      await expect(
        adapter.verifyWebhook(fixture.body, fixture.headers),
        eventType,
      ).resolves.toEqual({ ok: false, reason: 'unsupported-event-type' });
    }
    // 三种终态在词表内（正例在下面那组退款通知用例里逐条走）。
    expect(Object.keys(WECHAT_REFUND_EVENT_STATUS).sort()).toEqual([
      'REFUND.ABNORMAL',
      'REFUND.CLOSED',
      'REFUND.SUCCESS',
    ]);
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
    expect(result.event.oneTimeGrant).toEqual({
      periodDays: 30,
      priceId: 'hosted-monthly',
      grants: ['hosting'],
    });
    // 🔴 商户订单号与**原始到账金额**必须显式带在事件上：webhook 要靠订单号
    //    去 `checkout_orders` 结算，靠这个金额与订单**冻结的实付**比对。
    //    此前订单号只存在于 `providerEventId` 的字符串里，签署金额根本没带出来。
    expect(result.event.outTradeNo).toBe(outTradeNo);
    expect(result.event.paidAmountMinor).toBe(500);
    expect(result.event.occurredAt).toBe(Date.parse('2026-09-26T04:00:00Z'));
  });

  it('🔴 金额对不上任何档位时仍然带出**原始金额**（这是回执事实，不是判定）', async () => {
    const outTradeNo = buildWechatOutTradeNo(42, 1_700_000_000_000, 'deadbeef');
    const fixture = buildPaymentWebhook({
      outTradeNo,
      amountFen: 4321,
      timestampSeconds: Math.floor(NOW / 1000),
    });
    const result = await adapter.verifyWebhook(fixture.body, fixture.headers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.paidAmountMinor).toBe(4321);
    expect(result.event.outTradeNo).toBe(outTradeNo);
    // 推不出档位 → 交给订单结算；但金额本身照样带出来（结算才有得比）。
    expect(result.event.oneTimeGrant).toBeNull();
    expect(result.event.requiresOrderSettlement).toBe(true);
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
    // `supportedCurrencies` 是收银台选通道的唯一判据（见 `BillingAdapter`），
    // 所以它必须出现在这个**穷举**的接口形状断言里，而不是被漏掉。
    expect(Object.keys(bare).sort()).toEqual([
      'createCheckout',
      'mapSubscriptionState',
      'provider',
      'refund',
      'revokeEntitlement',
      'supportedCurrencies',
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

  it('付对金额（500 = ¥5）→ 授予 30 天，且带上**档位与能力**', async () => {
    const f = fixtureWithAmount(500);
    const r = await adapter.verifyWebhook(f.body, f.headers);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.eventType).toBe('payment_succeeded');
    // 🔴 不只是"30 天"：还要说清买的是**哪一档**、授予**哪几项能力**。
    // 只带天数的话 ¥5 与 ¥12 会落成同一行订阅 —— 付 ¥12 拿到 ¥5 的东西。
    expect(r.event.oneTimeGrant).toEqual({
      periodDays: 30,
      priceId: 'hosted-monthly',
      grants: ['hosting'],
    });
  });

  it('🔴 付 ¥12（1200）→ 授予的是 hosted-ai-monthly，能力含 `ai`', async () => {
    const f = fixtureWithAmount(1_200);
    const r = await adapter.verifyWebhook(f.body, f.headers);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.eventType).toBe('payment_succeeded');
    // 这一条就是"两档真的可分"的证据：同样的 30 天，能力集合不同。
    expect(r.event.oneTimeGrant).toEqual({
      periodDays: 30,
      priceId: 'hosted-ai-monthly',
      grants: ['hosting', 'ai', 'automation'],
    });
  });

  it('🔴 只付 ¥1 → **不授予任何权益**，并标成"待订单结算"（不是"无事发生"）', async () => {
    const f = fixtureWithAmount(1);
    const r = await adapter.verifyWebhook(f.body, f.headers);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 这是这个校验存在的全部理由：一笔错价的订单不许换来整整一个月。
    expect(r.event.oneTimeGrant).toBeNull();
    // 但要留下可查的痕迹，而不是悄悄当成正常支付。
    expect(r.event.eventType).toBe('payment_amount_mismatch');
    // 🔴 关键：**观察到了钱、却落不到档位**。这正是"有券的单会被静默拒付"
    // 那个洞的形状（¥12 档用券 → 实付落不到任何档位原价）。以前它与退款 /
    // 对账通知拿到同一个原因 `NO_SUBSCRIPTION_REFERENCE` —— 对一笔真实到账的
    // 支付是假话。现在它被显式标成"需要权威结算"。
    expect(r.event.requiresOrderSettlement).toBe(true);
  });

  it('金额字段缺失 → 不授予，但**不算**"待结算"（没有钱，就不该伪装成一笔待结算的支付）', async () => {
    const f = fixtureWithAmount(undefined, { omitAmount: true });
    const r = await adapter.verifyWebhook(f.body, f.headers);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.oneTimeGrant).toBeNull();
    expect(r.event.eventType).toBe('payment_amount_mismatch');
    expect(r.event.requiresOrderSettlement).toBe(false);
  });

  it('金额为 0 → 不授予', async () => {
    const f = fixtureWithAmount(0);
    const r = await adapter.verifyWebhook(f.body, f.headers);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.oneTimeGrant).toBeNull();
  });

  it('篡改金额过不了验签（密文受签名保护）', async () => {
    const f = fixtureWithAmount(500);
    const tampered = Buffer.from(f.body.toString('utf8').replace('ciphertext', 'ciphertexT'));
    await expect(adapter.verifyWebhook(tampered, f.headers)).resolves.toEqual({
      ok: false,
      reason: 'invalid-signature',
    });
  });

  it('运营者自定义价目表时，按自定义金额校验', async () => {
    const custom = createAdapter({
      now: () => NOW,
      prices: { 'hosted-monthly': { totalFen: 1_500, description: '促销' } },
    });

    const ok = fixtureWithAmount(1_500);
    const r1 = await custom.verifyWebhook(ok.body, ok.headers);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      // 档位还是 `hosted-monthly`（改价改的是金额，**不改档位**），能力也照旧。
      expect(r1.event.oneTimeGrant).toEqual({
        periodDays: 30,
        priceId: 'hosted-monthly',
        grants: ['hosting'],
      });
    }

    // 默认的 500 在自定义价目表下**不再**被接受 —— 证明校验读的是
    // 实际生效的价目表，而不是写死的 500。
    const stale = fixtureWithAmount(500);
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


describe('wechat adapter — refund()（stub fetch，🔴 没有真网络）', () => {
  const NOW = 1_700_000_000_000;
  const OUT_TRADE_NO = buildWechatOutTradeNo(42, 1_700_000_000_000, 'deadbeef');
  const OUT_REFUND_NO = 'hyrf7x1700000000xdeadbeef';

  const stub = (response: Record<string, unknown>, ok = true) => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return {
        ok,
        status: ok ? 200 : 400,
        json: async () => response,
      };
    }) as unknown as typeof fetch;
    return { adapter: createAdapter({ fetchImpl, now: () => NOW }), seen };
  };

  // 刻意用一次 cast：这一组喂的就是**类型上不该存在**的输入（`currency: 'EUR'`、
  // `refundAmountMinor: 12.5`），要验的正是运行时闸门而不是编译器。
  const baseInput = (over: Record<string, unknown> = {}): CreateRefundInput =>
    ({
      outTradeNo: OUT_TRADE_NO,
      outRefundNo: OUT_REFUND_NO,
      refundAmountMinor: 400,
      totalAmountMinor: 400,
      currency: 'CNY',
      ...over,
    }) as CreateRefundInput;

  it('POST /v3/refund/domestic/refunds：`amount.total` 是**实付**，`refund` 是**这一次退的额**', async () => {
    // 🔴 两个数**必须不相等**。两边都填 400 时，这条用例的名字断言的东西
    // 一个都没有断言到 —— 把 `total` 写成 `refundAmountMinor` 照样全绿
    // （实测：变异臂 8 存活）。不对称之后它才真的能红。
    const { adapter, seen } = stub({ refund_id: '5030000000000000000000000001', status: 'PROCESSING' });
    const result = await adapter.refund(
      baseInput({ refundAmountMinor: 200, totalAmountMinor: 400, reason: '运营已核实的客诉' }),
    );

    expect(result).toEqual({ providerRefundId: '5030000000000000000000000001', status: 'processing' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`${WECHAT_API_BASE_URL}${WECHAT_REFUND_PATH}`);

    const body = JSON.parse(String(seen[0]!.init.body)) as Record<string, unknown>;
    // 🔴 键集合逐字断言：多一个 `notify_url`、少一个 `total` 都是**协议**变化，
    // 而 `toMatchObject` 挡不住"多传了一个通道根本不认识的字段"。
    expect(Object.keys(body).sort()).toEqual([
      'amount',
      'out_refund_no',
      'out_trade_no',
      'reason',
    ]);
    expect(body.amount).toEqual({ refund: 200, total: 400, currency: 'CNY' });
    expect(body.out_trade_no).toBe(OUT_TRADE_NO);
    expect(body.out_refund_no).toBe(OUT_REFUND_NO);
  });

  it('🔴 不传 `reason` 就整个省略这一列 —— 不给一个"默认理由"', async () => {
    const { adapter, seen } = stub({ status: 'SUCCESS' });
    await adapter.refund(baseInput());
    const body = JSON.parse(String(seen[0]!.init.body)) as Record<string, unknown>;
    expect('reason' in body).toBe(false);
    // `reason` 会出现在**用户的微信账单**上：一个没人负责的句子不该由代码生成。
    expect(body).not.toHaveProperty('reason');
  });

  it('Authorization 的签名串覆盖的是**发出去的那一份 body**（一次序列化，不是两次）', async () => {
    const { adapter, seen } = stub({ status: 'PROCESSING' });
    await adapter.refund(baseInput({ reason: '  两端有空格的理由  ' }));

    const headers = seen[0]!.init.headers as Record<string, string>;
    const fields = Object.fromEntries(
      [...headers.Authorization.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    expect(
      fields.signature,
    ).toBe(
      signWechatRequest(
        {
          method: 'POST',
          url: WECHAT_REFUND_PATH,
          timestamp: Number(fields.timestamp),
          nonce: fields.nonce_str,
          body: String(seen[0]!.init.body),
        },
        privateKey,
      ),
    );
    // `reason` 被 trim 之后**同一个字符串**既进 body 又进签名。
    const body = JSON.parse(String(seen[0]!.init.body)) as Record<string, unknown>;
    expect(body.reason).toBe('两端有空格的理由');
  });

  it('四种通道状态各自映射；`PROCESSING` 是常态而不是失败', async () => {
    for (const [raw, mapped] of Object.entries(WECHAT_REFUND_STATUS_MAP)) {
      const { adapter } = stub({ refund_id: 'r-1', status: raw });
      expect(await adapter.refund(baseInput()), raw).toEqual({
        providerRefundId: 'r-1',
        status: mapped,
      });
    }
  });

  it('🔴 陌生的 `status` 抛，不归成 processing 也不归成 success', async () => {
    const { adapter } = stub({ refund_id: 'r-1', status: 'REFUND_PENDING_WECHAT_NEW' });
    const error = await adapter.refund(baseInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WechatApiError);
    expect((error as WechatApiError).apiCode).toBe('UNKNOWN_REFUND_STATUS');
  });

  it('HTTP 非 2xx → WechatApiError（带通道的 code，不吞掉）', async () => {
    const { adapter } = stub({ code: 'NOT_ENOUGH_PAY_AMOUNT', message: '余额不足' }, false);
    const error = await adapter.refund(baseInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WechatApiError);
    expect((error as WechatApiError).httpStatus).toBe(400);
    expect((error as WechatApiError).apiCode).toBe('NOT_ENOUGH_PAY_AMOUNT');
  });

  it('退款额超过实付 → 本地就抛，一个请求都不发', async () => {
    const { adapter, seen } = stub({ status: 'SUCCESS' });
    await expect(adapter.refund(baseInput({ refundAmountMinor: 401 }))).rejects.toBeInstanceOf(
      WechatRefundExceedsPaymentError,
    );
    // 🔴 抛在**发请求之前**才是这条判据的全部：否则一次误操作就已经在通道侧开了一张退款单。
    expect(seen).toHaveLength(0);
  });

  it('币种不在词表 / 金额不是正整数 / 号是空串 —— 四种坏输入都抛在出网前', async () => {
    const { adapter, seen } = stub({ status: 'SUCCESS' });
    for (const over of [
      { currency: 'EUR' },
      { refundAmountMinor: 0 },
      { refundAmountMinor: 12.5 },
      { totalAmountMinor: -1 },
      { outTradeNo: '' },
      { outRefundNo: '' },
    ]) {
      await expect(adapter.refund(baseInput(over)), JSON.stringify(over)).rejects.toThrow();
    }
    expect(seen).toHaveLength(0);
    await expect(adapter.refund(baseInput({ outRefundNo: '' }))).rejects.toBeInstanceOf(
      WechatInvalidRefundNoError,
    );
  });
});

describe('wechat adapter — 退款通知归一化（ADR-0053）', () => {
  const NOW = 1_700_000_000_000;
  const adapter = createAdapter({ now: () => NOW });
  const OUT_TRADE_NO = buildWechatOutTradeNo(42, 1_700_000_000_000, 'deadbeef');
  const OUT_REFUND_NO = 'hyrf7x1700000000xdeadbeef';

  const refundEvent = (over: Partial<WechatRefundWebhookFixtureOptions> = {}) =>
    buildWechatRefundWebhook({
      privateKey,
      timestampSeconds: Math.floor(NOW / 1000),
      outTradeNo: OUT_TRADE_NO,
      outRefundNo: OUT_REFUND_NO,
      refundId: '5030000000000000000000000002',
      ...over,
    });

  it('🔴 `REFUND.SUCCESS` 归一化出来的事件**给不出授予**：没有 oneTimeGrant、没有 userId', async () => {
    const f = refundEvent();
    const r = await adapter.verifyWebhook(f.body, f.headers);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 把它落到支付那条路径上 = **再发一次 30 天权益**。所以这两格必须是 null。
    expect(r.event.oneTimeGrant).toBeNull();
    expect(r.event.userId).toBeNull();
    expect(r.event.currentPeriodEnd).toBeNull();
    expect(r.event.status).toBeNull();
    expect(r.event.refundNotice).toEqual({
      outRefundNo: OUT_REFUND_NO,
      providerRefundId: '5030000000000000000000000002',
      status: 'success',
    });
  });

  it('幂等键带状态：同一笔退款的 ABNORMAL 之后转 SUCCESS 不会被前一条挡掉', () => {
    const abnormal = buildWechatRefundEventId(OUT_REFUND_NO, 'abnormal');
    const success = buildWechatRefundEventId(OUT_REFUND_NO, 'success');
    expect(abnormal).not.toBe(success);
    expect(success).toBe(`refund_success:${OUT_REFUND_NO}`);
    // 支付事件的键与退款的键不能撞：两套语义共用一张 `payment_events` 表。
    expect(success).not.toBe(`payment_succeeded:${OUT_TRADE_NO}`);
  });

  it('三种终态各自归一化；`CLOSED` / `ABNORMAL` 没有 success_time 也不编一个', async () => {
    for (const [eventType, status] of [
      ['REFUND.ABNORMAL', 'abnormal'],
      ['REFUND.CLOSED', 'closed'],
    ] as const) {
      const f = refundEvent({ eventType, refundStatus: status.toUpperCase(), successTime: null });
      const r = await adapter.verifyWebhook(f.body, f.headers);
      expect(r.ok, eventType).toBe(true);
      if (!r.ok) return;
      expect(r.event.refundNotice?.status).toBe(status);
      // `occurredAt` 回落到到达时间是**注释里写明的取舍**，不是漏字段：
      // 这条通知不参与订阅行的乱序闸门。
      expect(r.event.occurredAt).toBeGreaterThanOrEqual(NOW);
      expect(r.event.eventType).toBe(eventType);
    }
  });

  it('载荷里没有 `out_refund_no` → 拒（不能靠 `out_trade_no` 反推是哪张退款行）', async () => {
    // `refund_status` 缺失是允许的（以 `event_type` 为准，见下面那条冲突用例），
    // `out_refund_no` 缺失不是：它是 `refunds` 那一行的**唯一**寻址方式。
    const f = refundEvent({ omitOutRefundNo: true });
    expect(await adapter.verifyWebhook(f.body, f.headers)).toEqual({
      ok: false,
      reason: 'missing-out-refund-no',
    });
  });

  it('🔴 `refund_status` 与 `event_type` 互相矛盾 → 拒，不挑一个', async () => {
    const f = refundEvent({ eventType: 'REFUND.SUCCESS', refundStatus: 'ABNORMAL' });
    expect(await adapter.verifyWebhook(f.body, f.headers)).toEqual({
      ok: false,
      reason: 'refund-status-conflict',
    });
    // 两个值各自的下游动作**相反**（一个回收权益、一个不回收），所以"取哪个"不是风格问题。
    const consistent = refundEvent({ eventType: 'REFUND.ABNORMAL', refundStatus: 'ABNORMAL' });
    const r = await adapter.verifyWebhook(consistent.body, consistent.headers);
    expect(r.ok).toBe(true);
  });

  it('验签失败 / 时间戳过期对退款通知同样生效（同一道闸门，不是第二条）', async () => {
    const f = refundEvent();
    await expect(
      adapter.verifyWebhook(f.body, { ...f.headers, 'wechatpay-signature': 'bogus' }),
    ).resolves.toEqual({ ok: false, reason: 'invalid-signature' });

    const stale = refundEvent({ timestampSeconds: Math.floor(NOW / 1000) - 7200 });
    await expect(adapter.verifyWebhook(stale.body, stale.headers)).resolves.toEqual({
      ok: false,
      reason: 'stale-timestamp',
    });
  });
});
