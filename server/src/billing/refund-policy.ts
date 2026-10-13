/**
 * 退款政策的**唯一口径**（临时方案，2026-10-05）
 * ==============================================
 *
 * 这个文件回答两件事，而且只在这里回答：
 *
 * 1. **这一单现在能不能退**（`decideRefundEligibility`）；
 * 2. **退了之后那一行权益该怎么回退**（`retractGrantedPeriod`）。
 *
 * 🔴 为什么必须是**纯函数 + 一份常量**：退款是"钱已经进来了"之后的判断。
 * 如果"7 天内全额退"这句话散落在路由、后台界面、法务文案三处，
 * 那么任何一次调整都会留下三个互相矛盾的版本 —— 而对用户来说，
 * 界面说能退、服务端拒，或者法务写 7 天、代码判 3 天，都是**同一类事故**。
 *
 * ## 口径本身（业主 2026-10-05 授权定的临时值，之后可改）
 *
 * - 支付成功起 **7×24 小时**内：**全额**退（本档是单次 30 天买断，没有部分退的形状）；
 * - 超过 7×24 小时：**默认不退**；运营者可以在后台**带理由**批例外（`operatorApproved`），
 *   例外走同一条代码路径，只跳过时间窗这一条判断；
 * - 只退**经由收银台下过的单**（`checkout_orders`）—— 理由见下面第 4 条。
 *
 * ## 🔴 为什么"只能退收银台那一路"（这条是 ADR-0026 的硬约束留给的）
 *
 * ADR-0026 §1 查实：`Subscription` 上**没有任何字段记录"哪一笔支付买了哪一段"**，
 * 所以"退第 2 笔、保留第 1 笔"在那套模型里无法表达，任何回收都必然是**过度回收**。
 *
 * 但经由收银台的单不一样：每一单在 `checkout_orders` 里都是一条**带 `status='paid'`
 * 的自有记录**，而授予侧的规则是死的（`apply-event.ts`：一次支付 = +30 天，
 * 能力 = 这一单冻结的 `price_id` 的投影）。于是那一行的总时长
 * **可数**：`已付且未退的订单数 × 30 天`。
 *
 * ⇒ 回收量 = 恰好 **30 天**，且**不会碰**更早那笔合法购买买下的时间。
 *
 * 反过来，**没有订单号**的到账（旧兼容路径：adapter 自己声明 `oneTimeGrant`）
 * 在库里没有可对账的那一行 —— 那种事件一律拒退（`NOT_CHECKOUT_ORDER`）。
 * 这不是"实现得糙一点"，而是**只在能算对的地方动手**。
 */
import { SUBSCRIPTION_PERIOD_DAYS } from '@heyta/domain';

import type { OrderStatus } from './pricing-store.js';

/** 临时口径的唯一数字。改它只改这一行，界面上那句话由 `check:pricing` 一侧对账。 */
export const REFUND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 一次授予的天数。**不是第二份事实** —— 它是授予侧那个常量的指针
 * （`@heyta/domain` 的 `SUBSCRIPTION_PERIOD_DAYS`，`webhook.routes.ts` 用它写单）。
 *
 * 🔴 为什么必须是引用而不是抄一个 `30`：退款回收的是"那一单买下的那一段"。
 * 两边各写一份字面量，将来谁调了授予侧而这里没跟上，回收量就与授予量不等 ——
 * 症状是"退了款却少扣天数"或"退了款把没买的时间也扣掉"，两边都不报错。
 * 判据在 `billing-refund-policy.spec.ts`：这条必须与授予侧那个常量逐字相等。
 */
export const REFUND_PERIOD_DAYS = SUBSCRIPTION_PERIOD_DAYS;

export type RefundDenialReason =
  /** 这一单不存在，或还没走到"付过钱"。 */
  | 'ORDER_NOT_PAYABLE'
  /** 已经是 `refunded`：同一笔钱不能退第二次。 */
  | 'ALREADY_REFUNDED'
  /**
   * 这一单**已经有一条没走完的退款**（`requested` / `approved` / `processing` / `success`）。
   *
   * 🔴 它必须排在时间窗**之前**，且**不**被 `operatorApproved` 跳过：与
   * `ALREADY_REFUNDED` 同族，它说的不是"时间不巧"，而是"这一单已经在退款这条路上了"。
   * 少了它，运营点两次批准就会向通道发两次全额退款请求，而我们这边有两行各自
   * 声称回收了一次 —— 那正是本 ADR 要防的"钱与天数对不上"。
   */
  | 'REFUND_ALREADY_OPEN'
  /** 超过 7×24 小时，且没有运营者批的例外。 */
  | 'WINDOW_PASSED'
  /** 🔴 到账时没有可比的实付金额：金额口径不成立，不许退一个算不清的数。 */
  | 'AMOUNT_UNVERIFIED'
  /** 这一单不是收银台下的（旧兼容路径）⇒ 库里没有可对账的那一段 ⇒ 不退。 */
  | 'NOT_CHECKOUT_ORDER';

export interface RefundEligibilityInput {
  /** 订单当前状态（来自 `checkout_orders.status`，词表由 `pricing-store` 把守）。 */
  readonly status: OrderStatus | string;
  /** 支付成功时间（epoch 毫秒）。`null` = 没有（视为不可退）。 */
  readonly paidAt: number | null;
  /**
   * 🔴 这一单**结算时收到的实付金额**（最小单位整数）。
   * 退款金额只能等于它，不能等于原价、也不能等于报价 —— 用了券的单退原价就是多退钱。
   */
  readonly paidAmountMinor: number | null;
  /** 商户订单号。`null` = 不是收银台那一路下的单。 */
  readonly outTradeNo: string | null;
  /**
   * 这一单是否**已经有一条没走完的退款行**（由调用方在同一事务里查出来）。
   *
   * 🔴 谁来判断这件事不是这里的事 —— 这里只承认"有开着的退款就不能再开一条"。
   * 判定者是 `requestRefund`，它对订单行取了 `FOR UPDATE`，所以"查 + 插"是串行的；
   * 把这个事实抄进本函数，是为了让**判定的顺序**（它跳过什么、不跳过什么）也只有一处说法。
   */
  readonly openRefundExists?: boolean;
  /** 现在（注入，便于测试与"到期边界"判据）。 */
  readonly now: number;
  /** 运营者批了例外（只有后台带理由的审批路径能置真）。 */
  readonly operatorApproved?: boolean;
}

export type RefundDecision =
  | { readonly allowed: true; readonly amountMinor: number; readonly reason: null }
  | { readonly allowed: false; readonly amountMinor: null; readonly reason: RefundDenialReason };

/**
 * 这一单现在能不能退、退多少。
 *
 * ⚠️ 判定的**顺序**是有意的：先认"这单退过/正在退"、再认状态与金额口径、最后才看时间窗。
 * 时间窗放在最后是因为 `operatorApproved` 只跳过它 —— 如果把它放在前面，
 * 一个"批了例外"的开关就会连带跳过"这单根本没付过钱"或"这一单已经有一条开着的退款"
 * 这种更基本的事实。
 */
export const decideRefundEligibility = (input: RefundEligibilityInput): RefundDecision => {
  const deny = (reason: RefundDenialReason): RefundDecision => ({
    allowed: false,
    amountMinor: null,
    reason,
  });

  if (input.status === 'refunded') return deny('ALREADY_REFUNDED');
  if (input.openRefundExists === true) return deny('REFUND_ALREADY_OPEN');
  if (input.status !== 'paid' || input.paidAt === null) return deny('ORDER_NOT_PAYABLE');
  // 🔴 没有订单号 = 库里没有"这一段"的账，回收量算不出来（见文件头第 4 条）。
  if (input.outTradeNo === null) return deny('NOT_CHECKOUT_ORDER');
  const paid = input.paidAmountMinor;
  if (paid === null || !Number.isInteger(paid) || paid <= 0) {
    return deny('AMOUNT_UNVERIFIED');
  }

  if (input.operatorApproved !== true && input.now - input.paidAt > REFUND_WINDOW_MS) {
    return deny('WINDOW_PASSED');
  }

  return { allowed: true, amountMinor: paid, reason: null };
};

export interface RetractInput {
  /** 这一行当前的到期日（epoch 毫秒）。`null` = 没有可用周期。 */
  readonly currentPeriodEnd: number | null;
  /** 现在。 */
  readonly now: number;
  /**
   * 退款之后，这一行**还剩多少笔已付且未退的收银台订单**。
   * 🔴 它必须是这个语义（不是"总共几笔"）—— 剩下 0 笔才允许整行失效。
   */
  readonly remainingPaidOrders: number;
  /** 一笔授予的天数（默认 `REFUND_PERIOD_DAYS`）。 */
  readonly periodDays?: number;
}

/**
 * 退款后这一行的到期日。
 *
 * 两条规则，都往"少给"的方向偏，且**从不删数据**（只算一个新到期日）：
 *
 * - 还剩别的已付订单：从到期日**扣掉这一段**（`periodDays`），但不许退到 `now` 之前 ——
 *   已经消费掉的天数追不回来，追回来会让用户**凭空少几天**。
 * - 一笔都不剩：到期日落到 `now`（整行不再有效）。
 *
 * ⚠️ 为什么"不许退到 now 之前"不是和稀泥：`currentPeriodEnd` 可能已经**在过去**
 * （早就到期了）。那时候扣满 30 天会把一个已经无权益的行推得更远 —— 无意义，
 * 而且会让"退款前已经到期"这一事实在库里被抹掉。所以取 `max(now, end - 30d)`
 * 之后再与"原本就不到 now 的旧值"比：旧值本来就 ≤ now 时**保持旧值**。
 */
export const retractGrantedPeriod = (input: RetractInput): number | null => {
  const periodDays = input.periodDays ?? REFUND_PERIOD_DAYS;
  const DAY_MS = 24 * 60 * 60 * 1000;

  if (input.currentPeriodEnd === null) return null;
  if (input.remainingPaidOrders <= 0) return input.now;
  // 已经到期的行：不动它（没有可回收的未来时间）。
  if (input.currentPeriodEnd <= input.now) return input.currentPeriodEnd;

  const retracted = input.currentPeriodEnd - periodDays * DAY_MS;
  return Math.max(input.now, retracted);
};
