# 可写本地工具传输（auto-write）审计 — 2026-11-22

范围：`createAutoWriteLocalToolTransport` 及其在 Web 壳 `?cloudHarness=1` 下的接线。
结论按 P0/P1/P2 排列，每条标 **事实 / 推断 / 未核**。只读审计，未改代码。

---

## 0. 一句话结论

传输层"危险写被拦"这条**成立**（destructive-irreversible 永不自执行），授权二次校验也**成立**；
但 Web `?cloudHarness=1` 把自动写打开了，**没有接撤销入口、没有写回执**，而且**模型中途抛错会丢掉撤销锚点**——
D1 赖以放行自动写的"版本回溯兜底"在唯一启用自动写的 Web 入口上**实际不可达**。这是本轮的 P0。

---

## 1. 危险写是否被拦（对应审计点 1）

- **事实** — `ai-tool-run.ts:87-95` `aiToolProposalRequiresConfirmation` 先读 catalog 的 `risk`：
  `destructive-irreversible` → `true`；`destructive-reversible` → `false`；其余落到动作级 switch。
- **事实** — `executeAiToolProposal` 开头即判确认：`ai-tool-run.ts:177-179`，需要确认时返回
  `{ok:false, reason:'invalid', message:'这项改动需要先确认。'}`，**不调 `host.submit`**。
- **事实** — auto-write 传输把该结果映射成 `ok:false`：`ai-local-tools.ts:92-95`。
  ⇒ **彻底删除（purge / destructive-irreversible）不可能经此路径自动执行**，成立。
- **事实（重要限定）** — 当前**根本没有任何 destructive 工具**：所有写工具 `risk` 均为 `write`；
  `local-api/tests/tools-risk.spec.ts:46-51` 用断言钉住"现有写工具里不出现 destructive 档（当前尚无删除/归档/移动工具）"。
  ⇒ 上面这条防线是在防一个**尚不存在的攻击面**；"destructive-reversible 自动执行符合 D1"也只是**设计层面成立、运行层面无触发面**。
- **未核 / 事实** — `risk==='destructive-irreversible'` 这一分支在测试里**从未被执行**（全仓测试无该断言）。
  见 P1-3 的 fail-open 风险。

与 D1 一致性判定：**一致**（destructive-reversible 归 false=自动，符合"删除/归档/移动给 AI 靠版本回溯"），
但**暂无此类工具**，属"代码就位、对象未到"。

---

## 2. 导出授权完整性（对应审计点 2）

- **事实** — `runSelectedTool` 先做 grant 校验：`ai-tool-run.ts:299-307`，
  用 `deps.getGrants?.() ?? deps.grants`，未授权返回 `kind:'denied'`。
- **事实** — `executeAiToolProposal` 的二次校验在 `confirmAiToolProposal`：`ai-tool-run.ts:351-358`
  （`isToolGranted(authorization.getGrants(), proposal.tool)`，撤销则 `rejected`）。
- **事实** — `getGrants` 与 `grants` 不一致时**以 getGrants 为准**：`runSelectedTool:300` 与
  auto-write `ai-local-tools.ts:90` 都是 `getGrants?.() ?? grants`。
- **事实** — 模型能看到的工具已被 grants 过滤：`ai-cloud-assistant.ts:61` `toCloudToolDescriptors(deps.grants)`；
  模型即使幻觉出未授权工具名，也会在 `runSelectedTool` 命中 `findTool`+`isToolGranted` 被挡。
- **推断（低风险）** — auto-write 在 `ai-local-tools.ts:90` 读一次 grants 后**冻结进闭包**交给 confirm，
  confirm 用的是冻结值：`runSelectedTool` 之后、`execute` 之内若授权被撤，不会再读一次。因与 `runSelectedTool` 同一读法、grants 是静态配置，实际风险低。
- 结论：**未发现"未授权工具可执行"的路径**。

---

## 3. 撤销正确性（对应审计点 3）

- **事实** — 编排只取锚点、不回滚：`ai-turn-orchestrator.ts:49-57`
  （`seqBefore = getSeq()` → `await requestCloudAssistantTurn` → 返回 `{turn, runId, seqBefore}`），**无 try/catch、无失败自动撤销**。
- **事实** — 循环内 `await options.callModel(...)` 无捕获：`agent-harness.ts`（`runCloudAgentTurn` 主循环）。callModel 抛错向上穿透，
  `runAiTurnWithUndo` 在返回前就抛出 ⇒ **`seqBefore` 丢失**。
- **事实** — `undoSince` 语义：`engine.ts:621-630` — 仅按 `clientId===this.clientId` 过滤（排除远端），
  **但包含本机该段内所有本地 op**；`getOpsSince(seq,1000)` 上限 1000 条；逐条过 `checkInverseStillValid`，冲突的进 `unsupported`（可返回 partial）。
- 回答审计问：
  - **多步中途失败能否整体撤销？** 只有**正常返回**后才能靠 `undoSince(seqBefore)` 整体撤（且需用户显式触发，见 P0-1）。
  - **失败步骤是否留在库里？** 失败那步（execute 返回非 ok）**不落库**；但**之前已成功的步骤留在库里**。
  - **抛错场景**：callModel 抛错 → 先前的写留库 **且 seqBefore 拿不到** → 连程序化撤销的锚点都没有（P0-2）。

---

## 4. 静默写风险（对应审计点 4）

- **事实** — Web 自动写：`cloud-harness.ts:63` 用 `createAutoWriteLocalToolTransport`（真落库）。
- **事实** — 面板只取 `turn`，丢掉 `seqBefore/runId`：`AssistantPanel.tsx:550` `const { turn: result } = await runWebCloudTurn(...)`；
  append 时 `steps: []`：`AssistantPanel.tsx:557`。
- **事实** — `undoWebCloudTurn`（`cloud-harness.ts:77-79`）全仓 `apps/web/src` 仅在定义处出现一次——**没有任何 UI 调用点**。
- 结论：`?cloudHarness=1` 下 AI **直接写且无任何回执/无撤销按钮**，用户只能从模型自然语言里猜发生了什么。
  D1 要求"保留版本回溯"——当前连"可撤销"都未在 UI 明示，需要**写回执 + 撤销入口**，否则安全前提不成立（见 P0-1）。

---

## 5. 测试价值（对应审计点 5）

- **正面（事实）** — `ai-local-tools-integration.spec.ts:119-133`：真实 `SqliteAdapter`+`OpLogEngine`，
  `create_task` 经 auto-write **真落库**（`toContain('Harness 写的')`）+ **真撤销**（`undoSince` 后 `not.toContain`）。
  同文件 `:93-116` 的 D1 用例同样真落库真撤销。**不是"只测 ok 不测落库"的空断言。**
- **缺口（事实）** —
  (a) 无"确认档写经 auto-write 传输 → `ok:false` 且**不落库**"用例（D1 最关键的边界）；
  (b) 无"多步部分失败/抛错后先写残留 + 可撤销"用例；
  (c) 无"grant 撤销下 auto-write 拒绝"用例；
  (d) `risk==='destructive-irreversible'` 分支无用例（现有确认用例走的是动作级 `complete-tasks`/`append-task-checklist`，见 `ai-tool-run.spec.ts:273-296`）。

---

## P0

### P0-1 Web Harness 自动写无撤销入口、无写回执 —— D1 安全前提未落地
- 事实：`cloud-harness.ts:63` 真写；`cloud-harness.ts:33-42/77-79` 的撤销函数**无 UI 调用**；
  `AssistantPanel.tsx:550,557` 丢弃 `seqBefore`、`steps: []`。
- 影响：`?cloudHarness=1` 下自动落库后用户看不到结构化回执、点不到撤销；D1"靠版本回溯兜底"无法兑现。
- 暴露面：受 `?cloudHarness=1`（`App.tsx:2690`，默认关）限制，但生产构建同样生效，非 dev-only 门禁（事实）。
- 建议：面板在 harness 分支展示本轮 `steps` 回执，并提供"撤销这次 AI 操作"按钮调 `undoWebCloudTurn(seqBefore)`；
  或在接线完成前保持该开关为 dev-only（如要求 `import.meta.env.DEV`）。

### P0-2 模型中途抛错 → seqBefore 丢失 → 已写字无锚点可撤
- 事实：`ai-turn-orchestrator.ts:49-57` 无 try/catch、无失败回滚；`agent-harness.ts` `callModel` 无捕获；
  `AssistantPanel.tsx:556-562` catch 只显示错误、手里没有 seqBefore。
- 影响：第 1 步写成功、第 2 步网络挂 ⇒ 第 1 步已落库且无标准撤销路径（写泄漏 + 无锚点）。
- 建议：`runAiTurnWithUndo` 在 try/finally 或 catch 中把 `seqBefore` 与部分结果一并返回/抛出（附带锚点），
  或失败时自动 `undoSince(seqBefore)`（需评估误撤本机并发写，见 P1-1）。

## P1

### P1-1 `undoSince` 会连带撤销同段内的本机手工写
- 事实：`engine.ts:621-630` 只排除远端（按 clientId），包含本机所有 op；AI 一轮等云端模型期间用户手动改的东西会被一起撤。
- 事实：`getOpsSince(seq,1000)` → 超过 1000 条只撤前 1000（P2 级边界）。
- 未核：面板 running 期间是否禁用其它编辑入口（未读到该逻辑）；若禁用则风险下降。

### P1-2 确认档写在 Harness 模式永久失败，模型收到"失败"非"待确认"
- 事实：`ai-tool-run.ts:87-95` + `:177-179` + `ai-local-tools.ts:92-95` → 需确认的写返回 `ok:false`；
  runWebCloudTurn 不走提案卡，**没有确认入口**。涉及动作见 `ai-tool-run.ts:96-125`
  （`complete-tasks`/`append-task-checklist`/`set-task-priorities`/`set-task-estimate`/`update-note`/`update-event`/`set-task-tags(空)`/`update-task(非白名单)`）。
- 影响：这些工具在 harness 模式不可用，且模型可能反复重试凑步数。

### P1-3 核心防护对"未注册工具"fail-open，且 destructive 分支无单测
- 事实：`ai-tool-run.ts:93` 的 risk 来自 `findTool(proposal.tool)?.risk`；工具不在 catalog ⇒ risk=undefined ⇒ 落动作 switch ⇒ 多数 `default: return false`（自动执行）。
- 事实：`tools-risk.spec.ts:46-51` 钉住"零 destructive 工具"，故 `risk==='destructive-irreversible'` 分支测试从未执行。
- 推断：将来新增 purge 但忘记在 catalog 标 risk / 未进目录，`executeAiToolProposal` 会 fail-open 自动执行（除非动作名恰好命中需确认的 switch）。
- 建议：未知 tool / 未知 action 默认 `return true`（fail-closed），并给 destructive 分支补单测。

## P2

- **P2-1** `cloud-harness.ts:10` 头部注释与实现相反："写只出 write-needs-confirm、不在本入口落库"，但 `:63` 实际 auto-write 会落库。安全敏感文件里的误导注释。
- **P2-2** runId 幂等键对本地自动写被丢弃：`agent-harness.ts` 传 `invoke(...,{idempotencyKey})`，但 `ai-local-tools.ts:82 invoke(name,args)` 只收两参、忽略第 3/4 参；executionId 用 `cloudagent:<name>:<counter>`（counter 每传输实例重置）。`ai-turn-orchestrator.ts:7-8` 声称 runId 作幂等键前缀，对本地写不成立。**未核**：host 每轮新建（`store.ts:336`）故去重只在单轮生效；若将来 host 常驻，`cloudagent:<name>:1` 跨轮撞号+同指纹会被误判重复而静默不写（潜在 P1，取决于 host 生命周期）。
- **P2-3** auto-write 传输忽略 `AbortSignal`（`ai-local-tools.ts:82`），取消/切会话无法中断写。
- **P2-4** 写成功只回 `{applied:true}`，不含新建实体 id（`ai-local-tools.ts:96`），模型无法引用刚建对象。
- **P2-5** 测试缺口见 §5(a)-(d)。

---

## 附：核实方式
- 逐文件取证：`packages/app-host/src/{ai-local-tools,ai-tool-run,ai-turn-orchestrator,agent-harness,ai-cloud-assistant}.ts`、
  `packages/local-api/src/{tools, tools/shared}.ts`、`packages/op-log/src/engine.ts`、
  `apps/web/src/{App.tsx, features/ai/AssistantPanel.tsx, features/ai/cloud-harness.ts, features/tasks/store.ts}`。
- `grep 'undoWebCloudTurn' apps/web/src` 仅 1 处（定义处）→ 无调用点。
- `grep destructive` in `packages/local-api/src/tools/*` 仅出现在 shared.ts 注释；`tools-risk.spec.ts:46-51` 断言 destructive 工具为空。

---

## 处置（Lead 终审，2026-11-22）

| 审计项 | 处置 |
|---|---|
| **P0-1 自动写无撤销入口/无回执（UI）** | ✅ **已消除风险**：UI 适配器（web `runWebCloudTurn`、mobile `runMobileCloudTurn`）**改回只读传输**（`createLocalToolTransport`）——写工具返回 `write-needs-confirm` 由模型转述，**不静默落库**。`createAutoWriteLocalToolTransport` 保留为**库能力**（有落库+undo 测试），仅在壳具备"撤销这次 AI 操作"入口时才可用。切换 UI 到 auto-write 属于后续（需撤销 UI）。 |
| **P0-2 中途抛错丢 seqBefore** | ✅ **已修**：`runAiTurnWithUndo` catch 后返回 `{ turn(空), seqBefore, error }`，已写部分仍可撤销。测试：模型抛错 → 返回 error+seqBefore，undoSince(seqBefore) 被调（2 条 orchestrator 绿）。 |
| P1 `undoSince` 连撤同段手工写、确认档写在 Harness 永久失败、destructive 分支无单测 | ⚠️ 记录：只读 UI 下不触发；auto-write 仅库用。destructive 拦截有 `ai-tool-run.ts:94` + 集成用例。 |

验证：app-host orchestrator+integration 6 绿；web/mobile tsc 0 错；`check:ai-tools`/`check:layering` 绿。
