# AGENTS.md

给在本仓库工作的 AI agent 的规则。**这些是约束，不是建议。**

面向人的贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)；文档该放哪见 [`docs/README.md`](docs/README.md)。

---

## 1. 这个项目是什么

heyta 是一个**本地优先**的任务管理应用，目标是做一个功能上对标滴答清单、但可以自建/自托管的替代品。

- **本地优先**：数据先落本地，云端只是同步通道，**不是事实源**。
- **端到端加密**：服务端从设计上就看不到用户明文。
- **同步模型**：op-log（事件溯源），**不是 CRDT**。向量时钟判并发，LWW 加 `clientId` 确定性打破平局。

## 2. 仓库地图

| 路径 | 内容 | 能不能改 |
|---|---|---|
| `packages/sync-core/` | 同步内核（加密、向量时钟、冲突判定）。**vendored 自 Super Productivity，MIT** | ⚠️ 尽量不改，改了要更新 `PROVENANCE.md` |
| `packages/shared-schema/` | 实体清单、schema 版本、HTTP 线协议契约（zod） | ✅ heyta 已改造，是**不可逆层** |
| `packages/storage/` | 存储适配层接口 + 内存实现（`DbAdapter` / `OpLogStore`） | ✅ |
| `server/` | 同步服务端（Fastify + Prisma + PostgreSQL）。**vendored，MIT** | ✅ 已改造 |
| `apps/` | 客户端应用（P1 开始建，当前为空） | ✅ |
| `docs/` | 产品文档。**分层规则见 [`docs/README.md`](docs/README.md)** | ✅ |
| `research/` | 调研原料：上游克隆、原始报告、一次性脚本。**不是产品文档** | ⚠️ 归档性质 |
| `scripts/` | 仓库级脚本（如 P0 验收） | ✅ |

---

## 3. 硬性约束（违反即打回）

### 3.1 可维护性门槛

引入任何第三方组件前，**必须确认它在 2021 年之后仍在持续更新**。否则排除，无论许可证多宽松。

```bash
python3 research/tools/ghinfo.py owner/repo    # 查最后提交/发版时间
```

已因此被排除的例子：`rrule.js`（停在 2023）、`cal-heatmap`（停在 2024）。
**不要因为它们"看起来成熟"就放行** —— 这个门槛是有意的。

### 3.2 许可证

- ✅ **允许**：MIT / Apache-2.0 / BSD / ISC / MPL-2.0 / 0BSD / Unlicense / CC0
- 🔴 **禁止**进入产品代码：**AGPL / GPL / LGPL / BUSL / FSL / Elastic License / SSPL / CC-BY-NC**
- **无 LICENSE 文件 = 无授权 = 一行都不能用**

每个依赖必须**逐项登记**。门禁：

```bash
node research/tools/license-inventory.mjs      # 非零退出 = 有不合格依赖
```

它扫描的是**实际安装的依赖树**，并已通过"注入假 AGPL 包"验证过**能失败**。

> 已知雷区：`@nextcloud/cdav-library` 是 **AGPL-3.0-or-later**，已被上游生产代码引用。
> heyta 的 CalDAV 要么自研，要么换 `tsdav`（MIT）。**不要引入任何 Nextcloud 服务端组件。**

### 3.3 schema 与持久化字段

- **默认不 bump `CURRENT_SCHEMA_VERSION`**。bump 保护不了已发布的客户端、近乎不可逆、且即使安全也不免费。
- 新增语义必须能**在旧客户端上优雅降级**（payload marker / 惰性标记模式）。
- 🔴 **给持久化模型新增"必填"字段会破坏每一个已有安装**：磁盘上的旧数据没有这个字段，会在 hydration 时校验失败。
  **新字段一律写成可选（`?`）并给运行时默认值。** TypeScript 只保护新数据，构建会绿，而每个老安装会静默炸掉。

### 3.4 op-log 纪律（P1 起）

- **一个用户意图 = 一个 op。**
- **被回放/来自远端的 op 不得再次触发副作用。** 否则会出现"同步回来又写一遍"的双向灾难。
- **op-log 是唯一写入口**：UI 不得绕开它直接改状态。详见 [P1 计划](docs/plans/phase-1-single-client-loop.md) 的 D4。
- 多实体变更要**在一次操作里完成**，不要 fan-out 成多个 op。

> 依据：上游 `src/app/op-log/` 那 5 万行是**用真实故障换来的规格书**。改动同步逻辑前先读它，
> 但**移植语义，不要拷贝代码**（它绑定 Angular + NgRx）。

---

## 4. 数据库迁移纪律

**迁移是不可逆层。**

> 📖 **权威规范在 [`server/prisma/migrations/README.md`](server/prisma/migrations/README.md)** ——
> 那是上游用真实故障换来的（一次停摆事故、孤儿 CONCURRENTLY 后端、多副本恢复竞争）。
> **改迁移前先读它**，本节只是摘要与入口，不替代它。

### 🔴 不要用 `prisma migrate deploy` 直接部署

PostgreSQL **禁止在事务块内**执行 `CREATE/DROP INDEX CONCURRENTLY`。
`prisma migrate deploy` 会在含 CONCURRENTLY 的迁移上以 `P3018 / SQLSTATE 25001` 失败。

**必须用项目脚本**，它会把这类迁移拆到事务外逐条执行、标记已应用、再重试：

```bash
cd server && sh scripts/migrate-deploy.sh
```

### 🔴 迁移文件里的 CONCURRENTLY：单语句才行

实测确认的机制：PostgreSQL 的**简单查询协议**中，**多条语句合在一个查询字符串会形成隐式事务**，单条不会。
Prisma 把整个迁移文件当一个查询字符串发送，因此：

| 形状 | 结果 |
|---|---|
| **文件里只有一条** CONCURRENTLY 语句 | ✅ 原生通过，无需恢复 |
| 多条语句（含任何 CONCURRENTLY） | ❌ 隐式事务，报 25001 |

**优先级**（上游规范明确定义）：
1. 表够小就用普通 `CREATE INDEX`，别用 CONCURRENTLY
2. 需要 CONCURRENTLY 就**一个文件一条语句**
3. 必须多条时，用可恢复形状（`DROP INDEX CONCURRENTLY IF EXISTS` + `CREATE INDEX CONCURRENTLY`）

> **裸 `CREATE INDEX CONCURRENTLY`（无配套 DROP）是故意不可恢复的** ——
> 中断的并发建索引会留下 INVALID 索引，宁可直接失败，也不把它标记成已应用。
> 仅用于**正确性关键**的索引；纯性能索引应优先用可恢复形状，让它自愈。

### 🔴 需要 `ACCESS EXCLUSIVE` 锁的 DDL 必须自己限时

```sql
SET LOCAL lock_timeout = '1s';
ALTER INDEX "my_idx" SET (fastupdate = off);
```

**绝不能为了让迁移成功而调大这个超时。** 等锁的 `ACCESS EXCLUSIVE` 请求会把该表上
**所有新查询**排在后面（实测：一个简单读从 79 ms 涨到 8005 ms）。这就是事故形状。

必须**恰好两条语句**，Postgres 才会用隐式事务包住，锁超时才能整体回滚、重试安全。
`'0'` 在 PostgreSQL 里表示**不超时**（永久等待）—— 最危险的取值。

### 🔴 永不修改已应用的迁移

不是因为 `migrate deploy` 会发现 —— **它不会**。（上游实测：把已应用的迁移文件换成
`DROP TABLE`，`migrate deploy` 仍然报 "No pending migrations to apply." 并退出 0。）

改了会：**所有已应用它的安装永远不会执行新 SQL**；记录的 checksum 与文件永久不一致。
**要修就发一个新迁移。**

### 提交前跑校验器

```bash
node scripts/check-migrations.mjs     # 非零退出 = 违反上述规则
```

它检查命名规范、CONCURRENTLY 形状、lock-bounded ALTER INDEX 形状，以及
`migrate-deploy.sh` 解析器的前提（整行注释、语句行尾分号）。
**该检查器已用注入违规文件的方式验证过能失败。**

### macOS 上跑部署脚本

`migrate-deploy.sh` 有一处 GNU-only 的 `sed -i`，macOS 的 BSD sed 会报 `invalid command code`。
用仓库里的垫片：

```bash
export PATH="$PWD/research/tools/macos-sed-shim:$PATH"
```

Linux/Docker 里不需要。

---

## 5. 设计系统（UI 代码必读）

**唯一事实源：[`packages/design-system/src/tokens.css`](packages/design-system/src/tokens.css)。**
规则与理由见 [`design-system/heyta/MASTER.md`](design-system/heyta/MASTER.md)（**不复制取值表**）。

**色系：蓝白。** 主蓝 `#2563EB`，近白底 `#F8FAFC`，冷调石板灰中性色。

### 🔴 三条硬规则

1. **组件禁止裸值** —— 不得出现裸 hex / px / ms / z-index / rgb()。
   用 `cssVar('color.foreground')`（类型安全，拼错编译期报错）。
2. **语义名，不用外观名** —— `--ht-color-danger` 而不是 `--ht-red`。
   组件只消费语义层，原始色阶（`--ht-blue-600`）留给设计系统内部。
3. **要新变量，先加 token** —— 先改 tokens.css 与 `TOKEN_GROUPS`，再消费。
   **加 token 的成本是刻意的**，它逼你想清楚这个值是不是一次性的。

```bash
pnpm check:design     # 非零退出 = 有裸值
```

> 该检查器已用**注入违规文件**验证过能失败（4 类硬编码全部抓到），
> 也验证过合规写法能通过。**不能失败的检查没有价值。**

### 🔴 对比度是测试保证的，不是文档保证的

`pnpm --filter @heyta/design-system test` 会解析 tokens.css、递归展开 `var()`、
按 WCAG 公式**真实计算**每一对前景/背景对比度，不达标就失败。

> **这个测试已经抓到过真问题**：`quadrant-3` 原用 amber-600（`3.19:1`）不达正文标准，
> 已改为 amber-700（`5.02:1`）。写在文档里的"4.5:1"是拦不住的。

### 容易犯的几个错

- ❌ **用 emoji 当图标** —— 跨平台渲染不一致且不受 token 控制。统一用 **Lucide**。
- ❌ **`outline: none`** —— 抹掉焦点环是最常见的可访问性回归。用 `:focus-visible`。
- ❌ **hover 用 `translateY` 位移** —— 扁平风格用**边框**表达层次，阴影只给真正的浮层。
- ❌ **不测暗色主题就交付** —— 暗色不是亮色的反相，必须**实际切换查看**。
- ❌ **数字不加 `.tabular-nums`** —— 番茄钟计时与统计数字的宽度会跳动。

---

## 6. 常用命令

```bash
pnpm install                    # 安装（工作区）
pnpm -r build                   # 全量构建
pnpm -r typecheck               # 全量类型检查
pnpm -r test                    # 全量测试（当前 2104 个通过 + 11 个 Web E2E 默认跳过 + 1 个服务端跳过）

pnpm verify:sync                # P0 验收：真实同步闭环（需要服务端在跑）
pnpm verify:sync:dry            # 不需要服务端，只校验 op 形状
pnpm verify:p1                  # P1 验收：**自带真实服务端**，跑零 mock 的端到端同步（11 条）
pnpm verify:p2                  # P2 验收：**自带真实服务端**，非 Web 壳（Node+SQLite）真实读写+同步

pnpm check                      # 全部门禁：类型 + 迁移 + 许可证 + 文档 + 设计变量
pnpm check:design               # 只跑设计变量硬编码检查
pnpm check:tokens               # 原生 token 产物（Swift/ArkTS/JSON/RN）是否与 tokens.css 同步
pnpm check:arkts                # 用**真 ArkTS 编译器**编译生成的 .ets 产物
```

**提交前至少跑**：`pnpm -r typecheck && pnpm -r test`。

---

## 7. 环境陷阱（实测踩过，会复现）

### 🔴 `DATABASE_URL` 会污染 docker compose

compose 的变量插值**优先读宿主机环境变量，其次才是 `.env`**。当前 shell 里只要有任何 `DATABASE_URL`，
容器拿到的就是它，而不是 compose 里那个带 `connection_limit`/`pool_timeout` 的默认值，启动即崩：

```
ERROR: DATABASE_URL must include exactly one positive connection_limit and pool_timeout value each.
```

排查**看容器实际收到的值**，不要猜：

```bash
docker inspect <容器> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DATABASE_URL
```

规避：`env -u DATABASE_URL docker compose ... up`

### 🔴 `minimumReleaseAge` 必须显式声明

否则构建结果**取决于跑的是哪个 pnpm**：本机可能是 0，容器里原生 pnpm 11 默认 24 小时，
同一份 lockfile 本地过、容器报 `lockfile contains entries that the active policies reject`。
已在 `pnpm-workspace.yaml` 钉死，**不要删那行**。

### 线协议与运行时不对称

1. 服务端**强制 E2EE 且没有开关**：`isPayloadEncrypted` 必须显式 `true`，明文一律 400 `E2EE_REQUIRED`。
2. 线协议 schema **不校验实体成员**，拼错实体名要到上传后才发现 —— 客户端必须先用 `isEntityType()` 自查。
3. 线协议 schema **接受明文载荷**，但服务端无条件拒绝。**客户端无法从契约推出"必须加密"。**
4. **`opType` 词表是 `CRT`/`UPD`/`DEL`**（`sync-core` 的 `OpType`）。**不要自造
   `CREATE`/`UPDATE`/`DELETE`** —— 服务端会逐条 `INVALID_OP_TYPE` 拒绝每一个 op，
   而本地一切正常。词表只有一份，就该只有一份定义。
5. **HTTP 200 也可能是拒绝。** 上传响应里 `results[].accepted` 才是真相，
   字段名是 `opId`（不是 `id`）。只看 `res.ok` 会报"已同步"而数据一条都没上云。
6. **下载的 op 是嵌套的** `{serverSeq, op, receivedAt}`，不是扁平结构。
7. **向量时钟必须包含本次写入自己的递增。** 写成"写入前的时钟"会让每台设备的
   **第一条 op 时钟为空**，对端 `compareVectorClocks` 判 `EQUAL`（"已见过"）→
   **静默丢弃**：本地正常、服务端收到、对端永远看不到，且不报错。
8. **服务端会拒绝并发修改（`CONFLICT_CONCURRENT`），并附 `existingClock`。**
   客户端必须**先下载、再解决、再重传** —— 判定谁更新要用到远端那条 op 的时间戳，
   而下载之前手上根本没有它。把冲突当普通错误重试会**永远解不开**。
   🔴 **冲突策略不要自己发明**：用 `sync-core` 的 `suggestConflictResolution`。
   它对"同实体 UPDATE、时间戳相近、无删除/创建不对称"返回 **`manual`** ——
   **故意拒绝自动选边**。这是对的：自动择一 = 静默丢掉另一个人的编辑。
   计划里的"冲突可判定"指的是**能识别并上报**，不是"自动收敛"。
9. **`recover()` 必须从整个日志重建，不能只看 `pendingApply`。**
   本地 op 在 dispatch 时就标成 `applied`，因此一条都不会进 `pendingApply`。
   只重放它 → **刷新页面后内存状态为空**：磁盘一条没少，界面一条没有。
10. **冲突上报必须结构化，不能只报一句文案。** 只报"需要手动选择"而界面拿不到
    双方内容，等于把一个必然需要人判断的问题做成死路：数据没丢，但谁也没法往下走。
11. 🔴 **`suggestConflictResolution` 要传"真正并发的那几条"，不是实体全部历史。**
    传全史会让"本地有 Create → 本地赢"这条规则命中（创建者那台永远有 Create），
    于是**创建者的编辑永远自动胜出、另一台的编辑被静默丢掉**，
    而且表现为"同步成功"。用 `compareVectorClocks` 筛出 `CONCURRENT` 的那几条。
12. **判定为"本地胜出"之后，原来那条被拒的 op 必须移出上传队列。**
    只重新派发、不丢弃旧 op，那条会永远留在队列里，每次同步都再撞一次冲突 ——
    同步被**永久卡死**，而且看起来像"服务端无缘无故老拒绝我"。
    配合 `resolveConflicts` 里的递归调用就是无限循环。
    **不要写递归重试**：重传仍冲突说明自动判定不成立，那正是该交给用户的情况。
13. 🔴 **限流会掩盖死循环。** `verify:p1` 曾因测试台架撞上限流而随机报 429，
    表面现象是"冲突没被识别" —— 排查方向直接偏到同步协议上。
    把限流去掉之后，同一批用例变成**超时**，才暴露出真正的无限循环。
    所以：**测试服务端不应限流自己的验收套件**（按 IP 计额，全部设备都来自 127.0.0.1）。
    已在 TEST_MODE 下关闭路由级与按用户两层限流。
14. 🔴 **接口漏声明方法，只有强转能救 —— 而强转会让 TS 彻底静音。**
    `DbOpLogStore` 曾用 `as DbTx & {...}` 才能调用 `addToleratingDuplicate`，
    因为它**只存在于 `IndexedDbAdapter` 上，不在 `DbTx` 接口里**。
    任何新适配器按接口老实实现，就会在运行时炸（内存实现第一次跑契约就炸了）。
    **看到 `as SomeInterface & {...}` 就是接口没表达真实需求的信号**，去补接口。
15. **`export const Alias = SomeClass` 不能当类型用。** 类既是值也是类型，
    而 `const` 只提供值。别名必须写 `export { A as B }`。
16. 🔴 **跨实现的行为分歧必须写下来，不能假装一致。**
    `getAllFromIndex` 的返回顺序：IndexedDB 按**索引键**，内存与 SQLite 按**主键**。
    接口上已注明"顺序未定义"，并有测试钉住实际行为。
    **依赖顺序的调用方必须自己 sort** —— 上传顺序靠这个。
17. **测试台架也会撞自己的限流。** 见第 13 条：按 IP 计额，验收套件全部设备都来自
    127.0.0.1，共用额度，用例越多越容易随机变红。TEST_MODE 下已关闭两层限流。
18. **tsup 默认 `removeNodeProtocol: true` 会把 `node:sqlite` 改写成 `sqlite`**，
    而 `sqlite` 不是可解析的内建模块 → `ERR_MODULE_NOT_FOUND`。
    需要 `removeNodeProtocol: false`。（类型检查与源码运行都不会暴露它，只有构建产物会。）
19. 🔴 **墙上时钟不能裁决因果顺序。** reducer 的 LWW 闸门曾**只**比 `op.timestamp`，
    同毫秒时用 `op.id`（随机 UUID）字典序打破平局。但同一台设备连续两次编辑
    经常落在**同一毫秒**里 —— 于是因果上更新的那条有一半概率被静默丢弃。
    实测症状：完成 → 立刻取消完成 → 重开，「取消完成」约 2/3 失效，而 op 日志里
    两条 op 的向量时钟清清楚楚是 `3` → `4`。**它们根本不并发。**
    现在先比向量时钟（`GREATER_THAN` 接受 / `LESS_THAN` 拒绝），只有
    `EQUAL`/`CONCURRENT` 才回退到时间戳 + `op.id`。
    这是 #7 的同一种形状：**拿墙上时钟去表达因果事实**。
20. 🔴 **合法实体被静默丢弃。** `isModeled` 把两件事混为一谈：**未知的未来实体**
    （老客户端该优雅跳过，合理）与**已知且合法但还没实现的实体**（跳过 = 静默丢用户数据）。
    实测：`NOTE` / `TASK_REPEAT_CFG` / `REMINDER` 都是合法实体（`isEntityType()` 为 true），
    `dispatch` 不报错、op 照常入队上传同步，但**没有任何设备物化它们**。
    用户建一条重复任务 → 同步得到处都是、哪儿也不显示、任何一层都不报错。
    「优雅跳过未知实体」这个正确行为**替它掩盖了**。
    现在 `packages/op-log/src/state.ts` 导出 `MODELED_ENTITY_TYPES` /
    `UNMODELED_ENTITY_TYPES`，`entity-coverage` 测试要求每个 `ENTITY_TYPES` 成员
    要么物化、要么**显式登记并写明原因**。实现后不移除登记会红 —— 清单不会腐烂。
21. 🔴 **"不在 PATH 上"不等于"没装"。** 我探测鸿蒙工具链时只查了 `command -v`，
    没查到就写下"本机没有 HarmonyOS 工具链，也没有 ArkTS 编译器"——
    **这是错的**。DevEco Studio 6.1.1.300 就装在 `/Applications/DevEco-Studio.app`，
    SDK 为 API 24，`hdc` / `ohpm` / `hvigorw` / **ArkTS 编译器 `es2abc`** 全在里面：
    `.../ets/build-tools/ets-loader/bin/ark/build-mac/bin/es2abc`
    （Apple Silicon 用 `build-mac`；SDK 根在 `Contents/sdk/default/openharmony`）。
    结论：**探测工具链要查已知安装位置，不能只查 PATH**；随口断言"本机没有 X"
    会让后续所有推理建立在一个假前提上。现在 `pnpm check:arkts` 用真编译器验证 ArkTS 产物。
    ⚠️ 但**不要反向过度声明**：它验证的是**语法/编译**，不是 ArkTS 语义合规 ——
    当前产物只声明常量，没有 `@ohos` 导入或 `Color` 资源类型。
22. 🔴 **RNOH 的 JS 侧和鸿蒙侧是两个包名、两套 registry —— 查错一边会得到 404。**
    - JS 侧走 **npm**：`@react-native-oh/react-native-harmony`（`0.84.4`）
    - 鸿蒙侧走 **ohpm**：`@rnoh/react-native-openharmony`（`0.84.3`）
    我先拿 `@react-native-oh/...` 去问 ohpm，得到 404，差点据此判定"包不存在"。
    两侧实测均为 **MIT**；`ohpm install` 实测 28.9 秒成功（309 MB / 11975 文件，
    含 2509 个 `.h`、2216 个 `.cpp`）。
    另：官方《环境搭建》文档写"仅支持 RN **0.72.5**"，**该文档已过时** ——
    实测两侧都已在 `0.84.x`，`peerDependencies` 要 `react-native@0.84.1`。
    **官方文档里的版本号必须上网核对，不能照抄。**
23. 🔴 **生成器不能依赖它自己要产出的东西。** `@heyta/design-system` 的
    `generate` 原本是 `tsup && node dist/generate-cli.js` —— 而 `tsup` 会构建
    `src/native.ts`，后者 import 的正是这次生成要写的 `src/generated/tokens.native.ts`。
    于是**产物一旦缺失，生成器就跑不起来** —— 而那恰恰是最需要它的时候。
    现在 `generate` 只构建生成器自身（`tsup src/generate-cli.ts`），完整构建是另一条
    `build`。**已实测：先 `rm -rf src/generated`，`pnpm generate` 仍能产出全部 4 个文件。**
    一般规律：**修复工具不能依赖被修复的东西。**
24. 🔴 **二级构建配置不能带 `clean: true`。** 修 #23 时我把 `generate` 改成
    `tsup src/generate-cli.ts` —— 但 tsup 的 `clean` 来自**主配置**且默认为 `true`，
    于是跑一次生成器就把 `dist/` 清空、只留 `generate-cli.js`，
    `@heyta/design-system` 的 `"."` 入口消失，**所有 `cssVar` 导入全部解析失败**。
    更糟的是生成器**看起来是成功的**（产物确实写了），错误要到别处构建才炸 ——
    实测 `apps/web` 因此从 48 掉到 38 且静默变成 2 个 suite 无法加载。
    现在生成器用独立的 `tsup.generate.config.ts`，`clean: false`：
    **生成器只允许新增文件，绝不删别人的。**

> 第 4、7 条的根因相同：**两套并行定义**（词表 / 时钟语义）。
> 这类 bug 单元测试抓不到 —— mock 是按实现者对协议的理解写的，理解错了 mock 跟着错。
> **所以 `pnpm verify:p1` 是不可省的**：真引擎 → 真 IndexedDB → 真 HTTP → 真服务端。

### 🔴 `spawn` 的 ENOENT 可能不是可执行文件的问题

`new URL('..', import.meta.url).pathname` 会把路径里的**空格转义成 `%20`**。
用它当 `cwd` 时目录不存在，而 `spawn` 抛的是
`ENOENT ... spawn /path/to/node` —— 报错指向一个**明明存在**的二进制，完全误导排查方向。
用 `fileURLToPath()`。

同理，`process.execPath` 在某些封装运行时里指向**不能独立 spawn 的垫片**，
而封装的垫片也在 PATH 最前面。脚本要按候选列表解析真 node，别写死 `'node'`。

### vendored 代码的边界

`packages/sync-core/`、`packages/shared-schema/`、`server/` 都源自 Super Productivity（MIT）。
改动它们时：更新对应的 `PROVENANCE.md`，并在 `THIRD_PARTY_LICENSES.md` 里保持登记。
它们的**包级 `package.json` 没有 `license` 字段**（上游也没有），整体靠仓库级 MIT 覆盖 ——
若要独立抽取子包分发，需先补包级声明。

---

## 8. 工作流

1. **改代码前先读相关的 ADR 与计划**：决策不可逆层（`packages/shared-schema`、线协议、迁移）时尤其。
2. **可维护性与许可证先查**，不要先写完再补登记。
3. **测试要能失败**：新增门禁/校验时，先确认它在违规输入下真的会红。**不能失败的检查没有价值。**
4. **不要为了让测试变绿而改测试**。如果是数据/模型的问题，改模型。
5. **提交信息说清"为什么"**，尤其是反直觉的地方（比如为什么用 `"*"` 而不是 `workspace:*`）。
6. 文档按 [`docs/README.md`](docs/README.md) 的分层规则放置，提交前跑死链检查。

### 不要擅自做的事

- 不引入新的第三方依赖，除非先过了可维护性 + 许可证两道门并完成登记
- 不 bump `CURRENT_SCHEMA_VERSION`
- 不改已接受的 ADR 的结论（要变更就新写一份）
- 不修改 `AGENTS.md` / `CONTRIBUTING.md` 的**规则**部分，除非用户在当前任务里明确要求
- 不在 `CURRENT_SCHEMA_VERSION` / 线协议 / 迁移上做"顺手改一下"

---

## 9. 当前进度

| 阶段 | 状态 |
|---|---|
| P0 奠基 | ✅ 已完成（协议已跑通，Docker 实测通过） |
| P1 单端闭环 | ✅ **已完成**（6 条零 mock E2E 全过）→ [详细计划](docs/plans/phase-1-single-client-loop.md) |
| P2 多端补齐 | 🔄 **进行中**（存储契约 ✅ / SQLite ✅ / token 生成器 ✅ / **RN token 产物（含暗色合并 + 类型安全）** ✅ / **ArkTS 产物真编译器验证** ✅ / **RNOH 依赖链实测打通** ✅ / 非 Web 宿主 ✅ / **移动壳 ❌ 尚未创建**）→ [详细计划](docs/plans/phase-2-multi-platform.md) |
| P3 平台特性 | ⏸ |

总路线图：[`docs/plans/roadmap.md`](docs/plans/roadmap.md)

### 已定的关键决策

- **ADR-0001 许可证 = MIT** ✅（[文档](docs/adr/0001-license-decision.md)）。与 vendored 的 MIT 底座天然兼容。
- **ADR-0002 迁移工具 = 继续用 Prisma** ✅（[文档](docs/adr/0002-migration-tooling.md)）。
- **ADR-0004 UI 栈 = React Native** ✅（[文档](docs/adr/0004-ui-stack.md)）。
  跨平台，且是"排除 WebView 套壳后仍覆盖 iOS + 鸿蒙、还在 JS 生态里"的唯一选项。
  🟡 **依赖链已实测打通**（npm + ohpm 两侧包均为 **MIT**、可下载、`ohpm install`
  实测成功），但**尚未构建出 HAP、未跑起来、未编译过 C++**。
  投入 UI 开发前**第一步仍必须是让最小 RN 壳在鸿蒙上真跑起来**。

**当前没有阻塞性决策**，P1 可以持续推进。
