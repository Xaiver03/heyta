-- 支付事件表 = webhook 幂等闸门（见 docs/plans/subscription-provider-selection.md §4/§5/§8）。
--
-- 为什么是普通 DDL：这是**新表** + 一个可空列，不是对已有大表的变更，
-- 不需要 CONCURRENTLY（AGENTS.md §4 优先级 1：表够小就用普通 DDL）。
--
-- 幂等的唯一可靠落点是 `payment_events_provider_provider_event_id_key`
-- 这个 **(provider, provider_event_id) 复合唯一索引** —— 不是单列。
-- 七家支付商的幂等机制互不相同（Stripe/PayPal 有 header、支付宝/微信只有
-- out_trade_no、Paddle 官方明确不支持客户端幂等键），所以去重只能落在这里。
--
-- 新列一律可选或带默认值（AGENTS.md §3.3）：`subscriptions.last_event_at` 可空，
-- `received_at` 带默认值，其余语义列可空。老行没有它们不会炸 hydration。
--
-- 本迁移与 `CURRENT_SCHEMA_VERSION` **无关**：那个常量管的是客户端 op-log /
-- 快照的线协议版本（packages/shared-schema/src/schema-version.ts），不是服务端表。
-- SQL 由 `prisma migrate diff --from-schema-datamodel <旧> --to-schema-datamodel schema.prisma`
-- 生成，保证与 schema.prisma 不发生漂移。

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "last_event_at" BIGINT;

-- CreateTable
CREATE TABLE "payment_events" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT,
    "payload_digest" TEXT,
    "occurred_at" BIGINT,
    "received_at" BIGINT NOT NULL DEFAULT 0,
    "processed_at" BIGINT,
    "subscription_id" INTEGER,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_events_provider_received_at_idx" ON "payment_events"("provider", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_provider_event_id_key" ON "payment_events"("provider", "provider_event_id");

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
