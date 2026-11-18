# 全局排版布局原则（顶部锚定 IA）

> 立文日期：2026-11-18。目的：把"每屏各自排版"收敛成**一套有原则的全局排版**——
> **信息架构按"顶"来排、内容顶部锚定、导航分层固定**。
> 原则取自 `apple-design` 技能（WWDC *Designing Fluid Interfaces* + *Principles of Great Design*）
> 与 `ui-ux-pro-max` 的 Navigation/Layout/Accessibility 规则，并受本仓既有决策约束
> （`docs/agents/screen-chrome.md`、`entry-layers.md`、`ux-principles.md`；不推翻"屏幕底白"与"AppBar 不放 34pt 大标题"）。
> 执行清单见 [`UI-CHECKLIST.md`](UI-CHECKLIST.md)。

---

## 0. 一句话

**当前的问题不是"某屏没画好"，而是"没有一套默认的全局排版"**：每屏各自决定标题在哪、内容从哪开始、要不要垂直居中、动作放哪。
结果是——登录屏在「我的」tab 里被当成"整屏替换"渲染、日历「回到今天」那行又重又没抽象、信息层级不对。
**本文件给出默认规则；偏离默认必须有理由并写下来。**

---

## 1. 核心原则（P1–P10）

每条：**原则 → Apple 出处 → heyta 落地做法**。

### P1 顶部锚定（Top-anchored）· 每屏第一眼回答"我在哪"
- 出处：Apple *Wayfinding*（"每屏都要回答：我在哪？我能去哪？这里有什么？怎么出去？"）+ *Simplicity：用层级让最重要的最先被看到*。
- 落地：**标题/导航贴顶，内容从顶往下自然排**。默认**不垂直居中**整屏内容；只有「空态」「沉浸页」允许居中。
- 反例（要改）：登录屏、详情页若把内容当一块垂直居中"漂浮"，就会散、层级错。

### P2 一屏一主标题（One primary title）
- 出处：`typography.types` 既有结论"一屏两个大标题等于没有大标题"。
- 落地：页面主标题**只有一处**：要么 AppBar（headline），要么内容区（screen-title）。不要再叠第二行同义大标题。

### P3 导航分层固定（Nav hierarchy）
- 出处：`ui-ux-pro-max` §9 `nav-hierarchy` / `tab-bar-ios` / `bottom-nav-limit`；Apple *Familiarity*（同一位置、同一行为）。
- 落地（四层，跨屏一致）：
  - **L0 根层 = 底部 Tab（≤5：任务 / 日历 / 专注 / 统计 / 我的）**
  - **L1 视图层 = Tab 内的视图切换**（分段/tab，放 TopBar 的 `tabs` 槽）
  - **L2 二级页/详情 = push**（返回在左上，`‹ 上一级`）
  - **L3 模态/抽屉 = sheet**（可下滑关闭、可取消）
- 判据：同类目的地永远用同一层；不要把二级页塞进 tab、不要把详情做成 tab。

### P4 动作分层（一个动作一个家）
- 出处：本仓 `docs/agents/entry-layers.md`（六条放置规则）+ Apple *Simplicity*（常用路径先、进阶退一步）。
- 落地：
  - 全局动作（搜索、全局设置）→ TopBar
  - 视图动作（本视图的排序/筛选/切档）→ TopBar `actions` 或 `overflow`
  - 对象动作（改这条任务/便签）→ 长按菜单 / 滑动
  - 字段动作 → 行内控件
- 预算：顶栏 `≤3` 枚高频动作（`check:nav-chrome`）。

### P5 单主 CTA 预算
- 出处：`ui-ux-pro-max` §4 `primary-action`（每屏仅一个主 CTA）。
- 落地：一屏主色按钮 `≤2` 处；主按钮不贴底、不抢标题；次级路径（找回密码/切换方式/返回）**折叠或降级为 muted**。

### P6 分组与映射（Proximity / Grouping）
- 出处：Apple *Grouping & mapping*（邻近即关系；控件靠近它影响的东西）。
- 落地：相关项成组、组间留白拉开；**分组标题在卡外**（inset grouped 惯例）；控件贴近其所作用对象。

### P7 文字层级靠"字重+字号+行高"，不靠颜色
- 出处：Apple *Typography*（optical sizing/tracking/leading）+ `ui-ux-pro-max` §6 `weight-hierarchy`。
- 落地：三级层级（标题/正文/注记）用既有 `TEXT_STYLES`；颜色只表达语义（危险/成功/强调），不做层级。

### P8 一致的手势与控件（Familiarity / Platform idioms）
- 出处：`ui-ux-pro-max` §2 `standard-gestures` / `system-gestures` / `press-feedback`；Apple *Familiarity*。
- 落地：返回=左上/系统手势；sheet 可下滑关闭；按压**按下即反馈**；44pt 触控；不重定义系统手势。

### P9 分层密度：移动学范式、桌面保密度
- 出处：Apple *Flexibility*（按设备/情境适配）+ 本仓既有"桌面保信息密度"决策。
- 落地：移动端用大标题/分组卡/sheet；桌面保留日期分组+多字段的高密度；**共用同一套语义 token，不同的密度档**。

### P10 转场连续性（Spatial consistency / Motion）
- 出处：`apple-design` §7（进出同一路径）、§4 springs、§14 reduced-motion；`ui-ux-pro-max` §7 `navigation-direction`。
- 落地：前进=从右/下滑入、后退=反向；可打断；遵守 `prefers-reduced-motion`；模态从触发源展开。

---

## 2. 信息架构（IA）组合模型

把"信息层级"抽象成**固定的组合方式**，组件只是它的载体：

```
L0  底部 Tab            ← 顶层目的地（任务/日历/专注/统计/我的）   [TabBar]
L1  视图切换            ← 同一目的地内的查询/视图（列表/四象限/时间线；月/周/日）[TopBar.tabs / 标题点击菜单]
L2  二级页 / 详情        ← push，左上返回，TopBar(leading=back)      [TopBar + Screen]
L3  模态 / 抽屉 / 表单    ← sheet，可下滑关闭、有取消                 [BottomSheet / Modal]
```

**动作归属**（与 P4 同一张表）：

| 作用域 | 安放处 |
|---|---|
| 全局（搜索） | TopBar 常态槽 |
| 视图（切档/排序/筛选） | `TopBar.tabs` 或 `TopBar.overflow` |
| 对象（删/移/旗标） | 长按上下文菜单 / 左滑 |
| 字段 | 行内控件 |

**抽象原则**：**先在"信息层级"上定这一屏属于哪一层、动作属于哪一作用域，再选组件**；而不是先写布局再把层级凑出来。

---

## 3. 组件职责与槽位契约（要抽象出来的三件）

### 3.1 TopBar（顶部导航，共享）
- 槽位：`leading`（返回/汉堡）｜`title`（可点，`large`/`compact`）｜`titleAccessory`（箭头）｜`tabs`（L1 视图切换）｜`actions`（≤3 高频）｜`overflow`（⋮）。
- **只管摆位，不管放什么**（图标/菜单由宿主以节点传入；安全区/底色留宿主）。
- 现状：另一会话已起草 `packages/ui/src/layout/TopBar.tsx`（未提交）——**本清单直接在其上评审/接手，不另起一份**（避免两份顶栏）。

### 3.2 TabBar（底部导航，共享）
- 槽位：`items`（icon+label，≤5）｜`activeId`｜`badges`｜安全区。
- 现状：`apps/mobile/src/nav/TabBar.tsx` 已实现（BlurView 材质）。要抽出的是**形态契约与组合方式**，让 Web/桌面复用同一份"tab 语义"，材质留各端。

### 3.3 Screen（屏骨架）
- 组合：`TopBar` + 内容区（顶锚、`screen.gutter`、`bottom-inset`）+ 可选 `fixedControls`。
- 现状：`apps/mobile/src/ui/kit.tsx` 的 `Screen` 已有 `chrome(page/board/immersive)` + `background(surface/grouped)` + `barCollapsed`。**在它之上接 TopBar/TabBar 槽位**，不重写。

---

## 4. 逐屏落地检查（按本原则该被"按顶排版"重排的屏）

| 屏 | 现象 | 按本原则应做 |
|---|---|---|
| 登录 / 注册（`AuthScreen` + 从「我的」进入） | 从「我的」进入时在 **tab 内整屏替换**，不像统一登录屏；内容漂浮、层级乱 | 走 **L2 全屏**（TopBar 返回 + 顶锚一栏到底 + 单主 CTA），与 WelcomeScreen 的全屏登录档**同一形态** |
| 日历（`CalendarScreen` / `CalendarToolbar`） | 「‹ 今天 ›」+ 标题 + trailing 一行过重、未抽象 | 收进抽象 **TopBar**：视图切档放 `tabs`，「今天」降级为次要动作 |
| 「我的」（`ProfileScreen`） | 已改为 grouped+卡片（较好），但未登录入口/账号区仍可再收敛 | 保持 grouped；账号区继续用"整块可点 + ›"，不重复放"注册登录"按钮 |
| 其他 page 屏 | 各自排版 | 统一走 `Screen` + `TopBar` 默认，偏离需写明理由 |

---

## 5. 与既有决策的关系（不推翻）

- **屏幕底白**（`kit.tsx:2026-11-16`）：**保留**；本文件不要求改回灰底。
- **AppBar 不放 34pt 大标题**：**保留**；本文件说的"大标题"仅指内容区 `screen-title`，或 TopBar `titleSize='large'` 的**根页**用法（须作为新的产品决定再启用）。
- **四象限/成长/AI/专注 是差异化**：保留，不因"像 iOS"而砍。

---

## 6. 验收方式

- 视觉：模拟器/真机截图，逐屏对照"是否顶锚、是否单一主标题、导航是否分层、动作是否各归其位"。
- 门禁：`check:nav-chrome`（顶栏预算）、`check:l4`（视图不写样式）、`check:entry-table`（入口账本）、`check:settings-row-anatomy`、`check:tap-targets`。
