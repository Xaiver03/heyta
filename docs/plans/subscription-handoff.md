# 会员订阅：交接状态

> 状态：**进行中**。本文件只记「当前停在哪」，不重复决策 ——
> 决策见 [`subscription-boundary.md`](subscription-boundary.md) /
> [`subscription-integration.md`](subscription-integration.md) /
> [`subscription-provider-selection.md`](subscription-provider-selection.md)。
>
> 🔴 **当前答案在 [§10](#10-当前停在哪2026-10-21)** —— §1–§9 写于 2026-10-16 之前，
> 里面「选型未定」「只有用户能做的两件事」「ToS 卡住」那几格**已经过期**，
> 逐格见 §10.4。
>
> 最后更新：会话 `goal-192acbae` 第 13 轮（§1–§9）＋ 2026-10-21 的 §10。
> **§1–§9 那份文件存在的原因是：驱动它的 agent 上下文耗尽了，而后台还有一个 agent 在写未提交的代码。**

## 1. 已提交（在 `origin/main` 上，可信）

| 提交 | 内容 |
|---|---|
| `7a5a8c9` | `Subscription` 表 + 迁移 + `entitlement.ts` + **默认关**的运营者开关 |
| `00888f8` | 补上被漏提交的权益测试（8/8 绿）；`server/tests/{entitlement,entitlement-gate.routes}.spec.ts` |
| `166bbd9` | 选型结论翻转 → **Paddle 优先** |
| `5484b33` | 选型调研初版（部分结论已被 `166bbd9` 取代，但许可证陷阱与「抽象不掉的三处」仍有效） |

服务端测试：`59 files passed | 1148 passed | 1 skipped`。

## 2. ✅ 曾经「未提交」的那批 —— 现已全部落地（原样保留作记录）

> 🔴 **本节记录的是当时那一刻的状态，已被后续工作取代。**
> 下面列出的文件**现在全部已跟踪、已提交、且有测试**：
> `git ls-files server/src/billing/` 列出 13 个文件（含后来新增的
> `checkout.routes.ts` / `price-book.ts` / `coupon.ts` / `money.ts` /
> `pricing-store.ts` / `quote.ts` / `wechat.adapter.ts`），
> `server/tests/` 下有 10 个 `billing-*.spec.ts` +
> `wechat-adapter.spec.ts` / `pricing-cli.spec.ts` / `entitlement.spec.ts`。
> §4 第 1 条（billing 的测试）因此**已完成**，不再是待办。

```
（当时的工作区快照，勿再照此判断现状）
?? server/src/billing/                                    ← 6 个文件，全部未跟踪
     apply-event.ts  index.ts  noop.adapter.ts
     registry.ts  types.ts  webhook.routes.ts
?? server/prisma/migrations/20260927000000_add_payment_events/
 M server/prisma/schema.prisma                            ← PaymentEvent 模型
 M server/src/server.ts                                   ← webhook 路由注册
```

当时这些文件在磁盘上但**零测试**，所以写下了那条纪律：
**写完全部测试 → 一次跑通 → 再提交**。这条纪律**已经执行完** ——
现在它们是 `billing-apply-event.spec.ts` / `billing-webhook.routes.spec.ts` /
`billing-wechat.routes.spec.ts` / `billing-wechat-config.spec.ts` 等覆盖的对象。

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
| 1 | ~~**billing 的测试**~~ ✅ **已完成** | 🔴 必需。至少覆盖：**同一 `providerEventId` 投递两次不产生第二次副作用且两次都返回 200**（返回非 2xx 会让支付商一直重试）；**不同 provider 的同名 eventId 不算重复**；**验签失败时不落 `PaymentEvent`**（否则攻击者能用垃圾请求占掉 eventId，导致真事件被当成重复而丢弃 —— 真实攻击面）；落库字段里**没有原始 payload**（PII） |
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

### 9.1 ✅ 给 server 加 `@heyta/domain` 依赖 —— 已做完

> 本节原记的是一个"被共享工作区挡住"的正解。**它已经落地了**：
> `server/package.json` 的 dependencies 里现在有 `"@heyta/domain": "workspace:*"`；
> `server/src/billing/extend-period.ts` **已不存在**，
> 漂移守卫 `server/tests/billing-extend-period.spec.ts` 也**已不存在** ——
> 两边现在直接 import 同一份实现，镜像与守卫都不再需要。

（原记录：`extend-period.ts` 曾是 `packages/domain/src/subscription.ts` 里
`extendSubscriptionPeriod` 的**镜像**，因为服务端当时**无法 import 它**：
dependencies 里没有 `@heyta/domain`，而相对路径 import 会撞
`rootDir`（TS6059）+ ESM/CJS 不匹配。当时的漂移守卫是
`billing-extend-period.spec.ts`，它直接 import domain 那份源文件做逐条比对。）

🔴 **当时没做的原因（已解除）**：`server/package.json` 与 `pnpm-lock.yaml`
当时都有另一个 agent 的未提交改动。那两个文件现在已干净。

### 9.2 ✅ 让 AI / i18n 那批未提交改动进版本库 —— 已做完

> 本节原记的是一大批"功能上已完成且全绿、但未提交"的改动。**它们已经全部提交**：
> `packages/i18n/src/locales/{zh-CN,en}.ts` 等现在都被 git 跟踪
> （`git ls-files packages/i18n/src/locales/` 有输出），工作区干净。
> 下面是当时的清单，保留作记录：

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
  > 🔴 **后补（`9684d2a`）：这一层已不再是"终局判定"。** `verifyWebhook` 现在分成三种
  > 如实上报（实付 = 某档原价 → 授予该档；有实付但落不到档位 → 不授予但标
  > `requiresOrderSettlement: true`；无实付字段 → 标金额不匹配），
  > 权威判定只留在 `settleOrderPaid`（比订单冻结的 SKU 与实付）。详见
  > [pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7 第 9 条。
- ✅ **本地凭证**：`server/.env`（0600、gitignore、git 看不见）已写入借用的
  `WX_*` 六个变量。⚠️ 是**别家公司的**，新凭证到位后替换并**停用旧的**。
  > 🔴 **本条已过期**：微信直连那一家已经从收款通路里退场（`check:payment-entry`
  > 的渠道判据改指统一支付中心）。⚠️ 但**那六个值还在本机磁盘上** —— 删除/停用是
  > 一次运维动作，见 §10.3 第 5 格。

---

## 10. 当前停在哪（2026-10-21）

> 本节由「¥12 托管 AI 档做到真的能收钱且能交付」那一轮写下。**只写现状与现量命令**，
> 决策一律指向 ADR：收款通道见 [`ADR-0017`](../adr/0017-single-paid-tier-and-payment-channel.md)，
> 托管 AI 的可售卖前置与最新勘误见 [`ADR-0054`](../adr/0054-managed-ai-retention-and-selling-preconditions.md) §6/§8/§9/§10。

### 10.1 收款通路（¥5 与 ¥12 共用同一条）

- 通道是**同公司的统一支付中心**，不是 Paddle/Creem/微信直连。唯一的真 adapter 是
  `server/src/billing/paycenter.adapter.ts`；`registry.ts` 默认只注册 noop（fail-closed）。
  现量：`grep -n "paycenter" server/src/billing/registry.ts`
- 生产 compose 的白名单里带着那几枚键，**且运营者的 `.env` 真的能透进容器**
  （这一格以前是坏的：白名单没列 ⇒ 收了钱拿 503）。
  现量：`grep -n "PAYCENTER_ENABLED" server/docker-compose.yml`
- 门禁 `pnpm check:payment-entry`：**臂数由脚本自己打印**，判据两头有反臂
  （"能收钱却买不了"与"总闸开着凭证为空"都会红）。
- ⚠️ 有意设计成**全有或全无**：`PAYCENTER_ENABLED=true` 而三项凭证缺一 ⇒ 启动期硬错误。

### 10.2 ¥12 那一档做到哪一步

| 环节 | 状态 | 现量命令 |
|---|---|---|
| 客户端能不能下这一单 | ✅ 设置页有档位选择（两枚），发出去的体里只有 `priceId`，金额一律来自服务端 | `grep -n "renew-tier" apps/web/src/features/subscription/RenewPanel.tsx` |
| 会不会"收了钱交付不了" | ✅ 闸门 ②′：这一档授予 `ai` 而**这台实例**没配上游 ⇒ 冻结之前拒（`409 PRICE_NOT_SELLABLE` + `reason`），默认**拒** | `grep -n "managedAiConfigured" server/src/billing/checkout.routes.ts` |
| 买更低档会不会把已付费能力判小 | ✅ 闸门 ④′：`409 PRICE_TIER_LOSES_GRANTS`，同样在冻结之前 | `grep -n "PRICE_TIER_LOSES_GRANTS" server/src/billing/checkout.routes.ts` |
| 部署侧键位与运营者说明 | ✅ `MANAGED_AI_*` 四枚进 compose 白名单，`env.example` 有能照填的一段 | `grep -n "MANAGED_AI_ENABLED" server/docker-compose.yml` |
| 设置页的 own/managed 开关 + 「本周期已用 X / 300」 | ✅ ADR-0054 §9.3 的前两件 | ADR-0054 §10.1 那张表 |
| 真浏览器判据 | ✅ `e2e/tests/renew-panel.spec.ts` 五条（档位、换档清旧单、拒降档、503、只用本机零请求），且每条都按 §6.2 规定一第 3 条抓 `console`／`pageerror`／非 2xx | `cd e2e && npx playwright test tests/renew-panel.spec.ts` |

🔴 两道闸门都**不许**改成"按比例折算"：`applyOneTimeGrant` 是一 `(userId, provider)`
一行、整行替换 `grants`、只有一枚 `currentPeriodEnd`，那个形状表达不了半程升级。

### 10.3 仍缺什么（每格都写了归谁）

1. **真实上游凭据没填 ⇒ 这一档现在**卖不出去**（不是"卖出去用不上"了）** —— 归运营。
   填了 `MANAGED_AI_*` 三项才算开；没填的现场形状是 ¥5 照卖、¥12 拿 409。
   现量：`grep -n "MANAGED_AI_UPSTREAM" server/env.example`
2. **对外法务文案那句「这一档仍打不开」** —— 归法务/负责人点头，**本轮刻意没动**。
   为什么它现在是一句偏保守的过期陈述、以及翻案条件，写在 ADR-0054 §10.3。
   现量：`grep -rn "这一档仍打不开" packages/legal/src/documents`
3. **托管档不转发 `tools`** ⇒ 不许对外宣传"对话式助手"。现量：
   `grep -c "tools\|tool_choice" server/src/ai/managed-proxy.routes.ts`（回 `0` 即仍未转发）。
   要拍的板在 [`launch-blockers.md`](launch-blockers.md) §3.2。
4. **45 天过期清理作业线上是否在跑** —— 代码在（`purgeExpiredAiUsageCounters` 挂 cleanup 第 8 段），
   生效要服务端镜像重建。⚠️ 这是**部署态**，本机量不到，不许读成"已在保"（ADR-0054 §8 那条部署顺序）。
5. **本机 `server/.env` 里还躺着别家公司的 `WX_*` 六个值** —— 收款通路已经不用那一支了，
   凭证该停用并删除。归运维（不在本仓，git 看不见它）。
6. **管理后台的权益撤销面**：退款那一格**已经有面**（`refunds` tab + `GET/POST /api/admin/refunds`，
   现量 `grep -n "'refunds'" apps/web/src/features/admin/AdminPanel.tsx`）；
   缺的是**运营者手工撤销某用户权益**的那一枚控件 —— 归产品，不在本轮范围。

### 10.4 §1–§9 里已经过期的格子（别照它们判断现状）

| 格子 | 为什么过期 |
|---|---|
| §1 那张提交表 + 「服务端测试 59 files…」 | 那是 2026-10-16 之前的快照；现量走 `git log` 与 `pnpm -r test`，别抄这里的数 |
| §4 第 4 条「真实支付测试模式门禁…依赖选型定稿」 | 选型已定（ADR-0017）；Paddle/Creem 只剩注释里的论证理由，代码里没有它们的 adapter |
| §4 第 5 条「ToS 卡在用户：先得有 heyta 自己的一份法务文本」 | 文本已经有了：`packages/legal` 是对外法律文本唯一事实源。⚠️ 这一格**改成了"等法务复核"**，不是"没有文本" |
| §5 第 1 条「用中国身份注册 Paddle 卖家账号，走到 Account Verification」 | **作废**：收款走自家支付中心，不再经 Paddle |
| §5 第 2 条「heyta 自己的法务文本」 | 同上，文本已在，待的是复核与生效 |
| §9.3 第二条「本地凭证已写入借用的 `WX_*`」 | 见 §10.3 第 5 格：通路已换，值还在盘上 |

### 10.5 本轮之后剩下的动作（按谁能做分）

- **运营/运维**：填 `MANAGED_AI_*`（+ 确认 `PAYCENTER_*`）→ 重建镜像 → 用一次真实小额下单验通路与到账回执；删掉本机旧的 `WX_*`。
- **法务/负责人**：过一遍 `packages/legal`（含把"这一档仍打不开"按 §10.3 第 1、3 格的前提改掉）。
- **我方下一轮能自己做**：管理后台权益撤销控件（§10.3 第 6 格）、`tools` 转发的工程侧方案（先出计划，拍板归负责人）。
- ⚠️ **两枚远端现在不对称**（不是本线的事，但会影响"以哪枚为准"）：`gitee` 从今天起收不进任何 push
  —— 它的仓库体积过了自家 1024MB 配额。`origin`（GitHub）是**当前**的那一枚。
  现量：`git fetch gitee main && git fetch origin main && git rev-parse --short gitee/main origin/main`。
  🔴 **两条便宜路已被现量否证**：GC 没用（`main` 单独打包就 **1094.8 MiB**，gitee 整仓 1108.059 MB ⇒ 不可达的只有约 13 MB）；
  gitee 上也没有陈旧 ref 可删（`git ls-remote gitee` 只回两行）。
  **唯一保住这枚镜像且不丢任何当前文件的路**是把两枚全死的前缀请出历史
  （`.pnpm-store/` 187.3 MB + `research/standalone/.npm-cache/` 130.2 MB = **317.5 MB**，两者在 HEAD 里都是 **0 条路径**），
  代价是**双端强推**重写所有下游克隆 ⇒ 归负责人拍。证据、分母口径与五步预案在 `BLOCKED.md` 的 **B243 追记**。

