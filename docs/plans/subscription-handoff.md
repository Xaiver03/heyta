# 会员订阅：交接状态

> 状态：**进行中**。本文件只记「当前停在哪」，不重复决策 ——
> 决策见 [`subscription-boundary.md`](subscription-boundary.md) /
> [`subscription-integration.md`](subscription-integration.md) /
> [`subscription-provider-selection.md`](subscription-provider-selection.md)。
>
> 最后更新：会话 `goal-192acbae` 第 13 轮。**这份文件的存在原因是：驱动它的 agent
> 上下文耗尽了，而后台还有一个 agent 在写未提交的代码。**

## 1. 已提交（在 `origin/main` 上，可信）

| 提交 | 内容 |
|---|---|
| `7a5a8c9` | `Subscription` 表 + 迁移 + `entitlement.ts` + **默认关**的运营者开关 |
| `00888f8` | 补上被漏提交的权益测试（8/8 绿）；`server/tests/{entitlement,entitlement-gate.routes}.spec.ts` |
| `166bbd9` | 选型结论翻转 → **Paddle 优先** |
| `5484b33` | 选型调研初版（部分结论已被 `166bbd9` 取代，但许可证陷阱与「抽象不掉的三处」仍有效） |

服务端测试：`59 files passed | 1148 passed | 1 skipped`。

## 2. 🔴 未提交 —— 后台 agent 正在写，**没有任何测试**

```
?? server/src/billing/                                    ← 6 个文件，全部未跟踪
     apply-event.ts  index.ts  noop.adapter.ts
     registry.ts  types.ts  webhook.routes.ts
?? server/prisma/migrations/20260927000000_add_payment_events/
 M server/prisma/schema.prisma                            ← PaymentEvent 模型
 M server/src/server.ts                                   ← webhook 路由注册
```

**这些文件在磁盘上，不会因为会话结束而丢失**，但它们**零测试**。

🔴 **不要直接提交它们。** 这个目标里已经犯过一次同类错误：`entitlement.ts`
先于它的测试进了 HEAD，结果 HEAD 里躺着一份**看起来做完了、实际零验证**的实现。
顺序必须是 **写完全部测试 → 一次跑通 → 再提交**。

`server/package.json` 的改动**不是这条线的**（并发 agent 的），提交时排除。

## 3. 已验证的设计要点（可以直接采信）

- `PaymentEvent` 的唯一约束 **`@@unique([provider, providerEventId])`** 在
  Prisma 模型与生成的 SQL 里**都有**；迁移通过 `node scripts/check-migrations.mjs`。
- adapter 接口签名为
  **`verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): Promise<WebhookVerification>`**
  —— **收原始 body + 全部 header**，不是单个签名字符串。
  这一条是硬要求：只给签名的话，微信（`WECHATPAY2-SHA256-RSA2048`，验签串含
  timestamp/nonce/body + 平台证书轮换）与 PayPal（`cert_url`）**实现不了**。
- 验签失败返回 `{ ok: false }` **而不抛异常** —— 路由必须能区分
  "攻击者伪造"与"我们自己崩了"。
- 接口四方法：`createCheckout` / `verifyWebhook` / `mapSubscriptionState` /
  `revokeEntitlement`。

## 4. 还没写的（按优先级）

| # | 事项 | 注意 |
|---|---|---|
| 1 | **billing 的测试** | 🔴 必需。至少覆盖：**同一 `providerEventId` 投递两次不产生第二次副作用且两次都返回 200**（返回非 2xx 会让支付商一直重试）；**不同 provider 的同名 eventId 不算重复**；**验签失败时不落 `PaymentEvent`**（否则攻击者能用垃圾请求占掉 eventId，导致真事件被当成重复而丢弃 —— 真实攻击面）；落库字段里**没有原始 payload**（PII） |
| 2 | **乱序测试** | "至少一次投递 + 不保证顺序"是七家共同前提 → 构造 `occurredAt` 更早但**后到达**的事件，断言状态**不回退** |
| 3 | 客户端按权益降级 | 🔴 **到期不许锁本地数据**（见 `subscription-boundary.md`「到期后的降级语义」——那是硬约束，不是偏好） |
| 4 | 真实支付测试模式门禁 | 依赖选型定稿（⚠️ 见 §5 的方向变更）。能做的是**官方 webhook 模拟器**把真实签名 payload 打进来 + 重投断言幂等；**做不到**真实扣款清算全自动 |
| 5 | ToS | 🔴 **卡在用户**：`server/legal/terms-of-service.md` 是 vendored 上游的**德语 AGB**，主体是另一家公司。补条款前先得有 heyta 自己的一份法务文本 |

## 5. 🔴 只有用户能做的两件事

1. **用中国身份真实注册一次 Paddle 卖家账号，走到 Account Verification。**
   政策文本允许（中国大陆不在 28 国不支持名单、individuals/sole traders
   免公司资质）**≠ KYC 实操放行**。这一步决定抽象层按谁写。
   若被拒 → 落回 Creem，但**必须接受"中国用户只能用卡/PayPal 付"**（Creem
   买家侧支付宝/微信标注 "coming soon"）。
2. **heyta 自己的法务文本**：运营主体 / 适用法律 / 退款政策。

## 6. 这个目标里已经踩过的坑（别重复）

| 坑 | 教训 |
|---|---|
| 提交实现却漏了测试 | `entitlement.ts` 进了 HEAD 而测试没进；报的测试数字**证明不了 HEAD** |
| 提交了并发 agent 未完成的共享文件 | `docs/README.md` / `package.json` / `THIRD_PARTY_LICENSES.md` 各中一次；**共享文件不能用「提交工作区内容」的方式提交** |
| `open(path,'w').write(insert(x))` | **`open(...,'w')` 在参数求值前就截断文件**；先算好字符串再写盘 |
| `git commit -- <path>` 不带未跟踪文件 | 新建文件必须先 `git add` |
| 把"商家能收款"当成"买家能付款" | Creem 的结论就是这么错的 —— **两个方向是不同的能力，要分开检查** |
| 本地绿、CI 红 | 干净检出 + UTC 才是真相 |

---

## 9. 两件"需要协调才能做"的收尾（不是技术问题，是共享工作区问题）

### 9.1 给 server 加 `@heyta/domain` 依赖（正解，但被挡住）

`server/src/billing/extend-period.ts` 是 `packages/domain/src/subscription.ts`
里 `extendSubscriptionPeriod` 的**镜像**，因为服务端**无法 import 它**：
`server/package.json` 的 dependencies 里没有 `@heyta/domain`，而相对路径 import
会撞 `rootDir`（TS6059）+ ESM/CJS 不匹配。

**镜像目前是安全的**：`billing-extend-period.spec.ts` 是漂移守卫，
它直接 import domain 那份源文件，把两份实现放在同一张用例表上比对。
**风险是被检测的，不是被假设的。**

正解：给 `server/package.json` 加 `"@heyta/domain": "workspace:*"`，
删掉 `extend-period.ts` 与漂移守卫，改为直接 import。

🔴 **为什么当时没做**：`server/package.json` 与 `pnpm-lock.yaml` 此刻**都有
另一个 agent 的未提交改动**（`server/package.json` 上是删掉 `prebuild` 那行；
lockfile 上还有 landing 页 agent 的改动）。改它们、尤其跑 `pnpm install`
去重写 lockfile，会把别人的在途状态一起搅进来。
**等这两个文件干净后再做，或者由正在改它们的那个会话做。**

### 9.2 让 AI / i18n 那批未提交改动进版本库

工作区里有一大批**功能上已完成且全绿**但未提交的改动：

- `packages/i18n/**`（**全新包**，17 个文件；`dist/` 与 `*.tsbuildinfo` 已被 gitignore）
- `packages/ai/src/{egress,health-store,index,provider,supply}.ts` + `tests/health-store.spec.ts`
- `apps/web/src/features/ai/{AiBreakdown,AiCapture,AiDuration,AiPrioritize}.tsx`
  + 三个新文件 `ai-failure-copy.ts` / `disclosure-copy.ts` / `locale-punctuation.ts`
- `packages/ai/tests/disclosure-shape.spec.ts`（新）
- `apps/{web,mobile,landing}/package.json` 与根 `package.json`

**实测全绿**：`check-ai-coverage` ✅ 4 个功能端到端可达、`check:ai-e2e` ✅ 11 passed、
`packages/ai` 144 passed、`apps/web` **465 passed | 12 skipped**（我前几轮报的 44 条红已清零）。

🔴 **为什么没有替它提交**：这不是一个能"按显式路径切出来"的提交 ——
AI 文件 import `@heyta/i18n`，所以 **`packages/i18n` 必须同一个提交**；
而那个包又需要 `apps/*/package.json` + 根 `package.json` + **`pnpm-lock.yaml`** 的
依赖声明。问题在于：

1. `server/package.json` 与 `pnpm-lock.yaml` 上**混着别人的在途改动**；
2. `apps/landing/package.json` 处于 **`AM`** 状态（既已 staged 又有未 staged 改动），
   它属于 landing 页那个 agent；
3. lockfile 是生成物，**没法像源码那样做"只挑我这几行"的切片** ——
   要么整个文件一起提交（带上别人的改动），要么不提交。

所以**提交它要么漏掉 lockfile 导致 CI 装不上，要么连别人的半成品一起署名**。
这两条都是这个仓库里已经犯过的错。**应该由正在改 i18n 的那个 agent 自己提交。**

### 9.3 已经做完的收尾（供对照）

- ✅ **金额校验**（`fb14eba`）：微信回调必须金额落在价目表上，否则**不授予**。
  详见 `docs/plans/subscription-boundary.md` §6 与代码注释里的强度上限说明。
- ✅ **本地凭证**：`server/.env`（0600、gitignore、git 看不见）已写入借用的
  `WX_*` 六个变量。⚠️ 是**别家公司的**，新凭证到位后替换并**停用旧的**。

