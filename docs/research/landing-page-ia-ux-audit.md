# heyta Landing Page：IA、帮助中心、产品演示与动效竞品审计

- 调研日期：2026-10-07（Asia/Shanghai）
- 范围：heyta 当前 Landing 与 `/docs` 文档中心；Todoist、TickTick、Linear 官方公开页面
- 证据标记：`[已核实]` 表示从官方页面的可见结构、链接或 HTML 直接确认；`[判断]` 表示基于这些证据给 heyta 的产品建议。
- 竞品页面是动态站点，以下记录的是本次抓取时看到的结构，不把未看到的行为写成事实。

## 结论

heyta 已经有一个相当完整的产品叙事底座：Hero 中放了真实应用 DOM mock，Showcase 复用真实视图数据，`three` 延迟加载，并且有 reduced-motion 路径。当前主要问题不是“没有内容”，而是首屏承载了太多并行解释：能力目录、完整工作区、五个视图的 300vh 滚动展厅、WebGL 同步和逐字加密连续出现，访客需要自己拼出“我先收集任务，再用视图处理，最后安全同步”的主路径。

竞品的共同做法是把信息入口按访客任务分层：Todoist 把“功能/模板/入门/帮助/下载”放在稳定的站点导航；TickTick 用五个可理解的结果（待办、日历、专注、习惯、倒计时）做功能叙事；Linear 直接把真实工作区嵌入营销页，并把产品能力按工作流分成 Intake、Planning、Build/Review 等。heyta 应采用同样的“任务路径”原则，但保留自己的本地优先、端到端加密和自建差异。

最优先的决策：Hero 只承担“这是一个真实任务工作区”的证明；Showcase 改成同一份 mock 数据的直接选择式预览；能力区从目录降为三步工作流；隐私/同步留在信任层；帮助中心首页提供问题入口和常见任务捷径，完整搜索继续留在文档外壳的 topnav。

## 1. 竞品官方页面观察

### 1.1 Todoist：稳定的产品入口 + 任务型帮助中心

**[已核实]** 官方首页 [todoist.com](https://todoist.com/) 的导航分为两大组：

- `Made For`：Task Management、Project Management、Time Management、Habit Forming、Teamwork；
- `Resources`：Integrations、Templates、Getting Started、Teams Toolkit、Help Center、Customer Stories、Productivity Methods + Quiz、Inspiration Hub、Downloads；
- 右侧主操作是 `Start for free`。

首页首屏包含可读的产品界面素材（HTML 的 `alt` 文本为“Todoist app interface showing daily tasks, projects, and team sections with a mobile view of task entry screen”），并用多个循环静音视频展示产品场景；这证明“真实产品形态”不需要把所有应用导航一次性塞进 mock，而可以用有限的场景逐步说明。

**[已核实]** 官方帮助中心 [todoist.com/help](https://todoist.com/help) 同时提供搜索和任务型入口。可观察到的一级/二级分类包括：

- Get started：Account basics、Download the apps、Guides、Privacy and security；
- Features：Projects and sections、Tasks and planning、Views/filters/labels、Reminders/notifications、Productivity and Karma、iOS、Android、Desktop；
- Billing、Teams、AI、Integrations、Troubleshooting、Product updates。

帮助中心首页还列出带具体问题的搜索入口，例如 “Reset my password”“AI features”“Create an automation”“Manage my subscription”。

**[判断]** Todoist 的可借鉴点不是“分类更多”，而是两个入口同时存在：

1. 访客不知道产品是什么时，走 Made For / Resources；
2. 用户已经遇到问题时，直接走问题词，而不是先理解产品分类。

heyta 的 `/docs` 已有搜索，但营销站的帮助枢纽仍应提供“第一次使用 / 同步失败 / 找回数据 / 隐私与 AI / 自建部署”这些高频任务捷径；不要把访客强制送进五个抽象模块后再自行猜入口。

### 1.2 TickTick / 滴答清单：结果导向的能力叙事 + 视频场景

**[已核实]** 官方功能页 [ticktick.com/about/features](https://ticktick.com/about/features) 的导航很短：Features、Download、Resources、Help Center、Productivity Guides、Sign Up for Free。页面的主叙事是 “Stay Organized, Stay Creative”，接着用五个访客容易理解的结果/场景作为入口：To-Do List、Calendar Views、Pomodoro、Habit Tracker、Countdown。

**[已核实，官方帮助文章]** 功能页的 AI 叙事可以在具体帮助文章 [AI Assistant](https://help.ticktick.com/articles/7503016104470511616) 交叉核对。文章把 AI 描述为应用内的单一 Assistant：用户在输入框发送自然语言消息，Assistant 返回建议，也可以执行相关任务动作；文章分别说明移动端、桌面端和 Web 的入口位置，并明确区分应用内 AI Assistant 与 MCP / CLI。这个页面是“AI 是一个面向用户的 Agent 入口”的直接产品证据，不能用来推断 heyta 已经有同样的可用能力。

随后页面按三层组织：

1. `Powerful and intuitive features`：日常计划与核心功能；
2. `Work smarter with AI`：Voice Capture、Audio Summary、Automated Workflows、MCP/CLI/OpenClaw 等；
3. `A comprehensive suite of features`：提醒、重复、自然语言日期、过滤器、快捷键、协作、集成、统计、主题。

每个前五大场景都带一个真实 UI 的静音循环视频，HTML 中明确出现 `video`、`preload="none"`、`loop`、`muted`、`playsinline`，并为移动端提供单独的 mobile video wrapper。[已核实] 页面底部再进入跨平台同步、媒体/用户评价和 CTA，而不是在首屏解释所有设置。

官方帮助页 [help.ticktick.com](https://help.ticktick.com/) 的可见标题是 “How can we …”，并把内容分为 `Feature Guide`、`Unique Features` 与 `Need more help?`；页头有 Sign up / Sign in、Upgrade、Download、Features，页脚有工单入口、集成和安全/隐私链接。

**[判断]** TickTick 的优势在于“先让访客选择自己想改善的结果，再展示产品”，而不是从内部数据模型或视图名开始。heyta 的“四象限 / 时间线 / 习惯 / 番茄钟”应作为“收集后如何处理”的连续路径表达，每个视图仍可保留真实 DOM，但文案应先说用户结果，再说视图名称。

### 1.3 Linear：把真实工作区当作叙事素材，并用工作流做 IA

**[已核实]** 官方首页 [linear.app](https://linear.app/) 的首屏 promise 是 “The product development system for teams and agents”，并直接在页面 DOM 中呈现应用工作区：侧边栏、My issues、Workspace、Initiatives、Projects、Favorites、issue 详情、评论、状态、优先级和 agent 操作。它没有把“真实产品演示”孤立成一个长展厅，而是让真实工作区成为每一段叙事的证据。

首页正文按工作流/阶段组织，页面 HTML 中可见：`Intake`、`Planning`、`AI and ...`、`Build, review, ...`，后面接 Changelog、Customers 与 “Built for the future. Available today.”。页脚按 Product、Features、Company、Resources、Connect、Legal 分组，并提供 Customers、Pricing、Docs、Download、Method、Changelog 等入口。

**[已核实]** 官方文档 [linear.app/docs](https://linear.app/docs) 的全站导航也按使用任务组织：Getting started、Intake、Projects and initiatives、Issues and cycles、Coding and review、Agents and automation、Insights and outcomes、Working in Linear、Administration、Integrations、Imports and Exports。首页另外给出 Popular（Start Guide、Import Issues、Projects、GitHub Automations）和 Linear basics（Workflows、Select Issues、Issue Relations、Display Options、Triage、Parent and Sub-Issues、Notifications、Teams）。

**[判断]** Linear 证明了两个重要方向：

- 产品 mock 可以直接承载“我能在里面做什么”的叙事；
- 帮助中心与营销页都可以沿同一条工作流 IA 展开，而不是营销页一套名字、文档另一套名字。

heyta 当前已经有真实 DOM mock，下一步的关键是让 Hero 与 Showcase 使用同一份 mock 数据、同一组视图名，并让每次交互都回答一个产品问题；不要继续叠加更强的 3D 形态来掩盖叙事层级。

## 2. heyta 当前事实与差距

### 2.1 已有基础设施（[已核实，源码证据]）

- 首页区块顺序是 Hero → Facts → Showcase → Capabilities → Sync/WebGL → Privacy → Pricing → Self-host → Final CTA，见 [`apps/landing/src/Landing.tsx`](../../apps/landing/src/Landing.tsx)。
- Hero 与 Showcase 都渲染 `AppWindow view="tasks"`，但 Hero 是静态证据，Showcase 是可切换的演示面；真实复现组件位于 [`apps/landing/src/mockup/`](../../apps/landing/src/mockup/)。
- Showcase 当前有五个视图：tasks、quadrant、habits、focus、timeline，见 [`Showcase.tsx`](../../apps/landing/src/components/Showcase.tsx)。
- Showcase 使用直接选择式 tab；只挂载当前视图，支持键盘左右切换和 `prefers-reduced-motion`。
- `AppWindow` 当前按 Web 实际外壳复现 rail → 范围侧栏 → 主区 → 选中任务详情栏；任务视图才显示范围侧栏、捕获框和详情栏，其他视图不会伪造这些区域。Landing 默认详情栏是任务详情，不额外画没有行为的 AI Chatbot 按钮。
- WebGL 的 `three` chunk 由 `Deferred` 延迟加载，并由 `SceneBoundary` 提供失败兜底；这是性能/失败处理上的成熟基础。
- 文档中心枢纽实际路径是 `/docs`（不是旧注释里写的 `/help`），分类是 `/docs/start`、`/docs/sync`、`/docs/organize`、`/docs/data`、`/docs/trust`，见 [`apps/landing/src/site/pages.ts`](../../apps/landing/src/site/pages.ts)。
- `/docs` 使用独立 `DocsShell`，搜索位于 topnav；搜索从同一份 `docs.ts` 派生标题命中，并能跳到文章锚点，见 [`DocsSearch.tsx`](../../apps/landing/src/site/DocsSearch.tsx)。

### 2.2 主要 IA 问题

1. **主路径不够单一。** Hero 已经是完整工作区，Showcase 又连续展示五个完整工作区，随后还有同步 WebGL 和隐私加密动画。每段都在证明产品“有能力”，但访客不容易回答“我用它的第一步是什么”。
2. **能力目录与工作流没有分层。** 六格 Capabilities 与四屏 Showcase 的关系需要读者自己解释；TickTick 用五个用户结果先建立认知，Linear 用工作流先建立阶段，heyta 应把“能力名称”降级成工作流中的证据。
3. **产品 mock 的真实性必须持续对账。** 这轮已补上任务勾选、视图直接切换和 AI Agent 详情栏；外壳结构由 `app-shell-shape` 登记并由测试与 Web 源码双向对账，避免“截图好看但装上后不是同一个产品”。
4. **帮助枢纽有内容，却缺少问题优先的入口。** `/docs` 的全局搜索已经存在；问题是 `/docs` 首页首先呈现模块列表，未把“第一次使用 / 同步失败 / 数据恢复 / AI 与隐私 / 自建”作为显式捷径。竞品的帮助中心把这些任务直接摆在入口层。
5. **帮助命名存在上下文风险。** 营销站在源码注释和用户心智中仍有 `/help` 叫法，但可见路由是 `/docs`。后续文案应统一为“帮助中心”品牌名 + `/docs` 技术路径，避免再造 `/help` 平行路由。
6. **可用性状态必须和 CTA 同步。** Todoist / TickTick 的主 CTA 是明确的 Start for free / Sign Up / Download；heyta 的托管和云端 AI 有“即将开放”状态时，Landing 不应出现让人误以为可立即付款或已全面可用的按钮。产品真实状态应在 Pricing、平台状态、AI Agent 演示三处一致。

## 3. 动效审计：证据、风险与原则

### 3.1 竞品可核实的动效形态

- **Todoist [已核实]**：产品场景使用静音循环视频，源码中有 `playsInline`、`loop`、`muted`，并提供 poster/视频资源；页面同时保留可见的产品界面 alt 文本。动效承担“操作前后发生了什么”的解释。
- **TickTick [已核实]**：五个功能场景使用 `preload="none"`、`loop`、`muted`、`playsinline` 的视频，并为移动端单独提供视频容器。动效绑定到单个功能卡，而非整页统一的 3D 场景。
- **Linear [已核实]**：静态抓取能确认真实 app DOM、章节和内容卡片，但无法由 HTML 单独确认滚动动画的具体曲线、时长或 reduced-motion 行为；这部分不作为事实推断。

### 3.2 heyta 当前动效风险

- WebGL 同步和 Privacy 逐字加密仍是页面中的高动效章节，因此必须保持在产品预览之后，并提供静态可读状态。
- 视图切换已从滚动跳转改为 tab 选择；移动端不再承担 300vh 的强制滚动跨度。
- WebGL 与逐字加密都有叙事价值，但它们应该在信任章节服务于“同步/加密发生了什么”，不应和产品工作区抢首屏注意力。
- 已有 reduced-motion 代码是优点，但需要验收“信息仍然完整”：关闭位移后，当前视图、步骤顺序、交互入口仍须可见，不能只剩空白淡入。

### 3.3 动效决策（[判断]）

1. Hero 保留一次轻量进入，去掉持续指针倾斜或把倾斜限制为极低幅度；产品界面必须稳定可读。
2. Showcase 改成直接选择式预览：五个按钮/标签切换同一舞台中的一个 `AppWindow`，切换使用短淡入/横向位移；滚动只负责进入/离开章节，不再占用 300vh。
3. 每个动效只能回答一个问题：
   - Hero：产品长什么样；
   - 视图预览：同一份任务如何被不同方式处理；
   - 同步：多端如何保持一致；
   - 隐私：数据在本地、加密后、同步通道中的边界。
4. 不新增装饰性动效。任何持续循环、旋转或 3D 变换都必须有静态 poster/DOM 等价内容，并支持 `prefers-reduced-motion`。

## 4. 推荐目标 IA

### 4.1 Landing 首页

```text
Hero：今天该做什么，一眼看见
  └─ 真实任务工作区（轻量 DOM mock）
↓
三步工作流：收集 → 安排 → 完成
  ├─ 自然捕获任务 / 单一 Agent 提案
  ├─ 列表、四象限、时间线选择处理方式
  └─ 专注与习惯帮助完成并复盘
↓
真实产品预览：同一份 mock 数据切换四种视图
↓
同步与隐私：本地优先、加密、跨设备一致
↓
选择部署：自建 / 官方托管 / 云端 AI（按真实可用状态标注）
↓
价格、帮助、开始使用
```

这条顺序保留 heyta 的差异化内容，但把功能目录改成“使用流程”。Capabilities 可以继续存在，改为三张阶段卡；视图名作为每个阶段的证据，而不是六个平级卖点。

### 4.2 帮助中心 `/docs`

```text
帮助中心
├─ 搜索：输入“同步失败 / 如何导出 / AI / 自建”
├─ 快速开始
│  ├─ 第一次使用
│  ├─ 创建第一条任务
│  └─ 在多个设备上同步
├─ 解决问题
│  ├─ 登录与同步
│  ├─ 离线与冲突
│  ├─ 数据迁移与恢复
│  └─ 隐私与 AI
├─ 使用方式
│  ├─ 任务、清单与重复
│  ├─ 四象限与时间线
│  ├─ 习惯与专注
│  └─ 提醒与通知
└─ 自建与部署
```

实现上继续让 `HELP_MODULES` / `docsOutline()` 做唯一 IA 真源，不另造第二张分类表。新增加的是首页的“任务快捷入口”派生层：每个快捷入口指向现有文章或文章 section；没有对应文章就不渲染链接。搜索继续放在 `DocsShell` topnav，窄屏保持可用。

### 4.3 产品 mock 交互

当前只做两种可观察交互，避免把营销页伪装成完整应用：

- 点击任务复选框：更新 mock 的完成状态，并显示一次轻量反馈；
- 点击视图标签：在同一份任务数据上切换 tasks / quadrant / timeline / habits / focus；

Agent 暂不提供 Landing 内的输入框或确认按钮：当前 Web 预览的右栏是任务详情，产品仍只有一个真实 Chatbot/Agent 入口；在没有真实请求、提案和确认链路前，添加“演示 Chatbot”会制造错误的可用性承诺。已有交互应标注“演示数据”或以辅助文案说明，不触碰真实用户数据，也不暗示 Landing 已连接真实后端。

## 5. 优先级与验收判据

### P0：降低认知成本

- Hero / Showcase 只保留一个真实工作区主视觉，删除重复的完整壳展示；
- Showcase 从 300vh sticky coverflow 改为直接选择式预览；
- 页面文案把 AI 统一为一个 Agent，工具调用不出现在访客层；
- Pricing、CTA、平台状态对“可用 / 即将开放”使用同一事实源。

验收：首次打开首页时，访客能在 10 秒内回答“这是任务管理产品、我可以怎样处理任务、现在能否开始使用”；键盘与触屏均可切换视图；`prefers-reduced-motion` 下仍能看到五个视图与当前状态。

### P1：让帮助中心按问题工作

- `/docs` 首屏增加快速开始与解决问题入口；
- 快捷入口全部指向已有文章/section，由 `docs.ts` 派生；
- 文章页继续保留侧栏、目录、面包屑和搜索；
- 统一所有用户可见文案的“帮助中心”称呼，URL 仍为 `/docs`。

验收：用户输入“同步”“导出”“AI”“自建”可以命中文章；从 `/docs` 首页最多两次点击到达对应答案；无结果时给出可理解的下一步；中英文入口与标题一致。

### P2：动效与真实性打磨

- Hero 只保留轻量入场；
- 视图切换提供 DOM 静态等价状态；
- WebGL 与 Privacy 动效继续延迟加载并提供静态 fallback；
- 真实 mock 交互加入演示标识，并确保不会触发真实 API。

验收：移动窄屏无横向溢出和过长的强制滚动；降低动效后没有信息丢失；无 WebGL、弱网或视频不可用时仍可理解产品；Lighthouse/浏览器性能检查不因首屏加载额外引入新大资源。

## 6. 证据边界

- 本文只引用竞品官方页面，没有把媒体评论、用户评价或搜索摘要当作产品事实。
- 竞品页面结构会随部署更新；若要形成长期门禁，应把本报告中的“入口名/页面路径”改成定期抓取快照，而不是依赖人工记忆。
- Todoist 与 TickTick 的视频形态已从本次官方 HTML 确认；Linear 的具体 motion 曲线没有从静态源码确认，因此本文只将其真实 DOM 和工作流结构作为证据。
- 本报告保留了改造前的 300vh / coverflow 作为审计基线；当前实现已改为 tab 选择式预览。后续若 Web rail 或详情栏变化，应先更新结构登记与对账测试，再更新 Landing mock。
