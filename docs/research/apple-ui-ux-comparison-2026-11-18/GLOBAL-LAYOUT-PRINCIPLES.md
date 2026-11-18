# 全局排版规范（以 Apple HIG 为准）

> 2026-11-18 · **更正版**。
> 🔴 **更正**：上一版 P1 把"顶部锚定"写成了"内容从顶往下排"——**这是错的，内容本来就从顶往下排**。
> 你指的"顶部锚定"是：**顶部导航栏（标题）什么时候出现、放什么、元素顺序如何**，以及**导航分层**——
> 这些必须有一套**统一规范**。本版严格按 **Apple Human Interface Guidelines** 重写，并附来源。
> 依据：Apple HIG *Toolbars*（iOS 的 navigation bar 即"带导航的 toolbar"）、*Tab bars*、*Modality*、*Going full screen*。

---

## 1. 顶部导航栏规范（Apple HIG · Toolbars / Navigation bar）

> HIG 原文要点："A toolbar provides convenient access to frequently used commands, controls, navigation, and search."
> "In iOS, a navigation-specific toolbar is sometimes called a navigation bar."
> "A tab bar is specifically for navigating between areas of an app" —— **顶栏管"当前视图"，底栏管"app 区块"，两者不混用。**

### 1.1 什么时候出现 / 什么时候可以隐藏
- **出现**：一个屏幕处在**层级导航**里（有上级、需要表示"我在哪 / 怎么回去"）时，顶部导航栏出现，承载标题 + 返回 + 动作。（HIG：带导航控件的 toolbar "appears at the top of a window, helping people move through a hierarchy of content"。）
- **应隐藏的场景**（仅两类）：
  1. **沉浸 / 全屏专注**（如专注计时、阅读、看图）：可临时隐藏顶栏与导航控件，**但必须提供熟悉的恢复方式**（点一下 / 下滑 / 把光标移到顶部），且**任务/导航必要时仍要保持可见**。（HIG *Going full screen*）
  2. **被模态覆盖**：模态是"临时、自足"的，覆盖底栏/背景，模态**自带的栏**由模态负责。
- **反例（要改）**：把二级内容塞进 tab 内部、用"整屏替换"但没有自己的顶栏/返回 —— 那不是层级导航，层级感会丢。

### 1.2 放什么内容（三件，缺一不可）
顶栏只装三类，且**按固定顺序**摆（HIG *Item groupings*）：
1. **导航控件**（leading 边）：标准 **Back**（回溯层级）或 **Close**（关模态）。用**标准符号**，**不要写"返回/关闭"文字**。
2. **标题**（leading 标题之后，或 center）：**当前视图的名字**（说"这是哪"，不是"这是什么 app"）。
3. **动作**（trailing 边）：最高频/最重要的动作（符号优先，无边框系统符号）；可含 **搜索**、**More（⋮）溢出菜单**、**一个主操作（Done/Submit）**。
- 可选 **search field**：放 trailing 或独立 search tab。

### 1.3 元素顺序（你说的"顺序"——按 HIG 固定）
```
[ leading 边 ]            [ center ]                [ trailing 边 ]
 Back / Close  →  标题（或 center 标题）  →   高频动作 · 搜索 · More(⋮) · 主操作(Done/Submit，最右)
```
- **导航控件永远在 leading**；**主操作永远在 trailing 最右**（HIG：prominent 的 Done/Submit 放 trailing）。
- **分组 ≤ 3 组**，按**功能 + 频率**分组；**导航控件与关键动作（Done/Close/Save）单独成组、醒目**。
- **文字按钮与符号按钮不要相邻**（要插固定间隔，否则会被看成"一个带文字的按钮"）。

### 1.4 标题规范（HIG *Titles*）
- **每个视图要有标题**，帮人确认位置、区分内容；**冗余可留空**（如单窗口笔记可省）。
- **不要用 app 名当标题。**
- **简洁：一个词或短语，< 15 字符**，给控件留空间。
- **大标题（iOS）**：用大标题帮人**在导航与滚动时保持方位**；默认**大标题随向下滚动过渡为标准标题、滚回顶部又变大**。（→ 这就是"何时大标题 / 何时小标题"的规则：**根/顶层页用大标题，下钻/滚动后收起为内联小标题**。）

### 1.5 动作规范（HIG *Actions*）
- 只放**支持主任务、最高频/最重要**的动作；含义必须清楚。
- **符号优先**（编辑 Edit 这类没有好符号的才用文字）；用**系统符号、无边框**。
- **关键动作只用 `.prominent`（主色）样式，且只有一个，放 trailing**。
- 空间有限时：**只留最重要的，其余进 More(⋮)**；**不要拥挤**；**不要手加 overflow**（系统按宽度收纳）；避免"默认就 overflow"的布局。

### 1.6 材质与背景
- **少用自定义背景/染色**；外观跟随内容层；需要与内容区分时用**滚动边缘效果**（scroll edge effect），不要一块纯色硬条压着内容。（与现有"底栏毛玻璃、内容从下滚过"同一条路。）

### 1.7 映射到 heyta 的 `TopBar` 槽位
| HIG 位置 | TopBar 槽 |
|---|---|
| leading：Back / Close | `leading` |
| 标题 | `title`（`titleSize='large'` 用于根页大标题，滚动收起用 compact） |
| 标题装饰（展开箭头） | `titleAccessory` |
| 视图切换（L1） | `tabs`（放标题下一行） |
| 高频动作（≤3） | `actions` |
| More(⋮) | `overflow` |

---

## 2. 底部导航栏规范（Apple HIG · Tab bars）

- **只做导航，不做动作**（作用于当前视图的控件用顶栏，不用 tab bar）。
- **导航时保持可见**；隐藏会让人忘记在哪个区块。**唯一例外**：模态覆盖它（临时、自足）。
- **数量越少越好、避免 overflow**（More tab 让内容更难达到）；层级复杂时**考虑 sidebar**。
- **不要禁用/隐藏 tab 按钮**，即便某区块内容为空 —— 要**解释为什么不可用**。
- **每个 tab 带标签**（尽量单个词）+ 图标；**badge 只用于关键信息**。
- iOS：**浮在内容底部、带材质让内容透出**（现有 `TabBar` 的 BlurView 符合）。

---

## 3. 导航分层与模态（Apple HIG · Modality）

| 层 | 是什么 | 怎么呈现 | heyta 归属 |
|---|---|---|---|
| **L0 根** | 顶层区块 | 底部 Tab（≤5） | `TabBar` |
| **L1 视图** | 同一区块内的视图/查询切换 | 顶栏 `tabs` 或"点标题切档" | `TopBar.tabs` / `CalendarViewMenu` |
| **L2 二级/详情** | 层级下钻 | **push（返回在 leading）**；全屏内容可用**全屏样式** | `TopBar(leading=back)` + `Screen` |
| **L3 模态** | 自足、需显式关闭的专门任务 | **sheet / 全屏模态**，自带取消/完成 | `BottomSheet` / 全屏 Modal |

HIG 模态判据（原文）：**只在有明显收益时用**；任务**简单、短、聚焦**；**避免"应用中的应用"（模态里放层级）**；**始终给明显关闭方式**（iOS：顶栏按钮或下滑）；**可能丢内容先确认**；**给说明任务的标题**；**不叠多个模态**。

**关于登录（已定）**：登录是**自足、要完成/取消的专门任务** → 应是 **L2 全屏登录页**（顶栏 `leading=返回`、标题、正文一栏到底、主操作 trailing/prominent），**不在"我的" tab 内整屏替换**。（对应清单 C4。）

---

## 4. 动作分层（配合本仓 `docs/agents/entry-layers.md`）

| 作用域 | 安放处 |
|---|---|
| 全局（搜索） | 顶栏常驻 / 独立 search tab |
| 视图（切档/排序/筛选） | `TopBar.tabs` 或 `overflow` |
| 对象（删/移/旗标） | 长按上下文菜单 / 左滑 |
| 字段 | 行内控件 |

---

## 5. 其余原则（简，均出自 Apple HIG / 本仓既有）

- **单主 CTA**：一屏主色按钮 ≤2，主操作放 trailing（HIG prominent）。
- **文字层级靠"字重+字号+行高"**，不靠颜色（HIG Typography；本仓 `TEXT_STYLES`）。
- **分组与邻近**：相关项靠近、组间留白；分组标题在卡外。
- **一致性**：同一位置、同一行为，跨屏一致（HIG Familiarity）。
- **密度分层**：移动学范式、桌面保密度，共用语义 token。
- **转场连续**：前进=从右/下滑入、后退反向；可打断；遵守 reduced-motion。
- **无障碍**：44pt 触控、Dynamic Type reflow、VoiceOver 标签。

---

## 6. 与既有决策（不推翻）
- **屏幕底白**（`kit.tsx:2026-11-16`）：保留，不改回灰底。
- **app 名不做标题 / 大标题在内容或根页**：与 HIG 一致。
- **四象限/成长/AI/专注** 是差异化，保留。

---

## 7. 来源（Apple 官方，2026-11-18 抓取 Markdown 版）
- Toolbars（iOS 的 navigation bar 即"带导航的 toolbar"）：https://developer.apple.com/design/human-interface-guidelines/toolbars
- Tab bars：https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Modality：https://developer.apple.com/design/human-interface-guidelines/modality
- Going full screen：https://developer.apple.com/design/human-interface-guidelines/going-full-screen

## 8. 验收
- 逐屏对照：**是否该有顶栏**（层级屏有、沉浸页可隐但可恢复、模态自带）、**内容与顺序**（leading 返回→标题→trailing 动作/主操作）、**标题**（≤15 字、非 app 名、根页大标题）、**动作**（≤3、符号、唯一 prominent 在 trailing、其余进 More）。
- 门禁：`check:nav-chrome`（顶栏动作预算）、`check:l4`、`check:entry-table`、`check:tap-targets`。
