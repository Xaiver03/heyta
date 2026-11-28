# ADR-0093：服务端 Agent run/session 持久化与断线续传（仅托管档）

- 状态：提议（Proposed）
- 日期：2026-11-28
- 适用范围：heyta（本地优先任务应用）的 AI 助手，**仅云托管档**（`hosting` 能力 + 托管模型代理）

## 背景

当前黑塔的对话式助手是**设备本地 loop**：循环在客户端跑、工具在本地执行、模型经 `packages/ai` 的唯一出境点 `invokeRouted` 调云端。会话历史只存在本机 `localStorage`。

这导致两个产品缺口：
1. **刷新/断线会丢运行**：一次多步 run 在设备切后台、断网或刷新后无法续上。
2. **无服务端 run/session 记录**：换设备、或想在服务端观察一次 run 的过程事件，都做不到。

对照参照系统：创业OS 与 WeKnora 都把 run/session/事件落服务端并可断点续传。黑塔要对齐其中**产品真正需要**的部分。

## 决策

新增**服务端**的 Agent run/session 持久化 + 断线续传能力，**仅对云托管档用户生效**；本地 / 自备端点模式仍走设备本地 loop，不落服务端。默认形态是云端托管、默认明文（见 AGENTS §0.1 与 ADR-0081），因此本决策不引入新的"加密前置"要求；是否 E2EE 由用户既有设置决定，E2EE 开启时不进入服务端 run 通道。

### 数据模型（新增四张表）

| 表 | 作用 | 关键列 |
|---|---|---|
| `agent_sessions` | 一段对话 | `id`(text) · `user_id` · `title?` · `created_at` · `updated_at` |
| `agent_messages` | 会话内的消息（含 user/assistant/tool 角色） | `id` · `session_id` · `role` · `content` · `seq` · `created_at`；`unique(session_id,seq)` |
| `agent_runs` | 一次用户发送触发的运行 | `id` · `session_id` · `status`(queued/running/completed/failed/cancelled) · `last_event_id` · `error?` · `created_at` · `finished_at?` |
| `agent_run_events` | run 的过程事件（用于断点续传） | `run_id` · `seq` · `type` · `payload`(jsonb) · `created_at`；主键 `(run_id,seq)` |

保留策略：会话/消息/事件按用户删除与账号删除级联；具体 TTL 与配额后续按 ADR-0054 的托管留存条款落地（本 ADR 只定形状，不定天数）。

### HTTP 接口（拟）

- `POST /api/ai/agent/sessions`：创建会话，返回 `sessionId`。
- `GET /api/ai/agent/sessions` / `GET /api/ai/agent/sessions/:id/messages`：读会话与消息（**仅本人**）。
- `POST /api/ai/agent/sessions/:id/runs`：发起一次 run（body: 用户文本/图片；仅托管档）。
- `GET /api/ai/agent/runs/:id/events?after=<seq>`：**断点续传**——返回 `seq > after` 的事件，支持 SSE。
- `POST /api/ai/agent/runs/:id/cancel`：取消 run。

权限：全部要求登录态且 `userId` 取自会话票据，**不取自请求体**；托管档校验复用 `entitlement`/`metering` 的 `ai` 能力。

### 断线续传语义

- run 的每个事件落 `agent_run_events` 并带单调 `seq`；`agent_runs.last_event_id` 记已产出的最大 `seq`。
- 客户端断线后带 `after=lastSeenSeq` 重连，服务端回放缺失事件，再继续实时推送。
- run 终态（completed/failed/cancelled）后保留事件供回放；会话转历史。

## 不做（超产品边界）

多智能体协作、沙箱执行、技能运行时：任务管理产品用不上，明确不做（用户 2026-11-28 决策）。

## 影响与风险

- 新增数据表与接口属**不可逆迁移层**，按 `docs/agents/db-migrations.md` 走 `migrate-deploy.sh`，本 ADR 只新增表、不改既有表。
- 仅托管档写入服务端；本地/自备端点模式行为不变、零数据上云。
- 实施分阶段：① 数据模型 + 迁移 + run 存储服务；② 路由 + SSE 续传；③ 客户端托管档接入；④ 取消与端到端测试。
