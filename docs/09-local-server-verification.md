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

## Docker 部署（尚未实际运行）

Dockerfile 与 `deploy.sh` 已按 heyta 的布局改造（见 `server/PROVENANCE.md`），
但**本机没有 Docker，因此未实际构建过镜像**。改造点：

| 问题 | 原因 | 处理 |
|---|---|---|
| builder 用 `npm ci` | heyta 的工作区定义在 `pnpm-workspace.yaml`，npm 不认；且 npm 不支持 `workspace:*` | 改用 pnpm（corepack 锁定 11.8.0） |
| 路径 `packages/super-sync-server/` | heyta 在 `server/` | 全部改为 `server/` |
| tarball `sp-*.tgz` | 包名改为 `@heyta/*` 后产出 `heyta-*.tgz` | 已**实测**确认命名 |
| `deploy.sh` 里 `../../` 路径 | 从 `server/` 看多跳了一级 | 修正 48 行 |
| 缺 `.dockerignore` | vendoring 时未带过来 | 已创建（含 `research/`，否则构建上下文会拖进整个上游克隆） |

**未处理**：`docker-compose.yml` 的镜像仍指向上游的
`ghcr.io/super-productivity/supersync:latest`。heyta 需要换成自己的仓库，
或用 `deploy.sh --build` 本地构建。
