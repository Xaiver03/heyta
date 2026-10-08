-- 共享清单（多人协作）的四张表：`shares` / `share_members` /
-- `share_invitations` / `share_operations`。
--
-- 依据：docs/adr/0062-shared-list-key-distribution.md、
-- docs/plans/collaboration-shared-lists.md §2.4。
--
-- 🔴 与个人 op-log 的边界：`share_operations` 独立于 `operations`，
-- 按 `share_id` 划界、独立发号 —— 个人同步路径一个字节不动。
-- 服务端新增的明文元数据只有「成员关系 / share 存在性 / role /
-- entityType」；op 载荷是清单密钥加密的密文，信封（key_envelope）
-- 也只有密文 —— 服务端永远没有解信封的钥匙。
--
-- ## 为什么是普通 DDL
--
-- 四张**新建的空表**，行数与「共享清单 × 成员」同阶，永远不大 ——
-- 按 AGENTS.md §4 的优先级 1：表够小就用普通 DDL，不引入 CONCURRENTLY
-- 与那套恢复路径。
--
-- ## 为什么这里没有动 `users`
--
-- 只加外键与 `User` 侧的关系字段，对既有列零 ALTER —— 没有任何
-- "给已有行加必填列"的风险（AGENTS.md §3.3）。
--
-- SQL 主体与 prisma/schema.prisma 的四个 model 逐字对应
-- （列名 / 类型 / 默认值 / 索引 / 外键）；其后的 CHECK 是**手工补充**，
-- 因为 Prisma schema 表达不了它们。

-- CreateTable
CREATE TABLE "shares" (
    "id" TEXT NOT NULL,
    "owner_user_id" INTEGER NOT NULL,
    "key_epoch" INTEGER NOT NULL DEFAULT 1,
    "last_server_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" BIGINT NOT NULL DEFAULT 0,
    "deleted_at" BIGINT,

    CONSTRAINT "shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_members" (
    "id" TEXT NOT NULL,
    "share_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "identity_public_key" TEXT,
    "key_envelope" JSONB,
    "member_key_epoch" INTEGER NOT NULL DEFAULT 1,
    "added_at" BIGINT NOT NULL DEFAULT 0,
    "removed_at" BIGINT,

    CONSTRAINT "share_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_invitations" (
    "id" TEXT NOT NULL,
    "share_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_email" TEXT,
    "created_by_id" INTEGER NOT NULL,
    "created_at" BIGINT NOT NULL DEFAULT 0,
    "expires_at" BIGINT NOT NULL,
    "revoked_at" BIGINT,
    "accepted_by_user_id" INTEGER,
    "accepted_at" BIGINT,

    CONSTRAINT "share_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_operations" (
    "id" TEXT NOT NULL,
    "share_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "server_seq" INTEGER NOT NULL,
    "action_type" TEXT NOT NULL,
    "op_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "entity_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payload" JSONB NOT NULL,
    "payload_bytes" BIGINT NOT NULL DEFAULT 0,
    "vector_clock" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "client_timestamp" BIGINT NOT NULL,
    "received_at" BIGINT NOT NULL DEFAULT 0,
    "is_payload_encrypted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "share_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_members_share_id_user_id_key" ON "share_members"("share_id", "user_id");

-- CreateIndex
CREATE INDEX "share_members_user_id_idx" ON "share_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "share_invitations_token_hash_key" ON "share_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "share_invitations_share_id_idx" ON "share_invitations"("share_id");

-- CreateIndex
CREATE INDEX "shares_owner_user_id_idx" ON "shares"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "share_operations_share_id_server_seq_key" ON "share_operations"("share_id", "server_seq");

-- CreateIndex
CREATE INDEX "share_operations_share_id_entity_type_entity_id_server_seq_idx" ON "share_operations"("share_id", "entity_type", "entity_id", "server_seq");

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_members" ADD CONSTRAINT "share_members_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_members" ADD CONSTRAINT "share_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_invitations" ADD CONSTRAINT "share_invitations_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_invitations" ADD CONSTRAINT "share_invitations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_operations" ADD CONSTRAINT "share_operations_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 手工补充（Prisma schema 表达不了的部分）
-- ═══════════════════════════════════════════════════════════════════════════

-- 🔴 手工补充 1/5：成员 `role` 的**词表**钉在库里。
--
-- role 是服务端权限硬门的唯一依据（ADR-0062 决策 6）：viewer 全拒写、
-- commenter 只能写 COMMENT。应用层按这个词表判定，那么库里每一行的 role
-- 就必须**已经**是词表内的值 —— 写错一次（拼错、大小写、将来手滑加了
-- 'admin'）会让判定函数走进"未知 role"分支，而那个分支 fail-open 还是
-- fail-closed 没有人记得。与其赌分支写对了，不如让非法值在写入时当场炸。
ALTER TABLE "share_members" ADD CONSTRAINT "share_members_role_vocabulary"
  CHECK ("role" IN ('owner', 'editor', 'commenter', 'viewer'));

-- 🔴 手工补充 2/5：密钥世代必须 ≥ 1。
--
-- 世代是"rekey 发生过几次 +1"的计数，0 或负数没有意义；更重要的是
-- 客户端用世代派生清单密钥（HKDF info 里带 epoch），一行 epoch=0 的
-- 成员记录会让成员端派生出一把谁也对不上的钥匙 —— 症状是"明明是成员
-- 却解不开任何 op"，与"被移除"长得一模一样，极难排查。
ALTER TABLE "shares" ADD CONSTRAINT "shares_key_epoch_positive"
  CHECK ("key_epoch" >= 1);

ALTER TABLE "share_members" ADD CONSTRAINT "share_members_key_epoch_positive"
  CHECK ("member_key_epoch" >= 1);

-- 🔴 手工补充 3/5：邀请令牌散列的**形状**。
--
-- 裸 token 从不落库（落的是 sha256 的 hex）。钉住 64 位小写 hex 意味着
-- 任何把裸 token 直接写进这一列的调用点（未来某个图省事的运维脚本）
-- 会在写入时当场失败，而不是留下一行"看起来能用的明文凭据"。
ALTER TABLE "share_invitations" ADD CONSTRAINT "share_invitations_token_hash_shape"
  CHECK ("token_hash" ~ '^[0-9a-f]{64}$');

-- 🔴 手工补充 4/5：邀请接受的**全有或全无**。
--
-- 一行邀请只有两种合法形态：还没被接受（两列全 NULL），
-- 或者已被接受（两列全有）。允许半成品（写了 accepted_at 却没记
-- accepted_by_user_id）会造出一条"占用了名额却查不到是谁占的"行 ——
-- 29 人上限的计数会无故少一人，而管理员查成员列表时那个人不存在。
ALTER TABLE "share_invitations" ADD CONSTRAINT "share_invitations_acceptance_all_or_nothing"
  CHECK (
    ("accepted_by_user_id" IS NULL AND "accepted_at" IS NULL)
    OR
    ("accepted_by_user_id" IS NOT NULL AND "accepted_at" IS NOT NULL)
  );

-- 🔴 手工补充 5/5：成员移除时间的**因果顺序**。
--
-- `removed_at` 是移除发生的时刻，不可能早于入群时刻。这个约束防的是
-- 时钟回拨 / 手工改数造成的"先移除后加入"行 —— 那种行会让"活跃成员"
-- 的判定（removed_at IS NULL）与审计账（什么时候进的、什么时候出的）
-- 对不上。
ALTER TABLE "share_members" ADD CONSTRAINT "share_members_removed_after_added"
  CHECK ("removed_at" IS NULL OR "removed_at" >= "added_at");
