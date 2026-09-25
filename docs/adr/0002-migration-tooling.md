# ADR-0002：数据库迁移方案 —— 继续用 Prisma，不引入 Flyway

> 状态：**已接受**
> 日期：2026-09-25
> 修订：**2026-09-25** —— 外部调研返回后改正了 §2/§3 的论证（见 §2「证据更新说明」），结论不变
> 取代：无

## 1. 背景与约束

问题：**heyta 的数据库迁移该用什么工具？** 有声音提出用 Flyway（Java 生态的成熟迁移工具）。

先把约束钉死，因为结论完全由它们推导：

| # | 约束 | 来源 |
|---|---|---|
| C1 | 已有 **29 个 Prisma 迁移**在生产路径上跑通（含 9 个 CONCURRENTLY） | `server/prisma/migrations/`，Docker 实测 |
| C2 | **Prisma Client 是 ORM**，`schema.prisma` 是客户端类型的唯一事实源 | 服务端全部数据访问都走 `@prisma/client` |
| C3 | 部署镜像是 **Node Alpine**（469 MB）。加 JVM 是真实成本 | `server/Dockerfile` |
| C4 | 迁移里有 9 个 `CONCURRENTLY`，需要**事务外执行** | PostgreSQL 禁止在事务块内 CONCURRENTLY |
| C5 | 已存在一份 1111 行的迁移恢复脚本，处理过真实事故 | `server/scripts/migrate-deploy.sh` |
| C6 | 已存在一份 204 行的迁移规范，记录真实故障与取舍 | `server/prisma/migrations/README.md` |
| C7 | 可维护性门槛：组件必须 2021 年后仍在更新 | `AGENTS.md` §3.1 |
| C8 | **`server/` 是 super-sync-server 的 fork**，上游持续维护这些迁移与恢复脚本 | `PROVENANCE.md`；与上游逐字节相同的 README |

> **C5/C6 的分量最重，且是我在调研前没意识到的。** `migrate-deploy.sh` 不是"一个绕过 Prisma 限制的临时脚本"，
> 它包含：专用 advisory lock（key `72707370`，区别于 Prisma 自己的 `72707369`）、
> 孤儿 CONCURRENTLY 后端的识别与终止、lock-bounded 重试上限、失败回滚后可安全重跑的不变量。
> README 里记着一次**真实停摆**：等锁的 `ACCESS EXCLUSIVE` 请求把该表上所有新查询排队，实测一个简单读从 **79 ms 涨到 8005 ms**。

## 2. 选项

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. 继续用 Prisma**（保留恢复脚本） | 零迁移成本；C5/C6 的事故知识全部保留；单一事实源（`schema.prisma`）；镜像不加 JVM；**与 fork 上游保持同构**（C8） | 需要自己的恢复脚本处理 CONCURRENTLY；Prisma 至今无原生非事务迁移 | §1、§5 |
| **B. 换成 Flyway** | **已核实**：Apache-2.0（过 C7 许可门槛）；**`executeInTransaction` 属 Community 免费**；官方称会**自动检测**非事务语句，CONCURRENTLY 可能开箱即用；SQL 迁移更"标准" | 要 baseline 29 个已有迁移；**产生双事实源**（`schema.prisma` vs SQL），使 Prisma 自带漂移检测失效；Node 镜像加 JVM；**与 fork 上游分道**（C8），每个上游迁移都要手工转换；`undo` 付费（与 A 同为无回滚） | §5（已核实项） |
| **C. 换轻量迁移器**（`node-pg-migrate` / `dbmate` / `golang-migrate` / Atlas） | 无 JVM；原生非事务 | 同样要 baseline + 双事实源；且每个都要单独过 C7 门槛 | 未逐一核实（见 §5） |

### 证据更新说明（2026-09-25 调研返回后）

本节初稿把 B 的优点写成"未核实"，并据此弱化了它。**调研回来后，两项关键事实被证实、且都有利于 B**：
Flyway Community 是 Apache-2.0，且 `executeInTransaction` 按官方 Script Configuration 页的 Tier 列标注属于 Community（付费的是 `shouldExecute`、`undo`）。

**所以"B 做不到"是错的，必须把论证改正。** 结论仍为 A，但理由已从"B 不行"改为 §3 —— 那是**代价与同构性**的问题，不是能力问题。

### 选项 B 的真实代价（修正后）

Flyway 确实能解决 C4（事务外执行），这一点成立。但代价清单里有**两项不会因为"Flyway 能做到"而消失**：

1. **双事实源。** 只要还用 Prisma Client，`schema.prisma` 就必须存在。迁移改由 Flyway 管后，
   两者之间出现漂移时，**Prisma 自带的漂移检测不再覆盖** —— `migrate dev` 的 shadow DB 只对 Prisma 自己的迁移历史有效。
2. **与上游分道（C8）。** 这是初稿**低估了的最重一项**。heyta 的 `server/` 是 fork，
   上游在持续新增迁移并改进 `migrate-deploy.sh`。改用 Flyway 后：每个上游迁移都要人工转成 `V<version>__<desc>.sql`，
   且上游对恢复逻辑的任何修复**都无法直接受益**。

**C6 里那些规则不会因为换了工具就消失** —— "`lock_timeout='0'` 在 PostgreSQL 里表示永久等待"、
"等锁的 ACCESS EXCLUSIVE 会把整张表的新查询排到后面"，这些是 **PostgreSQL 层面的**，
换工具只是换个文档重新踩一遍。而且 `migrate-deploy.sh` 里的**孤儿 CONCURRENTLY 后端终止**
与 **lock-bounded 重试**，Flyway **并不提供** —— 脚本只会缩小，不会消失。

## 3. 结论

**选 A：继续用 Prisma，并把现有规范变成可执行的检查。**

⚠️ **本结论不是"Flyway 做不到"。** 调研已证实 Flyway Community 免费支持逐脚本非事务执行，
能力上它确实能覆盖 C4。选 A 的理由是**代价与同构性**：

理由按权重：

1. **与 fork 上游分道是持续成本，而非一次性成本（C8）。** 这是最重的一条。
   上游在持续新增迁移、改进恢复脚本。换工具后，**每个上游迁移都要人工转换一次**，
   且上游对恢复逻辑的修复无法直接受益。一次性迁移成本可以忍，**每季度重复的成本不能忍**。
2. **双事实源是真实且长期的成本。** 只要还用 Prisma Client（C2），`schema.prisma` 就必须存在。
   迁移改由 Flyway 管后，两者的漂移**不再被 Prisma 自带的检测覆盖**（shadow DB 只认自己的迁移历史）。
3. **`migrate-deploy.sh` 不会消失，只会缩小。** Flyway 覆盖的是 CONCURRENTLY 的**事务外执行**；
   它**不提供**孤儿 CONCURRENTLY 后端终止，也**不提供** lock-bounded 重试。
   代价清单里"可删掉 1111 行恢复逻辑"是不成立的 —— 真正能删的只是其中一部分。
4. **镜像成本。** C3 是 Node Alpine。为一个已解决的问题引入 JVM 运行时不划算。
   （Flyway CLI 是 Java 工具；**未在本机实测其镜像体积**，见 §5。）
5. **事故知识不该被丢弃。** C6 是针对这个 schema 的真实故障记录，不是通用最佳实践。

**投入方向改为**：把规范从"文档"变成"门禁" —— 见 §4。

### 触发重新评估的条件

如果发生以下任一情况，**重开一份 ADR**（不要改本份）：

- 上游 `super-sync-server` 停止维护，或 heyta 明确决定不再跟进上游迁移
- `migrate-deploy.sh` 的维护成本开始超过一次性迁移成本
- Prisma 明确拒绝支持非事务迁移**且**其替代品（如 ORM 8 的阻塞式 `createIndex`）被证明不适用于我们的数据量

## 4. 后果

**接受的约束**：

1. **迁移必须走 `sh scripts/migrate-deploy.sh`，不能用 `prisma migrate deploy`。** 已写进 `AGENTS.md` §4。
2. **新增 `scripts/check-migrations.mjs` 作为可执行校验**，检查可静态判定的部分：
   - 目录命名规范
   - CONCURRENTLY 形状（单语句 / 可恢复的 drop-then-create）
   - lock-bounded `ALTER INDEX` 形状（`lock_timeout` 范围、恰好两条语句、不含 CONCURRENTLY）
   - `migrate-deploy.sh` 解析器的前提（整行 `--` 注释、语句行尾 `;`）
   - 已接入 `pnpm check:migrations` 与 `pnpm check`
3. **校验器本身必须能失败。** 已用三个探针验证：缺 `lock_timeout` 被抓、`lock_timeout='0'` 被抓、正确形状通过。
4. **规范权威位置是 `server/prisma/migrations/README.md`**，`AGENTS.md` §4 只做摘要与入口，不复制 —— 两份规则必然漂移。

**因此以后更难做的事**：如果将来真要换迁移工具，成本会随迁移数量增长（当前 29 个），且越晚越贵。**这是一个有意的取舍**：我们赌 Prisma 生态继续演进，而不是现在付一次性的迁移代价。

**如果这个赌注变了**（例如 Prisma 长期不解决 C4 且社区方案恶化），重新评估的触发条件是：
- Prisma 官方明确拒绝支持非事务迁移，且
- `migrate-deploy.sh` 的维护成本开始超过一次性迁移成本

## 5. 证据与缺口

### 5.1 已核实（本 ADR 直接依赖）

§1 的约束全部可复现（读文件、跑脚本、跑 Docker）。迁移调研返回后，以下四项**已从"未核实"转为"已核实"**：

| 事实 | 结论 | 对结论的影响 |
|---|---|---|
| Flyway Community 许可证 | **Apache-2.0** —— 过 C7 许可门槛 | **有利于 B**（初稿曾据此弱化 B，已改正） |
| `executeInTransaction` 是否免费 | **属 Community 免费**（官方 Script Configuration 页 Tier 列；付费的是 `shouldExecute` 与 `undo`） | **有利于 B**：B 的能力主张成立 |
| Flyway 能否自动处理非事务语句 | 官方称会**自动检测**并标记 —— CONCURRENTLY 可能开箱即用 | **有利于 B** |
| Flyway 状态表与命名 | `flyway_schema_history`；`V<version>__<description>.sql`；非事务用同名 `.conf` | 中性 |

**因此 §3 的结论不建立在"B 做不到"上**，而建立在 C8（fork 同构）、双事实源、JVM 与不可消除的维护成本上。

### 5.2 已核实的 Prisma 侧事实

| 事实 | 结论 |
|---|---|
| Prisma 最新稳定版本 | `@prisma/client` **7.10.0**（2026-08-25）；CLI `latest` 指向 **8.0.0-rc.17**（RC，非稳定）。项目在用 **5.22.0** |
| ORM 8 是否支持非事务迁移 | **不支持**。ORM 8 文档明确：一次 `npx prisma db migrate` 在 PostgreSQL 上是**一个事务**，`rawSql` **不能**跑 `CREATE INDEX CONCURRENTLY`；官方给的替代是 `this.createIndex`，即**阻塞写入**的普通 `CREATE INDEX` |
| 相关 issue 状态 | `#14456` 标 closed/completed (2026-02-12)，但 **`#22922` / `#15295` / `#8080` 仍 open** |

> ⚠️ **一处未能解释的矛盾**：`#14456` 被标为 completed，而**官方文档仍明说不支持**。
> 其**关闭理由未能核实**（issue 页 HTML 只渲染前 8 条评论，均为 2022 年内容；GitHub core API 当时有限流）。
> **本 ADR 按文档判定为"不支持"** —— 文档是最新事实源，且方向与 issue 标题相反。
> 若要彻底钉死，可拉 `/repos/prisma/orm/issues/14456/comments`。

> ⚠️ **一个必须说明的适用性限制**：上述 ORM 8 原文讲的是它**新的迁移编写 API**
> （`prisma db migrate` / `rawSql` / `this.createIndex`），**与我们当前 `prisma migrate deploy` 跑 `.sql` 文件的路径不是同一个接口**。
> 所以"升级 Prisma 8 一定无解"这一推论，严格说是**未在本机实测**的。
> 但实际结论依然成立：官方文档**明确以阻塞式建索引作为索引场景的答案**，说明它不打算提供非事务建索引。
> **`migrate-deploy.sh` 在可预见版本内仍是必需的。**

### 5.3 仍未核实

| 未核实项 | 影响 |
|---|---|
| `#14456` 的关闭理由 | 若它确实实现了 per-migration 事务开关，则 ORM 8 的结论需修正 |
| Flyway 是否强依赖 JVM、其 Docker 镜像体积 | 影响 §3 理由 4 的权重（Flyway CLI 是 Java 工具，但**未在本机实测**） |
| Flyway `group` / `mixed` 配置的 Tier | 本 ADR 未依赖 |
| `golang-migrate` 的真实 SPDX | 选项 C 未选，不影响结论 |
| 选项 C 各轻量迁移的活跃度 | 未逐一过 C7，但 C8 对它们同样适用 |

> 本 ADR 的取舍原则：**证据不足时选可逆的一侧。** 选 A 可逆（随时能换），选 B 不可逆（baseline 之后回不去）。

## 6. 两处事实更正

### 6.1 上游 README 开头那句是简化

`server/prisma/migrations/README.md` 开头写的是 "Prisma 5.x wraps every migration in a transaction"。
这句话**不准确**，而且它自己的后文就给出了更准确的版本：真正形成事务的是 **PostgreSQL 的简单查询协议** ——
多条语句合在一个查询字符串才构成隐式事务，单条不会。

这解释了实测现象：单条 `CREATE INDEX CONCURRENTLY` 迁移**原生通过**（如 `20260511000000`），
而多语句的（如 `20260512000000`）报 `25001`。**README 后文是对的，开头那句是简化。**

之所以记在这里而不是改掉 README：那份文件是 vendored 的（与上游逐字节相同），
擅自修改会让未来的 upstream 合并产生冲突。改动应回馈上游。

### 6.2 CONCURRENTLY 迁移的数字（三个口径都对，别混用）

不同数法会得出不同结果，容易误判，这里一次说清：

| 口径 | 数量 | 说明 |
|---|---|---|
| 目录条目总数 | 32 | 含 `README.md`、`migration_lock.toml`、`migrate-passkey-credentials.ts` 三个**非迁移目录项** |
| **真实迁移目录** | **29** | 这才是迁移数 |
| `migration.sql` 原文含 `CONCURRENTLY` | 10 | 包含**仅在注释里提及**的那一个 |
| **实际需要事务外执行的** | **9** | 剥掉注释后的真实数量 —— `scripts/check-migrations.mjs` 报的就是这个 |
| 其中 drop+create 可恢复形状 | 5 | `20260512000000`、`20260514000000`、`20260514000002`、`20260828000001`、`20260829000000`（与脚本注释里 "5 recoverable" 一致） |

> 我本人在这上面**数错过一次**：最初 grep 原始文本得到 10，并把 `20260613000001` 误判为"两条 CREATE CONCURRENTLY" ——
> 实际它只有**一条**，第二条是**它自己注释里**解释该机制的那句话。
> 校验器现在会**先剥注释再检测**，正是为了避免这个坑。
