# 模块 1 任务书：AI 引擎层正确性与孤立分支治理

> 状态：✅ **已执行**（2026-09-27）—— ⚠️ **不要再照这份任务书做一遍。**
> 模块 1 的产出是**对抗性验证，不是新代码**：任务书 §3.1–§3.5 的修复在分叉点之前
> 就已落在 `main` 上，所以合并提交 `06d7be3` 是 **0 文件变更** —— 那不是"空跑"，
> 而是**任务书发出时工作已经做完**（分叉 tag `ai-remediation-fork`）。
> 适用对象：**一个 AI 执行者**（本文即提示词，可直接整篇粘贴给该 AI）
> 上游审计：[`ai-gap-audit-and-remediation.md`](ai-gap-audit-and-remediation.md)
> 并行模块：模块 2（Web 旅程）、模块 3（记忆护城河）——**不要碰它们的文件**
> 🟢 **可以独立跑完，不需要等另外两个模块。** 开工命令、租约门禁（可执行的白名单）、
> 以及"缺一个跨模块符号怎么办"的三条路，见
> [`ai-remediation-parallel-runbook.md`](ai-remediation-parallel-runbook.md)。
> 你的 worktree：`.worktrees/ai-m1`，分支 `feat/ai-module-1-engine`，分叉点 tag `ai-remediation-fork`。

---

## 0. 你是谁、要做什么

你是一个仓库的**引擎层**修复者。仓库是 heyta（本地优先的任务应用，pnpm monorepo）。
你要清理 `packages/ai` / `packages/local-api` / `packages/app-host` 三个引擎包里
**"有代码路径没测试、有符号没人调用、有原因码没文案"** 的问题。

**一句话验收**：这三个包的对外行为语义**不变**（除了让一条错误文案变具体），
但"沉默的坏东西"全部被摆到明面上。

---

## 1. 硬性边界（违反即失败）

### 1.1 写入白名单（只能改这些）

- `packages/ai/src/**`
- `packages/ai/tests/**`
- `packages/local-api/src/**`
- `packages/local-api/tests/**`
- `packages/app-host/src/**`
- `packages/app-host/tests/**`

### 1.2 只读（**绝对不许改**）

- `apps/**`（包括 `apps/web`、`apps/mobile`）—— 界面层属于模块 2
- `packages/domain/**` —— 属于模块 3
- `packages/i18n/**` —— 属于模块 2
- `e2e/**`、`scripts/**`、`research/tools/**`
- `docs/adr/**`
- `pnpm-lock.yaml`、`package.json`（新增依赖一律禁止）

需要别人做的事（例如"界面要消费这个新原因码"）**写进你的交付报告**，不要自己动手。

### 1.3 禁止的手段

- `it.skip` / `it.only` / `it.todo` / 删测试 / 放宽已有断言
- `|| true` / 改门禁脚本 / 改阈值 / 把失败改成跳过
- mock 掉被测层（HTTP 边界可以用注入 `fetchImpl`，那是边界之外）
- 新增运行时依赖
- 大规模重构、重命名、格式化（**只做本任务书列出的项**）

---

## 2. 环境与基线

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
```

**基线数字（必须守住）**：

| 范围 | 文件 | 通过 | 跳过 |
|---|---|---|---|
| `@heyta/ai` | 4 | 144 | 0 |
| `@heyta/local-api` | 3 | 79 | 0 |
| `@heyta/app-host` | 16 | 399 | 0 |

- `pnpm check` 当前 **exit 0**，整改后必须仍 exit 0。
- 只允许**通过数增加、跳过数不增**。

**环境陷阱**：并发构建会偶发
`Cannot find module .../packages/design-system/dist/chunk-*.js`（构建竞态，重跑即可，
不是你的错也不是真失败）。工作区有**并发 agent** 在改，所以提交必须用显式 pathspec：

```bash
git add <具体文件> && git commit -m "<msg>" -- <具体路径>
```

---

## 3. 任务清单（按顺序做，做完一项就更新进度）

### 任务 1：给 `endpoint-disabled` 补专属文案

**位置**：`packages/ai/src/routing.ts` 的 `explainNoCandidate`。

**现状**：它对 `remote-not-allowed` / `circuit-open` / `endpoint-url-rejected` /
`capability-missing` / `endpoint-missing` 都给了具体句子，
**唯独 `endpoint-disabled` 落到兜底句**「没有可用的端点。检查设置里的端点与路由。」

**为什么是问题**：被停用是**用户的主动选择**，而兜底句会把人引去检查
"端点是否存在、地址是否合法"——两个根本没问题的方向。这与该文件里
其它分支的注释精神（"用户遇到的最常见原因其实是忘了声明能力，
粗粒度文案会把人引去查两个根本没问题的地方"）直接矛盾。

**做法**：加一个分支，句子要说明"这是你（或配置）主动停用的，不是故障"。

**验收（必须红→绿）**：
1. 先在 `packages/ai/tests/routing.spec.ts` 加一条测试：构造一个
   `disabled: true` 的端点作为唯一候选，断言 `resolveRoute` 的
   `excluded` 含 `endpoint-disabled`，且 `explainNoCandidate` 的产物
   （通过公开 API 拿到的那句话）**不等于**兜底句。
   > 提示：`explainNoCandidate` 是私有函数。请通过 `resolveRoute` 后
   > 走 `invokeRouted` 的失败 `message`，或调用该文件里导出的等价公开入口，
   > **不要**为了测试把私有函数导出（那会扩大包对外面）。
2. 贴出**加分支之前**该测试失败的输出（红）。
3. 加分支，贴出通过输出（绿）。

---

### 任务 2：钉住四个"只断言了失败、没断言原因"的分支

这些测试现在只证明"它失败了"，不证明"它因为正确的原因失败"——
换个失败原因它们照样绿。

| # | 分支 | 测试位置 | 现状 |
|---|---|---|---|
| 2a | `validateEndpointUrl` 的 `unparseable` | `packages/ai/tests/routing.spec.ts` | 只断言 `ok === false` |
| 2b | `validateEndpointUrl` 的 `bad-scheme` | 同上 | 只断言 `ok === false` |
| 2c | `AiConfigError` 的 `endpoint-required` / `endpoint-invalid` | `packages/ai/tests/egress.spec.ts` | 只断言 `toThrow(AiConfigError)` |
| 2d | `validateLocalApiConfig` 的 `bad-port` | `packages/local-api/tests/*.spec.ts` | 只断言 `ok === false` |

**做法**：把每条测试补成断言**具体 reason**。
若发现某个 reason 实际上不可达/形状不对，**不要编造**——
在交付报告里写清楚，并给出证据。

**验收**：四个分支各自断言到 `reason` 字段；把每个断言改回"只断言失败"
时测试会红（可以只对其中一条演示红→绿，其余说明理由）。

---

### 任务 3：处置死联合成员 `consent-required`

**位置**：
- `packages/ai/src/egress.ts` 的 `EgressDecision`
- `packages/ai/src/supply.ts` 里 `AiConfigError` 的 reason 联合

**证据**：`egress.ts` 自己的注释写着
「`consent-required`：目的地是本地（`none`）→ **不需要授权**，这个 reason 不会出现」，
而 `authorizeEgress` 只有两个 return：`allowed: true` 或
`reason: 'consent-missing'`。全仓 grep 也确认没有任何地方构造它。

**做法（二选一，必须给理由）**：
- **(A) 收敛类型**：从联合里删掉 `consent-required`，并同步更新注释/
  架构文档里引用它的地方（架构文档是只读的，所以只改**代码里的注释**）。
- **(B) 保留并钉住**：写一条测试明确断言"本地目的地永不产生该 reason"，
  并在类型旁注明它为何保留（例如为了未来分支）。

**验收**：类型收敛时 `pnpm --filter @heyta/ai typecheck` 通过；
选 (B) 时新测试存在且能红→绿。**无论选哪个，交付报告都要写清选了什么、为什么。**

---

### 任务 4：给 `cause` 加直接断言

**位置**：`packages/app-host/tests/ai-{breakdown,capture,prioritize,duration}.spec.ts`

**证据**：`grep -c "cause" packages/app-host/tests/ai-*.spec.ts` → **0**。
`cause` 是 `packages/ai` 把具体原因码带给界面词条的**唯一通道**，
现在只被 web 层一条文案间接覆盖。重构一旦丢掉 `cause`，app-host 层不会变红。

**做法**：至少对以下场景各加一条断言，钉住 `outcome.cause` 等于
`packages/ai` 的 `AiFailureReason` 里的**预期取值**：
- 没配端点 → `no-route`（或该场景实际对应的值，**以实测为准，不要凭猜**）
- 需要出境授权但没给 → `egress-not-authorized`
- 首选失败且回退跨隐私边界 → `fallback-needs-consent`

**验收**：断言真实通过（不是"只要是非 undefined 就行"——
必须是**具体字面量**）。若某个场景实际拿不到 `cause`（例如在到达路由前就返回），
如实在报告里写明，**不要**为了凑数改产品代码去制造 `cause`。

---

### 任务 5：孤立分支与死代码处置（本模块最重要的一项）

对下表**每一项**给出处置，并在代码里落实。**三种处置选一**：

- **删除**：只有在"没有任何测试依赖 + 没有任何门禁依赖 + 不属于公开 API 的必要面"时才允许。
- **保留并标注**：加注释说明它是历史路径/测试专用/未来预留，并在架构文档
  （只读，所以写进交付报告）里登记。
- **接线**：让它真正进入生产路径（仅当你能证明这是明显缺失的一环，且不越界改 `apps/**`）。

| 符号 | 位置 | 已知约束 |
|---|---|---|
| `createProvider()` | `packages/ai/src/provider.ts` | ⚠️ `packages/ai/tests/egress.spec.ts` 与 `apps/web/tests/ai-failure-copy.spec.tsx` **依赖它**。`apps/**` 只读 → 不能改那个 web 测试 → **不能直接删** |
| `assertEnableable()` | `packages/ai/src/supply.ts` | 只被 `createProvider` 调用 → 生产不可达。它是 `managed` 的**安全闸门**，删它等于删一个隐私保护 |
| `previewDisclosure()` / `EGRESS_ORDER_NOTE` | `packages/ai/src/provider.ts` | 零生产调用点 |
| `describeRouteIntent()` | `packages/ai/src/routing.ts` | 零调用点、**零测试** |
| `findPreset()` / `presetDestinations()` | `packages/ai/src/presets.ts` | 界面直接用 `AI_ENDPOINT_PRESETS` |
| `describeEndpointHealth()` | `packages/ai/src/health-store.ts` | 界面已改用 `endpointHealthDisclosure()` 取词条（正确做法） |
| `removeDurationFromNote()` | `packages/app-host/src/duration-note.ts` | 只有测试 |
| `AiEndpointConfig.disabled` | `packages/ai/src/routing.ts` | **有读无写**：过滤会真的跳过它，但 UI/CLI 都不写 |
| `AiRouteTarget.model` | `packages/ai/src/routing.ts` | **有读无写** |
| `vision` / `tool_calling` | `packages/ai/src/routing.ts` 的能力词表 | 四个功能一个都不要求 |

> ⚠️ **上表是任务书发出当日的快照，保留不改 —— 但有一行今天已经不成立**：
> `describeRouteIntent()` 那一格写着「零调用点、**零测试**」，而它**现在有测试了**
> （`packages/ai/tests/routing.spec.ts`）。"零生产调用点"仍成立，且按本任务书的裁决
> **是刻意保留**（壳走 `apps/web/src/features/ai/route-explanation.ts` 的
> `resolveFeatureRoute()` —— 理由见 `ai-architecture.md` §5.7）。
> 别再把它当成"待清理的死代码"。

**关键判断（请认真做，不要敷衍）**：

- `createProvider` 与 `describeRouteIntent` 的处置**不是"删了就干净"**。
  真正的问题是：**文档把 `createProvider` 描述成生产的执行点，
  而生产实际走 `invokeRouted`** —— 同一件事两套实现。
  你**不必**合并它们（那超出本任务），但**必须**让状态不再自相矛盾：
  可行做法是给 `createProvider` 加一段"这是本地/测试与历史路径，
  生产的出境执行点是 `invokeRouted`"的准确注释，并在报告里登记文档漂移。
- `disabled` 与 `model` 这两个"有读无写"字段：**本轮的结论已经定死**——
  **两个字段都保留**（`disabled` 是真实的"停用端点"安全能力；`model` 是预留的逐功能模型覆盖），
  你要做的是：给它们加**准确注释**说明"当前生产无写入者"，
  并在交付报告里登记"缺一个生产者"。
  **生产者由模块 2（设置页开关）负责 `disabled`；`model` 的生产者推迟到产品决策之后。**
  **不要删字段**（删了会和模块 2 撞车，且属于能力倒退）。
- `vision` / `tool_calling`：如果确认无功能使用且不影响 `AiCapability` 的
  对外契约，收敛词表；否则在词表旁注释"当前无功能要求它们"。

**验收**：
1. 每一项在**交付报告**里有一行结论：`符号 → 删除 / 保留+标注 / 接线 → 理由`。
2. 选择"删除"的项：`pnpm --filter <包> test` + `typecheck` 全绿，
   且 `node scripts/check-ai-coverage.mjs` exit 0。
3. 选择"保留"的项：代码里有与结论一致的注释。

---

## 4. 交付报告格式（必须按此结构写在你的最终回复里）

```
## 一、改了什么
<逐文件 + 一句话>

## 二、红→绿证据
<每个修复贴失败输出与通过输出>

## 三、死代码/孤立分支处置表
| 符号 | 处置 | 理由 | 证据 |

## 四、测试数字
| 范围 | 基线 | 现在 | 跳过 |
（只允许 >= 基线、跳过 <= 基线）

## 五、门禁
pnpm check exit code：
check-ai-coverage exit code：

## 六、未核实 / 需要别人做的事
<例如：界面需要消费新的 endpoint-disabled 文案 → 交给模块 2>

## 七、文档漂移登记（只报告，不改文档）
<你发现的、与本模块相关的文档与代码不一致处>
```

---

## 5. 停止条件

- 做完任务 1–5，或
- 遇到**无法在白名单内解决**的阻塞（例如必须改 `apps/**`），或
- 你发现本任务书的某条结论**与代码不符**。

后两种情况：**不要硬做**。把已完成的做完并提交，
在报告里写清阻塞点与证据，然后停止。

**不许**为了让数字好看而放宽任何东西。
"没做完但说清了"是合格交付，"做了但更糟"是失败。
