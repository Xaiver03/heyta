# ADR-0052：公共事实由**部署方下发** —— heyta 第一条服务端 → 客户端的内容通道

> 状态：已接受（2026-10-03）
> 工单：[`countdown-anniversary.md`](../plans/countdown-anniversary.md) **W4b**（调休/补班）
> 前置：[ADR-0044](0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md)（把调休定为 C 档 = 运营录入）、
> [ADR-0038](0038-admin-console-scope.md)（后台范围，**本文 §5 回写它**）
> 被本文定性的对象：AGENTS.md §1 那句「云端只是同步通道，**不是事实源**」

---

## 1. 背景：三条既有立场和一件事实撞上了

事实是：**调休/补班（"哪个周六上班"）不由我们生产，也不随包分发得动。**
国务院公告每年发布两次，批次一立的随包节假日表（W4，`scripts/vendor/holiday-cn/load.mjs`）
只能覆盖到抓取那一年，年份不够时产品必须降级 —— 那条降级判据就是为这件事留的。

要把每年的公告送进产品，撞上三条写在前面的立场：

1. **AGENTS §1**：本地优先，"云端只是同步通道，不是事实源"。
2. **端到端加密**：服务端从设计上看不到用户明文，它给的每一条下行都该是密文。
3. **ADR-0038**：后台首版"只读 + 三个低风险动作，都不涉及钱"。

仓库里当时**没有任何先例**可参照 —— 所有 server → client 的读都是账号级的（都要 token）。
所以这不是"照着做"，是要先给一件事定性，才谈得上把它做对。

---

## 2. 决策

**一句话：这条通道下发的是公共事实，不是用户数据。AGENTS §1 那句约束的是后者。**

"云端不是事实源"之所以成立，是因为**用户自己的数据**在服务端只以密文存在、服务端无法裁决其内容，
真源必须在设备上。而"2026-10-10 是休息日"这句话 (a) 不是任何人的数据，(b) 服务端完全读得写得出，
(c) 它的事实源本来就在设备之外。把它塞进那句约束，是在让一句话承担它没被写过的那个意思。

⇒ 准确的表述是：**对公共事实而言，部署方就是事实源；对用户数据而言，设备才是。**

### 2.1 读面：匿名、只读、**不带任何身份维度**

- `GET /api/holiday-adjustments`（注册在 `/api` 前缀下），无 token、无 cookie、无用户标识。
- 🔴 **承重结构**：路径与查询串里**不许**出现 `:id` / `?userId=` / 按清单/按地区分流的形态。
  一旦"按用户下发不同的公共事实"成为可能，它就从公共事实变成了用户画像，本 ADR 的定性当场作废。
  这条不是文风要求 —— 它是本文唯一可判的边界，评审时应当照着它问一遍"这个端点能不能按人给不同答案"。

### 2.2 写面：后台里权限最高的一组，且**只有整年替换**

- `GET /api/admin/holiday-adjustments` —— 已录入的年度与逐日表（含 `papers` 出处回显）。
- `PUT /api/admin/holiday-adjustments/years` —— **一个年 = 整体替换**该年逐日表。
  不做 patch 单条：一次误写不会留下半个状态，撤销的语义因此可以是"退回随包表"而不是"删掉某一行"。
- `DELETE /api/admin/holiday-adjustments/years?year=` —— 撤销某一年 ⇒ **退回随包表**，
  🔴 **不是"下发空的一年"**（下发空年会让界面上"什么标记都没有"被读成"今年没有调休"，而真相是"这个部署方没录"）。
  年份走查询串而不是 `/years/:year`，因为 PUT 的年份住在 body 里；同一个数字两个来源就必须再写一条守卫。

### 2.3 形状只有一份，住在 `packages/shared-schema`

`holiday-adjustment-contract.ts` 同时是三样东西：服务端 zod 校验的唯一规则来源、公开 GET 响应体的唯一形状来源、
`check:public-facts` 那条门禁的被检查对象。

理由不是"整洁"：`server` 只依赖 `domain` / `shared-schema` / `sync-core`，而 `app-host` 依赖 `shared-schema` 但**没有 zod**
⇒ 校验函数只能从本包导出。这与 `account-profile-contract.ts` 文件头讲的是同一件事，
也是 AGENTS §3.5 那条"同一个判断抄三遍，漂移就从那里开始"的直接教训。

### 2.4 出处是必填，不是可选项

`papers` ≥ 1 且必须是 http(s) 原文链接。没有出处的调休数据不能进库。

随包抓取脚本早就立了这条（`scripts/vendor/holiday-cn/load.mjs` 对 `papers` 非空的要求）；
**运营录入没有理由比自动抓取更宽松** —— 手打的字反而更容易丢出处。

### 2.5 客户端缓存不是同步事实

下发的内容进 `packages/storage` 的 `STORES.META` / `META_KEYS`（`clientId`、`lastServerSeq` 就住这里）：
**不进 op-log、不跨设备、不 bump `CURRENT_SCHEMA_VERSION`**（AGENTS §3.3）。

判据很硬：这条下行不是"用户的某个意图"，把它写进 op-log 会让另一台设备回放它时
产生一个从未发生过的用户动作（AGENTS §3.4 那条"被回放的 op 不得再触发副作用"的反面）。

### 2.6 降级是产品语义的一部分，不是兜底代码

拿不到 / 年份缺失 ⇒ 退回随包表，界面**不报错、不留空块**。
呈现走共享 `CalendarBoard` 的 `DayCell`，做法必须遵守仓库已经吃过的那条教训：
**给共享组件加"默认值等于原值"的可选 prop**（`dayMarker?: (date) => 'off' | 'work' | undefined`，默认 `undefined` ⇒ 什么都不画）
⇒ 没有该数据的宿主零改动、零视觉变化。

### 2.7 每个部署方各自的内容

通道随代码走，**内容不随包分发**。自托管实例的调休表由该实例自己录入（很可能就是空的），
官方实例由运营者录入。这条是 §2 那句定性的直接推论：如果自托管要"同步官方的表"，
那就变成"另一个人的服务器决定我日历上写什么"，AGENTS §1 那句话就该被重新解释 —— 而我们不打算重释它。

---

## 3. 为什么不选另外两条路

| 选项 | 否掉它的理由 |
|---|---|
| **A. 继续随包分发，每年发版补数据** | 公告一年两次，产品发版节奏不匹配；更糟的是**自托管部署者永远拿不到新公告**，除非自己重新构建。这条在批次一是可接受的（节假日表变化慢），在调休上不可接受。 |
| **C. 客户端自己抓 gov.cn** | 把抓取与 PDF 解析责任放到每一个用户的网络环境里（失败面 ×N 且不可观测），而且端上"抓什么、怎么解析"是产品行为，不是用户数据 —— 等于把运营职责分散到端点。 |

---

## 4. 后果

**好的**：调休数据一年只需录入两次；自托管与官方实例用同一条通道、各自负责自己的内容；
年份不够时的降级判据（批次一欠的那半条）与"拿不到数据"的判据①落在**同一个载体**上，一次做掉两条。

**要认下来的代价**：

1. 🔴 **公共事实的爆炸半径是"全体用户"**。它比 ADR-0038 里那三个支持动作（解锁/配额/登出，作用域都是单个账号）
   更对外：录错一年，所有人的日历上都错一年，而且**没有回滚按钮以外的自愈路径**（用户端看不到"这条来自部署方"）。
   ⇒ 所以写面必须① 是后台权限最高的一组、② 只有整年替换、③ 出处强制。这三条不是防御性编程，是本文的定性所要求的。
2. 这是**第一条** server → client 的内容通道，之后每一条都会来引用本文。
   所以"匿名、无身份维度"必须能被机器判，不能只写在文档里 —— 落点：`check:public-facts` 读契约的
   `PUBLIC_FACT_SHAPES`，往那里加第二种形状（或给公开路径加身份参数）会让它红。
   ⚠️ **该门禁本轮尚未接进 `pnpm check`**（契约文件头已经把它写成 `scripts/check-public-facts.mjs`，
   但那个脚本此刻在 main 里**不存在** —— `ls scripts/check-public-facts.mjs` 现量；登记为 W4b 收尾项，别读成已存在）。
   ✅ **上面这句已经过期**（2026-10-04 现量）：脚本存在且已接进 `pnpm check`
   （`package.json` 里 `check:public-facts` 一条 + `check` 串里那一处），
   实跑 rc=0、分母把 21 条 GET 与 3 条匿名面打印在输出里。留原句是为了让人认出
   "**引用的运行落后于实际跑过的运行**"这个第三种漂移形状。
   🔴 同批补上的一处真缺口：契约与路由两边此前都指着
   `server/tests/holiday-public-route.spec.ts`，而那个文件**不存在** ——
   匿名读面（ETag 四种写法、304 空 body、500 不退化成空集、per-route 速率）
   从没有过任何消费者。现在它存在了。
3. **法务口径经判定不改**。`packages/legal/src/documents/third-parties.ts` 那张"heyta 服务器发出的对外请求"表管的是
   **出网**（server → 第三方），本通道是 server → 用户自己的设备，中间没有任何第三方 ⇒ 四类集合不变。
   这条判定在计划 §8.2 L' 的普查表里，带 82 行候选的读数，不是本文新立的断言。
4. **缓存不是正确性来源**。条件请求（ETag / `cache-control` / 304）只为省流量；
   客户端在 304 与网络失败两条路上都必须走到同一个降级分支。

---

## 5. 回写 ADR-0038 的后台范围表

ADR-0038 §2 第三条把首版写面钉成"仅三个、都不涉及钱"。W4b 增加**第四类写动作**：公共事实的年度录入。
它不涉及钱，但也不落在原来那三个的**单个账号**作用域里 —— 所以回写的是"作用域"这一维，不是把三个改成四个了事。
⇒ 回写的**方式**遵守 [`README.md`](README.md) §1a：在 ADR-0038 **文末追加 `## 5. 勘误（2026-10-03）`，正文一字未改** ——
那"三个"是它 §3.4 整节论证的证据本身，改掉它，后来人就没法 reconstruct 当时的取舍。
勘误段里逐条写明：① "仅三个"是当时的决定、不是当前清单；② 新这一个与原来三个差在**作用域**（单账号 vs 全体用户）；
③ 它 §4.2 第 4 条"三个写动作没有审计表"的覆盖对象同样过时；④ 它 §4.3 那三条不变量**逐条核过没破**
（新端点不返回密钥类字段、这条下行不走 `account_notifications` 所以没有新 kind、不碰 `Subscription`/`CheckoutOrder`/`Coupon`），
§2 第二条的单级 `isAdmin` 也没变 —— 新三端点走的是同一个 `addHook('preHandler', requireAdmin)`。

---

## 6. 明确不做

- 不做按用户 / 按地区 / 按清单分流的公共事实（见 §2.1）。
- 不做服务端主动推送刷新（下行由客户端在启动/回前台时拉；推是另一条线，且会撞上 §2.5 那条 op-log 纪律）。
- 不把官方实例录入的表随安装包分发给自托管实例。
- 不在产品里判断某天"该不该放假"—— 与"永不对活动分健康与否"（ADR-0022 同族红线）是同一条立场。

---

## 7. 证据与读数（接受时实现尚未合进 main —— 04 22:2x 已在 `origin/main`，见本节末条）

⚠️ **下面每条都写明它是哪一趟的读数** —— 本 ADR 是在工单进行中提前定性的，代码还在并行工区里。

- 读数载体：分支 `feat/countdown-w4b`（`a2313c9a` + 当时工作区未提交），2026-10-03 20:30 现量。
  main 里**没有**这些文件；合流前本文的 §2.1/§2.2 属于"已决定 + 已在写"，不是"已上线"。
- 已落地（在该分支上）：`packages/shared-schema/src/holiday-adjustment-contract.ts`（含
  `PUBLIC_FACT_SHAPES`、`papers` ≥1、`isRealCalendarDay` 拒绝非法日期、年份区间 2007–2100、逐年 ≤400 天）；
  `server/src/holidays/holiday-adjustment-store.ts` + `holiday-adjustment.routes.ts`（公开 GET 带 ETag /
  `cache-control` / 304 两条分支）；`server/src/admin/admin.routes.ts` 的 GET/PUT/DELETE 三端点
  （插件级 `requireAdmin` 覆盖，见 ADR-0038 §2）；`packages/domain` 的 `adjustmentOn` 覆盖表入口（commit `7049bfed`，
  该笔的信息自己就写着"后台做完、全绿，客户端读的仍是随包表，判据①根本没有载体"）；
  迁移 `server/prisma/migrations/20261009000000_add_holiday_adjustments` + PGlite 判据。
- 🔴 ~~**尚未落地**（20:30 现量，命令：`grep -rln "holidayAdjustment\|dayMarker" packages/app-host/src packages/ui/src apps/web/src packages/storage/src`）：
  命中集合里**没有** app-host / ui / web / storage 的落点 ⇒ **客户端拉取那半 + `dayMarker` 那个可选 prop 都还没写**。
  所以 W4b 的"判据①（拿不到数据 ⇒ 不报错、不留空块）"目前**仍没有载体**，这条工单**不能打勾**。~~
  ✅ **04 22:2x 现量更正：这两半都已落地，本条被后来的工作追上而失效**（不是当时的探针坏了 ——
  `git log` 自证：`dayMarker` 那笔是 10-03 **22:06**（`509a06cd`）、客户端拉取那笔是 **22:58**（`b05fbc50`），
  都在这条读数的 20:30 **之后** ⇒ 那句"还没写"在它自己的时间戳上是对的。载体 = 本分支 `9adb5f08`；
  复现命令与原文一致，只把 `packages/storage/src` 换成 `apps/mobile/src`（存储层不参与公共事实，
  原文把它列进落点清单是个**空目录项**，但它对结论无影响 —— 另外三个目录当时确实都还没有命中））：
  ① 客户端拉取那半 = `packages/app-host/src/public-facts.ts`（`startPublicFacts`/`onFactsChanged`，
  经 `packages/app-host/src/index.ts:711` 导出）+ web 侧宿主接线 `apps/web/src/features/calendar/public-facts.ts`
  与 `apps/web/src/main.tsx:34` 的 `startPublicFacts(...)`；判据载体 `packages/app-host/tests/public-facts.spec.ts`（11 条 `it`）。
  ② `dayMarker` 可选 prop：定义在 `packages/ui/src/calendar/CalendarBoard.tsx:152`
  （`readonly dayMarker?: ((date: LocalDate) => CalendarDayMarker | undefined) | undefined`，默认 `undefined` ⇒ 什么都不画），
  现量命中 8 个文件：上面那份 + `calendar/model.ts`、`countdown/EventBoard.tsx`、`timeline/GanttChart.tsx`、
  `apps/web/src/features/calendar/{CalendarView,CalendarSidebar,store}.ts(x)`、`apps/mobile/src/screens/CalendarScreen.tsx`
  ⇒ 三端都接上了，不是"共享层做了、宿主没接"那一档。
  📌 **这条的价值在于它证明了本文的日期标注是承重的**：一句带时间戳的"还没做"会在 **96 分钟**后变成假的，
  而它不会自己通知你。所以 §7 每一格的读数都必须写载体，引用本文状态前先现量。
- 🟢 **合并态读数（04 22:2x）**：`origin/main` = `91a672f6`（第六次并入）之后的本批收口笔已推上去，
  §2.1/§2.2 从"已决定 + 已在写"升级为**已上线**；W4b 的判据①自此有载体。
- ⚠️ **编号撞车登记**：该分支的契约文件头写的是「定性见 [ADR-0050] `docs/adr/0050-public-facts-are-deployer-supplied.md`」——
  那个号已被另一条会话占用（`0050-e2ee-key-lifecycle-and-recovery.md`，未跟踪），
  `0051` 是移动端提醒投递。⇒ 本决定落在 **0052**，合流时必须把契约里那个 `0050` 指针改成 `0052`；
  如果并行那条线自己写了 `0050-public-facts-are-deployer-supplied.md`，**保留一份**（本文），把它的增量并进 §2/§4 后删掉重复件。
