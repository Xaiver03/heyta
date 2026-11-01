-- ADR-0079（2026-11-01 产品绝对决策）：头像是基础资料，明文存储。
--
-- 头像与昵称的用途是"在界面上认出这个账号"，不是用户的实质内容；端到端加密
-- 只留给任务、便签这类实质内容。旧版本把头像整块加密后才上传，代价是每次换头像
-- 都要先输入 E2EE 口令 / 解锁 vault —— 那是纯粹加到用户身上的负担。
--
-- 存量换算不了：服务端从来没有钥匙，旧行里是**解不开的密文**，没有任何一条 SQL
-- 能把它变成图片。heyta 仍在开发阶段（AGENTS §0：不可能有用户），所以这里直接清掉
-- 旧头像行；保留它们只会让界面把一段密文当图片渲染成坏图。用户重新选一张即可。
DELETE FROM "user_avatars";

-- Prisma 的 `cipher` 这个名字编码了"密文"这个已经作废的前提；
-- 改名而不是留着旧名，避免下一个人按注释去加密。
ALTER TABLE "user_avatars" RENAME COLUMN "cipher" TO "data";

-- 明文之后服务端终于是图片格式的权威：白名单见 shared-schema。
-- 表已在上一条清空，所以 `NOT NULL` 不需要默认值。
ALTER TABLE "user_avatars" ADD COLUMN "content_type" TEXT NOT NULL;
