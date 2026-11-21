# Agent 工具调用能力审计 与 基于 PI 的 Agent Harness 设计（v3）

> 状态：**审计 + 设计（v3，已回填产品负责人 2026-11-21 全部裁决；仅剩技术性待办见 §7）**
> 日期：2026-11-21（v1 初稿；v2 回填 Action Plan/PI 本地/手机平板；v3 回填"加密不作为限制 + purge 不给 AI"）
> 取证方式：读仓库代码 + 跑现量门禁 + 实测 PI 包与源码。凡"实测"附可复跑命令；推断标【推测】，未读到标【未知】。
> 关联：[`ai-strategy.md`](ai-strategy.md)、[`../reference/ai-architecture.md`](../reference/ai-architecture.md)、[`trash-and-archive.md`](trash-and-archive.md)、ADR-0005/0011/0013/0035/0045/0082

---

## 0. 结论摘要

1. **heyta 的 tool calling 已有高质量骨架**：30 个工具（读 13 / 写 17）、规则优先零出境选址、多步只读循环、低风险写直接执行 / 高风险写提案 + 确认、逐字段出境披露闸门（现量：实体覆盖 9/11、目录 30 ≤ 79 席、界面端 web 4/5、mobile 1/5）。⚠️ **`check-ai-coverage` 当前 exit 1**（mobile 缺 `breakdown/prioritize/duration` 三个入口）——"被门禁钉住"只对已覆盖项成立，移动端入口仍红（见审计报告 §1-A8）。
2. **缺的是四类**：① 动作面（删除/归档/移动/重复/评论/附件/检索）；② 编排面（单工具、无工具检索、提案不持久、无跨进程幂等、无审计）；③ 平台面（桌面零 AI 入口、移动缺 3 个入口）；④ 元数据面（工具无 risk 字段，风险散在 app-host 的 switch）。
3. **本次裁决已改变三处结论**（见 §0.1）：**不做 Action Plan → 改用"版本回溯/撤销"**；**删除/归档/移动交给 AI**（靠可回溯兜底）；**PI 只在本地跑，但必须覆盖手机/平板**。
4. **"PI 本地 + 手机平板可用"这三件事不冲突**——这正是 v2 的核心技术发现：PI 里 **Node 强绑定的是"编码 CLI 那层壳"（`pi-coding-agent`），而 PI 的内核 `pi-agent-core` 是零 Node 依赖的纯 JS**，`pi-ai` 明确支持浏览器并自带 `streamProxy`（"给通过后端代理的应用"）。所以：**设备上跑 PI 内核（循环 + 工具），模型与工具都走云端**；服务器只承接"无状态的模型请求 + 工具 API 调用"，**不跑常驻 agent 会话**，因此**不存在"多会话把服务器撑爆"**。
5. **工具的目标是云端，不是设备本地资源**：harness 只注册"产品业务工具"（任务/清单/便签/打卡/专注/提醒/倒数日 + 删除/归档/移动），**不注册任何 `bash/read/write/文件系统` 工具**——PI 的"无权限系统"风险因此从根上消失。
6. **落盘已完成**：PI 源码在 `/Volumes/RocaSSD/reference/pi-src`（commit `780bf31fcaeb252fa9b68df3964c735eae75bde3`，2026-11-21），附 npm 1.6.0 产物与 `PI-REFERENCE-NOTES.md`。

---

## 0.1 产品负责人裁决回填（2026-11-21）

| # | 裁决原文（要点） | 对设计的后果 |
|---|---|---|
| D1 | **不需要 Action Plan**；删除/归档/移动可以交给 AI；"保留版本可以回溯就好了" | 写操作**直接执行**，不做前置确认；以 **op-log 版本回溯/撤销** 作为安全网（§5.6）。删除/归档/移动**进入工具目录**（§5.4）。 |
| D2 | **PI 做本地的**；"肯定得在本地，不然远端多会话并发会撑爆服务器" | **拒绝**服务端常驻 agent。harness 跑在设备上，服务器无状态（§5.2/§5.3）。 |
| D3 | **手机、平板都要能用** | PI **内核**（`pi-agent-core`+`pi-ai`）打进 App；不只桌面（§5.2/§5.8）。 |
| D4 | **用 SDK 就够了** | 走 SDK/库路线，不搞 RPC 子进程那套重壳（桌面可选 `pi-coding-agent` SDK；移动/Web 直接用 `pi-agent-core`）。 |
| D5 | **tool calling 只针对云端，不针对任何本地的东西** | 工具=云端工具 API；**不碰设备文件系统/本地进程**（§5.4/§5.9）。 |
| D6 | **任何事都绝对不能被加密限制住**；现在不打加密，加密只给 DIY 自托管；服务端必须读得到原文，否则管不了权限/状态 | 默认明文、服务端可读；E2EE 退出主线；AI 工具调用不受加密限制（§5.9）。 |
| D7 | **purge（彻底删除）不给 AI** | AI 只能软删进回收站；purge 不进工具目录（§5.4/§7）。 |

---

## 1. 审计范围与取证方法

| 维度 | 范围 | 取证 |
|---|---|---|
| 出站 | `packages/ai` | 读源码 + `node scripts/check-ai-coverage.mjs` |
| 入站 | `packages/local-api`（30 工具） | 读源码 + 解析生成清单 |
| 编排 | `packages/app-host/src/ai-{assistant,tool-call,tool-run,tool-selection}.ts` | 读源码 |
| 壳 | `apps/*` | grep 入口 + 门禁 |
| 撤销/回收站 | `packages/op-log/src/history.ts`、`docs/plans/trash-and-archive.md` | 读源码 |
| 参考实现 | SSOS `docs/plans/*` + `tools/user-cli` + `pi_supervisor.rs` | 子 Agent 通读 |
| PI 本体 | `@earendil-works/pi-coding-agent@1.6.0` + 参考盘源码 | 解包 + 读源码 + 静态可移植性检查 |

**现量命令**（2026-11-21 实跑）：
```bash
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
node scripts/check-ai-coverage.mjs
#   AiFeature: breakdown, prioritize, duration-estimate, tool-calling, inbound-automation
#   界面端覆盖：web 4/5；mobile 1/5
#   实体覆盖面 9/11（COMMENT=AI-COV-8、ATTACHMENT=AI-COV-9）
#   目录 30 个工具 ≤ 79 席（剩 49）
```

---

## 2. heyta 现有能力全景（事实，v1 已核，保持）

### 2.1 三层（两个信任方向 + 编排层）
- 出站 `packages/ai`：OpenAI 兼容、只产建议、egress 闸门 + 路由 + 熔断。
- 入站 `packages/local-api`：30 工具、MCP(HTTP+stdio)、写经 `LocalApiWritePort`。
- 编排 `packages/app-host`：`ai-tool-call.ts`（单步）、`ai-assistant.ts`（多步，994 行）。

### 2.2 工具目录：30 个（读 13 / 写 17），9/11 实体
`capability-manifest.generated.ts` 自动生成，`--check` 漂移即红。MCP 与内置 AI 共用一份目录（ADR-0035）。
明细（v1 §2.2 有全表；此处仅缺口）：**无任何 `delete_*/archive_*/move_*/reorder`；无重复规则/评论/附件/跨实体检索；checklist 只 append 不读。**

### 2.3 两条前端与硬顺序
`requestToolCall`（单步）/ `requestAssistantTurn`（多步）共用：**规则先跑（零出境）→ 才出境 → 严格校验 →（写）低风险直接执行档 / 高风险提案确认**。⚠️ 写**不再一律出提案**：`ai-tool-run.ts` 的"执行档"对 `aiToolProposalRequiresConfirmation()===false` 的低风险写直接 `confirmAiToolProposal → host.submit` 落库（`executeAiToolProposal`）；写路径有**两处**（AI 一处 + MCP 一处），都在 `LocalApiWritePort` 之后、都经 `dispatch()`，无绕过（审计 §2-D6）。上界：`MAX_ASSISTANT_TOOL_STEPS=6`、`MAX_ASSISTANT_MESSAGES=40`、`MAX_ASSISTANT_EGRESS_BYTES=200000`；单步文本 500 字；**一次只接受 1 个工具调用**。

### 2.4 出境闸门（heyta 的强项，保留）
`(功能,目的地)` 绑定授权；循环前一次性算字段并集披露；回送前复查"实际字段 ⊆ 已披露"；发前按真实 JSON 量字节；`tools` 名字也披露。

### 2.5 现有撤销/回收站底座（v2 关键）
- `packages/op-log/src/history.ts`：已有 `inverse?: OpIntent`、`undo()/redo()`、`HistoryState`、墓碑感知（`rawEntity` 含 tombstone）。**删除的反向 = `Update{deletedAt:null}`**，天然可还原。
- **限制（必须知道）**：`HISTORY_LIMIT=100`，且 **批量/快照 op 明确不可逆**（`skip('batch')` / `skip('snapshot')`）；撤销是"会话内便利"，不是审计。
- `docs/plans/trash-and-archive.md`：已定 **四态 alive/trashed/archived/purged** + 不变量 I1–I5；其中 **I5：归档不出现在任何出口（搜索 / AI 与 MCP 工具 / CLI）**。

### 2.6 壳覆盖（现量）
Web 完整（`AssistantPanel.tsx`）；mobile 有 `AssistantScreen.tsx`（tool-calling 可用，缺 3 个功能入口）；**桌面（Electron/原生）零 AI 入口**；`node-host` 只有 `cli-local-api/cli-mcp/cli-ai(仅密钥)`。

---

## 3. 覆盖度缺口（严格审计）

### 3.1 实体：9/11（`COMMENT`、`ATTACHMENT` 缺；AI-COV-8/9）
### 3.2 动作面（v2 已裁决：删除/归档/移动**要补**）
| 动作 | v1 现状 | v2 处置 |
|---|---|---|
| 删除（软删→回收站）/ 归档 / 移动清单 | ❌ 无 | **补工具**：`delete_task(s)`→trash、`archive_task(s)`、`move_task`；靠版本回溯兜底，不前置确认 |
| 彻底删除（purge） | ❌ | 默认**不给 AI**（不可逆，见 §7-①）；如给，仅单条 + 二次确认 |
| 重复规则 / 评论 / 附件 / 跨实体检索 | ❌ | 按产品优先级补；检索做成 `search_all` 工具 |
| checklist 读/删 | 只 append | 补 `get_task` 内返回 + `remove_checklist_item` |
### 3.3 编排面缺口
单工具（>1 拒绝）｜全量注入工具无检索｜提案不持久（**v2 取消提案，改直接执行 + 可回溯**）｜幂等仅进程内｜调用审计缺。
### 3.4 平台缺口
桌面零 AI 入口；mobile 缺 3 入口；无统一内核。
### 3.5 元数据缺口
`LocalApiTool` 无 `risk`；风险写在 `aiToolProposalRequiresConfirmation()` 的 switch ⇒ 加工具改两处。**✅ 已落地（2026-11-21，P0-3）**：`LocalApiTool` 加必填 `risk`（`read` / `write` / `destructive-reversible` / `destructive-irreversible`），30 个工具全部声明；`aiToolProposalRequiresConfirmation()` 先读目录 `risk`（`destructive-irreversible` 恒确认、`destructive-reversible` 直接执行、`write` 沿用动作级判定）；新增 `tests/tools-risk.spec.ts`（含"当前无 destructive 工具"的现状钉，新增删除/归档会红以提醒接回溯）。遗留：`write` 的动作级 switch 仍保留，迁到纯 risk 判定见 P1。

---

## 4. 对照 SSOS：抄什么、不抄什么（v2 修正）

| 维度 | SSOS | heyta v2 结论 |
|---|---|---|
| canonical manifest 单一事实源 | 343 工具，四通道投影 | ✅ 抄骨架（heyta 已同构，规模 30 合适） |
| 写确认 | 服务端持久 Action Plan | ❌ **不抄**（产品裁决 D1）；改用 **op-log 版本回溯** |
| 路由 | 授权发现 + loop + 软提示，禁意图枚举 | ✅ 抄：规则优先（heyta 更省出境）+ loop + 工具检索 |
| 风险元数据 | 命令层四档 | ✅ 抄：工具目录加 risk 字段 |
| 本地 Harness | PI（Node）仅桌面 | ⚠️ 抄"凭据/网关收口"契约；**不抄"仅桌面"**——heyta 要用 **PI 内核**覆盖手机平板（§5.2） |
| 审计/计量 | `ai_usage_events` + run trace | ✅ 抄：run trace + 计量 |
| 服务端持明文/持钥 | 是 | ❌ 不抄（heyta 本地优先/E2EE 边界，见 §5.9） |
| 客户端 `--yes` | 不用 | ✅ 也不做（v2 连 Action Plan 都不做，靠可回溯） |

**不抄 SSOS 的命令数量**（343/99 是财税法务域规模；heyta 30 个已接近合适）。

---

## 5. 基于 PI 的 heyta Agent Harness 设计（v2）

### 5.1 目标 / 非目标
**目标**
- 在**设备本地**跑一个真正会循环、会调工具的 agent；**桌面、手机、平板、Web 同一份内核**。
- 模型与工具**都走云端**（`streamProxy` → heyta 网关；工具 → 云端工具 API）。
- 写操作**直接执行 + 可回溯**；删除/归档/移动对 AI 开放。
- harness 不碰设备文件系统/本地进程，PI 的"无权限系统"风险消失。

**非目标**
- 不用 PI 的编码工具（`bash/edit/write/read/...`）。
- 不跑服务端常驻 agent（D2）。
- 不做设备端模型推理（沿用 ai-strategy §6）。

### 5.2 为什么"PI 本地 + 手机平板可用"成立（v2 核心，附证据）

| 问题 | 事实 | 证据 |
|---|---|---|
| PI 是不是只有 Node 能跑？ | **不是**。Node 强绑定的是**编码 CLI 壳**（`pi-coding-agent`，含 `bash`/TUI/打包 bundle）；**内核 `pi-agent-core` 零 Node 依赖** | 对**源码** `grep -rnE "process\\.|Buffer\\.|require\\(|node:|__dirname" packages/agent/src` = **0 命中**；依赖只有 `pi-ai` + `pi-schema`。⚠️ 参考盘是**源码检出、无 `dist`**，旧版命令 grep `dist` 是空判据（审计 §1-A11 已纠）。 |
| 模型层能跑浏览器/App 吗？ | 能。`pi-ai` 官方 "Browser Usage" 明写支持浏览器环境，provider 工厂 side-effect free；并**自带 `streamProxy`**（"Proxy stream function for apps that route LLM calls through a server"） | `pi-ai/README.md` §Browser Usage；`packages/agent/src/proxy.ts:108 export function streamProxy` |
| 手机端的流式能做吗？ | **模块已在，但未接线（不可声称"已做"）**：`streaming-fetch.ts` 用 XHR 增量 + 隐私闸门包装、`TextDecoder` 已有；但 `AssistantScreen.tsx` 的 runtime **没有传 `streamingFetch`**，`chat-controller.ts` 注释写"2026-11-21 真机 XHR 流式通道报错，暂不请求流式" | 审计 §1-A10 / §2-D1：`streaming-fetch.ts:46`「未接线」；`AssistantScreen.tsx:210-222` runtime 无该字段。⇒ 这是 P0 必修（要么接线并修 XHR，要么撤回断言） |
| 会被"并发撑爆服务器"吗？ | 不会。**设备本地跑循环**，服务器只承接**无状态的模型请求 + 工具 API 调用**，按 QPS 水平扩展；没有"每个用户一个常驻 agent 会话" | 架构层面（§5.3） |

> **结论**：PI 的"内核"是**可移植 JS**；把它打进 RN/Web 包，用 `streamProxy` 连 heyta 网关，用 `customTools` 接云端工具，就是"本地 harness、云端大脑与云端工具、四端统一"。**唯一需要实测的风险**是 Hermes 对 `pi-ai` 流式/`pi-schema` 的兼容与包体——列为 P0 spike（§6）。

### 5.3 分层架构（v2）

```
┌────────────────── 每一端（桌面 / 手机 / 平板 / Web）——设备本地 ──────────────────┐
│  heyta UI（共享 React / RN）                                                      │
│      ▲ AssistantPanel / AssistantScreen（同一套事件协议）                          │
│      │                                                                            │
│  PI 内核（设备内运行，不碰设备文件系统）                                           │
│      Agent({ initialState:{systemPrompt, model, tools}, streamFn })                │
│      · customTools = 云端业务工具（fetch → 云端工具 API）                          │
│      · streamFn    = streamProxy(model, ctx, { proxyUrl: heyta 网关, authToken })  │
│      · 事件 → heyta 的 AssistantStep / tool-started / tool-finished / 文本流      │
│      ▼                                                                            │
│  规则短路（heyta 保留）：本机可答的只读高频句，零请求直接答                        │
└───────────────────────────────────┬──────────────────────────────────────────────┘
                                     │ HTTPS（用户 token，短 TTL）
┌───────────────────────────────────▼──────────────────────────────────────────────┐
│  heyta 云端（无状态、可水平扩展；不跑常驻 agent）                                  │
│   ① AI 网关：/api/ai/...（OpenAI 兼容，streamProxy 落点；密钥/计量/限流在服务端）  │
│   ② 工具 API：/api/agent/tools/<name>（鉴权 → 校验 → 读/写 → 返回投影结果）        │
│   ③ 数据：sync（op-log 事件溯源）→ 版本回溯的数据基础                              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**关键点**：PI 在设备内，模型与工具在云端；PI 没有 key（`streamProxy` 用短 token）、没有文件系统工具。服务器上没有"agent 会话"这种东西，并发=普通 API QPS。

### 5.4 工具层：云端业务工具（含删除/归档/移动）+ 风险上收
- **工具来源**：云端 `/api/agent/tools` 返回 canonical 清单（name/description/schema/risk），与 `local-api` 目录同源生成（不复制）。
- **执行**：`customTools[i].execute` = `fetch('/api/agent/tools/<name>', {token, args})`；返回投影结果（沿用 Bear 范式的"可列举不可读正文"规则）。
- **新增工具（v2）**：`delete_task(s)`（软删→trash）、`archive_task(s)`、`move_task(taskId, projectId)`；`search_all`；`get_task` 补 checklist 读；`remove_checklist_item`。
- **归档不可见（已成立，不是待办）**：`archived` 由**动作层单一实现**过滤（`project-actions.ts` 的 `visibleProjects`/`listArchivedProjects`、`events.ts` 的 `aliveEvents`），出口全部走它（`local-api-host.ts`、`node-host/host.ts`），有测试钉着（`local-api-host.spec.ts`）。缺的只是一条"覆盖 local-api/MCP/CLI 三入口"的通用判据（P1）。`purged` 永久不可还原，默认不给 AI。
- **风险字段**：目录加 `risk: 'read' | 'write' | 'destructive-reversible' | 'destructive-irreversible'`；destructive-reversible（删/归档/移动）**AI 可直接做**，靠回溯；`destructive-irreversible`（purge）默认不给 AI。
- **命名空间**：业务工具裸名；将来接外部 MCP 用 `mcp__<server>__<tool>`。

### 5.5 路由层：规则短路 + PI loop + 工具检索
- **P0**：保留 `resolveToolSelection()` 的规则短路（零出境），未命中才进 PI loop。
- **P1**：工具数 > 12 时加 `search_tools` 元工具 + compact 目录（选中只注入 Top-K）；对齐 SSOS Phase C。
- **P2**：允许并行/串联多工具；写操作按"单实体 op"产出，便于回溯（见 §5.6）。

### 5.6 撤销与版本回溯（替代 Action Plan）

**产品规则**：AI 的写操作**直接执行**，不弹前置确认；给用户"刚才那次 AI 操作可以撤销/回滚"的能力。

实现分层（基于现有 op-log）：

| 场景 | 机制 | 现状 |
|---|---|---|
| 单条 create/update/move/delete | 现有 `undo()/redo()` + `inverse`（墓碑感知） | **已有**（`op-log/history.ts`），删除反向=`Update{deletedAt:null}` |
| 批量（AI 一次改多条） | ⚠️ 现有 `undo()` **明确不支持 batch**（`skip('batch')`）⇒ 用**按 runId 回滚到之前的 causal frontier / checkpoint**（`state.ts` 的 checkpoint restore + `sync/op-replay`） | **需补**：AI run 分组 + "撤销这次 AI 操作" |
| 删除/归档/移动 | 软操作（`deletedAt` / `archived` / `projectId`），全部一条 op、天然可还原 | 回收站四态已有计划/部分实现 |

**设计约束（写进规则，能判红）**：
1. **AI 的每次写必须打 `runId` 标记**；"撤销这次 AI 操作"= 回滚该 runId 覆盖的所有 op。
2. AI 产生的 op **优先单实体**（避免落入 `batch` 不可逆档）；确需批量时，必须走 checkpoint/frontier 回滚，不能假装 `undo()` 能撤。
3. `purge`（彻底删除）**不进 AI 工具**，除非单独裁决（§7-①）。
4. 界面回执：`已删除 3 个任务 · 撤销` / `已归档 · 查看版本`。

> 权衡（必须让产品知道）：**没有前置确认 + 只有事后回溯**，意味着"一次 AI 误操作在做完到用户点撤销之间是已生效的"。对个人任务管理可接受（可撤销）；对"不可逆"的 purge 不适用（所以不给 AI）。

### 5.7 模型接入：`streamProxy` → heyta 网关
- 设备端 `streamFn = streamProxy(model, ctx, { proxyUrl: heytaGateway, authToken })`；key 只在服务端。
- 用户自备端点（own）：`proxyUrl` 指向用户端点；仍不把厂商 key 留在 App（或用 `pi-ai` provider 直连 + 本地钥匙串，二选一，按供给模式）。
- **计量/限流/内容安全**在网关（照 SSOS 的 `ai-gateway-policy`）。
- **验收判据**：网关/用量记录出现这笔，不是"设备回了话"。

### 5.8 平台策略（v2：四端统一内核）

| 端 | 运行 | 说明 |
|---|---|---|
| 手机（iOS/Android，RN/Hermes） | `pi-agent-core` + `pi-ai(models 子入口)` | 复用现有 `streaming-fetch`（XHR）+ `consentFetch`；P0 spike 验证 Hermes 兼容与包体 |
| 平板 | 同手机 | 同上 |
| 桌面（Electron / node-host） | `pi-agent-core`（或 `pi-coding-agent` SDK） | 同内核；Node 无兼容问题 |
| Web | `pi-agent-core` + `pi-ai`（browser） | `pi-ai` 官方支持浏览器；`streamProxy` 连网关 |
| 原生桌面（macOS/Win/Linux） | 通过 node-host sidecar 或暂缓 | P2 |

**统一之处**：同一份 `customTools` 契约、同一 `streamProxy`、同一撤销模型；**差异只在"运行时如何提供 fetch/流式"**。

### 5.9 加密不作为限制（已裁决：默认明文、服务端可读）
- 产品原则（对齐 `AGENTS.md` §0.1）：**任何功能都不得被加密限制住**。默认形态 = 云端托管、默认公开、默认明文；**服务端读得到原文**，所以权限、状态、工具路由、审计、版本回溯都能在服务端做。
- **端到端加密不做主线**，只作为 DIY/自托管的可选加值；主线不为 E2EE 让路。
- 后果：AI 工具调用在主线（明文）账号上完整可用；E2EE 属自托管分支，不纳入本设计，也不允许它反过来约束主线。
- 这一裁决同时消掉了上一版"服务端读不到就没法做权限/状态管理"的疑问——正是选服务端可读的理由。

### 5.10 观测与审计
- 设备端 run trace：`runId`、每步 `toolName/args摘要/ok/耗时`、目的地、回滚点；落本机、可脱敏导出。
- 云端：`feature='tool-calling'` 用量；与 `runId` 关联。

### 5.11 风险与失败模式
| 风险 | 缓解 |
|---|---|
| Hermes 对 `pi-ai` 流式/`pi-schema` 不兼容 | P0 spike；不兼容则移动端沿用现 app-host 循环（两引擎一契约，见 §6 备选） |
| 包体变大（pi-ai 含 provider SDK） | 只 import `@earendil-works/pi-ai/models` + 单一 openai-compatible provider；不用 `providers/all`/`compat` |
| 无前置确认导致误操作 | 版本回溯 + 回执撤销；purge 不给 AI |
| 工具直连云端鉴权面 | 短 TTL token + 逐工具授权 + 服务端重校验 |
| "能答话≠接上了" | 验收看云端计量/审计 |

---

## 6. 落地计划（v2）与验收判据

### P0 — 可行性 spike（一周内）
1. **RN/Hermes spike**：把 `pi-agent-core` + `@earendil-works/pi-ai/models`（仅 openai-compatible）打进一个 RN 屏，用 `streamProxy` 连假网关，跑通"提示→文本流→一次 tool call→toolResult→再回答"。判据：真机 iOS/Android 全绿；包体增量记录在案。
2. **Browser spike**：Web 同款。
3. **结论**：兼容 ⇒ 四端同内核；不兼容 ⇒ 移动端保留 app-host 循环（**两引擎、一契约**：同一 customTools/协议/撤销模型）。
- **验收**：给出"兼容/不兼容 + 包体 + 流式是否可用"三项实测读数。

### P1 — 工具与云端 API 对齐
1. 云端 `/api/agent/tools`（canonical 清单 + invoke），与 `local-api` 目录同源生成。
2. 工具加 `risk` 字段；补 `delete/archive/move/search_all` 等（§5.4）。
3. 撤销：AI run 分组 + "撤销这次 AI 操作"（单条走 undo，批量走 checkpoint 回滚）。
- **验收**：删除/归档/移动可由 AI 执行且能一键回滚；`archived` 不出现在任何工具/搜索出口（trash I5 判据）；risk 缺失即红。

### P2 — 编排增强
工具检索/延迟加载（>12）；并行/串联；E2EE 边界按 §7-② 落地。

### P3 — 桌面入口 + 通道
桌面 Electron 接同一内核；CLI 投影（`heyta commands --json`）；移动端补 3 个功能入口。

---

## 7. 已裁决 / 仍待办

**已裁决（2026-11-21）**
- 不做 Action Plan；删除/归档/移动给 AI，靠 op-log 版本回溯兜底（D1）。
- **purge（彻底删除）不给 AI**（D7）。
- 加密不作为限制：默认明文、服务端可读；E2EE 只给 DIY 自托管（D6）。

**仍待（技术性，非产品）**
- P0 RN/Hermes spike 结论：决定"移动端同内核"还是"两引擎、一契约"（§6）。
- 工具检索阈值（建议工具数 > 12 触发延迟加载）。

---

## 8. 附录

### A. PI 可移植性证据（v2 关键）
```bash
cd /Volumes/RocaSSD/reference/pi-src
grep -rnE "process\.|Buffer\.|require\(|node:|__dirname" packages/agent/src | wc -l   # 0 命中（参考盘无 dist，须对 src）
node -e 'console.log(require("./packages/agent/package.json").dependencies)'   # 只有 pi-ai + pi-schema
grep -n "Browser Usage" packages/ai/README.md            # 官方支持浏览器
grep -n "export function streamProxy" packages/agent/src/proxy.ts   # :108
```
- `pi-coding-agent`（编码 CLI）才强绑 Node（`bash`/TUI/含 fd、rg 二进制、jiti 扩展）；**内核不绑**。

### B. 工具清单抽取脚本
（同 v1 附录 A；`node` 解析 `capability-manifest.generated.ts` 得 30 工具/实体分组。）

### C. PI 参考盘落盘记录
- `/Volumes/RocaSSD/reference/pi-src`（commit `780bf31fcaeb252fa9b68df3964c735eae75bde3`，2026-11-21）
- `/Volumes/RocaSSD/reference/pi-coding-agent-1.6.0.tgz`
- `/Volumes/RocaSSD/reference/PI-REFERENCE-NOTES.md`

### D. 事实 / 推测 / 未知
- **事实**：§2/§3 计数（可复跑）；§5.2 可移植性（源码实证）；§2.5 撤销底座（`op-log/history.ts`）；§2.6 壳覆盖（门禁）。
- **推测**：Device-local PI core 在 Hermes 的完整兼容性（需 P0 spike）。
- **未知**：`pi-ai` 打包进 RN 的最终包体；网关 `streamProxy` 协议与现有 `/api/ai/managed/chat` 的差异；E2EE 下工具方案的成本。
