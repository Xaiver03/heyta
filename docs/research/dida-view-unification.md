# 滴答清单的视图统一机制：对 M3 的输入

> 状态：**调研记录**（归档层，结论有变时新增勘误、不改原文）
> 日期：**2026-09-28**（CST）
> 触发：产品负责人 —— *「学习滴答清单怎么做各种视图的统一……统一视觉语言，统一各种 CSS」*
>
> ## 🔴 先说清一件事：**计划已经存在，本文不是第二份计划**
>
> 「统一视图与视觉语言」这件事，仓库里**已经有计划且正在执行**：
>
> | 已有 | 位置 | 状态 |
> |---|---|---|
> | 多端适配实施计划（M0→M6） | [../plans/multi-platform-adaptation.md](../plans/multi-platform-adaptation.md) | **已提交、正在执行**（M0-3/M0-4 已完成，M1-4 mobile 替换已完成） |
> | 其中 **M3「逐特性迁移 UI」= 本文关心的那件事** | 同上 | 主线工作量（12,277 行 web UI 逐特性迁到 RN 原语） |
> | 融合调研 | [multi-platform-ui-fusion.md](multi-platform-ui-fusion.md) | 已提交 |
> | Windows 真原生（RNW 出局） | [../adr/0034-…](../adr/0034-windows-native-winui3-not-rnw.md) | 已提交 |
>
> 所以**再写一份 `plans/view-unification.md` 就等于造第二份会漂移的计划** ——
> 这正是本仓库反复吃过的形状（[../README.md](../README.md) 的"同一件事写两遍"）。
>
> **本文只做 M3 缺的那一块：把"统一成什么样"写成可判定的契约，并给出参照模型。**
>
> ### M3 现在缺什么（实测）
>
> | M3 有的 | M3 没有的 |
> |---|---|
> | 迁移顺序（12 个特性，按移动端是否已有对应排序） | **"一行是什么"没有定义** |
> | 判据：**净行数必须持续为负**（代码指标） | **表头槽位 / 空态 / 颜色语义 没有契约** |
> | 迁移目标：RN 原语 | **没有参照模型**（全文只有一处提到 RNW，未提滴答） |
> | 沿用了 M1 的"图标必须共享" | "**行**必须共享"只在 M1 针对图标说过一次，未推广 |
>
> **一句话**：M3 知道**要迁哪些**、**用行数验收**，但没写**迁完长什么样才算对**。
> 本文补的就是这个 —— 否则"净行数下降"完全可能以"12 份各自更短的实现"达成。

---

## 1. 滴答是怎么统一的（实测证据）

### 1.1 证据怎么来的（可复现），以及"后台"的边界

滴答 macOS 端**不是 Electron**（AppKit + Swift + Kotlin Multiplatform，无 Chromium、无 CDP），
Playwright 驱动不了。改用 `huashu-mac-use` 的窗口级取证：

```bash
S=~/.agents/skills/huashu-mac-use
bash $S/scripts/build.sh                       # 编译内核
bash $S/scripts/probe.sh "TickTick"            # 版本 8.2.03，原生
$S/scripts/mac windows TickTick                # 主窗口 id
$S/scripts/mac shot <id> out/01.png            # ★ 跨 Space 后台截图，不抢焦点
$S/scripts/mac op <id> <x> <y> "" @ref.png shot out/02.png   # 切视图
open -g "ticktick://v1/show?smartlist=today"   # 换查询
```

**"纯后台"三种手段都试过，结果如实记录**：

| 手段 | 结果 |
|---|---|
| `mac shot`（截图） | ✅ **完全后台**，跨 Space、不抢焦点 —— **截图从来不是问题** |
| `mac op` 的 postToPid 后台档 | ❌ 该 app 对合成事件返回 `suspected_noop` |
| `mac key`（含 `postToPid`） | ❌ 被前前台闸拒绝（会打到前台窗口上） |
| `open -g "ticktick://…"` | ⚠️ **会激活 app**（`-g` 对已运行 app 的 URL 投递不生效） |

→ **读永远能后台；在"另一个 Space 上的原生 app"里切界面，必然要么借焦点、要么激活它。**
这是 macOS 的边界，不是工具没做好。

### 1.2 证据图 —— 🔴 **刻意不进仓库**

8 张桌面截图在本机 **`~/Documents/滴答对标/desktop-截图/`**
（长边 1600、JPEG、672 KB；原 PNG 在 `/tmp/dida-shots-original/`）。
手机端 9 张也在 `~/Documents/滴答对标/`。

| 图 | 看什么 |
|---|---|
| `01-main.jpg` | **四象限**：罗马数字徽标 I/II/III/IV + 四色；空态是居中的「没有任务」 |
| `02-tasks.jpg` | **任务列表**：四列外壳（图标栏 / 侧栏 / 列表 / 详情）；行 = 复选框 + 标题 + 截止徽标 |
| `bg-today.jpg` | **同一列表、只换查询**（`smartlist=today`）—— 与上一张逐项对比：**行、输入行、侧栏完全不变**，只换了标题与一个控制项 |
| `03-calendar.jpg` | **日历**：表头模板 + 周数 + 节日 + 日格计数徽标；习惯在日格里是**蓝色小胶囊** |
| `05-focus.jpg` | **习惯**（点 ⏱ 进的是习惯，不是番茄钟）：7 日条 + 每行右侧 7 个打卡圆 |
| `07-task-detail.jpg` | **详情面板**：`<图标> <标题> … •••` + 2×2 统计卡 + **整月打卡圆** |
| `04-matrix.jpg` / `06-list-before-detail.jpg` | 切换中间态，留档备查 |

**🔴 为什么不进 git**：它们含有**产品负责人本人的真实数据** —— 习惯名、标签名、
以及手机截图里的真实任务标题（含业务事项）。而本仓库的目标是 **MIT 开源**，
**截图一旦进 git 历史就很难真正撤回**。

取舍：本文所有结论都是**结构性**的（外壳分几段、行由哪些元素构成、哪一处复用），
并且给全了**复现命令**（§1.1）—— 图是**佐证**，不是**论据本身**。

> 要让图进仓库的话：先把文字区域打码（PIL / `magick` 都在本机），
> 且**只提交 01 / 03 / 04 三张**（四象限为空、日历无任务 —— 不含个人数据）。
> **这件事留给你决定**，因为它涉及"你的数据要不要进 git"。

> ⚠️ 8 张都是**先 `mac shot` 后台截图**得到的；只有"切到某个界面"这一步借了焦点
> （0.8–2.8 秒后归还）或激活了 app。**没有一张是纯后台切换得到的。**

### 1.3 统一的第一层：外壳分四段，只有两段随视图变

| 层 | 桌面端 | 手机端 | 变不变 |
|---|---|---|---|
| **① 全局导航** | 左图标栏（任务/日历/四象限/习惯/搜索 ‖ 同步/通知/帮助） | **底部标签栏**（任务/日历(图标是"27")/四象限/习惯/⋯） | **不随视图变**，且**跨端同一组目的地** |
| **② 范围列表** | 第二列（今天/最近7天/收集箱/清单/过滤器/标签/已完成/垃圾桶） | 抽屉 | 随 **scope** 变，不随视图变 |
| **③ 视图主体** | 表头 + 内容 | 表头 + 内容 | **随视图变** |
| **④ 详情** | 第三列 | 进下一级 | 随**选中项**变 |

证据：四张不同视图的截图里，**① 逐像素一致**，② 只在切 scope 时变，只有 ③ 在换。

### 1.4 统一的第二层：**一个列表 + 类型化 cell**（最强证据）

`.nib` 文件名就是它的组件清单（**430 个**），家族摊开看：

| 家族 | 成员 | 说明了什么 |
|---|---|---|
| `TTTaskList*` | `StandardCell` / `DetailedCell` / `CountdownCell` / `SectionCell` / **`HabitCell`** / `InputView` / **`ViewController`（只有一个）** | **一个列表控制器**；行按"显示模式"分 cell；**分组头也是 cell**；**习惯也是这个列表里的一种 cell** |
| `TTMatrix*` | `MatrixQuadrantTaskCell` | 四象限**复用任务 cell**，只换容器 |
| `TTProjectList*` | `SmartListCell` / `TypeHeaderCell` / `DividerCell` / `TeamCell` / `EmptyHolderCell` | **侧栏自己也是类型化列表**，不是硬编码几行 |
| `TTTaskDetail*` | `TitleCell` / `ContentCell` / `SubtaskCell` / `TagCollectionCell` / `FocusSummaryCell` / `OverviewCell` / `CheckCyclesCell` | **详情面板同样是"列表 + 类型化 cell"** |
| `TTMenu*` / `TTTiled*` / `TTSubtitle*` | `TaskMenuButtonCellView` / `TiledMenuItemCell` / `SubtitleMenuItemCell` | **一套菜单词汇表**给任务菜单与 ••• 菜单共用 |
| `TTPopup*` | `SingleSectionPickerVC` / `MutiSectionPickerVC`（原文含拼写错误） | **一套选择器**给优先级/日期/清单/标签共用 |

**一句话**：加一个新视图 ≈ 写一个查询 + 一两个 cell，**不是**写一套新的界面语言。

### 1.5 统一的第三层：同一实体、多种容器，**行本身不变**

一个「任务」出现在四处：

| 容器 | 桌面 | 手机 |
|---|---|---|
| 任务列表 | `TTTaskListStandardCell`：复选框 + 标题 + 截止徽标 | 同左 |
| **四象限卡** | 卡片内一列任务行 | **与任务列表完全相同的行**（手机截图 `…42_2765.jpg`：复选框、字号、标题换行、逾期红字**全都一样**） |
| 日历格 | 格内一条彩色小胶囊 | 同左 |
| 习惯列表 | `TTTaskListHabitCell`：图标 + 名称 + 连击 + **7 个打卡圆** | 同构 |

**`…42_2765.jpg`（手机四象限）是本文最该看的一张**：它证明"象限卡里的行"和
"列表里的行"是**同一个组件** —— **换的只是容器**。

再举一个：**打卡圆**出现在三处、三种尺度 —— 习惯列表的 7 日行 /
详情面板的整月网格（`07-task-detail.jpg`）/ 日历的日格徽标。
**一个组件，三个尺度，不是三份实现。**

### 1.6 统一的第四层：颜色与文案只有一处定义

| 含义 | 表现 | 出现在 |
|---|---|---|
| 四象限 I/II/III/IV | **红/橙黄/蓝/绿 + 罗马数字徽标** | 桌面四象限、桌面侧栏、**手机四象限**（三处同色同徽标） |
| 今天/当前 | **同一个蓝**实心圆 | 日历今日格、习惯今日列、图标栏选中态、手机标签栏选中态 |
| 逾期 | 红字 | 任务行日期（**跨端一致**） |
| 标签 | 每标签一个色点 | 侧栏 |
| 计数 | 小圆角徽标 | 侧栏(4)、日历日格(3/4) |
| **空态** | 居中一句「**没有任务**」 | 四象限桌面四格、手机同构 —— **一个组件一句话** |

**表头模板**（四张截图全部满足）：
`<折叠/图标> <标题> ……… <本视图控制> <•••>`
—— 变的只有中间那段，**两端永远在同一位置**。

---

## 2. heyta 现状（量化）

| 维度 | 现状 | 证据 |
|---|---|---|
| 端数 | **6 个**：web / desktop / desktop-windows / mobile / node-host / landing | `apps/` |
| 视图数（web） | 8 个 | `apps/web/src/App.tsx` 的 `VIEW_TABS` |
| 各自实现行渲染 | **8 个文件各写 `.map()`** | `TaskOrganizer`/`QuadrantBoard`/`HabitsView`/`GanttChart`/`TimelineView`/`TrashView`/`IdentityTagList`/`MilestoneMap` |
| web CSS | **1715 行**，**30 个顶层类前缀族** | `apps/web/src/styles/app.css` |
| 共享组件层 | **已存在**：`packages/ui` 1022 行（`TaskList` + `TaskBadges` + `model` + `theme`） | 已被 **mobile** 采用（M1-4）；**web 尚未**（唯一 web 消费者是 `apps/web/src/dev/universal-slice.tsx`） |
| theme 实现 | **两份**：`apps/mobile/src/theme.tsx`(162) 与 `packages/ui/src/theme.tsx`(147) | mobile **同时在用两者** |
| landing | `mockup.css` 手工复刻应用外壳 | = [showcase-fidelity-audit.md](showcase-fidelity-audit.md) 那五处漂移的来源 |

**值得说清：我们不缺意识。** `ht-empty`(4) / `ht-bar`(8) / `ht-chip`(4) / `ht-due`(4) /
`ht-swatch`(5) / `ht-btn`(10) 说明共享原语已经走了一小段；`packages/ui` 里甚至有完整的 `TaskList`。
**缺的是"让 web 也去用它"，和"不让别人再写第二份"。**

---

## 3. 差距：M3 需要补的契约（逐条可判定）

| # | M3 现在没有 | 判据（怎么算做到了） |
|---|---|---|
| 1 | **"一行"没有定义** | 全仓「复选框 + 标题 + 截止 + 标签」这一行的渲染**只有一处**（`packages/ui`） |
| 2 | **表头槽位没有定义** | 8 个视图的表头都满足四槽位；标题左缘 x 相同、`•••` 右缘 x 相同 |
| 3 | **空态没有定义** | 空态只有**一个**实现 + `web.empty.*` 一套词条 |
| 4 | **颜色语义没有集中** | 象限四色 / 今日蓝 / 逾期红各只有**一处**定义（M0-1、M0-3 已在做，扩展到视图层） |
| 5 | **"同一实体多种容器"没有表达** | 任务行在列表 / 象限卡 / 日历格 / 详情里是**同一个组件 + `density`**，不是四份 |
| 6 | **landing 的手抄复刻没有出路** | landing 渲染**真组件**；`mockup.css` 的界面部分删除 → 那五处漂移**不可能再发生** |
| 7 | **"加视图会不会新增方言"没有约束** | 新增第 9 个视图**不需要**新增 CSS 前缀族 |

---

## 4. 目标形态：给 M3 的视觉契约

> 这一节是**建议**，不是判决。M3 的执行人应当把它当作"迁完长什么样"的验收口径；
> 若与 M3 已有判断冲突，**以 M3 为准并在那里记一笔**。

### 4.1 四层，与滴答同构

```
L0 token        packages/design-system/src/{tokens.css,tokens.ts}   ← 唯一真相（已有）
L1 原语         packages/ui/src/primitives/   Button/Icon/Checkbox/Bar/Chip/EmptyState/DueBadge
L2 模式         packages/ui/src/patterns/     ★TaskRow / HabitRow / ListSurface /
                                              SectionHeader / FieldRow / StatCard / PunchCircle / ViewChrome
L3 外壳         apps/*/src/shell/             rail / sidebar / header 的网格与位置
L4 视图         apps/*/src/features/          查询 + 组合，不写样式
```

**允许端差异的只有 L3。** L4 里出现颜色/字号/间距字面量 = 违规（`check:design`
第 6 类规则已经能抓 RN 裸数字，扩展即可）。

### 4.2 `TaskRow` 的契约（本文最重要的一条）

| prop | 值 | 对应滴答 |
|---|---|---|
| `variant` | `standard` \| `detailed` \| `countdown` | `StandardCell` / `DetailedCell` / `CountdownCell` |
| `density` | 由**容器**给：列表=宽松 / 象限卡=紧凑 / 日历格=极小 | 同一个 cell，三个尺度 |
| `task` | 领域对象（**不传视图专属字段**） | — |

**判据**：四象限卡里的行 = `<TaskRow density="compact" />`，
日历格里的行 = `<TaskRow density="minimal" />`。**不是三份 JSX。**
（`packages/ui` 已有的 `TaskList` + `model.ts` 的 `toTaskRow` 就是这个底子。）

### 4.3 视图 = 查询 + 容器 + 密度

| 视图 | 查询 | 容器 | 行密度 |
|---|---|---|---|
| 任务 | 当前 filter | `ListSurface` | standard / detailed |
| 四象限 | 按象限分组 | 2×2 网格，每格一个 `ListSurface` | compact |
| 习惯 | 习惯集合 | `ListSurface` + 7 日打卡列 | habit |
| 时间线 | 按日期 | 泳道容器 | minimal |
| 回收站 | 已删除 | `ListSurface` | standard |
| 设置 | 字段 | `FieldRow` 列表 | — |
| 番茄钟 / 成长 | — | **非列表**（单一大组件 / 图表） | — |

→ **8 个视图里 5 个是 `ListSurface` 的实例**；番茄钟/成长形状不同，
但**同样受 L0–L2 约束**（用 `Bar`/`Chip`/`StatCard`，不自己定色）。
**统一是契约一致，不是形状一致。**

### 4.4 顺带：导航分层（解掉顶栏溢出）

web 顶栏把 8 个视图平铺一行，实测 1280px 下**只可见 5/8、藏起 3 个**
（数字见 [showcase-fidelity-audit.md §6.3](showcase-fidelity-audit.md)）。
按滴答的分法：

- **全局导航**（跨视图不变，4–5 个）：任务 / 日历 / 四象限 / 习惯 / **更多**
- **范围**（不是视图，是同一列表的过滤）：收集箱 / 今天 / 已完成 / 清单 / 标签 → 第二列

一步解决两件事：顶栏不再溢出，且"切视图"与"切筛选"不再混为一谈。
⚠️ 这是**唯一动到肌肉记忆**的一步，需要产品负责人拍板。

### 4.5 强烈建议：**别把 landing 排在最后**

M3 的顺序是"按移动端是否已有对应"排的，而 **landing 不在 M3 的 12 项里**。
但 landing 的 `mockup.css` **手工复刻了应用外壳**，是那五处漂移的来源，
而且**每迁一个视图，landing 就多漂一处**（它画的是旧样子）。

→ 建议：**每迁完一个视图，顺手把 landing 对应的那一块换成真组件**。
否则等 M3 迁完 12 项，landing 会积累 12 处漂移，再回头修一遍。
**这一步的收益是把"漂移不可能发生"作为副产品拿到。**

---

## 5. 门禁：别让"统一"自己散开

> 🔴 **这一节比 §4 更重要。**
> [showcase-fidelity-audit.md](showcase-fidelity-audit.md) 已经证明：分散的实现
> 在**没有任何门禁**时会**五项同时漂移而无人发现**。
>
> **已经把 M0-3 / M0-4 做过的部分标出来，不重复：**

| 不变量 | 判据 | 现状 |
|---|---|---|
| 类别色/热力色只有一处 | `apps/*` 不得出现槽位→颜色映射 | ✅ **M0-3 已做**（`check:layering` 第 9 条） |
| 无裸 RN 尺度数字 | `padding`/`margin`/`borderRadius`/`fontSize`/`gap` 不许写字面量 | ✅ **M0-4 已做**（`check:design` 第 6 类） |
| **行只有一个实现** | 「复选框 + 标题 + 截止」的 JSX 结构全仓只允许出现在 `packages/ui` | ❌ **待建** |
| **CSS 前缀族只减不增** | `app.css` 顶层 `ht-*` 族数 ≤ **基线 30**，每次 PR 只许下降 | ❌ **待建** |
| **L4 不写样式** | `apps/*/src/features/**` 不许出现颜色/字号/间距字面量与 `style={{…}}` | ⚠️ 把 M0-4 的规则**扩到 web features** |
| **theme 只有一份** | 只允许 `packages/ui` 提供 `useTokens`；`apps/mobile/src/theme.tsx` 变转发或删除 | ❌ **待建** |
| **表头槽位一致** | 每个视图渲染 `<ViewChrome>`；测试断言四槽位 x 坐标 | ❌ **待建**（组件测试） |
| **空态只有一个** | `web.empty.*` 之外的"空"文案不许出现在视图里 | ⚠️ 扩 `check:ui-language` |

**这几条合起来就是产品负责人要的"全局域的统一的系统化管理"** ——
不是靠人记住，是靠**红**。

---

## 6. 明确不做

| 不做 | 为什么 |
|---|---|
| 抄滴答的具体控件外观 | 我们有 token 与自己的视觉语言；**统一 ≠ 长得像** |
| 引入第三方组件库 | 统一来自**契约**；引库只是把 30 个前缀族换成一套别人的 API 漂移 |
| **另起一份"视图统一计划"** | 已有 [multi-platform-adaptation.md](../plans/multi-platform-adaptation.md) M3；两份计划必然漂移 |
| 一次性重写 8 个视图 | M3 已经定了"逐特性迁移"；本文只是给它的验收口径 |
| 把番茄钟/成长硬塞进列表模型 | 它们本来不是列表；**统一是契约一致，不是形状一致** |
| 手机端照搬桌面布局 | 端不同、镀铬不同；**统一的只有 IA 与组件词汇** |
| 追求"零 CSS" | RN 原语下本来就没有 CSS；但**web 的 hover/媒体查询仍是真实需求**，由 M3 判断留多少 |

---

## 7. 未核实项

- 桌面端截到 **5 个界面**（四象限/任务/日历/习惯/详情）+ 3 张中间态与换查询对照。
  **搜索、设置、番茄钟、时间线未截** —— 它们是否也遵守同一套 cell 词汇，
  是从 `.nib` 命名**推断**的，没有截图坐实。
- 手机端 9 张只细看了 **2 张**（`…41` 打卡设置、`…42` 四象限）。其余 7 张未逐张分析。
- 未量化滴答的**间距/圆角**是否也跨视图统一（本轮只量了颜色与结构）。
- **本文 §4 与 M3 已有判断是否冲突，未逐条比对** —— 只比对了 M3 的目标与判据。
  执行 M3 的人应当复核，冲突以 M3 为准。
- 滴答的时间线/甘特视图未截到，无法比对"非列表视图"它怎么统一。
