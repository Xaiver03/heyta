# 出处说明（Provenance）

本目录是 **vendored（内联复用）** 的第三方代码，heyta 在其上做改造。

## 来源

| 项 | 值 |
|---|---|
| 上游项目 | **Super Productivity** |
| 仓库 | https://github.com/super-productivity/super-productivity |
| 路径 | `packages/super-sync-server/` |
| **commit** | `aa9690ca28aa6751971dd0e47d9b39c5b72922cb` |
| **commit 日期** | 2026-09-24T20:59:28+02:00 |
| License | **MIT** |
| 版权 | Copyright (c) 2018 Johannes Millan |

原始 `LICENSE` 文件完整保留在本目录下。

## 我们做的改动（尽量最小）

| 改动 | 说明 |
|---|---|
| 包名 | `@super-productivity/super-sync-server` → `@heyta/sync-server` |
| 依赖名 | `@sp/shared-schema` → `@heyta/shared-schema`（18 处）；`@sp/sync-core` → `@heyta/sync-core`（4 处） |
| 工作区依赖 | `"*"` → `"workspace:*"` |
| `package.json` description | 改为 heyta 描述 |

### 🔴 唯一一处**语义**改动：精确重复回幂等成功（ADR-0009）

`src/sync/services/operation-upload.service.ts` 的两处"磁盘上已有同 id op"分支
（可预测的 `existingOp` 分支、竞态失败后的 `duplicateOp` 分支），在
`isSameDuplicateOperation(...)` 判定为**同一条 op**时，从

```ts
return reject(... 'Duplicate operation ID' ... DUPLICATE_OPERATION)
```

改成

```ts
return { result: { opId: op.id, accepted: true, serverSeq: existingOp.serverSeq },
         storageBytes: 0, fallback: false };
```

理由、边界与验收证据见 [`docs/adr/0009-duplicate-op-idempotent-success.md`](../docs/adr/0009-duplicate-op-idempotent-success.md)。
这不是"顺手改"：旧行为会让一台设备**永久同步不了**（硬拒绝 → 不落"已上传" → 重传整批 → 又硬拒绝）。

🔴 **`INVALID_OP_ID` 那几条硬拒绝分支一个字都没动** —— 内容 / 向量时钟 / 持久化元数据不同、
跨用户 id 碰撞、竞态里的 id 碰撞，仍然全部拒绝。"幂等重试"与"id 冲突"的分界线就在这里。

🔴 这不是新发明：上游**自己的** snapshot 路径早就是这么做的 ——
`src/sync/sync.routes.snapshot-handler.ts:454-478`，注释原文
"Surface the original serverSeq as success instead of a confusing DUPLICATE_OPERATION rejection"。

**其余业务代码未作修改。** 服务端通过 `@heyta/shared-schema` 的实体清单与服务端校验间接适配 heyta ——
因为我们已经把那个包的 `ENTITY_TYPES` 换成了 heyta 的 13 项，服务端会自动接受 heyta 实体、
拒绝 SP 专属实体。这正是把实体清单放在共享包里的价值。

## ⚠️ 我们**没有**升级 Prisma

`package.json` 里锁的是 `@prisma/client` **5.22.0**，而当前稳定线是 7.x。
**这是刻意的**：P0 的目标是先跑通，不是升级。Prisma 大版本跨越涉及 schema 语法、
客户端 API、迁移行为的全面变化，应当**单独立项**评估，不要混在"把服务端跑起来"里做。

## 测试套件排查记录（P0 实测）

上游的测试套件在 heyta 环境下一开始有 **176 个失败**。逐个查清了原因，**没有一个是"把测试删掉就好了"**：

| 失败数 | 文件 | 真实原因 | 处理 |
|---|---|---|---|
| 93 | `health-alert-script.spec.ts` | 脚本测试要读写 journald / docker 宿主状态，macOS 没有该环境。文件与上游**逐字节相同**，零引用 `@heyta/*` | 排除（Linux 专用） |
| 59 | `migrate-deploy-script.spec.ts` | 同上 | 排除（Linux 专用） |
| 18 | `time-tracking-operations.spec.ts` | 测的是上游 `TIME_TRACKING` 实体，heyta 已用 `FOCUS_SESSION` 取代 —— **这是实体决策的真实后果** | 排除，P1 重写 |
| 3 | `validation.service.spec.ts` | 断言 SP 的 21 个实体 | ✅ 改写为 heyta 的 13 个 |
| 1 | `sync-operations.spec.ts` | 同上（`TIME_TRACKING` 上传用例） | ✅ 改写为 `FOCUS_SESSION` |
| 1 | `migration-sql.spec.ts` | 断言**上游仓库布局**（`packages/super-sync-server/**`、上游 CI 文件）。heyta 布局不同 | `it.skip` + 注明 |
| 1 | `monitoring-scripts.spec.ts` | Linux 脚本 | 排除（Linux 专用） |

另有 8 个 `tests/integration/*.integration.spec.ts` 需要**真实 PostgreSQL**，无法加载，因此不计入。

**改动后结果：`pnpm -r test` 全绿，1087 通过 / 1 跳过。**

### 关键结论：不要用"删测试"换绿

判定一个失败是否为 heyta 引入，用的是**与上游逐字节 diff**：
`tests/health-alert-script.spec.ts`、`scripts/health-alert.sh` 等文件与上游**完全相同**，
却在本机失败 —— 这就证明问题在我们之外。

其余有差异的测试文件里，5 个只有 2 行差异（纯包名替换），
只有 `validation.service.spec.ts` 是实质改写（实体清单）。

### 另外放宽了超时

`*.pglite.spec.ts` 用 WASM 版 Postgres，起实例 + 跑迁移经常超过上游的 10s hook 超时。
这是**环境耗时**而非逻辑慢，因此把 `hookTimeout` 放宽到 30s 并在配置里注明了原因。

---

## 尚未验证

本目录代码**从未真实运行过**。本机没有 Docker，且 `docker compose up` 需要：
- PostgreSQL
- `DATABASE_URL` 等环境变量（见 `env.example`）

**这是 P0 唯一未完成的验收项。**

## 部署速查（上游自带，未改动）

| 物料 | 文件 |
|---|---|
| 容器镜像 | `Dockerfile` |
| 一键编排 | `docker-compose.yml` |
| 反向代理 | `Caddyfile` |
| Kubernetes | `helm/` |
| 监控 | `docker-compose.monitoring.yml` + `DOCKER-MONITORING.md` |
| 环境变量样例 | `env.example` |
| 数据库迁移 | `prisma/migrations/` |
| 邮件模板 | `templates/` |
| 法律文本模板 | `legal/` |

⚠️ **建表必须走 `prisma migrate`，不要用 `prisma db push`。**
上游在 schema 注释里记录了一次真实事故：`db push` 会**丢失 partial index**，
而缺了那些索引会让多租户冲突检测退化成全表扫描。

## 更新上游代码的方法

```bash
git clone --depth 1 https://github.com/super-productivity/super-productivity /tmp/sp
git -C /tmp/sp log --oneline aa9690ca..HEAD -- packages/super-sync-server/
```

搬改动时注意：上游的 `packages/super-sync-server/` 用的是它自己的实体清单，
我们已经分叉了 `ENTITY_TYPES`，**合并时不要覆盖掉 heyta 的清单**。
