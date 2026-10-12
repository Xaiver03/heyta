<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「数据库迁移纪律」的完整规则（原文 §4 数据库迁移纪律）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

## 4. 数据库迁移纪律

**迁移是不可逆层。**

> 📖 **权威规范在 [`server/prisma/migrations/README.md`](../../server/prisma/migrations/README.md)** ——
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
