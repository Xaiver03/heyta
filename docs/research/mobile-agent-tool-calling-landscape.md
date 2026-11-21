# 移动端「AI 助手 + 工具/函数调用」实现全景（2025–2026）

> 面向 heyta 的调研报告。范围：iOS / Android / React Native / Flutter 应用内如何实现「AI 助手 + function calling / tool use」。
> 只做调研与选型建议，不写产品代码。
>
> 报告日期：2026-11-21。所有外部结论都附来源；无来源的判断标为【推断】，查不到的标【未知】。

---

## 0. 标注约定（全文通用）

| 标记 | 含义 |
|---|---|
| **【事实】** | 有可核查出处（官方文档、官方博客、可复核的第三方报道 / 代码）。文末「来源清单」给 URL |
| **【推断】** | 基于事实的工程判断或合理外推，**没有**该产品/该库的直接公开说明 |
| **【未知】** | 公开资料不足，必须实测或向厂商确认才能下结论 |
| **【前提修正】** | 任务描述里的前提与 2026-11 的公开事实有出入，就地纠正 |

一句话读法：**产品案例里只有 Apple / Google(Android) 给了平台级「端侧工具调用循环」的公开文档；做任务管理 App 的几家（Todoist、滴答、Notion）几乎都是云端 agent；Things 干脆不自建 agent，走系统 App Intents。** 详见 §1。

---

## 1. 结论先行

1. **移动端 AI 助手的主流形态是「云端跑 reasoning + 工具，客户端只渲染流」**，而不是「手机里跑 agent 循环」。任务管理类（Todoist Ramble、滴答清单 AI、Notion Agent）都是云端；模型调用的 tool/function calling 发生在**云端的编排层**（或厂商自己的后端），App 只负责采集语音/文本、展示流式结果、处理 OAuth 与确认。**依据见 §1 各产品条目。**
2. **真正「设备端跑 agent 循环」是 2025–2026 新出现的能力，且由操作系统提供**：Apple Foundation Models（`Tool` 协议 + on-device `SystemLanguageModel` + Private Cloud Compute 升档）与 Android ML Kit GenAI（`AgentRunner` 类明确负责「多步工具调用循环」）。**第三方 App 自建端侧 agent 内核仍属少数派。**
3. **不管循环跑在哪，模型调用都必须代理到自家后端、API key 绝不下发到 App**——这是所有安全资料的共识，且已有实证论文表明 iOS App 存在明文 LLM key 泄漏。
4. **RN 的流式是最大的工程坑，但已有成熟解**：RN 内置 `fetch` 是 XHR polyfill、没有 `response.body`；官方/社区路径是 `expo/fetch`（Expo 52+）或流式 XHR polyfill。**Hermes 的 WebAssembly 至今未随任何公开 RN 发行版出货**（见 §4 前提修正）。
5. **给 heyta 的推荐（详见 §5）：「设备端 loop（App 内，驱动已有的单步执行器）+ 服务端代理模型 + 云端工具 API 可选」。** 这与 heyta 现状（ADR-0035 单步工具、`invokeRouted` 生产出境点、`packages/ai/src/stream.ts` SSE 切帧、托管供给档）最贴合，且不把 API key 放进 App。**风险最高的两个未知**：Hermes 上跑多步循环的实时性与稳定性、以及流式在纯 RN（非 Expo）下的实现成本。

---

## 2. 研究方法

- 检索：DeepSeek 官方 Search/Fetch + 通用 web 抓取交叉验证；每条产品结论尽量回到官方帮助中心 / 官方博客 / 官方开发者文档。
- 优先一手来源：`developer.apple.com`、`developers.google.com`、`reactnative.dev`、`ai-sdk.dev`、`help.ticktick.com`、`help.dida365.com`、`notion.com/help`、`culturedcode.com`。
- 二手报道（如 TechCrunch、Canaltech、WebProNews）只在补充「模型/时间线」等细节时使用，并明确标注为报道。
- 所有被引用的产品实现细节都**没有**来自我训练记忆的臆测；凡无出处一律标【推断】/【未知】。

---

## 3. 第一部分：产品案例

### 3.1 总览表

| 产品 | 移动端 AI 助手形态 | agent 循环跑在哪 | 工具/函数调用在哪一层 | 公开工程资料 |
|---|---|---|---|---|
| **Todoist（Ramble）** | 语音「边说边成任务」，实时改口 | **云端** | 云端模型（据报为 Gemini 2.5 Flash Live via Vertex AI）+ 结构化抽取 | 官方博客/媒体稿为主，无公开架构博客【事实+报道】 |
| **滴答清单 / TickTick AI 助手** | 自然语言指令，创建/拆解/复盘/语音添加/录音总结；另有 MCP | **云端**（推断） | 云端 LLM + 自家任务 API（MCP 形态对外暴露） | 官方帮助中心有功能说明，**无公开架构** |
| **Things 3** | **不自建 AI 助手**；靠 Siri AI / App Intents / Shortcuts「Use Model」/ 第三方 MCP | OS / 用户自选 | OS 层（App Intents）或 Shortcuts | 官方博客明确「准备好接入 OS 27 / Siri AI」【事实】 |
| **Notion（Agent）** | 多步任务、跨工作区与已连应用、MCP 服务器、Auto 模型路由 | **云端** | 云端编排 + MCP/内部工具 | 官方帮助 + 发布报道；**无客户端实现细节** |
| **Gemini in Keep / Gmail（Workspace apps）** | 在 Gemini App 里读写 Keep/Gmail/Calendar/Tasks | **云端**（Gemini App + Google 后端） | Google 侧「Workspace apps / extensions」连接器 | Workspace 官方博客【事实】 |
| **Apple Intelligence（Siri AI / Foundation Models）** | 系统级；App 用 App Intents 暴露动作；App 内可用 Foundation Models 自建 | **端侧 + 私有云**（可升档到任意云模型） | Foundation Models `Tool` 协议 / App Intents | 官方开发者文档 + WWDC 报道【事实】 |
| **Android（Gemini Nano / ML Kit GenAI）** | App 内端侧生成与「agentic workflow」 | **端侧**（AICore/Gemini Nano） | ML Kit `AgentRunner` 多步工具调用循环 / `GenerativeModel` 手管工具 | 官方开发者文档【事实】 |

> **读表要点**：把「语音→结构化任务」当成 agent，是常见的误读。Todoist Ramble 与滴答的「AI 语音添加」本质是**一次模型调用 + 结构化输出（structured output / JSON schema）**，不一定有真正的多步工具调用；它们演示的是**低摩擦捕获**，不是自主 agent。【推断，依据各自功能描述】

---

### 3.2 Todoist AI（Ramble，2026-01 发布）

- **【事实】功能**：2026 年 1 月上线「Todoist Ramble」，把一段口语化的、结构散乱的语音转成带项目、截止日期、优先级、时长、指派人信息的任务，且**边说边实时更新**，支持「其实改成周四」「就这些」这类改口。覆盖 iOS / Android / desktop / web。来源：[TechCrunch 2026-01-21](https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/)、[XDA 评测](https://www.xda-developers.com/todoist-ramble/)、[MacMagazine](https://macmagazine.com.br/post/2026/01/22/todoist-agora-permite-descrever-tarefas-com-linguagem-natural/)。
- **【事实（二手报道）】模型与调用路径**：据 Canaltech 报道，Ramble 基于 LLM，使用 **Google Gemini 2.5 Flash Live，经 Vertex AI**，用于实时理解语音；AI 转写音频并识别需要生成任务的要素。来源：[Canaltech 2026-01-21](https://canaltech.com.br/apps/nova-ia-do-todoist-organizara-suas-tarefas-enquanto-voce-conversa-com-o-app/)。
- **【推断】agent 循环位置**：云端。客户端采集音频、渲染实时结果；「理解 + 结构化」在 Doist 后端 / Vertex AI 侧完成。移动 App 内**没有**跑 agent 循环的证据。
- **【未知】**：具体是单次调用还是多步 tool 循环、工具 schema 细节、是否用 function calling 还是纯 structured output——Doist 未公开工程博客。

### 3.3 滴答清单 / TickTick AI 助手

- **【事实】功能与平台**：滴答「AI 助手」可用自然语言创建任务、拆解项目、整理清单、阶段复盘；移动端开启路径为「设置 → 功能模块 → AI」，帮助页写「目前仅支持 iOS、鸿蒙，Android 版本正在开发中」；Web 端支持，Mac/Windows 在开发。另有「AI 语音添加（AI 模式）」「录音转写 + 结构化总结」。来源：[滴答帮助：AI 助手](https://help.dida365.com/articles/7502990612036059136)、[更新动态（10-08 AI 助手上线）](https://help.dida365.com/articles/6950689674532749312)、[TickTick What's New（EN）](https://help.ticktick.com/articles/7082552170989486080)。
- **【事实】MCP**：滴答已支持 **MCP**，可连 ChatGPT / Claude 等外部 AI 工具来管理任务。来源同上（更新动态条目「滴答清单 MCP」）。
- **【推断】架构**：AI 助手本体跑在滴答云端（账号、任务数据在云同步），客户端只做交互；「MCP」那部分是把滴答的任务 API 以 MCP server 形式对第三方开放，属**工具层**而非端侧 agent。
- **【未知】**：滴答未公开模型供应商、是否 function calling、端侧是否跑任何推理。**「Android 版本开发中」这一句的具体日期不可考**（帮助页无发布日期）。

### 3.4 Things 3（反面样本：不自建 agent）

- **【事实】**：Things 没有内置对话式 AI 助手。它通过系统能力接 AI：为 OS 27 的 **Siri AI** 做好准备、接入 Spotlight、并支持 Shortcuts 的新「Use Model」动作（可用端侧或云模型，读取 Things 数据并通过 `Find Items` 传给模型）。来源：[Cultured Code 博客：Things for OS 27 and Siri AI（2026-09）](https://culturedcode.com/things/blog/2026/09/things-for-os-27-and-siri-ai/)、[Things 博客索引（Shortcuts Use Model 说明）](https://culturedcode.com/things/blog/index.html)。
- **【事实】** 生态里另有第三方 **Things MCP Server**（社区项目），让 ChatGPT/Claude 通过 MCP 操作 Things。来源：[things-mcp README](https://github.com/hald/things-mcp)、[PyPI things-mcp](https://pypi.org/project/things-mcp/)。
- **【推断】**：这是「**不把 AI 塞进 App，而是把 App 暴露成系统/协议上的工具**」的路线。适合把 AI 责任外推给 OS 或第三方客户端，代价是体验分散、无法控制模型与隐私边界。

### 3.5 Notion Mobile（Notion Agent）

- **【事实】**：Notion Agent 是「AI 团队成员」，能用工作区与已连应用的上下文创建/编辑页面与数据库，可执行多步任务，支持连接 MCP 服务器；默认拉当前页面上下文。商用/企业版可选「Auto」让 Notion 选模型。来源：[Notion 帮助（中文）](https://www.notion.com/zh-cn/help/notion-agent)、[Notion 帮助（EN）](https://www.notion.com/en-gb/help/notion-agent)。
- **【事实（报道）】**：2026-10-19 Notion 重写了 AI 代理，升级「Auto」模型路由（称在 20+ 常见任务上以约低 90% 平均成本达到接近前沿模型的效果），并上线两级额度制。来源：[WebProNews 2026-10-19](https://www.webpronews.com/notion-rebuilt-agents-auto-model-router-new-credit-system/)。
- **【推断】**：Agent 逻辑与模型都在 Notion 云端；移动 App 只是前端。多步编排、模型路由、MCP 工具调用都在服务端。**没有**公开证据表明 Notion 在手机上跑 agent 循环。
- **【未知】**：是否有客户端侧 tool 执行（如读本机剪贴板/文件）；移动端与桌面端能力差异的官方说明。

### 3.6 Google Gemini in Keep / Gmail（Workspace apps）

- **【事实】**：Google 把「Workspace extensions」升级为「Workspace apps」，让 Gemini App 能引用并操作 **Calendar、Docs、Drive、Gmail、Keep、Tasks** 的数据，包括在 Keep 取笔记/清单并新建、在 Gmail 读/查、在 Tasks 增改任务与提醒、在 Calendar 增改事件。2025-05 起通用可用（GA）。来源：[Google Workspace Updates（2025-05-12 GA）](https://workspaceupdates.googleblog.com/2025/05/google-workspace-apps-are-now-generally-available-for-the-gemini-app.html)、[Gemini 帮助：连接 Workspace 应用](https://support.google.com/gemini/answer/15229592)、[2024-10 扩展 beta 公告](https://workspaceupdates.googleblog.com/2024/10/gemini-app-extensions-calendar-keep-tasks-beta.html)。
- **【事实】形态**：这是「**Gemini App 作为 agent，Keep/Gmail 作为工具/数据源**」——不是 Keep 自带一个 agent。Keep 的 AI 能力通过 Gemini 这个统一入口获得。
- **【推断】**：工具调用在 **Google 后端**（Gemini App ↔ Workspace 服务），手机端只渲染对话。数据是 Google 自家账号体系内。
- **【未知】**：Keep 是否会在自身 App 内做端侧模型能力（目前没有官方证据）。

### 3.7 Apple Intelligence（Siri AI / Foundation Models / App Intents）

这是本次调研里**信息最充分、对 heyta「端侧 vs 云」决策最关键**的一块。

- **【事实】Foundation Models 框架**：原生 Swift API，可访问「**on-device 与 Private Cloud Compute** 的 Apple 基础模型」，也支持**任何符合 `Language Model` 协议的模型提供方**；用 `@Generable` 做引导式结构化生成；用 **`Tool`** 定义模型可调用的自定义工具（例如查本地/在线数据库、调 App 内服务）；提供 **Dynamic Profile**，可在一次会话内**动态替换模型、工具、指令**——官方明说是为「构建 agents 或 skills」这类抽象准备的。最低 iOS 26 / iPadOS 26 / macOS 26 等。来源：[Apple 开发者文档：Foundation Models](https://developer.apple.com/documentation/foundationmodels)、[Apple Intelligence 开发者页](https://developer.apple.com/apple-intelligence/)。
- **【事实】iOS/iPadOS 27 扩展**：可在 Apple Foundation Models、**Cloud models like Claude and Gemini**、或任何符合 `Language Model` 协议的提供方之间选择；多模态 prompt（文本+图片）；Vision 框架的 OCR/条码等可在**端侧**被模型直接调用；Dynamic Profiles 运行中换模型/工具/指令。来源：[Apple 开发者：What's new in iPadOS 27](https://developer.apple.com/ipados/whats-new)。
- **【事实】App Intents + Siri AI**：App 通过 App Intents 把内容与动作接入 **Siri AI** 与系统（个人上下文理解、App 动作、屏幕感知）。2026-06 的 WWDC 报道确认 App Intents 更新用于连接 Siri AI 能力。来源：[Apple Intelligence 开发者页](https://developer.apple.com/apple-intelligence/)、[MacTech 2026-06-08](https://www.mactech.com/2026/06/08/apple-accelerates-app-development-with-new-intelligence-frameworks-and-advanced-tools/)。
- **【推断】**：Apple 给的是「**平台托管的端侧 agent 原语**」——`SystemLanguageModel`（端侧）+ `Tool`（工具）+ Dynamic Profile（动态工具/指令），外加 Private Cloud Compute 升档。工具循环由 Foundation Models 框架在你的 App 进程内驱动。这意味着**如果你走原生 iOS，可以几乎零成本拿到「端侧循环 + 工具」**；但 heyta 是 RN/跨端，用不了这套 Swift API 直接复用（可能要靠原生模块桥接）。
- **【未知】**：on-device 模型在「任务管理」这类多步工具调用上的实际可靠性、上下文窗口、延迟与耗电的量化数据；跨 App 工具调用的权限模型细节。

### 3.8 Android：Gemini Nano / AICore / ML Kit GenAI

- **【事实】端侧模型**：Gemini Nano 运行在 Android 的 **AICore** 系统服务里，端侧推理、无需联网/不上传；ML Kit GenAI API 基于 AICore，提供 summarization、proofreading、rewriting、image captioning、speech recognition 等开箱能力。来源：[Android 开发者：Gemini Nano](https://developer.android.google.cn/ai/gemini-nano)、[ML Kit GenAI 概览](https://developers.google.com/ml-kit/genai)。
- **【事实】agent 循环 API**：ML Kit GenAI 的「Custom generation and agents」下有两个类：
  - `GenerativeModel`：直接对 Gemini Nano 做自定义文本/多模态 prompt、或**结构化输出**，并**手动管理多轮会话历史与工具声明**；
  - **`AgentRunner`**：建立在 `GenerativeModel` 之上，**自动化多轮会话管理（含内存中的对话历史）与「多步工具调用循环」**。
  来源：[ML Kit GenAI 概览（韩文/日文版明确写「멀티스텝 도구 호출 루프 / マルチステップツール呼び出しループ」）](https://developers.google.com/ml-kit/genai?hl=ko)（英文页同一节为 "Custom generation and agents"）。
- **【推断】**：Android 平台**已内建一个端侧多步工具调用循环**（`AgentRunner`）。对 Android 原生 App 而言，「设备端跑 agent 循环」是现成的；但模型是 Gemini Nano（能力弱于云端大模型），适合轻量、隐私敏感、离线的任务。
- **【未知】**：`AgentRunner` 在 RN（通过原生模块）里可用性、能挂多少自定义工具、与云端模型协作的混合模式细节。

### 3.9 §1 小结（对「设备端 loop 还是云端」的直接回答）

- **任务管理 App（Todoist / 滴答 / Notion）**：**云端 agent**。移动端是客户端，工具调用在云端。没有公开证据表明它们在手机上跑 agent 循环。【事实 + 推断】
- **系统级（Apple / Google）**：**开始提供端侧 agent 循环原语**（Foundation Models `Tool` / ML Kit `AgentRunner`），但都是 2025–2026 才落地，且绑定各自 OS。
- **Things**：**不内建 agent**，把能力暴露到 OS/协议层。
- 所以，对 heyta 这类第三方跨端 App，「手机里自己跑完整 agent 循环」既不是行业默认，也不是唯一解；**云端编排 + 客户端轻循环**是更常见、更稳的选择。

---

## 4. 第二部分：工程方案

### 4.1 三种基本架构（先分清「循环在哪」）

| 架构 | agent 循环位置 | 模型调用位置 | 优点 | 缺点 |
|---|---|---|---|---|
| **A. 全云端编排** | 自家后端 | 自家后端（key 在服务端） | 客户端极薄、易灰度、易计量 | 每步都要网络往返；流式断线要处理；端侧无隐私收益 |
| **B. 设备端 loop + 服务端代理模型** | App 进程内 | 经自家代理到模型厂商 | 交互延迟可控（循环本地）、可边跑边执行本地工具、key 不下发 | App 要内嵌 agent 内核；工具 schema/执行都在端上；打包体积、Hermes 兼容要实测 |
| **C. 平台端侧 loop（原生）** | OS 框架（Foundation Models / ML Kit） | 端侧模型（可升档云） | 无网可用、隐私最好、零 API 费 | 模型能力弱；绑定单一 OS；RN 需原生桥接 |

> 现实产品多为 **A**；平台厂商推 **C**；**B 是 heyta 最可能的落点**（见 §5）。

### 4.2 在 RN / iOS / Android / Flutter 内嵌 agent loop 的常见做法

**通用的 agent loop（与语言无关）**：

```
messages = [system, user]
loop:
  llmResp = callModel(messages, tools=schemas, stream=true)
  messages.append(llmResp)
  if llmResp.stop_reason != "tool_use": break
  for call in llmResp.tool_calls:
      result = executeLocalOrRemoteTool(call.name, call.args)   # 校验 args → 执行 → 结果
      messages.append(toolResult(call.id, result))
  if stepCount >= maxSteps: break
```

要点（**这些是 OpenAI / Anthropic 官方 function calling 的通用形状**）：

- **【事实】OpenAI**：用 `tools` 声明 JSON Schema；模型返回 `function_call`，你执行后把 `function_call_output`（含 `call_id`）回灌进 `input`，再请求；支持 `parallel_tool_calls` 并行多工具。2025-03 起归入 Responses API / Agents SDK。来源：[OpenAI 函数调用指南（Responses）](https://developers.openai.com/zh-Hans/api/docs/guides/function-calling?api-mode=responses)、[OpenAI 帮助：Function calling](https://help-lb.openai.com/id-id/articles/8555517-function-calling-in-the-openai-api)。
- **【事实】Anthropic**：Messages API 里 `stop_reason` 可能是 `tool_use`，`content` 是混合块（text / tool_use / thinking），要**遍历 content blocks**而不是当字符串；把 `tool_result` 回灌继续循环。来源：[Claude Agent SDK 流式输出文档](https://code.claude.com/docs/en/agent-sdk/streaming-output.md)、[anthropic-ts 实践规则（含「必须处理 stop_reason=test_use，否则工具循环断」）](https://github.com/microsoft/skills/blob/f03ec5392f7a0f3aca12af47477e92f1edf7b44c/.github/plugins/microsoft-365-agents-toolkit/skills/teams-app-developer/experts/models/anthropic-ts.md)。

**四端落地差异（【推断】，基于各端运行时事实）：**

- **React Native**：agent loop 用 JS 写（纯 TS），工具执行要么打到自家后端、要么调本地库；流式见 §4.4。**不要把 npm 上依赖 Node/WASM 的库直接塞进 RN**（见 §4.6、§6）。
- **原生 iOS**：可用 Foundation Models 的 `Tool` + `SystemLanguageModel` + Dynamic Profile 直接跑**端侧循环**；要接自家后端模型则走 URLSession + SSE。
- **原生 Android**：可用 ML Kit `AgentRunner` 跑端侧多步循环，或自建 loop 调自家网关。
- **Flutter**：Dart 侧自建 loop 最直接；`http` 包支持流式（`StreamedResponse`），SSE 可用 `http`/`dio` 的流式响应，或通过 platform channel 复用原生网络。**【未知】** Flutter 端侧 agent 内核的成熟度（社区库零散，需实测）。

### 4.3 模型调用如何「代理到自家后端」（API key 绝不下发）

**做法（【事实】这是安全共识，且有实证论文支撑）**：

1. **App 只跟自家后端对话**：客户端发用户消息/工具结果 → 自家网关持有厂商 key → 网关调 OpenAI/Anthropic/Gemini → 把流或结构化响应回给 App。
2. **绝不在客户端放厂商 key**：不要 `NEXT_PUBLIC_*`、不要把 key 打进 RN/Expo bundle、不要硬编码。来源：[atlas AI 集成安全](https://github.com/iamvikshan/atlas/blob/bec7b01f5f90606fab476e9b27b469c669cdc90e/skills/vibe-security/references/ai-integration.md)、[MEF Mobile：安全集成 OpenAI](https://mefmobile.org/how-to-integrate-openai-models-into-web-and-mobile-apps/)、[火山引擎：RN 安卓安全调用 OpenAI（轻量代理后端）](https://www.volcengine.com/article/2188919)。
3. **实证依据**：学术论文《Mind Your Key: An Empirical Study of LLM API Credential Leakage in iOS Apps》系统分析了 iOS App 的 LLM 凭证泄漏（明文 key / 无鉴权代理等）。来源：[arXivLens 摘要](https://arxivlens.com/paperview/details/mind-your-key-an-empirical-study-of-llm-api-credential-leakage-in-ios-apps-412-8b109e41)。
4. **配套**：给每次请求设每用户配额、硬性花费上限、按环境/用途分 key、定期轮换。来源：[ai-zona/adk 安全指南](https://github.com/ai-zona/adk/blob/main/docs/security.md)、[atlas 安全](https://github.com/iamvikshan/atlas/blob/bec7b01f5f90606fab476e9b27b469c669cdc90e/skills/vibe-security/references/ai-integration.md)。

> **注意**：「代理到后端」有三种粒度——(a) 纯转发厂商 API（最省事，但把工具循环也交给客户端）；(b) 后端只做模型调用、工具在端上执行（B 架构）；(c) 后端做完整编排（A 架构）。heyta 已有「托管供给档 + 出境闸门」，天然适合 (b)。

### 4.4 流式（SSE）在 RN 怎么实现

**先纠正一个常见误解**：不是「RN 完全没有流」，而是「**RN 内置 `fetch` 没有 `response.body`**」。

- **【事实】内置 fetch 的真相**：RN 的 `fetch` 是 XMLHttpRequest 的 polyfill，**不填充 `response.body`**，所以拿到的是整包而非增量流。来源：[oRPC Expo 适配说明](https://github.com/dinwwwh/orpc/blob/2b2e28cf6ee44de396cdb894e9ce312c58c4a292/apps/content/docs/adapters/expo.mdx)、[`@the-polyfills/fetch-sse` 说明](https://socket.dev/npm/package/@the-polyfills/fetch-sse)。

**三条可用路径（【事实】）：**

| 路径 | 做法 | 适用 |
|---|---|---|
| **expo/fetch（推荐）** | `import { fetch } from 'expo/fetch'`，返回真正的 `response.body`（ReadableStream），可 `getReader()` 增量读 SSE；Expo SDK 53 起原生提供 `ReadableStream/WritableStream/TransformStream` 全局。 | Expo 项目（SDK 52/53+） |
| **流式 XHR** | 手写 `XMLHttpRequest`，监听 `readyState===3` 时读 `responseText` 增量；或用 `@the-polyfills/fetch-sse`（无依赖、纯 TS，把 fetch 封成流式 XHR + SSE reader）。 | 纯 RN（无 Expo） |
| **polyfill 全家桶** | `react-native-polyfill-globals` + `web-streams-polyfill` + `text-encoding`，开启 `fetch(..., { reactNative: { textStreaming: true }})`。 | 历史方案，较繁琐 |

来源：[oRPC Expo 适配](https://github.com/dinwwwh/orpc/blob/2b2e28cf6ee44de396cdb894e9ce312c58c4a292/apps/content/docs/adapters/expo.mdx)、[StackOverflow：RN 流式 fetch（含 expo/fetch 示例）](https://stackoverflow.com/posts/79005464/revisions)、[`@the-polyfills/fetch-sse`](https://socket.dev/npm/package/@the-polyfills/fetch-sse)、[WireAI：Hermes ReadableStream 问题](https://getwireai.com/blog/hermes-readablestream-llm-streaming-react-native-fix)、[DEV：RN 流式聊天实战](https://dev.to/famitha_ma_b9c13ab1d324e/building-an-ai-chat-interface-in-react-native-with-streaming-responses-1b8g)。

**还常缺 `TextDecoder` / `TextDecoderStream`**：

- **【事实】** RN 里常见 `ReferenceError: Property 'TextDecoder' doesn't exist`；需要 polyfill（`text-encoding`）或在入口先 import polyfill 再 import SDK。来源：[SurrealDB RN 文档](https://github.com/surrealdb/docs.surrealdb.com/blob/872e6a99834aef8a7fd5fdcdfd5ea06db0c00393/src/content/reference/javascript/frameworks/react-native.mdx)。
- **【事实】** AI SDK 在 Expo 上流式会因缺 `TextDecoderStream` 报 `AI_APICallError`；官方 Expo 指南要求在 polyfills 里注册 `TextEncoderStream/TextDecoderStream`（来自 `@stardazed/streams-text-encoding`）。来源：[vercel/ai issue #13588（被综述引用）](https://knowledgeforagents.com/problems/fde77ea7-676f-4c92-99b7-4e14b2ca9d28/revisions/1)、[AI SDK Expo 指南](https://ai-sdk.dev/docs/getting-started/expo)。

> **给 heyta 的含义**：heyta 是 RN + 自有 `packages/ai/src/stream.ts`（SSE 切帧纯字符串实现）。这套「纯字符串切帧、不读流」的设计正好**绕开了 `TextDecoder`/ReadableStream 依赖**（见 §4.6 内部现状），在 RN 上是优势；真正要解决的是**字节层**：用 `expo/fetch` 或 XHR 增量把 chunk 喂给切帧器即可。

### 4.5 bundle 体积

- **【事实】Vercel AI SDK**：`ai` 核心约 **15.2 kB**（min+gzip），单个 `@ai-sdk/openai` provider 约 **18 kB** 级；整套按 provider 约 34–60 kB gzip。来源：[pkgpulse：LangChain.js vs Vercel AI SDK 2026](https://www.pkgpulse.com/guides/langchainjs-vs-vercel-ai-sdk-2026)。
- **【事实】LangChain.js**：core 约 **101 kB gzip**，且「blocks edge runtime」；集成越加越大。来源同上、[Kanopy Labs 对比](https://kanopylabs.com/blog/vercel-ai-sdk-vs-langchain-vs-mastra)。
- **【推断】**：移动端 bundle 首包敏感，**优先只在客户端放「薄 loop + 流解析」，把提示词、工具 schema、编排尽量放后端**；不要把整个大框架打进 App。

### 4.6 heyta 现状对齐（内部事实，供选型用）

heyta 现在**已经有一半的基础设施**（本节为仓库内文档，非外部来源）：

- `packages/ai/src/provider.ts`：OpenAI 兼容 HTTP，含**工具线格式** `AiInvocation.tools` / `extractToolCalls`；
- `packages/ai/src/stream.ts`：**SSE 切帧的唯一实现**——保留半帧、CRLF、`data:` 提取、跨帧装配文本/思考/工具调用；**纯字符串、不读流**，因此「在没有 `TextDecoder` 的运行时里也能单测」；
- `packages/ai/src/routing.ts`：`invokeRouted()` 是**生产唯一出境执行点**（多端点、回退、熔断）；
- `packages/app-host/src/ai-tool-{selection,run,call}.ts`：**单步**工具选择/执行/模型路径；读即执行、**写只产出提案**，`confirmAiToolProposal()` 是唯一写点（ADR-0035）；
- 供给模式 `off/own/managed`（`supply.ts`），托管档有境内供应商白名单（`managed-endpoints.ts`）。

> **结论**：heyta 不需要从零造 agent loop，缺的是**「把单步执行器循环起来的控制器 + 前端实时渲染」**。见 §5。

---

## 5. 第三部分：框架 / 库横评

| 方案 | RN 可用性 | agent 循环 | 工具 schema | 流式 | 体积 | 结论 |
|---|---|---|---|---|---|---|
| **Vercel AI SDK（`ai` + `@ai-sdk/react`）** | **官方有 Expo 指南**（Expo 52+，用 `expo/fetch` + `DefaultChatTransport`） | v5 起 `stopWhen`/`stepCountIs(N)` 控制多步工具轮数（v6 文档示例；当前文档 v7） | Zod/native JSON Schema | 流式（需 `TextDecoderStream` polyfill） | 小（`ai` ~15kB） | **RN 首选**，但要把模型代理到自己后端 |
| **LangChain.js** | 有 RN 摩擦：常见 `ReadableStream doesn't exist, js engine: hermes` | 强（agent/链/工具） | Zod | 需 polyfill | 大（core ~101kB gzip） | **不推荐塞进移动端**；放后端可以 |
| **OpenAI / Anthropic 官方 SDK** | 逻辑可跑，但官方**没有**「RN 移动端 tool use 示例」专项；SDK 默认读 env key → **不适合直接放客户端** | 手写 loop（官方文档给标准形状） | JSON Schema | OpenAI/Anthropic SDK 支持 stream，但 RN 需自行解决底层流 | 小-中 | 只用于**后端**；客户端不要直接调 |
| **`@earendil-works/pi-agent-core`（pi-mono / 原作者 Mario Zechner）** | **待实测**：库本身是「Stateful agent with tool execution + event streaming」，架构与工具循环很完整；但 heyta ADR-0013 §6.4 记录其 `engines: node>=22` → 仅桌面可内嵌 | 完整（`Agent`：turn/tool 事件、parallel/sequential、`beforeToolCall`/`afterToolCall`、steering、follow-up） | TypeBox 校验 | 事件流（`message_update` 带 delta） | 未知 | **成熟但偏 Node**；移动端移植性【未知】，需实测 |
| **平台原生（Foundation Models / ML Kit AgentRunner）** | RN 需原生桥接 | 端侧现成 | 各自协议 | 各自 | 系统内置 | **端侧能力的最优解**，但绑 OS、能力受限 |

**关键事实补充：**

- **【事实】Vercel AI SDK Expo**：官方指南要求 Expo 52+，装 `ai` + `@ai-sdk/react` + `zod`，服务端建 `/api/chat`，客户端用 `useChat` + `DefaultChatTransport({ fetch: expoFetch })`；并说明需在 polyfills 里注册 `TextEncoderStream/TextDecoderStream`。来源：[AI SDK Expo 指南](https://ai-sdk.dev/docs/getting-started/expo)。
- **【事实】AI SDK 多步工具**：v5/v6 用 `stopWhen(stepCountIs(N))` 在**一次请求**内跑多轮工具调用（服务端）。来源：[TanStack「从 Vercel AI SDK 迁移」文档（对照 v5/v6）](https://github.com/tanstack/ai/blob/1888233ddb501d14b17aa9a5f3497373a0e9242e/docs/migration/migration-from-vercel-ai-advanced.md)、[assistant-ui v6 文档：Multi-step tool calls](https://github.com/assistant-ui/assistant-ui/blob/477c46f6092c07f1e207bdbb7f91d3bc3461996b/apps/docs/content/docs/runtimes/ai-sdk/v6.mdx)。
- **【事实】`react-native-vercel-ai`（社区包，2023）**：明确说 RN fetch 不支持流式，所以「**在手机上拿到的是非流式整包响应**」，Web 回退到 `ai/react`。来源：[npm react-native-vercel-ai](https://www.npmjs.com/package/react-native-vercel-ai)。→ 说明「老方案」确实牺牲流式；现在应用官方 Expo 路径替代。
- **【事实】pi-agent-core**：`Agent` 核心概念——`AgentMessage` vs LLM Message、`transformContext`/`convertToLlm`、事件序列（`agent_start → turn_start → message_* → tool_execution_* → turn_end → agent_end`）、`parallel` 默认 / `sequential`、`beforeToolCall`（可拦截并 `terminate`）、`afterToolCall`、steering（工具运行时注入指令）、follow-up。来源：[npm @earendil-works/pi-agent-core](https://www.npmjs.com/package/@earendil-works/pi-agent-core)、[pi-mono 仓库](https://github.com/badlogic/pi-mono)、[framework-analysis: pi](https://github.com/larsderidder/framework-analysis/blob/main/tier-2/pi.md)。
- **【事实】heyta 内部对 Pi 的判断**（ADR-0013 §6.4，仓库内）：`engines: node>=22` → 仅桌面可内嵌，Web/移动端不行；README 明写**无内建权限系统**、以用户全权限运行 → 与 heyta 隐私承诺冲突；`pi-ai` 与 `packages/ai` 职责撞车 → 建议 `packages/ai` 保留策略层、Pi 只跑循环。→ **这是 heyta 移动端不应直接引 pi-agent-core 的硬理由。**

---

## 6. 第四部分：已知坑（务必先看清）

### 6.1 Hermes 与 WebAssembly ——【前提修正】

- **【事实】历史与现状**：`uniffi-bindgen-react-native` 文档明写「**Hermes 没有 `WebAssembly`**，标准 RN 里 wasm2 跑不了，请用 JSI」；另一处同样写「Hermes has no `WebAssembly`」。来源：[uniffi wasm2 概览](https://app.unpkg.com/uniffi-bindgen-react-native@0.31.0-6/files/docs/src/reference/wasm2/overview.md)、[uniffi wasm README](https://app.unpkg.com/uniffi-bindgen-react-native@0.31.0-5/files/runtimes/wasm/README.md)。
- **【事实】2026 的变化**：RN 0.84（2026-02-11）把 **Hermes V1 设为默认引擎**，官方博客**没有**提 WebAssembly；而 `@dtelecom/vodozemac-rn`（2026-05）写得很精确：「**WebAssembly 尚未随任何 RN 发行版出货。Hermes V1（RN 0.84+）在 2026-02 的预览里有 runtime Wasm 支持，但实现位于 Meta 内部 monorepo，截至 2026 年中无法从公开 Hermes commit 或 RN 预编译产物获得。**」来源：[RN 0.84 博客](https://reactnative.dev/blog/2026/02/11/react-native-0.84)、[dtelecom/vodozemac-rn](https://www.npmjs.com/package/@dtelecom/vodozemac-rn)。
- **结论（给 heyta）**：**在可预见的公开 RN 发行版上，仍应按「Hermes 无 WebAssembly」来设计**。任何依赖 WASM 的库（部分 tokenizer、解析器、加密库、`uniffi wasm`）在 RN 上都要用 **JSI / 原生模块**替代，或干脆放后端。**不要在客户端依赖 WASM。**

### 6.2 RN 的 `fetch` / `ReadableStream` / `TextDecoder`

- **【事实】** RN 内置 `fetch` 无 `response.body`（XHR polyfill）→ 必须 `expo/fetch` 或流式 XHR（§4.4）。
- **【事实】** 常缺 `TextDecoder` / `TextDecoderStream` → 需 polyfill（§4.4）。
- **【事实】** RN 无 `EventSource` 时，SSE 要自己解析（AI SDK / fetch-sse 都给了解析器）。来源：[DEV：RN 流式实战](https://dev.to/famitha_ma_b9c13ab1d324e/building-an-ai-chat-interface-in-react-native-with-streaming-responses-1b8g)。

### 6.3 后台 / 并发 / 离线

- **【推断】** 移动 OS 会挂起后台进程：**长 agent 循环不能假设 App 一直在前台**。多步循环要设计成「每步可持久化、可恢复」，或把长任务交给后端（A 架构）。iOS 后台执行受限、Android 有 Doze/后台限制——这是通识，公开文档层面 Apple/Google 均有后台执行限制说明（本报告不逐条引，属平台常识）。
- **【推断】** 并发工具调用：pi-agent-core 默认 `parallel` 预检后并发执行；OpenAI 支持 `parallel_tool_calls`。但要**限制并发与总步数**（`maxSteps` / `stepCountIs`），否则成本与延迟失控。
- **【推断】** 离线：只有架构 C（平台端侧）能真正离线；架构 A/B 断网即失败，需明确降级（排队、提示、缓存）。

### 6.4 密钥安全

- 见 §4.3。**核心一句：厂商 key 只在服务端；App 只持有自家后端签发的短期 token。**

### 6.5 成本与限流

- **【事实】** 必须设每用户配额 + 硬性花费上限 + 按环境/用途分 key + 轮换。来源：[atlas 安全](https://github.com/iamvikshan/atlas/blob/bec7b01f5f90606fab476e9b27b469c669cdc90e/skills/vibe-security/references/ai-integration.md)、[adk 安全](https://github.com/ai-zona/adk/blob/main/docs/security.md)。
- **【推断】** agent 循环会**放大**成本（每步一次模型调用 + 工具调用）。heyta 内部已有「失败的工具调用照样计入步数」「三个上界」的设计（`ai-architecture.md` §13 附近），方向正确——多步循环必须把「步数/工具次数/token」全部纳入计量与限流。

### 6.6 端云协同的现实结论（外部综述）

- **【事实/观点】** 华为云社区文章结论：手机上跑「能替你操作其他 App」的 Agent，**纯端侧撑不起连续画面理解、纯云端扛不住毫秒级交互与隐私**，正解是**端云协同**——端侧守实时感知/动作执行/敏感数据，云端做复杂规划与长上下文。来源：[华为云社区 2026-10-21](https://bbs.huaweicloud.com/blogs/502745)。
- **【事实/观点】** 端侧智能体四大挑战：混合、工具、评估、记忆；引用 LangChain《State of Agent Engineering》（1340 份问卷，57.3% 组织已有生产级 agent）。来源：[微信「Agent进化论③」2026-01-05](http://mp.weixin.qq.com/s?__biz=MzUyOTYwMTEwNg==&mid=2247529426&idx=1&sn=5440e6cb6f98349464a4e71164c21836)。
- **【推断】** 对任务管理 App（非「操作其他 App」），端侧算力压力小得多；真正的取舍是「隐私/离线 vs 模型能力/成本」，而不是「实时画面理解」。

---

## 7. 第五部分：给 heyta 的可执行建议

### 7.1 方案对比

| 维度 | 方案1：全云端编排（A） | **方案2：设备端 loop + 服务端代理模型 + 云端工具 API（B）** | 方案3：平台端侧 loop（C） |
|---|---|---|---|
| 循环位置 | 后端 | **App 内（JS）** | OS 框架 |
| key 安全 | 最好（后端持有） | 好（后端持有，App 拿短期 token） | 无关（系统模型） |
| 多步体验延迟 | 每步一次网络往返，长 | **循环本地，工具本地执行快** | 快 |
| 工具能访问本地数据 | 要走本机 API/MCP | **天然可读本地 SQLite/op-log** | 受 OS 沙箱限制 |
| 隐私 | 明文出境多 | 可控（可只发指令不发原始文本） | 最好（端侧） |
| 模型能力 | 最强 | 强（同云端模型） | 弱（端侧小模型） |
| 工程量 | 低（后端做） | **中**（要写 loop + 流式 + 恢复） | 高（原生桥接，双端各写） |
| 与 heyta 现状契合 | 高 | **最高**（已有单步执行器、出境界、SSE 切帧） | 低（RN 用不上 Swift/Kotlin 直接 API） |

### 7.2 推荐：**方案 2 ——「设备端 loop + 服务端代理模型 + 云端工具 API 可选」**

**理由（先结论后依据）：**

1. **heyta 已有 80% 的地基**：单步工具执行器（`ai-tool-run.ts`，读即执行/写只提案）、生产出境点 `invokeRouted()`、SSE 切帧 `stream.ts`（纯字符串、无 TextDecoder 依赖）、托管供给档。**只需再加一个「循环控制器」把它重复调用**，而不是新建一套。依据：`docs/reference/ai-architecture.md`、`docs/plans/ai-strategy.md`。
2. **本地优先是 heyta 的产品定位**：设备端 loop 能直接读本地 SQLite / op-log 执行工具，不必先把数据上传云端再让云端「调用本机 API」——这与「本地为主、云端是同步通道」一致。
3. **密钥安全天然满足**：模型调用走已有 `invokeRouted()` → 后端代理，App 永不持有厂商 key。
4. **流式坑已被 heyta 的「纯字符串切帧」化解**：只需要用 `expo/fetch`（Expo）或 XHR 增量把字节喂进 `stream.ts`，**不必依赖 `TextDecoderStream`**。
5. **写操作安全边界可保留**：ADR-0035 的「写只产出提案、确认才落库」在循环里继续成立——**循环里可以多次读、但写仍要回到提案 + 用户确认**，不因为「多步」就放开写。

**具体落地形态（建议，不是代码）：**

- **循环控制器**：纯 TS，放 `packages/app-host` 或新 `ai-agent-loop.ts`；接口 `runLoop({ messages, tools, maxSteps, executor })`。
  - 每步：`invokeRouted({ text, tools, stream: true })` → 解析 `tool_calls` → 逐个 `runSelectedTool()`（读即执行 / 写产出提案）→ 回灌 `tool_result` → 继续。
  - 上界：`maxSteps`、每个工具的调用次数、token 预算；**失败的调用照样计步**（沿用 heyta 既有口径）。
- **工具 schema**：复用 `packages/local-api/src/tools/` 的目录与 `additionalProperties:false`，**不要为移动端另造一套**。
- **流式**：`stream.ts` 不动，新增一个「字节源适配器」——Expo 用 `expo/fetch` 的 `body.getReader()`；纯 RN 用 XHR `readyState===3` 增量。
- **恢复**：每步把 `messages` 快照进本地（op-log 或独立表），App 被挂起后可从最后一步恢复。
- **云端工具 API**：**可选、后置**。先做「本地工具 + 后端模型」；确有需要（如日历、邮件、第三方 SaaS）再把「云端工具 API」作为额外工具源接入，仍走同一套工具契约与授权。

**不建议的：**

- ❌ 直接把 `pi-agent-core` 塞进移动端（heyta ADR-0013 已记 `node>=22`、无权限系统、与 `packages/ai` 撞车）。
- ❌ 客户端直连 OpenAI/Anthropic（key 泄漏）。
- ❌ 依赖 Hermes 的 WASM（未随公开 RN 发行版出货）。
- ❌ 一上来就做「全自动多步写」——违背 heyta「先挣信任」的既有节奏（`ai-strategy.md` §8）。

### 7.3 明确标注「需实测」的未知

| # | 未知 | 为什么必须实测 | 建议验证方式 |
|---|---|---|---|
| U1 | Hermes 上跑多步 agent 循环的实时性与稳定性（内存、卡顿、long session） | 没有公开 benchmark；不同 RN 版本差异大 | 在目标 RN 版本上跑 20 步循环，量化每步延迟/内存 |
| U2 | 纯 RN（非 Expo）下流式实现成本 vs 迁 Expo | `expo/fetch` 最省事，但迁 Expo 有成本 | 对比 XHR 增量 vs expo/fetch 的代码量与稳定性 |
| U3 | iOS 端侧 Foundation Models 能否经 RN 原生模块复用（`Tool` + `SystemLanguageModel`） | Apple 只给 Swift API，RN 无现成桥 | 写一个最小原生模块跑通一次 tool call |
| U4 | Android `AgentRunner` 在 RN 原生模块里的可用性与工具挂载能力 | 文档在韩/日文最全，英文页信息少 | 原生 Demo 挂 2 个自定义工具 |
| U5 | `@earendil-works/pi-agent-core` 在 RN/移动端的真实可移植性（是否真依赖 Node/WASM） | 库声称可移植，但 heyta ADR 只测到 `node>=22` | 在 RN 工程里 `import` 并跑最小 loop，看是否踩 Node API |
| U6 | 各模型厂商 2026 年的 function calling 计费与限流细则（尤其并行工具、多步） | 价格与限流频繁变 | 查各厂商当前定价页 + 小规模压测 |
| U7 | 竞品（Todoist/滴答）到底用不用 function calling，还是纯 structured output | 无公开工程博客 | 抓包/逆向或等官方技术分享（合规范围内） |

### 7.4 一句话给产品决策

> **把「agent 循环」放在 App 里跑，把「模型调用」代理到自家后端，把「云端工具 API」作为可选增量。** 这既拿到本地优先的体验与隐私优势，又守住密钥安全与 heyta 已有的单步工具/出境界；代价是要实测 RN 的循环性能与流式实现（U1–U3），并**不要在移动端依赖 Hermes WASM 或直接搬 pi-agent-core**。

---

## 8. 来源清单

> 访问与核对日期：2026-11-21。分类整理；URL 均为真实可访问页面（部分为本地化/镜像版本时会注明）。

### 8.1 产品 / 官方文档

**Todoist（Ramble）**
- TechCrunch（2026-01-21）：<https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/>
- Canaltech（2026-01-21，含「Gemini 2.5 Flash Live via Vertex AI」）：<https://canaltech.com.br/apps/nova-ia-do-todoist-organizara-suas-tarefas-enquanto-voce-conversa-com-o-app/>
- XDA 评测：<https://www.xda-developers.com/todoist-ramble/>
- MacMagazine：<https://macmagazine.com.br/post/2026/01/22/todoist-agora-permite-descrever-tarefas-com-linguagem-natural/>

**滴答清单 / TickTick**
- 滴答帮助：AI 助手：<https://help.dida365.com/articles/7502990612036059136>
- 滴答更新动态（AI 助手 / MCP / AI 语音 / 录音总结）：<https://help.dida365.com/articles/6950689674532749312>
- TickTick What's New（EN）：<https://help.ticktick.com/articles/7082552170989486080>
- TickTick App Store（AI Assistant 描述）：<https://apps.apple.com/jp/app/ticktick-to-do-list-calendar/id626144601?l=en-US>

**Things 3**
- Cultured Code：Things for OS 27 and Siri AI：<https://culturedcode.com/things/blog/2026/09/things-for-os-27-and-siri-ai/>
- Cultured Code 博客索引（Shortcuts「Use Model」）：<https://culturedcode.com/things/blog/index.html>
- things-mcp（社区 MCP）：<https://github.com/hald/things-mcp> · <https://pypi.org/project/things-mcp/>

**Notion**
- Notion 帮助（中文 Notion Agent）：<https://www.notion.com/zh-cn/help/notion-agent>
- Notion 帮助（EN）：<https://www.notion.com/en-gb/help/notion-agent>
- WebProNews（2026-10-19，重写 Agent / Auto 路由 / 额度）：<https://www.webpronews.com/notion-rebuilt-agents-auto-model-router-new-credit-system/>

**Google Gemini / Workspace（Keep / Gmail）**
- Workspace Updates（2025-05-12，Workspace apps GA）：<https://workspaceupdates.googleblog.com/2025/05/google-workspace-apps-are-now-generally-available-for-the-gemini-app.html>
- Gemini 帮助：连接 Workspace 应用：<https://support.google.com/gemini/answer/15229592>
- Workspace Updates（2024-10，Calendar/Keep/Tasks beta）：<https://workspaceupdates.googleblog.com/2024/10/gemini-app-extensions-calendar-keep-tasks-beta.html>

**Apple**
- 开发者文档：Foundation Models：<https://developer.apple.com/documentation/foundationmodels>
- Apple Intelligence 开发者页：<https://developer.apple.com/apple-intelligence/>
- What's new in iPadOS 27（任意模型、多模态、Dynamic Profiles）：<https://developer.apple.com/ipados/whats-new>
- MacTech（2026-06-08，App Intents 连 Siri AI）：<https://www.mactech.com/2026/06/08/apple-accelerates-app-development-with-new-intelligence-frameworks-and-advanced-tools/>
- TechRepublic（2025-06-10，WWDC 开放端侧基础模型）：<https://www.techrepublic.com/de/article/news-apple-platforms-state-union-2025/>

**Android / Gemini Nano**
- ML Kit GenAI 概览：<https://developers.google.com/ml-kit/genai>
- Gemini Nano（Android 开发者）：<https://developer.android.google.cn/ai/gemini-nano>
- ML Kit GenAI（韩文版，明确 AgentRunner 多步工具循环）：<https://developers.google.com/ml-kit/genai?hl=ko>

### 8.2 RN 工程（流式 / WASM / 运行时）

- React Native 0.84 发布（Hermes V1 默认）：<https://reactnative.dev/blog/2026/02/11/react-native-0.84>
- `@dtelecom/vodozemac-rn`（Hermes V1 preview 有 WASM，但未随 RN 出货）：<https://www.npmjs.com/package/@dtelecom/vodozemac-rn>
- uniffi-bindgen-react-native：wasm2 概览（Hermes 无 WebAssembly）：<https://app.unpkg.com/uniffi-bindgen-react-native@0.31.0-6/files/docs/src/reference/wasm2/overview.md>
- uniffi：runtimes/wasm README：<https://app.unpkg.com/uniffi-bindgen-react-native@0.31.0-5/files/runtimes/wasm/README.md>
- oRPC Expo 适配（RN fetch 无 response.body / expo/fetch / SDK 53 流全局）：<https://github.com/dinwwwh/orpc/blob/2b2e28cf6ee44de396cdb894e9ce312c58c4a292/apps/content/docs/adapters/expo.mdx>
- StackOverflow：RN 流式 fetch + expo/fetch：<https://stackoverflow.com/posts/79005464/revisions>
- `@the-polyfills/fetch-sse`（流式 XHR + SSE reader）：<https://socket.dev/npm/package/@the-polyfills/fetch-sse>
- WireAI：Hermes ReadableStream / LLM 流式：<https://getwireai.com/blog/hermes-readablestream-llm-streaming-react-native-fix>
- DEV：RN 流式 AI 聊天实战：<https://dev.to/famitha_ma_b9c13ab1d324e/building-an-ai-chat-interface-in-react-native-with-streaming-responses-1b8g>
- SurrealDB RN 文档（TextDecoder 缺失）：<https://github.com/surrealdb/docs.surrealdb.com/blob/872e6a99834aef8a7fd5fdcdfd5ea06db0c00393/src/content/reference/javascript/frameworks/react-native.mdx>

### 8.3 框架 / 库

- AI SDK 官方 Expo 指南：<https://ai-sdk.dev/docs/getting-started/expo>
- vercel/ai issue #13588（Expo TextDecoderStream 导致流式失败）：<https://knowledgeforagents.com/problems/fde77ea7-676f-4c92-99b7-4e14b2ca9d28/revisions/1>
- TanStack：从 Vercel AI SDK 迁移（对照 v5/v6，含 stopWhen 多步工具）：<https://github.com/tanstack/ai/blob/1888233ddb501d14b17aa9a5f3497373a0e9242e/docs/migration/migration-from-vercel-ai-advanced.md>
- assistant-ui：AI SDK v6 文档（Multi-step tool calls / stopWhen）：<https://github.com/assistant-ui/assistant-ui/blob/477c46f6092c07f1e207bdbb7f91d3bc3461996b/apps/docs/content/docs/runtimes/ai-sdk/v6.mdx>
- npm react-native-vercel-ai（RN 不支持流式，整包返回）：<https://www.npmjs.com/package/react-native-vercel-ai>
- pkgpulse：LangChain.js vs Vercel AI SDK 2026（体积数字）：<https://www.pkgpulse.com/guides/langchainjs-vs-vercel-ai-sdk-2026>
- Kanopy Labs：AI SDK vs LangChain vs Mastra（体积/环境）：<https://kanopylabs.com/blog/vercel-ai-sdk-vs-langchain-vs-mastra>
- StackOverflow：LangChain 在 RN 报 `ReadableStream doesn't exist, js engine: hermes`：<https://stackoverflow.com/questions/77307779/react-native-issue-while-implementing-langchain>
- npm `@earendil-works/pi-agent-core`（Agent / 工具执行 / 事件）：<https://www.npmjs.com/package/@earendil-works/pi-agent-core>
- pi-mono 仓库（原作者 Mario Zechner）：<https://github.com/badlogic/pi-mono>
- framework-analysis：pi（TypeBox 校验、pi-agent-core 定位）：<https://github.com/larsderidder/framework-analysis/blob/main/tier-2/pi.md>

### 8.4 安全（密钥 / 代理）

- 火山引擎：RN 安卓安全调用 OpenAI（代理后端）：<https://www.volcengine.com/article/2188919>
- atlas / AI 集成安全（key 仅服务端）：<https://github.com/iamvikshan/atlas/blob/bec7b01f5f90606fab476e9b27b469c669cdc90e/skills/vibe-security/references/ai-integration.md>
- MEF Mobile：安全集成 OpenAI 到 Web/Mobile：<https://mefmobile.org/how-to-integrate-openai-models-into-web-and-mobile-apps/>
- ai-zona/adk 安全指南（key 代理 / 花费上限 / 轮换）：<https://github.com/ai-zona/adk/blob/main/docs/security.md>
- 《Mind Your Key: LLM API Credential Leakage in iOS Apps》（arXivLens 摘要）：<https://arxivlens.com/paperview/details/mind-your-key-an-empirical-study-of-llm-api-credential-leakage-in-ios-apps-412-8b109e41>

### 8.5 厂商 API 文档（function calling 形状）

- OpenAI 函数调用指南（Responses）：<https://developers.openai.com/zh-Hans/api/docs/guides/function-calling?api-mode=responses>
- OpenAI 帮助：Function calling 概览：<https://help-lb.openai.com/id-id/articles/8555517-function-calling-in-the-openai-api>
- Anthropic 实践规则（stop_reason / content blocks / tool loop）：<https://github.com/microsoft/skills/blob/f03ec5392f7a0f3aca12af47477e92f1edf7b44c/.github/plugins/microsoft-365-agents-toolkit/skills/teams-app-developer/experts/models/anthropic-ts.md>
- Claude Agent SDK：流式输出：<https://code.claude.com/docs/en/agent-sdk/streaming-output.md>

### 8.6 端云协同 / 行业综述

- 华为云社区：手机 AI Agent 的端云协同（2026-10-21）：<https://bbs.huaweicloud.com/blogs/502745>
- 微信「Agent进化论③」：端侧智能体四大挑战（引 LangChain State of Agent Engineering）：<http://mp.weixin.qq.com/s?__biz=MzUyOTYwMTEwNg==&mid=2247529426&idx=1&sn=5440e6cb6f98349464a4e71164c21836>
- Trinix Ways：On-Device AI in 2026 — What Actually Ships：<https://trinixways.com/blog/on-device-ai-2026-what-actually-ships>
- AgentMarketCap：On-Device vs Cloud Agent Architecture 2026：<https://agentmarketcap.ai/blog/2026/04/11/on-device-vs-cloud-agent-architecture-2026>

### 8.7 heyta 内部依据（仓库内文档，非外部 URL）

- `docs/reference/ai-architecture.md`（模块地图、`stream.ts` SSE 切帧、`invokeRouted()`、tool 线格式）
- `docs/plans/ai-strategy.md` §7.3（对 Pi 的判断：`engines node>=22`、无权限系统、与 `packages/ai` 撞车）、§8（信任阶梯）
- `docs/adr/0035-ai-tool-calling-reuses-local-api.md`（单步工具：读即执行 / 写只提案）
- `docs/adr/0013-cloud-ai-and-maas.md` §6.4（Pi 三约束）

---

## 9. 附：事实 / 推断 / 未知 速查

| 主题 | 事实（有出处） | 推断 | 未知 |
|---|---|---|---|
| Todoist Ramble | 2026-01 上线、跨端、语音实时改口；据报道用 Gemini 2.5 Flash Live/Vertex AI | 云端 agent，客户端只渲染 | 是否 function calling / 多步 |
| 滴答 AI | iOS/鸿蒙已支持、Android 开发中、Web 支持、支持 MCP、AI 语音/录音总结 | 云端编排 + MCP 工具层 | 模型、是否 function calling |
| Things | 无内建 AI 助手；接入 Siri AI/Shortcuts Use Model/MCP | 外推 AI 给 OS | —— |
| Notion | Agent 多步、MCP、Auto 路由；2026-10-19 重写 | 云端 agent | 客户端工具执行能力 |
| Gemini in Keep/Gmail | Workspace apps GA，Gemini App 读写 Keep/Gmail/Tasks | 后端连接器 | Keep 端侧能力 |
| Apple | Foundation Models `Tool`/on-device/Private Cloud Compute/Dynamic Profile；iOS 27 支持任意模型；App Intents 连 Siri AI | 端侧 loop 由框架在 App 进程驱动 | 多步可靠性/上下文/耗电量化 |
| Android | Gemini Nano/AICore；ML Kit `AgentRunner` 多步工具循环 | 端侧 loop 现成但模型弱 | RN 桥接可行性 |
| Hermes WASM | 历史上无 WASM；RN 0.84 有 preview 但未随公开发行版出货 | 按「无 WASM」设计 | 何时真正出货 |
| RN 流式 | 内置 fetch 无 response.body；expo/fetch 可流；缺 TextDecoder(Stream) | —— | 纯 RN 实现成本 |
| 密钥安全 | key 仅服务端；论文实证 iOS 泄漏 | —— | —— |
| 平台端侧能力（§4.6/§7） | heyta 已有单步执行器/出境界/SSE 切帧/托管供给 | 只需加循环控制器 | 性能/恢复（U1–U5） |
