import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WEBHOOK_PATH,
  PAYCENTER_PROVIDER,
  PAYCENTER_SUPPORTED_CURRENCIES,
  amountYuanToMinor,
  canonicalSignature,
  createPaycenterBillingAdapter,
  toProviderRefundStatus,
} from '../src/billing/paycenter.adapter';
import type { NormalizedPaymentEvent, OneTimeGrant } from '../src/billing/types';

const SECRET = '0123456789abcdef0123456789abcdef';
const CLIENT = 'heyta';

const grant: OneTimeGrant = { periodDays: 30, priceId: 'pro-monthly', grants: ['hosting'] };

const makeAdapter = (over: { fetchImpl?: typeof fetch; path?: string } = {}) =>
  createPaycenterBillingAdapter(
    {
      baseUrl: 'https://center.test',
      clientId: CLIENT,
      clientSecret: SECRET,
      ...(over.path ? { webhookPath: over.path } : {}),
    },
    {
      projectGrant: () => grant,
      ...(over.fetchImpl ? { fetchImpl: over.fetchImpl } : {}),
      now: () => 1776000000 * 1000,
    },
  );

const eventBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    event_type: 'payment.succeeded',
    source_system: CLIENT,
    external_order_id: 'SS-ORDER-1',
    external_customer_id: '42',
    out_trade_no: 'xc_heyta_20261018111422_888230',
    provider_trade_no: 'HF-1',
    amount: '30.00',
    currency: 'CNY',
    metadata: { user_id: 42 },
    ...over,
  });

const signedHeaders = (raw: string, over: Record<string, string> = {}) => {
  const ts = '1776000000';
  const idem = `payment-fulfillment:${CLIENT}:SS-ORDER-1`;
  return {
    'x-platform-client': CLIENT,
    'x-platform-timestamp': ts,
    'x-platform-signature': canonicalSignature(
      SECRET, 'POST', DEFAULT_WEBHOOK_PATH, Buffer.from(raw, 'utf8'), ts, idem,
    ),
    'idempotency-key': idem,
    ...over,
  };
};

describe('amountYuanToMinor', () => {
  it('两位小数才认', () => {
    expect(amountYuanToMinor('30.00')).toBe(3000);
    expect(amountYuanToMinor('0.01')).toBe(1);
  });
  it('格式不对回 null（不猜）', () => {
    for (const bad of ['30', '30.0', '30.000', '-1.00', '', null, 30, undefined]) {
      expect(amountYuanToMinor(bad), String(bad)).toBeNull();
    }
  });
});

describe('toProviderRefundStatus', () => {
  it('成功只有一种说法', () => {
    expect(toProviderRefundStatus('success')).toBe('success');
    expect(toProviderRefundStatus('SUCCEEDED')).toBe('success');
  });
  // 🔴 把 pending 报成 success 会让用户"一分钱没退到、权益却被砍掉"
  it('🔴 pending / 未知 一律 processing，绝不上报 success', () => {
    for (const raw of ['pending', '', undefined, '什么鬼']) {
      expect(toProviderRefundStatus(raw), String(raw)).toBe('processing');
    }
  });
  it('失败与关闭分开', () => {
    expect(toProviderRefundStatus('failed')).toBe('abnormal');
    expect(toProviderRefundStatus('closed')).toBe('closed');
  });
});

describe('adapter 形状', () => {
  it('provider 名与声明币种', () => {
    const a = makeAdapter();
    expect(a.provider).toBe(PAYCENTER_PROVIDER);
    expect(a.supportedCurrencies).toEqual(['CNY']);
    expect(PAYCENTER_SUPPORTED_CURRENCIES).toEqual(['CNY']);
  });
  it('没有订阅状态机（中心收的是一次性支付）', () => {
    expect(makeAdapter().mapSubscriptionState({ any: 'thing' })).toBeNull();
  });
  it('revokeEntitlement 无副作用、不抛', async () => {
    await expect(makeAdapter().revokeEntitlement({ externalSubscriptionId: 'x', reason: 'refund' })).resolves.toBeUndefined();
  });
});

describe('verifyWebhook —— 每条失败路径都必须返回 ok:false，绝不抛', () => {
  it('签名与事件都对 → 放行，并归一化', async () => {
    const raw = eventBody();
    const r = await makeAdapter().verifyWebhook(Buffer.from(raw, 'utf8'), signedHeaders(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.event.provider).toBe(PAYCENTER_PROVIDER);
    expect(r.event.outTradeNo).toBe('SS-ORDER-1');
    expect(r.event.userId).toBe(42);
    expect(r.event.paidAmountMinor).toBe(3000);
    expect(r.event.oneTimeGrant).toEqual(grant);
    // 中心收的是一次性支付：没有订阅对象
    expect(r.event.externalSubscriptionId).toBeNull();
    expect(r.event.status).toBeNull();
  });

  // 🔒 能区分的写法必须是**正向**的：让"原始字节"与"重新序列化"不同，
  // 且签名是对原始字节算的 ⇒ 正确实现放行、重新序列化的实现 401。
  it('🔒 原始字节带空白时仍放行（⇒ 验签用的是原始字节）', async () => {
    const raw = `{
      "event_type": "payment.succeeded",
      "source_system": "${CLIENT}",
      "external_order_id": "SS-ORDER-1",
      "out_trade_no": "xc_heyta_20261018111422_888230",
      "amount": "30.00",
      "currency": "CNY",
      "metadata": { "user_id": 42 }
    }`;
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);
    const r = await makeAdapter().verifyWebhook(Buffer.from(raw, 'utf8'), signedHeaders(raw));
    expect(r.ok).toBe(true);
  });

  it('重投拿到同一个 providerEventId（幂等键的来源）', async () => {
    const raw = eventBody();
    const a = makeAdapter();
    const first = await a.verifyWebhook(Buffer.from(raw, 'utf8'), signedHeaders(raw));
    const second = await a.verifyWebhook(Buffer.from(raw, 'utf8'), signedHeaders(raw));
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(second.event.providerEventId).toBe(first.event.providerEventId);
  });

  const rejections: Array<[string, (raw: string) => { raw: string; headers: Record<string, string> }]> = [
    ['客户端不符', (raw) => ({ raw, headers: signedHeaders(raw, { 'x-platform-client': 'someone-else' }) })],
    ['时间戳过期', (raw) => ({ raw, headers: signedHeaders(raw, { 'x-platform-timestamp': '1000000000' }) })],
    ['签名不符', (raw) => ({ raw, headers: signedHeaders(raw, { 'x-platform-signature': 'ff'.repeat(32) }) })],
    ['缺幂等键', (raw) => ({ raw, headers: signedHeaders(raw, { 'idempotency-key': '' }) })],
    ['body 非 JSON', () => ({ raw: 'not json', headers: signedHeaders('not json') })],
    ['事件类型不符', (raw) => ({ raw: eventBody({ event_type: 'payment.refunded' }), headers: signedHeaders(raw) })],
    ['金额格式不对', (raw) => ({ raw: eventBody({ amount: '30' }), headers: signedHeaders(raw) })],
    ['缺本仓单号', (raw) => ({ raw: eventBody({ external_order_id: '' }), headers: signedHeaders(raw) })],
  ];
  for (const [name, mutate] of rejections) {
    it(`${name} → ok:false（不抛）`, async () => {
      const base = eventBody();
      const { raw, headers } = mutate(base);
      const r = await makeAdapter().verifyWebhook(Buffer.from(raw, 'utf8'), headers);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('不该放行');
      expect(r.reason.length).toBeGreaterThan(0);
    });
  }

  it('⚠️ 挂载路径不同 ⇒ 签名对不上（这就是 webhookPath 必须可配的原因）', async () => {
    const raw = eventBody();
    // 用默认路径签，却让 adapter 按另一个路径验
    const r = await makeAdapter({ path: '/some/other/path' }).verifyWebhook(
      Buffer.from(raw, 'utf8'),
      signedHeaders(raw),
    );
    expect(r.ok).toBe(false);
  });

  it('userId 缺失时回 null（不猜一个用户）', async () => {
    const raw = eventBody({ metadata: {} });
    const r = await makeAdapter().verifyWebhook(Buffer.from(raw, 'utf8'), signedHeaders(raw));
    if (!r.ok) throw new Error('unreachable');
    expect(r.event.userId).toBeNull();
  });

  it('金额不在价目表上 ⇒ oneTimeGrant 为 null（不猜档位）', async () => {
    const a = createPaycenterBillingAdapter(
      { baseUrl: 'https://center.test', clientId: CLIENT, clientSecret: SECRET },
      { projectGrant: () => null, now: () => 1776000000 * 1000 },
    );
    const raw = eventBody();
    const r = await a.verifyWebhook(Buffer.from(raw, 'utf8'), signedHeaders(raw));
    if (!r.ok) throw new Error('unreachable');
    expect(r.event.oneTimeGrant).toBeNull();
  });
});

describe('createCheckout', () => {
  const base = {
    userId: 42,
    priceId: 'pro-monthly',
    amountMinor: 3000,
    currency: 'CNY' as const,
    outTradeNo: 'SS-ORDER-1',
    successUrl: 'https://heyta.test/ok',
    cancelUrl: 'https://heyta.test/cancel',
  };

  it('二维码通道 → qrCode；并带上本仓单号与金额', async () => {
    let sent: Record<string, unknown> = {};
    const a = makeAdapter({
      fetchImpl: (async (_u: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ qr_code: 'weixin://pay/1' }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await a.createCheckout(base)).toEqual({ qrCode: 'weixin://pay/1' });
    expect(sent.external_order_id).toBe('SS-ORDER-1');
    expect(sent.amount).toBe('30.00');
    expect(sent.payment_type).toBe('huifu');
  });

  it('跳转通道 → redirectUrl', async () => {
    const a = makeAdapter({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ pay_url: 'https://cashier/1' }), { status: 200 })) as unknown as typeof fetch,
    });
    expect(await a.createCheckout(base)).toEqual({ redirectUrl: 'https://cashier/1' });
  });

  // 🔴 绝不编一个假 URL：那会把用户引到一个不存在的收银台
  it('🔴 中心两个都没给 ⇒ 抛，不编假 URL', async () => {
    const a = makeAdapter({
      fetchImpl: (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch,
    });
    await expect(a.createCheckout(base)).rejects.toThrow(/neither qr_code nor pay_url/);
  });

  it('🔴 声明只收 CNY，就必须在收钱之前拒别的币种', async () => {
    const a = makeAdapter({ fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(a.createCheckout({ ...base, currency: 'USD' })).rejects.toThrow(/does not support USD/);
  });

  it('🔴 不给 outTradeNo ⇒ 抛（adapter 不得自行生成订单号）', async () => {
    const a = makeAdapter({ fetchImpl: vi.fn() as unknown as typeof fetch });
    const { outTradeNo: _omit, ...noOrderNo } = base;
    await expect(a.createCheckout(noOrderNo)).rejects.toThrow(/requires outTradeNo/);
  });
});

describe('refund', () => {
  const input = {
    outTradeNo: 'SS-ORDER-1',
    outRefundNo: 'REF-abc',
    refundAmountMinor: 3000,
    totalAmountMinor: 3000,
    currency: 'CNY' as const,
    reason: '用户申请',
  };

  it('用调用方给的退款单号作幂等键，并带回通道号', async () => {
    let sent: Record<string, unknown> = {};
    let idem = '';
    const a = makeAdapter({
      fetchImpl: (async (_u: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        idem = (init.headers as Record<string, string>)['Idempotency-Key'];
        return new Response(JSON.stringify({ refund_id: 'RF-1', status: 'success' }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const r = await a.refund(input);
    expect(r).toEqual({ providerRefundId: 'RF-1', status: 'success' });
    expect(idem).toBe('REF-abc');
    expect(sent.external_order_id).toBe('SS-ORDER-1');
    expect(sent.amount).toBe('30.00');
  });

  // 🔴 假的 success 会让用户"一分钱没退到、权益却被砍掉"
  it('🔴 中心回 pending ⇒ processing，绝不报 success', async () => {
    const a = makeAdapter({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ refund_id: 'RF-2', status: 'pending' }), { status: 200 })) as unknown as typeof fetch,
    });
    expect((await a.refund(input)).status).toBe('processing');
  });

  it('中心没给退款号 ⇒ providerRefundId 为 null（不是空串）', async () => {
    const a = makeAdapter({
      fetchImpl: (async () => new Response(JSON.stringify({ status: 'pending' }), { status: 200 })) as unknown as typeof fetch,
    });
    expect((await a.refund(input)).providerRefundId).toBeNull();
  });

  it('中心回非 2xx ⇒ 抛（由上层决定重试，不在 adapter 里吞掉）', async () => {
    const a = makeAdapter({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: 'order not found' }), { status: 404 })) as unknown as typeof fetch,
    });
    await expect(a.refund(input)).rejects.toThrow(/order not found/);
  });
});
