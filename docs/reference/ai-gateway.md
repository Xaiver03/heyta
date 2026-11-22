# AI 接入网关（服务端产品层）

> 2026-11-22。客户端只经 `invokeRouted → 托管代理(/api/ai/managed/chat) → 网关` 调用；网关在服务端选上游。

## 组件
- `server/src/ai/ai-gateway.ts`：`GatewayUpstream`、`parseGatewayFromEnv`、`selectUpstream`、`redactUpstreams`。
- `server/src/ai/gateway-store.ts`：文件持久化（`AI_GATEWAY_FILE` 或 `dataDir/ai-gateway.json`，0600），文件优先/env 回退，`storePrimaryConfig()` 每请求现取（后台改完即生效）。
- `server/src/admin/ai-gateway.routes.ts`：`GET/PUT /api/admin/ai-gateway`、`POST /api/admin/ai-gateway/test`（`requireAdmin`）。
- 客户端管理面：`@heyta/app-host` `fetchAdminAiGateway/adminPutAiGateway/adminTestAiUpstream`；Web `/admin` 的「AI 网关」分区。

## 配置（两种方式，二选一）
### A. 管理后台（推荐）
`/admin` → 「AI 网关」→「新增上游」填 id/名称/baseUrl/模型/密钥 → 保存 →（可选）试连。

### B. 环境变量（多上游 JSON）
```jsonc
MANAGED_AI_UPSTREAMS='[
  {"id":"pp","label":"PP 网关","baseUrl":"https://<pp-host>/v1","modelId":"<model>","apiKey":"<key>","enabled":true,"priority":0,"weight":1},
  {"id":"deepseek","label":"DeepSeek","baseUrl":"https://api.deepseek.com/v1","modelId":"deepseek-chat","apiKey":"<key>","enabled":true,"priority":1}
]'
```
回退：单上游 `MANAGED_AI_UPSTREAM_BASE_URL / API_KEY / MODEL_ID`（旧行为，向后兼容）。

## PP 网关接入
PP 网关按**一条 OpenAI 兼容上游**接入（`id=pp`）。在后台或 `MANAGED_AI_UPSTREAMS` 里填它的 `baseUrl`/`modelId`/`apiKey` 即可；`baseUrl` 必须以 `https://`（试连与代理都只接受 https）。填入后「试连」应返回 ok，客户端下一发即走 PP。

## 安全
- `apiKey` 永不回显（列表脱敏 `hasApiKey`）；密钥只存 0600 文件、不进日志/响应。
- 选择：仅 `enabled`；priority 升、weight 降取第一条。无可用上游 → 代理如实 `not-configured`，绝不猜。

## 判据
- `server/tests/ai-gateway.spec.ts`（解析/选择/脱敏）、`ai-gateway.routes.spec.ts`（CRUD/试连/密钥沿用）、`managed-proxy.routes.spec.ts`（30 条，含按网关选上游不回归）。

## Harness 层周报/年终总结（零 C 端入口）
- `packages/app-host/src/ai-report-tools.ts`：`weekly_report` / `year_end_summary` 只读工具，本地聚合 `getState()`。
- Web `runWebCloudTurn` / 移动 `runMobileCloudTurn` 已传 `getReportState`（`useTaskStore.entities` / `host.getState()`）——助手可直接生成周报/年终，**无新增界面/按钮**。
- 出境：工具观测字段已列入 `egressFields`，未声明会被出境闸门拦下（有测试）。
