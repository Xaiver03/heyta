# 模块 3 任务书：把"记忆护城河"接到用户眼前

> 状态：**规划中**
> 适用对象：**一个 AI 执行者**（本文即提示词，可直接整篇粘贴给该 AI）
> 上游审计：[`ai-gap-audit-and-remediation.md`](ai-gap-audit-and-remediation.md)
> 并行模块：模块 1（引擎层）、模块 2（Web 旅程）——**不要碰它们的文件**
> 🟢 **可以独立跑完，不需要等另外两个模块。** 开工命令、租约门禁（可执行的白名单）、
> 以及"缺一个跨模块符号怎么办"的三条路，见
> [`ai-remediation-parallel-runbook.md`](ai-remediation-parallel-runbook.md)。
> 你的 worktree：`.worktrees/ai-m3`，分支 `feat/ai-module-3-memory-moat`，分叉点 tag `ai-remediation-fork`。

---

## 0. 你是谁、要做什么

你负责 heyta（本地优先的任务应用，pnpm monorepo）的**记忆事实层接线**。

**已经做完、而且做得很好的一件事**：`packages/domain/src/memory.ts` 里
已经实现了这套算法 —— 它从事件流里数出"一条任务被推迟过几次"、
从专注记录里算出"实际投入了多少分钟"、再和用户**自己声明的**重要性对比，
得出「你说的 vs 你做的」落差。它有完整的单测。

**缺的那一步**：**没有任何生产代码调用它**。用户完全看不到这个能力。
架构文档里把它称作护城河，而现状是"实现了、测了、没人用" ——
这正是本仓库反复栽的那个坑。

**你这一轮的任务**：把它接到界面上，并且**不重蹈两个已知陷阱**：
- 不许渲染领域层拼好的中文（英文界面会露中文）；
- 不许在记忆关闭时还展示推断（隐私开关必须真的关得掉）。

**一句话验收**：用户打开设置里的记忆面板，能看到"哪些嘴上说重要的事、
实际没投时间"，**每条都带结构化依据**；关掉记忆开关后，**一行推断都不显示**；
英文界面里**没有一个中文字**。

---

## 1. 硬性边界（违反即失败）

### 1.1 写入白名单（只能改这些）

- `packages/domain/src/memory.ts`
- `packages/domain/src/preference-hints.ts`（仅限任务 6 提到的那一项）
- `packages/domain/tests/memory.spec.ts`
- `apps/web/src/features/settings/MemoryPanel.tsx`
- `apps/web/src/features/settings/preference-copy.ts`
- `apps/web/src/App.tsx`（⚠️ **与模块 2 共享**，见 §1.4）
- `apps/web/src/lib/oplog.ts`（仅在需要暴露"读取全部 op"时）
- `apps/web/tests/memory-panel.spec.tsx`
- `packages/i18n/src/locales/zh-CN.ts`、`packages/i18n/src/locales/en.ts`

### 1.2 只读（**绝对不许改**）

- `packages/ai/**`、`packages/app-host/**`、`packages/local-api/**` —— 属于模块 1
- `apps/web/src/features/ai/**`、`apps/web/src/features/settings/AiSettings.tsx`、
  `apps/web/src/features/settings/aiStore.ts`、`e2e/**` —— 属于模块 2
- `packages/domain/src/index.ts`（只读；你需要的导出**已经有了**）
- `scripts/**`、`research/tools/**`、`docs/adr/**`
- `pnpm-lock.yaml`、`package.json`（禁止新增依赖）

### 1.3 两条本仓库铁律

1. **不许渲染领域层拼好的中文。**
   `memory.ts` 里的 `describeFocusGaps()` 返回的是**中文句子**
   （它自己的注释也说明它是"句子骨架由确定性模板给出"）。
   ⚠️ **不要渲染它**。要用 `FocusGap` 的**结构化字段** + `t()` 词条自己拼。
   先例：`MemoryPanel.tsx` 已经用 `preferenceEvidenceCopy(facts, t)` 对偏好做了同样的事；
   `packages/domain/src/preference-hints.ts` 的 `PreferenceHint.facts` 注释
   把这条规则写得很清楚（"壳必须用这个取自己的词条，不要渲染 summary"）。
2. **隐私开关 fail-closed。** `memoryEnabled === false` 时，
   面板**只能**显示"记忆已关闭"的说明，**零条推断**。
   判断必须是 `=== true` 这种严格方向（缺字段 = 关），不要写成 `!== false`。

### 1.4 `App.tsx`：**你不改它**（它不再和模块 2 并行共享）

`App.tsx` 的**唯一 owner 是模块 2**，你的租约里已经不含它（见 runbook §1 R3）。
此前这里写的是"两个模块不许并行改同一分支，合并顺序 1 → 2 → 3" ——
那条规则就是"必须等前一个做完才能开工"的来源，已删除。

你要的 `focusGaps` 只有三条路，**都要靠接口先行，不靠等**：

1. **在 `MemoryPanel` 里自己订阅**（首选）。它本来就是 Web 组件，
   读 store / op-log 是它自己的事 —— 这样 `App.tsx` 一个字节都不用动。
2. **用已经存在的 prop 接进去**：`App.tsx` 已经给 `MemoryPanel` 传了
   `memoryEnabled` 等既有 prop，先看能不能复用。
3. **需要新 prop 时**：在报告里写清"需要模块 2 在 `App.tsx` 预埋一个 `focusGaps`"，
   **然后继续做别的**。预埋由模块 2 owner 一次提交在分叉点之前，它就不再是冲突。

🔴 三条路都不通、又非改 `App.tsx` 不可时：**停下来**，在报告里说明，
不要自己动手，也不要停在半路等另一个模块。

### 1.5 禁止的手段

`it.skip` / `it.only` / `it.todo` / 删测试 / 放宽断言 / `|| true` /
改门禁脚本或阈值 / mock 被测层 / 新增必填持久化字段
（`CURRENT_SCHEMA_VERSION` 必须保持 1）。

---

## 2. 环境与基线

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
```

| 范围 | 基线 | 要求 |
|---|---|---|
| `@heyta/domain` | 14 文件 / 395 通过 / 0 跳过 | 通过数 **≥ 395** |
| `@heyta/web` | 25 文件（23+2）/ 479 通过 / 12 跳过 | 通过数 **≥ 479** |
| `pnpm check` | exit 0 | 仍 exit 0 |
| `web.memory.*` 词条 | zh / en 数量必须**相等** | — |
| `check-ui-language` | exit 0 | 仍 exit 0 |

**环境陷阱**：并发构建偶发 `Cannot find module .../design-system/dist/chunk-*.js`
（构建竞态，重跑即可）。工作区有**并发 agent**，提交必须用显式 pathspec：

```bash
git add <具体文件> && git commit -m "<msg>" -- <具体路径>
```

---

## 3. 你需要知道的现有代码形状（已核实，行号会漂移）

### 3.1 算法入口（`packages/domain/src/memory.ts`）

```ts
export interface MemoryInput {
  tasks: readonly MemoryTask[];
  focusSessions: readonly MemoryFocusSession[];
  /** op-log 事件流。**推算推迟次数必需** */
  operations: readonly MemoryOp[];
  /** 当前时间（epoch ms）。由调用方传入，保证可测。 */
  now: number;
}

export function computeTaskMemory(input: MemoryInput): TaskMemory[];
export function computeFocusGaps(input: MemoryInput, options?: FocusGapOptions): FocusGap[];
export function describeFocusGaps(gaps: readonly FocusGap[]): string; // ⚠️ 中文，别渲染
```

```ts
export interface FocusGap {
  taskId: string;
  title: string;
  declared: number;        // 声明的重要性 0–4（"嘴上说的"）
  focusMinutes: number;    // 实际专注分钟（"实际做的"）
  gap: number;             // 落差分，> 0 才算落差
  overdueDays: number | null;
  postponements: number;   // 推迟过几次
}
```

`computeFocusGaps` 只返回**确实存在落差**的条目，按落差从大到小排序。
默认门槛：`minDeclared = 2`、`lowAttentionMinutes = 25`。

### 3.2 op-log 事件流从哪来（这是本任务的**主要技术难点**）

- `apps/web/src/lib/oplog.ts` 里有 `requireStore(): IndexedDbOpLogStore<Operation<string>>`。
- `OpLogStore` 有 `getOpsSince(sinceSeq: number, limit?: number)` ——
  `getOpsSince(0)` 即"全部 op"。
- `Operation` 的字段**已经包含** `MemoryOp` 需要的全部：
  `opType` / `entityType` / `entityId?` / `payload` / `timestamp`
  （所以结构上是直接兼容的，不需要复杂的转换）。
- ⚠️ **它是异步的**，而 `App.tsx` 现在的 `memory` 是同步 `useMemo`。
  你需要一个 effect 把 op 读进来存进 state，再让 `focusGaps` 跟着它算。
- ⚠️ **性能**：`getOpsSince(0)` 是线性读。请**加一个上限**并写清这个上限
  （例如只取最近 N 条，或按 seq 倒序取一窗口），**并在代码注释里说明截断的含义**。
  这是产品判断，不要默默截断。
- ⚠️ **新鲜度**：`apps/web/src/lib/oplog.ts` 导出了 `onEngineChange(listener)`。
  考虑订阅它，让 op 窗口在写入后保持新鲜，而不是只在挂载时读一次
  （架构文档里记过"数据到了、界面没去看"的同类 bug）。

### 3.3 现在 `App.tsx` 里已有什么

`App.tsx` 已经有一个 `memory` 的 `useMemo`，它已经拿到：
`Object.values(store.entities.tasks)`、`Object.values(store.entities.focusSessions)`，
以及 `{ now: Date.now(), utcOffsetMinutes: ... }`。
**缺的只有 `operations`。** 这是你唯一需要新增的输入。

### 3.4 面板挂在哪

`MemoryPanel` 通过 `AiSettings` 的 `memorySlot` prop 渲染
（在 `App.tsx` 的 `view === 'settings'` 分支里）。你**不需要**改 `AiSettings`。
`MemoryPanel` 现在只接偏好相关的 props —— 你要加 `focusGaps`（或 `tasks`+`operations`）
这类新 prop。**新 prop 请做成可选**，这样现有的单测不会因为缺 prop 而炸。

---

## 4. 任务清单（按优先级，做完一项更新进度）

### 任务 1：面板里加"说的 vs 做的"

在 `MemoryPanel.tsx` 里新增一个区块（放在"我了解到的你"之后、"你已忘记"之前，
或你认为更合适的位置），展示 `computeFocusGaps` 的结果。

**每一条至少要说清三件事**（用结构化字段 + 词条，**不是** `describeFocusGaps`）：
- 哪条任务（`title`）
- 声明了什么（`declared`：可以翻译成"你标为重要/有截止日期"这类可理解的话）
- 实际投入多少（`focusMinutes`）
- 以及**有依据的补充**：`postponements > 0` 时显示推迟过几次、
  `overdueDays !== null` 时显示已逾期几天（这两个是"为什么"的关键）

**空状态必须诚实**：没有落差时，明说"目前没有发现明显的落差"，
**不要**显示一个空白区块（空白会被读成"坏了"）。

**验收**：
1. 组件测试（`apps/web/tests/memory-panel.spec.tsx`）：
   - 有落差时渲染出条目，且包含 title 与关键数字；
   - 无落差时渲染空状态文案（断言的是**专属空状态 key**，不是随便什么文字）。
2. 🔴 **英文界面不出现 CJK**：新增一条测试，
   **以英文 render 且传入落差数据**，断言面板文本**不含任何 CJK 字符**。
   （参考正则：`/[\u4e00-\u9fff]/`。这条测试是本任务的灵魂，
   因为"渲染了领域层中文"正是本仓库已经栽过一次的坑。）
3. 红→绿：先把这条 CJK 测试写出来，让它在你实现之前**红**（如果不会红，
   说明你一开始就用对了方式 —— 那就在报告里说明，并把测试作为**回归护栏**保留）。

### 任务 2：把数据接进去（`App.tsx`）

1. 加一个 effect：从 `requireStore().getOpsSince(...)` 读取 op 窗口 → 存进 state。
2. 在已有的 `memory` memo 里调 `computeFocusGaps({ tasks, focusSessions, operations, now })`。
3. 把结果传给 `MemoryPanel`。
4. 依赖数组要正确：`store.entities`（已有）+ op 窗口 state。

**边界情况必须处理对**：
- store 还没就绪 / 读取失败 → **不要崩**，也不要静默装作"推迟 0 次"。
  选择一种**诚实**的降级（例如：先不展示落差区块，或展示"暂时算不出推迟次数"），
  并把选择写进代码注释与报告。
- `memoryEnabled === false` → **不要计算、不要展示**任何推断（任务 3）。

**验收**：
- 组件/集成测试：传入 ops 后，推迟次数**确实反映**在渲染结果里
  （造一条 `UPD` + `payload.dueDate` 变大的 op，断言界面出现"推迟"相关文案）。
- 如果这条端到端接线无法在单测里稳定覆盖（因为要真 IndexedDB），
  **至少**要有一个测试覆盖"ops → computeFocusGaps → 渲染"中的**后两段**，
  并在报告里写明第一段（真实 IndexedDB 读取）未被覆盖及原因。
  > 注意：仓库里已有 `apps/web/tests/journey-ai-memory.integration.spec.tsx`
  > 使用真实内存版 IndexedDB —— 可以参考它的搭法，但**不要修改它**
  > （它默认整文件跳过，不属于你的任务）。

### 任务 3：记忆关闭时一行推断都不留（隐私红线）

`memoryEnabled === false` 时：
- 面板只显示"记忆已关闭"的说明；
- **不渲染**偏好（已有行为，确认别破坏）；
- **不渲染**任何落差（你新加的部分）；
- 最好连计算都不做（省电且避免任何"算了但没显示"的中间态）。

**验收**：一条组件测试，`memoryEnabled: false` 且**传入了落差数据**，
断言面板内**不存在**任何落差条目的 `data-testid`，且不出现任务标题。

### 任务 4：`describeFocusGaps` 的处置（不要删）

`describeFocusGaps` 现在只在 `memory.spec.ts` 里被用到。它是"事实 → 人话"
的**领域层投影**，与本仓库对偏好做的 `evidence` / `summary` 投影是同构的。

**做法（本任务的结论已定死）**：
- **保留**它（它是领域层的确定性模板，未来可用于非 UI 场景，例如导出/通知）。
- 在它的文档注释里**补一句**："⚠️ 返回的是中文投影，**壳不得直接渲染**；
  界面请用 `FocusGap` 的结构化字段 + 本地化词条。"
- 在交付报告里登记：它是"投影"，不是"界面文案源"。

**不许**为了"清理死代码"删掉它（那会删掉一条本来正确的分层设计）。

### 任务 5：i18n 词条

- 全部新文案进 `packages/i18n/src/locales/{zh-CN,en}.ts`，**两边都加、数量相等**。
- 用 `web.memory.*` 前缀（例如 `web.memory.gap.title`、`web.memory.gap.empty`、
  `web.memory.gap.declared`、`web.memory.gap.focusMinutes`、`web.memory.gap.postponed`、
  `web.memory.gap.overdue`）。
- **追加式**：只许在文件内追加新 key，不许移动/重排已有 key
  （模块 2 也在追加，重排会产生无意义冲突）。
- 完成后实跑 `node scripts/check-ui-language.mjs`（必须 exit 0）。

### 任务 6（小）：`relevantPreferenceIds` 的登记

`packages/domain/src/preference-hints.ts` 的 `relevantPreferenceIds()` 零生产调用点，
只有在 `preference-hints.spec.ts` 里被用来做一致性检查。

**做法**：**保留** + 加一句注释说明它是"一致性检查用的导出，供测试核对
`renderPreferenceHints` 的取值域"。不要删（删了会削弱那条一致性检查）。
在报告里登记即可。

> `packages/domain/src/recall.ts` **不要动**。它是向量库实验的对照组，
> 可能本就只该活在测试里。在报告里登记一句"确认零生产调用，判定为实验对照物，不动"。

---

## 5. 交付报告格式（必须按此结构写在你的最终回复里）

```
## 一、改了什么
<逐文件 + 一句话>

## 二、红→绿证据
英文 CJK 测试：<失败输出> → <通过输出>
推迟次数接线测试：<结果>
记忆关闭测试：<结果>

## 三、测试数字
| 范围 | 基线 | 现在 | 跳过 |
@heyta/domain：395 → ?
@heyta/web：479 → ? ；跳过 12 → ?
web.memory.* 词条：zh ? / en ?

## 四、门禁
pnpm check exit code：
check-ui-language exit code：
check-ai-coverage exit code：

## 五、降级与截断的诚实说明
<op 窗口上限是多少、截断含义、store 未就绪时怎么办>

## 六、未核实 / 需要别人做的事
<例如：App.tsx 与模块 2 的合并冲突、真实 IndexedDB 读取未覆盖>

## 七、登记（死代码判定）
describeFocusGaps / relevantPreferenceIds / recall.ts 的结论
```

---

## 6. 停止条件

做完任务 1–6，或遇到**白名单内解决不了**的阻塞，或
**发现本任务书的某条结论与代码不符**（例如 `getOpsSince` 的形状不是你预期的）。

后两种：不要硬做。做完已完成的、提交、在报告里写清阻塞与证据，然后停止。

**不许**为了让数字好看而放宽任何东西。
"没做完但说清了"是合格交付，"做了但更糟"是失败。
