-- 退款（临时方案：7×24 小时内全额、超期默认不退、例外只走运营后台）。
-- 决策与口径：docs/adr/0053-refunds-only-for-countable-segments.md（ADR-0053）；
-- 政策常量在 `server/src/billing/refund-policy.ts`，状态机在 `refund-store.ts`。
--
-- ## 这张表要回答的是"哪一笔钱买了哪一段"，而 `checkout_orders.status='refunded'` 回答不了
--
-- ADR-0026 §1 查实：`subscriptions` 上**没有任何字段记录"哪一笔支付买了哪一段时长"**，
-- 所以"退第 2 笔、保留第 1 笔"在那套模型里无法表达，任何回收都必然是**过度回收**。
-- 该 ADR 选的出路（方案 B）是：只承认"能精确回收的那个域"。
--
-- 这个域就是本表：`period_days` 把"这一单当初授予了多少天"冻在退款行上，
-- 于是回收是一次**可重放**的减法（`retractGrantedPeriod`），而不是对当前状态的猜测。
-- 落不到这个域的钱（没有 `out_trade_no` 的旧兼容到账事件，库里没有对应订单行）
-- 一律**拒发退款**（`NOT_CHECKOUT_ORDER`），不是"先退了再说"。
--
-- ## 🔴 三条 CHECK 都是**手工补充**，`schema.prisma` 表达不了它们
--
-- Prisma 只看得见列类型，看不见这些跨列/取值约束。少了它们会怎样，逐条写在下面。
--
-- ## SQL 的来源
--
-- 前段由
--   npx prisma migrate diff --from-schema-datamodel <HEAD 那份 schema> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- 逐字取出（保证与 schema.prisma 不发生漂移）；其后的 CHECK 是手工补充。
--
-- ## 为什么是普通 DDL（不带 CONCURRENTLY、不限时锁）
--
-- 按 server/prisma/migrations/README.md 优先级 1：新建一张表 + 普通 `CREATE INDEX`。
-- `CREATE TABLE` 取 `AccessExclusive` 但作用在**新对象**上，没有存量读写被排在后面
-- （那才是 `SET LOCAL lock_timeout` 要防的事故形状）。退款表的量级是"付费订单数的一小部分"，
-- 三条索引都钉在**新表自己的列**上，永远不需要并发建。
--
-- ## 回滚
--
-- `DROP TABLE "refunds";` —— 无损（这张表今天之前不存在，没有存量数据会跟着丢）。
-- 但不要把它做成迁移文件：迁移是不可逆层，回滚要另开一次有意识的变更。

-- CreateTable
CREATE TABLE "refunds" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "out_refund_no" TEXT NOT NULL,
    "provider_refund_id" TEXT,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "period_days" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reason" TEXT,
    "operator_note" TEXT,
    "requested_by" INTEGER,
    "decided_by" INTEGER,
    "requested_at" BIGINT NOT NULL DEFAULT 0,
    "decided_at" BIGINT,
    "refunded_at" BIGINT,
    "created_at" BIGINT NOT NULL DEFAULT 0,
    "updated_at" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_out_refund_no_key" ON "refunds"("out_refund_no");

-- CreateIndex
CREATE INDEX "refunds_user_id_status_idx" ON "refunds"("user_id", "status");

-- CreateIndex
CREATE INDEX "refunds_order_id_status_idx" ON "refunds"("order_id", "status");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "checkout_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 🔴 手工补充 1/3：**退出去的钱必须是一个正数**。
--
-- `amount_minor` 是"退款金额"这个事实的唯一载体（冻结在 `decideRefundEligibility`
-- 返回的**实付**上）。`0` 或负数在这一列上的症状不是报错，而是两件坏事同时成立：
-- 通道侧发起一笔永远退不成的请求，而**我们这侧的权益回收照样执行**
-- （回收只看 `period_days`，不看金额）。
-- 那一行就是"用户没收到钱、权益却到期了" —— 是要防的那类半真状态，不是理论问题。
-- 上限刻意没有：最大可退额由通道侧的余额决定，写死一个数会在涨价后变成假约束。
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive"
  CHECK ("amount_minor" > 0);

-- 🔴 手工补充 2/3：**回收的天数必须是"一段"，不能是零、也不能是一年半**。
--
-- 下界 `1` 挡的是 `period_days = 0`：那会造出本 ADR 明确禁止的那一半形状 ——
-- 钱退了、`checkout_orders.status` 变成 `refunded`，而 `current_period_end` 一格没动
-- （订单已退款而权益还在）。上界 `366` 挡的是"把年度档当月度回收"或反之：
-- 今天全仓只有一个授予时长（`SUBSCRIPTION_PERIOD_DAYS` = 30），
-- 任何落在这个区间外的值都只能是**写错了**，而不是"新的产品决定"。
-- ⚠️ 真要做 90 天 / 365 天的档，是**先加一列**（每单记住自己买了多久）再来放宽这里，
-- 而不是在这里把上抬成 400 让回收量继续靠猜。
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_period_days_range"
  CHECK ("period_days" BETWEEN 1 AND 366);

-- 🔴 手工补充 3/3：`refunded_at` 与 `status='success'` **互为充要条件**。
--
-- 这一条是"什么时候允许动权益"的库层落点。`refund-store.ts` 只在
-- `refunded_at` 从 `NULL` 变成非空的那一次写入里回收权益（靠
-- `UPDATE ... WHERE status IN ('approved','processing')` 的条件更新做幂等）。
-- 少了这条 CHECK，两种坏值都能静默进库：
--
-- | 坏值 | 症状 |
-- |---|---|
-- | `success` + `refunded_at IS NULL` | 通道说钱已退，我们这边一格没动 ⇒ **订单已退款而权益还在** |
-- | 非 `success` + `refunded_at` 非空 | 一条 `failed` / `abnormal` 的行被回收逻辑当成已退 ⇒ **没退钱却扣了天数** |
--
-- 两个方向都钉住，是因为这两个方向的后果**相反**，而它们的成因都是"某处写漏了一个字段"。
-- `closed`（通道关闭了这笔退款申请）在这里与非 success 同侧：它没有退钱，也就没有可扣的天数。
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_success_needs_refunded_at"
  CHECK ((("status" = 'success') AND ("refunded_at" IS NOT NULL))
      OR (("status" <> 'success') AND ("refunded_at" IS NULL)));
