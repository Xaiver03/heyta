/**
 * 收银台客户端（**宿主无关**）
 * ================================
 *
 * 「用户点一下 → 服务端报价冻结 → 拿到付款参数」这条链在所有宿主里是同一份接线。
 * 服务端那半（`server/src/billing/checkout.routes.ts`）早就写好也有测试，
 * 但**零调用方** —— 于是"能收钱但买不了"。本文件是那半的客户端。
 *
 * ## 🔴 三条不可动摇的形状
 *
 * 1. **请求体里没有任何金额字段。** 收多少钱只能由服务端报价决定；
 *    让客户端传金额 = 让客户端决定收多少钱。本文件连"金额"这个参数都不接受，
 *    于是连误用的通道都不存在（`checkout.routes.ts` 文件头第 2 条同义）。
 * 2. **请求不携带任何任务内容。** body 只有档位与券码；测试把键集合逐字钉住。
 * 3. **不抛异常。** 每个失败都归一成 `CheckoutFailure` 的一个码 ——
 *    付款按钮的失败绝不能变成宿主的一个崩溃点。
 *
 * ## 为什么没有"轮询到账"
 *
 * 到账的唯一写入路径是 webhook（`applyPaymentEvent`），客户端**读不到**自己的
 * 权益变化之前的那笔支付状态，服务端也没有"按订单号查支付结果"的端点。
 * 所以这里只做一件事：把单开出来。用户付完之后，界面靠既有的权益探测
 * （`entitlement.ts`）在下次刷新时自己变绿 —— 不在这里编一个"支付成功"的假确认。
 */
import { joinEndpointUrl } from './endpoint-url.js';

/** 收银台端点。常量而不是散落字面量：测试拿它当断言目标。 */
export const CHECKOUT_PATH = '/api/billing/checkout';

/**
 * 「买哪一档」的唯一标识来自服务端价目表（`price-book.ts` 的 `SKU_GRANTS`）。
 *
 * 🔴 本档**不含** `hosted-ai-monthly`：那一档在 [ADR-0023](../../docs/adr/0023-managed-ai-quota-not-implemented.md)
 * 里被 `NOT_YET_DELIVERABLE_SKUS` 挡在收银台外（计量不存在之前不得售卖），
 * 客户端把它做成可点的按钮就是**诱导用户去买一个 409**。
 */
export const RENEWAL_PRICE_ID = 'hosted-monthly';

export type CheckoutFailureCode =
  | 'UNCONFIGURED'
  | 'UNAUTHORIZED'
  | 'INVALID_BODY'
  | 'UNKNOWN_PRICE'
  | 'UNSUPPORTED_CURRENCY'
  | 'UNSUPPORTED_REGION'
  | 'PRICE_NOT_SELLABLE'
  | 'PRICE_NOT_EFFECTIVE'
  | 'PROVIDER_CURRENCY_UNSUPPORTED'
  | 'BILLING_PROVIDER_NOT_CONFIGURED'
  | 'CHECKOUT_FAILED'
  | 'NETWORK_ERROR'
  | 'UNEXPECTED_RESPONSE';

export interface CheckoutFailure {
  readonly kind: 'failed';
  readonly code: CheckoutFailureCode;
  /** HTTP 状态（网络层失败时为 `null`）。运维排查用，不面向用户。 */
  readonly status: number | null;
}

/** 服务端报回来的"这一张券为什么不能用"（字段名与 `quote.ts` 的 `RejectedCoupon` 同源）。 */
export interface RejectedCouponEcho {
  /** 用户敲进去的原样（未归一化）。 */
  readonly rawCode: string;
  readonly reason: string;
  /** 服务端给的、给人看的解释。客户端**不自己翻译**这条 —— 否则就是第二套语义。 */
  readonly explanation: string;
}

/** 微信 Native 扫码那一类通道：拿到一个可扫码 / 可在手机端唤起的支付串。 */
export interface CheckoutQr {
  readonly kind: 'qr';
  readonly outTradeNo: string;
  readonly codeUrl: string;
  readonly currency: string;
  readonly amountMinor: number;
  /** 这一单的失效时间（epoch 毫秒）。过期后必须重新下单，不能继续扫旧码。 */
  readonly expiresAt: number;
  /** 服务端报过的券码与被拒原因（原样透传，界面上回答"我那个码为什么不能用"）。 */
  readonly rejectedCoupons: readonly RejectedCouponEcho[];
}

/** 跳转式通道（本仓库今天没有；留这一支是为了不在客户端硬编码"只有扫码"）。 */
export interface CheckoutRedirect {
  readonly kind: 'redirect';
  readonly outTradeNo: string;
  readonly redirectUrl: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly expiresAt: number;
  readonly rejectedCoupons: readonly RejectedCouponEcho[];
}

export type CheckoutOutcome = CheckoutQr | CheckoutRedirect | CheckoutFailure;

export interface StartCheckoutOptions {
  /** 服务端根地址。空串 = 未配置同步服务，此时**一个请求都不发**。 */
  readonly baseUrl: string;
  /** 取访问令牌。`undefined`/空串 = 未登录，同样不发请求。 */
  readonly getToken: () => Promise<string | undefined>;
  readonly priceId?: string;
  readonly couponCode?: string;
  readonly fetchImpl?: typeof fetch;
  readonly path?: string;
}

const FAILURE_BY_STATUS: Readonly<Record<number, CheckoutFailureCode>> = {
  401: 'UNAUTHORIZED',
  400: 'INVALID_BODY',
  409: 'PRICE_NOT_EFFECTIVE',
  502: 'CHECKOUT_FAILED',
  503: 'BILLING_PROVIDER_NOT_CONFIGURED',
};

const ERROR_CODES: readonly CheckoutFailureCode[] = [
  'INVALID_BODY',
  'UNKNOWN_PRICE',
  'UNSUPPORTED_CURRENCY',
  'UNSUPPORTED_REGION',
  'PRICE_NOT_SELLABLE',
  'PRICE_NOT_EFFECTIVE',
  'PROVIDER_CURRENCY_UNSUPPORTED',
  'BILLING_PROVIDER_NOT_CONFIGURED',
  'CHECKOUT_FAILED',
];

interface CheckoutResponseBody {
  readonly error?: unknown;
  readonly outTradeNo?: unknown;
  readonly qrCode?: unknown;
  readonly redirectUrl?: unknown;
  readonly currency?: unknown;
  readonly amountMinor?: unknown;
  readonly expiresAt?: unknown;
  readonly rejectedCoupons?: unknown;
}

const rejectedCouponsOf = (value: unknown): readonly RejectedCouponEcho[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as {
        readonly rawCode?: unknown;
        readonly reason?: unknown;
        readonly explanation?: unknown;
      };
      return {
        rawCode: String(row.rawCode ?? ''),
        reason: String(row.reason ?? ''),
        explanation: String(row.explanation ?? ''),
      };
    })
    .filter((row) => row.rawCode !== '');
};

/**
 * 开一单。返回值三选一：`qr` / `redirect` / `failed`。
 *
 * 🔴 **`failed.code` 只可能是这两类之一**：服务端**自己报出的**错误码（在
 * `ERROR_CODES` 词表里），或本文件的传输层归一码。服务端报了一个词表外的码时，
 * 这里**不猜**它是什么意思 —— 归成 `UNEXPECTED_RESPONSE` 并保留状态码，
 * 因为"把一个陌生码显示成一句中文解释"就等于替服务端编造语义。
 */
export async function startCheckout(options: StartCheckoutOptions): Promise<CheckoutOutcome> {
  const baseUrl = options.baseUrl.trim();
  if (baseUrl === '') return { kind: 'failed', code: 'UNCONFIGURED', status: null };

  const token = await options.getToken();
  if (token === undefined || token === '') {
    return { kind: 'failed', code: 'UNAUTHORIZED', status: null };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  // 🔴 请求体**只有这两项**。没有 amount / currency / provider —— 见文件头第 1 条。
  const body: Record<string, string> = { priceId: options.priceId ?? RENEWAL_PRICE_ID };
  const couponCode = options.couponCode?.trim();
  if (couponCode) body.couponCode = couponCode;

  let response: Response;
  try {
    response = await fetchImpl(joinEndpointUrl(baseUrl, options.path ?? CHECKOUT_PATH), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'failed', code: 'NETWORK_ERROR', status: null };
  }

  let payload: CheckoutResponseBody | null = null;
  try {
    payload = (await response.json()) as CheckoutResponseBody;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const reported = typeof payload?.error === 'string' ? payload.error : undefined;
    const code =
      reported !== undefined && (ERROR_CODES as readonly string[]).includes(reported)
        ? (reported as CheckoutFailureCode)
        : (FAILURE_BY_STATUS[response.status] ?? 'UNEXPECTED_RESPONSE');
    return { kind: 'failed', code, status: response.status };
  }

  const outTradeNo = typeof payload?.outTradeNo === 'string' ? payload.outTradeNo : '';
  const currency = typeof payload?.currency === 'string' ? payload.currency : '';
  const amountMinor = typeof payload?.amountMinor === 'number' ? payload.amountMinor : NaN;
  const expiresAt = typeof payload?.expiresAt === 'number' ? payload.expiresAt : NaN;
  const rejectedCoupons = rejectedCouponsOf(payload?.rejectedCoupons);
  if (outTradeNo === '' || currency === '' || !Number.isFinite(amountMinor) || !Number.isFinite(expiresAt)) {
    return { kind: 'failed', code: 'UNEXPECTED_RESPONSE', status: response.status };
  }

  if (typeof payload?.qrCode === 'string' && payload.qrCode !== '') {
    return {
      kind: 'qr',
      outTradeNo,
      codeUrl: payload.qrCode,
      currency,
      amountMinor,
      expiresAt,
      rejectedCoupons,
    };
  }
  if (typeof payload?.redirectUrl === 'string' && payload.redirectUrl !== '') {
    return {
      kind: 'redirect',
      outTradeNo,
      redirectUrl: payload.redirectUrl,
      currency,
      amountMinor,
      expiresAt,
      rejectedCoupons,
    };
  }
  // 2xx 但既没有码也没有跳转地址：这是通道侧的半截响应，**不能**当成"已经可以付款了"。
  return { kind: 'failed', code: 'UNEXPECTED_RESPONSE', status: response.status };
}
