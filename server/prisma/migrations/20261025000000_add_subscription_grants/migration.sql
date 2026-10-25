-- 后台发放订阅的三个动作留一行审计（ADR-0076 §2 四）。
--
-- 为什么长这样：
--   · 这是一张**新表**，不是给 `subscriptions` 加列。权益状态仍然只在
--     `subscriptions` 那一行上（`provider='admin-grant'`）；这里记的是动作史。
--     加列做不了这件事：一次账号可能被发放、升档、收回多次，一列只装得下最后一次，
--     而"最后一次"恰恰是追溯时最没用的那条信息。
--   · 没有任何外键。`user_id` / `actor_user_id` 是**归属记录**，不是关系：
--     账号注销不该把"曾经给他发过什么"一起带走，也不该因为挂着审计而删不掉账号。
--     与 `refunds.requested_by` / `decided_by`、`announcements.created_by` 同一处理。
--   · `sku` 也不建外键：价目表的键是代码里的 SKU 常量（`price-book.ts` 的 `SKU_GRANTS`），
--     不是一行可引用的记录。引用 `price_versions` 会在"档位下架"时挡住审计行写入 ——
--     等于让追溯能力服从于配置状态。
--   · `action` / `reason` 存**语义与码**，不存界面句子：句子会改（中/英/文案），
--     码才是可对账的事实（同 `refunds.reason`）。
--   · `before_period_end` / `after_period_end` 让"这次动完之后他到哪天花掉"
--     一眼可读，也让人能复核一次发放是接在旧到期日后面还是重新开始。
--
-- 锁的代价：这是一张**新表**，建表与建索引都只锁它自己（里面还没有行），
-- 所以不需要 CONCURRENTLY —— 那条纪律是给热路径上的既有表索引的。
CREATE TABLE IF NOT EXISTS "subscription_grants" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL,
    "actor_user_id" INTEGER NOT NULL,
    -- 'grant' | 'upgrade' | 'revoke'：封闭词表在写入函数里，词表外直接抛。
    "action" TEXT NOT NULL,
    -- 发放的那一档。NULL 只出现在 revoke 行上（收回不重新声明档位）。
    "sku" TEXT,
    "days" INTEGER,
    -- 当时那一档授予的能力，从 SKU 派生。空数组 = 那一档确实不给任何能力。
    "grants" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "before_period_end" BIGINT,
    "after_period_end" BIGINT,
    -- 🔴 强制非空：会改变别人处境的动作用必须留下一句人话（ADR-0053 给退款批准的同一规矩）。
    "reason" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL DEFAULT 0
);

-- 两个读面的形状：按账号翻他的发放史、按时间翻全站（后台列表默认后者）。
CREATE INDEX IF NOT EXISTS "subscription_grants_user_id_created_at_idx"
    ON "subscription_grants"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "subscription_grants_created_at_idx"
    ON "subscription_grants"("created_at" DESC);
