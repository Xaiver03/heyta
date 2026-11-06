# 滴答清单逆向取证 · 总目录（九份产物的用法）

> 立项 2026-11-06。这是一张**地图**，不是第二份取证：所有读数都在各分册里，这里只回答
> 「哪条结论在哪份文件的哪一节」以及「它可不可信、口径是什么」。
> 上游主干是 [桌面端逆向取证](ticktick-desktop-teardown-2026-11.md)（macOS + Windows 两端实测）。

---

## 0. 怎么用这张表（三条，先读这条再看下面）

1. **本表不复制读数。** 任何数字以**分册原文**为准；本表只给指针与口径。抄到这里就一定漂（仓里已有先例：一句「83 条」六天后就过期）。
2. **引用一个数 = 连口径一起搬。** 每条读数都带「口径」列（子串 / 词边界 / 按文档分组 / DIP / pt / 强·中·推测）。口径没搬，等于把代理写成事实（[§7 #663](../reference/environment-traps.md)）。
3. **「它的选择」与「平台的强制」分开看。** 同一个现象两边成因不同（例：macOS 走语义色是 AppKit 只给语义色，不是它更讲纪律）；混起来就会把平台惯性当成最佳实践抄回来。

---

## 1. 九份产物一览

| # | 文件 | 行数 | 一句话 | 状态 |
|---|---|---:|---|---|
| 主干 | [ticktick-desktop-teardown-2026-11.md](ticktick-desktop-teardown-2026-11.md) | 619 | 两端包结构 / IA / 数据模型 / 接口 / 权限 / UX 读数，**已按各支线回改 4 轮** | ✅ 已入库 |
| P0 | [ticktick-baml-xaml-pipeline.md](ticktick-baml-xaml-pipeline.md) + [`scripts/ticktick/baml-to-xaml.ps1`](../../scripts/ticktick/baml-to-xaml.ps1) | 663 + 644 | Windows 639 BAML → 638 XAML 的通道，尺寸/圆角/间距的事实来源 | ✅ 已入库 |
| P1 | [ticktick-design-parity.md](ticktick-design-parity.md) | 482 | 色 / 字 / 尺 / 图 / 主题 五维双端对照，**含 DIP≠pt 的单位陷阱** | ✅ 已入库 |
| P2 | [ticktick-surface-matrix.md](ticktick-surface-matrix.md) | 478 | 79 行屏幕级三方差集（heyta 有 47 / 半有 11 / 无 21） | ✅ 已入库 |
| P3 | [ticktick-data-model-parity.md](ticktick-data-model-parity.md) | 374 | 43 行实体三方对照（56 张表全覆盖）+ 「存储各写」的硬结论 | ✅ 已入库 |
| P4 | [ticktick-sync-questions.md](ticktick-sync-questions.md) | 973 | 16 个「它一定回答过」的同步问题 + heyta 现状对账 | ✅ 已入库 |
| P5 | [ticktick-keyboard-and-menus.md](ticktick-keyboard-and-menus.md) | 534 | 菜单 62=7+55、13 个键全在系统标准项、**29 个业务项 0 键** | ✅ 已入库 |
| P6 | [ticktick-copy-tone.md](ticktick-copy-tone.md) | 667 | 3 528 条文案的统计画像（零原文摘录）+ 附录五条口径教训 | ✅ 已入库 |
| P7 | [ticktick-states-and-feedback.md](ticktick-states-and-feedback.md) | 495 | 空/载/错/危四态 × 双端；摩擦是**哑铃形**不是阶梯 | ✅ 已入库 |
| P8 | [ticktick-expression-boundary.md](ticktick-expression-boundary.md) | 282 | 表达层边界的三步判定 + 资产归属表 + 门禁缺口 | ⚠️ **未认领产物**，见 §4 |
| P9 | [ticktick-settings-and-personalization.md](ticktick-settings-and-personalization.md) | 558 | 设置树 18 分区 + **个性化 8 维**（heyta 完整 0 / 半有 4 / 无 4） | ✅ 已入库 |
| P10 | [ticktick-ux-ia-and-entry-paths.md](ticktick-ux-ia-and-entry-paths.md) | 592 | **入口四层 + 「作用域定层、代价定深度」规则** + 三条链路读数 + 5 条可判红规则 | ✅ 已入库 |

---

## 2. 结论索引（按主题；每条只给指针，不给读数）

### 2.1 设计系统

| 结论 | 证据 |
|---|---|
| 两端**独立收敛到同一组五档字号** `{11,12,13,14,16}`，三条互相独立的路径都是 88±1% | [P1](ticktick-design-parity.md) 字-1；[P0](ticktick-baml-xaml-pipeline.md) §4.6；主文档 §9.4③ |
| **两端都没有「刻度」**：Windows 1 083 种 Margin、macOS 一堆裸 Frame；`Button` 高度五档并存 | [P0](ticktick-baml-xaml-pipeline.md) §4.2/§4.4；主文档 §9.4 尺寸表 |
| **单位陷阱**：macOS 用 pt、WPF 用 DIP，`24` 与 `24` 物理不等（差 33%） | [P1](ticktick-design-parity.md) C14；[§7 #663](../reference/environment-traps.md) 第三方向 |
| 颜色层两端**策略相反**：macOS 96% 走语义色，Windows 215 键里 167 个是字面色 | [P1](ticktick-design-parity.md) 色-1/色-2；主文档 §3.6⑤ / §9.4① |
| 字号可调的实现是**三档 + delta 表**，不是三套字号 | [P1](ticktick-design-parity.md) 字-3（数值强度**中等**，见其失效条件） |
| 🔴 heyta 自身缺陷：暗色侧 66 个语义色里 **46 个是字面值、21 个原色阶里没有** | [P1](ticktick-design-parity.md) 差距 3.3 —— **与竞品无关，优先于对标** |

### 2.2 界面地图

| 结论 | 证据 |
|---|---|
| 79 行矩阵：heyta **有 47 / 半有 11 / 无 21 / 未核实 0** | [P2](ticktick-surface-matrix.md) §1 |
| **主路径只缺两格**：`明天`（`task-filter.ts:51` 七分支无 tomorrow）、`标签管理页` | [P2](ticktick-surface-matrix.md) §2 P0 两格 |
| 11 格「半有」的成因是**粒度不同**（窗口 vs 视图 key），不是漏做 | [P2](ticktick-surface-matrix.md) §3；待裁决项见 §5 |
| 三格「无」已有立场冲突：委派/团队（`assigneeUserId?` 是孤儿字段）、应用锁、白噪音（`audio` API 全仓 0） | [P2](ticktick-surface-matrix.md) §2；P5 §3 交叉印证 |

### 2.3 数据模型

| 结论 | 证据 |
|---|---|
| 三列对照 43 行、56 张业务表全覆盖：对应 12 / 语义不同 15 / 它有我无 15 / 我有它无 1 | [P3](ticktick-data-model-parity.md) §1 |
| 🔴 **「语义共享、UI 各写」在数据层其实是「存储各写」**：专注 8 对字段零同名、排序 7 表 vs 3 表、`children` 在 Windows 拼成 `Chidlren` | [P3](ticktick-data-model-parity.md) §3；主文档 §9.5 |
| 它多的 6 类（多账号 / 每视图排序 / 重复实例物化 / 专注队列 / 日历五表链 / 模板三件套），**该补的只有 2 项** | [P3](ticktick-data-model-parity.md) §2 |
| Windows **没有可读 DDL**：类即表、`[Ignore]` 111 处 ⇒ 属性集 ≠ 列集 | [P3](ticktick-data-model-parity.md) §0；主文档 §9.7 |

### 2.4 同步与冲突

| 结论 | 证据 |
|---|---|
| 98 条 `/api/`（主二进制 38 + TickTickKit 60，零重叠），**可见字面里没有 `/sync`、没有 `/delta`** | [P4](ticktick-sync-questions.md) §2.1；主文档 §3.5 |
| **同步引擎在原生层**（`TTSyncManager.swift` 一族），Kotlin 只共享枚举与词表 | [P4](ticktick-sync-questions.md) §2.2；主文档 §2.1 |
| 它走**状态同步**不是事件溯源：`ZSYNCSTATUS` 覆盖 36/58 表、**58 表里没有全量 oplog** | [P4](ticktick-sync-questions.md) §2.3 |
| 专注是**唯一操作队列**形状（`ZOID`+`ZOTYPE` 只在 `ZTTFOCUSSYNCOPERATION`）；重复实例按 `FETCHBEGINDATE/END` **闭区间水位懒物化** | [P4](ticktick-sync-questions.md) §2.4/§2.5；主文档 §4.2/§4.3 |
| heyta 对账 16 问：**答了 9 / 语义不同 5 / 没答 2** | [P4](ticktick-sync-questions.md) §4 |
| 🔴 **它从不把「冲突」说给用户听**：41 个语言、143 939 条文案里 `conflict` **0 命中**；中文「冲突」0、「覆盖」只用在模板、「未同步」才是它对同步出事的口径 | [P4](ticktick-sync-questions.md) §5.3 |
| Kotlin 层**不是只有词汇**：Windows 那颗 DLL 没剥净符号，有 `modifyrepeat.sync.entity.*` 一族 ⇒ 承载**规则与模型**，不承载**传输** | [P4](ticktick-sync-questions.md) §1.2 |

### 2.5 键盘与入口

| 结论 | 证据 |
|---|---|
| 菜单 **62 = 7 + 55**（菜单栏自身 7 + 叶子 55）；不用担心被读成 62 个叶子 | [P5](ticktick-keyboard-and-menus.md) §1.2 |
| **13 个键 100% 落在 AppKit 标准项上；29 个业务项带键 0 个** | [P5](ticktick-keyboard-and-menus.md) §3 |
| heyta 今天只有 **1 个组合键**（⌘,）；`setApplicationMenu / Tray( / globalShortcut` 全仓 0 | [P5](ticktick-keyboard-and-menus.md) §4 |
| `⌘Z` 是唯一「抄了也没用」的键（heyta 无撤销历史栈） | [P5](ticktick-keyboard-and-menus.md) §4.3 |

### 2.6 文案与语气

| 结论 | 证据 |
|---|---|
| 全库只有 **93 条疑问句（2.6%）**；危险决策件 115（标签 59 / 疑问 37 / 后果 15 / 勾选 3 / 逐字 1） | [P6](ticktick-copy-tone.md) §3 |
| **确认 ≠ 问句**：账号档 2 勾选 + 1 全大写逐字、**0 问句** ⇒ 按问号扫门禁会整族漏检 | [P6](ticktick-copy-tone.md) §3.3 |
| **短标签区 36.2% 的中文比英文更宽**（p95 1.25）⇒ 留白按中文定、行数按英文定 | [P6](ticktick-copy-tone.md) §5 |
| AI 真值 **119**（267 是子串假象） | [P6](ticktick-copy-tone.md) §4；主文档 §3.3 勘误 |

### 2.7 四态与反馈

| 结论 | 证据 |
|---|---|
| 它的摩擦是**哑铃形**（零摩擦+撤销 ↔ 重模态），**`popconfirm` 整档缺失**；我们是连续阶梯 | [P7](ticktick-states-and-feedback.md) §4 |
| 比我们**松**三格（危险确认带 ×、危险主按钮用常规样式、中间档没有）；比我们**紧**三格（逐字键入下放到清空数据、批量前勾选承诺、不可逆先选处置） | [P7](ticktick-states-and-feedback.md) §4.2 |
| **骨架屏两端都只在 AI 面**；**两端都没有「错误层」**；「重试」全包 2 处都在 AI | [P7](ticktick-states-and-feedback.md) §3 |
| 空态是**分档**的（看板不居中 / 四象限居中 / 日历是卡片 / 侧栏零控件） | [P7](ticktick-states-and-feedback.md) §2 |
| `resource/` 144 个 BAML 15 MB → XAML 38 KB（**保留 0.3%**）⇒ token 数值确实读不到 | [P7](ticktick-states-and-feedback.md) U2 |

---

## 3. 已被推翻的读数（勘误台账 —— 引用前先看这里）

| 原说法 | 现在 | 谁推翻的 |
|---|---|---|
| 「AI 文案 267 条」 | 子串假象（fail/email/daily…），真值 **119** | P6 |
| 「62 个非分隔菜单项」（易读成 62 个叶子） | **7 + 55** | P5 |
| 「38 条 `/api/`」 | **38 + 60 = 98**，Kit 那半零重叠 | P4 |
| 「同步/冲突在 Kotlin 共享层」 | **引擎在原生层**，Kotlin 只有枚举 | P4 |
| 「`FETCHFLAG` 是取用标记」 | **闭区间水位**（`FETCHBEGINDATE/END`）⇒ 按视窗懒物化 | P4 |
| 「颜色 216 键 / 168 个 `color_#`」 | **215 / 167**（1 枚重复） | P1 |
| 「639 个 BAML + 630 图片」 | `ui/` 实有 **1296** 文件（639 baml + 657 其它） | P1 |
| 「业务实体在 `TickTickModels.dll`」 | 在 **`TickTick.exe` 的 `ticktick_WPF.Models`**（292 类型） | P3 |
| 「具名 token 数值一律未核实」 | 分两条路：XAML 读不到、**原始 BAML 字节读得到**（中等强度，带自校验） | P1 |
| 「空态占位 30 个、高度恒 450」 | **44 个**；450 那 24 个全在同一个 nib；真实宿主里**与容器同框** | P7 |
| 「Windows 没有回收站」 | 回收站是**模式不是 view**（两端同构，复用列表承载） | P7 |
| 「heyta 连排序字段都没有」 | **`Task.order?` 已存在**（`entities.ts:423-424`）、`manual` 排序键已在读；缺的是**写路径与界面**，不是字段 | qoder·per-view-sort |

---

## 4. P8 为什么标「未认领」

`ticktick-expression-boundary.md` 在**该支线启动之前**（18:06）就已存在，内容与规格相符但**写入者不明**，且它是在 P1/P2/P3/P7 结论之前写的 —— 那几条恰恰是它「资产类型 → 谁拥有」表的主要输入。

处置：**先入库不删**（内容有独立价值：三步判定、资产归属表、门禁缺口），但在本表标「未认领」；谁认领它，谁负责补三件事：
1. 把 P6 的 **7-gram 重叠检测**写进门禁建议（这是目前唯一机器可验的表达层判据）；
2. 把 P7 的「危险确认带 × / 常规主按钮」补进它的反例；
3. 核一遍它引用的读数有没有落在 §3 的勘误台账里。

---

## 5. 还没有答案的（引用时不要当成已决）

**待产品拍板（3 条）**

1. **「屏」的粒度**：按窗口数补（滴答 Windows 153 窗 / macOS 35）还是按视图 key 补（heyta 12 个）？—— 不裁决，[P2](ticktick-surface-matrix.md) 那 11 格「半有」只能挂着；按窗口数补会多出约 150 个窗。
2. **每视图独立手排**：heyta **字段已有、写路径没有**（`Task.order?` 在 `entities.ts:423-424`，`manual` 键在读；`entities.ts:348-356` 禁的是另两个字段名），没有 ADR 回答过（[P4](ticktick-sync-questions.md) Q6 原话已过期，见 [决策备忘](decisions/decision-per-view-sort.md)）。
3. **多账号本地库隔离**：三壳库名写死、`packages/storage/src` 里 `accountId` 命中 0、退出登录不清 op-log ⇒ 换账号后上一个账号的任务还在本地（[P4](ticktick-sync-questions.md) Q7）。

**未核实（高频被引用的 4 条）**

- Windows 顶层导航是否与 macOS 那 13 项同构（BAML 读不到文案）—— 影响「明天」P0 的强度（[P2](ticktick-surface-matrix.md) §4）。
- `KotlinMultiplatformAll` 的同步语义（native、符号剥离，只有字符串）。
- Windows 本地库的表结构（要它跑起来才有数据；且**无可读 DDL**）。
- 主任务列表的空态（macOS 占位无子视图 / Windows `EmptyView` 被引用 10 处但**全包没有 `emptyview.xaml`**）（[P7](ticktick-states-and-feedback.md) U1）。

---

## 5.1 决策备忘（远端 qoder 跑出，本机验收后入库）

| 文件 | 回答什么 | 状态 |
|---|---|---|
| [decision-surface-granularity.md](decisions/decision-surface-granularity.md) | 屏按窗口数补还是按视图 key 补 | 待拍板 |
| [decision-per-view-sort.md](decisions/decision-per-view-sort.md) | 要不要 per-view 手排（**并纠正了「连字段都没有」**） | 待拍板 |
| [p2-half-cells-evidence.md](decisions/p2-half-cells-evidence.md) | P2 那 11 格「半有」逐格取证 | 证据已备 |
| [dark-theme-token-audit.md](decisions/dark-theme-token-audit.md) | 暗色 46 枚字面值逐个列出 + 三类修法 | 证据已备 |
| ⚠️ 多账号隔离 | 远端那条**跑失败了**（exit 1），无产出 | **缺** |

> 这批由 `linux-dev` 上的 qoder CLI 并行产出，**本机逐条复核后才入库**；其中 per-view 那份直接推翻了我的一处结论（见 §3 台账最后一行）。

## 6. 引用纪律（写死）

1. **只学决定、不碰表达**：文案 / 图标 / 品牌字体 / 截图 / 逐像素 / `TT`·`ZTT` 命名 / 商标 —— 判据见主干 §5。
2. **每个数字带口径**（子串 / 词边界 / 按文档分组 / DIP / pt / 强·中·推测）。
3. **「没有」必须配阳性对照**：否定判据写进结论前，同一条命令拿一个确定存在的名字跑一遍，打出非 0 才算数（[§7 #663](../reference/environment-traps.md)）。
4. **跨端比尺寸先统一单位**（pt vs DIP）。
5. **本表不复制读数**；读数只在分册里，改分册不必改本表（除 §3 台账）。
