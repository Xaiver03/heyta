/**
 * **一次计价的完整结果**：把"价目表 + 券 + 这一单"压成一个可以落库的快照。
 * =========================================================================
 *
 * ## 这一层存在的理由：**报价必须是一次性的、可回放的**
 *
 * 在这层之前，"这一单多少钱"是**每次需要时重新算出来的**：adapter 下单时算一次、
 * webhook 回来校验时再算一次。于是只要有任何一个输入变了 ——
 * 价格调了、券用满了、券过期了 —— 两次算出来的数字就会不同，
 * 而校验失败的表现是"用户付了钱但没拿到权益"，且**看起来像用户没付钱**。
 *
 * 所以这里的模型是**报价 → 冻结 → 对账**：
 *
 *   1. `quoteOrder(...)` 算出 `OrderQuote`（原价 / 折扣 / 实付 / 用了哪张券）；
 *   2. 这张报价**整份写进 `checkout_orders` 一行**（`quote.ts` 只产出，落库在
 *      `pricing-store.ts`）；
 *   3. 支付回调**只跟那一行比**，不再重算。
 *
 * 第 3 条同时修掉了 `docs/reference/pricing-and-entitlements.md` §4 记录的那个洞：
 * 回调原先校验的是"金额是价目表里的**某一个**"，那在只有一个 SKU 时恰好等价于
 * "付对了"，一旦有第二个 SKU 或一张券就立刻失效。比"把 priceId 编进订单号"
 * 更强的做法就是这一层 —— **连折扣后的实付金额也一起冻住**。
 *
 * 依据：`docs/adr/0018-adjustable-pricing-and-coupons.md` §3.2、§3.4、§3.5。
 */

import {
  type Region,
  COUPON_REJECTION_EXPLANATION,
  normalizeCouponCode,
  evaluateCoupon,
  type CouponDefinition,
  type CouponRejectionReason,
  type CouponUsage,
  EMPTY_COUPON_USAGE,
} from './coupon';
import {
  CURRENCIES,
  MIN_CHARGEABLE_AMOUNT_MINOR,
  type AmountBreakdown,
  type Currency,
} from './money';
import { resolveEffectivePrice, type PriceBookEntry } from './price-book';

/**
 * 一单最多能用几张券。**当前是 1，而且这是产品决策，不是"还没做叠加"。**
 *
 * 为什么不做叠加（见 ADR-0018 §3.7 对被否决选项的记录）：
 * - 叠加的**顺序**会变成可争议的东西（先百分比还是先金额？）—— 同一张订单在
 *   两种顺序下实付不同，于是"我明明用了两张券为什么只减这么多"成为支持工单；
 * - 叠加会**改变退款拆分**：退一张券时退多少？按顺序回放？那退款逻辑就成了
 *   一个必须与计价逻辑逐字一致的第二个实现，而它只在退款时被走到
 *   （也就是最难被测到的路径）；
 * - 而叠加带来的增量收入在一个单档、¥99 的产品上，小于它带来的错误面。
 *
 * 所以这个常量是**有意**的 1。想改成 2 的话，上面三条要各自先有答案。
 */
export const MAX_COUPONS_PER_ORDER = 1;

/**
 * 支付窗口：报价 / 订单在多久之后失效。
 *
 * 取 2 小时，对齐微信 Native 扫码订单的默认有效期 —— **不是**我们自己随便定的数。
 * 它对券的核销也有意义：报价冻结时预留的那次核销，如果订单过期未付，
 * 必须被**释放**，否则一张限 100 张的券会被一堆"点了支付但没付"的单占满。
 * 释放机制见 `pricing-store.ts` 的 `expireStaleOrders`。
 */
export const DEFAULT_PAYMENT_WINDOW_MS = 2 * 60 * 60 * 1000;

/** 计价请求：调用方把它知道的事实全给出来。 */
export interface QuoteRequest {
  readonly priceId: string;
  readonly currency: Currency;
  readonly region: Region;
  /**
   * 候选券码，**按优先级排列**。
   *
   * 用户在收银台上手输的码放最前；系统自己决定要不要追加自动促销码在后面。
   * 🔴 不加的**不加** —— 不存在"猜一个券给他"。
   */
  readonly candidateCodes: readonly string[];
  /**
   * 每个候选项的用量事实。缺省视为"从未被用过"。
   *
   * 注意键是**券 id**，不是 code：一个码可能对应一张券，但 id 才是稳定标识
   * （见 `coupon.ts` 里 coupon / promotion code 的分工）。
   */
  readonly usageByCouponId?: Readonly<Record<string, CouponUsage>>;
}

/** 一个候选券被拒的记录。 */
export interface RejectedCoupon {
  readonly couponId: string | null;
  /** 用户输入的原样（未归一化），用于日志里还原"他到底敲了什么"。 */
  readonly rawCode: string;
  readonly reason: CouponRejectionReason;
  /** 给人看的中文解释。见 `COUPON_REJECTION_EXPLANATION`。 */
  readonly explanation: string;
}

/**
 * 一次报价。**这就是 `checkout_orders` 一行的领域形状。**
 *
 * 所有金额字段都是"报出这一单的那一刻"的快照，**不可变**。
 */
export interface OrderQuote extends AmountBreakdown {
  readonly priceId: string;
  readonly currency: Currency;
  readonly region: Region;
  /** 冻结的券 id；`null` = 这单没用券。 */
  readonly appliedCouponId: string | null;
  /** 被拒的候选项（含原因）。用来回答"我那个码为什么不能用"。 */
  readonly rejectedCoupons: readonly RejectedCoupon[];
  /** 报价生成时间（epoch 毫秒）。 */
  readonly quotedAt: number;
  /** 报价失效时间（epoch 毫秒）。到点未付 → 释放券的预留。 */
  readonly expiresAt: number;
}

/** 计价失败：**没有可卖的价格**。这与"券不能用"是两件事，不能混。 */
export class QuotePricingError extends Error {
  constructor(
    readonly priceId: string,
    readonly currency: Currency,
    readonly cause: unknown,
  ) {
    super(
      `无法为 ${priceId}/${currency} 报价：${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'QuotePricingError';
  }
}

/**
 * 计价入口。
 *
 * 步骤（每一步都有它自己的失败形状）：
 *
 * 1. **解析价格**。数据库覆盖优先于代码基线；解析不到就是**抛**
 *    （`QuotePricingError`）—— 绝不回落到 0 元。0 元订单会一路走到支付通道
 *    才失败，而那时用户已经在等收款码了。
 * 2. **解析候选券**：按码在 `coupons` 里找（码已归一化）。找不到 →
 *    `unknown_coupon`。同一张券被同一个码重复给出 → 只算一次
 *    （否则"同一张券被拒两次"会出现在拒绝列表里，看起来像两条不同的券）。
 * 3. **逐个评估**，按**优先级顺序取第一个可用的**。
 *    🔴 刻意**不**改成"取折扣最大的那张"：用户敲进去的码必须真的生效。
 *    自动换一张更划算的券，会让"订单上记的券"与"用户以为自己用的券"不一致 ——
 *    而订单上的券是**退款和对账的依据**。想给他更好的券，就在他敲之前
 *    把自动促销码排在前面（那是可控的），而不是在他敲之后悄悄换掉。
 * 4. **校验可支付性**。券已经把 0 元单挡在 `not_chargeable_after_discount`；
 *    这里再对**没用券**的情形兜一道 —— 基线价目表本身不允许 0 元
 *    （`validatePriceBook` 要求正数），但覆盖版本可能来自手工 SQL。
 */
export const quoteOrder = (
  request: QuoteRequest,
  deps: {
    readonly baseline: readonly PriceBookEntry[];
    readonly overrides: readonly PriceBookEntry[];
    /** 码 → 券。键必须是**已归一化**的码。 */
    readonly couponsByCode: ReadonlyMap<string, CouponDefinition>;
    readonly now: number;
    readonly paymentWindowMs?: number;
  },
): OrderQuote => {
  let price: PriceBookEntry;
  try {
    price = resolveEffectivePrice(deps.baseline, deps.overrides, {
      priceId: request.priceId,
      currency: request.currency,
      now: deps.now,
    });
  } catch (error) {
    throw new QuotePricingError(request.priceId, request.currency, error);
  }

  if (price.amountMinor < MIN_CHARGEABLE_AMOUNT_MINOR) {
    throw new QuotePricingError(
      request.priceId,
      request.currency,
      new Error(
        `生效价格是 ${price.amountMinor} 分，低于可支付下限 ${MIN_CHARGEABLE_AMOUNT_MINOR} 分`,
      ),
    );
  }

  const rejected: RejectedCoupon[] = [];
  const seen = new Set<string>();
  let applied: { couponId: string; discountMinor: number; finalAmountMinor: number } | null = null;

  for (const rawCode of request.candidateCodes) {
    const normalized = normalizeCouponCode(rawCode);
    const coupon = deps.couponsByCode.get(normalized);

    if (coupon === undefined) {
      rejected.push({
        couponId: null,
        rawCode,
        reason: 'unknown_coupon',
        explanation: rejectionExplanation('unknown_coupon'),
      });
      continue;
    }
    // 同一张券只评估一次：同一个活动被两个不同码指向是合法的，
    // 但"被拒两次"会让拒绝列表看起来像两张不同的券。
    if (seen.has(coupon.id)) continue;
    seen.add(coupon.id);

    if (applied !== null) {
      rejected.push({
        couponId: coupon.id,
        rawCode,
        reason: 'stacking_not_allowed',
        explanation: rejectionExplanation('stacking_not_allowed'),
      });
      continue;
    }

    const evaluation = evaluateCoupon(coupon, {
      now: deps.now,
      priceId: request.priceId,
      currency: request.currency,
      originalAmountMinor: price.amountMinor,
      region: request.region,
      usage: request.usageByCouponId?.[coupon.id] ?? EMPTY_COUPON_USAGE,
    });

    if (evaluation.ok) {
      applied = evaluation;
    } else {
      rejected.push({
        couponId: coupon.id,
        rawCode,
        reason: evaluation.reason,
        explanation: rejectionExplanation(evaluation.reason),
      });
    }
  }

  // 候选数超过上限时，前面那个循环已经用 `stacking_not_allowed` 把多余的拒掉了，
  // 但那只在"已有券生效"时触发。这里补一道**与结果无关**的断言：
  // 万一将来有人把 `applied` 改成累加语义，这一条会立刻红。
  if (MAX_COUPONS_PER_ORDER !== 1) {
    throw new Error(
      `MAX_COUPONS_PER_ORDER 被改成了 ${MAX_COUPONS_PER_ORDER}，但 quoteOrder 的叠加语义没有实现。` +
        '见 docs/adr/0018-adjustable-pricing-and-coupons.md §3.7：叠加需要先回答顺序、' +
        '退款拆分、以及"哪张券记在订单上"三个问题。',
    );
  }

  const discountMinor = applied?.discountMinor ?? 0;
  const finalAmountMinor = price.amountMinor - discountMinor;

  if (finalAmountMinor < MIN_CHARGEABLE_AMOUNT_MINOR) {
    // 走到这里说明**没有用券**却已经不可支付 —— 那是价目表坏了，不是券的问题。
    throw new QuotePricingError(
      request.priceId,
      request.currency,
      new Error(`实付 ${finalAmountMinor} 分低于可支付下限，且不是券造成的（价目表问题）`),
    );
  }

  return {
    priceId: price.priceId,
    currency: price.currency,
    region: request.region,
    originalAmountMinor: price.amountMinor,
    discountMinor,
    finalAmountMinor,
    appliedCouponId: applied?.couponId ?? null,
    rejectedCoupons: rejected,
    quotedAt: deps.now,
    expiresAt: deps.now + (deps.paymentWindowMs ?? DEFAULT_PAYMENT_WINDOW_MS),
  };
};

/**
 * 原因 → 中文解释。
 *
 * `COUPON_REJECTION_EXPLANATION` 的类型是 `Record<CouponRejectionReason, string>`，
 * 所以**新增一个拒绝原因时这里会编译不过** —— 不会出现"加了一个原因但没人写解释"。
 */
const rejectionExplanation = (reason: CouponRejectionReason): string =>
  COUPON_REJECTION_EXPLANATION[reason];

/** 币种 → 该币种在本系统里是否被允许用作收款币种。预留给上层做请求校验。 */
export const isSellableCurrency = (value: unknown): value is Currency =>
  typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
