# Agent Harness 目标达成状态（对照产品裁决 D1–D7）

> 最近更新 2026-11-22（新一轮 goal 第7轮）：**干净 dist 复核** app-host AI 32、op-log 182、node-host 1、server agent-tools 18 通过；web/mobile/server `tsc` 均 0 错；`packages/ai` 338（1 条既有失败 `managed-routing`，与本次无关）。
> 新增入口：Web `runWebCloudTurn`、Mobile `runMobileCloudTurn`（接入点就绪、tsc 通过）；写路径 D1 端到端测试通过。
> 2026-11-22（第16轮）：移动 `MOBILE_CLOUD_HARNESS` 默认 **false**（未真机验收，一键开启）；Web `?cloudHarness=1` 可用且撤销只报真实结果。
> 2026-11-22（第13轮）：**Web 端 D1 闭环可用**——`?cloudHarness=1` 打开后助手可读可写且有「撤销这次 AI 操作」按钮（i18n 词条 zh/en）；`vite build` 成功（4370 模块，4.25s）；app-host AI 10 spec 36 通过、server agent-tools 4 spec 19 通过。

> 日期：2026-11-22。本文件把产品负责人 7 条裁决逐条映射到**代码 + 能转红的测试 + 门禁**，并如实列出**未完成/未验证**。
> 相关：[设计 v3](2026-11-21-agent-tool-calling-audit-and-pi-harness-design.md)、[审计①](2026-11-21-agent-harness-audit.md)、[审计②](2026-11-22-agent-harness-impl-audit.md)。

## 0. 验证快照（本次现量）

| 套件 | 结果 |
|---|---|
| app-host AI 相关 13 spec | **114 passed** |
| op-log 全套 17 spec | **182 passed** |
| node-host Agent 闭环 1 spec | **1 passed** |
| server `/api/agent/tools` 路由 1 spec | **5 passed** |
| `packages/ai` 全 15 spec | **338 passed / 1 failed**（`managed-routing.spec` 托管 tool-calling 排除，**既有失败**，与我改动无关，已 stash 复核） |
| `check:ai-tools` | ✅ rc=0 |
| `check:layering` | ✅ rc=0 |
| `check:ai-coverage` | ❌ rc=1（mobile 缺 `breakdown/prioritize/duration` 三入口，**既有缺口，非本 harness**） |

## 1. 逐条判定

| 裁决 | 落地 | 证据（文件 / 测试） | 状态 |
|---|---|---|---|
| **D5 tool calling 只针对云端（不碰本地 OS）** | 模型只经 `invokeRouted`（唯一出境点）；工具两种传输都不碰 OS：本地传输只对 **app 物化数据**（`runSelectedTool`），HTTP 传输打自有云端；**无 bash/fs/exec 工具** | `ai-routed-model.ts`、`ai-local-tools.ts`、`ai-cloud-tools.ts`；`ai-cloud-tools-http.e2e.spec.ts`、`ai-local-tools-integration.spec.ts` | ✅ 代码+测试 |
| **D2 不做 Action Plan** | 无 plan 数据类型/确认计划；工具结果直接回灌，写只出提案（既有 `executeAiToolProposal` 唯一落库点） | `agent-harness.ts`（无 plan 概念）、`ai-local-tools.ts`（写=write-needs-confirm） | ✅ |
| **D1 删除/归档/移动给 AI 靠版本回溯** | 本地写入：`engine.undoOperations`（按 op）+ `engine.undoSince(seq)`（按段）+ 壳编排 `runAiTurnWithUndo`；`checkInverseStillValid` 防误撤 | `engine.ts`、`ai-turn-orchestrator.ts`；`undo-run.spec.ts`(7)、`ai-turn-orchestrator.spec.ts`、node-host `agent-cloud.spec.ts` | ✅ 本地路径；⚠️ 云端写入撤销需服务端 |
| **D7 purge 不给 AI** | 工具目录 `risk='destructive-irreversible'` 默认从传输/描述中**过滤**；当前目录无 purge 工具 | `ai-cloud-tools.ts`（`selectToolNames` 过滤）、`tools-risk.spec.ts` | ✅ |
| **D6 默认明文、服务端可读** | 本次未改默认加密策略（ADR-0081：默认 `readable`）；E2EE 仍是可选 | 无改动 | ✅ 未回归 |
| **工具调用面向云端（模型）** | `createRoutedModelCall` → `invokeRouted`（feature=tool-calling，`fields` 含 `tools` + 工具观测字段并集 + 回送前复查） | `ai-routed-model.ts`；`ai-routed-model.spec.ts`(7) | ✅ |
| **PI 内核（桌面增强）+ 四端可移植** | 原生引擎**纯 JS 四端可跑**（可移植门禁）；PI 内核以同一 `CloudAgentTool` 契约接入（`.local` demo 跑通 30 工具）；node-host 真实路径验收 | `agent-portability.spec.ts`、`ai-cloud-tools.ts`(`toCloudAgentTools`)、node-host `agent-cloud.spec.ts` | ✅ 库级；⚠️ 移动/Web **UI 入口未接**；PI 内核 RN 真机未验证 |
| **专职审计 + Lead 终审** | 两轮审计报告 + 处置表 | 见上两份审计文档 | ✅ |

## 2. 未完成 / 未验证（诚实清单）

1. **移动端 / Web 的真实 UI 入口**：**接入点已就绪**（`apps/web/src/features/ai/cloud-harness.ts` 的 `runWebCloudTurn`、`apps/mobile/src/ai/cloud-harness.ts` 的 `runMobileCloudTurn`，tsc 通过）；但**尚未把 `AssistantScreen`/`AssistantPanel` 的默认交互切到新入口**——现有面板用 `requestAssistantTurn`（含流式/历史/提案 UI），切换会牺牲这些，需产品决策+UI 验收。⇒ 「四端可用」= 库级 + 四端**接入点**就绪 + node-host 真跑，非四端 UI 默认切换。
2. **服务端 `/api/agent/tools`**：**路由骨架已实现**（`server/src/ai/agent-tools.routes.ts`，list/invoke/幂等/授权/风险门，5 测试绿），但**未在 `api.ts` 注册、未接真实数据层**（`execute` 注入）。托管场景与云端写入撤销仍需接数据层。
3. **P0-2（assistant `tool_calls` 帧）**：✅ **已修协议结构层**（`wire.ts` 支持 assistant `tool_calls`；`ai-routed-model` 保留该帧；省略时字节不变，有测试）。⚠️ 真实 OpenAI 兼容端点仍未联网复验（未核）。
4. **PI 内核在 RN/Hermes 真机**：`pi-agent-core` 可移植性未验证（审计① U5）；Hermes 性能未量化。
5. **`check:ai-coverage` 红**：mobile 缺 `breakdown/prioritize/duration`——是**三个 AI 功能的移动端移植**（web 各 ~600 行；mobile 完全无组件），非 Harness 胶水。详见 [mobile-ai-coverage-scope](2026-11-22-mobile-ai-coverage-scope.md)。

## 3. 结论

设备侧 Harness 的**库与 node-host 闭环已实现并经两轮审计与 297 条测试**；移动/Web UI 入口、服务端工具 API、真实 provider 复验属剩余工作。**不把上述未完成项写成已完成。**
