# Web / Mobile 云端 Agent 适配器审计（第五轮）

> 只读审计。审计对象：
> - `apps/web/src/features/ai/cloud-harness.ts`（68 行）
> - `apps/mobile/src/ai/cloud-harness.ts`（73 行）
> - 依赖：`packages/app-host/src/{ai-turn-orchestrator,ai-local-tools,ai-cloud-assistant,ai-cloud-tools,agent-harness,oplog(web)}`
>
> 图例：**事实**＝直接读到代码/命令输出；**推断**＝基于事实的推理，未实测；**未核**＝本轮未查证。
> 依据命令均已在本仓执行，行号为当前 HEAD 工作区。

---

## 0. 两个文件做了什么（事实）

两个文件结构完全同构，都是"接入点薄壳"：

| 职责 | web | mobile |
|---|---|---|
| 撤销绑定 | `webUndoBindings()` 调 `requireEngine()`（`cloud-harness.ts:26-31`，`requireEngine` 在 `:28`/`:29`） | `mobileUndoBindings(host)` 用 `host.engine`（`:34-39`，`:36`/`:37`） |
| 本地工具宿主 | `createAiToolHost()`（`:51`，来自 `features/tasks/store.ts:336`） | `toolHostOf(host)`＝`createLocalApiHost(...)`（`:27-31`） |
| 本地传输 | `createLocalToolTransport({host, grants, getGrants:()=>deps.grants})`（`:52`） | 同（`:59`） |
| 跑一轮 | `runAiTurnWithUndo`（`:54-61`） | 同（`:60-67`） |
| 撤销 | `undoLastAiTurn({undo:webUndoBindings()}, seqBefore)`（`:66-67`） | 同（`:71-72`） |

底层编排（`ai-turn-orchestrator.ts`）：`seqBefore = await undo.getSeq()`（`:54`）→ `requestCloudAssistantTurn`（`:55`）→ 返回；撤销 `undoLastAiTurn` 就是 `bindings.undo.undoSince(seqBefore)`（`:67`）。

---

## P0

### P0-1 两个适配器**没有任何调用点**，"接口就绪 ≠ 用户可用"——现状是死入口（事实）

- 全仓检索 `runWebCloudTurn` / `webUndoBindings` / `undoWebCloudTurn` / `runMobileCloudTurn` / `mobileUndoBindings` / `undoMobileCloudTurn`，**除自身文件外零命中**（`grep -rn ... apps packages | grep -v cloud-harness.ts` → 空）。
- 全仓 `grep "cloud-harness"` → **无任何 import**（exit 1）。两个文件从未被任何模块加载。
- 真实 UI 仍走旧链：
  - Web：`apps/web/src/features/ai/AssistantPanel.tsx:93` import 的是 `requestAssistantTurn`，`:543` 调用它（旧"本地循环 + 写只出提案并 `stopsHere`"）。
  - Mobile：`apps/mobile/src/ai/AssistantScreen.tsx` 走 `controller.*`（会话控制器），**不 import** `runMobileCloudTurn`。
- 结论：云端 Agent（`runCloudAgentTurn` 设备本地循环 + `invokeRouted` 云端模型）**在 Web/Mobile 上当前不可触达**，用户用的仍是旧路径。

**是否应计入 `check:ai-coverage` 类问题**：是。`scripts/check-ai-coverage.mjs:3` 的立意正是"**声明的 AI 功能必须真的能走到**"（`:38` "界面真的可达…对每一端分别查"），其反面就是"**功能是空的、界面在说谎**"（`:17`）。这两个适配器属于"功能已写好、但没有任何 UI 接线"，正好落在这条门禁的语义缺口里：门禁按 `AiFeature` 联合类型逐条查接线，而这两个函数**不在 `AiFeature` 轴上**，因此门禁看不见它们（事实：`check-ai-coverage.mjs` / `check-reachability.mjs` 均不扫 `cloud-harness|runWebCloudTurn|runMobileCloudTurn`）。
→ 建议：要么把云端 Agent 作为一条真正的 `AiFeature` 接进 `AssistantPanel`/`AssistantScreen` 再报"已接入"；要么在计划/状态文档里明确标"未接线"，避免被当成已完成能力。

**补充（为什么现有门禁抓不到，事实）**：`check:reachability.mjs` 的立意恰恰是「基础设施做完了、**最后一米没接**」（`:3-12`，判据出自 `site-and-parity-alignment.md` §C-8），但它**按 `EntityModelMap` 的每个实体**查"①有 action ②至少一个宿主调用点"（`:13-16`）。`runWebCloudTurn`/`runMobileCloudTurn` 不是实体，是**功能入口函数**，因此**逃出了这条门禁的扫描面**——这正是"同类形状"的机制漏洞：门禁只覆盖实体粒度，覆盖不到"功能入口已写、但无人接"这一层。`check:ai-coverage` 同理只覆盖 `AiFeature` 轴。两个门禁的语义都指向本条问题，但都因**维度不同**而漏掉它。

### P0-2 撤销绑定**没有引擎身份戳**，跨账号/换库/重初始化时 `undoSince` 可能作用到**另一份 op-log（撤错库）**（机制为事实，触发路径部分推断）

机制（事实）：
- Web `engine` 是**模块级单例可变变量**：`apps/web/src/lib/oplog.ts:41` `let engine: OpLogEngine | undefined`；`requireEngine()`（`:578-584`）每次返回**当前** engine，未初始化则抛错。
- engine 会被替换/清空：`initOpLog` 里 `engine = new OpLogEngine(...)`（`:537`）；`engine = undefined` 出现在 `destroyLiveStorage`（`:310`）、init 失败回滚（`:556`）、`__resetOpLogForTests`（`:872`）。
- `seqBefore` 只是**一个裸数字**（`ai-turn-orchestrator.ts:54`），不携带"来自哪个 engine"的信息。`webUndoBindings()` 在**跑轮**和**撤销**两次调用里都重新 `requireEngine()`（`cloud-harness.ts:28-29`）。

触发路径（部分已核实）：`destroyLiveStorage()` 的**真实调用点**是 `apps/web/src/lib/local-data-destruction.ts:309`（`eraseWebLocalData`），而 `eraseWebLocalData` 被 `apps/web/src/main.tsx:49` 与 `CloseAccountPanel.tsx` 引用（注销/清本地数据流程）；该函数置 `engine = undefined`（`oplog.ts:310`），随后重开走 `initOpLog` 生成**新 engine**（`oplog.ts:537`）。⇒ "注销/清数据 → engine 更换"这条**成立（事实）**；"普通切换账号是否必走同一条 erase 路径"**未核**。

后果（推断）：一轮云端 Agent 是**多步、跨秒到分钟**的异步过程。若在此期间用户切换账号 / 换库 / 存储销毁后重开（会走 `destroyLiveStorage` + `initOpLog`，engine 被换新），则：
- 撤销时 `requireEngine()` 返回的是**新 engine**，用**旧 engine 的 seq 编号**对新日志 `undoSince`；
- 新旧日志是两套独立序号空间 ⇒ 保守情形是"撤销不到任何东西"（静默失败），激进情形是新库 seq 更大时**误删/回退不相关写入**。
- 这正是任务点名担心的"undoSince 用错引擎 ⇒ 撤错库"。

Mobile 略微好一点但同类（事实+推断）：`mobileUndoBindings(host)` 用**入参 host** 的 `host.engine`，而 `AppHost.engine` 是 `readonly engine: OpLogEngine`（`packages/app-host/src/host.ts:254`），即**按 host 实例钉死**，比 web 的全局单例更安全。但 `seqBefore` 仍是裸数字，`runMobileCloudTurn` 与 `undoMobileCloudTurn` 是**两次独立传入 host**（`cloud-harness.ts:65` vs `:72`）——若撤销时调用方传入的是"另一个/新的 host"，同样会出现"用 A 的 seq 去撤 B"的错配。API 没有强制"必须是同一 host 实例"。

建议（最小修复，写进后续改动而非本轮）：
- 让 `seqBefore` 结果携带 engine/host 身份（如 `generation` 计数或引用标识），`undoSince` 前先校验"当前 engine 与记录时一致"，不一致则**拒绝撤销并回执"数据源已切换，无法撤销"**（fail-closed），而不是盲撤。
- 或：run 时 `const eng = requireEngine()` 一次，`getSeq`/`undoSince` 都闭包复用**同一个 `eng` 引用**（撤销阶段不再重新 `requireEngine()`），至少保证撤销打在同一对象上。

---

## P1

### P1-1 撤销**无上界 seqAfter**：会把 AI 运行期间/之后用户自己的编辑一起回退（事实：编排层只有下界）

- `runAiTurnWithUndo` 只记录 `seqBefore`（`ai-turn-orchestrator.ts:54`），**不记录 `seqAfter`**；`undoLastAiTurn`＝`undoSince(seqBefore)`（`:67`）。
- 由于本适配器用**本地传输**，写操作**只出提案**，真正落库发生在用户后续点确认（走 `executeAiToolProposal`，另一条路径）。也就是说真实写入时间**晚于** `seqBefore` 捕获时刻。`undoSince(seqBefore)` 的时间窗是"turn 开始 → 撤销时刻"，**中间用户手点的一切本地编辑也会被一起撤销**。
- 这不是适配器新增的缺陷，而是它**照搬了编排层的语义**；但适配器对外暴露成"撤销这次 AI 操作"，用户预期是只撤 AI 的写。建议适配器在 turn 结束后补记 `seqAfter` 并在撤销时传"区间"，或在文档/回执里如实说明撤销是"回退到本轮之前"。

### P1-2（保留项）撤销注释与实现口径不符，易误导后续接线者

- `cloud-harness.ts:65`（web）注释："AI 读不写；写发生在确认流程后单独撤销"；`ai-turn-orchestrator.ts:60` 注释："云端工具路径的写入在服务端，不走这里"。
- 事实：这两个适配器用 `createLocalToolTransport`（**本地**），不是 `createHttpCloudToolTransport`。"写发生在服务端"的注释**与本地传输实现不符**。接的人可能误以为本地写无需撤销。建议改注释，避免按错误心智接线。
- （web 的 `:65` 与 mobile 的 `:71` 都直接对外暴露 `undoLastAiTurn`，语义同上。）

---

## P2

### P2-1 `getGrants: () => deps.grants` 让运行期授权刷新失效（事实）

- `runSelectedTool` 在**执行时**才取授权：`const currentGrants = deps.getGrants?.() ?? deps.grants`（`ai-tool-run.ts:300`），再 `isToolGranted(currentGrants, tool)`（`:301`）——设计上 `getGrants` 是为了"执行期拿最新授权"。
- 但适配器传的是 `getGrants: () => deps.grants`（`cloud-harness.ts:52` / `:59`），与同时传入的 `grants: deps.grants` **是同一个捕获值**。`deps` 在 `runWebCloudTurn` 入口就固定，**一轮内授权若在 UI 被撤销，本地工具执行仍用旧 grants**（`getGrants` 形同虚设）。
- 影响有限（单轮、且本地写还卡在"提案→确认"），故列 P2；但 API 形状诱导误用。建议改成从真实 store 读活授权（如 `() => currentGrantsFromStore()`），或去掉这个看似支持刷新、实则不刷新的参数。

### P2-2 每轮新建工具宿主：廉价、无状态丢失（事实，非缺陷，供决策留档）

- Web `createAiToolHost()`（`store.ts:336`）内部 `createLocalApiHost(actionContext, taskActions, {...})`；`createLocalApiHost`（`local-api-host.ts:439`）每次**重新构造** `createProjectActions/Habit/Note/Focus/Reminder/Event` 等约 7 个动作对象（`:466-471`）。
- 状态不在这些对象里（状态在模块级 `actionContext`/engine 单例），所以**不会丢状态**；开销是每轮建几个轻量闭包对象，**不昂贵**。
- 注意两点差异（未核是否影响功能）：`createAiToolHost()` 未传 `options`（`:51` 无参）⇒ `memoryEnabled` 默认关、`getDurationPreferenceHints` 不生效；若 `AssistantPanel` 侧 `requestAssistantTurn` 显式传了这些选项，切换过来会有行为差。**未核** `requestAssistantTurn` 调用处是否传 options。
- Mobile `toolHostOf` 传 `isReadable: () => true`（`cloud-harness.ts:29-30`）与 Web `createAiToolHost` 的 `isReadable:()=>true` 一致；`createLocalApiHost` 第 3 参注释明确"必填以防隐私开关静默 fail-open"（`local-api-host.ts:442-458`），当前 heyta 无"受保护条目"产品概念（ADR-0011 §6.1），所以 `true` 是如实的。**将来接入解密失败路径时，这两处都要改**，属遗留风险点。

### P2-3 写操作 `write-needs-confirm` 在 adapter 层被正确保留（事实，✓ 符合预期）

- `toolRunToCloudResult`（`ai-local-tools.ts:34-40`）：`proposal` → `{ok:false, reason:'write-needs-confirm', message:'「tool」是写操作…'}`。
- `runCloudAgentTurn`（`agent-harness.ts:156-162`）：`if (result.ok)` 才当成功；否则 `ok=false`、`content='工具执行失败：…'` 回给模型。
- 适配器**原样透传** transport，不做二次包装 ⇒ 写不会被当成成功、不会被静默执行。✓
- 泄漏面：`write-needs-confirm` 的 message 只带**工具名**，不带参数/正文（`ai-local-tools.ts:38`）。只读工具的 `result.data` 会 `JSON.stringify` 回灌模型（`agent-harness.ts:157`），那是**出境**，受 `invokeRouted`/consents 管；适配器未额外泄漏正文。✓

### P2-4 token / 出境仍经 `invokeRouted`（事实，✓）

- 模型调用走 `createRoutedModelCall`（`ai-cloud-assistant.ts:49`）→ 默认 `invokeRouted`（`ai-routed-model.ts:152`，文件头 `:3` 注明"唯一出境执行点：云端网关 + 出境闸门 + 熔断"）。
- 工具是**本地执行**，不发 HTTP、不需要 token（对比 `createHttpCloudToolTransport` 才用 `getToken`，本处未用）。所以"token 不出现在 URL/只走 Authorization"这条对本适配器**不适用**（它压根没有工具 HTTP），出境只发生在模型请求。✓

### P2-5 可移植性（事实）

- Mobile 适配器 import：`createLocalApiHost/createLocalToolTransport/createTaskActions/runAiTurnWithUndo/undoLastAiTurn/AppHost/CloudAgentTurnResult/TurnUndoBindings`（`cloud-harness.ts:14-23`）+ `@heyta/ai`/`@heyta/local-api` 的**类型**。抽查 `ai-local-tools/ai-cloud-assistant/ai-cloud-tools/agent-harness/ai-tool-run/local-api-host/actions/host` **均无 `from 'node:`/`require('node:`**（grep 空）。⇒ **未引入 node 内置或桌面专属模块**。✓
- Web 适配器 `import { requireEngine } from '../../lib/oplog.js'`（`cloud-harness.ts:22`）：`oplog.ts` 依赖 `IndexedDbAdapter` 与 `Worker`（浏览器专属，见 `oplog.ts:42`/`:50`）。在 **Web 运行期没问题**；但若想给这个适配器写 **node 单测**，直接 import 会连带拉入 IndexedDB/Worker，需 mock 模块。这是"可测试性"障碍，不是运行缺陷（见 P2-6）。

### P2-6 测试建议（当前两文件**零自动化测试**，事实）

- 现状：`find` 无 `*cloud-harness*.spec/test`；无任何测试 import 这两个文件。
- 最小可加、可转红的三条（用**假 AppHost / 假 LocalApiHost**，不必真网络）：
  1. **写→write-needs-confirm 未被吞**：构造假 `LocalApiHost`，让某个写工具在 `runSelectedTool` 走的路径返回 `proposal`；断言 `createLocalToolTransport(...).invoke(writeTool, args)` 返回 `{ok:false, reason:'write-needs-confirm'}`，且假 host 的 `submit` **调用次数为 0**（呼应 `ai-tool-run.ts:19-21` 的"数 submit 次数"纪律）。
  2. **撤销绑定被正确转发**：用假 `undo={getSeq:()=>41, undoSince:(s)=>{seen=s; return 'applied'}}`，调 `runAiTurnWithUndo('hi',{...,、undo})`（`invoke` 注入一个只回文本、不调工具的假模型），断言返回 `seqBefore===41`；再调 `undoLastAiTurn({undo},41)`，断言 `seen===41`。
  3. **跨引擎守卫（对应 P0-2，若实现修复）**：让 `getSeq` 返回 engine A 的 seq，撤销前把"当前 engine"换成 B，断言撤销**拒绝**（fail-closed），而不是调用 B 的 `undoSince`。
- 这三条都能在纯 node 里跑（第 1、2 条不需要 import `apps/web/.../cloud-harness.ts` 的 `oplog.js`；可把 setup 逻辑下沉，或对 `oplog.js` 做 mock）。若坚持测 `runWebCloudTurn` 本体，需 `vi.mock('../../lib/oplog.js')`（因 P2-5）。

---

## 附：结论一句话

- **正确性**：撤销绑定把 `seqBefore` 当成裸数字跨引擎传递，是**撤错库**的真实风险（P0-2）；`getGrants` 刷新是假的（P2-1）；每轮建 host 廉价无状态丢失（P2-2）。
- **可触达**：两适配器**零调用点、零 import**，云端 Agent 在 Web/Mobile 实际不可用，UI 仍走旧 `requestAssistantTurn` / controller（P0-1）——这值得进 `check:ai-coverage` 口径。
- **安全**：写只出 `write-needs-confirm` 且 adapter 正确保留、未泄漏正文（P2-3）；出境只经 `invokeRouted`（P2-4）。
- **可移植**：mobile 无 node/桌面依赖（P2-5 ✓）；web 的 `oplog.js` 只影响 node 单测（P2-5）。
- **测试**：零测试；给了三条最小可转红建议（P2-6）。

未核项：① P0-2 中"普通切换账号（非注销/清数据）是否也必然重建 engine"（注销/清数据重建 engine 已核实为事实，见 P0-2）；② `requestAssistantTurn` 调用处是否传 `memoryEnabled/getDurationPreferenceHints`（影响 P2-2 行为差）。已核实：`check:reachability` 只按 `EntityModelMap` 实体查、`check:ai-coverage` 只按 `AiFeature` 查，故两者都覆盖不到非实体/非 feature 的 `cloud-harness`（非"被 apps 排除"，是**维度不覆盖**）。

---

## 处置（Lead 终审，2026-11-22）

| 审计项 | 处置 |
|---|---|
| **P0-2 撤销绑定无引擎身份 → 跨库撤错** | ✅ **已修**：Web `webUndoBindings()` 捕获 `requireEngine()` 实例，撤销时若 `requireEngine() !== engine` 返回 `{status:'stale-engine'}`；Mobile `mobileUndoBindings(host)` 捕获 `host.engine`，撤销时若 `host.engine !== engine` 同样返回 `stale-engine`。**绝不把旧 seq 作用到新引擎。** web/mobile `tsc` 0 错。 |
| **P0-1 适配器零调用点（接口就绪≠用户可用）** | ⚠️ **记录为已知、刻意不强行接线**：面板用 `requestAssistantTurn` 含流式/历史/提案 UI，直接切换会**功能倒退**。已在 web 适配器头注释写明，并纳入状态矩阵"未完成项 1"。需产品决策 + UI 验收后切换；非本轮可安全完成。 |
| P1 撤销无上界 `seqAfter`（可能吞用户窗口内编辑） | ⚠️ 记录：`undoSince` 是范围撤销；AI 读不写、写走确认单 op（可普通 undo），故实际风险低。文档已注。 |
| P1 注释称"写服务端"与本地传输实况不符 | ✅ 已更正 web 适配器注释。 |
| P2 `getGrants` 刷新失真、每轮建 host、write-needs-confirm 保留正确、无 node 依赖、出境仅经 invokeRouted | ✅ 复核确认（除 getGrants 为已知简化，记录）。 |
