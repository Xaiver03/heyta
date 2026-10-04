# AI 架构参考

> 本文件是 **heyta AI 结构性事实的唯一事实源**：有哪些模块、每层负责什么、
> 哪些类型字面量是封闭的、哪些不变量是硬的、数据从哪流到哪。
>
> **它不回答"为什么"和"下一步做什么"。** 分工是：
>
> | 想知道… | 读 |
> |---|---|
> | AI 做成什么样、为什么、下一步 | [`../plans/ai-strategy.md`](../plans/ai-strategy.md)（**入口文档**） |
> | 进度与测试数字 | [`../plans/ai-strategy.md`](../plans/ai-strategy.md) §7 |
> | 能力怎么拆、怎么排期、git 分支怎么分 | [`../plans/ai-capability-branches.md`](../plans/ai-capability-branches.md) |
> | 记忆系统怎么实施 | [`../plans/ai-memory-system.md`](../plans/ai-memory-system.md) |
> | 决策（**不可变**） | [ADR-0005](../adr/0005-ai-data-path.md) / [0006](../adr/0006-supply-modes.md) / [0010](../adr/0010-ai-config-routing.md) / [0011](../adr/0011-local-api-mcp.md) / [0013](../adr/0013-cloud-ai-and-maas.md) / [0014](../adr/0014-memory-switch-and-corrections.md) |
> | 竞品证据与调研结论 | [`../research/ai-competitive-and-architecture.md`](../research/ai-competitive-and-architecture.md)、[`../research/ai-feature-landscape.md`](../research/ai-feature-landscape.md)、[`../research/e2ee-apps-ai.md`](../research/e2ee-apps-ai.md) |
>
> 本文描述**代码现在长什么样**，因此随代码演进。ADR 是 🔒 不可改的；两者冲突时
> 以 ADR 为准，并改本文。
>
> 仓库地图见 [`../../AGENTS.md`](../../AGENTS.md) §2；AI 的硬性约束在 §3。

## 0. 读法

| 标记 | 含义 |
|---|---|
| 🔴 | **硬不变量**。改它等于改产品承诺，必须走新 ADR |
| ⚠️ | 容易搞错 / 有反直觉之处 |
| ✅ | 已落地并有测试 |
| 🔲 | 契约已定，但**产品里没有生产者**（见 §15） |
| 未核实 | 本文没有验证过，不要在别处当结论引用 |

「行数」用于说明模块体量，`wc -l` 实测。测试条数**不写在这里** —— 那是
[`../plans/ai-strategy.md`](../plans/ai-strategy.md) §7 的职责，避免两处漂移。

---

## 1. 一页总览

heyta 的 AI 是**双向**的，两个方向**在不同的包里、有不同的信任模型、默认都是关**：

```
                        出站（我们发数据给模型）          入站（别的程序拉我们的数据）
                        ─────────────────────           ──────────────────────────
  包                    packages/ai                     packages/local-api
  信任模型              用户的明文会离开设备            别的程序会读你的任务
  默认                  enabled=false                   enabled=false + 逐工具 false
  依据                  ADR-0005/0006/0010               ADR-0011
  消费者                packages/app-host               apps/node-host（HTTP + stdio）
```

🔴 **两个包刻意不合并**（ADR-0011 §2）：放一起会在类型层面把「我们发数据出去」
和「别人拉数据进来」混为一谈。

### 1.1 模块地图

| 路径 | 行数 | 职责 |
|---|---|---|
| `packages/ai/src/supply.ts` | 321 | 供给模式 `off`/`own`/`managed`；**由端点推导目的地**；托管不可启用的判据 |
| `packages/ai/src/egress.ts` | 182 | 出境闸门。授权绑定 `(功能, 目的地)`；切换模式时失效旧授权 |
| `packages/ai/src/provider.ts` | 348 | 单一 provider 端口，OpenAI 兼容 HTTP；**只产出建议，产生不了 op**；含工具线格式（`AiInvocation.tools` / `extractToolCalls`）；⚠️ 单端点/测试/历史路径，**不是生产出境执行点** |
| `packages/ai/src/routing.ts` | 980 | 多端点路由、能力声明匹配、回退、熔断接线、`invokeRouted()`（**生产唯一出境执行点**）；**回退不得跨越隐私边界** |
| `packages/ai/src/health-store.ts` | 263 | 端点健康的落盘/读回；**读回来的东西不可信且必须封顶** |
| `packages/ai/src/presets.ts` | 116 | 内置端点预设（**只有本机**）；`presetDestinations()` 让"预设都是本机的"可断言 |
| `packages/ai/src/index.ts` | 130 | 四层的收窄说明与再导出 |
| `packages/domain/src/capture.ts` | 537 | 规则式快速捕获（**这不是 AI**，是 AI 的确定性对手） |
| `packages/domain/src/memory.ts` | 360 | 特征层：从事件流算事实（推迟次数、专注落差…） |
| `packages/domain/src/recall.ts` | 171 | 确定性检索基线（"要不要向量库"的实验对照组） |
| `packages/domain/src/preferences.ts` | — | 偏好推断引擎（纯函数，7 条偏好） |
| `packages/domain/src/preference-hints.ts` | — | 把偏好渲染成提示块；按用途过滤 |
| `packages/domain/src/preference-corrections.ts` | — | 用户纠正 → op-log |
| `packages/domain/src/ai-feedback.ts` | — | 建议处置（接受/修改/拒绝）→ op-log |
| `packages/app-host/src/ai-breakdown.ts` | 407 | 拆解编排：请求 → `AiSuggestion` → 解析 → 待确认清单 |
| `packages/app-host/src/ai-capture.ts` | 604 | 捕获编排（规则优先 + 模型兜底） |
| `packages/app-host/src/ai-prioritize.ts` | 470 | 逐条优先级建议编排 |
| `packages/app-host/src/ai-duration.ts` | 507 | 估时编排 |
| `packages/app-host/src/local-api-host.ts` | — | 把本机 API 的写入意图接到真的 `dispatch()` |
| `packages/app-host/src/ai-tool-selection.ts` | — | **内置 AI 的工具选择**：自然语言 → 工具（纯规则、grants 过滤、歧义/未授权分开）。⚠️ 不叫 intent（`OpIntent` / `WidgetIntent` 已占用该名） |
| `packages/app-host/src/ai-tool-run.ts` | — | **内置 AI 的工具执行（单步）**：读即执行 / 写**只产出提案**；`confirmAiToolProposal()` 是唯一写点（[ADR-0035](../adr/0035-ai-tool-calling-reuses-local-api.md)） |
| `packages/app-host/src/ai-tool-call.ts` | — | **内置 AI 的模型路径**：规则先跑（命中即零出境短路）→ `invokeRouted` 带 `tools` → 校验后复用 `runSelectedTool`。出境字段 = `text` + `tools` |
| `packages/app-host/src/ai-assistant.ts` | — | 🔴 **对话式助手的多步循环**（[ADR-0045](../adr/0045-conversational-assistant-split-authorization-from-catalog.md)）：档位 → grants 投影、**循环前一次算完的字段并集**（`planAssistantEgress`）、观察回送模型、写只出提案、越界即停。`assistantMessages()` 是 `system`/`user` 的**唯一来源** |
| `packages/ai/src/assistant-limits.ts` | — | 三个硬上界（步数 / 消息条数 / 单请求字节）+ `egressBytesFor()`。**住在这个包**：上界是出境层的纪律，不是编排层的偏好。单位是**字节**（UTF-8） |
| `packages/app-host/src/calendar-anchor.ts` | — | 🔴 「今天是 …（周X，UTC±HH:MM）」的**唯一生产者** + 日期硬规则。不用 `Intl`（Hermes 上可选），偏移走纯算术 |
| `packages/ai/src/capability-manifest.generated.ts` | 424 | **生成物**：给模型看的"哪个实体、哪些字段、可读还是可写"。手写不可能，`--check` 不一致即红 |
| `scripts/gen-ai-capability-manifest.mjs` | — | 上面那份的生成器（从工具目录 + `EntityModelMap`）。`check:ai-tools` 规则 7 调它的 `--check` |
| `packages/ai/src/wire.ts` | — | 请求线格式的**唯一实现**（url / headers / body / 空响应判定），`provider.ts` 与 `routing.ts` 共用。⚠️ **刻意不从 `@heyta/ai` 导出**：导出去等于邀请包外再拼一份 |
| `packages/app-host/src/ai-failure-fallback.ts` | — | `describeRoutedFailure()` 的**唯一**定义点（曾抄了四遍）。入参是封闭词表 `AiFailureReason`，不是 `string` |
| `packages/ai/src/diagnose.ts` | — | 端点失败的**可诊断性**（W1）：本机端点拒绝来源 vs 其他原因分开，复用 `supply.ts` 的 `isLoopbackEndpoint` |
| `packages/local-api/src/tools.ts` | 499 | 工具契约 + 授权判定（**唯一实现点**）。`isToolGranted()` 被 MCP 与内置 AI **共用** |
| `packages/local-api/src/server.ts` | 359 | 传输无关的 JSON-RPC 处理器。`runReadTool()` / `toWriteIntent()` 亦被内置 AI 复用 |
| `packages/local-api/src/mcp.ts` | 252 | 工具形状：`listAuthorizedTools()`（中性定义，MCP 与内置 AI 共用）+ 错误码 + 会话闸门 |
| `apps/web/src/features/settings/aiStore.ts` | — | AI 设置状态 + 本地持久化（含熔断健康快照） |
| `apps/web/src/features/settings/AiSettings.tsx` | — | 开关界面（三道闸 / 端点 / 授权 / 停用开关） |
| `apps/web/src/features/settings/MemoryPanel.tsx` | — | 偏好的可见 / 可忘掉 / 可恢复 + 「说的 vs 做的」落差 |
| `apps/web/src/features/ai/AiBreakdown.tsx` | — | 拆解界面（含逐条取舍） |
| `apps/web/src/features/ai/AiCapture.tsx` | — | 捕获界面 |
| `apps/web/src/features/ai/AiPrioritize.tsx` | — | 优先级界面 |
| `apps/web/src/features/ai/AiDuration.tsx` | — | 估时界面 |
| `apps/web/src/features/ai/AiToolRun.tsx` | — | **工具调用面板（单步）**：规则命中不出境（并明说）；需模型时先披露再发送；写工具出提案 + 确认。🔴 前门只有 `requestToolCall` 一个 —— 旧的薄壳 `runAiTool()` 已删（W7），`check:ai-tools` 规则 6 拦它回来 |
| `apps/web/src/features/ai/AssistantPanel.tsx` | — | **对话界面**（W12）：一次性披露块（逐字来自 `planAssistantEgress`）、气泡记录（用户贴右 / 助手贴左）、步数轨迹、提案卡 + 确认、免责声明常驻。🔴 自己**不发请求**，也没有 `fetch` |
| `apps/web/src/features/settings/AiSettings.tsx` 的 `ai-assistant-section` | — | 助手的**第二个授权前端**：`assistantTier` 两档单选 + 该档的字段并集 / 工具 / 上界预览 + "与本机 API 互不影响"那句 |
| `apps/web/src/features/ai/RouteUnavailable.tsx` | — | "没有可用端点"时的原因解释 + 下一步 |
| `apps/web/src/features/ai/route-explanation.ts` | 251 | 壳自己的路由解释（`resolveFeatureRoute()`），消费 `resolution.excluded` |
| `apps/web/src/features/ai/ai-failure-copy.ts` | — | 失败原因码 → 界面词条 |

### 1.2 数据流（出站）

```
用户输入 / 事件
   ↓
① 规则层 —— 必过，不用模型                     capture.ts（537 行）
   日期、重复、优先级标记、排序、倒计时
   ↓ 只有规则解析不了的才往下
② 特征层 —— 本机纯函数，读 op-log              memory.ts（360 行）
   推迟过几次、逾期几天、多久没碰、专注落差
   ↓ 🔴 只把②的【摘要】发出去，不是全量任务
③ 模型层 —— 按档位选端点                       routing.ts 的 invokeRouted()
   三道闸 → 出境授权 → OpenAI 兼容 HTTP
   ↓
④ AiSuggestion —— 类型上不可能变成 op          AiSuggestion（类型在 provider.ts）
   ↓
用户确认 → dispatch() → op-log
```

🔴 ③ 之前必须过**三道闸 + 出境授权**，顺序是硬的（见 §4、§6）。

---

## 2. 供给模式与出境目的地（`supply.ts`）

ADR-0006 的实现。**这是全系统"数据出不出设备"的唯一判据。**

### 2.1 两个封闭词表

```ts
type AiSupplyMode    = 'off' | 'own' | 'managed';        // 用户选什么
type EgressDestination = 'none' | 'user-endpoint' | 'heyta-cloud';  // 数据实际去哪
```

⚠️ 它们是**两个不同的东西**。模式是用户的意图，目的地是推导出的事实。

### 2.2 🔴 目的地由端点推导，不由模式声明

```ts
classifyDestination({ mode, endpoint }):
  mode === 'off'                      → 'none'
  mode === 'managed'                  → 'heyta-cloud'
  mode === 'own' && endpoint 为空      → 'none'
  mode === 'own'                      → isLoopbackEndpoint(endpoint) ? 'none' : 'user-endpoint'
```

原话是「**声明可以被写错，推导不会**」。用户从"自备 + `localhost`"改成
"自备 + 公网"，目的地**自动**从 `none` 变成 `user-endpoint`，不需要他记得改什么。

`isLoopbackEndpoint()` 的判定面（**不做 DNS 解析**）：

| 输入 | 结果 | 说明 |
|---|---|---|
| `localhost` | 本机 | 字面量 |
| `::1` / `[::1]` | 本机 | 字面量；带方括号也认 |
| `127.0.0.0/8` 任意地址 | 本机 | |
| `.local` / `my-nas.lan` | **远端** | 需要 DNS → 按远端处理（照抄 Joplin 的先例） |

⚠️ **不做 DNS 解析**是刻意的：解析结果依赖网络与 hosts 文件，同一个配置
在不同时刻会得到不同答案 —— 而这是隐私判定。

### 2.3 `managed` 是**故意不可启用**的

```ts
assertEnableable(config)   // mode === 'managed' 时抛错
describeRetention('heyta-cloud')  // 返回 undefined
```

`AiConfigError.reason` 的封闭取值：`'retention-undecided' | 'endpoint-required' | 'endpoint-invalid'`。
⚠️ 曾经并列过一个 `'consent-required'`，但它**从未被构造过**；已收敛掉（"缺少出境同意"是
`egress.ts` 的 `consent-missing`，与"配置能不能启用"是两件事）。

🔴 **这不是没写完的占位符，是有意的失败。** ADR-0013 §4 原文：「不能『先把计费
做了，保留策略以后再说』——那样会先产生数据，再补规则。」要真正开放托管 AI
还差 5 件事（服务本体 / 保留策略 / 计费与计量 / Harness 边界 / 上云粒度），
**一件都没完成**。

`describeRetention('heyta-cloud')` 返回 `undefined` 会让披露里显示「未定案」，
这比编一个保留期诚实。

### 2.4 🔴 托管文案必须否认 E2EE

`describeDestination('heyta-cloud')` 的返回值**必须包含**「不受端到端加密」，
且**不得**出现第二处「端到端加密」「E2EE」「end-to-end」。

这条是 ADR-0006 的总结论：托管 AI 与 E2EE 在定义上不能共存，
所以它只能是一个**明确、可撤销、按功能开启的例外**。
`tests/egress.spec.ts` 用逐字断言钉住它。

> 调研事实（[`../research/e2ee-apps-ai.md`](../research/e2ee-apps-ai.md)）：
> **没有任何产品同时提供厂商托管 AI 与 E2EE**。Proton Lumo 承认这点，
> 改叫 **user-to-Lumo（U2L）**。

### 2.5 需要授权的判据

```ts
requiresEgressConsent(destination) === (destination !== 'none')
```

只有这一个判据。`none` = 明文没离开设备 = **不需要任何授权**。

---

## 3. 出境闸门（`egress.ts`）

ADR-0006 §3.2 的 5 条约束里，3 条是关于"出境必须显式"的。本文件是执行点：
**任何一次把明文送出去的调用，都必须先过 `authorizeEgress`。**

### 3.1 🔴 授权绑定在 `(功能, 目的地)` 二元组上

`authorizeEgress` 要求**精确匹配**，不是"用户同意过 AI 拆解"就够：

```ts
consents.some(c => c.feature === request.feature && c.destination === request.destination)
```

来自一个真实的坏场景（原文保留）：

1. 用户开了"AI 拆解任务"，走自己那台 Ollama（`localhost`）—— 隐私上根本不是出境，他当然会同意；
2. 后来他换了 heyta 托管，或者把端点改成一个远程地址；
3. **如果授权只记"用户同意过 AI 拆解"，那么第 2 步之后，他的任务明文就会在我们从未征求过同意的情况下流出去。**

「这不是防御性编程，是『用户同意的是 A、你做了 B』那类事故的唯一止血点。」

### 3.2 `AiFeature` 按**用哪几个字段**划分，不按界面位置

| 值 | 用途 | 会出去的字段 |
|---|---|---|
| `'capture'` | 自然语言捕获 | 只要标题那一行（**字段最少的一条**） |
| `'breakdown'` | 拆解任务 | 标题 + 备注 |
| `'prioritize'` | 逐条优先级建议 | 标题 + 截止时间 + 优先级 |
| `'duration-estimate'` | 估时（时间线视图） | 标题 + 备注 + 历史耗时 |

⚠️ 授权与披露的粒度必须是「**哪些数据会出去**」，而界面上怎么摆是另一回事。

🔴 这个枚举**不得加入可视化**（如甘特图）。见 [`../plans/ai-strategy.md`](../plans/ai-strategy.md) §3。

### 3.3 披露：拒绝时也必须能说清

```ts
interface EgressDisclosure {
  destination: EgressDestination;
  fields: readonly string[];        // 必须逐项列出，不许写 ['*']
  destinationText: string;          // "发给谁"
  retentionText: string | undefined; // "留多久"；undefined = 策略未定案
  requiresConsent: boolean;
}
```

`EgressDecision.reason` 的封闭取值只有 **一个**：`'consent-missing'`，
且它**总是**带 `disclosure`。

> ⚠️ 一个只说"未授权"而不说"授权后会发生什么"的提示框，等于逼用户盲签。
> ⚠️ 曾经并列过一个 `'consent-required'`（注释把它写成"需要授权但本次没有"的提示态），
> 全仓从未构造过、`authorizeEgress` 也没有第二个 return —— 已收敛掉，不要再把它当成
> 一个"需要 UI 分开呈现"的 reason。

UI 必须把拒绝态渲染在**授权后会发生什么**的上下文里。`buildDisclosure()` 是纯函数，
测试与 UI 共用同一条路径 —— 这也是"同一句话不能有两个来源"的落实。

### 3.4 🔴 本机端点必须**真的**免授权

```ts
if (!disclosure.requiresConsent) return { allowed: true, disclosure };
```

原话：「这是『自备 + 本地端点』相对『托管』的**实质优势**，必须真的免授权，
而不是走个形式 —— 否则用户会被训练成『看到提示就点同意』。」

### 3.5 🔴 `retainValidConsents()`：不变量的另一半

切换供给模式时，**必须删除**目的地不再匹配的授权：

```ts
if (!requiresEgressConsent(currentDestination)) return [];   // 本机 → 一条不留
return consents.filter(c => c.destination === currentDestination);
```

为什么光比对不够：旧的授权记录**会一直留在存储里**。不清掉的话，用户从
"本地 Ollama" → "heyta 托管" → "自备远端" 走一圈，那些陈旧记录会**重新变得可匹配** ——
于是出现「我没同意过这个组合，但它放行了」。

⚠️ 本机端点返回 `[]` 而不是原样返回：「留着就是将来误放行的种子」。

---

## 4. 供应商端口（`provider.ts`）

ADR-0005 §3.2 与 ADR-0006 §3.2 的实现：**一个端口，多种后端。**

⚠️ **它是"单端点 / 本地 / 测试与历史"执行路径，不是生产的出境执行点。**
生产（`apps/web` / `apps/node-host` / `apps/mobile`）走 `routing.ts` 的
`invokeRouted()` —— 只有它带多端点候选、能力过滤、回退不跨隐私边界与熔断。
`createProvider()` 的依赖方只有本包测试、`apps/web/tests/ai-failure-copy.spec.tsx`
与 `scripts/verify-ai-live.mjs`。**新增出境功能请接 `invokeRouted`，不要接这里。**
（两套实现是已登记的存量漂移，见 §15.2。）

### 4.1 🔴 只产出建议，产生不了 op

```ts
interface AiSuggestion {
  feature: AiFeature;
  text: string;              // 模型返回的自由文本，由调用方解析
  destination: EgressDestination;
}
```

原文：「本文件的返回类型是 `AiSuggestion`，**它没有任何形状能变成 op**：
没有 `OpType`、没有 `entityId`、没有向量时钟；`fields` 里只有**候选值**，
没有"已应用"的语义。」

「这不是靠约定，是靠**类型上做不到**。项目负责人不需要记得"AI 不要直接写库"，
因为这里根本没有能写库的东西。」

### 4.2 为什么两种模式共用一份实现

「**如果两种模式各写一个 provider，它们一定会漂移**，而漂移在这条路径上的后果是
『隐私披露与实际行为不一致』。」

### 4.3 🔴 工厂即校验

`assertEnableable()` 在 `createProvider()` **里**就调用，不等第一次 `invoke` ——
这样"托管模式因保留策略未定而不许启用"会在**配置那一刻**失败，而不是在用户已经
打了字、准备提交时才弹错。「**错误发生得越晚，越像"无缘无故"**。」

### 4.4 出境顺序不可被"边发边显示"替代

```
EGRESS_ORDER_NOTE = '顺序：先展示会发送哪些字段 → 用户确认 → 才发请求 → 再显示结果。'
                  + '不允许先发再问。'
```

🔴 流式输出看起来更流畅，但它意味着**在你决定要不要之前，数据已经在路上了**。
将来若要加流式，**必须新开一个方法**，而不是给现有方法加参数 ——
先回答"怎么在第一个字节发出前完成授权"。

### 4.5 数据面恰好等于披露面

「⚠️ 注意这里没有把整个 task 对象序列化进去 —— 出境的数据面必须**恰好等于**
披露出去的那几个字段，不多一个。」

`extractContent()` 不信任响应形状：端点是用户提供的，可能是 Ollama、一个中转、
或者一个返回 200 + 空 JSON 的反向代理。全部按 `unknown` 处理再逐层收窄，
拿不到就返回 `undefined`，由调用方当成 `empty-response`。

### 4.6 常量与文案

| 项 | 值 |
|---|---|
| `DEFAULT_TIMEOUT_MS`（私有） | `30_000` |
| 关闭态返回 | `{ ok:false, reason:'not-configured', message:'AI 未启用。在设置里选择"使用自己的 AI 端点"即可开启。' }` |
| `AiFailureReason` | `'not-configured' \| 'egress-not-authorized' \| 'network' \| 'http-error' \| 'empty-response' \| 'no-route' \| 'fallback-needs-consent'` |

---

## 5. 配置路由（`routing.ts`）

ADR-0010 的实现。回答：「**这次调用，到底该发给哪个端点？发不出去怎么办？**」

### 5.1 🔴🔴 回退不得跨越隐私边界

本文件与通用 AI 网关（CC Switch / LiteLLM / one-api 等）的**根本区别**：

> 通用网关遇到失败就**换下一个端点重试**，这没错 —— 对它来说端点只是供应商。
> 但对 heyta 来说，**端点还带着隐私等级**。
>
> 候选链是 `[本地 Ollama, 云端]`，本地挂了 —— **不许**悄悄发给云端。
> 那不是"高可用"，那是**在用户没同意的情况下把数据送出去**。

实现：`invokeRouted` 循环里**每个候选各自**过一次 `authorizeEgress`（在网络动作之前）：

| 候选位置 | 未授权时 | 返回 |
|---|---|---|
| 首选（`index === 0`） | 立即返回 | `'egress-not-authorized'`（带 disclosure） |
| 回退位置（`index > 0`） | `blockedByConsent` + `break` | `'fallback-needs-consent'` |

🔴 `'fallback-needs-consent'` 是**独立的失败原因**，不是"网络错误"的一种。
有测试断言**这种情况下一次网络请求都不发**（数请求数，不看返回值）。

回退被拦住时的文案要明说：「本地的都挂了，接下来那个要出设备，你得先同意」——
「heyta 不会替你决定，所以停在这里。」

### 5.2 三道闸，缺一不可

| 顺序 | 闸 | 关掉时 | 默认 |
|---|---|---|---|
| 1 | `enabled`（总开关） | 整个 AI 关掉 | `false` |
| 2 | `allowRemote`（允许远程） | 只用本机端点，远端**不进入候选** | `false` |
| 3 | 出境授权 `(功能, 目的地)` | 这一个功能、这一个目的地还没同意 | 无授权 |

⚠️ 第 2 道与第 3 道**不是重复**：

- 第 2 道是「我根本不想用云」（粗粒度、一次设定、长期有效）
- 第 3 道是「这个功能可以发，但那个功能不行」（细粒度、按功能、可撤销）

**合并成一道就会丢掉其中一个语义。** 另外第 2 类**不是**"授权失败"，是"用户不想用云"——
所以它被排除在候选之外、不产生授权询问。「**不想用云的人不该被反复弹『要不要授权云』。**」

### 5.3 能力：显式声明，不做推断

```ts
type AiCapability = 'structured_output' | 'vision' | 'long_context' | 'tool_calling';
```

```ts
DEFAULT_FEATURE_CAPABILITIES = {
  'capture':           ['structured_output'],
  'breakdown':         ['structured_output', 'long_context'],
  'prioritize':        ['structured_output'],
  'duration-estimate': ['structured_output'],
};
```

🔴 「**不做任何推断。**」这是从 SSOS 的经验里学来的反面教训：它有一个
`VISION_PROVIDERS` 集合，按 provider 名猜谁支持视觉 —— **那种写法随模型改名即失效，
而且失效时是静默的**（猜测结果看起来永远合理）。

⚠️ `undefined` 的含义是**"只声明了基线能力"**，不是"支持一切"：
默认只当作支持 `structured_output`。`vision` / `tool_calling` / `long_context`
**必须显式写出来**。「这样『没配』= 保守，而不是『没配』= 放开。」

匹配用 `required.every(cap => declared.includes(cap))`。

### 5.4 熔断：只有端点的锅才算

| `AiFailure['reason']` | 记失败？ | 换下一个？ |
|---|---|---|
| `network` | ✅ | ✅ |
| `http-error`（401/402/403/404/429/5xx） | ✅ | ✅ |
| `http-error`（400/422） | ✅ | ❌ |
| `empty-response` | ✅ | ✅ |
| `egress-not-authorized` | ❌ | ❌ |
| `fallback-needs-consent` | ❌ | ❌ |
| `not-configured` | ❌ | ❌ |
| `no-route` | ❌ | ❌ |

🔴 「**只有"端点自己的问题"才计入失败。** ……**把自己的错误记到端点头上，
于是好好的端点被跳闸。**」

🔴 「『要不要记一笔』与『要不要换下一个』是**两个问题**」——
对应 `countsAsEndpointFailure` / `shouldTryNextEndpoint`，**不要合并**。

`'egress-not-authorized'` 与 `'fallback-needs-consent'` 换下一个端点**不是"重试"，
是"换一个目的地偷发"**。

「跳闸」的判据是**连续**失败（默认阈值 3），一次成功立刻清零。

### 5.5 默认策略

```ts
DEFAULT_ROUTING_POLICY = {
  maxAttempts: 2,
  timeoutMs: 30_000,
  circuitFailureThreshold: 3,
  circuitCooldownMs: 60_000,
};
```

⚠️ `maxAttempts` 是**"尝试次数"不是"端点数"**：同一个端点不会重复试两次
（立刻重试几乎必然再失败，只会让用户多等一个超时）。

取值刻意偏保守，对照真实网关的实测取值（本机 CC Switch 的 `proxy_config`：
`max_retries=6`、`non_streaming_timeout=600s`、冷却 60–90s）——
「那些数字是给**无人值守的长任务**用的，直接搬过来会让用户在输入框前站 10 分钟。」
「这是任务管理，不是批处理。用户盯着一个输入框等结果，超过十几秒就已经算『坏了』。」

### 5.6 🔴 URL 校验在**两个点**执行

移植自 SSOS 最有价值的做法，原文最好：

> "Enforcement has to sit on the path that actually sends the request,
> not only on the path that stores it."

| 点 | 位置 | 说明 |
|---|---|---|
| ① | `resolveRoute`（解析候选时） | 第一次 |
| ② | `attemptOnce`（真正要发的那一刻） | 🔴 第二次，「无论配置从哪来，出去的东西都得先过这一关」 |

「⚠️ 这不是重复代码，是**纵深防御**。删掉它，校验就退化成『只防君子』。」

规则**按目的地分岔**：

| 目的地 | 明文 HTTP | HTTPS |
|---|---|---|
| 回环（本机） | ✅ 允许 | ✅ 允许 |
| 远端 | ❌ **拒绝**（`plaintext-remote`） | ✅ 允许 |

「**远端明文 HTTP 意味着用户的提示内容会以明文经过网络**，而 heyta 的同步通道是
端到端加密的 —— 在 AI 这条路上退化成明文 HTTP 会让整个产品的隐私承诺自相矛盾。」

`EndpointUrlVerdict` 的失败原因：`'unparseable' | 'bad-scheme' | 'credentials-in-url' | 'plaintext-remote'`。
⚠️ 另拒 URL 里带 userinfo（`https://user:pass@host/`）。

### 5.7 候选排除原因（封闭词表）

```ts
type CandidateExclusionReason =
  | 'endpoint-missing' | 'endpoint-disabled' | 'remote-not-allowed'
  | 'circuit-open' | 'capability-missing' | 'endpoint-url-rejected';
```

`describeRouteIntent()` ⚠️ 只做**静态**推导（不含健康状态），所以是"配置意图"
而不是"实际会怎样"。名称上区分开，免得被当成实时状态。

🔴 **它当前零生产调用点。** 壳真正走的是
`apps/web/src/features/ai/route-explanation.ts` 的 `resolveFeatureRoute()` ——
它需要中英双语词条，还要把 `resolution.excluded` 翻成人话，所以在 `resolveRoute()` 之上
自己包了一层。两者是"同一件事的两套实现"；`describeRouteIntent()` 只有一条 3 行实现、
行为已由测试钉住，保留作为将来壳收掉重复部分时的现成入口，
**接线时要用它取代那份重复实现，而不是并成第三份**。

---

## 6. 健康与熔断落盘（`health-store.ts`）

### 6.1 为什么这属于 `packages/ai` 而不是壳

ADR-0003 的判据：「这一行在决定**业务上怎么做**吗？」

「『跳闸的端点重启后还算不算跳闸』是业务判断，不是平台差异。
存到哪个键、哪个文件才是平台差异 —— 那部分留在壳里。」

### 6.2 🔴 读回来的东西不可信，且**必须封顶**

| 常量 | 值 | 作用 |
|---|---|---|
| `HEALTH_SNAPSHOT_VERSION` | `1` | 版本对不上就丢掉 —— 比按错误的结构解析安全 |
| `MAX_CIRCUIT_MS` | `30 * 60 * 1000`（30 分钟） | `circuitOpenUntil` 读回时夹到 `now + MAX_CIRCUIT_MS` |
| `FAILURE_MEMORY_MS` | `24 * 60 * 60 * 1000`（24 小时） | 更久以前的失败记录丢掉 |
| `MAX_LAST_ERROR_LENGTH` | `200` | |

为什么必须封顶：「假设某个端点的 `circuitOpenUntil` 被写成 `Date.now() + 10 年`
（时钟跳变、手改、旧 bug）。没有封顶的话，用户会遇到一个**再也修不好**的状态：
改配置没用、重启没用，只能去删存储。」

三道防线：① 形状不对的条目直接**丢掉**，不抛错；② `circuitOpenUntil` **封顶**；
③ 已经过期的跳闸**立刻清掉**。

🔴 退化方向是「**当作没有熔断历史**」（= 会去试）。反过来（当作全部跳闸）
会让 AI 永久不可用，而多试一次的代价只是多一次失败的请求。

⚠️ 同一个 id 出现两次时**取更保守的那条**（失败次数多的，`Math.max`）。
⚠️ 三个字段都空的条目**不存**（没有信息量）。
⚠️ `describeEndpointHealth()` 是给用户看的，**不要出现 `consecutiveFailures` 这种词**。

---

## 7. 预设（`presets.ts`）

| id | label | endpoint | model |
|---|---|---|---|
| `ollama` | 本机 Ollama | `http://localhost:11434/v1` | `qwen3:8b` |
| `lm-studio` | 本机 LM Studio | `http://127.0.0.1:1234/v1` | `local-model` |

🔴 **刻意不内置任何云端预设。** 理由：

1. 一份云端端点清单会**过期**（模型改名、价格变化、地区不可用），而过期的清单比没有清单更糟；
2. 内置云端预设等于 heyta 在**推荐**某个目的地，而"数据发到哪"应该是用户自己的决定。

「云端端点让用户**自己填** —— 那时他知道自己在填什么。」

🔴 **预设必须放在 `packages/` 而不是设置页里**：`check:layering` 有一条
`no-model-endpoint-in-apps` 规则，它的 pattern 恰好会命中 `:11434/v1`。
「规则不是在找麻烦，它是在提醒：**预设是数据，不是界面文案。**」

`presetDestinations()` 的存在意义是**让"预设都是本机的"成为一条可断言的属性**，
而不是一句注释。将来若有人加了云端预设，测试会红 —— 那正是需要有人
**明确决定**"我们要不要推荐云端"的时刻。

---

## 8. 规则层与特征层（`capture.ts` / `memory.ts` / `recall.ts`）

### 8.1 🔴 `capture.ts` 不是 AI，而且这个区别是刻意的

「把一段话变成结构化任务，是任务管理里**唯一被反复验证**的 AI 场景。
但调研的结论是：这个场景里 AI 的真实增量**不是"解析日期"**。」

硬证据来自端侧质量基准：格式合规率都 >84%，**但取值准确率没有任何模型超过 80.4%**
（SOB 基准，21 个模型）。一个生产端侧应用因此从"LLM 生成完整结构化 JSON"
**退化成**"LLM 只写几条短提示 + 确定性回退"，结论是：

> **「最可靠的端侧 LLM 功能，是 LLM 做得最少的那个功能。」**

所以顺序是**先把确定性规则做到最好** —— 它可测、可解释、零成本、零出境、
离线可用，而且**一旦修好就永远修好了**（模型会随版本漂移，规则不会）。

🔴 **输出里必须带 `matches`**：中文**没有词边界**。"明天" 会出现在 "明天启程" 里、
"周三" 会出现在 "周三前交" 里 —— 规则解析的误报是**结构性的，不是可以调参消掉的**。
而误报的后果是：**用户写的字被悄悄从标题里删掉了**。

### 8.2 🔴 `memory.ts`：推迟次数**算不出来**，除非有事件流

「物化状态（`MaterializedState`）只有**当前值** —— 一条任务的 `dueDate` 是
"下周三"。它**不含**『这个日期被往后推过 6 次』这个信息，因为这个信息
**不在当前状态里，只在历史里**。」

所以本模块的输入必须同时有 `operations`（op-log 事件流）和当前状态。
**这是「op-log 就是记忆」的直接证据**：换掉 op-log 去用一个只存当前值的库，
这个能力就**不复存在**。

纯函数、零依赖：不 import 任何框架、不发网络请求、不读时钟（`now` 由调用方传入）。
于是它可以在浏览器、Hermes、Node 三端跑，也可以被单测穷尽。

这也是对"要不要上向量数据库"的回答的一部分：本层需要的全是**聚合**
（计数、求和、取最大），而聚合是 SQL/数组一趟扫描就能做的，与向量检索无关。

### 8.3 `recall.ts`：向量库实验的**对照组**

「它必须是**真能用的实现**，不能是为了证明『不需要向量』而故意搭的稻草人。」

- 中文按**字符二元组（bigram）**切；拉丁文按小写词元切，长度 ≥2 的词保留
- 相似度用 **Dice 系数**（多重集合），对长度差异比 Jaccard 更稳健
- 混合权重：拉丁词元权重高于中文 bigram

「这套逻辑在真实存储里可以由 **SQLite FTS5 + trigram** 承担（heyta 已经有 SQLite），
本文件是它的**纯函数等价物**，因此可以脱离数据库被测、被实验。」

---

## 9. 记忆与偏好

ADR-0014 的实现。**分水岭是「事实 vs 偏好」** —— §8 是事实，本节是推断。

### 9.1 七条偏好

```ts
type PreferenceId =
  | 'estimate-bias' | 'deep-work-window' | 'lead-time'
  | 'granularity' | 'title-style'
  | 'feedback-granularity' | 'feedback-keep-ratio';
```

后两条（反馈层，M4）**只能**从"用户怎么处置 AI 建议"推断，从用户自己的数据推不出来。

### 9.2 🔴 闸门与阈值

| 常量 | 值 | 含义 |
|---|---|---|
| `MIN_SAMPLE_SIZE` | `8` | 样本少于这个数**不许对外说话** |
| `MIN_CONFIDENCE` | `0.5` | 低于阈值的偏好**不参与**任何 AI 行为 |
| `FULL_SAMPLE_SIZE` | `20` | 置信度饱和点 |
| `DEEP_WORK_WINDOW_HOURS` | `3` | 深度时段窗口 |
| `MS_PER_DAY` | `86_400_000` | |

### 9.3 🔴 `memoryEnabled` 必填，且 fail-closed

```ts
inferPreferences(input, { memoryEnabled })   // 必填，没有默认值
```

- 传错就**编译不过**：「隐私开关**绝不允许 fail open**。」
- 关闭时返回**空集**，而不是"低置信度"：五个偏好字段**全是 `null`**，
  `withheld` 也是**空的** —— 「关闭时系统**不解释自己**」。
- 闸门位置在 `inferPreferences()` 的**入口**。

⚠️ 主开关**不是**"关闭所有记忆"，它是「关闭**推断用户是什么样的人**」；
事实层（§8）不受影响。

界面上：`memoryEnabled` 在 `aiStore` 里默认 `false`。
持久化 key 是 `AI_SETTINGS_STORAGE_KEY = 'heyta.ai.settings'`。
⚠️ `enabled`、`allowRemote`、`memoryEnabled` 必须是**真正的布尔**
（`"true"` 字符串不算）。

### 9.4 🔴 推断层必须是纯函数，结果不持久化

「**最后一条是设计约束，不是描述**：推断层**必须是纯函数**」——
否则偏好会变成一份不可重建、会漂移的语义摘要。

**推断结果不落盘**（落了盘就是**第二份会漂移**的语义摘要）；
**只有用户的纠正**落 op-log。

### 9.5 `withheld` 与 `suppressed` 必须保持区分

- `withheld`：样本不够 / 置信度不足 → 「**我还没算出来**」
- `suppressed`：用户主动按了"忘掉" → 「**你让我别用**」

两者在 UI 上的措辞与可恢复性都不同，**不得合并成一个"没有偏好"**。

### 9.6 纠正与反馈

| 实体 | payload | 作用 |
|---|---|---|
| `PREFERENCE_CORRECTION` | `{ preferenceId, kind: 'suppress' }` | 用户的纠正 |
| `AI_FEEDBACK` | 只记**计数与枚举**，不记内容 | 建议的接受/修改/拒绝 |

🔴 **不需要 bump `CURRENT_SCHEMA_VERSION`**：`applyOperation` 对未建模的
`entityType` 静默忽略，纯可加性。`CURRENT_SCHEMA_VERSION` 至今仍是 **1**。

⚠️ `P7` **刻意不含「拒绝」**：高拒绝率是一个**独立的**信号，本轮不建模 ——
这是如实留白，不是遗漏。

### 9.7 实验证据（留出法：train 80% / test 20%）

五条偏好**全部**优于基线，纯噪声上**零误报**：

| 偏好 | 植入 | 推断 | 置信度 | 偏好 MAE | 基线 MAE |
|---|---|---|---|---|---|
| P1 估算偏差 | `1.80×` | `1.83×` | 0.77 | 3.432 | 24.464 |
| P2 深度时段 | `09:00` | `08:00–11:00` | 0.95 | 0.833 | 3.083 |
| P3 提前量 | `3.0 天` | `3.0 天` | 0.95 | 0.487 | 3.047 |
| P4 粒度 | `6 项` | `6 项` | 1.00 | 0.500 | 3.000 |
| P5 表达习惯 | `12 字` | `12 字` | 0.90 | 1.917 | 2.750 |
| P6 反馈粒度 | 推断 4（真实 4） | — | — | 0.167 | 1.000 |

⚠️ **这些实验用的是合成数据**：它只证明「方法有效」，**不证明「真实用户身上有这些偏好」**。
引用时必须带这个限制。

⚠️ 每条偏好的输出必须自带三件东西：`sampleSize`、`confidence`、`evidence`（给用户看的原话）。
冷启动必须诚实 —— **不许编偏好**（不许用"平均用户"填充），AI 必须**明确表现出「我还不了解你」**。

### 9.8 偏好如何进入 prompt

`preference-hints.ts` 负责渲染，两条硬规则：

1. **按用途过滤** —— 只发当前决定需要的那几条；
2. 🔴 偏好摘要进入 prompt，**必须出现在出境披露里**；开关关时**零偏好出境**。

🔴 `RELEVANT_PREFERENCES` 就是**出境面白名单**：

| 功能 | 允许带出去的偏好 |
|---|---|
| `breakdown` | `granularity` / `title-style` / `estimate-bias` |
| `capture` | `title-style` |
| `prioritize` | `lead-time` / `deep-work-window` |
| `duration-estimate` | `estimate-bias` / `deep-work-window` |

⚠️ 「**往这里加一条，就等于允许该功能多发一条用户信息出去。**」
新增时必须同时更新出境披露的测试。

顺序**固定**（按声明序）—— 保证 prompt 可复现、可做字节级断言。
没推算出来的偏好**不出现**（不许拿"平均用户"凑数）。

🔴 生成器是**唯一入口**：`renderPreferenceHints()` 的调用点只能有一处，
不准在图省事的地方自己拼字符串绕过它。

### 9.9 `withheld` 的封闭原因

```ts
reason: 'disabled' | 'not-enough-samples' | 'not-stable-enough' | 'no-data'
```

⚠️ `'disabled'` **代码从未产出** —— 主开关关闭时直接返回空集（连 `withheld: []`），
所以界面永远拿不到这个值。它留在联合类型里是给它将来的位置，不是当前行为。

---

## 10. 界面层

| 文件 | 职责 | 对应验收 |
|---|---|---|
| `aiStore.ts` | AI 设置的单一状态源；`localStorage` 持久化；熔断健康快照的落盘/读回 | 跨重启记忆熔断（`toHealthSnapshot` / `fromHealthSnapshot`） |
| `AiSettings.tsx` | 三道闸 + 端点配置 + 出境披露 + 逐工具授权 + 端点"停用/启用"开关 | 托管文案必须否认 E2EE |
| `MemoryPanel.tsx` | 偏好可见、单条"忘掉"、**可恢复**的「你已忘记」；「说的 vs 做的」落差 | **M6 验收标准**：用户能在界面上看到并改掉它 |
| `AiBreakdown.tsx` / `AiCapture.tsx` / `AiPrioritize.tsx` / `AiDuration.tsx` | 四个功能的界面：建议 → 逐条取舍 → 确认才写入 | 未确认时**不得**产生任何 op |
| `RouteUnavailable.tsx` | "一个候选都没有"时**说出真实原因**并给"下一步点哪里" | 每个 `CandidateExclusionReason` 有专属文案 |
| `route-explanation.ts` | 壳自己的路由解释 `resolveFeatureRoute()`（消费 `resolution.excluded`） | 四组件共用这一份，不许各写一套 |
| `ai-failure-copy.ts` | 失败原因码 → 界面词条（中英） | 英文界面不出现中文 |

⚠️ `aiStore` 用 zustand v5；`useSyncExternalStore` 要求 selector 结果
**引用稳定**（需要时用 `zustand/react/shallow` 的 `useShallow`）。

`apps/web/src/features/ai/AiBreakdown.tsx` 是 `@heyta/ai` 的**第一个真实消费者**。
在它之前 `invokeRouted()` **没有任何调用点** —— 路由、回退、出境闸门、熔断
全都只有单测，没有一次"从功能出发真的走了一遍"。那种状态下最危险的失效是：
**每层都对，接起来不对。**

> 现在四个功能都已经走这条路：`invokeRouted()` 的生产调用点在
> `packages/app-host/src/ai-{breakdown,capture,prioritize,duration}.ts` 四个模块里，
> 界面组件消费的是这四个模块。

### 10.1 拆解的解析策略：宁可判"没读懂"，也不要猜

模型返回的是一坨自由文本（编号列表、短横线列表、带前言"好的，以下是拆分："、
包在 ``` 围栏里、或者一段散文）。

| 常量 | 值 |
|---|---|
| `MAX_BREAKDOWN_ITEMS` | `20` |
| `MAX_ITEM_LENGTH` | `200` |

- 明确的列表行 → 收
- 一行都没有列表标记 → **只收看起来像条目的短行**，且**丢掉明显的客套前言**
- 什么都收不到 → 返回 `unparseable`，让 UI 说"没读懂"，**不硬凑**

---

## 11. 入站面：本机 API 与 MCP（`packages/local-api`）

ADR-0011 的实现。让本机其他程序（Claude Code / Cursor / Raycast / 用户自己的脚本）
读写 heyta。**方向与 `packages/ai` 相反，信任模型也相反。**

### 11.1 四条不可商量的规则

1. **默认关** —— 总开关关、且**每个工具单独默认关**（照抄 Joplin 的 11 个工具全默认关）
2. **只监听回环** —— `bindAddress` 非回环一律拒绝（`0.0.0.0` 也拒）
3. **显式 token** —— 防的**不是**网络攻击，是**本机其他程序**
4. 🔲 **加密条目可列举、不可读** —— Bear 的底线

### 11.2 本包**不做**的事

- **不监听端口、不解析 HTTP/JSON-RPC** —— 那是壳的事（ADR-0003）
- **不构造 op** —— 写入必须经 `LocalApiWritePort`（形状即 `dispatch`）；
  本包**没有任何 op 构造函数**，所以它**造不出**一个 op
- **不读钥匙串、不碰磁盘**
- **不 import `@heyta/op-log`** —— 一旦能 import op 类型，「不写 op」这条约束
  在类型上就失效了

### 11.3 默认配置与常量

| 项 | 值 |
|---|---|
| `DEFAULT_LOCAL_API_CONFIG` | `{ enabled: false, bindAddress: '127.0.0.1', port: 47_119 }` |
| 端口合法范围 | `1`–`65_535`，必须是整数（`0` 拒绝：「"随机端口"对固定 token 的服务没意义」） |
| `MCP_PROTOCOL_VERSION` | `'2025-06-18'` |
| `MCP_SERVER_NAME` | `'heyta'` |
| `LOCAL_API_METHODS` | `['initialize', 'tools/list', 'tools/call']` |
| `JSON_RPC_ERRORS` | `parseError: -32_700` / `invalidRequest: -32_600` / `methodNotFound: -32_601` / `invalidParams: -32_602` / `internalError: -32_603` |
| `LIST_TASKS_MAX_DUE_SPAN_DAYS` | `14` —— `list_tasks` 按日期查的跨度上限（**含两端**）。形状取自 ADR-0045 §2.5：上限同时是出境数据量的上界与一次确认的认知负荷上界，所以「只给 `dueFrom`」这种没有上界的范围也是被拒的 |
| stdio 单行上限 | `1 MB`（超长必须**真的关闭连接**，不能只丢缓冲） |

⚠️ `validateLocalApiConfig` 只在 `enabled === true` 时校验地址与 token；
**关着的时候允许配置不完整**。

`isLoopbackAddress()`：`localhost` / `::1` / `[::1]` / 任意 `127.0.0.0/8` 为真；
**显式拒绝 `0.0.0.0`、`::`、`*`**。原话：「必须显式拒绝。」
「它们……最容易被误当成『本机』。」

⚠️ 它与 `@heyta/ai` 的 `isLoopbackEndpoint` **刻意不共用**：那个处理完整 URL，
这个处理裸主机；「共用会诱使某一方放宽自己的规则，而放宽的方向通常是**不安全**的那一边。」

### 11.4 目录规模（10-03 记 22，读 10 / 写 12 → 10-04 现量 26，读 12 / 写 14）——🔴 逐工具那张表**已撤**，只留指针

> 🔴 **这里原来是一张 9 行的工具表，现在删掉了。理由是它一天里漂了两次**：
> 先列 6 个 → 2026-10-03 上午漂成 9 个（补 `create_project` / `list_habits` / `create_habit`）
> → 同日下午变 22 个。同一份手写抄件对不上两次，说明"改完上游顺手改这张表"
> 这条纪律**在这个目录当前的增长速度下不成立** —— 不是纪律不好，是它的执行成本
> 高于它提供的信息。所以留下的不是新表，是**指针**。
>
> - **唯一事实源**：`packages/local-api/src/tools/<entity>.ts`（一个实体一个文件；
>   目录条目 + 参数 schema + 读分支 + 写分支在同一处，加第三个工具不必再回 `mcp.ts`）。
> - **给人读的现状**：`packages/ai/src/capability-manifest.generated.ts` ——
>   它由 `node scripts/gen-ai-capability-manifest.mjs` **从上游算出来**，
>   `--check` 逐字节核对产物并挂在 `check:ai-coverage` ⇒ **在 `pnpm check` 链里**。
>   🔴 它和上面那张表的差别不是"更细心"，是**它有门禁**：改上游不改生成物，构建就红。
>
> 现量（那条命令打印的三行）：**工具 22（读 10 / 写 12）· 实体 10 · 覆盖面 8/8 · 无工具实体 0**。
> 🔴 **10-04 现量更新**（同一条命令）：工具 **26（读 12 / 写 14）· 覆盖面 9/9**（批次二把 `EVENT` 纳进分母），上限 **每实体 5 × 分母 9 = 45 席（已用 26，剩 19）**。上面那行 10-03 的读数**原地留着** —— 它存在的意义就是"手抄一定会漂"，而这一节恰恰是讲这件事的。
> 按实体分布：`TASK` 5 / `NOTE` 4 / `TAG` 3 / `PROJECT` `HABIT` `HABIT_LOG` `FOCUS_SESSION` `REMINDER` 各 2。
> 每个工具**默认全关**（现量：`defaultEnabled === true` 的条目 **0 个**）。
🔴 **目录顺序是一条判据**，不是聚合的巧合：所有 `read` 排在所有 `write` 之前
（`tools/list` 与 AI 的 `tools` 数组顺序就靠它），既有工具的相对顺序不许变、
新工具只能追加 —— 钉在 `packages/local-api/tests/tool-pack-coverage.spec.ts`。

⚠️ **十个读工具各自声明 `egressFields`**（出境逐字段披露那条不变量的落点）。
这里只列**机制最绕的四个**：
`list_tasks` = `task.id` `task.title` `task.dueDate` `task.priority` `task.completed` `task.readable`，
`get_task` = 上面全部 **+ `task.body`**（备注只有单独取时才出境，这正是上面那条
"列表不返回备注"的判据在出境面的镜像），`list_projects` = `project.id` `project.name` `project.taskCount`，
`list_habits` = `habit.id` `habit.name` `habit.target` `habit.unit` `habit.goalType`
—— 后者的投影是 `packages/app-host/src/local-api-host.ts` 里的 `habitToItem` **白名单**
（整块习惯模型不外传）。
🔴 **另外六个读工具（`list_tags` `list_notes` `get_note` `list_checkins` `list_focuses` `list_reminders`）
的字段清单不在这里抄** —— 理由就是本节开头那张 9 行工具表被撤的理由：
这一层手抄一次漂一次，而 `capability-manifest.generated.ts` 里那份是机器算的、带 `--check` 门禁。
🔴 **`habitToItem` 那条"白名单重建"的形状，新增的读侧各自照做了一份**
（`tagToRow`、`noteToRow`、`noteToItem`、`habitLogToItem`、`focusToItem`、`reminderToItem`），
每个都有一条钉住白名单的判据，形状不完全一样：`list_habits` / `list_checkins` / `list_reminders` 是
"往实体上注一个不该出境的字段，再断言 `JSON.stringify` 里没有它"；`list_notes` 与 `get_note` 是
**两条腿各量一次**（列表行没有正文、单取有）；`list_focuses` 是钉键集合等于白名单。
这一族测试的唯一作用是抓"投影漏改一个字段"，而那正是**写进库、界面上看得见、AI 却看不见**的形状。
🔴 **十二个写工具的 `egressFields` 一律是 `[]`**（现量：非空的写工具 0 个）：
写提案出境的是**用户那句话**，不是任何本地数据。
某个写工具若开始声明 `task.*` / `habit.*` 这类本地字段，那就是"读侧泄漏"换了条通道，
`packages/local-api/tests/tool-egress-fields.spec.ts` 那条**真实载荷对照**（实际跑执行器收键，
不比代码）会在它出现时响。

⚠️ `list_tasks` **不返回备注正文** —— 备注要单独用 `get_task` 取。
每个工具的 `additionalProperties` 一律 `false`。

🔴 `list_tasks` 的**日期过滤分三层，各层判据不同**（这条是 AI-G3「问今天却返回全量前 N 条」
的直接对策，判据当初只写在最上面一层所以一直没红）：
规则层 `list.today` 传 `dueOn`（`ai-tool-selection.ts`，用注入的 `ctx.now`）；
契约层校验形状与 14 天跨度（`tools.ts` 的 `readListTasksDueArgs`，不合法就报 `invalid-args`，
**绝不降级成"这个参数没传"**）；
宿主层做过滤（`app-host` 的 `createLocalApiHost`，**先按日期筛、再应用 `limit`** ——
顺序写在 `LocalApiHost.listTasks` 的契约注释上，因为截断发生在宿主里）。
判据落在**结果集**上：`packages/app-host/tests/local-api-host-due-filter.spec.ts`。
每个工具的 `additionalProperties` 一律 `false`。
判据**原本是**防膨胀断言 `LOCAL_API_TOOLS.length <= 10`（「Joplin 有 11 个，
那是笔记应用。这里是任务管理，超过 10 个就该先问『真的需要吗』」）。
🔴 **2026-10-03 上午记过一条它和覆盖面门禁的算术冲突**（未覆盖的五个实体要 10 个新席位、
`EVENT` 的契约要 6 个，而这条上限只剩 **1 席** ⇒ 两条各自合理、合起来互相封死、
`pnpm check` 全绿，当时判成"要产品拍"）。
✅ **同日已解除，而且没有拍板这回事 —— 那条上限的单位写错了**：总量从来不是用户要理解的负担，
**逐工具的授权清单**才是，而清单天然按实体分组。现在判据是**按实体**的
`MAX_TOOLS_PER_ENTITY = 5`（四档推导在 `packages/local-api/src/tools/shared.ts`：
列出来 / 按 id 取一条 / 修改字段 / 该实体专属的那一个动作，第五档是余量；要第 6 个先回答它属于哪一档，
答不出通常意味着它属于**另一个实体**、或者它只是一个"读法变体"该做成参数），
`local-api.spec.ts` 逐 pack 断言、`check-ai-coverage.mjs` §10 再钉一遍"读不到这个常量就红"。
🔴 新判据比旧的**更严**：旧的那条下 `TASK` 一家吃掉 10 席中的 5 席不会响，现在会。
详见 `ai-event-tool-contract.md` §5.2 与 §6 第 3 条。

### 11.5 🔴 检查顺序：先验身份，再谈权限

`authorizeToolCall` 的顺序**就是**注释里声明的顺序：

```
① api-disabled → ② token-missing → ③ token-mismatch
                → ④ tool-unknown → ⑤ tool-not-granted
```

🔴 第 ③ 步在 ④ 之前是刻意的：「反过来的话，一个没带 token 的调用方可以通过
『未知工具』与『未授权工具』两种不同错误，**枚举出 heyta 到底提供了哪些工具**。」

| 规则 | 实现 |
|---|---|
| 逐工具授权 | `grants?.[toolName] !== true` → 拒绝。**未列出 = 关闭** |
| token 比较 | **定长比较**，不用 `===`（后者在第一个不同字符处提前返回） |
| 未授权 vs 不存在 | **给出逐字相同**的错误 `{code: -32601, message: '没有这个方法。'}` |
| 配置读取 | `getConfig` 是**函数**不是值 —— 撤销授权必须立即生效，不能等重启 |
| 列表 | `listMcpTools` 在握手时**不暴露**未授权工具（**完全不可见**，不是"看得见但调不动"） |

⚠️ `authorizeToolCall` **刻意只查 token，不查整个配置** —— 第一版调
`validateLocalApiConfig(config)` 导致**端口也参与了鉴权**：「一份 token 完全正确、
但端口写成 0 的配置会让**每一次工具调用都被拒**，而报错说的是『未启用』——
排查方向完全被带偏。」

### 11.6 🔴 加密条目可列举、不可读

`LocalApiItem`：`id` / `title` 是**元数据**（即使不可读也返回）；
`body?` 是正文（不可读时必须是 `undefined`）；`readable: boolean` **逐条**判定。

🔴 **白名单重建，不用黑名单删除**：

```ts
readable === true ? item : { id, title, readable: false }
                                 // body 故意不被复制
```

「黑名单永远会漏掉将来新增的字段，白名单不会 —— 新字段默认**不暴露**，
要暴露得显式加进来。」测试用未来的 `attachments` / `location` 字段证明它们不泄露。

`projectForTool()` 是**唯一实现点**，`projectAllForTool()` = `items.map(projectForTool)`，
**所有返回数据的地方都必须经过它**。

`get_task` 遇到受保护条目的正确答案是**拒绝**（JSON-RPC error），
**不是**返回一个看起来像"这个任务没有备注"的空结果。

### 11.7 🔴 写入必须经 `dispatch()` 形状的端口

理由是 ADR-0005 §3.1：**op-log 是唯一写入口**。本机 API 如果直接改状态、
或自己拼 op，就会绕过：向量时钟（→ 同步冲突解不开）、幂等（→ 重试产生重复任务）、
冲突检测。

代码层面的三重强制：

1. **形状封闭**：`LocalApiWriteIntent` 是封闭三动作联合
   （`create-task` / `update-task` / `complete-task`），且**刻意不是 `OpIntent`** ——
   工具**在类型上表达不出**「随便改个字段」或「自己拼一个 op」
2. **没有别的写入口**：`server.ts` 只在三处调 `host.submit(...)`
3. **测试证明**：用**记账的假 host** 断言 `calls` 恰为 `['submit']`

⚠️ **类型无法强制的部分被明确承认**：`submit` 必须是 `dispatch()` 这一点
类型上做不到；剩下那一半靠门禁（`check:layering` 的待办，见 §15）。

写入失败走**工具结果**（`{ content, isError: true }`）而非协议错误 ——
「因为它是『工具执行结果失败』，不是协议错误」。

### 11.8 🔴 通知不得有响应

```ts
if (request.id === undefined) return undefined;
```

「JSON-RPC 2.0 明确规定通知**不得**有响应。而 MCP 客户端在 `initialize` 之后
**立刻**会发 `notifications/initialized` —— 如果这里回一条 `-32601 Method not found`，
真实的客户端会认为服务端行为不合法。」

⚠️ 这条的发现过程值得记住：「这是『自己发给自己』的测试**永远测不出来**的那类问题：
我自己的测试只发了有 id 的请求，所以一直是绿的。」
测试现在覆盖：未知通知方法也不回 `-32601`；`id` 为 `0` 和 `''` 仍必须回；
未授权时的通知同样静默丢弃。

⚠️ **stdout 是协议专用的**：stdio 传输层**绝不用 `console.log`**，所有诊断走 stderr。
⚠️ token **只进环境变量**，不进命令行参数。

---

## 12. 密钥存储（`SecretStore`）

```ts
interface SecretStore { get(keyRef: string): Promise<string | undefined>; }
```

🔴 **配置里只有 `keyRef`，没有密钥。** 原话：「配置文件会被同步/导出/贴进 issue，
而钥匙串里的不会。」

| 平台 | 实现 | 状态 |
|---|---|---|
| Web | 会话级内存 | ✅ 但必须**在 UI 上明说「关掉页面就没了」** |
| macOS | `/usr/bin/security` | ✅ 已实现 |
| Windows | Credential Manager | ✅ 契约已定，实现**未做** |
| Linux | libsecret | ✅ 契约已定，实现**未做** |
| 移动端 | Keychain / Keystore | ✅ 契约已定，实现**未做** |

🔴 **密钥绝不走 argv**（`security -w <secret>` 会让 `ps` 看到）；
统一走 `security -i`（stdin）。含换行的密钥被明确拒绝。

⚠️ 未实现的平台**如实报错**，不"尽力试试"：「一个没验证过的钥匙串实现
最可能的失败方式是**静默丢密钥**。」

⚠️ Web 端**不允许让用户粘贴第三方 API Key**（ADR-0005 §3.2.2），只允许指向
用户自己的 OpenAI 兼容端点。

---

## 13. 相关门禁

| 门禁 | 与 AI 的关系 |
|---|---|
| `check:ai-coverage` | 每个 `AiFeature` 从「实现 → 导出 → 路由声明 → 偏好声明 → 界面」端到端可达，**不许有豁免**；并断言托管 AI 仍被挡住 |
| `check:ai-e2e` | 真 Chromium 跑用户旅程（假端点，不接真模型） |
| `check:ai-quota` | 「300 次/月」只有一个数字源；托管 AI 额度未实现的状态被**显式声明**（ADR-0023） |
| `check:ai-tools` | 内置 AI 工具路径 **7 条规则**：写只能出现在 `confirmAiToolProposal()` 里且恰好一处；无 op 构造、无网络调用、不 import `@heyta/op-log`（ADR-0035；已做 5 类故障注入）。规则 6 = W7 删掉的冗余前门（`runAiTool` / `grantedToolNames`）不许回来 + `describeRoutedFailure()` 定义点恰好一处（两条变异各自实测转红）；🔴 **规则 7 = 能力清单与上游一致**（跑 `gen-ai-capability-manifest.mjs --check`，不一致 exit 1）。⚠️ 它**没有**独立的 `check:ai-capability` 包脚本 —— 因为 `package.json` 此刻有别的会话的未提交改动，加脚本会带走它们；等该文件干净时抽成独立脚本（已登记） |
| `check:layering` | `no-model-endpoint-in-apps`、`no-vendor-ai-sdk-in-apps`、`no-loopback-classification-in-apps` —— 拦 `apps/*` 直连模型端点、引入厂商 SDK、自己判回环 |
| `check:licenses` | AI 调研发现一批**许可证地雷**（Nextcloud AI 全家桶 / Immich = AGPL-3.0；Piper 本体 = GPL-3.0）—— **一行代码都不能进** |
| `check:ui-language` | 用户可见文案的中文规则 |
| `check:tokens` / `check:design` | 出境提示 UI 的色值只能来自 `tokens.css` 的语义 token，**不能**用裸 hex |

⚠️ 诚实标注（ADR-0006 / `ai-capability-branches.md` §9.4）：这些规则
「**不该被读成『AI 出境已经完全受控了』**」—— 门禁只保证「调用点集中」，
真正受控要靠 §3 的闸门**被实际使用**。

---

## 14. 不变量清单（改代码前逐条对照）

1. 🔴 AI 只产出 `AiSuggestion`；**类型上产生不了 op**；写入必须过 `dispatch()` + 用户确认
2. 🔴 授权绑定 `(功能, 目的地)`；目的地变了 → 旧授权**自动失效**；切模式时**删除**不匹配的
3. 🔴 目的地**由端点推导**，不由模式声明
4. 🔴 **回退不得跨越隐私边界**；`fallback-needs-consent` 是一次网络请求都不发的独立原因
5. 🔴 隐私闸门默认关闭且 **fail-closed**；`memoryEnabled` 必填；可选参数的默认值指向**更保守**的一侧
6. 🔴 `managed` 在保留策略定案前**故意不可启用**；托管**绝不得**被描述成端到端加密
7. 🔴 出境披露必须「发给谁 + 发什么 + 留多久」，且**拒绝时也要能拿到**
8. 🔴 数据面**恰好等于**披露面；`fields` 逐项列出，不许 `['*']`
9. 🔴 能力**显式声明**，不做推断；`undefined` = 只有基线
10. 🔴 只有端点自己的问题才计入失败；「记一笔」与「换下一个」**是两个问题**
11. 🔴 熔断状态读回必须**封顶**、坏数据**丢掉而不抛错**、退化方向是"当作没有历史"
12. 🔴 密钥只走 `SecretStore`；配置里只有 `keyRef`；**绝不走 argv**
13. 🔴 推断层必须是**纯函数**；推断结果**不落盘**；只有用户纠正进 op-log
14. 🔴 `withheld` 与 `suppressed` **保持区分**
15. 🔴 本机 API：规则 1–4（默认关 / 只监听回环 / 显式 token / 加密条目可列举不可读）
16. 🔴 本机 API 的检查顺序：**先验身份、再谈权限**；未授权与不存在**报同一个错**
17. 🔴 敏感字段投影用**白名单重建**，不用黑名单删除
18. 🔴 通知**不得有响应**；stdio 的 stdout 是协议专用
19. 🔴 同一份业务语义只能有**一个实现 / 一个判据 / 一个文案来源**
20. 🔴 `AiFeature` 不得加入可视化；甘特图与倒计时**不是 AI**
21. 🔴 **多步循环的出境集合在循环开始前一次算完**（`planAssistantEgress(tier)`）；
    某一步要发集合外的字段 ⇒ **停**，不是静默放行（[ADR-0045](../adr/0045-conversational-assistant-split-authorization-from-catalog.md)）
22. 🔴 三个上界（步数 / 消息条数 / 单请求字节）**住在 `packages/ai`**，
    且**发之前**判、吃的是真要发的那段 JSON；失败的工具调用**照样计入步数**（失败不许免费重试）
23. 🔴 助手的档位默认 **`read-only`**（fail-closed）；它是**第二个授权前端**，
    与入站 `localApi.grants` **共用 `isToolGranted()` 但各存各的**，两边互不改对方
24. 🔴 日历锚点（「今天是 …」）只有**一个生产者**（`calendar-anchor.ts`），
    且 `today` **必须在出境声明里** —— 注入进提示词的每一项都是出境数据
25. 🔴 能力清单**只能生成、不许手写**（`scripts/gen-ai-capability-manifest.mjs`），
    不一致由 `check:ai-tools` 规则 7 判红

---

## 15. 现状与空白

> **进度数字与测试条数的唯一事实源是 [`../plans/ai-strategy.md`](../plans/ai-strategy.md) §7。**
> 本节只列**结构性**的空白，不重复数字。

### 15.1 契约已完备、但**产品里没有生产者**（🔲）

这一类最危险：**它坏掉的时候，用户看不到任何症状。**

| 项 | 现状 |
|---|---|
| 🔲 「受保护条目」 | `readable: false` **没有产品机制**。ADR-0011 §6.1 称它是唯一的真空白。壳目前显式传 `isReadable: () => true` |
| ✅ 熔断状态落盘 | `health-store.ts` + 壳的 `aiStore.ts`（`toHealthSnapshot` / `fromHealthSnapshot`）**已接线**：四个 AI 组件回写 `onHealth`，`App.tsx` 落盘并在启动时读回 |

⚠️ `isReadable` 曾经**默认** `() => true`（fail open），于是「真实产品里
`readable` 恒为 `true`，Bear 范式那条路径**从不执行**，且没有任何信号」。
现已改成**必填参数**。原话：「一个隐私相关的开关**不允许静默地失败在
『open』那一侧**。」

### 15.2 明确的未做项

| 项 | 卡在 |
|---|---|
| 托管 AI / MaaS | 已定档（ADR-0020/0021：¥12/月 · 300 次/月 · `deepseek-flash`），但**本轮不实现**（ADR-0023）：服务本体端点 / 计量 / 收银台**都不存在**；保留策略未定案，`assertEnableable` 继续抛 `retention-undecided` |
| AI-3 规划 | 有意推迟（需要真实数据） |
| AI-4 复盘 | 受限分支，未开工 |
| **AI 工具调用的 P4** | P0–P3 已落地：规则选择 + 单步执行 + 模型线格式 + 面板入口 + **多步读循环与末尾一次写提案**（[ADR-0045](../adr/0045-conversational-assistant-split-authorization-from-catalog.md)，Web 壳）。**需实体 id 的工具（P4）仍未开工** —— 单步入口下它结构性不可达，多步循环把"先查再改"变成可达了，但**目录里有 26 个工具**（读 12 / 写 14，覆盖面 **9/9** 实体（10-03 那批记的是 22 / 8-8） —— 口径是"读和写都有"，见 `ai-event-tool-contract.md` §2；2026-10-03 这一行先后错过两次："6 个 / 覆盖面 2/8"（`covered` 把只读的 `PROJECT` 计成已覆盖）与"9 个 / 覆盖面 3/8"（同批早几个小时的抄件，那五格本批已补齐）），且**覆盖面已有门禁**（`check-ai-coverage.mjs` §9，挂在 `check:ai-coverage` ⇒ 在 `pnpm check` 里）；托管路径的权益闸门（`capability:'ai'`）也因托管 AI 未实现而未接 |
| 只读模式 | `grants` 已能表达，助手侧有 `read-only` 档；**入站 MCP 那侧仍没有"只读预设"的 UI 引导**（逐工具开关已有） |
| 调用审计 | 未做（考虑过"记录每次调用"，但那本身是一份新的敏感日志） |
| 「回退披露必须写出整条链」 | ⚠️ 见 §15.3 |
| ~~`packages/ai` 的"两套实现"~~ | ✅ **已收敛**（2026-10-03，W7）：`packages/ai/src/wire.ts` 一份线格式，`provider.ts` 与 `routing.ts` 各删自己那份。判据**不是** grep 计数，是 `packages/ai/tests/wire.spec.ts` 把两条路各自交给 `fetchImpl` 的 **url / headers / 原始 body 串逐字节比对**（变异：只给一条路的 `system` 加一个空格 ⇒ 恰好 1 红）。⚠️ 仍**不导出** `wire.ts`：线格式是包内接缝 |
| 对话历史的持久化 | 🔲 **只活在组件内存里**，刷新即失（ADR-0045 的 D-4 未拍 ⇒ 没写"存哪儿"的代码）。已知代价：刷新丢上下文，而"新会话"按钮与它长得一样 |
| 非 Web 壳的助手入口 | 🔲 移动端 / Electron / 原生壳**零 AI 入口**（本批只落 Web 壳） |
| `check:layering` 的第 9 条 | 「`apps/*` 不得绕过 `LocalApiWritePort` 直接改状态」——现在加会是规定一个不存在的违规 |

### 15.3 未核实

- ⚠️ **「用户是否真的愿意自带 Key」**：ADR-0005 标 🟡 未核实，且证据**不利** ——
  13 个产品横向调研里**没有任何一家支持用户自带 LLM API Key 驱动内置 AI**。
- ⚠️ **「E2EE + 客户端本地明文 API」的完整公开威胁模型文档未找到** ——
  「这份威胁模型 heyta 得自己写」。
- ⚠️ AI-3 调研**全程无留存数据**（Reddit / G2 / Trustpilot 反爬）。
- ⚠️ 偏好实验用**合成数据**（见 §9.7）。
- ⚠️ **「发特征，不要发原文」是判断，不是实测结论** —— 它还没有被任何东西验证过。
- ⚠️ 「记忆 → 专注落差」这条护城河同样**尚未验证**。

### 15.4 已消除的文档内部不一致（记录，供追溯）

下面三处曾记录为"漂移"，**本轮文档同步已修**（改的是文档，不涉及决策）：

- ~~[`../plans/ai-capability-branches.md`](../plans/ai-capability-branches.md) 头部写
  「上游决策：ADR-0005（**待确认**）」~~ → 已改为 ADR-0005 **已接受**。
- ~~同一文件 §9.28 写「MCP 传输层只有 HTTP」~~ → stdio 已落地，§9.28 已更新。
- ~~[`../plans/ai-memory-system.md`](../plans/ai-memory-system.md) 文档头写「待实施」~~ →
  文档头已改为 M1–M6 全部完成。

> 这些是**漂移**，不是决策冲突。修改它们属于文档整理，不需要新 ADR。

---

## 16. 改这个系统时的规则

1. **先读 [ADR-0005](../adr/0005-ai-data-path.md) §3.1 与
   [ADR-0006](../adr/0006-supply-modes.md) §3.2** —— 这两节覆盖 80% 的判断。
2. **新增一个 AI 功能** → 走 `AiFeature` 加值？**先问它要不要出境**，
   再问它用哪几个字段，然后更新 `DEFAULT_FEATURE_CAPABILITIES`。
   ⚠️ 不要为了"界面方便"而合并 feature。
3. **新增一个端点/供应商** → 不要加 SDK。填一个 `keyRef`，能力**显式声明**。
   若它是云端 → **不进 `presets.ts`**。
4. **新增一个持久化字段** → 必须**可选** + 运行时默认值；
   `CURRENT_SCHEMA_VERSION` 保持 **1**；⚠️ 不要新增必填字段。
5. **新增一个偏好** → 四条判据全过（改变行为 / 今天就能推断 / 错了能纠正 /
   **能被证伪**）+ 留出法实验显著优于基线，否则删掉。
6. **加一个本机工具** → 默认关、只读优先、写必须经 `LocalApiWritePort`；
   ⚠️ 先问「真的需要吗」——但**问的单位是每个实体**：一个 pack 至多 `MAX_TOOLS_PER_ENTITY = 5` 个。
7. **改隐私相关开关** → 问一句：**它失败时倒向哪一侧**。
   倒向"放开"就是错的，无论代码多干净。
8. **写完后检查调用点** —— 本项目反复踩的坑是
   **「能力实现了、被测了，但没人调用」**。没有生产调用点 = 没做。
9. **提交前跑** `node research/tools/docs-link-check.mjs` 与 `pnpm check`。
