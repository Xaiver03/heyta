-- 会员订阅（服务端表，不是 op；见 docs/plans/subscription-integration.md §4）。
--
-- 为什么是普通 CREATE TABLE：这是**新表**，不是对已有大表的变更，
-- 不需要 CONCURRENTLY（AGENTS.md §4 优先级 1：表够小就用普通 DDL）。
--
-- 每一列都可选或带默认值（AGENTS.md §3.3）：老 `users` 行没有这些列，
-- 所以这里刻意不出现"NOT NULL 且无 DEFAULT"的新语义列。
-- `current_period_end` / `status` 可空 = "无法确定权益"，由 entitlement 判定按拒绝处理。
--
-- 本迁移与 `CURRENT_SCHEMA_VERSION` **无关**：那个常量管的是客户端 op-log /
-- 快照的线协议版本（packages/shared-schema/src/schema-version.ts），不是服务端表。
-- SQL 由 `prisma migrate diff --from-schema-datamodel <旧> --to-schema-datamodel schema.prisma`
-- 生成，保证与 schema.prisma 不发生漂移。

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" SERIAL NOT NULL,
    "provider" TEXT,
    "external_subscription_id" TEXT,
    "status" TEXT,
    "current_period_end" BIGINT,
    "created_at" BIGINT NOT NULL DEFAULT 0,
    "updated_at" BIGINT NOT NULL DEFAULT 0,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_external_subscription_id_key" ON "subscriptions"("external_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;