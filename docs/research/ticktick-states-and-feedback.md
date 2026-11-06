# 四态与反馈：滴答清单 macOS / Windows 双端取证

> **这份文档只回答一件事**：滴答清单在两个桌面端上，「空态 / 加载 / 错误 / 危险确认」这四格
> 各长什么形状、我们仓的[危险四档](../agents/overlay-feedback.md)落在它的哪一格、哪几格它比我们紧。
> 它不回答「要不要做」，也不回答「怎么实现」。
>
> **取证日期**：2026-11-06。**对象**：本机 macOS 8.2.03（430 个解出的 nib 文档 / 436 个 nib 名）、
> Windows 8.2.5.0（639 个 BAML → 638 个 XAML，1 个转换失败）。
>
> 🔴 **三条硬边界**（与[桌面端取证](ticktick-desktop-teardown-2026-11.md) §5、[界面地图](ticktick-surface-matrix.md) §0 同一条）：
> ① **不贴截图**；② **不抄它的空态插画与文案** —— 本文只给 **string resource 的键名**
> （`NoIntegratedCalendar` / `NoTask` / `DeleteForever` 这类**标识符**）与结构事实。
> 全文只有**一处**逐字引用的界面串（§1.3 那条「要求逐字键入」的提示），
> 引用它的唯一目的是把 `typed-alert` 档与「输密码」区分开；**该串不复用、不进入任何文案建议**；
> ③ **DIP 与 pt 不混用**（见 §0.2）。
>
> **与既有文档的分工**：[界面地图](ticktick-surface-matrix.md) 回答「有没有这一屏」；
> [桌面端取证](ticktick-desktop-teardown-2026-11.md) 回答「它怎么做的」；
> [视图收敛](dida-view-unification.md) 是我们自己的裁决。本文是第四件东西：
> **一张四格形态表 + 一次档位映射**，专门喂给 `overlay-feedback.md` 的 T3 / T6 两档。

---

## 0. 口径

### 0.1 证据强度四档

每个结论后面必须带一档。**「未核实」不许被读成「没有」**。

| 档 | 判据 | 例 |
|---|---|---|
| **强** | 文件里有**可数的结构事实**（元素名、尺寸、枚举位、控件计数），换个人重跑探针得到同一组数 | 「`mainwindow.xaml` 里 `ToastGrid` 是 `VerticalAlignment=Bottom` + `Margin=0,0,0,70`」 |
| **中** | 只有**控件名/类名/键名**存在，形体或语义靠命名推断 | 「`TTProgressHUDWindowController.nib` 里有个 32×32 的 `NSProgressIndicator`」→ 是转圈不是进度条，靠的是尺寸与同类样本 |
| **弱** | 只有**动作选择器名 / 字符串键名**，没有任何结构 | 「`emptyTrashButtonClicked:` 这个 selector 存在」 |
| **未核实** | 拿不到能判的证据（正文是延迟块、类无 XAML 载体、控件由代码构造） | 「Windows 主任务列表的空态」 |

⚠️ **同一格里可以既有「强」也有「未核实」**：真实宿主里空态占位与列表控件同矩形（强），
但占位里画的是什么（未核实）。表里逐条标，不按格取最高的那一档写整格。

### 0.2 单位：两栏各说各的，**一个数都不换算**

| 端 | 单位 | 为什么 | 本文怎么写 |
|---|---|---|---|
| Windows（WPF） | **DIP** = 1/96 英寸 | `FontSize="13"` / `Height="40"` 都是 DIP，**不是 pt** | 数字后缀一律写 `DIP` |
| macOS（Cocoa） | **pt** = 1/72 英寸 | nib 的 `NSFrameSize` / `NSWindowRect` 是 point | 数字后缀一律写 `pt` |

🔴 **两栏的同名量级不可直接比大小。** 例如 Windows 的 `FontSize=13`（DIP）与 macOS 的
title 29 pt 不是「一个大一个小」的两个字号档 —— 前者是正文行高基准，后者是对话框标题框高度。
本文**不做**「谁的字大」这类跨栏结论；要比就各自和自己那一栏的历史读数比。
（真要换算：1 pt = 4/3 DIP。本文一次都不用这条换算式，因为一旦用上，读者就没法从原始读数反推了。）

### 0.3 三条硬限制（会直接影响你怎么读下面的表）

**限制一：Windows 的 token 与文案**正文是 `DeferrableContent` 延迟块，**转成 XAML 后只剩注释**。
这不是「少量丢失」——**用 `convert-manifest.tsv` 的字节数算出来的保留率是 0.3%**：

```sh
# 现量（cwd = /tmp/rea-lab/win/xaml，读转换清单自己的两列字节数）
python3 - <<'PY'
import csv
rows=list(csv.DictReader(open('convert-manifest.tsv'),delimiter='\t'))
b=x=n=0
for r in rows:
    if not (r['baml_bytes'].isdigit() and r['xaml_bytes'].isdigit()): continue
    if r['xaml_relpath'].startswith('resource/'):
        b+=int(r['baml_bytes']); x+=int(r['xaml_bytes']); n+=1
print(f'resource/ 下 {n} 个：{b} → {x} 字节（保留 {x/b*100:.1f}%）')
PY
# resource/ 下 144 个：15003357 → 38095 字节（保留 0.3%）
# 最大的单个：resource/emptyicons.baml 558003 字节 → emptyicons.xaml 233 字节
# 全包 639 个：17096578 → 2196764 字节（保留 12.8%；那 12.8% 全在 views/ 里）

grep -rl 'deferred-stream' --include='*.xaml' /tmp/rea-lab/win/xaml/resource | wc -l   # → 142 / 144
wc -c < /tmp/rea-lab/win/xaml/resource/colorresource.xaml                              # → 231
```

⇒ 任何**颜色 / 字号 token 的具体数值**、任何**界面文案**，在 Windows 侧**一律读不出来**。
本文能读的只有：**控件名、几何字面量、string resource 的键名、以及 `DeferrableContent` 之外的内联字面量**。

**限制二：XAML 里有 Window 类 ≠ 这个态真被用到。**
`views/*.xaml` 是 WPF 的资源字典产物，一个 Window 类被打包进去，只说明**编译期存在**。
它是否被 `Show()` 过、挂在哪个入口后面，本文**一律不判**（见 §4）。

**限制三：macOS 的截断面只有「对象图」，不是「控件树语义」。**
430 个 nib 文档都给到了 `object_count` / `connection_count`、以及每个对象的 `class_name` +
`nibValues`（含 `NSFrameSize` / `NSSubviews` / `NSWindowStyleMask`）。
但 `NSClassSwapper` 换上去的自绘类，**子视图为空的占多数** ⇒ 「里面画了什么」读不出来。

### 0.4 复现探针

下面每条结论都来自这四条命令之一，cwd 与参数写在行内，可直接重跑。
（`/tmp/rea-lab/` 是本轮取证的解包目录，**不在仓库里**；它丢了就要按[桌面端取证](ticktick-desktop-teardown-2026-11.md) §0 重新解包。）

```sh
# P1  Windows：XAML 目录统计（638 个 .xaml）
find /tmp/rea-lab/win/xaml -name '*.xaml' | wc -l

# P2  Windows：按控件名/键名做命中计数（下面是「有撤销回执」这一条）
grep -rl 'ToastGrid' --include='*.xaml' /tmp/rea-lab/win/xaml | wc -l     # → 18

# P3  macOS：按 class_name 遍历 8 个分片的对象图
python3 - <<'PY'
import json,glob
for p in sorted(glob.glob('/tmp/rea-lab/out/nib-b*.json')):
    g=json.load(open(p))['normalized_result']['graph']
    for n in g['nodes']:
        a=n.get('attributes') or {}
        if 'EmptyHolderView' in (a.get('class_name') or ''): print(p, a.get('class_name'))
PY

# P4  macOS：窗口模板的 rect + styleMask（判「有没有关闭按钮」就靠这一位）
python3 - <<'PY'
import json,glob
for p in sorted(glob.glob('/tmp/rea-lab/out/nib-b*.json')):
    for n in json.load(open(p))['normalized_result']['graph']['nodes']:
        nv=(n.get('attributes') or {}).get('nibValues') or {}
        if 'NSWindowStyleMask' in nv: print(nv['NSWindowStyleMask'], nv.get('NSWindowRect'))
PY
```

**每条否定探针都配一条同命令换词的阳性对照**（仓内元规则：不能失败的检查没有价值）。
下表全是**同一个 P3 扫描**、只换关键词，行数为命中节点数（8 个分片合计）：

| 用途 | 关键词 | 命中 | 判 |
|---|---|---|---|
| 阳性对照 | `EmptyHolderView` | 44 | 扫描器本身在工作 |
| 阳性对照 | `Progress` | 48 | 同上 |
| 阳性对照 | `Alert` | 6 | 同上 |
| 阳性对照 | `Toast` | 3 | 同上 |
| 阳性对照 | `Loading` | 5 | 同上 |
| **否定** | `Skeleton` | **0** | 无骨架屏类 |
| **否定** | `Shimmer` | **0** | 同上（换词） |
| **否定** | `Placeholder` | **0** | 同上（换词） |
| **否定** | `Error` | **0** | 无错误专用类 |
| **否定** | `Fail` | **0** | 同上（换词） |

Windows 侧的否定同理：`Popconfirm` 命中 **0**，同一命令换 `Confirm` 命中 **18** 个文件；
`Offline` / `TryAgain` / `SomethingWrong` 命中 **0**，换 `Retry` 命中 **2**（都在 `views/ai/`）。

---

## 1. 四态 × 双端形态表

### 1.0 先给结论摘要（避免把表读成「两边差不多」）

| 态 | macOS 的形状 | Windows 的形状 | 共同点 |
|---|---|---|---|
| **空态** | **按容器分档**：大容器给「插画 + 一句 + 动作」，小容器给「一句居中话」；主任务列表的占位**与列表同矩形**但内容读不出 | 同左，且**多一档**：面板式（一张 154 DIP 的卡片 + 双 logo 示意 + 112×36 DIP 主按钮） | **都不是「永远居中一句『没有任务』」** —— 见 §5 对账 |
| **加载** | 按钮内 32×32 pt 转圈 + 行内 16×16 pt 转圈 + 一个 300×84 pt 的 HUD；**没有骨架屏类** | 行内环形 `LoadingIndicator`（`SpeedRatio=3`）+ 50×50 DIP 面板转圈 + 10 DIP 进度条；骨架屏**只出现在 AI 面板** | **骨架屏两端都只在 AI 面**；主列表一律「转圈 / 文字」 |
| **错误** | **没有 `Error*` 类**；错误走 alert 家族 + 内联标签 | `ErrorText` 内联红字（11 文件）+ `ErrorPopup`（3 文件，全是输入控件）；**全包只有 2 个文件有「重试」** | **没有统一的错误面板**；错误是「就地一行字」 |
| **危险确认** | 4 种窗口：普通 alert / **二按钮确认** / **单选确认** / **逐字键入**；`styleMask` **全部含 `Closable`** | 3 种形状：**勾选承诺** / **密码或逐字键入** / **后果三选一 + 目标下拉**；前两种带 `CloseButton`，删列那个**没有**（只有两个动作按钮） | **可撤销的动作不弹确认，不可撤销的才弹** —— 与 `resolveDangerTier()` 的锚同向（§2.1） |

### 1.1 空态

| 格 | 证据文件 | 结构事实 | 强度 |
|---|---|---|---|
| macOS · 主任务列表 | `TTTaskListViewController.nib` | `TTTaskListEmptyHolderView` 一个，frame **596×744 pt**；`NSSubviews` **为空**（内容由代码画） | 强（尺寸）/ 未核实（里面是什么） |
| macOS · 看板 | `TTKanbanViewController.nib` | 同类占位 frame **625×655 pt**，与本 nib 内 `TTKanbanCollectionView` 的 625×655 **精确相等** | 强 |
| macOS · 搜索 | `TTSearchViewController.nib` | 同类占位 frame **560×376 pt**，与根视图 560×376 **精确相等** | 强 |
| macOS · 习惯 / 通知 / 菜单栏列表 | `TTHabitListViewController.nib`（484×697）、`TTNotificationViewController.nib`（346×490）、`TTMenuBarTaskListViewController.nib`（312×606） | 同上，一个占位，无子视图 | 强（尺寸） |
| macOS · **24 种空态样本** | `TTEmptyHolderWindowController.nib` | 一个 `NSWindowTemplate`（560×680，`styleMask=3`）→ `NSScrollView` → `NSClipView` → `NSView` → `NSStackView` → **24 个** `TTTaskListEmptyHolderView`，**全部 720×450 pt**、全部无子视图；同一 nib 里 **27 个 outlet** | 强（计数与尺寸）/ 弱（它是什么：最可能是空态样本库或预览窗，机制未核实） |
| macOS · 团队清单（侧栏 cell） | `TTProjectListEmptyHolderCell.nib` | cell **392×103 pt**；内部一个 `NSView` 372×95 + 一个 `TTLabel` 356×79；**无图片、无按钮** —— 动作只写在句子里 | 强 |
| macOS · AI 推荐分类 | `TTAITaskRecommandAICategoryEmptyCell.nib` | 一个空 cell 类 | 中（存在性）/ 未核实（形体） |
| Windows · 看板 | `views/kanban/kanbancontainer.xaml` | `EmptyGrid`（`RowSpan=3`、`Margin="0,200,0,0"`、**`VerticalAlignment=Top` 不是居中**）内含 `tvm:EmptyView` + `EmptyText`（`Body01`，`LineHeight=20`）+ `EmptyAddText`（**`FontSize=12` DIP、`TextAccentColor`、手型光标**） | 强 |
| Windows · 四象限 | `views/eisenhower/quadrantcontrol.xaml` | 单个 `EmptyText`：`Text={StaticResource NoTask}`、**`Width=240` DIP**、`TextWrapping=Wrap`、`Style=Body05`、水平垂直都 `Center`、`TextAlignment=Center`；**无插画、无动作** | 强 |
| Windows · 日历连接（**最完整的一具**） | `views/config/calendarconnectinfowindow.xaml` | `EmptyGrid` → 一张 154 DIP 高的卡片（`BaseColorOpacity2`、`CornerRadius=8`、`Margin="24,68,24,0"`）里：**插画** = 40×40 DIP 本家 logo + 20×20 DIP 箭头（`Opacity=0.4`）+ 40×40 DIP 对方 logo；**一句话** = `FontSize=14` DIP、`LineHeight=18`、键名 `NoIntegratedCalendar`；**主行动** = 一个真按钮 `MinWidth=112` × `Height=36` DIP、`SaveButtonStyle` | 强 |
| Windows · 通知面板 | `views/misc/notificationcontrol.xaml` | `EmptyContainer` 是 `ContentControl`（`IsHitTestVisible=False`、`Margin="0,77,0,0"`）⇒ **内容整体由代码注入** | 强（槽位）/ 未核实（内容） |
| Windows · 空态图元 | `views/misc/emptyimage.xaml` | 类 `EmptyImage`：200×200 DIP 的 `Grid` = `Ellipse` 145×145（`BaseColorOpacity5`）+ `Image` 200×200 + `Path` 200×200（`EmptyPathColor`）⇒ **矢量路径式插画**，同一控件可换 path 出主题 | 强（结构）/ 未核实（具体画的是什么） |
| Windows · 主任务列表 | **无文件** | `views/mainwindow.xaml` 里 `Empty` 命中 **0**；`EmptyView` 被 10 个 XAML 引用但**全包没有 `emptyview.xaml` 定义文件** | 未核实 |
| Windows · 回收站 | 无独立 view | 见 §1.4 末段：**回收站不是空态的一格，而是列表/详情的模式切换** | — |

**三条从这张表掉出来的判断：**

1. **空态在滴答里不是一套，是「按容器分档」的两到三套**（强）。
   大容器（看板画布、连接面板）→ 插画 + 一句 + 动作；小容器（四象限、侧栏 cell）→ 一句居中话。
   ⇒ 这**不是不一致**，是**按可用面积选解剖**。我们的 `EmptyState` 四槽位
   （`packages/ui/src/empty-state/EmptyState.tsx` 的 `icon/title/hint/detail`）**装得下这两档**，
   装不下的是「动作写进句子里」那种（`TTProjectListEmptyHolderCell`）—— 那一档的「主行动」是**零控件**。
2. **主任务列表那一格两端都读不出**（未核实）：macOS 是占位无子视图，Windows 是 `EmptyView` 无 XAML 载体。
   所以任何「滴答主列表空态长什么样」的断言，本轮**没有证据**。
3. **看板那个 200 DIP 的顶距不是笔误**（强）：`Margin="0,200,0,0"` + `VerticalAlignment=Top` 是真的把空态
   压在距顶 200 DIP 的位置，**不随窗口高度居中**。这是一条可判红的行为差：
   我们的 `EmptyState` 若居中，打开一个高窗口时两者的观感完全不同。

### 1.2 加载

| 格 | 证据文件 | 结构事实 | 强度 |
|---|---|---|---|
| macOS · 提交按钮内的转圈 | `TTSignInViewController.nib`、`TTSignUpViewController.nib`、`TTCheckAccountViewController.nib`、`TTUniqueEmailViewController.nib`、`TTCaptchaCodeViewController.nib`、`TTPhoneSignUpViewController.nib`、`TTSignIn2FAViewController.nib`、`TTWelcomeViewController.nib`、`TTSummaryViewController.nib`、`TTPaymentWXPayQRCodeViewController.nib`、`TTAccountDeletionViewController.nib`、`TTChangePasswordViewController.nib` | 每个 nib 里一个 **32×32 pt** 的 `NSProgressIndicator`，位置落在表单按钮区 | 强（尺寸与控件）/ 中（语义：同形状 12 处，判为「按钮忙态」不是「进度条」） |
| macOS · HUD | `TTProgressHUDWindowController.nib` | 窗口 **300×84 pt**，`styleMask=7`（`Titled+Closable+Miniaturizable`）；内容视图 247×84；**32×32 pt 转圈** + 一行 `TTLabel`（115×15 pt）；那一行是 Interface Builder 里的英文 mock 假文（**不是产品文案**），真文案运行时注入 | 强 |
| macOS · 行内小转圈 | `TTSubtasksLoadmoreCell.nib`、`TTAttachmentFileView.nib`、`TTAttachmentImageView.nib`、`TTAttachmentAudioCell.nib`、`TTAttachmentImageCell.nib`、`TTAttachmentOtherCell.nib`、`TTTaskInputAttachmentItem.nib`、`TTMenuBarCalendarViewController.nib`、`TTMenuBarTaskListViewController.nib` | 一律 **16×16 pt** | 强 |
| macOS · 确定性进度 | `TTUpgradeWindowController.nib` | 一条 **160×12 pt** 的 `NSProgressIndicator`（长宽比偏条形 ⇒ 判为 determinate） | 中 |
| macOS · 骨架屏 | **无文件**（否定探针 §0.4 P3 换词） | 全包 class_name 里 `Skeleton` / `Shimmer` / `Placeholder` **命中 0** | 强（否定） |
| macOS · AI 列表占位 | `TTAISuggestionLoadingCell.nib`、`TTAITaskRecommandCategoryCell.nib`（内含 `TTAITaskRecommandLoadingClickView` 与 `TTAISuggestionLoadingCell` 两个类）、`TTAgendaCalLoadingDateCell.nib` | 三个**以 Loading 命名的类**，分布在 3 个 nib 文档里，即「列表行级的加载占位」——不是骨架条，是一整个 cell | 中 |
| Windows · 行内环形 | `views/tasklist/loadmoreitemcontrol.xaml` | `tv:LoadingIndicator`（`SpeedRatio=3`、`IsActive=True`、`LoadingIndicatorRingStyle`）+ 同排 `LoadMoreText`；整行 **`Height=44` DIP** | 强 |
| Windows · 面板转圈 | `views/misc/notificationcontrol.xaml` | `LoadingIndicator` **50×50 DIP**（`SpeedRatio=1`），与 `EmptyContainer` 同 `Grid.Row=1` ⇒ **加载与空态共用一个槽位** | 强 |
| Windows · 骨架屏 | `views/ai/skeletonloader.xaml` + `views/ai/airecommendwindow.xaml`、`views/ai/aicompletewindow.xaml`、`views/ai/aiaudiotransresultwindow.xaml` | 类 `SkeletonLoader` 的 XAML 正文只有一个 `UniformGrid Columns=1` ⇒ **每根骨架条由代码生成**；4 个引用者**全部在 `views/ai/`** | 强（分布）/ 未核实（骨架条形状） |
| Windows · 确定性进度 | `views/update/downloadprogressbar.xaml` | 自定义 `DownloadProgressBar`：`Height=10` DIP 的圆角底 + 一个 `Rectangle Width=0`（宽度绑定进度） | 强 |
| Windows · 环形进度 | `views/circleprogress.xaml` | `CircleProgress`：`OutsideArc`(R5) − `InsideArc`(R3) 的 `CombinedGeometry(Exclude)` ⇒ **半径 5/3 DIP 的环** | 强 |
| Windows · 主列表首次加载 | **无文件** | `views/mainwindow.xaml` 里 `Loading` / `ProgressBar` / `LoadingIndicator` 命中 **0** | 未核实 |

**掉出来的判断：**

1. **「骨架屏只给 AI」是两端一致的取舍，不是没做**（强）。macOS 连 skeleton 类都没有，
   Windows 的 4 个骨架引用 100% 在 `views/ai/`。
   ⇒ 它把骨架屏当「**未知时长 + 未知条数**」的专用件（AI 生成），
   而把「已知条数」的列表交给**行内转圈 + 文字**。
   🔴 这条对我们有直接用处：我们的 `check:spinner-discipline` 只管「转圈必须带忙态标记」，
   **没有任何东西管「什么时候该用骨架、什么时候该用行内转圈」** —— 滴答的答案是一个可抄的判据：
   *条数未知 → 骨架；条数已知 → 行内转圈 + 一句「还在取」。*
2. **HUD 只有一档**（强）：macOS 300×84 pt 的 HUD 是**唯一**的全局等待层，且它**带一行说明**
   （不是纯转圈）。Windows 侧找不到对应的全局 HUD ⇒ 两端不同构，那一格**跨端不成立**。
3. **加载态没有「取消」**（强，两端都是）：所有加载控件里没有一个 `Cancel`/`Abort` 控件名。

### 1.3 错误

| 格 | 证据文件 | 结构事实 | 强度 |
|---|---|---|---|
| macOS · 错误专用类 | **无文件**（否定探针 §0.4 P3 换词） | class_name 里 `Error` / `Fail` 命中 **0**（`Failed to change app icon?` 只是一条普通字符串，落在一个通用 cell 里） | 强（否定） |
| macOS · 错误走哪 | `TTAlertWindowController.nib`（420×201）、`TTProjectHelperAlertWindowController.nib`（420×260）、`TTGracePeriodAlertViewController.nib` | 错误被**并进 alert 家族**：没有独立的「错误面板」类，靠 alert + 内联 label | 中 |
| macOS · 逐字键入失败 | 字符串键 `'Please input: I AM SURE I WANT TO DELETE ACCOUNT'` 落在某 account 相关 nib | 这是**唯一一条能读出「要求逐字键入」的证据**，且它是**注销账号**那格。🔴 这一串是全文唯一的逐字引用（理由见文首 ②），**只作证据、不复用** | 强（字符串本身）/ 中（落点：按 key 反查只到文档名一级） |
| Windows · 内联红字 | `views/misc/emojititleeditor.xaml`、`views/tag/tagaddcontrol.xaml`、`views/time/customremindercontrol.xaml`、`views/logindialog.xaml`、`views/calendar/bindaccountwindow.xaml`、`views/calendar/bindicloudwindow.xaml`、`views/eisenhower/editquadrantwindow.xaml`、`views/thirdloginwebdialog.xaml`、`views/ai/aiconversationview.xaml`、`views/ai/aiaudiotransresultwindow.xaml`、`views/pomo/focusstatistics/verifyinputwindow.xaml` | 11 个文件有 `ErrorText` 控件名；多数落在**表单字段旁的一行字**上 | 强 |
| Windows · 错误徽章 / 气泡 | `views/tag/tagaddcontrol.xaml`、`views/tag/tagselectaddwindow.xaml`、`views/tasklist/editablesectioncontrol.xaml` | `ErrorPopup` 只在这 3 个**输入控件**里 ⇒ 错误是「贴在控件上」的，不是「盖在页面上」的 | 强 |
| Windows · 错误色与字号 | `views/pomo/focusstatistics/verifyinputwindow.xaml` | `ErrorTextblock`：`Foreground=TextRedColor`、`FontSize=12` DIP、`Margin="12,-12"`、`Visibility=Collapsed`（默认藏，出错才显） | 强 |
| Windows · 重试 | `views/ai/aiworkspaceview.xaml`、`views/ai/aiaudiotransresultwindow.xaml` | 全包 `Retry` 命中 **2 个文件，都在 AI**；`TryAgain` / `SomethingWrong` / `Offline` 命中 **0** | 强（否定 + 分布） |
| Windows · 错误对话框 | **无专用类** | 全包 18 个 XAML 的正文里出现 `Error` 字样，但没有一个是 `*Error*` 命名的 Window 类 ⇒ 错误弹窗复用通用对话框 | 中 |
| Windows · 通用回执槽 | `views/mainwindow.xaml` | `ToastGrid`：`HorizontalAlignment=Center`、`VerticalAlignment=Bottom`、**`Margin="0,0,0,70"` DIP**、`ZIndex=100`、**无子元素**（运行时填） | 强 |

**掉出来的判断：**

1. **两端都没有「错误态」这个东西，只有「错误出现在哪里」**（强）。
   macOS 没有 Error 类；Windows 的 `ErrorText` 是**字段级**的，`ErrorPopup` 是**控件级**的。
   ⇒ 它把错误处理拆成「**能贴多近就贴多近**」，而不是抽一个全局错误层。
   这与我们 `overlay-feedback.md` §6 T3「把 24 处就地提示 + 34 处 `role="alert"` 收成共享 Alert」
   **不是同一个动作**：它没有收，它是**按落点分了三级**（字段旁 / 输入控件上 / 窗口底部回执条）。
2. **「重试」几乎不存在**（强）：全包 2 处，都在 AI。⇒ 它的错误文案是**陈述型**（发生了什么），
   不是**动作型**（怎么办）。这一格**不值得学**，见 §3。
3. **回执条是「每窗口自备」的**（强）：`ToastGrid` 出现在 **18 个** XAML 里，
   `ToastBorder` **13** 处、`ToastText` **13** 处，高度只有两档（`40` ×9、`50` ×4 DIP）。
   ⚠️ 这不是「一套 toast」，这是**十几个窗口各自抄了一份槽位**。
   它和我们「0 套 toast + 24 处就地提示行」是**同一个病的两种形态**，只是它抄的位置在窗口层。
   ⇒ 值得学的是「槽位挂在宿主窗口上」这个**位置**，不值得学的是「高度两档、边距各写一遍」这个**重复**。

### 1.4 危险确认

先给两端的**形状清单**，再给映射（§2）。

**macOS：4 种窗口 + 1 条隐藏规则**

| 类 | 窗口 | 结构（可数） | 关闭通道 | 强度 |
|---|---|---|---|---|
| `TTAlertWindowController` | 420×201 pt，`styleMask=32771` | 标题 `TTLabel` 29 pt 高 + 多行正文 64 pt 高；**nib 里没有按钮**（动作按钮运行时加） | `Closable` 位在 | 强 |
| `TTConfirmAlertWindowController` | 440×270 pt，`styleMask=32771` | 标题 29 + 多行正文 64 + 一个 **400×128 pt 的槽**（内含 240×128 pt 的 `TTThemeButton`：`NSImage` + 三字标签，语义未核实）+ **两个并排 100×30 pt `TTThemeButton`**（x=208 / x=320，右对齐） | `Closable` 位在 | 强（几何）/ 未核实（图文槽是什么） |
| `TTRadioAlertWindowController` | 440×270 pt，`styleMask=32771` | 标题 + 正文 + 一个 **`NSStackView` 高度为 0**（`{{20,78},{400,0}}`）⇒ 选项由代码注入 + 两个 100×30 pt 按钮 | `Closable` 位在 | 强（几何）/ 未核实（选项个数） |
| `TTDeleteColumnWindowController` | 440×279 pt，`styleMask=32771` | 标题 + **三个 45×28 pt 小控件**（y=190/157/124，竖向排列）+ 一个 **374×32 pt 下拉**（`TTPopUpButton`）+ 两个 100×30 pt 按钮 | `Closable` 位在 | 强 |
| `TTProjectHelperAlertWindowController` | 420×260 pt，`styleMask=32771` | 同 alert 家族 | `Closable` 位在 | 中 |

**`styleMask=32771` 怎么读**（这是本文唯一一次位运算，写出来是为了可复核）：
`32771 = 32768 + 2 + 1 = FullSizeContentView + Closable + Titled`
⇒ **`Closable`（2）在**，即窗口族带关闭按钮。
对照：`TTUpgradeWindowController` 是 `32769 = FullSizeContentView + Titled`，**没有 `Closable`** ——
付费墙反而**不给 ×**。

**Windows：3 种形状 + 1 个复用**

| 形状 | 证据文件 | 结构（可数） | 有 × 吗 | 强度 |
|---|---|---|---|---|
| **勾选承诺** | `views/pomo/focusstatistics/focusrecdeleteallwindow.xaml` | `ConfirmCheckbox`（`SimpleCheckBoxStyle`、`Margin="0,20,0,0"`）+ 提交按钮 `IsEnabled` **绑定到 `ConfirmCheckbox.IsChecked`** ⇒ 不勾不能提交；`SaveButtonStyle` 提交 + `CancelButtonStyle` 取消（`Width=90`） | **有**（`CloseButton` + `Ic.Common.Close`） | 强 |
| **密码 / 逐字键入** | `views/pomo/focusstatistics/verifyinputwindow.xaml` | **两个互斥面板**：`VerifyPasswordPanel`（`PasswordBox` + 提示键 `EnterPasswordHint`）与 `VerifyTextPanel`（`TextBox` + 提示键 `EnterDeleteFocusHint`，`DataTrigger` 在 `Text.Length=0` 时显提示）；失败文案 `ErrorTextblock`（`TextRedColor`、`FontSize=12` DIP） | **有**（`CloseButton`） | 强 |
| **后果三选一 + 目标选择** | `views/deletecolumnwindow.xaml` | 三个 `RadioButton`：`DeleteRtb` / `DeleteAllRtb` / `MoveRtb`（**前两个用的是同一个 string key** `delete_column_delete_task`）+ `ColumnSelectComboBox`（`Height=32` DIP，**只在 `MoveRtb` 勾选时可见**）+ `Delete` 主按钮（`SaveButtonStyle`、`MinWidth=80`）+ `Cancel`；窗口 `Width=400`；`InputBindings` 绑了 `Escape→EscCommand`、`Enter→OkCommand` | **无**（nib 里只有两个动作按钮） | 强 |
| **复用：已删除任务底栏** | `views/detail/taskdetailbottomcontrol.xaml` | `TaskDetailTrashGrid`（`Height=44` DIP，默认 `Collapsed`）内含 `TrashRestoreGrid`（`Ic.ProjectList.RecoverDelete` + 键 `Restore`）与 `HoverIconButton RemoveButton`（`26×26` DIP，`Ic.ProjectList.DeleteForever`，`ToolTip=DeleteForever`，事件 `DeleteFromTrashMouseUp`） | — | 强 |
| **批量：已删除任务底栏** | `views/detail/taskdetailbatchcontrol.xaml` | `BatchDeleteFromTrashButton`（`Height=44` DIP、`DeleteForeverDrawingImage`、事件 `DeleteFromTrashClick`） | — | 强 |

**🔴 回收站那一格：它不是一个 view，是一个模式**（这条同时更正「Windows 没有回收站」的读法）

- **Windows**：没有任何 `*trash*` / `*recycle*` / `*restore*` 命名的 view（文件名探针命中 0，强）。
  但正文里有 **`TaskDetailTrashGrid` / `TrashRestoreGrid` / `DeleteFromTrashMouseUp` / `BatchDeleteFromTrashButton` / `DeleteFromTrashClick`**（强）。
  ⇒ 回收站是**任务详情底栏的一个状态分支**：进到「已删除」的任务里，底栏 44 DIP 那一条从「完成/删除」换成「恢复 / 永久删除」。
- **macOS**：`TTTaskDetailBottomActionView` 有 outlet **`deleteForeverButton`** + action **`deleteForeverButtonClicked:`**；
  `TTTaskListViewController` 有 outlet **`emptyTrashButton`** + action **`emptyTrashButtonClicked:`**（弱—动作选择器级，但同一份对象图里带着 outlet 目的地）。
  ⇒ macOS 也是**复用任务列表 + 详情底栏**，不是独立 nib。
- **两端同构**（中）：回收站 = 列表进「trash 模式」+ 详情底栏换成分支。
  **进入回收站的入口怎么走（菜单项 / rail / 快捷键）未核实** —— macOS `List` 菜单里确实有一项叫 Trash
  （[界面地图](ticktick-surface-matrix.md) §0.5 的 13 项清单已列），但它唤起的**载体**本文没核。

---

## 2. 危险动作档位映射

### 2.1 映射表（它的形状 → 我们的四档）

| 我们的档（`resolveDangerTier()`） | 滴答的等价物 | 证据 | 差异 |
|---|---|---|---|
| **`undo`**（直接做 + 撤销出口，**不弹确认**） | 删除/完成 → 底部**回执条** | Windows `views/undotoast.xaml`：`UndoToast` 整体 `Height=40` DIP、容器 38 DIP、`CornerRadius=6`、文字 `FontSize=13` DIP/`LineHeight=16`、右侧一个 **16 DIP** 图（`repealDrawingImage`）；**同一个文字块名字叫 `DeletedOrCompleted`**（删除与完成共用一个控件）；macOS `TTToastViewController.nib`：视图 205×46 pt、label 107×16 pt、右侧一个 **19×32 pt 图标按钮**（标题为空） | **同向**：能撤销就不弹确认。**差异**：① 它是「一条回执」，我们是「撤销回执 + 时长单一来源」（`receiptTimingOf()`）；② 它的**撤销时长在 XAML/nib 里读不出**（未核实），只在代码里；③ 它把「删除」和「完成」压进同一个控件，我们分成两种回执 |
| **`popconfirm`**（就地二次确认） | **不存在** | Windows 全包 `Popconfirm` 命中 0；macOS class_name 里没有就地确认类 | 🔴 **它缺中间那一档**（见 §2.2 的「哑铃形」） |
| **`alert`**（模态确认） | `TTConfirmAlertWindowController`（440×270 pt）；Windows 侧对应「勾选承诺」`focusrecdeleteallwindow.xaml` | 见 §1.4 | **形态不同**：macOS 是纯模态二按钮；Windows 是**模态 + 一个必须先勾的承诺框** ⇒ Windows 那格比我们的 `alert` **多一个交互装置**（比我们紧） |
| **`typed-alert`**（模态 + 逐字键入对象名） | 两端都有，且**用在了比我们更宽的面上** | macOS：字符串 `'Please input: I AM SURE I WANT TO DELETE ACCOUNT'`（注销账号）；Windows：`verifyinputwindow.xaml`（`VerifyTextPanel` 要求键入一个固定词，另有 `VerifyPasswordPanel` 要求输密码）—— 而它服务的动作是**清空专注记录** | 🔴 **比我们紧**：我们把 `typed-alert` 只留给「主体级」（注销账号 / 销毁整个主体）；它把逐字键入下放到了**一类数据清空**上 |

### 2.2 它的摩擦分布是「哑铃形」，我们的是「阶梯」

```
滴答：  零摩擦 + 撤销回执  ←———— 中间是空的 ————→  重模态（含逐字键入）
我们：  undo → popconfirm → alert → typed-alert
```

**为什么说这是「哑铃形」而不是「三档」**（强）：
它**没有**任何「就地展开一行问一句」的形态 —— Windows 侧 `Popconfirm` 命中 0，
`ErrorPopup` 那 3 处是**字段校验**不是确认；macOS 侧连类都没有。
所以它的轻动作只有两种命运：**要么直接做给撤销，要么一步跳到模态**。

⚠️ **这不是「它做得差」**。哑铃形有它自己的道理：撤销回执能覆盖的动作，弹确认是纯浪费；
覆盖不了的动作，就地一行字又说不清后果。它的问题是**中间空的宽度**：
「删一个看板列」这种**既不可撤销、又不必逐字键入**的动作，它只能上重模态 ——
于是不得不在那个模态里塞进**三选一 + 下拉**（§1.4 第 3 行）来补信息量。
我们的 `popconfirm` 正好是「一句后果 + 就地确认」，而我们在 `overlay-feedback.md` §4 里
**承认它还没封装**（`confirmingId` 模式，T4 未还的债）——
⇒ **这一格是我们该补的，不是该学的；它没有可抄的实现**。

### 2.3 与 `overlay-feedback.md` 的三条不变量逐条对账

| 我们的不变量 | 滴答的事实 | 判 |
|---|---|---|
| 「危险确认**不给 ×**：出口必须是具名动作」（§3 不变量 2） | macOS 4 个危险窗口 `styleMask` **全部含 `Closable`**；Windows 的 `focusrecdeleteallwindow` / `verifyinputwindow` **都有 `CloseButton`** | 🔴 **它比我们松**。我们有 `check:danger-confirm` 的 R1 钉着，这条**不改** |
| 「危险主按钮必须是 danger，不能是 primary」（§5b R2） | Windows 三个确认框的提交按钮**全用 `SaveButtonStyle`**（＝常规主按钮样式） | 🔴 **它比我们松**。同上，不改 |
| 「`externallyVisible` / `involvesPayment` / `destroysIrrecoverableResource` 三格即使能撤销也要保留确认」（§2 第 1 条） | 它的付费墙 `TTUpgradeWindowController` `styleMask=32769`，**没有 `Closable`** —— 付费墙反而是它**唯一不给 ×** 的窗口 | ⚠️ **方向对、落点不同**：它不给 × 的是**付费**，不是**销毁**。我们的是「销毁类必须具名出口」；它把这条用错了对象 |

### 2.4 比我们松的格 / 比我们紧的格（这张表就是 §3 的输入）

| 格 | 方向 | 依据 | 强度 |
|---|---|---|---|
| 危险确认带 × | **它松** | §2.3 第 1 行 | 强 |
| 危险主按钮不是 danger 样式 | **它松** | §2.3 第 2 行 | 强 |
| 中间档（popconfirm）整档缺失 | **它松**（摩擦要么 0 要么很大，轻动作没有「问一句」的选项） | §2.2 | 强（否定探针） |
| 逐字键入下放到「一类数据清空」 | **它紧** | `verifyinputwindow.xaml` 服务的动作是清空专注记录 | 强 |
| 批量不可逆动作前先要一个**勾选承诺** | **它紧** | `focusrecdeleteallwindow.xaml` 的 `IsEnabled` 绑定 | 强 |
| 不可逆动作**先让用户选处置方式**（删 / 全删 / 搬到某列） | **它紧**（信息量更大，代价是延迟决策） | 两端同构：`deletecolumnwindow.xaml` 三 radio + 下拉；`TTDeleteColumnWindowController.nib` 三小控件 + `TTPopUpButton` | 强 |
| 付费墙不给 × | **它紧** | §2.3 第 3 行 | 强 |

---

## 3. 值得学 3 类 / 明确不学 2 类

### 3.1 值得学（3 类，每条都给「学的是哪一句可判的话」）

**① 空态按容器面积分档，而不是一套居中**

- 学什么：**同一个产品里允许存在两种空态解剖** —— 有面积的给「插画 + 一句 + 主行动」，
  没面积的给「一句居中话」。判据是容器能不能同时放下三件东西，不是「哪一套更统一」。
- 证据：Windows 看板（`EmptyView` + 两句 + accent 文字动作）vs 四象限（单个 `EmptyText`，`Width=240` DIP）
  vs 日历连接（154 DIP 卡片 + 双 logo + 112×36 DIP 主按钮）—— 三档并存（强）。
- 对我们的落点：`EmptyState.tsx` 的四槽位可以同时装下前两档；第三档（动作写进句子、零控件）**装不下**，
  而它在小容器里是最省面积的。要不要加第五个槽位（`inlineAction`）是一次真判断，不是补漏。
- ⚠️ **不学它的插画与文案**（见 3.2 ①）。

**② 加载态的取舍：条数未知给骨架，条数已知给行内转圈 + 一句**

- 学什么：**骨架屏不是「更高级的转圈」，它是「条数未知」的专用件**。
- 证据：macOS 无 skeleton 类（否定，强）；Windows 的 `SkeletonLoader` 4 个引用**全在 `views/ai/`**（强）；
  与之对照，已知条数的列表一律走 `LoadMoreItemControl`（44 DIP 行内环 + 文字）与 `TTSubtasksLoadmoreCell`（16 pt 小环）（强）。
- 对我们的落点：`check:spinner-discipline` 只管「转圈必须带忙态标记」，**不管选型**。
  这条可以直接写成一条判据：*列表/分页 → 行内转圈；条数未知的生成型内容 → 骨架*。

**③ 回执条的位置：槽位挂在**宿主窗口**上，且删除与完成共用一条**

- 学什么：撤销回执不是新界面，是**宿主窗口底部一条固定槽位**；并且「删除」与「完成」
  可以共用同一个控件（只换文字与图标）。
- 证据：`mainwindow.xaml` 的 `ToastGrid`（`Bottom`、`Margin="0,0,0,70"` DIP、`ZIndex=100`、空子元素，强）；
  `UndoToast` 的文字块名 **`DeletedOrCompleted`**（强）；macOS `TTToastViewController` 205×46 pt 单行 + 右侧图标按钮（强）。
- 对我们的落点：`apps/web/src/lib/feedback/UndoReceipt.tsx` 现在是**每条挂载点自己渲染**；
  滴答的做法是「窗口有一个槽、控件只有一份」。⚠️ 但**不要**连它「18 个窗口各抄一份 `ToastGrid`」一起学（见 3.2 ② 的同类问题）。

### 3.2 明确不学（2 类，每条都说明「为什么是它的表达」而不是「它做得不好」）

**① 空态的插画本体与文案：那是它的品牌皮，抄了不能用也不该用**

- 不学什么：`EmptyImage` 那套 200×200 的 `Ellipse 145×145 + Image + Path` 组合、
  `EmptyPathColor` / `BaseColorOpacity5` 这套取色，以及任何一句它写给人看的话。
- 为什么是「它的表达」：
  ① **几何是它自己的画布约定** —— 200×200 的 `Grid` 里塞 145×145 的椭圆底 + 200×200 的 Path 叠层，
     这套比例只在它自己的空态位里成立；搬进我们的 token 体系后没有一个 `--ht-*` 能对上（我们的
     `EmptyState` 四槽位吃的是语义名，不吃固定 200 的方框）。
  ② **取色是它的主题变量** —— `EmptyPathColor` / `BaseColorOpacity5` 是它主题皮里的 key，
     在 Windows 侧这几个 key 的**具体数值还读不出来**（§0.3 限制一），搬过来只能靠猜。
  ③ **文案是它的人格** —— 它把动作写进句子（`TTProjectListEmptyHolderCell` 那种「去哪点」的写法，392×103 pt 纯文字）
     是它「像人说话」的表达取向；我们的文案走 `@heyta/i18n` 的 `web.empty.*` 一族，
     口径是「标题 + 提示 + 详情」三段，句子结构不同源。
- 落地边界：**只学分档这件事（3.1 ①），不学档里的内容。** 这条与
  [桌面端取证](ticktick-desktop-teardown-2026-11.md) §5 是同一条边界。

**② 危险确认给 ×、提交按钮用常规主按钮样式：这是那个窗口族的默认件，不是判断**

- 不学什么：macOS 危险窗口的 `Closable`、Windows 三个确认框的 `CloseButton`，
  以及提交按钮用 `SaveButtonStyle`（常规主按钮）而不是危险色。
- 为什么是「它的表达」：
  ① **× 是窗口族的默认件** —— 它所有对话框都建在 `TTRoundedCornerWindow` + `NSWindowStyleMask=32771`
     （`FullSizeContentView + Closable + Titled`）上，× 随着窗口样式来；
     而它**唯一**去掉 `Closable` 的窗口是 `TTUpgradeWindowController`（付费墙，`styleMask=32769`）——
     说明它的取舍是「付费墙不能随手关」，不是「危险动作不能随手关」。
     那是它的商业判断，不是交互判断。
  ② **主按钮样式是它视觉系统的映射** —— `SaveButtonStyle` 在它那儿同时服务「保存」和「删除」，
     因为它的按钮色板里没有一档「destructive」；我们有两档（`--danger` / `--primary`），
     而且 `check:danger-confirm` 的 R2 就是这么判的。
- 落地边界：**学它「不可逆才问」这个锚（§2.3 第 1 条方向对），不学它的出口与配色。**
  这一格如果照抄，等于把 `overlay-feedback.md` §3 不变量 2 与 §5b 的 R1/R2 一起拆掉。

### 3.3 一条「学了会更好但要另开一档」的机会（不计入 3 类）

**不可逆动作先选处置方式**（`deletecolumnwindow.xaml` 三 radio + 目标下拉，两端同构，强）。
它不是我们四档里的任何一档 —— 它是**档位之外的第二维**：*范围*与*归属*。
我们现在的 `DangerActionShape` 只有 `affectedCount` / `undoAvailable` / `collateralImpact`，
装不下「被删的东西去哪」这个选择。要不要把它作为 `alert` 档的一个可选体（`requiringDisposition`），
是一次**改领域模型**的判断，本文不给结论。

---

## 4. 未核实项

每一条都写「为什么核不了」+「核它需要什么」。**未核实 ≠ 没有。**

| # | 未核实的东西 | 为什么核不了 | 核它需要什么 |
|---|---|---|---|
| U1 | **Windows 主任务列表的空态与首次加载态** | `views/mainwindow.xaml` 里 `Empty` / `Loading` / `ProgressBar` 命中都是 0；`EmptyView` 被 10 处引用但**全包没有 `emptyview.xaml`** ⇒ 类存在、XAML 正文不存在（纯代码控件） | 反编译 `TickTick.dll` 里 `Views.Misc.EmptyView` 的绘制方法，或跑起来截一张 |
| U2 | **所有 deferred token 的数值与所有文案** | `resource/` 下 144 个 BAML 的正文是 `DeferrableContent`（`colorresource` / `stringresource/*` 46 个 / `icons_*` / `themes/*` 61 个 / `fontresource/*` 8 个），合计 **15,003,357 字节 → 转出 XAML 38,095 字节（保留 0.3%）**；单个如 `emptyicons.baml` 558,003 → 233 字节。142/144 个文件里只剩 `<!--deferred-stream:NB-->` 一个注释 | 用一个**能解开 `DeferrableContent` 的 BAML 读取器**（`Baml2006Reader` 需要按资源程序集解析延迟块），或运行时 `Application.Current.Resources` 取值 |
| U3 | **XAML 里有 Window 类 ≠ 这个态真被用到** | `views/*.xaml` 是资源字典产物，只证明编译期存在。是否有入口、是否 `Show()` 过、在什么条件下显示，全在代码里 | 代码侧找 `new XxxWindow().Show()` 的调用点，或跑起来逐个触发 |
| U4 | **撤销回执的时长** | `UndoToast` / `TTToastViewController` 里**没有任何时长字面量**（没有 `Duration`、没有 `Animation` 的时限、没有进度环倒计时元素）⇒ 时长在代码里 | 同上；或跑起来读秒 |
| U5 | **`TTEmptyHolderWindowController.nib` 是什么** | 24 个 720×450 占位 + 27 个 outlet 装在 `NSScrollView → NSStackView` 里，`styleMask=3`（`Titled+Closable`）。最可能是**空态样本库 / 预览窗**，但「谁在什么时候用它」读不出 | 找 `TTEmptyHolderWindowController` 的调用点 |
| U6 | **`TTConfirmAlertWindowController` 里那个 400×128 pt 的图文按钮槽是什么** | 它同时有 `NSImage`（240×128 的 `TTThemeButton`）与一个三字标签，既可能是「附带选项」也可能是「图标区」；`NSButtonCell` 的标题是假文 | 运行时截图，或找它的 outlet 名（本 nib 的 outlet 名字段在本轮解码里是空的） |
| U7 | **`TTRadioAlertWindowController` 的选项个数** | 承载选项的 `NSStackView` 在 nib 里高度是 **0**（`{{20,78},{400,0}}`）⇒ 运行时注入 | 代码侧或运行时 |
| U8 | **回收站的入口怎么走**（列表怎么进 trash 模式、菜单项唤起哪个载体） | 两端都只读到「动作/outlet 存在」（`emptyTrashButtonClicked:` / `DeleteFromTrashClick`），没读到入口与载体绑定 | 代码侧查 selector 的绑定目标 |
| U9 | **Windows 的错误对话框是不是独立类** | 18 个含 `Error` 的窗口里没有一个是以 Error 命名的 Window 类；但 XAML 里读不出「弹窗被调用」这件事（U3 同源） | 同 U3 |
| U10 | **macOS HUD 在 Windows 侧的对等物** | macOS 有 `TTProgressHUDWindowController`（300×84 pt）；Windows 侧没有 HUD 命名的 view，也没有对应尺寸的转圈窗口 | 反编译或在 Windows 上触发一次网络等待 |

⚠️ **U2 的连带影响最大**：本文**所有**「颜色差异 / 字重差异 / 文案长短」类结论都不可能给出，
现在给的每一条都是**几何与结构**。任何读者若看到本文提到某个 key 名（`NoTask` / `Restore` / `DeleteForever`），
那只是**标识符**，不是它的文案。

---

## 5. 与既有结论的对账（三条更正 / 一条补强）

### 5.1 `TTTaskListEmptyHolderView` 的出现次数与尺寸口径

- **上级给的读数**：出现 **30** 次、高度众数 **450**、占满列表区。
- **本轮复现的读数（探针 §0.4 P3）**：节点 **44** 个，分布在 **21 个 nib 文档**；frame 众数是
  **`{{0,215},{720,450}}` 出现 24 次** —— 而这 24 个**全部在同一个 nib**
  （`TTEmptyHolderWindowController.nib`）里。
- **差异的解释**：30 与 44 都对不上「节点数」或「文档数（21）」，我这边的两个数都无法重算出 30；
  但**「450 是众数」这一条成立**，只是它的成因是「一个 nib 里塞了 24 个同尺寸占位」，
  不是「列表区普遍高 450」。
- 🔴 **需要更正的读法**：在**真实宿主** nib 里，这个占位的高度是**宿主自己的高度**：
  `TTKanbanViewController` 625×655（与同 nib 的 `TTKanbanCollectionView` **精确相等**）、
  `TTSearchViewController` 560×376（与根视图精确相等）、`TTTaskListViewController` 596×744。
  ⇒ 正确的说法是「**空态与列表是同一矩形里的两层**」（强），而不是「空态固定 450 高占满列表区」。
  这个更正重要，因为「450」会让人以为空态是个固定高度的条，而事实是它**铺满**。

### 5.2 「639 个 BAML 里没有任何 trash / recycle / deleted 命名的 view」

- 这条**成立**（本轮复现：文件名探针命中 0，强）。
- 但它**不等于「没有回收站」**：回收站以**模式**存在，两端都把入口做成「任务列表进 trash 模式 +
  详情底栏换分支」（§1.4 末段）。⇒ 建议后续引用这句话时补一句「回收站是模式不是 view」，
  否则读者会把它读成「它没有回收站」。

### 5.3 [视图收敛](dida-view-unification.md) §1.6 的「空态：居中一句『没有任务』—— 一个组件一句话」

- 这条只在**四象限那种小容器**上成立（`quadrantcontrol.xaml`：单个 `EmptyText`、`Width=240` DIP、
  水平垂直居中，强）。
- 它**不是**滴答空态的普遍形状：看板是「插画 + 两句 + accent 文字动作」且**距顶 200 DIP 不居中**，
  日历连接是「154 DIP 卡片 + 双 logo + 112×36 DIP 主按钮」（都强）。
- ⇒ 那句话可以作为**我们自己的收敛目标**继续用（它是裁决，不是事实陈述），
  但**不能**再写成「滴答的实测形状」；实测是**分档**的（§1.1）。

### 5.4 补强：`overlay-feedback.md` §6 T3 的「本仓 0 套 toast」这一格

那一格说本仓「0 套 toast」是**选型不是缺**。本轮给出一条**外部参照**（强）：
滴答的 `ToastGrid` 出现在 **18 个** XAML 里，`ToastBorder`/`ToastText` 各 **13** 处，高度只有 `40`/`50` DIP 两档 ——
即「**十几个窗口各抄一份槽位**」。
⇒ 本仓「0 套」与它「18 份」是**同一个病的两端**。
T3 的正确动作（把 24 处就地提示收成共享 Alert）**没有因为这条参照而改动**，
但可以补一句判据：*槽位可以每窗口一个，**控件只能有一份*** —— 它恰好是「槽位对了、控件抄了 13 遍」。

---

## 6. 一页速查

| 问 | 答 | 强度 |
|---|---|---|
| 它的空态都有插画吗？ | 不。三档并存：有面积的给插画，小容器只给一句居中话，侧栏 cell 把动作写进句子（零控件） | 强 |
| 它的空态都有主行动吗？ | 不。看板给 accent 色**文字链接**（12 DIP），日历连接给 112×36 DIP **主按钮**，四象限**一个都没有** | 强 |
| 它的加载是骨架还是转圈？ | 已知条数 → 行内转圈（16 pt / 44 DIP 行）+ 一句；条数未知（AI）→ 骨架。**主列表没有骨架** | 强 |
| 它的错误是 toast 还是 dialog？ | 都不是主要形态。**字段旁一行红字**（11 文件）+ **输入控件上的气泡**（3 文件）+ 窗口底部回执条（13 处）。「重试」全包只有 2 处，都在 AI | 强 |
| 危险确认几档？ | 我们把它的形状归成 4 类：回执撤销 / 勾选承诺 / 逐字或密码键入 / 后果三选一+目标下拉；macOS 另有纯模态二按钮确认 | 强 |
| 有撤销吗？ | 有，**一条回执**（macOS 205×46 pt / Windows 40 DIP），删除与完成共用同一控件。**时长读不出** | 强（形状）/ 未核实（时长） |
| 回收站有独立界面吗？ | 没有。两端都是「列表进 trash 模式 + 详情底栏换分支」 | 中—强 |
| 比我们松的是哪几格？ | 危险确认带 ×；危险主按钮用常规样式；中间档（popconfirm）整档缺失 | 强 |
| 比我们紧的是哪几格？ | 逐字键入下放到「清空一类数据」；批量不可逆前先要勾选承诺；不可逆动作先选处置方式 | 强 |
