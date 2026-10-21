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
| 🔴 **移动端那枚档位选择的证据到哪一步** | ⚠️ **只有形状判据，没有截图腿**。`apps/mobile/tests/renew-entry.spec.ts` 钉的是源码形状（档位取自 `CHECKOUT_TIERS.map`、不写死 priceId、屏上不写 `¥`/`$` 金额、同意闸门排在下单之前），行为那一半在 `packages/app-host/tests/checkout.spec.ts`。形状断言自己的牙已经落成件：`pnpm check:mobile-renew-shape` 逐臂各注入一次真实坏法（**臂数与用例数由脚本自己打印**；19:0x 现量 5 臂、载体 9 条，R5 是第 177 条那枚）。所以「移动壳有档位选择」这句话现在**只到"接线在 + 判据能红"，不到"画出来了"** —— §6.2 规定一要的图一张都没有（现量分母：`find . -iname "*renew*" -not -path "*/node_modules/*"` 里**全部**是 web 侧的 png） | `pnpm check:mobile-renew-shape`；`pnpm --filter @heyta/mobile test tests/renew-entry.spec.ts` |
| 两道闸门有没有**能复跑的反臂** | ✅ `scripts/mutate-checkout-tier-gates.mjs`：逐臂把 `checkout.routes.ts` 改坏，要求具名用例变红；已进 `pnpm check` 链（不进链就是孤儿，`check:gate-wiring` 判这条）。🔴 **2026-10-21 18:0x 补的 C6 管的是第三种坏法，前面那些臂碰不到**：既有臂抓「该拒的没拒」和「不该拒的拒了」，而**把守卫写得比该拒的更宽**这一支两种都测不到 —— ④′ 的正确形状是**非对称**差集（只有已有能力被这单**判小**才拒），写成对称差（两个集合不相等就拒）时那批 409 用例**一条都不会红**，可 ¥5 的用户从此永远升不到 ¥12，而且没人知道。⇒ 一个方向有牙，另一个方向也得有牙；臂数与用例数都由脚本自己打印，别在这里抄 | `pnpm check:checkout-tier-gates`；那条 200 用例现量 `grep -n '升档' server/tests/billing-checkout.routes.spec.ts` |
| 🔴 **那五张截图在不在仓里**（干净检出看不看得到；标题留着是因为 `PROGRESS.md` 有一条按它反查，**现量是六枚**） | ✅ 2026-10-21 起在 `apps/web/evidence/`，**六枚**（18:4x 新增 `renew-panel-not-sellable.png` ＝ 闸门 ①′ 那一屏，**人已看过**：选中的是「官方托管 + 云端 AI」，屏上写「这一档现在还不能卖，服务端拒绝了这笔下单。」，无裸码、无支付串、无订单卡）。⚠️ **"与 `e2e/test-results/` 逐字节相同"只对入库那一戳成立** —— 18:4x 按 §6.2 复跑这套件（**6 passed / 36.0s**，`HEYTA_NO_FOCUS=1`）之后现量比对：**5 枚 DIFF、1 枚 SAME**（SAME 那枚是刚复制进去的新图），成因是**那一趟的有效期时间戳印在图里**（屏上那行「这一单在 … 之前有效」每跑一次换一个值）⇒ **逐字节比对只在同一趟内成立**，别拿它当"界面坏了"的判据；剩下的像素差**没有逐枚归因**（判外观回归要看图，不是看哈希）。🔴 **本轮自己撞上的一枚假读数（比上面那条更要防）**：`e2e/test-results/` 每次跑都被 Playwright **清空** —— 我为了验新用例有没有牙跑了一枚变异探针，上一趟那五枚当场消失，这把 `cmp` 尺立刻把"文件不在"读成"内容变了"（回 5 枚 DIFF，其中一枚其实只是**没跑过**）。⇒ 两条规矩：**跑变异探针要带 `--outputDir` 指到别处**；拿 `test-results` 当对照之前先 `ls test-results/*.png` 数一遍，枚数要等于用例数。🔴 **01:55 复取时现量：这条规矩对 `renew-panel.spec.ts` 这套件并不成立** —— CLI 根本没有 `--output-dir`（回 `error: unknown option`，只有 `--output`），而**就算带了也挡不住这套件**：用例是按**显式路径**往 `e2e/test-results/renew-panel-*.png` 写图的，01:55 那一趟六枚 mtime 全被刷新（现量 `ls -la e2e/test-results/renew-panel-*.png`），真正没动的是**入库那六枚**（现量 `git status --porcelain -- apps/web/evidence/renew-panel-not-sellable.png` 回空）。⇒ 保护来自"入库件与跑动件分家"这个既有设计，不是来自 `--output`；所以**跑任何一趟都要预期 `test-results` 被刷**，别把"我指了别的目录"当免检。同一趟的读数：**6 passed / 25.9s**（日志 `.run-logs/renew-leg/pw-0154.log`，tip 已不是 18:4x 那一枚），①′ 那一屏人眼重看过：「买哪一档」两枚单选 + 选中的高档 + 出境警告那句 + 红字「这一档现在还不能卖，服务端拒绝了这笔下单。」，档位区**没有任何金额**。⚠️ 这一格此前是**空的**：套件的固定落点被 `.gitignore` 的 `test-results/` 那条挡着，而仓里跟踪的那三枚同名图是 **10-05 那一代 —— 屏上根本没有档位选择**，谁按文件名去读都会读到旧产物。**其余五枚没拿新图覆盖**：两批界面内容相同、只差时间戳，而每刷一代多约 500 KB 历史（正是 B243 那枚配额压力的来源） | 复跑：`cd e2e && HEYTA_NO_FOCUS=1 npx playwright test tests/renew-panel.spec.ts`；比对：`for f in order downgrade no-consent no-channel tiers not-sellable; do if cmp -s apps/web/evidence/renew-panel-$f.png e2e/test-results/renew-panel-$f.png; then echo "$f SAME"; else echo "$f DIFF"; fi; done` |
| 🔴 **两壳的失败码表与服务端能返回的码之间还差三枚"真会到达"的**（2026-10-21 19:0x 按同一把差集尺查出来的第三处，登记、不代写文案） | 服务端这条路由能返回 **10 枚**码（现量见右侧第一条），两壳的映射表只有 6 枚 / 5 枚 ⇒ 差集里逐枚判可达性：**不可达**（两壳请求体只有 `priceId` 与可选 `couponCode` ⇒ 走的是 `DEFAULT_CURRENCY`／`DEFAULT_REGION`）：`UNSUPPORTED_CURRENCY`、`UNSUPPORTED_REGION`、`INVALID_BODY`、`UNKNOWN_PRICE`（档位取自 `CHECKOUT_TIERS`，除非两张表分家）；**真会到达**：`CHECKOUT_FAILED`（通道侧下单失败，502）、`PRICE_NOT_EFFECTIVE`（报价失败＝价格簿里没有可卖的价，配置问题）、`PROVIDER_CURRENCY_UNSUPPORTED`（在册通道不支持那枚币种）。⇒ 这三枚今天落到 `…fail.unknown`，屏幕上印的是「下单失败（CHECKOUT_FAILED）。」——**把服务端内部标识当文案**。⚠️ **为什么本线不顺手补这三句**：那是**对用户陈述钱的状态**（钱扣没扣、单在不在），归产品/文案定口径；不是"找不到句子"。句子要的事实**仓里已可证**：`CHECKOUT_FAILED` 那一支在返回之前已经 `failOrder`（订单判失败、券的预留名额已释放，19:1x 现量 `grep -n "已取消订单并释放券名额" server/src/billing/checkout.routes.ts` 回 `:436`，那一块在 `:433-441`、502 那行在 `:443`），而 `PRICE_NOT_EFFECTIVE` 那一支**从未报出任何金额**（那句 Logger 19:1x 现量 `grep -n "未向用户报出任何金额" server/src/billing/checkout.routes.ts` 回 `:379`；⚠️ 本格原先抄的 `:380` 差一行 —— **行号只当那一戳的定位符**，要复核请用右边那两条针）⇒ 谁定文案，依据在这一格里。📌 本轮已补的是**闸门自己那两枚**（`PRICE_NOT_SELLABLE` 两壳 + `PRICE_TIER_LOSES_GRANTS` 两壳）——那两枚是本线造的码，不补就是本线的缺陷；这三枚早于本线 | 差集：`grep -oE "code: '[A-Z_]+'" server/src/billing/checkout.routes.ts | sed "s/code: //;s/'//g" | sort -u`，对照 `sed -n "/const FAILURE_KEYS/,/^};/p" apps/web/src/features/subscription/RenewPanel.tsx apps/mobile/src/screens/RenewSection.tsx`；可达性：`grep -n "const body: Record" packages/app-host/src/checkout.ts`（请求体只有两项） |
| 📌 **「买了之后真的能用」那一半的判据在哪**（2026-10-21 19:0x 补 —— 此前 §10 只写了收款侧） | 接缝是 `server/src/ai/metering.ts` 里的 `MANAGED_AI_CAPABILITY`（值就是字符串 ai 那一枚能力），钉它的是 `server/tests/managed-proxy.routes.spec.ts` 那三条（19:1x 复取：三条行号未变，取法见右侧第二条针与 `grep -n "GRANT_NOT_INCLUDED"` 回 `:387`）：**`:363`** 放行（上游恰好命中一次、计数器 +1、响应原样透传）；**`:381`** 🔴 订阅只有 `hosting` 而没有 ai 能力 ⇒ 402 `SUBSCRIPTION_REQUIRED` + `reason: GRANT_NOT_INCLUDED`，且**连计数器行都不创建、上游零命中** —— "连行都不创建"正是**权益排在额度之前**的证据：反过来写成 check-then-consume 就会先插一行 requests=1 再判权益，那一条当场红；**`:694`** 同一枚权益判据在**读侧**（额度查询回 entitled false、used 0、periodAnchor null）。⇒ 本线那道 ④′ 不许降档，保护的正是这条链上"已经付过 ai"那一格；**收款侧与交付侧两半合起来才是任务书那句"能收钱且能交付"**。⚠️ 仍未闭合的是**转发 tools** 那一格（右侧第二条命令回 0 就是它），归 ADR-0054 §9.4，不在本轮 | `cd server && npx vitest run tests/managed-proxy.routes.spec.ts`（19:0x 现量 26 passed；条数由 vitest 自己打印，别抄）；`grep -n "放行：上游命中" server/tests/managed-proxy.routes.spec.ts`；`grep -c "tools\|tool_choice" server/src/ai/managed-proxy.routes.ts` |
| 🔴 **闸门 ① 只看 `ai`、不看这一档同时授予的 `automation` —— 这是有意的，别"顺手补全"** | 这一档的 `grants` 是三枚（`hosting`/`ai`/`automation`），而 `automation` 按 [`ADR-0060`](../adr/0060-automation-entitlement-and-retention.md) 的发布门槛**今天还不许对外承诺**（六条有名字的缺口，见 [`pricing-and-entitlements.md`](../reference/pricing-and-entitlements.md) §2.2）。但同一节 ADR-0060 第一句就写着「**现有 AI 档的既有购买能力不因本功能开发而关闭**」，而它管的是**对外承诺**那一层 —— 落地页 ¥12 那三条 feature **没有一条提自动收集**（现量 `grep -n "landing.pricing.hostedAi.feature" packages/i18n/src/locales/zh-CN.ts`），CTA 仍是「即将开放」。⇒ **不许**把"automation 未闭合"接进闸门 ① 变成拒卖 ¥12：那是把 ADR-0060 的"门"读成"禁售"，与 ADR-0054 的解除顺序相反。真要让 ¥12 不授予 `automation`，那是**改商业裁决**（归负责人），不是改闸门 | `grep -n "既有购买能力不因本功能开发而关闭" docs/adr/0060-automation-entitlement-and-retention.md`；`grep -c '^- \[x\] \*\*AC-' docs/plans/inbound-automation.md`（回 `0`＝那六条仍未闭合） |
| 📌 **本线收口那一戳的读数**（2026-10-21 10:4x 首取，**17:1x 在新 tip 上逐条复取**，**18:0x 在补了升档那条用例之后再取一次**，**21:4x 在 tip `89024ee5c` 上把四道只读门复取**（那一戳的真实时刻按**输出件 mtime 反取**＝21:48，不是我落笔那会儿的 22:1x；两段之间隔着一轮别的动作）；**瞬时读数，别当判据抄，要就现量**） | 四道**只读**门 **21:4x 现取各 rc=0**（时刻按 `/tmp` 那件输出 mtime 反取）：`check:ai-quota`／`check:payment-entry`／`check:server-env`／`check:i18n-vars`（取法逐条串行：`for g in check:ai-quota check:payment-entry check:server-env check:i18n-vars; do pnpm "$g" > /tmp/g.txt 2>&1; echo "$g rc=$?"; done`——**别并发**，本机有全局测试互斥；也**别把 `pnpm` 接管道**，尾巴会吃掉退码）。🔴 **另两道 `check:checkout-tier-gates`／`check:mobile-renew-shape` 这一趟没有跑，是有意不跑**：它们**临时改写被跟踪的源文件**（一枚改 `checkout.routes.ts`、一枚改 `RenewSection.tsx`），而这棵树此刻**有别人在写**（`?? packages/app-host/src/share-signals.ts`、`M packages/app-host/src/index.ts` 等）⇒ 按仓里那条"摘除型臂只能在私有载具跑"的规矩，不在共享检出跑它们。⇒ 这两道的**旧读数仍然成立**，而且这是可证的而不是假设：**自各自那一趟跑完之后，两枚台架与它们吃的文件再无提交**（那三笔提交号本身就是"把臂加进去"的那一笔，而台架跑出来的是**加了之后的臂数**——六臂／五臂，所以跑的一定是加完的版本）。（现量逐枚取，各回一个提交号：`git log --format='%h %ad %s' -1 -- server/src/billing/checkout.routes.ts` 回 `81d4a7044 00:31`、`… server/tests/billing-checkout.routes.spec.ts` 与 `… scripts/mutate-checkout-tier-gates.mjs` 回 `8019adf0b 18:13`、`… apps/mobile/src/screens/RenewSection.tsx`／`… apps/mobile/tests/renew-entry.spec.ts`／`… scripts/mutate-mobile-renew-shape.mjs` 回 `69350a1b6 18:42`）⇒ 18:0x 那趟六臂全被抓、19:0x 那趟五臂与载体 9 条，量的就是**当前这份**代码；下一位若要复跑，**先建私有载具**（`git worktree add` 一份并在那儿装依赖），别在这棵树上跑。🔴 **01:38 复取：这两道本会话确实跑了，而且就是在共享检出里跑的 —— 上面那句规矩被我违反了，如实记在这**（两道各 **rc=0**，日志 `.run-logs/renew-leg/audit-0138.log`）。跑之前我没重数"这棵树有没有别人在写"，是跑完才补的核：同一分钟里协作线确实落了一笔 `b0af438ac`（01:38:08），但它动的是四枚文档，**不含这两道臂改写的那两枚源文件**（现量 `git show --name-only b0af438ac`），且 `git diff --stat HEAD -- server/src/billing/checkout.routes.ts apps/mobile/src/screens/RenewSection.tsx` 回**空**、HEAD 里那两枚"未变异"的针各命中 **1** ⇒ **这一趟没把变异态提交出去，是运气不是流程**。⇒ 下一位要复跑仍然**先建私有载具**；这两道的绿在这里只算一次性读数，不算常驻证据。文档四道 **rc=0**：`check:docs`／`check:md-tables`／`check:doc-citations`／`check:gate-wiring`；`pnpm typecheck` ~~**rc=0**~~ ⇒ **18:0x 复取 rc=2**，两行报错逐字都在协作线**尚未跟踪**的在飞新件 `packages/app-host/src/share-rekey.ts`~~（`:170`/`:199` 两处 `new ShareKeyUnavailableError()` 少一个实参）~~ ⇒ **19:2x 复取：那一枚文件协作线已经入库（现量 `git ls-files packages/app-host/src/share-rekey.ts` 命中），那两行报错随之消失，而整条链仍 rc=2、红换成唯一一枚**——`packages/app-host/src/share-signals.ts` 的 `TS2352`（`ShareLogOp[]` 转 `readonly DecryptedShareOp[]`，112 行 23 列），同一形状：**仍是 `??` 未跟踪**（现量 `git status --porcelain -- packages/app-host/src/share-signals.ts`）。⇒ 归因不变、"代改要三条齐"仍不齐，本线**依旧不代改**；本线那两枚改动文件零命中。🔻 **01:38 在新 tip 上复取：`pnpm typecheck` 回 rc=0、`grep -c 'error TS'` 回 0**（tip `b0af438ac`）⇒ 那一枚红已经不在链上了；治它的是协作线那一侧，**本线一行都没代改**，具体哪一笔治的要查在协作线自己的账，本条不替他们归因。⚠️ 上一句"仍不齐/依旧不代改"在它那一戳是对的，别拿它当现在的读数。取法（**管道尾巴会吃掉退码**，所以先重定向）：`pnpm typecheck > /tmp/tc.txt 2>&1` 后 `echo $?` 回 2、`grep -c 'error TS' /tmp/tc.txt` 回 1。⚠️ **"HEAD 上绿"这句本会话没证**（那要在干净检出装依赖后跑）——只证到"当前这一行红不在 HEAD 里"。归因与追记全文见 [BLOCKED.md](../../BLOCKED.md) **B245 及其 19:2x 追记**；四份相关 spec 全绿（服务端 `billing-checkout.routes` ~~22~~ ⇒ **18:0x 起 23**、`app-host/checkout` 16（19:0x 复量仍是 16）、移动 `renew-entry` ~~8~~ ⇒ **19:0x 起 9**（第 177 条补的那条具名用例）、web `renew-panel.spec.tsx` 19（19:1x 单独复取仍 **19 passed**，取法 `cd apps/web && npx vitest run tests/renew-panel.spec.tsx`））。⇒ 🔻 **01:40 在 tip `b0af438ac` 上把四份逐枚复取：服务端 23／app-host 16／移动 10／web 19，四趟各 rc=0**（移动那枚从 9 涨到 10 就是 187 那条「不许静默」判据；取法同上三条命令逐条串行跑，日志 `.run-logs/renew-leg/vitest-apphost-0140.log`／`vitest-server-0140.log`）。⚠️ **复取那一戳取在 `d9406b134`，它上面叠着共享清单线两笔**（`58873b2b3`／`d9406b134`）：这两笔对本线文件**零命中**（现量 `git diff --name-only 29dec6d2b d9406b134 \| grep -E 'billing\|checkout\|RenewPanel\|RenewSection\|entitlement\|price-book' \| wc -l` 回 **0**）⇒ 那六门与四份 spec 绿的是"合上别人代码之后仍然绿"，比首取那一戳更强。**为什么 17:1x 要重跑一遍**：本线在 10-21 又落了一笔文档提交（台账 166），tip 一变，上一戳那串数就成了别人产物上的数——这正是仓里"读数要带 tip"那条纪律的用场。⚠️ **同一条 `pnpm check` 大链此刻仍红**，红在 `check:image-license` —— 那是**别线的预存红**，成因与"为什么本线不修"写在 [BLOCKED.md](../../BLOCKED.md) 的 **B244** | `for g in check:ai-quota check:payment-entry check:server-env check:i18n-vars check:checkout-tier-gates check:mobile-renew-shape; do pnpm "$g"; echo "rc=$?"; done`（**逐条跑**，别并发：本机有全局测试互斥） |
| 🔴 **④′「变宽不许拒」那一半到 2026-10-21 18:0x 才有牙**（本线第 1 步自己补的格） | 收口那一趟 ④′ 只有**降档**方向具名（`¥12 有效期内点 ¥5 ⇒ 409`），**升档方向没有任何判据钉着**：把守卫写成对称差（两个集合不相等就拒）时整套用例全绿，而 ¥5→¥12 从此静默变拒单 —— 这一档恰恰是最该被升上来的那一档。⇒ 补了一条 **200 用例**（`¥5 有效期内点 ¥12（升档）⇒ 200`，断言不止状态码：还断言 `checkout_orders` 里**真冻上了一枚**，否则"放行"只是响应码）+ 臂 **C6**。18:0x 实测：阳性对照 **23/23 绿**，六臂**全被具名判据抓到**，而 C6 的红集合**恰好只有升档那一条** ⇒ 这条用例是该方向唯一的牙，不是冗余。⚠️ **顺手量到的一条会影响下一位的事实**：`server/tsconfig.json` 的 `include` 只有 `src/**` 与 `scripts/**` ⇒ **`server/tests/**` 不在任何 typecheck 射程内**（`pnpm typecheck` 从不编译它），所以那 23 条的类型安全只由"vitest 真跑过"保证；拿 ad-hoc `tsc` 单编这枚 spec 会回 3 条报错，其中两条落在 `:58`/`:128` 的**既有夹具**上（本线这次的改动纯追加在 `:520`），别误读成"新用例编译不过" | `pnpm check:checkout-tier-gates`（臂数与用例数由它自己打印，别抄）；`cd server && npx vitest run tests/billing-checkout.routes.spec.ts`；`grep -n '"include"' server/tsconfig.json` |
| 🔴 **移动壳此前会把闸门 ① 的机器码当人话印出去**（2026-10-21 18:3x 补，本线第 2 步自己漏的那一格） | web 侧两枚码各有一句词条（`web.subscription.renew.fail.sellable` 与 `…downgrade`），而移动侧 `FAILURE_KEYS` **只补了降档那一枚** —— 于是这台实例没配托管上游时（**闸门 ① 恰恰是今天生产上真会触发的那一支**），手机上印的是「下单失败（PRICE_NOT_SELLABLE）。」：把服务端机器码当文案给用户看。⇒ 补 `mobile.entitlement.renew.fail.sellable`（两份 locale 各一条，值与 web 同句）+ `FAILURE_KEYS` 那一行 + 一条具名用例（连两份 locale 里键在不在一起查），并给 `check:mobile-renew-shape` 加臂 **R5**（删掉那行映射 ⇒ 必须红在新用例上）。18:3x 实测：载体 **9/9**、**5 臂全被具名判据抓到**、`check:i18n-vars`／`check:payment-entry`／`check:ai-quota`／`check:server-env`／文档四道各 **rc=0**；`apps/mobile` 的 tsc 从 1 枚红到 0（红因不是代码，是**改词条没重建 `@heyta/i18n`、各壳读的是陈旧 `dist/*.d.ts`** ⇒ 已落成环境陷阱 **#514**，并在 `docs/agents/commands.md` 那条 `pnpm -r typecheck` 旁边留了指针） | `pnpm check:mobile-renew-shape`（臂数与用例数由它自己打印）；`grep -n "PRICE_NOT_SELLABLE" apps/mobile/src/screens/RenewSection.tsx`；`grep -c "mobile.entitlement.renew.fail.sellable" packages/i18n/src/locales/zh-CN.ts packages/i18n/src/locales/en.ts`（两份各回 1） |
| 🔴 **push 这一半要如实说的两件事**（本线第 6 步的交付声明，不是待办） | ㈠ **推 `main` 会连带发布本工作树里他人会话的本地提交** —— 这不是抽象风险：17:2x 那一趟射程是 **4 笔**（本线 1 笔 + 协作线 3 笔），pre-push 两臂扫完整射程（文件名臂：私钥形状新增/改名 **0**；字节臂：diff **1156** 行 × 在册值 **21** 枚 ⇒ **0** 命中）才放行。⇒ **规矩**：推之前先 `git log --oneline origin/main..HEAD` 数一遍射程，别按"我只改了一枚文档"假设。㈡ **两枚远端今天不对称，且不会自己变好**：`origin/main` 已含本轮全部，`gitee/main` 停在 `0da2185e4`，差距现量 `git rev-list --count gitee/main..HEAD`（17:2x 回 **27**）；同一趟复推 gitee 逐字 `Repo size: 1108.906MB, exceeds quota 1024MB`（00:5x 1107.402 → 16:3x 1108.828 → 17:2x 1108.906，**一天涨约 1.5 MB**，量级等于文档提交本身）⇒ **任何"以 gitee 为准"的下游读到的是旧 `main`**，出路四条与"谁拍"在 B243 追记三 ⑧ | `git log --oneline origin/main..HEAD`；`git rev-list --count gitee/main..HEAD`；`git push gitee refs/heads/main:refs/heads/main`（**显式点名 refspec**：本仓 `main` 的上游配的就是 gitee，裸 `git push` 必失败，见 B243 追记二） |
| 🔴 **18:1x 那一趟 push 的射程与两枚远端**（承上一行那两件事 —— 上面那两个数是 17:2x 那一戳的，别当现在的读数） | ㈠ 这一趟推之前 `git log --oneline origin/main..HEAD` 回 **1 笔**（就是本线那笔反臂 C6 的提交）⇒ **这一趟没有连带发布任何他人提交**：协作线的内容此刻全部在工作树里**未入库**（`?? packages/app-host/src/share-rekey.ts`、`M packages/app-host/src/index.ts`、`M server/src/shares/share.routes.ts`），我的推送带不出去它们。⚠️ 但这条结论**只对这一戳成立** —— 上一行记的 17:2x 那一趟射程是 4 笔，同一命令在别的时刻完全可能又是多笔 ⇒ 规矩不变：**每次推之前重数一遍**。pre-push 两臂这一趟的读数：待推 **1** 笔、diff **73** 行、在册值 21 枚 ⇒ **0 命中**。㈡ 同一趟复推 gitee 逐字 `Repo size: 1110.324MB, exceeds quota 1024MB`（17:2x 1108.906 ⇒ 18:1x 1110.324）；**18:2x 再复推回 1112.711MB** ⇒ 这一串增量与我的提交尺寸不成比例（一笔 5 行的文档提交之后 +2.4 MB），所以它**不是**"每推一笔涨多少"的规律，上一行那句"一天涨约 1.5 MB"只是那一戳的拟合，别拿它外推配额什么时候不够，差距现量回 **36** 笔 ⇒ **两枚远端不对称继续成立**，出路四条仍等负责人那一句（B243 追记三 ⑧） | `git log --oneline origin/main..HEAD \| wc -l`；`git rev-list --count gitee/main..HEAD`；`git push gitee refs/heads/main:refs/heads/main`（**显式点名 refspec**）；两枚远端 SHA 现量**一枚一条命令**取（`git rev-parse --short origin/main`、`git rev-parse --short gitee/main`；一条命令里给两枚会报 `Needed a single revision`） |
| 🔴 **18:4x 那一趟 push 连带发布了别人的 4 笔**（这一戳的射程不再是 1 笔，如实记） | 推之前 `git log --oneline origin/main..HEAD` 回 **5 笔**：本线 1 笔（移动壳那枚机器码修复）+ **协作线 M3-a…M3-d 4 笔**（`7cf8ade5c`／`dde36ec40`／`42714cb07`／`4c7a2d9b5`，换钥与撤销那族）⇒ 它们**已经跟着我的推送公开了**。这是本线第 6 步授权的动作（任务书原文："推送会连带发布本工作树里他人会话的本地提交"），但**下一位别把它读成"每次都只有 1 笔"**：18:1x 那一趟是 1 笔，这一趟是 5 笔，差别只在别人有没有在这期间入库。pre-push 两臂这一趟扫的是**整个射程**：文件名臂私钥形状新增/改名 **0**；字节臂 diff **1684** 行 × 在册值 21 枚 ⇒ **0 命中**（新增行与删除行都比过）⇒ 这 4 笔里没有首次公开的在册值。gitee 同一趟仍被配额拒（`Repo size` 见上一行那串，出路四条仍等负责人拍，B243 追记三 ⑧） | `git log --oneline origin/main..HEAD`（**推之前跑，不是推之后**）；`git push origin refs/heads/main:refs/heads/main` |
| 🔴 **19:2x 那一趟 push：射程 1 笔，没有连带发布别人的东西**（本线第 6 步的第三戳） | ㈠ 推之前 `git log --oneline origin/main..HEAD` 回 **1 笔**（就是本线台账 182 那枚文档提交）⇒ 这一趟带不出去任何他人内容。pre-push 两臂：待推 **1** 笔、diff **44** 行、在册值 21 枚 ⇒ **0** 命中。origin 已收到 `c6c7ed8a1..db3440725`。㈡ 同一趟复推 gitee **仍被服务端拒**（`! [remote rejected] main -> main (pre-receive hook declined)`），差距现量 **53** 笔（18:2x 那一戳是 36；`gitee/main` 还停在 `0da2185e4` ⇒ 增量就是这段时间里进 main 的笔数）。⚠️ **这一趟没取到逐字 MB 数**：输出被我 `tail -6` 截掉了，而 gitee 那行 `Repo size: … exceeds quota …` 在输出**开头** —— 上一枚逐字读数是 18:2x 的 `1112.711MB`，**别当现在的**；出路四条仍等负责人那一句（B243 追记三 ⑧）。㈢ 🔴 **顺手落一枚探针规矩**：要远端拒绝原因就 `head -20` 或整段留档，**别 `tail`** —— 配额那行恰好在被切掉的那一头，这已经是本线第二次把"截尾"当成"没发生" | `git log --oneline origin/main..HEAD`；`git rev-list --count gitee/main..HEAD`；`git rev-parse --short origin/main` 与 `git rev-parse --short gitee/main`（一枚一条）；`git push gitee refs/heads/main:refs/heads/main`（复推时**别接** `tail`，要 `head`） |

| 🔴 **00:2x 那一趟 push（第 4 戳）：射程 2 笔，全是本线** | ㈠ 推之前 `git log --oneline origin/main..HEAD` 回 **2 笔**（本线的行为修复 + 台账 187 那枚文档）⇒ **这一趟也没有连带发布他人提交**（协作线那批仍在工作树里未入库）。pre-push 两臂：待推 **2** 笔、diff **123** 行、在册值 21 枚 ⇒ **0 命中**；origin 收到 `c59ccdce2..ecc35bd93`。㈡ 同一趟复推 gitee 仍被拒，而**这一回取到了逐字 MB**：`Repo size: 1113.879MB, exceeds quota 1024MB` —— 上一行那条"别接 `tail`、整段留档"的规矩这一趟照做了（两条 push 各写一份日志再读），所以那行没再丢。串：18:2x `1112.711` → 00:2x `1113.879`。㈢ 差距现量 **59** 笔（`gitee/main` 仍停在 `0da2185e4`），出路四条仍等负责人那一句（B243 追记三 ⑧） | `git log --oneline origin/main..HEAD`（**推之前**跑）；`git rev-list --count gitee/main..HEAD`；`git push gitee refs/heads/main:refs/heads/main > 某日志 2>&1` 然后**读整个文件** |
| 🔴 **01:2x 那一趟（第 5 戳）：本线没推成 origin —— 是别人把我这两笔带出去的** | ㈠ 本线这一戳落了两笔（`fd538f26f` 那条像素腿 + `66e72a8ba` 台账 188），等本线去推时 `git rev-list --count origin/main..HEAD` 已回 **0**：协作线在 01:28–01:29 之间推了他们那批（tip 到 `5a089f0fc`），**把我这两笔一起带了出去**。⇒ 前四戳记的都是"我这一推会不会发布别人的东西"，这一戳是**反过来的形状**：别人的推送发布了我。⇒ 那条"每次推之前重数一遍"的规矩照旧成立，但它管不到**我数完之后别人再推**这一支；要判断"我那两笔在不在远端"，只能拿 `git cat-file -p origin/main:<路径>` 逐枚针去戳（这一戳三枚各命中 **1**：`^### 10.9`、`^188\. `、`verify:mobile-ios-renew-sellable`）。⚠️ 别拿 `git rev-parse origin/main` 与本地 tip 比对 —— 那两枚在这棵共享树里**同一分钟就能不同**（本条首取时 `rev-parse` 回 `6a0ec7065`，两条命令之后同一 ref 已是 `5a089f0fc`）。㈡ 同一趟复推 gitee 仍被拒，逐字 `Repo size: 1113.234MB, exceeds quota 1024MB`。🔻 **这一枚数比上一戳小**（00:2x 是 `1113.879` ⇒ 01:2x `1113.234`，**降了约 0.65 MB**）⇒ 那串"18:2x 1112.711 → 00:2x 1113.879"看着像单调上涨，这一戳把它**否证**了：gitee 报的是它那一侧的仓库体积，会随它自己的 GC 动，**不能拿相邻两戳的差当"这一趟推上去涨了多少"**。㈢ 差距现量 **75** 笔（`gitee/main` 仍停在 `0da2185e4`）；pre-push 两臂扫整个射程：待推 **75** 笔、diff **9600** 行、在册值 21 枚 ⇒ **0 命中**（文件名臂私钥形状 0，豁免 `debug.keystore`）。出路四条仍等负责人那一句（B243 追记三 ⑧） | `git rev-list --count origin/main..HEAD`；`git cat-file -p origin/main:docs/plans/subscription-handoff.md \| grep -c '^### 10.9'`（一枚一枚戳，别比 tip SHA）；`git rev-list --count gitee/main..HEAD`；`git push gitee refs/heads/main:refs/heads/main > 某日志 2>&1` 然后**读整个文件**（配额那行在开头，`tail` 会切掉） |


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
   🔴 **"填了之后到底交付不交付得出来"不用等运营填完才知道**：这条链已经被一份用**本地假上游**写的行为用例钉住 —— 放行时上游**恰好命中一次**、计数器 +1、响应原样透传；无令牌 401 且**一条 SQL 都没发**；没有 `ai` 权益 402 且**连计数器行都不创建**；额度用满第 N+1 次 409 且计数一字未动、上游不再被命中；上游未配置 503 `MANAGED_AI_NOT_CONFIGURED` 且不消耗额度。现量（2026-10-22 01:43 复取 **rc=0，33 条全过**）：`cd server && npx --no-install vitest run tests/managed-proxy.routes.spec.ts tests/managed-upstream-drift.spec.ts`。⇒ 运营那一格缺的是**真实凭据与部署态**，不是"代码没证过"。
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
7. ~~**移动端续费那一屏没有截图腿**~~ ⇒ **iOS 那一半 10-22 00:1x 已跑掉，见 §10.8**（那一趟还顺手抓出一枚在空转的按钮并修了）。
   原判据「"画出来了"这件事没有任何一张图证过」现在只对**一件事**：Android 那一侧一张都没有（出包与真机走 `windows-pc`，不在本机跑 Gradle）。
   ~~① `PRICE_NOT_SELLABLE` 那句要设备上**真登录一次**才拍得到~~ ⇒ **10-22 01:1x 已取到，见 §10.9**：那一趟是从零装、真登录、真按下走到服务端 409 的，
   并且这腿已经不再是手工动作，登记成了 `pnpm verify:mobile-ios-renew-sellable`（现量 `grep -n "verify:mobile-ios-renew-sellable" package.json`）。
   ⚠️ 复现口径与原文不同的一点：本轮用的是 **Release 包内嵌 jsbundle**（`pnpm --filter @heyta/mobile build:ios` 那条 xcodebuild），**没走 Metro**
   —— 好处是它证的正是用户会拿到的那一枚产物，代价是改一行源码要重打一次包（约 90s）。
   起壳与截图全程无头（`simctl boot` + `simctl io screenshot`），**没抢前台**；前置与命令见
   [`docs/agents/ui-acceptance.md`](../agents/ui-acceptance.md) 规定一第 1、2、4 条与
   [`docs/plans/product-ux-optimization.md`](product-ux-optimization.md) 的设备腿台账。归我方。
   ⚠️ 现量（为什么不能拿手边那张旧图交差）：`grep -o 'mobile.entitlement.renew.tierTitle' apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app/main.jsbundle | wc -l` 回 **0** —— 那枚 10-20 的包**里根本没有档位选择**，用它拍图就是拿旧产物冒充当前产物。
   🔴 **这一格原先用的探针被本会话自己否证并换掉了**（10-21 17:3x）：旧写法拿 `renew-tier-hostedAi` 当针，而源码里那枚 `testID` 是**模板拼出来的**（现量 `apps/mobile/src/screens/RenewSection.tsx:108` = `` testID={`renew-tier-${id}`} ``；行号 ~~`:107`~~ ⇒ **19:1x 复取 `:108`**，往下挪一行的成因是本线自己在同一文件上方补了那枚失败码映射，见 §10.2 那格 18:3x 那一趟）⇒ **任何构建都取不到非零**，那是一枚永远 0 的探针，它给的"旧包没有档位"其实没证成任何东西。换的针是**词条字面**：同一枚包里 `mobile.entitlement.renew.payHint`（10-05 进源码）出现 **1** 次，而 `…tierTitle`（10-21 00:31 进源码，`git log -S` 现量）出现 **0** 次 ⇒ 打包确实保留这类键字面，"0"才真的是"这一版没有"。
   🔧 **这一腿的前置比看上去小，四项都已现量**（写给下一个接手的人，省得重新推）：
   ① **不需要先造一笔存量订阅** —— 那块整块的唯一渲染闸门是"同意出境"（现量 `grep -n "networkAllowed()) return null" apps/mobile/src/screens/RenewSection.tsx`），所以只要登录进去 + 同意出境就画得出来；
   ② 挂载点在 Profile 那一屏（现量 `grep -n "<RenewSection" apps/mobile/src/screens/ProfileScreen.tsx`），滚到权益那块下面就是；
   ③ iOS 那条腿**不走 Android 的 uiautomator**，走 `scripts/tools/ios-ax-shim.py`（现量 `grep -n "IS_AX_SHIM" scripts/verify-mobile-ios.sh`），preflight 照 `scripts/verify-mobile-ios.sh` 抄；
   ④ 那枚装置开头有一道**新鲜度门**：产物 bundle 的 mtime 必须 ≥ 最新源码 mtime，否则判红（现量 `grep -n "BUNDLE_MTIME" scripts/verify-mobile-ios.sh`）⇒ **先 `pnpm build:ios` 再拍**，别拿旧包凑。
   ⑤ **同一棵 build 目录下有两枚形状不同的 jsbundle，计数不许混**（10-21 17:4x 现量）：`apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app/main.jsbundle`（**10.4 MB，Hermes 字节码**，`grep` 对它报 "Binary file matches"）与它外面那枚 `Release-iphonesimulator/main.jsbundle`（**16.9 MB，dev JS**，含 `__DEV__`）。同一枚针 `mobile.entitlement.renew.payHint` 在两处分别出现 **1** 次与 **3** 次 ⇒ **报数必须写清是哪一枚**；装置读的是前者（现量 `grep -n "INSTALLED_APP" scripts/verify-mobile-ios.sh`）。
   ⑥ ✅ **那枚新探针的"非零那一支"已经实测到了**（2026-10-21 18:2x 补跑）。17:4x 那一戳没跑的理由留着，它是量出来的：`vm_stat` 的 free **0.3 GB**、`sysctl vm.swapusage` 全 **0**（swap 都没启用），同一时刻另一个项目正在跑 `node --test` ⇒ 这时起 Metro 要么被本机那道按 rss 的闸门掐掉、要么把那趟吃进去。18:2x 余量升到 free **约 2.9 GB**（`vm_stat` 的 free 174288 页 × 16 KiB），两行命令跑完：`cd apps/mobile && npx react-native bundle --platform ios --dev false --entry-file index.js --bundle-output /tmp/current.jsbundle`（**只写临时目录、不碰装机产物**；产物 9,142,434 B）⇒ `grep -o 'mobile.entitlement.renew.tierTitle' /tmp/current.jsbundle | wc -l` 回 **3**，兄弟键 `…payHint` 同样 **3**，而随手编的一枚不存在的键回 **0**；🔻 **19:1x 复取：那枚载体本机已经不在了**（`ls /tmp/current.jsbundle` 回 No such file —— `/tmp` 会被重启与系统清理走）⇒ 上面那三个数是**那一戳的读数，不是常驻可复核的**，要重跑那两行 bundle 命令才有；这一条证的仍是"探针形状选对了"，不是设备腿闭合（⇒ 这枚针不是"谁都命中"）。⚠️ **别把这一条读成"设备腿闭合了"**：上面量的是 **Metro 直出的 JS 包**，而 `scripts/verify-mobile-ios.sh` 读的是装机里那枚 **Hermes 字节码**（同目录两枚形状不同，见 ⑤）⇒ 这一条证的只是"词条在打包产物里可达、探针形状选对了"；**截图腿仍缺**，它要模拟器或真机，不是这一趟能自决的。
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
| `docs/plans/roadmap.md` §5.2 那三格（④⑤ 收银台／⑦ ¥12 能不能交付／海外） | ✅ **已改口**（2026-10-22 01:58，台账 194）：④⑤ 那格"12 例真 SQL"⇒ 现取 **23 例**，并补上"两枚 409 稳定码只有两壳都做了「买哪一档」才会到达用户"；海外那格引用的 `checkout.routes.ts:146` 与 `:166-173` **已漂**（146 行现在是本线自己新加的 `managedAiConfigured` 选项），两处换成 `grep -n "code: 'UNSUPPORTED_CURRENCY'"` 这类针 | 这本账先前**整本没进过 §10.5 的分母**（表头却写着"全列在下面"）；而这次的行号漂移是**本线自己造成的**，由本线收口，不留给下一位去猜是谁的账 |
| 🔴 **同名词的三种"档位"**（这一条是**防误改**，不是待办） | ⏸ **都不改** | `docs/plans/ui-review-fill-zh-timeline.md:2519` 那句「移动端没有档位入口…那一端仍然只有月档」讲的是**日历视图档**（月/周/日，`view` 那个参数），`docs/plans/calendar-profile-handoff.md:540` 的「档位下拉」同一件事，`docs/reference/environment-traps.md` 里「根本没有档位选择器」讲的是**截图证据的形状**。⇒ 按「客户端有没有档位选择器」这把尺去 grep `档位`，会命中这三处**不是同一件事**的句子；本线那一枚控件在源码里的形状只认词条字面（现量 `grep -c 'renew\.tierTitle' apps/web/src/features/subscription/RenewPanel.tsx` 回 **1**、`…/RenewSection.tsx` 回 **1**；⚠️ **别拿 `renew-tier-hostedAi` 当针**，那枚 `testID` 是模板拼的，见 §10.3 第 7 格那条红字） |
| 🔴 **对外那一句本身：`landing.pricing.statusNote`「收银台已经接通，但大陆与海外的支付通道都还在等支付商资质 —— 现在还不能下单。」**（访客侧现量 2026-10-22 01:47：线上 `assets/zh-CN-_ZN46_VJ.js` 里该句命中 **1** 次，同一分片里本线那枚新词条 `这一档现在还不能卖` 也命中 **1** ⇒ **不是旧构建残留**） | ⏸ **本轮不改**：一是对外文案，二是"通道到底通没通"本机量不到（生产 `PAYCENTER_ENABLED` 与三项凭证看不见） | 这一行是补 **本表自己的分母漏项** —— 表头写着"全列在下面"，而**唯一一处对公众说这句话的落点**原先没登记。三件留给下一位的事实：① 对 ¥12 这一档它**现在就成立**（服务端 409，§10.3 第 1 格）；② 它**偏保守** —— 若 ¥5 在生产上其实已能下单，这句把"能买"说成"不能买"，方向是安全的（不是"会收钱不交付"那一类），但**仍是一次对外不实陈述**；③ 翻案条件＝运营做完 §10.7 第一格那笔真实小额下单 ⇒ 这句要按当时的通道事实重写并重新部署落地页，改的是 `packages/i18n` 两枚 locale（**同步改**，门禁在管），不是页面里写死。⚠️ **探针形状（本条自己先错了一次）**：这句**不在 `main-*.js` 里** —— 对主包取 `收银台已经接通` 回 **0**，而 `官方托管` 回 **8**，只看前者会读成"访客根本看不到这句"；它在**动态 import 的 locale 分片**里（现量 `grep -oE "\"\./[A-Za-z0-9-]+-[A-Za-z0-9_]+\.js\"" 那份主包` 会列出 `./zh-CN-*.js`／`./en-*.js`）⇒ **判"公众看不看得到某句"必须先取分片**，与 §10.6 ㈡ 同族：空读数先归因搜法，再归因对象 |

### 10.6 本节自己挂的现量命令，有没有在空转（2026-10-21 逐枚验过）

§10 每一格都挂了一条"你自己也跑一遍"的命令，而 17:3x 那一趟发现**其中一条根本没牙**（形状见 §10.3 第 7 格那行红字：按运行时才拼出来的整串去 grep ⇒ 新旧产物都回 0）。⇒ 这一格把同一把尺**对本节全部命令**扫一遍，免得那是一枚个案。

- **清单怎么取**（这条命令本身就是清单，别抄我这里的数）：`sed -n '/^## 10\. /,$p' docs/plans/subscription-handoff.md | grep -oE 'grep [^`|]*' | sort -u`
- **验法分两种，不能混**：
  ㈠ **期望非零**的针（"这一件确实在"）⇒ 逐枚跑，取到 0 就说明针或路径已经漂。这一趟这类**全部命中**，包括 `managedAiConfigured`（服务端 5 处、`server.ts` 1 处）、`PRICE_TIER_LOSES_GRANTS`（3 处）、`PAYCENTER_ENABLED`／`MANAGED_AI_ENABLED`（compose 各 2 行）、`renew-tier`（web 面板 3 行）、`usage.used`（1 行）、`refunds`。**这一枚 19:1x 复取时抓到两种口径混着用**：§10.3 第 6 格登记的针带单引号（`'refunds'`）回 **3** 行，而这一节原先抄的"10 行"是**裸 `refunds`** 的读数（同一文件 `grep -c refunds` 回 10）⇒ 拿格子那条命令去复核"10"一定复核不上。两把尺都写在这儿，**报数要连针一起报**。
  ㈡ **期望为零**的针（"这一件确实还没做"）⇒ **零本身不证明任何事**，必须先证它的**非零那一支存在**，否则它与 §10.3 那枚坏针逐字同形。两枚都补了：`grep -c '^- \[x\] \*\*AC-' docs/plans/inbound-automation.md` 回 **0**，而同文件的未勾形状 `grep -c '^- \[ \] \*\*AC-'` 回 **8** ⇒ 那本账确实有可勾的格；`grep -c 'tools\|tool_choice' server/src/ai/managed-proxy.routes.ts` 回 **0**，而同文件 `grep -ci tool` 回 **2** ⇒ 不是文件为空或针挑错了文件。
  ㈢ 🔴 **还有第三种坏，18:2x 由本线自己犯下：命令"回得到读数"，但粘进 shell 跑不动**。§10.2 那格新写的逐枚比对命令原本带着 `\&\&` 与 `\|\|` —— 在 markdown 表格里 `|` **必须**转义（否则把单元格切断），而 `&` **不需要**；两者一起转义之后，从源码复制出来的那串会被 shell 当成字面参数，`cmp` 直接吐 usage（就这么实测的：把源码里那串原样喂给 `bash -c` ⇒ `usage: cmp [-l | -s | -x] …`）。⇒ **规矩：写进表格的命令要连"从源码原样粘进 shell"这一支一起验**。最省事的形状是**既不含 `&` 也不含 `|`**：`if cmp -s A B; then echo SAME; else echo DIFF; fi` —— 换完实测回同样的 4 枚 DIFF / 1 枚 SAME。
- ⇒ **判"某件还没做"的规矩（写给下一位，也写给本线自己）**：一条回 0 的 grep 只有在"同一目标上有一枚已知能回非零的近邻针"时才算证据。缺了那枚近邻针，0 就只是**搜法的读数**，不是**事实的读数**。

### 10.7 本轮之后剩下的动作（按谁能做分）

- **运营/运维**：填 `MANAGED_AI_*`（+ 确认 `PAYCENTER_*`）→ 重建镜像 → 用一次真实小额下单验通路与到账回执；删掉本机旧的 `WX_*`。
- **法务/负责人**：过一遍 `packages/legal`（含把"这一档仍打不开"按 §10.3 第 1、3 格的前提改掉）。
- **我方下一轮能自己做**：管理后台权益撤销控件（§10.3 第 6 格）、`tools` 转发的工程侧方案（先出计划，拍板归负责人）。
  ~~**移动端那一屏的截图腿**（§10.3 第 7 格：缺的是模拟器/真机那一趟，不是代码）~~ ⇒ **10-22 00:1x 已跑掉大半**：档位块、换档后的出境警告、未登录按下后的失败语三张像素都取到并人眼看过，
  而且那一趟抓到并修掉了一枚真缺陷（见 §10.8）。~~**还欠的那半**：`PRICE_NOT_SELLABLE` 的句子要在设备上**真登录一次**才拍得到（本轮那台机是「还没登录」态）~~
  ⇒ **10-22 01:1x 补跑完**：真登录那一趟走到 409 并取到像素，腿固化成 `pnpm verify:mobile-ios-renew-sellable`（见 §10.9）。
  iOS 侧这一格**没有欠项了**；剩下的是 Android 侧一张都没有（出包与真机走 `windows-pc`，不在本机跑 Gradle）。
- **产品/文案**：三枚"真会到达但没映射"的失败码要人话句子（`CHECKOUT_FAILED`／`PRICE_NOT_EFFECTIVE`／`PROVIDER_CURRENCY_UNSUPPORTED`，形状与依据都在 §10.2 那一格）——**本线不代写**，因为那三句是对用户陈述钱的状态。
- **负责人**：gitee 那四条出路选一条（甲／乙／丙／丁，全文与体积账在 `BLOCKED.md` 的 **B243 追记三 ⑧**；今天这条路被拒的逐字读数、以及"配额只会越来越紧"那句被现量否证，在 **B243 追记四**）。
- ⚠️ **两枚远端现在不对称**（不是本线的事，但会影响"以哪枚为准"）：`gitee` 从今天起收不进任何 push
  —— 它的仓库体积过了自家 1024MB 配额。`origin`（GitHub）是**当前**的那一枚。
  现量：`git fetch gitee main && git fetch origin main`，两枚 SHA **一枚一条命令**取（`git rev-parse --short gitee/main` 回 `0da2185e4`、`git rev-parse --short origin/main` 回 `c6c7ed8a1`，19:1x）。
  🔴 **这一格原先的命令是跑不动的**：它把两枚 ref 塞进同一条 `git rev-parse --short gitee/main origin/main` ⇒ `fatal: Needed a single revision`、`rc=128`（19:1x 原样复现）。同一枚坑在 §10.2 那格与 `PROGRESS.md` 173 已各记一次，**这是第三处** —— 记到第三处说明它是我抄自己旧句子时不带脑子抄出来的，不是 git 的新行为。
  🔴 **两条便宜路已被现量否证**：GC 没用（`main` 单独打包就 **1094.8 MiB**，gitee 整仓 1108.059 MB ⇒ 不可达的只有约 13 MB）；
  gitee 上也没有陈旧 ref 可删（`git ls-remote gitee` 只回两行）。
  **唯一保住这枚镜像且不丢任何当前文件的路**是把两枚全死的前缀请出历史
  （`.pnpm-store/` 187.3 MB + `research/standalone/.npm-cache/` 130.2 MB = **317.5 MB**，两者在 HEAD 里都是 **0 条路径**；19:1x 现量**不含管道**的形状：`git ls-tree -r --name-only HEAD -- .pnpm-store/` 与 `-- research/standalone/.npm-cache/` 各回**空**，而同一形状指到在用的取证目录 `-- apps/web/evidence/` 回**成串路径**（⇒ 那两枚"空"不是搜法读空的，见 §10.6 ㈡；⚠️ **这三个数是"打包后"那把尺**，换成"落盘"尺重取是 186.2 + 130.1 = **316.3 MB** —— 两把尺与各自口径都在 B243 追记三 ③，报数别混），
  代价是**双端强推**重写所有下游克隆 ⇒ 归负责人拍。证据、分母口径与五步预案在 `BLOCKED.md` 的 **B243 追记**。
  ⚠️ 负责人 10-21 问过「会不会有些东西不该提交上去」——那一趟的**体积分账**（当前那一屏占多少、只被旧代际需要的有多少、哪两枚是真错提交、哪一类是有意决策）在 **B243 追记三**，
  它同时否证了两条看起来便宜的出路：「重复截图能省」＝**不成立**（同一 sha 对象库只存一份），「按大类看前缀就够」＝**不成立**（那次漏掉了更大的一侧）。

### 10.8 移动端那一屏的像素取证（2026-10-22 00:0x–00:1x），以及它抓到的一枚真缺陷

**载体**（复跑前先 `xcrun simctl list devices booted` 与 `lsof -nP -iTCP:3177 -sTCP:LISTEN` 现量，别照抄下面这组）：
无头 boot 的 `heyta-iphone-17pro` + `apps/mobile` 的 Release 包重装 + 本机 TEST_MODE 服务端 `http://127.0.0.1:3177`。
🔴 **这一组截图的载体是工作树，不是 HEAD**：当时 `packages/i18n/src/locales/{zh-CN,en}.ts` 正被另一会话改着（`git status --porcelain -- packages/i18n` 现量），
而 renew 那批键本身已入库且没被它动过 —— 所以"屏幕上这句话"与"这句话在 HEAD 里"是两件事，下一位要 HEAD 纯的那一张，得在干净载具里重打。

**证到的三件事**（图在 `apps/mobile/evidence/renew-ios-20261022/`，每张都人眼看过）：

| 图 | 证的是 | 怎么自己核 |
|---|---|---|
| `1-tier-picker-default-hosted.png` | 档位块出现在「我的」屏，两枚按钮都在可及树上，默认实心在**低档**那一枚，且**屏幕上没有任何金额** | `grep -n 'renew-tier-' apps/mobile/src/screens/RenewSection.tsx`（⚠️ 这枚针**别写成双引号带反引号**：那在 shell 里是命令替换，跑不动 —— 本条刚为此改过一次） |
| `2-tier-picker-ai-egress-warning.png` | 换档后说明句换成带「这一步会把内容发到我们的服务器，它不受端到端加密保护」的那一条 ⇒ ADR-0054 §7 要的位置是**按下下单之前** | `grep -n "不受端到端加密保护" packages/i18n/src/locales/zh-CN.ts` |
| `4-AFTER-fix-press-says-login.png` | 未登录时按下「下单续费」，红色失败语「先登录你的 heyta 账号，才能下单。」出现 | `grep -n "renew.fail.unauthorized" apps/mobile/src/screens/RenewSection.tsx` |

🔴 **这一腿真正的收获不是三张图，是抓出一枚在空转的按钮**：未登录时那一块**照样渲染**（唯一的渲染闸门是出境同意，
`readSyncConfig()` 从来不是渲染闸门 —— 而它上面那句注释一直写着"没配服务器时整块不出现"），
按下之后 `onRenew` 在 `config === undefined` 那一支**直接 return** ⇒ 可及树一字未变、**两个像素都没动**。
像素级的对照证据是现成的：`2-…` 与 `3-BEFORE-fix-press-was-silent.png` 的 sha256 **逐字节相同**（`shasum -a 256 apps/mobile/evidence/renew-ios-20261022/*.png` 现量）。
后果是 `mobile.entitlement.renew.fail.unauthorized` 那句在移动壳里**永远走不到** —— 词条、映射、判据全在，就是没有一条路能到它。

**修法**（一处，`apps/mobile/src/screens/RenewSection.tsx` 的 `config === undefined` 那一支）：改成报 `UNAUTHORIZED` 失败，
复用已入库的那句，**不新增文案**、不动 locale。判据落在 `apps/mobile/tests/renew-entry.spec.ts`
（「没配服务器时按下「下单续费」不许静默」，写成"两种合法修法任一"，只挡"什么都不说"这一种形状）。
**反臂现量**：加判据之后、改代码之前它是红的（`AssertionError: … expected false to be true`，00:12），改完之后 10/10 绿；
`apps/mobile` 全量 `vitest run` 78 个文件全过，`pnpm check:payment-entry`／`check:i18n-vars` 各 rc=0（00:18–00:19，tip `c59ccdce2`）。

⚠️ **探针自己先红过一次**：那条判据的第一版把 `u` 写到了正则字面量外面（`/…/.u.test(…)`）⇒ `TypeError`，
输出长得像"判据抓到了违规"，真因却是探针坏了（§7 元规则一）。认出来的办法是读**失败原因那一行**，不是读"它红了"。

### 10.9 「登录后按下「下单续费」⇒ 看到那句拒绝」的像素腿（2026-10-22 00:3x–01:1x），和它顺手拆掉的一枚假绿

**这一格现在是一条命令，不再是一串手工动作**：`pnpm verify:mobile-ios-renew-sellable`（载体 `scripts/verify-mobile-ios-renew-sellable.sh`；
注册现量 `grep -c "verify:mobile-ios-renew-sellable" package.json` 回 **1**）。它从零走到终点：起 app → 过首启两道闸 →
「使用自建服务端」登录 → 开同步 → 进「我的」→ 展开「买哪一档」→ 选「官方托管 + 云端 AI」→ 按「下单续费」→ 截图 → 断言那句拒绝。
最近一趟 **rc=0**：01:15:31（`stat -f '%Sm' .run-logs/renew-leg/leg6.log`）与**改过脚本之后重跑的** 01:25:34（`LEG7_RC=0`，日志 `.run-logs/renew-leg/leg7.log`）。
日志与凭据文件都在 `.run-logs/`（那枚目录 gitignore，**不进仓**）；重跑那一张刻意落到 `.run-logs/renew-leg/rerun-0123/` 而**不覆盖入库那张** ——
两枚 png 的 sha 不同（重跑那张 `9dd0b5d2…` vs 入库那张 `8bcc7494…`），差异只是状态栏时钟，所以入库的仍是人眼看过并登记的那一枚。
图 = `apps/mobile/evidence/renew-ios-20261022/5-signed-in-sellable-refusal.png`（sha256 前缀 `8bcc7494`，人眼看过：
「官方托管同步已开启」卡 + 高档实心 + 出境警告 + 红字那句，**屏幕上依旧一个金额都没有**）。

🔴 **这一腿真正证的是一条行为主张，不是一句话长什么样**：`renew-entry.spec.ts` 钉的是源码形状，而"这台实例没配上游 ⇒ 按下去真的会看到人话"
只能真跑。它同时也是 §10.2 那格"body 码优先于状态码"的**现场证据**：服务端回的是 **409 + `PRICE_NOT_SELLABLE`**，而按状态码猜会给
`PRICE_NOT_EFFECTIVE`（另一句话）—— 现量 `grep -n "ERROR_CODES as readonly string" packages/app-host/src/checkout.ts` 与同文件 `grep -n "409: 'PRICE_NOT_EFFECTIVE'"`。

⚠️ **这条腿的红有一种是"预期内"的**：它断言的是**没配上游才被拒**。运营填好 `MANAGED_AI_*` 之后，同一条命令会走到"下单成功"那一支并判红 ⇒
那不是回归，届时判据要改成盯二维码/跳转。这句话已写进脚本头（现量 `grep -n "预期的红" scripts/verify-mobile-ios-renew-sellable.sh`）。

**这一趟红过六种，六种都不是产品**（按"成因"数，不是按跑的次数数 —— 日志 `.run-logs/renew-leg/leg2…leg7.log` 是逐趟的；留着是因为下一位多半撞同一批）：
① **桥**：本机 idb 没有 `ui set-value`（`invalid choice: 'set-value'`）⇒ 写值只能"聚焦 + `--type-text`"；
② **键盘**：三栏回读逐字相同、按钮按下 rc=0，会话卡却不出现 —— 键盘把「用邮箱和密码登录」盖住了 ⇒ 加 `wait_keyboard_gone`；
③ **系统弹窗**：iOS「保存密码？」把可及树压到 **1 枚**，且弹窗属于**别的进程**（不在 app 树里）⇒ 只能按坐标点，实测中心 (137, 594)；
④ 🔴 **假绿，这枚最贵**：第一版把"树里**搜不到**「保存并启用同步」"读成"已收"，可那棵树当时根本**读不出来**（1 枚）——
「没有」与"读不到"在两枚状态里同形。修法：回读必须要求**树从退化态恢复**（三态探针 `needle_state` 必须回 **rc=1 = 读得出且确实没有**，
rc=2 一律判红）。同族规则见 §7 元规则一、二；
⑤ **新代际的 AuthScreen**：不勾「我同意服务条款与隐私政策…」就没有邮箱栏，还要再点「使用自建服务端」才出表单 —— 按上一代界面写的臂会直接找不到控件；
⑥ 🔴 **一枚被门禁抓到、却不在跑通路径上的**：`check:shell-unicode` 判我脚本里 `$E2EE_FILE）` 与 `$BUNDLE）` 两枚**紧跟全角括号的变量会被吞**（`set -u` 下直接 `unbound variable`）。
   这两行都在**失败分支的报错文案**里，happy path 永远不碰 ⇒ 整腿两趟 rc=0 照过、门却是红的。⇒ 这条给下一位的不是"记得加 `${}`"（那是仓里已有的门在管），
   而是**"脚本跑绿"与"脚本的每一行都成立"是两件事**，别拿前者替后者背书。修完 01:23 该门 rc=0（现量 `grep -c '\${E2EE_FILE}\|\${BUNDLE}' scripts/verify-mobile-ios-renew-sellable.sh` 回 **2**）。

**这一格还没证的**（别读成"移动侧全绿"）：Android 侧一张都没有（出包与真机走 `windows-pc`）；这一腿跑的是**本机 TEST_MODE 服务端**，
不是部署态；真实小额下单与到账回执仍未验（归运营，见 §10.7 第一格）。

### 10.10 任务书六步 ↔ 证据（2026-10-22 01:5x 逐格现取；这一节是**核对**，不是新判据）

⚠️ 每格右侧那条命令就是那一格的**复现腿** —— 跑它就能重判那一格，别把这一节当"已经有人验过了"的抄件。

| 步 / 判据 | 现取的证据 | 还差什么 |
|---|---|---|
| 1① 这一档要交付的 `ai` 能力**这台实例真有**才卖，默认拒 | `grep -n "managedAiConfigured = options.managedAiConfigured" server/src/billing/checkout.routes.ts` 回那一行带 `?? false`；`grep -n "requestedGrants.includes(MANAGED_AI_CAPABILITY) && !managedAiConfigured" server/src/billing/checkout.routes.ts` 命中 ⇒ 判拒 | 运营填 `MANAGED_AI_*`（§10.3 第 1 格） |
| 1② 买更低档会把已有 `grants` 判小的单，**拒在冻结之前** | 次序即证据：拒单那一段的日志针 `grep -n "已拒单（未冻结订单）" server/src/billing/checkout.routes.ts` 命中的行号，**小于** `grep -n "── ⑥ 先冻结" server/src/billing/checkout.routes.ts` 命中的行号 | 无（行为已被用例与臂钉住） |
| 1 反臂能失败 | `pnpm check:checkout-tier-gates` rc=0（01:38，摘除型臂：把闸门摘掉它必须红）；用例名逐枚 `grep -oE "it\(\s*'[^']+" server/tests/billing-checkout.routes.spec.ts` 里含「没配托管上游 ⇒ …409 PRICE_NOT_SELLABLE，并且一张订单都没落」与「¥12 有效期内点 ¥5 ⇒ …409 PRICE_TIER_LOSES_GRANTS，且没有冻结任何订单」 | 复跑要**私有载具**（见 §10.2 第 21:4x 那格与 189 ②） |
| 2 两壳档位**只用钉住的词条**、屏上**不写金额** | 裸金额：`grep -nE "¥|[0-9]+ ?元|\$12|[0-9]+/月" apps/web/src/features/subscription/RenewPanel.tsx apps/mobile/src/screens/RenewSection.tsx` 回**空**；档位标题两枚键 `web.subscription.renew.tierTitle` 与 `mobile.entitlement.renew.tierTitle` 在两枚 catalog 各命中 1 | 无 |
| 2 "两枚 locale 同步"靠什么钉 | **类型**，不靠数键的门：`grep -n "satisfies Record<MessageKey, string>" packages/i18n/src/locales/en.ts` 命中 ⇒ 少一枚 en 键就是 typecheck 红（01:38 `pnpm typecheck` rc=0）。现量键集：两枚 catalog 各 **4011** 枚键，仅 zh **0**、仅 en **0** | 另有 `check:ui-language` 挡硬编码、`check:i18n-vars` 挡占位符漏传 |
| 3 门禁与验收 | 01:38–01:41 在 tip `b0af438ac` 上逐条串行：五道只读门各 rc=0、`check:mobile-renew-shape` rc=0、typecheck rc=0、四份 spec 23/16/10/19 全绿；界面腿两枚 —— web Playwright（18:4x 6 passed，六张人眼看过）与 iOS `pnpm verify:mobile-ios-renew-sellable`（01:15 与 01:25 两趟 rc=0，图人眼看过） | Android 侧像素一张都没有（§10.3 第 7 格） |
| 4 ADR-0054 勘误节（正文一字不改） | `grep -n "^## 10" docs/adr/0054-managed-ai-retention-and-selling-preconditions.md` 命中那一节；`pnpm check:docs` rc=0 | 无 |
| 5 交接文档 + 三本台账 | 本篇 §10.1–§10.9 加本节；`PROGRESS.md` 第 187–191 条；`BLOCKED.md` 的 **B243 追记四** | 无 |
| 6 两枚远端 + 如实报告 | origin：**推完之后**现取 `git rev-list --count origin/main..HEAD` 回 **0**（本线那几笔全在远端；笔数别在这里抄）；gitee：逐字 `Repo size: 1113.234MB, exceeds quota 1024MB`（全文与"体积不单调"那条否证在 §10.2 第 5 戳与 B243 追记四） | 四条出路等负责人拍（甲／乙／丙／丁） |

