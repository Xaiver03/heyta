# AGENTS.md

给在本仓库工作的 AI agent 的规则。**这些是约束，不是建议。**

面向人的贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)；文档该放哪见 [`docs/README.md`](docs/README.md)。

---

## 0. 前提

**heyta 还在开发阶段、不可能有用户，所以"会破坏已有安装／老客户端／存量数据"不作为判断依据，但这也**不**等于可以不讲理由 —— 论证仍要指向真问题。**

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
| `packages/storage/` | 存储适配层接口 + **三套实现**（IndexedDB / SQLite / 内存）（`DbAdapter` / `OpLogStore`） | ✅ |
| `packages/op-log/` | op-log 引擎与 reducer（物化状态、向量时钟闸门、墓碑） | ✅ |
| `packages/domain/` | 领域实体与 `EntityModelMap`（哪些实体真的被物化） | ✅ |
| `packages/sync-client/` | 宿主无关的同步编排（上传/下载/冲突上报） | ✅ |
| `packages/design-system/` | 设计变量唯一事实源 + 三端生成器（Swift / ArkTS / RN） | ✅ |
| `packages/i18n/` | **中英词条表**（自研零依赖）。🔴 它是**唯一文案事实源** —— 界面里不许出现硬编码文案，由 `check:ui-language` 拦 | ⚠️ 改词条**必须中英同步** |
| `packages/app-host/` | **宿主无关的应用接线与写入动作**（见下文 §3.5）。含 **AI 工具路径**：`ai-tool-selection.ts`（自然语言→工具，纯规则）+ `ai-tool-run.ts`（读即执行 / 写**只产出提案**，确认才 `submit`） | ✅ |
| `packages/ai/` | **出站 AI**：供给模式 / **出境闸门** / provider 端口 / 配置路由 / 健康熔断。🔴 **只产出建议，类型上产生不了 op**；零厂商 SDK | ✅ 零运行时依赖 |
| `packages/local-api/` | **入站 AI 接口**：本机 API / MCP 的工具契约 + 授权判定 + JSON-RPC 处理器。默认关、只监听回环、逐工具授权；🔴 **不构造 op**。⚠️ 它的**工具目录/授权/执行器与内置 AI 共用**（`isToolGranted` / `runReadTool` / `toWriteIntent`），**不要另建一份**（[ADR-0035](docs/adr/0035-ai-tool-calling-reuses-local-api.md)） | ✅ 零运行时依赖 |
| `server/` | 同步服务端 + **计费**（Fastify + Prisma + PostgreSQL）。**vendored，MIT** | ✅ 已改造 |
| `apps/` | 客户端外壳。**只允许放平台差异与 UI 绑定** | ✅ |
| `apps/web/` | Web 壳（IndexedDB + 浏览器 fetch） | ✅ |
| `apps/landing/` | **落地页**（Vite，独立于应用）。入口由构建期 `VITE_APP_URL` 决定 —— **未配置时整条入口不渲染**（默认构建就是未配置，这是故意的）。别再把 `href` 全是页内锚点当成断点：那取决于构建时给没给这个变量 | ✅ |
| `apps/mobile/` | 移动壳（React Native 0.84.1 + op-sqlite）。**Android 实机跑通；iOS 模拟器已跑通到交互级（真点击 → 真 op 落库 → 真同步到另一台设备，`pnpm verify:mobile-ios`）**。🟡 **鸿蒙：`apps/mobile` 下没有鸿蒙工程**（即"壳未建"）—— 但 `verify:harmony-toolchain` / `-rnoh` / `-rnoh-js` 已把「JS 源码 → unsigned release HAP」的整条构建链在**树外探针**里实测打通，缺的是模拟器系统镜像与签名 → §3.24 | ✅ |
| `apps/node-host/` | 非 Web 验证壳（真 SQLite 文件）。**接线已全部来自 `app-host`** | ✅ |
| `apps/desktop/` | **Electron 壳**（`@heyta/desktop`，17 文件 / 10 MB）。ADR-0024 的原选型，现降级为**过渡壳 + 唯一自动化桌面 GUI 门禁**（`e2e/tests/desktop-window.spec.ts`，经 `check:ai-e2e` 进 `pnpm check`）。🔴 **退役时点已定：等三个原生壳的壳级门禁替换它的断言之后** —— 见 [`docs/plans/multi-end-unified-strategy.md`](docs/plans/multi-end-unified-strategy.md) §6.3-T3 | ⚠️ 待退役 |
| `apps/desktop-macos/` | **macOS 原生壳**（SwiftPM：`HeytaShellCore` + `HeytaMac` + `heyta-smoke`）。**JavaScriptCore + libsqlite3 均为 macOS 自带 ⇒ 零第三方依赖**；加载**同一个** `native-bridge.js`。冒烟 **14/14**，窗口自截屏入库（`evidence/`）。🔴 **界面只有 1 个 `ShellView`、5 条能力**，且是**手写原生 UI** —— 形态按上述方案 §4.3 改为共享 UI | ✅ 可运行 |
| `apps/desktop-linux/` | **Linux 原生壳**（C + GTK4 + `libjavascriptcoregtk-4.1` + `libsqlite3`）。`-Werror` 下 0 警告；冒烟 **12/12**，Xvfb 启动并截图。⚠️ **仍然没有 Linux 桌面用户的证据**（这是当初不做它的原理由，未被推翻）。定位：**同架构但不做专项功能** | ✅ 可运行 |
| `apps/desktop-windows/` | **Windows 原生壳**（WinUI 3 / Windows App SDK，C#）。拆成 `Heyta.Windows.Core`（任意 OS 可构建可测）+ `HeytaWindows`（仅 Windows）。🔴 **实测更正**：界面**已渲染**（`MainWindow.xaml`），MSIX **已打包、已 `Add-AppxPackage` 成功、装上能跑**（`evidence/packaged-first-run.txt`：`ADD_APPX=OK` / `RESULT=OK`）。✅ **`check:macos-shell` / `check:windows-shell` / `check:linux-shell` 已接进 `pnpm check`**（2026-09-29；非本机平台响亮跳过） | ✅ 可运行，有门禁 |
| `docs/` | 产品文档。**分层规则见 [`docs/README.md`](docs/README.md)** | ✅ |
| `research/` | 调研原料：上游克隆、原始报告、一次性脚本。**不是产品文档** | ⚠️ 归档性质 |
| `scripts/` | 仓库级脚本与**门禁**（全部 `check:*` 的实现，以及各 `verify:*` 验收脚本） | ✅ |

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

🔴 **白名单外默认失败。** 不在上面那张表里的许可（例如 `caniuse-lite` 的 `CC-BY-4.0`）
一律算**不合格**，除非在 `research/tools/license-inventory.mjs` 的 `REVIEWED_OTHER`
里**逐项登记它为什么可以接受**。加一条的成本是刻意的 —— 它逼人为这个许可做一次
真正的判断，而不是让它悄悄混进"全部宽松"里。

> **这条以前是坏的，而且坏得很典型**：脚本把"白名单外"（`other`）**只打印、不判定**，
> 打印完 `❔ 其他（需归类）: 1` 之后接着报 `结论：全部依赖均为宽松许可 ✅` 并退出 **0**。
> 也就是说**这一档永远不会失败** —— 而白名单想拦的，恰好就是不在表里的东西。
> 成因是失败判据被**抄了三遍**（`--json` / `--flagged` / 汇总）且三遍都漏了 `other`；
> 漂移就是从"同一个判断写三次"开始的，现在只有一个 `failing` 常量能决定失败与否。
> 已用 4 种注入验证会红，其中一种是"把 `CC-BY-4.0` 的登记拿掉"—— 它证明这条登记是
> **承重的**，而不是"CC-BY-4.0 被全局放行"。

> 已知雷区：`@nextcloud/cdav-library` 是 **AGPL-3.0-or-later**，已被上游生产代码引用。
> heyta 的 CalDAV 要么自研，要么换 `tsdav`（MIT）。**不要引入任何 Nextcloud 服务端组件。**

### 3.3 schema 与持久化字段

- **默认不 bump `CURRENT_SCHEMA_VERSION`**。bump 是近乎单向的栅栏、且即使安全也不免费（要长期养一条迁移链）。
- 新增语义要能用 **payload marker / 惰性标记**向前兼容 —— 理由是**磁盘上和服务端库里已经写进去的数据会长期存在**（我们自己的开发机、测试库、服务器库都算），不是"要救老用户"。
- 🔴 **给持久化模型新增"必填"字段会在 hydration 时炸**：已经落盘的数据里没有这个字段。
  **新字段一律写成可选（`?`）并给运行时默认值。** **TypeScript 只保护新数据，构建会绿，炸在运行时** —— 这才是要防的东西。

### 3.4 op-log 纪律（P1 起）

- **一个用户意图 = 一个 op。**
- **被回放/来自远端的 op 不得再次触发副作用。** 否则会出现"同步回来又写一遍"的双向灾难。
- **op-log 是唯一写入口**：UI 不得绕开它直接改状态。详见 [P1 计划](docs/plans/phase-1-single-client-loop.md) 的 D4。
- 多实体变更要**在一次操作里完成**，不要 fan-out 成多个 op。

> 依据：上游 `src/app/op-log/` 那 5 万行是**用真实故障换来的规格书**。改动同步逻辑前先读它，
> 但**移植语义，不要拷贝代码**（它绑定 Angular + NgRx）。

### 3.5 宿主外壳的边界（`packages/app-host`）

ADR-0003 §2.1 的分界线原来有个说不清的地方：把零件接起来算"业务逻辑"还是"平台外壳"。
结论是**两者都不是** —— 它是每个宿主都要做、且**一模一样**的管道。

所以：**`apps/*` 只允许有一处平台差异** —— 注入哪个 SQLite 驱动。

| 允许出现在 `apps/*` | 必须出现在 `packages/app-host` |
|---|---|
| `driverFactory: () => new NodeSqliteDriver(path)` | `SqliteAdapter` 的 schema 与初始化顺序 |
| 库文件路径 / 库名 | `clientId` 的读取与持久化 |
| UI 组件与平台 API | 同步游标读写、`SyncClientOptions` 的十几个回调 |
| | **任务 op 的构造**（`createTaskActions`） |

判断方法很直接：**这段代码里有没有任何一行在决定"业务上该怎么做"？**
有就是提取得不够。`addTask` 该写哪些字段、软删除发 `DEL` 还是改标志位、
清除字段该写 `null` 还是 `undefined` —— 全是产品语义，**一律不许出现在 `apps/`**。

> 实测代价：抽出来之前，`apps/web` 与 `apps/node-host` 各有一份任务 op 构造，
> 而且**已经漂移了**：`node-host` 用 `crypto.randomUUID()` 生成 entityId 且没有回退，
> 而 `apps/web` 用的是 `Date.now()+counter` 且有回退。移动端（Hermes）没有
> `randomUUID` 时会**在用户点"新建任务"的那一刻抛异常**。

**同形状的第二次，发生在同步接线上。** `SyncClientOptions` 有 12 个回调，
`packages/app-host` 与 `apps/web` 里**各写了一份，逐字相同、连注释都是复制的**；
clientId 的回退逻辑还真的漂移了（`randomId()` vs 自己写的 `Math.random()`）。
clientId 是 LWW 的决胜依据 —— 两份实现 = 两套裁决标准。
现已抽成 `packages/app-host` 的 `createSyncClient()`，并由
`pnpm check:layering` 钉住（4 条规则，已用注入违规验证能失败）。

> 教训：**"抽出了一个共享实现"不等于"重复被消除了"。** `ids.ts` 抽出来了、
> 文件头还专门列了一张漂移对照表 —— 但 `apps/web` 那份**从没被删掉**，
> 表里列着它，它却一直活在代码里。抽取的收尾动作是**删掉旧的那份并加门禁**，
> 不是写一个更好的新版本。

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

#### 🔴 文字层级（2026-09-30 增：排版审计实测"一页八个页标题"）

语义文字样式的唯一规范是 `packages/design-system/src/typography.ts` 的
`TEXT_STYLES`（字号+字重+行高+字距**整条消费**，不许只挑字号）。web 的映射：

| 角色 | 值 | 例 |
|---|---|---|
| 页标题（一屏一个） | xl + semibold（`.ht-header__title`） | 设置 / 收集箱 |
| 区块标题 | **lg + semibold**（= 共享层 `section-title`） | 设置的"功能模块/提醒通知"、任务分组头 |
| 子块/卡片标题 | base + semibold（`.ht-settings__h3`） | 面板里的小节 |
| 正文 | base + regular，行高 `--ht-line-height-normal` | |
| 辅助/说明 | xs 或 sm + muted 色 | 卡片描述、表单注释 |

反例（已修）：设置面板标题曾是 xl + bold —— 与页标题一般大，层级全塌。
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
pnpm -r test                    # 全量测试（当前 2592 个通过 + 12 个跳过：11 浏览器 E2E 默认跳过 + 1 服务端）
                                # ⚠️ 沙箱里跑不了 `@heyta/sync-server`（`prisma generate` EPERM），
                                #    用 `pnpm -r --filter '!@heyta/sync-server' test` 复现这 2592；
                                #    该包本身只贡献 1 个跳过、0 个通过，所以两者可比

pnpm verify:sync                # P0 验收：真实同步闭环（需要服务端在跑）
pnpm verify:sync:dry            # 不需要服务端，只校验 op 形状
pnpm verify:p1                  # P1 验收：**自带真实服务端**，跑零 mock 的端到端同步（11 条）
pnpm verify:p2                  # P2 验收：**自带真实服务端**，非 Web 壳（Node+SQLite）真实读写+同步

# 真浏览器验收（Playwright）。⚠️ 它在 `e2e/` 里，**刻意不在根 pnpm 工作区内**
#   （理由见 `e2e/pnpm-workspace.yaml`，别把它的依赖并回根 lockfile）。
#   依赖要单独装：`cd e2e && pnpm install`（它自己一份 lockfile）
pnpm check:ai-e2e               # 跑整个 e2e 套件（起 vite dev + 假端点，零 mock）
                                #   激励体系的设计契约：e2e/tests/motivation.spec.ts（6 条）

# 移动端验收：真模拟器（emulator-5554）+ 真服务端 + 真笔记本设备（node-host），全部零 mock
pnpm verify:mobile-edit         # 任务可编辑（截止时间/优先级/重命名/删除）
pnpm verify:mobile-conflict     # 冲突解决闭环（真的造出并发冲突，再在界面上解决）
pnpm verify:mobile-autosync     # 🔴 自动同步：**全程不点任何同步按钮**，建一条任务
                                #   也必须自己出去（判据 a：服务端日志出现请求；
                                #   判据 b：另一台设备读到那条任务）。见 §7 第 66 条
pnpm verify:mobile-focus        # 专注（番茄钟）闭环
pnpm verify:mobile-calendar     # 日历（判断的期望值来自宿主机的 Python，不是本仓库的日历代码）
pnpm verify:mobile-repeat       # 重复任务（设规则 → 同步 → 勾选顺延 → 反向再从笔记本完成；六个预设含「每年」，第 15 步专测跨年那一档）

# iOS 验收：真 iPhone 17 Pro 模拟器 + 真服务端 + 真笔记本设备。
# 走 AX 树点击（不依赖窗口 z-order / 焦点，见 §7 第 34 条）
pnpm verify:mobile-ios          # iOS 输入侧全链路：点 FAB → 输入 → 提交 → op 落库 → 同步到另一台设备
                                # **并含「零点击自动同步」**（第 6 步：凭据配好后再写一条，一下都不点）
                                #   §1.0 会先验"无障碍树有没有内容"；为空则**自动重启模拟器**自愈
                                #   （见 §7 第 63 条）。变异复现（验证那条自愈真的会触发）：
                                #   cd scripts && HEYTA_IOS_FORCE_AX_EMPTY=1 bash verify-mobile-ios.sh
pnpm verify:ios-lan-http        # iOS 连**私有 IP 字面量**（自建服务器）的明文 HTTP 可用性
                                #   三个地址单变量对照：错端口 / 错 IP 都失败，真 LAN 地址成功
                                #   ⚠️ 需要 Simulator 窗口在**当前 Space**（见 §7 第 37 条）

# 鸿蒙验收：用 DevEco **自带**的工具链（cmake/ninja/ohpm/hvigorw 都不在 PATH 上）
pnpm verify:harmony-toolchain   # 工具链 → 最小 ArkTS 工程 → 真 HAP（17 项）
pnpm verify:harmony-rnoh        # RNOH 原生侧 → 37MB HAP（含 librnoh_core/app/reactnative.so，17 项）
                                #   ⚠️ 只到"原生编得出包"，JS 侧用桩（见下一条）
pnpm verify:harmony-rnoh-js     # 鸿蒙 JS 侧全链路（零桩）：真 codegen + 真 autolinking
                                #   + Metro/Hermes bundle（验魔数）+ 20MB release HAP（含 hbc）
                                #   ⚠️ 只到"编得出包"：不验运行（缺模拟器镜像+签名）
                                #   需要 Node ≥ 20.12（DevEco 自带的 18 会报 styleText，见 §7 第 59 条）

pnpm check                      # 全部门禁 + **全量单元测试**：类型 + 迁移 + 分层 + 界面文案 + 许可证 + 文档 + 设计变量 + iOS 原生依赖 + `pnpm -r test`
                                # 🔴 末尾的 `pnpm -r test` 是后补的：在此之前 `check` **不跑任何单元测试**，
                                #    于是 `apps/web` 的测试套件红了很久都没有任何东西会失败（原因见下）。
pnpm check:design               # 只跑设计变量硬编码检查
pnpm check:layering             # 只跑分层边界检查（apps/* 不得重新长出业务/接线）
pnpm check:ui-language          # 界面文案必须全是中文（见 §5）
pnpm check:tokens               # 原生 token 产物（Swift/ArkTS/JSON/RN）是否与 tokens.css 同步
pnpm check:arkts                # 用**真 ArkTS 编译器**编译生成的 .ets 产物
pnpm check:native-deps          # iOS 原生依赖对账（package.json ↔ Podfile.lock，见 §7 第 32 条）
```

### 6.1 多端构建

```bash
pnpm -r build                   # 🔴 打包前**必须**先跑：APK/.app 里打的是 packages/*/dist
pnpm build:android              # Android Release APK（Mac 或 Windows 打包机）
pnpm build:android:debug        # Android Debug APK
pnpm build:ios                  # iOS Release（仅 macOS）
pnpm --filter @heyta/mobile run build:android:bundle   # 上架用 AAB
```

### 6.1.1 🔴 固定收尾流程：清旧包 → 重打 → **四端重装**（每轮交付必须）

> 2026-09-30 产品负责人拍板，**纳入固定流程**：heyta 是多端应用，"完成一轮"的定义
> 是"**四个端都装上了当前源码的产物**"，不是"测试绿了"。
> 依据：§7 第 27 条（packages/ 改了、APK 里是旧 JS bundle，验收对旧代码报绿）与
> `verify-mobile-ios.sh` 文件头（脚本只验不装，36 项结论全是旧二进制）——
> **"测试全绿 ≠ 这是当前产物"**。

```bash
pnpm reinstall:all              # 四端全跑：mac / windows / android / ios（默认）
pnpm reinstall:desktop          # 只 mac + windows
pnpm reinstall:mobile           # 只 android + ios
```

实现：`scripts/reinstall-all.sh`。**每一段都是：清掉现有安装包 → 从当前源码重新打包 →
卸旧装新 → 一个"装上的是当前产物且能起来"的判据**：

| 端 | 同步 | 清 | 打包 | 装 | 判据 |
|----|------|----|------|----|------|
| mac | 不需要（本机） | `/tmp/heyta-macos-dist` + `/Applications/Heyta.app` | `package-app.sh`（.app+.dmg+web-dist 进包+自截屏） | 拷进 /Applications（并清壳的 WebKit 存储） | **安装副本**启动自截屏：非空白 **且主蓝命中**（错误屏“非空白”，见 §7 第 82 条） |
| windows | 🔴 **本机工作树 → `C:\src\heyta`，且 sha256 对账** | `dist/windows` | `package-msix.sh`（远端 `windows-pc`，含 Remove+Add Appx） | 远端交互会话 | `ADD_APPX=OK` + `RESULT=OK` + `PAYLOAD_WEBDIST=True` + `M2D=OK`（壳自己的身份菜单判据） |
| android | 不需要（本机） | 旧 APK + `adb uninstall` | `pnpm build:android` | 模拟器全新安装 | install 输出 `Success` + 启动截图非空白且主蓝命中 |
| ios | 不需要（本机） | `simctl uninstall` + 旧 DerivedData | `xcodebuild Release` | `simctl install` | **新鲜度**（已装 main.jsbundle 比源码新）+ 截图非空白且主蓝命中 |

规则：

- **任一端失败 ⇒ 整体退出 1。没有静默跳过** —— `--skip`/`--only` 是显式逃生门，
  且汇总里把没装的端**大字列出**（"这轮没装 Windows"必须一眼可见）。
- 🔴 **"远端的字节 = 本地当前工作树"要有判据**（§7 第 82 条）：Windows 段的
  `sync_windows_sources()` 送的是 `git ls-files` + 未跟踪非忽略 + `apps/web/dist`，
  并用 `apps/web/dist/index.html` 的 sha256 本地/远端对账；**对不上就拒绝打包**。
  这条不是仪式 —— 2026-09-30 实测正是这里装了 Sep 28 的旧树而判据全绿。
- 主机不可达、模拟器没起这类**环境**原因，脚本会如实报因并判红 —— 不硬装、不降级。
- 截图判据复用零依赖的 `png-stats`（非空白/无透明 + mac 端还要**数得出 heyta 主蓝**）；
  iOS 新鲜度判据沿用 `verify-mobile-ios.sh` 那次事故的产物（main.jsbundle mtime ≥ 源码 mtime）。
- 打包脚本自己会做的事（签名/公证/远端 schtasks 安装）**不在本脚本里重写** ——
  它只编排；改打包行为去改各端的 package 脚本。

- **事实源（环境 / 版本 / 产物 / 状态）**：[`docs/reference/build-matrix.md`](docs/reference/build-matrix.md)
- **操作步骤（怎么打、怎么验、坑）**：[`docs/runbooks/multi-platform-build.md`](docs/runbooks/multi-platform-build.md)
- 🔴 **门禁绿 ≠ 能打包。** `pnpm check` 不做平台打包；本仓库已三次踩到"测试全绿但打不出包"
  （§7 第 27、28、31 条）。构建要单独跑、产物要单独验。
- 🔴 **门禁绿 + 打得出包 ≠ 装上了当前产物。** 每轮交付的固定收尾是 §6.1.1 的
  `pnpm reinstall:all`（清旧包 → 重打 → 四端重装，每端有判据）。
- Windows 打包机装机脚本：`scripts/windows/setup-build-host.ps1`（幂等；`-Step verify` 只体检）。
  🔴 该脚本**必须保持纯 ASCII** —— PS 5.1 把无 BOM UTF-8 当 ANSI 读，中文会破坏解析。

**提交前至少跑**：`pnpm -r typecheck && pnpm -r test`。

### 6.2 界面验收：两条**硬性规定**（不是建议）

#### 规定一：Playwright 必须真跑，而且**必须截图 + 人真的看**

任何"界面能用 / 界面画出来了"的结论，**只有截图能作为证据**。
`pnpm check` 绿、元素断言过、元素数量对 —— **都不算**。

```bash
cd e2e && npx playwright test tests/<某个>.spec.ts
# 截图落在 e2e/test-results/ 下，固定文件名，直接打开看
```

写验收时必须做到这四条（后来者不要删）：

1. **先截图，再断言。** 截图在 `try` 之前就落盘，**失败时也要有图** ——
   否则失败只会得到一个 `Test timeout of 60000ms exceeded`，它**不会告诉你
   界面长什么样**。
2. **截图放固定路径**（如 `e2e/test-results/desktop-window.png`），不随测试名变化，
   这样 `pnpm check` 之后可以直接打开同一个文件看。
3. **抓控制台 `console` 与 `pageerror`**，并在断言失败时打印。
   白窗口的根因**几乎只在这里现形**（模块 404、CSP 拦脚本、React 抛错）。
   ⚠️ 监听要在**窗口一创建**就挂上（Electron 用 `app.on('window')`），
   挂晚了收不到加载期错误 —— 输出会显示"控制台无内容"，那是最误导人的结果。
4. **人必须打开那张图看一眼。** 不是"截了就算"，是"看了才算"。

**为什么定成硬性规定 —— 这是当天实测出来的三连击。**
桌面端窗口**全白**，而当时的断言只写了"某个元素可见"。加上截图之后，
**一张图连续抓出三个各自独立、断言都没报出根因的 bug**：

| # | 界面上看到的 | 真实根因 |
|---|---|---|
| 1 | 全白，`launch()` 直接超时 | `app.getAppPath()` 是**入口脚本所在目录**（`dist/`），不是包根 —— 拼出的 `dist/renderer-dist/index.html` 不存在。🔴 **这个 bug 从占位页时期就存在，桌面端从来没显示过东西。** |
| 2 | `宿主不可用：TypeError: Cannot read properties of undefined (reading 'request')` | 同一类错误：`preload` 路径多拼了一层 `dist`。preload 缺失时 Electron **不报错、照常开窗**，只是 `window.heytaDesktop` 是 `undefined`。 |
| 3 | 全白，`#root` 长度为 0 | 少了 `<HeytaUiProvider>`（共享组件**主动抛错**而不是静默降级，这点值得表扬） |

三条里有两条的症状是"白屏"，而**白屏在自动化里最阴的地方是它什么都不报**：
不崩、不 timeout（除了第一条）、日志干净 —— 只是"那个元素没出现"。
只有图能一眼区分"没渲染"和"渲染成了空白"。

#### 规定二：跑验收**不要抢前台**

**任何会开窗口的操作（Electron 冒烟、真浏览器、模拟器）都必须在后台跑，
且不得抢走用户的输入焦点。** 用户可能在同一个界面上做别的事，
每跑一次测试就把人踢出正在做的事，是不可接受的。

- 命令用**后台任务**跑（`run_in_background`），不要卡在前台。
- Electron 窗口必须**不抢焦点**：已有实现见 `apps/desktop/src/main.ts`
  的 `NO_FOCUS`（`focusable: false` + `showInactive()`），
  由环境变量 `HEYTA_DESKTOP_NO_FOCUS=1` 打开，
  GUI 冒烟在 `electron.launch({ env: … })` 里传它。
- ⚠️ 光用 `showInactive()` 在 macOS 上**不够** —— 窗口仍可能因为"可聚焦"
  而被激活。`focusable: false` 才是硬保证。
- 新增任何会弹窗的验收脚本时，照这个模式做，别等用户投诉。
- 🔴 **验证载体的默认顺序（2026-09-29 产品负责人拍板）**：Web UI 的验证
  **默认优先用外接浏览器**（Playwright，无头、不开任何原生窗口）——
  只有"必须看原生壳里长什么样"的判据才起原生壳，且启动必须带
  `HEYTA_NO_FOCUS=1`（macOS 壳已支持；Electron 用 `HEYTA_DESKTOP_NO_FOCUS=1`）。
  2026-09-29 当天壳级验收反复把用户从前台拽走，这条就是那天的产出。

---

## 7. 环境陷阱（索引）

**全部正文在 [`docs/reference/environment-traps.md`](docs/reference/environment-traps.md)** ——
实测踩过、且会复现的坑，编号只增不改；正文里引用写「§7 #N」。
⚠️ 本文件**不写条数**（写过一次"83 条"，六天后就漂了）。要现量：
`grep -cE '^[0-9]+\. ' docs/reference/environment-traps.md`。

| 号段 | 主题 | 代表条目 |
|---|---|---|
| 1–19 | **同步协议与线协议**（两端对不上的一类） | #4 词表两套定义 · #7 时钟没含自己 · #12 冲突 op 卡死队列 · #19 墙上时钟不能裁决因果 |
| 20–29 | **构建产物与打包**（"测试绿 ≠ 产物对"） | #20 合法实体被静默丢弃 · #27 旧 JS bundle 进 APK · #29 相对导入带 `.js` |
| 30–45 | **多端构建与平台工具链**（iOS/鸿蒙/Windows） | #32 pod 装了 ≠ 链接了 · #38 语义样式被默认频率遮住 · #43 `input text` 发不了非 ASCII · #45 管道后 `$?` 是 tail 的 |
| 46–60 | **测试判据与假通过** | #46 没复现 ≠ 路径没执行 · #50 "状态对"在"没生效"时也绿 · #52 服务端读不了密文 · #57 check 不跑测试 |
| 61–79 | **工具链与脚本**（bash 3.2 / vite / Playwright / 远端 PS） | #64 `_VAR` 后跟全角字符 · #71 bundle 魔数 · #77 sed 的 C locale · #79 i18n 改完必须 build |
| 80–83 | **壳与安装包验收**（2026-09-30 新增） | #80 RNW 吞 keydown ⇒ Esc 用捕获 · #81 窗口取证三坑 · #82 错误屏"非空白"假绿 ⇒ 主蓝判据 · #83 探针污染状态 / 原生控件跟系统强调色 |
| 86–90 | **验证与对账脚本的自检盲区**（2026-09-30 – 10-01） | #86 一条判据里藏两个缺陷 · #87 e2e 前置 SIGKILL 别人的 dev server · #88 plumbing 半个文件的索引尾巴 · #90 diff-tree 两参比 A↔B，不是各自对父 |
| 91–160 | ⚠️ **本表历史上漏了这一整段**（条数请现量，本文件不写条数，理由见本节开头：`grep -oE '^[0-9]+\. ' docs/reference/environment-traps.md` 再筛 91–160） | 这一行的用途是**挡"按本表推断这段没内容"** —— 查号请直接读正文。（把这一段补成逐号索引属于 `BLOCKED.md` 的 `B63` 那一档，要连"局部列表要不要并进全局号"一起拍。） |
| 161–164 | **构建期数据与验证载体**（2026-10-03，倒数纪念日批次一） | #161 负数闰月被 `& 0xf` 折成 11 · #162 vitest 绿 ≠ `pnpm -r build` 绿（tsup 的 dts 阶段才查 `noUncheckedIndexedAccess`）· #163 数失败用例必须先 `NO_COLOR=1`，否则红了报 0 条 · #164 后台任务通知的 `exit code 0` 是包装命令的，不是被测命令的 |
| 165–176 | **判据的载体、枚举与同步源**（2026-10-03；#165–#167、#172–#174 由并行那条线追加，本行是收口时补的索引，措辞以条目原文为准） | #165 变异"复跑变回绿"要配对的断言 · #166 邮件正则截断 `&lang=` · #167 改不变量要按"谁引用了输入"枚举 · #168 等负载的 `vm.loadavg` 解析自己坏了 15 轮 · #169 卸载类脚本不许盲选目标（ios 段 `head -1` + `simctl uninstall`） · #170 窗口截图当内容载体会**同时**假红和假绿 · #171 Hermes 字节码里的中文是 UTF-16LE，`grep` 恒 0 · #172 宿主挂 pointermove 的轻拖/重拖分叉 · #173 `--` 原样传进重装脚本的参数位 · #174 只哈希两三个文件的对账证明的就是那两个文件 · #175 哈希命名的产物目录被覆盖式解包 = 只增不减（Windows `web-dist` 实测 26 vs 本地 7） · #176 桩在外面预取值 ⇒ 用例没走到被测判据就返回，"PASS"是假的 |
| 177–196 | **判据与取证装置的第二批**（2026-10-03 晚 – 10-04 00:5x，三条并行线各追加一段，本行是收口时补的索引）。⚠️ 这一段在正文里**物理顺序与编号不同序**：#191–#195 夹在 #177 与 #178 之间，#196 才落在文件末尾 —— 按行号推断"号到几了"会读错，取最大号要 `sort -n`。措辞以条目原文为准 | #178 四端重装的判据回答"装上了、起得来、画的是我们的界面"，**不回答**"装的是不是这一批的产物" · #179 `cmd > log 2>&1` 之后 `echo EXIT=$?` 接在 `tee -a log` 上 ⇒ 那个码是 `tee` 的 · #184 zsh 里 `${PIPESTATUS[0]}` 是**空值**（不是 bash 的数组下标），退出码读成空串比读错更危险 · #191 挂在"文件名枚举"上的门禁，目标文件被删时安静地**不执行**还照样打印通过 · #195 共享层那条"默认值等于原值的可选 prop"会把"宿主没接"伪装成"做完了"，typecheck 与既有门禁全绿 · #196 `.gitignore` 带尾斜杠的 `node_modules/` **只匹配目录**，软链挡不住 ⇒ `ls-files -co` 形状的打包集合会把 21 枚软链当未跟踪送出去 |

三条**元规则**（跨条目通用，先读这个再查号）：

1. **先怀疑探针** —— "没观测到 X" ≠ "X 没发生"；探针坏、探针够不着、探针被顶掉，
   在输出上长得一模一样（#35/#36/#37/#45/#67）。
2. **一条永远通过的判据比没有判据更糟** —— 阈值要从被约束的常量推导，
   并断言"前提确实成立"；能不能失败只靠变异测试回答（#33/#50/#58）。
3. **"测试全绿 ≠ 这是当前产物"** —— 只改 packages/ 时 APK 可能打进旧 bundle（#27）；
   每轮交付的固定收尾是 §6.1.1 的 `pnpm reinstall:all`。

新的条目**追加到 traps 文件末尾**（编号递增），不要写回本文件。

## 8. 工作流

1. **改代码前先读相关的 ADR 与计划**：决策不可逆层（`packages/shared-schema`、线协议、迁移）时尤其。
2. **可维护性与许可证先查**，不要先写完再补登记。
3. **测试要能失败**：新增门禁/校验时，先确认它在违规输入下真的会红。**不能失败的检查没有价值。**
4. **不要为了让测试变绿而改测试**。如果是数据/模型的问题，改模型。
5. **提交信息说清"为什么"**，尤其是反直觉的地方（比如为什么用 `"*"` 而不是 `workspace:*`）。
6. 文档按 [`docs/README.md`](docs/README.md) 的分层规则放置，提交前跑死链检查。
7. **完成范围逐项对账**：Goal 的范围以用户要求和原计划为准。按「设计 / 生产接线 / 失败与恢复 / 平台验收 / 当前产物」分别记证据；基础函数、子 Agent 回报、单包测试或构建成功均不能代替功能闭环。范围扩大后，旧范围的完成证据不能覆盖新增项。
8. **过程经验写回原入口**：可复用约束融入本文件对应规则；具体事故追加到 [环境陷阱](docs/reference/environment-traps.md)，同类事故扩充原条；实现状态写回原计划与 ADR。新增证据文档必须由原计划或文档中心链接，不另建孤立的“记忆”文件。尚未实测的判据明确写“待验证”。
9. **共享资源独占验收**：同一模拟器、同一平台的安装/构建目录、直接改源码的变异运行，必须先协调所有者与运行窗口；不得并行覆盖。安装脚本须核对真实 applicationId 和退出码，安装失败立即停止，不能拿旧包继续验收。参见 §6.1.1 与 [环境陷阱](docs/reference/environment-traps.md) 的 B/C 验收记录。
10. **安全判据不得为测试桩降级**：认证边界不能依赖客户端自报 clientId；持久密钥包须运行时校验，并以原子 CAS 发布版本。测试桩缺接口时补桩，不在生产路径用可选调用或 `typeof` 绕过鉴权。密码学批处理函数全部成功不等于数据库/服务端原子迁移完成。锁定/登出必须使在途解锁与 KDF 结果失效，不能让较早启动的异步操作在锁定后重新安装密钥；恢复码解锁后的必要轮换必须由共享会话阻断写入，不能只靠界面提示。原生安全存储的登出清理必须排在已开始的保存之后；只拒绝较晚返回的保存结果，不能证明原生密钥已删除。
11. **提醒回执与事实分层**：系统接收排程、通知已发布、用户已看到是不同事实；只记录实际可观察的层级。投递回执绑定 occurrence，业务写入成功后才确认回执，失败须可重试。Android 普通进程终止与 force-stop 分别验收，不能承诺平台不支持的强停后投递。
12. **修本地竞态不得破坏回放收敛**：reducer 不能因“当前状态不匹配”永久丢弃本应保留的事件。条件语义优先写成可版本化数据，再按领域规则读取；必须验证乱序、重复、先于 CREATE 到达等情形。提醒回执的实例如环境陷阱 #188。
13. **系统授权完成是独立唤醒信号**：权限弹窗关闭不保证触发 AppState/页面回前台。需要权限的异步副作用必须在授权完成后显式重算，并验证“数据先到 / 授权先到 / 拒绝”三个时序；用户意图落库不得等待或依赖系统授权。提醒实例如 ADR-0051。
14. **共享预算必须与占用变更原子裁决**：普通写入、迁移 staging 等路径若消耗同一配额，必须在同一个数据库锁/事务边界内重新读取全部占用再提交。事务外预检只用于提前报错，不能充当最终门禁；读取预留量失败不得按零处理。并发判据要覆盖不同实例，进程内 mutex 不能替代数据库约束；用可控事务屏障把新占用提交在预检之后，静态先放一条 reservation 只能证明计量，不能证明无竞态。密钥迁移实例如 ADR-0050。
15. **可恢复的加密迁移必须重用同一密文**：随机 nonce 的重加密结果不是可重算的幂等请求。跨进程续传应持久化绑定账号/服务端/请求的密文 journal，不能保存 root、口令、恢复码或明文；commit 响应丢失先查询原请求状态，不能另建迁移。判据必须重建客户端实例后续传，并验证 snapshot/压实边界后的新设备可完整重建。实例如 ADR-0050。
16. **密文验收必须经过实际下载形状**：AAD 中可选字段的省略、空数组与 null 必须使用同一规范表示。迁移后从数据库直接解密通过，只证明存储行自洽；还必须由新设备走真实 HTTP 下载并重建完整状态，尤其是压实后的 full-state 起点。实例如 ADR-0050 的 entityIds 缺口。
17. **新增持久数据须同步原有对外说明**：增加账号关联表、加密存储或恢复路径时，同时核对现有隐私文档的类别、用途、留存和注销范围，中英同步并按原文档规则更新版本；级联数量从迁移最终状态计算，不数 SQL 中的词频。不得为遗漏类别而放宽现有对账测试。


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
| P1 单端闭环 | ✅ **已完成**。**冲突解决闭环已实测跑通**：`pnpm verify:p1` 自带真实服务端跑 11 条零 mock E2E，含"真实点击 `ConflictDialog` → 双端收敛"两条（`keep-local` / `keep-remote` 各一）→ [详细计划](docs/plans/phase-1-single-client-loop.md) |
| P2 多端补齐 | 🔄 **进行中**（**外壳 IA：rail = 任务/日历/四象限/习惯/时间线/搜索 + 回收站 + 头像（设置/统计/退出登录）+ 帮助** —— 功能模块开关（默认关掉番茄钟/成长/便签，关掉的**不进 DOM**）、共享 `CalendarBoard`（web 此前**一个日历都没有**）、共享 `SearchPanel`（便签此前**没有任何搜索入口**）、提醒的**投递路径**（`due` 早算好了但没人读，全仓一个 `new Notification(` 都没有）、实时同步在 web 的接线（`realtime.ts` 450 行 + 自带测试齐全，而**没有任何宿主 `createRealtimeClient()`**）；13 项幻觉复核 **12 项已修 / 1 项外部阻塞** ✅ / 存储契约 ✅ / SQLite ✅ / token 生成器 ✅ / **RN token 产物（含暗色合并 + 类型安全）** ✅ / **ArkTS 产物真编译器验证** ✅ / **RNOH 依赖链实测打通** ✅ / 非 Web 宿主 ✅ / **移动壳（Android 实机跑通）** ✅ / **移动端任务可编辑 + 冲突解决闭环 + 专注闭环 + 日历 + 重复任务（真模拟器零 mock E2E：`pnpm verify:mobile-edit`、`pnpm verify:mobile-conflict`、`pnpm verify:mobile-focus`、`pnpm verify:mobile-calendar`、`pnpm verify:mobile-repeat`、**`pnpm verify:mobile-autosync`（全程不点任何同步按钮，写入也必须自己出去；变异：拿掉写入信号 ⇒ 3 红）**）** ✅ / ✅ **自动同步（前台 + 本地写入去抖）**：此前同步**只能靠手点** —— 建完任务数据一直躺在本地，而界面全绿。核心/平台两层拆分（纯决策逻辑 16 条单测 + 变异验证），三个并发陷阱逐个处理（代际计数防丢写、失败退避防热循环、`ready()` 必须地址与令牌同时具备）；**§7 第 66/67/68 条**，计划 §3.27 ✅ / ✅ **顺手修掉两条陈旧判据**（是自动同步**当场**把它们照出来的）：① `verify-mobile-focus` 的 **delta 基线取晚了**，把"传得更快"读成"没传" —— A/B：关自动同步 26/26、开 25/26，而**同一次运行**又打印笔记本读到了那条记录（**假红**）；② `verify-mobile-edit` **自 i18n 迁移起就是红的**（脚本找「任务标题」，界面词条是「标题」）＋「优先级」区块在首屏之外被当成"没渲染"。修完 **28/28** ✅ / **移动端四个标签全部为真实屏幕**（占位文件已删除）✅ / **iOS 壳已跑通到交互级**（Release 模拟器构建 → 安装 → 启动 → 真图标 + 真中文 + 真 SQLite 建库；`pnpm verify:mobile-ios` **36 项零 mock**，含"点 FAB → 输中文 → 提交 → op 落库 → 同步到另一台设备"全链路，**并含「零点击自动同步」这一条**（第 6 步；变异：关掉 `startAutoSync()` ⇒ **恰好 2 红**，而同一轮里「点按钮」那条仍然绿）；**从"我的页 + 键盘立着"这个曾经判红的初始状态跑起也能全绿**）✅/ ✅ **P0 已修：一条硬被拒的 op 会让设备同步永久卡死**（§7 第 34 条，**ADR-0009**；线级 + 反证 + 真机界面四层验收）/ ✅ **P0 已修：读侧解不开的 op 会让**别的**设备同步永久卡死**（§7 第 41 条，**ADR-0016**；变异验证 + 真服务端复验；配套修掉 legacy 密文在 Hermes 上无纯 JS 兜底）✅ / **清单（PROJECT）跨设备闭环**（`pnpm verify:mobile-lists` 零 mock：手机建清单 → 任务归入 → 笔记本读到**同一条清单、同一个 `projectId`**；业务逻辑复用 `packages/app-host`，未 bump schema）✅ / ✅ **P0 已修：手机"只能推、不能拉"** —— 上传响应搭车回来的 op 里有一条解不开，整次同步就死在 **upload 阶段**，`download()` **从不执行**（界面只显示"同步失败"，本地库远端 op 数 = 0）。（**ADR-0016 §6**，§7 第 46/47 条；变异验证 + 真机复验 + 判据补强：必须**数出**远端 op ≥ 1）✅ / **标签（TAG）跨设备闭环** —— 在此之前 `tagIds` **全仓库没有一处读写**（零件都在、产品里没有这个功能）。`TaskActions.setTags`（整组覆盖、写入侧校验悬空 id）、清单/标签共用 `OrganizerSection`、`pnpm verify:mobile-tags` 零 mock 四层判据（标签实体 + 任务引用 × 手机 + 笔记本）（399 单测 +2 处变异验证）✅ / **Web 端也接上「清单 + 标签」** —— 同一个空洞的另一半：`moveToProject` 在 `apps/web` **零调用点**，于是侧栏里建出来的清单和标签一个都用不上。新增 `TaskOrganizer`（原生控件、chip 常驻 + `<details>` 编辑），浏览器套件 13/13，判据是**刷新后仍在**（变异可复现：只写本地态 ⇒ 2 红）✅ / **三端同步验收 `pnpm verify:multi-end`**（Web ↔ 服务端 ↔ 笔记本，真浏览器 + 真服务端 + 真 SQLite）—— 补上此前**没人覆盖**的那条接缝（手机脚本没有浏览器、浏览器套件刻意离线）。第 3 相开在**全新 context = 空 IndexedDB**（= 一台刚装好的新设备），18/18。顺带查出三个真问题：**自建栈 CORS 默认只放行上游域名**（症状是「离线」而服务端零请求）、**服务端只存密文所以不能按内容断言**、**两设备共用 clientId 会让双方都同步不了**✅ / **鸿蒙：从 JS 源码到自包含 release HAP 的整条构建链已实测打通**（`verify:harmony-toolchain` 17/17、`verify:harmony-rnoh` 17/17、`verify:harmony-rnoh-js` 13/13：真 codegen + 真 autolinking + `hermes_bundle.hbc`（魔数已验）→ **20 MB release HAP**，含全部原生库，双 ABI。**但没跑起来**：缺模拟器系统镜像 + 签名（产物 unsigned）→ §3.24 / §3.25）→ [详细计划](docs/plans/phase-2-multi-platform.md) |
| P3 平台特性 | ⏸ |

总路线图：[`docs/plans/roadmap.md`](docs/plans/roadmap.md)

### 并行轨道：激励与成长体系（✅ **已并入 `main`**）

分支 `feat/motivation-system`（worktree `.worktrees/motivation`）。L1 即时反馈 / L2 连续性 /
L3 叙事三层**已实现**，**并已落到 `main`**（merge commit `84cc7f5`，2026-09-27，
75 文件 / +11008 行）。分支与 worktree **已删除**（相关提交仍是 `main` 的祖先，随时可达）。

📄 落地程序、验证矩阵与回退点在
[激励与成长体系设计](docs/plans/motivation-and-progression.md) **§12**。

同批落地的还有**活动分类与分类着色** —— 成长视图里的分类泳道图 + 周堆叠条，
入口是清单与习惯编辑处的色槽取色器（1–8，**调色板由我们给、含义由用户赋**）。
🔴 核心裁决：**颜色由用户自己赋义，App 永不判断某个活动"健康／不健康"、也永不自动上色**。
分层清单见 [`docs/plans/roadmap.md`](docs/plans/roadmap.md) §1.2。

> ⚠️ 下面这段是**历史记录，不是现状** —— 分支当初确实被挡过，挡它的两件事都已消失：
> 主检出的 200+ 未提交改动由各自的所有者提交并推送；`main` 自己 build / typecheck / test
> 的那批红灯（消费者已提交、生产者在路上）也随同一批提交补齐。**留在这里是为了让后来者
> 认出"分几笔落地"这个形状**，而不是照它行动。

设计红线：**不发行任何货币**（没有金币/积分/商店，也不卖"后悔"）、
**只与自己的过去比**（排行榜/联赛/自习室/组队打 Boss 在 E2EE 下结构上不可能）、
**从不制造愧疚**。关键裁决见下面 ADR-0022 与
[`docs/plans/roadmap.md`](docs/plans/roadmap.md) §1.2。

### 2026-10-03：倒数纪念日 批次二（🔄 **进行中，全在本地分支，未 push 未 merge**）

> 逐项状态与全部读数：[`docs/plans/countdown-anniversary.md`](docs/plans/countdown-anniversary.md) §8.2 / §8.4。
> 分支：`feat/countdown-batch2`（W0/W0b/W2/W5/W10）、`feat/countdown-w9`、
> `feat/countdown-w4b`、`feat/countdown-w7`、`feat/countdown-w8`（后三条由并行子 Agent 在独立 worktree 里跑）。

| 单 | 落到哪一步 | 一条读数 |
|---|---|---|
| W2 `EVENT` 实体 | ✅ | `ENTITY_TYPES` 加一项即穿过整链（**存储三套适配与线协议零改动**），不 bump schema；20/7/17/41/30 passed |
| W10 AI 工具 | ✅ | 目录 4 条 EVENT 工具（读 2 写 2），MCP 与内置 AI **共用同一份目录**；写路径只到提案 |
| W9 提醒 | ✅ web 半 | 「提前 N 天」改走日历日算术 ⇒ DST 不漂；变异 **9 臂 9/9 转红** |
| W9 原生投递 | 🔄 **实施中，真实验收未完成** | 已有 Android/iOS 原生桥与编译证据；共享排程、回执持久化和 occurrence 竞态仍在修正。首轮 Android 验收因包身份/安装失败未形成有效证据，不能据此宣称通知已投递。范围与判据见 [ADR-0051](docs/adr/0051-mobile-reminder-delivery.md) 和 [原计划](docs/plans/goal-multi-end-coverage.md) §4。 |
| W5 卡片网格 | ✅ | e2e **6 passed**（整族 15 passed）、三张图**人看过**；看图照出"逾期卡整行不画日期"并修掉（两腿变异各红一次） |
| W0b 遗留缺口 | 🟡 ①② | `/tmp/ui.xml`/`_xy.py`/库名改成带默认值的旋钮（默认值逐字不变），harness 22 绿 0 红 |
| W7 成品图导出 / W4b 调休通道 / W8 三端接线 | 🔄 并行 | 各自 worktree 在跑；本表**不代它们主张读数** |
| L' 法务联动 | 🟡 判定表已出 | 普查 82 行候选 ⇒ 唯一真命中是 `ai-and-transfer` 的本机接口工具表漏了 W10 那 4 条 EVENT 工具（条款把那张表当授权面）。已修 + 版本 `1.0→1.1`（进同意指纹）+ 新门禁 `check:legal-tools` 四臂变异全红。**还留一条前置闸门**：`permissions.ts` 那句"不申请照片"要等 W7 的 manifest 才知会不会变假 |

🔴 **只剩 W6 一条是被撞车面挡住的**（19:2x 现量）：它的落点 `packages/ui/src/calendar/{CalendarBoard,model,CalendarToolbar,date-text}.ts(x)`、
`apps/web/src/features/calendar/*`、`apps/mobile/src/screens/CalendarScreen.tsx` 在主检出里**逐个都是 `M`**，
正被并行会话整片重写 ⇒ 现在做它 = 造一次没人能干净解的三方冲突。
⚠️ **且 W6 的载体刚刚易主**：W4b 开工实测确认"休/班"的自然位置是共享 `CalendarBoard` 的 `DayCell`，
做法是**给共享组件加一个默认值等于原值的可选 prop**（`dayMarker?`）⇒ **W6 落地时复用那条缝，不要另开一个注入点**。

这一段先前还列过两条，都被**逐文件现量否证**了，留着是为了让后来者认出这个形状：
① **W8** —— 我按"日历线在忙"整条线推断把它排后，实际它的落点在主检出里逐个都干净，web 半还早已随 W5 落地；
② **L 系列** —— 记过一句"`packages/legal` 有 3 个文件脏 ⇒ 只登记不动"，现量是 **6 个**文件脏，
而 L' 命中的那份（`documents/ai-and-transfer.ts`）**恰好不在脏集合里**。
**撞车的判据是同一文件的未提交 diff，不是"某条线在忙"的印象**；脏清单每次都要重新现量 ——
我自己那条"3 个"在六天内就变成了"6 个"。

⚠️ 一条**可迁移的判据教训**（W10 实测）：变异**第一趟 6 臂里 3 臂存活**（写工具默认打开、
列表投影不剥正文、工具改名 ⇒ 清单推不出实体），也就是说那三条承诺当时**没有任何一层在守**。
"做过变异验证"不等于"判据有牙" —— 要逐臂看红集，存活的那几条才是这单真正产出的判据。

⚠️ 另一条（W5 的 e2e 实测，与 §7 第 82 条同族但**不是同一件事**）：**15 条断言全绿的截图里，
逾期那张卡少了一整行日期**。§7 第 82 条讲的是"非空白挡不住错误屏"，这一条讲的是
**断言只会验界面写了什么，不会验界面少了什么** —— 想抓住"少了一行"，判据得写成
**存在性**（每一张卡都有日期行），而不是给"我以为会有的那几行"逐个写内容判据。

⚠️ 第三条（L' 普查实测）：**条款里那种"未列出的即视为未授权"的句子，会把一张表变成授权面**。
此后往代码里的目录加一项，是一个**对外承诺的变更**，而它只体现为一行 `name: 'xxx'` ——
代码评审看不见它，`check:legal-copy` 也看不见（它只比生成物与真源）。
⇒ `check:legal-tools` 现在把 目录 ↔ 中文表 ↔ 英文表 三方对账钉住（含**逐行同序**，
因为集合相等挡不住"行贴错对象"）。**凡是文档里出现"以下即为全部/未列出即不适用"这类封闭句式，
它指的那个集合就必须有一条对账门禁**，否则句式本身就是一个会悄悄烂掉的断言。

### 2026-09-30：服务端面向用户的产物全部中文化 + 用设计系统 + 零渐变 ✅ **已完成**

> 机制全文：[`docs/runbooks/deployment.md`](docs/runbooks/deployment.md) §3.9.2

**起因**：产品负责人点完邮箱验证，看到的是英文的 `Email Verified!` —— 顺手把整片都翻出来看了，
发现三封邮件与三张凭据页**全是英文**，而凭据页还是**深色主题**（`#0f172a` 底 + `#1e293b` 卡片），
跟 heyta 的蓝白亮色系完全不是一套；按钮色还硬编码成 `#3b82f6`（**不是**设计系统的主色 `#2563EB`）。

| 面 | 交付 |
|---|---|
| 三封邮件 | 表格布局 + 内联样式的漂亮模板；**中文默认**；按收件人语言切中英文；纯文本版同样本地化 |
| 三张凭据页 | 改用设计系统的亮色（原来是自己一套深色）；中文默认；`?lang=en` 切英文 |
| 两个页内脚本 | 去掉了写死的英文状态文案（`Preparing...`），改由页面经 `data-*` 下发 |
| 行为修复 ① | 验证失败页**不再回显服务端原始错误**（原来把内部字符串渲染给点过期链接的人看） |
| 行为修复 ② | 魔法登录成功后跳 **`/app/`**（原来跳落地页 —— 而令牌只在应用启动时被消费，用户得再点一次） |

🔴 **真源只有一份，靠"生成物 + 门禁"搬到服务端**（`server/Dockerfile` 不打包 i18n / design-system，
运行时读不到）：色值来自设计系统的 `generated/tokens.json` → `server/src/design.generated.ts`；
文案来自 `packages/i18n` 的词条表 → `server/src/copy.generated.ts`。
两条都有 `--check` 门禁（`check:server-design` / `check:server-copy`，已挂进 `pnpm check`）。
**改词条或改 token 后必须重跑生成**，否则门禁红。
生成脚本用 **TS 的解析器**读词条（正则会变成第二套转义规则）；设计那条**只搬 light**
（`tokens.json` 的 dark 是稀疏覆盖，设计系统自己标注"不适合直接消费"）。

**语言优先级**：`?lang=`（发信时写进链接）> `Accept-Language` > **默认 `zh-CN`**。

**判据**：`server/tests/server-i18n-design.spec.ts` 15 条（新增），全量 server **91 文件 / 1804 passed**。
**三处变异验证**都精确报红：塞一个裸 hex ⇒ 指出 `#123456`；加一句 `linear-gradient` ⇒ 「严禁渐变」红；
让 `resolveLocale` 忽略显式参数 ⇒ 2 条红。
线上复验：三张页面默认中文、`?lang=en` 英文、**`gradient` 出现 0 次**；
并在**部署镜像里**渲染邮件核对 —— 中英正确、`lang` 属性对、含渐变 `false`、
出现的 8 个色值全部是设计 token。

### 2026-09-30：运营管理后台（首版）✅ **已完成**

> 决策：[ADR-0038](docs/adr/0038-admin-console-scope.md)（**抄模式、不抄页面**；为什么不做 RBAC）
> 落地计划：[`docs/plans/admin-console.md`](docs/plans/admin-console.md)（交付清单、判据、已知边界）

起因是产品负责人问「我这个项目是不是需要一个管理后台？SSOS 那个是不是可以直接照抄？」

🔴 **SSOS 的后台抄不了，只能抄骨架。** 它是 42 个页面 / ~12.5k 行前端 + 35 个 Hono 路由
/ ~8k 行后端，覆盖**租户、税务规则、合规知识库、Mailu 邮件中心、发票、信用点** ——
这些领域在 heyta **一个对应数据模型都没有**；后端还是 Hono + Drizzle + 裸 SQL，
要逐条重写成 Fastify + Prisma。两边共享的只有「用户」这一个领域。
真正值得复用的是那五件模式：受保护子树 / 一次 Guard / 每资源一个数据钩子 /
统一分页 / **服务端是唯一裁决者**。

| 面 | 交付 |
|---|---|
| 权限 | `users.is_admin BOOLEAN NOT NULL DEFAULT false`（迁移 `20261003000000_add_admin_flag`）。**没有人生来是管理员**；授权只能由 CLI 做（`pnpm --filter @heyta/server admin:grant <email>`） |
| 后端 | `server/src/admin/{admins,admin.middleware,admin.routes}.ts` —— `/api/admin/*`：概览 / 用户 / 订阅 / 订单 / 优惠码 / 邀请 + **三个不碰钱的动作**（解锁、调配额、强制登出） |
| 闸门 | 插件级 `addHook('preHandler', requireAdmin)` ⇒ **新增路由忘了鉴权是不可能的**。认证与判权在**同一个** hook 里（顺序不可能排错） |
| 客户端 | `packages/app-host/src/admin-client.ts`（宿主无关，AGENTS §3.5）；`apps/web/src/features/admin/` 是界面 |
| 范围外 | 改订阅 / 退款 / 发券 / **自由文本群发通知** —— 最后一条会同时破坏"通知 kind 是封闭词表"与"服务端只存语义+参数、文案归 i18n"两条既有立场 |

**为什么不做 RBAC**：成本不在第一张表，在它带来的全部配套（角色界面、权限码词表、
"谁能改角色"这个自指问题的答案、每个新端点都想一遍挂哪个码），而收益是 **0**（只有一位运营者）。
⚠️ **升级触发条件**：出现第二个需要后台、但不应看到全部数据的人时，换掉 ADR-0038。

**判据**（每条都做过变异验证，清单在 [`admin-console.md`](docs/plans/admin-console.md) §4）：
迁移的 PGlite 证据（把 `DEFAULT false` 改成 `true` ⇒ 2 条红）、
"拒绝撤销最后一个管理员"（拿掉判定 ⇒ 1 条红）、
**遍历全部 10 条路由**的 401/403、"未登录不发请求"（拿掉取令牌短路 ⇒ 2 条红）、
白名单投影（`passwordHash` 一个都不许出现在响应里）。
全量：server 1789 passed、web 987 passed、app-host 739、i18n 10；
`check:design` / `check:ui-language` / `check:migrations` / `docs-link-check` 全绿。

**部署（2026-09-30 已上线）**：迁移 `20261003000000_add_admin_flag` 已应用，
`/api/admin/overview` 无令牌 → **401**，两个容器均 `healthy`。
🔴 **部署完后台是"锁着"的，这是设计**：`is_admin` 默认 false ⇒ 没人有权限，
必须显式授权；而且只能**在容器里**跑（`DATABASE_URL` 的主机名 `postgres` 从宿主机解析不到）：

```bash
ssh ubuntu-jcli 'sudo docker exec supersync-server node dist/scripts/admin.js grant <email>'
```

⚠️ 镜像里是**编译产物** `dist/scripts/admin.js`（生产装依赖带 `--omit=dev`，没有 `ts-node`），
所以在服务器上**不要**用 `pnpm admin:grant`。详见 [`deployment.md`](docs/runbooks/deployment.md) §3.12。

📌 **两个当天踩到并已入档的坑**：
1. **`tar` 打包工作树会把 `server/.env` 带上服务器并覆盖生产配置。** 症状是
   postgres 报 `role "supersync" does not exist` 而数据库完好；真正危险的是
   **`JWT_SECRET` 被换掉**（全部令牌与在途验证链接失效，且重启前不报错）。
   正确写法：`git ls-files -co --exclude-standard -- … | tar czf … -T -`。
   见 [`environment-traps.md`](docs/reference/environment-traps.md)。
2. **`deploy.sh` 会拉起整个 compose 栈（含 `caddy`），而本机 :80 被宿主 nginx 占着。**
   迁移与 `supersync` 都成功，脚本最后卡在 caddy 绑端口失败并以"启动失败"收尾 ——
   **那不是应用故障**，`supersync-server` / `supersync-postgres` 始终 `healthy`。

📌 **教训（已写进测试注释）**：「未登录不发请求」这条规则**住在 `admin-client` 里**，不在 web store 里。
我先把断言记在 store 的一段提前 `return` 上，结果**把那整段删掉测试依然全绿** ——
真正的闸在客户端。判据钉错层的症状是"看起来在保护一件事，其实保护的是另一件"。

### 2026-09-30：后端域名迁到 `heyta.waytofuture.cn` + AI 完整度审计 ✅ **已完成**

> 操作手册：[`docs/runbooks/deployment.md`](docs/runbooks/deployment.md) §3.7.2（迁移全过程与实测表）
> 审计报告：[`docs/research/ai-feature-completeness-audit.md`](docs/research/ai-feature-completeness-audit.md)
> AI 侧的下一步判据：[`docs/runbooks/icp-app-filing.md`](docs/runbooks/icp-app-filing.md) §一

**动因不是运维整洁，是备案倒逼。** 腾讯云 ICP APP 备案（订单 `30179057320250614`）
三个平台填报的服务域名都是 `heyta.waytofuture.cn` —— 本主体**已备案主域 `waytofuture.cn`** 的
子域，避开"域名实名主体不一致"坑；而备案要求**填报的域名真的指向那台已备案服务器**。
所以这次迁移是"让备案填的那个域名真的成为产品入口"。

| 面 | 交付 |
|---|---|
| DNS | `tccli --profile waytofuture dnspod CreateRecord` ⇒ `heyta` A → `124.223.13.226`（RecordId `2421537933`）。⚠️ 本机 `dig` 走代理返回 fake-ip（`198.18.x.x`），**不能用它判断生效**，用 DNSPod API / DoH 核对 |
| nginx | 新站点 `sites-available/heyta.waytofuture.cn` + `sites-enabled` 软链 + `nginx.conf` 显式 `include`（本机 nginx **不**自动加载 `sites-enabled`） |
| 证书 | `certbot --nginx -d heyta.waytofuture.cn` ⇒ 有效至 **2026-12-29**，续期任务已建 |
| 服务端 env | `PUBLIC_URL` / `CORS_ORIGINS` / `DOMAIN` / `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` 五项全改；换容器要带**三个** `-f`（容器 label 记的启动组合） |
| 落地页 / 应用 | `VITE_SITE_URL` + `VITE_APP_URL` 重建；应用本体无域名变量（`site-url.ts` 取自身 origin） |

🔴 **踩到并修掉的一条错误纪律**：`apps/landing/src/site/origin.ts` 原先写着
"换域名时传 `VITE_SITE_URL`，不要改这个常量" —— **这句是错的**。
`check:entries`（`pnpm check` 的**第一道**门禁）会用 `DEFAULT_SITE_ORIGIN` 重新生成入口页
再与**提交物逐字节比对**。所以换域名必须**同时**改常量 + 重跑 `gen:entries`，
否则干净检出上 `pnpm check` 必红。`og-card{,-en}.png` 同理（卡片右下角印的就是这个域名）。

**🔴 代价（与 §3.7.1 逐字相同，不可两边兼容）**：`WEBAUTHN_RP_ID` 只能取一个值 ⇒
旧域名上注册的 passkey 全部失效。JWT 不受影响。`heyta.finlaw.cloud` 站点保留作回滚路径。

**判据**：新增 **线上站点验收** `e2e/playwright.live-site.config.ts` +
`e2e/live-site/live-domain.spec.ts`（3 条，真浏览器 + 真 TLS + 真服务端，**全绿**）。
它把域名用 `--host-resolver-rules` 钉到真实 IP 并加 `--no-proxy-server` ——
否则在这台开发机上验的是**本地代理**，代理一关就变成假绿。
线上实测：canonical 已是新域名、页面**零** `finlaw.cloud` 残留、
`/app?lang=en` → 301 保留查询串、`POST /api/login/passkey/options` 返回
`rpId=heyta.waytofuture.cn`、证书 `CN=heyta.waytofuture.cn`。
`pnpm check:entries` exit 0；`docs-link-check` 无死链。

**顺带抓到的真缺陷（本次迁移之前就坏，不是迁移造成的）**：
PWA 的 `SW_URL = '/sw.js'`（`apps/web/src/pwa/register.ts:23`）与 `gen-pwa.mjs`
生成的 manifest 里 `start_url`/`scope`/`icons[].src` 全是**根绝对路径**，
而应用挂在 `/app/` ⇒ 线上 `/sw.js` 与 `/icons/icon-192.png` 都返回**落地页 HTML**，
SW 注册报 `SecurityError`、**PWA 装出来的入口是落地页**。
⚠️ 以前没发现是因为 `vite preview` / 离线 e2e 都跑在**根路径**。
证据、影响与建议改法见 [`deployment.md`](docs/runbooks/deployment.md) §3.7「还没做的」。
**尚未修** —— 需要先把"挂载路径"变成构建参数（与 `VITE_SITE_URL` 同一条设计）。

### 2026-09-30：身份入口唯一化 + 设置浮层退出口 + Windows 四端重装真缺陷 ✅ **已完成**

> 过程账：[`docs/plans/goal-layout-audit.md`](docs/plans/goal-layout-audit.md) §6–§8

产品负责人两次实测推动了这一轮：①「注册登录那个地方排版还是不对吧？」
②「应该是点击头像出来注册、登录吧？…这个 UX 逻辑根本就不对…再搜索一下还有什么
其他 UX 逻辑跟最佳实践不相符合的」。

| 面 | 交付 |
|---|---|
| 身份入口 | 撤掉头像旁第二个登录 pill；未登录时「登录 / 注册」是头像菜单**第一项**（强调样式）、**不出现**「退出登录」；已登录 = 身份区（邮箱）+ 设置 + 成长 + 退出登录（最底、危险色）。依据：UsabilityGeek《The UX Logout Lapse》+ SaaSUI 账号面模式 |
| 顺带抓到 | 头像菜单**一直被 rail 裁掉右边 16px**（`absolute` + `min-width:12rem` > rail `11rem` + `overflow-y:auto`）；塌缩态更糟（面板整块在视口外）⇒ 改 `fixed` + 实测锚点 + **哪边空间大往哪边弹** |
| UX 审计 | 8 条规则逐面读源码：**修 4**（设置浮层没出口 / 身份动作两个入口 / 同一视图两个名字「统计=成长」且绕过模块开关 / 搜索结果点了没反应）+ **登记 10**（含"便签失败静默吞掉还清空草稿"这条高危，列为下一轮第一件） |
| Windows 端 | 🔴 `reinstall:all` 的 Windows 段装的是 **Sep 28 的旧树 + 无 web-dist 的通道试验页**，而判据全绿 ⇒ 新增源码同步 + **新鲜度对账**（sha256 不一致拒绝打包）、`web-dist` 进包、`app` 模式、`M2D=` 取证，判据变四条 |

**判据**：`signin-entry` 8 条 + `settings-sheet-ia` 4 条 + 真浏览器
`e2e/account-menu.spec.ts` 3 条（**注入验证**：把面板改回 `absolute` ⇒ 「面板右边必须可见」转红）
+ `e2e/settings-exit.spec.ts` 1 条（真键盘 Esc —— jsdom 测不到 RNW 吞 keydown 那条路）。
**完整 `pnpm check` exit 0**：e2e 58 passed、web 977 passed；**macOS 真壳**的 M2 探针
打出新判据（`身份入口成立` + `身份菜单合规`）；Windows 装出来的窗口是**真应用 + 菜单开着**
（`dist/windows/packaged-first-run.png`，人已看）。
📌 教训进 §7 第 82 / 83 条。

### 2026-09-29：通知中心 + 活动（邀请好友得会员）✅ **已完成**

此前**没有通知中心、也没有任何邀请机制** —— 落地页上写"邀请好友送会员"是一句
**无法兑现**的话：没有任何一张表记住谁邀请了谁、发了几天。

| 层 | 交付 |
|---|---|
| 数据 | 三张账号级表 `invite_codes` / `referrals` / `account_notifications`（迁移 `20261002000000`，对既有表**零 ALTER**） |
| 机制 | 注册带 `?invite=` → 被邀请人**验证邮箱** → 邀请人得 **5 天 `hosting`** + 一条通知 |
| 界面 | rail 底部**铃铛**（未读徽标）→ 面板两个 Tab：**通知** / **活动** |

🔴 **本轮最重要的一条不是新功能，是权益判定的修正**：奖励行写进 `subscriptions`
（`provider='invite'`）之后，`findFirst(orderBy id desc)` 的"最新一行说了算"会挑中**后建的奖励行**，
把用户**已付的时长整个盖掉**（付到 20 天后 + 邀请 5 天 ⇒ 只判到 5 天），而两行都合法、
**没有任何一层会报错**。现在改成 `evaluateCapabilityAcross`（**多个来源取并集**）+ `findMany`。
回归钉在 `server/tests/entitlement-across.spec.ts`。

验收：迁移的 5 条手工 CHECK 有 pglite 证据（`activity-schema.pglite.spec.ts` 21 条，
**变异验证**：拿掉"不可自邀"与"payload 必须是对象" ⇒ 4 红）；邀请逻辑 34 条、
路由契约 19 条、权益并集 13 条、读取层与界面各一组（界面组**变异验证**：把活动改成挂载即拉 ⇒ 4 红）；
`e2e/tests/inbox.spec.ts` 真浏览器 2 条 + 截图 4 张（**人已看过**），
且 `smoke` / `motivation` 那 9 条**仍绿**（铃铛刻意不是 `role="tab"`，否则 rail 的 tab 计数会红）。

📄 [`docs/plans/notification-and-activity.md`](docs/plans/notification-and-activity.md)（含 7 条已知边界）

### 2026-09-30：Windows 桌面端旅程 Playwright 验收（真壳的真应用）✅ **已完成**

> 产品负责人指令：「**优先在 Windows 上做那个 Playwright 测试**」（此前是"先从 Mac 端开始"）。
> 矩阵与全部证据：[`docs/plans/user-journey-and-auth.md`](docs/plans/user-journey-and-auth.md) **§9c**

| 面 | 交付 |
|---|---|
| **一条命令** | `pnpm verify:windows-auth` → `scripts/verify-windows-shell-journey.mjs`（10 步，见文件头） |
| **被测对象** | `windows-pc` 上 **WinUI 3 壳的 WebView2 里加载的 `apps/web/dist`** —— Playwright 用 `connectOverCDP()` **附着**，**不启动任何浏览器** |
| **怎么让壳开 CDP** | `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`（**不需要改 C#**）+ `schtasks /IT` 投进交互式桌面会话 |
| **旅程** | W1 注册 → W2 登录（令牌落盘）→ W3 同步上行（**到服务端数 op**）→ W4 新设备恢复 → W5 退出登录 → W6 失败可见。**6/6 通过，exit 0** |
| **截图** | `apps/desktop-windows/evidence/journey/windows-shell-{1..7}-*.png`，**人已看过**（结论写在 §9c） |
| **门禁** | `scripts/check-journey-coverage.mjs` 里 Windows 从「已登记缺口」**转正**为真实入口 |

**这一轮抓到 3 个真缺陷**（都属"界面在说谎"那一类，且 1 个是产品缺陷）：

1. 🔴 **产品缺陷**：登录后打开「同步设置」点保存，会用**空地址**覆盖内存配置 ⇒ 同步当场变
   "还没配置"（磁盘凭据还在，刷新又能好 —— 最难归因的形态）。修：对话框**打开时**从 store 播种
   三个输入框；钉在 `apps/web/tests/sync-settings-prefill.spec.tsx`（去掉播种 ⇒ 3 红，已验证）。
2. 每条登录用例都把**旧凭据快照**重新注入 ⇒ 签名计数器从同一起点重数，服务端要求严格递增
   （`Response counter value 2 was lower than expected 2`）。修：登录后把**已推进过**的快照读回来。
3. 退出登录会把头像菜单收起来，而断言直接去查菜单面板。修：先再点一次头像。

**两条可迁移的判据**（本轮新增，都做过注入验证）：

- 🔴 **身份门**：`connectOverCDP` 之前必须先证明"连的是我们的壳"（`Browser` 以 `Edg/` 开头 +
  UA 含 `Windows NT` + `/json/list` 里有 `https://heyta.local/` 的 page 目标）。
  **本轮真踩过**：探针选了 9223，而本机 Chrome 正好监听在那里（用户自己的浏览器、24 个标签页），
  连上去"一切正常"。指向它跑套件 ⇒ **1ms 内**红。
- 🔴 **"一致性"挡不住"一致地错"**：源码同步的 sha256 对账比的是**本地 vs 远端**，
  而两边曾是**同一份错的产物**（用 `--base=/app/` 打的，引用 `/app/assets/…` 而文件在根下），
  对账照样通过、壳里却整片空白。⇒ 新增**产物自洽**判据（`index.html` 引的本地资源必须都在），
  并且每次**从源码重打** `apps/web/dist`。

⚠️ **边界（别读多）**：壳里真应用的数据落在 **WebView2 自己的 IndexedDB**，**不是壳的 SQLite**
（M2-D 已知边界，仍未做）；跑的是 `dotnet publish` 的自包含 exe **不是 MSIX 打包态**
（打包态环境变量传不进去）；`pnpm verify:web-auth`（Mac/web）仍被 Chromium 拒收 IP 字面量做
WebAuthn RP ID 挡着，**本次没动**。

### 2026-09-27：第一段用户旅程闭环（一批并行工单）

[`docs/plans/roadmap.md`](docs/plans/roadmap.md) §5.1 原先列的三条断点**全部关闭**，外加两条同批的：

1. **落地页 → 应用**：入口由构建期 `VITE_APP_URL` 决定（`apps/landing/src/lib/app-url.ts`）。
   未配置时**整条入口不渲染**；仓库默认构建就是未配置，那是**故意的**。
2. **Web 注册 / 登录入口**：协议语义收进 `packages/app-host/src/hosted-auth.ts`，
   面板开在**同步设置内部**（认证要用的服务端地址就是那里的地址，分开会出现"对着 A 登录、令牌存到 B"）。
   通行密钥的**浏览器端那一步**在 `apps/web/src/features/auth/passkey-browser.ts` ——
   `navigator.credentials` 的平台调用**按设计不在 app-host 里**（否则要引入 `@simplewebauthn`，
   过不了 §3.1–3.2 两道门）。注册与登录两条路都通了。
   验收是两层的：单测 45 条（转换层逐字段钉字节 + store 接线 + **失败不许被当成成功**），
   外加**真浏览器 + 虚拟认证器 13/13**。其中最有价值的两条：
   ① **反证**：把服务端下发的 JSON 原样丢给 `navigator.credentials.create()`，Chromium 会以
   `TypeError: Failed to read the 'publicKey' prope…` 拒掉 —— 证明"JSON ↔ ArrayBuffer"转换层不是多余的；
   ② 把产出的 `clientDataJSON` 解出来，`challenge` 必须**原样回显**（长度对但内容错也会被它抓住）。
   ✅ **找回通行密钥的入口已补**（2026-09-27）：面板上新增
   "丢失了通行密钥？发一封找回链接"（`store.ts` 的 `requestRecovery` → `POST /api/recover/passkey`）。
   🔴 **同时纠正一条这里记错的结论**：上面曾写"三个端点在 app-host 里有函数、没有入口"，
   读起来像整条流程都缺。**恢复本身早就有** —— 是服务端渲染的 `/recover-passkey` 页面 +
   `recover-passkey.js`（线上实测两者都 200）；那一步必须在真实浏览器里调
   `navigator.credentials.create()`，本来就不该在 SPA 里。**缺的只是"触发那封邮件"这一步。**
   教训：**只在 `apps/web` 里搜，就会把服务端渲染的流程误判成"没做"。**
   验收：9 条单测 + 变异验证（按钮 `onClick` 换空操作即转红）。
   🔴 **本条下面那句"仍然没有增删凭据"已经过期（2026-09-28 逐条核过）**：
   新增 / 列出 / 改名 / 删除**全都有** —— 端点在 `packages/app-host/src/hosted-auth.ts`
   （`listPasskeys` / `deletePasskey` / 改名走同一条纪律），UI 是设置页的
   `apps/web/src/features/settings/PasskeyPanel.tsx`（含两段式删除与"最后一条不许删"）。
   留一行原文是为了让人看清它错在哪：**"没有入口"这句话的保质期取决于别人什么时候补上它**，
   所以它旁边必须写核对的日期。判据见 [`docs/plans/roadmap.md`](docs/plans/roadmap.md) §5.1.1 那张表。
3. **导出**：`packages/app-host/src/export-dump.ts`。含**墓碑**与完整 op-log，
   另有可核对的 `counts`（丢掉墓碑的"备份"回放时已删数据会复活）。
   🔴 **范围已过期（2026-09-28 逐条核过）**：原文写"入口在 Web 设置页与 node-host CLI，
   **移动端没有**。**只能导出，不能导回。**"—— 两句都不对了。
   ~~现在的覆盖是：**导出**三端都有；**导入**只有 Web 与 CLI，**移动端没有导入入口**~~
   ⚠️ **这句在 2026-10-03（goal 批五）过期了**：现在的覆盖是**导出与导入三端都有** ——
   导入侧新增移动端「我的 → 导出数据」页里的「从备份还原」卡（选文件或粘贴两条路 →
   `parseExportDocument` 预检并展示 counts → 确认 → `restoreIntoEmptyTarget`），
   与 Web 同一条口径「只支持还原到空库」；设备级判据是 `scripts/verify-mobile-restore.sh`
   （真模拟器 + 真服务端 + 真浏览器导出，零 mock）。那条"导不回来"的诚实条款也随之改写：
   移动端现在能导回来，但**还原回来的数据只在这台设备上**（备份里的 op 带原设备的
   `clientId`，服务端逐条回 `INVALID_CLIENT_ID`，设计上就不上行）—— 界面文案说的是这个。
   覆盖率与判据表见 roadmap §5.1.1。
4. **回收站**：还原 = `UPD { deletedAt: null }`；彻底删除 = 打 `purgedAt` **标记**，
   **不清除 `deletedAt`**（清了会让离线对端把已删数据**复活**）。只有 TASK，不含 PROJECT / TAG。
5. **移动端成长体系**：共享取数在 `packages/app-host/src/motivation.ts`；
   移动端「我的 → 成长」是**第二层页面**，底部仍是 5 个标签。
   🔴 **"没在真机 / 模拟器上验过"已经过期（2026-09-28 逐条核过）**：
   已在 **iOS 模拟器上实跑并截图**（浅色 + 深色两版，深色是 `simctl ui appearance dark`
   真的切过），验收记录在 [`docs/plans/roadmap.md`](docs/plans/roadmap.md) §5.1.1 的断点 6。
   唯一**仍然**没验的是"超长习惯名的换行"—— 当时手机上没有习惯数据（移动端没有建习惯入口），
   只证到代码层。**仍然没上过真机**（需要签名）。

**应用本体的部署**（在此之前它**从来没有被部署过**）：
`https://heyta.finlaw.cloud/app/`。方式与两个必须记住的坑见
[deployment.md §3.7](docs/runbooks/deployment.md)。两个要点：

- 🔴 **`vite build --base=/app/` 不能省** —— 默认 `base` 的资源是根绝对路径，
  挂在 `/app/` 下会去请求落地页的路径、拿回 HTML 而不是样式表，现象是控制台报
  **样式表 MIME 是 `text/html`**。
- 🔴 **测试阶段唯一的域名是 `heyta.finlaw.cloud`**（2026-09-27 从
  `heyta-tmp.litopia.space` 完整迁来，见 deployment §3.7.1）：落地页（`/`）、
  应用（`/app/`）、同步 API（`/api/`）、三张凭据页都在它下面。
  旧域名只保留同步服务端（`/api/`、`/health`、Connect 页）与**入口的 301** ——
  API 端点刻意不做重定向，301 会把 POST 改写成 GET、无声打断正在同步的客户端。

**服务端镜像没有重建**：`server/` 里的品牌改动（SuperSync / Super Productivity → heyta）
**还没上生产**，线上实测仍有 3 次 "Super Productivity"。要走 `server/scripts/deploy.sh`。

### 已定的关键决策

- **ADR-0001 许可证 = MIT** ✅（[文档](docs/adr/0001-license-decision.md)）。与 vendored 的 MIT 底座天然兼容。
- **ADR-0002 迁移工具 = 继续用 Prisma** ✅（[文档](docs/adr/0002-migration-tooling.md)）。
- **ADR-0004 UI 栈 = React Native** ✅（[文档](docs/adr/0004-ui-stack.md)）。
  跨平台，且是"排除 WebView 套壳后仍覆盖 iOS + 鸿蒙、还在 JS 生态里"的唯一选项。
  🟢 **原生侧已实测编译出 HAP**（`pnpm verify:harmony-rnoh`，2026-09-27）：
  NDK 自带的 cmake + ninja 现编了 RNOH 的 C++（`BuildNativeWithNinja` 1 分 2 秒），
  产出 37 MB HAP，含 `librnoh_core.so` / `librnoh_app.so` / `libreactnative.so`（双 ABI）。
  "最可能出问题的地方"（原生侧要本地编译 `.so`）**通了**。
  🟡 **但仍未跑起来** —— 缺模拟器系统镜像 + 签名（产物是 unsigned，装不进设备），
  且 JS 侧 codegen/autolinking 本轮用**桩**顶替。ADR-0004 的结论**暂不需要重估**，
  但最后那一环（真跑起来）仍是它唯一的硬证据。见 §3.24。
- **ADR-0008 向量时钟上限 = 100** ✅（[文档](docs/adr/0008-vector-clock-limit.md)）。
  原值 20 会让设备写入被**永久拒绝**（服务端 head 与客户端各自裁剪、规则不同）。
  ⚠️ **这是把墙挪远、不是拆掉**：因果安全的压缩**未做**，
  存量受害账号能否自愈、warning 在 Hermes 上是否可见 —— 都**未实测**（ADR §5）。
- **ADR-0009 精确重复的 op = 幂等成功** ✅（[文档](docs/adr/0009-duplicate-op-idempotent-success.md)）。
  原先回 `DUPLICATE_OPERATION` 会让一台设备**永久同步不了**（硬拒绝 → 不落"已上传" → 重传整批 → 又硬拒绝）。
  现在回 `accepted: true` + **原 serverSeq**；**`INVALID_OP_ID` 那几条硬拒绝一条没放松**。
  这不是新发明：上游 snapshot 路径早就是这么做的（`sync.routes.snapshot-handler.ts:454-478`）。
- **ADR-0005 / 0006 AI 的数据路径与供给模式** ✅（[0005](docs/adr/0005-ai-data-path.md) / [0006](docs/adr/0006-supply-modes.md)）。
  AI 是**输入法**不是业务规则：只产出建议、**类型上产生不了 op**，写入必须过 `dispatch()` + 用户确认。
  🔴 **托管 AI 与 E2EE 在定义上不能共存** —— 可以提供，但必须是一个明确、可撤销、
  按功能开启的**例外**，**绝不得被描述成端到端加密**。
- **ADR-0010 AI 配置路由** ✅（[文档](docs/adr/0010-ai-config-routing.md)）。
  三道闸（总开关 / 允许远程 / 逐功能出境授权）；🔴 **回退不得跨越隐私边界** ——
  本机端点挂了**不许**悄悄发给云端，用 `fallback-needs-consent` 钉住，且**一次请求都不发**。
  能力**显式声明、不做推断**；URL 校验在保存与发送**两个点**执行。
- **ADR-0011 本机 API / MCP** ✅（[文档](docs/adr/0011-local-api-mcp.md)）。
  默认关（**每个工具单独默认关**）、只监听回环、显式 token、逐工具授权；
  🔴 **加密条目可列举、不可读**；写入只能经 `dispatch()` 形状的端口。
- **ADR-0013 云端 AI 与 MaaS** ✅（[文档](docs/adr/0013-cloud-ai-and-maas.md)）。
  **方向已定**（会提供统一云端 AI 并按此收费，后续 MaaS），但**开放条件未满足**：
  `assertEnableable()` 继续抛 `retention-undecided` 挡住 `managed`。
  ⚠️ 这**不是没写完的占位符，是有意的失败** —— 不许"先把计费做了，保留策略以后再说"。
- **ADR-0014 记忆偏好层的两个闸门** ✅（[文档](docs/adr/0014-memory-switch-and-corrections.md)）。
  `memoryEnabled` **必填且默认关闭（fail-closed）**；推断结果**不持久化**
  （纯函数，每次从 op-log 重算），只有用户**纠正**进 op-log 跨设备同步；
  两个新实体是**纯可加性**的 —— **不需 bump `CURRENT_SCHEMA_VERSION`**。
- **ADR-0022 习惯韧性的「冻结余额」= 纯派生且不上界面** ✅（[文档](docs/adr/0022-resilience-state-stays-derived.md)）。
  它是**库存**不是事实（等于说"你还有 N 次可以不来的机会"）、用户对它**不可操作**、
  且是整套体系里**唯一的货币** —— 唯一一处会让 heyta 读起来像资源管理游戏的地方。
  关键推论：**界面上不出现的东西不需要稳定的持久化结构**，
  于是「派生还是加字段」这个二选一被**消解**（承接 ADR-0014 的"派生不持久化"）。
  🔴 配套纪律：**冻结参数只能放宽、不能收紧** —— 收紧会让重放把历史连续天数
  **变小**，违反"只增不减"；真要收紧走**代码常量切分点**，**仍然不加字段**。
- **ADR-0023 托管 AI 的「300 次/月」本轮不实现** ✅（[文档](docs/adr/0023-managed-ai-quota-not-implemented.md)）。
  它**不**改动 ADR-0020 / ADR-0021 的价格、额度或模型 —— 判定的是**落地顺序**：
  端点 / 计量 / `deepseek` 调用 / 收银台**一个都不存在**，而承诺已写进文案与法务（5 处）。
  🔴 硬约束：**计量存在之前 `hosted-ai-monthly` 不得被售卖**（违反了就是收钱不交付）。
  `pnpm check:ai-quota` 把**唯一数字源**（`docs/reference/pricing-and-entitlements.md` 的
  `ai-quota-ssot` 块）与那 5 处承诺、以及"状态声明 ↔ 实现"绑定起来。
  ⚠️ 这是**有终点的决定**，不是拖延：清空 ADR §5 的最小清单之日，就是它被取代之日。
- **AI 的完整架构**见 [`docs/reference/ai-architecture.md`](docs/reference/ai-architecture.md)
  （模块地图 / 封闭词表 / 全部具名常量 / 20 条不变量清单）。
  **AI 的入口文档是 [`docs/plans/ai-strategy.md`](docs/plans/ai-strategy.md)**，先读那份。

**当前没有阻塞性决策**，P2 可以持续推进；P0 / P1 已交付，AI 轨道的 AI-0 / AI-1 / AI-2 与
本地 API（MCP）也已落地（清单见 [`docs/plans/roadmap.md`](docs/plans/roadmap.md) §1.1）。

**唯一一条"已知会收钱不交付"的红线**在 ADR-0023：`hosted-ai-monthly`（¥12 档）
**计量存在之前不得被售卖**，收银台不许把它变成可支付的订单。

82. 🔴 **“非空白”挡不住错误屏 —— 安装包四轮截图统计全绿，装出来的却是一个报错页。**
    **判 UI 必须有 UI 特征；“人眼复核”四个字印在输出里，不等于人看过。**

    macOS 安装包（`package-app.sh`）**从来没把 `apps/web/dist` 打进 .app** ——
    壳在 bundle 里找不到共享 UI，永远渲染“找不到共享 UI 产物”错误屏。
    而打包自验与重装流程的截图判据都是 `looksBlank`：错误屏**有标题有正文**
    （contentRatio 99.6%），统计上永远“有内容” ⇒ 四轮全绿。
    最后是产品负责人**人眼看窗口**才发现 —— 而脚本输出里明明印着“人眼复核”。

    修了两层，缺一不可：

    1. **产品**：`web-dist` 打进 `Contents/Resources/web-dist`（在签名**之前**拷，
       让 `--deep` 封进签名）。⚠️ 放 bundle 根（`Heyta.app/web-dist`）会被
       `codesign` 拒：“unsealed contents present in the bundle root”（实测）；
       壳的解析也在 `Bundle.main.resourceURL`，两处必须同一个路径。
    2. **判据**：`png-stats` 新增 `countColor` + `HEYTA_BLUE`（`#2563EB`）——
       heyta 的界面必带主蓝（rail 激活项/主按钮/链接），错误屏、空白屏、桌面
       底色**都没有**。A/B 实测：错误屏命中 **0**，真界面几十个。
       ⚠️ 采样密度要 **10 倍于 inspectPng**（20 万点）：主蓝元素小
       （复选框/图标），2 万跳采对真 UI 只命中 4 个，会把真界面误杀。

    📌 两条一般规律：**“非空白”回答的是“有没有东西”，回答不了“是不是这个界面”** ——
    判界面必须有界面特征（品牌色/结构标记）。**测试输出里印着“人眼复核”不构成复核** ——
    §6.2 规定一要求的是真的打开那张图。

80. 🔴 **RN-web 的 `TextInput` 在 keydown 里无条件 `stopPropagation()` —— 冒泡阶段的
    全局快捷键（Esc 关浮层）在焦点落进输入框时**永远收不到事件**。**

    搜索浮层（页6，`apps/web`）的 Esc 关闭挂在 `window` 的**冒泡**监听上；jsdom 单测全绿，
    真浏览器里按 Esc 却毫无反应。实证（往 window/document 各挂一个 keydown 探针）：
    **keyup 能到 window，keydown 到不了** —— 拦截者在 React 委托根上：
    react-native-web `TextInput` 的 `handleKeyDown` 第一行就是
    `e.stopPropagation()`（上游 #612 "Prevent key events bubbling"），
    而面板的输入框是 `autoFocus` —— 焦点恰好总在里面。

    ⚠️ **单元测试抓不到这个**：jsdom 里 `window.dispatchEvent(keydown)` 直接在 window 上起事件，
    根本不走"输入框 → 冒泡 → window"那条被吞的 DOM 路。测试绿 ≠ 真键盘能用 ——
    这是 §6.2 规定一（必须真跑真浏览器）的又一根实锤。

    ✅ 修法：全局键盘监听挂**捕获阶段**（`addEventListener('keydown', fn, true)`）——
    捕获在下传时先于目标处理器触发，RN-web 拦的是冒泡，拦不到捕获。
    代价要想清楚：捕获意味着"将来浮层里若有别的 Escape 消费者（嵌套下拉）"，
    外层会先关 —— 所以它只适合"浮层里没有其它 Esc 面"的场景（搜索面板就是）。

    同族：`ui/text-input` 相关的**组合输入**（IME）事件同样可能被上游吞；
    任何"焦点常驻输入框的浮层 + 全局键盘监听"组合，先探针验证事件真到了 window。

83. 🔴 **探针会改变被测对象的状态；原生控件的默认外观跟着系统设置走。**
    两件事都让安装包验收"看起来红了、其实不是缺陷"（或反过来），都在 2026-09-30 实测：

    1. **M2 探针把应用留在设置页**。壳的验收探针是三段式：首屏 → 点头像验身份菜单 →
       点「设置」验导入面板 —— 验完**就地停在设置视图**。而安装包自截屏在启动 +3s 才跑，
       于是"第一屏"证据永远是设置 sheet，四轮截图全是对着设置页打分。
       ✅ 修法：验完**点回「任务」**（`backToTasksProbe`），把首屏还给截图；
       状态还原是验收流程的一部分，不是可选项。
       📌 一般规律：**探针是被测系统的一段真实用户操作，它留下的状态就是后续判据的输入**。
    2. **原生复选框的选中色 = macOS 系统强调色**。模块开关是裸 `<input type=checkbox>`，
       没写 `accent-color`。Chrome 恰好渲染成蓝色（看起来"正好是品牌色"，纯属巧合），
       WebKit 跟随系统设置 —— 这台机器的强调色是石墨灰 ⇒ 装出来的包里**所有勾选框
       都是灰的**，主蓝命中 0。✅ 修法：`input[type="checkbox"], input[type="radio"]
       { accent-color: var(--ht-color-primary); }`。
       📌 一般规律：**凡是没显式声明样式的东西，都在替用户的系统设置说话**；
       品牌控件不能依赖"默认值恰好像我们的品牌色"。

81. 🔴 **窗口取证工具链的三个静默坑（`window-id.swift` / `screencapture -l`）——
    每一个的症状都是"交叉验证被跳过"或"尺寸比对必红"，没有一个是它自己。**

    `check:macos-window` 的交叉验证链：`swift window-id.swift` 拿窗口号 →
    `screencapture -l<id>` 独立截一份 → 与应用自截图比尺寸。三个坑都在第一环：

    1. **`.optionOnScreenOnly` 看不见后台实例**。交叉验证的壳带 `HEYTA_NO_FOCUS=1`
       后台启动，它的窗口不在"当前屏幕可见"集合里 ⇒ 脚本输出空 ⇒
       `CROSSCHECK=skipped` ⇒ 门禁红。修成 `.optionAll`（AGENTS §7 第 37 条
       同一个坑的第四种面目：AX / OnScreenOnly 都只看得见"当前 Space / 当前屏"）。
    2. **`.optionAll` 之后 `head -1` 会拿到辅助窗口**。进程里除了主窗口还有
       500x500、**无标题**的辅助窗口（SwiftUI 常驻）；对它跑 `screencapture -l`
       得到 **1000x1000 的占位图** —— 尺寸比对必红，而占位图"看起来是张图"。
       修成只认**标题 = "heyta"** 的主窗口（`kCGWindowName`）。
    3. **僵尸实例会污染窗口清单**。连跑几轮门禁后 pkill 没杀干净的旧实例
       会留下同名同尺寸的窗口 —— 选窗时"任何一个 heyta 主窗口"都可接受
       （尺寸比对只关心尺寸），但**排查时先 `ps` 确认没有僵尸**，否则你以为
       在验新实例，实际比的是旧的。

    📌 **判据**：交叉验证链上任何一环"取不到"都必须**响亮地失败**
    （`CROSSCHECK=skipped` 就该红），绝不能静默跳过 —— 静默跳过等于
    "自截图永远不用被独立验证"，那这条交叉验证就只是装饰。

82. 🔴 **"重新装了一遍"不等于"装上了当前源码" —— 多端流程的每一端都要有一条
    `远端字节 == 本地工作树` 的判据。**

    2026-09-30 实测：`pnpm reinstall:all` 的 Windows 段报 ✅，而它装的是

    | 事实 | 证据 |
    |---|---|
    | `C:\src\heyta` 是 **Sep 28** 的旧树 | `MainWindow.xaml.cs` 2384 B（本地 3086 B）、`apps/web/dist/index.html` 是 Sep 27 |
    | 包里**没有** `web-dist`（共享 UI） | `package-msix.ps1` 里 `web-dist` 0 处；而壳只从 exe 旁边找它 |
    | 于是跑的是 `shell` 模式的通道试验页 | `dist/windows/packaged-first-run.png` 里是三行「M2-B 真数据 1/2/3」 |

    而判据只有 `ADD_APPX=OK` + `RESULT=OK`（装上、开窗、截图非空白）—— **全绿**。
    这与第 27 条（APK 里是旧 JS bundle）、`verify-mobile-ios.sh`（脚本只验不装）
    是**同一个错的第三种面目**：流程里缺了"同步"这一步，而缺了它的表现
    与"一切正常"**完全一样**。

    ✅ 修法：`reinstall-all.sh` 新增 `sync_windows_sources()` ——
    `git ls-files` + 未跟踪非忽略 + 显式 `apps/web/dist` 打 tar（实测 11 MB）
    → scp → **覆盖式**解包（不删远端 node_modules）→ **新鲜度对账**
    （`web-dist/index.html` 的 sha256 本地/远端必须逐字相同，不一致**拒绝打包**）；
    打包脚本新增 `web-dist` 断言（缺了直接 `RESULT=WEB_DIST_MISSING` 退出）；
    应用默认模式改成"有 web-dist 就是 `app`"。

    📌 **可迁移的判据**：任何"送到另一台机器上构建/运行"的流程，
    收尾必须有一次**内容对账**（哈希/尺寸），而不是只看"命令退出码 0"。

83. 🔴 **给 MSIX 打包的两个附加约束**（第 82 条同一轮）：`package-msix.ps1` /
    `install-and-capture.ps1` **必须保持纯 ASCII**（脚本自己会 grep 非 ASCII 并退 1
    —— 2026-09-30 我加注释时写了中文，正是它拦下来的；PS 5.1 会把无 BOM UTF-8
    当 ANSI 读，中文注释能拆坏字符串常量）。而**应用写出的证据文件可以是 UTF-8 中文**，
    门禁只读里面那一行 ASCII 判据（`M2D=OK` / `M2D=FAIL`）—— 人的说明与机器的判据
    分两个通道，不要把中文塞进 ASCII 证据文件（`Set-Content -Encoding ASCII` 会毁掉它）。
