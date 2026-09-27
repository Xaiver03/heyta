# 模块 2 任务书：AI 用户旅程闭环与"界面说真话"

> 状态：✅ **已执行并并入 `main`**（merge commit `0614475`，8 文件 / +489，2026-09-27）。
> ⚠️ 任务书原文保留不改（它是当时的提示词）；**不要再照它重做一遍**。
> 适用对象：**一个 AI 执行者**（本文即提示词，可直接整篇粘贴给该 AI）
> 上游审计：[`ai-gap-audit-and-remediation.md`](ai-gap-audit-and-remediation.md)
> 并行模块：模块 1（引擎层）、模块 3（记忆护城河）——**不要碰它们的文件**
> 🟢 **可以独立跑完，不需要等另外两个模块。** 开工命令、租约门禁（可执行的白名单）、
> 以及"缺一个跨模块符号怎么办"的三条路，见
> [`ai-remediation-parallel-runbook.md`](ai-remediation-parallel-runbook.md)。
> 你的 worktree：`.worktrees/ai-m2`，分支 `feat/ai-module-2-journey`，分叉点 tag `ai-remediation-fork`。

---

## 0. 你是谁、要做什么

你负责 heyta（本地优先的任务应用，pnpm monorepo）的 **Web 界面层**。
已经做完的事：四个 AI 功能（一句话捕获 / 拆解 / 优先级建议 / 估时）端到端可达、
出境授权与目的地绑定、披露三步（发给谁/发什么/留多久）、熔断与健康回写。

**你这一轮要解决的是"用户体验的最后一段"**：

1. 🔴 **一个真实缺陷**：英文界面会露出中文（估时依据那一块）。
2. 🟡 用户看到"没有可用端点"时，**界面说不出真实原因**，还会把人指向错误的方向。
3. 🟡 需要出境授权时，界面只说"你需要先授权"，**没有直达授权的路**。
4. 🟡 "停用端点"这个能力在引擎里存在，**界面上没有开关**。

**一句话验收**：用户在任何"AI 不能用"的状态下，**在界面内**就能知道
"为什么不能用、下一步点哪里"，而且**英文界面里没有一个中文字**。

---

## 1. 硬性边界（违反即失败）

### 1.1 写入白名单（只能改这些）

- `apps/web/src/features/ai/**`
- `apps/web/src/features/settings/**`（`AiSettings.tsx`、`aiStore.ts`、以及你要新建的文件）
- `apps/web/src/App.tsx`
- `apps/web/tests/**`
- `e2e/tests/ai-*.spec.ts`、`e2e/tests/helpers.ts`
- `packages/i18n/src/locales/zh-CN.ts`、`packages/i18n/src/locales/en.ts`

### 1.2 只读（**绝对不许改**）

- `packages/ai/**`、`packages/app-host/**`、`packages/local-api/**` —— 属于模块 1
- `packages/domain/**` —— 属于模块 3
- `packages/i18n/src/{index,translate,types,react}.tsx`（**只许改 locales 下的两个词条文件**）
- `scripts/**`、`research/tools/**`、`docs/adr/**`
- `pnpm-lock.yaml`、`package.json`（禁止新增依赖）

### 1.3 三条来自本仓库历史的铁律（都踩过坑）

1. **事实源只能有一个**：出境授权的判定与写入**只允许**走
   `AiSettings.tsx` 里已有的 `updateRouting` / `retainValidConsents` 路径。
   **不许**在 AI 面板里再写一套授权逻辑（上一轮刚修过同类问题）。
2. **不许渲染领域层拼好的中文**：任何来自 `@heyta/domain` 的
   `summary` / `evidence` / `describe*` 字符串都**不得**直接渲染。
   要用结构化事实 + `t()` 词条。（模块 3 也会处理同类问题。）
3. **不许新增必填持久化字段**：`CURRENT_SCHEMA_VERSION` 保持 1；
   新增持久化字段必须可选 + 运行时默认值。

### 1.4 禁止的手段

`it.skip` / `it.only` / `it.todo` / 删测试 / 放宽断言 / `|| true` /
改门禁脚本或阈值 / mock 被测层（HTTP 边界可以注入 `fetchImpl`）。

---

## 2. 环境与基线

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
```

| 范围 | 基线 | 要求 |
|---|---|---|
| `@heyta/web` 测试 | 25 文件（23 通过 + 2 跳过）/ 479 通过 / 12 跳过 | 通过数 **≥ 479**，跳过数 **≤ 12** |
| e2e | 13 条通过 | 不许减少 |
| `pnpm check` | exit 0 | 仍 exit 0 |
| `web.ai.*` 词条 | zh 218 / en 218 | **两边新增数量必须相等** |
| `check-ui-language` | exit 0 | 仍 exit 0 |

**环境陷阱**：并发构建偶发 `Cannot find module .../design-system/dist/chunk-*.js`
（构建竞态，重跑即可）。工作区有**并发 agent**，提交必须用显式 pathspec：

```bash
git add <具体文件> && git commit -m "<msg>" -- <具体路径>
```

---

## 3. 任务清单（按优先级，做完一项更新进度）

### 任务 1 🔴 P0：修掉英文界面泄中文

**缺陷位置**：`apps/web/src/features/ai/AiDuration.tsx` 的"估时依据"列表，
直接渲染了 `{hint.summary}`。

**为什么是缺陷**：`packages/domain/src/preference-hints.ts` 里
`PreferenceHint.summary` 的注释写着它是"中文投影"，
而 `PreferenceHint.facts` 的注释写着：
「🔴 结构化事实。**壳必须用这个取自己的词条**，不要渲染 `summary`
—— 那是领域层拼好的中文，英文界面会露中文（第 14 轮修的就是这个）。」

同仓库的 `apps/web/src/features/settings/MemoryPanel.tsx` 已经做对了：
它用 `preferenceEvidenceCopy(preference.evidenceFacts, t)` 把事实映射成词条。
**照抄这个模式**（`preference-copy.ts` 里已有可直接复用的映射函数）。

**做法**：
1. 把 `{hint.summary}` 换成"用 `hint.facts` + `t()` 渲染"。
2. 优先复用 `apps/web/src/features/settings/preference-copy.ts` 的现有函数；
   若它不导出你需要的形式，**新增导出**而不是复制一份逻辑。
3. 检查四个 AI 组件里**是否还有别处**直接渲染领域层字符串
   （grep `summary`、`evidence`、`describe` 在 `apps/web/src/features/ai/` 下的用法）。
   发现一处修一处。

**验收（必须红→绿）**：
1. **先加测试**：在 `apps/web/tests/ai-duration.spec.tsx` 里加一条
   「英文界面 + 有偏好」的断言：以英文 render 且传入带偏好的
   `preferenceSet`，断言"估时依据"区域**不包含任何 CJK 字符**。
   > 现有 test helper 里带 `preferenceSet` 的用例全部走默认中文渲染，
   > 这正是它漏掉这个 bug 的原因。请顺手为**其它三个组件**也补同类断言
   > （能补几个补几个，至少 `AiDuration` + `AiBreakdown`）。
2. 贴出**修复前**该测试失败的输出（红）。
3. 修复后贴出通过输出（绿）。

---

### 任务 2 🟡 P1：让界面说出"为什么没有可用端点"

**现状**：四个组件各自调用 `resolveRoute(...)`，但**只取** `resolution.candidates[0]`，
`resolution.excluded` **从不被读**。于是当候选全被排除时，界面只显示
「还没有给「X」配置端点。去「设置」里添加端点并指定路由。」
而真实原因可能是：

| `CandidateExclusionReason` | 真实原因 | 用户该做什么 |
|---|---|---|
| `remote-not-allowed` | 端点全在设备外，但"允许远程端点"没开 | 去开闸 2 |
| `capability-missing` | 没有端点声明所需能力 | 去勾能力 |
| `circuit-open` | 端点连续失败被熔断 | 等，或修端点 |
| `endpoint-disabled` | 端点被停用 | 去启用 |
| `endpoint-url-rejected` | 地址没通过校验 | 改地址 |
| `endpoint-missing` | 路由指向了不存在的端点 | 配置损坏 |

**好消息**：`RouteResolution` 与 `CandidateExclusionReason` **已经由
`packages/ai` 导出**（`resolveRoute` 也在用），所以你**不需要**改 `packages/ai`。

**做法**：
1. 抽一个**共用**的"把 `excluded` 翻译成人话 + 下一步"的模块
   （例如 `apps/web/src/features/ai/route-explanation.ts`），
   输入 `RouteResolution`，输出 `{ key: MessageKey, params?, action?: 'settings' }`。
   ⚠️ **四个组件必须共用这一份**——不要各写一套（本仓库对"同一件事两套实现"
   有明确纪律）。
2. 在四个组件的 `no-target` 分支渲染该解释，并给出**下一步按钮**（见任务 3）。
3. 注意：`candidates` 非空时**不要**用解释替换正常流程——只处理"一个候选都没有"。

**验收**：
- 每个 reason 至少一条组件测试，断言渲染出的是**该 reason 的专属文案**，
  而不是通用文案。
- **一条 e2e**（推荐）：用 `e2e/tests/helpers.ts` 的 `configureEndpoint` 配一个
  **只勾 `structured_output`、不勾 `long_context`** 的回环端点，把 `breakdown`
  路由给它（`helpers.ts` 的注释明确说过这种配法"会让拆解永远没有候选"）。
  任务行里的拆解入口应当显示**能力缺失**的专属说明，而不是"还没有配置端点"。
  > e2e 里的中文文案断言直接写中文（现有 e2e 就是这么写的）。

---

### 任务 3 🟡 P1：给"下一步"一条真实可点的路

**现状**：
- 需要出境授权时，失败文案只有「该功能需要你先授权数据出境。」
  （`zh-CN.ts` 的 `web.ai.failure.cause.egressNotAuthorized`），**没有按钮**。
- "没有可用端点"时**不渲染发送按钮**，用户只能取消后自己去设置页找。

**做法**（`App.tsx` 归你，所以这不越界）：

1. 在 `App.tsx` 给四个 AI 组件传一个"打开设置并定位到相关区块"的回调
   （例如 `onOpenSettings(target?: 'endpoints' | 'remote' | 'consent' | 'capability')`）。
2. 回调实现：`setView('settings')` + 把 `target` 传给 `AiSettings`。
3. `AiSettings` 收到 `target` 后**滚动/高亮**对应区块
   （`data-testid` 已存在：`feature-<name>`、`consent-<name>`、端点行等）。
4. 在失败态与 `no-target` 态渲染"去设置"按钮，调用它。

**🔴 红线**：授权**只能**通过 `AiSettings` 已有的 `updateRouting` / `grant()` 路径完成。
**不许**在 AI 面板内直接改 `consents`（那会造成第二套事实源，
正是上一轮刚修掉的 bug 形状）。所以你只做"导航"，不做"代授权"。

**验收**：
- 组件测试：未授权时点"去设置"→ 断言回调被调用且 target 正确。
- 组件测试：`capability-missing` 时点"去设置"→ target 是 `capability`。
- 若时间允许，e2e 补一条"点去设置 → 落在设置页且对应区块可见"。

---

### 任务 4 🟡 P1：给 `AiEndpointConfig.disabled` 补一个生产者

**现状**：`packages/ai/src/routing.ts` 的候选过滤会**真的跳过**
`disabled: true` 的端点，但全仓**没有任何地方写这个字段** ——
UI 没有开关，CLI 也不写。于是"停用端点"这个能力只有读、没有写。

**跨模块契约（已定死）**：模块 1 **保留**该字段并加注释；
**生产者由你补**。所以请你实现它。

**做法**：
1. 在 `AiSettings.tsx` 的每个端点行加一个"停用 / 启用"开关
   （给一个稳定的 `data-testid`，例如 `endpoint-<id>-disabled`）。
2. 写入**必须**走已有的单一路由写入口 `updateRouting(next)`
   （它负责 `retainValidConsents` 的重算与落盘）。**不要**另开一条写路径。
3. 停用后界面要如实反映：该端点若仍被某功能路由指向，应提示
   "该功能当前没有可用端点（端点已停用）" —— 与任务 2 的解释共用同一份逻辑。
4. ⚠️ 停用**不改变目的地**，所以不需要重算授权；但**不要**顺手清掉授权
   （清掉会在重新启用后再要一次，属于体验倒退）。若你认为必须清，请在报告里论证。

**验收**：
- 组件测试：点停用 → `loadAiSettings()` 里该端点的 `disabled` 为 `true`；
  再点启用 → 为 `false`（或字段被移除，按你的实现）。
- 组件测试：停用唯一端点后，该功能的界面解释用的是 `endpoint-disabled` 文案。
- `@heyta/web` 测试数增加。

---

### 任务 5 ⚪ P2（可选，做完前四个再说）："已应用"反馈

**现状**：`AiCapture` 的"已应用"标记只在组件内存里（`AiCapture.tsx` 里的
`applied` 状态），**刷新即消失**。数据没丢，只是没有反馈。

**规则**：
- **只有当它不需要新增持久化字段时**才做（例如用本会话内的 store/内存）。
- 如果需要新增持久化字段 → **不要做**，把它写进交付报告的"需要人决策"一节。
- 这一项**不许**挤占前四个任务的时间。

---

## 4. i18n 纪律（贯穿所有任务）

- 所有**新增**用户可见文案都进 `packages/i18n/src/locales/{zh-CN,en}.ts`，
  且在**两个文件里都加**（zh/en 新增数量必须相等）。
- **追加式修改**：只许在文件内追加新 key，**不许移动、重排、重命名**已有 key
  （另一个模块也在追加，重排会造成无意义冲突）。
- 用 `web.ai.*` 命名空间（不要动 `common.ai.*`，那是一次独立的迁移，不在本轮）。
- 完成后必须实跑：

```bash
node scripts/check-ui-language.mjs   # 必须 exit 0
```

---

## 5. 交付报告格式（必须按此结构写在你的最终回复里）

```
## 一、改了什么
<逐文件 + 一句话>

## 二、红→绿证据
任务 1（i18n 泄漏）：<失败输出> → <通过输出>
任务 2/3/4：<每条新测试的意图与结果>

## 三、测试数字
| 范围 | 基线 | 现在 | 跳过 |
@heyta/web：479 → ? ；跳过 12 → ?
e2e：13 → ?
web.ai.* 词条：zh 218 → ? ；en 218 → ?

## 四、门禁
pnpm check exit code：
check-ui-language exit code：
check-ai-coverage exit code：

## 五、未核实 / 需要别人做的事
## 六、需要人决策的事项
```

---

## 6. 停止条件

做完任务 1–4（任务 5 可选），或遇到**白名单内解决不了**的阻塞，或
**发现本任务书的某条结论与代码不符**。

后两种：不要硬做。做完已完成的、提交、在报告里写清阻塞与证据，然后停止。

**不许**为了让数字好看而放宽任何东西。
"没做完但说清了"是合格交付，"做了但更糟"是失败。
