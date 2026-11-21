# Agent Harness 设计 vs 代码现实 —— 审计报告

> 审计对象：`docs/plans/2026-11-21-agent-tool-calling-audit-and-pi-harness-design.md`（v3）
> 审计方式：只读代码 + 跑现量门禁（`node scripts/check-ai-coverage.mjs`）+ 静态读 PI 源码（`/Volumes/RocaSSD/reference/pi-src`）。
> 纪律：事实附 `file:line`；推断标【推断】；没读到标【未核】。全部行号为本轮现量。
> 日期：2026-11-21。

---

## 0. 结论摘要

1. **设计的骨架判断基本成立**（30 工具 / 9/11 / batch 不可 undo / risk 在 switch / 壳覆盖），但有 **4 处硬事实错误或过期**，其中 2 处会直接误导 P0 排期：
   - **「移动端已做流式并已传 `streamingFetch`」是错的**：模块存在但**未接线**，`runtime` 根本没传 `streamingFetch`，且代码注释写明「真机 XHR 流式通道报错，暂不请求流式」。
   - **「PI 内核零 Node 依赖：`grep packages/agent/dist` 0 命中」的证据是空判据**：参考盘是**纯源码检出，没有 `dist`**，grep 一个不存在的目录当然 0 命中。（结论本身**成立**——对 `packages/agent/src` 实测 0 处 Node 内置依赖——但引用的命令证不了它。）
   - **「写只出提案 + 唯一写点确认」已过期**：代码**早已有"执行档"对低风险写直接执行**（不再一律待确认）。
   - **门禁当前是红的**（`check-ai-coverage` exit 1，3 处 mobile 入口缺失），设计 §0 措辞「全部已实现并被门禁钉住」与现状不符。
2. **最该补的三件事**：① risk 上收到目录（删掉 switch 这第二处）；② AI run 分组 + checkpoint/frontier 回滚（现无 `runId` 任何痕迹）；③ RN/Hermes spike 必须先过 `streamProxy` 的 `response.body` 这道坎。
3. **`archived` 现已被所有出口排除**（不是设计要补的窟窿）：动作层单一实现 + 有测试钉着。设计把它列为"必须补"是**把已完成项误列为待办**。

---

## 1. 设计 v3 事实性断言 逐条对账

| # | 设计断言（§） | 判定 | 证据 / 说明 |
|---|---|---|---|
| A1 | 30 个工具（读 13 / 写 17）§0/§2.2 | ✅ 正确 | `packages/ai/src/capability-manifest.generated.ts` `tools` 数组 30 项；`kind:'read'` 13 项（`list_tasks/get_task/get_task_estimate_context/list_projects/list_habits/list_tags/list_notes/get_note/list_checkins/list_focuses/list_reminders/list_events/get_event`）。目录由 `packages/local-api/src/tools/registry.ts` 从各 pack 聚合。 |
| A2 | 实体覆盖 9/11（缺 COMMENT/ATTACHMENT）§0/§3.1 | ✅ 正确 | `capability-manifest.generated.ts` `coverage:{covered:9,denominator:11}`；`check-ai-coverage.mjs` 输出「实体覆盖面 9/11 … COMMENT=AI-COV-8、ATTACHMENT=AI-COV-9」。 |
| A3 | 目录 30 ≤ 79 席（剩 49）§0/§1 | ✅ 正确 | 79 = TASK 9 + 其余 10 实体 × 7。`shared.ts:101` `MAX_TOOLS_PER_ENTITY=7`；`shared.ts:109-111` `MAX_TOOLS_PER_ENTITY_BY_TYPE={TASK:9}`；`check-ai-coverage.mjs` §10（~`:1122-1133`）按分母累加 cap。门禁现量输出「30 个工具 ≤ 79 席（剩 49）」。 |
| A4 | `MAX_TOOLS_PER_ENTITY`（审计清单点名） | ✅ 存在，值 7 / TASK 9 | `packages/local-api/src/tools/shared.ts:101`（默认 7）、`:109-111`（TASK=9）。设计正文未写这个数值，建议补，避免读者把「79」当成拍的数。 |
| A5 | op-log undo 的 batch 不可逆（`skip('batch')`）§2.5 | ✅ 正确 | `packages/op-log/src/history.ts:155-157`：`hasTaskBatchMarker/hasTaskPriorityBatchMarker/hasTaskRepeatCompletionMarker ⇒ skip('batch')`；`:152` `multi-entity`；`:153` `snapshot`；`:99` `HISTORY_LIMIT=100`。 |
| A6 | 删除反向 = `Update{deletedAt:null}` §2.5/§5.6 | ✅ 正确 | `history.ts:194-201`（OpType.Delete → Update payload `{deletedAt:null}`）；前提 `checkInverseStillValid` `:226-240`（`deletedAt===entry.timestamp` 且未 `purgedAt`）。 |
| A7 | risk 无字段，风险散在 `aiToolProposalRequiresConfirmation()` switch §3.5 | ✅ 正确 | `shared.ts:28-58` `LocalApiTool` 只有 `name/description/kind/egressFields/defaultEnabled`，**无 `risk`**；风险判定在 `packages/app-host/src/ai-tool-run.ts:86-117` 的 `switch(proposal.intent.action)`。加工具确实要改两处（pack + 这个 switch）。 |
| A8 | 壳覆盖 web 4/5、mobile 1/5、桌面零 AI、node-host 仅 cli-local-api/mcp/ai(密钥) §2.6 | ✅ 基本正确，但**门禁是红的** | `check-ai-coverage.mjs` **exit 1**：mobile 缺 `requestBreakdown/requestPrioritize/requestDuration` 三个入口（对应 mobile 1/5）。web 无 AI 引用的桌面壳：`apps/desktop*/` grep 不到任何 `assistant/@heyta/ai/@heyta/app-host`（`apps/desktop/dist/*` 命中的是旧构建产物，非源）。node-host `cli-ai.ts` 只做 `key set/list/clear`（读 stdin、只进钥匙串）。**但 §0「全部已实现并被门禁钉住」措辞错**——门禁此刻 3 条红。 |
| A9 | 「写只出提案 + 唯一写点确认」§2.3 | ❌ **过期** | 代码已有「执行档」：`ai-tool-run.ts:86-117` 判定不需要确认的动作，`executeAiToolProposal()`（`:162-203`）**直接 `confirmAiToolProposal→host.submit` 落库**；单步 `ai-tool-call.ts:195-212 applyExecutionMode`、多步 `ai-assistant.ts:673-680 finishWrite` 都走这条。即：**低风险写已经"直接执行"，高风险写仍要确认**。设计 §2.3 应改为"低风险直接执行/高风险提案确认"，否则会让人以为没有自动执行路径。 |
| A10 | 移动端「已调 `requestAssistantTurn` 并传 `streamingFetch`」§5.2 | ❌ **错误/过期** | `apps/mobile/src/ai/streaming-fetch.ts:46`：「⚠️ 未接线：这份代码尚未接进生产路径」。`AssistantScreen.tsx:210-222` 构造的 `runtime`（传给 `controller.configure`）**没有 `streamingFetch` 字段**；`chat-controller.ts:519-521` 是 `...(runtime.streamingFetch === undefined ? {} : …)`，所以 `fetchImpl` 永远不出现。`chat-controller.ts`（~`:515`）注释：「2026-11-21：真机 XHR 流式通道报错，暂不请求流式」。测试 `apps/mobile/tests/ai-streaming-wiring.spec.ts:243` 是把 `streamingFetch` **直接塞进测试构造的 runtime**，绕过了壳的遗漏 ⇒ 测试绿、产品无流。 |
| A11 | PI 内核零 Node 依赖（`grep packages/agent/dist` 0 命中）§5.2/附录A | ⚠️ **结论真、证据假** | `/Volumes/RocaSSD/reference/pi-src/packages/agent/dist` **不存在**（参考盘是源码检出，无 build）；grep 不存在的目录=0 命中，是**永远通过的判据**。改对 `packages/agent/src` 实跑：`process.|Buffer.|require(|node:|__dirname` **0 处**，imports 仅 `pi-ai`+`pi-schema` ⇒ 结论**成立**。附录 A 的命令必须改指 `src`（或 npm tarball 的 dist）。 |
| A12 | pi-ai 支持浏览器 + side-effect free §5.2 | ✅ 正确（有条件） | `packages/ai/README.md:1689-1692`「Browser Usage … core entrypoint and provider factories are side-effect free」；`:1712` Bedrock 浏览器不支持、`:1713` OAuth 仅 Node、`:1781` 两模块 Node-only 不可进浏览器 bundle。⇒ 支持成立，但**不是无条件**：必须只 import `models` + 单 provider，避开 oauth/bedrock/cli（`packages/ai/src` 有 8 处 `node:` import，分布在 oauth/cli/bedrock/codex/provider-env 6 个文件）。 |
| A13 | `streamProxy` 在 `packages/agent/src/proxy.ts:108` §5.2/附录A | ✅ 正确，但**RN 有硬坎** | `proxy.ts:108 export function streamProxy`。其内部 `proxy.ts:148 fetch(...)` → `:163 response.body!.getReader()`，**依赖 `response.body` 是 `ReadableStream`**；RN 的 `fetch` body 为 `null`（`streaming-fetch.ts` 文件头已实测记录）。⇒ streamProxy **不能原样跑在 RN**，须用 XHR 增量 shim 或换 streamFn。 |
| A14 | `ai-assistant.ts` 994 行 §2.1 | ✅ 正确 | `wc -l = 994`。 |
| A15 | 上界 6/40/200000、单步文本 500、一次只接受 1 个工具调用 §2.3 | ✅ 正确 | `packages/ai/src/assistant-limits.ts:24/27/38`；`ai-tool-call.ts:70` `MAX_TOOL_CALL_TEXT_LENGTH=500`；`:138` `multiple-tool-calls`（>1 拒绝）。 |
| A16 | 出境闸门：循环前字段并集披露 + 回送前复查 ⊆ 已披露 + 发前量字节 §2.4 | ✅ 正确 | `ai-assistant.ts:137-145 assistantEgressFields()`（取自目录 `egressFields`）、`:660-661` 建 disclosed 集、`:850-855` 按序列化字节判上界、`:957-961` 实际字段 ⊆ 已披露否则 `egress-outside-disclosed-set`。 |
| A17 | `archived` 需在**所有出口**排除（I5）§5.4 | ⚠️ **已满足，被误列为待办** | 动作层单一实现：`project-actions.ts:237-242` `visibleProjects` 过滤 `isArchived`、`listArchivedProjects` 只含归档；出口全部走它：`local-api-host.ts:553-575`（`projectActions.listProjects()`）、`apps/node-host/src/host.ts:433`（同）。EVENT 同理：`packages/domain/src/events.ts:105-113 aliveEvents`（滤 `archivedAt`）、`event-actions.ts:404-409`、`local-api-host.ts:625-627`。测试钉着：`packages/app-host/tests/local-api-host.spec.ts:486-491`（归档清单不出现在 `listProjects`）。任务无 `archived` 概念。⇒ 现状**已排除**；缺的只是「一条覆盖全出口的门禁」而非实现。⚠️ `docs/plans/trash-and-archive.md` 问题 9 的文字（"出口层只滤 deletedAt"）是**旧描述**，与现状不符。 |

---

## 2. 现有代码缺陷与风险（证据 / 影响 / 修复 / 可失败判据）

### D1【P0】移动端流式"看起来接了、其实没接摊子"
- 证据：`streaming-fetch.ts:46`（未接线）；`AssistantScreen.tsx:210-222` runtime 无 `streamingFetch`；`chat-controller.ts:519-521` 条件展开；`chat-controller.ts`~`:515` 2026-11-21 注释；测试 `ai-streaming-wiring.spec.ts:243` 只测注入路径。
- 影响：设计 §5.2 据此断言"手机端流式已能做"，P0 spike 的起点假设错误；真机逐字能力实际为 0。
- 修复：要么在 `AssistantScreen` 的 runtime 里补 `streamingFetch`（并修 2026-11-21 的报错），要么把设计/门禁改成"未接线"并删除误导注释；两者择一。
- 判据：新增一条测试**从 `AssistantScreen` 组件渲染出发**断言 `configure` 收到的 runtime 含 `streamingFetch`（不是测试自造 runtime）。当前若把 `AssistantScreen` 里那行删掉，测试仍绿 ⇒ 说明现有判据无效，这条新测试删行必须转红。

### D2【P0】无 AI run 分组 / 无回滚点 / 无调用审计
- 证据：全仓 `grep runId` **0 命中**（packages/apps 都无）；`op-log/src/engine.ts:505-527` 只有 `undo/redo/historyState`；`history.ts:155-157` batch 被 skip；`state.ts` 的 `checkpoint` 是**崩溃恢复/加速**（`engine.ts:205-236 writeCheckpoint/maybeCheckpoint`，按 seq 定期写、非任意点回滚 API），**不是**设计 §5.6 设想的"按 runId 回滚到 frontier"。
- 影响：D1 裁决（写直接执行、靠事后回溯）**目前没有实现基础**——AI 一次多实体/批量写根本撤不回。
- 修复：给 `dispatch` 增加 `runId` 透传并随 op 落库；新增"按 runId 撤销"= 逆序重放该 run 的 op（单实体）或恢复该 run 起始 checkpoint（批量）。`state.ts` 需暴露"恢复某 checkpoint"的显式 API，不能只做内部恢复。
- 判据：构造一次 AI 批量写（≥2 实体），调"撤销这次 AI 操作"，断言两条 op 的净效果被抵消；把 `skip('batch')` 保留现状不改时该测试必须红。

### D3【P0】risk 元数据缺失，改一处漏一处
- 证据：`shared.ts:28-58` 无 `risk`；`ai-tool-run.ts:86-117` switch 派生需确认集合；`default: return false`（新动作默认**自动执行**）。
- 影响：新增 `delete_task` 等动作时，若忘改 switch，破坏性动作会**静默进入自动执行档**（默认 false），即"删除无需确认"——与 D1 意图相同但风险最高，且无任何编译/门禁拦截。
- 修复：`LocalApiTool` 加 `risk: 'read'|'write'|'destructive-reversible'|'destructive-irreversible'`；`aiToolProposalRequiresConfirmation` 改为读目录 `risk`（删掉 switch 的动作白名单）；manifest 生成器带上 `risk`。
- 判据：新增门禁"每个 write 工具必须有 risk 且 ∈ 枚举；purge 类若出现在目录必须 `destructive-irreversible` 且不自动执行"。删 `risk` 字段必须红。

### D4【P1】"撤销这次 AI 操作"没有 entry-group 语义，UI 无回执
- 证据：`history.ts` 栈是全局 undo/redo（`engine.ts:189-190 undoStack/redoStack`），没有"哪几条属于同一次 AI 发送"的分组；`ai-tool-run.ts` 的 `executionId` 只用于**进程内去重**（`autoExecutionRecords` WeakMap `:124,175-201`），不落 op。
- 影响：用户点"撤销刚才 AI 的删除"无法精确回滚那一批，只能逐条 undo 且遇 batch 直接 unsupported。
- 修复：`executionId`/`runId` 与 op 关联（见 D2）；UI 回执 `已删除 N 个 · 撤销` 绑定该 runId。
- 判据：一次 AI 发送后 `historyState()` 能按 runId 列出该 run 的 op 数；无 runId 关联时测试红。

### D5【P1】幂等与去重只在进程内，跨进程/跨端无保证
- 证据：`ai-tool-run.ts:124-126` 两个 `WeakMap`（`autoExecutionRecords` 上限 128 `:198-201`；`confirmationRecords`）。
- 影响：App 重启/重试/MCP 与内置 AI 并发时，同一意图可能重复落 op（重复建任务）。设计 §3.3 已点"幂等仅进程内"，但没给修复。
- 修复：服务端/op-log 侧引入 `idempotencyKey`（= runId+step）持久化去重；或至少在 op 上带上去重键并由 `dispatch` 检查。
- 判据：重启进程后重发同一 `executionId+intent`，断言只落 1 条 op。现状必红。

### D6【P1】写路径有两处（AI + MCP），但都在 `LocalApiWritePort` 之后，无绕过
- 证据：`scripts/check-ai-tools.mjs` 规则 9：全仓 `src` 写入口必须恰好是 `ai-tool-run.ts`（`confirmAiToolProposal` 内 1 次 `submit`，`:345`）与 MCP 的 `server.ts:612`（`executeTool` 1 次）；`ai-tool-selection.ts` 禁止 `.submit(`（`:121-130`）。
- 影响：**无缺陷**，但设计说"唯一写点"会被读成"全仓一处"，实际是**两处**（AI/MCP），都经 `host.submit → dispatch`。若新增第三个入口（如云端 `/api/agent/tools`）必须同步扩这张门禁表，否则规则 9 会误以为覆盖全部。
- 修复：文档澄清"AI 一处 + MCP 一处，且都在 WritePort 之后"；云端工具 API 落地时把它加进 `check-ai-tools` 的入口白名单。
- 判据：在 `ai-tool-selection.ts` 或新文件里写 `.submit(` ⇒ `check:ai-tools` 红（已具备）。

### D7【P1】`archived` 出口无专门门禁（实现已对，缺"能转红"的保护）
- 证据：见 A17；实现正确且有 `local-api-host.spec.ts:486-491` 一条测试。
- 影响：将来有人给 `listProjects` 换数据源或新加一个出口（云端工具 API）时，会静默泄漏归档项，而**没有一条"所有出口都不含 archived"的通用判据**。
- 修复：抽一个出口级不变量测试（对 project/event 的 local-api + MCP + CLI 三个入口各断言一次），并让"把原始表直接传入"也不出归档。
- 判据：把 `visibleProjects` 的 `!isArchived` 去掉，必须有多条测试转红（当前只有 1 条，需补 MCP/CLI 路）。

### D8【P2】`executionId` 缺省用递增匿名 id，回执无法对齐真实用户发送
- 证据：`ai-assistant.ts:668-670` `deps.executionId?.trim() || assistant-anonymous-${++counter}`。
- 影响：没有 executionId 的调用方（MCP/脚本）每次拿到新 id，去重失效（与 D5 同源）。
- 修复：把"一次用户发送"的 id 提升为必填契约，缺省应报错而非造新 id。
- 判据：不传 executionId 时断言拒绝或复用稳定键。

### D9【P2】桌面端零 AI 入口（设计已认，但要防止"补入口"时各端各写一套）
- 证据：`apps/desktop*` 无 `@heyta/ai/@heyta/app-host/assistant` 引用（`dist/*` 是旧产物）。
- 影响：四端统一内核前，桌面只能等 P3；若先给桌面单独写入口会与 web/mobile 分叉。
- 修复：按设计 P3 走同一内核，禁止桌面自建对话逻辑。
- 判据：新增桌面 AI 代码若 `import` 业务判断（非注入）⇒ `check:layering` 应红。

---

## 3. P0 / P1 / P2 修复清单（含文件 / 测试门禁 / 判据）

### P0（本周必修，挡设计与安全）
| ID | 改哪 | 加什么测试/门禁 | 判据（能因违规转红） |
|---|---|---|---|
| P0-1 | `apps/mobile/src/ai/AssistantScreen.tsx`（runtime 补 `streamingFetch`）或改文档/注释撤回"已接线" | 组件级测试：从 `AssistantScreen` 渲染断言 `configure` 收到 `streamingFetch` | 删掉 runtime 里该字段 ⇒ 测试红 |
| P0-2 | `packages/op-log`（`engine.ts`/`state.ts` 加 runId 透传 + 按 checkpoint 恢复 API）、`packages/app-host/src/ai-tool-run.ts`（executionId→runId 落 op） | 单测：一次 AI 批量写 → 撤销该 run → 2 条 op 净抵消 | 保留 `skip('batch')` 不改时测试红 |
| P0-3 | `packages/local-api/src/tools/shared.ts`（`LocalApiTool` 加 `risk`）、`packages/app-host/src/ai-tool-run.ts:86-117`（switch 改读 risk）、`scripts/gen-ai-capability-manifest.mjs`（带 risk） | 门禁：write 工具必须有 risk 且枚举合法；`destructive-irreversible` 不得自动执行 | 删 `risk` 或新增无 risk 的 write 工具 ⇒ 红 |
| P0-4 | 设计文档 §5.2/附录A（把 `packages/agent/dist` 改 `packages/agent/src`；§2.3 改"低风险直接执行"；§0 改"门禁当前红"） | doc 命令可复跑判据（`check:doc-command-claims` 若能覆盖） | 命令再对不存在目录 grep 时标记为无效证据 |

### P1（与 P0 同周期收尾）
| ID | 改哪 | 测试/门禁 | 判据 |
|---|---|---|---|
| P1-1 | AI run 回执与"撤销这次 AI 操作"（`apps/web`/`apps/mobile` 回执 + `historyState` 按 runId） | 端到端：点撤销 = 该 run 全撤 | 无 runId 关联 ⇒ 红 |
| P1-2 | 持久幂等键（op 上带 `idempotencyKey`，`dispatch` 去重） | 重启进程重发同 key 只落 1 op | 现状必红 |
| P1-3 | 出口级 archived 不变量测试（local-api / MCP / CLI 三入口） | 去 `!isArchived` ⇒ 多条红 | — |
| P1-4 | `check-ai-tools` 入口白名单加入未来云端 `/api/agent/tools` | 新入口绕过则红 | — |
| P1-5 | mobile 补 `requestBreakdown/Prioritize/Duration` 入口（或明确 `NO_UI_ENTRY` + 理由） | 使 `check-ai-coverage` 回绿 | 现状 exit 1 |

### P2（编排增强 / 平台）
| ID | 改哪 | 判据 |
|---|---|---|
| P2-1 | 工具检索 `search_tools` + compact 目录（≥12 工具，现已 30） | 注入超阈值工具时触发；未触发红 |
| P2-2 | `executionId` 提升为必填 | 缺省拒绝 |
| P2-3 | 桌面接同一内核（P3） | 桌面 AI 代码走 `check:layering` |

---

## 4. 设备端 `pi-agent-core` 可行性（静态审计）

**事实（源码实测）**
- `packages/agent/src` 对 `process./Buffer./require(/node:/__dirname` **0 命**；依赖仅 `@earendil-works/pi-ai` + `@earendil-works/pi-schema`（`packages/agent/package.json`）。
- `packages/agent/package.json`：`"type":"module"`（纯 ESM）、`engines.node >= 22.19.0`。
- `streamProxy`（`proxy.ts:108`）用 `fetch` + `response.body!.getReader()`（`:163`）+ `TextDecoder`（`:176`）读 SSE。

**RN/Hermes 具体风险点**
1. **`response.body === null`（最高危）**：RN 的 `fetch` 无 `ReadableStream`，`streamProxy` 的 `response.body!.getReader()` 会抛。必须：用 XHR 增量 shim（heyta 已有 `streaming-fetch.ts`，但**未接线**、且真机报错）或自写 streamFn。→ **spike 第一项**。
2. **ESM 打包**：`pi-agent-core` 是 ESM-only；Metro 默认可处理但需确认 `package.json exports`（`. → dist/index.js`）与 `"type":"module"` 在 Hermes 下不触发 CJS 互操作问题。→ spike。
3. **`engines.node>=22`**：npm 引擎是建议性，但说明作者未面向 RN 测试；Hermes 无 Node 内置模块（`packages/agent/src` 无依赖，风险低；`pi-ai` 有 8 处 `node:` 在 oauth/cli/bedrock/codex/provider-env，务必只 import `models` 子入口，勿 import `providers/all`/`oauth`/`bedrock-provider`）。
4. **`TextDecoder`**：RN 需 `fast-text-encoding`（`apps/mobile/index.js` 已装，`streaming-fetch.ts` 文件头记录）——可用。
5. **`AbortController`/`structuredClone`**：`agent.ts:185/522` 用 AbortController（RN 0.7x+ 有）；未见 `structuredClone` 于 agent/src（若下层 pi-ai 用需 polyfill）。→ 浅查。
6. **`pi-schema` 兼容**：`agent` 依赖 `pi-schema`；需确认其运行时无 Node 内置（本轮**未核** `packages/schema/src`）。
7. **包体**：`pi-ai` 含多 provider；只取 `models` + 单 openai-compatible provider 时增量待实测（本轮**未核**，`pi-ai/dist` 在参考盘不存在，无法从源码判 bundle 大小）。

**需 spike 验证的项（判据）**
- S1：RN 真机跑通 `streamProxy`（或替代 streamFn）「提示→文本流→1 次 tool call→toolResult→再回答」，**且 `response.body` 为空时有明确退化路径**。
- S2：Hermes 下 `pi-schema` 校验不崩；包体增量有读数（KB）。
- S3：iOS/Android 各一台真机全绿；记录首字延迟。

---

## 5. 未核 / 未知
- 【未核】`packages/schema/src` 的 Node 内置依赖（pi-schema 是否纯 JS）。
- 【未核】`pi-ai` 打包进 RN 的最终包体（参考盘无 dist；需 npm 1.6.0 tarball 解包实测）。
- 【未核】node-host CLI（task 相关）是否逐条走 `isArchived`/墓碑过滤（project 已核 `host.ts:433`；task 出口未逐条走）。
- 【推测】设计 §5.6「用 checkpoint 回滚」：现有 checkpoint 是定期恢复点（`engine.ts:198-236`），**是否可任取一点回放**需读 store 实现确认——本轮判为"需新增显式 API"。
- 【未知】云端 `/api/agent/tools` 的 streamProxy 协议与现有 `/api/ai/managed/chat` 差异（设计已列未知）。

---

## 6. 复跑命令（取证）
```bash
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
node scripts/check-ai-coverage.mjs            # exit 1：mobile 缺 3 入口；实体 9/11；目录 30≤79
grep -cE "^      'name': '" packages/ai/src/capability-manifest.generated.ts   # 30
grep -n "MAX_TOOLS_PER_ENTITY" packages/local-api/src/tools/shared.ts          # 7 / TASK 9
grep -n "skip('batch')\|HISTORY_LIMIT" packages/op-log/src/history.ts          # batch 不可撤
grep -n "aiToolProposalRequiresConfirmation" packages/app-host/src/ai-tool-run.ts
grep -rn "streamingFetch" apps/mobile/src/ai/AssistantScreen.tsx               # runtime 未含
cd /Volumes/RocaSSD/reference/pi-src
ls packages/agent/dist 2>&1                    # No such file or directory（附录A 证据失效）
grep -rnE "process\.|Buffer\.|require\(|node:|__dirname" packages/agent/src | wc -l   # 0
grep -n "export function streamProxy" packages/agent/src/proxy.ts             # :108
grep -n "Browser Usage" packages/ai/README.md                                  # :1689
```
