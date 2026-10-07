# 全项目视觉 Taste 只读复核

日期：2026-10-07

这份复核把 `design-taste-frontend` 的审计原则用于适合本项目的部分：先看信息层级、容器宽度、标题数量、组件状态和动效节奏，再决定是否需要改代码。该 skill 明确不覆盖密集型任务工作台的完整控件设计，因此设置、任务和原生壳只登记视觉债务，不套用 landing page 的卡片模板。用户已明确将“全面禁用下划线”作为产品视觉规则；本文件中所有链接与导航建议均以填充、颜色、状态徽标和 `focus-visible` 环表达，不再为正文链接保留下划线例外。

## 总体判断

蓝白 token、暗色主题、焦点环和共享设置行已经形成稳定基础。当前最大的审美问题不是颜色，而是信息层级仍有几处靠长文字和重复标题维持，帮助中心尤其容易出现“站点壳 + 页面标题 + 分组标题”争夺首屏，以及正文、目录、搜索列没有统一阅读宽度的现象。下一轮应优先收敛层级和列宽，再处理装饰性动效。

## 逐页缺陷清单

| 优先级 | 页面 / 证据 | 只读发现 | 设计判断 | 建议验收 |
|---|---|---|---|---|
| P0 | Web 帮助中心 `/help`；`apps/landing/src/pages/HelpPage.tsx`、`PageSections.tsx`、`help-search.tsx` | `PageHead`、搜索标题、主题分组同时出现，容易形成重复页标题；搜索与卡片各自定义宽度 | 一个页面只保留一个视觉页标题；搜索是任务工具，主题是内容分组；两者共享同一阅读列 | 1440/768/375 截图；视觉 h1 只有一处；搜索、分组、卡片不产生横向溢出 |
| P0 | Web 文档分类/文章；`DocsCategoryPage.tsx`、`DocsArticlePage.tsx`、`DocsShell.tsx`、`DocsLayout.tsx` | 线上首篇文章已实测：1440/390 亮暗四态均只有 1 个 h1；顶栏返回首页可见且实际到官网 `/`；分组 16px/600 大于条目 14px/400；正文首屏直接进入答案，窄屏目录收进浮动入口 | 站点身份应轻于当前文章标题；导航表达位置，正文表达答案；不要用第二个大标题重复站点名 | 线上证据：[`live-readout.json`](../../apps/landing/evidence/docs-release/live-readout.json) 与 `docs-live-first-run-*`；该首篇线上检查已完成，剩余是发布后持续回归；应用 32 张页面矩阵另见产品计划 |
| P0 | Web 帮助 / 文档链接；`apps/landing/src/styles/landing.css`、`help-discovery.css` | 线上首篇文章四种状态实测所有 `.lp-docs-site a` 的计算 `text-decoration-line` 无 underline；当前项用填充高亮，右侧 TOC 用颜色和边线表达位置 | 全产品链接与导航均不使用下划线；导航项用填充高亮、边框或 `aria-current`，正文链接用语义色、hover/focus/visited 状态和清晰命中区表达可发现性 | 线上证据：[`live-readout.json`](../../apps/landing/evidence/docs-release/live-readout.json)；首篇线上四态已复验，其他页面键盘焦点与持续回归仍单独跟踪；暗色截图已人工查看 |
| P1 | Web 帮助正文；`apps/landing/src/site/docs.ts`、`PageSections.tsx` | FAQ/文章内容包含自建、token、命令和实现边界，普通用户首屏可能读到技术语境 | 按任务组织首段；运维细节进入高级阅读，保留事实但降低首屏认知负担 | 普通用户 10 秒内找到下一步；自建用户能从文档目录进入完整细节 |
| P0 | Web 设置；`apps/web/src/features/settings/*`、`apps/web/src/styles/app/*` | 设置行已部分共享，但不同面板仍可能出现外层卡片套内层卡片、说明段落与动作重复表达 | 设置项固定为名称、作用、状态、动作四槽位；限制/风险用独立 callout；避免“框中框” | 亮/暗/窄屏截图；每组只保留一层主要 surface；不可用状态有原因和下一步 |
| P1 | Web Profile / 头像菜单；`ProfileOverview.tsx`、`AccountMenu.tsx` | Profile、设置和账户动作的视觉入口需要保持同一层级，避免资料页变成设置长流 | 头像菜单是账户入口，Profile 是身份与进展，Settings 是偏好/安全/数据；摘要卡只做跳转 | 桌面与窄屏入口、返回、选中态截图；不出现重复“个人资料”标题 |
| P1 | Web AI Chatbot；`apps/web/src/features/ai/*`、`apps/web/src/styles/app/ai-panels.css` | AI 仍需确保 header、消息区、composer 是三段结构，权限/技术状态不能抢过对话 | 用户看到一个 Agent；工具和权限是会话内状态，不成为独立目的地 | 640/800/900 高度截图；composer 贴底；窄屏 overlay 不挤任务区；写操作显示提案确认 |
| P1 | Web 日历；`CalendarHeaderToolbar.tsx`、`CalendarSidebar.tsx`、`CalendarBoard` | 月历的日期锚点、辅助节日、任务条和选中态需要用组件状态表达，不靠文字密度 | 日期是主信息；今天使用蓝圆；任务条按时间；超出用 `+N`；跨天任务保持连续段 | 1440/1024/375 亮暗截图；无横向溢出；日期格信息顺序稳定；点击日期就近添加 |
| P1 | 移动 Profile / Settings；`apps/mobile/src/screens/ProfileScreen.tsx`、`SettingsScreen.tsx` | 原生端面板数量多，若各自使用不同标题和行间距会破坏共享 IA | 平台只改变 sheet/navigation 容器，词汇、状态和动作顺序保持与 Web 一致 | Android/iOS AX 树与截图；44pt 命中区；返回路径不丢上下文 |
| P1 | macOS / Windows / Linux 原生壳；`apps/desktop-macos/.../HeytaMacApp.swift`、`apps/desktop-windows/.../MainWindow.xaml.cs`、`apps/desktop-linux/src/heyta_web.c` | WebView 内的站点链接若替换当前页面，帮助会切断工作区；外链行为也不应因平台不同而漂移 | 帮助、价格、更新动态由系统默认浏览器承载；本地应用 URL 留在壳内 | 点击帮助后工作区仍在；仅 `http(s)` 外链离开；无 shell 拼接；失败不关闭当前窗口 |
| P2 | Landing 首页 / Showcase；`apps/landing/src/mockup/*`、`Showcase.tsx` | mock 必须继续与真实 rail、任务区、四象限和详情栏比例对账，装饰性内容不能制造不存在的 AI/工具层 | mock 数据可变，结构不可变；动效解释状态变化，不做持续漂浮 | 375/768/1440 DOM 与截图；reduced-motion 直接呈现；列比例与真实 Web 对账 |

## 已落地的外链行为修正

桌面原生壳现在把帮助、价格、更新动态等绝对 `http(s)` 链接交给系统默认浏览器，并取消 WebView 内导航；本地 shell URL 继续留在应用内。macOS 使用 `NSWorkspace`，Windows 使用 `Launcher` 并覆盖新窗口请求，Linux WebKitGTK 使用默认 URI handler。移动端原有法律链接继续使用 `Linking.openURL`。这条规则只改变承载方式，不改变站点地址、认证协议或页面 IA。

## 早期收口边界（2026-10-07 历史快照）

- 成长页 UX-S9-57 的英文月份截断已修复并复验；8 个页面 × 2 个视口 × 2 个主题的 **32 张矩阵已完成并人工查看**。Windows 与 iOS 当前安装态 Growth 也已查看。
- Windows 当前 MSIX 已有安装态 Chatbot、设置和 Profile → Growth 的 DOM/截图证据；这不覆盖所有 Windows 原生交互。
- 第二轮 `reinstall:all` 的 macOS 系统窗口截图在锁屏状态下失败，不能写成四端全绿。当前签名 macOS App 已手动安装，包内 WebView 快照及 M2 account/settings 证据通过；锁屏仍阻碍 ScreenCaptureKit 系统截图和物理点击。
- 移动端已有局部实机证据：iOS 任务旅程完整通过长按、四象限移动/撤销、键盘无遮挡与恢复；Android 长按、选择、四象限移动/撤销和键盘可见步骤通过，但总旅程因后续“任务详情”标签等待超时而失败，另有键盘前后截图。该项不能登记为 Android 全旅程通过。
- 原生壳外链和 Widget 环境识别在指定证据目录中没有独立点击/读数；现有 macOS/Windows DOM 只能证明共享 UI、设置和 AI/Growth 容器已加载，不能证明系统浏览器承载和工作区保留。
- Landing 已有中英文 1440/390 亮暗截图，以及线上帮助中心 1440/390 亮暗、无溢出、单一 h1、搜索和无下划线读数；没有 reduced-motion 或键盘焦点的结构化验收记录。
- UX-S9-59-A 的六种 `StateIllustration` 代码组件已实现并接入 Web/mobile；真实 Web 空态覆盖五种场景共 20 张 1440/390、亮/暗、减少动态效果检查。最新浏览器验收已通过（1 passed），包含真实 `Image` 加载与 0 pageerror；`apps/web/evidence/state-illustrations/` 保存 browser、类型/设计、UI 与 Web 测试读数，其中 UI 33 项、Web 53 项全部通过。`complete` 仍只作为共享 `TodayProgressCard` 的完成反馈素材，移动端与四端产物视觉验收仍待补。
- UX-S9-59-B 的六张 AI 原图已生成并通过 contact sheet 视觉查看，原图、提示词、provenance 与处理后运行时小图齐全，已内嵌共享组件；插画只作装饰，不承担语义颜色或状态判断。当前 Web 浏览器的 20 图真实加载断言已通过，移动端与四端产物验收仍待完成。UX-S9-59-C 的本机 skill/模型复用链路已验证，不记录凭据或个人 provider 标识。
- 最新落地页与 Web 应用产物已部署并完成线上回归：`apps/web/evidence/state-illustrations/release/live-check.txt` 的线上检查 30 项通过；`deployment.txt` 记录 landing `9b5b4e5c…`、Web `1b2fc498…` 的本地与 `/var/www` 字节哈希一致。该部署证据不替代四端重装，四端仍在收口中。
- Profile/Settings/AI/长按证据分散在各端，尚未形成一张同时覆盖四端和全部交互维度的统一矩阵。
- Android 键盘返回优先级修复已通过 **833 项单测**；修复产物 `1a8f83...` 已完成 14 步旅程与 Profile，但早于最新动画/颜色源码；当前源码 APK、真机返回、长按、安全区和 APK SHA256 仍待复验与回填。iOS 重装后的 `profile-final` 已通过，同样早于最新源码。
- AX 树和模拟器点击只能证明控件路径、焦点与命中区；不等于真人 VoiceOver/TalkBack 语音验收，也不把全部跨端功能标为通过。

这份清单仍不把源码存在、构建成功、局部安装态或单张旧截图当作完整视觉验收。剩余清单是：macOS 解锁环境下重取系统窗口/物理点击证据；完成 Android 当前 APK 的重新安装、真机交互与 hash 回填；对尚未覆盖的移动读屏、安全区、拖拽/长按和原生外链路径做针对性验收；Landing 其余页面继续补全 reduced-motion、键盘焦点与窄屏证据。

## 更新：插画版本交付与新增全局响应式审查

插画版本已完成四端构建、安装与启动；macOS 锁屏已解除并取得安装副本亮暗截图。Android、iOS 最新任务旅程和个人中心/设置链通过，Windows 真实插画加载通过。证据统一见产品优化计划“当前事实收口索引”。旧失败记录保留为历史，不再作为当前阻塞。

用户随后新增 UX-S9-63—68：双语插画、默认执行的两档 AI、助手图标、rail 中轴、输入区去内层框、全应用拖栏及响应式逐页审查。这一批源码晚于上述安装产物，需独立验收、重新交付；不能沿用旧四端完成结论。
