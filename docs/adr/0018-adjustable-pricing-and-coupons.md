# ADR-0018：价格可运行期调整（版本化价目表），与自建的优惠券域模型

> 状态：**已接受**
> 日期：2026-09-27
> 取代：无（**修正** [ADR-0017](0017-single-paid-tier-and-payment-channel.md) §3.2 里"价格只写在代码里"与 §4 里"回调金额校验是『金额是价目表里的某一个』"这两条；**保留**它的一档到底、¥99/$49、自建永久免费、不自动续费四条结论）

## 1. 背景与约束

### 1.1 两个需求，一个是"以后要改"，一个是"要能发券"

ADR-0017 把价格定了下来，也把价格**写死在了代码里**：那个决定在当时是对的
（一个档、一个价、还没上线，任何抽象都是投机）。但产品侧的下一步马上来了：

> 注意价格后面是需要可以调整的。
> 另外的话，再做一个优惠券的模型。就是后面的话方便我们推出优惠活动。

这两句话合起来要求一件事：**价格与"这一单收多少"必须从代码里搬出来。**

### 1.2 硬约束（结论由它们推导，不是由偏好推导）

| 约束 | 来源 | 它对设计的影响 |
|---|---|---|
| **只有一个付费档**，不做月付、不做自动续费 | ADR-0017 §3.1（产品决策） | 价目表可以是"一个 SKU × N 个币种"，不需要订阅目录、不需要 plan 层级 |
| 自建（self-host）**永久免费** | ADR-0017 | 免费路径**不能**经过任何计价代码；计价只服务于官方托管实例 |
| 大陆 **¥99/年**、海外 **$49/年** | 用户明确给定 | 两笔钱之间**没有**我们定义的汇率 → 券不能跨币种 |
| 金额用**整数最小单位**，不出现浮点 | [pricing-and-entitlements.md](../reference/pricing-and-entitlements.md) §4（已有纪律） | 百分比只能用**基点**表示（15% = 1500bp），折扣取整必须**显式**选方向 |
| `pnpm check` / `pnpm test` 必须全绿，不许回归 | AGENTS.md | 任何新机制都要能被 PGlite（真 PostgreSQL）在没有线上库的情况下跑 |
| 不许动 `CURRENT_SCHEMA_VERSION` | AGENTS.md §3.3 + `packages/shared-schema` | 这五个新表**纯服务端**，不进 op-log 线协议 |
| 迁移不许手写，由 `prisma migrate diff` 生成 | AGENTS.md §4 | CHECK 约束只能**手工追加**在生成体之后（Prisma 表达不了） |
| 支付通道**还没接线**（ADR-0017 §5） | 现状 | 本轮交付的是"**计价 + 账 + 状态机**"，不是"能付款" |

### 1.3 一个必须先说清的既有洞

ADR-0017 §3.2 记了一句诚实的自白：

> ⚠️ **这一版的强度有已知上限**：它校验的是"金额是价目表里的某一个"……
> 一旦价目表出现**多个不同金额**的 SKU，就必须改成按价目表项校验。
> **在那之前不要加第二个 SKU。**

只要引入优惠券，这个洞**立刻**就是真的：券让"这一单该付多少"不再等于任何
价目表项。¥99 的年付用了 ¥20 的券，实付 ¥79 —— 而 ¥79 **不是**价目表里的
任何一个数，旧逻辑会把它判成"金额不在价目表上"，于是**拒绝授予一个真的付了钱
的用户**；反过来，一个人直接付 ¥99 也能白拿那张券（因为 ¥99 在价目表上）。

所以本轮必须同时修掉它，而不是"以后再说"。

---

## 2. 选项

### 2.1 「价格住在哪里」

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. 保持代码常量**（现状） | 零机制；改价走一次发版，天然有 code review 与审计 | 改价 = 发版；促销活动不可能每次都发版；**同一个数字住在 3 个地方**，靠门禁事后比对 | `scripts/check-pricing-consistency.mjs` 的整个存在理由就是"三处不一致" |
| B. 环境变量里的 JSON 价目表 | 不用发版；运维改一个 env 就生效 | env 里塞结构化数据**没有校验、没有历史、没有审计**；写错一个字符 → 全部订单按错误价格下单，而且回滚只能靠改回去；`config.ts` 的 env 校验会膨胀成一坨 | ADR-0017 附录已明确否决过同类方案 |
| **C. 代码基线 + 数据库版本（带生效区间）** | 有历史（append-only）、有审计行、有 CHECK 约束、可回滚（再发一版）；**代码里仍有一份基线**，所以新装实例、测试、CI 全都不依赖数据库 | 多两张表；多一条"读覆盖版本"的路径，而它必须有明确语义 | 本 ADR §3.1；实现见 `server/src/billing/price-book.ts`、`server/src/billing/pricing-store.ts` |
| D. 把第三方计费系统的价目表当事实源（Stripe/Paddle 的 price/product 对象） | 少维护一套价目表；订阅/退款/发票都由对方处理 | 大陆要微信/支付宝直连，读不到；**离线、自建、测试**场景拿不到价格；ADR-0017 已确定"复用同公司晓黎支付中心"而不是引入 Stripe | §2.3 的调研结论 |

**选 C。** 决定性理由是 A 与 B 各自的失效模式都指向同一件坏事：
**"用户看到的价格"和"这一单实际收的价格"可以静默地分叉。**
C 让价格只有一份机器可读的写入口（`publishPriceVersion`），并且**每一版都带生效区间**，
于是"这笔历史订单当时为什么是这个价"是一个可以重放的问题，而不是考古。

### 2.2 「券的语义」

| 选项 | 优点 | 缺点 | 决定 |
|---|---|---|---|
| **A. 自建券域（百分比 + 固定额）** | 语义完全可控；可测；不依赖支付通道的营销能力 | 要自己实现名额、并发、幂等、退款语义 | ✅ **选它** |
| B. 直接用微信/支付宝的商家券 | 券在支付通道侧核销，我们不用管并发 | 微信**商家券仍在小范围灰度**；支付宝商家券要求**企业或个体工商户**资质；两家的券模型不同 → 要写两套适配；**结算金额会被券改变**（微信账单里 `应结订单金额 = 订单金额 − 免充值券金额`），对账口径跟着对方走 | ❌ 否决（本轮） |
| C. 用 Stripe 的 coupon + promotion code | 能力最全（见 §2.3） | 大陆支付通道拿不到；把定价绑到一个只在海外可用的供应商上，是 ADR-0017 已经拒绝过的方向 | ❌ 否决 |
| D. 只做百分比券 | 实现最少 | 运营最常说的是"减 20 块"，不是"减 20%"；固定额是**唯一**能表达"老用户补偿 ¥30"的形状 | ❌ 否决 |
| E. 允许**叠加**多张券 | 运营更灵活 | 叠加的规则空间是组合爆炸的（哪些能叠、按什么顺序、门槛按原价还是折后价算）；每一组合都是一个新的对账口径 | ❌ **明确否决**。代码里 `MAX_COUPONS_PER_ORDER = 1`，且**改了它就会抛异常**——不是注释劝阻，是编译器/运行时拦截 |
| F. 用户敲了多个码时"自动选折扣最大的那张" | 对用户最友好 | 订单上记的券是**退款与对账的基准**。自动换券意味着"用户以为用了 A 券、订单上写着 B 券"，退款算不清 | ❌ 否决。改成**按优先级取第一个能用的**（`quote.ts`） |
| G. 用 100% 的券来做"免费" | 不用改产品结构 | 0 元单**无法完成支付**（见 §3.3），而且"免费"是一个产品决策，不该伪装成一张券 | ❌ 否决：定义校验直接拒绝 `percentOffBp = 10000`，并在代码里写明"想做免费，就把它做成一个真正的免费档" |

### 2.3 调研到的外部事实（决定 §2.2 的那些否决）

| 来源 | 结论 | 对本设计的影响 |
|---|---|---|
| Stripe | coupon（折扣本身）与 promotion code（用户输入的码）**是两个对象**；promotion code 可以有 `max_redemptions`、`first_time_transaction`、`expires_at`、`restrictions`（按 product 限） | 我们的 `CouponDefinition` 一个对象里同时含"折扣"与"码"——因为**只有一个档**，不需要 coupon/promotion code 的多对多。这是可维护性门槛下的**有意缩小**，不是没看懂对方模型 |
| Stripe | 明确允许**零金额订单**（发票/订阅都可以是 0） | 我们**反过来**：`MIN_CHARGEABLE_AMOUNT_MINOR = 1`，0 元单在**建单之前**就被拒。理由见 §3.3 |
| Paddle | 折扣有 `flat` / `flat_per_seat` / `percentage` **三种**，外加 `discount_group`（同组互斥）、`usage_limit` 是**全局** | `discount_group` 承认了"叠加会有组合爆炸"；我们的答案更简单：一单一张。`flat_per_seat` 对我们是**无关**的（只有一个档、按账户不按席位），所以没进 §2.2 的选项表 |
| Lemon Squeezy | `usage_limit` 也是全局一个数 | 我们额外支持 `maxRedemptionsPerUser`，因为大陆运营口径里"每人一次"比"总量"更常用 |
| 微信支付 | 代金券分**预充值**与**非预充值**；商家券仍在灰度；商品券按商品核销 | 支付通道侧的券本轮不接；`checkout_orders` 保留 `provider` / `out_trade_no` / `provider_event_id`，将来接的时候不用改表 |
| 微信支付 | 账单字段 `应结订单金额 = 订单金额 − 免充值券金额` → **有券的单，结算金额 ≠ 订单金额** | 订单表把 `original_amount_minor` / `discount_minor` / `final_amount_minor` **三列都存**，并且有 CHECK 保证 `final = original − discount`。对账时三个数都在，不用反推 |
| 微信支付 | 退款**不会**自动退券，要商户**主动**调 `/v3/marketing/busifavor/coupons/return` | 所以"退款归还名额"**不能**被假设为默认行为 → §3.4 的"退款不归还名额"与我方语义一致 |
| 有赞 | 券类型有满减 / 折扣 / 随机金额 | 随机金额（如"立减 1~5 元"）**本轮不做**：它让"用户看到的价格"不确定，而我们的落地页要写死一个价 |
| Stripe / Paddle 通用 | 并发核销必须用**部分唯一索引 + `INSERT … ON CONFLICT DO NOTHING`** 或 `SELECT … FOR UPDATE`，**绝不能**"先 count 再 insert" | 我们选 `SELECT … FOR UPDATE`（锁券行）+ 事务内重新计数；并且 `coupon_redemptions.order_id` 是 UNIQUE，那是第二道闸 |

**本次复核**（`web_search` 在本会话不可用 —— Tavily HTTP 432 —— 故用 `web_fetch` 取一手文档）：

- **Stripe 的两条：逐条对上。** `docs.stripe.com/billing/subscriptions/coupons.md`：
  coupon 与 promotion code 确为两个对象；"限指定客户""限首购""最低消费"是 promotion code
  独有、coupon 不支持；`max_redemptions` 是**全局**额度（全体客户共享，不限每人）；
  `expires_at` 不能晚于 coupon 的 `redeem_by`；coupon 只能删除，promotion code 可以
  `active:false` 归档。原文里的权衡也被我们采纳了 —— coupon 删除**不影响**已有订阅/发票上的折扣，
  与本文 §3.1"旧价行永不删除"是同一种纪律。
- **Paddle 的一条：对上，并已修正一处不精确。** `developer.paddle.com/api-reference/discounts/list-discounts.md`：
  `type` 实际是 `flat` / `flat_per_seat` / `percentage` **三种**（本文原先写成两种，已改）；
  `usage_limit` 原文 "an overall limit for this discount, rather than a per-customer limit" —— 
  与"全局"一致；`discount_group_id` 存在。
- **未复核：Lemon Squeezy、微信支付、有赞三条。** 它们驱动的是"本轮不做"的否决
  （§2.2 的 B/C/D 与随机金额券），细节有出入也不改变结论。但**接支付通道侧的券之前必须重核**，
  尤其是微信那条 `应结订单金额 = 订单金额 − 免充值券金额` —— 它是订单表存三个金额列的直接理由。

---

## 3. 结论

### 3.1 价格：代码是基线，数据库是版本，**两个层级的语义必须不同**

```
DEFAULT_PRICE_BOOK（代码，price-book.ts）
   annual / CNY / 9900 / effectiveFrom: 0 / effectiveUntil: null
   annual / USD / 4900 / effectiveFrom: 0 / effectiveUntil: null
        │
        │  数据库里对 (priceId, currency) 有版本吗？
        ├── 没有 → **只在基线里找**            → 找到用它；找不到抛 UnknownPriceError
        └── 有   → **只在覆盖里找**            → 找到用它；找不到抛 PriceNotEffectiveError
                                            ↑ 🔴 绝不回落到基线
```

那个"绝不回落"是整个设计里最重要的一条。回落到基线看起来无害（"没找到新的就用旧的嘛"），
实际后果是：**一次改价把某个窗口写空了，之后每一笔订单都会安静地按旧价收款。**
没有报错、没有日志、没有异常 —— 只有少收的钱。所以宁可让报价**抛异常**，
让"改价把收银台弄挂了"这件事在 5 分钟内被人发现，也不要它安静地错一整周。

配套纪律：

- **改价是 append，不是 update**：`publishPriceVersion` 在一个事务里
  （`SELECT … FOR UPDATE` 锁住旧的开区间版本）把旧版收口、插入新版、写审计行。
  旧行**永不删除** —— 历史订单的金额永远能按当时生效的那一版解释。
- 覆盖版本把某个键写空（时间上有缝）会被 `assertValidPriceBook` 挡住；
  而"这一刻没有生效版本"由 `resolveEffectivePrice` 抛出来。
- 代码基线**不重复**在别处出现：`WECHAT_DEFAULT_PRICES` 现在是
  `projectPrices(DEFAULT_PRICE_BOOK, 'CNY', 0)` 的**投影**，不再持有自己的字面量。
  门禁新增一条"adapter 里不许出现 `totalFen: <数字>`"，防止有人把它抄回去。

### 3.2 券：一个对象、一单一张、按优先级取第一个能用的

券域全部是**纯函数**（`coupon.ts`、`quote.ts`），IO 只出现在 `pricing-store.ts`。
判定顺序是固定的，而且**顺序本身是规格**：

```
unknown_coupon → stacking_not_allowed → disabled → not_started → expired
  → currency_mismatch → region_mismatch → price_not_applicable
  → order_below_minimum → first_purchase_only
  → total_redemption_limit_reached → user_redemption_limit_reached
  → not_chargeable_after_discount          ← 必须是最后一条（它需要算出折扣才知道）
```

`not_chargeable_after_discount` 必须最后的理由：它是**唯一**一条需要先算出折扣
才能判的规则。把它提前会让"这张券用不了"和"这一单收不了钱"混成同一个原因，
而这两件事的处置完全不同（前者让用户换张券，后者是配置错误）。

`coupon.ts` 里 `COUPON_REJECTION_EXPLANATION` 是一个 `Record<CouponRejectionReason, string>`：
**新增一个拒绝原因而忘了写人话解释 → 编译不过。**
并且 `server/tests/billing-coupon.spec.ts` 里有一条测试断言
"用例覆盖的原因集合**恰好等于**枚举本身" —— 一个永远走不到的分支会让它红。

### 3.3 钱：整数最小单位、基点为百分比、取整**偏向用户**

- 百分比用**基点**（`PERCENT_SCALE = 10_000`）。`1500` = 15% off。
  ⚠️ 语义是"**减**多少"：八折 = 减 20% = `2_000` bp。把 `8_000` 当八折，
  实付会变成两成 —— 这个方向搞反是**本次实现里真的写错过一次**的错
  （见 `billing-coupon.spec.ts` 里那两条成对的测试）。
- 折扣取整用 `Math.ceil`，也就是"用户拿到的折扣**不少于**广告里的百分比"。
  `floor` 是**已被测到的 mutant**：`Math.floor` 会让 33.33% off 的 ¥99 从
  ¥66.00 变成 ¥66.01 —— 每笔多收一分钱，而且**任何东西都不会报错**。
  这条被 `server/tests/billing-money.spec.ts` 与
  `scripts/verify-i18n-failures.mjs` 的 `coupon` 组**各拦一次**。
- **0 元单不可支付**（`MIN_CHARGEABLE_AMOUNT_MINOR = 1`），而且必须在
  **建单之前**就拒绝，不能留给支付通道去失败。理由：一次失败的支付请求会在
  通道侧留下痕迹、会让用户看到一个我们无法解释的错误；而"这一单收不了钱"
  是我们自己**当场就知道**的事。
- 实付 = 原价 − 折扣 **只有一处**写入（`money.ts` 的 `breakdownAmount`），
  数据库还有 CHECK 兜底（`checkout_orders_amounts_coherent`）。
  公式写两遍就等于两套可能漂移的真值。

### 3.4 名额：`reserved` 算、`expired` 不算、`reversed` **算**

| 状态 | 占用名额 | 为什么 |
|---|---|---|
| `reserved` | ✅ | 不占的话，**刷预留就能把限量券占满**（占位是主动攻击面）。代价是需要 §5 的 sweep |
| `applied` | ✅ | 已用掉 |
| `reversed` | ✅ | 退款**不归还**。总量限额的语义是"这份预算已经投放出去了"；归还意味着同一份预算能被"买 → 退 → 再买"反复薅。微信的退款也不自动退券、要商户主动调用，与我们同向 |
| `expired` | ❌ | **必须**不占。否则限 100 张的券会被 100 个"点了支付没付"的单**永久**占满 —— 那样 sweep 就毫无意义 |

🔴 由此产生一个**有意的、有界的不一致**：一笔支付如果晚于订单过期才到，
那个名额可能已经被别人拿走了 → 最多超发 1 次。方向是故意的：
**宁可多给一个人权益，也不能因为"名额没了"吞掉一笔真实到账的钱。**
但 `settleOrderPaid` 会返回 `afterExpiry` 与 `quotaExceeded` 两个布尔量，
调用方**必须**把它记成告警 —— 它是一个"应该发生但需要解释"的状态，
不是一个正常路径。这是"有意为之"与"偷偷发生"的区别。

### 3.5 状态机：唯一允许把订单推进到终态的两条路径

```
                    ┌──────────── expireStaleOrders ────────────┐
                    ▼                                           │
  (quote) ── createOrderWithReservation ──► pending ── settleOrderPaid ──► paid ── reverseOrderOnRefund ──► refunded
                                              │                                                   
                                              └── failOrder ──► failed                             
```

- `settleOrderPaid` 是**幂等**的：读回当前状态，已经是 `paid` 就返回 `already-paid`
  且**不写任何东西**（连 `paid_at` 都不改）。重复投递的支付事件不该改变任何事实。
- `settleOrderPaid` 允许从 `pending` **与** `expired` 进入 `paid`（§3.4 的到账晚于过期）。
  `failed` / `refunded` 不允许。
- **金额校验跟订单比，不跟价目表比**：比的是冻在 `checkout_orders.final_amount_minor`
  上的那一笔实付。这一条同时覆盖 SKU 与折扣，也就是 §1.3 那个洞的修复。
- 报价一旦落库就被**冻结**。此后价目表与券怎么变都不影响这一单 ——
  订单表里同时存 `rejected_coupons_json`，所以"用户来问我的码为什么不能用"
  能按**当时的**定义回答，而不是按今天的定义。

---

## 4. 后果

### 4.1 必须真的跑起来的东西

- 🔴 **`expireStaleOrders` 必须作为定时任务运行。** 它不是优化，是
  `maxRedemptions` 语义的组成部分（§3.4）。sweep 挂了的表现不会立刻可见 ——
  要监控的是"**任务有没有跑**"，不是"扫掉了几行"（扫掉 0 行可能是没人下单，
  也可能正是 sweep 挂了）。运维要求写在
  [pricing-and-coupons.md](../reference/pricing-and-coupons.md) §5。
- 优惠券的**定义**有两层判据：数据库 CHECK 与领域校验。两者**都不能省**，
  而且它们护的东西不同：CHECK 护"这一行在结构上不自相矛盾"（如百分比在开区间内、
  `final = original − discount`），领域校验护"这一行在语义上收得了钱"（如
  `面额 ≥ 门槛` 会导致刚好到门槛的单被夹到 0 元，而数据库无从知道这个关系）。
  实测证据：`billing-pricing-store.pglite.spec.ts` 里那一行
  "每一列都满足 CHECK 但领域层认为它坏"的数据。

### 4.2 已知的实现缺口（写在这里，不假装没有）

1. **支付通道还没接线。** 本轮交付计价、账、状态机；下单/回调/退款的实际接线
   仍是 ADR-0017 §5 的状态。`reverseOrderOnRefund` 里的"退款"是
   **退款被确认之后的状态同步**，不是退款本身（真正的退款要调通道的退款接口）。
2. **行锁的阻塞行为没有被本仓库实测过。** PGlite 是单连接，两个 `BEGIN`
   无法并存，所以"两个并发预留抢最后一张券"跑不出真交错。我们能给的证据是：
   （a）顺序语义 —— 用满之后下一次预留真的抛 `CouponQuotaExceededError`；
   （b）机制形状 —— 一条记录语句顺序的测试断言"锁券行 → 数名额 → 插入"
   在**同一个事务里按这个顺序**发生，删掉 `FOR UPDATE` 或把计数挪出事务就变红。
   PostgreSQL 的行锁会阻塞并发写者是其文档保证的行为，但**没有在本仓库验证过**。
3. ~~`check:pricing` 还没接进 `pnpm check`。~~ **已接入**（提交 `e63b100`，
   见 [pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7）。
   剩下真正未接的是 `verify:i18n-failures` 进 CI 的独立作业 —— 它耗时较长，
   有意不放进 `pnpm check`。
4. **发票金额口径未与会计确认**（承接 ADR-0017 的同类未决项）。有券的单，
   "开票金额"是 `original` 还是 `final`，我们按常识取 `final`（实付），
   但**未经会计确认**。

### 4.3 需要同步修改的文档

- [pricing-and-entitlements.md](../reference/pricing-and-entitlements.md) §4：
  "回调金额校验"从"金额是价目表里的某一个"改成"跟订单冻结金额比"。
- 同上 §6：价格事实源从三处改成"代码基线 + 数据库版本"，并说明各自住在哪。
- [ADR-0017](0017-single-paid-tier-and-payment-channel.md) 的结论（价格、档数、
  自建免费）**不变**，所以它不被取代，只是在上面这一条上被修正。

---

## 5. 证据

| 主张 | 可执行的证据 |
|---|---|
| 折扣取整偏向用户；`floor` 会多收钱 | `server/tests/billing-money.spec.ts`（17 例，含 `Math.floor` mutant） |
| 13 个拒绝原因没有死分支 | `server/tests/billing-coupon.spec.ts`（60 例，含"覆盖集合恰好等于枚举"那条） |
| 覆盖版本的缝**不回落**基线 | `billing-coupon.spec.ts` 的"覆盖版本里的空隙不回落到基线" |
| 五个表与全部 CHECK 约束真的能跑 | `server/tests/billing-pricing-schema.pglite.spec.ts`（32 例，真 PostgreSQL） |
| 幂等、名额、sweep、退款不归还、到账晚于过期 | `server/tests/billing-pricing-store.pglite.spec.ts`（33 例，真 SQL） |
| 锁与计数的**顺序**在同一个事务里 | 同上，"锁的形状"那条（记录语句顺序） |
| 价格只写一次 | `scripts/check-pricing-consistency.mjs` + `verify-i18n-failures.mjs` 的 `pricing` 组（10 例） |
| 券的算术/名额规则被真的拦住了 | `verify-i18n-failures.mjs` 的 `coupon` 组（9 例，8 个 mutant 全部让测试变红） |
| 迁移符合仓库纪律 | `node scripts/check-migrations.mjs` |
