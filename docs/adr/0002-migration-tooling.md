# ADR-0002：数据库迁移方案 —— 继续用 Prisma，不引入 Flyway

> 状态：**已接受**
> 日期：2026-09-25
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

> **C5/C6 的分量最重，且是我在调研前没意识到的。** `migrate-deploy.sh` 不是"一个绕过 Prisma 限制的临时脚本"，
> 它包含：专用 advisory lock（key `72707370`，区别于 Prisma 自己的 `72707369`）、
> 孤儿 CONCURRENTLY 后端的识别与终止、lock-bounded 重试上限、失败回滚后可安全重跑的不变量。
> README 里记着一次**真实停摆**：等锁的 `ACCESS EXCLUSIVE` 请求把该表上所有新查询排队，实测一个简单读从 **79 ms 涨到 8005 ms**。

## 2. 选项

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. 继续用 Prisma**（保留恢复脚本） | 零迁移成本；C5/C6 的事故知识全部保留；单一事实源（`schema.prisma`）；镜像不加 JVM | 需要自己的恢复脚本处理 CONCURRENTLY；Prisma 5 无原生非事务迁移 | 本 ADR §1 |
| **B. 换成 Flyway** | 原生支持逐脚本非事务执行，可删掉 1111 行恢复逻辑；SQL 迁移更"标准" | 要 baseline 29 个已有迁移；**产生双事实源**（`schema.prisma` vs SQL），有漂移风险；Node 镜像加 JVM；**丢弃 C6 记录的故障知识** | 见 §5 未核实项 |
| **C. 换轻量迁移器**（`node-pg-migrate` / `dbmate` / `golang-migrate` / Atlas） | 无 JVM；原生非事务 | 同样要 baseline + 双事实源；且每个都要单独过 C7 门槛 | 未逐一核实（见 §5） |

### 关于选项 B 的一个关键反问

Flyway 能解决的**唯一实质问题**是 C4（事务外执行）。但请看清代价对比：

- Flyway 省掉的：`migrate-deploy.sh` 的恢复逻辑
- Flyway 带来的：baseline 29 个迁移、双事实源、JVM、以及**必须重新发现那些已经用事故换来、并写在 C6 里的坑**

**C6 里那些规则不会因为换了工具就消失** —— 比如"`lock_timeout='0'` 在 PostgreSQL 里表示永久等待"、
"等锁的 ACCESS EXCLUSIVE 会把整张表的新查询排到后面"。换工具只是把它们从 Prisma 的文档
搬到一个新工具的文档里，并且要在生产上重新踩一遍。

## 3. 结论

**选 A：继续用 Prisma，并把现有规范变成可执行的检查。**

理由按权重：

1. **Flyway 解决的是我们已经在解决的问题。** C4 不是"未解决的障碍"，而是"已被 1111 行脚本 + 204 行规范解决并记录在案的问题"。换工具是在重做已完成的工作。
2. **双事实源是真实且长期的成本。** 只要还用 Prisma Client（C2），`schema.prisma` 就必须存在。迁移一旦由 Flyway 管理，`schema.prisma` 与 SQL 迁移之间就存在漂移可能，而 Prisma 自带的漂移检测（`migrate dev` 的 shadow DB）会失效 —— 它只对**自己的**迁移历史有效。
3. **镜像成本。** C3 是 Node Alpine。为一个已经解决的问题引入 JVM 运行时不划算。
4. **事故知识不该被丢弃。** C6 的内容不是通用最佳实践，是针对这个 schema 的真实故障记录。

**投入方向改为**：把规范从"文档"变成"门禁" —— 见 §4。

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

## 5. 未核实项

**本 ADR 的结论建立在 §1 那些我亲自核实过的约束上（全部可复现：读文件、跑脚本、跑 Docker）。**
以下事实我**没有**验证，它们也不影响结论，但如果有相反证据应当重新评估：

| 未核实项 | 状态 |
|---|---|
| Flyway Community Edition 的确切许可证 | **未核实**。若为 Apache-2.0 则过 C7 的许可门槛 |
| Flyway 的逐脚本非事务执行（`executeInTransaction=false`）是否在**免费** Community 版可用 | **未核实**。这是选项 B 的核心卖点 |
| 最新 Prisma（6.x/7.x）是否已原生支持非事务迁移 | **未核实**。若已支持，`migrate-deploy.sh` 的价值会下降（但不会归零 —— 它还有孤儿清理与 advisory lock） |
| Flyway 的迁移状态表名与文件命名规范 | **未核实** |
| 选项 C 各轻量迁移器的许可证与活跃度 | **未核实**，未逐一过 C7 门槛 |

> 已委托一次外部调研核实上述前四项；在其结论回来之前，本 ADR 按"证据不足时选**维持现状**"处理 ——
> 因为选 A 的代价可逆（随时可以换），选 B 的代价不可逆（baseline 之后回不去）。

## 6. 一点更正

`server/prisma/migrations/README.md` 开头写的是 "Prisma 5.x wraps every migration in a transaction"。
这句话**不准确**，而且它自己的后文就给出了更准确的版本：真正形成事务的是 **PostgreSQL 的简单查询协议** ——
多条语句合在一个查询字符串才构成隐式事务，单条不会。

这解释了实测现象：单条 `CREATE INDEX CONCURRENTLY` 迁移**原生通过**（如 `20260511000000`），
而多语句的（如 `20260512000000`）报 `25001`。**README 后文是对的，开头那句是简化。**

之所以记在这里而不是改掉 README：那份文件是 vendored 的（与上游逐字节相同），
擅自修改会让未来的 upstream 合并产生冲突。改动应回馈上游。
