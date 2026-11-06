# 滴答清单桌面端逆向取证（macOS + Windows 均已实测）—— 只取「决定」，不取「表达」

> 立项：2026-11-06。授权口径：产品负责人要求「下载 GitHub 上很火的 REA，看一下能不能逆向本地的滴答清单；
> 只看看有没有可以参考的地方，**不照抄**」。第二轮追加：「UX 我也是要学习的……我在 Windows 上也安装了这个，
> 也逆向一下，把获取到的参考关键信息**全都**写在文档当中」。
>
> 本文只回答三件事：**① 能不能逆向**、**② 逆向出来的东西里哪些是可以学的决定、哪些是碰不得的表达**、
> **③ Windows 端现在到哪一步、缺什么才能继续**。
> 它不是功能对标表（那是 [`dida365-feature-benchmark`](dida365-feature-benchmark.md) 的活），
> 也不是实施计划：本文**不提**任何工单，任何一条要落地都得先过自己的 ADR。

---

## 0. 四句话结论

1. **能逆向，而且已经拿到了「法律上最安全、工程上最有用」的那一层** —— 包结构、界面清单、文案规模、**完整数据模型**、接口与权限。全部是静态观察，一行代码没执行、一个账号没登录。
2. **滴答 macOS 端是原生 Swift + Objective-C 框架群，不是 Electron。** 所以「扒 `app.asar` 看 JS」那条最省事的路**对它无效**；REA 的 Electron/JS 分析路径用不上，用上的是它的 Apple bundle / nib / Mach-O 静态面。
3. **真正值得参考的是它数据模型里的几个「决定」**（每个视图一张独立的手动排序表、重复任务实例物化 + fetch flag、专注会话单独一条同步通道、第三方日历建成五表链），**不是界面细节**。界面细节（文案、图标、字体、截图、逐像素布局）恰恰是著作权与商标保护得最实的那一层 —— 那也是唯一不能碰的一层。
4. **Windows 端已经拿到了，而且推翻了「它大概是 Electron」这个假设**：它是 **.NET Framework 4.x + WPF**（`TickTick.exe` 36.3 MB 托管程序、639 个 BAML、`sqlite-net`、内嵌 WebView2），与 macOS 共享同一份 `KotlinMultiplatformAll`（`.dll` ↔ `.framework`）。取回路径是 **SSH**（`~/.ssh/config` 里本来就有 `windows-pc`），不需要你摆渡 U 盘。**上一轮我判断「拿不到」是错的** —— 错在没先读 `~/.ssh/config`（详见 §9.1 与 §7 #662）。


---

## 1. 用了什么工具、装在哪、为什么没进仓

| 项 | 值 |
|---|---|
| 工具 | **REA（Reverse Engineer Anything）** — `morluto/rea`，官网 rea.tools，npm 包 `rea-agents` |
| 版本 | `rea-agents@6.8.0`（MIT） |
| 安装位置 | `/tmp/rea-lab/`（git clone + `npm install --prefix /tmp/rea-lab/cli`），**刻意不进本仓** |
| 为什么不在仓内 | 它是一次性取证工具，不是产品依赖。按 [`hard-constraints`](../agents/hard-constraints.md) §3.1–3.2，进仓的第三方组件要过「2021 年后仍在维护 + 许可证白名单」两道门并登记；取证工具走「不进仓」这条更省的路，也就没有登记义务 |
| 环境事实 | 本机 Node **22.22.0**，低于 REA 要求的 22.23.4 ⇒ `npm` 报 `EBADENGINE` 但命令可跑；**需要 Node ≥24.15 的 SQLite 快照子命令不可用**（本次也用不上，见 §6） |
| 网络 | 本机**直连 github.com 不通**（`Failed to connect after 75s`），走系统代理 `127.0.0.1:7890` 克隆成功；npm registry 直连可用 |
| 第二轮追加工具 | `7z`（判 Windows 包形态）· `ssh`（**真正的取数通道**，见 §9.1）· 远端 PowerShell `System.Resources.ResourceReader`（枚举 WPF 的 1296 条资源）· `dnfile`（本机读 .NET metadata，`pip install --target`）|

### 1.1 合规边界（写死，不随任务漂）

- 分析对象是**本机已安装的本地副本**（`/Applications/TickTick.app`，8.2.03，App Store 已购）。不抓他人数据、不代理其流量、不登录其账号。
- **不触碰 DRM 与付费校验**：`SwiftyStoreKit` / 订阅相关符号只用于「知道它有内购」，没有做任何绕过。
- **不重分发其产物**：本文不放它的文案原文、图标、字体、截图；抽取的中间产物（图表 JSON、类名清单）留在 `/tmp`，本文只留结论与可复现命令。
- 与仓规一致：[`THIRD_PARTY_LICENSES.md`](../../THIRD_PARTY_LICENSES.md) 已写明「即使许可证允许，heyta 也**不使用**滴答清单的商标、图标、文案与界面素材」。本文不改变这条，只补一句方法论：**决定（结构、取舍、失效条件）可以学，表达（文字、图形、版面、动效）不可搬**。

---

## 2. 目标解剖：它到底是怎么做的

现量（2026-11-06，`/Applications/TickTick.app`）：

| 维度 | 读数 | 取证方式 |
|---|---|---|
| 版本 / bundle | 8.2.03 / `com.TickTick.task.mac` | `Info.plist` |
| 主二进制 | 46.6 MB，**fat：x86_64 + arm64** | `file`、`lipo -info` |
| 实现语言 | **原生 Swift**（`NSPrincipalClass = TickTick.TTApplication`，`strings` 抓到 ≈1.1k 个 `_TtC…` Swift 类型） | `strings -a` |
| 内嵌框架 | **36 个** | `ls Contents/Frameworks` |
| 扩展 | 5 个 `.appex` + 1 个 `docktileplugin`（Intents / Safari / Today Widget / Widget / WidgetConfiguration / DockTile） | `ls Contents/PlugIns` |
| 编译产物 | **436 个 nib**（430 个直接躺在 `Contents/Resources`，另 6 个在 `Base.lproj` / `zh-Hans.lproj` / Widget / TickTickKit 里） | `find -name "*.nib"` |
| 本地化 | **3 528 条键值**（en / zh-Hans 各 3 528，**键集完全相同**，实测差集两侧均为 0） | 解析 `Localizable.strings` |
| 本地库 | **58 张 `CREATE TABLE`**（56 张业务表 + `Z_PRIMARYKEY` + `grdb_migrations`），DDL **以字符串形式嵌在二进制里** | `strings -a TTGRDBPod` |
| 接口 | **38 条** `/api/…` 路径（v1×1 / **v2×32** / v4×6） | `strings -a` 主二进制 |
| 沙盒 | `app-sandbox` + app group `75TY9UT8AY.com.TickTick.task.mac` + **APS 推送** + associated domains（`dida365.com` / `ticktick.com`） | `codesign -d --entitlements` |

### 2.1 依赖指纹（能说明它的工程取向）

`Contents/Frameworks` 里能直读的第三方件：

| 框架 | 含义 |
|---|---|
| **GRDB** + `TTGRDBPod` | SQLite 是本地事实源；DDL 在 `TTGRDBPod` 里 |
| Alamofire | HTTP |
| **Starscream** | WebSocket —— 有一套长连接通道（未核实用途） |
| SDWebImage / Highlightr / SwiftyStoreKit | 图片缓存 / Markdown 高亮 / 内购 |
| AppAuth + GTMAppAuth + GTMAppAuthSessionFetcher | 标准 OAuth（Google 等第三方登录） |
| SnapKit / Swinject / SwiftJSON / SwiftDate 类 | 布局 / DI / 解析 |
| Bugsnag | 崩溃上报 |
| Sparkle（`SUFeedURL = pull.ticktick.com/…/mac_appcast.xml`） | 应用内自更新 |
| MASShortcut | 全局快捷键 |
| **`KotlinMultiplatform` / `KotlinMultiplatformAll`** | **共享逻辑层**（≈9.7 MB）。符号已剥，只能看到 `SYNC` / `Patch` / `Clock` / `Conflict` 这类字符串 |
| `nlp_macOS` | 本地自然语言（日期解析那类） |
| `TTCoreDataPod` | 旧 CoreData 遗留（9.6 MB，仍在链上） |

> 工程取向的推论（**未核实**，仅作对照）：它把**同步/冲突**放在跨端共享的 Kotlin 层，把 UI 与本地库留在原生 —— 与 heyta「共享层放业务语义、宿主壳只放平台差异」是同一条思路，只是它用的是 Kotlin Multiplatform，heyta 用的是 TS 包。

### 2.2 Windows 包的读数（这一轮能拿到的部分）

官方分发端点全部实测（`https://ticktick.com/static/getApp/download?type=<t>`，2026-11-06）：

| `type` | 返回 | 大小 | 是什么 |
|---|---|---:|---|
| `win64` | `application/octet-stream` | **24 130 416 B** | **PE32 installer**，`Inno Setup`，`FileVersion 8.2.5.0`，`CompanyName: Appest.com`，`ProductName: TickTick` |
| `mac` | `application/x-apple-diskimage` | 81 822 109 B | macOS DMG |
| `linux` / `linux64` / `appimage` / `deb` / `rpm` / `tar` / `win32` / `mac_arm64` | `application/vnd.android.package-archive` | 8 343 906 B | **全是同一个 APK** ⇒ 这些 `type` 不存在，服务端**兜底返回 Android 包** |

三条从这张表直接得出的结论：

1. **它没有 Linux 端** —— 任何 Linux 关键字都回落到 APK。heyta 若把 Linux 当差异化（本地优先 + 自托管天然适配 Linux 桌面），这是一个**它结构上不会跟的空档**。
2. **Windows 包只有 Inno Setup 这一种形态**，没有 `.msi` / `.appx` / 便携 zip。这意味着要在 Windows 上做「无安装取证」只能装完再拷目录（§6.1）。
3. `win64` 名义是 64 位，但**外层 stub 是 PE32（x86）**——Inno 的壳向来是 32 位，载荷才是 64 位，这不代表应用是 32 位（**未核实**载荷位数）。

**载荷一开始没解出来（这段留档，因为它是「先假设 Electron」的代价）**：Inno Setup 把全部文件压成一个**固态 LZMA 流**存在 `.idata`；`7z` 只能拆 PE 段（拆出 `inno/.idata` 等 26 个文件，但那是压缩流不是文件树）。正解是 `innoextract`，而本机三条路都断了：

| 路 | 结果 |
|---|---|
| `brew install innoextract` | ❌ `/opt/homebrew/*` 全部 root 所有，brew 拒绝写入 |
| `conda create -c conda-forge innoextract` | ❌ conda 缓存目录权限错 |
| 手工下 ghcr 上的 Homebrew bottle（arm64 层，198 KB）+ `install_name_tool` 重定位 | 🟡 下到了、重定位了，**卡在 `libboost_system-mt.dylib`**（bottle 是 2020 年对 boost 1.73 编的，本机 boost 1.90 已无此 dylib） |

**但这条路最后没用上**：真正的解法是**根本不下载安装包，直接去那台 Windows 上取已安装的文件**（§9.1）—— 而且取回来的东西证明「解 Inno 包」本身也是白费劲，因为**它不是 Electron，没有 `app.asar`**。

---

## 3. 五张清单（静态层拿到了什么）

### 3.1 菜单 = 顶层 IA（最干净的一份证据）

`Contents/Resources/Base.lproj/MainMenu.nib` 解出 9 个菜单、**62 个非分隔菜单项**，`List` 菜单直接列出了它的**全部顶层视图**：

```
Pomodoro · All · Assignee · Calendar · Completed · Habit · Inbox
Matrix · Today · Tomorrow · Next 7 Days · Summary · Trash
```

三个值得注意的点：

1. **视图是「一等导航对象」**，不是「筛选器的结果」。13 个视图各自有菜单项，说明它们各自有独立的持久化与入口，而不是共享一个列表模型套过滤条件。
2. **`Assignee` 与 `Summary` 也是顶层视图** —— 前者是协作（人维度），后者是统计。heyta 目前把「统计」放在成长页、把「协作」放在设置里，是**另一种拆分**，不算错，但要知道这是分叉点。
3. `Task` 菜单（11 项）把快捷键给到**「设优先级 / 设日期 / 完成」这类原子动作**（`Set Today` / `Set Tomorrow` / `Set Next Week` / `Set High Priority`…），说明它把「批量改属性」当主路径来做 —— 这一点与 heyta 的「行菜单四组动作」是同一类设计。

### 3.2 界面清单：436 个 nib 是它的「屏幕地图」

不逐个抄，只取形态：430 个 nib 里能读出它的组件化程度 —— 大量 `TT*CellView`、`TT*ItemView`、`TT*PopUpButton`、`TTSlideSegmentedControl`、`TTKanbanCollectionView`、`TTHabitCollectionView`、`TTFocusDetailOverviewItemView`、`TTDueDatePickerSetReminderView`。也就是说：**它把「日期 + 提醒」做成了一个合成控件**（一个 View 里同时管 due 与 reminder），habit 与 kanban 各有一套自己的 collection view 而不是复用任务列表。

> 对 heyta 的用法：这一层只用来回答「一个屏幕里塞了什么」，**不用来抄布局**。nib 里连字体名与坐标都有，那是它的表达，不是它的决定。

### 3.3 文案规模 = 它把力气花在哪（量化代理）

3 528 条键，按关键词命中条数（en 侧键名，同一个词可能重复命中多键）：

| 关键词 | 条数 | | 关键词 | 条数 |
|---|---:|---|---|---:|
| AI（子串） | 267 → **真值 ≈120** | | Tag | 61 |
| Calendar | **126** | | Team | 59 |
| Focus | **89** | | Note | 50 |
| Habit | **83** | | Reminder | 44 |
| Shared | 42 | | Countdown | 37 |
| Repeat | 34 | | Filter | 32 |
| Priority | 28 | | Archive | 26 |
| Template | 25 | | Attachment | 24 |
| Notification | 23 | | Lunar | 19 |
| Subtask | 16 | | Matrix | 14 |
| Timeline | 9 | | Holiday | 9 |
| Import | 10 | | Widget | 9 |

> 🔴 **勘误（2026-11-06，由 P6 支线当场抓到，已复核）：上面整张表都是「子串命中」，不是语义计数。**
> `'ai' in key.lower()` 命中 267 条，但其中 **约 147 条与 AI 无关** —— 命中源是 `fail`(43) / `email`(39) / `daily`(14) / `tail`(14) / `again`(10) / `available`(7) / `main`(5) / `contain`(4) 这些词里的 a-i。
> **AI 的真实规模 ≈ 120 条**（`ai_` 命名空间 120、值里提到 AI 的 25、并集 121；P6 用另一口径得 115/25/119，差在词边界定义，量级一致）。
> 同理 **每一行都该按子串读**（`Focus` 会命中原生焦点相关的词，`Team` 会命中 `team` 之外的东西）—— 这张表只能用来**排相对重**，不能用来引用绝对量。

读法（**修完勘误之后仍然成立的那半句**）：它的文案重心在 **AI ≈ 日历 > 专注 ≈ 习惯**，顺序没变，只是 AI 的绝对量要从 267 降到约 120。
而 AI 那 120 条**结构**是：结果/进行态 57 · 引导/入口 26 · 额度/付费 11 · 免责/隐私 11 · 失败态 6 · 未归类 8（P6 的实测分类）。
**所以「AI 在它那里是需要被解释的功能」这句话仍然成立，但依据换成结构分类，不再是那 267 条。** 对 heyta 有用的那条结论也保留：**AI 的文案量 ≈ 用户困惑量**。
另外两条同源读数（P6）：全库只有 **93 条以问号收尾（2.6%）**；短标签区（英文 1–8 字符）里 **36.2% 的中文按字宽折算后比英文更宽**（p95 = 1.25）—— 见后续 `ticktick-copy-tone.md`。

### 3.4 数据模型：58 张表，逐个看它的决定

DDL 是嵌在 `TTGRDBPod` 里的字符串。**没有**执行、没有连库，纯静态读。表清单（去 `Z` 前缀）：

```
ATTACHMENT · BACKUP · CALSUBSCRIPTIONACCOUNT · CALSUBSCRIPTIONARCHIVEEVENT
CALSUBSCRIPTIONCALENDAR · CALSUBSCRIPTIONEVENT · CALSUBSCRIPTIONPROJECT
CHECKLISTITEM · COLUMN · COMMENT · COUNTDOWN · COURSE · COURSEARCHIVE
DELAYREMINDER · FILTER · FOCUSSYNCOPERATION · HABIT · HABITCHECKCYCLE
HABITCHECKIN · HABITRECORD · HABITSECTION · HABITSETTINGS · HABITSKIP
HOLIDAY · NETTEMPDATA · POMODORO · POMOSETTINGS · PRESETPROJECT
PROJECT · PROJECTGROUP · PROJECTPINNEDSORTORDER · PROJECTTEMPLATE
PUBLICUSERPROFILE · REMINDER · REPEATINSTANCE · REPEATINSTANCEFETCHFLAG
SORTORDER · TAG · TASK · TASKAIRECRECORD · TASKCOLLAPSEDSTATUS
TASKDUEDATESORTORDER · TASKMODIFYTIMES · TASKPINNEDSORTORDER
TASKPRIORITYSORTORDER · TASKPROJECTSORTORDER · TASKTAGSORTORDER
TASKTEMPLATE · TASKUPDATESTATUS · TEAM · TEAMMATE · TIMER · TIMETABLE
USER · USERDOCUMENT · USERSETTINGS
```

四条从表名就能读出的决定（每条在 §4 展开）：

1. **排序是「每视图一张表」**：`PROJECTPINNEDSORTORDER` / `TASKPINNEDSORTORDER` / `TASKPRIORITYSORTORDER` / `TASKDUEDATESORTORDER` / `TASKTAGSORTORDER` / `TASKPROJECTSORTORDER` / 通用 `SORTORDER`。
2. **重复任务是「物化 + 取用标记」**：`REPEATINSTANCE` + `REPEATINSTANCEFETCHFLAG`。
3. **专注是「单独一条同步通道」**：`FOCUSSYNCOPERATION`（不是挂在 TASK 上）。
4. **第三方日历是「五表链」**：`CALSUBSCRIPTIONACCOUNT → (PROJECT | CALENDAR) → EVENT → ARCHIVEEVENT`。

另外三个「它做了、heyta 没做」的实体：`COURSE`/`TIMETABLE`（学生课程表）、`COUNTDOWN`（倒数日）、`FILTER`（自定义智能清单）。还有 `HOLIDAY`（节假日/农历）、`PRESETPROJECT` + `PROJECTTEMPLATE` + `TASKTEMPLATE`（模板三件套，onboarding 的载体）。

### 3.5 接口与权限

- **38 条** `/api/…` 路径，重心在 **v2（32 条）**，v4 只剩日历相关的 6 条 —— 说明它有一轮大的 v2→v4 迁移还没迁完（**未核实**是否已停用 v2）。
- 直读到的域名：`dida365.com` / `ticktick.com` / `pull.*`（更新） / `help.*` / `api.twitter.com` / `graph.qq.com` / `open.weixin.qq.com` / `accounts.google.com` / `slack.com`。**还有 `future-test.365dida.com` / `future-dev.365dida.com` 这类测试域留在壳里** —— 这是它的卫生问题，heyta 别学。
- Entitlements：`app-sandbox`、app group、`aps-environment=production`、`applesignin`、`associated-domains`（6 个 applink）、`personal-information.calendars`、`print`、`files.user-selected.read-write`、`network.client`。
- **它没有** `files.downloads` 之类的宽权限 —— 导出走用户选择文件；这一条与 heyta 的本地优先并不冲突，但说明「沙盒内也能做完整导出」。

### 3.6 UX 层读数（从 436 个 nib 里量出来的，这一节是「UX 要学」的正面回答）

> 全部来自 nib 里存的 `NSFont.NSSize` / `NSWindowTemplate.NSWindowRect` / `NSView.NSFrame` / `NSColor.NSColorName`。
> **这是它的实际用量分布，不是它的规范文档** —— 恰恰因为这样才可信：一个人不会把「本该用的字号」写进 nib，只会用。

#### ① 字号：真正在用的只有 5 档

| 字号 | 出现次数 | 读法 |
|---:|---:|---|
| **13** | **348** | 正文基准（macOS 系统默认 = 13，它没跟风缩小） |
| **11** | **146** | 次要信息（第 2 档） |
| 12 | 108 | 第 3 档（多在侧栏/表头） |
| 16 | 82 | 区块标题 |
| 14 | 71 | 正文加强 |
| 10 / 15 / 18 / 20 / 22 / 24 | 27 / 5 / 10 / 16 / 2 / 14 | 边缘档（徽标、面板标题、大数字） |
| 25 / 26 / 28 / 30 / 32 / 90 | 共 16 | 极少数（引导页大字、空态插画位） |

**取值**：11 / 12 / 13 / 14 / 16 这五档覆盖了 **755 / 850 ≈ 89%** 的全部字号使用。它**没有**做 8/9/15/17/18 那一长串 —— 这是一个**五档的紧凑字阶**，基准 = 系统正文 13。
**对 heyta**：我们的 `typography.ts` 里档位更多（含 `relaxed/normal/tight` 三套行高）。可以拿这条当证据问一句：**"我们真的需要比五档更多吗？"** —— 但**别抄它的 13/11/12 数值**，macOS 系统正文就是 13，那是平台常数不是它的设计。

#### ② 字体：只换字重，不换字族

`NSName` 命中：`.AppleSystemUIFont` 761 / `…Medium` 57 / `…Demi` 14 / `…Bold` 10 / `HelveticaNeue` 8（旧遗留）。
**取值**：它把「层级」交给**系统字体的四个字重**，字族只有系统一个（外加一处 2013 年的 Helvetica 残留）。
**对 heyta**：`packages/design-system` 若打算引入第二、第三字族，这条是反证 —— **一个平台字体 + 字重就够了**，多字族带来的收益要先证明。

#### ③ 窗口尺寸：一个主窗 + 一个设置窗 + **一个「对话框宽度」**

| 宽度 | 窗数 | 典型 |
|---:|---:|---|
| **440** | **12** | **对话框标准宽**（提醒/优先级/重复/账户/模板…） |
| 300 / 416 / 420 / 472 / 479 / 480 / 483 / 508 / 512 | 各 1–2 | 小窗变体（确认框、颜色选择、成员列表） |
| 560 / 620 / 642 | 1 / 1 / 2 | 中窗（登录 642×484） |
| 700 | 1 | 引导/多步表单 |
| **800×680** | 1 | **设置**（独立窗口，不是 sheet） |
| 840×600 | 1 | 详情窗（`TTTaskDetailWindowController`） |
| **1080×808** | 1 | **主窗**（`TTMainWindowController`） |

**取值**：**12 个对话框共用 440 宽**。这是很强的一条设计纪律：**弹窗只有一个宽度**，高度随内容。heyta 的 `--ht-dialog-*` 目前是几个不同宽度（需现量核对），这条值得对账。
另外两个可读的事实：**设置是独立窗口（800×680）而不是 sheet**；**任务详情也可能是独立窗口（840×600）而不是右侧栏** —— 这与 §4 里「详情面该用 split 还是 sheet」的老争论直接相关（macOS 端它选了**独立窗**，web 端它用右栏，两端不一致）。

#### ④ 控件高度：24 / 28 / 30 / 32 四档 + 36 的输入框

| 类 | 众数（出现次数） |
|---|---|
| `TTThemeButton`（自绘按钮，657 个） | **24**（221）、30（99）、16（70）、28（67）、32（40） |
| `NSButton` | 32（14）、24（7）、48（5） |
| `TTBorderedTextField` | **36**（22）、32（6） |
| `TTBorderlessPopUpButton` | **20**（22） |
| `NSView`（行容器） | **40**（51）、56（42）、24（35）、36（27）、48（20） |

**取值**：**行高 40 与 56 两档**（40 = 单行紧凑，56 = 带副标题/双行）；**按钮 24 是绝对主力**（小尺寸工具条按钮）；**输入框 36**；**无边框下拉 20**。
**对 heyta**：我们的 `ux-principles.md` 里写「控件高度一档」（`--ht-control-h` 一类），这条给了一个**反例读法**：它在**不同位置**用了 24/28/30/32 四档 —— 但那四档是**不同语义**（工具条图标钮 / 行内按钮 / 对话框主按钮 / 强调按钮），不是「随手不同」。真正要问的是：**heyta 的「一档」是不是把四种语义压成了一档。**

#### ⑤ 颜色：96% 用语义名，几乎不写 hex

| 语义色 | 次数 | | 语义色 | 次数 |
|---|---:|---|---|---:|
| `labelColor` | 285 | | `headerTextColor` | 76 |
| `textBackgroundColor` | 250 | | `headerColor` | 75 |
| `controlColor` | 115 | | `gridColor` | 60 |
| `controlBackgroundColor` | 112 | | `selectedTextBackgroundColor` | 18 |
| `controlTextColor` | 105 | | `linkColor` | 18 |

**取值**：**一个 hex 都没在 nib 里出现**（nib 只存 `NSColorName` 这类语义引用）。它把「什么颜色」完全交给系统语义色 + 自己的主题层。
**对 heyta**：这正是 `design-system.md` 那条「组件禁止裸值、用语义名不用外观名」的**外部佐证** —— 而且它做到的是**连设计稿层面都不写色值**。我们的 `check:design` 抓裸 hex 是对的方向，这条给了一个「成熟产品真按这个做」的样本。

#### ⑥ 图标：12 / 14 / 16 / 18 / 20 五档，主力 18

`NSImageView` 边长众数：**18**（56）、14（38）、12（31）、16（25）、20（25）、24（18）。
**取值**：**18 是行内图标主力**，16 是次主力，12/14 是极小的状态点，20/24 是工具条。**没有 13/15/17 这种非偶数值**。

#### ⑦ 空态：`TTTaskListEmptyHolderView` 30 个，高度众数 450

**取值**：空态容器**占满列表区**（450pt 高），不是「一行小字居中」。
**对 heyta**：`ux-principles` 里空态那一条可以拿这个当对照 —— **空态是「占据列表区的一块」而不是「列表里的一行」**。

> ⚠️ **这一节的用法边界**：以上数字是**它的表达参数**（具体 px 与字号），**不能直接搬**。能搬的只有**形状**：
> 「字阶要窄（≤5 档）」「对话框只有一个宽度」「按钮高度按语义分档而不是按页面分」「颜色只走语义」「空态占满容器」。
> 具体数值请从 `packages/design-system/src/tokens.css` 自己推 —— 我们的基准字号/间距与 macOS 系统默认不必相同。

---

## 4. 可参考的七条（每条：它怎么做 → 证据 → heyta 现状 → 该学什么）

> 统一提醒：以下都是**本地库的形状**，**不等于云端协议**。本地怎么存可以为了读性能随便设计，云端怎么合并不由它决定。所以下面每条都只借「问题与取舍」，不借「实现」。

### 4.1 每个视图一张独立的手动排序表 —— 而不是一条 `sortOrder` 字段

- **它**：7 张排序表（pinned / priority / dueDate / tag / project / 通用）。同一个任务在不同视图里有**不同的位置**。
- **heyta 现状**：手动排序是已知缺口（对标文档里「手动排序」是明列的那一类）。
- **该学的是决定**：排序是 **`(视图, 视图实例)` 的二维属性**，不是实体属性。但**不要**学它 7 张同构表的形状 —— 泛化成一张 `(scope, scopeId)` 排序表在关系库里更省，也不会随视图增加而加表。**形状照搬 = 抄；把约束想清楚 = 学。**

### 4.2 重复任务：物化实例 + 「已取用」标记

- **它**：`REPEATINSTANCE`（实例）+ `REPEATINSTANCEFETCHFLAG`（取用标记）。
- **heyta 现状**：op-log + 读时展开（不物化）。
- **取舍**：物化省「读时算」，但要回答「改了 RRULE 之后历史实例算谁的」；读时展开省「回填」，但要回答「跨时区/跳过规则下的稳定 id」。`FETCHFLAG` 说明它选的是**物化**，并且用标记解决「哪些已经落到任务表」。
- **该学的是**：这是个**必须写进 ADR 的二选一**，且两种都要回答「规则变更后的历史归属」。不要因为看到它物化就跟着物化 —— heyta 的 op-log 语义下物化会让回放产生副作用，那是 [`hard-constraints`](../agents/hard-constraints.md) §3.4 明令禁止的形状。

### 4.3 专注会话单独一条同步通道

- **它**：`FOCUSSYNCOPERATION` 独立成表，没有并进 `TASK` 的同步字段。
- **heyta 现状**：`FocusActions` 只有 `log` / `listSessions`（详情面那条缺口）。
- **该学的是**：**写入频次不同的实体，同步通道要分开**。番茄钟是「高频、短小、单调递增」，与任务的「低频、大对象、需合并」不是同一类负载。混在一条通道里，任务同步会被番茄记录拖慢。

### 4.4 同步脏标记按实体记，而不是靠「全表 diff」

- **它**：`TASKUPDATESTATUS` + `TASKMODIFYTIMES` + `DELAYREMINDER` —— 说明它有「这条任务改过 / 什么时候改的」的显式簿记。
- **heyta 现状**：向量时钟判并发 + LWW + `clientId` 打破平局（另一套解法）。
- **该学的是**：**「改过没」要显式记，不要靠扫全表比 hash**。heyta 的 op-log 天然满足这一点（每个 op 自带因果），所以这条对它更像「确认自己对」而不是「要改」。

### 4.5 第三方日历建成五表链，与任务并列

- **它**：`CALSUBSCRIPTIONACCOUNT`（账号）→ `…PROJECT` / `…CALENDAR` → `…EVENT` → `…ARCHIVEEVENT`，并且有 `bind` / `update` / `support/url` 这类接口。
- **heyta 现状**：日历只读（多端入口审计里明列）。
- **该学的是**：**外部日历不是「任务的一个字段」**，它有自己的账号、容器、事件、归档四层生命周期；把它建成一等实体，才不会在「解绑账号」时丢掉归属。

### 4.6 课程表（`COURSE` + `TIMETABLE` + `COURSEARCHIVE`）

- **它**：一个客群特化的实体（学生课表），带归档表。
- **heyta**：不做。
- **该学的是**：**它敢为一个客群加两张表**。这不是建议 heyta 加课程表，而是提醒：「我们的实体清单是按客群切，还是按功能切」是个该拍的口径 —— 按功能切（任务/清单/习惯）会一直加字段，按客群切会加表。

### 4.7 模板三件套 + 预置项目

- **它**：`PROJECTTEMPLATE` / `TASKTEMPLATE` / `PRESETPROJECT`。
- **该学的是**：**「预置项目」是 onboarding 的载体**，不是「示例数据」。三张表分开，意味着「用户存的模板」与「产品预置的模板」是两类东西（生命周期不同：前者跟账号走，后者跟版本走）。

---

## 5. 不能碰的（表达层）—— 这是本任务的硬边界

| 类别 | 为什么不能 | 备注 |
|---|---|---|
| 3 528 条文案 | 文字表达受著作权保护 | 本文刻意不摘录原文；要对比术语就自己写对照表 |
| 图标 / 插画 / 表情 / 音效（`Clock.m4a`） | 美术作品 | 仓规已禁 |
| 品牌字体 `Gulzar dida.ttf` | 定制字体，随包分发有明确授权范围 | 不许嵌入 |
| 截图 / 录屏 / 逐像素布局 / 动效时序 | 表达（且是「整体观感」受保护的部分） | 看可以，复刻不行 |
| 内部类名前缀 `TT…` / 表名前缀 `ZTT…` | 沿用它等于自证血统，且零技术收益 | 命名自己起 |
| 商标 `TickTick` / `滴答清单` | 商标法 | 仓规已禁 |
| 它的 DDL 原文 | 逐字搬 SQL 是「复制代码」 | 只借约束，不借文本 |

**判据（一句话）：把它的实现抹掉之后，你还能不能独立推出同一个结论？能 ⇒ 那是决定，可以学；不能 ⇒ 那是表达，别碰。**

---

## 6. 没拿到的，以及怎么拿

| 缺口 | 现状 | 怎么补 | 代价 |
|---|---|---|---|
| **本地 SQLite 真实数据/schema 迁移史** | `~/Library/Containers/com.TickTick.task.mac/Data` 与 `Group Containers/75TY9UT8AY…` 都是 `Operation not permitted`（TCC 保护，宿主 App 无「完全磁盘访问权限」） | 给**宿主 App**（不是终端）授「完全磁盘访问权限」，然后 `sqlite3` 读 `*.sqlite` | 用户手动操作一次系统设置；属高权限，需产品负责人同意 |
| **Swift 反编译（看业务逻辑）** | REA 的 `inspect` / `decompile` 需要 Ghidra 12.1（+ JDK 21）或 Hopper；本机都没有 | 装 Ghidra（≈400 MB）或 Hopper（付费）；fat 二进制还需先 `lipo -thin arm64` | 装 Ghidra 约 10 分钟；反编译 Swift 的可读性差（Swift 泛型/协议 witness 表会糊成一团），**投入产出比低** |
| **KMP 共享层（同步/冲突算法）** | 符号已剥，只能看字符串关键词 | 只能反编译 `KotlinMultiplatformAll`（≈9.7 MB Kotlin/Native 产物） | 可读性更差；不建议 |
| **云端协议语义** | 只有 38 条路径名 | 需要抓包（MITM），**本次刻意不做**（要装证书、要过它的证书固定风险） | 越界：属「分析其服务」，不在「分析我本机的副本」范围内 |
| **Windows 端的 BAML → XAML（精确数值）** | 现在拿到的是结构/键名/色板/字号规则，**还没有具体控件尺寸与间距** | 在 Windows 上用 `System.Windows.Baml2006.Baml2006Reader` + `XamlXmlWriter` 把 639 个 BAML 转成 XAML 文本（脚本属下一轮，§9.7） | 半小时类的工作量；`KotlinMultiplatformAll.dll` 仍是 native 符号剥离，反编译性价比低 |

**两条结论**：

1. **macOS 侧想再往下走，性价比最高的是「本地库」而不是「反编译」** —— 库给的是真实 schema + 迁移代数 + 索引选择；反编译给的是「它怎么写的」，而那个东西本来就该由我们自己决定。
2. **Windows 侧现在的唯一瓶颈是「文件没到我手上」，不是技术难度**：是 Electron ⇒ 渲染层（CSS 变量、组件结构、快捷键、i18n、托盘菜单）一次全开；不是 Electron（WebView2 / Tauri / C++）⇒ 也能拿到原生资源与配置，再决定值不值得反编译。

---

## 7. 复现命令（全部可重跑）

```bash
# 0) 代理（本机直连 github 不通）
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890

# 1) 取工具（不进本仓）
mkdir -p /tmp/rea-lab && cd /tmp/rea-lab
git clone --depth 1 https://github.com/morluto/rea.git
npm install --cache /tmp/rea-lab/npm-cache --prefix /tmp/rea-lab/cli rea-agents@6.8.0
export PATH=/tmp/rea-lab/cli/node_modules/.bin:$PATH
rea doctor            # 预期：native 引擎缺失（无 Ghidra/Hopper），静态子命令可用

# 2) 包结构 + nib（REA 单次上限 64 个文档，故按 60 个一批喂假 bundle）
rea inspect-desktop-application /Applications/TickTick.app --format json
rea decode-interface-builder /Applications/TickTick.app --format json   # 头部 64 个

# 3) 文案规模
plutil -convert xml1 -o /tmp/x.plist /Applications/TickTick.app/Contents/Resources/zh-Hans.lproj/Localizable.strings

# 4) 数据模型（DDL 是嵌入字符串，不连库）
TTDB=/Applications/TickTick.app/Contents/Frameworks/TTGRDBPod.framework/Versions/A/TTGRDBPod
strings -a -n 12 "$TTDB" | grep -iE '^create table' | sed -E 's/CREATE TABLE IF NOT EXISTS //' | sed -E 's/ \(.*//' | sort -u    # 58 张表
strings -a -n 12 "$TTDB" | grep -icE '^create table'                                                                          # 116 条语句（含重复定义）

# 5) 接口与 Swift 类型
lipo -thin arm64 -output /tmp/TT-arm64 /Applications/TickTick.app/Contents/MacOS/TickTick
strings -a /tmp/TT-arm64 | grep -oE '/api/v[0-9]/[a-zA-Z0-9/_.-]{2,60}' | sort -u | wc -l   # 38
strings -a /tmp/TT-arm64 | grep -oE '_TtC[0-9]+[A-Za-z0-9_]+' | sort -u | wc -l            # ≈1076

# 6) 权限与签名
codesign -d --entitlements :- /Applications/TickTick.app

# 7) Windows 包：能下、能判形态、解不开载荷
curl -sL "https://ticktick.com/static/getApp/download?type=win64" -o /tmp/TickTick-win64.exe   # 24 130 416 B
file /tmp/TickTick-win64.exe        # PE32 executable (GUI) Intel 80386, for MS Windows
7z l /tmp/TickTick-win64.exe | tail -5   # Comment: This installation was built with Inno Setup.
7z x -y -o/tmp/inno /tmp/TickTick-win64.exe   # 只拆出 PE 段；.idata 是固态压缩流，不是文件树
# 真正解包要 innoextract —— 本机三条路都断（brew/conda 目录 root 所有；bottle 卡在 libboost_system-mt）
```

### 7.1 取 Windows 端（**已跑通**，用 SSH，不用 U 盘摆渡）

```bash
# 别名本来就在 ~/.ssh/config 里：Host windows-pc → 10.111.127.237 / User 41478 / id_ed25519
ssh -o BatchMode=yes windows-pc "echo OK"                    # 密钥免密，一次就通

# 1) 在 Windows 上找安装目录（注册表里没有卸载项，只能搜盘）
ssh windows-pc 'powershell -NoProfile -EncodedCommand <b64>'  # Get-ChildItem -Filter TickTick.exe -Recurse -Depth 3

# 2) 打包再拉回（用 tar.exe；Compress-Archive 在同一目录上失败过一次）
ssh windows-pc 'tar.exe -czf %TEMP%\tt.tgz -C "C:\Program Files (x86)\滴答清单" .'
scp windows-pc:"C:/Users/41478/AppData/Local/Temp/tt.tgz" ./

# 3) 界面资源（不是 app.asar！是 .NET 资源 TickTick.g.resources，1296 条）
ssh windows-pc 'powershell -NoProfile -EncodedCommand <b64>'  # ResourceReader 逐条导出 639 BAML + 630 图片
scp windows-pc:"C:/Users/41478/AppData/Local/Temp/ttbaml.tgz" ./
```

⚠️ 远端 PowerShell 一律 `-EncodedCommand`（UTF-16LE base64）：中文/引号直接进命令行会被吞，报出来的还是「找不到命令」这种误导性错误（与 §7 #603 同族）。
SHARE 盘摆渡仍然可用，但**不再是唯一路径**。

---

## 8. 未核实项，以及一次自己的判错

0. **🔴 勘误（本文第一稿写错、已订正，留原句）**：第一稿写的是「`research/dida365-feature-benchmark.md` 在仓内不存在，索引与文件系统漂移」。**这是错的**：那份文件住在 **`docs/research/`**，而且 `docs/README.md` 里的 `research/xxx.md` 是**相对 `docs/` 解析**的（`check:docs` 的 `resolve(dir, target)` 就是这个口径）。错因是我拿 `ls research/`（仓库根那个目录）去对链接，**没先确认解析基准**。教训与仓内 #208 一族同形：**先问"这个路径从哪一层算起"，再判缺不缺。** 这条勘误本身也是证据：§7 的 `check:docs` 是能红的，别靠眼睛判链接。
1. **未核实**：`Starscream`（WebSocket）承载的是什么（实时同步？协作光标？推送兜底？）—— 只有框架在链上，没有行为证据。
2. **未核实**：v2 是否已停用。38 条路径里 v2 占 32 条、v4 只有 6 条（全是日历），不能据此说「v2 还活着」。
3. **未核实**：`KotlinMultiplatformAll` 是否真的承载同步与冲突解决。只有 `SYNC`/`Patch`/`Clock`/`Conflict` 的字符串计数，没有符号，「有字符串」不等于「有实现」。
4. **未核实**：本地库的真实 schema（表名是**迁移 DDL 的累积**，实际库可能还有运行时 `ALTER`）。这一条只能靠 §6 的 FDA 路线补。
5. ✅ **已核实（Windows，原第 5 条）**：**它不是 Electron。** 是 .NET Framework 4.x + WPF（`TickTick.exe` 托管、639 BAML、`sqlite-net`、WebView2）。上一版把它列成「最高优先级未核实」，现在结案；推翻过程与代价写在 §9.1（教训：**先读 `~/.ssh/config`，再假设「拿不到」**）。
6. **未核实（Windows）**：载荷位数（32/64）、WebView 内核版本、托盘/快捷键注册方式、它是否复用 macOS 同一套业务逻辑（`KotlinMultiplatform` 在 Windows 上是 JVM 还是 Kotlin/Native）。这四条都要等文件。
7. **本次没有做的事**：抓包、登录其账号、读它的用户数据、执行它的任何代码路径、接触你那台 Windows 机器。以上五条都是**刻意的边界**，不是能力不足。

---

## 9. Windows 端实测：**WPF/.NET，不是 Electron**

> 这一节推翻本文上一版的两条判断：①「Windows 大概也是 Electron」（旧 §8 第 5 条）；②「文件拿不到，需要你摆渡」（旧 §6 那行）。
> 真相：它跟 macOS 一样是**原生**的，只是原生在另一套栈上 —— **.NET Framework 4.x + WPF**。而那台机器**一直就写在本机的 SSH 配置里**。

### 9.1 怎么拿到的（这条路径本身要记住）

| 步 | 事实 / 命令 |
|---|---|
| 入口本来就有 | `~/.ssh/config` 里 **`Host windows-pc`** → `10.111.127.237`，`User 41478`，`IdentityFile ~/.ssh/id_ed25519`（另有 `windows-pc-lan` → `192.168.1.2`） |
| 一次就通 | `ssh -o BatchMode=yes windows-pc "echo OK"` → `OK`（**密钥免密**） |
| 装在哪 | 注册表**查不到** TickTick 卸载项（`DisplayName -like '*Tick*'` 空）⇒ 只能搜盘：`C:\Program Files (x86)\滴答清单`（**8.2.5.0**，73 MB），另有一份 `D:\Program Files\滴答清单` 是 **6.0.0.1 旧残留** |
| 取回 | 远端 `tar.exe -czf %TEMP%\tt.tgz -C "<安装目录>" .`（31.5 MB）→ `scp` → 本机解开 73 MB |
| 界面资源 | **不是 `app.asar`**，是 **`TickTick.g.resources`**（.NET 资源，23.1 MB / **1296 条**）。远端 PowerShell 用 `System.Resources.ResourceReader` 逐条导出（**639 个 BAML** + 630 张图片），11 MB 拉回 |

> 🔴 **两粒代价，都记进 §7 #662**：①远端 PowerShell 里的中文与引号会被吞 ⇒ 一律 `-EncodedCommand`（UTF-16LE base64），否则报的是「找不到命令」这种误导性错误；②**先假设「Electron」让我白花了一轮**（下了安装包、试了三条 innoextract 路），而 `resources/app.asar` 在这条路上**根本不存在**。

### 9.2 它是什么（证据表）

| 维度 | 实测 |
|---|---|
| 版本 / 路径 | **8.2.5.0**，`C:\Program Files (x86)\滴答清单`，73 MB |
| 主程序 | `TickTick.exe` **36.3 MB**，PE **x86_64**，**托管 .NET**（REA `rea-dotnet-static` 读到 metadata `v4.0.30319`） |
| UI 栈 | **WPF**（`TickTick.exe.config` 引用 `System.Configuration.*, Version=4.0.0.0`；引用 `PresentationFramework` / `PresentationCore` / `WindowsBase`）+ `CommunityToolkit.Mvvm` |
| 界面产物 | **639 个 BAML**，外加 630 张 PNG/ICO |
| 数据层 | **`sqlite-net`**（`SQLite` 命名空间的 `Table`/`Column` 特性；该 DLL 内 123 个 TypeDef）+ `TickTickDao.dll` + `sqlite3.dll` |
| 共享逻辑 | **`KotlinMultiplatformAll.dll` 6.75 MB**（x86_64 native）—— 与 macOS 的 `KotlinMultiplatformAll.framework` **同名同源** |
| 内嵌浏览器 | **WebView2**（`Microsoft.Web.WebView2.Core/Wpf.dll` + `WebView2Loader.dll`）⇒ 局部富内容走 Chromium |
| 其它关键件 | `SmartDateDLL.dll`（自然语言日期）、`NHunspell`/`Hunspellx64`（拼写）、`Ical.Net`（iCal）、`NodaTime`（时区）、`NHotkey.Wpf`（**全局热键**）、`NAudio`、`QRCoder`、`Mapster`、`Newtonsoft.Json`、`Bugsnag`、`ICSharpCode.AvalonEdit` + **40 份 `.xshd`**（代码高亮） |
| 🔴 卫生问题 | 一起发了**调试版 CRT**：`msvcp140d.dll` / `vcruntime140d.dll` / `vcruntime140_1d.dll` / `ucrtbased.dll`（Debug 运行时不进安装包：体积 + 依赖调试环境） |

### 9.3 界面清单：491 个 view、17 个能力域

`views/` 下 491 个 BAML，按二级目录（前 20）：

| 目录 | 数 | 目录 | 数 | 目录 | 数 | 目录 | 数 |
|---|---:|---|---:|---|---:|---|---:|
| calendar | 37 | upgrade | 15 | project | 11 | setting | 10 |
| config | 35 | theme | 15 | filter | 11 | timeline | 9 |
| misc | 34 | tag | 15 | ai | 11 | quickadd | 8 |
| pomo | 31 | print | 14 | | | tasklist | 7 |
| time | 25 | widget | 13 | | | kanban | 6 |
| habit | 23 | markdown | 12 | | | | |
| countdown | 18 | search | 11 | | | | |
| detail | 17 | | | | | | |

**取值**：与 macOS 的 nib 清单**同构但粒度更细** —— Windows 把「打印」「Markdown」「widget」也拆成独立 view 组（macOS 那边这些在代码里）。**日历（37）与专注（31）在两端都是最重的两块**。
`resource/` 下另有 144 个主题与资源字典：`colorresource`、`fontresource/*`、`icons_light` / `icons_dark` / **`icons_pink`**、`pomoicons`、`sideBar`。

### 9.4 设计系统：三层，且跟前端那套**不一样**

#### ① 颜色：216 个键，其中 **168 个是 `color_#HEX`**

`resource/colorresource.baml` 的键名（原样）：

```
white_02 white_03 … white_95            （25 个：白 + 透明度刻度）
black_02 black_03 … black_95            （23 个：黑 + 透明度刻度）
color_#001968 color_#00ABFA …           （168 个：字面色值）
```

**这是本节最值得看的一条**：它**没有语义 token 层**（没有 `text_primary` / `bg_surface` 这种名字），色值本身就是身份；`color_#XXXXXX` 这种命名一眼是**设计稿导出工具**生成的 —— 它把设计稿色板**整包**搬进资源字典。

后果（**推断，未核实**）：换肤只能**整包换一套字典**，做不到按语义局部替换 —— 这也解释了为什么它要维护 `icons_light` / `icons_dark` / `icons_pink` 三套图标：**主题是整包的**。

> ⚠️ 与 §3.6 ⑤ 对账：macOS 的 nib 里 96% 是**系统语义色**。两端策略**相反**，但别急着判「macOS 更好」—— AppKit 的 `NSColor` 本来就只有语义色可选，它只是顺着平台的便宜路走。**同一个产品在两个平台各走各的便宜路，正是跨端设计系统最容易碎的地方。**

#### ② 字号：**三档可调 + 每档 delta**，不是一套固定 pt

`resource/fontresource/` 有 `font_normal` / `font_middle` / `font_large` 三份，键名形如：

```
Double9_12_13   Double8_12_13   Double11Add1   Double11Add2
Double10Add3    Double20Add2    Double52Add6   Double60Add6
Double72Add6    Double72Add8    Double80Add6   Double92Add8
```

**读法**：`9_12_13` = 同一字号在三档下的取值；`11Add1` = 基准 11、该档 +1。也就是**一套 key + 三张 delta 表**，切字号时布局不重排。
**这条可以直接借**：heyta 若要做「字体大小」设置，**delta 表比三套完整字号便宜得多**。

#### ③ 字体族：5 套包，跟图标/配色并列成主题的一部分

`fontfamily` 资源：`normal` / `yahei`（微软雅黑）/ `sourcehansans`（思源黑体）/ `yozai`（悠哉字体）/ `975maru`（975 丸ゴシック）；
`TTF/` 里另带 BeVietnamPro / CrimsonText / GoogleSans / **Inter** / Manrope。
**取值**：它把「字体风格」当**主题**（与图标、配色一起换），而不是给用户一个 font-family 下拉。

### 9.5 两端对照（同一产品，两套栈）

| 维度 | macOS 8.2.03 | Windows 8.2.5 |
|---|---|---|
| UI 栈 | AppKit（Swift + ObjC 框架群） | **WPF（.NET Framework 4.x）** |
| 界面产物 | 436 nib | **639 BAML**（1296 条资源） |
| 本地库 | GRDB（SQLite） | **sqlite-net**（SQLite） |
| 共享逻辑 | `KotlinMultiplatformAll.framework` | `KotlinMultiplatformAll.dll`（**同名同源**） |
| 自然语言日期 | `nlp_macOS` | `SmartDateDLL.dll` |
| 全局热键 | MASShortcut | NHotkey.Wpf |
| 富文本 / 代码 | Highlightr | WebView2 + AvalonEdit + `.xshd` |
| 颜色策略 | 系统语义色 | **字面色板（168 个 `color_#`）** |
| 字号策略 | 固定 5 档 | **三档可调 + delta** |
| 安装包 | MAS（沙盒 + app group） | Inno Setup，**无沙盒** |

**两个可迁移的判断**：

1. **UI 各写、语义共享**：两端 UI 技术零重叠（nib vs BAML），但**数据模型与同步核心是同一份 Kotlin**。这正是 heyta 的多端策略 —— 这是一个「真这么干也能行」的外部实证。
2. **平台强制项会撕开设计系统**：同一套设计，macOS 走语义色、Windows 走字面色板。说明「跨端一套 token」不能靠自觉，得靠**门禁**（heyta 的 `check:design` 就是干这个的）。

### 9.6 本节新增的可参考项（接 §4 的编号）

- **4.8 字号做「delta 表」而不是「三套字号」**：一处 key + 每档增量，切档不重排（证据 9.4②）。
- **4.9 主题 = 色 + 字 + 图标 三件套整包换**：`icons_light/dark/pink` + 5 套字体族同属一层资源（证据 9.3 / 9.4③）。heyta 的 skin 若只换色，换出来的主题会「半新半旧」。
- **4.10 反面教材：色板字面命名 ⇒ 换肤退化成整包替换**（证据 9.4①）—— 直接支持仓规「语义名不用外观名」。
- **4.11 反面教材：调试 CRT 进了安装包**（`msvcp140d` 一族，证据 9.2）—— 交付清单里值得加一条「产物内无 `*d.dll`」。

### 9.7 还没做的（下一轮）

- **BAML → XAML**：现在拿到的是**结构、键名、色板、字号规则**，**还没有具体控件尺寸/间距/圆角**。要在 Windows 上用 `System.Windows.Baml2006.Baml2006Reader` + `XamlXmlWriter` 转 639 份（脚本属下一轮）。
- **`KotlinMultiplatformAll.dll`**：仍是 native 且符号剥离，结论与 macOS 侧一致（只看到 `SYNC`/`Patch`/`Clock`/`Conflict` 的字符串）。
- **Windows 本地库**：`sqlite-net` 的库文件在 `%APPDATA%` / `%LOCALAPPDATA%` 下，**这次没取**（要先跑起来才有数据）。它的表结构是下一个高价值目标 —— 能直接和 macOS 那 58 张表对账。

---

## 10. 一句话给下一位

> 逆向这件事的价值不在「看到它怎么写的」，而在**「发现它被迫回答过的问题，而我们还没回答」**。
> 本文能直接用的只有 §4 那七条问题清单 + §3.6 那七条形状；其余全是**它的表达**，看一眼就够了。
>
> **Windows 侧已经通了**：它是 WPF/.NET（§9），不是 Electron；取数走 SSH（`~/.ssh/config` 里的 `windows-pc`），不用摆渡。
> 下一轮只有两件事值得做：**BAML → XAML**（拿精确尺寸/间距）与 **Windows 本地库的表结构与 macOS 58 张表对账**。
>
> ⚠️ 还有一条给人看的：**「另一台机器」先读 `~/.ssh/config`，再谈权限、再扫网络**（§7 #662）。本文上一轮把「我看不到你的 Windows」归因成「缺权限」，是错的。
