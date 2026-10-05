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
| 有没有视图切换 | 🔴 没有 | `grep -rn -e viewMode -e segmented apps/web/src/features/habits/` | **真 0**（上一版那条命令里的 `\|` 在 ripgrep 里是字面竖线，那个 0 不算数；00:4x 用 `-e … -e …` 重跑仍 0，等价于 `-E "viewMode|segmented"`） |
| 有没有**月历 / 年视图**的习惯尺度 | 🔴 没有 | `grep -rn "monthGrid" packages/ui/src/habits packages/domain/src`（习惯侧）；`grep -n "HABIT_HEATMAP_DAYS" packages/ui/src/habits/model.ts` | 习惯只有**两档**：7 天点（`HABIT_LIST_WEEK_DAYS=7`，`model.ts:68`）与 90 天热力图（`HABIT_HEATMAP_DAYS=90`，`model.ts:56`）；`monthGrid` 的消费者是 `DatePicker` 与日历侧栏，**习惯 0** |
| `frequency` | 🔴 缺的是**写入口**，**不是判定**（判定侧早就按频次走了） | `grep -n "isScheduledOn" packages/domain/src/habit-streak.ts packages/domain/src/habit-resilience.ts packages/domain/src/today-progress.ts` | 判定侧命中 **8 处**（`habit-streak.ts:131/158/227/360`、`habit-resilience.ts:165/239`、`today-progress.ts:109`），而 `computeStreak` 的注释自己写着「只数**该打卡的日子**，跳过不该打卡的日子（否则每周一次的习惯永远只有 1）」；界面写入 **0 处**（`HabitGoalEditor.tsx` 里没有这个键），MCP 侧**刻意不出**（`local-api-host.ts:331`，那是设计不是洞）。🔴 原句"死字段"把两件事混成一件，据它拍的 **P-2 前提已被 §9 否证** |
| `backfillDays` | 🔴 **死字段**（透传但没人写、也没人读） | `grep -rn "backfillDays" --include='*.ts' packages/*/src apps/*/src`（🔴 **别扫 `packages`**，那会连 `dist` 一起扫进几百行编译产物） | 源码命中只有声明与"刻意不出现"三句：`entities.ts:411`、`habit-actions.ts:74`（`:238` `...over` 透传）、`local-api-host.ts:331` / `tools/shared.ts:538` / `local-api/src/server.ts:69`；**读取者 0**。⚠️ 但"补打卡的入口"**不是没有** —— `HabitBoard.tsx:813-825` 那枚 `habit-repair-<id>` 补的是**领域层算出的那一枚断链日**（`shouldOfferRepair` = `streakIfRepaired ≥ 2`，`model.ts:397-400`），走 `onCheckIn(id, repair.date)`。⇒ H4 的真缺口只剩"任意历史日可点" + 给 `backfillDays` 一个真读它的地方 |
| `HabitLog.note` | 🔴 **死字段** | `grep -n "note" packages/domain/src/entities.ts \| sed -n '/415/,/422/p'`；`grep -rn "\.note" apps/web/src/features/habits packages/ui/src/habits apps/mobile/src/screens/HabitsScreen.tsx` | 实体有 `note?`（`entities.ts:421`）；习惯这一族里读写 **0 命中** |
| 移动端能不能**新建**习惯 | ✅ **能**，而且是常驻入口不是空态引导卡 | `grep -rn -e addHabit -e createHabit --include='*.tsx' apps/mobile/src`（🔴 这一行原本写的是 `grep -rn "addHabit\|createHabit"`，那枚 `\|` 在 ripgrep 里是字面竖线 ⇒ 恒 0，见 §9） | `HabitsScreen.tsx:428-456` = `Card` 里 `TextField` + 主按钮，`:442` 空名直接 `return`，`:446` `.createHabit(name)` ⇒ 一条 op，失败进 `setError`；随 `b2b5455a`（09-28 22:02「移动端对齐 Web 的同一批能力」）落地。🔴 **本篇第一版写的是"不能"** |
| 移动端能不能改**图标** | 🔴 不能（web 可以） | `grep -rn -e setHabitIcon -e HabitIconPicker -e habitIconOf -e HABIT_GLYPHS apps/mobile/src` | **0 命中** —— 这一行重跑过（`-e` 多写法 ≡ `-E "a|b"`），是真 0（与上面「新建」那行的假 0 不同）；web 侧 `HabitIconPicker.tsx` 117 行 |
| 移动端能不能改名/删除 | ✅ 能 | `grep -n "renameHabit\|removeHabit" apps/mobile/src/screens/HabitsScreen.tsx` | `:227` / `:240`（文件头 `:343-344` 记着"此前界面上一个入口都没有"这段历史） |
| 词条是否中英同步 | ✅ 同步 | 数 `web.habits.*` / `mobile.habits.*` / `common.habits.*` 两表逐档 | zh `63 / 2 / 6`，en `63 / 2 / 6` 相等；`check:ui-language` 也在链上 |
| 桌面三壳 / node-host / landing 有没有习惯 UI | 边界，不是缺陷 | `grep -rin "habit" apps/desktop apps/desktop-macos apps/desktop-linux apps/desktop-windows` | **0 命中**；node-host 只有 CLI（66 处，无界面）；landing 只有宣传用的 `src/mockup/HabitHeatmap.tsx` |
| 既有测试与台架 | 单测 142 条 + e2e 18 条 + 5 台变异台 | `ls apps/web/tests \| grep -i habit` 等 | web 4 文件 75 例、mobile 2 文件 23 例、`packages/ui` 2 文件 44 例、e2e 4 文件 18 例；台架 `mutate-habit-detail-card / -habit-period-stats / -habit-rate-label / -habits-selection-fallback / -detail-pane-habit-e2e` |
| 棘轮基线 | 28 | `grep -n "HT_FAMILY_BASELINE" scripts/check-row-single-source.mjs` | `:341` → `HT_FAMILY_BASELINE = 28`（🔴 新增 `.ht-habit__*` 一族必须**同时消掉一族**才净增为零） |

## 2. 工单（每张都写：范围 / 落点 / 判据（必须能红）/ 变异臂 / 依赖）

### 第一批 —— 不等任何拍板

| 单 | 范围与落点 | 判据 | 变异臂 |
|---|---|---|---|
| **H1 中栏两列卡片网格** ✅ **已落地**（`fce8468a`，2026-10-06 01:2x）（= [W13a](detail-pane-alignment.md)，题目/落点/判据写在那张单里，**开工前读那份**） | `apps/web/src/styles/app/habits.css`（唯一落点：`container-type: inline-size` + `@container (min-width: 33rem)` 那两档）；🔴 `HabitsList.tsx` 与 `packages/ui/src/habits/*` **都没动** —— `.ht-habit__item` 本来就是带边框圆角的一枚卡，DOM 一行不动，而共享层一动就推给四端 | ① **存在性**：每张卡各自各有底盘+名字+7 点+三个数，且卡片数 == `rows.length`（T1）；② **几何**：`boundingBox()` 证"第 1、2 张卡 `y` 同 `x` 异"，并**合起来铺满整列**（T2/T3）；③ 选中态仍单源（T6）；④ `aria-label` 一次念完三数 —— **不在这一族里**，已由 `apps/web/tests/habits-list-pane.spec.tsx:218` 钉住（逐字比中文整句），e2e 不重复；⑤ 暗色实际切了看（T7 + 图） | 臂台 `research/tools/mutation-rigs/mutate-habits-two-column.mjs`，读数 **3/3**：N1（摘掉 `container-type`）与 N2（`@container` 里换成单轨 = "改了名字没改布局"）红集**恰为** T2,T3,T7；N3（三个数字搬回左轨）恰为 T5；三臂的 jsdom 层 `Tests 23 passed` **全盲** ⇒ 这 7 条不是那 8 组的重复；复原 `BACK_TO_CLEAN` 两层复跑绿。<br>🔴 **N3 前两版形状都打空**，而那是**臂自己的错不是判据没牙**（记进臂的注释）：注入"让名字不肯收缩"（先是 `.ht-habit__name{min-width:max-content}`，再是行轨道 `max-content auto`）时 e2e 7 条全绿 —— `auto` 轨道的**基数是 min-content**（growth limit 才是 max-content），轨道总宽超出容器时网格**不收缩**，于是数字整组停在卡片内、多余宽度从 `justify-self:end` 那侧**往左**溢出。⇒ "数字被挤出右边界"这一份坏在当前 DOM 里**结构上造不出来**，T5 真正守的是"贴右边界"那一档。⚠️ 别复用外层那条 `boundingBox()` 判据（它量的是"清单列 vs 详情栏"） |
| **H2 移动端新建：只剩判据**（🔴 界面已落地，本单的范围与第一版不同） | 入口在 `HabitsScreen.tsx:428-456`（`TextField` + 主按钮 + `:446 createHabit(name)`，随 `b2b5455a` 09-28 落地），**不缺界面**；缺的是钉住它的判据 —— 现量 `grep -rln createHabit apps/mobile/tests` 只命中 `organizer-rename.spec.ts`（那是清单/标签），**习惯新建本身 0 条判据** | ① 新建一条 ⇒ **恰好一条 op**（AGENTS §3.4）；② 另一台设备（node-host CLI 或 web）读到**同一条习惯**，不是只在本机；③ 空名不写（`:442` 已有 `return`，但没人钉）；④ 失败要进 `setError` 而不是静默（`:451-453` 已有，同样没人钉） | 把 `createHabit` 换成"只 push 进本地数组" ⇒ ②红（这条洞本仓库在"清单/标签"那一族实测过）；摘掉 `:442` 那枚空名拦 ⇒ ③红；把 `catch` 换成空函数 ⇒ ④红 |
| **H3 移动端图标选择器**（补端间不对称） | 把 web 的 `HabitIconPicker.tsx`（117 行）需要的东西接进 mobile 的面单；🔴 图标必须仍是 **Lucide 闭集**（AGENTS §5 禁 emoji），色槽走既有 `renderColorSlot` 那条缝 | ① 改图标 ⇒ 落盘 `icon` 且刷新后仍在（不是只改内存）；② 两端读同一个值（web 侧截图对照）；③ 图标闭集外不许出现新值 | 把写入做成"只改本地 state" ⇒ ①红；给闭集外放行 ⇒ ③红 |

### 第二批 —— 挂在待拍值上（见 §5）

| 单 | 范围 | 阻塞它的决定 | 对应旧编号 |
|---|---|---|---|
| **H4 习惯月历 + 可点补打卡** | 让 `monthGrid` 长第三个消费者（今天只有 `DatePicker` 与日历侧栏），把热力图/月历格子从裸 `View` 变可点；同时给 `backfillDays` 一个**真读它的地方** | ① 补打卡窗口到底多宽（现在是死字段）；② 是否允许无限回溯 | 就是 **W9** |
| **H5 `frequency` 写入口** | `NewHabitFields` 加该键 + 编辑处档位（每天 / 每周几 / 每 N 天，形状就是 `HabitFrequency` 那三个变体：`entities.ts` 的 `daily` / `weekly{daysOfWeek}` / `interval{everyNDays}`）+ MCP 侧要不要出（现量：`local-api-host.ts:331`、`tools/shared.ts:538`、`server.ts:69` **三处明写"刻意不出"** ⇒ 出不出是**对外授权面**，不归本单顺手改） | 🔴 **原先写的"C1#2 口径未拍"已被现量否证**（见 §9 第 3 条与 §5 那一行划掉的 P-2）：判定侧按计划日数连续天数已经生效 ⇒ 本单**不阻塞**，剩下的真风险只有一条 —— 写入口接上之前，界面上不许出现"频次"那一行（§7 第 195 条那个病） | 就是 **W13d** |
| **H6 `HabitLog.note`** ✅ **已拍（2026-10-06 00:5x 代拍）：界面不做，字段留位并明说** | 落点只有一处：`packages/domain/src/entities.ts` 那枚 `note?` 原本是**裸声明、上方一行注释都没有**（那正是本单写的"最坏的结果"）。改后它自己写着：预留位 / 界面不碰 / 没有读取者 / 什么时候要重新判（要判就得连带补三侧 + 留存说明） | 拍它的理由不是"没时间"，是**已有正式去处**：叙述性文本在 heyta 是 `NOTE` 实体（两端有界面、有搜索、有导出），而打卡记录的语义是"达成判定"；再开一处自由文本只会多出一份既没有入口也没有留存承诺的密文存量（§3.3 那条"加字段容易删字段难"同向） | 回退：改成"做"时先删那段注释，再补 web 面单 / mobile 面单 / `local-api` 的 `habit-log` 三侧，判据照 H3 那一族写（落盘 + 刷新后仍在 + 另一端读到） |
| **H7 年视图（12 张月卡）与"中栏三档"** | 先定"三档做几档"，再决定年那一档的取数出口 | 滴答右上角那组切换切的是中栏自己的读法，我们的月历那一档真身在 H4；"年"全仓没有 | 就是 **W13c**，另含 **W13b**（那颗 `⌄` = 需要"习惯清单"这一层数据，`Habit` 现量无任何归属字段 ⇒ 要 ADR） |

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
| P-1 | 补打卡窗口多宽 / 是否无限回溯 | H4 | 月历格子画出来了但点不动，"有这功能"是假读数 |
| ~~P-2~~ | ~~频次（每周 N 次）进不进"达成/连续"判定~~ 🔴 **这一格已被现量否证，不再是待拍**（2026-10-06 00:4x）：判定侧**已经按频次走** —— `computeStreak` 数的是 `isScheduledOn(habit.frequency, …)` 挑出的**计划日**（`habit-streak.ts:131/158/227/360`，函数注释自己写着"否则每周一次的习惯永远只有 1"），韧性 `:165/239` 与 `today-progress.ts:109` 同一个口径。⇒ 原句"现有 `computeStreak` 全按每天"**是错的**，H5 的范围因此从"先拍口径"缩成"补写入口"（见 §9 第 3 条） | H5 | 留在表里是为了让下一位看见：一条阻塞关系写得越久，越没人再去核它的前提 |
| ~~P-3~~ | ~~打卡备注做不做（`HabitLog.note`）~~ ✅ **已拍（00:5x 代拍）**：界面不做，字段留位并在源码处明说 | ~~H6~~ 落点见 §2 的 H6 那一行（`packages/domain/src/entities.ts`） | 原句"字段继续躺在实体里当'看起来有'的读数"**已经不再成立** —— 那枚 `note?` 现在自带"预留位 / 界面不碰 / 何时重判"的注释；把它读成"有功能"的成本从"没人会红"变成了"读一眼就有答案" |
| P-4 | 要不要"习惯清单"这一层数据（滴答中栏那颗 `⌄`） | W13b/H7 | `Habit` 现量无归属字段 ⇒ 答案是要就先出 ADR，不要就先不抄那颗箭头 |
| P-5 | 中栏视图切换做几档、切换状态存不存/存哪 | H7 | 停在"一种读法"是可用状态，不是缺陷 —— 但不拍就会各做各的 |

## 6. 完成定义（DoD，逐项打勾才算这一面收口）

- [ ] 每张单的判据都跑过并且**逐臂看过红集**（存活的那几条才是这单真正产出的判据）；
- [ ] `pnpm check` 全链 RC=0（含上面那八道门禁）；
- [ ] 习惯面的 e2e 用例**在当前产物上**重跑，截图逐张打开看过，主蓝数得出（§7 第 82 条）；
- [ ] 暗色主题实际切换查看（AGENTS §5）；
- [ ] `pnpm reinstall:all` 四端装上当前源码产物（AGENTS §6.1.1）—— 桌面三壳与 node-host 无习惯 UI 是**已登记边界**，
      这一格只要求 web / Android / iOS 三端的习惯屏各有一张"装上的是当前产物"的判据；
- [ ] 本篇 §1 那张现状表**重跑并回填**（哪几行从 🔴 翻成 ✅，附命令与读数）；
- [ ] `docs/plans/detail-pane-alignment.md` 与本篇之间没有两套状态（同一张单不许两处各写各的状态）。

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
