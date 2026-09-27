# 交接：微信支付 adapter + 真实支付 E2E 门禁

> **给全新会话的完整任务书。** 你不需要重新调研 —— 调研结论、产品决定、
> 技术事实都在下面和引用的文档里。**先读完本文再动手。**

## 0. 一句话

> 🔴 **后补（2026-09-27）：本任务书里"要做"的东西已经做完了。**
> `server/src/billing/wechat.adapter.ts` **已存在、已提交、有测试**
> （`server/tests/wechat-adapter.spec.ts` / `billing-wechat.routes.spec.ts` /
> `billing-wechat-config.spec.ts`）；`server/src/billing/extend-period.ts` 的镜像
> 也已取消（`server/package.json` 直接依赖 `@heyta/domain`）。
> **仍然没做的**只有两件：① 真实商户凭证下的端到端验证（§9 要求的诚实项，
> 至今未做）；② `settleOrderPaid` 在 webhook 路径上的接线
> （见 [pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7 第 9 条）。
> 另外价格与周期已由 ADR-0020 改成**月付 ¥5/¥12、一次支付 30 天** ——
> §3.1 的 ¥99/年 与 365 天**已作废**。下面正文保留作当时的任务书。

heyta 的订阅功能已经做完了 4/6 项（数据模型、服务端权益与幂等、客户端降级、
ToS 草稿），**只剩微信支付 adapter 与真实支付 E2E 门禁**。
adapter 曾派过一个 agent 连做三轮零产出，已中断。你要做的是把它做完。

## 1. 已经做完的（不要重做，不要改）

| 项 | 提交 | 内容 |
|---|---|---|
| 数据模型 | `7a5a8c9` `00888f8` | `Subscription` 表 + 迁移；**未 bump `CURRENT_SCHEMA_VERSION`** |
| 服务端权益/幂等 | `7a5a8c9` `8dd2278` | 权益闸门（**默认关**）、`PaymentEvent` 唯一约束去重、支付商无关抽象层 |
| 客户端降级 | `a396df7` `c4ce652` | 纯判定在 `packages/domain`、无 body 探测在 `packages/app-host`、提示已挂载 |
| ToS 草稿 | `9d39779` | `server/legal/terms-of-service.heyta.md`，🔴 **未经法务复核、不可对外** |
| 周期叠加纯函数 | `8cc59e5` | `packages/domain/src/subscription.ts` 的 `extendSubscriptionPeriod` |

**基线（实测）**：服务端 `60 files / 1156 passed | 1 skipped`；
`packages/domain` 395 passed；`packages/ai` 144 passed；
`apps/web` `465 passed | 12 skipped`；CI 在 `f3cb792` 是 success。

## 2. 必读（先读这三份，再动手）

1. **`docs/plans/subscription-boundary.md` §6** —— 一次性支付的授予语义 +
   微信支付技术事实 + 零依赖要求 + 凭证变量名。**这是你的规格。**
2. `server/src/billing/types.ts` —— `BillingAdapter` 接口（四个方法）。
3. `server/src/billing/apply-event.ts` —— **你要接上的那个缺口**在
   `NO_SUBSCRIPTION_REFERENCE` 分支，那里有注释。

## 3. 🔴 你的规格（已经定好，不要重新发明）

### 3.1 一次性支付的授予语义

微信支付**没有订阅对象**，回调只说"一笔订单付成功了"。
~~阶段一是**一次性年付 ¥99**~~ → 🔴 **已改为一次性月付**：
`hosted-monthly` ¥5/月、`hosted-ai-monthly` ¥12/月（ADR-0020），
所以 `NO_SUBSCRIPTION_REFERENCE` 在阶段一是**主路径**，不是边界情况。

```
currentPeriodEnd = max(now, 已有的 currentPeriodEnd ?? now) + 30 天
```

> ⚠️ 上面那个 `365` 已随 ADR-0020 改成 **`30`**：`SUBSCRIPTION_PERIOD_DAYS`
> 与 `WECHAT_ONE_TIME_PERIOD_DAYS` 现在都是 `30`（实测
> `packages/domain/src/subscription.ts` 与 `server/src/billing/wechat.adapter.ts`）。

- **`max` 是全部要点**：提前续费**不许丢掉已付过钱的剩余时间**。
- 已过期的到期日从 `now` 起算（否则新买的时长会有一部分埋进过去）。
- 纯函数**已经写好并有 7 条测试**（`packages/domain` `extendSubscriptionPeriod`）——
  **复用它，不要重写**。
- **一行一用户**：`(userId, provider='wechat')` 复用一行，`externalSubscriptionId = null`。
- **幂等键 = `out_trade_no`**。两个方向都要测：
  ①同一订单重复回调只授予一次；②**不同订单号的两次真实购买必须是两次授予**。

### 3.2 微信支付技术要点

- **Native 扫码**：`POST https://api.mch.weixin.qq.com/v3/pay/transactions/native`，
  返回 **`code_url`**（二维码内容，不是跳转 URL）→ 用 `CheckoutResult` 的 `qrCode` 支。
- **请求签名**：`WECHATPAY2-SHA256-RSA2048`，
  签名串 `method\nurl\ntimestamp\nnonce\nbody\n`，商户私钥 RSA-SHA256。
- **回调验签**：验签串 `timestamp\nnonce\nbody\n`，平台公钥验 `Wechatpay-Signature`，
  🔴 **必须同时校验 `Wechatpay-Timestamp` 时效**（防重放）。
- **回调解密**：`resource` 是 **AES-256-GCM**，密钥 = APIv3 密钥，
  `associated_data` + `nonce` 取自 `resource`。
- 🔴 **验签失败必须 fail-closed**：拒绝且**不落 `PaymentEvent`**（已有测试守这条）。

### 3.3 🔴 零新依赖

微信**没有官方 Node SDK**。社区方案是第三方的，要过两道门并登记。
**本任务不引入任何依赖** —— 用 `node:crypto` 手写 RSA 签名/验签、AES-256-GCM 解密、
`randomUUID`；HTTP 用内置 `fetch`。

**如果你认为某一步无法用 `node:crypto` 完成，停下来报告，不要偷偷加依赖。**

## 4. 🔴 凭证

真实凭证在 `/Users/rocalight/Desktop/All in one Data/01_PROJECTS/litopia12/.env.local`：
`WX_APP_ID` / `WX_MCH_ID` / `WX_SERIAL_NO` / `WX_API_V3_KEY` /
`WX_PRIVATE_KEY` / `WX_PUBLIC_KEY`。

- ⚠️ 这些是**借用另一家公司**的凭证，用户说会换新的。**不要**把它们当成最终的。
- ⚠️ 那个文件里有一行用中文冒号 `私钥：<base64>=` 格式 —— **不要读那一行**，
  也不要把它写进任何文件。
- **真实值只进本地 `.env`**（已确认 `.env` 与 `server/.env` 都在 `.gitignore` 里）。
- `server/env.example` **只写变量名 + 占位符**。
- 🔴 提交前跑 `git status`，确认没有 `.env`、没有 `*.pem`、没有 base64 私钥被跟踪。

## 5. 交付物

1. `server/src/billing/wechat.adapter.ts` —— 实现四个方法；
   `mapSubscriptionState` 对微信**明确返回"无订阅状态"**，不要编一个状态机。
2. `apply-event.ts` 接上一次性支付授予路径。
3. `config.ts` 加运营者开关（**默认关**）+ 凭证读取（走既有 `loadConfigFromEnv`，
   **不要**散落 `process.env`）。
4. `registry.ts` 注册（**仅当配置齐全**）。
5. `server/env.example` 加变量名。
6. 测试（样板：`server/tests/billing-webhook.routes.spec.ts`）：
   - 🔴 周期叠加（复用 `extendSubscriptionPeriod` 的语义）
   - 🔴 同 `out_trade_no` 重复回调只授予一次
   - 🔴 不同 `out_trade_no` 两次购买 = 两次授予
   - 🔴 验签失败不落 `PaymentEvent`
   - 时间戳过期的回调被拒
   - AES-GCM 解密（**自己构造密钥/密文，不要用真凭证**）
   - 未配置时**不注册** wechat adapter（自托管不受影响）
   - 到期/退款**只改状态，从不 delete**

## 6. 🔴 工作区纪律（这个仓库是多 agent 共享的，踩过坑）

- **不要 `git add` / `git commit` / `git stash` / 不要动暂存区。**
  暂存区里长期住着别人的几十个文件；不带路径的 `git commit` 会把它们一起提交。
- **不要碰并发 agent 的文件**：`apps/landing/**`、`apps/mobile/**`、
  `packages/i18n/**`、`design-system/**`、`scripts/windows/**`、
  `scripts/check-ui-language.mjs`、`docs/runbooks/deployment.md`、`pnpm-lock.yaml`、
  **`server/package.json`**。
- 改完**报告**，由人用显式路径提交。
- `git commit -- <paths>` **忽略暂存区、用工作区内容** —— 所以它安全。
  新文件必须先 `git add` 才会被那个 pathspec 带上。

## 7. 必跑（贴真实输出）

```
pnpm --filter @heyta/sync-server test
pnpm --filter @heyta/sync-server exec tsc --noEmit
node scripts/check-migrations.mjs      # 若动了 schema
pnpm run check:layering
```

## 8. 🔴 交付节奏（上一个 agent 就是在这里失败的）

上一个 agent **连做三轮零落盘**。原因是任务里塞了四个子系统，
它把"先读清楚"当成了前置条件然后一直读。

**按这个顺序做，每写完一个文件就确认它真的在磁盘上：**

1. `wechat.adapter.ts` 里的**纯函数层**：签名串拼接、验签、AES-GCM 解密。
   先写这三个 + 它们的单测，跑绿。**不碰网络。**
2. `BillingAdapter` 四方法骨架（`createCheckout` 用 stub 的 fetch 测）。
3. `apply-event.ts` 授予路径 + 那几条幂等/叠加测试。
4. 最后才碰 `config.ts` / `registry.ts` / `env.example`。

**卡住不要停在原地** —— 把那一处写成带 `TODO` 的明确失败路径，
在报告里顶回来说明卡在哪，先把其余部分落地。

## 9. 诚实要求

报告里必须**明确列出你没验证的部分**。特别是：
**没有真实商户号跑过真单** —— 你的 402/200 都是 stub 的 fetch。
不要把"单测通过"说成"支付能用"。

## 10. 已知的周边缺口（不是你的任务，但别撞上）

- `docs/plans/subscription-integration.md` 的 §2 `sync.routes.ts:96`、
  §8 `:56` 与真实行号差 1（实际 97 / 57）。文档里已注明"行号不可当权威"。
- 服务端 402 body **没有** `currentPeriodEnd` 字段，所以客户端
  `evaluateSubscriptionPeriod` 在真实链路上走不到（只有 `reason === 'PERIOD_ENDED'` 有效）。
- 建议后续加 `GET /api/entitlement`（只回权益状态），把客户端探测从
  `/api/sync/status` 解耦 —— 现在用它属于**新增耦合**。
