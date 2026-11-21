# Agent Harness 新增实现审计（第三轮 · 聚焦「最近新增」）

> 审计对象：`git log --oneline -8` 那批（`ebebeba7` / `c3f871c0` / `8751daee` / `ca1ca6d3` / `d036f42b` / `18e1462f` / `f2f59dad`）新增/改动的代码：
> `packages/app-host/src/{ai-local-tools,ai-turn-orchestrator,ai-cloud-tools,agent-harness,ai-routed-model,ai-cloud-assistant,ai-tool-run,ai-tool-call,ai-run-ledger}.ts`、
> `packages/op-log/src/engine.ts`（`undoSince`/`currentLocalSeq`/`undoOperationsLocked`）、
> `apps/node-host/src/agent-cloud.ts`、及其 spec。
> 性质：**只读审计，不改产品代码**。每条标注「事实 / 推断 / 未核」。
> 方法：全文阅读上述文件 + 追踪调用点（`grep` 全仓，排除 `dist`）。**未跑测试**：本机 `node_modules` 里没有可直接执行的 `vitest` bin（只有 `.pnpm` 下多版本包，无顶层可执行文件），故所有「测试是否会红」的判断都是**读断言内容得出**，标为「未核（未实跑）」。
> 重要前提（事实）：`runAiTurnWithUndo`、`undoLastAiTurn`、`createNodeAgentToolTransport` 在**产品代码里零调用点**（全仓 grep 只命中 `index.ts` 导出与测试）。所以本轮大部分缺陷目前是 **latent（未接线）**，尚未在真实壳里触达；风险评级按「一旦接线即生效」评估。

---

## 0. 已核对、符合预期的点（先说好消息）

- **本地传输的出境复查确实覆盖本地路径（Q1）**：`requestCloudAssistantTurn` 用 `toCloudToolDescriptors(deps.grants)`（`ai-cloud-assistant.ts:58`），该函数给每个描述符带 `egressFields`（`ai-cloud-tools.ts:204`）；`createRoutedModelCall` 的 `disclosedFields()` 把这些 `egressFields` 并入 `fields`（`ai-routed-model.ts:111-116`）并在每步发送前 `assertToolObservationsDisclosed()` 复查「实际字段 ⊆ 已披露」（`:119-135`、`:155-156`）。本地传输只是替换 `transport`，模型调用仍走同一 `createRoutedModelCall`，**未被旁路**（事实，读码得出）。
- **本地传输不做任何写库**：`createLocalToolTransport.invoke` 只调 `runSelectedTool`（`ai-local-tools.ts:55-64`）；`runSelectedTool` 对只读返回 `observation`、对**所有**写只返回 `proposal`（`ai-tool-run.ts:309-327`），从不调用 `host.submit`；唯一写入口仍是 `confirmAiToolProposal` 内的 `host.submit(proposal.intent)`（`ai-tool-run.ts:359`）。集成测试也断言「写后 list_tasks 仍为空」（`ai-local-tools-integration.spec.ts:84-88`）（事实）。
- **seq 边界正确（Q2 一部分）**：`getOpsSince` 用 `lowerOpen:true`（`db-op-log-store.ts:293`，契约 `op-log-store.ts:125` 注明「含下界、不含上界」），即严格 `seq > sinceSeq`；`currentLocalSeq()` 取 `getLastLocalSeq`（末条已分配 seq，`engine.ts:612-614`）。所以 `undoSince(seqBefore)` 不会误撤 `seq==seqBefore` 那条（事实）。
- **幂等键贯通**：`runId` 作为工具调用幂等键前缀 `runId:s<step>:<callId>`（`agent-harness.ts:148-155`），`runAiTurnWithUndo` 把 `runId` 透传给 `requestCloudAssistantTurn`（`ai-turn-orchestrator.ts:55`）（事实）。

---

## 重点问题结论（对应你的 5 问）

| # | 结论 |
|---|---|
| Q1 安全/出境 | **覆盖**：本地工具经 `toCloudToolDescriptors`（带 `egressFields`）+ 同一 `createRoutedModelCall` 复查，未发现旁路发送通道。**但复查本身有两处弱化**（P1-5）：① 用「本轮全部可达工具的字段**并集**」，会掩盖单工具少报；② `collectFieldNames` 只递归两层（`ai-routed-model.ts:95-108`），更深的嵌套字段检不到。属兜底弱化，静态测试 `tool-egress-fields.spec` 仍在（未核是否进 CI）。 |
| Q2 正确性 | 边界（含/不含）**正确**；**但** `undoSince` 是「段撤销」不是「按 run 撤销」，会撤销窗口内**所有本地 op**（含用户同时编辑、后续确认的写）；`limit=1000` 且升序取**最老** 1000（P1-3）；中途抛错会丢失 `seqBefore`（P1-2）。详见 P1-1/2/3/4。 |
| Q3 落库边界 | 写经本地传输**绝对不落库**（事实，唯一写点在 `confirmAiToolProposal`）。`createLocalApiHost` **不是每次 invoke 新建**，而是每次 `createNodeAgentToolTransport`（即每次造 transport）新建一次（`agent-cloud.ts:30`），无 I/O、成本小；但传了 `isReadable:()=>true`（P2-2）。 |
| Q4 测试价值 | 部分能红、部分不能：`toolRunToCloudResult` 映射测试能红，但 **`executed` 分支无测试**；integration 用**脚本化 `callModel`**（`ai-local-tools-integration.spec.ts:59`）**绕过了** `createRoutedModelCall` 出境复查；`agent-cloud.spec` 的「撤销」测的是**手动 addTask** 而非 AI 写（因本地传输本就不写）；`toCloudToolDescriptors` 的 `egressFields` **无断言**。详见 P2-6。 |
| Q5 一致性 | `executed` 分支**当前不可达**（本地传输用 `runSelectedTool`，永不产 `executed`；`executed` 只由 `ai-tool-call.ts:201-214` 的 `requestToolCall`+executionId 路径产生）。因此「写看起来成功绕开确认」**在现有接线下不成立**（事实）。但 `toolRunToCloudResult` 的 `executed→ok:true` **不检查 `run.result.ok`**（P2-1），纯映射契约埋雷。 |

---

## P0（阻断级）

### P0-1 【第二轮 P0-2 仍未修】回送真实 provider 的消息序列缺 `assistant(toolCalls)` 帧

- **事实**：`ai-routed-model.ts:65-70` 仍写 `if (m.toolCalls !== undefined && m.toolCalls.length > 0) continue;` —— 带工具调用的 assistant 帧整条丢弃（连其中的 `text` 一并丢）。
- **推理链（含推断）**：`runCloudAgentTurn` 内部消息序列是 `assistant(text, toolCalls)`（`agent-harness.ts:140`）+ 若干 `tool` 帧（`:170`）；`harnessMessagesToChat` 把 assistant(toolCalls) 丢掉后，实际发出去的是 `[system, user, tool...]`。按 OpenAI 兼容协议，`role:'tool'` 前必须有 id 匹配的 `assistant.tool_calls` 帧，否则 400（**推断，未接真实端点实测=未核**）。
- **影响**：只要本轮发生任意一次工具调用，第二步模型调用即失败 → `callModel` 抛错（`ai-routed-model.ts:169`）→ 整轮失败。**本地工具传输的三步路径（读→回灌→再答）在真实 provider 上等于不可用**；只有「不调工具」的单轮可用。这一点比第三轮其它问题更硬，且是本地传输能用起来的前提。
- **同类但不同因**：`ai-assistant.ts` 也这么丢（与「同构」注释一致），但两处共享同一缺陷，不能以「一致」当正确。
- **修复**：`harnessMessagesToChat` 保留带 `toolCalls` 的 assistant 帧（OpenAI 形 `{role:'assistant',content,tool_calls:[{id,type:'function',function:{name,arguments}}]}`，`tool` 帧带 `tool_call_id`）；补一条「对会校验该结构的 mock HTTP provider 跑两步」的 e2e。现有 `ai-routed-model.spec.ts:110` 断言 `['system','user','tool',...]`，修好后要一并更新。
- **可失败判据**：mock provider 在「tool 帧前无 assistant.tool_calls」时返回 400；当前实现应 400，修后 200。

> 说明：若第三轮认为此条超出「最近新增」范围，请保留为「存量未修」P0 跟踪，不降级 —— 因为它直接决定本轮新增的本地传输闭环可用性。

---

## P1（严重：安全面 / 正确性 / 契约）

### P1-1 「撤销这次 AI 操作」实为「撤销一个 seq 段」，会越权撤销非 AI 写入

- **事实**：`undoLastAiTurn` 直接 `undoSince(seqBefore)`（`ai-turn-orchestrator.ts:63-67`）；`undoSince` 取 `seqBefore` 之后**全部本地 op**（`engine.ts:621-629`），只按 `clientId` 过滤掉远端，**不区分「AI 写的」与「用户在此期间手动写的」**。
- **影响**：用户点「撤销这次 AI 操作」时，若自 `seqBefore` 以来用户自己也手动改过任务、或 AI 之外的低风险自动写落过库，这些都会被一并撤掉。窗口越宽（AI 轮次越慢）越明显。
- **对照既有正确实现**：仓库本已有更精确的「按 run 撤销」素材 —— `ai-run-ledger` 按 `executionId` 归集本次写入（`ai-run-ledger.ts:41-72`），引擎也有 `undoOperations(opIds)` 整批撤销（`engine.ts:598-609`）。`undoSince` 是更粗的兜底。
- **修复建议**：优先用 `aiRunWrites(host, runId)` → 取 opId 列表 → `engine.undoOperations(opIds)`；`undoSince` 仅作为「拿不到 ledger 时」的降级，并在回执里明说「将撤销 X 分钟内你在这台设备上的所有本地改动」。

### P1-2 中途抛错丢失 `seqBefore`：已发生的部分写入无法被编排层撤销

- **事实**：`runAiTurnWithUndo` 先 `seqBefore = await getSeq()`，再 `await requestCloudAssistantTurn(...)`（`ai-turn-orchestrator.ts:54-55`）；若后者抛错（模型 400 / 网络 / 出境复查 `egress-outside-disclosed-set` / maxSteps 之外的异常），**函数直接抛出，`seqBefore` 从未返回**。
- **影响**：一个调用方 `try{...}catch{}` 后无法得知该段 seq，也就无法 `undoSince` 清掉「抛错前已经落库的部分写入」（例如前几步确认卡已提交、最后一步模型失败）。这些写入成为孤儿。
- **补充**：你说担心的「误导调用方去 undo 一段空/别人写的东西」——**直接路径不成立**（seqBefore 没返回，调用方拿不到）。真实风险是相反方向：**漏撤**（部分写入无人撤销），以及「调用方复用了上一轮 seqBefore 再撤一次」这种调用方自身 bug 会被放大。
- **修复建议**：`runAiTurnWithUndo` 用 `try/catch`，把 `seqBefore`（和 `runId`）挂到 error 上再抛，或改成返回判别联合 `{ok:true,turn,seqBefore}|{ok:false,seqBefore,error}`，让壳在失败时也能撤销本段。

### P1-3 `getOpsSince(...,1000)` 静默截断：取的是最老 1000 条，窗口大时「撤错/漏撤」

- **事实**：`undoSince` 用 `getOpsSince(fromSeqExclusive, 1000)`（`engine.ts:623`）；`getAllOps` 先合并热/归档、`sort(seq asc)` 再 `slice(0, limit)`（`db-op-log-store.ts:337-347`）。即返回**窗口内最老的 1000 条**，而不是最新的。`clientId` 过滤在 limit **之后**才做（`engine.ts:624-626`）。
- **影响**：当 `seqBefore..now` 之间本地 op 超过 1000（大导入、长时间未撤销后的批量写）时：① 最新的写入被切掉、不会被撤销；② 反而先撤掉最老的——用户以为撤的是「刚才那次 AI」，实际撤了更早的段；③ 窗口内若有大量远端 op 先占满 1000 槽，本地可撤条数进一步缩水。全程无任何提示。
- **修复建议**：改为「按 seq 倒序取最近 N 条」或在回执里报告「本段共 M 条，仅撤销了 N 条（上限 1000），剩余未撤销」，不要静默。

### P1-4 ledger 用 `executionId`、undo 用 `seq`，两套键未打通

- **事实**：`recordAiRunWrite(host, id, proposal)` 的 `id` 来自 `executeAiToolProposal(host, proposal, executionId, ...)`（`ai-tool-run.ts:171-205`）；`executionId` 由 `requestToolCall` 的 `deps.executionId` 提供（`ai-tool-call.ts:201-203`）。而 `runAiTurnWithUndo` 只透传 `runId`，`CloudAssistantTurnDeps` 里**没有 `executionId` 字段**（`ai-cloud-assistant.ts:30-43`），本地传输也**不调** `executeAiToolProposal`。
- **影响**：新编排路径既写不进 ledger（本地传输全是 proposal，不自动执行），也没有 `runId↔executionId` 对齐，于是 P1-1 建议的「按 run 撤销」在这条路径上目前**无数据可用**。文档说的「runId 兼幂等键」只是幂等键，不是账本键，二者名字像但不是一回事。
- **修复建议**：明确一条路径：要么 `runAiTurnWithUndo` 同时生成 `runId` 并作为 `executionId` 下传，让 ledger 记到同一个 run；要么在回执契约里写清「本地传输路径不做自动写，因此不产生 run 账本」。

### P1-5 出境复查的运行时兜底被「并集」与「两层递归」弱化

- **事实（并集掩盖单工具）**：`disclosedFields` 把**本轮可达工具的所有** `egressFields` 并成一个集合（`ai-routed-model.ts:111-116`）；`assertToolObservationsDisclosed` 只判「实际字段 ∈ 这个并集」（`:130`）。于是若 `get_task` 声明了 `body`、而 `list_tasks` 没声明 `body`，一旦 `list_tasks` 的投影意外带上 `body`，**运行时复查不会拦**（`body` 已在并集里）。「每个工具只出境自己声明的字段」这条承诺，运行时并未守住。
- **事实（深度）**：`collectFieldNames` 只把对象第一层键、以及值仍为对象的第二层键加入集合（`ai-routed-model.ts:95-108`）；三层及以上嵌套里出现的字段不会被收集，因而永不参与比对。
- **缓解（未核）**：静态测试 `packages/local-api/tests/tool-egress-fields.spec.ts:155` 有一组「声明==真实投影」的比对，若它在 CI 里跑，单工具级失真会被静态拦住；但运行时这层兜底本身是弱化的，一旦静态测试漏跑/漏改，线上不会红。
- **修复建议**：复查改为「按**实际调用的那个工具**的 `egressFields`」比对（把 `call.name` 连同结果一起判断），而不是整轮并集；`collectFieldNames` 递归到全深度（或明确限制并记录局限）。

---

## P2（次要 / 潜在 / 一致性）

### P2-1 `toolRunToCloudResult` 的 `executed` 分支不检查 `result.ok`
- **事实**：`ai-local-tools.ts:31-33` `case 'executed': return { ok: true, data: run.result }`，未判 `run.result.ok`。
- **现状**：该分支**当前不可达**（见 Q5）——`executeAiToolProposal` 只在 `result.ok` 时才产 `executed`（`ai-tool-call.ts:210-213`）。属纯映射函数的契约埋雷：将来若有调用方传入 `{kind:'executed',result:{ok:false}}`，会被当成成功回给模型。
- **建议**：分支内 `if (!run.result.ok) return {ok:false,reason:'write-failed',message:...}`；并补一条 executed 的映射单测。

### P2-2 node 宿主把 `isReadable` 写死为 `()=>true`
- **事实**：`agent-cloud.ts:30` `createLocalApiHost(ctx, actions, { isReadable: () => true })`。而 `local-api-host.ts:442-454` 的注释正是警告「传 `()=>true` 会让 Bear『可列举不可读』路径永远不执行」。
- **影响**：node 宿主经本地工具读任务时，被标记「不可读」的条目会被当作可读返回给模型。单用户本机场景风险低，但与既有隐私设计不一致。
- **建议**：让 `createNodeAgentToolTransport` 从宿主的真实 readability 读取（若宿主尚无此信息，显式传 `()=>false` 并在注释里说明取舍，而不是无脑 true）。

### P2-3 `createLocalApiHost` 的构造成本（澄清审计前提）
- **事实**：它**不是每次 `invoke` 新建**，而是每次 `createNodeAgentToolTransport(...)` 时建一次，返回的 transport 闭包复用同一个 `apiHost`（`agent-cloud.ts:24-31`）。构造只创建 `projectActions/habitActions/noteActions/focusActions/reminderActions/eventActions` 等闭包对象（`local-api-host.ts:466-471`），**无 I/O、无 DB**，成本很小；仅在「每个 turn 都重建 transport」时才有可忽略的重复分配。
- **结论**：无害，无需优化；但若壳真按「每轮重建」，建议把 transport 提到会话级持有。

### P2-4 `historyByOpId` 只含最近 `HISTORY_LIMIT=100` 条，undoSince 有效上限≈100
- **事实**：`HISTORY_LIMIT=100`（`packages/op-log/src/history.ts:99`）；`undoOperationsLocked` 对 `historyByOpId` 找不到的 opId 记 `not-tracked`（`engine.ts:636-640`）。
- **影响**：单次 AI 轮次若写超过 100 条，超出部分不可撤（会进 `unsupported`）。与 P1-3 的 1000 叠加，实际天花板是 100。
- **建议**：回执里区分「not-tracked（超出撤销栈）」，让用户知道这部分撤不了。

### P2-5 部分 stale 的撤销也会清空 redoStack
- **事实**：`undoOperationsLocked` 中只要 `applied.length>0` 就 `this.redoStack = []`（`engine.ts:664`），即便同批还有 stale 未撤。
- **影响**：一次「部分成功」的撤销会把用户之前的重做历史一并清掉，与「只撤了部分」的预期不符。
- **建议**：仅当 `unsupported.length===0`（完全成功）才清 redo；或明确文档化为「任何撤销都清空重做」。

### P2-6 测试价值的具体缺口（能被注入缺陷骗过的地方）
- **`ai-local-tools.spec.ts`**：只测 `observation/proposal/denied/failed/ambiguous/none`（`:7-42`），**没有 `executed` 用例** → 往 `executed` 分支注入缺陷不会红。
- **`ai-local-tools-integration.spec.ts`**：确实用了**真实引擎**（`OpLogEngine` + `DbOpLogStore` + `SqliteAdapter`，`:28-33`）和真实 `createLocalApiHost`（`:40`），这点符合「不是 fakeHost」。**但**它用 `callModel: async () => scripted.shift()!`（`:59`、`:78`）**绕过 `createRoutedModelCall`**，因此既测不到出境复查、也测不到 P0-1 的消息形状。
- **`ai-cloud-tools.spec.ts:19-37`**：只断言数量/名字/参数是对象，**没有断言 `descriptor.egressFields` 非空** → 若 `toCloudToolDescriptors` 漏带 `egressFields`，不会红（而集成测试又绕过复查，于是双重漏网）。
- **`agent-cloud.spec.ts:54-60`**：所谓「闭环撤销」实际是 `seq=currentLocalSeq()` → **手动 `host.addTask('AI 刚建的')`** → `undoSince(seq)`。它证明的是「undoSince 能撤手动写」，**不是**「撤销 AI 写」——因为本地传输根本不写。标题「写入后 undoSince 整段撤销」会让人误以为覆盖了 AI 写作路径。
- **`ai-turn-orchestrator.spec.ts`**：只测 happy path（`getSeq`→跑一轮→`undoLastAiTurn` 传回 seq，`:21-58`），**没有抛错路径**，因此 P1-2 不会被它的测试发现。
- **建议补的会红的用例**：① `executed` 映射（含 `result.ok:false`）；② 对本地传输接真实 `createRoutedModelCall` + 一个少报字段的工具，断言抛 `egress-outside-disclosed-set`；③ `toCloudToolDescriptors` 每个 read 工具 `egressFields.length>0`；④ `runAiTurnWithUndo` 让 `invoke` 抛错，断言错误上带 `seqBefore`（修复后）且可撤销已写部分。

---

## 未核 / 未知（诚实标注）

- **未核**：真实 provider 对「tool 帧前缺 assistant.tool_calls」是否 400 —— 没有可用端点/密钥，纯协议推断。
- **未核**：上述 spec 在本机是否会红 —— 无可用 `vitest` 可执行文件，全部「会/不会红」均为读断言推得。
- **未核**：`packages/local-api/tests/tool-egress-fields.spec.ts` 是否在 CI 门禁里跑（决定 P1-5 的静态兜底是否真的生效）。
- **事实**：`runAiTurnWithUndo`/`undoLastAiTurn`/`createNodeAgentToolTransport` 无产品调用点，本报告多数缺陷当前为 latent。
- **未核**：`ai-cloud-assistant.ts` 的 `CloudAssistantTurnDeps` 与 `RunAiTurnOptions extends` 的 `undo` 通过对象展开一起传入 `requestCloudAssistantTurn`（`ai-turn-orchestrator.ts:55`）——运行时多出的 `undo` 字段被忽略，无副作用；但契约层面 `runId` 同时作幂等键前缀、又无 `executionId`，与 P1-4 相关，是否后续有壳把它俩对齐未定。

---

## 附：按严重度排序的处置清单

1. **P0-1** 修 `harnessMessagesToChat` 保 assistant(toolCalls) 帧 + 多步 mock-provider e2e（否则本地闭环跑不通）。
2. **P1-1 / P1-4** 把「撤销这次 AI 操作」改成按 `aiRunWrites(runId)` → `undoOperations(opIds)`；`runId` 兼作 `executionId`。
3. **P1-2** `runAiTurnWithUndo` 失败时也交出 `seqBefore`，别让部分写入变孤儿。
4. **P1-3** `undoSince` 改按倒序取最近 N / 或回执报告截断。
5. **P1-5** 复查改为按「实际调用工具」的 `egressFields` 比对 + 全深度字段收集。
6. **P2-1/2/4/5/6** 按条目修或至少补注释与测试。

---

## 处置（Lead 终审，2026-11-22）

| 审计项 | 处置 |
|---|---|
| **P0-1 assistant tool_calls 帧被丢弃 → 真实 provider 多步 400** | ✅ **已修（协议结构层）**：`packages/ai/src/wire.ts` 的 `ChatMessage` 增加可选 `toolCalls`，`toWireMessage` 在 assistant 帧带 `tool_calls`（OpenAI 兼容形状）；`ai-routed-model.harnessMessagesToChat` 改为保留 assistant 工具调用帧。省略时请求体**逐字不变**（有测试）。判据：`packages/ai/tests/wire-assistant-toolcalls.spec.ts`（2） + `ai-routed-model.spec.ts`（7）。⚠️ 真实端点仍未联网复验（未核）。 |
| P1-1 `undoSince` 段撤销会连带撤窗口内用户编辑 | 记录为**已知语义**：AI 读路径不写；写发生在既有确认流程（单 op，可普通 undo）。`undoSince` 仅供"确知窗口内没有用户手动写"时用。未改。 |
| P1-3 `getOpsSince(...,1000)` 只取最老 1000 | 记录：本轮未改；窗口内 >1000 条属异常。待需要时改成分页累计。 |
| P1-4 ledger(executionId) 与 undo(seq) 两键未打通 | 记录：产品代码零调用点，latent；实际撤销走 confirm 单 op 或服务端。 |
| P2-2 node-host `isReadable:()=>true` | 记录：与 cli-mcp 现状一致（当前无"受保护条目"概念）。 |
| 其余 P1/P2 | 记录，未改（latent，无生产调用点）。 |

未核项（真实端点 / node-host 之外壳 / 性能）保持"未核"，不写成结论。
