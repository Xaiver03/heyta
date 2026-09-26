# 滴答清单的 AI 做法 · 竞品 AI 格局 · E2EE 下可用的推理架构

> 调研时间：2026-09-25
> 调研目的：为 [ADR-0005](../adr/0005-ai-data-path.md) 与 [AI 能力分支计划](../plans/ai-capability-branches.md) 提供证据
> 证据分级：**【本机实测】** = 本次调研直接抓取一手页面原文；**【子任务核实】** = 由调研子任务抓取一手页面并给出原文/URL；**【未核实】** = 仅搜索线索，**不得当作结论**
> ⚠️ 本文件是**归档**。结论有变时**新增勘误**，不改原文（`docs/README.md` §一）。

---

## 0. 一句话结论

> **滴答清单的 AI 之所以能做，是因为它本来就不是端到端加密的** ——
> 它的 AI 助手会把用户的任务、清单、习惯交给第三方 AI 服务商处理。
> 所以 heyta 学它的**功能形态**是对的，学它的**数据路径**等于放弃自己的核心承诺。

---

## 1. 滴答清单 / TickTick 的 AI 做法

### 1.1 先纠正一个常见误解：官网宣传的"智能"不是大模型

官网 Features 页（中英两站一致）在"快速捕获任务"里列的是：

| 官网原文 | 实际是什么 |
|---|---|
| **NLP** — "Utilize NLP for task time setting. Just type in your information, and it will be identified instantly." | 传统 NLU 规则解析（时间识别）。中文站对应名称为**「智能识别」** |
| **Voice Input** — "just add tasks with voice, and it will automatically convert to text" | 语音转文字（ASR）。中文隐私政策列出的语音识别 SDK 是**科大讯飞** |

**【本机实测】** 来源：`https://ticktick.com/features`、`https://dida365.com/features`（2026-09-25 抓取）

**这两件事都不是大模型，而且 NLP 在免费版就有。** 这一条对 heyta 很重要：
`chrono-node` 那条路（MIT、含中文、已在 `docs/plans/roadmap.md` §3 登记）不是"AI 的廉价替代品"，
**它就是滴答清单实际在跑、且免费提供的东西**。

### 1.2 AI 功能清单（2026-09 现状）

官方帮助中心有一个独立的「🤖️ AI Features」栏目（6 篇），加上定价页的 `AI Features` 行，
可确认的能力如下。**【子任务核实】**（来源见各行）

| # | 功能 | 做什么 | 交互形态 | 需要用户确认？ | 来源 |
|---|---|---|---|---|---|
| 1 | **AI Assistant** | 对话式管理任务与时间；可读存量数据 | 对话（独立 Tab / 侧边栏 + 浮动按钮） | ✅ **是**（官方 prompt 范例全部以 "Wait for my confirmation before making any changes" 结尾） | [help 7503016104470511616](https://help.ticktick.com/articles/7503016104470511616) |
| 2 | **AI Voice Add**（AI Mode） | 语音建任务，抽取日期/清单/标签/优先级；**一句话含多件事会自动拆成多条任务**；长语音生成简短标题 + 全文转写进描述 | 语音 | 部分（语音 → 任务） | [help 7444677039392555008](https://help.ticktick.com/articles/7444677039392555008) |
| 3 | **Transcribe & Summarize Recordings** | 录音附件一键转写（带时间戳）+ AI 摘要，30+ 语言 | 附件上的按钮 | 是（用户主动点） | [help 7444682584526684160](https://help.ticktick.com/articles/7444682584526684160) |
| 4 | **TickTick MCP** | `https://mcp.ticktick.com`（中国版 `mcp.dida365.com`），Streamable HTTP，OAuth / Bearer | **把 AI 放在产品外面** | 由用户的 AI 客户端决定 | [help 7438129581631995904](https://help.ticktick.com/articles/7438129581631995904) |
| 5 | **TickTick CLI** | `npm i -g @ticktick/ticktick-cli`；中国版 `@suibiji/dida-cli`（命令 `dida`）。文档明确写"也可供 AI Agent 调用" | 命令行 | — | [help 7465251130025443328](https://help.ticktick.com/articles/7465251130025443328) |
| 6 | **AI Use Cases** | 官方 prompt 范例集（收件箱整理/每日规划/Backlog 清理/复盘等） | 文档 | — | [help 7475477082185662464](https://help.ticktick.com/articles/7475477082185662464) |

**MCP 的工具清单**【子任务核实】：任务查询 6 个、清单/分组/文件夹管理 13 个、
任务管理 16 个（含 `batch_add_tasks` / `batch_update_tasks` / `complete_tasks_in_project`，**每次最多 20 个**）、
习惯 8 个、专注记录 5 个、纪念日 1 个。已适配 Claude、ChatGPT(Codex)、Gemini(Spark, Beta)、Grok、
Perplexity、Claude Code、Cursor、VS Code、Codex CLI、TRAE、Antigravity；中国版另适配 WorkBuddy、豆包、千问办公。

🔴 **这一条值得单独记住**：滴答清单**同时做了"MCP + CLI"和"内置 AI 助手"两条路**，
而不是只做内置助手。MCP 那条路的工具清单里**有批量写操作** ——
这正是 heyta 计划里 AI-2（结构化）会遇到的"批量 op"问题，它选择了**限制批量大小**这个简单解法。

#### 1.2.1 三个直接可用的设计先例（都有官方原文）

**① 失败自动回退到确定性路径** —— AI Voice Add 官方说明：解析耗时 1–2 秒（长输入 3–5 秒），
**失败会自动回退普通模式并显示原始转写**。若不确定该不该拆成多条，**给两个版本让用户左右滑动选**。

> 这正是 ADR-0005 §3.3 那条"LLM 做得最少 + 确定性回退"的**行业印证** ——
> 头部产品也是这么兜底的，而且是**产品级默认行为**，不是异常处理。

**② 批量与范围的硬上限**（MCP 工具清单，官方原文给出的边界）—— **子任务核实**：

| 工具 | 上限 |
|---|---|
| `complete_tasks_in_project` / `batch_add_tasks` / `batch_update_tasks` | **每次最多 20 个** |
| `list_undone_tasks_by_date` | **最大 14 天** |
| `upsert_habit_checkins` | **最近 90 天** |
| `get_focuses_by_time` | **一次最多一个月** |
| `update_focus` | **时长不可改** |

官方边界原话：**"mainly supports basic task, list, habit, focus records and countdown operations.
Other advanced features are not supported yet."**

> 对 heyta AI-5 的含义：**同行用"能力子集 + 明确上限"来交付接口，而不是追求 API 完备**。
> 这是降低鉴权面与爆炸半径的务实做法，值得照抄。

**③ 它没有做的那些事**（逐项确认表，**子任务核实**）—— 这一栏对 heyta 的排期更重要：

| 候选能力 | 滴答清单 |
|---|---|
| 智能标签 / 自动分类 / 优先级建议 | ❌ **无原生自动能力**（标签纯手动，AI 只能在 prompt 里"推荐"） |
| 截图转任务 / 图片 OCR | ❌ **没有**。第三方对比文写明 "TickTick searches your task text, **not the contents of an image**" |
| 邮件转任务 | ✅ 有，**但是规则式**（地址路由 `todo@mail.ticktick.com`，无解析） |
| Smart List | ✅ 有，**但不是 AI**（纯规则过滤） |
| 习惯打卡的 AI 分析 / 番茄钟 AI / 日历排会议 AI | ❌ **均无原生** |
| AI 拆解任务 | ⚠️ **只能靠提示词，无独立按钮** |

🔴 **一句话**：滴答清单的 AI **覆盖面明显窄于 Todoist**（Email/Filter/Task Assist、Ramble），
也窄于 Motion / Reclaim 的自动排程。它的重心是**对话式助手 + 语音捕获 + 录音摘要 + 对外开放 MCP/CLI**；
而邮件转任务、Smart List、NLP 日期解析、番茄钟、日历集成**至今仍是老的规则式实现**。

> 这条对 heyta 的裁决是**加强**而不是削弱：
> 用户要的"优先级排序"**同行刻意没做**；"甘特图"**同行主动放弃**；
> "AI 拆解"**同行只敢做成提示词**。heyta 按计划走"规则打底 + 逐条建议 + 建议→确认"，
> **不是在追赶，而是在同一个保守区间里做得更干净。**

### 1.3 时间线：2025 年一个 AI 功能都没有

**【子任务核实】** 官方 2025 年归档页**通篇零 AI 条目**（只有 iOS 26 适配、专注记录、倒数纪念日、
日历批量操作、Notion 关联、Apple Health 等）。来源：
`https://help.ticktick.com/external/articles/7505896563223298048`

| 日期 | 事件 | 备注 |
|---|---|---|
| 2026-01-04（中文）/ 2026-01-08（英文） | V8.0「推荐任务 / Suggested Tasks」 | ⚠️ 官方描述为"基于创建时间、改期历史、临近截止日"的**规则式**推荐，**不是大模型** |
| 2026-04-23 / 04-24 | **AI 录音总结**（AI Recording Summary） | 第一个真·AI 功能 |
| 2026-04-29 | 官方 What's New：**"TickTick ✖️ AI 🤖 Smarter Task Management"**，一次放出 **MCP + AI Voice Add（仅移动端）+ 录音转写总结** | 🔴 **"把 AI 放在产品外面"** |
| 2026-08 | AI Assistant 内测（beta） | Reddit 公告 |
| **2026-09-15 / 09-16** | **AI Assistant 正式上线** | 🔴 **"把 AI 放进产品里面"** |
| 2026-09-19 | iOS 8.2.12 release notes：AI Assistant + **iOS 27 Siri AI 集成** | Apple 于 2026-09-14 发布 Siri AI |

来源：`https://www.dida365.com/public/changelog/zh.html`、`https://ticktick.com/public/changelog/en.html`、
`https://itunes.apple.com/lookup?id=626144601&country=us`

### 1.4 战略判断：两步走 —— **这条有官方原话，不是我的解读**

> 官方 FAQ 原文（专为解释两者分工而写）：
> **"AI Assistant is designed to... directly within TickTick... MCP and CLI are better suited for users
> who want more flexibility... through third-party tools."**
> 来源：`https://help.ticktick.com/articles/7503016104470511616`

| 步骤 | 时间 | 做法 | 本质 |
|---|---|---|---|
| **一：把 AI 放在产品外面** | **2026-03-11**（CLI 首发 npm）→ 2026-04-29（MCP + 语音 + 录音） | 不自研模型，把滴答清单变成 **AI Agent 可调用的数据源**：MCP server、CLI、OAuth/Bearer Token、ChatGPT 插件。用户在自选 AI 客户端（Claude / ChatGPT / Gemini / Grok / 豆包 / 千问 / Cursor / VS Code / OpenClaw…）里操作数据 | **能力外借** |
| **二：把 AI 放进产品里面** | 2026-08 内测 → **2026-09-15 正式** | 自建**对话式 AI Assistant**，应用内直接读任务/清单/习惯/专注记录做规划、拆解、复盘；**模型仍是第三方** | **能力内建** |

三条旁证（都很具体）：

1. **CLI 首发比官方公告早约 7 周** —— npm `@ticktick/ticktick-cli` v0.1.0 发布于 **2026-03-11**，
   而官方 What's New 是 2026-04-29。**【子任务核实】** 来源：`https://registry.npmjs.org/@ticktick/ticktick-cli`
2. 🔴 **官网首页的 AI 区块至今只列 3 项**（Voice Capture / Audio Summary / Automated Workflows），
   **尚未写 AI Assistant** —— 首页文案**停留在第一步时期**。来源：`https://ticktick.com/`
3. **隐私政策 2026-07-09 新增 AI 段落**，时间点正好在第二步上线前 —— 是为内建助手做合规准备。

> 对 heyta 的直接启示：**AI-5（接口 / 数据主权）不该被当成"AI 的边角料"，
> 它是这个行业里被验证过的第一步，而且顺序是官方自己选的。**
> 它恰好也是唯一与 E2EE 零冲突的那条路。

### 1.5 定价与配额

**【本机实测】+【子任务核实】**

| 项 | TickTick（国际） | 滴答清单（中国） |
|---|---|---|
| 免费版 | US$0（9 清单 / 99 任务每清单；**含 NLP**） | ￥0 |
| 付费版 | **Premium US$49.99/年**（"less than US$4.17/month"） | **高级会员 ￥139/年**（"每月仅￥11.6"） |
| **AI 功能** | 🔴 **Free ✗ / Premium ✓** | 🔴 **免费 ✗ / 高级会员 ✓** |

- `AI Features` 那一行是从**原始 HTML** 解析出来的（Free 列为 dash 图标、Premium 列为 check 图标），
  且中英两站结果一致。**【子任务核实】**
- ⚠️ 第三方站点大量仍在写 $35.99/年，**那是旧价**。
- **AI 不单独收费**，而是走**共享月度配额**。官方 FAQ 原文：
  > "AI-powered features share the same AI quota, which resets each month.
  > You can go to **Settings → AI Features** to check your current quota usage.
  > Once you reach your monthly quota, AI-powered features will be temporarily unavailable."
  > 来源：`https://help.ticktick.com/articles/7503016104470511616`
- 🔴 **配额的具体数字未找到公开信息**（帮助中心与定价页都没写）。

> 对 heyta 的意义：滴答清单用"付费墙 + 共享配额"控制 AI 成本，
> 因为**推理账单是它自己出的**。heyta 走 BYOK / 自托管时，账单是用户的，
> 所以**不需要配额系统** —— 但代价是用户要自己配置（ADR-0005 §4）。

### 1.6 数据路径与隐私（本节是全文最关键的部分）

滴答清单**从不声称端到端加密**。它的 Security 页原文：

> "All the databases and servers are hosted by Amazon Web Services (AWS) in the United States...
> **User data, including task details, account information and payment details, are all stored and encrypted at rest.**"

**【本机实测】** 来源：`https://ticktick.com/security`

"encrypted at rest" = **服务端加密**（服务端持有密钥，能读明文），**不是 E2EE**。这与 heyta 的设计正好相反。

隐私政策（**2026-07-09 修订**）新增了专门的 **"Your AI Interactions"** 段。中文原文要点
**【本机实测】**（`https://dida365.com/privacy`；英文同 `https://ticktick.com/privacy`）：

| 原文要点 | 含义 |
|---|---|
| "为实现相关功能，我们使用了**第三方人工智能服务提供商**的技术能力" | 用第三方模型，**不是端侧** |
| "我们仅会处理您主动输入或选择的内容，例如**任务标题、任务详情、任务清单、标签信息、日期信息、您上传的音频或语音记录**，以及由此产生的转写文本" | 处理的是**任务内容本身** |
| "上述数据会被**传输至相应的人工智能服务**以生成与您的指令相关的内容或建议" | 🔴 **数据出境到第三方** |
| "**AI 助手基于您的指令，可能会访问您在滴答清单中已有的相关数据（例如任务、清单、习惯等）**" | 🔴 **AI 会读你的存量数据**，不只是当前那一条 |
| "我们不会将其用于任何与 AI 功能无关的目的，**也不会将这些数据用于训练模型**" | 不用于训练（这是承诺，不是技术保证） |
| "您可自主决定是否使用任何 AI 功能。**若您选择不使用，我们不会触发相关的信息收集、处理或向第三方传输**" | opt-in（这点是好的） |
| §三(一) 共享："获得您的明确授权后，我们会与其他方（**包括人工智能服务供应商**）共享您的个人信息" | AI 服务商被明列为共享对象类别 |
| 保存地域："我们将从中华人民共和国境内获得的信息**存放于中华人民共和国境内**"（中国版）；国际版在 **AWS 美国** | 跨境问题 |

**一处需要精确表述、不要夸大的地方**：同一份隐私政策在"同步任务数据"一节写着
> "以上信息仅用于您在各设备间同步清单、任务数据，**我们不会读取您的清单、任务内容**。"

这与 AI 一节并不矛盾 —— 它是**按目的限定**的：**同步**用途下不读取内容；
但用户**主动使用 AI** 时，内容会被传输给第三方 AI 服务。两句话可以同时为真。
真正的结论不是"它说谎"，而是：**在它的架构里，"读取你的任务内容"这件事在技术上一直可行，
AI 只是把它变成了产品功能。** heyta 的 E2EE 让这件事在技术上不可行 —— 这才是差异所在。

🔴 **未找到公开信息**：具体是哪家模型/服务商。官方只说 "third-party AI service providers"。
（调研过程中搜索曾带出 Doubao/DeepSeek 等说法，**经核对均为无关行业新闻，不作为证据**。）

### 1.7 产品设计细节（值得学的地方）

**【子任务核实】** 来源：`https://help.ticktick.com/articles/7503016104470511616`

| 项 | 做法 |
|---|---|
| 入口 | 移动端 `Settings → Tab Bar` 里打开 `AI`，然后从**底部导航栏**进入；桌面端 `头像 → Settings → Features`，从**侧边栏**进入，**另有右下角浮动按钮**，右键可 "Dock to Edge" |
| 平台限制 | **macOS 与 Web 可用；Windows 暂不支持**；不支持 iOS 15 / Android 8 / macOS 13.3 / Windows 10 或更早 |
| 会话 | 可保存 / 重命名 / 删除；有 `Suggested Actions`；回复可 `Retry`；已发送消息可 `Edit` 后重发 |
| 🔴 **确认流程** | **是「AI 建议 → 用户确认」**。官方范例 prompt 全部以 **"Wait for my confirmation before making any changes"** 结尾；对「整理清单」那条专门警告 "💡 Deleted content cannot be recovered. Please proceed with caution." |

🔴 **最后一行是对 heyta AI-2 设计判据的行业印证**：
"建议 → 确认 → 才落 op" 不是我们发明的保守做法，**头部产品也是这么做的**，
而且是写在官方 prompt 里的。

### 1.8 用户口碑（差评集中在隐私与质量）

⚠️ **取证限制**：Reddit 正文抓取被挡（www/old/api 均 403，redlib 镜像 429/Cloudflare），
以下**仅有搜索摘要，未经原文核对**，标为【未核实】。

| 摘要 | 来源 |
|---|---|
| "**TickTick is allowing an unknown, third-party, Chinese AI to look at all your data 'as needed'**. I love TickTick, but this AI feature is unwanted…" | r/ticktick `1vf76ps` |
| "**99% of comments are negative**. No really. In my opinion tick tick could listen to their users…" | r/ticktick `1sznn8o` |
| "I've found it **very slow in responding**, when asked for suggestions, **they were very basic**." | r/ticktick `1w0e9nc` |
| "They still make mistakes, **have usage limits, have topics that are censored/restricted**, and therefore are **not reliable**." | r/ticktick `1qgi8y1` |

**我的判断**：差评里有两类，性质完全不同 ——
① **质量类**（慢、建议平庸）：这是模型能力问题，会随时间改善；
② **隐私类**（"未知第三方读我全部数据"）：这是**架构问题，不会随时间改善**，而且**正是 heyta 可以正面回应的那一条**。

---

## 2. 与 heyta 的架构对照（为什么不能照抄）

| 维度 | 滴答清单 / TickTick | heyta | 后果 |
|---|---|---|---|
| 服务端能否读明文 | ✅ **能**（"encrypted at rest" = 服务端加密） | ❌ **不能**，且**无开关**（`server/src/sync/sync.routes.payload.ts:47` `violatesE2eeGate`） | **AI 的数据路径不能照抄** |
| AI 在哪跑 | 云端第三方服务商 | 只能客户端内 / 用户自有端点 | 见 ADR-0005 |
| AI 能否读存量数据 | ✅ 能（隐私政策明写会访问任务/清单/习惯） | ❌ 除非用户逐次授权（数据最小化） | AI-4（复盘）是受限分支 |
| AI 成本谁出 | 滴答清单（故有付费墙 + 月度配额） | 用户（BYOK / 自托管） | 不需要配额系统，但需要配置引导 |
| AI 的失败模式 | 隐私争议（已在发生） | 用户不配置 → AI 是灰的 | ADR-0005 §4 最大的产品代价 |

> **一句话**：滴答清单用"**信任**"换 AI 能力（用户数据上云，换开箱即用）；
> heyta 的结构决定了它只能用"**配置**"换 AI 能力（数据不出设备，换用户自己动手）。
> 这不是可以两全的取舍，必须选一边并说清楚。

---

## 3. E2EE / 本地优先下可用的推理架构

> ✅ 本节三个原本"未核实"的问题**已在本次调研中核实**（子任务报告见
> `research/local-first-e2ee-ai-2026-09.md`）。依赖数据是**本机实测**（§4）。
> 仍未核实的项已收进 §6，不要越读。

### 3.1 端侧推理（数据不出设备）—— 但 **RN 移动壳上基本走不通**

| 运行时 | 许可 | 活跃度 | 适用面 | heyta 能用吗 |
|---|---|---|---|---|
| `ggml-org/llama.cpp` | **MIT** | b11180 @ 2026-09-25 | 桌面/移动原生 | ✅ 桌面；移动需原生绑定 |
| `ollama/ollama` | **MIT** | v0.40.0 @ 2026-09-25 | 桌面/自托管服务 | ✅（2026-03-30 起 Apple Silicon 改用 MLX 后端） |
| `huggingface/transformers.js` | **Apache-2.0** | 4.3.0 @ 2026-09-16 | 浏览器（WebGPU/**WASM**） | ⚠️ 仅桌面浏览器 |
| `mlc-ai/web-llm` | **Apache-2.0** | v0.2.85 @ 2026-09-08 | 浏览器（WebGPU） | ⚠️ 仅桌面浏览器 |
| `withcatai/node-llama-cpp` | **MIT** | v3.21.1 @ 2026-09-12 | Node，**可在生成层强制 JSON schema** | ✅ 仅 Node 侧 |
| **LiteRT-LM**（Google） | **Apache-2.0** | 活跃 | Android / iOS 原生 | ⚠️ 需原生集成 |
| **Apple Foundation Models** | 系统框架（非开源） | iOS 26+ | iOS / macOS | ✅ 见 §3.1.2 |
| MediaPipe LLM Inference | Apache-2.0 | 🔴 **maintenance-only** | — | ❌ **官方要求迁移到 LiteRT-LM**，网上大量教程已过时 |

#### 3.1.1 🔴 Hermes 缺 `WebAssembly` —— 所有 WASM 基座的端侧方案在移动壳上直接出局

这不是推测，是**本仓库已实测过的故障**（AGENTS.md §7 陷阱 #26）：
`packages/sync-core` 的 Argon2id 来自 `hash-wasm`，真机上同步报
`WebAssembly is not supported in this environment!`，**且没有 polyfill 可装**。

**推论（对 AI 计划是硬约束）**：
`transformers.js` 与 `web-llm` 都建立在 WASM / WebGPU 之上 →
**在 React Native 移动壳上不可用**。移动端要做端侧推理，**只能走原生绑定**
（llama.cpp / LiteRT-LM 的 JSI 模块），这是**原生工程量**，不是"装个 npm 包"。

> 这也正好解释了为什么 ADR-0005 把 B（端侧）定为**渐进增强**而不是地基 ——
> 现在这个"保守"有了具体原因，不再是"未验证所以保守"。

#### 3.1.2 Apple Foundation Models：可用，但有边界

**【子任务核实】** 来源：`https://developer.apple.com/documentation/foundationmodels`

| 项 | 事实 |
|---|---|
| 版本要求 | **iOS 26.0+ / iPadOS 26.0+ / macOS 26.0+ / visionOS 26.0+ / watchOS 27.0+**，需 Apple Intelligence 兼容设备 |
| 是否仅端侧 | **不是**。框架统一访问**设备端模型**与 **Private Cloud Compute 模型**；"实体抽取"被官方点名为设备端模型的强项 |
| 上下文窗口 | 🔴 **硬上限 4096 token / session**；中文约 **1 字/token**（单次约 4000 字）。官方建议把大任务拆成多个 session |
| 结构化输出 | **`@Generable` 宏**让模型直接生成 Swift 数据结构实例 —— 这是"自然语言 → 结构化任务"在 Apple 端**最贴合的一等公民 API** |
| 模型规模 | AFM 3 Core = **3B dense**；AFM 3 Core Advanced = **20B 稀疏，按请求只激活 1–4B** |
| 2026 年最大变化 | WWDC26 通过 **`LanguageModelExecutor` 协议对任何 LLM 开放**（本地或服务端） |
| 许可 | 随 iOS SDK 分发（Apple 平台 SDK 许可，**非开源**）；调用系统框架不构成依赖许可证问题 |

🔴 **对 heyta 的含义**：`@Generable` 是一个**真正的捷径** —— 但它是 **Swift-only**。
ADR-0004 选了 React Native，所以**用不上**，除非为它写一个原生模块。
这与 §3.1.1 是同一个结论的两种表现：**移动端的端侧推理 = 原生工程量。**

#### 3.1.3 质量：格式够用，取值不够用

**【子任务核实】** SOB 基准（21 个模型 / 8B–358B，arXiv:2604.25359）：

- 所有模型 **JSON 合规率 >84%**，但**没有一个模型的 Value Accuracy（叶子值精确匹配）超过 80.4%**（文本域）；
  图像 67.2%，音频 23.7%。**"格式对"和"值对"是两件事** —— 后者才是"任务日期解析错了"的来源。
- **8B 级与前沿模型在文本抽取上只差约 2–3 个百分点**（Schematron-8B 0.832 vs GPT-5 0.849）——
  差距比预期小，但绝对水平都停在 ~83%。

🔴 **最有价值的是工程现实证据**（"Less Is More"，arXiv:2604.24636）：
一个生产 Android 应用最初让 **LLM 生成完整结构化 JSON**，最终**被迫退化**为
**"词表提供词，LLM 只写 3 条短提示，失败有确定性回退"**。其原话：

> **"最可靠的端侧 LLM 功能，是 LLM 做得最少的那个功能。"**

它记录的五类端侧故障里，两条特别具体：**模型持续把 JSON 包在 markdown code fence 里**、
**三次生成后因 KV cache 饱和而质量下降**。

### 3.2 BYOK —— 🔴 **Web 端在架构上站不住，只做原生壳**

这一条原本是"未验证的致命点"，**现在是已核实的结论**（ADR-0005 §3.2.1 是它的落地）。

| 端 | 结论 |
|---|---|
| **原生移动端** | ✅ **不受 CORS 约束，可直连**（社区广泛复述；未找到规范级来源） |
| **Web 端** | 🔴 **不允许用户粘贴第三方 API Key** —— 见下面三条 |

1. **Key 是 bearer 凭据，WebCrypto 救不了**：非导出密钥只防"把密钥带走"，**不防"用这个密钥发请求"**，任何 XSS 都能以用户身份调用。
2. **Anthropic 的官方 opt-in 头自己说明了问题**：浏览器直连需显式设
   `anthropic-dangerous-direct-browser-access: true`。**这个头的命名就是警告。**
3. **OpenAI 的 CORS 支持不稳定**：有用户报告 **Responses API 已停止发送 `Access-Control-Allow-Origin`**。
   做成产品功能 = 把可用性绑在别人的一个响应头上。

🔴 **DeepSeek / 豆包 / 通义是否允许浏览器直连：未找到公开信息。**
另有一个反向问题：**OpenAI 与 Anthropic 在网络边缘封锁中国大陆 IP**，无 header/DNS 技巧可绕过 ——
这对 heyta 的中文用户是实际约束，也是"中文用户默认推荐国产端点"的理由。

**推论（已写进 ADR-0005）**：Web 端唯一站得住的形态是**用户自己部署的端点**（CORS 自己可控），
也就是选项 D —— 它同时也是与"自建/自托管"产品形态最一致的那一个。
**这个限制不是砍功能，是把 Web 端引到更对的那条路上。**

**密钥存储**（原生端）：iOS Keychain `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`；
Android **DataStore + Tink + Keystore**（🔴 `EncryptedSharedPreferences` 已在 1.1.0 弃用，
网上教程大量过时；且 Keystore **不防 Frida 运行时钩子**）；桌面 Electron `safeStorage`。
参考先例：**Obsidian Copilot 把 Key 存在系统 Keychain 而不是 vault 的 `data.json`** —— 对 E2EE 应用这是正确做法。

### 3.3 用户自托管端点

与 heyta"自建/自托管"的产品形态**完全同构**：用户在自己的服务器上跑 Ollama/vLLM，
客户端连自己的 `baseUrl`。**OpenAI 兼容 `/v1/chat/completions` 已是事实标准**
（Ollama 2024-02 起、vLLM、llama.cpp、LM Studio、LocalAI、Qualcomm GenieX 全兼容）。

所以 **BYOK 与自托管在后端实现上是同一个 provider**（ADR-0005 §3.2），
且自托管是**唯一在 Web 端也成立的选项**（§3.2）。

**自托管网关的先例与许可红线**（**子任务核实**）：

| 项目 | 许可 | 能借鉴什么 |
|---|---|---|
| Nextcloud `llm2` | **MIT** ✅ | 唯一可用的一个；但它是 llama.cpp 的容器包装，对客户端无复用价值 |
| 🔴 Nextcloud `context_chat` / `context_chat_backend` / `context_agent` / `app_api` / `integration_openai` | **AGPL-3.0** | ❌ **一行都不能用**。架构思想可引用 |
| 🔴 Immich（智能搜索 = VectorChord + CLIP ONNX） | **AGPL-3.0** | ❌ |
| Home Assistant core | **Apache-2.0** ✅ | Ollama 集成配置项（URL / 可选 Key / context window / 允许控制哪些实体）是好的 UI 参考 |
| 🔴 Piper 本体 | **GPL-3.0** | ❌（Wyoming 包装层是 MIT，两者不同 —— **别搞混**） |
| 🔴 Zama Concrete ML | 仅限开发用途 | ❌ 不可生产 |

🔴 **Nextcloud 的架构前提是服务端能看到明文** —— RAG / 向量库只能放客户端，
这一点对 heyta 是根本性的，**不能照搬它的分层**。

### 3.4 机密计算 / 私有云推理 —— 🔴 **TEE 对软件层成立，对硬件层不成立**

| 事实 | 含义 |
|---|---|
| H100 上多数查询开销 <5%；B200 开启 CC 保留 96.1–98.2% 吞吐 | 性能不是问题 |
| 🔴 **DDRop（CCS 2026）**：约 **$159–200 的 DDR5 interposer 即可重放 Intel TDX / SGX / AMD SEV-SNP 的加密内存** | **威胁模型被打破** —— 便宜的物理攻击即可读出"机密"内存 |
| Apple PCC 机制（官方）：SEP 每次重启随机化数据卷密钥且不持久化、节点**无远程 shell / 不能开 Developer Mode**、RSA 盲签名（RFC 9474）一次性凭证 + OHTTP relay（RFC 9458）、镜像公开 + 只追加透明日志 | 是目前**最完整**的公开设计 |
| 🔴 独立批评：PCC 的信任根与运营方是**同一方**，"信任分离"评分为 ○，且**不能独立复现构建** | 这是它被质疑的核心 |
| **FHE / MPC 在 2026 年不可生产化**：HE 推理约 **0.2 tok/s** | 排除 |

**结论**：ADR-0005 把 E 列为"观望"是**有证据支撑的**，不是保守。

### 3.5 不做 AI，只做接口（MCP / 本地 API）—— **最硬的一条路**

**🔴 滴答清单自己就是这么起步的**（§1.4，2026-03 的 CLI / 2026-04 的 MCP）。

| 项 | 状态 |
|---|---|
| `modelcontextprotocol/typescript-sdk` | **1.30.1**，**Apache-2.0**，最后发版 **2026-09-23** ✅ 两道门通过（**本机实测**） |
| 许可证陷阱 | 该仓库 GitHub 的 license 字段是 **`NOASSERTION (Other)`** —— **照字段判断会误判为"无授权"**。已读 `LICENSE` 原文：MIT → Apache-2.0 过渡，新贡献 Apache-2.0、旧贡献仍 MIT，**两者都在白名单** |
| 治理 | 2025-12-09 Anthropic 把 MCP 捐给 Linux Foundation 的 **Agentic AI Foundation（AAIF）** |
| 🔴 **规范版本** | **2026-07-28 是最大一次破坏性修订**：移除 `initialize` 握手与 `Mcp-Session-Id`、新增 `server/discover`、强制 `Mcp-Method`/`Mcp-Name` 头、Tasks 降级为扩展、Roots/Sampling/Logging 弃用。**heyta 要按无状态规范设计，否则会返工** |

**同行已全部出货 MCP server**（**子任务核实**）：Todoist（`ai.todoist.net/mcp`，OAuth，官方 CLI token 存 OS 凭据管理器，**支持 `--read-only`**）、
Linear、Notion、Asana、Atlassian Rovo、ClickUp（**仅 OAuth，明确不支持 API key**）、滴答清单。

**🔴 安全风险（必须设计进去，不能事后补）**：
Tool Poisoning（Invariant Labs 2025-04）、**MCP Inspector 未认证 RCE（CVE-2025-49596，CVSS 9.4）**、
rug pull；**NSA 建议签名并校验 MCP 消息**。

**本地 API 的先例**（**子任务核实**）：
Anytype Local API（完全 localhost、完全离线、4 位挑战码换 bearer key、可生成/吊销多 key，
且官方**在页面顶部明确警告**"提供 API key 即授予 vault 访问权，请只用可信扩展"）、
Obsidian Local REST API（本地自签 HTTPS + API key，端口 27124 / host 127.0.0.1）。

> 🔴 **一个必须写明的威胁模型事实**：客户端解密后交给本地 API，
> **不改变服务端的可见性**，但**把风险下移到"本机其他进程与扩展"**。
> 公开表述："如果威胁模型包含被攻破的浏览器或恶意扩展，客户端侧加密提供不了任何保护。"
> RealTyme 的立场是"AI 助手可以在 E2EE 应用里工作，但**只有当模型在设备上、
> 与加密同一信任边界内、且没有任何明文离开设备**"；**Signal 总裁公开称 AI agent
> 对安全消息应用是"existential threat"**。
> ⚠️ **"E2EE + 客户端本地明文 API"的完整公开威胁模型文档：未找到公开信息。**
> 这一条 heyta 得自己写。

### 3.6 数据最小化 —— 🔴 **没有任何产品把它命名并系统宣传**

**【子任务核实】** 逐个查过之后，结论是：
**没有任何产品把"只给当前这一条"命名为数据最小化策略并系统宣传 —— 未找到公开信息。**
只有具体做法散落各处：

| 做法 | 出处 |
|---|---|
| Apple："识别为协助生成模型所必需的数据，而不要求 Apple 访问或存储个人数据" | Apple Intelligence 隐私页 |
| Google Magic Compose：改写只用 **1 条**草稿、建议用**前 20 条**消息，且不向 Google 发送 | Google Messages 支持页 |
| Home Assistant Ollama 集成：让用户选**暴露哪些实体**，官方建议 **<25 个** | HA 文档 |
| Nextcloud：工具白名单 + **Ethical AI Rating** 四档 | Nextcloud 文档 |
| 滴答清单：搜索关键字**仅本地，不同步云端** | 中文隐私政策 |

🔴 **这是 heyta 的机会**：把"每个能力分支只发送它当下需要的那一小段明文"**做成产品语言**
（ADR-0005 §3.4 的载荷构造表就是雏形），就拥有了一个**没人占据的位置**。

**出境披露的 UI 范式**（**子任务核实**）：
**Apple 的「Apple Intelligence & PCC Report」是目前最完整的范式** ——
设置 → 隐私与安全性 → 选时间范围 → **导出文件，列出所有离开设备并由 PCC 处理的请求**。
事前范式是 Nextcloud Ethical AI Rating。Shape of AI 把它抽象为可复用的 Consent 设计模式。
| 同行的做法 | Todoist / Notion / Linear 等均已有 MCP server（**未逐一核实**） |

**优点**：零隐私风险、零成本、零幻觉；**在没有 AI 的今天也有独立价值**（备份、自建看板、迁移）。
**代价**：不是"我们有 AI"；需要设计鉴权与权限范围。

---

## 4. 依赖核实（本机实测，2026-09-25）

按 AGENTS.md §3.1–3.2 的两道门核实。方法：`python3 research/tools/ghinfo.py` + `curl` 读 LICENSE 原文。

| 仓库 | 许可 | 最后提交 | 最新发布 | 结论 |
|---|---|---|---|---|
| `modelcontextprotocol/typescript-sdk` | Apache-2.0（字段为 NOASSERTION，已读原文） | 2026-09-23 | 1.30.1 @ 2026-09-23 | ✅ |
| `huggingface/transformers.js` | Apache-2.0 | 2026-09-23 | 4.3.0 @ 2026-09-16 | ✅ |
| `ggml-org/llama.cpp` | MIT | 2026-09-25 | b11180 @ 2026-09-25 | ✅ |
| `ollama/ollama` | MIT | 2026-09-24 | v0.40.0 @ 2026-09-25 | ✅ |
| `mlc-ai/web-llm` | Apache-2.0 | 2026-09-15 | v0.2.85 @ 2026-09-08 | ✅ |
| `withcatai/node-llama-cpp` | MIT | 2026-09-24 | v3.21.1 @ 2026-09-12 | ✅ |
| `openai/openai-node` | Apache-2.0 | 2026-09-25 | v7.23.0 @ 2026-09-23 | ✅（**但不建议引入**，见下） |
| `anthropics/anthropic-sdk-typescript` | MIT | 2026-09-22 | — | ✅（同上） |
| `frappe/Gantt` | MIT | 2026-03-05 | v1.0.3 @ 2025-02-03 | ✅（沿用 roadmap §3 结论） |

> 🔴 **全部通过两道门，但结论是"不要引入厂商 SDK"**：Ollama、vLLM、DeepSeek、豆包、OpenRouter
> 以及 OpenAI/Anthropic 本身**都提供 OpenAI 兼容的 `/chat/completions`**。
> 一个 `fetch` + 已有的 `zod` 就够，每多一个 SDK 就多一份许可证登记、升级负担与体积。
> **能力分支不得自行引入 SDK**（已写进 ADR-0005 §3.2）。

---

## 5. 对 5 条功能设想的证据支持

（裁决与理由见 [AI 能力分支计划](../plans/ai-capability-branches.md) §5，此处只给证据）

| 设想 | 证据 | 结论 |
|---|---|---|
| **AI 拆解任务** | 滴答清单 **AI Voice Add 官方描述**："一句话含多件事会**自动拆成多条任务**"；其 MCP 的批量写操作**每次最多 20 个** | ✅ 方向被验证；**批量上限**是同行解法 |
| **优先级排序** | 滴答清单 2026-01 的「推荐任务」是**规则式**（基于创建时间/改期历史/临近截止日），**不是大模型** | ⚠️ 同行在这一项上**刻意没用 AI** |
| **自动生成甘特图** | 🔴 滴答清单官网原文：Timeline View 是 "**a lighter project management tool compared to Gantt charts**"，**依赖任务 duration**；且 **Task Duration 是 Premium 功能**、**Timeline View 也是 Premium**。→ **滴答清单没有甘特图，它主动选择了更轻的时间线** | ❌ 不做甘特；**时间线需要 duration 字段**，而 heyta 的 `Task` **没有** |
| **Time Left 式倒计时** | 🔴 **更正（见 §5.2）**：滴答清单**有两种**东西 —— ① **倒数纪念日**（独立实体，Free 5 个 / Premium 299 个）；② **任务列表的 countdown mode**：视图可在 `Task time` ↔ `Countdown Time` 之间切换，把 "Due Wednesday" 变成 "还剩 2 天"（Google Play **4.6★ / 164,748 条**，ZDNET 专文推荐）**这就是任务级倒计时** | ⚠️ **原判"不是追平，是差异化"过强，已更正** —— 任务级倒计时**不是空白**。真正的差异只在**形态**：heyta 想做的 `createdAt → dueDate` **递减进度条**不是它做的（它只显示剩余时间，不显示进度）。**而这个形态恰好是有反面证据的那个**（见 §5.2） |
| **API 调用（回传云数据）** | 🔴 滴答清单的做法是 **MCP + CLI（把 AI 放外面）**；而"回传云数据"在 heyta 等于放弃 E2EE（§1.6 / §2） | ⚠️ **改判**：导出 / 本地 API / MCP / 用户自有服务器 —— **不做官方云中转**<br>🔴 **勘误（2026-09-26）**：末句"不做官方云中转"**已作废**。产品负责人确认 heyta **会**提供云端统一 AI 服务（订阅制，后续 MaaS）。<br>本行**关于数据可携带性**的结论仍然成立（导出/本地 API/MCP/自有端点）；作废的只是把"托管 AI"也一并否掉。见 [ADR-0013](../adr/0013-cloud-ai-and-maas.md)。 |

### 5.1 竞品 AI 排程的成败账（**这是 AI-3 缺的那份证据**）

> 来源：`research/ai-competitors/horizontal-validated-autosched.md`（16 个产品，含 Motion / Reclaim /
> Clockwise / Sunsama / SkedPal / FlowSavvy / Amie / Todoist 等）。
> ⚠️ 该调研**全程无留存数据**（Reddit / Trustpilot / G2 全反爬），
> 结论建立在关停公告、融资公告、评分聚合与用户自述上 —— **引用时必须带这个限制**。

#### 5.1.1 三个自动排程产品的实际结局

🔴 **最重要的发现**：**没有任何一个自动排程产品是"因为用户嫌弃所以下线该功能"的。**
实际退出形态是另外三种：

| 形态 | 案例 |
|---|---|
| **A. 整体关停 + 团队被吸收（acquihire）** | **Clockwise** —— 唯一有硬数字的死亡案例 |
| **B. 被大厂收购后继续运营，但用户预期崩了** | **Reclaim.ai**（2024-08 被 Dropbox 收购，未披露金额） |
| **C. 主动拒绝做全自动**（"我们不做"也是结局） | **Sunsama** |

#### 5.1.2 最强的一条负面证据，来自竞品创始人

**Sunsama 联创 Travis Meyer 在公开 roadmap 上的原话**（本次调研质量最高的一手材料）：

> "When designing our own version of auto-scheduling, we consistently heard feedback from folks
> who had tried Motion that Motion felt too opinionated and proactive when it came to scheduling things,
> and **they ended up spending more time correcting automated scheduling decisions as a result**.
> ... **We also value being intentional with your time, and think leaning too hard into automation
> takes away from that.** We likely won't add a 'automatically schedule all tasks to calendar' button."

来源：`https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar`

🔥 **这条为什么重要**：它**不是用户骂街，是同行创始人复述自己听到的用户反馈**，
把失败模式说成了一句可检验的话：**纠正成本 > 规划成本**。
而且它顺带证明 **Sunsama 做了"单任务排入"却公开拒绝"全量自动"** ——
**"轻触"是被验证过的产品形态，不是妥协。**

#### 5.1.3 ⚠️ 反证同样真实，不能只收集差评

正面证据集中在**两类人**：

| 人群 | 原话 | 来源 |
|---|---|---|
| **ADHD / 时间盲** | "Personally the main reason why I'm sticking to autoscheduling is that **it's the only way for me to stick to timeblocking**." | HN / r/productivity |
| **管理者 / 团队场景** | "Everyone at my new job uses Clockwise, which will rearrange calendars across the org to maximize focus time for everyone... The jump to my productivity is huge." | HN `madrox` |

🔴 **最有商业价值的一条分界线**：
**正面证据集中在 ADHD / 时间盲人群与管理者（排的是别人的会）；
负面证据集中在个人贡献者的深度工作场景。**
→ **如果 heyta 要做排程，人群定位比算法精度更重要。**

#### 5.1.4 已被验证能赢回信任的 12 个设计模式（都有先例）

| # | 模式 | 先例 |
|---|---|---|
| 1 | **预览 / 逐条确认，不做全局一键应用** | Sunsama 只做"按 `X` 单任务排入"，**公开拒绝** auto-schedule-all 按钮 |
| 2 | **Lock / Pin：用户放下的位置不可被动** | Sunsama roadmap 该请求 **53+ 投票者**，合并了 **4 条**重复请求 |
| 3 | **用户改动优先于系统决策** | Reclaim 承诺 "the system adapts to your changes **instead of overriding them**" |
| 4 | **可排程窗口 / 规则**（默认不排到工作时间外） | Sunsama Settings > Schedules；Reclaim Working/Meeting/Personal Hours |
| 5 | **把"人的需求"做成一等对象**（午餐、缓冲、通勤、无会日） | Reclaim 的 Lunch Habit / Buffer Time / Travel Time / No-Meeting Days |
| 6 | **不静默拆分长任务，给显式开关** | Sunsama `Shift`+`X` 禁止拆分；Motion 可配 chunking 与 minimum chunk duration |
| 7 | **超额时提问，而不是替用户决定** | Sunsama 给三个选项：Schedule anyway / another day / Defer |
| 8 | **优先级由用户设定，AI 只决定"谁让位"** | Reclaim "AI priority levels" —— 决定 *what moves and what stays protected* |
| 9 | **可解释性**（为什么排在这里） | ⚠️ 反向先例：SkedPal 因**不可解释**被持续吐槽 |
| 10 | **不碰不是它创建的东西** | Sunsama 不考虑 declined / marked-free 的事件 |
| 11 | **不把 AI 产物灌进用户的日历** | ⚠️ 用户诉求明确，但**未找到任何产品实现** —— 见下 |
| 12 | **把"重排视野"当一等参数** | Reclaim 用 12 周 vs Clockwise 3 周作为卖点 |

#### 5.1.5 🔴 两处**没有先例**的空白（机会）

调研明确列出"未找到先例"的两条：

1. **Undo / 撤销自动重排** —— 没有任何产品公开文档描述"一键撤销上一次自动重排"。
   最接近的只有 Reclaim 的"系统适配你的手动改动"。
2. **排程解释 UI** —— 没有任何产品公开"为什么这个任务排在这个时段"的可读解释。

🔴 **还有第三条，且对 heyta 天然契合**：
**"任务留在 App 内，只有时间块进日历"** —— 用户诉求明确（⚠️ r/reclaim_ai），
**但未找到任何产品实现**。对**本地优先**的 heyta 而言，这几乎是白送的差异点：
它既是隐私立场，也是产品形态。

> **结论（已写进计划）**：AI-3 **不该把"全自动排程"当卖点**。
> 若要做，**先做"锁"和"预览"，而不是"自动"** —— 实现成本远低于排程算法，
> 且"锁"是**已被证实、未被满足**的需求（53+ 票、4 条重复请求）。
> 优先级排序应为：**捕获 > 拆解 > 优先级（用户设定、AI 执行）> 排程（有条件）> 转录 > 摘要/问答/习惯教练**。

#### 5.1.6 ⚠️ 用"锁"要注意一个具体陷阱

调研 §11.8 给了一批"不要做的事"，其中一条**直接冲着"先做 Lock/Pin"这个建议来**：

> 🔴 **不要用布尔锁 + 超时。** 实测：**Motion 的 fixed 锁有 60 分钟超时** ——
> 用户以为钉住了，系统仍可能在 60 分钟后挪走它。

→ **heyta 若做 Lock，语义必须是"永久且明确"，不能是可过期的状态**。
这与仓库既有纪律同形：**不要用一个会被静默改写的东西表达用户的明确意图**
（对照 AGENTS.md §7 #19："墙上时钟不能裁决因果顺序"）。

其余"不要做的事"（每条都有反面样本，**子任务核实**）：

| 不要 | 反面样本 |
|---|---|
| 不要把"AI 搜索你自己的任务"当卖点 | 判定为 **demo 噱头** —— **零用户证词**，厂商自己给的用途又绕回排程 |
| 不要让 AI 产物灌进用户的日历主视图 | Reclaim 差评："I have 300 tasks that reclaim.ai created and now I cannot delete them… it is a mess!!!" |
| 不要静默拆分长任务 | Sunsama 默认把 >1 小时任务"积极拆分"，需 `Shift+X` 才能阻止 |
| 不要写"AI 不用于训练"却在不同页面自相矛盾 | Todoist 的 Task Assist FAQ 仍称 OpenAI 可能用 query 改进模型，而当前 subprocessor 列表**没有 OpenAI** |
| 不要把 AI 捆绑进涨价 | Superlist 最响的抱怨是 "**AI features that no one asked for**"；Notion 有 "150% price increase" 与 credit 反弹 |

#### 5.2 🔴 **Time Left 式倒计时：证据不支持"优先做"，应降级为"待验证的视图假设"**

> 来源：`docs/research/ai-feature-landscape.md` §8（**这是本次调研里我原判断被推翻的一处**）。

**① 先更正一个我写错的事实。** 我在初稿里写"滴答清单的 Countdown 是倒数纪念日，
**不是任务级进度条** → 这是差异化机会，不是追平"。**这个说法不完整。**

滴答清单其实**有两种**：

| | 是什么 |
|---|---|
| **倒数纪念日**（Countdown） | 独立实体，Free 5 个 / Premium 299 个 |
| 🔴 **任务列表的 countdown mode** | **视图可在 `Task time` ↔ `Countdown Time` 之间切换**，把 "Due Wednesday" 变成 "还剩 2 天"。Google Play **4.6★ / 164,748 条评论**；ZDNET 专文《Why 'countdown mode' is the task manager feature I can't live without》 |

→ **任务级倒计时不是空白，滴答清单有，而且这是整个品类唯一有规模证据的成功案例。**
原判"不是追平，是差异化"**过强，已更正**。

**② 独立产品做这个形态的全部没有规模**（**子任务核实**）：

| 产品 | 结局 |
|---|---|
| `Time Left - Quickly create one-time reminders`（2014-06 上架，钟面式任务管理器） | 🔴 **上架后再未更新，2 条评分。已死 —— 该形态最早的一次尝试，也是失败案例** |
| **Deadliner**（"Each task displays a countdown… as well as a circular progress bar"） | 存活 6 年，但美区**只有 2 条评分**（3.0） |
| Deadline App / Griply / Deadline Bar | 63 / 197 / **0** 条评分 |

→ **结论：大厂只把它当一个视图开关；独立产品重注这个形态的全部没做起来。**

**③ 🔴 反面证据是硬的，而且正对着"递减进度条"这个形态**：

| 证据 | 内容 |
|---|---|
| 🔴 **32 个实验的元分析** | 当"前期投入感高"时，**进度条反而降低完成率**。**而"从 createdAt 到 dueDate 线性匀速递减"正是这个形状** |
| 🔴 **Bisin & Hyndman (NBER w19874)** | 人们**强烈想要** self-imposed deadline，**但 deadline 并没有提高完成率** |
| 🔴 **Bonezzi et al. (2011)** | 动机随进度呈 **U 型**，**中点（50%）是动机最低点** —— 而倒计时条恰好把注意力压在中段 |
| ⚠️ 框架效应 | "剩余"vs"已完成"会改变动机方向 |
| ✅ **最大的缺口** | **找不到任何 RCT / A-B 检验"给任务加倒计时条 → 完成率提升"** |

支持性机制证据确实存在（时间折扣、目标梯度效应、禀赋进度、Zeigarnik 效应、
ADHD 视觉计时器、以及用户原话 "seeing 3 weeks left motivates me more than a date out on a grid"），
**但它们要么停留在机制层，要么场景完全不同**（洗车集点卡、问卷进度条）。

**④ 因此修正后的裁决**：

| 原裁决 | 修正后 |
|---|---|
| ✅ 采纳，**且优先做**，"差异化机会，不是追平" | ⚠️ **采纳为"可开关的视图"，但降级：它是待验证的 UI 假设，不是已被验证的机制**。<br>① **成本低、可回退、可 A/B** → 仍然该做；<br>② 🔴 **不得对外宣称它能治拖延**；<br>③ 🔴 **必须先定 A/B 指标**（否则无法知道它是否有害）；<br>④ 🔴 **不做成核心机制**，也不因为"用户提了"就跳过验证 |

> 这一条正好示范了本仓库的评审顺序（CONTRIBUTING.md：先问"该不该做"，再问"做得对不对"）：
> **用户提的需求 ≠ 已验证的需求。** 而"用户提了、成本又低"正是最容易跳过验证的组合。

---

## 6. 取证限制与未核实项

**必须写明，因为 ADR-0005 的结论有一部分建立在这些未知之上。**
✅ 表示**本次已核实**（从 §3 移除）。

| # | 状态 | 项 | 影响 |
|---|---|---|---|
| 1 | ✅ **已核实** | **浏览器/移动端直连第三方 LLM API 的 CORS 现实** | 结论：原生可直连、**Web 端架构上站不住**（XSS + bearer 凭据）→ 已落成 ADR-0005 §3.2.1 的硬约束 |
| 2 | ✅ **已核实** | **端侧小模型"中文→结构化字段"的质量** | 结论：格式 >84% 合规、**取值 ≤80.4%**；工程上必须"LLM 做得最少 + 确定性回退"（ADR-0005 §3.3） |
| 3 | ✅ **已核实** | **RN/Hermes 上端侧推理是否可用** | 结论：🔴 **WASM 基座全部出局**（AGENTS.md §7 #26 实测 Hermes 无 `WebAssembly`）→ 移动端端侧推理 = **原生工程量** |
| 4 | ✅ **已核实** | **Apple Foundation Models 的边界** | 结论：iOS 26+、**4096 token 硬上限**、`@Generable` 是捷径但 **Swift-only** → RN 用不上 |
| 5 | 🟡 未找到 | **滴答清单具体用哪家模型/服务商** | 官方从未披露。**未找到公开信息**（搜索命中的 Doubao/DeepSeek 说法**经核对均为无关行业新闻，不作为证据**） |
| 6 | 🟡 未找到 | **滴答清单 AI 配额的具体数字** | 官方未公开。**未找到公开信息** |
| 7 | ⚠️ 弱证据 | **Reddit / 知乎 / 小红书正文未核对**（403 / Cloudflare / JS 渲染），§1.8 全部为搜索摘要 | 用户口碑部分的结论强度较弱 |
| 8 | ✅ **已产出** | **竞品 AI 横向格局**（16 个产品） | 见 §5.1 与 §6.1。**AI-3 的证据已补齐**，结论是"条件极苛刻、不许把全自动当卖点" |

### 6.1 ✅ 竞品横向格局：**已产出**（产出物与方法论限制）

**2026-09-25**：竞品 AI 横向调研**已完成**，合并报告在
`docs/research/ai-feature-landscape.md`（13 个产品 / 374 条内联来源 / 25 处「未找到公开信息」），
逐产品底稿 8 份 + 原始快照在 `research/ai-competitors/`：

| 文件 | 覆盖 |
|---|---|
| ⭐ `docs/research/ai-feature-landscape.md` | **合并报告**（结论层） |
| `research/ai-competitors/horizontal-validated-autosched.md` | **AI 排程的成败账** —— AI-3 缺的那份证据，结论见 §5.1 |
| `research/ai-competitors/todoist.md` | Todoist Assist（Email / Filter / Task Assist）+ Ramble + Automations |
| `research/ai-competitors/motion-reclaim.md` | Motion（$550M 估值 / credit 计费）、Reclaim.ai（被 Dropbox 收购） |
| `research/ai-competitors/akiflow-sunsama.md` · `superlist-notion.md` · `feishu-apple.md` | Akiflow / Sunsama / Superlist / Notion / 飞书 / Apple 提醒事项 |
| `research/ai-competitors/google-anydo-marvin-routine.md` | Google Tasks / Any.do / Marvin / Routine |
| `research/ai-competitors/time-visualization-apps.md` | **时间可视化类 App** —— §5.2 的直接证据 |
| `research/ai-competitors/_lead-verified.md` | 主调研者**亲自复核**的一手事实（交叉验证用） |

**排查过程本身也值得记录**：调研期间 `web_search`（Tavily）**全程 HTTP 432 不可用**，
`anysearch` 当日额度中途耗尽，Reddit / Trustpilot / G2 / Product Hunt **全部反爬**。
最终靠 `web_fetch` 抓已知 URL + 沙箱内 `curl` 直连完成。
🔴 **后果**：所有用户口碑类结论**只能来自搜索索引片段，无法复核上下文** ——
横向调研自己也把这条写进了方法论限制。

**三条与本报告路线一致的线索**（**子任务核实**）：
- **Todoist** 的 AI **明确跑在自家基础设施上**（"We do not send your data directly to OpenAI.
  All processing flows through Todoist's secure infrastructure."，模型来自 AWS Bedrock 与 GCP Vertex AI）；
  覆盖面比滴答清单宽（Email / Filter / Task Assist + Ramble + Automations）。
- **Things 3** 的自然语言输入**至今是规则式**（官方支持文档只讲 When/Deadline 写法约定，未提 AI）。
- **ClickUp MCP 仅 OAuth，明确不支持 API key** —— 对 heyta AI-5 的鉴权设计是直接先例。

🔴 **但要注意一个反向事实**：**Todoist 的 AI 是"服务端处理"模型** ——
它同样**不适用于 heyta 的 E2EE 约束**。横向调研给出的**功能形态可以学，
数据路径依然一条都不能学**（与 §2 的结论完全一致）。

### 6.2 ✅ 缺口已补齐（2026-09-26 勘误）：E2EE 产品自己怎么处理 AI

> 🔴 **本节原结论已被后续调研推翻，请以下面这段为准。**
>
> 本节原文说「Standard Notes / Obsidian / Bear / Anytype —— **四家零材料**」，
> 并据此判断「heyta 在这条路上**没有可对标的公开先例**，必须自己把安全和威胁模型写出来」。
>
> **这两条都不再成立。** 后续定向调研已落盘：
> [`e2ee-apps-ai.md`](e2ee-apps-ai.md)（1096 行，**192 处 ✅ 抓到官方全文**），
> 四家**全部取得官方一手材料**，且威胁模型文档**找到三份**（Joplin / Bear / Anytype）。
>
> **新结论**：heyta **有**可直接借鉴的公开先例，而且不止一家：
> - **Bear**（最贴近）：本地 CLI + MCP，且 🔴「**Encrypted notes stay encrypted.
>   They can be listed, but never read or modified by any of these tools**」。
> - **Joplin**（最可执行）：唯一"核心自带 AI **且**本身是 E2EE **且**把取舍写进文档"的样本 ——
>   **双开关默认关**、`.local` 按远程处理（mDNS 理由）、MCP 11 工具默认全关、加密笔记直接拒绝 AI。
> - **Anytype / Standard Notes**：Local API / Home Server，均有官方文档。
>
> 🔴 **而"厂商托管 AI + 维持 E2EE"在所有样本中一个都不存在** ——
> Proton Lumo 是唯一正面回答此问的厂商，它的回答是**做不到**，并主动把该路径改名为 U2L 加密。
> 这条是 [ADR-0006](../adr/0006-supply-modes.md) §2.1 的核心证据。
>
> **本节以下原文保留作历史记录，但其中的"零材料""没有先例"判断请勿再引用。**
> （保留而非删除，是因为"一次子调研失败导致结论被写死"这件事本身值得留痕：
> 它当时被写成了**结构性判断**，而不是**待补事项**。）

**以下为原文（已被上面勘误取代）**：

横向调研把这条列为**本次调研最大的缺口**（`docs/research/ai-feature-landscape.md` §7.1）：

> ❌ **Standard Notes / Obsidian / Bear / Anytype —— 四家零材料。**
> 即"**E2EE（或本地优先）产品怎么处理 AI**"这个横向问题**基本未答** ——
> 负责该部分的子调研未落盘，检索工具已耗尽无法补做。

🔴 **为什么这条对本项目最重要**：**heyta 就是 E2EE 产品**。
上面全部结论（滴答清单、Todoist、Motion…）讲的是**服务端能看到明文的公司**怎么做 AI ——
**它们的数据路径对 heyta 全部不可用**（§2）。
而我们真正需要对照的样本，恰恰是**和我们约束相同的那四家**，现在**一家都没取到**。

**已知的零星线索**（不足以填补）：
- **Obsidian Copilot 把 API Key 存在系统 Keychain 而不是 vault 的 `data.json`** ——
  对 E2EE 应用这是正确做法（否则密钥会跟着被同步的密文一起走）。§3.2 已引用。
- 🔴 **但 Obsidian Copilot 自身在 heyta 的黑名单上**（许可证不合规），**只能学做法、不能引代码**。

**因此这条必须另行定向重跑**，且应排在所有 AI 调研补做项的最前面。

> ✅ **威胁模型缺口也已补齐（2026-09-26 勘误）**：后续调研找到 **三份**公开的
> "E2EE + 客户端本地明文 API" 威胁模型文档 —— **Joplin 的 MCP / 本地 AI 文档**、
> **Bear 的 CLI Privacy 声明**、**Anytype 的 Local API 安全警告**。
> 详见 [`e2ee-apps-ai.md`](e2ee-apps-ai.md)。
>
> 🔴 **但仍有一条真实的新风险，且它比"没有先例"更值得注意**：
> 端侧 AI **必然产生明文派生物** —— Anytype 自曝「**Indexes stay local and unencrypted**」，
> Bear 即使开启 ADP 也「**notes' titles and tags' names remain unencrypted**」。
> 且**"只对非加密元数据做 AI"这条路在样本中无任何先例**。
> 所以"端侧"不等于"零风险"，heyta 若做端侧必须提前承认本机索引是明文。

> **以下为原文（已被上面勘误取代）**：
> 另一条同样重要的缺口：**"E2EE + 客户端本地明文 API"的完整公开威胁模型文档未找到**
> （§3.5 与 ADR-0005 §5.7）—— 这两条缺口是同一个问题的两面。

### 6.3 📌 一条对本项目有利的横向结论：**端侧 AI 在这个品类是空的**

横向调研 §5.1 的结论（**子任务核实**）：

> **13 个产品中，没有任何一家有端侧 AI 推理的证据。** 唯一例外是**平台方**
> （Apple、Google）在系统层做端侧模型，而它们的任务应用只是受益者。

具体：Todoist 官方原文 *"Todoist runs all AI functionality on secure infrastructure…"*，
Ramble *"only works with an internet connection."*；Motion 纯云（subprocessor 列 OpenAI）；
Reclaim 纯云；Akiflow 多云厂商（Anthropic/OpenAI/Google/Groq/ElevenLabs）；
Notion 全云（客户端只做**音频采集**，不是端侧推理）；**飞书全云且不支持本地/海外模型自托管**。

**调研给的可检验解释**：这一品类的 AI 都发生在**服务端可计量**的地方，
因为**服务端才能按 credit / 点数 / 额度收费** —— **端侧推理无法计费**。
Apple 免费是因为它卖硬件；任务应用没有硬件可卖。

**推论（与本项目高度相关）**：
**「端侧 AI」在任务管理里的现实落点不是"更强的模型"，而是"不上传也能用的捕获与解析"** ——
这恰好是本地优先产品能独占的位置。

> ⚠️ **但不要过度乐观**：这与 §3.1.1 的坏消息并存 ——
> 端侧位置是空的，**部分原因是它在移动端（RN/Hermes）技术上也难做**。
> "没人做"同时是机会和难度信号，**不能只读成机会**。

---

## 7. 来源清单

**一手页面（本次直接抓取，2026-09-25）**
- https://ticktick.com/features · https://dida365.com/features
- https://ticktick.com/upgrade · https://dida365.com/upgrade
- https://ticktick.com/privacy · https://dida365.com/privacy （2026-07-09 修订）
- https://ticktick.com/security
- https://ticktick.com/public/changelog/en.html · https://www.dida365.com/public/changelog/zh.html
- https://help.ticktick.com/external/articles/7505896563223298048 （2025 归档）

**官方帮助中心（AI 栏目）**
- https://help.ticktick.com/articles/7444685542580551680 （AI Features 目录）
- https://help.ticktick.com/articles/7503016104470511616 （AI Assistant）
- https://help.ticktick.com/articles/7444677039392555008 （AI Voice Add）
- https://help.ticktick.com/articles/7444682584526684160 （录音转写与总结）
- https://help.ticktick.com/articles/7438129581631995904 （TickTick MCP）
- https://help.ticktick.com/articles/7465251130025443328 （TickTick CLI）
- https://help.ticktick.com/articles/7475477082185662464 （AI Use Cases）

**其他**
- https://itunes.apple.com/lookup?id=626144601&country=us （App Store 版本 8.2.12 @ 2026-09-19）
- https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/
- r/ticktick 帖 `1vf76ps` / `1sznn8o` / `1w0e9nc` / `1qgi8y1`（**仅搜索摘要，正文未核对**）

**本机实测**
- `python3 research/tools/ghinfo.py`（仓库活跃度与许可证字段）
- `curl` 读各仓库 `LICENSE` 原文（含 MCP SDK 的 NOASSERTION 澄清）
- `server/src/sync/sync.routes.payload.ts`（heyta 的 E2EE 门禁）
- `packages/domain/src/entities.ts`（`Task` 字段清单：**无 `parentId` / 无 `startDate` / 无 duration**）
- `AGENTS.md` §7 陷阱 #26（Hermes 缺 `WebAssembly`，真机实测）

**原始调研材料**（`research/` = 归档原料，不是产品文档；本文件是它们的结论层）

| 文件 | 内容 |
|---|---|
| `research/ai-competitors/ticktick-ai-2026-09-25.md` | 滴答清单 AI 全量取证（含原始 HTML 解析、12 项能力逐项确认表、完整 URL 清单） |
| `research/local-first-e2ee-ai-2026-09.md` | E2EE / 本地优先应用的 AI 方案（7 板块 + 推荐路线 + 许可证速查 + 缺口清单） |
| `research/privacy-enhancing-cloud-llm-inference-2026.md` | 隐私增强云端推理（PCC / TEE / FHE） |
| `research/mcp-and-byok-2026-09.md` | MCP 规范演进与 BYOK 密钥存储 |
