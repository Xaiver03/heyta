-- 托管 AI 的用量计数器：一行 = 一个账号在一个**计费周期**里用掉几次。
--
-- 依据：docs/adr/0054-managed-ai-retention-and-selling-preconditions.md §2（保留裁决）、
--       docs/adr/0023-managed-ai-quota-not-implemented.md §5 第 3 条（最小清单里的"计量"），
--       额度数字的唯一事实源是 docs/reference/pricing-and-entitlements.md §2.1 的
--       ```json ai-quota-ssot``` 块。本文件**不出现那个数字**：它一旦在这里出现第二次，
--       改额度就多了两处要同步的副本，而门禁只读那五处文案（scripts/check-ai-quota-consistency.mjs）。
--       代码侧那份常量在 `server/src/ai/metering.ts`，它由 pglite 那条判据与 SSOT 块对账。
--
-- 顺序说明：这张表是 ADR-0054 §6 那条"前置顺序"的第 1 步。它存在**不等于**
-- `hosted-ai-monthly` 可以卖 —— 售卖要等 `ai-quota-ssot.enforcement` 翻到 `enforced`
-- 且 `server/src/ai/metering.ts` 在场（同一道门禁的 §3/§3b）。本迁移不动那份状态。
--
-- ## 🔴 这张表的**列集合本身**就是对外承诺（ADR-0054 §2）
--
-- 只有四列：`user_id`、`period_anchor`、`requests`、`updated_at`。
-- **没有 `prompt` 列、没有 `completion` 列、没有 `payload` 列、也没有一个 `Json` 兜底列。**
-- 这不是"以后再加"，是**故意装不下**：
--
-- | 加一列 | 三个月后的真实形态 |
-- |---|---|
-- | `payload Json` | 某次"顺手把请求存一下便于排障"之后，它成了事实上的内容仓库 |
-- | `last_prompt TEXT` | 同上，而且更糟 —— 排障时第一个被想到的就是它 |
-- | `model TEXT` / `tokens INT` | 看着无害，但它把"只留计数"变成"留什么由写代码的人临场决定" |
--
-- 到那时，隐私政策与《AI 服务条款》§5.3 里"服务端不保留内容"那几句**全都成了假话**，
-- 而**没有任何一层会报错** —— 表结构可以承载它，代码就会用它。
-- 判据在 `server/tests/ai-metering.pglite.spec.ts`：它断言列集合**等于**上面那四个
-- （多一列就红），而**不是**断言"没有内容列" —— 后者要靠人记得列出一份黑名单，
-- 而黑名单永远漏掉下一个想加的名字。
--
-- ## 为什么 `period_anchor` 是**计费周期**，不是自然月
--
-- 一次付款买的是 **30 天**（`packages/domain` 的 `SUBSCRIPTION_PERIOD_DAYS`），
-- 起点是支付成功那一刻，**不是每月的 1 号** —— 微信那侧没有订阅对象，到期时刻由我们
-- 自己记在 `subscriptions.current_period_end`（见 `billing/apply-event.ts`）。
-- 所以"本周期已用几次 / 上限"里的"本周期"只能是那一行给的边界：
--
-- | 锚点取成 | 后果 |
-- |---|---|
-- | 自然月（`2026-10`） | 9 月 20 日付的钱，到 10 月 1 日额度**清零重来** —— 一次付款（30 天）却拿到两轮额度 |
-- | 墙上时钟 + 30 天（服务端自己算） | 与库里已有的权威边界**各说各话**；改期、退款、邀请赠送之后两边对不上 |
-- | `current_period_end`（本表采用） | 周期边界只有一个出处；跨过边界自然落到**另一行**，新的一轮从 0 开始 |
--
-- ⚠️ 提前续费会把 `current_period_end` 往后推（`max(now, 已有到期日) + 30 天`），
-- 于是计数器换到新锚、从 0 起。那个方向是**多给一轮**，而多给一轮的前提是用户
-- **又付了一次 ¥12** —— 与"一个计费周期一整轮额度"一致，不是超额。
-- 反方向（续费后立刻被算成超额）才是会挨投诉的那种错。
--
-- ## 为什么 `requests` 是一个普通整数，而不是 `Json`
--
-- 这一列要回答的问题只有一个："**用了几次**"。它是**单调递增的标量**，
-- 而标量要能在裁决那一条语句里被读、被比、被 +1 ——
-- `UPDATE … SET requests = requests + 1 WHERE requests < N` 依赖的是 `INTEGER` 上的
-- 算术与比较。`Json` 三条都给不了：
--
-- | 需要的性质 | `INTEGER` | `Json` |
-- |---|---|---|
-- | 原子 +1（同一条语句里读+判+写） | ✅ | ❌ 要 `jsonb_set` + 逐键 cast，且**没有**类型保证 |
-- | `CHECK (requests >= 0)` | ✅ | ❌ 负数/字符串/对象都塞得进同一列 |
-- | 与额度常量比较并守住并发 | ✅ 行锁 + `WHERE` | ❌ 只能读出来在 JS 里比，那就是 check-then-increment |
--
-- 一旦给它开 `Json`，下一个人就会往里塞 `{prompt: …}` 来"排障"——上面那节说的
-- 那次事故**正是**从这里开始的。所以这列是 `INTEGER`，并且带一条库层 CHECK。
--
-- ## 为什么是普通 DDL（不带 CONCURRENTLY、不限时锁）
--
-- 按 server/prisma/migrations/README.md 优先级 1：新建一张表 + 它自己的唯一索引。
-- `CREATE TABLE` 取 `AccessExclusive`，但作用在**新对象**上 —— 没有存量读写会被排在
-- 后面（那才是 `SET LOCAL lock_timeout` 那个形状要防的事）。
-- 量级也要算一遍：行数 = 付费账号数 × **已走过的周期数**，每行只有四个定长列，
-- 一次 +1 只碰一行 —— 这张表**永远**不需要并发建索引。
-- 而唯一的读路径就是"按账号 + 当期取那一行"，它已经被上面那条唯一索引覆盖，
-- 所以这里连一条额外的 `CREATE INDEX` 都不需要（多加一棵树只会让每次 +1 更贵）。
--
-- ## SQL 的来源
--
-- 三段（`CreateTable` / `CreateIndex` / `AddForeignKey`）由
--   npx prisma migrate diff \
--     --from-schema-datamodel <本笔迁移之前的 schema> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- 逐字取出（保证与 `schema.prisma` 不发生漂移；Prisma 把 `@@unique` 出成
-- `CREATE UNIQUE INDEX` 而不是表内 `UNIQUE`，这里照抄它的形状，不自己换成约束形式 ——
-- 换了就等于第二份真相，下一次 diff 会报出"漂移"而没人知道是谁改的）；
-- 中间插进去的那条 CHECK 是**手工补充**，`schema.prisma` 表达不了它 ——
-- 少了它会怎样写在那条语句上面。
--
-- ## 回滚
--
-- `DROP TABLE "ai_usage_counters";` —— 无损：这张表今天之前不存在，没有存量数据会跟着丢，
-- 而它装的也不是用户内容，是我们自己记的计数。
-- 但不要把它做成迁移文件：迁移是不可逆层，回滚要另开一次有意识的变更。

-- CreateTable
CREATE TABLE "ai_usage_counters" (
    "user_id" INTEGER NOT NULL,
    "period_anchor" BIGINT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "updated_at" BIGINT NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_counters_user_id_period_anchor_key" ON "ai_usage_counters"("user_id", "period_anchor");

-- 🔴 手工补充 1/2：计数不许是负数。
--
-- `metering.ts` 只做 +1，看起来写不进负数。但这张表还有一条**不是应用路径**的写入口：
-- 运维脚本、未来的重置迁移、以及"把某账号的额度手动调回去"这类操作。少了这条 CHECK，
-- 一行 `requests = -1` 会让该周期的额度**多出一次**，而 `到点即停` 那句对外承诺
-- （《AI 服务条款》§5.3）在这一行上变成假话 —— 界面显示"已用满"，
-- 库里其实还留着余量，两边都"看起来正常"。
-- 与 `holiday_adjustment_*` 那两条同口径：**库层是最后一道防线，不是重复劳动。**
ALTER TABLE "ai_usage_counters" ADD CONSTRAINT "ai_usage_counters_requests_non_negative"
  CHECK ("requests" >= 0);

-- 🔴 手工补充 2/2：这一行**必须**属于一个真实账号，且账号删掉时它跟着删。
--
-- 级联不是整洁问题，是保留承诺的一半：ADR-0054 §2 那句"计数随账号级联删除"、
-- 《个人信息清单》《数据权利》里"删账号即删"的既有口径，全部由这一条外键兑现。
-- 少了它，删掉的账号会留下一堆**指向不存在的 user_id** 的计数行 ——
-- 它们永远不会被任何界面读到，也永远不会被任何清理任务清掉（没有任何一层知道该删谁），
-- 于是"删账号即删"在库外那份表述里成立、在库里留下残渣。
-- `ON DELETE CASCADE` 之外还钉 `ON UPDATE CASCADE`：`users.id` 今天没有更新路径，
-- 但"没有"不等于"不许"，一个悬空的整数外键是这里最难查的一种残留。
ALTER TABLE "ai_usage_counters" ADD CONSTRAINT "ai_usage_counters_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
