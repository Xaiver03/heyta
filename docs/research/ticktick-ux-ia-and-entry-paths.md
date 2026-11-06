# 滴答清单 · UX 信息架构与入口链路

> **这一份只回答四个问题**：入口分几层 · 一个动作该从哪出来的判定规则 · 三条主链路各走几步 ·
> 它与 heyta 的差在哪。它**不**回答"哪一屏存在"（那是 [P2 界面地图](ticktick-surface-matrix.md)）、
> **不**回答"菜单里有哪些键"（那是 [P5 菜单与快捷键](ticktick-keyboard-and-menus.md)）、
> **不**回答"四种状态怎么画"（那是 [P7](ticktick-states-and-feedback.md)）。
>
> **取证日**：2026-11-06。**对象**：本机 macOS 8.2.03（430 个解出文档 / 436 个 nib 名）、
> Windows 8.2.5.0（639 BAML → 638 XAML，1 个转换失败）、本仓当前 `main`。
> **判据来源**：产品负责人 2026-11-06 原话 ——「他们的 UX，比如某个按钮从信息架构上应该是怎么出来的，
> 这一点我觉得非常非常重要。**我觉得我们目前的 UX 极度混乱**。」「入口链路和入口方式也一定极度重要。」
>
> 🔴 **硬边界（写在最前，免得读到一半以为越界）**
> 1. **不摘录它的界面文案**。所有动作一律用**功能描述**指代（每个 ≤6 字，是我写的词，不是它的字符串）；
>    菜单用 `/tmp/rea-lab/out/menu.json` 的**分组键**指代（`|File` / `|Task` / `|List` / `|Help`），不用标题原文。
>    要原文自己跑 §1.3 的命令。
> 2. **不截图**。证据一律给「文件名 / 控件名 / action 名 / `文件:行号`」。
> 3. **每个结论后面必须站得住**：要么是可复跑的读数，要么标 `未核实`（§8）。
> 4. **「它的选择」与「平台惯例」分开写**。§1.4 先纠正两个把平台事说成设计选择的误读。

---

## 0. 六句话结论

1. **它的入口是四层，且四层各有一套不同的"控件语法"**：全局层是**菜单**（`|File` `|Task` `|List` `|Help`），
   视图层是**工具条**（每屏一个 `*ViewController` 的按钮组），对象层是**自绘菜单 + 详情底栏**，
   字段层是**就地编辑器**。四层的分界不是"重要程度"，是**动作的作用对象**。
2. **638 个 XAML 里没有一处原生 `ContextMenu`、没有一处原生 `ToolBar`**——但这不是平台缺件（§1.4），
   是选择：WPF 两样都有，它就是不用，改用 `EscPopup`（207 处 / 72 文件）自绘。
   ⚠️ 口径只到"声明式界面里"：右键处理器住在托管代码里（§1.4 纠正 B），
   所以能说的是**"XAML 一处都没有"**，不是"代码里不可能有"。
3. **判定规则可以压成一句话**：「**作用域决定层，代价决定深度**」。作用域是"这个动作改的是字段 / 一条任务 /
   一个视图的读法 / 整个应用"，代价是"放错层会不会不可撤销"。§3.2 用 7 个真动作逐条验过。
4. **它把"大"和"小"分得很开**：行菜单只有 4~6 项，**详情底栏在 Windows 上恰好 5 枚**，而详情的「更多」里塞了 **17 项**。
   它不是"动作少"，是**把 17 项的动作藏进第 4 层**（§6.2）。这是它最值得学的一件事。
5. **三条链路里，① 和 ③ 与 heyta 同档，② 比 heyta 深一层**：它的「加子任务」在 Windows 上要
   **4 次点击 / 4 层**（主窗 → 详情 → 底栏 More → 子任务输入），macOS 只要 3 次。
6. **heyta 的乱不在"入口多"，在"归属缺席"**：同一个动作用户在 2~4 处都能点到，但没有任何一处能回答
   "它为什么在这儿"。而 heyta 其实**已经有一条能红的单点判据**（`apps/web/tests/task-detail-card.spec.tsx:817`
   断言"截止不许两处可编辑"）——§7 的第一条规则就是把那条推广到其余字段，不是新发明。

---

## 1. 证据面与口径

### 1.1 原料

| 原料 | 路径 | 读什么 |
|---|---|---|
| macOS 文档图 | `/tmp/rea-lab/out/nib-b1..b8.json` | 430 个文档；`graph.edges` 里 **2 283 条 `target_action`**、3 878 条 `outlet_to` |
| macOS 文档名 | `/tmp/rea-lab/nib-names.txt` | 436 行（其中 6 个名字没有解出文档） |
| macOS 菜单 | `/tmp/rea-lab/out/menu.json` | 9 组 / 62 项 = 7 顶层 + 55 叶子 |
| Windows XAML | `/tmp/rea-lab/win/xaml/` | **638** 个文件（639 BAML − 1 转换失败） |
| Windows BAML 名 | `/tmp/rea-lab/win/ui/` | 639 = views 491 / resource 144 / styles 3 / app 1 |
| 托管符号 | `/tmp/rea-lab/out/w-exe-types.txt`、`/tmp/rea-lab/out/w-exe-u16.txt` | 类型名与字符串堆（右键处理器的唯一证据） |

### 1.2 五个口径（引用任何数字都要连口径一起搬）

| # | 口径 | 为什么它会让读数差一个量级 |
|---|---|---|
| C1 | **文件数 ≠ 元素数** | `Popup` 出现在 **188 个文件**里，但真正的 `<Popup>` 元素只有 **57 处**；其余是 `EscPopup`（207 处）、事件名与资源键 |
| C2 | **action 名 ≠ 功能** | `saveButtonClicked:` 出现在 **20 个 nib** 里（全表 327 个不同 selector）—— **它是 20 个不同的"保存"**。按 action 名统计等于把不同事物的同名动作加起来 |
| C3 | **入口 ≠ 输入通路** | 「右键」和「键盘菜单键」是**同一个入口的两条输入**（`App.tsx:1820` 与 `:1833` 都走 `openRowMenuFromRow`）。数入口数列，数通路数另一列 |
| C4 | **文件名 ≠ 用户走得到** | `views_kanban_*`、`views_timeline_*` 在包里存在，但是否对所有账号/套餐可见，**未核实**（没登录） |
| C5 | **`disabled: null` ≠ 可用** | `/tmp/rea-lab/out/menu.json` 的 `disabled` 字段**全部是 `null`**，那是"没记录"，不是"都可用" |

### 1.3 复跑（四条命令，全部只依赖解包目录）

```sh
# ① 四层里的"自绘"这件事，三行读数
cd /tmp/rea-lab/win/xaml
grep -rl 'ContextMenu' . | wc -l          # 0
grep -rl 'ToolBar' . | wc -l              # 0
grep -ro 'EscPopup' . | wc -l             # 207（其中 <Popup> 元素只有 57 处：grep -ro '<Popup' .）

# ② 菜单：9 组 62 项，业务动作 29 个、0 个带键
python3 -c "import json;m=json.load(open('/tmp/rea-lab/out/menu.json'));print({k:len(v) for k,v in m.items()})"

# ③ 每个 nib 绑了哪些 action（本文 90% 的"逐层证据"来自这条）
python3 - <<'PY'
import json,glob
from collections import defaultdict
r=defaultdict(set)
for f in glob.glob('/tmp/rea-lab/out/nib-b*.json'):
    g=json.load(open(f))['normalized_result']['graph']
    for n in g['nodes']:
        if ':action:' in n.get('id',''):
            r[n['evidence'][0]['artifact_path'].split('/')[-1]].add(n.get('name'))
for k in sorted(r): print(k, sorted(r[k]))
PY

# ④ 右键：XAML 里 0 处，托管 IL 里有
grep -rl 'MouseRightButton' /tmp/rea-lab/win/xaml | wc -l        # 0
grep -in 'RightClick\|RightButton' /tmp/rea-lab/out/w-exe-types.txt | head
```

### 1.4 🔴 先纠正两个前提（不纠正，后面会得出反的结论）

**纠正 A：WPF 有原生 `ContextMenu`，也有原生 `ToolBar`。**
两者都是 `System.Windows.Controls` 里从 .NET 3.0 起就有的控件（这条是**平台事实，本次未在本机实测**，
可独立核实）。所以「638 个 XAML 里 `ContextMenu` 0 处、`ToolBar` 0 处」**不是平台做不到**，
**是它选择不用** —— 这条区别很要紧：平台缺件只能等，设计选择可以学也可以不学。
⇒ 本文所有"自绘菜单/自绘工具条"的结论都归到**它的选择**名下。

**纠正 B：「右键菜单挂在哪个控件上」不能从 XAML 读出来。**
XAML 里 `MouseRightButton` **0 处**，只看 XAML 会得出"它没有右键菜单"——这是**错的**。
托管 IL 的异步状态机里有 `OnRightClick`、`OnItemRightClick`、`CheckInRightClick`、`OnMouseRightButtonUp`
（`/tmp/rea-lab/out/w-exe-types.txt:4741`、`:10874`、`:10893`、`:10934`），
`ContextMenuStyle` 这个键只出现在托管字符串堆（`/tmp/rea-lab/out/w-exe-u16.txt:2464`），**XAML 里 0 处定义**。
⇒ 右键是**代码里挂的**，菜单内容是**自绘的 `EscPopup` + 一个代码侧的样式键**。
⇒ 口径纪律：**「BAML/XAML 里有一个 Popup」不等于「那个右键菜单挂在那个控件上」**（§8 第 2 条）。

**纠正 C（读数对不上，不猜）**：任务书给的 `Command 44` 与本机复跑不一致 ——
`Command="` 是 **110 处 / 39 文件**，`\bCommand\b` 是 **125 处 / 40 文件**。
差在哪里我没追平，本文**不用这个数**做任何结论（§8 第 8 条）。

---

## 2. Q1：入口分几层

### 2.1 四层的定义（按"动作改什么"划，不按"重要程度"划）

| 层 | 它改的是什么 | 它的控件语法 | 判据 |
|---|---|---|---|
| **全局层** | 与"当前选中哪一条"无关的应用级动作 | 系统菜单栏（macOS）/ 托盘 + 全局热键（Windows） | 不选中任何任务也能点 |
| **视图层** | **一整个视图怎么读**（排序/筛选/显示/范围/分享） | 每屏自己的工具条按钮组 | 换了选中对象它**不变** |
| **对象层** | **一条任务本身**（完成/删除/移动/结构/标签） | 自绘菜单 + 详情底栏 + 多选工具条 | 必须有一条（或多条）被选中 |
| **字段层** | **一条任务的某个字段的值**（标题/日期/优先级/清单/标签） | 就地编辑器 / 属性条 | 改完即写，没有"确定"这一步 |

### 2.2 逐层证据

#### 全局层

| 平台 | 载体 | 装了什么 | 证据 |
|---|---|---|---|
| macOS | `MainMenu.nib` | `\|File` 3 项（新建/搜索/同步）、`\|Task` 11 项（完成 + 4 档优先级 + 5 个日期档 + 打印）、`\|List` 13 项（逐个视图直达）、`\|Help` 2 项 | `/tmp/rea-lab/out/menu.json`：9 组 62 项 = 7 + 55；业务 29 个，其中 **29 个全都不带键** |
| Windows | 托盘 + `NHotkey` 全局热键 + `views_config_hotkeycontrol.baml` / `views_config_shortcutsconfig.baml` | 窗口唤出、快速添加、全局热键配置 | 与 [P5](ticktick-keyboard-and-menus.md) §4 同一份证据；本文不重复它的读数 |

**这一层装的东西有一个共同形状**：它装的是**别处已经存在的动作的"键盘镜像"**，不放新动作。

- `|Task` 的 4 档优先级，正好是对象层那个优先级弹层的 **4 档**；
- `|Task` 的 3 个快捷日期档（今天/明天/下周）+ 1 个清除，正好是日期对话框里 `QuickDatePanel` 的**快捷档**；
- `|List` 的 13 项，是 rail 上那 13 个视图的**直达**（不是新视图）。

⇒ 「全局层 = 镜像」这条在 §3.3 有一个反例（档位集合两处不等长），说明它是**意图**不是**保证**。

#### 视图层

| 平台 | 载体 | 装了什么 | action 名 / 控件名 |
|---|---|---|---|
| macOS | `TTTaskListViewController.nib` | 列表页头：侧栏开关、清单下拉、更多、日期、AI 推荐、保存筛选、清空回收站、关闭 | `listsButtonClicked:` `hamburgerButtonClicked:` `moreButtonClicked:` `dateButtonClicked:` `aiRecTaskButtonClicked:` `saveFilterButtonClicked:` `emptyTrashButtonClicked:` `closeButtonClicked:` |
| macOS | `TTKanbanViewController.nib` | 看板页头：分享、排序、更多、汉堡、AI 推荐 | `shareButtonClicked:` `sortButtonClicked:` `moreButtonClicked:` `hamburgerButtonClicked:` `aiRecTaskButtonClicked:` |
| macOS | `TTTimelineViewController.nib` | 时间线页头：范围、今天、左右移、分享、排序、更多、汉堡 | `rangeButtonClicked:` `todayButtonClicked:` `leftArrowButtonClicked:` `rightArrowButtonClicked:` `shareButtonClicked:` `sortButtonClicked:` `moreButtonClicked:` `hamburgerButtonClicked:` |
| Windows | `views/mainwindow.xaml` | **左侧 tab 条 + 六个分栏**（`LeftTabBar` + List / Calendar / Habit / Eisenhower / CountDown / AI 各自一个 Border + `LCSplitter`） | 主窗口自己只做"容器"，一个业务动作都没有 |
| Windows | `views/tabbar/leftmenubar.xaml` | 左侧栏底部：头像、tab 条、通知（`NotificationButton` + `NotificationPopup` + `NotificationPanel` + 未读点）、更多（`MoreGrid` + `MorePopup`）、升级、同步（`SyncPath` / `SyncToolTip`） | 组件名即清单 |

**视图层装什么，有一个干净的判据**：**「换了选中对象它不变」的动作才放这儿**。
排序、筛选、显示选项、范围、分享、清空回收站 —— 全都与"选中哪条"无关。
反过来，「清空回收站」**只**在回收站视图出现（`emptyTrashButtonClicked:` 只在
`TTTaskListViewController.nib`），因为它是"这个视图的收尾"，不是"任务的动作"。

还有一个跨平台一致的细节：**详情面板放右边还是做成弹窗，是视图层的一个选项**
（macOS `TTListDisplaySettingsVC.nib` 的 `detailSidePickButtonClicked:` / `detailPopupButtonClicked:`；
Windows `views/mainlistview/tasklist/tasklistviewoptionsdialog.xaml` 的 `SideSelect` / `PopupSelect`）。
这是一个**很低成本的一致性**：同一个决定，两端都放在"显示选项"里，都没放进设置。

#### 对象层

| 平台 | 载体 | 装了什么 | 证据 |
|---|---|---|---|
| macOS | `TTTaskMenuViewController.nib` + `TTTaskMenuButtonCellView.nib` + `TTTaskMenuDividerCellView.nib` + `TTTaskMenuLabelCellView.nib` | **行菜单**：一个专门的 VC + **三种 cell**（按钮 / 分隔线 / 标签） | `buttonsAction:`；四种文件同时存在 ⇒ 这是**自绘菜单**，不是 `NSMenu` |
| macOS | `TTTaskDetailBottomActionView.nib` | **详情底栏，绑了 8 个 action**（评论 / Markdown / 删除两态 / 合并 / 更多 / 移清单 / 标签）—— 比 Windows 那份（5 枚控件）**多 3 个** | `commentButtonClicked:` `deleteForeverButtonClicked:` `deleteTaskButtonClicked:` `mdEditButtonClicked:` `mergeButtonClicked:` `moreButtonClicked:` `moveToProjectButtonClicked:` `tagButtonClicked:` |
| macOS | `TTTaskDetailTopView.nib` | 详情顶栏：勾选、日期、优先级、指派、备注信息、返回 | `checkboxButtonClicked:` `dateButtonClicked:` `priorityButtonClicked:` `assigneeButtonClicked:` `notesInfoButtonClicked:` `returnButtonClicked:` |
| Windows | `views/customcontrol/custommenulist.xaml` | **自绘菜单原语**：`Container` / `TopItem` / `Items` / `SubPopup`（带二级）+ 内建 Toast | 事件只有 `SubpopupClosed`，一个 `MenuItem` 都没有 |
| Windows | `views/detail/taskdetailbottomcontrol.xaml` | 详情底栏：**恰好 5 枚**（移动清单 / Markdown / 评论 / 删除 / 更多），回收站态换成 2 枚（还原 / 永久删除） | `TaskDetailMoveGrid`+`SetProjectPopup`、`EditButton`、`CommentGrid`、`DeleteGrid`、`MoreGrid`+`MorePopup`；`TaskDetailTrashGrid`、`TrashRestoreGrid`、`RemoveButton` |
| Windows | `views/detail/taskdetailmorecontent.xaml` | 详情「更多」的**内容**：**17 个 item 级动作** | `AddSubTaskClick` `LinkParentTaskClick` `OnStarClick` `OnAbandonedOrReopenClick` `OnAttachmentClick` `OnInsertSummaryClick` `OnUseTemplateClick` `OnAddTemplateClick` `OnActivityClick` `OnCopyClick` `OnCopyLinkClick` `OpenTaskSticky` `SwitchTaskNoteClick` `ConvertToEventClick` `OnExportClick` `OnPrintClick` `OnDeleteClick` |
| Windows | `views/misc/batchtaskcontrol.xaml` | **多选工具条，恰好 6 枚**：改期、推迟、移清单、改优先级、改标签、更多（+ 删除） | `SetDateButton` `DelayButton` `MovetoButton` `SetPriorityButton` `SetTagButton` `MoreButton` + `OnDeleteClick` |

🔴 **这一层最重要的读数**：**行菜单小（4~6 项）、底栏小（5 枚）、「更多」大（17 项）**。
它没有把 17 项摊在底栏上，也没有为了"少"而砍掉功能 —— 它把功能**放进第 4 层**。
这是 §6 那一节的全部内容。

#### 字段层

| 平台 | 载体 | 装了什么 | 证据 |
|---|---|---|---|
| macOS | `TTTaskDetailTitleCell.nib` | 标题格的勾选 + 类型切换 | `checkboxButtonClicked:` `kindButtonClicked:` |
| macOS | `TTProjectListCellView.nib` | **就地改名**（编辑结束即提交） | `titleEndEditing:` |
| macOS | `TTSubtasksCell.nib` | 子任务格的展开/勾选 | `rightArrowButtonClicked:` `checkButtonClicked:` |
| macOS | `TTTaskListInputView.nib` | **创建时的字段条**：添加 / 日期 / 清单 / 优先级 / 标签 / 更多 / 折叠 | 7 个 action 同名即清单（`addButtonClicked:` … `triangleButtonClicked:`） |
| Windows | `views/tasklist/editablesectioncontrol.xaml` | 就地编辑一整格：显示态 + `EditBox` + 就地加 + 就地更多 + **就地报错** | `NormalGrid` `EditBox` `AddButton` `MoreButton` `MorePopup` `ErrorPopup` |
| Windows | `views/quickadd/addoptiondialog.xaml` | **创建态属性条**：优先级 / 清单 / 指派 / 标签 / 附件 / 模板 / 三种类型互转 | `PriorityGrid` `MoveButton`+`SetProjectPopup` `AssignBtn`+`SetAssigneePopup` `TagGrid`+`SetTagPopup` `AttachmentButton` `AddTemplateButton` `ConvertToTaskSwitch` `ConvertToNoteSwitch` `ConvertToEventSwitch` |
| Windows | `views/detail/taskdetailhead.xaml` | 详情顶栏的字段组：日期 / 优先级 / 指派（各自带 Popup） | `DateGrid` `SetPriorityGrid`+`SetPriorityPopup` `AssignGrid`+`SetAssignPopup` |

**字段层的判据**：**改完即写、没有"确定"这一步**。
反例也在同一张表里：`views/tasklist/editablesectioncontrol.xaml` 带 `ErrorPopup` ——
就地编辑的代价是**错误必须就地报**，否则用户改了没生效却看不出来。这条很值得抄。

---

## 3. Q2：一个动作该从哪儿出来

### 3.1 反推出的规则

> **总规则：作用域决定层，代价决定深度。**

| # | 判定 | 放哪 | 反例（放错了会怎样） |
|---|---|---|---|
| J1 | 改的是一条任务的**某个字段的值** | 字段层（就地） | 把"改优先级"做成一个对话框 → 每改一次多两层 |
| J2 | 改的是一条任务**本身**（状态/结构/去向） | 对象层（行菜单 / 详情底栏 / 多选条） | 放进字段层 → 用户点一个"值"却把整条删了 |
| J3 | 改的是**一整个视图的读法** | 视图层（页头工具条） | 放进对象层 → 同一个动作在不同行上重复出现 |
| J4 | **与选中无关**的应用级动作 | 全局层（菜单 / 托盘 / 热键） | 放进视图层 → 每加一个视图就要重做一遍 |
| J5 | **放错层会造成不可撤销后果** | **再深一层**（更慢、更显式） | 删除如果和"改标签"并排，误触代价不对等 |
| J6 | **全局层只放镜像，不放新动作** | —— | 新动作只从菜单可达 = 它没有归属地 |

**J5 的证据**：删除在对象层被**拆成三处**，且每一处的措辞不同 ——
详情底栏的删除（`DeleteGrid` / `deleteTaskButtonClicked:`）、详情「更多」里的删除（`DeletePanel` / `OnDeleteClick`）、
回收站里的永久删除（`RemoveButton` / `deleteForeverButtonClicked:`）。
**同一个"删除"，三种代价，三个落点**。这不是重复，这是 J5 在起作用。

**J6 的证据**：§2.2 全局层那张表 —— 29 个业务动作，档位全部来自别处（4 档优先级 / 3 个快捷日期档 + 清除 / 13 个视图直达）。

### 3.2 七个真动作的验证（每个：在哪出现 · 为什么不放别处）

| # | 动作 | 它出现在哪（层） | 为什么不放别处 |
|---|---|---|---|
| 1 | **完成** | 行勾选（对象层最外，`TTTaskListStandardCell.nib` 的 `checkButtonClicked:`）+ 详情顶栏（`checkboxButtonClicked:`）+ 全局 `\|Task` + 多选工具条 | 完成是**最高频且可逆**的动作 ⇒ 允许出现在 4 处：每处都是"用户此刻正看着它"。它不进「更多」——进了就变成"要点两下才能完成"（J5 不适用：代价低） |
| 2 | **4 档优先级** | 字段层（`SetPriorityGrid` / `TTTaskDetailTopView.nib` 的 `priorityButtonClicked:`）+ 对象层行菜单弹出 + 多选条（`SetPriorityButton`）+ 全局 `\|Task` 4 项 + 创建属性条（`PriorityGrid`） | **不进「更多」**：它是"一个值"，而「更多」装的是"一条任务的动作"（J1 vs J2 的分界） |
| 3 | **日期** | 字段层（`DateGrid`）+ 对话框（`views_time_setdatedialog.xaml`：`QuickDatePanel` 4 档 + `SaveButton`）+ 多选条（同一个对话框，出口换成 `BatchEditButton`）+ 全局 `\|Task` 的 3 个快捷档 + 清除 | 同一个日期对话框**在两种作用域下复用**，靠**出口按钮**区分（单条 `SaveButton` / 多条 `BatchEditButton`）。这是全篇最值得抄的一处工程形状：**控件复用，出口分档** |
| 4 | **加子任务** | **只有**对象层第 2 跳：`NewAddSubTaskItem` / `AddSubTaskClick`（详情「更多」里） | 行菜单没有（`TTTaskMenuViewController` 解不出子项，见 §8）、全局没有、多选没有、字段层没有。理由：它需要**父任务的上下文**才成立，而"上下文"只在详情里有 ⇒ J2 + J5（加错了要能看见父子关系） |
| 5 | **移动清单** | 详情底栏**直接暴露**（`TaskDetailMoveGrid`）+ 多选条（`MovetoButton`）+ 创建属性条（`MoveButton`） | 它**不出现在全局层**——菜单栏没有"移清单"。因为菜单栏拿不到"移到哪一个清单"的参数；而底栏直接暴露说明它被判定为**高频**（与"加子任务"形成对照：同样是结构动作，一个直接给，一个藏起来） |
| 6 | **排序** | **只有**视图层（`sortButtonClicked:` 出现在看板与时间线两个 VC） | 行菜单没有、详情没有、全局没有。理由：它是**一整个视图的读法**（J3），且它是阅读偏好（不进同步） |
| 7 | **清空回收站** | **只有**视图层（`TTTaskListViewController.nib` 的 `emptyTrashButtonClicked:`） | 连详情都没有：它不是"一条任务的动作"，是"这个视图的收尾"（J3） |

**两条从表里掉出来的规律**：

- **凡是"需要一个参数"的动作，就从全局层消失**（移清单没有参数入口，所以菜单栏没有它；日期只有 3 个固定快捷档，所以菜单栏就只给这 3 个 + 清除）。
- **同样是"结构动作"，高频的（移清单）直接暴露、低频的（加子任务）进「更多」** ——
  所以"进不进更多"不是按"重要/不重要"分，是按**频次**分。

### 3.3 它自己违反这条规则的三处（诚实登记）

| # | 违反什么 | 读数 |
|---|---|---|
| V1 | **J6 的镜像不严格**：全局层与字段层的日期档位**集合不同** | 日期相关共 5 个菜单项 = 3 个快捷档（今天/明天/下周）+ 1 个清除 + 1 个打开对话框；而 `views/time/setdatedialog.xaml` 的 `QuickDatePanel` 是 **4 档（今天/明天/下周/下月）** + `EmptyBox`（清除）。⇒ **菜单里没有"下月"**，对话框里也没有"用对话框"这一项（它本身就是）。差额恰好一格 |
| V2 | **J3 的边界被摊平**：`\|List` 把 13 个视图做成 13 个**独立菜单项** | 每加一个视图，菜单就长一寸。这是"菜单当常量用"的反面（对比：它给日期用的是**档位**，不是"每个日期一个菜单项"） |
| V3 | **打印有两处**（`\|Task` + 详情「更多」`Print`） | 这一处重复**有理由**：全局那处不依赖选中（可以打印当前视图？未核实），对象那处打印单条。但它也是全篇唯一一处"同一动作两个层"——其余重复都在同一层内 |

---

## 4. Q3：三条主链路

**计数定义（先钉死再数）**：
**点击** = 一次指针按下并抬起。**键入不算点击**；焦点被系统自动给出不算点击。
**深度** = 从主界面出发、动作经过的**可交互表面层数**（主界面本身算第 1 层）。
所有点击次数是**控件清单推导**，不是真机计时（§8 第 9 条）。

### 4.1 链路 ①：新建一条任务，设日期 + 优先级

**Windows（可逐数，因为三个表面都有 XAML）**

| 步 | 动作 | 证据 | 点击 |
|---|---|---|---:|
| 1 | 点任务输入区 | `views/quickadd/quickaddview.xaml`：`InputBorder` / `TitleGrid` / `TitleText` | 1 |
| 2 | 打字 | 同上 | 0 |
| 3 | 点日期 | `quickaddview.xaml` 的 `SetDateBorder` / `SetDatePath` | 1 |
| 4 | 选快捷日 | `views/time/setdatedialog.xaml` 的 `QuickDatePanel`（今天/明天/下周/下月） | 1 |
| 5 | 确认 | 同一文件的 `SaveButton` | 1 |
| 6 | 点优先级一档 | `views/quickadd/addoptiondialog.xaml` 的 `PriorityGrid` | 1 |
| 7 | 提交 | `quickaddview.xaml` 的 `AddPath`（或回车） | 1 |

**合计 6 次点击 / 深度 3**（主窗 → 快速添加 → 日期对话框）。
⚠️ 若 `addoptiondialog` 是**独立浮层**（不是快速添加内的常驻条），优先级那一步就再深一层 ⇒ 深度 4。见 §8 第 6 条。

**macOS（交叉校验，路径不同）**

| 步 | 动作 | 证据 | 点击 |
|---|---|---|---:|
| 1 | 点行内输入条 | `TTTaskListInputView.nib` | 1 |
| 2 | 打字 | 同上 | 0 |
| 3 | 点日期 | `dateButtonClicked:` | 1 |
| 4 | 选一天 | `TTDueDatePickerSetDateView.nib` 的 `datePickerValueChanged:` | 1 |
| 5 | 确定 | `TTDatePickerViewController.nib` 的 `okClicked:` | 1 |
| 6 | 点优先级 | `priorityButtonClicked:` | 1 |
| 7 | 选一档 | 单选弹层；`TTPopupSingleSectionPickerVC.nib` 有 `okClicked:` ⇒ **可能需要第 8 次** | 1~2 |
| 8 | 添加 | `addButtonClicked:` | 1 |

**合计 6~7 次点击 / 深度 3**。两端同档。

**另一条路径（两端都有）**：`TTQuickAddViewController.nib`（7 个 action：`calendarButtonClicked:` `priorityButtonClicked:` `projectButtonClicked:` `tagButtonClicked:` `modeTypeButtonClicked:` `confirmButtonClicked:` `cancelButtonClicked:`）
⇒ 一屏内把三个字段填完 = **5 次点击 / 深度 2**（1 打开 + 1 点日期 + 1 选日 + 1 点优先级 + 1 确认；打字与提交不另计）。它的**快捷键入口**在 Windows 是全局热键（[P5](ticktick-keyboard-and-menus.md) §4），在 macOS 是 `|File` 第 1 项。

### 4.2 链路 ②：打开一条任务的详情，加一个子任务

**Windows（这一条是三条里最深的）**

| 步 | 动作 | 证据 | 点击 |
|---|---|---|---:|
| 1 | 点任务行 | 行模板 XAML **没解出来**（`/tmp/rea-lab/win/xaml/convert-failures.tsv` 唯一一条：`views/tasklist/item/subtasklistitem.baml`）⇒ 未核实 | 1 |
| 2 | 详情出现 | `views/detail/taskdetailwindow.xaml` 的 `Detail`，或 `taskdetailpopup.xaml`（同一份内容的弹窗形态） | 0 |
| 3 | 点底栏「更多」 | `taskdetailbottomcontrol.xaml` 的 `MoreGrid` | 1 |
| 4 | 点「新建子任务」 | `taskdetailmorecontent.xaml` 的 `NewAddSubTaskItem` / `AddSubTaskClick` | 1 |
| 5 | 输入标题 | 同上 | 0 |
| 6 | 提交（回车） | 同上 | 1 |

**合计 4 次点击 / 深度 4**（主窗 → 详情 → 底栏更多 → 子任务输入）。

**macOS（比 Windows 浅一层）**

| 步 | 动作 | 证据 | 点击 |
|---|---|---|---:|
| 1 | 点行 | `TTTaskListStandardCell.nib` / `TTTaskListDetailedCell.nib` | 1 |
| 2 | 详情出现（侧栏或弹窗，由显示选项决定） | `TTSingleTaskDetailViewController` / `TTTaskDetailContainerViewController`；形态由 `TTListDisplaySettingsVC.nib` 的两个 action 决定 | 0 |
| 3 | 在子任务格直接加 | `TTSubtasksCell.nib`（`rightArrowButtonClicked:` / `checkButtonClicked:`）；`TTSubtasksViewController` **没有 action** ⇒ 子任务区是内联的 | 1 |
| 4 | 提交 | 同上 | 1 |

**合计 3 次点击 / 深度 3**。

🔴 **这一条是本文最有价值的差**：同一个动作，macOS 把它放在**详情内联**（3/3），
Windows 把它放进**底栏「更多」**（4/4）。而两端都**没有**把它放进行菜单。
⇒ 「加子任务」的层归属是跨平台一致的（对象层），**深度**是平台各自的取舍。

### 4.3 链路 ③：从主界面进设置，改一个外观项

| 平台 | 步 | 动作 | 证据 | 点击 |
|---|---|---|---:|---:|
| macOS | 1 | 按 `⌘,` **或** 菜单栏第 1 个菜单第 2 项 | `/tmp/rea-lab/out/menu.json`：应用菜单第 2 项，`mods`/`key` = ","；**业务 29 项里唯一带键的就是它** | 0 / 2 |
| macOS | 2 | 左栏点「外观」组 | `TTSettingsWindowController` → `TTThemePreferencesViewController.nib`（其 cell 是 `TTThemePreferencesStyleItem.nib` / `…AppIconItem.nib` / `…BadgeItem.nib`） | 1 |
| macOS | 3 | 点一档主题 | `TTThemePreferencesStyleItem.nib` 的 `styleButtonClicked:`（另有 `autoDarkButtonClicked:`） | 1 |
| **macOS 合计** | | | | **2 点击（快捷键）/ 3 点击（菜单）/ 深度 3** |
| Windows | 1 | 托盘或入口打开设置 | `views/settingdialog.xaml` | 1~2 |
| Windows | 2 | 左栏菜单选一档 | `views/settingdialog.xaml` 的 `MenuListView` + `SettingContainer` | 1 |
| Windows | 3 | 点一格主题 | `views/theme/appearancecontrol.xaml` 的 `ThemeSelectGrid`（同一文件还有 `AppIcons` / `FontFamilyCtrl` / `FontSizeCtrl` / `ProjectListColorVisCtrl` / `ProjectNumSetCtrl` / `CompleteLineSetCtrl`） | 1 |
| **Windows 合计** | | | | **3~4 点击 / 深度 3** |

**旁证**：外观不止"明暗"一档 —— `views/theme/interfacestylewindow.xaml` 里只有两枚单选
（`FlatRadioButton` / `CardRadioButton`），即"扁平 / 卡片"是**独立的一次选择**，
不在主题格里。⇒ 它把外观拆成**三个互不嵌套的页**（主题格 / 界面风格 / 应用图标），
而不是"主题页里再放三层"。这是 §6 的节制原则在设置页上的样子。

### 4.4 三条链路的读数汇总

| 链路 | macOS 点击 / 深度 | Windows 点击 / 深度 | 两端是否同档 |
|---|---|---|---|
| ① 新建 + 日期 + 优先级（行内） | 6~7 / 3 | 6 / 3 | ✅ 同档 |
| ① 新建 + 日期 + 优先级（快速添加窗） | 5 / 2 | 5 / 2（未核实，见 §8 第 6 条） | ✅ 同档 |
| ② 打开详情 + 加子任务 | **3 / 3** | **4 / 4** | ❌ Windows 深一层 |
| ③ 设置 + 改外观 | 2~3 / 3 | 3~4 / 3 | ✅ 同档 |

---

## 5. Q4：与 heyta 逐条对账

> 这一节只给"差在哪"，不给"该怎么改"（改法在 §7 的规则里）。
> 行号是**本机 2026-11-06 当前工作树**的读数，引用前先 `grep -n` 复跑。

### 5.1 heyta 有动作、但**没有稳定入口**

"没有稳定入口"的判据（三条取一即可）：
① 全仓 0 个 UI 调用点；② 只有 1 个入口且该入口**条件消失**（空态/窄档/未配置）；③ 入口在共享层有词条、在壳层无落点。

| # | 动作 | 现状 | 证据 |
|---|---|---|---|
| A1 | **放弃任务**（第五态） | web **零入口**。共享词汇表里有 `abandon` / `unabandon`，移动端有图标与页面，web 一处都没有 | `packages/ui/src/task-list/row-actions.ts:40`（`RowActionId` 含 `abandon`）vs `grep -rn abandon apps/web/src` = **0**；移动端在 `apps/mobile/src/ui/icons.tsx:116` |
| A2 | **截止日期** | 只剩**详情面** 1 处可编辑；行尾编辑器已撤，但注释还在教人它还在 | `apps/web/src/features/tasks/TaskDetailCard.tsx:431`（唯一 `DueField`）；`apps/web/src/features/tasks/DueEditor.tsx:9-10` 的注释仍写「`App.tsx` 行尾」——**该组件全仓 0 个渲染点**（`grep -rn '<DueEditor'` 只命中测试里的反断言） |
| A3 | **提醒 / 重复** | 只在详情面。窄档走 `WebModalShell` 里同一张卡 ⇒ 不算丢；但**行上无任何徽标能看见"这条有提醒"** | `apps/web/src/features/tasks/TaskDetailCard.tsx:452`（`ReminderField`）、`:545`（`RepeatField`） |
| A4 | **优先级** | 2 个入口（详情原生 select + 行菜单），**没有一处是"行上一眼可见 + 一点即改"** | `apps/web/src/features/tasks/TaskDetailCard.tsx:519`、`apps/web/src/App.tsx:3989` |
| A5 | **排序** | 只有 `⋯` 里 1 处（这是收敛后的结果，本身没错）；但"空列表时也在渲染"这条纪律只写在注释里 | `apps/web/src/App.tsx:2973`（`task-menu-open`）+ 同处 `TASK_SORT_KEYS` 菜单组 |

### 5.2 同一动作 2 个以上入口（记一笔，不必然是缺陷）

| # | 动作 | 入口数 | 都在哪 | 判断 |
|---|---|---:|---|---|
| B1 | **完成** | **4**（+1 键盘） | 行勾选 `packages/ui/src/task-list/TaskRow.tsx:350`；批量 `apps/web/src/App.tsx:2811`；行菜单无；键盘 Space（`apps/web/src/lib/keyboard-cursor.ts:262`）；详情**没有** | ⚠️ 详情里没有勾选 ⇒ 用户在详情改完东西想完成，要回去列表 |
| B2 | **删除** | 3（其中 2 个同一目的地） | 行菜单 `apps/web/src/App.tsx:3988`、详情「更多」→ 同一个菜单 `apps/web/src/features/tasks/TaskDetailCard.tsx:627`、批量 `apps/web/src/App.tsx:2865` | ✅ 可接受：后两条是"同一菜单的另一条输入通路"（C3 口径），不是两个行为 |
| B3 | **移清单** | **3** | 详情 `apps/web/src/features/tasks/TaskDetailCard.tsx:473`；行菜单 `apps/web/src/App.tsx:3991`；看板拖拽 `apps/web/src/App.tsx:3372` | ⚠️ 三条里看板那条是**另一个语义**（拖到某列 = 改清单？）→ 命名与语义要对齐 |
| B4 | **标签** | 2 | 详情 `apps/web/src/features/tasks/TaskDetailCard.tsx:476`；行菜单 `apps/web/src/App.tsx:4000` | ✅ 同一层内两处，符合"单条→对象层" |
| B5 | **详情面板开关** | **2 且同时可见** | 页头图标 `apps/web/src/App.tsx:3064`；`⋯` 里 `apps/web/src/App.tsx:3031` | 🔴 **真缺陷**：注释写"页头那枚图标让位给助手"（`:3026`），但 `:3064` 那枚**没有任何 `detailColumnShown` 条件** ⇒ 收起态下两枚「展开详情栏」同时在场 |
| B6 | **助手** | 2 | rail 底部（`onOpenAssistant`，`apps/web/src/App.tsx:2562`）；`⋯` 里 `apps/web/src/App.tsx:3015`（仅在详情列收起时） | ✅ 互斥条件成立，不算重复 |

### 5.3 违反它归纳出的规则的地方

| # | 违反哪条 | heyta 现状 | 证据 |
|---|---|---|---|
| C1 | **J1 字段层几乎不存在** | 行上无任何就地编辑器（"行尾那一排编辑器撤掉之后"），字段编辑全收进详情面 ⇒ 改一条任务的日期至少 **3 次点击**（点行 → 点截止 → 选日），而它在行上**一跳**就完成 | `apps/web/src/App.tsx:3997` 的注释（`onAddSubtask` 那段的理由）；对账见 §4.1 与 `CaptureComposer` 的 chip 设计 |
| C2 | **J2 的两套词汇表** | 共享层行动作 **7 个 id**（`open/pin/unpin/abandon/unabandon/select/delete`），web 行菜单是**另一组 7 个**（打开/优先级/移动/加子任务/标签/删除/置顶）—— 交集只有 3 个 | `packages/ui/src/task-list/row-actions.ts:40-47` vs `apps/web/src/features/tasks/TaskRowMenu.tsx:317,370,425,480,508,630` |
| C3 | **J3 多选作用域缺动作** | 多选工具条只有完成与删除（+ 重复警告 + 退出 + 撤销）⇒ **多选后不能批量改期/优先级/标签/移清单**；而它的 `batchtaskcontrol` 恰好是这 5 个 + 更多 | `apps/web/src/App.tsx:2811` `:2865` `:2874` `:2891` vs `views/misc/batchtaskcontrol.xaml` 的 6 枚 |
| C4 | **J4 全局层不装任务动作** | heyta 桌面壳有托盘 4 项（今天/快速添加/显示主窗/退出）与全局热键，**装的都是窗口与唤出，一个任务动作都没有**；web 侧 `⌘,` 开设置只在桌面壳拦（`apps/desktop/src/main.ts:467`） | `apps/desktop/src/summon-commands.ts:19`（`TRAY_COMMANDS` 4 项）、`apps/desktop/src/global-summon.ts:194`（`globalShortcut.register` 调用点）、`apps/desktop/src/settings-shortcut.ts:20` |
| C5 | **J6 的镜像不严格（同 V1）** | web 只有 `⌘K`（搜索）与 `⌘⇧\`（详情栏）两个全局键；**"设今天/设明天/完成/优先级"一个键都没有** —— 而它的 `\|Task` 恰好就是这四组档位 | `apps/web/src/App.tsx:1412`（`⌘⇧\`）、`apps/web/src/App.tsx:2285`（`⌘K`） |

### 5.4 heyta 已经做对、别改坏的

| # | 已经成立的事 | 证据 |
|---|---|---|
| D1 | **"截止只能一处可编辑"已有能红的判据** | `apps/web/tests/task-detail-card.spec.tsx:817`：断言 `<DueEditor/>` 不许回到行上，报错文案是"截止两处可编辑" |
| D2 | **行菜单不许内联六个编辑器** | `apps/web/tests/task-row-menu.spec.tsx:507` 逐个断言 `NoteEditor` / `SubtaskPicker` / `TaskOrganizer` / `TaskRepeat` / `DueEditor` / `ReminderPanel` 不在菜单里 |
| D3 | **页头动作预算已有一把尺** | `scripts/check-surface-budget.mjs` 七格（页头只许一枚 `⋯`、不许 `<select>`、不许 `<label>`、`.ht-header__actions` 只许一处）——这是本仓**唯一**在量"件数"的门禁 |
| D4 | **菜单键盘模型只有一份判断** | `scripts/check-menu-keyboard.mjs` M1~M4（每枚 `role="menu"` 必须接 `useMenuKeyboard`） |
| D5 | **空态动作槽默认不画** | `packages/ui/src/empty-state/EmptyState.tsx:206`（不传 `action` ⇒ 零枚可点控件，判据 `apps/web/tests/empty-state-action.spec.tsx`） |

---

## 6. 入口密度与节制

这一节回答"**哪些动作它从不放在工具条上**"—— 也就是"节制"在哪。

### 6.1 从不进工具条的：结构类动作

**工具条（视图层页头）永远只有"与选中无关"的动作**。三类动作**一个都不进**：

| 动作族 | 它去了哪 | 举证 |
|---|---|---|
| 加子任务、关联父任务、置顶、放弃、转笔记、转日程、复制链接、导出、打印 | 详情「更多」的第 2 跳 | `taskdetailmorecontent.xaml` 的 17 个 item 事件里，**没有一个**出现在任何 `*ViewController.nib` 的工具条 action 列表里 |
| 删除 | 详情底栏 + 详情「更多」+ 回收站（三级代价） | `DeleteGrid` / `DeletePanel` / `RemoveButton` 三处 |
| 改优先级/日期/标签 | 字段层或对象层弹出 | 三个视图页头合计 **21 个 action**（8 + 5 + 8），**没有一个是"改某条任务的字段"** |

**为什么**：工具条在**没有选中任何东西**时也得有意义。一个"加子任务"按钮在空列表里点了会怎样？
它不能问 —— 所以它不该在那儿。

### 6.2 只在详情里的：17 项

`views/detail/taskdetailmorecontent.xaml` 的 17 个 item 级动作（名字见 §2.2 那张表）**只在详情**。
其中**连行菜单都没有**的代表：加子任务、关联父任务、插摘要、用模板、复制链接、转笔记、转日程、导出。

**这一格的读数对比**：

| 层 | 动作数 | 载体 |
|---|---:|---|
| 行菜单 | 4~6（子项清单未核实，见 §8 第 3 条） | `TTTaskMenuViewController.nib` |
| 详情顶栏 | 6 | `TTTaskDetailTopView.nib` |
| 详情底栏（Windows） | **5** | `taskdetailbottomcontrol.xaml` |
| 详情底栏（macOS） | **8 个 action** | `TTTaskDetailBottomActionView.nib` |
| 详情「更多」 | **17** | `taskdetailmorecontent.xaml` |
| 多选工具条 | **6** | `batchtaskcontrol.xaml` |

⇒ **底栏 5、更多 17**。它把"5 枚常驻 + 17 枚一跳可达"当成一个**比例**在用，
而不是"能放就放"。`views/detail/taskdetailbottomcontrol.xaml` 的 `TaskDetailUnit` 高度是 `44`
（同一文件里写死），也就是说：**底栏的高度预算是常量，所以常驻动作数也是常量**。

### 6.3 只在空态里才出现的

三个真证据（都是"空态自带一枚 button"的形状）：

| 证据 | 空态里的动作 |
|---|---|
| `TTCalConnectedAccountPreferenceViewController.nib` 的 **`emptyActionButtonClicked:`** | 空态**专门有一个 action 名**，点名它是"空态里的那枚动作" |
| `TTTaskListViewController.nib` 的 `emptyTrashButtonClicked:` | 回收站空态/页头的收尾动作 |
| `TTProjectListEmptyHolderCell.nib` + `views/project/emptyprojectcontrol.xaml` + `TTEmptyHolderWindowController.nib` | 三处独立的空态载体（列表 / 项目 / 窗口），**空态是一个一等公民**，不是一段文字 |

**它的空态与 heyta 的一个结构性差别**：heyta 的空态槽 `action` **默认不画**
（`packages/ui/src/empty-state/EmptyState.tsx:206`，判据 `apps/web/tests/empty-state-action.spec.tsx`）——
这是一个**保护**（不传就没有可点控件），但也意味着"空态给一个主动作"在 heyta 里**不是默认行为**。
对照 [P7](ticktick-states-and-feedback.md)：它的空态是"一句话 + 至多一枚动作"。

### 6.4 节制读数（一张表看完）

| 问题 | 它的答案 |
|---|---|
| 页头能有几枚控件？ | 看板 5、时间线 8、列表 8（`*ViewController.nib` 的 action 数）。**页头不是常量，但每一枚都是"视图属性"** |
| 一条任务的常驻动作有几枚？ | Windows **5 枚**（详情底栏，高度在 XAML 里写死 `44`）；macOS 那一份绑 8 个 action |
| 一条任务的低频动作去哪？ | 「更多」的**第 2 跳**，17 项 |
| 多选能做什么？ | **6** 项（改期/推迟/移清单/改优先级/改标签/更多）+ 删除 |
| 空态能有动作吗？ | 能，**至多一枚**（`emptyActionButtonClicked:`） |
| 全局层能发明新动作吗？ | 不能（J6）—— 它只镜像已有档位 |

---

## 7. 五条可借鉴规则（每条都能判红）

> 每条格式：**规则** / **为什么** / **判据**（能写成什么会失败的检查）/ **现量**。
> 现量都会漂，引用前跑一遍。

### R1 一个字段只有一个可编辑落点

**规则**：同一条任务的同一个字段（截止/优先级/标签/清单/标题/提醒/重复），
**有且只有一个"编辑落点"**。可以有多条**输入通路**（右键、键盘、详情按钮）指向同一落点，但不许有两个落点。

**为什么**：两个落点必然漂 —— 一处支持"清除"另一处不支持，一处写一条 op 另一处写两条。
heyta 已经为"截止"付过这个代价，也已经修好并留了判据。

**判据**：新建 `scripts/check-field-single-source.mjs`（🔴 **今天不存在**，它是本条规则的产物，不是现状）—— 扫 `apps/web/src/**/*.tsx` 里对
`store.setPriority` / `setDueDate` / `setTags` / `moveToProject` / `rename` 的**渲染点**
（不是 store 定义），每个字段的落点文件数必须 = 1。

**能红吗**：能。把 `DueEditor` 重新挂回行上 ⇒ 现成的 `apps/web/tests/task-detail-card.spec.tsx:817` 立刻红，
报错原文就是"截止两处可编辑"。这条规则只是**把那条测试的判据推广到 6 个字段**。

**现量**：截止 ✅ 1 处（`apps/web/src/features/tasks/TaskDetailCard.tsx:431`）；优先级 ⚠️ 2 处（同文件 `:519` / `apps/web/src/App.tsx:3989`）；
标签 ⚠️ 2 处；清单 ⚠️ 3 处。

### R2 一个动作的"用户可见入口"进账本，只减不增

**规则**：每个用户可执行的动作（`TaskActions.*` **以及壳级动作**，如详情面板开关），把它**用户可见的触发点**
写成一张账本（`动作 id → [(文件, 控件标识)]`）。账外出现即红；账内条数**涨了**红；**掉了也红**（要求同步把账本改小）。

**为什么**：这条抄的是本仓已经在用的两把尺（`check:overlay` 的账本制、`check:surface-budget` 的七格）。
"入口数量"不是问题，"**没人知道现在有几个**"才是问题。

**判据**：账本住 `docs/plans/` 某份计划的一段围栏块，脚本读它并与源码对账；
三臂自证（账外新增 ⇒ 红 / 账内删一项 ⇒ 红 / 账内加一项 ⇒ 红）。

**能红吗**：能，且现在就能红 —— B5（详情面板开关两处同时在场）会被它抓出来。

**现量**：完成 4、删除 3、移清单 3、标签 2、优先级 2、置顶 1、排序 1、分享 1。

### R3 全局层只许放镜像，不许发明新动作

**规则**：托盘项、全局热键、应用菜单项引用的动作 id，**必须**同时出现在视图层或对象层的动作表里。
否则红 —— 那说明这个动作只从"全局"可达，它没有归属地。

**为什么**：这是它 29 个业务菜单项能成立的前提（§3.1 J6）；
反过来说，只要允许全局层发明动作，全局层就会慢慢变成一个**没人敢删的垃圾场**。

**判据**：新建 `scripts/check-global-mirror.mjs`（🔴 **今天不存在**）—— 取 `apps/desktop/src/summon-commands.ts` 的
`TRAY_COMMANDS` 与 `SUMMON_COMMANDS`、以及菜单模板里的动作 id，逐个断言它在
`apps/web/src/App.tsx` 或某 `features/*/` 里有非全局的触发点（同一 action 函数或同一 store 方法）。

**能红吗**：能。往托盘加一项"清空回收站" ⇒ 红（该动作只在回收站视图）。

**现量**：绿。托盘 4 项（`apps/desktop/src/summon-commands.ts:19`）里 `today` / `quickAdd` / `showMainWindow`
三项在视图层或对象层都有落点；`quit` 属 J4 的例外 —— 它的"归属地"就是窗口本身（关窗 / 系统菜单），不在任务语义里。

### R4 空态动作必须是非空态已存在的同一入口

**规则**：空态里渲染的那枚 action，它的 testid 必须**也**能在非空态找到。
空态**不许**成为某动作的唯一入口。

**为什么**：空态是"用户什么都还没有"的状态 —— 这时才出现的动作，用户第二次就再也找不到。
它是**引导**，不是**入口**。

**判据**：在 R2 的账本上多一列 `emptyState: boolean`；同一 action 若 `emptyStateOnly === true` ⇒ 红。

**能红吗**：能。给空态加一枚"导入示例数据"而别处没有 ⇒ 红。

**现量**：绿（且是**空集** —— heyta 的空态要么不给动作，要么给的是"新建"这种别处也有的）。

### R5 从主界面到"改一条任务"不许超过 3 层

**规则**：任何一个改单条任务的动作（完成/日期/优先级/标签/清单/提醒/重复/子任务），
从主界面出发**最多 3 层**。第 4 层就是"藏起来"。

**为什么**：它的加子任务在 Windows 是 **4 层**（§4.2），而同一动作在 macOS 是 3 层 ——
**同一家公司的两个端，一个越了线**。这不是审美判断，是它自己给的对照实验。

**判据**：e2e 里每点一次记录可见浮层数（`[role="dialog"],[role="menu"],[data-overlay]` 中
`display !== none` 的层数），走完最短路径后断言 `maxDepth ≤ 3`。

**能红吗**：能。把"加子任务"从详情内联挪进「更多」⇒ 立刻读到 4。

**现量**：**未测**。heyta 今天的加子任务从行菜单进是 3 层（行菜单 → 详情 → 子任务格），
从详情进是 2 层；但**没有这条 e2e**，所以"没越线"目前是**推断不是读数**。

---

## 8. 未核实（这一节不是免责声明，是待办清单）

| # | 未核实的事 | 为什么核不了 | 核它需要什么 |
|---|---|---|---|
| 1 | **Windows 的行模板长什么样** | 638 个 XAML 是 639 BAML − 1 个转换失败（`/tmp/rea-lab/win/xaml/convert-failures.tsv` 唯一一条 = `views/tasklist/item/subtasklistitem.baml`，异常是 `ListItemContent` 类型初始化失败） | 在 Windows 上跑一遍反编译（不是转换），或用 UI 自动化读控件树 |
| 2 | **那个右键菜单到底挂在哪个控件上** | XAML 里 `MouseRightButton` = 0，处理器在 IL 里（`OnItemRightClick` / `OnMouseRightButtonUp`）；而 `ContextMenuStyle` 在 XAML 里 0 处定义 | 反编译对应类型的 `InitializeComponent` 之后的挂载代码 |
| 3 | **行菜单到底有几项、哪几项** | `TTTaskMenuViewController.nib` 只解出 `buttonsAction:` 一个 action —— cell 是**动态生成**的，nib 里没有静态子项 | 运行时读菜单，或反编译 `TTTaskMenuViewController` |
| 4 | **它是 hover 触发还是右键触发** | `TTTaskMenuButtonCellView.nib` 里只有 `buttonsAction:`，没有任何鼠标事件 | 同 #2 |
| 5 | **优先级是"点即选"还是"要确定"** | 单选弹层 `TTPopupSingleSectionPickerVC.nib` 有 `okClicked:`，但优先级是否走它不确定 | 真机一次点击 |
| 6 | **`addoptiondialog` 是常驻条还是独立浮层** | 它是独立 BAML，但被 `quickaddview.xaml` 里的哪个容器承载，XAML 上看不出来 | 真机，或看 `QuickAdd` 的 ViewModel |
| 7 | **那些视图/功能对普通账号是否可见** | 没登录，看不到权益闸门（`PremiumFeatureView` / `TTUpgradeWindowController` 等文件在包里，说明有闸） | 一个免费账号 + 一个付费账号各跑一遍 |
| 8 | **`Command 44` 这个读数** | 本机复跑对不上（`Command="` 110 处、`\bCommand\b` 125 处 / 40 文件） | 与给出这个数的人对一次口径 |
| 9 | **所有点击次数** | 全部是**控件清单推导**（每个控件激活 = 1 次点击），不是真机计时；打字次数按 0 计 | 真机录屏逐步计数 |
| 10 | **`/tmp/rea-lab/out/menu.json` 的 `disabled`** | 29 个业务项的 `disabled` **全是 `null`** —— 那是"没记录"，不是"都可用" | 真机逐项看灰不灰 |
| 11 | **`ContextMenuStyle` 长什么样** | 只在托管字符串堆里见到键名（`/tmp/rea-lab/out/w-exe-u16.txt:2464`），XAML 里 0 处定义 | 反编译资源字典 |
| 12 | **全局层是否真的"只镜像"** | §3.3 V1 已经证伪了它的严格性（日期档位两处集合不同） | 逐档做集合比对（本文只比了日期与优先级两组） |

🔴 **两条口径纪律，读本文时请一起带走**：
- **「BAML 里有一个 Popup」≠「那个右键菜单挂在那个控件上」**（#2）；
- **「文件名存在」≠「用户真的能走到」**（#7）。

---

## 9. 与既有文档的关系（不重复，只对账）

| 那一份 | 它管什么 | 本文管什么 |
|---|---|---|
| [P2 界面地图](ticktick-surface-matrix.md) | **哪一屏存在**（79 行三方差集） | **那一屏上的动作从哪出来** |
| [P5 菜单与快捷键](ticktick-keyboard-and-menus.md) | 菜单 62 = 7 + 55、13 个键、29 个业务项 0 键 | 只引用它的读数，**不重数**；本文新增的是"全局层装哪四组档位"与"镜像不严格"（§3.3 V1） |
| [P7 状态与反馈](ticktick-states-and-feedback.md) | 空/载/错/危四态 × 双端 | 只取"空态里有一枚动作"这一格（§6.3），摩擦曲线不重复 |
| [P0 BAML→XAML 通道](ticktick-baml-xaml-pipeline.md) | 尺寸/圆角/间距的事实来源 | 只用它的**产物**，并登记它唯一的一次转换失败（§8 #1） |
| [桌面端逆向取证](ticktick-desktop-teardown-2026-11.md) | 主干（包结构 / 数据 / 接口） | 本文是**支线**：只回答"入口链路" |
| [heyta 的 UX 结构原则](../agents/ux-principles.md) | 界面**解剖**（两档布局 / 一档高度 / 动作常驻） | 本文补的是它 §10 "空间归属"那一层缺的**跨对象规则**（动作该在哪一层） |
| [浮层与反馈](../agents/overlay-feedback.md) | 浮层**行为**（怎么关 / 多危险 / 多久消失） | 本文只碰"浮层**在层级里的位置**"，关法与时长不重复 |
| [产品级 IA/UX 审计](product-level-ia-ux-audit.md) · [审美与 IA 审计](product-ux-ia-aesthetic-audit.md) | heyta 自己的 IA 结论与整改台账 | 本文 §5 与它们交叉核对：**不推翻它们的结论**，只补"入口归属"这个维度；§5.4 记下它们整改后已经成立、别再改坏的 5 条 |

⚠️ 本文是**独立分包**，**没有**登记进 [取证总目录](ticktick-teardown-index.md)（那份文件由另一条线维护，
本文件不修改它）。若总目录要收编，读数一律以本文原文为准，不要抄进索引。
