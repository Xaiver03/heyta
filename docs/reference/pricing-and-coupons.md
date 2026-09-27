# 价格与优惠券的工程参考

> 决策与理由见 [ADR-0018](../adr/0018-adjustable-pricing-and-coupons.md)（价格可调 + 券域模型）
> 与 [ADR-0017](../adr/0017-single-paid-tier-and-payment-channel.md)（唯一付费档、¥99/$49、自建免费）。
>
> 本文描述**代码现在长什么样**。与 ADR 冲突时以 ADR 为准。
> 价格本身不住在这里 —— 它住在 §1.1 说的那个唯一事实源。

---

## 1. 事实源：谁住在哪

### 1.1 价格的唯一事实源

| 层 | 位置 | 谁读它 | 能不能改 |
|---|---|---|---|
| **代码基线** | `server/src/billing/price-book.ts` 的 `DEFAULT_PRICE_BOOK` | 新装实例、测试、CI、以及数据库里没有任何覆盖版本时的报价 | 改代码（一次 code review） |
| **运行期版本** | `price_versions` 表（append-only） | 官方托管实例的生产报价 | 走 `publishPriceVersion`，不用发版 |
| **机器可读的对外价格块** | [`pricing-and-entitlements.md`](pricing-and-entitlements.md) 的 ```json pricing-ssot 块 | `scripts/check-pricing-consistency.mjs` | 与上面两层同步改 |

🔴 **`server/src/billing/wechat.adapter.ts` 里的 `WECHAT_DEFAULT_PRICES` 不再是事实源。**
它是 `projectPrices(DEFAULT_PRICE_BOOK, 'CNY', 0)` 的投影。门禁里有一条
"adapter 里不许出现 `totalFen: <数字>`"，就是为了防止这个数字被抄回去 ——
抄回去之后，抄来的那份**不会跟着改价动**，而没有任何东西会发现。

### 1.2 覆盖版本与基线的裁决规则（**必须记住这一条**）

```
数据库里对 (priceId, currency) 有版本吗？
├── 没有 → 只在基线里找 → 找到用它；找不到抛 UnknownPriceError
└── 有   → 只在覆盖里找 → 找到用它；找不到抛 PriceNotEffectiveError
                        ↑ 🔴 绝不回落到基线
```

"绝不回落"是刻意的。回落的后果不是报错，而是**安静地按旧价收款**。
宁可让一次写坏的改价当场把收银台弄挂（5 分钟内就会被发现），
也不要它安静地错一整周。实现在 `resolveEffectivePrice`。

---

## 2. 模块地图

| 文件 | 层 | 内容 | 有测试吗 |
|---|---|---|---|
| `server/src/billing/money.ts` | 纯 | 整数分币算术、基点、折扣计算、金额拆解、`formatMinor` | ✅ `billing-money.spec.ts` |
| `server/src/billing/price-book.ts` | 纯 | 版本化价目表、生效区间、重叠校验、`resolveEffectivePrice`、`projectPrices` | ✅ `billing-coupon.spec.ts` |
| `server/src/billing/coupon.ts` | 纯 | 券定义、定义校验、判定（13 个拒绝原因）、码归一化 | ✅ `billing-coupon.spec.ts` |
| `server/src/billing/quote.ts` | 纯 | 计价编排：解析价格 → 选券 → 冻结成 `OrderQuote` | ✅ `billing-coupon.spec.ts` |
| `server/src/billing/pricing-store.ts` | IO（`SqlExecutor` 端口） | 读写价目表/券/订单/核销；`publishPriceVersion`、`createOrderWithReservation`、`settleOrderPaid`、`expireStaleOrders`、`reverseOrderOnRefund`；Prisma 适配器 | ✅ `billing-pricing-store.pglite.spec.ts`（真 PostgreSQL） |
| `server/prisma/schema.prisma` | — | 5 个新模型（见 §4） | ✅ `billing-pricing-schema.pglite.spec.ts` |
| `server/prisma/migrations/20260928000000_add_pricing_and_coupons/` | — | 生成的 DDL + 手工追加的 CHECK 约束 | ✅ 同上（32 例） |

🔴 **IO 走 `SqlExecutor` 端口而不是直接 `import { prisma }`**，理由只有一个：
**CI 没有 PostgreSQL**。直接接线的话，"并发核销会不会超发"就只能靠读代码相信。
有了端口，同一份 SQL 在 PGlite（**是真的 PostgreSQL**）上被真跑一遍。
剩下没被覆盖的只有"Prisma 参数绑定"那层薄胶水 —— 见 §7。

---

## 3. 全部具名常量与数值

| 常量 | 值 | 位置 | 含义 |
|---|---|---|---|
| `CURRENCIES` | `['CNY','USD']` | `money.ts` | 只有这两种钱 |
| `MINOR_UNITS_PER_MAJOR` | `100` | `money.ts` | 1 元 = 100 分；1 美元 = 100 美分 |
| `PERCENT_SCALE` | `10_000` | `money.ts` | 百分比用**基点**。`1500` = 15% |
| `PERCENT_OFF_BP_MAX` | `10_000` | `money.ts` | 100%。等于它就等于免费 |
| `MIN_CHARGEABLE_AMOUNT_MINOR` | `1` | `money.ts` | 0 元单**不可支付** |
| `DEFAULT_PRICE_BOOK` | CNY `9_900` / USD `4_900`，`effectiveFrom: 0`、`effectiveUntil: null` | `price-book.ts` | 代码基线 |
| `REGIONS` | `['CN','INTL']` | `coupon.ts` | 区域，**与币种是独立的两根轴** |
| `COUPON_REJECTION_REASONS` | 13 个（见 §3.1） | `coupon.ts` | 券被拒的全部原因 |
| `MAX_COUPONS_PER_ORDER` | `1` | `quote.ts` | 一单一张。**改了它就抛异常**（叠加语义未实现） |
| `DEFAULT_PAYMENT_WINDOW_MS` | `7_200_000`（2 小时） | `quote.ts` | 报价有效期，对齐微信 Native 订单过期 |
| `ORDER_STATUSES` | `pending` / `paid` / `failed` / `expired` / `refunded` | `pricing-store.ts` | 与 `checkout_orders_status_known` CHECK 一致 |
| `REDEMPTION_STATES` | `reserved` / `applied` / `expired` / `reversed` | `pricing-store.ts` | 与 `coupon_redemptions_state_known` CHECK 一致 |
| `COUNTED_REDEMPTION_STATES` | `reserved` / `applied` / `reversed` | `pricing-store.ts` | 🔴 名额口径的**唯一定义处**。`expired` **不在**里面 |
| `AUDIT_ACTIONS` | `price_published` / `coupon_upserted` / `coupon_toggled` | `pricing-store.ts` | 审计动作词表 |
| `WECHAT_ONE_TIME_PERIOD_DAYS` | `365` | `wechat.adapter.ts` | 一次性支付授予的权益天数（与价格无关） |

### 3.1 13 个拒绝原因与判定顺序

顺序**本身就是规格**，实现按这个顺序短路：

```
1  unknown_coupon                    ← 编排层产生（码查不到）
2  stacking_not_allowed              ← 编排层产生（已有别的券生效）
3  disabled
4  not_started
5  expired
6  currency_mismatch
7  region_mismatch
8  price_not_applicable
9  order_below_minimum
10 first_purchase_only
11 total_redemption_limit_reached
12 user_redemption_limit_reached
13 not_chargeable_after_discount     ← 🔴 必须是最后一条
```

`unknown_coupon` 与 `stacking_not_allowed` 只有编排层（`quote.ts`）能产生，
所以 `coupon.ts` 用 `Exclude<...>` 把它们从自己的联合类型里排掉 ——
类型系统替我们记住了"这两个不属于这里"。

第 13 条必须最后：它是**唯一**一条需要先算出折扣才能判的规则。提前会让
"这张券用不了"与"这一单收不了钱"混成一个原因，而两者的处置完全不同
（前者让用户换张券，后者是配置错误，得人来改）。

`COUPON_REJECTION_EXPLANATION` 是 `Record<CouponRejectionReason, string>`：
新增一个原因而忘了写人话解释就**编译不过**。

---

## 4. 数据模型

### 4.1 五张表

| 表 | 作用 | 关键约束 |
|---|---|---|
| `price_versions` | 价格版本（append-only） | `amount_minor > 0`；币种 ∈ {CNY,USD}；`effective_until IS NULL OR effective_until > effective_from` |
| `pricing_audit_log` | 改价/发券审计（append-only，**没有 UPDATE/DELETE**） | `action` 在词表内 |
| `coupons` | 券定义 | 判别联合 XOR：`kind='percent'` ⇔ `percent_off_bp` 非空且 ∈ (0, 10000) 且 `amount_off_minor` 为空；`kind='fixed'` 反之。`code = btrim(upper(code))`；限额 > 0；`applies_to_all_*` 与数组列的在场性一致 |
| `checkout_orders` | **订单 = 冻结的报价快照** | `original > 0 AND discount >= 0 AND discount <= original AND final = original − discount AND final > 0`；币种/区域/状态在词表内；`status='paid'` ⇒ `paid_at` 非空；`out_trade_no` 唯一 |
| `coupon_redemptions` | 核销事实 | `order_id` **唯一**（第二道防重复授予的闸）；`discount_minor > 0`；`state='applied'` ⇒ `applied_at` 非空 |

⚠️ **为什么金额三列都存**：微信账单里 `应结订单金额 = 订单金额 − 免充值券金额`
—— 有券的单，结算金额 ≠ 订单金额。三列都在并且有 CHECK 保证
`final = original − discount`，对账时不用反推。

⚠️ **`couponId` 外键是 `onDelete: Restrict`**：历史订单永远不能因为"这张券被删了"
而丢掉它的券。券只能停用（`enabled = false`），不能删。

### 4.2 订单状态机

```
                    ┌──────────── expireStaleOrders ────────────┐
                    ▼                                           │
  (quote) ── createOrderWithReservation ──► pending ── settleOrderPaid ──► paid ── reverseOrderOnRefund ──► refunded
                                              │
                                              └── failOrder ──► failed
```

- `settleOrderPaid` 是**唯一**允许把订单推进到 `paid` 的路径，且是幂等的：
  已经是 `paid` 就返回 `already-paid`，**连 `paid_at` 都不改**。
- 允许 `pending` **与** `expired` → `paid`（到账晚于过期，见 §4.4）。
- `failed` / `refunded` → **不授予**。

### 4.3 金额校验跟谁比

**跟订单上冻结的 `final_amount_minor` 比，不跟价目表比。**

旧实现（ADR-0017 §3.2）是"金额是价目表里的某一个"。那在有券之后同时错两个方向：
付了 ¥99 的人能白拿 ¥20 的折扣（¥99 在价目表上）；而真的付了 ¥79 的人
**被拒绝授予**（¥79 不在价目表上）。

### 4.4 名额口径（`COUNTED_REDEMPTION_STATES`）

| 状态 | 占用名额 | 为什么 |
|---|---|---|
| `reserved` | ✅ | 不占的话刷预留就能把限量券占满 |
| `applied` | ✅ | 已用掉 |
| `reversed` | ✅ | 退款**不归还**：否则"买 → 退 → 再买"能反复薅同一份预算 |
| `expired` | ❌ | **必须**不占，否则限 100 张的券被 100 个"点了没付"的单永久占满 |

🔴 由此产生一个**有意的、有界的不一致**：支付晚于订单过期才到 → 名额可能已被
别人拿走 → 最多超发 1 次。方向是故意的：**宁可多给一个人权益，也不能因为
"名额没了"吞掉一笔真实到账的钱。** 但 `settleOrderPaid` 会返回
`afterExpiry` / `quotaExceeded`，调用方**必须**把它当告警。

### 4.5 并发核销

```
BEGIN
  SELECT max_redemptions, max_redemptions_per_user FROM coupons WHERE id = $1 FOR UPDATE
  SELECT count(*) FROM coupon_redemptions WHERE coupon_id = $1 AND state IN (...)
  INSERT INTO checkout_orders ...
  INSERT INTO coupon_redemptions ...   -- order_id 唯一，第二道闸
COMMIT
```

- **不是**"先 count 再 insert"：那是竞态的经典形状。
- 锁的粒度是**一张券**，不是全表。改价/发券是人工低频操作，而这里串行化的是
  同一张券的并发核销，代价可以忽略。
- 策略**由报价决定"给他看什么价"，由这次事务决定"这名额到底给不给他"**。
  报价读到的用量是一个快照，两份报价都可能在同一个"用量 = 0"上算出来 ——
  那不是 bug，是报价的固有限制。准入必须在写入的这一刻、在锁的保护下重做。
- 测试里能**精确重放**这个并发（PGlite 单连接跑不出真交错）：
  先算两份报价，再先后预留 → 第二份抛 `CouponQuotaExceededError`。

---

## 5. 运维要求

### 5.1 🔴 sweep 必须真的在跑

```ts
expireStaleOrders(sql, { now })
// → 未支付且已过期的订单 → 'expired'；其预留 → 'expired'（名额被放出来）
```

**这不是优化，是 `maxRedemptions` 语义的组成部分。** 没有它，任何人只要点开
收银台拿到收款码就能把名额占住（`reserved` 是计数的），直到 2 小时后订单过期
—— 而"过期"这件事**必须有人去写**。

监控口径：看"**任务有没有跑**"，不要看"扫掉了几行"。扫掉 0 行可能是没人下单，
也可能正是 sweep 挂了 —— 这两个状态用这个指标分不开。

两条 UPDATE 都是幂等的（条件里带状态），重复跑没有副作用。

### 5.2 其他

- 券只能**停用**（`enabled = false`），不能删（`onDelete: Restrict` 会挡）。
- 改价是 append：旧版本行**永不删除**，否则历史订单的金额就解释不了了。
- 审计是 append-only：`pricing_audit_log` 上没有任何 UPDATE/DELETE。

---

## 6. 运营怎么做（改价 / 发券）

改价与发券都是**服务端操作**，不进 `CURRENT_SCHEMA_VERSION`、不进 op-log 线协议
（那五个表是纯服务端表）。操作通过 `pricing-store.ts` 的三个写入口：

| 操作 | 入口 | 关键要求 |
|---|---|---|
| 改价 | `publishPriceVersion` | `effectiveFrom` 必须**严格晚于**被它结束的那一版的起点，否则抛 `PriceVersionConflictError`（两版重叠会让报价变成未定义） |
| 发券 / 改券 | `upsertCoupon` | 定义不合法就抛 `CouponDefinitionRejectedError`（**返回全部问题**，一次改完） |
| 停券 | `upsertCoupon`（`enabled: false`） | 不删行 |

三者都在一个事务里写审计行。

⚠️ **改价的生效时刻是运维责任**：把 `effectiveFrom` 设成"现在"意味着
正在报价的人可能拿到旧价（报价是几十毫秒前的快照，这是对的）。想无缝切换要选
一个未来的时刻。

---

## 7. 未验证项与已知缺口（不假装它们被测过）

1. **行锁的阻塞行为没有被本仓库实测过。** PGlite 是单连接，两个 `BEGIN`
   无法并存，所以"两个并发预留抢最后一张券"跑不出真交错。我们有的证据是
   （a）顺序语义：用满之后下一次预留真的抛错；（b）机制形状：一条记录语句顺序的
   测试断言"锁券行 → 数名额 → 插入"在同一事务里按这个顺序发生。
   **PostgreSQL 的行锁会阻塞并发写者是其文档保证的行为，但未在本仓库验证。**
   验证方式：对一个真 PostgreSQL 跑两个并发事务（`server/package.json` 的
   `test:integration:postgres` 那条链路），断言其中一个阻塞到另一个提交。
2. **Prisma 的参数绑定层未被测试覆盖。** `createPrismaSqlExecutor` 只做三件事：
   转发参数、包 `$transaction`、把非数组返回值兜成 `[]`。所有 SQL 文本本身在
   PGlite 上跑过，但"Prisma 会不会把 `number` 正确绑到 `BIGINT`、把 JS 数组
   绑到 `text[]`"没有被自动化验证。验证方式：在真库上跑一遍
   `billing-pricing-store.pglite.spec.ts` 的同名用例（把那套 executor 换成 Prisma 版）。
   ⚠️ 这个缺口是**有意的取舍**：把 Prisma 的 `$queryRawUnsafe` 包成一个可注入的
   端口，换来的是"全部 SQL 在真 PostgreSQL 上被跑过"。
3. ~~`check:pricing` 还没接进 `pnpm check`。~~ **已接入（提交 `e63b100`）。**
   `package.json` 现在有 `check:pricing`，`check` 链路在 `check:docs` 之后调它。
   提交时 `package.json` 是用 `git show HEAD:package.json` 做基底、**只**叠加这一处的 ——
   工作树里当时还带着另外两条工作流未提交的改动（`check:mobile-bundle`、
   `check:materialized-reads`、harmony 系列 `verify:*`），不为别人提交他们没验证过的东西。

   实测：`pnpm check:pricing` → exit 0；`pnpm check` 全链路 → exit 0。
   **注入探针**：把 `server/src/billing/price-book.ts` 的 `amountMinor: 9_900`
   手改成 `9_800` → 门禁 exit 1，并指名两个不一致的文件与两个数字；改回后 exit 0。
   门禁不是空转的。

   `verify-i18n-failures.mjs` 的 `pricing` / `coupon` 两组是它的**故障注入**验证，
   已注册成 `pnpm verify:i18n-failures`（实测 85 例全部符合预期，其中 `pricing` 10 例、
   `coupon` 9 例：每个 mutant 都让对应检查变红）。它耗时较长，**有意不**放进
   `pnpm check`，留给 CI 的独立作业。
4. **发票金额口径未与会计确认。** 有券的单，"开票金额"取 `final`（实付）
   是我们的常识判断，**未经会计确认**。
5. **支付通道未接线。** 下单 / 回调 / 退款的实际接线仍是 ADR-0017 §5 的状态。
   `reverseOrderOnRefund` 里的"退款"是**退款被确认之后的状态同步**，不是退款本身。
6. **微信是否接受 ¥0 订单未核实。** 我们的设计里 0 元单在建单之前就被拒
   （`MIN_CHARGEABLE_AMOUNT_MINOR`），所以这一点不影响正确性；但它意味着
   "用 ¥0 单测试回调链路"这条路走不通。
7. **微信商家券 / 支付宝商家券的能力仍在灰度或受资质限制**（见 ADR-0018 §2.3）。
   本轮不接，表结构留了 `provider` / `out_trade_no` / `provider_event_id`。
8. **没有运营用的 CLI。** §6 的三个写入口是**库函数**（`publishPriceVersion` /
   `upsertCoupon`），还没有 `server/scripts/` 的命令行包装。之所以先不加：
   支付通道未接线，命令**无法端到端验证**，而一个"能运行但没人能证明它对"的
   运维脚本比没有它更危险（它会被人当成可靠的工具用）。
   要加的时候，形状是 `server/scripts/pricing.ts show|set-price|coupon-upsert`
   包一层参数解析，并把参数解析单独做成可测的纯函数。
   ⚠️ `server/tsconfig.json` 的 `include` 覆盖 `scripts/**`、`rootDir: "."`，
   所以脚本会编译到 `dist/scripts/`。

---

## 8. 对应的门禁与验证

| 检查 | 命令 | 覆盖 |
|---|---|---|
| 价格一致性 | `node scripts/check-pricing-consistency.mjs` | 基线价目表 ↔ 中英词条 ↔ 法务文本 ↔ `pricing-ssot` 块；一档到底；**adapter 里不许有第二个数字** |
| 迁移纪律 | `node scripts/check-migrations.mjs` | 迁移文件命名/语句数/禁用语句 |
| 券与价格的故障注入 | `node scripts/verify-i18n-failures.mjs pricing` / `… coupon` | 10 + 9 例：每一处"改坏"都必须让对应的检查变红 |
| 单元与集成 | `cd server && npx vitest run tests/billing-*.spec.ts` | 见 §2 的"有测试吗"一列 |
