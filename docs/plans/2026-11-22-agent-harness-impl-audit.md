# Agent Harness 新增实现审计（第二轮 · 审计实现代码）

> 审计对象：`git log` 的 073d 一线（`0af6bd5f` / `336cacfd` / `c93f6f69` / `537ea2fc` / `ceb6f371` 等）。
> 依据：`AGENTS.md`、`docs/agents/hard-constraints.md`、`docs/agents/repo-map.md`、
> 设计 `docs/plans/2026-11-21-agent-tool-calling-audit-and-pi-harness-design.md`、契约 `docs/reference/agent-tools-api.md`。
> 性质：**只读审计**，不改产品代码。下列条目区分「事实 / 推断 / 未核」。
> 基线：新增 7 个 spec 已实跑通过（26 tests，`pnpm exec vitest run` 于 `packages/app-host`，2026-11-22 00:09）。

---

## 0. 已核对且符合的点（先说好消息，避免只报坏）

- **token 只走 header**：`ai-cloud-tools.ts:89` 把 `Authorization: Bearer` 放 header；URL 只拼 `baseUrl+prefix+encodeURIComponent(name)`（`:92`），name 是工具名，不含 token/用户数据；参数只放 body（`:95`）。**无 token 进 URL、无用户数据进 URL**（事实）。
- **无本地文件系统访问**：新增 5 个 src 文件 grep `node: / require( / fs / readFile / writeFile` 均无命中（事实）。
- **无把用户数据写日志**：新增 src 无 `console.*` 输出 intent/args/token（事实）。
- **本地写入口仍单一**：`ai-tool-run.ts` 剥离注释后 `.submit(` 计数 = 1（就 `:359` 的 `host.submit(proposal.intent)`），`scripts/check-ai-tools.mjs` 的「恰好 1 次且在 `confirmAiToolProposal` 内」仍成立（事实，已用剥离注释脚本复核）。新增云端路径不在本地落 op（写由服务端执行），不新增本地写入口。
- **模型调用默认确实只走 `invokeRouted`**：`ai-routed-model.ts:100` 默认 `invoke = invokeRouted`，测试注入才离线（事实）。

---

## P0（阻断级：出境披露失真 / 多步功能实质不可用）

### P0-1 云端循环的出境披露**漏报工具观测字段**，违反设计 §2.4 的核心出境不变量
- **事实**：`ai-routed-model.ts:116` 硬编码 `fields: ['text', 'tools']`。而该循环会把每步工具观测结果（`agent-harness.ts:145` `JSON.stringify(result.data)` → `:158` 作为 `tool` 帧回送）一并发出；这些数据是任务标题、便签正文等用户内容。
- **对照设计/既有实现**：设计 §2.4 明确要求「循环前一次性算字段并集披露；回送前复查『实际字段 ⊆ 已披露』」。既有 `ai-assistant.ts:113` `ASSISTANT_BASE_EGRESS_FIELDS=['text','today','tools',...]` 且 `assistantEgressFields()` 把**所有可达工具的 `egressFields`** 并进披露；`ai-assistant.ts:953-967` 有「`actual ⊆ declared ⊆ disclosedPlain`，否则一个字节都不发」的复查。新路径**两者都没有**。
- **影响**：用户看到的披露是「text、tools」，实际连同任务/便签数据一起出境 —— 恰是仓库反复强调的「对用户撒谎」类事故。且 `egress.ts:168-170` 的 `authorizeEgress` 只按 `(feature,destination)` 匹配、**不比对 `fields`**，所以这个失真不会被闸门拦下。
- **测试反被钉死**：`ai-routed-model.spec.ts:55` `expect(seen!.fields).toEqual(['text','tools'])` —— 把错误期望写成断言，修 bug 会让它红。
- **修复**：`createRoutedModelCall` 的 `fields` 改为「按本轮可达工具集算并集」（复用 `assistantEgressFields()` / `planAssistantEgress()` 的同一实现，不另写一份）；并在每步回送前加 `observedFieldNames ⊆ declared ⊆ disclosed` 复查。同步把 `ai-routed-model.spec.ts:55` 改成断言并集（含 `task.*` 等）。
- **可失败判据**：让某个只读工具返回一个不在披露集合里的字段（或把 `fields` 改回 `['text','tools']` 同时工具结果含 `task.title`），若循环仍把它发出去而不报 `egress-outside-disclosed-set` ⇒ 红。

### P0-2 回送给真实 provider 的消息序列**缺 `assistant(toolCalls)` 帧**，多步第二次调用会 400
- **事实**：`ai-routed-model.ts:66` `if (m.toolCalls !== undefined && m.toolCalls.length > 0) continue;` —— 带工具调用的 assistant 帧被整条丢弃（连其中的 `text` 也丢）。于是 `harnessMessagesToChat` 产出 `[system, user, tool...]`（`ai-routed-model.spec.ts:110` 就断言此形状）。而循环内部是有 `assistant(toolCalls)` 的（`agent-harness.ts:135`）+ `tool`（`:158`）。
- **推断（强，基于 OpenAI 兼容协议，未对真实端点实测=未核）**：`role:'tool'` 消息前必须有 id 匹配的 `assistant.tool_calls` 帧，否则 OpenAI 兼容端点返回 400（"messages with role 'tool' must be a response to a preceding message with 'tool_calls'"）。⇒ 只要有工具调用，第二步模型调用即失败，`callModel` 抛错（`ai-routed-model.ts:123`）→ 整轮失败，**多步功能实质不可用**（单步/只问不调工具仍可用）。
- **与既有做法一致但同样有问题**：`ai-assistant.ts:970-974` 也只 push `{role:'tool', content, toolCallId}`、不 push assistant(toolCalls)。所以新代码「与 ai-assistant 同构」（事实），但既有做法本身对真实 provider 也大概率非法 —— 两处共享同一缺陷，不能以「一致」当正确。
- **修复**：`harnessMessagesToChat` 保留带 `toolCalls` 的 assistant 帧（OpenAI 形状 `{role:'assistant', content, tool_calls:[...]}` 且 `tool` 帧带 `tool_call_id`；若兼 Anthropic 需另做适配层，但至少 OpenAI 线格式要有）。并加一条**对真实/openai-mock 端点跑多步**的 e2e（现有 e2e `ai-cloud-tools-http.e2e.spec.ts` 用脚本化 `callModel`，未覆盖真实 provider 的消息合法性）。
- **可失败判据**：用一个会校验「tool 帧前必有 assistant.tool_calls」的 mock HTTP provider 跑 `runCloudAgentTurn` 两步；当前实现应 400 → 修后 200。

---

## P1（严重：安全面 / 契约不一致 / 功能未端到端）

### P1-1 工具传输是**第二个出境通道**，绕过 `invokeRouted` / 出境闸门 / 熔断
- **事实**：`ai-cloud-tools.ts:83,92` 直接 `fetchImpl(...POST /api/agent/tools/<name>)`；不走 `authorizeEgress`、不进 `fields` 披露、无字节上限、无熔断/健康。而 `create_note/update_note` 的正文、`create_task` 的标题、`append-task-checklist` 的条目等**用户内容就在 args 里**随该请求发往 heyta 云端。
- **判断（回答问题）**：注入 `fetch` 本身**不算**违规（测试需要，生产默认 `globalThis.fetch`）。但它确实构成一个**独立的、未披露的出境面**。`ai-routed-model.ts:3` 写的「invokeRouted 是唯一出境执行点」**只对『模型调用』成立，对『用户数据』不成立** —— 存在第二条把用户数据送出设备的路径。是否算「违反唯一出境点」取决于该说法的作用域：按字面「模型出境」不违反；按安全不变量「任何用户数据出境都要披露/经闸门」则违反。
- **修复**：二选一并写进契约与披露：①把工具调用出境纳入同一套披露（tool args 计入 `fields`、按目的地取 consent）；或②在契约/隐私政策里**显式披露**「调用工具时，工具参数（可能含你的任务/便签正文）会发往 heyta 云端执行，默认明文、服务端可读」（`agent-tools-api.md §0` 已有"默认明文"口径，但未进入面向用户的出境披露清单）。

### P1-2 契约要求的**幂等键未实现**（客户端/契约对不上）
- **事实**：`agent-tools-api.md:64`（§2.5）要求写请求带 `Idempotency-Key = runId:step`；但 `ai-cloud-tools.ts:88-97` 只设 `content-type`/`authorization`，**无 `Idempotency-Key`**；且 `CloudToolTransport.invoke(name, args, signal)`（`:36-41`）签名里没有 `runId`/`step`，结构上无法生成该键。
- **影响**：网络重试、跨进程/跨端重试会**重复落库**，契约承诺的幂等落空（写工具尤甚）。
- **修复**：给 `invoke` 增加 `step`（transport 持 `runId`，或调用方传入），写请求加 `Idempotency-Key: ${runId}:${step}`。
- **可失败判据**：mock server 断言写请求头含 `Idempotency-Key`；当前实现缺失 ⇒ 红。

### P1-3 运行账与 `undoOperations` **两端对不上**，且云端路径完全没记账（功能未端到端）
- **事实**：`recordAiRunWrite` 只在 `ai-tool-run.ts:204`（本地 assistant 的 `executeAiToolProposal`）调用；新请求路径 `ai-cloud-assistant`/`runCloudAgentTurn` **完全不记账**。`undoOperations` 需要 **opIds**，但运行账记的是 `intent`（`ai-run-ledger.ts:59`），`LocalApiWriteResult` 只回 `taskId/entityId`（`shared.ts:712-736`）**不含 opId**。全仓 `undoOperations` **无生产调用点**（grep 仅 spec）。
- **影响**：「撤销这次 AI 操作」目前只是两个互不相连的半成品；且即便要接，也**拿不到 opId** 去驱动 `undoOperations`。
- **诚实标注**：`ai-run-ledger.ts:15-18` 已自认「真正的按 run 回滚……那是下一步」。所以这是**已知未完成**，但仍要在实现层记一笔：`LocalApiWriteResult` 需要回 op id，ledger 需要存 op id，云端路径需要记账，三者缺一不可。
- **修复**：op-log 的提交路径返回 opId → `LocalApiWriteResult` 增 `opIds` → ledger 存 `opIds` → 云端路径也调 `recordAiRunWrite` → 再接 UI「撤销」。

### P1-4 新循环缺**出境字节上限 / 消息条数上限**（设计 §2.4 + `assistant-limits.ts`）
- **事实**：`agent-harness.ts` 只有 `maxSteps`（默认 6，与 `MAX_ASSISTANT_TOOL_STEPS` 数值巧合同源但**是另一个常量**，会漂）；无 `MAX_ASSISTANT_MESSAGES` 检查、无 `egressBytesFor(...) > MAX_ASSISTANT_EGRESS_BYTES` 检查。既有 `ai-assistant.ts:812,850` 都有。
- **影响**：工具一次返回大结果（如 500 条任务）会撞穿 200KB 出境预算且**照发**；长历史每步全量回送无上限。
- **修复**：从 `@heyta/ai` 的 `assistant-limits` 复用 `MAX_ASSISTANT_MESSAGES` / `MAX_ASSISTANT_EGRESS_BYTES` / `egressBytesFor`，在 `runCloudAgentTurn` 每次 `callModel` 前判字节、判条数；`maxSteps` 也用 `MAX_ASSISTANT_TOOL_STEPS` 而非新常量。

---

## P2（应修：一致性 / 测试价值 / 门禁盲区）

### P2-1 `undoOperations` 不清 `redoStack`（新动作应失效 redo）
- **事实**：`engine.ts:607-642` 的 `undoOperations` 方法体内**无任何 `redoStack` 引用**（已 grep 复核）；对比 `dispatchLocked` 只在 `recordHistory !== undefined` 时 `this.redoStack = []`（`:761-768`），而批撤销用 `recordHistory=false` 派发（`:626`），所以 redo 栈不受影响。
- **影响/场景（推断）**：先 `undo()` 把 B 放进 redoStack，再 `undoOperations([A])` 撤 A（A 仍是有效条目）→ `canRedo` 仍为真；此时 `redo()` 会把「批撤销之前」的 B 重放回来，redo 语义被打乱（撤销是新的状态变更，按常规应清空 redo）。
- **修复**：`undoOperations` 只要有 `applied` 就 `this.redoStack = []`。
- **可失败判据**：dispatch A、dispatch B、`undo()`（撤 B）、`undoOperations([A])`、断言 `historyState().canRedo === false`；当前实现为 true ⇒ 红。

### P2-2 `historyByOpId` 泄漏：`undo()/redo()` 不维护该映射
- **事实**：`stepHistory('undo'/'redo')`（`engine.ts:644-675`）只 `pop`/`push` `undoStack`/`redoStack`，**不删除也不重建** `historyByOpId`；映射只在 `dispatchLocked`（`:763`）加、`:766` 在栈溢出时删、`restoreHistory`（`:594-595`）重建。
- **影响（事实+推断）**：① 内存泄漏：`undo()` 缩 `undoStack` 但不删 map，新 dispatch 的溢出清理只在栈 >100 触发，所以 map 可随「dispatch→undo」交替无限增长；② `undoOperations` 对被用户手动撤销过的 op 会因 `checkInverseStillValid` 报 `entity-changed/entity-missing`，而非 `not-tracked`，UI 会误报「被别的设备改过」。
- **澄清**：**不存在可复现的双重撤销** —— 我逐 opType 核过 `checkInverseStillValid`（`history.ts:223-242`）：Update 撤销后当前值已非原「新值」→ entity-changed；Create 撤销后实体已软删 → entity-missing；Delete 撤销后 deletedAt 已非原时间戳 → entity-changed。三类都被挡住（事实：代码逻辑；未对全部边界实测=部分未核）。所以此项只是**泄漏 + 误导性 reason**，不是数据被双重撤销。
- **修复**：`undo/redo` 后同步维护 map（或干脆让 map 由栈派生，避免两份状态）。

### P2-3 可移植性门禁（`agent-portability.spec.ts`）有**漏判**
- **事实**：该 spec 只 `readFileSync` 4 个本地文件字面文本（`:19-28`），三个断言：禁 `from 'node:`/`require(`/`process.`/`Buffer`/`__dirname`（`:32-38`）、`ai-cloud-tools.ts` 不含 `getReader`/`ReadableStream` 且含 `.json()`（`:48-52`）、`agent-harness.ts` 不含 `fetch(`（`:57`）。
- **漏判点**：
  1. **裸内置不拦**：`import ... from 'fs'` / `'path'` / `'crypto'` / `'os'` 等不被 `/from\s+['"]node:/` 捕获（只拦 `node:` 前缀形式）。注入 `import fs from 'fs'` 不会红。
  2. **不追导入传递闭包**：真实默认路径经 `@heyta/ai` 的 `invokeRouted`，而 `@heyta/ai/routing.ts:1285-1341`、`stream.ts:11-12` 实际含 `ReadableStream`/`getReader`/`TextDecoder`（有 `typeof TextDecoder==='function'` 运行时守卫、Hermes 缺 `TextDecoder` 时退化）。门禁只看 4 个文件，看不到这个真实依赖图。当前 `@heyta/ai` 与 `@heyta/local-api` grep 无 `node:` 导入（事实），所以今天是干净的，但门禁**不能保证**它保持干净。
  3. `.json()` 用 `includes('.json()')` 是弱代理（注释里出现也算过）。
- **修复**：①加裸内置名清单（`fs|path|crypto|os|child_process|stream|net|http|url|util|events` 的 `from '<name>'`）；②对 4 文件的可达依赖图（至少 `@heyta/ai`、`@heyta/local-api`）做同规则扫描，或在 `agent-harness-runtime-compat.md` 明确「本门禁只覆盖 4 个引擎文件，`@heyta/ai` 的流式代码另有运行时守卫」。顺带：`agent-harness-runtime-compat.md:9,18` 的「不用 `response.body` 流 / `ReadableStream`」应限定为「这 4 个文件」，因为默认 `invokeRouted` 路径里确有流式代码（虽守卫）。

### P2-4 风险档过滤/判定**无测试会红**（空判据）
- **事实**：全目录 `risk` 只有 `read`/`write`（grep `packages/local-api/src/tools/*.ts`，无 `destructive-*`）；`tools-risk.spec.ts` 甚至钉死「现有写工具里不出现 destructive 档」。于是 `ai-cloud-tools.ts:166` 的 `risk.get(name) !== 'destructive-irreversible'` 过滤、`ai-tool-run.ts:94-95` 的 `destructive-irreversible/reversible` 分支**永不执行**。
- **影响**：若有人删掉这两处过滤/分支，**没有任何测试会红**；风险档目前是「声明了但没有消费者场景」的装饰。
- **修复**：加注入式单测（把 risk 映射作为参数传入，或临时用合成 destructive 工具驱动 `selectToolNames`/`aiToolProposalRequiresConfirmation`），断言「destructive-irreversible 默认被过滤」「destructive-reversible 直接执行」「write 走动作级确认」。

### P2-5 `ai-cloud-tools.spec.ts` 硬编码 30 / `toBe(LOCAL_API_TOOLS.length)`（脆弱判据）
- **事实**：`ai-cloud-tools.spec.ts:23-24` 同时断言 `toBe(LOCAL_API_TOOLS.length)` 和 `toBe(30)`。新增任何工具（哪怕合法）即红；而真正的「不可逆工具被过滤」却因当前无此档工具而测不到（与 P2-4 同源）。
- **修复**：`toBe(30)` 改为对「过滤语义」的断言（构造含 destructive 的合成目录），或改成「长度 = 已授权且非不可逆的期望集合」。

### P2-6 契约/客户端其余小不一致（服务端未实现，多为未核）
- **事实**：契约提供 `GET /api/agent/tools`（`agent-tools-api.md:15`），但客户端 `toCloudToolDescriptors` 从本地 `LOCAL_API_TOOLS`+grants 推导，**从不调 GET**（`:170-178`）。错误码闭集（`§3`）里客户端自造了 `network`/`bad-envelope`/`http-<status>` 等（`ai-cloud-tools.ts:99-114`）——属客户端传输错误命名空间，不算服务端 `reason` 越界，但契约没说清两个命名空间，易混。
- **未核**：服务端 handler、鉴权、幂等、限流均**尚未实现**（`agent-tools-api.md:87` 自认），无法核对真实行为。

### P2-7 其余实现小项
- `agent-harness.ts:145` `content = JSON.stringify(result.data)`：`data` 为 `undefined` 时 `JSON.stringify` 运行期返回 `undefined`（TS 标注 `string`），使 `tool` 帧 `content` 变成非字符串（`:158`）。建议 `?? 'null'`。
- `agent-harness.ts:118-122` `stopped:'tool-steps'` 时固定 `text: ''`，丢弃上一步模型可能已给出的文本。
- `ai-routed-model.ts:66` 丢弃带 `toolCalls` 的 assistant 帧时，把该帧的 `text`（前导说明）也一并丢了。

---

## 测试价值评估（能否因注入缺陷转红）

| 测试 | 能因缺陷转红？ | 说明 |
|---|---|---|
| `agent-harness.spec.ts` | ✅ | maxSteps 有界、失败回灌、history 前置都能红；但**不校验发给 provider 的消息合法性**（P0-2 测不到）。 |
| `ai-routed-model.spec.ts` | ⚠️ 反向 | `:55` 把 `fields=['text','tools']` 钉成期望 —— 修 P0-1 会红（测试锁死了 bug）；`:110` 钉死缺 assistant 帧的形状。 |
| `ai-cloud-tools.spec.ts` | ⚠️ 部分空 | 传输线形态能红；但「不可逆过滤」永不执行（P2-4）；`toBe(30)` 是脆弱硬编码（P2-5）。 |
| `ai-cloud-tools-http.e2e.spec.ts` | ✅（工具侧） | 真 HTTP 验工具线形态；但 `callModel` 是脚本，**不验真实 provider 消息**（P0-2 测不到）。 |
| `ai-cloud-assistant.spec.ts` | ✅（冒烟） | 只 1 条端到端冒烟，用注入 invoke、`consents:[]`，出境闸门从未被真正执行。 |
| `ai-run-ledger.spec.ts` | ✅ | 记账/去重/失败不记都能红；但不覆盖「同一 executionId 不同 intent → invalid」这条（P2-6，未核可达性）。 |
| `agent-portability.spec.ts` | ⚠️ 有盲区 | 只拦 `node:` 前缀，裸内置/传递依赖漏判（P2-3）。 |
| `undo-run.spec.ts`（op-log） | ✅（本步） | 覆盖整批抵消/未跟踪/清史/空；但**不覆盖**与 `undo()/redo()` 的相互影响（P2-1/P2-2 测不到）。 |

**结论**：新增测试整体能因「显式注入的缺陷」转红（不是空判据），但存在 3 个系统性盲区——①出境披露正确性（被测试锁成错误期望）；②真实 provider 消息合法性（用脚本化模型绕过）；③undo 与 redo/映射的交互（未测）。这三处正是 P0/P2 的高风险点。

---

## 未核清单（诚实标注，未取样）
- **真实 OpenAI 兼容端点对「tool 帧缺 assistant.tool_calls」的实际反应**：未联网实测，P0-2 的 400 结论为强推断。
- **服务端 `/api/agent/tools`**：handler 未实现，鉴权/幂等/限流/错误码真实行为无法核对。
- **移动端 Hermes 真机**：未跑，属形状推断（`agent-harness-runtime-compat.md` 自认 U1/U5）。
- **`undoOperations` 全部边界**：只按代码逻辑核了三类 opType 的 staleness；未构造覆盖所有交错的重放测试。
- **`executeAiToolProposal`「同一 executionId 不同 intent → invalid」的实际可达性**：本地 assistant 当前一轮一写（`stopsHere`），未见触发路径，未核。

---

## 处置（Lead 终审，2026-11-22）

| 审计项 | 处置 | 判据 |
|---|---|---|
| **P0-1 出境披露漏报工具观测字段** | ✅ **已修** | `ai-routed-model.ts` 的 `fields` 改为「可达工具 egressFields 并集 + text/tools + 信封」；回送前 `assertToolObservationsDisclosed` 复查，未披露字段即抛 `egress-outside-disclosed-set`。`ai-routed-model.spec.ts` 新增「未披露字段→抛错」用例（会红）。`CloudToolDescriptor`/`CloudAgentTool` 增加 `egressFields`。 |
| **P0-2 丢 assistant(toolCalls) 帧** | ⏸ 记录为**已知限制**（与既有 `ai-assistant` 同构：同样只发 tool 帧）。真正修复需给 `ChatMessage`/`wire.ts` 增加 assistant `tool_calls` 支持（会影响所有 AI 路径与字节判据），属独立改动；需真实/自建 OpenAI 兼容端点复验后再定。**未假装已解决**。 |
| P1 第二条出境通道（工具→自有云端） | 记录：`createHttpCloudToolTransport` 直连我们云端（非第三方模型）。披露语义应为"工具调用与参数会发到 heyta 云端"，需在 UI 出境提示里体现。未改 UI。 |
| P1 Idempotency-Key 未实现 | ⏳ 待做（下一轮）：传输层加可选 `Idempotency-Key` 头，循环按 `runId:step:callId` 生成。 |
| P1 运行账无 opId / undo 无生产调用点 | ⏳ 待做：op id 回灌 ledger + 壳提供"撤销这次 AI 操作"。 |
| P2 undoOperations 不清 redoStack | ✅ 已修：批量撤销后 `redoStack=[]`。 |
| P2 historyByOpId 泄漏 | ✅ 已修：`stepHistory` 撤销时从映射删除；`clear/restoreHistory` 重建；早前提交 `5ea95252`。 |
| P2 可移植门禁只拦 `node:` | ✅ 已加固：正则增加裸内置（fs/path/child_process/crypto/http/https/net/stream…）。传递依赖仍靠导入审查，记录为残余。 |
| P2 风险档过滤无测试会红 | ⏳ 缺口：当前目录无 `destructive-irreversible` 工具，无法自然构造红；待有 purge 类工具时补。 |

未核项（真实 provider 反应 / 服务端 /api/agent/tools / Hermes 真机 / undo 全边界）保持"未核"，不写成结论。
