/**
 * 支付事件的幂等键拼装 —— **唯一**的事实源。
 *
 * 🔴 从 `wechat.adapter.ts` 搬出来：它不是某一家通道的格式，
 * 而是**我们自己的事件 id**（`payment_succeeded:<out_trade_no>`）。
 * 名字里带通道名会让"换通道就要换它"变成一个看起来合理的推断，而那是错的。
 *
 * 它有两处消费者，所以绝不能在两地各写一份字面量：
 * 1. 写支付事件时拼幂等键；
 * 2. **对账**（`reconcile.ts`）用它把 `payment_events` 行关联回
 *    `checkout_orders`（`payment_events` 表上**没有** `out_trade_no` 列）。
 *
 * 只改一处而不同步另一处，对账会**静默地一条候选都找不到** ——
 * 它不报错，只是安静地什么都不做，而那正是"补结算"要消除的失效模式。
 */

export const PAYMENT_SUCCEEDED_EVENT_PREFIX = 'payment_succeeded:';

/** 支付成功事件的幂等键。**唯一**的拼装点。 */
export const buildPaymentEventId = (outTradeNo: string): string =>
  `${PAYMENT_SUCCEEDED_EVENT_PREFIX}${outTradeNo}`;
