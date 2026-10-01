-- 作废库里现存的**全部签名令牌**，因为从这一次部署起，那四列存的是令牌的
-- SHA-256 而不是令牌本身（见 server/src/auth-tokens.ts）。
--
-- ## 为什么必须清，而不是"留着不管"
--
-- 代码改完之后，所有查询都变成 `WHERE login_token = SHA-256(来路令牌)`。
-- 存量行里那串**明文**永远匹配不上 —— 也就是说留着它们只有两种结果：
-- 用户点邮件链接得到"链接已失效"，而那行明文**继续躺在库里**被下一次数据库
-- 泄露带出去。清掉才是既对了行为、又消掉了泄露面。
--
-- 这不是"牺牲在途链接来省事"：这四类令牌本来就是**短寿命的一次性凭证**
-- （登录魔法链接 15 分钟、注册验证 24 小时、通行密钥找回 1 小时），
-- 作废的后果是"再点一次重新发的那封"，而它的代价远低于让一批可直接使用的
-- 登录凭证留在一个会比应用本身更容易泄露的地方（备份、只读副本、导出）。
--
-- ## 为什么 `pending_passkey_registrations` 是 DELETE 而不是置 null
--
-- 那张表的 `verification_token` 是 **NOT NULL 且 @unique**：它记的是"这次还没被
-- 验证的通行密钥注册"，令牌是它存在的全部理由。令牌一旦不可能再被匹配上，
-- 这一行就成了一条永远兑现不了的登记 —— 删掉比留一个坏状态诚实。
-- 后果是那次未完成的 passkey 注册要重做一遍（界面上本来就还在那一步）。
--
-- ## 形状
--
-- 两条普通 DML，**没有 CONCURRENTLY、没有需要 ACCESS EXCLUSIVE 锁的 DDL**：
-- 表都与用户数同阶（见 AGENTS.md §4 与 migrations/README.md 优先级 1），
-- 所以既不需要并发建索引的可恢复形状，也不需要 `SET LOCAL lock_timeout`。
-- Prisma 会把整个文件包在一个事务里 ⇒ 要么全清、要么全没清，重试安全。
UPDATE "users" SET
  "verification_token" = NULL,
  "verification_token_expires_at" = NULL,
  "reset_password_token" = NULL,
  "reset_password_token_expires_at" = NULL,
  "passkey_recovery_token" = NULL,
  "passkey_recovery_token_expires_at" = NULL,
  "login_token" = NULL,
  "login_token_expires_at" = NULL
WHERE "verification_token" IS NOT NULL
   OR "reset_password_token" IS NOT NULL
   OR "passkey_recovery_token" IS NOT NULL
   OR "login_token" IS NOT NULL;
DELETE FROM "pending_passkey_registrations";
