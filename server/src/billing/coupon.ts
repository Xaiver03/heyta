/**
 * **优惠券的领域模型**：一张券是什么、什么时候能减、减多少。
 * ==========================================================
 *
 * ## 范围：这一层只做"判断"，不做"扣减"
 *
 * 本文件是纯函数。**"这张券已经被用掉几次"不在文件里**，它由调用方作为
 * `CouponUsage` 传进来 —— 因为这个计数只能来自数据库，而且是**那一刻**的值。
 * 把一个会变的外部事实塞进纯函数，会让"并发下超发"这类 bug 藏进一个
 * 看起来无副作用的函数里。真正确保"核销不超发"的机制在
 * `coupon-store.ts` 的事务与 `price-book-store.ts` 的审计里，见
 * `docs/adr/0018-adjustable-pricing-and-coupons.md` §3.5。
 *
 * ## 为什么券要分两层：`CouponDefinition` 与"用户输入的 code"
 *
 * 这是从 Stripe 抄来的、**值得抄**的一处（依据见 ADR-0018 §2 的调研结论）：
 *
 * - **券**（coupon）= 折扣的**内容**：减多少、减到哪一天、能不能叠加、限几次；
 * - **优惠码**（promotion code）= 用户输入的**那一串字符**。
 *
 * 分成两层的收益是具体的，不是"看起来整齐"：
 * - 同一个折扣可以挂多个码（`LAUNCH` / `WECHAT2026` / `XHS`），
 *   每个码可以有自己的用量上限 —— 于是"小红书渠道发出去 500 张"是可统计的；
 * - 对一个码做"停用"不必动折扣本身；
 * - 券的 id 是**稳定的**（进订单、进审计），而码可以是可变的营销资产。
 *
 * 所以：`CouponDefinition.code` 为 `null` 表示**只做自动促销、不接受手输码**
 * （例如"首年立减 20 元"这类按活动自动应用的券）。非 null 表示可以用码找到它。
 * ⚠️ 本轮**没有**"一个券挂多个码"的独立表 —— 那需要多一张表和一个 join，
 * 而当前只有一个渠道。见 ADR-0018 §5 的未做事项，不要以为它不存在。
 *
 * ## 券的种类只有两种，且刻意不加第三种
 *
 * `percent`（按比例）与 `fixed`（按金额）。**没有**"第二个半价"、"赠时长"、
 * "买一送一" —— 那些都需要解释"两个什么"和"送的那个算不算已付"，
 * 而 heyta 只有一个档、没有可赠的次级商品。
 *
 * 特别是**"赠送天数"被明确否决**：它看起来适合年付，但它把"折扣"变成了
 * "权益时长"，于是核销、退款、对账三处都要多一套语义，而它带来的
 * 营销表达力几乎为零（"多送 30 天" ≈ "打 8.4 折"）。见 ADR-0018 §3.6。
 */

import {
  MIN_CHARGEABLE_AMOUNT_MINOR,
  breakdownAmount,
  clampDiscountMinor,
  computeDiscountMinor,
  isCurrency,
  isMinorAmount,
  isPercentOffBp,
  PERCENT_OFF_BP_MAX,
  type Currency,
  type DiscountBenefit,
} from './money';

/**
 * 销售区域。**与币种分开**是刻意的。
 *
 * 币种回答"收什么钱"，区域回答"这笔交易在哪个法域"。它们现在几乎一一对应
 * （大陆 = CNY、海外 = USD），但**不是同一件事**：
 * 一张"大陆新用户"券和"人民币券"是两个不同的筛子，而把它们合成一个
 * （`currency === 'CNY'` 就当大陆）会在第一个香港用户身上出错。
 */
export const REGIONS = ['CN', 'INTL'] as const;
export type Region = (typeof REGIONS)[number];

export const isRegion = (value: unknown): value is Region =>
  typeof value === 'string' && (REGIONS as readonly string[]).includes(value);

/** 券的折扣内容。复用 `money.ts` 的判别联合 —— 折扣算术只允许有一个实现。 */
export type CouponBenefit = DiscountBenefit;

/**
 * 一张券的定义。**这就是数据库里 `coupons` 表一行的领域形状。**
 *
 * 🔴 `benefit` 是判别联合而不是"可选字段"：这样"按比例又按金额"、
 * "既不按比例也不按金额"两种非法状态**在类型上构造不出来**。
 */
export interface CouponDefinition {
  /** 稳定的券 id。进订单、进审计；**不要**用 code 当 id（码是可变的营销资产）。 */
  readonly id: string;
  /**
   * 用户可输入的码；`null` = 只能被活动自动应用。
   *
   * 比较时**大小写不敏感**（见 `normalizeCouponCode`）：`launch` 与 `LAUNCH`
   * 必须是同一张券，否则用户明明拿到码却提示"无效"，而运营者按 `LAUNCH`
   * 统计用量时会数少一半。
   */
  readonly code: string | null;
  /** 内部名称（给自己看的），例如「上线推广 · 小红书」。 */
  readonly name: string;
  readonly benefit: CouponBenefit;
  /** 币种。🔴 券**只能**抵扣同币种订单（ADR-0018 §3.3）。 */
  readonly currency: Currency;
  /** 适用的 priceId 列表；`null` = 全部适用。空数组 = 谁都不适用（等于停用）。 */
  readonly priceIds: readonly string[] | null;
  /** 生效起点（epoch 毫秒，**含**）。 */
  readonly validFrom: number;
  /** 失效起点（epoch 毫秒，**含**）。`null` = 永不过期。 */
  readonly validUntil: number | null;
  /** 总核销上限；`null` = 不限。 */
  readonly maxRedemptions: number | null;
  /** 每个用户最多用几次；`null` = 不限。 */
  readonly maxRedemptionsPerUser: number | null;
  /** 起用门槛：订单原价低于它就不能用；`null` = 无门槛。 */
  readonly minimumOrderMinor: number | null;
  /** 只有"从未付过费"的用户可用（拉新券）。 */
  readonly firstPurchaseOnly: boolean;
  /** 适用区域；`null` = 全部。 */
  readonly regions: readonly Region[] | null;
  /** 停用开关。停用是**运营动作**，不是删除（删除会让历史订单查不到券）。 */
  readonly enabled: boolean;
}

/** 用户输入 / 系统给出的码的归一化形式。大小写与首尾空白都不该影响结果。 */
export const normalizeCouponCode = (raw: string): string => raw.trim().toUpperCase();

/**
 * 券不能用的**原因**。穷尽枚举，不是散落的字符串。
 *
 * 为什么要有这个类型，而不是让 `evaluateCoupon` 返回 `null`：
 * 用户输了码、券没生效，**必须能告诉他为什么**（"已过期"和"这个码不存在"
 * 是完全不同的两句话，前者要去问客服，后者要看自己是不是打错了）。
 * 而且这套原因要能进日志与审计 —— 于是它必须是**有界集合**，
 * 不能是一堆随手写的模板字符串。
 */
export const COUPON_REJECTION_REASONS = [
  /** 码不存在，或存在但码为空。**由 `quote.ts` 产生**（纯函数层只收到已解析的券）。 */
  'unknown_coupon',
  /** 一单只能用一张券，而这一单已经有券了。**由 `quote.ts` 产生**。 */
  'stacking_not_allowed',
  /** `enabled === false`。 */
  'disabled',
  /** `now < validFrom`。 */
  'not_started',
  /** `validUntil !== null && now > validUntil`。 */
  'expired',
  /** 券的币种 ≠ 订单币种。 */
  'currency_mismatch',
  /** 区域不匹配。 */
  'region_mismatch',
  /** 这个 priceId 不在券的适用范围里。 */
  'price_not_applicable',
  /** 原价低于券的门槛。 */
  'order_below_minimum',
  /** 拉新券，但这个用户付过费了。 */
  'first_purchase_only',
  /** 这张券已被用满。 */
  'total_redemption_limit_reached',
  /** 这个用户用这张券的次数已达上限。 */
  'user_redemption_limit_reached',
  /**
   * 减完之后实付低于 `MIN_CHARGEABLE_AMOUNT_MINOR`（0 元单收不了钱）。
   *
   * 🔴 这一条**不是**"券不够好"，而是"这一单无法完成支付"。
   * 把它混进"券无效"会让用户以为自己拿错了码，于是去试下一张，
   * 结果仍然失败。见 `MIN_CHARGEABLE_AMOUNT_MINOR` 的注释。
   */
  'not_chargeable_after_discount',
] as const;

export type CouponRejectionReason = (typeof COUPON_REJECTION_REASONS)[number];

/** 原因 → 给人看的中文解释（日志 / 审计 / 未来的界面文案用它）。 */
export const COUPON_REJECTION_EXPLANATION: Readonly<Record<CouponRejectionReason, string>> = {
  unknown_coupon: '没有这个优惠码',
  stacking_not_allowed: '一单只能用一张券',
  disabled: '这张券已停用',
  not_started: '这张券还没到生效时间',
  expired: '这张券已过期',
  currency_mismatch: '这张券与订单币种不符',
  region_mismatch: '这张券不适用于当前地区',
  price_not_applicable: '这张券不适用于所购项目',
  order_below_minimum: '订单金额未达到这张券的使用门槛',
  first_purchase_only: '这张券只限首次付费用户',
  total_redemption_limit_reached: '这张券已被用满',
  user_redemption_limit_reached: '你已经用过这张券了',
  not_chargeable_after_discount: '使用这张券后订单金额为 0，无法完成支付',
};

/**
 * `evaluateCoupon` **能**产生的原因集合。
 *
 * 与全集的差集（`unknown_coupon` / `stacking_not_allowed`）是"只有编排层才知道的
 * 事"：前者要查码、后者要知道这一单已经用了几张券。把它们排除掉之后，
 * 类型系统会保证"纯函数层不会编造一个它根本没资格判断的原因"。
 */
export type CouponEvaluateRejection = Exclude<
  CouponRejectionReason,
  'unknown_coupon' | 'stacking_not_allowed'
>;

/** 券的**用量**（来自数据库，调用方负责在那一刻取准）。 */
export interface CouponUsage {
  /** 这张券已被核销的总次数（含已预留未完成的，见 `coupon-store.ts`）。 */
  readonly totalRedemptions: number;
  /** 这个用户已核销这张券的次数。 */
  readonly userRedemptions: number;
  /** 这个用户**历史上有过**已支付订单吗（`firstPurchaseOnly` 用它）。 */
  readonly userHasPaidOrder: boolean;
}

export const EMPTY_COUPON_USAGE: CouponUsage = {
  totalRedemptions: 0,
  userRedemptions: 0,
  userHasPaidOrder: false,
};

/** 判断一张券时的**订单侧**上下文。全是事实，没有策略。 */
export interface CouponContext {
  readonly now: number;
  readonly priceId: string;
  readonly currency: Currency;
  readonly originalAmountMinor: number;
  readonly region: Region;
  readonly usage: CouponUsage;
}

/** 券能用：带上算出来的折扣额与减完之后的实付。 */
export interface CouponAccepted {
  readonly ok: true;
  readonly couponId: string;
  readonly discountMinor: number;
  readonly finalAmountMinor: number;
}

/** 券不能用：带一个**有界的**原因。 */
export interface CouponRejected {
  readonly ok: false;
  readonly couponId: string;
  readonly reason: CouponEvaluateRejection;
}

export type CouponEvaluation = CouponAccepted | CouponRejected;

/**
 * 校验一张券的**定义本身**是否合法，返回全部问题。
 *
 * 与 `evaluateCoupon` 的分工：这个函数回答"这张券作为一份数据是否自洽"
 * （在写入数据库时就该拦），而 `evaluateCoupon` 回答"它在**这一单**上能不能用"。
 * 混在一起的话，一张"从未生效区间为空的券"会安静地躺在库里，直到有人用。
 */
export const validateCouponDefinition = (coupon: CouponDefinition): string[] => {
  const problems: string[] = [];
  const where = `券 ${coupon.id || '(无 id)'}`;

  if (typeof coupon.id !== 'string' || coupon.id.trim() === '') {
    problems.push(`${where}：id 不能为空`);
  }
  if (coupon.code !== null) {
    if (typeof coupon.code !== 'string' || coupon.code.trim() === '') {
      problems.push(
        `${where}：code 要么是 null（只做自动促销），要么是非空字符串 —— ` +
          '空字符串会被当成"用户输了个空码"而永远匹配不上',
      );
    } else if (normalizeCouponCode(coupon.code) !== coupon.code) {
      problems.push(
        `${where}：code 必须已经归一化（大写、无首尾空白），实际 ${JSON.stringify(coupon.code)}。` +
          `归一化只在一个地方做：${'normalizeCouponCode'}()。`,
      );
    }
  }
  if (!isCurrency(coupon.currency)) {
    problems.push(`${where}：currency 不合法`);
  }
  if (!isMinorAmount(coupon.validFrom) || coupon.validFrom < 0) {
    problems.push(`${where}：validFrom 必须是 ≥ 0 的安全整数`);
  }
  if (coupon.validUntil !== null) {
    if (!isMinorAmount(coupon.validUntil)) {
      problems.push(`${where}：validUntil 必须是安全整数或 null`);
    } else if (isMinorAmount(coupon.validFrom) && coupon.validUntil < coupon.validFrom) {
      problems.push(
        `${where}：validUntil(${coupon.validUntil}) 早于 validFrom(${coupon.validFrom}) —— ` +
          '这张券从来没有生效过，多半是写错了而不是有意的',
      );
    }
  }
  for (const [field, value] of [
    ['maxRedemptions', coupon.maxRedemptions],
    ['maxRedemptionsPerUser', coupon.maxRedemptionsPerUser],
  ] as const) {
    if (value !== null && (!isMinorAmount(value) || value <= 0)) {
      problems.push(
        `${where}：${field} 必须是**正**整数或 null，实际 ${value} —— ` +
          '0 的意思是"一次都不许用"，那等于停用，请用 enabled=false 表达',
      );
    }
  }
  if (coupon.minimumOrderMinor !== null && (!isMinorAmount(coupon.minimumOrderMinor) || coupon.minimumOrderMinor < 0)) {
    problems.push(`${where}：minimumOrderMinor 必须是 ≥ 0 的安全整数或 null`);
  }
  if (coupon.priceIds !== null) {
    if (coupon.priceIds.length === 0) {
      problems.push(
        `${where}：priceIds 是空数组 —— 它表示"谁都不适用"，是一张死券。` +
          '想表达"全部适用"请用 null。',
      );
    }
    if (coupon.priceIds.some((p) => typeof p !== 'string' || p.trim() === '')) {
      problems.push(`${where}：priceIds 里有空项`);
    }
    if (new Set(coupon.priceIds).size !== coupon.priceIds.length) {
      problems.push(`${where}：priceIds 有重复项`);
    }
  }
  if (coupon.regions !== null) {
    if (coupon.regions.length === 0) {
      problems.push(`${where}：regions 是空数组 —— 同上，想表达"全部"请用 null`);
    }
    if (coupon.regions.some((r) => !isRegion(r))) {
      problems.push(`${where}：regions 里有不认识的值`);
    }
  }

  // 折扣内容
  switch (coupon.benefit.kind) {
    case 'percent': {
      if (!isPercentOffBp(coupon.benefit.percentOffBp)) {
        problems.push(
          `${where}：percentOffBp 必须是 0..${PERCENT_OFF_BP_MAX} 的整数（基点，1bp = 0.01%）`,
        );
      } else if (coupon.benefit.percentOffBp === 0) {
        problems.push(`${where}：percentOffBp = 0 的券什么也不减 —— 是配置错误，不是"低调的券"`);
      } else if (coupon.benefit.percentOffBp === PERCENT_OFF_BP_MAX) {
        problems.push(
          `${where}：100% 的券会把订单打到 0 元，而 0 元单**无法完成支付**` +
            `（MIN_CHARGEABLE_AMOUNT_MINOR = ${MIN_CHARGEABLE_AMOUNT_MINOR}）。` +
            '想做免费，就把它做成一个真正的免费档，不要用券假装。',
        );
      }
      break;
    }
    case 'fixed': {
      if (!isMinorAmount(coupon.benefit.amountOffMinor) || coupon.benefit.amountOffMinor <= 0) {
        problems.push(`${where}：amountOffMinor 必须是**正**安全整数（分）`);
      }
      break;
    }
    default: {
      const never: never = coupon.benefit;
      problems.push(`${where}：未知的 benefit 形状 ${JSON.stringify(never)}`);
    }
  }

  // 门槛与面额的关系：**门槛以上、面额盖过门槛**意味着"刚好到门槛的那一单会被
  // 夹到 0 元"，而 0 元单无法完成支付。判据是 `面额 ≥ 门槛` 而不是
  // `面额 ≥ 门槛 + 1`：因为门槛是**闭**的（`original >= threshold` 才可用），
  // 所以 `original == threshold` 那一单必然被夹到 0。
  if (coupon.benefit.kind === 'fixed' && isMinorAmount(coupon.benefit.amountOffMinor)) {
    const threshold = coupon.minimumOrderMinor;
    if (
      threshold !== null &&
      isMinorAmount(threshold) &&
      threshold > 0 &&
      coupon.benefit.amountOffMinor >= threshold
    ) {
      problems.push(
        `${where}：面额 ${coupon.benefit.amountOffMinor} 分 ≥ 门槛 ${threshold} 分，` +
          '意味着刚好到门槛的那一单会被夹到 0 元而**无法支付**。' +
          '要么降低面额，要么提高门槛。',
      );
    }
  }

  return problems;
};

/**
 * 判定一张券在**这一单**上能不能用，以及减多少。
 *
 * 检查顺序是**刻意的**，而且顺序本身有可观察的行为：
 * 从"这张券还存在吗"（停用）到"这一单配不配"（金额），从粗到细。
 * 把 `not_chargeable_after_discount` 放在**最后**是关键的：
 * 它是唯一一个"前面的检查全过了，但结果仍然不可支付"的原因，
 * 于是它必须是在**算出折扣之后**才可能得出 —— 提前判它就需要重新实现一遍折扣算术，
 * 那就是两份实现。
 *
 * 🔴 每种拒绝都**必须**有一条测试（`billing-coupon.spec.ts`）：
 * 一个永远不可能被触发的 `reason` 等于一个死分支，而它看起来像"已处理"。
 */
export const evaluateCoupon = (coupon: CouponDefinition, ctx: CouponContext): CouponEvaluation => {
  const reject = (reason: CouponEvaluateRejection): CouponRejected => ({
    ok: false,
    couponId: coupon.id,
    reason,
  });

  if (!coupon.enabled) return reject('disabled');
  if (ctx.now < coupon.validFrom) return reject('not_started');
  if (coupon.validUntil !== null && ctx.now > coupon.validUntil) return reject('expired');
  if (coupon.currency !== ctx.currency) return reject('currency_mismatch');
  if (coupon.regions !== null && !coupon.regions.includes(ctx.region)) {
    return reject('region_mismatch');
  }
  if (coupon.priceIds !== null && !coupon.priceIds.includes(ctx.priceId)) {
    return reject('price_not_applicable');
  }
  if (
    coupon.minimumOrderMinor !== null &&
    ctx.originalAmountMinor < coupon.minimumOrderMinor
  ) {
    return reject('order_below_minimum');
  }
  if (coupon.firstPurchaseOnly && ctx.usage.userHasPaidOrder) {
    return reject('first_purchase_only');
  }
  if (
    coupon.maxRedemptions !== null &&
    ctx.usage.totalRedemptions >= coupon.maxRedemptions
  ) {
    return reject('total_redemption_limit_reached');
  }
  if (
    coupon.maxRedemptionsPerUser !== null &&
    ctx.usage.userRedemptions >= coupon.maxRedemptionsPerUser
  ) {
    return reject('user_redemption_limit_reached');
  }

  // 到这里才允许碰折扣算术。`computeDiscountMinor` 会对非法定义抛异常，
  // 所以先跑一次定义校验，把"非法数据"与"合法但不可用"分开报。
  const definitionProblems = validateCouponDefinition(coupon);
  if (definitionProblems.length > 0) {
    // 不静默：一张定义就不合法的券出现在计价路径上，是**数据已损坏**的信号。
    throw new InvalidCouponDefinitionError(definitionProblems);
  }

  const rawDiscount = computeDiscountMinor(coupon.benefit, ctx.originalAmountMinor);
  const discountMinor = clampDiscountMinor(rawDiscount, ctx.originalAmountMinor);
  const { finalAmountMinor } = breakdownAmount(ctx.originalAmountMinor, discountMinor);
  if (finalAmountMinor < MIN_CHARGEABLE_AMOUNT_MINOR) {
    return reject('not_chargeable_after_discount');
  }

  return { ok: true, couponId: coupon.id, discountMinor, finalAmountMinor };
};

/** 用于计价的券定义本身不合法。见 `evaluateCoupon` 里对"不静默"的说明。 */
export class InvalidCouponDefinitionError extends Error {
  readonly code = 'COUPON_DEFINITION_INVALID';

  constructor(readonly problems: readonly string[]) {
    super(`用于计价的券定义不合法（${problems.length} 处）：\n   - ${problems.join('\n   - ')}`);
    this.name = 'InvalidCouponDefinitionError';
  }
}
