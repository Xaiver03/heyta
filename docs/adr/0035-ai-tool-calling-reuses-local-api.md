# ADR-0035：AI 工具调用复用既有工具目录与权限层，**不新建工具系统**

> 状态：**已接受**
> 日期：2026-09-28
> 相关：[ADR-0005](0005-ai-data-path.md)（AI 不写 op）、[ADR-0006](0006-supply-modes.md)（供给与出境）、
> [ADR-0010](0010-ai-config-routing.md)（配置路由）、[ADR-0011](0011-local-api-mcp.md)（本机 API / MCP）、
> [ADR-0013](0013-cloud-ai-and-maas.md)（云端 AI）
> 落地计划：[`../plans/ai-tool-calling.md`](../plans/ai-tool-calling.md)

---

## 1. 背景与约束

### 1.1 要做什么

让 heyta 自己的 AI 能**识别用户想做什么 → 选中一个工具 → 执行它**。
P0 只覆盖**生态内部**的工具（不接外部第三方工具生态），且**只读优先**。

### 1.2 三条硬约束（都不是偏好）

1. **AI 不能写 op。** AI 只产出建议，写入必须过 `dispatch()` + 用户确认
   （ADR-0005 §3.1；`docs/reference/ai-architecture.md` §14 不变量 1）。
2. **出站/入站两条线不合并。** `packages/ai`（我们发数据给模型）与
   `packages/local-api`（别的程序拉我们的数据）刻意分开，理由是"放一起会在类型层面
   把两个方向混为一谈"（ADR-0011 §2）。
3. **模型只用国内端点。** 已定托管模型是 `deepseek-flash`（ADR-0021）；
   本层不绑定任何厂商，工具线格式只取 OpenAI 兼容子集
   （DeepSeek / 通义 / 智谱 / 豆包方舟 / Kimi 均支持）。

### 1.3 关键前提：基础设施**已经存在**

审计发现"AI 调工具"所需的基础设施**大部分已经在仓库里，而且本来就是给模型设计的**：

| 已有资产 | 位置 | 为什么它已经够用 |
|---|---|---|
| 单一工具目录（6 个） | `packages/local-api/src/tools.ts` | `description` 的注释原文就是"**给模型看的说明**" |
| 工具 JSON Schema | `packages/local-api/src/mcp.ts`（`INPUT_SCHEMAS`） | `additionalProperties: false`，可直接映射成模型工具线格式 |
| **未授权即不可见** | `mcp.ts` 的 `listMcpTools()` | 已是"只把已授权工具报给调用方"的立场 |
| 逐工具授权 + UI | `local-api/src/tools.ts` 的 `grants`；`apps/web/.../AiSettings.tsx` | 已有勾选框、已持久化进 `aiStore` |
| 工具 → `dispatch` 执行器 | `packages/app-host/src/local-api-host.ts` | 已把 `LocalApiWriteIntent` 翻成 `TaskActions` |
| 用户/权益能力 `'ai'` | `server/src/entitlement.ts` | `ENTITLEMENT_CAPABILITIES = ['hosting','ai']` |

---

## 2. 决策

**AI 工具调用是既有工具基础设施的又一个调用方，不是一套新系统。**

具体地：

1. **工具目录只有一份**（`LOCAL_API_TOOLS`）。需要新工具就往这一份里加，
   **不新建目录/注册表**（违反不变量 19：同一份语义只能有一个实现）。
2. **权限只有一份**（`localApi.grants`）。AI 路径与 MCP 路径**共用同一份授权**，
   **不新建权限系统**。授权判定抽成 `isToolGranted()`，两个调用方共用。
3. **执行语义只有一份**。只读执行抽成 `runReadTool()`、写入意图映射抽成
   `toWriteIntent()`，MCP 的 `executeTool()` 与 AI 路径**都调它们**。
   于是"同一工具在两个入口有两种行为"不可能发生。
4. **不新建包**。落点：`packages/local-api`（导出共用件）+ `packages/app-host`
   （选择与执行策略）。UI 复用既有 AI 设置面板与 AI 入口，**不新增路由/页面**。

---

## 3. 不变量（改这块之前逐条对照）

1. 🔴 **写工具在 AI 路径上永远不执行。** `runAiTool()` 对写工具只产出
   `AiToolProposal`（内含 `LocalApiWriteIntent`）；只有 `confirmAiToolProposal()`
   能调 `host.submit()`，而它只能由用户确认后调用。
2. 🔴 **写只出现在一个地方、且只有一处。** 由 `check:ai-tools` 静态钉住
   （已做故障注入：在别处加一次 `submit` 会红）。
3. 🔴 **两道闸，与 MCP 侧对齐**：候选过滤（未授权不可见）+ 执行前复查
   （选择到执行之间可能被撤销授权）。**fail-closed**。
4. 🔴 **工具层不发网络请求。** 本层没有 `fetch`、没有端点字面量；
   模型调用（P2）必须走 `@heyta/ai` 的 `invokeRouted()`，即生产唯一出境执行点。
5. 🔴 **工具层不 import `@heyta/op-log`**，因此类型上造不出 op。
6. 🔴 **默认只读。** 默认规则集不含任何写工具；写工具要显式注入规则才会被选中。
7. 🔴 **歧义就问，不挑**（`ambiguous`）；**抽不出参数就丢弃候选**，不用空参数硬调。
8. 🔴 **两种失败分开报**：`no-match`（没听懂）与 `no-tool-granted`（没授权）
   的界面措辞与修复动作不同，不得合并。

---

## 4. 与出境闸门的关系

| 路径 | 是否出境 | 闸门 |
|---|---|---|
| **P0 规则选择** | **不出境** | 无需授权（规则在本机跑） |
| P2 模型选择 / 参数抽取 | **出境** | 新增 `AiFeature` 成员 + `(功能, 目的地)` 授权 + 字段披露 |
| 只读工具结果回灌给模型（P3 循环） | **出境** | 循环**开始前**按可达工具集算出字段并集**一次性披露**；步骤要发集合外字段 → **停** |

> 🔴 P2 必须新增 `AiFeature` 成员（例如 `tool-selection`），**不得复用**既有四功能的授权 ——
> 授权绑定的是"哪些数据会出去"，而"用户想让 AI 干活"这句话的字段面与四个功能都不同。
> `check:ai-coverage` 会强制新成员端到端可达。

---

## 5. 被否决的选项

| 选项 | 否决理由 |
|---|---|
| 新建 `packages/ai-tools` + 新工具目录 | **重复造轮子**：工具目录、Schema、授权、执行器、写入口都已存在，且目录本来就是"给模型看的" |
| 新建一套 AI 专用权限系统 | 违反"权限只有一份"；且用户要在两个地方开同一件事 |
| AI 路径复用 `authorizeToolCall()` | 它是"会话闸（总开关 + token）+ 授权"的组合；AI 是进程内调用，没有 listener/token，硬套就得伪造 token |
| 让 AI 直接 `submit`（省掉确认） | 直接违反 ADR-0005 §3.1：那是把"模型可以自己改用户数据"放进产品 |
| 把工具线格式塞进 `packages/local-api` | 那是**出站**协议形状，属于 `packages/ai`；放错包会把入站/出站两条线混起来 |
| 只检查"写有没有在确认函数里" | 不够：同时留着另一处直接 `submit` 仍会绿。必须钉"恰好一处" |

---

## 6. 落地分层

| 层 | 职责 | 状态 |
|---|---|---|
| `packages/local-api` | 工具目录、Schema、授权（`isToolGranted`）、只读执行（`runReadTool`）、写入意图映射（`toWriteIntent`）、中性工具投影（`listAuthorizedTools`，MCP 与 AI 共用） | ✅ |
| `packages/app-host/src/ai-tool-selection.ts` | 自然语言 → 工具选择（纯规则、grants 过滤、歧义/未授权分开） | ✅ P0 |
| `packages/app-host/src/ai-tool-run.ts` | 单步执行：读即执行 / 写只提案 / 确认才 `submit` | ✅ P0 |
| `packages/app-host/src/ai-tool-call.ts` | 模型路径：规则优先（零出境短路）→ `invokeRouted` 带 `tools` → 校验后复用 `runSelectedTool` | ✅ P2 |
| `packages/ai` | 工具线格式（`AiInvocation.tools` → OpenAI `tools`；`extractToolCalls`）；`tool_calling` 能力由 `'tool-calling'` 功能真正消费 | ✅ P2 |
| `apps/web`（`features/ai/AiToolRun.tsx` + `AiSettings`） | 复用既有 AI 面板位置与逐工具开关，**不新增页面**；新 `AiFeature` 已进逐功能授权表 | ✅ P1+P2 |
| 用户/权益 | 自备端点（BYOK）不受限；托管路径由既有 `createEntitlementGuard({ capability: 'ai' })` 把关 | ⏸ 随托管 AI |

---

## 7. 未做 / 未核实

- ✅ **规则选择 + 单步执行**（P0）与 **模型选择 + 用户入口**（P1+P2）已落地（2026-09-28）。
- ⏸ **多步只读循环**（P3）：需要"字段并集前置披露"与硬上界一起做。
- ⏸ **需要既有实体 id 的工具**（`get_task` / `update_task` / `complete_task`）：
  自然语言给的是标题不是 id，单步规则填不出来 —— 留给 P3 的"先检索再执行"。
- ⚠️ **未核实**：规则命中的准确率没有实测数据（当前只有单测钉语义，没有真实语句样本）。
- ⚠️ **未核实**：托管 AI 的权益闸门客户端侧怎么读 `'ai'` 能力（服务端已有
  `evaluateCapability`，但客户端探测目前只读同步权益）。
- ⚠️ **未核实**：国产端点的 `tool_calls` 方言差异（本层只做 OpenAI 兼容子集的
  防御性解析：坏项丢弃、`arguments` 不猜；没有对真实端点做过逐家实测）。

---

## 8. 相关文档

- [`../plans/ai-tool-calling.md`](../plans/ai-tool-calling.md) —— 分阶段计划与状态
- [`../reference/ai-architecture.md`](../reference/ai-architecture.md) —— 结构与不变量事实源
- [`../plans/ai-strategy.md`](../plans/ai-strategy.md) —— 信任阶梯（agent 多步是最后一步）
- 门禁：`scripts/check-ai-tools.mjs`（`pnpm check:ai-tools`）
