# 会员订阅：服务端接入点

> 状态：**调研结论（只读调研，未改动任何代码）**。
> 配套：[`subscription-boundary.md`](subscription-boundary.md)（产品边界，PM 定稿）。
> 本文件回答**"代码该改哪里"**，不改任何 ADR 的结论。

> ⚠️ **本文件的行号会漂移。** 共享文件随时可能被其他改动推移几行 ——
> 上面这批行号在 2026-09-27 复核过一次（`sync.routes.ts` 97、
> `server.ts` 488/494/516）。
> **引用行号时请用 `grep -n` 现场核一遍**，不要把这里的数字当权威：
> 结论是稳的，行号不是。

## 0. 🔴 先看清一件事：`server/` 是 vendored 上游

[`README.md`](../../README.md) 第 50 行写的是实话：
`server/` 是 **vendored（来自 Super Productivity / SuperSync，MIT）**。

这有一个直接后果，**在写任何一行代码之前必须认下来**：

| 现象 | 含义 |
|---|---|
| `server/legal/terms-of-service.md` 是**德语 AGB**，主体写的是 "Super Productivity Sync" / **Johannes Millan** | 那份法务文本**不是 heyta 的** |
| ToS §8「Preise und Zahlungsbedingungen」、§9「Laufzeit und Kündigung」、§11「Widerrufsrecht」**已经存在** | **但它们是上游运营者的条款**，不是我们的 |
| 🔴 **heyta 的 `terms-of-service.md` 目前是零条付费条款**（我核对过：搜「订阅/付费/支付/退款」为空） | 上一轮我说"服务条款里没有付费条款"**说对了，但原因比我想的严重** —— 不是"忘写了"，是**整个文件都不是我们的** |

**所以"补服务条款"这件事的真实工作量不是"加几条"，
而是"heyta 需要有自己的一份法务文本"。** 这是一个**运营/法务**动作，
不是一个编码动作 —— 我能写技术条款，但**运营主体、适用法律、退款政策
这些必须由你来定**，我不替你编。

> ⚠️ 我把这条单独拎出来，是因为它**改变了这个目标的形状**：
> 原计划里"补 ToS"被当成一个收尾小项，实际上它是一个**独立的前置项**。

> ✅ **后补（2026-09-27）：这份"heyta 自己的法务文本"已经存在（仍是草稿）。**
> 仓库里现在有两份，且是 `check-pricing-consistency.mjs` 交叉校验价格的对象
> （`LEGAL_FILES`）：
> - `server/legal/terms-of-service.heyta.md` —— 托管同步服务条款（草稿），
>   与 `terms-of-service.md`（上游德语 AGB）**互相独立**；
> - `server/legal/terms-of-service.ai.heyta.md` —— 云端 AI 订阅条款（草稿）。
>
> 🔴 **但两份都还是草稿、未经法务复核、不得对外**（见各文件头的红字）。
> 所以 §9 落地顺序第 1 项从"要写出来"变成"要律师过目并签字"，**仍未完成**。
> 另外 [ADR-0017](../adr/0017-single-paid-tier-and-payment-channel.md) §3.3 决定
> 支付通道复用同公司的「晓黎支付中心」，本节 §8 写的 webhook 端点形状
> （`/api/billing/webhooks/:provider`）**已落地**（`server/src/billing/webhook.routes.ts`，
> 注册在 `/api/billing`）。

## 1. HTTP 层：Fastify 5（不是 Express）

路由用 `fastify.get/post/delete` 写在各插件里，再由 `server.ts` 按前缀挂载。

```
server/src/server.ts:488  await fastifyServer.register(apiRoutes,  { prefix: '/api' })
server/src/server.ts:494  await fastifyServer.register(syncRoutes, { prefix: '/api/sync' })
server/src/server.ts:516  await fastifyServer.register(wsRoutes,   { prefix: '/api/sync' })
```
（`server/package.json`：`"fastify": "^5.12.1"`）

## 2. 认证：Bearer JWT，身份是 `{ userId, email }`

```
server/src/middleware.ts:29   authenticate  (preHandler)
server/src/middleware.ts:22   getAuthUser(req): { userId: number; email: string }
```
不是 Prisma `User` 对象 —— **只有 id 和 email**。要判断订阅得自己查表。

挂法有两种，都可照抄：
- 单路由：`{ preHandler: authenticate }`（`api.ts:187`）
- 整组：`fastify.addHook('preHandler', authenticate)`（`sync/sync.routes.ts:97`）

## 3. 权益校验挂哪：preHandler，排在 `authenticate` 之后

🔴 **Fastify 的 hook 按注册顺序执行** —— 权益守卫**必须**排在 `authenticate` 之后，
否则 `req.user` 还是空的。这是最容易写错的一处。

### 仓库里已有 4 种"先校验再放行"，最好的模板是**存储配额**

```
server/src/sync/sync.routes.quota.ts:232
  enforceStorageQuota(userId, delta, reply): Promise<boolean>

调用点（先校验、不通过就 return）：
server/src/sync/sync.routes.ops-handler.ts:271-274
  const quotaOk = initialQuota.allowed || (await enforceStorageQuota(userId, estimatedDelta, reply));
  if (!quotaOk) return null;
```

它一次性示范了四件该做的事：**返回布尔 + 自行 `reply` 错误 + 发结构化错误码 + 写审计**。

其余三种：按用户限流（`ops-handler.ts:113`，429 + `RATE_LIMITED`）、
E2EE ingress gate（`sync.routes.payload.ts:62`）、注册白名单（`email-allowlist.ts`）。

## 4. 数据库：新表是普通迁移，**不影响 `CURRENT_SCHEMA_VERSION`**

| 问题 | 答案 |
|---|---|
| `CURRENT_SCHEMA_VERSION` 管什么？ | **客户端 op-log / 快照的线协议版本**（`packages/shared-schema/src/schema-version.ts:36`），**不是**服务端表 |
| 加 `Subscription` 表要 bump 它吗？ | 🔴 **不要，也不该**。两者无关 |
| 迁移怎么写？ | 普通 `CREATE TABLE`（小表，**不要** `CONCURRENTLY`），照现有形状：`userId Int` + `onDelete: Cascade`、`@@map("subscriptions")`、snake_case 列名、`BigInt` 存时间戳 |
| 部署怎么跑？ | 🔴 **禁止直接 `prisma migrate deploy`** —— 必须 `cd server && sh scripts/migrate-deploy.sh` |
| 提交前？ | `node scripts/check-migrations.mjs`；命名 `<14位时间戳>_<snake_case>` |
| 已应用的迁移能改吗？ | 🔴 **永不**。要修就发新迁移 |
| 新字段？ | 老 `User` 行没有订阅列 —— 所以**一律可选或带默认值**（`AGENTS.md §3.3`） |

## 5. 🔴 自托管 vs 官方托管：**代码里没有任何程序化标志**

这是整件事**最关键的一条约束**。

grep 全仓：**没有** `SELF_HOSTED` / `IS_OFFICIAL` / `INSTANCE_MODE`。
只有若干"按约定"的迹象：

- `storage-quota.service.ts:28-34` 的注释已经承认了这件事：
  > "A self-hoster running this on their own disk has no reason to inherit
  > our hosted service's 100 MB budget"
- CORS 默认值指向官方 app（`config.ts:142`）——每个自托管实例都继承它
- ToS 由运营者放到 `<DATA_DIR>/legal/terms.html`，**镜像故意不发布它**
  （`server.ts:299-303` + `env.example:196-203`）

### 因此（硬约束）

> **付费闸门必须是一个"运营者显式开启"的开关，默认关。**
> 自托管默认**全放行**。

不能靠现成信号推断"这是官方实例"—— 那种推断会在自托管者身上误伤，
而"自托管免费"是本项目的立身之本（见 [`subscription-boundary.md`](subscription-boundary.md) §1）。

开关放 `config.ts loadConfigFromEnv`，**不要散落读 `process.env`**
（`sync.routes.ts:46` 已经因为这件事踩过一次）。

## 6. 测试：样板是哪一个（有个坑）

| | |
|---|---|
| 默认 | `pnpm --filter @heyta/sync-server test` —— PGlite（WASM Postgres），无需外部服务 |
| 集成 | `tests/integration/*.integration.spec.ts` 需真 Postgres（`DATABASE_URL`），缺则 `describe.skip` |
| ✅ **照这个写** | `server/tests/e2ee-upload-gate.routes.spec.ts` —— `Fastify()` + `register(routes,{prefix})` + `vi.mock('../src/auth')` + `app.inject()` |
| 🔴 **别照这个写** | `server/tests/sync.routes.spec.ts` —— **已被 `vitest.config.ts` exclude**，它用的是已废弃的 `initDb('./data', true)`，照抄会写出跑不到的测试 |

## 7. 审计：复用 `Logger.audit`，不要新造一套

```
server/src/logger.ts:73   Logger.audit(entry)
字段：event, userId, clientId?, opId?, entityType?, entityId?, errorCode?, reason?, ip?
```
现有事件：`USER_ACCOUNT_DELETED` / `USER_DATA_DELETED` / `RATE_LIMITED` /
`E2EE_REQUIRED` / `OP_REJECTED` …
订阅变更应加 `SUBSCRIPTION_CHANGED`、权益拒绝加 `ENTITLEMENT_DENIED`，**沿用同一形状**。

## 8. webhook 端点

新插件 `server/src/billing/webhook.routes.ts`，与 `apiRoutes` 并列注册
（`server.ts:488` 附近，`{ prefix: '/api/billing' }`）。

🔴 **不能套 `authenticate`** —— 调用方是支付商的机器，没有 JWT，改**验签**。
验签要**原始 body**，可照 `sync/sync.routes.ts:57 addContentTypeParser` 的
`parseAs: 'buffer'` 写法。

**幂等是硬要求**（目标里写了「重复回调不许重复授予」）：按支付商的 event id
建**唯一约束**，或仿 `sync/services/request-deduplication.service.ts`。

## 9. 落地顺序（建议）

| # | 动作 | 依赖 |
|---|---|---|
| 1 | **heyta 自己的法务文本**（运营主体 / 适用法律 / 退款政策） | 🔴 **你定**，不是编码 |
| 2 | 支付商选型 + 过两道门 + 登记 `THIRD_PARTY_LICENSES.md` | 等支付调研结论 |
| 3 | `Subscription` 表 + 迁移 | 无 |
| 4 | `entitlement.ts` 守卫 + 运营者开关（**默认关**） | 3 |
| 5 | webhook 端点 + 幂等 | 2, 3 |
| 6 | 客户端按权益表现（到期**不锁本地数据**） | 4 |
| 7 | 真实支付（测试模式）端到端门禁 | 5, 6 |
