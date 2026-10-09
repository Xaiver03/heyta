# 价格与权益

> 这份文件是**价格与权益的工程参考**，不是营销文案。
> 决策与理由见 [ADR-0020](../adr/0020-ai-subscription-two-tiers.md)
> —— 它**取代**了 [ADR-0017](../adr/0017-single-paid-tier-and-payment-channel.md)
> 的价格与周期结论（ADR-0017 的「自建永久免费」「不自动续费」仍然有效）；
> 「收费的是服务器不是功能」这条产品边界见
> [subscription-boundary.md](../plans/subscription-boundary.md)。
>
> 最后核对：2026-10-10（§1 的 `grants` 与 §6 的 `pricing-ssot` 对账、§2 补自动收集那一行、
> 新增 §2.2 的计费与保留口径；核对方式与门禁读数见 `PROGRESS.md` 的 T6 那一节）。

---

## 1. 一张表（两个付费档，都是月付）

| 档位 | priceId | 币种 | 价格 | 计费方式 | 授予 | 现在能买吗 |
|---|---|---|---|---|---|---|
| **开源档**（自建 / 自托管） | — | — | **免费** | 永久，**且不校验** | **除云端 AI 外**的全部能力 | ✅ 可以 |
| **官方托管 · 大陆** | `hosted-monthly` | CNY | **¥5 / 月** | 按月付，**不自动续费** | `hosting` | 🔴 **还不能**（见 §5.1） |
| **官方托管 · 海外** | `hosted-monthly` | USD | **$5 / 月** | 按月付，**不自动续费** | `hosting` | 🔴 **还不能**（通道未开） |
| **官方托管 + 云端 AI · 大陆** | `hosted-ai-monthly` | CNY | **¥12 / 月** | 按月付，**不自动续费** | `hosting` + `ai` + `automation` | 🔴 **还不能收款**（这一台没配真实通道、客户端还没有付款按钮，见 §5.1；**不是**交付不了 —— [ADR-0054](../adr/0054-managed-ai-retention-and-selling-preconditions.md) 已解除禁售。⚠️ `automation` 随这一档授予，但**它自己那一格仍未达可交付**，见 §2.2 —— 解除禁售 ≠ 自动收集可用） |
| **官方托管 + 云端 AI · 海外** | `hosted-ai-monthly` | USD | **$12 / 月** | 按月付，**不自动续费** | `hosting` + `ai` + `automation` | 🔴 **还不能收款**（海外通道未放行，见 §5.2；**不是**交付不了 —— [ADR-0054](../adr/0054-managed-ai-retention-and-selling-preconditions.md) 已解除禁售。`automation` 的边界同上） |

- **恰好两个 SKU，没有第三个。** 门禁断言"恰好 2 个"（`EXPECTED_SKU_COUNT`），
  不是"至多 2 个" —— 多一个就红。
- **开源档就是那一档免费档，不存在"更便宜的付费档"。** 自建自托管**永久免费**，
  拿到的是**除云端 AI 之外的全部能力** —— 云端 AI 本来就必须跑在我们的服务器上，
  自建拿不到它不是因为被阉割，而是因为它物理上不在你那边。
  ⚠️ **"不校验"这一半自 2026-10-07 起有一个限定**（[ADR-0060](../adr/0060-automation-entitlement-and-retention.md) §1–2）：
  普通的自建自托管同步仍然免费、不校验；而**自动收集**在自建实例上要求这台实例已绑定一个
  在官方实例买过 AI 档的付费主体（判据与票据形状见[协议](inbound-automation-protocol.md) §4）。
  这条限定取代的是 ADR-0017/0020 里"自托管的所有功能都不校验付费资格"那句的适用范围，
  **没有**改动旧价格、支付通道、不自动续费与已有本地功能的边界。
- **没有任何功能是被钱锁住的。** 两个付费档卖的只有两件东西：我们替你运维那台服务器
  （`hosting`），以及**我们这台的**云端 AI（`ai`）。自带端点的 AI 两个付费档都不涉及，
  永远免费、不限次。
  （为什么功能不能出现在收费清单上：见 ADR-0020 §3.2、§3.4。）
  🔴 这句要按 ADR-0060 读成**"收费清单上没有功能，只有服务"**：`automation` 之所以在 `grants` 里，
  不是"新功能要收费"，而是**它必须借用云端 AI 那台服务器代发**这一件事 —— 它随 `ai` 档一起授予、
  **不新增 SKU、不调整售价与周期、不按事件另收费**，本地模型与用户自有端点的自动收集不占托管额度。
  删掉规则、关闭或暂停规则、取消待确认草稿、查看已有状态与删除自己的数据**都不要求付费**；
  要求有效权益的只有六件事：新规则启用、发送凭据签发、公网接收、worker 领取、解析开始与提交许可的签发
  （这一列的落点逐条写在[协议](inbound-automation-protocol.md) §4，两边必须同步改）。
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
| **自动收集**（公网 webhook 收件 → 解析 → 建任务） | 🟡 **要钱，但收钱的不是这台**：自建实例上不校验订阅行，只看官方签发的票据 —— 得先在这台实例上绑定一个**在官方实例买过 AI 档的付费主体**（机制见[协议](inbound-automation-protocol.md) §4；普通的自建同步仍然完全免费、不校验） | ❌ 这一档只授予 `hosting`，不含 `automation` | 🟡 **随该档授予，但这一格还没到可交付**（§2.2） |
| 同步设备数 | ✅ 不限（你自己的机器，你说了算） | ✅ 不限 | ✅ 不限 |
| 服务端 op 保留 | ✅ 完整（不删） | ✅ 完整（不删） | ✅ 完整（不删） |

🔴 **自带密钥的 AI 两个付费档都不涉及，永远免费、不限次。** 收费的从来不是
"AI 功能"，而是"由我们的服务器代为转发到模型"这一件事。你随时可以关掉它改用
自己的端点，功能一个不少。

⚠️ **我们的云端 AI 不是端到端加密的**（ADR-0006 / ADR-0020 §3.4）：
要让我们的服务器把内容送给模型，就必须先解开它。这一点必须在对外文案里
**明确说出来**，`scripts/check-ai-coverage.mjs` 会强制断言那句否定
（`不受端到端加密`）。

### 2.1 🔴 「300 次/月」的当前状态：**已实现**（2026-10-05）

```json ai-quota-ssot
{
  "quota": 300,
  "unit": "次 / 计费周期",
  "enforcement": "enforced",
  "decidedIn": "docs/adr/0054-managed-ai-retention-and-selling-preconditions.md"
}
```

**这个块是额度数字的唯一事实源。** 中英词条、法务、以及本文件正文里的那个数字
都必须与它相等 —— 由 `pnpm check:ai-quota` 强制
（`scripts/check-ai-quota-consistency.mjs`）。

🟢 **`enforcement = enforced` 的含义是：这一档买的东西现在真的存在。**
计量在 `server/src/ai/metering.ts`（读占用、对上限裁决、`+1` 全在**同一条语句**里，
超额那一次 `WHERE` 匹配零行 ⇒ 什么都没写），云端路由在
`server/src/ai/managed-proxy.routes.ts`，境内白名单在
`packages/ai/src/managed-endpoints.ts`（接境外端点 ⇒ `managed-endpoint-not-domestic`）。

原来那条硬约束（[ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md) §3.1
「在计量存在之前，`hosted-ai-monthly` 不得被售卖」）**不是被打断的，是按它自己的
条款解除的** —— 它约束的是"承诺已写、交付未做"这个状态，而那个状态已经结束。
解除与实现必须在**同一个提交**里：`NOT_YET_DELIVERABLE_SKUS` 里那一条与这份状态
翻转是一件事的两半，先翻状态后做计量就是 ADR-0023 立规时唯一想挡的那件事。

⚠️ **`enforced` 说的是"实现存在"，不是"线上在跑"。** 服务端镜像重建与生产部署
是另一条授权（AGENTS §6.1.1：门禁绿 ≠ 已部署），在那之前线上仍然是旧行为。

状态是**被声明的**，不是被推断的：删掉这个块、只改一处数字、或把 `enforcement`
改成一个词表外的值，门禁立刻变红。裁决全文见
[ADR-0054](../adr/0054-managed-ai-retention-and-selling-preconditions.md)。

ℹ️ **我们云端 AI 跑的是 `deepseek-flash`（DeepSeek V4.1 Flash）** ——
[ADR-0021](../adr/0021-managed-ai-model-deepseek-flash.md)。这**不是技术细节，
是单位经济**：¥12 的增量是 ¥7，flash 级 300 次/月 的 token 成本 ≈**¥2.01（29%）**；
换成 pro 级 ≈**¥7.71**，**超过 ¥7 增量本身**（每份亏 ¥0.71/月）。
所以「**换模型 = 换价**」，两者不能分开定。

### 2.2 🔴 自动收集：授予了，但**还没到能拿它收钱的样子**（2026-10-10 现量）

商业基线是负责人 2026-10-07 的裁决，全文见 [ADR-0060](../adr/0060-automation-entitlement-and-retention.md)：
自动收集属于**现有 AI 付费档** —— 不新建 SKU、不改售价与周期、**不按事件另收费**，
托管模型沿用原来那份额度；本地模型与用户自有端点的成本由用户自己的供应商承担。
下面五句是对外必须说清的口径，每一句都已落到代码或协议里，不是打算：

| 口径 | 说的是什么 | 锚点 |
|---|---|---|
| **一次物理调用 = 一次额度** | 重试提交已冻结的结果**不再调用模型**、不再扣；而**从未打到供应商**的那一次预留会退回计数器（等于没发生过）。已经发出的、以及响应丢失判成 `unknown` 的**照计不退** —— 后者是"不知道发生了什么"时取"少白送一次"那一侧 | `server/src/automation/ai-metering.ts`；[协议](inbound-automation-protocol.md) §4 |
| **额度是共用的，不是另给一份** | 自动收集与你在对话里用的云端 AI 记在**同一个账号级计数器**（`ai_usage_counters` 四列）上，300 次/月 就是 300 次 —— **不是**"买了 AI 档再额外给你 300 次自动收集" | `server/src/ai/metering.ts` |
| **删除规则不退还已经消耗掉的额度** | 删规则会清事件、摘要、关联的模型尝试与服务端许可；历史上真发生过的那次调用不会因为删规则变成没发生 | [协议](inbound-automation-protocol.md) §8 |
| **保留期是 7 天，去重摘要留到规则删除** | webhook 输入与冻结草稿密文自事件接收起保留 7 天；重新解析、重试**不延后**原事件期限。服务端**只存密文与有限元数据**，看不到明文 | [ADR-0060](../adr/0060-automation-entitlement-and-retention.md) §4、[协议](inbound-automation-protocol.md) §8 |
| **撤销有至多 30 秒窗口，必须披露** | 自托管实例读的是绑定行，而票据寿命 ≤30 秒 ⇒ 吊销之后已签出的那枚最多还能用 30 秒。**不许写成瞬时生效** | [协议](inbound-automation-protocol.md) §4 |

🔴 **走我们云端 AI 那一段不是端到端加密** —— 与 §2 下面那句"要让服务器把内容送给模型就必须先解开它"
是同一条约束，自动收集不能例外。它**不许**在任何对外文案里被描述成端到端加密。

**为什么这一档现在还不许卖**（不是谨慎，是缺的东西有名字）：

1. 票由哪个 URL 签没拍（`BLOCKED.md` **B109**）⇒ 宿主一次都不会去续绑定；
2. 到期/无权益时界面该说什么缺词条（**B110**）；
3. HEAD 上有四处白名单外的外接缝没落地（**B112**），所以真宿主故障窗口跑不起来；
4. 十三个故障窗口**还没有在两个独立真 SQLite 宿主上过**（T3）；
5. 界面层那三枚文件没入库（T5）；
6. 逐周期对账的读函数在库里但**没有任何运营界面调用它**（**B113**）——
   也就是"额度少了一次"这类投诉今天还没有自助核查的路。

判据（现量，别抄数）：`grep -c '^- \[ \] \*\*AC-' docs/plans/inbound-automation.md` 必须是 8、
`grep -c '^- \[x\] \*\*AC-' docs/plans/inbound-automation.md` 必须是 0。
公网接收与这一档的售卖**继续保持关闭**；上面六条闭合之前，本页与落地页都不许把它写成已包含的可用能力
（这条门槛本身就写在 [ADR-0060](../adr/0060-automation-entitlement-and-retention.md) 「发布门槛」一节）。

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
2. ~~**客户端还没有「付款」按钮**（web + 移动端）。~~
   ✅ **2026-10-05 已落地**：web 设置页的 `RenewPanel` 与移动壳「我的」页里的
   `RenewSection`（`apps/mobile/src/screens/RenewSection.tsx`，由「我的」页 `ProfileScreen` 渲染）
   走的是 `packages/app-host` **同一份**接线（报价 → 冻结 → 下单 → 拿支付串）。
   🔴 它**仍然**受上面第 1 条约束：`WECHAT_PAY_ENABLED=false` 时点下去拿到的是那个 503，
   而 `check:payment-entry` 钉的就是"按钮存在 ⇔ 开关状态"这一对 ——
   所以这不是"点了没反应的立即购买"（那条立场仍然成立，落地页依旧没有购买按钮）。

### 5.1.1 退款：有临时政策，还没有对外承诺（2026-10-05）

本文此前只写过"退款侧有意不接"。那句话由 [ADR-0053](../adr/0053-refunds-only-for-countable-segments.md)
收窄成一句可执行的口径，**数字的唯一来源是代码里的两个常量**（本文不复制第二份）：

| 问题 | 当前答案 | 住在哪 |
|---|---|---|
| 哪些单能退 | 只有**收银台一次性单**（`checkout_orders` 里有 `out_trade_no`、金额已核实） | `refund-policy.ts#decideRefundEligibility` |
| 退多少 | **结算时冻下的实付**（用了券就是实付，不是原价） | 同上；`refunds.amount_minor` 冻结 |
| 权益怎么回 | 只回收**这一单授予的那一段**；已消费的天数不追回；多来源权益取并集那条纪律不变 | `refund-policy.ts#retractGrantedPeriod` |
| 例外（超窗） | 只走运营后台，且**必须带理由**，否则 400。~~🔴 后台**没有**退款 tab —— 今天能点的人是拿令牌敲接口的人（ADR-0053 §5 第 10 条）~~ ✅ **2026-10-05 后台有了「退款」这一格**：列表 + 开单 + 两步批准 + 驳回，409 的原因码原样上屏（证据与判据见 [`pricing-coupons-handoff.md`](../plans/pricing-coupons-handoff.md) §12.8） | `admin.routes.ts` 的 `operatorApproved` + refine |
| 通道没配时 | 批准照落库，发通道那步如实失败（`refunds.status='failed'` + 审计），**不报 500** | `refund-store.ts#submitRefundToChannel` |

🔴 **对外说法未改**：这句临时口径目前只在代码与 ADR-0053 里。
写进服务条款 / 界面承诺属对外法律表征，需业主拍板（ADR-0053 §5 第 7 条）。

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
      "grants": ["hosting", "ai", "automation"],
      "catalogKey": "landing.pricing.hostedAi",
      "cny": { "amountMinor": 1200, "display": "¥12 / 月" },
      "usd": { "amountMinor": 1200, "display": "$12 / 月" }
    }
  ]
}
```

`grants` 是**授权白名单**，合法值包括 `hosting`（我们替你运维服务器）、`ai`
（我们的云端 AI）和 `automation`（自动收集，随 AI 档提供）。**功能名不允许出现在这里** —— 「非 AI 能力永久免费」这条承诺
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
