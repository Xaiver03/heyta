# UX-S9-01–51 当前收口审计

> 日期：2026-10-07  
> 范围：共享工作树当前字节、Web 浏览器证据、已存在的原生壳证据。  
> 目的：把计划中的 01–51 逐项分成“源码已存在”“浏览器已证明”“安装态已证明”“仍有缺口”，避免把中间产物或静态检查误写成产品 UX 完成。52/53 由各自 owner 追加，本文件不替代它们。

可复核命令与读数见 [`apps/web/evidence/ux-closeout/verification-2026-10-07.txt`](../../apps/web/evidence/ux-closeout/verification-2026-10-07.txt)。真实 macOS WKWebView 来源证据见 [`wkwebview-origin-probe-2026-10-07.txt`](../../apps/desktop-macos/evidence/wkwebview-origin-probe-2026-10-07.txt)。

状态含义：

- **代码+浏览器**：当前代码有实现，且有当前 Web 浏览器交互或视觉读数；跨端安装仍可能未验。
- **代码部分**：源码已有主要结构，但验收缺浏览器、真机、视觉或仍有明确子项。
- **未完成**：计划要求的主要行为尚未落地，不能用类型检查替代。
- **历史证据**：证据存在，但来自阶段性产物或旧布局，只能作为背景，不能证明当前冻结源码。

## 逐项核查

| ID | 当前源码/证据 | 当前结论 | 实际缺口 |
|---|---|---|---|
| S9-01 | `App.tsx`、`main-area.css`、`ux-viewport-matrix.spec.ts`；矩阵 1 条通过 | 代码部分 | 1280/1440/1728 的完整视觉复核与最终四端产物仍缺；不能只凭一个矩阵结论任务区比例已定稿 |
| S9-02 | `narrow.css`、`assistant-layout.css`；窄视口矩阵通过 | 代码部分 | AI/详情 overlay 的焦点、返回和窄高窗口仍需当前源码浏览器复核 |
| S9-03 | `AssistantPanel.tsx` 有固定建议按钮与 `ai-assistant-panel.spec.tsx` | 代码部分 | 当前 AI hosted 浏览器探针未得到完整通过读数；建议换行和不同高度截图需重跑 |
| S9-04 | `.ht-ai__main`、`.ht-ai__messages`、`.ht-ai__composer` 三段 CSS 已存在 | 代码部分 | `assistant-hosted-ux.spec.ts` 本轮被 tfa 包装进程卡住，不能宣称 composer 已在所有高度贴底 |
| S9-05 | `ai-assistant-tier-select`、tier 单测 34 条通过；写操作仍走 proposal/confirm | 代码部分 | 当前浏览器需复核直接切换、刷新持久化和提案确认，未把设置截图当成完整交互证据 |
| S9-06 | “新会话”仍在 AssistantPanel 历史/内容结构中，AX 读数能看到但不等于 header 位置已完成 | **未完成** | 计划要求移动到 header；需完成 DOM/CSS 与焦点回 composer 验收 |
| S9-07 | 共享 `EmptyState` 已有；Web shell 仍有自己的任务空态 | **未完成** | optimistic pending row、失败重试和侧栏高度稳定尚未形成一条可复核旅程 |
| S9-08 | `CategoryCreateDialog.tsx`；真实浏览器 375/768/1440 亮暗 6/6 通过 | 代码+浏览器 | 原生壳/移动端创建路径仍待统一验收 |
| S9-09 | `AccountMenu`、settings categories、HelpPanel、profile entry 测试 | 代码部分 | 深链、返回与“设置摘要 → Profile → 设置资料”仍需最终四端矩阵 |
| S9-10 | `ProfileOverview`、`ProfilePanel`；`profile-center/journeys.json` 记录桌面/窄屏亮暗往返 | 代码+浏览器 | 原生壳菜单与移动端入口尚未用最终产物复验 |
| S9-11 | Profile 身份摘要、近期统计、成就摘要；Profile 单测与 mobile profile tests 通过 | 代码+浏览器 | 成就完整状态（已得/进行中/锁定）和最终四端首屏仍需补证 |
| S9-12 | Data 三卡、Privacy/SettingsNotice、AI 结构已存在 | 代码部分 | Sync 仍把 hosted/account/encryption/advanced 连在一个 stack；显示控件仍是旧整宽层级，不能标全完成 |
| S9-13 | Web/移动共享词条与部分共享组件存在 | **未完成** | 缺 Profile/Settings/Help 四端入口、返回、空态、错误态矩阵 |
| S9-14 | `ColumnResizer`、Quadrant move、sidebar resize；相关 Web evidence 已有 | 代码部分 | 键盘 fallback、窄屏替代动作、跨端鼠标/触摸命中尚未在最终产物确认 |
| S9-15 | `TaskRow`/`TaskList`/`TasksScreen` 已接 `onLongPressTask`；mobile 832 条单测通过 | 代码部分 | Android/iOS 真机需确认短按、滚动、TalkBack/VoiceOver 与批量工具栏顺序 |
| S9-16 | Web quadrant move 真实浏览器 1280/375 2/2 通过；移动端有“移动到”菜单 | 代码部分 | 四象限 resize/drop 完整矩阵和移动端最终产物仍缺 |
| S9-17 | `ux-viewport-matrix` 1 条通过 | 代码部分 | 历史 `viewport-metrics.json` 仍记录 768/375 的 sync rail 越界 offenders；需重拍当前字节后才能声称无横向溢出 |
| S9-18 | 共享 i18n/组件与部分 Web/原生证据 | **未完成** | 没有覆盖 Profile、Settings、AI、清单标签、拖拽/长按、视口的五端最终矩阵 |
| S9-19 | Landing mockup 已按 Web rail/task/detail 结构改造；Landing 单测 1322 条、build 通过 | 代码部分 | 375/768/1440 当前浏览器 DOM/比例与真实 Web 对账尚未完成，不能用静态 mock 截图代替 |
| S9-20 | Docs/Help 路由、搜索和 `/docs` 入口已存在；Help entry Web 4/4 通过 | 代码部分 | Landing help center 的双语、窄屏、reduced-motion、空结果需独立当前源码浏览器验收 |
| S9-21 | motion helper 与部分 reduced-motion 样式存在 | **未完成** | 缺普通/减弱动效对照读数；不能把“无持续动画”当作完整动效验收 |
| S9-22 | `RailNavigation`、anchored More evidence、rail tests 已存在 | 代码部分 | 当前字节需再跑边缘翻转、Esc/Tab、触发器移动后重算；原生壳仍待安装态 |
| S9-23 | `rail-pref.ts`、drag/key order tests 与 `rail-customization/readout.json` 存在 | 代码部分 | 当前源码刷新/重启持久化、功能开关残留和必要入口保护需复验；移动端不应照搬桌面拖拽 |
| S9-24 | Auth 默认官方 origin、advanced disclosure、`auth-entry-default` 等代码/测试 | 代码部分 | 生产 CORS 已实测；WebView/Windows/移动最终登录旅程仍需以冻结产物复验 |
| S9-25 | CalendarSidebar 已有 `.ht-sidebar__day-aux`；日历截图存在 | 代码部分 | 当前亮暗/窄栏辅助文字视觉仍需重拍；旧日历整包测试含与新隐藏日列表冲突的断言 |
| S9-26 | `festivalsOn` + i18n 接入 CalendarSidebar | 代码部分 | 浏览器需核对名称、缺失年份和暗色层级；没有把领域层接入当成视觉完成 |
| S9-27 | `MiniDay` 统一 `hasContent`/primary 蓝点实现 | 代码部分 | 当前浏览器需证明任务/倒数日共用语义且不混入优先级/逾期色 |
| S9-28 | sidebar store/toggle、toolbar 摘要和恢复入口已存在 | 代码部分 | 当前 `calendar-sidebar` 全套需重跑；旧测试仍有 day-title/list 断言红，需先按现行产品决策校准测试 |
| S9-29 | `display-pref-panel` 仍有整宽设置层与长说明 | **未完成** | 日期/倒计时 segmented control 尚未完成 |
| S9-30 | 常驻/收起仍复用旧 display preference 结构 | **未完成** | 需紧凑选择组件与状态提示，删除长几何说明 |
| S9-31 | `LanguageSwitcher` 有语言组、`aria-current` 和键盘路径 | **未完成** | 视觉仍有嵌套外框；需与日期/主题改成同一单层紧凑控件并重拍 |
| S9-32 | `theme-toggle` 语义与焦点保留 | **未完成** | 暗色截图仍显示说明与 surface 密度偏高；需完成直接切换控件的审美改造 |
| S9-33 | CalendarBoard/CalendarView 有高度适配改动 | 代码部分 | 当前 Web 整包仍有旧断言红；需在 1024×600/1280×720/1440×900 重拍并确认不依赖拖大窗口 |
| S9-34 | CalendarView 当前显式 `showSelectedDayList={false}`，日期格任务条为主 | 代码部分 | 旧 `calendar-view`、`calendar-sidebar` 测试仍找 bottom day list；应更新为现行决策后再重新验收 |
| S9-35 | `CalendarCapturePopover` 已完成 portal、锚定、滚动重定位、Esc/outside；Web 7/7、浏览器 3/3 | **代码+浏览器** | 原生/移动容器的日期 capture 尚未证明与 Web 语义一致 |
| S9-36 | CalendarBoard 已有 date/today/selected 层级与日历截图 | 代码部分 | 需在亮暗、任务密集和窄屏复核日期数字不被条遮挡 |
| S9-37 | `packages/ui/src/calendar/model.ts` 有稳定任务排序 | 代码部分 | 当前 Web 日期混排浏览器读数需补；共享单测只证明模型，不证明日期格视觉顺序 |
| S9-38 | 跨天 `start/middle/end` 与稳定 lane 已实现；UI 单测 18/18、截图存在 | **代码+浏览器** | `+N` 展开和移动端/原生容器仍缺最终证据 |
| S9-39 | Auth dialog 组件、亮暗中英文窄屏截图、测试 88/88 | **代码+浏览器** | 最终四端认证壳与官方 origin 仍需冻结产物验收 |
| S9-40 | 注册主题文案、标题断行与 reduced-motion 结构已有 | 代码部分 | 需重拍当前 Landing/Auth 字节，不能沿用阶段性截图作为最终品牌结论 |
| S9-41 | 官方托管默认路径与自托管 advanced disclosure 已实现 | 代码部分 | 生产 CORS/Origin 已验证；认证浏览器与四端安装态仍待复验 |
| S9-42 | 移动端任务批量入口和部分 snackbar 组件存在 | **未完成** | Android/iOS 真机需验证工具栏安全区、四象限撤销和读屏顺序 |
| S9-43 | HelpPanel 三条组件化外链；Help entry 4/4 通过 | 代码+浏览器 | 原生壳外链点击与窄屏/暗色当前字节仍待验收 |
| S9-44 | `help-settings.css` 与 44px 命中区实现；Help entry 覆盖 375/1440 | 代码+浏览器 | 768、长标题、原生壳容器仍需复核 |
| S9-45 | `.ht-settings__help-link` 无下划线堆叠，保留 focus/rel | 代码部分 | macOS/Windows/Linux 实际点击外链并保持工作区的证据缺失 |
| S9-46 | HelpPanel 已删除端点/构建技术长说明；官网 Docs 承载高级内容 | 代码部分 | 官网文案/搜索/双语文章仍需按 SSOS 规范独立验收 |
| S9-47 | macOS NSWorkspace、Windows Launcher、Linux URI handler 代码已接 | 代码部分 | 三桌面壳必须在当前源码重新打包并人工点击；旧安装证据不能替代 |
| S9-48 | 生产 CORS 三来源均 OPTIONS 204、空参数 POST 400 且 ACAO 正确；真实 WKWebView Origin 证据成立 | **代码+生产证据** | 仅剩冻结产物登录旅程；不应把 CORS 通过写成四端安装通过 |
| S9-49 | SSOS 文档结构与模板已调研，Landing Docs 代码/build/entries 通过 | 代码部分 | 当前 Docs hub/article/search 的真实浏览器矩阵仍缺；不能把静态生成成功当成 UX 完成 |
| S9-50 | 设计变量门禁通过；AI/Profile/Help/设置已有局部视觉收口 | **进行中** | 全局 taste 复审仍未完成；显示设置、同步隐私卡片、注册/动效、原生壳截图均有缺口 |
| S9-51 | 本文与验证日志保留所有 01–51，未删除旧项 | **持续执行** | 需产品代码冻结 → `pnpm reinstall:all` → 四端哈希/启动/交互验收 → 父级视觉复审 |

## 明确的交付边界

### 已有真实证据

- macOS WKWebView 发送 `Origin: heyta-local://app`，证据路径为 [`apps/desktop-macos/evidence/wkwebview-origin-probe-2026-10-07.txt`](../../apps/desktop-macos/evidence/wkwebview-origin-probe-2026-10-07.txt)。
- Web Profile 的编辑、设置往返、关闭恢复、键盘 Enter/Escape 和 390px 亮暗主题读数在 [`apps/web/evidence/profile-center/journeys.json`](../../apps/web/evidence/profile-center/journeys.json)。
- Web Calendar capture 的 Portal、锚定、滚动、关闭和跨天 lane 有单测、浏览器截图及 UI 模型读数。
- Web Help entry 4/4、Category dialog 6/6、Quadrant move 2/2、Settings category 2/2、Viewport matrix 1/1 已在本轮直接运行。
- macOS 安装态 AX 与 Windows WebView2 DOM 都显示单一 Assistant surface、零 independent tool tabs；它们是安装态阶段性证据，不代表新冻结字节。

### 当前不能标完成

- `pnpm reinstall:all` 的现有 `release-summary.json` 是历史阶段性记录；在账号菜单、AI、设置、日历和站点修订全部冻结前不能复用为最终交付证明。
- 当前 Web 全量测试仍有 10 条旧 Calendar bottom-list/title 断言与现行 `showSelectedDayList=false` 决策不一致；另一个订阅链接断言已单独修正并通过。不能把这些旧断言红误写成 Calendar capture 新实现红，也不能把整包测试写成全绿。
- `apps/web/evidence/settings-finish/viewport-metrics.json` 仍包含 768/375 sync rail 越界 offenders，是历史读数；下一轮必须重拍并替换或明确标注。
- AI hosted 浏览器探针本轮未取得完整通过结果；只引用现有 AI screenshot/AX 证据，不声称本轮 assistant-hosted UX 已闭合。

### 下一收口顺序

1. 等账号菜单、AI 布局和设置显示/同步隐私代码冻结。
2. 按本审计逐项补浏览器/真机缺口；更新过期 Calendar 断言与 viewport evidence。
3. 运行完整门禁与测试，保存可复查日志。
4. 从同一源码冻结点运行 `pnpm reinstall:all`，核对 macOS、Windows、Android、iOS 产物哈希、启动判据和交互证据。
5. 父级视觉复审后，才将对应 ID 改成“完成”。
