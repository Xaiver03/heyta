-- 可调价 + 优惠券 = 五张表。
--
-- 依据：docs/adr/0018-adjustable-pricing-and-coupons.md。
-- 表面结论见 docs/reference/pricing-and-entitlements.md 与
-- docs/reference/pricing-and-coupons.md。
--
-- 为什么是普通 DDL：这是**五张新表**，对已有大表零改动，不需要 CONCURRENTLY
-- （AGENTS.md §4 优先级 1：表够小就用普通 DDL）。下面的 CHECK 约束来自
-- `prisma migrate diff` 之后的**手工补充** —— Prisma schema 表达不了 CHECK，
-- 而这些不变量必须落在数据库上：金额关系、币种、状态词表、券的判别联合。
-- "把不变量只写在 TypeScript 里"等于把最后一道防线放在最容易被绕过的那一层。
--
-- 新列一律可选或带默认值（AGENTS.md §3.3）：除主键、金额、币种、状态这些
-- 语义必需的列外，其余都可空或有默认值。
--
-- 🔴 本迁移与 `CURRENT_SCHEMA_VERSION` **无关**：那个常量管的是客户端 op-log /
-- 快照的线协议版本（packages/shared-schema/src/schema-version.ts），不是服务端表。
-- 这五张表客户端看不见。
--
-- SQL 主体由
--   prisma migrate diff --from-schema-datamodel <旧> --to-schema-datamodel schema.prisma
-- 生成，保证与 schema.prisma 不发生漂移。

-- CreateTable
CREATE TABLE "price_versions" (
    "id" SERIAL NOT NULL,
    "price_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "effective_from" BIGINT NOT NULL,
    "effective_until" BIGINT,
    "note" TEXT,
    "created_at" BIGINT NOT NULL DEFAULT 0,
    "created_by" TEXT,

    CONSTRAINT "price_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_audit_log" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "before_json" TEXT,
    "after_json" TEXT,
    "actor" TEXT,
    "note" TEXT,
    "created_at" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "pricing_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "percent_off_bp" INTEGER,
    "amount_off_minor" INTEGER,
    "currency" TEXT NOT NULL,
    "applies_to_all_prices" BOOLEAN NOT NULL DEFAULT true,
    "price_ids" TEXT[],
    "applies_to_all_regions" BOOLEAN NOT NULL DEFAULT true,
    "regions" TEXT[],
    "valid_from" BIGINT NOT NULL,
    "valid_until" BIGINT,
    "max_redemptions" INTEGER,
    "max_redemptions_per_user" INTEGER,
    "minimum_order_minor" INTEGER,
    "first_purchase_only" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" BIGINT NOT NULL DEFAULT 0,
    "updated_at" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_orders" (
    "id" SERIAL NOT NULL,
    "out_trade_no" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "price_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "original_amount_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL,
    "final_amount_minor" INTEGER NOT NULL,
    "coupon_id" TEXT,
    "status" TEXT NOT NULL,
    "quoted_at" BIGINT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "paid_at" BIGINT,
    "settled_at" BIGINT,
    "provider_event_id" TEXT,
    "rejected_coupons_json" TEXT,
    "created_at" BIGINT NOT NULL DEFAULT 0,
    "updated_at" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "checkout_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" SERIAL NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "original_amount_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL,
    "final_amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reserved_until" BIGINT NOT NULL,
    "created_at" BIGINT NOT NULL DEFAULT 0,
    "applied_at" BIGINT,
    "settled_at" BIGINT,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_versions_price_id_currency_effective_from_idx" ON "price_versions"("price_id", "currency", "effective_from");

-- CreateIndex
CREATE INDEX "pricing_audit_log_target_created_at_idx" ON "pricing_audit_log"("target", "created_at");

-- CreateIndex
CREATE INDEX "pricing_audit_log_action_created_at_idx" ON "pricing_audit_log"("action", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_enabled_valid_from_idx" ON "coupons"("enabled", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_orders_out_trade_no_key" ON "checkout_orders"("out_trade_no");

-- CreateIndex
CREATE INDEX "checkout_orders_user_id_status_idx" ON "checkout_orders"("user_id", "status");

-- CreateIndex
CREATE INDEX "checkout_orders_status_expires_at_idx" ON "checkout_orders"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_order_id_key" ON "coupon_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_state_idx" ON "coupon_redemptions"("coupon_id", "state");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_user_id_state_idx" ON "coupon_redemptions"("coupon_id", "user_id", "state");

-- CreateIndex
CREATE INDEX "coupon_redemptions_state_reserved_until_idx" ON "coupon_redemptions"("state", "reserved_until");

-- AddForeignKey
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "checkout_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK 约束：数据库层的最后一道防线
-- ---------------------------------------------------------------------------
-- Prisma schema 表达不了 CHECK，所以这一段是手工的。它挡的是**应用层算错之后
-- 仍然写不进库**那一类：金额关系、币种、状态词表、券的判别联合。
-- 少了这一段，"折扣算错"就只是一个 TS 类型上的约定，而不是一个写入失败。

-- 价目表：金额必须为正（0 元不是"免费档"，是"这个 SKU 不该存在"）；
-- 币种有界；区间左闭右开且不空。
ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_effective_from_nonneg" CHECK ("effective_from" >= 0);
ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_currency_known" CHECK ("currency" IN ('CNY', 'USD'));
ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_window_ordered" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from");
ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_price_id_not_blank" CHECK (btrim("price_id") <> '');

-- 券：kind 与两个金额列构成判别联合 —— 恰好一个被填、另一个为空、且为正。
-- 这是"非法状态在数据库层就构造不出来"。百分比必须落在 (0, 10000) 开区间：
-- 0 什么也不减，10000 会把订单打到 0 元而 0 元单无法完成支付。
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_kind_known" CHECK ("kind" IN ('percent', 'fixed'));
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_benefit_shape" CHECK (
  ("kind" = 'percent' AND "percent_off_bp" IS NOT NULL AND "percent_off_bp" > 0 AND "percent_off_bp" < 10000 AND "amount_off_minor" IS NULL)
  OR
  ("kind" = 'fixed' AND "amount_off_minor" IS NOT NULL AND "amount_off_minor" > 0 AND "percent_off_bp" IS NULL)
);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_currency_known" CHECK ("currency" IN ('CNY', 'USD'));
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_valid_window_ordered" CHECK ("valid_until" IS NULL OR "valid_until" >= "valid_from");
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_limits_positive" CHECK (
  ("max_redemptions" IS NULL OR "max_redemptions" > 0)
  AND ("max_redemptions_per_user" IS NULL OR "max_redemptions_per_user" > 0)
);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_minimum_order_nonneg" CHECK ("minimum_order_minor" IS NULL OR "minimum_order_minor" >= 0);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_code_normalized" CHECK ("code" IS NULL OR "code" = btrim(upper("code")));
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_scope_arrays_present" CHECK (
  ("applies_to_all_prices" OR "price_ids" IS NOT NULL)
  AND ("applies_to_all_regions" OR "regions" IS NOT NULL)
);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_id_not_blank" CHECK (btrim("id") <> '');

-- 订单：报价三元组必须自洽。这一条最要紧 —— 它是"用户看到的价"与
-- "我们收的价"在数据库层面的连接点。final > 0 把 0 元单挡在写库之前。
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_amounts_coherent" CHECK (
  "original_amount_minor" > 0
  AND "discount_minor" >= 0
  AND "discount_minor" <= "original_amount_minor"
  AND "final_amount_minor" = "original_amount_minor" - "discount_minor"
  AND "final_amount_minor" > 0
);
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_currency_known" CHECK ("currency" IN ('CNY', 'USD'));
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_region_known" CHECK ("region" IN ('CN', 'INTL'));
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_status_known" CHECK ("status" IN ('pending', 'paid', 'failed', 'expired', 'refunded'));
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_payment_window" CHECK ("expires_at" > "quoted_at");
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_paid_has_time" CHECK ("status" <> 'paid' OR "paid_at" IS NOT NULL);
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_out_trade_no_not_blank" CHECK (btrim("out_trade_no") <> '');
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_provider_not_blank" CHECK (btrim("provider") <> '');

-- 核销：单行自洽。discount_minor > 0 是刻意的 —— 一张"减 0 元"的券在定义层
-- 就被拒绝（coupons_benefit_shape），所以一条核销记录必须真的减了钱。
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_amounts_coherent" CHECK (
  "original_amount_minor" > 0
  AND "discount_minor" > 0
  AND "discount_minor" <= "original_amount_minor"
  AND "final_amount_minor" = "original_amount_minor" - "discount_minor"
  AND "final_amount_minor" > 0
);
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_currency_known" CHECK ("currency" IN ('CNY', 'USD'));
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_state_known" CHECK ("state" IN ('reserved', 'applied', 'expired', 'reversed'));
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_reserved_until_future" CHECK ("reserved_until" > "created_at");
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_applied_has_time" CHECK ("state" <> 'applied' OR "applied_at" IS NOT NULL);
