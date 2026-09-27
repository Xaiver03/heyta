# 推进计划：把定价故事换成「自建永久免费 + 两个付费项（月付 ¥5 / ¥12）」

> 决策文档：[ADR-0020](../adr/0020-ai-subscription-two-tiers.md)（**状态：已接受**，权威）。
> 本计划是**执行清单**，不是决策 —— 决策与理由一律看 ADR-0020，本文只落地、不重复。
> 所有"现在长什么样"都带 `文件:行号`，是**实测**的；行号已按**当前工作区**逐条复核。
>
> ✅ **本计划已执行完毕（2026-09-27）** —— 落地提交：`0390415`（ADR-0020）、
> `edeb233`（定价落地）、`4ad2ae0`（落地页首屏改大众向）。
>
> 🔴 **本文从此是执行记录，不是待办。** §1.3 的基线输出、§1 的行号、§4 的"已拍板"项
> 全是**当时那一刻**的快照（§1.3 里那行 `check:pricing ¥99 / 年` 就是**改前**的原样输出）。
> **现役价格只以 [ADR-0020](../adr/0020-ai-subscription-two-tiers.md) 与
> [`pricing-and-entitlements.md`](../reference/pricing-and-entitlements.md) 为准** ——
> 不要拿本文的数字当现役事实读。

**新模型（唯一执行口径，取自 ADR-0020 §3.1–§3.4）：**

| SKU | priceId | 大陆 | 海外 | 周期 | `grants` |
|---|---|---|---|---|---|
| 官方托管 | `hosted-monthly` | **¥5 / 月** | **$5 / 月** | 月付，到期手动续 | `hosting` |
| 官方托管 + 云端 AI | `hosted-ai-monthly` | **¥12 / 月** | **$12 / 月** | 月付，到期手动续 | `hosting` + `ai` |

- **自建自托管**：`¥0 / $0，永久`，**全部功能** —— 这是**免费的第三列，不是付费项**。
- `hosted-ai-monthly` 含**我们的云端 AI 300 次 / 月**；自带端点的 AI 两档都免费、不限、不计量。
- 🔴 **作废**：`¥99 / 年`、`$49 / 年`、`annual` priceId、**年付周期**。
- 🔴 **支付适配器周期从 365 天改成 30 天**（ADR-0020 §4.1；改动半径见 §1.4）。

---

## 0. 为什么必须原子改

门禁 `scripts/check-pricing-consistency.mjs` 会**交叉校验四处**（代码基线 / 中英词条 /
法务文本 / 机器可读价格块），而新模型还额外要求收费清单**恰好两个 SKU**、每个 SKU 都带**合法的 `grants`**。所以：

> **只要在 `DEFAULT_PRICE_BOOK` 里换了档、而没同步改另外三处（含 ssot 的形状与 `grants`），
> `check:pricing` 一定红。**

不存在"先改代码后改文案"的中间态。§2 的顺序就是为了这个。

---

## 1. 实测的改动半径

行号已按当前工作区逐条核对（2026-09-27）。

| # | 文件 | 现在（实测） | 要改成 |
|---|---|---|---|
| 1 | `server/src/billing/price-book.ts:170-187` | `DEFAULT_PRICE_BOOK` 2 条基线：`annual` × CNY/USD（`9_900` / `4_900` 分） | 4 条：`hosted-monthly`、`hosted-ai-monthly` × CNY/USD；`annual` **删除** |
| 2 | `scripts/check-pricing-consistency.mjs:89` | ssot 的类型是 `{ cny: {...}, usd: {...} }` —— **单档结构** | `{ skus: [ { priceId, grants, cny, usd } ] }`（见 §3） |
| 3 | 同上 `:153-171` | 把 adapter 的 CNY/USD 金额分别对 `ssot.cny` / `ssot.usd` 比（`yuan`/`dollars` 在 `:153-154`，两个 `if` 在 `:158-171`） | 逐 SKU 比 |
| 4 | 同上 `:182-188` | `bookPriceIds.length !== 1` → 红（注释写着"唯一付费档"） | 恰好 **2** 个，priceId 集合 = `{hosted-monthly, hosted-ai-monthly}`，且各带合法 `grants`（见 §3） |
| 5 | `docs/reference/pricing-and-entitlements.md:108-113` | ```` ```json pricing-ssot ```` 块是**一行** `{cny, usd}` | `skus` 数组（两条，各带 `grants`） |
| 6 | `packages/i18n/src/locales/zh-CN.ts:171-193` | `landing.pricing.hosted.*` 一套（`:184` `¥99 / 年`、`:185` `$49 / 年`）+ `:174`「不是解锁功能」 | 两档各自的键 + 重写故事；**旧价全删** |
| 7 | `packages/i18n/src/locales/en.ts:156-178` | 同上英文（`:169` `CNY 99 / year`、`:170` `$49 / year`；`:159` "not to unlock features"） | 同上 |
| 8 | `apps/landing/src/components/Pricing.tsx` | 168 行，两栏：`free`（`:76-106`）+ `hosted`（`:109-152`） | 见 §4.2（**2 张主卡 + 一行附注**） |
| 9 | `server/legal/terms-of-service.heyta.md` | 标题即「heyta **托管同步服务**条款（草稿）」（`:1`）；`:26-34` 的 scope 表只列同步，`:34`/`:59` 是 `¥99 / 年`、`$49 / 年`，`:60` 写「一次性支付一年」 | 同步那份只改价与周期；**AI 另立新文件**（见 §4.1） |
| 10 | `scripts/verify-i18n-failures.mjs` | `pricing` 组 `groupPricing` 在 `:967`，共 10 条探针（9 条 `expectRed` + 1 条 `expectGreen`），含 `:1035`「偷偷加第二个档」 | 变异跟着新规则改，并**新增**「`grants` 里塞功能名」等反例（见 §3） |
| 11 | `docs/reference/pricing-and-coupons.md` | `:4`（唯一付费档、`¥99`/`$49`）、`:385`（一档到底）；另有 `:153`、`:250-252`、`:335`、`:348` 的 `¥99` 旧价 | 改口成**两档月付** |

### 1.1 顺带查到的好消息

- **券不用改**：`server/src/billing/coupon.ts:96` 的
  `priceIds: readonly string[] | null`（`null` = 全适用）**已经支持按 priceId 定向** ——
  给 `hosted-ai-monthly` 做首月折扣直接就能表达。
- **价格改动只需一处**：adapter 的 `WECHAT_DEFAULT_PRICES` 是从
  `DEFAULT_PRICE_BOOK` **推导**出来的（`projectPrices`），换档位不用手抄金额。
- **法务文件没有任何代码引用**（唯一的引用在 `research/upstream/` 里）——
  说明是草稿、还没被服务器挂出去，改动不会连带破坏代码路径。

### 1.2 🔴 执行时的并发风险（实测于 2026-09-27）

工作区是**多工作流共享**的，当前有 **108 个**未提交改动。§1 的 11 行目标里，
**有 6 个文件在动手那一刻就已经是脏的**：

| 文件 | 状态 |
|---|---|
| `packages/i18n/src/locales/zh-CN.ts` | 🔴 脏（另一条工作流在加 `mobile.*`/`web.*` 词条） |
| `packages/i18n/src/locales/en.ts` | 🔴 脏（同上） |
| `scripts/check-pricing-consistency.mjs` | 🔴 脏（在加 `HEYTA_CHECK_ROOT`，让探针跑副本） |
| `scripts/verify-i18n-failures.mjs` | 🔴 脏（+192 行，把 `pricing`/`coupon` 两组搬进 `/tmp` 副本） |
| `docs/reference/pricing-and-entitlements.md` | 🔴 脏（本轮刚修掉那句过期的 `check:pricing`） |
| `docs/reference/pricing-and-coupons.md` | 🔴 脏 |

**处置（照仓库既有的做法）**：提交时对共享文件用
`git show HEAD:<path>` 取基底 → 只叠加我这一处 → `git hash-object -w` →
`git update-index --cacheinfo`。**工作区保留所有人的行，提交只带走我的。**

⚠️ 顺带一条纪律：`verify-i18n-failures.mjs` 的 `pricing` / `coupon` 两组现在
**跑在 `/tmp/heyta-i18n-probe` 的副本上**，真实工作区一个字都不改；但其余 11 组
**仍然就地改真实文件**（含 `zh-CN.ts`）。所以 §7 的命令**不要和 `pnpm build`
并行跑**。

⚠️ **复核期间现场又变了**：写这份计划的过程中，另一条工作流已经开始动
`server/src/billing/price-book.ts`（`DEFAULT_PRICE_BOOK` 已被换成
`hosted-monthly` / `hosted-ai-monthly`，`git status` 从 111 行变成 112 行）。
所以 **§1 的行号是复核那一刻的快照，开工前必须重跑 `git status` 并重新核对**；
`price-book.ts` 也是多方共享的文件，`git show HEAD:<path>` 那条纪律同样适用。

### 1.3 ✅ 动手前的基线（实测于 2026-09-27）

在**当前这个共享的脏工作区**上跑了一遍全量门禁，结果**全绿**：

```
$ pnpm check     → exit 0
  ✅ check:migrations    32 个迁移文件
  ✅ check:layering      115 个文件、8 条规则
  ✅ check:ui-language   102 个文件、188 处文案；zh 896 条 / en 896 条
  ✅ check:licenses      910 个包，全部宽松许可
  ✅ check:docs          246 个文件、911 个链接、57 处章节引用
  ✅ check:pricing       ¥99 / 年（大陆，9900 分）、$49 / 年（海外）
  ✅ check:design / check:tokens / check:arkts / check:native-deps
  ✅ check:mobile-bundle / check:materialized-reads / check:ai-coverage
  ✅ check:ai-e2e        13 个 Playwright 用例全过
```

```
$ pnpm test      → exit 0
  ✅ apps/web      479 passed | 12 skipped
  ✅ apps/node-host 139 passed（含真钥匙串、真子进程 MCP 往返）
  ✅ 其余包全通过
```

⚠️ 上面 `check:pricing` 那行的 `¥99 / 年`、`$49 / 年` 是**改前基线**的原样输出，
不是要保留的价格。改完之后这一行必须变成 `¥5 / 月` / `¥12 / 月`。

**这条基线的用处**：它把"哪些红是别人未提交的改动造成的"这个问题**消掉了** ——
现在是零。所以 §2 改完之后**任何红都必须由我负责**，不许说"大概是别人的"。

⚠️ 但要注意：基线全绿是**此刻**的。共享工作区里有 108 个未提交改动，
别人随时可能把自己的半成品提交进来、让基线变红。**开工前重跑一次**，
别拿这份记录当永久凭证。

顺带一条实测：`check:ai-coverage` 已经在强制 ADR-0020 §3.4 边界第 6 条
（输出里写着「托管 AI 的文案仍带「不受端到端加密」的明确否定（ADR-0006）」），
所以那条边界不是我新发明的，是**既有门禁已经守着的**。

### 1.4 新模型额外新增的改动半径：月付周期 365 → 30 天（本轮实测）

ADR-0020 §4.1 把周期从年改成月。除了 §1 表里的价格与文案，真正要动的地方是：

| 位置 | 现在（实测） | 要改成 |
|---|---|---|
| `packages/domain/src/subscription.ts:255` | `SUBSCRIPTION_PERIOD_DAYS = 365`（`:289` 是它的默认值用法） | `30` |
| `server/src/billing/wechat.adapter.ts:75` | `WECHAT_ONE_TIME_PERIOD_DAYS = 365`（`:74` 注释写「一次性年付」，`:735`、`:783` 接线） | `30`，注释同步改成月付 |
| `server/src/billing/apply-event.ts:113-116` | 注释里写「一次支付 = +365 天」（`:125` 的 `periodDays` 参数、`:151` 的算术才是真逻辑） | 注释改「+30 天」；算术本身不变，只改传入的值 |
| 会红的测试 | `server/tests/billing-apply-event.spec.ts:22`/`:89`/`:94`/`:111`、`server/tests/wechat-adapter.spec.ts:643`/`:738`/`:745`/`:797`、`packages/domain/tests/subscription.spec.ts:229-237` 等把 365 当常量用 | 全部换成 30，或改引常量、别再写死 |

⚠️ `wechat.adapter.ts:74` 的注释明确写着它与 `SUBSCRIPTION_PERIOD_DAYS` **同值** ——
两个常量**必须一起改**，否则一个按年、一个按月，续费叠加会算错。

---

## 2. 执行顺序（一个原子提交，或一串必须连着跑的提交）

每一步的"验证"都是**可以失败的**：先看它红、再看它绿。

1. **门禁先行**（TDD 式）：先把 `check-pricing-consistency.mjs` 的「唯一付费档」断言换成
   §3 的「恰好两个 SKU + `grants` 白名单」，并把 `pricing-and-entitlements.md` 的
   `pricing-ssot` 块改成 `skus` 数组。
   → 验证：此刻 `pnpm check:pricing` **必须红**（price-book 还是只有 `annual`，且没有 `grants`）。
2. **加基线 + 改周期**：`DEFAULT_PRICE_BOOK` 换成 4 条（`hosted-monthly`、`hosted-ai-monthly` × CNY/USD）；
   同时按 §1.4 把 **365 天改成 30 天**。
   → 验证：`pnpm check:pricing` 转绿；`server/tests/billing-*.spec.ts`、
   `packages/domain/tests/subscription.spec.ts` 全绿。
3. **改中英词条 + 组件**：两档文案 + `Pricing.tsx` 结构（§4.2）。
   → 验证：`pnpm --filter @heyta/landing test` 全绿（含 `#pricing` 里 button 数为 0）。
4. **改法务文本**：按 §4.1 —— 同步那份改价与周期，**新增**
   `server/legal/terms-of-service.ai.heyta.md`。
   → 验证：门禁的"法务文本价格行"检查绿（且 `LEGAL` 已改成读**两份**）。
5. **更新注入式反例**：`verify-i18n-failures.mjs` 的 `pricing` 组。
   → 验证：`node scripts/verify-i18n-failures.mjs pricing` 全绿，
   且**每个变异都真的变红**（含新增的"`grants` 里塞功能名"）。
6. **参考文档改口**：`pricing-and-entitlements.md`（ssot 之外的旧价与"年"）、
   `pricing-and-coupons.md` 等。
   → 验证：`pnpm check:docs`、`pnpm check:tokens`。
7. **全量**：`pnpm check` + `pnpm test`。
8. **部署 + 线上验收**：按**浏览器解析方式**取资源（见 §5）。

---

## 3. 新增门禁规则的准确措辞

ADR-0020 §4.1 要 `check-pricing-consistency.mjs` 把「恰好一个 priceId」换成
「**恰好两个 SKU，每个必须声明 `grants`，`grants` 只允许 `hosting` / `ai`**」。
下面是可直接写进脚本的判据 —— **任一条不满足就 `problems.push` 并退出码 1**：

> **规则 3.1（结构）**：`pricing-ssot` 块的形状必须是
> `{ "skus": [ { "priceId": string, "grants": string[], "cny": {...}, "usd": {...} }, ... ] }`。
> 缺 `skus`、`skus` 不是数组、某个 SKU 缺 `grants` 或缺 `cny`/`usd` → 红。
>
> **规则 3.2（恰好两个）**：`skus` 的长度必须**恰好是 2**；去重后的 `priceId` 集合必须
> **恰好等于** `{ "hosted-monthly", "hosted-ai-monthly" }`。少一个、多一个
> （例如残留的 `annual`、或偷加的第三个档）、改名，全部红。错误信息要原样打印实际集合，
> 与批准集合并排。
>
> **规则 3.3（`grants` 白名单）**：每个 SKU 的 `grants` 必须是**非空**字符串数组，且
> **每一个元素**都必须命中白名单 `{ "hosting", "ai" }`。命中不了的值
> （例如 `labels`、`focus`、`four-quadrant`、`unlimited-devices`）→ 红，
> 并把非法值**原样打印**出来，指明是哪个 SKU。
>
> **规则 3.4（授权关系）**：`hosted-monthly.grants` 必须恰好是 `["hosting"]`；
> `hosted-ai-monthly.grants` 必须恰好是 `["hosting","ai"]`（集合相等，顺序无关）。
> 这条钉住"两档的差异**只有 AI**"（ADR-0020 §3.4 第 3 条）：`hosted-monthly` 不许偷偷带 `ai`，
> `hosted-ai-monthly` 不许漏掉 `hosting`。
>
> **规则 3.5（代码基线对齐）**：`DEFAULT_PRICE_BOOK` 里 `priceId` 的种类集合必须与 `skus` 的相同，
> 且每个 SKU 在 CNY 与 USD 各有一条基线（共 4 条）。金额仍按 §1 表第 3 行逐 SKU 比。

**为什么这样能挡住"非 AI 能力进收费清单"**：`grants` 的合法值是一张**两词白名单**。
一个非 AI 功能（标签、专注、四象限…）**没有合法的 `grants` 可填** —— 要把它写进收费清单，
就必须先改这张白名单，而改白名单要过 ADR。这比"扫描收费清单里有没有出现功能名"这种模糊检查
可靠得多：后者会被改个说法（`labels` 换成 `organize`）绕过，而白名单是**闭集**，绕不过去。

⚠️ 门禁现在只读**一份**法务文本（`LEGAL = server/legal/terms-of-service.heyta.md`）。
§4.1 新增 AI 条款后，`LEGAL` 必须改成读**两份**，否则新那份里的价格不在交叉校验里。

---

## 4. 随新模型一起定的衍生决策

> 下面几条产品负责人已经拍板，记的是**结论 + 落地动作**；决策与理由在 ADR-0020，
> 本文只执行、不复述论证。

### 4.1 法务：**新增** `server/legal/terms-of-service.ai.heyta.md`（已拍板）

**结论：新增，不扩写。**

现状（实测）：`server/legal/terms-of-service.heyta.md:1` 的标题就是
「heyta **托管同步服务**条款（草稿）」，`:26-34` 的 §2 把自己限定在"托管同步服务"，
正文说「本条款**只**规范我们替你运维的那台同步服务器」。

为什么新增（ADR-0020 §4.2）：AI 订阅**不是**同步服务，而且 ADR-0020 §3.5 的
**计量与保留披露只对 AI 成立**（同步是密文、没有内容派生量）。塞进同一份会让
「我们看不到你的任务内容」这个**强承诺**被稀释掉。

落地动作：

1. 新增 `server/legal/terms-of-service.ai.heyta.md`，承载 ADR-0020 §3.5 的计量与保留口径
   （只存 `(用户, 计费周期, 已用次数)`、周期结束后只留整数记录并**保留 12 个月**、
   设置页可见"本周期已用 X / Y 次"）。
2. 🔴 **不许**把托管 AI 描述成端到端加密，且**不许**与同步那句"我们看不到你的任务内容"
   混在一处讲（ADR-0020 §3.4 第 6 条；`check:ai-coverage` 已在守这条）。
3. 同步那份（`terms-of-service.heyta.md`）只改价格与周期：`:34`/`:59` 的
   `¥99 / 年`、`$49 / 年` → `¥5 / 月`、`$5 / 月`；`:60` 的「一次性支付一年」→ 月付。
4. 门禁的 `LEGAL` 常量要**同时读两份**（见 §3 末尾），否则新文件里的价格没人交叉校验。
5. 无论怎样都要中国律师过目（ADR-0017 §5.1 的工信部 292 号令定性未决）。

### 4.2 落地页：**2 张主卡 + 一行附注**（已拍板）

> 🔴 **后补：实际落地的是三栏，不是本节写的「2 张主卡 + 一行附注」。**
> 见 `apps/landing/src/components/Pricing.tsx` 文件头（「版面：**三栏**」）——
> 自建免费 / `hosted-monthly` ¥5 / `hosted-ai-monthly` ¥12 各占一栏。
> 本节正文保留作当时的计划记录，**以代码为准**。

**结论：不做 4 张卡平铺。**

`Pricing.tsx` 现在是两栏：`free`（`apps/landing/src/components/Pricing.tsx:76-106`）+
`hosted`（`:109-152`）。新模型下把它们长成：

- **主卡 1**：自建自托管 —— `¥0 / $0，永久`，**全部功能**。
- **主卡 2**：`hosted-ai-monthly` —— `¥12 / 月`（海外 `$12 / 月`），含我们的云端 AI
  （**300 次 / 月**）。
- **一行附注**：`hosted-monthly` —— `¥5 / 月`（海外 `$5 / 月`），只要托管、**不含**
  我们的 AI。它是一句话，**不是第 3 张卡**。
- 保留现有的 `landing.pricing.noFeatureGate`（`zh-CN.ts:174` / `en.ts:159`）那句
  "你付的是我们替你运维服务器，不是解锁功能" —— ADR-0020 §1.2 明说这句**仍然对**。
- 🔴 `¥12` 那张卡必须写明"内容会到 heyta 的服务器"，且**不许**与同步那句
  "我们看不到你的任务内容"混在一处讲（ADR-0020 §3.4 第 6 条）。
- `#pricing` 里**仍然不许**出现能点但没反应的购买按钮（ADR-0020 §4.3：两档都还没接线）。

### 4.3 旧「`¥199` vs 竞品 `¥139`」的张力 → **已自解**（记录）

旧计划 §4.3 担心的那条观感冲突**没有了**。ADR-0020 §3.7 已经把
`¥12 / 月 × 12 = ¥144 / 年` 与滴答清单 Premium `¥139 / 年` 对上 —— 只高
**¥5（3.6%）**。而且 heyta 的非 AI 部分是**永久免费、自建全功能**的，所以这个价格站得住，
**不需要额外解释**，落地页也不必专门做对比文案。**这一条不再是待决项。**

### 4.4 `annual` → 必须改名成 `hosted-monthly` / `hosted-ai-monthly`（已拍板）

旧计划里"改不改都行"的 `annual` 改名，现在**必须改**：周期从年变成月，`annual` 这个名字
直接撒谎；而且 §3 规则 3.2 要求 priceId 集合**恰好**是两个新名字，留着 `annual` 就红。

落地动作：

- `DEFAULT_PRICE_BOOK`（`server/src/billing/price-book.ts:170-187`）、`pricing-ssot` 块、
  中英词条、法务文本里的 `annual` 全部换成 `hosted-monthly` / `hosted-ai-monthly`。
- `annual` 是 `price_versions.priceId` 里的字符串，改名是一次**改价事件**，
  走 [ADR-0018](../adr/0018-adjustable-pricing-and-coupons.md) 的 `publishPriceVersion`。
- 两个新 priceId 都带 `effectiveFrom: 0`（基线语义），不建"上线时刻"的空隙
  （`server/src/billing/price-book.ts:167` 的注释）。

---

## 5. 线上验收判据（这次不再犯上次那个错）

上次我报的线上地址是错的，根因是**我验的是磁盘上的文件、不是访客看到的页面**。所以：

> **判据必须是：把 HTML 里引用的每个 URL 按浏览器的方式解析（根绝对路径 → 拼域名根，
> 不是拼当前路径）后再请求，并检查 MIME。**

具体清单：

1. `curl -sL https://heyta.finlaw.cloud/` → 200，且 HTML 里能数到**两个付费项的价格**
   （`¥5 / 月` 与 `¥12 / 月`）与「自建永久免费（全部功能）」的说法。
2. 从 HTML 里抽出所有 `src=` / `href=` 的**根绝对路径**，逐个请求：
   `.css` → `text/css`、`.js` → `application/javascript`、`favicon.svg` → `image/svg+xml`。
   **任何一个 404 或 MIME 是 `application/json` 就是失败的。**
3. `grep -c "github\.com"` 那个已被部署的 bundle → **必须 0**（仓库是私有的）。
4. `/en/` → 200 且 `<html lang="en"`；英文海外价是 `$5 / month` 与 `$12 / month`，
   英文大陆价带 `CNY` 前缀（`CNY 5 / month` / `CNY 12 / month`），与中文一致。
5. `#pricing` 里的 `<button>` 数量 → **0**（两档都还没接线，不许出现点了没反应的按钮）。
6. ~~`#pricing` 的主视觉是 **2 张卡**（自建 / 含 AI），`¥5` 托管以**一行附注**出现 ——
   不是第 3、4 张卡（§4.2）~~ 🔴 **实际落地的不是这个形状**：现在是**三栏**
   （自建免费 / 官方托管 ¥5 / 官方托管 + 云端 AI ¥12），见
   `apps/landing/src/components/Pricing.tsx` 文件头的「版面：**三栏**」。
   即 §4.2 的「2 张主卡 + 一行附注」**没有按字面执行** —— **以代码为准**。

---

## 6. 风险与回滚

| 风险 | 处置 |
|---|---|
| 门禁改完但 price-book 没改 → 仓库红 | §2 的顺序保证在同一批里完成；中途不留红状态 |
| `grants` 白名单被顺手加了一个功能名 | 规则 3.3 直接红；改白名单必须过 ADR（这正是 ADR-0020 §3.4 第 1 条要挡的） |
| 旧的 `annual` 残留 → 规则 3.2 红 | §2 第 2 步与 §4.4 一起清掉 |
| 周期只改了一处（adapter 改了、domain 没改） | §1.4 的两个常量**同值**，必须一起改；§2 第 2 步的测试会红 |
| 词条/组件改完但法务没改 → 门禁红 | 同上 |
| 新增 AI 条款里的价格没被扫（`LEGAL` 只读一份） | §4.1 第 4 条：`LEGAL` 改成读两份 |
| 注入式反例变成"永远绿"（假通过） | §2 第 5 步：**先看每个变异红**，再看整体绿 |
| 落地页部署后又出现"资源 404" | §5 的判据 2 就是专门防这个的 |
| 线上要回滚 | nginx 配置已在 `ubuntu-jcli:~/heyta-tmp.nginx.orig-20260927-114609`；落地页产物有 `~/heyta-landing-backup-*.tgz`。⚠️ **2026-09-27 之后**：域名已迁到 `heyta.finlaw.cloud`，回滚要同时换 `~/heyta/server/.env` 与两份站点文件（清单见 [deployment.md §7.1](../runbooks/deployment.md)） |

---

## 7. 命令

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"   # node 不在默认 PATH

pnpm check:pricing                                    # 门禁（单跑，快）
node scripts/verify-i18n-failures.mjs pricing         # 注入式反例：pricing 组
node scripts/verify-i18n-failures.mjs coupon          # 注入式反例：coupon 组
pnpm --filter @heyta/landing test                     # 落地页渲染断言
node research/tools/docs-link-check.mjs               # 文档无死链（改完计划后跑一次）
pnpm check                                            # 全量门禁
pnpm test                                             # 全量测试
```

⚠️ `verify-i18n-failures.mjs` **必须分组跑** —— 全量跑超过 60 秒会被掐。
