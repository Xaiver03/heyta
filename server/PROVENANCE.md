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

**业务代码未作修改。** 服务端通过 `@heyta/shared-schema` 的实体清单与服务端校验间接适配 heyta ——
因为我们已经把那个包的 `ENTITY_TYPES` 换成了 heyta 的 13 项，服务端会自动接受 heyta 实体、
拒绝 SP 专属实体。这正是把实体清单放在共享包里的价值。

## ⚠️ 我们**没有**升级 Prisma

`package.json` 里锁的是 `@prisma/client` **5.22.0**，而当前稳定线是 7.x。
**这是刻意的**：P0 的目标是先跑通，不是升级。Prisma 大版本跨越涉及 schema 语法、
客户端 API、迁移行为的全面变化，应当**单独立项**评估，不要混在"把服务端跑起来"里做。

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
