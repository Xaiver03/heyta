# AI 功能完整度审计：本地完整、云端刻意受阻

> 状态：**调研记录**（归档层，结论有变时新增勘误、不改原文）
> 审计日期：**2026-09-30**（CST）。所有路径为**仓库根相对路径**，行号以当日工作区为准。
> 方法：只读代码审计 —— 逐条把 `AGENTS.md` / ADR / 文档里对 AI 的声称**回到代码里核实**，
> 不采信文档自身。**未修改任何文件。**
>
> 本文回答的问题只有一个：**「AI 功能做完整了吗？」**
> 答案是**分层的**：本地自带端点模式**完整**；托管/云 AI **刻意受阻**且受阻点全部仍在代码里。

---

## 0. 一句话结论

| 供给模式 | 完整度 | 判据 |
|---|---|---|
| **`own`（自带端点 / BYO-key）** | ✅ **端到端完整** | 4 个 AI 功能 + 工具调用 P0–P2 + 入站本地 API/MCP + 记忆偏好层，每条路径都有**生产调用者**，由 `check:ai-coverage` 强制到"渲染"级 |
| **`off`** | ✅ 完整 | 面板仍渲染，但解释启用路径而不是静默消失 |
| **`managed`（云端）** | 🔴 **刻意受阻，不是没做完** | 每个执行点都一致：`supply.ts` 抛 `retention-undecided`（**运行时**钉在门禁里）、`invokeRouted` 结构上到不了 `heyta-cloud`、`hosted-ai-monthly` 禁售、`server/src` 零 AI 端点 |

**"不完整"的部分全部是**有意的产品决策 + 有门禁兜底的暂缓**，不是遗忘或半成品。**
真正值得动手的缺口有 3 个（§4），其中只有第 1 个是本仓库自己能修的。

---

## 1. 端到端已实现的清单（含入口点）

### 1a. 出站 AI（`packages/ai`）—— 与声称一致，逐条已验证

| 声称的组件 | 代码证据 |
|---|---|
| 供给模式 `off/own/managed`，**目的地由端点推导**（不是用户填的） | `packages/ai/src/supply.ts` — `classifyDestination` L91-101；`isLoopbackEndpoint` L73-88（**字面量判定，不做 DNS 解析** —— 所以 `localhost.evil.com` 不会被当成 loopback）；`AiConfigError` 的三种 reason L256；`retention-undecided` 抛出点 L300 |
| 出境闸门，**同意绑定到 `(feature, destination)`** | `packages/ai/src/egress.ts` — `authorizeEgress` L155-173；`retainValidConsents` L187-194；**拒绝时仍返回披露信息**（L159/L172）—— 用户看得到"会发什么出去"再决定 |
| provider 端口**产不出 op** | `packages/ai/src/provider.ts` — `AiSuggestion` L108-122 **没有** `OpType` / `entityId` / 向量时钟；零厂商 SDK，只讲 OpenAI 兼容的 `/chat/completions`（L299、L865）；文件头 L14-33 声明"不写 op、不碰 op-log、不含厂商 SDK" |
| 配置路由 / 多端点 / 能力匹配 / 熔断 | `packages/ai/src/routing.ts`（1012 行）—— `invokeRouted()` 是**唯一**的生产出境执行点；`validateEndpointUrl` L419 |
| **回退不跨越隐私边界** | `routing.ts:806` 返回独立的失败原因 `fallback-needs-consent` —— **从不自动重试**到另一个目的地 |
| URL 在**保存时与发送时各验一次**（ADR-0010） | 保存：`apps/web/src/features/settings/AiSettings.tsx:414`、`:660`；路由解析：`routing.ts:547`；**实际发送路径上**：`attemptOnce` `routing.ts:838-857`（注释直引 SSOS 的"执行必须位于实际发送请求的路径上"） |
| 健康度 / 熔断状态持久化 | `packages/ai/src/health-store.ts`（263 行） |
| 预设**仅限 localhost** | `packages/ai/src/presets.ts:67`（`http://localhost:11434/v1`）、`isLocalOnly` L114 |

### 1b. 应用主机编排（`packages/app-host/src`）

- 四个 AI 功能都走 **`invokeRouted`（生产路径）而不是 `createProvider`（测试/遗留路径）**：
  `ai-capture.ts`（604 行，调用点 L525）、`ai-breakdown.ts`（407 行，L297）、`ai-prioritize.ts`、`ai-duration.ts`。
- `ai-tool-selection.ts` —— NL→工具**纯规则**，4 条只读规则（L94-119）；候选与执行**两处**都按授权过滤；`no-tool-granted` 与 `no-match` **分开报**（L122-128，不把"没授权"伪装成"没匹配"）。
- `ai-tool-run.ts` —— **读＝执行**（`runReadTool` L160-168）；**写＝仅提案**（`toWriteIntent` L170-174）；`host.submit` **只出现一次**，在 `confirmAiToolProposal()`（L183-188）；执行前**重新**检查授权（L152，fail-closed）。
- `ai-tool-call.ts` —— 模型路径：**规则优先**，只有 `no-match`/`ambiguous` 才发模型（L10-15）；出境字段 `['text','tools']`（L73）；文件内**无 fetch、无 op-log import**（静态门禁）。
- 反馈：`ai-feedback-actions.ts` 经 op-log 落 `AI_FEEDBACK` / `PREFERENCE_CORRECTION`。
- 记忆偏好层：`packages/domain/src/preferences.ts`（`memoryEnabled` 是 L83/L181 的**必填参数** ⇒ fail-closed）；`preference-hints.ts:148` 关闭时返回 `[]`；**推理是纯函数、从不持久化**，只有**用户更正**进 op-log。

### 1c. 入站 AI（`packages/local-api` + `apps/node-host`）

- `packages/local-api/src/tools.ts`（520 行）—— `DEFAULT_LOCAL_API_CONFIG` L255-256 **`enabled: false`**；`validateLocalApiConfig`（`not-loopback`/`token-required`/`bad-port`）；**令牌检查先于工具查找**（`authorizeToolCall` L364-390，计时安全比较）；不可读条目的隐私投影 `projectForTool` L174-181（"可列举、不可读"）。
- MCP 工具形态：`packages/local-api/src/mcp.ts` —— 未授权工具**不可见**（不是"可见但拒绝"）。
- 三个入口（`apps/node-host/package.json:22-24`）：
  - `pnpm mcp` → `cli-mcp.ts` → `mcp-stdio-server.ts`（stdio，**默认关闭**，拒绝静默回退）
  - `pnpm local-api` → `local-api-server.ts`：`startLocalApiServer` L70+，`!config.enabled` 时**抛异常**（L78-84）；启动时校验；**仅 POST、仅绑 loopback**
  - `pnpm ai` → `cli-ai.ts`：keychain 密钥管理（`key set/list/clear`），**密钥只从 stdin 读**（L51-62），**仅 macOS**（L33-35）
- 真实 MCP 客户端验证：`scripts/verify-mcp-real-client.mjs`（`pnpm verify:mcp-real`）。

### 1d. Web UI 入口（`apps/web`）

- `features/settings/AiSettings.tsx`：三步门禁 + 端点/路由编辑器 + **按功能分别征求出境同意** + 本地 API/MCP 段（L975-1004：开关、令牌、按工具授权）。
- `features/settings/aiStore.ts`：持久化（含健康快照与 `localApi`，L54/L94）。
- `features/settings/MemoryPanel.tsx`：可见/可忘记/可恢复，fail-closed 分支在 L145。
- `features/ai/`：`AiBreakdown` / `AiCapture` / `AiPrioritize` / `AiDuration` / `AiToolRun`（**带确认步骤的写入提案**）/ `RouteUnavailable` / `ai-failure-copy.ts`。全部挂载于 `apps/web/src/App.tsx`（导入 L122-132）。
- 移动端**零 AI 入口**（`apps/mobile/src` 无 `@heyta/ai` 导入）；桌面端经 webview（ADR-0037）。

---

## 2. 刻意设置的受阻点 —— **三个都确认仍在代码里**

### 2.1 `retention-undecided`（ADR-0013 / ADR-0006）

- 代码：`packages/ai/src/supply.ts:290-304` —— `assertEnableable` 在 `retentionDisclosure('heyta-cloud').kind === 'undecided'` 时抛 `AiConfigError(..., 'retention-undecided')`（L296-302）；工厂处 `provider.ts:234` 也调。
- ADR-0013 §4 的 5 项前置（服务、**保留策略**、计量、工具边界、云粒度）**一项都没做**。
- 🔴 **有运行时门禁**：`scripts/check-ai-coverage.mjs:361-376` **真的 import 构建产物**并调 `assertEnableable({mode:'managed'})`，断言失败原因**恰好**是 `retention-undecided`。接入 `pnpm check`（`package.json:43` 的 `check:ai-coverage`）。
  —— 这条门禁的形状值得记：它钉的不是"字符串出现过"，而是"**运行时真的还被挡着**"。

### 2.2 "300 次/月"配额未实现 + 禁售（ADR-0023）

- SSOT：`docs/reference/pricing-and-entitlements.md:79-86`（`"quota": 300, "enforcement": "not-implemented"`）+ 禁售行 L97。
- 结账阻挡：`server/src/billing/price-book.ts:116-117`（`NOT_YET_DELIVERABLE_SKUS['hosted-ai-monthly']`），由 `server/src/billing/checkout.routes.ts:130` 执行 ⇒ 下单返回 **409**。
- 门禁：`scripts/check-ai-quota-consistency.mjs`（256 行）—— 校验 SSOT 块、5 个声明点（zh/en 词条、法律、文档）**全部等于 300**；只有当计量哨兵文件（如 `server/src/billing/ai-quota.ts`）存在时才允许 `enforced`（L54-58）。
- 接入：`package.json:39` + 聚合门禁 L43。**已确认。**

### 2.3 服务端没有云 AI

- `server/src` 中 `deepseek|chat/completions` → **0 命中**。ADR-0023 的前提仍然成立。

---

## 3. 面向用户的承诺 vs 实现状态

| 承诺 | 位置 | 实现状态 |
|---|---|---|
| "云端 AI，每月 300 次" | `packages/i18n/src/locales/zh-CN.ts:214`、`en.ts:197`（定价层 `hostedAi`） | **无实现**。缓解：该层 CTA 是"即将开放"（`zh-CN.ts:216`、渲染于 `apps/landing/src/components/Pricing.tsx:100`），且结账 409。**ADR-0023 明确允许保留此文案** —— 目的是让"未交付"这件事在定价页上可见，而不是藏起来 |
| "设置页可查『本周期已用 X / 300 次』" + "到点即停" | `server/legal/terms-of-service.ai.heyta.md:113,119`（§5.3/§6） | **无实现**。法律文本被 `check:ai-quota` 钉为声明点，所以它不会悄悄漂移；但承诺本身**要等计量存在才能兑现** |
| `site.pricing.seo.description` 里的"官方托管加云端 AI ¥12/月" | `zh-CN.ts:2395` | 同上 |

> 这三条**不是"撒谎"**：它们描述的是**已定价但未交付**的层级，且落地页与结账口都如实拦住。
> 但它们必须与 §2.2 的计量工作**同批**完成 —— 这是 ADR-0023 §5 的交货顺序。

---

## 4. 真正的缺口（按"本仓库能不能自己修"排序）

### 4.1 🔴 受保护条目（`readable:false`）没有产品机制 —— **最严重的半成品**

- 壳把 `isReadable` **硬编码成 `() => true`**：`apps/web/src/features/tasks/store.ts:223`。
- 于是 `packages/local-api/src/tools.ts` 的隐私投影（`projectForTool` L174-181："`readable === false` ⇒ 正文类字段**一律剥掉**，元数据保留"）**在生产环境永不可达**，只在测试里跑得到。
- `apps/web/src/features/tasks/store.ts:218` 的注释**如实**说明了这点："heyta 目前没有『受保护条目』这个产品概念"。
- ADR-0011 §6.1 自己把它称作唯一真正的缺口。
- **性质**：这不是 bug，是**未做完的功能**。修它需要先有"标记为受保护"的产品概念（UI + 持久化字段 + op 类型），超出本次审计范围。
  ⚠️ 但要注意顺序：**入站 AI 的隐私承诺目前依赖一个用户无法表达的前提。**

### 4.2 "发送特征，不发送原始文本"从未实现

- `packages/app-host/src/ai-breakdown.ts` 仍把**原始 `title` / `note`** 放进提示词。
- `docs/plans/ai-strategy.md` §2 自己就警告过这是"**判断，而不是实测结论**"。
- **性质**：文档与代码不一致。要么实现特征化，要么把文档改口 —— 两者都比现在这样好。

### 4.3 工具调用 P3 / P4 未开始

- P3（只读多步循环）、P4（需要实体 ID 的工具：`get_task`/`update_task`/`complete_task`）。
- 托管路径的权利门禁（`capability:'ai'`）**未接线**（`docs/reference/ai-architecture.md:1025`）。
- **性质**：计划内的后续阶段，非缺陷。

### 4.4 已知且**承认**的技术债

| 项 | 位置 | 说明 |
|---|---|---|
| 双请求组装路径 | `packages/ai/src/provider.ts:218-230` | `createProvider`（测试/遗留）与 `invokeRouted`（生产）并存，请求组装与失败分类有重复。**已被文档记录**，不是暗坑 |
| 密钥库仅 macOS | `apps/node-host/src/keychain-secret-store.ts` | 其他平台**明确报错**而不是伪造一个不安全的存储 —— 这是对的选择 |
| 移动端无 AI | `apps/mobile/src` | 桌面端经 webview（ADR-0037） |
| 只读预设 UI 指导缺失 | `ai-architecture.md:1026` | 按工具授权已有；预设没有 |
| 调用审计/日志**故意**不做 | `ai-architecture.md:1027` | |
| AI-3（规划）推迟、AI-4（复盘）未开始 | `ai-strategy.md` | |
| `describeRouteIntent` / `previewDisclosure` / `EGRESS_ORDER_NOTE` 近乎零生产调用者 | `provider.ts:429-450` | 按其自身注释，**是刻意的保留** |

### 4.5 TODO / FIXME 标记：**零**

对 `packages/ai/src`、`packages/local-api/src`、`packages/app-host/src/ai-*.ts` 搜
`TODO|FIXME|XXX|HACK|unimplemented|未实现|not implemented` ⇒ **0 命中**。

未完成状态**全部**声明在文档注释与 ADR 里，而不是散落的 TODO。
（i18n `zh-CN.ts:1225` 把受阻的托管模式如实写成"仍在开发中，暂时无法启用"。）

---

## 5. 测试覆盖状态

| 套件 | 规模（`it(`/`test(` 计数） |
|---|---|
| `packages/ai/tests`（5 文件） | ≈ **153**（`egress` 49、`routing` 53、`health-store` 31、`tool-wire` 11、`disclosure-shape` 9） |
| `packages/local-api/tests`（3 文件） | ≈ **81**（`local-api` 37、`server` 29、`mcp` 15） |
| `packages/app-host/tests`（AI 专用） | ≈ **300+**（`ai-capture` 59、`ai-breakdown` 56、`ai-duration` 49、`ai-prioritize` 45、`local-api-host` 41、`ai-feedback-actions` 17、`ai-tool-call` 14、`ai-tool-run` 11、`ai-tool-selection` 11、`ai-cause` 表驱动） |
| `packages/domain/tests` | `capture`/`memory`/`preferences`/`preference-hints`/`preference-corrections`/`ai-feedback`/`recall` |
| `apps/web/tests` | 19 个 AI/记忆/偏好套件（`ai-settings`、`ai-tool-run`、`ai-disclosure-parity`、`ai-failure-locale`、`memory-panel`、`journey-ai-memory.integration`…），web 全部 ≈ 767 |
| E2E | `e2e/tests/ai-{breakdown,capture,duration,prioritize,row-layout,unavailable}.spec.ts`，经 `check:ai-e2e-preflight` + `check:ai-e2e` 接入 |

**已知红套件**：未发现。`BLOCKED.md` 为"无"；`PROGRESS.md` 基线是"全绿"（`pnpm check` exit 0）。
⚠️ 本次审计**没有实际运行测试**（只读范围与耗时限制）—— 上表是**静态计数**，
"未发现红套件"是"文档与标记里没有"，**不等于"我已复跑验证过"**。

---

## 6. AI 相关门禁总表（都挂在 `pnpm check` 上，`package.json:43`）

| 门禁 | 脚本 | 钉住什么 |
|---|---|---|
| `check:ai-coverage` | `scripts/check-ai-coverage.mjs` | 每个声明的 AI 功能**必须可达至渲染级**；并**运行时**断言托管模式仍被 `retention-undecided` 挡住 |
| `check:ai-tools` | `scripts/check-ai-tools.mjs` | 写入只在 `confirmAiToolProposal` 出现**恰好一次**；AI 代码不得有 op 构建 / fetch / op-log import |
| `check:ai-quota` | `scripts/check-ai-quota-consistency.mjs` | SSOT 与 5 个声明点全部 = 300；未计量前不允许 `enforced` |
| `check:ai-e2e` | `scripts/check-ai-e2e*.mjs` | 真浏览器跑 AI 面板 |
| `check:layering` | `scripts/check-layering.mjs` | 应用内无厂商 AI SDK / 无模型端点 / loopback 分类 |

> 这套门禁的密度是本仓库 AI 部分最值得保留的资产：**"没做完"和"做坏了"都能被机器区分出来。**

---

## 7. 给下一个人的三句话

1. **不要"补完"云端 AI。** 它被挡住是决策，不是进度。要开它，先做 ADR-0013 §4 的 5 项 + 计量，顺序见 ADR-0023 §5。
2. **要动手就动 §4.1（受保护条目）** —— 那是唯一一处"文档承诺了、代码有实现、但用户无法触达"的缺口，而它恰好压在入站 AI 的隐私承诺上。
3. **§4.2 是文档债**：`ai-breakdown` 发原文这件事，让 `ai-strategy.md` 的措辞与代码对不上。改哪边都行，但别让它继续挂着。
