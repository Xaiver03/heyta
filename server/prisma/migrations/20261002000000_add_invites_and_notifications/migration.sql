-- 账号级「通知中心 + 活动（福利中心）」的三张表：`invite_codes` / `referrals` /
-- `account_notifications`。
--
-- 依据：docs/plans/notification-and-activity.md、
-- docs/reference/pricing-and-entitlements.md（权益词表 hosting / ai）。
--
-- 🔴 这一迁移修的是「承诺了但没有机制」：界面上一直没有通知中心，
-- 而"邀请新人送会员"如果只写在落地页上却没有任何一张表记住
-- "谁邀请了谁、发了几天"，那句话就永远无法兑现，也无法对账。
--
-- ## 为什么是普通 DDL
--
-- 三张**新建的空表**，行数与用户数同阶，永远不大 ——
-- 按 AGENTS.md §4 的优先级 1：表够小就用普通 DDL，不引入 CONCURRENTLY
-- 与那套恢复路径。
--
-- ## 为什么这里没有动 `users`
--
-- 邀请码刻意**不**做成 `users` 上的一列（理由见 schema.prisma 里 `InviteCode`
-- 的注释：那是运营事实，不是账号身份）。所以本迁移只加三张新表 + 四条外键，
-- 对既有表零 ALTER —— 也就没有任何"给已有行加必填列"的风险（AGENTS.md §3.3）。
--
-- SQL 主体由
--   prisma migrate diff --from-schema-datamodel <迁移前> --to-schema-datamodel prisma/schema.prisma --script
-- 逐字取出（保证与 schema.prisma 不发生漂移）；其后的 CHECK 是**手工补充**，
-- 因为 Prisma schema 表达不了它们。

-- CreateTable
CREATE TABLE "invite_codes" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" BIGINT NOT NULL DEFAULT 0,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "invite_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" SERIAL NOT NULL,
    "invitee_user_id" INTEGER NOT NULL,
    "inviter_user_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL DEFAULT 0,
    "activated_at" BIGINT,
    "reward_days" INTEGER,
    "rewarded_at" BIGINT,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" BIGINT NOT NULL DEFAULT 0,
    "read_at" BIGINT,

    CONSTRAINT "account_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invite_codes_code_key" ON "invite_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "invite_codes_user_id_key" ON "invite_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_invitee_user_id_key" ON "referrals"("invitee_user_id");

-- CreateIndex
CREATE INDEX "referrals_inviter_user_id_created_at_idx" ON "referrals"("inviter_user_id", "created_at");

-- CreateIndex
CREATE INDEX "account_notifications_user_id_created_at_idx" ON "account_notifications"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_invitee_user_id_fkey" FOREIGN KEY ("invitee_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_notifications" ADD CONSTRAINT "account_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 手工补充（Prisma schema 表达不了的部分）
-- ═══════════════════════════════════════════════════════════════════════════

-- 🔴 手工补充 1/5：邀请码的**归一化契约**钉在库里。
--
-- 兑换路径是"把用户输入归一化，再拿去比"（`normalizeInviteCode()` 是唯一
-- 做归一化的地方）。那么库里每一行的 `code` 就必须**已经**是那个函数会产出的
-- 形状：大写、无首尾空白。少任何一条，失败都是**静默**的 ——
-- 用户拿着一张真的码，输入之后得到"邀请码无效"，而库里那一行看起来完全正常。
-- 这种"写入方忘了归一化"的 bug 在开发期几乎不可能被发现（生成代码本来就产大写），
-- 只有当某条运维脚本 / 手工 INSERT 写进一行小写码时才会现形，而那时没人会想到查这里。
--
-- `btrim` 一起钉住：前后空白是肉眼看不见的，`code = ' ABC'` 会让用户
-- 无论怎么输都匹配不上。
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_code_normalized"
  CHECK ("code" <> '' AND "code" = upper(btrim("code")));

-- 🔴 手工补充 2/5：**自己不能邀请自己**。
--
-- 这一条不是整洁，是**防铸币**：邀请奖励是"凭空多出 5 天会员"，
-- 而自邀一旦成立，一个人就能靠循环兑换把会员永久续下去 ——
-- 没有任何支付、没有任何成本。应用层也会拦（兑换时比对 inviter/invitee），
-- 但发奖是**不可逆**的（天数已经写进订阅行），所以最后一道防线放在库里：
-- 写错一次就当场失败，而不是等到对账时才发现有一批账号的到期日在无限远。
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_no_self_invite"
  CHECK ("inviter_user_id" <> "invitee_user_id");

-- 🔴 手工补充 3/5：结算的**全有或全无**。
--
-- 一行 `referrals` 只有两种合法形态：还没兑现（三个字段全 NULL），
-- 或者已经兑现（三个字段全有，且 `reward_days > 0`）。
--
-- 允许中间态（比如写了 `activated_at` 却没写 `rewarded_at`）会造出一条
-- **看起来已激活、其实没发奖**的行：邀请人在界面上的"成功邀请 1 人"会 +1，
-- 而他的会员一天都没涨。这种半成品不会报错、不会被任何断言抓到 ——
-- 它只是让两个数字对不上，而那两个数字分别在两张表里。
--
-- `reward_days > 0` 同属此列：0 天或负数天的"奖励"是一次静默的空操作，
-- 写进去之后这条邀请就永久地"已兑现"了，再也不会重发。
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_settlement_all_or_nothing"
  CHECK (
    (
      "activated_at" IS NULL
      AND "reward_days" IS NULL
      AND "rewarded_at" IS NULL
    )
    OR (
      "activated_at" IS NOT NULL
      AND "reward_days" IS NOT NULL
      AND "reward_days" > 0
      AND "rewarded_at" IS NOT NULL
    )
  );

-- 🔴 手工补充 4/5：通知的 `kind` 不能是空串。
--
-- `kind` 是客户端**唯一的**渲染入口（它决定图标与措辞模板：`switch (kind)`）。
-- 空串不匹配任何分支，于是在一个写了 default 分支的实现里会渲染出一条
-- 标题正文全空的卡片；在没写 default 的实现里会直接抛。
-- 两种都不是我们要的，而"空 kind 的行"没有任何人会主动去写 —— 它只可能来自
-- 某个忘了传参的调用点，正是最该在第一次就被拦下的那种。
ALTER TABLE "account_notifications" ADD CONSTRAINT "account_notifications_kind_nonempty"
  CHECK ("kind" <> '');

-- 🔴 手工补充 5/5：`payload` 必须是 JSON **对象**，不能是标量或数组。
--
-- 客户端读的是具名字段（`payload.actorName` / `payload.days`）。`JSONB` 这一列
-- 接受任意 JSON 值，所以 `'[]'` / `'5'` / `'"x"'` 全都能写进去 ——
-- 而它们在读取端全部表现为"字段是 undefined"，也就是**措辞里少了一个名字**，
-- 看起来像翻译缺失或前端 bug，与真实原因（载荷形状错了）离得很远。
--
-- 用 `jsonb_typeof` 而不是 `payload @> '{}'`：后者对数组也成立
-- （`'[]'::jsonb @> '{}'::jsonb` 为真），挡不住最能出错的那一种。
ALTER TABLE "account_notifications" ADD CONSTRAINT "account_notifications_payload_is_object"
  CHECK (jsonb_typeof("payload") = 'object');
