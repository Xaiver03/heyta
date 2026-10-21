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
| 真浏览器判据（**只有 web 那一枚**） | ✅ `e2e/tests/renew-panel.spec.ts`（**条数由 Playwright 自己打印，别在这里抄**；18:4x 现量 **6 passed / 36.0s**）：档位、换档清旧单、**①′ 拒卖**、④′ 拒降档、503、只用本机零请求，且每条都按 §6.2 规定一第 3 条抓 `console`／`pageerror`／非 2xx。🔴 **′ 那一格是 2026-10-21 才补上的**：此前服务端有那个码、app-host 有那个码、面板里也写了映射，**但没有任何一条判据跑过这一屏** —— 而它恰恰是这台实例今天真会返回的那一支。牙已验过：把那行映射改指 `…fail.unknown` ⇒ 当场红在这一条上（跑完按 sha256 逐字节还原） | `cd e2e && HEYTA_NO_FOCUS=1 npx playwright test tests/renew-panel.spec.ts` |
| 🔴 **移动端那枚档位选择的证据到哪一步** | ⚠️ **只有形状判据，没有截图腿**。`apps/mobile/tests/renew-entry.spec.ts` 钉的是源码形状（档位取自 `CHECKOUT_TIERS.map`、不写死 priceId、屏上不写 `¥`/`$` 金额、同意闸门排在下单之前），行为那一半在 `packages/app-host/tests/checkout.spec.ts`。形状断言自己的牙已经落成件：`pnpm check:mobile-renew-shape` 四条臂各注入一次真实坏法。所以「移动壳有档位选择」这句话现在**只到"接线在 + 判据能红"，不到"画出来了"** —— §6.2 规定一要的图一张都没有（现量分母：`find . -iname "*renew*" -not -path "*/node_modules/*"` 里**全部**是 web 侧的 png） | `pnpm check:mobile-renew-shape`；`pnpm --filter @heyta/mobile test tests/renew-entry.spec.ts` |
| 两道闸门有没有**能复跑的反臂** | ✅ `scripts/mutate-checkout-tier-gates.mjs`：逐臂把 `checkout.routes.ts` 改坏，要求具名用例变红；已进 `pnpm check` 链（不进链就是孤儿，`check:gate-wiring` 判这条）。🔴 **2026-10-21 18:0x 补的 C6 管的是第三种坏法，前面那些臂碰不到**：既有臂抓「该拒的没拒」和「不该拒的拒了」，而**把守卫写得比该拒的更宽**这一支两种都测不到 —— ④′ 的正确形状是**非对称**差集（只有已有能力被这单**判小**才拒），写成对称差（两个集合不相等就拒）时那批 409 用例**一条都不会红**，可 ¥5 的用户从此永远升不到 ¥12，而且没人知道。⇒ 一个方向有牙，另一个方向也得有牙；臂数与用例数都由脚本自己打印，别在这里抄 | `pnpm check:checkout-tier-gates`；那条 200 用例现量 `grep -n '升档' server/tests/billing-checkout.routes.spec.ts` |
| 🔴 **那五张截图在不在仓里**（干净检出看不看得到；标题留着是因为 `PROGRESS.md` 有一条按它反查，**现量是六枚**） | ✅ 2026-10-21 起在 `apps/web/evidence/`，**六枚**（18:4x 新增 `renew-panel-not-sellable.png` ＝ 闸门 ①′ 那一屏，**人已看过**：选中的是「官方托管 + 云端 AI」，屏上写「这一档现在还不能卖，服务端拒绝了这笔下单。」，无裸码、无支付串、无订单卡）。⚠️ **"与 `e2e/test-results/` 逐字节相同"只对入库那一戳成立** —— 18:4x 按 §6.2 复跑这套件（**6 passed / 36.0s**，`HEYTA_NO_FOCUS=1`）之后现量比对：**5 枚 DIFF、1 枚 SAME**（SAME 那枚是刚复制进去的新图），成因是**那一趟的有效期时间戳印在图里**（屏上那行「这一单在 … 之前有效」每跑一次换一个值）⇒ **逐字节比对只在同一趟内成立**，别拿它当"界面坏了"的判据；剩下的像素差**没有逐枚归因**（判外观回归要看图，不是看哈希）。🔴 **本轮自己撞上的一枚假读数（比上面那条更要防）**：`e2e/test-results/` 每次跑都被 Playwright **清空** —— 我为了验新用例有没有牙跑了一枚变异探针，上一趟那五枚当场消失，这把 `cmp` 尺立刻把"文件不在"读成"内容变了"（回 5 枚 DIFF，其中一枚其实只是**没跑过**）。⇒ 两条规矩：**跑变异探针要带 `--outputDir` 指到别处**；拿 `test-results` 当对照之前先 `ls test-results/*.png` 数一遍，枚数要等于用例数。⚠️ 这一格此前是**空的**：套件的固定落点被 `.gitignore` 的 `test-results/` 那条挡着，而仓里跟踪的那三枚同名图是 **10-05 那一代 —— 屏上根本没有档位选择**，谁按文件名去读都会读到旧产物。**其余五枚没拿新图覆盖**：两批界面内容相同、只差时间戳，而每刷一代多约 500 KB 历史（正是 B243 那枚配额压力的来源） | 复跑：`cd e2e && HEYTA_NO_FOCUS=1 npx playwright test tests/renew-panel.spec.ts`；比对：`for f in order downgrade no-consent no-channel tiers not-sellable; do if cmp -s apps/web/evidence/renew-panel-$f.png e2e/test-results/renew-panel-$f.png; then echo "$f SAME"; else echo "$f DIFF"; fi; done` |
| 🔴 **两壳的失败码表与服务端能返回的码之间还差三枚"真会到达"的**（2026-10-21 19:0x 按同一把差集尺查出来的第三处，登记、不代写文案） | 服务端这条路由能返回 **10 枚**码（现量见右侧第一条），两壳的映射表只有 6 枚 / 5 枚 ⇒ 差集里逐枚判可达性：**不可达**（两壳请求体只有 `priceId` 与可选 `couponCode` ⇒ 走的是 `DEFAULT_CURRENCY`／`DEFAULT_REGION`）：`UNSUPPORTED_CURRENCY`、`UNSUPPORTED_REGION`、`INVALID_BODY`、`UNKNOWN_PRICE`（档位取自 `CHECKOUT_TIERS`，除非两张表分家）；**真会到达**：`CHECKOUT_FAILED`（通道侧下单失败，502）、`PRICE_NOT_EFFECTIVE`（报价失败＝价格簿里没有可卖的价，配置问题）、`PROVIDER_CURRENCY_UNSUPPORTED`（在册通道不支持那枚币种）。⇒ 这三枚今天落到 `…fail.unknown`，屏幕上印的是「下单失败（CHECKOUT_FAILED）。」——**把服务端内部标识当文案**。⚠️ **为什么本线不顺手补这三句**：那是**对用户陈述钱的状态**（钱扣没扣、单在不在），归产品/文案定口径；不是"找不到句子"。句子要的事实**仓里已可证**：`CHECKOUT_FAILED` 那一支在返回之前已经 `failOrder`（订单判失败、券的预留名额已释放，见 `checkout.routes.ts:433-441`），而 `PRICE_NOT_EFFECTIVE` 那一支**从未报出任何金额**（`:380` 那句 Logger 就是为这件事写的）⇒ 谁定文案，依据在这一格里。📌 本轮已补的是**闸门自己那两枚**（`PRICE_NOT_SELLABLE` 两壳 + `PRICE_TIER_LOSES_GRANTS` 两壳）——那两枚是本线造的码，不补就是本线的缺陷；这三枚早于本线 | 差集：`grep -oE "code: '[A-Z_]+'" server/src/billing/checkout.routes.ts | sed "s/code: //;s/'//g" | sort -u`，对照 `sed -n "/const FAILURE_KEYS/,/^};/p" apps/web/src/features/subscription/RenewPanel.tsx apps/mobile/src/screens/RenewSection.tsx`；可达性：`grep -n "const body: Record" packages/app-host/src/checkout.ts`（请求体只有两项） |
| 🔴 **闸门 ① 只看 `ai`、不看这一档同时授予的 `automation` —— 这是有意的，别"顺手补全"** | 这一档的 `grants` 是三枚（`hosting`/`ai`/`automation`），而 `automation` 按 [`ADR-0060`](../adr/0060-automation-entitlement-and-retention.md) 的发布门槛**今天还不许对外承诺**（六条有名字的缺口，见 [`pricing-and-entitlements.md`](../reference/pricing-and-entitlements.md) §2.2）。但同一节 ADR-0060 第一句就写着「**现有 AI 档的既有购买能力不因本功能开发而关闭**」，而它管的是**对外承诺**那一层 —— 落地页 ¥12 那三条 feature **没有一条提自动收集**（现量 `grep -n "landing.pricing.hostedAi.feature" packages/i18n/src/locales/zh-CN.ts`），CTA 仍是「即将开放」。⇒ **不许**把"automation 未闭合"接进闸门 ① 变成拒卖 ¥12：那是把 ADR-0060 的"门"读成"禁售"，与 ADR-0054 的解除顺序相反。真要让 ¥12 不授予 `automation`，那是**改商业裁决**（归负责人），不是改闸门 | `grep -n "既有购买能力不因本功能开发而关闭" docs/adr/0060-automation-entitlement-and-retention.md`；`grep -c '^- \[x\] \*\*AC-' docs/plans/inbound-automation.md`（回 `0`＝那六条仍未闭合） |
| 📌 **本线收口那一戳的读数**（2026-10-21 10:4x 首取，**17:1x 在新 tip 上逐条复取**，**18:0x 在补了升档那条用例之后再取一次**；**瞬时读数，别当判据抄，要就现量**） | 六道门各 **rc=0**：`check:ai-quota`／`check:payment-entry`／`check:server-env`／`check:i18n-vars`／`check:checkout-tier-gates`／`check:mobile-renew-shape`；文档四道 **rc=0**：`check:docs`／`check:md-tables`／`check:doc-citations`／`check:gate-wiring`；`pnpm typecheck` ~~**rc=0**~~ ⇒ **18:0x 复取 rc=2**，两行报错逐字都在协作线**尚未跟踪**的在飞新件 `packages/app-host/src/share-rekey.ts`（`:170`/`:199` 两处 `new ShareKeyUnavailableError()` 少一个实参），本线那两枚改动文件零命中，归因与"为什么本线不代改"见 [BLOCKED.md](../../BLOCKED.md) **B245**；四份相关 spec 全绿（服务端 `billing-checkout.routes` ~~22~~ ⇒ **18:0x 起 23**、`app-host/checkout` 16、移动 `renew-entry` 8、web `renew-panel.spec.tsx` 19）。⚠️ **复取那一戳取在 `d9406b134`，它上面叠着共享清单线两笔**（`58873b2b3`／`d9406b134`）：这两笔对本线文件**零命中**（现量 `git diff --name-only 29dec6d2b d9406b134 \| grep -E 'billing\|checkout\|RenewPanel\|RenewSection\|entitlement\|price-book' \| wc -l` 回 **0**）⇒ 那六门与四份 spec 绿的是"合上别人代码之后仍然绿"，比首取那一戳更强。**为什么 17:1x 要重跑一遍**：本线在 10-21 又落了一笔文档提交（台账 166），tip 一变，上一戳那串数就成了别人产物上的数——这正是仓里"读数要带 tip"那条纪律的用场。⚠️ **同一条 `pnpm check` 大链此刻仍红**，红在 `check:image-license` —— 那是**别线的预存红**，成因与"为什么本线不修"写在 [BLOCKED.md](../../BLOCKED.md) 的 **B244** | `for g in check:ai-quota check:payment-entry check:server-env check:i18n-vars check:checkout-tier-gates check:mobile-renew-shape; do pnpm "$g"; echo "rc=$?"; done`（**逐条跑**，别并发：本机有全局测试互斥） |
| 🔴 **④′「变宽不许拒」那一半到 2026-10-21 18:0x 才有牙**（本线第 1 步自己补的格） | 收口那一趟 ④′ 只有**降档**方向具名（`¥12 有效期内点 ¥5 ⇒ 409`），**升档方向没有任何判据钉着**：把守卫写成对称差（两个集合不相等就拒）时整套用例全绿，而 ¥5→¥12 从此静默变拒单 —— 这一档恰恰是最该被升上来的那一档。⇒ 补了一条 **200 用例**（`¥5 有效期内点 ¥12（升档）⇒ 200`，断言不止状态码：还断言 `checkout_orders` 里**真冻上了一枚**，否则"放行"只是响应码）+ 臂 **C6**。18:0x 实测：阳性对照 **23/23 绿**，六臂**全被具名判据抓到**，而 C6 的红集合**恰好只有升档那一条** ⇒ 这条用例是该方向唯一的牙，不是冗余。⚠️ **顺手量到的一条会影响下一位的事实**：`server/tsconfig.json` 的 `include` 只有 `src/**` 与 `scripts/**` ⇒ **`server/tests/**` 不在任何 typecheck 射程内**（`pnpm typecheck` 从不编译它），所以那 23 条的类型安全只由"vitest 真跑过"保证；拿 ad-hoc `tsc` 单编这枚 spec 会回 3 条报错，其中两条落在 `:58`/`:128` 的**既有夹具**上（本线这次的改动纯追加在 `:520`），别误读成"新用例编译不过" | `pnpm check:checkout-tier-gates`（臂数与用例数由它自己打印，别抄）；`cd server && npx vitest run tests/billing-checkout.routes.spec.ts`；`grep -n '"include"' server/tsconfig.json` |
| 🔴 **移动壳此前会把闸门 ① 的机器码当人话印出去**（2026-10-21 18:3x 补，本线第 2 步自己漏的那一格） | web 侧两枚码各有一句词条（`web.subscription.renew.fail.sellable` 与 `…downgrade`），而移动侧 `FAILURE_KEYS` **只补了降档那一枚** —— 于是这台实例没配托管上游时（**闸门 ① 恰恰是今天生产上真会触发的那一支**），手机上印的是「下单失败（PRICE_NOT_SELLABLE）。」：把服务端机器码当文案给用户看。⇒ 补 `mobile.entitlement.renew.fail.sellable`（两份 locale 各一条，值与 web 同句）+ `FAILURE_KEYS` 那一行 + 一条具名用例（连两份 locale 里键在不在一起查），并给 `check:mobile-renew-shape` 加臂 **R5**（删掉那行映射 ⇒ 必须红在新用例上）。18:3x 实测：载体 **9/9**、**5 臂全被具名判据抓到**、`check:i18n-vars`／`check:payment-entry`／`check:ai-quota`／`check:server-env`／文档四道各 **rc=0**；`apps/mobile` 的 tsc 从 1 枚红到 0（红因不是代码，是**改词条没重建 `@heyta/i18n`、各壳读的是陈旧 `dist/*.d.ts`** ⇒ 已落成环境陷阱 **#514**，并在 `docs/agents/commands.md` 那条 `pnpm -r typecheck` 旁边留了指针） | `pnpm check:mobile-renew-shape`（臂数与用例数由它自己打印）；`grep -n "PRICE_NOT_SELLABLE" apps/mobile/src/screens/RenewSection.tsx`；`grep -c "mobile.entitlement.renew.fail.sellable" packages/i18n/src/locales/zh-CN.ts packages/i18n/src/locales/en.ts`（两份各回 1） |
| 🔴 **push 这一半要如实说的两件事**（本线第 6 步的交付声明，不是待办） | ㈠ **推 `main` 会连带发布本工作树里他人会话的本地提交** —— 这不是抽象风险：17:2x 那一趟射程是 **4 笔**（本线 1 笔 + 协作线 3 笔），pre-push 两臂扫完整射程（文件名臂：私钥形状新增/改名 **0**；字节臂：diff **1156** 行 × 在册值 **21** 枚 ⇒ **0** 命中）才放行。⇒ **规矩**：推之前先 `git log --oneline origin/main..HEAD` 数一遍射程，别按"我只改了一枚文档"假设。㈡ **两枚远端今天不对称，且不会自己变好**：`origin/main` 已含本轮全部，`gitee/main` 停在 `0da2185e4`，差距现量 `git rev-list --count gitee/main..HEAD`（17:2x 回 **27**）；同一趟复推 gitee 逐字 `Repo size: 1108.906MB, exceeds quota 1024MB`（00:5x 1107.402 → 16:3x 1108.828 → 17:2x 1108.906，**一天涨约 1.5 MB**，量级等于文档提交本身）⇒ **任何"以 gitee 为准"的下游读到的是旧 `main`**，出路四条与"谁拍"在 B243 追记三 ⑧ | `git log --oneline origin/main..HEAD`；`git rev-list --count gitee/main..HEAD`；`git push gitee refs/heads/main:refs/heads/main`（**显式点名 refspec**：本仓 `main` 的上游配的就是 gitee，裸 `git push` 必失败，见 B243 追记二） |
| 🔴 **18:1x 那一趟 push 的射程与两枚远端**（承上一行那两件事 —— 上面那两个数是 17:2x 那一戳的，别当现在的读数） | ㈠ 这一趟推之前 `git log --oneline origin/main..HEAD` 回 **1 笔**（就是本线那笔反臂 C6 的提交）⇒ **这一趟没有连带发布任何他人提交**：协作线的内容此刻全部在工作树里**未入库**（`?? packages/app-host/src/share-rekey.ts`、`M packages/app-host/src/index.ts`、`M server/src/shares/share.routes.ts`），我的推送带不出去它们。⚠️ 但这条结论**只对这一戳成立** —— 上一行记的 17:2x 那一趟射程是 4 笔，同一命令在别的时刻完全可能又是多笔 ⇒ 规矩不变：**每次推之前重数一遍**。pre-push 两臂这一趟的读数：待推 **1** 笔、diff **73** 行、在册值 21 枚 ⇒ **0 命中**。㈡ 同一趟复推 gitee 逐字 `Repo size: 1110.324MB, exceeds quota 1024MB`（17:2x 1108.906 ⇒ 18:1x 1110.324）；**18:2x 再复推回 1112.711MB** ⇒ 这一串增量与我的提交尺寸不成比例（一笔 5 行的文档提交之后 +2.4 MB），所以它**不是**"每推一笔涨多少"的规律，上一行那句"一天涨约 1.5 MB"只是那一戳的拟合，别拿它外推配额什么时候不够，差距现量回 **36** 笔 ⇒ **两枚远端不对称继续成立**，出路四条仍等负责人那一句（B243 追记三 ⑧） | `git log --oneline origin/main..HEAD \| wc -l`；`git rev-list --count gitee/main..HEAD`；`git push gitee refs/heads/main:refs/heads/main`（**显式点名 refspec**）；两枚远端 SHA 现量**一枚一条命令**取（`git rev-parse --short origin/main`、`git rev-parse --short gitee/main`；一条命令里给两枚会报 `Needed a single revision`） |
| 🔴 **18:4x 那一趟 push 连带发布了别人的 4 笔**（这一戳的射程不再是 1 笔，如实记） | 推之前 `git log --oneline origin/main..HEAD` 回 **5 笔**：本线 1 笔（移动壳那枚机器码修复）+ **协作线 M3-a…M3-d 4 笔**（`7cf8ade5c`／`dde36ec40`／`42714cb07`／`4c7a2d9b5`，换钥与撤销那族）⇒ 它们**已经跟着我的推送公开了**。这是本线第 6 步授权的动作（任务书原文："推送会连带发布本工作树里他人会话的本地提交"），但**下一位别把它读成"每次都只有 1 笔"**：18:1x 那一趟是 1 笔，这一趟是 5 笔，差别只在别人有没有在这期间入库。pre-push 两臂这一趟扫的是**整个射程**：文件名臂私钥形状新增/改名 **0**；字节臂 diff **1684** 行 × 在册值 21 枚 ⇒ **0 命中**（新增行与删除行都比过）⇒ 这 4 笔里没有首次公开的在册值。gitee 同一趟仍被配额拒（`Repo size` 见上一行那串，出路四条仍等负责人拍，B243 追记三 ⑧） | `git log --oneline origin/main..HEAD`（**推之前跑，不是推之后**）；`git push origin refs/heads/main:refs/heads/main` |

⚠️ 那套臂里 C3 钉的是**默认值**那一支（`options.managedAiConfigured ?? false`）。
`billing-checkout.routes.spec.ts` 的 `buildApp` 自带 `managedAiConfigured: true`，所以**每一条**
既有用用例都不经过那句默认值 —— 没有这一条用例和那条臂，把默认翻成 `?? true`（"忘了传也算配好了"）
整套件照绿。生产那处注册点**是**传了的（`server.ts` 里 `fullConfig.managedAi !== undefined`），
现量：`grep -n "managedAiConfigured" server/src/server.ts`。

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
7. **移动端续费那一屏没有截图腿**（§6.2 规定一那一格）：形状判据与它的臂都在（见 §10.2 那行），
   但"画出来了"这件事**没有任何一张图证过**。补它要走模拟器那条腿：Metro 打当前源码 → iOS/Android
   起壳 → ProfileScreen 滚到续费那块 → 截图并**人眼看**（前置与命令见
   [`docs/agents/ui-acceptance.md`](../agents/ui-acceptance.md) 规定一第 1、2、4 条与
   [`docs/plans/product-ux-optimization.md`](product-ux-optimization.md) 的设备腿台账；
   ⚠️ 启动必须带 `HEYTA_NO_FOCUS=1`，不许抢前台）。归我方，工作量在设备那条腿而不是代码。
   ⚠️ 现量（为什么不能拿手边那张旧图交差）：`grep -o 'mobile.entitlement.renew.tierTitle' apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app/main.jsbundle | wc -l` 回 **0** —— 那枚 10-20 的包**里根本没有档位选择**，用它拍图就是拿旧产物冒充当前产物。
   🔴 **这一格原先用的探针被本会话自己否证并换掉了**（10-21 17:3x）：旧写法拿 `renew-tier-hostedAi` 当针，而源码里那枚 `testID` 是**模板拼出来的**（现量 `apps/mobile/src/screens/RenewSection.tsx:107` = `` testID={`renew-tier-${id}`} ``）⇒ **任何构建都取不到非零**，那是一枚永远 0 的探针，它给的"旧包没有档位"其实没证成任何东西。换的针是**词条字面**：同一枚包里 `mobile.entitlement.renew.payHint`（10-05 进源码）出现 **1** 次，而 `…tierTitle`（10-21 00:31 进源码，`git log -S` 现量）出现 **0** 次 ⇒ 打包确实保留这类键字面，"0"才真的是"这一版没有"。
   🔧 **这一腿的前置比看上去小，四项都已现量**（写给下一个接手的人，省得重新推）：
   ① **不需要先造一笔存量订阅** —— 那块整块的唯一渲染闸门是"同意出境"（现量 `grep -n "networkAllowed()) return null" apps/mobile/src/screens/RenewSection.tsx`），所以只要登录进去 + 同意出境就画得出来；
   ② 挂载点在 Profile 那一屏（现量 `grep -n "<RenewSection" apps/mobile/src/screens/ProfileScreen.tsx`），滚到权益那块下面就是；
   ③ iOS 那条腿**不走 Android 的 uiautomator**，走 `scripts/tools/ios-ax-shim.py`（现量 `grep -n "IS_AX_SHIM" scripts/verify-mobile-ios.sh`），preflight 照 `scripts/verify-mobile-ios.sh` 抄；
   ④ 那枚装置开头有一道**新鲜度门**：产物 bundle 的 mtime 必须 ≥ 最新源码 mtime，否则判红（现量 `grep -n "BUNDLE_MTIME" scripts/verify-mobile-ios.sh`）⇒ **先 `pnpm build:ios` 再拍**，别拿旧包凑。
   ⑤ **同一棵 build 目录下有两枚形状不同的 jsbundle，计数不许混**（10-21 17:4x 现量）：`apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app/main.jsbundle`（**10.4 MB，Hermes 字节码**，`grep` 对它报 "Binary file matches"）与它外面那枚 `Release-iphonesimulator/main.jsbundle`（**16.9 MB，dev JS**，含 `__DEV__`）。同一枚针 `mobile.entitlement.renew.payHint` 在两处分别出现 **1** 次与 **3** 次 ⇒ **报数必须写清是哪一枚**；装置读的是前者（现量 `grep -n "INSTALLED_APP" scripts/verify-mobile-ios.sh`）。
   ⑥ ✅ **那枚新探针的"非零那一支"已经实测到了**（2026-10-21 18:2x 补跑）。17:4x 那一戳没跑的理由留着，它是量出来的：`vm_stat` 的 free **0.3 GB**、`sysctl vm.swapusage` 全 **0**（swap 都没启用），同一时刻另一个项目正在跑 `node --test` ⇒ 这时起 Metro 要么被本机那道按 rss 的闸门掐掉、要么把那趟吃进去。18:2x 余量升到 free **约 2.9 GB**（`vm_stat` 的 free 174288 页 × 16 KiB），两行命令跑完：`cd apps/mobile && npx react-native bundle --platform ios --dev false --entry-file index.js --bundle-output /tmp/current.jsbundle`（**只写临时目录、不碰装机产物**；产物 9,142,434 B）⇒ `grep -o 'mobile.entitlement.renew.tierTitle' /tmp/current.jsbundle | wc -l` 回 **3**，兄弟键 `…payHint` 同样 **3**，而随手编的一枚不存在的键回 **0**（⇒ 这枚针不是"谁都命中"）。⚠️ **别把这一条读成"设备腿闭合了"**：上面量的是 **Metro 直出的 JS 包**，而 `scripts/verify-mobile-ios.sh` 读的是装机里那枚 **Hermes 字节码**（同目录两枚形状不同，见 ⑤）⇒ 这一条证的只是"词条在打包产物里可达、探针形状选对了"；**截图腿仍缺**，它要模拟器或真机，不是这一趟能自决的。
   ⚠️ 若为这件事新写一枚验收脚本，它**必须有载具**（进 `pnpm check` 链或进四名册），否则 `check:gate-wiring` 判它是孤儿门 —— 设备腿进不了链，那就得同时决定它进哪本名册，别写完就丢。
8. **未同意出境时，被本机闸门拦下的读请求在界面上写成"没能加载"** —— 归 UX 线，本线只登记不代改。
   证据是一对**只差一个变量**的图（同一套件的 `accepted` 与 `local-only` 两条用例）：
   `apps/web/evidence/renew-panel-no-channel.png` 里通行密钥那块是正常的空态「这个账号还没有注册通行密钥。」，
   而 `apps/web/evidence/renew-panel-no-consent.png` 里同一块变成红字「没能加载通行密钥列表。」——
   真实原因是**根本没发那个请求**（闸门在调用之前，见 `apps/web/src/features/privacy/consent-gate.ts`
   开头那句"未同意时底层次数必须是 0"，现量 `grep -n "底层次数必须是 0" apps/web/src/features/privacy/consent-gate.ts`），
   可界面说的是"加载失败"。用户读到的是"这东西坏了"，不是"我还没允许它联网问"。
   同一类还有几处（**别只修通行密钥那一处**）：`common.profile.loadFailed`、`common.emailChange.loadFailed`、
   `web.inbox.error` —— 现量：`grep -rln "networkAllowed" apps/web/src/features` 逐枚判它有没有区分"没问"与"问失败"。
   要拍的板是文案与形状（要不要一句"还没同意，点这里去同意"的出口），不是判据口径。

### 10.4 §1–§9 里已经过期的格子（别照它们判断现状）

| 格子 | 为什么过期 |
|---|---|
| §1 那张提交表 + 「服务端测试 59 files…」 | 那是 2026-10-16 之前的快照；现量走 `git log` 与 `pnpm -r test`，别抄这里的数 |
| §4 第 4 条「真实支付测试模式门禁…依赖选型定稿」 | 选型已定（ADR-0017）；Paddle/Creem 只剩注释里的论证理由，代码里没有它们的 adapter |
| §4 第 5 条「ToS 卡在用户：先得有 heyta 自己的一份法务文本」 | 文本已经有了：`packages/legal` 是对外法律文本唯一事实源。⚠️ 这一格**改成了"等法务复核"**，不是"没有文本" |
| §5 第 1 条「用中国身份注册 Paddle 卖家账号，走到 Account Verification」 | **作废**：收款走自家支付中心，不再经 Paddle |
| §5 第 2 条「heyta 自己的法务文本」 | 同上，文本已在，待的是复核与生效 |
| §9.3 第二条「本地凭证已写入借用的 `WX_*`」 | 见 §10.3 第 5 格：通路已换，值还在盘上 |

### 10.5 「今天卖不出去」这句话在仓里有几种形状（改口的与**刻意**留着的全列在下面，条数别在这里抄）

⚠️ 这一类**没有任何门禁会红**：`check:pricing` 与 `check:ai-quota` 钉的是**数字与键**
（价目、`grants`、额度），不钉散文里的通道名与"能不能买"。现量：
`grep -rl "WECHAT_PAY_ENABLED" scripts research/tools` 只回 **1** 枚（`scripts/check-payment-entry.mjs`，
它读的是 compose，不是这些文档）。⇒ **同一个结论被抄成几句句子时，每句都要各自维护。**

| 落点 | 本轮怎么处理 | 为什么 |
|---|---|---|
| `docs/reference/pricing-and-entitlements.md` §1 那三行「现在能买吗」 | ✅ **已改口**：从「🔴 还不能」改成「代码侧已通，卡在这台实例的**部署态**」（¥5 一件、¥12 两件），并删掉「客户端还没有付款按钮」——那句与**同一文件** §5.1 早在 10-05 划掉的内容自相矛盾 | 它是价目与权益的唯一事实源，别人会照它判断"能不能收钱" |
| 同文件 §5.1 的通道名 | ✅ **已更正**（加了一段 dated 引用，不删原文）：现在注册的是**支付中心**，微信直连**不再注册**（设 `WECHAT_PAY_ENABLED=true` 是启动期硬错误） | 原文讲的是"这条链什么时候通的"，那是历史；通道名是当下 |
| `docs/plans/launch-blockers.md` 顶部那句「今天什么都还卖不出去」的归因 | ✅ **已改口**：`WECHAT_PAY_ENABLED` → `PAYCENTER_ENABLED`，并补上 ¥12 那一档**叠着的第二件**部署态（`MANAGED_AI_*`） | 那是一份**待办清单**，读它的人要据此决定下一步 |
| `docs/adr/0026` §里的「`WECHAT_PAY_ENABLED` 未设 ⇒ 只有 noop」、`docs/adr/0053`:158 同形 | ⏸ **不改** | 已接受 ADR 的正文结论不许单方面改（仓规红线）。要变更就新写一份或加勘误节 |
| `docs/reference/pricing-and-coupons.md` §7 第 20 条、`docs/plans/pricing-coupons-handoff.md`:605 | ⏸ **不改** | 那是**带证据的当时判定**（"此刻库里 0 行"），改它等于重写取证记录；按日期读 |
| `docs/research/legal-dataflow-server.md`:519 | ⏸ **不改** | 调研快照，标题带日期；`research/` 不是产品文档 |
| `server/docker-compose.yml` 里那组 `WECHAT_PAY_ENABLED=${…:-false}` | ⚠️ **别顺手删** | 它是**有意保留**的：删掉之后，一个 `.env` 里还留着 `=true` 的运营者会**静默**什么通道都不开，而运维以为自己在收钱。现量 `sed -n '134,150p' server/docker-compose.yml` 那段注释；守它的是 `check:payment-entry` + `check:server-env` |



| `docs/plans/pricing-coupons-handoff.md` 九格表第 **⑧** 行「看『买了什么 / 剩多少 AI』＝❌、没有『本周期已用 X / 300 次』的界面」 | ✅ **已改口**（17:3x 那一趟的第二轮同类扫描捞出，用本篇自己的"~~原文~~ ⇒ dated 更正"体例）：那一屏现在存在 —— `apps/web/src/features/settings/AiSettings.tsx:810` 渲 `t('web.ai.settings.usage.used', …)`，词条「本周期已用 {used} / {limit} 次。」（现量 `grep -n "usage.used" apps/web/src/features/settings/AiSettings.tsx`） | 它读的仍是这台实例自己的计量 ⇒ 改口时**顺带写明它不证明 ¥12 在交付**，免得这一格从"缺界面"翻成"缺界面"的反面误读 |
| 🔴 **同名词的三种"档位"**（这一条是**防误改**，不是待办） | ⏸ **都不改** | `docs/plans/ui-review-fill-zh-timeline.md:2519` 那句「移动端没有档位入口…那一端仍然只有月档」讲的是**日历视图档**（月/周/日，`view` 那个参数），`docs/plans/calendar-profile-handoff.md:540` 的「档位下拉」同一件事，`docs/reference/environment-traps.md` 里「根本没有档位选择器」讲的是**截图证据的形状**。⇒ 按「客户端有没有档位选择器」这把尺去 grep `档位`，会命中这三处**不是同一件事**的句子；本线那一枚控件在源码里的形状只认词条字面（现量 `grep -c 'renew\.tierTitle' apps/web/src/features/subscription/RenewPanel.tsx` 回 **1**、`…/RenewSection.tsx` 回 **1**；⚠️ **别拿 `renew-tier-hostedAi` 当针**，那枚 `testID` 是模板拼的，见 §10.3 第 7 格那条红字） |

### 10.6 本节自己挂的现量命令，有没有在空转（2026-10-21 逐枚验过）

§10 每一格都挂了一条"你自己也跑一遍"的命令，而 17:3x 那一趟发现**其中一条根本没牙**（形状见 §10.3 第 7 格那行红字：按运行时才拼出来的整串去 grep ⇒ 新旧产物都回 0）。⇒ 这一格把同一把尺**对本节全部命令**扫一遍，免得那是一枚个案。

- **清单怎么取**（这条命令本身就是清单，别抄我这里的数）：`sed -n '/^## 10\. /,$p' docs/plans/subscription-handoff.md | grep -oE 'grep [^`|]*' | sort -u`
- **验法分两种，不能混**：
  ㈠ **期望非零**的针（"这一件确实在"）⇒ 逐枚跑，取到 0 就说明针或路径已经漂。这一趟这类**全部命中**，包括 `managedAiConfigured`（服务端 5 处、`server.ts` 1 处）、`PRICE_TIER_LOSES_GRANTS`（3 处）、`PAYCENTER_ENABLED`／`MANAGED_AI_ENABLED`（compose 各 2 行）、`renew-tier`（web 面板 3 行）、`usage.used`（1 行）、`refunds`（后台 10 行）。
  ㈡ **期望为零**的针（"这一件确实还没做"）⇒ **零本身不证明任何事**，必须先证它的**非零那一支存在**，否则它与 §10.3 那枚坏针逐字同形。两枚都补了：`grep -c '^- \[x\] \*\*AC-' docs/plans/inbound-automation.md` 回 **0**，而同文件的未勾形状 `grep -c '^- \[ \] \*\*AC-'` 回 **8** ⇒ 那本账确实有可勾的格；`grep -c 'tools\|tool_choice' server/src/ai/managed-proxy.routes.ts` 回 **0**，而同文件 `grep -ci tool` 回 **2** ⇒ 不是文件为空或针挑错了文件。
  ㈢ 🔴 **还有第三种坏，18:2x 由本线自己犯下：命令"回得到读数"，但粘进 shell 跑不动**。§10.2 那格新写的逐枚比对命令原本带着 `\&\&` 与 `\|\|` —— 在 markdown 表格里 `|` **必须**转义（否则把单元格切断），而 `&` **不需要**；两者一起转义之后，从源码复制出来的那串会被 shell 当成字面参数，`cmp` 直接吐 usage（就这么实测的：把源码里那串原样喂给 `bash -c` ⇒ `usage: cmp [-l | -s | -x] …`）。⇒ **规矩：写进表格的命令要连"从源码原样粘进 shell"这一支一起验**。最省事的形状是**既不含 `&` 也不含 `|`**：`if cmp -s A B; then echo SAME; else echo DIFF; fi` —— 换完实测回同样的 4 枚 DIFF / 1 枚 SAME。
- ⇒ **判"某件还没做"的规矩（写给下一位，也写给本线自己）**：一条回 0 的 grep 只有在"同一目标上有一枚已知能回非零的近邻针"时才算证据。缺了那枚近邻针，0 就只是**搜法的读数**，不是**事实的读数**。

### 10.7 本轮之后剩下的动作（按谁能做分）

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
  ⚠️ 负责人 10-21 问过「会不会有些东西不该提交上去」——那一趟的**体积分账**（当前那一屏占多少、只被旧代际需要的有多少、哪两枚是真错提交、哪一类是有意决策）在 **B243 追记三**，
  它同时否证了两条看起来便宜的出路：「重复截图能省」＝**不成立**（同一 sha 对象库只存一份），「按大类看前缀就够」＝**不成立**（那次漏掉了更大的一侧）。

