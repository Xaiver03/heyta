-- 彻底移除官方中央 OIDC 统一身份（ADR-0066 结论被新 ADR 取代）。
--
-- 认证唯一收敛为项目自建「邮箱 + 密码」体系（server/src/password/*、server/src/auth.ts、SMTP 验证码）。
-- 这 6 张表只服务中央 OIDC 的 identity / pending / handoff / attempt / grant / revocation；
-- official 部署从未上线，表为空。删除不可逆。
--
-- 形状遵循 prisma/migrations/README.md「prefer migrations that don't need recovery」第 1 条：
-- DROP TABLE 不涉及热对象索引构建，无需 CONCURRENTLY；单一事务内幂等 DROP（IF EXISTS），
-- 用 CASCADE 处理 central_grants → users / access_sessions 与 central_identities → users 的外键。
DROP TABLE IF EXISTS "central_attempts" CASCADE;
DROP TABLE IF EXISTS "central_handoffs" CASCADE;
DROP TABLE IF EXISTS "central_pending" CASCADE;
DROP TABLE IF EXISTS "central_grants" CASCADE;
DROP TABLE IF EXISTS "central_revocations" CASCADE;
DROP TABLE IF EXISTS "central_identities" CASCADE;
