# 习惯面完整计划（H 系列）

> 触发：产品负责人两次拿滴答（TickTick）的习惯页对照本仓库，指出"习惯的界面是不是还没改过"。
> 本篇把**习惯这一整面**（数据 → 写入口 → 中栏排法 → 读数 → 端间对称 → 取证）排成一份可开工的清单，
> 并把散在 [详情面对齐计划](detail-pane-alignment.md)（W 系列）与
> [调研](../research/detail-pane-alignment-and-spaced-review.md) §A5 里的习惯条目**收成一处**。
> 工单编号用 `H`，与 W 系列不抢号；凡引用既有 W 单的地方都写明"就是那张单"。
>
> **范围前提**：heyta 还在开发阶段（AGENTS §0），"会不会破坏存量数据"不作为判断依据；
> 但每条缺口仍然要指出真问题在哪，不接受"同行有所以我也要有"。

---

## 0. 一句话

习惯的**读数与打卡**（W6 值那一米、W8 六卡）在 2026-10-05 已经落地并有变异台；
**没落地的集中在两处**：① 中栏的**排法**（一条纵列，滴答是两列卡片）、
② **写入口缺了两个字段**（`frequency` 与习惯图标在移动端 —— 都是"实体/判定里有、界面不碰"）。
所以"对准滴答"这句话在 2026-10-06 的真实含义不是"数字不够多"，是**排法与写入口**。

🔴 **本段原写"三处"，其中"移动端建不了习惯"是假的** —— 那是本篇 §1 现量时的一个假阴性，
2026-10-06 00:4x 重测否证（移动端的新建入口随 `b2b5455a`（09-28 22:02）就落地了）。
成因与全部更正记在 **§9**，因为它改变了 H 系列的范围，不是措辞问题。

## 1. 现状（2026-10-06 00:0x 逐处现量；每条都给了命令，别照本节念）

| 面 | 事实 | 现量命令 | 读数 |
|---|---|---|---|
| 打卡能不能记**实际值** | ✅ 能，两端都接 | `grep -n "checkIn(" packages/ui/src/habits/HabitBoard.tsx apps/web/src/features/habits/store.ts apps/mobile/src/screens/HabitsScreen.tsx` | 签名 `checkIn(habitId, date?, value?)`（`habit-actions.ts:167/331`）；web `store.ts:123` 与 mobile `HabitsScreen.tsx:403` 都把 `value` 递下去 |
| 六张统计卡的算式 | ✅ 有唯一所有者 | `grep -rn "computeHabitPeriodStats" packages` | `habit-streak.ts:328` 定义，`motivation.ts:202` 取数（`month` 是**必填**成员），四格渲染在 `HabitBoard.tsx:590-631`；落地账见 W 篇 §8.121 |
| 中栏的**排法** | ✅ **两列卡片**（2026-10-06 01:0x，工单 H1 落地） | `sed -n "$(grep -n '^.ht-habit__list {' apps/web/src/styles/app/habits.css \| cut -d: -f1),+8p" apps/web/src/styles/app/habits.css`；`grep -n "@container" apps/web/src/styles/app/habits.css` | 外层从 `flex-direction: column` 换成 `display: grid`，`@container (min-width: 33rem)` 那一档排两根等宽轨道；阈值 33rem = 2×16rem（本文件 `.ht-habit` 那根既有下限）+ `--ht-space-2`。**DOM 一行没动**（`.ht-habit__item` 本来就是带边框圆角的一枚卡）；判据 `e2e/tests/habits-two-column.spec.ts` T1–T7 **7 passed**，臂台 `mutate-habits-two-column.mjs` 见 §2 的 H1 那一行 |
| 中栏有没有标题行 | 🔴 没有（第一枚子元素是新建表单） | `sed -n '118,126p' apps/web/src/features/habits/HabitsView.tsx` | `.ht-habit__side` 里直接是 `<form>` |
| 有没有视图切换 | 🟡 **中栏没有（这是裁决，不是缺口）**，**详情面有「月 ⇄ 年」两档**（2026-10-06 05:2x，工单 H7 落地） | `grep -rn -e viewMode -e segmented apps/web/src/features/habits/`；`grep -rn "CalendarViewTabs" apps/web/src/features/habits apps/mobile/src/screens/HabitsScreen.tsx packages/ui/src/habits/` | 中栏那一列仍然**真 0**（上一版那条命令里的 `\|` 在 ripgrep 里是字面竖线，那个 0 不算数；00:4x 用 `-e … -e …` 重跑仍 0，等价于 `-E "viewMode|segmented"`）⇒ §5 的 **P-5** 拍的是"不做"：中栏是**跨习惯**的，而这两档切的是**单条习惯**。详情面那一侧现在命中 1 处（`packages/ui/src/habits/HabitTrendBoard.tsx` 里共享 `CalendarViewTabs`，两端各挂同一枚容器）—— 档位词表走 `CALENDAR_VIEW_LABEL_KEYS` 的**子集**，没有新增词条 |
| 有没有**月历 / 年视图**的习惯尺度 | ✅ **两档都有了**（月历 2026-10-06 03:4x = H4；年视图 2026-10-06 05:2x = H7） | `grep -rn "monthGrid" packages/ui/src`；`grep -rln "HabitYearBoard\|HabitTrendBoard" apps/web/src apps/mobile/src packages/ui/src/index.ts` | 习惯侧的 `monthGrid` 消费者从 **0 变 1**（`packages/ui/src/habits/month-model.ts`，共享 `HabitMonthBoard` 两端同挂）；年那一档的取数是 `packages/domain/src/habit-year.ts`（**逐月调用** `computeHabitPeriodStats`，不重写算式），渲染是 `packages/ui/src/habits/HabitYearBoard.tsx`，两端消费者现量 **3 个文件**（容器 + 两端宿主）。热力图那一档没被替换：它回答"打过没有"（`icon.xs` = 14px 装饰格、不可点），月历回答"哪天还能补"（44px 可点），年卡回答"这一月过成什么样" |
| `backfillDays` | ✅ **有读取者了**（2026-10-06 03:4x，工单 H4 落地）—— 之前是"透传但没人写、也没人读"的死字段 | `grep -rn "backfillDays" packages/domain/src/habit-backfill.ts`；`grep -rln backfillDays packages/*/src apps/*/src server 2>/dev/null` 再剥注释 | 唯一裁决者 `packages/domain/src/habit-backfill.ts`（`backfillWindowDays` / `habitDayState` / `isBackfillAllowed`），默认值 **从 `REPAIR_WINDOW_DAYS` 推导**而不是另拍一个数 ⇒ 没设过该字段的习惯行为逐字不变（还是只能补昨天）。phase-1 计划 §D4 那句"上限由 `backfillDays` 控制"第一次真的兑现；界面侧那句提示（`web.habits.month.window`）读的是同一个函数。🔴 **P-1 的"是否允许无限回溯"仍没拍**：现量是"不设 = 1 天，设了 = 设的那个数"，而**界面上还没有能设它的控件**（写入侧只有 `NewHabitFields.backfillDays`，见 §5 的 H4 那一行） ⚠️ 这一族**原本就有**一枚补打卡入口（`HabitBoard.tsx:813-825` 的 `habit-repair-<id>`），它补的是**领域层算出的那一枚断链日**（`shouldOfferRepair` = `streakIfRepaired ≥ 2`），与月历那格"任意窗口内历史日可点"是两件事，两个入口共用 `onCheckIn(id, date)` 同一条写路径。
| `frequency` | ✅ 判定侧与**写入口**都在了（2026-10-06 02:5x，工单 H5 落地） | `grep -n "isScheduledOn" packages/domain/src/habit-streak.ts packages/domain/src/habit-resilience.ts packages/domain/src/today-progress.ts`；界面侧 `grep -rn "setHabitFrequency" packages/app-host/src apps/web/src apps/mobile/src` | 判定侧命中 **8 处**（`habit-streak.ts:131/158/227/360`、`habit-resilience.ts:165/239`、`today-progress.ts:109`），`computeStreak` 的注释自己写着「只数**该打卡的日子**，跳过不该打卡的日子（否则每周一次的习惯永远只有 1）」；**界面写入从 0 处变成两端各一处**（web `HabitFrequencyEditor.tsx` 挂 `renderGoalSlot`、mobile `habit-frequency-slot.tsx` 挂详情层，都走 `app-host` 的 `setHabitFrequency`）；MCP 侧**刻意不出**（`local-api-host.ts:331`，那是设计不是洞，本单没顺手改）。🔴 原句"死字段"把两件事混成一件，据它拍的 **P-2 前提已被 §9 否证** |
| `HabitLog.note` | 🔴 **死字段** | `grep -n "note" packages/domain/src/entities.ts \| sed -n '/415/,/422/p'`；`grep -rn "\.note" apps/web/src/features/habits packages/ui/src/habits apps/mobile/src/screens/HabitsScreen.tsx` | 实体有 `note?`（`entities.ts:421`）；习惯这一族里读写 **0 命中** |
| 移动端能不能**新建**习惯 | ✅ **能**，而且是常驻入口不是空态引导卡 | `grep -rn -e addHabit -e createHabit --include='*.tsx' apps/mobile/src`（🔴 这一行原本写的是 `grep -rn "addHabit\|createHabit"`，那枚 `\|` 在 ripgrep 里是字面竖线 ⇒ 恒 0，见 §9） | `HabitsScreen.tsx:428-456` = `Card` 里 `TextField` + 主按钮，`:442` 空名直接 `return`，`:446` `.createHabit(name)` ⇒ 一条 op，失败进 `setError`；随 `b2b5455a`（09-28 22:02「移动端对齐 Web 的同一批能力」）落地。🔴 **本篇第一版写的是"不能"** |
| 移动端能不能改**图标** | ✅ **能**（2026-10-06 02:1x，工单 H3 落地） | `grep -rn -e setHabitIcon -e HabitIconSlot -e HABIT_GLYPHS apps/mobile/src` | 从 **0 命中** 翻成 3 处：`apps/mobile/src/ui/habit-icon-slot.tsx`（新）+ `HabitsScreen.tsx` 详情层挂载 + `actions.setHabitIcon`；🔴 字形与词条都**取自共享层**（`HABIT_GLYPHS` / `HABIT_ICON_LABEL_KEYS` 从 `@heyta/ui` 导出），没有第三张表 —— 臂台 A1/A2 就是拿"再抄一张"当坏形状打的。⚠️ **端间"看得见"那一半仍未取设备读数**（模拟器没起），登记见 §2 的 H3 那一行 |
| 移动端能不能改名/删除 | ✅ 能 | `grep -n "renameHabit\|removeHabit" apps/mobile/src/screens/HabitsScreen.tsx` | `:227` / `:240`（文件头 `:343-344` 记着"此前界面上一个入口都没有"这段历史） |
| 词条是否中英同步 | ✅ 同步 | `for p in web.habits mobile.habits common.habits; do for f in zh-CN en; do echo -n "$f "; grep -c "'$p\." packages/i18n/src/locales/$f.ts; done; done`（🔴 数的是**关名**，别数行 —— 一条值换行会多算） | 06 05:2x 现量：`web.habits` **91 / 91**（含 H7 那年新增的 7 枚 `web.habits.year.*`，两侧各 7）、`mobile.habits` 2 / 2、`common.habits` 6 / 6；`check:ui-language` 也在链上（本批实测绿：词条表 zh-CN 3250 / en 3250）。⚠️ 上一版这里写的 `63 / 63` 已被 H4/H5/H7 三批新增超过 —— **这一格的数字必须现量取，不许照本节念** |
| 桌面三壳 / node-host / landing 有没有习惯 UI | 边界，不是缺陷 | `grep -rin "habit" apps/desktop apps/desktop-macos apps/desktop-linux apps/desktop-windows` | **0 命中**；node-host 只有 CLI（66 处，无界面）；landing 只有宣传用的 `src/mockup/HabitHeatmap.tsx` |
| 既有测试与台架 | 单测 142 条 + e2e 18 条 + 5 台变异台 | `ls apps/web/tests \| grep -i habit` 等 | web 4 文件 75 例、mobile 2 文件 23 例、`packages/ui` 2 文件 44 例、e2e 4 文件 18 例；台架 `mutate-habit-detail-card / -habit-period-stats / -habit-rate-label / -habits-selection-fallback / -detail-pane-habit-e2e` |
| 棘轮基线 | 28 | `grep -n "HT_FAMILY_BASELINE" scripts/check-row-single-source.mjs` | `:341` → `HT_FAMILY_BASELINE = 28`（🔴 新增 `.ht-habit__*` 一族必须**同时消掉一族**才净增为零） |

## 2. 工单（每张都写：范围 / 落点 / 判据（必须能红）/ 变异臂 / 依赖）

### 第一批 —— 不等任何拍板

| 单 | 范围与落点 | 判据 | 变异臂 |
|---|---|---|---|
| **H1 中栏两列卡片网格** ✅ **已落地**（`fce8468a`，2026-10-06 01:2x）（= [W13a](detail-pane-alignment.md)，题目/落点/判据写在那张单里，**开工前读那份**） | `apps/web/src/styles/app/habits.css`（唯一落点：`container-type: inline-size` + `@container (min-width: 33rem)` 那两档）；🔴 `HabitsList.tsx` 与 `packages/ui/src/habits/*` **都没动** —— `.ht-habit__item` 本来就是带边框圆角的一枚卡，DOM 一行不动，而共享层一动就推给四端 | ① **存在性**：每张卡各自各有底盘+名字+7 点+三个数，且卡片数 == `rows.length`（T1）；② **几何**：`boundingBox()` 证"第 1、2 张卡 `y` 同 `x` 异"，并**合起来铺满整列**（T2/T3）；③ 选中态仍单源（T6）；④ `aria-label` 一次念完三数 —— **不在这一族里**，已由 `apps/web/tests/habits-list-pane.spec.tsx:218` 钉住（逐字比中文整句），e2e 不重复；⑤ 暗色实际切了看（T7 + 图） | 臂台 `research/tools/mutation-rigs/mutate-habits-two-column.mjs`，读数 **3/3**：N1（摘掉 `container-type`）与 N2（`@container` 里换成单轨 = "改了名字没改布局"）红集**恰为** T2,T3,T7；N3（三个数字搬回左轨）恰为 T5；三臂的 jsdom 层 `Tests 23 passed` **全盲** ⇒ 这 7 条不是那 8 组的重复；复原 `BACK_TO_CLEAN` 两层复跑绿。<br>🔴 **N3 前两版形状都打空**，而那是**臂自己的错不是判据没牙**（记进臂的注释）：注入"让名字不肯收缩"（先是 `.ht-habit__name{min-width:max-content}`，再是行轨道 `max-content auto`）时 e2e 7 条全绿 —— `auto` 轨道的**基数是 min-content**（growth limit 才是 max-content），轨道总宽超出容器时网格**不收缩**，于是数字整组停在卡片内、多余宽度从 `justify-self:end` 那侧**往左**溢出。⇒ "数字被挤出右边界"这一份坏在当前 DOM 里**结构上造不出来**，T5 真正守的是"贴右边界"那一档。⚠️ 别复用外层那条 `boundingBox()` 判据（它量的是"清单列 vs 详情栏"） |
| **H2 移动端新建：判据** ✅ **已落地**（2026-10-06 01:3x，`apps/mobile/tests/habit-create-entry.spec.ts` 11 条 + 臂台） | 入口在 `HabitsScreen.tsx:428-456`（`TextField` + 主按钮 + `:446 createHabit(name)`，随 `b2b5455a` 09-28 落地），**不缺界面**；缺的是钉住它的判据 —— 现量 `grep -rln createHabit apps/mobile/tests` 当时只命中 `organizer-rename.spec.ts`（那是清单/标签），**习惯新建本身 0 条判据** | 🔴 **两层**，各挡一份对方挡不住的坏。**行为层 B1–B4**（真 `OpLogEngine` + 真 SQLite，与 `organizer-rename.spec.ts` 同一副夹具）：B1 新建 = **全局**恰好 +1 条 op 且 CREATE 只带 `name`+`target`（挡 fan-out）；B2 重放整条日志后仍在（挡"写进内存态没写进日志"= 重开 App 就没了）；B3 第二个 clientId + 第二个空库 `applyRemote` 后**动作层** `listHabits()` 读到同一条（挡"只写本地数组"，也就是工单点名的那条变异）；B4 空白名动作层抛错且 op 数不变（钉本屏 `:441` 那句注释依赖的契约；事实源在 `packages/app-host/tests/habit-actions.spec.ts`，这里只钉"消费方以为它成立"那一格）。**源码层 J1–J7**（本壳没有 RN 组件测试栈）：入口在、空名拦在写入**之前**（还钉顺序）、`.catch` 里必须出现 `setError(`（吞掉错误的 catch 与没有 catch 对用户是同一件事，但只判 `.catch` 存在会永远绿）、写完 `refresh()`、那份数组**只能来自 `listHabits()`**、全壳调用点**恰好一枚**、三个文案全走词条 | 臂台 `research/tools/mutation-rigs/mutate-habit-create-entry.mjs`，读数 **4/4**：M1（写入换成本地数组）红集**恰为** J1,J2,J3,J4,J5,J6 而 **B 层全绿**、M2（摘掉空名拦）恰为 J2、M3（catch 换成空函数）恰为 J3，复原两层复跑绿；**B 层的牙**用一份临时副本把动作层换成"只 push 本地数组"的桩取到（红集=B1,B2,B3，J 层不红），副本跑完删除并检查无残留。⚠️ 两条**过程读数**要留着：① J5 第一版写成"不许出现 `setHabits(`"，**在干净代码上就红**（`refresh()` 里 `setHabits(listHabits())` 是合法的读侧状态）—— 一条把正确代码判红的判据与一条永不通过的判据一样有害；② B 层的证据**不能**靠临时改 `packages/app-host/src/habit-actions.ts` 取：那份文件正被另一条线写着（`git status` = `M`），臂台崩在半路会把别人的未提交内容写掉。<br>🔴 M1 第一版期望漏了 J2，是臂台自己报出来的（J2 把"调用点存在"当作顺序判据的前提）—— 少一条不是"判据更干净"，是没读全那条判据的前提。 |
| **H3 移动端图标选择器** ✅ **已落地（源码 + 判据 + web 端真浏览器）；端间"看得见"那一半未取设备读数**（2026-10-06 02:1x） | 移动端新增 `apps/mobile/src/ui/habit-icon-slot.tsx`（展开式选择器，与 web 的 `HabitIconPicker` 同一形状），挂在 `HabitsScreen.tsx` 详情层；🔴 字形与词条**不抄第三份表** —— `HABIT_GLYPHS`（`lucide` 图标数据）与 `HABIT_ICON_LABEL_KEYS` 改为从 `@heyta/ui` 导出，web 那份手抄的词条表**删掉**、只留 `export { … } from '@heyta/ui'`（抽取的收尾是删旧那份，不是再写一份更好的）。图标仍是 `@heyta/domain#HABIT_ICONS` 那枚闭集，写入前过 `parseHabitIcon` | **两层**：① 行为层 K1–K4（真 `OpLogEngine` + 真 SQLite）—— 选一格 = 恰好一条 `UPD {icon}`、重放后仍在、另一端读到、闭集外的值**根本不写**；② 源码层 S1–S6 —— 挂载点在、走 `setHabitIcon` 而不是本地 state、闭集来自 domain 而非宿主硬编码、词条走 `HABIT_ICON_LABEL_KEYS`、再点同一格退回派生、暗色不自己发明颜色。**web 端另有一族真浏览器判据 I1–I6** | 臂台 `mutate-habit-icon-picker.mjs` 读数 **5/5**（A1 宿主里再抄一张字形表 / A2 web 长回手抄词条表 / A3 「再点同一个」不再退回派生 / A4 磁盘值不过解析器 + P1 那一条"桩必须能被证明会红"）。web 端 `e2e/tests/habit-icon-picker.spec.ts` **6 passed**，`mutate-habits-two-column.mjs` 加了一臂 **N4**（把图标那一排的 4 列网格改成 9 列 = 修之前那个形状）⇒ 红集**恰为 I6**、jsdom 那 23 条**全盲**，整台 **4/4**、复原 `BACK_TO_CLEAN=true` 两层复跑绿。<br>🔴 **这一族里最值钱的一条是 `I6`，而它是看图看出来的不是写出来的**：`I1–I5` 五条全绿的那张截图里，展开那一排**超出视口右边界** —— 第 8 个字形被裁、「默认」那一格**完全看不见**。`toBeVisible()` 挡不住这件事（它只验"有非空 bounding box"，不验"在不在视口里"），而看不见「默认」= 用户挑过就退不回去，正是那一格存在的唯一理由。修法不是给那一格加 `overflow` 而是**定宽 4 列网格**（宽度 = 4×`touch-target.min` + 3×`space.1`，从被约束的常量推导，不写像素字面量），并补一条**几何**判据（每一格的 `right` 必须 ≤ 视口宽 − 1 且 ≤ 窗格右边界）。<br>⚠️ 两条过程读数要留着：① I1–I5 **第一版五条全红**，原因是用例没走到被测判据 —— web 的窗格刻意**没有回落选中**，只 `addHabit` 的话选择器根本不在 DOM 里，报错长得像"选择器坏了"（§7 第 176 条那一族）；② I3/I5 第二版红在**读早了**：写入是异步的，"点完立刻读行首"取到的是点击前的字形，而选择器选完就收起 —— 顺序必须是**先取那一格自己的形状 → 点 → poll 行首 → 再展开读选中态**。<br>🔴 **未闭合的那一半**：移动端"装出来的包里有这个选择器、看得见的字形与 web 一致"没有设备读数（本机没有已启动的 iOS 模拟器，Android 那台 idle 了 1d18h 且 §6.1 规定 Android 一律走 `windows-pc`）。它**不是**判据红，是**没跑**，已按 AGENTS §6.1.1 挂进收尾块的 `pnpm reinstall:all`，登记号 **H3-V1** |

| **H5 `frequency` 写入口** ✅ **已落地**（2026-10-06 03:0x，= [W13d](detail-pane-alignment.md)） | 🔴 判定侧**本来就在**（见 §1 的 `frequency` 那一行与 §9 第 3 条），本单只补"写"。**共享层一份口径**：`packages/ui/src/habits/model.ts` 的 `habitFrequencySummaryKey` + `HABIT_WEEKDAY_MESSAGE_KEYS`（"哪一种频次说哪句话"由它一家说，宿主不许自己拼）。两端各一枚编辑器：web `apps/web/src/features/habits/HabitFrequencyEditor.tsx`（挂 `renderGoalSlot`）、mobile `apps/mobile/src/ui/habit-frequency-slot.tsx`（挂详情层）。写入统一走 `app-host` 的 `setHabitFrequency`（`habit-actions.ts:366`），三条规则钉在动作层：`weekly` 空集合**抛**、七天全清 = 发**清除**而不是空集合、已经是「每天」时**一条 op 都不发**（把 null 写成 null 也是脏 op）。MCP 侧刻意不出（对外授权面，本单没顺手改） | 四族：**动作层** F 组（`packages/app-host/tests/habit-actions.spec.ts`，含 F4"空集合抛"）；**web** `habit-frequency-editor.spec.tsx` G1–G11（现量 11 条）；**mobile** `habit-frequency-entry.spec.ts` M1–M9（9 条，源码层 —— 本壳没有 RN 组件测试栈）；**真浏览器** `e2e/tests/habit-frequency.spec.ts` Q1–Q7（7 条；Q6 是几何：展开那 10 枚 chip 每枚的右边界都得在窗格里） | 臂台 `mutate-habit-frequency.mjs` 读数 **5/5**，红集逐条等于点名那几条：A1（摘要口径回到宿主自己拼）= M2、A2（分隔符在组件里 inline）= M3、A3（两档零件无条件渲染）= M4 ｜ G11、A4（`.catch` 接住却不显示）= M6 ｜ G8、A5（已经是每天还再发一条清除）= M5 ｜ G4；复原 `BACK_TO_CLEAN=true` 两层复跑绿。<br>🔴 **A1/A2 第一趟报的是"存活 ⇒ 判据没牙"，那是臂台自己的 bug**：同一枚文件被一条臂改两处时，落盘那环每条都从"最初那份"整写 ⇒ **除最后一条外全部静默失效**。手工把 A1 两处都落进去，M2 立刻红。已修成"暂存式应用 + 落盘后逐字节复核"（§7 第 322 条）。<br>🔴 **M3 当场照出两处既有手抄**：`src/ai/disclosure.tsx` 那张与单源逐字相同的分隔符表（已删，三条齐）；`AssistantScreen.tsx:628/:1467` 两处 inline 顿号（英文界面也印顿号）—— **不代改**（运行时形状会变），登记成 P-6 |
| **H4 习惯月历 + 可点补打卡** ✅ **已落地**（2026-10-06 04:0x，= W9） | 三层各补自己那一格，**没有第二套裁决**：① 领域层新增唯一读取者 `packages/domain/src/habit-backfill.ts`（`backfillWindowDays` / `habitDayState` 六档 / `isHabitDayTappable` / `isBackfillAllowed`），默认窗口**从 `REPAIR_WINDOW_DAYS` 推导**（=1）而不是另拍一个数 ⇒ 没设过 `backfillDays` 的习惯行为逐字不变；② 共享层 `packages/ui/src/habits/{month-model.ts,HabitMonthBoard.tsx}`，网格数学全部来自 `monthGrid`（它的**第三个**消费者，前两个是 `DatePicker` 与日历侧栏），组件里没有一行"这格能不能补"的判断；③ 两端各挂一块板（web `HabitDetailCard.tsx` / mobile `HabitsScreen.tsx`），🔴 **没做成可选插槽**（§7 第 195 条：一条"默认值等于原值的可选 prop"会把"宿主没接"伪装成"做完了"，而 typecheck 与既有门禁全绿） | 五族 42 条（现量：逐文件 `grep -c -e "it(" -e "test("`）：领域 B1–B9（9）、共享模型 U1–U8（8）、web 渲染 V1–V11（11）、mobile 接线 X1–X7（7）、真浏览器 R1–R7（7）。三族点名：B8 = `backfillDays` 全仓只许那三位所有者（剥注释后**精确集合相等**）；B9 = 六档是**封闭词表**（多一档就是有人往判据里加了东西）；R4 = 把上一月里所有 `aria-disabled="true"` 的格点一遍，打卡总数一条都不许多，正向对照 = 回到当月点昨天 ⇒ +1 | 臂台 `mutate-habit-month.mjs` 读数 **5/5**：MA1（补白格可点）= U3 ｜ V4、MA2（补白格改用状态句子）= V4、MA3（宿主按下时丢掉那一天，两端同时）= V11 ｜ X2、MA4（默认窗口改成拍死的 7）= B1 B2 B3 B5 B9 U7 V6、MA5（不再声明"不能按"）= V4 ｜ V5；复原 `BACK_TO_CLEAN=true` 四族复跑绿。<br>🔴 **MA1 第一趟存活，而那是判据真的没牙**：U3/V4 的补白格夹具用默认 1 天窗口，九月底那几天本来就"超窗"点不动 ⇒ 摘掉 `inMonth` 那一层什么都不会红。改成窗口开到 7 天 + 给 V4 加第二条对照腿（**同一批日期**在自己的那一月里点得动），MA1 才咬住。<br>🔴 **R1 的几何判据照出一条真缺陷，不是测试产物**：格子原本 `minWidth = touch-target.min`(44)，7×44 + 6×4 = 332 而中栏只有 288 ⇒ **右边一整列被面板裁掉**。按既有先例修（`CalendarBoard.tsx:270` 同一张 7 列网格：高度守 44、宽度按列分摊不设下限，`tokens.css` 那句"44px 不许调小"没有被放宽），并把取舍写进组件（窄栏里是 37×44：过 WCAG 2.5.8 的 24×24，不过 Apple 那条 44 的**建议**）。判据同时拆成三条各自独立的（高度 ≥43 / 42 格右边界都在面板内 / 最窄一格 ≥24）+ 一条"以第一行那七个落点为锚"的对齐判据 —— 原来那条"每格 ≥43×43"把两件事混在一个数字里（§7 第 86 条那一族）。<br>⚠️ 一条词条形状上的读数：`web.habits.month.cell = '{date}，{state}'` 这种"值里没有汉字"的写法被 `check:ui-language` 拦下，最后是把 `{date}` 并进**每一句**状态词条而不是造一枚裸模板 |
| **H7 年视图（12 张月卡）+ 详情面那枚"月 ⇄ 年"容器** ✅ **已落地**（2026-10-06 05:3x–06:0x，= W13c） | 三层各补自己那一格，**年的数一处都不在界面算**：① 领域层新增 `packages/domain/src/habit-year.ts` —— `habitYearRows` 逐月**委托** `computeHabitPeriodStats`（不是第二份算式），未来那几个月在 `monthKey > today.slice(0,7)` 处短路，`asOf = min(月末, 今天)`；`habitYearSummary` 用**分母加权**（`Σ(率×档期天数)/Σ档期天数`），不是十二个率的平均；② 共享层 `HabitYearBoard.tsx`：12 张卡、未来那几张走 `disabled-*` 说"还没到这个月"而**不画 0%**，卡上那三个数与读屏那句同源；③ 容器 `HabitTrendBoard.tsx` 持**一枚游标 + 一档视图**（`HabitTrendView = Extract<CalendarViewKind,'month'|'year'>`，不另造词表），并把 `HabitMonthBoard` 改成**受控**（`month` + `onMonthChange` 必填）—— 各挂一块板就是各持一枚游标，那正是本单要防的形状。🔴 **中栏那组三档不做**（P-5 代拍，理由在 §5 那一格划掉的行）：档位归详情面这枚容器，两列卡片那一栏没有第三档的位置 | 四族：领域 **Y1–Y8**（`packages/domain/tests/habit-year.spec.ts`）、web jsdom **Z1–Z8 + V12**（`habit-trend-board.spec.tsx` / `habit-month-board.spec.tsx`）、移动端源码层 **N1–N5**（`habit-trend-entry.spec.ts`，与 X 族同一副 `stripComments` 夹具）、真浏览器 **S1–S6**（`e2e/tests/habit-year.spec.ts`）。三族点名：N2 = 移动端一处都不许直接调 `computeHabitPeriodStats(` / `habitYearRows(` / 自己 `slice(0, 7)` 分组；V12 = 容器把**自己那枚游标**交给月历（`month={cursor}` + `onMonthChange={` + `year={year}`，且不许再 `useState<LocalDate>` 存第二枚）；S4 = 月历打了几格，年卡上那一月就读"达成 N 天"，**两个视图同一把尺**且刷新后仍在 | 臂台 `mutate-habit-year.mjs` 读数 **6/6**（`结论：臂 6 份，全红 6，存活 0，探针无效 0 / BACK_TO_CLEAN=true`，2026-10-06 05:4x）：YA1（年率拿 `Σachieved/Σscheduled`）= Y5、YA2（未来月不短路）= Y2 Y5 Y7 Z5 Z7、YA3（点卡只翻游标不换档）= Z2、YA4（月历拿 `today` 而不是容器游标）= V12 Z2 Z3、YA5（未来卡画 0%）= Z5 Z7、YA6（年那一档忽略 `year`）= Z8。<br>🔴 **YA6 第一趟存活，而那是判据真的少一格**：忽略 `year` 之后标题换了而 12 张卡没换，Z1–Z7 **全绿**（它们量的是"当前那一年"的形状，没有一条量"翻年"）。补的 **Z8** 钉的是"翻到 2025 ⇒ 12 张卡的名字全是 2025-MM 而 2026-07 不在场"。<br>🔴 **YA4 的期望红集是现量放宽的**（与 H4 那台 MA4 同一条理由）：它改的正是 `month={cursor}` 那一行，而 V12 钉的就是那一行 ⇒ V12 红是**这一臂该红的**，写窄了下一次会被读成"打歪了"。<br>⚠️ 注入用**分文件累加 + 落盘后逐字节复核**（§7 第 322 条那一族）+ 整包 `dist` 摘要证"进没进产物"（§7 第 273 条），六臂的锚点开跑前逐条验过命中恰好一次。<br>🔴 **本轮另外三条过程读数**：① **Y5/Y6 第一版红在我自己的期望**（合成表只给两行命名，其余十行仍贡献分母 ⇒ 我按那两行算了个率），已入 [环境陷阱](../reference/environment-traps.md) 一条（编号现量取末位）—— 这不是产品缺陷，但它是"判据在干净代码上红"那一族的第四次；② **年卡原本一排一枚**，12 枚在 288px 的详情栏里摞成 ≈1020px 高，而**元素截图只拍到视口为止** ⇒ `year-12cards` / `year-consistency` / `year-future` 三张**不同状态**的图 md5 逐字相同、都停在第 7 枚，S4 断言的"当前那一月"压根不在图上。修法两半：卡改**百分比两列**（`flexBasis:'47%'` + `minWidth:0`，缺 `minWidth:0` 会退化回一排一枚 —— flex 项默认不许收缩到 min-content 以下），并把"这张图拍全 12 枚"写成断言（`shootYearBoard`：给足视口 → 滚到顶 → 量 12 枚都在视口内 → 才截）。⚠️ 我第一版把它写成"12 枚全在折叠线以上"，红在 12/12 —— 年视图只是详情栏的一节，那个前提在 720 高的窗口里**永远不成立**，那条红的是判据自己（§7 元规则 1）；③ **R7/S5 那两条"暗色"判据是假绿**：`emulateMedia({colorScheme:'dark'})` 切不动 `<html data-theme>`（主题在启动时算一次，`apps/web/src/lib/theme.ts:41` 写着为什么），两张 `-dark` 图与亮色那张**逐字节相同**。改成点产品自己那颗开关 + 断言属性翻了 + 断言**真正画出来的底色变了**（仓里 M4 与 `calendar-cells.spec.ts:382` 早就记过同一件事，这一版没去读就先写了）。<br>🔴 **顺带修掉一条被本批撑高的跨线回归**：H4 那 42 格 + H7 那排档位把详情面单撑到 994px，而焦点环挂在面单那一格上 ⇒ `keyboard-cursor.spec.ts` **K9** 红（现量 `top=2 / bottom=996 / vh=720`：键盘用户按下 Enter 之后屏幕上没有任何一处说明焦点进了这一栏）。修在 `base.css` 的 `.ht-app__detail-habit`（一屏封顶 + 内部滚动，与它上面 `.ht-app__detail` 那条同一条理由），**K9 的口径一个字没动**；复跑 `keyboard-cursor + detail-pane-habit + habit-month + habit-year` **33 passed**，`k9-enter-focuses-pane.png` 人已看 |

| **H8 🔴 热力图的月份标签每一枚都折成两行** ✅ **已落地，四格读数都有，臂台那一格已按补宽后的期望重跑确认（06:4x–07:3x 串行链）**（2026-10-06 06:2x 起） | 落点两处，都在共享层：① `packages/ui/src/habits/model.ts` 新增 `heatMonthSpans` + `heatMonthLabelWidths`（"这个月占几周"从 `toHeatmapWeeks` 那份列数据数出来，**不在界面里另算一次月长**；宽度下界取"两列" = `2×格宽 + 一枚空隙`）；② `packages/ui/src/habits/HabitBoard.tsx` 的 `heatMonthCell` 不再写 `width: icon.xs`，改吃模型给的宽度并 `flexShrink: 0`，标签格从"每列一枚"改成"只在月份变那一列一枚"，并补上 `habit-board-heat` / `-heat-months` / `-heat-grid` / `-heat-week-<i>` / `-heat-month-<列号>` 五枚 testID（HL2 要按列号对位）。🔴 **下界为什么必须有**：窗口末尾那一列常常只有零星几天（现量：今天 10-06 时「10月」那枚 `span == 1`），只按跨列算宽度它就还是 14px、还是折行 —— 第一版我就是这样"修完仍然坏"，是 e2e 那条 HL1 在起跑前把它拦住的 | **两层，各挡对方看不见的那半**：**恒等式层** L1–L4（`packages/ui/tests/habits-model.spec.ts`）—— 列恰好分完 / 标签起点 == 月份变的那些列 / 每枚 ≥ 两列 / 整排总宽有界（不短于网格、不多出一枚最小标签）；**几何层** HL1–HL3（`e2e/tests/habit-heatmap-labels.spec.ts`，真浏览器）—— 每一枚只有一行高（尺子取它自己那行的 `line-height`，不写字面像素）/ 左边缘贴着它标注的那一周且互不压字 / 没有一枚溢出**窗格**右边界。🔴 HL2 刻意**不**写成"右边缘也得落在自己那几周之内"：两列下界必然让末列那枚探出自己的那一列，探出那一列不是错、探出窗格才是 —— 把判据写成前者会把修法本身判红 | 臂台 `mutate-habit-heatmap-labels.mjs` 三臂，红集互不相同：HA1（去掉两列下界）= L3 + HL1、**HA2（组件把 `gap` 传成 0）= 只有 HL2 红 ⇒ jsdom 那四条全盲，这一臂就是"几何那一层不是恒等式那一层的重复"的证明**、HA3（每列都打标签）= L4 + HL2。**读数（06:4x–06:5x，串行链 `tmp/h7-readings/h8-chain.sh`，一次一个载体一个端口）**：共享层单测 **`Tests 43 passed (43)`**（L1–L4 加 H5 补的那三档）；几何层 **HL1–HL3 `3 passed`**；改了同一个 render 的邻居回归 **`detail-pane-habit` + `habit-month-stats` + `habit-counted-amount` 12 passed**；三张证据图各拍自己那条断言说的话（`c4b5b3de`，人打开看过，md5 互不相同；`png-stats` 现量 contentRatio 0.41 / 0.10 / 0.32，主蓝 8 / **0** / 8 —— 那个 0 是标签横带里本来就没有主蓝元素，§7 第 82 条管的是整屏是不是我们的界面，不是每枚裁切都得有蓝）。✅ **臂台那一格的读数（06:5x 串行链 `tmp/h7-readings/serial-final.log`，一次一个载体）：`ARMS=3`（臂数由装置自己打印）、三臂全红、`存活 0`、`探针无效 0`、`BACK_TO_CLEAN=true`。** 为了拿到这一格，这台装置连踩**三枚自己的探针 bug**（① `waitPortFree()` 成功路径 `return;` ⇒ 干净态永远跑不成，症状却是"环境不配合"；② 汇总探针把 Playwright"全过时不印 failed 段"读成 `failed=-1` ⇒ `BASELINE_DIRTY`；③ 红集标题抓取只认 `×`/`✕`，而 Playwright 实际打的是 `✘`（U+2718）⇒ 红集恒空 = **每一臂都被读成"存活"**，这是三枚里最坏的一枚，因为它把"判据有牙"播成"判据没牙"）。三处都在 `d6a78636` 修掉，每一枚都配了"探针读不到就响亮失败、不许默认成 0"的写法。 🔴 **逐臂红集与本文原先写的差一格**：HA3（每列都打标签）实测红的是 `L4 + HL2 + HL3` 而不是 `L4 + HL2`。机制说得出：这份坏把每列的 `span` 变成 1，宽度取下界（2 列 + 1 空隙）⇒ 每枚标签都比自己那一列宽出一整列，末列那枚**必然**越过网格右边界，而 HL3 判的正是"探出窗格才算被裁"。已把 `HL3` 按现量补进 `expectTitles` 并把这段机制写进臂注释（留着当"超期望"就是让下一次同类漂移没人能发现）。**这一格已闭**：07:3x 整台按补宽后的期望重跑 ⇒ `ARMS=3`、`结论：臂 3 份，全红 3，存活 0，探针无效 0`、`BACK_TO_CLEAN=true`，逐臂红集 = `L3+HL1` / `HL2` / `L4+HL2+HL3`，**没有再多出别的**（`tmp/h7-readings/h8-rig-rerun.log`；链是 `tmp/h7-readings/serial-3legs.sh`，一枚 `hold-test-lock.sh` 一次占住、三台腿内部串行）。而"HA2 只红 HL2、jsdom 那 43 条全盲"这一臂现在有读数了，不再是设计。 |

### 第二批 —— 挂在待拍值上（见 §5）
| 单 | 范围 | 阻塞它的决定 | 对应旧编号 |
|---|---|---|---|
| **H4 习惯月历 + 可点补打卡** ✅ **已落地** | 状态、落点、判据、臂台读数**全在上面第一批那一行** —— 这一格只留编号映射与还没拍的那半，不写第二套状态（AGENTS §8：同一张单两处各写各的状态，早晚对不上） | 🔴 **仍然开着的一半**：P-1 拍的是"不设 = 1 天、设了 = 设的那个数"，而**界面上没有能设 `backfillDays` 的控件**（写入侧只有 `NewHabitFields`）⇒ "是否允许无限回溯"这一问在**给用户之前**不必答；要给用户选，得再开一张单 | 就是 **W9** |
| **H5 `frequency` 写入口** ✅ **已落地** | 同上：全部读数在第一批那一行（= W13d）。这里只留两条**别顺手改**的边界：MCP 侧那三处"刻意不出"（`local-api-host.ts:331`、`tools/shared.ts:538`、`server.ts:69`）是**对外授权面**，出不出不在本单范围；🔴 原句"C1#2 口径未拍"已被现量否证（见 §9 第 3 条与 §5 划掉的 P-2） | 无 | 就是 **W13d** |
| **H6 `HabitLog.note`** ✅ **已拍（2026-10-06 00:5x 代拍）：界面不做，字段留位并明说** | 落点只有一处：`packages/domain/src/entities.ts` 那枚 `note?` 原本是**裸声明、上方一行注释都没有**（那正是本单写的"最坏的结果"）。改后它自己写着：预留位 / 界面不碰 / 没有读取者 / 什么时候要重新判（要判就得连带补三侧 + 留存说明） | 拍它的理由不是"没时间"，是**已有正式去处**：叙述性文本在 heyta 是 `NOTE` 实体（两端有界面、有搜索、有导出），而打卡记录的语义是"达成判定"；再开一处自由文本只会多出一份既没有入口也没有留存承诺的密文存量（§3.3 那条"加字段容易删字段难"同向） | 回退：改成"做"时先删那段注释，再补 web 面单 / mobile 面单 / `local-api` 的 `habit-log` 三侧，判据照 H3 那一族写（落盘 + 刷新后仍在 + 另一端读到） |
| **H7 年视图（12 张月卡）与"中栏三档"** ✅ **已落地** | 状态、落点、判据、臂台读数**全在第一批那一行**（= W13c），这一格只留编号映射与拍掉的那半，不写第二套状态（AGENTS §8：同一张单两处各写各的状态，早晚对不上）。🔴 **W13b 那一半仍然没做也不做**：那颗 `⌄` 要的是"习惯清单"这一层数据，而 `Habit` 现量无任何归属字段 ⇒ 要新 ADR，不在本单范围 | 无（"三档做几档"已按 P-5 代拍：详情面那枚容器两档，中栏不加第三档；理由与形状都在第一批那一行） | 就是 **W13c**；W13b 另开 |

🔴 **三条硬顺序**（都是"先有写入口，再画那一行"的同一个形状）：
**H5 先于**"卡上显示频次那一行"；**H4 先于**"补打卡那颗可点的格子"；**H6 决定之后才许**在卡上出现打卡备注。
违反的后果一律是 §7 第 195 条那个病：**typecheck 不报、`pnpm check` 不报、截图还画得出来**。

## 3. 依赖

```
H1 中栏两列  ──┬── H7 年视图 / 三档切换（先有卡，切换才有对象）
              └── 与 H2/H3 正交（H2/H3 是"能不能写"，H1 是"怎么排"）
H2 移动端新建 ──┬── H4 月历补打卡（补打的那一条也是打卡，入口在 H2/H3 之后更顺）
              └── H3 图标选择器（同一枚面单，先补新建再补图标）
H5 frequency ── 阻塞在 C1#2 口径；拍完即开
H6 HabitLog.note ── 一条决定，不阻塞别人
```

## 4. 每单固定的验收动作

1. 登记现状 → 实现 → 判据 → **配变异臂证明能红** → 门禁 → 截图且**人真的看图** → 记读数（AGENTS §6.2 规定一）。
2. 存在性判据排在内容判据**之前**：断言只会验"界面写了什么"，验不出"界面少了什么"（W5 那批实测出来的教训）。
3. 涉 `packages/*`：**先 `pnpm -r build` 再跑判据**（判据读 `dist`，§7 第 27/162 条）。
4. jsdom 不做布局 ⇒ 一切"几列 / 贴边 / 宽度"的结论只能在 e2e 用 `boundingBox()` 量。
5. 改动后必须逐条过的门禁：`check:selection-single-source`（选中单源 + 第五档 `form-draft`）、
   `check:row-single-source`（`.ht-*` 基线 28，只许减）、`check:l4`、`check:design`、`check:ui-language`
   （新词条**中英同时**落 `packages/i18n` 并 build）、`check:detail-pane-slot`（装配处不手写行内标记）、
   `check:empty-state`、`check:materialized-reads`（移动端读物化状态那屏要订阅 `dataRevision`）。
6. 收尾的完成定义见 §6，**不接受"测试绿了所以做完了"**。

## 5. 待拍板（本篇不代拍；拍完对应工单即开）

| # | 要拍什么 | 卡住 | 不拍的后果 |
|---|---|---|---|
| ~~P-1~~ | ~~补打卡窗口多宽 / 是否无限回溯~~ ✅ **已拍（2026-10-06 03:4x 代拍，工单 H4 落地时）**：不设 = **只能补昨天**（值从韧性层 `REPAIR_WINDOW_DAYS` **推导**，不是新拍一个数）；设了 = 那个数；**永远不许无限回溯**；窗口只管"往回写"，**不管撤销已存在的记录** | ~~H4~~ 落点在 `packages/domain/src/habit-backfill.ts`（唯一读取者），界面侧 `packages/ui/src/habits/{month-model.ts,HabitMonthBoard.tsx}` | 🔴 为什么默认值必须是 1 而不是 7：`REPAIR_WINDOW_DAYS = 1` 是**今天已经生效**的那条语义（韧性层"补回来"只给昨天）。在这个字段上拍一个新的默认数会**同时改掉两条已有行为**（没设过字段的习惯突然能补一周），而拍默认值的依据应当是既有的约束，不是"界面看起来更慷慨"。**一条命令可回退**：改 `BACKFILL_DEFAULT_WINDOW_DAYS` 那一个常量即可，其余各层（域/共享/两端）都从它读。⚠️ **仍然开着的一半**：界面上**没有**能设 `backfillDays` 的控件（写入侧只有 `NewHabitFields`）⇒ 现在这条窗口对所有用户都是默认 1 天，"设了 = 那个数"暂时只有 AI/本地 API 造出来的数据会命中；要给用户选，得再开一张单（不在 H4 顺手做，见 §2 的 H4 那一行） |
| ~~P-2~~ | ~~频次（每周 N 次）进不进"达成/连续"判定~~ 🔴 **这一格已被现量否证，不再是待拍**（2026-10-06 00:4x）：判定侧**已经按频次走** —— `computeStreak` 数的是 `isScheduledOn(habit.frequency, …)` 挑出的**计划日**（`habit-streak.ts:131/158/227/360`，函数注释自己写着"否则每周一次的习惯永远只有 1"），韧性 `:165/239` 与 `today-progress.ts:109` 同一个口径。⇒ 原句"现有 `computeStreak` 全按每天"**是错的**，H5 的范围因此从"先拍口径"缩成"补写入口"（见 §9 第 3 条） | H5 | 留在表里是为了让下一位看见：一条阻塞关系写得越久，越没人再去核它的前提 |
| ~~P-3~~ | ~~打卡备注做不做（`HabitLog.note`）~~ ✅ **已拍（00:5x 代拍）**：界面不做，字段留位并在源码处明说 | ~~H6~~ 落点见 §2 的 H6 那一行（`packages/domain/src/entities.ts`） | 原句"字段继续躺在实体里当'看起来有'的读数"**已经不再成立** —— 那枚 `note?` 现在自带"预留位 / 界面不碰 / 何时重判"的注释；把它读成"有功能"的成本从"没人会红"变成了"读一眼就有答案" |
| P-4 | 🔴 **已拍（2026-10-06 04:3x 代拍）：不做**那颗 `⌄`（习惯清单层） | ~~W13b/H7~~ 不卡 H7 的年视图那一半 | 现量：`Habit` 没有任何归属字段（`entities.ts` 里 `Habit` 的成员只有 `name/target/frequency/icon/backfillDays/…`）。加一枚 `projectId?` 要连带动四处：实体 + hydration（§3.3 那条"新字段一律可选"）+ 三侧（web/mobile/`local-api`）+ 一张 ADR，而它买到的只是"中栏能按清单折叠"。**这一轮的立场**：分组不是习惯面的断点（滴答那颗箭头的价值在"我有很多清单"，我们现在一条习惯列表都还没铺完）。⚠️ **升级触发条件**：一旦出现"习惯要跟着清单一起撤销/共享"这类**跨实体**需求，就必须先出 ADR 再动字段，不许直接加。**一条命令回退**：把本格改回"要"，然后按 §7 的"不 bump schema"那条走 ADR 流程 |
| P-5 | 🔴 **已拍（同批代拍）：中栏切换器不做**；"档"落在**每条习惯的详情面**里（月 ⇄ 年），由工单 H7 那一半实现 | ~~H7~~ 年视图 | 理由不是省事，是**作用域会不一致**：中栏那一列是**跨习惯**的，而 H4 的月历与 H7 的年视图都是**单条习惯**的。把"清单 / 月 / 年"三颗按钮摆在跨习惯那一列上，切出来的两档说的是另一件事 —— 那正是 §7 第 195 条那一族（界面摆了一个看起来等价、其实不同作用域的控件）。而且"这个月一共打了多少次"这类跨习惯答案已经在六张统计卡里（§1 的"六张统计卡"那一行）。⇒ 切换器摆在它切的东西旁边：详情面里月 ⇄ 年。**一条命令回退**：拍"要"时先在 `HabitsView.tsx` 那侧定义跨习惯的月/年取数出口（现在没有），再谈切换器 |
| P-6 | 🔴 **移动端 AI 面板的列举分隔符**：`apps/mobile/src/ai/AssistantScreen.tsx:628` 与 `:1467` 两处 `.join('、')`，**英文界面也印顿号**（工单 H4 的 M3 判据照出来的既有债，不是本单引入的） | 不卡任何单（已用**精确集合相等**登记在 `apps/mobile/tests/habit-frequency-entry.spec.ts` 的 M3 里，再长出第三处 inline 顿号会红） | 为什么不代改：那条判据要求"分隔符只有一位所有者"，而把这两处换成 `LIST_SEPARATOR[locale]` 会**改变英文侧的运行时输出** —— "代改别线代码"要三条齐，其中"运行时形状逐字不变"这一条**不成立**，所以只登记不动。修法很小：两处换成 `lib/recurrence-display.ts` 那份单源，并把 M3 里那张债表一起删掉 |

## 6. 完成定义（DoD，逐项打勾才算这一面收口）

> 2026-10-06 06:1x 逐格收口。打勾的格都带**现量命令或读数**；没打的两格写明卡在谁手里，
> 不写成"基本完成"（AGENTS §8：新证据改变结论要同步改状态表，不许只在文末追加成功记录）。

- [x] 每张单的判据都跑过并且**逐臂看过红集**（存活的那几条才是这单真正产出的判据）；
      四台臂台的逐臂红集都读进工单行了（`mutate-habit-month` 5/5、`mutate-habit-year` 6/6、
      `mutate-habit-frequency` 5/5、`mutate-habit-create-entry` 4/4、`mutate-habit-icon-picker` 5/5）。
      ✅ **原先那两格例外只剩一格**（`BLOCKED.md` B91 §1/§8）：
      · `mutate-habit-year` 的 YA4 期望红集放宽后**已在 06:5x 串行链里整台重跑** ——
        `ARMS=6`、`结论：臂 6 份，全红 6，存活 0`（`tmp/h7-readings/serial-final.log`）。这一格闭了。
      · ⚠️ `mutate-habits-two-column` **仍开着一格**：N5 臂接手时连语法都不过（模板字符串里嵌反引号，
        §7 第 346 条），修好后整台跑过一次（06:5x），读出 **N1 期望少了 I2**（已按现量补进红集，机制**未定**、
        候选解释与要补的那一格写在臂注释里）与 **N5 三版都打空**（grid 空轨道 / 只 nowrap / `space-4` 各撑 16px
        ⇒ 都没把可见元素推出边界）。N5 现在取 `space-8`，**补宽后的期望还没重跑**（排队 `tmp/h7-readings/serial-3legs.sh`）。
        这一格闭之前，这台臂台**不许被读成"五臂全红"**。
- [ ] `pnpm check` 全链 RC=0（含上面那八道门禁）；
      🔴 **不在本单手里**：`BLOCKED.md` B90（回收线，06:0x 现量）报 `check:ai-e2e` 在当前 HEAD 上
      红 **9 枚**，其中 4 枚根因是详情面 §8.138 那支三元链把 AI 面挤掉了 —— 那条挡住整条 `pnpm check`。
      本批单独取到的门禁读数（不含 e2e 全族）：`-r typecheck`（domain/ui/app-host/web/mobile）rc=0、
      `check:layering` rc=0、`check:ui-language` rc=0（词条 zh-CN 3250 = en 3250）、
      `check:design` rc=0、`check:docs` 无死链。
- [x] 习惯面的 e2e 用例**在当前产物上**重跑，截图逐张打开看过，主蓝数得出（§7 第 82 条）；
      载体：`pnpm --filter @heyta/ui build` + `pnpm --filter @heyta/web build` 之后才跑 e2e（不是旧 dist）。
      复跑读数：`keyboard-cursor + detail-pane-habit + habit-month + habit-year` **33 passed**、
      `habit-year + habit-month` **13 passed**。逐张开过的图：`month-board`、`month-dark`、
      `year-12cards`、`year-consistency`、`year-dark`、`k9-enter-focuses-pane`。
      主蓝现量（`scripts/screenshots/png-stats.mjs` 的 `countBrandBlue`）：
      `month-default` 1086、`k9-enter-focuses-pane` 2770、`month-board` 426、`month-dark` 424、
      `year-12cards`/`year-consistency`/`year-dark` 各 929，全部 `blank=false`。
      🔴 同一趟对账把**三张不同状态的 `year-*.png` md5 逐字相同**照了出来（成因与修法见 §2 H7 那一行）。
- [x] 暗色主题实际切换查看（AGENTS §5）；
      两张 `-dark` 图现在是真的暗色：`emulateMedia` 那条假绿已改成"点产品自己那颗开关 +
      断言 `<html data-theme>` 翻了 + 断言真正画出来的底色变了"（R7/S5）。
- [ ] `pnpm reinstall:all` 四端装上当前源码产物（AGENTS §6.1.1）—— 桌面三壳与 node-host 无习惯 UI 是**已登记边界**，
      这一格只要求 web / Android / iOS 三端的习惯屏各有一张"装上的是当前产物"的判据；
      🔴 **本轮没跑**（要 Windows 打包机与 iOS 模拟器同时空；§6.1 规定 Android 一律走 `windows-pc`）。
      登记在 `BLOCKED.md` B91 §1 第三格，与 H3-V1 是同一档缺口。
- [x] 本篇 §1 那张现状表**重跑并回填**（哪几行从 🔴 翻成 ✅，附命令与读数）；
      三行翻面（有没有视图切换 / 有没有月历与年视图 / 词条是否中英同步），每行都带**可复现命令**，
      并撤回了一条写早了的 `63/63`（现量 91/2/6 两侧一致）。
- [x] `docs/plans/detail-pane-alignment.md` 与本篇之间没有两套状态（同一张单不许两处各写各的状态）。
      §2 第二批那三行（H4/H5/H7）现在只留**编号映射与还没拍的那半**，状态一律指回第一批那一行。

## 7. 明确不做（不是排期问题）

| 不做 | 理由 |
|---|---|
| 抄滴答的 **emoji 习惯图标** | AGENTS §5：emoji 当图标是硬错，跨平台渲染不一致且不受 token 控制。用 Lucide 闭集 |
| 抄无选中时的**空态插画**、侧栏空态引导卡 | 主计划 §5.4 已否决，并被第二批截图两次印证 |
| 把**冻结余额**（韧性）放上界面 | ADR-0022：它是库存不是事实、用户不可操作，且是整套体系里唯一会读起来像资源管理游戏的地方 |
| 给习惯/打卡**加必填字段**或 bump `CURRENT_SCHEMA_VERSION` | AGENTS §3.3：已落盘的数据没有该字段，构建会绿、炸在运行时 |
| 判定某个习惯"健康 / 不健康"、自动上色、制造愧疚 | 激励体系的设计红线（颜色由用户赋义、只与自己的过去比、不发行货币） |
| 把习惯塞进任务列表模型 | `dida-view-unification.md` §4："统一是契约一致，不是形状一致" |
| 为让 H1 过关而抬 `HT_FAMILY_BASELINE` / `check:l4` 的棘轮 | W 篇 §6 最后一条：调高基线门禁仍然绿，还会把调高打印成"已降 1 处" |

## 8. 旧断言更正（这次现量把三句推翻，就地挂指针）

1. 调研 §A5 那句 **"`HabitBoard` 的 `onCheckIn` 签名不带 value ⇒ 只能一键记满目标值"** ——
   🔴 **过期**：`checkIn(habitId, date?, value?)` 在 `packages/app-host/src/habit-actions.ts:167`，
   两端宿主都传（`store.ts:123` / `HabitsScreen.tsx:403`）。这一条就是 **W6**，已落地。
2. 调研 §A5 那句 **"六个统计卡里四个连函数都没有"** —— 🔴 **过期**：唯一所有者
   `computeHabitPeriodStats`（`packages/domain/src/habit-streak.ts:328`）与四格消费者已落，
   账见 [W 篇 §8.121](detail-pane-alignment.md)。
3. W 篇 §5 那一行 **"拍板 C1#2 卡住 W8 全部"** —— 现状是 **W8 读侧已按当时拍的口径落地**（§8.121），
   未拍的只是 **H5（频次进不进判定）** 这一半。两处文档已在本次挂指针，避免下一位照旧话排队。

> 📌 这三句都不是谁写错了 —— 是**状态写在两份文档里，而代码往前走了**。
> 所以本篇 §1 那张表每一行都带现量命令：**要状态就现量，不要读任何一份文档的断言**。

## 9. 本篇第一版 §1 的三处假阴性（2026-10-06 00:4x 重测，逐条带成因）

这一节不是给别人的更正 —— **是本篇自己写错自己的表**。三条都改变工单范围，所以不是措辞问题：

1. **"移动端建不了习惯"是假的。** 真因不在代码，在**我的现量命令**：那一格写的是
   `grep -rn "addHabit\|createHabit" apps/mobile/src`，而这一趟执行走的是 ripgrep（本仓库的 Grep 工具就是 rg）。
   🔴 **在 Rust regex 里 `\|` 是"竖线这个字符的字面量"，不是"或"** —— 那是 BRE 的写法。
   于是这个模式要求文本里真出现 `addHabit|createHabit` 这一串，**任何仓库都恒 0 命中**，
   而我把它读成了"UI 侧 0 命中 ⇒ 移动端没有新建入口"。
   复现（两种写法各跑一次，读数应不同）：
   `grep -rn "addHabit\|createHabit" apps/mobile/src | wc -l` ⇒ 0；
   `grep -rn -E "addHabit|createHabit" apps/mobile/src | wc -l` ⇒ **非 0**（`HabitsScreen.tsx:446`）。
   已入 [环境陷阱](../reference/environment-traps.md) 末尾一条（编号现量：`grep -oE '^[0-9]+\. ' … | sort -n | tail -1`）。
2. **同一枚假 0 波及本表三行**（新建 / 图标 / 视图切换）。逐行用 `-E` 重跑：
   新建那行**翻成 ✅**（入口早在 `b2b5455a`，09-28），图标那行**仍是真 0**，视图切换那行**仍是真 0**。
   ⇒ "同一个模式跑法错了"会让**一批结论**一起漂，而不是只漂我当场看的那一行 ——
   所以本表每行的命令现在都写成 `-E` 的形式，不留在注释里。
3. **`frequency` 不是"死字段"，而 P-2 的前提是错的。** 第一版只看界面写不写、MCP 出不出，
   没看判定侧：`isScheduledOn(habit.frequency, …)` 在 `habit-streak.ts` 有 4 处消费者
   （`:131/:158/:227/:360`）、韧性 `:165/:239`、`today-progress.ts:109`，
   而 `computeStreak` 的注释自己就写着"只数**该打卡的日子**……否则每周一次的习惯永远只有 1"。
   ⇒ 我写的"现有 `computeStreak` 全按每天"与代码相反，据此排的 **P-2 一整格作废**，
   H5 从"要先拍口径"缩成"补写入口"。
   📌 形状上的教训：**判"某字段是死的"要沿整条读路径枚举读者**（谁读它 → 谁用它算数 → 谁把它画上屏），
   只看"界面写不写"会同时把"死字段"和"判定已生效、只差入口"这两种完全不同的工单读成同一行。

> 🔴 本节自身也要防同样的病：上面每一条都给了**可复现命令**。
> 下一位若发现本节哪条又不成立，请就地挂指针并追加读数，不要删 —— 与本仓库其它台账同一口径。
