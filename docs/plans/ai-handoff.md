# 交接：AI 方向 —— 从「四件套已落地」到「护城河接上界面」

> **给接手的 agent。** 这份文档只讲三件事：**什么已经做完（别重做）**、
> **哪些"未做"其实已经过期（别照着旧清单干）**、**现在真正该做的第一件事是什么**。
>
> - **状态**：持续更新（属于 `plans/`，不是不可变的 ADR）
> - **写于**：2026-09-27，基于 `main` @ `7791bec` 的**实测**（每个数字都跑过，见 §7）
> - **入口文档**：[ai-strategy.md](ai-strategy.md)（讲为什么）
> - **代码地图**：[ai-architecture.md](../reference/ai-architecture.md)（讲怎么搭的）
> - **决策**：ADR [0005](../adr/0005-ai-data-path.md) / [0006](../adr/0006-supply-modes.md) / [0010](../adr/0010-ai-config-routing.md) / [0011](../adr/0011-local-api-mcp.md) / [0013](../adr/0013-cloud-ai-and-maas.md) / [0014](../adr/0014-memory-switch-and-corrections.md)

---

## 0. 一句话

**四个 AI 功能（捕获 / 拆解 / 优先级 / 耗时估计）已经全部端到端可达，且有门禁钉住。
唯一没接线的核心件是「专注落差」这条护城河 —— `memory.ts` 实现了、测了、导出了，
零生产调用点。**

这不是新问题：它是本仓库**已经踩过六次**的同一个 bug 类
（能力实现了、被测了、但没人调用）。`ai-strategy.md` §8 下一步：信任阶梯
把它列为「下一步第 2 步」，**到今天仍然没做**。

**而且不止一个。** 同一个 bug 类还出现在**隐私闸门**上：
`packages/ai/src/egress.ts:164` 的 `retainValidConsents()` 同样零调用点，
而它防的是"陈旧授权复活 → 我没同意过的组合被放行"（§3.4）。

所以接手后的第一件事不是写新功能，是**按代价排序清掉这两个**：
**先补闸门（§3.4），再把护城河接上界面（§3.1–3.3）**。

---

## 1. 已经做完的（不要重做，不要改）

| 分支 | 内容 | 落点 | 我实测的证据 |
|---|---|---|---|
| **AI-0** 基座 | 配置路由 / 回退链 / 能力声明 / 健康与熔断 / 出境披露 / 密钥端口 | `packages/ai` | **4 文件 / 144 测试** |
| **AI-1** 捕获 | 确定性内核（规则优先，**不依赖模型**） | `packages/domain/src/capture.ts` | 含在 domain 的 395 测试里 |
| **AI-2** 拆解 | 拆解请求 → `AiSuggestion` → 用户确认才写入 | `packages/app-host/src/ai-breakdown.ts`、`apps/web/src/features/ai/AiBreakdown.tsx` | 同上 |
| **AI-5** 接口 / 数据主权 | 本机 API / MCP：**默认关、只回环、显式 token、逐工具授权、写入经 `dispatch()`**；**HTTP + stdio 两种传输** | `packages/local-api`、`apps/node-host/src/mcp-stdio-server.ts` | **3 文件 / 79 测试** |
| **AI-5 真实握手** | 用**官方 MCP SDK** 验证协议，排除"自洽的误解" | `scripts/verify-mcp-real-client.mjs` | 11/11，`pnpm verify:mcp-real` |
| **记忆 · 事实层** | 推迟次数（**只能从事件流算**）/ 逾期 / 专注分钟 / 从未开始 / **专注落差** | `packages/domain/src/memory.ts` | ⚠️ **零调用点**，见 §3 |
| **记忆 · 偏好层 M1–M6** | P1–P7 七条偏好 + 留出法验证 + 接进 prompt + 反馈层 + 可见可纠正界面 | `packages/domain/src/preferences.ts`、`preference-hints.ts`、`ai-feedback.ts`、`apps/web/src/features/settings/MemoryPanel.tsx` | 同上 |
| **门禁** | AI 功能端到端可达 + 托管 AI 文案不许说成 E2EE | `scripts/check-ai-coverage.mjs` | ✅ 见 §6 |

**四个功能全部端到端可达**，这是 `check:ai-coverage` 的实测输出（不是我的判断）：

```
联合类型成员：capture, breakdown, prioritize, duration-estimate
界面不可达豁免：（无）
✅ 4 个 AI 功能全部端到端可达（实现 → 导出 → 路由声明 → 偏好声明 → 界面）。
```

> 🔴 **注意那个"界面不可达豁免：（无）"。** 这条门禁的意义就在于
> **它不允许存在豁免** —— 任何功能只要在 `AiFeature` 联合类型里，
> 就必须真的能从界面点到。它正是为「实现了但没人调用」这个 bug 类立的。

---

## 2. 🔴 最值钱的一节：旧清单里已经过期的条目

`ai-capability-branches.md` §9.28 仍未做（诚实清单）
和 `ai-open-decisions.md` 的部分条目**已经过期**。照着它们干会白干一遍。

| 旧说法 | 现在的实测 | 证据 |
|---|---|---|
| ⚠️ MCP **stdio 没实现** | ✅ **已实现** | `apps/node-host/src/mcp-stdio-server.ts`、`cli-mcp.ts` |
| ⚠️ **没有用真实 MCP 客户端跑过** | ✅ **已跑过**，11/11 | `scripts/verify-mcp-real-client.mjs` |
| ⚠️ macOS 钥匙串**还没被任何地方调用** | ✅ **已接线** | `apps/node-host/src/cli-ai.ts:39-101`（`createKeychainSecretStore` + `isKeychainAvailable`） |
| ⚠️ **熔断状态没落盘**（跨重启即忘） | ✅ **已落盘，且读回** | `apps/web/src/features/settings/aiStore.ts:129`（`toHealthSnapshot`）+ `:130`（`fromHealthSnapshot`） |
| ⚠️ `packages/ai` / `packages/local-api` **未登记进 `AGENTS.md` §2** | ✅ **已登记** | `AGENTS.md:35-36` |
| 🔴 「受保护条目」没有产品机制 | 🔴 **仍然为真**（决策 1 = 不做，只把话在界面上说清楚） | `ai-open-decisions.md` 决策 1 |
| 🔴 托管 AI 保留策略未定 | 🔴 **仍然为真**，`assertEnableable` 继续抛 `retention-undecided` | `packages/ai/src/supply.ts:266`、`provider.ts:167,315` |

**怎么用这张表**：它省掉你 4 次"重新发现已经做完的事"。
但它**不是永久有效** —— 接手后先自己复跑一遍 §7 的命令再相信它。

---

## 3. 🔴 核心缺口：三个"实现了但没人调用"的件

### 3.1 事实

`packages/domain/src/memory.ts` 导出三个函数：

| 导出 | 作用 |
|---|---|
| `computeTaskMemory(input)` | 每条任务的推迟次数 / 逾期 / 专注分钟 / 从未开始 |
| `computeFocusGaps(...)` | 🔴 **专注落差** —— 「你标成重要的」vs「你实际花时间的」 |
| `describeFocusGaps(gaps)` | 把落差**写成一句人话**（**不调用模型**） |

**谁调用它们？没有人。** 全仓库引用只有两处：

```
packages/domain/src/index.ts:20:  export * from './memory.js';   ← 只是转出去
packages/domain/tests/memory.spec.ts:9                          ← 它自己的测试
```

没有第三个地方。`MemoryPanel.tsx` 接的是**偏好层**（`preferences.ts` /
`preference-copy.js`），不是事实层。

### 3.2 为什么这件事重要

`ai-strategy.md` §4 护城河：记忆 → 专注落差
说得很清楚，**这条护城河是 heyta 唯一别人抄不走的东西**：

> **你嘴上说重要的事**（优先级 / 截止日期）
> **vs 你实际花时间的事**（focus sessions）
> **= 落差**

它的形态是「**LLM 做得最少**」的最佳例子 —— **事实用规则算，人话让模型说**。
竞品抄不走的原因不是功能差异，是**架构差异**：它的云 AI 手里也有数据，
但用户不肯把全部历史交上去；而 heyta 的数据本来就在设备上。

**现在这条护城河只存在于 `packages/domain` 里，用户看不见。**
按本仓库的判据（§9.23「去数一数这个函数被谁调用」），它等于**没做**。

### 3.3 验收判据（不许停在"代码接上了"）

`ai-memory-system.md` §9 分阶段实施
定下的纪律：M3/M4/M6 的验收判据都**没停在"代码接上了"**，
而是把断言一路推到**用户可观察的末端**（HTTP 请求体 / op-log 里的真实记录 / 界面上的按钮与文案）。
这一件必须沿用同一条纪律：

| 不许这样验收 | 要这样验收 |
|---|---|
| "`computeFocusGaps` 被 import 了" | 界面上**真的出现了那句话**，且有测试钉住它的**文案内容**（不是"某个元素存在"） |
| "加了一个面板" | 落差为空时**不显示**（不许编一句"你最近很专注"） |
| "数据接上了" | 断言那条文案里的**数字**来自真实 op-log（构造已知数据 → 断言出现的是那个数字） |

⚠️ 样本不足时**不许编**，要明确表现出「我还不了解你」，而不是假装懂。
空状态是**功能**，不是待办 —— 这条纪律见 `ai-memory-system.md` §5.3 冷启动必须诚实

### 3.4 🔴 同一类问题的第二个（**在隐私闸门上**）：`retainValidConsents` 零调用点

`packages/ai/src/egress.ts:164` 的 `retainValidConsents()` —— **4 条测试，零生产调用点**
（全仓库引用只有它自己、`index.ts` 的转出、和它的测试）。

它的注释（`egress.ts:152-163`）自称是「**本文件的核心不变量的另一半**」，
并点明了不调用它的后果：

> 用户从"本地 Ollama"切到"heyta 托管"、再切回"自备远端"时，
> 那些陈旧记录会**重新**变得可匹配 —— 于是出现"我没同意过这个组合，但它放行了"。

**实测确认：该调它的地方没有调它。** `apps/web/src/features/settings/AiSettings.tsx`
自己写了一套更弱的行内逻辑：

| 位置 | 问题 |
|---|---|
| `grant()` `:406-416` | **硬编码** `destination: 'user-endpoint'` —— 目的地不是从 URL 推导的。而**同一个文件** `:433` 的 `routeTouchesRemote()` 明明在用 `classifyDestination()` |
| `revoke()` `:418-425` | 同样硬编码 `'user-endpoint'` |
| 删端点 `:377-390` | 清掉路由，**不清 consents** |

后果：**删掉一个远端端点、再配一个新的远端端点，旧授权仍留在 `consents` 里，
会直接放行 —— 用户没有重新同意过。** 这是"同意"这件事被静默降级，
方向正是本项目最在意的那个（闸门失效）。

⚠️ **与 `memory.ts` 的区别**：那个是"功能没交付"，这个是**闸门有缺口**。
按 `ai-strategy.md` §2 三档结构（按"错了代价多大"分）
的排序原则，**这个应当优先于那个**。

**修法不是新写代码** —— 是让 `AiSettings` 改用**已经写好、已经测过**的
`retainValidConsents`，并把 `grant()` 的目的地改成 `classifyDestination()` 的推导结果。
（这正好也是 `check-ai-coverage` 那类门禁抓不到的形状：**函数存在、有测试、没人调用**。）

### 3.5 第三个：「发特征，不要发原文」**还没实现**

`ai-strategy.md` §2 三档结构（按"错了代价多大"分）
把这一条写成整套设计的核心：

> 🔴 **②→③ 那一步是这套设计的核心。发特征，不要发原文。**
> 「这件事被推迟了 6 次」比任务全文**更不敏感**、**便宜得多**……

**但代码发的是原文。** `packages/app-host/src/ai-breakdown.ts:92-97`：

```ts
const fields: string[] = ['title'];
const lines = [`任务标题：${source.title}`];
if (source.note !== undefined && source.note.trim() !== '') {
  fields.push('note');
  lines.push(`已有备注：\n${source.note}`);
}
```

出境的是 **`title` 原文 + `note` 原文**（披露里如实写着这两个字段名 —— 这一层是诚实的）。
四个功能都是这个形状：`ai-breakdown.ts:92` / `ai-capture.ts:172` /
`ai-duration.ts:222` / `ai-prioritize.ts:198`。

⚠️ **不要把它当成"文档说谎"** —— `ai-strategy.md` §2 三档结构（按"错了代价多大"分）
里自己就标了「这条目前是**判断，不是实测结论**，它还没有被任何东西验证过」。
诚实的说法是：**它是一条尚未实现的设想**，而披露如实反映了当前行为。
落地它需要一次真正的设计（发哪些特征、怎么算、够不够用），**不是改几行 prompt**。

---

## 4. 你的规格（已定，不要重新发明）

这五条是红线，改任何一条都要先写 ADR：

| # | 规则 | 为什么 |
|---|---|---|
| 1 | **AI 只产出 `AiSuggestion`** —— 它在类型上就**不可能**变成一条 op | ADR-0005 §3.1 |
| 2 | **写入必须过 `dispatch()` + 用户确认**，op-log 是唯一真相 | 同上 |
| 3 | **发特征，不要发原文** | 同时赢隐私、成本、准确率 |
| 4 | 🔴 **相对日期绝不交给模型** | **实测结论**：同一个「明天下午三点」，规则内核算 `2026-09-27` ✅，真实模型给 `2026-05-08` ❌（错 4 个半月）。见 §5.2 |
| 5 | **隐私开关 fail-closed** —— `memoryEnabled` **必填、无默认值** | 本项目踩过 fail open 的坑（`isReadable` 曾是可选参数、默认 `() => true`） |

**判断某段代码该不该用 AI，只问一句**：这件事错了，代价是什么？
代价小且可撤销 → 可以让模型做；代价大或不可逆 → 必须用规则。

---

## 5. 交付物（按价值排序）

### 5.1 🔴 第一件事（按代价排）：补隐私闸门，再接护城河

**① 先补闸门** —— 把 `retainValidConsents` 接进 `AiSettings`（见 §3.4）。
它防的是"陈旧授权复活 → 我没同意过的组合被放行"，**错了的代价最大**。

**② 再把「专注落差」接上界面** —— 见 §3.1–3.3。
这是**唯一一件"做完就算把护城河交付了"**的事。

落点建议：`apps/web/src/features/` 下新增一个落差面板，
或接进既有的 `MemoryPanel.tsx`（它已经有"可见可纠正"的骨架）。
🔴 **推断层必须落在 `packages/`**（ADR-0003：偏好/落差决定 AI 该怎么做，**是业务**），
`apps/*` 只做壳。

### 5.2 真实端点实测撞出来的两个真缺陷（还没修）

来自 `ai-capability-branches.md` §9.8 🔴 真实端点实测（2026-09-26）—— 两条被真数据推翻的假设
**47 条打桩测试一条都没碰到**：

**(a) 「高优先级」没被解析** —— 真缺陷，不是设计取舍。

```
输入      : 下午三点开周会 高优先级
title     : 下午三点开周会 高优先级   ← 「高优先级」留在了标题里
priority  : undefined                 ← ❌
```

现有优先级规则没覆盖"高优先级"这个说法（`packages/domain/src/capture.ts`）。
**这个可以直接修**：加词条 + 测试。

**(b) 「下午三点」无处可放** —— 🔴 **这是产品缺口，不是解析缺口。**

`Task.dueDate` 是**日期**，没有"时刻"。所以「下午三点」目前没有字段能装。
要么加字段（schema 变更，按 `AGENTS.md` §3.3 要谨慎），
要么明确"heyta 的截止是日期级"并让解析器**如实丢弃**而不是假装解析了。
**这需要一次产品决策，不是顺手改解析器能解决的。**

### 5.3 托管 AI 的三项前置条件（不是"再写一轮代码"能解决的）

ADR-0013 已定：heyta **会**提供云端 AI 并按此收费，后续有 MaaS。
但 `assertEnableable()` 对 `managed` **主动抛错**（`retention-undecided`）——
这是**故意的**：一个"能开但没说清楚数据怎么留"的云 AI，比"开不了"更糟。

三项前置条件，**一件都没完成**：

1. **服务本体**
2. **数据保留策略**（保留多久 / 谁看得到 / 用于训练吗 / 要不要在产品里明说）
3. **计费与计量**

🔴 **第 3 项不是一道手续，是一个产品设计。** 依据在 `ai-strategy.md` §7.2 未落地
里的「价格锚点」小节：对标产品会员价约 **¥139/年 ≈ ¥11.6/月**，托管 AI 要在这个价格里留出利润，
意味着重度用户的 token 成本必须远低于 11 元/月 —— 而"每天排一次计划"这类用法调用频率并不低。
所以托管 AI **天然必须计量 + 限流**。**"先把计费做出来再上服务"这条纪律因此更硬**：
先上线、后补计量，等于用一个固定价格去兜一个不封顶的成本。

### 5.4 其他平台的钥匙串（等发布再做）

只有 **macOS** 实现了（`/usr/bin/security`，零新依赖）。
Windows / Linux / 移动端**未实现**，且 `isKeychainAvailable` **如实返回 false**，不假装能用。

🔴 **刻意没有"先在别的平台上尽力试试"**：一个没验证过的钥匙串实现
最可能的失败方式是**静默丢密钥** —— 用户以为存好了，实际没存。
**等真要发布那个平台时再做，而且在真实的那台机器上验证一遍**（不是交叉编译了就算）。

### 5.5 AI-3 规划 / AI-4 复盘

**有意推迟。** AI-3 的理由已经变了：不再是"没有证据"，而是**证据说条件极苛刻**；
前置条件仍是 AI-1/AI-2 有真实使用数据。AI-4 是受限分支，未开工。

### 5.6 顺手就能清的：死代码与文档漂移

**零生产调用点、且零测试的死代码**（可以删）：

| 位置 | 状态 |
|---|---|
| `packages/ai/src/routing.ts:916` `describeRouteIntent` | 零调用点、**零测试** |
| `packages/ai/src/provider.ts:294` `EGRESS_ORDER_NOTE` | 零调用点、**零测试** |
| `packages/ai/src/presets.ts:87` `findPreset`、`:98` `presetDestinations` | 有测试，但生产只用 `AI_ENDPOINT_PRESETS` |
| `packages/ai/src/provider.ts:299` `previewDisclosure` | 有测试，但界面直接用 `buildDisclosure` |

⚠️ 删之前先确认它不是"留给下一层的接口" —— 但按本仓库自己的判据，
见 `ai-capability-branches.md` §9.23 判据：去数一数这个函数被谁调用
**零调用点 + 零测试 = 死代码**。

**文档里的测试数已经过期**（不影响正确性，但会让人误判规模）：

| 位置 | 写的 | 实际（我实测） |
|---|---|---|
| `ai-strategy.md:189` | `packages/ai` 130 | **144** |
| `ai-strategy.md:191` | 拆解 45 | app-host **55** |
| `ai-strategy.md:194` | 记忆 20 | **23** |
| `ai-strategy.md:201` | MemoryPanel 14 | **17** |
| `ai-open-decisions.md:50-52` | 130 / 173 / 134 | 144 / … / … |
| `apps/web/tests/app-mount.spec.tsx:21` | 48 / 63 / 14 | **47 / 67 / 17** |
| `ai-memory-system.md:11` | 状态「**待实施**」 | 🔴 **M1–M6 全部完成**（同文件 §9:274-279 自己写着） |

🔴 **最后一行最要紧**：一份写着"待实施"的计划会让人**从头重做一遍已经做完的事**。
本文件 §2 那张表就是为同一类问题写的。

---

## 6. 门禁：哪些是真的在跑

| 检查 | 在 `pnpm check` 里吗 | 实际验什么 | 需要网络/密钥吗 |
|---|---|---|---|
| `check:ai-coverage` | ✅ **在** | 4 个 `AiFeature` 全部端到端可达（实现→导出→路由声明→偏好声明→界面），**且不许有豁免**；托管 AI 文案必须仍带「不受端到端加密」的否定 | ❌ |
| `check:ai-e2e` | ✅ **在**（= preflight + `e2e` 套件） | 端口 4318/4319 是空的，然后跑真浏览器 e2e（含 5 个 AI spec） | ❌ |
| `verify:ai-live` | ❌ 手工 | **真实端点**验路由层：闸门 / 目的地推导 / 请求体只有 `model`+`messages` / 失败分类。**数出**"未授权时网络请求数 = 0" | 🔴 **要真 key** |
| `verify:ai-breakdown-live` | ❌ 手工 | **整条功能链路**：`requestBreakdown` 从一句描述到可写进备注的 Markdown | 🔴 **要真 key** |
| `verify:ai-preferences-live` | ❌ 手工 | **记忆层**：偏好有没有被用上、有没有被复述、**关掉时有没有真的不发** | 🔴 **要真 key** |
| `verify:mcp-real` | ❌ 手工 | 用**官方 MCP SDK** 验证协议，排除"自洽的误解" | ❌ |

**三个 `verify:ai-*-live` 的配置**放在仓库外：
`/tmp/heyta-ai-live/provider.json`（权限 600）。**没配置时明确打印"跳过"并退出 0。**

> 🔴 **为什么不进 CI**：它们要真 key。而"测试全绿推不出真能跑"是本仓库的老毛病
> （`AGENTS.md` §7 #27/#28/#31）。**接手的 agent 应当至少手工跑一次
> `verify:ai-breakdown-live` 和 `verify:ai-preferences-live`** —— 它们各自撞出过
> 打桩测试完全碰不到的真问题（§5.2 就是这么来的）。

---

## 7. 必跑（贴真实输出，不许推断）

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# 1. 三个 AI 相关包的测试
pnpm --filter @heyta/ai test          # 4 文件 / 144 测试
pnpm --filter @heyta/domain test      # 14 文件 / 395 测试
pnpm --filter @heyta/local-api test   # 3 文件 / 79 测试

# 2. 门禁
node scripts/check-ai-coverage.mjs          # ✅ 4 个功能全部端到端可达
node scripts/check-ai-e2e-preflight.mjs     # ✅ 4318/4319 都是空的
pnpm check                                  # 全链路

# 3. 有真 key 时（强烈建议至少跑一次）
pnpm verify:ai-breakdown-live
pnpm verify:ai-preferences-live
pnpm verify:mcp-real
```

**我这一轮实测的数字**（2026-09-27，`main` @ `7791bec`）：

| 命令 | 结果 |
|---|---|
| `pnpm --filter @heyta/ai test` | **4 文件 / 144 passed** |
| `pnpm --filter @heyta/domain test` | **14 文件 / 395 passed** |
| `pnpm --filter @heyta/local-api test` | **3 文件 / 79 passed** |
| `node scripts/check-ai-coverage.mjs` | **exit 0**，4 个功能全部可达，**无豁免** |
| `node scripts/check-ai-e2e-preflight.mjs` | **exit 0** |
| `pnpm check`（全链路，16 项） | **exit 0** |
| `pnpm --filter @heyta/sync-server test` | 68 文件 / **1374 passed** \| 1 skipped |
| e2e AI 套件（`pnpm check:ai-e2e` 内） | 13 passed（含 5 个 AI spec） |

⚠️ **`pnpm check` 不跑测试**（`pnpm test` 才跑）。两者都要跑。

---

## 8. 诚实要求

### 8.1 判据是"去数调用点"，不是"代码写好了"

这是本仓库最贵的教训，**踩过六次**。`ai-capability-branches.md` §9.23–9.27
整整五节都在讲同一件事。**接手后对任何"已完成"的说法，先去 grep 它的调用点。**

`memory.ts` 就是当前唯一还没被这条判据清算的件（§3）。

### 8.2 那条被跳过的测试是 **by design**，但要知道它意味着什么

`apps/web/tests/journey-ai-memory.integration.spec.tsx:198` 是
`describe.skipIf(CONFIG === undefined)`，`CONFIG` 来自
`/tmp/heyta-ai-live/provider.json`（`:53`、`:71`）。

**它不是漏洞** —— 没有真 key 时它就该跳过。但它的含义是：

> 🔴 **「AI 记忆从头到尾」这条真实用户旅程，只有在有人配了真 key 时才被验证过。**
> 没有 key 的环境（含 CI）里，它是**未验证**的。

所以：**别把"测试套件全绿"当成"记忆旅程被验证了"。** 它们是两件事。

### 8.3 明确未验证的

- **托管 AI**：完全未实现（`assertEnableable` 挡着），没有任何一行服务端代码。
- **Windows / Linux / 移动端钥匙串**：未实现，如实报错。
- **AI-3 / AI-4**：未开工。
- **`check:layering` 的"`apps/*` 不得绕过 `LocalApiWritePort` 直接改状态"这条规则**：
  还没加 —— 现在加会是一条规定空文件的规则，**要等真有调用点**。
- **模型在真实中文输入上的表现**：只在**一个**供应商的一个模型上实测过
  （`deepseek-v4.1-flash`）。§5.2 那两个缺陷就是它照出来的 —— 换模型可能还有别的。
- 🔴 **远端的"授权"路径没有浏览器级覆盖**：e2e 用的桩必须在回环上，
  于是目的地恒为 `none`、**不需要授权**。所以 `consent-*` 那条路只有单测，
  **没有端到端**。这一条是 e2e 文件自己声明的（`ai-unavailable.spec.ts:15-18`）。
- **heyta 没有服务端 AI 代理**：`packages/local-api` 的工具只有
  `list_tasks` / `get_task` / `list_projects` / `create_task` / `update_task` / `complete_task`
  —— **没有任何 AI 端点**。四个 AI 功能全是**浏览器直连用户自己的端点**
  （`packages/ai/src/provider.ts:217` 的 `POST {endpoint}/chat/completions`）。
  这与 ADR-0005 §3.2.1 一致（Web 端不粘 Key），但意味着"托管 AI"是**从零开始**。

---

## 9. 已知的坑（别重复踩）

1. **`pnpm check` 需要真的 `npx` 在 PATH 上** —— 默认 PATH 里没有，
   先 `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"`。
2. **`pnpm check` 不跑测试**，`pnpm test` = `pnpm -r build && pnpm -r test`。两个都跑。
3. **加实体类型不是局部改动** —— 仓库有**四处门禁会同时红**，它们全都抓到过遗漏：
   `packages/domain` 的 `MODELED_ENTITY_TYPES` 编译期断言、
   `packages/op-log/tests/entity-coverage.spec.ts`、
   `server` 的 `ALLOWED_ENTITY_TYPES.size`、
   `apps/mobile` 的实体中文名清单。
   （漏了会**静默丢弃**实体：同步得到处都是，哪儿也不显示，也不报错。）
4. **⚠️ 注入验证别写坏开发者的登录钥匙串** —— 这个仓库真出过事故
   （`ai-capability-branches.md` §9.11 ⚠️ 事故：注入验证写坏了开发者的登录钥匙串
   与 §9.16 密钥命令：又一次差点写坏真实钥匙串）。跑钥匙串相关的注入验证时，
   **必须用 `HEYTA_KEYCHAIN_PATH` 指向临时钥匙串**。
5. **`web_search` 工具在本机是坏的**（Tavily HTTP 432）。要查文档用 `web_fetch`，
   Stripe / Paddle 的文档 URL 后面加 `.md` 能拿到 markdown 版本。
6. **共享工作区有并发 agent**：`git commit` 一律带**显式 pathspec**，
   新建文件先 `git add`。改 `package.json` 时用 `git show HEAD:package.json` 作基线，
   因为工作区那份带着别的 agent 未经核实的改动。
7. **`packages/ai` 里 `assertEnableable` 在工厂里就调用**，不是等第一次 `invoke` ——
   所以 `managed` 模式**构造就会抛**，别指望捕获在调用点。

---

## 10. 一句话给接手的人

**别写新功能。先清两个"实现了但没人调用"的件，顺序按代价排：**

1. **先补闸门** —— `retainValidConsents` 接进 `AiSettings`（§3.4）。
   这是隐私闸门上的缺口，**错了的代价最大**。
2. **再把护城河接上界面** —— `memory.ts` 的「专注落差」（§3.1–3.3）。
   这是唯一"别人抄不走"的东西，现在躺在库里没人调用。

四个功能已经端到端可达、有门禁钉着、有真实端点验证过 —— **这部分不用你重做**。
但按本仓库自己的判据（**去数一数这个函数被谁调用**），
上面那两件**等于没做**。
