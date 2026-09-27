/**
 * 把对账（`reconcile.ts`）接到**真实 Prisma 客户端**上的生产装配。
 *
 * 🔴 **它不做业务判断**：每条订单都走 `settleAndApplyEvent` ——
 * 与到账 webhook **同一份**逻辑（`webhook.routes.ts`）。本文件只做两件事：
 * 把 `prisma` 包成 `SqlRunner`、并给每条订单开一个事务。
 *
 * ## 为什么每条订单一个事务
 *
 * 一张订单的补结算要么整笔成立（订单 → `paid`、核销 → `applied`、订阅行写入），
 * 要么整笔不发生。一条坏数据不该把这一轮里其它几十张订单一起回滚 ——
 * 那会让"失败的到底是谁"变成一个需要考古的问题。所以事务边界在**单条订单**。
 *
 * ⚠️ 本文件是薄胶水，和 `pricing-store.ts` 的 Prisma 端口一样，
 * **不被 PGlite 覆盖**（CI 没有 PostgreSQL）。真正的 SQL 与业务逻辑都在
 * 被 PGlite 真跑过的函数里。
 */
import { prisma } from '../db';
import { createPrismaSqlExecutor, createPrismaSqlRunner } from './pricing-store';
import { buildSubscriptionApplyDeps, settleAndApplyEvent } from './webhook.routes';
import { DEFAULT_RECONCILE_LIMIT, reconcileUnsettledPaidOrders } from './reconcile';
import type { ReconcileInput, ReconcileReport } from './reconcile';

/** 可注入时钟，便于测试与"用固定 now 重跑"。默认 `Date.now`。 */
export const runBillingReconciliation = async (
  input: Partial<ReconcileInput> = {},
  now: () => number = Date.now,
): Promise<ReconcileReport> => {
  const nowMillis = input.now ?? now();
  const sql = createPrismaSqlExecutor(prisma);
  return reconcileUnsettledPaidOrders(
    sql,
    {
      now: nowMillis,
      limit: input.limit ?? DEFAULT_RECONCILE_LIMIT,
      provider: input.provider,
      paymentEventIdPrefix: input.paymentEventIdPrefix,
    },
    (event) =>
      prisma.$transaction(async (tx) =>
        settleAndApplyEvent(event, {
          sql: createPrismaSqlRunner(tx),
          subscriptions: buildSubscriptionApplyDeps(tx, () => nowMillis),
        }),
      ),
  );
};
