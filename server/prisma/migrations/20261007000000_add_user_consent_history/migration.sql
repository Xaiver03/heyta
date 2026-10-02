-- 同意历史表 `user_consents`：一个人先后同意过哪几版对外文本。
--
-- 依据：docs/plans/legal-compliance-before-filing.md 的 **G-27**（补签流程），
-- 形状出自 docs/research/legal-consumer-contract-terms.md 层 3 那段 `model UserConsent`，
-- 但按**今天真实存在的界面**收窄了（见下）。
--
-- ## 为什么上一笔迁移把这活儿推给了今天
--
-- `20261006000000_add_terms_document_version` 的注释里逐字写着：
-- "独立 `UserConsent` 表留给『二次同意需要历史』真正落地的那天（层 4 的 A 档阻断确认）"。
-- 那一天就是这一笔。理由是 `users.terms_document_version` 是一**列**，
-- 它只能回答"最后一次同意的是哪一版"；而对外文本（`terms.ts` s10）承诺的是
-- "重大变更需要你在应用内**重新确认**" —— 一次重新确认会产生**第二条**事实
-- （"先同意过 1.0，改版后又同意过 1.1"）。一列存不下两件事。
--
-- ## 🔴 这张表里没有 `document_hash`，也没有 `surface`（来源端）
--
-- 研究文档层 3 那段草稿里有这两列，本迁移**故意不带**。
-- 对外文本承诺记录的是"同意时刻 + 那一套文件的版本号"（`privacy.ts` 第 12 条逐字），
-- 哈希与"来自哪个端"都不在那句话里。未经宣告就写进数据库是先采集后告知 ——
-- 那条立场在 G-28 上专门裁决过：**要记就先改文本，顺序不能反**。
-- ⚠️ 与 `surface` 同一件事的另一半记在 G-28：法务改了文本之后才轮到加列。
--
-- ## 🔴 `kind` 今天只有一个值：`legal_set`
--
-- 草稿的词表是 `terms` / `privacy` / `auto_renew` / `e2ee_risk` / `age_declaration`，
-- 它假设的是**逐项独立勾选**的界面。今天的界面不是那样：注册时一个勾覆盖整套文本
-- （`web.auth.terms.label` 逐字："我同意该服务端提供的服务条款与隐私政策"），
-- 钉住的值是 `legalSetVersion()` 那种**整套**指纹。
-- 把一次勾选拆成 `terms` 与 `privacy` 两行 = **发明**两个用户并没有分别作出的决定
--（与"不得替用户预勾或发明同意"是同一条纪律）。
-- ⇒ 加新 `kind` 的前提是界面上先有那个独立的勾，不是反过来。
--
-- ## 为什么存量行一律没有（这条迁移不回填任何东西）
--
-- 建表是**纯可加性**的：新表、零行。给老账号造历史行就是发明同意 ——
-- 与上一笔迁移"可空、不回填"是同一条立场（AGENTS.md §3.3）。
-- 老账号的"最后同意的哪一版"仍在 `users.terms_document_version` 那一列上，
-- 读取层在它**没有任何历史行**时退回那一列（裁决者是谁写在 schema 的注释里）。
--
-- ## 为什么是普通 DDL
--
-- 按 AGENTS.md §4 与 server/prisma/migrations/README.md 的优先级 1：新建空表 + 两条索引
--（其中一条 UNIQUE）都是普通 `CREATE`，没有 `CONCURRENTLY`，也不需要
-- `SET LOCAL lock_timeout` 那个限时形状 —— 这张表不在任何既有热查询的扫描路径上。
--
-- ## 外键
--
-- `user_id → users.id ON DELETE CASCADE`：注销账号时历史行随账号一起消失，与库内
-- 另外 11 张带 `user_id` 的子表同一形状。⚠️ 这条**不是**"删除权已落实"的证据 ——
-- 备份副本里的存留另有一节（`privacy.ts` 的"14 天内备份"那句，D-08 管它）。
--
-- SQL 由
--   npx prisma migrate diff --from-schema-datamodel <迁移前> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- 逐字取出（保证与 schema.prisma 不发生漂移）。
--
-- ## 回滚
--
-- `DROP TABLE "user_consents";` —— 无损（历史退回"只有一列指针"那个状态）。
-- 但不要把它做成迁移文件：迁移是不可逆层，回滚要另开一次有意识的变更。

-- CreateTable
CREATE TABLE "user_consents" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "document_version" TEXT NOT NULL,
    "accepted_at" BIGINT NOT NULL,
    "server_received_at" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_consents_user_id_accepted_at_idx" ON "user_consents"("user_id", "accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_consents_user_id_kind_document_version_key" ON "user_consents"("user_id", "kind", "document_version");

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
