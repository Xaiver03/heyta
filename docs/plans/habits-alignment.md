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
**没落地的全部集中在三处**：① 中栏的**排法**（一条纵列，滴答是两列卡片）、
② **写入口缺了三个字段**（`frequency`、`backfillDays`、`HabitLog.note` 都是"实体里有、界面不碰"的死字段）、
③ **移动端建不了习惯、改不了图标**。
所以"对准滴答"这句话在 2026-10-06 的真实含义不是"数字不够多"，是**排法与写入口**。

## 1. 现状（2026-10-06 00:0x 逐处现量；每条都给了命令，别照本节念）

| 面 | 事实 | 现量命令 | 读数 |
|---|---|---|---|
| 打卡能不能记**实际值** | ✅ 能，两端都接 | `grep -n "checkIn(" packages/ui/src/habits/HabitBoard.tsx apps/web/src/features/habits/store.ts apps/mobile/src/screens/HabitsScreen.tsx` | 签名 `checkIn(habitId, date?, value?)`（`habit-actions.ts:167/331`）；web `store.ts:123` 与 mobile `HabitsScreen.tsx:403` 都把 `value` 递下去 |
| 六张统计卡的算式 | ✅ 有唯一所有者 | `grep -rn "computeHabitPeriodStats" packages` | `habit-streak.ts:328` 定义，`motivation.ts:202` 取数（`month` 是**必填**成员），四格渲染在 `HabitBoard.tsx:590-631`；落地账见 W 篇 §8.121 |
| 中栏的**排法** | 🔴 一条纵列 | `sed -n '80,86p' apps/web/src/styles/app/habits.css` | `display: flex; flex-direction: column;` |
| 中栏有没有标题行 | 🔴 没有（第一枚子元素是新建表单） | `sed -n '118,126p' apps/web/src/features/habits/HabitsView.tsx` | `.ht-habit__side` 里直接是 `<form>` |
| 有没有视图切换 | 🔴 没有 | `grep -rn "viewMode\|segmented" apps/web/src/features/habits/` | **0 命中** |
| 有没有**月历 / 年视图**的习惯尺度 | 🔴 没有 | `grep -rn "monthGrid" packages/ui/src/habits packages/domain/src`（习惯侧）；`grep -n "HABIT_HEATMAP_DAYS" packages/ui/src/habits/model.ts` | 习惯只有**两档**：7 天点（`HABIT_LIST_WEEK_DAYS=7`，`model.ts:68`）与 90 天热力图（`HABIT_HEATMAP_DAYS=90`，`model.ts:56`）；`monthGrid` 的消费者是 `DatePicker` 与日历侧栏，**习惯 0** |
| `frequency` | 🔴 **死字段**（界面写不进、MCP 读不出） | `grep -rn "frequency" packages/app-host/src packages/ui/src apps/web/src/features/habits apps/mobile/src` | 只有 `local-api-host.ts:331` 那句"`frequency` 一律不出"与一处注释；`NewHabitFields` 里**没有这个键** |
| `backfillDays` | 🔴 **死字段**（透传但没人写、也没人读） | `grep -rn "backfillDays" packages` | 只在 `habit-actions.ts:74` 声明、`:238` `...over` 透传；**界面写入 0 处** |
| `HabitLog.note` | 🔴 **死字段** | `grep -n "note" packages/domain/src/entities.ts \| sed -n '/415/,/422/p'`；`grep -rn "\.note" apps/web/src/features/habits packages/ui/src/habits apps/mobile/src/screens/HabitsScreen.tsx` | 实体有 `note?`（`entities.ts:421`）；习惯这一族里读写 **0 命中** |
| 移动端能不能**新建**习惯 | 🔴 不能 | `grep -rn "addHabit\|createHabit" apps/mobile/src` | UI 侧 **0 命中**（只有别的屏 `createHabitActions(host)` 与测试夹具）；web 有（`HabitsView.tsx:99`），node-host CLI 有 |
| 移动端能不能改**图标** | 🔴 不能（web 可以） | `grep -n "setHabitIcon\|HabitIconPicker" apps/mobile/src/screens/HabitsScreen.tsx` | **0 命中**；web 侧 `HabitIconPicker.tsx` 117 行 |
| 移动端能不能改名/删除 | ✅ 能 | `grep -n "renameHabit\|removeHabit" apps/mobile/src/screens/HabitsScreen.tsx` | `:227` / `:240`（文件头 `:343-344` 记着"此前界面上一个入口都没有"这段历史） |
| 词条是否中英同步 | ✅ 同步 | 数 `web.habits.*` / `mobile.habits.*` / `common.habits.*` 两表逐档 | zh `63 / 2 / 6`，en `63 / 2 / 6` 相等；`check:ui-language` 也在链上 |
| 桌面三壳 / node-host / landing 有没有习惯 UI | 边界，不是缺陷 | `grep -rin "habit" apps/desktop apps/desktop-macos apps/desktop-linux apps/desktop-windows` | **0 命中**；node-host 只有 CLI（66 处，无界面）；landing 只有宣传用的 `src/mockup/HabitHeatmap.tsx` |
| 既有测试与台架 | 单测 142 条 + e2e 18 条 + 5 台变异台 | `ls apps/web/tests \| grep -i habit` 等 | web 4 文件 75 例、mobile 2 文件 23 例、`packages/ui` 2 文件 44 例、e2e 4 文件 18 例；台架 `mutate-habit-detail-card / -habit-period-stats / -habit-rate-label / -habits-selection-fallback / -detail-pane-habit-e2e` |
| 棘轮基线 | 28 | `grep -n "HT_FAMILY_BASELINE" scripts/check-row-single-source.mjs` | `:341` → `HT_FAMILY_BASELINE = 28`（🔴 新增 `.ht-habit__*` 一族必须**同时消掉一族**才净增为零） |

## 2. 工单（每张都写：范围 / 落点 / 判据（必须能红）/ 变异臂 / 依赖）

### 第一批 —— 不等任何拍板

| 单 | 范围与落点 | 判据 | 变异臂 |
|---|---|---|---|
| **H1 中栏两列卡片网格**（= [W13a](detail-pane-alignment.md)，题目/落点/判据写在那张单里，**开工前读那份**） | `apps/web/src/features/habits/HabitsList.tsx` + `apps/web/src/styles/app/habits.css`；🔴 `packages/ui/src/habits/*` **不动**（中栏是 web 的 DOM 层，共享层一动就推给四端） | ① **存在性**：每张卡都各有底盘+名字+7 点+三个数，且卡片数 == `rows.length`；② **几何**：`boundingBox()` 证"第 1、2 张卡 `y` 同 `x` 异"；③ 选中态仍单源；④ `aria-label` 一次念完三数；⑤ 暗色实际切了看 | 只换 class 名不换布局 ⇒ ②红；从卡里摘掉一个数 ⇒ ①红；另起 `useState` 存选中 ⇒ ③红 + `check:selection-single-source` 红。⚠️ 别复用外层那条 `boundingBox()` 判据（它量的是"清单列 vs 详情栏"） |
| **H2 移动端建习惯入口** | `apps/mobile/src/screens/HabitsScreen.tsx`（清单上方一枚入口，复用既有 `createHabit`）；**动作层现成** —— 本单只补界面 | ① 新建一条 ⇒ **恰好一条 op**（AGENTS §3.4）；② 另一台设备（node-host CLI 或 web）读到**同一条习惯**，不是只在本机；③ 取消/空名不写；④ 截图两端人看过 | 把 `createHabit` 换成"只 push 进本地数组" ⇒ ②红（这条洞本仓库在"清单/标签"那一族实测过）；不加空名拦 ⇒ ③红 |
| **H3 移动端图标选择器**（补端间不对称） | 把 web 的 `HabitIconPicker.tsx`（117 行）需要的东西接进 mobile 的面单；🔴 图标必须仍是 **Lucide 闭集**（AGENTS §5 禁 emoji），色槽走既有 `renderColorSlot` 那条缝 | ① 改图标 ⇒ 落盘 `icon` 且刷新后仍在（不是只改内存）；② 两端读同一个值（web 侧截图对照）；③ 图标闭集外不许出现新值 | 把写入做成"只改本地 state" ⇒ ①红；给闭集外放行 ⇒ ③红 |

### 第二批 —— 挂在待拍值上（见 §5）

| 单 | 范围 | 阻塞它的决定 | 对应旧编号 |
|---|---|---|---|
| **H4 习惯月历 + 可点补打卡** | 让 `monthGrid` 长第三个消费者（今天只有 `DatePicker` 与日历侧栏），把热力图/月历格子从裸 `View` 变可点；同时给 `backfillDays` 一个**真读它的地方** | ① 补打卡窗口到底多宽（现在是死字段）；② 是否允许无限回溯 | 就是 **W9** |
| **H5 `frequency` 写入口** | `NewHabitFields` 加该键 + 编辑处档位（每天 / 每周 N 次）+ MCP 侧要不要出 | 🔴 C1#2 那一族：**频次进不进"达成/连续"判定**（现有 `computeStreak` 全是"每天"口径）。不拍就只能做"能存能显示不判定"那一半，而那一半会把"看起来支持了"伪装成做完了 | 就是 **W13d** |
| **H6 `HabitLog.note`：做不做"这次打卡记一句"** | 实体已留位（`entities.ts:421`）。要么补三侧（web 面单 / mobile 面单 / `local-api` 的 `habit-log` 工具），要么在文档里明写"预留位，界面不碰" | 产品决定。**最坏的结果不是不做，是继续留着这个字段让下一位以为做了** | 新 |
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
| P-2 | 频次（每周 N 次）进不进"达成/连续"判定 | H5、H1 卡上的频次那一行 | 现有 `computeStreak` 全按"每天"；口径混用会让同一习惯在两张卡上自相矛盾 |
| P-3 | 打卡备注做不做（`HabitLog.note`） | H6 | 字段继续躺在实体里当"看起来有"的读数 |
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
