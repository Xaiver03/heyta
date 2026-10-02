# AI 能力面补齐：从"连不上"到"能使唤"的落地工单

> 状态：**规划中**（§1 三处待拍板未决 ⇒ W8 及之后不得开工；W1–W7 不依赖拍板，可直接进）
> 证据基础：[`dida-ai-assistant-gap-analysis.md`](../research/dida-ai-assistant-gap-analysis.md)（2026-10-02 审计，
> 缺口编号 `AI-G1…AI-G14` 全部在那份里取证，**本文不重复取证、只排工单**）
> 定位纪律：AI 的**策略与顺序**仍以 [`ai-strategy.md`](ai-strategy.md) 为准 —— 本文只是它 §8 信任阶梯的
> **执行拆解**，不是第二份策略。两者冲突时以 `ai-strategy.md` 为准并回来改本文。
> 相关决策：[ADR-0005](../adr/0005-ai-data-path.md)（AI 不写 op + "不做聊天助手"禁令）、
> [ADR-0035](../adr/0035-ai-tool-calling-reuses-local-api.md)（工具调用复用 local-api）、
> [ADR-0010](../adr/0010-ai-config-routing.md)（三道闸与回退边界）、
> [ADR-0013](../adr/0013-cloud-ai-and-maas.md) / [ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md)（托管 AI 的开放条件）

---

## 0. 解决什么 / 明确不解决什么

**解决**：把"用户能不能使唤 heyta 的 AI 干活"这件事，从**今天连不上**推进到**连得上、说的是真话、
且已有零件不再骗判据**。

**明确不解决**：

- 🔴 **不为了对齐滴答而放宽任何一条隐私不变量**。具体不许动的东西：
  AI 类型上产不出 op、`host.submit` 全仓恰好一处、逐工具默认关、出境逐字段披露、
  回退不得跨越隐私边界。任何工单如果以它们为代价，**该工单作废**，不是它们作废。
- **不开托管/云端 AI**。`assertEnableable()` 抛 `retention-undecided` 是**有意的失败**
  （ADR-0013 / ADR-0023），本文一条工单都不碰它。
  ⚠️ 注意排序：审计已确认 `AiSupplyMode` 在 `packages/ai` 之外**零引用**，
  所以它**不是**当前挡用户的闸 —— 别把它当阻塞项去"解"。
- **不做 chat 外壳**，除非 §1 的 D-1 拍成"取代禁令"，且排在 W8 之后。
  理由见审计 §9 D-1 的本文立场：**先解多步，再谈外壳**，顺序反过来会得到一个
  "能聊天但什么都做不了"的助手。

---

## 1. 三处待拍板（阻塞 W8+，不阻塞 W1–W7）

全部原文与证据在审计 §9。这里只写**要拍什么**和**不拍会卡住哪张工单**。

| # | 要拍的 | 不拍的后果 | 卡住 |
|---|---|---|---|
| **D-1** | 是否用 `feature-matrix.md` §11 那条反需求的"**除非明确有差异化价值**"豁免，取代 ADR-0005 的"不做聊天助手"禁令 | 无论做不做，都缺一份建立取代关系的 ADR（ADR 不可改，只能新增取代）。**没有它，W12 无法开工，W8 的形态也无从定** | W8、W12 |
| **D-1a** | 「多步」是否从 ADR-0035 定义的"只读循环"扩成"**读循环 + 末尾一次写提案**" | 这是 D-1 的实质前置。**不拍它，滴答截图 A 那条链（3 读 + 1 写）永远复现不了**，且 W8 无法定义完成判据 | W8 |
| **D-2** | 工具目录扩到几十个后，授权粒度按**工具** / 按**读-写两档** / 按**实体分组** / 按**会话临时授权** | 目录是内置助手与入站 MCP **共用一份**（ADR-0035 明令不许另建）。为助手扩目录 = 同时把外部 AI 攻击面同比扩大。**不先定粒度，扩目录就是拿隐私换功能** | W10 |
| **D-3** | 倒数日 `EVENT` 实体是否与它的 AI 工具**同批**设计 | `docs/plans/countdown-anniversary.md`（⚠️ 该文**尚未提交**，故此处用 code span 而非链接，以免在干净检出上成死链；它入库后改回链接）162 行里**零 AI 工作项**。不同批就会在第 11 个实体上重演"功能做完再回头补 AI"；而滴答恰好在这里说了句产品谎言，这是唯一一处能比它先做对的机会 | W14'（见 §4） |

⚠️ **D-1 与 D-1a 要分开拍**。产品负责人问的是"用户能不能使唤 AI 干活"，那是 **D-1a**；
"要不要一个聊天界面"是 **D-1**，是外壳。**把两件事混成一个"要不要做助手"的问题，
最可能的结果是花力气做了外壳、多步还是不通。**

---

## 2. 第一段：不依赖任何拍板，可直接开工（W1–W7）

排序原则：**先让引擎可达 → 再让已有的东西说真话 → 再补判据 → 最后才还结构债**。
在"AI 今天根本连不上"的状态下扩工具目录，等于给一台没人能发动的机器加零件。

### W1 🔴 本机端点的 Origin 拒绝要变成**可诊断的失败**（AI-G1）

**为什么排第一**：这是唯一一条"今天就在挡住真实用户"的缺口，且文档零记录。

✅ **第 0 步已做完**（2026-10-02，本机 Ollama 0.23.2，四探针），结论落在
[ADR-0045](../adr/0045-conversational-assistant-split-authorization-from-catalog.md) §4：

| 探针 | 结果 |
|---|---|
| 无 `Origin`（非浏览器） | 200 |
| `Origin: http://127.0.0.1:4321` | **200** + `Access-Control-Allow-Origin` 回显该来源 + `Vary: Origin` |
| `Origin: https://heyta.waytofuture.cn` | **403，`Content-Length: 0`，完全没有 `ACAO`** |
| 坏来源下的 `OPTIONS` 预检 | **403，无 `ACAO`** |

🔴 **原计划的第 1 步作废**。它写的是"从 `http-error` 里分出一个新原因"——
实测证明**这条路技术上走不通**：403 不带 `ACAO` ⇒ 浏览器把它拦成 `TypeError`，
**JS 根本看不到状态码**，`routing.ts` 的 catch 分支只会归成 `'network'`。
所以"二选一"不存在，**答案恒为 `'network'`**，且**不可能**从状态码区分。

真正的 bug 住在 `apps/web/src/features/ai/ai-failure-copy.ts` 的 `CAUSE_SETTINGS_TARGET`：
`network` 那条注释写着"网络与空响应是**暂时性**的，设置里改什么都修不好"、跳转目标是 `undefined`。
**对本机端点而言这两句都是错的** —— 它既不暂时，也确实有该说的话。

**改成三层，缺一层就是没修完**：

1. **上下文推导，封闭词表一个值都不加**：在 `packages/ai` 加纯函数
   `diagnoseNetworkFailure({ reason, endpointIsLoopbackPreset, pageOrigin })`
   → `'origin-likely-rejected' | 'transient-network'`。
   🔴 `AiFailureReason` 不动 —— 它描述**传输层已知**的事，而这件事传输层**不知道**，
   诊断只能住在它上面一层。
2. **文案带具体值**：`ai-failure-copy.ts` 消费诊断；`origin-likely-rejected` 时把
   **用户该放行的 Origin 原文**打出来 + 可复制 + 指向 runbook。
   ⚠️ 不硬编码域名（域名会变，见 `deployment.md` §3.7.2 那次迁移）。
   并把 `network` 的"设置里没东西可改"改成**有条件**：本机预设时指向端点区块。
   ⚠️ 新词条必须**中英同步**（AGENTS §2 明令）且过 `check:ui-language`。
3. **runbook**：写清 Ollama / LM Studio 默认只放行 **loopback 来源**，
   以及**为什么生产 Web 壳与两个原生壳（`heyta.local` / `heyta-local://app`）必然撞上它** ——
   只有开发机上的 localhost 页面能用本机端点，**这就是它至今没被发现的原因**。

**判据**（每条都要先证明能红）：
- 🔴 **根因级**：`e2e/stub-provider.mjs` 必须能配成"**读 `Origin` 并按白名单拒绝、且不带 `ACAO`**"。
  它文件头**已经把这类症状的误导性写得极准**（"CORS 拒绝 → 应用层拿到 `Failed to fetch` →
  界面渲染成'无法连接端点'，而假端点其实活得很好"），却无条件回 `ACAO: *`
  ⇒ **知识已有、判据只测了放行那一侧**。不改这条，加多少用例都还是看不见。
- 单测：`diagnoseNetworkFailure` 表驱动 —— loopback 预设 + 非 loopback 页面来源 ⇒ `origin-likely-rejected`；
  远程端点失败 ⇒ `transient-network`；无端点配置 ⇒ `transient-network`。
- 界面：真浏览器用例断言**屏幕上出现那个 Origin 的具体值**，不断言"有文案"。
- **变异**：把推导函数改成恒返回 `transient-network` ⇒ 单测与界面用例**必须红**。

### W2 🔴 真端点验收**不许"跳过并退出 0"**（AI-G2）

> ✅ **2026-10-02 已做完响亮失败那一条**；配置路径归位与门禁里那处 `skipIf` 的反转**未做**，
> 原因写在下面，不要把它们当成"已完成"。

先更正本条初稿的两处失真（都是实测出来的）：

- 涉及的是**四个**脚本，不是三个：`verify-ai-live` / `-breakdown-live` /
  `-output-language` / `-preferences-live`。
- 它们**不在 `pnpm check`、也不在 CI**（`ci.yml` 只跑 `check` 与 `test`，
  并在第 141 行明确指引"想真跑请在本地用 `pnpm verify:ai-live` 系列"）。
  ⇒ 它们**没有掩盖过任何一次 CI 绿**，骗到的是手动运行它的人。
  本条初稿写的"这比红更糟，它看起来是绿的"**说过头了**，已按实测降级。
- 🔴 **门禁里确实有一处同形状的空转，而且位置不在 `scripts/`**：
  `apps/web/tests/journey-ai-memory.integration.spec.tsx:256` 的
  `describe.skipIf(CONFIG === undefined)` 挂在**同一个** `/tmp/heyta-ai-live/provider.json` 上，
  而它属于 `pnpm -r test` ⇒ **在 `pnpm check` 里**。它是 web 侧唯一碰真模型的用例。

**已做（判据先跑出红，再改绿）**：

- 跳过判据抽成**单一所有者** `scripts/lib/live-provider-config.mjs`
  （原来同一个 `exit(0)` 抄了四遍 —— 本仓库"失败判据被抄三遍于是三遍都漏"的老形状）。
- 默认 **exit 2 =「这一轮根本没跑」**，与 1=「跑了且有红」分开；
  只有显式 `--skip` 或 `HEYTA_AI_LIVE_ALLOW_SKIP=1` 才回到 0，且**照样打大字警告**。
- 配置文件存在但 **JSON 解析失败 ⇒ exit 1**，不再伪装成"还没配"。
- 字段校验补齐：四个脚本**都用了 `config.model`**，而三个只校验 `endpoint`/`apiKey`
  ⇒ 以前模型缺失是 `model: undefined` 直接发出去。
- 诊断分两种：期望路径没文件 vs **文件被搬走** —— 后者会把 `/tmp/heyta-ai-live-provider*`
  列出来并**声明不会自动使用它**（用不用一份凭据必须是显式决定）。
  本次实测：该分支真的找到 `/tmp/heyta-ai-live-provider.json.stashed-by-i18n-round`。
- 五条臂**全部实跑取证**：缺文件⇒2；`--skip`⇒0 且打警告；合法配置⇒装载成功并继续跑判据；
  坏 JSON⇒1 且明说"不是还没配"；缺 `model`⇒2 且点名缺哪个字段。
- ⚠️ **没有**把那个凭据文件搬回期望路径：它是**另一个会话为 i18n 那轮刻意停批的**，
  归位动作留给它的所有者。这里的打印只做诊断，不代做决定。
- ⚠️ `verify-ai-output-language.mjs` **没有 `verify:` 别名**（`package.json` 查不到）。
  **没有顺手加**：`package.json` 当前被并行会话改着。留作待办。

**未做（要一并改，不能一处一处改）**：

1. 配置归位到**固定、非 /tmp、被 `.gitignore` 覆盖**的路径（/tmp 会被重启清掉，
   而它的存在与否**还静默控制着一套 `pnpm check` 里的用例** —— 这两件事叠在一起就是
   "门禁结论取决于本机今天有没有 /tmp 残留"）。
   🔴 换默认路径要**同批改 6 处**：lib 里的默认值、四个脚本（现在只有一处）、
   那个 spec 的 `CONFIG_PATH`、runbook、`.gitignore`。**分叉的默认值比 /tmp 更糟。**
2. 把那个 spec 也翻成"缺配置就红"。⚠️ **刻意没翻**：翻了之后本机与 CI 的每一次
   `pnpm -r test` 会立刻变红，而这需要**同时在 `ci.yml` 显式声明豁免**
   （`HEYTA_AI_LIVE_ALLOW_SKIP=1`，让"CI 没有真模型覆盖"变成一个**可读的声明**而不是推断），
   还要与同一工作树里正在跑门禁的并行会话协调。本轮先做的是让它**跳过时自己说话**
   （`console.warn` 打清"这一轮没跑 + 缺哪个路径 + 怎么打开"）。
3. `verify-ai-live` 第一条断言**硬要求远端端点**（它把 `classifyDestination(...)==='user-endpoint'`
   当成前提），所以拿本机 Ollama 配置跑它会在第 1 步就炸。这条要重新论证：
   本机 BYO 端点是 heyta 的**默认**形态，一个把默认形态判成不可测的验收脚本测的不是产品。
   ⚠️ 它可能是**故意的**（"这条就是验远端出境链路"）—— 若是，则缺的是**对偶的那条**
   （本机端点 ⇒ 目的地必须是 `none` 且**不需要**出境授权）。改法二选一，先读它的意图。

**判据**：拿掉配置 ⇒ 脚本 exit ≠ 0 且打印那句"没验真端点"。这条**必须先跑出红**再改绿
（✅ 已按此顺序做过，五条臂的输出记录在上面各条里）。

### W3 🔴 `list.today` 正在给用户错数据（AI-G3）

现状：`list_tasks` 的执行器只认 `projectId` / `completed` / `limit`，**没有日期参数**；
而规则 `list.today` 传空 args ⇒ 问"今天有什么任务"拿到的是**全量前 N 条**，
与问"列出任务"逐字相同。既有测试**只断言 args、不断言结果**，所以它一直绿。

- 给 `list_tasks` 加日期参数（形状参考滴答官方表的 `list_undone_tasks_by_date`，
  它带**跨度上限 14 天** —— 那个"用范围上限代替自由查询"的思路值得照抄，
  理由是它同时限制了出境数据量，与逐字段披露的立场一致）。
- 规则传参；`list.today` 不许再传空对象。

⚠️ **这不是纯本地改动**：工具目录是内置 AI 与 MCP **共用一份**，且**工具的 schema 与说明会进入请求体**
（`provider.ts` 里 `AiInvocation.tools` 的注释明写"这些工具的名字与说明会进入请求体，所以它们也是出境数据"）。
⇒ 加参数要同步：披露字段、`check:ai-tools`、MCP 侧的工具投影、中英词条。

**判据**：测试必须**断言结果集**（"给 3 条今天 + 2 条明天，返回恰好 3 条"），不断言 args。
**变异**：把执行器里的过滤拿掉 ⇒ 必须红。

### W4 时间锚点：**注入系统提示词，不加 `get_today` 工具**（2026-10-03 实施时改判）

⚠️ **本条偏离初稿，理由要写清，否则下一个会以为漏做了工具。**
初稿写的是"新增只读工具 `get_today`"。实施时改成**注入**，四条理由：

1. `ToolSelectionContext` **已经有注入的 `now`**（`ai-tool-selection.ts` 的
   `ToolSelectionContext.now`，注释写明"注入而非读真实时钟：否则测试会过几天变红"）
   ⇒ 规则侧根本不需要一次工具调用就能拿到今天。
2. 模型侧要拿到今天，**注入一行比一次工具往返便宜得多**，而且**不扩大出境字段面** ——
   多步的工具结果回灌是出境的，提示词里的一行日期不是新字段。
3. `ai-capture.ts` 已经在提示词里注入"今天是"，**这是既有先例**，不是新形状。
4. 竞品用工具是因为它的 agent loop 是**通用**的；heyta 的封闭词表里"今天"永远是需要的上下文，
   不是一个可选能力。

⇒ **仍然要做的部分**：把日期 + 星期 + **时区**注入到**拆解 / 排序 / 估时 / 工具调用**四条链路
（现在只有 capture 有），以及把相对日期（"14号""下周三"）的解析**留在规则内核**
（`capture.ts` 只有 `X月Y日`，没有裸日规则）。
🔴 **不许改成"让模型自己算"**：`packages/ai/src/index.ts` 文件头记着实测 ——
模型曾把"明天"算错**四个半月**。

**判据**：表驱动，至少覆盖跨年、已过本月同日、月末溢出、非 UTC 时区四组。
**变异**：把时区写死成 UTC ⇒ 至少一条红。

现状："今天是几号"只进了 `ai-capture.ts` 一条 prompt；拆解/估时/排序/**整条工具链**都没有日历锚点，
**也从不传时区**。"14号"没有任何一层负责解析（规则内核只有 `X月Y日`）。

- 新增**只读**工具 `get_today`（返回日期 + 星期 + 时区），由代码算。
- 相对日期（"14号""下周三""明早"）的解析**留在 `packages/app-host` 的规则内核**，
  补裸日规则；模型只允许产出**候选**，不允许产出结论。

🔴 **这条纪律不许松动**：`packages/ai/src/index.ts` 文件头记着实测立场 ——
模型曾把"明天"算错**四个半月**。所以"不信模型算日期"是对的，
缺的从来不是"让模型更小心"，是**替它算的那件工具**。

**判据**：表驱动，至少覆盖跨年、已过本月同日、月末溢出、非 UTC 时区四组。
**变异**：把时区写死成 UTC ⇒ 至少一条红。

### W5 工具调用面板要有**真浏览器**用例（AI-G11）

现状：`e2e/tests/` 下 AI 相关只有 breakdown / capture / duration / prioritize / row-layout / unavailable 六个，
**第 5 个功能（`AiToolRun`）零浏览器级行为用例**。

按 AGENTS §6.2 规定一做：先截图再断言、截图放固定路径、抓 console 与 pageerror、
**人真的打开那张图看**。窗口不得抢前台（`HEYTA_NO_FOCUS=1` 那条）。

**判据**：至少覆盖"读即执行"与"写只提案"两条，且断言的是**产品结论**
（提案里出现了那条任务），不是显示形态。

### ~~W6~~ 🔴 **已撤销**（`AI-G13` 被证伪，编号不回收）

初稿把 `retainValidConsents` 写成"有定义有测试、生产无写入口"。**那是错的**：
它在 `apps/web/src/features/settings/AiSettings.tsx` 的供给模式切换处**有真实调用点**，
同一文件里还有注释指名它是"唯一的过滤事实源"，并且它有自己的回归测试
（`apps/web/tests/ai-settings.spec.tsx`、`apps/web/tests/ai-endpoint-disabled.spec.tsx`）。

成因与纠正过程记在审计 [`dida-ai-assistant-gap-analysis.md`](../research/dida-ai-assistant-gap-analysis.md) §8.1。
**这条撤销本身是一条纪律**：凡是"零生产调用点 / 无消费者"式的否定结论，
复核范围必须是 `packages` + `apps` + `server` 全仓，不能只查被调方所在那一层。

⇒ **本段实际只剩 6 张工单**（W1–W5、W7），下文与 §6 提到的"W1–W7"按 6 张读。

### W7 还结构债：冗余前门 + 两套请求组装 + 一个抄了四遍的函数（`AI-G14`，并吸收 §3.4.1 的两条）

三件事一起做，它们都是"同一判断写多遍"这一类：

1. 🔴 **删冗余前门**：`runAiTool` 与 `grantedToolNames`（均在 `packages/app-host/src/ai-tool-run.ts`）
   **零生产调用点**。`runAiTool` 只是转调 `runSelectedTool` 的薄壳，
   而界面走的是 `requestToolCall`（模型前门）+ `resolveToolSelection`（规则前门）那两条。
   **删它们不丢任何能力** —— 但要先确认 `check:ai-tools` 那类静态门禁没有把 `runAiTool` 当锚点。
   ⚠️ 别顺手删 `runSelectedTool`：它是**唯一执行核**，被 `requestToolCall` 在两处调用。
2. **收敛两套请求组装**：`createProvider`（测试/遗留）与 `invokeRouted`（生产）并存，
   请求组装与失败分类重复。
3. **`describeRoutedFailure` 抄了四遍**（`ai-breakdown` / `ai-capture` / `ai-duration` / `ai-prioritize`
   各定义一份）。顺带修 `ai-tool-call.ts` 头部那张对照表 —— 它通篇写 `runSelectedTool()`，
   而该模块的真实入口叫 `requestToolCall`，读表会以为存在一个叫前门的名字。

🔴 **必须在任何"加多步"的动作之前做完**，理由是 AGENTS §3.5 那条实测教训：
**"抽出了一个共享实现"不等于"重复被消除了"**，而漂移恰恰从"同一个判断写四遍"开始。
现在加 loop，重复会乘二，且**失败分类一旦漂移，出境披露的措辞就会跟着漂**。

**判据**：收敛后重复定义的 `grep` 计数为 1（`describeRoutedFailure` 从 4 → 1），
且门禁能拦住重新长出来的第二份（照 `check:layering` 的做法）。
删前门的判据是**全量 `pnpm -r typecheck` 通过 + `check:ai-tools` 通过**，
不是"grep 不到了"。

#### ✅ 2026-10-03 做完了，三处初稿判断需要更正

| 工单写的 | 实测 | 后果 |
|---|---|---|
| "顺带修 `ai-tool-call.ts` 头部那张对照表" | 🔴 **那张表是对的**（它逐行写 `runSelectedTool()` → `findTool()` / `isToolGranted()`，与代码一致）。**过期的是另一张**：`ai-tool-run.ts:32` 把"执行前复查"写成 `runAiTool()` 里的，而 `isToolGranted()` 一直住在 `runSelectedTool()` | 表指向一个**不含该判断**的函数 ⇒ 改错门。同一个包里一张对一张错，说明不是"没人知道"，是**抄件一定会漂** |
| `grantedToolNames` 只是"未用" | 它是 `listAuthorizedTools()` 的**第二个投影方向**：那边遍历目录按 grants 筛，这边遍历 grants 按 `findTool()` 筛 —— 同一个集合两种写法，且**都过滤目录外**（等价）。所以它不是"没用的便利函数"，是**同一判断的第二份** | 删。需要授权工具名就从 `listAuthorizedTools(grants)` 取 |
| 判据 = "grep 计数为 1" | grep 判据**改成了行为判据**：`packages/ai/tests/wire.spec.ts` 分别驱动 `createProvider()` 与 `invokeRouted()` 两条真路径，把它们各自交给 `fetchImpl` 的 **url / headers / `JSON.stringify` 之前的原始 body 串**逐字节比对。任何一边单独改形状立刻红 | 文本检查改个函数名就绕过；字节比对绕过不了。已用变异复现：只给 `provider.ts` 那条路的 `system` 加一个空格 ⇒ **恰好 1 红**（`给了工具：url / headers / 请求体原串三样全等`），还原后逐字节哈希相同、复绿 |

**实际做的三件事**：

1. **删冗余前门**：`runAiTool()`（六行薄壳）与 `grantedToolNames()` 从
   `ai-tool-run.ts` 与 `packages/app-host/src/index.ts` 的导出里删除。
   `ai-tool-run.spec.ts` 对它的 8 处调用改成本文件内的**局部**组合
   `runThroughRules()`（`resolveToolSelection` → `runSelectedTool`）——
   🔴 **断言一条没动**（`git diff -U0 | grep -c 'expect('` = **0**），测试数不变（11）。
   ⚠️ 刻意**不再抽回产品层**：需要"text → 执行一步"就调 `requestToolCall`，
   它是唯一前门；`requestToolCall` 的规则分支本来就做着同一件事。
2. **收敛请求组装**：新建 `packages/ai/src/wire.ts`（`chatCompletionsUrl` /
   `chatRequestHeaders` / `buildChatRequestBody` / `isEmptyModelResponse`），
   `provider.ts` 与 `routing.ts` 两处各删一份。
   ⚠️ **刻意不从 `@heyta/ai` 导出**：线格式是包内接缝，导出去等于邀请包外再拼一份。
   ⚠️ 抽的是**判断**不是**句子**：`empty-response` 两边措辞不同是**有意的**
   （路由那份要带端点名，多端点回退时用户必须知道是哪一个），
   所以共享 `isEmptyModelResponse()`，句子留在各自文件。
   🔴 顺带修掉一处：`chatRequestHeaders` 把**空串**当成"没有密钥"。
   两条路原来各自写 `apiKey !== undefined && apiKey !== ''`，
   这条纪律现在只有一份 —— 空串发 `Bearer ` 头会让某些端点直接 401，
   症状是"配了地址却连不上"。
3. **抄件 4 → 1**：新建 `packages/app-host/src/ai-failure-fallback.ts`，
   四个模块改成 import。两处文件头原本明写着"**本轮不允许改那个文件，所以只能各留一份**"
   —— 也就是说这份重复是**被决定留下来的**；没有门禁，它会在下一次"不方便改"时变成五份。
   ⚠️ 入参从 `string` 换成封闭词表 `AiFailureReason`：旧 `switch` + `default` 的组合
   意味着 `packages/ai` 新增原因时**四份都不报错、静默落 default**。
   兜底那句 `'AI 暂时不可用。'` **保留**，但它现在由
   `noUncheckedIndexedAccess` 在类型上**要求**（不是装饰）：同一个包被加载两份时
   跨模块枚举比较会静默为假，那时拿到的就是词表外的值，而面板对它做 `.includes()`。

**门禁**：`check:ai-tools` 新增**规则 6** —— 扫描 `packages/app-host/src` 全部
**39 个**非测试 `.ts`：`runAiTool` / `grantedToolNames` 不许再出现（按**声明语法**匹配 +
先剥注释，因为这几个名字如今大量出现在"解释为什么它们没了"的注释里），
`describeRoutedFailure()` 的定义点必须**恰好一个**且在 `ai-failure-fallback.ts`。
两条变异各自实测转红（在 `HEYTA_CHECK_ROOT` 的副本里注入，工作树未动）：
长回 `runAiTool` ⇒ 红；在 `ai-breakdown.ts` 再定义一份 ⇒ 红并打印两个定义点。

**为什么先还它**：这一批把"两条路各自拼请求体"合成一份，正是**下一批（多轮 `messages`）**
的前提 —— 形状有两个主人的时候加多轮，得到的是"一条路能多轮、另一条不能"，
表现是"某些功能忽然又变成单轮了"，而那种 bug 没有编译错误、也没有失败用例。

**登记给后面的**：`apps/web` 五个面板的失败块是**五份复制**（其中三份外层逐字相同），
本轮只在唯一的共用件 `FailureSettingsAction` 上加了 `originHint`。
第 6 个面板进来时它就会漂 —— 处理方式与这里相同：先收敛，再加门禁。


---

## 3. 第二段：依赖拍板（W8–W14，**现在不许开工**）

| 工单 | 挂 | 一句话 | 完成判据的**形状**（不是内容，内容要等拍板） |
|---|---|---|---|
| **W8** 多步循环 | D-1a | 允许"读循环 + 末尾一次写提案"；出境按 ADR-0035 已给的解法做（**循环开始前**按可达工具集算字段并集一次性披露；某步要发集合外字段 → **停**，不是静默放行） | 复现审计 §2 截图 A 那条链的**能力**（3 读 + 1 写），且硬上界存在并被测到 |
| **W9** 能力清单 | — | 给模型一份"哪个实体、哪些字段、可读还是可写"的清单，让它能说"我做不到" | 🔴 **只能从工具目录与 `EntityModelMap` 生成，禁止手写**。手写抄件必然漂移（本仓库立场：抄件一定会漂）。配套一条 `--check` 门禁，不一致 exit 1 |
| **W10** 扩工具目录 | D-2 | 把习惯 / 便签 / 标签 / 提醒 / 专注 / 重复 / 搜索配上工具（动作层零件**全都已存在**，是"没接线"不是"没零件"） | 一条**新门禁**：`EntityModelMap` 每个已物化实体必须有工具，否则红 —— 让"AI 覆盖面 = 界面功能面"从主张变成机器可查 |
| **W11** 批量写入 | D-1a | 参考滴答"限制批量大小"的解法（`batch_*` ≤20） | ⚠️ **要先论证**它和 AGENTS §3.4"一个用户意图 = 一个 op""多实体变更要在一次操作里完成，不要 fan-out"的关系。**这两条可能是同一条**，也可能是冲突的 —— 论证不成立就不做 |
| **W12** chat 外壳 | D-1 | 持久化会话、结果卡片、过程轨迹"已调用 N 个工具"、AI 免责声明 | 🔴 **排在 W8 之后**。外壳先做 = 做出一个能聊天但改不动任何数据的助手（那正是审计 §3.4 今天的状态） |
| **W13** 移动端入口 | — | 目前 `apps/mobile/src` 零 `@heyta/ai` 导入，Electron 壳零 AI | 至少一条真模拟器 E2E，零 mock，照 `verify:mobile-*` 那批的形状 |
| **W14** 语音线 AI | — | 滴答有 AI 语音添加（一段话拆多条、不确定给两版左右滑）与录音转写总结（30+ 语言、失败回退普通模式）；heyta **整条线为零**，且**不在任何现有 AI 计划里** | 🔴 **先过 AGENTS §3.1 可维护性 + §3.2 许可证两道门并完成登记**，再谈立项。语音模型接入不走现有 `packages/ai` 那条文本路径 |

**W14'**（挂在 D-3，不占主序号）：若倒数日 `EVENT` 与 AI 工具同批，则 `EVENT` 的工具与能力清单项
必须出现在 `countdown-anniversary.md` 的工单里；若不同批，则**在该计划里显式登记"AI 覆盖延后"并给编号**，
不许静默消失。

---

## 4. 三条贯穿所有工单的判据纪律

1. **不能失败的检查没有价值**（AGENTS §8.3）。每条新门禁都要**先用违规输入跑出红**，
   再改绿，并把这次变异记在本工单行里。
2. **界面结论只有截图算证据**（AGENTS §6.2 规定一）。W5 / W12 这类工单，
   "元素可见"不是证据，**人打开那张图看过**才是。
3. **断言产品结论，不断言显示形态**；等待条件必须是该功能**唯一产出**的那个串；
   console error 进断言。

---

## 5. 已知边界（别读多）

- **W1 修的是"可诊断性 + 指引"，不是 Ollama 本身。** 我们不改用户的 Ollama 配置，
  也不该试图自动改 —— 那是别人机器上的服务。产品能做到的是**别把 403 说成"连不上"**。
- **W3 / W10 扩目录会同时扩入站 MCP 的攻击面**，因为目录共用。这是 D-2 存在的原因，
  不是 W3 的 bug。W3 只加参数、不加新工具，所以它**不受 D-2 阻塞** —— 这个区分要看清。
- **W9 的能力清单是"给模型看的语料"**，它一旦写死就会和真实工具目录漂移，
  而漂移的后果是模型**自信地说不存在的不存在**（滴答 §2.1 那句产品谎言就是这个形状）。
  ⇒ 生成 + 门禁是 W9 的**唯一**可接受实现形态，不是"更严谨的做法"。
- **托管/云端 AI 不在本文任何工单里**，且 `hosted-ai-monthly` 在计量存在之前不得被售卖
  （ADR-0023）。任何工单都不许把它顺带"接通"。
- **本文不预测工期。** 该仓库有过一次因计划里写死时间而腐烂的先例
  （`desktop-native-migration.md` §10.3 自己写明"不写相对时间"）。

---

## 6. 回退点

W1–W7 每张工单独立可回退（各自一个提交，互不依赖）。
W8 起**不是可回退的增量**：多步循环一旦放开，出境披露的口径就从"一次调用"变成"一次会话"，
回退要连带清掉已发放的会话级同意。⇒ **W8 开工前必须先有 D-1a 的 ADR**，
那份 ADR 要写清回退时同意如何失效。

> ✅ 该前提已在 2026-10-03 满足：[ADR-0045](../adr/0045-conversational-assistant-split-authorization-from-catalog.md)
> §5 第 4 条把"回退时代际号 +1、旧会话级同意逐条自然失效"写成了硬要求。

---

## 7. 实施进度（2026-10-03 凌晨，产品负责人休息中、授权自主推进）

⚠️ **这一节是过程账，不是完成声明。** 每条都写明"落在哪里、验到什么程度"。

| 工单 | 状态 | 落在哪 | 验到什么程度 |
|---|---|---|---|
| 前置：D-1 / D-1a 的 ADR | ✅ 已提交 | `docs/adr/0045-…-from-catalog.md` | 死链检查过；取代关系逐条写明（含**保留**哪些既有条款） |
| 前置：本审计 + 差距文档 | ✅ 已提交 | `docs/research/dida-ai-assistant-gap-analysis.md` + 旧审计 §8 勘误 | 六路只读审计；其中 **1 条撤回**（`AI-G13`）+ **1 条改判**（`AI-G4` 不是缺接线）都在文档本体里 |
| W1 第 0 步（实测） | ✅ 已做完 | 结论进 ADR-0045 §4 与本文 W1 | 四探针实测，**推翻了 W1 原计划的修法**（状态码在 JS 侧不可见 ⇒ 不能加新失败原因） |
| W1 第 1 层（诊断函数） | 🟡 已落盘，未提交 | `packages/ai/src/diagnose.ts` + `AiFailure.endpointUrl` + `routing.ts` 带出端点 | 复用 `supply.ts` 的 `isLoopbackEndpoint`，**没起第二份判断**。单测在写 |
| W1 第 2 层（界面） | 🟡 进行中 | `ai-failure-copy.ts`（已改）+ 五个面板（接线中）+ i18n 3 键 ×2 语言（已落） | 五个调用点刻意改成**必填上下文对象**，让编译器强制逐个改到 —— 这是本文件 §"第 5 份副本没跟上"教训的直接应用 |
| W1 第 3 层（手册） | ✅ 已落盘，未提交 | `docs/runbooks/ai-acceptance.md` §9 | 含三条**已实测通过**的 curl 阳性/阴性对照 |
| 🔴 W1 根因级判据（假端点会拒绝来源） | ✅ 已落盘，未提交 | `e2e/stub-provider.mjs` 的 `STUB_ORIGIN_ALLOWLIST` | **已实测**：白名单内 200+回显来源+`Vary: Origin`；白名单外 **403 且零 CORS 头**；预检走同一闸门；**不设变量则逐字回归旧行为**（既有套件零影响）。闸门放在所有路由**之前**，否则 `/__requests` 会成侧门 |
| W3 / W4 部分（`list.today` 错数据 + 日期参数） | 🟡 进行中 | `local-api/{mcp,server}.ts`、`ai-tool-selection.ts`、两个宿主实现 | 判据**换层**：从"断言 args"改成"断言结果集"，并专门钉"先过滤再 limit"（那是同一个 bug 的另一种面目） |
| W4 其余（时间锚点注入四条链路 + 裸日规则） | ⛔ 未开始 | — | 见本文 W4 的改判说明 |
| W2（live 脚本空转） | 🟡 **响亮失败已做完，归位未做** | `scripts/lib/live-provider-config.mjs`（新增，四个脚本共用）+ 四个 `verify-ai-*-live` + `journey-ai-memory` 的跳过自检 | 缺配置 **exit 2**、坏 JSON **exit 1**、`--skip` 才回 0；五条臂全部实跑取证。**没有**搬别人的凭据文件，**没有**翻转 spec 的默认（理由见本文 W2「未做」三条） |
| W5 / W6 / W7 | ⛔ 未开始 | — | W6 已撤销；W7 **必须在 W8 之前** |
| W8–W14 | ⛔ 未开始 | — | W8+ 依赖的 D-1/D-1a 已由 ADR-0045 拍定，**阻塞已解除**；D-2（授权粒度）与 D-3（`EVENT` 同批）仍未拍 |

### 7.1 一条必须记住的提交纪律

本仓库的工作树是**并行**的：`git status` 里同时存在别的会话 staged 的
`server/src/auth.ts`、`package.json`、`pnpm-lock.yaml`，以及未提交的
`apps/web/src/App.tsx`、`view-tabs.ts`、`theme.ts`、倒数纪念日那四份文档。

⇒ **`git commit` 提交的是整个索引**，所以：
- 混合文件（如 `docs/plans/README.md` 同时有我的 §四 与别人的 §六）**不能**用路径提交 ——
  本次的做法是"从 HEAD 版本构造只含自己改动的 blob → `hash-object -w` → `update-index --cacheinfo`"，
  工作树一个字不动，索引里只进自己的部分。
- 新文件用临时索引 + `commit-tree` + `update-ref`，**完全不碰共享索引**。
- 提交后必须回读 `git diff --cached --name-only HEAD` 确认别人的 staged 条目**还在**（没被带走）。
依据：`AGENTS.md` §7 与仓库自报事故提交 `2206542c`。
