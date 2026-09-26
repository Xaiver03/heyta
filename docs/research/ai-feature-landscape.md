# 任务管理 / 待办清单类产品的 AI 功能格局（2026-09）

> 调研日期：**2026-09-25**（本地时区 CST，UTC 2026-09-25 15:19 核对）。价格均为该日实测，之后可能变动。
> 范围：**除滴答清单 / TickTick 之外**的任务管理、待办、日历排程类产品，共 13 个（含 3 个同类合集）+ 5 个横向问题 + 2 个补充块（时间可视化 App、开放 API / MCP 策略）。
> 证据规则：每条事实后紧跟 `[来源: URL]`；一轮真实检索后仍查不到的写「未找到公开信息」，**不编造**。状态标注 shipped / beta / announced / discontinued 并尽量给日期。区分「厂商自称」与「第三方观察」。

## 0. 方法与证据强度说明

> 🔴 **勘误（2026-09-26）——本节列的"最大缺口"已被后续调研补齐，请勿再引用"四家零材料"。**
>
> 补做报告：[`e2ee-apps-ai.md`](e2ee-apps-ai.md)（1096 行，**192 处 ✅ 官方全文**）。
> **Standard Notes / Obsidian / Bear / Anytype 四家全部取得官方一手材料**，
> 且"E2EE + 客户端本地明文 API"的威胁模型**找到三份**（Joplin / Bear / Anytype）。
>
> 新结论：**heyta 有可直接借鉴的公开先例**（Bear 的本地 CLI + MCP；Joplin 的双开关模型），
> 而 🔴 **"厂商托管 AI + 维持 E2EE"在所有样本中一个都不存在**
> （Proton Lumo 明确说做不到，并把该路径改名为 U2L 加密）。
>
> ⚠️ **本报告其余的缺口标记保持不变**（「BYOK 的 UX 实例与踩坑」、
> 「自托管产品的 AI 责任归属」、以及**全部用户口碑类证据 ❌**）。
> 下面这段原文保留作历史记录 —— 它记下了"一次子调研失败被写成了结构性判断"这件事。

> **先读这一行**：本报告覆盖了原定问题的**绝大部分**，但**有三处缺口未能取证**——最严重的是「E2EE 产品（Standard Notes / Obsidian / Bear / Anytype）怎么处理 AI」**四家零材料**，以及「BYOK 的 UX 实例与踩坑」「自托管产品的 AI 责任归属」。**缺口在 §6.3、§7.1、§9.5 逐条标注，并在 §12 汇总。请勿用本报告的推理链替代那三处的事实。**

- **检索工具**：本轮调研期间 `web_search`（Tavily）返回 HTTP 432 不可用；主检索走 anysearch CLI，深入走 `web_fetch`。anysearch 免费额度在本次调研中途耗尽（"You've reached your API key's total free quota for today"），此后一律回退到 `web_fetch` 直取具体 URL。**这影响了「发现新 URL」的能力，不影响已有 URL 的取证。**
- **证据分级**（正文中已尽量标注）：
  - **一手**＝厂商官网 / 帮助中心 / 定价页 / 官方博客 / 官方文档，本轮实际抓取到正文。
  - **页面摘要**＝官网页面是 JS 单页应用，`web_fetch` 只取到标题，数字来自检索结果对**该官方 URL** 的摘要（已注明）。
  - **第三方**＝评测站、媒体、聚合站；一律标注，不作为定价唯一依据。
  - **用户口碑**＝Reddit / G2 / Trustpilot / V2EX / 知乎 / 应用商店。**Reddit 正文在本轮被反爬墙拦截**（humanity check / `.json` 失败），因此 Reddit 证据多为检索摘要引用的原句 + 帖子 URL，已逐条注明。
- **数据保留歧义**：`未找到公开信息` 不等于「该产品没有这个能力」，只表示本轮没有找到公开的一手依据。全篇的「未找到」清单见 [§9](#9-未找到公开信息清单)。

---

## 1. 总览：AI 在产品里的位置

| 产品 | AI 功能的「位置」 | 交互形态主线 | 有 AI 自动排程？ | AI 是否单独收费 | 模型 / 云或端侧 |
|---|---|---|---|---|---|
| **Todoist** | Assist 套件（Filter/Task/Email/Task Capture）+ Ramble 语音 + Automations(Beta) | 建议 + 确定性自动化（**明确拒绝「AI 替你猜」**） | ❌ 无（2016 的 Smart Schedule 已停用；Automations 是用户自写规则的定时工作流） | 含在 Pro $7/月（年付 $5）起；**Automations 按算力充值 $5/$10/$20，且需 Pro 生效中** | Bedrock(Claude/Nova) + Vertex(Gemini 2.5 Flash Live) + OpenRouter→DeepSeek V4 Flash，**全云** |
| **Motion** | AI Chat / AI Task Planner / AI Calendar & Meetings 等 6 项 | **自动执行**（最激进） | ✅ 有，且是产品本体 | 含在 Pro AI $19/seat/月起；**AI 额度制**，超额另计 | 未公开，**云** |
| **Reclaim.ai** | 全线以 AI 命名的 11 项（AI Focus Time / AI Habits / AI Planner / AI Assistant…） | 自动执行 + 严格锁（locks） | ✅ 有 | 含在订阅（Starter/Business）；14 天试用 | 未公开；**已并入 Dropbox** |
| **Akiflow** | Aki 执行助理、Schedule Optimizer、Meeting Assistant、MCP Connector | **只在用户显式点击时执行** | ⚠️ 有，但被官方文档写死边界 | Aki+MCP 含在 Pro；**Meeting Assistant +$19/月** | **公开子处理器名单**：Anthropic/OpenAI/Google/Groq/ElevenLabs/Vellum…，**云** |
| **Sunsama** | AI 估时 + 打 channel、Sunny 对话助手、MCP、Autoplan(beta) | **必须由用户显式动作触发**；2025 年公开反全自动 | ✅ 有（按 `X` 触发），2026-09-23 起有 Autoplan 规则 | 含在 Pro $17/月（年付）/ $22（月付） | 官方称「开源模型 + 第三方 LLM」托管在自有云；**未点名厂商**，云 |
| **Superlist** | Talk AI 语音、AI 会议纪要、AI 邮件/Slack 摘要转任务、Make AI | 建议 + 生成 | ❌ 无 | 分层：Basic 含语音；**AI 纪要/摘要在 Super $25/月** | 未找到公开信息 |
| **Notion** | Notion Agent、AI Meeting Notes、Enterprise Search、Research mode、Custom Agents | 对话 + **自主 agent**（Business 起） | ❌ 无 AI 排程 | **不再单独售卖**，锁进 Business $20；**Custom Agents 按 credit 计费 $10/1,000 credits** | 官方称「模型无关 / 多供应商」；企业版**零数据保留** |
| **飞书任务 / 妙记** | 妙记智能纪要、待办提取→创建任务、任务智能体、豆包工作伙伴 | 半自动 + **Agent 自动建任务** | ❌ 无（只有 Agent 定时触发） | 套件 ¥50/80/120 人/月；**AI 版本另购**（18万–2000万点/年）；个人 AI 会员 ¥69/月 | **豆包大模型**（原云雀）+ Kimi/GLM/DeepSeek/MiniMax 可选，**全云** |
| **Apple 提醒事项** | iOS 26 Siri 建议 + Auto-Categorize；iOS 27 自然语言创建 | **建议**，不是自动执行 | ❌ 无 | 随硬件免费；服务端功能有**每日额度**，Apple 称未来「for a fee」 | **AFM 3 五个模型**：端侧 3B dense / 20B sparse；PCC 云端；**与 Google Gemini 技术合作** |
| **Google Tasks / Gemini** | Gemini 与 Tasks 的集成（曾失效）；Workspace 侧 Gemini | 对话 | ❌ 无 | 随 Google One AI Premium / Workspace 档位 | Gemini；**Gemini Nano 端侧**（AICore） |
| **Any.do** | Any.do AI（建议填列表 / 拆子任务 / 建 board 清单）、Voice Mode | **纯建议，必须用户确认才写入** | ❌ 无 | 含在 Premium $4.99/月（年付）/$7.99（月付） | 未找到公开信息，云 |
| **Amazing Marvin** | 未见 AI 功能（定价页 0 次提及 AI） | 规则/策略引擎（非 AI） | ❌ 无（有启发式「suggested task」） | Marvin Pro $8/月（年付 $96） | 无 |
| **Routine** | 官网自称「AI-powered workspace」 | 未找到公开信息 | 未找到公开信息 | 未找到公开信息 | 未找到公开信息 |

**一句话格局**：**「捕获/整理」类 AI 已经全面铺开且用户认可；「排程/执行」类 AI 只有 Motion、Reclaim 两家真做，而头部厂商（Todoist、Akiflow、Sunsama、Feishu、Apple）都在公开文件里主动与「AI 自动安排你的时间」切割。**

---

## 2. 逐产品详述

### 2.1 Todoist（Doist）

**1) AI 功能（确切功能名）**
- **Todoist Assist**：官方定义为「AI 工具套件」，由三个功能组成 —— **Filter Assist**（自然语言生成过滤器）、**Task Assist**（浏览器扩展）、**Email Assist**（转发邮件自动抽取 due date / notes 变任务）。原文：*"Todoist Assist is our AI-powered suite of tools designed to work intelligently behind the scenes… automate task creation from emails and build complex filters using natural language."* [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O]
- **Task Assist** 能做 4 件事：为某个目标**建议任务**、生成完成任务的**小贴士**、**重写**任务使其更可执行、把复杂任务**拆成子任务**。默认不开，需手动装扩展。 [来源: 同上]
- **Filter Assist 目前仅支持英语和西班牙语**。 [来源: 同上]
- **Task Capture Assist**（Beta，**2026-04-21 → 2026-09-02**）：多模态捕获，**文本 ≤25k 字符、图片 ≤10MB、文档（PDF/MD/TXT）≤10MB**；入口是 Quick Add → **+** → **"Extract tasks…"**。 [来源: https://www.todoist.com/help/todoist/todoist-and-ai/capture-tasks-from-text-images-and-documents-cAflh0WKe]
- **Ramble 的准确时间线**：**beta 2025-11-19 → GA 2026-01-21 → Wear OS beta 2026-03-23**；支持 **40+ 语言**；**实时而非事后转写**；官方明确它**不是对话式助手**。 [来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF]
- ⚠️ **Ramble 首发时的识别准确率只有约 62%**（Doist 对 TechCrunch 的说法）——**这是「AI 捕获类功能上线初期的真实质量水位」的一个罕见硬数字**。 [来源: https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/]
- **Email Assist 是 Assist 套件里唯一有开关的功能**。 [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O]
- **Ramble**：AI 语音捕获，自然语言 → 结构化任务（含日期、优先级、项目、assignee），2026-01-21 前后发布。 [来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF] [来源: https://finance.yahoo.com/news/introducing-todoist-ramble-ai-turns-120000959.html]
- **Automations（Beta）**：用自然语言描述 → 生成可定时运行的**确定性工作流**（示例：每晚 0 点把逾期任务改到今天、Gmail 星标→任务、收据→Google Sheet、Notion 日期→日历+Slack）。**2026-04-01 宣布**，独立域名 `automations.todoist.com`，仍为 beta。 [来源: https://www.todoist.com/automations] [来源: https://todoist.substack.com/p/april-triage]

**2) 交互形态**
建议型为主（Filter/Task/Email Assist 都是「AI 提议，你确认」），加一个**确定性自动化**（Automations）和一个**语音输入**（Ramble）。**没有对话助手**——Todoist 至今没做 Chat 式助手。
值得注意的措辞证据：Automations 页面原文自夸 *"A workflow doing exactly what you told it to, **not AI guessing on your behalf**"*，并把每条自动化描述为 *"a predictable, pre-defined workflow you can count on, every time"*。 [来源: https://www.todoist.com/automations]

**3) 排程类 AI**
**没有自动排程。** Todoist 有 Calendar layout 与 Task duration（Pro），但任务不会自动被填进时间块；Automations 是「定时触发一个工作流」，不是「把待办安排进某个时间段」。 [来源: https://www.todoist.com/pricing] [来源: https://www.todoist.com/automations]

**4) 定价（2026-09-25 实测）**
- Beginner **$0**（5 个个人项目、Smart Quick Add、3 个过滤器视图、**Filter Assist**、**Ramble 每月 10 次 session**、Automations 不可用）
- Pro **$7/月（月付）或 $60/年（折合 $5/月）**，7 天试用；含 Task Assist + Email Assist + Task Capture + **Ramble 不限次数**
- Business **$10/人/月（月付）或 $8/人/月（年付 $96/年）**，14 天试用，另加当地税
[来源: https://www.todoist.com/pricing] [来源: https://www.todoist.com/help/account-and-billing/plans/todoist-plans-pricing-and-billing-faq-Vq2z0HWL6]
- **免费层 Ramble 的真实额度是「每月 10 次 session」**（**每月 1 日 UTC 重置，跨设备共享**），官方口径，不是我先前写的模糊「限次数」。 [来源: 同上]
- 权限分层原文：*"Some Todoist Assist features are available to all customers. **Pro Legacy** subscribers have access to **Filter Assist only**. Pro and Business subscribers have access to Filter Assist, Task Assist, and Email Assist."* [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O]
- 🔴 **Automations 的定价不是「$10/月加购」——那是错的，官方文档已给出真实模型**：**按算力充值，档位 $5 / $10 / $20（最低 $5），且必须先有生效中的 Pro 订阅**；余额**不可退款、不可转让**。所谓「$10/month add-on」只来自一条 YouTube 视频，**被一手文档否定**。 [来源: https://www.todoist.com/help/automations/get-started/manage-your-todoist-automations-compute-and-usage-XgozgXrGS] [来源: https://todoist.substack.com/p/april-triage]
- **涨价历史（官方文档）**：**2025-12-10 Pro 从 $5→$7/月、$48→$60/年**；Doist 自己给的理由**点名 Ramble 与自动化投入**。**App Store 订阅用户豁免**，留在旧价的 "Pro Legacy"——但 **Pro Legacy 只有 Filter Assist**。 [来源: https://www.todoist.com/help/account-and-billing/plans/todoist-pro-pricing-update-in-2025-bxBvHZuJZ]

**5) 模型与部署（同类里披露得最细的一家，但有内部不一致）**
- **100% 云端，无端上推理。** 官方原文：*"Todoist runs all AI functionality on secure infrastructure to ensure customer data stays protected within our environment."* Ramble 明确**需要联网**（*"Ramble only works with an internet connection."*）——**这一条本身就排除了端上推理**。 [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O] [来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF]
- **官方 subprocessors 页（2026-09-25）**：

| 供应商 | 角色 | 模型 | 保留期（官方原文摘要） |
|---|---|---|---|
| **Amazon Bedrock** | AI provider | **Claude 系（Anthropic）+ Nova 系（Amazon）** | **Not stored** |
| **Gemini Enterprise Agent Platform（原 Vertex AI Studio，Google）** | AI Provider | **Gemini 系（Google）** + Grounding Search/Maps；**Claude 系（Anthropic）** with Web Search | **Ramble 的 session 数据（含音频）由 Google 缓存最长 24 小时**（用于暂停/恢复）；**Google 在需要调查可疑活动时可能记录并保留 prompt 最长 90 天**（官方补充「这不意味着每段录音都被例行存 90 天」）；Automations Search Steps 保留 **30 天** |
| **OpenRouter** | AI 路由服务 | **仅用于 Automations**，路由到下游跑 **DeepSeek V4 Flash 0731** | **账号级强制零数据保留路由；OpenRouter 不存储 prompt 内容** |
| **Google Cloud Platform** | Ramble session 恢复 | — | Session audio data |
| **Grounding Maps / Grounding Search（Google）** | 位置/地图与实时网页 grounding | — | query 文本、地理上下文、上下文元数据 |

 [来源: https://trustcenter.doist.com/subprocessors]
- **OpenRouter 下游的「approved model providers」（全部为 DeepSeek V4 Flash 0731）**：Atlas Cloud、BaseTen、CoreWeave、DeepInfra、Fireworks.ai、**Inceptron AB（瑞典，仅 EU/EEA 处理）**、Novita、Parasail、**Siliconflow（新加坡）**、Together、Venice.ai。 [来源: 同上]
- **Ramble 的具体模型（TechCrunch 引 Doist）**：*"which runs on **Google's Gemini 2.5 Flash Live model via Vertex AI** for real-time speech understanding… The audio isn't stored or used for AI training, and the app is SOC2 Type II certified."* XDA 独立复述同一说法。 [来源: https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/] [来源: https://www.xda-developers.com/todoist-ramble/]
- **官方对「是否直连 OpenAI」的明确否认**：*"We do not send your data directly to OpenAI. All processing flows through Todoist's secure infrastructure."*、*"This includes models from top AI providers available via AWS Bedrock and Google Cloud Vertex AI."*、供应商承诺 *"will not be used to train their AI models"*。 [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O]
- 🔴 **但发现一处可操作的内部不一致**：Task Assist 扩展的 FAQ 里**点名 OpenAI**，并**承认** *"OpenAI may use user input (queries) to improve their models."* 这与当前 subprocessors 清单（只有 Bedrock / Vertex / OpenRouter，**没有 OpenAI**）以及「不用于训练」的承诺**矛盾**。合理解释是该 FAQ 是 2023 年 Task Assist 上线时的旧文案、未随架构迁移更新。**这是「AI 隐私文案会随架构漂移、必须逐页核对」的一个真实样本。** [来源: https://www.todoist.com/help/todoist/todoist-and-ai/use-the-task-assist-extension-with-todoist-ZgldtcPeT]

**7) 一句话定性（来自子调研，值得作为本节标题）**
> **Todoist 的 AI 是「捕获端 AI」，不是「调度端 AI」。** 2024–2026 年它把全部力气压在**把混乱输入变成结构化任务**（Ramble 语音、Task Capture、Email Assist、Filter Assist），并另起独立产品 **Todoist Automations（Beta）**做「用自然语言写工作流」。**它至今没有自动排程器**——排程仍是手动 time-blocking，**Reclaim / Morgen / Trevor 在官方集成目录里替它做自动排程**。
> [来源: https://www.todoist.com/todoist-assist] [来源: https://www.todoist.com/integrations]

**6) 用户口碑**
- 最有价值的称赞：**捕获端的零摩擦**。XDA 实测称它 *"removes friction at the exact moment tasks are born"*，能从一句混乱的话里解析出 3 个任务，且对背景噪音稳健；G2 评价 *"Zero-Friction Entry is exceptional"*。 [来源: https://www.xda-developers.com/todoist-ramble/] [来源: https://www.g2.com/products/todoist/reviews]
- 另一侧：媒体实测标题「Talking to my to-do list felt ridiculous — until Todoist Ramble…」，说明**语音创建任务的接受度需要跨过心理门槛**。 [来源: https://www.xda-developers.com/todoist-ramble/]
- 常见吐槽（按杀伤力）：
  - **付费墙**：G2 2026-08-24 评论 *"Critical tools for basic task management… locked behind the paid Pro tier"*；Product Hunt 的 cons 含 *"expensive premium version"*。 [来源: https://www.g2.com/products/todoist/reviews]
  - 🔴 **「AI 做得不够深」——而 Product Hunt 上票数最高的功能请求，字面上就是「一个自动把我最高优先级任务排进日历的 AI 排程器」**：*"an AI scheduler which automatically schedules your highest priority tasks into your calendar"*。**这条请求同时是「用户确实想要自动排程」与「Todoist 明确不做」的交叉证据。** [来源: https://www.producthunt.com/products/todoist/reviews]
  - **AI 隐私**：Privacy Guides 论坛有专帖《Todoist is sending user's PII to Google》。 [来源: https://discuss.privacyguides.net/t/todoist-is-sending-users-pii-to-google/13654]
  - ⚠️ **Filter Assist 在 2026 年出过一次真实的生产故障**（Todoist 自己的 changelog 记录）。 [来源: https://www.todoist.com/changelog]

**7) Doist 的 AI 隐私立场（官方承诺 vs 官方披露的落差）**
- ✅ **Doist 确实发布了书面承诺**（隐私政策生效日 **2026-08-27**）：*"we do not use information we collect from you, including via artificial intelligence tools, to develop, improve, or train generalized/non-personalized artificial intelligence or machine learning models"*，并另有 *"No peeking, auditing, or training on your data"*。 [来源: https://doist.com/privacy] [来源: https://www.todoist.com/todoist-assist]
- ⚠️ **但同一家公司的 subprocessor 页披露了保留期**：Ramble 音频被 Google 缓存**最长 24 小时**、prompt 在滥用调查下**最长 90 天**、Automations search steps **30 天**；且 Task Assist 的 FAQ 仍写 *"OpenAI may use user input (queries) to improve their models"*，而当前 subprocessor 列表里**没有 OpenAI**。 [来源: https://trustcenter.doist.com/subprocessors]
- 🔴 **对本项目最有价值的一条结论**：**这是「云端 AI 厂商的隐私承诺」与「其自身基础设施披露」之间存在结构性落差」的真实样本。** Todoist 已经是同类里披露最透明的产品之一，仍然只能提供**供应商承诺 + 24 小时音频缓存披露**；而 heyta 的 E2EE 可以让「服务端看不到明文」成为**架构事实**，而不是一份需要跨页核对的承诺。**这是本报告里最直接可用的差异化论点。**

<!-- TODOIST 深挖已完成，详见 research/ai-competitors/todoist.md（544 行） -->

---

### 2.2 Motion（usemotion.com）—— 最激进的一家

**1) AI 功能（官网 pricing 功能清单原文）**
**AI Chat、AI Projects & Tasks、AI Calendar & Meetings、AI Docs, Wiki, & Notes、AI Task Planner、AI Writer & Editor**（共 6 类）。 [来源: https://www.usemotion.com/pricing]

**2) 交互形态**
**自动执行**。Motion 的定位是「agentic work suite」，任务进系统后由 AI 自动决定何时做；用户不需要手动拖时间块。同时提供 AI Chat 作为对话入口。 [来源: https://www.usemotion.com/pricing] [来源: https://www.usemotion.com/blog/motion-raises-60m-to-build-the-agentic-work-suite-for-businesses.html]

**3) 排程类 AI 怎么工作 / 用户控制权**
- 基本机制：根据**截止日期、优先级、预估时长、工作时段、日历忙闲**自动把任务排进日历时间块，并在计划变化时**自动重排**。用户反馈里描述得很清楚：「motion automatically moves the unfinished tasks to the next day if I don't complete them」。 [来源: https://www.reddit.com/r/productivity/comments/1amldmk/motion_app_does_it_work_is_it_good/]
- **用户控制权的真实边界（重要）**：同一条用户反馈指出 ——「what I don't like, is that **if I further move the task myself, the task turns into the 'fixed' one, and this automatic move gets disabled**, I hope they fix it.」即**手动拖动 = 把任务钉死（pin），此后不再自动排**；用户希望这个行为可配置。这正是「自动排程」与「用户自主权」冲突的具体形状。 [来源: https://www.reddit.com/r/productivity/comments/1amldmk/motion_app_does_it_work_is_it_good/]
- 🔴 **「锁」是有超时的**（这条最反直觉，也最有产品含义）：把任务拖到日历 = 变成 fixed、显示 🔒，但官方帮助页写明 —— *"if the task is not completed within **60 minutes** of its scheduled time slot, Motion **may reschedule** it."* 即**用户以为钉住了，系统 60 分钟后仍可能挪走**。 [来源: https://www.usemotion.com/help/project-management/task/task-scheduling-faq.md]
- **排程的输入与拒排边界（官方明文，可直接当测试用例）**：考虑 duration / start date / deadline / priority（含 ASAP）/ effort / chunking / 自定义 schedule；**只有 Busy 事件会排斥排程**。拒排规则：**无 duration 不排**、**无 deadline 且无 priority 不排**、start date 在未来的不提前排、**"Can't Fit" 判定窗口硬编码 31 天（团队 92 天）**；**硬截止会突破用户工作时段**（官方例：9–5 排满后仍排到 18:00）。 [来源: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/what-auto-scheduling-considers.md] [来源: https://www.usemotion.com/help/project-management/task/reference-tasks/task-states-and-task-types]
- **漏做处理**：任务进入 **Past Due** 状态 + 通知 + 重排到下一个可用时段。 [来源: https://www.usemotion.com/help/project-management/task/reference-tasks/task-states-and-task-types]
- Motion 官方帮助中心设有 FAQ 与 troubleshooting 分类（含 "Why AI Chats might fail"）。 [来源: https://help.motionapp.com/en/collections/3789369-faqs-troubleshooting]

**4) 定价（2026-09-25 实测官方页）**
- **Pro AI $19/seat/月**、**Business AI $29/seat/月**，均为**年付**价（页面写 "Pay annually (Save 33%)"，即月付约为年付的 1.5 倍）。 [来源: https://www.usemotion.com/pricing]
- **AI 是额度制，不是无限**：Pro AI 含 **7,500 credits/seat/月**，Business AI 含 **15,000 credits/seat/月**；**超额单价 Pro 25 cents / 100 credits、Business 19 cents / 100 credits**。这是本轮调研里唯一把 AI 用量明码标价到「美分/credit」的产品。 [来源: 同上]
- **有两条定价轨**：上面的 $19/$29 是 **Teams** 轨；**Individuals** 轨更贵 —— **年付 $29 / $39，月付 $49 / $69**（同计划下 Individuals 比 Teams 贵约 50%）。**无免费层，只有 7 天试用。** [来源: https://www.usemotion.com/pricing] [来源: https://www.usagepricing.com/blueprint/motion]
- **价格轨迹是「变贵」，不是「变便宜」**：2021 年起步为 **$19/mo flat**；2025 年秋推出 "AI Employees" 多档 credit grid，引发老用户**「3 倍涨价」抗议**；2026 年收敛回 Pro AI / Business AI 两档，**未新增任何低价档**。 [来源: https://www.reddit.com/r/UseMotion/comments/1p94uxr/beware_motion_is_charging_existing_customers_3x/]
- 营销声明：官网写 "Finish 137% more work."（**无出处，属营销话术**）。 [来源: https://www.usemotion.com/pricing]

**5) 模型与部署**
Motion 的 **Subprocessors 页**列出的**唯一 AI 平台供应商是 OpenAI（美国）**；**具体模型版本未披露**（帮助中心只写 "large language models" / "grounding-enabled models"）。**纯云端**。 [来源: https://www.usemotion.com/legal/subprocessors]

**6) 用户口碑**
- 最有价值的称赞：**「不完成就自动挪到明天」这件事本身是价值来源**（见上面原句），以及自动排程让「一天被安排好了」的人获得执行力。
- 最常见吐槽：**控制权**（手动改一次就不再自动排）、**价格**（同档最高，Individuals 年付 $29/月 起）、以及「AI 排的时间不现实」类抱怨。
- 🔴 **最准确的概括是：用户抱怨的不是「AI 不准」，而是「AI 动了我不想动的东西」。** Motion 官方文档自己承认任务会 *"shift multiple times"*，并把解决办法交给用户自己 lock——**这是把冲突转移给用户，而不是解决它**。 [来源: https://www.usemotion.com/help/project-management/task/task-scheduling-faq.md]
- 第三方评分：**Trustpilot 3.7（约 578 条）**（Trustpilot 直取被 403 拦截，评分来自检索元数据与第三方转引，**未经页面正文复核**）。 [来源: https://www.trustpilot.com/review/usemotion.com]
- 融资侧反向证据：Motion 在 2025-09 宣布累计融资 **$60M**（Series B+C+C2）、累计 **$75M**、**估值 $550M**，口径是「为 SMB 打造 agentic work suite」。 [来源: https://www.usemotion.com/blog/motion-raises-60m-to-build-the-agentic-work-suite-for-businesses.html] [来源: https://www.businesswire.com/news/home/20250905188051/en/Motion-Raises-%2460M-at-%24550M-Valuation-to-Build-the-Agentic-Work-Suite-for-Businesses]

<!-- MOTION 深挖已完成，详见 research/ai-competitors/motion-reclaim.md（1179 行） -->

---

### 2.3 Reclaim.ai —— 已被 Dropbox 收购

**1) AI 功能（官网功能清单原文，11 项全部以 AI 命名）**
**AI Focus Time、AI Scheduling Links、AI Buffer Time、AI Habits、AI Smart Meetings、AI Time Tracking、AI Tasks、AI Calendar Sync、AI Planner、AI Assistant**，另有 Team OOO Calendar、Workforce Analytics。 [来源: https://reclaim.ai/pricing]
- **AI Assistant** 的官方描述：*"Chat with your AI Assistant to plan, prioritize, and optimize your schedule."* [来源: 同上]
- **AI Habits**：*"Find the best times for your recurring routines."*；**AI Buffer Time**：*"Auto-schedule breaks & travel across your meetings & work sessions."* [来源: 同上]

**2) 交互形态**
**自动执行 + 对话助手**：默认由 AI 自动排/自动改，同时提供 AI Assistant 对话层。品牌已变为 **"Reclaim.ai from Dropbox"**（官网 logo 原文）。 [来源: https://reclaim.ai/pricing]

**3) 排程类 AI / 用户控制权**
- 机制：把习惯、任务、buffer、focus time 作为「smart event」抢占日历，从所有已连接的日历中**自动防守时间**，日程冲突时自动改期。 [来源: https://reclaim.ai/pricing]
- **用户控制权有明确机制：locks（锁）**。官方帮助中心原文：*"Reclaim enables you to prevent events from automatically rescheduling or changing, even when overbooked."*（页面更新于 2026-08-05） [来源: https://help.reclaim.ai/en/articles/6473767-how-to-stop-reclaim-events-from-moving-using-locks]
- 这是「自动排程」这一品类里**最成熟的控制权设计样本**：默认自动、但可按事件加锁；同时保留手动改。

**4) 定价（2026-09-25 实测）**
- **Lite = Free forever**（含 **1 个 Calendar Sync、1 周排程范围、1 个 Scheduling Link、5 个 AI Agents**）；**Starter $10**、**Business $15**、**Enterprise $22**（均为**年付 per seat/月**）；月付 **$12 / $18**，**Enterprise 不支持月付**。 [来源: https://reclaim.ai/pricing]
- ⚠️ **官方定价页自我矛盾**（可当「单源事实」的反面教材）：切换 tab 写 "SAVE 20%"，实际年付/月付差值约 **16.7%**，FAQ 却写 **29%** —— **三个数字并存**。 [来源: https://reclaim.ai/pricing]
- 历史锚点：被收购前（2024-08）TechCrunch 报道其有个人免费档、付费 **$8/person/月**。 [来源: https://techcrunch.com/2024/08/22/dropbox-acquires-index-ventures-backed-ai-scheduling-tool-reclaim-ai/]

**4b) Reclaim 2.0（2026）——把 1.0 重包装成 "AI Agents"，并补上「先预览再落地」**
- 1.0 的 Focus Time / Habits / Buffers / Smart Meetings 在 2.0 里被重新包装为 **AI Agents**，新增 **AI Assistant** 聊天与 **Preview Mode**（日历沙盒：**先看会动什么，确认后才落地**）。 [来源: https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview]
- **状态是过渡态**：帮助中心 1.0 / 2.0 文档并存，2.0 仍**需申请早期访问**。 [来源: 同上]
- **排程输入**：P1–P4 priority / duration / frequency / Scheduling Hours / Starting / Due date。同优先级排序链为 **Smart Meetings → Habits → Tasks**，同优先级 Task 按最早 due date；**允许高优先级 overbook 低优先级**。 [来源: https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically]
- **漏做处理**：默认「到点自动烧完并标记完成」，可切手动模式（事件结束仍未 Start → 自动重排到当天更晚）；另有 done-scheduling 三选一（Nothing / 自动重开放回全部原时长 / 自动标记完成）+ 等待天数。 [来源: https://help.reclaim.ai/en/articles/6937489-auto-rescheduling-settings-for-tasks-and-habits]

**4c) 🔴 两种截然不同的「锁」语义（对 heyta 的 op 设计最直接有用）**
- **Reclaim 的锁是三态，不是布尔**：**拖拽移动 = 永久锁定**（不再重排）；**Reschedule / Snooze = 不锁定**；**在原生日历里删除 = 不锁定**。三种「我现在不想做它」映射到三种持久化语义。 [来源: https://help.reclaim.ai/en/articles/12304458-carve-out-time-for-work-with-tasks]
- **Motion 的锁是布尔且带 60 分钟超时**（见 §2.2）。
- **对本项目的直接含义**：如果 heyta 未来做排程，锁不能设计成 `locked: boolean`。子调研给出的建议字段形状是 `schedulingLock: 'none' | 'untilStart' | 'permanent'`——**因为「我把它挪到明天」和「我永远不要你碰它」是两种不同的用户意图，落成同一个布尔值就必然丢语义。**

**5) 模型与部署（双轨制，值得单独记一笔）**
- **核心排程 = 自有私有托管的 LLM + 经典 ML，跑在 Dropbox 环境内**；**Chat / MCP = 第三方模型，需用户显式 opt-in + Zero Data Retention**。 [来源: https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure]
- Slack Marketplace 上 Reclaim 自己填的披露**点名 OpenAI `chatgpt-5.5` / `chatgpt-5.4-mini`**，托管于 **AWS us-east-2**。 [来源: https://slack.com/marketplace/ARSJUP4R0-reclaimai]
- **「核心能力自托管 + 可选的第三方能力显式 opt-in」是本轮看到的、加密/隐私敏感产品最可复制的一种分工。** 全部云端，端侧未找到公开信息。

**6) 收购与口碑**
- **2024-08-20 前后被 Dropbox 收购**。官方博客原文承诺 *"no planned changes to pricing or customer support anytime soon"*。 [来源: https://reclaim.ai/blog/dropbox-acquires-reclaim]
- TechCrunch（2024-08-22）：Dropbox **未披露交易条款**。 [来源: https://techcrunch.com/2024/08/22/dropbox-acquires-index-ventures-backed-ai-scheduling-tool-reclaim-ai/]
- Hacker News 上的反应代表了一类怀疑：把 Dropbox 的收购史（如 HelloSign「basically a stagnant has-been」）与安全事件联系起来。 [来源: https://news.ycombinator.com/item?id=41302030]
- 用户侧最常被引用的摩擦：**企业 IT 审批**（「reclaim.ai needs to be approved by the Office 365 admin on the client side」）。 [来源: https://www.reddit.com/r/reclaim_ai/]
- **评分分裂得最厉害的一家**：**G2 4.8（143 条）vs Trustpilot 2.2（23 条）**——同产品、两个平台、两个世界。 [来源: https://www.g2.com/products/reclaim-ai/reviews] [来源: https://www.trustpilot.com/review/reclaim.ai]（Trustpilot/G2 直取被 403/登录墙拦截，评分来自检索元数据与第三方转引，**未经页面正文复核**）
- 首要差评原话（Trustpilot）：「I put the time of my meeting because I need it to happen at an exact time — and it **automatically reschedules it**… useless duplicate work」。**再次印证：痛点是「它动了我不让它动的东西」，不是「它排得不准」。** [来源: https://www.trustpilot.com/review/reclaim.ai]
- 另一个共识式抱怨：**Reclaim 没有原生移动端**。 [来源: https://help.reclaim.ai/]
- 第三方综合分：Motion 6/10、Reclaim 3.7/5（同一评测体系内可比）。 [来源: https://efficient.app/apps/motion]

<!-- RECLAIM 深挖已完成，详见 research/ai-competitors/motion-reclaim.md（1179 行） -->

---

### 2.4 Akiflow —— 「AI 只在你要它动的时候才动」

**1) AI 功能（确切功能名）**
- **Aki**：AI 执行助理。官方口径是 *"Aki acts only when you ask it to… nothing happens without your request."* [来源: https://product.akiflow.com/en/help/articles/6292194-switching-from-motion-to-akiflow]
- **Aki 的接入渠道**：可从聊天/消息等入口调用它建任务、改任务（细节见子文档 `research/ai-competitors/akiflow-sunsama.md`）。
- **Meeting Assistant**（AI 会议助理）：**单独收费的加购**，见下文定价。
- **Schedule Optimizer**：包含一个用户点击的 **"Optimize schedule"** 整体重排，以及单任务的 **ASAP**。**shipped 2026-06-25（v2.76）**。
- **MCP Connector**：让用户自己的 AI 客户端连 Akiflow（含在订阅内）。
- **Daily Dashboard**：AI 生成的每日简报。
[来源: https://akiflow.com/pricing] [来源: https://product.akiflow.com/en/help/articles/3161671-schedule-optimizer]

**2) 交互形态**
**「用户显式请求 → AI 执行」**。这是 Akiflow 与 Motion/Reclaim 的根本差别：它有能力重排，但把「是否重排」交回用户。

**3) 排程类 AI 怎么工作 / 用户控制权（关键）**
Akiflow 官方文档**主动写死了 Schedule Optimizer 的能力边界**，明确列出它**不做**的事：*"Run automatically without you choosing it"*、一次规划多个/全部任务、跨天移动、拆分任务、按优先级重排、移动端支持。 [来源: https://product.akiflow.com/en/help/articles/3161671-schedule-optimizer]
- 用户控制权：重排由**用户点击**触发；忽略按钮则保留手动修改；提供 toast 上的 **Undo**。
- 营销口径与文档口径有落差：Akiflow 在对比页里把自己包装成「有 AI Scheduler」，但帮助文档划的边界要窄得多。 [来源: https://akiflow.com/pricing] [来源: https://product.akiflow.com/en/help/articles/3161671-schedule-optimizer]

**4) 定价（2026-09-25 实测）**
- **$34/月（月付）或 $19/月（年付，$228/年）**；**无免费档**；试用 **7 天且需绑卡**。 [来源: https://akiflow.com/pricing]
- **Believer（长期买断）**：**$357.60 / 2 年**（≈$14.90/月）或 **$699 / 5 年**。学生年付 40% off（终身有效）。 [来源: https://akiflow.com/pricing]
- **AI 收费不对称（本轮最值得注意的定价事实）**：**Aki 与 MCP Connector 含在 Pro 内，但 Meeting Assistant 是 +$19/月 的加购**。 [来源: https://akiflow.com/pricing]

**5) 模型与部署（同类里披露最彻底）**
Akiflow **公开列出完整的 AI 子处理器名单**：**Anthropic、OpenAI、Google、Groq**（文本分析与推理）、**ElevenLabs**（TTS/语音）、**GetStream**（聊天）、**Recall.ai / Hyperdoc**（会议录制）、**Vellum**（编排）。**多云厂商、全部云端、无端侧**。 [来源: https://akiflow.com/sub-processors-for-ai/]
这对本项目的价值：**「多供应商 + 公开名单」是可复制的信任做法**，不需要自研模型即可回答「我的数据给了谁」。

**6) 用户口碑**
- 第三方评分：**G2 4.8 / Capterra 4.7 / Trustpilot 4.4 / Google Play 3.7**（Play 明显更低）。 [来源: https://www.trustpilot.com/review/akiflow.com]
- 最有价值的称赞：**统一 inbox + 键盘操作速度 + 真人客服**。
- 最常见的抱怨排序（注意与 AI 无关）：**① 计费与取消**（试用后意外扣费、取消困难，有 $500+ 个案与 "predatory business" 讨论）；**② 价格**（$34/月 无免费档）；**③ AI 可靠性**（如 *"The AI is garbage, it can't even tell you when a specific event is"*）；**④ 移动端不可靠**；**⑤ 无任务导出**。 [来源: https://www.reddit.com/r/ProductivityApps/comments/1md184r/my_unfiltered_review_of_akiflow/] [来源: https://www.trustpilot.com/review/akiflow.com]

---

### 2.5 Sunsama —— 公开反「全自动 AI 排程」，但自己一直在做排程

**1) AI 功能（确切功能名）**
- **AI planned time + channel recommendations**：新建任务时**自动打 channel 标签**并**预估时长**，依据是你过去在 Sunsama 里做过的同类工作。官网原文：*"When you create a task, Sunsama automatically tags it in the proper channels and assigns it a time estimate based on previous work you've done in Sunsama."* [来源: https://www.sunsama.com/features/ai]
- **Sunny the AI Assistant**：对话式助手，可建/管任务、规划一天、整理 backlog。 [来源: https://help.sunsama.com/docs/usage-guides/sunny/]
- **AI-Assisted Daily Highlights**：每日重点的 AI 辅助生成。 [来源: https://help.sunsama.com/docs/usage-guides/sunny/]
- **MCP server**：官方定价页把 **"AI + MCP + Zapier"** 直接列为 Pro 档包含项。 [来源: https://www.sunsama.com/pricing]
- **Autoplan（beta）**：**2026-09-23 上线**——用户自定义规则，可创建/暂停/删除，有「运行回顾页」和 undo。 [来源: https://roadmap.sunsama.com/changelog]

**2) 交互形态**
**必须由用户显式动作触发**。官方对比页原文：*"Sunsama only auto-adjusts tasks when you take explicit actions in the app."* [来源: https://www.sunsama.com/compare]

**3) 排程类 AI 怎么工作 / 用户控制权**
- **先纠正一个常见误解：Sunsama 一直在做自动排程**，不是「只做手动」。自 **Timeboxing 2.0** 起，按 **`X`** 即触发自动时间块（社区称之为 "calendar Tetris"）；**`Shift+X`** 控制是否拆分任务；自动排序**把手动拖动视为 pin（钉子）**不被覆盖；并可**全局关闭**。 [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/]
- 提供 **Schedule anyway / another day / Defer** 三种处理过载的选择。
- **2025 年的公开立场（反 AI 炒作，但不反 AI）**——创始人 Ashutosh Priyadarshy 原文：*"the word 'AI' isn't even on our homepage!"*；*"Our biggest competitor spends millions blasting ads about their fully-automated AI scheduler that just tells you what to do"*；*"We could not convince ourselves that an exclusively AI solution could do a good enough job."* [来源: https://www.sunsama.com/blog/when-less-is-more-building-thoughtful-products-in-the-age-of-ai]
- **2026-09-23 的 Autoplan 与上述立场存在张力**：产品经理侧看是「补上自动化」，从传播侧看是「向自己批评过的方向移动」。这本身是本次调研里最有信息量的一条行业动态。 [来源: https://roadmap.sunsama.com/changelog]

**4) 定价（2026-09-25 实测）**
- **$22/月（月付）或 $17/月（年付，$204/年）**；**14 天试用、无需信用卡**；**无免费档**。 [来源: https://www.sunsama.com/pricing]
- Enterprise：SSO & SAML、SCIM + Audit Logs、自定义隐私与数据要求。 [来源: https://www.sunsama.com/pricing]
- **AI 无加购**：AI + MCP + Zapier 全含在唯一一个 Pro 档里——与 Akiflow 的「Meeting Assistant 另收 $19/月」形成鲜明对比。 [来源: https://www.sunsama.com/pricing]
- 定价页 FAQ 与主价格存在不一致（FAQ 提「$25/月，年付 $20/月」），以页面主价格为准并保留差异。 [来源: https://www.sunsama.com/pricing]

**5) 模型与部署**
官方一手表述有内部张力，需并列呈现：隐私说明写 *"an open-source AI model hosted securely in our cloud environment"*（用于估时/摘要），另一处写 *"third-party LLMs and inference providers"*。**具体供应商 = 未找到公开信息**（纽约时报 Wirecutter 提到 OpenAI + Anthropic，但正文付费墙未取到，**不采信**）。**全部云端**。 [来源: https://help.sunsama.com/docs/security/privacy-notes/] [来源: https://www.sunsama.com/privacy]

**6) 用户口碑**
- 第三方评分：**Capterra 4.7 / SoftwareAdvice 4.7 / Trustpilot 4.0（仅 4 条）**。 [来源: https://checkthat.ai/brands/sunsama/reviews]
- 最有价值的称赞：**强制的每日规划仪式本身**——「让我第一次真的想清楚今天做什么」，以及工作量现实感（over-commit 警告）。 [来源: https://www.asianefficiency.com/schedule-management/sunsama-review/]
- 最常见的抱怨：**① 价格**（「not worth $200/year」、无免费档）；**② 需要自律**（仪式不做就没价值）；**③ AI 被认为「保守/单薄」**（第三方甚至写「no meaningful AI features」——这是**认知落后于事实**，因为 Sunsama 的 AI 项其实不少）；**④ AI 可靠性**：官方 changelog 自己承认语音模式 *"flakier than chat"*，并修过 Sunny 对真问题只回 "Got it" 的 bug。 [来源: https://checkthat.ai/brands/sunsama/reviews] [来源: https://roadmap.sunsama.com/changelog] [来源: https://www.reddit.com/r/productivity/comments/x6357l/sunsama_price_worth_it/]

---

### 2.6 Superlist —— AI 从「语音」到「会议纪要」，但没有 note-to-task 这个功能名

**1) AI 功能（确切功能名）**
- **Meeting Notes**（AI 会议笔记与摘要）：shipped **1.31.0 / 2025-05-08**；移动端 **1.56.0 / 2026-06-27**。 [来源: https://www.superlist.com/pricing] [来源: https://help.superlist.com/en/articles/310871-ai-meeting-notes-in-superlist-summaries-and-next-actions-automatically]
- **AI Chat with Meeting Notes**：与会议笔记对话。 [来源: https://www.superlist.com/pricing]
- **Talk**（AI 语音输入，把语音转成任务/列表）。 [来源: https://www.superlist.com/pricing]
- **Make AI**：在列表与任务详情里生成内容。 [来源: https://www.superlist.com/pricing]
- **Superlist MCP**：shipped **1.54.0 / 2026-05-05**。 [来源: https://www.superlist.com/pricing]
- ⚠️ **纠正任务描述里的一处假设**：Superlist **没有**一个官方叫 "AI note-to-task extraction" 的功能。最接近的官方措辞是 **"transcript-based task extraction"**（出现在 1.37.0 的定价说明里）。 [来源: https://www.superlist.com/updates/ai-meeting-notes]

**2) 交互形态**
建议 + 生成 + 语音；**没有自主执行**。AI 从会议逐字稿里抽任务仍属「生成候选，用户确认」。 [来源: https://help.superlist.com/en/articles/310871-ai-meeting-notes-in-superlist-summaries-and-next-actions-automatically]

**3) 自动排程**
**未找到公开信息**。AI 只抽取**截止日期**，没有把任务放进时间轴的能力。 [来源: https://www.superlist.com/pricing]

**4) 定价（2026-09-25 实测，两处口径必须并列）**
- **Free $0**：最多 5 私有 + 5 共享列表、无限任务与笔记、25MB/文件、500MB 存储。**不含任何 AI。** [来源: https://help.superlist.com/en/articles/310866-superlist-pricing-free-basic-and-super-plans-compared]
- **Basic $6/月 或 $59/年**：含全部集成 + **Talk AI 语音输入**（**不含会议笔记**）。 [来源: 同上]
- **Super $25/月 或 $249/年**：**无限 AI 会议笔记与摘要**、**无限 AI chat**、Make AI、邮件/Slack 摘要转任务。 [来源: 同上]
- 定价页显示 **$5 / $21**，是因为渲染的是**年付折算月价**（"That's $59 yearly" / "$249 yearly"）。**不是两个不同价格。** [来源: https://www.superlist.com/pricing]
- **Legacy Pro $15/月 或 $149/年**：已停售，老用户保留；含 AI 邮件摘要、Talk、Make AI、**AI 会议笔记（30 场会议或 15 小时/月）**、**AI chat（15 条/天）**。 [来源: https://help.superlist.com/en/articles/310866-superlist-pricing-free-basic-and-super-plans-compared]
- ⚠️ **官网 `/ai-task-management` 营销页仍是旧文案**（写 "Upgrade to Pro for $5/month to unlock AI meeting notes"，并称免费版 "basic AI features included"），与定价页/帮助中心矛盾。 [来源: https://www.superlist.com/ai-task-management]

**5) 模型与部署**
**未找到公开信息**。定价页、功能页、changelog、帮助中心均**未点名**任何 LLM 或转写供应商。隐私政策只写 *"the connector transmits to the AI provider the data needed to fulfil your request"*，**不点名 provider**，并称 *"Data sent to an AI provider through a connector is processed under that provider's own terms and privacy policy."* 唯一被点名的第三方是 Google（Play/SSO/Firebase，属分发认证，**非 AI**）。 [来源: https://www.superlist.com/privacy-policy]
- 可确认的隐私表述（帮助中心原文）：*"We never store audio files or transcripts without your consent. Your data is not shared or used for training purposes."* **没有端侧推理声明。** [来源: https://help.superlist.com/en/articles/227395-privacy]

**6) 用户口碑**
- 称赞：**任务与笔记的融合 + 设计**（App Store 评价 *"The seamless fusion of notes and task is its greatest strength."*）、**免费层慷慨**、**迭代快**。 [来源: https://www.superlist.com/pricing]
- 抱怨：**① 涨价并捆绑「没人要的 AI」**——r/superlist 原帖摘要 *"basically, like every company these days, AI features that no one asked for"*；**② 免费层收紧**；**③ AI 能力被评「Limited AI」**；**④ UX 漂亮但拖慢工作流**；**⑤ buggy / 协作不可靠**（第三方对比评测）。 [来源: https://www.reddit.com/r/superlist/comments/1khy5m0/new_improvements_and_subscription_prices/] [来源: https://www.reddit.com/r/superlist/comments/1mf6dr9/superlist_might_have_given_their_free_users_the/] [来源: https://www.reddit.com/r/todoist/comments/1i8y79q/anyone_thinking_of_moving_to_superlist/] [来源: https://efficient.app/compare/superlist-vs-todoist]

> 「AI features that no one asked for」这条吐槽，与 Todoist「not AI guessing on your behalf」、Sunsama「the word AI isn't even on our homepage」构成同一年的三种同向信号。

---

### 2.7 Notion —— AI 从加购变为档位，Custom Agents 走 credit 计费；Notion Mail 已关停

**1) AI 功能（确切功能名）**
- **Notion Agent**：官网原文 *"Does work for you. Completes complex, multi-step tasks using context from Notion, your connected apps, and the web."* [来源: https://www.notion.com/pricing]
- **Custom Agents**：*"Set a trigger or schedule, and the agent handles it from there—24/7, whether you're online or not."* **按 credit 计费**。 [来源: https://www.notion.com/pricing]
- **AI Meeting Notes**：*"Automate your meeting notes and follow-ups, no bot needed"*；若用 Notion Calendar 可**自动给每个会议加会议笔记**。 [来源: https://www.notion.com/pricing] [来源: https://www.notion.com/releases/2025-05-13]
- **Enterprise Search（Beta）**：跨 Slack、GitHub 等连接应用检索。 [来源: https://www.notion.com/pricing]
- **Research mode（Beta）**。 [来源: https://www.notion.com/pricing]
- **Notion Mail 的 AI 功能（已 discontinued）**：曾含 **Auto-label**（AI 自动给来信打标签）、**AI drafts**（AI 写回信）、custom views、one-click snippets、built-in scheduling。**Notion Mail 宣布关停 2026-06-25、实际关停 2026-09-22**——距今 3 天。官方理由原文：*"more than half of Notion Mail users manage emails without ever opening their inbox. So, we're going all in on using agents to run your inbox."* 关停后 drafts / scheduled emails / snippets / auto-label 规则需自行导出。 [来源: https://techcrunch.com/2026/06/25/notion-mail-shuts-down-amid-agent-takeover/] [来源: https://www.notion.com/blog/introducing-notion-mail] [来源: https://www.notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next]

**2) 交互形态**
**对话助手 + 自主执行 Agent**（Business 档起）。Custom Agents 可定时/触发运行且无人值守——是本次调研里除 Motion/Reclaim 外**最接近「自主」**的产品线。 [来源: https://www.notion.com/pricing]

**3) 自动排程**
**没有。** Notion Calendar **只是把已带日期的数据库条目渲染成日历事件**：官方原文 *"Notion Calendar automatically populates your calendar with dated events in databases you've connected."* 它的 "scheduling" 是**共享空闲时间让人约你**，**不是把任务自动排进时间块**。而且 *"importing Google Calendar events directly into a Notion database is not yet possible."* [来源: https://www.notion.com/help/guides/getting-started-with-notion-calendar] [来源: https://www.notion.com/product/calendar] [来源: https://www.notion.com/blog/introducing-notion-mail]

**4) 定价（2026-09-25 实测）**
- **Free $0 / Plus $10 / Business $20 / Enterprise 定制**（per member/month，**均为年付价**；页面注明 "Save up to 20% with yearly"，月付价格官方页未给，二手来源为 $12 / $24）。 [来源: https://www.notion.com/pricing] [来源: https://www.eesel.ai/blog/notion-pricing]
- **AI 已不是加购**：Free 与 Plus 只有 **"Trial of Notion AI"（Limited Trial）**，正式 AI 能力在 **Business $20** 起。历史上的 **$8–10/user/月 独立 AI 加购已于 2025-05-13 取消**，改为并入 Business/Enterprise。 [来源: https://www.notion.com/pricing] [来源: https://www.notion.com/releases/2025-05-13]
- **credit 计费**：**Custom Agents = "Free to try, then $10 per 1,000 monthly Notion credits"**；**免费至 2026-05-03，2026-05-04 起计量**；**credit 用尽后 agent 自动暂停**。Workers（Beta）同样 requires Notion credits。 [来源: https://www.notion.com/pricing] [来源: https://www.notion.com/product/ai]
- Free/Plus 试用额度的具体数字：**未找到公开信息**。

**5) 模型与部署（同类里最透明的一家）**
- 官方点名供应商原文：*"various LLMs hosted by Notion as well as by organizations such as **Anthropic and OpenAI**"*；embedding 走 *"OpenAI zero-retention embeddings API"*，向量存 **Turbopuffer**；Enterprise Search 同时提供 *"OpenAI's GPT, Anthropic's Claude, and Google's Gemini"*。 [来源: https://www.notion.com/help/notion-ai-security-practices] [来源: https://www.notion.com/help/enterprise-search]
- **官方「模型无关」原话**：*"Switch any workflow to a different model or provider, without losing any context."* [来源: https://www.notion.com/product/ai]
- Notion 公开**模型评测板**（labs.notion.com/knowledge-board），列 16 个模型与 **$/task 成本**（如 Opus 5 $0.87/task、Kimi K3 $0.45、Sonnet 5 $0.34、GLM-5.2 $0.17、GPT-5.6-Luna $0.02）；并说明 *"Models that did not pass our Zero Data Retention requirements… were excluded"*，且*刻意不做排行榜*（*"we've deliberately avoided creating a leaderboard"*）。 [来源: https://labs.notion.com/knowledge-board]
- **全部云端，无端侧**：处理链路为「请求 → LLM → 向量库（Turbopuffer）→ LLM」，传输 *"encrypted in-transit using TLS 1.2 or greater"*。客户端只采集 system audio 用于转写，**不是端侧推理**。 [来源: https://www.notion.com/help/notion-ai-security-practices] [来源: https://www.notion.com/help/ai-meeting-notes]

**6) 用户口碑**
- 常见的「bolt-on」批评：*"Notion is Turning Into a Bloated MESS… overrun with AI"*；*"its May 2025 AI paywall locks meaningful AI behind the Business tier"*；*"It sucks. It's using subpar models"*。 [来源: https://medium.com/@michaelswengel/notion-is-turning-into-a-bloated-mess-2240d0e4be1f] [来源: https://www.taskade.com/blog/notion-review] [来源: https://www.reddit.com/r/Notion/comments/1g7gx3h/lets_be_honest_about_notion_ai/]
- 质量 vs 成本：*"AI is now $24… it makes a ton of mistakes and has even deleted important stuff for me"*；另有「150% price increase」与 **Custom Agents credit 计费反弹**（*"~$30/mo for a simple daily agent"*）。 [来源: https://www.reddit.com/r/Notion/comments/1qfysfi/ai_is_now_24/] [来源: https://www.reddit.com/r/Notion/comments/1wnd3w5/150_price_increase/] [来源: https://www.reddit.com/r/Notion/comments/1rdd3av/petition_the_new_pricing_of_notion_custom_agents/]

**7) Notion 的 AI 隐私立场（官方，值得对照）**
- **默认不训练**：*"By default, Notion and its AI Subprocessors do not use Customer Data to train any models"*，并有合同层面的禁止。 [来源: https://www.notion.com/help/notion-ai-security-practices]
- **保留期**：Enterprise **零保留**；非 Enterprise 默认 **≤30 天**；**保留数据的 LLM 默认关闭**（需管理员显式开启）；embedding 在页面/工作区删除后 **60 天内**删除。 [来源: 同上]
- 权限继承、账号隔离、TLS 1.2+；SOC 2 Type 2 + ISO 27001；Enterprise 支持 HIPAA。 [来源: 同上]

---

### 2.8 飞书任务 / 飞书妙记 —— 待办提取是真的，但按「点数」烧钱

> 一手取证说明：`feishu.cn` 的营销页（`/service`、`/price-list`、`/service/ai`）与部分帮助中心文章是 JS 单页应用，`web_fetch` 与 `curl` 只取到标题。凡此类页面，数字来自检索结果对**该官方 URL 的摘要**，已注明。

**1) AI 功能（产品自己的命名）**
- **妙记「智能纪要」**：在妙记详情页右侧生成**会议总结、待办事项、章节纪要**（帮助中心文档更新于 2026-07-15）。 [来源: https://www.feishu.cn/hc/zh-CN/articles/244959839578]
- **妙记「智能识别待办任务」**：产品页官方卖点。 [来源: https://www.feishu.cn/product/minutes]
- **待办 → 创建任务**：在妙记里选中待办语句 → 点右侧「创建任务」→ 填负责人与截止时间 → 同步到负责人的飞书任务并可设提醒。 [来源: https://www.feishu.cn/content/article/7600354931119311830]
- **任务智能体（Task Agent）**：开放平台更新日志原文 ——「任务成员可以是 AI 智能体……Agent 能从妙记或对话识别待办事项，**自动建任务**」。通过任务 OpenAPI 暴露（注册/注销任务智能体、写入智能体任务记录）。 [来源: https://open.feishu.cn/changelog?lang=zh-CN] [来源: https://open.feishu.cn/document/task-v2/overview]
- **智能伙伴 → Aily → 豆包工作伙伴（改名链）**：**2026-08-14 起「飞书 aily」正式更名「豆包工作伙伴」**；**2026-09-15 飞书 8.0 发布**，官方称「为适配 Agent 系统性重构」，并发布「国内首个团队智能体产品」。 [来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55] [来源: https://finance.sina.com.cn/jjxw/2026-09-15/doc-inirxatw3732607.shtml]
- **「主动工作」**：2026-09-01 起正式计费；「仅在产生推送的法定工作日次日 0:00 扣费 20 点；若当天没有产生有效推送卡片，则不扣费」。 [来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]

**2) 交互形态**
**两段式**：妙记是「自动提取 + 人工确认」（必须选中待办 → 点创建任务 → 填负责人/截止时间）；任务智能体是**自动执行**（Agent 直接建任务）。二者在同一个产品里并存，这是飞书与英文同类最大的形态差异。 [来源: https://www.feishu.cn/content/article/7600354931119311830] [来源: https://open.feishu.cn/changelog?lang=zh-CN]

**3) 自动排程**
**没有。** 飞书只自动化「捕获 → 创建」（提取待办 → 生成带负责人与截止时间的任务）；最接近排程的是 **Agent 定时触发**（按 cron 唤起 agent），不是时间块排期。 [来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]

**4) 定价（精确数字）**
- 套件版本：**商业标准版 ¥50 / 商业专业版 ¥80 / 商业旗舰版 ¥120**（官网按**人/月**计价）。 [来源: https://www.feishu.cn/service]（页面摘要）
- **AI 版本是独立购买**（不是套件版本附带）：**AI 基础版 / 企业版 / 企业版 Plus / 旗舰版 = 18 万 / 200 万 / 600 万 / 2000 万「点」/年**。 [来源: https://www.feishu.cn/hc/zh-CN/articles/629644238181]
- 个人侧：**飞书 AI 会员 ¥69/月 = 1000 点**；官方说明「用户如需更多个人额度可购买豆包订阅，额度可同时用于豆包和飞书 AI 个人功能的消耗」。 [来源: https://www.feishu.cn/hc/zh-CN/articles/598372079100] [来源: https://aily.feishu.cn/hc1u7kleqg/1cnvbb55]
- **妙记免费额度 = 300 分钟/人/月**（自 2024-12-03 起）；**智能纪要 = 0.5 点/分钟（上传转写）或 20 点/篇**。 [来源: https://www.feishu.cn/new-announcement/pricing-adjustment2024] [来源: https://www.feishu.cn/hc/zh-CN/articles/808156011479]
- **飞书任务 / 妙记 MCP 工具：0 点/次**（工具费用表原文「飞书任务 | 工具费用 | 飞书 MCP 工具 | 0 | 次」）。 [来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]
- Agent 免费层：20 对话/人 + 400 点/租户/月。 [来源: 同上]

**5) 模型与部署**
- **豆包大模型（字节自研；「云雀」是旧名）**。官方算法备案原文：「算法名称：豆包大模型算法……应用于……飞书」。 [来源: https://www.feishu.cn/privacy/ai]
- Agent 另可选 **Kimi、GLM、DeepSeek、MiniMax** 等第三方模型。**全部云端，无端侧，也不支持本地/海外模型自托管**。 [来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]

**6) 用户口碑**
- 最有价值的称赞：有实测者认为妙记抽取的待办**比自己手动记的还全**（「待办事项居然比我手动记的还全」），并赞赏能在逐字稿里 @ 指派任务。 [来源: https://juejin.cn/post/7618764794955579455]
- 最常见的抱怨（**按杀伤力排序**）：
  - **点数消耗不透明**——有用户查到**单次 Agent 任务消耗 949.12 点**，约等于一个月的额度；原话「真正让我困惑的不是贵，而是**不透明**」。 [来源: https://post.smzdm.com/p/a82lp477/]
  - **后台自动扣点且关不掉**（「每天自动扣 20 点，不用还不能关闭」）。 [来源: 同上]
  - **多个会员额度不互通**（多维表格专业版 / AI 个人会员 / aily / 妙记各有额度体系）。 [来源: 同上]
  - **纪要生成慢**（「1 小时会议要等 5-8 分钟」）、**不支持分类逻辑**（会后要二次加工）。 [来源: https://juejin.cn/post/7618764794955579455]
  - **识别与说话人分离错误多**。 [来源: https://v2ex.com/t/903915]
  - **生态绑定**：脱离飞书生态后适配其他会议平台不佳。 [来源: https://www.csdn.net/article/2026-09-25/166645429]

---

### 2.9 Apple 提醒事项 + Apple Intelligence —— 端侧 AI 做得最实，任务侧动作最轻

**1) AI 功能（确切功能名）与版本归属**
- **iOS 18（2024-10 起，shipped）**：Writing Tools、Notification Summaries、Mail/Messages 摘要、Reduce Interruptions、Clean Up、Image Playground、Genmoji、ChatGPT 集成（2024-12）。**提醒事项在 iOS 18 本身没有 AI 专属功能。** [来源: https://forums.macrumors.com/threads/here-are-all-of-the-apple-intelligence-features-in-ios-18-1.2439580/] [来源: https://9to5mac.com/reminders-in-ios-18-all-the-new-features-coming-this-fall/]
- **iOS 26（2025-09，shipped）——提醒事项的第一个 AI 版本**：
  - **Siri Suggestions**：从 Mail、Messages、Notes、购物清单等来源**建议**你可能想加的待办；在 Mail 等 App 内也会出现建议，点一下即添加，**无需打开提醒事项**。官方支持文档标题即《Use Apple Intelligence to suggest reminders from any app in iOS 26》，描述为 *"Get suggested reminders even when you don't have the Reminders app open."* [来源: https://support.apple.com/en-us/124025] [来源: https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/]
  - **Auto-Categorize**：官方原文 *"With Auto-Categorize, Apple Intelligence automatically sorts related reminders into sections within a list."* [来源: https://support.apple.com/en-by/guide/iphone/iphcb580b580/ios]
  - 购物清单自动排序。 [来源: https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/]
- **iOS 27（2026-09-14 shipped）**：**「Describe a reminder in natural language」**——用自然语言描述，AI 自动填 **date / time / location**（例如「get the groceries at 6pm tonight」）；Apple 官方功能清单里同时列出 Describe a calendar event / Describe a shortcut。另有 **Siri AI**（个人上下文、app actions、onscreen awareness）。 [来源: https://support.apple.com/en-us/121115] [来源: https://www.macrumors.com/guide/ios-27-calendar-reminders/] [来源: https://9to5mac.com/2026/08/26/heres-everything-new-for-reminders-in-ios-27/]
- ⚠️ **注意 Apple 的口径仍然是半自动**：官方 iOS 26 描述为 *"**Select text, tap Share, then tap Reminders.**"* [来源: https://support.apple.com/en-lb/guide/iphone/iphcb580b580/ios]

**2) 交互形态**
**建议 + 元数据自动填充**，**不是自动执行**。iOS 27 的「描述式创建」改善的是输入成本，不改变「人决定要做什么」。

**3) 自动排程**
**没有，而且这是 Apple 最大的功能空白。** Apple 自己的 iOS 27 功能清单没有任何针对提醒事项的排期/时间块能力；提醒事项支持页只有手动 due date / location / Urgent 闹钟。用户明确在求这个功能（r/gtd 帖《why can't Apple Reminders do time blocking》）。**未找到** Apple 任何形式的任务自动排期。 [来源: https://support.apple.com/en-us/121115] [来源: https://support.apple.com/en-us/102484] [来源: https://www.reddit.com/r/gtd/comments/1gmo3w2/why_cant_apple_reminders_do_time_blocking/]

**4) 定价与门槛**
- **随硬件免费**，但**硬门槛**：需 **iPhone 16 系列或更新、iPhone 15 Pro / Pro Max、iPhone Air、M1+ 的 iPad/Mac**；设备存储占用最高 **14 GB**（新设备）或 **8 GB**。**在中国大陆购买的设备不可用。** [来源: https://support.apple.com/en-us/121115]
- **服务端功能有每日额度**，Apple 官方称 *"increased access to such features will be available for a fee"*——即**未来可能对服务端 AI 收费**。 [来源: https://support.apple.com/en-us/127901] [来源: https://support.apple.com/en-us/121115]

**5) 模型与部署（本轮最有价值的端侧样本）**
- **AFM 3（第三代 Apple Foundation Models，2026-06-08）共 5 个模型，官方称 "custom-built in collaboration with Google"**：
  - **端侧**：AFM 3 Core（**3B dense**）、AFM 3 Core Advanced（**20B sparse，激活 1–4B**）
  - **PCC（Private Cloud Compute）**：AFM 3 Cloud、ADM 3 Cloud（Image）、**AFM 3 Cloud Pro（跑在 Google Cloud 的 NVIDIA GPU 上）**
  [来源: https://machinelearning.apple.com/research/introducing-third-generation-of-apple-foundation-models] [来源: https://security.apple.com/blog/expanding-pcc/]
- **对开发者的能力分界（WWDC26 session 319）**：**端侧 = 4K context、无请求次数限制、可离线**；**PCC = 32K context、支持推理、有每日 per-user 限额、需要联网**。**PCC 对 App Store Small Business Program 且首下载 <200 万的 App 免费**，开发者**无需 API Key、无 token 成本**。 [来源: https://developer.apple.com/videos/play/wwdc2026/319/]
- **ChatGPT 集成**属用户显式授权的「交接」，不是默认链路。 [来源: https://support.apple.com/guide/iphone/turn-on-chatgpt-iph00fd3c8c2/ios]

**6) 用户口碑**
- 2026 年主导叙事是**迟到 + 交付不完整**：*"Apple Intelligence is underwhelming"*；通知摘要曾因 BBC 报道的严重错误被迫在 iOS 18.3 暂停新闻摘要。 [来源: https://www.reddit.com/r/iphone/comments/1hcffa1/apple_intelligence_is_underwhelming/] [来源: https://www.bbc.com/news/articles/cq5ggew08eyo]
- 针对提醒事项的具体评价：MacRumors 该文最高赞评论称 iOS 26 的提醒事项更新是 *"a complete nothing burger… I don't use the AI/Siri stuff because it's currently garbage."* [来源: https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/]

---

### 2.10 Google Tasks / Gemini —— AI 有，但「任务」是最薄的一环

**1) AI 功能（确切功能名）**
- **Gemini 对 Google Tasks 的能力边界（一手）**：可以**添加 / 显示 / 更新 / 删除任务**，以及**拍照 → 任务（photo-to-task）**。**不能规划、不能排优先级、不能排程。** [来源: https://support.google.com/gemini/answer/15230285] [来源: https://workspace.google.com/products/tasks]
- **Google Calendar「Help me schedule」**（2025-10 上线）：Gemini 在 Gmail 里**建议会议时段**，由人挑选。**这是会议排期，不是任务自动排程。** [来源: https://workspaceupdates.googleblog.com/2025/10/help-me-schedule-meeting-gmail-calendar.html]
- **Google Assistant 从移动端移除，起始日 2026-09-04**，由 Gemini 取代。 [来源: https://blog.google/products/gemini/google-assistant-gemini-mobile/]

**2) 交互形态**
**对话式助手 + 建议**。Gemini 是唯一入口，Tasks 本身没有 AI 界面。

**3) 自动排程**
**没有。** Tasks 的时间块仍需手动。Google 侧的「scheduling」只存在于会议场景。

**4) 定价**
- Google Workspace 商务版（**年付 per user/month**）：**Starter $7 / Standard $14 / Plus $22**；**Gemini 现已捆绑进 Starter 档**。另有促销期 **2026-10-09 → 2027-01-09 八折**（$5.60 / $11.20 / $17.60）。 [来源: https://workspace.google.com/pricing]
- ⚠️ **Google AI Ultra 定价在不同来源互相矛盾**（9to5Google 称 $99.99/月；blog.google 的 I/O 2026 文案写 $250 → $200），Google 自己的 plans 页不渲染美元数字。**两个数字并列保留，不取其一。** [来源: https://9to5google.com/2026/05/20/google-ai-ultra-plans/] [来源: https://blog.google/technology/google-labs/io-2026-ai-updates/]
- **AI Premium → AI Pro 的改名已确认为一手事实，改名日期 = 未找到公开信息。**

**5) 模型与部署**
**Gemini（Google 自研），云端**；**端侧另有 Gemini Nano，通过 Android 的 AICore 系统服务分发**（这是本轮「端侧」证据链的一部分，见 §5）。 [来源: https://developer.android.com/ai/aicore]

**6) 用户口碑（本产品线上证据最尖锐的一条）**
- **Gemini App 曾失去 Google Tasks 集成**，社区反应：⚠️ *"Google, a company worth billions of dollars, is unable to integrate its own AI with its own Tasks app in a way that makes it reliable to use."*（r/GoogleTasks，约 2026-02） [来源: https://www.reddit.com/r/GoogleTasks/]
- 社区对 Tasks 功能缺失的共识：⚠️ *"the obvious candidates are missing?"* [来源: https://www.reddit.com/r/GoogleTasks/]
- **对本项目最有价值的判断**：Google 是全球最有能力做这件事的公司之一，**却在自己的 AI 与自己的任务应用之间做不出可靠集成**——这既是市场空白，也是「跨应用 AI 集成比看上去难」的证据。

---

### 2.11 Any.do —— 唯一把「AI 不替你规划」写进帮助文档的产品

**1) AI 功能（确切功能名）**
- **Any.do AI（AI Suggestions）**：四个能力——**填充个人清单**、**把任务拆成子任务**、**生成 board 清单**、**生成 Workspace boards**。 [来源: https://support.any.do/en/articles/9974267-any-do-ai-suggestions]
- **Any.do Voice Mode**：免手操作的语音捕获（独立帮助文档）。 [来源: https://support.any.do/en/articles/9974315-any-do-voice-mode]
- **ChatGPT 集成**（官方博客，用 OpenAI）。 [来源: https://www.any.do/blog/]

**2) 交互形态**
**纯建议，必须用户确认才写入**。流程是：点 **Suggest** → 审阅 → 点 **Agree** 或 **Try again**。官方原话：*"Any.do AI never replaces your planning. It simply gives you a helpful starting point that you can edit before saving."* [来源: https://support.any.do/en/articles/9974267-any-do-ai-suggestions]

**3) 自动排程**
**明确拒绝**。Any.do 官方博客原话：*"Instead of building an elaborate AI scheduling engine…"*——**这是本轮唯一一家把「我们不做 AI 排程引擎」写成公开理由的产品。** [来源: https://www.any.do/blog/]

**4) 定价（帮助中心更新于 2026-04-27）**
- **Premium $4.99/月（年付）或 $7.99/月（月付）**；Teams **$4.99/月/成员（年付）或 $7.99（月付）**。
- **Free 层不含任何 AI**；AI 可用范围按档位分：**Premium = 个人清单/任务**，**Family / Workspace = boards**。 [来源: https://support.any.do/en/articles/9974267-any-do-ai-suggestions] [来源: https://www.any.do/pricing]

**5) 模型与部署**
- **ChatGPT 集成用 OpenAI（一手）**；但**应用内的 Any.do AI 与 Voice Mode 的模型供应商 = 未找到公开信息**。**无端侧声明，云端。** [来源: https://www.any.do/blog/]

**6) 用户口碑**
- 称赞集中在**建议式 AI 的低风险**（可编辑、可重试），以及 Voice Mode 的免手操作。
- 抱怨集中在 **AI 藏在 Premium 后面**（免费层完全没有 AI）。

---

### 2.12 Amazing Marvin 与 Routine —— 一个「明确不做 AI」，一个「免费层就给 AI」

这两家放在一起，正好构成本轮**最极端的一对定价/路线对照**。

#### Amazing Marvin

| 维度 | 事实 |
|---|---|
| **AI 功能** | **零。** `/features/all/` 枚举 **49 个功能**，**无任何 AI 条目**；官方博客无 AI 文章；2026 年第三方评测确认 *"no built-in AI… rule-based toggles"* [来源: https://amazingmarvin.com/features/all/] |
| **「Smart autoscheduling」** | **仍在 roadmap 的「Things that are coming up」里**——即**未上线**。 [来源: https://community.amazingmarvin.com/roadmap] |
| **交互形态** | 规则/策略引擎（非 AI），由用户自己配置策略开关 |
| **自动排程** | ❌ 无（有启发式的 suggested task，不是排程） |
| **定价** | **一个档位：$8/月（按年付 $96）**；14 天免费试用；**无免费档**；「全部 100+ 功能」、**无功能分级也无加购**；学生 50% off；有「pay what you can」 |
| **模型/端侧** | N/A |
| ⚠️ **必须修正的一处** | **lifetime 买断（$300）已停售**，截止 **2023-11-15**（Reddit 公告），**现官网定价页不再列出**。但 ToS 仍写有 "lifetime plans" → **官方自身不一致**。**不得把 $300 当作当前价格引用。** [来源: https://amazingmarvin.com/pricing] |
| ⚠️ **易混淆** | 搜「Marvin AI」会命中 **HeyMarvin（heymarvin.com）**，那是一个**毫不相关的用户研究平台**，已排除。 |

#### Routine（routine.co）

> ⚠️ **两处必须先纠正的域名/状态问题**：
> ① **Routine 仍然活着并在发版**——决定性证据是 changelog 里 **2026-09-08 的「Routine 2.3」记录**；官网与 5 档定价均在线；YC 页显示 founded 2020、巴黎、6 名员工。**未发现关停或被收购。** [来源: https://feedback.routine.co/changelog] [来源: https://www.ycombinator.com/companies/routine]
> ② **`routine.com` 是一个街头服饰品牌（Turnstyle Brands），不是这家公司**；正确域名是 **`routine.co`**。 [来源: https://routine.com/] [来源: https://routine.co/pricing]

| 维度 | 事实 |
|---|---|
| **AI 功能** | **AI assistant + AI credits**（免费层即含 **250 AI credits**） |
| **交互形态** | 时间块以**手动拖拽**为主：⚠️ *"drag-and-drop interface that lets you schedule tasks directly onto your calendar"* [来源: https://ellieplanner.com/comparisons/routine-app-review] |
| **自动排程** | ❌ **非全自动** |
| **定价（5 档）** | **Free / $5 / $10 / $15** per seat（另有第 5 档） |
| **模型** | **未找到公开信息**。⚠️ 其 changelog 里的「ChatGPT- 或 Claude-like」是**UX 类比，不是供应商声明**——本报告明确不把它当作品牌证据。 [来源: https://feedback.routine.co/changelog] |

**对照结论（对本项目直接有用）**：

| | Amazing Marvin | Routine | Any.do |
|---|---|---|---|
| 免费层有 AI？ | 无免费层 | ✅ **有**（250 credits） | ❌ 完全没有 |
| AI 是否分级收费 | 无 AI | AI 在免费层 | **AI 全部锁在 Premium 后面** |
| 功能分级 | **完全不分级**（一个价全给） | 5 档 | 2 档 |

> **三家给出的三种答案，说明「AI 怎么收费」目前没有行业共识**：不分级全给（Marvin）、免费层就给（Routine）、全部锁进付费墙（Any.do）。而 **Marvin「一个价、无加购」在 2026 年反而是异类**——它也是本产品线里唯一没有 AI 的一家。

---

---

## 3. 横向问题一：AI 在任务管理里被验证有效的场景是哪几个？

> 判定口径：**「真需求」= 有真实用户自述在用且不抱怨其存在；「有用但有条件」= 有正面证据但附带明确失败模式；「demo 噱头」= 只有厂商宣传，找不到真实用户证词。**
> 证据强度标记：✅ = 本轮亲自抓到页面全文；⚠️ = 仅检索索引片段（Reddit/Trustpilot/G2 被反爬拦截）；❌ = 未找到公开信息。

| # | 场景 | 判定 | 关键证据 | 关键限制 |
|---|---|---|---|---|
| 1 | **自然语言 / 语音快速捕获** | **真需求**（但增量不在「NLP」） | ✅ TidBITS 作者自述日常用法；✅ Todoist Ramble（2026-01 上线，语音→结构化任务）；✅ XDA 实测标题《Talking to my to-do list felt ridiculous — until Todoist Ramble made it click》 | **NLP 日期解析不是 AI 带来的新东西**：Todoist Smart Add 早已存在，用户长期抱怨语法难记。AI 的真实增量是**从一段啰嗦口语里抽出多个字段**（日期+项目+优先级+负责人），不是「解析 tomorrow 5pm」 |
| 2 | **会议转录 → 待办抽取** | **有用但有条件** | 市场侧信号：Amie **放弃日历、转向 AI 会议笔记**；Motion 把 AI Meeting Notetaker 列为独立产品面；飞书妙记的实测好评（「待办比我手动记的还全」） | ❌ **未找到「抽取出的待办真的被完成」的任何量化数据**（完成率、留存）。唯一准确率说法是单点 n=1 的 ⚠️「约 9/10 次能准确抽出」 |
| 3 | **AI 日/周计划摘要**（「这是你今天的样子」） | **有用但有条件 / 接近噱头** | Morgen "AI Daily Planner" ✅、Motion "AI Calendar / Auto-plan your day" ✅ | ❌ 未找到任何留存/使用率数据。**它与「自动排程」高度重叠——只是排程结果的叙述层，单独存在时没有独立价值证据** |
| 4 | **AI 优先级 /「我现在该做什么」** | **有用但有条件** | Motion G2 摘要反复提到 automatic scheduling + task prioritization 受赞；Reclaim 把 **AI priority levels** 作为差异化功能 ✅ | 存在直接怀疑论：⚠️「If AI can prioritize your work better than you can you need a lot more help than some app can give you」。**真正被验证的是「用户自己设优先级、AI 只按它排」，不是「AI 替你决定什么重要」** |
| 5 | **AI 任务拆解** | **真需求**（小样本，ADHD 人群尤其） | ⚠️ Todoist 上线 suggested subtasks 时用户反应：「very useful for my ADHD to be able to easily break down bug tasks into smaller, more manageable tasks (analysis paralysis...)」 | 证据几乎全部来自**单一人群（ADHD / 拖延）**。❌ 未找到「拆解后的子任务被实际执行」的追踪数据 |
| 6 | **AI 自动排程（时间块）** | **有用但有条件——条件极其苛刻** | 最强正面：✅ HN「Hacking ADHD」帖「I can't recommend reclaim.ai highly enough… My whole life is scheduled in my calendar… a life-saver for the past couple of years.」 | 最强负面**不是用户骂，而是竞品创始人自己说的**（见 §4） |
| 7 | **AI 搜索 / 对自有任务笔记问答**（「我说过要做 X 是啥时候」） | **demo 噱头**（就目前证据而言） | 只有厂商宣传：Motion "AI Chat — The fastest way to go from question to done" ✅；Reclaim "AI Assistant" ✅ | ❌ **未找到任何真实用户在用这个场景的证词。这是本次调研中证据最空的一个场景。** 厂商自己给的用途是「plan, prioritize, optimize」——又绕回排程 |
| 8 | **AI 邮件 / 消息 → 任务** | **有用但有条件** | Todoist Assist 官方定位（Email Assist）✅；飞书妙记/任务智能体有真实自动建任务路径 | 好评多为单点 n=1。❌ 无规模数据 |
| 9 | **AI 习惯 / 连续打卡教练与推送** | **demo 噱头**（当前形态） | 反证来自长期实测：⚠️「I spent 5 years and hundreds of dollars testing every tracker while most died within days.」 | 厂商文案**自己承认了失败模式**：Nudge 官网 ✅「not just sending you another ignored notification」——即「AI 推送被忽略」是行业默认现状。❌ 未找到任何 nudge 提升完成率的量化研究 |

**结论（三句话）**：
1. **被验证的是「输入侧」和「理解侧」**：语音/自然语言捕获、会议→待办、任务拆解、邮件→任务。这四个的共同点是**替用户省打字和整理的力气**，且 AI 出错时用户能立刻看出来并改。
2. **没被验证的是「决策侧」**：AI 替你决定优先级、AI 回答你自己的历史承诺。前者有明确怀疑者，后者**连一条真实用例都找不到**。
3. **自动排程介于两者之间**，且它的成败**不取决于算法质量，而取决于控制权设计**（§4 全篇在讲这件事）。

---

## 4. 横向问题二：AI 排程（auto-scheduling）这条路走得通吗？

### 4.1 最重要的结构性发现：没有产品「因为功能被嫌弃而移除排程」

实际退出形态只有三种：

| 形态 | 案例 |
|---|---|
| **A. 整体关停 + 团队被吸收（acquihire）** | **Clockwise** |
| **B. 被大厂收购后继续运营，但用户预期崩了** | **Reclaim.ai**（Dropbox） |
| **C. 主动拒绝做全自动（「我们不做」也是一种结局）** | **Sunsama** |

> ❌ **未找到「某产品明确移除/下线 auto-scheduling 功能」的公开案例。**
> ⚠️ **但不要把「没有产品移除」误读为「这个功能很成功」**——它同时意味着**这个功能就是产品的全部，做不好只能关停**。

### 4.2 Clockwise —— 唯一有硬数字的死亡案例

| 时间 | 事件 |
|---|---|
| 2016 | Matt Martin 创立（此前 2014–2016 在 Salesforce） |
| 2019–2023 | 累计融资 **$76M+**（Bain、Coatue、Greylock、Accel、Atlassian、Slack Fund） |
| 2026-03-20 前后 | CEO 在 LinkedIn 宣布团队加入 Salesforce Agentforce |
| **2026-03-27** | **产品彻底下线。** Salesforce 对 The Register 明确：*"this is not an acquisition"*、*"is not acquiring Clockwise or its technology"* |
| 下线时自报成绩 | **40,000 家组织**、**8M 小时** Focus Time、**23M 次**会议被重排 |

[来源: https://www.salesforceben.com/salesforce-secure-team-behind-calendar-app-clockwise-for-agentforce/] [来源: https://getclockwise.com/] [来源: https://news.ycombinator.com/item?id=36958199]

- **「是成功还是失败？」诚实回答：两者都是。** 作为产品拿到 40,000 组织与 2,300 万次重排，却在 2026-03 被整体关停，用户**连账单历史都拿不到**（✅ *"You won't even be able to access your billing history after March 27"*）。作为团队，全员被 Salesforce 接收。 [来源: https://news.ycombinator.com/item?id=47443310] [来源: https://news.ycombinator.com/item?id=47447867]
- **最有价值的一条**：HN 上前员工承认 Clockwise 的迁移路径指向**竞争对手 Reclaim** —— ✅ *"I'm sure it was tough to swallow some pride and recommend Reclaim, who was our strongest competitor in the space."* [来源: https://news.ycombinator.com/item?id=47447867]
- 行业侧护城河评论（未经证实）：✅ *"there was never a compelling product or a moat they could build with in the space. It was trivial for Google or anyone else to just implement similar enhancements."* [来源: https://news.ycombinator.com/item?id=47443310]

### 4.3 Reclaim.ai —— 财务上是成功退出，用户情绪上是悲观

- 2019 由 Henry Shapiro + Patrick Lightbody 创立；**2024-08-20/22 被 Dropbox 收购**，条款未披露，**全部 22 人**加入。 [来源: https://reclaim.ai/blog/dropbox-acquires-reclaim] [来源: https://techcrunch.com/2024/08/22/dropbox-acquires-index-ventures-backed-ai-scheduling-tool-reclaim-ai/]
- 创始人自述保留完整团队与产品：✅ *"unlike many tech acquisitions, we were able to keep the entire team and product intact"* [来源: https://news.ycombinator.com/item?id=41302030]
- 但 HN 最高赞情绪是**预期衰退**：✅ *"I'll admit to feeling like this will be the beginning of the end for me… but I don't have any love for Dropbox"* [来源: https://news.ycombinator.com/item?id=41302726]
- **反例（说明 Dropbox 这次确实在投入）**：Reclaim 2026-06-12 发布 **Clockwise 迁移指南**，承诺 **100% 价格匹配**、优先支持、每日迁移 webinar，并吸收存量客户。 [来源: https://help.reclaim.ai/en/articles/11123801-switching-from-clockwise-to-reclaim-ai]
- 用户信号样本都很小：Trustpilot **2.2 / 5（23 条）** ⚠️；Google Workspace Marketplace **4.0 / 5（238 条）** ⚠️。 [来源: https://www.trustpilot.com/review/reclaim.ai] [来源: https://workspace.google.com/marketplace/app/ai_for_google_calendar_reclaimai/950518663892]
- **一条具体的灾难性差评**（同时是「日历污染」的核心证据）：⚠️ *"I have 300 tasks that reclaim.ai created and now **I cannot delete them in google calendar nor in reclaim.ai**, it is a mess!!!"* [来源: 同上]
- ❌ **Reclaim 的 ARR / 用户数 / 留存：未找到公开信息。**

### 4.4 Motion —— 商业上最成功的自动排程产品，用户评价最分裂

- 2025-09-08 宣布 **$60M**（Series B+C+C2）、累计 **$75M**、估值 **$550M**；同文披露 **mid-8-figure ARR**、**10,000+ B2B 客户**、50+ 员工，且 "AI Employees" 线**3 个月从 $0 到 8 位数 ARR**；战略从「AI 日历」转向 **"agentic work suite"**。 [来源: https://www.usemotion.com/blog/motion-raises-60m-to-build-the-agentic-work-suite-for-businesses.html]
- ⚠️ **第三方收入数字互相矛盾，不可用**：Sacra 称 $50M ARR、getlatka 称 $10M ARR，与官方 "mid-8-figure" 不可调和。**以官方口径为准。** [来源: https://sacra.com/c/motion/] [来源: https://getlatka.com/companies/motion]
- 评分（口径互不相同）：**G2 4.1（157）/ Capterra 4.3（89）/ Trustpilot 3.7（578）/ App Store 4.1（1.9K）**。 [来源: https://www.g2.com/products/motionapp/reviews] [来源: https://www.trustpilot.com/review/www.usemotion.com]
- **排程质量的具体差评**：⚠️ *"The system prioritizes my tasks incorrectly and I spend extra time reshifting them in my calendar after the app has already set the schedule."*；⚠️ *"I found the auto-scheduling in Motion to be pretty time-intensive only to end up with a less-than-desirable result."* [来源: https://www.reddit.com/r/productivity/comments/m7nlgo/has_anyone_tried_motion_thoughts/] [来源: https://www.reddit.com/r/ProductivityApps/comments/1b3jmu7/definitive_answer_akiflow_is_the_best_todo_list/]
- ⚠️ **计费/取消争议构成负面信号的大头**（与排程质量无关）：「charged me over 1000 AUD despite cancelling」、「got rid of monthly pay option」。 [来源: https://www.reddit.com/r/UseMotion/comments/1p6tvqy/usemotion_charged_me_over_1000_aud_despite/]
- **正面证据（它确实对一部分人有效）**：✅ HN 详细描述其机制 *"you specify an urgency, time estimate, and what 'schedule' it belongs to… whether to use chunking, which lets the algorithm break a task into multiple events based on the 'minimum chunk duration' you set"*。 [来源: https://news.ycombinator.com/item?id=39032816]

### 4.5 Sunsama —— 「拒绝」本身是一个有据可查的产品决策（本轮质量最高的一手材料）

- 用户先抱怨「这不算自动」：✅ *"I'm coming over from Motion and what is considered 'auto-scheduling' on Sunsama isn't fully auto-scheduling because I still have to press a button… it feels like one more platform I now have to manage manually."*
- **联创 Travis Meyer 的回答（全篇最重要的一段引语）**：
  > ✅ *"We opted to take a lighter touch than Motion does… **When designing our own version of auto-scheduling, we consistently heard feedback from folks who had tried Motion that Motion felt too opinionated and proactive when it came to scheduling things, and they ended up spending more time correcting automated scheduling decisions as a result.** We likely won't try and make fuzzy inferences like auto-rescheduling a task if it's 30 minutes after it's scheduled completion time (maybe you did actually finish it but just haven't had time to check it off in Sunsama yet). **We also value being intentional with your time, and think leaning too hard into automation takes away from that.** We likely won't add a 'automatically schedule all tasks to calendar' button with this in mind."*
  [来源: https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar]
- ⚠️ 第三方措辞过强（需修正）：有评测写「Sunsama 明确表示不会构建自动排程」——**不准确**，Sunsama 其实有单任务 auto-schedule / auto-reschedule，拒绝的只是**全量自动**。 [来源: https://efficient.app/compare/sunsama-vs-routine]

### 4.6 其余自动排程产品的实际结局（按证据强度排序）

| 产品 | 实际结局 / 定位 | 证据 |
|---|---|---|
| **Sorted³** | **事实上已死**（2025-06 时点）：客服站点因欠费停用、Mac 版 2 年未更新、iOS 版 8 个月未更新、Slack 邀请失效、社媒停在 2023 | ✅ TidBITS 实测，作者结论 *"I think Sorted is an ex-parrot."* [来源: https://tidbits.com/2025/06/25/appbits-sorted-seems-moribund/] |
| **Amie** | **从日历转向 AI 会议笔记** | ⚠️ 用户抱怨 *"Amie have switched focus to AI meeting notes which is so disappointing because their calendar is the best I've used."*；官网已改为 "Amie - AI Note Taker" ✅ [来源: https://amie.so/] |
| **Structured** | 仍存在，用户明确嫌**估时负担** | ✅ *"That's more meta-work than I want to do… articles always seem to take longer than I expect."* [来源: https://tidbits.com/2025/06/25/appbits-sorted-seems-moribund/] |
| **SkedPal** | 仍存在，**核心失败模式是「看不懂为什么这样排」** | ⚠️ *"even after months of use, it's still hard to fully understand why tasks are scheduled…"* [来源: https://www.morgen.so/blog-posts/skedpal-alternatives] |
| **Akiflow** | **明确不做自动排程**，靠手动拖拽 | ⚠️ *"Akiflow doesn't auto-schedule - you have to manually place every task."* [来源: https://www.saner.ai/blogs/akiflow-reviews] |
| **Trevor AI** | 仍存在，定位「辅助而非接管」 | ⚠️ *"I was using Trevor AI and liked it a lot, but doesn't auto re-schedule"* [来源: https://www.reddit.com/r/productivity/comments/1apa25m/tools_that_calendar_your_todos_besides_motion/] |
| **Morgen** | 有 AI Planner，定位「哲学上不同于 Motion」 | ✅ [来源: https://www.morgen.so/] |
| **FlowSavvy** | 低价（$7/月）「Motion 平替」，质量被质疑 | ⚠️ App Store 差评 *"It's more of an automated scheduling algorithm based on user inputs. The widgets are very low quality"* |
| **Llama Life** | **不是自动排程产品**（番茄钟 + 单任务清单），ADHD 定位，仍活着 | ⚠️ App Store 2026 评价 *"a half-finished app with distracting quirks"*；Play **3.8 / 145** |
| **Routine** | 拖拽式排程，非全自动 | ⚠️ *"drag-and-drop interface that lets you schedule tasks directly onto your calendar"* [来源: https://ellieplanner.com/comparisons/routine-app-review] |
| **Timehero** | 仍运营 | 官网 ✅；❌ **商业指标与留存：未找到公开信息** |
| **Google Calendar「Help me schedule」** | 2025-10 上线，Gemini 在 Gmail 里**建议会议时间**——是**会议排期**，不是任务自动排程 | ✅ [来源: https://workspaceupdates.googleblog.com/2025/10/help-me-schedule-meeting-gmail-calendar.html] |

- ⚠️ **一个容易被误读的宏观信号**：Reclaim 把「12 周排程视野 vs Clockwise 的 3 周」当卖点 ✅ ——说明**排程视野长度**是这类产品真实的竞争维度，而不只是「准不准」。 [来源: https://help.reclaim.ai/en/articles/11123801-switching-from-clockwise-to-reclaim-ai]

### 4.7 用户为什么不信任 AI 排时间（按「证据强度 × 复现频次」排序）

**① 「我花在纠正它的时间比自己规划还多」——最强、最可复现**
- ✅ 竞品创始人转述的 Motion 流失原因（同上）：*"they ended up spending more time correcting automated scheduling decisions as a result."*
- ⚠️ 用户原话：*"The system prioritizes my tasks incorrectly and I spend extra time reshifting them in my calendar after the app has already set the schedule."*
- ⚠️ *"I found the auto-scheduling in Motion to be pretty time-intensive only to end up with a less-than-desirable result."*

**② 「它不等我问就动了我的安排」**
- ✅ Sunsama 帮助文档承认这是设计难点：**任务会被主动拆分**填空隙（*"Tasks of more than 1 hour will be readily split to fill available time blocks"*），要按 `Shift+X` 才能阻止。
- ✅ 最尖锐的一句（说明用户**因此干脆不用自动排程**）：*"I don't really use the auto-scheduler currently because I have tasks that need to be 'pinned' like this."*
 [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/] [来源: https://roadmap.sunsama.com/improvements/p/pin-tasks-to-prevent-auto-rescheduling]

**③ 「它不知道这个任务要 3 小时，不是 30 分钟」+ 估时本身就是元工作**
- ✅ **根因是规划谬误（planning fallacy），不是 AI 的 bug**：*"predictions about how much time will be needed to complete a future task display an optimism bias and underestimate the time needed."* [来源: https://en.wikipedia.org/wiki/Planning_fallacy]
- ✅ 用户原话（针对 Structured）：*"That's more meta-work than I want to do… articles always seem to take longer than I expect."*
- **这是 ① 的机制来源：输入估时不准 → 排程必错 → 用户必须纠正。任何「AI 自动排程」产品都继承了用户自己的估时误差。**

**④ 「它把时间排在午休 / 专注块里」**
- ✅ Reclaim 把 **Lunch / Buffer Time / Travel Time / No-Meeting Days 做成独立产品功能**——这本身就证明「AI 会占用这些时段」是默认失败模式。 [来源: https://reclaim.ai/blog/dropbox-acquires-reclaim]
- ✅ Sunsama 的处理：*"Sunsama will not schedule tasks outside of your schedules unless you tell it to."*、*"Auto-scheduling does not consider declined meetings or events marked as 'available' or 'free'."*
- ❌ 未找到「AI 把任务排在午休导致我弃用」的直接引语。

**⑤ 「它无视我的精力曲线」**
- ⚠️ Reddit 帖子标题即结论：《Anyone else notice time-blocking ignores the most important variable?》
- ❌ **未找到任何自动排程产品声称已解决精力建模。**

**⑥ 「到早上 10 点计划就过期了」**
- ⚠️ *"People with highly unpredictable schedules… may find Motion's scheduling unhelpful since it becomes outdated…"*
- ⚠️ 对立面（说明问题真实存在，这是 Reclaim 的卖点）：*"Real-time rescheduling — Adjusts your schedule within seconds when conflicts occur."*

**⑦ 「一次糟糕的重排就毁掉信任」+ 无法解释**
- ❌ **未找到「因为一次错误重排就卸载」的直接引语。**
- 但有强力间接证据，厂商自己知道这个风险：✅ Sunsama 明确拒绝「超时 30 分钟就自动重排」，理由是**它无法区分「做完了没打勾」和「没做完」**（*"maybe you did actually finish it but just haven't had time to check it off"*）；⚠️ SkedPal 的失败模式正是**不可解释**。
- **结论：「一次坏重排毁信任」在本次调研中只有机制层面支持，没有直接引语。**

**⑧ 「日历被 AI 灌满了垃圾」**
- ⚠️ Reclaim 差评：*"I have 300 tasks that reclaim.ai created and now I cannot delete them in google calendar nor in reclaim.ai, it is a mess!!!"*
- ⚠️ 专属子版同类诉求：*"How to keep tasks from showing up in Google Calendar? I'd love it if my tasks stayed on Reclaim, keeping my Google calendar for scheduled time."* [来源: https://www.reddit.com/r/reclaim_ai/]

**⑨ ADHD 用户的特殊需求：要批量控制权，不要代理权**
- ⚠️ 精确命中「要什么」的原话：*"Sunsama has a 'replanning' feature… but it makes decisions for you automatically. True multi-select where the…"*
- ✅ **同一条引语里既有反对也有支持**（本报告最重要的平衡证据）：⚠️ *"Automatic schedulers give up significance for comfort in your schedule. No matter how you turn it, an auto scheduler will always make less significant decisions than you. **Personally the main reason why I'm sticking to autoscheduling is that it's the only way for me to stick to timeblocking.**"*

**⑩ 「计划必须是我自己的，我才会有所有权感」**
- ✅ Sunsama 联创把「意图性」当产品哲学：*"We also value being intentional with your time, and think leaning too hard into automation takes away from that."*
- ✅ **同一页面上用户 Marjorie MacIntosh 的反驳（说明这不是定论）**：她认为自己已用规则配置好 schedule，批量排程并不损害意图性——*"I have intentionally set up schedules with rules that allow the auto-schedule to plan things with intention."* [来源: https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar]

**⑪ 反证：说自动排程「改变了我的人生」的用户（这部分证据同样真实，不能只收集差评）**

| 用户 | 原话 |
|---|---|
| HN `WraithM`（ADHD 帖） | ✅ *"I can't recommend reclaim.ai highly enough… It's absolutely a game-changer for me. My whole life is scheduled in my calendar… a life-saver for the past couple of years."* |
| HN `madrox` | ✅ *"Everyone at my new job uses Clockwise, which will rearrange calendars across the org to maximize focus time for everyone… The jump to my productivity is huge."* |
| HN `bjterry`（管理者） | ✅ *"I use Clockwise for managing my calendar. It's quite convenient if you are a manager because it can handle all your flexible meetings (aka 1:1s)…"* |

[来源: https://news.ycombinator.com/item?id=38281535] [来源: https://news.ycombinator.com/item?id=32442902] [来源: https://news.ycombinator.com/item?id=26061475]

> 🔴 **人群差异是本节最有商业价值的一条分界线**：正面证据集中在 **(a) ADHD / 时间盲人群**（自动排程是「能开始」的前提）与 **(b) 管理者 / 团队场景**（排的是别人的会，不是自己的深度工作）；负面证据集中在**个人贡献者的深度工作**场景。

### 4.8 反过来：什么设计能赢回信任（每条都有已存在的先例）

| # | 设计模式 | 对应失败模式 | 已存在的先例 |
|---|---|---|---|
| 1 | **预览 / 逐条确认，不做全局一键应用** | 纠正成本、擅自动 | ✅ Sunsama 只做「按 `X` 单任务排入」，并**公开拒绝**「auto-schedule all tasks」按钮 |
| 2 | **Lock / Pin：用户放下的位置不可被动** | 擅自动 | ✅ Sunsama roadmap 该请求已有 **53+ 投票者**，合并了 4 条重复请求 |
| 3 | **用户改动优先于系统决策** | 擅自动 + 信任崩塌 | ✅ Reclaim 原文：*"Move, resize, or delete Reclaim events anytime — **the system adapts to your changes instead of overriding them.**"* |
| 4 | **可排程窗口 / 规则（默认不排到工作时间外）** | 排到午休 | ✅ Sunsama "Settings > Schedules"；✅ Reclaim Working/Meeting/Personal Hours + Proactive/Reactive + min/max 时长 |
| 5 | **把「人的需求」做成可保护的一等对象** | 排到午休 | ✅ Reclaim 把 Lunch Habit / Buffer Time / Travel Time / No-Meeting Days 做成独立功能 |
| 6 | **不静默拆分长任务；给出显式开关** | 擅自动 + 估时 | ✅ Sunsama `Shift+X` 禁止拆分；✅ Motion 有 chunking 与 minimum chunk duration 可配 |
| 7 | **超额时提问，而不是替用户决定** | 纠正成本 + 所有权 | ✅ Sunsama 给三个明确选项：Schedule anyway / Schedule another day / Defer |
| 8 | **优先级由用户设定，AI 只按它决定「谁让位」** | 纠正成本 + 所有权 | ✅ Reclaim **AI priority levels**：*"so Reclaim intelligently decides **what moves and what stays protected**"* |
| 9 | **可解释性（为什么排在这里）** | 不可解释 | ⚠️ 反向先例：SkedPal 因不可解释被持续吐槽。❌ **未找到任何产品公开的「排程解释」UI 设计文档** |
| 10 | **不碰不是它创建的东西** | 排到午休 + 信任 | ✅ Sunsama 不把 declined / marked-free 的事件算进排程 |
| 11 | **不把 AI 产物灌进用户的日历** | 日历污染 | ⚠️ 用户诉求明确，但 ❌ **未找到任何产品实现了「任务留在 App 内、只有时间块进日历」——这是一个公开的、未被满足的需求** |
| 12 | **把「重排视野」当一等参数** | 计划过期 | ✅ Reclaim 用 12 周 vs Clockwise 3 周作为卖点 |

[来源: https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar] [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/] [来源: https://help.reclaim.ai/en/articles/11123801-switching-from-clockwise-to-reclaim-ai] [来源: https://news.ycombinator.com/item?id=39032816]

**❌ 未找到先例的两条（可能是空白机会）**：
1. **Undo / 撤销自动重排**：没有任何产品公开文档描述「一键撤销上一次自动重排」。最接近的只有 Reclaim 的「系统适配你的手动改动」。
2. **排程解释 UI**：没有任何产品公开「为什么这个任务排在这个时段」的可读解释。

> ✅ **但 heyta 已经有两条现成的先例可以直接借用**：(a) **Reclaim 2.0 的 Preview Mode**（日历沙盒：先看会动什么，确认后才落地）；(b) **Reclaim 的三态锁**（`permanent` / 不锁 / 不锁），比 Motion 的布尔锁 + 60 分钟超时语义更细。见 §2.3。

---

---

## 5. 横向问题三：端侧 AI / 本地 AI 在生产力工具里的现状

### 5.1 结论先说：任务管理这个品类里，**端侧 AI 目前是空的**

> **本轮 13 个产品中，没有任何一家有端侧 AI 推理的证据。** 唯一的例外是**平台方**（Apple、Google）在自己的系统层做端侧模型，而它们的任务应用只是受益者。

| 产品 | 端侧证据 | 一手依据 |
|---|---|---|
| **Todoist** | ❌ **100% 云端**。官方原文 *"Todoist runs all AI functionality on secure infrastructure…"*；Ramble 明确 *"only works with an internet connection."* —— **这一条本身就排除了端上推理** | [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O] [来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF] |
| **Motion** | ❌ 纯云（Subprocessors 列 OpenAI） | [来源: https://www.usemotion.com/legal/subprocessors] |
| **Reclaim** | ❌ 纯云（核心排程自托管 LLM，仍在 Dropbox 环境内） | [来源: https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure] |
| **Akiflow** | ❌ 多云厂商（Anthropic/OpenAI/Google/Groq/ElevenLabs…） | [来源: https://akiflow.com/sub-processors-for-ai/] |
| **Sunsama** | ❌ 云（未点名供应商） | [来源: https://help.sunsama.com/docs/security/privacy-notes/] |
| **Superlist** | ❌ 无端侧声明 | [来源: https://help.superlist.com/en/articles/227395-privacy] |
| **Notion** | ❌ 全云。客户端只做**音频采集**（system audio + screen recording 权限），**不是端侧推理** | [来源: https://www.notion.com/help/ai-meeting-notes] |
| **飞书** | ❌ 全云，且**不支持本地/海外模型自托管** | [来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55] |
| **Google Tasks / Gemini** | ⚠️ 任务侧无；但**系统层有 Gemini Nano，通过 Android 的 AICore 系统服务分发** | [来源: https://developer.android.com/ai/aicore] |
| **Any.do / Marvin / Routine** | ❌ **四家全部未找到端侧模型** | — |

### 5.2 唯一的正面样本：Apple 的端侧 / PCC 分层（本轮最有参考价值的一手材料）

**AFM 3（第三代 Apple Foundation Models，2026-06-08）共 5 个模型，官方称 "custom-built in collaboration with Google"**：

| 层 | 模型 | 能力边界 |
|---|---|---|
| **端侧** | **AFM 3 Core（3B dense）**、**AFM 3 Core Advanced（20B sparse，激活 1–4B）** | **4K context、无请求次数限制、可离线** |
| **PCC（Private Cloud Compute）** | **AFM 3 Cloud**、**ADM 3 Cloud（Image）**、**AFM 3 Cloud Pro（跑在 Google Cloud 的 NVIDIA GPU 上）** | **32K context、支持推理、有每日 per-user 限额、需要联网** |

[来源: https://machinelearning.apple.com/research/introducing-third-generation-of-apple-foundation-models] [来源: https://security.apple.com/blog/expanding-pcc/] [来源: https://developer.apple.com/videos/play/wwdc2026/319/]

**这套分层对本项目有 4 条直接可用的经验**：
1. **端侧负责「高频、轻量、可离线」**（4K context、无次数限制），**云端负责「低频、重推理」**（32K、有日额度）——**按「调用频次 × 上下文长度」而不是按「重要性」分层**。
2. **端侧的能力上限被明确写出来**（4K context），而不是含糊地说「大部分场景在本地」。
3. **开发者侧零 token 成本**：PCC 对 App Store Small Business Program 且首下载 <200 万的 App **免费**，**无需 API Key**。 [来源: https://developer.apple.com/videos/play/wwdc2026/319/]
4. ⚠️ **三个硬约束**：硬件门槛（iPhone 15 Pro / iPhone 16+ / M1+）、**中国大陆购买的设备不可用**、服务端功能有每日额度且 Apple 称未来 *"increased access … available for a fee"*。 [来源: https://support.apple.com/en-us/121115] [来源: https://support.apple.com/en-us/127901]

### 5.3 为什么这个品类里端侧是空的（一个可检验的解释）

- **商业上**：这一批产品的 AI 都发生在**服务端可计量**的地方，因为**服务端才能按 credit / 点数 / 额度收费**——端侧推理**无法计费**。Apple 免费是因为它卖硬件；任务应用没有硬件可卖。
- **技术上**：真正吃上下文的是**会议转录**（数小时音频）和**跨应用检索**（大量文档），这两件事**目前做不到端侧**；而端侧能做的「短文本日期解析」**本来就不需要 AI**（Todoist Smart Add 早已实现）。
- **推论**：**「端侧 AI」在任务管理里的现实落点不是「更强的模型」，而是「不上传也能用的捕获与解析」**——这恰好是本地优先产品能独占的位置。

---

## 6. 横向问题四：BYOK（用户自带 API Key）模式

### 6.1 本轮能确认的事实

**结论：在本轮覆盖的 13 个产品里，没有任何一家支持「用户自带自己的 LLM API Key」来驱动它内置的 AI 功能。**
它们的模式**全部是厂商代管**：用户付费给产品，产品再去对接模型供应商。

| 确实存在的「自带」形态 | 不是 BYOK 的地方 | 依据 |
|---|---|---|
| **Akiflow / Sunsama / Superlist / Todoist / TickTick / Linear / Notion / 飞书任务 都提供 MCP**，让用户**用自己的 AI 客户端**（Claude Desktop / ChatGPT / Cursor / OpenClaw…）来操作数据 | ⚠️ **这是「自带客户端」，不是「自带模型 Key」**——内置 AI 仍走厂商自己的供应商与账单 | §9.1 全表 |
| **Linear MCP 支持 bearer token / Linear API key** | 这是**用 API Key 访问 Linear**，不是用 Key 访问模型 | [来源: https://linear.app/docs/mcp] |
| **Reclaim 的 Chat / MCP 走第三方模型，需用户显式 opt-in + Zero Data Retention** | 是**同意书**，不是 BYOK | [来源: https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure] |
| **Notion 官方「模型无关」**：*"Switch any workflow to a different model or provider, without losing any context."* | 选择权在**管理员**、供应商在 Notion 的 subprocessor 名单内，**不是用户自带 Key** | [来源: https://www.notion.com/product/ai] |
| **飞书**支持企业接入自定义模型（火山 / 阿里 / 腾讯等） | 是**企业级模型选型**，且官方明确**不支持本地部署、不支持海外模型**；个人用户不能自带 Key | [来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55] |

### 6.2 为什么 BYOK 在这个品类基本不存在（三条可检验的约束）

1. **计费冲突**：本轮所有把 AI 单独计费的产品（Motion credits、Notion credits、飞书点数、Todoist Automations 算力充值）**都需要把推理放在自己的账户下**。**BYOK 会让这条计费线直接消失。**
2. **责任与合规**：一旦推理在用户自己的 Key 上发生，**厂商无法再承诺「数据不进模型训练」**——因为它看不到对方的合同。Todoist 能写出 *"we do not send your data directly to OpenAI"* 正是因为**它自己控制路由**。
3. **体验不可控**：BYOK 意味着同一个功能在不同用户那里由不同模型驱动，**产品的质量承诺无法成立**。

### 6.3 ❌ 本轮未取得的部分（诚实标注）

**BYOK 的完整调研没有完成。** 原计划的取证范围（哪些产品提供 BYOK、其 UX 形态、以及具体踩坑）**没有落盘**——负责该部分的子调研未产出文件，而检索工具在本轮额度耗尽，无法补做。因此：
- ❌ **未找到**任何任务管理产品的 BYOK UX 实例、Key 存储方式、Key 校验失败处理、或用户对 BYOK 的实际评价。
- ❌ **未找到**「BYOK 的常见踩坑」的一手材料。
- ✅ 唯一可用的替代证据是上表：**这个品类目前集体选择了「MCP 开放客户端 + 厂商代管模型」**，而**不是** BYOK。

> **建议**：这一节若要用于决策，必须重跑一次检索。**不要用上面的推理链替代事实取证。**

---

## 7. 横向问题五：隐私与 AI 的冲突 —— E2EE 产品怎么处理 AI

### 7.1 ❌ 本节是本次调研最大的缺口，必须明确标注

**原定的调研对象是 Standard Notes、Obsidian、Bear、Anytype 四家 E2EE / 本地优先产品，问它们在「端到端加密与 AI 天然冲突」这件事上各自的公开立场与具体做法（解密上云 / 本地模型 / 干脆不做 AI）。**

**本轮未能取得这四家的任何一手材料**：负责该部分的子调研未产出文件，而 `web_search` 全程不可用、anysearch 额度中途耗尽，**无法补做**。因此：
- ❌ 未找到 Standard Notes、Obsidian、Bear、Anytype 任何一家关于 AI 的官方立场声明、隐私政策条款或帮助文档。
- ❌ 未找到它们「是否提供 AI 功能」「如果提供，是否解密后上传」「是否有本地模型选项」的任何一手证据。
- ❌ 未找到任何一家「因为 E2EE 而公开拒绝某个 AI 功能」的案例或解释。

**本节不做任何推测性填空。**

### 7.2 但本轮确实拿到了「云端 AI 厂商隐私承诺的结构性上限」——这对同一问题是有效的旁证

E2EE 问题的本质是：**「服务端看不到明文」这条架构事实，与「AI 需要明文」这条功能需求，谁让步。** 本轮恰好拿到了云端阵营最强一家的完整披露，可以作为**对照组**：

| 维度 | Todoist（同类里披露最透明） | Notion | Reclaim |
|---|---|---|---|
| **不训练承诺** | ✅ 有书面承诺（政策生效 2026-08-27）：*"we do not use information we collect from you, including via artificial intelligence tools, to … train … models"* | ✅ 默认不训练 + 合同禁止 | ✅ 第三方能力需显式 opt-in + Zero Data Retention |
| **实际保留期** | ⚠️ Ramble 音频被 Google 缓存**最长 24h**；prompt 滥用调查下**最长 90 天**；Automations search steps **30 天** | 非企业版默认 **≤30 天**；企业版**零保留**；embedding **60 天内删除** | 核心排程自托管；第三方走 ZDR |
| **内部一致性** | 🔴 **不一致**：Task Assist FAQ 仍写 *"OpenAI may use user input (queries) to improve their models"*，而当前 subprocessor 列表**没有 OpenAI** | 一致 | 一致 |
| **架构保证** | ❌ 无（只有供应商承诺） | ❌ 无 | ❌ 无 |

[来源: https://doist.com/privacy] [来源: https://trustcenter.doist.com/subprocessors] [来源: https://www.notion.com/help/notion-ai-security-practices] [来源: https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure]

> 🔴 **这三列是本报告对 heyta 最直接有用的一块**：即使是**披露最完整、承诺最明确**的云端产品，它给用户的最终保障仍然只是**「一份需要跨页核对的承诺 + 一段 24 小时的音频缓存披露」**，而**没有任何架构层面的保证**。
> **heyta 的 E2EE 可以把「服务端看不到明文」做成架构事实**——这是唯一一种**不需要用户信任厂商措辞**的方案。
> ⚠️ **但代价必须同时说清**：要在这条架构上做云端 AI，就必须**由用户显式授权解密某一段数据上云**（这是「解密上云」路线的必然形态），或者**只在端侧做**（能力受限，见 §5）。**这两条路的取舍，正是第 7 节缺失的那部分取证要回答的问题。**

---

---

## 8. 补充块 A：Time Left 类「时间可视化」应用 —— 这是视图，不是 AI

> 明确区分：本节所有产品的能力都是**渲染/视图层**（把同一个 due date 换一种呈现），**没有一个是 AI**。之所以单列，是因为产品负责人点名参考了它，而它恰好是「不做 AI 也能解决拖延」的一条独立路径。

**8.1 「Time Left」到底是哪个产品（消歧）**
同名产品**至少 10 个**，分属完全不同的品类。两个最容易被混淆的：

| | Time Left • Be Present | Left: Widgets for Time Left |
|---|---|---|
| App Store ID | `id1534791123` | `id6740155884` |
| 开发者 | **Julien Lacroix**（个人） | **Cntxt Limited**（新西兰，`com.cr.left`） |
| 官网 | https://gettimeleft.app/ | https://left-time.app/ |
| 美区评分 | 4.56 / 5，**234 条** | 4.56 / 5，**399 条** |
| 上架 / 最近更新 | 2020-10-20 / **2026-09-16** | 2025-01-13 / **2026-09-24** |
| 价格 | 免费 + `TIME LEFT PRO` 内购 | 免费 + 一次性买断（pay-what-you-want，三档） |
| 规模（厂商自述） | — | **100k+ 用户**、240k+ 追踪日期 |
| 含任务管理？ | ❌ **完全不含**（描述里没有 task/todo/deadline/reminder） | ✅ **唯一把 to-do 挂在倒计时上的** |

[来源: https://apps.apple.com/us/app/time-left-be-present/id1534791123] [来源: https://itunes.apple.com/lookup?id=1534791123&country=us] [来源: https://apps.apple.com/us/app/left-widgets-for-time-left/id6740155884] [来源: https://itunes.apple.com/lookup?id=6740155884&country=us] [来源: https://left-time.app/]

- ⚠️ **最容易搞错的一处**：`gettimeleft.app` **就是 Julien Lacroix 那款的官网**，不是独立竞品——页面唯一的下载按钮指向 `id1534791123`。 [来源: https://gettimeleft.app/]
- 另有完全无关的同名社交 App「Timeleft: Make New Friends IRL」（8,532 条评分，做线下陌生人聚餐）。 [来源: https://itunes.apple.com/lookup?id=6466442949&country=us]
- 其余同类：**Time Until**（Android，`com.brunoschalch.timeuntil`，**5M+ 下载**、4.6★/50K 评论）、**Pretty Progress**（iOS 4.71★/3,035；Play 4.4★/2,286；厂商称 2M+ 用户）、**Time Left - LIFE LEFT**、**TimeLeft: Visualize Your Life**、**Deadline Bar**。**全部零任务管理。** [来源: https://play.google.com/store/apps/details?id=com.brunoschalch.timeuntil] [来源: https://apps.apple.com/us/app/countdown-pretty-progress/id1597616326] [来源: https://prettyprogress.app/]

**8.2 有没有人把倒计时「挂到任务上」？**
- **`Left: Widgets for Time Left` 是唯一明确做到的**，App Store 描述原文：*"New: **every Ahead date now has its own to-do list**, so you can plan the small tasks that make the date happen and check them off as it approaches."* 但形态是**「倒计时事件 → 附属 to-do list」**，**不是「任务 → 递减进度条」**。 [来源: https://apps.apple.com/us/app/left-widgets-for-time-left/id6740155884]
- **真正做「任务本身显示倒计时/进度条」的只有两类，且小众的全部失败**：
  - **Deadliner**（`id1539999660`）：描述写 *"Each task displays a countdown, as well as a circular progress bar"*。**2020-12 上架、2026-06 仍在更新（6 年存活），但美区只有 2 条评分、均分 3.0。存活但没做起来。** [来源: https://apps.apple.com/us/app/deadliner-time-management/id1539999660] [来源: https://itunes.apple.com/lookup?id=1539999660&country=us]
  - **`Time Left - Quickly create one-time reminders`**（`id885754544`）：**钟面式任务管理器**（「Your day is set up like a clock, and your tasks are unique icons on the dial」）。**2014-06 上架后再未更新，2 条评分。已死——这是该形态最早的一次尝试，也是失败案例。** [来源: https://apps.apple.com/us/app/time-left-quickly-create-one-time-reminders-on-your/id885754544] [来源: https://itunes.apple.com/lookup?id=885754544&country=us]
  - 其他小规模存活：**Deadline App**（63 条评分）、**Griply**（197 条）、**Deadline Bar**（**0 条评分**，上架后从未更新）。 [来源: https://itunes.apple.com/lookup?id=1557048705&country=us] [来源: https://itunes.apple.com/lookup?id=1556692747&country=us] [来源: https://itunes.apple.com/lookup?id=6764828980&country=us]
- ✅ **唯一有规模证据的成功案例是 TickTick 的 countdown mode**（注意：**这不在本次「除 TickTick 外」的产品范围内，仅作为品类参照**）：任务列表视图可切 `Task time` ↔ `Countdown Time`，把「Due Wednesday」变成「还剩 2 天」。**Google Play 4.6★ / 164,748 条评论。** ZDNET 专门撰文《Why 'countdown mode' is the task manager feature I can't live without》，原文：*"an abstract target suddenly becomes very specific. 'Due Wednesday' becomes '2 day…'"* [来源: https://play.google.com/store/apps/details?id=com.ticktick.task] [来源: https://www.zdnet.com/article/ticktick-task-manager-feature-countdown-mode/] [来源: https://help.ticktick.com/articles/7322524237753745408]
- **结论**：「任务带倒计时条」这个形态，**大厂只把它当一个视图开关，独立产品做这个的全部没有规模**。

**8.3 为什么时间可视化对拖延有效（研究 + 用户证据）**
支持的机制层证据：
- **时间折扣（temporal discounting）预测拖延**：Nature Scientific Reports (2024)。 [来源: https://www.nature.com/articles/s41598-024-65110-4]
- **目标梯度效应（goal gradient）**：Kivetz et al., 2006, *Journal of Consumer Research*——越接近目标投入越多。 [来源: https://lawsofux.com/goal-gradient-effect/]
- **禀赋进度（endowed progress）**：Nunes & Drèze, 2006——先给一点进度能显著提高完成率（洗车集点卡实验）。 [来源: https://www.jstor.org/stable/10.1086/500480]
- **Zeigarnik 效应**：未完成任务在记忆中持续活跃（NN/g 的解释）。 [来源: https://www.nngroup.com/videos/zeigarnik-effect/]
- **ADHD 与视觉计时器**：视觉化时间对 ADHD 人群有明确帮助（PMC5852175）。 [来源: https://pmc.ncbi.nlm.nih.gov/articles/PMC5852175/]
- 用户原文（App Store 评论，实测拉取）：Pretty Progress 3★ —— *"seeing 3 weeks left motivates me more than a date out on a grid"*。 [来源: https://itunes.apple.com/us/rss/customerreviews/id=1597616326/sortBy=mostRecent/json]
- 反面用户原文：Left 3★ —— *"I don't have any use for it other than the widget looking nice on my lock screen"*。 [来源: 同上]

**8.4 反面证据（这一节是全篇最该被认真对待的部分）**
- 🔴 **Bisin & Hyndman (NBER w19874)**：人们**强烈想要** self-imposed deadline，**但 deadline 并没有提高完成率**。→「给它加个截止日期就能治拖延」**站不住**。 [来源: https://www.nber.org/papers/w19874]
- 🔴 **进度条会反向降低完成率**：Irrational Labs 引用的 **32 个实验的元分析**发现——当「前期投入感高」时，进度条**反而降低**完成率。**线性匀速递减的截止日期条正是这个形状。** [来源: https://irrationallabs.com/blog/knowledge-cuts-both-ways-when-progress-bars-backfire/]
- 🔴 **「卡在中间」的动机谷**：Bonezzi et al. (2011) 发现动机随进度呈 **U 型**，**中点（50%）是动机最低点**。而倒计时条恰好把注意力压在中段。 [来源: https://psycnet.apa.org/record/2011-09890-008]
- ⚠️ **「剩余」vs「已完成」的框架会改变动机方向**（框架效应）。
- ⚠️ **「人生周格 / memento mori」类产品**的留存与商业化问题：付费墙差评高度集中，用户原文 *"$35 for lifetime access? … EDIT: It's now $60!"*。 [来源: https://itunes.apple.com/us/rss/customerreviews/id=1534791123/sortBy=mostRecent/json]
- ✅ **本次调研最大的证据缺口**：**找不到任何 RCT / A-B 实验检验「给任务加倒计时条 → 完成率提升」**。现有研究要么停留在机制层，要么场景完全不同（洗车集点卡、问卷进度条）。
  → **建议：把「时间可视化」当作待验证假设，不要当作已证实的机制；若要押注，先自建 A/B。**

**8.5 未找到公开信息（本节）**
- 该品类**任何产品**的营收、下载量、留存（D1/D7/D30）——**全部未找到公开信息**。
- Pretty Progress 完整内购金额（只拿到被截断的列表页文本：Weekly $4.99 / Annual $14.99 / Lifetime 金额缺失）。
- Time Left PRO 官方价**完全未公开**（唯一线索是 1★ 评论称 $260/年，**无法证实，本次不采信**）。
- 中国「人生进度条」类产品的商业数据。

**8.6 对 heyta 的两条直接提示**
1. **可以做一个「倒计时视图」开关，但要按视图做，不要按 AI 做**：连 TickTick 都只把它当 view option；独立产品重注这个形态的全部没有规模。成本低、可回退、可 A/B。
2. **不要把倒计时当成拖延的解药**：有 32 个实验的元分析说明进度条可能反效果，且没有任何针对本场景的 RCT。**它是可测量的 UI 假设，不是已被验证的机制。**

---

## 9. 补充块 B：开放 API / MCP 策略

> 本节的取证说明：`developer.ticktick.com/docs` 与 `/api` 在本轮直接抓取时分别返回 **404 / 403**（Whitelabel Error Page），`developer.todoist.com/mcp/` 返回 **404**。因此下面的 MCP 事实来自**各产品的官方文档索引页与帮助中心**，而不是全部抓到了完整正文；凡未取到正文的，标为「文档存在，正文未取到」。

### 9.1 谁给「用户自己的 AI 客户端」提供了 MCP server

| 产品 | 有 MCP？ | 形态与入口 | 状态 |
|---|---|---|---|
| **Todoist** | ✅ | 官方 **API v1 文档内含独立的 Todoist MCP 章节**（Setup guide、Tool response format），并列有 **Todoist CLI** 章节（Installation、Common commands、**Agent skills**、Shell completions） | shipped [来源: https://developer.todoist.com/api/v1/] |
| **TickTick / 滴答清单** | ✅ | **MCP server（Streamable HTTP + OAuth）** + CLI；官方称适配 **11+ 个 AI 客户端**，官网点名 **OpenClaw**；MCP 的 Bearer Token 与 CLI **复用同一个 API Token**（设置 → 账户与安全 → API Token） | shipped [来源: https://help.ticktick.com/articles/7438129581631995904] [来源: https://ticktick.com/] |
| **Linear** | ✅ | **读写端点 `https://mcp.linear.app/mcp`；只读端点 `https://mcp.linear.app/mcp/readonly`**（或只申请 `read` OAuth scope）。授权方式：**OAuth 2.1 + Dynamic Client Registration**，也支持 **bearer token / Linear API key** | shipped [来源: https://linear.app/docs/mcp] |
| **Notion** | ✅ | 官方文档 `developers.notion.com/guides/mcp/overview`，含子页：**supported tools、Notion Skills、security best practices、"Hosting Notion MCP locally"、"Build an MCP client for Notion"** | shipped [来源: https://developers.notion.com/guides/mcp/overview] |
| **Akiflow** | ✅ | **Aki + MCP Connector 含在 Pro 订阅内**（不加购） | shipped [来源: https://akiflow.com/pricing] |
| **Sunsama** | ✅ | 定价页把 **"AI + MCP + Zapier"** 直接列为 Pro 档包含项 | shipped [来源: https://www.sunsama.com/pricing] |
| **Superlist** | ✅ | **Superlist MCP**，shipped **1.54.0 / 2026-05-05** | shipped [来源: https://www.superlist.com/pricing] |
| **飞书任务 / 妙记** | ✅ | **飞书 MCP 工具**，费用表原文 **0 点/次**（即免费）；供豆包工作伙伴调用 | shipped [来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55] |
| **Reclaim.ai** | ✅ | **Chat / MCP 走第三方模型，需用户显式 opt-in + Zero Data Retention**（与核心排程的自托管模型分离） | shipped [来源: https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure] |
| **Motion** | ⚠️ | **本轮未找到 Motion 的 MCP server**；但 Motion 提供了 `llms.txt`、`.md` 后缀与 GitBook `?ask=` 问答入口（见 §9.3） | 未找到公开信息 |

**一句话**：**MCP 在 2026 年已经从「差异化」变成「表格 stakes」**——本轮 13 个产品里至少 9 个已上线，且**全部把它包含在订阅内、没有一家为 MCP 单独收费**。这与「AI 能力本身要加购」（Akiflow Meeting Assistant +$19/月、Notion Custom Agents 按 credit）形成分工：**接口免费送，智能体按量收费。**

### 9.2 API 能力边界与限制（Todoist / TickTick / Notion / Linear）

| 产品 | 官方入口 | 授权 | 结构性限制 |
|---|---|---|---|
| **Todoist** | `developer.todoist.com/api/v1/` | OAuth，且**已经支持 Dynamic Client Registration 与 OAuth Client ID Metadata Document**（对 AI 客户端自助接入友好） | API 文档结构清晰（MCP 与 CLI 各占一节）；**具体速率限制本轮未取得** [来源: https://developer.todoist.com/api/v1/] |
| **TickTick** | `developer.ticktick.com`（文档 `/docs#/openapi`；中国版 `developer.dida365.com`） | **OAuth2**；另有更轻的 **API Token**（供 MCP/CLI 复用） | ⚠️ **本轮 `/docs` 返回 404、`/api` 返回 403，速率限制未取得一手数字**；且 AI 能力**必须把数据上云给第三方** [来源: https://developer.ticktick.com/] [来源: https://help.ticktick.com/articles/7055781495671095296] |
| **Notion** | `developers.notion.com` | 版本化 API（**2026-03-11** 与 **2025-09-03**）；另有 **CLI、Workers（Beta）、Agent APIs、Agent Skills API** | **Agent APIs / Workers 走 credit 计费**，API 侧与计费侧耦合 [来源: https://developers.notion.com/] [来源: https://www.notion.com/pricing] |
| **Linear** | `linear.app/docs` | **MCP 用 OAuth 2.1 + DCR 或 bearer/API key**；另有 **Linear Agent、AI Agents、Triage Intelligence、Code Intelligence、Coding sessions、Loops** | 提供**独立只读端点**（`/mcp/readonly`）或只申请 `read` scope —— **这是本轮唯一一家把「只读 MCP」做成一等入口的产品，值得直接借鉴** [来源: https://linear.app/docs/mcp] |

> 🔴 **Linear 的「读写 / 只读双端点」是本节最有价值的一条可复制设计**：把权限收敛做进 **endpoint 本身**，用户配置时不需要理解 OAuth scope 的语义——**选 URL 就等于选权限**。对一个本地优先、数据敏感的产品，这比文档里写「请谨慎授予写权限」有效得多。

### 9.3 一个刚刚出现的新做法：把文档做成「给 AI 读的」

- **Motion**：提供 **`llms.txt`**、URL 加 **`.md` 后缀直接返回 Markdown**、以及 GitBook 的 **`?ask=`** 问答入口。 [来源: https://www.usemotion.com/help/]
- **Reclaim.ai**：**在定价页直接放「Are you an AI agent? View our machine-readable pricing」**。 [来源: https://reclaim.ai/pricing]

> **含义**：这类产品已经在为「**AI 是主要读者，人是次要读者**」做准备了。对 heyta 的启示很具体：`docs/` 与 OpenAPI 契约可以考虑同样暴露 `llms.txt` 与 `.md` 变体，**成本极低，且直接服务「让用户自己的 AI 接进来」这条路线**。

### 9.4 「不做 AI，只做 AI 的接口」这条路线：谁在走，利弊是什么

**走这条路线 / 接近这条路线的是**：
- **Amazing Marvin**：**完全不做 AI**（49 个功能无 AI 条目），但也没有 MCP/API 作为替代出口——**这是「不做 AI 也没做接口」的孤例**。 [来源: https://amazingmarvin.com/features/all/]
- **飞书任务 MCP**：把任务能力开放给豆包工作伙伴，**工具调用 0 点/次**——即**能力免费、智能体侧收费**。 [来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]
- **Todoist**：AI 只做「捕获」，同时提供 **MCP + CLI + agent skills**，把「调度/决策」留给别家（Reclaim/Morgen/Trevor 在官方集成目录里）。 [来源: https://www.todoist.com/integrations]

**这条路线的好处**：
1. **不需要为模型质量负责**——模型换代是用户的事；产品只需保证接口稳定。
2. **不需要承担推理成本与合规义务**——token 账单在用户自己那里。
3. **可以吃到「用户已经有偏好的 AI 客户端」这一存量**（Claude Desktop、ChatGPT、Cursor、OpenClaw…）。
4. **MCP 已成为事实标准**，接入成本远低于自建对话层。

**这条路线的问题**：
1. **没有 AI 就收不到 AI 溢价**——本轮所有产品的 MCP 都含在订阅里，**没有一家靠 MCP 单独赚钱**。
2. **体验被别人的模型质量决定**，产品无法承诺「它一定好用」。
3. **权限面被放大**：一旦把写权限交给外部 agent，**错误操作发生在你的数据上**。Linear 用「只读端点」正面处理了这一点，多数产品没有。
4. **数据出境的合规责任仍在产品方**——用户自带 API Key 并不自动免除厂商的义务（见 §9.5）。

### 9.5 自托管产品怎么处理「用户自带 API / AI」——谁承担用户 API 调用的责任

**❌ 本节未能完成取证。** 原定对象是 **Nextcloud、Immich、Home Assistant、Vaultwarden**，问题包括：它们是否提供 AI 集成、是否要求用户自带 API Key、以及**当用户用自己的 Key 发起调用时，厂商是否承担数据责任**。

本轮**未取得这四家的任何一手材料**（负责该部分的子调研未落盘，且检索工具额度耗尽无法补做）。因此：
- ❌ 未找到任何一家关于「用户自带 API Key」的官方政策或条款。
- ❌ 未找到任何一家关于「AI 调用中的数据责任归属」的公开说明。
- **本节不做推测。**

**但有一个结构性的判断可以先行提出（属推理，不是事实）**：自托管产品与 SaaS 在这一点上有一个**架构性的责任分界**——当软件跑在用户自己的服务器上、Key 存在用户自己的配置里、调用由用户自己发起时，**厂商既没有数据、也没有调用记录**，因此**在物理上无法承担数据责任**。这与 SaaS 的处境相反（SaaS 必然经手数据，因此必然要写隐私条款）。
⚠️ **这个判断需要上述四家的实际条款来验证或推翻**，不应直接当成结论使用。

---

---

## 10. 未找到公开信息清单

> 本节按类别汇总全篇的 `未找到公开信息`。**它不是「该产品没有这个能力」的同义词**，只表示本轮没有找到公开的一手依据。

### 10.1 模型供应商 / 部署方式（没点名的）
- **Motion**：具体模型版本未披露（Subprocessors 页只列 **OpenAI** 为唯一 AI 平台供应商）。 [来源: https://www.usemotion.com/legal/subprocessors]
- **Sunsama**：**未点名任何供应商**，官方只写 *"an open-source AI model hosted securely in our cloud environment"* + *"third-party LLMs and inference providers"*。 [来源: https://help.sunsama.com/docs/security/privacy-notes/]
- **Superlist**：**未点名任何 LLM 或转写供应商**（定价页/功能页/changelog/帮助中心均无）。隐私政策只写 *"the AI provider"*。 [来源: https://www.superlist.com/privacy-policy]
- **Any.do**：**应用内 Any.do AI 与 Voice Mode 的模型供应商未找到**（只有 ChatGPT 集成明确用 OpenAI）。 [来源: https://www.any.do/blog/]
- **Routine**：**未找到**。（changelog 里的「ChatGPT- 或 Claude-like」是 **UX 类比，不是供应商声明**，本报告不采信。） [来源: https://feedback.routine.co/changelog]
- **TickTick / 滴答清单**：隐私政策只写 *"third-party AI service providers"*，**未点名**；无 engineering blog、无 AI 岗位、无专利公开。 [来源: https://ticktick.com/privacy?language=en_us]
- **飞书**：AI 四档版本的**人民币年费官方数字未找到**（仅第三方文库给出 9,900 元/年、9.9 万元/年）；套件**「元/人/年」的官方口径未找到**（官网按人/月计价）。
- **所有产品**：**除 Apple 与 Google（Gemini Nano）外，本轮未找到任何一家任务管理产品有端侧 AI 推理的证据。**

### 10.2 金额 / 商业指标
- **Clockwise**：作为产品关停，**无独立 ARR 披露**（HN 招聘帖给过 $76M+ 融资）。
- **Reclaim.ai**：**收购条款未披露**（TechCrunch 原文 *"hasn't disclosed the terms"*）；**ARR / 用户数 / 留存均未找到**。 [来源: https://techcrunch.com/2024/08/22/dropbox-acquires-index-ventures-backed-ai-scheduling-tool-reclaim-ai/]
- **Motion**：⚠️ **第三方 ARR 互相矛盾**（Sacra $50M vs getlatka $10M），与官方 "mid-8-figure ARR" 不可调和 → **只用官方口径，第三方数字不可用**。**churn rate 未找到。** [来源: https://www.usemotion.com/blog/motion-raises-60m-to-build-the-agentic-work-suite-for-businesses.html]
- **Timehero**：商业指标与留存未找到。
- **Notion**：Free/Plus 的 **"Limited Trial" 具体额度数字未找到**（只知道有限）。
- **Google**：⚠️ **AI Ultra 定价在不同来源互相矛盾**（$99.99/月 vs $250→$200），Google 自己的页面不渲染美元数字 → **两个数字并列，不取其一**；**AI Premium → AI Pro 的改名日期未找到**。 [来源: https://9to5google.com/2026/05/20/google-ai-ultra-plans/] [来源: https://blog.google/technology/google-labs/io-2026-ai-updates/]
- **Apple**：**Apple Intelligence 每日额度的具体数值未公布**（Apple 只说有额度、未来可能收费）。 [来源: https://support.apple.com/en-us/127901]
- **时间可视化品类**：**所有产品的营收、下载量、留存（D1/D7/D30）全部未找到**；Pretty Progress 完整内购金额（Lifetime 金额缺失）；**Time Left PRO 官方价完全未公开**（唯一线索是 1★ 评论称 $260/年，**无法证实，不采信**）；中国「人生进度条」类产品的商业数据未找到。
- **Amazing Marvin**：lifetime 已停售，**当前无 lifetime 价格**；ToS 与定价页关于 "lifetime plans" **自相矛盾**。
- **飞书**：「运行额度」的**单位换算关系未公开**（1 点 = 多少人民币 / 多少 token），用户只能看到消耗点数。

### 10.3 能力 / 量化效果（最常见的空白类型）
- ❌ **「会议转录抽出的待办真的被完成」的任何量化数据**（完成率、留存）——全篇未找到。
- ❌ **任何 nudge / AI 提醒提升完成率的量化研究**。
- ❌ **任何 RCT / A-B 实验检验「给任务加倒计时条 → 完成率提升」**。
- ❌ **「一次糟糕的自动重排就导致用户卸载」的直接用户引语**（只有机制层面证据）。
- ❌ **任何产品公开的「排程解释 UI」设计文档**，以及**「一键撤销上一次自动重排」的产品先例**。
- ❌ **任何产品实现了「任务留在 App 内、只有时间块进日历」**（用户明确要，但无人做）。
- ❌ **智能体 / AI 任务的 ROI 数据**：飞书单次 Agent 任务消耗 949.12 点是个案，**无任何厂商公布单位任务的平均点数或成功率**。

### 10.4 本轮的方法性缺口（诚实披露）
- **`web_search`（Tavily）全程不可用**（HTTP 432）；**anysearch 的免费额度在调研中途耗尽**。后半程只能 `web_fetch` **已知 URL** → **「发现新 URL」的能力受限**，但「已有 URL 的取证」不受影响。
- **Reddit / Trustpilot / G2 / Product Hunt / Google Workspace Marketplace 全部对自动抓取返回反爬**（403 / humanity check / 需登录）。因此这些来源的引文**一律是检索索引片段，未经原页复核**，正文中已逐条以 ⚠️ 标注。**任何用于对外文案的 Reddit 引语都应先人工复核。**
- **JS 渲染页面只返回标题**：`todoist.com/pricing`（部分）、`akiflow.com/pricing`、`routine.co/pricing`、`feishu.cn/*`、`reclaim.ai/pricing`（首次抓取）、`apps.apple.com` 列表页。凡此类，数字来自**对该官方 URL 的检索摘要**，已注明。**App Store 数据最终靠 iTunes Lookup/Search API + 评论 RSS 绕过**（这是本轮唯一一个「工具用尽后仍找到替代路径」的案例）。
- **Calendly 未做有效调研**（工具耗尽）。
- **`developer.ticktick.com/docs` 与 `/api` 在本轮直接抓取时分别返回 404 / 403**；TickTick Open API 的**具体速率限制未能取得一手数字**，只能引用官方入口 URL 与帮助中心描述。

---

---

## 11. 对 heyta 的启示

> 下面每一条都标注了**依据强度**：`[事实]` = 本报告有 URL 支撑；`[推理]` = 基于事实的推论，**需要另行验证**。

### 11.1 最大的空白是「捕获之后的下一步」

`[事实]` **本轮 13 个产品里，没有任何一家把「捕获到的任务」自动变成「排进时间轴的计划」**：
- Todoist 明确不做（2016 的 Smart Schedule 已停用），并让第三方（Reclaim/Morgen/Trevor）在**自己的官方集成目录**里替它做；
- 飞书只做「提取 → 建任务（带负责人+截止时间）」，最接近的是 **Agent 定时触发**，不是时间块；
- Apple 在 iOS 26/27 做了建议与自然语言建任务，**排期栏在官方功能清单里完全空缺**，用户公开在求；
- Google 只在**会议**场景做「Help me schedule」（建议时段）；
- Any.do **公开拒绝**建排程引擎；Amazing Marvin 的 autoscheduling **还在 roadmap**；Routine 是手动拖拽。

`[事实]` 同时，**用户确实在要**：Product Hunt 上 Todoist 票数最高的功能请求字面上就是 *"an AI scheduler which automatically schedules your highest priority tasks into your calendar"*。

`[推理]` **「捕获」已经是 table stakes**（Todoist/飞书/Apple 都做了，且 Ramble 首发准确率只有约 62% 也没挡住它成为卖点）。**「按用户真实控制权排程」仍是空位。**

### 11.2 如果做排程，本报告已经给出一份可直接抄的设计清单

`[事实]` §4.8 的 12 条设计模式**全部有已存在的产品先例**，其中最值得直接采用的 4 条：
1. **预览 / 逐条确认**（不做「一键排全部」）——Sunsama 公开拒绝过这个按钮。
2. **三态锁而不是布尔锁**——Reclaim 的实际语义是「拖拽 = 永久锁定 / Snooze = 不锁 / 删除 = 不锁」。`[推理]` 落成 `schedulingLock: 'none' | 'untilStart' | 'permanent'` 这类字段，比 `locked: boolean` 不丢语义。
3. **超额时提问，不替用户决定**——Sunsama 给 `Schedule anyway / another day / Defer` 三选一。
4. **日历沙盒**——Reclaim 2.0 的 **Preview Mode**：先看会动什么，确认后才落地。

`[事实]` 并且有两条**无先例的空白**可以直接占：**撤销上一次自动重排**、**「为什么排在这里」的可读解释**。另有第三条更贴近 heyta：**「任务留在 App 内、只有时间块进日历」——用户明确在要，但没有任何产品实现。**

### 11.3 人群分界线决定产品形态

`[事实]` §4.7 末尾的分界：**正面证据集中在 ADHD / 时间盲人群与团队管理者；负面证据集中在个人贡献者的深度工作场景。**
`[推理]` **这两类人需要的不是同一个功能**——前者要「能开始」（自动排程是前提），后者要「不要动我的安排」（自动排程是干扰）。**一个产品同时服务两者，就必须把「自动程度」做成可调档，而不是二选一。**

### 11.4 E2EE 是唯一能绕开「隐私承诺军备竞赛」的位置

`[事实]` §7.2：Todoist（同类披露最透明）、Notion、Reclaim 三家**给用户的最终保障都只是「承诺 + 保留期披露」，没有任何架构保证**；而且 Todoist 自己的两份文档**互相矛盾**。
`[事实]` §5.1：这个品类**端侧 AI 完全是空的**——愿意做端侧的产品在任务管理里目前没有。
`[推理]` **heyta 可以同时占住两个位置：架构上的「服务端看不到明文」+ 端侧的「不上传也能用」。**
⚠️ **但必须诚实**：这条路的代价是**云端 AI 需要用户显式授权解密某一段数据**（否则做不到），或者**能力被端侧上限限制**（Apple 的端侧上限是 4K context）。**这不是免费的。**

### 11.5 定价上：接口免费、智能体收费

`[事实]` §9.1：**本轮所有产品的 MCP 都含在订阅内，没有一家为 MCP 单独收费。**
`[事实]` 而「智能体/用量」普遍单独计费：Motion credits（超额 25¢/100）、Notion Custom Agents（$10 / 1,000 credits）、飞书点数、Todoist Automations 算力充值（$5/$10/$20，需 Pro 生效中）。
`[推理]` **「接口是获客与留存的成本项，智能体是收入项」**已是这个品类的分工。若 heyta 未来做 AI 收费，**按用量而不是按功能门控**更接近同行的实际做法——也更能解释清楚「为什么这次要多付」。

### 11.6 把文档做成「给 AI 读的」（成本最低、最立刻可做）

`[事实]` §9.3：**Motion 提供 `llms.txt` + `.md` 后缀 + `?ask=`；Reclaim 在定价页放「Are you an AI agent? View our machine-readable pricing」。**
`[推理]` heyta 已有 `docs/` 与 OpenAPI 契约，**加一个 `llms.txt` 与 Markdown 变体是一天量级的工作**，且直接服务「让用户自己的 AI 接进来」这条不需要自研模型就能兑现价值的路线。

### 11.7 复刻一个「时间可视化」视图，但别当解药

`[事实]` §8：**连 TickTick 都只把倒计时当 view option**；专做这个形态的独立产品**全部没有规模**（Deadliner 2 条评分、Deadline App 63、Griply 197、Deadline Bar 0）。
`[事实]` **且反面证据很硬**：32 个实验的元分析发现进度条在某些条件下**反向降低完成率**；Bisin & Hyndman 发现人们想要 self-imposed deadline，**但 deadline 并未提高完成率**；**没有任何 RCT 检验过「任务加倒计时条 → 完成率提升」。**
`[推理]` **做成一个可开关的视图 + A/B 指标，不要做成核心机制，更不要对外宣称它能治拖延。**

### 11.8 不要做的事（都有反面样本）

| 不要 | 反面样本 |
|---|---|
| **不要把「AI 搜索你自己的任务」当卖点** | `[事实]` §3 判定它为 **demo 噱头**——**零用户证词**，厂商自己给的用途又绕回排程 |
| **不要让 AI 的产品灌进用户的日历主视图** | `[事实]` Reclaim 差评 *"I have 300 tasks that reclaim.ai created and now I cannot delete them… it is a mess!!!"*；用户明确要求「任务留在 App 内」 |
| **不要静默拆分长任务** | `[事实]` Sunsama 默认会把 >1 小时的任务「积极拆分」填空隙，需要 `Shift+X` 才能阻止 |
| **不要用布尔锁 + 超时** | `[事实]` Motion 的 fixed 锁**有 60 分钟超时**——用户以为钉住了，系统仍可能挪走 |
| **不要写「AI 不用于训练」却在不同页面自相矛盾** | `[事实]` Todoist 的 Task Assist FAQ 仍称 OpenAI 可能用 query 改进模型，而当前 subprocessor 列表没有 OpenAI |
| **不要把 AI 捆绑进涨价** | `[事实]` Superlist 最响的抱怨是「**AI features that no one asked for**」；Notion 有「150% price increase」与 Custom Agents credit 反弹 |

### 11.9 一句话收束

> **2026 年的任务管理 AI，已经把「帮你把话变成任务」做完了，也把「替你做决定」证明成了用户最不想要的那一种 AI。真正没人做好的，是「在你划定的边界内，把任务变成一份你会遵守的时间表」。**

---

## 12. 取证完成度声明

| 部分 | 状态 |
|---|---|
| 13 个产品的 6 个问题（功能名 / 形态 / 排程 / 定价 / 模型 / 口碑） | ✅ 完成 |
| 横向问题一（已验证场景） | ✅ 完成 |
| 横向问题二（自动排程成败） | ✅ 完成（含 Clockwise 死亡硬数字、Sunsama 联创原话、12 条设计模式） |
| 横向问题三（端侧 AI） | ✅ 完成（结论：品类内为空；Apple AFM 3 为唯一正面样本） |
| **横向问题四（BYOK）** | ⚠️ **未完成**——只确认了「本品类集体走 MCP 开放客户端而非 BYOK」，**BYOK 的 UX 实例与踩坑未取证**（见 §6.3） |
| **横向问题五（E2EE 产品的 AI 立场）** | ❌ **未完成**——Standard Notes / Obsidian / Bear / Anytype **四家零材料**（见 §7.1）。**这是本报告最大的缺口。** |
| 补充块 A（Time Left 类时间可视化） | ✅ 完成（含反面证据与证据缺口） |
| 补充块 B（开放 API / MCP） | ✅ 主体完成（§9.1–9.4）；⚠️ **§9.5 自托管产品的责任归属未取证** |

**工具性限制（影响能力范围，不影响已取证据）**：`web_search`（Tavily）全程 HTTP 432 不可用；anysearch CLI 的免费额度在调研中途耗尽，后半程只能 `web_fetch` 已知 URL；Reddit / Trustpilot / G2 / Product Hunt 全部反爬，相关引文均为检索索引片段并已逐条以 ⚠️ 标注。

**并行子调研的实际结果（用于解释上面三处缺口为何存在）**：

| 子调研 | 结果 |
|---|---|
| Todoist / Motion+Reclaim / Akiflow+Sunsama / Superlist+Notion / 飞书+Apple / Google+Any.do+Marvin+Routine / 已验证场景+排程成败 / Time Left 类时间可视化 | ✅ **8 份全部落盘**，共约 3,900 行，已整合进本报告 |
| **BYOK + 本地 AI + E2EE 隐私立场** | ❌ **运行失败，未产出任何内容** → **这是 §6.3 与 §7.1 缺口的直接原因**。该子调研在报告定稿前失败，**其原定覆盖的四家 E2EE 产品（Standard Notes / Obsidian / Bear / Anytype）至今零材料** |
| **开放 API / MCP 策略** | ❌ **运行失败，未产出文件** → §9 因此**完全由主调研的第一手取证写成**（`developer.todoist.com/api/v1/`、`linear.app/docs/mcp`、`developers.notion.com/guides/mcp/overview`、`help.ticktick.com`、各产品定价页），**但 §9.5 自托管部分因此无材料** |

**若要补齐上述缺口，建议重跑一次定向检索**，不要用本报告的推理链替代事实取证。

### 归档的原始调研文件（本报告的逐产品底稿）

| 文件 | 内容 |
|---|---|
| `research/ai-competitors/todoist.md` | Todoist 深度调研（544 行） |
| `research/ai-competitors/motion-reclaim.md` | Motion + Reclaim 深度调研（1179 行） |
| `research/ai-competitors/akiflow-sunsama.md` | Akiflow + Sunsama 深度调研（629 行） |
| `research/ai-competitors/superlist-notion.md` | Superlist + Notion 深度调研（447 行） |
| `research/ai-competitors/feishu-apple.md` | 飞书 + Apple 深度调研（467 行） |
| `research/ai-competitors/google-anydo-marvin-routine.md` | Google / Any.do / Marvin / Routine 深度调研（492 行） |
| `research/ai-competitors/horizontal-validated-autosched.md` | 横向：已验证场景 + 自动排程成败（320 行） |
| `research/ai-competitors/time-visualization-apps.md` | Time Left 类时间可视化（493 行） |