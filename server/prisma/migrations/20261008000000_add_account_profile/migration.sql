-- 账号资料：昵称一列（明文）+ 头像一张 1:1 表（**密文**）。R10。
--
-- 依据：docs/plans/ui-review-fill-zh-timeline.md §8.6（2026-10-02 产品负责人裁决）
-- 与 §8.7（实施表）。需求是产品负责人看图提出的：
--「我们现在头像的上传，还有昵称的个人 Profile 资料页……如果没有的话，你来做这件事情」，
-- 追问时收口成「就是个人 Profile 页面的增删改查之类的」。
--
-- ## 🔴 这一笔之前，昵称与头像在仓库里是**零**
--
-- 不是"做得不好"，三项全缺，逐项实测过：`users` 没有 `display_name`；
-- 全仓没有任何 profile / avatar 路由；`server/src` 零 multipart、零对象存储 ⇒
-- **上传通道不存在**。头像渲染是邮箱 `@` 前首字母大写（`AccountMenu.tsx`），没有 `<img>`。
--
-- ## 为什么昵称明文、头像密文（同一张页面上两种处理，是有意的）
--
-- `packages/legal/src/documents/personal-info-list.ts` 的**表 E「敏感个人信息」**
--（`id: 's6'`）是**逐项**对照《个人信息保护法》第二十八条那个列举写的，
-- 每一行"❌ 不收集"的理由都是**结构性**的 —— 不是"我们不看"，是"这个字段/这条通道不存在"：
--
--   生物识别那一行的原文依据是「没有任何生物特征模板**离开你的设备**」。
--   一张**明文**人脸照片进来，这句话当场变成假的。
--
-- 昵称不在那个列举里，也不与任何一行的依据冲突 ⇒ 明文可以。
-- 人脸照片命中"生物识别" ⇒ 必须密文。
-- 逐行对照与推论在 docs/research/countdown-anniversary-data-and-images.md §4，
-- 同族裁决 ADR-0025。⚠️ 表 E 末尾那句要反过来读：「这个结论建立在**我们不判断内容**上，
-- 不是建立在**我们看不到内容**上」—— 一旦某条通道让我们看得到，"不判断内容"就不再是理由。
--
-- ## 为什么"自托管的人自己承担代价"不能把它做成明文
--
-- 产品负责人的原话是「上传服务端没有关系啊……如果用户是自托管的话，就上传到用户自托管的
-- 地方去啊，他们自己要承担这个自托管的代价呀」。这句话**采纳**，但它承担的是
-- **存储与带宽**；隐私政策是我们写的、自托管部署者读的是**同一份**，
-- 所以"不收集生物识别"不能因为部署形态不同就变成假的（那份调研里已经预答过这一条）。
-- ⇒ 结论：**照样存进我们/他自己的数据库**（她要的跨设备带回、自托管自担存储，两条都满足），
-- 但存的是**密文**。
--
-- ## 为什么这一条**不新增任何前提**
--
-- 密文用的是**同步通道那把口令**（`sync-core` 的 `encrypt`）。而
-- `packages/sync-client/src/client.ts:703-709` 已经写明：没有口令**根本同步不了**
--（`reason: 'no-encryption-password'`）。⇒ 头像要跨设备，前提本来就是"能同步"，
-- 而"能同步"蕴含"有口令"。加密不比明文多要求任何东西。
--
-- ## 为什么这里**没有** `content_type` 列
--
-- 密文载荷里是 `{contentType, dataBase64}` 的 JSON —— 图片格式**也在密文里**，
-- 服务端连格式都不该知道。顺带这一条让上传**不需要** multipart、
-- 不需要自定义 content type parser、不引入任何新依赖（AGENTS §3.1 / §3.2 两道门）：
-- 密文本身是 base64 字符串，走 JSON body 与 op 上传**完全同形**。
--
-- ## 为什么头像是**另一张表**而不是 `users` 的两列
--
-- `users` 在同步热路径上被反复整行读出（鉴权之后还有订阅与配额判定）。
-- 图片字节挂在那一行 ⇒ **每次鉴权都拖一张图**，而那些查询只想知道"有没有、hash 多少"。
-- 1:1 拆出去之后，取头像才付取头像的代价。
--
-- ## 为什么是纯可加性、且不回填任何东西
--
-- 一列可空 + 一张新表零行 ⇒ 存量账号一行都不受影响。`display_name IS NULL`
-- 的含义是"从未设置过"，界面回落到邮箱派生名（`displayNameFromEmail`，
-- 那是只读派生值、不是这一列）。按 AGENTS.md §3.3：**不 bump `CURRENT_SCHEMA_VERSION`**。
--
-- ## 为什么是普通 DDL
--
-- 按 server/prisma/migrations/README.md 优先级 1：`ADD COLUMN NULL` 不取
-- `ACCESS EXCLUSIVE`（只 `SHARE`，不阻塞读写），新表与其主键/外键都是普通 `CREATE`。
-- 没有 `CONCURRENTLY`，也不需要 `SET LOCAL lock_timeout` 那个限时形状。
--
-- ## 外键与删除权
--
-- `user_id → users.id ON DELETE CASCADE`：注销账号时头像随账号一起消失，
-- 与库内另外 12 张带 `user_id` 的子表同一形状。
-- 🔴 但这一条**不是**"删除权已落实"的证据，而且这次比 `user_consents` 那笔更要紧：
-- 备份副本里的存留另有一节（`privacy.ts` 的"14 天内备份"那句，D-08 管它），
-- 而现在进库的是**用户照片的密文** —— 那句承诺的覆盖面因为这一笔实际变大了，
-- 要跟着改的是 §8.7 收尾清单里的法务表，不是这里。
--
-- SQL 由
--   npx prisma migrate diff --from-schema-datamodel <迁移前> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- 逐字取出（保证与 schema.prisma 不发生漂移）。
--
-- ## 回滚
--
-- `DROP TABLE "user_avatars"; ALTER TABLE "users" DROP COLUMN "display_name";`
-- —— 无损（这两样今天之前不存在，没有存量数据会跟着丢）。
-- 但不要把它做成迁移文件：迁移是不可逆层，回滚要另开一次有意识的变更。

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "display_name" TEXT;

-- CreateTable
CREATE TABLE "user_avatars" (
    "user_id" INTEGER NOT NULL,
    "cipher" BYTEA NOT NULL,
    "hash" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "user_avatars_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
