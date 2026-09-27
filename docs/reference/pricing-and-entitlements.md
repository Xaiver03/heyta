# 价格与权益

> 这份文件是**价格与权益的工程参考**，不是营销文案。
> 决策与理由见 [ADR-0020](../adr/0020-ai-subscription-two-tiers.md)
> —— 它**取代**了 [ADR-0017](../adr/0017-single-paid-tier-and-payment-channel.md)
> 的价格与周期结论（ADR-0017 的「自建永久免费」「不自动续费」仍然有效）；
> 「收费的是服务器不是功能」这条产品边界见
> [subscription-boundary.md](../plans/subscription-boundary.md)。
>
> 最后核对：2026-09-27。

---

## 1. 一张表（两个付费档，都是月付）

| 档位 | priceId | 币种 | 价格 | 计费方式 | 授予 | 现在能买吗 |
|---|---|---|---|---|---|---|
| **开源档**（自建 / 自托管） | — | — | **免费** | 永久，**且不校验** | **除云端 AI 外**的全部能力 | ✅ 可以 |
| **官方托管 · 大陆** | `hosted-monthly` | CNY | **¥5 / 月** | 按月付，**不自动续费** | `hosting` | 🔴 **还不能**（见 §5.1） |
| **官方托管 · 海外** | `hosted-monthly` | USD | **$5 / 月** | 按月付，**不自动续费** | `hosting` | 🔴 **还不能**（通道未开） |
| **官方托管 + 云端 AI · 大陆** | `hosted-ai-monthly` | CNY | **¥12 / 月** | 按月付，**不自动续费** | `hosting` + `ai` | 🔴 **还不能** |
| **官方托管 + 云端 AI · 海外** | `hosted-ai-monthly` | USD | **$12 / 月** | 按月付，**不自动续费** | `hosting` + `ai` | 🔴 **还不能** |

- **恰好两个 SKU，没有第三个。** 门禁断言"恰好 2 个"（`EXPECTED_SKU_COUNT`），
  不是"至多 2 个" —— 多一个就红。
- **开源档就是那一档免费档，不存在"更便宜的付费档"。** 自建自托管**永久免费、不校验**，
  拿到的是**除云端 AI 之外的全部能力** —— 云端 AI 本来就必须跑在我们的服务器上，
  自建拿不到它不是因为被阉割，而是因为它物理上不在你那边。
- **没有任何功能是被钱锁住的。** 两个付费档卖的只有两件东西：我们替你运维那台服务器
  （`hosting`），以及**我们这台的**云端 AI（`ai`）。自带端点的 AI 两个付费档都不涉及，
  永远免费、不限次。
  （为什么功能不能出现在收费清单上：见 ADR-0020 §3.2、§3.4。）
- **周期是月，不是年。** 一次支付 = **30 天**（`SUBSCRIPTION_PERIOD_DAYS`），
  到期前提醒手动续费。ADR-0017 的 ¥99/年、$49/年、`annual` priceId **全部作废**。
- **按月付而不是按年付**，是产品决策（ADR-0020 §2.2）：¥5 的决策成本足够低，
  而年付要求用户在没体验过托管的情况下预付 12 倍的钱。
- 到期**不锁本地数据、不删服务端数据**（硬约束，见
  [subscription-boundary.md](../plans/subscription-boundary.md) §2）。
- **开源 / 自建就是那一档免费档 —— 没有单独的「开源作者优惠」。**
  常见的「学生档 / 教育优惠 / 开源作者折扣」这里**都不做**，四条理由：
  1. **免费已经是底线，不能再便宜。** 开源用户要的那个"免费"**已经给了**：
     自建那一栏永久免费、全部非 AI 能力、且不校验。再设一个"开源作者档"，
     等于给已经在免费的人再打个折 —— 折的是 0。
  2. **任何"减价档"都会造出第三个 SKU。** 断言是"**恰好** 2 个"
     （`EXPECTED_SKU_COUNT` = 2）；而"学生半价"在计费系统里是一个**独立的
     价目表条目**，不是打折标记 —— 加进去门禁直接红。
  3. **学生档的运营成本比 ¥5 高。** 要回答"谁算学生"（学信网？学校邮箱？）、
     "核验失败怎么办"、"每年要不要重核"、"被绕过算谁的" —— 这套流程的开发与
     客服成本，会超过这些用户一年交的钱。而他们真正需要的多半是**免费那条路**，
     不是折扣。
  4. **付费档收的从来不是功能，是运维。** ¥5 卖的是"我们替你运维那台服务器"；
     对本来就没有服务器的人减价，等于把唯一的收入来源去掉。

  ⚠️ 想**改**这个决定，入口是 [ADR-0020](../adr/0020-ai-subscription-two-tiers.md)
  的"两档"，**不是**在这张表里加一行 —— 加行会被门禁拦下。

## 2. 权益对照

| 项 | 开源档（免费） | 官方托管 ¥5/月 | 托管 + 云端 AI ¥12/月 |
|---|---|---|---|
| 应用本体（任务 / 四象限 / 习惯 / 专注 / 时间线） | ✅ 全部 | ✅ 全部 | ✅ 全部 |
| AI（**自带密钥**） | ✅ 全部，**不限次** | ✅ 全部，**不限次** | ✅ 全部，**不限次** |
| **官方托管同步** | ❌ 不可用（用你自己的服务器） | ✅ 可用 | ✅ 可用 |
| **我们的云端 AI** | ❌ 需自备端点 | ❌ 需自备端点 | ✅ **每月 300 次** |
| 同步设备数 | ✅ 不限（你自己的机器，你说了算） | ✅ 不限 | ✅ 不限 |
| 服务端 op 保留 | ✅ 完整（不删） | ✅ 完整（不删） | ✅ 完整（不删） |

🔴 **自带密钥的 AI 两个付费档都不涉及，永远免费、不限次。** 收费的从来不是
"AI 功能"，而是"由我们的服务器代为转发到模型"这一件事。你随时可以关掉它改用
自己的端点，功能一个不少。

⚠️ **我们的云端 AI 不是端到端加密的**（ADR-0006 / ADR-0020 §3.4）：
要让我们的服务器把内容送给模型，就必须先解开它。这一点必须在对外文案里
**明确说出来**，`scripts/check-ai-coverage.mjs` 会强制断言那句否定
（`不受端到端加密`）。

### 2.1 🔴 「300 次/月」的当前状态：**已声明、未实现**

```json ai-quota-ssot
{
  "quota": 300,
  "unit": "次 / 计费周期",
  "enforcement": "not-implemented",
  "decidedIn": "docs/adr/0023-managed-ai-quota-not-implemented.md"
}
```

**这个块是额度数字的唯一事实源。** 中英词条、法务、以及本文件正文里的那个数字
都必须与它相等 —— 由 `pnpm check:ai-quota` 强制
（`scripts/check-ai-quota-consistency.mjs`）。

🔴 **`enforcement = not-implemented` 的含义是：这 300 次的计量与端点都还不存在。**
具体到文件：没有云端 AI 路由、没有计数器、没有一处 `deepseek` 调用、也没有能卖
¥12 的收银台。承诺写在落地页与法务里是**已锁定的产品决定**（ADR-0020 §3.2），
但从这份状态推出一条硬约束：

> **在计量存在之前，`hosted-ai-monthly` 不得被售卖。** 收了钱交付不了就是虚假宣传。

状态是**被声明的**，不是被推断的：把 `enforcement` 改成 `enforced` 会让门禁要求
计量实现真的存在；删掉这个块、或只改一处数字，门禁立刻变红。
决定与最小实现清单见 [ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md)。

ℹ️ **我们云端 AI 跑的是 `deepseek-flash`（DeepSeek V4.1 Flash）** ——
[ADR-0021](../adr/0021-managed-ai-model-deepseek-flash.md)。这**不是技术细节，
是单位经济**：¥12 的增量是 ¥7，flash 级 300 次/月 的 token 成本 ≈**¥2.01（29%）**；
换成 pro 级 ≈**¥7.71**，**超过 ¥7 增量本身**（每份亏 ¥0.71/月）。
所以「**换模型 = 换价**」，两者不能分开定。

## 3. 到期后的行为（硬约束）

| | 到期后 |
|---|---|
| 本地数据 | 🔴 **一个字都不动** —— 付费状态永远不许影响本地可用性 |
| 服务端已有数据 | 🔴 **不删** —— 降级 ≠ 删数据 |
| 继续同步 | 🔴 **停止**（所有设备）—— 这是唯一合理的到期后果 |
| 出路 | ① 续费；② **换成你自己的服务器，立刻恢复同步、数据无损** |

## 4. 这个数字住在哪三个地方

价格**不许**再抄成第四份。三层各有一个唯一事实源，由
`scripts/check-pricing-consistency.mjs` 钉住：

| 层 | 文件 | 谁读它 |
|---|---|---|
| **实际收多少（代码基线）** | `server/src/billing/price-book.ts` → `DEFAULT_PRICE_BOOK` | 服务端下单；新装实例、测试、CI |
| **实际收多少（运行期版本）** | `price_versions` 表（append-only，带生效区间） | 官方托管实例的生产报价 |
| **对外怎么说** | `packages/i18n/src/locales/{zh-CN,en}.ts` → `landing.pricing.*` | 落地页 |
| **对外怎么承诺（托管同步）** | `server/legal/terms-of-service.heyta.md` | 用户与服务方 |
| **对外怎么承诺（云端 AI）** | `server/legal/terms-of-service.ai.heyta.md` | 用户与服务方 |
| **一句话的价格表** | 本文件 §1 与 §6 | 人 + 门禁 |

自 [ADR-0018](../adr/0018-adjustable-pricing-and-coupons.md) 起，
`server/src/billing/wechat.adapter.ts` 的 `WECHAT_DEFAULT_PRICES` **不再是事实源**
—— 它是 `projectPrices(DEFAULT_PRICE_BOOK, 'CNY', 0)` 的投影。门禁里多了一条
"adapter 里不许出现 `totalFen: <数字>`"，防止这个数字被抄回来：抄回来的那份
不会跟着改价动，而没有任何东西会发现。

### 4.1 价格可调，但"改价"是 append 一版，不是就地改

改价走 `publishPriceVersion`（`server/src/billing/pricing-store.ts`）：在一个事务里
把旧的开区间版本收口、插入新版、写审计行。旧行**永不删除** ——
历史订单的金额永远能按当时生效的那一版解释。语义、裁决规则（"覆盖版本里有缝时
**绝不**回落到基线"）与运维要求见
[pricing-and-coupons.md](pricing-and-coupons.md) §1.2 / §5。

### 🔴 加第二个档位之前（原 §4 的这一条已被修掉）

原话是「回调的金额校验目前是『付的金额是价目表里的**某一个**』」——
这个洞已经关闭，而且**在关闭它之前优惠券就先把它戳破了**：券让"这一单该付多少"
不再等于任何价目表项（¥5 用 ¥1 券 → 实付 ¥4，不在价目表上）。

现在回调的校验是：**跟订单上冻结的 `checkout_orders.final_amount_minor` 比。**
报价一旦落库就被冻结，此后价目表与券怎么变都不影响这一单。这一条同时覆盖
SKU 与折扣，实现在 `settleOrderPaid`。

⚠️ 但"**收费清单上不许出现功能名**"这条产品决策**没有变**，而且现在被门禁
强制得更死：价目表里批准**恰好两个** priceId（`hosted-monthly` 与
`hosted-ai-monthly`，各含 CNY 与 USD 基线），每个都必须声明 `grants`，
且 `grants` 的合法值只有 `hosting` 与 `ai` 两个（`ALLOWED_GRANTS`）。
写 `labels` / `focus` / `four-quadrant` 这类功能名一律红。见 ADR-0020 §3.2、§3.3。

## 5. 现在还不能买 —— 诚实状态

### 5.1 大陆通道

`wechat.adapter.ts` 已实现且有测试（下单 / 验签 / 解密 / 金额校验 / 一次性授予），
收银台路由**也已接通** —— `POST /api/billing/checkout`
（`server/src/billing/checkout.routes.ts`，注册在 `/api/billing`）。
所以服务端「报价 → 冻结 → 下单」这条链**已经通了**，不再是"计价引擎存在、
但用户走不到付钱那一步"。详见
[pricing-and-coupons.md](pricing-and-coupons.md) §7 第 18 条。

**但用户仍然买不成**，卡在两件与这条路由**无关**的事上：

1. 🔴 **这台实例没有配真实支付通道。** 只有 `noop` 时收银台回
   `503 BILLING_PROVIDER_NOT_CONFIGURED` —— 卡在支付商的资质 / 凭证，
   不在我们的代码里。
2. 🔴 **客户端还没有「付款」按钮**（web + 移动端）。它应当**和支付通道一起**落地：
   现在加，必然回上面那个 503，正好造出落地页明确反对的那个东西 ——
   一个点了没反应的「立即购买」（见 `apps/landing/src/components/Pricing.tsx` 文件头）。

[`subscription-handoff.md`](../plans/subscription-handoff.md) §4 把「客户端按权益降级」
与「真实支付测试模式门禁」列为未完成。

### 5.2 海外通道

[`subscription-provider-selection.md`](../plans/subscription-provider-selection.md) §1：
Paddle 支持中国大陆卖家**只有政策文本**，**实操放行未验证** ——
需要用户本人用中国身份注册一次、走到 Account Verification。
在此之前海外**没有可用的收款通道**，$5/月 与 $12/月 是**已定的价格**，不是**已开的通道**。

> 🔴 因此落地页上不得出现一个点了没反应的购买按钮。

## 6. 机器可读的价格（被门禁读取）

`scripts/check-pricing-consistency.mjs` 读下面这个块。**改价格必须同时改这里。**

```json pricing-ssot
{
  "skus": [
    {
      "priceId": "hosted-monthly",
      "period": "month",
      "grants": ["hosting"],
      "catalogKey": "landing.pricing.hosted",
      "cny": { "amountMinor": 500, "display": "¥5 / 月" },
      "usd": { "amountMinor": 500, "display": "$5 / 月" }
    },
    {
      "priceId": "hosted-ai-monthly",
      "period": "month",
      "grants": ["hosting", "ai"],
      "catalogKey": "landing.pricing.hostedAi",
      "cny": { "amountMinor": 1200, "display": "¥12 / 月" },
      "usd": { "amountMinor": 1200, "display": "$12 / 月" }
    }
  ]
}
```

`grants` 是**授权白名单**，合法值只有 `hosting`（我们替你运维服务器）与 `ai`
（我们的云端 AI）。**功能名不允许出现在这里** —— 「非 AI 能力永久免费」这条承诺
在代码里唯一可执行的形式就是"收费清单上没有功能"。见
[ADR-0020](../adr/0020-ai-subscription-two-tiers.md) §3.2、§3.4。

## 7. 未核实项

> 价格可调与优惠券的完整缺口清单在
> [pricing-and-coupons.md](pricing-and-coupons.md) §7。**仍然开着的**是：
> 有券订单的发票金额口径未与会计确认（第 4 条）、收款通道资质未落地 + 退款
> 未接线（第 5 条）、价格空隙的语义未改（第 13 条）、无 admin 鉴权（第 14 条）。
> 下面只列价格本身的。
>
> （`check:pricing` 曾经也在这份缺口清单里，**已接入 `pnpm check`**，
> 见 [pricing-and-coupons.md](pricing-and-coupons.md) §7 第 3 条。
> 同期关闭的还有第 1、2 条 —— 行锁真并发与 Prisma 参数绑定**都已在
> 真 PostgreSQL 上实测**，不再是缺口。）

1. **Paddle 对中国大陆卖家的 KYC 放行** —— 只有用户本人能验证（ADR-0017 §5.1）。
2. 🔴 **$5 / 月 的通道经济性 —— 比年付时代更尖锐。** MoR 费率（PayPal 中国大陆
   电汇 **$35/笔**）在**年付 $49** 时是"吃掉大部分毛利"，在**月付 $5** 时是
   **单笔费用是客单价的 7 倍** —— 也就是说按月付 + 每笔单独结算，这个通道
   **在数学上不成立**，不是"毛利变薄"。月付要跑通，必须要么走 MoR 平台的
   **订阅自动扣款**（但 ADR-0020 §1.4 定了不自动续费），要么把多个月合并成
   一次结算。**这仍是 [ADR-0020](../adr/0020-ai-subscription-two-tiers.md) §5 的
   未核实项**（该 ADR 已经落地，所以它不是"落地前要回答"，而是**落地后仍欠的账**）。
3. **晓黎支付中心能否给 heyta 开新 client id 与 CNY 账本** —— 本次未核实，
   AIstudy 的契约文档只记录了 `XIAOLI_PAYMENT_CLIENT_ID=learning` 一个。
4. **工信部 292 号令**对「收费托管同步服务」的定性 —— 需中国律师。
5. **退款政策** —— 未写（[`subscription-boundary.md`](../plans/subscription-boundary.md) §3 也留着它）。
6. 🔴 **AI 档的可行性绑在 flash 级的单价上** ——
   [ADR-0021](../adr/0021-managed-ai-model-deepseek-flash.md) 把模型定成
   `deepseek-flash`（V4.1 Flash），300 次/月 的成本 ≈¥2.01（占 ¥7 增量 29%）。
   但**上游调价没有任何通知义务**，所以这是一个会**外部失效**的结论：
   定价页一变，就要重跑 ADR-0020 §3.6 那张表，看 29% 是否还在 1/3 以内。
   另外**四个 AI 功能在 flash 上的实际可用性一次都没测过** —— 选它的理由是
   单位经济，不是"它够用"。
