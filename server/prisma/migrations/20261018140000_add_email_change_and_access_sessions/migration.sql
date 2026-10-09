-- 换绑登录邮箱的**活请求** + 一枚**已签发的访问令牌**各一张表。
--
-- 依据：docs/adr/0063-email-rebinding-and-per-session-revocation.md §2.1（双侧确认）、
-- §2.3（不留历史邮箱）、§2.5（会话带 `jti`）；工单 docs/plans/account-standard-suite.md W1 / W2。
-- 需求本身是产品负责人 2026-10-08 的指令：「把换绑流程做一下。换绑、忘记密码，整个注册登录的
-- 标准套件全都要做的…法律条文也需要更新。」
--
-- ## 🔴 侦察实测：这两张表要办的两件事，一件三层全缺、一件是"界面在说谎"
--
-- **换绑邮箱**：`server/src/**` grep `changeEmail|pending_email|换绑` **零命中**；
-- `packages/shared-schema` 的 `AUTH_PASSWORD_PATHS` 六条里没有一条关于邮箱；
-- `packages/app-host` 的 26 个认证函数零个关于改地址；web `ProfilePanel.tsx:416-421` 与
-- 移动 `ProfileScreen.tsx:1168` 都是**只读行**，而两处共用的词条 `common.profile.email.hint`
-- 原文写着「邮箱是登录标识，也是找回账号的唯一凭据，**不能在这里修改**」。
-- 政策那边早就替这一刻写好了触发条件：`data-rights.ts:352`「邮箱换绑实现之后：
-- 第三节那条"邮箱不可更换"会被删除，并换成换绑流程」。⇒ 本轮不是新增功能，是**兑现一条挂在墙上的条件**，
-- 所以代码与 `packages/legal` 必须同批（`check:legal-closure-truth` 就是为这件事存在的）。
--
-- **会话**：`issueSession` 签的 JWT 365 天（`auth.ts:22`），撤销只有一档 `tokenVersion++`（全局）。
-- 于是 `apps/web/src/App.tsx:2146` 的 `onSignOut` = `clearCredentials()` —— 只删本机那一份，
-- **服务端那枚令牌仍然有效一整年**。而 `DELETE /api/sync/devices/:clientId` 走的是
-- `revokeDevice` 再跟一次 `revokeAllTokens(userId)`（`sync.routes.ts:391-392`）= **撤一台即全登出**。
-- 两个动作各自都缺一半，这张表补的是"撤销**这一枚**"。
--
-- ## 为什么换绑是**两张令牌**而不是一条链接
--
-- 授权面有两个，不是发信要发两次：`old_token` 那句是「我授权把我的账号换到 X」，
-- `new_token` 那句是「这个新收件箱归我管」。只确认新邮箱的常见做法（GitHub 式"新地址确认 +
-- 旧地址只通知"）在这里不够，因为旧邮箱是这个账号**唯一的找回通道**（那句"找回账号的唯一凭据"
-- 是产品自己写的）：只通知不要求点击的时间窗里，一个拿到有效会话又控制着新邮箱的人可以先把
-- 找回通道换走，从此"忘记密码"全发到他那里。**双确认把攻击条件从"控制一个新邮箱"抬到
-- "同时控制两个邮箱"**，代价是多点一次。两半各自落成时间戳，最后那一次点击用一条
-- **带条件的 UPDATE** 原子触发生效（照 `password/recovery.ts:240` 那条 `updateMany` 形状），
-- 所以"两边都点过"只会生效一次。
--
-- ## 为什么 `email_change_requests` 的 `user_id` 直接是主键
--
-- 一个账号同时**最多一张活请求**。1:1 用主键表达（与 `user_avatars`、`vault_key_packages`
-- 同一形状），于是"两张活请求互相抢先"这种状态在库面上**写不出来**，而不是靠某个函数记得去拦。
-- `pending_email` 上那条唯一索引管的是"两个账号抢同一个待绑地址"；它**不管**"另一个账号
-- 已经持有那个地址"，后一半由发起那一步查 `users.email` 负责 —— 两侧各有一条判据，缺一个就是一个洞。
--
-- ## 为什么这里**没有** `previous_email`
--
-- 隐私政策 `privacy.ts:201` 现在写的是「这是库里**唯一的直接标识符**」。多存一个历史地址，
-- 那句就要改成"当前 + 曾经"，而 `personal-info-list.ts:288` 那张"账号表里没有真实姓名、没有电话…"
-- 的封闭清单要重画，`privacy.ts:404` 逐处数出来的"注销后仍可能存在的副本"也要跟着算 ——
-- 而这两张新表都**在每晚的整库备份里**。身份残留面因为一个只有"运营方便"收益的列而扩大，不划算。
-- 安全通知的价值由"两个地址各发一封完成信"兑现，不需要在库里再存一份（ADR-0063 §2.3）。
--
-- ## `access_sessions` 为什么是**存在即有效**
--
-- 主键是 `jti` 的 SHA-256 hex（同 `users` 那四列的立场：**库里不存那句发出去的东西**，
-- `auth-tokens.ts:6-12`；这里还多一层 —— 列表接口把哈希交给界面而不是原值，因为 `jti` 本来就在
-- 令牌里，JWT 的 payload 只是 base64 不是加密，别让它顺手变成一个可照抄的凭据来源）。
-- **撤销 = 删掉这一行**，所以 `verifyToken` 的判定是"这一行还在不在"。
-- 选删行而不是置 `revoked_at`：GDPR 侧要的是最小留存，而"撤过的会话"没有任何产品用途
-- （审计走 `Logger.audit`，它不落邮箱明文，同 `admin-log-pii` 那道门禁的纪律）。
--
-- ## 为什么这一笔**不新增任何前提**、也不动热路径
--
-- 两张新表零行 ⇒ 存量账号一行都不受影响。`verifyToken` 里那一次 `access_sessions` 读**只在
-- 缓存未命中时**发生（与 `tokenVersion` 完全同一档；撤销时当场 `authCache.invalidate(userId)`，
-- 所以单进程内没有 30 s 空窗，多副本下最长 30 s —— 与 `email-password-auth.md` §10.7 登记的
-- 限流单进程边界同源，不另开一份）。`last_seen_at` 的写入是**限流的**（只在距上次超过 5 分钟时
-- 才 UPDATE），否则每次鉴权都写一行会把登录面变成同步面那样的热写。
--
-- ## 为什么是普通 DDL
--
-- 按 server/prisma/migrations/README.md 优先级 1：新表与其主键/唯一索引/外键都是普通 `CREATE`，
-- 没有 `CONCURRENTLY`（表是新的、零行，建索引不需要并发），也不需要 `SET LOCAL lock_timeout`
-- 那个限时形状。`users` 上**一个 ALTER 都没有** —— 两件事各自成表，不给那行反复被整行读出的热表加列。
--
-- ## 外键与删除权
--
-- 两张表的 `user_id → users.id ON DELETE CASCADE`：注销账号时换绑请求与会话随账号一起消失，
-- 与库内另外十几张带 `user_id` 的子表同一形状。🔴 但这**不是**"删除权已落实"的证据 ——
-- 备份副本里的存留另有一节（`privacy.ts` 那句 14 天窗口），而这两张新表进的是**同一份备份**，
-- 所以《注销级联》那三处的数字要按迁移终态重算（`structure.spec.ts:483-589` 会算它，中英同数）。
-- 归 docs/plans/account-standard-suite.md W7 那张表的第 6 行。
--
-- SQL 由
--   npx prisma migrate diff --from-schema-datamodel <减掉本笔两块的那份 schema> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- 逐字取出（保证与 schema.prisma 不发生漂移）。
-- ⚠️ 基线**不是** `HEAD:server/prisma/schema.prisma`：并行会话已经往同一枚 schema 里加了
-- `automation_sender_credentials` 那一族而尚未提交，拿 HEAD 做基线会把**别人的表**打进这一笔。
-- 实测差异输出只含 `email_change_requests` 与 `access_sessions` 两张，才落成下面这份。
--
-- ## 回滚
--
-- `DROP TABLE "access_sessions"; DROP TABLE "email_change_requests";` —— 无损（这两张今天之前不存在）。
-- 但不要把它做成迁移文件：迁移是不可逆层，回滚要另开一次有意识的变更。

-- CreateTable
CREATE TABLE "email_change_requests" (
    "user_id" INTEGER NOT NULL,
    "pending_email" TEXT NOT NULL,
    "old_token" TEXT,
    "new_token" TEXT,
    "old_expires_at" BIGINT,
    "new_expires_at" BIGINT,
    "old_confirmed_at" BIGINT,
    "new_confirmed_at" BIGINT,
    "requested_at" BIGINT NOT NULL,
    "last_sent_at" BIGINT NOT NULL DEFAULT 0,
    "resend_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "email_change_requests_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "access_sessions" (
    "jti_hash" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_version" INTEGER NOT NULL,
    "device_name" TEXT,
    "user_agent" TEXT,
    "created_at" BIGINT NOT NULL,
    "last_seen_at" BIGINT NOT NULL,

    CONSTRAINT "access_sessions_pkey" PRIMARY KEY ("jti_hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_change_requests_pending_email_key" ON "email_change_requests"("pending_email");

-- CreateIndex
CREATE INDEX "access_sessions_user_id_token_version_idx" ON "access_sessions"("user_id", "token_version");

-- AddForeignKey
ALTER TABLE "email_change_requests" ADD CONSTRAINT "email_change_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_sessions" ADD CONSTRAINT "access_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
