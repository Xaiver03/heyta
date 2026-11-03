-- 工单 `task-detail-ticktick-parity` #9：任务附件的**字节**通道。
--
-- 元数据（文件名 / MIME / 大小）是 `ATTACHMENT` 实体，走 op-log；这张表只存字节，
-- 不参与同步。为什么必须拆成两条通道，写在
-- `packages/shared-schema/src/attachment-http-contract.ts` 与 `server/prisma/schema.prisma`
-- 的 `AttachmentBlob` 上。
--
-- ✅ 形状选择按 `prisma/migrations/README.md`「prefer migrations that don't need recovery」第 1 条：
-- 这是一张**新表**，空表上的 `CREATE INDEX` 只锁它自己、不碰任何热对象，
-- 所以不需要 `CONCURRENTLY`（也就不会走进 out-of-band 恢复路径）。
CREATE TABLE "attachment_blobs" (
    "attachment_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "byte_count" INTEGER NOT NULL,
    "content_type" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "attachment_blobs_pkey" PRIMARY KEY ("attachment_id")
);

-- 配额闸门按账号求和 `byte_count`；孤儿回收按 `created_at` 扫。
CREATE INDEX "attachment_blobs_user_id_idx" ON "attachment_blobs"("user_id");

CREATE INDEX "attachment_blobs_created_at_idx" ON "attachment_blobs"("created_at");

ALTER TABLE "attachment_blobs"
    ADD CONSTRAINT "attachment_blobs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
