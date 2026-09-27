-- 订阅行记住「买的是哪一档」：`subscriptions.price_id` + `subscriptions.grants`。
--
-- 依据：docs/adr/0018-adjustable-pricing-and-coupons.md、
-- docs/reference/pricing-and-entitlements.md 的 `pricing-ssot` 块。
--
-- 🔴 这一迁移修的是一类**静默发错货**：在此之前 `Subscription` 只有
-- "有没有一条活跃订阅"这一维，于是 ¥5 与 ¥12 落成同一行 —— 用户付 ¥12
-- 拿到的和 ¥5 完全一样，而没有任何代码能发现自己发错了。
--
-- 为什么是普通 DDL：只给一张小表加两列，且 `grants` 带默认值
-- （AGENTS.md §4 优先级 1：表够小就用普通 DDL，不引入 CONCURRENTLY 与恢复路径）。
-- 新列都符合 AGENTS.md §3.3：`price_id` 可空、`grants` 带默认值。
--
-- SQL 主体由
--   prisma migrate diff --from-schema-datamodel <旧> --to-schema-datamodel schema.prisma
-- 生成，保证与 schema.prisma 不发生漂移；其后的两条是**手工补充**，
-- 因为 Prisma schema 表达不了它们。

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "grants" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "price_id" TEXT;

-- 🔴 手工补充 1/2：`grants` 必须 NOT NULL。
--
-- `prisma migrate diff` 生成的是**可空**的 `TEXT[]`，而 Prisma 客户端把
-- `String[]` 一律当非空数组（空就是 `[]`）。两者不一致的后果很具体：
-- 库里能存在一行 `grants IS NULL`，而没有任何 TypeScript 代码能读到它 ——
-- "空数组 = 没有任何能力"这条 fail-closed 语义在那一行上**失效**，
-- 判定分支拿到的会是 `undefined`（不匹配任何能力，看起来像"没有能力"，
-- 但它是靠类型撒谎实现的，不是靠语义）。
-- NOT NULL 让库里只有一种"空"，与客户端类型对齐。
ALTER TABLE "subscriptions" ALTER COLUMN "grants" SET NOT NULL;

-- 🔴 手工补充 2/2：能力词表。`grants` 的取值只能是 `hosting` / `ai`。
--
-- 与 `scripts/check-pricing-consistency.mjs` 的 `ALLOWED_GRANTS`
-- 和 `pricing-ssot` 块同源。代价是"新增第三种能力"要同时改这一迁移之外的地方 ——
-- 这是**故意**的：能力词表是权益判定的基础，拼错一个字母（`aI` / `A1`）
-- 会让判定静默拒绝一个已经付过钱的用户，而那是最难查的一类故障。
-- 词表只写在 TypeScript 里，等于把最后一道防线放在最容易被绕过的那一层。
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_grants_known"
  CHECK ("grants" <@ ARRAY['hosting','ai']::TEXT[]);

-- 🔴 手工补充 3/3：回填既有行 —— **不回填就是一个静默的断服**。
--
-- 老代码里"有任何一条订阅行"就等于"有 hosting"（`entitlement.ts` 只有这一维），
-- 而 ¥12 / `ai` 这一档**从未上线过**（没有收银台能卖出它）。所以既有每一行的
-- 正确能力投影**唯一可能就是** `ARRAY['hosting']`。
--
-- 不回填的后果：这些行拿到默认值 `ARRAY[]::TEXT[]`，而判定是 fail-closed 的
-- —— 开关一打开，**每一个已经付过钱的用户会被当场拒绝**，且拒绝原因看起来
-- 像"权益已过期"，与真实原因（我们没回填）毫无关系。
-- 回填对所有状态的行都做：老语义下"是否放行"由 `status` + 到期日决定，
-- 能力集合对它没有影响，所以全量回填与老行为逐字等价。
UPDATE "subscriptions" SET "grants" = ARRAY['hosting']::TEXT[];

-- 注：`price_id` **刻意不回填**。它记的是"买的是哪一档"，而老行里没有这个信息
-- —— 写一个 `'hosted-monthly'` 进去等于**编造**一条我们并不掌握的购买事实。
-- 能力集合（真正参与判定的那一维）已经正确回填，`price_id` 保持 `NULL`
-- 表示"档位未知"，这正是 §schema 注释里写的语义。
