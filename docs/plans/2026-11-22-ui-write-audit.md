# UI「可写 + 撤销」接线审计（第七轮）

> 范围：Web `AssistantPanel.tsx` 的 `useCloudHarness` 分支 + 撤销按钮；`apps/web|mobile/src/**/cloud-harness.ts`；Mobile `AssistantScreen.tsx`（`MOBILE_CLOUD_HARNESS`）+ `chat-controller.ts` 的 `cloudTurn` 分支；`packages/app-host/src/ai-turn-orchestrator.ts`。
> 方法：只读代码 + git 历史 + 门禁脚本 + 现有测试。标注约定：**事实**（有 file:line）/ **推断** / **未核**。审计时间 2026-11-22。

---

## 结论先行

- **P0 × 1**：移动端 `MOBILE_CLOUD_HARNESS=true`——**默认**把移动助手切成 auto-write 真落库，而仓库自己的状态文档写明"UI 默认切换未做、需产品决策 + UI 验收"。注释还写着"默认关（只读）"，与代码相反。**建议默认 false / 灰度**。
- **P1 × 4**：撤销范围过宽（会撤到无关写）、撤销结果不校验且错误不捕获、跨引擎 stale 守卫恒失效、mobile `host!` 非空断言不安全。
- **P2 × 6**：回执粒度、硬编码中文绕过门禁、`as MessageKey`、图片静默丢弃、按钮位置（未核渲染）、UI 层零测试（附最小可转红用例）。

---

## P0

### P0-1 移动端默认开启 auto-write，未经真机/UI 验收即上线

**事实**：
- `apps/mobile/src/ai/AssistantScreen.tsx:120` `const MOBILE_CLOUD_HARNESS = true;`，而紧邻的 `:119` 注释写「默认关（只读），开启后 runTurn 走 runMobileCloudTurn」——**注释与取值相反**。
- 该分支注入 `cloudTurn`（`:230-247`）→ `runMobileCloudTurn`（`apps/mobile/src/ai/cloud-harness.ts:63`）→ `createAutoWriteLocalToolTransport`（`cloud-harness.ts:68`）。该传输对写工具**直接执行落库**：`packages/app-host/src/ai-local-tools.ts:87-97`（`proposal` → `executeAiToolProposal` 真写，仅 `destructive-irreversible` 才拦）。即**移动端默认走 auto-write，写会真落库**。
- 另有两处注释同样失真：`apps/mobile/src/ai/chat-controller.ts:65`「当前移动端为**只读**」；`apps/mobile/src/ai/cloud-harness.ts:5`「写操作只出确认提案」。
- 验收证据缺失：`docs/plans/2026-11-22-agent-harness-status.md:38` 明写「**尚未把 AssistantScreen/AssistantPanel 的默认交互切到新入口**……切换会牺牲流式/历史/提案 UI，需产品决策 + UI 验收」；`docs/plans/2026-11-22-agent-harness-impl-audit.md:128`「**移动端 Hermes 真机：未跑**」。
- git：`7c11818e`「MOBILE_CLOUD_HARNESS 开关默认关只读」→ `f7736d15`「P0-1 UI 回只读」→ **`a7fba535`「MOBILE_CLOUD_HARNESS=true」**。即开关是被单独一次提交翻开的，翻的同时没改 `:119` 注释。

**为什么是 P0（事实+推断）**：默认路径 = 未经真机验收的写库能力，且 side effect 不可在界面上预览（见 P1-4 回执）。注释/文档三方口径是"只读"，只有代码是"可写"，后续维护者会按注释误判。对照 Web 侧：`apps/web/src/App.tsx:2690` 的 `useCloudHarness` 由 `?cloudHarness=1` 显式开启，**Web 是 opt-in，Mobile 是 opt-out→默认 on**，两端不对称。

**建议**：`MOBILE_CLOUD_HARNESS` 默认 `false`，用 URL/构建期开关或设置项灰度，与 Web 对齐；翻 true 前需真机跑一遍"多步写 + 撤销"，并把 `:119`、`chat-controller.ts:65`、`cloud-harness.ts:5` 的"只读"注释同步为事实。

---

## P1

### P1-1 撤销范围过宽：`undoSince(seqBefore)` 会撤到"无关写"

**事实**：
- 撤销链：UI → `undoWebCloudTurn`/`undoMobileCloudTurn` → `undoLastAiTurn`（`packages/app-host/src/ai-turn-orchestrator.ts:77-82`）→ `engine.undoSince(seqBefore)`。
- `packages/op-log/src/engine.ts:621-629`：`undoSince` 取 `getOpsSince(fromSeqExclusive, 1000)`，只按 `row.op.clientId === this.clientId` 过滤，**然后把这区间内该 clientId 的全部 op 删除**。**不按 runId / 不按发送归属过滤**。
- 后果（推断，机制确定）：AI 写完后、用户点"撤销"前，用户在同一台设备同一 engine 上做的**任何**本地写（如切到 Tasks tab 完成任务、改便签）都落在 `seq > seqBefore`，会被一并撤销。
- 窗口被拉长：撤销按钮**常驻无超时**（Web `AssistantPanel.tsx:1117`；Mobile `AssistantScreen.tsx:564`），只在 `phase==='idle'` 显示、下一次写触发它被覆盖时消失。移动端各 tab 共用同一 engine，切 tab 期间按钮仍在。
- 安全路径已有但未接：`ai-run-ledger.ts:14-18` 自认「只记录、不执行回滚……按 run 回滚需要 op-log 暴露显式反向重放 API——那是下一步」；而 `engine.undoOperations(opIds)`（`:607`）**已存在**，只是 harness 没按 run 的 opId 去调。

**对任务问题 2 的直接回答**：
- "多步写、全部 ok" → `wrote = steps.some(ok)` 为真（Web `:564`、Mobile `:243`）→ 设 `seqBefore`，`undoSince` **能覆盖整段**（按 seq 段，天然覆盖）。
- "部分失败" → `steps.some(ok)` 仍为真 → 仍设 `seqBefore`；失败步通常没写 op（无影响），但区间内**无关写会一起被撤**（即上面的过宽）。
- "先做别的操作再点撤销" → **会撤到无关写**（P1 成立，机制见 `engine.ts:621-629`）。

**建议**：改为按 run 归集 opId 后 `undoOperations(opIds)`；或给 `undoSince` 增加 `runId`/`opIds` 白名单过滤。至少 UI 在检测到"区间内有非本 run 写"时要求二次确认。

### P1-2 撤销结果不校验、错误不捕获：会谎报"已撤销"

**事实**：
- `undoSince` 可能返回 `applied | partial | stale | empty`（`engine.ts:111-119`），`stale`=被别端改过、`partial`=部分撤不了、`empty`=什么都没撤。
- Web 按钮 `AssistantPanel.tsx:1122-1129`：先 `setHarnessUndoSeq(null)`（清得比结果早），再 `await undoWebCloudTurn(seq)`，**不 try/catch、不读返回值**，随后无条件 `append(... undoAiTurnDone)`（"已撤销这次 AI 操作"，zh-CN.ts:2281）。⇒ `partial/stale/empty` 也报"已撤销"。
- 若 `undoWebCloudTurn` reject（如 adapter 已销毁），它跑在 `void (async()=>{})()`（`:1123`）里 ⇒ **unhandled rejection**；且按钮已被清、成功文案也没 append，用户只看到按钮消失——**静默失败**。
- Mobile `AssistantScreen.tsx:570-576`：无 try/catch、无返回值处理，**连"已撤销"回执都不给**（与 Web 不一致），按钮消失即无任何反馈。

**建议**：`try { const r = await undo...; if(r.status==='applied') receipt('已撤销'); else receipt('部分/未撤销：'...) } catch { receipt('撤销失败') }`；清 `harnessUndoSeq` 放到结果分支内。回执文案应走 `t()`。

### P1-3 跨引擎"撤错库"守卫恒失效（stale-engine 永远不会触发）

**事实**：
- Web 设计意图（`apps/web/src/features/ai/cloud-harness.ts:26-31` 注释）：绑定"取 seq 时的那个引擎"，撤销时若换引擎返回 `stale-engine`。
- 但实现：`undoWebCloudTurn(seq)`（`:84-86`）→ `undoLastAiTurn({ undo: webUndoBindings() })`，**每次调用都新建 `webUndoBindings()`**，其内部 `const engine = requireEngine()` 捕获的是**当前**引擎（`:34`）；随后 `undoSince` 里 `requireEngine() !== engine`（`:38`）比较的是"当前 vs 当前"，**恒为 false** ⇒ 守卫恒通过。
- 若两轮之间引擎换代（`apps/web/src/lib/oplog.ts:41` 模块级单例可被注销/清数据重置），会用**旧库的 seqBefore 去撤新库**（`requireEngine` 返回新引擎），撤错或静默 `empty`。
- Mobile 同构：`undoMobileCloudTurn(host, seq)`（`apps/mobile/src/ai/cloud-harness.ts:85`）→ `mobileUndoBindings(host)` 用**调用时**的 `host.engine`；`:42` 的 `host.engine !== engine` 恒 false。且 `runMobileCloudTurn(host,...)`（`:68`）与 `undoMobileCloudTurn(host,...)`（`:85`）是两次**独立**传入 host，API 不强制同一实例——传新 host 就用 A 的 seq 撤 B。

**建议**：运行前把"捕获了引擎的 bindings（或 host 实例）"和 `seqBefore` 一起存进组件状态，撤销时直接用存量 bindings，不要重建；或 `runXCloudTurn` 返回一个不可伪造的 undo token。

### P1-4 mobile `host!` 非空断言不安全

**事实**：
- `AssistantScreen.tsx:574` `await undoMobileCloudTurn(host!, seq)`。
- `host` 来自 `useTaskHost`，类型 `AppHost | null`（`apps/mobile/src/db/use-task-host.ts:43-45`；注销/换代时为 `null`）。
- 按钮渲染条件 `harnessUndoSeq !== null && snapshot.phase === 'idle'`（`:564`）**不看 host**。若此时 host 为 null，`host!.engine`（`cloud-harness.ts:38`）抛 `TypeError`，且发生在 `void (async()=>{})()`（`:571`）内 ⇒ unhandled rejection，按钮已消失、无提示。

**建议**：`if (host === null) { /* 提示宿主未就绪 */ return; }` + `try/catch`。

---

## P2

- **P2-1 写回执粒度薄（D1 允许，但偏薄）**：只加后缀 `t('web.ai.chat.harnessApplied')`＝「已执行（可撤销）」（`packages/i18n/src/locales/zh-CN.ts:2282`）。未说明"写了什么/几条"。`ai-run-ledger.ts:8-9,68` 已能按 executionId 归集，但 UI 未消费。建议回执至少「已执行 N 条 · 撤销」。（D1 要求"至少可撤销即可"，故不升 P1。）
- **P2-2 硬编码中文绕过 `check:ui-language`**：`apps/web/.../AssistantPanel.tsx:41`、`:50` 与 `apps/mobile/.../AssistantScreen.tsx:240` 用模板字面量 `` `出错：${res.error}` ``；`chat-controller.ts:484` `'request failed'`。**事实**：`scripts/check-ui-language.mjs:66-73` 的候选只来自 JSX 属性与 JSX 裸文本节点，`text: \`…\`` 这种对象字面量不在视野 ⇒ 门禁抓不到。英文用户在错误态会看到中文"出错："。
- **P2-3 `as MessageKey` 绕过类型校验**：`AssistantScreen.tsx:244`、`:567` 用 `t('web.ai.chat.harnessApplied' as MessageKey)` / `t('web.ai.chat.undoAiTurn' as MessageKey)`；同一 key 在 Web（`AssistantPanel.tsx:1131`）**不用** cast。`packages/i18n/src/index.ts:7,50-51` 的立意是"key 拼错＝编译错误"，`as` 让它退化到运行时 undefined。key 已在 `MessageKey` 联合内，断言多余，建议删。
- **P2-4 harness 路径静默丢图**：`chat-controller.ts:284,294` 把 `images` 传给 `runTurn`，但 `runtime.cloudTurn?: (text: string) => ...`（`:68`）只收 text；`AssistantScreen.tsx:232` `cloudTurn: async (text) => …` 丢弃 images ⇒ harness 下带图发送图片不生效。
- **P2-5 撤销按钮位置（未核渲染）**：Mobile 按钮是 ScrollView 与 `ChatComposer` 之间的兄弟 `Stack`（`AssistantScreen.tsx:564-579`），文档流内、出现时把 composer 上推，**从布局看未遮挡输入**（事实）。Web 按钮在列表后（`AssistantPanel.tsx:1117`），同在面板流内。**未核**：真实渲染/键盘弹出时是否挤压 composer，需 Playwright/真机截图；无超时叠加 P1-1 的撤销窗口。
- **P2-6 UI 层零自动化测试；附最小可转红用例**：
  - 现状（事实）：库层已有 `packages/app-host/tests/ai-turn-orchestrator.spec.ts`（覆盖 seq→turn→undo、中途失败保 seqBefore）与 `packages/op-log/tests/undo-run.spec.ts`（`undoSince` 基本/`empty`）；**UI（`AssistantPanel`/`AssistantScreen`）零测试**；`undoSince` 测试（`undo-run.spec.ts:105-133`）**未覆盖**"AI 段中间夹一条用户无关写" ⇒ 这正是 P1-1 的可转红缺口。
  - 建议最小用例（纯函数/状态机层，不依赖渲染）：
    1. `undo-run.spec.ts` 加：`before = currentLocalSeq()` → dispatch t2（模拟 AI 写）→ dispatch t3（模拟用户无关写）→ `undoSince(before)` → **断言 t3 未被撤**（当前实现会撤，故转红）。
    2. `ai-turn-orchestrator.spec.ts` 加：transport 一步 `executed`、一步 `failed` 的混合轮 → 断言 `undoLastAiTurn` 只把成功段的 opId 纳入范围。
    3. 抽纯函数 `undoReceiptFor(status)`（`applied/partial/stale/empty` → 文案 key），对四态各一断言；UI 只做渲染该结果。

---

## 附：任务问题逐条落点

1. 默认开启风险 → **P0-1**（默认 true、注释/文档说只读、无真机验收；建议默认 false/灰度）。
2. 撤销正确性/范围 → **P1-1**（多重写全 ok 可整段覆盖；部分失败/夹无关写会过宽；`undoSince` 按 clientId+seq 段、无 runId 过滤，`engine.ts:621-629`）。
3. state 泄漏 → 事实：`live` 在 `phase idle` 已 `undefined`、`createAiToolHost()` 每轮重建（`cloud-harness.ts:64`）非全局，**无 live/registry 泄漏**；但 `setHarnessUndoSeq(null)` 早于 `await` 致错误静默 → **P1-2**；mobile `host!` → **P1-4**；跨引擎 stale 守卫失效 → **P1-3**。
4. 写回执 → **P2-1**（仅"已执行（可撤销）"；D1 最低线满足但粒度薄）。
5. 一致性 → **P2-2**（硬编码中文门禁盲区）、**P2-3**（`as MessageKey`）、**P2-5**（按钮位置未核）。
6. 测试 → **P2-6**（UI 零测试 + 三条最小可转红用例）。

---

## 处置（Lead 终审，2026-11-22）

| 审计项 | 处置 |
|---|---|
| **P0-1 移动默认开 auto-write 未真机验收 + 文档自相矛盾** | ✅ **已修**：`MOBILE_CLOUD_HARNESS` 改回 **false**（默认不改变移动助手行为，与 Web `?cloudHarness=1` 对齐）；相关注释改为"默认关/需真机验收后开启"；状态文档同步更正。 |
| P1 撤销先清状态后 await、不校验 applied、无 catch → 谎报 | ✅ **已修（Web）**：适配器返回**绑定本轮引擎**的 `undo()`；面板只在 `status==='applied'` 时报"已撤销"，否则如实显示状态；全程 try/catch。 |
| P1 stale-engine 守卫失效（每次重建 bindings） | ✅ **已修（Web）**：`runWebCloudTurn` 捕获一次 bindings，`undo` 闭包复用同一引擎实例，守卫有效。 |
| P1 mobile `host!` 非空断言 | ✅ 改为 `host !== null` 守卫。 |
| P1 `undoSince` 无 runId 过滤，夹无关写会误撤 | ⚠️ 记录：范围撤销的固有语义；AI 读不写、写集中在单轮，实际风险低。已在文档注明。 |
| P2 回执仅"已执行"、硬编码"出错："、带图发送 | ⚠️ 记录，未改（非阻断；真机验收时一并处理）。 |
| UI 零自动化测试 | ⚠️ 记录；Web `vite build` + 三端 tsc 为当前证据，真机验收待做。 |

验证：web/mobile tsc 0 错；回归 ai 338(+1既有失败)/op-log 182/app-host 36/server 19/node-host 1。
