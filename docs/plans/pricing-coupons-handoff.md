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
`pnpm check` 与 `pnpm test` 全绿。剩下的是把它接到收银台上：
**adapter 现在仍然按价目表全额下单，完全不认识券** —— 第 5.1 节是本节最有价值的部分。

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

落地页（`apps/landing`）**不需要改**，也**不要改**：价格没变（¥99/$49），
门禁证明了三处仍然一致。它的 71 个测试与 `pnpm check` 都是绿的。

## 2. 必读（按顺序）

1. `docs/adr/0018-adjustable-pricing-and-coupons.md` —— 为什么这么设计、否决了什么。
2. `docs/reference/pricing-and-coupons.md` —— 代码现在长什么样；**§7 是未验证项清单**（你做完一件事就去那里划掉一条）。
3. `docs/adr/0017-single-paid-tier-and-payment-channel.md` —— 一档到底、¥99/$49、自建免费、支付通道选择。
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

### 5.1 🔴 adapter 必须收「冻结后的实付金额」，而不是价目表全额

**这是现在最要命的洞。** `createWechatBillingAdapter` 的 `createCheckout` 用的是：

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

#### 5.1.1 `failOrder` 之后名额会怎样（别把它当 bug）

`failOrder` 只把订单改成 `failed`，**不动核销行**。那条 `reserved` 会由
`expireStaleOrders` 在 `reserved_until` 到点后放掉，所以名额**不会永久泄漏**，
但会被占住最长一个支付窗口（2 小时）。

⚠️ 由此 `expireStaleOrders` 返回的 `redemptions` **可能大于** `orders`
（一个 `failed` 订单的核销行也会被扫成 `expired`）。这是**对的**：
若改用 `reversed`，因为 `reversed` 是计数的，名额反而**不会**放出来。

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
node scripts/check-pricing-consistency.mjs     # 期望"价格三处一致"
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
- `server/src/billing/wechat.adapter.ts` 里的金额粗筛（`knownAmounts`）
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
| ④ | 选档下单 | ❌ | 无 checkout / quote / orders 路由；`createOrderWithReservation` 只被测试调用 |
| ⑤ | 唤起支付 | ❌ 不可达 | `wechat.adapter.ts:549` `createCheckout` 已实现、`registry.ts:62-80` 可注册，但**没有任何路由调它** |
| ⑥ | 支付回调 | ✅ 代码层 | `webhook.routes.ts:107`；`server.ts:500-503` |
| ⑦ | 授予权益 | ⚠️ 有实现、不可达 | `apply-event.ts:122-174` 写 `status=active` + `+30 天`；`schema.prisma:162-202` **无 plan / grants 列** |
| ⑧ | 看「买了什么 / 剩多少 AI」 | ❌ | web 只有降级提示 `SubscriptionNotice.tsx`；i18n 里**没有任何额度词条** |
| ⑨ | 续费 | ❌ | `SubscriptionNotice.tsx:12-18` 自述「现在不存在可跳转的续费地址」 |
| ⑩ | 到期降级 | ⚠️ 通但默认关 | `entitlement.ts:114-146`（半开区间，`now===end` 即过期）；`config.ts:203-205` 默认 `enabled:false`；测试只覆盖**同步** |
| ⑪ | 退款 / 取消 | ❌ | `pricing-store.ts` 「退款接口，通道尚未接线」；`wechat.adapter.ts:436-443` 空操作；退款政策未定（`subscription-boundary.md:136`） |

**三个最致命的断点**：

1. **收银台整段不存在（④⑤）** —— 用户在"想付钱"处直接撞墙，付费转化率恒为 0。
   且这不是"资质在等"：`createCheckout` 已经写好却**没有一行路由接它**，属工程未接线。
2. **¥12 那一档在代码里无法表达、无法交付、无法计量（⑦⑧）** —— 即使打通支付，
   `hosted-ai-monthly` 与 `hosted-monthly` 会落成**同一行订阅**（无 plan 列），`ai` 授权无处存储；
   服务端**根本没有云端 AI 端点**（`server/src` 无 AI 路由，`packages/ai/src` 无 quota 字样）。
   用户付 ¥12 拿到的东西与 ¥5 完全一样，且没有任何代码能发现发错了货 ——
   **收了钱交付不了，是收钱路径上最坏的一种静默。**
3. **从落地页到账户没有路（③）** —— 落地页 0 条外链、web 应用无注册/登录界面。
   收银台明天上线，新用户也到不了应用、建不了账号。

### 11.2 海外：$5 / $12 是"在卖一个买不了的东西"

`$5/$12` 有价格（`zh-CN.ts:195,205`、`price-book.ts:184-200`），但**没有任何 USD 通道**：
全仓只有微信 adapter，且它把币种硬编码成 `currency:'CNY'`（`wechat.adapter.ts:581`）。
文档自己承认这一点（`pricing-and-entitlements.md:124-131`）。
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
