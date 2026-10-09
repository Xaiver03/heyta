# 产品 UI / UX / IA 优化计划

> 状态：**已公开分发第五批测试版 B5，协议阅读已部署 Web 并在 Android 安装包点验；完整跨端交互验收仍未完成。**（2026-10-08）
> 最新发布见 [B5测试版](https://github.com/Xaiver03/heyta/releases/tag/v1.0.1-test.20261008.5) 与 [资产对账](../../apps/web/evidence/ux-final-20261008/auth-consent-registration/release-b5-asset-verification.json)：macOS、Windows、Android 附件已发布，iOS 为已关联内部组的 TestFlight 1.0(7)。Mac本机安装待解锁，实体 iPhone 未验；COS下载清单与Linux仍为B4。B4来源边界仍见 [`release.json`](../../apps/web/evidence/ux-closeout/release-2026-10-08-b4/release.json)，不能外推为同一冻结源码。系统组件验收见 UX-S9-138，最新协议验收见 UX-S9-148；更早发布及“待重装”文字为历史快照。
> 依据：[`../research/product-level-ia-ux-audit.md`](../research/product-level-ia-ux-audit.md)（合并裁决稿）；补充基线：[`../research/product-ux-ia-aesthetic-audit.md`](../research/product-ux-ia-aesthetic-audit.md)  
> 目标：把产品从“功能面过宽的精致后台”收敛成“本地优先、执行优先的任务工作台”。

本计划的跨端交互专项见 [`cross-platform-ux-optimization.md`](cross-platform-ux-optimization.md)，审计证据见 [`../research/cross-platform-interaction-ux-audit.md`](../research/cross-platform-interaction-ux-audit.md)。

## 0. 执行原则

1. 先修主路径，再修装饰。
2. 不新增一级模块，不做全局玻璃化。
3. 每个交互规则只有一个产品事实源；文档、代码、截图必须指向同一模型。
4. 每批改动都要有截图或可重复的交互证据，不能只看类型检查。
5. 与当前工作树中的其他改动隔离；不覆盖无关文件。

## 1. 目标 IA

### 一级目的地

任务、日历、习惯、搜索常驻；专注是可在设置中开启的高级目的地，开启后从“更多”进入。

### 任务范围

收集箱、今天、最近 7 天、已完成、清单、标签、自定义筛选。

### 次级工具

四象限、时间线、便签、倒数日、成长、回收站。

### 全局入口

同步、账户、设置、帮助、数据导出、隐私与安全。

## 2. 批次与状态

状态值：`待开始` / `进行中` / `待验收` / `完成` / `阻塞`。

| ID | 批次 | 工作项 | 主要文件 | 验收标准 | 状态 |
|---|---|---|---|---|---|
| DOC-1 | 文档 | 固化审计结论与 IA 目标 | 本文与审计文档 | 结论、原则、目标 IA 可被其他任务直接引用 | 完成 |
| IA-1 | IA | 统一 rail / sidebar / tools 分层，消除“更多”矛盾 | `view-tabs.ts`, `App.tsx` | 代码只保留一套导航策略；低频模块有明确入口 | 完成 |
| IA-2 | IA | 设置、帮助、账户从对象详情上下文中隔离 | `App.tsx`, settings surfaces | 打开设置/帮助/搜索时无无关详情列 | 完成 |
| WEB-1 | Web 交互 | AI 收敛为单一 Agent / Chatbot；工具调用只作为内部过程状态 | `App.tsx`, `AssistantPanel.tsx`, AI feature CSS | Web 与移动端各只有一个 Agent 入口；工具目录不作为并列产品面；提案仍需确认 | 完成 |
| WEB-2 | Web 视觉 | 详情列按四组组织，高级 RRULE 默认收起 | `TaskDetailCard`, task styles | 基本信息、时间、组织、自动化四组清晰 | 完成 |
| WEB-3 | Web 视觉 | 统一四象限空态信息层级 | `QuadrantBoard`, quadrant styles | 保留 2×2 心智模型铺满空间；引导文案去重、标题带计数、规则说明进帮助 | 完成 |
| MOBILE-1 | 响应式 | 窄屏底栏只承担一级目的地，范围改为页面内控件 | `narrow.css`, shell components | 中文标签单行；不再合并整条 sidebar | 完成 |
| DS-1 | 设计系统 | 补组件行为契约和密度/状态规范 | `docs/reference/design-system-behavior.md` | 新组件能从规范选择 list/board/pane/sheet | 完成 |
| CORE-1 | 产品语义 | 决定并实现任务排序、父子完成/删除语义 | `task-order.ts`, `subtasks.ts`, actions | UI 行为、领域函数、跨端结果一致 | 完成（排序已统一；父子完成保持独立，父删除保留软删除并在读侧提升子任务） |
| PERF-1 | 体验性能 | 给任务列表与同步热路径建立用户可感知基线 | `scripts/measure-product-ux.mjs`, `scripts/measure-hydration.mjs` | 500/1000/5000 条任务下有可重复读数 | 完成 |
| EVIDENCE-1 | 项目治理 | 重取当前代码对应的关键截图 | `apps/web/evidence/product-ux-2026-10-06/` | 旧顶栏截图与新 rail 基线不再混用 | 完成 |

## 3. 执行顺序

### 批次 A：方向和主路径（已完成）

IA-1、IA-2、WEB-1、MOBILE-1 必须先完成。它们决定用户如何理解产品，不能被视觉细节抢先覆盖。

### 批次 B：内容面和编辑面（已完成）

WEB-2、WEB-3、DS-1。完成后再处理材质、动效和图标细节。

### 批次 C：产品语义和性能（已完成）

CORE-1、PERF-1。没有排序和父子任务语义，继续增加复杂编辑器会放大返工。

### 批次 D：证据与交付（代码与 Web 证据完成，B3 四端重建安装完成）

EVIDENCE-1，并对所有已完成项做截图、交互、测试和文档回读。

## 5. 本轮拍板的产品语义

- **排序**：默认未完成在前、截止时间升序、无截止时间最后；用户可切换添加时间或优先级。排序是设备本地阅读偏好，不写入 op-log。
- **父子完成**：父任务和子任务独立完成。勾选父任务不级联勾选子任务，子任务全部完成也不自动改写父任务；详情面只展示真实完成状态。
- **父任务删除**：删除仍是可恢复的软删除单 op。子任务不被级联删除；父节点在读侧消失后，子任务作为顶级任务显示，并通过领域树的 `promotedFromDeletedParent` 留痕。
- **批量操作**：一个用户意图只产生一个带批量作用域的 op；删除使用 `DEL`，字段批量更新使用 `BATCH`。重复任务混入选择时，批量完成必须阻止整批写入并解释原因，不静默跳过。
- **撤销**：本阶段只承诺批量删除后的 5 秒撤销。批量完成与移动暂不显示撤销入口，避免在没有保存原始字段快照时制造错误的可逆承诺。

这组选择优先保护可恢复性和用户意图的可逆性，避免一次点击静默影响多条任务。若未来要提供级联删除，应作为显式批量动作另立产品决策与确认文案。

## 4. 验收矩阵

### 产品体验

- 新用户进入任务页后，首个视觉焦点是新建任务。
- AI 工具调用不抢占新建任务，但仍可被发现和键盘访问。
- AI 只有一个 Agent 入口：对话、执行状态、出境披露、提案和确认在同一条体验链路内；工具授权留在设置。
- 设置、帮助、搜索不会保留无关任务详情列。
- 窄屏底栏标签不换行、不竖排，范围筛选仍然可达。
- 四象限、时间线、习惯的层级关系能从导航结构直接理解。

### 设计系统

- 所有新增样式继续使用语义 token。
- 新增组件状态至少覆盖 default、hover、focus、selected、disabled、loading、empty、error。
- 材质只用于悬浮层或导航，不进入任务行、表单、日历格等内容面。

### 工程与证据

- 每个批次有对应的单元或交互测试。
- 每个视觉结论有当前源码对应的截图。
- 文档中的导航策略与 `view-tabs.ts`、移动端 `TabBar`、设置入口一致。
- 不能把旧产物或旧截图当成当前实现的验收依据。

## 5. 明确不做

- 不增加新的一级功能模块。
- 不把所有表面改成玻璃。
- 不为 Linux 手写一套与共享 UI 不一致的业务界面。
- 不通过隐藏模块、删掉台账或修改截图来制造“完成”。

## 6. 收尾验收（2026-10-07）

- `pnpm --filter @heyta/web test`：**2065 passed / 13 skipped / 0 failed**（160 个测试文件，2 个文件级跳过）。本轮同步更新了日历月格、事件条、滚轮与个人中心入口的旧断言，使测试反映当前“月格直显、隐藏重复日清单”和“个人中心 → 编辑资料”路径。
- `pnpm --filter @heyta/web build`：通过；Vite 产物已生成。现有大 chunk 仅为构建提示，不影响产物生成。
- 当前代码截图：`apps/web/evidence/product-ux-2026-10-06/` 的桌面任务、更多菜单、窄屏任务与窄屏更多菜单均由当前 Vite 工作树重新截取；W02/W04/W05/W06/MW02 目标也通过截图流水线的真实导航路径复跑。
- 截图流水线现在会：先清首启遮罩；默认关闭的模块通过设置页开关启用；低频视图从真实「更多」菜单进入；窄屏先把横向滚动中的入口滚入视口；点击后仍回读 `aria-selected`，不接受“命名对但视图没切”的假证据。
- 性能基线已记录在 [`../reference/product-ux-performance-baseline.md`](../reference/product-ux-performance-baseline.md)，设计行为契约已记录在 [`../reference/design-system-behavior.md`](../reference/design-system-behavior.md)。

## 7. 历史批次记录（2026-10-07 至 2026-10-08）

本节保留各批次的实施过程和原始判断。批次中的“待重装”“尚未发布”等文字只描述当时截面；当前状态以文末 B3 行动表为准。

开放项已由 [`../research/product-decision-record.md`](../research/product-decision-record.md) 裁决：

| ID | 工作项 | 交付物 | 验收 | 状态 |
|---|---|---|---|
| BRAND-1 | 页头品牌眉标与蓝白识别深化 | `App.tsx`、`main-area.css` | 亮/暗/窄屏可见，不挤压页标题 | **被 BRAND-2 替代** |
| BRAND-2 | 应用工作区移除品牌 Logo；保留系统图标、Landing 与关于页品牌露出 | `App.tsx`、`main-area.css`、Landing/关于页 | 工作区不出现品牌 Logo 占位；系统图标、Landing、关于页仍保留品牌识别；不挤压任务主路径 | **待实施/待验收** |
| BULK-1 | Web 任务多选、批量完成/移动/软删除 | `app-host` actions、Web task UI | 单一批量作用域 op、键盘/触摸可达 | 完成 |
| UNDO-1 | 批量删除短时 undo toast | Web shell | 删除后 5 秒内可撤销，过期自动消失 | 完成 |
| LIST-1 | 清单级设备本地排序偏好 | `project-sort-pref.ts`、任务页 | 按清单记忆，不进 op-log | 完成 |
| MOBILE-2 | 移动端 push/pop 二级导航栈 | `apps/mobile/src/nav`、`App.tsx` | 返回优先 pop，tab 状态保留 | 完成（原生实机仍需安装当前产物） |
| SETTINGS-1 | 设置页分类导航与渐进披露 | `App.tsx`、`sheets.css`、i18n | 桌面目录 + 窄屏横向目录；关闭出口在首屏；内容不透字；保留上次分类位置 | **代码已落地；iOS 设置旅程通过，Android 最近一次 Profile/Settings 旅程通过；完整四端入口、返回和状态矩阵仍待补齐** |
| RELEASE-1 | 四端重装验收 | `pnpm reinstall:all` 分端证据 | 四端当前产物均安装并启动 | **B3 已完成：`fourPlatformReinstall: true`；交互专项仍按各 Goal 的独立边界验收** |

以下平台表是 2026-10-07 的历史截面；其中“待重装”只描述当时状态。B3 已完成四端重建安装，但各 Goal 的交互证据仍以文末当前行动表为准。

| 端 | 当前产物证据 | 安装/启动与交互证据 | 状态 |
|---|---|---|---|
| macOS | [当前签名 App 的 WebView 证据](../../apps/web/evidence/settings-finish-release/macos/installed-webview.png) | 手动安装当前签名 App；WebView/M2 account/settings 通过；锁屏阻碍系统窗口截图与物理点击 | **系统截图与物理点击待补** |
| Windows | [当前安装态 UX 证据](../../apps/web/evidence/settings-finish-release/windows/) | 当前 MSIX 已安装；Chatbot、设置选中态、控制台与 Profile → Growth 旅程均已取得安装态证据 | **当前安装态已验；其余跨端交互仍待收口** |
| Android | [阶段性设备报告](../../apps/mobile/evidence/settings-release/android/journey.json) | 键盘返回修复单测 833 项通过；修复产物 `1a8f83...` 已完成 14 步旅程与 Profile；该产物早于本轮动画/颜色源码，新的统一重装尚未开始 | **旧键盘待验记录保留；新产物与当前源码 APK/hash、真机交互待验收** |
| iOS | [阶段性 bundle 报告](../../apps/mobile/evidence/settings-release/ios/artifact.json) | iOS 重新安装后的 `profile-final` 已通过；该产物早于本轮动画/颜色源码，新的统一重装尚未开始 | **Profile 当前态已验；当前源码重装与其余跨端交互仍待收口** |

交付边界：Android 使用现有 debug 签名回退，是内测安装包；iOS 本次安装目标是模拟器，不代表真机签名或上架产物。移动端未配置 AI 时继续隐藏助手入口；本轮没有为了截图开启外部模型或工具权限。

## 8. 历史设置页 UX 专项复审（2026-10-07）

本节记录当日复审截面；其中的“最终多端验收待完成”等文字不覆盖文末 B3 当前行动表。

这次复审只接受“用户能看懂当前在哪、当前状态是什么、下一步能做什么”的证据，不把类型检查或静态门禁当作产品 UX 完成证明。

### 8.1 本轮已合流

- **分类导航高亮**：设置目录由静态锚点改为可控导航按钮，当前组使用 `aria-current="page"` 与填充高亮，放弃透明下划线/边框作为选中态。
- **渐进披露**：设置默认只显示当前选中的分组，避免七组内容同时堆成长页面；窄屏保留横向目录。
- **组件表面**：设置分组内的主要面板增加统一的 surface/card 边界，减少“全靠文字排版猜层级”的问题；显示 radio、功能模块卡片已补选中高亮、可见字段标题与触控尺寸。
- **小组件归位**：桌面小组件安装与后台刷新从“账号与安全”移入“任务与显示”，其产品语义是设备/显示能力，不是账号安全。
- **AI 产品面**：AI 已收敛为一个 Agent/Chatbot 入口；工具调用属于内部过程，工具授权仍留在设置。AI 设置使用结构化 token 控件；工具权限按只读/写入分组，显示中文名称与技术 details。
- **账号产品面**：账号相关入口收敛为一个登录入口，续费、账号安全、危险操作拆成三个明确组件区；不再把账号动作与小组件混在一起。
- **设置位置记忆**：保留用户上次选择的设置分类位置。它是产品裁决，不因渐进披露而每次回到默认分类；首次进入才使用默认分类。

### 8.2 逐项审计与未完成项

| 分组 | 当前问题 | 下一步 | 状态 |
|---|---|---|---|
| 个人资料 | 资料编辑区仍需继续统一摘要、编辑和返回路径的细节 | 保持从头像菜单进入后的返回路径，继续核对 ProfileSummary/ProfileEdit 的真实端间表现 | 已完成本轮结构改造，细节回归随账号验收 |
| 任务与显示 | 小组件安装说明在原生壳内仍可能把壳环境识别成浏览器，导致显示错误的“如何装成应用”步骤 | 修正原生壳/浏览器能力识别；保留提醒权限的成功、拒绝、不支持与错误状态卡 | **radio、功能卡、提醒状态卡、字段标题、触控尺寸和高亮已完成；Widget 环境识别已在 UX-S9-153 改掉（判据与三条变异臂见该节），原生壳内的真实界面读数仍待取** |
| 同步与隐私 | 服务器地址、凭据、Vault、隐私同意连续排列；连接状态、数据出境状态与操作按钮不在同一视觉层 | 已拆为“同步服务 / 账号凭据 / 端到端加密 / 隐私状态”四张卡；失败状态提供下一步动作 | **代码已落地；最终多端验收待完成** |
| AI 与集成 | Agent 入口已统一；仍需持续验证 token 权限分组在各端的可理解性 | 保留一个 Agent 主入口；设置内维持“使用方式 → 出境 → 能力 → 记忆”的渐进层级 | **已完成本轮结构改造，保留跨端回归** |
| 数据管理 | 导出、空库还原、滴答迁移、管理员后台混在一组；限制条件依靠长段落说明 | 拆为“备份与恢复 / 从其他产品迁移 / 管理员工具”，限制改为 warning/info callout | **代码完成：`DataSettingsPanel` 已拆为三张卡，空库、仅本地与格式限制均有独立状态卡；保留端侧产物回归** |
| 账号与安全 | 结构已拆开；仍需验证登录入口、续费和危险操作在未登录/已登录状态下的反馈 | 保持“订阅与托管 / 登录与安全 / 删除账号”三个明确子区，危险操作独立放底部 | **已完成本轮结构改造，保留状态回归** |
| 关于与帮助 | 帮助动作行已使用共享 SettingsRow，并可由分类目录及全局帮助入口直达 | 保留设置内入口，同时从头像菜单/全局入口直达帮助中心；不把帮助文章混进配置表单 | **Web 侧直达已有真浏览器判据**（`e2e/tests/settings-category-ux.spec.ts` 的帮助入口一档，2026-10-09 读数 7/7，见本节"继续验收记录"）；原生壳内的直达与外链点击仍待取 |
| UX-S9-29 显示：日期 / 倒计时 | 显示偏好已从整宽长行收成单层 segmented control，选中态用填充高亮，仍保留原生 radio 语义与键盘焦点 | 继续保持紧凑控件；四端安装态复验时检查标签、焦点与本地偏好持久化 | **代码完成；Web 1440/375 亮暗浏览器验收通过，四端最终重装待验收** |
| UX-S9-30 显示：常驻 / 收起 | 常驻 / 收起复用日期显示的同一紧凑选择组件；长说明保留为作用提示，不再制造第三层卡片 | 继续保持同一选择语法；四端安装态复验窄窗口下的自动收起行为 | **代码完成；Web 1440/375 亮暗浏览器验收通过，四端最终重装待验收** |
| UX-S9-31 显示：中文 / English | 语言组已具备自称、`aria-current`、`lang` 与键盘路径；选中态改为填充高亮并与显示控件同层，不再使用下划线或额外面板 | 继续保持单层紧凑选择；四端安装态复验中英切换与返回路径 | **代码完成；Web 1440/375 亮暗浏览器验收通过，四端最终重装待验收** |
| UX-S9-32 显示：暗色切换 | 主题切换已收敛为直接可见的紧凑按钮，保留当前状态、图标和焦点环，移除无关长说明与厚重嵌套表面 | 继续保持直接切换；四端安装态复验亮暗主题与窗口重启后的偏好 | **代码完成；Web 1440/375 亮暗浏览器验收通过，四端最终重装待验收** |

### 8.3 设计规则

- 选中态使用填充背景、语义色、勾选或状态徽标表达；不使用单独的下划线作为主要状态反馈。
- 每个设置项至少有四个明确槽位：名称、作用说明、当前状态、动作。状态不能只藏在一段 muted 文案里。
- 组标题、卡片标题、字段标签必须分别使用不同语义层级；不能让组标题和面板标题都显示成同一级“大标题”。
- 组件不可用、浏览器拒绝、未登录、尚未配置等状态必须有明确结果，不渲染用户点击后必然无效的开关。
- 长文案只解释原因；操作限制、风险和下一步动作分别进入状态卡或 callout。

### 8.4 本轮明确未完成

本轮仍不能宣称“设置页已经完成四端验收”。同步与隐私已经完成四卡结构与状态动作分层，显示选项、功能卡、提醒/隐私状态卡、账号三分区、数据三卡与限制状态卡、AI 单一 Agent 结构也已经落地；原生壳中的 Widget 安装说明环境识别已由 UX-S9-153 改掉判据（不再把存储宿主的排查逃生门当成壳身份），剩余工作是原生壳视觉回归，以及从同一源码冻结点完成最终四端构建、安装和交互验收。上述残留属于最终验收与环境适配范围，不应再记录为“同步/隐私尚未实施”。

### 8.5 本轮验证读数

- 本轮 Web 单测为 **160 个测试文件通过、2065 项通过、13 项跳过**；其中设置、账户、个人资料、More 菜单与日历定向集合均通过。Web spec typecheck 通过，Mobile typecheck 通过。
- 浏览器证据为 **timeline-p2 1 项 + 视口矩阵 1 项**；其中视口矩阵覆盖 **29 个视口断言组**。真实读数与截图保存在 [`apps/web/evidence/settings-finish/viewport-metrics.json`](../../apps/web/evidence/settings-finish/viewport-metrics.json) 及同目录截图中。
- 视口断言保证 `document` 不横向溢出、应用填满视口、顶部主操作在视口内，并在窄/矮窗口自动隐藏详情栏；同步 rail 的窄屏定位已在当前实现中修复并通过复验。
- 浏览器矩阵和阶段性端侧截图材料可以作为方向证据；它们不替代源码冻结后的四端重装验收。
- Windows 当前已取得安装版 Chatbot DOM 验收证据；Web 浏览器旅程仍不能替代尚未覆盖的 Windows 原生交互证据。
- 单一 AI 助手浏览器旅程通过：披露前无出站、确认后多步只读调用、会话重置及权限档位持久化；模型回复来自本地测试端点。
- Windows 限制：安装、启动、Chatbot/设置 DOM 与 Profile → Growth 证据成立；不将这些局部安装态证据扩展为全部 Windows 壳交互已通过。

### 8.6 hidden / active 只读复审（2026-10-07）

设置页采用“所有分组保留在 DOM、只有当前分组不带 `hidden`”的渐进披露方式。因此 `active` 不是视觉开关，而是控制隐藏分组是否启动读取、监听或异步副作用的运行时门控。逐项对照当前源码的结果如下：

| 表面 | 当前真实状态 | 结论 |
|---|---|---|
| Profile / Sync / Vault / Privacy | `App.tsx` 按当前分组传入 `active`；Profile、Sync、Vault、Privacy 的 effect 与异步回调均检查它 | **已门控**：切换分类不会播种草稿、请求资料或更新隐藏状态 |
| Data / Admin / Passkey | `DataSettingsPanel` 接收并转发 `active`；Admin 探测与分标签加载、Passkey 列表加载均检查它 | **已门控**：隐藏时不发管理员/通行密钥请求 |
| Data 的 Export / Import / TickTick | 三个面板没有挂载期网络 effect；空库、仅本地、格式限制均由 `SettingsNotice` 直接呈现，读取本地库或文件只在用户点击后发生 | **代码完成**：隐藏时不会发请求，限制状态已组件化 |
| ReminderNotifyPanel | 当前没有 `active` prop；监听 `visibilitychange` 后重新读取浏览器真实通知权限 | **按设计保留**：这是本地只读能力监听，用于用户从浏览器设置返回时更新状态，不是远端读取或用户写入 |
| WidgetJourneyPanel | 当前没有 `active` prop；执行一次本地 standalone / host 能力探测 | **按设计保留**：这是本地只读宿主能力探测，用于显示正确安装状态；不发网络请求 |
| AiSettings / 显示选项 / 功能模块 / 账号密码与续费 | 隐藏时主要是受控状态与事件处理；网络动作在用户点击后触发，未发现挂载期出站请求 | **只读安全**：当前无需为纯交互状态强行增加 active |

所以，当前结论不是机械要求所有隐藏组件都接收 `active`：会读取远端或同步状态的主要面板已经门控；Reminder 与 Widget 的本地只读监听/探测按设计保留，以便返回页面时反映真实系统能力。

## 9. 历史截图驱动整改清单（2026-10-07，主工作区与 AI 结构复审）

本节是逐项原始台账，保留问题、验收要求和历史证据。活动 Goal 的当前分类与下一步以文末 B3 当前行动表为准。

本节记录截图复审发现的实际产品问题，作为下一轮实现的逐项收口清单。它不替代 §7 的批次状态，也不把中间版四端安装证据写成最终验收。每一行都必须经过“实现 → 当前源码截图 → 交互验收 → 四端产物复验”四步，才可以把状态改为 `完成`。

本轮保留已经拍板的产品裁决：**闲置时右侧栏默认显示 Chatbot**。这条裁决不因主任务区被挤而推翻；修法是调整列比例和窄屏呈现方式。窄屏/窄窗口的右栏按需变成 overlay 或 sheet，任务内容保持完整宽度，不把 AI 内容硬塞进任务列表，也不让用户先拖大窗口才能看全页面。

### 9.1 主工作区、AI 与导航

| ID | 截图中的问题 | 决策 | Owner | 实现 | 验收 | 状态 |
|---|---|---|---|---|---|---|
| UX-S9-01 | 侧栏、任务列表、详情栏、AI 右栏同时占宽，主任务区被挤成“能用但不舒服”的窄列 | 保留右栏默认 Chatbot；主任务区优先级最高，给 rail/sidebar、任务区、详情/AI 设明确最小宽度、弹性比例与收缩顺序 | 主布局 agent | `apps/web/src/styles/app/base.css`、`assistant-layout.css`、`narrow.css` 与 `App.tsx` 统一 rail/sidebar/main/detail 轨道；详情轨道使用 token + `clamp()`，AI 窄面进入 overlay，主任务区保持可读宽度 | `e2e/tests/ux-viewport-matrix.spec.ts` 真实矩阵覆盖 768–1440 及矮窗口；`apps/web/evidence/settings-finish/viewport-metrics.json` 记录应用填满视口、主操作在视口内、详情按空间退场；`apps/web/evidence/ux-final/assistant-*.png` 提供栏比例截图 | **代码完成；Web 视口矩阵与 AI 栏比例证据已生成；父级视觉复核与四端最终重装待验收** |
| UX-S9-02 | 窄窗口仍尝试把所有栏塞进同一横向布局，内容被压缩或产生横向滚动 | 窄屏将详情/AI 变为按需 overlay/sheet；任务内容仍是唯一主层 | 主布局 agent | `App.tsx` 的 `assistantOverlay` / `assistantWorkspace` 与 `apps/web/src/styles/app/assistant-layout.css`、`narrow.css` 实现按可用宽度切换；`assistant-expanded-ux.spec.ts` 保留草稿、展开/收起与焦点路径 | `e2e/tests/ux-viewport-matrix.spec.ts` 断言 document 无横向溢出和详情退场；`e2e/tests/assistant-expanded-ux.spec.ts` 覆盖 1440/1280/390；`apps/web/evidence/ux-final/` 有亮暗窄屏展开截图 | **代码完成；Web overlay/viewport 浏览器证据通过；原生壳与最终四端安装态仍待验收** |
| UX-S9-03 | AI 建议卡内容随机换行，空态占据巨大面积，用户不知道下一步能问什么 | 空态固定为紧凑、可扫描的建议顺序：查任务 → 新建 → 修改 → 总结/安排；建议是短句按钮而不是大段随机文本 | sync agent | `AssistantPanel.tsx` 已落地固定空态、建议按钮与 composer；`ai-panels.css` 已统一空态间距、最大行宽和底部输入布局；建议点击只填入 composer，不直接写库 | `e2e/tests/ai-assistant.spec.ts`、`e2e/tests/assistant-hosted-ux.spec.ts` 与 `apps/web/evidence/assistant/` 已提供 DOM/交互和真实截图证据；移动端与父级整合 surface 仍待最终验收 | **代码完成；Web DOM/建议交互通过，B3 已包含修订；移动端/原生父级整合仍待验收** |
| UX-S9-04 | AI header、messages、composer 没有形成明确三段结构，上下留白失衡，输入框像页面顶部表单而不是对话底部 | AI 面板采用固定三段：header（身份/新会话/权限状态）、messages（可滚动内容）、composer（底部贴边输入）；composer 不随消息数量漂移 | sync agent | `AssistantPanel.tsx` 与 `ai-panels.css` 已落地 header / messages / composer 三段结构；消息区使用可收缩滚动布局，composer 固定在底部；长回复只滚消息区 | `e2e/tests/assistant-hosted-ux.spec.ts` 与 B3 `release.json` 的 `webAssistantProviderJourney: 2` 已覆盖 Web/provider 旅程；移动端与原生壳完整 AI 交互矩阵仍待验收 | **代码与 Web/provider 旅程已通过；移动/原生壳完整矩阵待验收** |
| UX-S9-05 | AI 权限档位默认偏保守且切换路径像设置项，已授权能力还需重复进入设置，执行感弱 | AI 面板允许直接切换权限档位；默认使用可执行档位，但**写操作永远只生成提案，必须经用户确认才落库** | sync agent | `AssistantPanel.tsx` header 已提供 `ai-assistant-tier-select`；档位说明、出境披露和工具目录状态在同一 Chatbot；`aiStore` 仍是设置持久化事实源 | `e2e/tests/ai-assistant.spec.ts` 覆盖默认 `read-and-propose`、切换后刷新持久化、提案确认前不创建/确认后只创建一次；`apps/web/evidence/assistant/3-settings-tier.png`、`proposal-*.png` 可核查 | **代码完成；Web 浏览器旅程与提案确认通过，B3 已包含修订；移动/原生壳完整矩阵待验** |
| UX-S9-06 | “新会话”按钮位于内容区，和标题/会话身份分离，用户需要回到顶部寻找 | 新会话上移到 AI header，与助手标题、当前档位和收起按钮同一层 | sync agent | `AssistantPanel.tsx` 的 header 渲染 `ai-assistant-new-session`、档位选择和展开/关闭动作；清空当前 transcript 但保留档位偏好，焦点回到 composer | `e2e/tests/ai-assistant.spec.ts` 断言新会话清空消息并重新触发一次性披露；`e2e/tests/assistant-expanded-ux.spec.ts` 断言展开/收起后草稿保留；`apps/web/evidence/ux-final/` 有 header/composer 截图 | **代码完成；Web 新会话、草稿与展开路径通过，B3 已包含修订；移动/原生壳完整矩阵待验** |
| UX-S9-07 | sidebar 空态文案冗长，创建过程中列表跳动，导航层级不清楚 | 空态只说明“这里还没有内容”并给唯一创建动作；创建中使用固定行骨架/inline pending，不重排整个导航；一级目的地、范围、清单、标签分层呈现 | 主布局 agent | `apps/web/src/features/shell/EmptyState.tsx` 与共享 `@heyta/ui` `OrganizerList` 已组件化任务/清单/标签空态；`ProjectsPanel.tsx` 统一标题、计数和创建入口 | `e2e/tests/category-dialog-ux.spec.ts` 7/7：375/768/1440 深浅主题、390px受控等待/失败/重试，重试走真实IndexedDB/op-log并刷新保留；截图见 `apps/web/evidence/category-dialog-ux/`。写入等待不插入临时侧栏行，不重排导航 | **Web交互完成**；同帧防重复与失败保留名称/颜色已验，原生壳随最终产物复验 |
| UX-S9-08 | 侧栏创建清单/标签时复用行内文字输入，名称、颜色、取消和错误状态没有完整交互边界 | 清单和标签使用独立创建 dialog；字段、颜色、取消、创建、焦点、键盘提交/取消、重复名/空名错误均在 dialog 内完成 | data agent | `CategoryCreateDialog` 统一清单 / 标签创建；清单名称必填并支持 1–8 色槽；标签复用同一 dialog 但不伪造颜色写入；成功后回到当前筛选；375px 层级穿透已修复并完成 6/6 验证与重拍；移除“整理你的工作”眉标和技术颜色编号，保留色圆选中勾，每个颜色选项保持 44px 命中区 | 打开后焦点进入名称；Enter 创建、Esc 取消；取消不改列表；重复/空名显示字段级错误；清单颜色在列表中可辨认；窄屏弹层不穿透、不裁切，颜色选项可触达 | **代码完成，浏览器/窄屏证据待父级复核** |
| UX-S9-09 | 清单/标签与任务导航的层级关系靠文字排版猜，设置、个人资料、帮助入口互相孤立 | 一级导航只放任务目的地；账户菜单进入 Profile；设置承载偏好/权限/数据；帮助是全局支持入口，设置内只保留直达链接 | 主布局 agent | `view-tabs.ts`、`AccountMenu.tsx`、`settings-anchors.ts`、`HelpPanel.tsx` 已统一目的地/账户/设置/帮助分层；菜单只保留登录（未登录）、个人中心、设置，帮助从设置与全局入口进入 | `e2e/tests/account-menu.spec.ts`、`pages-sweep.spec.ts`、`help-entry-ux.spec.ts` 与 `apps/web/evidence/account-menu-ia/`、`profile-center/` 可核查入口与返回；深链和四端容器仍需最终回归 | **代码完成；Web IA 入口与返回证据已生成；iOS/Android 局部旅程通过，完整四端容器矩阵待验** |
| UX-S9-22 | More 按钮的宽度/命中区与 rail 其它图标不齐，浮层固定在屏幕底部，触发器与菜单产生空间断裂 | More 必须是 rail 中同一尺寸的导航项；菜单必须锚定触发器并在可用空间内翻转/夹取，不再使用固定底部坐标 | rail agent | `RailNavigation.tsx` 与 `placeAnchoredPanel` 已统一 More 触发器、portal 浮层、外部点击/Escape/焦点恢复和窄屏翻转；`rail.css` 统一命中区与 focus ring | `apps/web/evidence/rail-customization/desktop-more-anchored.png`、`narrow-more.png`、`short-more.png` 及 `readout.json` 记录触发器/菜单几何；`e2e/tests/rail-trash-anchor.spec.ts` 与 rail 相关浏览器证据可核查 | **代码完成；Web 锚定/翻转证据已生成；原生壳最终视觉复验待收口** |
| UX-S9-23 | 低频目的地被自动提升或随机重排，用户无法把常用项固定到 rail，也无法把项移回 More | 参考 Adobe Photoshop 官方“Customize Toolbar”模式：用户可拖拽排序、在主栏与 More 之间移动；所有动作都有键盘/点击替代；固定任务、搜索等必要入口不可移除 | rail agent | `rail-pref.ts`、`RailNavigation.tsx` 和共享 `OrganizerList` 已落地设备本地 rail preference、主栏/More 拖移、键盘上移下移、恢复默认及必要入口保护；不写 op-log | `apps/web/evidence/rail-customization/desktop-default.png`、`desktop-drag-to-more.png`、`desktop-drag-back.png`、`desktop-keyboard-order.png`、`readout.json` 提供拖拽/键盘/持久化证据；四端原生容器仍待验收 | **代码完成；Web 拖拽、键盘、持久化证据已通过；四端最终验收待收口** |
| UX-S9-24 | 首次同意联网后仍把用户引向手填服务端地址/自托管路径，官方托管登录不是默认主路径 | 已确认官方托管地址为 `https://heyta.waytofuture.cn`；健康检查实测返回 `200 {"status":"ok","db":"connected"}`。默认路径改为“同意联网 → 官方服务 → 登录/注册 → 同步”；自托管作为“我自托管”的高级展开入口 | sync/profile agent | `apps/web/src/lib/site-url.ts`、认证/同步 gating 与 `SyncBar.tsx` 使用官方 origin；`assistant-hosted-ux.spec.ts` 及认证旅程将自托管高级 disclosure 与官方登录分开 | `e2e/tests/assistant-hosted-ux.spec.ts` 断言未登录设置默认不显示服务器地址、展开后才显示；`apps/web/evidence/auth-journey/` 和 `auth-dialog-ux-final/` 提供默认官方认证路径/失败可见证据；Android 官方默认/自托管显式入口旅程通过，iOS 离线隐私/设置旅程通过 | **代码完成；Web/Android/iOS 局部证据已有；完整四端网络旅程仍待验** |

### 9.2 Profile、设置与信息层级

| ID | 截图中的问题 | 决策 | Owner | 实现 | 验收 | 状态 |
|---|---|---|---|---|---|---|
| UX-S9-10 | 头像菜单、个人资料、个人中心、设置之间的关系不够清晰，用户不知道“看资料”和“改偏好”去哪 | 头像菜单是账户入口；Profile 是身份摘要、成就和账户状态；设置是行为偏好、同步、AI、数据与安全。设置可显示 Profile 摘要卡，但不复制完整 Profile 页面 | 主布局 agent | `AccountMenu.tsx` 只提供账户入口；未登录菜单实际顺序为“登录账号 → 个人中心 → 应用设置”，已登录为身份区 → 个人中心 → 应用设置 → 退出登录；`ProfileOverview.tsx` 内再进入资料编辑/设置 | `e2e/tests/account-menu.spec.ts` 断言未登录登录项为第一项、已登录退出为末项且危险态；`apps/web/evidence/account-menu-ia/`、`profile-center/journeys.json` 覆盖桌面/窄屏返回；四端容器仍待最终回归 | **代码完成；Web 入口/返回与 Profile 证据已生成；iOS/Android 局部旅程通过，完整四端容器矩阵待验** |
| UX-S9-11 | Profile 只展示资料，成就、使用进展和可编辑状态没有稳定信息架构 | Profile 采用“身份摘要 → 当前目标/连续进展 → 成就 → 账户动作”顺序；成就用卡片/徽章组件，不靠一串文字排版 | 主布局 agent | `ProfileOverview.tsx` 已实现身份摘要、近期任务/专注/打卡 metric、成就进度与成长/设置动作；`profile.css` 使用 stats/achievement surface；`GrowthView.tsx` 保留完整成长页，不复制统计事实源 | `apps/web/evidence/profile-center/desktop-light.png`、`desktop-dark.png`、`narrow-*.png`、`journeys.json` 覆盖资料编辑、设置返回、关闭恢复工作区与成长关闭态；未登录/本地态由组件分支呈现 | **代码完成；Web Profile/成就浏览器证据通过；iOS/Android 局部 Profile 证据已有，完整矩阵待验** |
| UX-S9-12 | 设置页的信息层级仍有部分依赖文字和长段落，卡片、状态、动作边界不统一 | 每个设置项固定四槽位：名称、作用、当前状态、动作；风险/限制进入独立 callout；选中态使用填充高亮，不使用下划线作为主状态 | sync agent（AI/同步/隐私） + data agent（数据/清单） | `App.tsx`、`sheets.css`、`sync-settings.css`、`privacy-settings.css`、`DataSettingsPanel.tsx` 和 `SettingsNotice.tsx` 已完成分类高亮、渐进披露、同步/隐私四卡、数据三卡及状态 callout | `e2e/tests/settings-category-ux.spec.ts`、`settings-exit.spec.ts`、`ai-assistant.spec.ts` 与 `apps/web/evidence/settings-finish/` 的 1440/375 亮暗截图可核查当前层级；iOS 设置旅程、Android 最近 Profile/Settings 旅程和 B3 四端重装已有证据，不能由此推导完整四端矩阵 | **代码已落地；Web/iOS/Android 局部运行证据已有；完整四端交互矩阵待验** |
| UX-S9-13 | Profile、设置与帮助在四端容易出现不同入口、不同返回和不同状态表达 | Profile/Settings/Help 采用同一 IA 词汇和状态模型，平台只改变容器（sheet/page/navigation stack） | 四端 UX owner | 把共享信息模型下沉到 `packages/i18n`/共享 UI 契约；Web、macOS、Windows、Android/iOS 分别绑定原生返回和容器 | 四端矩阵逐项确认入口、返回、选中态、空态、错误态；同一状态文案中英同步；不允许某端重新出现独立工具页 | **Web 入口/分类/头像状态旅程已通过；原生端矩阵待验收** |

### 9.3 跨端交互与视口

| ID | 截图中的问题 | 决策 | Owner | 实现 | 验收 | 状态 |
|---|---|---|---|---|---|---|
| UX-S9-14 | 桌面拖拽移动、侧边栏宽度调整、详情列自由 resize 的命中区和反馈不统一 | 桌面拖拽只用于有明确空间关系的对象；自由调整大小适用于侧边栏和详情列，不改变固定 2×2 四象限的投影结构；resize handle 至少满足触控/鼠标命中尺寸，拖动时显示边界和当前尺寸，不改变任务语义 | 主布局 agent | 统一 `ColumnResizer`、四象限移动、详情列拖拽的 pointer capture、键盘 fallback、最小/最大宽度与持久化策略；侧栏/详情使用 `role=separator`、光标反馈和现有键盘路径。暂不增加首次教练提示，保持工作台克制，除非实测发现边界确实不可发现 | 鼠标拖动不误触任务；拖动中有可见反馈；松开后宽度稳定且刷新保留；键盘可调整；窄屏不出现不可达 handle | **代码已落地；Web 调宽路径与证据已具备，最终多端验收待完成** |
| UX-S9-15 | 移动端没有桌面 hover，长按、拖动、滚动与系统文本选择容易冲突 | 移动端长按用于进入批量选择快捷态，短按保持打开/完成；长按有延迟、滚动冲突由原生手势处理；显式“选择”入口作为可发现替代路径 | mobile agent | `TasksScreen` 已接入 `mobile.tasks.gestureHint`、可见 `web.shell.bulk.select`、任务列表与四象限共享 `onLongPressTask` 和选择态；移动端显式“移动到象限”入口仍单独跟踪 | 代码路径已对账；仍需真机确认短按/滚动不会误触长按，以及 TalkBack/VoiceOver 对提示、选择态和批量工具栏的顺序 | **部分完成：代码完成，真机读屏待验收** |
| UX-S9-16 | 四象限移动与窄屏布局容易断裂，曾把“自由调整大小”与四象限投影混在一起 | 四象限固定为等分 2×2 心智模型，不提供会扭曲投影的格子自由 resize；任务可拖入象限，移动端用显式“移动到”菜单；撤销只承诺最后一次移动的短时撤销 | 主布局 agent | Web 已有统一 quadrant model、drag preview、drop indicator、空象限提示、计数徽标与“移动到”菜单；移动端已有同一语义的移动 sheet；当前证据覆盖 4→1/2/3 路径与逐次回到第 4 象限。不会为四象限另造尺寸持久化 | Web/移动端四个象限均可放置；拖动取消不改数据；窄屏无横向溢出；移动端有可见替代入口；最后一次移动可在短时窗口内撤销；不把四象限 resize 列为验收条件 | **代码已落地；四象限保持固定等分 2×2，单次撤销为刻意产品边界；最终多端验收待完成** |
| UX-S9-17 | 电脑端必须先拖大窗口才能完整显示页面，视口没有自动适配 | 页面以 `100dvh/100dvw` 和可收缩布局适配视口；内容区内部滚动，不能依赖用户改变操作系统窗口尺寸 | 主布局 agent | 清理固定宽/高与内容撑开规则；在窗口 resize/方向变化时重新计算 shell；对详情/AI 使用折叠或 overlay | 1024×600、1280×720、1440×900、移动窄屏均能完整看到页头和主操作；document/body 无横向溢出；不要求拖大窗口 | **Web 视口矩阵已通过；原生壳窄窗仍待验收** |
| UX-S9-18 | 交互状态在 Web、移动、macOS、Windows 之间只做了部分对照，局部优化容易破坏融合 IA | 四端共用一份交互矩阵，平台差异只体现在容器和输入方式；产品语义、层级、状态和结果保持相同 | 项目级 UX owner | 以本节矩阵为母表，分别补 Web 浏览器、macOS、Windows、Android、iOS 证据；每次最终重装后重新复验 | 四端均覆盖 Profile/Settings/AI/清单标签/拖拽或长按/视口；截图、DOM/AX、真机旅程和产物哈希可追溯 | 待开始 |

### 9.4 Landing、帮助中心与动效

| ID | 截图中的问题 | 决策 | Owner | 实现 | 验收 | 状态 |
|---|---|---|---|---|---|---|
| UX-S9-19 | Landing 的 DOM mock 与真实产品结构/比例不一致，展示会培养错误心智模型 | Landing 展示真实产品 IA 的精简镜像：rail、任务区、四象限、详情栏的关系必须与当前应用一致；mock 数据只改变内容，不改变结构 | landing agent + 主布局 agent | rail 由 `SHELL_VIEW_TABS` 分栏；清单/标签按标题级 `+` + 静态行镜像 Web；右栏展示真实任务详情分组。真实存在但 Landing 默认不可见的 `assistant-open` 保留登记，不画无行为的 AI 假面板 | 结构对账、语义 DOM 与当前 Web 源码一致；375/768/1440 的列比例与窄屏行为再做浏览器验收；不出现工具目录或虚假 Chatbot 控件 | **已完成本轮 Web/Landing 验收**：结构与浏览器路径已验证；残留的 `mockup-capture-shape` 已按无描边契约修正，2026-10-08 定向16/16通过 |
| UX-S9-20 | Landing IA、帮助中心入口、搜索、文章层级和动效节奏仍需作为一个产品路径验收 | Landing 一级导航明确产品、功能、帮助、定价；帮助中心采用分类 → 文章两层；动效只解释状态变化，不阻塞阅读 | landing agent | 保持帮助搜索、分类侧栏、文章目录、双语 canonical；补 reduced-motion、暗色、窄屏和错误/空结果状态；动效统一时长和 easing token | 帮助入口在 Landing 首屏与页脚可达；搜索命中当前语言；窄屏单列；reduced-motion 直接呈现内容；动画不影响首个 CTA 和键盘焦点 | **已完成本轮 Web/Landing 验收**：帮助中心、首页、窄屏/暗色/reduced-motion 共26项通过；2026-10-08原残留组件断言所在套件16/16通过；线上帮助返回主页和文章跳转亦通过 |
| UX-S9-21 | 动效过度会增加心理负担，AI/隐私演示与真实应用反馈没有共同规则 | 动效服务于进入、状态变化和反馈；不做持续漂浮、无目的 parallax 或 hover 位移；尊重 `prefers-reduced-motion` | landing agent + 设计系统 owner | 统一 motion token；加载/成功/错误/展开/拖拽分别定义短反馈；内容面不使用装饰性位移 | 普通模式动效完成时间可感知但不拖慢；reduced-motion 无关键内容隐藏；键盘/屏幕阅读器不依赖动画才知道状态 | **已完成本轮 Web/Landing 验收**：375/768/1440、亮暗主题及reduced-motion通过；原残留组件断言所在套件已16/16通过，无该项阻塞 |
| UX-S9-43 | 应用设置里的“帮助与关于”曾是标题、长说明和三条普通链接堆在一起，和设置其它区块的视觉语言不一致 | HelpPanel 只负责把用户送到官网文档、更新动态和价格；三条入口采用同一动作卡结构，图标、标题、说明和外链提示形成固定层级 | 主布局 agent | `HelpPanel.tsx` 已改为三条组件化外链；帮助入口指向 `/docs`；说明降为面板底部辅助文案；共享 shell 负责统一外链动作语义 | 设置首屏能区分帮助、更新动态、价格；没有重复大标题或长文案墙；三条链接均为真实可访问 `<a>` | **Web/官网帮助路径已验；原生壳外链点击与窄屏截图仍待验收** |
| UX-S9-44 | 应用 HelpPanel 的入口宽度与设置内容面不受约束时，会在桌面被拉满，在窄屏挤压标题和说明 | HelpPanel 采用受控内容列，入口卡片按可读宽度排列；窄屏单列并保持完整命中区 | 主布局 agent | `help-settings.css` / shared settings shell 统一列宽、gap、换行和 44px 命中区；不让外链行撑出设置 sheet | 375/768/1440 视口无横向溢出；长标题自然换行；图标、文本和外链提示不互相覆盖 | **代码完成；窄屏/暗色证据待验收** |
| UX-S9-45 | 应用 HelpPanel 的蓝色下划线长链接和默认浏览器样式造成视觉噪声，当前项和可操作行没有组件状态 | 外链入口使用填充 surface、边框和 hover/focus 状态；正文下划线规则只属于官网正文，不带回应用设置 | 主布局 agent + shell agent | HelpPanel 已改为 `.ht-settings__help-link` 组件状态；原生壳接管 `target="_blank"` 与普通导航；保留 `rel="noopener noreferrer"` | 默认态无下划线堆叠；键盘焦点清晰；点击后工作区不被替换；仅 `http(s)` 进入系统浏览器 | **Web/官网路径已验；macOS/Windows/Linux 真机点击仍待验收** |
| UX-S9-46 | 应用设置不应暴露帮助站点的技术实现细节，用户需要先理解端点/构建语境才知道去哪 | 应用只展示任务导向入口；服务端、token、构建与协议说明留在官网文档的高级路径 | 主布局 agent + landing agent | HelpPanel 已删除技术化长说明；官网 `/docs` 保留面向自建用户的完整文章，应用端不复制内容 | 设置里 10 秒内能找到帮助入口；应用端不出现内部路径/命令；官网高级文档仍可达 | **代码完成；官网文案审计另按 Landing/Docs 清单验收** |
| UX-S9-59 | Landing 与应用空态、插画和 AI/隐私演示需要更有产品感，但持续漂浮、颜色闪烁和装饰性动效会增加心理负担，也可能让主要信息被延迟呈现 | 动画插画只表达进入、加载、成功或下一步反馈；主信息与行动在无动画时立即可见；颜色只使用对应语义 token；禁止用分类色、优先级色或热力图色伪造状态；统一支持 `prefers-reduced-motion` | landing agent + 设计系统 owner | 已拆为 `UX-S9-59-A`（共享代码组件与运行时回退）、`UX-S9-59-B`（AI 生成位图素材）和 `UX-S9-59-C`（图像生成 skill / 模型复用链路）；保持内容面克制，动画不改变布局尺寸 | 亮暗主题、375/1440 视口及 reduced-motion 仍需截图；关闭动效后标题/说明/主要 CTA 仍可见可用；无颜色闪烁、持续漂浮或横向滚动；位图需完成来源、产物、接入与跨端对账 | **进行中；Web 五种空态 20 图浏览器验收、UI 33 项与 Web 53 项已通过，线上回归 30 项通过；complete 共享反馈路径、移动端与四端产物仍待完成** |
| UX-S9-59-A | 空态与状态反馈需要统一的可复用视觉组件，不能每个页面自行拼图形和动效 | 使用共享 `StateIllustration`，六种 variant 为 `tasks`、`notes`、`habits`、`calendar`、`search`、`complete`；支持 `enter` / `none` 动效模式，关闭动效后仍保留完整信息 | design-system owner + Web/mobile UI owner | `packages/ui/src/empty-state/StateIllustration.tsx` 已实现并导出；`EmptyState`、`TodayProgressCard`、`TimelineBoard` 与移动端 `kit` 已接入真实组件。生成的小图已内嵌到 `state-artwork.generated.json`；图片加载失败回退代码绘制场景，现有 token、短入场和 reduced-motion 仍保留。GrowthView 按产品决定使用 `showToday={false}`，不为了展示 complete 恢复今日进度卡 | 真实 Web 空态只覆盖 `tasks`、`habits`、`notes`、`calendar`、`search` 五种场景，共 20 图；最新浏览器 1 项通过，包含真实 `Image` 加载与 0 pageerror；UI 33 项、Web 53 项定向测试通过。`complete` 作为共享 `TodayProgressCard` 闭合路径的可复用素材单独验收，不记为 GrowthView 页面场景；移动端与四端产物视觉验收仍待补 | **代码与素材已接入；Web 五种空态 20 图浏览器/UI/Web 验收通过，complete 共享反馈路径、移动端与四端产物视觉验收待补** |
| UX-S9-59-B | 需要 AI 生成位图素材作为可选的品牌插画层，但不能把未生成的图片写成已交付 | 位图素材与代码组件分开验收；源图、提示词、provenance、处理后运行时小图和视觉验收分层记录；插画只作装饰，不承担状态、优先级、分类或风险语义 | design-system owner + landing agent | 六张 AI 原图已生成并通过 contact sheet 视觉查看；`assets/illustrations/ai/` 保留原图、处理后 PNG、提示词、`provenance.json` 与 `contact-sheet.png`；`scripts/prepare-state-artwork.py` 生成离线 128px 小图并由 `state-artwork.generated.json` 内嵌。当前不把生成/查看等同于最终浏览器或四端验收 | 所有目标素材逐张完成亮暗/窄屏/reduced-motion 截图、无障碍替代信息、加载失败回退和最终产物对账；当前 Web 20 图真实 `Image` 加载已通过，四端尚未更新 | **生成与接入已完成；Web 20 图浏览器验收通过，移动端与四端产物验收待完成** |
| UX-S9-59-C | 用户要求复用既有图像生成 skill 与当前可用模型，避免另造密钥或把凭据写进仓库 | 只通过本机已配置的图像生成 skill/模型链路生成素材；配对配置只读，凭据与个人 provider 标识不进入仓库；生成结果仍需回到 59-B 的素材验收 | design-system owner + 本机 skill owner | 本机 imagegen/gpt-image skill 已更新并成功调用当前配置模型；首张素材生成成功，耗时约 32 秒；后续生成继续沿用同一只读链路 | 检查生成文件存在、尺寸/格式、来源记录和集成截图；不得将 API key、base URL、个人 provider id 或本机日志中的凭据状态写入产品文档/仓库 | **已完成；配置路由、六张真实出图、中文技能说明及脱敏校验均通过；产品安装验收另见 59-B** |
| UX-S9-60 | 状态、优先级、四象限、用户分类、热力图和工作日分类曾混用颜色，导致相同颜色在不同语境下表达不同结论 | 统一语义颜色标准：`success/warning/info` 文字使用 `*-strong`，`danger` 允许在 AA 合格的正文场景使用普通档或 strong；图形可使用普通档；`priority-*`、`quadrant-*`、`category-*`、`heat-*` 与 `calendar-day-*` 各自独立；颜色不得是唯一信息通道 | 设计系统 owner + 各端 UI owner | 规范已写入 `design-system/heyta/MASTER.md` 与分类颜色计划；高优先级、工作日、成功/警告文字消费者已完成修正；同步状态继续复用共享映射 | 亮暗主题对比度测试、语义 token 对账、组件消费者清单和截图共同验收；动画插画遵守同一标准；不得以构建通过代替视觉与语义复核 | **进行中；规范已落地，待补 UX-S9-59/60 截图与跨端验收** |
| UX-S9-61 | 跨天排期任务在日历格、选中日清单和迷你侧栏中的日期归属不一致，导致同一任务在中间日期看不见 | 日历所有日期消费者统一使用 `groupTasksByCalendarDate` 的 `startDate` / `durationMinutes` 投影；只有 `dueDate` 的旧任务继续占据单日 | calendar owner | `CalendarBoard` 的选中日清单与 Web `CalendarSidebar` 均消费当前网格范围的跨日投影；Web 回归测试覆盖跨天任务在每个自然日的侧栏点和读屏计数，移动端源码判据锁定选中日清单接线 | 共享投影单测、Web 侧栏集成测试和跨端源码接线判据通过；最终四端安装态仍按收口流程复验 | **代码与定向测试已完成；四端最终产物复验待收口** |
| UX-S9-62 | 时间线逾期日期文字使用普通 warning 色时，在白底上的正文对比度不足 | 逾期日期文字使用 `color.warning-strong`；警示线、点和背景继续使用图形语义色，不改变时间线指针或拖拽语义 | timeline owner | `TimelineBoard` 的 `timeline-when-*` 逾期文字已切换到 strong token；回归测试锁定 token，设计系统对比度测试覆盖 5.02:1 的正文档 | 定向组件测试与 token 对账通过；最终亮暗主题及四端安装态视觉复验仍按收口流程执行 | **代码与定向测试已完成；四端最终产物复验待收口** |
| UX-S9-47 | 原生桌面壳中的帮助/价格/更新动态链接可能在当前 WebView 内导航，用户会离开工作区且无法回到原任务上下文 | 站点内容由系统默认浏览器承载；当前工作区保持不变；只允许绝对 `http(s)` 外链，内部 shell URL 继续留在壳内 | shell agent | macOS `NSWorkspace`、Windows `Launcher` + 新窗口请求、Linux WebKitGTK 默认 URI handler 均已接入；移动端原有法律链接继续用 `Linking.openURL` | 四端点击外链后工作区仍在；仅 `http(s)` 被移交；外链失败不关闭窗口；不使用 shell 拼接 | **代码完成；三桌面壳需在各自主机重打包与人工点击验收** |

### 9.5 清单 / 标签的对标与系统融合决策

本轮清单与标签的交互取舍参考了三个公开产品方向，并以当前 heyta 的领域模型为约束：

| 参考 | 借鉴的原则 | 在 heyta 中的落点 |
|---|---|---|
| TickTick 帮助中心与公开产品页面（[ticktick.com](https://ticktick.com/)） | 清单是任务范围，标签是横向属性；创建动作靠近各自分区标题 | `ProjectsPanel` 保持清单 / 标签两块并列，点击标题右侧 `+`，创建成功后直接进入对应筛选 |
| Todoist 帮助中心（[todoist.com/help](https://todoist.com/help)） | 创建实体时只问必要字段，进阶属性延后；错误应在当前表单内解释 | `CategoryCreateDialog` 只收名称和清单颜色；标签不伪造颜色能力；空名、重复名、失败和 pending 都留在 dialog 内 |
| Linear 的 sidebar / list 组织方式（[linear.app](https://linear.app/)） | 导航层级由组件和行状态表达，不能依赖一长段说明文字 | Web 继续由共享 `OrganizerList` 负责行、层级、计数、归档和删除；Landing 只复现标题、静态行和创建入口，不另造一套列表 DOM |

系统融合裁决：清单与标签都属于**任务范围层**，不是一级目的地，也不是设置项；设置只管理显示、同步、AI、数据和账户策略。清单创建的颜色随同一条 `Create` op 写入，标签创建仍只写名称；两者都复用同一个 dialog 的焦点、键盘和错误模型。成功后由宿主执行 `onFilterWith`，让用户留在任务上下文并看到刚创建的范围。Landing 的 mock 只展示真实行结构，保留任务详情栏；`assistant-open` 仅作为真实 Web 的条件入口登记，不在默认详情已展开的静态展示中绘制没有行为的 AI 按钮。

### 9.6 日历侧栏对标与收敛

本节把 TickTick mini sidebar 的差异拆成可验收条目。当前代码已经有日历侧栏、迷你月历、清单/标签多选范围和任务点，但这些事实不能被写成“已完成”而跳过视觉与状态反馈验收。

| ID | 对标问题 / 用户要求 | 当前代码证据 | 决策与实现 | 状态 |
|---|---|---|---|---|
| UX-S9-25 | 迷你月历中辅助信息的层级仍不够弱化，日期应该是唯一主信息；对标 TickTick，节日/状态字应更小、更轻，不应和日期数字竞争 | `apps/web/src/features/calendar/CalendarSidebar.tsx` 的 `MiniDay` 已增加 `.ht-sidebar__day-aux` 辅助行；完整名称保留在 `aria-label`，窄栏视觉上使用省略 | 日期数字保持主层级；节日/休班只作极弱辅助层，使用 muted/subtle 色与紧凑字号；窄栏视觉省略但不截断无障碍名称 | `e2e/tests/calendar-sidebar.spec.ts` 已验证真实七列、点与侧栏几何；`apps/web/evidence/calendar-sidebar*` 与 `countdown-calendar/calendar-sidebar-mini.png` 有截图，仍需父级视觉确认辅助文字权重 | **代码完成；Web 几何/交互证据已通过，辅助文字视觉与四端复验待收口** |
| UX-S9-26 | 迷你月历应显示节日名称，并与现有公共事实/农历计算融合 | `CalendarSidebar.tsx` 复用领域层 `festivalsOn(date)`，`FestivalId` 通过 `FESTIVAL_MESSAGE_KEYS` 走中英 i18n；没有另造节日表 | 复用 `festivalsOn` 事实源，节日名称只进入日期辅助层，不改变任务日期归属；覆盖缺失年份时不猜测 | `e2e/tests/calendar-sidebar.spec.ts` 真实翻月/选日旅程与 `CalendarSidebar.tsx` 的 `aria-label` 组合可核查；`apps/web/evidence/calendar-sidebar-mini.png`、`countdown-calendar/calendar-sidebar-mini.png` 提供视觉材料 | **代码完成；Web 事实源与翻月证据已通过，节日文字视觉/四端复验待收口** |
| UX-S9-27 | 有排程任务的日期需要稳定的蓝点提示；不能用优先级/逾期红色点让用户误解为另一种语义 | `MiniDay` 已移除 `calendarDayTone` / `DOT_TOKEN`，任务与倒数日共用 `hasContent` 判据，点统一消费 `color.primary` | 迷你侧栏点只表达“该日期有排程/日历内容”，逾期与完成保留在主日历/详情状态中；倒数日与任务共用“有内容”判据 | `e2e/tests/calendar-sidebar.spec.ts` 真实断言点的几何与 computed 主蓝色，并验证范围筛选后点同步消失；证据见 `apps/web/evidence/countdown-calendar/calendar-sidebar.png` 与 `calendar-sidebar-mini.png` | **代码完成；Web 蓝点和范围联动证据通过；四端最终复验待收口** |
| UX-S9-28 | 日历页需要顶层侧边栏开关；展开后提供迷你月历和范围标签选择，收起后不能让用户误以为任务消失 | `CalendarHeaderToolbar.tsx` 提供 toggle、`aria-controls`、活跃筛选摘要和清除入口；`App.tsx` 按 `calendarSidebarOpen` 挂载侧栏，store 保留 scope | 收起只隐藏容器，不清空 `view.scope`；页头保留筛选摘要与恢复入口，保持清单/标签多选过滤 | `e2e/tests/calendar-sidebar.spec.ts` 验证清单/标签筛选、全量复位、刷新语义和侧栏把手；`apps/web/evidence/calendar-ux-*.png`、`calendar-sidebar*.png` 提供亮暗/窄屏材料 | **代码完成；Web App 接线与侧栏/范围证据已通过；四端最终复验待收口** |
| UX-S9-33 | 月历主区不能以固定内容高度逼用户先拖大窗口，整月应铺满当前可用视口 | `CalendarView.tsx` 使用共享 `CalendarBoard`；`main-area.css` 与日历宿主 flex/grid 轨道传递剩余高度，内容超出由滚动所有者承载 | 月历铺满剩余视口；窗口变化实时重排；1024×600、1280×720、1440×900 与窄屏均不要求拖大窗口 | `e2e/tests/calendar-cells.spec.ts` 的空日历/高视口与 `e2e/tests/quadrant-fill.spec.ts` 的视口链证据；`apps/web/evidence/calendar-cells/calendar-tall-viewport.png`、`calendar-cells-empty.png` 可核查 | **代码完成；Web 高度/滚动浏览器证据通过；四端最终复验待收口** |
| UX-S9-34 | 月历底部重复显示当天任务清单，破坏“任务直接在日期格内”的扫描路径 | `CalendarView.tsx` 已移除底部重复当天任务列表，任务直接由共享 `CalendarBoard` 月格条渲染 | TickTick 参考形态以日期格任务条为主；当天清单不再重复占用垂直空间；无任务时保持空格 | `e2e/tests/calendar-cells.spec.ts` 与 `calendar-board` DOM 断言任务条位于日期格；`apps/web/evidence/calendar-cells/calendar-cells*.png`、`calendar-ux-*.png` 为当前截图 | **代码完成；Web 月格直显证据通过；四端最终复验待收口** |
| UX-S9-35 | 点日期后应就近弹出添加事项浮层，避免跳离月历主路径 | `CalendarView.tsx` / `App.tsx` 复用选中日与 `captureOpen`，页头 `往选中那天加一条` 与日期格共享锚点 | 点日期可打开就近添加事项浮层；确认后事项直接落入该日期格；取消/Escape 不改变数据；与现有 op-log 写入一致 | `e2e/tests/calendar-capture.spec.ts` 真实点击 + 输入 + Enter，验证任务条落入目标格、输入日期优先及 375/1440 浮层在视口内；证据见 `apps/web/evidence/calendar-capture/` | **代码完成；Web 日期捕获/视口证据通过；四端最终复验待收口** |
| UX-S9-36 | 日期格的信息顺序不稳定，日期、今天状态、节日和任务条互相争夺注意力 | `packages/ui/src/calendar/CalendarBoard.tsx` 固定“日期锚点 → 辅助标记 → 任务条/+N”渲染顺序；今天/选中使用语义状态 | 日期格按固定层级表达；今天只使用蓝色状态，不依赖下划线或整格高亮；辅助文字低于日期数字 | `e2e/tests/calendar-cells.spec.ts`、`calendar-sidebar.spec.ts` 和 `apps/web/evidence/calendar-cells/`、`calendar-ux-*.png` 覆盖亮暗与窄屏状态；父级视觉复核仍需完成 | **代码完成；Web 结构/视觉证据已生成；四端最终复验待收口** |
| UX-S9-37 | 同一天多项任务在日期格内无稳定排序，用户需要逐条猜测时间关系 | `packages/ui/src/calendar/model.ts` 的 `groupTasksByDueDate` / `calendarCellBars` 复用共享日期归属与稳定排序；`CalendarBoard.tsx` 不再另排一遍 | 任务条按时间优先、无时间置后并用稳定 id/title 打破平局；完成/逾期状态留在条面 | `packages/ui/tests/calendar-cell-bars.spec.ts`、`calendar-event-source.spec.ts` 与 `e2e/tests/calendar-cells.spec.ts` 覆盖排序和真 DOM 格子；`apps/web/evidence/calendar-cells/calendar-cells.png` 提供截图 | **代码完成；共享排序单测与 Web 格子证据通过；跨端同步后的最终验收待收口** |
| UX-S9-38 | 日期格内容超出后直接裁切，用户看不出还有多少项；跨天任务也无法形成连续时间带 | `packages/ui/src/calendar/model.ts` 的 `calendarCellBars` 统一容量和 `hidden`，`CalendarBoard.tsx` 渲染 `+N` 与跨日 segments；不在宿主重复计算 | 日期格超出容量折叠为 `+N`；跨天任务由连续 segment 表达；隐藏项保留键盘/读屏数量语义，窄屏不横溢 | `packages/ui/tests/calendar-cell-bars.spec.ts`、`calendar-event-source.spec.ts`、`e2e/tests/calendar-cells.spec.ts` 与 `calendar-week.spec.ts`；`apps/web/evidence/calendar-cells/calendar-cells.png`、`calendar-week/` 提供浏览器截图 | **代码完成；共享算法与 Web `+N`/跨日证据已通过；四端最终复验待收口** |

### 9.7 认证入口与移动端反馈专项

| ID | 问题 / 决策 | 实现要求 | 验收 | 状态 |
|---|---|---|---|---|
| UX-S9-39 | 登录/注册弹窗当前依赖蓝色下划线长链接和文案堆积，入口层级弱且视觉负担高 | 认证弹窗采用标题、主说明、官方邮箱主操作和明确的次级切换；选中/当前状态使用填充高亮或组件状态，不用下划线作为主导航反馈 | 登录、注册、找回路径在同一弹层内可互达；主操作首屏可见；键盘、读屏和错误反馈顺序稳定；不修改认证协议 | **代码完成；中英文亮暗与窄屏截图已生成，测试 88/88** |
| UX-S9-40 | 注册缺少产品记忆点，用户只看到技术表单 | 注册主题采用“一个自律的计划”：用简短的目标/计划引导文案和阶段反馈建立产品感，不新增品牌 Logo，不改变字段与协议 | 首屏能理解注册后的价值；文案不挤压表单；暗色/窄屏不溢出；动效可被 `prefers-reduced-motion` 关闭 | **代码完成；认证路径测试与中英文截图已覆盖，标题断行修正后复核** |
| UX-S9-41 | 官方托管与自托管路径混在同一层，首次用户被迫理解 token/服务端细节 | 官方邮箱登录/注册作为默认主路径；自托管地址、token 等高级选项收进可展开 disclosure，并在展开后解释用途 | 新用户无需先填写地址即可进入官方认证；自托管用户能展开并完成原有流程；协议、端点和 token 语义不变 | **代码完成；高级选项默认收起，官方服务短状态首屏可见** |
| UX-S9-42 | 移动端批量操作工具栏和四象限撤销反馈可能被滚动内容推出可视区 | 批量工具栏固定在可达的安全区；撤销反馈使用可见、可触达的 snackbar/action region，并与当前选择态保持关联 | Android/iOS 短按、长按、滚动和辅助入口均不把工具栏推出屏幕；四象限移动后撤销动作在安全区内可执行；TalkBack/VoiceOver 顺序可读 | **代码已落地；最终 Android/iOS 安全区、读屏与安装态验收待完成** |

### 9.8 本轮新增与残留项（沿用既有 ID，不重复开单）

本轮针对“逐页看排版、美感和 Taste”补充了当前源码的页面级复核。以下事项已经回写到既有条目，不能再被旧的“待开始”文字覆盖：

| 关联条目 | 本轮确认 | 仍然残留 |
|---|---|---|
| UX-S9-57 | 成长页已按 1440、1024×600、390 的亮/暗组合检查；窄屏中文周报卡实测高度为 142px；年度热力图容器实测 `scrollLeft=630 / max=630`；分类报告已进入独立容器，里程碑和身份不再与其争夺同一层级；英文月份完整显示已复验，Windows 与 iOS 当前 Growth 安装态也已查看 | 保留移动端真实交互与最终安装产物收口；不把单端 Growth 观察扩展为全部跨端完成 |
| UX-S9-58 | 8 个页面 × 2 个视口 × 2 个主题共 32 张矩阵已通过并人工查看主要状态；时间线刻度按实测轴宽度避让 label；搜索改为不透明阅读面；窄屏任务范围已由 `ScopeDrawer` 承担并验证关闭/焦点恢复 | 当前源码矩阵已完成；保留四端安装态和必要交互回归，不重复登记为页面矩阵待完成 |
| UX-S9-12 / §8.2 | 设置同步与隐私已拆成独立状态/动作层，不再把“尚未实施”写成当前事实 | Widget 宿主环境识别、原生壳截图与最终四端安装态 |
| UX-S9-16 / UX-S9-42 | Web 四象限已有 4→1 拖放/菜单路径与单次短时撤销；移动端批量工具栏和象限移动撤销代码路径已落地；Android 键盘返回优先级修复已通过 833 项单测 | 四象限固定等分 2×2，格子 resize 不属于当前产品承诺；单次最后操作撤销是刻意产品边界。剩余为 Android 真机返回/安全区/长按复验、移动读屏、跨端一致性和最终安装态验证；Web 证据不能代替多端验收 |

这里不新增“成长页已完成”“四端已完成”之类的总括结论。当前准确口径是：源码与 Web 视觉证据已推进到本轮范围，最终多端产物验收仍是开放项。

### 9.9 综合验收矩阵与完成门槛

以下矩阵保留此前所有专项，不允许因为本次主布局或 AI 重做而删掉设置、Profile、拖拽、移动端长按、Landing、帮助中心或四端要求：

| 领域 | Web 桌面 | Web 窄屏 | macOS / Windows | Android / iOS | 必须提供的证据 |
|---|---|---|---|---|---|
| 主任务区与栏比例 | grid 比例、详情/AI 收缩、resize | overlay/sheet，不挤任务内容 | 原生窗口中共享 UI 首屏 | 任务列表/详情 push-pop | 1280/1440/窄高截图 + 无溢出读数 |
| AI Chatbot | 单一 Agent、header/messages/composer、建议空态 | 底部 composer、overlay | 安装态 DOM/AX、无工具 Tab | 若配置则同一 Chatbot 语义；未配置有明确空态 | DOM/AX、截图、写提案确认旅程 |
| Profile 与设置 | 头像 → Profile/设置，Profile 摘要卡 | 页面/底部 sheet 返回一致 | 菜单与返回路径一致 | profile tab / push-pop 一致 | 入口、返回、选中态、成就卡截图 |
| 设置卡片与状态 | 分类高亮、四槽位、错误/限制卡 | 横向目录与当前分组 | 原生容器内不透字、不误识别环境 | 表单/卡片触控尺寸、权限反馈 | light/dark/窄屏 + 实际状态截图 |
| 清单与标签 | 独立 dialog、颜色、错误、键盘 | sheet/dialog 不遮主任务 | 共享语义 | 长按/更多菜单可达创建 | dialog 交互录屏或 Playwright/AX 断言 |
| 拖拽/resize | 四象限、详情列、sidebar handle | 不要求精确拖拽，提供替代动作 | 鼠标命中与窗口 resize | 不把桌面拖拽照搬到触摸 | pointer 旅程、取消/边界/持久化证据 |
| 移动长按 | 不适用 | 不与滚动冲突 | 不适用 | Android/iOS 短按、长按、滚动、辅助入口 | 真机旅程与截图 |
| Landing / 帮助 / 动效 | IA、DOM 镜像、搜索、文章 | 单列、reduced-motion | 通过浏览器产品路径复用 | 不适用 | 375/1440、暗色、reduced-motion、帮助搜索 |
| 产物收口 | 当前源码构建 | 当前源码构建 | 当前源码 MSIX/.app | 当前源码 APK/iOS | 四端重新构建、安装、启动、哈希对账；中间版不得标最终 |

完成门槛：① §9 每个 ID 有可核查的源文件改动及对应证据；② 对应截图/交互证据来自同一源码冻结点；③ Web 单测与必要真机旅程通过；④ 四端重装完成并核对产物哈希；⑤ 父级视觉复审确认主任务区、AI composer、设置/Profile/清单标签和窄屏 overlay 已达到本计划的审美与 IA 标准。任何一项缺失都只能标记为 `进行中` 或 `待验收`，不能用构建绿、旧截图或中间版安装证明替代。

### 9.10 本轮追加要求：SSOS 技能、连通性与最终核对

以下条目是原清单的追加，不替代 §8、§9.1–9.9 的任何事项。验收分为“源码实现 / 浏览器视觉与交互 / 当前产物安装”，三者不得互相替代。

| ID | 用户要求 | 实施与验收 | 当前状态 |
|---|---|---|---|
| UX-S9-48 | 登录提示无法连接，必须查真实原因 | 官方认证接口、原生来源预检与响应分别验证；生产仅追加 `heyta-local://app` / `https://heyta.local`，保留官方来源；不得用通配符或关闭认证绕过 | **线上配置已修复；真实 WKWebView custom-scheme Origin 探针已通过**：[`wkwebview-origin-probe-2026-10-07.txt`](../../apps/desktop-macos/evidence/wkwebview-origin-probe-2026-10-07.txt) 与 [`verification-2026-10-07.txt`](../../apps/web/evidence/ux-closeout/verification-2026-10-07.txt) 记录 `Origin=heyta-local://app`，OPTIONS 与 POST 均携带正确自定义 scheme origin，且不是 `null`；安装态完整认证旅程与四端重装仍待验收，未使用用户密码 |
| UX-S9-49 | 文档中心必须遵循用户现有 SSOS skill | 已读取 `ssos/.agents/skills/ssos-docs-site-builder/SKILL.md` 及模板、截图、QA 三份引用；已实际浏览 docs.finlaw.cloud。对齐统一顶栏搜索、左侧全站目录、中间标题与正文、右侧页内目录、窄屏抽屉、单一 h1、任务导向文章；保留 heyta token/中英事实源及静态输出链 | **代码完成；官网第三次部署后线上检查通过**：[`live-readout.json`](../../apps/landing/evidence/docs-release/live-readout.json) 与 [`docs-live-1440.png`](../../apps/landing/evidence/docs-release/docs-live-1440.png) 已验证首页入口、标题层级、搜索、导航和无下划线；相关 32 张当前源码矩阵已完成；发布后持续回归与四端安装态仍单独跟踪 |
| UX-S9-50 | 整个产品按 Taste 提升，不能只列文字或堆框 | 统一内容宽度、标题数量、可操作组件、选中/焦点/错误状态与文案。工作台遵循紧凑蓝白风格，注册可有表现力；不把宣传页的随机布局/重动效套进设置 | **进行中**；HelpPanel 已移除重复标题、技术解释与下划线堆叠；帮助中心法律目录 hover 已改为颜色/底色反馈；Landing 26 项浏览器验收通过；此前失败的 `mockup-capture-shape` 已定向16/16通过。注册新版已通过亮暗/窄屏/reduced-motion与生产390/1440字段验收；本轮新增移动页面密度问题按95—100继续收口 |
| UX-S9-51 | 每项登记，全部保留，尽可能并行 | 总清单为唯一进度表；按文件所有权并行，最终统一源码冻结、视觉复审和四端重装。新增要求不能覆盖之前 AI、Profile、设置、日历、拖拽、移动交互、Landing 与帮助要求 | **持续执行**；最终收尾前逐项核查状态与证据 |
| UX-S9-52 | 头像菜单同时并列个人中心、编辑资料、设置、成长和退出，入口过多且文字长度失衡；设置与个人资料关系被重复入口稀释 | 未登录实际顺序为“登录账号 → 个人中心 → 应用设置”；已登录为身份区 → 个人中心 → 应用设置 → 退出登录。编辑资料只从“个人中心 → 设置资料”进入；成长留在主导航/个人中心，不兼任账号菜单动作；退出登录独立置底并使用危险色 | Web `AccountMenu` 统一菜单顺序、portal 定位、键盘方向键与 `focus-visible`；macOS/Windows 原生壳继续复用同一 WebView DOM，不另造视觉菜单；移动端维持个人中心 → 设置资料路径 | `e2e/tests/account-menu.spec.ts` 正向/负向断言登录第一项、已登录身份区和退出末项；`apps/web/evidence/account-menu-ia/`、`profile-center/journeys.json` 覆盖中文亮暗/窄屏、设置和个人中心返回路径；原生壳探针继续核对 settings/signout | **代码完成；Web 菜单顺序与 Profile 返回证据已通过；原生壳最终视觉复核待收口** |
| UX-S9-53 | AI 入口仍像工具面板：历史、新会话、空态问候和输入区没有形成一个低负担的 Chatbot 工作区；窄右栏放不下二级历史列，移动端也不应一直占用历史空间 | 单一 Chatbot 内部采用“历史列 → 对话主区”层级；历史只展示真实的本机会话，新会话固定在历史列；空态居中问候、三枚紧凑建议和 composer；短视口减少垂直留白但保留 composer；窄容器/移动端收起历史为 header toggle，不新增独立工具入口；档位切换、出境披露与写提案确认逻辑保持原状 | `AssistantPanel.tsx` 增加 Chatbot history rail、today 分组、empty greeting、三枚建议与移动端历史 toggle；`ai-panels.css` 增加容器查询：宽面显示二级历史列，窄面转 overlay；`App.tsx` 与 rail assistant entry 已接通展开/收起；文案加入中英文词条，不新增独立工具入口 | Web 1440×640 亮/暗色截图、窄容器截图、390px 移动端历史收起；DOM 断言历史、问候、composer、三枚建议；已有披露、提案确认与历史落盘测试继续通过 | **代码完成；Web 1440×640 亮/暗色与 assistant 证据已生成，B3 已包含修订；移动真机与原生父级整合待验收** |
| UX-S9-54 | 帮助中心仍缺少明确的“返回首页”出口；侧栏分组字号小于条目、标题层级倒置；正文与导航链接依赖下划线表达状态，破坏统一视觉语言 | 顶栏保留品牌返回帮助中心首页，同时增加显式“返回首页”链接，按当前语言落到官网 `/` 或 `/en/`；帮助中心所有链接默认、hover、active、focus 均取消下划线，改用颜色、surface 背景和 `focus-visible` 环；导航分组使用 `headline`（base + semibold），文章条目使用 `row-meta`（sm + regular）；分类模块与文章分区统一 `section-title`（lg + semibold），页面 h1 保持 `screen-title` | `DocsShell` 增加本地化首页入口；`DocsNav` 使用语义组标题；`DocsModule` 与文档正文 CSS 统一标题层级；`docs-layout.css` 对 DocsShell 内所有链接收口无下划线和键盘焦点；中英文词条同步 | 1440/390 亮暗主题检查首页入口可见、中文/英文目标正确、所有 Docs 链接计算样式无 underline；Tab 聚焦有可见 ring；分组 16px/600 明确大于条目 14px/400；无正文遮挡，移动端目录按钮保留安全区 | **代码完成；官网线上首篇文章真实验证通过：1440/390 亮暗四态、返回首页实际到 `/`、1 个 h1、分组 16px/600 大于条目 14px/400、计算样式下划线 0、无横向溢出；证据见 `apps/landing/evidence/docs-release/live-readout.json` 与 `docs-live-first-run-*`；当前源码截图矩阵与最终四端重装待收口** |
| UX-S9-55 | 专注页主路径被时长设置、关联任务和厚重概览分散；Landing mock 曾用巨大 Zap 图标侵入计时环，窄视口下操作按钮折行 | 突出计时器与单一主操作“开始”；关联任务保留为紧凑次级控件；四项时长设置默认收起；右侧统计使用轻量 metric grid；Landing 与 Web 同源结构，不增加工具入口 | `apps/web/src/features/focus/FocusTimer.tsx` 使用默认收起的时长 disclosure、设置摘要与响应式主路径；`apps/web/src/styles/app/base.css` 调整 disclosure、统计网格和窄视口样式；`apps/landing/src/mockup/FocusRing.tsx` / `mockup.css` 对齐空闲态开始路径、真实任务与设置摘要并修复按钮折行；`apps/web/tests/focus-timer-config.spec.tsx` 补默认收起/展开断言 | Web `apps/web/evidence/focus-ux/` 与 Landing `apps/landing/evidence/focus-ux/` 覆盖 1440、1280×640、390 亮/暗主题；Web focus config 5/5、Focus detail 6/6、Landing Focus 对账 8/8；`pnpm check:design` 与 `git diff --check` 通过 | **代码完成；Web/Landing 当前源码浏览器矩阵通过；四端最终重装待验收** |
| UX-S9-57 | 成长页周报的标签与数字被两端拉开，年度热力图会撑宽视口，分类、里程碑和身份区块使用同等边框，长周期信息层级不清 | 成长页按“短周期指标 → 年度活动 → 分类泳道 → 长周期里程碑/身份 → 分享出口”分层；周报使用紧凑 metric grid；热力图在自己的可滚动容器内；里程碑按维度分组，身份用标签组件，空态只保留事实与下一步 | `GrowthBoard` 为各区块提供稳定语义锚点；Web 宿主 CSS 负责 metric grid、热力图宽度、月份不换行、分类泳道分隔和长周期层级；共享组件继续消费真实投影，不新增持久化字段 | 1440 / 1024 / 390 亮暗矩阵、`scrollLeft=630 / max=630`、分类独立容器和英文月份完整显示均已复验；Windows 与 iOS 当前 Growth 安装态已查看；剩余是移动端真实交互与最终产物收口 | **代码与 Web 视觉复核完成；端侧 Growth 已查看；移动端最终交互/重装仍待验收** |
| UX-S9-58 | 习惯、便签、时间线、倒数日和回收站的空态层级不一致：习惯提示错在右侧详情列，便签过轻，时间线长句挤成粗标题，倒数日暴露实现细节，回收站重复解释 | 五类空态统一使用共享 `EmptyState` 的标题 + hint 结构；习惯空数据只在左侧列表显示，详情列不挂载重复空面板；时间线保留任务导向的下一步；倒数日强调记录日期，回收站提示恢复/彻底删除 | `NotesBoard` / `TimelineBoard` 接入共享空态；`HabitsView` 使用共享空态并在无数据时收起详情列；时间线刻度根据实测轴宽度避让 label；搜索结果改为不透明阅读面；窄屏任务筛选改为 `ScopeDrawer`，支持 Escape、点击外部关闭和焦点恢复；中英文词条同步 | 32 张页面矩阵（8 页 × 1440/390 × 亮/暗）已通过，并人工查看主要状态；五页空态均有清晰 title/hint、无重复空列、无横向溢出；时间线 labels 不重叠；ScopeDrawer 窄屏验证通过；共享 UI/Web 定向测试通过 | **代码与 32 张矩阵视觉复核完成；端侧安装与未覆盖的交互旅程仍待收口** |

SSOS 技能迁移边界：复用公开帮助中心的结构、写作、截图与验收规范；其产品名称、域名、财税模块、部署命令不照搬到 heyta。用户帮助在官网承载，内部工程文档仍留在仓库文档体系。禁止把文档页截图当产品说明图，也不使用含真实账号或凭据的截图。

### 2026-10-07 最终源码视觉复核补记

- UX-S9-57：成长页 1440×900、1024×600、390×844，空态与真实 UI 创建数据、亮暗主题重拍通过。英文指标标签换行时三列数字保持同一基线；月份完整显示（不竖排、不省略），以 `apps/web/evidence/growth-ux/growth-390x844-dark-en.png` 为证。热力图可聚焦区域与最新日期滚动保持。
- UX-S9-12：同步/隐私内部 fieldset 改为无框语义分组，保留外层设置模块与输入框边界；1440/375 亮暗截图重新检查通过，见 `apps/web/evidence/settings-finish/settings-375-light-sync.png`。
- UX-S9-16：Web 四象限分别移动至 1/2/3 后撤销返回原象限，1280/375 实际点击通过。固定等分矩阵与单次撤销是当前产品决定。
- UX-S9-58：时间线实际发现并修复“垂直拖未排期任务不生效”；松手才提交、失焦取消不写入、普通点击和键盘入口均复验通过。键盘激活后的游离 pointer 不会误改排期，range 的系统取消清除预览。证据：`e2e/tests/timeline-p2.spec.ts` 两项浏览器验收，以及 `apps/web/tests/timeline-board.spec.tsx` 26 项定向验证。
- 搜索阅读面改为不透明背景；减少动态效果时同时取消遮罩与内层面板入场动画，避免暂态文字透叠。
- 交付状态：帮助中心/落地页已发布，应用站点与四端最终安装态结果仍须分别登记，以上不代替端侧验收。

### 2026-10-07 早期产物收口记录（历史快照，已由下方新产物记录更新）

曾执行 `pnpm reinstall:all`，但第二轮 macOS 系统窗口截图在锁屏状态下失败，因此不能把该轮写成“四端全绿”。完整输出与失败边界保留在 `apps/web/evidence/settings-finish-release/reinstall-all-2026-10-07.txt`。macOS 随后手动安装了当前签名 App；包内 WebView 快照、M2 身份/设置证据通过，但锁屏仍阻碍 ScreenCaptureKit 系统窗口截图和物理点击。其余端按各自证据单独登记，不能互相替代。

| 载体 | 当前证据 | 状态与边界 |
|---|---|---|
| 生产 Web `/app/` | 发布产物与服务器 index SHA256 均为 `1441bd0b011db7039fb7051f1cbef4d9db90d2cb89ebc0a4b60a05765b097ef2` | 已发布；线上套件初跑 29 通过，1 项旧自托管文案断言失效；修正为现有标题/摘要并保留旧错误文案禁用检查后，该项单独通过 |
| 帮助中心/落地页 | 发布 index SHA256 `cc529e4bdbcad345acc882502406e4fa6f5238a1ef9ab0fd1990b4f96509e4fe`，`apps/landing/evidence/docs-release/live-first-run-readout.json` | 已发布；返回首页、标题层级、无下划线、亮暗窄屏现场验证通过 |
| macOS 安装副本 | `/Applications/Heyta.app`；`apps/web/evidence/settings-finish-release/macos/installed-webview.png` | 当前签名 App 已手动安装；包内 web-dist 对账、WebView 快照、M2 身份/设置证据通过；锁屏阻碍 ScreenCaptureKit 系统窗口截图与物理点击，不能标记安装态全通过 |
| Windows MSIX | `dist/windows/install-capture.txt`；[安装态 UX 证据](../../apps/web/evidence/settings-finish-release/windows/) | 当前版本 Chatbot、设置选中态、控制台、Profile → Growth 已通过安装态 DOM/截图验收；不扩展为所有原生交互已通过 |
| Android APK | APK SHA256 待当前源码统一 `reinstall:mobile` 完成后回填 | 旧版键盘返回优先级修复已通过 **833 项单测**；修复产物 `1a8f83...` 已完成 14 步与 Profile，但晚于它的动画/颜色源码尚未进入新 APK；真机返回、长按、安全区和最终产物 hash 仍待复验 |
| iOS Release | iPhone 17 Pro 模拟器 `heyta-iphone-17pro`；重新安装后的 `profile-final` 证据已通过 | 该安装态 Profile 已查看；动画/颜色源码晚于该产物，本轮移动端重装与其余跨端交互仍待收口 |

原生模拟器的 AX 树和真实点击可验证控件路径、焦点对象及命中区；它们不等于真人听取 VoiceOver/TalkBack 的语音验收，也不代表所有跨端功能均已通过。四象限格子自由 resize 维持“不做”的产品决定；可调宽的是侧边栏/详情栏。

### 证据核对：第 3–6 项剩余项（2026-10-07）

| 项目 | 已有证据 | 准确判断 |
|---|---|---|
| 移动端长按、返回、键盘与安全区 | iOS `tasks-ux-journey.json` 全旅程通过，含长按选择、四象限移动/撤销、键盘可见且不遮挡、键盘恢复；Android 旅程的长按、选择、四象限移动/撤销、详情键盘可见步骤通过，但总报告因后续“任务详情”标签等待超时而标记 failed；另有 Android `manual-keyboard/before-back.png` 与 `after-back.png` | **部分已验，不能写成全通过**。旧版 Android 键盘返回修复的 833 项单测与“键盘待验”记录保留；修复产物 `1a8f83...` 已完成 14 步+Profile，但动画/颜色源码晚于该产物，当前源码重装后的返回、安全区仍待复验 |
| 移动端读屏语音 | Android/iOS 证据是 AX 树/控件路径和截图 | **确实缺失**。AX 不等同 TalkBack/VoiceOver 真人语音验收，不能把该项改为通过 |
| 原生壳外链与 Widget 环境识别 | macOS `installed-dom.txt` / `chatbot-ax.txt` 证明共享 UI、设置与 AI 容器；Windows 最新 DOM 证明 Chatbot、设置和 Growth；Android Profile 旅程有桌面小组件说明 | **实现已有、验收证据缺失**。指定证据中没有 macOS/Windows/Linux 实际点击外链后交给系统浏览器且工作区保留的记录，也没有各桌面壳 Widget 环境识别的独立读数 |
| Landing / 帮助窄屏、暗色与层级 | `apps/landing/evidence/docs-ux-s9/` 有中英文 1440/390 亮暗 8 张截图；线上 `live-readout.json` 记录 1440/390、亮暗、无横溢出、1 个 h1、搜索、返回首页和无下划线 | **视觉与窄屏已做，部分待登记**。现有证据没有 reduced-motion 或键盘焦点的结构化读数；focus 截图存在，但没有对应的状态报告 |
| 四端统一 Profile/Settings/AI/拖拽或长按矩阵 | Windows 有最新 Chatbot/Settings/Profile → Growth DOM；iOS Profile/Settings 与任务长按旅程通过；Android Profile/Settings 通过且任务旅程部分步骤通过；macOS 有 AX Chatbot/Settings 与 M2 DOM | **确实没有完整四端矩阵**。已有证据应登记为分端局部通过，不能合并推导出四端的拖拽、长按、AI、返回和外链全部一致 |

### 原生安装态回看追加（UX-S9-57）

17:32 的 iOS 真安装截图与 Android 现场图暴露了此前 Web-only 的布局覆盖：原生周报仍然把三个指标堆成纵向高卡片。已将三列规则下沉到共享 `WeeklyReviewCard`（统计容器横排，指标列等分且可收缩），Web 仍用自适应 label track 对齐英文换行。删除原生“在网页端建好习惯”的过时中英文提示，改为当前“我的 → 习惯”路径。Web Growth 1440/1024/390、亮暗与英文浏览器复验再次通过；Windows 与 iOS 当前 Growth 已查看。后续安装态仍须以各端最新重装产物为准，不能把 macOS 锁屏失败或 Android 待复验写成全绿。

iOS 第一趟输入框探针误点同名静态“标题”文字，已修复探针保留 TextField 类型再查询；随后完整任务/个人中心/设置旅程通过。Android 撤销实测可用，首趟探针因重复 AX 查询耗尽五秒反馈窗口而失败，修复探针后重新验收，不能把该失败误写为产品撤销失效。

### 2026-10-07 当前事实收口索引

原清单 ID 和历史证据保留。以下区分已安装的插画版本与之后追加的响应式修订，不能混为同一产物。

| 类别 | 当前准确状态 | 对应证据 |
|---|---|---|
| 插画版本已交付四端 | 六张真实生成素材已接入；Web 五种空态 20 图、线上回归 30 项通过；四端重建安装及启动均通过 | `apps/web/evidence/state-illustrations/release/four-platform-install.txt` |
| macOS 锁屏限制已解除 | 退出旧进程并重新打开安装副本后，已查看亮暗任务空态、账号菜单和设置 | `apps/web/evidence/state-illustrations/release/macos-installed-tasks.png` 与同目录亮色截图 |
| Windows 插画与交互 | Chatbot、设置、习惯/搜索插画真实加载均通过；不代表所有原生交互全通过 | `apps/web/evidence/state-illustrations/release/windows/` |
| Android / iOS 安装态 | 当前插画产物的任务旅程与个人中心/设置链均通过；包含长按、四象限移动撤销、详情键盘与返回。Android APK SHA256 为 `e6d82ff5ee493ddec99ef935a919948341d52b93772d2db69b14fbabb1cf2f44` | `apps/mobile/evidence/state-artwork-release/{android,ios}/tasks-ux-journey.json` |
| 新增修订正在实施 | 中英文插画路由、AI 两档模式、助手图标、rail 中轴对齐、输入框单层焦点、全局拖拽与响应式扫描 | UX-S9-63 至 UX-S9-68；不能用上一批安装包证明这些新修订 |
| 保留的证据缺口 | 真人 TalkBack/VoiceOver、桌面外链/Widget 环境独立读数、完整跨端交互矩阵；complete 是共享反馈素材，不是 GrowthView 当前页面 | 原 §7、§8.4、§9.9、§9.10 和 UX-S9-59 |

总口径：上一批插画/语义颜色产物四端已安装；本次新增截图反馈继续登记、修复、逐页验收，最终修订必须再次交付。AX 树不替代真人读屏，局部专项通过不代表全产品审美验收完成。

### 2026-10-07 动画组件与语义颜色验收补记

- UX-S9-59-A：六种代码绘制微场景已接入真实页面；variant 为 `tasks`、`notes`、`habits`、`calendar`、`search`、`complete`。真实 Web 空态为五种场景共 20 张 1440/390、亮/暗、减少动态效果截图，最新浏览器 1 项通过，包含真实 `Image` 加载与 0 pageerror；UI 33 项、Web 53 项定向测试通过。`complete` 只作为共享 `TodayProgressCard` 的完成反馈素材，GrowthView 的 `showToday={false}` 不展示该卡。运行时图像失败会回退到代码场景，现有 token、短入场和 reduced-motion 保留；移动端与四端产物视觉验收仍待补。
- UX-S9-59-B：六张 AI 原图已生成并通过 contact sheet 视觉查看，原图/提示词/`provenance.json`/处理后小图均已保留；128px 离线小图已内嵌至 `state-artwork.generated.json`。插画只作装饰，不承担语义颜色或状态判断；Web 20 图真实加载已通过，移动端和四端产物验收仍未完成。
- UX-S9-59-C：本机已配置的 imagegen/gpt-image skill 已通过只读配对配置调用当前可用模型，首张生成成功；不记录凭据、base URL 或个人 provider 标识，生成链路本身不再是当前阻塞。
- UX-S9-60：颜色规范已进入 `design-system/heyta/MASTER.md`；新增日历休/班专用 token，成功/警告文字改用高对比语义档。设计系统 525 项测试通过，包含亮暗与原生生成产物真实对比度检查。共享 UI 596 项、Web 时间线/成长/日历侧栏 51 项定向测试通过。
- 线上部署与回归：`apps/web/evidence/state-illustrations/release/live-check.txt` 记录线上检查 30 项通过；`deployment.txt` 记录 landing `9b5b4e5c…`、Web `1b2fc498…` 的本地与 `/var/www` 字节哈希一致。该线上证据不替代四端重装。
- 这批动画、颜色与后续日历一致性源码晚于上一批安装包；四端重装正在进行，本节不宣称新代码已四端安装。包与四端安装身份在收口完成后单独回填。

### 2026-10-07 中文化与四端当前产物补记

- 用户补充要求“全部中文”：本次修改的图像生成技能入口、配置路由说明、命令行帮助和错误提示均已中文化；预览标签为“收集箱、便签、习惯、日历、搜索、已完成”。模型名、API 参数和代码标识保留原名。六张图本身不嵌入文字；界面文案继续消费中英文词条表，默认中文。原始生成请求保留作为来源证据，并附中文等义提示词，不篡改历史请求。
- 六张运行时图片合计 52,315 字节，均为 128×128；应用中按现有 64px token 显示。原始大图不进入运行时包。
- `reinstall:all` 本轮四端均通过，完整结果见 本机历史记录 `apps/web/evidence/state-illustrations/release/four-platform-install.txt`（被 release 目录忽略规则排除，非可随仓库检出的证据）。Android 产物 SHA256 为 `e6d82ff5ee493ddec99ef935a919948341d52b93772d2db69b14fbabb1cf2f44`，Windows 原生壳与 macOS 原生壳的共享入口产物 SHA256 前缀为 `c754484067519e90`。
- macOS 已通过真实窗口再次核对：曾仍驻留内存的旧进程显示旧图标，退出后重新启动安装副本，已看到新插画；亮暗空态、账号菜单与亮色设置已查看。本机历史截图位于 `apps/web/evidence/state-illustrations/release/` 的 `macos-installed-tasks.png`、`macos-installed-tasks-light.png`、`macos-settings-light.png`（被 release 目录忽略规则排除，非可随仓库检出的证据）。该批检查时可操作窗口；2026-10-08再次锁屏的外链验收边界见最新记录。
- 四端安装通过只证明产物已安装并启动；Android/iOS/Windows 新产物的专项交互验收仍按独立旅程收口，不用安装成功代替。原清单中未覆盖的系统环境/真实读屏证据仍保留。

### 2026-10-07 新增截图反馈与全局响应式核对

| ID | 用户问题与产品决定 | 实施范围 | 验收标准 | 状态 |
|---|---|---|---|---|
| UX-S9-63 | 保留中文、英文空态插画，随界面语言切换 | 共享 StateIllustration、资源映射和中英文预览；原始素材保留 | 切换语言无需重启；资源加载、失败回退、文案均正确；无文字素材可复用同一图 | 代码与语言切换渲染回归通过；中英无文字插画共用资源，带文案的空态随 locale 切换；待本轮四端安装复验 |
| UX-S9-64 | AI 只保留“只读 / 执行”，默认执行 | Web、移动端、共享授权路径；取消用户可见的三档术语 | 初次使用默认执行；只读不写；执行走真实 op 路径；既有只读偏好不被强制覆盖 | Web/移动端两档已接线，单条创建与完成自动执行、批量完成确认、只读不写；app-host 70 项与 Web 面板 21 项定向通过；B3 已包含修订，移动/原生完整旅程仍待补 |
| UX-S9-65 | AI 不再使用星星图标 | rail、紧凑入口、对话标题，统一会话助手图标 | 图标在亮暗、小尺寸可辨认，所有入口一致且有可访问名称 | 会话助手图标已统一；全局深浅主题截图已回看，B3 已包含修订；移动/原生完整入口矩阵仍待补 |
| UX-S9-66 | 侧边栏上下按钮中轴不齐 | 主导航、更多、回收站、通知、帮助和同步 | 相同点击盒尺寸，SVG 几何中心共线；拖动顺序后不漂移 | 全局 230 状态几何扫描 rail 中轴偏移为 0；统一点击盒，待最终安装复验 |
| UX-S9-67 | 对话输入框蓝色框中框突兀 | 助手输入区 | 只保留外层容器；输入有光标；键盘焦点在单一外层边界表达 | 单层输入焦点已落地；助手深浅主题连续拖动 84 采样点通过，B3 已包含修订；移动/原生完整旅程仍待补 |
| UX-S9-68 | 拖窄侧栏变形，必须全局逐页响应式 | 任务、日历、四象限、习惯、专注、时间线、成长、便签、倒数纪念日、回收站、搜索、个人中心、设置各分类、AI；左右栏分别检查 | 连续拖动及窄窗口下内容重排、按钮可达、浮层锚定、滚动归属正确；不以隐藏溢出掩盖裁切；逐页记录发现与修复 | 全局 230 状态扫描与左右栏 42 状态复验完成；已修 rail 中轴、设置窄屏目录及习惯详情，安装态复验待本轮重打 |

本轮复用现有设计系统，不新建孤立视觉样式。拖栏测试必须检查容器内部几何，不能只看整页是否横向滚动。时间线等语义上需要横向滚动的内容，检查滚动容器和操作可达性，不强行压缩数据。

### 登录与自托管流程追加决定（UX-S9-69—72）

| ID | 问题 | 产品决定 | 状态 |
|---|---|---|---|
| UX-S9-69 | 邮箱继续后才看到密码，账号密码入口不明确 | 登录与注册直接展示邮箱、密码，注册/忘记密码作为简短入口 | 邮箱与密码同屏已实现；最新认证定向 139 项通过；B3 Windows 安装态与 iOS 安装截图已核对，完整四端登录旅程仍待补 |
| UX-S9-70 | 默认摊开多种认证方式、密码长说明、链接/令牌输入 | 默认一条账号密码主路；其他方式按需展开；密码规则只在注册或错误时提示；普通账号页面不出现令牌粘贴 | 普通入口不挂载服务器地址或令牌；其他方式按需展开，认证回归通过；B3 已包含修订，完整四端认证矩阵仍待补 |
| UX-S9-71 | 我的计划侧面空泛、缺乏层次与动态 | 左侧展示紧凑的三步计划示意，一次性进入与完成反馈；不遮挡表单；减少动态效果时直接显示终态 | 三步计划示意、入场与勾选反馈已实现；桌面/移动深浅主题与 reduced-motion 已截图复核，待最终安装复验 |
| UX-S9-72 | 默认用户不应理解自托管才会注册 | 默认官方服务→账号密码登录/注册→日常使用；设置→同步服务中主动开启自托管→配置地址→连接检查→该实例账号认证；官方与自建凭据不混用，本地数据切换边界明确 | 官方优先、自托管从设置开启已实现；Web 增加异步请求代际隔离并通过延迟旧响应回归；Android 最近安装态路径通过，iOS 设置旅程通过，完整四端网络登录仍待补 |

自托管属于主动选择的高级服务模式，不再是每次官方登录时都会遇到的表单分支。已有高级按钮与主操作应归为同一操作行；进入官方默认模式后不再保留无用途的高级按钮。自托管实例账号不等于官方账号，不能自动把官方密码或令牌发送给自建地址。

### Windows 与高级自动收集追加（UX-S9-73—75）

| ID | 问题/需求 | 决策与验收 | 状态 |
|---|---|---|---|
| UX-S9-73 | Windows 顶部出现多余白带 | app 模式隐藏实验面板时同时清除 Grid.RowSpacing；Windows 安装态核对 WebView 顶边及缩放 | 已定位并修复代码，待安装验证 |
| UX-S9-74 | 习惯详情窄栏标题与热力图不适应 | 标题完整换行，操作另起一行；热力图局部横向滚动，不能把整栏推出边界 | 代码修复；共享 UI 构建及真实选中习惯后的 42 状态拖拽复验通过；已人工看窄栏标题换行、工具行及局部横滚，待最新四端安装态验证 |
| UX-S9-75 | DIY：POST JSON/非结构化数据到回调地址，AI 转任务/日历，付费限定 | 分别核查现有文件导入、本机API/MCP、服务端回调；官方托管/自托管均有一致付费资格判断；帮助中心明确现有能力和规划，不虚构上线接口 | 能力审计与方案已完成，见 [付费自动收集计划](inbound-automation.md)；帮助中心中英文已发布至 `/docs/automation/` 并核对线上页面；独立计划审计已完成，P1 契约待后续执行者补齐。公网功能 AC-1—8 尚未实施，不标作上线 |

### 2026-10-07 最终安装前追加核验

- Web 全套单测在认证第一次收尾后为 2075 通过、13 跳过；随后又补上自托管认证旧响应隔离，定向认证 139 项通过。不能把第一次全套读数当作后续修改的全套结果。
- 真实同步拒绝恢复 15 项通过：坏 op 被明确拒绝，不阻断对端下载；待上传清空，下一轮恢复同步。日志本地路径 `/tmp/heyta-final-sync-recovery.log`，不代表四端当前产物同步均已验收。
- 数据管理新增真实浏览器下载与还原旅程（`e2e/tests/data-transfer-ux.spec.ts`）：浅色与深色均下载 JSON/Markdown、检查真实文件内容、非空库拒绝覆盖、独立空库还原并刷新回读任务。证据目录 `apps/web/evidence/data-transfer-final/`，2 项通过。截图回看发现设置顶栏残留任务选择与排序，已修为只在任务页面显示；同时清理导入说明中的内部开发措辞。
- 四端重装首次启动在前置构建阶段主动停止：发现自托管认证 A 请求发出后改成 B，A 返回仍可落会话。修复前没有开始安装；此日志不得当作交付成功。
- 仍须完成：最终源码四端重装与安装态回归、桌面 Widget 环境识别及外链交接、当前提醒系统行为、生产 Web 部署。真人 TalkBack/VoiceOver 听读尚无证据，AX 点击树不替代听读。

### 2026-10-07 桌面小组件与安装截图追加（不得遗漏）

| 编号 | 用户反馈 | 实施与验收要求 | 当前状态 |
|---|---|---|---|
| UX-S9-76 | 桌面小组件识别与本体需适配最新 UI/UX | 分别识别原生壳、独立 PWA、浏览器与组件能力；今日/四象限/习惯/专注统一层级、紧凑预览、长标题与深浅主题；当前安装态取证 | Windows Adaptive Card 四模板代码已改，195 项单测通过；iOS B3 前安装态已由 chronod 枚举 4 个 enabled descriptor；第五轮人工复看截图确认 Gallery 已显示 Heyta，旧“搜索不到”结论是 AX 漏读可见 provider 行造成的误判，已撤回。第五轮已通过系统面板实际添加“今日任务”小组件并退出编辑态；点击和数据刷新仍单独验收。证据：`apps/mobile/evidence/ux-s9-95/widget-chronod-descriptors-20261008.json`、`widget-gallery-idb-20261008.json`。Windows Board、macOS/Linux Widget 交互仍缺 |
| UX-S9-77 | 头像中轴仍偏、选中套框、更多弹层杂乱 | 头像和全部 rail 控件共轴；选中仅图标高亮，无底框；更多统一图标/文字列及行高，保留拖拽和自定义入口、正确锚点 | Web 源码已落地：头像/rail 共轴、选中态去底框、More 使用锚定浮层并保留拖拽/键盘自定义；Web 几何与交互证据已生成，最新四端安装态仍待重装核验 |
| UX-S9-78 | 当前安装仍显示邮箱→继续，而非账号密码 | 新安装必须邮箱密码同屏；普通入口无地址与令牌；助手仅只读/执行；安装包身份与最终源码对账 | B3 已包含账号密码与助手入口修订并完成四端重建安装；Windows 安装态和 iOS 安装截图已核对。完整四端登录/账号状态矩阵仍缺 |
| UX-S9-79 | 习惯的新建/编辑能力与实体模型边界容易被误读为“全量习惯管理” | 只把已有真实能力做成可达入口；新建、改名、删除、图标、颜色、目标、频率、打卡、补卡/重新开始和月/年详情必须走真实 action；开始日期、独立坚持天数、分组、习惯提醒若模型/动作层没有所有者，不能用假按钮或本地状态冒充 | 当前 Web 已真实接通名称新建、改名/删除、图标/颜色、目标与频率编辑，以及打卡、补卡/重新开始、热力图/月/年详情；本轮已补新建目标、单位、口径、频率、周几与补卡范围入口；Habit schema/actions 当前没有 `startDate`、独立“坚持天数”、分组或习惯提醒字段/写入口，故这些能力明确保持未实施。新增/编辑仍是列表入口 + 详情控件，不宣称统一设置对话框 | `apps/web/tests/habit-goal-editor.spec.tsx`、`habit-frequency-editor.spec.tsx`、`habits-detail-card.spec.tsx`、`habits-list-pane.spec.tsx` 与 `e2e/tests/detail-pane-habit.spec.ts`、`habit-counted-amount.spec.ts`、`habit-month.spec.ts`、`habit-year.spec.ts` 覆盖已接通路径；需在 `4358` 隔离端口用当前源码重跑真实 Web 旅程，安装态仍待最终四端收尾 |
| UX-S9-80 | 习惯图标数量少且统计图标借用通用库，视觉身份弱 | 习惯图标扩展为 24 项闭集，保留旧 key 的稳定派生；习惯图形由共享原创 `HabitArtwork` 渲染；详情统计使用 8 个 token 控色的原创微图标（month/total/rate/streak/best/target/calendar/journal） | 24 张原创习惯图已生成、裁切为 128px 透明离线素材，domain/i18n/共享 UI/Web/移动端接线完成；8 枚原创 SVG 微图标已接入统计。PNG 实际解码校验、UI 与移动类型检查通过；选择器已放大到 24px 图形及 44px 触控区域，展开独占整行。真实交互与最新四端安装态继续单独验收，不能用旧包证明新图标已交付 |
| UX-S9-81 | Landing 预览必须让访客直接理解并操作产品，而不是只能看截图或先点编号 | 预览上方去掉 1～5；用户可直接点击预览 DOM 侧栏自由切换视图；可点击任务详情并勾选任务；说明文字与预览状态联动；手机端同样可点击 | 已去掉编号导航，侧栏直接切换五视图、任务详情与完成状态联动、习惯支持演示打卡；桌面全宽、说明移至下方，手机重新排版并在主区下方打开详情。生产构建的 390/1440 × 亮暗四组合交互与几何验证通过（无横向裁切、无 pageerror），Landing 1350 项回归通过；线上部署另记录实际版本与验收证据 |


### UX-S9-81 线上交付回填（2026-10-07）

- 已部署至官网；发布前备份站点，首次发布的本地与服务器入口 SHA256 一致：`b1b7ba18f58a9a29cea645206d0e91ee5754521c864ded4cd396cb8c06b142c3`；后续原创助手图标与 More 浮层修订已再次发布，当前版本见文末。
- 上方编号与额外视图导航已删除，用户通过预览内侧栏和“更多”选择任务、四象限、习惯、专注、时间线；任务标题打开对应详情，勾选和习惯打卡仅改变演示数据。
- 桌面扩大窗口并将说明移至下方；390px 手机按实际宽度重排，详情在主区下方展开并接收焦点，关闭返回任务；不依靠缩小整幅桌面或横滚整窗展示内容。
- 线上 390/1440 × 亮/暗四组合通过，任务详情、勾选、视图切换及习惯打卡均真实点击；没有 pageerror 或预览/主内容横向溢出。英文键盘打开/关闭“更多”、切换后焦点恢复与减少动态效果检查通过。静态 Hero 无按钮。
- 证据：`apps/landing/evidence/dom-preview-release/` 的 `results.json`、`keyboard-en.json`、`deployment.txt` 和截图；Landing 1350 项测试通过。此项已发布，不替代原清单中四端最终安装与其他页面验收。


### 最终 UX 复审追加

- 习惯图标选择器已改为 24px 图形、44px 点击区，自适应整行网格；编辑/删除保留在独立工具行。亮暗与窄栏截图见 `apps/web/evidence/habit-icon-picker/picker-open{,-dark,-narrow}.png`，新建配置与选择/刷新回读定向旅程通过。额外修复“清空目标后折叠设置导致空字符串被转换为 0”的输入错误；显式输入的 0 仍按现有目标语义支持。
- 提醒状态最新五条浏览器验证通过：default 请求、granted、denied 后恢复为 granted，以及 unsupported/error 两条模拟能力边界。前次失败原因是 Chromium 在 CDP session 断开后重置授予状态，已改测试驱动保持权限 session，不改产品权限事实。此结果不代表 OS 通知已实际投递。
- 成长页新增点击/键盘查看热力日期明细，只有一个区域键盘入口；左右按周、上下按天导航。首次就绪后定位到最近日期一次，用户操作后不会因重排而抢回位置；滚动提示仅在溢出时显示。里程碑增加真实完成状态文案，分享按钮前展示摘要预览，底部留白与区块分组统一。新源码安装态仍待本轮重打。


### 用户当前 macOS 截图追加（UX-S9-82—84）

| 编号 | 用户反馈 | 定位与修复 | 交付判据 |
|---|---|---|---|
| UX-S9-82 | 头像、AI、普通导航图标中轴仍不同 | 截图同时含旧星芒和旧“可提议改动”，与当前源码不符；当前 rail 点击盒已统一，不能再拿源码替代安装态 | 最终源码重建并重装 macOS/Windows；对安装后窗口核对图标中心和当前产物身份 |
| UX-S9-83 | AI 图标不得用千篇一律的星芒或通用机器人 | 新增原创“双页”符号，24 单位几何在 design-system 维护；Web rail、面板标题、内部能力、记忆入口、Landing AI 展示和移动助手标题使用同源路径，颜色跟随语义 token | 小尺寸亮暗主题可辨；全部 AI 身份入口无旧星芒；最终安装包包含新符号 |
| UX-S9-84 | hover 左侧图标，提示跑到窗口顶部且不可见 | rail 抽成组件时遗漏原 `anchorRailLabel` 接线，CSS 回退 top=0；已接 hover/focus 定位、滚动/resize 更新和视口双轴边界约束 | Chromium 定向回归通过；真实 WebKit/安装态继续核验，提示必须位于对应按钮旁且完整可见 |

这三项纳入原清单，不覆盖 UX-S9-1—81。四端最终重建安装已全部完成，结果见 `apps/web/evidence/ux-final-release/four-platform-install-s9-82.txt`；具体交互验收范围如下。


### 最新交付事实：四端安装与 UX-S9-82—84 验收（2026-10-07）

本节更新当前状态，之前的构建中、待安装及旧哈希属于历史批次。安装通过与专项交互通过分别列出，不以局部通过推导全应用验收完成。

| 项目 | 当前结果 | 证据 |
|---|---|---|
| 四端最新产物 | macOS、Windows、Android、iOS 均清旧包、重新构建、安装并通过当前产物启动判据；macOS 已退出残留旧进程并启动新安装副本 | `apps/web/evidence/ux-final-release/four-platform-install-s9-82.txt` |
| UX-S9-82：共轴 | 已完成。Windows 安装态头像、任务、日历、习惯、搜索、助手、更多、回收站、通知、帮助、同步的横向中心全部相同（31.6 CSS px）；WebKit 中按钮/SVG 中心均为 31.5，rail 为 32（边框造成半像素差）。选中仅图标高亮；键盘焦点保留可见指示 | `apps/web/evidence/ux-final-release/windows/rail-installed-geometry.json`；`apps/web/evidence/rail-webkit-s9-82/rail-webkit-s9-82.json` |
| UX-S9-83：原创助手图形 | 已完成并进入四端产物。原创“双页”几何在 design-system 单点维护，Web、Landing 与 RN 共用；已查看 macOS/Windows 和 iOS 安装截图及 WebKit 深浅主题 | `assets/illustrations/assistant/preview.png`；`apps/web/evidence/ux-final-release/macos-installed-s9-82.png`；`apps/mobile/evidence/ux-final-s9-82/ios/ai-assistant-original-mark.png` |
| UX-S9-84：提示锚点 | 已完成。Windows 安装态任务/日历/助手 hover 均紧邻按钮右侧并纵向居中；WebKit 深浅各 10 个提示的 hover/focus、短窗口真实滚动、resize 均留在视口内，0 pageerror、0 request failure | `apps/web/evidence/ux-final-release/windows/rail-*-tooltip.png`；`apps/web/evidence/rail-webkit-s9-82/` |
| 账号密码与助手档位 | 已进入最新产物。Windows 实际验证邮箱与密码同屏、档位恰为“只读 / 执行”；iOS 安装态也已查看邮箱/密码入口和原创图标 | `apps/web/evidence/ux-final-release/windows/password-login.json`；同目录 `rail-installed-geometry.json`；`apps/mobile/evidence/ux-final-s9-82/ios/account-password.png` |
| iOS 当前安装态 | 任务 12 步、Profile/Settings IA 23 步通过，含长按、四象限移动撤销、时间线、键盘和返回、个人中心、成长、清单与 AI 入口 | `apps/mobile/evidence/ux-final-s9-82/ios/tasks-ux-journey.json`；`profile/settings-ia-journey.json` |
| Android 当前安装态 | 安装 APK SHA256 为 `db883afd140b7ea9954025ebc41a011f33b39517a7390717c01135b96d013dc7`，任务 01—13 步通过。原总报告因 Profile 返回后的旧定位器失败；只修 QA 后独立 Profile/Settings 复跑通过，不覆盖原失败证据 | `apps/mobile/evidence/ux-final-s9-82/android/tasks-ux-journey.json`；`profile-rerun-fixed-2/journey.json`；`assistant-profile.png` |
| 官网与 Web 发布 | 已部署。本地与服务器入口字节一致：Web `e781ac96aa37aae11deb8bcfe900a1f2246b740be49af228cfe310a8fb08a2e8`，Landing `965e9537e1bd744c2ee42d47a53acfa23aab3e4c339bd5933fa2d5d9d8aa1ede`。原生包与 `/app/` 网页包挂载路径不同，不能混用入口哈希 | `apps/web/evidence/ux-final-release/deployment-s9-82.txt` |
| UX-S9-81：DOM 预览 | 当前官网 390/1440、亮暗四组合真实交互通过，无横向溢出和 pageerror；视图切换、任务详情/勾选、习惯打卡均直接点击 DOM | `apps/landing/evidence/dom-preview-release/results.json`、截图与 `deployment.txt` |

**仍未完成的边界：** 真人 VoiceOver/TalkBack 听读没有证据；macOS Widget/系统浏览器交接的 AX 探针超时，保持未验。Windows 已有原生环境识别及系统浏览器新增帮助标签的真实 UIA 读数，但整套外链自动化未全通过，保留 `windows-widget-help/windows-browser-valid-readout.json` 中的 `automationSuitePassed:false`。这些情况不影响上述三项已证实修复，也不应被安装成功掩盖。独立 inbound automation 的 AC-1—8 仍由后续执行者实施。


### 安装验收新发现登记（保持未完成）

| ID | 实际发现 | 后续处理 | 状态 |
|---|---|---|---|
| UX-S9-85 | Android 的 AI 设置快捷添加按钮显示字面量“添加 {name}”，名称插值未呈现 | 核查移动端词条适配与参数传递，保持中英同步；修复后重新验证按钮名称和对应产物 | 源码已修复 presetAdd 的 name 插值，并同步预设中英文；移动类型检查通过，待本批最终安装核验 |

Android 的“快捷开始”及 AI 设置分组前省略号属于分组动作图标，不作为助手身份标记；它不应与已替换的原创助手入口混淆。后续分组图标是否应保留继续按其交互含义审核。

### 注册与习惯交互纠偏（2026-10-07 用户追加，状态收口）

| ID | 用户要求 | 产品决定与验收 | 状态 |
|---|---|---|---|
| UX-S9-86 | 注册应有邮箱验证码，现有发件邮箱为什么没用 | 复用已配置 SMTP，新增六位注册验证码挑战；注册提交后显示收件邮箱、验证码、重发和修改邮箱。短时过期、次数限制、单次消费、账号/IP频控；不能让未验证注册覆盖已验证账号。验证成功接现有会话。真实邮件链路和错误状态分别验 | **代码与测试完成**：服务端 OTP 单测/API 路由测试及真实 PostgreSQL 集成测试已补齐；Web jsdom/移动端回归与真实 Chromium `page.route` 浏览器验收（桌面、390px）通过。**生产 SMTP 真实投递/失败状态仍待验；本批四端重装安装态仍待验。** |
| UX-S9-87 | 确认密码与强度提示 | 仅注册显示确认密码、不一致不提交；允许密码管理器、粘贴、显示/隐藏。强度在本地估计、不上传原密码；不强制凑齐大小写数字符号。保留现有服务端8～256码点、常见及泄露密码检查，明确这与 NIST 单因子15字符要求不同 | **代码与客户端/API 回归完成**：确认密码、密码强度、显示/隐藏、密码管理器/粘贴路径已接线；Web/Mobile 定向测试及浏览器注册旅程通过。生产 SMTP 属 UX-S9-86 的外部链路，仍待真实投递验收；当前源码四端安装态仍待验。** |
| UX-S9-88 | “开始自律计划”要有仪式感与动态背景 | 原容器内绘制计划成形的HTML/SVG场景，背景与前景分层；短时入场与完成反馈，不遮表单；窄屏简化、减少动态效果静止 | **代码与 Web 浏览器视觉验收完成**：桌面/移动、亮/暗主题及 `prefers-reduced-motion` 已复核，场景不遮挡表单。当前源码四端安装态仍待验。** |
| UX-S9-89 | 习惯页不应常驻“更多设置”和新建配置 | 右上角＋打开添加习惯弹窗；创建字段归弹窗，取消不写，确认一次真实create动作。页面…菜单只放习惯页操作，不混入个人设置 | **代码与真实浏览器验收完成**：加号新建、取消、零目标、空名称和入口归属已覆盖；当前源码四端安装态仍待验。 |
| UX-S9-90 | 习惯打卡记录导出 | 从习惯页…导出实际打卡记录CSV，正确日期、数值、单位与状态，CSV转义和公式注入防护；不以全库备份冒充打卡记录导出 | **代码与真实浏览器验收完成**：真实打卡记录 CSV 导出旅程及转义/公式注入防护已覆盖；当前源码四端安装态仍待验。 |
| UX-S9-91 | 更多浮层遮住侧栏，无法拖图标到侧栏 | 浮层始终位于图标栏右侧，侧栏完整可见；直接拖入指定位置有落点反馈、刷新保留，取消拖拽不改偏好；不因默认4项限制静默挤掉新固定项 | 代码及真实鼠标拖拽/刷新/取消验证通过（rail-geometry 4项）；默认4项不再限制主动固定数量，待本批安装核验 |

研究依据：NIST SP 800-63B-4 的 Password Verifiers、OWASP Authentication Cheat Sheet、GOV.UK Passwords / Confirm an email address。资料与具体裁决见 `docs/research/auth-dialog-ux-audit.md` 追加记录。此批完成前不复用上一批四端安装成功结论。


| ID | 用户新增反馈 | 验收要求 | 状态 |
|---|---|---|---|
| UX-S9-92 | 日历侧栏开关过大、加号套框，右侧详情开关在日历无效 | 工具栏使用紧凑无框图标，有名称提示；无详情能力的视图不出现开关，其他视图收起后仍可恢复 | **代码与真实浏览器验收完成**：无效开关、紧凑工具栏和抽屉入口已覆盖；当前源码四端安装态仍待验。 |
| UX-S9-93 | 月历是独立作文格，周行有间隔 | 共享月历改连续横竖单线，无周行缝隙、无外围卡片；事件条与日期仍可读可点，深浅/窄屏检查 | **代码与真实浏览器验收完成**：连续网格、事件可读可点及深浅/窄屏范围已覆盖；当前源码四端安装态仍待验。 |
| UX-S9-94 | 搜索输入蓝框；全应用应无边界 | 输入仅光标，无框中框；普通按钮与菜单无描边，键盘焦点以底色与文字高亮；同步Web与移动共享控件，逐页检查。日历语义分隔线按UX-S9-93保留 | **代码与真实浏览器验收完成**：无描边搜索、键盘导航/焦点返回及共享控件范围已覆盖；当前源码四端安装态仍待验。 |


### UX-S9-92—94 无描边与日历响应式核验（2026-10-07，Web 验收完成，本批产物尚未发布/安装）

- 用户最新截图是搜索输入的蓝色内焦点框，登记并并入 UX-S9-94；输入以光标表达编辑位置，按钮/菜单/选择器以底色与文字显示键盘焦点。不得恢复蓝色外框，也不使用无反馈的键盘焦点。
- 清理共享 SearchPanel 的输入、分组线与材质外框；共享 materialSurface 不再画 rim。Web 普通交互控件、设置/个人中心/AI/习惯等装饰卡片去描边，原生基础 Button/TextField 同步。任务完成标识和日历数据分隔线有实际语义，不将其当装饰框删掉。
- 日历工具栏去掉长侧栏文字和加号边框；不再渲染无效的右侧详情开关。月历采用连续横竖单线。真实测量发现矮窗口固定画三条任务会裁掉后两条，现按实测格高计算可见条数，保留准确的 `+N`。
- 390px 视觉核验发现迷你日历被排在主月历下方，再次挤压主视口：改成按需打开 ScopeDrawer，默认只显示主月历；桌面仍使用可调整宽度的侧栏。
- 当前真实浏览器：搜索无框+连续网格在1440/390、亮/暗四组合通过；搜索键盘上下/回车/Esc和焦点返回通过；月历铺满、条目不裁切、隐藏数准确通过。截图已实际查看，证据 `apps/web/evidence/borderless-ux/`，用例 `e2e/tests/borderless-ux.spec.ts`、`calendar-cells.spec.ts`、`search-overlay.spec.ts`。
- Web 真实浏览器验证已完成；仍待全局源码冻结后的最终产物、四端安装、原生端复验和生产部署。新注册 OTP 的代码/API/真实 PostgreSQL 测试与浏览器 mock 验收已完成，但生产 SMTP 真实投递与本批四端安装仍待单独验收，不使用上一批安装成功代替本批验收。

### 2026-10-07 注册 OTP 状态与全清单未完成项扫描

本次扫描以本文所有 `UX-S9-*` 行的**当前状态列**为准，同时检查了重复的历史回填段。注册 OTP 的事实证据分层如下：

- **代码与测试已完成**：服务端 `server/tests/registration-otp.spec.ts`、API 路由测试和 `server/tests/integration/registration-otp.integration.spec.ts`（真实 PostgreSQL 配置下运行）；Web `auth-panel`/`auth-journey` 回归、移动端认证回归，以及 `e2e/playwright.auth-otp.config.ts` 在独立 `4359` 端口上的 Chromium mock 邮件旅程（1440px 与 390px）均已覆盖。浏览器用 `page.route` 截获 request/verify/resend，未发送真实邮件。
- **仍待外部事实**：UX-S9-86 的生产 SMTP 真实投递、失败/退信状态和生产环境频控只能通过真实部署验证；UX-S9-87 复用同一注册链路，但不把浏览器 mock 当作生产邮件证明；UX-S9-88 的动态注册场景已通过 Web 亮暗、窄屏与 reduced-motion 验收，仍需把当前源码重新安装到四端后复核。

全清单扫描结果：

| 类别 | 条目 | 结论 |
|---|---|---|
| 仍需实作或专门验收 | UX-S9-07、13、15、17、18、19、20、21、42、50、59/59-A/59-B、60、75、79 | 这些条目的状态仍写着“进行中 / 待开始 / 待验收 / 明确未实施”，需要对应 owner 继续实现或补齐专门的视觉、真机、读屏、动态/外链、生产部署证据；不能由本批安装代替。UX-S9-75 的公网 AC-1—8 尚未实现；UX-S9-79 中模型没有所有者的 `startDate`、独立坚持天数、分组和习惯提醒仍保持未实施。 |
| 代码与当前 Web 证据已有，主要待本批当前产物安装/原生复验 | UX-S9-01—06、08—12、14、16、22—24、25—32、33—38、43—45、48、52—58、61—74、76—78、80、81、85、89—94 | 这些条目已有代码和 Web/共享层证据；剩余工作是从同一源码冻结点重建、安装并在对应原生壳/真机复核。若条目另注明父级视觉复核、Widget Board 注册、外链人工点击或读屏，则仍需完成该专项，不能简化成“安装已过”。 |
| 历史模块分工（不构成当前阻塞） | 主布局（UX-S9-01/02/07/09/10/11/12/14/16/17/19）、sync/AI/隐私（03—06、12、24、53）、data/清单（08、12）、rail（22/23/66/77/91）、calendar（25—38、92/93）、mobile（15、42、63/64 端侧）、landing/动效（19—21、50、59）、design-system（59-A/B/C、60）、shell 原生外链（43—48、73/76）、项目级 UX（13/18）、后续 inbound automation 执行者（75） | 表中的 owner 只记录历史实现分工和证据来源；当前产品收口由 root 统一协调。唯一明确由后续执行者承接的是 UX-S9-75 inbound automation AC-1—8。 |

这次扫描没有把“测试文件已存在”升级为“生产已上线”，也没有把上一批安装包的通过结果外推到本批新增源码。生产 SMTP、当前源码四端安装、Widget/外链原生交接和真人 VoiceOver/TalkBack 仍分别保留为开放边界。

### 历史发布记录：2026-10-08 多端测试发布收口（B1/B2）

本节是本轮最新事实。此前“本批尚未发布/安装”的文字属于阶段记录，以此处的平台逐项记录为准；安装成功不自动关闭未做过的交互验收。

| 交付项 | 当前实证 | 尚待/边界 |
|---|---|---|
| 生产服务端 | OTP 迁移已应用；真实沙箱后生产切换，镜像身份匹配，健康检查 200，密码错误返回 401；Argon2id 启动已验证 | 真实邮箱收件和完整 OTP 注册闭环仍待验 |
| Web / 帮助中心 | 已部署；公开 `/app/` index 与本机生产构建逐字节一致，JS/CSS 和 `/docs/` 200 | 生产浏览器390/1440登录/注册字段、强度提示、帮助返回主页与条目导航已通过；没有触发发信，页面无JS错误 |
| macOS | 当前源码重新打包并安装；包内 web-dist 对账通过；安装副本截图为共享 UI；Developer ID、公证、stapler 验证通过 | 不以首屏截图代替帮助外链和全部交互验收 |
| Windows | 当前源码重新打包并安装，全部 26 个 Web 资源逐字节一致；MSIX 签名验证 0；测试 ZIP 含公开 CER 与中文安装说明 | 自签名测试证书，首次安装需要管理员信任；不含私钥 |
| Android | 当前源码发布签名 APK 已重打、重装，证书指纹与登记一致；任务主流程13项通过 | Profile独立复验通过；脚本改按可见AX节点和稳定资源ID识别路由，未减少范围。视觉问题继续独立登记 |
| iOS | 该历史批次的 `com.heyta` 1.0 (3) 已归档、签名、上传；Apple 处理 VALID，已加入现有“内部测试”组；包级 Widget/App Group/图标检查通过，但不等于 Widget Gallery 已添加 | 该历史批次模拟器已重装；任务旅程12项、Profile/设置23项通过；无公开 TestFlight 邀请链接 |
| Linux | 新 DEB 已打包，包内共享 UI hash 与当前 Web 相同；解包启动与截图通过 | 验证机限制 user namespace，采用无沙箱档；未做系统级安装 |
| 测试分发 | 标签 `v1.0.1-test.20261008.1`，快照 `0107fe15440aecf5775a71574ba973406d8b4c49`；GitHub 草稿与包已准备 | GitHub已公开，5个资产SHA-256与本机相同；匿名API与校验和可读；COS四端上传和匿名HEAD通过，latest.json已切换本批 |

继续保留 §9 的所有未完成项。尤其真人 VoiceOver/TalkBack、桌面帮助交接、习惯尚无模型的字段、四象限撤销隐式重要性恢复不能被“多端包上传”代替。Inbound automation 属另一执行任务，本轮不占用其实施归属。

#### 本批最终截图复审新增（不得因测试包发布漏掉）

| ID | 真实截图问题 | 下一步产品决策与验收 | 状态 |
|---|---|---|---|
| UX-S9-95 | 原生移动任务首屏同时常驻手势说明、搜索、视图切换、日期/倒计时和排序，窄屏形成三排胶囊，任务内容被压至屏幕中部 | 将低频显示/排序偏好收进单一视图菜单，主屏保留搜索入口、当前视图和任务；手势教学按需出现。逐端真实截图核对首项任务位置、菜单可发现性和偏好持久化 | **代码完成，Android当前安装态已通过，iOS分段通过**；证据 `apps/mobile/evidence/ux-s9-95/android-final/` 与 `ios/segmented-ux.json`，完整iOS自动旅程保持未通过 |
| UX-S9-96 | 原生任务详情常驻解释“内部清单排程/时间线不同坐标系”等长文，并在无拆分项时展示估算时间线，编辑态认知负担仍高 | 默认突出标题/备注/日期等主路径；有排程数据或主动展开后再显示排程，说明改为按需帮助，未估时保持真实表达。验收键盘避让、单任务和多子项两种状态 | **代码完成，Android排期展开/收起、键盘与返回已通过，iOS排期展开/收起分段通过**；iOS完整键盘旅程仍待稳定复验 |

| ID | 真实截图问题 | 下一步产品决策与验收 | 状态 |
|---|---|---|---|
| UX-S9-97 | Android“我的”首屏截到部分倒数入口，初步怀疑底部导航遮挡 | 先实际滚动测量完整行与底栏位置，再决定是否修改布局 | **当前标准字号未复现遮挡**：完整行 bottom=1899，底栏 top=2169，标题/副标题均可见，进入/返回成功。初始截图是滚动视口裁切；不盲目增加 padding。大字体仍待专项验收 |
| UX-S9-98 | 我的页通知/成长/习惯/倒数纪念日仍是文字链接与说明堆叠，和上方状态信息层级不一致 | 统一无描边整行动作组件、图标/主副标题/点击范围，明确目的地；不用加框解决 | **已实现并随当前包安装，Android个人中心旅程通过** |
| UX-S9-99 | 原生成长空数据态主要依靠文字与数字 | 接入已有共享空状态插画及下一步操作；不伪造统计 | **已实现**；年度热力图来自共享真实投影，补打卡/重新开始显式写入目标量（含0），同步锁防连点，相关动作/UI回归通过 |
| UX-S9-100 | 原生同步与隐私页的自托管底部入口缺少清楚的首次使用路径 | 保持官方同步优先；自托管主动开启后才出现连接配置与帮助，不扩大默认信息量 | **Android 当前安装态已复核**：默认官方同步；主动开启自托管后才见连接字段；返回官方和取消登录均保留官方路径，未提交凭据。证据 `apps/mobile/evidence/ux-s9-100/android/journey.json`；其他端不外推 |

TestFlight build3 已新增 `zh-Hans` 测试说明；内部组已有1名测试员，构建已关联。未发邀请/通知，未提交外部审核。

### 2026-10-08 发布后的逐项修复

- UX-S9-95/96：任务首屏单一视图入口、菜单内日期/排序、详情排期渐进披露已实现；菜单有显式关闭。UX-S9-98/99：原生Profile整行入口、成长空态/年度真实热力图已实现。本节为修复时记录；当前源码已完成第二批四端安装，Android深浅主题已复核，iOS分项验收继续记录在下方。UX-S9-97实测标准字号未复现遮挡。
- 四象限撤销语义：新增共享 `QuadrantTaskPatch` 与 `planQuadrantDropUndo`，保留 `important` 未设置时跟随优先级的行为，只恢复本次移动触及的截止时间。Web/移动统一单op写入口；app-host真实SQLite测试37/37通过，包括清字段JSON、回放与撤销后再改优先级。该修复已纳入第二批重打产物（20261008.2），不属于此前20261008.1产物。
- 设计规范已清除正文中“Secondary必须描边”“内容用边框分隔”等与最新无描边裁决冲突的规则。
- 生产真实验证码收件需要用户提供可收信的未注册测试邮箱，已异步询问，其他实现继续推进。

- UX-S9-07补验：七组浏览器旅程全部通过，包含受控写入错误后的输入/颜色保留、同步防重入、真实重试写入及刷新持久化。故障由测试注入，不宣称真实磁盘或网络故障验收。
- 原生帮助外链：当前macOS锁屏，AX无可点击窗口，本轮不能完成手动入口交接；不把Web链接正常或壳启动截图计作此项通过。

### 2026-10-08 第二批测试更新（UX-S9-95 起）

- 四端重装脚本已通过。本轮补充的“切到时间线清除不可见多选”在Android额外重打后重新安装，APK SHA256 `983023e5d006fe9a010af0b29ca1e15775fa955249fa6cbf81381cf4f4c30e9e`。Android任务旅程16项及Profile/设置链通过；最新证据在 `apps/mobile/evidence/ux-s9-95/android-final/`。iOS仍在补查脚本滚动定位，不以Apple处理成功替代交互验收。
- macOS Developer ID签名、公证与stapler通过；Windows当前MSIX签名有效、已安装状态Ok。Windows帮助真实打开系统浏览器 `/docs/`，壳保持 `heyta.local`；原生Widget环境识别通过、PWA步骤为0。此项**不等于**Windows系统Widget面板已添加验证。
- Linux新包共享UI与当前desktop产物对账通过，解包真实启动/截图通过，未做系统安装。
- Web已更新，公网index与生产构建逐字节匹配（SHA256 `270754e847929964ccfa3f884ba99e8ca08a11ad43ba7ef52b9f0a5b204d7c12`）；390/1440登录、注册确认密码、强度提示、帮助返回主页和文章导航已复验，0页面错误，未触发邮件发送。
- TestFlight `1.0 (4)` 已签名、上传并由Apple处理为VALID，包与Widget内部构建号一致；测试说明为中文。已关联既有“内部测试”组，API回读包含build4；没有创建公开邀请链接或发出邀请。公开下载发布状态在分发记录继续更新。

- 第二批公开下载已完成：GitHub `v1.0.1-test.20261008.2` 五个资产摘要逐一匹配，COS四端匿名可读、`latest.json`版本/大小/哈希匹配；见[分发证据](../../apps/web/evidence/ux-closeout/release-2026-10-08-b2/release.json)。TestFlight build4 内部组关联已API回读。
- Android深浅主题截图已人工查看（任务视图菜单、个人中心、成长空态）；倒数入口完整滚入后实测可点，严格目标页断言重跑通过。UX-S9-100官方/自托管返回路径通过，无实际连接或账号变更。
- 文档历史四条本机截图链接受忽略规则排除，已改为明确的本机历史记录，避免干净检出死链；发布快照加本轮收口文档在临时索引检查通过，未修改用户Git索引。其余原始未完成项继续保留，不因测试分发标记全计划完成。


#### 第二批 iOS 分段验收与新发现

当前安装态已通过视图菜单/排序/日期切换、排期展开收起、长按两项多选、个人中心入口、成长空态入口；证据 `apps/mobile/evidence/ux-s9-95/ios/segmented-ux.json`。整套自动旅程仍有 AX 空树和滚动定位时序问题，保持 `partial-pass`，不将分项结果合并成“全旅程通过”。这也不代表实体 iPhone 已验收。

| ID | 最新截图发现 | 后续验收要求 | 状态 |
|---|---|---|---|
| UX-S9-101 | iOS 底部任务 Tab 在14项时计数显示为“1…”；徽标宽度不足 | 计数应按内容宽度增长或明确显示上限（如99+），不能截断成省略号；两端验证个位/两位/三位及大字号，不影响图标中轴线 | **代码已修复，iOS 当前增量安装实测 12 完整显示**；共享 Badge 使用内容尺寸，TabBar 提供明确测量宽度；`apps/mobile/evidence/ux-s9-101/ios-count14-after-badge-fix.png` 实际是 12 待办、2 完成，文件名保留历史命名。0/1/99+ 和大字号尚未逐档原生截图验收；已发布20261008.2仍含此问题 |

- iOS另已实证“已选2项 → 切时间线 → 退出选择/已选提示消失”，证据 `seg-timeline-clears-selection-selected2.png` 与分段JSON；不再将这一项标为待验。

- iOS模拟器测试数据清理未完成：本轮14条 `UxTaskA/B` 仍保留，未提交删除确认、未触碰其他任务；应继续用应用写入口清理，不直接修改数据库。

### 2026-10-08 提醒、数据管理、AI 长对话与隐私产物补验登记

本节只记录本轮新增的专项证据，不覆盖本计划中尚未完成的条目，也不把 Web 验收或历史发布包验收扩大为当前四端交付完成。

| 专项 | 本轮结果 | 证据与边界 |
|---|---|---|
| 提醒与数据管理响应式 UX | **真实 Chromium 通过**：亮色/暗色 × 390/1440；提醒默认未授权、已授权、已拒绝、浏览器不支持、请求失败五种状态均可达；JSON/Markdown 导出、非空库导入拒绝、导入失败保留文件摘要与当前上下文、取消选择保留当前选择、拒绝导入后原任务仍在；无横向溢出 | 脚本 [`scripts/qa/reminders-data-responsive.mjs`](../../scripts/qa/reminders-data-responsive.mjs)，报告 [`apps/web/evidence/reminders-data-responsive/report.json`](../../apps/web/evidence/reminders-data-responsive/report.json)。本轮修复 `ReminderNotifyPanel.tsx` 的暗色主按钮语义和设置动作容器布局；Web typecheck 通过，既有提醒专项 5/5 通过。未据此宣称 OS 原生通知已实际投递或生产 SMTP 已验证 |
| AI 长对话滚动与输入区 | **Web 3/3 通过**：长对话滚动区域、输入区布局与设置场景的浏览器验收完成 | 证据目录 [`apps/web/evidence/goal-settings-final/`](../../apps/web/evidence/goal-settings-final/)，涉及 `AssistantPanel` 与 `apps/web/src/styles/app/ai-panels.css`。本次记录不代表新增源码已经重新打入四端发布包 |
| 隐私 release2 产物 | **7/7 通过**：release2 隐私产物检查完成 | 隐私场景证据 [`apps/web/evidence/goal-settings-final/privacy/`](../../apps/web/evidence/goal-settings-final/privacy/)，包含首启、接受和仅本地状态截图；“7/7”只表示该轮产物检查，不等于生产邮件真实投递、全部隐私合规闭环或所有原生端读屏验收完成。当前源码后续新改动尚未因本条记录重新重打发布包 |

本节的收口口径：专项代码与 Web 证据可以关闭对应的 Web 验收项；原生通知投递、生产 SMTP、VoiceOver/TalkBack、Widget/外链交接以及当前源码四端重打和安装，仍按上方清单的独立验收边界执行。

### 2026-10-08 本轮安装与助手补充复核

- UX-S9-101：第一次仅添加 flex 属性仍显示“1…”，该尝试不算修复；第二次给 TabBar 角标明确测量宽度并让数字徽标按内容增长后，iOS Release 增量构建、保留测试数据安装、截图均完成。真实截图显示 12（不是文件名里的14），尚未扩大为其他计数档位或最终四端发布通过。
- 助手本机查询改用中英文词条，显示结果内容，技术工具名留在过程信息中。当前浏览器验证普通任务创建在出境同意前不落任务、同意后直接执行一次、刷新不重复；不再用“每次写入确认”的旧预期验收默认执行模式。
- 助手历史面板窄栏覆盖关闭入口已复现：新增面板内关闭按钮、Escape 返回焦点，新会话收起历史并聚焦输入框。浏览器真实点击通过。独立审查发现的披露/执行状态跨挂载点可见性回归现已修复；取消披露恢复草稿且移除未发送消息。最新三个助手单测文件合计44项通过，真实模型端点替身旅程2/2、长对话及设置浏览器3/3通过，仍不代替原生四端验收。
- 小组件系统层最新 chronod 读数为四个 widget descriptor，均 enabled=YES，另有一个 control 和一个 activity；见 `apps/mobile/evidence/ux-s9-95/widget-chronod-descriptors-20261008.json`。随后用 IDB AX 在同一模拟器刷新 chronod 与 SpringBoard，Widget Gallery 仍无 Heyta provider，`widgetAdded: false`；见 `widget-gallery-idb-20261008.json`。当前准确结论是“extension/descriptor 已注册，但 Gallery 搜索/添加失败”。
- Apple API 回读确认该历史批次 TestFlight 1.0 (4) 为 VALID；devicectl 当时仅见模拟器，没有可用的已连接实体 iPhone。B3 的当前 TestFlight build 5 状态以文末 release.json 为准。

### 本轮新增问题逐项登记（第三批测试）

| 编号 | 问题 | 当前结果与验收边界 |
|---|---|---|
| UX-S9-102 | 助手长会话消息被裁切、覆盖输入区 | 已修复；消息、披露和等待状态共用滚动区，输入区固定。线上深浅主题与1280/1078/375/900宽度（含400高矮窗口）通过 |
| UX-S9-103 | 窄侧栏会话历史挡住关闭按钮，新建后仍遮挡输入区 | 已修复；浮层内关闭、Escape返回触发器、新建收起并聚焦输入框，真实点击通过 |
| UX-S9-104 | 跨挂载点后披露/等待状态不可见，取消披露保留假已发送消息 | 已修复；按会话阶段决定可见性，取消恢复草稿并移除未发送消息；助手相关44项单测通过 |
| UX-S9-105 | 开启通知按钮暗色对比度不足、桌面被拉成整行 | 已修复；使用主动作样式并置于操作区，当前截图尺寸88×44；两种主题、390/1440宽度已验收 |
| UX-S9-106 | 原生首启联网说明中的协议入口仍显示下划线，与全局无下划线要求不一致 | **源码已修，未纳入新发布**；同时移除原生补签和桌面回跳链接下划线，原生链接有真实最小触摸高度、焦点/按下反馈和打开失败可见提示。原生协议相关 64 项、Web 回跳 8 项测试通过；待更新包实际查看，不以源码搜索关闭此项 |
| UX-S9-107 | 助手重复提交、请求运行时新会话可能隐藏仍在执行的任务 | Web 已加同步阶段锁和运行中新会话禁用，延迟写入单测通过；移动发送/采纳/确认统一防重入、系统返回及异常恢复已修并通过复审，最终安装态仍待验 |
| UX-S9-108 | 移动 AI 仍是旧的功能模式表单，与单一 Chatbot 产品决策不一致 | **单一 Chatbot 源码已落，iOS 本地读实际通过，尚未发布**；Profile → AssistantScreen 已接共享 requestAssistantTurn、默认执行/只读、披露、消息、提案和历史。旧结构化四功能的完整替代仍缺，不以视觉替换关闭能力核对；键盘与设置返回正在安装态复验 |
| UX-S9-109 | Windows 帮助入口是否真正交给系统浏览器，原生小组件页是否误导安装 PWA | B3 安装态已通过；UIA 读取系统浏览器帮助中心地址及新增标签，壳内地址保持 heyta.local；小组件页正确说明原生能力。见 [本轮证据](../../apps/web/evidence/ux-round4/windows-help/windows-widget-help.json)。此项不代表 Windows Board 已支持添加 |
| UX-S9-110 | 移动端切换底部 tab 会卸载助手子树，回到个人页丢失草稿、提案与执行结果 | **源码已修、待安装态交互复核**；按 profile 自己的导航栈保留助手，隐藏页面解除返回键监听。并发/导航 13 项测试通过；仍须在实际安装包中验证运行中切 tab 与返回后的结果 |

第三批四端重打重装已全部通过，iOS TestFlight 1.0 (5) 为VALID且加入既有内部测试组；第五轮已经用真实截图确认“今日任务”小组件实际添加并退出编辑态，仍缺其余模板、点击回应用、数据刷新、实体 iPhone、真人读屏和生产邮件收件等边界。源码快照与包验收详见 `apps/web/evidence/ux-closeout/release-2026-10-08-b3/release.json`。未部署另一任务的入站自动化服务端。

## 历史行动表（B3，2026-10-08）

本表只覆盖本轮活动 Goal：同步/隐私、数据管理、提醒、原生 Widget、Profile/账号、AI、帮助交互。B3 发布事实为：`status: published`、服务端快照 `3880bdd1fd5e8fe3710bd19c5f753947ea89c468`、TestFlight build `5` 为 `VALID` 且已关联内部测试组、`fourPlatformReinstall: true`。四端重装证明产物进入安装态，不自动证明每个交互矩阵已经在 B3 逐项重跑。

| Goal 范围 | 当前准确状态 | 分类 | 证据 | 下一步 / 阻塞 |
|---|---|---|---|---|
| 同步 / 隐私 | 代码已实施；Android 官方同步默认、自托管主动展开与返回路径通过；iOS 离线隐私选择、Profile → 设置 → 同步与隐私旅程通过。两端均未提交服务器凭据；完整四端网络、登录和状态矩阵仍缺。 | 已实现，缺完整运行证据 | [`ux-s9-100/android/journey.json`](../../apps/mobile/evidence/ux-s9-100/android/journey.json)；[`profile-center/ios-current-light/settings-ia-journey.json`](../../apps/mobile/evidence/profile-center/ios-current-light/settings-ia-journey.json)；B3 [`release.json`](../../apps/web/evidence/ux-closeout/release-2026-10-08-b3/release.json) | 在 B3 产物上补 macOS、Windows、Linux 及移动端官方登录/自托管连接、错误和返回矩阵；不要把 UI-only 路径写成真实同步闭环。 |
| 数据管理 | 导出、空库还原、非空库拒绝、失败上下文保留和取消选择等代码与 Web 真实 Chromium 证据已完成；Android 最近一次 Profile/Settings 旅程包含导出/还原路径并通过，iOS 设置旅程也通过。完整四端数据管理矩阵仍缺。 | 已实现，局部端已通过 | [`reminders-data-responsive/report.json`](../../apps/web/evidence/reminders-data-responsive/report.json)；[`ux-s9-95/android-final/profile/journey.json`](../../apps/mobile/evidence/ux-s9-95/android-final/profile/journey.json)；[`profile-center/ios-current-light/settings-ia-journey.json`](../../apps/mobile/evidence/profile-center/ios-current-light/settings-ia-journey.json) | 用 B3 当前 APK/各原生包补四端导出、还原、拒绝和失败保留状态；不要用安装成功替代数据动作验收。 |
| 提醒 | Web Chromium 已覆盖 default、granted、denied、unsupported、error 五种权限状态，亮暗 × 390/1440 通过；历史原生证据已存在：ADR-0051 记录 2026-10-03 Android Release 的系统通知与回执，以及 2026-10-04 iOS 模拟器的系统可见通知与 `firedAt` 回执。上述原生证据不是 B3 当前产物复验。 | Web 与历史原生证据已通过，B3 原生产物待复验 | [`reminders-data-responsive/report.json`](../../apps/web/evidence/reminders-data-responsive/report.json)；[`ADR-0051`](../adr/0051-mobile-reminder-delivery.md)；[`android-reminder-ring.png`](../../apps/mobile/evidence/android-reminder-ring.png)；[`ios-reminder-notification-center.png`](../../apps/mobile/evidence/ios-reminder-notification-center.png) | 在 B3 当前 Android/iOS 产物上复验系统通知授权、拒绝、恢复和实际投递；桌面通知按目标壳补证。生产 SMTP 不替代提醒投递证据。 |
| 原生 Widget 识别 | iOS extension 已安装注册，chronod 枚举出 4 个 enabled descriptor；第五轮复核可见截图确认 Gallery 已显示 Heyta。旧 AX 未读到 provider 行不能证明搜索无结果；“今日任务”小组件已实际添加至主屏并退出编辑态，截图和 AX frame 均确认存在。Windows Board、macOS/Linux Widget 添加与交互仍缺。 | 今日小组件已添加，其余模板及交互续验 | [`widget-chronod-descriptors-20261008.json`](../../apps/mobile/evidence/ux-s9-95/widget-chronod-descriptors-20261008.json)；[`widget-gallery-idb-20261008.json`](../../apps/mobile/evidence/ux-s9-95/widget-gallery-idb-20261008.json) | 已完成今日小组件添加，补启动与数据更新、其余三模板、Windows Board 和桌面壳能力识别/外链交互。 |
| Profile / 账号 | iOS Profile/Settings IA 旅程通过；Android 最新可用的 UX-S9-95 Profile 证据通过（artifact `983023e5…`），较早的 `profile-center/android-current-final-5` 失败记录保留为历史定位器失败。B3 已安装，但完整 Profile/账号登录、返回和状态矩阵尚未在四端全部重跑。 | 代码已实施，移动局部通过 | [`ux-s9-95/android-final/profile/journey.json`](../../apps/mobile/evidence/ux-s9-95/android-final/profile/journey.json)；[`profile-center/ios-current-light/settings-ia-journey.json`](../../apps/mobile/evidence/profile-center/ios-current-light/settings-ia-journey.json)；B3 [`release.json`](../../apps/web/evidence/ux-closeout/release-2026-10-08-b3/release.json) | 在 B3 产物上补四端未登录/已登录 Profile、账号密码、编辑资料、退出和返回路径；保留真人读屏缺口。 |
| AI | B3 已包含当前 AI 修订；Web assistant 单测 44 项、provider journey 2 项及长对话/提案确认等证据通过。移动端和原生桌面壳的完整 AI 交互、权限和出境矩阵仍缺。 | Web/共享层已通过，跨端证据不足 | B3 [`release.json`](../../apps/web/evidence/ux-closeout/release-2026-10-08-b3/release.json)；[`goal-settings-final/`](../../apps/web/evidence/goal-settings-final/)；本文件 UX-S9-102—104 | 在 B3 各端补单一 Agent 入口、权限档位、出境披露、提案确认、历史/新会话和窄屏路径；不能把 Web provider journey 外推为原生通过。 |
| 帮助交互 | 官网/Web 帮助中心返回首页、文章导航、亮暗/窄屏和无下划线规则已通过；Windows 已有真实 UIA 证据证明帮助外链打开系统浏览器且壳页面保持不变。macOS/Linux 外链的完整人工点击/AX 交接仍缺。UX-S9-106 在 B3 包中仍有下划线，当前源码已修并通过相关测试，等待新包可视验收。 | Web/官网与 Windows 已通过，其他原生外链与 UX-S9-106 未完成 | [`live-readout.json`](../../apps/landing/evidence/docs-release/live-readout.json)；[`windows-widget-help.json`](../../apps/web/evidence/ux-round4/windows-help/windows-widget-help.json)；B3 [`release.json`](../../apps/web/evidence/ux-closeout/release-2026-10-08-b3/release.json)；本文件 UX-S9-106 | 移除 Android/iOS 首启协议入口下划线但保留可点击、键盘和读屏语义；补 macOS/Linux 外链打开、返回和失败状态证据。 |

### 本轮续验（尚未发布新包）

[本轮验证记录](../../apps/web/evidence/ux-round4/verification.json)记录本轮源码哈希、检查输出和发布边界。当前下载包仍为第三批；本轮源码不能冒称已经进入 TestFlight build 5。

iOS 新构建的提醒专项得到 26 通过 / 1 失败：App 在 trigger 前终止，系统真实显示本轮唯一任务标题的通知横幅，恢复后 SQLite 回读同 occurrence 的 firedAt 与精确 firedForTriggerAt，取消边界通过。唯一失败是 AX 未读到通知标题；[截图](../../apps/mobile/evidence/ux-round4/ios-reminders/notification-center.png)已人工核对，画面实际为 SpringBoard 加系统横幅，不能按文件名称为展开的通知中心。本专项构建早于最后的助手修复，不代表最终四端验收。


### 第五轮续验（源码仍在实施，未发布）

- **账号与发布**：本机 Apple Developer 签名与上传链路已经实证可用；当时记录的下一包目标为 build 6，但第六轮没有发布新包，当前发布仍为 B3 / TestFlight 1.0 (5)，Apple `VALID`。没有实体 iPhone 安装证据，不能把模拟器安装称为本机 iPhone 已装。
- **Widget 勘误**：[只读复核](../../apps/mobile/evidence/ux-round5/widget-gallery/round5-readonly-findings.json)确认此前截图里已经有 Heyta provider；AX 树没有暴露该行。当前模拟器实际 runtime 为 iOS 27.0，安装包使用 27.1 SDK；两者不得混写。
- **移动单一 Chatbot**：UX-S9-108 正在实施。Profile 助手入口始终可见并采用原创新图标，端点未配置时仍可走本地只读；会话、披露、只读/执行、提案确认与设置返回统一在单一对话界面。Web 与移动本地历史的解析、账号隔离及过期提案语义抽到 app-host，由各端注入存储。共享提取后 Web 历史 26 项通过；这些不是移动安装态验收。
- **不能漏掉的能力核对**：移动旧表单有结构化收集、拆解、排序和估时入口。共享 Chatbot 工具目录能读任务与提交部分任务写意图，但这不证明其完整替代原来的四个 request 入口，尤其拆解/估时的结构化采纳。`check-ai-coverage` 暂不放宽或豁免；需补齐对话/任务上下文入口及行为证据后，才可声称能力无损。

- **Widget 实际添加**：[第五轮添加记录](../../apps/mobile/evidence/ux-round5/widget-gallery/add-journey.json)及[主屏截图](../../apps/mobile/evidence/ux-round5/widget-gallery/16-widget-home.png)确认“今日任务”小组件已添加且退出编辑态；其余模板、点击回应用、数据刷新与实体 iPhone 尚未由此证明。


| 续验登记 | 实测问题 | 处理与边界 |
|---|---|---|
| UX-S9-111 | Chatbot singleton 先于类初始化，原生导入会抛 TDZ | 已调整初始化次序；controller 测试与实际 iOS 打开助手通过 |
| UX-S9-112 | 单槽聊天历史被另一账号输入草稿清除或发送覆盖 | app-host 提供账号分槽适配；身份含服务器与稳定 accountId，同邮箱不同服务器分离。旧单槽仅同账号回退；共享行为测试4项、移动切换账号测试通过 |
| UX-S9-113 | 从设置换端点/权限后复用旧披露，熔断冷却跨时导致展示与实际目标不一致 | fingerprint绑定路由、档位和字段，首次恢复重新披露；披露/请求共用冻结 routeTime 和 healthSeed。移动回归通过，真实远端旅程待补 |
| UX-S9-114 | 安装态 AI 未配置提示占据大卡片，输入区双重底部预留产生空白 | 提示改紧凑说明与“配置 AI”；权限/建议改轻量高亮；非滚动 Screen 明确铺满，助手取消重复88逻辑点底部预留。前后安装截图已保存 |
| UX-S9-115 | iOS/Android 键盘弹起后 composer 被遮住 | iOS 安装态真实复现并已修；测量窗口原点后 composer 底部503逻辑点、键盘顶部546，两者不重叠。第六轮 Android 先复现遮挡，再以 `KeyboardAvoidingView behavior=height` 修复并在当前 APK 复验通过；两端完整当前源码重装矩阵仍按第六轮边界保留 |

第五轮移动全量回归 67 个文件、871 项通过；共享账号历史4项通过。`check:ai-coverage` 仍明确报告移动旧四功能入口缺失与controller间接接线不能被旧扫描识别，另含其他任务所有的inbound检查两项；未扩大豁免。文档链接检查仍因现存未跟踪证据文件失败，未为通过检查改动用户Git索引。

第五轮 [iOS安装态记录](../../apps/mobile/evidence/ux-round5/chatbot-ios/verification.json)绑定源码与安装main.jsbundle哈希。本地读、设置返回草稿、取消恢复、深浅主题键盘避让通过；等待用户披露确认不再伪装为端点请求运行中，返回按钮可取消披露。远端模型/高风险写入、Android当前源码、旧四功能能力替代与最终多端重打上传仍未完成。未配置端点时的披露引导文案仍有重复、需继续压缩。

### 第六轮续验（2026-10-08，未发布新包）

本轮没有改变发布边界：当前发布仍是 B3 / TestFlight 1.0 (5) `VALID`。以下把真实安装态确证、已经落到源码的修正和仍未验证/正在修复的问题分开登记；第六轮证据不能外推为完整四端网络、登录、同步、数据管理或真人读屏矩阵通过。

#### 已确证的安装态证据

- **Android 键盘：先失败、后修复。** 当前 release APK 在 `emulator-5554`（Android 16，1080×2400）上先真实复现了软键盘覆盖 composer：输入保持键盘前的 bounds，composer 不在键盘上方可见。随后用 Android `KeyboardAvoidingView behavior=height` 修复，输入框最终为 `[42,1417][902,1533]`、发送按钮为 `[923,1417][1038,1532]`，键盘可见时通过；iOS 原有 `padding` 行为保留。证据为 [`android-chat/verification.json`](../../apps/mobile/evidence/ux-round6/android-chat/verification.json)、修复前 [`04-keyboard-draft.png`](../../apps/mobile/evidence/ux-round6/android-chat/04-keyboard-draft.png) 和修复后 [`12-keyboard-after-fix.png`](../../apps/mobile/evidence/ux-round6/android-chat/12-keyboard-after-fix.png)。该 APK 是 Windows 远程构建后覆盖安装，未卸载或清空数据；无模型端点请求。
- **iOS 受控 HTTP fixture 与本地 op。** iOS 模拟器通过控制 HTTP 模型端点验证：普通创建请求、提案确认、批量完成和只读目录；创建和确认在 SQLite/op-log 中产生真实本地 op，确认前的三条 op 与确认后的第四条完成 op分别见 [`03-ops-before-confirm.json`](../../apps/mobile/evidence/ux-round6/ios-chatbot/03-ops-before-confirm.json) 与 [`04-ops-after-confirm.json`](../../apps/mobile/evidence/ux-round6/ios-chatbot/04-ops-after-confirm.json)。只读请求后 op 数保持不变，见 [`05-ops-after-readonly.json`](../../apps/mobile/evidence/ux-round6/ios-chatbot/05-ops-after-readonly.json)；总计 `opCount: 4`、`readOnlyRequests: 6`。这是真实本地写入口与只读不落 op 的证据，不是实时外部模型智能或实体 iPhone 证据。
- **发送前披露。** root 新发送前的披露分组和详细字段展开已有真实截图 [`06-disclosure-compact.png`](../../apps/mobile/evidence/ux-round6/ios-chatbot/06-disclosure-compact.png) 与 [`07-fields-expanded.png`](../../apps/mobile/evidence/ux-round6/ios-chatbot/07-fields-expanded.png)。它只证明截图中的安装态呈现，不关闭字段文案和跨端披露矩阵。

#### 已落到源码、但需重新安装复验的修正

- 隐私错误态的恢复入口在截图 [`08-privacy-recovery.png`](../../apps/mobile/evidence/ux-round6/ios-chatbot/08-privacy-recovery.png) 中曾错误跳到“账号安全”；原生 AX 进一步记录了错误目的地（[`09-privacy-destination.ax.json`](../../apps/mobile/evidence/ux-round6/ios-chatbot/09-privacy-destination.ax.json)）。Profile callback 已由账号安全改回“同步与隐私 / sync”；最终安装态实际复验仍待 root 完成。
- iOS 第六轮记录明确指出批量完成宿主当前按任务循环；源码正在修正为符合“一次用户意图、一次 op”的路径。现有 fixture 证明了批量确认门槛和剩余完成结果，不能把它升级为逐条 op 问题已解决。

#### 新登记的问题与未验证边界

| 编号 | 第六轮发现 | 当前边界 |
|---|---|---|
| UX-S9-116 | Android 键盘遮挡 composer | 修复前失败、修复后安装态通过；仍需把该结果并入当前源码的完整 Android/iOS 交互矩阵。 |
| UX-S9-117 | 移动披露仍出现大块、未翻译的原字段墙 | 06/07 已有真实截图；需压缩分组与字段文案，并在当前源码包和两端复验，不能以“有披露截图”关闭。 |
| UX-S9-118 | 隐私错误缺少正确的恢复目的地 | 已修并在本轮新安装 iOS Release 上实际点击复验：进入“同步与隐私”，显示官方同步与本机隐私状态，不再进入账号安全。证据 `ios-chatbot/privacy-recheck.json`；后续估时增量仍需最终重包。 |
| UX-S9-119 | `complete-tasks` 批量完成仍按任务逐条处理，可能产生与用户意图不匹配的 op 形状 | 共享源码已改为预检后单次 `bulkSetCompleted`，重复任务整批拒绝、已完成项跳过；定向回归通过，当前安装态原子批量证据仍待补。 |
| UX-S9-120 | checklist 并发覆盖不足 | 共享源码已用 `dispatchChecked` 串行读取/合并/写入；同机并发追加、重复零 op、删除优先与失败重试测试通过。跨设备仍遵循备注 LWW，不声称合并；审查新增外部数组快照问题继续修复。 |
| UX-S9-121 | 确认前授权复检与幂等边界不足 | 确认前读取最新 grants 并核对账号 epoch，同一 host/proposal 成功确认只提交一次、失败可重试；撤权、过期账号、并发确认和失败重试定向测试通过，跨端最终安装态待验。 |
| UX-S9-122 | Web 批量 AI 优先级原先从 `onApply` 调用 `setPriority`，一次用户意图会产生多 op | `TaskActions.bulkSetPriorities` 已独立 marker 为一次 `BATCH`；shared-schema 3、op-log 136、app-host 1593 项测试通过。单一 Chatbot 的 `set_task_priorities` 接线与中英预览已完成：local-api 178 项、app-host 定向159项、Web预览6项通过；独立审查新增严格未知字段拒绝项仍在修复，当前包端到端待验。 |
| UX-S9-123 | 手工 token 没有 `accountId` 时历史曾共用 `unidentified`，存在跨会话混用 | root 已改为非秘密临时 session scope；任何缺少 identity 的请求直接拒绝，官方稳定 `accountId` 仍可持久恢复。模块级 resolver 在同一运行会话的 remount 保留同服务器/同 token 的随机 scope；换 token/服务器或退出会隔离，不把秘密写入持久键。共享历史6项测试通过；冷启动无已核验身份不承诺恢复。 |
| UX-S9-124 | `update-task` 多字段更新仍拆成多个 op | 已新增共享 `patchDetails`，所有字段先校验后单次 UPDATE；普通多字段一 op、非法日期零写入、重复任务复合操作拒绝及单独完成顺延，定向112项通过。当前安装态待验。 |
| UX-S9-125 | Web 披露后的自动滚到底布局已调整，但现有一次真实浏览器旅程发生在 scroll 改动之前 | 真实 Chromium 再验发现滚到底会裁掉披露标题；改为从标题显示，等待确认隐藏闲置输入框，ResizeObserver恢复设置返回后的定位。两条真实旅程通过，亮暗截图中关闭与发送均可见；证据 `ux-round6/disclosure/verification.json`。 |
| UX-S9-126 | Windows 桌面数据导出/还原缺少隔离运行入口和动作证据 | 已用复制的原生 Debug 壳与独立 SQLite/profile 完成 JSON/Markdown 导出、取消、坏 JSON、非空拒绝、空库还原及重载保留。默认库前后哈希不变。最终运行器另行验证真实 WebView2 profile 归属；未冒称最终运行器重跑了完整旅程。证据 `apps/web/evidence/data-transfer-windows-qa/verification.json`。 |

本轮 iOS 证据的原始限制仍有效：使用受控 HTTP fixture、无实时外部模型、无实体 iPhone；安装 bundle 仍对应第六轮最终源码重新安装前的基线，因此源码修正不能冒称已经进入 B3/TestFlight 5。其他完整矩阵（四端官方登录/自托管连接、同步错误与返回、数据导出/还原、Widget/桌面外链、VoiceOver/TalkBack）继续保留为未完成项。Windows 隔离数据动作随后已补齐，见 UX-S9-126；它使用复制 Debug 壳，不能等同于所有平台或最终 MSIX 包的完整数据旅程。

第六轮补充：`dispatchChecked` 已把追加清单的读取、合并与写入放进同一引擎队列，app-host 全套 1596 项与 op-log 136 项通过。这里的“并发追加都保留”仅指同一客户端的本地队列；跨设备同时修改备注仍遵循现有 op-log / LWW 规则，不承诺 CRDT 式文本合并。手工凭据会话历史隔离行为测试已补，账号历史共 5 项通过；补充 resolver 后，共享历史现为6项通过，同一运行会话允许跨页面重挂载恢复；无已核验 accountId 的临时会话不承诺冷启动恢复。移动会话控制与本地历史定向回归 18 项通过。

第六轮独立复审新增登记：

| 编号 | 问题 | 处理与验收边界 |
|---|---|---|
| UX-S9-127 | 排队前仍引用调用方可变 payload / checklist items，外部修改可能污染 op 或物化状态 | 已对入队intent、远端/import、reducer/store/返回值做完整JSON快照，保留__proto__为own data key，覆盖payload、vectorClock外部改动；定向5项通过，op-log类型检查与构建通过。 |
| UX-S9-128 | 工具 schema 的 additionalProperties:false 未实际执行，部分错误可选类型被静默忽略 | set_task_priorities顶层/entry未知字段及create_task可选字段错误类型均严格拒绝；local-api定向5项、app-host动作/host92项通过，最终安装态待验。 |
| UX-S9-129 | 单一 Chatbot 的估时能力尚未保持旧功能的历史依据、偏好和时长限制 | 共享工具已补齐读取上下文与写估时：历史最多20条、记忆关闭不读偏好、5–480分钟、确认前规范化预览、最新备注原子合并。app-host1618项通过，真实浏览器确认写入1条op、重复0条；最终移动安装态续验。 |

第六轮 Web 最新全套回归：162 文件通过、2 文件跳过；2094 项通过、13 项跳过。随后自动定位细节的两个定向文件28项通过，最新亮暗/设置返回的真实 Chromium 旅程2项通过。该读数不覆盖后续估时工具增量，也不替代原生安装态。


### 第六轮后续实测：同步入口与小组件写入

| 编号 | 问题 | 修复与边界 |
|---|---|---|
| UX-S9-130 | 未登录同步设置先展示巨大禁用同步按钮与状态，登录说明重复、隐私日期挤在标题 | 未配置且未进入自托管时优先显示官方登录；配置后保留真实状态。时间独立辅助行、按钮按内容宽度，IA8项/同步状态26项通过；当前iOS安装截图 `15-sync-simplified-dark.png` 已人工确认官方登录优先、完整内容无需滚动。 |
| UX-S9-131 | iOS Widget桌面勾选仅乐观显示，回App后任务仍未完成 | 真机载体为模拟器：原始2条op没有完成；定位iOS producer时间戳小数被共享整数契约拒绝。修为整数毫秒，Swift104项通过；重包实点后新增1条completedAt UPDATE，再次回前台无重复op。证据 `apps/mobile/evidence/ux-round6/widget-refresh/verification.json`，仅关闭今日模板的刷新/勾选闭环，不代替其余模板/实体iPhone。 |
| UX-S9-132 | 中英提案清单分隔符硬编码中文顿号 | 移动全套发现单源回归，已让Web/移动提案按当前locale消费既有分隔符表；移动完整67文件/873项及Web定向28项通过，等待纳入最终分发包。 |

估时工具已实施并经独立复审：历史最多20条有效样本、记忆关闭不读取偏好、正文读取性闸门、整数分钟与5–480限制、确认后按最新备注原子更新、幂等无额外op。app-host1616项、local-api181项通过；默认实体工具预算仍7，仅TASK显式9。同一目录供Chatbot/MCP共用，没有另设助手专用目录。旧覆盖扫描仍有7项UI接线缺口，未为全绿扩大豁免。当前iOS模拟器已安装包含工具与Widget修复的本轮包；它仍不是已经上传的TestFlight build5。

估时复审补充：确认预览曾显示模型原始900分钟而action夹为480，现已在共享提案生成前统一夹取，900→480、1→5的预览与写入一致测试通过；app-host现为85文件/1618项通过。真实Chromium工具旅程已证明追加清单/两任务批量优先级/估时各1条op、重复估时0条op，并保留原备注；证据 `apps/web/evidence/ux-round6/tool-journey/journey.json`。


### 第七轮发布与验收接续（进行中）

本机 Apple Developer 账号已经实测可用。iOS `1.0 (6)` 已完成归档、签名导出和上传，Apple `VALID`，既有内部测试组关联已回读确认。最终源码四端重打重装全部成功；Linux DEB 字节对账与解包启动通过。此时桌面/Android/Linux公开下载仍是 B3，B4分发正在准备，不能写成所有端均已发布。实体 iPhone 尚未连接，TestFlight 上传不等于真机已安装。

Windows 数据隔离验收补齐：共享 SQLite 路径 override 不再假称能设置 WebView2 profile；运行器复制可执行产物到 QA 根目录，并回读 `CoreWebView2.Environment.UserDataFolder`。完整数据旅程与最终运行器启动验收分别记录在 [Windows 验收记录](../../apps/web/evidence/data-transfer-windows-qa/verification.json)，默认数据库及 WAL/SHM 前后字节哈希一致。


| 新增登记 | 发现 | 处理与验收边界 |
|---|---|---|
| UX-S9-133 | 线上落地页未配置应用地址，导航进入应用/登录退回站内路径 | 首轮线上26项通过、4项失败后定位为构建配置遗漏；显式提供 `VITE_APP_URL` 重建并备份部署，待4条中英文入口复验。没有把它当成仅测试定位问题关闭。 |
| UX-S9-134 | Windows QA运行器可递归删除用户指定目录，且证据路径未隔离 | 独立复审发现后改为只接收全新安全路径、拒绝危险祖先/后代和reparse点，不再删除输入目录；独立设置证据路径并增加Finalize全目录前后哈希核对。远端危险路径5/5拒绝；全新QA启动与Finalize通过，默认目录1274文件前后无变化、M2证据落QA目录。未修改产品默认路径。 |

iOS最终安装包首启补验：协议链接无下划线、AX角色为Link、44点触摸高度；实际点击服务条款进入Safari并回读完整 `/legal/terms/` 地址。见 `apps/mobile/evidence/ux-round7/ios-first-run/verification.json`。键盘焦点和真人读屏仍未由这些证据覆盖。

iOS最终包的底栏返回补验通过：助手输入 `QADraftB4`，切换任务页后再回“我的”，自动恢复助手页面且草稿逐字一致。证据 `apps/mobile/evidence/ux-round7/ios-tab-return/verification.json`；此项只补草稿路径，不代替待确认提案/运行中请求矩阵。


### 第八轮接续：窗口融合与数据管理

| 编号 | 发现 / 用户要求 | 决策与验收状态 |
|---|---|---|
| UX-S9-135 | Windows 系统标题栏有独立浅色底、图标与名称，与应用顶部割裂；用户截图明确要求融入应用 | 源码及独立 Debug 真机矩阵完成：深浅顶部融合、弹层遮罩贯通、原生拖动/双击最大化、头像与详情按钮命中、800×680 窄窗 document 无横溢出。新增独立 QA 原生最小化/最大化/还原/关闭已真点通过；最终同源码 MSIX 重建重装及 Snap 悬停仍待验。完整截图及默认数据不变证据见 `apps/desktop-windows/evidence/ux-final-20261008-integrated-titlebar/RESULT.md`。 |
| UX-S9-136 | iOS 数据管理重复页标题；入口仍称不能还原；导出、还原、迁移堆叠成长页，粘贴技术文本默认占据大量空间 | 安装态已确认。调整为清晰的数据操作入口与按需显示输入，纠正中英文说明；保留空库还原限制。文件选择、取消、坏JSON、真实还原与分享仍须逐项验收。 |

macOS B4 已安装应用补验：实际AX点击账号→应用设置，正确识别原生桌面环境且不展示PWA指引；帮助中心由系统Chrome打开 `/docs/`，应用仍保留本地URL与存活窗口。证据 [安装态小组件与帮助验收](../../apps/desktop-macos/evidence/ux-round8/b4-installed-widget-help-ax.md)。该记录只关闭环境识别与外链路径，不替代全部视觉验收。

UX-S9-137：iOS B4 安装态真实选择备份后报 `readTextUri of null`。RN缺失模块返回null，原实现只判undefined，导致blob退路根本没有机会执行；已规范化缺失值，待新包真实文件选择验证。不能以粘贴JSON成功代替文件路径验收。

Android B4安装态补验完成：默认执行/首次授权后，通过受控模型fixture实际操作追加清单、两任务优先级、估时上限预览、多字段修改、批量完成；13个步骤通过，op计数3→8，各写入意图1条op。APK签名与SHA256再次核验，证据 `apps/mobile/evidence/ux-round6/tool-journey-android/journey.json`。没有重建APK；不把该旅程扩大为实时模型、读屏或运行中请求跨页恢复验收。


#### 四端系统小组件交付要求（用户再次明确，2026-10-08）

UX-S9-138：Windows、macOS、Android、iOS **全部必须支持原生系统小组件**。应用内卡片、PWA小组件、提示“当前不支持”，以及仅识别平台都不构成交付。此前UX-S9-109和macOS帮助/能力识别证据仍有效，但只证明提示真实，绝不代表系统小组件能力完成。

| 端 | 当前确认事实 | 必须补齐 |
|---|---|---|
| Windows | 已补独立 IWidgetProvider COM 服务、共享桥和 MSIX 注册，构建安装通过 | 最新接线包、真实 Board 添加、快照刷新、操作回写、缩放/主题；测试机缺微软 Widgets host，正在检查官方恢复路径 |
| macOS | 已新增原生 WidgetKit 扩展并签名注册；隔离安装验证过跨进程意图 | 系统 Gallery 添加、真实按钮、四模板尺寸与主题；现有探针不代替系统界面 |
| Android | 四个AppWidgetProvider和Manifest注册均存在 | 当前Release实际系统添加及四模板数据、交互、尺寸/主题复验；不以provider单测代替 |
| iOS | 四模板扩展存在；模拟器今日模板已添加且勾选1条op、再次回前台0条 | 其余模板与完整交互/尺寸/主题矩阵；实体iPhone需单独取证，不能用模拟器替代 |

统一判据：从操作系统入口添加 → 显示真实任务/习惯/专注数据 → App修改后刷新 → 小组件操作经共享app-host写入口落一次op → 冷启动/多次恢复不重复 → 删除/重新添加与亮暗/尺寸正常。组件数据继续遵守本地优先、加密快照与唯一op写入口；不为各端复制领域逻辑。当前四端完整验收**未完成**。


#### UX-S9-138 四端小组件实测进展（2026-10-08 12:20）

| 平台 | 已证事实 | 仍须完成 |
|---|---|---|
| Android | 现有 Release 安装包在系统 Launcher 显示四模板，全部实际添加；四象限显示真实任务、调整宽度、点击回应用成功；系统组件操作只增加一条 UPD_TASK（8→9） | 发现系统深色模式下卡片仍为浅色，已分派修复；新包复验及其余模板非空数据、冷启动/跨日/重加仍待补 |
| macOS | 新原生 WidgetKit 扩展已签名并被 pluginkit 注册；真实 UI 新增任务→加密快照→独立签名扩展身份读取→共享 ToggleTaskIntent→宿主写入一条 op（2→3）；重复意图后仍为3 | 该操作通过扩展身份探针执行，**不等于系统 Gallery 添加/实际 Widget 按钮点击**；系统界面添加和尺寸/主题仍待验 |
| iOS | 已有 WidgetKit 四个 enabled descriptor；此前通过系统界面添加今日任务并点击回应用 | 其余三模板系统添加、非空数据刷新及真机仍待验；模拟器证据不作为实体 iPhone 证据 |
| Windows | 已实现 COM Provider、MSIX 注册与共享桥，独立 Provider 和宿主构建、打包安装启动已通过 | 最新修复须重包；测试机的微软 Widgets host 尚不可用，继续官方恢复与系统添加验收 |

共享实现：快照规划已从 mobile 提取到 `packages/app-host/src/widget-publish.ts` 并删除移动壳副本；桌面通过共享 `native-widget-session.ts` 串行发布、排空意图与清数据。Web 仅在真实原生 Widget 桥存在时展示系统添加步骤。当前已通过共享 session/写入行为测试16项、移动发布回归16项、宿主能力分支19项、Web类型检查与依赖构建。它们不替代上表系统层验收。

证据：[Android 系统四模板报告](../../apps/mobile/evidence/ux-round8/android-widgets/RESULT.md)、[macOS 原生运行记录](../../apps/desktop-macos/evidence/native-widgets/2026-10-08.txt)、[macOS 真实单op记录](../../apps/desktop-macos/evidence/native-widgets/real-intent-oplog.json)。本轮新实现尚未作为统一四端测试版本发布，UX-S9-138继续进行中。


UX-S9-138 接续验收清单（未完成项不得随构建成功关闭）：

- [x] Android 四模板从系统 Launcher 实际添加；四象限调整尺寸、返回应用、单次任务操作一次 op。
- [x] Android 主题根因定位，四模板改为 design-system 生成的明暗资源；删去无效的 manifest 配置广播路径，应用配置变化刷新。生成资源已纳入对账。
- [ ] Android 修复后 Windows 重打 APK，原有四组件实际切换明暗复验；其它模板填入非空真实数据。
- [x] macOS WidgetKit 扩展、签名、加密数据和真实任务跨进程意图链路实现。
- [ ] macOS 系统 Gallery 添加、实际系统按钮点击、四模板尺寸/主题；探针不能替代。
- [ ] iOS 其余模板系统添加与非空数据、实体 iPhone 验收；现有今日小组件模拟器记录保留。
- [ ] Windows 原生 Provider 与主应用接线、最终包注册、系统 Widgets host 可用性和实际添加。Provider 独立构建/打包已经通过，主应用最终接线仍在进行。
- [x] 共享 session 改为非破坏读与成功项精确 ack；查找状态/写入/ack 失败保留队列，错误上报异常不拒绝后台任务。原 drain/merge 恢复设计已替换。
- [ ] 跨进程崩溃恢复最终安装态：四端已实现非破坏读取与精确 ack，尚须新包验证“落 op 后、ack 前退出”重投不重复。
- [x] 重复任务跨 drain 幂等：receipt 与任务/相对提醒同枚 op；SQLite、重复回放、重启与乱序覆盖。最终系统点击新包仍在各端矩阵中单独验收。
- [ ] Apple 显式共享 Keychain group 与可报告失败的清理路径修复/验证。当前 iOS entitlement 的首组就是共享组，不能把 Info.plist 未指定 group 直接写成“已经发生解密失败”；需核验签名运行结果。
- [ ] 最终冻结源码四端重建、重装与测试版上传；本轮未发布。


UX-S9-138 后续核对（2026-10-08）：Apple 20 个有界文件已逐文件 SHA-256 对账，主树与受控树一致；共享 Swift 测试 108 项、macOS 宿主构建与两端 WidgetKit 扩展 Release 编译通过。这不代表系统组件库验收通过。Android/iOS 移动桥另发现清理错误被转换为成功的问题，现已传播原生 reject/false 给清理结果；Android 清理后主动刷新系统缓存。移动桥、凭据清理、意图消费与快照规划定向 4 文件/45 项通过。Apple/Windows 清理后的系统缓存刷新另行核对。

- [ ] 清理数据后系统小组件不继续展示旧任务；验证原生拒绝/刷新失败有真实失败结果。
- [x] 重复任务与相对提醒同一枚总 op；新增范围契约，跨任务/多 scope 新写入落盘前拒绝，旧日志与 checkpoint 恢复不产生毒丸，独立复审已通过。

Apple 清理刷新补验：共享清理服务在密钥及容器成功清理后发起系统 timeline reload，macOS 删除重复刷新；Swift 最新 109 项通过，主/受控树有界文件 SHA 一致。macOS 系统 Gallery 验收收到操作系统“电脑已锁定，自动解锁失败”；已请求手动解锁，未标记通过。Windows 新探针验证 DPAPI 加解密、非破坏读取与精确 ack，Provider 增加快照文件监听以刷新清理后的卡片；官方 Widgets host 获取仍在排查网络通道。

补充复审与环境记录：重复完成 marker 的提醒范围曾只判断字符串前缀，独立复现 `task` 可误改 `task:child` 的提醒，已退回修复并要求 local/remote/import 与乱序反例；该项未关闭。Android Kotlin 本轮测试在 Windows 配置阶段失败：实际 SDK 目录仅余 platform-tools，NDK 缺失，正在定位/恢复工具链；没有回退到 Mac 构建。Windows 标题栏旧隔离会话 Finalize 因 manifest PID 与进程证据 PID 不同被安全拒绝；当前已无 HeytaWindows 进程，未改写证据冒充通过，最终包须新建隔离验收。Mac 已由用户解锁，系统界面验收继续。

Android 队列修复原生验证已补：恢复官方 SDK 后，Windows `:app:testDebugUnitTest --tests com.heytamobile.widget.WidgetStoreTest` 成功，JUnit XML 回读 5 项、0 失败/错误/跳过，覆盖非破坏读取、精确确认、并发点击、清理后旧卡片回写拒绝、持久化失败。此命令没有生成新 APK，系统主题复验仍未关闭。移动并发清理补正后定向 4 文件/51 项通过，新增失败清理的独立界面提示与重试。

本轮复审收口：提醒的 canonical ID 决定不可变任务归属，入口拒绝不一致的新写入与 REMINDER CRT/UPD 多 scope；历史日志、full-state 与 checkpoint 物化确定性归一归属，opaque legacy ID 保持旧语义。独立复审确认前述范围与恢复问题关闭、无新增具体 P1/P2。受控树 `pnpm -r build` 成功，app-host 全套 87 文件/1632 项通过。Android Release 新包开始构建；Apple 新候选包并行重打。尚未作为最终多端版本发布。


UX-S9-138 安装身份与验收边界更新（2026-10-08 下午）：

- Android 当前 Release 已由 Windows 完成构建（14分12秒），回传与远端逐字对账。已保留数据升级现有 emulator-5554，设备内 APK 与候选包 SHA-256 相同：`381203459ba9da1c85d4d5215fba8a32ce1b63992d87ef915a3e53de82c34ba3`；发布证书主体 CN=heyta，四个既有系统组件实例保留。新截图确认专注空状态卡片已呈深色；四模板逐个切换主题/非空数据/点击矩阵仍未完成。证据：`apps/desktop-macos/evidence/widget-qa-20261008-android.txt`（历史存放位置）。
- iOS 最新候选 Release 已安装到既有模拟器，未清除数据；宿主可执行文件、扩展可执行文件、main.jsbundle 均与候选逐字相同。证据：`apps/mobile/evidence/ux-round8/widget-ack-cleanup/ios-candidate-install.json`。安装身份通过不代表其余三个模板系统验收通过，也不代表实体 iPhone 已验。
- mobile 全量回归的 5 个 unhandled rejection 已定位为 Node 测试意外加载 RN Flow 入口。测试隔离修正后 68 文件/879 项通过、Errors 0；产品代码没有为了测试吞错。
- Windows 官方 Web Experience Pack 安装器已取到并验证 Microsoft Corporation 有效签名，Mac/Windows SHA 一致。真实执行退出1612，Store/WU连接报0x80072EFD，系统仍无 Widgets host。未降低证书校验；证据 `apps/desktop-windows/evidence/ux-round8/windows-widgets/install-attempt.log`。不能把这一格勾为完成。
- Mac 已解锁，CUA 可操作应用，但尚未取得系统 Gallery 面板；此前请求用户仅打开“编辑小组件”面板仍待完成。独立命名 QA.app 并不隔离数据库：CUA重新启动时未带目录环境变量，曾新建本轮两个测试任务与一个测试习惯，已通过UI仅移除这些测试条目，保留正常op/墓碑历史，没有恢复或覆盖默认数据库。之后显式以 `HEYTA_SHELL_DB_DIR=/tmp/heyta-widget-qa-20261008/mac-data` 启动，lsof确认 QA PID 打开该独立目录。不得继续引用“QA副本自动保护默认数据”的错误推断；仅指定路径启动且核实进程才构成隔离证据。
- [x] 发布前校正 landing 平台介绍中“Android小组件/签名还在路上、iOS缺开发签名、桌面未签名公证”的旧中英文文案，再构建 landing；复核发现旧文案沿用了 B3 截面，遗漏 B4 已发布测试资产，因而错误写成 Android 尚未公开、Linux 仅本地构建。现改为 Android 已提供签名测试安装包、Linux 已提供测试安装包，同时保留全端交互与小组件覆盖仍在验收、iOS 仅内部测试且无公开邀请的边界。证据：[`release-2026-10-08-b4/release.json`](../../apps/web/evidence/ux-closeout/release-2026-10-08-b4/release.json)、[`release-2026-10-08-b4/github-verification.json`](../../apps/web/evidence/ux-closeout/release-2026-10-08-b4/github-verification.json)；实际消费字段为 `site.platforms.android.body`、`site.platforms.ios.body`、`site.platforms.desktop.body`。

后续校正：认证测试mock已收窄到auth-flow.spec.ts内，删除本轮全局Vitest setup，独立只读复审通过；最终mobile复跑仍为68文件/879项通过、退出0。Mac打包自截屏脚本改用绝对临时数据库目录；以同一启动形状真实运行安装候选，独立数据库已生成且WebView截图244891字节、窗口1159×754。数据库隔离不等于系统App Group/Keychain整体隔离；系统Gallery验收仍未关闭。

Windows 最新候选 MSIX 已签名安装，SHA-256 `c1cad48eb0aaf1ca2221a5c84295d3cf2733e11a9a849144ead2a667ab406c3f`，ADD_APPX/RESULT/PAYLOAD_WEBDIST/M2D/SHORTCUT 均通过。初次标题栏截图裁切错误被主线程退回，补用DPI-aware完整窗口截图（1440×734）确认边界及系统三个按钮均入图；这关闭截图错误，不代表标题栏审美与窄窗矩阵全部完成。SQLite采用新隔离QA目录，但WebView2仍回退包LocalState，不能声称完整配置隔离，未执行注销/清理。证据目录 `apps/desktop-windows/evidence/ux-final-20261008-msix-titlebar/`。Windows系统Widgets host失败边界不变。


### 第九轮接续：隐私重选、弹窗键盘与助手跨页（2026-10-08）

| 编号 | 实际发现 | 修复与当前验收边界 |
|---|---|---|
| UX-S9-139 | 只用本机却显示“撤回同意”；主动重选冒充已撤回；成功新选择后旧保存失败提示残留；UTC收据无时区说明；弹窗Shift+Tab落到背后、Escape同时关闭设置 | 两端只对accepted展示撤回，其余展示重新选择；settings reason不改决定；界面读取最后一次真实保存回执，隐藏/重挂载不吞掉失败，新保存成功才清除旧警告；收据标明UTC。Web弹窗圈定键盘焦点，底层设置/搜索/助手让出事件，关闭回到触发按钮。真实浏览器亮/暗、390×844窄屏、取消不变local-only、Tab循环和Escape只关一层已验证；3文件32项Web回归、37项移动闸门回归及两端类型检查通过。移动原生UI与最终安装包仍待本次源码重建验收。 |
| UX-S9-140 | AI运行中任务→日历→任务，等待仍在但回包丢失；长连续消息向左溢出气泡 | 共享会话保留请求结果与等待阶段，文本按容器换行；Provider身份代际阻止同slot换号、ABA旧回包与迟回确认串入新会话，默认按账号持久化并让危险提案刷新失效。最终复审新增身份真源/自托管路径/手填凭据问题也已修复，见UX-S9-144；Web最终6文件80项、共享历史7项、真实浏览器9项无重试、类型检查通过。原生新包跨端矩阵仍待验。 |

UX-S9-139 证据：[verification.json](../../apps/web/evidence/ux-final-20261008/privacy-choice/verification.json)、[亮色](../../apps/web/evidence/ux-final-20261008/privacy-choice/light-local-only.jpg)、[暗色](../../apps/web/evidence/ux-final-20261008/privacy-choice/dark-local-only.jpg)、[窄屏弹窗](../../apps/web/evidence/ux-final-20261008/privacy-choice/dark-narrow-dialog.jpg)。已逐文件/词条镜像主树，App.tsx仅合入两处键盘处理及注释，保留主树独立的dueDateLocal变更，没有覆盖他人的后端或入站自动化工作。

数据管理补验：原“清理报告应有10条”的猜测不成立。原生小组件只有失败才追加报告；原测试模拟数据库模块遗漏原生生命周期接口，导致额外一条失败报告。现针对平台桥建成功/拒绝夹具，保留成功9类、验证先停止组件再销毁数据库且失败仍清其余数据，2文件20项通过。提醒到点用例单独复跑通过；全套负载下的一次失败尚未充分归因，不标为完整提醒矩阵通过。

UX-S9-135 接续：最新已安装候选SHA `5E3C6904997D4BB48E5C7173EAD7025D24F5A99F31E4BB0243DC5ACCA89622B3` 早于本轮共享UI。其后在独立 Debug 副本完成完整深浅/窄窗/拖动/双击与顶部按钮矩阵，实图已无空顶栏，exact finalize 核对1277默认文件不变；详见 `apps/desktop-windows/evidence/ux-final-20261008-integrated-titlebar/RESULT.md`。单次启动生命周期补丁已独立运行验收：超过原1分钟触发窗仍只有1实例、计划任务已删除，原生最小化/最大化/还原/关闭全部真点通过，exact finalize再次核对1277默认文件不变；最终 MSIX 统一产物仍待重建重装，Snap悬停未验。

四端系统小组件完整矩阵与最终同源码重建/重装/上传继续沿用UX-S9-138清单，未被上述局部完成项替代。


### UX-S9-141：助手输入容器的轻阴影（2026-10-08）

- [x] 登记用户裁决：无边框不等于无层次；助手对话输入区域允许浅阴影，内部文本输入和发送按钮不叠加装饰框。
- [x] 共享 Web 助手输入容器消费现有 `--ht-shadow-sm`，空态与会话态复用，规范同步至设计系统 MASTER；移动输入容器也消费同一 `shadow.sm`，仅整体投影，内部控件保持扁平。移动候选已重包，安装态输入视觉仍待验。
- [x] 真实浏览器空态深浅主题已实看，计算样式确认容器边框为零、投影来自主题对应的轻阴影；截图与记录见 [验收目录](../../apps/web/evidence/ux-final-20261008/composer-shadow/verification.json)。
- [ ] 最终四端安装产物随 UX-S9-138 统一重建验收。


### UX-S9-142：专注选择器与系统小组件即时更新（2026-10-08）

- [x] 真实 Android 发现并定位：本机新增任务后专注选择器仍显示无任务，开始专注后系统卡片继续空态，直到另一枚本地 op 才刷新。
- [x] 专注页订阅成功落库的本地写信号，继续复用共享任务动作的待办口径；隐藏标签无需重新挂载或等待同步。
- [x] 计时器区分状态机变化与显示 tick，组件生命周期订阅开始/暂停/恢复/结束；沿用快照合并和账号清理屏障，并在发布后推进 iOS 实时活动。开始/暂停不造 op，结束仍只记一枚专注记录。
- [x] 修复前集成回归 3 项失败，修复后状态/发布/原生桥 3 文件 44 项通过；移动类型检查通过。覆盖即时发布、不随显示 tick 写盘、自然完成、卸载/重启监听唯一性、账号清理屏障。
- [x] Android 共用空态/过期提示绑定返回应用，避免内容行隐藏后只剩日期能点。
- [ ] 最终 Windows 重打 APK、iOS 重建后，原生界面新增任务立即可选、开始/暂停/恢复/结束即时更新系统组件、空态提示实际可点；测试结果不能替代安装态验收。

Android 主题刷新补强（2026-10-08 21:18）：四个 `RemoteViews` 渲染器现在会在应用进程读取系统 `UiModeManager` 的当前模式，并显式下发根背景、正文色和辅助文字色；这解决部分 Launcher 跨进程重用 `values-night` 资源、切换夜间模式后仍保留浅色卡片的问题。新增 `widget_root` 仅作为颜色动作的稳定目标，不改变数据或点击协议。按项目规则经 `windows-pc` 远程构建 `assembleDebug` 成功，回传 APK 与远端逐字对账（129,954,133 B，SHA-256 `d3c375b71808bc652a389974e5b7ace2fb521e4d801a065e16b570c0b840ba5a`）。本机当时没有连接 Android 模拟器，故没有把这次编译通过写成系统亮/暗切换已验；Android Release 重装及四模板实际切换仍由下方安装态清单负责。


### UX-S9-143：应用与系统小组件的语言一致性（2026-10-08）

- [x] 实际Android矩阵确认：系统en_US、app locales为空时应用主体中文、四模板系统文案英文。现有中英资源完整，问题是语言选择的接线。
- [x] Android/iOS共享既有中英资源，独立非敏感设备偏好持久化；应用初次/切换同步、独立扩展唤醒读取、账号清理保留语言。移动语言/桥22项、Swift偏好3项通过。
- [x] macOS桥接同一Apple偏好；Web发送当前语言并串行处理快速切换/会话重启，不把语言写进任务或凭据。Web两文件17项及类型检查、macOS Release编译通过；证据见 `apps/web/evidence/ux-final-20261008/native-widget-locale/`。
- [x] Windows新增同名原生语言桥、独立设备偏好与Provider监听；四模板文案消费i18n生成资源，没有独立手写词条表。macOS/Windows各35项真实文件和跨进程冒烟、Windows Provider及壳Debug编译通过。系统Board安装态语言切换仍待验。
- [ ] 最终安装包实测中文/英文切换、冷启动/组件独立唤醒一致；不通过改变整个系统语言规避。源码测试不替代系统卡片。

### UX-S9-144：助手历史与运行身份的最终隔离复审（2026-10-08）

- [x] 登录凭据存储配额失败时，运行身份仍来自真实sync store，持久化失败不否定成功登录。
- [x] 同域不同自托管路径单独分槽，规范化尾斜杠保持等价。
- [x] 手填更换服务器/token清旧邮箱和账号标签，仅改本机E2EE口令保留；退出后同token重登仍产生新的临时身份，避免复用未核验会话。
- [x] Web 6文件80项、共享历史7项、真实浏览器9项且无重试、Web类型检查通过；账号/草稿/ABA/迟回确认/刷新危险提案覆盖。证据见 [最终复审记录](../../apps/web/evidence/ux-final-20261008/assistant-navigation/RESULT.md)。
- [x] 有界镜像主树；sync/store仅替换configure和applyAuthToken段，保留主树他人的inbound授权接线；没有覆盖App.tsx或后端。
- [ ] 当前原生桌面/移动安装产物与最终统一发布矩阵；源码和浏览器结果不能外推。

Android四模板明暗/非空矩阵已取证：[RESULT.md](../../apps/mobile/evidence/ux-final-20261008/android-widget-matrix/RESULT.md)。今日/习惯/四象限直接通过，专注卡片只有无关QA任务op后才非空，开始即时发布仍失败，因此不能勾UX-S9-142安装态。系统night=yes及QA任务未完成/习惯未打卡已恢复，真实自然完成/放弃的QA专注记录保留，没有清用户数据库。


专注清理复审接续（2026-10-08 16:03）：UX-S9-142新增真实时序回归，旧wake跨清理领取新代际、在途Live Activity未被清理等待的问题均已先复现再修复；原生清理会等待结束实时活动，失败继续返回失败。移动宿主打开也补代际，迟回旧连接关闭并拒绝、不污染新库，当前打开失败可重试；修前2失败/2通过，修后与注销入口两文件16项通过。最新移动全套72文件900项通过、无unhandled rejection。原生重包后仍须实际退出/刷新验收，暂不勾安装态。

Focus第二轮独立复审已关闭两条复现的清理时序缺口：定向5文件50项通过、iOS App及扩展Release真实编译通过、8源码SHA逐项匹配。范围以 `apps/mobile/evidence/ux-round8/focus-cleanup/RESULT.md` 为准；没有用这些结果声称实体iPhone已验、注销瞬间所有屏幕已清空或所有在途drain已取消。

小组件系统面板边界复核（2026-10-08）：当前 macOS CUA 可打开“桌面与程序坞”并确认“小组件”显示开关，但该设置页不提供 Widget Gallery 添加入口；heyta 当前窗口停留在登录/注册页，未进行系统卡片添加或按钮点击，因此 macOS Gallery 仍保持待验。iOS 已有模拟器证据确认 Gallery 可见并添加“今日任务”小组件，范围仅限该模板和模拟器；其余模板、当前候选源码的实时刷新及实体 iPhone 仍不宣称完成。Android 当日仅完成远程 `assembleDebug` 对账，安装态留待后续记录；该历史边界已由 2026-10-09 的 Release 安装态证据补充，不应与本段旧快照混读。


### 交付验证接续（2026-10-08 16:18）

- UX-S9-145：macOS打包自检日志中变量紧接全角括号，被Bash 3.2当成变量名的一部分。已显式加花括号，重打Developer ID签名候选、安装副本哈希一致且成功自截屏；没有把旧构建日志当成功。此候选未公证，实际Gallery与完整交互仍待验。
- UX-S9-146：Windows Android原生单测的夹具目录判断使用正斜杠字符串，实际Windows路径含反斜杠。第一趟135项仅此1失败，没有产出APK；改为原生Path分段后远程重打成功，11套135项全部通过；APK远近SHA一致、发布证书CN=heyta验签通过，失败日志与JUnit保留。
- iOS新候选Release已保留数据升级到既有模拟器，宿主/扩展/JS三份已装字节与新产物SHA一致并启动；见 `apps/mobile/evidence/ux-final-20261008/ios-new-candidate/install.json`。不是实体iPhone验收，也不是最终清旧四端发布。
- macOS新候选已安装，旧.app保留独立备份，数据库未清；启动验收使用显式QA数据库。签名/宿主/扩展/共享web-dist身份见 `apps/desktop-macos/evidence/ux-final-20261008-candidate/verification.json`。签名不代表公证，自截屏不代表Gallery按钮已验。
- 59-C共享生图入口补验：image-artifact-core与gpt-image在Codex/Agents/Claude等全局入口可发现，共9个链接定向验证通过；已删除遗留的“本次整理任务”临时dry-run限定。系统imagegen源码未改、未收费出图，凭据与私有路由未复制到仓库。安全共享记录在 `~/.skill-catalog/provenance/image-artifact-core-sharing-20261008.json`；全量技能治理原有graphify登记与gpt-image provenance问题保留，未伪报全量通过。

本轮继续按未完成安装交互矩阵推进。打包过程中补了两处专端脚本/测试修复，先前广义源码冻结清单已经变化；仍不主张“四端同一冻结树且全部交互验收完成”，各候选实际消费输入和已装字节分别记录。


### UX-S9-147：助手工作区注册授权与邮箱验证码（2026-10-08）

- [x] 登记真实用户失败：注册已勾协议仍提示未同意隐私规则，要求操作的面板不可见；验证码阶段没有出现。
- [x] 定位原因：助手工作区隐藏 `.ht-main`，三张全局决定面板却挂在内部页头；`fixed` 不能逃离 `display:none`。本机联网授权与注册条款是两份未融合的决定，失败在出站前发生。
- [x] 官方OTP请求/验证/重发接口以不带个人数据的空请求确认可用；没有向真实邮箱发信。
- [x] 实施：三张全局面板移到页面布局网格外；注册勾选文案明确涵盖协议与本机联网，明确提交后经既有授权动作放行；主按钮改为“发送验证码”，成功进入6位验证码阶段，验证后完成注册。未勾选、登录与AI出站权限不被自动放行。
- [x] 1440/390真实Chromium六条全部通过、无重试：未勾零请求、勾后验证码阶段、隐私按钮真实可点、输入保留且同意不自动登录；首轮旧i18n dist与移动网格遮挡失败证据保留。见 [验收记录](../../apps/web/evidence/ux-final-20261008/auth-consent-registration/RESULT.md)。
- [x] 更新后四端候选已重建；Windows、Android和iOS模拟器已更新，Web已部署。具体发布与安装边界见UX-S9-148。
- [ ] Mac本机安装、原生完整注册与实际邮件收取闭环仍待验。

### UX-S9-148：注册密码说明与协议阅读（2026-10-08）

- [x] 登记用户裁决：删除“长一句比加符号有用…”；协议应能点击阅读，Web与移动优先弹窗，关闭后保留注册表单。
- [x] 保留密码强度反馈，Web/移动移除冗余解释。
- [x] 官方协议弹窗消费既有法律文档事实源，中英一致；自托管阅读实际服务端政策。无边框/下划线，仅浅阴影；表格采用字段标签对应值；摘要、草案状态及版本随正文滚动，固定标题与关闭。
- [x] Web 1440/390 实际点击两份协议及文内引用、关闭返回、全部注册输入及勾选保留，6条浏览器回归通过。Web认证/隐私79项、移动认证57项通过；原生源码已接入共享阅读器。
- [x] Web及站点法律页部署、更新后线上真实浏览器32项通过；Android新包实际点击两协议并系统返回注册页通过。补验已安装暗色状态及2400×1080横屏：标题/关闭固定、正文可滚动，关闭保留临时邮箱草稿，原方向策略已恢复；协议未勾选、注册未提交。见 [Android阅读验收](../../apps/mobile/evidence/ux-final-20261008/android-candidate/auth-legal-frozen/installed-legal/RESULT.md)。
- [x] Windows1.0.0.1保数据升级及资源SHA对账；Android发布证书新包保数据安装；iOS模拟器新bundle匹配，TestFlight1.0(7) VALID及内部组回读；macOS最新候选签名公证通过。
- [ ] Mac本机解锁后保留注册输入完成更新；Windows/iOS原生实际协议阅读、实体iPhone及生产邮件收取继续待验，不以Web/模拟器替代。
- [x] B5公开测试包已上传，四个附件大小与GitHub SHA摘要逐一相等；iOS使用TestFlight1.0(7)，未创建公开邀请或发送邀请。[测试版下载](https://github.com/Xaiver03/heyta/releases/tag/v1.0.1-test.20261008.5)。本批不声称全部Goal清单关闭，COS下载清单及Linux仍为前一批产物。
- [x] 独立复审：读取/关闭/返回/小视口未发现交互缺陷；修正草案提示测试为实际渲染文本，最终认证/隐私79项通过。法律文档原有草案状态保留，本轮不宣称正式运营协议已生效；正式运营的协议批准与版本留痕继续沿既有法律流程处理。

### UX-S9-149：协议法律表述与窄视口页脚（2026-10-08）

- [x] 调研并登记正式协议语言规则：采用“定义—权利义务—责任边界—程序—通知—争议解决”的顺序，使用“应/须/不得/有权/不承担”等可执行动词；事实、例外、期限和处理方式分项列明，避免口语连接词和绝对化宣传。依据已写入 [`docs/standards/legal-language.md`](../../docs/standards/legal-language.md)。
- [x] 九份协议共用 `legalDocumentPresentation` 的正式措辞投影：统一处理“换句话说”“一句必须说清的边界”“你能做的补救只有”等明显口语表达，并移除暂停符号等装饰性状态符；不改变正文事实源、版本、锚点或同意指纹。
- [x] 协议摘要现在进入可滚动正文，固定头部只保留标题与关闭；Web、移动共享阅读器与官网法律页均消费同一份中英摘要和章节投影。
- [x] 页脚在 768/1024px 使用两列、640px 以下使用单列；品牌列在平板跨两列，避免截图中的单列堆叠和右侧大面积空白。法律页 1440/1024/768/320 四档无横向溢出。
- [x] 验证：法律包 70 项、共享阅读器 12 项、Web认证定向测试 40 项、Landing 协议与页脚 Playwright 6 项通过；窄视口覆盖 320/390/768/1024/1440 五档，均无横向溢出。内存闸门曾拒绝的那一轮已在资源窗口恢复，不把构建绿当作运行验收。
- [x] 主树法律文案已按当时迁移真源补齐自动化/分享类别；该日记录中的 31 条级联、30 张表是历史截面，已由 UX-S9-152 按当前迁移终态更新为 34 条、33 张表。中英文结构测试同步更新并通过。Web 与站点产物已重新部署，远端 `/tmp/heyta-public-backup-20261008T124559Z.tgz` 可回滚；本地与远端 `index.html` SHA 分别逐字一致。此前 14 项线上法律页、404、API 反向判据和页脚验收证据继续有效。
- [ ] 法务正式审阅与协议生效批准仍是发布前独立门槛；本轮只调整展示措辞和排版，不把草案标记为已生效。

### UX-S9-150：移除无必要的竞品关联声明与服务条款正式化（2026-10-08）

- [x] 用户裁决已登记：界面、帮助中心和法律页面不再展示“个人项目，与滴答清单 / TickTick 及其关联公司无任何关系”这一非必要声明；该句已从 Landing 页脚、README 及对应渲染断言中移除。产品中的 TickTick CSV 导入和对照内容仍保留在其实际功能语境内，不再承担免责声明职能。
- [x] 《服务条款》版本由 1.2 更新至 1.3（2026-10-08），统一责任范围、通知送达、同意记录及 GDPR 适用性核对章节的正式法律表述；删除“我们不写某类免责句”等元话语、口语化连接和模板化解释，改用适用范围、法律效果、程序和责任边界的直接陈述。中英文章节、锚点和事实结构保持一致。
- [x] 增加版本记录项，保留草案状态；本次修改不构成法务审阅、协议生效或对外法律意见。
- [x] 线上法律页与应用已按正确基路径重新部署并完成真实回读：Landing 法律页使用站点根路径，Web 应用使用 `HEYTA_WEB_BASE=/app/` 产物；`apps/web/dist/index.html` 与 `ubuntu-jcli:/var/www/heyta-app/index.html` SHA-256 一致，`https://heyta.waytofuture.cn/app/?v=20261009` 返回 `/app/` 资源并通过 `check:web-artifact:app`。法务正式审阅仍是独立门槛。

本轮最终四端收口记录（2026-10-09，最新尝试）：macOS、Windows、iOS 均已按当前源码重建、重装并通过启动/新鲜度判据；Windows 远端通过已缓存依赖完成 MSIX 签名、安装、快捷方式解析和真实窗口截图，证据见 [`ux-final-20261009/reinstall/`](../../apps/web/evidence/ux-final-20261009/reinstall/)。Android Release 已通过 `windows-pc` 远程构建并安装到 `emulator-5554`，设备内 APK 与本地产物 SHA-256 均为 `1a01024e1d90aaae0e6bf446af7a329e9ac542427435f2e8e1497ba7c28d86c3`；四个 Provider 和四个既有 Launcher 实例、亮暗主题渲染已复验，详见 [`android-widget-matrix/RESULT.md`](../../apps/mobile/evidence/ux-final-20261009/android-widget-matrix/RESULT.md)。实体 iPhone、系统小组件 Gallery/Board 和四端完整交互矩阵仍未完成。

### 2026-10-09 继续验收记录

- 设置分类现在明确保留上次选择的分组；Profile、Sync 等跨分组旅程在验收中必须显式切换，不再依赖默认分类或上一轮测试状态。
- 头像端到端浏览器旅程已补齐真实的 Profile → Sync → Profile 路径，并为同一设置壳内新增的入站自动化、邮箱换绑状态读取补充合法空响应夹具；`profile-avatar-e2ee.spec.ts` 通过 1/1，视口、设置分类、帮助入口 7/7 通过。
- 入站自动化宿主新增统一 `requestInboundAutomation` 入口，并在偏好最小化表中显式声明空偏好集合；未把它误记为用户直接点击的第二个 AI 产品入口。
- `pnpm build` 通过；`pnpm check:ai-coverage` 已通过：Web 的入站自动化按“设置管理 → 宿主 worker 消费”登记为无直接模型请求入口；移动端按产品裁决只保留一个 Assistant/Chatbot，capture、breakdown、prioritize、duration-estimate 与 inbound automation 不再复制成独立页面；tool-calling 的真实挂载组件为 `AssistantScreen`。这不是降低实现覆盖要求，Web 的可用能力仍需由真实组件接线，移动端只验证单一 Chatbot 入口，门禁输出已明确区分“直接 UI 入口”和“宿主内部能力”。
- `@heyta/app-host` 定向测试 90 个文件、1708 项通过；`@heyta/domain` 本轮单测因机器立即可用内存 339MB 低于 384MB 启动闸门而未运行，类型检查已通过，不将其记作测试通过。⚠️ **这一条已被 UX-S9-153 补跑否证**：闸门放行后跑出了读数（1020 通过 / 3 失败，逐条归因见该节），不要再照本行读成"没跑"。

### UX-S9-151：服务条款去竞品声明与合同文本正式化（2026-10-09）

- [x] 用户指出“个人项目，与滴答清单 / TickTick 及其关联公司无任何关系”不应写入条款；已确认源码、Landing 产物与线上页面均无该声明。TickTick 仅保留在导入功能、产品调研和内部竞品语境，不承担法律免责声明职能。
- [x] 对外《服务条款》不再展示内部 GDPR 适用性核对表。审计表移至 `docs/research/legal-terms-gdpr-review.json`；`scripts/check-legal-gdpr.mjs` 改为读取内部台账，并新增“对外条款混入审计表”负向变异，防止内部审校材料重新进入合同正文。
- [x] 条款版本更新为 1.5。第 1、2、4、6、10 节标题和相关句式改为“合同主体、适用范围与服务边界”“账户、凭据及账户活动”“托管同步服务与数据处理范围”“服务期限届满、中止与终止”“条款修订与同意记录”等正式法律表述；责任边界继续保留法律允许范围、不可限制责任及《民法典》第四百九十七条所要求的限制。
- [x] 调研依据沿用 `docs/standards/legal-language.md` 已登记的工信部政务服务平台协议、中国网信办个人信息告知规范及 IAPP 分层政策写作建议；本轮不把调研意见表述为法律意见。
- [x] `@heyta/legal` 类型检查、构建、GDPR 内部审计门禁、Landing 产物校验和 Web `/app/` 产物校验通过。法律包 Vitest 因内存闸门（112MB < 384MB）未启动，保持未验证状态。
- [x] Landing 与 Web 产物已重新构建并发布至 `ubuntu-jcli`；发布前回滚包为 `/tmp/heyta-public-backup-20261009-013038.tgz`。线上回读已确认新标题与 12 个对外章节，不含竞品关系声明及 GDPR 内部核对章节。证据：[legal-terms-formal-20261009](../../apps/landing/evidence/legal-terms-formal-20261009/RESULT.md)。
- [x] 追加清理版本记录中的内部合规项目名称，改为对外可理解的归档摘要；法律包、Landing 与 Web 已再次构建并上传。追加回滚包为 `/tmp/heyta-public-backup-20261008-180430.tgz`，Landing/Web `index.html` 字节对账分别为 `b212ac79…` / `47386ac3…`，产物自洽、挂载、GDPR 门禁与差异检查均通过。
- [ ] 法务正式审阅、主体资质核验、协议生效批准仍是独立发布门槛；本轮不得据此宣称协议已生效。

### UX-S9-152：服务条款竞品声明复核、级联事实同步与当前源码验收（2026-10-09）

- [x] 用户新增裁决已登记并执行：服务条款不再写入“个人项目，与滴答清单 / TickTick 及其关联公司无任何关系”。该句在源码、构建产物及公网 `/legal/terms/` 均已检索不到；TickTick 仅保留在导入与内部调研语境。
- [x] 隐私与数据权利文案按迁移真源更新为 34 条级联外键、覆盖 33 张表，并列出“自动化权益绑定”“自动化权益票据使用记录”两类新增记录；中英文结构门禁同步更新。
- [x] Web 回归收口：168 个测试文件通过、2 个跳过；2170 条通过、13 条跳过。修复 Escape 事件捕获、更多菜单焦点返回、批量选择退出、日历捕获关闭以及排期 `startDateLocal: null` 载荷断言；隐私同意状态在测试间显式隔离，生产隐私保护逻辑保留。
- [x] 法律包 4 个测试文件、76 条全部通过；法律包重建、Landing/Web 重建并再次发布。回滚包 `/tmp/heyta-public-backup-20261009-022940.tgz`；Landing 与 `/app/` 的本地/远端 `index.html` SHA 分别为 `3daf9db8eb7c8b62c8e7d6b100286b1fadb9e98020009a7553bb708b76101301` 与 `435bfa315489d38dde6fffe70105b1cf9e55001d3865536cb0864ac682acc428`。
- [x] Android Release 安装态已由 `windows-pc` 远程构建并安装到 `emulator-5554`；APK 与设备 SHA 一致，四个 Provider、既有实例及亮/暗主题渲染通过。四模板点击、Focus 状态即时刷新、Gallery 新增和 TalkBack 仍明确标为未验，见 [`android-widget-matrix/RESULT.md`](../../apps/mobile/evidence/ux-final-20261009/android-widget-matrix/RESULT.md)。
- [x] macOS 与 Windows 已用当前源码重打、清旧、安装并通过启动/新鲜度判据；macOS 安装包 WebView SHA 为 `b65c2cd4…`，Windows `PAYLOAD_INDEX_SHA` 与之逐字一致，Windows MSIX SHA 为 `ae88f1de…`。证据已追加到 [`ux-final-20261009/reinstall/RESULT.md`](../../apps/web/evidence/ux-final-20261009/reinstall/RESULT.md)。
- [ ] 完整四端系统小组件交互矩阵、实体 iPhone、Windows Widgets Board 与 macOS Gallery、生产邮箱收件闭环仍未完成；不以静态 Provider 或模拟器截图替代这些证据。Web `/app/` 挂载产物在桌面重装后已重新生成并发布，避免根路径与 `/app/` 产物混用。

### UX-S9-153：承接中断会话、验收脚本的语言真源、原生壳小组件环境识别（2026-10-09）

> 本节承接 Codex 会话 `01a11015-9f5a-7e42-b67f-79cfdba1b304`（同一目标，在 `server_overloaded` 处中断，最后一格正在改 Android Profile/Settings 验收脚本的中英定位）。

- [x] **验收脚本语言错配的真因不是"设备被留在英文态"**：`emulator-5554` 的**系统**语言就是 `en-US`（`getprop ro.product.locale`），App 跟随系统渲染英文，而 [`scripts/qa/profile-settings-android.py`](../../scripts/qa/profile-settings-android.py) 全篇只按中文文本定位 —— 它在入口就永远走不到被测判据。现量：`adb -s emulator-5554 shell getprop ro.product.locale`。
- [x] 脚本改成中英同一语义定位，**24 组配对逐条回对词条真源**而不是靠眼看：`python3 -` 把每个 `T('中','英')` 拿去 `packages/i18n/src/locales/{zh-CN,en}.ts` 里找同键双语命中。当场查出**一组错键**：`导出数据` 配的英文是 `Backup & migration`，而那个英文属于 `mobile.export.entry`/`mobile.export.title`（中文 `备份与迁移`）；`导出数据` 对应的是 `web.export.title` = `Export data`。移动端那一屏不存在"导出数据"这个标题，中文态下同样找不到标签。三处已改为 `T('备份与迁移','Backup & migration')`，回对结果 24/24 命中、0 不匹配。
- [x] `journey.json` 新增 `uiLocale` 字段（`en` / `zh-CN`），验收读数自带它是哪一语态取的。
- [x] **探针补强两条**（都是本轮实测撞到的）：① 新增 `app_tree()` —— dump 里没有 `com.heyta` 就响亮失败并打印前台包名，不再把安卓桌面当成 App 判 IA 失败（现量那次失败读数是 `['At a glance', 'Gmail', 'Photos', 'YouTube', ...]`，而 App 正在冷启动）；② adb 调用超时收进 `--adb-timeout`（默认 45 s），原先写死的 25 s 在满载机器上会把 `am force-stop` 读成失败。
- [x] **改掉 §8.2 唯一还开着的代码级残留（原生壳内小组件说明的环境识别）**：[`WidgetJourneyPanel.tsx`](../../apps/web/src/features/settings/WidgetJourneyPanel.tsx) 原先用 `resolveStorageBackend() === 'shell'` 认"我在原生壳里"，而那个判据只看 `__heytaHostStoragePort` —— 该端口带着一条排查用的逃生门（`HEYTA_SHELL_STORAGE=0`，macOS 与 Windows 同语义）。门一关，同一个原生窗口就被识别成浏览器，Windows 分支随之 `showInstallGuide=true`：**已经装在 MSIX 里的用户会看到"先把 heyta 装成应用"那三步**。新增 [`isNativeShellHost()`](../../apps/web/src/pwa/widget-install.ts)，只认壳**实际注入**的三条信号：存储端口、`chrome.webview`（仅 WebView2 有）、`webkit.messageHandlers` 里的 `heytaStorage` / `heytaWidget`；两个名字逐字锚在 `ShellStorageHost.swift`、`ShellWidgetBridge.swift` 与 `heyta_web.c` 的 `HANDLER_NAME`。普通浏览器三条都没有（Chrome 有 `window.chrome` 但没有 `.webview`；Safari 有 `messageHandlers` 但没有我们注册的那两个名字）。
- [x] 判据与能失败的证明：`apps/web/tests/widget-install.spec.ts` 本轮 **23 条通过**（新增 4 条：端口态、逃生门关掉的 WebView2 态、macOS/Linux 的 `heyta*` handler 态、普通浏览器负向态）。取现量：`cd apps/web && npx vitest run tests/widget-install.spec.ts`。**三条变异臂各打红一次**：去掉 `chrome.webview` 分支 ⇒ 1 红；把 handler 名匹配整条换成 `false` ⇒ 1 红；把"按名字命中"放宽成"有任意 handler 就算壳" ⇒ `anotherHandler` 那条 1 红。每臂还原后与原文件**逐字节相同**，`.mut-bak` 已删除（共享工作树上还原只从备份，不从 git）。
- [x] **页侧分类的真浏览器取证（新装置 [`e2e/tests/widget-journey-host.spec.ts`](../../e2e/tests/widget-journey-host.spec.ts)）**：同一个 Windows 平台名，两态 × **明暗两主题** 各拍一张**元素**图，共 4 张，4 passed。浏览器标签页态画着「如何装成应用」三步（[`browser-windows-tab-light.png`](../../apps/web/evidence/ux-final-20261009/widget-journey-host/browser-windows-tab-light.png) / [`-dark.png`](../../apps/web/evidence/ux-final-20261009/widget-journey-host/browser-windows-tab-dark.png)）；把存储宿主逃生门关掉的 WebView2 态只剩"正在原生桌面应用中运行"+"当前桌面应用暂不支持系统小组件"（[`native-shell-storage-host-off-light.png`](../../apps/web/evidence/ux-final-20261009/widget-journey-host/native-shell-storage-host-off-light.png) / [`-dark.png`](../../apps/web/evidence/ux-final-20261009/widget-journey-host/native-shell-storage-host-off-dark.png)）。四张图**人都打开看过**；暗色那一格另有一条断言（不把"暂不支持"退化成空白、也不把安装三步露回来）。🔴 **这条判据能红**：把 `isNativeShellHost` 退回"只看存储端口"的旧语义再跑同一份套件 ⇒ 恰好 1 红（壳那一态），改完恢复全绿，源文件还原后与备份逐字节相同。取现量：`cd e2e && npx playwright test tests/widget-journey-host.spec.ts`。
- [x] **本线自 10-07 起从未入库的证据与 QA 装置已收进仓库**：`check:docs` 当场报出 74 处"本机有、仓库里没有"的死链，其中 59 个指向这条线一直在写、却从没 `git add` 的证据（`ux-round4/5/6/8`、`ux-final-20261008/09`、`ux-closeout/release-2026-10-08*`、`settings-finish`、`reminders-data-responsive`、`macos/evidence/native-widgets` 等）与两枚 `scripts/qa/*.mjs` 装置。收完现量剩 **4 处**，逐条核对后**都不属于本线**：`docs/plans/inbound-automation.md`(2) 与 `docs/research/inbound-automation-review.md`(1) 指向入站自动化那条线自己的证据，`apps/desktop-windows/README.md`(1) 指向 `scripts/windows/launch-data-transfer-qa.ps1`。取现量：`node research/tools/docs-link-check.mjs`。那四处由对应线自己收，本线不代改。

- [x] **`@heyta/web` 全量在当前工作树重跑**（本线改过 `apps/web` 之后必须补的那一格）：**166 文件通过 / 3 失败 / 2 跳过；2175 通过 / 10 失败 / 13 跳过**。取现量：`cd apps/web && NO_COLOR=1 pnpm test`。10 条红**逐条查过归属，都不是本线**：
  - `assistant-history-panel.spec.tsx` 5 条是**确定性失败**（11–73 ms，不是超时），抛点 `packages/ui/src/theme.tsx:320` 的 `useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用` —— 而那枚文件在工作树里是 ` M`（共享 UI 那条线正在改 theme 契约）。`AssistantPanel.tsx` 与该 spec 本身也都是 ` M`。
  - `ai-panel-remount.spec.tsx` 4 条与 `calendar-sidebar.spec.tsx` 1 条单独重跑时是 **5000 ms 超时**（当刻 1 分钟负载 132–441），属载体；两片的被测面（`features/ai/*` 14 枚、`features/calendar/*` 4 枚）在工作树里全部 ` M`。
  - 本线自己动过的面：`widget-install.spec.ts` **23 条全通过**，`widget-journey-host.spec.ts` 真浏览器 **4 条全通过**。
  🔴 这三片红**不由本线代改**：往 `packages/ui` 的 theme 契约或 AI/日历的在制品上动手，等于替别人决定他们正在写的东西。归属与抛点记在这里，等对应线收。
- [x] **`@heyta/domain` 那格"因内存闸门未运行"已补跑**（内存空闲 57% 时闸门放行）：**1020 通过 / 3 失败**，三条逐条归因，既不打包成"抖动"也不打包成"产品失败"—— 取现量：`cd packages/domain && NO_COLOR=1 npx vitest run`。
  - `habit-backfill.spec.ts > B8 窗口判定只有一处所有者` 与 `lunar.spec.ts > 逐日往返 1901→2100` 是 **5000 ms 超时**，当刻整机 1 分钟负载 282；单独重跑 **53/53 通过**（lunar 自身 2580 ms，离上限本来就近）。**记成载体，不记成产品。**
  - 🔴 `subscription.spec.ts > contract with server/src/entitlement.ts` 是**真红、单跑 554 ms 复现**：服务端 `entitlement.ts`（工作树里 ` M`，属密钥撤销那条线在册的改动）新增 `NO_BINDING`（`entitlement.ts:389`）与 `REVOKED_VERSION`（`:392`）两个拒绝原因，而 `packages/domain` 那侧的镜像封闭词表没跟着长 —— 这条契约测试判的正是"两侧一模一样、且不许有多余"。**本线不代改**：往镜像词表补两项是那条线对"客户端要不要认识这两个拒绝"的语义决定，不是消红手段。归属与位置写在这里，等对应线收。

🔴 **这一格仍未取到的读数，不记作通过**：
- [ ] **Android 整条 Profile/Settings 旅程本轮没跑成，三趟都死于载体**：① dump 拿到安卓桌面（判据已补，见上）；② `am force-stop` 超 25 s 超时（旋钮已补）；③ 设备上的 `com.heyta` 被并行会话**卸载**，随后包管理服务不可用 —— `adb install -r` 两次报 `cmd: Can't find service: package`，而 `pm list packages | grep heyta` 为空。设备面判据**一条都没取到**，这是环境结论，不是产品缺陷。
- [ ] **共享设备证据**：同一台 `emulator-5554` 上 11:00:26 与 11:12:54 两次 `pm_clear_app_data_caller`（uid 1000 = adb）；同时在跑的还有另一条线的 `scripts/verify-mobile-account-email-sessions.sh` 与 Playwright `tests/ai-assistant.spec.ts`。整机 1 分钟负载在 **73 ↔ 622** 之间震荡（阈值 12），内存 62G/63G 占满。按 AGENTS §8.9，这一段要的是**独占窗口**，不是重试。
- [ ] **`pnpm --filter @heyta/web typecheck` rc=2，红点不在本线**：13 条 `error TS` 全部落在 `apps/web/tests/share-key-store.spec.ts`（`git status` 为 `A`、从未提交、mock 的 `Storage` 缺 `length/clear/key`），本线三个文件零错误。该文件属另一条在册的线，**不代改**。取现量：`grep -cE 'error TS' <该命令日志>`。
- [ ] **真壳内的读数仍未取**（Windows WebView2 / macOS 壳里那段面板实际画成什么）。上面那张 `native-shell-storage-host-off.png` 用的是**合成的** `chrome.webview`，它证的是页侧分类与文案，**不能读成"壳里验过了"**。现成装置是 [`scripts/qa/windows-installed-widget-help.mjs`](../../scripts/qa/windows-installed-widget-help.mjs)，它第一条判据正是"原生壳必须被页侧识别为 native"，要 `windows-pc` 的 CDP 隧道。
- [ ] **下一趟的固定顺序**（负载回落且 `pm` 可用之后）：`adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk` → `python3 scripts/qa/profile-settings-android.py --serial emulator-5554 --evidence-dir apps/mobile/evidence/ux-final-20261009/profile-settings-android` → 打开 `journey.json` 的 `uiLocale` 与截图人看一眼；英文态跑完要把设备语言切回 `zh-CN` 再跑一趟，两态分别登记。
