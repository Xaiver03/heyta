# 价格与优惠券的工程参考

> 决策与理由见 [ADR-0018](../adr/0018-adjustable-pricing-and-coupons.md)（价格可调 + 券域模型）
> 与 [ADR-0020](../adr/0020-ai-subscription-two-tiers.md)（**恰好两个付费项、都月付**：
> `hosted-monthly` ¥5/$5、`hosted-ai-monthly` ¥12/$12；一次支付授予 **30 天**；自建永久免费）。
>
> 🔴 价格与周期以 **ADR-0020** 为准 —— 它**取代了
> [ADR-0017](../adr/0017-single-paid-tier-and-payment-channel.md) 的价格与周期结论**：
> `annual` 唯一付费档、`¥99 / 年`、`$49 / 年`、一次支付授予 365 天 —— **全部作废**
> （0017 的「自建永久免费」「不自动续费」两条保留）。
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
| `DEFAULT_PRICE_BOOK` | **4 条** = 两个 SKU × 两种币种，全部 `effectiveFrom: 0`、`effectiveUntil: null`：`hosted-monthly` CNY/USD 各 `500`（¥5/$5）、`hosted-ai-monthly` CNY/USD 各 `1_200`（¥12/$12） | `price-book.ts` | 代码基线（ADR-0020。旧的单档 `annual` `9_900`/`4_900` 已作废） |
| `REGIONS` | `['CN','INTL']` | `coupon.ts` | 区域，**与币种是独立的两根轴** |
| `COUPON_REJECTION_REASONS` | 13 个（见 §3.1） | `coupon.ts` | 券被拒的全部原因 |
| `MAX_COUPONS_PER_ORDER` | `1` | `quote.ts` | 一单一张。**改了它就抛异常**（叠加语义未实现） |
| `DEFAULT_PAYMENT_WINDOW_MS` | `7_200_000`（2 小时） | `quote.ts` | 报价有效期，对齐微信 Native 订单过期 |
| `ORDER_STATUSES` | `pending` / `paid` / `failed` / `expired` / `refunded` | `pricing-store.ts` | 与 `checkout_orders_status_known` CHECK 一致 |
| `REDEMPTION_STATES` | `reserved` / `applied` / `expired` / `reversed` | `pricing-store.ts` | 与 `coupon_redemptions_state_known` CHECK 一致 |
| `COUNTED_REDEMPTION_STATES` | `reserved` / `applied` / `reversed` | `pricing-store.ts` | 🔴 名额口径的**唯一定义处**。`expired` **不在**里面 |
| `AUDIT_ACTIONS` | `price_published` / `coupon_upserted` / `coupon_toggled` | `pricing-store.ts` | 审计动作词表 |
| `WECHAT_ONE_TIME_PERIOD_DAYS` | `30` | `wechat.adapter.ts` | 一次支付授予的天数（月付 = 30；ADR-0020 把旧的 `365` 作废）。与价格无关，跟着**周期**走 |
| `WECHAT_OUT_TRADE_NO_MAX_LENGTH` | `32` | `wechat.adapter.ts` | 微信商户订单号长度上限；调用方传的号超长**在本地就拒** |

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
| `pricing_audit_log` | 改价/发券/金额异常审计（append-only，**没有 UPDATE/DELETE**） | ⚠️ **没有任何 CHECK 约束** —— 迁移只建了表与两个索引。词表只活在 TS 的 `AUDIT_ACTIONS` 里，所以**数据库挡不住**一个拼错的 `action`。要补的话得手工追加一条 CHECK（Prisma 表达不了） |
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
按新价位（¥5）说就是 —— 付了 ¥5 的人能白拿 ¥1 的折扣（¥5 在价目表上）；
而真的付了 ¥4 的人**被拒绝授予**（¥4 不在价目表上）。

🔴 **价格降到 ¥5/月 之后，券的折扣空间只剩几毛钱的量级 —— 这是新定价模型带来的
产品约束，不是实现细节。** 一张 `fixed` ¥20 的券落在 ¥5 的订单上时，折扣被
`clampDiscountMinor` 夹到 ¥5、实付变 0，于是撞上**最后一条**拒绝原因
`not_chargeable_after_discount` —— **券不是"减得多"，而是直接无效**。
所以在新价位上，"发一张大额券"这种玩法用不出去：能用的量级是「¥5 减 ¥1」
（`discount_minor: 100`、`final_amount_minor: 400`），或者 `percent` 券
（`percentOffBp = 800`，即 8% → 折扣 `Math.ceil(500 × 800 / 10000) = 40` 分、实付 460 分）。

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

### 6.1 🔴 改价之后，收银台按哪个数收钱

**按订单上冻结的那个数** —— 这是本轮修掉的一个真实缺陷（复核时发现，
不是原设计的一部分）。

改之前：`wechat.adapter.ts` 自己从价目表里查金额下单，而它手里那份是
**代码基线的投影**（`WECHAT_DEFAULT_PRICES`）。于是运营者一 `publishPriceVersion`，
报价层开始按新价报价、**收银台仍按旧价下单** —— 没有报错、没有日志，
只有持续少收的钱，而且发生在真收钱的那一步。

现在：`CreateCheckoutInput.amountMinor` 是**必填**入参，由计价层把
`checkout_orders.final_amount_minor` 传进来；adapter 只负责把这个数签出去，
它**不再持有价格语义**（价目表只剩 `description` 的用途）。
金额不是正整数时抛 `WechatInvalidAmountError`，不兜底、不回落。

回归测试：`server/tests/wechat-adapter.spec.ts` 里那笔 `priceId: 'hosted-monthly'`、
`amountMinor` 由调用方传成一个**故意不等于基线 `500` 的冻结实付**的单 ——
断言发出去的是**传进来的那个数**，不是回价目表查到的基线 `500`。
（同一文件 webhook 侧的夹具：付对 `500 = ¥5` → 授予 **30 天**。）

同一处还有**订单号**：`CreateCheckoutInput.outTradeNo` 由**调用方**生成并传入，
adapter 必须原样使用。理由是回调按订单号认单（`settleOrderPaid` 用
`out_trade_no` 查 `checkout_orders`）—— adapter 若另生成一个，库里冻的是 A、
发给通道的是 B，回调到达时 `unknown-order`，**一笔真实到账的钱授予不出去**。

所以顺序只能是「**先冻结、后下单**」：
`quoteOrder` → `createOrderWithReservation(..., outTradeNo)` →
`adapter.createCheckout({ outTradeNo, amountMinor: quote.finalAmountMinor })`。
反过来（先下单再冻结）会在"名额已满"时留下一个通道侧已经存在、用户还能扫码付款
的订单，而那时我们没有对应的冻结金额。调用方给的号若为空 / 超长 / 解不出同一个
`userId`（`attach` 丢失时的归属兜底），在**收钱之前**就抛
`WechatInvalidOutTradeNoError`。闭环证据在
`server/tests/billing-pricing-store.pglite.spec.ts`（真 PostgreSQL：冻结的行、
发给通道的 payload、结算用到的数三者逐字相等）。

---

### 6.1.1 🔴 为什么「库里生效价 ↔ 落地页文案」只能由 CLI 守，不能由门禁守

这是一个**被证据支持的结论**，不是"来不及做门禁"的托词：

1. **基价在代码里**（`DEFAULT_PRICE_BOOK`），`price_versions` 初始**是空的**。
   已在全仓核实：**没有任何一个迁移向 `price_versions` 写过数据**
   （`grep -rn 'INSERT INTO "price_versions"' server/prisma/migrations/*/migration.sql`
   为空；所有迁移里唯一的数据 INSERT 是 `pending_passkey_registrations`）。
2. 因此 `price_versions` 的**唯一**来源是运营在**运行期**执行 `set-price`。
   运行期的写操作**在结构上不可能出现在仓库里** —— 于是也**不可能被任何 CI
   门禁读到**。`scripts/check-pricing-consistency.mjs` 只能在"没有 PostgreSQL 的
   CI"里跑，它钉的是**代码基线 ↔ 中英词条 ↔ 法务 ↔ `pricing-ssot` 块**。
3. 想加"读库"的门禁只有两条路，都更坏：
   - 让门禁连库：CI 没有库 → 要么红（挡住所有 PR），要么**静默跳过** ——
     而静默跳过的检查比没有检查更危险，它会让所有人以为这件事被守着；
   - 解析迁移流来"重放"价格：迁移里没有价格数据，重放出来永远是基线，
     即**恒等于**已经在跑的那道门禁 —— 一个看起来更严、其实没多守任何东西的检查。

所以这个不一致**必须**在一个"能看见库、而且会因此变红"的地方被拦：
`pnpm --filter @heyta/server pricing` 的 `show` 与 `set-price` 都会
`describeCopyFootprint` 比对生效价与文案，**不一致就 `process.exitCode = 1`**。
可失败证据：`server/tests/billing-pricing-store.pglite.spec.ts` 的改价 CLI 组
（真 SQL：写进 `price_versions` 的价格与文案不一致时，退出码必须是 1）。

🔴 这条纪律的实际含义：**改价之后必须有人跑一次 `pricing show`**。
它没有自动化的替代品，因为"运营刚刚在数据库里做了什么"这件事，
仓库无从得知。

---


### 6.2 运营的实际入口：一个 CLI，两个「会红」的条件

改价 / 发券**只有一条路**：服务器上的 `server/scripts/pricing.ts`（本轮接进了
`package.json`，所以不必再手敲 `tsx`）：

```bash
pnpm --filter @heyta/server pricing show          # 生产（跑 dist）
pnpm --filter @heyta/server pricing:dev show      # 开发（直接跑 tsx）
pnpm --filter @heyta/server pricing set-price \
  --price-id hosted-ai-monthly --currency CNY --amount-minor 1500 \
  --actor ops@heyta --note "国庆活动"
```

没有 HTTP 管理接口、没有管理界面，**也没有 admin 鉴权 / 角色** —— 能登服务器就能改价，
`--actor` 是一段自由文本（可伪造）。这是本轮如实记录的缺口，不是设计（见 §7 第 14 条）。

`show` 打印四段：价格（基线与生效价）→ 券 → **审计（最近 20 条）** → 告警。
审计段是本轮补的：`pricing_audit_log` 在此之前**只写不读**，于是"谁在什么时候把 ¥12
改成 ¥15"在代码里没有答案，只能手写 SQL 去问库。审计写下来却读不出来 = 没有审计。

**两个条件会让 CLI 以退出码 1 结束。** 注意这两个都不是"改价失败、已回滚"——
价**已经改了**，只是还有事没做完：

| 条件 | 含义 | 恢复方式 |
|---|---|---|
| **文案分叉** | 库里此刻生效的价 ≠ 代码基线（而落地页 / 法务 / 门禁读的是基线） | 把基线也改成新价并跑 `pnpm check:pricing`；或撤回 |
| **价格空隙** | 该 key 在库里有版本，但**没有一版在此刻生效** → 收银台直接拒单 | 先发一版立即生效的过渡价，或把 `--effective-from` 改到当前/更早 |

「文案分叉」这一条补的是**门禁唯一的盲区**：`check:pricing` 只校验代码基线 ↔
中英词条 ↔ 法务 ↔ `pricing-ssot` 这四处**代码侧**文件是否自洽，它**不读数据库**
（CI 没有 PostgreSQL）。所以"库里改了、文案没改"以前没有任何机制会发现 ——
页面印 ¥5、收银台收 ¥139，而全部门禁是绿的。CLI 是唯一能在**改价那一刻**说出来的
地方，因此它必须**失败**，不能只是提示。

修这个盲区时还顺手修掉了一个精度问题：比的是**改完之后此刻真正生效**的那一版，
不是刚发布的那个数。否则"排期到未来"这个正常操作会被误判成分叉
（"库里现在收 ¥13"在那一刻是假的）。价格空隙的成因见 §7 第 13 条。

该清单**自身**也被断言：`tests/pricing-cli.spec.ts` 会检查 `PRICING_COPY_SITES`
里点名的每个文件**真的存在** —— 因为本仓库刚踩过"注释点名了一个不存在的脚本"
（§7 第 15 条），而清单漂移的后果是"少改一处文案"。

---

## 7. 未验证项与已知缺口（不假装它们被测过）

1. ~~**行锁的阻塞行为没有被本仓库实测过。**~~ **已在真 PostgreSQL 上实测 —— 不再是缺口。**
   PGlite 是单连接，两个 `BEGIN` 无法并存，所以那条链路仍然只给顺序语义 + 机制形状。
   真交错现在由 `server/tests/integration/coupon-quota-race.integration.spec.ts` 覆盖：
   两个（以及五个）并发事务同时预留限量券，断言**恰好一个 / 恰好两个成功**、
   其余抛 `CouponQuotaExceededError`，并**直接查库**核对核销行数。

   🔴 **"真的并发"不是靠运气**：该 spec 给 `SqlExecutor` 包了一层**会合栏**
   （`withRendezvous`），让各事务在发出 `SELECT … FOR UPDATE` **之前**互相等齐 ——
   不加这一层，用例可能碰巧串行执行，而"恰好一个成功"在串行下**也成立**，
   于是断言变成空转。
   非空转证明（本轮实测）：把 `pricing-store.ts` 里那句 `FOR UPDATE` 删掉 →
   `Tests 2 failed | 1 passed`；加回去 → `Tests 3 passed`。
   实测环境：PostgreSQL 17.9（Homebrew，`LC_ALL=C`），32 个迁移全部应用。

   ⚠️ **该 spec 还没注册进 `server/package.json` 的 `test:integration:postgres`**
   （那个文件此刻被另一条工作流改着），所以 **CI 目前不会跑它**。手动运行：
   ```
   DATABASE_URL=… npx vitest run --config vitest.integration.config.ts \
     tests/integration/coupon-quota-race.integration.spec.ts
   ```
2. ~~**Prisma 的参数绑定层未被测试覆盖。**~~ **已被同一个 spec 覆盖（在真库上）。**
   `createPrismaSqlExecutor` 只做三件事：转发参数、包 `$transaction`、把非数组返回值
   兜成 `[]`。现在每一次预留都经过它，并且刻意走过两个被点名的形状：
   `number` → `bigint`（`coupons.valid_from`、`checkout_orders.quoted_at` / `expires_at`）、
   `number` → `integer`（`*_amount_minor`、`percent_off_bp`）、
   JS 数组 → `text[]`（`coupons.price_ids` / `regions`，经 `upsertCoupon`）。
   绑定写错的话语句会直接失败，所以"跑绿"就是证据。
   ⚠️ 与第 1 条同一前提：这个 spec 还没进 CI 清单。
   （`$transaction` 的回调**类型**另有一个缺口，见第 8 条。）
3. ~~`check:pricing` 还没接进 `pnpm check`。~~ **已接入（提交 `e63b100`）。**
   `package.json` 现在有 `check:pricing`，`check` 链路在 `check:docs` 之后调它。
   提交时 `package.json` 是用 `git show HEAD:package.json` 做基底、**只**叠加这一处的 ——
   工作树里当时还带着另外两条工作流未提交的改动（`check:mobile-bundle`、
   `check:materialized-reads`、harmony 系列 `verify:*`），不为别人提交他们没验证过的东西。

   实测：`pnpm check:pricing` → exit 0；`pnpm check` 全链路 → exit 0。
   **注入探针**（ADR-0017 的 ¥99 时代实测）：把 `server/src/billing/price-book.ts`
   的 `amountMinor: 9_900` 手改成 `9_800` → 门禁 exit 1，并指名两个不一致的文件
   与两个数字；改回后 exit 0。门禁不是空转的。
   🔴 探针里那两个数字**已经随 ADR-0020 换代**（现在 `hosted-monthly` 的基线是 `500`）——
   机制一个字没变，但**别照抄旧数字**：要复现就用当前基线值重跑一遍，改哪一条
   `amountMinor` 都会让 `pricing-ssot` 块与 `price-book.ts` 对不上。

   `verify-i18n-failures.mjs` 的 `pricing` / `coupon` 两组是它的**故障注入**验证，
   已注册成 `pnpm verify:i18n-failures`（实测 85 例全部符合预期，其中 `pricing` 10 例、
   `coupon` 9 例：每个 mutant 都让对应检查变红）。它耗时较长，**有意不**放进
   `pnpm check`，留给 CI 的独立作业。
4. **发票金额口径未与会计确认。** 有券的单，"开票金额"取 `final`（实付）
   是我们的常识判断，**未经会计确认**。
5. **收款通道的资质 / 凭证未落地（退款仍未接线）。**
   下单**已经接通**（收银台路由 `POST /api/billing/checkout`，见第 18 条），
   回调也有路由；但这台实例**没有配真实支付通道** —— 只有 `noop` 时收银台回
   `503 BILLING_PROVIDER_NOT_CONFIGURED`，ADR-0017 §5 的支付商资质问题仍在。
   **退款**那条线确实仍未接线：`reverseOrderOnRefund` 里的"退款"是
   **退款被确认之后的状态同步**，不是退款本身。
6. **微信是否接受 ¥0 订单未核实。** 我们的设计里 0 元单在建单之前就被拒
   （`MIN_CHARGEABLE_AMOUNT_MINOR`），所以这一点不影响正确性；但它意味着
   "用 ¥0 单测试回调链路"这条路走不通。
7. **微信商家券 / 支付宝商家券的能力仍在灰度或受资质限制**（见 ADR-0018 §2.3）。
   本轮不接，表结构留了 `provider` / `out_trade_no` / `provider_event_id`。
8. ~~**没有运营用的 CLI。**~~ **已加：`server/scripts/pricing.ts`（本轮）。**
   形状正如这里原先预告的：`show` / `set-price` / `coupon-upsert` / `coupon-disable`
   四个子命令，包一层**严格**参数解析 —— 未知选项、重复选项、缺值一律报错，
   因为在运维工具上"静默忽略"等于"以为改了价其实没改"。参数解析单独做成纯函数
   `parsePricingCommand`，由 `server/tests/pricing-cli.spec.ts`（30 例）覆盖。
   写路径只走 §6 的三个写入口，于是"收口旧版 + 插入新版 + 写审计"仍在同一事务里。

   **实测（真 PostgreSQL 17.9）**：`show` 逐条打印基线（今天 = **4 条**：
   `hosted-monthly` / `hosted-ai-monthly` × CNY/USD）；
   `set-price --price-id hosted-monthly --currency CNY --amount-minor 13900`
   → 打印改前 / 改后 / 收口版本 / 生效时刻；`show` 复读为 ¥139（`13900` 只是这次
   改价探针随手取的值，**不是任何一档的价格**）；`pricing_audit_log`
   落下 `price_published | hosted-monthly/CNY | actor=ops@heyta`。`coupon-upsert` 建券 →
   `show` 复读 → `coupon-disable` → `show` 变 🔴 已停用，审计两条齐。
   生产路径 `node dist/scripts/pricing.js`（`tsc` 产物）同样跑通。
   退出码契约 0 / 1 / 2 实测：拼错的 `--amout-minor` → 2。

   ⚠️ 这里原先的保留意见**仍然成立**：以上验证的是**库 + 库表**的端到端，
   不是**钱**的端到端。改价之后"用户真的能按新价付钱"依然没验证过（见第 5 条）。
   脚本按 `tsconfig` 的 `include: ["src/**/*","scripts/**/*"]` + `rootDir: "."`
   编译到 `dist/scripts/`（已确认产物存在）。
9. **回调用券时会被静默拒付 —— 已修一半，"静默"这一半修掉了。**
   `wechat.adapter.ts` 的 `verifyWebhook` 曾经用"金额是不是价目表里的某一个"来定
   `oneTimeGrant`，而**这一层是终局判定**：它给出 `oneTimeGrant: null` 之后，
   `apply-event.ts` 把这笔事件归成 `{ status: 'ignored', reason: 'NO_SUBSCRIPTION_REFERENCE' }`
   —— 对一笔真实到账的支付来说那是**假话**，而且与退款 / 对账通知无法区分。
   于是一笔"¥12 档用 ¥7 券、实付 ¥5"的**真实到账**支付会被拒绝授予权益，
   而运维在日志里看到的是"一条被忽略的通知"。

   **本轮改掉的（"静默"这一半）**：`verifyWebhook` 不再做终局判定，而是分成三种、
   各自如实上报（`wechat.adapter.ts` 的同段注释）：
   ① 实付 = 某一档原价 → 授予**该档**（带 `priceId` 与它的 `grants`）；
   ② 有实付但落不到任何档位 → 不授予（fail-closed），但置
   `requiresOrderSettlement: true`；
   ③ 没有实付字段 → 不授予，事件类型如实标成金额不匹配。

   `apply-event.ts` 相应地把 ② 归成**新原因** `REQUIRES_ORDER_SETTLEMENT`
   （`PaymentEventIgnoreReason` 新增的一项），与 `NO_SUBSCRIPTION_REFERENCE`
   严格区分。回归测试：`billing-apply-event.spec.ts` 的
   「有券的支付 → REQUIRES_ORDER_SETTLEMENT，**不是** NO_SUBSCRIPTION_REFERENCE」
   与「两个原因**必须可区分**」；adapter 侧在
   `wechat-adapter.spec.ts` 的金额校验组里断言 `requiresOrderSettlement` 的取值，
   并**反向**断言"没有金额字段的事件不算待结算"（否则一个空 payload 会伪装成
   一笔待结算的支付）。

   **~~仍然没修的（"交付"这一半）~~ 已修。** ② 这类支付现在**真的拿得到权益**：
   webhook 把带订单号的支付交给结算，并按其结论写回订阅行。三件事全部落地：

   （a）`pricing-store.ts` 的 `OrderRow` 的 `SELECT` 现在取 `checkout_orders.price_id`，
   `granted` 结论回带 `priceId` —— "这一单买的是哪一档"在结算时看得见，
   而这正是决定授予 `hosting` 还是 `hosting`+`ai` 的唯一依据；

   （b）webhook 按结论写回 `subscriptions` 的 `priceId` / `grants`
   （`webhook.routes.ts` 的 `applySettlementToEvent`）：`granted` → 用**订单冻结的**
   `grantsForSku(priceId)` **覆盖** adapter 的金额启发式；`already-paid` /
   `amount-mismatch` / `order-not-grantable` → 返回 `null`，一个字节都不写；
   `unknown-order` 是**唯一**保留原事件的结论 —— 那不是收银台的支付，
   没有比 adapter 声明更权威的东西；

   （c）`NormalizedPaymentEvent.outTradeNo` 由 adapter **显式**给出（微信是
   `out_trade_no`），不再从 `providerEventId = "payment_succeeded:hy…"` 里反解。

   🔴 **事务边界的形状**（"结算与授予同生共死"的实现方式）：结算主体抽成收受限
   `SqlRunner` 的 `settleOrderPaidInTransaction(tx, …)`，webhook 在**它已有的那个**
   Prisma 事务里调它；`settleOrderPaid(sql, …)` 只是"自己开事务"的薄壳，留给 CLI / 工具。
   结算逻辑只有一份，两种入口的差别**仅在事务边界**。
   这不是风格问题：`settleOrderPaid` 内部若再开一层事务，webhook 的回滚就带不走它 ——
   订单会变 `paid` 而券的 `reserved` 名额永远占着。

   **回归证据**：`billing-webhook-settlement.pglite.spec.ts`（14 例，真 SQL on PGlite）。
   「用券的单」一条同时钉两件事：订单真的被结算（接线前永远停在 `pending`、券的
   `reserved` 永远占着），且**授予用的档位来自订单** —— adapter 看到的是 ¥5
   （¥12 用 ¥7 券），它的启发式会授予**错的档位**，而断言 `subscription.priceId`
   是 `hosted-ai-monthly` 且 `grants` **不等于** `['hosting']`。
   另有「`granted` 结论带回订单冻结的档位」、「`amount-mismatch` → 订单仍 `pending`、
   零权益写入」、以及两条事务参与性用例（结算随外层事务一起回滚）。

   **非空转证明**（四条注入各自变红、还原后逐个 `md5` 逐字节一致）：
   - adapter 的 `outTradeNo` 改成 `null` → `wechat-adapter.spec.ts` 红在
     `expected null to be 'hy16xs44we8xdeadbeef'`（2 例）；
   - 写入的 `grants` 改成**并集** → `billing-apply-event.spec.ts` 红在
     `expected [ 'hosting', 'ai' ] to deeply equal [ 'hosting' ]`（降级那条）；
   - `SELECT` 里的 `price_id` 删掉 → 结算 spec 红 5 例（含 `expected +0 to be 1`：
     权益一行都没写）；
   - webhook 的结算**调用点**停掉 → 结算 spec 红 6 例，签名正是
     `expected 'pending' to be 'paid'`（订单永远不结算）。

10. ~~**`failOrder` 不释放 `reserved` 名额。**~~ **已修（本轮）。**
   它现在是一个事务：先把该订单的 `reserved` 核销置 `expired`（名额放出来），
   再把订单置 `failed` —— 与 `expireStaleOrders` 同形、同样幂等。
   "人工取消"恰恰是最不该占着名额的情形；释放用 `expired` 而不是 `reversed`，
   因为那笔钱从没动过，不该按"预算已投放"计数。

   **回归证据**：`billing-pricing-store.pglite.spec.ts` 的
   「failOrder（人工取消 / 通道建单失败）**必须一并释放名额**」——断言返回值
   `{ orders: 1, redemptions: 1 }`、核销为 `expired`，且**下一个人拿得到这张限量券**。
   非空转证明：把那条释放名额的 UPDATE 去掉，该用例红在
   `expected { orders: 1, redemptions: +0 } to deeply equal { orders: 1, redemptions: 1 }`。
11. ~~**`reverseOrderOnRefund` 允许 `pending` → `refunded`。**~~ **已修（本轮）。**
   订单侧收紧成 `status = 'paid'`，**核销侧一并收紧成 `state = 'applied'`**。

   🔴 第二处收紧不是顺手清理，是复核时实测出来的**独立**危险：只收紧订单门、
   保留 `state IN ('reserved','applied')`，那么对一张 `pending` 单调用它时
   **订单纹丝不动（`orders: 0`），核销却照样被推成 `reversed`（`redemptions: 1`）**
   —— 那条"永久吃掉一个名额"的路径**根本不经过订单门**，放宽核销条件就能单独触发。
   所以 `reserved` 分支是必须删掉的，不是可以留着的。
   收紧成 `applied` 安全，因为 `settleOrderPaid` 在**同一个事务**里置
   `paid` + `applied`，即 `paid` ⇒ `applied`。

   **回归证据**：同文件的「未付款的单**不许**退款」——断言
   `{ orders: 0, redemptions: 0 }`、订单仍是 `pending`、核销仍是 `reserved`，
   并且**名额是可恢复的**（`expireStaleOrders` 之后下一个人拿得到）：
   "可恢复"正是它与"永久吃掉"的关键区别。
   非空转证明：把两个条件放回旧形态，该用例红在
   `expected { orders: +0, redemptions: 1 } to deeply equal { orders: +0, redemptions: +0 }`。
12. ~~**🔴 新发现：`createPrismaSqlExecutor(prisma)` 在 `strict` 下过不了类型检查。**~~ **已修（本轮）。**
   按这里预告的修法落地：`PrismaLikeClient` 拆成两个接口 ——
   `PrismaTransactionClient`（有原始查询、**没有** `$transaction`）与
   `PrismaLikeClient extends` 它并补上 `$transaction`。配套地 `SqlExecutor` 也拆出
   `SqlRunner`，于是 `transaction` 的回调参数是**受限的** `SqlRunner`：
   "Prisma 的事务里再开一层事务"从此是**类型错误**，不是运行期惊喜。

   这个拆分当场抓出三处真实缺陷：`appendAudit(tx, …)` 在 `publishPriceVersion` /
   `upsertCoupon` / `settleOrderPaid` 的事务内被调用，而它的形参声明成 `SqlExecutor`。
   它只写一行、且**总是在事务里**，所以已改成收 `SqlRunner`；不改的话只能把审计
   挪到事务外，那会留下"改了价但审计没写"的窗口。

   **证据**：`server/scripts/pricing.ts` 里那处 `as unknown as PrismaLikeClient`
   绕行断言**已删除**，`npx tsc --noEmit -p server/tsconfig.json` → exit 0。
   删掉断言那一行本身就是回归测试：把两个接口合回去，`pnpm typecheck` 会红在那里。
13. **🔴 新发现：把某个 key 的「第一个」版本排到未来，会造出"没有生效价"的空隙。**
   `resolveEffectivePrice` 的裁决是"库里对该 key 有版本 → 只在覆盖里找，找不到就抛
   `PriceNotEffectiveError`，**绝不回落基线**"（§1.2，刻意设计：回落会变成静默按旧价收款）。
   但 `publishPriceVersion` 只"收口上一版"，而**第一个**版本没有上一版可收口 ——
   于是 `[现在, 新版本起点)` 这段区间一版生效价都没有，收银台在这段时间**直接拒单**。

   **实测（纯函数，不经库）**：基线 `hosted-monthly/CNY = 500`；覆盖
   `1300 / effective_from = now + 7d` → `resolveEffectivePrice(…, now)` 抛
   `PriceNotEffectiveError：价目表 hosted-monthly/CNY 有版本，但没有一版覆盖 …`。
   只有**第一个**版本会这样：后续版本会把上一版收口（`effective_until = 新版起点`），
   所以"排期"本身没问题，坏的是"**第一次就排期**"。

   本轮**没有改**这个语义（它动的是"按哪个数收钱"，属 ADR 级决定），而是让 CLI 在发布
   那一刻就把它喊出来并以退出码 1 结束（§6.2），外加 `show` 如实显示
   「当前没有生效版本」。回归测试：`billing-pricing-store.pglite.spec.ts` 的
   「把**第一个**版本排到未来 → 造出价格空隙，必须当场喊出来」与
   「已有生效版本时再排期 → 不留空隙（上一版被收口），也不算分叉」。

   **建议的修法（待定，需一条 ADR）**：`publishPriceVersion` 在插入某 key 的**第一个**
   版本、且该版本起点晚于"现在"时，先**显式写一版基线作为过渡**
   （`effective_from = 0`、`effective_until = 新版起点`），使区间连续。理由与"不回落基线"
   完全一致：**让生效的东西是显式的一行**，而不是隐式的回落。
14. **🔴 没有 admin 鉴权 / 角色 / HTTP 管理面。** `server/src` 里没有任何
   role / permission / isAdmin 实现，HTTP 上只有
   `POST /api/billing/webhooks/:provider` 一条计费路由。改价 = 能登服务器 + shell 权限，
   `--actor` 是自由文本（**可伪造**）。所以审计记的是"有人这么敲了"，不是
   "某个已认证身份这么做了"。

   最小缺口集：① 运营身份认证 + 角色；② 受鉴权的管理面（查价 / 改价 / 查审计 / 回滚）；
   ③ 把"是否被 DB 覆盖"纳入同一条门禁或人工确认步骤。
   本轮**不建**（超出"定价一致性"这件事的范围），如实记录为缺口而不是"已完成"。
15. **`server/scripts/show-price.ts` 从来不存在，却被两处注释点名。** 已修：
   `price-book.ts` 与 `pricing-store.ts` 的注释改成指向真正的入口
   （`server/scripts/pricing.ts show`），并写明"原先点名的文件不存在"。

   这个错误的**形状**值得单独记下来：注释里点名的文件没有任何门禁校验其存在性，
   所以一个不存在的脚本可以被引用很久而没人发现 —— 而它恰好是
   "遮蔽告警"的最后一个落点。`tests/pricing-cli.spec.ts` 现在对 `PRICING_COPY_SITES`
   做**存在性断言**，防止同类漂移再发生在新加的文案清单上。
16. **订阅行以前记不住"买的是哪一档" —— 已修（本轮）。** `Subscription` 只有
   "有没有一条活跃订阅"这一维，于是 `hosted-monthly`（¥5）与
   `hosted-ai-monthly`（¥12）落成**同一行、完全无法区分**：用户付 ¥12 拿到的东西
   和 ¥5 一模一样，而**没有任何代码能发现发错了货**。

   改动：
   - `subscriptions.price_id`（`String?`）+ `subscriptions.grants`（`String[]`），
     迁移 `20260929000000_add_subscription_grants`（`prisma migrate diff` 生成，
     CHECK 与回填手工追加）；
   - `entitlement.ts` 新增 `evaluateCapability`：**先判订阅有效、再判能力集合**，
     新增拒绝原因 `MISSING_GRANTS` / `GRANT_NOT_INCLUDED`；
     `createEntitlementGuard` 增加 `capability` 选项（默认 `hosting`，
     于是既有的托管同步闸门行为不变）；
   - `price-book.ts` 新增 `SKU_GRANTS` / `grantsForSku`（能力属于 **SKU**，
     不属于价格版本 —— 改价从不改变"这一档给什么"）；
   - `check-pricing-consistency.mjs` 新增 §2b：**代码的 `SKU_GRANTS` 必须与
     `pricing-ssot` 的 `grants` 逐档相等**。这是"交付什么"唯一的门禁。

   🔴 **迁移时差点造成的断服**：`grants` 的默认值是 `ARRAY[]::TEXT[]`，
   而已有行不会被自动回填成"有能力"。判定是 fail-closed 的，所以
   **开关一打开，每一个已经付过钱的用户会被当场拒绝**，拒绝原因看起来像
   "权益已过期"。迁移里显式回填 `ARRAY['hosting']`（¥12 从未上线过，
   老行的正确投影只有 hosting）；`price_id` **刻意不回填** —— 那会编造一条
   我们并不掌握的购买事实。回归证据：`billing-sku-grants.spec.ts` 与
   `entitlement.spec.ts` 的 `evaluateCapability` 组。

   ⚠️ **仍未接的一端**：`NormalizedPaymentEvent` 里订阅式 provider 的档位拿不到
   （事件只带状态与周期），所以那条分支如实写"未知档位 + 不授予任何能力"。
   今天**不可达**（微信的 `mapSubscriptionState` 明确返回 `null`），
   但谁实现第一个订阅式 provider，谁就必须把 grants 接进来，否则每个订阅用户
   都会被闸门拒绝，而拒绝原因看起来像"没买这一档"。
17. **「300 次/月」承诺了，而计量与端点都不存在 —— 已记录成一个有终点的决定。**
   `¥12 / 月 · 300 次/月` 是一个已经写进落地页与法务的承诺，而它依赖的四件事
   **一件都没有**：云端 AI 路由（`server/src/routes/` 不存在）、计量
   （全仓 `quota` 只命中同步存储配额）、`deepseek` 调用（0 命中）、
   能卖 ¥12 的收银台（见第 1 条）。仓库原有门禁校验的是"**收多少钱**"与
   "**文案怎么说**"，**没有一道校验"承诺的东西是否存在"** ——
   所以任何照着文案去接线收银台的人，都会卖出一档收了钱交付不了的服务，
   而 `pnpm check` 每一道都是绿的。

   **本轮的处理**（[ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md)）：
   - 结论是**本轮不实现**，并把它的**最小实现清单**写进 ADR §5 ——
     "不做"因此是一个**有终点**的决定（清单清空之日即被取代），不是拖延；
   - 硬约束：**在计量存在之前，`hosted-ai-monthly` 不得被售卖**；
   - 新增门禁 `pnpm check:ai-quota`（`scripts/check-ai-quota-consistency.mjs`）：
     唯一数字源是参考文档里的 `ai-quota-ssot` 块，中英词条 / 法务 /
     参考文档正文的额度**必须与它相等**；`enforcement` 只能是
     `not-implemented` / `enforced`，声明 `enforced` 时**计量实现必须真的存在**，
     声明 `not-implemented` 时决定记录与"不得售卖"那条硬约束都必须在场。

   已实测非空转（三种破坏各自变红、还原后逐字节一致）：① 只改中词条的
   `300 → 500` → 红；② 把状态改成 `enforced` → 红（计量不存在）；
   ③ 删掉"不得被售卖" → 红。

   ⚠️ **没有引入死代码。** 本轮**不**新建 `ai-quota.ts` 之类"没人调用"的模块 ——
   那正是第 9 条里 `settleOrderPaid` 曾长期无生产调用方留下的教训
   （那件事**已经**接通，教训本身不变）：
   为一个不存在的端点建一个永远为 0 的计数器，测试只能自证。

18. **收银台接通了（`POST /api/billing/checkout`）—— 那条链第一次有用户入口。**
   在此之前 `quoteOrder` / `createOrderWithReservation` / `createCheckout` /
   `failOrder` **全部只被测试调用**：计价引擎存在，但用户走不到付钱那一步。
   新路由 `server/src/billing/checkout.routes.ts`（注册在 `/api/billing`，
   与 webhook 同一个 prefix 与同一份 adapter 配置）把四步接成一条：
   `quoteOrder` → 生成订单号 → `createOrderWithReservation` → `adapter.createCheckout`。

   **四个刻意的边界**（每一条都有对应的失败测试）：
   - 🔴 **金额只从服务端的报价来。** 请求体只有 `priceId` / `couponCode` /
     `currency` / `region`，**没有任何金额字段**；zod 默认丢弃未知键，
     所以客户端塞 `amountMinor: 1` 也不会被读到（测试直接断言库里冻的仍是 500）。
   - 🔴 **先冻结、后下单**，且**同一个订单号**同时用于落库与下单 ——
     两处不同就是"一笔真实到账的钱授予不出去"。测试断言
     `checkoutCalls[0].outTradeNo === response.outTradeNo` 且金额与订单行相等。
   - 🔴 **通道侧下单失败要 `failOrder`**：它是 `failOrder` 的**第一个生产调用方**。
     测试断言失败后订单为 `failed` 且券的 `reserved` 名额被释放。
   - 🔴 **不可交付的档在报价之前被挡掉**，理由用给用户看的话（`409` +
     `PRICE_NOT_SELLABLE`）。这是第 17 条那条硬约束的执行点；见
     `price-book.ts` 的 `NOT_YET_DELIVERABLE_SKUS` / `notSellableReason`。

   没配支付商（只有 `noop`）时回 `503`，**不是**让 noop 接单 —— 那会把一笔
   真实支付变成一个必然抛错的调用。

   **改动面**：`server/src/billing/checkout.routes.ts`（新）、`server.ts` 注册、
   `billing/index.ts` 导出、`price-book.ts` 的两个新导出、
   `server/tests/billing-checkout.routes.spec.ts`（12 例，真 SQL 跑在 PGlite 上）、
   `scripts/check-ai-quota-consistency.mjs` 新增 §3b（状态 ↔ **执行点**）。

   已实测非空转（三种注入各自变红，还原后逐字节一致）：
   ① 拿掉不可交付检查 → `expected 200 to be 409`；
   ② 拿掉 `failOrder` → `expected 'pending' to be 'failed'`；
   ③ 把发出去的金额换成 `1` → `expected 1 to be 500`。
   门禁侧另有两条：删掉对象里那条 SKU → 红；不再调用 `notSellableReason` → 红。

   ⚠️ **本轮写这条检查时踩到过一次空转**：第一版用的是
   `/NOT_YET_DELIVERABLE_SKUS[\s\S]*?hosted-ai-monthly/` 这种跨全文件的正则，
   而常量上下的注释与同文件的 `SKU_GRANTS` 里都含有那个 SKU 字符串 ——
   于是**把真正那一条删掉它照样绿**。已改成先解析对象体、再在体内查键。
   记在这里是因为它很典型：**跨文件/跨段的正则检查，看起来越"宽松好用"，
   越可能恒为真。**

---

## 8. 对应的门禁与验证

| 检查 | 命令 | 覆盖 |
|---|---|---|
| 价格一致性 | `node scripts/check-pricing-consistency.mjs` | 基线价目表 ↔ 中英词条 ↔ 法务文本 ↔ `pricing-ssot` 块；**恰好两个 SKU**（`hosted-monthly` / `hosted-ai-monthly`），每个都要带 `grants`，而 `grants` 白名单**只有** `hosting` / `ai`（功能名进收费清单 = 虚假宣传）；**adapter 里不许有第二个数字** |
| 承诺 ↔ 状态 ↔ **执行点** | `node scripts/check-ai-quota-consistency.mjs` | 「300 次/月」这个数字的**唯一源**（`ai-quota-ssot` 块）↔ 中英词条 ↔ 法务 ↔ 参考文档正文；`enforcement` 取值合法；`enforced` 时计量实现必须存在；`not-implemented` 时决定记录 + "不得被售卖" + **收银台真的调用了 `notSellableReason(...)`** 都必须在场 |
| 迁移纪律 | `node scripts/check-migrations.mjs` | 迁移文件命名/语句数/禁用语句 |
| 券与价格的故障注入 | `node scripts/verify-i18n-failures.mjs pricing` / `… coupon` | 10 + 9 例：每一处"改坏"都必须让对应的检查变红 |
| 单元与集成 | `cd server && npx vitest run tests/billing-*.spec.ts` | 见 §2 的"有测试吗"一列 |
