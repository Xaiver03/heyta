# 滴答 Windows 界面清单（BAML→XAML 之后能答的、以及仍然答不了的）

> 起因：`docs/research/ticktick-teardown-index.md` §4 把四条「未核实」挂着，其中两条与 Windows 有关。
> 而 2026-11-06 我们把 **639 个 BAML 里的 638 个**转成了可读 XAML（[`ticktick-baml-xaml-pipeline.md`](ticktick-baml-xaml-pipeline.md)），
> 于是"BAML 读不到文案"这个理由**已经过期**了。本文用那份语料重答一遍，并把**新的**卡点写清。
>
> 语料位置（**不随仓库走**）：`linux-dev:~/heyta-work/.evidence/win-xaml/`（638 个 `.xaml`）。
> 复现：`ssh linux-dev 'cd ~/heyta-work/.evidence/win-xaml && find . -name "*.xaml" | wc -l'`。

---

## 1. 语料形状（现量，2026-11-07）

```
638 个 .xaml
├── views/      490   （≈45 个模块子目录）
├── resource/   144   （图标 / 主题 / 语言 / 侧栏 / 主题预览卡）
└── styles/       3
```

**逐模块计数**（`views/**` 下按一级目录归类，"root" = 直接放在 `views/` 的文件）：

| 模块 | 数 | 模块 | 数 | 模块 | 数 |
|---|---|---|---|---|---|
| (root) | 41 | countdown | 18 | tag | 15 |
| calendar | 37 | detail | 17 | print | 14 |
| config | 35 | upgrade | 15 | widget | 13 |
| misc | 34 | theme | 15 | markdown | 12 |
| pomo | 31 | | | search / project / filter / ai | 11 each |
| time | 25 | | | setting | 10 |
| habit | 23 | | | timeline | 9 |

其余：`quickadd` 8 · `update`/`tasklist`/`subscribe`/`kanban`/`customcontrol` 6 · `team`/`mainlistview`/`eisenhower` 5，
以及 `activity` `agenda` `checklist` `coaches` `completed` `custompopup` `guide` `lock` `newuser` `summary` `tabbar` `template` `user` 等。

⚠️ **口径**：这是**文件数**，不是"窗口数"。旧结论里的「Windows 153 窗」是 P2 按另一种口径数的（窗口/视图混算），
两者**不可相减**。要"窗"这个数得先拍板「屏的粒度」（索引 §4 待拍板第 1 条），在那之前本文只报文件数。

---

## 2. 答掉的那条：Windows 顶层导航**不与 macOS 的 13 项同构**

**证据（结构，不是文案）**：

1. `views/mainwindow.xaml` 里只有 **7 个视图区域的裁剪/变换句柄**，逐个 `x:Name` 现量：
   `ListBorderClip/Transform` · `CalendarBorderClip/Transform` · `FocusBorderClip` ·
   `HabitBorderClip` · `MatrixBorderClip` · `CountDownBorderClip` · `AIBorderClip`
   —— 即 **清单 / 日历 / 专注(pomo) / 习惯 / 四象限(matrix) / 倒数日 / AI** 七块**同宿在一个主窗**里。
2. 顶层导航条在 `views/tabbar/leftmenubar.xaml`（8.5 KB），主窗里以 `LeftMenuBar` 引用它。
   它里面**没有可见文字**，用的全是图标资源键 + 3 个 ToolTip：
   `Ic.Tabbar.Sync` · `Ic.Tabbar.Notification` · `Ic.Tabbar.Help` · `More`
   —— 与 macOS 那条「下段工具三项贴底（同步 / 通知 / 帮助）」**结构同形**。

**结论**：Windows 不是「13 个平级导航项」，而是 **一个主窗宿主 7 个视图区 + 一条图标型左菜单条（工具项贴底）**。
macOS 的 13 项（任务/日历/四象限/习惯/专注/时间线/成长/便签/倒数日/搜索/回收站/设置 + 正在…）**在 Windows 上没有一一对应物**。
⇒ 界面地图 §4 那一格从「未核实」改成 **「问错了：两端导航模型不同构，逐项对表这件事本身不成立」**。

**仍然答不了**：菜单项的**文案**（见 §3）。

---

## 3. 新卡点（比"读不到"精确得多）：**deferred stream 没解**

46 个语言字典全是这个形状：

```xml
<ResourceDictionary DeferrableContent="<!--deferred-stream:2571B-->" ... />
```

`resource/stringresource/*.xaml`（46 个）与 `resource/sidebar.xaml`、`resource/tasklist.xaml` 都是**空的**，
只剩一个 `deferred-stream` 占位符 + 字节数。

⇒ **转换器只解了 BAML 主树，没解 BAML 的 deferred（延迟）资源流。**
文案全在那些流里，所以"Windows 文案读不到"的真实原因是**这一步没做**，而不是"BAML 不可读"。

**下一步是可执行的**：BAML 的 deferred content 是同格式的记录流（带类型表），
解它 = 在 `scripts/ticktick/baml-to-xaml.ps1` 里对 `DeferrableContent` 再跑一遍同一套解析器，
把 `string.d.*.xaml` 那 46 份填起来。**做之前先确认收益**：那 46 份一旦可读，
Windows 侧的全部文案统计（P6 那一册目前只有 macOS 的读数）就能补上，且**不再需要**用 macOS 的文案外推 Windows。

---

## 4. 另外三条顺带答掉的

| 旧结论 | 现在的答案（口径写清） |
|---|---|
| 「Windows `EmptyView` 被引用 10 处但**全包没有 `emptyview.xaml`**」（P7 U1） | **不是缺文件，是没这个控件**：Windows 的空态由 `views/misc/emptyimage.xaml`（一个可复用空图）+ `resource/emptyicons.xaml`（图标字典）+ 各模块自己的空控件组成（现量 `find -iname "*empty*"` 只命中这 3 个 + `views/project/emptyprojectcontrol.xaml`）。所以"主任务列表空态"要看 `mainlistview/` 与 `tasklist/` 里怎么用 `emptyimage`，而不是去找一张 `emptyview.xaml` |
| P9「主题 28 张预览 + 61 调色板」 | **61 个调色板 XAML 得到证实**（`resource/themes/*.xaml` = **61**）；**预览卡 XAML 只有 16 个**（`resource/themecard/*.xaml` = 16）。两个数不冲突但**不同物**：61 是调色板定义，16 是"预览卡模板"；"28 张预览"若成立，指的多半是**运行时用 16 个模板 × 主题参数**生成的张数 —— 这条**需要重新取证**，别把 16 当成 28 的反证 |
| P6「41 个语言」 | Windows 侧 `resource/stringresource/` 现量 **46 个文件**，去掉两套命名重复（`string.d.*` 3 个 + `stringresource.*` 43 个）后**去重 43 个语言码**：`en-us zh-cn zh-tw zh_rhk ar be bg ca cs cy da de el es fa fi fr he hr hu in it iw ja ko lt lv ms nb nl pl pt ro ru sk sl sv ta th tr uk ur vi`。⚠️ 与 P6 的 41 **不是同一个尺**（P6 数的是文案表条目覆盖的语言，这里数的是资源文件）—— 引用时连口径一起搬 |

---

## 5. 还没答的（诚实版，3 条）

1. **deferred stream 里的文案**（§3）—— 可做，未做；做完才能谈"Windows 文案画像"。
2. **Windows 本地库表结构**（索引 §4 原第 3 条）—— `sqlite-net` 走反射、无 DDL；要它跑起来才有库。
   P3 那 43 行实体对照是从**模型类**推的，不是从 DDL 读的，这条**没有变**。
3. **`KotlinMultiplatformAll` 的同步语义**（索引 §4 原第 2 条）—— native、符号剥离，只有字符串；
   本轮无新证据，仍是**未判定**。

---

## 6. 这份文档的边界

- 只写**能复现的结构事实**，不写"看起来像"的产品解读。
- 不引用任何文案原文（§3 决定了现在还读不到），所以**不涉及**"抄表达"那条红线。
- 模块名取自**目录名**（`calendar/` `pomo/` `habit/` …），是**它自己的命名**，不是我们的命名，也没有被搬进 heyta。
