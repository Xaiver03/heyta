# heyta · 业界 UI/UX 规范调研（对标判据版）

> 调研日期 2026-11；对象：heyta（本地优先 / E2EE / Web+桌面+移动）。
> 定位：本仓已有 `design-system.md`（取值）与 `ux-principles.md`（结构）两层的规则，
> 本文补**第三层：业界成熟规范里可直接变成判红的判据**，并标出与现状的差。
> 所有数值均来自一手文档；找不到一手来源的标 **二手**；**规范强制**（MUST / WCAG AA）与**惯例**（官方推荐、非强制）分栏写。
> 未做任何仓库改动。

---

## ① 任务管理类产品的 UX 规则

### A 可迁移（有判据、能判红）

| # | 规则 → 判据 | 来源 | 对 heyta |
|---|---|---|---|
| A1 | **完成 ≠ 删除**：完成任务要能"撤销 / 取消完成"，且这两条要有独立命令（Things：完成 `⌘K`、取消完成 `⌥⌘K`，且"按住 ⌥ 点复选框"等价） | [Things 键盘快捷键](https://culturedcode.com/things/support/articles/2785159/)（一手，官方支持文档） | ✅ 本仓有 `check:danger-confirm` / `check:undo-receipt`，但**"取消完成"是否单列一条命令**要现量；判据：完成态行必须有"取消完成"动作且可键盘触发 |
| A2 | **收件箱是唯一入口，且必须每天能清空**：新想法一律先落 Inbox，当天再决定"什么时候开始" | [Things · Getting Productive 官方指南](https://culturedcode.com/things/guide/) | ✅ 本仓有 `check:empty-state`；**缺**的是"收集箱 → 排期"这条路径的可判红（如：Inbox 项必须能一键给出 When/日程） |
| A3 | **导航靠"位置记忆"而不是靠图标识别**：常用列表要有固定数字键（Things：Inbox `⌘1` … Logbook `⌘6`） | 同上（快捷键页） | ⚠️ 可迁移但**不是必须**；本仓 `check:menu-keyboard` 只管菜单模型，**不管全局位置键**。若做，判据应是"同一列表在任意迁移路径下 Ctrl/⌘+N 命中" |
| A4 | **键盘优先要落到"无 UI 的入口"**：Things 的 `⌘F` 其实是冗余的——"直接开始打字，搜索框自己出现" | 同上（原文：*"You don't actually need to use Cmd + F to start a search"*） | ✅ 这条是本仓最该抄的一条：**判据 = 列表获得焦点时不按任何键，键入首个字符即进入搜索/新建**。它是"零成本入口"的检验 |
| A5 | **密度是可配置的，不是拍死的**：WCAG 官方 Note 明确"提供增加命中区 / 控制布局密度的机制"是正当做法 | [WCAG 2.5.8 官方 Note](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | ⚠️ 本仓 `--ht-size-row-min-height: 60px` 是**单一密度**。可迁移，但应作为"未来档"，不进当前判据 |
| A6 | **主题生成用感知均匀色空间**（Linear：一套主题 = base + accent + contrast 三个变量，用 LCH 生成；支持 `contrast` 变量以自动产出高对比主题） | [Linear · How we redesigned the Linear UI (part Ⅱ), 2024-03-28](https://linear.app/now/how-we-redesigned-the-linear-ui)（一手，官方工程博客） | ✅ 高价值：本仓 `tokens.css` 是**手工枚举**的。不是要现在换 LCH，而是要抄它的**结论**——"主题应由少量变量生成"，以及"contrast 是一等设置"。**判据**：任何新主题必须只改 ≤3 个变量就能产出（本仓目前做不到，属已知边界） |

### B 不可迁移（流行说法，但对 heyta 是错的或不适配）

| # | 说法 | 反证 / 为什么不抄 | 来源 |
|---|---|---|---|
| B1 | "抄 Linear 的密度：行高 32px、控件 28px" | Linear 是**桌面优先、鼠标优先**的产品，它的官方文章明确写"导航要在浏览器里也能用"（Electron + 浏览器同源），所以它把控件压到适合指针的尺寸。heyta 是**触屏 + 键盘 + 鼠标三栖**，压到 28px 会直接**违反 WCAG 2.5.8 AA**（24 是 AA 下限，仅限有间距例外）且与 `--ht-touch-target-min: 44px` 冲突 | Linear 同上；WCAG 见 ③ |
| B2 | "iOS 的 44pt 所以 Web 也写 44px" | 换了单位就不成立：pt 是**逻辑点**（iOS 的 1pt ≈ 1 CSS px 只是经验近似，不是规范）。WCAG 的 2.5.5 用 **44 CSS px**，是**AAA**；AA 是 **24**。把 44 当 AA 门槛会**过严**，把 24 当触屏标准会**过松** | [WCAG 2.5.5（AAA）](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)；见 ③ 表 |
| B3 | "Superlist / Todoist 的视觉很干净，可以照搬" | 我能拿到的只有它们的**营销页**（Superlist 官网只有价值主张文案，无设计规范；Todoist 2023–2025 改版我**没有找到一手设计文档**）。营销页不是规范，按本仓"二手必须标注"的纪律，**不作为判据来源**。若必须引，只能标"**二手**（营销页观感）" | [Superlist 官网](https://superlist.com/)（一手但非规范）；Todoist：**未找到一手来源** |
| B4 | "Notion 的块结构 = 好的信息层级" | Notion 的模型是**文档块**，任务只是其中一种块；heyta 的模型是**任务实体**。把文档的"块可任意嵌套"搬进任务列表，会让"一行一容器"（`ux-principles.md` §1b）失效 | **二手**：Notion 无公开设计规范页；此条仅作结构论证，不作判据 |
| B5 | "SVG 图标 = 24px 就行" | Apple 的层级用法是 **SF Symbols 的 weight 必须跟随相邻文字字重**、scale 是"相对字高"（small/medium/large 定义于大写字母高度），不是绝对像素 | [HIG · SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols)（一手） |

---

## ② 平台 HIG 硬数值表（单位必须标注）

> **单位纪律（这是最常被抄错的一条）**：iOS/macOS 用 **pt**（逻辑点）；Android 用 **dp**（密度无关像素）；
> Web 用 **CSS px**（= 参考像素，视觉视角 ≈0.0213° ）；Windows 用 **epx**（effective pixel）。
> **这四者不可直接互换**。跨端只许抄"语义"，数值必须在各端按该端单位**重新取值**。

### Apple（pt）

| 项 | 数值 | 强制？ | 来源 |
|---|---|---|---|
| 控件**默认**尺寸 iOS/iPadOS | **44×44 pt** | 官方推荐（recommended） | [HIG · Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| 控件**最小**尺寸 iOS/iPadOS/watchOS | **28×28 pt** | 官方"minimum" | 同上 |
| macOS | 默认 **28×28 pt** / 最小 **20×20 pt** | 同上 | 同上 |
| tvOS | 默认 **66×66 pt** / 最小 **56×56 pt** | 同上 | 同上 |
| visionOS | 默认 **60×60 pt** / 最小 **28×28 pt** | 同上 | 同上 |
| 按钮命中区 | **≥44×44 pt**（visionOS **60×60 pt**） | "as a general rule" | [HIG · Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) |
| 控件间留白 | 有立体边框：约 **12 pt**；无边框：约 **24 pt** | "in general, it works well" | HIG · Accessibility |
| 弹簧动效 | 少弹跳；**x/y/z 位移改用淡入淡出**；不animate 进出 blur；不 animate 景深 | 该节指令式（Reduce Motion 开启时） | [HIG · Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| 动效本身 | "**Make motion optional**"：动效**不得**是传达信息唯一通道；频繁交互**一般不加**动效；**不许**让人等动画才能操作 | "essential / generally avoid / don't make people wait" | [HIG · Motion](https://developer.apple.com/design/human-interface-guidelines/motion) |
| SF Symbols 层级 | 四种渲染模式：monochrome / **hierarchical**（同色不同透明度表达层）/ palette / multicolor；**层级用 hierarchical，不要用 variable color 表达深度** | both | [HIG · SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols) |

> ⚠️ **纠一个常见误引**：网传"iOS 列表行默认 44pt"作为"行高下限"。HIG 的 44pt 是**控件命中区**，
> 不是列表行高；[HIG · Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables) 全文**没有给行高数值**，
> 只要求"文字简短、避免大面积截断"。把 44pt 当行高规范＝**二手讹传**。

### Android / Material（dp）

| 项 | 数值 | 强制？ | 来源 |
|---|---|---|---|
| 可交互元素命中区 | **≥48×48 dp**（"Larger is even better"） | 官方 recommend | [Android · Make apps more accessible](https://developer.android.google.cn/guide/topics/ui/accessibility/apps?hl=en)（google.cn 镜像可读；developer.android.com 在本机不可达） |
| Compose 默认行为 | Material 组件的 `Clickable` 会自动把命中区**外扩**到 48dp（视觉尺寸可小于 48） | 实现事实 | [Android · API 默认值](https://developer.android.google.cn/develop/ui/compose/accessibility/api-defaults?hl=en) |
| 精确指针例外 | 鼠标/触控板可小于 48dp | 官方 Note | 同上（无障碍指南页） |

> **纠一个常见说法**："Material 触控目标是 48dp，所以 Web 写 48px"。
> 48dp 是 **Android 平台的推荐值**，不是 Web 标准；Web 的 AA 门槛是 **24 CSS px**（2.5.8），
> AAA 是 44（2.5.5）。**48 在 Web 上没有规范地位**，只是行业惯例（且是 Android 惯例的近似移植）。

### Windows Fluent（epx）

| 项 | 数值 | 强制？ | 来源 |
|---|---|---|---|
| 焦点视觉：主边框 | **2 epx**（在外侧） | 系统默认形态 | [MS Learn · Visual feedback guidelines](https://learn.microsoft.com/en-us/windows/apps/design/input/guidelines-for-visualfeedback) |
| 焦点视觉：次边框 | **1 epx**（在内侧） | 同上 | 同上 |
| 焦点视觉外距 | 默认**离控件边界 1 epx**（可正可负） | 同上 | 同上 |
| 间距刻度（语义，非等比） | 按钮↔按钮 **8**；控件↔flyout **8**；控件↔标题 **8**；控件↔标签 **12**；内容区之间 **12**；表面↔边缘文字 **16**；控件↔expander **16**；expander 内缩进 **48** | 官方示例值 | [MS Learn · Content layout and spacing](https://learn.microsoft.com/en-us/windows/apps/design/style/spacing) |

> 🔴 **纠错**：Fluent 常被引作"4/8/12/16/20/24 的 4 的倍数刻度"。官方那页给的是**语义对**（8/12/16/48），
> **不是一套等比刻度表**。把它当"Windows 用 4px 基数网格"是**二手讹传**。
> Fluent 真正的硬规则只有那一条：**双层焦点视觉 = 2 外 + 1 内 + 1 外距**。

> ⚠️ **Material 3 state layers 与 elevation**：M3 站点是纯 JS 渲染（curl 拿到的是
> `"This website requires JavaScript."`），本机无法取到一手数值。**我不给 8%/10%/12%/16% 那组数字**——
> 它们是网上广泛流传的 M2 遗留值，M3 已改为**同一 opacity 档 + 主题色**，具体档位我**无法用一手来源核实**。
> 结论：**heyta 若要抄 state layer，只能标"二手"**，或者直接采用本仓已有的 hover/pressed token（更安全）。

---

## ③ 无障碍阈值（硬门槛，WCAG 2.2）

| SC | 等级 | 阈值 | 判定方法（可脚本化） | 来源 |
|---|---|---|---|---|
| **1.4.3 Contrast (Minimum)** | **AA** | 正文 **≥4.5:1**；大文本（≥18pt 或 ≥14pt bold）**≥3:1** | 按相对亮度公式 `(L1+0.05)/(L2+0.05)`，sRGB，**未指定背景按白色** | [Understanding 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| **1.4.6 Contrast (Enhanced)** | AAA | 正文 7:1 / 大文本 4.5:1 | 同上 | [Understanding 1.4.6](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html) |
| **1.4.11 Non-text Contrast** | **AA** | UI 组件与状态、图形对象对**相邻色** **≥3:1**（不含 inactive 组件） | 对"识别组件所需的视觉信息"取色 | [Understanding 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| **2.4.7 Focus Visible** | **AA** | 键盘焦点必须有**可见**指示器 | 逐元素 Tab 一遍，截图/计算样式 | [Understanding 2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) |
| **2.4.13 Focus Appearance** | **AAA** | 指示器面积 ≥ 组件**2px 周长的面积**，且**聚焦/未聚焦同一像素对比 ≥3:1** | 面积公式：矩形 `4h+4w`；圆角矩形 `4h+4w−(16−4π)r`。**内缩**的指示器必须 >2px 才够面积 | [Understanding 2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html) |
| **2.4.11 Focus Not Obscured (Minimum)** | **AA** | 聚焦元素**不得被作者内容完全遮挡** | 键盘漫游时量元素矩形是否被固定层覆盖 | [Understanding 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) |
| **2.5.8 Target Size (Minimum)** | **AA** | **24×24 CSS px**，或**间距例外**：以 24px 直径圆居中于包围盒，圆与任何其他目标/圆**不相交** | 间距例外的几何判定（5 类例外：间距/等效/行内/UA 控制/必要）；**要求不受页面缩放影响** | [Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) |
| **2.5.5 Target Size (Enhanced)** | AAA | **44×44 CSS px** | 同上 4 类例外 | [Understanding 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) |
| **2.5.4 Motion Actuation** | **A** | 依赖设备/用户动作的功能，必须另有 UI 组件可操作，且**可关闭** | 例：摇一摇撤销 → 必须有按钮 | [Understanding 2.5.4](https://www.w3.org/WAI/WCAG22/Understanding/motion-actuation.html) |
| **1.4.10 Reflow** | **AA** | 内容在 **320 CSS px** 宽（纵向滚动）/ **256 CSS px** 高（横向滚动）下**无二维滚动**即不丢信息 | 320×256 视口截图 + 溢出检测 | [Understanding 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) |
| **3.3.1 / 3.3.2 错误与标签** | **AA** | 错误须**就地**以文字标识；输入须有标签或说明 | 表单逐字段注入错误 | [Understanding 3.3.1](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html) |

**对比度计算细节（照规范抄，别自己造）**：`L = 0.2126R + 0.7152G + 0.0722B`，其中
`RsRGB ≤ 0.04045 → R = RsRGB/12.92`，否则 `R = ((RsRGB+0.055)/1.055)^2.4`。
⚠️ **0.04045 这个阈值 2021 年 5 月前是 0.03928**，规范已更正（[1.4.3 定义 Note 2](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)）。
如果你的对比度测试脚本还写 0.03928，它和官方计算器会有极小差 —— 本仓 `design-system` 的对比度测试应核一次用的是哪个。

---

## ④ 设计 token 的分层做法

### 4.1 规范层面：DTCG 只定义"格式"，**不定义"分层"**（重要纠错）

- **设计 token** 的规范定义只有一句：*"information associated with a human readable name, at minimum a name/value pair"*
  → [DTCG Format Module 2025.10 · §3.1](https://www.designtokens.org/TR/2025.10/format/)
- **别名（alias/reference）** 是规范内的正式概念：一个 token 的值可以是另一个 token 的引用（`{color.text.primary}`）
  → 同规范 §3.8 / §6.6
- 🔴 **`primitive → semantic → component` 三级命名不是 W3C 规范**。我在 DTCG 的 format / glossary / resources 三处都**没有找到**这个分层被规范化。
  ⇒ 它是**行业惯例**（Adobe Spectrum / Salesforce Lightning / Material 各自表述不同），**引用时必须标"惯例"**，不能写成"W3C 要求"。
- DTCG **强制**（MUST）的只有几条，且都跟"别把工具弄崩"有关：
  - 工具 **MUST** 检测并报错**循环引用**（token 别名、`$extends`、`$ref`）→ §6.7.4
  - 工具 **MUST** 报错：非法引用语法 / 解析不到的目标 / 类型不匹配 → §7.5.3
  - `$deprecated` 可带**原因字符串**（`true` / `false` / 说明）→ §5.2.4
- **版本状态必须说清**：`2025.10` 是 **Draft Community Group Report**，规范页自己写着
  *"Do not attempt to implement this version of the specification"*，且**"not a W3C Standard"**。
  ⇒ 现在把 DTCG 当"必须遵守的格式"是**过度承诺**；当"导出格式的候选"才准确。

### 4.2 "组件禁止裸值"在业界的成熟做法

| 做法 | 名称 | 说明 | 状态 |
|---|---|---|---|
| **单一出口 + 类型安全** | typed token accessor（本仓已有 `cssVar('color.foreground')`） | 拼错在**编译期**报错，而不是运行时静默 | 本仓已实现，业界主流 |
| **静态门禁 + 账本** | lint rule / 自建 checker + 只减不增的 baseline | 本仓的 `check:design` 与各账本（`settings-prose-ledger.json` 等）属于这一族，**比多数开源设计系统更成熟** | 本仓领先 |
| **两级引用** | alias 只许**指向 token**，组件只许引用**语义/组件层** | 与 DTCG alias 语义一致 | 通用惯例 |
| **弃用而非删除** | `$deprecated` + 原因 | DTCG §5.2.4 有正式字段 | 规范支持 |

### 4.3 已知陷阱（这些才是真正会伤人）

1. **"语义名"也会退化成外观名**：`--ht-color-danger` 是语义，但 `--ht-size-focus-ring: 180px`（本仓 tokens.css:639）
   其实是**进度环直径**，名字和"焦点环"撞车。语义名一旦被两个不同概念复用，门禁看不到，人也会读错。
   → 判据：**token 名必须在全仓唯一可解析**，`grep` 一个名字只能命中一族用途。
2. **别名链会掩盖对比度**：A→B→C 三层展开后，改 B 会同时改十个组件。本仓的对比度测试"递归展开 `var()`"是对的，
   但**别名链本身没有层数上限**——建议加一条"语义层 token 的最长引用链 ≤ 2"。
3. **`primitive → semantic` 被当成"改色很方便"**：实际是**爆炸半径变大**。Linear 的解法不是加层，而是
   **把主题收敛到 3 个变量用算法生成**（见 A6）—— 分层能解决"命名"，解决不了"取值爆炸"。
4. **门禁只看值，不看"用了没用"**：一个 token 存在、合法、但从没被消费，门禁不会红。
   本仓 `check:z-ladder` 的 Z2 臂（"`z.splash` 零消费者"）是这个思路的正确形态，值得推广到**尺寸/圆角/阴影**各档。

---

## ⑤ 我认为 heyta 现阶段最缺的 5 条规范

> 前提：本仓在"值"与"结构"两层已经很厚（40+ 个 `check:*` 门禁、对比度真算、账本制）。
> 缺的不是"更多规则"，而是**规范里公认有硬阈值、而这里只靠评审的那几格**。

### 缺-1 · 命中区规则（hit-area）与"视觉尺寸 ≠ 命中尺寸"

**该有什么**：命中区下限（触屏 44 CSS px / 桌面 24 CSS px）、**间距例外**的几何判定、
以及"视觉元素可小于命中区，但命中区必须独立存在"这条——**RN 的 `hitSlop` 与 Web 的伪元素外扩必须是同一份判断**。

**缺了会出什么问题**：
- 本仓已有 `--ht-touch-target-min: 44px`，但 `grep` 显示它**不是每条可点路径都消费**——
  图标按钮、行内 chip（`--ht-size-chip-height: 28px`，tokens.css:590）、badge（18px）这类
  "视觉那么小、命中区靠父容器兜"的地方，**没有任何门禁证明命中区真的到了 44**。
- WCAG 2.5.8 的 AA 门槛是 **24px**，本仓连这一档都**没有自动判据**（`check:target-size` 不存在）。
- 具体症状：手机上点"截止"chip 命中不到、误触旁边图标；桌面端 18px badge 点不中 ——
  而所有测试都是绿的（`toBeVisible()` 只验有 box）。

### 缺-2 · 焦点视觉的"面积 + 对比变化"判据（2.4.13 那半）

**该有什么**：本仓已有**可见性**（`ux-principles.md` §5：环存在且 ≥3:1、`S6` 臂、`focus-visible-matrix` 逐视图量裁剪祖先），
但缺**2.4.13 的另外两个量**：① 环的**面积 ≥ 2px 周长面积**；② **聚焦/未聚焦同一像素的对比 ≥3:1**（不是环对底色的 3:1）。

**缺了会出什么问题**：
- `--ht-focus-ring-width: 2px` + `--ht-focus-ring-offset: 1px` 在矩形上没问题，
  但在**圆角很大的控件**（`--ht-radius-button: 18px`、`--ht-radius-dialog: 24px`）上，
  按官方公式 `4h+4w−(16−4π)r`，2px 环的**面积会被圆角吃掉一截** —— 与小圆角控件不再等价。
  而"环对底色 3:1"通过了，"聚焦前后同一像素 3:1"却**没人量过**（环是新增像素，未必是同像素变化）。
- 具体症状：键盘用户在某些控件上**看不出焦点在哪**，而现有门禁全绿 —— 这正是 `ux-principles.md` 记过的
  "颜色测试只测 token，不测焦点在不在"的同族问题，只是换了个量。

### 缺-3 · 跨端单位的**显式映射表**（pt / dp / CSS px / epx 不许互抄）

**该有什么**：一张**四列**对照表，每端一列，把"控件高度 / 命中区 / 行高 / 圆角 / 间距"的**语义**
映射到各端**按该端单位重新取值**的数。不是把 44 抄四遍。

**缺了会出什么问题**：
- 本仓价值观是"判断一份、渲染器两份"（`ux-principles.md` §9），但**单位转换不是判断**，
  它是**每端必须独立决定的事**。现在 `--ht-touch-target-min: 2.75rem`（=44px）、mobile 用 `t['touch-target.min']`、
  Windows 用 XAML、macOS 用 SwiftUI ——**四处各自的 44 没有任何一张表说明它们为什么相等、相等指什么**。
- 具体症状：某个端把 44 "换算"成 44dp（≈ 更大）或 44px 落在 1.5x 屏上变成视觉 29dp；
  或者有人为了统一而把 iOS 的 28pt 最小尺寸抄成 28px 到 Web（**低于 2.5.8 的 24 没问题，但低于触屏惯例**）。
  这类错误**不会有任何测试红**，因为每端都在自己的单位里"自洽"。

### 缺-4 · 动效的"时长上限 + 不阻塞 + 可替代通道"

**该有什么**（来自 [HIG · Motion](https://developer.apple.com/design/human-interface-guidelines/motion) + [2.5.4](https://www.w3.org/WAI/WCAG22/Understanding/motion-actuation.html)）：
① **任何动效不得阻塞操作**（"don't make people wait for an animation to complete"）；
② 动效**不得**是传达信息的唯一通道；
③ **频繁交互一般不加动效**；
④ reduced-motion 下**位移类**转**淡入淡出**（不只是把时长压到 1ms）。

**缺了会出什么问题**：
- 本仓做得好的部分：`tokens.css` 的 `prefers-reduced-motion` 把时长压到 1ms，
  且注释写明"压到 1ms 而不是删掉 duration，因为删掉会让依赖 transitionend 的逻辑挂" —— 这是**正确的工程判断**。
- 但 **1ms ≠ 无位移**：位移类过渡在 1ms 下会变成**瞬跳**，而 HIG 要求的是**换成淡入淡出**。
  另外 `--ht-duration-splash-hold: 200ms` 这类**启动屏**时长，属于"让用户等动画"的典型，
  HIG 明确要求"let people cancel motion"，本仓**没有跳过启动屏的入口**。
- 具体症状：开了"减弱动态效果"的用户，看到的不是"安静的界面"，而是**一屏硬跳**；
  启动屏在慢设备上是**固定 200ms 的等待**，不可跳过。

### 缺-5 · 海拔（elevation）的**语义等级表**，而不是四个数值

**该有什么**：像 `--ht-z-ladder` 那样（Z1 顺序 / Z2 越级），把 `shadow-none/sm/md/lg/xl` 也做成
**语义等级 + 单一允许用途**：哪一档是"静态卡片（边框分不开时）"、哪一档是"浮层"、哪一档是"模态"。
本仓已在 `design-system.md` 写下了**边界**（"静态卡片在边框分不开时可用 shadow-sm/md"、"不许给浮层以外加 shadow-lg"），
但那只在**文档**里，没有尺。

**缺了会出什么问题**：
- 现量：`shadow-lg` 在 `apps/web/src/styles/app/` 被消费 **15 处**、`shadow-xl` **1 处**、`md` 4 处、`sm` 3 处。
  `shadow-lg` 已经是事实上的"默认阴影"——**它到底是"浮层"还是"卡片"，从代码里读不出来**。
- 而 `tokens.css:350` 的组注释仍写着"阴影**只**用于浮层"，与 2026-11-02 那条精确化**互相矛盾**（注释没跟着改）。
  ⇒ 注释与规则漂了，而这正是本仓最在意的那类"会漂的抄件"。
- 具体症状：一张普通卡片和一个 toast 用同一档阴影，用户读不出层级；反过来，
  有人为了让卡片"看起来浮起来"用 `shadow-xl`，**没有任何测试会红**。

---

## 附：需要"当场纠错"的三条流行说法

| 说法 | 判定 | 反证 |
|---|---|---|
| "Apple 要求 44pt，所以跨端都 44" | ❌ 部分错 | 44×44 pt 是 iOS/iPadOS/watchOS 的**默认**尺寸，**最小**是 **28×28 pt**；macOS 是 28/20；visionOS 60/28（[HIG · Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)）。且"44"在 Web 上是 **AAA**（2.5.5），AA 是 24 |
| "Material 触控目标 48dp，Web 也是 48px" | ❌ 错 | 48dp 是 Android 推荐；Web 规范里没有 48。且 Android 自己写明"精确指针可更小"（[Android 无障碍指南](https://developer.android.google.cn/guide/topics/ui/accessibility/apps?hl=en)） |
| "WCAG 2.2 要求焦点环 2px" | ⚠️ 不准确 | **2px** 是 2.4.13 里"最简单满足**面积**要求"的做法，该 SC 是 **AAA**；AA 只要求 2.4.7 **可见**。把 2px 当 AA 门槛是过严——但作为工程默认值是合理的（本仓 `--ht-focus-ring-width: 2px` 注释已写"可访问性只要求可见，不要求粗"，判断正确） |

---

## 附：本文的证据边界（诚实登记）

- **可达**：W3C WCAG 2.2 Understanding（全部 SC 页）、Apple HIG（md 替代版：layout / lists-and-tables / motion / sf-symbols / buttons / accessibility / designing-for-ios）、
  Android 官方指南（google.cn 镜像）、MS Learn（Fluent spacing / visual feedback）、DTCG 2025.10、Things 官方支持站、Linear 官方博客。
- **不可达**（本机网络/渲染限制，**没有**用二手填补）：`m3.material.io`（纯 JS 渲染，curl 只得 `This website requires JavaScript.`）、
  `developer.android.com` 直连（用 google.cn 镜像代替）、`tr.designtokens.org/glossary`（404；format 页可得）。
- **未找到一手来源**：Todoist 2023–2025 改版的官方设计文档；Notion 公开设计规范；Superlist 设计规范（官网只有产品文案）。
  ⇒ 这三家在本文中**不出规则**，只出"不可迁移"的论证。
