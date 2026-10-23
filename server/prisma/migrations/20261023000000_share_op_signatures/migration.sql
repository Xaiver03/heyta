-- 逐 op 签名（ADR-0069）。三枚**可空**列，一次加齐：
--   share_members.signing_public_key  —— 成员的 Ed25519 签名公钥（与 X25519 封装公钥是
--                                        同一份身份种子的两个子派生，用途不同）
--   share_operations.signer_member_id —— 服务端按认证上传者写入的作者成员行 id
--   share_operations.signature        —— 该 op 的 Ed25519 签名（base64）
--
-- 全部可空，理由有两条，都不是"以后再说"：
--   1. 加 NOT NULL 会要求表重写或回填，而这两张表是热路径上的（M4 的纪律是不为开发期
--      数据付生产代价）。
--   2. 签名启用之前落库的历史 op **不追签**（ADR-0069 裁决六：补签等于用私钥重放历史、
--      伪造作者时点）。所以"空"是一个**要被读出来的状态**（未签名），不是一个默认值。
--      🔴 空列不等于放行：新的无签上传在服务端按具名错误永久拒绝。
--
-- 不加索引：没有任何查询按 signature / signer_member_id 找行（下载走 [share_id, server_seq]
-- 唯一约束那条）。给一列没人查的东西建索引，只是给每次写入加一次维护。
ALTER TABLE "share_members" ADD COLUMN IF NOT EXISTS "signing_public_key" TEXT;
ALTER TABLE "share_operations" ADD COLUMN IF NOT EXISTS "signer_member_id" TEXT;
ALTER TABLE "share_operations" ADD COLUMN IF NOT EXISTS "signature" TEXT;
