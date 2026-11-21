# Agent 工具 API（云端）— 契约

> 状态：**契约 + 服务端路由骨架已实现（`server/src/ai/agent-tools.routes.ts`，注入 execute；未在 api.ts 注册/接数据层）**。客户端半边已实现于 `packages/app-host/src/ai-cloud-tools.ts`（`createHttpCloudToolTransport` 按本契约发请求）。
> 依据：产品裁决 D5「tool calling 只针对云端」、D1「不做 Action Plan，删除/归档/移动给 AI 靠版本回溯」、D6「默认明文、服务端可读」。
> 日期：2026-11-21。

## 0. 为什么是"云端工具"

设备端 Agent（PI 内核 / heyta 原生循环）只负责**循环与渲染**；每次工具调用都是一次**服务端** HTTP 请求，服务端做鉴权、校验、落库、审计。设备不碰任务数据的本地库/文件系统。默认明文（服务端可读），所以服务端能执行工具、做权限与状态管理。

## 0.1 读写边界（关键设计，2026-11-22 定）

服务端**只提供只读工具**（`list_tasks/list_projects/list_notes`，从用户 op 归约状态执行）。
**写操作保持在设备本地路径**（`createLocalToolTransport` → 既有"提案→确认→自动执行"），
因为本仓是本地优先、**op 的唯一作者是设备**：服务端全仓只有 `operation-upload.service`
按客户端上传写 op，**从不自己造 op**。让服务端为某用户造 op 会引入"第二作者"与向量时钟/设备身份
冲突，破坏同步收敛。所以：
- `POST /api/agent/tools/<写工具名>` → **404 not-found**（只读目录里没有它），不是"执行成功"。
- 需要服务端写（如多端同一账号、纯服务端场景）是**独立决定**，必须先解决"服务端作为 op 作者"的同步语义。

## 1. 端点

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/api/agent/tools` | 列出**当前账号可用**的工具（canonical 清单） |
| `POST` | `/api/agent/tools/:name` | 执行一个工具 |

### 1.1 认证与授权

- `Authorization: Bearer <userAccessToken>`（短期）；**厂商模型 key 绝不下发**。
- 工具是否可见/可执行 = `account grants`（逐工具）**且** `risk !== destructive-irreversible`。
- **未授权即不可见**：`GET` 不返回未授权工具；`POST` 未授权返回 `403 not-granted`。
- 授权在**请求时**重新判定，不信任客户端传来的工具清单。

### 1.2 `GET /api/agent/tools` 响应

```jsonc
{
  "ok": true,
  "data": {
    "tools": [
      {
        "name": "list_tasks",
        "description": "给模型看的说明（与 local-api 目录同源生成）",
        "parameters": { "type": "object", "properties": { }, "additionalProperties": false },
        "risk": "read"
      }
    ]
  }
}
```

- 工具目录的**唯一事实源**仍是 `packages/local-api/src/tools/*`（服务端不另写一份；从同一份生成/校验）。
- 只返回已授权 + 非不可逆的工具。

### 1.3 `POST /api/agent/tools/:name` 请求/响应

请求：
```jsonc
{ "args": { /* 工具参数，JSON Schema 校验 */ } }
```
响应（成功 / 失败统一信封，客户端 `createHttpCloudToolTransport` 已按此解析）：
```jsonc
{ "ok": true, "data": { /* 投影结果；写操作返回 { applied: true, ... } */ } }
{ "ok": false, "reason": "invalid-args", "message": "可展示的一句话" }
```

## 2. 不变量（每条都要有能转红的判据）

1. **归档/墓碑不进任何出口**：`list_*` 结果必须不含 `archived`、`deletedAt`、`purgedAt` 的条目（沿用动作层的单一过滤实现，不在这里另写第二份）。
2. **只读投影、不泄正文**：列表工具不返回备注/正文等大字段；正文类字段只在单条读取且可读时返回（沿用 Bear 范式）。
3. **写操作走服务端权威路径**：服务端落库经其权威写入（op-log/同步），不由客户端直写；客户端只拿结果。
4. **风险档**：`destructive-irreversible`（purge）**不暴露**（D7）；`destructive-reversible`（删除→回收站/归档/移动）允许执行，回滚依赖服务端版本历史（D1）。
5. **幂等**：写请求带 `Idempotency-Key`（= `runId`（一次用户发送）`+ ":" + step`），服务端据此去重（重放返回同一结果），解决"跨进程/跨端重试重复落库"。
6. **不变量校验**：`risk` 必须在封闭词表；写工具缺 `risk` 拒绝注册。

## 3. 错误码（`reason` 封闭词表）

| reason | 含义 |
|---|---|
| `unauthorized` | 缺/失效 token（HTTP 401） |
| `not-granted` | 该工具未对当前账号授权（403） |
| `invalid-args` | 参数不满足 schema |
| `not-found` | 目标实体不存在 |
| `conflict` | 并发/状态冲突可重试 |
| `irreversible-blocked` | 该动作不可由 AI 执行（purge，403） |
| `rate-limited` | 触发限流（429，带 `retryAfterMs`） |
| `failed` | 其他可展示失败 |

## 3.5 已实现（路由骨架）

`server/src/ai/agent-tools.routes.ts` 的 `agentToolsRoutes`：GET 列表（按账号授权过滤 + 排除不可逆）、POST 执行（未授权 403 / 不可逆 403 / 未接执行器 501）、`Idempotency-Key` 去重、错误信封。判据：`server/tests/agent-tools.routes.spec.ts`（5）。⚠️ 尚未在 `server/src/api.ts` 注册、也尚未接真实服务端数据层（`execute` 注入）。

## 4. 实现顺序（下一步）

1. 服务端从 `packages/local-api` 的工具目录生成 `GET /api/agent/tools`（复用 `listAuthorizedTools` 的过滤逻辑，不复制目录）。
2. `POST /api/agent/tools/:name`：读工具 → 服务端 `runReadTool`/写权威路径；写加 `Idempotency-Key` 去重。
3. 门禁：`archived` 不出现在任何 list 出口；purge 不可调用；risk 缺失/非法即红。
4. 客户端把 `toCloudAgentTools(transport, grants)` 注入 PI 内核 / 原生循环，替换本地工具源。

> 注：服务端当前只有同步/账户/计费路由，**尚无逐实体业务 REST**；本 API 需要服务端从 op-log/物化状态执行工具。这条工作量单独评估（见设计文档 §7 待办）。

## 5. 幂等键（客户端已实现）

写请求的 `Idempotency-Key` 已由客户端落实：`createHttpCloudToolTransport` 对带 `idempotencyKey` 的调用发送 `Idempotency-Key` 头；`runCloudAgentTurn`/`requestCloudAssistantTurn` 在传入 `runId` 时按 `runId:s<step>:<callId>` 生成（PI 内核路径以 `toolCallId` 作键）。测试：`ai-cloud-tools-http.e2e.spec.ts` 断言了真实线上的头值。
