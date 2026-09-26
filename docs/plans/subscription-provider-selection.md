# 会员订阅：支付商选型

> 状态：**选型结论（调研完成，待用户确认实体状况）**。
> 配套：[`subscription-boundary.md`](subscription-boundary.md)（产品边界）、
> [`subscription-integration.md`](subscription-integration.md)（服务端接入点）。
> 调研日期基准 **2026-09-26**。全部结论来自官方页面 / 官方 `.md` / npm registry API /
> GitHub API / **官方 LICENSE 原文**直抓（本机 `web_search` 不可用，返回 HTTP 432）。

## 0. 🔴 推荐在调研最后一轮翻转了：**Paddle 同时赢下两个分叉**

我最初把 **Creem** 定为「无执照分支首选」。**这个结论被推翻了**，
依据是两条复核过的官方原文：

**① Creem 的买家侧还不能用支付宝/微信**（这条最致命）：

> "Cards (Visa, Mastercard, Amex), PayPal, Apple Pay, Google Pay, and local
> payment methods based on customer location. **WeChat Pay and Alipay support
> coming soon.**"
> — https://docs.creem.io/getting-started/introduction.md

Creem 的**商家侧**能收支付宝（结算给你）是真的，但它解决的是
**"你怎么拿到钱"，不是"中国用户怎么付钱"** —— 而后者才是这个产品的问题本身。
收银台里没有支付宝/微信，¥139 的中国用户就付不出来。

**② Paddle 的卖家侧是打开的**（逐字读到官方原文）：

| 事实 | 原文 |
|---|---|
| 中国大陆**不在**不支持名单 | "works with software businesses **anywhere in the world** with the exception of…" 后 28 国**不含 China** |
| **个人/个体户免公司资质** | "this step is **not required for individuals or sole traders**" |
| 结算**支持人民币** | payout 币种含 **Chinese Yuan (CNY)**；wire/Payoneer；**min $100**；1 日结余、15 日前发出 |
| 买家侧支付宝**支持订阅** | `Countries=CN`、`Currencies=CNY`、**`Subscriptions: Supported`**，续费 ≤1600 CNY |

## 1. 结论（修正版）

| 分叉 | 🥇 首选 | 🥈 备选 |
|---|---|---|
| **有中国大陆营业执照**（个体户即可） | **Paddle** | 支付宝「电脑网站支付」（0.6%，成本最低，但**必须放弃自动续费** → 改「一次性年付 + 到期提醒」） |
| **无中国大陆营业执照** | **Paddle**（官方明确接受 individuals / sole traders） | **Creem** |

### 🔴 唯一的单点风险：**Paddle 是"文本已核实、实操未核实"**

政策文本允许 ≠ KYC 实操放行。

> **建议在写任何 adapter 之前，先用中国身份真实注册一次 Paddle 卖家账号，
> 走到 Account Verification 那一步。**
> 一封验证的成本，远低于按 Paddle 写完抽象层才发现开不了户。

若被拒，则诚实的结论是：**「无海外实体 + 无中国大陆执照」要同时做到
「中国用户用支付宝付 + 自动续费」，目前没有完全干净的方案** ——
最接近的是 Creem（个人 KYC 可开户，但**买家侧无支付宝/微信**，转化会差），
或办一张个体工商户执照。

### 另外两家出局（复核过原文）

- **Lemon Squeezy 三重出局**：① 卖家支持国家列表**无 China**（有 Taiwan/HK/Macao）；
  ② 官方原文 "**For subscription products we only support cards, Apple Pay,
  Google Pay and PayPal at this time.**" → **订阅用不了支付宝/微信**；
  ③ Node SDK 停在 2024-11，§3.1 不过。
- **PayPal 打款成本吃光利润**：中国大陆电汇提款 **35.00 USD/笔**，
  而收款费率 **4.40% + 固定费**。对 ¥139 × 早期单量，$35/笔几乎吃光利润。

> 长尾（Gumroad / Buy Me a Coffee / Payhip / Ko-fi）**无一家优于 Paddle**：
> 打款国清单收录港澳台却**独缺中国大陆**，且 BMAC 官方明说自己
> "does not handle the collection and remittance of sales tax or VAT" —— **不是 MoR**。

## 2. 🔴 三条走不通的路（先钉住，省得浪费工程时间）

| 组合 | 为什么走不通 |
|---|---|
| **无执照 + 支付宝官方 + ¥139** | 支付宝个人**无执照单笔 ≤50 元**，¥139 一笔就超限 |
| **无执照 + 微信官方** | 微信官方主体类型**只有企业/个体户/事业单位/政府/社会组织**，**没有「个人」**；唯一支持"个人卖家"的平台收付通要求先成为普通服务商，而服务商入驻只面向企业 |
| **聚合支付（虎皮椒 / XorPay / 蓝兔 / 面包多 / 爱发电）当订阅引擎** | 它们**全都没有可靠的自动续费能力** —— 而 heyta 是**权益制年订阅**，用它等于把产品形态改成"每年手动续费"。而且**绝大多数没有官方沙箱**，二清风险由我们承担 |

> 补充：`PayJS` **已停止运营**（官网原文），直接排除。

## 3. 🔴 许可证陷阱（这一条最容易返工）

**`@paypal/paypal-server-sdk` 的 npm `license` 字段写 `MIT`，但仓库 `LICENSE`
文件是 PayPal 自拟的 *SDK LICENSE*（permissive 但不在 §3.2 白名单内）。**
按仓库规则「白名单外默认失败」，它只能走 `REVIEWED_OTHER` 逐项登记。

**只看 npm registry 的检查会被骗过。** 这正是为什么选型必须读 LICENSE 原文。

同类的第二个坑：`alipay/alipay-sdk-nodejs-all` 的 GitHub API 报 `NOASSERTION`、
仓库根目录**没有** LICENSE 文件（只在**发布物**里有 `LICENSE.txt`）——
只看 GitHub 会误判成"无 LICENSE = 一行都不能用"。

### 逐项核实结果

| 渠道 | npm 包 | LICENSE（真实） | 最近发版 | §3.1 | §3.2 |
|---|---|---|---|---|---|
| Stripe | `stripe` | MIT | 2026-09-09 | ✅ | ✅ |
| Paddle | `@paddle/paddle-node-sdk` | Apache-2.0 | 2026-08-07 | ✅ | ✅ |
| **Creem** | `creem` | **MIT**（Armitage Labs OÜ） | 2026-09-17 | ✅ | ✅ |
| 微信 | `wechatpay-axios-plugin` | MIT（**第三方**，非腾讯官方） | 2026-02-10 | ✅ | ✅ |
| 支付宝 | `alipay-sdk` | MIT | 2025-04-29 | ⚠️ 约 17 个月无更新 | ✅ |
| Lemon Squeezy | `@lemonsqueezy/lemonsqueezy.js` | MIT | **2024-11-05** | ⚠️ 近一年无提交 | ✅ |
| **PayPal** | `@paypal/paypal-server-sdk` | 🔴 **自拟协议，非 MIT** | 2026-08-21 | ✅ | ❌ |
| 微信（旧） | `wechatpay-node-v3` | MIT | 2024-08-19，**GitHub 已 404** | ⚠️ | ⚠️ |

注：微信**没有**腾讯官方 Node 服务端 SDK（官方只有 Java/PHP/Go）。

## 4. 抽象层设计：能抽象什么、抽象不掉什么

### 接口只暴露四个方法

```
createCheckout()          → { redirectUrl } 或 { qrCode }
verifyWebhook()           → 验签 + 归一化
mapSubscriptionState()    → 映射到我方统一枚举
revokeEntitlement()       → 退款/拒付时的权益回收
```

### 🔴 抽象不掉的（必须由每个 adapter 自己实现）

| 维度 | 为什么抽象不掉 |
|---|---|
| **幂等键的有无** | Stripe 有 `Idempotency-Key`，Creem/支付宝/微信没有。→ **只能在我们自己的库里做 `(provider, providerEventId)` 唯一约束**，不能依赖支付商 |
| **金额单位** | Stripe/Paddle **最小单位整数**；Creem 整数 cents；**支付宝是元字符串**（`"0.01"`） |
| **"有没有订阅"这件事本身** | **支付宝/微信没有订阅状态机**（单次支付 + 手动续）→ 抽象层必须允许"无订阅的 provider" |
| **收银台形态** | 微信 Native 返回**二维码**，MoR 返回**重定向 URL** |
| **状态字面量语义不同构** | 如 Paddle 的 `paused` 在 Stripe 没有对应物 |

**建议**：把「状态映射表」和「金额单位换算」当成 adapter 的**私有细节** ——
这两处是最容易用错的地方。

## 5. webhook 幂等的真实语义差异

| | 去重键 | 顺序保证 | 重投 |
|---|---|---|---|
| Stripe | `event.id` | 不保证 | 指数退避（数天） |
| Paddle | **`event_id`（`evt_`）**，注意与 `notification_id`（`ntf_`，**每次投递不同**）区分 | 🔴 **不保证**，官方要求用 `occurred_at` 排序 | 指数退避，需 5 秒内回 200 |
| Creem | 事件**可重复投递**，需自行幂等 | 不保证 | **5 次**：立即 +30s +5m +30m +6h，24h 后不再重试 |

🔴 **Paddle 那个 `evt_` / `ntf_` 的区分是个真陷阱** —— 用错字段做幂等键会导致
每次重投都被当成新事件，**重复授予权益**。这正是本目标里
「重复回调不许重复授予」要防的情况。

## 6. CI 里的"真实支付端到端"：能做到哪一步

**做不到**"真实扣款 + 真实清算"的全自动端到端（那需要真人持卡与验证码）。
**能做到**：

1. adapter 单测：**用官方文档给的固定 payload + 真 secret 验签**（不是 mock）；
2. sandbox 里建结账会话，断言返回的 URL / 二维码；
3. 用**官方 webhook 模拟器**（Paddle 有、Creem/LS 有面板重放）把**真实签名**的
   payload 打进 `/webhooks/:provider`；
4. 🔴 **重复投递同一 `event_id`，断言结果幂等**。

**第 4 步是唯一能真正验证「幂等授予权益」的地方，必须写。**
Paddle 的 Webhook Simulator 是这组里最适合 CI 化的。

## 7. 还没核实的（不要当已确认事实用）

1. **Paddle 是否接受中国大陆卖家开户与结算** —— 🔴 **这是有执照分支决策前必须发信问清的事**
2. Stripe 官方支持国家列表里是否含 Mainland China
3. FastSpring 的费率数字
4. **Creem 是否支持 CNY 计价**、收银台是否给买家提供 Alipay/WeChat
5. Creem / Paddle / LS 的**订阅状态字面量全集**、幂等键
6. 微信支付的沙箱与测试模式
7. 支付宝沙箱的买家账号需人工（CI 化受限）

## 8. 因此对实施的约束

- 抽象层**必须先写成 provider 无关**，这样 Paddle ↔ Creem ↔ 支付宝 之间换手
  只改一个 adapter，而不是重写权益逻辑。
- 在选型定稿前**不要接入任何 SDK** —— 但**抽象层的接口形状可以现在就定**。
- 幂等闸门建在**我们自己的库**里（`(provider, providerEventId)` 唯一约束），
  这是唯一在所有渠道都成立的方案。
