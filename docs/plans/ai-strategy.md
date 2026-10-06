# heyta AI 战略 —— 入口文档

> **这份文档是 heyta AI 的唯一入口。** 读它一份就够知道「AI 做成什么样、为什么、
> 现在在哪、下一步做什么」。要深挖再看 §9 的文档地图。
>
> 它**故意保持短**。上一轮的教训是：文档越长越没人读，而**没人读的文档会烂掉** ——
> 最后变成"计划里写着 A、代码里做着 B、没人发现"。
>
> - **状态**：持续更新（属于 `plans/`，不是不可变的 ADR）
> - **相关**：[ADR-0005](../adr/0005-ai-data-path.md)、[ADR-0006](../adr/0006-supply-modes.md)、[ADR-0010](../adr/0010-ai-config-routing.md)、[ADR-0011](../adr/0011-local-api-mcp.md)、[ADR-0013](../adr/0013-cloud-ai-and-maas.md)

---

## 0. 一句话

heyta 的 AI 不该做成「帮你写任务」—— 那个大家都在做，滴答清单也能调 GPT。
该做成「**知道你一直在躲哪件事**」。
**这是只有本地优先架构才做得出来的东西，也是唯一别人抄不走的。**

---

## 1. 定位：AI 是**输入法**，不是业务规则

这是 [ADR-0005](../adr/0005-ai-data-path.md) §3.1 唯一需要被后人记住的判断。

具体含义是三条可执行的红线：

1. **AI 只产出 `AiSuggestion`。** 它在类型上就**不可能**变成一条 op。
2. **写入必须过 `dispatch()` + 用户确认。** op-log 是唯一真相。
3. **AI 坐在 `dispatch()` 之上**，不参与任何同步、冲突、迁移语义。

> 判断某段代码该不该用 AI，只问一句：**这件事错了，代价是什么？**
> 代价小且可撤销 → 可以让模型做；代价大或不可逆 → 必须用规则。

---

## 2. 三档结构（按"错了代价多大"分）

```
用户输入 / 事件
   ↓
① 规则层 —— 必过，不用模型
   日期、重复、优先级标记、排序、倒计时
   ↓ 只有规则解析不了的才往下
② 特征层 —— 本机纯函数，读 op-log
   推迟过几次、逾期几天、多久没碰、依赖谁
   ↓ 只把②的【摘要】发出去，不是全量任务
③ 模型层 —— 按档位选端点
   本机端点 / heyta 云（订阅）/ 用户自备
   ↓
④ AiSuggestion —— 类型上不可能变成 op
   ↓
用户确认 → dispatch() → op-log
```

### 🔴 ②→③ 那一步是这套设计的核心

**发特征，不要发原文。**

「这件事被推迟了 6 次」比任务全文**更不敏感**、**便宜得多**，
而对模型做判断往往**已经够了**。这一步同时赢了隐私、成本、准确率三件事。

它也是本地优先架构**白送**的优势：算特征需要的全量历史**本来就在本机**。

> ⚠️ 这条目前是**判断，不是实测结论**。它还没有被任何东西验证过。
> 见 §8 第一步。

---

## 3. 五条设想的裁决：只有 2 条真的需要 AI

| 设想 | 真的需要模型吗 | 结论 |
|---|---|---|
| ① AI 拆解任务 | ✅ 是 | → AI-2 |
| ② 优先级排序 | ✅ 是（但只能建议，不能自动改） | → AI-2 / AI-4 |
| ③ 自动生成甘特图 | ❌ **纯计算**：依赖图 + 拓扑排序 | 不是 AI |
| ④ Time Left 倒计时 | ❌ **纯计算**：`(due - now)` | 不是 AI |
| ⑤ API 回传云数据 | ❌ **集成**，不是 AI | → AI-5 |

**给甘特图套一个模型，是最典型的"AI 当装饰"** —— 成本、延迟、隐私风险全涨，
结果还不如确定性算法准。这条线必须守住：`AiFeature` 保持
`'capture' | 'breakdown' | 'prioritize' | 'duration-estimate'`，**不往里加可视化**。

---

## 4. 护城河：记忆 → 专注落差

真实痛点不是"我不会拆任务"，是「**我有 200 条，我在躲最重要的那一条**」。

heyta 手里有一份**别人拿不到的数据**：`MaterializedState` 里的 `focusSessions`
和完整 op-log。于是可以算出一个**确定性的事实**：

> **你嘴上说重要的事**（优先级 / 截止日期）
> **vs 你实际花时间的事**（focus sessions）
> **= 落差**

这个落差**只用规则算**（不需要模型），然后**只用模型写那句话**：

> 「你把这 3 件事标成高优先级，但过去两周的专注时间全花在别处了。」

这就是「**LLM 做得最少**」的最佳形态：**事实用规则算，人话让模型说。**

为什么竞品抄不走：它的云 AI 手里也有数据，但**用户不肯把全部历史交上去**。
而 heyta 的数据本来就在设备上 —— 这不是功能差异，是**架构差异**。

> ⚠️ 同样**尚未验证**。这是 §8 的核心待办。

### 4.1 记忆该建在哪（对应"AI 数据库"）

**不需要新建一个数据库。** heyta 已经有**最好的记忆载体**：

| 已有的 | 为什么它就是记忆 |
|---|---|
| op-log | append-only 全量事件历史 —— 每一次创建/推迟/完成/专注都在里面，**永不丢失** |
| `MaterializedState` | 当前状态的物化视图 |
| SQLite（`packages/storage`） | 已经能带索引查询 |

缺的不是**存储**，是**在它之上的派生层**：把事件历史压成可查询的**特征**
（推迟次数、专注落差、接触频率）。

> 加向量库解决不了这个问题，反而会引入一个新的明文派生物 ——
> 而那正是 [ADR-0005](../adr/0005-ai-data-path.md) 反复警告的东西。

**✅ 这条已用实验验证，不再是判断**（见 [ai-memory-necessity.md](../research/ai-memory-necessity.md)）。

用重复检测做可证伪实验，实测：

| 档位 | 实测 | 判读 |
|---|---|---|
| 易档（字面重叠，n=8） | **100%** | 词法基线有效，不是稻草人 |
| 🔴 难档（换说法，n=8） | **0%** | 词法基线**彻底失效** |
| 误报（n=8） | **25%** | 「订会议室」vs「**取消**会议室」被判为重复 |

🔴 **这打脸了我的预判。** 我原以为"词法够用"，实验说**不够**。

@k 指标进一步收紧了结论（k=5）：难档 **recall@5 仅 13%** ——
87.5% 的换说法任务，词法**连候选都捞不出来**，模型根本没机会看到。

> 🔴 所以**不能**采用"词法先缩小候选、再让模型判" —— 模型会漏掉 87.5%
> 而**它不知道自己漏了**。这条路要成立必须**把整份列表给模型**。

但**"词法不行"不等于"要上向量库"** —— 需要语义判断的地方，
**用已经配置好的模型直接判**即可：任务量级是数百条，整份列表给模型可行，
不需要 ANN 索引；而向量化会在本地引入一份**明文语义派生物**（embedding 本身就是语义），
与 E2EE 立场直接冲突。这是**产品立场**问题，不是选型问题。

⚠️ 本结论最脆弱的假设是"全量给模型的成本可接受"。n=8，**只能定性**。
什么会推翻它，写在结论文档 §5。

---

## 5. 供给模式：自备 + 托管，**两条都要**

见 [ADR-0006](../adr/0006-supply-modes.md)、[ADR-0013](../adr/0013-cloud-ai-and-maas.md)、
[ADR-0020](../adr/0020-ai-subscription-two-tiers.md)、
[ADR-0021](../adr/0021-managed-ai-model-deepseek-flash.md)、
[ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md)。

| 模式 | `AiSupplyMode` | 数据到哪 | 与 E2EE 的关系 |
|---|---|---|---|
| 关 | `off` | 哪都不去 | 中性 |
| 用户自备端点 | `own` | 用户自己的端点 | 中性（用户自己的选择） |
| heyta 云（订阅制，后续 MaaS） | `managed` | **heyta 的服务器** | 🔴 **互斥** —— 必须解开明文才能送模型 |

> 🔴 **铁律（ADR-0006）**：托管 AI **可以提供**，但**绝不能**被描述成端到端加密。
> 它是一个**明确、可撤销、按功能开启的例外**，不是默认。

**当前代码状态**（🔴 2026-10-05 更新）：`assertEnableable()` 对 `managed` **不再抛**
`retention-undecided` —— 保留策略已由 [ADR-0054](../adr/0054-managed-ai-retention-and-selling-preconditions.md)
定案，那条 reason 连同它的成员一起删除（没有构造点的成员不留）。
它现在只拒两件事：**境外供应商**（`managed-endpoint-not-domestic`）与**没填端点**（`endpoint-required`）。
⚠️ 而"库层放开了"≠"用户能用"：任何客户端都还没有那个开关，边界逐条见 ADR-0054 §8。见 §7。

> 档位与价格已由 [ADR-0020](../adr/0020-ai-subscription-two-tiers.md) /
> [ADR-0021](../adr/0021-managed-ai-model-deepseek-flash.md) 锁定
> （¥12 / 月 · 300 次/月 · `deepseek-flash`），但
> [ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md) 判定它**本轮不实现**：
> 云端端点、计量、收银台都不存在，`hosted-ai-monthly` 在计量落地前**不得被售卖**。
> 已有 `check:ai-quota` 门禁把「300 次/月」的数字源与"未实现"状态钉住。

---

## 6. 明确不做

| 不做 | 理由 |
|---|---|
| 端侧模型推理 | ① 实测值准确率 ≤80.4%，端侧只会更差；② 端侧必然产生**明文派生物**；③ **Hermes 无 `WebAssembly`**，移动端根本跑不了。"用户自己的 Ollama"收益相同、零派生物 —— 那就够了 |
| AI 直接写入 | 只能提议。写入必须过 `dispatch()` + 用户确认 |
| 「跟任务聊天」当主界面 | 对大多数操作，聊天是比列表**更差**的 UI。它是演示，不是产品 |
| AI 自动改优先级 | 排序可以建议；**自动改等于替用户定义什么重要** —— 那是信任的悬崖 |
| 把甘特图/倒计时塞进 `AiFeature` | 见 §3 |
| 先做 Pi / harness 集成 | 见 §7.1 |

---

## 7. 现状

### 7.1 已落地

| 分支 | 内容 | 落点 | 证据 |
|---|---|---|---|
| **AI-0** 基座 | 配置路由 / 回退链 / 能力声明 / 健康与熔断 / 出境披露 / 密钥库 | `packages/ai` | 4 文件 / **151 测试** |
| **AI-1** 捕获 | 确定性内核（规则优先，不依赖模型）+ 模型兜底**并存** | `packages/domain/src/capture.ts`、`packages/app-host/src/ai-capture.ts` | §9.1 |
| **AI-2** 拆解 | 拆解请求 → `AiSuggestion` → 用户确认 | `packages/app-host/src/ai-breakdown.ts`、`apps/web/.../AiBreakdown.tsx` | **55 测试** |
| **AI-2** 优先级 / 估时 | 逐条优先级建议、估时（时间线视图） | `packages/app-host/src/ai-{prioritize,duration}.ts`、`AiPrioritize.tsx` / `AiDuration.tsx` | 45 + 49 测试 |
| **AI-5** 接口 / 数据主权 | 本机 API / MCP：默认关、回环、显式 token、逐工具授权、写入经 `dispatch()`；**HTTP + stdio** | `packages/local-api`、`apps/node-host` | **79 + 139 测试** |
| **AI-5 真实握手** | 用**官方 MCP SDK**（第三方参考实现）验证协议，排除"自洽的误解" | `scripts/verify-mcp-real-client.mjs` | 11/11，`pnpm verify:mcp-real` |
| **记忆 / 特征层** | 推迟次数（**只能从事件流算**）/ 逾期 / 专注分钟 / 从未开始 / **专注落差** / 把事实写成话（**不调用模型**） | `packages/domain/src/memory.ts` | **23 测试** |
| **记忆护城河接线** | 「说的 vs 做的」落差第一次接到界面（读真实 op 窗口 → `computeFocusGaps` → `MemoryPanel`）；只读结构化字段、**不渲染领域层中文** | `apps/web/src/App.tsx`、`apps/web/src/features/settings/MemoryPanel.tsx`、`apps/web/src/lib/oplog.ts` | 29 测试（`memory-panel.spec.tsx`，含真 IndexedDB 窗口方向） |
| **失败态闭环** | 每个 `CandidateExclusionReason` 有专属文案 + "下一步点哪里"；熔断冷却后**可重试**；英文界面不出现中文 | `apps/web/src/features/ai/RouteUnavailable.tsx`、`route-explanation.ts`、`ai-failure-copy.ts` | `ai-failure-locale.spec.tsx` 等 |
| **检索基线 + 决策实验** | 词法相似度基线；用重复检测实验决定要不要向量库 | `packages/domain/src/recall.ts`、`tests/recall-experiment.spec.ts` | 7 测试 |
| **偏好推断层** | P1–P5 五条偏好（估算偏差 / 深度时段 / 提前量 / 粒度 / 表达习惯），纯函数 + `sampleSize`/`confidence`/`evidence`；**主开关 fail-closed** | `packages/domain/src/preferences.ts` | 27 测试 |
| **偏好有效性实验** | 留出法（train80/test20）：五条**全部**优于基线，纯噪声上**零误报** | `packages/domain/tests/preferences-experiment.spec.ts` | 8 测试 |
| **偏好接入 prompt** | 按用途过滤（只发当前决定需要的）；`preferences` 进出境披露；开关关时零偏好出境 | `packages/domain/src/preference-hints.ts` | 17 测试 |
| **AI 反馈层** | 记录建议的接受/修改/拒绝（`AI_FEEDBACK`，走 op-log）；子项**逐条可取舍** | `packages/domain/src/ai-feedback.ts`、`packages/app-host/src/ai-feedback-actions.ts` | 20 + 17 测试 |
| **反馈偏好 P6/P7** | 从处置推断粒度与保留率；P6 **MAE 0.167 vs 基线 1.000**；噪声上零误报 | `packages/domain/tests/ai-feedback.spec.ts` | 见上 |
| **偏好可见可纠正** | `MemoryPanel`：依据原文、单条忘掉、**可恢复**的「你已忘记」 | `apps/web/src/features/settings/MemoryPanel.tsx` | **29 测试** |
| **偏好纠正持久化** | `PREFERENCE_CORRECTION`（走 op-log，跨设备同步） | `packages/domain/src/preference-corrections.ts` | 17 测试 |
| **AI 工具调用 P0–P2** | 复用既有工具目录/授权/执行器（不新建）：规则选择（零出境）→ 模型路径（`tools`/`tool_calls`，新 `AiFeature` `'tool-calling'`）→ 读即执行、写只提案、确认才落库 | `packages/app-host/src/ai-tool-{selection,run,call}.ts`、`apps/web/src/features/ai/AiToolRun.tsx`、`packages/ai` 工具线格式 | 见 [ADR-0035](../adr/0035-ai-tool-calling-reuses-local-api.md) 与 [计划](ai-tool-calling.md) |

| **工具目录按实体拆包 + 覆盖面门禁** | ~~8 个用户可操作实体各一组工具（读 10 / 写 12，合计 **22**，上限"每实体 5 × 8 = 40 席"）~~ —— **10-04 现量更正**：**9 个实体**（批次二加了 `EVENT`）、**读 12 / 写 14 合计 26**，上限"每实体 5 × 分母 9 = **45 席**（已用 26，剩 19）"；MCP 与内置 AI **共用同一份目录**（不另建）；🔴 `check:ai-coverage` 已进 `pnpm check` 链 —— "覆盖面"从一句主张变成**会红的判据**，且分子分母都由门自己打印（不再手抄） | `packages/local-api/src/tools/`（**9 个实体 pack** + `pack.ts`/`shared.ts`/`registry.ts`）、`scripts/check-ai-coverage.mjs` | `node scripts/check-ai-coverage.mjs` 打印「实体覆盖面 9/9 … 已登记缺口 0 项 … 目录 26 个工具 ≤ 每实体 5 × 分母 9 = 45 席」；细节见 [EVENT 工具契约](ai-event-tool-contract.md) §15 |
| **批量写入做成一个提案** | 「把这 3 个都完成」= **一个提案 N 条 op**（不是 N 个提案，也不是 N 次确认）；确认前零写入 | `packages/app-host/src/ai-tool-run.ts` | `packages/app-host/tests/ai-tool-run.spec.ts`、`apps/web/tests/ai-tool-run.spec.tsx` |
| **裸「X 号」解析带边界守卫** | 「15 号」这类只说日期的话进 `capture` 的日期档；🔴 守卫防止把「第 3 号任务」「房间 204 号」里的编号读成日期 | `packages/domain/src/capture.ts` | `packages/domain/tests/capture.spec.ts`（正反样本成对） |
| **助手会话历史的本机持久化** | 刷新/重开后对话还在，**过期提案不可再确认**；🔴 只落本机、**不进 op-log、不同步**（跨设备会把对话变成第二个数据面） | `apps/web/src/features/ai/assistant-history.ts` | `apps/web/tests/assistant-history.spec.ts` + `assistant-history-panel.spec.tsx`，变异台 `apps/web/tests/mutate-assistant-history.mjs` |

> 测试数字为 2026-09-29 在 `main` 上实测；四个包的总数是
> `@heyta/ai` 151 / `@heyta/domain` 475 / `@heyta/app-host` 435 / `@heyta/local-api` 79（均 0 skip）。
> ⚠️ 上面这行是**当时的快照**；AI 工具调用落地后已变为
> `@heyta/ai` 162 / `@heyta/app-host` 598（`@heyta/web` 820）。**要数字就重新跑**，别引用这里。

### 7.2 未落地

| 项 | 卡在哪 |
|---|---|
| **托管 AI**（`managed`） | 档位/价格/模型已定（ADR-0020/0021：¥12 / 月 · 300 次/月 · `deepseek-flash`），但 ADR-0023 判定**本轮不实现** —— 云端端点、计量、收银台都不存在；数据保留策略仍未定案，`assertEnableable` 继续挡着 |
| **AI-3** 规划 | 有意推迟（需要真实数据） |
| **AI-4** 复盘 | 受限分支，未开工 |
| 密钥库的其他平台 | 只有 macOS 实现了；Windows / Linux / 移动端未实现（发布时再做） |

> **2026-10-03 逐条复核（载体 `4107e234`）**：上面四条"未落地"**在复核当时仍然成立** ——
> 托管 AI 仍被 `assertEnableable()` 抛 `retention-undecided` 挡着（`packages/ai/src/supply.ts`）、
> AI-3 / AI-4 无实现、密钥库仍只有 macOS。本节 §7.1 新增的四行是**这一天的落地项**，
> 不是对上面任何一条的改判。
> 🔴 **2026-10-05 更正（只更正托管那一条）**：`retention-undecided` 已随
> [ADR-0054](../adr/0054-managed-ai-retention-and-selling-preconditions.md) 删除，
> 保留策略定案、计量与代理路由落地、`hosted-ai-monthly` 可下单；
> 这一条从"闸门挡着"改判成"服务端已落地、客户端还没有那个开关"（ADR-0054 §8）。
> AI-3 / AI-4 与密钥库那几条**本笔不代它们主张状态**。
>
> ⚠️ 一条同时暴露出来的文档缺口：本线的headline（覆盖面跑满 —— 落地时 8/8、10-04 现量 9/9 + 覆盖面门禁进链）
> 在 `AGENTS.md §9` 与 `roadmap.md §1.1`（AI-0…AI-5 那张表）**都没有落点** ——
> 那两张表按"分支"组织，而"每实体动作覆盖面"是一条新轴。
> 补哪一行由产品负责人定（`AGENTS.md` 按 §8 要用户点头才改），候选文本在
> [EVENT 工具契约](ai-event-tool-contract.md) §15.13。

#### 7.2.1 🔴 价格锚点：这条路线的真实经济约束

**对标产品的会员价约 ¥139 / 年**（滴答清单 Premium）。

这个数字必须写在"计费"那一栏旁边，因为**它才是计费难的真正原因**：

- ¥139 / 年 ≈ **¥11.6 / 月**。托管 AI 要在这个价格里留出利润，
  意味着**重度用户的 token 成本必须远低于 11 元/月** ——
  而"帮我拆解任务""每天排一次计划"这类用法的调用频率并不低。
- 于是托管 AI **天然必须计量 + 限流**（按次 / 按月额度 / 降级到小模型）。
  也就是说 ADR-0013 里那个"计费与计量"前置项**不是一道手续，是一个产品设计**。
- **「先把计费做出来再上服务」** 这条纪律因此更硬：先上线、后补计量，
  等于用一个固定价格去兜一个不封顶的成本。

**结论（强化既有判断，不改变它）：自备密钥（BYOK）不是"隐私选项"，而是这条
路线在经济上唯一站得住的基础。** 用户用自己的 key，成本就不经过我们；
托管 AI 只在计量方案定下来之后才谈得上。这与用户已经拍板的
「两种模式都要提供」并不冲突 —— **两种模式都要有，但它们的成本结构完全不同，
不该被当成同一个功能的两个开关。**

> ⚠️ 本文的 ¥139 / 年 是**对标产品的现行价**，不是我们的定价结论；
> 它在这里的作用是**约束可行性**，不是承诺售价。
> 我们的定价结论在 [ADR-0020](../adr/0020-ai-subscription-two-tiers.md)（¥12 / 月，含 300 次 AI），
> 而它的落地顺序被 [ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md) 卡在"计量存在之后"。


### 7.3 关于 Pi（harness）

方向对，**时机错**。Pi 的价值在 **agent 循环 + 统一 LLM API**，
而前几步**这两样都不需要** —— 需要的是一次 LLM 调用 + 好提示词 + 好上下文。

而且 Pi 有三个硬约束（详见 [ADR-0013](../adr/0013-cloud-ai-and-maas.md) §6.4）：

1. **`engines: node>=22`** → **只有桌面壳能内嵌**，Web 和移动端都不行
2. README 明写**没有内建权限系统**，以用户全权限运行 → 与 heyta 的隐私承诺直接冲突
3. `pi-ai` 与 `packages/ai` 会撞车 → 建议 `packages/ai` 保留策略层，Pi 只跑循环

> **先建 harness，你会得到一个非常能干的 agent，然后花半年想它能干嘛。**

---

## 8. 下一步：信任阶梯

顺序的道理是**信任** —— 从"AI 不可能伤害你"的地方开始，逐步挣得做更多事的权利。
反过来做（先上 agent 再补隐私）会一次性烧掉用户信任，而且**在开发阶段看不出来**。

| # | 做什么 | 在哪跑 | 为什么是这个顺序 |
|---|---|---|---|
| ~~1~~ | ~~特征层原型~~ | — | ✅ **已完成**（见 §7.1）。§4 的护城河已是可运行代码，§2/§4 两条判断已用实验验证 |
| ~~2~~ | ~~把记忆层接进界面~~：让「你在躲什么」真的出现在用户眼前 | 本机 | ✅ **已完成**（2026-09-27，merge `73b13b2`）：`computeFocusGaps()` 已在 `apps/web/src/App.tsx` 读真实 op 窗口后调用，`MemoryPanel` 展示「说的 vs 做的」落差与结构化依据。判据仍是"去数调用点"——现在数得到 |
| ~~3~~ | ~~捕获解析（本机端点，内联）~~ | 本机 | ✅ **代码已完成**（`ai-capture.ts` 走 `invokeRouted` 生产路径，已挂进 web 面板）。⚠️ 但**"完成"不等于"用户用得上"**：2026-10-02 实测本机端点被跨源策略挡住，见 [`ai-assistant-closure.md`](ai-assistant-closure.md) W1 |
| ~~4~~ | ~~拆解（显式触发）~~ | 云 / 自备 | ✅ **代码已完成**（`ai-breakdown.ts`，同上）。⚠️ 同 W1 那条 caveat。另：本文 §4「发送特征不发送原始文本」这条判断**从未实现**，`ai-breakdown` 至今把原始 `title`/`note` 放进提示词 —— 已在 [`ai-feature-completeness-audit.md`](../research/ai-feature-completeness-audit.md) §4.2 记为文档债 |
| 5 | agent 多步自主 | Pi，**仅桌面** | 🔴 **仍未开始，且这一行是本表唯一还有效的"下一步"**。⚠️ 两处必须先看：① 本行的"多步"若沿用 ADR-0035 对 P3 的定义（**只读**循环、写永不进循环），**做完也复现不了**竞品那条"3 读 + 1 写"的链 —— 差别登记在 `AI-G4`；② 开工前要先还 §8.1 那两笔重复账（`createProvider` 与 `invokeRouted` 两套请求组装、`describeRoutedFailure` 抄了四遍），否则 loop 一上，重复乘二 |

### 8.1 本节的两处过期与一条顺序更正（2026-10-02）

- 第 3、4 行原本仍列为"下一步"，但 §7.1 自己已标注落地 —— **同一份文档里两个答案**，正是
  `docs/plans/README.md` §七第 1 条要防的形状。已在上表就地更正，原措辞保留在删除线里。
- 🔴 **顺序更正**：本节开头说"从 AI 不可能伤害你的地方开始，逐步挣得做更多事的权利"，
  这个**信任阶梯的前提是先有用户能跑到第一步**。2026-10-02 的实测是：默认路径（本机端点）
  在跨源那一层就断了，而三个真端点验收脚本"跳过并退出 0"，所以**没有任何门禁会报告这件事**。
  ⇒ 在阶梯上继续往上盖之前，先做 [`ai-assistant-closure.md`](ai-assistant-closure.md) 的 W1、W2。
  这不是新的产品方向，是**让已有的方向可达**。

⚠️ **一条边界说明**：`describeFocusGaps()`（领域层拼好的中文句子）仍然零生产调用点，
但那是**刻意的** —— 英文界面不许露中文，壳必须用 `FocusGap` 的结构化字段 +
本地化词条自己拼。这不是"没接线"，是分层纪律。

---

## 9. 文档地图

| 想知道… | 读 |
|---|---|
| **AI 做成什么样（本文）** | `docs/plans/ai-strategy.md` |
| 能力怎么拆、怎么排期、git 分支怎么分 | [ai-capability-branches.md](ai-capability-branches.md)（大而全） |
| 哪些决策已定 / 被推翻 | [ai-open-decisions.md](ai-open-decisions.md) |
| 滴答清单怎么做的 + 我们能用的推理架构 | [ai-competitive-and-architecture.md](../research/ai-competitive-and-architecture.md) |
| 13 个产品的横向对比 | [ai-feature-landscape.md](../research/ai-feature-landscape.md) |
| E2EE 产品怎么处理 AI（Bear / Joplin） | [e2ee-apps-ai.md](../research/e2ee-apps-ai.md) |
| SSOS 的 AI 路由哪些能抄 | [ssos-ai-routing-design-analysis.md](../research/ssos-ai-routing-design-analysis.md) |
| 可视化竞品拆解报告 | [ai-competitive-teardown.html](../research/ai-competitive-teardown.html) |
| **决策（不可变）** | ADR [0005](../adr/0005-ai-data-path.md) / [0006](../adr/0006-supply-modes.md) / [0010](../adr/0010-ai-config-routing.md) / [0011](../adr/0011-local-api-mcp.md) / [0013](../adr/0013-cloud-ai-and-maas.md) / [0014](../adr/0014-memory-switch-and-corrections.md) |
| **代码现在长什么样（模块 / 类型 / 常量 / 不变量）** | [ai-architecture.md](../reference/ai-architecture.md) —— 入口文档讲"为什么"，它讲"怎么搭的" |
| **AI 记忆系统实施计划（偏好）** | [ai-memory-system.md](ai-memory-system.md) |
| **记忆要不要向量库（实验结论）** | [ai-memory-necessity.md](../research/ai-memory-necessity.md) |
| 记忆 / AI 数据库调研原料（许可证 / 三端矩阵 / 实测数字） | [ai-memory-db-2026-09.md](../../research/ai-memory-db-2026-09.md) |
