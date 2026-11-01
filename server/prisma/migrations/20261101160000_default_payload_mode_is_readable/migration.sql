-- ADR-0081：新账号的载荷模式默认是 **明文（readable）**，端到端加密改成显式开启。
--
-- 理由（产品负责人 2026-11-01 原话）：
-- 「默认是明文；加密变成用户显式开启……绝大多数用户在用记账软件，即使是个人记账软件，
--   也不会选择这个方向。我们没有必要强制自己做出任何差异之类的。」
--
-- 存量：开发阶段没有用户（AGENTS §0），但机器上可能已有 e2ee 行（自测留下的）。
-- 这里一并回填成 readable —— 否则"新账号默认明文"与"老行仍是密文"会长期并存，
-- 而两者在界面上长得一模一样。
ALTER TABLE "user_sync_state" ALTER COLUMN "payload_mode" SET DEFAULT 'readable';

UPDATE "user_sync_state" SET "payload_mode" = 'readable' WHERE "payload_mode" = 'e2ee';
