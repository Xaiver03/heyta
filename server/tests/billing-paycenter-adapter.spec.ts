import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WEBHOOK_PATH,
  PAYCENTER_DEFAULT_PRICES,
  PAYCENTER_ONE_TIME_PERIOD_DAYS,
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

/**
 * 固定向量：这条用例的期望值是按**中心的契约**（`hex(sha256(body))` 进规范化串）
 * 独立算出来的，不是用本仓的 canonicalSignature 现算的。
 *
 * 为什么必须有它：原来的用例全部拿 canonicalSignature 生成期望签名，签发与验签
 * 用的是同一个函数，所以算法错了也是绿的 —— 那条错（把 body 摘要写成 HMAC(secret, body)）
 * 就这样活到联调，表现是"对中心的每一次请求都被判签名无效"。
 */
describe('canonicalSignature 与中心契约逐字节一致（固定向量）', () => {
  it('body 摘要必须是 sha256(body)，不是 HMAC(secret, body)', () => {
    const secret = 'e2e-fixed-vector-secret';
    const body = Buffer.from('{"a":1}', 'utf8');
    const got = canonicalSignature(secret, 'POST', '/api/v1/internal/payments/orders', body, '1700000000', 'fixed-1');
    // 中心侧 platformauth.Sign 对同一组输入的结果：
    expect(got).toBe('b572d1f63c8d7b8467af364e7134cb6c533ee3516f244536d72fe732a46bd059');
  });

  it('换一个 body 就换一个签名（防止退化成常数）', () => {
    const a = canonicalSignature('s', 'POST', '/p', Buffer.from('{"a":1}'), '1700000000', 'i');
    const b = canonicalSignature('s', 'POST', '/p', Buffer.from('{"a":2}'), '1700000000', 'i');
    expect(a).not.toBe(b);
  });
});

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
    // 默认值必须是**渠道命名空间**的类型。改成 'huifu' 会得到中心 503
    // "no enabled instance for payment type huifu"：中心的实例只声明
    // huifu_wxpay / huifu_alipay / huifu_h5 / huifu_app，基础类型不可路由。
    expect(sent.payment_type).toBe('huifu_wxpay');
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

describe('默认投影器（不注入也能工作）', () => {
  it('取自**代码基线价目表**（与微信 adapter 同一张）', () => {
    expect(Object.keys(PAYCENTER_DEFAULT_PRICES).length).toBeGreaterThan(0);
  });

  it('价目表上的金额 → 匹配到档位与能力', async () => {
    const [sku, entry] = Object.entries(PAYCENTER_DEFAULT_PRICES)[0];
    // 不传 deps：走默认投影器
    const a = createPaycenterBillingAdapter(
      { baseUrl: 'https://center.test', clientId: CLIENT, clientSecret: SECRET },
      // ⚠️ 必须注入时钟：不注入时 now() 是真实时间，而用例里的时间戳是固定值，
      // 会被 ±5 分钟窗口判成过期 —— 看起来像"验签坏了"，其实是夹具自相矛盾。
      { now: () => 1776000000 * 1000 },
    );
    const raw = eventBody({ amount: (entry.totalFen / 100).toFixed(2) });
    const ts = '1776000000';
    const idem = `payment-fulfillment:${CLIENT}:SS-ORDER-1`;
    const r = await a.verifyWebhook(Buffer.from(raw, 'utf8'), {
      'x-platform-client': CLIENT,
      'x-platform-timestamp': ts,
      'x-platform-signature': canonicalSignature(
        SECRET, 'POST', DEFAULT_WEBHOOK_PATH, Buffer.from(raw, 'utf8'), ts, idem,
      ),
      'idempotency-key': idem,
    });
    if (!r.ok) throw new Error('unreachable');
    expect(r.event.oneTimeGrant?.priceId).toBe(sku);
    expect(r.event.oneTimeGrant?.periodDays).toBe(PAYCENTER_ONE_TIME_PERIOD_DAYS);
    expect(r.event.oneTimeGrant?.grants.length).toBeGreaterThan(0);
  });

  // 🔴 金额不在价目表上（典型来源是**用券打折后的实付**）⇒ 不猜档位
  it('🔴 价目表上没有的金额 → oneTimeGrant 为 null', async () => {
    const a = createPaycenterBillingAdapter(
      { baseUrl: 'https://center.test', clientId: CLIENT, clientSecret: SECRET },
      // ⚠️ 必须注入时钟：不注入时 now() 是真实时间，而用例里的时间戳是固定值，
      // 会被 ±5 分钟窗口判成过期 —— 看起来像"验签坏了"，其实是夹具自相矛盾。
      { now: () => 1776000000 * 1000 },
    );
    const raw = eventBody({ amount: '0.07' });
    const ts = '1776000000';
    const idem = `payment-fulfillment:${CLIENT}:SS-ORDER-1`;
    const r = await a.verifyWebhook(Buffer.from(raw, 'utf8'), {
      'x-platform-client': CLIENT,
      'x-platform-timestamp': ts,
      'x-platform-signature': canonicalSignature(
        SECRET, 'POST', DEFAULT_WEBHOOK_PATH, Buffer.from(raw, 'utf8'), ts, idem,
      ),
      'idempotency-key': idem,
    });
    if (!r.ok) throw new Error('unreachable');
    expect(r.event.oneTimeGrant).toBeNull();
    // 但金额本身仍如实带上 —— 那是一笔真钱，只是买的是哪一档不确定
    expect(r.event.paidAmountMinor).toBe(7);
  });
});

// =============================================================================
// 退款已到账
//
// heyta 的契约（types.ts）写着：退款必须是**显式声明字段**，
// 不能让通用层从"eventType 里有 REFUND"推断 —— 反过来的推断同样坏：
// 任何一条我们没打算动的通知（撤销、对账、将来的争议）都会被误认成一次退款回收。
// =============================================================================
describe('payment.refunded', () => {
  const refundBody = (over: Record<string, unknown> = {}) =>
    eventBody({
      event_type: 'payment.refunded',
      refunded_amount: '30.00',
      refund_request_id: 'heyta-refund-77',
      refund_status: 'success',
      ...over,
    });

  const verify = async (raw: string) => {
    const a = makeAdapter();
    const ts = '1776000000';
    const idem = `payment-fulfillment:${CLIENT}:SS-ORDER-1`;
    return a.verifyWebhook(Buffer.from(raw, 'utf8'), {
      'x-platform-client': CLIENT,
      'x-platform-timestamp': ts,
      'x-platform-signature': canonicalSignature(
        SECRET, 'POST', DEFAULT_WEBHOOK_PATH, Buffer.from(raw, 'utf8'), ts, idem,
      ),
      'idempotency-key': idem,
    });
  };

  it('声明成 refundNotice，且**绝不**带授予声明', async () => {
    const r = await verify(refundBody());
    if (!r.ok) throw new Error(`应通过，实际 ${r.reason}`);
    expect(r.event.refundNotice).toEqual({
      outRefundNo: 'heyta-refund-77',
      providerRefundId: null,
      status: 'success',
    });
    // 🔴 带授予 ⇒ webhook 路由会再授予一次，而这是撤销
    expect(r.event.oneTimeGrant).toBeNull();
    expect(r.event.eventType).toBe('payment.refunded');
  });

  // 🔴 读错金额字段会让产品按**订单原额**回收权益。
  // 订单 30 元、只退 3 元时，那意味着"用户只拿回一部分、东西却全没了"。
  it('🔴 用 refunded_amount 而不是 amount（部分退款）', async () => {
    const r = await verify(refundBody({ refunded_amount: '3.00' }));
    if (!r.ok) throw new Error(`应通过，实际 ${r.reason}`);
    expect(r.event.paidAmountMinor).toBe(300);
  });

  // 🔴 认不回是哪一笔退款就拒收。一个订单可以有多笔退款，只给订单号认不出来；
  // 编一个号去匹配等于把通知丢进一个不存在的位置。
  it('🔴 没有退款单号 → 拒收', async () => {
    for (const bad of [undefined, '', '   ']) {
      const r = await verify(refundBody({ refund_request_id: bad }));
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.reason).toBe('refund-without-refund-number');
    }
  });

  // 🔴 状态**由中心显式给**，不从"事件类型是 refunded"假定成功 ——
  // heyta 对认不出来的状态一律归成 processing，而只有 success 才允许回收权益。
  it('🔴 状态不是 success（或缺失/认不出）→ 拒收', async () => {
    for (const st of [undefined, 'pending', 'processing', 'weird']) {
      const r = await verify(refundBody({ refund_status: st }));
      expect(r.ok, String(st)).toBe(false);
      if (!r.ok) expect(r.reason).toBe('refund-not-confirmed');
    }
  });

  it('退款金额格式不对 → 拒收（错误码与支付侧分开）', async () => {
    const r = await verify(refundBody({ refunded_amount: 'abc' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed-refunded-amount');
  });

  // 🔴 白名单：其余一律拒，不是"放宽成什么都收"。
  it('🔴 未知事件类型 → 拒收', async () => {
    for (const t of ['payment.disputed', 'payment.chargeback', 'refund.succeeded', '']) {
      const r = await verify(refundBody({ event_type: t }));
      expect(r.ok, t).toBe(false);
      if (!r.ok) expect(r.reason).toBe('unsupported-event');
    }
  });

  // 同一笔退款的**不同状态**必须给出不同的键，否则后一个状态会被前一个挡掉。
  it('退款事件的幂等键把状态算进去（与支付事件的键不同）', async () => {
    const refund = await verify(refundBody());
    const pay = await verify(eventBody());
    if (!refund.ok || !pay.ok) throw new Error('两条都应通过');
    expect(refund.event.providerEventId).toBe('payment.refunded:SS-ORDER-1:success');
    expect(pay.event.providerEventId).toBe('payment.succeeded:SS-ORDER-1');
    expect(refund.event.providerEventId).not.toBe(pay.event.providerEventId);
  });
});

// =============================================================================
// 退款**没**成功
//
// 只清状态，**绝不**回收权益 —— 钱没退出去。
// heyta 这边是结构性保证：非成功状态 ⇒ 不写 refunded_at，
// 而库层 CHECK 钉死了「status='success' ⟺ refunded_at IS NOT NULL」。
// =============================================================================
describe('payment.refund_failed', () => {
  const failBody = (over: Record<string, unknown> = {}) =>
    eventBody({
      event_type: 'payment.refund_failed',
      refund_request_id: 'heyta-refund-77',
      refund_status: 'abnormal',
      ...over,
    });

  const verify = async (raw: string) => {
    const a = makeAdapter();
    const ts = '1776000000';
    const idem = `payment-fulfillment:${CLIENT}:SS-ORDER-1`;
    return a.verifyWebhook(Buffer.from(raw, 'utf8'), {
      'x-platform-client': CLIENT,
      'x-platform-timestamp': ts,
      'x-platform-signature': canonicalSignature(
        SECRET, 'POST', DEFAULT_WEBHOOK_PATH, Buffer.from(raw, 'utf8'), ts, idem,
      ),
      'idempotency-key': idem,
    });
  };

  it('声明成 refundNotice，状态是失败，且**绝不**带授予声明', async () => {
    const r = await verify(failBody());
    if (!r.ok) throw new Error(`应通过，实际 ${r.reason}`);
    expect(r.event.refundNotice).toMatchObject({
      outRefundNo: 'heyta-refund-77',
      status: 'abnormal',
    });
    expect(r.event.refundNotice?.status).not.toBe('success');
    expect(r.event.oneTimeGrant).toBeNull();
  });

  it('closed 也算失败（不必是 abnormal）', async () => {
    const r = await verify(failBody({ refund_status: 'closed' }));
    if (!r.ok) throw new Error(`应通过，实际 ${r.reason}`);
    expect(r.event.refundNotice?.status).toBe('closed');
  });

  // 🔴 一个自称"退款失败"的事件不可能同时说成功。放过去等于让**失败**
  // 去写 refunded_at，而那正是回收权益。
  it('🔴 自称失败却报 success → 拒收', async () => {
    const r = await verify(failBody({ refund_status: 'success' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('refund-failed-claims-success');
  });

  // 认不出的状态同样拒：这里需要的是一个**明确的失败**状态。
  it('🔴 状态缺失或认不出 → 拒收', async () => {
    for (const st of [undefined, 'weird', 'pending']) {
      const r = await verify(failBody({ refund_status: st }));
      expect(r.ok, String(st)).toBe(false);
      if (!r.ok) {
        expect(['refund-failure-status-unknown', 'refund-failed-claims-success']).toContain(r.reason);
      }
    }
  });

  it('没有退款单号 → 拒收（认不回是哪一笔）', async () => {
    const r = await verify(failBody({ refund_request_id: undefined }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('refund-without-refund-number');
  });

  // 幂等键把状态算进去：同一笔退款的不同状态必须是不同的键。
  it('幂等键与退款成功那条**不同**', async () => {
    const failed = await verify(failBody());
    const ok = await verify(eventBody({
      event_type: 'payment.refunded',
      refunded_amount: '30.00',
      refund_request_id: 'heyta-refund-77',
      refund_status: 'success',
    }));
    if (!failed.ok || !ok.ok) throw new Error('两条都应通过');
    expect(failed.event.providerEventId).toBe('payment.refund_failed:SS-ORDER-1:abnormal');
    expect(ok.event.providerEventId).toBe('payment.refunded:SS-ORDER-1:success');
  });
});
