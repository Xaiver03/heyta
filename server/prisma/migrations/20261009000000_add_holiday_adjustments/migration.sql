-- 调休/补班（公共事实）的两张表：一张年度录入、一张逐日。W4b。
--
-- 依据：docs/plans/countdown-anniversary.md §3 W4b 与 §8 的那张落地任务卡；
-- 定性（为什么服务端可以下发它、而 AGENTS §1 那句"云端不是事实源"仍然成立）在
--   docs/adr/0050-public-facts-are-deployer-supplied.md。
--
-- ## 🔴 为什么必须有一张**逐日表**，而不是一张表 + 一个 `Json` 的 `days`
--
-- 判据③要求"日期非法 / `isOffDay` 不是布尔"能**拒绝录入**。这两件事在 `Json` 列上
-- **库层一个都不拦** —— `{"day":"2026-02-30","isOffDay":1}` 是一段完全合法的 JSON，
-- Postgres 存得下去、服务端读得出来，于是校验推迟到客户端，而那两个坏值的症状是：
--
-- | 坏值 | `Json` 列 | 症状（没有任何一层报错） |
-- |---|---|---|
-- | `"2026-02-30"` | 存得下 | 那一天**永远不上界面**（谁都查不到 2 月 30 日），运营那边显示"已录入 2026" |
-- | `isOffDay: 1` | 存得下 | 被 truthy 当成"休" ⇒ 一个**补班日**在用户日历上标成放假 —— **界面在说谎** |
--
-- 所以逐日表用 `day DATE` 主键 + `is_off_day BOOLEAN NOT NULL`：
-- 非法日期在 `INSERT` 那一刻就是 `22007 date/time field value out of range`，
-- 非布尔就是 `22P02 invalid input syntax for type boolean`。
-- ⚠️ 服务端**仍然**要有一层 zod（`packages/shared-schema` 那份契约），两层不是重复：
-- 只有库 ⇒ 运营看到的是一句 500，不是"2 月 30 日不存在"；
-- 只有 zod ⇒ 迁移、CLI、运维手滑写进去的那一行没人拦。
--
-- ## `day DATE` 的一个**必须知道**的读取形状
--
-- Prisma 把 `DATE` 列读成 **UTC 零点的 `Date`**。回成字符串只能用
-- `toISOString().slice(0,10)`；用本地 getter（`@heyta/domain` 的 `toLocalDate()`）
-- 会让一个 UTC-5 的部署把 `2027-01-01` 读成 `2026-12-31`。
-- `server/src/holidays/day-column.ts` 是唯一做这件事的地方，
-- 判据钉在 `server/tests/holiday-adjustment-migration.pglite.spec.ts`。
--
-- ## 为什么是普通 DDL（不带 CONCURRENTLY、不限时锁）
--
-- 按 server/prisma/migrations/README.md 优先级 1：新建两张表 + 一个普通
-- `CREATE INDEX`。`holiday_adjustment_days` 的量级是"一年几十天 × 有记录的年份数"，
-- 永远不需要并发建索引；`CREATE TABLE` 取的是 `AccessExclusive` 但作用在**新对象**上，
-- 没有存量读写会被排在后面（那才是 `SET LOCAL lock_timeout` 那个形状要防的事）。
--
-- ## SQL 的来源
--
-- 前四段由
--   npx prisma migrate diff --from-schema-datamodel <迁移前> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- 逐字取出（保证与 schema.prisma 不发生漂移）；其后的 CHECK 是**手工补充**，
-- schema.prisma 表达不了它们 —— 每条都单独写明了"少了它会怎样"。
--
-- ## 回滚
--
-- `DROP TABLE "holiday_adjustment_days"; DROP TABLE "holiday_adjustment_years";`
-- —— 无损（这两张表今天之前不存在，没有存量数据会跟着丢；它们是公共事实，
--    删掉之后客户端退回随包表，见 domain 的 `holidayAdjustmentSource()`）。
-- 但不要把它做成迁移文件：迁移是不可逆层，回滚要另开一次有意识的变更。

-- CreateTable
CREATE TABLE "holiday_adjustment_years" (
    "year" INTEGER NOT NULL,
    "papers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "updated_at" BIGINT NOT NULL DEFAULT 0,
    "updated_by" TEXT,

    CONSTRAINT "holiday_adjustment_years_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "holiday_adjustment_days" (
    "day" DATE NOT NULL,
    "is_off_day" BOOLEAN NOT NULL,
    "year" INTEGER NOT NULL,

    CONSTRAINT "holiday_adjustment_days_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE INDEX "holiday_adjustment_days_year_idx" ON "holiday_adjustment_days"("year");

-- AddForeignKey
ALTER TABLE "holiday_adjustment_days" ADD CONSTRAINT "holiday_adjustment_days_year_fkey" FOREIGN KEY ("year") REFERENCES "holiday_adjustment_years"("year") ON DELETE CASCADE ON UPDATE CASCADE;

-- 🔴 手工补充 1/3：年份区间钉在库里。
--
-- 上界 2100 **不是**"够用了"，是历法层的硬边界：`packages/domain` 的农历月表只铺到
-- 农历 2100 年，之后的日子算不出星期几与节日。一个 2200 年的调休行会让界面在
-- 一个**没有任何一层能解释的年份**上标出"班" —— 而那一步的报错是空的。
-- 下界 2007 = 公告机器可读版的第一年（随包数据同一条）。
-- 与 `HOLIDAY_ADJUSTMENT_YEAR_MIN/MAX` 逐字同值，两端各一份的结局见 AGENTS §3.5 那条教训。
ALTER TABLE "holiday_adjustment_years" ADD CONSTRAINT "holiday_adjustment_years_year_range"
  CHECK ("year" BETWEEN 2007 AND 2100);

-- 🔴 手工补充 2/3：**没有出处的节假日数据不能进库**。
--
-- `papers` 是这条通道唯一的可举证性来源：判据②要的是"链接随数据入库且能回显"，
-- 而运营录入没有理由比自动抓取更宽松 —— 随包那份 `scripts/vendor/holiday-cn/load.mjs:52`
-- 对空 `papers` 是直接 throw 的。少了这条 CHECK，一年可以带着 `papers = '{}'` 存进去，
-- 于是界面上有一批"休/班"标注，而**没人能说出它是哪份公告说的**。
-- `'' <> ALL (papers)` 一起钉住：空字符串是一个"看起来有、其实没有"的出处。
-- 上限 32 是防"拿这个字段传别的东西"（一年最多发两三次调整通知，32 已是十几倍余量）。
--
-- ⚠️ 这里**没有**"每个元素都得是 http/https"那条：Postgres 的 CHECK 不许含子查询，
-- 逐元素校验要 `CREATE DOMAIN` 或触发器，而那两样都会让 `prisma migrate diff`
-- 与本表的结构发生漂移（Prisma 只看得见 `text[]`）。所以那条规则住在两处：
-- 契约层 `isHttpPaperUrl`（实测 `z.string().url()` **放过** `javascript:alert(1)`），
-- 以及渲染层 `AdminPanel` 的那个小部件 —— **不许**把没过滤的字符串放进 `href`。
--
-- 🔴 `coalesce` 不是防御性冗余，是这条约束**能不能成立**的分水岭：
-- `array_length('{}', 1)` 返回的是 **NULL**，而 CHECK 只在表达式为 **false** 时拒绝 ——
-- `NULL >= 1` 是 NULL，不是假。所以第一版写成 `array_length(...) >= 1` 时，
-- **空数组恰好通过**（判据③当场变成一条永远通过的判据；是 pglite 那条测出来的）。
ALTER TABLE "holiday_adjustment_years" ADD CONSTRAINT "holiday_adjustment_years_papers_present"
  CHECK (
    coalesce(array_length("papers", 1), 0) BETWEEN 1 AND 32
    AND '' <> ALL ("papers")
  );

-- 🔴 手工补充 3/3：逐日行的年份必须与那一天**属于同一年**。
--
-- `year` 是一列冗余（为了按年取的热路径与上面那条级联）。冗余列没有约束就会漂：
-- 一行 `day = 2027-01-01, year = 2026` 会让"取 2026 年的安排"里冒出 2027 元旦，
-- 客户端的整年替换语义（`installHolidayAdjustmentOverrides`）因此丢掉 2027 那一年，
-- 而两边各自的行数都对得上 —— 对账查不出来。
--
-- `EXTRACT(YEAR FROM day)` 能直接成立的前提正是"这一列是 `DATE`"，
-- 与这张表的存在理由互为证据：如果 `day` 是 `text`，这条约束就得先 cast，
-- 而 cast 失败是**报错**不是**判假**，CHECK 里那会变成一个更难解释的失败模式。
ALTER TABLE "holiday_adjustment_days" ADD CONSTRAINT "holiday_adjustment_days_year_matches_day"
  CHECK ("year" = EXTRACT(YEAR FROM "day")::int);

-- ## 有一条**没做**成库约束，写明为什么没做
--
-- "年度行存在但一条安排都没有"（`papers` 齐了、`days` 空）不该存在：它与
-- "这一年还没录入"在客户端是同一个表现（`adjustmentOn` 一律 `undefined`），
-- 而 domain 那层对两者的处置**相反**（前者是清空随包表那一年，后者是退回随包）。
--
-- 🔴 但它**表达不了**：Postgres 的 CHECK 不许含子查询，跨表计数要么用触发器，
-- 要么用可延迟约束的外键 + 一张计数表 —— 两者都远超这条约束值这个钱。
-- 所以它落在写入层：`PUT /api/admin/holiday-adjustments/years/:year` 在**一个事务里**
-- 先写年度行、再灌逐日行，任何一步失败整体回滚 ⇒ 库里不可能出现空的一年。
-- 判据钉在 `server/tests/holiday-admin-routes.spec.ts`（"部分失败不留半成品"那条）。
