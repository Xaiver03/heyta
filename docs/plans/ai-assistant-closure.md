# AI 能力面补齐：从"连不上"到"能使唤"的落地工单

> 状态：**以 §7 那张逐条表为准，本行不维护结论**。🔴 原句"W1–W4、W7–W9、W12 已落地；
> W5 / W10 / W11 未做"在同一份文件里错过了三次：W5 与 W10 在表里早就标 ✅（`:399`、`:403`），
> 而"W1–W4 已落地"又把表里两格 🟡（W2 响亮失败、W4 两条链路）说成了完成 ——
> **一行摘要与一张逐条表同时存在，就一定有一份会过期**（AGENTS §3.5 那笔学费的文档版）。
> 截至 2026-10-03 的事实是：**W11（批量完成）已落地**（`a0df705e`，见下表那一行），
> W5 / W10 此前已落地；W2 / W4 仍是 🟡。
> 原稿那句"三处待拍板未决 ⇒ W8 及之后不得开工"**已过期**：D-1 / D-1a 由
> [ADR-0045](../adr/0045-conversational-assistant-split-authorization-from-catalog.md) 拍定，D-2 在**助手这一侧**
> 拍成"读 / 读+提议两档"（目录扩到几十个之后要重拍，见 §7.2 第 3 条）。D-3 仍未拍。
> 证据基础：[`dida-ai-assistant-gap-analysis.md`](../research/dida-ai-assistant-gap-analysis.md)（2026-10-02 审计，
> 缺口编号 `AI-G1…AI-G14` 全部在那份里取证，**本文不重复取证、只排工单**）
> 定位纪律：AI 的**策略与顺序**仍以 [`ai-strategy.md`](ai-strategy.md) 为准 —— 本文只是它 §8 信任阶梯的
> **执行拆解**，不是第二份策略。两者冲突时以 `ai-strategy.md` 为准并回来改本文。
> 相关决策：[ADR-0045](../adr/0045-conversational-assistant-split-authorization-from-catalog.md)（**取代** ADR-0005 的
> "不做聊天助手"与 ADR-0035 的"共用一份授权前端"，**保留**一份工具目录与"AI 产不出 op"）、
> [ADR-0005](../adr/0005-ai-data-path.md)（AI 不写 op）、
> [ADR-0035](../adr/0035-ai-tool-calling-reuses-local-api.md)（工具调用复用 local-api）、
> [ADR-0010](../adr/0010-ai-config-routing.md)（三道闸与回退边界）、
> [ADR-0013](../adr/0013-cloud-ai-and-maas.md) / [ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md)（托管 AI 的开放条件）

---

## 0. 解决什么 / 明确不解决什么

**解决**：把"用户能不能使唤 heyta 的 AI 干活"这件事，从**今天连不上**推进到**连得上、说的是真话、
且已有零件不再骗判据**。

**明确不解决**：

- 🔴 **不为了对齐滴答而放宽任何一条隐私不变量**。具体不许动的东西：
  AI 类型上产不出 op、`host.submit` 在**内置 AI 路径里**恰好一处（全仓还有入站
  `local-api/src/server.ts` 那一处，是 ADR-0011 的设计 —— 范围写宽的那句已在 ADR-0045 §2.4
  就地勘误，别再往别的文档抄"全仓"）、逐工具默认关、出境逐字段披露、
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
| **D-3** | 倒数日 `EVENT` 实体是否与它的 AI 工具**同批**设计 | ✅ **已拍：同批**（2026-10-03 产品负责人）。落点与字段边界见 [`ai-event-tool-contract.md`](ai-event-tool-contract.md) | `AI-COV`（原 W14'） |

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
| **W13** 移动端入口 | — | 🔴 **本行原来的"现状"（`apps/mobile/src` 零 `@heyta/ai` 导入）已被 `a9f0867a` 那批否证**，2026-10-06 现量：`grep -rlE "from '@heyta/ai'" apps/mobile/src` 命中数由该命令给出（真 import，不含注释）；Electron 壳那一半仍成立（`apps/desktop/src` 同一条 grep 为空）。设备级读数见 §9 W13 | 至少一条真模拟器 E2E，零 mock，照 `verify:mobile-*` 那批的形状 |
| **W14** 语音线 AI | — | 滴答有 AI 语音添加（一段话拆多条、不确定给两版左右滑）与录音转写总结（30+ 语言、失败回退普通模式）；heyta **整条线为零**，且**不在任何现有 AI 计划里** | 🔴 **先过 AGENTS §3.1 可维护性 + §3.2 许可证两道门并完成登记**，再谈立项。语音模型接入不走现有 `packages/ai` 那条文本路径 |

**W14'（已消化进 `AI-COV`，编号不再复用 W 号）**：D-3 拍成"同批"之后，这条不再是"要么登记延后、
要么静默消失"的二选一，而是**已经有一份契约等实体落地**：
[`ai-event-tool-contract.md`](ai-event-tool-contract.md) 定死了 `EVENT` 的读 2 / 写 4、
逐工具 `egressFields`、三项刻意不进 AI 的字段（`pin` / 样式 / 图片）与农历的分工。
🔴 **编号消歧**：闭环计划（本文）与倒数日计划**各有一个 W10 且指的是同一件事** ——
覆盖面门禁从 2026-10-03 起统一称 `AI-COV`，两边都不要再复用 W 号。

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
| W1 第 1 层（诊断函数） | ✅ | `packages/ai/src/diagnose.ts` + `AiFailure.endpointUrl` + `routing.ts` 带出端点 | 复用 `supply.ts` 的 `isLoopbackEndpoint`，**没起第二份判断**；单测在 `packages/ai/tests` |
| W1 第 2 层（界面） | ✅ | `ai-failure-copy.ts` + **六个**面板 + i18n 键 ×2 语言 | 五个调用点刻意改成**必填上下文对象**，让编译器强制逐个改到；`ai-failure-parity.spec.tsx` 从五条面板扩到**六条**（新增的 `AssistantPanel` 一进来就把一处 testid 漂移当场照红） |
| W1 第 3 层（手册） | ✅ | `docs/runbooks/ai-acceptance.md` §9 | 含三条**已实测通过**的 curl 阳性/阴性对照 |
| 🔴 W1 根因级判据（假端点会拒绝来源） | ✅ | `e2e/stub-provider.mjs` 的 `STUB_ORIGIN_ALLOWLIST` | **已实测**：白名单内 200+回显来源+`Vary: Origin`；白名单外 **403 且零 CORS 头**；预检走同一闸门；**不设变量则逐字回归旧行为**。闸门在所有路由**之前**，否则 `/__requests` 会成侧门 |
| W3（`list.today` 错数据） | ✅ | `local-api/{tools,server}.ts` 的 `dueOn` / `dueFrom` / `dueTo` + `projectListForTool` | 判据**换层**：从"断言 args"改成"断言结果集"，并钉住"先过滤再 limit"（同一个 bug 的另一种面目）。🔴 **本轮由声明↔实现对照抓出一个真泄漏**：`list_tasks` 把整块 `body` 带进列表项，而列表投影本来就该剥掉它 —— 见 §7.1 与 §7.2 的陷阱登记 |
| W4（日历锚点） | 🟡 **两条链路已接，三条刻意不接** | `packages/app-host/src/calendar-anchor.ts`（唯一生产者）+ `ai-capture.ts`（改为复用）+ `ai-assistant.ts`（系统提示带锚点，`today` 进出境声明） | `calendar-anchor.spec.ts` 13 条：五个时区 × 两个瞬间的**表驱动**（跨年 / 非 UTC / 夏令时两侧 / 半小时偏移）+ "锚点**一轮算一次**"（把 `Date.now` 换成"每读一次跨一天"的桩；变异：逐步重算 ⇒ 恰好 1 红）。**未做**的部分与理由见 §7.2 第 2 条 |
| W2（live 脚本空转） | 🟡 **响亮失败已做完，归位未做** | `scripts/lib/live-provider-config.mjs`（新增，四个脚本共用）+ 四个 `verify-ai-*-live` + `journey-ai-memory` 的跳过自检 | 缺配置 **exit 2**、坏 JSON **exit 1**、`--skip` 才回 0；五条臂全部实跑取证。**没有**搬别人的凭据文件，**没有**翻转 spec 的默认（理由见本文 W2「未做」三条） |
| W5（工具调用面板的真浏览器用例） | ✅ **已落地**（2026-10-03） | `e2e/tests/ai-tool-run.spec.ts`（2 条旅程）+ `e2e/stub-provider.mjs` 的 `tool-calling` 路由 | 复用 `helpers.ts` 的 `configureEndpoint` / `waitForStubCalls`，**没有另搭夹具**。两条旅程分别钉住两个入口：规则命中 ⇒ **一个请求都不发**、模型那条 ⇒ **先披露后出境**再出结果卡片；第二条钉的是"写工具只出提案：确认前不落库、确认后一次都不再多出境"。**五张截图**在 `apps/web/evidence/tool-run/`（含暗色 `3b-proposal-dark.png`）。⚠️ 落地时抓到两个只有真浏览器才会现形的坑，写进了 spec 文件头：授权必须先于规则路径（否则面板压根不出提案），以及"把事情做完"这句话会被 `list.completed` 规则抢走 —— 用例句子因此换掉。⚠️ 与 W12 的区别仍然成立：那两条 spec 是**两个入口**，谁也不顶谁 |
| ~~W6~~ | ⛔ 已撤销 | — | `AI-G13` 被证伪（编号不回收） |
| W7（结构债） | ✅ | 见本文 W7 的"✅ 2026-10-03 做完了"那节 | 冗余前门删除 + 请求组装收成一个 + `describeRoutedFailure()` 定义点恰好一处，全部由 `check-ai-tools.mjs` 规则 6 钉住（**已注入验证会红**） |
| W8（多步循环 + 一次性并集披露 + 硬上界） | ✅ | `ai-assistant.ts`（循环 / 档位 / 并集 / 计划）+ `packages/ai/src/assistant-limits.ts`（三个上界住在这里，不在 app-host） | `packages/app-host/tests/ai-assistant.spec.ts` 20 条：第二次请求带 `role:'tool'` 的观察、失败也回送且**仍计入步数**、写只出提案（`host.submits === 0`）、提案后**没有第二次调用**、越界字段 ⇒ 停而不是放行。`assistant-limits.spec.ts` 13 条：单位是**字节**、边界取 `>` 不取 `>=`、标签由常量推导 |
| W9（能力清单生成器） | ✅ | `scripts/gen-ai-capability-manifest.mjs` → `packages/ai/src/capability-manifest.generated.ts`（424 行，生成物） | 手写**不可能**：清单是产物。`--check` 已作为**规则 7 接进 `check:ai-tools`**（不一致 exit 1），`capability-manifest.spec.ts` 29 条钉形状 |
| W10（扩工具目录 + "覆盖面"门禁） | ✅ **门禁已落地且覆盖面已跑满**（2026-10-03，改称 `AI-COV`），覆盖面 **9/9**（10-04 现量；落地那日记 8/8，批次二把 `EVENT` 纳入分母） | `scripts/check-ai-coverage.mjs` §9 覆盖面 + §10 容量（挂在既有 `check:ai-coverage` ⇒ **已在 `pnpm check` 链上**，没有新增段）+ [`ai-event-tool-contract.md`](ai-event-tool-contract.md) §2/§5/§8 | 目录 **26 个工具**（读 12 / 写 14）、实体 **9 里覆盖 9**（10-04 现量，口径：读+写都有；本批落地那日是 22 / 8 里覆盖 8）。🔴 **此前对外说的 `2/8` 与同日报的 `3/8` 都是过期抄件**：前者错在 `covered` 判"有任一工具"（只读一个 `list_projects` 的 `PROJECT` 被算成已覆盖），后者是**同一批早几小时**的读数 —— 本批把剩下的五格（`TAG` `NOTE` `HABIT_LOG` `FOCUS_SESSION` `REMINDER`）全部补齐，`ENTITY_COVERAGE_DEBT` 现在是**空的**。⚠️ 本文与契约文档初稿曾把 `FOCUS_SESSION` **移出分母**（当时写"分母 7、已覆盖 1"）—— 那条排除与准入判据句子（"能填**或能按**"）自相矛盾，已撤回。🔴 **初稿写"剩下五项卡在一条只有产品能拍的算术"（`local-api.spec.ts:87` 的 `<= 10` vs 每实体一读一写 ⇒ 只剩 1 席、要 10 席）—— 这条已经解除，而且不是靠拍数字**：那条上限的**单位写错了**（总量从来不是用户要理解的负担，逐工具授权清单才是）。现在改成按实体判（`shared.ts` 的 `MAX_TOOLS_PER_ENTITY = 5`，四档推导见其注释），总量成为**派生**值 = 每实体上限 × 覆盖分母。**门禁能失败**：四次注入（契约文档 §5.3）+ 六个新工具各一条行为变异（§8，含未变异的正向对照 `44 passed`） |
| W11（批量写入） | ✅ **已落地（2026-10-03，`a0df705e`）** | `tools/task.ts` 的 `complete_task` 多一个 `taskIds` 参数 + `shared.ts` 的 `MAX_TASKS_PER_BATCH_COMPLETE = 20` + 新意图 `complete-tasks`（`local-api-host.ts` 的执行分支） | **先回答本文要求的那句"论证"**：论证其实已经拍完了 —— ADR-0045 §2.5 写的是"一个提案、一次确认、一次 `submit` 里落多条"，它规定的是**提案/确认层的粒度**，没有规定"一条 op" ⇒ 与 §3.4 是**同一条**，不冲突。落库是 N 条 op（`complete-tasks` → N 次 `setCompleted`）。🔴 **不走单 op 承载多实体**：`op-log/src/state.ts` 的 reducer 只读 `entityId`，`entityIds` / `BATCH` 在 heyta 侧是零生产者的装饰，而服务端 `op-replay.ts` 按全部成员处理 ⇒ 一旦真发批量 op，快照重建与重放就不一致，且最先炸红的是备份还原那套核对。⇒ 已登记 `op-log/tests/engine.spec.ts:354-366` 那条"多实体批次在一次 dispatch 里完成"**不证批次生效**（夹具里没有第 2..N 个实体），它现在提供着一份假的可行性证据。**为什么是参数不是新工具**：`MAX_TOOLS_PER_ENTITY = 5` 而 TASK 已 5/5，新开 `complete_tasks` 当场让 `check:ai-coverage` 红；出路是那段注释自己给的（"读法变体做成参数，参数不进逐工具默认关那张清单"）⇒ 目录仍是 22 工具、授权清单没有多出一个开关。判据：参数层 13 条 + 落库层 6 条（真引擎数 op：增量恰好 = N；整批拒时增量 = 0；已是完成态的不重复写）+ 界面层 4 条；**变异三条臂各红一次**（去预检 1 红 / 不跳过已完成 2 红 / 上限挪到去重前 2 红），每臂还原后逐字节相同并复绿。⚠️ **留下一处刻意的不对称**：界面上没有任务多选（`zh-CN.ts:3045` 把"批量操作"明写在未做清单里）⇒ AI 能一次完成多条而用户手动还不能，已登记进契约文档 §5.4；`update_task` 的批量同理不做，等这条形状被真用过一次 |
| W12（chat 外壳） | ✅ | `apps/web/src/features/ai/AssistantPanel.tsx` + `App.tsx`（任务视图内）+ i18n 37 键 ×2 语言 | 单测 19 条（`ai-assistant-panel.spec.tsx`，含"第一次点发送 ⇒ 一个请求都没发"）；**真浏览器** `e2e/tests/ai-assistant.spec.ts` 一条旅程 + **四张**截图（含暗色那张）。⚠️ **看图的是本会话的 agent，不是产品负责人** —— 两张有问题的图确实是被"看"出来的（动画中途按快门、两种角色分不出来），但 §6.2 要求的那一眼**还没发生**，四张图在 `apps/web/evidence/assistant/` 等人看。档位选择器在设置里（`ai-assistant-tier.spec.tsx` 14 条） |
| D-2（授权粒度） | ✅ **已拍并落地**（助手侧） | 判定在 `packages/app-host/src/assistant-tier-settings.ts`（2026-10-05 分层收口：字面量 / 默认值 / fail-closed 归一 / 顺序），存储通道与界面在 `apps/web/src/features/settings/{aiStore,AiSettings}.tsx` | 拍的是**助手这一侧**：读 / 读+提议两档，与入站 MCP 的**逐工具默认关**解耦但共用 `isToolGranted()`。双向不越界已在真浏览器里验（`ai-assistant.spec.ts` 第 7 步）。⚠️ 目录扩到几十个之后仍需重拍（见 §7.2 第 3 条）。⚠️ 这三行原先住在 web 壳里（AGENTS.md §3.5 那个形状），现在由 `check:layering` 的 `no-assistant-tier-literal-in-apps` 钉住"外壳不许再自己声明档位" |
| D-3（`EVENT` 与 AI 工具同批） | ✅ **已拍（2026-10-03 产品负责人）并落成契约 + 门禁已有反向半边** | [`ai-event-tool-contract.md`](ai-event-tool-contract.md) | 拍的是"**同批**"：契约（读 2 / 写 4、逐工具 `egressFields`、三项刻意不进 AI 的字段、农历只许本地换算）已定死，实现等倒数日那条线把 `EVENT` 进 `EntityModelMap`。⚠️ 原句"此刻那份文件正被一次 merge 占用，改不了就先留着这条指针"**的前提已经消失**：`.git/MERGE_HEAD` 已不存在、倒数日计划已在 `main`。🔴 但**它自己的 `:175`「不在本批立这条门禁，后面再说」到今天仍然是旧的**（现量：`git show main:docs/plans/countdown-anniversary.md \| sed -n '175p'`），而它给的理由（"一上就会让没接 AI 的实体当场全红"）**已经被这批的缺口登记通道化解** —— `ENTITY_COVERAGE_DEBT` 让"已知未覆盖"带工单号留在分母里而不炸红，只有"既没工具又没登记"才响。⇒ 合流时那句要就地改成指向本文与契约文档并保留删除线；本批不碰那个文件（它属于并行那条线） |

### 7.1 🔴 本轮抓到的一个真缺陷（不是重构的副产品）

**`list_tasks` 在列表里带整块 `body`。** 发现方式不是读代码，是新加的那道
**声明 ↔ 实现**对照：披露集合从目录的 `egressFields` 算，而实际发出去的键从
真 `runReadTool` 的产物里收，两边一比就红。修法是把列表投影**白名单重建**
（`projectListForTool`），而不是往声明里补一项 —— 因为"列表里带正文"本身
就不是这个工具该给的东西（详情工具 `get_task` 才给）。

📌 一般规律：**给出境字段加一道"声明必须覆盖实际发出的键"的对照，
它的价值不在于拦住未来，而在于照出已经漏了的现在。**

### 7.2 没做完的，各自写明为什么

1. ~~**W5**：`AiToolRun` 单步面板仍没有真浏览器旅程~~ ⇒ **已补**（2026-10-03）：
   `e2e/tests/ai-tool-run.spec.ts` 两条旅程 + 五张截图（含暗色），照着这条原来写的建议
   从 `helpers.ts` 的 `configureEndpoint` + `waitForStubCalls` 起步，**没有新搭夹具**。
   本节保留原句是为了记下：当时判断"补它的人应当复用什么"是写对了的，
   而 W12 顶不掉 W5 那句区别仍然成立（两个入口，两条 spec）。
2. **W4 的三条链路（拆解 / 排序 / 估时）与"裸日规则"刻意没做**，理由不是省事：
   - 给那三条加锚点 = **把 `today` 这项新数据第一次送出境**。那不是"补一致"，
     是一次出境面扩大，按 ADR-0010 的口径该单独拍一次；
   - 那三条**没有日期语义**（估"写周报"要多久、把一堆任务排序，都不需要知道今天）；
   - ~~"14 号"这种**裸日**规则有实打实的误伤面："买 5 号电池"、"37 号楼"
     都会被吃成到期日。规则内核自己的立场是"宁可让用户看见词还留在标题里"，
     所以它需要的是一个**产品决定**（要不要接受这类误伤），不是一个待写的正则。~~
     ✅ **2026-10-03 产品拍板"开始做"，已落地**（`capture.ts` 的裸号规则 + `capture.spec.ts` 那一组）。
     拍的不是"接受误伤"，而是**把误伤面收窄到可接受再认**：
     误伤要同时满足"数字像日子 + 「号」前后不接编号用语"才算日子，
     三层挡点各由不同的反例钉住（「7 号楼」只能被后缀黑名单挡、
     「2026 号」只能被双侧非数字边界挡、「房间 8 号」只能被前缀黑名单挡），
     漏网的那一类（新出现的编号说法）用户能在识别条上点掉 ——
     因为不变量 2 本来就要求 `matches` 展示且逐条可 `ignore`。
     🔴 **一条实测更正**：写第一版时我以为"范围 1..31"是守卫之一，
     变异（整段摘掉 ⇒ **0 红**）证否了它 —— `makeLocalDate` 的日期存在性判定
     早就把「37 号」「0 号」拒了，那条 1..31 只是**早退**，不承重。
     所以文档里"上限是守卫"那句已划掉留在原地，判据也按真实挡点重写。
     复跑：`node packages/domain/tests/mutate-capture-day-rule.mjs`（六条变异各带预期：
     M1 预期**绿**，M2 后缀黑名单 / M3 前缀黑名单 / M4 双侧非数字 / M5 含今天 /
     M6 往后找 各预期**红**，且红的用例名逐条不同挡点）。
3. **W10 的覆盖面门禁 ✅ 已写，且覆盖面已跑满**（2026-10-03，`AI-COV`）：`scripts/check-ai-coverage.mjs` §9（覆盖面）+ §10（容量），
   挂在既有 `check:ai-coverage` 上 ⇒ **已在 `pnpm check` 链里**（原链第 48 段 / 共 57 段），
   没有新开 `package.json` 脚本（那个文件此刻仍有别的会话的未提交改动）。
   **逐段跑绿读数（含 5 红的逐条归属与一条未定性超时）在**
   [`ai-event-tool-contract.md`](ai-event-tool-contract.md) §7。口径只从生成器的 `countsAsCovered()` 取，
   门禁自己不重读上游。三条判据：分母算术对账、每个分母实体"要么读写齐、要么带 `AI-COV-<n>` 登记"、
   以及"**模型可选得到**"（工具必须在 `listAuthorizedTools()` 的投影里，光在目录数组中不算）。
   🔴 **现量（10-04，命令 `node scripts/check-ai-coverage.mjs`）：目录 26（读 12 / 写 14）、实体 9 里覆盖 9/9，`ENTITY_COVERAGE_DEBT` 台账是空的。**（本行此前不带日期地写着"现量 22 / 8-8"，于是它自己就变成了它警告过的那种过期抄件。）
   🔴 **同一批三条只读门禁在最新尖端复取（10-04 11:01，载体 = 干净检出 `heyta-wt-ai-closeout` @ `b3858356`，跑后 `git status` 空 ⇒ 不写盘）**：
   `check:ai-coverage` / `check:ai-tools` / `check:ai-quota` 三段全部 rc=0，本行的四个数**逐字未变**（26、9/9、45 席、mobile 0/5）。
   唯一动过的一枚是 `check:ai-tools` 规则 9 的**扫描分母**：`20 个 src 根 / 585 个源码文件` → `20 / 651`
   —— 那是别的条线往 `packages/` 里加了源码，**不是判据变了**；被约束的量（`host.submit(` 命中 **2 处 = 清单**、
   两个写入口各自恰好一处、`describeRoutedFailure()` 定义点恰好一处）三条读数一条没动。
   ⇒ 记这条是为了挡"引用的运行落后于实际跑过的运行"那第三种漂移：尖端每走一笔，"上一次读数是哪一趟"就要重取一次，
   并且要写明**哪一维动了、哪一维没动**，否则下一个读者会把分母变化读成不变量松了。
   ⚠️ 本节先后出现过三组数，都已过期，按时间排：「6 个工具 / 覆盖 2」→「9 个（读 4 / 写 5）/ 覆盖 3」→
   现在的 22 / 8。前两组的错法**不一样**，值得分开记：第一组是 `covered` 判"有任一工具"，
   把只读的 `PROJECT` 计成已覆盖（口径问题，见契约文档 §2.1）；第二组只是**同一批早几个小时的抄件**
   （搬运问题）。⇒ 同一份文档里连续两次数字错，原因可以完全不同 —— 别把第二次当第一次的余波修掉。
   🔴 **初稿写"剩下五项卡住的地方不是'没写'，是一条要产品拍的算术"**
   （`local-api.spec.ts:87` 的 `<= 10` vs 每实体一读一写 ⇒ 只剩 1 席、需要 10 席）——
   **这个判断是错的**：冲突是真的，但它不需要人拍，因为**那条上限的单位写错了**。
   总量从来不是用户要理解的负担，**逐工具的授权清单**才是，而清单天然按实体分组。
   换成 `MAX_TOOLS_PER_ENTITY`（每实体 5，四档推导见 `shared.ts` 的注释）后冲突自动消失，
   并且新判据比旧的**更严**：旧的那条下，TASK 一家吃掉 10 席中的 5 席不会响。
   ✅ 五项缺口全部落地：`TAG`（`list_tags` / `create_tag` / `set_task_tags`）、
   `NOTE`（`list_notes` / `get_note` / `create_note` / `update_note`）、
   `HABIT_LOG`（`list_checkins` / `record_checkin`）、`FOCUS_SESSION`（`list_focuses` / `log_focus`）、
   `REMINDER`（`list_reminders` / `create_reminder`）。**每条都带行为判据 + 至少一条变异**
   （现量读数在契约文档 §8，含一条未变异的正向对照）。
4. **另外六条已登记的缺口**（都不阻塞使用，但别读成"已做"。
   现量：这一节 2026-10-03 列了六条子项，其中「会话历史只在内存里」那条
   **已经关闭**（下面划掉那条）⇒ 实际还开着的是**五条**）：
   - **循环里没有"规则先跑、命中即零出境"的短路**。单步面板有
     （`ai-tool-call.ts`：规则命中直接执行，一次请求都不发），助手的多步循环**没有** ——
     因为一句自然语言在 loop 里可能同时要"查 + 改"，规则层认不出组合意图。
     代价是：即使用户说的正是"列出所有任务"这种规则能答的话，也照样出境一次。
     方向是**保守的**（多出境而不是少出境被静默放过），但它是 §5 第 3 条
     "规则优先"立场在助手侧的一处**未收口**。
   - ~~**会话历史只在组件内存里**，刷新即失（ADR-0045 的 D-4 未拍）。
     已知代价：刷新丢上下文，而「新会话」按钮与它长得一模一样。~~
     ✅ **D-4 的 (i)「只进本机」已落地（2026-10-03，产品拍"开始做"）**：
     `apps/web/src/features/ai/assistant-history.ts` + 面板接线，
     判据在 `apps/web/tests/assistant-history.spec.ts`（18 条）与
     `assistant-history-panel.spec.tsx`（8 条），四条接线的变异读数在
     `apps/web/tests/mutate-assistant-history.mjs`（N1 恢复 / N2 提案失效 /
     N3 空会话删盘 / N4 存在哪儿的声明，各带预期红数）。
     🔴 **两处被实测改写的说法**，都留在原地而不是删掉：
     ① 面板文件头"明文进 `localStorage` 等于新开一处敞口"——加密只在上传那一步
     （`sync-client/src/client.ts:873`），本地 `state` store 里本来就是解开的实体，
     所以这条**不是新增风险，是既有现状**；这个仓库的线画在"口令/密钥不落盘"。
     ② `newSession()` 里我多写了一次 `clearAssistantHistory` —— 变异摘掉它 **0 红**，
     因为落盘 effect 的 `items.length === 0` 分支已经删了；多余的那次已删，
     变异锚点也搬到了真正承重的 effect 那一支。
     ✅ **D-4 的 (ii)「跨设备会话实体」已拍并已落地（产品负责人 2026-10-05 拍"做"）**。
     裁决与新实体逐条在下面这段，实现状态跟着一起写在这里（不留两套状态）。

     🔴 **实体粒度：一条消息 = 一个实体**（`ASSISTANT_TURN`），不是"整段会话一个实体"。
     理由不是风格：会话级实体要把 `turns` 整个数组当载荷写，而本引擎的 LWW
     **在数组上是覆盖语义** —— 两台设备各追加一条，胜出那条会把对端刚追加的一整条
     吞掉，且**没有任何一层会报错**。一条消息一个实体时"只增不减"是结构给的。
     行为版判据：`packages/op-log/tests/assistant-turn-convergence.spec.ts`
     第 3 条（两台设备各追加一条 ⇒ 两条都在）。

     🔴 **跨设备可确认性**（那条实体方案原先欠着的第三个问题的答案）：
     **改动提案的可确认性只在产生它的那台设备上**。判定在
     `packages/domain/src/assistant-turn.ts`（`assistantTurnIsConfirmableHere` /
     `assistantTurnIsExpiredHere`），依据是载荷里显式的 `originClientId`，
     **不是**归约器的 `_lastClientId`（理由写在 `AssistantTurn.originClientId` 上）；
     写侧 `setDisposition()` 在**构造 op 之前**就拒绝，所以这条不是界面装饰。
     反面同样钉住：**本机自己写的未确认提案不算过期**（变异 M6 专打这一半）。

     纯可加性变更，**没有 bump `CURRENT_SCHEMA_VERSION`**，逐点清单照 `EVENT`
     （`docs/plans/countdown-anniversary.md` §3 的 W2）与 `PREFERENCE_CORRECTION`
     （ADR-0014）：`ENTITY_TYPES` → `EntityModelMap`/`MODELED_ENTITY_TYPES` →
     `BUCKET_BY_ENTITY` → `packages/ui/src/sync/model.ts` 的 `ENTITY_LABEL_KEYS` →
     中英词条 `common.entity.ASSISTANT_TURN` → op 构造在
     `packages/app-host/src/assistant-session-actions.ts`。
     服务端白名单**零改动**：`ALLOWED_ENTITY_TYPES` 是从 `ENTITY_TYPES` 派生的
     （`server/src/sync/services/validation.service.ts:25`），另建一份就是第二套词表。
     🔴 部署顺序仍是硬的（§2.1 同一条）：**服务端先于客户端上线**，
     否则老服务端回 `INVALID_ENTITY_TYPE` 永久拒绝那条 op。

     覆盖面分母的联动在**生成器的真源**：`scripts/gen-ai-capability-manifest.mjs` 的
     `DENOMINATOR_EXCLUSIONS` 加了第三条（对话记录不是用户可操作的业务实体，
     而且正文里含 provider 的回复），产物 `capability-manifest.generated.ts` 重生成，
     分母算术由 `check-ai-coverage.mjs` 9a 钉住。

     ⚠️ **两条仍然开着的边界**（不要把这段读成"三端已接"）：
     ① **界面接线未做**：web 的 `AssistantPanel.tsx` / `aiStore.ts` 与
     `packages/app-host/src/ai-assistant.ts` 此刻正被并行会话重写（档位抽取），
     本轮**没有**把它们接过来 —— 现在的调用方是
     `apps/node-host` 的 `assistant` 命令（真实 SQLite、真实进程）。
     ② 目的地档位**没有"局域网"这一档**：沿用 `supply.ts` 既有裁决
     （只认字面回环，局域网按 Joplin 先例判远端），所以局域网的答案落
     `'third-party-endpoint'`。要改那一档得先改 `supply.ts` 并动它的判据。

     🔴 **一条可迁移的判据教训（本轮自己踩的）**：把变异打在
     `packages/domain/src/assistant-turn.ts` 上、再去跑 `@heyta/app-host` 套件 ⇒ **0 红**。
     因为 app-host 经**包解析**读的是 `packages/domain/dist` 的产物 ——
     这是 §7 第 27 条（"测试绿 ≠ 当前产物"）的**第三种面目**：前两种是"只改 packages/ 时
     APK 打进旧 bundle"和"验收脚本只验不装"，这次是**变异本身**改源码、判据读产物。
     修法是让判据落在"改了源码就立刻 measurable"的那一层（domain 自己的 spec 用
     相对路径 import `../src/`），而不是给变异脚本补一次 build。

     🔴 **并且更正我上面写过的一句**：这里原本记成"移动端接线漏了，
     同一判据要接 `apps/mobile/src/prefs/device-prefs.ts`"—— 那个框架是错的。
     实测 `apps/mobile/src` 里 `requestAssistantTurn` / `AssistantPanel` / `assistantTier`
     **零命中**：移动端按 ADR-0045 §5.5 **根本没有助手入口**，
     所以这一层不是"漏接一条本机通道"，是"还没有那个界面"。
     等移动端真有助手时，落盘那条要按 §3.5 抽到宿主无关层，而不是再抄一份。

     📌 **两条待入 `environment-traps.md` 的读数**（本轮不直接追加：那份台账此刻
     正被并行会话改着 —— 现量工作树 189 行 / `git show HEAD:` 186 行，
     往多人台账里追加会被对方那次 `git add` 整文件抹回去）：
     1. **测试文件自己就是 typecheck 的雷区**：这批两个新 spec 在 vitest 下 26 条全绿，
        而 `pnpm -r typecheck` 报 **14 处**（`readonly` 修饰符只能用于数组/tuple、
        `querySelector` 回来的是 `Element` 不是 `HTMLElement`、
        判别联合上直接取 `.text` 而 `error` 那一支没有该字段）。
        这是 §7 #162 的第三种面目：前两种是"build 的 dts 阶段才查"和"数失败用例要先 NO_COLOR"，
        这次是**判据本身**过不了类型 —— 判据红在类型上时它一次都没执行过，
        而 `pnpm --filter <包> test` 单独跑照样绿。
     2. **"落盘读不懂就顺手清掉"这条纪律，不能覆盖"读得懂但不是你的"**：
        实现里把账号不相等也接到了同一个 `drop()`（版本对不上/形状读不懂才该删），
        症状是"用户在这台设备上切换一次账号，另一个账号的对话就永久消失"。
        🔴 这条**不是**用事后变异照出来的，是第一趟跑判据就红了 2 条
        （`换一个账号读不到上一段的对话`：`expected 1 to be 0`；
        `未登录产生的对话，登录后不自动出现`：第二次读回 `null` —— 因为第一次已经删掉了），
        改的是实现而不是断言。同一次变异验证另外照出 `newSession()` 里那次
        `clearAssistantHistory` 是多余的（摘掉 ⇒ **0 红**，落盘 effect 的
        `items.length === 0` 分支已经覆盖）⇒ 删掉，变异锚点搬到真正承重的那一支。
   - **档位只存在于 Web 壳**（`apps/web` 的 `aiStore`）。其他壳零 AI 入口，
     所以这不是"漏配"，是"还没有那个界面"。
   - **`check:ai-capability` 还没有自己的包脚本**：能力清单的 `--check` 目前挂在
     `check-ai-tools.mjs` 的规则 7 上（`pnpm check` 会跑到）。之所以不新开一个
     `package.json` 脚本，是因为该文件此刻有**别的会话的未提交改动**，
     加脚本会把它们一起带走。等它干净时抽成独立判据。
   - 🔴 **覆盖面"跑满"之后新暴露的一条：每实体内的动作还有缺口**，而门禁看不到它 ——
     门禁只判到"这个实体有没有读+写"这一格。逐条台账（含每条"是还没做"还是"产品没拍"）
     在 [`ai-event-tool-contract.md`](`ai-event-tool-contract.md`) §5.4（`PROJECT` 的改名/归档/删除、`HABIT` 的改目标、
     `TAG` 的删除、`HABIT_LOG` 的撤销打卡、`REMINDER` 的改时刻/延后/忽略 等）。
     ⚠️ 容量上限换形之后，**"被上限挡着"这个理由已经没有了**，别再往它身上推。
   - ⚠️ **"要不要上 `search_tools` 式动态检索"这条已经到该重拍的点上了，本批没拍**：
     ADR-0045 §2.6 当初给的条件句是"目录到几十个时这条要重拍"，现在 26 个（10-04 现量）⇒ **前提已成立**。
     没拍不是拖延，是它要的是一个**实测**（22 条 JSON Schema 进 context 的 token 成本、
     以及检索改一跳之后的命中率），而本批没有真端点可测（托管 AI 未开 ⇒ 只能拿本机端点量，
     那测出来的数不属于任何一条产品档位）。**登记，不代拍**。
5. 🔴 **这一批没有跑 `pnpm reinstall:all`（AGENTS §6.1.1 的固定收尾），两件事都是理由**：
   - 并行会话正在用同一批设备（模拟器 / 打包机）跑移动端验收，`reinstall:all` 与
     `verify:mobile-*` 并发会把对方的取证现场踩掉 —— 这条禁令在 §7 里写过不止一次；
   - 更硬的一条：**此刻"当前源码"不是一个确定的东西**。四笔提交是按路径限定的，
     HEAD 里没有并行会话未提交的那半批改动，而工作树里有。拿工作树打出来的包
     既不是 HEAD、也不是"交付完成的那棵树"，装上之后"装的是当前产物"这句话
     没有指代对象。
   ⇒ 所以这一批的界面证据是**真浏览器 Playwright 的九张截图**（W12 的四张 + W5 的五张，
   每套都含暗色那张），它证的是 Web 壳里的界面；四端安装态等两条线都并进 main 之后由下一次收尾统一补。

   > 🔴 **上面这第 5 条的两条理由，10-04 上午各被消解掉一半（原句留着，因为它记的是当时的真实约束）**：
   > ① 第二条"此刻'当前源码'不是一个确定的东西"**已经成立地解决了** —— 办法不是等工作树变干净，
   > 而是**把载体换成一个纯快进到 main 的干净检出**（`heyta-wt-ai-closeout`）：HEAD 里就是这一批（集成线已落 main），
   > 工作树零未提交项，打包输入因此有唯一指代对象。等待期间 main 每走一笔，队列在**每次取闸门源之前**再做一次纯
   > `merge --ff-only`（不合并、不产生新提交；不是祖先或有脏就停手），所以"装的是当前产物"这句话在起跑那一刻仍然有据。
   > ② 第一条（设备共用）**没有被推翻，仍然是 ③ 的实际卡点**：另一条会话的 `pnpm reinstall:all` 从 03:12 起跑后
   > 卡在 macOS 公证（`notarytool submit --wait`，11:2x 现量：已 8 小时、累计 CPU 0.03 秒），它与我抢同一处固定路径
   > （`/tmp/heyta-macos-dist` + `/Applications/Heyta.app`）⇒ 两趟并跑会互相卸装。**逐条归属见 BLOCKED B76**。
   >
   > **③ 现在由一条交付队列驱动**（不再是"等下一次收尾"）：入口 `~/scratch-heyta/heyta-deliver-on-window.sh`
   > + 同名监督器，**每趟的现场证据落在 `~/scratch-heyta/deliver-<时分秒>-<pid>/`（`run.log` 逐事件、`rc.txt` 终码、
   > `reinstall.log` 四端逐段）**。退出码词汇与"为什么每种红都单独一档"写在那份脚本自己的文件头里 ——
   > **这里只留指针，不抄一份**（抄了就会漂，这是本仓库反复付过学费的那条）。
   > 判"这一轮到底成没成"只认两样：脚本打印的 `CHAIN-OK total=/pass=/fail=/env=` 汇总行，与 `rc.txt` 里的码；
   > 等满窗口按**环境无效**收尾（不是产品失败），监督器只会"再起一次队列"，**绝不自动起任何重装**。

### 7.3 一条必须记住的提交纪律

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

## 8. D-3 收口对账矩阵（2026-10-04 15:1x 本地 / 07:1x UTC；载体尖端 `44019d40`）

Goal 只有四件事，所以矩阵就四行。**每行的"证据"只写当场能复跑的读数**，
其余一律进"未闭合"那列 —— 依据 AGENTS §8 第 7 条（完成范围逐项对账）与 §7 元规则 2。

| 项 | 状态 | 证据（带载体） | 未闭合的那一半是什么 |
|---|---|---|---|
| ① 合并 | ✅ **已闭合** | 四条源提交在当前 `HEAD` 上逐条 `git merge-base --is-ancestor` **全部 IN**：`dd8f2210`、`f2d7ed40`、`fd34c42a`、落地那笔 `de296b9d`（B76 补记 #10 记的就是这次复量）。 | 无。⚠️ 但这条**只在"祖先关系"这一层成立** —— 落地之后 main 又前进了几十笔，所以引用 ① 必须带当时那个 SHA，不能写"三条分支已合并"就完事。 |
| ② 集成态验证 | 🟡 **当前尖端链读数已到手，只差链尾那一段没量到（10-04 21:0x）**〔🟡 ~~有载体的历史读数 + 本批自己那一层当场复跑~~ —— 这句被下面那枚读数取代了，它只讲"有历史载体"，而 21:0x 这一枚是**当前尖端**的〕 | 🔴 **这一枚是队列修好之后第一次真取到的**（补记 #15 那条恒假判据之前，阶段 2 的产物一律被丢弃）：`CHAIN rc=0 carrier=4a140cdd`、`CHAINV CHAIN-OK total=82 pass=80 fail=0 skip=1 env=1` —— `skip` 是 `check:ai-e2e` 按规则不跑（阶段 4 正在单独补它的读数），`env=1` 是链尾 `-r test` 被**别人的内存闸门**挡下（`82 -r test rc=1 1s env=BLOCKED(holder=58064)`）⇒ 记"没量到"，不记"过"。<br>✅ **于是 ② 那半"全仓 build/typecheck @当前 HEAD"闭合**：段 **02 `build` rc=0** 就是 `pnpm -r build`，段 **04 `typecheck` rc=0** 就是 `pnpm -r typecheck`（`node -e` 现量根脚本 `typecheck` = `pnpm -r typecheck`，链 **82** 段）。**② 现在只剩 `-r test` 需要在 `4a140cdd` 上再落一次。**<br>同趟 `STRICT_RED n=0`（Goal 点名的 `check:ai-coverage` / `check:ai-tools` 都在链里跑绿）、`OWN_GATES n=12`、`OWN_RED n=1 names=check:ai-e2e`（就是按规则不跑那一段，不拦 DONE）。<br>历史载体读数仍留档：链：73 段 @载体 `187057bb`（64 绿 / 8 红 / 1 按规则不跑）、74 段 @载体 `d544d73c` 打印 `CHAIN-OK total=74 pass=64 fail=9 skip=1 env=0`；段数今天已到 **75**（`39c4ce47` 加的 `check:ios-native-bridges`，归它的主人复量）。<br>本批界面单当场：`apps/web` 与 `apps/landing` typecheck RC=0、`app-mount` 23 条、landing 1317 条、真浏览器 **24 条**（含"写工具只出提案、确认前不落库"那条隐私读数）、`check:design`/`ui-language`/`row-single-source`/`layering`/`selection-single-source`/`ai-tools`/`ai-coverage`/`ai-quota`/`legal-tools`/`claims` + `docs-link-check` **RC=0**。<br>✅ **`apps/web` 全量套件在当前 HEAD 上跑成了**（15:24:48 落盘，队列跑者第 6 次尝试）：`Test Files 132 passed \| 2 skipped (134)`、`Tests 1756 passed \| 13 skipped (1769)`、`Duration 20.31s`、**RC=0**、`NO_COLOR=1 grep -cE '✗\|failed\|FAIL '` = **0**。<br>🔴 **载体这一栏不许省，而它当时并没有被跑者记下来** —— 跑者脚本只把 HEAD 往 `.att` 里追加，而启动那枚 `.boot` 是 **0 字节**（重定向写进去的是"内存闸门拒绝"那三行，成功那一趟反而没写）。⇒ 我用**包含关系**补上，而不是猜一个号：**起跑 ≈ 15:14:42，跑者启动时的 `HEAD` 实测 = `d45fad0c`**（`git rev-list -1 --before='2026-10-04 15:14:42' main`），完成时已到 `8590ae02`；而 `git diff --name-only d45fad0c..8590ae02 -- apps/web packages` = **0 个文件** ⇒ 这枚读数对**当前 HEAD 同样成立**，因为它跑的就是当前那棵 `apps/web` + `packages` 树。<br>补一句"拒绝长什么样"（这是 5 次拒绝的形态，别把它当成测试失败）：`内存闸门拒绝启动：已有测试在跑（pid=…，锁 /tmp/tfa-test.lock）`，rc 非 0、日志只有那三行。 | 🔴 ~~`apps/web` 全量套件在当前 HEAD 上没跑成：内存闸门连着 5 次拒绝启动，排队跑者仍在重试，这道读数没有之前不许写"web 全量已过"~~ **这一条在 15:24 被同一趟队列自己关闭了**（读数与载体在左栏）。原句留着，因为**它的成因仍然活着**：内存闸门（`/tmp/tfa-test.lock`）当天连续 5 次拒绝启动，而持锁人换过两届（先是别人那趟 `pnpm --dir e2e run test` pid 21302，最后挡路的是 `scratch-owner-transfer/rbac-d2/push-gated.test.mjs` pid 98897）—— **闸门拒绝不是测试失败**：它的形状是 rc≠0 + 日志只有"内存闸门拒绝启动"那三行。下一轮读到 rc≠0 先分辨这两者，别把门的拒绝记成产品的红。<br>另：全量 `pnpm -r build` 那句"18 项 Done"是**别的线 06:24 那趟隔离副本**的读数，不是当前 HEAD；`-r typecheck` 当前 HEAD 也未整仓跑。⚠️ **这两句没有被上面那趟覆盖** —— `apps/web` 一个包的套件不等于全仓 build/typecheck。<br>🔴 **剩下这半为什么这会儿不起**（15:3x 现量，明细 `BLOCKED.md` B76 补记 #12）：全仓 `pnpm -r build` + `-r typecheck` 是占核的重活，而此刻 `vm.loadavg` = **12.07**、阈值 **12**（16 核 × 3/4）⇒ 窗口本来就是红的。更关键的是负载地板里有一枚**永远不会结束、也没有任何人能收到它的结果**的孤儿进程（vitest worker pid 29644：`ppid=1`、cwd 指向已删除的 `heyta-wt-hierarchy`、`git worktree list` 里 0 命中、CPU 8 秒 +8.0 秒 = 一整核满转 16h46m）。⇒ **本线不碰它**（不是我 spawn 的，按 `AGENTS` §8 第 9 条那一路），只把三条取证与 `kill 29644` 交出去；**窗口开不了要登记成读数，不许写成"② 已闭合"**。<br>✅ **10-04 20:5x 一句能省一次重活的更正**：这半**不用另排一条命令** —— 交付队列的阶段 2 里，`heyta-chain.sh` 的第一段就是 `pnpm -r build`（20:34 那趟现量段 2 `build rc=0`），`pnpm check` 链第 4 段是 `pnpm typecheck`，而 `node -e` 现量根脚本 `typecheck` = **`pnpm -r typecheck`**（链段数 **82**），链尾第 76 段是 `pnpm -r test` ⇒ **② 剩下的那一格与 ③ 用的是同一个窗口**：任何一趟跑到阶段 2 完成，② 的"当前尖端全仓 build/typecheck"读数就同时到手。<br>🔴 **顺带挡掉一次必然会犯的错**：那四枚被丢弃的读数**不能**拿来当 ② 的当前读数 —— `git log --oneline 58e43418..HEAD` 现量 **18 笔**，`git diff --name-only 58e43418..HEAD -- packages apps server scripts e2e` = **146 个文件** ⇒ 每一枚只对它自己那个尖端成立，跨尖端引用就是"引用的运行落后于实际跑过的运行"那一族（补记 #15 修的是"读数为什么被丢"，不是让旧读数复活）。 |
| ③ 交付：四端重装 | ❌ **未交付（环境无效，如实记录）**〔🔴 **10-04 20:4x 更正这句的归因，原句留着不删**：「环境无效」只在**此刻**成立，不是这十一小时的成因。17:29 / 18:33 / 19:16 / 20:34 那四趟链**都量到了可完整归属的读数**（`grep -H "^CHAINV" ~/scratch-heyta/deliver-*/rc.txt` 现量 4 枚 `CHAIN-OK total=76 …`，载体 sha 与分母全对上），却被队列里**一条恒假的判据**逐枚丢弃 —— 消费者拿精确裸串 `CHAIN-OK` 去比生产者带明细的成功值（`:656` 那个 `case` 与 `:955` 那道守卫），于是每一轮都印成"环境未就绪"并重起。⇒ **那不是窗口没开，是走不到取读数的地方**；修法、八向取证（候选 11/0，变异腿喂改前文件 3 条红）与"为什么这不叫放宽判据"都在 `BLOCKED.md` B76 补记 #15。修好之后 ③ 的卡点才**只剩负载那一格**（20:45:56 现量 `负载 27 > 12`，阈值一条没放宽，红线口径不变）。〕 | 🔴 **承重的那条不是 CPU，是服务端台账**（四条完整证据在 `BLOCKED.md` B76「③ 那条'唯一可能没有终点的前置'」那一段）：只读地问了一次 `notarytool history` ⇒ 49 条记录 **45 Accepted / 4 Invalid，`In Progress`/`In Queue` 零条**，而最新一条 `createdDate` = `2026-10-03T15:05:06Z`，比这枚进程起跑（本机 10-04 03:13）**早约 4 小时** ⇒ 这一次 submit **从未在服务端建立过提交记录**，所以停掉它不丢任何服务端进度。<br>~~现场读数两条独立……这不是"慢"，是死等~~ **15:2x 的推理更正（原句留着，不悄悄删）**：那句"是死等"当时靠「CPU 恒 `0:00.03`」+「零套接字」立论，而**这两条单独都分不清"死等"与"合法的 `--wait` 轮询"** —— 两次轮询之间本来就可以没有连接，而一轮轮询的 CPU 只是毫秒级。⇒ **结论不变，换的是承重证据**（换成上面那条服务端台账）。<br>**15:2x 现量**（一条前台命令直接出时序，不落中间文件）：`etime` 从 `12:12:34` 走到 `12:13:30` 的 56 秒里采 12 次，累计 CPU **12/12 全是 `0:00.03`**（`time` 是累计值不是瞬时快照，所以这才是"零增量"的正证）、网络 FD **12/12 全是 0**；阳性对照同一趟 `lsof -nP -iTCP:443 -sTCP:ESTABLISHED` = **88** ⇒ 那个 0 是真读数，不是探针看不见套接字；98934 的 26 枚 FD 全是 `txt`（dyld / DiskImages framework / ICU 表）加 fd 0/1/2，**`Heyta-1.0.0.dmg` 命中 0** —— 既没在读那个文件，也没在传。<br>⚠️ 「`/tmp/heyta-reinstall-mac.log` 停在 03:13 没再写」**不算独立证据**：那条腿是 `notarytool … \| tail -8 \| awk`，而 `tail -8` 在 EOF 之前一个字都不会吐 —— 日志静默与"子进程沉默"在这条管道里是同一个形状。<br>占位 PID 现量 `queue-reinstall-all.sh` 81007/93771、snap 93817；设备面 5 台 Booted + 1 台 adb；负载 **13.66** > 阈值 12（15:2x 复量，12:4x 那趟记的是 16.06）。 | 🔴 **Windows 那条腿的"证据面"是空的**：`fd34c42a` 把"装完自动写桌面快捷方式"做成了硬判据、`5fe19343` 把五项清单搬进单一所有者并两处都改成会失败，但 `e8508736` 当场登记 **`SHORTCUT_OK` 这条腿的证据面为空**（且"五事实对账"原来能被一句散文满足）。⇒ **快捷方式这件事"代码 + 门禁已落地"，"读数"必须等一趟真的重装跑完打印出来**，二者不许混写。<br>起装本身被上面那趟挂死的运行挡着：`reinstall-all.sh` 第一步就是 `adb uninstall` / `simctl uninstall`，现在起 = 清掉别人的设备现场。 |
| ④ 台账 | ✅ **四项都有了（10-04 20:5x 现量）**〔🟡 ~~BLOCKED 已逐条打勾，PROGRESS 那一行仍卡在别人手里~~ —— 后半句到 20:5x 过期，PROGRESS 那行已进 HEAD，见右格〕 | BLOCKED.md **B76 补记 #10**（`425e83c3`）：① 复量、③ 第二条独立证据、占位 PID 换代、旧复现命令标成"那一代"并补新五条。traps 编号现量：活树最大号 **246**、HEAD 228，台账本体被别人 +355/−7 占着 ⇒ 三条载体教训按"脏台账不追加"的纪律落在工单的具名小节（`ff22777c`）。死链：`docs-link-check` RC=0；`check:doc-citations` RC=0 且 SELFTEST 三维都抓到。 | ✅ **PROGRESS.md 那一行已进 HEAD**（载体 `cf697ebf`；`git show HEAD:PROGRESS.md` 内 `'④ 收口对账'` 命中 **1** 处，且 `git status --porcelain -- PROGRESS.md` 现量**空**）。落法就是补记 #14 设计的那一条：我这行留在共享工作树里**悬着不提交**，随他们那次整文件提交一起走 —— 署名让给对方是这一招的**成立条件**而不是缺陷；反面那条（plumbing 造 `HEAD+我的行` 那枚 blob）会被他们下一次 `git add PROGRESS.md` **抹回不存在**。<br>~~🔴 PROGRESS.md 那一行还没落：+41/−1 未提交（登记改道时是 +23，还在长），两种提交办法都不许用（整文件 `git add` 会带走别人的行；HEAD+我的 EOF 追加会被别人随后整文件提交抹回去）。待办那句原文有效、继续由"文件干净时收口的人"搬：见 B76 改道那一段。~~ |

### §8.1 五条隐私红线在收口尖端上的复量（载体 `a1bafd77`，10-04 15:3x）

界面单 + 四笔收口合进来之后重跑一遍，结论一字未变：`check:ai-tools` / `check:ai-coverage` /
`check:ai-quota` **三个 RC=0**；覆盖面 `9/9`、目录 `26 ≤ 每实体 5 × 9 = 45 席（剩 19）`、
`已登记缺口 0 项`；`CURRENT_SCHEMA_VERSION = 1`；`retention-undecided` 仍 4 处（托管 AI 仍被挡）。
门自己的话最要紧：**规则 9 穷举 20 个 src 根 / 654 个源码文件，`host.submit` 命中 2 处（= 清单）**，
两个写入口各自恰好一处（助手 `confirmAiToolProposal()` / MCP `executeTool()`）。

🔴 **这一趟我自己的探针是坏的，值得留一行**：我先用
`grep -rn 'host\.submit(' … | grep -vc '^\s*//'` 想"剔掉注释再数"，量到 **4**，第一反应是"写入口多了一枚"。
错在 `^\s*//` 作用在 `文件:行:内容` 这一整行上，**行首是文件名，永远匹配不到注释**，
所以那个 4 是"含注释的全部命中"。逐行读回来才是真相：`ai-tool-run.ts:195` 与 `server.ts:590` 是调用，
`server.ts:526` 与 `AssistantPanel.tsx:24` 是文档表格/说明里的字面串。
⇒ **这条不变量的权威读者是 `check:ai-tools` 规则 9，不是我的 grep**；用它当判据的前提是
**先确认自己的过滤作用在哪个字段上**（同一族：判"非注释命中"要按内容列切，不按整行）。

**这一矩阵存在的理由**：③ 的两个半件事（快捷方式的**判据**与快捷方式的**读数**）此前在本线文档里被写成同一件事。
"代码落地 + 门禁会失败"是真的，"装出来的桌面上有那个快捷方式"**从来没有过读数** ⇒ 分开写之后，
下一轮重装跑完要取的就是 `SHORTCUT_OK` + `PAYLOAD_WEBDIST=True` + `M2D=OK` + sha256 对账这四枚字面量。

**复跑命令**（只读，不起负载）：

```bash
for c in dd8f2210 f2d7ed40 fd34c42a de296b9d; do git merge-base --is-ancestor $c HEAD && echo "$c IN"; done
find /tmp/heyta-reinstall -newermt '-2 hours' -type f | wc -l
ps -o pid,etime,time,command -p 98934                     # notarytool 是否还挂着
lsof -nP -p 98934 | grep -cE 'IPv[46]'                    # 网络 FD（单点读数，配合下一条一起看）
lsof -nP -iTCP:443 -sTCP:ESTABLISHED | grep -c IPv        # 阳性对照：探针能不能看见套接字（15:2x = 88）
lsof -nP -p 98934 | grep -c 'Heyta-1.0.0.dmg'             # 它有没有在读写那枚 dmg（15:2x = 0）
git status --porcelain docs/reference/environment-traps.md PROGRESS.md   # 两本台账在谁手里
grep -c '^## 8\.' docs/plans/detail-pane-alignment.md    # 本副本；分支那侧要 git show <branch> 另量
```

🔴 **上面那枚"零套接字"单点读数不许单独引用**（这一句是给下一轮的，不是给本文的）：
它只有在和**累计 CPU 的时序**（12 次采样恒 `0:00.03`）以及**服务端台账零记录**放在一起时才有含义。
要重取时序，用一条**不落中间文件**的前台命令：

```bash
for i in $(seq 1 12); do printf "%s cpu=%s etime=%s netfd=%s\n" "$(date '+%H:%M:%S')" \
  "$(ps -o time= -p 98934 | tr -d ' ')" "$(ps -o etime= -p 98934 | tr -d ' ')" \
  "$(lsof -nP -p 98934 | grep -cE 'IPv[46]')"; sleep 5; done
```

### §8.2 载体教训：公共 `/tmp` 文件名不能当证据载体（待入 traps ~~#247，现量活树最大号 246~~ **#262**；17:4x 现量最大号 261 —— 那个 #247 已被别人用了四小时，「待入 #N」里的 N 是取号那一刻的读数不是承诺）

15:2x 这一趟实测到的，而且**它差点让我记下一条错读数**：

- 我把采样器写成 `/tmp/notary-sample.sh`，输出落 `/tmp/notary-sample.txt`，用后台任务跑再 `cat` 回来。
- 后台完成通知回读到的那份内容里，出现了一枚**我的脚本里根本没有的字符串**（我的脚本写的是
  `"<时刻> gone"`，那份输出里是 `"process gone"`），而且行序自相矛盾（`SAMPLE_DONE` 排在 20 行采样之前）。
- 待我改在前台重跑时，`/tmp/notary-sample.txt` **已经不存在了**（`head` 报 No such file），
  而 `/tmp/notary-sample.sh` 的 md5 与内容仍是我的那一份。
- ⇒ 我**弃掉那一整份读数**，改用上面那条无中间文件的前台时序命令重取。
  如果照那份读下去，结论会是"98934 已经退出"—— 而它当时（和现在）都活着。

**为什么单独登记这一条**：本机同时有 3–4 条会话在写 `/tmp`（`ls /tmp` 里那些 `731xx-block.md`、
`*-draft.md` 就是别人的工单草稿），文件名撞车是常态而不是意外。
仓库里已有的那条"证据 md5 会被别人的趟重写而无人报红"讲的是**产物目录**，这一条是同一个失效模式
在**临时取证文件**上的面目，而且这里更隐蔽：**它不是覆盖内容，是把别人的内容与我的混在同一个文件里**，
于是读数会"看起来合理"却指向另一个对象。

**改法（不是"少用 /tmp"）**：取证命令**直接把读数打到 stdout**；确实需要落盘时，文件名带上本趟 pid
与前缀（`/tmp/heyta-<线>-<pid>.txt`），并在读回后**先确认字符串集合是本项目产生的**再引用它。


## 9. 2026-10-05 合并批收尾：抓出来但**没做完**的两张（W15 / W13 的设备半）

> 载体：隔离检出 `heyta-wt-merge`，分支 `merge/20261005`。本节只登记**现量**与**归属**，
> 不代任何一张主张完成。

### W15 🔴 `ASSISTANT_TURN` 只有 `node-host` 在写，两枚 UI 壳都没接

`check:reachability` 判据 C 在本批尖端当场报红：

> `ASSISTANT_TURN 有写路径，但 ACTION_FAMILIES 里没有它的宿主 action 家族 —— **无法判定**。`

这条红是 `10b53a81`（D-4 (ii) 跨设备会话实体）**自己带出来的**，也是这张门禁设计的用途：
新实体不许悄悄跳过 C。处置分两步，第二步没做：

1. ✅ 把家族登记进 `ACTION_FAMILIES`。合法性按 `REMINDER` / `NOTE` 那两行已有的纪律核过：
   `createAssistantSessionActions` 真存在（`packages/app-host/src/assistant-session-actions.ts:155`，
   `index.ts:820` 导出），宿主有真实生产调用点（`apps/node-host/src/host.ts:273`）。
   **牙齿现量**：把那枚唯一调用点改名 ⇒ C 报"apps 下各宿主的 src/ 里**零调用点**"、`REACH_RC=1`；
   还原后 `cmp -s` 逐字节相同、门禁回到 RC=0（读数 `tmp/reach-mut.log`）。
2. 🔴 **没做**：`apps/web` 的助手对话仍然只落本机 `localStorage`
   （`apps/web/src/features/ai/assistant-history.ts`，D-4 (i) 那条路径**没有被替换**），
   `apps/mobile` 完全不写会话实体。⇒ 引擎与协议层已经能跨设备同步一段对话，
   但**用户在 Web 或手机上得不到这件事**。判据 C 只回答"≥1 枚宿主接了"，
   它结构上看不见"另外两枚没接"，所以这一半只能靠本节的台账活着。
   开工时的形状：写入走 `createAssistantSessionActions`（业务语义留在 app-host，AGENTS §3.5），
   读侧改吃 op-log 的物化投影，**并且**把 `localStorage` 那条**删掉**而不是并存 ——
   两份历史 = 两个事实源，那是本仓库反复踩过的那类"抽出了新的、没删旧的"。

### W13 的设备半：验收载体**已建成**，第一趟读数在下面（2026-10-06 00:0x 起）

`a9f0867a` 落了移动端助手入口 + 五项接线，`check:ai-coverage` 对 mobile 从 `0/5` 转正。
但那条工单原本要求的判据是"**至少一条真模拟器 E2E，零 mock**"（§3 那张表里 W13 那一格）。
**这一格在 2026-10-05 22:5x 写下的"载体尚未存在"已被自己否证** —— 那是一句瞬时读数，
当晚 `scripts/verify-mobile-ai.sh` 与根 `verify:mobile-ai` 就落了地。
现量（取现量用 `node -e "const p=require('./package.json');const k=Object.keys(p.scripts).filter(x=>/^verify:mobile/.test(x));console.log(k.length, k.filter(x=>/ai|assistant/i.test(x)).length)"`）：
`verify:mobile-*` 若干条里覆盖助手的**恰好 1 条**，就是 `verify:mobile-ai`。

载体的形状照 `verify:mobile-edit` 那批：真模拟器 + 真服务端 + 只绑回环的**可数**假端点，
并且每一步都带**反向对照**：

| 步 | 判据 | 反向对照（没有它，"没观测到"分不清是没发生还是探针坏） |
|---|---|---|
| 2 | 未配端点时「AI 助手」入口整行不在 AX 树里 | **邻锚同帧**：`profile-entry-habits` 与 `profile-entry-trash` 必须同帧都在 ⇒ "它们之间那一格的缺席"才是没渲染，而不是裁切线以外 |
| 5 | 规则能答的意图**零外发**（假端点计数不动） | `NO_MATCH_PROMPT`（"write a haiku about rain"）同屏再发一次 ⇒ 计数**必须 +1** |
| 5 | 绑定真的生效 | 判据放在**被绑那一侧**：`tool-start-assistant` 的 `enabled` 必须为 `true`（不拿 `selected` 当判据，理由见下） |

配套的常驻门禁 `check:mobile-ai-anchors`（不占设备）把锚点这一类缺陷拦在设备窗口之外：
rid 锚点逐条对回源码的 `testID`（字面或模板模式）、`desc/text` 字面锚点逐条对回词条、
块内那一指必须落在**可点的那一层**。臂数由 `--self-test` 自己打印（本文件不抄）。

#### 建载体当场照出来的两条**产品侧**缺口（不是脚本问题，登记后没硬压）

1. 🔴 **Android 无障碍树读不到选中态**。`apps/mobile/src/ui/kit.tsx` 的 `Chip` 写了
   `accessibilityState={{ selected }}`，而 rig20 现量：整棵 `uiautomator dump` 里
   `selected="true"` 命中 **0** 枚。后果超出验收 —— 用 TalkBack 的人**听不出哪一档端点被选中**。
   闭合路径：RN 侧把选中态同时表达成 `accessibilityState={{selected, checked}}` 或直接换
   `role="radio"`/`accessibilityRole="checkbox"`（Android 对 `checked` 有映射），
   判据 = dump 里数得出非零，且 `verify:mobile-ai` 第 3 步能把 `↷ 读数` 从"恒空"变成有值。
   ⚠️ 载体不能替它编读数，所以第 3 步现在只打印、不判定，生效与否由第 5 步的 `enabled` 兜住。
2. 🔴 **规则前门是中文-only，英文界面 100% 走不到它**。`packages/app-host/src/ai-tool-selection.ts`
   十二条 `pattern`（现量 `grep -c 'pattern:' 该文件`）除一条带 `todo` 外全是中文词头。
   这**直接削弱 Goal-1 那条不变量**：界面切到英文后，"列出所有任务"这类本可本机答掉的意图
   一条都不命中规则 ⇒ 每次都发出请求。与"零外发"红线是同一条不变量的另一半。
   闭合路径：每条规则补英文别名（`list|show|what are` + `tasks|todos|lists|habits|tags|notes|reminders`），
   并把**两种语言各一条**钉进 `ai-tool-selection` 的用例；⚠️ 本轮未做 —— 它是行为变更，
   要连着"规则命中即零外发"的循环侧一起验，不与本批的载体收口混成一笔。

#### rig17 → rig21：三趟红都是**载体自己的**，逐条定源后修完（判据一条没放宽）

| 趟 | 症状 | 定源 | 修法 |
|---|---|---|---|
| rig17 | 起跑即 `rc=3`（APK 比源码旧） | 变异门禁 `writeFileSync` 还原了**字节**却没还原 **mtime**，`scripts/lib/apk-freshness.sh` 拿 `packages/*/src` 的最大 mtime 比 ⇒ 假红（traps **#326**） | 门禁 `finally` 里 `utimesSync` 还原 + 文末第二栏 mtime 对账（>2ms 判红）；残留收尸脚本带**三条前提**（树干净 / APK 之后无提交 / 锚点=该文件最后提交时刻）才 `touch -t` |
| rig18 | 第 5 步输入框有字，`tool-start-assistant` 仍 `disabled` | 两件事叠在一起：① `adb shell input text` 把**空格当语界** ⇒ 只落前半句、退出码 0（traps #43 追加子条）；② 端点建好了但**从没绑进 `routes[feature]`**（traps **#327**） | `scripts/lib/mobile-e2e.sh` 新增 `_adb_text`（空格发 `%s`）；验收脚本新增 `bind_all_routes` 五档逐条绑 + 第 3 步失败即点名是哪一档 |
| rig20 | 五档绑定**全红** | 块内那一指落在 `clickable="false"` 的**标签层**（`Pressable` 把 `content-desc` 挂在这层），点下去退出码 0、什么都不发生 | 新增 `xy_clickable_in_rid`：取"包含标签矩形且面积最小的可点祖先"；找不到可点祖先 ⇒ 打哨兵并由 `tap_in_rid` **响亮拒绝**（不再静默点空） |

设备读数（rig21→rig24 逐趟，载体在 `heyta-wt-merge`，设备 `emulator-5554`）：

| 趟 | 读数 | 这一格证明了什么 / 还欠什么 |
|---|---|---|
| rig21 | 通过 10 / 失败 0 后**中止**在第 3 步：五档里前三档绑上、后两档"滚不出来" | `xy_clickable_in_rid` 在真设备上落对了层（日志打 `[clickable-ancestor] @ 235,2057`）；后两档是被**焦点吞掉的手势**（traps #328-②） |
| rig22 | 中止在第 3 步更早处：`行 0→1` 与 `chip 命中=0` 并存 | 端点**存进去了**，是探针用 `text=` 去找挂在 `content-desc` 上的 chip（traps #328-③）⇒ 新增 `reveal_desc` |
| rig23 | 五档"滚不出来"、四格拦死 | **我自己新写的那条"画面没动"判据坏了**：参照锚是 `android:id/content`（永远不动，traps #328-①）⇒ 参照锚换成会位移的内容节点，并补臂 13/14 |
| rig24 | **通过 13 / 失败 2**：第 0–3 步全绿（含五档全部绑到那枚回环端点）、第 5 步走到"入口进树 → 五档 chips 全在 → 常驻脚注在屏 → 选中 tool-calling → 输入 → 发送" | 两条开项，各自定源，**不包装成完成**：<br>① 第 4 步 `ai-endpoint-label` 在安全带内取不到可点节点 —— 端点表单一共有四格，第二枚端点的表单此刻的滚动形状没取到，需要按 §第 3 步同样的"动作回读 + 摘焦点"重做那一格；<br>② 第 5 步发送按钮仍 `disabled` —— **两种成因没分辨**：五档路由真没写进 `routes[feature]`（AX 读不到选中态，见上），还是这一档的**逐功能同意**没给（`resolveRoute` 的候选集还要过同意）。决定性的一测量是**从设备库里读回 `routes` 与 `consents`**，而不是再猜界面 |

#### rig25 之后：库回读把那条"两种成因"关成了一个（同一次运行的设备状态，独立复算过）

取法现量：root + `adb pull /data/data/com.heyta/databases/heyta-device-prefs.sqlite`
（**这张表不在 op-log 那枚库里** —— `device_pref` 住在 `heyta-device-prefs.sqlite`，
`heyta.sqlite` 里查它会得到 `BAD:DatabaseError`；而 `run-as` 在不可调试的 Release 装机上只回
一行 42 字节的报错文本，`exec-out … > 文件` 的退出码属于重定向，所以那句报错会被当成"库"读进来）：

```
enabled=True  allowRemote=True  endpoints=1  consents=0
capture=1 breakdown=1 prioritize=1 duration-estimate=1 tool-calling=1
```

⇒ **第 3 步的点击真的写进去了**（五档各绑 1 枚），rig24 那句"路由没绑上"被设备自己否证；
⇒ 第 5 步 `tool-start-assistant` 仍 disabled 的成因落在**这一档的逐功能同意没给**（`consents=0`），
而第 6 步的载体设计恰恰是"同意联网但逐功能授权一律不给"—— 顺序在同意之前就要发送。

🔴 由此现出一条**产品侧**问题，不是载体的：`disabled = 文本为空 || route.target 未定义`。
按 Goal-1 的不变量，**规则命中本来就该零外发**，可这句判断发生在规则短路**之前** ——
也就是"一条根本不需要端点的本地回答"被按钮层要求先配好端点并给出这一档的同意。
两种收口方式（要拍板，别由载体替产品决定）：① 按钮的 disabled 表达式先过规则命中；
② 载体在第 5 步之前发一次这一档的同意。①是语义修正，②是把产品缺陷固化进验收脚本 —— **选①之前需要产品确认**。

⚠️ 边界：本表只覆盖 Android 模拟器这一腿。iOS 侧助手面零设备读数；`windows-pc` 本轮不可达，
所以任何需要**重打 APK** 的读数（例如把新的产品改动装进设备）本轮取不到，如实登记为未闭合。

#### rig26→29 逐趟现量（2026-10-06 21:0x–21:1x，`emulator-5554` + 真服务端 + 本机假端点，零 mock）

| 趟 | 读数 | 这一趟改掉/证伪了什么 |
|---|---|---|
| rig26 | 13 通过 / 2 失败 | 载体补上「向上够那一格」后第 4 步第一次跑到，报「行数 0→1」看着像一条隐私缺陷 |
| —— | **那条读数被证伪** | `endpoint_rows()` 数的是屏上 `ai-endpoint-*` 行，是**滚动位置的函数**；而上一笔刚给 `add_endpoint` 加了 `scroll_to_top` ⇒ 0→1 量的是尺（traps #330） |
| rig27 | **14 通过 / 1 失败** | 前后对比换成设备库回读：第 4 步读到 `1→1` 转绿 —— 明文非回环端点**确实存不进去**，`validateEndpointUrl` 那道闸在真设备上成立 |
| rig28 | 未跑完就中止（10 通过 / 0 失败后被顶死） | 从库里 `consents=0` 反推出「载体漏点逐功能同意」并加了硬判据；而 `ai-consent-<feature>` 是罩在 `{needs ? …}` 里的**条件渲染 Button**（`apps/mobile/src/ai/AiSettingsSection.tsx:407`），不需要同意时压根不渲染 ⇒ 新判据把整趟拦死（traps #330b） |
| rig29 | **14 通过 / 1 失败**（与 rig27 同形） | 那一格改成只登记（ⓘ 一行，不判红不中止）；仍开的只有第 5 步 `tool-start-assistant` 的 `enabled` |

#### rig30→41 逐趟现量（2026-10-06 05:3x–09:3x，`emulator-5554` + 真服务端 + 本机假端点，零 mock）

载体前置变了：`windows-pc` 现量不可达（`ssh` 报 `Operation timed out`），Android 产物走
文档化的显式例外 `HEYTA_ANDROID_LOCAL_GRADLE=1` 在**这台 Mac** 打（脚本大字印「这是本机执行」，
不是静默降级）。副作用是**换了打包机 = 换了 debug keystore** ⇒ `adb install -r` 报
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`，载体补了"卸载后全新安装"那一档出口。

| 趟 | 读数 | 这一趟改掉/证伪了什么 |
|---|---|---|
| rig30 | 未跑完就中止（0 通过 / 0 失败） | `装不上 app-release.apk` 后面什么都没带 —— 归因成本全压给人工复现。补：捕获 adb 原文 + 换键走 uninstall 重装；同时钉判据 ⑪（装包命令不许 `>/dev/null`、必须认 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`） |
| rig31 | 16 通过 / 1 失败 | 换键恢复生效（装上的是本机这一台打的产物）。唯一红：`tool-input` "滚了 5 次仍在安全带外 —— 界面形状或 testID 变了"，而真相是 `reveal_rid` **只有往下滚那一种手势**（traps #331） |
| rig32 | 16 通过 / 中止 | 只修了 `reveal_rid` 没修 `tap_rid` —— 同一个缺陷在两枚 helper 上，只修一枚等于没修。判据 ⑫ 扩到 `tap_rid`（方向由 y 与带子的符号选 + 第二趟摘焦点回顶） |
| rig33 | 16 通过 / 中止 | `tap_rid` 的"没找到"那一格误留在 pass 循环**里面** ⇒ 第 1 趟就 `return 1`，换方向永不执行。写成会红的**顺序**判据（臂 31）。这一趟同时拿到 `tool-start-assistant enabled=true`（rig16 以来第一次） |
| rig34 | 20 通过 / 1 失败 | 第 5 步旧判据「假端点计数上涨」在「只用本机」档**恒不成立**（blanket fetch 闸门在任何 fetch 之前就返回 `privacy-consent-not-granted`）⇒ 换成四条真判据；「规则命中⇒零外发」按三条中文输入通道的现量登记成**设备侧未覆盖**（traps #333/#334）。唯一红移到第 6 步「隐私开关锚点失效」 |
| rig35 | 21 通过 / 1 失败（`RIG35_RC=1`） | 第 3 步不再无条件逐档去点 `ai-consent-*`：回环端点下 `destination='none'` ⇒ 那一行按设计不渲染。期望值改由端点字面量推，两档各有判据，否定那一支自带整页分母（新 `scan_rids` + `SCAN-CAP`）；判据 ⑭ + 臂 35–39。第 6 步那红的真身也现了：**区块的两枚按钮互斥**，`consentRecord !== null`（含"已选只用本机"）那一支只有「撤回同意」，而载体找的是「重新作出选择」/「同意并联网」⇒ 恒空（判据 ⑩ 的 desc/text 对账把新锚点对回了词条） |
| rig36 | **21 通过 / 0 失败**，中止在第 7 步（`RIG36_RC=1`） | 第 6 步按状态机修对 ⇒ ✅「隐私层已切到同意并联网」。同时**照出下一格的隐藏假设**（traps #338）：第 7 步一直是 `add_endpoint` 排在 `open_ai_settings` 之前，它从前能过只因为第 6 步从没真的动过同意态；这趟那四格表单是**在「我的」页上**点的 ⇒ 报"非回环端点没存进去" |
| rig37 | 21 通过 / 0 失败，中止在第 7 步后半 | 顺序修好后断在**另一头**：存完端点还开着设置面，而 Modal 立着时底部标签不在树里 ⇒ 三次「我的」不在树里。改成 `leave_settings` 再 `open_ai_settings`（同 #83.1：探针留下的状态是后续判据的输入） |
| rig38 | **30 通过 / 0 失败**，`RIG38_RC=3`＝**本轮在环境上不成立**（不记产品失败） | 第 7/8/9 三步第一次跑到：非回环 ⇒ 授权入口出现、回环那一档不索取、换回回环 ⇒ 那一档入口**消失**（这三格读的是 AX 树，与通道无关，仍然算数）；披露步元素齐（目的地行 + 字段清单 + 「数据会离开设备」性质行）。🔴 同一趟里那几条**「假端点计数 0→0」不算数** —— rig39 把它们定源到载体（见下一行）。停在第 9 步的 `手机库读不出（BAD）`：`pull_phone_db` 把 `run-as` 排在 `adb pull` 前面，而 `pull_prefs_db` 头上早就写着为什么不行（traps #339）⇒ 42 字节报错文本冒充库文件；按修好的通道手取一次，`select count(*) from ops` 当场回 **1** |
| rig39 | **31 通过 / 1 失败**（第 9 步「没有提案卡」），第 10 步 `breakdown-apply` 缺席后以 `rc=1` 中止 | 失败真身**不在产品也不在界面**，在载体自己的两处：① `adb root`/`adb unroot` 各重启一次 adbd ⇒ **`adb reverse` 全被清掉**（A/B 现量：root 前 `host-20 tcp:4399 tcp:4399`，root 后输出空），而 `pull_prefs_db`/`pull_phone_db` 各含一对 root+unroot ⇒ 第 3 步第一次库回读就把后面每一发请求的通道拆了（traps #340）；② 本轮的桩压根没起来 —— `EADDRINUSE 127.0.0.1:4399`，端口上坐着**上一轮泄漏**的同一棵树的桩（pid 98095），而就绪循环只问"有没有人答"，于是借用了它（traps #341）。🔴 同一步那句 ✅「只看了提案、没点确认 ⇒ 手机库条数不变（1→1）」是**假绿**：屏上那时是"连不上端点"，没有提案可看 —— 否定判据没出示分母（#335 的第二种面目，这次出在通道上） |
| —— | **人工 A/B 先把产品这一侧钉住** | 手动补回隧道后在同一次会话里点「重试」（它退回披露步，不直接发）→「发送」：假端点 `/__requests` 当场多出 `{feature:"breakdown", systemHead:"你是一个任务拆解助手。把用户给出的任务拆成 3 到 8 个具体的、可执行的子项。"}`，界面出「拆解结果（4 项）」四条子项 + 「写入备注」/「不要了」+ 常驻那句「AI 只给建议：没有任何一条改动会在你确认之前写进去」；披露那句写成「将发往：stub-loopback http://127.0.0.1:4399/v1 模型 stub-model 数据不出设备」「将发送这些字段：today、title」。**这是手取的读数，不算 rig 的** —— 它只证明"设备→本机端点→提案卡"这条产品路径本身通着，红的是载体 |
| rig40 | **被机器重启打断，读数未取得** | `uptime` 现量：09:23 时 up 12 mins ⇒ 09:1x 那次重启把 adb server、模拟器、桩日志一起清走，`/tmp/rig40.log` 连现场带读数全没（我自己那条「可复现物不要住 /tmp」的记忆在此被第二次证实）。🔴 这一行**不记成产品失败也不记成环境判据通过** —— 它只是一次没跑完的跑。
| rig41 | **35 通过 / 1 失败**（`rc=1`，中止在第 11 步） | 三件载体缺陷修完后的第一次重取：`ensure_tunnel()`（重下 `adb reverse` + 从设备里打一发 `/__probe` + 读回 `probeHits` 必须涨）是**唯一一份**实现，**每一步第一发发送之前**调 `tunnel_or_environment_fail`（读不到 ⇒ `exit 3`，记环境不成立不记产品失败）；假端点加**归属判据**（`lsof -tiTCP:PORT -sTCP:LISTEN` 必须逐字等于本轮 `$!`，否则打印占位者的 pid/`lstart`/argv 并 `exit 3`，**不动别人的进程**）；第 9 步"不点确认不写库"改挂在 `PROPOSAL` 标志的 **elif** 分支上。🔴 两条红要分开记：**计数内那一条是第 7 步**（`ai-consent-breakdown` 不在树里），**第 11 步那一条是未计数的中止**（`summary … 1` 在 `bad()` 之外，所以"失败 1 项"里不含它）—— 我先把红归给了第 11 步，按日志逐行复看后更正。第 11 步的真身：助手层还立着时底部标签不在树里 ⇒ 三发「我的」全读空（同一形状见 `leave_assistant`），现在第 11 步与第 5→6 步都先走那份唯一实现。泄漏的上一轮桩与 `adb reverse` 由 EXIT trap 收走（traps #342） |
| rig42 | **40 通过 / 2 失败**（`rc=1`）—— 14 步**第一次整条跑完** | 第 7 步（非回环 ⇒ 授权入口出现、回环那档不索取）、第 8 步（未授权零外发 + 披露元素齐 + 性质行「数据会离开设备」）、第 9 步（提案卡 + 计数恰好 0→1 ⇒ "没点确认不写库"有分母）、第 10 步（确认后恰好 +1 条 TASK/UPD、UPD 键集合就是 `['note']`）、第 11/12 步（手机出去、笔记本读到 2 条 `source=remote`）、第 14 步（收尾两条判据：端口无监听者 + reverse 清单无 `tcp:4399`）**全有合法读数**。🔴 那 2 条红**都不在产品**：第 13 步的四条「❌ CHECK 没落盘」是截图对账自己解析坏了自己（tsv 三列写、两变量读 ⇒ 键列读成字面量 `CHECK`），而"失败 2 项"这个数字本身也是假的 —— 那一段的局部标志借用了台账的 `FAIL`，`FAIL=0` 把先前的红清零、循环里的 `FAIL=1` 又被末尾那条 `bad()` 当成 1 再加一次（traps #344）。同趟查出输出里有 7 行 `echo "   ✅ …"` 打印了结论却不进台账（47 行 ✅ / `PASS=40` 的差额就是它们） |
| rig43 | **27 通过 / 0 失败**，中止在第 7 步（`未跑完就中止`，`rc=1`） | 判据 ⑲ 那批修法本身没问题（局部标志改名 `shot_bad`、逐图红走 `bad()`、tsv 列数按 `\t` 切段数、中间凭据带 `$$`、7 行自称 ✅ 升成 `ok()`）。这轮断在**载体标记选错**：`goto_me_page` 要 `content-desc=立即同步` 出现才算切到「我的」页，而那一枚在自动同步 loading 时不渲染 ⇒ 三发全打"标记没出现"，第 8–14 步没有屏可点；🔴 所以第 13 步的截图归属读数这一轮仍未取到。**这一行原先在这里记的"✅ 已修：标记换成常驻标签「设置」（`09f54d85`）"是错的，被 rig44 当场否证** —— 那是**拿一个错串替换另一个错串**：RN 把 `accessibilityLabel + ", " + hint` 合成进 `content-desc`，那一枚实际渲染的是 `"设置, 同步凭据、桌面小组件与语言"`，按整串「设置」精确匹配永远取空。真正的修法是**换通道而不是换字符串**：`_xy.py` 新增 `rid` 模式（读 `resource-id` = RN 的 `testID`）、`tap_tab` 的标记支持 `rid:` 前缀、`xy_marker()` 分发（`ec89ef06`）。testID 稳的理由：它是源码里写死的标识符，不参与文案合成、不随 i18n 变；这条约定两端共用（Android `rid:` / iOS `id:`） |
| rig44 | **13 通过 / 0 失败**，中止在第 2 步（`rc=1`）；它前面还有一次**起跑被新鲜度闸门拒绝** | 两个读数都要记，别并成一条：① 第一次起跑现量 `verify-mobile-ai 拒绝装包：APK 比源码旧` —— 闸门正常工作（我把 `AssistantScreen.tsx` 的文案接线改在了 05:46 那枚 APK 之后），**没有**用 `HEYTA_ALLOW_STALE_APK=1` 绕；随后按顺序 `pnpm -r build` → `pnpm build:android`（经 `scripts/run-gradle.mjs` 走 windows-pc，现场在 `tmp/rig44-prebuild.log`）→ 再跑。② 重跑后走到第 2 步断在**标记通道选错**上（上面 rig43 那行更正的就是它）：`通过 13 项，失败 0 项 / 未跑完就中止`。🔴 这一轮**没有**任何一条产品失败，也没有一条截图归属读数（没走到第 13 步） |
| rig45 | **46 通过 / 4 失败**（`rc=1`）—— 14 步整条跑完，而 4 条红**全是尺子自己坏了** | `rid:` 通道生效后第一次跑到底：第 2–12 步与第 14 步全绿（含第 5 步那四条只用本机档判据、第 7 步的成对、第 8 步的逐字段披露、第 9 步"没点确认不写库 + 计数恰好 0→1"、第 10 步 UPD 键集合 `['note']`）。4 条红逐字是 `android-ai-{1,2,3,4}-*.png 比本轮起跑时间还旧`，而四张图的 mtime 现量是 11:19/11:24/11:25/11:27、起跑 11:11 —— **它们就是本轮刚拍的**。真身：`find -newermt "@$epoch"` 在 macOS 的 BSD find 上直接 `Can't parse date/time`，stderr 被 `2>/dev/null` 吞掉，stdout 为空 ⇒ 计数恒 0 ⇒ **一条恒不成立的判据**（比恒绿更贵的形状：它把台账里的红与真缺陷混在一起）。修法 = 两端同值的 mtime 比（`python3 os.path.getmtime`），并把"读不出来"单分成一条红（尺坏了 ≠ 图旧），`05105917`；门禁补两条判据 + 臂 66/67（现量 `ARMS=108 FAIL=0`） |
| rig46 | **47 通过 / 0 失败**（`rc=0`）—— 本批第一次"整条跑完且第 13 步有读数" | 判据逐条与 rig42 对齐后**只多不少**：第 7 步（非回环 ⇒ `ai-consent-breakdown` 在树里 + 同屏回环那档不索取，成对成立）、第 8 步（目的地行 + 字段清单 + 性质行「数据会离开设备」+ 打 192.0.2.1 那趟计数 `0→0`）、第 9 步（提案卡 + `1→1` 不写库 + 回环那趟 `0→1` 作分母）、第 10 步（`+1 条 TASK/UPD`、键集合 `['note']`）、第 11/12 步（手机出去、笔记本读到 9 条 `source=remote`）、第 14 步（端口无监听者 + `adb reverse` 清单无 `tcp:4399`）全绿。**第 13 步现量：`截图齐且归属本轮：4 张，拍的时候前台都是 heyta`**（逐图 mtime 落在起跑之后 + 逐图 `dumpsys window` 前台 = `com.heyta`）。人打开看过其中两张（`android-ai-1-assistant.png` 11:42 / `android-ai-2-egress-blocked.png` 11:47），两处文案修复在当前产物上**看得见**：见下面那段"设备读数已取" |
| 台账口径 | 输出里的 ✅ 行数现在对得上**本脚本正文** | rig43 是 28 行 ✅ / `PASS=27`：那 1 行差来自 `scripts/lib/mobile-e2e.sh` 的预检（它自己 `echo "   ✅ 装的是当前源码的产物"`，打印时 `PASS` 还不存在）。判据 ⑲ 扫的是验收脚本正文，**不覆盖 lib** —— 这条边界如实挂着，不写成"全仓 ✅ 都入账" |

⚠️ **rig 号是全批统一的流水号**（不分端），所以下面这张表里 rig59 出现在 rig58（iOS）之后：
`rig59 = Android 腿在"共享披露分隔符 + 两条词条"修好之后的第一次整条跑完`，
它同时把 **traps #353 那条缺陷的第二个消费者**照了出来（见那段）。

| rig | 读数 | 定性与处置 |
|---|---|---|
| rig59 | **48 通过 / 1 失败**（`rc=1`；14 步整条跑完） | 装的是当前产物（预检现量 `APK 16:43:43 / 最新源码 16:33:23` ⇒ ✅），第 13 步 `截图齐且归属本轮：5 张，拍的时候前台都是 heyta`（比 rig46 多一张 —— 载体为这条标题判据补了 `android-ai-5-local-only-blocked.png`）。🔴 **唯一那条红是产品缺陷，不是载体**：助手多轮那一发被设备级同意闸拦下后，失败面标题印的是「AI 服务暂时不可用。」，而技术详情那行一直是对的（`privacy-consent-not-granted: …`）。取证行逐字是 `有「连不上端点」=否 有「同意并联网」=0 有「只用本机」=0 有诊断原文=1` —— 五个面板的失败落点里**五处**写了 `outcome.cause !== undefined ? AI_CAUSE_KEY[...] : 面板表[...]`，只有助手那一处直接查了面板级粗码表 ⇒ 原因码 `consent-not-granted` 被丢掉。这是 traps **#353 同一条缺陷的第二个消费者**（第一次是捕获面），见下面那段"第二个消费者" |
| rig60 | **49 通过 / 0 失败**（`rc=0`；14 步整条跑完、零红） | 修后复跑，装的是含 ① 归因层（#353）② 渲染层第二消费者 ③ 共享披露分隔符 三处修复的那一枚产物（预检现量 `APK 17:28:32 / 最新源码 17:15:26` ⇒ ✅，负载门 `load1=7 ≤ 12` 放行）。rig59 那条红消掉，且消的是**两句**：`✅ 只用本机档：失败面的**标题句**就是「只用本机」那一句（逐字取自词条表）` + `✅ 标题句不是那句「连不上端点…检查网络」（原因码没被归错）`。第 13 步 `截图齐且归属本轮：5 张，拍的时候前台都是 heyta` 复现 ⇒ 五张 `android-ai-*.png` 是本轮产物 |

#### iOS 侧助手：载体从 0 到"11 步整条跑完"（rig47c → rig51，2026-10-06 12:5x–14:3x）

设备 `heyta-iphone-17pro`（iOS 27.0 全量运行时）+ 真服务端 + 只绑回环的可数假端点，零 mock。
载体 = 新建的 `scripts/verify-mobile-ios-ai.sh`（`pnpm verify:mobile-ai:ios`），走 AX 的 `id:`（`AXUniqueId`）通道，
不依赖窗口 z-order / 焦点；常驻门禁 = `check:mobile-ai-anchors` 的 iOS 那几判据（㉑ 两本账、㉒ 新鲜度时刻、㉓ 读侧层、㉔ 披露判据）。

| 趟 | 读数 | 这一趟改掉/证伪了什么 |
|---|---|---|
| rig47c | 9 通过 / 1 失败（这一趟的日志已不在，读数取当时记录；形状由后面几趟复现） | 照出 iOS 的**节点发射规则**：只有带 trait 的宿主视图才发 `AXUniqueId`，`<View testID>` 根本不发节点 ⇒ 锚点全部下沉到 `Pressable` / `Checkbox` / `TextField` 那一层；披露/失败两个 `<Stack testID>` 容器读不到，判据改读它们**内部那枚按钮**（`…-send` / `…-retry`） |
| rig48 | `exit 3`，红在第 0b 步：`built=500e958e2a4a inst=7920a546c8d5` | 字节对账这条隐私/产物判据**钉错了时刻** —— 它在 `simctl install` **之前**比"构建目录 vs 容器"，于是每次重建后恒红（尺钉在动作之前＝一条恒不成立的判据）。修法：装前取指纹 → 装后**重新解析** `get_app_container` → 逐字节比 → 不一致就非零退出，而且必须在 `simctl launch` 之前。判据 ㉒ + 六臂（其中一臂复刻的正是 rig48 这个形状）；rig49 起第 1 步打的是 `已装产物与本轮安装的那一枚逐字节相同（sha256 500e958e2a4a…）` |
| rig49 | **15 通过 / 2 失败** | ① 第 3 步 `端点条数读成 0（期望恰好 1）`：库回读走错层（顶层 `v["endpoints"]`，真源在 `routing.endpoints`）⇒ "回读=0"与"真没存"输出上一样（§7 元规则一）；判据 ㉓ a 半（载体每个顶层读数必须存在于写入侧 `defaultAiSettingsState()` 那份对象里），臂 85/86 证明它会红。② 第 7 步 `中文送不进（No keycode found for 列）`：`idb ui text` 是 **HID 键码表**（`idb/common/hid.py: text_to_events`），非 ASCII 永远抛 —— 于是把"HID 是唯一输入通道"这条假设从载体里删掉，中文走 `AXSetValue`（`verify-mobile-ios.sh` 那条中文标题早已在**库级**被判据证过） |
| rig50 | **16 通过 / 1 失败** | 唯一红 `写 id:tool-input 四次都没回读出「列出我的任务」（最后回读：空，setRc=0）`，而单独一次 `--list` 打的是 `"detail": "列出我的任务"` —— **写进去了，回读没读到**：回读按"设值前那圈 frame"匹配，而键盘弹出把 multiline `TextInput` 顶下去了。shim 抽出 `readback_after_set()`：**先按 `AXUniqueId`**，退回按坐标；臂 88 用 rig50 现量的那棵树（同 id、y 从 236→412）钉住期望逐字，臂 89 摘掉按 id 那一档后臂 88 的读数不再等于期望（证明它承重） |
| rig51 | **26 通过 / 7 失败**（`rc=1`）—— 11 步**第一次整条跑完**，且第 1–6 步全绿 | 已取到的 iOS 设备读数（Goal-C 承诺的那几格，逐条都是这一趟现量）：入口按本机配置**出现/消失成对**（第 2 步不在树里、第 4 步在同一枚锚点上进树）、五档 chips 逐枚 id 齐、常驻那句「AI 只给建议…」在屏、五档路由绑进库后**从被写那一侧回读** `capture=1/0 … tool-calling=1/0`、回环端点下界面**不**索取逐功能授权（五档逐枚查过）。7 条红**逐条定源在载体**（见下面那段），另外照出**一条真产品缺陷**（已修，见 ㉔） |
| rig52 | **31 通过 / 5 失败**（`rc=1`；这一趟 11 步整条跑完 ⇒ 分母与 rig54 不同） | ① **第 8 步照出一条真产品缺陷**（闸门拒绝被渲染成"连不上端点"，见下面那段，traps **#353**）。② 第 9 步「拆解」禁用态：这一趟给**远程**端点一枚能力都没勾 ⇒ `requiredCapabilities.breakdown=['structured_output','long_context']` 把它挡在候选集外（"没声明=没能力"，ADR-0010）——与 §第 5 步 那条产品缺口同源，但这一次是载体的输入没给够，建端点那一步补两档勾选。③④⑤ 三条（第 9 步授权入口 + 第 10 步两条）**同一个成因**：设备级同意闸是**绝对的**（`apps/mobile/src/privacy/consent-gate.ts`：没同意一个字节都不出这台设备，回环也不例外），所以"计数会涨"这一档在这一屏**结构上取不到** —— 判据⑤⑥与 Goal-D 的正向对照必须先把这一档翻成「同意并联网」再取，而第 8 步必须在**翻之前**跑（它判的就是那道闸） |
| rig55 | **41 通过 / 1 失败**（`rc=1`；11 步整条跑完，第 0 步负载门从 `load1=40` 等到 12 以下才放行，没绕；装的是修后产物，与 rig54 同一枚 `sha256 905616aa72f6…` 逐字节对账） | **Goal-C 的六格 + Goal-D 那格全部在 iOS 上取到设备读数**（下面那段逐条列）。唯一红在**载体时序**（第 9 步授权入口"点不动"，定源见那段），不在产品 |
| rig56 | **没跑起来**（`RIG56_RC=3`，第 0b 步新鲜度门拒绝） | 🔴 记作**那道门的证据**，不记作设备读数：我起链时写的是 `pnpm reinstall:all -- --only ios`，`--` 被原样送进脚本参数位（traps **#173**，我自己又踩一次）⇒ 重装退 2，而链继续跑 ⇒ 装着的还是上一轮产物。门打出 `源码内容章 1791274184 > bundle 1791273486` 并 `exit 3`，**没有为了跑绿绕它** |
| rig57 | **42 通过 / 0 失败**（`rc=0`；11 步整条跑完、零红，这是这条载体第一次整条绿）。装的是当前产物：`内容章 1791274184 ≤ 已装 bundle`，第 1 步逐字节对账，四张 `ios-ai-*.png` 的 mtime 全落在起跑之后（逐张判） | Goal-C 六格 + Goal-D 两版读数**全部复现**，且 rig55 那条红消掉：第 9 步现在是「回到设置面按授权位 → **库里回读** `breakdown=1/1`」一条 ✅ 而不是 ❌。 而且**人打开看了那四张图**，当场照出三处 AX 判据看不见的东西（见下面那张三行表）——其中第 1 处是真缺陷，已修并配了能红的判据 |
| rig58 | **42 通过 / 0 失败**（`rc=0`；四张 `ios-ai-*.png` 现量 mtime 16:52–16:57 = 本轮产物） | 装的是**含共享披露分隔符修复**的那一枚产物（`内容章 ≤ 已装 bundle` + 第 1 步逐字节对账）。这一轮的存在理由不是"再绿一次"，是**验证修过的东西真的进了产物**：判据 ㉔ 与那条 parity 断言证的是源码与 web，而"移动壳的「发给谁」那一行不再黏成一串"必须在 RN 运行时上看 —— rig58 之后人打开 `ios-ai-3-disclosure.png` 看图确认段与段之间分开了（🔴 这条**不是**子串判据能回答的，见上面三行表第 1 处） |
| rig61 | **42 通过 / 0 失败**（`rc=0`；四张 `ios-ai-*.png` 现量 mtime 17:59–18:04） | 装的是**含全部三处修复**的那一枚（新鲜度门现量 `bundle 1791279154（17:32:34）> 内容章 1791278126（17:15:26）` ⇒ 放行，第 1 步 `已装产物与本轮安装的那一枚逐字节相同（sha256 baf26b99cc7e…）`）。Goal-C 六格与 Goal-D 两版读数在最终产物上**第三次复现**，且人第二次打开图：`ios-ai-2-local-only-blocked.png` 上标题就是「这台设备设为「只用本机」…一个字都没出去…」（#353 那句在 iOS 当前产物上仍然对）、`ios-ai-3-disclosure.png` 上「发给谁」四段用「、」分开。**顺带一条 A/B**：起跑时我把 UDID 末位打错（`…A10A`），第 0 步直接 `❌ 不在 Booted 列表里 ⇒ 先 xcrun simctl boot` 并 `exit 3` —— "不猜设备"那条门（AGENTS §8.9）连一个字符的漂移都拦得住，这一格从此有了一次真实的拒绝读数 |
| rig62 | **49 通过 / 0 失败**（`rc=0`；14 步整条跑完、零红） | E 项第二批（选中态那处修复）之后，Android 腿在**新产物**上的复现：预检现量 `APK 2026-10-06 18:46:11 / 最新源码 2026-10-06 18:40:00` ⇒ 装的是当前产物。rig60 那几条逐字复现：`✅ 只用本机档：失败面的**标题句**就是「只用本机」那一句`、`✅ 标题句不是那句「连不上端点…检查网络」`、`✅ 假端点计数 0→0 一次没动`、`✅ 未授权时披露步就索取批准（consentLead 那句在），且此刻假端点计数 0→0`、第 13 步 `✅ 截图齐且归属本轮：5 张，拍的时候前台都是 heyta`（五张 `android-ai-*.png` mtime 现量 19:01–19:09 = 本轮）。`ⓘ 设备侧未覆盖：「本机规则命中 ⇒ 零外发」`那一句**照旧在**（本载体无中文输入法，与 rig42 起同一判定，不是本轮新缺口 —— Goal-D 的读数在 iOS 侧）。人第三次打开 `android-ai-3-disclosure.png`：「发给谁」四段以「、」分开、常驻脚注「AI 只给建议…」在位，而三行表第 2、3 处（字段印 `today、title` 内部键名 / 第五枚 chip 右缘被切只露「A」）**仍在** |
| rig63 | **没跑起来**（`RIG63_RC=3`，第 0 步现场门拒绝） | 🔴 记作**那道门的第二次拒绝读数**，不记作设备读数：另一条会话正从 `/Users/rocalight/heyta-carriers/heyta-reinstall-1006/` 对**同一枚模拟器**（`FE195661-…-1F2F7AE3A102`）跑 `reinstall-all.sh --only ios`（现量 pid `15705` 的 `timeout 3900 bash …/reinstall-all.sh` + pid `16730` 的 `xcodebuild -derivedDataPath /tmp/heyta-ios-release`）⇒ 载体打印 `❌ 这一档有别人在写 ⇒ 不硬挤（§8.9）` 并 `exit 3`。**没有**为了跑绿绕它，也**没有**拿 rig62 的 Android 读数冒充 iOS。⚠️ 顺带一条自证：那次后台包装命令报的是 `exit code 0` —— 那是命令串末尾 `tail` 的码，真读数在日志里的 `RIG63_RC=3`（traps **#164/#45** 的同一形状，本轮第二次撞上） |
| rig64 | **读数作废**（`通过 9 项 / 失败 1 项`，`RIG64_RC=1`） | 🔴 唯一那条红**不是产品缺陷**：那一轮验的根本不是本树的产物。0b 新鲜度门打印 `bundle 1791285484（19:18:04）／内容章 1791283200（18:40:00）` ⇒ `✅ 将要安装的是当前源码的产物`，第 1 步逐字节对账 ✅（`sha256 fb40add08726…`），第 3 步随即 `❌ 设置面里读不到「启用 AI 功能」那枚勾选框`。定源靠 `ps` 不靠猜：pid `15705` 是另一棵树（`/Users/rocalight/heyta-carriers/heyta-reinstall-1006`，HEAD `90232ce0`、其 `AssistantScreen.tsx` 里 `useSelected` 命中 **0**）的 `reinstall-all.sh --only ios`，pid `16730` 是同一棵树的 `xcodebuild -derivedDataPath /tmp/heyta-ios-release` —— **两棵树共用同一枚默认构建目录**，而时间戳门只比先后：别人刚打完包，那枚 bundle 必然比我的内容章新 ⇒ 污染在这把尺上长得像"更新"。⇒ 记作**载体缺陷 + 判据缺口**（traps **#356**，修法与五臂读数见上面「产物归属门」那一节），Goal-C 的 iOS 六格与 Goal-D 两版读数**仍未取到**，本轮**不**拿它充当任何 iOS 结论 |
| rig65 | **42 通过 / 0 失败**（`RIG65_RC=0`；四张 `ios-ai-*.png` mtime 现量 19:47 / 19:49 / 19:50 / 19:52 = 本轮，人都打开看过） | 🔴 **Goal-C 六格与 Goal-D 两版读数第一次落在"含选中态那处修复的本树产物"上**，且这一轮的产物身份由新的归属门当场签认：0b 打印 `✅ 产物归属：/tmp/heyta-ios-release 里那枚是 **本树**（heyta-wt-merge @ dfd66fff…，内容章 1791283200）打的`，随后才是时间戳门 `bundle 1791286923（19:42:03）> 内容章 18:40:00`，第 1 步逐字节对账 `sha256 fa9af601991c`（与 rig64 那枚 `fb40add08726` 不同 ⇒ 确实是本树重打的那一份）。逐格读数：入口成对（第 2 步整行不在树里 + 第 4 步同一枚锚点进了树）、五档 chips 全在、常驻脚注「AI 只给建议：没有任何一条改动会在你确认之前写进去。」在屏、只用本机档那一步红字标题就是「这台设备设为「只用本机」…所以这一发一个字都没出去」而技术详情另起一行印 `privacy-consent-not-granted: …（http://127.0.0.1:4399/v1/chat/completions）`、非回环那一趟披露四段以「、」分开并点名 `192.0.2.1`、提案卡「拆解结果（4 项）」出来而**没点确认 ⇒ 本机库 1→1**。Goal-D 那一格两个版本都在同一趟里：`规则命中 ⇒ 假端点计数 0→0 一次没动`（且同趟正向对照 `0→1` 证明计数是活的）。📌 **本批那处选中态修复在图上有两枚直接证据**：`ios-ai-4-proposal.png` 里「选一条任务」下方那枚 chip 是实心选中态，而「AI 拆解」按钮已经从 rig59 期的禁用浅蓝变成可点的实心主蓝 —— 也就是 `pickedTask` 真的从共享 store 里读到了行。两处登记项**照旧在**（披露面「将发送这些字段：today、title」仍印内部键名 / 第五枚 chip 右缘被切只露「A」），本轮没有把它们说成已修。📌 起跑第一次 `RIG65_RC=3`：这一趟**既没给 `IOS_UDID` 也没给 `IOS_DEVICE_NAME`** ⇒ 现场门打印「不猜设备」（AGENTS §8.9）并拒跑，补上显式 UDID 才起。与 rig61 那一次（UDID 末位打错 ⇒ 不在 Booted 列表）是同一道门的**两种输入**，两次都拒了，没有一次靠猜混过去 |


🔴 **rig55 唯一那条红的定源：载体在一枚控件不住的那个面上点它**（traps **#348/#239 同族**）。
`ai-consent-breakdown` 住在**设置面**（`apps/mobile/src/ai/AiSettingsSection.tsx:448`），而载体把它写在
第 9 步末尾 —— 那时界面已经按过披露步的「发送」、停在助手屏的失败面上，设置面早在
`open_assistant()` 里被 `leave_settings` 收掉了。于是 `press_id` 的 scroll-into-view 回的是
`found=False / element-left-tree`：**"入口点不动"与"界面把入口摘掉了"在探针输出上长得一样**（§7 元规则一），
而那句 bad 文案说的正是后者 —— 它会把下一轮排查引向一条不存在的产品缺陷。
判据⑤本身在这之前已经取完（授权入口出现、回环那一档不索取、披露步三行齐、目的地点名 `192.0.2.1`、
未授权发送 `0→0`），红的是它后面那句"点得动"。
修法不是放宽判据，是**回到它住的那个面**再点（`open_ai_settings()` 自带收助手层/收设置面），
并且点后**从库里回读授权位**（`routes_reading` 的 `breakdown=1/1`）——按到了 ≠ 存住了。
顺序仍保持在"未授权 ⇒ 零外发"**之后**：先证明没授权时一发都不出去，再给授权。
放在授予之后不会污染下一步的成对判据 —— `needs = requiresEgressConsent(destination)` 只看地址类别，
授权位只翻转按钮文案（「授权」↔「撤回」）。修后读数属于 rig56。

✅ **rig55 在 iOS 上取到的设备级读数**（Goal-C 的六格，逐条都是这一趟现量，**没有**借用 Android）：
① 入口成对：第 2 步「AI 助手」整行不在树里（同帧三枚邻锚 `profile-entry-settings / -habits / -trash`
都在 ⇒ 缺席是"没渲染"而不是"通道没读到"），第 4 步在同一枚锚点上进树；
② 五档 chips 逐枚 id 齐（`check:ai-coverage` 在 iOS 设备上的对应物）；③ 「只给建议」那句常驻脚注在屏；
④ 只用本机档：闸门拒绝原文（逐字取自词条表）+ 点名 `127.0.0.1` + 假端点 `0→0` + 「重试」出口；
⑤ 非回环目的地：授权入口**出现**、回环那一档**不**索取（对照）、披露步三行齐、目的地那行逐字点名
`192.0.2.1`、未授权时发送 `0→0`；而"换回回环后入口**消失**"这半也在第 10 步读到 ⇒ 成对完整；
⑥ 提案卡出现（`breakdown-apply` 在树里）+ **只看不点确认 ⇒ 本机库 `1→1` 一条都不多**。
🔴 **Goal-D 那一格在 rig55 取到了两个版本**：第 7 步（设备级同意还关着）规则盖章 + `0→0` + 不落失败面 +
披露步已收；第 10 步开头（同意已翻成「同意并联网」）**同一趟**里规则章仍然盖着、仍然 `0→0`，
而紧接着回环那一趟 `0→1` —— 这条 `0→1` 就是正向对照：**同一枚计数尺、同一次运行，会涨的那一侧当场证明它有区分力**，
所以那两条 `0→0` 不是"压根没走传输边界"。Android 载体上取不到的那一格（无中文输入法，三条注入通道现量已列）
就此在**能输中文的载体**上闭合，判据一个字没放宽。

🔴 rig51 那 7 条红的三类成因（都不在产品，也**不**包装成"已闭合"）：

1. **逐工具授权没勾**（第 7 步两条）。`apps/mobile/src/ai/AssistantScreen.tsx:1219` 的 `grants` 取的是
   `localApi.grants` —— 默认**全关**是红线（ADR-0011 §3.1），所以一枚都没勾时 `resolveToolSelection` 的候选集是空集，
   任何句子都到不了规则那一支，界面报的是「还没有授权任何工具…」。载体把它读成了"规则没有先跑"。
   修法 = 第 6b 步勾 `ai-tool-grant-list_tasks` 并**从库里回读授权位**（新增 `grants_reading()`，读的仍是写入侧那一层）。
2. **拆解那一档压根没有可选的行**（第 9 步两条 + 第 10 步两条）。`breakdown-start` 的
   `disabled = selectedId === undefined || route.target === undefined`，而全新安装的设备上任务列表是空的
   ⇒ 恒禁用 ⇒ 后面"计数 0→0""等 40 秒没有提案卡"都是它的连锁。
   修法 = 第 6c 步走真 UI 种一条任务（FAB → `AXSetValue` 写标题 → 「添加」的**启用态**当"文字进了应用"的判据 →
   Composer 关闭 + `ops` 条数必须涨），第 9/10 步各自 `press_label "$TASK_TITLE"` 选中它
   （重新进面板会丢选中态，不假设它跨挂载）。
3. **"拒绝原文"找错了句子**（第 8 步一条）。载体找的是 `web.ai.settings.consentLead` 的尾部，
   而那句住在**披露步**、且目的地是回环时按设计**不渲染**（与第 6 步"回环不索取授权"同一个口径）——
   一条恒不成立的判据。改成按词条表取失败面那一句之后，这一条**没有变绿，而是把一条真产品缺陷照了出来**
   （界面上渲染的是 `web.ai.failure.cause.network`，不是任何一种"没授权"的句子 ——
   逐条见下面"rig52 照出来的那条产品缺陷"，traps **#353**）。
   载体同时补上"失败时把界面上到底有哪几句打进日志"（先修探针，不猜）。

✅ **rig51 顺手照出来的那条产品缺陷（已修，不是载体的）**：移动壳的两个发送按钮
（`tool-start-single` / `tool-start-assistant`）**无条件** `setPhase('disclose')` ——
于是一句本机规则就答得出的话，界面先向用户承诺"这些内容要离开本机"，而这一条路径一个字节都不发。
`packages/app-host/src/ai-assistant.ts` 里 `assistantNeedsEgressDisclosure()` 的注释写的正是这件事
（"那句承诺是假的，而代价…是下一次真需要出境时，用户已经不信这条提示了"），web 的对话面板消费了它，
移动壳是**漏掉的第二个消费者**。修法 = 壳里那一问交回共享函数（单步用 `resolveToolSelection(grants)`、
多轮用 `assistantNeedsEgressDisclosure(tier)`），不新建词条、不在壳里抄一份规则匹配；
新门禁 ㉔ 把"两个按压点各自必须先过共享判据 + 不许壳里自造匹配 + 分母（别的面板本来就该无条件披露）"钉住，
四条变异臂各红一次（摘掉任一支共享判据 ⇒ 点名那枚锚点；换成 `includes('列出')` ⇒ 点名"第二套口径"）。

✅ **rig52 照出来的第二条产品缺陷（已修，不是载体的）：隐私闸门的拒绝被渲染成"连不上端点"**
（机制、后果与两条封闭表的修法见 traps **#353**，这里只记这一批的落点）：

| 落点 | 内容 |
|---|---|
| 归因 | `packages/ai` 新增原因码 `consent-not-granted`；`provider.ts` 与 `routing.ts` 的 `attemptOnce` 在 catch 里先用 `isPrivacyConsentBlocked` 认出来，不再一律收成 `network` |
| 两张封闭表 | `countsAsEndpointFailure('consent-not-granted') = false`（没被访问过的端点不许挨熔断锅）、`shouldTryNextEndpoint(...) = false`（换一个目的地偷发不是重试）—— 三枚设备库读数里 `consecutiveFailures` 那一条就是这么被顶成 2 的 |
| 契约字符串的家 | `PRIVACY_CONSENT_BLOCKED_MARKER` / `PrivacyConsentBlockedError` 从 `packages/app-host/src/privacy-consent.ts` 提到 `packages/ai/src/egress.ts`（失败词表的所有者在下面那层），app-host 改成 re-export ⇒ 全仓仍只有一份口径（AGENTS §3.5） |
| 措辞 | `web.ai.failure.cause.consentNotGranted` 中英成对，界面用「这台设备设为『只用本机』… nothing left the device」，**不新增任何"出境"式表述**；`apps/web/tests/ai-failure-copy.spec.tsx` 另钉一条"那句里不许出现「检查网络 / 端点地址是否可达」" |
| 为什么不需要新门禁 | `AiFailureReason` 是**封闭词表**：加一个成员就让 `Record<AiFailureReason, …>` 三处映射（mobile `ai/copy.ts`、web `ai-failure-copy.ts`、app-host `ai-failure-fallback.ts`）与 `ALL_CAUSES` 穷尽表**编译期报错** —— 漏配一种原因的代价从"上线后有人看到空白"变成"`pnpm -r typecheck` 红" |
| 变异读数 | 把归因改回 `network` ⇒ `packages/ai/tests/routing.spec.ts` **`1 failed / 54 passed (55)`**，`AssertionError: expected 'network' to be 'consent-not-granted'`；还原后 sha256 前缀 `d39e50f16f7b17bb` 与改前逐字相同 |

载体的判据形状同时补了一条（Android 5c 原先只找 `privacy-consent-not-granted`，**那句在改前改后都在**，
对标题完全无感）：现在两侧载体都**逐字取词条表比标题句**，并各加一条"标题不许是那句「连不上端点…」"
的反向判据。词条一律经 `scripts/lib/card-export-probe.sh` 的 `zh()` 取（不抄字面量，理由写在那个文件头）。

🔴 **rig59 照出的"第二个消费者"（同一族缺陷换了个面）**：上面那张表修的是**归因层**
（`packages/ai` 不再把闸门拒绝收成 `network`），而 traps #353 说的是**渲染层**（有原因码却查面板级粗码表）。
归因修好之后，同一族缺陷在**助手那一处**仍然成立 —— 因为六个失败落点里只有它没接 `AI_CAUSE_KEY`。
所以这一格真正要的不是"再修一处"，是**一条逐处过的常驻判据**：

| 落点 | 内容 |
|---|---|
| 修法 | `apps/mobile/src/ai/AssistantScreen.tsx` 的助手落点改成与另外五处同一形状：`outcome.cause !== undefined ? AI_CAUSE_KEY[outcome.cause] : ASSISTANT_FAILURE_KEY[outcome.reason]`（**面板级粗码只在没有原因码时兜底**） |
| 新门禁 ㉕ | `check:mobile-ai-anchors` 里 `mobileFailureCauseGuard()`：**逐处**读 `setFailure({` 那一段，含 `*_FAILURE_KEY[` 而不含 `AI_CAUSE_KEY[` ⇒ 红并点名第几处/行号；另带一条**分母自检**（`setFailure({` 处数少于现量基线就红）—— 摘掉一整处会让这条判据没有输入，那是 §7 #191 那一族"门禁安静地不执行还照样打印通过" |
| 读数 | `FAILURE_CAUSE_SUMMARY 失败落点=6 先过原因码=6 红=0`（真源码）；`--self-test` 五臂各一次：阳性对照、"摘掉助手那一支"的前置 + 红（点名 `没有先过原因码` 与那句假标题、`先过原因码=5`）、"摘掉一整处落点"的前置 + 红（`失败落点分母只剩 5`） |
| 为什么不靠 typecheck | 这一族**编译期抓不到**：`ASSISTANT_FAILURE_KEY[outcome.reason]` 类型完全合法（`reason` 是封闭词表、映射表齐全），错的只是**查表的顺序**。词表穷尽性管得住"有没有为某个原因写句子"，管不住"界面有没有去查它" —— 后者只能是判据 |

⚠️ **rig59 之后仍开着的**（不写成完成）：
① 上面那张三行表里的第 2、3 处（披露字段用内部键名 / 五档 chips 第五枚被切）—— 一处修法形状已写清待做，
一处要产品负责人拍"是不是有意的可滚动暗示"；rig58 与 rig59 的两轮截图里**这两处都还在**（第二次看图确认）；
② ✅ **两端都在最终产物上取到修后读数**：Android rig60 = **49 通过 / 0 失败**（rig59 那两条标题判据
现在各是一条 ✅，第 13 步 `5 张，拍的时候前台都是 heyta`），iOS rig61 = **42 通过 / 0 失败**
（新鲜度门 `bundle 1791279154 > 内容章 1791278126`、第 1 步逐字节对账）。
两端的失败面截图人**都打开看过**：`android-ai-5-local-only-blocked.png`（设备钟 5:44）与
`ios-ai-2-local-only-blocked.png`（18:01）上标题逐字是「这台设备设为「只用本机」…一个字都没出去…」，
「技术详情」独占一行、诊断原文另起一行 —— Goal B 那两处 + #353 那一族在**两个端**的当前产物上都在。
③ 本批所有改动**尚未提交**（按路径分三笔），push 与生产部署**不在本 Goal 内**。
✅ 已经不再开着的：rig55 那条载体时序红（rig57 修后读数 = `breakdown=1/1` 库里回读 ✅）、
四张 `ios-ai-*.png` 的人眼复核（人看过，且照出了东西 —— 这正是 §6.2 规定一存在的理由）。
rig52 那两张画的是修前的假标题，**不作为修后证据**；iOS 那四张现在是 **rig61** 的产物（mtime 现量 17:59–18:04），
Android 那五张是 **rig60** 的（17:43–17:52）。🔴 rig59（修前）那五张已被 rig60 同名覆盖 ——
"标题当时印的是「AI 服务暂时不可用。」"这一条的证据是 **rig59 日志里的取证行**（`/tmp/rig45-android-ai.log:100-108`，
逐字列出屏上那串文本），不是图。

🔴 **rig57 看图当场照出的三处（§6.2 规定一"人必须打开看"这一轮真的抓到东西了）**：

| # | 界面上看到的 | 定性与处置 |
|---|---|---|
| 1 | 「发给谁」那一行四段**逐字黏成一串**：`将发往：stub-remotehttps://192.0.2.1/v1模型 stub-model数据会离开设备` | 🔴 **真缺陷，已修**。`packages/ui/src/ai/AiDisclosure.tsx` 把四段各写成一个相邻 `<Text>`，而 RN/RNW 对相邻 Text **不插任何空白**。而**同一趟里 iOS 判据 `found_label "192.0.2.1"` 照样绿**（子串匹配）—— 这是"验界面写了什么、验不出看不看得清"，与 §7 那条"不验少了什么"同族。修法 = 段与段之间用**已经在 props 里的那一枚** `separator`（`LIST_SEPARATOR[locale]`，正字法、刻意不进词条表），不新造标点常量、不把空格塞进词条。判据 = `apps/web/tests/ai-disclosure-parity.spec.tsx` 新增那条"每段之后的第一个字符必须是分隔"，**变异读数**：摘掉任一枚 `{separator}` ⇒ `1 failed \| 1 passed` 且点名粘住的那一段（`云端首选`），还原 ⇒ 2 passed。共享组件一处修，web 与移动壳同时好（移动壳只是包了一层，没有第二份渲染） |
| 2 | 披露的字段清单是**内部键名**：`将发送这些字段：today、title` | 🟡 **登记，不改**（不在本 Goal 五项内，且不是红线违例 —— 逐字段披露成立，字段一个没漏）。问题是中文用户读不出 `title` 是"任务标题"。修法形状已想清：给每个 payload 字段一枚 `web.ai.field.<key>` 词条（中英成对），界面上"人话名 + 反引号里的线格式键名"并列（**不能只留人话名** —— 那会让披露与真实请求体失去对账能力）；配一条 `check:*` 把"字段词表 ↔ 词条表"钉住（同 `check:legal-tools` 那个形状：封闭句式的那张表就是授权面，缺一条即红）。谁做谁先读 `packages/ai` 里那张字段来源表，别在壳里另列一份 |
| 3 | 五档 chips 那一排，第五枚在右边缘被切掉一半（三张图一致，只露出「A」） | 🟡 **登记，判"是有意的可滚动暗示还是缺 affordance"要人拍**。现状：横向滚动、无渐隐、无箭头，用户第一眼只看到四档，而"五档"是 `check:ai-coverage` 的分母。若要修，方向是右缘渐隐 + 可聚焦（键盘/读屏也要能到第五枚），不是把五档挤进一屏（字号会掉到不可读）。⚠️ 载体侧不受影响：判据②是**逐枚按 id 现读**（`ai-mode-*`），不依赖可见性 |

✅ **顺带：Goal B 那两处文案修复在 iOS 当前产物上被看见了**（此前只有 Android 的证据）——
`ios-ai-1-assistant.png` 上捕获步那句是完整的三段拼句
「确认后会按上面的字段写入。截止时间是模型的推算，请核对后再填。」（不再以「截止时间是」结尾）；
`ios-ai-2-local-only-blocked.png` 上失败面「技术详情」独占一行，诊断原文
`privacy-consent-not-granted: …（http://127.0.0.1:4399/v1/chat/completions）。` 另起一行（不再挤成一句）。
两张都是 rig57 装的这一枚产物（`内容章 ≤ 已装 bundle` + 第 1 步逐字节对账）。

🔴 **红线自查（本批收口时逐条现量，不写"应该没问题"）**：
① **对外措辞**：产品界面里那两句还在替我们说"我们在做数据出境"的词条已改 ——
`web.ai.duration.basis.historyOverflow`「为控制出境…」→「为控制**离开本机的内容**…」，
`web.ai.assistant.failure.egressOutsideDisclosedSet`「没有批准过出境的字段」→「没有批准过**离开本机**的字段」
（英文侧本来就是 `egress / sent to limit egress`，不含"跨境"义，逐字未动；`check:ui-language` 现量
zh / en 各 **3157** 条成对、rc=0）。**没改的那三处也是判断，不是漏掉**：
`site.docs.privacy.s4p2` 与 `site.legal.ai-and-transfer.lede` / `.seo.description` 里的「出境」
住在**对外法务文本**里，而那份文本的作用恰恰是把两件事分开 ——「我们的出境」（要由我们履行 PIPL 38/39 的手续）
与**你自己的出境**（你处分自己的数据，处理者是你），`privacy.ts:454` 那句甚至一开头就写"把它们合成一句话就会变成假话"。
把那个词从那里拿掉会让**否定句失去它所否定的东西**，而 `LEGAL_SET_VERSION` 里的版本号进同意指纹
（`packages/legal/src/index.ts`）⇒ 改它是一次对外法律表征变更，要法务那条线拍，不由这批改。
② `host.submit(` 全仓现量 **2 处**（`packages/local-api/src/server.ts:590`、`packages/app-host/src/ai-tool-run.ts:195`），
`apps/*` 里**一个调用点都没有**（只有注释在说这件事）⇒ "AI 类型上产不出 op"这一条在本批没有被削弱。
③ 逐工具默认关 / 回退不跨越隐私边界 / 不 bump `CURRENT_SCHEMA_VERSION` / 新字段一律可选带默认值：本批**一处持久化都没动**，
改动全在 `packages/ai`（失败词表）、`packages/app-host`（原因码→词条映射）、`apps/mobile`（壳的披露判据）、
`packages/i18n`（词条）与载体/门禁脚本。
④ 变异证据（本轮现量读数）：`node scripts/verify-i18n-failures.mjs aifailure` ⇒ 4 用例"该绿的绿、该红的红"，
其中新加那一臂（把 `consent-not-granted` 指到 `network` 词条）退出码 **1**；
`node scripts/check-mobile-ai-anchors.mjs --self-test` ⇒ `ARMS=… FAIL=0`，
🔴 **臂数不在这里抄**（抄一次就开始漂：这一批从 99 → 108 → 147 → 现在这一枚，每次都要回来改数字）——
要现量就跑上面那条命令看它自己打印的那一行，判据是 `FAIL=0` 而不是某个臂数。

✅ **E 项（收尾）在最终载体上的整批读数**（2026-10-06 18:10–18:12，全部在同一棵树上、串行跑）：

| 类别 | 命令 | 读数 |
|---|---|---|
| 类型 | `pnpm -r typecheck` | `rc=0`（含 `apps/desktop` 的两份 tsconfig） |
| 门禁 14 道 | `check:ui-language` `check:i18n-vars` `check:egress-wording` `check:layering` `check:design` `check:docs` `check:docs-voice` `check:md-tables` `check:script-snapshot` `check:verify-script-copy` `check:mobile-ai-anchors` `check:journey-coverage` `check:ai-coverage` `check:rn-aria` | 逐道 `rc=0`（`check:md-tables` 是本轮往台账里加了三行表之后必须重跑的那一道） |
| 门禁 6 道（AI/法务侧） | `check:ai-tools` `check:legal-tools` `check:legal-copy` `check:ai-quota` `check:egress-wording` `check:gate-wiring` | 逐道 `rc=0` |
| 单测（本轮改动经过的包） | `--filter @heyta/ai / app-host / ui / i18n / web test` | `267` / `1487` / `559` / `26` / `1876 passed \| 13 skipped`，五个 `rc=0` |
| 产物 | `pnpm -r build` ⇒ `reinstall-all --only android,ios` | `BUILD_RC=0`、`REINSTALL_RC=0`；android 截图 `1080x2400 内容占比 56.7% 主蓝命中 4001`，ios `1206x2622 60.1% 主蓝 4152`，ios 内容章 `1791278126 ≤ 已装 bundle 1791279154` |
| 设备 | rig60（Android 14 步）/ rig61（iOS 11 步） | `49/0 rc=0` 与 `42/0 rc=0`，两端截图人打开看过 |

🔴 **这一批没有闭合的，仍然只有那三条**（不包装）：三行表第 2、3 处（字段印内部键名 / 第五枚 chip 被切，
一处待做一处待拍）、`apps/mobile/ios/Podfile.lock` 的脏（`pod install` 在本机重写哈希，留给下一次合并登记）、
以及 **push 与生产部署不在本 Goal 内**（按纪律要另行授权）。

#### E 项第二批：整条 `pnpm check` 照出来的第三条缺陷 —— 选中态在移动壳里有**两个**所有者

上面那张表是"点跑的 14+6 道门禁"的读数。按 Goal 项 E 另起了一次**整条** `pnpm check`
（同一棵隔离检出，串行）。整条链是 `&&` 串的 ⇒ **第一道红就停**，这一轮停在
`check:selection-single-source`，而它前面那 14 道点跑时全是绿的 —— 也就是说
**"我跑过的那些道绿" 与 "链绿" 从来不是一件事**。

| 落点 | 内容 |
|---|---|
| 现量红 | 断言 B「宿主里出现了本地选中态（应有 0 处）」点名 `apps/mobile/src/ai/AssistantScreen.tsx:704 / :1050` 两枚 `selectedId` —— 拆解面与估时面各揣一份 `useState<string \| undefined>` |
| 为什么 typecheck、本包 772 条单测与那 20 道点跑的门禁都没看见 | 两份所有者在类型上和界面上都**成立**（各面板自己用，跑不出错）。可判的只有"同一句『选中的实体没了怎么办』被答了两遍"，而那恰好是判据 B 的射程 |
| 为什么不改名、也不登记豁免 | 门禁给的豁免是**封闭四档**（`in-flight / inline-rename / confirm-gate / dragging`，§8.28 立的那四类），"AI 提案的目标行"不在里面。给自己造的红往词表里加一档 = 把"谁违规"变成"规则让步"，而那张表的全部价值就是"填一个词绕不过去" |
| 修法 | 两片面都改读全壳那一份（`const pickedId = useSelected('task') ?? undefined`、`selection.select('task', id)`），回落规则留在共享层（`lib/selection.ts` → `app-host/selection.ts`），界面**只读不判** |
| 加读方逼出的第二条（断言 H） | 触屏端的回落**按屏跑**：本屏不喂 `pruneSelectionAgainst({ … })`，选中的那条被删掉时这两个面板不会自己关。谓词取 `actions.listTasks()`（未删除全集），**不是**本屏那份 `listPendingTasks()` 候选集 —— 拿候选集当谓词会把"用户在另一台设备上完成了这条"误判成"这条没了" |
| 加读方逼出的第三条（泄漏方向相反的） | 任务屏的详情浮层是 `visible={detailTaskId !== null}`，读的正是同一枚 key。助手屏不在卸载时收回，"给 AI 挑一条目标任务 → 返回 → 切到「任务」标签"就会**凭空弹出**那条任务的详情 —— 与任务屏那条清理是同一个坏行为的两面 |
| 顺带消掉的一处静默 no-op | `breakdown-start` / `duration-start` 原是 `disabled={selectedId === undefined}`，而 `onPress` 里 `find(...) === undefined` 就 `return` ⇒ 选中的那条被完成掉时按钮**看着能点、按下去什么都不发生**。现在 disabled 取派生的 `pickedTask === undefined`（同一枚唯一所有者的投影，不是第三份状态） |
| 台账一致性 | `scripts/verify-mobile-ios-ai.sh` 里两处把 disabled 表达式写成 `selectedId === …` 的注释，与第 10 步那句"重新进面板会丢掉上一次的选中行"，**修完当天就变成假话**（切档不再丢，丢的时机改成退出助手屏）⇒ 逐处改成现状措辞，那条重按仍然必要、结论不变 |

🔴 **四臂变异读数**（改前/改后各跑一遍常驻门禁 + 本包那份镜像单测
`apps/mobile/tests/selection-single-owner.spec.ts`；还原后 `sha256 8624c1083ca65ae2…` 与改前**逐字相同**，
真树没有留下变异）：

| 臂 | 门禁 rc | 门禁点名助手屏 | 镜像单测 |
|---|---|---|---|
| M0 阳性对照（未变异） | `0` | 否 | `15 passed (15)` |
| M1 摘掉那一处回落 | **`1`** | **1 处**（断言 H） | **`1 failed` \| 14 passed**（"助手屏：喂的是 `listTasks()` 全集"） |
| M2 回落谓词换成筛后的候选集 | `0` | 否 | **`1 failed` \| 14 passed**（同一条，反向那一半） |
| M3 摘掉卸载清理 | `0` | 否 | **`1 failed` \| 14 passed**（"三屏各有一条卸载清理"） |

M2/M3 两格门禁**不红**不是漏，是分层：常驻门禁钉"读方与回落**配没配对**"（形状），
包内镜像单测钉"喂进去的是不是全集、退出时收没收"（语义）。反向那条判据**单独成一条用例**
的理由写在那个文件的 §1 里（合在一起的话两条判据在红集上只剩一条）。

⚠️ **第一趟臂我自己量错过**：命令写成 `node … \| tail -40` 之后读 `$?` —— 那个码是 `tail` 的
（traps **#45**，同一个坑的第三种面目），于是四条臂齐刷刷报 `rc=0`、看起来"变异全存活"。
去掉管道直接取被测试命令的 rc，才得到上面这张表。**报"某条判据存活"之前先确认那个 rc 是谁的。**

#### E 项第二批（续）：rig64 的无效读数定源到「两棵树共用一枚构建目录」，补一条**产物归属门**

rig64 那一发红（`设置面里读不到「启用 AI 功能」`）**不是**产品缺陷，也不是"iOS 助手没接上"——
它验的根本不是本树的产物。定源链（`ps` 现量，不是推测）：

| 事实 | 证据 |
|---|---|
| 0b 新鲜度门放行 | `新鲜度门输入：bundle 1791285484（19:18:04）／内容章 1791283200（18:40:00）` ⇒ `✅ 将要安装的是当前源码的产物` |
| 第 1 步逐字节对账也过 | `已装产物与本轮安装的那一枚逐字节相同（sha256 fb40add08726…）` |
| 第 3 步红 | `❌ 设置面里读不到「启用 AI 功能」那枚勾选框` ⇒ `通过 9 项，失败 1 项`、`RIG64_RC=1` |
| 同时有另一棵树在打包 | pid `15705` = `/Users/rocalight/heyta-carriers/heyta-reinstall-1006/scripts/reinstall-all.sh --only ios`；pid `16730` = 同一棵树的 `xcodebuild -derivedDataPath /tmp/heyta-ios-release` |
| 那棵树**没有**本批的修复 | 其 HEAD `90232ce0`，`grep -c useSelected apps/mobile/src/ai/AssistantScreen.tsx` = **0**（本树 HEAD `dfd66fff` + 未提交修复） |
| 两棵树指向同一个地方 | `/tmp/heyta-ios-release` 是三处 `HEYTA_IOS_DERIVED` 的**默认值**（`reinstall-all.sh` / `verify-mobile-ios.sh` / `verify-mobile-ios-ai.sh`） |

形状是：**别人刚打完包 ⇒ 那枚 bundle 必然比我的内容章新 ⇒ 时间戳门把污染打印成"更新"**。
新鲜度回答「新不新」，回答不了「是谁的」，而这两问在共享目录上恰好会给出相反的答案（traps **#356**）。

🔴 补的这条门住在尺的**单一所有者**里（`scripts/lib/apk-freshness.sh` 新增
`heyta_ios_owner_write` / `heyta_ios_owner_check`），不在载体里抄第二份：构建成功那一刻把
`root=` / `head=` / `src=`（当时的内容章）签进 `<derivedDataPath>/.heyta-build-owner`，
两枚写方都签（`reinstall-all.sh`、`verify-mobile-ios.sh`），读方在时间戳门**之前**判归属，
不成立就 `exit 3` 并把两枚 `root` 与两枚 `src` 原样打出来。**判 root 与内容章、不判 HEAD** ——
一次纯提交会让 HEAD 变而字节不变，拿 HEAD 判就得到一把恒红的尺（#346 刚记过的形状）。

能失败的读数（`bash scripts/lib/apk-freshness.sh --self-test`，分母由它自己打印，不抄进本表）：

| 臂 | 形状 | 读数 |
|---|---|---|
| 无章的构建目录 | 拿真实共享目录当输入 | `rc=2` 拒绝，理由里带得出那枚缺失路径与"跑 `pnpm reinstall:mobile --only ios`"的出路 |
| 本树 + 当前源码版 | 阳性对照（挡恒红） | 放行 |
| 别一棵树判同一枚章 | `cp -Rp` 出**逐字节副本**的第二棵树 ⇒ 两棵的内容章相等 | `rc=1`，且输出里那棵树的**路径逐字可读**（这一臂的红只能来自"哪一棵"这一维） |
| 同树但那之后源码又变 | 只改内容、不碰树 | `rc=1`（证明 `src=` 那一位是承重的，不是打印用的装饰） |
| 接线臂 | 查两枚写方 + 一枚读方确有调用点 | 🔴 **补调用点之前三行齐红**（`reinstall-all.sh` / `verify-mobile-ios.sh` / `verify-mobile-ios-ai.sh 没…`），补完才转绿 ⇒ 这条臂不是"生下来就绿" |

另有两发打在真实目录上的控制读数：`/tmp/heyta-ios-release`（rig64 用过那枚、无章）⇒ `rc=2`；
伪造一枚 `root=` 指向 `/Users/rocalight/heyta-carriers/heyta-reinstall-1006` 的章 ⇒ `rc=1`
并把两枚 root 都打出来。**这两发就是"下一轮不会再被同一枚污染骗到"的证据**，
比"我以为已经修好了"少一种读法。

✅ **这条门当天就派上用场**：本树 `--only ios` 重装之后 rig65 起跑，0b 打印
`✅ 产物归属：/tmp/heyta-ios-release 里那枚是 **本树**（heyta-wt-merge @ dfd66fff…，内容章 1791283200）打的`
⇒ 才允许往下走；那一趟 **42 通过 / 0 失败**（`RIG65_RC=0`），是 Goal-C 六格与 Goal-D 两版读数
第一次落在**身份可证**的 iOS 产物上（逐格读数在 §9 的 rig65 那一行）。
📌 顺序也是这条门的一部分：**归属先判、新鲜度后判**。反过来（先比时间戳）就是 rig64 的形状 ——
一道门把污染打印成放行，另一道门（逐字节对账）只能证明"装的就是它"，两道全绿而验的不是本树的码。


**Goal-7a 的真机对应物现在两半都算数**（rig42 现量，取代本节 earlier 的"只有界面那一半算数"）：

界面那一半（地址类别 ⇒ 授权入口的出现/消失成对、逐字段披露的元素齐）读的是 AX 树，与隧道无关；
"未授权零外发 / 失败不静默回落"那几条靠**假端点计数**的判据，在 rig42 里跑在**有正向对照的通道**上
（同一步既打出 `计数 0→0` 又由第 9 步打出 `0→1`），所以 `0→0` 这一次有区分力 —— rig38/39 那句
"在两种状态下读数一样"的前提已经被归属判据 + `ensure_tunnel()` 拆掉了。
第 10 步之后的"不点确认 ⇒ 恰好 0 条新 op / UPD 落库形状"同样取到读数（`+1 条 TASK/UPD`、键集合 `['note']`）。
✅ **跨设备那半的复核已闭合（rig46 现量）**：第 13 步打印 `截图齐且归属本轮：4 张，拍的时候前台都是 heyta`
（逐图 `python3 os.path.getmtime` ≥ 本轮起跑 + 逐图 `dumpsys window` 前台 = `com.heyta`），
而四张图就在 `apps/mobile/evidence/android-ai-*.png`（rig46 那一趟的 mtime 现量 11:42 / 11:47 / 11:48 / 11:50）。
人打开看过其中承担两处文案判据的那两张，见下面"设备读数已取"那段。

**第 5 步的当前诚实状态（rig35 现量，取代上面那段 21:3x 的候选清单）**：
`enabled=true`、拒绝原文含 `privacy-consent-not-granted`、那句拒绝点名了它本来要去的
`127.0.0.1` URL、失败面给出「重试」—— 四条各有 ✅（读的是界面与拒绝文本，不依赖通道）；
🔴 原先第五条 ✅「假端点计数 `0→0` 一次没动」自 rig39 起**降级为待 rig41 复证**（同上一条理由：
隧道在第 3 步就被 root/unroot 拆掉，这条读数不再有区分力）。
仍**未覆盖**的只有一格：「本机规则命中 ⇒ 零外发」（全中文谓词的规则表在这台没有中文
输入法的 Android Release 载体上无法被键盘命中，三条注入通道逐个试过）。
上面那段"候选还剩 resolveAiRoute 的能力声明 / assistantTier"已由现量收掉：
能力声明那一半在 rig33 前就修完（`ai-endpoint-cap-*` 三枚 chip 可勾 + 库里回读），
`assistantTier` 不是拦它的那一道（同档 `enabled=true`）。
**本轮设备级读数收在这里（取代上面那段 rig39 的收口）：rig42 = 40 通过 / 2 失败，14 步第一次整条跑完，
而那 2 条失败逐条定源在载体自己的对账代码（traps #344），不是产品失败，也不记作产品完成。**
rig39 那趟的 `31/1` 与它的两条载体成因（`adb root` 拆掉 `adb reverse`、上一轮泄漏的假端点被本轮借用）
仍然留在表里 —— 它们已由归属判据 + EXIT trap 收掉，第 14 步现在是判据不是清理动作。
仍开的格子（rig46 之后重取现量）：① ✅ **已闭合，而且是在换了载体之后闭合的**：
「本机规则命中 ⇒ 零外发」在 **Android 载体**上按设计不可达（三条输入通道现量已列，规则表谓词头全是中文），
换到**能输中文的 iOS 模拟器**后由 rig55 取到读数，两个版本各一条：同意闸**关着**时（第 7 步）规则盖章 +
假端点 `0→0` + 不落失败面 + 披露步已收；同意闸**开着**时（第 10 步）规则章仍在、仍 `0→0`，
而同趟回环那一发打出 `0→1` —— 这条 `0→1` 就是正向对照，所以 `0→0` 有区分力。判据一个字没放宽。
② ✅ **已闭合**：截图四张图的归属复核由 rig46 取到读数（`4 张 + 前台都是 heyta`），人打开看过承担
   文案判据的那两张（见下面那段）；
③ iOS 侧助手**不再是零设备读数**（rig51 第一次整条跑完；rig52 逐条定源并把一条真产品缺陷照出来；
   rig54 装的是修后产物；**rig55 = 41 通过 / 1 失败**，Goal-C 的六格与 Goal-D 那一格逐条在上面）。
   这一格**仍未闭合**的部分也写在那里：rig55 那条红的修后读数属于 rig57，四张 `ios-ai-*.png` 的人眼复核还没做。

🔴 **看图当场查出的一条移动侧接线缺陷（rig42 的 `android-ai-1-assistant.png`）—— 源码已修，设备读数已取（rig46）**：
`apps/mobile/src/ai/AssistantScreen.tsx` 的捕获步把词条 `web.ai.capture.noteLead`
（「确认后会按上面的字段写入。截止时间是」）整句当 `hint` 用，而 Web 那侧是
`noteLead + noteStrong + noteTail` 三段拼成一句（`AiCapture.tsx:610`：
「…截止时间是**模型的推算**，请核对后再填。」）。移动端只取了前半截 ⇒ 屏上留下一句以
"截止时间是"结尾的悬空话。**这是接线错，不是词条错**（词条没写坏，坏在把"引导语"当成完整句），
所以修法就是**按同一条口径拼三段**，不新增词条、不动中英对账。
同处另修一条小的：失败面的「技术详情」标签与它下面的诊断原文之间没有分隔，
读起来像同一句话重复两遍（现按本文件既有的 `{'\n'}` 分线写法处理）。
✅ 已跑的：`@heyta/mobile` typecheck、`pnpm check:ui-language`（342 文件 / 475 处文案 / zh 3156 = en 3156）、
`@heyta/mobile` 单测（现量看汇总行）。
✅ **设备读数已取（rig46，装的是当前源码的产物 —— 预检那条 `装的是当前源码的产物` 在同一趟里）**：
人打开看过两张，逐字记下来，因为"截了图"不等于"看了图"（§6.2 规定一）。
· `android-ai-1-assistant.png`（mtime 11:42，本轮起跑之后）：输入框下方那句现在是完整的
  「确认后会按上面的字段写入。截止时间是模型的推算，请核对后再填。」—— **不再以"截止时间是"悬空结尾**；
  同一张里五档 chips（一句话捕获／拆解任务／优先级建议／预估耗时／第 5 枚在横向滚动区外沿）与
  常驻脚注「AI 只给建议：没有任何一条改动会在你确认之前写进去。」都在屏上。
· `android-ai-2-egress-blocked.png`（mtime 11:47）：红色那句「该功能需要你先批准内容离开本机。」之后，
  「技术详情」是**单独一行标签**，其下四行诊断原文各自成行（发送内容／数据会发送到你自己配置的 AI 端点…／保留…），
  即上一段那条"标签与原文挤成一句"的修法在当前产物上看得见。
🟡 **看图顺手登记的一条（不判红、不当缺陷修）**：那一块的「技术详情」首行与上面红色那句逐字相同
  （`该功能需要你先批准内容离开本机。`），也就是"技术详情"里第一行没有新增信息。它不是假话也不是接线错
  —— 是 `failure.detail` 把 reason 句子一起带了进来。留在这里是因为**下一次动这块时要顺手收掉**，
  而不是"再验一遍还看得见"。
🔴 **取证面还差一张**：第 5 步"只用本机档被闸门拦下"那一屏此前只有判据没有图。已在脚本里补上
  `shot_evidence "android-ai-5-local-only-blocked.png"`（第 13 步的归属循环读的是 `SHOT_FOCUS`，
  所以这张**自动进判据**，不需要改列表）—— 它的首轮读数属于 rig47 及以后，不属于 rig46。

**第 5 步当前的诚实状态**：三条候选里「逐功能同意没给」从定源**降级为待验证**（设备侧分不开
「控件没渲染」与「控件没滚到」）。剩下两条不需要设备、只靠读代码就能判：
`resolveAiRoute` 是否要求这一档的端点**声明工具能力**（假端点 `stub-model` 零能力声明，
而能力按 ADR-0010 是显式声明、不做推断），以及 `assistantTier` 在只用本机模式下是否把这档挡在外面。
判完才是产品裁决（若落在 tier，要拍的是「只用本机模式下助手可用到哪一档」）。
**本轮设备级读数收在这里：14/15，一条红如实留着 —— 不降级判据，也不拿载体跑通当产品完成。**

#### 第 5 步那条红的真身（2026-10-06 21:3x 读代码定源，不需要设备）

`resolveRoute`（`packages/ai/src/routing.ts:524`）的候选过滤里**没有"逐功能同意"这一道**，
所以库里 `consents=0` 与按钮 disabled 无因果关系 —— 上一节把它列成候选是错的（已删到 #330b 的教训里）。
真正拦住的是**能力过滤**：`requiredCapabilities('tool-calling') = ['tool_calling']`，
而 `endpointCapabilities()` 在端点没声明时回落到基线 `['structured_output']`
（`routing.ts:166`）；移动壳的端点表单**从来没有能力这一格**
（`AiSettingsSection.tsx` 里 `capabilit` 命中 0，web 的 `AiSettings.tsx` 有 27 处）。

⇒ 这是一条**真产品缺口**，不是载体问题：在手机上配好的端点，`tool-calling` 与 `breakdown`
两档永远进不了候选，而界面只表现为"发送按钮恒灰"，排除原因 `capability-missing` 从不递给人。
web 文件上方本来就写着这条教训（"一个必须由用户声明的字段，如果界面上无处可填，等于这个功能不存在"），
移动侧正是它的实例。

**本轮落地的修法**：`CAPABILITY_ORDER` 从 `apps/web` 提到 `packages/ai`（唯一事实源，两枚宿主共用），
移动表单补上能力声明那一格（chip + `ai-endpoint-cap-<capability>` 锚点 + 走现有 `web.ai.capability.*` 词条，
不新增文案）；一条都没勾 = 不写该字段，语义仍是"只有基线"（保守），勾了按顺序表定序写入。
新门禁：`check:mobile-ai-anchors` 判据 ⑨（每一枚能力都必须在移动表单里可填、顺序表不许被抄第二份），
三臂变异证明它会红（臂数由 `--self-test` 自己打印）。

**边界（不写成已闭合）**：装到设备上的那枚 APK 还没有这一格，`apps/mobile/src` 一改就把新鲜度门
顶成 rc=3，而 `windows-pc` 本轮不可达 ⇒ **第 5 步那条设备级判据（规则命中且零外发）本轮仍取不到读数**，
载体已经把"勾三档能力"接进建端点那一步，等一个能打新包窗口去量。

#### 这条缺口补完之后仍欠的那一层（2026-10-06 21:3x 现量）

- **设备级那一格没闭合，而且是外部前提**：`ssh -o ConnectTimeout=8 windows-pc` 于 21:33 现量仍然
  `Operation timed out` ⇒ 打不出带这一格的新 APK，而 `apps/mobile/src` 一改新鲜度门就把设备验收顶成 rc=3。
  第 5 步那条"规则命中且零外发"的设备级读数因此**本轮取不到**，不是被判据放宽、也不是被读成已完成。
- **组件级也验不了，理由要说清**：`apps/mobile` 有 `vitest run` 这条脚本却**一个测试文件都没有**，
  也没有 RN 渲染测试依赖 ⇒ 想跑 render 断言就得新增第三方依赖，而那要先过 §3.1/§3.2 两道门。
  本轮不为此塞依赖（宁可留一格待验证）。
- **替代落点 = 把不变量钉成会红的门禁**：`check:mobile-ai-anchors` 新增判据 ⑩
  「每个功能要求的能力必须在 `CAPABILITY_ORDER` 里有一枚」，与 ⑨（移动表单渲染顺序表每一枚）合成一条
  完整不变量：**能力要求 ⊆ 界面可声明**。臂 20 是阳性对照（原样副本不误红），臂 21 是变异
  （给 `tool-calling` 加一枚表外能力 `audio` ⇒ 非零且点名它）。臂数由 `--self-test` 自己打印。
- **ADR 撞号那一格由所有者落笔**：主检出的 `4b31fde5`（"0053 撞号改判 0056 + 新门禁 check:adr-numbering"）
  已经把它改了；本支不可达该笔。⇒ **本支不再自行改名**（两处各改一次会造出竞争性重命名，
  合并时是双份 churn），合流时取他们那份。本支留着的 `0053-endpoint-address-class…` 是同一份内容的旧号。

#### E 项第二批（续 2）：整链走到许可证段，照出"登记表被陈旧安装印胖"这条判据缺口

 Goal-E 要求"每步跑相关门禁并用变异证明它能失败"。归属门落地后重跑整条 `pnpm check`，
 这一次它**走过**了前面所有段、红在许可证：

```
🔴 许可证清单**已过期**：它是在 lockfile `0f3c1bf6d9e21526` 下渲染的，而当前是 `a60c9f81c96f52a8`
FULLCHECK_RC=1
```

 按提示重渲染 ⇒ `research/licenses-inventory.generated.md` 从 **1093 枚降到 961 枚**（少 132）。
 三个假设按顺序被现量否证，过程记入 [traps #357](../reference/environment-traps.md)：

 | 假设 | 现量 | 结论 |
 |---|---|---|
 | "我这棵树装得不全 ⇒ 清单被缩印" | `pnpm install --frozen-lockfile` 693 ms 的 no-op | 否证：什么都没补上 |
 | "主检出的 1093 是真值" | 当前 `pnpm-lock.yaml` 全文 `expo` 命中 **0**，而主检出 store 多 **151 个目录**、多出来的全是 expo 子树 | 否证：**陈旧的是那份安装**，登记表被**印胖**了 |
 | "用 python 解析 v9 `snapshots:` 当全集" | 得 621 个键 ⇒ 把 **426 枚合法依赖**判成陈旧 | 放弃：那会逼人放宽判据 |

 🔴 **这条缺口的形状**：清单的数据源是**实际安装的 store**（这是它的立场，也是它的价值），
 而 `--check-stamp` 只比 lockfile 的哈希 —— 它答"渲染时 lockfile 是不是这个"，
 答不了"渲染时那把 store 是不是当前 lockfile 的那个集"。装过又删掉 ⇒ 印胖（把已经不存在的依赖当合规依据写进提交物）；
 半装 ⇒ 印瘦（该登记的漏掉）。两种都在"stamp 对得上"的世界里安静通过。

 补的判据是**充分不必要**那一层：store 里去重后的每枚 `name@version` 必须能在当前 lockfile 文本里查到。
 四处落点（判据只有一个所有者 `research/tools/license-inventory.mjs`）：

 1. `reconcileInputSet()` + 人读输出 `☑️ 清点输入集：store 去重后 961 枚，逐枚都能在当前 lockfile 里查到`，
    两处退出码都把它算进去；
 2. 🔴 **渲染侧也拒绝**（`render-license-inventory.mjs` 读到 `inputSet.stale` 非空即 `拒绝渲染` 退 1）——
    只在检查里红，脏产物还是会被写进仓库；
 3. 顺带把"登记的 store 不在场"从**只打印**改成响亮拒绝（半装的 store 曾经照样报"全部宽松 ✅"）；
 4. `check:licenses` 变成 `--self-test && 正常跑`，给自检找一个会失败它的消费者
    （`check:gate-wiring` 盯着它进链）。

 **能失败的证据**（臂数由 `--self-test` 自己打印，不抄进文档）：真实树那一臂是阳性对照
 （证明这把尺不是恒红）、夹具那一臂**恰好点名**被拿走的 `stalepkg@9.9.9`、放回去那一臂证明
 "红只来自这一维"、另两臂测缺 store / 缺 lockfile、最后一臂查渲染器真有 `拒绝渲染` 消费方。
 🔴 **真实陈旧树的控制读数（不是夹具）**：
 `HEYTA_LICENSE_ROOT=<主检出> node research/tools/license-inventory.mjs` ⇒
 `MAIN_REALTREE_CONTROL_RC=1` + `🔴 清点输入集：store 里有 132 枚在当前 lockfile 里查不到`
 （样例 `@expo/cli@57.0.27`、`@expo/config@57.0.9`）。
 ⚠️ 取这一格控制读数时先踩了一次 [#45](../reference/environment-traps.md)：命令接 `| tail` ⇒
 读到的 `RC` 是 `tail` 的 0；改成无管道重定向进文件再取码。

 四面消费者的最终读数（都在本树、当前 lockfile `a60c9f81c96f52a8` 下）：
 `check:licenses` rc=0、`check:licenses:stamp` rc=0、`check:image-license` rc=0、`check:gate-wiring` rc=0
 （它打印"门禁定义 92 道 ｜ 链里被引用 94 段 ｜ 链外 2 道"）。

 🔴 **归属与边界，不包装成完成**：主检出那份安装需要它自己 `pnpm install` 才会对上当前 lockfile ——
 那是**别人的工作树状态，本轮只登记不代改**。而本树这次的"缩印"读数说明一件事：
 1093 那一张登记表**从来不是**由当前声明算出来的，它是某个历史时刻的 expo 实验留下的安装态。
 也就是说**这一次没有把产品弄错**（961 才是当前声明的集），但**判据本身以前挡不住反过来的那种错** ——
 一份永远对不上当前 lockfile 的安装可以长期把登记表印胖而全绿。

#### E 项第三批：整链走过许可证段，红在 e2e —— 并把"载体中途死了"补成一条会红的门

 这次整条 `pnpm check`（载体 = 本树 @ `d16e5d4c`+`876e1928`）**走过**了 1–76 段，
 包括上一次判红的那两格：`check:licenses` rc=0、`check:licenses:stamp` rc=0（`a60c9f81c96f52a8`）、
 `check:image-license` rc=0、`check:gate-wiring` rc=0。链尾其余段逐段现量 rc=0：
 `check:shell-unicode` / `shell-exit-chain` / `selfhost-entry-command` / `web-storage` / `web-migration` /
 `web-artifact` / `script-snapshot` / `verify-script-copy` / `mobile-ai-anchors` / `android-gradle-remote` /
 `apk-freshness` / `shell-erasure-parity` / `mobile-first-run-gate` / `screenshot:verify`（23 个目标）。

 🔴 **红在第 78 段 `check:ai-e2e`，而它不是产品红**：起跑 `✅ 4318 / 4319 都是空的` ⇒ 归属门放行，
 前 6 条 ✅（17 s 量级），**第 7 条起逐条在 ~130 ms 上红到套件尾**（`23 ✓ / 238 ✘`），
 取一条 `error-context.md` 才看到真身：`page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4318/`。
 全过程、第二半（后半程连的是**别人那棵树**的 dev server）与修法都写进 [traps #358](../reference/environment-traps.md)；
 这一轮的 `238 failed` **不作**任何产品结论，也不回填成"206 条缺陷"。

 补出来的判据（链 94 → **95** 段，新增第 77 段 `check:e2e-carrier`，插在 ai-e2e **之前**）：

 | 落点 | 内容 |
 |---|---|
 | `e2e/reporters/carrier-signature.mjs` | 签名表单一所有者，**零 import**（`e2e/` 不在 pnpm 工作区内，根门禁只引得动这一半） |
 | `e2e/reporters/carrier-health.mjs` | 命中即打印「这一轮 e2e **作废**，立刻停止（不是产品失败）」并以 **160** 退出（刻意不用 1） |
 | 三份进链配置 | 各带一份报告器；少带一份由门禁判红 |
 | `scripts/check-e2e-carrier.mjs` | 七臂自检（臂数由它自己打印）：真原文阳性对照 / 普通断言与 60 s 超时**不许**命中 / 签名表分母自检 / 三份配置逐份引用 / 摘一份必红（反证）/ 真子进程命中退 160 / 真子进程不命中不中止 |

 ✅ 读数：`--self-test` **7 臂 0 失败**、真实检查 rc=0（`3 份进链配置各引用 …，签名表 4 枚`）、
 `check:gate-wiring` rc=0（它把新这道门算进"链里被引用"的分母）。

 🔴 **这一格只补了一半**：报告器认"没人在"（传输层拒绝），**认不出"有人应答但不是我这棵树"**。
 而后者这次是**实际发生过**的 —— `apps/web/evidence/keyboard-cursor/` 下 6 枚证据图采集于 20:35–20:38、
 内容是真界面（人已打开看过），但那一刻 4318 上应答的是主检出的 server ⇒ 它们不是本树的证据。
 已按路径 `git checkout --` 还原成上一轮合法采集的那份（**没有**留成"看起来对"的图），
 干净重采等 ai-e2e 拿到端口窗口那一轮。要真闭合这一格需要往 `index.html` 注入一次性构建标记并逐条对账
 （与 #356 同一条"写入方署名 + 读方判归属"的路）—— **本轮没做，登记成待办**。

 🔴 根因**不在并发这一维**：两次跑都停在同一处 ⇒ 去查"谁 kill 了本树的 vite"，命中本仓自己的跑前清场 ——
 `scripts/check-ai-e2e-preflight.mjs:124` 的归属判定用 `args.includes(REPO_ROOT)`，而本机有
 `…/01_PROJECTS/heyta` 与 `…/01_PROJECTS/heyta-wt-merge` 这对**互为前缀的兄弟目录名**，
 于是主检出的清场把本树的 vite 判成"本仓残留"SIGKILL 掉。
 🔴 文件头第 29 行本来就承诺了"多个检出/工作树互不误伤"，而代码没实现它 —— 这条的形状不是"缺判据"，
 是"承诺写在注释里"。`cwd` 那一支一直带分隔符（`REPO_ROOT + '/'`），漏的只有 args 这一支。

 ✅ 修法与读数（逐项现量）：

 | 落点 | 内容 | 读数 |
|---|---|---|
| 归属判定 | args 那一支改成**按路径比**（命中根路径后紧跟 `[A-Za-z0-9._+~%-]` ⇒ 另一个目录名，不算本仓）；纯判定抽成 `ownsProcess({args,cwd},root)` | `--self-test` ⇒ `ST_RC=0`（臂数由它自己打印） |
| kill 主体 | 收进 `main()`，只在**直接运行**时执行 ⇒ 被 import 或被 `--self-test` 时零进程副作用 | 自检全程不碰真实进程 |
| 消费者 | `check:ai-e2e` 前置 `--self-test`：**敢杀进程的的门先自证判得对** | `check:gate-wiring` rc=0 |
| 变异 | 把分隔符判定退化成裸 `includes`（同目录写副本、跑完即删） | `MUT_RC=1`，红集**恰好只有臂 1**（证明咬的是"路径边界"这一维）；`scripts/__mutate*` 残留现量 0 枚 |
| 相关门禁复跑 | `check:e2e-carrier` / `check:gate-wiring` / `check:shell-unicode` / `check:docs` / `check:doc-citations` | 各 rc=0 |

 ⚠️ **两条边界，不包装成完成**：① 只修了**本树**这一份 —— 主检出那份前置门现量仍是 `args.includes(REPO_ROOT)`
 （该文件在它那边是已提交状态、不由我代改），所以本树拿到干净 e2e 窗口的外部前提多一条"对面也落了这个修复"；
 ② `e2e/` 里 19 个文件把 4318/4319 **硬编码**（`grep -rl` 现量），把端口彻底参数化是独立一批
 （它会撞到别人会话正在跑的套件），本轮**没做**。

 `pnpm -r test`（链最后一段）这一趟 rc=1，两条都要分开记：

 1. **一条真红形状**：`apps/mobile` 的 `tests/legal-recheck-mobile.spec.ts:215`
 「没配凭据时问 ⇒ 一个请求都不发，判 anonymous 且不拦」`Test timed out in 5000ms`（5043 ms），
 汇总 `Tests 1 failed | 771 passed (772)`。**单跑该文件 29/29 rc=0**，
 而跑动期间宿主负载从门上的 12 涨到 23–32（别人那条 Chrome + playwright）。
 ⇒ 按 AGENTS §8 第 7 条的口径记：**这一格红由别人的负载消**，本轮**既不记产品失败、也不折进
 `RTEST-UNHANDLED-01`**（那是 unhandled rejection，与超时不同形状），留一条"低负载重跑该包"的收口动作。
 2. **`pnpm -r` 默认在第一个失败处 bail**（日志末 `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @heyta/mobile`）
 ⇒ "20 枚有 `test` 脚本的包 vs 只有 15 行 `Tests … passed` 汇总"**不是**"有一层从来没被跑过"，
 而是被截断。这一趟拿到的通过条数是 **6696（15 个包）**，**不是全量**。
 全量收口动作：`pnpm -r --no-bail test` 一次，把 20 行汇总凑齐再对一次数（AGENTS §6 那条元规则要的是相等，
 不是"看起来都跑了"）。
