# 竞品调研：飞书任务/妙记+豆包工作伙伴 vs Apple 提醒事项+Apple Intelligence

> 调研日期：2026-09-25。覆盖范围：产品至今（2026 年）的状态，重点 2024–2026 的更新。
> 规则：每条事实后紧跟 `[来源: URL]`；无法查证的写「未找到公开信息」。状态标注为 announced / shipped / beta / discontinued，并尽量给出日期。
> 说明：飞书官网 `feishu.cn` 的营销页（`/service`、`/price-list`、`/service/ai`）与部分帮助中心文章为 JS 单页应用，`extract` 与 `curl` 均只能取到标题；凡此类页面，其内容取自检索结果摘要，URL 仍是实际检索到的官方页面，已在下文注明「页面摘要」。

---

# A. 飞书任务 / 飞书妙记 / 豆包工作伙伴

## A.1 AI 功能（产品自己的命名）

### 妙记（Feishu Minutes）

| 功能名（原文） | 说明 | 状态 | 来源 |
|---|---|---|---|
| **智能纪要** | 在妙记详情页右侧的「智能纪要」页面查看 AI 生成的**会议总结、待办事项及章节纪要** | shipped，帮助中心文档更新于 2026-07-15 | [来源: https://www.feishu.cn/hc/zh-CN/articles/244959839578-%E5%9C%A8%E8%A7%86%E9%A2%91%E4%BC%9A%E8%AE%AE%E4%B8%AD%E4%BD%BF%E7%94%A8%E6%99%BA%E8%83%BD%E7%BA%AA%E8%A6%81] |
| **智能识别待办任务** | 妙记产品页的官方卖点之一 | shipped | [来源: https://www.feishu.cn/product/minutes]（页面摘要：「智能识别待办任务」） |
| **待办 → 创建任务** | 在妙记中选中待办语句 → 点击右侧「创建任务」→ 填写任务负责人、截止时间 → 确定；任务同步至负责人的飞书任务列表，还可设置提醒 | shipped | [来源: https://www.feishu.cn/content/article/7600354931119311830] |
| 语音转文字（ASR）/ 章节纪要 / 关键词提取 / 说话人区分 / 多语言翻译 | 妙记基础 AI 能力 | shipped | [来源: https://www.feishu.cn/product/minutes]；[来源: https://baike.baidu.com/item/%E9%A3%9E%E4%B9%A6%E5%A6%99%E8%AE%B0/68408263] |
| **智能纪要用量额度** | 独立的计费用量说明（见 A.4） | shipped，文档更新于 2026-08-20 | [来源: https://www.feishu.cn/hc/zh-CN/articles/808156011479-%E6%99%BA%E8%83%BD%E7%BA%AA%E8%A6%81%E7%94%A8%E9%87%8F%E9%A2%9D%E5%BA%A6%E8%AF%B4%E6%98%8E] |

### 任务侧：任务智能体（Task Agent）

飞书开放平台更新日志对**任务**能力的原文表述（页面摘要）：

> 「任务成员可以是 AI 智能体——Agent 不只是工具，是你的同事；Agent 能从妙记或对话识别待办事项，**自动建任务**——说过的事不会丢；Agent 能搜索任务、设置父子关系、按…」

[来源: https://open.feishu.cn/changelog?lang=zh-CN]

即：**「任务智能体」= 可以把 AI Agent 注册成任务的成员/负责人，并让 Agent 从妙记或对话里识别待办、自动创建任务。** 该能力通过飞书任务 OpenAPI 暴露（含「注册或注销任务智能体、更新任务智能体的主页数据、写入智能体任务记录」等接口），并在豆包工作伙伴的工具清单里以 **「飞书任务 MCP」** 的形式提供给 Agent 调用，**计费为 0 点/次**。

[来源: https://open.feishu.cn/document/task-v2/overview]（任务 API 总览，文档日期 2026-05-28）
[来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]（工具费用表：「飞书任务 | 工具费用 | 飞书 MCP 工具 | 0 | 次 | ✅ | ✅」）

### 飞书智能伙伴 → Aily → 豆包工作伙伴（改名链）

- **2026-08-14 起，「飞书 aily」正式更名为「豆包工作伙伴」**；配套改名：「智能伙伴」→「工作伙伴」，「团队智能伙伴」→「团队工作伙伴」，「企业智能体」→「企业工作伙伴」，「三方智能体」保持不变。[来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]
- 产品定位原文：「豆包工作伙伴不再是你打开的一个工具，而是进入你工作环境、就地协作、**主动干活**、和团队一起工作、24 小时在线的 AI 同事。」[来源: https://aily.feishu.cn/hc/1u7kleqg/3d5z9ttt]
- **「主动工作」功能：2026-09-01 起正式计费**（9 月 1 日前为限免体验期）；「仅在产生推送的法定工作日次日 0:00 扣费 20 点；若当天没有产生有效推送卡片，则不扣费」。[来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]
- **2026-09-15 飞书发布 8.0 版本**，官方表述是「为适配 Agent 系统性重构」，同步发布「国内首个团队智能体产品『豆包工作伙伴』」，其「拥有独立身份、权限和记忆」，可像同事一样加入飞书群聊。[来源: https://finance.sina.com.cn/jjxw/2026-09-15/doc-inirxatw3732607.shtml]；[来源: https://www.ebrun.com/20260915/708207.shtml]
- 更早的时间点：2023 年推出「飞书智能伙伴」；2025-07-09 飞书发布知识问答、AI 会议、Aily、妙搭等 AI 产品。[来源: https://zhuanlan.zhihu.com/p/2066257399728681402]；[来源: https://ex.chinadaily.com.cn/exchange/partners/82/rss/channel/cn/columns/sz8srm/stories/WS686e2022a3106af2b3c7332f.html]
- 品牌整合：原飞书「企业知识问答」更名为「企业豆包」，原「Aily 智能伙伴」更名为「豆包工作伙伴」。[来源: https://view.inews.qq.com/a/20260818A06HO300]

### 其它相关 Agent

- **多维表格智能体**（Base Agent）：让多维表格变成团队可用的 Team Agent，可完成问数、增删查改、风险识别、自动提醒。[来源: https://www.feishu.cn/content/article/7657782356450741223]
- **飞书 OpenClaw 插件**（测试版，2026-03-05 上线）：以用户身份完成找资料、看档期、理解群聊上下文等操作。[来源: https://post.smzdm.com/p/a82lp477/]（该文引述 IT 之家 2026-03-08 微博）
- **飞书 CodeM**：飞书原生的 AI 研发智能体。[来源: https://www.feishu.cn/hot]

---

## A.2 交互形态

| 产品 | 形态 | 依据 |
|---|---|---|
| 妙记智能纪要 | **自动提取 + 人工确认**。AI 自动生成总结/待办/章节；待办要用户「选中待办语句 → 点击『创建任务』→ 填写负责人与截止时间 → 确定」才落到飞书任务 | [来源: https://www.feishu.cn/content/article/7600354931119311830] |
| 任务智能体 | **自动执行**。Agent 从妙记或对话识别待办事项，**自动建任务**；Agent 可作为任务成员 | [来源: https://open.feishu.cn/changelog?lang=zh-CN] |
| 豆包工作伙伴 | **对话助手 + 主动执行**。「主动干活」「24 小时在线」；支持「定时任务」（定时触发、飞书消息触发器、webhook、群组触发器） | [来源: https://aily.feishu.cn/hc/1u7kleqg/3d5z9ttt]；[来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]（左侧目录列出「定时任务」「定时触发」「飞书消息触发器」「自定义触发器（webhook）」「飞书群组触发器」） |
| 部署形态 | **纯云端 SaaS**。模型与推理都在飞书/火山侧，无端侧模型 | [来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]（模型费用按「模型厂商官网的刊例价换算飞书 AI 额度」扣费） |

---

## A.3 自动排期（auto-scheduling）

**飞书任务/妙记没有「自动排期 / 时间块规划」这类能力。**

- 在飞书官方对妙记与任务的描述中，AI 做的是：**提取待办 → 生成任务（负责人 + 截止时间）→ 同步到飞书任务列表**，不涉及把任务自动填进日历时间块。[来源: https://www.feishu.cn/content/article/7600354931119311830]
- 检索「飞书任务 自动排期 / 智能排程」只返回**人工排期工具**（多维表格视图、甘特图等），未见 AI 自动排期功能。[来源: https://www.feishu.cn/content/efficient-project-scheduling-tool]
- 与「排期」最接近的是 Agent 侧的**定时触发**（定时任务 / 定时触发 / 飞书消息触发器 / webhook / 群组触发器），那是**「到点触发一个 Agent 或工作流」**，不是「把待办安排到某个时间段」。[来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]

**明确结论：飞书的 AI 做的是「任务捕获与创建自动化」，不是「日程自动规划」。**

---

## A.4 定价（精确数字）

### A.4.1 飞书套件版本（Office 套件本体）

| 版本 | 价格 | 来源 |
|---|---|---|
| 免费版（基础版） | 免费 | [来源: https://www.feishu.cn/service]（页面摘要：「免费版 人/月 免费版包括：」） |
| 商业标准版 | **¥50 / 人 / 月** | [来源: https://www.donews.com/article/detail/6956/92090.html]（「标准版 50 元/月」）；飞书官网版本对比页亦列出该档位 [来源: https://www.feishu.cn/service] |
| 商业专业版 | **¥80 / 人 / 月** | [来源: https://www.feishu.cn/service]（页面摘要：「商业专业版. 最热门. ¥. 80. 人/月」） |
| 商业旗舰版 | **¥120 / 人 / 月** | [来源: https://www.feishu.cn/service]（页面摘要：「商业旗舰版. ¥. 120. 人/月」） |

> ⚠️ 官网 `/service` 与 `/price-list` 是 JS 渲染页，无法抓取完整表格；上表数字来自官方页面的检索摘要与一篇行业媒体（donews）的对照。**「元/人/年」的官方口径未找到公开信息**——官网按「人/月」计价。
> 国际版 Lark 为另一套定价（第三方整理称 Pro 约 $12/user/month），[来源: https://checkthat.ai/brands/lark]，非中国区飞书价格，不要混用。

### A.4.2 飞书 AI 版本（独立于套件版本，需另外购买）

飞书提供 **AI 基础版 / AI 企业版 / AI 企业版 Plus / AI 旗舰版** 四款，以「AI 额度（点数）」为通用货币：

| AI 版本 | AI 额度 |
|---|---|
| AI 基础版 | **18 万点 / 年**（支持月付 1.5 万点/月） |
| AI 企业版 | **200 万点 / 年** |
| AI 企业版 Plus | **600 万点 / 年** |
| AI 旗舰版 | **2,000 万点 / 年** |

[来源: https://www.feishu.cn/hc/zh-CN/articles/629644238181-%E9%A3%9E%E4%B9%A6-ai-%E7%89%88%E6%9C%AC%E6%9D%83%E7%9B%8A%E4%B8%8E%E9%A2%9D%E5%BA%A6%E6%B6%88%E8%80%97%E8%A7%84%E5%88%99%E8%AF%B4%E6%98%8E]（页面摘要给出四档额度数字；同时注明「飞书 AI 版本需企业管理员另外购买」）

对应人民币年费（**第三方来源，需谨慎**）：
- AI 基础版 **9,900 元/年**（含 18 万点）
- AI 企业版 **9.9 万元/年**（含 200 万点）
[来源: https://wenku.baidu.com/view/1bf6eb1694c69ec3d5bbfd0a79563c1ec5dad70e.html]（百度文库，非官方；官方页面未抓取到该价格数字）

豆包工作伙伴计费说明里出现的另一组数字（表格串行，**无法可靠拆解对应关系，故不引用为结论**）：`AI 基础版 9,900 元/年 / 990 元/月；年付：¥1,988 / 席/ 年；月付：¥198 / 席/ 月`。[来源: https://aily.feishu.cn/hc1u7kleqg/1cnvbb55]

### A.4.3 个人侧：飞书 AI 会员

| 档位 | 价格 | 权益 |
|---|---|---|
| 飞书 AI 会员 | **69 元 / 月** | 1,000 AI 点/月；含 3,000 分钟妙记语音转文字、实时字幕、多语言翻译 |
| 更高档 AI 会员 | **138 元 / 月** | 2,000 点/月（用户晒单） |
| 妙记包年会员 | **699 元 / 年**（用户晒单） | 更高转写额度，有用户晒出 3,000 分钟/月 |

[来源: https://www.feishu.cn/hc/zh-CN/articles/598372079100-%E9%A3%9E%E4%B9%A6-ai-%E4%BC%9A%E5%91%98%E6%A1%A3%E4%BD%8D%E5%88%87%E6%8D%A2%E8%AF%B4%E6%98%8E]（官方确认「每月费用为 69 元」）
[来源: https://www.feishu.cn/hc/zh-CN/articles/082024280492-%E9%A3%9E%E4%B9%A6-ai-%E4%BC%9A%E5%91%98%E6%9D%83%E7%9B%8A%E6%B6%88%E8%80%97%E8%A7%84%E5%88%99%E8%AF%B4%E6%98%8E]（官方：「AI 会员：包含每月一定的 AI 个人额度、3,000 分钟妙记语音转文字、实时字幕、多语言翻译等权益」）
[来源: https://post.smzdm.com/p/a82lp477/]（138 元/2,000 点、699 元/年 为用户晒单，非官方口径）

### A.4.4 妙记相关额度（精确到点/分钟）

| 项目 | 额度消耗 |
|---|---|
| 妙记语音转文字（免费版） | **300 分钟 / 人 / 月**（自 2024-12-03 起） |
| 智能纪要（上传音视频文件生成） | **每分钟 0.5 点**（不足 1 分钟向上取整） |
| 智能纪要（一篇） | **固定 20 点** |
| 企业购买「智能会议纪要（企业版）」 | 功能专用额度，含**每年 12,000 篇智能纪要**等权益 |

[来源: https://www.feishu.cn/new-announcement/pricing-adjustment2024]（官方公告：「妙记语音转文字时长不限 300 分钟 … 下个月 1 号用户会恢复 300 分钟的额度」）
[来源: https://maoyanqing.com/feishu-minutes]（引用官方规则：2024-12-03 起免费版每人每月 300 分钟）
[来源: https://www.feishu.cn/hc/zh-CN/articles/808156011479-%E6%99%BA%E8%83%BD%E7%BA%AA%E8%A6%81%E7%94%A8%E9%87%8F%E9%A2%9D%E5%BA%A6%E8%AF%B4%E6%98%8E]（页面摘要：「按上传音视频文件的时长计费：每分钟消耗 0.5 点额度」；「包含每年 12,000 篇智能纪要等权益」）
[来源: https://post.smzdm.com/p/arz2pv3w/]（「根据飞书官方说明，每生成一篇智能纪要固定消耗 20 点 AI 额度」——第三方转述官方）

### A.4.5 豆包工作伙伴计费（官方，最细）

**免费权益**：
- 每位用户**累计 20 次免费对话次数**（限领一次）
- 每个租户**每月 400 额度**免费开发额度（租户内共享，每月 1 号刷新）
- 已购买 AI 版本的企业不赠送

**产物费用**（一次对话只收价值最高的产物）：

| 产物类型 | 产物名称 | 消耗点数 |
|---|---|---|
| 基础对话 | 对话交互 | 2 |
| 基础文档 | 飞书云文档、doc 文件 | 2 |
| 复杂产物 | Zip 压缩包 | 5 |
| 图表数据 | 任务报告、多图生成、飞书多维表格 | 5 |
| 搭建开发 | 妙搭对话、网页生成 | 5 |
| 内容演示 | PPT 演示文档、播客 | 10 |
| 视频创作 | 短视频 | 20 |

**工具费用（与「待办/任务」直接相关的几项）**：

| 工具 | 消耗额度 | 计费单位 |
|---|---|---|
| 知识问答 | 20 | 调用次数 |
| **飞书任务** | **0** | 次 |
| **飞书妙记** | **0** | 次 |
| 飞书云文档 / 多维表格 / 日程 / 消息卡片 / 项目 | 0 | 次 |
| 知识空间检索（标准） | 1 | 调用次数 |
| 深度智能检索 | 10 | 调用次数 |
| 音视频理解 ASR | 16 | 每小时 |
| 音视频理解摘要总结 | 12 | 每小时 |

**官方计费案例**：
- 简单对话 ≈ 2 额度 ≈ ¥0.12
- **「总结群聊消息：查询某个工作群近 3 天的消息，总结相关内容并给出待办任务」≈ 10 额度 ≈ ¥0.6**
- 生成调研报告 ≈ 30 额度 ≈ ¥1.8
- 生成发布会 PPT ≈ 60 额度 ≈ ¥3.5

**额度消耗优先级**：企业功能专用额度 > 企业 AI 通用额度 > 自行购买的 AI 个人额度。

[以上全部来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]

### A.4.6 单点价格

`69 元 ÷ 1,000 点 ≈ 0.07 元/点`，69 元档与 138 元档单价相同（贵一档只是额度翻倍，并不更划算）。[来源: https://post.smzdm.com/p/a82lp477/]

---

## A.5 模型供应商 / 云端 vs 端侧

**飞书用的是字节自研的「豆包大模型」（Doubao），不是「云雀」——云雀是豆包大模型的旧名。**

- 飞书官方《算法及模型使用须知》原文：「算法名称：**豆包大模型算法** … 算法应用场景：豆包大模型算法主要应用于今日头条、抖音、剪映、番茄小说、西瓜视频、**飞书**、豆包、悟空浏览器、懂车帝等网站或应用程序 … 大模型（1）模型名称：豆包大模型」。[来源: https://www.feishu.cn/privacy/ai]（页面摘要）
- 字节官方亦写明「豆包大模型（原云雀大模型）」。[来源: https://www.geekpark.net/news/335111]
- 飞书官方内容页：「飞书深度集成字节跳动自研**豆包大模型**，通过豆包大语言模型及视觉模型，飞书实现 AI 自动写会议纪要、AI 一键建表及 AI 知识问答、AI 字段捷径、AI 云文档等功能。」[来源: https://www.feishu.cn/content/article/7602950574425803975]

**豆包工作伙伴中可选的模型（官方计费表，按模型厂商刊例价换算点数）**：
- 豆包系列：豆包 2.1 (`Doubao-seed-2.1-turbo`)、豆包 2.0 (`Doubao-seed-2.0-lite` / `pro`)、豆包·1.8·深度思考、豆包·编程 (`Doubao-Seed-Code`)、豆包·1.6、豆包·1.5·Pro·视觉深度思考
- 第三方：Kimi-K3 / K2.6 / K2.5、Minimax-M3 / 2.7、GLM-5.3-Flash / 5.3 / 5.2、DeepSeek-V4 / V4-pro / V3.2 / V3.1
- 自定义模型接入：支持以 API 形式接入火山引擎/阿里云/腾讯云上开通的大模型 API 或云端部署的自研模型；**不支持企业本地部署模型接入，不支持海外模型接入**
[来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]

**云端 vs 端侧**：飞书全部为**云端**推理（模型费用按厂商刊例价换算点数扣费），未找到任何端侧模型能力。[来源: https://aily.feishu.cn/hc/1u7kleqg/1cnvbb55]

---

## A.6 用户口碑

### 最有价值的称赞

1. **妙记待办提取被明确认为「比自己记还全」**：
   > 「飞书妙记的实时转写挺准的，基本不用改错别字。纪要自动生成了三个部分：讨论议题、待办事项、关键决策。我对比了一下，**待办事项居然比我手动记的还全**——我漏记了技术负责人提的一个优化点，AI 记上了。」
   > 优点总结：「实时转写准确率高，**待办事项提取全**」「和飞书生态打通，直接在会议记录里 @人指派任务」
   [来源: https://juejin.cn/post/7618764794955579455]

2. **生态闭环**：待办可直接 @人指派并同步到飞书任务列表，这是妙记相对第三方转写工具的核心差异点。[来源: https://www.feishu.cn/content/article/7600354931119311830]；[来源: https://juejin.cn/post/7618764794955579455]

3. 免费语音转文字「无时长限制、仅需登录飞书账号即可使用」的体验口碑（受 300 分钟/月额度约束，见下）。[来源: https://zhuanlan.zhihu.com/p/1905198217139851449]

### 最常见的抱怨

| 抱怨 | 原文/要点 | 来源 |
|---|---|---|
| **AI 纪要是付费的，免费只有转写** | 「飞书妙记用来做会议智能总结也是很好用，但是**只有语音转文字有免费额度，AI 智能纪要就得买会员了**。每月充值，想想有点肉疼。」 | [来源: https://zhuanlan.zhihu.com/p/1986801700149949272] |
| **300 分钟免费额度不够用** | 「求推荐不限时长语音转文字工具，飞书妙记 300 分钟不够用？」 | [来源: https://www.zhihu.com/question/13742351426] |
| **不支持分类逻辑，会后还要二次加工** | 「⚠️ 缺点 · 飞书妙记：**不支持分类逻辑，会后整理要自己二次加工**」 | [来源: https://juejin.cn/post/7618764794955579455] |
| **纪要生成慢** | 「飞书妙记：**纪要生成速度慢，1 小时会议要等 5-8 分钟**」 | [来源: https://juejin.cn/post/7618764794955579455] |
| **识别与说话人分离错误多** | 「试用了飞书妙记，功能很不错就是**错误太多，还有说话人识别错误很多**。」 | [来源: https://v2ex.com/t/903915] |
| **点数消耗不透明，一次 Agent 任务能烧掉一个月额度** | 「有用户查用量明细，发现其中**一次任务消耗了 949.12 点**，基本等于一次任务用完一个月额度。」「真正让我困惑的不是贵，而是**不透明**。」 | [来源: https://post.smzdm.com/p/a82lp477/] |
| **后台自动扣点、关不掉** | 「有用户发现买了妙搭类会员后**每天自动扣 20 点**，『不用还不能关闭』。」 | [来源: https://post.smzdm.com/p/a82lp477/] |
| **多个会员额度不互通** | 「多维表格专业版、AI 个人会员、aily、妙记各有各的权益体系，叠着充之前先确认你要用的功能到底吃哪份额度。」 | [来源: https://post.smzdm.com/p/a82lp477/] |
| **免费额度显示 300/300 却用不了** | 「近期有用户反馈页面显示 300/300 却用不了。」 | [来源: https://post.smzdm.com/p/a82lp477/] |
| **生态绑定，脱离飞书就不好用** | 「缺点是脱离飞书生态之后，适配其他第三方会议平台的…」 | [来源: https://www.csdn.net/article/2026-09-25/166645429] |

---

# B. Apple 提醒事项（Reminders）+ Apple Intelligence

## B.1 AI 功能（产品自己的命名）与版本归属

### iOS 18（2024 年 10 月起，shipped）

Apple Intelligence 首批功能随 iOS 18.1（2024 年 10 月）上线：
- **Writing Tools**（Proofread / Rewrite / Summarize）
- **Notification Summaries**（通知摘要）
- Mail / Messages 摘要
- **Reduce Interruptions** Focus
- **Clean Up**（照片）、**Image Playground**、**Genmoji**
- **ChatGPT 集成**（iOS 18.2，2024 年 12 月，需用户显式授权）

[来源: https://forums.macrumors.com/threads/here-are-all-of-the-apple-intelligence-features-in-ios-18-1.2439580/]
[来源: https://support.apple.com/guide/iphone/turn-on-chatgpt-iph00fd3c8c2/ios]（官方：「You can allow Apple Intelligence to work with ChatGPT from OpenAI」）
[来源: https://valueaddvc.com/blog/apple-intelligence-2026-what-apples-ai-actually-does-and-what-it-still-cant]（时间线：Writing Tools / Clean Up 2024-10 shipped；ChatGPT 集成 2024-12 shipped）

**提醒事项在 iOS 18 本身没有 AI 专属功能**——9to5Mac 当时的说法是「Apple Intelligence is the priority notification feature, which could enable more timely and intelligent Reminders notifications in iOS 18.1」。[来源: https://9to5mac.com/reminders-in-ios-18-all-the-new-features-coming-this-fall/]

### iOS 26（2025 年 9 月，shipped）——提醒事项的第一个 AI 版本

| 功能名（英文原文） | 说明 | 来源 |
|---|---|---|
| **Siri Suggestions**（提醒事项内的「Siri 建议」区块） | 从 Mail、Messages 的对话、Notes、购物清单等来源**建议**你可能想加入待办的事项；在 Mail 等 App 里也会出现建议，点一下即可添加，无需打开提醒事项 | [来源: https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/] |
| **Auto-Categorize**（自动分类） | 「With Auto-Categorize, Apple Intelligence automatically sorts related reminders into **sections within a list**」 | [来源: https://support.apple.com/en-by/guide/iphone/iphcb580b580/ios]（Apple 官方：「Use Apple Intelligence in Reminders on iPhone」） |
| **Grocery list auto-sorting**（购物清单自动排序） | 自动把杂货条目归到 Produce 等分类 | [来源: https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/] |
| Control Center / Action Button / 锁屏按钮新建提醒 | 非 AI，但属 iOS 26 提醒事项更新 | [来源: https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/] |

Apple 官方对 iOS 26 提醒事项的表述：「The Reminders app can also automatically categorize related reminders into sections within a list. **Select text, tap Share, then tap Reminders.**」——注意这里仍是**用户先选中文本、再分享**的半自动流程。[来源: https://support.apple.com/en-lb/guide/iphone/iphcb580b580/ios]

### iOS 27（2026-09-14 shipped）——「描述式」创建

Apple 官方《How to get the next generation of Apple Intelligence》里，与任务/日程直接相关的条目：

- **Describe a reminder in natural language**: iPhone, iPad, Mac
- **Describe a calendar event in natural language**: iPhone, iPad, Mac
- **Describe a shortcut in natural language**: iPhone, iPad, Mac
- **Siri AI**（个人上下文理解、app actions、**onscreen awareness**、广域世界知识）
- **Suggestions in Mail**（English only）
- **Automatic proofreading**
- **Call Context**
[来源: https://support.apple.com/en-us/121115]

**「Describe a reminder」的实测行为**：
> 「In Reminders, you can now describe a reminder in natural language and it will autofill the metadata that you mention. It can add **date, time, and location** automatically. You can write in a reminder like 'get the groceries at 6pm tonight' or 'send the photos to John tomorrow at 4pm' and it will add the correct times to your reminder.」
[来源: https://www.macrumors.com/guide/ios-27-calendar-reminders/]

> 「Describe a New Reminder: Use your own words to describe a reminder and Apple Intelligence will help create it for you.」（iOS 27 开机引导页原文）
[来源: https://9to5mac.com/2026/08/26/heres-everything-new-for-reminders-in-ios-27/]

iOS 27 提醒事项其它更新：元数据编辑器升级（Date / Time / **Urgent** / Repeat / Location / Tag / Flag / Camera）、购物清单排序更准且支持更多语言、超大尺寸小组件、Shortcuts 新增 Create Group / Create List / Create Section / Delete Groups / Delete Lists / Delete Sections 动作，以及新的 **「Get What's On Screen」** 选项可用于提醒事项。[来源: https://9to5mac.com/2026/08/26/heres-everything-new-for-reminders-in-ios-27/]；[来源: https://www.macrumors.com/guide/ios-27-calendar-reminders/]

**Siri AI 状态**：Apple 官网当前写「**Siri AI is rolling out in English.**」[来源: https://www.apple.com/apple-intelligence/]；WWDC26（2026-06-08）新闻稿写「New Siri AI features are available for developer testing starting today, and will be available as a **beta** to users later this year」[来源: https://www.apple.com/newsroom/2026/06/apple-intelligence-brings-powerful-ai-capabilities-into-everyday-experiences/]；iOS 27 支持页写「A more capable and conversational version of Siri is **rolling out** to users」，支持机型为 iPhone 16 全系及以后 + iPhone 15 Pro / 15 Pro Max。[来源: https://support.apple.com/en-us/149076]

> **注意 iOS 27 的提醒事项支持机型**：MacRumors 明确写「To use the Apple Intelligence features in iOS 27, you need an iPhone 15 Pro or later.」[来源: https://www.macrumors.com/guide/ios-27-calendar-reminders/]；Apple 官方口径为「iPhone 16 models or later, iPhone 15 Pro, iPhone 15 Pro Max, iPhone Air…」[来源: https://support.apple.com/en-us/121115]

---

## B.2 交互形态

| 形态 | 具体表现 | 来源 |
|---|---|---|
| **端侧（on-device）** | Writing Tools、Clean Up、通知摘要、Genmoji/Image Playground 的端侧部分 | [来源: https://valueaddvc.com/blog/apple-intelligence-2026-what-apples-ai-actually-does-and-what-it-still-cant]（分层表：Writing Tools on-device、Clean Up on-device、Genmoji/Image Playground hybrid）；Apple 官方隐私页：「Apple Intelligence models run entirely on device. Apple Intelligence can use Private Cloud Compute…」[来源: https://support.apple.com/guide/iphone/apple-intelligence-and-privacy-iphe3f499e0e/ios] |
| **私有云计算（Private Cloud Compute）** | 超出端侧能力的请求走 PCC；「uses larger, server-based models」 | [来源: https://support.apple.com/guide/iphone/apple-intelligence-and-privacy-iphe3f499e0e/ios]；[来源: https://security.apple.com/blog/expanding-pcc/] |
| **ChatGPT 交接（opt-in）** | 只有用户显式批准才离开 Apple 栈；iOS 27 的 Siri app 可在 Siri AI 与 ChatGPT 间即时切换 | [来源: https://support.apple.com/guide/iphone/turn-on-chatgpt-iph00fd3c8c2/ios]；[来源: https://valueaddvc.com/blog/apple-intelligence-2026-what-apples-ai-actually-does-and-what-it-still-cant]（「Only when you explicitly approve it does anything leave the Apple stack for OpenAI」）；[来源: https://www.bloomberg.com/news/articles/2026-03-26/apple-plans-to-open-up-siri-to-rival-ai-assistants-beyond-chatgpt-in-ios-27] |
| **建议（suggestion），非自动执行** | 提醒事项的 Siri 建议、自然语言填充元数据，都是「AI 提议 + 用户确认」 | [来源: https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/]；[来源: https://www.macrumors.com/guide/ios-27-calendar-reminders/] |
| **Siri 代为执行** | iOS 27 的 Siri AI「can take actions in apps like Messages, Music, **Reminders**, and more based on what you're doing in the moment」；Siri 可增删改提醒与日历事件 | [来源: https://www.apple.com/apple-intelligence/]；[来源: https://www.macrumors.com/guide/ios-27-calendar-reminders/] |
| **App Intents / Onscreen awareness** | WWDC26 有专门 session 讲 onscreen awareness 与 App Schemas；开发者可让 Siri 理解「this message」「the last one」等屏幕指代 | [来源: https://developer.apple.com/videos/play/wwdc2026/343/] |

---

## B.3 自动排期（auto-scheduling）

**Apple 提醒事项不做自动排期。没有把待办自动排进日历时间块、也没有自动排序/分配时间的能力。**

**证据一（官方能力清单里没有）**：Apple 官方 iOS 27 的 Apple Intelligence 功能清单中，提醒事项只有 **「Describe a reminder in natural language」** 一项；日历只有 **「Describe an event in Calendar lets you use natural language to create an event, and details like the time, location, invitees, and event title are filled in using Apple Intelligence」**。全文未出现任何「自动排期 / 自动规划 / time blocking」类能力。[来源: https://support.apple.com/en-us/121115]

**证据二（官方提醒事项支持页没有）**：Apple 的《Use Reminders on your iPhone, iPad, or iPod touch》里，时间相关能力只有：手动设 due date/time、位置提醒、urgent 提醒的闹钟（iOS 26.2）、时区设置、全天提醒默认 9:00 AM。没有自动排期。[来源: https://support.apple.com/en-us/102484]

**证据三（用户明确在要这个功能）**：r/gtd 有帖「Why can't Apple Reminders do time blocking?」——「I love that Apple Calendar and reminders now sync. My problem is that when you set a time for a reminder/task, **you can only set a single time** as opposed to…」[来源: https://www.reddit.com/r/gtd/comments/1gmo3w2/why_cant_apple_reminders_do_time_blocking/]

**它实际做的是（替代路径）**：
1. **捕获自动化**：Siri 建议从 Mail/Messages/Notes 里提出候选待办，点一下加入（iOS 26）。[来源: https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/]
2. **分组自动化**：Auto-Categorize 把相关提醒自动归入列表内的分区（iOS 26）。[来源: https://support.apple.com/en-by/guide/iphone/iphcb580b580/ios]
3. **元数据填充自动化**：用一句话描述提醒，自动填 date / time / location（iOS 27）。[来源: https://www.macrumors.com/guide/ios-27-calendar-reminders/]
4. **购物清单排序**（iOS 26 起，iOS 27 更准且多语言）。[来源: https://9to5mac.com/2026/08/26/heres-everything-new-for-reminders-in-ios-27/]
5. **自然语言驱动 Siri 创建/编辑**（iOS 27）。[来源: https://support.apple.com/en-us/149076]

> **自动排期：未找到公开信息（Apple 侧）。**

---

## B.4 定价与设备门槛

**Apple Intelligence 本身不单独收费——随硬件免费提供。** 但有两层隐性成本：硬件门槛 + 服务端功能的每日额度。

### 设备与系统要求（官方原文）

- 系统：**iOS 27 / iPadOS 27 / macOS 27 Golden Gate / visionOS 27 / watchOS 27**
- 机型：**iPhone 16 models or later, iPhone 15 Pro, iPhone 15 Pro Max, iPhone Air, iPad mini (A17 Pro), MacBook Neo (A18 Pro), iPad models with M1 or later, Mac with M1 or later, Apple Vision Pro, Apple Watch Series 9 or later, Apple Watch Ultra 2 or later, and Apple Watch SE 3**（需与支持 Apple Intelligence 的 iPhone 配对）
- 存储：部分机型**最多需 14 GB**（iPhone 17 Pro / 17 Pro Max / iPhone Air / M4 及以后 iPad / M3 及以后且 ≥12GB 统一内存的 Mac / Apple Vision Pro (M5)）；其它机型**最多 8 GB**；Apple Watch **最多 1.5 GB**
- 语言：英语、丹麦语、荷兰语、法语、德语、意大利语、挪威语、葡萄牙语、西班牙语、瑞典语、土耳其语、越南语、简体中文、繁体中文、日语、韩语
- **中国大陆**：Apple Intelligence 目前对在中国大陆购买的设备不可用；在境外购买但 Apple Account 国家/地区为中国大陆、且身处中国大陆时也不可用

[来源: https://support.apple.com/en-us/121115]

### 服务端功能的每日额度（官方）

> 「Certain Apple Intelligence features that rely on server-side models are subject to daily usage limits, including but not limited to **Siri AI, Intelligent Photo Editing Tools, Image Playground, and AFM 3 Cloud models in Shortcuts**. … **Increased access to such features will be available for a fee.**」

- 首页视频摘要按 iCloud+ 档位：**2TB 档 1 路摄像头 / 6TB 档 2 路 / 12TB 档 5 路**
[来源: https://support.apple.com/en-us/127901]（发布日期 2026-09-09）

### 开发者侧（对做 heyta 这类 App 直接相关）

- Foundation Models framework 提供端侧模型 + PCC 模型；**PCC 无鉴权、无 API Key、开发者无 token 成本，但有每日每用户限额（iCloud+ 更高）**，且**仅对 App Store Small Business Program 且累计首次下载 < 200 万次的 App 免费开放**。[来源: https://developer.apple.com/videos/play/wwdc2026/319/]；[来源: https://developer.apple.com/wwdc26/guides/apple-intelligence/]
- **端侧模型：4K 上下文，无请求上限，可离线**；**PCC 模型：32K 上下文，支持 reasoning，需联网，有每日上限**。[来源: https://developer.apple.com/videos/play/wwdc2026/319/]（`SystemLanguageModel().contextSize // 4096 on 26.0 // 8192 on 27.0 (newer devices)`；`PrivateCloudComputeLanguageModel().contextSize // 32768`）

---

## B.5 模型供应商 / 云端 vs 端侧（核心）

### 第三代 Apple Foundation Models（AFM 3），2026-06-08 announced / shipped with iOS 27

Apple 官方原文：「a family of **five foundation models custom-built in collaboration with Google**」。

| 模型 | 运行位置 | 规模 / 说明 |
|---|---|---|
| **AFM 3 Core** | **端侧** | 30 亿参数 dense，下一代 3B 模型 |
| **AFM 3 Core Advanced** | **端侧** | **200 亿参数稀疏架构**，每次请求只激活 1–4B 参数（Instruction-Following Pruning，IFP）；原生多模态；为最强 Apple silicon 优化 |
| **AFM 3 Cloud** | **Private Cloud Compute** | 服务端主力，多模态推理 |
| **ADM 3 Cloud (Image)** | **Private Cloud Compute** | 图像生成与编辑（Image Playground、Spatial Reframing、Genmoji） |
| **AFM 3 Cloud Pro** | **Private Cloud Compute（扩展到 Google Cloud 的 NVIDIA GPU）** | 最强服务端模型，用于 agentic tool use 与复杂推理 |

[来源: https://machinelearning.apple.com/research/introducing-third-generation-of-apple-foundation-models]

### 与 Google 的关系（必须说清楚，不要说成「Apple 自研」）

> 「This year, Apple collaborated with Google to leverage the technologies behind its **Gemini family of models** to build the next generation of Apple Foundation Models that power our Apple Intelligence features.」
> 「For the most demanding tasks, including agentic tool-use and complex reasoning, we worked with Google and NVIDIA to extend our PCC infrastructure to **Google Cloud systems using NVIDIA GPUs**」
> 「For **AFM 3 Cloud Pro**, we worked with Google and NVIDIA to extend Private Cloud Compute to NVIDIA GPUs in Google Cloud」

[来源: https://security.apple.com/blog/expanding-pcc/]（2026-06-08）

PCC on Google Cloud 的底层：**NVIDIA Confidential Computing with NVIDIA GPUs、Intel CPUs with TDX、Google 的 Titan chip**；Apple 保留对 PCC 软件的完全控制，「Apple devices will only trust PCC software that is cryptographically approved by Apple」。[来源: https://security.apple.com/blog/expanding-pcc/]

### 端侧 vs PCC 的分工（Apple 官方隐私页）

> 「Apple Intelligence models run entirely on device. Apple Intelligence can use Private Cloud Compute, Private Cloud Compute uses larger, server-based models.」

[来源: https://support.apple.com/guide/iphone/apple-intelligence-and-privacy-iphe3f499e0e/ios]

### ChatGPT 集成

- 由 OpenAI 提供，**需用户显式开启**（设置 → Siri → ChatGPT → Set Up）。[来源: https://support.apple.com/guide/iphone/turn-on-chatgpt-iph00fd3c8c2/ios]；[来源: https://help.openai.com/en/articles/10269382-setting-up-chatgpt-with-apple-intelligence]
- iOS 26 确认集成 ChatGPT-5。[来源: https://forums.macrumors.com/threads/ios-26-to-bring-chatgpt-5-integration-to-apple-intelligence.2462999/]
- iOS 27 的 Siri app 支持在 Siri AI 与 ChatGPT 之间即时切换。[来源: https://www.bloomberg.com/news/articles/2026-03-26/apple-plans-to-open-up-siri-to-rival-ai-assistants-beyond-chatgpt-in-ios-27]（Bloomberg 2026-03-26：Apple 计划在 iOS 27 向 ChatGPT 之外的竞品助手开放 Siri）

---

## B.6 用户口碑

### 最集中的批评：Apple Intelligence 令人失望 / 迟到

1. **「Apple Intelligence is underwhelming」**——r/iphone 的专门讨论帖。[来源: https://www.reddit.com/r/iphone/comments/1hcffa1/apple_intelligence_is_underwhelming/]

2. **18 个月延迟**（这是 2026 年最主流的批评框架）：
   > 「Apple shipped on-device AI to more than a billion iPhones — and then made the world wait **18 months** for the one feature that mattered.」
   > 「The genuinely contextual, on-screen-aware Siri Apple demoed in 2024 only began rolling out in 2026, roughly 18 months late.」
   > 「the company that usually ships late-but-perfect did the opposite this time: it **shipped early-and-incomplete**, then delayed the headline feature again and again.」
   > 「Apple went from 'perfectionist' to **'a generation behind'** in the public's mind」
   [来源: https://valueaddvc.com/blog/apple-intelligence-2026-what-apples-ai-actually-does-and-what-it-still-cant]

3. **WSJ 系批评**：「Apple Fails to Clear a Low Bar on AI」——「Apple hasn't delivered an advanced version of Siri, and major improvements may not come until 2026.」[来源: https://talk.macpowerusers.com/t/apple-fails-to-clear-a-low-bar-on-ai-wsj/40954]

4. **通知摘要翻车（2025 年 1 月）**：BBC 就 AI 生成的错误新闻标题提出正式投诉；Apple 在 **iOS 18.3 中暂停了 News & Entertainment 类别的通知摘要**。
   - [来源: https://www.bbc.com/news/articles/cge93de21n0o]
   - [来源: https://www.bbc.com/news/articles/cq5ggew08eyo]
   - [来源: https://www.theguardian.com/technology/2025/jan/17/apple-suspends-ai-generated-news-alert-service-after-bbc-complaint]
   - [来源: https://www.axios.com/2025/01/17/apple-ai-news-alerts-fake-headlines]
   - [来源: https://9to5mac.com/2025/01/16/ios-18-3-temporarily-disables-apple-intelligence-notification-summaries-for-select-apps-more/]

5. **组织层面**：Bloomberg 报道 Apple 在 Siri 团队裁减岗位、重组以挽救 Siri 与 AI。[来源: https://www.facebook.com/bloombergbusiness/posts/1482199277099494/]（Bloomberg 官方账号帖）

6. **ChatGPT 在 Siri 里表现不佳**：MacRumors 2026-09-23「ChatGPT in Siri 'Persistently Underperforming,' Says OpenAI」。[来源: https://www.macrumors.com/2026/09/23/openai-siri-chatgpt-underperforming/]

### 针对提醒事项/任务自动化的具体抱怨

1. **「提醒事项基本啥也没变」**——MacRumors iOS 26 提醒事项文章下的高赞评论（Score 2）：
   > 「So for the reminders app pretty much a **complete nothing burger**. I don't use the AI/Siri stuff because it's currently garbage. There are so many other simple little changes that would dramatically improve useability but what we're getting is mostly just prettification. Not quite lipstick on a pig - Reminders is a useful app - but it could be so much better.」
   [来源: https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/]

2. **没有 time blocking**：「Why can't Apple Reminders do time blocking?」——「you can only set a single time as opposed…」[来源: https://www.reddit.com/r/gtd/comments/1gmo3w2/why_cant_apple_reminders_do_time_blocking/]

3. **用户质疑自然语言功能是否真的需要 Apple Intelligence（即门槛是否合理）**——MacRumors iOS 27 Calendar/Reminders 文章下的高赞评论（Score 6）：
   > 「To use the Apple Intelligence features in iOS 27, you need an iPhone 15 Pro or later. Yeah but the question here is: **do we need Apple Intelligence for those features, such as the natural language in calendar and reminders apps?**」
   [来源: https://www.macrumors.com/guide/ios-27-calendar-reminders/]

4. **Siri 在基础任务上反而更差**：「Siri AI is somehow less competent at doing basic tasks than before」（r/AppleReminders 讨论）。[来源: https://www.reddit.com/r/AppleReminders/comments/1r82ev3/siri_apple_reminders_honest_review/]

### 最有价值的称赞

1. **Writing Tools 是真正每天在用的那个**：
   > 「Writing Tools is the one I'd miss if it disappeared — a fast, private proofreader that lives inside every text field.」
   > 「The pattern is obvious: the small, bounded, on-device features are the wins.」
   [来源: https://valueaddvc.com/blog/apple-intelligence-2026-what-apples-ai-actually-does-and-what-it-still-cant]

2. **隐私 + 零成本 + 深度系统集成**：
   > 「Where Apple wins: Privacy (on-device + Private Cloud Compute), zero cost, deep OS integration, and reach across 1.5B+ devices. No app to open — it's just there」
   [来源: https://valueaddvc.com/blog/apple-intelligence-2026-what-apples-ai-actually-does-and-what-it-still-cant]

3. **「半成品」印象会随使用改变**：「I Thought Apple Intelligence Was Half-Baked. Then I Counted 30+ Features I Use Daily.」[来源: https://medium.com/the-useful-tech/i-thought-apple-intelligence-was-half-baked-then-i-counted-30-features-i-use-daily-1a43dfbe35dd]

4. **Siri AI 补上了「它本该能做的事」**——MacRumors 读者评论（Score 4）：
   > 「The more I read about SiriAI, the more I'm thinking it solves all the things that make people say, 'I feel like it SHOULD be able to do this'」
   [来源: https://www.macrumors.com/guide/ios-27-calendar-reminders/]

---

# C. 对 heyta 最相关的横向结论

| 维度 | 飞书（妙记 + 任务 + 豆包工作伙伴） | Apple（提醒事项 + Apple Intelligence） |
|---|---|---|
| 从会议/聊天捕获待办 | **有**：妙记「智能纪要」自动提取待办 → 一键「创建任务」同步到飞书任务；任务智能体可从妙记或对话**自动建任务** | **半自动**：iOS 26 Siri 建议从 Mail/Messages/Notes 提候选，用户点一下；iOS 27「Describe a reminder」用一句话自动填 date/time/location |
| 自动排期 / 时间块 | **无**（只有 Agent 的定时触发） | **无**（未找到公开信息） |
| 交互形态 | 对话助手 + 主动执行 Agent（云端） | 端侧 + PCC + ChatGPT 交接；建议为主，非自动执行 |
| 模型 | 豆包大模型（字节自研，原云雀）+ Kimi/GLM/DeepSeek/MiniMax 可选；全云端 | AFM 3 五模型：端侧 AFM 3 Core(3B) / Core Advanced(20B sparse)；PCC AFM 3 Cloud / ADM 3 Cloud(Image) / AFM 3 Cloud Pro（Google Cloud + NVIDIA GPU）；与 Google Gemini 技术合作 |
| 定价 | 套件 ¥50/80/120 人/月；AI 版本 18万/200万/600万/2000万 点/年；个人 AI 会员 69 元/月 1000 点；妙记免费 300 分钟/月；智能纪要 0.5 点/分钟、20 点/篇 | 随硬件免费；门槛 iPhone 15 Pro / iPhone 16+ / M1+；服务端功能有每日额度，未来「expanded access for a fee」 |
| 最大风险 | 点数消耗不透明、单次 Agent 任务可烧光月额度；AI 层全面收费化 | 被普遍认为迟到且平庸；提醒事项/任务自动化基本没动；服务端额度未来可能收费 |

**未找到公开信息**的项：
- 飞书套件「元/人/年」的官方定价口径（官网按人/月计价）
- 飞书 AI 四档版本的人民币年费官方数字（仅第三方文库给出 9,900 元/年、9.9 万元/年）
- Apple 任何形式的任务自动排期 / 时间块规划能力
- Apple Intelligence 每日额度的具体数值（Apple 未公布硬数字；见 https://support.apple.com/en-us/127901 与 https://twit.tv/posts/transcripts/ios-today-821-transcript）
