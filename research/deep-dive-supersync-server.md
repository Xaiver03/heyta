# 深度拆解：`super-sync-server`

> 对象：`research/upstream/super-productivity/packages/super-sync-server/`
> License：**MIT**
> 拆解方式：直接读源码与 Prisma schema。所有结论附文件路径与行号。
> 拆解时间：2026-09-25
> ⚠️ 本报告为**第一手实测**；另有子代理的独立拆解在进行中，返回后会合并。

---

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| 技术栈 | **Fastify 5 + Prisma 5 + PostgreSQL** |
| 规模 | 148 个 ts 文件 |
| 能否独立部署？ | ✅ **可以**。除了同 monorepo 的 `@sp/sync-core` 和 `@sp/shared-schema`，无其他内部依赖 |
| 依赖许可证 | ✅ **全部宽松**（MIT / Apache-2.0 / BSD），零 copyleft |
| 鉴权 | JWT Bearer，**有效期 365 天**；支持 WebAuthn Passkey 与 Magic Link；有 token version 撤销机制 |
| 端到端加密 | ✅ 服务端可只存密文（`isPayloadEncrypted` 字段 + 加密载荷运输形状校验） |
| 生产成熟度 | **高**。schema 注释里记录了多租户索引性能事故与修复 |
| 复用结论 | ✅ **直接复用 + 替换实体清单** |

---

## 1. 模块地图（`src/`）

```
src/
├── index.ts / server.ts      # 启动与路由注册
├── api.ts                    # 账号与鉴权端点
├── auth.ts                   # JWT、验证码、token 撤销
├── auth-cache.ts             # 鉴权缓存
├── config.ts                 # 配置（env）
├── db.ts                     # Prisma 客户端
├── email.ts                  # SMTP 邮件（注册验证 / magic link）
├── email-allowlist.ts        # 邮箱白名单
├── middleware.ts             # authenticate（Bearer JWT）
├── passkey.ts                # WebAuthn / Passkey
├── pages.ts                  # 静态页面
├── logger.ts
├── test-routes.ts            # 仅 TEST_MODE 下注册
└── sync/
    ├── sync.routes.ts        # 路由注册入口
    ├── sync.routes.ops-handler.ts      # 收发操作
    ├── sync.routes.snapshot-handler.ts # 快照
    ├── sync.routes.quota.ts            # 配额
    ├── sync.routes.payload.ts          # 载荷处理
    ├── websocket.routes.ts   # 实时推送
    ├── conflict.ts           # 冲突检测
    ├── op-replay.ts          # 操作重放
    ├── checkpoint-gate.ts    # 客户端版本门禁
    ├── compressed-body-parser.ts / gzip.ts  # 压缩传输
    ├── cleanup.ts            # 清理
    ├── sync.service.ts / sync.types.ts / sync.const.ts
    └── services/
        ├── operation-upload.service.ts
        ├── operation-download.service.ts
        ├── snapshot.service.ts / snapshot-generation.service.ts
        ├── device.service.ts
        ├── rate-limit.service.ts        # 有界内存缓存（10000 条上限 ≈ 2MB）
        ├── storage-quota.service.ts
        ├── validation.service.ts
        ├── request-deduplication.service.ts
        └── websocket-connection.service.ts
```

---

## 2. 完整 API 清单（实测提取）

路由注册见 `src/server.ts:487-500`。

### 2.1 账号 / 鉴权 —— 前缀 `/api`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/verify-email` | 邮箱验证 |
| POST | `/api/replace-token` | 轮换 token（使旧 token 全部失效） |
| DELETE | `/api/account` | 注销账号 |
| POST | `/api/register/passkey/options` | Passkey 注册 - 取挑战 |
| POST | `/api/register/passkey/verify` | Passkey 注册 - 校验 |
| POST | `/api/login/passkey/options` | Passkey 登录 - 取挑战 |
| POST | `/api/login/passkey/verify` | Passkey 登录 - 校验 |
| POST | `/api/recover/passkey` | Passkey 恢复 |
| POST | `/api/recover/passkey/options` | 恢复 - 取挑战 |
| POST | `/api/recover/passkey/complete` | 恢复 - 完成 |
| POST | `/api/register/magic-link` | Magic Link 注册 |
| POST | `/api/login/magic-link` | Magic Link 登录 |
| POST | `/api/login/magic-link/verify` | Magic Link 校验 |

> 三种登录方式并存：**Passkey（WebAuthn）/ Magic Link / 密码**。`User.passwordHash` 可为 null（`prisma/schema.prisma:15` 注释 "Nullable for passkey-only users"）。

### 2.2 同步 —— 前缀 `/api/sync`

| 方法 | 路径 | 行号 | 说明 |
|---|---|---|---|
| **POST** | `/api/sync/ops` | `sync.routes.ts:77-78` | **上传操作批次** |
| **GET** | `/api/sync/ops` | `:99-102` | **下载操作增量** |
| POST | `/api/sync/snapshot` | `:198-199` | 上传全量快照 |
| GET | `/api/sync/status` | `:219-220` | 同步状态 |
| GET | `/api/sync/devices` | `:265-266` | 设备列表 |
| DELETE | `/api/sync/data` | `:295-296` | 删除全部数据 |
| GET | `/api/sync/restore-points` | `:328-331` | 恢复点列表 |
| GET | `/api/sync/restore/:serverSeq` | `:368-371` | 恢复到指定序号 |
| **GET** | `/api/sync/ws` | `websocket.routes.ts:40` | **WebSocket 实时推送**（`token` + `clientId` 走 query） |

整个 `/api/sync` 路由挂载了 `authenticate` 前置钩子（`sync.routes.ts:72`）。

### 2.3 其他

- `/api/test/*` —— 仅在 `TEST_MODE` 开启时注册（`server.ts:500`）
- `/*` —— 静态页面（`server.ts:505`）

---

## 3. 数据模型（`prisma/schema.prisma`）

datasource：**PostgreSQL**（`env("DATABASE_URL")`）。共 6 张表。

### 3.1 `Operation`（`:81-131`）—— 同步核心表

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | String @id | 操作 ID（客户端 UUID v7） |
| `userId` | Int | 租户隔离键 |
| `clientId` | String | 来源设备 |
| **`serverSeq`** | Int | **服务端分配的单调整数**，每个用户独立 |
| `actionType` / `opType` / `entityType` / `entityId` | String | 操作语义 |
| `entityIds` | String[] @default([]) | 多实体批次操作 |
| `payload` | Json | **加密后就是密文** |
| `payloadBytes` | BigInt | 配额计量 |
| `vectorClock` | Json | 向量时钟 |
| `schemaVersion` | Int | 数据版本 |
| `clientTimestamp` | BigInt | 客户端时间（LWW 决胜依据） |
| `receivedAt` | BigInt | 服务端接收时间 |
| `isPayloadEncrypted` | Boolean | 是否密文 |

**索引设计（含真实事故记录）**：

```prisma
@@unique([userId, serverSeq])
@@index([userId, entityType, entityId, serverSeq])
@@index([userId, receivedAt, serverSeq])
@@index([entityIds], type: Gin, map: "operations_entity_ids_gin")
```

注释 `:115-122` 记录了一次**严重性能事故**：
> "while the GIN existed only as raw SQL the CI, E2E and documented manual-setup databases had **NO index at all** — and `detectConflictForEntity`'s MATERIALIZED CTE carries no `user_id` predicate, so without it **every probe Seq Scans EVERY tenant's rows, twice per accepted op**."

还有两条 **Prisma 无法表达的 partial index** 必须靠原生 SQL 迁移维护（`:123-129`）——分别是"broad 3-value"和"causal"索引。

> 💡 **对我们的价值**：这是**真实多租户性能踩坑记录**。我们自己写服务端时，`(userId, entityType, entityId, serverSeq)` 这个复合索引 + GIN 索引是必须的，否则租户一多就全表扫描。

### 3.2 `UserSyncState`（`:133-147`）—— 每用户同步水位

`userId`(PK)、`lastSeq`、`lastSnapshotSeq`、`snapshotData`(Bytes)、`snapshotAt`、
`snapshotSchemaVersion`、`latestFullStateSeq`、`latestFullStateVectorClock`(Json)、
`latestStateReplacementSeq`。

> 注意 `latestFullStateVectorClock`：**服务端也维护向量时钟**，用于全量状态替换的因果判定。

### 3.3 `SyncDevice`（`:149-160`）

`clientId`、`userId`、`deviceName`、`userAgent`、`appVersion`、`lastSeenAt`、`lastAckedSeq`、`createdAt`。
`appVersion` 被 **checkpoint gate**（`sync/checkpoint-gate.ts`）读取，用于**客户端版本门禁**（旧版本客户端的行为约束）。

### 3.4 其余

`User`（`:13-47`）、`Passkey`（`:48`）、`PendingPasskeyRegistration`（`:64`）。

---

## 4. 鉴权机制

| 项 | 值 | 出处 |
|---|---|---|
| 方式 | `Authorization: Bearer <jwt>` | `middleware.ts:33-35` |
| **JWT 有效期** | **365 天** | `auth.ts:15-18`（注释："All JWT tokens live for 365 days regardless of authentication method"） |
| 校验 | `jwt.verify(token, JWT_SECRET, ...)` | `auth.ts:194` |
| 撤销 | **token version 递增**，一次性废掉该用户所有 token | `auth.ts:139-148` `revokeAllTokens` |
| 邮箱验证 token | 24 小时有效，最多重发 20 次 | `auth.ts:20-21` |
| Passkey | `@simplewebauthn/server` | `package.json` |

> ⚠️ **365 天有效期是个需要我们自己决策的点**。对"个人待办应用"是合理的（少登录），
> 但对商业化产品，配合 token version 撤销已足够。我们要评估是否缩短。

---

## 5. 部署与配置

### 5.1 已具备的部署物料

```
Dockerfile / Dockerfile.test
docker-compose.yml / docker-compose.build.yml / docker-compose.monitoring.yml
helm/                       # Kubernetes chart
Caddyfile                   # 反向代理
prisma/                     # schema + migrations
docs/                       # authentication.md, architecture.md, backup-and-recovery.md, production-capacity.md
legal/                      # 法律文本模板
templates/                  # 邮件模板
```

> **它连隐私政策 / 法律文本模板和邮件模板都有**。对要商业化托管的产品，这是实打实的省事。

### 5.2 环境变量（实测提取）

| 类别 | 变量 |
|---|---|
| 基础 | `NODE_ENV`、`PORT`、`HOST`、`PUBLIC_URL`、`DATA_DIR` |
| 数据库 | `DATABASE_URL` |
| CORS | `CORS_ENABLED`、`CORS_ORIGINS` |
| SMTP | `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_FROM`、`SMTP_PASS` |
| 隐私/合规 | `PRIVACY_CONTACT_NAME`、`PRIVACY_CONTACT_EMAIL`、`PRIVACY_HOSTING_PROVIDER`、`PRIVACY_DATA_REGION`、`PRIVACY_ADDRESS_STREET/CITY/COUNTRY`、`PRIVACY_SUPERVISORY_AUTHORITY` |
| 测试 | `TEST_MODE`、`TEST_MODE_CONFIRM` |

> `PRIVACY_*` 系列说明它面向 **GDPR/EEA** 合规场景设计过（代码里也有 `EEA` 分支）。

### 5.3 ⚠️ 未能实测的部分

本机**没有安装 Docker**，因此：
- ❌ 未能实际跑起服务端
- ❌ 未能验证 `docker-compose.yml` 能否一键启动
- ❌ 未能实测同步往返

**这是下一步最该补的验证。**

---

## 6. 复用结论

### ✅ 可直接复用

1. **整套 HTTP + WebSocket 协议**——8 个同步端点 + 13 个账号端点，边界清晰
2. **Prisma schema 与索引设计**（含多租户性能事故教训）
3. **鉴权体系**：Passkey + Magic Link + JWT + token 撤销
4. **部署物料**：Docker / Helm / Caddy / 监控 / 邮件模板 / 法律文本模板
5. **加密载荷的"只存密文"模式**：`isPayloadEncrypted` + 运输形状校验

### 🔧 必须改造

| 改造点 | 原因 |
|---|---|
| **实体清单** | `validation.service.ts` 依赖 `@sp/shared-schema` 的 `ENTITY_TYPES`（SP 专属 21 项）。heyta 要换成自己的（含 `HABIT` / `HABIT_LOG` / `FOCUS_SESSION`） |
| **actionType 词汇表** | 服务端会按 `actionType` 做冲突判定（`conflict.ts`），需与客户端对齐 |
| **冲突策略** | 服务端 `op-replay.ts` / `conflict.ts` 内嵌了 SP 的语义 |
| 品牌与页面 | `pages.ts`、`templates/`、`legal/` 需替换 |

### ❌ 不要的部分

- `test-routes.ts` 与 `/api/test/*` —— 生产禁用（已由 `TEST_MODE` 保护）
- SP 特有的 checkpoint gate 版本策略 —— 需按 heyta 的发版节奏重定

---

## 7. 这个服务端最值钱的地方

不是代码行数，而是它**编码了做"多用户同步服务"的真实教训**：

1. **多租户索引必须显式设计**——否则一次冲突检测 = 扫描所有租户的行
2. **Prisma 表达不了 partial index**——必须用原生迁移，且 `prisma db push` 会丢失它们
3. **向量时钟服务端也要维护**，不能只信客户端
4. **有界内存**：速率限制缓存显式设上限（10000 条 ≈ 2MB）
5. **请求去重**（`request-deduplication.service.ts`）——网络重试下防重复入库
6. **客户端版本门禁**——防止旧客户端写坏新格式数据

这些坑如果我们从零写，**大概率要各踩一遍**。

---

## 8. 未确认项

- 未确认 `@sp/sync-core` / `@sp/shared-schema` 作为依赖时的版本绑定方式（本地 `file:` 还是发布包）
- 未实测 Docker 部署
- 未读 `op-replay.ts` / `conflict.ts` 的完整算法
- 未确认 WebSocket 连接的完整消息协议
- 未评估 148 个文件的测试覆盖度

---

*相关文档：`docs/06-reuse-plan.md`（复用方案）、`research/deep-dive-sync-core.md`（客户端同步内核）、`research/licenses.md`（许可证登记）。*
