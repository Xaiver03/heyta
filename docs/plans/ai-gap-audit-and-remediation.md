# AI 功能实现度审计与整改方案

> 状态：🟡 **审计结论已写、整改已执行**（2026-09-27）。三个整改模块**均已并入 `main`**
> （模块 1 `06d7be3` / 模块 2 `0614475` / 模块 3 `73b13b2`），所以本文下面的**整改类**缺口
> 大部分已关闭。但**能力类**缺口仍然成立，且它们是**产品未做**、不是**文档未同步** ——
> 见下方标 ⏸ 的 AI-3 规划 / AI-4 复盘与标 🔴 的全量导出。
> 审计基线：`c667fb4`（审计时工作区有并发 agent 改动，结论以实测代码为准）
> 审计方式：**只读**。本轮未修改任何产品代码。
> 落地方式：拆成三个互不重叠的模块，分别交给三个 AI 执行。提示词见
> [`ai-remediation-module-1-engine.md`](ai-remediation-module-1-engine.md)、
> [`ai-remediation-module-2-journey.md`](ai-remediation-module-2-journey.md)、
> [`ai-remediation-module-3-memory-moat.md`](ai-remediation-module-3-memory-moat.md)。

---

## 0. 这份文档是什么

它回答四个问题，每个结论**都带可复核的证据**（`文件:行号` 或命令）：

1. 规划好的 AI 功能**是否都实现了**？
2. 代码质量、测试覆盖、产品融合性**有没有问题**？
3. 存不存在**孤立路由/孤立配置/死代码**？
4. 有没有**没有闭环的用户旅程**？

它**不是**：新 ADR、不是承诺排期、不是替代 [`ai-strategy.md`](ai-strategy.md) 的进度数字事实源。
进度数字的唯一事实源仍是 `ai-strategy.md` 的 §7；本文件只记录**这一次审计**的结论与整改方案。

**证据口径**：所有行号来自基线 `c667fb4`；所有测试数字来自本轮实测（命令见 §14）。
行号会随改动漂移，**以语义描述为准、行号为辅**。

---

## 1. 结论摘要

**否 —— AI 规划没有全部实现。**

| 层面 | 结论 |
|---|---|
| 核心四功能（捕获/拆解/优先级/估时） | ✅ 端到端可达，三层测试齐全，有门禁钉住 |
| AI-0 基座（路由/回退/披露/能力/熔断/密钥端口） | ✅ 已落地 |
| 偏好记忆层 M1–M6 | ✅ 已落地 |
| 本机 API / MCP（HTTP + stdio） | ✅ 已落地 |
| **记忆事实层 / 专注落差（护城河）** | 🔴 实现+单测完备，**零生产调用点**，用户不可见 |
| **AI-3 规划 / AI-4 复盘** | ⏸ 未开工 |
| **托管云 AI / MaaS** | 🔴 刻意挡住，且生产路径不可达 |
| **AI 订阅两档（ADR-0020）** | 🔴 未落地（ADR 状态本身还是「待确认」） |
| **移动端 AI** | 🔴 零入口 |
| **全量导出（JSON/CSV/ICS）** | 🔴 未实现 |
| 孤立/死代码 | ⚠️ 12 项零调用点或不可达分支（§5） |
| 缺陷 | ⚠️ 1 个真实 i18n 泄漏 + 4 个可解释性缺口（§6） |
| 不闭环旅程 | ⚠️ 9 条（§7） |

> 一句话：**"能用的已经很好，但护城河还埋在土里"** —— 最有产品价值的那一层
> （记忆事实层 → 专注落差）是实现了、测了、但没人调用的状态，
> 正好是本仓库反复栽的那个坑（见 AGENTS.md 里记录的同类 bug 类）。

### ⚠️ 复核实况（2026-09-27 文档同步时逐条重查）

上表是**审计当日（基线 `c667fb4`）的快照**，保留不改。但其中若干行**今天已经变了**，
别照旧清单去"发现"一次已经修好的问题：

| 上表原结论 | 今天的实况 | 证据 |
|---|---|---|
| `:43` 记忆事实层 / 专注落差 **零生产调用点** | ✅ **已接线**：`computeFocusGaps()` 由 `apps/web/src/App.tsx:261` 读真实 op 窗口后调用，`MemoryPanel` 展示落差 | merge `73b13b2` |
| `:46` AI 订阅两档**未落地**（ADR-0020 还是「待确认」） | ⚠️ **一半变了**：ADR-0020 / ADR-0021 **都已接受**，`server/src/billing/price-book.ts:83-84` 已有 `hosted-monthly` + `hosted-ai-monthly` 两个 SKU、收银台路由已通。**但交付半段与云端 AI 端点仍未接**，所以"这一档买不到"依然为真 | `price-book.ts:84,117`；[ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md) |
| `:46` 后半句 `price-book.ts` **只有单一 `annual`**；`check-pricing-consistency.mjs` 强制"恰好一个 `priceId`" | ❌ **已过时** —— 现在是**月付**、**两个**付费 SKU，门禁也早已改成按币种/按档校验 | `price-book.ts:83-84` |
| `:171` `describeRouteIntent()` **零测试** | ❌ **已过时** —— `packages/ai/tests/routing.spec.ts` 有覆盖 | 同上 |
| `:44` / `:47` / `:48` AI-3·AI-4 未开工 / 移动端零 AI 入口 / 全量导出未实现 | ✅ **这三条依然成立**，是**产品未做**、不是文档没同步 | 见 [roadmap](roadmap.md) §1.1 与 §5 |

> 🔴 上表 `:43` 那条如今被修好，**正是这份审计的价值所在** —— 它点名的"零生产调用点"
> 形状确实是最贵的坑。但**审计结论本身也会过期**：一份只写"发现"、不标"何时复核"的审计，
> 下次会让人重做一遍。所以本节按"原结论 / 今日实况 / 证据"三段式记，而不是覆盖原文。

---

## 2. 审计方法

四路并行只读调查 + 交叉复核：

| 路线 | 覆盖 |
|---|---|
| A. 规划对账 | 通读全部 AI 文档/ADR，逐项标注"已落地/未落地/刻意不做"，实跑覆盖门禁 |
| B. 接线与孤立扫描 | 对每个功能建"实现→导出→路由→偏好→界面→写库→读回"矩阵，grep 零调用点 |
| C. 覆盖与错误路径 | 枚举所有失败原因码 × {测试, UI 文案}，查断言质量与三层覆盖 |
| D. 产品融合 | 旅程闭环、web/mobile 一致性、设置面板完整性、权益/付费、i18n |

**交叉复核规则**：任何"零调用点"结论都用 `grep -rn` 独立复跑一遍，排除
`/dist/`、`.map`、测试文件；任何"未实现"结论都在 `apps/` 与 `packages/` 两侧各查一次。

**已知的方法限制（如实记录）**：

- 审计期间工作区有**并发 agent 改动**，个别文件可能在核对与书写之间变化。
- e2e 未逐条人工复核 Playwright 断言，只确认了它**在 `pnpm check` 内通过**且
  自述覆盖范围。
- 移动端只做了静态 grep，未在真机/模拟器上验证"没有 AI 入口"。

---

## 3. 基线数字（本轮实测）

| 范围 | 文件 | 通过 | 跳过 |
|---|---|---|---|
| `@heyta/ai` | 4 | 144 | 0 |
| `@heyta/app-host` | 16 | 399 | 0 |
| `@heyta/domain` | 14 | 395 | 0 |
| `@heyta/local-api` | 3 | 79 | 0 |
| `@heyta/web` | 25（23 通过 + 2 跳过） | 479 | 12 |
| e2e（Playwright，随 `pnpm check`） | 13 | 13 | 0 |

- `pnpm check` → **exit 0**
- `node scripts/check-ai-coverage.mjs` → **exit 0**，「界面不可达豁免：（无）」
- `node scripts/check-ui-language.mjs` → **exit 0**
- `web.ai.*` 词条：zh = 218 / en = 218（**对齐**）
- `common.ai.*` 词条：**0**（规划要求 web 与移动端共用，实际未采用该命名空间）

> 这三个数字是三个模块的**回归基线**：整改后只允许 `通过数 ≥ 基线`、
> `跳过数 ≤ 基线`、`pnpm check` 仍 exit 0。

---

## 4. 规划 vs 落地总账

### 4.1 已落地（有生产调用点，且界面可达）

| 能力 | 证据 |
|---|---|
| AI-0 基座：目的地推导、出境闸门、回退不跨隐私边界、能力显式声明、熔断、密钥端口 | `packages/ai/src/{supply,egress,provider,routing,health-store,presets}.ts` |
| AI-1 捕获（规则内核 + 模型兜底**并存**） | `packages/domain/src/capture.ts`；`apps/web/src/features/capture/CaptureComposer.tsx` 调 `AiCapture` |
| AI-2 拆解（写进 note 的 Markdown checklist） | `packages/app-host/src/ai-breakdown.ts`；`apps/web/src/features/ai/AiBreakdown.tsx` |
| AI-2 优先级建议 | `packages/app-host/src/ai-prioritize.ts`；`AiPrioritize.tsx` |
| AI-2 估时 | `packages/app-host/src/ai-duration.ts`；`AiDuration.tsx`（**历史维度未接线**，见 §7-7） |
| AI-5 本机 API / MCP | `packages/local-api/src/*`；`apps/node-host/src/{mcp-stdio-server,cli-mcp,cli-local-api}.ts` |
| 偏好记忆层 M1–M6（可见/依据/遗忘/恢复） | `packages/domain/src/preferences.ts`；`apps/web/src/features/settings/MemoryPanel.tsx` |
| 熔断状态落盘（读取 → 回写） | 四个 AI 组件 `onHealth`；`App.tsx` 写回 `aiSettings.health` |
| 出境授权与目的地绑定（上一轮修复） | `apps/web/src/features/settings/AiSettings.tsx` 的 `updateRouting` 调 `retainValidConsents` |

捕获的设计值得单独指出：**规则内核与模型是并存的，不是替换**
（`CaptureComposer.tsx` 的注释说明：规则对「明天」「下周三」算得准，
而实测模型对同类句子算日期错过约 4.5 个月）。这是四个功能里融合得最好的一条。

### 4.2 未落地

| 项 | 卡在哪 | 现状证据 |
|---|---|---|
| **记忆事实层 / 专注落差** | 零生产调用点 | `packages/domain/src/memory.ts` 的 `computeTaskMemory` / `computeFocusGaps` / `describeFocusGaps` 仅被 barrel 转出 + `memory.spec.ts` 引用 |
| **历史召回对照实验** `recall.ts` | 零生产调用点 | `packages/domain/src/index.ts` 转出，无生产消费者 |
| **AI-3 规划** | 有意推迟（调研无留存数据） | `ai-capability-branches.md` 的 AI-3 一节；`packages/app-host/src` 无模块 |
| **AI-4 复盘** | 受限分支，未开工 | 同上；无模块 |
| **托管云 AI / MaaS** | 五件前置一件未完成 | `packages/ai/src/supply.ts` 的 `assertEnableable` 抛 `retention-undecided` |
| **AI 订阅两档** | ADR-0020「待确认」 | `server/src/billing/price-book.ts` 只有单一 `annual`；`scripts/check-pricing-consistency.mjs` 仍强制**恰好一个** `priceId` |
| **移动端 AI** | 无入口 | `apps/mobile/src` 无 `@heyta/ai` 引用；`TabBar` 只有 tasks/calendar/focus/profile |
| **全量导出（JSON/CSV/ICS）** | 未实现 | `apps/web/src`、`packages/app-host/src`、`packages/domain/src` 全仓无 export/ICS/CSV 实现 |
| **"发特征不发原文"** | 未落地 | `packages/app-host/src/ai-breakdown.ts` 仍把 `title` 与 `note` 原文拼进 `user` |
| **其他平台钥匙串** | 只有 macOS | `apps/node-host/src/keychain-secret-store.ts` 自述 |
| **只读模式 UI 引导** | `grants` 能表达，但无引导 | 架构参考文档 §15.2 自述（注：逐工具开关**已有** UI，缺的是"只读预设"） |

### 4.3 刻意不做（不是缺口，写在这里避免下一轮重复审计）

端侧模型推理（三条独立理由，见 `ai-strategy.md`）、自动重排优先级、
"AI 搜索自己的任务"当卖点、把 AI 结果灌进日历主视图、调用审计、
`check:layering` 第 9 条（现在加会是规定一个不存在的违规）。

---

## 5. 孤立路由 / 孤立配置 / 死代码

### 5.1 先回答字面问题：**UI 路由没有孤立**

- `ViewKey = 'tasks' | 'quadrant' | 'habits' | 'focus' | 'timeline' | 'settings'`
  （`apps/web/src/App.tsx`）—— 六个视图**全部**在 header 的 `role="tablist"`
  里有点击入口，且列表用 `as const satisfies readonly { key: ViewKey; ... }[]`
  做了**类型穷尽**：未来新增视图不补入口会编译失败。
- 每个 `view === 'x'` 分支都有对应的 `setView` 入口，无「渲染了但点不到」。

### 5.2 AI 功能路由也没有孤立

`AiFeature` 四个取值（capture / breakdown / prioritize / duration-estimate）
的 `routes` 键都由对应组件经 `resolveRoute` 消费；
`scripts/check-ai-coverage.mjs` 的界面可达性检查**零豁免**通过。

### 5.3 零生产调用点符号（按"该不该清"分组）

| 符号 | 位置 | 备注 |
|---|---|---|
| `createProvider()` | `packages/ai/src/provider.ts` | 生产零调用；仅 `index.ts` 导出 + 3 个 spec。**整套 `AiProvider.invoke` 已被 `invokeRouted` 取代** |
| `assertEnableable()` | `packages/ai/src/supply.ts` | 只被 `createProvider` 调用（两处）→ `managed` 闸门**生产不可达** |
| `previewDisclosure()` / `EGRESS_ORDER_NOTE` | `packages/ai/src/provider.ts` | 随 `createProvider` 一起死 |
| `describeRouteIntent()` | `packages/ai/src/routing.ts` | 零调用点、**零测试** |
| `findPreset()` / `presetDestinations()` | `packages/ai/src/presets.ts` | UI 直接用 `AI_ENDPOINT_PRESETS` |
| `describeEndpointHealth()` | `packages/ai/src/health-store.ts` | 壳改用 `endpointHealthDisclosure()` 取词条（正确做法） |
| `removeDurationFromNote()` | `packages/app-host/src/duration-note.ts` | 只有测试 |
| `relevantPreferenceIds()` | `packages/domain/src/preference-hints.ts` | 只有测试 |
| `computeTaskMemory` / `computeFocusGaps` / `describeFocusGaps` | `packages/domain/src/memory.ts` | **护城河本体**，见 §7-3 |
| `recall.ts` 全部导出 | `packages/domain/src/recall.ts` | 向量库实验的对照组，可能本就该只活在测试里 |

> ⚠️ `createProvider` 的处置**不能一刀切删**：`apps/web/tests/ai-failure-copy.spec.tsx`
> 用它来遍历 `AiFailureReason`，`packages/ai/tests/egress.spec.ts` 大量依赖它。
> 且 `ai-architecture.md` 的 §4 仍把它描述成"供应商端口/工厂即校验"——
> **文档说的执行点与生产的执行点不一致**。这本身就是需要消除的漂移。

### 5.4 「有读无写」的配置字段（比死代码更危险：界面能看见效果却没法产生效果）

| 字段 | 读 | 写 |
|---|---|---|
| `AiEndpointConfig.disabled` | `routing.ts` 的候选过滤会**真的跳过**它 | 全仓无生产写入（UI 无"停用端点"开关，CLI 也不写） |
| `AiRouteTarget.model` | `routing.ts` 用 `candidate.model` 覆盖 | 全仓无生产写入（UI 每功能只选端点，不选模型） |

这类字段的坏处是**沉默的**：用户/后续 agent 会以为"停用端点"是可配置能力，
实际只能靠删端点。要么补生产者，要么删字段——**不能继续留着**。

### 5.5 不可达分支

- **`heyta-cloud` 目的地整条路径不可达**：`supply.ts` 对 `mode:'managed'`
  返回 `undefined` 并抛 `retention-undecided`；而生产调用 `classifyDestination`
  的地方**全部传 `mode:'own'`**（`routing.ts` 的 URL 校验、`AiSettings.tsx` 两处）。
  于是 `EgressDestination='heyta-cloud'`、`RetentionDisclosure='undecided'`、
  `destinationDisclosure.kind='heyta-cloud-managed'` 在生产**永不产生**。
  这是 ADR-0006/ADR-0013 有意为之，但应当**显式登记为"不可达分支"**，而不是留在暗处。
- **`EgressDecision.reason='consent-required'`** 与
  `supply.ts` 的 `AiConfigError.reason` 里的 `'consent-required'`：
  `egress.ts` 自己的注释说明"本地目的地不需要授权，这个 reason 不会出现"，
  即**死联合成员**。
- **`vision` / `tool_calling` 能力**：词表里有，但
  `DEFAULT_FEATURE_CAPABILITIES` 四个功能一个都不要求 —— 声明它们
  **不改变任何过滤结果**（过滤只查 `structured_output` / `long_context`）。

### 5.6 半断链（写了但没人读）

Web 设置页的"本机 API"配置写进 **浏览器 localStorage**，而真正运行的
MCP 服务读的是 **`~/.heyta/local-api.json`**，两边不同步。
界面已经**诚实说明**了这件事，所以不算欺骗，但它确实是一段"配了不生效"的链路。

---

## 6. 缺陷清单

### 6.1 🔴 P0：英文界面泄中文（真实缺陷）

- **症状**：`apps/web/src/features/ai/AiDuration.tsx` 的估时依据列表直接渲染
  `{hint.summary}`。
- **为什么是缺陷**：`packages/domain/src/preference-hints.ts` 的 `PreferenceHint.summary`
  注释明写"**中文投影**"，同类型的 `facts` 注释明写"壳**必须**用这个取自己的词条，
  **不要渲染 `summary`** —— 那是领域层拼好的中文，英文界面会露中文"。
  `MemoryPanel.tsx` 做对了（用 `preferenceEvidenceCopy(preference.evidenceFacts, t)`），
  `AiDuration` 漏了。
- **为什么门禁没抓到**：`check-ui-language.mjs` 扫的是**字面量**，而这里渲染的是变量。
- **为什么测试没抓到**：`apps/web/tests/ai-duration.spec.tsx` 里带 `preferenceSet`
  的用例全部走默认（中文）渲染，**没有"英文 + 偏好"的组合**。
- **修法**：照 `MemoryPanel` 的做法，从 `hint.facts` 经 `preferenceEvidenceCopy` 取词条；
  并补一条"英文界面 + 有偏好"的断言。**这属于模块 2**。

### 6.2 🟡 P1：界面说不出"为什么被排除"

`RouteResolution.excluded` 已经被导出（含封闭词表 `CandidateExclusionReason`），
但四个 AI 组件只取 `resolution.candidates[0]`，**从不读 `excluded`**。
后果：用户看到的是聚合句"没有可用端点"，而真实原因可能是
`remote-not-allowed` / `capability-missing` / `circuit-open` / `endpoint-disabled`
中的任意一个 —— 处理方式完全不同。

### 6.3 🟡 P1：`endpoint-disabled` 没有专属文案

`packages/ai/src/routing.ts` 的 `explainNoCandidate` 对
`remote-not-allowed` / `circuit-open` / `endpoint-url-rejected` /
`capability-missing` / `endpoint-missing` 都写了句子，**唯独漏了 `endpoint-disabled`**，
落到兜底句「没有可用的端点。检查设置里的端点与路由。」——把用户指向两个没问题的地方。

### 6.4 🟡 P1：未钉住的原因码分支

| 分支 | 现状 | 缺什么 |
|---|---|---|
| `validateEndpointUrl` 的 `unparseable` / `bad-scheme` | 只断言 `ok === false` | 未断言 `reason` |
| `AiConfigError` 的 `endpoint-required` / `endpoint-invalid` | 只断言抛 `AiConfigError` | 未断言 `reason` |
| `validateLocalApiConfig` 的 `bad-port` | 只断言 `ok === false` | 未断言 `reason` |
| `EgressDecision` 的 `consent-required` | 无测试 | 它是死成员（§5.5）——要么删，要么补"永不产生"的说明测试 |

### 6.5 🟡 P1：`cause` 字段没有直接断言

`packages/app-host` 的四个 `ai-*.spec.ts` 里 `outcome.cause` **出现 0 次**。
`cause` 是把 `packages/ai` 的具体原因码带给界面词条的唯一通道，
却只被间接覆盖（web 层某条文案正好包含"授权"）。
一旦某次重构把 `cause` 丢掉，app-host 层不会有任何测试变红。

### 6.6 ⚪ P2：同一件事两套实现

`createProvider`（`provider.ts`）与 `invokeRouted`（`routing.ts`）**各自组装一次请求**。
它们共享 `authorizeEgress`，所以**隐私闸门本身没有分裂**；但"请求怎么拼、
失败怎么分类"是两份，属于长期漂移风险。处置见模块 1。

---

## 7. 没有闭环的用户旅程

1. **远端未授权**：失败文案只说「该功能需要你先授权数据出境」（`zh-CN.ts`
   的 `web.ai.failure.cause.egressNotAuthorized`），**没有直达授权按钮**；
   授权入口只在设置页。用户知道该做什么，但要自己找路。
2. **"没有可用端点"把人指错方向**：见 §6.2/§6.3。此态**不渲染发送按钮**，
   出口只有"取消 → 自己去设置页"。
3. **护城河不可见**：`computeFocusGaps` 算得出"你说重要、但没投入时间"的落差，
   而 `MemoryPanel` 只展示偏好，**不展示事实层**。这是最有产品价值的一条，也是最彻底的一条断链。
4. **托管云 AI 付费旅程完全不存在**：无入口、无计量、无配额、无 entitlement；
   ADR-0020 列的两档（ai / ai-pro）在代码里零命中。
5. **AI-3 / AI-4 旅程不存在**（推迟/未开工）。
6. **移动端 AI 旅程不存在**：`apps/mobile/src` 零 AI 入口，而规划文档
   （`i18n-multilingual.md`、`ai-capability-branches.md`）确实提到过 web/移动端共用词条、
   移动端落地时扩展隐私 UI 扫描、RN 端侧 spike。
7. **"按历史估时"走不到**：`AiDuration` 支持 `history`，但 `App.tsx` **刻意不传**
   （注释：web 壳目前没有暴露专注历史）。功能降级可用，但这条子旅程是断的。
8. **"已应用"反馈刷新即丢**：成功标记只在组件内存里，刷新后消失（数据不丢，只是没有反馈）。
9. **真实浏览器的授权链路没有 e2e 覆盖**：`e2e/tests/ai-unavailable.spec.ts`
   自己写明"假端点必须在回环地址，而回环被判为数据不出设备，根本不需要授权，
   所以 `consent-*` 链路在本套件里验不到"。这是**如实申报的缺口**，不是隐瞒。

---

## 8. 覆盖性审计

### 8.1 三层覆盖矩阵（四个功能）

| 功能 | app-host 集成 | web 组件 | e2e |
|---|---|---|---|
| capture | 59 | 46 | 1 |
| breakdown | 55 | 54 | 1 |
| prioritize | 45 | 27 | 1 |
| duration-estimate | 49 | 35 | 2 |
| （不可用方向） | — | — | 4（`ai-unavailable`，断言假端点计数为 0） |

`packages/ai` 层是**功能无关的泛化路由测试**，没有"每个功能一套单测"——
这是合理的（路由不知道 feature 的语义），但意味着**"某个功能漏声明能力"这类错
只能靠 app-host/web 层抓**。

### 8.2 断言质量（范围内）

- **无** `it.only` / `test.only` / `it.todo` / `|| true`
- **无** mock 被测层（app-host 用注入 `fetchImpl` 作为 HTTP 边界，属正确做法）
- 条件断言普遍先 `expect(outcome.ok).toBe(false)` 再断言细节
- 唯一的 skip：`apps/web/tests/journey-ai-memory.integration.spec.tsx` 的
  `describe.skipIf(CONFIG === undefined)` —— **默认整文件跳过**（需要真实端点凭据）

### 8.3 覆盖空洞

- **没有 `packages/ai → app-host → web` 的单进程全链旅程**；
  唯一自称"真实用户旅程"的文件默认被跳过，且只覆盖 breakdown。
- 记忆层的**遗忘/恢复**只有单测，无 e2e。
- **AI 订阅/权益零实现、零测试**（现有 entitlement 测试属于同步权益，与 AI 无关）。
- 见 §6.4 的四个未钉原因码。

---

## 9. 产品融合性审计

### 9.1 设置面板：覆盖完整

AI 设置页已包含：三道闸（总开关 / 允许远程 / 逐功能出境授权）、能力声明与
"缺口一键补"、端点健康与熔断、密钥策略、本机 API（含**"配在文件里才生效"**的诚实提示）、
记忆开关与可见/遗忘/恢复。这是一块完成度很高的界面。

### 9.2 i18n

- `web.ai.*` zh/en **逐条对齐**；`check-ui-language` 通过。
  ⚠️ 写这份审计时是各 218 条，此后还在长（现役已 230 上下）。**不在这里钉死数字** ——
  要数就直接跑 `pnpm check:ui-language`，它的输出才是权威；本文只保证"两边对齐"这个不变量。
- 规划里要求披露类文案进**共享命名空间** `common.ai.*`（web 与移动端共用一份），
  实际是 `web.ai.*`，`common.ai.*` **零条**。在移动端接入之前，这不是缺陷；
  接入时会需要一次迁移。
- 除 §6.1 的泄漏外，失败技术详情里保留跨包中文 message 是**有意设计**
  （诊断数据，不参与本地化）。

### 9.3 权益/付费

`entitlement.ts` 只服务同步（探 `/api/sync/status`），唯一消费者是订阅 store；
`apps/web/src/features/ai` 与 `packages/ai` **零 entitlement 引用** ——
即 **AI 既无权益门禁也无计量**。这与 ADR-0020「待确认」一致，但意味着
"AI 付费"这条产品故事目前没有任何代码承接。

### 9.4 落地页与 ADR 方向相反（需要产品决策，不在三个模块内）

`zh-CN.ts` 的落地页文案仍写"只有一个档""不是解锁功能"，而
ADR-0013/ADR-0020 的方向是引入 AI 订阅档位。ADR-0020 自己也承认要改故事。
**这是文案/定价决策，不是代码修复**，列入 §12。

---

## 10. 文档漂移清单（会误导下一个 agent）

| 文档 | 写的 | 实际 |
|---|---|---|
| `roadmap.md` | AI-0/1/2/5 标「规划中」 | 已落地 |
| `ai-strategy.md` 的 §7.1 与 §8 | §7.1 把"记忆/特征层"列入已落地，§8 又承认 `memory.ts` 零调用 | 自相矛盾；事实层**未接线** |
| `ai-capability-branches.md` 头部 | ADR-0005「待确认」 | ADR-0005 已接受 |
| `ai-capability-branches.md` 的 §9.28 | MCP 传输层只有 HTTP | stdio 已落地 |
| `ai-memory-system.md` 文档头 | 「待实施」 | 正文记录 M1–M6 全部完成 |
| `ai-handoff.md` 的 §3.4 | `retainValidConsents` 零调用点 | **已修复**（`AiSettings.tsx` 的 `updateRouting` 已接线） |
| `ai-architecture.md` 的 §15.1 | 熔断落盘"是否接到壳的持久化未核实" | 已核实：四个组件 `onHealth` + `App.tsx` 回写 |
| `ai-architecture.md` 的 §4 | 把 `createProvider` 描述成供应商端口 | 生产实际走 `invokeRouted` |

> 这些是**漂移**，不是决策冲突；修正属于文档整理，不需要新 ADR。
> 但**累计 8 处**说明："改 AI 代码时必须回头改文档"这件事目前没有机制保障。

---

## 11. 整改方案：三模块划分

### 11.1 切分原则

1. **按文件所有权切，不按话题切** —— 三个 AI 可能同时改一个工作区，
   话题重叠必然撞车。
2. **每个模块都能独立验证**：有自己的测试套件 + 自己的验收命令。
3. **上游优先**：模块 1（引擎语义）先做，因为模块 2 的解释性依赖它给出的原因码语义；
   模块 3（记忆）与另两个无代码依赖。

### 11.2 文件所有权矩阵

| 文件/目录 | 模块 1 | 模块 2 | 模块 3 |
|---|---|---|---|
| `packages/ai/src/**`、`packages/ai/tests/**` | ✅ 独占 | 只读 | 只读 |
| `packages/local-api/src/**`、`packages/local-api/tests/**` | ✅ 独占 | 只读 | 只读 |
| `packages/app-host/src/**`、`packages/app-host/tests/**` | ✅ 独占 | 只读 | 只读 |
| `apps/web/src/features/ai/**` | 只读 | ✅ 独占 | 只读 |
| `apps/web/src/features/settings/AiSettings.tsx`、`aiStore.ts` | 只读 | ✅ 独占 | 只读 |
| `apps/web/tests/ai-*.spec.tsx`、`apps/web/tests/ai-settings.spec.tsx` | 只读 | ✅ 独占 | 只读 |
| `e2e/tests/ai-*.spec.ts`、`e2e/tests/helpers.ts` | 只读 | ✅ 独占 | 只读 |
| `apps/web/src/App.tsx` | 只读 | ✅ 独占（旅程接线） | ⚠️ **需申请** |
| `packages/i18n/src/locales/{zh-CN,en}.ts` | 只读 | ✅ 主 owner | ⚠️ 追加词条 |
| `packages/domain/src/memory.ts`、`preference-hints.ts`、`recall.ts` | 只读 | 只读 | ✅ 独占 |
| `packages/domain/tests/memory.spec.ts` | 只读 | 只读 | ✅ 独占 |
| `apps/web/src/features/settings/MemoryPanel.tsx` | 只读 | 只读 | ✅ 独占 |
| `apps/web/tests/memory-panel.spec.tsx` | 只读 | 只读 | ✅ 独占 |

**只有两个文件是真正共享的**：`App.tsx` 与两个 locale 文件。

### 11.3 共享文件协议（必须遵守）

| 文件 | 规则 |
|---|---|
| `App.tsx` | **模块 2 拥有**。模块 3 需要把 `focusGaps` 传进 `MemoryPanel` 时：先在**自己的分支**上改，合并时以模块 2 为基；或与模块 2 协商由模块 2 加 3 行 props。**不许两个模块并行改同一分支。** |
| `packages/i18n/src/locales/*.ts` | **追加式**：只允许在文件内追加新 key，不许移动/重排现有 key。模块 2 用 `web.ai.*` 前缀，模块 3 用 `web.memory.*` 前缀。合并冲突时**两边都保留**。 |
| 其他 | 各模块只在白名单内改动。跨模块需求写进交付报告的「需要别人做的事」一节，**不要自己动手**。 |

**推荐执行顺序**（也允许三路并行，但合并按此顺序 rebase）：**模块 1 → 模块 2 → 模块 3**。

### 11.3.1 跨模块契约（提前定死，避免两个模块互相等）

| 契约 | 决定 |
|---|---|
| `AiEndpointConfig.disabled`（有读无写） | **字段保留**（它是真实的"停用端点"能力，删掉是能力倒退）。模块 1 只加准确注释并登记；**生产者由模块 2 补** —— 在设置页加"停用/启用该端点"开关。 |
| `AiRouteTarget.model`（有读无写） | **字段保留**，模块 1 加注释并登记。生产者**推迟**：是否允许"逐功能选模型"是产品决策（见 §12），不属于本轮三个模块。 |
| `endpoint-disabled` 文案 | 模块 1 改**引擎层兜底句**（`packages/ai` 内的诊断文本）；模块 2 改**界面层词条**（`web.ai.*`）。两层各自独立，互不阻塞。 |
| `resolution.excluded` 的界面消费 | **只由模块 2 做**。它已由 `packages/ai` 导出，模块 2 **不需要**改 `packages/ai`。 |

### 11.4 模块 1 —— 引擎层正确性与孤立分支治理

- **目标**：把 `packages/ai` / `packages/local-api` / `packages/app-host` 的
  "有代码路径没测试、有符号没人调、有原因码没文案"清干净，且**不改变任何对外行为语义**
  （除 `endpoint-disabled` 文案变具体）。
- **交付**：见 [`ai-remediation-module-1-engine.md`](ai-remediation-module-1-engine.md)。
- **验收**：`pnpm --filter @heyta/ai test` ≥ 144、`@heyta/local-api` ≥ 79、
  `@heyta/app-host` ≥ 399 全绿；`pnpm check` exit 0；每个死代码项有明确处置与理由。

### 11.5 模块 2 —— 用户旅程闭环与"说真话"

- **目标**：让用户在**界面内**知道"为什么现在不能用、下一步点哪里"，
  并修掉英文界面泄中文。
- **交付**：见 [`ai-remediation-module-2-journey.md`](ai-remediation-module-2-journey.md)。
- **验收**：`@heyta/web` ≥ 479 通过、≤ 12 跳过；e2e 13 条不回归；
  `pnpm check` exit 0；新增一条"英文 + 有偏好 → 不出现 CJK"的断言。

### 11.6 模块 3 —— 记忆护城河接线

- **目标**：把已经算得出来的"说的 vs 做的"落差**接到用户眼前**，
  且**不渲染领域层拼好的中文**。
- **交付**：见 [`ai-remediation-module-3-memory-moat.md`](ai-remediation-module-3-memory-moat.md)。
- **验收**：`@heyta/domain` ≥ 395 全绿；`@heyta/web` 通过数 ≥ 479；
  新面板在 `memoryEnabled = false` 时**不展示任何推断**；
  `pnpm check` exit 0。

### 11.7 验证矩阵

| 命令 | 模块 1 | 模块 2 | 模块 3 |
|---|---|---|---|
| `pnpm --filter @heyta/ai test` | ✅ 必跑 | — | — |
| `pnpm --filter @heyta/local-api test` | ✅ 必跑 | — | — |
| `pnpm --filter @heyta/app-host test` | ✅ 必跑 | — | — |
| `pnpm --filter @heyta/domain test` | — | — | ✅ 必跑 |
| `pnpm --filter @heyta/web test` | ✅ 必跑 | ✅ 必跑 | ✅ 必跑 |
| `pnpm check` | ✅ 必跑 | ✅ 必跑 | ✅ 必跑 |
| `node scripts/check-ai-coverage.mjs` | ✅ 必跑 | ✅ 必跑 | ✅ 必跑 |
| `node scripts/check-ui-language.mjs` | — | ✅ 必跑 | ✅ 必跑 |
| `node research/tools/docs-link-check.mjs` | ✅（若改文档） | ✅ | ✅ |

---

## 12. 需要人决策、**不进入**三个模块的事项

这些不是"忘了做"，是"需要拍板"，写在这里避免三个 AI 自作主张：

| # | 事项 | 为什么需要人 |
|---|---|---|
| 1 | AI 订阅两档（ADR-0020）与落地页故事改写 | 定价与营销承诺，涉及法务文本；ADR 状态仍是「待确认」 |
| 2 | 托管云 AI 是否开工 | 五件前置（服务本体/保留策略/计费/Harness 边界/上云粒度）一件未完成 |
| 3 | 移动端 AI 入口 | 受限于移动端钥匙串未实现 + RN 无 WebAssembly；需要先定"移动端只做远程端点"还是"端侧" |
| 4 | AI-3 规划 / AI-4 复盘 | 计划明确推迟；AI-3 调研无留存数据 |
| 5 | 全量导出（JSON/CSV/ICS） | 属 P0 计划但非 AI；需要单独排期 |
| 6 | "发特征不发原文" | 架构文档自述"是判断，不是实测结论" |
| 7 | 只读模式的产品形态 | `grants` 能表达，但没有"只读预设"的产品定义 |
| 8 | `check:layering` 第 9 条 | 现在加会是规定一个不存在的违规 |

---

## 13. 全局防作弊与验收纪律（三个模块共同适用）

**禁止**：

- `it.skip` / `it.only` / `it.todo` / 删除已有测试 / 放宽已有断言
- `|| true`、把失败改成跳过、改门禁脚本或阈值、改验收脚本
- mock 掉被测层（HTTP 边界可以用注入 `fetchImpl`，那是**被测层之外**的边界）
- 为了让测试变绿而修改 `scripts/` 下的任何门禁
- 新增运行时依赖（需要新依赖 → 记进交付报告的阻塞项）
- 修改 ADR（`docs/adr/**` 一律只读）

**要求**：

- 每个修复都要有**红→绿**证据：先让测试红（贴出失败输出），再让实现绿。
  无法先红时，必须说明"为什么这条测不出红"。
- 测试数只能**增加**：通过数 ≥ 各自基线，跳过数 ≤ 基线。
- 提交用**显式 pathspec**（工作区有并发 agent）：
  `git add <具体文件> && git commit -m "..." -- <具体路径>`
- 新文件**先 `git add`** 再提交。
- 不确定的事写进交付报告的「未核实」一节，**不要猜着写进代码注释当结论**。

**环境陷阱**（实测）：

- `pnpm` 需要 `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"`（否则找不到 `node`）。
- 并发构建会偶发 `Cannot find module .../packages/design-system/dist/chunk-*.js`，
  这是**构建竞态**不是真失败，重跑即可。

---

## 14. 附录：证据索引

### 14.1 复核用的命令

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# 基线测试
pnpm --filter @heyta/ai test
pnpm --filter @heyta/local-api test
pnpm --filter @heyta/app-host test
pnpm --filter @heyta/domain test
pnpm --filter @heyta/web test

# 门禁
pnpm check
node scripts/check-ai-coverage.mjs
node scripts/check-ui-language.mjs
node research/tools/docs-link-check.mjs

# 零调用点复核（示例）
grep -rn "createProvider" packages apps --include="*.ts" --include="*.tsx" | grep -v "/dist/"
grep -rn "computeFocusGaps" packages apps --include="*.ts" --include="*.tsx" | grep -v "/dist/"
grep -rn "resolution.excluded\|\\.excluded" apps/web/src --include="*.tsx"

# i18n 对齐
grep -c "'web\.ai\." packages/i18n/src/locales/zh-CN.ts
grep -c "'web\.ai\." packages/i18n/src/locales/en.ts
```

### 14.2 关键证据坐标（基线 `c667fb4`）

| 结论 | 坐标 |
|---|---|
| 目的地由端点推导 | `packages/ai/src/supply.ts` 的 `classifyDestination` |
| 出境闸门唯一生产调用点 | `packages/ai/src/routing.ts` 的 `invokeRouted` |
| `managed` 闸门 | `packages/ai/src/supply.ts` 的 `assertEnableable` |
| 死联合成员 | `packages/ai/src/egress.ts` 的 `EgressDecision` 注释块 |
| `endpoint-disabled` 缺文案 | `packages/ai/src/routing.ts` 的 `explainNoCandidate` |
| 死代码清单 | §5.3 各坐标 |
| i18n 泄漏 | `apps/web/src/features/ai/AiDuration.tsx` 的估时依据列表渲染 `hint.summary` |
| 正确做法样板 | `apps/web/src/features/settings/MemoryPanel.tsx` 用 `preferenceEvidenceCopy(facts, t)` |
| 护城河 | `packages/domain/src/memory.ts` 的 `computeFocusGaps` / `describeFocusGaps` |
| 授权入口只在设置页 | `apps/web/src/features/settings/AiSettings.tsx` 的逐功能授权区 |
| e2e 授权未覆盖（自述） | `e2e/tests/ai-unavailable.spec.ts` 文件头注释 |
| 唯一天跳过 | `apps/web/tests/journey-ai-memory.integration.spec.tsx` 的 `describe.skipIf` |
| 本机 API 不同源 | `apps/web/src/features/settings/AiSettings.tsx` 的 `local-api-source-note` |

### 14.3 相关文档

- [`ai-strategy.md`](ai-strategy.md) —— 进度数字的唯一事实源
- [`ai-capability-branches.md`](ai-capability-branches.md) —— 分支定义与推迟理由
- [`ai-handoff.md`](ai-handoff.md) —— 交接清单（§3.4 已过期，本次已修）
- [`ai-memory-system.md`](ai-memory-system.md) —— 记忆层设计
- [`../reference/ai-architecture.md`](../reference/ai-architecture.md) —— 不变量清单与现状空白
- [`../adr/0020-ai-subscription-two-tiers.md`](../adr/0020-ai-subscription-two-tiers.md) —— AI 订阅两档（待确认）
