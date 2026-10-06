# Goal：逐页排版对齐设计系统 —— 布局判据从无到有

> 状态：**进行中 —— 2026-09-29 立项（产品负责人重启）**
> 🔴 **触发**：产品负责人实测截图逐页指出 —— 元素交叉重叠（AI 工具行"运行"竖折行、
> 压住采集条）、四象限竖排成四张通栏卡（滴答是 **2×2 十字坐标系**）、macOS 灰色标题条
> 浮在深色应用上"很突兀"（滴答的窗口条**完全融入壳**）。
> **验证载体：外接浏览器（Playwright，无头）优先 —— `AGENTS.md §6.2` 规定二。**

## 0. 先回答"设计系统没做好吗？"

**变量来源是唯一的**（`tokens.css` 单源、`check:design` 拦裸值、对比度有真测试）。
没做到位的是另一层：**没有任何一道门禁管"排版怎么排"** —— 布局结构、间距节奏、
元素重叠全部无判据。"值合法但排版烂"是必然结果。本轮的产出因此是**逐页判据**，
不是再造变量。

## 1. 页面清单与判据（逐页过，绿一页勾一页）

| # | 页面 | 已知缺陷（截图实测） | 判据（可截图/可注入） | 状态 |
|---|---|---|---|---|
| 1 | **四象限** | 🔴 竖排 4 张通栏卡（`minWidth:'50%'`+`gap` 溢出换行）；无坐标系形态 | 2×2 十字网格（滴答 §5 同构）；窄窗不塌成 1 列；注入：任意一格宽度≠通栏 | ✅ 共享层改**确定两行两列**（`twoColumns` prop，宿主 `matchMedia`+token 判定）；几何断言 + 双宽度截图全绿（`quadrant-layout.spec.ts`）。⚠️ 教训：RNW `useWindowDimensions` 报的是 **screen.width** 不是视口宽 |
| 2 | **任务（AI 工具行）** | 🔴 "运行"按钮文字竖折、"例如：…"输入压住采集条 —— 交叉重叠 | 单行不折行、不与相邻块重叠；窄窗优雅降级 | ✅ `.ht-ai__actions` wrap + 输入框收缩下限（`layout.input-min` token）+ 按钮 `nowrap`；几何断言 + 双宽度截图全绿（`ai-row-layout.spec.ts`） |
| 3 | **壳（macOS 标题条）** | 🔴 灰色标题条 + 居中标题浮在深色应用上，"完全突兀" | `hiddenTitleBar`：红绿灯浮在应用底色上、可拖动区成立、rail 顶部让位 | ✅ `.windowStyle(.hiddenTitleBar)` + `isMovableByWindowBackground` + `.heyta-shell` 注入（rail 顶让位 32px）；壳内实拍：红绿灯融入底色、共享 UI + 下层透出（gate tmpdir 截图，人看） |
| 4 | 任务视图（主体） | 🔴 **新发现**：≤660px 时 app.css 的"移动端塌缩"媒体查询产出半成品形态（rail 失去壳感、掉到内容下方） | 间距节奏全部走 space 阶梯；塌缩形态要么修好要么收窄触发范围 | ✅ 塌缩形态已修（媒体查询移文件尾防覆盖 + 底部导航；网格已实测）。收尾轮补齐：**全部视图的塌缩态逐页截图**（`narrow-sweep.spec.ts`），并再修一条 —— 内容长时导航被推出视口（见 §5） |
| 5 | **日历**（其余子页待扫） | 日历学滴答 | 周次列 ✅（领域 `isoWeek` + 宿主措辞，几何断言 `calendar-dida.spec.ts`）· 今天列头高亮 ✅ · 头部「回到今天」✅（实拍人看）。节日标注 = 🔴 判不做（无数据源，见 §4）| ✅ 日历子页完成 |
| 6 | **搜索浮层**（通知/设置另算） | 🔴 **搜索拍板改居中浮层**（滴答同款：下层可见 + 关闭 ✕ + 空态）——此前是独立视图 | 浮层形态照 §11.5：`contentView` 泛化到搜索 → 下层视图继续渲染；`.ht-search-overlay` = scrim（`material.scrim`）+ 居中卡片（`layout.modal-max` 新 token）+ `role=dialog` 非模态；Esc / ✕ / 点 scrim 三种关法都回到**开搜索前**的视图 | ✅ 全部落地。单测 4 条（`search-overlay-ia.spec.tsx`，含下层可见判据 + 两种注入验证能红）+ e2e 几何/截图（`search-overlay.spec.ts`，卡片 ≤640px、内容区内居中、Esc 关）。🔴 教训见 §2.2：RNW TextInput 无条件吞 keydown 冒泡 → Esc 必须**捕获阶段**监听 |
| 7 | **任务页 IA**（回收站/账号区待扫） | 🔴 **任务页学滴答**：范围列计数 ✅（页4 已做，截图里「今天 1→2」与列表同步变化）、分组头 ✅、分组「顺延」✅ | 分组：领域 `groupTasksByDate`（判别联合，逾期→日期升序→无截止）+ 宿主措辞 `date-groups.ts`（今天/明天相对、更远绝对）；顺延：**app-host 新动作 `postponeToToday`**（推到今天保留时刻；已完成/无日期/不逾期幂等不写 op —— 界面按钮会过时，动作层不会）→ store 外观 → 组头按钮逐条转交（串行 await，向量时钟有序）。判据：domain 6 条 + app-host 3 条 + web 3 条（`task-groups.spec.tsx`，含"数勾选框不是数文本"的探针教训——行尾下拉选项把所有任务名渲染进每个 section）+ e2e 几何/前后双截图。🔴 **收尾轮补一刀**：组头原是 web 手写 `.ht-task-group` CSS，被 `check:row-single-source` 拦下（净增 ht-* 前缀族，"任务列表的实现只长在 packages/ui"）—— 门禁是对的，已升为**共享组件 `TaskGroupHead`**（title/count/action 槽，计数右对齐正是滴答的排法），web 只留措辞与「顺延」按钮（走既有 `.ht-btn--ghost`）。⚠️ 剩余打磨（不阻塞）：行右侧**清单名**徽标（滴答有）—— 待行内元信息统一立项时一并做 | ✅ 分组+顺延完成 |
| 8 | **逐页扫描**（习惯/时间线/番茄钟/成长/便签/回收站/设置/账号区/通知） | 🔴 扫描抓到三处真缺陷：① **任务采集条无条件下渲染** —— 便签页两条输入框叠贴、习惯/番茄钟/回收站各顶一条文不对题的任务输入；② **`AiToolRun` 误用 `.ht-ai`（inline-flex）** —— 标题/说明/输入被摆成一行（"运行"折行居中、输入框悬到说明右侧）；③ 设置 sheet 88% 半透明时下层深色文字以可读浓度透上来（"文字压文字"） | `pages-sweep.spec.ts`：8 页各一张固定路径截图（`test-results/sweep-*.png`，人已看）。修法：① 采集条**只在任务视图**渲染（各采集面归各视图；草稿随卸载丢弃 —— 值不上一个跨视图全局状态）；② 新 `.ht-ai-panel`（块级、纵向、`margin-block-start: space-4`——`.ht-content` 无 gap，两头不声明就贴死）；③ sheet 提到 **95%**（"下层可见"的判据是 DOM 标记仍在，视觉退成隐约一层就够）。⚠️ 教训：设置截图必须等 `ht-sheet-in` 入场动画走完 —— 动画中途 sheet 半透明，鬼影是**中间态**不是缺陷 | ✅ 全页核查完成（账号区/通知面板本来就干净） |

## 2.1 验证工具链的教训（本轮新增）

- 🔴 **别读陈旧证据文件**：`evidence/window-first-run.png` 是 **Sep 28** 的旧图（手写 UI 时代），
  而 gate 的真实截图写在 **系统 tmpdir 按进程号命名**（`check-macos-window.mjs` 的 `OUT`）——
  我误读了旧图，还以为壳在渲染占位页。看证据先看 **mtime**。
- 🔴 RNW 0.21 的 `useWindowDimensions` 用 `window.screen.width`（物理屏）——
  桌面上"响应式"不能靠它，判定必须在宿主用 `matchMedia`（断点值从 CSS 变量读，token 单源）。
- 🔴 单列分支**不能复用行容器**：`rows = [cards]` + `flexDirection:'row'` 会把四格压成一行
  四个 140px 小方块（实测）。

## 2.2 页6 的两条教训（2026-09-30）

- 🔴 **RN-web `TextInput` 在 keydown 里无条件 `stopPropagation()`**（上游 #612
  "Prevent key events bubbling"）。于是：焦点在任何 RNW 输入框里时（搜索面板的输入框
  是 autoFocus，那是常态），**冒泡阶段挂在 window/document 上的 keydown 监听器
  永远收不到按键**。实测：keyup 能到 window、keydown 到不了。
  ⇒ 浮层的 Esc 关闭**必须挂捕获阶段**（`addEventListener('keydown', fn, true)`）。
  ⚠️ 单元测试**抓不到这个**：jsdom 里直接 `window.dispatchEvent(keydown)` 绕开了
  DOM 冒泡路，测试全绿 —— 只有真浏览器的真实按键走的是那条被吞的路。
  这是"规定一（必须真跑真浏览器）"的又一根实锤。
- 🔴 **几何断言要量对元素**：第一版量了 scrim 本身（`inset:0` 撑满内容区，必然"超宽"），
  应量卡片（overlay 的子元素）。居中基准同理是**内容区**（浮层只盖主列，rail/侧栏照常
  透出 —— §1.3），对视口居中会差出 rail 宽度的一半。

## 2. 非目标

- 不动 tokens.css 的取值（变量单源已成立）；
- 不动移动端（主战场但在下一轮；本轮先立桌面/web 判据）；
- iOS 夹具线照旧独立。

## 3. 交付定义

每一页：修复 + 外接浏览器截图（人看）+ 可注入的布局判据进门禁/测试；
本文件逐页打勾；最后一轮跑全门禁 + 全测试。

## 4. 后端/领域支持审计（2026-09-30，产品负责人要求：IA 对齐必须先核后端）

| IA 项 | 后端/领域现状 | 结论 |
|---|---|---|
| 页7「顺延」按钮 | 原以为"已有"；实际只有 `setDueDate` 写路径与重复任务的完成顺延 | ✅ 已补：app-host 新动作 `postponeToToday`（见页7 行）——语义进动作层，不进界面 |
| 页7「行下描述两行」 | `domain/entities.ts` 的 Task **没有 description 字段** | 🔴 **独立阻塞**（登记见 §4.1）—— 牵 domain/reducer/app-host/共享 TaskList/mobile 五层，不是排版修复 |
| 页5 日历「周次列」（31周） | 纯前端计算（ISO week），`CalendarBoard` 已有 `monthGrid` | ✅ 可做（已做） |
| 页5 日历「节日/七夕标注」 | **无任何节假日数据源**；离线优先 + 每年法定节假日变动 = 数据维护负担 | 🔴 判：**不做**（如要做需先立数据源 ADR）；今天列高亮 + `< 今天 >` 头部可做（已做） |
| 页6 搜索浮层 | 搜索是纯本地领域搜索（`domain/search.ts`），无后端依赖 | ✅ 可做（已做；滴答搜"过滤器"，heyta 无此实体 —— IA 差异如实登记） |
| 页7 范围列计数 | `selectQuadrantCounts` 已有；per-filter 计数选择器前端可推导 | ✅ 可做（已做） |


> 🔴 **勘误（2026-10-02）——上表"页5 日历节日标注"那行的理由已被推翻，原文保留不删**：
> 它写的「**无任何节假日数据源**」不成立。实测有两个过得了 AGENTS §3.1 维护门 + §3.2 许可门的
> 现成来源（`6tail/lunar-typescript` MIT / 2026-08 仍在提交；`NateScarlet/holiday-cn` MIT / 2026-09 仍在提交），
> 且农历与传统节日是**纯算法、零数据文件**，"离线优先"与它不冲突。
> 该行当时自留的出口「如要做需先立数据源 ADR」正是它该走的路 —— 证据基础见
> [`countdown-anniversary-data-and-images.md`](../research/countdown-anniversary-data-and-images.md)，
> 落地见 [`countdown-anniversary.md`](countdown-anniversary.md)。
> ⚠️ 2026-10-03 补一句状态，免得这段被读成"已经在做"：决策已立 = [ADR-0044](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md)，
> **批次一（W1 历法 / W3「每年」/ W4 节假日 + bundle 闸门）已落地**，界面工单 W0/W5/W6 与 `EVENT` 实体（W2）**还没开工**。
> ⚠️ **但有一处它没说错、勘误也不推翻**：**调休/补班**（哪天上班）是国务院每年 11–12 月发布的
> 行政决定，**不可预测**、必须逐年取数。"节日都可预测"只对农历与公历节日成立。
> 所以本行的"数据维护负担"对**放假安排**仍然成立，对**节日标注**不成立 —— 两者在调研 §1 被拆成 A/B/C 三件事。

### 4.1 页9「任务描述」立项登记（独立阻塞，不在排版轮实现）

- **字段**：`Task.description?: string` —— **可选**、运行时默认 `undefined`，
  **不 bump `CURRENT_SCHEMA_VERSION`**（AGENTS §3.3：新字段必须可选 + payload marker 语义；
  老数据没有它必须能安静地不存在）。
- **写路径**：app-host 动作 `setDescription`（与 `setNote` 同一条约定：清除写 `null` 穿 JSON）；
  🔴 不复用 `note` —— `note` 已经被 AI 拆解/估时占用，两种"补充文字"合并会让
  AI 写入覆盖用户描述（那类静默覆盖本仓吃过）。
- **读路径**：共享 `TaskList` 行加**第二行灰字**（两行截断）—— 共享组件改动，
  web 与 mobile 同时生效；空值不占位。
- **同步**：走既有 `UPD` payload，无需线协议改动（`isEntityType`/词表不动）。
- **工作量**：一次独立轮（领域 + 单测 + 两端 UI + 截图验收）；**排版轮不带它**。

## 5. 收尾回归状态（2026-09-30，最终轮）

- 🔴 **第二轮追加（§6-§8 之后）也跑了完整 `pnpm check`：exit 0，一把过。**
  证据在同一次日志里：e2e **58 passed**、`apps/web` **977 passed / 12 skipped**、
  `check:macos-window` 的真窗口探针打出**新判据**——
  `✅ M2-macOS ✅ 身份入口成立（头像 1 个、采集框 1 个）；**身份菜单合规**
  （第一项 sync-signin-entry、登录入口 1 个、退出登录 0 个）；设置里的滴答导入面板可达`
  ⇒ 「头像菜单 IA」在 **macOS 真壳**里也成立了（不只是 web e2e）。
  ⚠️ 环境：`check:macos-shell` 需要 SwiftPM 写 `~/Library` 缓存 + `sandbox-exec`，
  在受限文件沙箱下会以 `sandbox_apply: Operation not permitted` 假红 —— 放宽后可过。
- 🔴 **第一轮（页1-8）的完整 `pnpm check`** —— 这是本 goal 的最终口径：
  build → typecheck → 全部 check:* → verify-artifacts → 完整 e2e → 全量测试，一把过。
  过程中修掉两处被它揪出的真问题：
  1. `check:row-single-source`：组头手写 `.ht-task-group` CSS 是净增前缀族 →
     升为共享 `TaskGroupHead`（见页7 行）；web 测试探针同步改用 testID。
  2. `verify-artifacts`：evidence/ 里躺着修复前手动跑 capture 留下的
     `CROSSCHECK=skipped` 旧取证 → 重新生成（`CROSSCHECK=ok`）。
- **全量测试**：✅ 0 失败（mobile 418 / web 972 / app-host 724 / domain 706 /
  ui 283 / design-system 411 / ai 162 / local-api 79 / shared-schema 70 / desktop 12 …）
- **全仓 typecheck** ✅ · **全仓 build** ✅
- **点名门禁**：check:design ✅ · check:tokens ✅（198 token，4 产物同步）
  · check:ui-language ✅（zh 1925 / en 1925）· check:docs ✅ · check:journey-coverage ✅
  · check:macos-window ✅ · check:macos-shell ✅ · check:row-single-source ✅（回到基线 28）
- **页1-5 几何判据 + 页6-8 判据复跑** ✅（quadrant-layout / calendar-dida /
  progress-spacing / ai-row-layout / search-overlay / search-overlay-ia / task-groups×2 /
  pages-sweep / narrow-sweep，共 30+ 条）
- **窄窗塌缩**：`narrow-sweep.spec.ts`（10 条）逐页销账 —— 并抓到一条真缺陷修掉：
  塌缩态的 `.ht-app` 原来只有 `min-height: 100dvh`，**内容一长底部导航就被推出视口**
  （日历/四象限这类高页面要滚到文档末尾才能切视图；页4 只验过短内容的任务页没暴露）。
  修法：塌缩态钉死 `height: 100dvh` + `.ht-main { overflow-y: auto }`（内容在 main 内部滚，
  导航常驻贴底）。截图 `test-results/narrow-*.png`（日历/四象限/习惯/时间线/番茄钟/成长/
  便签/回收站/搜索/设置），人已看。⚠️ 截图等 `ht-sheet-in` 动画走完 —— 中间态半透明
  会把动画误读成"卡片透底"（与页8 同一条教训的第二次）。
- ⚠️ 已知负载型抖动（如实登记，非本次引入）：`apps/mobile` 的 vitest 在**整仓并发跑**
  时偶发 3 条未处理 rejection（rolldown 并行转换 react-native Flow 文件，
  "Flow is not supported"）；测试本体 418/418 全绿，单跑与多数整跑都绿。
  `@heyta/ui` 主桶被 `sync-status-text.spec` 导入是既有事实，本次未改变。
  复现后重跑即绿（check 第 3 轮红、第 4 轮绿）。
- 🔴 本轮新增环境教训（AGENTS §7 第 80 / 81 条）：80 = RN-web `TextInput` 无条件吞
  keydown 冒泡 ⇒ 浮层 Esc 必须捕获阶段监听（jsdom 单测抓不到）；81 = 窗口取证三坑
  （`.optionOnScreenOnly` 看不见后台实例 / `.optionAll` 后 `head -1` 拿到 500x500
  无标题辅助窗、`screencapture -l` 对它出 1000x1000 占位图 / 僵尸实例污染窗口清单）。

---

## 6. 账号身份入口（2026-09-30，收尾轮追加；产品负责人两次实测）

> 触发原话：① 「注册登录那个地方排版还是不对吧？」
> ② 「应该是点击头像出来注册、登录吧？…这个 UX 逻辑根本就不对，
> 你搜索一下、调研一下…再搜索一下还有什么其他UX逻辑跟最佳实践不相符合的。」

### 6.1 两处真缺陷（都不是"不好看"，是逻辑错）

| # | 缺陷 | 事实 | 修法 |
|---|---|---|---|
| 1 | **身份入口有两个** | 上一版是「头像 + 头像**旁边**常驻的 `sync-signin-entry` pill」——两个控件长得都像账号入口，点哪个都能开同一块面板，用户要先猜一次 | 撤掉 pill；登录/注册成为**菜单第一项**（`.ht-accountmenu__item--primary`，强调样式），身份入口**唯一** |
| 2 | **未登录的人看到「退出登录」** | 菜单三项（设置/统计/退出登录）曾**无条件**渲染 —— 「退出登录」会清本机凭据，给没登录的人渲染它 = 把一个危险动作降级成噪音 | 未登录：菜单 = 登录/注册 + 设置 + 统计（**没有**退出登录）；已登录：身份区（邮箱）+ 设置 + 统计 + 退出登录（**最后一项、危险色**） |
| 3 | 🔴 **面板一直被 rail 裁掉右边 16px**（顺带抓到的） | `.ht-accountmenu__panel` 是 `position: absolute`，`min-width: 12rem`(192px) > rail 宽 `11rem`(176px)，而 `nav.ht-rail` 是 `overflow-y: auto` 的裁剪容器 ⇒ 右侧**一直是缺的**。塌缩态（≤768px）更糟：rail 变底部导航 + `overflow-y: hidden`，向下弹的面板**整块在视口外** | 面板改 `position: fixed` + **实测锚点**（`getBoundingClientRect`，不用 rail 宽度硬算 —— 塌缩态 rail 根本不在左边）+ **哪边空间大往哪边弹**（塌缩态向上） |

### 6.2 键盘 / 无障碍（顺手补齐，同一处 `role="menu"`）

打开菜单 → 焦点进第一项；`↑`/`↓` 首尾相接走动、`Home`/`End` 到首尾；
`Esc` 关闭**并把焦点还给头像**；`Tab` 收起菜单（菜单不是对话框）；
头像上 `↓` 直接打开菜单。判据在单测里（`document.activeElement` 直接可断言）。

### 6.3 依据（外部调研；不是"我觉得"）

- UsabilityGeek《The UX Logout Lapse》—— 账号管理动作收进头像菜单是**每日使用**
  的个性化服务的通行做法（heyta 正是），但"藏太深"看起来像不想让你走 ⇒ 一点就到、
  「退出」要在最显眼处（最底）。<https://usabilitygeek.com/ux-logout-lapse/>
- SaaSUI《SaaS Profile & Account UX Patterns (2026)》—— 账号面以**身份区**开头
  （头像 + 邮箱）；危险动作放**明确分隔的 danger zone、永远在最底**；
  绝不能与常规项**同样的视觉分量**；"未登录"时不存在的东西不要渲染。
  <https://www.saasui.design/blog/saas-profile-account-ux-patterns>

### 6.4 判据与证据（都已跑过）

- **单测**：`apps/web/tests/signin-entry.spec.tsx` **8 条**（入口唯一 / 首屏没有第二个
  登录控件 / 第一项=登录注册且有强调样式 / 两次点击到表单 / 未登录无退出登录 /
  已登录无登录项且退出登录在最后且是危险色 / 键盘可达 / 地址单源×2）。
- **真浏览器 e2e**：`e2e/tests/account-menu.spec.ts` **3 条** —— ① 未登录形态；
  ② 已登录形态；③ 塌缩态向上弹。判据本体是**命中测试**（`elementFromPoint`），
  不是量尺寸：裁剪是渲染层的事，`getBoundingClientRect()` 被裁时**照样正常**。
  · **注入验证**：把面板改回 `absolute` ⇒ `面板右边必须可见` **转红**；
  改回 `fixed` ⇒ 复绿（判据不是碰巧绿的）。
- **截图（人已看）**：`e2e/test-results/account-menu-{signed-out,signed-in,narrow}.png`。
- **M2 探针（macOS / Windows 逐字一致）**：首屏锚点从 `sync-signin-entry` 改成
  **身份入口头像**，登录入口在**打开菜单后**再验，且新增一条更严的判据 ——
  未登录时菜单第一项必须是 `sync-signin-entry`、必须有设置项、**不得**有
  `account-menu-signout`。macOS 侧 `swift build` 已过；门禁 `check:macos-window`
  的判据同步改成三条（身份入口 / 身份菜单合规 / 滴答导入面板可达）。
- **docs 同步**：`user-journey-and-auth.md` §3.1（「前置」的可执行定义 + 为什么从
  "1 次点击"放宽到"2 次"，如实登记取舍）、`multi-end-unified-strategy.md`（M2 段）、
  `m2-webview-shell/README.md`（探针三段）。

### 6.5 ⚠️ 没做 / 需要产品负责人拍板的

- 移动端的「我的」页是否也收成同一个身份菜单形态 —— **本轮未动**（主战场在下一轮，
  且移动端的账号面是 `ProfileScreen` 顶部卡片，不是菜单）。
- 设置里的**安全区**（改邮箱/口令/设备列表）在这轮仍是 `SyncBar` 的既有形态 ——
  SaaSUI 那条调研给了更远的目标（会话/设备可见、危险动作独立分区），
  **登记为独立轮**，不塞进排版轮（同 §4.1 页9 的处置）。

---

## 7. 🔴 Windows 端"四端重装"的真缺陷（2026-09-30，做探针同步时抓到）

**事实（三条，都可复核）**：

1. `C:\src\heyta` 是 **Sep 28** 的旧树（`MainWindow.xaml.cs` 2384 B vs 本地 3086 B；
   `apps/web/dist/index.html` 是 Sep 27）。而 `reinstall-all.sh` 只调
   `package-msix.sh`（远端**就地**构建）—— **没有任何同步步骤**。
2. 打包脚本**从不把 `apps/web/dist` 放进包**（`package-msix.ps1` 里 `web-dist` 0 处），
   而壳只从 exe 旁边的 `web-dist` 找共享 UI ⇒ 装出来的应用**没有真界面**。
3. 应用默认 `_webMode = "shell"` ⇒ 即使有 web-dist 也加载 `?shell=1` 的通道试验页。
   `dist/windows/packaged-first-run.png` 里那三行「M2-B 真数据 1/2/3」就是它。

**合起来**：`pnpm reinstall:all` 报的 "Windows ✅" 装的是**两天前的源码 + 通道试验页**，
而判据只有 `ADD_APPX=OK` + `RESULT=OK`（装上、开窗、非空白截图）—— 全绿。

**修法（已落地）**：

- `reinstall-all.sh` 新增 `sync_windows_sources()`：把**当前工作树**
  （`git ls-files` + 未跟踪非忽略 + 显式 `apps/web/dist`，被删的跟踪文件过滤掉）
  打成 tar（实测 11 MB）→ scp → **覆盖式**解包（不删远端 node_modules）→
  **新鲜度对账**（`apps/web/dist/index.html` 的 sha256 本地/远端必须一致，
  不一致**拒绝打包**）。`bash -n` 过，实跑同步+对账通过。
- `package-msix.ps1` 新增 `=== 1b. web-dist`：缺 `apps/web/dist/index.html` 直接
  `RESULT=WEB_DIST_MISSING` 退出；否则拷成 exe 旁边的 `web-dist` 并报文件数。
- `MainWindow.xaml.cs`：`_webMode` 默认值改成**看有没有 web-dist**
  （有 ⇒ `app`）。spike 场景显式设 `HEYTA_WEB_MODE=shell`，行为不变。
- `install-and-capture.ps1`：新增 `PAYLOAD_WEBDIST` 断言 + **等壳自己的 `M2D=` 判据**
  （打包态 `LocalApplicationData` 被重定向到包 `LocalCache`，按 `PackageFamilyName`
  拼路径，最长 30s）→ 判据落地**之后**才截图（那时菜单开着，图里就能看见身份菜单）。
- `reinstall-all.sh` 的 Windows 判据从两条变**四条**：`ADD_APPX=OK` + `RESULT=OK`
  + `PAYLOAD_WEBDIST=True` + `M2D=OK`。

⚠️ **教训（进 AGENTS §7）**：「同步」不是"打包脚本自己会做的事"。多端流程里，
**每一端都要有一条"远端/目标端的字节 = 本地当前工作树"的判据** ——
否则"装上去了"与"装对了"是两件事，而它们的外观完全一样。

**实跑结果（2026-09-30 收尾轮，`bash scripts/reinstall-all.sh --only windows`）**：

```
═══ 2. Windows：同步当前源码 → 清旧包 → 远端打包 + 安装 ═══
  ✅ 源码包  11M（跟踪 + 未跟踪 + apps/web/dist）
  ✅ 远端新鲜度对账通过（web-dist/index.html sha256=583061310a2fb3ed…）
  ✅ 远端打包 + 安装 + 启动截图完成
  ✅ 远端取证：装上的是**当前源码的真应用**，且身份菜单判据成立
  ✅ windows：已清旧包、重打、重装、有当前产物判据
```

`install-capture.txt` 四条判据全绿：`ADD_APPX=OK` · `RESULT=OK` ·
`PAYLOAD_WEBDIST=True` · `M2D=OK`（壳自己写出的 `M2D=OK` 附带证据：
`PROBE={"first":"sync-signin-entry","signin":1,"settings":1,"signout":0}`）。
截图 `dist/windows/packaged-first-run.png`（人已看）：装出来的窗口是**真 heyta**，
且**头像菜单是开着的**（探针点开的），里面正是 登录/注册 / 设置 / 统计 —— 没有原生切片、
没有「M2-B 真数据」、没有报错行。

**又踩到一条（同一轮的第二个坑，值得单独记）**：`M2D` 一度恒为 `MISSING`，
原因是**我按"MSIX 会把 LocalAppData 重定向进包 LocalCache"去读** —— 而
`runFullTrust` 的打包应用**没有**那套重定向，文件就落在
`C:\Users\<user>\AppData\Local\heyta\`。修法：两个候选路径都查，
**且启动前先把它们删掉**（否则读到上一轮的文件 = 拿旧证据冒充这一轮）。

---

## 8. Web/UIUX 逻辑审计（2026-09-30，产品负责人："再搜索一下还有什么其他 UX 逻辑跟最佳实践不相符合的"）

方法：对着 8 条规则逐面读源码（入口唯一 / 危险动作 / 可关闭性 / 焦点与键盘 /
假入口 / 反馈缺口 / 空态 / 一致性漂移），**每一条都读到了具体行**才记；
误报比漏报更贵（规则里明确写了）。完整清单与证据在下面的处置表。

### 8.1 本轮**已修**（4 条）

| # | 违规 | 事实 | 修法 |
|---|---|---|---|
| 1 | 🔴 **设置浮层没有出口** | 没 Esc、没 ✕、点空白也不关（`.ht-sheet` `inset:0` 盖满内容区）—— 唯一出路是点 rail 上别的视图；键盘/读屏用户"进得去出不来" | 新增 `closeSecondarySurface()`（Esc / ✕ / scrim 三个出口**同一个实现**）+ `.ht-sheet__close` 可见按钮（`aria-label` 走新词条 `web.shell.settings.close`）+ 打开时焦点进浮层、关闭时还给触发器 |
| 2 | 🔴 **身份动作两个入口** | 「清除凭据」在同步设置对话框里，与头像菜单的「退出登录」是同一个 `clearCredentials()`：名字不同、ghost 排在主按钮**之前**、**未登录也渲染**（纯空操作） | **撤掉对话框里那个按钮** —— 身份入口唯一的 IA 不允许第二处；删掉随之无用的词条 `web.sync.clearCredentials`。要断开 → 头像 → 退出登录 |
| 3 | 🔴 **同一视图两个名字** | 头像菜单叫「统计」（`web.shell.account.growth`），rail 叫「成长」（`web.shell.views.growth`），点下去都是 `setView('growth')`；且菜单那条**绕过功能模块开关** | 用 rail 同一条词条；新增 `growthEnabled` prop，模块关掉时**不渲染**那一条；删除重复词条 |
| 4 | 🔴 **搜索结果点了没反应** | `onOpenTask` 把 `taskId` 显式丢弃（`void taskId`），只切视图 —— 而搜索是**全库**搜，当前筛选（如「今天」）可能根本不含那条 | 新增 `openTaskFromSearch()`：筛到「全部」+ 下一帧把 `[data-testid="task-item-<id>"]` 滚进视野 |

判据：单测 `settings-sheet-ia.spec.tsx` **4 条**（新增 Esc / ✕ 两条）、
`signin-entry.spec.tsx` 8 条；真浏览器 `e2e/tests/settings-exit.spec.ts` **1 条**
（✕ 可见 + **真键盘 Esc** 关掉 + 关回原视图 + 两条路都通）与
`e2e/tests/account-menu.spec.ts` 3 条。截图（人已看）：
`e2e/test-results/settings-sheet-close.png`。

> ⚠️ Esc 必须挂**捕获阶段**（RN-web 的 `TextInput` 吞 keydown 冒泡，AGENTS §7 第 80 条）——
> jsdom 的 `window.dispatchEvent(keydown)` **绕开**那条被吞的路径，所以真浏览器那条
> 是**唯一**能证明它成立的判据。

### 8.2 已登记、**这轮不修**（10 条；要么跨端、要么是独立一轮的量）

按严重度降序。处置理由写在最后一列 —— 登记**不是**许可，是"知道欠着"。

| # | 严重度 | 违规 | 证据 | 处置 |
|---|---|---|---|---|
| 5 | 高 | 便签创建失败**静默吞掉**，且草稿被无条件清空（用户粘超长内容 → 字没了、便签没出现、没解释） | `notes/store.ts` 自己写着 `error` "必须显示出来"；`NotesView` 从不读它；共享 `NotesBoard.submit()` 先 `onAdd` 再无条件 `setDraft('')`；上限 10,000 字会 reject | **下一轮第一件**：`NotesBoard` 加 `error` 槽 + **只在成功时清草稿**（**四端共用**，要一起验） |
| 6 | 中 | 同级浮层的关闭行为漂移：同步设置对话框与 `AuthPanel` 都是 `role="dialog" aria-modal="true"`，但没 Esc、没焦点入内 | 有 Esc 的：ConflictDialog / TrashView / InboxBell / AccountMenu / 搜索 | 下一轮抽 `useModalDismiss()`（Esc + focus 入内 + 还给触发者），两处各接一次 |
| 7 | 中 | 清单/标签「删除」单击即生效、无确认、**没有找回入口**（回收站只收任务） | `OrganizerList` 的垃圾桶与行主体同尺寸；`restoreProject` 全仓不存在 | 下一轮：两段式确认或纳入回收站（**共享组件，四端一起**） |
| 8 | 中 | 便签「删除」同 7（`restoreNote` 已存在但界面从不接） | `NotesBoard` 单击 → `notes/store` 删；`note-actions.ts` 有 `restoreNote` | 与 7 同一轮（确认或撤销 toast + 把 `restoreNote` 接出来） |
| 9 | 中 | 共享 `AiPanel` 声明 `role="dialog"` 却没有任何对话框键盘行为（且它是**行内**卡片不是模态） | `packages/ui/src/ai/AiPanel.tsx`；web 侧 19 处这样渲染 | 下一轮改成 `role="group"/region` + `aria-label`（**共享层，四端**） |
| 10 | 中 | `WidgetPushPanel` 权限被拒后整块消失，而"被拒"那句说明**永远渲染不到**（死代码） | `if (visibility !== 'shown') return null` 早于 `denied` note 行 | 下一轮：让 `denied` 成为一种 `shown`（只渲染说明行） |
| 11 | 中 | 「恢复默认（全部关闭）」是破坏性动作，却 ghost、与常规项同分量、无确认（会清端点/路由/授权/记忆） | `AiSettings.tsx` 的 reset 分支 | 下一轮：移入分隔的 danger 区 + 二次确认（说清会丢什么） |
| 12 | 中 | 任务类动作失败**没有任何反馈**；`tasks/store.ts` 的 `error` 字段是死的；`CalendarView` 有一句注释与事实相反 | `error` 全文件无写入无读取；`void store.deleteTask(...)` | 下一轮：store 写 `error` + 任务视图顶部一行 `role="alert"`；顺手改掉那句错注释 |
| 13 | 低 | rail 与通知面板的 `role="tablist"` 没有方向键漫游（APG 要求） | 两处只有 `onClick` | 下一轮：抄 `AccountMenu` 已有的 roving focus 实现 |
| 14 | 低 | 空态三份实现（`App.tsx` 自己一套、`NotesBoard` 手写第三套） | `check-empty-state.mjs` 自己就把 App.tsx 记为"待转发（是债不是许可）" | 下一轮：都收成 `<EmptyState/>` 薄转发（保留 testID，否则 e2e 钩子失效） |

### 8.3 审计同时确认**已经是对的**（抽样，避免"因为没提所以不知道"）

头像菜单的退出登录（危险色 + 永远最后 + 未登录不渲染 + 键盘齐）· 回收站彻底删除
（两段式确认 + 焦点入内 + Esc + ✕）· 通知权限三态各自说清、被拒后**不给**按钮 ·
同步的可点性（`syncing` 时禁用；未配置时点出整句解释而不是静默 no-op）·
任务/便签/回收站空态都有下一步提示 · 行内编辑用原生 `<select>/<checkbox>` + 逐条
`aria-label` + 就地 `role="alert"` · 象限拖放有键盘替身 · 帮助面板**刻意不做**
PWA 里必然无事发生的「检查更新」· 记忆面板「忘掉」不加确认（可逆，有恢复区）。

## 9. 🔴 2026-10-06 复诊：顶栏瘦身 + 列结构与把手（产品负责人看着真界面提的六条）

> 起因（原话）：「现在的 AI 是没有学过 UX 设计吗？」+ 一张顶栏动作区的裁切图。
> 六条里有两条**核对后不成立**（见 9.1 的 ⚠️），一条是**已在别处交付过、只是没铺到这一条缝**，
> 一条**反转负责人自己 10-01 定过的裁决**。逐条先取现量再动手，理由同 §8 开头那句：
> **"看起来不对"和"确实不对"要用文件行号分开**。

### 9.1 六条的现量与裁决

| # | 提法 | 现量 | 裁决 |
|---|---|---|---|
| 1 | 同步该在左 rail 底部 | `SyncBar` 挂在页头动作区（`App.tsx:2139`，样式 `main-area.css:54`）；rail 下段现在只有回收站 + 铃铛 + 帮助（`view-tabs.ts:263`、`App.tsx:1951/1961`），rail 内**零同步 affordance**（`rail.css` 里 `sync` 命中 0）。而 `view-tabs.ts:196-198` 记录的滴答 rail 下段正是「同步 / 通知 / 帮助」 | ✅ **做**（H9）。这是**没对齐**，不是反转裁决 |
| 2 | 设置应该点头像才出来 | ⚠️ **已经是这样**：设置只在头像菜单（`view-tabs.ts:250-265`，2026-09-29 收进去），判据 `settings-sheet-ia.spec.tsx:69`，`App.tsx:1958` 还写着"不做第三个设置入口"。页头那颗齿轮是 **`SyncBar` 的「同步设置」对话框**（`SyncBar.tsx:237`，`apps/web/tests/signin-entry.spec.tsx:152` 原文就这么记），不是应用设置 | ❌ 不改入口。但"它长得像全局设置"这条**成立** —— 病根是同步整组挤在页头，随 #1 一起下移后歧义自然消失 |
| 3 | 语言应该在设置里 | 顶栏语言是**文档化裁决**：`docs/plans/i18n-multilingual.md:735-777`（2026-10-01、10-03 两次形态变更，理由"顶栏的控件必须自己说明自己是什么"），`LanguageSwitcher.tsx:5` 称它是"真实用户唯一能切到英文的入口"；钉它的判据 4 份：`apps/web/tests/language-switcher.spec.tsx:164`、`e2e/lang-shots/language-switcher.spec.ts:99-108`（用例名即"顶栏语言入口只有一个"，断言 `closest('.ht-header__actions')`）、`e2e/tests/language-first-launch.spec.ts:40`、`e2e/tests/detail-pane-collapse.spec.ts:245-306`（T5：页头控件不许被压扁） | ✅ **做**（H9），并**同时改掉那 4 份判据与那份计划**——负责人这次的话读成改主意。⚠️ 不许只改界面留两套状态（AGENTS §8 第 8 条） |
| 4 | 这一排按钮太丑 | 三个具体成因：图标控件与带文字控件混排（齿轮/刷新无文字，「未同步」有文字）；分段控件的白底描边在浅灰页头上像未完成的调试条；六枚等间距平铺无分组 | ✅ 随 #1/#3 收拢后自然消失；**不单独"美化"**（没有判据的审美改动只会漂） |
| 5 | 「数据侧边栏和那个侧边栏，哪有这么排版的」 | 中间那一列**只在两个视图存在**（`App.tsx:1982` 仅 `tasks`、`:2037` 仅 `calendar`），习惯/时间线/便签/回收站/设置**没有范围列**，主区从 rail 直接铺满 ⇒ 只有一条习惯时是 900px 空白 + 固定详情窗格。截图里 rail 右边那条淡淡的「习惯」**不是**空列，是 rail 的 hover 名字（`inbox.css:457-499`，只在悬停/键盘聚焦时出现，鼠标当时停在那格） | 🟡 **这是 IA 决定，不是缺陷** ⇒ 单开 H10，先出对比图再拍（它牵动所有视图，不做成"顺手改"） |
| 6 | 详情栏那条线应该能拖宽 | 把手**已存在**：`features/shell/SidebarResizer.tsx`（`role="separator"`、`col-resize`、宽度存 `localStorage['heyta.sidebarWidth']`、双击复位、方向键），挂在 `App.tsx:2032` 与 `CalendarSidebar.tsx:499`，出处是负责人 2026-09-30 自己提的要求。**缺的只有列表列↔详情窗格那一条**，且它登记在 `docs/plans/detail-pane-alignment.md` W2（原话"别以为已经能拖"） | ✅ **做**（H10 前半）：把 `SidebarResizer` 参数化（方向相反、另一枚 localStorage 键、同一套键盘行为），不另写一份 |

### 9.2 落地切法（两单，各自带判据与截图）

**H9 顶栏瘦身**
1. rail 底部新增「同步」一枚：**点击 = 立即同步**（高频动作不加层数），图标上挂状态点
   （未配置 / 未同步 / 同步中 / 已同步 / 失败 / **有冲突**）。`aria-label` 念出当前状态。
2. 🔴 有冲突时那枚的点击语义**改成打开冲突对话框**而不是同步 —— 保住 `SyncBar.tsx:196`
   那条原意（"冲突需要一个看得见的入口，关掉之后还得能再打开"），又不给高频动作加层数。
3. ✅ **已落（2026-10-06 17:1x，见 §9.8）** 页头整块 `SyncBar` 撤掉。「同步设置」的表单复用现有对话框内容，挂进 **设置 → 同步**（新增一节）；
   「查看帮助」（仅 error 态）跟着进那一节。⚠️ 顺带把 §8.2 登记的 **第 6 条**（同步设置对话框没 Esc /
   焦点不入内）一起解掉 —— 它搬进设置面之后就不是同级浮层了。
4. 语言分段控件从页头撤，进 **设置 → 外观与语言**；`i18n-multilingual.md` 那两节改写成现在的形态，
   4 份判据逐份改（**不许删**：改成"设置里有且只有一处语言入口" + "页头不许出现语言"）。
5. 新判据（存在性，防"下一批又加回来"）：e2e 一条 —— **页头动作区里不许出现 同步 / 语言 / 齿轮**；
   rail 底部那枚存在、可点、`aria-label` 含状态词；设置里能读到「同步」与「外观与语言」两节。

**H10 列结构与把手**
1. 列表列 ↔ 详情窗格加把手（`SidebarResizer` 参数化：方向、存储键、双击复位、方向键）。
   判据：拖之后宽度变化且**刷新后仍在**；把手本身在两列之间（不越界、不压页头）。
2. 范围列要不要给习惯/时间线补 —— ✅ **对比图已出**（`apps/web/evidence/scope-column-compare/`，
   四张 + 一份 README 写明哪两张是临时变体、怎么拍的、看图得到的三条读数）。本单的建议是**不补**，
   等负责人看那四张拍板；不自行决定这一条仍然有效。

⚠️ 边界（写在这里免得被读成已做）：本节**只是决定与切法**，H9/H10 的读数（真浏览器截图 + 人看过 +
`pnpm check` 相关门禁）落地时回填；§9.1 那张表的"现量"是**代码位置**的现量，不是**改完之后**的读数。

### 9.3 H9 第一刀的落地与读数（2026-10-06）

**这一刀做了什么**：同步整组从页头搬进 rail 下段末尾（`SyncBar.tsx` 的返回根从状态条改成
`.ht-rail__sync` 那一列；`App.tsx` 里 `<SyncBar/>` 从 `.ht-header__actions` 挪到 `rail-help` 之后）。
**没做的两件事先写清楚**：① 语言分段控件**仍在页头**（§9.2 第 4 步未动）；② 「同步设置」仍是
**对话框**、入口是 rail 那枚齿轮（§9.2 第 3 步"搬进设置 → 同步"未动）——
所以"它长得像全局设置"那个歧义**还在**，这一刀没有解掉它。

🔴 **这一刀真正查出来的缺陷不是"搬家没搬好"，是一条从来没成立的护栏**：

`.ht-app` 用的是 `min-height: 100dvh`（`base.css:31`），网格行是 `auto` ⇒ rail 的盒子高度
**等于它自己的内容高度**。于是 `.ht-rail { overflow-y: auto }` 那条（注释写着"视图多起来时
**自身滚动**，而不是把 main 挤走"）**永远没有可裁的东西** —— 它是一个看起来存在、实际不存在的
滚动区。后果在同步组下移之前就已经在（下段本来就贴着内容尾巴），只是**从来没人为"下段够不够得着"
写过判据**，所以没人看见。

| 读数（1280×720，`vite preview` :4371） | 改前 | 改后 |
|---|---|---|
| 通知（铃铛） | y=644..688 | 视口内 |
| 帮助 | y=700..744 ⇒ **底边掉出视口** | 视口内 |
| 同步那一枚 | 底边 y=800 | 视口内 |
| 同步设置（齿轮） | 底边 ≈856 | 视口内 |

修法两条一起（缺一条就回到上面那个形状），落在 `inbox.css` 的 `.ht-rail` / `.ht-rail__tabs`
与 `narrow.css` 的收回：`block-size: 100dvh` 给一个与视口同源的上界；`overflow: hidden` 把裁切
留在 rail，**滚动让给 `.ht-rail__tabs`**（放不下的是视图列表，不是下段的动作）。
这与 `.ht-app__detail`（`base.css:76-80`）、`.ht-sidebar--calendar` 已经是同一条纪律：
**每一栏各自一屏封顶、内部滚动**。
🔴 这与 `narrow.css:9-12` 那段塌缩态纪律（"高度必须**钉死**在视口，不是 `min-height`"）
是**同一条规律的两半** —— 当初只钉了 ≤768px 那一档，桌面档留着 `min-height`。

🔴 **中途走过一步错路，记下来挡后来者**：为了让下段在整页滚动时也常驻，我给 `.ht-rail`
先加过 `position: sticky; top: 0`。`pnpm check:ai-e2e` 头两条就红 ——
`admin-console.spec.ts` 点头像菜单里的「设置」被 `.ht-sidebar` 拦下
（`intercepts pointer events`，重试 114 次到 60s 超时）。机制是 **sticky 造层叠上下文**：
面板那枚全场最高的 `--ht-z-popover` 从此只在 rail 内部比大小，而 rail 在根上下文里是
`z-index: auto`、DOM 又排在 `.ht-sidebar` 前面 ⇒ 整块面板被那一列盖住。
`position: fixed` 让后代逃得掉**裁剪**，逃不掉**层叠上下文** —— 这两件事容易被当成一件。
已撤掉，代价如实记在这里：主列比视口高时整页会滚，rail 跟着滚上去（与详情栏同一行为）。
入档：环境陷阱 **#352**（`min-height` 之下 `overflow-y: auto` 是空护栏）、
**#353**（sticky 关住 fixed 后代的高 z）、**#354**（kill 包装 pid 之后 4318/4319 仍被孤儿占着，
下一条命令以"already used"失败，而那长得像配置错）。

**判据侧的两处补强**（`e2e/tests/shell-sync-rail.spec.ts` S2）：

1. 第一版只量了同步那一枚，于是它红的时候我把它读成"差一点，挪挪间距就行" —— 真相是**整组**
   都在折叠线以下。现在**下段逐枚**量顶边/底边（失败信息里带上已量到的每一枚读数），
   这一条同时挡掉"只把同步救回来、把齿轮留在折叠线下"。
2. 只断言"下段可见"的话，把 `.ht-rail` 改成 `overflow: hidden` 而**不给上段滚动区**也会全绿 ——
   那等于把视图列表裁掉，比够不着更糟。所以加另一半：上段 `scrollHeight > clientHeight` 时
   `overflow-y` 必须是 `auto|scroll`。

**状态点的锚**：点原来挂在**按钮**角上（44×48 的角），16px 图标居中 ⇒ 点与图标差着十几像素，
裁图里读起来是"rail 上多了一颗孤立的点"。现在给图标套一层定位容器
（`.ht-rail__sync__icon`），点 `translate(50%, -50%)` 骑在图标右上角 ——
这正是 `.ht-inbox__badge` 那段注释为"按钮再变窄"预留的那个解法，这里提前用上了。

| 门禁/读数 | 结果 |
|---|---|
| `../apps/web/node_modules/.bin/tsc --noEmit -p tsconfig.detail-pane.json` | RC=0（并把 `rail-trash-anchor.spec.ts` 点名加进这份载体：本单改了它，而 `e2e/` 没有别的类型检查通道） |
| `pnpm check:design` | ✅ 无硬编码设计变量 |
| `pnpm --filter @heyta/web build` | RC=0（preview 载体的前提） |
| `e2e/tests/shell-sync-rail.spec.ts` | **3 passed**（S1 页头反向存在性 / S2 下段逐枚在视口内 + 上段可滚 / S3 齿轮开对话框且里面有共享状态条） |
| `e2e/tests/rail-trash-anchor.spec.ts` | **1 passed**。④ 原来量「帮助」底边，是因为写它时帮助是下段**末位**；现在末位换成同步那一组，判据跟着换成末位（**没有放松阈值**） |
| 图 | `apps/web/evidence/shell-sync-rail/rail-sync-button.png`（整页）+ `rail-bottom-group.png`（裁 128×300 的下段放大图，**两张都人打开看过**）—— 整页图里 64px 那一列**看不清任何一枚**，所以补了裁图；第一版裁图就是它照出"孤立的点"的 |

**sticky 那一步错路的读数**（同一批，逐条留形）：加 sticky 之后 `check:ai-e2e` 前两条即红
（`account-menu.spec.ts:57` 与 `admin-console.spec.ts:756`，报错都是
`<nav class="ht-sidebar"> intercepts pointer events`）；撤掉 sticky、只留
`block-size: 100dvh` + `overflow: hidden` 之后，
`account-menu` + `admin-console` + `rail-trash-anchor` + `narrow-sweep` 四份
**23 passed (2.7m)**，`shell-sync-rail` 重跑 **3 passed**。

⚠️ 待回填：变异臂（把 `.ht-rail__tabs` 的 `overflow-y` 改回 `hidden` ⇒ 上面第 2 条必须红）、
`pnpm check:ai-e2e` 全量（rail 高度改了外壳，回归面不止这一族）、
以及 §9.2 第 3/4 步（同步设置进设置、语言进设置）与那 4 份语言判据。

### 9.4 这一刀之后仍然开着的三格（不包装成完成）

1. **外壳整页仍会滚**：主列比视口高时（后台、设置、长列表），rail 与详情栏一起滚上去，
   "同步常驻左下角"只在**未滚动**时成立。
   ⚠️ **状态更新（10-06 11:5x）**：这一条的**侧栏那一半已经随 §9.5 落地**（那一列现在有界、自己滚），
   剩下的正是这里写的"外壳钉死 + `.ht-main` 自己滚"那一半 —— 它仍按本节原来的裁决**单独一单**。要做成"外壳不滚、每栏各自滚"，
   桌面档得照塌缩态那一版做（`narrow.css:9-22`：钉死 `height: 100dvh` + `.ht-main { overflow-y: auto }`）。
   牵动 `calendar-wheel` / `quadrant-fill` / `search-overlay` 三份用窗口滚动的用例，
   以及所有"量元素底边"的判据的参照系 ⇒ **单独一单**，不夹在 H9 里顺手做。
   🔴 顺带把这一档的**算术**写清楚，因为它决定"左下角常驻"在 720p 上能做到什么程度。
   **先记一次我自己差点写错的账**：无障碍树里那一列有 11 枚视图 tab
   （任务/日历/四象限/习惯/时间线/番茄钟/成长/便签/倒数纪念日/搜索/回收站），
   我第一版把它读成"关掉的模块仍然在 DOM 里，那条既有裁决是假的"—— **错了**：
   e2e 那套 helper 是**故意把全部模块打开**的（`e2e/tests/helpers.ts:127`，
   写进 `heyta.shell.modules` 的显式覆盖），所以 11 枚是**全开的最坏档**，不是默认档。
   按默认关四个（番茄钟 / 成长 / 便签 / 倒数纪念日 W5 那枚 `defaultOn: false`）算，
   上段是 7 枚 ≈ 306px，加头像与下段 4 枚 ≈ 590px ⇒ **默认档在 1280×720 放得下，不需要滚**。
   44px 是**可访问性硬下限**（`--ht-touch-target-min`，`inbox.css` 里明写"不许动"），
   所以"全开 + 720p"这一档**结构上放不下**，裁的只能是上段（它会滚），
   代价是**回收站与最后一两枚视图要滚一下才看到**。要连这一档都不滚，只有两条路，都不在这一刀里：
   ① 上段按模块开关收（默认档已经收，全开档是**用户自己**选择要这么多视图）；
   ② §9.1 第 5 行那条 IA 决定（H10：范围列要不要给习惯/时间线补）——
   视图数量本身才是这一列高度的来源。


2. **「同步设置」仍是对话框**，入口是 rail 那枚齿轮 —— 于是 §9.1 第 2 行"它长得像全局设置"
   那个歧义**没有被这一刀解掉**（我在 §9.1 写的裁决是"随 #1 下移后自然消失"，
   现量是**没有消失**：齿轮还在，只是从页头挪到了 rail 末尾）。真正的解法是 §9.2 第 3 步
   （进 设置 → 同步 一节，rail 齿轮随之删除）。
3. **语言分段控件仍在页头**（§9.2 第 4 步未动）。它要同时改 4 份判据与
   `i18n-multilingual.md` 那两节，不能只改界面留两套状态。
   ✅ **状态更新（10-06 12:4x）：这一条随 §9.6 落地** —— 下面那张施工清单是当时的现量，
   逐条怎么做的、读数、以及**那一格没做到的**（语言中立字形标记）都记在 §9.6。
   🔴 **施工清单（现量过一遍才写的，下一位可以直接照做）**：
   · **落点**：设置浮层里那一节"显示"（`App.tsx:2607`，标题词条 `web.settings.display.title`，
     现在里面已经有详情列的 展开/收起 两档）—— 把 `<LanguageSwitcher/>` 与页头那颗
     主题按钮（`App.tsx` 页头那一排里 `{theme === 'light' ? <Moon/> : <Sun/>}` 那一枚）
     **一起**搬进去。只搬语言不搬主题会把那一对拆开：
     `apps/web/tests/language-switcher.spec.tsx` 现在钉的就是"与主题切换**并列**"。
   · **要改的 4 份判据**（逐份改，不许删）：
     ① `apps/web/tests/language-switcher.spec.tsx:164` 的 `closest('.ht-header__actions')`
        ⇒ 改成"在设置那一节里"；`toHaveLength(1)` 那半句**保留**（它钉的是"同一个动作
        两个入口"，与位置无关）；
     ② `e2e/lang-shots/language-switcher.spec.ts:99-108`（用例名即"顶栏语言入口只有一个"）
        ⇒ 名字与位置判据一起改，否则**用例名会替一个已经不成立的形状说话**；
     ③ `e2e/tests/language-first-launch.spec.ts:40` —— 🔴 这一份是**最容易踩的**：
        它拿 `language-option-en` 当"应用起来了"的**语言中立锚点**
        （文件里明写：不能用中文 placeholder，也不能改用英文 placeholder —— 那等于把
        i18n 文案抄进测试，抄件一定会漂）。语言搬进设置之后，"打开设置之前"就没有这个锚了。
        ✅ 换成 rail 那两枚常驻 testID（`sync-rail` / `rail-help`）—— 它们不随语言变、
        不随视图变，是这一刀顺手补上的**新载体**；
     ④ `e2e/tests/detail-pane-collapse.spec.ts` 的 T5（页头那一排不许被顶出视口）——
        搬走两枚控件之后它的**前提变松**了，但判据本身仍然有效（`detail-pane-toggle` 还在页头），
        ⚠️ 只改注释里那句"往里加一格就可能顶出去"的例子，别把阈值放松。
   · **反向存在性判据**（与 S1 同一条立场，防"下一批又加回来"）：页头动作区里
     不许出现 语言分组 与 主题按钮。
   · 文档：`docs/plans/i18n-multilingual.md:735-777`（2026-10-01 / 10-03 两次形态变更的原文）
     要改写成现在的形态并**保留为什么当初放顶栏**那一段 —— 它原来的理由
     （"顶栏的控件必须自己说明自己是什么"、以及"这是真实用户唯一能切到英文的入口"）
     在搬进设置之后**部分仍然成立**：一个读不懂当前界面语言的人要能在设置里认出那一格，
     所以那一节的标题要带可见的"文/A"这类字形而不是纯文字。⚠️ 这一条没做到就是**把可发现性
     换成了整洁**，别让它悄悄发生。






### 9.5 H9 第二刀的落地与读数（2026-10-06 11:2x–11:5x）

B94 揭出的那条旧缺陷（一栏收起 52px ⇒ 整篇文档矮 52px ⇒ `scrollY` 被夹 ⇒ 主区那一行在**静止的指针底下**跳
⇒ 第一下点击白点）修掉了，但**只修侧栏那一列**：形状照日历线已经踩过的 `.ht-sidebar--calendar`
（列自己 `position: sticky` + `inset-block-start: 0` + `max-block-size: 100dvh`，滚动交给里面那一层
`.ht-sidebar__body`），而 `<SidebarResizer/>` **留在滚动层外面** —— 在里面会被 `overflow-x: clip`
裁掉那 4px 骑在右边缘之外的命中带（日历线写下的第二条后果，臂 B 就是它的证据）。

| 门禁/读数 | 结果 |
|---|---|
| `tsc --noEmit -p tsconfig.detail-pane.json`（e2e 的类型载体） | RC=0 |
| `e2e/tests/shell-sidebar-height.spec.ts` | **2 passed**（X1 真手势；X2 把手几何） |
| 牙齿台 `tmp/h7-readings/h9-sidebar-teeth-arm.sh` | `ARM_RED_OK=A-unbounded-sidebar`（只拿掉 `max-block-size` ⇒ 红在**症状**那条「第一下点击没打开」，X2 绿）／`ARM_RED_OK=B-wrong-scroll-host`（在列上直接写 `overflow-y: auto` ⇒ 红在**「命中带被祖先裁掉」**，X1 绿）／`BACK_TO_CLEAN=OK`／`SIDE_TEETH_FAILS=0` |
| B94 §4 的收口判据（那两枚红要自己变绿） | `detail-pane-task` + `task-organize` + 本单两份 = **19 passed，RC=0**（同一趟、同一载体） |
| `check:design` | ✅ 无硬编码设计变量 |
| 图 | `apps/web/evidence/shell-sidebar-height/{before-first-click,after-first-click,resizer-hit-box}.png`，**三张都打开看过** |

🔴 **这一刀真正的产出是夹具上的两条**（细节入档 traps **#355**）：
① 第一版臂台里，坏形态**没有**让"第一下点击"那条红 —— 因为夹具只建了 1 条任务，页面不滚，
`scrollY` 恒 0，那一跳**结构上不可能发生**。现在触发条件本身是三条断言（`docH > vh`、
`scrollY` 停在最大值、内联表单 `aria-expanded="true"`），夹具改成"8 条清单撑高侧栏 + 8 条任务撑高主区"。
② 机制快照取在 `mouse.down()` 与 `mouse.up()` **之间**：取在 `up` 之后，编辑器自己撑高会和"收起 52px"混成同一格。
③ 顺带更正 B94 §3 的归因：收起挂在**面板外的捕获 `pointerdown`** 上（`ProjectsPanel.tsx:107-128` 那段注释
连"为什么不能挂 `blur`"都写了），不是"失焦"—— 探针读到的焦点变化只是伴随事实，而**错归因直接错到了夹具上**。

**本节 §9.4 第 1 条的状态**：只完成了侧栏那一半。`.ht-app` 仍是 `min-height: 100dvh`、`.ht-main` 仍不自己滚 ⇒
**外壳整页滚这件事没变**，rail 与详情栏仍会跟着滚上去。看图时顺手记下一条给那条：最靠下那一行的整理编辑器
**朝下弹**，底边掉到折叠线以下（`after-first-click.png` 里"清单"那一格被切一半）。今天它靠整页滚还够得着，
而 §9.4 第 1 条落地之后那一档会变成**够不着** ⇒ 那条单做的时候必须一并处理浮层的弹出方向。

⚠️ 台账卫生（不是本单的活，登记给下一位读号的人）：`docs/reference/environment-traps.md` 的工作树里
**#342 出现了两枚**（HEAD 里 0 枚 ⇒ 两枚都来自未提交那批），而 ~~**#344–#351 是空号**~~、
#326–#343 物理上排在 #352–#355 之前。拿裸号去读正文前先确认是哪一批。

> 🔴 **2026-10-06 18:0x 现量更正（写这句的人当时读的是那天的工作树）**：
> **#344–#359 早就入库了**（`git show HEAD:… | grep -oE '^[0-9]{2,3}\. '` 的最大号是 **359**），
> 所以"空号"那一半已经不成立。仍然成立的两半：① **#322–#343 至今只活在未提交那批里**
> （HEAD 里 #321 之后直接跳到 #344），② **#342 在工作树里仍是两枚**。
> 复量（别抄这一行的结论，跑它）：
> `git show HEAD:docs/reference/environment-traps.md | grep -oE '^[0-9]{2,3}\. ' | tr -d '. ' | sort -n | uniq | tail -1`
> 与 `grep -oE '^[0-9]{2,3}\. ' docs/reference/environment-traps.md | tr -d '. ' | sort -n | uniq -d`
> —— 后者今天读出 `342`。⇒ 谁补 #322–#343 那一批，收尾时必须顺手把重复的那一枚改号并跟着改引用
> （`check:adr-numbering` 只钉 ADR，**traps 的号没有任何同构门禁** ⇒ "同号两枚"可以从工作树
> 一路进 HEAD 而不让任何东西变红。这一条与 §7 元规则 2 同族：不能失败的检查没有价值。）

### 9.6 H9 第三刀的落地与读数（2026-10-06 12:0x–12:4x）

§9.4 第 3 条那张施工清单逐条照做完：`<LanguageSwitcher/>` 与页头那颗主题按钮**一起**搬进
设置浮层「显示」那一节（`data-testid="display-pref-panel"`，详情视图 radiogroup 之后），
类名族 `ht-header__lang*` → `ht-settings__lang*`，样式块从 `main-area.css` 整块搬进
`ai-panels.css` 里 `.ht-settings__*` 那一片的邻居 —— **复用既有顶层族**，
因为 `check:row-single-source` 的 `HT_FAMILY_BASELINE` 余量为 0，新开一族必红。
两条说明词条（`web.settings.display.langNote` / `.themeNote`）中英同步。

| 门禁/读数 | 结果 |
|---|---|
| `pnpm --filter @heyta/web typecheck` | RC=0 |
| `pnpm --filter @heyta/web test` | **1998 passed \| 13 skipped**（150 文件） |
| `pnpm --filter @heyta/i18n test` | 26 passed |
| `check:ui-language` | RC=0，zh **3254** / en **3254**（逐键对账相等） |
| `check:layering` / `check:design` | RC=0 / 无硬编码设计变量 |
| e2e 类型载体 `tsc --noEmit -p tsconfig.detail-pane.json` | RC=0（本单把 6 份 spec 点名加进 include：`shell-sidebar-height` `theme-switch-contrast` `language-first-launch` `calendar-day-en` `inbox-dida` `ai-assistant`；**没有**加 `countdown-export`/`task-row-touch-target`/`calendar-cells` —— 那三份带着别的线的 3+1+1 条既有错误，通配会把别人的红算进本单） |
| e2e 第一批（本单直接命中的） | `language-first-launch` **5 passed**；另 15/16 → 修完复跑绿 |
| e2e 第二批（14 份含 `shell-sync-rail`/`shell-sidebar-height`/`rail-trash-anchor`/`account-menu`/`settings-exit`/`admin-console`/`detail-pane-collapse`/习惯族/`calendar-cells`/`countdown-export`/`task-row-touch-target`） | **66 passed，RC=0** |
| 取证载体 `HEYTA_LANG_TAG=h9c` | **4 passed / 18 张图** |
| 图 | 人打开看了 `h9c-lang-zh-CN-light-1280-display.png`、`h9c-lang-en-dark-660-display.png`、`h9c-lang-en-light-1280.png` |

🔴 **看图抓到的那一格，不是断言抓到的**：主题按钮在列向 flex 的分区里被 `stretch` 拉成一条整宽横条
（`h9c-lang-en-dark-660-display.png` 里那条"切换到亮色主题"占满整行）。补
`.ht-settings__theme-toggle { align-self: flex-start; }` 后复跑再看。
这是本仓第 **三** 次"15 条断言全绿的截图里界面是错的"（前两次见 §8 与 §9.5）——
判据写的是"按钮存在且可点"，它天然回答不了"它长什么样"。

**清单里那四份判据的落地方式**（都改了，没删）：
① `language-switcher.spec.tsx` 位置判据改成**两头钉** ——
`closest('[data-testid="display-pref-panel"]')` 命中 **且** `closest('.ht-header__actions')` 为 `null`；
只钉前一半时"搬过去"和"两处都留着"读起来完全一样。
② `e2e/lang-shots` 那份的用例名与位置判据一起改，并把特写目标从 `.ht-header__actions` 换成
`display-pref-panel`（否则那张特写图从此对着一个空的页头）。
③ `language-first-launch` 的语言中立锚点换成 `rail-help`（清单里预想的方案，实测成立）。
④ `detail-pane-collapse` T5 只改注释里的例子，阈值未动。
反向存在性判据加了：页头动作区里既没有语言分组也没有主题按钮（jsdom 与 e2e 各一份）。

🔴 **一条只在改判据时才现形的机制**（入档 `BLOCKED.md` 对应条目）：设置是**条件渲染**的浮层，
它开着的时候范围列 `.ht-sidebar` **不在 DOM 里** —— 那一列只存在于有范围的视图。
于是所有原来锚在「收集箱 / Inbox」文本上的断言在"打开设置"之后**必然假红**。
本单的处置：`mountIntoSettings()` / `closeSettings()` 拆开挂载与进入设置，锚点改 `rail-help`，
`shellText()` 改成找不到范围列就**抛**（"读到了空字符串"与"界面是英文的"必须在载体上可区分）。

⚠️ **仍然开着的一格，不包装成完成**：§9.4 第 3 条要求的那枚语言中立**字形标记**（"文/A"）**没做**。
现在的识别手段是分组可见标签「语言」+ 两项各写自己的自称（`中文` / `English`，改造前就在、本轮保留）。
判断依据：设置浮层里每一节的标题都是纯文字，插一枚图标会让它成为那一面唯一的例外；
而"找不到去哪切语言"这个可发现性问题本来就属于"入口在页头"那一档，搬进设置后入口正是负责人要的位置。
⚠️ 但**它换来的代价是真的**：一个完全读不懂当前界面语言的人，此刻要先能读出「设置」两个字。
下一位若要补那枚标记，判据要跟着加（否则"补了"与"没补"在载体上同样不可区分）。

### 9.7 H10 两刀的落地与读数（2026-10-06 13:0x–15:2x）

**第一刀**做 §9.1 表里第 5、6 条：详情列**没东西可画就不占位** + 它左边缘那条线**可拖**。
**第二刀**是第一刀照出来的：那一栏在任务视图里"永远空着"不是几何问题，是**装配次序**问题 ——
2026-10-04 那句「无状态的时候就可以默认显示 AI Chatbot」从来没有生效过。两刀合起来才把负责人
那两句一起答上：栏里有了真东西，"右边凭空一格空白"就不存在了。

| 项 | 落点 |
|---|---|
| 空栏不占位 | `App.tsx` 的 `detailHasContent`（`useLayoutEffect` + `MutationObserver` 量 `childElementCount`，**不是**把那条五分支链在 JS 里重抄一遍）→ `.ht-app[data-detail-empty]` → `base.css` 里 `--ht-detail-track: 0` **并且** `display:none` |
| 把手 | `features/shell/ColumnResizer.tsx`（由 `SidebarResizer.tsx` 参数化改名而来，`git mv` 保住历史）：七个入参（`edge` / `columnSelector` / `cssVar` / `storageKey` / `min|maxToken` / `labelKey` / `className`），两个导出 `SidebarResizer`（`edge="end"`）与 `DetailColumnResizer`（`edge="start"`）。🔴 **一份实现两条列** —— 负责人那句"都可以自己调整"要的是第二枚把手，不是第二份实现（判据 D6 钉的就是模块名） |
| 把手挂哪 | `.ht-main` 的右边缘 + `.ht-main { position: relative }`。**不挂在被拖那一栏里**：详情列自己是滚动容器，绝对定位的孩子会跟内容一起滚走（滚一下就没有可拖的地方）；往槽里补一层滚动包装又被 `check:detail-pane-slot` 腿 A 判红。两条理由写在 `ColumnResizer.tsx` 文件头 |
| 可拖性看得见 | idle 不画线；hover / 拖拽中画 `--ht-color-primary` + `--ht-border-width-thick`；`:focus-visible` 有环（不 `outline:none`）。命中带 8px、其中 4px 骑到交界另一侧，且 `elementFromPoint` **反查**命中的是把手自己；触屏另钉 `touch-action: none` |
| AI 面落点 | 分支链第 4 支补 `selectedTaskId !== null` ⇒ 未选中时第 5 支（AI 面）第一次拿到那一格。落点只看 `detailColumnShown`（几何 + 用户选择），**不看** `detailHasContent` —— 后者量的正是"这一栏有没有孩子"，而孩子有没有取决于 AI 挂哪，写成那个就是自己决定自己的循环 |

🔴 **两条只有做这一刀才会现形的真缺陷**：

1. **轨道归零时那一栏以 33px 画在视口外面。** grid 子项的自动最小尺寸是 min-content，而这一列带
   `padding-inline` + `border-left` ⇒ 只把轨道设成 0 会得到 `x=1280 / width=33`、
   `documentElement.scrollWidth = 1313 > innerWidth = 1280`（1280×720 现量）。
   **这条不是本刀引入的**：`[data-detail='collapsed']` 一直是这个形状，只是它要用户主动收起才踩到，
   而"没东西可画"那一档是**默认态**，一进应用就踩。修法：轨道归零的两档都补 `display:none`。
2. **`aria-valuenow` 慢一帧。** 第一版在 render 里量宽度报给无障碍，而宽度是**写完自定义属性之后**
   才落到布局上 ⇒ 拖完念的是上一帧（351 vs 352）。改成在 `useEffect` 里、`applyWidth` 之后再量。

**判据怎么变的**（一条都没删）：

- 新写 `e2e/tests/detail-column-resize.spec.ts` 6 条：D1 空档不占位（主区吃满 + 零横向溢出 + 把手不画）、
  D2 有内容时回来且宽走 token + 把手正骑交界 + 反查命中、D3 方向 / 持久化 / 界内夹取 / 45vw 接管 /
  双击与键盘等价、D4 idle 与 hover 两张图**必须不同**、D5 收起不留 33px（第二腿在番茄钟）、
  D6 两条列共用一份实现。
- 牙齿台 `research/tools/mutation-rigs/detail-column-resize-arms.sh`：四臂逐臂红集
  `A→D1`、`B→D3,D6`、`C→D4`、`D→D5`，`BACK_TO_CLEAN=OK`。臂 D 先后被**两件事**各自挡住
  （证人选错视图、同一条声明在文件末尾还有第二份），两件都写进台架注释并入 #357。
- 三份既有 spec 只补**前提**、口径一字未动：`detail-column-slot` / `detail-pane-collapse` /
  `detail-pane-overlay` 各加 `showDetailColumnContent(page)`（helper 收在一处，六个调用点不各抄一份）。
- 🔴 两条**因本刀而必须改写**的别线判据（`detail-pane-task` T1 / T10）：它们原来把
  "宽档未选中 ⇒ 整机零只备注框 / 行上没有提醒徽标"当成裁决，而那正是第二刀要修的洞
  （行尾让位给一个**没在画东西**的栏 = 两半都没接，谁都没入口）。改写后钉的仍是同一条不变量、
  且更可检查：**输入框数 == 任务行数**，并且**栏里那一格零只输入框**；T10 把"重新选中"提到
  量徽标之前（原来那一句量的是"未选中档行尾长什么样"，不是那发 op 有没有落库）。
  代改三条齐：一子可改／运行时形状逐字现量（`Received: 1` vs `Expected: 0` 那一格）／
  `git revert` 一笔可回退。**没有**动任何阈值。

**看图抓到两格，都不是断言抓到的**（本仓同一族第 4、5 次）：

1. `d5-collapsed.png` 里拍的其实是**重新展开之后**的面单 —— 截图那行写在"再点一次开关"之后，
   而文件名声称收起态。把图挪到收起那一刻、另补一张 `d5-reexpanded.png`，两张才各自对得上名字。
   📌 **图名与图内容不符是证据链上最贵的一种坏**：下一位拿它对照判据时读不到任何异常信号。
2. `d1-empty-no-column.png` 里有一枚灰色 tooltip 压在迷你月历上 —— 那是鼠标停在 rail 那一格上
   被 `title` 叫出来的。D1/D2/D5 三处截图前漏了 `parkCursor(page)`（这一族别的 spec 都有），
   已补。判据本身没受影响，受影响的是**这张图能不能给别人看**。

**读数**（本刀范围内全部在干净态取）：

| 门禁 | 结果 |
|---|---|
| `pnpm --filter @heyta/web typecheck` | RC=0 |
| `pnpm --filter @heyta/web test` | **1998 passed / 13 skipped**（150 文件）。中途 1 枚红是 `task-detail-card.spec.tsx` 那条"栏里那一支与行尾那两支用同一枚布尔"的**源码形状**门禁 —— 它要求第三半写在布尔里而不是只写在装配处，照它改（这条门禁本刀起了作用） |
| `pnpm --filter @heyta/i18n test` | 26 passed |
| `check:design` / `check:layering` / `check:ui-language` | RC=0 / RC=0（384 文件 10 条规则）/ RC=0（词条表 zh **3255** / en **3255**） |
| `check:row-single-source` / `check:detail-pane-slot` / `check:selection-single-source` | 各 RC=0（`ht-app__detail-resizer` 复用 `ht-app` 族，基线余量 0 不许新开一族） |
| e2e 类型载体 `tsc --noEmit -p tsconfig.detail-pane.json` | RC=0（本刀点名加进 include：`detail-column-resize`、`sidebar-resize`、`ai-tool-run`） |
| `check:ai-e2e` **整族** | **276 passed / 2 skipped / 0 failed，RC=0**（13.5 分钟）—— 这一族在本仓的历史读数一直是 8–10 枚红（B90 / B94），**第一次整族绿**。取数时刻 15:2x，载体 = 本刀之后的主检出 |

🔴 **B90 那一簇 8 枚红随本刀全消**（那半是 `check:ai-e2e` 一直不可能绿的根因）：
AI 侧 4 枚（`ai-assistant:65`、`ai-row-layout:115`、`ai-tool-run:103`、`ai-tool-run:155`）
+ 整理侧 4 枚（`calendar-sidebar:111`、`calendar-sidebar:226`、`glass-materials:158` 的 light 与 dark）。
其中 `ai-tool-run` 那两枚其实是 H9 第三刀留下的断点（主题开关搬进设置浮层后，那份**本地**
`toggleTheme` 还在按可访问名找页头的按钮）—— 换成共享 `switchTheme` 就不红了。
`vault-settings:199` 同一根因、同一刀修掉（它不在 B90 的 8 枚里：那趟整链没跑到它，
而它多出的那一条 `403` 是设置浮层挂载时探 `/api/admin/overview`，已按"多一个**已命名**来源"
登记进那条 console 判据，不是放宽）。

⚠️ **仍然开着的三格，不包装成完成**：

1. 负责人第 5 条里"**数据侧边栏**和那个侧边栏哪有这么排版的"那半句：对比图**已出**
   （`apps/web/evidence/scope-column-compare/` 四张 + README），看图得到的读数是"直接搬任务那一列
   不成立"（词表是任务的；`with-timeline.png` 里时间线自己的内容整片被挤没）。
   本单建议**不补**，**等负责人看那四张拍板** —— 图与理由都在，裁决不在这笔里。
   🔴 顺带照出另一格同形状的：`as-is-habits.png` 里右栏只有一句"还没有习惯…"
   （`HabitDetailCard` 未选中仍挂载，那是 `motivation.spec` 白屏检测的前提）——
   一句提示占一整栏，要改得先给那条前提找别的证人。
2. 详情列仍然**没有无障碍名**（定名字要新词条、中英成对，不在这一笔里顺手定）。
3. 本刀**没有**在四端当前产物上验（`pnpm reinstall:all` 未跑）；`FULLCHECK-01` 那一档仍开着。

### 9.8 H9 第 3 刀的落地与读数（2026-10-06 16:2x–17:1x）

§9.2 H9 第 3 步：「同步设置」不再是**齿轮点开的同级浮层**，它是设置浮层里的**一节**。
负责人第 2 条（「设置不应该点击头像之后再打开吗？」）到这一刀才算真的答完 ——
第 1 刀之后 rail 上仍留着一颗长得像全局设置的齿轮。顺带解掉 §8.2 第 6 条那一格
（同级浮层没有 Esc、焦点进不去）：一节设置没有"关闭"这个动作，退出设置就有出口。

| 面 | 落点 | 一条读数 |
|---|---|---|
| 新节 | `apps/web/src/features/sync/SyncSettingsPanel.tsx`：`<section id="settings-sync" data-testid="sync-settings-panel">`，排在 功能模块之后、隐私/AI 之前（地址是"准不准出门"那三道闸的前提） | `settings-sync-section.png` 人已看：标题 + 说明 + 状态 + 地址 + 令牌 + 登录/注册 + 口令 + 加密数据钥匙 + 保存并同步 |
| 撤掉 | rail 那颗 `sync-settings-entry` 齿轮、同级对话框、`sync-help-link`（跟着表单进这一节）、`web.sync.settings.close` 词条（中英各一条） | 新判据 S4：齿轮 `toHaveCount(0)` + 未开设置时地址框 `toHaveCount(0)` + 开设置后 `sync-settings-panel` **恰 1 处** + 关设置后回到 0 |
| 草稿的家 | `store.ts` 的 `syncDraft` / `syncDraftShown`，由 `configure` / `applyAuthToken` / `clearCredentials` 三处镜像推进 | 理由与 `signInOpen` 同一条：`AuthPanel` 仍挂在常驻 `SyncBar`（头像那条路也要开它），而地址框现在住在设置里 —— **触发者在 A、面板在 B** |
| 请求语义 | `settingsOpen` → `syncSettingsRequested`：一次性请求，`App.tsx` 消费（切设置视图 + 落在这一节 + 立刻清） | 臂 U4：不"取到即清" ⇒ 第二次点「改用你自己的服务器」没有反应，那条判据当场红 |
| 收的债 | 三处"滚到某一节"的 boolean 拷贝（help / profile / 新增 sync）合成 `features/shell/settings-anchors.ts` 一张表 + 一条 effect | AGENTS §3.5"同形状的第三次"：第三份写出来之前先合，否则前两份开始漂移 |

🔴 **这一刀照出来的三件事**（各自有判据与臂，不是"顺手改"）：

1. **"焦点也要一起给"从来没成立过。** `sheetRef.focus()` 声明在落位 effect **之后**，
   把刚给出去的焦点抢回去；而全仓没有任何一条判据读过 `document.activeElement`。
   新判据 `apps/web/tests/settings-anchor-focus.spec.tsx` 三条 + 臂 U3（删掉 `.focus()` ⇒ 三条全红）。
   入档 **陷阱 #360**。
2. **第 1 刀删掉「立即同步」之后，四套 e2e + 一个脚本的定位符恒 0 命中六小时**，
   期间 `pnpm check` 与 `check:ai-e2e` 整族（276 passed）全绿 —— 那些目录各有各的 testDir/config，
   默认载体走不到它们。入档 **陷阱 #361**（含"改可访问名之前先列消费者清单"的现量命令）。
3. **第一版那张"同步那一节"的截图拍的是浮层顶部。** `toBeVisible()` 不要求在视口内，
   而设置是一列很长的可滚动列表 —— 判据全绿、图是错的，只有人看图发现。
   修法是补一条几何判据（顶边必须 `0 <= y < 视口高`），臂 E1 证明删掉滚动它会红。
   入档 **陷阱 #362**。

**读数**：牙齿台 `research/tools/mutation-rigs/h9-sync-settings-arms.sh` **七臂七 KILLED +
`BACK_TO_CLEAN=OK`**；`apps/web` 全量 **2002 passed / 13 skipped / 0 failed**（149 文件）；
`--filter @heyta/web typecheck` 干净；真浏览器 `shell-sync-rail` **4 passed**、
`vault-settings` **1 passed**、`profile-avatar-e2ee` **1 passed**。
台账：**B98**。

⚠️ **仍然开着的四格（B98 里逐条带跑法）**：① 那四套 e2e 只做了静态核对 + 单文件 `tsc`，
**一次都没运行**（要真服务端 / docker / 另一台设备）；② `pnpm --filter @heyta/web build`
此刻红在两处与本单无关的半截改动（`NotesView` 缺 `labels.saveFailed`、
`TaskDetailCard.tsx:192` 的 `EventTarget.value`）⇒ 本单的 e2e 证据取自 **vite dev 载体**，
不是打包产物，`-r build` 与 `check:ai-e2e` 整族要在那两处补齐之后重跑；
③ ~~落地页那张手抄复刻仍画着 H9 之前的页头（对外素材，任务 #23）~~
   ✅ **10-06 18:0x 已闭合**（见下面 §9.9）；同一趟照出的第二格（今天进度卡 10-01 就从外壳删了、
   复刻还在五屏常驻）登记成任务 #24，那条要拍板不是要动手；
④ 四端当前产物未验（`pnpm reinstall:all` 未跑）。

### 9.9 落地页复刻的页头跟着 H9 搬空（2026-10-06 17:5x–18:0x，任务 #23）

产品负责人六条推动的三刀都落在应用里，**对外素材那一半没人跟**：
`apps/landing/src/mockup/AppWindow.tsx` 的 `.mk-header__actions` 还手抄着六件产品早已没有的控件。

| 复刻页头（改前） | 产品页头（现量：剥注释后 `.ht-header__actions` 的 `data-testid` 全集） |
|---|---|
| 日期/倒计时两枚 tab + 已同步胶囊 + 立即同步 + 同步设置齿轮 + 语言两枚 + 主题 = 六件 | `task-sort` / `task-sort-select` / `detail-pane-toggle` = **两枚**（排序只在任务视图） |

🔴 **为什么 26 条展厅测试全绿**：`mockup-fidelity` 里那条判据的名字就叫
「顶栏右侧是完整的四件：同步状态 + 立即同步 + 设置 + 语言 + 主题」—— 它是**正向**要求，
不是漏测，是**要求复刻画错的东西**。而对账 `App.tsx` 源码的 `mockup-shell-shape`
逐项核了主导航/象限计数/标签区/视图 tab，**唯独没核页头右侧**。
（§7 元规则 2 的第三种面目：一条永远通过的判据比没有判据更糟 —— 这条还会主动拒绝正确的改动。）

改完的形状：登记处新增 `SHELL_HEADER_ACTIONS`（正向）与 `SHELL_HEADER_MOVED_OUT`（反向，
每件写清搬到哪/哪天/产品侧不许再出现的源码片段/复刻侧不许再出现的词条），渲染全部从登记处派生；
`mockup-shell-shape` 新增 #7 六条，承重的是**解析器阳性对照**（写死那三枚 testid）、
**双向等集**（不是子集）、**反向判据两头查 + 一条"这些串仍在 App.tsx 别处"的对照**。
🔴 剥注释是承重的：产品那段留着一句历史说明，字面写着 `<SyncBar/>` —— 不剥，判据会在产品对的那一天红。

读数：`mockup-shell-shape` 24 / `mockup-fidelity` 8 / `mockup-today-shape` 3 passed（改前 18+8）；
`apps/landing` 全量 1322 passed / **1 failed**（那 1 条是象限线在飞的 W5 改了 `quadrant/copy.ts`
的 `empty`/`footnote` 形状，归属与现量在 B99 第 2 格，本单没代改）；typecheck rc=0；
check:{design,ui-language,layering,md-tables} 各 rc=0。
真浏览器（§6.2 规定一）：`vite preview` 私有端口 + `--no-proxy-server`，**5 块 `.mk-frame`**，
任务屏页头 2 件、其余四屏 1 件、控制台零错误；明暗两版入库 `evidence/mockup-shell-1-{light,dark}.png`，
两张都打开看过。

### 9.10 工单 H11：外壳不滚（§9.4 第 1 条剩下的桌面那一半）—— 立案，未开工

原裁决就是"**单独一单**，不夹在 H9 里顺手做"（§9.4 第 1 条）。18:0x 现量了开工面，
结论是**现在不是起跑点**，把清单钉在这里免得下一个人重新推一遍：

| 项 | 现量（10-06 18:0x） |
|---|---|
| 要改的那一行 | `apps/web/src/styles/app/base.css:38` 的 `min-height: 100dvh` ⇒ 钉死 `height: 100dvh` + 行轨写 `minmax(0, 1fr)`，并给 `.ht-main` 加 `overflow-y: auto` |
| 可照的形状 | `narrow.css:41-59`（W4 那批已经把塌缩态做成"钉死 + main 内部滚"，注释里连"为什么不能是 `min-height`"都写好了）。⚠️ 那份文件**此刻正被 P0 体验整改那条线写着**（工作树 `M`） |
| 依赖窗口滚动的用例 | `calendar-wheel`（`page.mouse.wheel` ×8 + `window.scrollY` ×1）、`quadrant-fill`（`window.scrollTo` ×1）、`search-overlay`（`window.scrollTo` ×1） |
| 参照系要逐条分类的判据 | `e2e/tests/` 里 **14 个文件**含"视口底边/折叠线/`innerHeight`"类断言、**16 个文件**含"底边"量法。改完之后：rail / sidebar / 详情列的元素仍应对**视口**，而 `.ht-main` 里的元素应对 **`.ht-main` 自己的盒子** —— 混用会让一条判据在两种滚动模型下都"看起来对" |
| 硬前置 | B95 看图时记下的那条：最靠下那一行的整理编辑器**朝下弹**，底边掉到折叠线以下。今天靠整页滚还够得着，H11 落地之后那一档变成**够不着** ⇒ 弹出方向必须一并处理，不能事后补 |
| 起跑条件 | ① `pnpm -r build` 绿（否则 e2e 证据只能取自 vite dev 载体，得像 B98 那样标明）；② `narrow.css` 静默（别线提交之后）；③ 一次安静载体 —— 这一单会重跑那 14 份几何判据，负载高的读数不可归因（§9.4 那笔"两分钟窗口"的账就是这一类） |

### 9.11 18:2x 现量：起跑条件① 翻了面，②③ 没翻；顺带两条台账更正

这一节存在的理由就是 §9.10 那张表里"此刻"这两个字——它是瞬时读数，六小时后会反过来。
逐条重量（复跑命令一起写，别把读数当状态引用）：

| 条件 | 18:2x 现量 | 复跑命令 |
|---|---|---|
| ① `-r build` 绿 | ✅ **成立**（`RC=0`，主检出工作树，载体 `a649def8`）。18:0x 那格"被别人半成品挡着"已经不成立 | `pnpm -r build; echo RC=$?` |
| ② `narrow.css` 静默 | ❌ **仍不成立**：工作树 ` M apps/web/src/styles/app/narrow.css`（P0 体验整改那条线还在写） | `git status --porcelain -- apps/web/src/styles/app/narrow.css` |
| ③ 安静载体 | ❌ **仍不成立**：规范闸门报主检出 **140 枚未提交的打包输入**；整条 `pnpm check` 另外被 B90 那 9 枚 e2e 红挡着（回收线自己立案、正在修） | `bash research/tools/b-reinstall-readiness.sh`（默认 dry-run，exit 3＝环境无效不是产品失败） |

⇒ **H11 的结论不变：不是起跑点**，但挡住它的已经从"两格"变成"一格半"——②与③其实是同一件事
（别线把这 140 枚提交掉，`narrow.css` 就同时静默）。这一单**不需要**任何新的外部裁决。

📌 **顺带两条台账更正**（都是"读过一次就当成状态"那一类）：

1. **`check:md-tables` 这一格已闭合**（回收线自己提交掉的）。18:2x 现量 `node scripts/check-md-table-rows.mjs`
   ⇒ rc=0，读数"12 个文件，列数、断行、'是不是表'与格内反引号配对都一致（第四类基线 3 行，只许减）"。
   ⚠️ 我第一遍把它跑成 rc=1 是因为**探针敲错了文件名**（`check-md-tables.mjs` 不存在，
   `MODULE_NOT_FOUND` 的退出码也是 1）—— 先怀疑探针这条元规则（§7 开头第 1 条）在这一格又兑现了一次。
2. 🔴 **#17 那格查出一个门禁自己的盲区**，登记在这里而不是代改别人那枚装置：
   `scripts/check-e2e-helper-exports.mjs`（17.7 KB，18:2x 现量 rc=0，射程 120 份文件 / 对账 407 个导入名 / 缺失 0）
   **在 `package.json` 里没有任何 `check:` 定义**，而 `check:gate-wiring` 的两条判据分别遍历
   "`pkg.scripts` 里以 `check:` 开头的定义"与"链上引用的名字"——**一枚既无定义又不在链上的实现文件
   落在两者之外**，所以它绿得像"全都对上了"，实际是**零次常驻执行**。
   要接进链就得动 `check` 那一行，而那一行**此刻正被别人重写**（` M package.json`，三处新增
   `check:adr-numbering` / `check:backup-retention`）⇒ 这一格等的不是裁决，是那一行的所有权让开；
   给下一位的建议改法：让 `check:gate-wiring` 补一条"遍历 `scripts/check-*.mjs`，
   既没被任何定义引用、又不在允许表里的 ⇒ 红"，这样"写了没接"会从静默变成当场响。

### 9.12 展厅撤掉「今天进度卡」：把一条**写死的过时形状**换成从产品源码派生的判据

原始症状（工单 #24）：展厅五屏每张都常驻 `.mk-today`，而产品早就不在"做事"视图画它了。
**这不只是复刻件漂了 —— 判据本身把那个漂的形状写成了期望**：
`mockup-today-shape.spec.tsx` 里那条 `expect(today, '每个"做事"的视图上都应有今日进度卡').not.toBeNull()`
是正向断言，它保证的是"卡片一直在"，所以产品撤卡那天起，这 26 条测试就一起变成了
**为过时形状背书**的绿灯（§7 元规则 2：一条永远通过的判据比没有判据更糟）。

| 项 | 现量（10-06 18:4x） |
|---|---|
| 产品侧真形状 | `apps/web/src/App.tsx:2288-2304` 那段 R6 说明：卡从做事视图撤掉，共享组件**没删**、只住成长页（`GrowthView` → `GrowthBoard` 的 `today` 槽位）。钉住它的是 web 自己那条：`apps/web/tests/motivation-view.spec.tsx:150` 断言任务视图里 `[data-testid="today-progress"]` **为 null** |
| 撤掉的东西 | `AppWindow.tsx` 的 `<section className="mk-today">` 与文件尾那份"四视图常驻"的说明、`mockup.css` 的 `.mk-today*` 六条规则（69 行）、`showcase-data.ts` 的 `SHOWCASE_TODAY_PROGRESS`、`mockup-shell-shape.spec.tsx` 的 #6 整节（编造值自洽）、`tests/mockup-today-shape.spec.tsx` **整个文件** |
| 新判据的形状 | `mockup-fidelity.spec.tsx`：`productDraws = codeOccurrences(readWebAppSource(), 'TodayProgressCard') > 0`，再对四个做事屏断言"展厅画没画 === productDraws"。**方向由产品源码决定**，不是写死的 `toBe(false)` —— 产品哪天把卡放回做事视图，这条会反过来要求展厅跟上 |
| 判据自己的对照 | 两条：① `expect(app).toContain('TodayProgressCard')`（那个名字**确实**在 App.tsx 里，只是住在注释里）；② `expect(stripComments('/* TodayProgressCard */')).not.toContain(...)`（"剥注释"这一步真的在起作用 —— 摘掉它，方向会静默翻反） |
| 四臂读数 | 台架 `~/.heyta-window-rigs/heyta-fidelity-today-arms.py`：**A** 展厅多画一张 ⇒ 红；**B** 用注入接缝把卡放回产品做事视图而展厅没跟 ⇒ 红；**C** 摘掉剥注释 ⇒ 红；**复跑（全部还原之后）** ⇒ 绿。`ARMS=4 BAD=0` |
| 顺带收掉的一处重复 | 三枚 spec 各写一遍 `WEB_SRC` / `UI_SRC` 与 `readWeb` / `readUi`。`HEYTA_MOCKUP_WEB_SRC` 是故障注入台架的接缝，**三份定义意味着台架指过去时只重定向其中一份**，另外两份在"临时树"上读的其实是真源码 ⇒ 变异会打空而照样报绿。现在收进 `tests/helpers/source-text.ts` 一枚所有者 |
| 门禁读数 | `check:design` / `check:ui-language` / `check:md-tables` / `check:layering` / `landing check:entries` 全 rc=0；`landing typecheck`（`tsconfig.spec.json`）rc=0；`landing test` **1316 passed / 1 failed** |

⚠️ **那 1 枚红不是这一刀的**，三条腿在同一趟里量完：`mockup-quadrant-shape` 在**主检出**
（web 工作树脏）红 ⇒ 把 `HEYTA_MOCKUP_WEB_SRC` 指到干净载体 **15 passed** ⇒ 载体里 HEAD 原码
+ 干净 web 也绿。⇒ 红跟着 `apps/web/src/features/quadrant/copy.ts` 那枚未提交改动走，属**别线在飞**，
本刀不动它的判据、也不替它认下（B99 里那条"quadrant 红归因"从此有出处）。

📌 两条一般规律（这一格真正欠的）：**正向判据会把"复刻件当前画了什么"钉成"应该画什么"**——
被钉住的是历史那一刻而不是产品，所以凡是"照抄真应用"的对账判据，方向必须从真应用**读**出来。
另一条：**注入接缝（env 旋钮）本身也要有唯一所有者**，多份定义等于把"变异一定打进真在跑那份"
这个前提悄悄废掉（与 §7 第 82 条、上面 #17 那格是同一族的第三种面目）。

### 9.13 固定收尾 `reinstall:all` 在隔离载体里跑完：三端有读数、iOS 端没有，外加一枚我自己装置的缺陷

**为什么在载体里跑**：规范闸门 `research/tools/b-reinstall-readiness.sh` 对主检出报
`❌ 目标树里有 140 枚未提交的打包输入 —— 装进四端的就是别人的半成品`，并明确写
"这一条**没有**'照样跑'的旋钮，要么等所有者提交，要么传 `CARRIER=<干净载体>`"。
⇒ 载体 `~/heyta-carriers/heyta-reinstall-1006`（`git worktree add --detach` 到当时的 `a649def8`、
`pnpm install --frozen-lockfile`、被跟踪脏 0、软链来的 node_modules 0、
`@heyta/domain` 逐条 `realpath` 都落在载体内）。窗口只挡在负载那一格（16 > 12），
而那一尖峰是**我自己那趟 install** 造成的 —— 等它过去之后第 0 轮就 OPEN。

| 腿 | 读数 | 看没看 |
|---|---|---|
| mac | `PHASE_1_EXIT=0`；`.app` 里 `web-dist` 与本机同一次构建；自截屏 `内容占比 71.4% / 主蓝命中 1127` | ✅ 看过 `.webview.png`：是共享 UI（rail + 范围列 + 收集箱 + 详情列 + 首启联网同意弹窗） |
| mac 窗口那一枚 | 判据**不吃它**（只打 ⚠️ 不判红） | ✅ 看过：纯白框只有三个红绿灯 —— 与 10-05 记的形状一致，不是本轮缺陷，但也**不能**拿它当"渲染了共享 UI"的证据 |
| windows | 同步 tar `sha256` 逐字相同 + 远端新鲜度对账（`web-dist/index.html` / `bridge` / `assets/*.js` 7 枚）+ `判据齐了：5 条全在位` | ✅ 看过：**是真应用**（收集箱 + 头像菜单展开「登录 / 注册」「设置」+ 联网弹窗），10-05 那枚锁屏没复发。⚠️ 但这张取证图**右侧与底部被裁**（详情列与 rail 底部图标不在画面内）⇒ 它证"装上真应用"，不证"整屏排版对" |
| android | `release APK 64M` 重打 + `emulator-5554 全新安装成功`；`1080x2400 / 内容占比 56.7% / 主蓝命中 4001` | ✅ 看过 |
| ios | 🔴 **本轮没有读数**：`pod install` 三趟都失败 —— 第 1/2 趟是 CocoaPods #12866 的 `path name contains null byte`，第 3 趟走到更远处死在 `git clone https://github.com/facebook/hermes.git` 的 `curl 92 HTTP/2 stream … CANCEL` + `early EOF`（取 spec 仓库的网络断流）。脚本随后自己判"沙盒未同步 ⇒ 这一轮没有跑 xcodebuild" | —— 没有图可看 |

`PHASE_2_EXIT=1` ⇒ **这一轮固定收尾没做完**，不包装成"四端已装当前产物"。
补跑挂在**两道规范闸门**后面（carrier 那道 + `verify-mobile-window-gate.sh --target b` 那道），
起跑第 0 轮 device 那道报 `REDS=src,dev` —— `dev` 是别线此刻正在 `heyta-wt-merge` 里跑
`verify-mobile-ai.sh`（我第一版只挂了 carrier 那道，它只查"有没有别的 reinstall-all 在跑"，
查不到设备验收 ⇒ 已经补上；这台机器的网络环境按硬约束不动）。

🔴 **顺带查出我自己那一枚张数装置的缺陷**（值得下一位当戒律）：
`FRESH_2=2` 里**只有 1 枚属于本轮**。`/tmp/heyta-reinstall-ios.png` 的 mtime 落在本轮窗口内
（18:50:19）而 md5 与基线不同（`765e879f…` → `d0e91b4b…`）—— 那是**别的会话**在同一小时
覆写共享 `/tmp` 路径写出来的，而 ios 腿这轮根本没跑 xcodebuild、不可能产图。
⇒ "新生"判据按 mtime 数会**把别人的一枚算进我的张数**。修法（下一次补跑带上的两条）：
① 张数只数**那一腿 exit 0** 的腿；② 归档时同时落 `基线 md5 → 本轮 md5` 两列，
只有一枚文件"mtime 新且 md5 变且腿绿"才算数。这与 10-05 那条"共享 `/tmp` 会被别的会话覆写"
是同一条的**新面目**：那次是覆写让我误判成我的，这次是覆写让我把它**数进了分母**。

