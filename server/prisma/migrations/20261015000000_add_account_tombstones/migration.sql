-- 账号面定点删除（P-12）的墓碑表：注销时写一条，恢复时必须按它把复活行再删一次。
-- 决策与口径：docs/adr/0055-account-tombstones-and-restore-gate.md（ADR-0055）；
-- 调研与"为什么不走逐账号 crypto-erase"在 docs/research/backup-side-erasure.md。
-- 写入点在 `server/src/account/account-tombstones.ts`（DELETE /account 与
-- `scripts/delete-user.ts` 两条硬删路径共用同一个函数），恢复闸在
-- `server/scripts/restore.sh`。
--
-- ## 🔴 这张表**故意没有**指向 users 的外键
--
-- `RevokedSyncDevice`（schema.prisma:373）的形状看起来一模一样，但它带
-- `onDelete: Cascade`。这里不能抄那一行：**这张表存在的唯一理由，就是在账号行
-- 已经不存在之后继续记录"这个 id 曾经被注销过"**。带上级联的外键会让删账号
-- 顺手把墓碑也删掉 —— 于是恢复旧备份时没有任何一层知道该拒绝谁，而这正是
-- ICO 那条"恢复不得把已注销的人复活"要挡的东西。
-- 现在本表没有出现在任何带级联的关系里（现量：
-- `grep -n 'onDelete: Cascade' server/prisma/schema.prisma` 列出的那些关系，
-- 一条都不指向 account_tombstones），墓碑因此能活过它记录的那次删除。
--
-- ## 🔴 `email_hash` 那条 CHECK 是**手工补充**，`schema.prisma` 表达不了
--
-- Prisma 只看得见列类型。这一列的承诺是"不存明文邮箱"（对外口径写在隐私政策里），
-- 而 `TEXT` 存得下 `someone@example.com` 并且**一个错都不报**。少了这条 CHECK，
-- 未来某次"顺手把邮箱也带上吧"的改动会静默地把明文身份写进一张会进每晚备份的表 ——
-- 那恰好是这次变更要消除的东西的反面。
-- `^[0-9a-f]{64}$` 钉的是"这一列只能是 SHA-256 的小写 hex"：
-- 明文邮箱（含 `@`、长度不固定）当场 `23514` 被拒，写成大写 hex 也一并被拒
-- （大小写混用会让"同一个邮箱算出两个值"，对账时读成"这个账号没注销过"）。
-- 口径与 `server/src/auth-tokens.ts` 那几列一致：SHA-256 hex，归一化走
-- `server/src/admin/admins.ts:48` 的 `trim().toLowerCase()`。
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
-- 按 server/prisma/migrations/README.md 优先级 1：新建一张表，没有索引。
-- `CREATE TABLE` 取 `AccessExclusive` 但作用在**新对象**上，没有存量读写被排在后面
-- （那才是 `SET LOCAL lock_timeout` 要防的事故形状）。墓碑表的量级是"注销过的账号数"，
-- 唯一读点是恢复流程的一次 `DELETE … WHERE user_id IN (SELECT …)`，走主键。
--
-- ## 回滚
--
-- `DROP TABLE "account_tombstones";` —— 无损（这张表今天之前不存在，没有存量数据会跟着丢；
-- 但已经写进去的墓碑会一起消失，所以回滚要连同恢复闸一起摘，不能只摘一半）。
-- 不要把它做成迁移文件：迁移是不可逆层，回滚要另开一次有意识的变更。

-- CreateTable
CREATE TABLE "account_tombstones" (
    "user_id" INTEGER NOT NULL,
    "email_hash" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_tombstones_pkey" PRIMARY KEY ("user_id")
);

-- 手工补充：这一列只能是 SHA-256 的小写 hex，不许是明文邮箱。
ALTER TABLE "account_tombstones" ADD CONSTRAINT "account_tombstones_email_hash_hex"
    CHECK ("email_hash" ~ '^[0-9a-f]{64}$');
