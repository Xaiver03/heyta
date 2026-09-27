/**
 * **存量订单的重复对账**：把"钱已经到了、订单却从没被结算"的订单补结算。
 *
 * ## 为什么需要它
 *
 * webhook 的结算接线（`settleOrderPaidInTransaction`）是**后加**的。
 * 在它之前就已经付过款的订单，`PaymentEvent` 已经落库，但订单停在
 * `pending`（随后被 sweep 扫成 `expired`）。把支付商**重投**当解药是不行的：
 * 那条事件命中 `(provider, providerEventId)` 唯一约束，路由直接回 200 且
 * **不做任何副作用** —— 于是那些订单永远不会被结算，券的 `reserved` 名额也
 * 永远被一张已付款的订单占住。`webhook.routes.ts` 的文件头把这件事记成
 * "属于对账任务的范围"。本文件就是那个对账任务。
 *
 * ## "已付款但未结算"的**定义**（从 schema / 状态机推导，不是猜的）
 *
 * 一条 `checkout_orders` 行同时满足：
 *
 * 1. `status IN ('pending', 'expired')` —— **没有**推进到 `paid`。
 *    `paid` 是 `settleOrderPaidInTransaction` 的产物，所以"未结算"就是
 *    "状态还不是 paid"。⚠️ **不能用 `settled_at IS NULL` 当判据**：
 *    `expireStaleOrders` 在把订单扫成 `expired` 时会写 `settled_at`，
 *    而 `settleOrderPaidInTransaction` 把 `paid_at` / `settled_at` 一起写 ——
 *    `settled_at` 对这两种行都非空，它区分不了。
 * 2. **存在**一条 `payment_events` 行，其 `provider_event_id` 以
 *    `payment_succeeded:` 开头、后接本行的 `out_trade_no`
 *    （`WECHAT_PAYMENT_SUCCEEDED_EVENT_PREFIX`，唯一事实源在
 *    `wechat.adapter.ts`）。`payment_events` 表上**没有** `out_trade_no` 列，
 *    这个前缀是库里唯一能从事件找回订单的关联（见 `buildWechatPaymentEventId`
 *    的注释；它是**既有**数据形状，不是本轮新发明的编码）。
 * 3. `status = 'refunded'` / `'failed'` 的行**不是候选**：前者在
 *    `settleOrderPaidInTransaction` 里明确返回 `order-not-grantable`，后者从未付过款。
 *
 * ## 🔴 安全的重复性
 *
 * 对账可以随日清任务每天跑，且手动重跑不会重复授予：
 * - 候选查询只取 `pending` / `expired`，结算成功后状态变 `paid`，**第二次查询就找不到它**；
 * - 即便同一条被并发扫到两次，`settleOrderPaidInTransaction` 在事务里
 *   `SELECT … FOR UPDATE` 后见到 `status = 'paid'` 会返回 `already-paid`
 *   且**不写任何东西**（`applySettlementToEvent` 对非 `granted` 返回 `null`，
 *   权益也不会被第二次叠加）。
 *
 * ## ⚠️ 诚实的边界（它**不能**做什么）
 *
 * - **没有支付事件记录的订单，它settle不了**。钱付了但事件从未落库（例如
 *   本文件接线前的更早期、或事件被人工删过），这里没有任何东西能证明它付过款 ——
 *   函数不会去猜。这类订单只能靠**支付商侧的对账单**补，那是另一条工作流。
 * - **实付金额无法被独立复核**。`payment_events` 只存 payload 的 SHA-256
 *   （`payload_digest`，绝不存原文），所以 `paidAmountMinor` 取的是**订单冻结的**
 *   `final_amount_minor`。因此这里**排除**那些已经留下
 *   `order_amount_mismatch` 审计的订单：那说明"金额对不上"已经被观察过一次，
 *   属于要人看的账，不该被一次自动补结算抹平。
 * - **只认识微信的 `providerEventId` 形状**（`payment_succeeded:<out_trade_no>`）。
 *   别的 provider 的幂等键如果不同构，它们是**静默不匹配**的 —— 也就是
 *   一条候选都不会被找到。新增 provider 时必须同时给它一个前缀（见
 *   `paymentEventIdPrefix`），否则它的存量订单不会被这条对账覆盖。
 */
import { Logger } from '../logger';
import { toMillis } from './pricing-store';
import type { SettleOrderOutcome, SqlRunner } from './pricing-store';
import type { PaymentEventApplyOutcome } from './apply-event';
import type { NormalizedPaymentEvent } from './types';
import { WECHAT_PAYMENT_SUCCEEDED_EVENT_PREFIX, WECHAT_PROVIDER } from './wechat.adapter';

/** 一轮对账最多结算多少张订单。有界是刻意的：日清任务不能被一次积压拖住。 */
export const DEFAULT_RECONCILE_LIMIT = 500;

/** 一条候选：`checkout_orders` 的结算所需字段 + 找到它的那条支付事件。 */
export interface UnsettledPaidOrder {
  readonly orderId: number;
  readonly outTradeNo: string;
  readonly userId: number;
  readonly provider: string;
  /** 订单冻结的 SKU（`checkout_orders.price_id`）。`null` = 数据异常，会 fail-closed。 */
  readonly priceId: string | null;
  /** 订单冻结的实付金额。见文件头"边界"：它同时被当作待结算金额。 */
  readonly finalAmountMinor: number;
  /** 找到这条订单的支付事件 id —— 也是结算后写进订单 `provider_event_id` 的值。 */
  readonly providerEventId: string;
  /** 事件发生时间。`null` = 那条事件没有时间戳（会被跳过并报出来）。 */
  readonly occurredAt: number | null;
}

export interface FindUnsettledPaidOrdersInput {
  readonly limit: number;
  /** 默认 `wechat`。 */
  readonly provider?: string;
  /** 默认 `WECHAT_PAYMENT_SUCCEEDED_EVENT_PREFIX`。 */
  readonly paymentEventIdPrefix?: string;
}

interface UnsettledPaidOrderRow {
  readonly order_id: unknown;
  readonly out_trade_no: unknown;
  readonly user_id: unknown;
  readonly provider: unknown;
  readonly price_id: unknown;
  readonly final_amount_minor: unknown;
  readonly provider_event_id: unknown;
  readonly occurred_at: unknown;
}

/**
 * 找出"已付款但未结算"的订单。**只读**，可以随时调用。
 *
 * 定义与边界见文件头。排序用 `id ASC`：先付款的先补，且同一批的顺序稳定
 * （否则"这次补了哪些"会随查询计划变）。
 */
export const findUnsettledPaidOrders = async (
  sql: SqlRunner,
  input: FindUnsettledPaidOrdersInput,
): Promise<readonly UnsettledPaidOrder[]> => {
  const provider = input.provider ?? WECHAT_PROVIDER;
  const prefix = input.paymentEventIdPrefix ?? WECHAT_PAYMENT_SUCCEEDED_EVENT_PREFIX;

  const rows = await sql.query<UnsettledPaidOrderRow>(
    `SELECT o.id            AS order_id,
            o.out_trade_no,
            o.user_id,
            o.provider,
            o.price_id,
            o.final_amount_minor,
            e.provider_event_id,
            e.occurred_at
       FROM checkout_orders o
       JOIN payment_events e
         ON e.provider = o.provider
        AND e.provider_event_id = $2::text || o.out_trade_no
      WHERE o.provider = $1
        AND o.status IN ('pending', 'expired')
        AND NOT EXISTS (
              SELECT 1 FROM pricing_audit_log a
               WHERE a.action = 'order_amount_mismatch'
                 AND a.target = 'order:' || o.id::text
            )
      ORDER BY o.id ASC
      LIMIT $3`,
    [provider, prefix, input.limit],
  );

  return rows.map((row) => ({
    orderId: Number(row.order_id),
    outTradeNo: String(row.out_trade_no),
    userId: Number(row.user_id),
    provider: String(row.provider),
    priceId: row.price_id === null || row.price_id === undefined ? null : String(row.price_id),
    finalAmountMinor: Number(row.final_amount_minor),
    providerEventId: String(row.provider_event_id),
    occurredAt: toMillis(row.occurred_at) ?? null,
  }));
};

/**
 * 由候选构造一条**归一化支付事件**，交给与 webhook 共用的
 * `settleAndApplyEvent`（见 `webhook.routes.ts`）。
 *
 * - `paidAmountMinor` = 订单冻结金额（边界见文件头）；
 * - `oneTimeGrant: null` + `requiresOrderSettlement: true`：这一笔的档位
 *   **只能**由订单裁决，adapter 的金额启发式在这里没有输入（我们连实付金额
 *   都没有原文）。若结算失败，`applySettlementToEvent` 会返回 `null`，绝不发权益。
 * - `providerEventId` 用**库里那条真实事件**的 id：它是幂等键，也让结算后的
 *   订单 `provider_event_id` 指向"是哪条已落库的事件补的账"。
 */
export const buildReconcileEvent = (order: UnsettledPaidOrder): NormalizedPaymentEvent => {
  if (order.occurredAt === null) {
    throw new Error(
      `订单 ${order.orderId} 的支付事件 ${order.providerEventId} 没有 occurred_at，` +
        `无法构造待结算事件（不编一个时间戳：乱序闸门会因此误判）`,
    );
  }
  return {
    provider: order.provider,
    providerEventId: order.providerEventId,
    eventType: 'payment_succeeded',
    occurredAt: order.occurredAt,
    externalSubscriptionId: null,
    // 微信没有订阅状态机 —— 与 adapter 的归一化结果一致。
    status: null,
    currentPeriodEnd: null,
    userId: order.userId,
    oneTimeGrant: null,
    requiresOrderSettlement: true,
    outTradeNo: order.outTradeNo,
    paidAmountMinor: order.finalAmountMinor,
  };
};

/** 一条订单的补结算结论（保留原样，便于调用方/测试逐条断言）。 */
export interface ReconcileOrderOutcome {
  readonly orderId: number;
  readonly outTradeNo: string;
  readonly settlement: SettleOrderOutcome | null;
  readonly applied: PaymentEventApplyOutcome | null;
}

export interface ReconcileReport {
  /** 这一轮找到的候选数。 */
  readonly scanned: number;
  /** 真的把订单推进到 `paid` 的条数。 */
  readonly settled: number;
  /** 候选里被跳过的条数（没有时间戳 / 抢跑成 already-paid）。 */
  readonly skipped: number;
  /** 结算给出了"不授予"结论的条数（金额不符 / 已退款或失败 / 找不到订单）。 */
  readonly refused: number;
  readonly outcomes: readonly ReconcileOrderOutcome[];
}

export interface ReconcileInput {
  /** 注入时钟（epoch 毫秒）。 */
  readonly now: number;
  readonly limit?: number;
  readonly provider?: string;
  readonly paymentEventIdPrefix?: string;
}

/**
 * 对一条候选执行"结算 + 授予"。**事务边界由调用方开** —— 所以它注入进来。
 *
 * 生产接线见 `reconcile-job.ts`：一个 Prisma 事务里调
 * `settleAndApplyEvent`（与 webhook 同一份业务逻辑）。
 */
export type ReconcileApplier = (
  event: NormalizedPaymentEvent,
  order: UnsettledPaidOrder,
) => Promise<{
  readonly settlement: SettleOrderOutcome | null;
  readonly result: PaymentEventApplyOutcome | null;
}>;

/**
 * 跑一轮对账。**可重复调用**（见文件头"安全的重复性"）。
 *
 * 一条候选失败（抛异常）**不会**中断整轮：它被记成 `refused` 并继续下一条。
 * 这不是"吞掉错误" —— 拒绝的原因全部在返回值与日志里，只是不让一条坏数据
 * 挡住后面所有真正该补的订单。
 */
export const reconcileUnsettledPaidOrders = async (
  sql: SqlRunner,
  input: ReconcileInput,
  apply: ReconcileApplier,
): Promise<ReconcileReport> => {
  const candidates = await findUnsettledPaidOrders(sql, {
    limit: input.limit ?? DEFAULT_RECONCILE_LIMIT,
    provider: input.provider,
    paymentEventIdPrefix: input.paymentEventIdPrefix,
  });

  const outcomes: ReconcileOrderOutcome[] = [];
  let settled = 0;
  let skipped = 0;
  let refused = 0;

  for (const order of candidates) {
    let settlement: SettleOrderOutcome | null = null;
    let applied: PaymentEventApplyOutcome | null = null;
    try {
      if (order.occurredAt === null) {
        // 不编一个时间戳：`lastEventAt` 会被写错，之后真正的事件会被误判成过时。
        skipped += 1;
        Logger.warn('billing 对账：候选订单的支付事件没有时间戳，跳过', {
          orderId: order.orderId,
          providerEventId: order.providerEventId,
        });
        outcomes.push({ orderId: order.orderId, outTradeNo: order.outTradeNo, settlement: null, applied: null });
        continue;
      }
      const applied2 = await apply(buildReconcileEvent(order), order);
      settlement = applied2.settlement;
      applied = applied2.result;
    } catch (error) {
      refused += 1;
      Logger.error('billing 对账：补结算一条订单时抛错，继续下一条', {
        orderId: order.orderId,
        outTradeNo: order.outTradeNo,
        error: error instanceof Error ? error.message : String(error),
      });
      outcomes.push({ orderId: order.orderId, outTradeNo: order.outTradeNo, settlement: null, applied: null });
      continue;
    }

    if (settlement !== null && settlement.outcome === 'granted') {
      settled += 1;
    } else if (settlement !== null && settlement.outcome === 'already-paid') {
      // 并发/重跑：已经被别人结算过了。幂等，不算失败。
      skipped += 1;
    } else if (settlement === null) {
      skipped += 1;
    } else {
      refused += 1;
    }

    outcomes.push({ orderId: order.orderId, outTradeNo: order.outTradeNo, settlement, applied });
  }

  return { scanned: candidates.length, settled, skipped, refused, outcomes };
};
