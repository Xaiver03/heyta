# 交接：可调价 + 优惠券 —— 从「领域层已落地」到「收银台真的能用」

> **给全新会话的完整任务书。** 你不需要重新调研 —— 调研结论、产品决定、技术事实
> 都在下面和引用的文档里。**先读完本文再动手。**
>
> ⚠️ 本文只讲**这一条工作流的当前状态**。支付通道本身的大任务书是
> [`subscription-handoff.md`](subscription-handoff.md) 与
> [`subscription-wechat-handoff.md`](subscription-wechat-handoff.md)，
> 它们仍然有效，本文第 5 节只是指出**有了优惠券之后它们必须改哪三处**。

## 0. 一句话

**计价、账、券的状态机已经全部落地并提交（`2d2d4dd`，20 个文件）**，
`pnpm check` 与 `pnpm test` 全绿。
~~剩下的是把它接到收银台上：**adapter 现在仍然按价目表全额下单，完全不认识券**~~
—— 🔴 **本任务书要做的四件事（§5.1–§5.4）已经全部做完**：

- §5.1 adapter 收「冻结后的实付金额」：**已做**（`CreateCheckoutInput.amountMinor` 是必填，
  adapter 不再持有价格语义，见 [pricing-and-coupons.md](../reference/pricing-and-coupons.md) §6.1）；
- §5.2 `check:pricing` 接进 `pnpm check`：**已做**（提交 `e63b100`）；
- §5.3 运营 CLI `server/scripts/pricing.ts`：**已做**（`show` / `set-price` /
  `coupon-upsert` / `coupon-disable`）；
- §5.4 真库行锁并发验证：**已做**（`server/tests/integration/coupon-quota-race.integration.spec.ts`，
  真 PostgreSQL 17.9；⚠️ 但**仍没注册进 `test:integration:postgres`，CI 不跑它**）。

**收银台也已经接通**：`POST /api/billing/checkout`
（`server/src/billing/checkout.routes.ts`）—— 见
[pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7 第 18 条。
**「交付」半段也已经接通**（webhook 在**同一个事务**里调 `settleOrderPaidInTransaction`，
按订单冻结的 `price_id` 写回 `subscriptions.grants`）—— 见 §11.5 第 1 条与 §12。
**现在唯一还缺的用户侧一环**是客户端「付款」按钮，而它**卡在外部**（支付商资质），
见 §11.5。

> ⚠️ 本文的价格数字（`¥99/$49`、年付）**已随 ADR-0020 作废**，
> 现役价格是月付 `hosted-monthly` ¥5/$5 与 `hosted-ai-monthly` ¥12/$12。
> 正文保留作记录，**别拿旧数字当现状**。

## 1. 已经做完的（不要重做，不要改）

提交 `2d2d4dd`，全部在 `main` 上：

| 层 | 文件 | 状态 |
|---|---|---|
| 纯领域 | `server/src/billing/money.ts` | 整数最小单位、基点、折扣取整 |
| 纯领域 | `server/src/billing/price-book.ts` | 版本化价目表、生效区间、`resolveEffectivePrice` |
| 纯领域 | `server/src/billing/coupon.ts` | 券定义 + 判定（13 个拒绝原因） |
| 纯领域 | `server/src/billing/quote.ts` | 计价编排 → `OrderQuote` |
| 持久化 | `server/src/billing/pricing-store.ts` | `SqlExecutor` 端口 + 5 个表的全部读写 |
| 数据模型 | `server/prisma/schema.prisma`（5 个新模型） | 纯服务端表，**没动 `CURRENT_SCHEMA_VERSION`** |
| 迁移 | `server/prisma/migrations/20260928000000_add_pricing_and_coupons/` | `prisma migrate diff` 生成 + 手工 CHECK |
| 导出 | `server/src/billing/index.ts` | 全部新模块与类型 |
| 门禁 | `scripts/check-pricing-consistency.mjs` | 见第 3.3 节 |
| 探针 | `scripts/verify-i18n-failures.mjs`（`pricing` / `coupon` 两组） | 10 + 9 例 |
| 文档 | `docs/adr/0018-adjustable-pricing-and-coupons.md` | 决策与**被否决的 7 个选项** |
| 文档 | `docs/reference/pricing-and-coupons.md` | 模块地图 / 常量 / 状态机 / 未验证项 |
| 测试 | `server/tests/billing-money.spec.ts`（17） / `billing-coupon.spec.ts`（60） / `billing-pricing-schema.pglite.spec.ts`（32） / `billing-pricing-store.pglite.spec.ts`（33） | 全部真跑过 |

落地页（`apps/landing`）~~**不需要改**，也**不要改**：价格没变（¥99/$49）~~ ——
🔴 **价格已随 ADR-0020 改成 ¥5/$5 与 ¥12/$12，落地页已同步重写为三栏**
（`apps/landing/src/components/Pricing.tsx`，见
[ai-tier-pricing-rollout.md](ai-tier-pricing-rollout.md)）。
门禁证明价格四处（代码基线 / 中英词条 / 法务 / `pricing-ssot` 块）仍然一致。

## 2. 必读（按顺序）

1. `docs/adr/0018-adjustable-pricing-and-coupons.md` —— 为什么这么设计、否决了什么。
2. `docs/reference/pricing-and-coupons.md` —— 代码现在长什么样；**§7 是未验证项清单**（你做完一件事就去那里划掉一条）。
3. `docs/adr/0017-single-paid-tier-and-payment-channel.md` —— 自建免费、不自动续费、
   支付通道结论（⚠️ 它的**价格与周期结论已被 ADR-0020 取代**：`¥99/$49`、年付、
   一档到底全部作废；见该 ADR 文件头的补注）。
4. `docs/plans/subscription-wechat-handoff.md` —— 支付接线本身的规格（验签、解密、凭证、零依赖）。
5. `server/src/billing/pricing-store.ts` 的文件头 —— 两条不可动摇的规则。

## 3. 🔴 你的规格（已经定好，不要重新发明）

### 3.1 钱的规则

- 金额**一律整数最小单位**，百分比**一律基点**（`1500` = 减 15%，语义是"减多少"）。
- 折扣取整用 `Math.ceil`，**偏向用户**。改成 `floor` 会让每笔多收一分钱且不报错。
- 实付 = 原价 − 折扣 **只有一处**写入（`money.ts` 的 `breakdownAmount`）。
- **0 元单不可支付**（`MIN_CHARGEABLE_AMOUNT_MINOR = 1`），必须在建单前拒。
  100% 的券不是"免费"，是配置错误。

### 3.2 状态的规则

- 报价（`OrderQuote`）**一落库就冻结**；之后价目表与券怎么变都不影响这一单。
- 结算**只比订单上冻结的 `final_amount_minor`**，不比价目表。
- `settleOrderPaid` 是唯一能推进到 `paid` 的路径，且必须幂等。
- 名额口径：`reserved`/`applied`/`reversed` **计数**，`expired` **不计数**。
  改这个口径前先读 `COUNTED_REDEMPTION_STATES` 的注释。
- **到账晚于过期 → 照样授予**，并把 `afterExpiry` / `quotaExceeded` 当告警。

### 3.3 门禁的规则

- `scripts/check-pricing-consistency.mjs` **锚点失效时必须报错，不许跳过**。
  这是被真实失败教出来的，别用"找不到就 continue"改它。
- 门禁现在读的是 `server/src/billing/price-book.ts` 的 `DEFAULT_PRICE_BOOK`，
  **不是** adapter。adapter 里出现 `totalFen: <数字>` 会被判红（防抄第二份）。
  扫描前**剥注释**，否则注释里提到这个写法会误报。

## 4. 凭证

本节的任务**不需要任何真实凭证**。第 5.1 节可以用 stub 的 `fetchImpl` 测
（`wechat.adapter.spec.ts` 已有这个模式）。真商户号的事在
`subscription-wechat-handoff.md` §4。

## 5. 交付物（按价值排序）

> ✅ **后补（2026-09-27）：本节 5.1 – 5.4 全部已完成。** 下面保留当时的规格原文
> 作记录；现状以 [pricing-and-coupons.md](../reference/pricing-and-coupons.md)
> §6.1 / §7 为准。

### 5.1 🔴 adapter 必须收「冻结后的实付金额」，而不是价目表全额

> ✅ **已完成。** `CreateCheckoutInput.amountMinor` / `outTradeNo` 现在都是
> **必填**入参，adapter 只负责把调用方给的数签出去；
> 收银台按「报价 → 冻结 → 下单」的顺序接线（`checkout.routes.ts`）。
> 回归证据：`server/tests/wechat-adapter.spec.ts` 里那笔 `amountMinor` 故意
> 不等于基线 `500` 的单，断言发出去的是传进来的数。

**这是当时最要命的洞。** `createWechatBillingAdapter` 的 `createCheckout` 用的是：

```ts
const price = prices[input.priceId];
// …
amount: { total: price.totalFen, currency: 'CNY' },
```

**它完全不认识券。** 一个用了 ¥20 券的用户会被收 ¥99，而我们的订单上写着 ¥79 ——
结算时 `settleOrderPaid` 会判 `amount-mismatch` 并**拒绝授予**。
用户付了钱、拿不到权益，这是最坏的一类事故。

它也不知道订单号：`outTradeNo` 是 adapter 内部生成的
（`buildWechatOutTradeNo`），而 `createOrderWithReservation` 要求**调用方**给。

**要做的改动（三处，都很小）：**

1. `server/src/billing/types.ts` 的 `CreateCheckoutInput` 增加两个可选字段：
   `outTradeNo?: string`、`amountMinor?: number`（以及可选的 `description`）。
   不传时保持现在的行为（向后兼容，`wechat-adapter.spec.ts` 的 43 个测试不该红）。
2. `createCheckout` 里：有 `amountMinor` 就用它，否则用 `price.totalFen`。
   同时校验 `amountMinor >= MIN_CHARGEABLE_AMOUNT_MINOR`，否则抛
   （**不要**把 0 元单发给微信）。
3. 调用顺序必须是 **先冻结、后下单**：

   ```
   quoteOrder(...)                         # 算价
   createOrderWithReservation(..., outTradeNo)   # 冻结 + 占名额
   adapter.createCheckout({ ..., outTradeNo, amountMinor: quote.finalAmountMinor })
   # 通道调用失败 → failOrder(orderId)（见 5.1.1）
   ```

   ⚠️ 顺序反过来（先下单再冻结）会在"名额已满"时留下一个**微信侧已经存在、
   用户还能扫码付款**的订单 —— 那时我们没有对应的冻结金额，收也不是、
   拒也不是。

**验收：** 新增测试断言"券后的实付金额真的被发进 `POST /v3/pay/transactions/native`
的 `amount.total`"，并且断言"`outTradeNo` 用的是调用方给的那个"。
用 stub `fetchImpl` 拦 payload，不要去连真通道。

#### 5.1.1 ✅ `failOrder` 之后名额会怎样 —— 已修

> 🔴 **后补：这一节描述的行为已经被修掉了。** `failOrder` 现在是一个事务：
> 先把该订单的 `reserved` 核销置 `expired`（名额**立刻**放出来），再把订单置
> `failed` —— 见 `server/src/billing/pricing-store.ts` 的 `failOrder`，
> 以及 [pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7 第 10 条。
> 收银台在通道侧下单失败时调用它（`server/src/billing/checkout.routes.ts`），
> 测试断言失败后券的 `reserved` 名额被释放。

（原记录：`failOrder` 只把订单改成 `failed`、**不动核销行**。那条 `reserved` 会由
`expireStaleOrders` 在 `reserved_until` 到点后放掉，所以名额**不会永久泄漏**，
但会被占住最长一个支付窗口（2 小时）。

⚠️ 由此 `expireStaleOrders` 返回的 `redemptions` **可能大于** `orders`
（一个 `failed` 订单的核销行也会被扫成 `expired`）。这是**对的**：
若改用 `reversed`，因为 `reversed` 是计数的，名额反而**不会**放出来。）

### 5.2 `check:pricing` 接进 `pnpm check`

门禁与探针都能跑，但 `package.json` 的 `check` 链路里没有它们。
要加的是（见 `docs/reference/pricing-and-coupons.md` §7）：

```
"check:pricing": "node scripts/check-pricing-consistency.mjs",
# 并把 && pnpm check:pricing 追加进 "check"
"verify:i18n-failures": "node scripts/verify-i18n-failures.mjs",
```

🔴 **`package.json` 现在被另一条工作流改着（`M package.json`，+6/−2）。**
不要直接改它，要么先跟人确认，要么把改动报告出来由人合并。
`verify:i18n-failures` 耗时较长（全组 >60s），适合 CI 独立作业，
**不要**放进 `pnpm check`。

### 5.3 运营 CLI

`server/scripts/pricing.ts show | set-price | coupon-upsert | coupon-disable`，
包一层 `pricing-store.ts` 的三个写入口。要求：

- 参数解析抽成**可测的纯函数**（`server/tests/` 里给它一个 spec）。
- `set-price` 必须打出一版前后对照 + 新版的生效时刻。
- ⚠️ `server/tsconfig.json` 的 `include` 覆盖 `scripts/**`、`rootDir: "."`，
  所以脚本编译到 `dist/scripts/`（`monitor` 等已有先例）。
- ⚠️ 支付通道未接线时它**无法端到端验证**。所以要么等 5.1 做完再加，
  要么明确在报告里写"只验证了参数解析与写库调用形状"。

### 5.4 真库上的行锁并发验证（补上 §7 的第 1 条缺口）

`billing-pricing-store.pglite.spec.ts` 只能给**顺序**语义与**机制形状**，
因为 PGlite 是单连接。要真验证"两个并发预留抢最后一张券"，
需要真 PostgreSQL：

- 落点：`server/tests/integration/`（已有 18 个同类 spec）。
- 内容：两个并发事务同时预留限量 1 张的券 → 断言**恰好一个成功**、
  另一个要么阻塞后失败、要么拿到 `CouponQuotaExceededError`。
- 需要在 `server/package.json` 的 `test:integration:postgres` 里注册文件
  → 🔴 **`server/package.json` 也被另一条工作流改着**，同样先确认再动。
- 做法参考 `tests/integration/registration-races.integration.spec.ts`。

## 6. 🔴 工作区纪律（多 agent 共享，实测踩过）

- **本工作流已经提交**（`2d2d4dd`）。**不要再改这批文件**，除非第 5 节明确要求。
- 工作区里此刻有**几十个别人的改动**。不要 `git commit`（不带路径）、
  不要 `git stash`、不要 `git checkout -- .`。
- 已被别人占着的（**别碰**）：`package.json`、`server/package.json`、`AGENTS.md`
  （+596 行）、`apps/mobile/**`、`packages/app-host/**`、`packages/domain/**`、
  `packages/storage/**`、`packages/i18n/**`、`apps/web/**`、
  `docs/adr/0015`、`docs/adr/0016`、**`docs/adr/0019-upload-rejection-does-not-block-download.md`**、
  `docs/runbooks/deployment.md`、`docs/runbooks/finlaw-cleanup-candidates.md`、
  `docs/plans/phase-2-multi-platform.md`、`docs/reference/architecture.md`、
  `pnpm-lock.yaml`。
- **ADR 编号**：0018 是本文这套（已提交），0019 是别人的（未提交）。
  你再写 ADR 就用 **0020**。
- **共享文件（`docs/README.md`）怎么只提交自己的行**：本工作流用的办法是
  造一份"HEAD + 我这两行"的版本，写进 object store 再塞进索引，
  工作区文件保持含所有人的行不动：

  ```
  git show HEAD:docs/README.md > /tmp/readme-head.md   # 改出 /tmp/readme-mine.md
  blob=$(git hash-object -w /tmp/readme-mine.md)
  git update-index --cacheinfo 100644,$blob,docs/README.md
  ```

  这样 `git commit` 只带你的行，别人的改动仍在工作区。
- 更省事的做法：改完**报告**，由人用显式路径提交
  （`git commit -- <paths>` 忽略暂存区、用工作区内容，所以是安全的；
  但**新文件必须先 `git add`** 才会被那个 pathspec 带上）。

## 7. 必跑（贴真实输出）

```
pnpm check                                     # 期望退出码 0
pnpm test                                      # 期望退出码 0
pnpm --filter @heyta/sync-server test          # 期望 1373 passed / 1 skipped
node scripts/check-migrations.mjs              # 若动了迁移
node scripts/check-pricing-consistency.mjs     # 期望"价格四处一致"
node scripts/verify-i18n-failures.mjs pricing  # 期望 10 个用例全绿
node scripts/verify-i18n-failures.mjs coupon   # 期望 9 个用例全绿
cd apps/landing && npx vitest run              # 期望 71 passed
```

⚠️ `verify-i18n-failures.mjs` 全组跑 >60s；**分组跑**（`… pricing`）快得多。
⚠️ 环境：`export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"` 是必须的
（新开的 shell 里 `node`/`pnpm` 不在 PATH 上）。

## 8. 🔴 交付节奏

先做 **5.1**（它是唯一一个"不做就会收错钱"的），做完跑绿、贴输出。
然后 5.2（一行配置）→ 5.3 → 5.4（需要真库，放最后）。

**每写完一个文件就确认它真的在磁盘上**，不要连着读三份文档再动手。
卡住不要停在原地：把那一处写成带 `TODO` 的明确失败路径，在报告里说明卡在哪。

## 9. 诚实要求

报告里必须**明确列出你没验证的部分**。特别是：

- 5.1 的验收是 **stub 的 fetch**，不是真商户号。**不要把"单测通过"说成"能收款"。**
- 只要 PGlite 还是单连接，"并发预留"这件事就**只能**给顺序语义 + 机制形状；
  没跑过真库就别说"并发安全"。
- Prisma 的参数绑定层（`createPrismaSqlExecutor`）**至今没有自动化覆盖** ——
  它只做转发，但"`number` → `BIGINT`、JS 数组 → `text[]` 真的绑对了吗"
  没被验证过。真库上跑一遍同名用例就能关掉这一条。
- 有券订单的**发票金额口径**（取 `final` 还是 `original`）**未与会计确认**。

## 10. 已知的周边缺口与别重复踩的坑

- **`PGlite` 单连接**：两个 `BEGIN` 无法并存。别浪费时间在它上面试真交错。
- **别在 `/tmp` 里写 pglite 脚本**：解析不到 workspace 模块
  （`ERR_MODULE_NOT_FOUND: @electric-sql/pglite`）。写成 `server/tests/` 里的
  `.pglite.spec.ts`。已有先例：`tests/array-branch-equivalence.pglite.spec.ts`。
- **"注释会污染文本匹配"这个坑已经在仓库里记过两次**
  （`scripts/check-migrations.mjs` 的 `stripComments` 注释、以及
  `billing-pricing-schema.pglite.spec.ts` 的 `MIGRATION_SQL_ONLY`）。
  写文本匹配的门禁/测试时，先剥注释。别再记第三遍。
- `prisma migrate diff` 必须用来生成迁移体；CHECK 约束手工追加在其后。
- `docs/reference/pricing-and-coupons.md` §5.1：**`expireStaleOrders` 必须真的
  作为定时任务在跑**，否则 `maxRedemptions` 只是句空话。接通道时一并把它排上去。
- `server/src/billing/wechat.adapter.ts` 里的金额粗筛
  （现在是 `verifyWebhook` 里按 `priceTable` 找 `matchedSku` 的那几行；
  ⚠️ 旧文写它叫 `knownAmounts`，**该标识符现在不存在**）
  **不能**替代 `settleOrderPaid` 的权威校验 —— 有券之后"金额是价目表里的某一个"
  两个方向都会错。注释里已写明，别把它删了也别把它当权威。

---

## 11. 付费旅程与后台的审计结论（只读审计 + 本轮修复）

> 本节回答一个具体问题：**定价的用户旅程完整吗？后台能自由改价吗？优惠模型存在吗？**
> 全部结论来自代码 / 文档实测（`file:line`），两份只读审计分别覆盖"用户旅程"与"运营后台"。

### 11.1 旅程分段表 —— 断在哪里

| # | 段 | 状态 | 证据 |
|---|---|---|---|
| ① | 落地页看到价格 | ✅ | `apps/landing/src/components/Pricing.tsx:73-82`；`packages/i18n/src/locales/zh-CN.ts:194-205` |
| ② | 点 CTA | ❌ | `Pricing.tsx:96-99` 是 `<p>` + 沙漏**不是按钮**；词条 =「即将开放」 |
| ③ | 注册 / 登录 | ⚠️ 服务端有、客户端无 | `server/src/api.ts:271,546` 有 passkey / magic-link；`apps/web` **没有 auth 目录**，只有 `SyncBar.tsx:218-248` 三个手填框。落地页 `Footer.tsx:33-43` **全是 `#` 锚点、0 条外链** |
| ④ | 选档下单 | ✅ **服务端已通** | `POST /api/billing/checkout`（`server/src/billing/checkout.routes.ts`）把 `quoteOrder` → 冻结 → `createCheckout` 接成一条（提交 `81df2e9`） |
| ⑤ | 唤起支付 | ⚠️ 通到通道口，但没配通道 | 路由确实调了 `adapter.createCheckout`；但只有 `noop` 时回 `503`，且**客户端没有付款按钮** |
| ⑥ | 支付回调 | ✅ 代码层 | `webhook.routes.ts:107`；`server.ts:500-504` |
| ⑦ | 授予权益 | ⚠️ 有实现、**仍不可达** | `apply-event.ts` 写 `status=active` + `+30 天`；`schema.prisma` **已有 `price_id` / `grants` 列**（`9684d2a`），但 webhook 路径**仍未**把待结算的支付交给 `settleOrderPaid`（[pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7 第 9 条） |
| ⑧ | 看「买了什么 / 剩多少 AI」 | ❌ | web 只有降级提示 `SubscriptionNotice.tsx`；i18n 里的额度词条**只有落地页的** `landing.pricing.hostedAi.feature2`（「每月 300 次」），**没有**「本周期已用 X / 300 次」的界面 |
| ⑨ | 续费 | ❌ | `SubscriptionNotice.tsx:12-18` 自述「现在不存在可跳转的续费地址」 |
| ⑩ | 到期降级 | ⚠️ 通但默认关 | `entitlement.ts:114-146`（半开区间，`now===end` 即过期）；`config.ts:203-205` 默认 `enabled:false`；测试只覆盖**同步** |
| ⑪ | 退款 / 取消 | ❌ | `pricing-store.ts` 「退款接口，通道尚未接线」；`wechat.adapter.ts:436-443` 空操作；退款政策未定（`subscription-boundary.md:136`） |

**三个最致命的断点**（每条都标了审计之后的变化）：

1. ~~**收银台整段不存在（④⑤）**~~ ✅ **服务端已修**：`POST /api/billing/checkout`
   （`81df2e9`）已把「报价 → 冻结 → 下单」接通。**剩下的断点是客户端与外部依赖**：
   没有「付款」按钮、也没有配真实支付通道（只见 `noop` → `503`）。
   所以"用户在界面上想付钱"这一步**仍然撞墙**，但原因从"我们没接线"
   变成了"支付商资质 + 客户端未做"。
2. ~~**¥12 那一档在代码里无法表达**~~ ✅ **已可表达**（`subscriptions.price_id` +
   `grants`，`9684d2a`）；**但"无法交付、无法计量"仍然成立** —— 服务端**没有**云端 AI
   端点、**没有**计量、**没有**一处 `deepseek` 调用（实测：`grep deepseek server/src
   packages/ai/src` 为空），所以 `hosted-ai-monthly` 被 `NOT_YET_DELIVERABLE_SKUS`
   在收银台**挡住不卖**（ADR-0023）。这一条现在是**有终点的决定**，不再是静默。
3. **从落地页到账户没有路（③）** —— 🔴 **仍然没做**：落地页 `Footer.tsx` 全是 `#`
   锚点、**0 条外链**；`apps/web/src/features/` 下**没有 auth 目录**，无注册/登录界面，
   只有 `SyncBar.tsx` 三个手填框。服务端收银台再通，新用户也到不了应用、建不了账号。

### 11.2 海外：$5 / $12 是"在卖一个买不了的东西"

`$5/$12` 有价格（`zh-CN.ts:195,205`、`price-book.ts:235`），但**没有任何 USD 通道**：
全仓只有微信 adapter，且它把币种硬编码成 `currency:'CNY'`（`wechat.adapter.ts:582`）。
文档自己承认这一点（[pricing-and-entitlements.md](../reference/pricing-and-entitlements.md) §5.2）。
**更糟**：若把 USD 单喂给现有微信通道，`amountMinor: 500` 会被当成 500 分（¥5）发出去 ——
金额单位一致，币种不一致，**没有任何一层会报错**。

### 11.3 后台：能改价，但改价会静默绕过所有门禁

**唯一的管理面是一个 CLI**（`server/scripts/pricing.ts`），本轮已接进 `package.json`。
没有 HTTP 管理接口、没有管理界面、**没有 admin 鉴权 / 角色**（`server/src` 无 role / isAdmin），
`--actor` 是自由文本**可伪造**。

三处本轮修掉的：

| 缺陷 | 后果 | 状态 |
|---|---|---|
| `check-pricing-consistency.mjs` **从不读 `price_versions`** | 只改库不改基线 → 页面印 ¥5、收银台收 ¥15，**全部门禁全绿** | 已修：CLI 在改价那一刻列出全部文案落点并置退出码 1（§6.2） |
| `pricing_audit_log` **只写不读** | "谁把 ¥12 改成 ¥15"在代码里没有答案 | 已修：新增 `loadPricingAudit`，`show` 打印最近 20 条 |
| 两处注释点名 `server/scripts/show-price.ts` —— **该文件不存在** | 遮蔽告警的最后一个落点是个幻觉 | 已修：指向真入口；`pricing-cli.spec.ts` 对清单做存在性断言 |

**本轮新发现**（详见 `pricing-and-coupons.md` §7 第 13 条）：
把某个 key 的**第一个**版本排到未来 → 造出"有版本但无一版生效"的空隙 →
`PriceNotEffectiveError`，收银台**直接拒单**。已实测，已让 CLI 当场喊出来并置退出码 1；
语义本身**未改**（属 ADR 级决定）。

### 11.4 优惠模型：**已经存在**，且比"活动"能表达的更多

`server/src/billing/coupon.ts` + `pricing-store.ts` 的 `coupon` 状态机是完整落地的。
能力清单（逐条有实现与测试）：

- **折扣形状**：百分比（基点）与固定金额两种，**只有**这两种。
  **没有**首月免费 / 试用 / 赠送时长。
- **约束维度**：有效期区间、总名额、每人名额、SKU 范围、最低订单额、
  首购限定、地区、启用开关 —— 全在。
- **`firstPurchaseOnly` 是唯一的受众维度**；一张券只能带一个码；
  **没有**把某个码绑定到某个用户的能力。

四个真实活动的可行性：

| 活动 | 可行？ | 说明 |
|---|---|---|
| 首发 5 折 7 天 | ✅ | 两个维度都直接支持 |
| 前 100 名立减 ¥12 | ❌ | 立减被钳到 0 → `not_chargeable_after_discount`（¥12 档减 ¥12=0） |
| 老用户续费 9 折 | ⚠️ | **没有 cohort 定向**（无"仅老用户"维度） |
| 一码一用发 50 人 | ⚠️ | 需要 50 张**各自独立**的券（码与券是 1:1） |

**未测路径**（别当成已验证）：时钟回拨（`coupon.ts:390-391`）、
后台改券（含把 `maxRedemptions` 调到已用量以下）、`afterExpiry` / `quotaExceeded`
两个超发分支。

**该不该留**：¥5/月的客单价下，券系统的运营复杂度（13 个拒绝原因、名额并发、时钟敏感性）
是否划算，是个**未决的产品问题** —— 不是技术问题。

### 11.5 按价值排序的剩余工作

1. **接上收银台**（④⑤）—— 见第 5.1 节，`createCheckout` 已就绪，缺的是路由 + 客户端按钮。
   没有这一步，"定价策略"再对也没有一分钱收入。
   - ✅ **已做（服务端路由）**：`POST /api/billing/checkout` ——
     `server/src/billing/checkout.routes.ts`，`quoteOrder` → 冻结 →
     `adapter.createCheckout` 一条链，需认证；金额只从服务端报价来，
     通道失败时 `failOrder` 释放券名额；不可交付的档（`hosted-ai-monthly`）
     在报价之前回 `409`。12 例测试跑真 SQL（PGlite）。
     详见 [pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7 第 18 条。
   - ❌ **仍缺**：客户端的"付款"按钮（web + 移动端）——**没有它用户还是走不到**。
     ⚠️ 但这个按钮应当**和支付通道一起**落地，不要提前加：现在加，它必然回
     `503 BILLING_PROVIDER_NOT_CONFIGURED`，也就是正好造出落地页明确反对的那个
     东西 —— 一个点了没反应的"立即购买"（见 `apps/landing/src/components/Pricing.tsx`
     文件头）。所以"用户能走完"这一步现在卡在**外部依赖**（支付商资质）上，
     不在我们这边：服务端那条路已经通了，`curl` 得到一张真的收款码参数。
   - ✅ **已做**："交付"半段。webhook 把带订单号的支付交给
     `settleOrderPaidInTransaction`，**落在它已有的那个 `prisma.$transaction` 里**；
     `applySettlementToEvent` 按结论决定写不写权益（`granted` → 用**订单冻结的**
     `grantsForSku(priceId)` **覆盖** adapter 的金额启发式；`already-paid` /
     `amount-mismatch` / `order-not-grantable` → 一个字节都不写；`unknown-order`
     是唯一回落的结论）。`NormalizedPaymentEvent.outTradeNo` 由 adapter 显式给出，
     不再从 `providerEventId` 反解。**用了券的单不再"收得上钱、授不出权益"。**
     回归证据：`server/tests/billing-webhook-settlement.pglite.spec.ts`（14 例真 SQL）；
     非空转由**四次故障注入**证明（改 adapter 的 `outTradeNo`、把写入的 `grants`
     改成并集、删掉 `SELECT` 里的 `price_id`、停掉 webhook 的结算调用点 → 各自变红）。
     详见 [pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7 第 9 条。
   - ❌ **仍缺（属对账，不属"接线"）**：**退款/拒付侧**没接（`reverseOrderOnRefund`
     仍零生产调用方，退款事件在 `unsupported-event-type` 就被挡）；
     **存量回填**没做（接线前已付款但未结算的订单，重投会被幂等挡住，不会补结算）。
2. **让 ¥12 可交付**（⑦⑧）
   - ✅ **已做**：`Subscription.price_id` + `grants` 列 + 迁移
     `20260929000000_add_subscription_grants`（含 `['hosting']` 回填，否则开关一打开
     已付费用户会被当场拒绝）+ 权益按 `grants` 分支（`evaluateCapability`）。
     `¥5` 与 `¥12` 从此在代码里真的可分。
   - ✅ **已做（决定）**：云端 AI 端点 + 300 次/月 计量**本轮不实现**，
     由 [ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md) 记录，
     含**最小实现清单**与硬约束「计量存在之前 `hosted-ai-monthly` 不得被售卖」；
     `pnpm check:ai-quota` 把承诺的数字与状态绑起来。
   - ❌ **仍缺**：端点、计量、设置页的「本周期已用 X / 300 次」（法务 §5.3 承诺了它）。
   **在计量落地之前不要放开 ¥12 的售卖**：收了钱交付不了。
3. **落地页 → 应用 → 账户的路**（③）—— 落地页外链 + web 注册/登录。
4. **运营身份与鉴权**（§11.3）—— 目前改价 = 服务器 shell 权限，审计不绑定已认证身份。
   **唯一管理入口**是 `server/scripts/pricing.ts`（`pnpm --filter server pricing`），
   它**没有**鉴权、**没有**角色、**没有** HTTP 面 —— 见
   [pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7 第 14 条。
   在有意引入 admin 路由之前，这条缺口应当保持**显式**，而不是被一个"内网就安全"的假设盖住。

5. **海外通道**（§11.2）—— 通道未定前，落地页的 `$5/$12` 要么标注"仅限中国区"，
   要么先撤掉；同时给金额加**币种断言**（现在 USD 单会被微信通道按 CNY 发出去）。

## 12. 本轮收尾状态

> 这一节只记**可操作状态**，供下一次会话零上下文接手。事实与假设分开写。
>
> 🔄 **2026-09-27 接手会话见 §12.5。**
> 🔴 **代码完成度状态表在 §12.5.4** —— 结论：**本任务书 §12.3 范围内没有未完成的代码工作**，
> 剩下的全是「外部阻塞 / 业主决定 / ADR 级语义」。验证状态也在那一节分开列了。

### 12.1 事实

- **交付半段已接通并提交。** 工作区 `HEAD = 77b4e25`，与 `origin/main` 同步。
  ⚠️ 实现本身来自**并行的 `ws/billing-settle` 工作流**（merge `42bee60`）；
  本轮的贡献是**独立复核 + 补上可失败证据 + 修正四处过时文档**（提交 `77b4e25`）。
- **验证**：16 道门禁逐条 PASS（`check:migrations` / `layering` / `widgets` /
  `ui-language` / `licenses` / `docs` / `pricing` / `ai-quota` / `design` / `tokens` /
  `arkts` / `native-deps` / `mobile-bundle` / `materialized-reads` / `ai-coverage`…）；
  `server` 72 文件 / **1468 passed | 1 skipped**；billing 相关 101 例全过。
- 🔴 **整条 `pnpm check` / `pnpm test` 当前是红的，但红在别处。** `apps/desktop`
  的 typecheck/test 与 `check:ai-e2e` 失败，原因是另一个 agent 正在做的桌面壳还是
  **未提交**状态：`apps/desktop/*` 是 modified，`renderer/main.tsx`、
  `tsconfig.renderer.json`、`e2e/tests/desktop-window.spec.ts` 还是 untracked。
  已在 HEAD 的干净 worktree 上实测：`apps/desktop` typecheck `exit 0`、
  vitest `11 passed`（脏工作区里是 `1 failed | 10 passed`），且那个 e2e spec 在 HEAD
  根本不存在。**即已提交状态下整条链是绿的。**
  ⚠️ **不要为了让门禁变绿去动那些文件** —— 那是别人的在途工作。
- 客户端「付款」按钮**仍未加**，这是**故意**的（见 §11.5 第 1 条）。

### 12.2 假设（未验证）

- 桌面壳工作流提交后，整条 `pnpm check` / `pnpm test` 会回到全绿。**未实测**，
  因为无法预知那位 agent 何时提交、提交后是否自洽。

### 12.3 按顺序的下一步

> 🔄 **2026-09-27 接手会话的进展见 §12.5。** 下面五条里 1 / 3 / 4 / 5 都已有结论。

1. 等桌面壳提交后，重跑 `pnpm check` 与 `pnpm test`，确认全链绿。
   ⚠️ **仍未达成，但红点已变**：见 §12.5 第 1 条。
2. 客户端「付款」按钮 —— **只在支付通道就绪时**加，否则必然 `503` 死按钮。
   **仍然不动**（外部资质未落地）。
3. 退款/拒付侧接线（`reverseOrderOnRefund` 目前零生产调用方）。
   ✅ **已有结论：本轮不做**，见 [ADR-0026](../adr/0026-refund-side-entitlement-revocation-not-implemented.md)
   —— 真阻塞不是"没接线"，而是**权益模型无法表达"退哪一笔"**。
4. 存量订单回填（对账任务）。✅ **判定为「不适用」**（0 行数据），见
   [pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7 第 20 条。
5. 海外通道与币种断言（§11.5 第 5 条）。
   ✅ **币种断言已做**（三层：契约必填 / adapter 声明与执行同源 / 收银台冻结前选通道）；
   ⚠️ **落地页 `$5/$12` 文案未动**（业主/市场决定，且落地页已如实标注买不到）。
   见 [pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7 第 19 条。

### 12.4 别重复踩的坑

- ❌ **不要用 `git checkout <file>` 还原故障注入** —— 它会连带毁掉未提交的新增。
  用 `/tmp` 备份 + `md5 -q` 核对还原。
- ❌ **不要 `git add -A`。** 这是多 agent 共享工作区，别人正在写文件；
  只用**显式路径列表** staging，再用 `git show :<path> | diff -q - <path>` 核对
  index 与工作区一致。
- ❌ 本仓库这个 git 版本里 `git apply --cached` 与 `git commit --only <paths>` 都不可靠
  （后者会用工作区内容绕过 index）。正常 `git add` 显式路径 + 普通 `git commit`。

### 12.5 2026-09-27 接手会话的增量

> 🤝 **本节的写法与 12.1 一致：事实与假设分开，红就是红。**
> 会话起点 `HEAD = a410e58`（比 §12.1 记的 `77b4e25` 前进了**很多**提交，
> 且工作区里有**另一条**工作流未提交的组件工作 —— `packages/widget-core`、
> `apps/mobile/*`、`packages/app-host/*`、根 `package.json`、`docs/README.md`）。
> 本会话**没有提交任何东西**（多 agent 共享工作区，提交留给业主）。

#### 12.5.1 事实

1. 🔴 **`pnpm check` 仍然是红的，而且红点换了一个地方。**
   本会话实测 `pnpm check`：`check:ai-e2e` 的 `e2e/tests/desktop-window.spec.ts`
   两条用例 `Page crashed`（开发构建与打包产物各一条），
   `2 failed | 24 passed` → `exit 1`。
   ✅ **但这是整条链上唯一红的一道**：`check` 是 `&&` 串起来的
   （`build` → `typecheck` → `check:migrations` → `layering` → `widgets` →
   `ui-language` → `licenses` → `docs` → `pricing` → `ai-quota` → `design` →
   `tokens` → `arkts` → `native-deps` → `mobile-bundle` →
   `materialized-reads` → `ai-coverage` → `ai-e2e`），
   而 `check:ai-e2e` **确实跑到了**（上面那两条失败就是它打的）——
   也就是说**它前面的 16 道全部退出 0**。这是 `&&` 链的性质，不是印象。
   即 §12.2 那条假设**没有被证实**：桌面壳工作流的文件**仍在**工作区里未提交
   （`apps/desktop/package.json`、`renderer/main.tsx`、`src/main.ts`、
   `tsup.config.ts`、`e2e/tests/desktop-window.spec.ts` 都是 modified）。
   **本会话没有动这些文件**（§12.4 的纪律 + §6 的占用清单）。

   ✅ **但 `server` 侧是绿的**：`server` 全量单测 **72 文件 / 1478 passed | 1 skipped**；
   `npx tsc --noEmit -p server/tsconfig.json` → `TSC_OK`；
   `node scripts/check-pricing-consistency.mjs` → `exit 0`。
   ⚠️ 这是**快照**：同一时间另一条工作流正在改 `webhook.routes.ts`（见本节第 8、9 条），
   所以 1478 这个数只代表**那一刻**的树，不代表它不会被对方的下一次编辑改动。

2. ✅ **① 币种断言已落地**（洞是"USD 单被微信通道按 CNY 静默发出去"）。
   三层：`CreateCheckoutInput.currency` 必填 / `BillingAdapter.supportedCurrencies`
   必填且 adapter 用**同一个常量**在任何网络调用前拒 / 收银台**在冻结之前**按币种选通道并回
   `409 PROVIDER_CURRENCY_UNSUPPORTED`。两次注入各自变红、还原后逐字节一致。
   详见 [pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7 第 19 条。

3. ✅ **③ 行锁并发 spec 已注册进 CI，而且注册这一步本身就修好了一条长期的红。**
   `server/package.json` 的 `test:integration:postgres` 现在包含
   `coupon-quota-race.integration.spec.ts`。实测（本地真 PostgreSQL **15.13**，
   经 `sh scripts/migrate-deploy.sh` 应用 38 个迁移的新库）：
   - 该 spec 单跑 → **3 passed**；
   - 整条 `pnpm test:integration:postgres` → **16 passed | 3 failed**，**失败的三条与本轮无关**
     （`migrate-deploy-lock-retry` / `old-ops-boundary-plan` /
     `operations-autovacuum-reloptions`）。其中
     `operations-autovacuum-reloptions` 是**环境**原因：它断言
     `server_version_num >= 160000`，而本机 :5432 上的服务端是 **15.13**
     （`psql --version` 报 17.9 的是**客户端**）—— 仓库声明的下限是 16。
   - 🔴 **该 spec 从 ADR-0020 改 SKU 那天起一直是红的**：它还在用
     `priceId: 'annual'`，那个 SKU 早已不存在。**因为 CI 不跑它，没人发现。**
     已改成 `hosted-monthly`，并重新证明非空转（剥掉券行 `FOR UPDATE`
     → `2 failed | 1 passed`）。
     ⚠️ 第一次注入**打错了目标**（那个 SQL 模式在文件里出现两次）——
     差点把"注入打偏"误判成"用例空转"。**注入必须按唯一上下文定位。**
4. ✅ **④ 存量订单回填：判定「不适用」**。证据：本机整个 PostgreSQL 实例（62 个库）
   里只有**本轮为验证新建的那个**库有 `checkout_orders`；四个 `heyta_*` 库连计价表都没有；
   `WECHAT_PAY_ENABLED` 未设 → 只有 `noop`。**0 行数据**，见 §7 第 20 条。
5. ✅ **② 退款/拒付侧：本轮不做，写成 ADR**（[ADR-0026](../adr/0026-refund-side-entitlement-revocation-not-implemented.md)）。
   **这是本会话最重要的发现**：handoff 把这条描述成"没接线"，但真阻塞是
   **权益模型里没有"哪一笔支付买了哪一段"**（`Subscription` 一行 + 单个
   `currentPeriodEnd`；能力**替换**、支付**叠加**；`findFirst` 定位，
   连 `@@unique([userId, provider])` 都没有）。所以"退第 2 笔、保留第 1 笔"
   **无法表达**，按笔回收的最小单位是**整行** = **过度回收**。
   业主在"只接订单侧（半真状态）/ 写 ADR（选它）/ 全量建账本"三条里选了**写 ADR**。
6. ⚠️ **落地页海外文案未动**（`$5/$12` 仍在），因为落地页**已**如实标注两个付费档买不到
   且**不放按钮**，所以缺口是文案级的；撤掉或标注"仅限中国区"属市场/业主决定。
7. 🔴 **顺手发现并修好了一条"死了很久"的检查**：`verify-i18n-failures.mjs` 的
   `coupon` 组第 ⑧ 例（"去掉结算的幂等闸 → 重复投递重复授予"）锚点**连缩进一起写死**，
   而 `pricing-store.ts` 的函数体后来被重新缩进过，于是它再也匹配不上 ——
   也就是说**幂等闸这条检查自己在很长一段时间里什么都没保护**。
   已改成只取唯一的那行 `if (status === 'paid') {`；修后 `coupon` **9/9**。
   ⚠️ 这组**不在** `pnpm check` 里，所以它变红拦不住任何人。
   详见 §7 第 21 条。
8. ⚠️ **一次并发碰撞，记下来当教训**：本会话中途看到 `webhook.routes.ts` 里多了一行
   `import type { ApplyPaymentEventDeps }`（**只在 import 语句里出现、别处没用**），
   当时判断成"残留的半截改动"，于是把它还原成 HEAD 的单行 import，
   并确认过那一刻 `git diff --stat` 是干净的。

   🔴 **判断错了。** 几分钟后再看，那个文件已经被改成一大段重构
   （抽出 `settleAndApplyEvent` / `buildSubscriptionApplyDeps`，注释指向一个
   还不存在的 `reconcile.ts`）—— 也就是说，那行 import 是**另一条正在写
   "对账 / 补结算"的工作流**改到一半时的中间态，**不是我的残留**；
   我看到的"干净"只是它两次编辑之间的一个瞬间。（当前该文件 `tsc --noEmit`
   通过，说明对方已经写完整。）

   👉 **教训（比代码本身值钱）**：在多 agent 共享工作区里，
   **"看起来像残留的 diff" 也可能是别人正在写的中间态**。
   判据不是"这行有没有用"，而是"**这个文件是不是我正在负责的**"——
   `webhook.routes.ts` 本会话**只读不写**，本来就不该去动它。
   因此：**停留在该文件上的一切改动都不属于本会话的变更集**，
   接手时请按"另一条工作流在做对账"来看它。
9. 👀 **另一条工作流正在做 §12.3-4 的对账/补结算**（`webhook.routes.ts` 已抽出
   `settleAndApplyEvent`，注释指向 `reconcile.ts`；目标是"webhook 与对账共用
   唯一一份业务逻辑"）。这与 §12.5.1 第 4 条**不冲突**：第 4 条说的是
   "**现在**没有可回填的数据（0 行）"，而不是"这件事不该做"。
   ⚠️ 只是**别把那份工作记成本会话做的**。

#### 12.5.2 假设（未验证）

- **微信退款通知的真实载荷与幂等键未核实**（ADR-0026 §6 记着）——
  本会话没有对着官方文档逐字段核对，也没有一笔真实退款通知。
- **`@@unique([userId, provider])` 的缺失是否刻意**，未核实。它可能是一个独立的
  真问题（"一行一用户"只是意图，没有被约束保证），但**不要在 ADR-0026 里顺手加**。
- **桌面壳提交后整条链会全绿**：**仍未实测**（§12.2 的假设原样保留，且本次实测反而
  显示它的文件还在工作区里）。
- **本机集成测试不能代表 CI**：服务端是 PG **15.13**，而仓库下限是 **16**。
  凡是依赖 PG 16 行为或 vacuum 状态的用例（即 12.5.1 第 3 条里那三个失败）
  在**本机红不代表 CI 红**，反之亦然。**本会话没有在 PG 16 上验证过它们。**

#### 12.5.3 下一会话第一件事

1. 桌面壳那批文件提交后重跑 `pnpm check` / `pnpm test`，确认 §12.2 的假设。
2. 若要推进退款：**先做 ADR-0026 §5 第 1 条**（权益粒度：账本 vs 政策）。
   在那之前不要写退款 handler。
3. 若要卖海外：**先定通道**，再改落地页文案（`$` 价现在是"写得出、买不了"）。

#### 12.5.4 代码完成度状态表（本任务书 §12.3 的范围）

> 判据：**"代码工作"= 需要改 `server/` / `scripts/` 下源文件的事。**
> 配置、资质、文案、ADR 级语义决定**不算**代码工作 —— 它们在"非代码阻塞"一节。
> 结论：**§12.3 范围内没有任何未完成的代码工作。**

| §12.3 | 事项 | 代码 | 验证 | 非代码阻塞 |
|---|---|---|---|---|
| 1 | 等桌面壳提交后重跑门禁 | — 不属本任务书代码 | ✅ 已跑：16 道绿，仅 `check:ai-e2e` 红（对方的文件） | 桌面壳那批文件**仍**未提交 |
| 2 | 客户端「付款」按钮 | ⛔ **不做** | — | 🔴 **外部资质**：无支付商资质 = 必然 `503` 死按钮；且 `apps/web/**`、`apps/mobile/**` 属他人占用（§6 白名单外） |
| 3 | 退款/拒付侧接线 | ⛔ **不做**（业主选 B，[ADR-0026](../adr/0026-refund-side-entitlement-revocation-not-implemented.md)） | — | 🔴 权益模型**无法表达"退哪一笔"**（写代码必然过度回收）+ 退款政策未定 |
| 4 | 存量订单回填 | — **不适用**（0 行数据，§7 第 20 条） | — | 真通道上线**且**在回填前产生过订单时才需要 |
| 5 | 海外通道与**币种断言** | ✅ **已做**（币种断言三层） | ✅ 单测 + 两次注入 | ⚠️ 落地页 `$5/$12` 文案 = 业主/市场决定，且词条在 `packages/i18n`（占用） |

**本会话额外完成的代码工作**（不在 §12.3 字面上，但属同一片区域）：

| 事项 | 代码 | 验证 |
|---|---|---|
| ③ `coupon-quota-race` 注册进 CI **并修掉它长期变红的 `'annual'` SKU** | ✅ | ✅ 真库 3 passed；剥掉券行 `FOR UPDATE` → 2 failed |
| 修复 `coupon` 探针里**长期失效**的结算幂等闸锚点（§7 第 21 条） | ✅ | ✅ `coupon` 9/9 |

**明确"不是代码工作"的剩余项**（别再当成待写的代码）：

| 事项 | 性质 |
|---|---|
| 云端 AI 端点 / 300 次计量 / 设置页用量 | ⛔ 按 [ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md) **本轮不实现**，含最小实现清单；硬约束「计量存在前不得售卖 `hosted-ai-monthly`」 |
| 价格空隙语义（§7 第 13 条：某 key 的**第一个**版本排到未来） | ⛔ **需一条 ADR**（动的是"按哪个数收钱"）；已用 CLI 当场喊红 + 退出码 1 兜住 |
| admin 鉴权 / 角色 / HTTP 管理面（§7 第 14 条） | ⛔ 明确**超出**"定价一致性"范围，已如实记为缺口 |
| 发票金额口径（`final` vs 原价） | ⛔ 需**会计确认**（§7 第 4 条） |
| 微信 ¥0 订单是否被接受、商家券资质 | ⛔ 需**真实商户号 + 官方渠道**验证（§7 第 6、7 条） |
| 行为级对账（`reconcile.ts`） | 👀 **另一条工作流在做**（见 §12.5.1 第 9 条），不记在本会话名下 |

**验证状态（本会话已跑 vs 未跑）**：

- ✅ 已跑：`server` 全量单测 72 文件 / 1478 passed | 1 skipped；`tsc --noEmit` `TSC_OK`；
  `check:pricing`、`check:docs` 绿；`pnpm check` 除最后一道 `check:ai-e2e` 外全绿；
  `verify-i18n-failures.mjs pricing`（16/16）与 `coupon`（9/9）；
  真 PostgreSQL 上 `pnpm test:integration:postgres`（该 spec 3 passed，整条 16/19）。
- ⚠️ **未跑 / 跑不了**（**不要**把上一条读成"能收款"）：
  没有任何**真实支付商网络调用**（adapter 仍是 stub `fetchImpl`）；
  没有**真实商户号/密钥**；没有一笔**真实支付或退款通知**；
  集成测试跑在 **PG 15.13** 而仓库下限是 **16**；
  `recurrence` 等其余 9 组故障注入探针**没跑**；
  桌面壳提交后的整链绿**仍未证实**。

