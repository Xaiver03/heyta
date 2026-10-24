-- 运营公告（ADR-0075）。一张**新表**，不是给任何既有表加列。
--
-- 为什么它长这样：
--   · 公告是**部署方下发的一段内容**，不是用户的数据 —— 所以它不进 op-log、
--     不参与端到端加密，与 ADR-0052 那一条（调休/补班）同型。
--   · 没有任何外键。`created_by` 是一个**归属记录**，不是关系：账号注销不该
--     把已经发出去的公告一起带走，也不该因为挂着公告而删不掉账号。
--     与 `refunds.requested_by` / `decided_by` 同一处理。
--   · `expires_at` 可空 = "不过期"。"现在这条算不算挂着"由服务端那条查询裁决
--     （ADR-0075 §3.4），界面不许自己比时间戳。
--
-- 锁的代价：这是一张**新表**，建表与建索引都只锁它自己（里面还没有行），
-- 所以不需要 CONCURRENTLY —— 那条纪律是给热路径上的既有表索引的。
CREATE TABLE IF NOT EXISTS "announcements" (
    "id" SERIAL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    -- 'info' | 'warning'：封闭词表，界面按它画形状。存的是**语义**，不是颜色名。
    "level" TEXT NOT NULL DEFAULT 'info',
    "published_at" BIGINT NOT NULL,
    "expires_at" BIGINT,
    "created_by" INTEGER,
    "created_at" BIGINT NOT NULL DEFAULT 0,
    "updated_at" BIGINT NOT NULL DEFAULT 0
);

-- 读面的唯一形状是"取当前有效的那几条，按发布时刻倒序"（`published_at <= now`
-- 且 `expires_at IS NULL OR expires_at > now`）。这一枚复合索引服务的就是那条
-- 前缀；`expires_at` 不进索引 —— 它是每行都要验的谓词，不是一个查找前缀。
CREATE INDEX IF NOT EXISTS "announcements_published_at_idx" ON "announcements"("published_at" DESC);
