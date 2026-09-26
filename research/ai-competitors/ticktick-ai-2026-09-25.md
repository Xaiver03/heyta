# 滴答清单 / TickTick / Dida365 —— AI 功能调研报告

> **调研日期**：2026-09-25（本机 `date` 实测 UTC 15:19 / CST 23:19）
> **取证方式**：`anysearch` CLI（Tavily `web_search` 当日 HTTP 432 不可用）+ 沙箱内 `curl` 直连抓原始 HTML + iTunes Lookup API。
> **取证限制（必须随报告一起引用）**：
> 1. **Reddit 正文抓不到**（`www.reddit.com` / `old.reddit.com` / `api.reddit.com` 全部 403，redlib 镜像 429 或 Cloudflare 拦截），Reddit 相关结论**仅来自搜索引擎摘要**，已在正文逐条标注。
> 2. 知乎正文 403，Instagram 正文为 JS 渲染，两者**只有摘要**。
> 3. `help.ticktick.com` 的 What's New 页月-日**不带年份**；年份是按「该页 2025 年条目已被单独归档到 `Updates in 2025` 页」推断的，推断依据已在第 2 节写明。
> 4. 凡官方未公开的，本文一律写「未找到公开信息」，不做推测。

---

## 0. TL;DR（可直接引用的 10 条硬结论）

1. **滴答清单 2025 年完全没有 AI 功能**；全部 AI 能力集中在 2026 年上线。证据：官方 `Updates in 2025` 归档页通篇零 AI 条目。`[来源: https://help.ticktick.com/external/articles/7505896563223298048]`
2. **AI 功能是 Premium / 高级会员专属，免费用户不可用**。证据：定价对比表原始 HTML 中 `AI Features` 行为 Free `✗`(dash 图标) / Premium `✓`(check 图标)；中文站同一行为「AI 功能」Free `✗` / Premium `✓`。`[来源: https://ticktick.com/upgrade?language=en_us]` `[来源: https://dida365.com/upgrade?language=zh_CN]`
3. 定价：国际版 **US$49.99/年**，中国版 **￥139/年**。`[来源: https://ticktick.com/upgrade?language=en_us]` `[来源: https://dida365.com/upgrade?language=zh_CN]`
4. **AI 不单独收费**，走**跨功能共享的月度额度**（AI quota），配额耗尽当月停用、次月重置；**具体额度数字未找到公开信息**。`[来源: https://help.ticktick.com/articles/7503016104470511616]`
5. 官方 AI 功能共 **6 篇帮助中心文章**：AI Assistant / AI Voice Add / Transcribe & Summarize Recordings / TickTick MCP / TickTick CLI / TickTick × AI Use Cases。`[来源: https://help.ticktick.com/articles/7444685542580551680]`
6. **技术路线是「云端调用第三方 AI 服务商」，不是端侧、不是自研模型**。隐私政策原文承认 `we utilize third-party AI service providers`；**具体是哪家/哪个模型，官方从未披露**。`[来源: https://ticktick.com/privacy?language=en_us]`
7. **TickTick 不是 E2EE**：数据托管在**美国 AWS**，`stored and encrypted at rest`（服务端加密，密钥在服务商手上）。`[来源: https://ticktick.com/security]`
8. **AI Assistant 需要用户确认才执行**：官方示例提示词全部以 "First, show me ... **Wait for my confirmation before making any changes**" 结尾。`[来源: https://help.ticktick.com/articles/7503016104470511616]`
9. **有 MCP（`https://mcp.ticktick.com`）与 CLI（`@ticktick/ticktick-cli`，npm 首发 2026-03-11）**，这是滴答清单对外暴露 AI Agent 能力的两条正式通路。`[来源: https://help.ticktick.com/articles/7438129581631995904]` `[来源: https://registry.npmjs.org/@ticktick/ticktick-cli]`
10. **用户口碑以负面为主**：第三方 AI 处理数据的隐私担忧、响应慢、建议太基础、识别不准、额度限制、内容被审查。`[来源: https://www.reddit.com/r/ticktick/comments/1vf76ps/official_ai_assistant_in_ticktick_beta/]` `[来源: https://www.reddit.com/r/ticktick/comments/1w0e9nc/our_ai_assistant_is_now_available_in_beta/]`

---

## 1. AI 功能清单

官方「🤖️ AI Features」栏目把 AI 分成**站内**与**站外**两组。
`[来源: https://help.ticktick.com/articles/7444685542580551680]` `[中文同页: https://help.dida365.com/articles/7444671678778441728]`

### 1.1 站内（In TickTick）

#### ① AI Assistant（AI 助手）

| 维度 | 内容 |
|---|---|
| 做什么 | 对话式助手。官方定义："AI Assistant can use information from your tasks, habits, focus records, and more to help you set goals, break down tasks, plan your schedule, and review your progress"。即**目标拆解 / 任务创建 / 清单重组 / 日程规划 / 复盘总结**五类 |
| 交互形态 | **对话式**（聊天）+ 建议式（`Suggested Actions`）。会话可保存、重命名、删除；回复可 `Retry`；已发送消息可 `Edit` 后重发 |
| 入口（移动端） | `Settings → Tab Bar` → 找到 `AI` → 点 `+` 启用 → 从**底部导航栏**进入 |
| 入口（桌面端） | 点头像 → `Settings → Features` → 打开 `AI` → 从**侧边栏**进入；**另有右下角浮动按钮**，右键可 `Dock to Edge`（贴边隐藏） |
| 平台限制 | 英文帮助页明确：**"Currently available on macOS and Web. AI Assistant is not yet supported on Windows."** 不支持 iOS 15 或更早 / Android 8 或更早 / macOS 13.3 或更早 / Windows 10 或更早 |
| 是否需要确认 | **需要**。官方 5 个示例提示词全部以「先展示结果与建议，等我确认后再修改」结尾；整理清单那条另有警告 "💡 Deleted content cannot be recovered. Please proceed with caution." |
| 数据范围 | 会读取用户存量数据：任务、清单、习惯、专注记录（隐私政策亦确认） |
| 额度 | 与其它 AI 功能**共享月度额度**，在 `Settings → AI Features` 查看 |

`[来源: https://help.ticktick.com/articles/7503016104470511616]` `[中文: https://help.dida365.com/articles/7502990612036059136]`

> ⚠️ **英文页与中文页存在一处不一致**：英文页写明「macOS 与 Web 可用，**Windows 尚不支持**」；中文页只说「桌面端」并给出 `设置 → 功能模块` 的开启路径，未写 Windows 排除（其 FAQ 只排除「Windows 10 以下」）。两页都建议以「更新到最新版 + 系统版本」自查。此处按原文并列，不做调和。

#### ② AI Voice Add（AI 语音添加 / AI Mode）

| 维度 | 内容 |
|---|---|
| 做什么 | 语音自然语言建任务。自动抽取任务标题，并识别**日期、时间、清单、标签、优先级** |
| 拆分 | 一句话含多件事时**自动拆成多条任务**；若 AI 不确定是否该拆，会给出**两个版本**，左右滑动选择 |
| 长语音 | 自动生成**简短标题** + 把完整转写写进**任务描述** |
| 交互形态 | **一键式**（说完即出结果，无对话） |
| 入口 | 长按 `+` 说话 → 松开进入保存页 → 左上角开启 `AI Mode`；或长按 `+` 左滑进入 `Recording Mode` → 左上角开启。开关状态自动记忆 |
| 平台 | **仅移动端**（官方 What's New 标注 "Mobile only"） |
| 处理耗时 | 通常 1–2 秒；长/复杂输入 3–5 秒 |
| 失败回退 | 网络或服务繁忙时**自动回退普通模式**并显示原始转写，仍可正常保存 |
| 额度 | 有月度额度，达到上限会提示，次月重置 |
| 隐私 | 官方称 "Your voice data is only used for processing the current task. It is not stored or used for AI model training." |

`[来源: https://help.ticktick.com/articles/7444677039392555008]`

#### ③ Transcribe & Summarize Recordings（AI 录音 / 录音转写与智能总结）

| 维度 | 内容 |
|---|---|
| 做什么 | 录音附件两种处理：**Transcribe**（转成带时间戳文本）/ **Summarize**（生成结构化摘要） |
| 入口 | 任务详情页 → 录音附件上的按钮 |
| 交互形态 | **一键式**（点按钮即处理，无对话） |
| 异步 | 处理**后台进行**，可离开页面，完成有通知 |
| 语言 | **30+ 语言**自动检测（英/日/韩/法/德/西等） |
| 耗时 | <1 分钟录音通常 <10 秒；30 分钟录音约 1–3 分钟 |
| 失败重试 | 有 `Retry` |
| 已知缺陷 | Android 上部分压缩格式（如 MP3）时间戳有偏移，官方承认是 **known issue** |
| 结果操作 | 复制文本 / 加入描述 / 分享（移动端）；桌面端只有复制文本 / 加入描述 |
| 限制 | 极短录音**不支持摘要** |
| 隐私 | 录音仅用于本次转写与总结，不存储、不用于模型训练 |

`[来源: https://help.ticktick.com/articles/7444682584526684160]`

### 1.2 站外（With External Tools）

#### ④ TickTick MCP

- 服务地址：**`https://mcp.ticktick.com`**（中国版 **`https://mcp.dida365.com`**）
- 协议：**只支持 Streamable HTTP，不支持 SSE**（只支持 SSE 的客户端目前无法接入）
- 鉴权：**OAuth**（支持自动刷新 token）或 **Bearer Token**（在网页版 `头像 → 设置 → 账户与安全 → API Token` 创建）
- 官方适配的 AI 客户端：
  - 国际版：**Claude**（Settings → Connectors，有官方目录页）、**ChatGPT（Codex）Plugins**、**Gemini（Spark，Beta）**、**Grok**（Connectors → New Connector → Custom）、**Perplexity**（需 Pro/Max/Enterprise）、**Claude Code**、**Cursor**、**VS Code**、**Codex CLI**、**TRAE**、**Antigravity**
  - 中国版另有：**WorkBuddy**、**豆包（豆包工作）**、**千问办公**（中国版页面对豆包/千问都加了「目前推荐使用 DIDA CLI，使用更稳定」）
- 工具清单（官方原文枚举）：

| 类别 | 工具 |
|---|---|
| 任务查询（6） | `search_task`、`get_task_by_id`、`list_undone_tasks_by_time_query`（支持 today/last24hour/last7day/tomorrow/next24hour/next7day）、`list_undone_tasks_by_date`（**最大跨度 14 天**）、`list_completed_tasks_by_date`、`filter_tasks`（按日期/清单/优先级/标签/类型/状态组合） |
| 清单管理（13） | 清单：`list_projects`、`create_project`、`update_project`、`get_project_by_id`、`get_project_with_undone_tasks`、`get_task_in_project`；分组：`list_columns`、`create_column`、`update_column`；文件夹：`list_project_groups`、`create_project_group`、`update_project_group`、`delete_project_group` |
| 任务管理（16） | `create_task`、`batch_add_tasks`、`complete_task`、`complete_tasks_in_project`（**每次最多 20 个**）、`update_task`、`move_task`、`batch_update_tasks`、`delete_task`（移入垃圾箱）、评论 `get_comment`/`add_comment`/`delete_comment`、指派 `assign_task`/`unassign_task`/`project_member`、标签 `list_tags`/`create_tag`/`rename_tag`/`update_tag`/`delete_tag` |
| 习惯（8） | `list_habits`、`list_habit_sections`、`create_habit`、`update_habit`、`get_habit`、`get_habit_checkins`、`upsert_habit_checkins`（**支持最近 90 天打卡**） |
| 专注记录（5） | `get_focuses_by_time`（**一次最多查一个月**）、`get_focus`、`create_focus`、`update_focus`（**专注时长不可修改**）、`delete_focus` |
| 纪念日（1） | `list_countdowns` |

- 官方明确的边界：**"At present, TickTick MCP mainly supports basic task, list, habit, focus records and countdown operations. Other advanced features are not supported yet."**
- 官方给用户的排障建议：描述更具体（清单名/确切日期/优先级）、把复杂请求拆成多步（先查再确认再执行）

`[来源: https://help.ticktick.com/articles/7438129581631995904]` `[中文: https://help.dida365.com/articles/7438132116019216384]`

#### ⑤ TickTick CLI / DIDA CLI

| 维度 | 国际版 | 中国版 |
|---|---|---|
| npm 包 | `@ticktick/ticktick-cli` | `@suibiji/dida-cli` |
| 命令 | `ticktick` | `dida` |
| **npm 首发时间** | **2026-03-11T05:34:30Z（v0.1.0）** | **2026-03-11T06:45:10Z（v0.1.0）** |
| 当前版本（实测） | **0.1.14**（2026-09-22） | **0.1.14**（2026-09-21） |
| 鉴权 | 浏览器 OAuth（推荐）或 `ticktick auth token <TOKEN>` | 浏览器 OAuth（推荐）或 `dida auth token <TOKEN>` |
| 示例命令 | `ticktick project list` / `ticktick task create --title "…" --project <ID>` / `ticktick task complete <listID> <taskID>` / `ticktick task delete <listID> <taskID>` | 同上，命令名为 `dida` |
| 能力边界 | "mainly supports basic task, list, habit, focus records and countdown operations" | 同 |

- 中国版帮助页明确把 CLI 定位为 **"也可供 AI Agent 调用"**，并给出在 **OpenClaw、QClaw** 等 AI Agent 中的两步配置法（在对话框里说「帮我安装 dida-cli：<npm 链接>」→ 说「授权登录」）。
- 官网首页把 **"Connect via MCP, CLI, or OpenClaw"** 直接写进 AI 区块。`[来源: https://ticktick.com/]` `[来源: https://dida365.com/]`

`[来源: https://help.ticktick.com/articles/7465251130025443328]` `[来源: https://help.dida365.com/articles/7464976698707017728]` `[来源: https://registry.npmjs.org/@ticktick/ticktick-cli]` `[来源: https://registry.npmjs.org/@suibiji/dida-cli]`

#### ⑥ TickTick × AI Use Cases（官方提示词范例集）

官方给出的 8 类工作流，全部是 **prompt 模板**而非独立功能：Inbox 整理、每日规划、Backlog 清理、系统健康检查、目标进度复盘、项目复盘、时间分配分析、个人反思。每条 prompt 都要求 AI 先输出结果、**用户确认后再改**。
`[来源: https://help.ticktick.com/articles/7475477082185662464]` `[中文: https://help.dida365.com/articles/7475108284236562432]`

#### ⑦（补充）iOS 27 / Siri AI 集成

- Apple 于 **2026-09-14** 发布 Siri AI（由下一代 Apple Intelligence 驱动）。`[来源: https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/]`
- TickTick **8.2.11 / 8.2.12** release notes 原文：**"New features for iOS 27: Create tasks in Siri AI and have them automatically added to TickTick."**，并支持**把 TickTick 设为 iOS 27 默认提醒 App**。`[来源: https://itunes.apple.com/lookup?id=626144601&country=us]` `[来源: https://www.reddit.com/r/ticktick/comments/1wgwwl8/ios_27_siri_ai_allows_ticktick_as_default/]`
- App Store 另有官方专题页 **"TickTick for Siri AI"**（2026-09-14）。`[来源: https://apps.apple.com/us/app/ticktick-to-do-list-calendar/id626144601?eventid=6811775838]`
- 注意：这条**用的是 Apple 的模型**，不是滴答自己的 AI，属于「接入平台级 AI 入口」。

#### ⑧（补充）ChatGPT 插件目录

TickTick 在 OpenAI 的插件目录里有独立条目（国际版与中国版插件 ID 不同）。`[来源: https://openai.com/business/plugins/ticktick/]` `[来源: https://chatgpt.com/plugins/plugin_asdk_app_6a87b30329908191837da812ccda47b6（中国版，见 help.dida365 页面）]`

---

## 2. 上线时间线

### 2.1 官方「2025 年零 AI」的硬证据

抓取官方 `Updates in 2025` 归档页全文，**7 个月度条目里没有任何一条提到 AI**：
Interface Refresh（Oct 30）、Adapted for iOS 26 + Constant Reminder（Sep 15）、Focus Records（Jul 31）、Countdown Experience（Jun 30）、Countdown 上线（May 12）、Calendar + Apple Health + 安全（Mar 25）、Seamless Task Management（Feb 28）、Enhanced Reminders（Jan 15）。
→ **结论：2025 年滴答清单没有任何 AI 功能上线。**
`[来源: https://help.ticktick.com/external/articles/7505896563223298048]`

### 2.2 时间线表

| 日期 | 事件 | 来源 |
|---|---|---|
| 2013-06-19 | TickTick iOS 首发（App Store `id626144601`，seller **Appest Limited**，bundleId `com.TickTick.task`） | `[来源: https://itunes.apple.com/lookup?id=626144601&country=us]` |
| 2026-01-04（中文站）/ Jan 8（英文 What's New） | **V8.0**：新增「推荐任务 / Suggested Tasks」。**但这是规则式，不是大模型** —— 官方原文 "Tasks are suggested based on factors such as creation time, rescheduling history, and upcoming due dates" | `[来源: https://www.dida365.com/public/changelog/zh.html]` `[来源: https://help.ticktick.com/articles/7082552170989486080]` |
| **2026-03-11** | **TickTick CLI 与 DIDA CLI 首次发布 npm v0.1.0**（比官方公告早约 7 周） | `[来源: https://registry.npmjs.org/@ticktick/ticktick-cli]` `[来源: https://registry.npmjs.org/@suibiji/dida-cli]` |
| 2026-03-09（英文 What's New）/ 2026-03-05（中文 changelog） | 纪念日体验优化（**非 AI**） | `[来源: https://www.dida365.com/public/changelog/zh.html]` |
| **2026-04-23（中文 changelog）/ 2026-04-24（英文 changelog）** | **AI 录音总结（AI Recording Summary）** 上线：录音附件支持 AI 转写与总结 | `[来源: https://www.dida365.com/public/changelog/zh.html]` `[来源: https://ticktick.com/public/changelog/en.html]` |
| **2026-04-29** | 官方 What's New 标题 **"TickTick ✖️ AI 🤖 Smarter Task Management"**，一次发布 **TickTick MCP + AI Voice Add（Mobile only）+ Transcribe & Summarize Recordings** | `[来源: https://help.ticktick.com/articles/7082552170989486080]` |
| 2026-04-29 | B 站官方视频《上新！滴答清单+AI 让你的任务管理工作流更智能》 | `[来源: https://www.bilibili.com/video/BV1Vz9UBbE9d/]` |
| 2026-05-12 | 滴答清单官方小红书发布「4 个核心 AI 场景」内容（经什么值得买 AI 摘要转载） | `[来源: https://post.smzdm.com/p/a5r53m58/]`（原文出处 `https://www.xiaohongshu.com/explore/6a0300fc000000003701dcaf`） |
| 2026-06-03（英文 What's New）/ 2026-06-08（中文） | Telegram Integration 等（**非 AI**） | `[来源: https://help.ticktick.com/articles/7082552170989486080]` |
| **2026-08（约 4 周前）** | **AI Assistant 内测（Beta）** 开启。官方 Reddit 帖 "🎉 Our AI Assistant is now available in beta!"；官方即刻账号发【AI 助手功能内测邀请】 | `[来源: https://www.reddit.com/r/ticktick/comments/1w0e9nc/our_ai_assistant_is_now_available_in_beta/]` `[来源: https://m.okjike.com/users/4009b91d-9189-412e-ada4-4015d263fb9f]` |
| **2026-09-14** | Apple 发布 Siri AI；TickTick 上线 "TickTick for Siri AI" 专题 | `[来源: https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/]` |
| **2026-09-15（中文 changelog）/ 2026-09-16（英文 changelog）** | **新增 AI 助手（AI Assistant）正式上线**（英文原文："Added AI Assistant: Create tasks, break down projects, and organize lists with a single instruction"） | `[来源: https://www.dida365.com/public/changelog/zh.html]` `[来源: https://ticktick.com/public/changelog/en.html]` |
| 2026-09-19 | iOS **8.2.12** 发布，release notes 同时含 AI Assistant 与 iOS 27 Siri AI | `[来源: https://itunes.apple.com/lookup?id=626144601&country=us]` |
| 2026-09-21 / 09-22 | CLI 两包同步发到 **0.1.14** | `[来源: https://registry.npmjs.org/@ticktick/ticktick-cli]` |

> **年份推断说明**：`help.ticktick.com/articles/7082552170989486080` 的 What's New 只写月-日。该页顶部 5 条为 Sep 15 / Jun 3 / Apr 29 / Mar 9 / Jan 8，且页尾把 2025 年条目单独链接到 `Updates in 2025`（其最新条目为 Oct 30）——因此这 5 条归属 **2026 年**。该推断与 `dida365.com/public/changelog/zh.html`（带完整年份，2026-01-04 为 V8.0、2026-04-23 为 AI 录音总结、2026-09-15 为 AI 助手）完全吻合。

### 2.3 战略演进：从「规则」到「大模型」

- **规则式阶段（2013 – 2025）**：官网 features 页的 **NLP** 定义为 *"Utilize NLP for task time setting. Just type in your information, and it will be identified instantly."*；**Voice Input** 定义为 *"just add tasks with voice, and it will automatically convert to text."* 这两项都**不是大模型**，且 **NLP 免费可用**（免费档功能列表里就有）。`[来源: https://ticktick.com/features?language=en_us]`
- 中国版对应功能名为**「智能识别」**，可识别「明早九点开会」这类文本；官方说明还给出「当前下午 4 点输入『9点提醒我』→ 识别为今晚 9 点」的规则示例，并说明**可在「设置 - 高级选项」中关闭**（能关＝规则式特征）。`[来源: https://help.dida365.com/articles/7081931977951019008]` `[来源: https://help.dida365.com/tips/6199839031472160768/]`
- **大模型阶段（2026 – ）**：见 2.2 表。分水岭是 **2026-04-24** 的 AI 录音总结。

---

## 3. AI 战略：两步走（本报告的核心判断）

| 步骤 | 时间 | 做法 | 本质 |
|---|---|---|---|
| **第一步：把 AI 放在产品外面** | 2026-03-11（CLI）→ 2026-04-29（MCP + 语音 + 录音） | 不自研模型，而是**把滴答清单变成 AI Agent 可调用的数据源**：MCP server、CLI、OAuth/Bearer Token、ChatGPT 插件。用户在自己选的 AI 客户端（Claude / ChatGPT / Gemini / Grok / 豆包 / 千问 / Cursor / VS Code / OpenClaw…）里操作滴答清单数据 | **能力外借**：模型能力由外部提供，滴答只出「工具」 |
| **第二步：把 AI 放进产品里面** | 2026-08 内测 → 2026-09-15 正式 | 自建**对话式 AI Assistant**，在应用内直接读任务/清单/习惯/专注记录，做规划、拆解、复盘；同样**云端调用第三方 AI 服务商** | **能力内建**：模型仍是第三方的，但入口、上下文、确认流程都收进自家产品 |

**判断依据**：
- 官方帮助中心专门写了一篇 FAQ 解释两者区别，原文 *"AI Assistant is designed to make it easier to manage tasks... directly within TickTick... MCP and CLI are better suited for users who want more flexibility... through third-party tools."* `[来源: https://help.ticktick.com/articles/7503016104470511616]`
- 官网首页 AI 区块目前**只列 3 项**（Voice Capture / Audio Summary / Automated Workflows (MCP, CLI, OpenClaw)），**尚未把 AI Assistant 写进首页** —— 说明首页文案停留在「第一步」时期。`[来源: https://ticktick.com/]` `[来源: https://dida365.com/]`
- 隐私政策（2026-07-09 修订）新增 AI 段落，同一时间点在为「第二步」做合规准备。`[来源: https://ticktick.com/privacy?language=en_us]`

---

## 4. 定价与配额

### 4.1 定价（2026-09-25 官网实测）

| 档位 | 国际版 | 中国版 |
|---|---|---|
| 免费 | **US$0** | **￥0** |
| 付费 | **Premium US$49.99/年**（页面文案 "less than US$4.17/month"） | **高级会员 ￥139/年**（"每月仅￥11.6"） |

`[来源: https://ticktick.com/upgrade?language=en_us]` `[来源: https://dida365.com/upgrade?language=zh_CN]`

- ⚠️ 大量第三方站（lifestack.ai、checkthat.ai、nathanojaokomo.com、capterra 等）仍写 **$35.99/年**，那是**旧价**。Reddit 帖 "Ticktick price increase soon?" 明确写 "I see $35.99 price but only for limited time. New price is $49.99 annual?"。`[来源: https://www.reddit.com/r/ticktick/comments/1vhfp2s/ticktick_price_increase_soon/]`
- 另一条 Reddit 摘要（beta 公告帖内）称 "The yearly price is increasing from $35.99 to $49.99. The monthly price is going from $3.99 to $4.99." —— **仅有搜索摘要，未取得正文**。`[来源: https://www.reddit.com/r/ticktick/comments/1vf76ps/official_ai_assistant_in_ticktick_beta/]`
- 区域价差存在：App Store 塞内加尔区显示 "Annual TickTick Premium ... USD 27.99"。`[来源: https://apps.apple.com/sn/app/ticktick-to-do-list-calendar/id626144601]`

### 4.2 AI 是否单独收费？

**否。** AI 不单卖，而是**会员权益 + 共享月度配额**：

- **AI 功能 = Premium 专属。** 定价对比表原始 HTML 逐行解析（`class="comparisonRow_3R8fN"`，第 1 列 Free、第 2 列 Premium）：

  | 行 | Free | Premium |
  |---|---|---|
  | **AI Features** | **✗**（`class="dash_1VoBw"` 减号图标） | **✓**（`class="check_1dh1s"` 对勾图标，fill `#FF8E0A`） |
  | 中文站「AI 功能」 | **✗** | **✓** |

  `[来源: https://ticktick.com/upgrade?language=en_us （原始 HTML 解析）]` `[来源: https://dida365.com/upgrade?language=zh_CN （原始 HTML 解析）]`
  （解析器可信度对照：`Priority/Tag/Subtask/Recurring Task/Comment/Template` 两列皆 ✓；`Duration/Constant Reminder/Checklist Item Reminder/List-Task Activities/Filter/Timeline View/Integrations` 皆 Free ✗ / Premium ✓；`Calendar View` = Free "Basic" / Premium "Unlimited"。）

- **旁证 1**：TickTick 官方 Instagram 帖（"What's new in TickTick ✨ Here are some of our latest AI…"）下，有评论 "**AI Assistant is currently available to Premium users.**"，另一条 "Please consider for free plan users with limit…" —— 说明免费用户当时确实没有 AI，且在请求开放。**仅有搜索摘要，Instagram 正文为 JS 渲染未取得。** `[来源: https://www.instagram.com/p/DXvQasUFHT_/]`

- **配额机制（官方原文）**：*"AI-powered features share the same AI quota, which resets each month. You can go to **Settings → AI Features** to check your current quota usage. Once you reach your monthly quota, AI-powered features will be temporarily unavailable. Your quota will reset at the beginning of the next month."* `[来源: https://help.ticktick.com/articles/7503016104470511616]`
  中文原文：*"AI 相关功能共用 AI 额度，额度按月计算。你可以前往「设置」-「AI 功能」查看当前额度使用情况。当达到当月额度上限后，AI 功能将暂时无法使用，额度会在下个月恢复。"* `[来源: https://help.dida365.com/articles/7502990612036059136]`
  AI Voice Add 与录音转写页也各自复述了同一套「月度额度、次月重置」。`[来源: https://help.ticktick.com/articles/7444677039392555008]` `[来源: https://help.ticktick.com/articles/7444682584526684160]`

- 🔴 **具体额度数字（多少次/月）：未找到公开信息。** 帮助中心、定价页、App Store 描述、隐私政策均未给出数字。**没有 AI 点数（credits）机制**，是纯「次数型共享配额」。

---

## 5. 隐私与数据路径

### 5.1 隐私政策（Date of Last Revision: **July 9, 2026**）

新增独立段落 **"Your AI Interactions"**，原文要点：

- 收集范围：*"We collect the text, audio, and transcripts you provide when you actively use our AI features. This data is collected only after you initiate a specific AI task."*
- 反馈数据：*"If you provide feedback on the AI-generated results (such as ratings or corrections), we also collect this feedback along with the relevant input and output context."*
- AI Assistant 额外收集：*"the messages you send during the conversation, as well as your in-conversation actions such as clicks and edits"*；对话历史保留至该会话生命周期结束，**用户可随时查看和删除**。
- **会读存量数据**：*"The AI Assistant may also access your existing TickTick data (such as tasks, lists, and habits) when needed to fulfill your specific requests."*
- **第三方服务商（关键句）**：*"For our AI-powered features, **we utilize third-party AI service providers** to process your inputs and generate relevant outputs. We strictly limit this processing to the delivery of the specific feature, ensuring that your data is not used for any purpose unrelated to that feature, **nor used to train our models**."*
- 通用承诺：*"TickTick will never sell your personal data to a third party, and we will never share data with third parties without your permission."*

`[来源: https://ticktick.com/privacy?language=en_us]` `[中文: https://dida365.com/privacy]`

### 5.2 保存地域与加密（**TickTick 不是 E2EE**）

Security 页原文：
- *"All the databases and servers are hosted by **Amazon Web Services (AWS) in the United States**."*
- *"User data, including task details, account information and payment details, are all **stored and encrypted at rest**."*（**服务端静态加密，不是端到端加密**）
- *"All user data is automatically backed up on AWS servers with the capability of providing point-in-time recovery."*
- *"TickTick reserves the right to hold onto the data and not turn it over to any third parties. **We will never share your data with third parties without your prior permission.**"*
- 数据泄露 72 小时内通知。

`[来源: https://ticktick.com/security]`

### 5.3 两处需要指出的张力

1. **Security 页的「永不未经许可分享第三方」 vs Privacy 页的「AI 功能使用第三方 AI 服务商」** —— 官方未解释这两者如何兼容（可理解为「使用 AI 功能＝用户主动发起＝构成许可」，但**政策原文没有这样写**）。
2. **帮助中心对用户说「不上传、不训练」，隐私政策说「交给第三方服务商处理」** —— 两者措辞不同层：帮助中心强调的是「不存储、不用于训练」，隐私政策承认「会交由第三方处理」。**不矛盾，但口径不同。**

### 5.4 模型供应商

🔴 **未找到公开信息。** 官方所有公开材料一律只写 **"third-party AI service providers"**，从未点名任何模型厂商或模型名。**本次调研未采信任何把 Doubao / DeepSeek / OpenAI 与滴答清单 AI 绑定的说法** —— 搜索中出现的那些结果全部是与滴答清单无关的行业新闻，不构成证据。

### 5.5 端侧 vs 云端

**云端。** 依据：① 隐私政策明确「third-party AI service providers」；② AI Voice Add 的 FAQ 提到「网络问题或服务繁忙时处理失败并回退普通模式」；③ 录音转写 FAQ 提到「可离开页面，后台处理，完成有通知」；④ 不支持 iOS 15 / Android 8 / macOS 13.3 以下 —— 是 API 兼容性门槛而非算力门槛。`[来源: https://help.ticktick.com/articles/7444677039392555008]` `[来源: https://help.ticktick.com/articles/7444682584526684160]`

---

## 6. 技术实现线索

| 线索 | 结论 | 来源 |
|---|---|---|
| 模型 | **未披露**，只写 "third-party AI service providers" | `[来源: https://ticktick.com/privacy?language=en_us]` |
| 云端 / 端侧 | **云端** | 同上 + `[来源: https://help.ticktick.com/articles/7444677039392555008]` |
| 技术博客 | **未找到公开信息**（官网只有 Help Center / Productivity Guides，无 engineering blog） | `[来源: https://ticktick.com/]` |
| 招聘 JD | **未找到公开信息**（未发现滴答清单/随笔记的 AI/LLM 岗位页面） | — |
| 专利 | **未找到公开信息** | — |
| 访谈透露架构 | **未找到公开信息** | — |
| MCP / Agent | **有**：MCP server（Streamable HTTP + OAuth）、CLI（可被 AI Agent 调用）、官方适配 11+ 个 AI 客户端、官网点名 OpenClaw | `[来源: https://help.ticktick.com/articles/7438129581631995904]` `[来源: https://ticktick.com/]` |
| 开放 API 给 AI | **有两条**：① 传统 **Open API**（OAuth2，`https://developer.ticktick.com/`，文档 `https://developer.ticktick.com/docs#/openapi`；中国版 `https://developer.dida365.com/`）；② **API Token**（`设置 → 账户与安全 → API Token`），MCP 的 Bearer Token 与 CLI 都复用这个 token | `[来源: https://developer.ticktick.com/]` `[来源: https://help.ticktick.com/articles/7055781495671095296]` `[来源: https://help.ticktick.com/articles/7438129581631995904]` |
| 是否需要数据上云 | **需要**。AI 功能必须把文本/音频/转写交给第三方 AI 服务商；AI Assistant 还会读取存量任务/清单/习惯 | `[来源: https://ticktick.com/privacy?language=en_us]` |
| 公司主体 | 国际：**Appest Limited**；中国：**杭州随笔记网络技术有限公司**（浙ICP备12005180号-3） | `[来源: https://itunes.apple.com/lookup?id=626144601&country=us]` `[来源: https://dida365.com/upgrade?language=zh_CN]` |

---

## 7. 产品设计细节

### 7.1 AI 在 UI 里的位置

| 功能 | UI 位置 |
|---|---|
| AI Assistant | **不是独立一级 Tab，是可选启用的模块**：移动端在 `设置 → Tab Bar` 里把 `AI` 加到**底部导航栏**；桌面端在 `设置 → Features/功能模块` 打开后从**侧边栏**进入，**另有右下角悬浮球**（右键可贴边隐藏） |
| AI Voice Add | **长按 `+` 按钮**（沿用既有语音输入入口），在保存页左上角开 `AI Mode`；开关自动记忆 |
| 录音转写/摘要 | **任务详情页的录音附件按钮**（转写 / 总结两个按钮） |
| MCP / CLI | **产品外**，无 UI |
| Siri AI | **系统级**（iOS 27） |

→ **没有「输入框里的魔法按钮」这种设计**：AI 要么是一个可选启用的独立模块（Assistant），要么是既有入口上的一个开关（Voice Add 的 AI Mode），要么是附件上的两个按钮（录音）。`[来源: https://help.ticktick.com/articles/7503016104470511616]` `[来源: https://help.ticktick.com/articles/7444677039392555008]` `[来源: https://help.ticktick.com/articles/7444682584526684160]`

### 7.2 交互形态

- **AI Assistant = 对话式 + 建议式**（有 `Suggested Actions`，可 `Retry` / `Edit` 重生成，会话可管理）
- **AI Voice Add = 一键式**（说完即出结构化结果，可逐条删除，多个候选版本可滑动选择）
- **录音 = 一键式**（两个按钮，后台异步）
- **MCP / CLI = 无 UI，外部 AI 客户端里对话式**
- **没有「后台自动执行」的 Agent 模式**：所有 AI 动作都要用户在对话里发起

### 7.3 确认流程：**是「AI 建议 → 用户确认」**

- AI Assistant 官方 5 个示例提示词**全部**以「先展示、等确认再改」结尾（英文 "Wait for my confirmation before making any changes"；中文「等我确认后再进行任何修改」）。
- 官方对「整理清单」那条专门加警告："💡 Deleted content cannot be recovered. Please proceed with caution."
- AI Voice Add 也是「先出结果 → 用户 review → 点 Save 才写入」。
- **不存在「AI 直接自动改数据」的默认行为。**

`[来源: https://help.ticktick.com/articles/7503016104470511616]` `[来源: https://help.ticktick.com/articles/7444677039392555008]`

### 7.4 免费 vs 会员

**AI 全部是会员专属**（见 4.2）。免费用户仍可用的是**规则式**能力：NLP / 智能识别（时间解析）、普通 Voice Input（语音转文字）、Smart List、Filter、Email to Task。`[来源: https://ticktick.com/upgrade?language=en_us]`

---

## 8. 逐项「有 / 没有」确认表（对照你给的候选清单）

| # | 候选能力 | 结论 | 说明与来源 |
|---|---|---|---|
| 1 | **AI 任务创建 / 自然语言解析**（"明天下午3点开会"→任务） | ✅ **有，但分两层** | **规则式**（免费，非 AI）：Smart Recognition / NLP / 智能识别，2013 年起就有，可关闭 `[来源: https://help.dida365.com/articles/7081931977951019008]`；**大模型式**（会员）：AI Voice Add 与 AI Assistant `[来源: https://help.ticktick.com/articles/7444677039392555008]` |
| 2 | **语音输入 / 语音转任务** | ✅ **有** | AI Voice Add 的 AI Mode（自动抽日期/清单/标签/优先级、自动拆多任务、长语音生成标题+全文转写）；**仅移动端**。另有非 AI 的普通语音输入 `[来源: https://help.ticktick.com/articles/7444677039392555008]` `[来源: https://help.ticktick.com/articles/7055782422935240704]` |
| 3 | **智能清单 / 智能列表（Smart Lists）** | ✅ **功能有，但 ❌ 不是 AI** | Smart List = "a list that filters and displays tasks based on…"，纯规则 `[来源: https://help.ticktick.com/articles/7055782283059396608]`；另有 `Filter`（自定义筛选，**Premium 专属**）`[来源: https://ticktick.com/upgrade?language=en_us]` |
| 4 | **AI 拆解任务 / 子任务生成** | ⚠️ **只能靠提示词，无独立按钮** | AI Assistant 的「制定目标并拆解行动路径」示例提示词；MCP 侧靠 `create_task` / `batch_add_tasks` 由外部 AI 决定拆法 `[来源: https://help.ticktick.com/articles/7503016104470511616]` `[来源: https://help.ticktick.com/articles/7438129581631995904]` |
| 5 | **每日简报 / 每日计划 / 日程规划（AI 排程）** | ⚠️ **有排程，但是 prompt 驱动，无一键「每日简报」** | AI Assistant「制定日 / 周 / 月计划」提示词会把未排期任务按优先级塞进剩余可用时间，并注意每天负载均衡；但必须用户发指令。另有**规则式** `Daily Reminder`（每天固定时间提醒你回顾任务）`[来源: https://help.ticktick.com/articles/7503016104470511616]` `[来源: https://ticktick.com/features?language=en_us]` |
| 6 | **AI 摘要 / AI 复盘 / AI 周报** | 🟡 **摘要＝一键原生；复盘/周报＝prompt** | **AI 摘要**是原生一键功能（录音 Summarize）`[来源: https://help.ticktick.com/articles/7444682584526684160]`；**复盘/周报**没有原生生成器，只有 AI Assistant「复盘与总结」提示词（会读任务完成情况+习惯记录+专注记录）`[来源: https://help.ticktick.com/articles/7503016104470511616]` |
| 7 | **智能标签 / 自动分类 / 优先级建议** | ❌ **无原生自动能力** | 标签是纯手动 + 手动 Filter；AI 侧只能在 prompt 里让 AI「推荐标签/优先级」（官方 Use Cases 的 Inbox 整理示例），**没有后台自动打标** `[来源: https://help.ticktick.com/articles/7475477082185662464]` |
| 8 | **邮件转任务** | ✅ **有，但 ❌ 不是 AI** | 转发邮件到 `todo@mail.ticktick.com`（需用注册邮箱）或个人专属地址，邮件即存为任务。纯地址路由，无解析 `[来源: https://help.ticktick.com/articles/7055782422935240704]` |
| 9 | **截图转任务 / 图片识别（OCR）** | ❌ **没有** | 官方无任何相关文档；第三方对比文明确写 "**TickTick searches your task text, not the contents of an image.** A screenshot reminder app uses OCR to read the words in the picture" `[来源: https://www.remindshot.com/blog/ticktick-vs-screenshot-reminder-app]`。TickTick 支持往任务里**贴图/传附件**，但那不是识别 `[来源: https://help.ticktick.com/articles/7055792921664028672]` |
| 10 | **习惯打卡的 AI 分析** | ❌ **无原生** | AI Assistant 的复盘提示词可以**读**习惯记录一起分析，但没有独立的「习惯 AI 分析」功能；习惯统计本身是规则式统计 `[来源: https://help.ticktick.com/articles/7503016104470511616]` `[来源: https://ticktick.com/features?language=en_us]` |
| 11 | **番茄钟 / 专注的 AI 能力** | ❌ **没有** | 2025-10 的番茄钟改进是**手动**记录额外时长/手动改时长，非 AI；features 页 Pomodoro 描述无 AI `[来源: https://help.ticktick.com/external/articles/7505896563223298048]` `[来源: https://ticktick.com/features?language=en_us]` |
| 12 | **日历相关的 AI（AI 排会议）** | ❌ **没有排会议 AI** | 日历侧只有订阅日历 / Google Calendar / Notion 关联等规则式集成；AI Assistant 能把**任务**排进空闲时间，但没有会议邀约/参会人/会议室相关 AI `[来源: https://ticktick.com/features?language=en_us]` `[来源: https://help.ticktick.com/articles/7503016104470511616]` |

**一句话**：滴答清单的 AI 覆盖面**明显窄于 Todoist（Email Assist / Filter Assist / Task Assist / Ramble）**，也窄于 Motion / Reclaim 的「AI 日历自动排程」。它的 AI 重心是**「对话式助手 + 语音捕获 + 录音摘要 + 对外开放 MCP/CLI」**，而**邮件转任务、Smart List、NLP 日期解析、番茄钟、日历集成都还是老的规则式实现**。

---

## 9. 失败与争议

> ⚠️ **本节全部只有搜索引擎摘要，Reddit 正文抓取被 403 阻断**（www / old / api 三个端点全试过，redlib 镜像 429 或 Cloudflare）。引用时请连同这个限制一起写。

| 争议 | 原文（搜索摘要） | 来源 |
|---|---|---|
| **隐私：第三方 AI 读全部数据** | "**TickTick is allowing an unknown, third-party, Chinese AI to look at all your data 'as needed'.** I love TickTick, but this AI feature is unwanted, unnecessary…" | `[来源: https://www.reddit.com/r/ticktick/comments/1vf76ps/official_ai_assistant_in_ticktick_beta/]` |
| **整体口碑：压倒性负面** | "**99% of comments are negative. No really.** In my opinion tick tick could listen to their users for example just open reddit." | `[来源: https://www.reddit.com/r/ticktick/comments/1sznn8o/ticktick_ai/]` |
| **响应慢 + 建议太基础** | "**I've found it very slow in responding, when asked for suggestions, they were very basic.** Yes it did bulk change a few tasks, suggest a few items…" | `[来源: https://www.reddit.com/r/ticktick/comments/1w0e9nc/our_ai_assistant_is_now_available_in_beta/]` |
| **识别不准 + 额度限制 + 内容审查** | "They still make mistakes, **have usage limits, have topics that are censored/restricted**, and therefore are not reliable." | `[来源: https://www.reddit.com/r/ticktick/comments/1qgi8y1/ai_in_ticktick/]` |
| **语音 AI 识别不出清单** | "**How can I get the AI voice add feature to recognize the list I want to add the task under? For me this ai feature is absolutely useless.**" | `[来源: https://www.reddit.com/r/ticktick/comments/1sznn8o/ticktick_ai/]` |
| **抱怨动作太慢、被竞争对手甩开** | "Is TickTick falling behind? Why the rise of AI Agents forced…"；"TickTick feels increasingly like being stuck in the past. The main problem? **Developer experience.**" | `[来源: https://www.reddit.com/r/ticktick/comments/1r7xfj7/is_ticktick_falling_behind_why_the_rise_of_ai/]` |
| **AI 上线前的用户抱怨（对照）** | 2026 年 1 月（约 8 个月前）有帖质问 "Why hasn't TickTick integrated AI features yet, while competitors have had them for over a year?"，并列出期望：语音建任务/日程、AI 辅助创建（智能建议、自动分类…） | `[来源: https://www.reddit.com/r/ticktick/comments/1q1ckw3/why_hasnt_ticktick_integrated_ai_features_yet/]` |
| **公司透明度（非 AI，但同源情绪）** | "I really like TickTick but am concerned about privacy. **I can't figure out who owns it, who works there, who the board of directors are.**" | `[来源: https://www.reddit.com/r/ticktick/comments/1o513a9/i_really_like_ticktick_but_am_concerned_about/]` |
| **免费用户想要 AI** | Instagram 评论："AI Assistant is currently available to Premium users." + "**Please consider for free plan users with limit**…" | `[来源: https://www.instagram.com/p/DXvQasUFHT_/]` |

**中国社区（弱来源，仅摘要）**：
- 什么值得买转载的滴答清单官方小红书内容《滴答清单AI功能实测：4个核心场景改变时间管理方式》（页面自带「内容由AI生成」标注，属官方口径转述，**不宜作为独立证据**）`[来源: https://post.smzdm.com/p/a5r53m58/]`
- 知乎《「AI × 滴答清单」这些困扰你多年的任务管理问题终于有解》`[来源: https://zhuanlan.zhihu.com/p/27992740952]` —— ⚠️ **该文被搜索引擎标注为 2025-03-05，早于官方任何 AI 上线时间，与官方时间线冲突。知乎正文 403 未取得，无法核实。倾向判断为搜索引擎日期不可靠或该文为 SEO/营销稿，但本次调研无法确证，故仅记录冲突、不作结论。**
- B 站官方视频《上新！滴答清单+AI 让你的任务管理工作流更智能》（2026-04-29）`[来源: https://www.bilibili.com/video/BV1Vz9UBbE9d/]`

**未找到**：针对滴答清单 AI 的「太贵」专项吐槽（因为 AI 不单独收费，价格吐槽集中在**会员整体涨价 $35.99 → $49.99**）。

---

## 10. 未找到公开信息（明确列出，禁止编造）

1. **AI 月度配额的具体数字**（多少次/月、各功能是否分别计数）。
2. **模型供应商与具体模型名**（官方仅 "third-party AI service providers"）。
3. **AI 功能的第三方子处理者清单**（subprocessor list）—— 官网无此页面。
4. **官方技术博客 / 架构访谈 / 专利 / AI 岗位 JD**。
5. **AI Assistant 在中国版是否也有 Windows 端**（中英帮助页口径不一致，见 1.1①）。
6. **Reddit / 知乎 / 小红书正文**（反爬，仅有搜索摘要）。
7. **「AI Features」这一行在定价表里是否代表「全部 AI 功能」还是「部分」**——对比表只给了一个合并行，未逐功能拆分。
8. **AI 语音/录音数据的具体保留时长**（官方只说「不存储、不用于训练」，未给保留期）。

---

## 附录：本次实际抓取/核实的 URL

**官方一手**
- https://help.ticktick.com/articles/7444685542580551680 （AI Features 栏目）
- https://help.ticktick.com/articles/7503016104470511616 （AI Assistant）
- https://help.ticktick.com/articles/7444677039392555008 （AI Voice Add）
- https://help.ticktick.com/articles/7444682584526684160 （Transcribe & Summarize）
- https://help.ticktick.com/articles/7438129581631995904 （MCP）
- https://help.ticktick.com/articles/7465251130025443328 （CLI）
- https://help.ticktick.com/articles/7475477082185662464 （AI Use Cases）
- https://help.ticktick.com/articles/7082552170989486080 （What's New）
- https://help.ticktick.com/external/articles/7505896563223298048 （Updates in 2025）
- https://help.ticktick.com/articles/7055782422935240704 （Add Tasks / 语音与邮件转任务）
- https://help.ticktick.com/articles/7055782283059396608 （Smart List）
- https://help.ticktick.com/articles/7055781452310380544 （Account and Security）
- https://help.ticktick.com/articles/7055781495671095296 （API Support）
- https://help.dida365.com/articles/7444671678778441728 （AI 功能 中文）
- https://help.dida365.com/articles/7502990612036059136 （AI 助手 中文）
- https://help.dida365.com/articles/7438132116019216384 （滴答清单 MCP）
- https://help.dida365.com/articles/7464976698707017728 （DIDA CLI）
- https://help.dida365.com/articles/7475108284236562432 （滴答清单 × AI 使用案例）
- https://help.dida365.com/articles/7081931977951019008 （智能识别）
- https://ticktick.com/features?language=en_us ・ https://dida365.com/features?language=zh_cn
- https://ticktick.com/upgrade?language=en_us ・ https://dida365.com/upgrade?language=zh_CN （**原始 HTML 逐行解析**）
- https://ticktick.com/ ・ https://dida365.com/
- https://ticktick.com/privacy?language=en_us ・ https://dida365.com/privacy
- https://ticktick.com/security
- https://ticktick.com/public/changelog/en.html ・ https://www.dida365.com/public/changelog/zh.html
- https://developer.ticktick.com/ ・ https://developer.dida365.com/
- https://itunes.apple.com/lookup?id=626144601&country=us （App Store 官方版本日志）
- https://registry.npmjs.org/@ticktick/ticktick-cli ・ https://registry.npmjs.org/@suibiji/dida-cli
- https://apps.apple.com/us/app/ticktick-to-do-list-calendar/id626144601?eventid=6811775838
- https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/

**社区 / 第三方（均为摘要级）**
- Reddit：`1vf76ps` / `1w0e9nc` / `1sznn8o` / `1qgi8y1` / `1r7xfj7` / `1o513a9` / `1whnbdc` / `1q1ckw3` / `1vhfp2s` / `1wgwwl8`
- https://www.instagram.com/p/DXvQasUFHT_/
- https://post.smzdm.com/p/a5r53m58/ ・ https://zhuanlan.zhihu.com/p/27992740952
- https://www.remindshot.com/blog/ticktick-vs-screenshot-reminder-app
- https://www.bilibili.com/video/BV1Vz9UBbE9d/
