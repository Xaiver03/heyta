# Agent Harness 交接（Handoff）

> 2026-11-22。状态矩阵见 [status](2026-11-22-agent-harness-status.md)。本文件只给"下一步怎么接"与"不要踩的线"。

## 1. 已完成（设备侧库 + node-host 闭环 + 服务端路由骨架）

- **契约**：`CloudToolTransport`（`ai-cloud-tools.ts`）；`AiToolRunOutcome` 映射（`ai-local-tools.ts`）。
- **两传输**：`createLocalToolTransport`（本地 app 数据读；写=write-needs-confirm）/ `createHttpCloudToolTransport`（云端 HTTP；真 HTTP e2e 已验证，带 `Idempotency-Key`）。
- **循环**：`runCloudAgentTurn`（多步/有界/失败回灌；纯 JS 四端可跑，有可移植门禁）。
- **模型**：`createRoutedModelCall` → `invokeRouted`（出境闸门；fields = 文本+工具名+工具观测字段并集+回送前复查）。
- **整机**：`requestCloudAssistantTurn`；**壳编排** `runAiTurnWithUndo`（seq→一轮→可撤销）。
- **PI 内核**：`toCloudAgentTools` 产出 `customTools`（`.local` demo 用真实 30 工具目录跑通）。
- **撤销**：op-log `undoOperations(opIds)` + `currentLocalSeq()`/`undoSince(seq)`（D1 本地回溯闭环）。
- **node-host 落点**：`apps/node-host/src/agent-cloud.ts` 真实 SQLite 闭环验收。
- **服务端路由骨架**：`server/src/ai/agent-tools.routes.ts`（list/invoke/幂等/授权/风险门；5 测试）。
- **审计**：三轮审计报告 + 处置表；P0-1（出境披露）/P0-2（assistant tool_calls 帧）已修。

测试命令（现量 640 通过）：
```
(cd packages/ai && npx vitest run)                      # 338 pass（managed-routing 1 既有失败，无关）
(cd packages/app-host && npx vitest run tests/agent-harness.spec.ts tests/ai-*.spec.ts tests/agent-portability.spec.ts)  # 114
(cd packages/op-log && npx vitest run)                   # 182
(cd apps/node-host && npx vitest run tests/agent-cloud.spec.ts)   # 1
(cd server && npx vitest run tests/agent-tools.routes.spec.ts)    # 5
node scripts/check-ai-tools.mjs && node scripts/check-layering.mjs
```

## 1.5 最终裁决（2026-11-22）

写走设备端、服务端只读（见 status §1.5）。本 Harness 主体已交付；剩余为 UI 真机/浏览器验收与（可选）默认开启开关。

## 2. 未完成（按优先级）

1. **服务端数据层接入**（`agent-tools-api.md` §4）：把 `agentToolsRoutes` 在 `server/src/api.ts` 注册（加 `{preHandler: authenticate}`），并把 `catalog` / `resolveGrants` / `execute` 接到真实服务端数据层。
   - `catalog` 应由唯一事实源 `@heyta/local-api` 生成（勿手抄）；服务端若无法依赖该包，需一个生成步骤产出静态目录。
   - `execute` 需服务端能从 op-log/物化状态读并写（当前服务端无逐实体业务 REST，属大工程）。
2. **移动/Web 真实 UI 入口**：`runAiTurnWithUndo` + `createLocalToolTransport`（或 HTTP）已就绪；在 `apps/mobile`(`AssistantScreen`) / `apps/web` 注入即可。注意：`apps/mobile` 正被另一会话改动，动它前先 `git status` + 协调。
3. **真实 provider 复验**（P0-2 的"未核"）：用真实/自建 OpenAI 兼容端点跑一次**两步**工具调用，确认 `assistant.tool_calls` + `tool` 帧序列被接受。
4. **PI 内核 RN/Hermes 真机**：`pi-agent-core` 可移植性未验证；当前移动端用原生引擎兜底。

## 3. 不要踩的线

- 写操作**只能**经唯一落库点（本地 `confirmAiToolProposal` / 服务端权威写入）；传输层**绝不**静默写（本地传输写=write-needs-confirm）。
- `purge`（`destructive-irreversible`）**不暴露**给 AI。
- 出境：模型请求 `fields` 必须含 `tools` + 本轮可达工具观测字段并集；回送前必须复查 actual⊆disclosed。
- 单写者：只提交自己的文件；`apps/landing`、`apps/mobile/src/screens/WelcomeScreen.tsx`、`packages/design-system/*`、`apps/web/src/components/*` 属另一会话，勿动。
- 不 bump `CURRENT_SCHEMA_VERSION`；不改 `AGENTS.md`/ADR 规则。
