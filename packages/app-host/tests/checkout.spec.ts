/**
 * 收银台客户端的测试。
 *
 * 🔴 这一组的核心不是"解析对不对"，而是两条**收钱路径上的形状**：
 *
 * 1. **请求体里没有金额字段。** 让客户端传金额 = 让客户端决定收多少钱。
 *    这里不看注释，直接抓取真正传进 `fetch` 的 body 断言**键集合**。
 * 2. **陌生失败不许被说成成功。** 2xx 但既没有支付码也没有跳转地址 ⇒ `failed`，
 *    而不是"打开了一个空的付款面板"。
 *
 * 另一半是**不发请求**的那两种情形（未配置 / 未登录）——
 * 它们必须是零请求，而不是"发出去再失败"。
 */
import { describe, expect, it } from 'vitest';

import {
  CHECKOUT_PATH,
  RENEWAL_PRICE_ID,
  startCheckout,
  type StartCheckoutOptions,
} from '../src/checkout.js';

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

const SUCCESS_BODY = {
  orderId: 7,
  outTradeNo: 'hy1x2x3',
  priceId: RENEWAL_PRICE_ID,
  currency: 'CNY',
  originalAmountMinor: 500,
  discountMinor: 0,
  amountMinor: 500,
  expiresAt: 1_800_000_000_000,
  rejectedCoupons: [
    { couponId: null, rawCode: 'HELLO', reason: 'NOT_FOUND', explanation: '这个码不存在' },
  ],
  qrCode: 'weixin://wxpay/bizpayurl?pr=abc',
};

function recordingFetch(
  responder: () => { status: number; body?: unknown; jsonThrows?: boolean } | { throws: true },
): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const spec = responder();
    if ('throws' in spec) return Promise.reject(new Error('offline'));
    return Promise.resolve({
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      json: () =>
        spec.jsonThrows === true
          ? Promise.reject(new Error('not json'))
          : Promise.resolve(spec.body),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const base = (over: Partial<StartCheckoutOptions> = {}): StartCheckoutOptions => ({
  baseUrl: 'https://sync.example.com',
  getToken: () => Promise.resolve('token-123'),
  ...over,
});

describe('startCheckout', () => {
  it('未配置服务端时一个请求都不发', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200, body: SUCCESS_BODY }));
    const outcome = await startCheckout(base({ baseUrl: '  ', fetchImpl: impl }));
    expect(outcome).toEqual({ kind: 'failed', code: 'UNCONFIGURED', status: null });
    expect(calls).toHaveLength(0);
  });

  it('未登录时一个请求都不发（也不把 undefined 拼进 Authorization）', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200, body: SUCCESS_BODY }));
    const outcome = await startCheckout(base({ getToken: () => Promise.resolve(undefined), fetchImpl: impl }));
    expect(outcome).toEqual({ kind: 'failed', code: 'UNAUTHORIZED', status: null });
    expect(calls).toHaveLength(0);
  });

  it('🔴 请求体的键集合恰好是档位（可选再加券码）—— 没有任何金额字段', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200, body: SUCCESS_BODY }));
    await startCheckout(base({ fetchImpl: impl }));
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ priceId: RENEWAL_PRICE_ID });

    const withCoupon = recordingFetch(() => ({ status: 200, body: SUCCESS_BODY }));
    await startCheckout(base({ fetchImpl: withCoupon.impl, couponCode: '  HELLO-2026  ' }));
    expect(JSON.parse(String(withCoupon.calls[0]?.init?.body))).toEqual({
      priceId: RENEWAL_PRICE_ID,
      couponCode: 'HELLO-2026',
    });

    // 空白券码不该变成一个空串字段（服务端会把它当成"用户敲了一个码"）。
    const blank = recordingFetch(() => ({ status: 200, body: SUCCESS_BODY }));
    await startCheckout(base({ fetchImpl: blank.impl, couponCode: '   ' }));
    expect(Object.keys(JSON.parse(String(blank.calls[0]?.init?.body)) as object)).toEqual(['priceId']);
  });

  it('POST 到收银台端点，带 Bearer，方法是 POST', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200, body: SUCCESS_BODY }));
    await startCheckout(base({ fetchImpl: impl }));
    expect(calls[0]?.url).toBe(`https://sync.example.com${CHECKOUT_PATH}`);
    expect(calls[0]?.init?.method).toBe('POST');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-123');
  });

  it('扫码通道：透出支付串、金额、失效时间与券码被拒原因', async () => {
    const { impl } = recordingFetch(() => ({ status: 200, body: SUCCESS_BODY }));
    const outcome = await startCheckout(base({ fetchImpl: impl }));
    expect(outcome).toEqual({
      kind: 'qr',
      outTradeNo: 'hy1x2x3',
      codeUrl: 'weixin://wxpay/bizpayurl?pr=abc',
      currency: 'CNY',
      amountMinor: 500,
      expiresAt: 1_800_000_000_000,
      rejectedCoupons: [{ rawCode: 'HELLO', reason: 'NOT_FOUND', explanation: '这个码不存在' }],
    });
  });

  it('跳转通道：认得 redirectUrl（今天没有这种 adapter，但不许把 2xx 判成失败）', async () => {
    const { impl } = recordingFetch(() => ({
      status: 200,
      body: { ...SUCCESS_BODY, qrCode: undefined, redirectUrl: 'https://pay.example.com/x' },
    }));
    const outcome = await startCheckout(base({ fetchImpl: impl }));
    expect(outcome).toMatchObject({ kind: 'redirect', redirectUrl: 'https://pay.example.com/x' });
  });

  it('🔴 2xx 但既没码也没跳转地址 = 失败，不是"打开了一个空付款面板"', async () => {
    const { impl } = recordingFetch(() => ({
      status: 200,
      body: { ...SUCCESS_BODY, qrCode: undefined, redirectUrl: undefined },
    }));
    expect(await startCheckout(base({ fetchImpl: impl }))).toEqual({
      kind: 'failed',
      code: 'UNEXPECTED_RESPONSE',
      status: 200,
    });
  });

  it('🔴 只有服务端词表里的失败码才照原样报；陌生码归成 UNEXPECTED_RESPONSE（不替服务端编语义）', async () => {
    for (const code of ['BILLING_PROVIDER_NOT_CONFIGURED', 'PRICE_NOT_SELLABLE', 'PROVIDER_CURRENCY_UNSUPPORTED'] as const) {
      const { impl } = recordingFetch(() => ({ status: 503, body: { error: code } }));
      expect(await startCheckout(base({ fetchImpl: impl }))).toMatchObject({ kind: 'failed', code });
    }
    const { impl } = recordingFetch(() => ({ status: 418, body: { error: 'SOMETHING_NEW' } }));
    expect(await startCheckout(base({ fetchImpl: impl }))).toEqual({
      kind: 'failed',
      code: 'UNEXPECTED_RESPONSE',
      status: 418,
    });
  });

  it('失败但没有 JSON 时按状态码归类（401 / 502 / 503）', async () => {
    const cases: readonly [number, string][] = [
      [401, 'UNAUTHORIZED'],
      [502, 'CHECKOUT_FAILED'],
      [503, 'BILLING_PROVIDER_NOT_CONFIGURED'],
      [409, 'PRICE_NOT_EFFECTIVE'],
    ];
    for (const [status, code] of cases) {
      const { impl } = recordingFetch(() => ({ status, jsonThrows: true }));
      expect(await startCheckout(base({ fetchImpl: impl }))).toMatchObject({ kind: 'failed', code, status });
    }
  });

  it('断网归一成 NETWORK_ERROR，从不抛', async () => {
    const { impl } = recordingFetch(() => ({ throws: true }));
    expect(await startCheckout(base({ fetchImpl: impl }))).toEqual({
      kind: 'failed',
      code: 'NETWORK_ERROR',
      status: null,
    });
  });

  it('缺字段的 2xx（没有金额 / 没有失效时间）也是失败', async () => {
    const { impl } = recordingFetch(() => ({
      status: 200,
      body: { outTradeNo: 'x', qrCode: 'weixin://y', currency: 'CNY' },
    }));
    expect(await startCheckout(base({ fetchImpl: impl }))).toMatchObject({
      kind: 'failed',
      code: 'UNEXPECTED_RESPONSE',
    });
  });

  it('🔴 qrCode 是空串 = 失败：不许把"付不了款的空串"当成打开了付款面板', async () => {
    const { impl } = recordingFetch(() => ({
      status: 200,
      body: { ...SUCCESS_BODY, qrCode: '' },
    }));
    expect(await startCheckout(base({ fetchImpl: impl }))).toEqual({
      kind: 'failed',
      code: 'UNEXPECTED_RESPONSE',
      status: 200,
    });
  });

  it('券码被拒列表形状坏了不抛：非数组当没有，行里没 rawCode 就丢掉那一行', async () => {
    const notArray = recordingFetch(() => ({
      status: 200,
      body: { ...SUCCESS_BODY, rejectedCoupons: 'HELLO' },
    }));
    expect(await startCheckout(base({ fetchImpl: notArray.impl }))).toMatchObject({
      kind: 'qr',
      rejectedCoupons: [],
    });

    const blankRow = recordingFetch(() => ({
      status: 200,
      body: { ...SUCCESS_BODY, rejectedCoupons: [{ reason: 'X', explanation: '' }] },
    }));
    expect(await startCheckout(base({ fetchImpl: blankRow.impl }))).toMatchObject({
      kind: 'qr',
      rejectedCoupons: [],
    });
  });

  it('🔴 服务端点名了的码**优先于**状态码（500 上的 CHECKOUT_FAILED 不降级成 UNEXPECTED_RESPONSE）；没点名的才落到状态码', async () => {
    const named = recordingFetch(() => ({ status: 500, body: { error: 'CHECKOUT_FAILED' } }));
    expect(await startCheckout(base({ fetchImpl: named.impl }))).toEqual({
      kind: 'failed',
      code: 'CHECKOUT_FAILED',
      status: 500,
    });

    for (const unnamed of [{ error: { code: 'X' } }, { error: 42 }, {}]) {
      const { impl } = recordingFetch(() => ({ status: 500, body: unnamed }));
      expect(await startCheckout(base({ fetchImpl: impl }))).toEqual({
        kind: 'failed',
        code: 'UNEXPECTED_RESPONSE',
        status: 500,
      });
    }
  });
});
