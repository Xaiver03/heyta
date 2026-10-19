/**
 * 统一支付中心 adapter。
 *
 * ## 为什么是"加一个 adapter"而不是改路由
 *
 * 本仓早就把支付商抽象成 `BillingAdapter` + `registry` 了（见 `registry.ts`：
 * 未注册的 provider 一律 404、不落任何 `PaymentEvent`）。所以接中心 =
 * **写一个 adapter 并注册**，17 个 billing 文件里的路由、冻结、价目表、
 * 权益判定**一行都不用动**。
 *
 * ## 渠道口径（负责人 2026-10-18 确认）
 *
 * 中心那边**汇付为主**（一个通道同时出微信 + 支付宝），微信/支付宝直连作兜底。
 * 本 adapter 因此声明 `supportedCurrencies: ['CNY']` —— 汇付聚合收人民币。
 *
 * 🔴 本仓**没有也不需要汇付专属代码**：它只跟中心说话，"走汇付还是走微信"
 * 是中心的事（`paymentType` 由配置给出）。这正是"统一支付网关"的意义。
 *
 * ## 与微信 adapter 的对应关系
 *
 * 微信直连 adapter 是 1181 行（手写 RSA 验签 + AES-GCM 解密 + 证书管理）。
 * 中心 adapter 把这些**全部删掉** —— 签名变成一把 HMAC、没有 AES、没有证书。
 * 这是接入中心在**代码量**上的直接收益。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Currency } from './money';
import { DEFAULT_PRICE_BOOK, grantsForSku, projectPrices } from './price-book';
import type {
  BillingAdapter,
  CheckoutResult,
  CreateCheckoutInput,
  CreateRefundInput,
  NormalizedPaymentEvent,
  OneTimeGrant,
  ProviderRefundStatus,
  RefundResult,
  RevokeEntitlementInput,
  SubscriptionStatus,
  WebhookHeaders,
  WebhookVerification,
} from './types';

/** 本 adapter 的 provider 名（与 `NormalizedPaymentEvent.provider` 同值）。 */
export const PAYCENTER_PROVIDER = 'paycenter';

/** 中心会投递的事件类型。**白名单**，不是"除了某一种都收"。 */
export const EVENT_PAYMENT_SUCCEEDED = 'payment.succeeded';
export const EVENT_PAYMENT_REFUNDED = 'payment.refunded';

export const ACCEPTED_EVENT_TYPES: readonly string[] = [
  EVENT_PAYMENT_SUCCEEDED,
  EVENT_PAYMENT_REFUNDED,
];

/**
 * 汇付聚合收人民币。
 *
 * 🔴 提成模块常量，**不在对象字面量里重复写、也不用 `this` 读**：
 * 方法一旦被解构调用（`const { createCheckout } = adapter`），`this` 就是
 * `undefined` —— 那是个只在特定调用点才炸的 bug，而这里没有任何理由依赖 `this`。
 *
 * ⚠️ 声明与实现必须一致：`createCheckout` 见到别的币种必须拒，
 * 否则收银台按声明选了这条通道、adapter 却照收，声明就成了装饰。
 */
export const PAYCENTER_SUPPORTED_CURRENCIES: readonly Currency[] = ['CNY'];

const DEFAULT_TIMEOUT_MS = 5000;
/** 默认挂载路径。改挂载点时必须同步 `webhookPath`（见该字段的说明）。 */
export const DEFAULT_WEBHOOK_PATH = '/api/billing/webhooks/paycenter';
const FRESHNESS_WINDOW_SECONDS = 5 * 60;

export interface PaycenterAdapterConfig {
  readonly baseUrl: string;
  readonly clientId: string;
  /** 与中心约定的 HMAC 密钥。**同一把**既用于出站签名，也用于入站履约验签。 */
  readonly clientSecret: string;
  readonly timeoutMs?: number;
  /**
   * 🔴 履约投递在**本仓的挂载路径**，必须与中心那边登记的 `fulfillment_url`
   * 的 path 逐字符相同。
   *
   * 为什么必须可配：签名是对**中心发往的那个路径**算的（中心签的是它自己的
   * `req.path`），而 `verifyWebhook` 的入参只有 rawBody + headers ——
   * **拿不到路径**。写死一个默认值就等于"挂载点一改、每条回调都 401"，
   * 而症状看起来像"密钥配错了"。
   *
   * 默认值只是让自托管开箱可用；换挂载点时必须同步改这里。
   */
  readonly webhookPath?: string;
  /**
   * 下给中心用哪种支付类型。
   *
   * 默认 `huifu`（聚合：一个通道出微信 + 支付宝）—— 与 §1.4 的渠道口径一致。
   */
  readonly paymentType?: string;
}

/**
 * 把"这一笔钱买到什么"投影出来。
 *
 * 🔴 **刻意是注入的，不是 adapter 自己去查价目表**：金额 → 档位 → 能力的映射
 * 只有本仓的计价层知道（价格有运行期版本、还叠了券）。把它留在调用方，
 * adapter 就只剩"验签 + 归一化"，也才**测得动**。
 *
 * 返回 `null` = 这个金额不在价目表上（典型来源是**用券打折后的实付**）。
 * 那时**不要猜一个档位** —— `NormalizedPaymentEvent` 有为这种情形准备的显式字段，
 * 猜错会把用户付的钱交付成错误的权益。
 */
export type GrantProjector = (
  amountMinor: number,
  currency: Currency,
) => OneTimeGrant | null;

/**
 * 中心收的是**一次性支付**（与微信直连同形），授予周期取同口径的 30 天。
 *
 * ⚠️ 刻意**不**从 `wechat.adapter` 导入它的同名常量：两个平级 adapter 之间
 * 不该有依赖。两处必须一致，靠这条注释与评审，不靠 import。
 */
export const PAYCENTER_ONE_TIME_PERIOD_DAYS = 30;

/**
 * 默认价目表 —— 由**代码基线价目表投影出来**，不是又一个字面量
 * （与微信 adapter 取的是同一张 `DEFAULT_PRICE_BOOK`）。
 */
export const PAYCENTER_DEFAULT_PRICES = projectPrices(DEFAULT_PRICE_BOOK, 'CNY', 0);

/**
 * 默认投影器：金额 → 档位 → 能力。
 *
 * 🔴 与微信 adapter 的匹配逻辑同形，且**两步都可能落空，落空就不猜**：
 *   1. 金额不在价目表上 → `null`（典型来源是**用券打折后的实付**）
 *   2. 档位在价目表上、能力表里没有 → `null`（那说明**两处不同步**，
 *      不是"这一档确定没有能力"）
 *
 * ⚠️ 这里给出的只是**提示**：权威判定仍在 `pricing-store.ts` 的
 * `settleOrderPaid`（它比的是订单上冻结的 SKU 与实付额，两者都覆盖折扣）。
 * 本仓既有文档把这条写得很死，这里不重复判据、只做投影。
 */
export const createDefaultGrantProjector = (
  prices: Readonly<Record<string, { readonly totalFen: number }>> = PAYCENTER_DEFAULT_PRICES,
): GrantProjector => {
  return (amountMinor: number): OneTimeGrant | null => {
    const matchedSku =
      Object.entries(prices).find(([, entry]) => entry.totalFen === amountMinor)?.[0] ?? null;
    if (matchedSku === null) return null;
    const matchedGrants = grantsForSku(matchedSku);
    if (matchedGrants === null) return null;
    return {
      periodDays: PAYCENTER_ONE_TIME_PERIOD_DAYS,
      priceId: matchedSku,
      grants: matchedGrants,
    };
  };
};

export interface PaycenterAdapterDeps {
  /**
   * 金额 → 档位 → 能力的投影。
   *
   * 不传时用 `createDefaultGrantProjector()`（代码基线价目表）。
   * 传的话是为了注入**运行期**价目表或测试替身。
   */
  readonly projectGrant?: GrantProjector;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

/** 中心的入站头。与出站用的是同一套名字。 */
const HEADER_CLIENT = 'x-platform-client';
const HEADER_TIMESTAMP = 'x-platform-timestamp';
const HEADER_SIGNATURE = 'x-platform-signature';
const HEADER_IDEMPOTENCY = 'idempotency-key';

const readHeader = (headers: WebhookHeaders, name: string): string => {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value ?? '').trim();
};

/** 与中心约定的规范化串。顺序是契约的一部分。 */
export const canonicalSignature = (
  secret: string,
  method: string,
  path: string,
  body: Buffer,
  timestamp: string,
  idempotencyKey: string,
): string => {
  const bodyHash = createHmac('sha256', secret).update(body).digest('hex');
  // 中心的契约是 sha256(body) 再进规范化串；这里同样先算 sha256 再 HMAC。
  // ⚠️ 与中心 `platformauth` 的口径必须逐字节一致，否则每条回调都 401。
  const canonical = [
    method.trim().toUpperCase(),
    path.trim(),
    timestamp,
    idempotencyKey,
    bodyHash,
  ].join('\n');
  return createHmac('sha256', secret).update(canonical).digest('hex');
};

const validTimestamp = (value: string, nowMs: number): boolean => {
  if (!/^\d{1,16}$/.test(value)) return false;
  const ts = Number(value);
  return Number.isSafeInteger(ts) && Math.abs(Math.floor(nowMs / 1000) - ts) <= FRESHNESS_WINDOW_SECONDS;
};

const timingSafeEqualHex = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

/** 中心的履约事件（入站 body）。 */
interface FulfillmentEvent {
  event_type?: string;
  source_system?: string;
  external_order_id?: string;
  external_customer_id?: string;
  out_trade_no?: string;
  provider_trade_no?: string;
  amount?: string;
  currency?: string;
  paid_at?: string;
  metadata?: Record<string, unknown>;
  /**
   * 只在 `payment.refunded` 上：**这一笔实际退回去多少**。
   *
   * ⚠️ 与 `amount` 不是一回事：`amount` 是**订单原额**，而退款可以只退一部分。
   * 拿 `amount` 当退款金额会让产品按全额回收权益。
   */
  refunded_amount?: string;
  /** 发起退款那方的退款单号 —— 认回本地退款行的唯一依据。 */
  refund_request_id?: string;
  /** 渠道给的退款状态。**由中心显式给**，不从事件类型假定成功。 */
  refund_status?: string;
}

/** 元 → 分。中心发的是两位小数的字符串。 */
export const amountYuanToMinor = (amount: unknown): number | null => {
  if (typeof amount !== 'string' || !/^\d{1,7}\.\d{2}$/.test(amount)) return null;
  return Math.round(Number(amount) * 100);
};

/** 中心的退款状态 → 本仓的通道词表。**pending 归 processing，绝不上报 success。** */
export const toProviderRefundStatus = (raw: unknown): ProviderRefundStatus => {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'success' || v === 'succeeded') return 'success';
  if (v === 'failed' || v === 'abnormal') return 'abnormal';
  if (v === 'closed' || v === 'canceled' || v === 'cancelled') return 'closed';
  return 'processing';
};

export const createPaycenterBillingAdapter = (
  config: PaycenterAdapterConfig,
  /**
   * 可选：`projectGrant` 有默认值（代码基线价目表），其余也有默认值。
   * 生产路径因此只需给 config；测试与运行期价目表才需要传它。
   */
  deps: PaycenterAdapterDeps = {},
): BillingAdapter => {
  const base = config.baseUrl.replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
  const webhookPath = config.webhookPath?.trim() || DEFAULT_WEBHOOK_PATH;
  const projectGrant = deps.projectGrant ?? createDefaultGrantProjector();
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? Date.now;

  const signedPost = async (path: string, payload: unknown, idempotencyKey: string): Promise<unknown> => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const ts = Math.floor(now() / 1000).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Platform-Client': config.clientId,
          'X-Platform-Timestamp': ts,
          'X-Platform-Signature': canonicalSignature(
            config.clientSecret, 'POST', path, body, ts, idempotencyKey,
          ),
          'Idempotency-Key': idempotencyKey,
        },
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      const parsed: unknown = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const message =
          parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
            ? (parsed as { error: string }).error
            : `paycenter request failed with ${res.status}`;
        throw new Error(message);
      }
      // 兼容两种外壳：平铺或包在 data 里
      if (parsed && typeof parsed === 'object' && typeof (parsed as { data?: unknown }).data === 'object') {
        return (parsed as { data: unknown }).data;
      }
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    provider: PAYCENTER_PROVIDER,

    supportedCurrencies: PAYCENTER_SUPPORTED_CURRENCIES,

    async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
      // 声明了只收 CNY，就必须在这里拒 —— 否则收银台按声明选了这条通道、
      // adapter 却照收，声明就成了装饰。
      if (!PAYCENTER_SUPPORTED_CURRENCIES.includes(input.currency)) {
        throw new Error(
          `paycenter adapter does not support ${input.currency}; ` +
            `it only collects ${PAYCENTER_SUPPORTED_CURRENCIES.join(', ')}`,
        );
      }
      // 🔴 订单号必须用调用方给的那个：库里冻的是它，中心也只认它。
      // adapter 另生成一个 ⇒ 回调按新号查不到订单 ⇒ 一笔真实到账的钱授予不出去。
      const outTradeNo = input.outTradeNo;
      if (!outTradeNo) {
        throw new Error(
          'paycenter adapter requires outTradeNo: 先冻结再下单，adapter 不得自行生成订单号',
        );
      }

      const result = (await signedPost(
        '/api/v1/internal/payments/orders',
        {
          external_order_id: outTradeNo,
          external_customer_id: String(input.userId),
          amount: (input.amountMinor / 100).toFixed(2),
          currency: input.currency,
          subject: input.description ?? input.priceId,
          payment_type: config.paymentType ?? 'huifu',
          return_url: input.successUrl,
        },
        `heyta:${outTradeNo}`,
      )) as { qr_code?: unknown; pay_url?: unknown } | null;

      const qrCode = typeof result?.qr_code === 'string' ? result.qr_code : '';
      const payUrl = typeof result?.pay_url === 'string' ? result.pay_url : '';
      // 两者之一是必然（本仓 CheckoutResult 就是这么定义的）。都没有 ⇒ 抛，
      // **不要编一个假 URL**：那会把用户引到一个不存在的收银台。
      if (qrCode) return { qrCode };
      if (payUrl) return { redirectUrl: payUrl };
      throw new Error('paycenter returned neither qr_code nor pay_url');
    },

    /**
     * 验签 + 归一化。
     *
     * 入站不是"渠道的 webhook"，而是**中心的履约投递**：中心在用户付款成功后
     * 主动推过来。所以验的是中心那把 HMAC（与出站同一把），不是微信的 RSA。
     *
     * 🔴 失败一律返回 `{ ok: false }`，**绝不抛** —— 路由要能区分"攻击者伪造"
     * 与"我们自己崩了"，而验签失败**绝不能落 PaymentEvent**
     * （否则攻击者能用垃圾请求把 eventId 占掉，真事件到达时被当成重复丢弃）。
     */
    async verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): Promise<WebhookVerification> {
      const client = readHeader(headers, HEADER_CLIENT);
      const timestamp = readHeader(headers, HEADER_TIMESTAMP);
      const signature = readHeader(headers, HEADER_SIGNATURE).toLowerCase();
      const idempotencyKey = readHeader(headers, HEADER_IDEMPOTENCY);

      if (!client || client !== config.clientId) return { ok: false, reason: 'client-mismatch' };
      if (!validTimestamp(timestamp, now())) return { ok: false, reason: 'stale-timestamp' };
      if (!idempotencyKey) return { ok: false, reason: 'missing-idempotency-key' };

      // 签名对**原始字节**算。拿解析后的对象重新序列化去验会因键序/空白差异
      // 永远验不过 —— 而那个失败看起来像"中心发错了"。
      const expected = canonicalSignature(
        config.clientSecret, 'POST', webhookPath, rawBody, timestamp, idempotencyKey,
      );
      if (!timingSafeEqualHex(expected, signature)) {
        return { ok: false, reason: 'signature-mismatch' };
      }

      let event: FulfillmentEvent;
      try {
        event = JSON.parse(rawBody.toString('utf8')) as FulfillmentEvent;
      } catch {
        return { ok: false, reason: 'malformed-body' };
      }
      // 🔴 事件类型**白名单**：只列出来的这两种被处理，其余一律拒。
      // 写成一个宽松条件是错的 —— 那等于让任何**还没人想过业务含义**的新事件
      // 自动获得通过校验的资格。
      // 显式的类型判定，不是装饰：它是下面 `event.event_type` 能被当作
      // `string` 用的**唯一**依据（靠与字面量比较来收窄在改写成白名单后失效了）。
      if (
        typeof event.event_type !== 'string' ||
        !ACCEPTED_EVENT_TYPES.includes(event.event_type) ||
        event.source_system !== config.clientId ||
        typeof event.external_order_id !== 'string' ||
        event.external_order_id === '' ||
        typeof event.out_trade_no !== 'string' ||
        event.out_trade_no === ''
      ) {
        return { ok: false, reason: 'unsupported-event' };
      }

      // 退款通知**不读 amount**：那是订单原额，而退款可以只退一部分。
      // 该读的是 refunded_amount —— 读错了会让产品按全额回收权益。
      const isRefund = event.event_type === EVENT_PAYMENT_REFUNDED;
      const amountField = isRefund ? event.refunded_amount : event.amount;
      const amountMinor = amountYuanToMinor(amountField);
      if (amountMinor === null) {
        return { ok: false, reason: isRefund ? 'malformed-refunded-amount' : 'malformed-amount' };
      }

      if (isRefund) {
        // 🔴 认不回是哪一笔退款就**拒收**。
        //
        // 一个订单可以有多笔退款，只给订单号认不出来；而 heyta 的退款行正是
        // 按这个号索引的。编一个号去匹配等于把通知丢进一个不存在的位置。
        const outRefundNo = typeof event.refund_request_id === 'string' ? event.refund_request_id.trim() : '';
        if (outRefundNo === '') return { ok: false, reason: 'refund-without-refund-number' };

        // 🔴 状态**由中心显式给**，不从"事件类型是 refunded"假定成功。
        // toProviderRefundStatus 对认不出来的值回 'processing' —— 那是 fail-safe，
        // 而 heyta 的纪律是"只有 success 才允许回收权益"，所以这里必须拒。
        const status = toProviderRefundStatus(event.refund_status);
        if (status !== 'success') return { ok: false, reason: 'refund-not-confirmed' };

        return {
          ok: true,
          event: {
            provider: PAYCENTER_PROVIDER,
            // 同一笔退款的**不同状态**必须给出不同的键，否则后一个状态会被
            // 前一个挡掉（heyta 的回调契约明写这条）。本仓目前只在确认成功后
            // 投递，所以只有一个状态；把状态放进键里是为了那一天仍然是安全的。
            providerEventId: `${event.event_type}:${event.external_order_id}:${status}`,
            eventType: event.event_type,
            occurredAt: now(),
            externalSubscriptionId: null,
            status: null,
            currentPeriodEnd: null,
            userId: null,
            outTradeNo: event.external_order_id,
            // 这一笔实际退回去多少（不是订单原额）。
            paidAmountMinor: amountMinor,
            // 🔴 退款通知**绝不带授予声明**：它是撤销，不是又一次授予。
            // heyta 的契约也写着：有 refundNotice ⇒ 只更新退款行与权益。
            oneTimeGrant: null,
            refundNotice: {
              outRefundNo,
              // 中心这次不带通道退款 id；heyta 落库用 COALESCE，
              // 所以给 null 不会把发起退款时存下的那个值抹掉。
              providerRefundId: null,
              status,
            },
          },
        };
      }

      // 用户 id 由下单时写进 metadata，中心原样回传
      const rawUserId = event.metadata?.user_id;
      const userId =
        typeof rawUserId === 'number' && Number.isSafeInteger(rawUserId)
          ? rawUserId
          : typeof rawUserId === 'string' && /^\d+$/.test(rawUserId)
            ? Number(rawUserId)
            : null;

      const currency = (typeof event.currency === 'string' ? event.currency : 'CNY') as Currency;
      const grant = projectGrant(amountMinor, currency);

      const normalized: NormalizedPaymentEvent = {
        provider: PAYCENTER_PROVIDER,
        // 🔴 重投必须得到同一个值：用 (事件类型, 本仓单号) 组合，而不是投递次数。
        providerEventId: `${event.event_type}:${event.external_order_id}`,
        eventType: event.event_type,
        occurredAt: typeof event.paid_at === 'string' ? Date.parse(event.paid_at) : now(),
        // 中心收的是**一次性支付**（与微信直连同形）：没有订阅对象。
        externalSubscriptionId: null,
        status: null,
        currentPeriodEnd: null,
        userId,
        outTradeNo: event.external_order_id,
        paidAmountMinor: amountMinor,
        // 🔴 授予是**事件上的显式声明**，不是"没有订阅 id"的推断。
        // 金额不在价目表上时 projectGrant 回 null —— 那时不许猜一个档位。
        oneTimeGrant: grant,
      };

      return { ok: true, event: normalized };
    },

    /** 中心收的是一次性支付，没有订阅状态机 —— 与微信直连同形。 */
    mapSubscriptionState(_providerState: unknown): SubscriptionStatus | null {
      return null;
    },

    /** 权益回收是本仓自己的事（到期/退款只影响能否新增设备接入，绝不删数据）。 */
    async revokeEntitlement(_input: RevokeEntitlementInput): Promise<void> {
      // 有意为空：与 noop 同一条纪律，这里没有任何 delete 调用。
    },

    /**
     * 发起退款。
     *
     * 🔴 绝不返回假的成功：退款流程只在通道确认 `success` 之后回收权益，
     * 一个假的 success 会让用户**一分钱没退到、权益却被砍掉**。
     * 拿不准的状态一律回 `processing`（只有 `success` 才允许动权益）。
     */
    async refund(input: CreateRefundInput): Promise<RefundResult> {
      const result = (await signedPost(
        '/api/v1/internal/payments/refunds',
        {
          external_order_id: input.outTradeNo,
          amount: (input.refundAmountMinor / 100).toFixed(2),
          ...(input.reason ? { reason: input.reason } : {}),
        },
        input.outRefundNo,
      )) as { refund_id?: unknown; status?: unknown } | null;

      return {
        providerRefundId: typeof result?.refund_id === 'string' ? result.refund_id : null,
        status: toProviderRefundStatus(result?.status),
      };
    },
  };
};
