# AI 工具调用 —— 分阶段计划

> 状态：🟢 **P0–P2 已落地**（2026-09-28）。P3–P4 未开工。
> 决策与不变量见 [ADR-0035](../adr/0035-ai-tool-calling-reuses-local-api.md)。
> 进度数字的唯一事实源仍是 [`ai-strategy.md`](ai-strategy.md) §7；本文只记这条线的分阶段内容。

---

## 0. 一句话

让 heyta 自己的 AI 能"识别用户想做什么 → 选中一个工具 → 执行它"，
**复用既有的工具目录、授权与执行器，不新建工具系统**；先只读、先规则、先单步。

---

## 1. 为什么不新建一套

审计结论（证据见 ADR-0035 §1.3）：`packages/local-api` 已经有**本就是给模型设计的**
工具目录（6 个，带 `read`/`write` 与 JSON Schema）、"未授权即不可见"的投影、
逐工具授权（`grants` + 设置界面）与"工具 → `dispatch`"的执行器。
新建目录/注册表/权限系统会直接违反不变量 19（同一份语义只能有一个实现）。

所以本计划的全部新增代码只有**两个模块**，其余是"把既有件抽出来给两个调用方共用"。

---

## 2. 分阶段

| 期 | 内容 | 落点 | 状态 |
|---|---|---|---|
| **P0** | 共用件抽取 + 规则选择 + 单步执行（读即执行 / 写只提案） | `local-api`（导出 `isToolGranted` / `runReadTool` / `toWriteIntent`）+ `app-host`（`ai-tool-selection.ts` / `ai-tool-run.ts`） | ✅ **已完成** |
| **P1** | 接用户手指：在既有 AI 入口里触发单步工具（复用 `features/ai`，不新增页面） | `apps/web`（`AiToolRun.tsx`，挂在任务视图） | ✅ **已完成** |
| **P2** | 模型选择：`tools` / `tool_calls` 线格式 + 新 `AiFeature`（`tool-calling`）+ 授权行 + 披露 | `packages/ai`（`AiInvocation.tools` / `extractToolCalls`）+ `app-host/ai-tool-call.ts` + `apps/web` | ✅ **已完成** |
| **P3** | 多步**只读**循环：字段并集前置披露 + 硬上界（步数/调用数/时间） | `app-host`（`packages/ai` 提供线格式） | ⏸ |
| **P4** | 需要既有实体 id 的工具（`get_task` / `update_task` / `complete_task`）：先检索再执行 | `app-host` | ⏸ |

> ⚠️ **写永远不在循环里**（P3）。写只发生在循环之外、用户确认之后 —— 这是 ADR-0035 不变量 1。

---

## 3. 落了什么（可复核）

### P0 —— 共用件 + 规则选择 + 单步执行

| 文件 | 内容 |
|---|---|
| `packages/local-api/src/tools.ts` | 抽出 `isToolGranted(grants, name)`；`authorizeToolCall` 改为调它（行为不变） |
| `packages/local-api/src/server.ts` | 抽出 `runReadTool(host, name, args)` 与 `toWriteIntent(name, args)`；`executeTool` 改为拼装它们（行为不变） |
| `packages/local-api/src/mcp.ts` | 抽出 `listAuthorizedTools(grants)`（中性定义）；`listMcpTools` 改为调它 —— MCP 与 AI **共用同一份投影** |
| `packages/app-host/src/ai-tool-selection.ts` | `resolveToolSelection()`：规则优先、grants 过滤、歧义/未授权分开、参数抽不出就丢弃 |
| `packages/app-host/src/ai-tool-run.ts` | `runAiTool()` / `runSelectedTool()`（读即执行、写只提案）+ `confirmAiToolProposal()`（唯一写点） |
| `scripts/check-ai-tools.mjs` | 门禁：写只能出现在确认函数里且恰好一处 / 无 op 构造 / 无网络调用 / 不 import op-log（已做 5 类故障注入验证） |

### P1+P2 —— 模型选择 + 用户入口

| 文件 | 内容 |
|---|---|
| `packages/ai/src/provider.ts` | `AiToolDescriptor` / `AiToolCall`；`AiInvocation.tools?`；`AiSuggestion.toolCalls?`；`extractToolCalls()`（逐项收窄、坏项丢弃、`arguments` 不解析） |
| `packages/ai/src/routing.ts` | 请求体加 `tools` + `tool_choice`（**省略时逐字不变**）；"只调工具不说话"视为合法响应；`DEFAULT_FEATURE_CAPABILITIES['tool-calling'] = ['tool_calling']` |
| `packages/ai/src/egress.ts` | 新 `AiFeature` 成员 `'tool-calling'`（独立授权，不复用四功能） |
| `packages/domain/src/preference-hints.ts` | `'tool-calling': []` —— **刻意零偏好**（它是路由决定，不是生成决定） |
| `packages/app-host/src/ai-tool-call.ts` | `requestToolCall()`：**规则先跑（零出境短路）** → `invokeRouted` → 解析/校验 → 复用 `runSelectedTool`；`buildToolCallInvocation()` 的 `fields` 含 `tools` |
| `apps/web/src/features/ai/AiToolRun.tsx` | 面板：规则命中不出境并**明说**；需要模型时先披露再发送；写工具出提案 + 确认按钮 |
| `apps/web/src/features/settings/AiSettings.tsx` | 新功能进 `FEATURE_ORDER` / 功能名表（**复用既有逐功能授权 UI**） |

**判据（完成时实测）**

| 命令 | 结果 |
|---|---|
| `pnpm --filter @heyta/local-api test` | **79 通过**（重构后行为不变） |
| `pnpm --filter @heyta/ai test` | **162 通过**（新增 11 条工具线格式） |
| `pnpm --filter @heyta/app-host test` | **598 通过**（新增 36 条） |
| `pnpm --filter @heyta/web test` | **820 通过 / 12 跳过**（新增 4 条面板测试） |
| `pnpm --filter @heyta/i18n test` | **10 通过**（zh/en 各 1556 条，逐条对齐） |
| `pnpm check:ai-coverage` | exit 0 —— **5 个 AI 功能全部端到端可达**（含新 `tool-calling`） |
| `pnpm check:ai-tools` | exit 0；5 类注入全部变红，对照组绿 |
| `pnpm check:docs` / `check:layering` / `check:ui-language` / `check:licenses` / `check:ai-quota` / `check:claims` / `check:design` | exit 0 |
| 各相关包 `typecheck` / `build` | exit 0 |

---

## 4. 决策记录（已定，不再挂起）

| # | 决策 | 定案 | 复议条件 |
|---|---|---|---|
| 1 | 承载层 | **复用 `local-api` + `app-host`，不建新包** | 出现第三个调用方（既非 MCP 也非内置 AI）时重议 |
| 2 | 权限结合 | **复用同一份 `grants`；写额外要用户确认** | 用户反馈"不想让内置 AI 用我授权给外部程序的工具"时 |
| 3 | 意图识别 | **先纯规则，模型后置（P2）** | — |
| 4 | 循环 | **先单步，循环后置（P3）** | — |
| 5 | 模型范围 | **只用国内端点**，不绑厂商，线格式取 OpenAI 兼容子集 | — |

---

## 5. 明确不做

- ❌ 新建工具目录 / 注册表 / 权限系统（ADR-0035 §5）
- ❌ 让 AI 直接 `submit`（写必须用户确认）
- ❌ 在工具层发网络请求（出境只能走 `@heyta/ai`）
- ❌ 接外部第三方工具生态（本阶段只做生态内部）
- ❌ 为工具调用新增产品路由/页面（复用既有 AI 入口与设置面板）

---

## 6. 验收命令

```bash
pnpm --filter @heyta/local-api test
pnpm --filter @heyta/ai test
pnpm --filter @heyta/app-host test
pnpm --filter @heyta/web test
pnpm --filter @heyta/i18n test
pnpm check:ai-tools
pnpm check:ai-coverage
pnpm check:ai-e2e
pnpm check:docs
```

## 7. 下一步（P3/P4）

- **P3 只读循环**：必须先做"字段并集**前置**披露"（循环中途无法再征求授权）与硬上界；
  写工具**仍然不进循环**。
- **P4 需实体 id 的工具**：自然语言给的是标题不是 id —— 要先"检索出候选 → 用户/模型选定 → 再执行"，
  本质上是把两条只读与一条写串起来，正好是 P3 的第一个真实用例。
