# 迁移工具深挖报告（聚焦三问）

> 状态：**调研报告（非决策）**。本文件只提供证据，结论应由 ADR 落地。
> 日期：2026-09-25 · 检索窗口：所有 URL 于 2026-09-25 实测抓取
> 范围：应上级要求**收窄到三个问题**；原六问中的 Flyway 机制/共存/运行时成本等只保留与本三问直接相关的部分。

## 0. 方法与环境（可复现）

| 事项 | 结果 | 证据 |
|---|---|---|
| `web_search` 工具 | **不可用**，Tavily 返回 `HTTP 432` | 本会话实测：`Error: Tavily API error (HTTP 432)` |
| 代理 `curl -x http://127.0.0.1:7890` | **可用**（github / npm / prisma.io / redgate 均 200） | 实测 `curl -o /dev/null -w "%{http_code}"` 得 200 |
| GitHub **search API** | 可用，但走 `repo:prisma/orm`（旧名 `prisma/prisma` 在 search 下报 422） | 本会话 `curl https://api.github.com/search/issues` |
| GitHub **core API**（单 issue） | **已耗尽**：`API rate limit exceeded for 146.70.117.114`，reset `2026-09-25T08:01:45Z`（抓取时 07:37Z） | 本会话 `https://api.github.com/rate_limit` |
| Bing HTML 搜索 | 可用但**中文/德国区结果污染严重**（查 prisma 返回 prisma.de） | `research/tools/bsearch.py` |
| Node | v22.22.3，需显式 `export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"` | 本会话实测 `node: command not found` → 加 PATH 后 v22.22.3 |

> ⚠️ **仓库事实更正**：任务描述称「32 个迁移」。实测 `server/prisma/migrations/` 下 **32 个条目**，但其中 3 个是文件（`README.md`、`migration_lock.toml`、`migrate-passkey-credentials.ts`），**真实迁移目录为 29 个**。
> 证据：`find server/prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l` → `29`；`ls -1 | wc -l` → `32`。
>
> 🔴 **勘误（2026-09-27 复测）——迁移又长了，本报告里的计数已过时：**
> `find server/prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l` → **33**；
> `ls -1 server/prisma/migrations | wc -l` → **36**。所以上面这段与 §1.6、§5 里所有「29 个」都应按 **33** 读，
> 「32 个条目」按 **36** 读。
> - 同节表格引的 `server/package.json:44,66` 现已移到 **`server/package.json:47,70`**
>   （版本事实未变：`prisma` 与 `@prisma/client` 都仍锁 **5.22.0**）。
> - **结论一条都没变**：`server/scripts/migrate-deploy.sh:6-9` 那条 `P3018 / SQLSTATE 25001` 注释仍在原处，
>   `server/prisma/migrations/README.md` 也仍在。

---

## 1. 第一优先问题：最新 Prisma 是否原生支持「非事务迁移」？

### 1.1 结论

**不支持。** 截至 2026-09-25 的官方文档，**没有任何 per-migration 的事务开关**；Prisma ORM 8 明确写着「一次 migrate run 在 PostgreSQL 上就是一个事务」，因此 `rawSql` **无法**执行 `CREATE INDEX CONCURRENTLY`。

### 1.2 版本事实

| 事实 | 值 | 证据 |
|---|---|---|
| 项目当前使用 | Prisma **5.22.0**（`prisma` 与 `@prisma/client` 均锁 5.22.0） | `server/package.json:44,66` |
| 当前文档默认版本 | **Prisma ORM 8**（"Prisma ORM 8 is here. The docs now default to Prisma ORM 8"） | https://www.prisma.io/docs/orm/migrations/applying-a-migration.md |
| Prisma ORM 7 | 仍完整支持，文档在 `/orm/v7`；官方建议 `prisma@prev` + `@prisma/client@7` | https://www.prisma.io/docs/llms.txt |
| npm `prisma` dist-tag `latest` | **8.0.0-rc.17**（2026-09-24） | `curl https://registry.npmjs.org/-/package/prisma/dist-tags` |
| npm `@prisma/client` dist-tag `latest` | **7.10.0** | `curl https://registry.npmjs.org/-/package/@prisma/client/dist-tags` |
| 最新**稳定**版本（排除 rc/beta/dev） | **7.10.0**（2026-08-25 发布） | `registry.npmjs.org/prisma` 的 `time` 字段 |
| Prisma ORM 8 客户端包 | 迁到 `@prisma/orm-postgres/migration`（8 是 ground-up TS 重写） | https://www.prisma.io/docs/orm/migrations/editing-a-migration.md |

> 注意矛盾点：**文档说 ORM 8 是当前版本，但 npm 上 CLI 的 `latest` 仍指向 `8.0.0-rc.17`（RC）**，`@prisma/client` 的 `latest` 是 `7.10.0`。所以「最新版」要看你指哪个包。**稳定的 ORM 线是 7.10.0；8.0.0 尚为 RC。**

### 1.3 决定性证据（官方文档原文）

Prisma ORM 8 · *Editing a migration*：

> "One limit matters before you write any SQL: **one `npx prisma db migrate` run on PostgreSQL is one transaction**, so `rawSql` cannot run `CREATE INDEX CONCURRENTLY`, or anything else that has to run outside a transaction. For an index, use `this.createIndex`, which is a plain `CREATE INDEX` and blocks writes while it builds."

— https://www.prisma.io/docs/orm/migrations/editing-a-migration.md

Prisma ORM 8 · *Applying a migration*：

> "On PostgreSQL you can do that without any tidying up first, because a failed run leaves no changes in the database at all. **The whole run is one transaction**, so everything the failed run did is rolled back... MongoDB does not give you that clean slate, because a run there is not one transaction."

— https://www.prisma.io/docs/orm/migrations/applying-a-migration.md（「one transaction」在正文出现 2 次）

**解读**：Prisma ORM 8 的替代品是 `this.createIndex` —— 文档自己承认它是 **plain `CREATE INDEX`，建索引期间阻塞写入**。这正是本项目要避免的行为。**没有任何 `executeInTransaction` 之类的逃生口。**

### 1.4 GitHub issue 追踪

| Issue | 标题 | 状态 | 关闭时间 | 证据 |
|---|---|---|---|---|
| **#14456** | Support `CREATE INDEX CONCURRENTLY` (PostgreSQL) | **closed / completed** | **2026-02-12T09:35:34Z** | search API：`{"n":14456,"state":"closed","state_reason":"completed","closed_at":"2026-02-12T09:35:34Z","created_at":"2022-07-22T21:48:11Z","comments":18}` |
| **#22922** | Confusing transaction semantics in Postgres migrations | **open** | — | search API `state:"open"` |
| **#15295** | Migration with transaction fails without good error message | **open** | — | search API `state:"open"` |
| **#8080** | Add an option to add transaction (`BEGIN`/`COMMIT`) around migrations when generating them | **open** | — | search API `state:"open"` |
| #22779 | Migrations with Supabase Supavisor in transaction mode don't work | **open** | — | search API `state:"open"` |
| #8351 | Improve migrate error message to acknowledge that migration may have been in a transaction | closed / completed | 2025-01-23 | search API |
| #7641 | Wrap migrations into a transaction, if possible | closed / completed | 2021-07-08 | search API |

> ⚠️ **重要矛盾，必须诚实标注**：#14456 被维护者标记为 **completed（已完成）**，但**官方文档仍然明说 CONCURRENTLY 不可用**。
> **该 issue 的「关闭理由」我未能核实** —— 见 1.5。
> 结论按**文档**走：**文档是最新的事实源且与"已支持"相反**，因此判定为**不支持**。

### 1.5 未核实项

| 未核实内容 | 原因 |
|---|---|
| #14456 关闭时的**具体理由/关联 PR** | issue 有 18 条评论，GitHub issue 页 HTML 只服务端渲染了前 8 条（issue body + 7 条评论，均为 2022 年内容，无关闭说明）；单 issue core API 已限流至 08:01Z；**未能取得关闭评论** |
| 是否在某个 **7.x 版本**引入过非事务开关 | 未在 7.x 文档、`llms.txt` 索引、release atom 中发现相关条目；`migrate deploy` 文档中 `CONCURRENTLY` 出现 **0** 次 |
| Prisma 8 是否**未来**计划支持 | 未核实（roadmap 未查） |

**旁证**：`#22922`（事务语义困惑）与 `#8080`（请求加事务开关）**仍然 open**，说明社区诉求在最新版本中仍未以配置形式解决。

### 1.6 对本项目的直接含义

- 升级 Prisma（5.22 → 7.10 / 8）**不会解决** CONCURRENTLY 问题。
- 项目现有的 `server/scripts/migrate-deploy.sh` 恢复路径，**在可预见的 Prisma 版本里仍是必需的**。
- Prisma ORM 8 的新迁移系统把迁移改成 **TypeScript 编程式**（`migrations/app/`、`operations` 数组、`rawSql`），与项目现有的 **29 个 `migration.sql` 目录**格式**不同源**，迁移成本另计（未评估）。

**证据（本地）**：
- `server/prisma/migrations/README.md`（上游实测结论：Prisma 5.x 把每个迁移包在事务里）
- `server/scripts/migrate-deploy.sh:6-9`（`P3018 / SQLSTATE 25001` 注释）

---

## 2. 第二优先问题：Flyway Community 的许可证与 `executeInTransaction`

### 2.1 结论

1. **许可证**：Flyway Community = **Apache-2.0**（正好在本仓库 `AGENTS.md §3.2` 的白名单内）。
2. **`executeInTransaction` 属于 Community（免费）**，**不是**付费专属。✅
3. **`undo`（回滚）是付费专属**（Teams/Enterprise）。❌

### 2.2 决定性证据：官方 Script Configuration 页的 **Tier 列**

这是最硬的证据 —— Redgate 官方文档对每个「脚本级配置项」用 **Tier** 列明确标注所属版本：

| 设置项 | Tier（官方原文） | 含义 | 证据 |
|---|---|---|---|
| `shouldExecute` | **Teams** | 是否执行/忽略该迁移 | https://documentation.red-gate.com/flyway/reference/script-configuration |
| `placeholderReplacement` | **Community** | 是否替换 Flyway 占位符 | 同上 |
| **`executeInTransaction`** | **Community** | **是否在事务中执行该迁移** | 同上 |
| `encoding` | **Community** | 该迁移的编码 | 同上 |

> 官方原文（表格逐行）：
> `executeInTransaction  Community  Whether to execute this migration in a transaction.`
> `shouldExecute  Teams  Whether this migration should be executed or ignored.`

**→ `executeInTransaction` 的 Tier 明确写的是 `Community`，即免费版可用。**

### 2.3 交叉验证：`undo` 是付费专属

| 事实 | 证据 |
|---|---|
| `undo` 命令页 Description 首行直接写 **`Flyway Teams`** | https://documentation.red-gate.com/flyway/reference/commands/undo |
| 原文："Description **Flyway Teams** — Undoes the most recently applied versioned migration." | 同上 |
| Enterprise 页面把「Generation of **undo scripts** for quicker recovery」列为 Enterprise 能力 | https://www.red-gate.com/products/flyway/（正文 "Generation of undo scripts for quicker recovery..."） |
| 控制组验证：`undo` 页出现 `Teams` ×2；`executeInTransaction` 页出现 `Teams` ×**0**、`Enterprise` ×**0** | 本会话对两份 HTML 做正则计数 |

> **方法学说明**：我先用 `undo` 页做了**控制组** —— 付费功能页确实会带版本标记。`executeInTransaction` 页的 `Teams`/`Enterprise` 出现次数均为 **0**，与 2.2 的 Tier 列互相印证。

### 2.4 许可证细节

| 项 | 值 | 证据 |
|---|---|---|
| Flyway 仓库 SPDX（`ghinfo.py` 抓取） | `Apache-2.0 (Apache License 2.0)` | `python3 research/tools/ghinfo.py flyway/flyway` |
| README 许可证段落 | "Licensed under the **Apache License, Version 2.0**" | https://raw.githubusercontent.com/flyway/flyway/main/README.md |
| README license badge | `license-Apache License 2.0-blue` | https://github.com/flyway/flyway（README 顶栏） |
| Copyright 主体 | Copyright © Red Gate Software Ltd 2010-2026；Flyway 是 Boxfuse GmbH 的注册商标 | 同上 README |
| 付费版（Teams / Enterprise） | **专有商业许可**；Redgate 未公开 SPDX 标识 | https://www.red-gate.com/products/flyway/ · https://www.red-gate.com/products/flyway/community/（"Flyway Community is the open-source edition"，"Built on Open Source"） |

> 注：`LICENSE` 文件在 `main` 分支根目录 **404**（`raw.githubusercontent.com/flyway/flyway/main/LICENSE` → 404: Not Found）；许可证声明在 **README** 中，非独立 LICENSE 文件。这对 `AGENTS.md §3.2` 的「无 LICENSE 文件 = 无授权」门槛**是一个需要留意但可解释的点** —— GitHub 与 README 均标注 Apache-2.0。

### 2.5 Flyway 自动判定（重要补充）

Flyway **不一定要你手动设** `executeInTransaction`。官方 *Migration transaction handling* 页原文：

> "If Flyway detects that a specific statement cannot be run within a transaction due to technical limitations of your database, it **won't run that migration within a transaction**. Instead, it will be marked as **non-transactional**."

> "For SQL migrations, you can specify the script configuration property **`executeInTransaction`**."

— https://documentation.red-gate.com/flyway/flyway-concepts/migrations/migration-transaction-handling

**对本项目**：这意味着 Flyway 对 `CREATE INDEX CONCURRENTLY` **可能开箱即用**，不依赖付费能力，也无需写恢复脚本。

> 该页**未出现任何版本徽标**；`mixed` / `group` 是全局配置项（链接到 `flyway-group-setting` / `flyway-mixed-setting`），其 Tier **未核实**。

---

## 3. 第三优先问题：Flyway 的状态表与文件命名

| 项 | 值 | 证据 |
|---|---|---|
| **状态表默认名** | **`flyway_schema_history`** | https://documentation.red-gate.com/flyway/reference/configuration/flyway-namespace/flyway-table-setting |
| 表名可配置项 | `table`（CLI `-table=`、配置 `flyway.table`、环境变量 `FLYWAY_TABLE`、API `.table()`、Gradle `table`、Maven `<table>`）；默认 `"flyway_schema_history"` | 同上 |
| 表所在 schema | 单 schema 模式放默认 schema；设了 `defaultSchema`/`schemas` 则放指定 schema | 同上 |
| **文件命名** | `prefixVERSIONseparatorDESCRIPTIONsuffix`，默认即 **`V1.1__My_description.sql`** | https://documentation.red-gate.com/flyway/reference/configuration/flyway-namespace/flyway-sql-migration-prefix-setting |
| 官方示例 | `V001.002__NewTwitterColumn.sql`、`V2__my_script.sql` | https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations · https://documentation.red-gate.com/flyway/reference/script-configuration |
| 版本号格式 | 支持点号或下划线分隔的递增编号；Flyway Desktop 默认用**时间戳**作版本号以避免并发冲突 | https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations |
| **per-script 非事务写法** | 同名 `.conf` 文件，与迁移文件同目录、同文件名 + `.conf` 后缀 | https://documentation.red-gate.com/flyway/reference/script-configuration |

**per-script 非事务的确切语法**（`V2__my_script.sql` 配 `V2__my_script.sql.conf`）：

```properties
# V2__my_script.sql.conf
executeInTransaction = false
```

> 原文："It is possible to configure SQL migrations on a per-script basis. This is achieved by creating a script configuration file in the same folder as the migration. The script configuration file name must match the migration file name, with the `.conf` suffix added... a migration file `V2__my_script.sql` would have a script configuration file `V2__my_script.sql.conf`."
> — https://documentation.red-gate.com/flyway/reference/script-configuration

**其他等价写法**（来自 `executeInTransaction` 设置页，均为**全局**而非 per-script）：

| 方式 | 写法 |
|---|---|
| CLI | `./flyway -executeInTransaction="false" migrate` |
| TOML | `[flyway]` / `executeInTransaction = false` |
| 配置文件 | `flyway.executeInTransaction = false` |
| 环境变量 | `FLYWAY_EXECUTE_IN_TRANSACTION = false` |
| Java API | `Flyway.configure().executeInTransaction(false).load()` |
| Gradle / Maven | **Not available** |

证据：https://documentation.red-gate.com/flyway/reference/configuration/flyway-namespace/flyway-execute-in-transaction-setting

> 该页还注明 "This parameter **does not apply to Native Connectors**."

---

## 4. 与本项目的对接要点（仅保留直接相关的）

| 维度 | Prisma（现状 5.22.0） | Flyway Community |
|---|---|---|
| 事务控制 | **无** per-migration 开关；官方文档明说一次 run = 一个事务 | `executeInTransaction=false`（per-script，**Community**）+ 自动检测非事务语句 |
| CONCURRENTLY | ❌ 报 `P3018 / 25001`，靠 `migrate-deploy.sh` 恢复 | ✅ 官方设计即支持（自动标记 non-transactional） |
| 状态表 | `_prisma_migrations` | `flyway_schema_history` |
| 命名 | 目录 `YYYYMMDDHHMMSS_name/migration.sql` | `V<version>__<desc>.sql` + 可选 `.conf` |
| 回滚 | `migrate resolve`（非真回滚） | `undo` — **付费专属** |
| 运行时 | Node，零额外运行时 | **JVM**（未在本报告核实镜像体积 → 见下） |
| 许可证 | Apache-2.0 | **Apache-2.0**（Community） |

**未核实（本轮收窄后未展开）**：
- Flyway Docker 官方镜像的 base image 与体积 —— **未核实**
- Flyway CLI 是否强制需要 JVM（推断需要，但**未取得官方原文**）—— **未核实**
- 原生/Go 替代品（`golang-migrate` / `dbmate` / `atlas` / `node-pg-migrate` / `graphile-migrate` / `sqitch`）的许可证、非事务支持、维护活跃度 —— **本轮按上级要求略去**（原六问第 5 题）

> 可供后续直接复用的维护性数据（2026-09-25 实测，`ghinfo.py`）：

| 仓库 | 许可证 | 最后提交 | 最新发版 |
|---|---|---|---|
| `flyway/flyway` | Apache-2.0 | 2026-09-24 | Flyway 13.8.0 (2026-09-24) |
| `golang-migrate/migrate` | **NOASSERTION (Other)** ⚠️ | 2026-09-09 | v4.20.1 (2026-09-09) |
| `amacneil/dbmate` | MIT | 2026-09-19 | v2.36.0 (2026-09-19) |
| `ariga/atlas` | Apache-2.0 | 2026-09-20 | v1.3.0 (2026-08-02) |
| `salsita/node-pg-migrate` | MIT | 2026-09-19 | v10.0.0-alpha.2 (2026-08-05) |
| `graphile/migrate` | MIT | 2026-09-08 | v2.0.0-rc.5 (2026-09-08) |
| `sqitchers/sqitch` | MIT | 2026-07-23 | v1.6.1 (2026-01-06) |
| `prisma/orm` | Apache-2.0 | 2026-09-25 | v8.0.0-rc.12-dev.3 |

> ⚠️ `golang-migrate/migrate` 的 SPDX 被 `ghinfo.py` 报为 **NOASSERTION (Other)** —— 按 `AGENTS.md §3.2` 的「逐项登记」要求，若考虑引入**必须先人工确认许可证**。

---

## 5. 三问速答（TL;DR）

| # | 问题 | 答案 | 置信度 |
|---|---|---|---|
| 1 | 最新 Prisma（7.x/8）原生支持非事务迁移？ | **否。** 无 per-migration 事务开关；ORM 8 文档明确「一次 `db migrate` run = 一个事务」，`rawSql` 不能跑 CONCURRENTLY，官方替代 `this.createIndex` 是阻塞式 plain `CREATE INDEX`。#14456 虽被标 completed，但文档未反映，关闭理由**未核实** | **高**（文档直接原文） |
| 2a | Flyway Community 许可证？ | **Apache-2.0**（GitHub + README 双证；根目录无独立 LICENSE 文件） | **高** |
| 2b | `executeInTransaction` 免费可用？ | **是，Community。** 官方 Script Configuration 页 Tier 列逐行标注为 `Community` | **高**（官方 Tier 列） |
| 2c | `undo` 是否付费专属？ | **是，Teams/Enterprise。** undo 命令页首行标 `Flyway Teams` | **高** |
| 3a | Flyway 状态表名？ | **`flyway_schema_history`**（可用 `table` 改） | **高** |
| 3b | Flyway 文件命名？ | **`V<version>__<description>.sql`**，如 `V1.1__My_description.sql` | **高** |

### 未核实清单（诚实标注）

1. **#14456 为何以 "completed" 关闭** —— 18 条评论只抓到前 8 条，core API 限流（08:01Z 重置）。这是本报告**唯一影响结论强度**的缺口：文档说"不支持"，issue 说"已完成"。
2. Flyway 是否**必须** JVM（未见官方原文）—— 未核实。
3. Flyway Docker 官方镜像 base image/体积 —— 未核实。
4. `golang-migrate` 的真实 SPDX（工具报 NOASSERTION）—— 未核实。
5. Flyway `group` / `mixed` 全局配置项的 Tier —— 未核实。
6. Prisma ORM 8 新迁移系统与现有 29 个 `migration.sql` 的迁移成本 —— 未评估。