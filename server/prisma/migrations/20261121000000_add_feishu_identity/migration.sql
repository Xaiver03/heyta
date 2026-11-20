-- AddFeishuIdentity
-- 给 accounts 挂上飞书身份（网页应用 OAuth 登录）。
--
-- 为什么放在 users 表而不是单开映射表：一个账号目前只绑一枚飞书身份（管理员 = 一个人、
-- 普通用户 = 一个人），一对一；列放在本表省掉一次 join，也让"这个账号绑没绑飞书"
-- 在读账号时天然可见。见 server/src/feishu/feishu-auth-service.ts 的账号归属规则。
--
-- 可空 + 唯一：唯一索引允许多个 NULL，未绑定的账号互不冲突。
-- `feishu_open_id` 是应用内唯一标识（登录硬前提）；`feishu_union_id` 是同开发者跨应用
-- 稳定的兜底；`feishu_tenant_key` 只用于排查，不参与匹配、不做索引。

ALTER TABLE "users" ADD COLUMN "feishu_open_id" TEXT;
ALTER TABLE "users" ADD COLUMN "feishu_union_id" TEXT;
ALTER TABLE "users" ADD COLUMN "feishu_tenant_key" TEXT;

CREATE UNIQUE INDEX "users_feishu_open_id_key" ON "users"("feishu_open_id");
CREATE UNIQUE INDEX "users_feishu_union_id_key" ON "users"("feishu_union_id");
