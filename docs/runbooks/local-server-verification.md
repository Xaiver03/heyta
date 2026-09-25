# 09 · 本地跑通同步服务端（不依赖 Docker）

本文记录 **P0 验收的完整可复现步骤**：在 macOS 上把 `@heyta/sync-server` 跑起来，
并用脚本验证一次真实的同步闭环。

**这套流程已经实际跑通并通过验收**（2026-09-25）。Docker 只是这套流程的打包形式，
不是验证的前提。

---

## 前提

| 依赖 | 说明 |
|---|---|
| Node ≥ 22 | 与根 `package.json` 的 `engines` 一致 |
| pnpm 11.8.0 | 根 `packageManager` 指定 |
| **PostgreSQL ≥ 16** | ⚠️ 服务端会在低于 16 时**警告**。本地验证用的 15 能跑通迁移，但生产请用 16（compose 里已是 `postgres:16-alpine`） |
| 已构建的包 | `pnpm -r build` |

---

## 步骤

### 1. 建一个隔离的测试库

```bash
createdb -h 127.0.0.1 -p 5432 -U "$(whoami)" heyta_sync_smoke
```

### 2. 跑迁移 —— **必须用脚本，不能用 `prisma migrate deploy`**

```bash
cd server
export DATABASE_URL="postgresql://$(whoami)@127.0.0.1:5432/heyta_sync_smoke?schema=public"
sh scripts/migrate-deploy.sh
```

**为什么不能直接用 Prisma**：Prisma 5 把每个迁移都包在事务里，而 PostgreSQL
**禁止在事务块里执行 `CREATE/DROP INDEX CONCURRENTLY`**。本项目有 5 个这样的迁移，
直接 `prisma migrate deploy` 会在第 6 个迁移上以 P3018 失败，之后还会卡在 P3009。

`scripts/migrate-deploy.sh` 会把这类迁移**拆出来在事务外执行**，然后标记为已应用再重试。
它还有配套的咨询锁与孤儿后端清理，能自动恢复上一次中断的部署。

> **macOS 注意**：该脚本是为 GNU sed 写的，第 630 行有一处 `sed -i`。
> macOS 的 BSD sed 需要 `sed -i ''`，会报 `invalid command code`。
> 用仓库里的垫片绕过：
> ```bash
> export PATH="$PWD/../research/tools/macos-sed-shim:$PATH"
> ```
> Docker 里是 Linux，**不需要**这个垫片。

### 3. 启动服务端

```bash
export JWT_SECRET="任意足够长的随机串"
export TEST_MODE=true
export TEST_MODE_CONFIRM=yes-i-understand-the-risks   # 缺这个会拒绝启动
export NODE_ENV=development                            # production 下禁止 TEST_MODE
export PORT=1900 HOST=127.0.0.1
node dist/src/index.js
```

`TEST_MODE` 会暴露 `/api/test/*`（免邮件验证造账号），**只能用于测试**。

### 4. 跑验收脚本

```bash
pnpm verify:sync --base-url http://127.0.0.1:1900
```

无需服务器时可以先自查：

```bash
pnpm verify:sync:dry
```

### 5. 清理

```bash
dropdb -h 127.0.0.1 -p 5432 -U "$(whoami)" heyta_sync_smoke
```

---

## 验收脚本实际验证了什么

| 阶段 | 检查 |
|---|---|
| 0 | op 形状通过**真实 zod 契约**；加密载荷不含明文；实体清单是 heyta 的 13 项 |
| 1 | 服务端可达（`/api/sync/status` 要求鉴权 = 正常） |
| 2 | 免邮件验证创建测试账号并拿到 JWT |
| 3 | **明文上传被拒（E2EE_REQUIRED）→ A 加密上传 → B 下载可见 → B 收到的仍是密文** |
| 4 | **两端基于同一向量时钟并发改同一实体 → 服务端判 `CONFLICT_CONCURRENT`** |

---

## 实测发现（三条，都会影响客户端实现）

### 1. 服务端**强制 E2EE，且没有开关**

`server/src/sync/sync.routes.payload.ts:47` 的 `violatesE2eeGate` 要求
`isPayloadEncrypted` **显式等于 `true`**（缺失也算违规），且 `payload` 必须是
规范 base64 密文形状（`@heyta/sync-core` 的 `isEncryptedPayloadTransportShape`，
有最小字节数下限）。

**明文上传一律 400 `E2EE_REQUIRED`。** 这条门禁在指纹/去重/配额/落库**之前**执行，
所以被拒的上传在服务端**不留任何痕迹**（含日志——日志只记数量，不记内容）。

> 对 heyta 是好消息：服务端从设计上就看不到用户明文。

### 2. 线协议 schema **不校验实体成员**

`SuperSyncOperationSchema` 只校验形状。传一个不存在的 `entityType` 它**会接受**；
实体成员校验只存在于服务端的 `validation.service.ts`（`ALLOWED_ENTITY_TYPES.has(...)`）。

**后果**：客户端拼错实体名时本地不会失败，要到上传后被服务端拒绝才发现。
客户端应在上传前用 `isEntityType()` 自查。

### 3. 线协议 schema **接受明文载荷**

同一个 schema 允许 `isPayloadEncrypted: false`，但服务端无条件拒绝。

**后果**：客户端无法从契约中得知"必须加密"。以上三点都是
**契约与运行时的不对称**，已在 `scripts/verify-sync-loop.mjs` 中固化为断言。

---

## 踩过的坑

**冲突测试必须分两次请求。**
服务端要求 op 的 `clientId` 与请求级 `clientId` 一致。把两个不同 clientId 的 op
塞进同一个请求会得到 `INVALID_CLIENT_ID`——测试会"通过"，但**完全没测到冲突检测**。
这个坑已经记在脚本注释里。

---

## Docker 部署（已实测跑通 ✅）

**镜像已成功构建并跑通完整验收**（OrbStack / Docker 29.6.1，arm64）。完整流程：

```bash
cd server
cp env.example .env          # 至少填 DOMAIN / JWT_SECRET / POSTGRES_PASSWORD

# 1. 构建镜像
docker compose -f docker-compose.yml -f docker-compose.build.yml build supersync

# 2. 起服务（caddy 需要真实域名做 TLS，本地验收用不到）
docker compose -f docker-compose.yml -f docker-compose.build.yml \
               -f docker-compose.test.yml up -d postgres supersync

# 3. 跑验收
pnpm verify:sync --base-url http://127.0.0.1:1900

# 4. 清理
docker compose -f docker-compose.yml -f docker-compose.build.yml \
               -f docker-compose.test.yml down -v
```

### 改造点（原样沿用上游布局的话，第一次部署必然失败）

| 问题 | 原因 | 处理 |
|---|---|---|
| builder 用 `npm ci` | heyta 的工作区定义在 `pnpm-workspace.yaml`，npm 不认；且 npm 不支持 `workspace:*` | 改用 pnpm（corepack 锁定 11.8.0） |
| 路径 `packages/super-sync-server/` | heyta 在 `server/` | 全部改为 `server/` |
| tarball `sp-*.tgz` | 包名改为 `@heyta/*` 后产出 `heyta-*.tgz` | 已实测确认命名 |
| `deploy.sh` 里 `../../` 路径 | 从 `server/` 看多跳了一级 | 修正 48 行 |
| 缺 `.dockerignore` | vendoring 时未带过来 | 已创建（含 `research/`，否则构建上下文会拖进整个上游克隆） |
| `docker-compose.build.yml` 的 `context: ../..` 与 `dockerfile: packages/...` | 同样按上游布局写死 | 改为 `..` 与 `server/Dockerfile` |

### 🔴 构建期踩到的两个坑（都已修，且都会在别人机器上复现）

**1. `minimumReleaseAge` 没显式声明 → 本地绿、容器红。**

本机 pnpm 该值为 0，容器里 corepack 装的原生 pnpm 11 默认 **24 小时**。
同一份 lockfile，本地 `pnpm install` 通过，容器里 `pnpm install --frozen-lockfile` 报
`The lockfile contains entries that the active policies reject`（点名刚发布的
`@rollup/rollup-*`、`@rolldown/binding-*`）。已在 `pnpm-workspace.yaml` 显式写死。详见该文件注释。

**2. 宿主机的 `DATABASE_URL` 会污染 compose —— 这个最阴。**

`docker-compose.yml` 用 `${DATABASE_URL:-默认值}` 允许指向外部数据库（上游的有意设计），
但 **docker compose 的变量插值优先读宿主机环境变量，其次才是 `.env` 文件**。
如果当前 shell 里有 `DATABASE_URL`（任何来源），容器就会拿到它，
而不是 compose 里那个带 `connection_limit`/`pool_timeout` 的默认值，
于是启动时报：

```
ERROR: DATABASE_URL must include exactly one positive connection_limit and pool_timeout value each.
```

**排查方法**：`docker inspect <容器> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DATABASE_URL`
—— 直接看容器**实际收到**的值，不要猜。

**规避**：`env -u DATABASE_URL docker compose ... up`，或在 `.env` 里显式覆盖
（注意 shell 环境仍然优先，所以 `env -u` 更可靠）。

### 容器内迁移同样是"两段式"

首启日志会看到迁移**故意失败再恢复**：

```
Error: P3018 ... DROP INDEX CONCURRENTLY cannot run inside a transaction block
==> Recovering 20260514000000_add_encrypted_ops_partial_index outside Prisma migrate...
    Serializing recovery under the dedicated recovery advisory lock (72707370)...
```

这不是故障 —— 是 `migrate-deploy.sh` 在按设计逐个把 CONCURRENTLY 迁移拆到事务外执行。
**31 个迁移全部应用成功**，容器随后进入 healthy。

### 仍未处理

`docker-compose.yml` 的镜像仍指向上游的
`ghcr.io/super-productivity/supersync:latest`。用 `deploy.sh --build` 或
`docker-compose.build.yml`（产出 `supersync:local`）不受影响，
但**直接 `docker compose up` 会拉上游镜像**。上线前需换成 heyta 自己的仓库名。
