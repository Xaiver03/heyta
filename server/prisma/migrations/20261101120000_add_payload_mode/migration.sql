-- ADR-0080：端到端加密是**默认**而不是**强制** —— 账号级载荷模式。
--
-- 两个值：
--   'e2ee'     服务端只收密文（今天的行为，也是默认值）
--   'readable' 服务端只收明文（用户显式关掉加密之后的形态）
--
-- 为什么必须带默认值：新列若可空，所有既有路径都会在运行时撞上 undefined，
-- 而 Prisma 与 TypeScript 都不会告诉你（AGENTS §3.3 同一类问题）。默认 'e2ee'
-- 让存量行与新行都直接落在今天的行为上。
ALTER TABLE "user_sync_state" ADD COLUMN "payload_mode" TEXT NOT NULL DEFAULT 'e2ee';

-- 只允许两个值。用 CHECK 而不是 PG enum：将来加值不该需要一次迁移，
-- 但写错值必须在写入那一刻就红，而不是等到客户端读到不认识的值才降级。
ALTER TABLE "user_sync_state"
  ADD CONSTRAINT "user_sync_state_payload_mode_check"
  CHECK ("payload_mode" IN ('e2ee', 'readable'));
