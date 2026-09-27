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
 * ✅ **本文件现在被 PGlite 真跑**（`server/tests/billing-reconcile-job.pglite.spec.ts`，8 条）。
 * 原先它只过类型、没有测试（CI 没有 PostgreSQL，而这层看起来只是薄胶水）—— 那正是
 * **最容易被悄悄改坏又没人发现**的形状：它决定了"SQL 收到哪些参数""事务开在哪里"。
 * 现在第三参 `client` 可以注入，测试从外面递一个 **PGlite 支撑的假 Prisma client** 进来，
 * 于是参数映射（`$1/$2/$3` 顺序、`$2::text || o.out_trade_no`、`LIMIT $3`）、结果字段映射、
 * **每单一个事务**、"一单失败真回滚且不拖垮其他单"、零候选零副作用、候选查询失败要抛出 ——
 * 全部被真断言（4 组变异验证各自转红）。
 *
 * ⚠️ **边界（别把覆盖率读大了）**：测试里 `tx.subscription.*` 是**内存替身**，
 * 不是真 Prisma `subscription` 委托。真跑的是 SQL、参数、事务边界与订单/券的真实写入。
 * 要连权益存储也真跑，需要一份**连真 PostgreSQL** 的集成测试。
 */
import { prisma } from '../db';
import { createPrismaSqlExecutor, createPrismaSqlRunner } from './pricing-store';
import { buildSubscriptionApplyDeps, settleAndApplyEvent } from './webhook.routes';
import { DEFAULT_RECONCILE_LIMIT, reconcileUnsettledPaidOrders } from './reconcile';
import type { ReconcileInput, ReconcileReport } from './reconcile';
import type { PrismaTransactionClient } from './pricing-store';
import type { SubscriptionTxClient } from './webhook.routes';

/**
 * 🔴 **测试缝**：本文件所需 Prisma 面的**结构类型**（不是 `PrismaClient` 本身）。
 *
 * 事务回调必须同时给出原始 SQL 面（`$queryRawUnsafe` / `$executeRawUnsafe`）与
 * 权益写入面（`tx.subscription.*`）—— 结算与授予落在**同一个**事务里，这正是
 * 本文件存在的理由。声明成结构类型后，测试可以从外面递一个 PGlite 支撑的假
 * client 进来，让这一层（以及它传下去的 SQL 参数、事务边界）被真跑一遍 ——
 * 而不是只能靠读代码相信。生产默认值保持 `prisma`，行为一字不变。
 */
export type ReconcileTxClient = PrismaTransactionClient & SubscriptionTxClient;

/** 根 client：事务面之上多一个 `$transaction`（事务内**没有** `$transaction`）。 */
export interface ReconcilePrismaClient extends ReconcileTxClient {
  $transaction<T>(fn: (tx: ReconcileTxClient) => Promise<T>): Promise<T>;
}

/**
 * 可注入时钟（第二参，默认 `Date.now`）与可注入 client（第三参，默认生产 `prisma`）。
 * 便于测试与"用固定 now 重跑"。
 */
export const runBillingReconciliation = async (
  input: Partial<ReconcileInput> = {},
  now: () => number = Date.now,
  client: ReconcilePrismaClient = prisma,
): Promise<ReconcileReport> => {
  const nowMillis = input.now ?? now();
  const sql = createPrismaSqlExecutor(client);
  return reconcileUnsettledPaidOrders(
    sql,
    {
      now: nowMillis,
      limit: input.limit ?? DEFAULT_RECONCILE_LIMIT,
      provider: input.provider,
      paymentEventIdPrefix: input.paymentEventIdPrefix,
    },
    (event) =>
      client.$transaction(async (tx) =>
        settleAndApplyEvent(event, {
          sql: createPrismaSqlRunner(tx),
          subscriptions: buildSubscriptionApplyDeps(tx, () => nowMillis),
        }),
      ),
  );
};
