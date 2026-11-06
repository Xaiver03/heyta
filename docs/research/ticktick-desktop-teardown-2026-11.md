# 滴答清单 macOS 端逆向取证（REA）—— 只取「决定」，不取「表达」

> 立项：2026-11-06。授权口径：产品负责人要求「下载 GitHub 上很火的 REA，看一下能不能逆向本地的滴答清单；
> 只看看有没有可以参考的地方，**不照抄**」。
>
> 本文只回答两件事：**① 能不能逆向**、**② 逆向出来的东西里，哪些是可以学的决定、哪些是碰不得的表达**。
> 它不是功能对标表（那是 [`dida365-feature-benchmark`](dida365-feature-benchmark.md) 的活），
> 也不是实施计划：本文**不提**任何工单，任何一条要落地都得先过自己的 ADR。

---

## 0. 三句话结论

1. **能逆向，而且已经拿到了「法律上最安全、工程上最有用」的那一层** —— 包结构、界面清单、文案规模、**完整数据模型**、接口与权限。全部是静态观察，一行代码没执行、一个账号没登录。
2. **滴答 macOS 端是原生 Swift + Objective-C 框架群，不是 Electron。** 所以「扒 `app.asar` 看 JS」那条最省事的路**对它无效**；REA 的 Electron/JS 分析路径用不上，用上的是它的 Apple bundle / nib / Mach-O 静态面。
3. **真正值得参考的是它数据模型里的几个「决定」**（每个视图一张独立的手动排序表、重复任务实例物化 + fetch flag、专注会话单独一条同步通道、第三方日历建成五表链），**不是界面细节**。界面细节（文案、图标、字体、截图、逐像素布局）恰恰是著作权与商标保护得最实的那一层 —— 那也是唯一不能碰的一层。

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
| AI | **267** | | Tag | 61 |
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

读法（**这是代理，不是结论**）：它的文案重心在 **AI（267）> 日历（126）> 专注（89）≈ 习惯（83）**。AI 的 267 条里含大量免责/引导/失败态文案 —— 说明 AI 在它那里是**需要被解释的功能**，而不是一句「智能排程」的卖点。这一条对 heyta 有用：**AI 的文案量 ≈ 用户困惑量**。

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

**结论：想再往下走一步，性价比最高的是「本地库」而不是「反编译」。** 库能给的是真实 schema + 迁移代数 + 索引选择；反编译给的是「它怎么写的」，而那个东西本来就该由 heyta 自己决定。

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
```

---

## 8. 未核实项，以及一次自己的判错

0. **🔴 勘误（本文第一稿写错、已订正，留原句）**：第一稿写的是「`research/dida365-feature-benchmark.md` 在仓内不存在，索引与文件系统漂移」。**这是错的**：那份文件住在 **`docs/research/`**，而且 `docs/README.md` 里的 `research/xxx.md` 是**相对 `docs/` 解析**的（`check:docs` 的 `resolve(dir, target)` 就是这个口径）。错因是我拿 `ls research/`（仓库根那个目录）去对链接，**没先确认解析基准**。教训与仓内 #208 一族同形：**先问"这个路径从哪一层算起"，再判缺不缺。** 这条勘误本身也是证据：§7 的 `check:docs` 是能红的，别靠眼睛判链接。
1. **未核实**：`Starscream`（WebSocket）承载的是什么（实时同步？协作光标？推送兜底？）—— 只有框架在链上，没有行为证据。
2. **未核实**：v2 是否已停用。38 条路径里 v2 占 32 条、v4 只有 6 条（全是日历），不能据此说「v2 还活着」。
3. **未核实**：`KotlinMultiplatformAll` 是否真的承载同步与冲突解决。只有 `SYNC`/`Patch`/`Clock`/`Conflict` 的字符串计数，没有符号，「有字符串」不等于「有实现」。
4. **未核实**：本地库的真实 schema（表名是**迁移 DDL 的累积**，实际库可能还有运行时 `ALTER`）。这一条只能靠 §6 的 FDA 路线补。
5. **本次没有做的事**：抓包、登录其账号、读它的用户数据、执行它的任何代码路径。以上四条都是**刻意的边界**，不是能力不足。

---

## 9. 一句话给下一位

> 逆向这件事的价值不在「看到它怎么写的」，而在**「发现它被迫回答过的问题，而我们还没回答」**。
> 本文能直接用的只有 §4 那七条问题清单；其余全是**它的表达**，看一眼就够了。
