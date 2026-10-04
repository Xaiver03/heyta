# 详情面对齐与复习面：工单分解

> 状态：**规划中**（2026-10-03 立）
> 🔴 **它是 [`ui-review-fill-zh-timeline.md`](ui-review-fill-zh-timeline.md) 的下游工单，不取代它** —— 那张表里 R1–R16 的历史裁决仍以那份为准；本篇只新增"详情面 / 常驻右栏 / 复习面"这一段。同理**不取代** [`goal-layout-audit.md`](goal-layout-audit.md)（逐页排版判据）、`docs/research/calendar-year-time-and-mobile-profile.md`（日历与移动端；⚠️ **2026-10-03 现量：该文档只活在主检出的未提交改动里，`git log --all` 里没有它** —— 所以这里写成路径而不是链接，干净检出上链接会是死链）、[`multi-end-unified-strategy.md`](multi-end-unified-strategy.md)（**唯一权威主计划**，其 §5.2 / §5.3 / §5.4 / §7.1e 是本篇的对账基准）。
> 证据全部在 [`../research/detail-pane-alignment-and-spaced-review.md`](../research/detail-pane-alignment-and-spaced-review.md)（下称**调研**）。本篇只写"按什么顺序做、每单怎么算做完"，**不重复证据**。
> 按 [`README.md`](README.md) §七.4：**计划层不引用行号**，一律引小节标题与符号名。

---

## 0. 一句话与范围

把滴答那套"**导航 / 列表 / 常驻详情面**"的第四段骨架补完（调研 A2 指出：这一段在 `dida-view-unification.md` §1.3 的四段表里早就写着，但**落地记录从来没做它**），顺带把习惯与番茄两个面的读数补齐。**复习/背诵面不在本篇内开工**，只留接口（§6 W10）。

**为什么值得做**：调研 A0.7 的成本重估 —— `TaskActions` 的 **16 个写动作早已齐备**、`Task.startDate` / `durationMinutes` 已在模型且被移动端详情面消费。⇒ **缺的是 web 那一栏 + "选中态"这个概念**，不是字段、不是动作、不是 schema。

---

## 1. 开工前置闸门（每单开工前现场复跑，红了不许绕过）

| # | 闸门 | 现量命令 | 红了怎么办 |
|---|---|---|---|
| G1 | **归属门**：本工作树是共享的，先确认没有别人未提交的源码落在本篇要改的文件上 | `git status --porcelain` 逐路径核 | 换隔离 worktree 跑（本仓库已在隔离 worktree 里跑过全量验证，见 [`goal-landing-and-quality-audit.md`](goal-landing-and-quality-audit.md)），**不代改别人的活** |
| G2 | 🔴 **两道余量为 0 的棘轮**：`check:l4` 内联样式（web features / mobile screens 两个基线）与 `check:row-single-source` 的 `ht-*` 前缀族基线 | `pnpm check:l4` `pnpm check:row-single-source` | **绝不为通过而调高基线**。正解是"消掉净增"：先在同批里把存量内联改成类、或把旧前缀族合并掉。历史见调研 A7.2 |
| G3 | **干净检出复跑**：门禁红可能只在混合工作树成立 | 另建 detached worktree 复跑红的那一道 | 若干净检出绿 ⇒ 是别人在飞，**登记不修** |
| G4 | **构建先行**：本篇会改 `packages/*`，判据读 `dist` | `pnpm -r build` 再跑门禁/判据 | 见 AGENTS §6.1 与调研里那条"变异共享包必须 build 后再跑" |

**收尾固定流程**（AGENTS §6.1.1，不可省）：`pnpm reinstall:all` 四端重装 + 每端一条"装上的是当前产物且能起来"的判据。**门禁绿 ≠ 装上了当前产物。**

---

## 2. 工单表

**排序原则**：先把地基（选中态）做成一等状态，再开槽位，再往里填内容；**纯读侧聚合排在写路径改造前面**，因为读侧不依赖任何拍板。

### 第一批 —— 不依赖任何拍板，可直接开工

| 单 | 范围 | 落点 | 判据（必须能红） | 变异臂 |
|---|---|---|---|---|
| **W0 纠正两处文档过期** | 调研 A0.8 与 A4 末：`docs/README.md` 对 ADR-0043 的"代码未开工"、`docs/reference/architecture.md` 里虚构的 `FocusSession.mode/duration` | 两份文档本体 | 死链检查 + 一条"README 状态声明与 plans 索引不矛盾"的口径核对 | 把 README 那句改回错的样子 ⇒ 判据应红（若判据是纯文本比对则不适用，**允许只做人工核对并在此登记**） |
| **W1 选中态成为一等状态** | web 任务 store 加"当前选中任务 id"；`TaskList` 传 `onOpenTask`；行体可点 | `apps/web/src/features/tasks/store.ts`、`App.tsx` 两处 `TaskList` 调用、`packages/ui/src/task-list/TaskRow.tsx` | ① 点一行 ⇒ 选中 id 等于该行 id；② 换视图/切筛选后选中回落规则明确（照 `HabitsView` 的"存 id 不存对象 + 派生回落"）；③ **键盘可达**（↑↓ 移动选中，`activeTaskId` 已有先例） | 拿掉 `onOpenTask` ⇒ 行体不可点，①② 必红（`TaskRow` 对"没传"的处置是静默不可点，**这正是它此前从未被照出来的原因**） |
| **W2 第四列槽位（外壳层）** | `.ht-app` 加第四列；`--ht-layout-content-max` 语义从"内容区上限"改成"中间列上限"；新 token `--ht-layout-detail-*`（宽/最小/最大） | `apps/web/src/features/shell/`（L3，被 L4 扫描豁免）、`packages/design-system/src/tokens.css` + `TOKEN_GROUPS` | 🔴 **必须比 `boundingBox()`**（jsdom 不做布局，照 `e2e/tests/habits-pane.spec.ts` 的写法）：详情列右边缘 == 视口右边缘（证明它贴边，不是"中间一坨里再分栏"）；栏宽落在 token 区间内 | 把第四列挂回 `.ht-content` 内部 ⇒ "右边缘 == 视口右边缘"转红。**这一条是本次改造的承重判据，不能省** |
| **W3 浮层覆盖范围的决定与钉死** | 设置/搜索浮层**盖不盖**详情列 | `apps/web/src/styles/app/sheets.css`、`.ht-content` 的 `position: relative` | 现有两条判据（`settings-sheet-ia`、`search-overlay-ia`）继续绿 **+ 新增一条**："浮层打开时详情列仍可见"（默认取"仍可见"，理由：与既有裁决"浮层只盖内容区、rail 与侧栏仍可见"同源）。⚠️ 若产品负责人要"盖住"，本条判据方向反过来 | 把详情列移进 `.ht-content` ⇒ 新判据红 |
| **W4 塌缩看高也看宽 + 可收起** | 详情列的出现条件；收起按钮 + 三条恢复路径（工具栏 / 菜单 / 快捷键） | `apps/web/src/styles/app/narrow.css`（现在只有一个宽度断点、不看高度）、`features/shell/` | ① 宽 ≥ 档 **且** 高 < 档 ⇒ 详情列不出现（Android 那条"Medium 宽 + Compact 高两栏不可行"的反例要真被挡住）；② 收起后**三条路径各自都能恢复**；③ 收起态持久化在设备本地 | 把高度条件摘掉 ⇒ ① 红；摘掉快捷键 ⇒ ② 红 |
| **W5 复选框颜色即优先级** | 调研 A2：主计划 §5.3 第 3 条"最值得抄"**至今未落地**（我们是一枚 Flag 徽标 + 同色文字） | `packages/ui/src/task-list/`（共享层 ⇒ 四端同时受益） | 优先级不同的任务，复选框描边色**互不相同且等于该优先级的既有颜色 token**；⚠️ **暗色主题必须实际切了看**（AGENTS §5） | 把描边写死成中性色 ⇒ 判据红。**注意**：这条**改了视觉**，所以判据里不许出现"改前后逐字节相同"那类零视觉断言；要写明**预期差在哪**（哪几个优先级、各自哪个颜色 token），否则它既可能假绿，也会把正常改动误杀 |
| **W6 🔴 计数型习惯那一米：`HabitLog.value` 可达** | 调研 A5 最重要的一条：`HabitBoard` 的 `onCheckIn` 签名不带 value ⇒ 只能"一键记满目标值" | `packages/ui/src/habits/HabitBoard.tsx` 回调签名 + 两端调用处 + `packages/app-host/src/habit-actions.ts` 的 `checkIn` | ① 目标 8 页、今天记 5 页 ⇒ 落盘 `value=5` 且界面显示 5；② 不传 value 时**逐字保持旧行为**（默认等于 target）；③ 撤销打卡仍走软删 | 把默认值分支摘掉 ⇒ ② 红（这条防的是"修 A 弄坏 B"） |
| **W7 番茄右栏读侧：概览四数 + 记录列表** | 调研 A4：`ActivityTotals` 缺 `focusCount`；`listSessions()` 唯一消费者只做当日汇总 ⇒ **一条记录都没被逐条渲染过**；web 专注页缺"今日专注时长"（mobile 有） | `packages/domain/src/milestones.ts`（加聚合）、`packages/domain/src/focus.ts`、`apps/web/src/features/focus/` | ① 四张卡各自的数与领域函数**逐字同源**（不许界面自己 reduce）；② 记录列表渲染条数 == `listSessions()` 里工作段条数；③ **两端对称**：web 与 mobile 的"今日专注时长"必须来自同一个出口 | 在 web 侧把 `shouldPersistSession` 的过滤摘掉 ⇒ ② 红（休息段混进记录列表）；把 `focusCount` 写成 `focusMs/60000` ⇒ ① 红 |
| **W8a 🔴 值与词同源**（从 W8 的 #2 里拆出来） | `resilience.total` 是**达成天数**，界面七个键印成"累计 N 次" | `packages/i18n/src/locales/{zh-CN,en}.ts` + 生产者侧四条注释 | 每个带这个数的键：说了单位的必须说 day(s)，任何一条不许说成 次/check-in；再加一条**漏登记**门（新增 `累计 {total}` 句子不登记就红） | 把任一条改回"次" ⇒ 红；把 `{total}` **改名** ⇒ 红（这一臂是第一版实测出来的洞，见 §8）；换成"打卡 N 天"这种同义改写 ⇒ **必须仍绿** |
| **W8 习惯六卡的读侧** | 调研 A5：六个数里**四个连函数都没有**（月打卡天数 / 月完成率 / 月完成量 / 总完成量），且"总打卡"我们口径是"次" | `packages/domain/src/habit-streak.ts`、`habit-resilience.ts`，出口走 `packages/app-host/src/motivation.ts` | 每个数一条单测，期望值来自**手算夹具**（照 `activity-categories` 那套 fixture 纪律）；🔴 **口径由 W-P1 拍板后才写判据**（见 §5）；🔴 期望值里凡涉及"一天打 N 次"的，**W6 之前不可达** | 未拍板前**不开这单** —— 见 §5 的阻塞映射 |

### 第二批 —— 挂在待拍值上，拍完即开

| 单 | 范围 | 阻塞它的决定 |
|---|---|---|
| **W9 习惯月历 + 可点补打卡** | 把 `monthGrid`（今天只服务 `DatePicker`）长成第三个消费者，兑现 `dida-view-unification.md` §4 那条"**一个组件、三个尺度**"；热力图/月历格子从裸 `View` 变可点 | ① 补打卡窗口到底多宽（`Habit.backfillDays` 是**死字段**，零读取方，而 `phase-1-single-client-loop.md` 承诺过它）；② 是否允许无限回溯 |
| **W10 复习/背诵面** | 调研 Part B 的 R1/R2/R3。**本篇不开工**，只要求：W2/W3 的详情列**预留一个"到期复习"区块的位置**（不写实现、不加空壳组件） | 调研 C1 第 9–12 条（做不做 / 挂谁身上 / 免费付费 / 允许哪些科学宣称）。🔴 走 R2/R3 要**新实体** ⇒ 必须先出 ADR，且服务端先认（ADR-0044 的部署顺序） |
| **W11 专注记录补录与删除** | ~~调研 A4：滴答桌面端做法是"可补记不可删"~~ → **该说法只对了一半**（2026-10-04 第三批一手调研，见调研 [C1b-Q6](../research/detail-pane-alignment-and-spaced-review.md)：滴答桌面端明文的是"**不支持删除番茄记录**"，那是**平台不对称**不是产品裁决；而"补录"和"改时长"是两件事，两家同行明文拒绝的是改时长）。我们**连删除动作都没有** | ~~是否重开 `trash-and-archive.md` 里"FOCUS_SESSION 不做删除"那条已拍决定~~ → 拆成两个更小的问题：**(a) 补录做不做；(b) 改时长做不做**。删除那一档继续挂着，但它现在**欠的是一条我们自己的理由**，不是一个同行依据 |
| **W12 番茄正计时** | ~~不是加控件，是**先加数据模型**（`FocusSessionKind` 无该值）⇒ 牵动 `EntityModelMap` 与线协议~~ → **前提被现量否证**（调研 [C1b-Q5](../research/detail-pane-alignment-and-spaced-review.md)）：`entities.ts:317` 那个枚举是**阶段**（work/短休/长休），不是计时模式，把两者合并是建模错误。真正卡住的是 `focus-actions.ts:130` 的 `plannedMs > 0` 校验与 `completed` 的统计语义 ⇒ **零 schema 变更的做法存在**（上游 Super Productivity 把模式当**计时器状态上的判别字段**，落库记录里没有模式字段） | 是否要做。**原来那道"要不要动数据模型"的题已随前提一起撤掉**，#5 真正要拍的变成**"正计时那一轮算不算一个番茄"**（⚠️ 滴答与 TickTick 都只明文"两模式时长合并计入有效时长"，**"算不算一个番茄"两家都没写** —— 未找到一手来源）。若答案是"只计时长不计数"，则**必须**有一个持久标记（可选 `timedMode?`，仍不必 bump schema）。📌 原登记的"成本参照"（并行分支 `feat/countdown-batch2` 的 W2 实测"`ENTITY_TYPES` 加一项即穿过整链，存储三套适配与线协议零改动"）**已不适用**，因为本单不再新增实体；那条读数仍留在倒数纪念日那份工单里，要用时得重新现量（该分支未合并） |

---

## 3. 依赖与顺序

```
W1 选中态 ──┬── W2 第四列槽位 ──┬── W3 浮层覆盖 ── W4 塌缩/收起
            │                   ├── W7 番茄右栏（读侧）
            │                   ├── W8 习惯六卡 ── W9 月历/补打卡 ── W10 复习面
            │                   └── W5 复选框优先级（可与 W1 并行）
            └── 详情面本体（依赖 W-P2 拍板：空即隐藏 or chip 常驻）
W0 文档纠正、W6 value 那一米：与上面全部正交，随时可插队
```

🔴 **两条硬顺序**：① **W1 必须先于 W2** —— 没有选中态就开槽，槽里只能放装饰，那正是被主计划 §5.4 否决的形状；② **W6 必须先于 W8 的"月完成量/总完成量"两卡** —— `value` 不可达时那两张卡即使画出来也是空壳。

---

## 4. 每单固定的验收动作（沿用本仓库既有纪律，不新造）

1. **登记现状 → 实现 → 判据 → 配变异臂证明能红 → 门禁 → 截图且人看图 → 记读数**（`calendar-year-time-and-mobile-profile.md` 那句原文）。
2. **界面类判据必须有截图，且人真的打开那张图**（AGENTS §6.2 规定一）。"非空白"挡不住错误屏 —— 要带界面特征（主蓝命中），见 §7 第 82 条。
3. **变异要逐臂看红集**，存活的那几条才是这单真正产出的判据（并行分支那条 W10 教训："做过变异验证"不等于"判据有牙"）。
4. 新增门禁/判据时**先确认它在违规输入下真的会红**（AGENTS §8.3）。不能失败的检查没有价值。
5. 涉及 `packages/*` 的改动：**build 后再跑判据**（读的是 `dist`）。

---

## 5. 待拍值 → 阻塞哪些单（只列会卡住工单的）

| 调研 C1 # | 要拍什么 | 卡住 | 不拍的后果 |
|---|---|---|---|
| **1** | 详情栏只放"选中项"，还是**永远放概览 + 记录 + 选中项** | W2/W3 的**验收内容**（不是槽位本身） | 只能先做 W7（番茄那面滴答自己就是"永远有内容"），任务详情栏空着 |
| **2** | 习惯统计三处口径：日历 vs 韧性 / 自然月 vs 滚动 / 天 vs 次 | **W8 全部**（判据的期望值就是口径） | 六张卡里五张无法写判据 —— 因为"对不对"没有定义 |
| **2a** | ~~这行原本混在 #2 里~~ ⇒ 拆出来：`total` 的值是**达成天数**、词条却写 **"累计 {count} 次"**（`packages/domain/src/habit-resilience.ts:197` → `packages/ui/src/habits/HabitBoard.tsx:484` → 三个 i18n 键：`locales/zh-CN.ts:1120/1121/2816` + `locales/en.ts:1035-1036`） | **不阻塞** —— 它是缺陷不是选择 | 值与词不同源，**无论口径拍哪一边都是错的**（Loop 的 `totalCount` 一手口径数的是**天**，见调研 C1b-Q2）⇒ 拆成 **W8a**，可先行；🔴 三处键必须一起改 |
| **3** | 计数型习惯先修 `value` 那一米 | 已拆成 **W6**，不拍也能做（它是缺陷不是选择） | — |
| **8** | 详情面里"无数据的区块"**空即隐藏** 还是 **chip 常驻** | 任务详情面本体 | 两种哲学混用 ⇒ 同一屏两套披露规则，下一单必然撞 |
| **9–12** | 背诵做不做 / 挂谁身上 / 免费付费 / 允许哪些科学宣称 | **W10** | 不动。⚠️ 其中 #12 是**对外话术的合规边界**，不是工程问题 |

🔴 本表**不替产品负责人拍**。W1–W7 与 W0 不依赖任何一拍，可以先跑；拍板只影响 W2/W3 的验收内容与 W8 起的批次。
> ✅ **2026-10-03 更新**：这 5 行每一项的"业界实际怎么答 + 带代价的推荐"已落到调研文档
> [C1b](../research/detail-pane-alignment-and-spaced-review.md)（含 Loop / Habitica 的逐行 `file:line`）。
> 拍板现在是**从有出处的选项里挑**，不是凭空选 —— 但**仍然是拍**，本节不代拍。

---

## 6. 明确不做 / 不许动

| 不做 | 理由（不是排期问题） |
|---|---|
| 抄滴答的 **emoji 习惯图标** | AGENTS §5 把"用 emoji 当图标"列为硬错；我们已是 Lucide 闭集 8 key |
| 抄**无选中时的空态插画** | 主计划 §5.4 已否决且**被第二批截图印证**（调研 A2） |
| 抄侧栏那两张**空态引导卡** | 主计划 §5.4 第二条不抄项，本次截图第二次印证它吃纵向空间 |
| 把**番茄钟塞进列表模型** | `dida-view-unification.md` §4 明文禁止（"统一是契约一致，不是形状一致"）。⇒ 番茄页中栏**仍是计时器**，右栏是"概览 + 记录" |
| 把**设置/搜索从浮层改成路由**或搬进右栏 | 主计划 §7.1e 的规律 + 两条既有判据会当场红（调研 A2 末两行） |
| 给 `Habit`/`FocusSession` 加**必填**字段 | AGENTS §3.3：已落盘的数据没有该字段，构建会绿、**炸在运行时** |
| bump `CURRENT_SCHEMA_VERSION` | AGENTS §3.3 |
| 在 `apps/*` 里判断"改这个字段该发哪条 op" | AGENTS §3.5 + `check:layering` 的 `no-op-construction-in-apps` |
| 为让 W2/W3 过而**调高两道棘轮基线** | 见 G2。这条是本仓库反复付过学费的纪律。🔴 但要说清它**现在靠什么守**：靠评审，不靠机器 —— 把两道棘轮的基线常数各 +1，`check:l4` 与 `check:row-single-source` 都仍然 `RC=0`，还会把调高打印成"已降 1 处"。A/B 与三种候选形状见 §8.82 |

---

## 7. 撞车面（开工前逐条现量，别照本节念）

本节记录的是 2026-10-03 的现场，**它本身会过期**：

- `feat/countdown-batch2` / `-w9` / `-w4b` / `-w7` 四条本地分支未合并，其中 **W5 卡片网格的代码半已落但未跑 e2e 截图**；
- 🔴 `packages/ui/src/calendar/*` 与 `CalendarScreen.tsx` **正被并行会话整片重写** ⇒ 本篇凡触及日历/月历的（W9）开工前必须重新现量；
- `packages/legal` 有 3 个文件脏着（与本篇无关，但会挡住全量 `pnpm check`）；
- 习惯的**改名/删除入口**在本次审计时是**未提交状态** ⇒ W8/W9 开工前先确认它已落 HEAD；
- 另有 `ui-review-fill-zh-timeline`、`calendar-year-time-and-mobile-profile`、`goal-multi-end-coverage` 三条线**未收口** ⇒ 本篇不与它们抢同一批文件；抢上了按 G1 走隔离 worktree。

---

## 8. 落地记录（做完逐条回填，**不允许"基本完成"**）

| 单 | 状态 | 读数（判据条数 / 变异臂红集 / 截图路径 / 四端是否重装） |
|---|---|---|
| W0 | ✅ 已完成（① 2026-10-03；② 补落地 2026-10-04 09:2x，见 §8.25 第一档；🔴 ② 那一行 09:4x 又按现量修了一次 —— "五档全部落地"把 web 独占的拖拽读成了两端都接，见 §8.29） | 两处过期都改在**文档本体**：① `docs/reference/architecture.md` 的实体清单里 `FocusSession` 原写 `mode(pomo/stopwatch), duration` —— 三个字段**都不存在**，真实形状是 `kind(work/shortBreak/longBreak) + plannedMs + actualMs? + completed? + startedAt? + endedAt?`（逐字段核对 `packages/domain/src/entities.ts` 的 `FocusSessionKind` 与 `interface FocusSession`）；② `docs/README.md` 对 ADR-0043 那句「⚠️ 代码未开工」改成已落地并留了更正痕迹（指向调研 A0.8 的取证）。**判据**：`docs-link-check` 无死链 + 两份文档不再与代码冲突（人工核对，无自动判据 —— 按 §2 那一行写明的"允许只做人工核对并在此登记"，这条**没有**变异臂，别把它当成有牙的）。⚠️ 归属：`docs/README.md` 同一文件里另有别人 7 行未提交的改动，所以我**没有**单独提交那一行，改动作废在工作树里，由下一次整文件提交带进去。🔴 **那句"由下一次整文件提交带进去"落空了**（2026-10-04 09:1x 现量：本分支 HEAD 与 `main` 两份 `docs/README.md` 里 `代码未开工` 那句**都还在**，工作树也没有那笔改动 ⇒ ② **从来没有落地**，而本行此前写着"✅ 已完成" —— 这是一次过度主张，不是措辞不严）。当场按**五条逐项现量**改掉（每条给了 `file:line`，见 §8.25 第一档），并复跑 `check:docs-voice` / `check:claims` / `check:reachability` 各 **RC=0**、`docs-link-check` 对本文件 **0 命中**、README 那张表 **139 行列数零不一致**。🔴 **判据条数与变异红集这两样此前这格里没有**（18:5x 由新的腿 7/8 照出来，按现量补）：判据 **0 条** —— 这一单改的是文档与代码注释里的句子，验收是三条常驻门禁各 RC=0 加逐字段人工核对（§8.25 第一档）；`无变异面：没有自动判据可供变异` —— 这一格原先那句"这条**没有**变异臂，别把它当成有牙的"就是它的真实读数，不许为了让两条腿闭嘴而补一条假判据 |
| W1 | 🔄 **进行中**（接线、判据、**真浏览器截图 + 人看图**都已闭合；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | **已落地**：单一所有者收拢 —— `packages/app-host/src/selection.ts`（封闭词表 + `createSelectionStore` + 纯函数 `pruneMissingSelection`/`pruneSelection`），四份本地 `useState` 全删，两端各只留一份宿主胶水 `apps/{web,mobile}/src/lib/selection.ts`。🔴 **词表从 6 类改成 3 类**（`task\|habit\|note`）：`project`/`tag`/`event` 是**投机项** —— 两侧的 prune 谓词照着写了 project/tag，而**没有任何一处界面会选中一条清单或标签**（它们在两端都是筛选/导航），"支持六类"读起来像已完成、实际只有三类活着。这条被升级成常驻门禁的**断言 D**（逐类扫宿主有没有 `select/useSelected`，零消费者即红；词表从数组字面量现读，解析出 0 项也算红）。💥 **本轮现场抓出的两个真缺陷**：① `apps/web/src/features/quadrant/QuadrantBoard.tsx` 把 `onOpenTask`/`activeTaskId` **声明了、解构了、没往共享板子传** ⇒ "三种投影接同一个选中"实际只有两种接上，而两个 prop 都是可选的 ⇒ **typecheck 全绿、当时四条门禁全绿**，症状只是"四象限不跟随选中"（→ §7 #179）；② `openNoteFromSearch` **签名里不收 id** ⇒ 搜索结果点便签只换视图、什么都不打开。③ 顺手补掉一条既有的端间不一致：web 时间线的行体此前**根本不可点**，而触屏端早能。**判据**：共享层 16 条（`packages/app-host/tests/selection.spec.ts`）+ web 选中 16 条（`task-selection.spec.tsx`）+ mobile 13 条（`selection-single-owner.spec.ts`；🔴 **13 是 `0815c4d5` 那趟的读数，现量 14** —— 第 14 条由 `806fce49`（§8.43「任务屏也持有便签全集」）加进来，本行当时没跟着改；现量命令 `cd apps/mobile && ./node_modules/.bin/vitest run tests/selection-single-owner.spec.ts` ⇒ 14 passed，16:1x 复跑过）+ 三种投影各自的行为判据（`quadrant-row-parity.spec.tsx` 新增 2 条、`timeline-board.spec.tsx` 新增 3 条、`notes-view.spec.tsx` 新增 3 条）+ 门禁 `check:selection-single-source` **八道断言 A–H**（A–G 见下，H 见 §8.46：谁读某一类的选中，谁就得把那一类喂进回落 —— §8.43 那次"人工数屏幕"从此变成常驻判据）（E 是同文件内比"声明"与"使用"；F 见 §8.37：四处渲染面各按端把选中说出来（**§8.42 起是五处**：共享时间线那一面原本"自己算、自己上色"却登记在递送层里，合法躲过了通道要求）；G 见 §8.36：宿主内每一处行 id 本地态都要带语义类别逐处登记）。**视图全集那一侧**见 §8.41：`ViewKey` 里每个视图都必须交代过自己站哪边（在 `CURSOR_VIEWS` 表里、或在 `ACCOUNTED_OUT` 登记表里），缺口／重叠／解析读空都红，装置 5 臂按预期 5/5。**面与回落那两侧**见 §8.42 / §8.43：前者把"每张面必须把选中说出来"钉成三条按类别给的规则（并修掉一处"有底色、没声音"的共享时间线面），后者把"该给哪几类喂回落"从**按功能位置数**改成**按谁在读数**（现量出任务屏是第三个持有便签全集的屏，4 臂按用例名点名；🔴 但它第一版那句"编辑层不自己关"的症状已被**§8.43 第 7 节**否证并划线留档，这一格的真实理由是"移除一条挂在别人挂载策略上的隐式依赖"，反事实读数 A/B/C 三层全绿在那节里）。🔴 **载体发现（写进 §7 #178）**：RNW 在 jsdom 里把样式编译成 class（`r-backgroundColor-*`），`el.style.backgroundColor` **恒为 `''`** —— 用它当判据第一次就得到"三种投影全都没底色"这种**看起来像三个真缺陷**的空读数；底色一律走 `getComputedStyle`（未选中是 `rgba(0, 0, 0, 0)`，不是空串）。**变异臂（两趟 rig 共 18 臂，每臂跑完复原并复跑回到绿；终态 Z2 = web/mobile/门禁三处 RC=0）**：14 条正臂按设计转红（门禁 A/B/B2/B3/C/A2/D/E/E2/E3-分母自检 + TaskList 底色 + TimelineBoard 两处底色 + 两处 `onPress` + NotesView 退回本地态 + 搜索丢 id + web 四处投影断一处 + mobile 回落摘一处 + mobile 三处投影全摘）；🔴 **一条第一次跑活了**：把 web 便签换回**裸名** `const [editingId] = useState(null)` 时门禁**全绿** —— 而文档块里当时写着"仍未覆盖：不带实体名的 editingId"，即这条缺口我**登记过但没验证**。补上裸名分支（`detailId\|selectedId\|editingId`，刻意不含 `active`/`open`：四象限的 `activeId` 是 dnd-kit 正在拖哪一颗）后重跑**转红**；为此把 `PasskeyPanel` 那份行内改名编辑器的状态改名 `editingRowId`（第一次我改成 `renamingId`，撞上 store 里已有的"请求在途那条"——两个概念不能并成一个名字，断言把它挡在写盘前）。两条负向对照绿：字样只写进注释、以及树上活着的 `activeId`/`editingRowId` 不被误伤。**读数**：门禁绿（`词表 3 类全有消费者（task 10 / habit 7 / note 13）、接线声明 17 处全部用起来`）；本轮直接跑的 `task-selection + timeline-board + quadrant-row-parity + notes-view` = **55 passed / 0 failed**；web/mobile/app-host/ui 四包 typecheck RC=0；`check:docs` 归因见 §8.1（三处死链指向**别人未提交**的在途文档，已把链接改成带状态的指针）。**真浏览器取证已闭合（2026-10-03 22:4x，载体 `feat/detail-pane` = `d5b835b5`）**：新增 `e2e/tests/selection-projections.spec.ts` **3 条**，跑法与读数：生产构建载体（`vite build` + `vite preview`，端口 4358）上 **3 passed / 0 failed**；截图五张落在 `apps/web/evidence/selection-projections/{01-list,02-quadrant,03-timeline,04-switch,05-search}.png`，**五张都逐张打开看过**：列表与搜索那两张里选中那条带浅蓝底、另一条白底；四象限那张选中那条落在"先不做"格里且带同一种蓝；时间线那张"未排期（2）"里只有第一条带蓝；换选中那张是**第二条**带蓝、第一条回到白底。看图还照出一件断言看不见的事：`switchView` 用鼠标点 rail，**rail 的 tooltip 会留在下一张图上**，第一版 `03-timeline.png` 里那句"四象限"正好压在选中那条的标题上 ⇒ 截图前 `parkCursor`（把鼠标挪开），这不是美化，§6.2 要的是"人能看懂的那张图"。🔴 **23:5x 两处更正（载体 `0de58095` + `0c159f7f`）**：① 那五张图已随 W2 的第四列整体重跑并**逐张重看**（选中态在四种投影里读数不变）；② 更要紧的是读底色的探针里有一条**会假绿**的机制被照出来了 —— Chromium 对**已从文档分离**的节点 `getComputedStyle` 返回空串，而判据写的是"选中那条 ≠ 同屏没选中的那条"，空串永远不等于任何真实底色 ⇒ **"根本没读到值"会被判成"画上选中色了"**。症状先以一次假红出现（两遍连跑全绿、第三遍红），所以这类"偶发红"要按**探针故障**查，不要按产品抖动放过。现在探针先等到算得出来为止，自检臂（把读数改成恒返回空串）实测 3 条全红。 |
| W1b 键盘光标 | 🔄 **进行中**（三层判据、22 条变异臂全红、七张图逐张看过、九道门禁 RC=0；但**原判据三条腿只落了第一条** —— "详情面跟着换"阻塞在拍板 #1、"Enter 打开焦点"阻塞在拍板 #8，四端重装也未做 ⇒ 不算已完成） | 原 W1 判据 ③「↑↓ 移动选中」**拆到这一行**，理由不是省事：`TaskList` 的 `activeTaskId` 是**展示槽**，而"往哪走"要有目的地才有意义 —— 详情列（W2）没开之前，回车没有可去的地方。判据是"↑↓ 改选中 + 详情面跟着换 + Enter 打开焦点"。<br>载体 `feat/detail-pane` = `6c3c1ecd`。<br>**分层与裁决**：规则在 `packages/app-host/src/selection.ts` 的 `moveSelectionInList`（四条：方向进列表 / 夹住不环绕 / 不猜位置 / 可返回同值），宿主只回答"当前哪个视图、那一串 id 现在在 DOM 里的顺序、什么时候不该响应、要不要滚进视野"。🔴 **顺序从渲染出来的那一串行取，不再算一遍**：列表顺序今天有四个所有者（`groupTasksByDate` + `collapsedGroups` / `QuadrantBoard` 的格子序 / `TimelinePanel` / 习惯与便签各一份），宿主自己算就是**第五个**，症状是"眼睛在第 3 行、选中跳到第 5 行"而两边都不报错。`search` 与 `trash` **刻意不进表**（前者自己有一条走结果数组的光标，两边都响应同一个键 = 一次跳两格；后者的 ↑↓ 是"选恢复还是删除"，语义完全不同）。<br>**三道"不响应"，第三道是看图看出来的缺陷**：① 正在打字；② 有浮层（今天**三个真浮层分两种形状**：设置 `.ht-sheet`、搜索 `role="dialog"`+`aria-modal="false"`、法务二次确认 `role="dialog"` 且**不带**裸 `.ht-sheet` ⇒ 选择器只认一种就会漏）；③ 🔴 焦点落在 `[role="menu"]` / `[aria-haspopup="menu"]` 上。第三条的来路：K3 那张图的第一版里**账号菜单是开着的** —— Esc 关设置浮层时焦点按既有设计回到头像（`App.tsx:473-479`），而头像那颗按钮自己把 ↓ 用作"打开菜单"（`AccountMenu.tsx:299`），于是同一次按键**既弹菜单又把底下那栏的选中挪走**；菜单展开时同理，它的面板既不是 `.ht-sheet` 也不是 `role="dialog"`，第 ② 道挡不住。裁决是**焦点归谁、键就归谁**（反过来让列表光标赢会弄坏 `AccountMenu` 那条既有、且有用例的键盘入口）。<br>**判据 41 条分三层**（11:3x 起：宿主层 24→25，多的是视图全集那条分区判据，见 §8.41）：规则层 +9（空列表 / 没选中时两个方向各进列表 / 中间 / 两端夹住 / 单条 / 当前不在列表 / "只按传入顺序不自己排序"用故意倒序夹具钉 / 连按五次轨迹 / 纯函数不通知），该文件现 25 passed；宿主层 `apps/web/tests/keyboard-cursor.spec.tsx` **25 条**；真浏览器 `e2e/tests/keyboard-cursor.spec.ts` **K1–K7**（生产构建载体 `vite build` + `vite preview` 端口 4371）。<br>💥 **变异 22 臂全红**：jsdom 层 15 臂（B1–B15）红集**逐条点名** —— B1 环绕 2 红 / B2 进列表 2 红 / B3 自己排序 1 红 / B4 摘打字闸门 2 红 / B5 摘浮层闸门 2 红 / **B11 把浮层选择器缩到只剩 `.ht-sheet` ⇒ 恰好 1 红**（新加的 dialog 腿单独红，证明它不是把 B5 又量了一遍）/ **B12 摘"焦点归控件"闸门 2 红** / B6 去重 1 红 / B7 端点吞键 1 红 / B8 滚进视野 1 红 / B9 绑 `view` 1 红 / B10 摘掉 habits 那一行 1 红 / **B13 把真生产者（`packages/ui/src/notes/NotesBoard.tsx:294` 的 `testID`）改名 ⇒ 恰好 1 红，只红“前缀 ↔ 生产者”那一条** / **B14 把表里的 `note-row` 写成 `note-card` ⇒ 2 红**（那条 + notes 那一圈循环 —— 这一臂顺手把新判据存在的理由钉住了：**插出来的 DOM 抓不住表错**，它注入的是测试自己那份 `cases` 字面量） / **B15 把表里五处 `prefix: '…'` 的单引号换成双引号（运行时逐字等价）⇒ 恰好 1 红，且红在“解析出 0 项也算红”那句守卫上**（没有那句，前缀表一改写法这条判据就静默变成永真）。浏览器层 7 臂（C1 摘浮层 ⇒ K3 红 / C4 摘焦点闸门 ⇒ K5 红 / C5 摘打字闸门 ⇒ K2 红 / C2 端点环绕 ⇒ K1 红，C2 那条证明 e2e 这层走的确实是 app-host 的规则而不是宿主又算了一遍 / **C6 表里 `habit-row` 写成 `habit-card` ⇒ K6 红** / **C7 把 `notes` 那一行整个摘掉 ⇒ K7 红** / **C8 把便签编辑器当成浮层（往第②道闸门的选择器里加 `[data-testid^="notes-editor"]`）⇒ K7 红** —— C8 才是 K7 那句关键前提（“编辑器不算浮层，所以闸门不挡它”）的靶子：没有它，K7 只是在描述一个巧合）。每臂复原后 sha256 逐字节比对、`dist/` 目录摘要回到干净态（`BACK_TO_CLEAN=True`，干净摘要 `e0c768102d639a5e`），每臂都先打 `REACHED_ARTIFACT=True` 才有资格判红；并各跑一次"不复位也全绿"的阴性对照（jsdom 24 passed / e2e 7 passed）。<br>🔴 **两条"存活"要分开记，一条是判据缺口、一条本来就不该有牙**：① C5 头两趟存活 = 判据缺口，全过程与改法在 **§8.9 第 2 条**；② **C3（把绑定从 `contentView` 换成 `view`）预期存活且确实存活** —— 绑 `view` 时开着设置面板根本没人绑，K3 的负向腿白过，两道机制在浏览器上**不可区分**。所以"`contentView` 那条绑定"只有 B9 一处消费者（源码级断言），**不许声称浏览器层有它的牙**。它是真冗余还是真必要，取决于第②道闸门哪天被简化掉 —— 那之前这一行就是它的现状。<br>**门禁 9 道 RC=0**：`check:layering`（332 文件 9 规则）/ `check:selection-single-source`（词表 3 类全有消费者 task 10 / habit 7 / note 13，宿主内本地选中态 0 处）/ `check:l4`（web 98≤104、mobile **90 = 基线 90**，没动基线）/ `check:row-single-source`（**28 = 基线 28**，本单没新增顶层 `ht-*` 族）/ `check:design` / `check:ui-language`（zh 2864 = en 2864）/ `check:migrations` / token 生成物两步（tsup → `--check`，8 文件 204 token）。typecheck：电池里那六条**改成从各包自己的 `package.json` 取 `typecheck` 脚本**（五个包是 `tsconfig.spec.json`、`apps/mobile` 是 `tsconfig.json`），六条 RC=0、各日志里 `error TS` 计数 0；spec 版曾抓到一条真错误（见 §8.9 第 3 条）。🔴 上一轮记的“六包 `tsconfig.json` 与 spec 各 RC=0”里，**电池那六条其实是恒绿的虚检查**（命令字面量抄成了 `-p tsconfig.json`），本轮修的是电池本身，不是读数。另加两步 `apps/web` 重打（`tsc -b` + `vite build`）再跑 e2e 那一族 —— 该配置的 `webServer` 只有 `vite preview`、**不建**，不重打就是在验上一轮的产物（§7 第 212 条那一族）。电池因此从 24 步变 25 步（多一条 `typecheck e2e family`），整条电池 25 步 RC=0、`BATTERY_RESULT=ALL_GREEN`。全量单测 domain 834 / app-host 1020 / i18n 26 / ui 459 / web **1585 passed \| 12 skipped** / mobile 607；e2e 详情面整族 **25 passed**。<br>🔴 **`check:docs`（`docs-link-check`）RC=1，而那一条死链不在本单**：`PROGRESS.md:1362` → `docs/research/aed-implementation-evidence.md`。现量三件：那一行是 `96f3293d`（别的线）已提交的、目标文件**此刻只存在于主检出且未被跟踪**（`ls` 有 / `git show HEAD:` 无）⇒ 在任何干净检出里它必然是死链。处置是**登记不代改**（两种改法分别是"替别人提交他的在途文档"和"动他那一行"，都不归本单）。本单自己的文档改动零死链，复跑：`node research/tools/docs-link-check.mjs 2>&1 \| grep -c detail-pane-alignment` ⇒ `0`。<br>**截图 7 张，逐张打开看过**（`apps/web/evidence/keyboard-cursor/{k1-first-row-highlighted,k2-typing-row-unchanged,k3-cursor-back-after-closing-sheet,k4-quadrant-same-selection,k5-avatar-owns-arrow,k6-habits-cursor-aria-current,k7-notes-editor-follows-cursor}.png`）：k1 只有第一行带浅蓝底；k2 输入框里是"正在打字"且带焦点环、高亮停在**中间**那一行；k3 关掉浮层后**菜单没弹**、第二行带蓝（= 光标回来了）；k4 切到四象限还是同一条；k5 是那条缺陷的**修复后**读数 —— 菜单开着、头像带焦点环，而底下第一行仍带着高亮（= 一次按键只发生一件事）；k6 里三行习惯只有第一行「光标甲」带**蓝框 + 浅蓝底**、右窗格开的正是它（两种线索同一行，且那是夹住后的第 0 行）；k7 里编辑器开在板子**上方**（不是浮层），内容是「便签光标乙」，而下面两张便签卡**没有任何选中痕迹**。看图另照出一件**拍不出来**的事：`.ht-sheet` 的底色是 `color-mix(in srgb, var(--ht-color-background) 95%, transparent)`（`sheets.css:27`，那里自己写明"下层可见"的判据是 DOM 里标记仍在），95% 浓度下"浮层底下那一行没动"在像素上量不出来 ⇒ K3 的前半由断言证，图证只给它配套的那一半（关掉之后还在）。<br>**边界（别读多）**：① 三条腿只落了第一条，另两条等拍板 #1 / #8（`App.tsx:2532` 今天只有 `contentView === 'focus'` 一支，任务/习惯/便签那一栏里**没有可换的东西**）；② **接线只落了 web** —— 规则在 app-host，触屏端仍走"点一行"，移动端目前没有键盘光标这回事，别把这一行读成三端都接了；③ 🔴 **本轮闭合**（载体 `4b17213a`）：新增 `e2e/tsconfig.detail-pane.json`，编译器**借 `../apps/web/node_modules/.bin/tsc`** —— 不在 e2e 里装 typescript（那要过 AGENTS §3.1/§3.2 两道门，还会写进主检出那份**共享的** `e2e/node_modules`）。它第一趟就抓到本单自己的一处类型谎：`onlyHighlighted` 声明返回 `{at, title}` 而 `return` 里塞着 `id`，调用方靠 `as` 硬掰 —— 而跨投影那条判据（K4）比的正是 `id`。`include` 只圈本单六个文件：同一趟对 `tests/*.ts` 全量跑现量 **13 条错误分布在另外 6 个文件**（`calendar-cells` 5 / `calendar-week` 3 / `quadrant-fill` 2 / `task-row-touch-target` 1 / `search-overlay` 1 / `due-date-edit` 1），那是别的线在飞的活，**不吸收进来凑绿**（收进来只会得到“这道检查天生是红的”）。能不能失败也量了：真代码 RC=0 / 0 条错误，注入一句 `press(page, 'ArrowRight')` ⇒ RC=2 且精确报在那一行；④ 未做四端重装；⑤ ⚠️ 本 worktree 的 `node_modules` 与 `e2e/node_modules` 是指向主检出的**软链**，而 `.gitignore` 写的是 `node_modules/`（带斜杠只匹配目录）⇒ 它们在 `git status` 里是 `??`，**在这个检出里永远不要 `git add -A`**；⑥ 🔴 **上一轮这条边界写错了，撤回**：它写的是“web 上没有建习惯、建便签的入口，本轮做不到”，现量两处都在 —— `HabitsView.tsx:275` 的新建 `<input>`（`<form>` 在 268）与共享 `NotesBoard` 的 `notes-input` / `notes-submit`（`packages/ui/src/notes/NotesBoard.tsx:241-264`）。**错法值得记**：那句是按“模块开关默认关掉便签”的印象写的，没去读那两个视图的组件本体 —— 与 §8.9 第 4 条同族，新的是它的方向：**“没有某个入口”也是一条断言**，写它要过和写 `file:line` 同样的门槛。补上的是 K6 / K7 两条真浏览器判据（载体 `1dd23d25`，三臂 C6/C7/C8 各红在指定那一条），所以这一栏现在写的是**已证**而不是边界；⑦ e2e 那一族重跑会**改写别的单的三张 evidence png**（本轮：`detail-column-slot/no-sidebar-view.png`、`focus-detail-pane/f1-four-cards.png`、`focus-detail-pane/f5-aborted-record.png`，各差几字节），已 `cmp` 后 `git restore` 还原 —— 记下来是让下一轮别把它们当成自己的改动提交；⑧ 🔴 **K4 有一次只在并行时红过**（“切到四象限后高亮行数 = 2”），单独跑 3 次、整份文件再跑 4 次都没复现 —— **未定性**，不写成因也不改松判据；处置是把每行的 `{bg, near}` 读数打进断言消息（`test-results` 每次重跑会被清掉，快照不是可留存的证据 —— 这一次想回查时已经被我自己的复跑删掉了）。下一轮再红就直接读消息里的容器；⑨ **便签面上的选中没有可见痕迹**（K7 看图照出来的，不是推断）：`NotesBoard` 的行不带 `aria-current`、也没有换底色，光标每按一次的唯一可见后果是**上方编辑器换内容**。这条**不在本单动手** —— “选中该在便签面上产生什么”正是拍板 #1 的题面（`selection.select('note', id)` 今天同时就是“打开编辑器”），改法已量过：给共享 `NotesBoard` 加一个默认值等于原行为的可选 prop（`selectedId?`），与本仓 mobile 侧那条正解同形，代价是零消费者改动。 |
| W1c 选中痕迹统一（本轮新增的子单） | ✅ 已完成（2026-10-04 08:4x；四端重装仍随 W1/W1b 那批一起挂着，见 §8.14，**第七次读数与合流面见 §8.24**） | 见下面 **§8.22** —— 它是从拍板 #1 里拆出来的**缺陷**，不是选择题（同 W8a 那一刀的拆法）。覆盖面逐处现量、两种无障碍通道与那处该豁免的面在 **§8.26**；🔴 那一趟留下的"目前只有一次性判据在顶"这句**已过期**：常驻化落在门禁的**断言 F**，四处面 + 九臂见 **§8.37**（2026-10-04 10:5x）。🔴 **判据条数与变异红集此前这格里没有**（18:5x 由新的腿 7/8 照出来并现量补上）：判据 **10 条** —— 新增 `apps/web/tests/notes-selection-trace.spec.tsx` 9 条 + e2e `K8` 1 条（条数按定义处现取：`grep -cE 'it\\(\|test\\(' 该文件`）。变异**九臂**（`research/tools/mutation-rigs/mutate-selection-f.mjs`）的红集里最要紧的一条不是"九臂全红"，而是 **H4 第一趟存活**：把谓词换成常量 `true` 时门禁当时全绿 ⇒ 补上裸名分支（`detailId\|selectedId\|editingId`）后同一臂**转红**，逐臂预期与实测在 §8.37 那张表里 |
| W2 | 🔄 **进行中**（槽位、判据、五臂变异、八张图逐张看过、十道门禁都闭合；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | 载体 `feat/detail-pane` = `0c159f7f`（前置那笔 `0de58095` 是探针修复）。**落点与裁决**：详情列是 `.ht-app` 的**第四个轨道**、与 `<main>` 平级，不是 `.ht-content` 里的第二栏 —— `.ht-content` 自带 `max-inline-size` + `margin-inline: auto`，挂进去的列永远贴不到窗口右边缘，观感就不是"三栏 + 右详情"。轨道 `--ht-detail-track` **只在 `.ht-app` 上算一次**，两轨/四轨两条 `grid-template-columns` 各自拼它（抄两遍就会漂），塌缩态覆盖这个变量而不是重抄声明。**今天这一列是空的**，这是设计不是半成品（原话："即使没东西也空在那里"），往里放什么阻塞在拍板 #1/#8。token 三枚新增（`--ht-layout-detail-{width,min-width,max-width}` = 22/18/30rem）+ `--ht-layout-content-max` 的**语义**改成"中间列上限"（值没动），5 份生成产物同步。⚠️ 上下限今天**只是 `clamp()` 的两端，没有拖拽手柄** —— 别以为已经能拖。<br>**判据 3 条**（`e2e/tests/detail-column-slot.spec.ts`，生产构建载体 `vite build` + `vite preview` 端口 4358）：① 右边缘 == 视口右边缘（±1px）**且**中间列不贴边（只断言前者挡不住"两边一起缩进去"）；② 它是 `.ht-app` 的直接子项（几何成立的那条机制）；③ 宽度**等于** token 给的像素值 —— 阈值由 `pxOfCssVar` 从页面现读，不抄 rem→px，且先断言区间非退化。🔴 第一版这里写的是"落在 [min,max] 区间内"，那是**恒真判据**：轨道就是 `clamp(min,width,max)` 算出来的，任何越界值都被夹回区间。换成等值判据才有牙。<br>💥 **变异 5 臂，每臂复原后逐字节比对并复跑回 3 passed**：M1 把列搬回 `.ht-content` ⇒ **2 红**（两条视图各红在右边缘，读数 `904 没贴到 1280`）；M2 两轨那条不走 token 写 `24rem` ⇒ **1 红**（`384 ≠ 352`）；M5 共用的 `--ht-detail-track` 整体不走 token ⇒ **2 红**而窄档那条**仍绿**；M3 摘 769–1023 收起 ⇒ 红在 900 那一句；M4 摘 ≤768 收起 ⇒ 红在 700 那一句、900 仍绿。🔴 **M2 的第一版是存活的（2 passed）**：那时两条用例都停在带侧栏那一面，生效的是四轨声明，**两轨那行零判据** —— "两条都绿"读起来像"宽度判据有牙"，其实是同一行声明量了两遍。第三条用例就是这条存活臂换来的（§8.3 第 4 条）。<br>**门禁 10 道 RC=0**：`check:design` / `check:row-single-source`（`ht-*` 前缀族 **28 = 基线 28，未新增** ⇒ 命名走 `.ht-app__detail` 而不是新起一族，先例 `.ht-content__calendar-host`）/ `check:l4`（web 98≤104、mobile 90=90，**没调基线**）/ `check:layering` / `check:ui-language` / `check:selection-single-source` / token 产物 `--check`（8 文件 204 token）/ design-system 489 tests / `check:server-design`（41 个，布局 token 不上服务端）/ `check:arkts`（真编译器过）。<br>**截图**：新增 3 张（`desktop-with-detail` / `no-sidebar-view` / `back-to-desktop`）+ W1 那 5 张因布局多了 352px 而整体重跑，**八张逐张打开看过**：详情列在两张视图里都是窗口右边那条带发丝分隔边的空白列；选中那条在列表/四象限/时间线/搜索里仍是唯一带浅蓝底的一行。看图另照出一件断言看不见的事：`parkCursor` 第一版落点 `(640,40)` **恰好压在顶栏「同步」按钮上**，那张证据图里那个按钮带着 hover 环 ⇒ 改成按视口算右下角并移进 `helpers.ts`（`0de58095`）。<br>**边界（别读多）**：窄档今天只有**宽度**条件，"看高也看宽 + 收起按钮 + 三条恢复路径 + 持久化"是 W4；这一列里放什么是"详情面本体"那一单（拍板 #1/#8）。⚠️ 未做四端重装，窗口判据同 W1 那行。⚠️ 本 worktree 的 `node_modules` 与 `e2e/node_modules` 是指向主检出的**软链**，而 `.gitignore` 写的是 `node_modules/`（带斜杠只匹配目录）⇒ 它们在 `git status` 里是 `??`，**在这个检出里永远不要 `git add -A`**。**截图产物（入库的只有这三枚）**：`apps/web/evidence/detail-column-slot/{desktop-with-detail,no-sidebar-view,back-to-desktop}.png`；本格上面那句「八张图逐张看过」是 09:5x 那一趟的**看图数**，其余几张没有入库产物可对应（**未核实它们在哪儿**，所以本行只登记入库的三枚，不拿"八张"当证据） |
| W3 | 🔄 **进行中**（决定已钉死、三臂各红在指定那一条、两张图人看过；只剩 §6.1.1 四端重装） | **零 CSS 改动** —— 这不是没做，是量出来的结果就是工单取的默认值："设置浮层不盖第四列"（几何上根本不相交），"搜索浮层盖满视口但透出下层"。决定本身分**三种机制**达成，所以判据也必须写成三种：<br>① `.ht-sheet` = `absolute; inset:0` 挂在 `.ht-content` 里 ⇒ 与详情列**盒子不相交**（第四列是 `.ht-app` 的直接子项，在它外面）；② `.ht-search-overlay` = `fixed; inset:0`（2026-10-01 为"一开搜索列表跳回顶部"那个缺陷改的）⇒ **相交**，靠 `--ht-material-scrim` = `rgb(15 23 42 / .32)` 半透明透出；③ 模态层 `.ht-sheet__reconfirm` / `.ht-trash__overlay` 也是 `fixed; inset:0` ⇒ 盖一切，**这是对的，不判**（登记在下面那条枚举里）。<br>🔴 **判据一律写成盒子相交，不写 `toBeVisible()`**：被浮层整个盖住的元素照样 visible（Playwright 的 visible = 有盒子且非 `visibility:hidden`），那条会绿在"详情列已被盖死"的界面上。<br>**判据 2 条**（`e2e/tests/detail-pane-overlay.spec.ts`）：每条都配**正向对照**（设置那条先断"浮层确实盖住了 `.ht-main`"，否则"不盖详情列"在浮层压根没渲染时也成立 = 恒真）；搜索那条同时钉"它盖到详情列"（决定变更要回来改判据并说明理由）与"scrim 的 alpha **在 0 与 1 之间**"（下界不是凑数：alpha=0 等于没有 scrim，"透出"就成了空话），外加列宽仍等于 token、右边缘仍贴视口。<br>**变异三臂**（每臂重新 `vite build` 再跑、复原后逐字节比对、复跑回 2 passed）：N1 `.ht-sheet` 改 `fixed; inset:0` ⇒ 1 红，读数 `sheet 右边缘 1280 vs 详情列左边缘 928`；N2 scrim 的 alpha 改 1 ⇒ 1 红 `alpha=1 不小于 1`；🔴 **N3 打的是防作弊机制自己** —— 把浮层缩成左上角 4rem 小块 ⇒ 红在**正向对照**那句（`连中间列都没盖住…这条就成了空判据`）。三臂里未触碰的那条用例每臂都仍绿。<br>**既有判据继续绿**：`apps/web/tests/settings-sheet-ia.spec.tsx` + `search-overlay-ia.spec.tsx` = **8 passed / 0 failed**（W2 改布局之后重跑的）。<br>**整屏/浮起层的完整枚举**（`grep position: fixed apps/web/src/styles/`，6 处，别再重新推一遍）：整屏非模态 1（`.ht-search-overlay`）、内容区内 1（`.ht-sheet`，是 `absolute`）、模态 2（reconfirm / trash overlay，`fixed; inset:0` + `--ht-z-modal`，**盖一切是对的**）、锚定小面板 3（`.ht-inbox__panel` / `.ht-accountmenu__panel` / `.ht-rail__label`，不参与"盖不盖列"这个问题）。<br>**截图 2 张**（`apps/web/evidence/detail-pane-overlay/{settings-sheet,search-overlay}.png`）**都打开看过**：前者设置面盖住中间列、下层"收集箱"字样淡淡透出、**右侧详情列完全不被染色**（发丝分隔边清楚）；后者整屏被 scrim 压暗，rail / 侧栏 / 详情列一起变灰但仍读得出来，卡片贴顶居中。⚠️ 未做四端重装。 |
| W4 | 🔄 **进行中**（出现条件、收起、三条恢复路径、持久化、判据、十一臂变异、十一张图逐张看过、八道门禁都闭合；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | 载体 `feat/detail-pane` = `dbb3a297`。<br>**落点与裁决**：① 出现条件从"只看宽度"补成**两根轴** —— 高度档按调研 A1 引的 Android 窗口尺寸类取"Compact = 高 < 480dp"（`narrow.css` 新增 `@media (min-width:1024px) and (max-height:479px)`），且**不可行时开关与列一起 `display:none`**（留一颗点不动的按钮 = 界面在说谎）。🔴 第一版把阈值写成 600 并配了一句看起来最有道理的理由，被回读原文否证 —— 全过程与纪律写在 **§8.6**。② 收起态是**设备本地**偏好，不进 op-log（把笔记本的收起状态同步给手机是错的）；词表与读写收在 `apps/web/src/features/shell/detail-pane-pref.ts` 一处，`'open' \| 'collapsed'` 之外的值退回默认、`localStorage` 抛异常时不抛给用户。③ 恢复留**三条各自独立**的路：页头那颗按钮 / 设置里那一项 / ⌘Ctrl+Shift+`\`（选 `\` 不选字母：字母档已被 ⌘K、⌘N 一类占掉）。<br>💥 **本单载体照出一个 W2 就存在、当时没有任何一层在量的缺陷**：`.ht-header__actions` 是 `flex: 0 0 auto`（"不许压窄"），往里加一颗按钮就把最右边顶出视口 —— 1280 宽日历面实测 `scrollWidth 870 > clientWidth 624`，而**症状不是报错，是那颗按钮在 DOM 里点不到**（90s 超时）。两版失败尝试都记在注释里：只在 `.ht-header` 加 `flex-wrap` ⇒ 溢出 922→870 仍在；两处都加 ⇒ **读数一字没变**。卡住的是同一个机制：**不可收缩的 flex 子项，已用宽度 = max-content，它自己那一层的 `flex-wrap` 永远不会触发** ⇒ 三件一起改（`0 1 auto` + `min-inline-size:0` + `wrap`）。既有门 `calendar-cells.spec.ts:107` 从这轮起才真的站在这条修法上。<br>**判据 23 条**：`apps/web/tests/detail-pane-collapse.spec.tsx` 16 条（A 词表模块：默认值/往返/7 个非法值/`getItem` 抛异常仍退默认**且恢复后正向对照读到值**/存储形状；B 页头开关的 aria 方向与"DOM 属性 + 存储"同时变；C 设置项播种后读回、选中的必须是那一只、说明句含"太窄/太矮/快捷键"；D 真 `KeyboardEvent` 四条负对照：缺 shift / 缺修饰键 / 键换成 `x` / 带 alt；E **存储单一所有者**：全树扫 `src` 只许那一个文件碰这个键）+ `e2e/tests/detail-pane-collapse.spec.ts` 7 条（T1 高度边界**两侧都量**、T2 承重那句"收起后 `.ht-main` 右边缘 == 视口右边缘"再叠一次刷新、T3a/b/c 三条恢复路径各走各的（T3c 从真键盘发两次 = 双向）、T4 三种不可行视口里开关与列一起消失且每档都先正向对照"应用渲染出来了"、T5 页头不溢出 + 开关 `toBeInViewport()` + **每只页头控件保住自己的自然宽度**）。<br>💥 **变异 11 臂**：M1 高度那块永不匹配 / M2 479→480 / M3 收起态选择器改名（轨道没归零）/ M4 快捷键键名永不匹配 / M5 `saveDetailPane(value)` → `void value` / M6 M7 从高度块与 769–1023 块里各摘掉 toggle 那一半 / M8 `data-detail` 改名 / M9 去掉词表成员校验 ⇒ **红 9/9**，红集逐臂为 M1–M3 e2e、M4/M5/M8 e2e+web、M6/M7 e2e、M9 web。<br>🔴 **M10、M11 是页头那处修法的两条腿，而 M11 第一趟存活**：M10（动作排改回 `0 0 auto`）红在**两扇门**（本单 T5 + 既有门 calendar-cells 2 红，读数 `870 > 624`）；M11（允许收缩但不折行）**collapse 7 passed + calendar-cells 4 passed —— 全绿**。那一趟它确实该活：不折行时既不溢出、开关也在视口里，三句判据一句都碰不到，而被压扁的是图标按钮 **52→32px**、语言 chip **40→29px**。⇒ 这一行 `flex-wrap` 当时是**一行没人守也没人摘的声明**。处置不是"记成债"，是先量它承不承重：在同一次加载里用 CSSOM 原地切 `flex-wrap` 做 A/B（不重建 dist，逐控件读 `rendered` vs 临时 `width:max-content` 的 `natural`），读数坐实"压扁"之后补了 T5 第三句（**宁可换行，不许把点击区压窄**；阈值不抄常量 —— 抄 44 会既挡不住 32 又误杀 40 那只 chip），**复跑 M11 才红在 `日历面 1280×720：这些页头控件被压扁了`**（1 failed \| 6 passed，CSS 逐字节复原 + 干净重建）。教训落在 **§8.7**。<br>**门禁 8 道 RC=0**：`check:design`（无硬编码）/ `check:l4`（web 98≤104、mobile **90 = 基线 90**，没动基线）/ `check:row-single-source`（`ht-*` 族 **28 = 基线 28**，新类名挂进既有族 `.ht-app__detail-toggle`）/ `check:layering`（330 文件 9 规则）/ `check:ui-language`（zh 2855 = en 2855，逐条中英同步）/ `check:selection-single-source` / token 产物 `--check`（8 文件 204 token）/ i18n 26 tests。`apps/web` 全量单测 **1552 passed \| 12 skipped**（112 文件），e2e 详情面整族 **12 passed**、`calendar-cells` **4 passed**。<br>**截图**：新增 6 张（`apps/web/evidence/detail-pane-collapse/{t1-height-boundary-back,t2-collapsed-no-gutter,t2-still-collapsed-after-reload,t3b-settings-option,t4-toggle-gone-when-infeasible,t5-header-with-toggle}.png`）+ W2/W3 那 5 张因页头多一颗按钮而整体重跑，**十一张逐张打开看过**：收起态右边**没有那道 22rem 死空白**（内容铺到窗口右边缘）、479 高那一档开关与列一起没了、设置里"常驻/收起"两只单选跟着说明句一起出现。看图另照出两件断言看不见的事：① `t2-collapsed-no-gutter` 与 `t2-still-collapsed-after-reload` **md5 逐字节相同** —— 刷新前后长得一样正是"持久化生效"该有的样子，但这也说明这两张里只有前一张在证"渲染"、后一张只证"没被重置"；② **1024 那一档页头要吃三行**（实测 182px 高，占 720 视口的 25%）—— 不溢出、点得到，但"详情列在 1024 就常驻"这个档选得是不是太早，登记给拍板 #1（它决定这一栏里放什么，也就决定它值不值 352px）。<br>**边界（别读多）**：dp→CSS px 取 1:1 是**刻意的近似**（浏览器没有 dp）；`data-detail` 只表达**用户选择**，不表达几何可行性（两件事分两层，混起来就会出现"用户没关而它没了"）；未做四端重装；⚠️ 本 worktree 的 `node_modules` 与 `e2e/node_modules` 是指向主检出的**软链**且 `.gitignore` 写的是 `node_modules/`（带斜杠只匹配目录）⇒ `git status` 里是 `??`，**在这个检出里永远不要 `git add -A`** |
| W5 | 🔄 **进行中**（代码链、三层判据、六臂变异、三张图逐张看过、十七道 RC=0 都闭合；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | 载体 `feat/detail-pane` = `84d5bd86`（15 文件 / +705）。**这一单真正搬走的是"颜色"那半边判断，不是新加一个控件。** 之前 `priorityColorToken` 在 `apps/web/src/features/tasks/priority-display.ts` 与 `apps/mobile/src/lib/priority.ts` 各有一份**逐字相同**的实现，两份的文件头都写着"`packages/ui` 依赖不了 `@heyta/i18n` ⇒ 共享不了" —— **那句话只对文案那半边成立**：档位 → 色 token 名只需要 `Priority`（`@heyta/domain`，`packages/ui` 早就依赖）。于是"复选框描边即优先级"（调研 A2 那条"最值得抄"）一直没人能落地，因为**行组件够不到那份映射**。现在唯一所有者在 `packages/ui/src/task-list/priority-color.ts`，`TaskRow` 用 `row.source.priority` 查它给 `box` 上色，两份镜像**删掉**（AGENTS §3.5：抽取的收尾是删旧那份 + 加门禁，不是再写一份更好的）。<br>🔴 **预期差在哪**（这条改了视觉，所以判据里不许出现"改前后逐字节相同"那类零视觉断言）：高 `color.border-strong`(slate-300) → **`color.priority-high`**(light #dc2626 / dark #f87171)、中 → `priority-medium`(#b45309 / #fbbf24)、低 → `priority-low`(#0284c7 / #38bdf8)、**无优先级/字段缺失** → `priority-none`(#94a3b8 / #64748b，比原来那圈略深，仍是中性灰)、**已完成不变**（主色实心 + 主色描边 + 白勾）。<br>**判据 15 条，分三层**：① `packages/ui/tests/task-row-priority.spec.ts` **11 条** —— 映射穷尽（含 `undefined` 与 `None` 同值、档位清单从 `Priority` 现取不抄字面量）、四个 token 名在 light/dark 两张表里**真的存在**、三档取值两两不同 × 两个主题、`none` 不与任何一档撞色、dark 与 light 四枚全不同值（"暗色实际切了看"的数据层证据）、源码级（`TaskRow` 必须 `priorityColorToken(row.source.priority)` 且 `styles.box` 里**不许**再有 `color.border-strong`）、逐行色排在 `box` 之后 `boxDone` 之前、**全仓只有一份定义**（遍历 `apps/`+`packages/` 源码，跳过 `node_modules`/`dist`/`dist-types`；刻意不用点名清单 —— 点名挡不住"在第四个文件里再写一份"）；② `apps/web/tests/row-meta-shared.spec.tsx` 的 A 组换了一条**行元信息画的是共享映射的取值、而且不串档**（jsdom 里 `cssColor()` 探针把 token 取值过一遍这台 jsdom 自己的序列化，不拿 hex 去 `toContain`），D 组那条"两边 token 名一致"**原地改写成新不变量**（原来那句在抽取后**不可能失败**，留着就是装饰）：宿主里不许再有 `color.priority-*` 与 `function priorityColorToken`，三个消费者必须从 `@heyta/ui` 取；③ `e2e/tests/task-priority-checkbox.spec.ts` **3 条**真浏览器 —— 优先级经**真的在捕获框里打 `!1/!2/!3`** 写进去（输入框占位文案就写着「可写『明天』『下周三』『!1』」），每条先断**徽章在场**（那是载体前提，不是产品判据），再断四行描边**各等于该 token 在当前主题下的解析值**（`colorOfCssVar` 页内探针，不抄色值）**且两两不同**，第三条 `data-theme==='dark'` 正对照后同样量一遍。<br>💥 **变异 6 臂，逐臂复原 + 字节比对 + 收尾重建两个 dist**：A1 描边写死回中性色（工单点名的那条）⇒ `ui` + `e2e` 红；A2 `undefined` 改投 High ⇒ `ui` 红；A3 摘掉 `boxDone` 的描边 ⇒ `ui` + `e2e` 红；A4 在 web 宿主里再写一份定义 ⇒ `ui` + `web` 红（两道"抽取收尾"门各抓一次）；A5 逐行色排到 `boxDone` 之后 ⇒ `ui` 红；A6 `High` 指向 `medium` 的 token ⇒ `ui` + `web` + `e2e` 红。**如实记哪层没抓到**：A1/A2/A3/A5 在 `apps/web` 那一趟**是绿的** —— 那一份判据量的是徽章那条通道，勾选框不在它范围内，这不是漏判，是分层；勾选框的渲染层读数只有 `e2e` 那一层有。<br>**门禁与测试 17 项 RC=0**：`check:design` / `check:row-single-source`（`ht-*` 族 **28 = 基线 28**）/ `check:l4`（web 98≤104、mobile **90 = 90**，**没调基线**；`packages/ui` 本来就在 L4 门外，见该脚本第 24 行）/ `check:layering` / `check:ui-language` / `check:selection-single-source` / `check:ui-provider` / `check:rn-aria` / `check:licenses` / `check:docs-voice` / token 生成 + `--check` / 全量测试 **ui 453 · web 1524（12 skipped）· mobile 604 · design-system 489，零失败**；`packages/ui` 改完先 `tsup` 再跑判据（工单 §1 闸门 4）。<br>**截图 3 张**（`apps/web/evidence/task-priority-checkbox/{light-four-tiers,dark-four-tiers,light-done-overrides-priority}.png`）**逐张打开看过**：亮色四行的圈分别是红/琥珀/天蓝/中性灰，且**只有前三行带徽章**（"没有优先级不是信息"那条纪律没被破坏）；暗色同样四色且都读得出来（`#f87171`/`#fbbf24`/`#38bdf8`/`#64748b`）；完成那张是**实心主蓝 + 白勾**，优先级没有盖过"做完了没有"。<br>🔴 **看图照出、断言看不见的一件事**：默认 720 高的那张图里**只有三行** —— 第四行"无优先级"在折叠线下面（AI 面板占了半屏，那是 `enableAllModules` 的结果）。判据量四行而证据图只有三行 = 图与读数不对齐，所以本套件自己 `test.use({ viewport: 1280×1000 })`。<br>**边界（别读多）**：① 描边**不是也不许变成唯一通道** —— 颜色对色觉障碍用户不成立，所以行内那枚**带文字**的徽章必须留着（描边管"扫一眼"，徽章管"读得准"）；删徽章是另一个产品决定，不是这一单的副产品。② 移动端与桌面三壳用的是**同一个** `TaskRow` ⇒ 四端同时受益，但 `apps/mobile/tests/` 里 **0 个用例 render 组件**，所以 RN 侧没有渲染级判据，那一层的证据只有 §6.1.1 的四端重装 + 模拟器截图，**本轮未跑**。③ 未 push 未 merge。 |
| W6 | 🔄 **进行中**（代码链、六层判据、十一臂变异、三张图逐张看过、七道门禁 RC=0 都闭合；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | 载体 `feat/detail-pane` = **`ca2cf606`**（17 文件 / +1101 −24）+ **`577c0f3e`**（判断层那 6 条被我第一笔点名路径漏掉了，单独补了一笔 —— ⚠️ 记下来是为了让后来者别把"提交过了"读成"那一笔就是全部"）。<br>**这一单真正动的是"几格"这个数从数据走到界面再走回数据的那条通道**。`HabitLog.value` 在数据层无处不在（reducer 物化它、`isAchieved` 按它判达成、AI 那侧也能传），唯独**没有任何界面能写出 5**：主按钮一键记满 `target` ⇒ "每天 8 页、今天读 5 页"只能记 8，而界面长得和"做完了"一模一样。<br>💥 **抽取时照出来的两个真缺陷**（不是重构副产物，是先已存在的错）：① "这条记录算几格"有**三份断面**（`isAchieved` 缺省落 `target`、`completionRatio` 缺省落 **0**、移动端详情自己写 `?? target ?? 1`），症状是同一条没写量的记录**同时**"算达成"和"完成度 0%"，两边都不报错 ⇒ 唯一所有者现在是 `packages/domain/src/habit-streak.ts#habitLogValue`，两个领域函数都读它，第三份断面删掉（AGENTS §3.5 的收尾是删旧的，不是再写一份更好的）；② `target: 0`（"一次都不碰"那档）的缺省原来是 **0**，而 `atMost` 按 `value <= target` 判 ⇒ **破戒被记成守戒**，缺省改成 1 并钉成判据。<br>**工单三条判据的读数**：① 目标 8、界面点出 5 ⇒ 落盘 UPD `value=5` 且显示 `今天 5/8 杯`，`page.reload()` 后仍是 5（这条才是"落盘"，不是"状态变了"）；② 不传 value **逐字旧行为** —— 主按钮调用处仍是 `onCheckIn(row.habit.id)` 一个实参，已打卡且没给新值 ⇒ **零 op**（幂等纪律没被削弱，且比较的是 `habitLogValue` 的**有效值**不是原始键：先用 `engine.dispatch` 直接塞一条没写量的 HABIT_LOG，再 `checkIn(id, DAY1, 8)` 必须仍返回 false）；③ 撤销仍走 `OpType.Delete` 而不是记一条 0（「−」减到 ≤0 时改调 `onUndoCheckIn`）。<br>**判据 47 条，分六层**：`packages/domain/tests/habit-amount.spec.ts` **13**（缺省表 + `target∈{1,8}×三种 goalType` 的"两个函数读成同一个数"穷举循环 + 源级不许出现第二个缺省）；`packages/app-host/tests/habit-actions.spec.ts` **+10**（套件 42）；`packages/ui/tests/habits-model.spec.ts` **+6**（36，`todayValue` 四张表 + `hasCountableGoal` 六种合法组合）；`apps/web/tests/habits-board.spec.tsx` **F 组 12**（27，含源码级：主按钮必须单实参、步进必须带 `row.todayValue + 1`、不许用 `Math.round(todayRatio*…)` 反算格数）；`apps/mobile/tests/habits-display.spec.ts` **+3**（18，含与 web 的 `common.habits.amount.*` **键集对等**）；`e2e/tests/habit-counted-amount.spec.ts` **3**（真浏览器，含暗色腿）。<br>💥 **变异 11 臂（W6-M1…M11），红 11/11，每臂复原后逐字节比对 + 收尾重建四个 dist**：M1 摘掉"缺省落 target"（**工单点名的那一条**）⇒ `app-host` 红；M2 同值也发 UPD ⇒ `app-host`；M3 比较键不比较有效值 ⇒ `app-host`；M4 写入侧校验摘掉（0/负数/NaN 静默落盘）⇒ `app-host`；M5 缺省落 1 不落 target ⇒ `domain`+`app-host`+`ui`；M6 `completionRatio` 自己写回 `?? 0` ⇒ `domain`；M7 数量行对所有习惯都出现（默认那条会长出「1/1」）⇒ `ui`+`web`；M8 判据写回 `> 1` ⇒ `ui`+`web`；M9 主按钮开始带值 ⇒ `web`；M10 宿主漏透传第三参（步进器画出来了、点了没反应）⇒ `web`；M11 新词条 zh 变纯占位符 ⇒ `check:ui-language` 那道层红。<br>🔴 **如实记哪层没抓到**：M1 在 `apps/web` 那一趟**是绿的** —— jsdom 层永远传显式 value，缺省那条路只有 `app-host` 与 e2e 真走；M10 只红 `web` 不红 `mobile`，因为 `apps/mobile/tests/` 里 **0 个用例 render 组件**（同 W5 那行登记过的边界）。<br>🔴 **我这把判据自己被照出来的两个洞**（都当场改掉并把原因写进注释）：① `hasCountableGoal` 第一版写成 `target > 1` ⇒ `target: 0.5` 那类小数目标**整行不显示**，被 F5b 那条界面用例抓红（"按钮不存在 ⇒ 点击没反应"会让断言双双假绿，所以 F5b 里加了 `expect(row).not.toBeNull()` 正对照）⇒ 判据改成 `!== 1`，合法域由 `setHabitGoal` 决定（它只拦负数与非有限数）；② e2e T2 第一版写 `toHaveAttribute('aria-disabled','false')` ⇒ 真浏览器红，因为 RNW 在**启用**时根本不写这个属性（缺席 ≠ false）⇒ 改 `not.toHaveAttribute('aria-disabled','true')`；③ 还有一条假红是我自己的：源级判据把 `completionRatio` 的 **docblock** 里引用禁令字面量那句话当成了违规 ⇒ 判据前先剥注释。<br>**截图三张**（`apps/web/evidence/habit-counted-amount/{light-five-of-eight,light-after-undo-and-full,dark-counted-row}.png`）**逐张打开看过**：第一张那行是 `今天 5/8 杯` 且**只有这一条习惯带数量行**（默认那条纯打卡习惯没长出「1/1」）；第二张是减到 0（回到"今天没做"、主按钮重新可读）再一键记满后的 `8/8 杯`；暗色那张字是前景色、`−`/`+` 两个步进按钮各有带习惯名的无障碍名。<br>**门禁七道 RC=0**（回填时刚复跑，2026-10-04 现量）：`check:layering`（329 文件 / 9 规则）· `check:row-single-source`（`ht-*` 族 **28 = 基线 28**）· `check:selection-single-source`（词表 3 类全有消费者）· `check:l4`（web **98 ≤ 104**、mobile **90 = 90**，**两道余量为 0 的棘轮都没调基线**）· `check:ui-language`（zh 2849 / en **2849** 条，中英同步）· `check:design` · token 产物 `--check`（8 文件 204 token，本单**没动 tokens.css**）。<br>⚠️ **提交信息里那句"判据 34 条"是过期读数**（写于 F 组补齐之前），现量是 **47 条 / 六层**，按上面那行拆开对账 —— 以本行为准。<br>**边界（别读多）**：① 步进是**固定 1 格**、加不封顶（记 10/目标 8 就显示 10，比例那条腿仍被 `Math.min(1,…)` 截断 —— 两个字段刻意不等价）；② 单位为空时句子回落到既有 `web.habits.goal.defaultUnit`，没有新造词条；③ `HabitGoalEditor` 提交后不收面板 = **既有行为**，本单没动；④ 真机/模拟器**未跑**（RN 侧无渲染级判据，那一层的证据只有 §6.1.1 的四端重装）；⑤ 未 push 未 merge。 |
| W7 | 🔄 **进行中**（读侧出口、四层判据、十二臂变异、三张图逐张看过、九道门禁 + 六包 typecheck/全量测试 RC=0 都闭合（🔴 **那句"九道门禁"是 9/56，不是全部门禁**：2026-10-04 的全量扫描当场照出第 10 道 `check:empty-state` 红在**本单自己新写的手写空态**上，已修 `edd9971b`，逐项归属与三臂读数见 §8.13）；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | 载体 `feat/detail-pane` = **`9bdab17e`**（24 文件 / +1258 −85）。**这一单动的是"记录从来没有被逐条画过"这件事**：`listSessions()` 唯一的消费者只做当日汇总，所以专注页右边一块记录都没有；而"今日专注时长"web 没有、mobile 有 ⇒ 判据 ③ 要的是**同一个出口**，不是两份长得一样的实现。新增 `packages/app-host/src/focus-overview.ts` 一个函数：当日 → `focusStatsForDay`、累计 → `activityTotalsFromState`（与里程碑/分享摘要同一个）、列表 → `listSessions()`（滤墓碑与排序的唯一所有者），界面拿到什么画什么。<br>🔴 **拆掉的两处会繁殖的东西**：① `ActivityTotals` 缺 `focusCount` —— 补上并钉住**段数不能由时长推出**（同样 50 分钟，一段与两段是两个读数），且与 `FocusDayStats.completedWorkCount` 同一条口径（只数 `completed === true`）；② `focus.ts` 里那个返回**写死中文**、零界面消费者的 `formatFocusDuration` 删掉（时长分档唯一所有者是 `durationParts`，词归 i18n）。web 新增 `FocusDetailPane`（四张卡 + 记录列表 + 空态一句话），mobile `FocusScreen` 改读同一个 `focusOverview` 并**删掉自己那份 sessions 状态**。<br>**判据 27 条 / 四层**：`packages/app-host/tests/focus-overview.spec.ts` **11**（真 `OpLogEngine` + `:memory:` SQLite；判据② 写成"条数 == `listSessions()` 里工作段条数"并带 `> 0` 正对照；新到旧、`endedAt` 归属、`actualMs` 退回 `plannedMs`、标题解析/缺失/任务删后仍在/幽灵 id）；`apps/web/tests/focus-detail-pane.spec.tsx` **9**（A 值随出口、B 行数==出口条数 + 空态 + 未关联 + 中途放弃只出现在未完成行、C **挂整个 App** 按可见文本点 rail 进专注面、D 源码级：剥注释后不许出现 `.reduce(` / `focusStatsForDay` / `computeActivityTotals` / `listSessions`）；`packages/domain/tests/motivation.spec.ts` **+1**（`completed` 整个缺失不算一个番茄）；`e2e/tests/focus-detail-pane.spec.ts` **6**（四张卡都在详情列**那一格的矩形内**、`tabular-nums` 取 computed style、空态那句话、与 W4 那颗开关收起/展开的接缝、**F5 真点「开始」→「中止」产出一条真 `FOCUS_SESSION` op ⇒ 界面多一行"中途放弃"而「今日番茄」仍是 0**、日历/习惯/时间线不许借这一格）。<br>💥 **变异 12 臂（W7-M1…M12），红 12/12，每臂复原后 sha256 逐字节比对 + 收尾重建 dist/产物**：M1 摘 `shouldPersistSession` 过滤 ⇒ 1 红（**工单点名的判据②**）；M2 `focusCount = round(focusMs/60000)` ⇒ 3 红（**工单点名的判据①**）；M3 去 `.reverse()` ⇒ 4 红（含"新到旧"）；M4 归属改 `createdAt` ⇒ 4 红；M5 `actualMs` 不退回 `plannedMs` ⇒ 4 红；M6 标题不解析 ⇒ 5 红；M7 `completed` 恒真 ⇒ 3 红；M8 `completed !== false` ⇒ **第一趟存活**（§8.8 第 4 条）；M9 摘掉 `contentView === 'focus'` ⇒ 1 红（C 组"默认那一面是空的"）；M10 界面自己 `reduce` ⇒ 1 红（D 组源码级）；M11 删 `font-variant-numeric` ⇒ 1 红（F2，量的是 computed style 不是源码里那行字）；M12 把 `.ht-rail__tab--active` 改到没人命中 ⇒ 1 红（F1 那条"视觉上高亮的格子必须就是当前视图"）。<br>**门禁九道 + 六包 typecheck + 六包全量测试 RC=0**：`check:design` / `check:l4`（web 98≤104、mobile **90 = 90**，**两道余量为 0 的棘轮都没调基线**）/ `check:row-single-source`（**28 = 28**）/ `check:layering`（331 文件 9 规则）/ `check:ui-language`（zh **2864** = en **2864**，9 条新词条中英同步）/ `check:materialized-reads`（26 屏）/ `check:selection-single-source` / `check:rn-aria` / token 产物 `--check`（8 文件 204 token，本单**没动 tokens.css**）；测试 domain 834 · app-host 1011 · i18n 26 · ui 459 · web 1561（12 skipped）· mobile 607，零失败。<br>🔴 **`check:design` 抓到我两处自拼排版**（xs+regular / sm+regular）：正解不是往 `PAIRED_TYPOGRAPHY_ALLOW` 加两行（那张表"只许删不许加"，加行就是繁殖第二套排版），而是回 `TEXT_STYLES` 找语义档位 —— `sm+regular+normal` 就是 `row-meta`、小标签就是 `caption`；顺手把同块里另外两条"只写字号+行高"的也整条消费掉，避免一个块里两种写法并存。<br>**截图 3 张**（`apps/web/evidence/focus-detail-pane/{f1-four-cards,f3-empty-records,f5-aborted-record}.png`）**逐张打开看过**，md5 各不相同：f5 那一行是 `10/4 04:02 · 0 分钟 / 未关联任务 / 中途放弃`，而四张卡是 `0 / 0 分钟 / 0 / 0 分钟` —— 判据 ① 那两套口径在同一张图里同时成立。<br>**边界（别读多）**：① 时长设置仍是 **web 特有**入口（mobile 用领域默认值），没搬进共享层，理由写在 `FocusTimer.tsx` 文件头那段；② `records` 每次现算不缓存（同步回来的对端记录因此自动进数），**没有为此加缓存**；③ 移动端**没有**记录列表 —— 这一单只要求两端的"今日专注时长"同源，把列表搬到 RN 是另一单；④ 真机/模拟器未跑（§6.1.1 的四端重装留到合并载体）；⑤ 未 push 未 merge；⑥ 🔴 **`check:docs` 现在是红的，两处死链都不在本单**（`PROGRESS.md:1362` → 不存在的 `docs/research/aed-implementation-evidence.md`，来自 `96f3293d`；`countdown-anniversary.md:1280` 引用的那份 ADR 台账里对应章节编号不存在（⚠️ 第一版这里照抄了那条坏引用的字面形状，结果被同一个检查器读成第三条坏链 —— **描述坏链要说形状，不要照抄那串**），来自 `33eea3e5`）—— 两个文件在 HEAD 里都是**干净的**（不是别人在飞的活），但正确的目标只有那两条线自己知道，**不代改、不吸收凑绿**。🔴 **13:5x 更正（§8.48）**：①那枚不是倒数纪念日那条线的缺陷，而是 `check:docs` 自己的**假红**（引用写 `§1a`，解析器只吃数字、截成 `§1` 再查标题）—— 已连五条自检臂一起修掉，同一截断在 `§4d` 那侧造成的是**假绿**（目标同时有 `## 4.` 与 `## 4d.`），也在同一单里修；②那枚仍然只是本分支落后 main 的读数，合流自愈。⇒ 那句"正确的目标只有那两条线自己知道"只对②成立，对①根本不存在"目标"要选 —— 文档本来就是对的。现量命令：`node research/tools/docs-link-check.mjs`。 |
| W8 | ⏸ 未开工（阻塞于 C1#2 **拍板**，不再阻塞于证据） | 一手对照已落调研 [C1b-Q2](../research/detail-pane-alignment-and-spaced-review.md)（2026-10-03 19:27 到齐）：Loop / Habitica 给了逐行 `file:line`，Streaks / 滴答 / Apple / Google 给了一手文档。**推荐与代价都写好了**，剩的是拍"天 vs 次 / 自然月 vs 滚动 / 日历 vs 韧性"这三个值。🔴 拍板前必读那节末尾的**依赖声明**：凡期望值涉及"一天打 N 次"的，W6 落地前不可达 —— ✅ **这条依赖已解除**（W6 落在 `ca2cf606`：`HabitLog.value` 现在可写、可读、可落盘），所以 W8 现在**只差拍板 #2 那三个值**，证据侧没有欠账 |
| W8a 值与词同源 | ✅ 已完成（2026-10-03，载体 `feat/detail-pane` = `9fc414b5`） | 它是缺陷不是选择，所以从 C1#2 拆出来先做。`resilience.total` = **达成天数**（`habit-resilience.ts:197`），七个键却印成"累计 N 次"（en `{count} check-ins`）⇒ 全改在**句子**侧：zh `web.habits.streak.total{,One}` / `row.aria` / `freshStart` / `mobile.growth.streak.{total,freshStart,a11y}` + en 两条 chip（`Total {count} days`，与同族 `Streak {count} days` 同形）；生产者侧四条**注释**同一个谎（`habit-resilience.ts:74/272`、`HabitBoard.tsx:145`、`HabitStreakList.tsx:6`）一并改；`ui/src/habits/model.ts:89` 那句"`count` 是那天打了几次"与 `:279` 的 `count = done ? 1 : 0` 自相矛盾，按后者改。**判据**：`packages/i18n/tests/habit-total-copy.spec.ts` 4 条。**变异六臂**：A1 row.aria 说回"次"→红 / A2 两条 chip 说回"次"→红 / A3 en 说回 check-ins→红 / A4 把 `累计 {total}` 搬进未登记的键→红（漏登记门）/ A5 把 `{total}` **改名**→红 / C0 负向对照"打卡 N 天"→**仍绿**（认语义不认字面）。🔴 **A5 是这单真正产出的判据**：第一版写 `if (!value.includes('{total}')) continue`，占位符一改那条被**静默跳过**，实测**整套 26 条全绿** —— 即"跟着数据走的循环用 `continue` 做前提校验"这个形状本身就是一个洞。另两条顺手账：`habits-board.spec.tsx` 那条把句子写成字面量 ⇒ 改成"字面量 + 与词条的漂移自检"（第一版自检因两侧空格不同而假红，去空白后再比）；`packages/ui/tests/projects-model.spec.ts` **从 `192a516d` 起就是红的**（那笔提交给 `OrganizerNode` 加了承重的 `archived`，没同步白名单）⇒ 补齐清单、判据强度不变，**归属在别人那笔提交，这里只修断言不动行为**。**读数**：i18n 26 / ui 442 / domain 821 / app-host 990 / mobile 601 / web 1512 passed \| 12 skipped，零失败；九道门禁 rc=0（含余量为 0 的 `check:l4`、`check:row-single-source`，**没调基线**）。⚠️ 未做四端重装（本单只改词条与注释，无产物形态变化；固定收尾留到 W1/W2 那批界面单一起跑） |
| W9 | ⏸ 未开工（阻塞于补打卡窗口决定） | |
| W10 | ⏸ **未开工**（本篇不排这一单，见 §2 第二批那行；阻塞于 C1#9–12） | |
| W11 | ⏸ 未开工（阻塞于两个比原题目更小的决定：补录做不做 / 改时长做不做） | 原登记"阻塞于是否重开『不做删除』"**已改题**（第三批一手调研否证了同行依据：滴答桌面端明文的是"不支持删除番茄记录"= 平台不对称，不是产品裁决；明文拒绝"改时长"的有两家）。🔴 删除那一档**继续挂着**，但它欠的是一条**我们自己的理由**，不是一个同行依据 —— 详见调研 [C1b-Q6](../research/detail-pane-alignment-and-spaced-review.md) |
| W12 | ⏸ 未开工（阻塞于是否要做，且题目已换） | ~~阻塞于"要不要先加数据模型"~~ → **该前提被现量否证**：`FocusSessionKind` 是**阶段**不是计时模式，上游把模式当**计时器状态里的判别字段** ⇒ 零 schema 变更的做法存在。要拍的改成**"正计时那一轮算不算一个番茄"**（两家同行只明文"时长合并计入有效时长"，算不算一个番茄**未找到一手来源**）。详见调研 [C1b-Q5](../research/detail-pane-alignment-and-spaced-review.md) |

**W1 那一格的展开**（下面这段原来写在表格单元里。GFM 的表格单元不许有块级内容，而表格遇到第一行非表格文本就结束了 —— 也就是说它把整张表截断在 W1 那一行，W1b 往后 15 行全部渲染成正文里的裸竖线。文字**一字未动**，只是搬出表格；常驻判据 `scripts/check-detail-pane-status-table.mjs`（工单 §8.67）钉住"表内不许再长出这种块"。）
🔴 **四臂变异（每条改完重新 `vite build` 再跑，判据读的是产物）**：A1 宿主不给四象限传选中 → **1 红**（红在那条跨投影用例）；A2 包装层声明了不转发（§7 #179 的形状）→ **1 红**；A3 宿主不给时间线传选中 → **1 红**；A4 点行根本不写选中 → **2 红**，而**搜索那条不红** —— 这不是漏网：搜索出口的生产者本来就是 `openTaskFromSearch` 不是 `openTask`，两臂各打一半正好证明这两个入口是**两条独立的线**。四臂跑完 `apps/web/src` 复原并复跑回 3 绿。
⚠️ **载体边界（不写成"门禁已验"）**：这条 spec 落在 `e2e/tests/` 里，`pnpm check:ai-e2e` 用的是 **dev 载体**，而 **linked worktree 里 dev 载体结构性起不来** —— vite 默认 `fs.allow` 只有 worktree 根，`node_modules` 软链到主检出，`@sqlite.org/sqlite-wasm` 的 wasm 走 `/@fs` 被拒（实测日志原文：`The request id ".../sqlite-wasm/dist/sqlite3.wasm" is outside of Vite serving allow list.`），症状是"三条全红、红在 `openApp` 第一步找不到输入框"，长得像产品坏了而其实是载体。所以我用**主检出的 dev 服务**（端口 4362，只读源码、跑完按 PID 关掉）做了一次"载体形状对照"：**3 failed，每条都红在 `task-item-* 一直没画上选中色`** —— 而主检出那棵树上没有本分支的 W1 接线。这条读数是双向有用的：它同时证明①这条 spec 不依赖生产构建、dev 载体上照常执行；②它会在"接线不存在"的树上响亮地红。
🔴 **我自己造成的两次共享检出写入（都当场复原，写在这里而不是咽下去）**：① 为了绕开上面那个 403，我把 sqlite-wasm 往主检出的 `node_modules` 里 `cp -R` 过，那一步**替换掉了一枚 pnpm 软链**（换成 2.9M 真目录）⇒ 已按 `.pnpm` 里的原始相对路径把软链恢复并 `cmp` 过字节；② 截图路径最初写的是相对 `../apps/web/...`，Playwright 按**进程 cwd** 解析，我从主检出的 `e2e/` 跑 ⇒ 五张图落进了**主检出**（`?? apps/web/evidence/selection-projections/`，HEAD 里从来没有这个目录）⇒ 已确认未跟踪、逐张比对后 `rm -rf` 掉那五枚，并把 spec 改成按 `import.meta.url` 解析。**教训：先例 `task-row-touch-target.spec.ts` 那种相对写法在单一检出里看不出问题，在 worktree 里就会把证据写到别人的树上。** 两条都够格进 §7，但 `docs/reference/environment-traps.md` 此刻在主检出里有别人 **187 行未提交**（编号已到 #189）⇒ 按"台账正脏着不追加"的规矩，这里只登记**内容**，编号由收口的人按当时现量取。

**未闭合的一件**：ⓑ 四端重装 `pnpm reinstall:all`（AGENTS §6.1.1 的固定收尾）。
🔴 **不是没做，是这一轮的窗口不属于我**（2026-10-03 22:5x 现量，四条都写下来供下一个窗口复核）：
`sysctl -n vm.loadavg` = **32.87 / 16 核**（仓库自带负载门的阈值是 12）；
`ps Axo command | grep -F verify-mobile` 抓到**两条别人正在跑的**设备验收
（`.verify-mobile-reminder-ring.sh.snap.50463`、`.verify-mobile-ios-reminder.sh.snap.40852` —— 倒数纪念日 W9 原生投递那条线）；
`xcrun simctl list devices booted` 有**两台**（`heyta-ios-isolated` 与 `iPhone Duo heyta`）；
`adb devices` 有 `emulator-5554`。而 `reinstall-all.sh` 的 android/ios 段**第一步就是卸载**
（`adb uninstall` / `simctl uninstall`）⇒ 现在起它 = 清掉别人的设备现场并把负载再顶上去。
本批还有一层结构性原因：**分支尚未并 main**，按"交付重活排在最后一次合并之后"的既有裁决
（§6.1.1 与 traps #82 要挡的就是"装完即过期"），这一轮重装的正确时机是合并载体上，不是这里。
可复跑的现场读数：
```bash
sysctl -n vm.loadavg; sysctl -n hw.ncpu
ps Axo command | grep -E "verify-mobile|check:ai-e2e|cli.js test|reinstall-all" | grep -v grep
xcrun simctl list devices booted | grep -c Booted; adb devices | tail -n +2 | grep -c device
```
（上面那行的收尾原来写成"围栏后再挂一个竖线"—— 那是"这段曾被当成表格单元写过"的化石，改成正常闭合的围栏。
它也是一条判据的靶：`scripts/check-detail-pane-status-table.mjs` 的臂 S4。）

---

## 8.1 W1 收口时的归因与登记（2026-10-03 现量）

**`pnpm check:docs` 在 W1 收口那趟报的四处，逐条问过"文件在谁手里"**（判据是同一文件的未提交 diff，
不是"某条线在忙"的印象）。**2026-10-04 复跑现量：死链 1 处 + 章节引用错 1 处，两处都只在本分支上成立**（同一条根因，已双向取证：
在主检出跑 `node research/tools/docs-link-check.mjs` ⇒ **✅ 无死链、无失效章节引用**；本分支落后 main
**298 笔**，`96f3293d`（引用句）是本分支祖先而 `c25960cb`（被引文件）不是 ⇒ **是"分支落后"，不是"谁没提交"**；
该检查器扫的是**它运行时所在的那棵树**，不跨检出取文件）。前两处已由我改成带状态的指针，所以它们不再出现在读数里，下表逐行带当时的读数与现在的读数：

| 出处 | 指向 | 现量 | 处置 |
|---|---|---|---|
| 本篇第 4 行 | `calendar-year-time-and-mobile-profile.md` | 主检出里 `??`（**未跟踪**），`git log --all --diff-filter=A` 查不到 | 已改：链接 → 带状态的路径指针 |
| 调研第 101 行 ×2 | `trash-and-archive-best-practice.md`、`../plans/trash-and-archive.md` | 同上，`??` | 已改：链接 → 路径 + "那条决定归回收站线自己提交" |
| `PROGRESS.md:1362`（**已提交**的那一行） | `docs/research/aed-implementation-evidence.md` | ⚠️ **本表原读数（"存在但未跟踪、从未被提交"）已被 2026-10-04 现量否证**：那枚文档现在**已提交**（`c25960cb`，**main 已含它**）。本分支仍报死链是因为 `c25960cb` **不是 `feat/detail-pane` 的祖先**（`git merge-base --is-ancestor` 现量：NOT ancestor），而带引用句的 `96f3293d` 是 ⇒ **引用句先进了树、被引文件还没进来** | **只登记不代改**：本分支 rebase/合并到 main 之后自行关闭。修法**不是**在本分支补一份文档（那是把别人的产物抄成第二份事实源），也**不是**删引用句 |
| `docs/plans/countdown-anniversary.md:1280` | ADR 索引的**第 1 节**（那个章节号不存在） | 2026-10-04 复跑仍在报，但**只在树上**：`git status` 对该文件干净，而**主检出（main）同一检查器 0 命中** ⇒ 与本表 AED 那行同一个根因（本分支落后 main），**不是倒数纪念日那条线写错** | **只登记不代改**：rebase/合并到 main 之后自行关闭；改这里反而会在合并态变成错引用 |

改成"路径而不是链接"而不是删掉引用：那两份文档里的裁决是**真前提**（`FOCUS_SESSION` 不做删除），
删掉引用会让那句结论没有出处；但**干净检出不该有死链**，所以指针要带上"它现在活在哪"。
🔴 补一句免得被读成"这条裁决有同行支撑"（2026-10-04 第三批调研，见调研 C1b-Q6）：它是**我们自己的立场**，
同行里滴答移动端 / TickTick / Toggl 都提供删除，"别人都不给删"那个依据已被否证 ⇒ 这句"真前提"现在
只由那条已拍决定撑著，而它**欠一条第一方理由**。本单不代它补，也不代它重开。

**登记的缺口（编号只增；每条写清该谁做、为什么不在本篇做）**：

- **G-1 时间线行的无障碍表面**：`TimelineBoard` 在同一颗 `Pressable` 上同时给了硬写的
  `role="listitem"` 与条件 `accessibilityRole="button"`，RNW 让前者胜出（实测：接了宿主与
  没接宿主两种状态下 `role` / `tabindex="0"` / `cursor:pointer` **三者完全相同**）。
  后果：读屏用户听到"列表项"而不是"按钮"，键盘与鼠标能用。修法要动结构（外层 `listitem` +
  内层 `button`），会牵动几何判据与 `check:rn-aria`，**不在本篇做**。现状已被
  `timeline-board.spec.tsx` 那条"无障碍表面现状"钉住 —— 谁改它谁红一次、顺手把这条划掉。
- **G-2 没接出口的行仍被画成可点**（同一条实测读数的另一面）：这与 `TaskList` 的既有立场
  （"刻意不把没给 `onOpenTask` 降级成点行=切换完成"）不一致。用 `disabled` 修**不行** ——
  它会把 `pointer-events: none` 传染给子元素，而 `timeline-resize-*`（拖拽握把）正是行体
  **的孩子**，用例里就有"宿主没接 `onOpenTask` 只握把可用"的走法。同属结构级修法。
- **G-3 门禁 B 仍不认的两种形状**：模块级 `let editingId: string | null = null`、
  `useReducer` 里的选中。词表里它是合法的（今天没有这两种写法），如实登记而不是当成已覆盖。
- **G-4 断言 E 的已知边界**：它比的是"同一个文件里声明了有没有用"，所以将来用
  `{...props}` 整体转发的写法会被判红（现在没有）。修法要显式改这条并说明理由，
  **不要靠注释绕过**。

现量命令（这三条读数每次都要重取，别照本表念）：

```bash
NO_COLOR=1 node research/tools/docs-link-check.mjs; echo RC=$?          # 在**哪棵树里跑**就是哪棵树的答案
git merge-base --is-ancestor c25960cb HEAD && echo "本分支已含被引文件" || echo "本分支落后：合并到 main 后自行关闭"
cd "$(git rev-parse --show-toplevel)/.." && node research/tools/docs-link-check.mjs | tail -1   # main 侧对照：现量 0 死链
```

## 8.3 W2 这一轮的四条载体教训（**待入 traps**，编号按收口时现量）

为什么不现在就写进 `docs/reference/environment-traps.md`：那份文件在主检出里有别人
约 187 行未提交改动、编号已排到 #189，往里追加会被别人下一次整文件 `git add` 抹掉
（这个事故在并行会话里已经发生过一次）。所以先落在本篇，**收口时按当时的工作树现量取号**。

1. 🔴 **变异 rig 的快照必须在动手之前取，复原必须在 `finally` 里。**
   第一版 rig 把 `originals[文件路径] = 读到的内容` 写在 op 循环**里面** ——
   同一个文件的第二个 op 拍到的是"已经改过一半"的内容，复原时把半件变异品写回去，
   **实测吃掉了一行还没提交的 `<aside>`**。第二个缺陷更隐蔽：`from` 命中数是在改完
   第一个 op 之后才检查第二个 op 的，assert 抛出时第一个 op 已落盘、复原循环从没跑到。
   ⇒ 三条固定动作：**先给整臂所有文件拍快照 → 全部 op 只读预检 → 落盘之后一切退出路径
   在 `finally` 里复原并逐字节比对**。另外：在未提交的工作树上跑 rig 之前，
   先把涉及文件 `cp` 到仓外（`/tmp/w2-backup/`）—— 这一条今天真的救了回来。

2. 🔴 **探针读到的"空值"必须与"读到的值"区分开。**
   Chromium 对分离节点 `getComputedStyle` 返回 `""`。任何写成"结果 ≠ 基线"的判据
   遇到空值都**必然成立**，也就是把"没读到"判成"变了"。修法不是放宽阈值，
   是先等到读到值，并把"探针读不到"做成一条**会红**的超时（自检臂：让读数恒返回空串）。
   与 §7 元规则 1（先怀疑探针）同族，但方向相反：那条讲的是假红，这条讲的是假绿。

3. ⚠️ **`git status` 之类的收尾取证必须带 `cwd`。**
   rig 收尾那句没带 cwd（在 /tmp 跑）⇒ 打印了"干净"。这是 §7 #45（管道后 `$?` 是 tail 的）
   的第三种面目：**取证命令的默认锚点不是你以为的那棵树**。同一轮里还有
   `GENCHECK_RC=0` / `TSC_RC=0` 两个假读数 —— 它们量的是 `| tail` 的退出码，
   而真正那三条命令当时是 `No such file or directory`。

4. 🔴 **两条用例都停在同一个视图时，"两条都绿"可能只是同一行声明量了两遍。**
   M2 存活（2 passed）暴露的是：详情列有两条 `grid-template-columns` 声明
   （带侧栏 / 不带侧栏），而当时所有用例都从任务视图进入 ⇒ 两轨那行**零判据**。
   ⇒ 判据集合要按"**被改的那个声明有没有用例走到**"来配，而不是按用例条数；
   存活臂不是白跑，它是这单真正产出的那条判据的来源。

## 8.4 W5 这一轮的四条（**待入 traps**，取号理由同 §8.3 那段）

1. 🔴 **"这份镜像共享不了"的理由要逐字段复核，不能整份照抄。**
   `apps/web/src/features/tasks/priority-display.ts` 与
   `apps/mobile/src/lib/priority.ts` 各有一份 `priorityColorToken`，两份的文件头都写着
   "`packages/ui` 依赖不了 `@heyta/i18n`（要过 §3.1–3.2 两道门）⇒ 只能镜像 + 对账"。
   **那句话是真的，但它只卡住"档位 → 词条 key"那半边**；
   "档位 → 语义色 token 名"只需要 `Priority`，而 `packages/ui` 早就依赖 `@heyta/domain`。
   代价不是抽象的：W5 要把优先级色画到**共享层的勾选框**上，那份颜色留在宿主里
   行组件就够不到 —— 于是"最值得抄"这一条一直落不了地，而且**没有任何一层会红**。
   ⇒ 判"能不能抽"要问的是**这一半到底依赖哪个包**，不是"这个文件当年为什么没抽"。

2. 🔴 **`expect.poll` 会把"元素根本不在 DOM 里"报成"值不对"。**
   完成态那条第一次跑红，消息是"完成后描边没变成主色"。真相是勾掉之后那一行
   **离开了当前范围**（失败快照：主区只剩「无截止时间 3」，那条在侧栏「已完成 1」里），
   于是 poll 里那句 `toHaveCount(1)` 一直重试到超时，**两类失败被压成同一条消息**。
   按这条消息去改产品就会改错东西。
   ⇒ poll **之前**先做一次存在性断言（`toBeVisible()`），或让 poll 的读数函数
   在取不到元素时抛一个指名"行不在这一屏/这一范围"的错。
   与"存在性先于取值"同族，新的是这层：**包装自己会吞掉失败的种类**。

3. 🔴 **判据量 N 行，证据图里就必须看得见 N 行 —— 视口是判据的一部分。**
   默认 720 高的那张图里只有三行（第四行"无优先级"在折叠线下面，AI 面板占了半屏）。
   四条描边各有读数，图却只能证三条，而**断言永远不会告诉你这件事** ——
   它读的是 DOM，不是可见性。是"人把那张图打开"照出来的（§6.2 规定一第 4 条）。
   ⇒ 界面套件自己 `test.use({ viewport })` 把高度钉够，别靠默认值。

4. 🔴 **抽取之后旧判据必须原地改写成新不变量，否则它变成一条永远通过的门禁。**
   `row-meta-shared.spec.tsx` D 组原本断"两边源码里都出现那四个 token 名"。
   抽完之后两边**都不该再出现** —— 那条判据从"防漂移"悄悄变成"永远绿"，
   而且它绿着，没人会去查。已改写成：宿主里不许再有 `color.priority-*` 与
   `function priorityColorToken`，三个消费者必须从 `@heyta/ui` 取。
   同 §7 元规则 2（"一条永远通过的判据比没有判据更糟"），
   这里是它的**触发时机**：不是写判据那天坏，是**被这次重构变坏**的。

---

## 8.5 W6 这一轮的五条（**待入 traps**，取号理由同 §8.3 那段）

1. 🔴 **幂等判据要和"它想防的那件事"用不同的写路径造对照。**
   `checkIn` 的纪律是"已打卡且没给新量 ⇒ 零 op"。第一版对照是我自己 `checkIn` 两次 ——
   两次走**同一条**缺省逻辑，所以它自证：把比较写成 `existing.value !== value`
   （原始键）时，这条判据**照样绿**，因为两边都是 `undefined`。
   真实形状是库里可能躺着一条**没写量**的 HABIT_LOG（有效值 = `target`），
   这时 `checkIn(id, day, target)` 必须仍返回 false。
   ⇒ 对照用 `engine.dispatch` **绕过被测写路径**直接塞那条畸形记录。
   一般规律：**对照组和被测共享同一个缺省时，判据量的是那个缺省自己，不是产品行为。**
   （同一臂在变异里是 M3：比较键不比较有效值 ⇒ `app-host` 红 —— 那条红就是这么来的。）

2. 🔴 **"合法域"要从准入校验那个函数现读，不要从"我以为这个字段长什么样"推。**
   `hasCountableGoal` 第一版写 `target > 1`（"多于 1 格才需要数量行"），
   被 F5b 那条界面用例照红：`target: 0.5`（半小时）也是多格的，却整行不显示。
   合法域在 `setHabitGoal` 里 —— 它只拦负数与非有限数，**小数是合法的**，
   所以正确的判据是 `!== 1`。
   配套那条更要紧：条件渲染的"不该出现"判据必须自带**正对照**
   （`expect(row).not.toBeNull()`）。否则"按钮不存在 ⇒ 点了没反应"
   会让"点击不许发负值"那条断言在**同一趟**假绿 —— 两类失败（没画 / 画错了）被压成同一个"没调用"。

3. 🔴 **源级判据（"不许出现第二个缺省"）必须先剥注释，而且要把代价写在注释里。**
   第一版直接对文件全文 `expect(src).not.toMatch(/log\?\.value\s*\?\?/u)` ——
   结果是**我自己的 docblock** 里那句"以前这里写的是 `log?.value ?? 0`"把它打红了。
   加了 `codeOnly()`（剥块注释与行注释）后判据才量到代码。
   ⚠️ 接受的代价也要登记：同一层剥掉的还有字符串字面量，
   所以"把违规藏进模板串"这种形状抓不到 —— 它防的是**下次有人真写一份缺省**，不是防表演。

4. 🔴 **RNW 把"启用"表达成属性**缺席**，不是 `="false"`。**
   `aria-disabled={false}` 在真浏览器 DOM 里**根本没有这个属性**，
   于是 `toHaveAttribute('aria-disabled','false')` 在 jsdom 里能绿、Chromium 里必红。
   ⇒ 断"可用"要写 `not.toHaveAttribute('aria-disabled','true')`。
   与 §7 #80 同族（RNW 吞 keydown）但**不是同一件事**：那条是事件传播，这条是属性序列化。
   两者共同的形状是：**jsdom 里的 RNW 不是真浏览器里的 RNW**，凡拿 RNW 组件当判据载体，
   至少有一条要落在真浏览器那一层。

5. ⚠️ **点名路径提交会漏掉"上一轮刚碰过"的文件，而 `git status` 里它和别人混在一起。**
   `ca2cf606` 点了 17 个路径，漏了 `packages/ui/tests/habits-model.spec.ts`（本轮 +6 条判据）——
   直接原因是那份点名清单是我**凭改动记忆**列的，而不是从 `git diff --name-only` 现量抄的。
   共享检出里 `git status` 混着 `?? node_modules`（worktree 软链，见 §8 那行的警告）
   和 `M scripts/mutate-closeout-gates.sh`（别人的线），所以"看一眼 status 干净"不构成判据。
   ⇒ 收尾的判据是**逐条认领**：提交后再跑一次 `git status --porcelain`，
   对每一行说出"这是我的（补一笔）/ 这是别人的（不动）/ 这是环境的（忽略）"。
   本仓库 AGENTS §8.7（范围逐项对账）说的是同一件事，这条是它在**提交动作**这一层的形状。

---

## 8.6 W4 这一轮写下的第一条更正（不必入 traps，但它是一次真实的自我否证）

工单 W4 ① 的原话是"Android 那条『Medium 宽 + Compact 高两栏不可行』的反例要真被挡住"。
我把第一版阈值写成**高 < 600**，并在 `narrow.css` 的注释里给出理由
"Android 的 Medium 高度类从 600dp 起算"。

🔴 **那句是错的，而且是"看起来最有道理"的那种错**：Android 的窗口尺寸类是**两根轴**——
宽 `<600 / 600–840 / 840–1200 / 1200–1600 / ≥1600 dp`，高 `<480 / 480–900 / ≥900 dp`。
600 是**宽度**轴的档位边界；那条反例里的"矮"是**高度 Compact = 高 < 480dp**。
我把两根轴串了，还把串了的那个数写成"起算点"，读起来比原规则还像规则。

取证方式值得照抄下来：不是"我又想了一遍"，而是**回读被引用的那一节原文**
（[调研 A1「业界一手规范：四家各自规定了什么」](../research/detail-pane-alignment-and-spaced-review.md)，
它引 https://developer.android.com/develop/adaptive-apps/guides/use-window-size-classes ）。
那次回读同时纠正了两处指代：注释里写的出处是"C1b/A5 段"，而这条规则其实落在 **A1**
（C1b 与 A5 都没有它）。

⇒ 落成两条纪律：
1. **写进注释/文档的阈值都要回读它声称的出处**，尤其当那个数"看起来很眼熟"时 ——
   眼熟恰恰是串轴的症状（同一个数字在另一根轴上）。
2. 边界值判据要**两侧都量**（本单：高 480 必须有、479 必须没有）。
   只量一侧挡不住"479 写成 599"，也挡不住把整块断点删掉之后另一侧仍然绿。
   这条与 §7 元规则 2 同族，新的是它的**触发场景**：凡是"从某常量推导的阈值"，
   推导写错方向时，单侧判据总是绿的。

⚠️ 本行只登记已经发生的事；W4 的读数（判据条数 / 变异红集 / 截图 / 门禁）在 §8 那一行回填，
不以本行为交付凭据。

---

## 8.7 W4 第二趟写下的四条（都来自"读数看起来正常、其实不是"那一类）

**1. 变异臂存活时，先问"这一行有没有承重后果"，不要先问"要不要记成债"。**
M11（摘掉 `.ht-header__actions` 的 `flex-wrap`）**两扇门全绿**：不折行时既不溢出、
开关也照样在视口里。这有两种可能 —— 那行是死重量，或者它防的坏结果**根本不在判据量的
那根轴上**。区分它们不需要重建 dist：**在同一次页面加载里用 CSSOM 原地切那一行做 A/B**
（`el.style.flexWrap = 'nowrap'` 改的就是同一条属性，几十毫秒一轮），逐控件读
`rendered` 与"临时 `width:max-content` 量到的 natural"。读数坐实是坏结果（图标按钮
52→32、语言 chip 40→29 = 点击区被压窄），于是补判据；如果读数是"没差别"，
处置就是**删掉那一行**，而不是留着一行没人守也没人摘的声明。

**2. 不可收缩的 flex 子项，已用宽度 = max-content ⇒ 在它自己身上加 `flex-wrap` 是空操作。**
两版失败尝试（只在父层加 wrap：922→870 仍溢出；两处都加：读数一字没变）卡在同一个机制上。
一般规律：**连着两次"改了没反应"，先怀疑我改的那一层压根没被约束**，
而不是怀疑改动不够大。三件要一起：允许收缩（`0 1 auto`）+ 打开收缩下限
（`min-inline-size: 0`）+ 换行（`wrap`）。

**3. 阈值不抄常量，能现量就现量。**
"最小点击区 44px"是这里最顺手的写法，而它会**同时**误杀 40px 的语言 chip
（合法尺寸，判据却红）**和**放过 32px 的图标按钮（真被压扁，判据却绿 —— 因为 32 < 44
只在"我以为所有按钮都该 44"时才有意义）。换成"渲染宽度 == 该元素自己的自然宽度"
之后，两件事各归各位。这条与 §7 元规则 2（阈值要从被约束的常量推导）不冲突：
**当被约束的对象每个都不一样时，"常量"本身就是错的推导**。

**4. 🔴 收尾脚本自己会造一次假绿：门禁的每一步退出码要各自打出来。**
`/tmp/w4_gates.sh` 里 token 那一步是 `tsup --config … && node dist/generate-cli.js --check`，
而脚本用的是 `$WT/node_modules/.bin/tsup` —— **根 `node_modules` 是指向主检出的软链且没有
`.bin`**，tsup 直接 `No such file or directory`。可日志打印的是 `tokens rc=0`，
后面还跟着 `✅ 生成产物与 tokens.css 一致（8 个文件，204 个 token）`：
**`&&` 前半失败，后半仍然拿上一次构建的 `dist/` 跑了，而它确实会绿。**
也就是说那一趟量的是**旧产物**。改成各包自己的 `./node_modules/.bin/…` 重跑才是真读数
（同批的 i18n 那一步当时是 `rc=127`，因为它整条就是同一个二进制问题）。
⇒ 落成两条：**在 linked worktree 里二进制要按包取**（`packages/<pkg>/node_modules/.bin/*`，
不是根 `.bin`）；**一个"步骤"里含 `&&` 时，逐步打退出码**，否则失败的那一步会被
后面那步的成功盖掉。这与 §7 第 164 条（后台通知的 `exit code 0` 是包装命令的）同族，
新的是它的**脚本内部**形状。

## 8.8 W7 这一轮写下的四条（都在"读数正常、其实不是"那一类，第 1 条是新的第三种）

1. 🔴 **截图落在 CSS 过渡中间，会把"对的状态"拍成"界面在说谎"。**
   F3 的第一版图里 rail 的高亮停在**第一格「任务」**，而内容区明明是番茄钟 ——
   人看图得到的结论是"rail 高亮与当前视图脱钩"，一条听起来很真的产品缺陷。
   同一时刻的 DOM 现量把它否证了：`--active` 在「番茄钟」上，两格的
   `backgroundColor` 分别还是**各自的旧值**（`任务 = rgb(255,255,255)` /
   `番茄钟 = rgba(0,0,0,0)`）。机制在 `inbox.css:432`：
   `.ht-rail__tab { transition: background var(--ht-duration-fast) … }`，
   而 `--ht-duration-fast = 150ms` —— 那张图拍在这 150ms 里面。
   ⇒ 修法**不是改判据**，是**等动画落位再拍**：`parkAndSettle()` 取的是这些元素
   **自己的** `getAnimations()`（落位后集合为空 ⇒ 立刻返回，不是"睡 150ms"，
   `prefers-reduced-motion` 下同样立刻返回），与 `helpers.ts#waitForOverlaySettled` 同一条理由。
   顺手把这件事变成判据：**"视觉上高亮的那一格必须就是当前视图"**（M12 证明它会红）。
   ⚠️ 与 §7 第 83 条（探针改变被测状态）同族，但这一条的面目是**时间**不是状态 ——
   探针什么都没做错，只是拍早了。而它骗过的正是"人必须看图"这道门：
   **看图是真的在看，看的是过渡帧。**

2. **一个 `|| true` 的 for 循环能一次造出八条假绿。**
   第一版门禁循环写成 `node scripts/check-$g.mjs > log 2>&1 || true; rc=$?`。
   两处错叠在一起：路径是**猜**的（`check:design` 的真身在 `design-system/heyta/`，
   `check:l4` 的文件名是 `check-l4-no-style.mjs`），八条全部 `MODULE_NOT_FOUND`；
   而 `|| true` 之后 `$?` 恒 0 ⇒ 打印出"八道门禁 RC=0"。
   发现方式是我自己去 `tail` 其中一份日志（因为它的最后一行是一句中文说明而不是 ✅，
   看着就别扭）。⇒ 落成：**取 rc 之前不许出现 `|| true`**；**每条门禁同时打印退出码
   和它的结论行** —— 只看 rc 会把"崩了"读成"过了"，只看结论文本会把"根本没跑"读成过了。
   这是 §8.7 第 4 条（`&&` 前半失败被后半盖掉）的**同一条病的另一种形状**：
   那次是被 `&&` 的右半边盖掉，这次是被 `|| true` 直接抹掉。

3. **数红的解析器要先喂一份"已知红"，否则每条臂都会被误判成"存活"。**
   变异 rig 第一版用 `line.startswith("×")` 数失败用例，而 vitest 的用例行**以空格起头**
   ⇒ 恒 0 命中 ⇒ 十二臂会全部报"SURVIVED"，读起来像"这批判据都没牙"。
   加了两条自检（控制组必须 0 **且必须解析到 summary 行**；一份手写"已知红 2 条"的
   日志必须报 2）之后，第一次跑就被自己抓出来（summary 行是缩进的，`^Tests` 不命中）。
   ⇒ 恒真的解析器与恒真的判据一样危险，只是它伪装成"很严格"。
   与 §7 第 46 条（"不能失败的检查没有价值"）同族，新的是**它失败的方向**：
   它不会让坏东西通过，它会让**好东西被冤枉成没做**。

4. **变异存活先问"这个形状可达吗"，可达就是判据缺口，不是无意义变异。**
   W7-M8 把 `completed === true` 写成 `completed !== false`，第一趟 domain 全绿。
   两条出路：① "我们自己的写入方永远写显式布尔（`focus-actions.ts:151` 是
   `?? false`），所以这个变异不代表任何真数据" —— 听起来对，但它是**客户端自证**；
   ② 去读字段的声明：`FocusSession.completed?: boolean` **是可选的**，
   而 `shouldPersistSession` 只过 `kind === 'work'` ⇒ 一条没有 `completed` 的工作段
   **结构上就能进记录列表**（AGENTS §3.3 讲的就是磁盘上会长期存在这种 payload）。
   ② 成立 ⇒ 这是判据缺口，补一条"`completed` 整个缺失不算一个番茄（时长照算）"，
   复跑 M8 精确转红。⚠️ 同时把方向钉住：**"没标完成"不等于"标了放弃"**，
   但也不等于"算一个番茄"；段数取保守一侧，与 `focusStatsForDay` 同一句判据 ——
   两处口径不一样就会出现"今日番茄 2 / 总番茄 3"这种自相矛盾。

## 8.9 W1b 这几轮写下的五条（第 1、2 条已入 traps **#215 / #216**（第一版取的是 #212/#213，2026-10-04 06:39 现量发现 main 上的 #213 已被另一件事占用 ⇒ 取号方自己挪，见 §8.10 末段）；第 3–5 条不入，理由与取号现量见 §8.10）

1. 🔴 **变异臂必须自证"变异进了被测产物"，否则"存活"是探针读数，不是判据读数。**
   W1b 第一趟浏览器层的 C1 打出 `SURVIVED —— 这条判据没有牙`，读起来像 K3 白写。
   现量：这一族的载体是 `vite preview` 读 `apps/web/dist`（配置文件的文件头自己就写着
   为什么不能用 dev 载体），而那条臂改的是 `apps/web/src/**`、`build=[]`
   —— **被测的那一份里根本没有变异**。
   修法不是"记得加一步构建"，而是把那个前提落成判据：臂在跑测试前先算 `dist/` 的
   **目录摘要**（每个文件的相对路径 + 各自 sha256，排序后再哈希），与干净态**不同**才
   允许判红/存活，打 `REACHED_ARTIFACT=True`；收尾再要求摘要**回到**干净态。
   加上之后同一条臂立刻转红（K3，`FAILED=1`）。
   📌 一般规律：**只有"存活"需要这条前置 —— 红是自证的**。旧产物不会凭空变红，
   所以红了就说明变异体确实在提供服务（C2 那条加前置之前的红仍然算数）。
   与 §7 第 27 条（APK 里是旧 JS bundle）同族，新的是它落在**验证脚本内部**的形状。
   同一趟还顺手抓到自己写的恒真解析器：`s.startswith(("✘", "", "×"))` 里那个空串
   让 `names` 无条件收下所有行 —— 与 §8.8 第 3 条同一个错的第二次，只是这次在跑之前看见了。

2. 🔴 **"只断言没发生"的判据，正向对照要配在能区分的那一侧 —— 配在端点上等于没配。**
   C5（摘掉"正在打字"那道闸门）头两趟都存活。第一次我归因成"↓ 再 ↑ 两发互相抵消"，
   补了一条"焦点交回页面后同一发 ↓ 必须真的挪一格"的正向对照 —— **复跑仍然存活**。
   第二次才看清抵消只是三分之一，另外两条各自都不构成区分：
   ① 那两发按键后面只有**一句**断言，读的是净效果；
   ② 光标停在**第 0 行**，而 ↑ 在第 0 行本来就走不动（端点夹住是 W1b 自己的产品行为），
      于是"没挪走"在变异体下照样成立。
   改法：**一发按键配一句断言**，并把场景前提钉成判据（`expect(at).toBe(1)` ——
   必须停在中间那一行，否则后面两句都不算数）。复跑 C5 精确转红。
   📌 与 §7 第 50 条（"状态对"在"没生效"时也绿）同族，新的是**它可以在已经补了
   正向对照之后仍然成立**：修假绿时要问的是"这条对照在变异体下会不会走另一支"，
   不是"有没有对照"。

3. 🔴 **门禁步骤的命令要从被验对象的 `package.json` 里取，别用猜的配置文件** ——
   猜错的方向是"能跑通、只是少查一批文件"。
   电池里六条 typecheck 我写的是 `tsc --noEmit -p tsconfig.json`，而六包的 `typecheck`
   脚本是 `tsc --noEmit -p tsconfig.spec.json`（只有 `apps/mobile` 用前者）。
   差别是**测试文件在不在检查范围内**：电池六条全 RC=0（每条 0.5s）之后单独按包跑
   spec 版，`apps/web` 立刻报
   `tests/keyboard-cursor.spec.tsx(251,17): error TS2345: '"ArrowRight"' is not assignable to '"ArrowDown" | "ArrowUp"'`
   —— 一条真错误，住在我这一轮新写的测试里，而 vitest 不查类型所以那 21 条一直是绿的。
   📌 两条：**"快得不像话"本身就是探针读数**（六包 tsc 各 0.5s 应该问为什么）；
   以及这条与 §8.8 第 2 条（八条假绿来自我猜的脚本路径）同族，
   新的是它的**失败方向** —— 那次是 `MODULE_NOT_FOUND` 响亮地坏，这次是安静地少查。
   ✅ **修法这一轮落进了电池本身**（不只是“另外手动再跑一次”）：那六条改成从各包 `package.json` 读 `typecheck` 脚本，并补两条自检 —— ① 生成器产出 0 条步骤就红（真源字段改名会让电池**静默少跑六条**，和那五条虚检查同一个形状）；② 步骤名由数据生成之后带上了包路径里的 `/`，直接拼日志名就是往不存在的目录写（这一轮整个电池死在第一条 typecheck，症状是 traceback 而不是红，而 traceback 之前的十条 RC=0 会让人以为已经在收尾）。
   📌 **生成式的验收表必须自检条数与命名消毒**：少一条不会让电池变红，只会让它少查一件事。

4. **注释里的每个 `file:line` 都是抄件，写的时候要点开。**
   我在 `keyboard-cursor.ts` 文件头写搜索浮层是 `App.tsx:2203`，点开是 2202-2205；
   写 sheet 底色"见 helpers 的注释"，而真源是 `sheets.css:27` 那条 `color-mix`。
   两处都在这一轮改成实读的行号。顺手把"三个真浮层分两种形状"钉全时，
   第三枚（法务二次确认 `role="dialog"`、类名 `.ht-sheet__reconfirm-*` 但**不带**裸
   `.ht-sheet`）是为了写注释去 grep 样式表才看见的 —— 它恰好就是
   "只认 `.ht-sheet` 的选择器会漏掉的那一种"的第二个实例，也就是 B11 那条臂的靶子。
   📌 与"抄件一定会漂"同族：**代码注释里的行号是抄件**，写的时候不点开，
   它就是下一轮别人据以行动的过期读数。

5. 🔴 **在"有未提交改动"的文件上做临时变异，收尾绝对不能用 `git restore`** —— 它回到的是
   HEAD，会把那一轮**还没提交的修复一起抹掉**，而症状是"文件干净了"。
   本轮实测：为了自检新建的那道 e2e 类型检查，我往 `e2e/tests/keyboard-cursor.spec.ts`
   里注入了一句故意的类型错误，收尾用 `git restore` 还原 —— 于是同一分钟里刚改好的
   `onlyHighlighted` 返回类型（那处类型谎见边界③）也被抹回旧版。
   抓住它的只有 rig 里那句 `RESTORE=MISMATCH`（改前/改后各算一次 sha256 并比对）；
   如果当时只看"文件不在 `git status` 里"，那是一条**看起来比原状还干净**的假象。
   📌 规矩：**变异前把原文留在自己手里**（脚本里的 `text0 = path.read_text()` + `finally: write_text(text0)`，
   本轮 v5/v7/v8 三个 rig 都是这个形状，所以它们从没丢过东西），
   还原之后**必须比对 sha256**；`git restore` / `git checkout --` 只在"该文件对 HEAD 干净"时用，
   判据是先 `git diff --quiet <file>`，不是"我记得我提交过了"。

## 8.10 四端重装：这一轮**为什么没做**（2026-10-04 04:58 现量，不是"没想起来"）

§1 末尾把 `pnpm reinstall:all` 定成不可省的收尾，而 W1 / W1b / W2 / W3 / W4 / W5 / W6 / W7
八行**只差这一步**（逐行现量：W3「只剩 §6.1.1 四端重装」、W5/W6「只剩 AGENTS §6.1.1 的
四端重装，所以还不算已完成」）。本轮去量了现场：

| 现量 | 读数 |
|---|---|
| 负载 | `loadavg 71.93 / 45.50 / 28.54`，16 核 |
| 谁在跑 | `sh /tmp/queue-reinstall-all.sh` ×2（已跑 1h46m–1h49m）+ `bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817` + `apps/desktop-macos/scripts/package-app.sh /tmp/heyta-macos-dist` |
| 共享目标 | `emulator-5554` 在线；iOS 侧**三台** Booted（`heyta-iphone-17pro` / `heyta-ios-isolated` / `iPhone Duo heyta`）；Windows 打包机 `ssh windows-pc` 可达（`SSH_OK`） |

📌 **05:37 复量**（同一趟 `uptime` + `ps`）：那四个 PID **一个没变**（`81007` / `93771` / `93817` / `95477`），
已跑 **2h25m–2h28m**，负载 `64.51 / 46.47 / 32.71` ⇒ 上面那条结论没过期，而**这一行才是它没过期的证据**。
复量命令（谁占着哪台设备每次都要现取，别照本节念）：
`ps -Ao pid,etime,command | grep -Ei 'reinstall-all|package-app.sh|package-msix|verify-mobile' | grep -v grep`。

⇒ **另一条会话正在做四端重装**，而它的载体是 `/tmp/heyta-reinstall` 那棵隔离检出，
**不是本分支**。现量它那份载体（四条都可复跑）：
`rev-parse --short HEAD` ⇒ `d0a81927`（一个 self-host 合流载体）；
`rev-list --count HEAD..main` ⇒ **落后 main 20 笔**；
`git merge-base --is-ancestor 6c3c1ecd d0a81927` ⇒ **不含本分支 W1b**（整条本分支都不含）；
它那本台账的最大号 207，而 main 已经是 211。
⇒ 那一轮装出来的四端产物**既不含本线、也不是 main 的当前态** ——
这正是 main 上 `a2a6541b`（**05:00 落笔时编号是 #208，05:34 被 `87f62b39` 改号成 #213**，见本节末段那条撤回）
自己刚记的那句"另一条线的四端重装跑在落后 main 19 笔的
载体上"的**同形状下一次发生**。
按 AGENTS §8 第 9 条（共享资源独占验收）与环境陷阱里的负载门：**不并行覆盖、不挤进去、
不调低阈值**。所以八行仍写"未做四端重装"，这一节就是那句的取证行。

📌 **06:48 第五次读数**（同一趟 `ps` + `sysctl` + `simctl` + `adb`）：那组 PID **仍然在场**
（`81007` etime **03:39:52**、`93771` 03:36:46、`93817` 03:36:45，`.snap.93817` 仍在跑；
`lsof -p 93817` 现量它的 `cwd` = `/private/tmp/heyta-reinstall` ⇒ 还是那棵隔离检出，不是本分支）；
负载 `{ 9.64 10.51 14.08 }`；iOS 侧 **3 台 Booted**；`adb devices` 里 **0 台 device**
（与 04:58 那次不同，那时有 `emulator-5554`）。同一趟还看到**另一条会话正在跑 Playwright**
（4 枚 `chrome-headless-shell` + 1 枚 ffmpeg，etime 约 20 秒）⇒ 窗口比上次更不该挤。
⚠️ 这仍是一条**一次性读数**，下一轮要用了必须现跑，别照这一行念。

📌 顺带把一条时序事实记下来，给下一轮省事：**四端重装唯一有意义的读数在"合流之后"那一次** ——
它装的是安装包，而本分支后续每一笔都会让这一轮白装。现在挤进去跑一次得到的正是
§7 第 27 / 82 条那一族（"测试全绿 ≠ 这是当前产物"）的**第三种面目**：
装上了产物，但不是最终那一份。

**§8.9 的第 1、2 条已入 traps —— 号现在是 #215 / #216；第一版取的是 #212 / #213，那两个号已经作废（下面 06:39 那段记了为什么）。**
🔴 第一版我取的是 #180 / #181，那是**错的**，而且错法值得单独记一句：
**取号必须按合并目标（`main`）现量，不能按本分支那本副本** —— 本分支此刻落后 main **338 笔**，
工作树里的台账最大号只有 179（`git status` 干净、`wc -l` 与 HEAD 逐字相同，一切"文件没被动过"的
信号都成立），而 main 上 **#180/#181 早已是另外两件事**、最大号是 **#211**。
（🔴 06:35 与 06:41 两趟复量：落后 **374 → 376** 笔（**两分钟走两笔**，这本身就是上面 #206 那条的现场）、
main 最大号 **214**、副本最大号 213 —— 上面那几个 04:5x 的数字留着，是为了让人看清取号当时的依据有多"新"。）
现量命令（两条都要跑，只跑第一条就会取到撞号的号）：
`git show main:docs/reference/environment-traps.md | grep -oE '^[0-9]+\. ' | tr -d '. ' | sort -n | tail -1`
与对本分支副本的同一条。
第 3、4 条不入 traps —— 它们是"怎么写判据/怎么写注释"，属于 §5 与 §8 那一类规则，
不是会复现的环境陷阱。
⚠️ 取号时顺手量到台账本身有一个**不归本单处置**的问题：**同号不同内容**
（处置方式 06:4x 被现场验证过一次 —— **改号方只动自己那一条**，正是下面那段记的 `87f62b39`）。
现量（05:0x 那一趟，两份都数）：本分支副本 190 个行首编号 / 177 个唯一号，
`main` 221 个 / 207 个唯一号，重复的是 `1 / 2 / 3 / 4 / 38 / 93 / 94 / 95`。
🔴 **原句"而 main 上 #208 是刚撞的新例子"现在不成立 —— 但我第一版的撤回给出的诊断也是错的，两个都记。**
- **它在落笔那一刻是真话**：`a2a6541b` 在 **05:00** 把那条目提进 main 时**编号写重了**
  （`git show a2a6541b:docs/reference/environment-traps.md | grep -cE '^208\. '` = **2**），
  我 05:0x 写那句就在它后面几分钟。所以这不是"没量过的断言"，是**量过却没把时刻与载体写进句子**。
- **它被别人的改号推翻**：`bfdeea31`（05:32）一度把台账写坏到 `^208\. ` 命中 **0**、最大号取不出，
  `87f62b39`（05:34，提交信息原话："恢复台账被我的 18 字节 blob 写坏，并把 #213/#214 正确提进去"）
  把那一条挪成 **#213** ⇒ 今天 main 的 #208 只剩一条，正文是 iOS 模拟器截图那件事。
- 现量（06:41）：main **222** 个行首编号 / **209** 个唯一号、副本 190 / 177，重复号集合都是
  `1 / 2 / 3 / 4 / 38 / 93 / 94 / 95` —— **#208 已不在其中**。
⇒ 所以这一段的正确结论不是"我抄错号"，而是：**未合并分支上的编号是临时值** —— 两边都只能按当时的 main 取号、
互相看不见对方。**刚撞的新例子就在本单身上**：#213 在 04:5x 现量空闲、06:39 已被那一次改号占用，
所以"这不是历史遗留、是**此刻还在发生**的取号竞争"这个**结论仍然成立**，而且**成因和我完全相同**。
"编号只增不改"是这本台账的承重规则，同号会让跨文件引用（含本文件里那些"→ §7 #N"）歧义。
不在这里改：**重编号会让全仓已有引用全部失效**，那是要台账所有者拍的一次行为变更；
但**取号方（也就是我）能立刻做的是先量合并目标**，这一条已经写进上面那段。

🔴 **06:39 复量：那次"空闲"的读数过期了，号真的撞上了。**
现量（同一趟）：main 台账最大号 **214**；**#212 不存在**（main 全文连"212"这个串都没有，
所以那是一段真空号，不是"以别的形式在场"）；**#213 存在且是另一件事**（"落地之后才装"那道顺序门
如果只判"main 有没有前进到载体"，就会放过反方向）；#214 也在。
⇒ 本分支那两枚（04:5x 取号时 main 最大是 211，212/213 那会儿确实空闲）**在合流前会合并成两个 `213.`** ——
同号不同内容，正是这一节上面批评过的那个形状，而这一次是**我自己造成的**。
处置：**取号方自己挪**（不动 main、不重编号别人的条目；main 上 212 那段空号**不去占**，
因为不排除某条并行分支已经按 212 预留 —— 只往 main 现量最大号后面取）⇒ 本单两枚改成 **#215 / #216**。
引用 sweep 后的现量（不写"0 残留"那种没量过的话）：traps 文件里 `^21[23]\. ` 条目 **0** 条、
`#21[23]` 引用 **0** 处。计划文件这一侧的承重的话**不是总数**而是这条命令：
`grep -o '#21[23]' docs/plans/detail-pane-alignment.md | wc -l` —— 它数出来多少都**不算红**，
因为**每追加一段撤回文字它自己就 +1**（06:39 落笔时 12，06:44 已是 14）；
真正要守的是"**没有一处是活引用**"，判据是逐行喂撤回标记（"第一版/作废/已经不真/被另一件事占/
现量空闲/还空着/不存在/再挪"）：06:44 现量 **8 行里有 7 行直接命中，第 8 行是同一句的换行续行**
（行级测试看不见句子跨行 —— 这是这类标记判据本身的边界，写出来比把正则调成多行更诚实）。
也就是说这一句里出现的
"12 / 14 / 8 行"全是**当时的读数**，下一个改它的人应当重跑这两条，而不是把它们当不变量。
（"第一版取的是…""那句在 05:0x 是真话"这类历史留在原句旁边，不删）。
⚠️ **给合流那一趟**：#215/#216 同样是**一次性读数**。合流前必须再跑一次下面两条命令，
若又被占就按当时 main 最大号 +1/+2 再挪 —— 这条动作归本单，不需要台账所有者拍板。
复量命令原样抄在这里：
`git show main:docs/reference/environment-traps.md | grep -oE "^[0-9]+\. " | tr -d ". " | sort -n | tail -1`
`git show main:docs/reference/environment-traps.md | grep -cE "^213\. "`

## 8.11 合流面现量（2026-10-04 05:0x，用 plumbing 预演，**没有对任何分支做合并**）

八行只差四端重装，而"什么时候装得有意义"取决于合流干净不干净。用一条零副作用的命令量出来
（`git merge-tree` 只写对象库，不动工作树、不动任何分支）：

```bash
git merge-tree --write-tree --name-only main feat/detail-pane   # rc=1 = 有冲突
```

**冲突 3 个文件**，逐条写清是谁跟谁撞：

| 文件 | main 侧 | 本分支侧 | 性质 |
|---|---|---|---|
| `docs/reference/environment-traps.md` | +626/−20（#182–#211，末笔 `a2a6541b`） | +26（第一版 #212/#213，现 #215/#216） | **纯文本撞在文件末尾** ⇒ 解法是两边都留。🔴 这一格 06:39 前一版写的是"**号不撞**（212/213 在 main 上现量空闲）"—— **那句在 05:0x 是真话，现在已经不真**：06:39 现量 main 最大号 **214**、**#213 被另一件事占了**（"落地之后才装"那道顺序门），只有 #212 还空着。⇒ 取号方自己挪到 215/216（见 §8.10 末段）。这正是 main 自己那条 **#206** 讲的事，原句：「main 每几分钟前进一笔 ⇒ 拿"载体 == main HEAD"当交付门是不可达的」—— **号也是一种载体读数**，"空闲"这个判断的保质期取决于别人什么时候把号写上 |
| `packages/app-host/src/habit-actions.ts` | +52/−9（`00b5065c`：回收站四类实体 + 删除四态，ADR-0048/0049） | +72/−9（W6 计数型 `value` / W8a 值与词同源） | 🔴 **语义合流，不是文本合流**：两边给同一批动作各加了一层前置 |
| `packages/app-host/tests/habit-actions.spec.ts` | +103（同一笔） | +122（同上） | 上面那对的判据侧，跟着一起判 |

**自动合干净的 6 个**：`apps/web/src/App.tsx`、`packages/app-host/src/index.ts`、
`apps/web/src/features/focus/store.ts`、`apps/web/src/styles/app/main-area.css`、
两个 i18n locale —— 其中前两枚正是 **W1b 这一轮改的那两个文件**，
所以本轮的接线在合流时不会丢、也不需要人判。

🔴 **本单不处置那对 `habit-actions` 冲突**：两边各是一条线的承重判据（删除四态 × 计数型 `value`），
"解成能编译"是最容易也最错的做法 —— 要两单的所有者一起确认**四条判据在合流后都还在**。
这一节是留给合流那一趟的现量，不是给谁的待办。

⚠️ **别照本节的数字行动**（这三行读数会漂）：`main` 在 09:4x–09:5x 又前进 7 笔后，
**冲突是 4 枚不是 3 枚**（新增 `docs/README.md`，两条线各修过同一行 —— 见 §8.29），
**"自动合干净"是 8 枚不是 6 枚**（新增 `e2e/tests/helpers.ts` 与 `packages/ui/src/notes/NotesBoard.tsx`，
两枚的语义逐枚判过 —— 见 §8.31）。复跑口径在 §8.30 末段那三条命令。

## 8.12 本单复跑里红过一次的一条用例：不归本单，但机制量清了（2026-10-04 05:41 现量）

电池第 22 步 `test web` 报 **1 failed / 1584 passed**，红的是
`apps/web/tests/reminders-panel.spec.tsx > B. 没有截止时间时只有绝对时刻入口 > 🔴 超过每任务上限时把错误显示出来，不静默吞掉`。
那是**提醒那一族**的界面用例（最后动它的是 `61536ed3`（10-01 15:39）"提醒上限用例的 8 次点击移进 act() —— flake 归因落地"），
本单没碰过那个文件，也没碰过它读的 store。

| 现量 | 读数 |
|---|---|
| 失败形态 | 该 spec 自己的 `waitFor`（`reminders-panel.spec.tsx:151`，`timeoutMs = 2000`）在 `:256` 那句"超上限的错误被记下"上超时 |
| 当时界面 | 抛错信息里带出的文本只有**两条**"待触发"（`10/4 06:41` 出现两次）⇒ 8 次点击只落成了 2 条提醒 |
| 单独复跑 | `vitest run tests/reminders-panel.spec.tsx` ×2 ⇒ **6 passed / 6 passed**；随后整条电池 25 步 `ALL_GREEN`（`test web` RC=0） |

机制（读 `:243-256` 那圈循环得到的，不是猜的）：上限是 5 条，而**同一触发时刻的提醒会幂等合并**，
所以那圈循环靠"每次点击的 `Date.now() + 1h` 都不同"去撞上限，两次点击之间只夹了 `setTimeout(3ms)`。
负载高时定时器被合并、多次点击落进**同一毫秒** ⇒ 合并成少数几条 ⇒ 永远撞不到上限 ⇒ 2 秒后 `waitFor` 抛。
⇒ 这条用例真正的前提是"8 次点击的 `Date.now()` 两两不同"，而**没有任何一层在守它**（同 §7 第 50 条那一族：
判据依赖一个环境给的量，环境不保证时它就以"偶发红"的形式回来）。

~~不归本单处置 —— 两条改法都住在提醒那条线手上~~（把触发时刻按点击序号推，例如 `i * 60_000`；
或给这一条装假时钟）。登记在此的理由只有一个：**下一轮看到它红，先别怀疑是详情面这一族弄坏的**。
复现读数：`cd apps/web && NO_COLOR=1 ./node_modules/.bin/vitest run tests/reminders-panel.spec.tsx`（单独跑必绿）。

🔴 **20:4x 改判并修掉了**（§8.90）：上面那句"不归本单处置"当时是按"这条线最近在碰提醒"的印象判的，
而归属门的判据是**同一文件的未提交 diff** —— 现量该文件在主检出干净、最后一次改动早已提交 ⇒ 本单可以动。
两条改法里选了第一条（按序号推进时钟，不用假定时器）；本节上面那条"告警用途"同时作废：
它不会再以"偶发红"的形式回来，若再红就是**新**缺陷。原句留着是为了让下一个人能复量当时的读数。


## 8.13 全量门禁扫描：这一族此前只验过 9/58 道门禁，扫出来那条红是本单的（2026-10-04 06:0x 现量；58 是 §8.14 第 1 条修正后的数，本节第一版写的 56 是探针截断的读数）

电池那 25 步覆盖的是 **9 道门禁** + 6 条 typecheck + 6 个包单测 + 2 步构建 + e2e 那一族，
而根 `check` 的组合里有 **58 道**门禁（🔴 本节第一版在这里写的是 56 —— 那个数是**我的枚举正则截断**出来的，不是仓库给的，全过程见 §8.14 第 1 条）。也就是说「这一族有没有把**别的**门禁弄坏」此前
**从没量过**。本轮量了：一次性脚本 `/tmp/dp_gates_sweep.py`（不提交）从 `package.json` 的
`check` 组合取清单、跳过要浏览器/真机的、把 `pnpm --filter` 类展开成各包自己的 node 命令、
逐条报 rc。

| 趟 | 现量（原样从落盘 stdout 解析，不手抄） |
|---|---|
| 修前 | `total=56 ok=44 red=7 skip=5 missing_env=0`<br>红 7 道：`check:docs,check:empty-state,check:journey-coverage,check:mobile-bundle,check:web-migration,check:web-storage,check:widgets` |
| 修后 | `total=56 ok=45 red=6 skip=5 missing_env=0`<br>红 6 道：`check:docs,check:journey-coverage,check:mobile-bundle,check:web-migration,check:web-storage,check:widgets` |


⚠️ 上面两行的 `total=56` 是**探针给的数**，不是仓库给的数：枚举用的 `check:[a-z0-9-]+` 不吃第二个冒号，把 `check:licenses:nuget` 与 `check:licenses:stamp` 折进了 `check:licenses`。按正确正则重扫的第三趟：`total=58 ok=47 red=6 skip=5 missing_env=0`，**红集与第二趟逐字相同** ⇒ 本节的归属结论不受影响，但总数是 58。全过程在 §8.14 第 1 条。
消失的那一条就是本单自己的：`check:empty-state`。新增的红：`无（红集只减不增）`。

### 七条红的逐项归属

| 门禁 | 真身命令（从 `package.json` 原样取） | 原始错误串（**摘进本节** —— 逐条日志写在 `/tmp` 同名文件里，下一轮就覆盖了） | 归属 |
|---|---|---|---|
| `check:empty-state` | `node scripts/check-empty-state.mjs` | `🔴 有 1 处**新的**手写空态：apps/web/src/features/focus/FocusDetailPane.tsx 形态：空态 testid` | 🔴 **本分支**：站点是 `9bdab17e`（W7 番茄右栏）新写的 `<p className="ht-app__detail-empty" data-testid="focus-records-empty">`。已修 `edd9971b` |
| `check:docs` | `node research/tools/docs-link-check.mjs` | ① `docs/plans/countdown-anniversary.md:1280` → `docs/adr/README.md` 的 §1（该章节号不存在）；② `PROGRESS.md:1362` → `docs/research/aed-implementation-evidence.md` 死链 | ① 是**检查器自己的假红**（引用写 `§1a`，解析器只吃数字，截成 `§1` 再查），不是倒数纪念日那条线 —— 2026-10-04 13:5x 已修，见 §8.48。② 是本分支落后 main 的读数：现量 `git log main..HEAD -- docs/plans/countdown-anniversary.md PROGRESS.md` **为空**（本分支没动过这两个宿主文件），且死链目标在 merge-base 的 `docs/research` 里 **0 命中**，登记不代改 |
| `check:journey-coverage` ⚠️**07:00 已闭合为绿**（见 §8.19） | `node scripts/check-journey-coverage.mjs` | `[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules directory due to no TTY` → `[ERROR] Command failed with exit code 1: pnpm install` | 载体：它内部经 `pnpm` 跑那条 spec，而 **pnpm 的 deps-status 预检自己会去调 `pnpm install`**（真身栈：`runDepsStatusCheck` → `runPnpmCli` → `sync`），在 linked worktree 里无 TTY 必拒 ⇒ **不是这道门禁要去装依赖**，机制与绕法见 §8.15；判据本身没跑到（它前面那几行旅程对账是 ✅） |
| `check:widgets` ⚠️**07:00 已闭合为绿**（见 §8.19） | `node scripts/check-widgets.mjs` | 报的是 `packages/widget-core/tests/fixtures.spec.ts:1 夹具与重建结果不一致`，而"代码"栏里装的就是上面那条 pnpm 无 TTY 报错 | 载体（同上）：它比的是**重建命令的输出**，输出是 pnpm 的报错 ⇒ 判成"不一致"。这是"载体不可用被读成产品违规"的形状，不是夹具真漂了 |
| `check:mobile-bundle` | `node scripts/check-mobile-bundle.mjs` | Metro `Unable to resolve module react-native-get-random-values`，脚本自己收尾写明「⛔ 打包失败（android）—— 门禁**没能运行**，这不是通过」 | 载体：脚本这句"这不是通过"是**对的**判据措辞，别把它读成红在产品。🔴 但**这一格原来写的原因（"本检出没有自己装过的 `apps/mobile/node_modules`"）07:00 现量被否证** —— 那个目录在，17 个条目，且 `react-native-get-random-values` 的两跳软链 `os.path.realpath` 解析到底**存在 package.json** ⇒ 真因是 Metro 不跟随 linked worktree 的软链节点（解析器策略），不是没装。见 §8.19 |
| `check:web-storage` | `node scripts/verify-web-storage-backend.mjs` | vite `server-fs-allow` 拒 `/@fs` 下主检出的 `@sqlite.org/sqlite-wasm@3.53.4-build1` → `page.waitForFunction: Timeout 60000ms exceeded` | 载体：§8 W1 行记着同一形状（linked worktree 的软链 node_modules 不在 vite 的 fs.allow 里） |
| `check:web-migration` | `node scripts/verify-web-migration.mjs` | 同上（同一台 vite dev 的同一个 `/@fs` 拒绝） | 载体（同上） |

⇒ **本单在别的门禁上没弄坏任何东西**：七条里一条是本分支的（已修），两条是别的线的文档引用，
四条是载体不可用。那四条在**本检出内无法判定红绿**，合流后要在主检出复跑；本单不为它们做任何
降级或跳过（那是替别人改判据）。
⚠️ **07:00 更正（见 §8.19）**：这四条里 **两条已经在本检出判出来了**（都是绿）—— 加一个
`--config.verify-deps-before-run=false` 就绕过了那条 pnpm 预检，判据本体照样跑。
所以本节的原判读**没算错当时的现场**，但把"绕法尚未试过"写成了"无法判定"。

### 修 `check:empty-state` 这一条时用到的三臂（`/tmp/dp_es_mutate.py`，一次性）

| 臂 | 注入 | 读数 |
|---|---|---|
| E1 | 把空态改回手写 `<p data-testid=...>` | 门禁 **RC=1**，且**点名的正是那个文件**（`形态：空态 testid`）；复原后复跑 **RC=0**：`✅ 没有新的手写空态（扫 152 个文件，24 个登记站点）` |
| E2 | 摘掉 `testID` 属性 | jsdom **红**（该 spec 自己的 `界面上找不到 focus-records-empty`）；重打产物后 e2e **红 1 / 绿 5**，红的正是 `F3 一条记录都没有时说的是那句话，而不是留一块空白`（`expect(locator).toBeVisible() failed`） |
| E3 | 摘掉 `<HeytaUiProvider>` 包裹 | jsdom **红**，错误串里是 `useHeytaUiTheme` ⇒ 这条缝**类型和 tsc 都不红，只有跑到才红**（AGENTS §5 与 `TrashView.tsx` 文件头记的是同一件事） |

每臂复原后按 sha256 逐字节回到干净态（`5572a484f010b16c`）。修后复跑：`apps/web` 全量
**1585 passed / 12 skipped**（与改前同一读数）、详情面 e2e 整族 **25 passed**、
`check:empty-state` / `ui-provider` / `design` / `l4` / `row-single-source` / `layering` /
`ui-language` 七道 RC=0。

🔴 **视觉不是"零变化"，别读成零变化**：文字色从 `color.foreground-muted`（`#475569`，白底
**7.58:1**）换成共享 `section` 档的 `color.foreground-subtle`（`#64748b`，**4.76:1**）——
仍达正文标准（4.5:1），但**这是共享实现规定的颜色**（`packages/ui/src/empty-state/EmptyState.tsx`
文件头那张"收编时要丢掉什么"的表就是这个意思）。改前/改后两张 `f3-empty-records.png` 都打开看过：
位置与排布不变（左对齐一行、紧贴"专注记录"标题、无图标、不撑高）。改后那张随本单提交，
因为它是当前产物的读数；其余四张被重跑改写几字节的（`no-sidebar-view` / `f1` / `f5` / `k6`）
按 §8 W1b 边界 ⑦ 还原。

### 这一节真正要留下的三条探针错（都是我自己犯的）

📌 这三条 + §8.14 第 1 条都够格进 `docs/reference/environment-traps.md`。
**本单不往那本账插行** —— 它是多会话共写的活台账，取号必须按**工作树**现量而不是按 HEAD
（§8.10 记过这条纪律）。登记在此即视为"待入 traps"，由收口那一轮统一取号。

1. **按命名规律猜门禁的脚本路径**。复跑时我写的是 `node scripts/check-design.mjs` /
   `node scripts/check-l4-no-style…`，其中 `check:design` 的真身在
   `design-system/heyta/check-hardcoded.mjs` ⇒ 得到 `MODULE_NOT_FOUND` + 退出码 1，
   **长得和"这两道也红了"一模一样**。现量命令必须从 `package.json` 原样取
   （`grep -E '"check:(design|l4)"' package.json`），扫描脚本本来就是这么做的 —— 手抄那一层
   才是错的来源。这是 §7 元规则第 1 条（先怀疑探针）的第五种面目。
2. **数 Playwright 用例数的正则顺序写反**：list reporter 的行是 `✓  3 [chromium] › …`
   （勾在前、序号在后），我写成 `^\s*\d+\s+✓` ⇒ 计数**恒 0**，于是 rig 的 `FINAL` 报
   `RIG_RESULT=NOT_OK`，而同一行里 `parsed` 的 summary 段明明写着 `6 passed`。
   真实读数全部从落盘日志按正确顺序重取（本节表里那些 `1 failed / 5 passed` 就是重取后的）。
   教训与前一条同族，但**新的是方向**：一个恒为 0 的计数列不会报错，它只会在**结论**里
   冒充"没跑几条"。⇒ 计数列要么喂一枚已知会命中的样本，要么删掉，只留退出码与 summary 行。

3. **把别人那条坏引用原文抄进自己的文档 = 给自己添了一条坏引用**。这一节第一版的表格里
   我照抄了检查器打印的那行读数（末尾指向 `docs/adr/README.md` 的 §1），
   下一趟 `docs-link-check` 就把**本文件**也报成同一处失效章节引用
   （现量：本文件 `:643` 那行被报指向 `docs/adr/README.md` 的 §1）。
   它扫的是 `<路径>.md §N` 这个**形状**，不认识"这是引文、是别人的读数"。
   ⇒ 抄读数要打断那个形状（现在写的是 `` `docs/adr/README.md` 的 §1 ``）。
   🔴 现量补一句：那个形状在本节里出现了**两处**（表格正文一处、行内代码一处），
   **两处都被算** —— 反引号不豁免，所以是改到第二趟才归零的。
   一般形式：**引用别人的错误，得先把它和检查器之间的形状隔离开**，否则你只是在复制那个错误。

⚠️ 一条证据寿命的账：扫描的**逐条日志**落在 `/tmp/dp_gates_check_<门禁>.log`，
第二趟同名覆盖。本节里那些错误串是在被覆盖**之前**抄进来的；下一轮要重取就得重跑那一趟。


## 8.14 一个我自己造出来的假发现、重装窗口的第三与第四次读数、两条被否证的怀疑（2026-10-04 06:1x–06:2x 现量）

### 1. 🔴 我差点把"58 道里有 2 道没人跑"写成一桩许可证敞口 —— 那是我的探针形状

事情的过程（按发生顺序，不美化）：

1. 我想给 §8.13 补一条"怎么复现这个总数"的一行式，跑出来是
   `defined=58 named_unique=56` ⇒ 看起来像**有两道 `check:*` 不在 `pnpm check` 组合里**。
2. 我去查那两道（`check:licenses:nuget` / `check:licenses:stamp`）有没有别的自动消费者：
   `grep -rln "licenses:nuget\|licenses:stamp" --exclude-dir=node_modules --exclude-dir=.git .`
   命中 7 个文件，**全部是文档 + `package.json` 自己**，没有 workflow、没有 hook。
   这一步的读数是**真的** —— 但它论证的是我下一步就要写的那个**不存在的东西**。
3. 单跑那两道：都 **RC=0**（nuget「8 个包全部宽松许可」；stamp「清单对得上当前 lockfile
   `111cc2d1d04d3763`」）。所以我正准备写的句子是"两条此刻是绿的敞口"。
4. 写文档时我顺手加了一句解释"为什么点名 58 次而唯一只有 56"，并说那是**重复点名**。
   那句话逼我去核它 —— 一核就穿了：`uniq -d` 意义上重复的是 `check:licenses`，**出现了 3 次**，
   因为我的正则 `check:[a-z0-9-]+` **不包含冒号**，遇到 `check:licenses:nuget` 就停在
   `check:licenses`。也就是说"58 次点名"里那 3 次是 `licenses` 本体 + 两个**被截断的子门禁**。

现量对照（同一份 `package.json`，两把正则）：

| 枚举正则 | 组合里点名的唯一门禁 | 与"仓库定义的 58 道 `check:*`"的差集 |
|---|---|---|
| `check:[a-z0-9-]+`（§8.13 那趟用的） | 56 | `check:licenses:nuget, check:licenses:stamp` ← **假的** |
| `check:[a-z0-9:-]+`（修正后） | 58 | `（空）` ← 空 |

⇒ **没有任何门禁是"没人跑"的**：58 道定义全在 `pnpm check` 的组合里。
⇒ 但扫描**确实漏跑了那两道**（枚举就是从这把截断的正则来的），所以 §8.13 的
`total=56` 要读成"探针看到的 56"。修正枚举后重扫第三趟：**`total=58 ok=47 red=6 skip=5 missing_env=0`**，
红集与第二趟**逐字相同**（`check:docs,check:journey-coverage,check:mobile-bundle,check:web-migration,check:web-storage,check:widgets`）⇒ §8.13 的逐项归属不受影响，只是分母从 56 改成 58。

📌 **可迁移的那一条**：差集类结论出来之前，先问一句
**"两边是用同一个词法解析的吗"** —— 我这次左边是 `Object.keys(scripts)`（完整名），
右边是正则片段（截断名），两个集合根本不在同一套 token 上，差集必然非空。
一个少算两项的枚举不会报错，它只会让差集**长得像发现**。
（同族：§7 元规则第 1 条；新的面目是"探针不仅会漏读，还会**凭空造出**一条待办"。）

### 2. 四端重装的第三与第四次占用读数（同一条队列，`etime` 已 3h15m）

| 时刻 | 读数 |
|---|---|
| 04:58（§8.10） | 负载 `71.93 / 45.50 / 28.54`，四个 PID `81007` `93771` `93817` `95477` |
| 05:37（§8.10） | 那四个 PID **一个没变** |
| **06:10（本轮）** | 同四个 PID 仍在，`etime` 最长 **03:01:31**（`sh /tmp/queue-reinstall-all.sh` → `bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817` → `bash apps/desktop-macos/scripts/package-app.sh /tmp/heyta-macos-dist`）；负载已落到 **8.62 / 11.01 / 14.73**；`adb devices` 只有 `emulator-5554` |
| **06:24（第四次）** | **同四个 PID、同一条链**，`etime` 走到 **03:15:30 / 03:12:24 / 03:12:23 / 03:12:03**；负载 `11.79 / 11.43 / 13.02` |

复量命令（每次现取，别照本节念）：
`ps -Ao pid,etime,command | grep -Ei 'reinstall-all|package-app.sh|package-msix|verify-mobile' | grep -v grep`

⚠️ 四个时刻同一批 PID + 负载从 71.9 掉到 8.6 又稳在 11 上下，这两组事实放一起
**指向前不是中性的**：既可能在跑后面的段，也可能卡在某一端。
**本单不判断，更不去动它**（那是别人起的队列、别的线的收尾）。
🔴 但本节原先设的那个条件**已经成立** —— "如果下一轮还是这四个 PID 就改写结论"，
第四次读数（06:24）仍是同一条链、`etime` 已 **3h15m**。所以从现在起这一步的措辞是
**"四端重装需要持有者介入"**：要么那条队列的所有者报一下卡在哪一段，要么产品负责人决定
把它停掉、让本单在隔离检出里重跑。**不再是**"等窗口空出来" ——
一直等一个可能已经停住的队列，等于把七行工单挂在无人认领的进程上。

### 3. 本轮被现量**否证**的另外两条怀疑（记下来让下一轮不必重查）

1. **"选中态门禁的断言 B 大概漏 `useState<T>()`（不带实参）这个形状"** —— 否证。
   `LOCAL_STATE_DECL` 要的是 `useState` 后面那个 `(`，**不要求里面有实参**
   （`scripts/check-selection-single-source.mjs:185-186`），所以 `useState<string | undefined>()` 会命中。
2. **"`QuadrantBoard.tsx:158` 那个本地 `activeId` 是第二个选中态所有者"** —— 否证，而且它自己就写着：
   `:148` 的注释点名"与 `activeId`（dnd-kit 的**正在拖**那条）无关，两个名字像但不是一件事"，
   读写点全在拖放回调里（`:250` `setActiveId(String(e.active.id))`、`:306` 拖拽提示）。
   门禁不报它也是**判决不是遗漏**：文件头负向对照 **N2** 就是拿它和 `editingRowId` 跑的（绿）。

### 4. 修后收尾读数

`/tmp/dp_w1b_battery.py` 第 6 趟：**25 步全 RC=0、`BATTERY_RESULT=ALL_GREEN`**，含 `test web`
（**1585 passed / 12 skipped**）、`build web tsc -b` + `vite`、`typecheck e2e family`、
`e2e detail-pane family` **25 passed**。`docs-link-check` 对本文件 **0 命中**。
门禁第三趟 `total=58 ok=47 red=6 skip=5 missing_env=0`。载体：`edd9971b`（代码）+ 本笔（文档）。


## 8.15 七行工单等的那一步，先在"产物可构建"这一层量过（2026-10-04 06:2x 现量）

§8 表里 W1/W2/W3/W4/W5/W6/W7 **七行都只剩同一件事**：AGENTS §6.1.1 的四端重装。
那个收尾要的是 `packages/*/dist` 与 `apps/web/dist` 都是当前源码的产物，
而 AGENTS 明写"门禁绿 ≠ 能打包"（本仓库踩过三次）。窗口没空的时候，能做的正确动作
不是干等，是**把重装真正依赖的那一层先量了**。

### 1. 🔴 `pnpm -r build` 在 linked worktree 里**结构性跑不了**，原因不是本单的线

| 趟 | 命令 | 读数 |
|---|---|---|
| 1 | `pnpm -r build` | **RC=1**，`[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY]`，栈是 `runDepsStatusCheck` → `runPnpmCli` → `sync` |
| 2 | `pnpm -r --config.verify-deps-before-run=false build` | **RC=1**，唯一失败项 `@heyta/sync-server@1.0.0 build: prisma generate && tsc` → **`spawn ENOENT`**（`server/` 在本检出没有自己的 `node_modules`，与 AGENTS §6 记的"沙箱里跑不了 `@heyta/sync-server`"是同一条） |
| 3 | 同上 + `--filter '!@heyta/sync-server'` | **RC=0**，**18 个项目 `build: Done`** |

⇒ **第 1 趟那条红不是任何一单的判据，是 pnpm 自己的预检**：任何经 `pnpm` 的命令在这个检出里
都会先被 `verify-deps-before-run` 拖去跑 `pnpm install`，而那一步无 TTY 必拒。
这一条同时**收紧了 §8.13 的归属**：那四道"载体红"里有两道（`check:journey-coverage`、`check:widgets`）
我原先写的是"这道门禁内部要跑 `pnpm install`"—— **不准确**，门禁没有要去装依赖，
是 pnpm 在替它装。原地改在 §8.13 那张表里（同一处，划线留原句旁边）。

⚠️ **绕法只有这一种，不许用 `CI=true`**：那个变量的作用是"不再询问、直接执行"，
pnpm 会**真的删掉并重建 modules 目录** —— 而本检出的根 `node_modules` 与 `e2e/node_modules`
是**指向主检出的软链**（§8 W1b 边界 ⑤）。删它等于删别人那棵树的依赖。
`--config.verify-deps-before-run=false` 只关掉预检，不动任何文件。

### 2. 第 3 趟覆盖到了什么、没覆盖到什么（别读多）

覆盖：14 个 `packages/*` + `apps/{web,landing,desktop,node-host}` 全部构建成功
（`pnpm -r build` 的清单就是这 18 项 —— 现量：`grep -oE "^[a-z0-9/-]+ build: Done"` 去重 18 行）。

🔴 **没覆盖：`apps/mobile` 的 JS bundle** —— 它**没有 `build` 脚本**
（现量：`node -e "...require('./apps/mobile/package.json').scripts.build"` ⇒ `undefined`；
有 `build` 脚本的 apps 只有 `desktop / landing / node-host / web` 四个）。
RN 的 bundle 发生在 `build:android` / `build:ios` 里，而那一层在本检出正好是红的
（§8.13 表里的 `check:mobile-bundle`：Metro 解析不到 `react-native-get-random-values`）。
⇒ 所以"能打包"这一层的诚实读数是：**web / desktop / landing / node-host + 全部 packages 已证，
mobile 的 bundle 未证（载体不可用）**。§7 第 27 条那个"APK 里是旧 JS bundle"的事故形状，
本单**没有**把它排除掉。

⇒ 对那七行的意义：四端重装在"产物可构建"这一层**没有本单的拦路项**，
剩下的未知全在移动端载体上，而那正是 §8.10 与 §8.14 第 2 条说的那一步要在
**有自己一份 `node_modules` 的隔离检出**里跑的理由。

### 3. 工单 §1 的第四道闸门：干净检出复跑（06:2x 现量，顺带换了一种更安全的臂形状）

`git worktree add --detach /tmp/heyta-dp-clean 1cd39ddc`（一次性检出，**不装任何依赖**），
把源码扫描类门禁全部搬过去跑：

`empty-state` / `layering` / `selection-single-source` / `row-single-source` / `l4-no-style` /
`migrations` / `ui-language` / `design` ⇒ **八道全 RC=0**。

🔴 更值钱的是第二半：**把 §8.14 的 E1 臂也搬进去重跑** —— 在干净树里把手写空态注回
`FocusDetailPane.tsx`，`check:empty-state` 同样 **RC=1** 且点名同一个文件、同一个形态
（`形态：空态 testid`）。⇒ 那条红与那条绿都**不依赖混合工作树**（不是"只在活树里成立"的第三种门禁红）。

📌 顺手记一条**臂的更好形状**：变异跑在一次性检出里，`restore` 这一步就**不存在**了 ——
不需要 sha256 比对、不会发生 §8.9 第 5 条那次"`git restore` 连自己未提交的修复一起抹掉"的事故，
也不需要"防留场"的收尾断言。代价是一次 `git worktree add` + 一次 `remove --force`（本单实测：
纯 node 门禁不需要 `node_modules`，所以连软链都不用搭）。
⇒ **只对源码扫描类判据成立**；jsdom / e2e 那两层要读 `node_modules` 与 `dist`，
仍得留在带软链的检出里跑（那两层的臂就继续用 sha256 复原比对）。


## 8.16 收口对账：四道闸门逐行打勾，照出"有一道绿是借来的"（2026-10-04 06:2x 现量）

### 1. 矩阵（先说清它是什么）

下面是把 §8 表 15 行逐行拿六个关键字去扫出来的**在场探针**：
`✓` 只证明"那一格里出现过这个词"，**不证明那件事做过**；反过来 `·` 也不证明没做，只证明**没记**。
它唯一的用途是找空栏 —— 找到之后逐栏去量（本轮就量出了第 2、3 两小节）。
⚠️ **其余列的 `·` 本小节不逐项追**，因为它们里有的是"不该有"：`W0` 是一条文档更正，本来就没有截图；
`W9–W12` 状态是未开工，六列全 `·` 是**正确**的读数。把每一格 `·` 都读成缺口，
就会造出一堆没有主语的待办（本仓库记过这个形状）。

| 工单行 | 归属门 | 棘轮 | 干净检出 | 先 build | 变异臂 | 截图 |
|---|---|---|---|---|---|---|
| `W0` | ✓ | · | · | · | ✓ | · |
| `W1` | · | · | · | · | ✓ | ✓ |
| `W1b 键盘光标` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `W2` | · | ✓ | · | · | ✓ | ✓ |
| `W3` | · | · | · | · | ✓ | ✓ |
| `W4` | · | ✓ | · | ✓ | ✓ | ✓ |
| `W5` | · | ✓ | · | ✓ | ✓ | ✓ |
| `W6` | · | ✓ | · | ✓ | ✓ | ✓ |
| `W7` | ✓ | ✓ | · | ✓ | ✓ | ✓ |
| `W8` | · | · | · | · | · | · |
| `W8a 值与词同源` | ✓ | ✓ | · | · | ✓ | · |
| `W9` | · | · | · | · | · | · |
| `W10` | · | · | · | · | · | · |
| `W11` | · | · | · | · | · | · |
| `W12` | · | · | · | · | · | · |

### 2. 第一个空栏：**已开工的 10 行里有 9 行没记"干净检出复跑"** ⇒ 以一次族级测量关掉

`W0`、`W1`、`W2`、`W3`、`W4`、`W5`、`W6`、`W7`、`W8a 值与词同源` 这 9 行的栏里没有"干净检出"字样（剩下那行是 `W1b`，它有；
另有 5 行状态是**未开工**，本来就没有可记的）。**先说清这条空栏的性质**：
它是"没记"，不等于"没做"—— 所以逐条去量，量完的结论是这一族（工单 §1 第四道闸门）
**在本单这一侧成立**，靠的是三条现量而不是印象：

| 现量 | 读数 |
|---|---|
| 本检出工作树 | `git status --porcelain` ⇒ 只有 `M scripts/mutate-closeout-gates.sh`（**别人的**，本单从头到尾不提交它）+ 两个未跟踪的 `node_modules` 软链（§8 W1b 边界 ⑤）⇒ **零未提交源码** |
| 主检出（别人真正在飞的那棵树） | `git status --porcelain -- apps/web/src/features/focus/ apps/web/src/styles/app/base.css apps/web/src/features/quadrant/ packages/ui/src/empty-state/` ⇒ **空**（本轮 06:2x 现量） |
| HEAD 的一次性 detached 检出 | 8 道源码扫描类门禁全 **RC=0**，且 E1 变异臂在同一棵树里同样 **RC=1** 点名同一文件同一形态（§8.15 第 3 条） |

⚠️ 这三条**合起来**才构成判据。单看第一条（"我这棵树干净"）不够 —— 混合工作树那一族的失败模式
恰恰是"红/绿只在混合态成立"，而混合态分布在**两棵树**里。

### 3. 🔴 第二个空栏更值钱：58 道扫描里**有一道绿是借来的**

把 `check:shell-unicode` 也在两棵树里各跑一次：

| 载体 | 读数 |
|---|---|
| 本检出（带着那 3 行未提交修复。⚠️ 06:57 复量更正：**不是从别人那棵树借的** —— 是本检出自己树里的未提交改动，且 main 早已修好，见 §8.18 第 1、2 条） | **RC=0** ✅「shell 脚本没有『变量名被非 ASCII 吞掉』的写法」 |
| HEAD 的一次性干净检出 | **RC=1** 🔴 三条逐字点名 `scripts/mutate-closeout-gates.sh:223` / `:232` / `:242`（`「$V1」` 被全角引号吞掉变量名） |

⇒ **§8.13 那句 `ok=47` 里有一道绿依赖工作树里的未提交修复，不是 HEAD 的绿。**
本单引用"全量扫描"读数时从今天起带这条脚注。

归属：**不是本单，也不是新发现** —— `docs/plans/goal-multi-end-coverage.md:1076` 早已写明
"HEAD 上 `check:shell-unicode` 是红的（3 处在 `scripts/mutate-closeout-gates.sh`，`cc974fbd` 提交）
⇒ 地界外不代改"。本轮做的是**在本检出里复现**它，并据此纠正我自己那句读数。
处置：不提交那个文件、不代改（那 3 行的修复正在别人的工作树里活着，我提交等于替别人决定怎么修）。

⚠️ **06:57 复量把上面这段的归因改掉了一半**（完整四载体读数见 §8.18）：修复**不在别人的工作树**，
就在本检出自己的树里（`mtime` 10-04 00:58）；而 **main 早在 10-03 17:30 `1a6640f2` 已把它提交掉**，
本分支只是落后 ⇒ 合流后这条红不留下来。"不提交那个文件、不代改"这个**处置照旧**（约束仍然有效，
而且现在更没有理由动它），但"我提交等于替别人决定怎么修"这句**当时就不成立**。

### 4. 逐行处置（做掉 / 改挂编号 / 不归本单，三选一写明）

| 行 | 处置 |
|---|---|
| W0、W8a | **做掉**（已完成，§8 表里状态就是"已完成"） |
| W1、W2、W3、W4、W5、W6、W7 | 代码 / 判据 / 变异臂 / 截图 / 四道闸门**都做掉**；**改挂**：唯一未闭合项 = AGENTS §6.1.1 四端重装 ⇒ §8.14 第 2 条已改写成**"需要持有者介入"**（第四次读数：同四个 PID、`etime` 3h15m） |
| W1b | 第一条腿（↑↓ 改选中）**做掉**；第二条腿"详情面跟着换"**改挂拍板 #1**，第三条腿"Enter 打开焦点"**改挂拍板 #8** |
| W8 | **改挂拍板 C1#2**（值与词同源那一半已作为 W8a 做掉） |
| W9 | **改挂**"补打卡窗口"决定 |
| W10 | **改挂** C1#9–12 |
| W11 | **改挂**"补录做不做 / 改时长做不做"（原题目"是否重开不做删除"随同行依据一起被否证，见 §8.21） |
| W12 | **改挂**"正计时那一轮算不算一个番茄"（原题目"要不要先动数据模型"被现量否证） |

🔴 合流时才消得掉的**不归本单**清单（逐条带出处，别读成"本单漏做"）：
① `habit-actions.ts` 的语义冲突（§8.11 合流面现量）；
② `reminders-panel.spec.tsx` 上限用例的负载 flake（§8.12，单独跑必绿）；
③ e2e 那 13 条类型错误分布在另外 6 个 spec（§8 W1b 边界 ③，`include` 因此只圈本单六个文件）；
④ `check:shell-unicode` 在 HEAD 上红（本节第 3 小节）；
⑤ `check:docs` 的两处引用（`countdown-anniversary.md` 的章节号 + `PROGRESS.md` 的 AED 死链，§8.13 表）；
⑥ traps 台账里与本轮三条探针错**撞号**的同名条目（§8.10 的取号纪律：按工作树取号，本单不插行）；
⑦ 🔴 本篇 §8 那张「单 / 状态 / 读数」表：main 那一侧带着**修表之前的整段旧抄件**（`| W1b |` 起到 `| W12 |`，
2026-10-04 17:0x 现量 13 行，候选树里落在产物第 175–187 行 —— 行号只用于本趟定位）。
其中 `| W10 | ⏸ 不在本篇开工 |` 那一枚的状态措辞**不在封闭三档里**，所以"两边各留一份"这种解法
不会有任何一层报错，只会让同一枚单在产物里有两个状态（本分支 `W4=进行中` vs 对面 `W4=未开工`）。
解这一处冲突时**取本分支那一侧、把对面那 13 行整段丢掉**；`check-detail-pane-status-table` 会在
孤儿腿逐枚点名（读数与判据见 **§8.68**）。

⇒ 工单 §1 四道闸门 + §4 验收动作 + ~~§6 六条不做~~ **§6 全部 9 行不做**，在**不依赖拍板的 W0–W8 范围内**逐项有账；
剩下的一步（四端重装）不在本单手里。
⚠️ "六条"是我从 Goal 措辞抄来的，不是数出来的 —— §6 那张表 2026-10-04 现量是 **9 行**，
逐行读数与三条坏探针见 **§8.39**（这一句写下时"逐项有账"对 §6 还是**主张**，不是**账**）。

### 5. 查过、量过、**判定不动**的一件事：回落规则要不要抽进 `app-host`

Goal 的措辞是"各处同一套状态与**回落规则**"，读起来像要把回落行为统一。逐条现量之后判定**不抽**：

| 现量 | 读数 |
|---|---|
| 工单自己的判据 | W1 判据 ② 原文是"换视图/切筛选后选中**回落规则明确**（照 `HabitsView` 的'存 id 不存对象 + 派生'）"—— 要的是**明确**，不是**逐字相同** |
| 规则现在住在哪 | web 习惯：`HabitsView.tsx:216` 的 `rows.find(...) ?? rows[0]`（派生，不是 `useEffect` 补 setState）；mobile 习惯：`HabitsScreen.tsx:204` 的注释写明**刻意不**落第一条（"它被删掉时回到清单"，理由：层级会说话）；任务/四象限/时间线：`activeTaskId` 直接透传，没有回落 ⇒ 详情面为空 |
| 共享层有没有这条规则 | `packages/app-host/src/selection.ts` 里 `fallback` / `firstRow` / `rows[0]` **0 处**（现量 `grep -c` ⇒ 0） |
| 所有者枚举（🔴 前两把正则都给了假结果，第三把才算对） | ① 只搜 `selectedId`/`activeTaskId`/`editingNoteId` ⇒ **65 处分布在 18 个文件**（那是"谁用了选中 id"，不是"谁在做回落决定"，两者不能混）；② 搜 `\w+\s*\?\?\s*rows\[0\]` ⇒ **0 命中**，而 `HabitsView.tsx:216` 明明就是这句 —— 因为 `??` 前面是 `)`，不是 `\w`；③ 换成 `\?\?\s*[\w.]+\[0\]` 扫 `apps/**` ⇒ **4 处**：`HabitsView.tsx:216`（唯一真的兜第一条）、`HabitsScreen.tsx:204`（**注释**，写明 mobile 刻意不兜）、`apps/landing` 两处（落地页自己的 `found ?? SITE_PAGES[0]` / `screens[active] ?? screens[0]`，与选中态无关）。⇒ **做"选中项没了怎么办"这个决定的产品代码只有一处** |

⇒ 两面的不同**是记录在案的取舍**（门禁 `check-selection-single-source.mjs` 文件头那张
"三面的行为"表就是它的账），不是静默分叉。抽一个 `resolveSelectedRow({rows, selectedId, fallback})`
技术上做得到（源文件在主检出零未提交改动，本轮量过），但那是**在判据之外新加一层抽象**，
而 AGENTS 的边界规则反对的正是这个形状。
📌 记这一条的理由：下一个读 Goal 那句"同一套回落规则"的人**一定**会想到同一件事，
先在这里给出"查过什么、为什么不动"，比让他重跑一遍枚举便宜。真要做，前置是把它写成
W1 判据的一条修订（要拍板），而不是顺手重构。

## 8.17 改号那一趟自己照出来的六件事（2026-10-04 06:39–06:51 现量）

触发：§8.11 记的"号不撞"过期，本单两枚 traps 条目与 main 的 #213 同号。动作见 §8.10 末段。
执行器是 `/tmp/dp_es_renumber_traps.py`（一次性脚本，不进仓库）。

| # | 照出来的 | 读数 |
|---|---|---|
| 1 | **改号落地了，但我写进撤回句的那条断言里有一枚占位符没替换** | 脚本第 3 处编辑的第二段字符串**漏了 `f` 前缀** ⇒ 计划里留下一句字面 `{WHEN}`。自检里数 `#21[23]` 的那几条**一条都抓不到它**（它不含 212/213）。抓到的方式是**把改完的 5 行逐行读了一遍**，不是把断言跑了一遍。🔴 一般规律：**计数型自检对"占位符没展开"这类形状天然瞎** —— 脚本产出的散文必须读，光有 `assert count == N` 不够 |
| 2 | 上一轮那句"main 上 #208 是刚撞的新例子"**过期了**；而我第一版给它的诊断（"从来就没被任何测量支持过"）**也是错的**，06:50 逐枚复量 commit 后改成下面这版 | `a2a6541b`（05:00）落笔时那一枚编号**确实写重了**（`git show a2a6541b:docs/reference/environment-traps.md \| grep -cE '^208\. '` = **2**）⇒ 那句话当时是真话。`bfdeea31`（05:32）把台账写坏到 `^208\. ` 命中 **0**、最大号取不出；`87f62b39`（05:34，原话"恢复台账被我的 18 字节 blob 写坏，并把 #213/#214 正确提进去"）把那条挪成 **#213** ⇒ 06:41 现量重复号集合 `1/2/3/4/38/93/94/95` 里已没有 208，今天 main 的 #208 正文是 iOS 截图。**真正的错法是给一条一次性读数没写时刻与载体**，不是"没量过"。📌 附带一条：**更正本身也会过期** —— 我这一版之所以带 commit 号，就是为了让它下一次能被复量而不是被重述 |
| 3 | 一次性读数在两分钟里又漂了一次 | 落后笔数 **374（06:35）→ 376（06:41）**；main 台账最大号两趟都是 **214** ⇒ #215/#216 到 06:41 仍空闲 |
| 4 | **我为了让"sweep 干净"可核验而写下的那条计数断言，被我自己的下一段话打破了** | 第一版落笔"还剩 **12** 处"，随后追加 §8.17 这段撤回记录时句子里出现了旧号 ⇒ 同一份文件变成 **14** 处，**断言当场失效**，而且是**记录撤回这件事本身**把它改掉的。改法：把承重的东西从"总数"换成**两条命令**（`grep -o '#21[23]' … \| wc -l` 只作现量、不作红判；真正要守的是"没有一处是活引用"，判据是逐行喂撤回标记）。📌 一般规律：**在会持续追加撤回句的文档里写死计数，等于埋一条自己会拆自己的断言** —— 要么写成命令，要么写成"存在性 + 归属"（这一处两者都写了） |
| 5 | 🔴 **同一族错误在同一个检出里复发了第二次**：把别人被门禁点名的形状原样抄进自己的文件，于是门禁多红一条，而那条红是**我的** | 上面"门禁"那一栏第一版把别单那条失效章节引用**照着写了一遍**（一个路径紧跟一个"§"加数字），`docs-link-check` 立刻把我的文件也报成失效引用 —— 反引号不豁免，这是这条线的门禁第二次以同一个形状红在本单文件上（上一次是 §8.13 那趟）。改法不是删掉记录，是**把那个形状打断**（改写成"那个不存在的章节号"），事实照旧、引用不成立。📌 一般规律：**转述一条违规，就是在生产一条新违规** —— 被扫描的形状不许原样抄，只许描述 |
| 6 | **这一族的成因量清了：未合并分支上的编号是临时值** —— 而且**合流面在改号后仍然只有同一处文本撞车** | 两笔改号相隔 4 分钟、方向相反：我 05:04 那笔（`11d1e61f`）按当时 main 最大号 **211** 取 212/213；他 05:34 那笔（`87f62b39`）按他自己修好的号段取 213/214。**两边各自相对 main 都成立**，撞车发生在"分支没合、彼此不可见"这一层，不在任何一方的操作上 ⇒ 规矩：**取号只能在合并动作前重取一次**（本单已把它写成动作，见 §8.10 末段与下面那句给合流的话）。06:49 用 `git merge-tree --write-tree --name-only main feat/detail-pane` 复量合流面 ⇒ **RC=1**，冲突文件仍是同样 3 个（台账那一处现在是**纯文本撞在末尾**、不再有同号；另两处是 `habit-actions` 的语义合流，不归本单）；载体 `main 领先 377 笔 / 本分支独有 31 笔`。至于 main 为什么跳过 212 留出一段空号 —— **未证实**，我不替别人的取号编理由（现量：`a2a6541b` 与 `87f62b39` 两份 blob 里 `^212\.` 都命中 **0**） |

**验收动作**（§4 那条"判据要能红"，这一趟的对象是脚本自身与文档断言）：

- **变异臂**：把同一个脚本**原样重跑** ⇒ `GUARD traps 锚点命中 0 次` + **RC=1**，且**两份文件逐字节没动**
  （06:45 现量：`md5 -q` 改前改后都是计划 `f2f18977…`、traps `782b56ec…`）。
  这一条证明那 3 个锚点是承重的 —— 脚本不会被静默重复应用成"改了两遍号"。
- **落笔数字与实量对账（06:45 现量，06:47 复量同数）**：计划里 `#21[23]` **14** 处 / **8** 行，逐行喂撤回标记
  ⇒ **7 行直接命中，第 8 行是同一句的换行续行**（行级测试的边界，写在 §8.10 那段里而不是把正则调成多行）；
  traps 文件里 `^21[23]\. ` 条目 **0**、`#21[23] 引用` **0**。
  ⚠️ 这组数**不是不变量**，是这一趟的读数（见上面第 4 条：上一版写 12，被这段记录自己顶到 14）。
- **门禁**（本文件命中数，改前/改后各一趟）：`node research/tools/docs-link-check.mjs 2>&1 | grep -c detail-pane-alignment`
  ⇒ 第一版 **1**（就是上面第 5 条那条我自己抄出来的），打断形状后复跑 **0**。
  整份输出仍然只剩**两条别人的** finding（`docs/plans/countdown-anniversary.md` 那一行的章节引用，
  以及 `PROGRESS.md:1362` 指向一个此刻不存在的研究文件）。归属现量：
  `git log main..feat/detail-pane -- 这两个文件`
  ⇒ **空**（本分支 29 笔一笔都没碰过它们），且两条在 **HEAD 上逐字已存在**（`git show HEAD:` 原样打印出那两行）。
  **本文件命中 0** ⇒ 不由本单吸收。
- **没有截图**：这一趟纯文档与台账编号，无界面产物 —— 按 §6 那~~六~~**9** 条不做的口径如实写明，不补一张不相干的图充数。

**给合流那一趟的动作（归本单，不需要台账所有者拍板）**：合并前重跑 §8.10 末段抄的那两条命令；
若 #215/#216 又被占，按当时 main 最大号 +1/+2 再挪一次。**不占 main 上那段空号 212** ——
不排除某条并行分支已按它预留。



## 8.18 把 §8.16 那句"有一道绿是借来的"重量了一遍：借的对象写错了，真因是**本分支落后 main**（2026-10-04 06:54–06:57 现量）

§8.16 记的是「`check:shell-unicode` 活树绿 / HEAD 红 ⇒ 那道绿是**别人的未提交修复**借来的」。
06:54 用**一次性 detached worktree**（`git worktree add --detach /tmp/dp_head_gate HEAD`，验完 `worktree remove --force`，
`git worktree list` 从 13 回到 13）把三份树各跑一遍门禁本体，四组读数是：

| 树 | `node scripts/check-shell-unicode-vars.mjs` | 被点名的文件 |
|---|---|---|
| 本检出的**活树** | **RC=0** ✅ | — |
| 本分支 **HEAD**（干净检出） | **RC=1** ❌ | `scripts/mutate-closeout-gates.sh` 的 :223 / :232 / :242 三行（`$V1`/`$V2`/`$V3` 紧跟全角括号） |
| **main**（干净检出，06:55 现取） | **RC=1** ❌ | `research/tools/r14c-window-retry.sh`、`scripts/verify-mobile-notes.sh`（**与本单无关的两枚**） |
| 主检出（别人那一树，未去动） | 未测 | —— 这一栏**故意留空**：上一版就是把它当已知才写错 |
| **合并态**（`merge-tree --write-tree main feat/detail-pane` 的树 `7ac70193` 用 `git archive` 摊开再跑门禁本体，06:57） | **RC=1** ❌ | 只剩 main 那两枚；`mutate-closeout-gates.sh` 在合并态里第 227 行是 **`${V1}`** —— **main 的版本胜出，本分支那条红不进去** |

⇒ 四条更正：

1. **借的对象错了**。让活树变绿的是**本检出自己树里那三行未提交改动**（`git diff --numstat HEAD -- scripts/mutate-closeout-gates.sh` = 3/3，
   `stat` 现量 `mtime` = **10-04 00:58**，比本会话第一笔提交 `edd9971b`（06:04）早五小时 —— 是更早一轮在这棵树里改的，没提交），
   不是"别人那一棵工作树"。
2. 🔴 **真因是"本分支落后"，不是"本分支欠债"**。`git log main` 现量：main 在 **10-03 17:30 `1a6640f2`**
   就把这三行修掉了（提交信息自己写着"同一缺陷的第二次"），本分支落后 377 笔所以 HEAD 还是旧形。
   **合流后这条红自动消失**（上面合并态那一行就是证明）⇒ 本单既不需要提交那枚文件，也不欠任何人一次修复；
   产品负责人"永远不提交 `scripts/mutate-closeout-gates.sh`"那条约束**照旧有效**，且与这里无关（本单没有动它）。
3. **main 今天自己仍红着这道门禁**（`research/tools/r14c-window-retry.sh` + `scripts/verify-mobile-notes.sh`，本单没碰过、也不随本单进来）。
   ⇒ "合并后 `pnpm check` 全量绿"这句话**不成立**，但**不由本单造成**；与 §8.13 那四条"载体不可用"是两种性质：
   那是测不了，这是**测得出、且 main 上已经是红的**。处置照既有纪律：**不吸收别人的债凑绿**，
   留现量命令给那条线：`git worktree add --detach /tmp/x main && (cd /tmp/x && node scripts/check-shell-unicode-vars.mjs); git worktree remove --force /tmp/x`。
   ⚠️ 顺带一条**过期读数**：`docs/plans/goal-multi-end-coverage.md:1076` 写的"HEAD 上 `check:shell-unicode` 是红的
   （3 处在 `scripts/mutate-closeout-gates.sh`）⇒ 地界外不代改"，在 06:56 现量下**只对 main 修好之前的树成立** ——
   那是别人那一行的文档，本单**只登记不代改**。
4. 📌 **一般规律：判"某道门禁红在谁身上"至少要跑四个载体** —— 活树 / 本分支 HEAD / main / **合并态**。
   06:2x 那一版只跑了前两个，就把"绿是别人借的"当成结论；加上 main 才看见"是落后"，加上合并态才看见"合流后不再红"。
   **少一个载体，归因就差一层，而每一层都长得像已经查完了。**

🔴 另记一条探针缺陷，免得下一个人重踩：我用 `grep -cE` 配一个「变量名紧跟全角括号」的正则去数 main 那份 blob 的违规行，
两份都报 **0**，而门禁本体在 HEAD 上报出 3 行 —— 这就是 §7 第 77 条那一族（**中文/全角在 C locale 下的计数不可信**）。
**判"某个形状在不在"要跑被审的那条门禁自己，别自己另写一个计数正则** —— 上面那张五行读数表里的每一行
都是门禁本体的退出码，不是我的计数。

## 8.19 §8.13 那"四条无法判定"里有两条其实判得出来 —— 绕法早就实测过，只是没套上来（2026-10-04 06:59–07:00 现量）

§8.15 为了跑全量构建，已经把 `--config.verify-deps-before-run=false` 这条绕法**在同一棵树上证过一次**
（绕开 pnpm 的 deps-status 预检，而不是用 `CI=true` 那种会 purge 共享 modules 的写法）。
06:59 把它套到 §8.13 表里"载体不可用"那四条上，两条**当场出判定、且都是绿**：

| 门禁 | 命令（原样，只多一个 flag） | 读数 | 判据本体跑到没有 |
|---|---|---|---|
| `check:widgets` | `pnpm --config.verify-deps-before-run=false run check:widgets` | **RC=0** ✅「小组件边界完好（扫描 12 个文件 + 4 份黄金夹具，5 条规则）」 | 跑到了 —— 上一轮它红的是**重建命令的输出被 pnpm 报错替换**，所以"夹具不一致"是载体噪声，不是产品 |
| `check:journey-coverage` | `pnpm --config.verify-deps-before-run=false run check:journey-coverage` | **RC=0** ✅ vitest `Test Files 3 passed / Tests 36 passed` +「每一端要么有旅程验收、要么有显式登记的缺口」 | 跑到了 —— 上一轮"判据本身没跑到"这句现在可以划掉 |
| `check:mobile-bundle` | `node scripts/check-mobile-bundle.mjs`（不加 pnpm 也一样） | **RC=1** ⛔ 仍判"门禁没能运行" | **没跑到**，但**原因被现量否证**：`apps/mobile/node_modules` 在（17 个条目），`react-native-get-random-values` 两跳软链 `realpath` 解析到底**目录存在且有 package.json** ⇒ 卡点是 **Metro 不跟随 linked worktree 的软链节点**，不是"没装依赖" |
| `check:web-storage` / `check:web-migration` | —— | **本轮没重跑**，原判读（vite `server-fs-allow` 拒 `/@fs` 下主检出的 sqlite-wasm）照旧保留 | 与 mobile-bundle 同族：**载体的解析器策略**，不是产品 |

⇒ 三条结论：

1. §8.13 那句"四条在本检出内无法判定红绿"**多写了两条**。正确的说法是：**两条已判定为绿，两条卡在解析器策略**。
   原判读没有算错当时的现场（那一趟确实拿不到判定），错在**把"这一种跑法不行"写成了"这道门禁判不了"**。
2. 🔴 **可迁移的那条**：**同一种绕法在同一棵树上被证过一次之后，所有以它为失败点的判定都必须先套一遍再下结论。**
   绕法是 06:2x 为全量构建实测的，四条门禁是 06:0x 量的 —— 中间隔了一次实测却没回灌，于是"无法判定"多活了四十分钟。
3. **合流那一趟仍然只剩两件**：`check:mobile-bundle` 与 `check:web-storage` / `check:web-migration`
   —— 且现在的预期写得更准了：**在主检出（node_modules 是真目录）里跑**，而不是"换个时间再试"。
   ⚠️ 本单**没有**为这两条重做变异验证：那两条门禁的判据不属于本单，给别人的门禁补"能不能失败"是替别人做事，
   本单只主张"判据本体这次真的跑到了、跑出来是绿"。

## 8.20 W1 那句"跨视图通用"补一次**按 ViewKey 全枚举**的对账（2026-10-04 07:0x 现量）

为什么要单独开这一节：Goal 的原话是"选中它可能需要应用到很多地方的，不能只应用到一个地方"。
W1 落地时登记的是**词表三类 + 门禁那张三面行为臂表**，但**没有把外壳的每一个面逐个对过**；
"有清单/标签/回收站/时间线的名字出现在要求里，而账本里只有 task/habit/note"这件事本身就该被读成一个疑点。
本轮按 `apps/web/src/features/shell/view-tabs.ts:113` 的 **`ViewKey` 全部 11 项**枚举，逐面现量。
取证方式：一次只读枚举 agent + 主线程**逐行读回**（结果：agent 给的 `TasksScreen.tsx:1046` 读出来是
`busyTaskId={busyId}`（拖拽忙态）不是选中态 ⇒ **不采信**，这一行的教训与 §8.16 ### 3 同族）。

| 面（ViewKey） | "当前哪一项"住在哪 | 是不是同一套 | 回落 | 详情面 |
|---|---|---|---|---|
| `tasks` | `useSelected('task')` `apps/web/src/App.tsx:237`，写入口 `:244` | ✅ 共享实例 `apps/web/src/lib/selection.ts:32`（`createSelectionStore`） | `App.tsx:791` 挂 `pruneSelectionFromEntities`（`lib/selection.ts:48`） | 接 |
| `quadrant` | **同一个 task 槽**投影：`App.tsx:2243` `<QuadrantBoard activeTaskId={selectedTaskId}>` | ✅ 同一份，不是又接一个 | 同上 | 接 |
| `timeline` | 同上：`App.tsx:2288 activeTaskId={selectedTaskId}` | ✅ | 同上 | 接 |
| `habits` | `HabitsView.tsx:181 useSelected('habit')` | ✅ | 🔴 **两面不一样**：web `HabitsView.tsx:216` `rows.find(...) ?? rows[0]`；mobile `HabitsScreen.tsx:115/157` 不兜第一条、退回清单 | 接 |
| `notes` | `NotesView.tsx:98 editingId = useSelected('note')` | ✅ | `:105` `?? null`（不兜第一条） | 接 |
| `search` | 局部光标 `App.tsx:1211 searchCursor`（走结果数组，不走 DOM） | 刻意**不进** selection，理由写在 `lib/keyboard-cursor.ts:66-68`；打开结果时才写共享槽（`App.tsx:593` task / `:1297` note） | `App.tsx:1248-1249` `activeSearchEntry = … searchEntries[searchCursor] ?? null` | 不接（浮层） |
| `trash` | 只有"二次确认目标" `TrashView.tsx:60 confirmingId`（`:66-69` 条目消失自动关） | 刻意不进表（`keyboard-cursor.ts:69`：↑↓ 在那里是"选恢复还是删除"） | 无 | 不接 |
| `calendar` | **没有"选中一行"**：它的"当前"是某一天 `features/calendar/store.ts:42 selected: LocalDate` | 与 `SelectableKind` 不同性质；共享板 `packages/ui/src/calendar/*` 里 `onKeyDown`/`ArrowUp`/`ArrowDown`/`tabIndex`/`role="grid"` **零命中** ⇒ 这一面今天没有任何键盘光标 | 跨零点自动带走到今天（mobile `CalendarScreen.tsx:69-75`） | 不接（⇒ 见下面缺口①） |
| `focus` | **没有"哪一项"**：`features/focus/store.ts:66 state`（计时状态机），关联任务只由 `start(taskId?)`（`:101`）带进来 | §6 明文"不许把番茄页塞进列表模型" | — | W7 的右栏读 `overview`，不读 selection |
| `growth` / `settings` | 面本身不是列表（图与卡 / 浮层面板） | 没有可走的行 | — | 不接 |
| **清单 / 标签**（rail 里的 PROJECT / TAG） | **不是选中，是筛选**：`ProjectsPanel.tsx:248`（清单）/ `:350`（标签）的 `onSelect` → `App.tsx:569 goToFilter` → `features/tasks/store.ts:235 filter` | 🔴 代码里写着为什么不进词表：`apps/web/src/lib/selection.ts:53-55`"清单/标签在两侧都是**筛选**（点它换中间那一栏）"；mobile 更硬：`ListsSection.tsx:174`"不传 `onSelect`：移动端没有侧栏筛选这个概念" | — | 不接 |

⇒ 三条判定：

1. **Goal 那句"不能只应用到一个地方"是成立的，而且成立的形状比"多处各接一份"更强**：
   任务 / 四象限 / 时间线**共享同一个 task 槽**（`App.tsx:2243/2288` 两处投影，不是两份状态），
   习惯与便签各占一个槽，两端各自只有**一份实例**（web `lib/selection.ts:32`、mobile `lib/selection.ts:30`）。
   现量门禁：`node scripts/check-selection-single-source.mjs` ⇒ RC=0，"2 份实例 / 宿主内本地选中态 **0** 处 /
   词表 3 类全有消费者（task 10 / habit 7 / note 13）/ 接线声明 17 处全部用起来"。
2. **清单/标签/回收站/日历/专注不进词表是记录在案的决定**，不是漏做 —— 每条都有代码注释或本节行号可指。
   ⚠️ 但本轮照出一个真的**文档缺口**：`CURSOR_VIEWS` 表外有六个 `ViewKey`，注释只写了两条理由（search / trash），
   **calendar / focus / growth / settings 这四条是空的**，读起来就像"忘了加"。
   ⇒ 本轮补的就是这一处（`apps/web/src/lib/keyboard-cursor.ts:63-84` 的注释，零行为变化；
   配套读数：`pnpm --config.verify-deps-before-run=false --filter @heyta/web run typecheck` RC=0 且 `error TS` 计数 0、
   `check:selection-single-source` RC=0、`check:layering` RC=0）。
   🔴 本节**不新增判据**，所以也不给它配变异臂 —— 注释类改动没有可失败的判据，硬造一条只会得到一条永真的检查。
3. **登记两条不归本单动手的缺口**（都不是 bug，是要拍板或属于别的时刻）：
   - ① **日历的"当前那一天"两端分叉且没有理由注释**：web 在 `features/calendar/store.ts:42`（zustand），
     mobile 在 `CalendarScreen.tsx:67`（屏内 `useState`）。要不要给它进词表、详情面对"某一天"显示什么 ——
     是 C1 **#1** 的延伸，属产品决定。本单**不擅自统一**（那等于替 #1 拍板）。
   - ② **专注的 `state.taskId` 是一个潜在的第二个 task 所有者**：今天由计时状态机持有、不进 selection，
     W7 的右栏也不读它 ⇒ 现在无冲突。但如果以后要在专注面上"指出这一条任务"，那里会变成第二个写 `task` 槽的地方，
     与 §3.5 那条"同形状的第二次"事故同族。登记在案，等真要做时先过这道账。

## 8.21 第三批一手调研：C1 的 #4 / #5 / #6 补齐、#7 关掉，**其中两条的前提被现量改写**（2026-10-04 08:0x）

Goal 的第 (1) 项要求"对卡住工单的待拍值做外部调研（别人怎么做的），带日期+出处+未核实标记"。
08:0x 那一批把剩下的三格补完了，成果全部落在调研 **C1b-Q4 / Q5 / Q6 / Q7**
（一手外链 **33 条 / 去重 32**，08:0x 现量，复数命令：`python3 -c "import re;t=open('docs/research/detail-pane-alignment-and-spaced-review.md').read();print(len(re.findall(r'https?://', t[t.index('### C1b-Q4'):t.index('## C2')])))"`。
**这是一个读数，不是不变量** —— 再往这四节里补来源就要重新数，见 §8.17 第 4 条那一族的教训。逐条带访问日期与「未核实」标记）。
三条**改变问题本身**的读数：

| # | 原来这张表怎么写的 | 现量之后 | 证据 |
|---|---|---|---|
| 5 | "它要先动数据模型（`FocusSessionKind` 无该值），牵动线协议与 `EntityModelMap`" | 🔴 **前提错了**：`FocusSessionKind = 'work' \| 'shortBreak' \| 'longBreak'` 是**阶段**不是计时模式（`packages/domain/src/entities.ts:317`）；真正卡住的是 `FocusActions.log` 里那条 `plannedMs > 0` 校验（`packages/app-host/src/focus-actions.ts:130`，注释在 `:128`）。**上游 Super Productivity 的做法是不给记录加模式字段**（`FocusModeMode` 只活在计时器状态里，落库只有时长），所以"要不要动 schema"是**结果**不是前提 | 两端代码现量 + 官方仓库（pushed_at 2026-10-03） |
| 6 | "滴答桌面端做法是'可补记不可删'；我们'不做删除'是已拍决定" | 🔴 **两半都要改**：滴答那条不对称轴是**平台**（移动端可删、桌面端明文不支持删除），被写成硬规则的是**时长不可改**（中文库与英文库的 MCP 页都是这句）；而我们的"不做删除"在代码里是**默认而非裁决** —— `FocusActions` 只有 `log` / `listSessions`，没有删除动作，`isDeleted`（`:121`）只是读侧尊重墓碑约定。**"别人都不提供删除"这个依据已被本轮调研否证**（滴答移动 / TickTick / Toggl 都提供） | 中英两版帮助中心逐字 + 两端代码 |
| 7 | "确认'番茄页不许塞进列表模型'继续有效"（挂着当待拍） | ✅ **关掉，不需要拍**：规范侧四处一致（`dida-view-unification.md` 的 §4.3 表 + 正文那句"统一是契约一致，不是形状一致" + 禁止表 + 迁移纪律，第 383/387/445/494 行）；代码侧五条调用形状（`<TaskList` / `<TaskRow` / `<ListSurface` / `toTaskRow(` / `useTaskList`）在专注相关文件里 **全为 0** | 见 C1b-Q7，含可复跑命令 |

🔴 顺手把**本调研文档自己的一条过期断言**改了：第 103 行一直写着"`docs/reference/architecture.md:129` 说 FocusSession 有
`mode(pomo/stopwatch)`" —— 那一行是**本单 W0 在 `0275867a`（10-03 19:25）就修掉的**，现在它写的是 `kind(work/shortBreak/longBreak),
plannedMs, actualMs?`，与代码逐字一致。原句划掉保留，因为它记着一个仍然成立的事实：**计时模式从来没被建模过**（这句才是 Q5 的起点）。

⚠️ 两条**探针教训**（都写进了 C1b-Q7，不重复展开）：宽口径 `grep` 命中的那一处是**注释**（`packages/ui/src/focus/FocusPanel.tsx:23`
拿 `TaskList.tsx` 的文件头解释 i18n 边界）——"命中不为 0"在这儿不代表产品违规；
而只在 `apps/web` 搜会拿到一个"看起来很干净"的空集合，因为共享的 `FocusPanel` 在 `packages/ui`、web 侧只有 `FocusTimer.tsx`。

⇒ 对状态表的影响：**W11（专注记录补录与删除）的阻塞项从"是否重开不做删除"改成两个更小的问题**
—— (a) 补录做不做；(b) 改时长做不做（两家同行明文拒绝，理由可推给统计不可复算）。
删除那一档**继续挂着**，但现在欠的是一条**我们自己的理由**，不是一个同行依据。
**#4 / #5 仍是待拍**，只是题目变了；本轮**没有替任何一格拍板**，也没有动代码。

✅ **那三处已在同一批里同步掉**（这句是"已做"不是"待做"，下一个读到上面那句"对状态表的影响"的人
不要再把它当 TODO）：**第二批表**（W11 / W12 两行的"范围"与"阻塞它的决定"四格，原句划线保留）、
**状态表**（W11 / W12 两行，含它们原本空着的证据列）、**移交清单**（W11 / W12 两行）——
每一格都改了题。
定位命令 `grep -n 'W1[12]' docs/plans/detail-pane-alignment.md`。**它只是定位，不是验收**，
而且这里**故意不写命中行数**：我第一版写了"现量 12 行 / 六个数占五行"，`grep` 一跑是 **13 行**，
而多出来的那行**就是写下"12 行"这句话本身** —— 计数被自己的陈述抬高，这是上面 §8.17 第 4 条的
原样复发，所以这里只留行号（56、57、172、173、977、978 —— 那是一趟读数，
**行号也会随文件增长而移动**，要用时现取）。

🔴 **我给它的验收判据也写坏过一次，坏法值得记**：第一版写"『是否重开不做删除』『要不要先加数据模型』
这两句只许出现在划线 `~~…~~` 里"。落笔后 `grep` 一遍，**它自己那行就是命中之一**，
另外状态表与移交清单那两格也命中 —— 那两处是**引述旧题**（"原登记…"/"原题目…"），
语义上完全正确，却一律不满足我那条字面判据。⇒ 一条**被自己的陈述句否证的判据**比没有判据更糟：
下一个 `grep` 的人看到几个命中，会判定"同步没做"，而它其实做了。
这是 §8.17 第 5 条那条规则（"转述一条被门禁点名的形状之前，先拿那条门禁的判据量一遍将要写下的这句话"）
在**自造判据**上的同一形状 —— 门禁换成我自己刚写的那句，结论一样。

✅ 改成立得住的写法：**旧题只许以被引述的形式出现**（划线 `~~…~~`，或由"原登记 / 原题目 / 从 X 改成 Y"
引导），不许**单独作为当前阻塞项陈述**。这句**不是机械判据**（"引述"是语义属性，不是可 grep 的形状）。
真要钉住它，得让 W11/W12 的阻塞项**来自一个可枚举的题面表**、由门禁比对那张表 —— 那是另一单，
本单不做（它不在 Goal 的 W0–W8 范围内，也不在任何已拍板项里）。下次改这两格时把这几行**读一遍**，
不能靠本句自证。

🔴 sweep 顺手照出**同一结论的第二份抄件**：调研第 101 行（Part A 逐元素对照表里"（对照）滴答桌面端
'仅可补记不可删'"那一格）在 08:0x 那批只改了 C1 表第 6 行，没动它 —— 于是它继续把被否证的同行做法
当硬规则陈述。已就地划线 + 指向 C1b-Q6，并补上"『不做删除』仍成立，但它现在是我们自己的立场、
欠一条第一方理由"。**这就是「同一个结论句落在两份文档 ⇒ 改一处必 sweep 全仓」**：本轮的复数命令是
`grep -rn --include=*.md "可补记不可删\|FocusSessionKind 无该值" docs`（**命中数不写死**，判据是
"每一处命中都读一遍，确认它要么在划线里、要么带『已否证』字样"）。
## 8.22 W1c：三张面的「选中」终于说同一种话（2026-10-04 08:2x–08:4x）

### 为什么现在做它（不是新需求，是把已拍的账补齐）

Goal 第 (2) 项的原话是「W1 选中态必须做成**跨视图通用**的机制」。§8.20 那张 ViewKey 全枚举表
把"哪些面接了状态"钉死了，但**没有量"看得不看得见"**。K7 那趟看图（05:0x）照出来的正是这个：
便签面上 ↑↓ 在走，列表里**一行痕迹都没有**。本轮把三张面的痕迹通道逐张现量：

| 面 | 底色 | 无障碍通道 | 现量出处 |
|---|---|---|---|
| 任务（列表 / 四象限 / 时间线共用 `TaskRow`） | ✅ `rowActive`（`color.primary-subtle`） | ❌ **没有** | `packages/ui/src/task-list/TaskRow.tsx:301`（改前只有 style 三元） |
| 习惯（web 自己的 `HabitsList`） | ✅ `habits.css:100` 的 `[aria-current='true']` | ✅ `aria-current` | `apps/web/src/features/habits/HabitsList.tsx:106` |
| 便签（共享 `NotesBoard`） | ❌ | ❌ | 改前 `NotesBoard.tsx:294` 那一行只有 `styles.row` |

🔴 一个"各处同一套"的一等状态，在三张面上有**三种可见性、其中一张完全没有** ——
这不是拍板 #1（"右栏放什么"）的题面：它问的是**左列表里那一行要不要让人看出来**，
而状态早就存在（`useSelected('note')`）、别的面早就在画。所以按 W8a 的先例拆出来做掉，
**不代任何人拍 #1**。

### 改了什么（四处，全在一颗默认值等于原行为的可选 prop 上）

1. `packages/ui/src/notes/NotesBoard.tsx`：新增 `activeNoteId?: string` + `rowActive`
   （**只加底色与圆角，不动几何**，与 `TaskRow.rowActive` 同 token）+ 行体 `aria-current`。
2. `packages/ui/src/task-list/TaskRow.tsx`：行体补 `aria-current={active ? 'true' : undefined}`。
3. `apps/web/src/features/notes/NotesView.tsx`：接线 `activeNoteId={editing?.id}`
   （用 `editing` 不用 `editingId`：id 已被别的设备删掉时面板不渲染，高亮必须跟着没有）。
4. 移动端 `NotesSection.tsx` **刻意不接** —— 它的编辑器是全屏 `Modal`
   （`apps/mobile/src/screens/NoteEditScreen.tsx:36`，文件头写明为什么用 Modal），
   编辑时列表根本不在屏上，**没有可标的行**。这是"零消费者是有意的"，不是漏接。
   （🔴 09:2x 把这处的**具体行号**量出来了，并据此把断言 F 的题面收窄 —— 见 §8.26 第③条。）

⚠️ `aria-current` 在 RNW 上到底会不会进 DOM —— **量过再写**（一次性探针 + 阳性对照 `aria-checked`）：
`<View aria-current="true">` → `<div aria-current="true" …>`，`undefined` 时属性整个不出现。
探针第一版读到空串，根因是**它在 `root.unmount()` 之后才读 `container.innerHTML`** ——
症状与"RNW 吞属性"一模一样。

### 判据（新增 `apps/web/tests/notes-selection-trace.spec.tsx` **9 条** + e2e **K8**）

A 组 3 条（看得见：恰好一行 aria、底色等于 token 推导值、两条线索同一行、换一条跟着走）·
B 组 2 条（**默认值=原行为**：不传 ⇒ 零行亮；id 不在列表 ⇒ 零行亮，不许退回第一行）·
C 组 1 条（任务面也带 `aria-current` ⇒ "同一套"是可核对的）·
D 组 3 条（**宿主接线**，读 `NotesView.tsx` 源文件 + 一条 `useState(` 计数为 0）。

### 变异六臂（`/tmp/dp_w1c_mutate.py`，一次性；臂与读数以本节为准）

基线先跑一趟做阳性对照：**25 passed**（新 spec 9 + `task-selection` 16）。
每条臂：改源码 → `tsup` 重建（判据读 dist）→ 跑两 spec → 还原 → 复验 md5。

| 臂 | 改法 | 红集 |
|---|---|---|
| N1 | 摘掉便签行的 `aria-current` | 2 红（A①、A③） |
| N2 | 恒亮（`style={[row, rowActive]}`） | 4 红（含 B① "不传就该零行亮"） |
| N3 | 恒不亮（`style={styles.row}`） | 2 红（A②、A③） |
| N4 | `active = activeNoteId !== undefined`（整列表一起标） | 4 红 |
| T1 | 摘掉任务行的 `aria-current` | 1 红（C①） |
| H1 | 宿主 `NotesView` 不递 `activeNoteId` | **第一趟存活（0 红）** ⇒ 补了 D 组后 **1 红** |

🔴 **H1 这一趟存活是本单真正产出的判据**，也正是记忆里那条：
共享组件加「默认值=原行为」的可选 prop，会把"宿主没接"伪装成"做完了"——
A/B/C 三组直接把 `NotesBoard` 挂起来跑，**根本不经过宿主**，所以摘掉接线它们照样全绿。
补 D 组（读宿主源文件）之后 H1 才红。⚠️ 顺手记一笔 D 组第一版自己也写坏了：
那条"不许出现第二个选中源"我最初写成正则 `useState<...note`，**它匹配不到任何东西**
（现量：`useState` 在 `NotesView.tsx` 里只出现在注释里，`useState(` 命中 0 次）
⇒ 改成"计数为 0"这种能被真代码推翻的形状。

### 截图（AGENTS §6.2 规定一：人不只看图，还要量图）

- 新增 `apps/web/evidence/keyboard-cursor/k8-notes-selection-visible.png` —— **看过**：
  中间那行「便签痕迹乙」带浅底，顶部编辑器里正是同一条正文，三处一致。
- 🔴 **证据 png 与载体绑定**（这一趟新量到的，不是推测）：其余五族 spec 的截图被我的手工 vite 载体重跑后，`selection-projections/01-list.png` 的主蓝命中从 **47 → 83**、`contentRatio` 0.15638 → 0.15553 —— 逐张看图找到的差别是**顶栏换行了**（暗色开关被挤到第二行，整页内容下移约 20px），与本单改的 `aria-current` 无关（它是惰性的：K1/K4/K5/K6 四张在同样两趟之间统计逐项相同）。⇒ **跨载体的截图不能拿来互证**，`contentRatio` 的差值在这种时候量的是排版位移不是产品变化。处置：把 10 张非本单证据 **`git checkout --` 还原**，只提交 K7（本单造成的真实视觉变化）与新增的 K8。
- 同一趟重跑了 K7 那张：`contentRatio` **0.0704 → 0.1071**，而主蓝命中数 **694 不变**
  ⇒ 唯一的视觉变化就是多出来的那条浅底（`primary-subtle` 不是品牌蓝，所以品牌计数不动）。
- 🔴 **W1b 那一行写的「七张图」是 05:0x 那趟的读数**，不要拿它当现量：这一族从这一趟起是 **8 条（K1–K8）**。
- K1 / K4 / K5 / K6 四张重跑后 `{宽,高,contentRatio,主蓝}` 与 HEAD **逐项相同**
  ⇒ `aria-current` 在视觉上是惰性的（复数命令：`node -e` 调
  `scripts/screenshots/png-stats.mjs` 的 `inspectPng` + `countBrandBlue`，
  HEAD 版本用 `git show HEAD:<路径> > /tmp/…` 取）。

### 门禁与全量读数（08:4x 现量）

九道门禁 **RC=0**：`check:design` / `check:l4` / `check:row-single-source` /
`check:selection-single-source` / `check:layering` / `check:rn-aria` / `check:empty-state` /
`check:ui-language` / `check:ui-provider`。**两道余量为 0 的棘轮没动基线。**
`apps/web` **1594 passed / 12 skipped（115 文件）**、`packages/ui` **459 passed**、
web 与 mobile `tsc --noEmit` **RC=0**、e2e 其余五族（`detail-column-slot` /
`detail-pane-overlay` / `detail-pane-collapse` / `focus-detail-pane` / `selection-projections`）**RC=0**。

### 🔴 我自己造成的两次读数事故（都写下来，不咽）

1. **用错 cwd 把 4 个文件读成红**：第一趟我从仓库根跑 `vitest run --root apps/web`，
   得到 `4 failed | 111 passed`。三份 spec（含我新写的那份）用 `process.cwd()` 读源文件，
   `--root` 不改 cwd ⇒ `ENOENT .../detail-pane/src/App.tsx`。**不是产品坏，是探针没吃对输入**。
   正确跑法是 `cd apps/web && ./node_modules/.bin/vitest run`，重跑 **115 passed / 2 skipped**。
2. **电池链第一版的退出码全是 `tail` 的**（§7 第 45 条原样复发）：
   `(cmd | tail -6); echo RC=$?` 量的是管道末端。整条链作废重跑，
   重跑改成"每段各自重定向到文件 + 紧跟 `echo *_RC=$?`"。

### 载体：linked worktree 里 e2e 的 dev 载体要先扩 `fs.allow`（**待入 traps #227**）

本轮第一次真跑浏览器判据（前一批 K 是借主检出的 dev 服务跑的，见 §8 W1 行那条「载体边界」）。
现量症状：`K1…K8` **八条同红**，红在 `openApp` 第一步找不到 `input[placeholder^="添加任务"]`，
页面快照里是「**无法初始化本地存储**」，vite 日志原文
`The request id "…/.pnpm/@sqlite.org+sqlite-wasm@…/dist/sqlite3.wasm" is outside of Vite serving allow list.`
机理：linked worktree 的**根** `node_modules` 是指向主检出的软链，wasm 走 `/@fs` 时
落在 vite 默认 allow list（只有 worktree 根）之外。

两条**不许做**的替代方案都不是假设：改仓库里的 `vite.config.ts`（把一个检出的目录形状写进产品配置）、
往主检出 `cp -R` 那个包（上一批就这么把一枚 pnpm 软链换成真目录，代价已记在 §8 W1 行）。
本轮做法：临时两份 `-c`/`--config` 覆盖件（`e2e/playwright.local-noserver.config.ts` 摘掉 `webServer`
避免 `reuseExistingServer:false` 去 SIGKILL 别人的端口；`apps/web/vite.tmp-e2e-allow.config.ts`
只加 `server.fs.allow`），跑完即删。手工起服务的两条命令：

```bash
cd e2e && node stub-provider.mjs &                       # 4319
cd apps/web && ./node_modules/.bin/vite \
  --config vite.tmp-e2e-allow.config.ts \
  --host 127.0.0.1 --port 4318 --strictPort &            # 4318
```

🔴 **本轮不往 `docs/reference/environment-traps.md` 追加 #227**：主检出那份台账此刻有
**289 行未提交新增**（`git diff --numstat` 现量），尾部编号已到 **226**（`main` 上是 214）
—— 往正被多个会话写的共享台账追加，就是上一批被抹回去的那个形状。
下一个窗口按工作树现量取号，把上面这段原样搬进去。

## 8.23 顺手修掉的两处**表格断列**（同属 §8.22 那一趟，2026-10-04 08:5x）

写 §8.22 时用一次性脚本量了整份工单的表格列数（数**未被反斜杠转义**的 `|`，与表头比），
照出 §8 表里两行**早就**多一个竖线：`W1b` 行里的 `…docs-link-check.mjs 2>&1 | grep -c …`、
`W4` 行里的 `（1 failed | 6 passed…` —— 两处都在行内代码里，而 GFM 表格**照样按它们分列**，
于是那两行各渲染成四格（第三格被截断、多出来的一格没有表头）。已各改成一个 `\|`。

⚠️ 修的过程中自己的第一版脚本差点把**正文里**同串的第三处也换掉（散文里的 `2>&1 | grep` 换了就是错字），
靠"命中数必须为 1"的门挡下了 —— 正确做法是**先按行锚点定位到那一行，再在行内替换**。
🔴 这一类**没有常驻门禁**（`check:docs` 只管链接与章节号，不管列数），所以它是读数不是判据：
下次动 §8 那张表时把同一个量法跑一遍。复数命令（一次性）：
`node /tmp/dp_w1c_tablecheck.cjs` 的形状 —— 按表头列数比每一行，转义符要先跳一格。

## 8.24 第七次重装窗口、合流面第二次现量，以及**我自己那条"共享目录被清"的错读数**（2026-10-04 09:0x 现量）

### 🔴 先撤一条：上一轮那个"主检出根 `node_modules` 只剩 3 项 ⇒ 共享 modules 被半清、什么都别跑"是**探针读数错**，不是环境事实

现量：`ls -1a node_modules` 列得到 `.cache` / `.modules.yaml` / `.package-map.json` / `.pnpm` /
`.pnpm-workspace-state-v1.json` / `.vite-temp` + `@heyta` / `@types` / `lunar-typescript`，
其中 **`.pnpm` 里 1185 个包**（`ls -1 node_modules/.pnpm | wc -l`），`.bin` 根本不存在（根包没有 bin 链接，正常）。
我那一趟用的是 `ls -1 | wc -l` ⇒ **点开头目录全被隐藏**，得到"3 项"就把它读成了"被 purge"。

- 后果澄清（不许顺势夸大成事故）：那一轮我因此**只跑了只读命令**，没有写坏任何东西，
  但这条错读数如果在 §8.14 后面接着被念，会让下一个窗口**误判环境不可用而放弃该跑的判据**。
- 这才是 §7 元规则 1（"先怀疑探针"）的日常形态：**少读数与空读数最容易伪装成事实**，
  因为"3 项"看起来是数出来的、不是没数到。
- 可迁移的自查：**目录"少了"先加 `-a` 再看**；凡是"N 项"这类计数读数，
  写下来时必须带上"这条 pattern 看不见什么"（这里看不见 `.pnpm`/`.bin`/`.modules.yaml`）。
- 反过来一条真结论：本 worktree 的构建与测试通道**没有**被这趟重装占用（`apps/web/node_modules/.bin/vitest`
  实存、`packages/*/node_modules` 是本检出自己的真目录，只有**根** `node_modules` 是指向主检出的软链）。

### 第七次重装窗口读数（09:0x）：负载在降，而那一趟**只装到本批的前半**（这一句在下一档被现量改过一次，见 §8.25 第二档）

| 读数 | 值 | 和前五次的关系 |
|---|---|---|
| `sysctl -n vm.loadavg` | **26.57 / 31.17 / 26.25** | 第五次 32.87 → 第六次 99.14 → 现在回落；仓库负载门阈值 **12** ⇒ **仍未到我可以起活的窗口** |
| `ps -eo pid,etime,command` | `81007` `sh /tmp/queue-reinstall-all.sh`（5h54m）、`93771` 同（5h51m）、**`93772` `pnpm reinstall:all`（5h51m）**、`93817` `bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817` | 排队的那条已经进到 **`pnpm reinstall:all` 本体在跑**（上一记只看到 wrapper 与 snap），载体是隔离检出 `/tmp/heyta-reinstall` —— 这正是 memory 里"重装改在隔离检出里跑"那条配方 |
| 那个载体的 HEAD | `git -C /tmp/heyta-reinstall rev-parse --short HEAD` = **`d0a81927`**，`## HEAD (no branch)` | |
| 本批在不在里面 | `git -C /tmp/heyta-reinstall merge-base --is-ancestor 6ee85fda HEAD` ⇒ **RC=1** | ~~这一趟四端重装装不出本批的产物，W1/W1b/W1c/W2–W7 一格没装~~ → **09:1x 逐笔现量否证了这个一刀切**（过程见 §8.25 第二档）：tip 确实不在，但 `d5b835b5` / `0de58095` / `0c159f7f` / `84d5bd86` / `f419df75` 对这枚载体都 RC=0 ⇒ **W1 的真浏览器载体段、W2 的第四列槽位、W5 的描边即优先级会随这一趟装上**；而 `dbb3a297`(W4) / `ca2cf606`+`577c0f3e`(W6) / `9bdab17e`+`edd9971b`(W7) / `1dd23d25`+`4b17213a`+`de5d4ef6`(W1b 后半) / `b3a5a17d`(第三批调研) / `6ee85fda`(W1c) 仍 RC=1 ⇒ **这几单一格没装**，§8.14 那句"需要持有者介入"对它们继续成立 |

~~结论没变、理由更硬了一格：不是"别人在占用所以我不跑"，而是"这一趟跑的载体里根本没有我的代码"~~
→ 09:1x 否证：**载体里有我的代码，只是只有前半批**（那五笔在 `f419df75` 之前就已并进 main）。
正确的问法是**逐笔** `--is-ancestor`，不是"整批在不在"——一句"根本没有"让我差点把
"W2 的槽位与 W5 的描边此刻正在被装上设备"这件真事写成"什么都没装"。
本轮没有起任何装/构建类动作，只做了下面这些只读现量。
🔴 但有一笔要记在我自己头上：我把 `check:docs` / `check:docs-voice` 用 `pnpm run …` 跑了一趟，
pnpm 的 deps-status 预检当场试图**移除共享的 modules 目录**，只因无 TTY 才中止
（`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`）。复核现量：主检出根 `node_modules` 仍是
3 个可见项 + `.pnpm` **1185** 个包，没被删 —— 这是 §8.15 第 1 行那条的复发，
而这一次差一点撞在别人那趟正在跑的四端重装上（第三档写明了改法）。

### 合流面第二次现量（plumbing 预演，**没有对任何分支做合并**）

`git merge-tree --write-tree --name-only main feat/detail-pane` ⇒ **RC=1**，冲突**只剩 3 个文件**：

1. `docs/reference/environment-traps.md`（台账追加面，与倒数纪念日那条线撞）
2. `packages/app-host/src/habit-actions.ts`
3. `packages/app-host/tests/habit-actions.spec.ts`

其余全部 `Auto-merging` 且无冲突，包括此前我担心会撞的那几处：`apps/web/src/App.tsx`、
`apps/web/src/features/focus/store.ts`、`apps/web/src/styles/app/main-area.css`、
`packages/i18n/src/locales/{zh-CN,en}.ts`、`packages/ui/src/notes/NotesBoard.tsx`、`e2e/tests/helpers.ts`。
距离：`git rev-list --count feat/detail-pane..main` = **416**，反向 **37**
（06:41 那一记是 **376**，见 §8.17 末段 ⇒ 两小时二十五分钟里 main 又走了 40 笔；
这条线每小时约 16 笔，写这里是为了让下一记可比）。

🔴 这三处**只有倒数纪念日那条线能定**（2、3 是它自己在改的 `checkIn` 形状，1 是它正在写的台账追加），
本批既不代解也不预解 —— 代解就是 §7 里"造一次没人能干净解的三方冲突"那个形状。
给持有者的可复跑命令就上面那一行，它不会动工作树（只往对象库写 tree/blob，不移动任何 ref）。

### `check:docs` 的两条外来红：**合流会自行关闭**，这一轮把"为什么"量出来了（不再只是断言）

本分支工作树现量 `node research/tools/docs-link-check.mjs`（完整输出，不是 `tail`）：

```
检查 441 处跨文档章节引用。
检查 54 处页内锚点。
🔴 1 处失效的章节引用：docs/plans/countdown-anniversary.md:1280 -> docs/adr/README.md §1（该章节号不存在）
🔴 1 个死链：PROGRESS.md:1362 -> docs/research/aed-implementation-evidence.md
```

🔴 **我自己的一次读数事故（差点写错结论）**：第一趟我用 `tail -6` 看输出，只看到最后那组 ⇒
读成"countdown 那条已经没了、只剩 1 条"。完整输出是 **2 条**，和前几记一致。
`tail -N` 对"分组的报告类输出"就是错的取法（组与组之间有空行），要看就看全文或按标题 grep。

关键的是**同一两条在 main 上的形状**（`git show main:`，不看工作树）：

| 那条红 | 本分支（落后 416 笔） | **main HEAD `d544d73c`** | 所以 |
|---|---|---|---|
| countdown `:1280` 那处小节引用 | 第 1280 行是**裸文本**：那份 ADR 台账的路径 + 一个 `§` 号小节号（就是 checker 报的形状） | **同一句已被改写成真的锚点链接**：`git show main:docs/plans/countdown-anniversary.md` 第 **1295** 行是一个 `[标题](…#那个 1a 小节的 slug)` 形式的页内锚点，不再是 `§` 号写法 | 那条"章节引用"在 main 上**已不存在**（它换成走页内锚点那一条检查）⇒ 合流即关闭，且**不需要任何人去改那一行** |
| `PROGRESS.md:1362` | 目标文件在本分支 tree 里**没有** | `git ls-tree HEAD -- docs/research/aed-implementation-evidence.md` **有** | 同上，合流即关闭 |

🔴 **我照抄那一串，自己就变成了第三条坏引用**：本节第一版把上面那行原样写进了表里，
`docs-link-check` 立刻把它报成 `detail-pane-alignment.md:1421 -> … §1 该章节号不存在`
（现量在 `/tmp/dp_linkcheck2.txt` 第 8 行）。这与 §8 表 W7 那行末尾登记过的坑是**同一个**：
**描述坏链要说形状，不能照抄那一串** —— 反引号包起来不豁免它，代码块里那两行倒是没被报（它扫的是行内 `§` 引用）。
已改成上面这种"说形状"的写法，复跑回到只剩那两条外来的。
📌 顺手量到的一条关于**这个检查器范围**的事实（之前没人写过）：围栏代码块里的 `路径 §号` **不扫**，
行内反引号里的**扫**。本轮那个代码块原样引了报错文本而零命中，就是这条的现量。
⚠️ 同一趟还有第三次读数事故，形状是 §7 第 45 条那一族：我把
`grep -c 'detail-pane-alignment' … && node /tmp/dp_tablecheck2.mjs …; echo "TABLE_RC=$?"` 串在一起跑，
`grep -c` 命中 0 时**退出码是 1** ⇒ `&&` 右边那条**根本没执行**，而 `TABLE_RC=1` 看起来像"表格检查红了"。
拆开单跑才是 **MISMATCH=0**。链式命令里"某条正常地没命中"会静默摘掉后面的命令 —— 这已经是本段第三次了，
**每一段各自重定向、各打各的 RC**（§8.22 那条纪律的同一条）。

这把探针（一次性只读，`/tmp/dp_docscheck.mjs`：喂 `git show HEAD:<file>` 的内容、**不读工作树**，
因主检出此刻 239 项未提交，读工作树会把别人在飞的活算进来；逐条比"目标文件在 tree 里有没有" +
"锚点在那份文件里是不是一个真标题"）：main HEAD `DEAD_TOTAL=0`、本分支 `DEAD_TOTAL=1`（就是 AED 那条，`file=false`）。
🔴 那个 1 就是双向对照本身 —— 同一段逻辑在 branch 上响亮地抓到已知那条、在 main 上报 0，所以 main 的 0 **不是空转**。
⚠️ 但它的范围只有"文件存在 + 标题锚点"，**`§1a` 那一类章节号引用不在它能力内**（checker 自己 `:285` 起才是那一族），
所以章节号那条我是用上面那张"裸文本 vs 锚点链接"的形状对照量的，不是用这把探针。
🔴 结论的强度也要照此写：**"两条都会在合流后自行关闭"是现量**，而 `check:docs` 在合并载体上真的绿，
仍要在那棵树上跑一次上面那条命令才算数 —— 本分支这一趟是 **RC=1**。
📌 这一节**改写的是措辞强度不是处置**：§8.1 表里那一行、以及 §8 表 W1b / W7 两行里"`check:docs` 红但不归本单"那段，
处置仍然是**登记、不代改**（不改是对的 —— 改它只会得到"我的分支去替 main 修一遍它已经修好的东西"），
变的只是那句"**合并后自行关闭**"：以前是按"本分支落后 main"推的，现在是按上面那两行形状对照量出来的。

### 常驻门禁的断言 F 还是没落，载体仍在别人手里（现量到 09:0x）

> 📌 **2026-10-04 10:4x 补一行，别把这一节读成"F 已经落成了 §8.36 那条"**：F 到今天**仍未落**，
> 而且 §8.36 那条新判据一度**占用过 F 这个号**（后按本节的题面改名为 G）。
> 这一节写的题面 —— "每张有选中态的面必须把选中说出来，常驻化要带变异臂" —— 才是 F 的立项原文。
> 载体那一道**本节末之后已经解开**：那枚文件现在在主检出是干净的，`objectSpreadUseOf` 那 79 行已提交在 main 上
> （但**还没进这条分支**，读数与后果见 §8.36 前置那一小节）。
> ✅ **同一天 10:5x 这条 F 落了**，按本节题面实现、九臂带两条阴性对照，见 **§8.37**。

`git diff --numstat -- scripts/check-selection-single-source.mjs`（主检出）= **+79 / −4**，和上一记逐字相同；
`grep -oE '断言 [A-F]'` 对工作树和 `git show HEAD:` 两份**都只得到 A–E** ⇒ 那 79 行是给**断言 E** 扩
对象展开识别（`objectSpreadUseOf`），**不是新增了 F**。
所以 §8.22 那条"每张有选中态的面必须把选中说出来"目前只有**一次性判据**在顶（`apps/web/tests/notes-selection-trace.spec.tsx`
+ e2e K8），常驻化要等 E 那笔落地。题面我不动别人的文件去抢 —— 下一轮在**它干净之后**提，且带变异臂（
把 `NotesBoard` 的 `aria-current` 摘掉必须红）。

### 台账取号现量（同上一记，没有变）

`git diff --numstat -- docs/reference/environment-traps.md` = **+289 / −0**，工作树尾部编号 **226**、
`git show HEAD:` 的尾部编号 **214**（`grep -oE '^[0-9]+\. ' | sort -n | tail`）。
⇒ **`§8.22` 那条"待入 traps #227"仍然只是登记，不落笔**：编号按**工作树**取（不是 HEAD），
而 226 之后是不是我的号，取决于收口那一刻谁先落笔 —— 这正是上一批被整文件 `git add` 抹回去的成因。
⚠️ 顺带一条量法提醒：`grep -cE '^[0-9]+\. '` 在这份文件上是 **235** ≠ 最大编号 226，
因为条目正文里的有序子列表也顶格。取号只认 `sort -n | tail`，别拿条数当号。

## 8.25 同一趟里量出的三件事：半批其实已经在 main 里、W0 的②从来没有落地、`pnpm run` 差点拆掉共享 modules（2026-10-04 09:1x 现量）

### 第一档：W0 的第②项**从未落地**，本行此前写"✅ 已完成"是过度主张 —— 当场按五档逐项现量改掉

登记时我写的是"改动作废在工作树里，**由下一次整文件提交带进去**"。
09:1x 复量：`git show feat/detail-pane:docs/README.md | grep -c '代码未开工'` = **1**、
`git show main:docs/README.md` 同句 = **2**（一处是 ADR-0043 那行，一处是我自己那份调研行里合法的另一句），
而工作树对该文件干净 ⇒ **那句"下一次整文件提交"没有发生**。
📌 这是一条通用错法：**把交付挂在"别人下一次会顺带带走"上，等于没交付**，
而登记句本身读起来像已经安排好了。状态列因此不能写 ✅ —— 它当时就该是 🔄。
⚠️ 顺手记一条自己刚造的错：那笔提交（`96e7519b`）的标题写"那句'代码未开工'其实**三周前**就过期了"，
现量是 **2 天**（ADR-0043 接受于 2026-10-02，本单第一次试图改它在 2026-10-03）—— 正文与本节才是准数，
标题里那个跨度是我顺手写的、没取证的数。**提交信息里的时间跨度也算断言**，写它要过和正文一样的门槛。
🔴 同一趟还有第二处，形状不一样但更阴：我那句 README **替换文本里把旧短语原样引了一遍**
（"原句『…』是三周前的状态"），于是改完之后 `git show HEAD:docs/README.md | grep -c <旧短语>` **仍然是 1**。
⇒ 下一次有人用这条命令问"那行修好了没有"，会得到"没修"。**改过期断言时不许把那句原样留在同一份文件里** ——
这与 §8.22/§8.23 那一族（抄坏引用会给自己添一条）是同一机制的反方向：那条是"别抄进来"，
这条是"改出去的别又抄回来"。已改成"这一行此前挂的是『尚未开工』"（换个写法，不留可命中的原串），
现量 `grep -c <旧短语>` = **0**、新句 = 1。

改之前先把"未开工"这句证否（不是把它反过来写一句新断言），ADR-0043 §7 那五档逐条取代表：

| §7 那一档 | 现量 |
|---|---|
| 1 `Task` 两字段 + `TaskActions.setSchedule` + store 外观 | `packages/domain/src/entities.ts:143 startDate?`；`setSchedule` 在 `packages/app-host/src/actions.ts`，消费方 `apps/web/src/features/tasks/store.ts`、`App.tsx`、`features/timeline/TimelinePanel.tsx` |
| 2 三态推导 + note 回退 | `deriveTaskTimePosition` 在 `packages/app-host/src/timeline-plan.ts`，读时回退在 `packages/app-host/src/duration-note.ts` |
| 3 `range` 条渲染接线 + 拖拽手势 | ~~（第一版到这里就停了）~~ 🔴 **09:4x 复测：这一档只落了 web 半，我上一版把它整个记成"落地"是过度主张** —— `packages/ui/src/timeline/TimelineBoard.tsx:133-219` 那组 `onStartShouldSetResponder` + `dragRef` / `dragPreview` 全在 `onScheduleTask === undefined` 的开关后面（`:448`、`:577`、`:617`、`:623`、`:633`、`:658`、`:695` 七处分支），而 web 传（`apps/web/src/App.tsx:2274`）、**mobile 不传**（`apps/mobile/src/screens/TimelineScreen.tsx:59-67` 只给 `rows`/`labels`/`onOpenTask`/`activeTaskId`/`compactTicks`/`testID`）⇒ RN 端那三条 responder 一行都不接。ADR 原文其实把这一档写成"web Pointer 优先，移动端手势在 goal §4 的 P3 列表"，**是它对的、我读漏了半句** |
| 4 判据（op 形状 / 离线刷新 / 绕过 dispatch 的变异） | `apps/web/tests/timeline-schedule.spec.tsx`（describe 原句「拖拽 → setSchedule → 恰好一条形状正确的 op」）、`packages/app-host/tests/set-schedule.spec.ts`、`packages/app-host/tests/timeline-plan.spec.ts`、`packages/domain/tests/timeline.spec.ts`。⚠️ **骨架 2 的形态要说清**：它不是"真刷新一次浏览器"，而是文件头 `:11`/`:55` 自己写的"引擎重放出的物化状态就是离线刷新后看到的东西"（同一文件 `:14` 把骨架 3 写成"把 `store.setSchedule` 改成绕过 dispatch 直改实体"的**变异设计**）—— **这一臂我这一轮没有取证它跑过**，要取证去 `plans/goal-timeline-rework.md`，别把我"文件存在"读成"三臂都红过" |
| 5 i18n 中英同步 | 排期相关键 zh **7** / en **7**（`sort -u \| wc -l` 两侧同数） |

⇒ ~~README 那一行改成"🔄 P2 的五档代码到 2026-10-04 已全部落地"并逐条带上 `file:line`~~
**这句在同一个 09:4x 被上面的第 3 档否证了一半，已第二次改掉**（现在是"3/4/5 三档已落、第 3 档只有 web 半"）。
🔴 这一条值得留原句：它不是别人写错、**是我把"共享层有这组代码"读成了"两端都接上了"**，
而分辨两者的唯一办法是去数消费者传没传那个 prop —— `TimelineScreen.tsx:59` 一眼就看得出来。
同一句"未开工"~~还留在那份 ADR 的 §7 标题里，本单不动别人的 ADR，登记为抄件漂移~~ ——
**09:4x 复测：那句标题在 `main` 与本检出逐字节相同**（`git diff --quiet main HEAD -- 那份 ADR` 无输出），
也就是说两条线各修了 README、**谁都没修 ADR 的 §7**。处置不变（不在本单改别人的 ADR），
但登记理由换了：进度主人是 `plans/goal-timeline-rework.md`，README 只该是指针。
复跑（都用 `node` 直调，见第三档）：`check:docs-voice` **RC=0**（扫 1028 条、禁词 30 项零命中）、
`check:claims` **RC=0**、`check:reachability` **RC=0**、`docs-link-check` 对 `docs/README.md` 与本文件各 **0 命中**
（外来那两条不变），README 那张表 **139 行、列数零不一致**。

### 第二档：本批的**前半已经在 `main` 里**，所以"装的不是本批"那句是错的（已原地划线）

`git branch -a --contains 84d5bd86` 列出 `main`、`integrate/2026-10-03-closeout`、`feat/self-host-merge-main`
⇒ 这条线在 **2026-10-04 01:16（+08）** 那一笔（`f419df75`，"W5 逐项对账…"）**及其之前的整段**已被吸收进 `main`。
逐笔 `git merge-base --is-ancestor <c> main`（同一趟也逐笔对 `/tmp/heyta-reinstall` 的 `d0a81927`）：

| 载体笔 | 在 main | 在那趟重装载体 | 意味着 |
|---|---|---|---|
| `d5b835b5` / `0de58095` / `0c159f7f` | ✅ | ✅ | W1 的真浏览器取证段与 W2 的第四列**已经在 main**，也会随那趟装上设备 |
| `84d5bd86` / `f419df75` | ✅ | ✅ | W5 的描边即优先级（共享 `TaskRow`，四端同受益）同上 |
| `dbb3a297` / `ca2cf606` / `577c0f3e` / `9bdab17e` / `edd9971b` | ❌ | ❌ | W4 / W6 / W7 未合并 |
| `de5d4ef6` / `b3a5a17d` / `6ee85fda` / `5d5965b5` | ❌ | ❌ | W1 的 ViewKey 对账、第三批调研、W1c、§8.24 未合并 |

⇒ 三条改写：**①** §8.24 那句"载体里根本没有我的代码"已划线更正；**②** 下一轮看图或做设备验收时，
"W2/W5 在、W4/W6/W7 不在"是**当前设备的真实状态**，不许把它读成回归；
**③** 报"落后多少"必须两边各 count 并带 ref 名 —— `feat/detail-pane..main` = **416**（里面含我自己已被吸收的那些）、
`main..feat/detail-pane` = **37**（这才是真正待合的笔数，`git log --oneline main..feat/detail-pane` 可逐笔核）。

### 第三档：`pnpm run <门禁>` 在这棵树上会试图**删掉共享的 modules 目录**，无 TTY 才没删成

现量（09:1x）：`pnpm run check:docs-voice` 与 `pnpm run check:docs` 各自 **RC=1**，
而日志末行是 `[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules directory due to no TTY`
+ 栈 `runDepsStatusCheck → runPnpmCli → sync`。两件事分开判：
- **RC=1 不是门禁红**，是载体没跑起来（§8.15 第 1 行同一条）。真读数在直调那趟：`node scripts/check-docs-voice.mjs` **RC=0**、
  `node research/tools/docs-link-check.mjs` 只剩那两条外来红。
- 🔴 **危险的是那半句"Aborted removal"**：它已经决定要删，只是没终端才停手。
  而这棵树的根 `node_modules` 是**软链到主检出**的，同一时刻另一条会话的 `pnpm reinstall:all` 正在用它。
  ⇒ 所以那条"不许用 `CI=true` 绕开 deps-status 预检"的纪律不是洁癖：**给它 TTY 等于授权它 purge 别人正在用的目录**。
  本检出的固定写法只有两种：`node <脚本路径>`，或 `./node_modules/.bin/<bin>`（需要 pnpm 时加
  `--config.verify-deps-before-run=false`，**绝不是** `CI=true`）。
📌 复现现量命令（安全，只读）：`node -e "const s=require('./package.json').scripts;…"` 取真入口 → `node scripts/<file>.mjs`。

## 8.26 W1c 覆盖面补一次**逐处现量**：四处渲染、两种无障碍通道、一类该豁免的面（2026-10-04 09:2x；本节零代码改动）

Goal 那句"各处同一套状态与回落规则"我此前只回写到"三张面"（任务 / 习惯 / 便签）。
09:2x 逐处取代表后发现**覆盖面比那句话宽，而通道比那句话窄**，两头的措辞都得改：

| 渲染处 | 可见痕迹 | 无障碍通道 | 接线在哪 |
|---|---|---|---|
| web 任务 / 四象限 / 时间线（共享 `TaskRow`） | `rowActive` = `color.primary-subtle` + `radius.md` | `aria-current`（`packages/ui/src/task-list/TaskRow.tsx`，本轮 W1c 补的） | 宿主从 `apps/web/src/lib/selection.ts` 取 |
| web 便签（共享 `NotesBoard`） | 同一条 `rowActive`（本轮补） | `aria-current`（本轮补） | `apps/web/src/features/notes/NotesView.tsx` 传 `activeNoteId={editing?.id}` |
| web 习惯（**本地** `HabitsList.tsx:107`） | `.ht-habit__row` 的 `[aria-current='true']` 规则在 `apps/web/src/styles/app/habits.css:100` | `aria-current` | `HabitsView.tsx:171/302` 走共享 selection store |
| mobile 习惯（共享 `HabitProgressList.tsx`） | `rowSelected` = `color.primary` 描边 **+** `primary-subtle` 底（`:156-159`） | 🔴 **`aria-pressed`**（`:256`），不是 `aria-current` | `apps/mobile/src/screens/HabitsScreen.tsx:115` `useSelected('habit')` |
| mobile 便签（同一个共享 `NotesBoard`） | **没有，也不该有** | —— | 见下面第二条现量 |

⇒ **①「三张面」实际是五处渲染**，其中习惯面两端各有一份实现（web 走 DOM 清单、mobile 走共享 RN 清单），
两边**都早就有两种线索** —— 这一档此前没写进 §8.22，读起来像"习惯面本来就够了所以没做"，
实际是"它本来就做对了，只是我没把它计入覆盖面"。

⇒ 🔴 **②通道不是只有一个词**：`HabitProgressList.tsx:252-256` 自己写明 **RN 的 `AriaProps` 里没有 `aria-current`**，
两端都认、在 `role="button"` 上合法的那个是 `aria-pressed`，语义同为"这一行的内容正在窗格里显示"。
所以断言 F 里"把选中说出来"必须是 **`aria-current` 或 `aria-pressed` 择一** —— 写死一个词，
它会**在 mobile 习惯行假红**（那一行是全场做得最足的一处：两种线索 + 正确的通道）。

⇒ 🔴 **③有一类面必须豁免，且这条豁免是量出来的**：mobile 便签那一处不接 `activeNoteId` 不是漏，
现量在 `apps/mobile/src/screens/NotesSection.tsx` —— `:79` `useSelected('note')`、`:167` 点行才写 id、
`:119` 与 `:176` 关闭时清成 null，而编辑器是全屏 `Modal`（`NoteEditScreen.tsx:36`）⇒
**列表在屏上的那段时间里这个 id 恒为 null**，接了 prop 也是空转。
⇒ F 的题面据此从"每张有选中态的面都要有痕迹"**收窄成**：
**「选中态存续期间列表仍可见」的那些面**必须把选中说出来（通道按端择一）。
这一条不是拍板项，是可以实测的设计输入 —— 记在这里就是为了下一轮直接照它写门禁，不再重新推。

⚠️ 载体复量（09:2x，同 §8.24 那段，只是没变）：主检出 `scripts/check-selection-single-source.mjs` 仍
**+79 / −4**、工作树与 HEAD 都仍只有断言 **A–E** ⇒ F 继续等它干净，本单不抢那把文件。

## 8.27 Goal 第④条"状态只允许三个词"落成一条量法（2026-10-04 09:3x；改一处措辞，其余是探针自己的两条错）

那条要求此前只是被遵守，没被**量**过。这趟把它量了一遍：**§8 表 16 行，违规 0**（修掉一处之后）。

- 🔴 **真违规只有一处**：`W10` 那行写的是 `⏸ 不在本篇开工（阻塞于 C1#9–12）` —— 三个词之外的第四种措辞。
  改成 `⏸ **未开工**（本篇不排这一单，见 §2 第二批那行；阻塞于 C1#9–12）`：**措辞进词表，理由不丢**。
- 第一版探针报了 **8 条假红**，错法是 `cell.includes("已完成")` 数命中：W1/W1b/W2/W4–W7 那几行正文里
  都有"**所以还不算已完成**"这种否定句 ⇒ 一个禁词计数器把最守规矩的几行判成违规。
  ⇒ 量措辞只能看**那一格开头的那一个词**，不能数全句命中（`expect(!负面读数)` 那一族的新变体）。
- 第二版又报 8 条假红，这次是我自己的记忆债：`cell.slice(0,1)` 取标记 —— **`Array.prototype.slice` 按 UTF-16
  码元切**，`🔄` 是代理对，被劈成半个 ⇒ 查表 `undefined`，那 8 行又"违规"了。改 `Array.from(cell)[0]` 后归零。
  （同一族我 2026-10-02 在另一条线上量过：字节 / 字符 / UTF-16 码元是三个不同的数 ——
  这次复发的位置很小说明不了它不贵：**只是"取一个 emoji 标记"这么一小步**。）
- 作用域也要钉：探针第一版从 §8 标题一路扫到文件尾，把后面**别的表的同名列**（移交清单里"改挂…"那些行）
  也算进来 ⇒ 又冒 6 条假红。正解是 `start..下一个 ^## ` 之间只取 `^| W\d` 那几行。
- **变异两臂（一次性，跑在 `/tmp` 的副本上，仓库文件没动）**：① 把 W3 改成"基本完成" ② 把 W10 改回旧措辞
  ⇒ `MUTATED_BAD=2`，且逐臂点名到 `W3` / `W10` 两行。这条量法因此**有牙**，但它是**一次性读数不是常驻门禁**
  （同 §8.23 那句：这一类没有常驻检查器）—— 下次动 §8 那张表时把同一段逻辑再跑一遍。

## 8.28 "选中态只有一个所有者"从**按名字**升级为**按机制逐处裁过**（2026-10-04 09:3x；本节零代码改动）

W1 那句"四份本地 `useState` 全删了"此前只由门禁的**名字表**守着（`detailId|selectedId|editingId` 那几支，
刻意不含 `active`/`open`）。名字表挡不住"第二个人改叫别的名字"—— 所以这回收齐两端所有"记住某一行的 id"的
本地态，**逐处问它在屏上决定什么**。现量集合 15 处（取法见本节末那条），按名字分组：

| 名字 × 处数 | 出现处 | 它在屏上决定什么 | 为什么不是"选中" |
|---|---|---|---|
| `busyId` × 6 | web `CalendarView.tsx:70`、`HabitsView.tsx:169`；mobile `CalendarScreen.tsx:56`、`HabitsScreen.tsx:117`、`TasksScreen.tsx:694`、`SecurityScreen.tsx:115` | 哪一行的动作**在路上**（转圈 / 禁用） | 动作完成就清空，不参与"右栏显示谁" |
| `renamingId` × 3 | web `HabitsView.tsx:188`；mobile `HabitsScreen.tsx:124`、`SecurityScreen.tsx:116` | 哪一行开着**就地改名输入框** | 是编辑焦点，与展示选中无关 |
| `confirmingId` × 3 与 `confirmDeleteId` × 1 | web `TrashView.tsx:60`、`PasskeyPanel.tsx:156`；mobile `TrashScreen.tsx:63`、`SecurityScreen.tsx:118` | 哪一行开着**二次确认** | 同上，那是危险动作的门 |
| `editingRowId` × 1 | `PasskeyPanel.tsx:158` | 哪一行在就地改名 | 这名字就是上一轮**为绕开门禁词表**特意改的（原名撞上 store 里"请求在途那条"，见 §8 表 W1 行） |
| 🔴 `activeId` × 1 | `apps/web/src/features/quadrant/QuadrantBoard.tsx:158` | dnd-kit **正在拖**哪一颗 | 同文件 `:152` 的 `activeTaskId` 才是选中，`:277` 把它转发给共享板子；`:146-148` 已写明"两个名字像但不是一件事" |

⇒ **两端没有任何第二处实体选中**：`selection` 的三档词表（`task|habit|note`）在这一维也是完备的，
与 §8.20 那次按 `ViewKey` 全枚举的对账互相咬合（那一次问"哪些面有选中"，这一次问"还有谁自己记着选中"）。
📌 而且 §8.20 当场就误读过一次 —— 某个只读 agent 把 mobile `TasksScreen.tsx:1046` 报成选中态，
逐行读回是 `busyTaskId={busyId}`（不采信）。**这一次给那一类状态立了类别名**：下一回再见到
`busy*` / `confirm*` / `renaming*` / dnd 的 `activeId`，不必重新推它是不是"第二个人"。

🔴 顺带给还没落的**断言 F** 两条具体约束（都是现量，不是推测）：
① F **不许按 `active` 字样认选中** —— 那会把 `QuadrantBoard.tsx:158` 的拖拽态读成"这张面已经把选中说出来了"，
而真正说话的是 `:277` 转发下去的 `activeTaskId`；
② F 的**豁免名单**就是上面这五类语义（在路上 / 就地改名 / 二次确认 / 正在拖），
再加 §8.26 第③条那种"选中只在浮层里可见"的面（mobile 便签）。两条写死，F 才不会第一次跑就批量假红。

⚠️ 这一趟自己的一条**探针形状错**（0 命中长得像"干净"，与 §8.25/§8.27 那几条同族，但位置是新的）：
第一版写 `grep -E 'const \[[A-Za-z]+Id\] = useState'` ⇒ **恒 0 命中**。原因是解构的字面形状是
`[name, setter]` —— **逗号在 `]` 之前**，`Id]` 这个串在产品代码里根本不存在。
正确形状是 `const \[[A-Za-z]+Id(s)?, `；阳性对照用已知的两枚 `confirmingId`（web 回收站与 `PasskeyPanel`）各命中 1
才允许信这个集合。⇒ **"判有没有某类声明"和"判有没有某类调用"是同一条纪律的两侧：形状要从被扫文件现取一行。**

📌 本节提交前的三道读数（本工单 §1 那道"落笔前复跑"的闸门，09:3x 现量）：
① 本节引用的 **17 处 `文件:行号`** 逐行 `sed -n '<N>p'` 回读，needle 命中 **17/17**（含 `:146-148` 那段
注释原文，它是"两个名字像但不是一件事"这句话的出处，不是我复述的）；
② `node scripts/check-docs-voice.mjs` → exit **0**（1028 条、禁词表 30 项零命中）；
③ `node research/tools/docs-link-check.mjs` 那一次报 exit **1**、两条都在**别人名下**且**文件全干净**
（`git status --porcelain` 对 `docs/plans/countdown-anniversary.md` / `PROGRESS.md` / `docs/adr/README.md` 零输出）：
一条是 `countdown-anniversary.md:1280` 指向 ADR 台账的**带 `§` 号小节引用**（那个章节号不存在），
另一条是 `PROGRESS.md:1362` 指向一份还不存在的 AED 取证文档（死链）。
⚠️ ~~⇒ **本批没有把文档门禁改红**~~ —— **这句在下一趟复跑就被自己的提交否证了**：我在③那段里
**把那条坏引用的字面形状原样抄了一遍**（"某文件 → 某路径 §数字"这个形状本身就会被检查器当成一条新引用），
于是同一道门禁从 1 处变 **2 处**、第二条红指向我自己这一节。
这正是本篇 W7 那行早就登记过的同一种错（"描述坏链要说形状，不要照抄那串"），**而我是在写了那条记录之后又犯了一次** ——
登记过不等于免疫，凡是"复述别人的坏引用/坏断言原文"的句子，落笔后要立刻用那道门禁复跑一次。
改法：把复述换成形状描述（本段现在就是这么写的），复跑回到 1 处、且**我这两个文件零命中**。
处置沿用 §8.24：外来那两条**登记、不代改**。⚠️ 与 §8.24 那条读数的差别要说清，别读成"主检出已修而这里没修"就完了：
countdown 那一句在 **main** 上已被改写成页内锚点，而**本检出当时落后 main 416 笔**（这笔数会漂，最新读数在 §8.29），
所以这里必然还看得见它 ——
**同一门禁在不同载体上的红集不同，报数时必须带载体**（§8.25 第二档那条是同一个机制的代码版）。

## 8.29 合流面从 3 个文件变 **4 个**，原因不是新撞车而是**同一行被两条线各修了一次**（2026-10-04 09:4x 现量；本节零代码改动）

`git merge-tree --write-tree --name-only main feat/detail-pane` → `MERGE_TREE_RC=1`，冲突清单四条：
`docs/README.md`、`docs/reference/environment-traps.md`、`packages/app-host/src/habit-actions.ts`、
`packages/app-host/tests/habit-actions.spec.ts`。§8.24 记的是三条 —— **`docs/README.md` 是新进来的一条**，
而且它进来了不是因为别人在改它，是因为**我**在 W0② 改了它那一行（`96e7519b` + `91e2a573`），
而 `main` 上另一条线**独立把同一行也改对了**。同一时点 `BEHIND=423` / `AHEAD=43`（§8.24 那对 416/37 已被吸收，
这笔数每轮都要重取）。

**两边各写了什么**（`awk '/0043-timeline-p2/'` 各取一行，按公共前缀/后缀切，前缀 332 字符、后缀 26 字符相同）：

| 侧 | 那一行的状态段 | 它的形状 |
|---|---|---|
| `main` | `✅ **代码已落地**（P2 的字段、setSchedule、三态生产者、拖拽手势；进度与读数见 plans 两份）` + 一句"原先那个状态是过期半句，取证过程记在调研 A0.8" | **结论 + 指针**（不在索引里逐档举证） |
| 本检出 | 我那次改的"五档代码已全部落地" + 逐档 `file:line` 枚举 | **结论 + 抄了一份逐档账** |

🔴 两边都删掉了同一句过期话、都没删错，但**我这版是双份事实源**：逐档读数住在计划里就够了，
索引行抄一份就一定会漂 —— 而它**当场就漂了**（见下面那条现量）。⇒ **合流处置：取 `main` 的指针形状，
把我那半句限定并进去**（"拖拽手势只有 web 半"），逐档账留在本篇 §8.25 第一档。本检出这一行已经按这个形状改好，
所以那第四条冲突合流时是**一行对一行择一**，不是三方缠斗。

### 现量：那句"已全部落地"是错的，错在把"共享层有这组代码"读成"两端都接上了"

`TimelineBoard` 那组 responder 的**七处**分支全部挂在 `onScheduleTask` 是否为 `undefined` 上
（`packages/ui/src/timeline/TimelineBoard.tsx:448`、`:577`、`:617`、`:623`、`:633`、`:658`、`:695`），
消费者两侧：**web 传**（`apps/web/src/App.tsx:2274` `onScheduleTask={(taskId, change) => {`）、
**mobile 不传**（`apps/mobile/src/screens/TimelineScreen.tsx:59-67` 只给 `rows`/`labels`/`onOpenTask`/
`activeTaskId`/`compactTicks`/`today`/`now`/`testID`）⇒ **RN 端拖拽一行都不接**。
📌 ADR-0043 §7 第 3 档原文就写着"web Pointer 优先，移动端手势在 goal §4 的 P3 列表"——
**是它对的、我读漏了半句**。这一条的形状和 §8.20 那次"只读 agent 把 `busyTaskId` 报成选中态"是同一族的另一侧：
那一次是**把不是选中的读成选中**，这一次是**把共享层的代码当成两端的能力**。
可迁移的判据：**凡是"A 层有这段代码 ⇒ A 的两个消费者都有这个行为"，分辨办法只有一个 —— 去数消费者传没传那个开关**。

顺带把 §7 第 4 档的口径钉准（我上一版把它整档写成"判据存在"）：`timeline-schedule.spec.tsx` 文件头 `:11`/`:55`
自己写明"骨架 2 的形态 = 引擎重放出的物化状态"，`:14` 把骨架 3 写成"绕过 dispatch 直改实体"的**变异设计**；
**这一臂本轮没有取证它跑过**，要取证去 `plans/goal-timeline-rework.md`。⇒ 别把"判据文件存在"读成"三臂都红过"
（本篇 §4 第 3 条那条纪律的同一种违反，是我自己犯的）。

### 本轮被这些改动带出的两条门禁读数（都是现跑，载体 `feat/detail-pane`）

1. `docs-link-check`：我第一次复跑 **exit 1 / 2 处章节引用红**，其中**第二条指向我自己 §8.28 的行**——
   因为我把那条坏引用的**字面形状原样抄进描述里**了（本篇 W7 那行登记过的同一个坑，我犯在写完它之后）。
   改成形状描述后复跑回到 **exit 1 / 1 处**（只剩外来那两条家族里的 countdown 一条 + `PROGRESS.md` 一条死链），
   且 `docs/README.md` 与本文件**各 0 命中**；`check:docs-voice` 与 `check:claims` / `check:reachability` 见下面收尾。
2. ADR-0043 那份文件在两侧**逐字节相同**（`git diff --quiet main HEAD -- <那份 ADR>` 无输出）⇒
   我这次没动它，所以它**不会**成为第五条冲突；但也正因如此，它 §7 标题里那句过期话**两条线都没修**，
   而进度主人是 `plans/goal-timeline-rework.md`（索引行只给结论与指针）⇒ 本篇不代它改，登记在此。

**收尾读数（提交前在同一条命令里逐条现跑，载体 `feat/detail-pane`、本检出）**：

| 命令 | RC | 读数 |
|---|---|---|
| `node research/tools/docs-link-check.mjs` | **1** | **1 处**失效章节引用（`docs/plans/countdown-anniversary.md:1280`）+ **1 个**死链（`PROGRESS.md:1362`）；本篇与 `docs/README.md` 各 **0 命中** |
| `node scripts/check-docs-voice.mjs` | **0** | 扫 `site.*` 1028 条（豁免自托管 120 条），禁词表 30 项零命中 |
| `node scripts/check-claims.mjs` | **0** | 6 个平台都能在 roadmap 找到对应条目；已建模 10 个实体各有写路径与宿主调用点，未建模清单 5 项已结清 |
| `node scripts/check-reachability.mjs` | **0** | 通过 |

📌 这一节的**取代表动作**本身也值得留一句：判断"两端有没有这个行为"用的是 `grep -n "onScheduleTask"` 数
消费者 + `sed -n '59,67p'` 读那一处 JSX 的实参清单，**不是**在共享层里找 `Platform` 分支 —— 共享层根本没有分支，
差别完全落在"宿主传没传"这一维上。

## 8.30 合流面有**两个数**，而真正决定窗口的是那个大的（2026-10-04 09:4x 现量；本节零代码改动）

> ⚠️ **别照本节的两个数行动**（13 / 4 都是那一趟的瞬时读数）。2026-10-04 10:5x 现量已经变成
> **活树交叠 4 枚 / 提交级冲突 10 枚**，并多出四枚两边各自改过的文件 —— 最新一段是 **§8.38**。
> 本节留的是**方法与可复跑的取法**，那两样没过期。

§8.29 报的 **4 个冲突文件**是 `git merge-tree` 的读数 —— 它**只比提交**。而合流这件事真的发生的时候，
`git merge` 是在**活的工作树**上跑的，别人**未提交**的改动同样会被它撞：轻则
`Your local changes to the following files would be overwritten by merge` 直接拒绝，
重则被整文件 `git add` 抹回去（本仓有过一次反向事故：我 plumbing 提进多人台账的段落被别人的整文件提交冲掉）。

现量两个面（`MERGE_BASE = f419df75`，正好是本批自己那一笔"W5 逐项对账"）：

| 面 | 怎么量 | 数 |
|---|---|---|
| 提交级冲突 | `git merge-tree --write-tree --name-only main feat/detail-pane` 的 CONFLICT 行 | **4** |
| 活树交叠 | `(git diff --name-only <merge-base> HEAD)` ∩ `(主检出 git status --porcelain 的路径)` | 🔴 **13** |

`MY_CHANGED=79 / DIRTY=240 / INTERSECT=13`。13 枚按危害分两堆：

- **8 枚源码/文档**，主检出那边正有人改（未提交行数现量）：`docs/reference/environment-traps.md` **+305/−0**、
  `packages/i18n/src/locales/zh-CN.ts` +31、`en.ts` +27、`apps/web/src/styles/app/main-area.css` +12/−4、
  `e2e/tests/helpers.ts` +12、`apps/web/src/App.tsx` +8、`packages/app-host/src/index.ts` +1、`docs/README.md` +1/−1
- **5 枚是截图证据**（`apps/web/evidence/detail-column-slot/{desktop-with-detail,no-sidebar-view,back-to-desktop}.png`、
  `apps/web/evidence/detail-pane-overlay/{settings-sheet,search-overlay}.png`）——
  它们**不需要任何人主动改**：任何一轮 e2e 验收都会原地重写它们。⇒ 这一堆**不能等"它自己变干净"**，
  只能在**没有验收在跑**的窗口里合，或者接受"合流时被重写的是证据文件而不是代码"。

📌 所以**合流窗口的判据不是"冲突文件少"，是这 13 枚在主检出的未提交改动为 0**（截图那 5 枚额外要求"此刻没有验收在跑"）。
复跑口径（和上面那两个数同时点跑过，别抄数字）：

```sh
MB=$(git merge-base main HEAD)
git diff --name-only "$MB" HEAD | sort -u > /tmp/a.txt
git -C <主检出> status --porcelain | sed 's/^...//' | sed 's/ -> .*//' | sort -u > /tmp/b.txt
comm -12 /tmp/a.txt /tmp/b.txt | tee /tmp/intersect.txt | wc -l
```

顺带一条我自己犯的**相对时间**错：这一节第一版把门禁脚本的 mtime 写成"两小时十四分钟前"，
那是我从 `02:33` 与"现在"心算出来的。`stat` 的 epoch 与 `Date.now()` 一除，真值是 **434 分钟（7h14m）** ——
差在机器是 +08 而我按 UTC 心算。**凡是写进记录的"多久以前"，必须由 epoch 现算，不能由两个读数相减再猜。**
那条编辑至今仍未提交（`main` 与本检出的门禁字节**逐行相同**：两侧都 415 行、`git diff --quiet` 无输出），
所以断言 F 的阻塞理由从"它在飞"升级为"**它已经 7 小时没动、也 7 小时没提交**" ——
这两件事对"要不要继续等"的含义相反，留给产品负责人判，本篇不代它决定要不要催。

## 8.31 "自动合干净"从 6 枚变 **8 枚**，新进来的两枚逐枚判过语义（2026-10-04 09:5x 现量；本节零代码改动）

§8.11 那张表记的是 05:0x 的现场：3 枚冲突 + 6 枚"自动合干净"。`main` 又前进了 7 笔
（`MAIN_TOUCHED=769` 个文件、`BEHIND=423`），拿 `merge-base..` 两侧各自比一次，
**交叠面 = 12 枚**：3 枚冲突（traps / `habit-actions.ts` / 它的 spec）+ `docs/README.md`（§8.29 那枚）+
**8 枚自动合**。§8.11 那 6 枚没变，新进来的是 `e2e/tests/helpers.ts` 与 `packages/ui/src/notes/NotesBoard.tsx`。
🔴 自动合**不等于**语义合，所以这两枚逐枚判：

| 新交叠的 | `main` 侧 | 本分支侧 | 撞不撞得着？现量根据 |
|---|---|---|---|
| `NotesBoard.tsx` | 删掉 `NOTE_EXCERPT_LENGTH` 的 import、把 JSDoc 改成"领域层的 `NOTE_EXCERPT_LENGTH`"、**把默认参数 `excerptLength = NOTE_EXCERPT_LENGTH` 摘掉**（pre-image `:68`/`:95`/`:213`） | 五处插入（pre-image `:110`/`:177`/`:218`/`:282`/`:294`） | **不撞**。我这侧新增的代码**一处都不读 `excerptLength`**（`git diff … \| grep excerptLength` 零命中），而 main 那三个落点离我最近的插入只差 5 行 —— 相邻、不重叠，这才是 merge-tree 敢自动合的原因。⇒ 摘要默认长度改由 model 兜底这条**行为变化是 main 自己的**，不是我把它带歪的 |
| `e2e/tests/helpers.ts` | `enableAllModules` 里加 `countdown: true`、`switchView` 的标签联合加 `'倒数纪念日'`（即 **rail 会多出一格**） | `parkCursor` 等 +32 | **不撞，而且这条能证明**：`focus-detail-pane.spec.ts:100` 那条"视觉上高亮的那一格必须就是当前视图"是**按背景筛、不按位置索引**，而 `apps/web/src/styles/app/inbox.css` 现量 `:484 .ht-rail__tab:hover` **只改 `color`**、`:495 :focus-visible` **只画 `outline`**，唯一给 `background` 的是 `:488 --active` ⇒ 新增那一格不带背景，断言 `toEqual(['番茄钟'])` 与"rail 有几格"无关 |

📌 这一节真正可迁移的是那句**判据的形状决定合流风险**：同一个"界面多了一格"的变化，
写成 `tabs[3]` / `nth-child` 的断言会**静默合到错的行上**（不报红、读别人的行），
写成"按语义筛 + 断言整个集合相等"的断言会**要么红要么对**。
⇒ 合流前不必逐条跑，先按这个维度把本批 e2e 断言分成"能静态判定安全的"和"只能靠跑的那几条"。

⚠️ **本节的边界（别读多）**：以上全是**静态可证**的部分 —— 合并态**一次都没跑过**。
跑不了的原因不是懒：本检出的 `node_modules` 与 `e2e/node_modules` 是指向主检出的**软链**，
临时 worktree 里根本没有依赖，而按 §8.25 第三档那条纪律，**这里绝不能用 `pnpm install` 去补**
（它会试图移除共享 modules 目录，那正是别人那趟重装正在用的）。
⇒ 合并态的运行时读数（尤其 `habit-actions.ts` 那枚语义冲突之后**四条判据是否都还在**）
仍然只有合流那一趟能给，沿用 §8.11 末段的处置：两单所有者一起确认，不"解成能编译"。

### §8.31 补：把那句"按断言形状分两类"落成一次现量（同轮，零代码改动）

本批**未合的那 4 份 e2e 用例 + `helpers.ts`**（`selection-projections` / `detail-column-slot` /
`task-priority-checkbox` 不在这张清单里 —— 它们早于 `merge-base = f419df75`，**已经在 `main` 里了**，
所以不存在"合流时才第一次跑"的风险）逐条按位置索引的形状扫过：

| 形状 | 命中 | 判 |
|---|---|---|
| `.first()` | 7 处，但**四类理由各不相同**（逐处读回那几行才分的，不是看形状就下判）：**3 处**走 `.filter({ hasText })` **之后**（`helpers:573/:588`、`habit-counted-amount:58`）⇒ 先按语义收窄再取首枚；**1 处是正对照**（`detail-pane-collapse:96`，"这一档里应用本身是好的"，只断可见性、刻意容忍多枚）；**1 处取首枚读样式**（`focus:121`，`${COLUMN}` 内第一枚 `.ht-app__detail-card-value` 的 `fontVariantNumeric` —— 四张卡同一条样式，取首枚是宽容不是依赖）；**1 处在上一句 `toHaveCount(1)` 之后**（`focus:169`）；🔴 **剩下 `helpers:304` 确实是"取第一枚再断言它的文本"**（`.ht-header__title` 首枚必须写着"设置"）—— 它是**按序号**的，但那个序号是它自己刚点开的浮层产生的、且只断"页标题=设置"这一件事，不是从一列同类里挑第 N 枚 | 🔴 **没有一处是"按 rail 第几格 / 列表第几行"挑对象** ⇒ 与"合流后界面多一格"无关 |
| `rows[n]` / `on[0]` / `toEqual([2])` 这类**真按序号断** | `keyboard-cursor.spec.ts`（`:78/:271/:354/:365/:373/:515/:523/:533/:538`） | 这里**序号就是被测对象**（↑↓ 移动光标本身就是行的相对位置），而且那个 `rows` 数组是用例自己**同一趟**从 DOM 枚举出来的 ⇒ 与"rail 多一格"无关，但**对列表排序敏感** —— 而列表排序正是本批 W1b 在动的地方，所以它本来就属于"只能靠跑的那几条" |

⇒ 结论收窄成一句：**本批没有"按位置挑 rail/列表然后静默读错行"这种形状的用例**，
需要合并态才能判的只剩 `keyboard-cursor.spec.ts` 一份 —— 这一份要在合流后跑，
理由不是"它可能贴错行"，而是**它的期望值就是序号**，而序号会随排序变。

## 8.32 Goal 第 (1) 项那句"带日期 + 出处 + 未核实标记"逐节量过，照出 C1b-Q8 三行**没有 URL 的一手断言**（2026-10-04 09:5x 现量）

这一项此前只有"做了"的结论，没有"每一节都带了"的读数。用一段 node 脚本把 C1b 整段按 `###` 切节后逐节数
（脚本口径随读数一起留，别只留数字）：

| 节 | `2026-10-DD` 日期串 | URL | 「未核实」 |
|---|---|---|---|
| Q1（=C1 #1） | 1 | 5 | 0 |
| **Q8（=C1 #8）** | **0 → 已补** | 4 | 0 → **3** |
| Q2（=C1 #2） | 4 | 11 | 0 |
| Q9~Q12（=C1 #9–12） | — | 10 | 0 |
| Q4（=C1 #4） | 2 | 15 | 1 |
| Q5（=C1 #5） | 3 | 9 | 0 |
| Q6（=C1 #6） | 1 | 9 | 1 |
| Q7（=C1 #7） | 1 | 0（它是**仓内代码**取证那一节，本来就没有外链） | 0 |

🔴 **Q8 那一节的三行（Things 4 / Todoist 任务详情 / Outlook）有原句引用、有"站哪边"的结论，却没有 URL** ——
而节头的口径写的是"一手取证"，所以这三行**读起来像一手、实际没附来源**；其中 Todoist 那行还写着"同一 help 页"，
指向一个没落到字节上的页面。本轮没有去猜链接（AGENTS：不确定的 URL 不许写），改成逐行标
`未核实 · 未附来源`，并在节头补一条"这三行不构成一手"的说明。

📌 **补一句要紧的**：这三行里 Todoist 那条恰好是推荐里 `affordance 常驻` 那一腿的同类证据，
所以**不能只标注完就继续用它**。逐条对过后可以写明：三行即使被推翻，本推荐不动 ——
`affordance 常驻` 站的是 Apple 那句 "Place controls that people are most likely to use… so they're always visible"（**有 URL**），
`record 可隐藏` 站的是 Apple 第一句 + Power BI 性能那句（都有 URL），`空态只给一行文案` 站的是 Carbon "use just text"（有 URL）。
⇒ **"标注了未核实"和"结论不再依赖它"是两件事**，只做到前者就还在用未核实的依据拍板。这一句写进了 Q8 的推荐末尾。

其余七节不需要动：`未核实` 只该落在**没核到的那一行**上，不是每节都要凑一个（凑出来的标记会把真缺口淹在噪声里）。
门禁：`docs-link-check` 对本篇与该调研文件**各 0 命中**（整仓仍是外来那 1+1 条）、`check:docs-voice` RC=0。

## 8.33 表格"列数"这件事：我先用错了测量单位，改正后**自己两份文件里查出六行真缺陷**（2026-10-04 09:5x 现量；只改文档，零代码）

起因是 §8.32 要给调研文档补"取证日期"时顺手想核一下表格列数。**第一版判据按"数竖线"比**，
这个单位是错的：markdown 的行尾 `|` 可以省，而代码跨度里的 `|` 在表格里**仍然会切单元格**。
两条都在这轮实测到了：

| 测量单位 | 全 `docs/` 报警 | 其中假报警 |
|---|---|---|
| 数竖线（错） | 41 | 🔴 **8 处**是"只是没写行尾 `\|`"（含 `docs/README.md:223` —— 我差点去改别人那一行） |
| 数**单元格**（对） | **33** | 0（对照做过，见下） |

### 真缺陷六行，全在我自己这两份文件里（都已修）

- **调研文档 C1b-Q2 那张"口径对照"表 5 行**（`HEAD` 版本现量 5 处、修后 0 处）：那五行把
  "谁怎么做"与"精确判据"**并成了一格** ⇒ 渲染时**出处 / 一手性两列整体左移一格**。
  🔴 危害不是难看，是**读的人会看到贴错栏的一手性** —— 而 Goal 第 (1) 项要的恰恰是"每条带一手性"。
  修法：补 `—` 占位列，**内容一个字没动**。
- **本篇 §8 那张工单表的 W1 行**（`:137`）：正文里的 `` `task|habit|note` `` 与
  `` `detailId|selectedId|editingId` `` 有**四个裸竖线**（第 316/322/1787/1799 字符处，逐字符扫出来的），
  于是三列的行被切成**六列**。修法是转义成 `\|` —— 断言"只多四个反斜杠、其余字节不变"
  （`s.length === before.length + 4`），少了这条断言，一次"修表格"就能顺手改掉整段话。

### 两条对照（新写的静态检查必须先证明它有牙、且不假报警）

- **阳性**：临时文件塞一行 `| x | y |`（表头三列）⇒ 必须报 `line 4: 2 cells, header line 2 has 3` ✅ 报出。
- **反向**：同一张表里一行**故意省掉行尾 `|`**、另一行用 `\|` 转义 ⇒ 必须**都不报** ✅ `CELL_MISMATCH=0`。
  （少了这条，我就会把 §8.33 上面那 8 处假报警当成别人的缺陷去"修"。）

### 为什么不挂成常驻门禁（这是本节的裁决，不是拖延）

现量 `FILES_SCANNED=167 / TABLE_ROWS=12083 / CELL_MISMATCH=33`，落在**十四份别人名下的文档**：
`multi-platform-widgets-progress`(8)、`legal-dataflow-ai-rights`(5)、`legal-pipl-baseline`(4)、
`goal-multi-end-coverage`(3)、`legal-compliance-before-filing`(3)、`i18n-multilingual`(2)，
其余 `adr/0010` / `plans/README` / `multi-end-unified-strategy` / `phase-2-multi-platform` /
`site-and-parity-alignment` / `ui-review-fill-zh-timeline` / `user-journey-and-auth` / `deployment` 各 1。
⇒ 现在把它接进 `pnpm check:docs` 只有两条路：**要么当场红 33 处**（把 `check:docs` 从 2 处外来红变成 35 处，
下一趟合流的人只会更恨这条门禁），**要么给这十四份文件建一份允许清单**——而"只许删不许加"的允许清单
是给别人的债建台账，本单不该替别人建（同 §8.13/§8.16 那条"不吸收凑绿"的立场）。
⇒ **处置**：登记这 33 处（含逐文件数与上面那条可复跑口径），把检查脚本留在一次性工具里；
谁要把它转正成门禁，应当先由**各文件所有者把自己的行修平**，或明确一次仓库级的决定。

⚠️ 一个已知的判据局限（写下来免得下一个人误信）：这版检查把"表头"认成**表格块里第一行**，
所以若某张表的表头本身就写坏了，它会把**整表其余行**都报成缺陷（报的是"与坏表头不符"，不是"这几行坏了"）。
遇到一个文件里整表齐刷刷报红时，先看表头那一行。

复跑口径（一次性，不依赖仓内装置）：按单元格数比、跳过围栏代码块、认 `\|` 转义的实现
约 60 行，落在 `/tmp/dp_tablecheck4.mjs`；**它是本会话的临时件，不进仓**（进仓就要挂门禁、就要替别人修 33 处）。
要长期用得先把上面那两条对照搬进正式脚本，再逐文件清零。

📌 两条**这一节自己产生**的读数（不是别人的故事）：
① 写完 §8.33 那张"测量单位"表后立刻复跑，它**自己就被同一个判据报了一行** ——
我在解释"行尾 `|` 可以省"那句话时用 `` `|` `` 写了个裸竖线，三列变四列。同一个 09:5x 内被发现并转义，
所以它没进提交。**这与 §8.32 那条"抄坏引用"是同一族**：写下规则的同一轮就会违反它，
区别只是这次检查就在手边 ⇒ **"改完就复跑"要的不是纪律感，是把手边的检查立刻跑一次。**
② 修 ① 时一次 `Edit` 把逗号吃成了 `，，`（`old_string` 少带了行尾那个字符，`new_string` 又补了一个）——
相邻字符被编辑顺手改动是这一族的老形状，所以每次 `Edit` 之后除了跑判据，
还要 `grep` 一眼**被改那一行本身**（本行现在读起来是 `第一行**，` 一个逗号）。

## 8.34 W1c 的那格空档补上了：RN 端习惯行的选中痕迹**第一次有判据，也有臂**（2026-10-04 10:1x–10:2x，新增 1 份测试文件）

§8.26 逐处现量时数到**五处渲染点**，但 §8.22 那六条变异臂（N1–N4 / T1 / H1）**全部打在 web 的便签与任务上** ——
也就是说 mobile 那一处（共享 `packages/ui/src/habits/HabitProgressList.tsx` 的 habit 行）**一直是零断言**：
`grep -rln "HabitProgressList" packages/ui/tests/` 现量**零命中**，`aria-pressed` 在那张面上没有任何一层会管。
这一格不是"锦上添花"，是本单 §4 第 1、3、4 条的欠账：判据没配臂的那一处，等于**这一处的"选中要说出来"从未被要求过**。

新增 `packages/ui/tests/habit-row-selection-trace.spec.ts`（**8 条**，源码级；为什么源码级写在文件头：
`packages/ui` 不引 jsdom 不 render，而 `apps/mobile/tests/` 今天**一个 render 用例都没有** ⇒
这一处的痕迹只有源码级这一条通道能守住）。判据分三组：

| 组 | 断的东西 | 为什么只能这么断 |
|---|---|---|
| A 通道在 | 平铺 `aria-pressed={selected}` 在；`accessibilityState=` **不许出现**；且属性离它最近的开标签是 `<Pressable` 而不是里层 `<View`/`<Text` | RNW 0.21 会把对象形态整组丢掉；挂错那颗时视觉照常、只有读屏用户受影响 ⇒ **没有任何行为测试会红** |
| B 两条线索同源 | 选中谓词必须是 `const selected = habit.id === selectedId;`（不许按 index）；描边与底色必须挂在**同一个** `selected` 三元上；`rowSelected` 必须同时给 `borderColor: color.primary` 与 `backgroundColor: color.primary-subtle` | 改一条漏一条在截图上看不出来；按位置选中则列表一排序就跟着错行（W1b 正在动排序） |
| C 没选中时零行亮 | `selectedId` 必须是**可选** prop；谓词那一行不许掺 `index` / 布尔常量 | 变必填会让没接的宿主在运行时炸（AGENTS §3.3 同族）；`selectedId` 为 undefined 时等式全 false ⇒ 零行亮是**推导**出来的，不是靠额外分支 |

💥 **变异七臂**（`/tmp/dp_habit_trace_rig.mjs`，一次性；每臂：改源码 → 跑这份 spec → 还原 → 比 md5）：
**未变异对照先跑一次全绿**（`rc=0 / passed=8`）才允许信后面的红 —— 台子自己会造红。

| 臂 | 改法 | 红集（点名到标题） |
|---|---|---|
| M1 | `aria-pressed={selected}` → `accessibilityState={{ pressed: selected }}` | **3 红**（A①平铺、A②不许对象形态、A③住在可点那颗） |
| M2 | 删掉整行 `aria-pressed` | **2 红**（A①、A③） |
| M3 | `style={selected ? [row, rowSelected] : row}` → `style={styles.row}` | **1 红**（B②两条线索同源） |
| M4 | 谓词 → `Boolean(selectedId)`（整列表一起亮） | **1 红**（B①id 相等） |
| M5 | `selectedId?: string` → 必填 | **1 红**（C①可选） |
| M6 | 从 `rowSelected` 里删掉 `borderColor` 那一行 | **1 红**（B③两条线索都在） |
| M7 | 谓词 → `const selected = true;` | **2 红**（B①、C②不掺布尔） |

🔴 **判据无臂审计**（这条是本节真正的方法）：台子把八条 `it('…')` 与七臂的红集做集合对账 ⇒
`IT_COUNT=8 ARMS_KILLED=8 UNCOVERED=0` —— **每条判据都有能把它打红的那一臂**，
不是"做过变异"而是"逐条红过"。（第一版只有五臂时这里会是 `UNCOVERED=2`：B③ 与 C② 没人打，M6/M7 就是那么补出来的。）

**还原证明**：`FINAL_MD5 = BASE_MD5 = 8241c8e7c51b377502e21a4114a03517 SAME=true`，
且台子每臂跑完都单独比过一次 md5（不是只在最后比）。
**读数**：`packages/ui` 全量 **26 文件 / 467 passed**（本批前是 459，+8 正好是这一份；数对得上才算这份真被收进套件），
`tsconfig.spec.json` 的 typecheck RC=0；门禁五道 RC=0（`check:selection-single-source` 末行照旧：
`2 份实例 / 宿主内本地选中态 0 处 / 词表 3 类全有消费者（task 10 / habit 7 / note 13）/ 接线声明 17 处全部用起来`、
`check:layering`、`check:design`、`check:l4`、`check:ui-language`）。
⚠️ **本节没有改任何 `packages/ui/src` 的字节**（七臂全在跑完当场还原），所以 §1 第四道"改完先 build"这一趟不适用；
`HabitProgressList.tsx` 的 md5 与开工前逐字相同就是那件事的直接证据。
🔴 这仍然是**源码级判据**，不是界面级：RN 端真机上那条痕迹有没有落到可访问性树上，
要等 §8.14 那批设备窗口 + 四端重装，不能拿本节的绿去主张"装出来的手机上选中看得出来"。

## 8.35 本分支上 `check:docs` 有一枚**先前就红的死链**，归因量到了；抓它的那趟探针自己坏了（2026-10-04 10:3x 现量；本节零改动）

跑 `node research/tools/docs-link-check.mjs` → **RC=1，两枚红，都在本单之外的文件里、且本节开工前就在**
（对照读数：加 §8.35 之前那趟同样是"1 处失效章节引用 + 1 个死链"，之后仍是这两枚 ⇒ **本节零新增红**，
中途我自己写的那条相对链接错了一次，已当场改回并复跑确认）。

**① `PROGRESS.md:1362` → `docs/research/aed-implementation-evidence.md`（死链）。不是本单造的、也不是仓库缺陷，是这条分支落后 main 的读数**，三条 ref 现量：

| ref | 那条引用（`grep -c`） | 目标文件在不在树里 |
|---|---|---|
| 本分支 HEAD | 1 | **不在** |
| merge-base `f419df75` | 1 | **不在** |
| `main` | 2 | 在 |

补两条把归属钉死的读数：目标文件由 **`c25960cb`** 加进 main，而 `git merge-base --is-ancestor c25960cb HEAD` → **不是本分支祖先**；
本分支从未碰过 PROGRESS（`git diff --name-only f419df75 HEAD -- PROGRESS.md` 输出为空）。
⇒ **合并/变基到 main 之后这枚红自己消失**。本单**不动它**：PROGRESS.md 此刻在主检出正脏着（`M`），
按 §1 归属门与 Goal 第⑤条，代改别人在飞的活不在授权范围内。

**② `docs/plans/countdown-anniversary.md:1280` → "ADR 台账 §1 不存在"（失效章节引用）。这一枚是检查器自己的假阳性**，
机制量出来了：那一行原文写的是 `§1a`，而 `docs/adr/README.md` 里确实有 `### 1a. 「勘误段」…`（第 31 行）⇒ **引用本身是对的**。
检查器的 `SECTION_REF_RE` 只吃 `§\d+(\.\d+)*`，遇到 `§1a` 的尾巴 `a` 不解析，把它**截成 `§1`** 再去查 `## 1` 标题 ⇒ 判"不存在"。
这和它自己注释里记过的 `§3.3.1` 被截成 `§3.3` 是同一个病的第二种面目（那一版修了小数尾巴，没修字母尾巴）。
~~🔴 本单**不改检查器**：那是文档门禁本身的行为，动它要配变异臂、且会同时影响别的线正在写的引用。
在这里记的是**机制 + 一条复现**（`node research/tools/docs-link-check.mjs` 现量 RC=1，红指到 1280 行），
等这条门禁的所有者来收。~~
✅ **2026-10-04 13:5x 已改，理由被现量撤掉了**（见 §8.48）：当时给的两条理由——"要配变异臂"已经配了
（装置 `research/tools/mutation-rigs/mutate-docs-letter-section.mjs`，`ARMS=5 AS_EXPECTED=5 FINAL_SAME=true`，
其中 L3 把**修之前的原状**直接判红）；"会影响别的线正在写的引用"是**可测的**，量出来是 **0 枚**
（干净 main 检出上未修版 vs 本版：两趟 RC=0、输出逐字节相同、检查引用数 522 处不变）。
🔴 而取现场时它挡路是事实：§8.47 第 3d 步把 `check:docs` 写成判据，留着一个已知假红的探针等于给 runbook 埋一条"每次都红一次"。
⚠️ **和 §8.28 那句对账**：那一节已经记过"countdown 那一句在 main 上已被改写成页内锚点"⇒ 这枚红**同样会在合并后自愈**。
两句不冲突：~~自愈的是那一行的文本，**探针的截断毛病还在** —— 任何还写"字母尾巴的章节号"的地方都会再被读成"章节不存在"。~~
🔴 **后半句在 13:5x 过期**（探针的毛病已在 §8.48 修掉，两侧一起放宽）；而且当时漏了**更要紧的那一面**：
同一个截断对 `§4d` 造成的是**假绿**（目标同时有 `## 4.` 与 `## 4d.`，截成 `4` 照样"存在"）——
"再被读成章节不存在"只说中了会吵的那一半。

📌 记这两枚的用途：下一个人在这个 worktree 跑整条 `pnpm check` 会看到 `check:docs` 红，
**别把它读成"本批把文档改坏了"** —— 一枚是分支落后、一枚是探针坏，本单的文件里一枚都没有。
（§8.34 那句"门禁五道 RC=0"没有把 `check:docs` 算进去，所以那里没有需要更正的主张。）

💥 **顺手照出一个会咬人的 shell 陷阱**（就发生在我取上面那三个读数的第一趟）：

```bash
for ref in HEAD $MB main; do git show "$ref:PROGRESS.md" | grep -c "aed-implementation-evidence"; done
# → 三个全报 0。而直接写 git show HEAD:PROGRESS.md | grep -c → 报 1。
```

成因不是 git，是 **zsh 把 `$ref:PROGRESS.md` 里的 `:P` 当成了修饰符**（`:P` = 逻辑路径解析），
于是实参被拆成"对 `HEAD` 做 `:P`" + 字面量 `ROGRESS.md`，git 报错；而那条命令里有 `2>/dev/null` ——
**错误被吞掉，`grep` 收到空输入，打印 0**。
同一个循环里 `"$ref:docs/research/…"` 却是对的（`:d` 不是修饰符），所以这趟读数**一半可信一半是空集**，
而两者在输出上长得一模一样。修法：**永远写成 `"${ref}:PROGRESS.md"`**。
🔴 这正是本仓库反复吃过的形状（"空测量看着最干净"）：**`grep -c` 报 0 从来不区分"没有匹配"和"根本没读到东西"**，
而把 git 的 stderr 丢进 `/dev/null` 就把唯一的区别信号也删了。
⚠️ 待入 [环境陷阱](../reference/environment-traps.md) 一条（zsh 参数展开的 `:P` 修饰符吃掉 `git show ref:path`，
且 `2>/dev/null` 把它伪装成空读数）—— **本单不往那张台账里追加**：它在主检出正脏着几百行，
按既有纪律取号要按工作树、插行会撞车，登记在这里等收口的人并进去。

## 8.36 断言 G 落了：那次"15 处都不是选中"的人工审计，从此变成一条**余量为 0 的棘轮**（2026-10-04 10:3x–10:4x）

### 💥 这条**本来叫 F**，写到 §8.36 才发现 F 已经被预留 —— 记下来是因为预留记录救了我一次

实现完、七臂跑完、读数落盘之后重读工单，撞上 §8.24 那一节（同一个文件、同一趟现量）：
它写的"断言 F 还是没落"指的是**另一件事** —— "§8.22 那条'每张有选中态的面必须把选中说出来'目前只有**一次性判据**在顶，
常驻化要等 E 那笔落地，题面带变异臂（把 `NotesBoard` 的 `aria-current` 摘掉必须红）"。
而 §8.28 给 F 立的两条约束（不许按 `active` 字样认选中、豁免浮层型面）**只有放在那条"痕迹"判据上才讲得通** ——
读成行 id 登记表的话，第二条根本不构成一条约束。**这两处合起来是反证：我心里那个 F 从一开始就不是这一条。**
⇒ 本节的棘轮按字母顺位改成 **G**，F 空着等它自己的实现（**同一趟就落了 —— 见 §8.37**）。
📌 值得记的是**错法**：我是从 §8.28 那节（离我最近的一条）取的 F 的题面，没有回查**更早**那节对同一个编号的立项；
如果一个编号在两份记录里指向两件事，先落笔的那份才算数 —— **编号不是我的，是台账的**。
（改名前后各跑一遍：门禁 `RC=0`、七臂 `AS_EXPECTED=7 FAIL=0 FINAL_SAME=true`、
`git diff --numstat` 对门禁那份仍是**纯插入**（101 增 / 0 删）。）

### 前置：挡 G 的那道闸门**不是被我推开的，是所有者把文件提交了**

§8.30 记过 F 卡在 `scripts/check-selection-single-source.mjs` 在主检出里脏着（+79/−4）。
现量：那枚文件现在在主检出**干净**（`git status --porcelain` 对它零输出、`git diff --numstat` 空），
但**mtime 距上次写入 477 分钟** —— 也就是说它不是"刚被改完"，是"改完的那批一起被提交了"。
🔴 于是照出一件比 F 更要紧的事：**main 上那份比我这条分支那份多 79 行**（`git diff main -- 该文件` = 4 增 / 79 删）。
那 79 行是断言 E 的 `objectSpreadUseOf`：把"对象字面量 → JSX spread 转发"也算成真实使用。
**我这条分支没有它** ⇒ 我的 E 比 main 的 E **更严**，两棵树上 E 的读数不同（见下面那组现量）。

### G 判什么

B 认的是它那张**名字表**，而 §8.28 现量确认那 15 处**没有一处被 B 命中**（`TOTAL=15`、逐条 `[ ]`）——
也就是说 B 对这一整族**本来就是零射程**。那次人工审计的结论（"这 15 处都是瞬态、不是选中"）
不会自己守住下一次，所以 G 把那份结论变成棘轮：**每一处宿主本地 `…Id` 的 `useState` 都要在 `ROW_ID_EXEMPT` 里
带一个语义类别**（封闭词表四档：`in-flight` / `inline-rename` / `confirm-gate` / `dragging`），并且

- **未登记 ⇒ 红**（"第二个人换了个名字"从此会被点名）；
- **登记了而代码里已经没有了 ⇒ 也红**（过期豁免和永真判据是同一种病）；
- **类别填词表外的词 ⇒ 按未登记处理**（填个理由不该能绕过一条判据）；
- **一处 `…Id` 都没扫到 ⇒ 红**（分母自检："全部已登记"与"没东西可登记"是两件事）。

🔴 **§8.28 那两条约束不承接到这里** —— 它们是给**真正的 F**（"每张面必须把选中说出来"）立的，G 只是**用了那次分类的结果**：
`QuadrantBoard.tsx` 的 `activeId` 登记为 `dragging`，B 那张名字表一个字没动；
而 §8.28 第②条说的"浮层型面"这一档在 G 里**实测不需要条目**：mobile 便签里没有任何 `…Id` 的 `useState`（它不在 `TOTAL=15` 里）。
**这一句是量出来的，不是推出来的。**
🔴 表按 `文件 + 变量名` 索引而**不按行号**：同一棵树里产品文件行号与剥掉块注释后的行号差 40+ 行
（取数时实测），拿行号当键会在任何人加一段注释时批量假红。

### 七臂（装置已入库：`research/tools/mutation-rigs/mutate-selection-f.mjs`）

每臂带**预期**，判定按预期走而不是数红了几条 —— G5/G6 的"不红/只由 B 红"就是它们合格本身：

| 臂 | 改法 | 预期 | 实测 |
|---|---|---|---|
| G1 | web 回收站注入一处未登记的 `pickedId` | 红：F | `rc=1 F=1 B=0` ✅ |
| G2 | 把 mobile 习惯页已登记的 `renamingId` 整体改名 | 红：F | `rc=1 F=2 B=0` ✅（一次改名同时命中"未登记"与"过期豁免"两侧） |
| G3 | 删掉一处已登记的声明 | 红：F 过期豁免 | `rc=1 F=1 B=0` ✅ |
| G4 | 类别改成词表外的 `whatever` | 红：F | `rc=1 F=1 B=0` ✅ |
| G5 | 注入复数 `selectedIds`（筛选范围） | **必须不红** | `rc=0 F=0 B=0` ✅ |
| G6 | 注入真选中名 `detailNoteId` | 红，但**只由 B 报** | `rc=1 F=0 B=1` ✅（两层不重复报同一个人） |
| G7 | 把扫描用的 `ROW_ID_NAME` 改坏到恒不匹配 | 红：分母自检 | `rc=1 F=2 B=0` ✅（15 条豁免全部变过期） |

`AS_EXPECTED=7 FAIL=0`、`CONTROL rc=0`（未变异先全绿才允许信后面的红）、
`FINAL_SAME=true`（**四枚**被改文件的 md5 与开工前逐字相同：门禁 + 三枚宿主源码 ——
这台子会真改宿主源码，所以还原证明是它的一部分，不是仪式）、`POST_RESTORE rc=0`。
⚠️ 装置**没有**挂进 `pnpm check`（和 main 上那批 `mutate-*.mjs` 一样是手动跑的），
挂在 check 上意味着每次 push 都改一遍宿主源码再改回来 —— 那不是门禁该做的事。

### 🔴 合并态现量：G 在 main 的干净检出上**照出两处我这棵树上没有的**

用 `git worktree add --detach /tmp/... main` 起了一份 main 的干净检出，把我改好的门禁拷进去跑 ⇒
**恰好 2 处未登记**：`apps/web/src/features/trash/TrashView.tsx  busyId` 与
`apps/mobile/src/screens/TrashScreen.tsx  busyId`。逐处读 main 那棵树的代码定语义（不靠猜）：
`:224` 是 `busyId={busyId}`、`:258` 同形、`:277` 是 `busy={busyId !== null}` ⇒ **动作在途**那一类，
与表里已有的 6 处 `busyId` 同族 ⇒ 归类 `in-flight`。
⚠️ **本单不把这两行提前写进表里**：我这棵树上那两处**还不存在**，登记一条代码里没有的豁免
会被 G 自己的"过期豁免"当场判红 —— 这正是那条判据存在的理由，我不能为了合并方便先把它弄弯。
⇒ **合并时补两行**（谁合并谁补，红出来的消息会点名到 `文件  变量名` 并写清两种改法）。
这条红是**设计要的行为**：一个我没审过的面上多出一处行 id 态，就该由读到它的人判它是什么。

📌 **13:2x 用另一种方法复量，同一答案**（值得记，因为那一趟之后 main 又走了一批：
落后从 §8.40 那趟（11:1x）的 **485** 变成 13:2x 现量的 **516** ⇒ 中间 +31 笔，两枚未登记还是这两枚）：
不起工作树，直接对 ref 做 `git grep`，再与本分支 `ROW_ID_EXEMPT` 的 15 条登记求差集 ——
`main 侧 …Id 本地态=17 / 本分支侧=15 / 合并后新增=2 / 未登记=2`，
两枚仍是 `apps/web/src/features/trash/TrashView.tsx busyId` 与 `apps/mobile/src/screens/TrashScreen.tsx busyId`。
复跑命令（零负载、零检出写入）：`node /tmp/dp_g_merge_probe.mjs` —— ⚠️ 它是 /tmp 里的一次性探针，
**会随机器没掉**（本次刚在调研文档里领过一次这个教训），所以方法写在这里而不只写在路径里：
`git grep -nE 'const \[[A-Za-z]*Id, set[A-Za-z]*Id\]' main -- apps/web/src apps/mobile/src` 与
`git grep … HEAD -- …` 两个集合求差，再拿 `ROW_ID_EXEMPT` 的 `文件 变量名` 键集挡掉已登记的。

同一趟还量到 E 的**版本差**：main 的**原版**门禁跑 main 的树 = `rc=0`，末行"接线声明 **18** 处全部用起来"；
而我的版本跑同一棵树 ⇒ E 报 `packages/ui/src/calendar/CalendarDayBoard.tsx  onOpenTask` 一处断线。
差的那一处正是 main 那 79 行（对象 spread 转发）认下来、我这版不认的。
💥 **我在这一步先报错了一次归因**：第一趟我把"带 F 的我的门禁"的输出当成了"main 原版门禁"的输出，
于是写下"main 自己的门禁在 main 的树上是红的"。`git checkout --` 那份文件再跑一遍才拿到 `rc=0`。
📌 教训：**同一个路径下有两份内容时，先证明跑的是哪一份**（这里缺的就是 md5 —— 还原后我补印了 `4871be15…`）。

### 读数

- `node scripts/check-selection-single-source.mjs` → **RC=0**，新增一行
  `✅ G：宿主内 …Id 本地态 15 处全部有语义登记（四类：in-flight 6 / inline-rename 4 / confirm-gate 4 / dragging 1），过期豁免 0 条`；
  🔴 **原来那行末行逐字未动**（`2 份实例 … 接线声明 17 处全部用起来`）——
  它对 §8.25/§8.34 的引用是**同一串**，改它就是把别人写下的读数变成过期断言。
  `git diff --numstat` 对这份文件 = **98 增 / 0 删**（纯插入），所以它和 main 那 79 行不在同一带，合流是 append 而不是对撞。
- `check:layering` / `check:design` / `check:l4` / `check:ui-language` / `check:row-single-source` → 全 **RC=0**；
  两道余量为 0 的棘轮**没有被动过**（本单没碰 mobile 样式与 `ht-*` 前缀族，`git status` 可指认）。
- `check:docs` → 仍是 §8.35 那**两枚先前红**，本单文件零命中。
- 本节改的只有 `scripts/` 那一份 + 一份新装置 + 本节文字 ⇒ **没有动 `packages/`**，§1 第四道"改完先 build"这一趟不适用。

### 边界（别读多）

G 是**源码级**棘轮：它守的是"不许有第二处自己记着选中的本地状态"，
不守"选中在界面上被说出来了"（那是 §8.26/§8.34 那两组痕迹判据的地盘），
更不守运行时（`useReducer` 里的选中、模块级 `let` 仍然在射程外，那三条是门禁文件头登记过的"不拦的形状"）。
它管的是**单数** `…Id`；复数 `…Ids` 是筛选范围，按 G5 那条阴性对照刻意留在射程外。

## 8.37 真正的 F 落了：四处渲染面"把选中说出来"从一次性判据变成常驻断言，**第一条臂当场照出我自己的假绿**（2026-10-04 10:5x，改 1 份门禁 + 新增 1 份装置）

§8.36 那条是 G。这一节才是 §8.24 立项、§8.26 定题面、§8.28 立约束的那条 **F**：
**「选中态存续期间列表仍可见」的每一处渲染面必须把选中说出来，通道按端择一。**

### 注册表来自现量，不是抄 §8.26 的表

四处面逐条从被扫文件取一行定形状（`§8.26` 那张表给的是结论，形状要现取 —— 那条纪律在这一节又救了一次）：

| 面 | kind | 文件 | 通道 | 谓词 | 谓词在哪算 |
|---|---|---|---|---|---|
| web 任务行（列表 / 四象限 / 时间线共用） | `task` | `packages/ui/src/task-list/TaskRow.tsx` | `aria-current` | `active` | 上一级 `TaskList.tsx:280` |
| web 便签 | `note` | `packages/ui/src/notes/NotesBoard.tsx` | `aria-current` | `active` | 同文件 `:303` |
| web 习惯（本地 DOM 清单） | `habit` | `apps/web/src/features/habits/HabitsList.tsx` | `aria-current` | `selected` | 同文件 `:91` |
| mobile 习惯（共享 RN 清单） | `habit` | `packages/ui/src/habits/HabitProgressList.tsx` | `aria-pressed` | `selected` | 同文件 `:241` |

四道检查 + 三条自检：

1. **说了**：那一面必须有 `<channel>={` 且属性值里出现登记的谓词；
2. **说对了通道**：谓词不许挂在另一条通道上。🔴 这一条不是形式——RN 的 `AriaProps` 里**没有** `aria-current`，
   在 RN 面写它**不报错也不生效**，正是最安静的那种坏（§8.26 第②条）；
3. **说的是选中**（§8.28 约束①落在这里）：谓词的**右半边**必须同时有 `===` 和一个选中 id
   （`activeTaskId` / `activeNoteId` / `selectedId`）——常量、拖拽态、hover 态都能让属性有形状没内容；
4. **豁免带着可伪证的基础**（§8.28 约束②）：`NotesSection.tsx` 登记豁免，理由是那处**不传** `activeNoteId`
   （现量 0 次，编辑器是全屏 `Modal`）⇒ 一旦它开始传，豁免失效就红；
5. 闭合：扫描到的"声明了那三个选中 id 之一的文件"必须在 FACES 或 RELAYS 里，**没登记就红**（现量 9 个声明者 = 4 面 + 递送层）；
6. 递送层逐条仍要在递（JSX 传下去或按 id 等值算），不再就判过期登记；
7. 词表联动：`SELECTABLE_KINDS`（断言 D 从真身读的那份）里每一类都必须至少有一处面对它说话 ⇒
   **加一类选中而不留痕迹**当场红（臂 H9）。

### 💥 H4 第一趟**存活**了 —— 而它打的是这条断言最核心那颗牙

臂 H4 把 `TaskList.tsx:280` 的 `{ active: activeTaskId === row.id }` 换成 `{ active: true }`，
**门禁全绿**。错法是我第一版的谓词检查**取整行来看**：那一行原文是

```
{...(activeTaskId === undefined ? {} : { active: activeTaskId === row.id })}
```

换成常量之后，**同一行左半边那句 `activeTaskId === undefined` 还在** ——
整行判据照样看见 `===` 与 `activeTaskId`，于是"这一面已经不会跟随选中"被读成"值来自选中"。
⇒ 改成只看**谓词自己的右半边**（到行尾）。这一句是这条断言能不能回答"说的是不是选中"的分水岭，
**没有 H4 我就是带着一个假绿上线**（§8.28 那条约束当时只写在文档里）。
⚠️ 换来的边界要写明白：右半边按"到行尾"取，把等值式**换行写**会被判红 ——
宁可红得难看，也不留一个能藏常量的口径。

### 九臂（`research/tools/mutation-rigs/mutate-selection-f.mjs`，判定按每臂预期走）

| 臂 | 改法 | 预期 | 实测 |
|---|---|---|---|
| H1 | 摘掉 `TaskRow` 的 `aria-current` 整行 | 红 | `rc=1 F=1` ✅ |
| H2 | RN 面的通道换成 `aria-current` | 红 ≥2（登记通道没用 + 挂错通道） | `rc=1 F=2` ✅ |
| H3 | web 习惯面属性值里去掉谓词 | 红 | `rc=1 F=1` ✅ |
| H4 | 谓词换成常量 `true` | 红 | **第一趟 `rc=0` 存活 ⇒ 修判据后 `rc=1 F=1`** ✅ |
| H5 | 新造一处接 `selectedId` 却没登记的面 | 红（闭合） | `rc=1 F=1` ✅ |
| H6 | mobile 便签开始传 `activeNoteId` | 红（豁免基础失效） | `rc=1 F=1` ✅ |
| H7 | 把一处面的路径指到不存在的文件 | 红（响亮失败） | `rc=1 F=1` ✅ |
| H8 | `aria-current={selected ? 'true' : undefined}` → `aria-current={selected}` | **必须不红**（换写法不换语义） | `rc=0 F=0` ✅ |
| H9 | 词表加一类而没有任何面对它说话 | 红（词表联动） | `rc=1 F=1` ✅ |

`CONTROL rc=0` → `AS_EXPECTED=9 FAIL=0` → `FINAL_SAME=true`（**八枚**被改文件逐枚 md5 还原：门禁 + 七枚源码）→ `POST_RESTORE rc=0`。
和 G 那把一样，**装置不挂进 `pnpm check`** —— 它每次跑都要真改源码再改回来。

### 🔴 合并方向要写清：F 与它守护的那三处痕迹**必须同批合并**

在 main 的干净检出（临时 detached worktree，跑完已移除）上跑这份门禁 ⇒ F 红 **3 条**：
`TaskRow` 没有 `aria-current`、`NotesBoard` 没有 `aria-current`、`NotesBoard` 的谓词不来自选中 id。
现量成因不是 main 坏了，而是**那三处痕迹本来就是本分支 W1c 补的**：
main 上这两个文件的 `aria-current` 计数 **0 / 0**，本分支是 **3 / 2**（同一趟量的两边）。
⇒ **单挑门禁那一笔过去会红，整条分支过去就绿** —— 这是设计要的形状（判据和行为同批落地），
但必须写在账上，否则下一轮看到"main 上 F 是红的"会误读成判据坏了。
其余两条同样在 main 树上报红且**都已归因**：G 那 2 处 trash `busyId`（§8.36）、
E 那 1 处 `CalendarDayBoard`（我这版缺 main 的 `objectSpreadUseOf`，§8.36 前置那节）。

### 读数

- `node scripts/check-selection-single-source.mjs` → **RC=0**，新增一行
  `✅ F：4 处渲染面各按端把选中说出来（TaskRow.tsx aria-current / NotesBoard.tsx aria-current / HabitsList.tsx aria-current / HabitProgressList.tsx aria-pressed），接选中的递送层 6 处逐条还在递，豁免 1 处的事实基础未变`；
  G 那行与最末那行**都逐字未动**；`git diff HEAD~1 --numstat` 对这份文件仍是**纯插入**（0 删）。
- `check:layering` / `check:design` / `check:l4` / `check:ui-language` / `check:row-single-source` 全 RC=0；
  两道余量为 0 的棘轮没动基线；`check:docs` 仍是 §8.35 那两枚先前红、本单文件零命中；
  `check-docs-voice` RC=0。
- 本单**没有改任何 `packages/*/src` 的字节**（九臂全在跑完当场还原，`FINAL_SAME` 就是那件事的直接证据）
  ⇒ §1 第四道"改完先 build"这一趟不适用。

### 边界（别读多）

F 是**源码级**判据：它证的是"那一面写了这条无障碍属性、且它的值来自选中 id"，
**不证**运行时可访问性树上真的出现了它（那是 §8.34 末行、§8.14 那批设备窗口 + 四端重装的地盘）。
它的闭合面键在**那三个 prop 名**上：给新 kind 起名成别的字面量（例如 `activeEventId`）不在射程内 ——
挡住它的不是 F 而是断言 D 与词表（加一类要动 `SELECTABLE_KINDS`，而词表每类必须有一处面，就是臂 H9）。
`onOpenTask`（回调那一半）由断言 E 管，F 不重复报。

## 8.38 合流面两个数**同时**变了：活树交叠 13→**4**，提交级冲突 4→**10**；四端重装这一趟不能跑的原因也只有一条（2026-10-04 10:5x 现量；本节零改动）

§8.30 立的那两个数在这一趟都换了值，而且**换向相反** —— 所以两个都要重报，不能只报变好的那个。

**① 活树交叠（决定窗口的那个）13 → 4。** 取法与 §8.30 同一条（本批 merge-base..HEAD 改过的文件 ∩ 主检出未提交），
现量剩下的 4 枚与它们此刻的脏量：

| 文件 | 主检出未提交量 | 是谁在动 |
|---|---|---|
| `docs/README.md` | +1 / −1 | 别的线（本批也改过它 ⇒ 同时是提交级冲突） |
| `docs/reference/environment-traps.md` | +94 / −7 | 别的线（并行那几条在追加条目） |
| `packages/i18n/src/locales/en.ts` | +25 / −25 | 别的线（词条改动，中英**成对**出现） |
| `packages/i18n/src/locales/zh-CN.ts` | +25 / −25 | 同上 |

🔴 那两枚 i18n 的 `+25 / −25` 对称不是巧合，是"改词条必须中英同步"的形状 ——
但**这条对称不构成归属证明**，它是AGENTS 对所有改词条者的共同要求，谁都能写出这个形状。
判归属性只认 `git diff` 的 hunk 作者可查性这一层，本节不做归属结论。

**② 提交级冲突 4 → 10。** `git merge-tree --write-tree --name-only main HEAD`（RC=1）现在报 10 枚，
逐枚量过两边各自动了多少（相对 merge-base）：

| 冲突文件 | 本批 | main |
|---|---|---|
| 5 枚 `apps/web/evidence/**/*.png`（`detail-column-slot` 三张 + `detail-pane-overlay` 两张） | 二进制 | 二进制 |
| `apps/web/src/styles/app/main-area.css` | +34/−4 | +104/−3 |
| `docs/README.md` | +1/−1 | +16/−2 |
| `docs/reference/environment-traps.md` | +39/−0 | +982/−20 |
| `packages/app-host/src/habit-actions.ts` | +72/−9 | +52/−9 |
| `packages/app-host/tests/habit-actions.spec.ts` | +122/−0 | +103/−0 |

新进来的 4 枚（css / habit-actions.ts / 它的 spec / README）都是**两边各自改过同一文件**，
不是"又有新的撞车面"—— 与 §8.29 那次"同一行被两条线各修一次"是同一个机制，量大一档而已。
⚠️ `environment-traps.md` 那行要说清：main 侧 **+982** ⇒ 这一枚合并时**必然要人重写一遍编号与索引**，
不是 `--ours/--theirs` 能过的，也不许用"摘掉我们那 39 行"来省事（§8.36/§8.37 那两条待入 traps 的登记就是靠这 39 行活着的）。

✅ **本节顺手证明了一件可复用的事**：`scripts/check-selection-single-source.mjs` 在 merge-tree 里是
`Auto-merging` 而**不是 CONFLICT** —— 也就是 §8.36 那条"纯插入、避开别人改过的注释带"的写法
（`git diff --numstat` 两次都是 **N 增 / 0 删**）**真的让一条门禁在合流时与 main 那 79 行并存**。
判据的形状决定合流风险，这句在 §8.31 是对用例说的，这一趟是对门禁说的。

**③ 四端重装为什么这一趟仍然不能跑（这是 W1/W2/W3/W4/W5/W6/W7 七单停在 🔄 的唯一共同原因）**
不是判据缺口、不是截图没看、也不是设备负载：

- 现量载体差：**落后 main 475 笔 / 领先 51 笔**（这笔数每轮都在漂，别当不变量抄走）。
- 按既有纪律（那条"等窗口序列不许自动起重装"的账），**载体落后 main 二十几笔就已经等于把已装产物降级**；
  475 笔这个量级下跑 `reinstall:all`，四个端装出来的都会是**没有 main 上那 475 笔的产物** —— 那不是"交付一轮"，是一次回退。
- 正解载体是"**当前 main + 本批未提交文件**"，而它**要求先合并**；合并不在本单授权范围（Goal 第⑤条），
  且合并窗口又被上面①那 4 枚卡着。

⇒ 链条是 `合并授权 → 先合 main → 活树交叠归零 → 重装`，**头一环不在本单手里**。
本节把这条写成一段而不是散在七行里，就是为了下一轮不必重新推一遍"还差什么"。
⚠️ 报状态时**不许**因为"只差这一步"就把那七行改成 ✅ —— Goal 第④条只给三个词，差装就是差装。

---

## 8.39 §6 那张表**实际是 9 行不是 6 行**；逐行量过后三条探针当场坏了，其中两条的"✅"是空的（2026-10-04 11:0x 现量；本节零代码改动）

### 0. 为什么要补这一节，以及"六条"这个数从哪来的

Goal 第③条要求"§6 六条明文不做"逐项有账。开工前 §6 没被逐行量过 —— §8.16 那次收口对账打勾的是
**§1 的四道闸门**，§6 只在个别工单行里被顺带提到。而"六条"这个数是本单自己写的两处
(§8.16 末段"§6 六条不做"与 §8.17 那条"按 §6 那六条不做的口径")，**是从 Goal 措辞抄来的，不是数出来的**。

现量（`awk '/^## 6\./,/^## 7\./' docs/plans/detail-pane-alignment.md | grep -c '^|'` ⇒ **11**，去表头与表隔 = **9 行**）。
两处旧句已在原地标注，不改口径只改数字会留着同一个错在下一轮被当依据。

### 1. 映射与读数（10 条探针 ↔ §6 的 9 行；第 3 号探针量的不是 §6，是 AGENTS §3.1/3.2）

载体 `MB=f419df75 → HEAD=32652569`（`git merge-base main HEAD` 现取，不是抄的）。
装置两份：`/tmp/dp_s6_audit2.mjs`（探针 1–7）、`/tmp/dp_s6_audit3.mjs`（探针 8–10），
一次 `node` 跑完，`GUARDS_ALL_GREEN=1` 才算这节成立。
⚠️ 两个分母不同是因为射程不同：探针 1–7 与 **10** 覆盖 `apps/*`（1–7 的 diff 射程是 `apps/*` + `packages/ui`，
**2521** 新增行；10 跑的是常驻门禁，本批 47 枚 `apps/*` 改动全在它扫的 332 个文件里），
探针 **8–9** 只扫 `apps/web` + `packages/ui`（**1791** 行）。
🔴 后两条是**射程边界**不是结论 —— §6 那两行讲的是"不抄滴答那两个面"，滴答那是 web/桌面侧栏，
所以我按 web+共享层扫；**移动端如果哪天加了引导卡，这两条抓不到**，别把这一栏读成"两端都没加"。

| §6 行 | 探针 | 读数 | 这之后有没有常驻载体 |
|---|---|---|---|
| 1 emoji 当图标 | 6 | 本批 **`apps/*` + `packages/ui`** 新增 **2521** 行里，"会被渲染"的两种形状（JSX 文本节点 / icon 形状属性）**163** 行，含 emoji 码位 = **0**；被剥掉的注释里带 emoji 的渲染形状行 = **2** 条，旧的整行口径命中 = **43** 条 | 🔴 没有常驻门禁（`check:design` 查的是裸值；全仓 `scripts/*.mjs` 里唯一含 "emoji" 字样的是 `verify-ai-preferences-live.mjs:115` 的一个**数据字段** `emojiShare`，不是界面源码扫描） ⇒ **18:2x 起有了常驻载体**：同一道门禁的腿 C，只看剥注释后被渲染的部分（§8.74） |
| 2 空态插画 | 8 | 本批新增图片/矢量资产 **20** 枚，全部在 `apps/web/evidence/`（§6.2 规定一要求的验收截图）；**进界面的**插画/图形资产 = **0** 枚；界面新增 **1791** 行里引用图形的形状 = **0** 条 | 🔴 当时没有 → **18:2x 起有了**：常驻门禁 `check:detail-pane-slot` 的腿 A/B（§8.74） |
| 3 空态引导卡 | 9 | 界面新增 1791 行里引导卡形状 = **0** 条；分母：merge-base 上含「引导/新手」的文件 **88** 枚 | 🔴 当时没有 → **18:2x 起有了**：同一道门禁的腿 D（§8.74） |
| 4 番茄钟塞进列表模型 | 5 | focus 相关源文件 **17** 枚里，五条列表形状的命中 = **0** | 🟡 部分：`check:layering` 管"外壳不许自己拼 op"，不管"番茄页不许变成列表" |
| 5 设置/搜索改路由、搬右栏 | 7 | `App.tsx` 里"settings\|search 挂路由"的形状 = **0**；浮层那两套（`.ht-sheet` / `role="dialog"`）仍在 = **true** | ✅ **有，而且此前被我误记成"没有"**（18:4x 现跑：`cd apps/web && node ./node_modules/vitest/vitest.mjs run tests/settings-sheet-ia.spec.tsx tests/search-overlay-ia.spec.tsx` ⇒ `IA_RC=0`、`Test Files 2 passed`、`Tests 8 passed`。⚠️ linked worktree 里**没有**根 `node_modules/.bin/vitest`， 按那条老纪律走包内的 `node ./node_modules/vitest/vitest.mjs`）：判据不必是 `check:*` 门禁 —— `apps/web/tests/settings-sheet-ia.spec.tsx`（4 条）+ `apps/web/tests/search-overlay-ia.spec.tsx`（4 条）断的正是这一行的行为："打开设置/搜索后**侧栏与下层视图都还在 DOM 里**""`aria-modal=false` 且能回到原来那个视图""Esc / ✕ / ⌘K / 点 scrim 都出得去"。它们是 `@heyta/web` 的 vitest 套件（`include: ['tests/**/*.spec.{ts,tsx}']`），而 `pnpm check` 末尾跑 `pnpm -r test` ⇒ **每次 check 都在守**。⚠️ 口径要说清：这两族判的是**行为**（浮层不替换视图），不是"有没有人新加一条 `settings` 路由"的字样 —— 后者探针 7 量的就是那个，而字样级判据改名即静默失效（§8.74 那条边界）。**教训：写"没有常驻载体"之前要先问"常驻"的判据是谁跑的，别只搜 `check:*`。** |
| 6 `Habit`/`FocusSession` 加必填字段 | 4 | 两块 interface 逐行对 merge-base，新增行里的必填字段 = **0**；对照：真 `Habit` 块里必填字段 **1** 条（`name: string;`） | 🟡 部分：hydration 侧有测试，但没有"新字段必须可选"的形状检查 |
| 7 bump `CURRENT_SCHEMA_VERSION` | 1 | `packages/shared-schema/src/schema-version.ts`：merge-base = **1** / HEAD = **1** | ✅ `check:migrations` + 死链外的 schema 版本对账 |
| 8 `apps/*` 里判断该发哪条 op | 10 | `check:layering` → **RC=0**，「✅ apps/\* 分层边界完好（扫描 **332** 个文件，**9** 条规则）」；本批改过的 `apps/*` **47** 枚全在这 332 个里；`no-op-construction-in-apps` 在源码 `id:` 清单里 = **true** | ✅ 常驻，`pnpm check` 每次都跑 |
| 9 调高两道棘轮基线 | 2 | `check:l4`：`baseline:104`（web）+ `baseline:90`（mobile）改前=改后；`check:row-single-source`：`HT_FAMILY_BASELINE=28` 改前=改后 | ✅ 两道棘轮自己就是载体（余量为 0 ⇒ 净增即红） |
| —（AGENTS §3.1/3.2） | 3 | 本批改过的 `package.json` = **0** 枚；新增依赖行 = **0** 条 | ✅ `license-inventory.mjs` + `pnpm -r build` 的 deps 预检 |

⚠️ **19:3x 更正第 9 行那个 ✅ 的射程**（那一趟量的只是「读数没新增」这一半）：把两道棘轮的**基线常数本身**各 +1，门禁仍然 `RC=0`，还会把这次调高**打印成「已降 1 处 / 已降 1 个」** —— §1 闸门第 2 条那句「不许调高基线」到今天**没有任何机器消费者**（A/B 读数、三种候选形状与各自代价见 **§8.82**）。同一趟顺带量出 web 那一档有 **6 处余量**（98/104），所以「两道余量为 0」只对 mobile l4 与 `ht-*` 前缀族成立 —— 引用这句话时要带这一句，别把它读成「所有棘轮都是满的」。

### 1b. 两行标 🟡 的为什么这批**不**升级成常驻门禁（裁决指针，不是"以后再说"）

- **第 4 行「番茄钟塞进列表模型」**：`check:layering` 管的是"外壳不许自己拼 op"，确实不管"番茄页不许变成列表"。
  可建的形状是"focus 相关源文件里不许出现列表渲染的三种形状（`.map(` 之外的虚拟列表组件 / 排序拖拽 / 批量选择）"，
  但 §6 那一行禁止的是**产品形态**（把专注记录做成任务列表那种可排序可批选的表），它没有唯一的代码形状 ——
  今天任何一枚共享列表组件被番茄页复用都合法，只要它呈现的是记录而不是待办。⇒ 这一行由**界面判据 + 看图**守
  （W7 那三张图、`apps/web/tests/focus-detail-pane.spec.tsx` 与 `e2e/tests/focus-detail-pane.spec.ts` 两族同名不同载体），**不建门禁**，且这一格不许读成"待办"。
- **第 6 行「`Habit`/`FocusSession` 加必填字段」**：AGENTS §3.3 那条的真正机制是"消费侧给运行时默认值"，
  而我探了一遍**全仓没有集中的默认值表可以对账**：`packages/op-log/src` 里 `hydrat` 命中 **0** 处，
  `packages/domain/src` 只有 `entities.ts` / `habit-resilience.ts` 两处提到 hydration，默认值是**散在每个消费点**的。
  ⇒ "interface 字段 ↔ hydration 默认值"两侧对账的门禁**建不出来**（要建先得把默认值收拢成一张表，那是另一单）。
  本批可行的只有棘轮形状（按 interface 数必填字段、净增即红，同 `check:l4` 的基线套路），
  但那等于在**别人正在改的** `packages/domain` 上立一道新大门禁（§8.13 的"不越界"），
  且必填字段这件事 `pnpm -r typecheck` 对新数据是绿的、只在**已落盘数据的回放**上炸 —— 棘轮抓不到那一层。
  ⇒ 本批只留探针 4 的读数 + 这块边界，**不建门禁**，也**不**把它记成"待办"：要做就得连"默认值收拢"一起拍。

**探针 6 的口径改了三次**才站得住，三版的命中数都留着：整行扫 → **43**（全是注释里的状态记号 🔴⚠️）；

逐行剥注释 → 仍若干（跨行块注释中段那些行**没有可辨认的行首记号**）；
只扫"会被渲染"的两种形状 + **筛完再剥一遍** → **0**，而那 2 条被剥掉的正是注释（`renderedCommentHits=2` 是这行的承重数）。
📌 射程窄但每个命中都能判，好过射程宽而把 43 条注释记号一起报成违规。

### 2. 🔴 三条坏了的探针（都是第一版报了"✅"或"🔴"而那个数不成立）

1. **探针 8 第一版判红，红的是合规交付物**。它把 `--diff-filter=A` 新增的 20 枚图片资产全算成"抄了插画"，
   而那 20 枚是 `apps/web/evidence/**/*.png` —— AGENTS §6.2 规定一**要求**每轮界面验收落盘、人必须看的截图。
   ⇒ 一条"不许有图片资产"的判据如果不区分证据产物，就会反咬它所在仓库的验收纪律。
   修：资产腿排除 `/evidence/`，并把截图数**单独打进读数**（它非空正好证明资产扫描真的在跑，成了自检）。
2. **探针 9 第一版的 ✅ 是空的**。分母用的是 `onboarding|GuideCard|EmptyGuide` 在 merge-base 上的文件数，
   现量 **0 枚** ⇒ 那时候"新增行里 0 条命中"完全可能是"仓库里根本没这个概念，所以我的 needle 也造不出来"，
   这个 ✅ 什么也没说。改中文 needle（`引导|新手`）后分母 **88** 枚 ⇒ 0 命中才读成"没往界面里加"。
   📌 这是 §7 第 33 条那一族（永远通过的判据）的一个新面目：**分母为 0 的 0 命中**。
3. **探针 10 第一版从门禁的 stdout 数规则名，数到 0**。`check:layering` 成功时只印
   「扫描 N 个文件，M 条规则」，**不印名字** ⇒ 那条自检把一道真绿判成了空壳。
   改从门禁**源码**数 `id: '…'`（现量 9 条），并断言 `no-op-construction-in-apps` 在其中。
   📌 一般规律：**要数一个集合，去它的定义处数，不去它的打印处数** —— 打印是给人看的，通常会合计数。

### 3. 两份装置各带的对照（缺一个这节的数就不算被验证过）

- 探针 1–7：自检 7 条全绿；阳性对照 5 条 —— C-A 必填夹具 3 行应识别 2 条（实际 2）、
  B1 含 emoji 夹具必须被抓到、B2 剥注释必须真剥掉行首星号注释、B3 两种渲染形状都认出（2/2）、
  B 真 `Habit` 块必填字段 >0（实际 1）。
  🔴 控制 A 第一趟**失败**过：夹具行没 `trim`，被当成缩进行漏掉 ⇒ "筛子坏了"而不是"代码坏了"。
- 探针 8–10：自检 5 条全绿；阳性对照 C1 图形资产夹具 3 行应抓 3（实际 3）、
  C2 引导卡夹具 3 行**应抓 2**（第三行是注释文案，故意不该被抓 ⇒ 抓满 3 反而说明它在扫注释），实际 2；
  反向对照：本批带 `className=` 的 28 行里被 C1 筛子抓到 **0** 条（若 = 28 就是恒真筛子）。

### 4. 这一节真正产出的东西：**§6 的 9 行里只有 3 行有常驻载体**

表最后一栏数出来的：✅ 常驻 3 行（7、8、9），🟡 部分 2 行（4、6），🔴 **无载体 4 行**（1、2、3、5）。
   ↳ **14:0x 补**：第 1 行的代价已量过并据此**决定不建**（三处存量字形 + 一次要人看图的视觉改动 +
   接线要动在别人手里的 `package.json`），见 §8.49。剩下 2/3/5 行仍是"只能靠评审"。
也就是说这 9 条"不许"里，**有一半在下一次谁来做这个面时只能靠评审** —— 本节的读数是"这一批没违反"，
不是"永远不会违反"。

🟡 我没有顺手给那 4 行加门禁，两个理由：① 它们断言的是**产品取向**（不抄插画、不抄引导卡），
把取向写成码位/命名筛子会在下一次合理的界面改动上假红 —— 与 §6 上面那条"理由不是排期问题"同向；
② 真要加，成本已量过：探针 8/9 那两条筛子已经带对照、能红，落成常驻脚本约 40 行 + 一处 `pnpm check` 接线，
**贵在挑词表而不在写脚本**（`引导|新手` 这 88 枚文件里绝大多数是合法用法，直接常驻必红一片）。
⇒ 如果产品负责人要这条常驻，需要他先拍"界面上出现哪些词/资产算违规"，那不在本单授权范围内。

### 5. 状态没变

本节只新增这一节 + 修两处"六条"的数字，**零代码、零判据、零工单行状态变化**。
七行 🔄 的原因仍是 §8.38 那一条（载体落后 main **475** 笔 ⇒ 现在重装是把已装产物降级），
不是"还差这一节的审计"。

---

## 8.40 合流窗口那条判据**问错了问题**：活树交叠 5 枚里只有 1 枚真的需要人，而那 1 枚的处置早就写好了（2026-10-04 11:1x 现量；本节零代码改动）

> ⚠️ **本节四个数字已过时**（13:0x 现量：落后 509 / 领先 63 / 交叠 **7** / 冲突 **15**），
> 且这条判据已经**落成一条命令** —— 见 §8.44。留原读数是为了让"两小时漂 2 枚"这件事本身可查。

### 1. 先给新读数，再说旧判据为什么不行

| 量 | §8.38（10:5x） | 本节（11:1x） |
|---|---|---|
| 落后 main | 475 | **485** |
| 领先 main | 51 | **53** |
| 活树交叠（本批改过 ∩ 主检出未提交） | 4 枚 | **5 枚**（新入：`packages/app-host/src/index.ts`） |
| 提交级冲突（`git merge-tree --name-only main HEAD`） | 10 枚 | **10 枚**（同一批：5 张 evidence png + `main-area.css` + `docs/README.md` + traps 台账 + `habit-actions.ts` + 它的 spec） |

交叠的 5 枚逐枚现量（`本批 +x/−y` 对 `主检出工作树 +x/−y`）：
`docs/README.md` +1/−1 对 +1/−1 · `docs/reference/environment-traps.md` +39/−0 对 +103/−7 ·
`packages/i18n/src/locales/en.ts` +23/−0 对 +48/−25 · `…/zh-CN.ts` +27/−0 对 +48/−25 ·
`packages/app-host/src/index.ts` +12/−0 对 +18/−0。

### 2. 🔴 三方实测：5 枚里 3 枚 `merge-file` 干净通过，2 枚的冲突**与"别人在飞"无关**

判据（不落行号、不落印象 —— 行号那套我上一节刚用它翻过一次车）：

```sh
MB=$(git merge-base main HEAD)
git show "$MB:<f>" > base; git show "HEAD:<f>" > mine          # 本批那一版
git show "main:<f>" > head; cp "<主检出>/<f>" > wtree          # 已提交那一版 / 带着未提交改动那一版
git merge-file -p mine base head   ; echo $?                   # 对已提交的 main
git merge-file -p mine base wtree  ; echo $?                   # 对 main 的工作树
```

| 文件 | 对 `main` HEAD | 对 `main` 工作树 | 分类 |
|---|---|---|---|
| `packages/i18n/src/locales/en.ts` | rc=0 / 冲突 0 | rc=0 / 冲突 0 | 交叠但**不需要人** |
| `packages/i18n/src/locales/zh-CN.ts` | rc=0 / 冲突 0 | rc=0 / 冲突 0 | 同上 |
| `packages/app-host/src/index.ts` | rc=0 / 冲突 0 | rc=0 / 冲突 0 | 同上 |
| `docs/README.md` | rc=1 / 冲突 **1** | rc=1 / 冲突 **1** | 冲突在**已提交**那一版里就有 |
| `docs/reference/environment-traps.md` | rc=1 / 冲突 **1** | rc=1 / 冲突 **1** | 同上（台账 EOF 追加撞车） |

📌 **两个读数的差集才是这节的产出**：`对 HEAD 有冲突` 与 `对工作树有冲突` **逐枚相同** ⇒
主检出的那 55 枚未改动里，**没有任何一枚**给本批增加了一次人工解决。
README 那一枚尤其要说清，因为它看着最像"别人在跟我改同一行"：
主检出的未提交 README 改动是 **[0050] 那一行**（`git diff` 只有 1 个 hunk、`grep -c 0043` = **0**），
而冲突落在 **[0043] 那一行** —— 那行 `main` 里**已经提交过另一版修法**（就是本批那一行里我自己写下的
"`main` 上另一条线也独立把它修了一次"）。所以它是 §8.38 那 10 枚提交级冲突之一，**处置也已经写在那一行里**
（取带 web/mobile 半边的限定版）。traps 那枚同理：两边各自往台账末尾追加，正解是**两段都留、按工作树现量取号**
（§8.9 末段那条取号纪律）。

⇒ 于是"交叠 5 枚归零才叫窗口"这句（§8.38 写的、也是记忆里存的那句）**问的是错的问题**：
交叠枚数衡量的是"文件名撞上没有"，而合流真正要付的是"有多少处需要人做一次判断"。
现量的后者是 **0 处新增**（那 2 处早就各自带裁决）。

### 3. 换掉的判据（下一轮照这个跑，别再数交叠）

> **窗口判据（v2）** = `git merge-tree --name-only main HEAD` 的冲突枚数里
> **逐枚问"这一步要人写裁决吗"**：要 ⇒ 数进窗口；有既有裁决或可由重跑产物生成 ⇒ **不数**。
> 活树交叠只用来回答"现在能不能安全取号/追加"，**不再用来挡合并**。

按 v2 现量这 10 枚：**3 枚要人**（`main-area.css` 两套样式规则怎么并；`habit-actions.ts` 两边都改在
`export interface HabitActions {` 与 `createHabitActions(` 这两段上（本批 hunk −114/−129/−295/−307，
main 侧 −143/−157/−341 ⇒ **同两个函数**），连带它的 spec）；
**7 枚不要**（5 张 png 有确定的生产者 —— `e2e/tests/detail-column-slot.spec.ts` 与
`e2e/tests/detail-pane-overlay.spec.ts`，重跑那两份就覆盖成当前态；README/traps 各有上面那条既有裁决）。

> ⚠️ **14:06 把这 3 枚逐枚执行过 ⇒ 读成 1 枚**（§8.50；改在原句下面而不是划掉，因为"逐枚问要不要人"这个判据本身仍然成立，
> 错的是当时没执行）：`habit-actions.ts` 在候选树 `8b3240c0` 上**只有 1 个 hunk，且就是 import 说明符块**，
> 不是两个函数体 —— 上面那句"同两个函数"是**文件级 diff 的重叠**，与"合并时要人裁决的 hunk"不是一回事，
> 我当时把这两个层次混了。执行结果：import 并集零语法错零重名；spec 拼接要**补等于 ours 括号差的闭合**才过语法；
> `main-area.css` 两个 hunk 里只有 #1 是取值冲突，#2 的 main 侧是 HEAD 侧的**严格超集**外加一条新规则。
> 🔴 剩下要人的只有那一条：`flex-shrink: 0` 加两个取值，题面是"页头这一条许不许被压窄"。
> ⚠️ **14:5x 起这句要读成"两条"**（多出 `App.tsx`：AI 面与专注概览抢同一格，见 §3f）—— 那条拍板落进 main 之后合流面才涨的。
> ⚠️ 枚数与 hunk 形状都随 main 前进而变 ⇒ 合流当时要**重新执行一遍这三条**，不要引用这里的数。

⚠️ **边界（别读多）**：① `merge-file` 的行级三方与 `git merge` 的 `xdl_merge` 不是同一个器，
且我没开重命名检测 ⇒ 这里的"枚数"用作**方向**，真合并时以 `git merge` 的现场输出为准；
交叉核对做了两条：这 3 枚 rc=0 的文件**都不在** `merge-tree` 那 10 枚名单里（git 自己的合并机械给出同一结论），
而那 2 枚 rc=1 的**都在** ⇒ 两个引擎在 5/5 上同向。② 这节**没有**做任何合并、没有碰主检出那 55 枚未提交、
没有替任何人取号。③ 换判据**不等于**四端重装现在能跑 —— 它挡在后面的仍是"载体落后 485 笔 ⇒ 装上去是给已装产物降级"，
那一句在 §8.38 末段，本节只把"还差几个人工"这个数从 5 修正到 0 处新增 / 3 枚待裁。

---

## 8.41 Goal 那句"不许只在任务视图实现一份"第一次有了会红的读数：视图全集必须每个都选了边站（2026-10-04 11:3x，载体 `d0f323ca`）

### 1. 缺口在哪：那句最要紧的话只写在注释里

`apps/web/src/lib/keyboard-cursor.ts:71` 自己写着 ——

> 这张表的正确性**取决于"缺席都有理由"**，不取决于"在场都对"。

而"缺席都有理由"这件事当时的载体是一段 TSDoc 注释。**注释不能失败**。
现量出来的两处具体缺口：

1. 行为腿（"表外的视图按 ↓ 不绑光标"）用的是测试里**手抄的五个**视图名
   （`calendar / trash / search / growth / settings`）—— `focus` 也在表外，但**没进那个名单**，
   所以它从来没被这条判据走过一次；
2. 更要紧的是方向：**新加一个 `ViewKey` 不会有任何东西变红**。
   它既不在表里、也不在那五个里，于是那条循环只是"少跑一轮"，
   整族判据照旧全绿 —— 这正是 Goal 第②条要挡的那种"只在任务视图做了一份"。

### 2. 落了两条判据（都在 `apps/web/tests/keyboard-cursor.spec.tsx`，不新开第三个所有者）

| 判据 | 射程 | 牙 |
|---|---|---|
| 分区那条 | `view-tabs.ts` 的 `ViewKey` 全集 = `CURSOR_VIEWS` 表里的 ∪ `ACCOUNTED_OUT` 登记表 | 缺口 / 重叠 / 表里出现 ViewKey 没有的键 / 解析读空（`ViewKey < 9` 或表 `0` 项直接抛） |
| 行为那条 | 表外视图**从两处真源推出来**（不是手抄名单），逐个挂上钩子按 ↓ ⇒ 选中不许动 | 同一趟开头先做一次正向对照：`tasks` 面按 ↓ **必须**选中第一行，否则"没动"可能只是夹具坏了 |

`ACCOUNTED_OUT` 只登记"**哪一个视图被交代过**"，理由本体留在源码那段注释里（它逐条现量了六条）——
测试里重抄一遍理由就是造第二份抄件，本篇 §8.33 那一族刚记过它怎么漂。

### 3. 臂：`research/tools/mutation-rigs/mutate-view-universe.mjs`，5 臂按预期 5/5

| 臂 | 变异 | 预期 | 读数 |
|---|---|---|---|
| V1 | `ViewKey` 加 `archive`（两处都没交代） | 只红分区 | `rc=1 passed=24 failed=1 分区红=1 行为红=0` |
| V2 | 登记表里删掉 `focus` | 只红分区 | 同上形状 |
| V3 | 表里给 `trash` 加一行、名单没跟着改 | 只红分区 | `分区红=1 行为红=0` —— 🟡 **行为腿仍绿是设计出来的**：它循环的就是"推出来的表外集"，`trash` 进了表就不在循环里。要抓"接错了的视图"靠的是同一族里那圈**字面** `cases` 清单（`tasks/quadrant/timeline/habits/notes`），它**故意不从表里派生** —— 派生等于让被检者自己出卷（V3 与 B14 那条"表里前缀写错 ⇒ 2 红"就是靠这份独立性才有第二条红） |
| V4 | 把 `const CURSOR_VIEWS` 改名 | 两条都抛 | `failed=23`（模块自己起不来，整族红），分区/行为各 1 ⇒ 读空不会被当成读通 |
| V5 | 在类型块**外面**追加一行含 `'foo' 'bar'` 的注释 | **必须不红** | `rc=0 passed=25` ⇒ 解析器锚的是那块，不是整个文件 |

`FINAL_SAME=true`（三枚被改文件 md5 与开工前逐字相同）、`POST_RESTORE rc=0 passed=25`、
未变异对照 `25/25 passed` 才允许信上面的红。

### 4. 顺手抓到的一条真缺陷（是我自己那一版留下的）

行为腿手抄名单**漏了 `focus`** —— 这不是假设有问题，是"番茄页没有可走的行"那条裁决（§6 第 4 行）
**一直没有被走过一次**。改成派生集之后它进循环了，仍然绿 ⇒ 那句裁决现在是**证过**的，不是写着玩的。

### 5. 收尾读数与三条探针错

- `apps/web` 全量：**115 files passed / 2 skipped，1595 passed / 12 skipped**；
  `tsc --noEmit -p tsconfig.spec.json`：**0 error**；`check:selection-single-source`（**那一趟是 A–G**；§8.46 起该门禁有 A–H 八道）：**RC=0**，
  末行逐字未变（`2 份实例 … 词表 3 类全有消费者（task 10 / habit 7 / note 13）… 接线声明 17 处`）。
- 🔴 第一版三条 TS 编译错，两条属于**新种类**：
  ① `block[1].matchAll` 在 `noUncheckedIndexedAccess` 下要显式收窄成 `body === undefined` 才抛 ——
     写守卫时只用 `if (!block)` 是不够的，`block[1]` 仍然是 `string | undefined`；
  ② 🔴 **`let root: Root | null` 被别的函数赋值，TS 在调用后不重设收窄** ⇒ 我把"卸载四行"抄进循环之后，
     第二轮起 `root?.unmount()` 被判成 `never`（`Property 'unmount' does not exist on type 'never'`），
     而**跑得是好的**。正解是把那四行抽成 `unmountHarness()`：函数体入口收窄重置。
  ③ 装置的读数第一版**四臂全 FAIL 而产品没坏** —— 它拿默认 reporter 的文本抓用例名与汇总行，
     而 vitest 的汇总在有用例失败时是 `Tests  1 failed | 24 passed (25)`，我的 `/Tests\s+(\d+) passed/` 匹配不上，
     于是 `passed=0`、用例名也是 0。改成 `--reporter=json` 读 `assertionResults[].status/fullName`。
     📌 **和 §8.39 第 2.3 条同一个形状**：要数一个集合，去它的机器可读出口数，不去给人看的打印里数。
- ⚠️ **边界**：这族判据覆盖的是 **web 的视图全集**（`ViewKey` 那一维）。
  触屏端没有" ↑↓ 走列表"这回事（§8 的 W1b 边界②），它的"面"由断言 F 的四处渲染面 + 六处递送层顶着
  （**这两个数在 §8.42 之后是 5 / 5**：时间线那一面从"递送层"里被读出来了）；
  把 mobile 的 27 枚 screen/section 也建成一张全集表需要**先拍"触屏端的选中是什么"**，那是拍板 #1 的题面，不在这里顺手做。

### 6. §1 四道闸门在这一格怎么打勾（11:3x 现量，载体 `d0f323ca`→`29903ba0`）

| 闸门 | 这一单的读数 |
|---|---|
| 归属门 | 我**写**的只有三处：`apps/web/tests/keyboard-cursor.spec.tsx`（本单的）、`research/tools/mutation-rigs/mutate-view-universe.mjs`（新增，本单的）、本篇。两处被读的源码（`view-tabs.ts` / `keyboard-cursor.ts`）**只读不改**，且在主检出与 HEAD 上都干净 |
| 两道余量为 0 的棘轮 | 零样式改动 ⇒ 没碰；`check:l4` 与 `check:row-single-source` 的基线数字本轮**未被读过也不需读**（没有任何 CSS/`ht-*` 文件进 diff） |
| 干净检出复跑 | 判据的全部输入相对 HEAD 未提交数 = **0**（`git status --porcelain -- apps/web/src apps/web/tests research/tools/mutation-rigs docs/plans/detail-pane-alignment.md`）。主检出同路径上有 **1** 枚脏（`features/sync/VaultSettingsPanel.tsx`），它**不是**这条判据的输入，而且 linked worktree 各有自己的工作树 ⇒ 我这趟读的是自己那份 |
| `packages` 改完先 build | 本轮零 `packages/*` 改动 ⇒ 不适用（`git diff --name-only d0f323ca^..29903ba0` 里 `packages/` 命中 0） |

## 8.42 一处"有底色、没声音"的面是**合法**躲过门禁 F 的：类别漏洞、"一处底色配一条通道"，以及两层判据各自的盲区（2026-10-04 11:4x–12:1x）

### 1. 怎么撞上的：逐行读 RELAYS 时问了一句"这个类别的判据是什么"

§8.41 补完"视图全集"那一维之后，剩下的那一维是**面**。F 当时列 4 处渲染面 + 6 处递送层，
读 RELAYS 时问的是：登记成"递送层"的文件，判据到底是什么？原文是 ——

```js
const forwards = SELECTION_ID_PROPS.some((p) => new RegExp(`\\b${p}=\\{`).test(src) || new RegExp(`\\b${p}\\s*===`).test(src));
```

**两种写法都算"在递"**。可后半句 `p ===` 描述的根本不是"递"，是**自己算**。
而共享 `packages/ui/src/timeline/TimelineBoard.tsx` 恰好就是自己算的那一层：
`activeTaskId === row.taskId` 自己出谓词、自己 `styles.rowActive` 上底色，
**两处**渲染点（有排期那一行的行区 + 未排期泳道那一条）。递送层不要求发无障碍通道（那是面的义务）
⇒ 它有底色、没声音，而 F 全绿。

🔴 **这不是"解析漏了一处"，是类别本身漏了一整类**：任何"自己算 + 自己上色"的共享组件
只要被登记进 RELAYS 就永久免检，而它看起来比"面"更像基础设施（`packages/ui/` 里、被两端 import），
所以**登记错类别的人不会觉得自己登记错了**。

### 2. 先证明"缺陷前提是真的"，再改规则

一次性证明 `/tmp/dp_leak_proof.mjs`（跑完按 md5 还原，还原证明打进输出）：
把 H10 那臂的形状（面登记删掉 + 文件加进 RELAYS）在**收紧前的规则**下跑一遍 ⇒
`jsxOnly=false / eqForm=true / oldRule=true` → `VERDICT=LEAK_PROVED_AND_CLOSED`。
读作：**旧规则下这一臂是绿的**（所以这一格确实没人守），收紧后同一臂转红。
没有这一步，"我修了一个类别漏洞"和"我讲了一个故事"在证据上无法区分。

### 3. 产品改了什么：一处，两端同时受益

`TimelineBoard` 两处渲染点各加 `aria-pressed={rowSelected}`，并把 `rowSelected` 提成一行
（原来两处各自内联 `activeTaskId === row.taskId`，提成变量是"底色与通道同源"那条判据的前提）。
走 `aria-pressed` 而不是 `aria-current`：这是共享 RN 组件，RN 的 `AriaProps` **没有** `aria-current`，
写它不报错也不生效（§8.26），而平铺 `aria-pressed` 是两端同一份的通道（对象形态 `accessibilityState`
会被 RNW 0.21 整个丢掉，`check:rn-aria` 就是拦这个的）。复原后 md5 `0c534d9f…496fa`。

### 4. 门禁改了两条规则，各自带边界

| 规则 | 改法 | ⚠️ 边界（下一轮别读多） |
|---|---|---|
| 递送层只认"往下递" | `forwards` 去掉 `p ===` 那一半；失败文案改成点名出口："如果它其实是**自己拿 id 算痕迹**，那它是一处面：加进 FACES 并写清端与通道" | 它判的是"类别不能互相躲"，**不判数量** —— 数量靠下一条 |
| 每一处底色都要配一条通道 | `paintSites = 文件里 styles.rowActive 的次数`，`channelSites = 通道属性里带该面 driver 的次数`，`channelSites < paintSites` 即红 | 🔴 分母来自**字面 token** `styles.rowActive`：把它改名（比如 `styles.selected`）这一腿会静默变成 `paintSites=0` 而**永真**。这就是臂 T1/H11 存在的理由 —— 它不是装饰，是这条腿唯一的外部对照 |

两条都跑在 `readTracked()` 上，而它**已经剥注释**（`stripComments`），所以"往注释里写一句
`aria-pressed={rowSelected}`"骗不过去 —— 这一条不是假设，是臂 T6 量出来的（见下表"必须不红"）。

### 5. 补上共享层那一份判据：`packages/ui/tests/timeline-row-selection-trace.spec.ts`（7 条）

为什么还要一份：门禁 F 只数"这个文件里出现几次"，web 那一端另有真浏览器腿，而 **RN 那一端今天
没有任何一层行为测试会替它红** —— `packages/ui` 不引 jsdom 不 render、`apps/mobile/tests/` 一个
render 用例都没有（同 `habit-row-selection-trace.spec.ts` 文件头那段限制说明）。所以这份判据是**源码级**的，
按 testID 逐处配对，取"这颗元素开标签"的口径是**扫花括号深度**找 `>`：
不能"取前 N 个字符"（属性表达式里到处是 `=> ? :`，窗口还会把里层 `<Text>` 蒙进来），
也不能"找第一个 `>`"（那就是被 `=>` 截断）。

### 6. 臂：`research/tools/mutation-rigs/mutate-timeline-face.mjs`，6 臂按预期 6/6

每一臂同时打两个探针（A=门禁 F，B=上面那 7 条），**其中两臂的预期是"一个红、另一个必须绿"** ——
那两条才是这一节的产出：

| 臂 | 变异 | 预期 A / B | 读数 |
|---|---|---|---|
| T1 | 只摘第二处（未排期泳道）的 `aria-pressed` | 红 / 红 | `A rc=1 断言F行数=1 ｜ B 红 1/7（泳道那条通道判据）` |
| T2 | 两处全摘 | 红 / 红 ≥2 | `A 断言F行数=2 ｜ B 红 2/7` |
| T3 | 把第二处通道从 `Pressable` 挪进里层 `<Text>` | 🟡 **A 绿** / B 红 | `A rc=0 ｜ B 红 1/7` ⇒ **门禁看不见"位置"**，只能由 B 兜 |
| T4 | 两处换成对象形态 `accessibilityState` | 红 / 红 ≥2 | `A 断言F行数=2 ｜ B 红 3/7`（含那条"不许对象形态"） |
| T5 | 把第二处谓词换成常量 `true` | 🟡 **A 绿** / B 红 | `A rc=0 ｜ B 红 1/7（谓词那条）` ⇒ `driverComesFromSelection` 扫到**任意一处**右半边含等值即放行 |
| T6 | 阴性对照：通道字样只写进注释 | 绿 / 绿 | `A rc=0 ｜ B 红 0/7` |

`CONTROL` 先跑未变异：门禁绿 + `total=7 红=0`（**分母现量**，读空按台子故障 exit 2，不当"零条红=绿"）；
`ARMS=6 AS_EXPECTED=6 FAIL=0 FINAL_SAME=true`、`POST_RESTORE gate rc=0 spec 红=0/7`。
另加进原有 `mutate-selection-f.mjs` 四臂（H10 退回递送层 / H11 摘一处 / H12 摘两处 / H13 换写法不换语义）：
`ARMS=13 AS_EXPECTED=13 FAIL=0 FINAL_SAME=true POST_RESTORE rc=0`。
🔴 **H13 与 T3/T5 是同一件事的三面**：门禁证明"通道在、且来自那个谓词"，
它**不**证明属性值语义（`? true : undefined` 与 `rowSelected` 等价）也不证明位置与内容 ——
值语义那一腿在 e2e（下一节）。

### 7. 真浏览器那一腿与"零视觉变化"的证明

`e2e/tests/selection-projections.spec.ts` 时间线那一段加两条：选中的那条 `toHaveAttribute('aria-pressed','true')`、
没选中的那条 `not.toHaveAttribute(..., 'true')`。A/B（`/tmp/dp_ab_aria.mjs`，两处通道 → `data-nosay`，
中间重打 `packages/ui`(tsup) 与 `apps/web`(`vite build`)）：

```
UI_BUILD_RC=0 WEB_BUILD_RC=0 E2E_RC=1 ARIA_LEG_RED=true
RESTORED md5_same=true UI_BUILD2_RC=0 WEB_BUILD2_RC=0 BACK_TO_GREEN rc=0 3 passed
PIXELS_IDENTICAL=true  VERDICT=SAYING_HAS_TEETH_AND_ZERO_VISUAL
```

读作：**摘掉"说出来"只有新加那两条红**（上面三条底色读数不跟着红 —— 它们各自量的是别的东西），
而复原前后 `03-timeline.png` **逐字节相同** ⇒ 这一单是**零视觉变化**的（§7 里"改视觉为零"那条口径）。
配置顺手把 `selection-projections` 加进本单 e2e 的 `testMatch`（之前它不在任何一族的名单里，
`pnpm check:ai-e2e` 会跑，但本单的重打-再验链路不跑它）。

### 8. 探针自己会造红：`bgOfTestId` 的"两次独立的读"

改前状态：同一个构建连跑三趟红一趟，`Expected: "rgba(0, 0, 0, 0)" / Received: ""`（当时 loadavg 19.67）。
机制：`await expect.poll(read).not.toBe('')` 之后**又 `return read()` 读了一次** ——
轮询确认非空与函数返回之间，React 把那一行换成新节点，第二次读落到分离节点上拿到空串。
改法：记下轮询**真正接受的那一次**读数（`seen`），不再另读一遍。
改后 4/4 绿。⚠️ 措辞边界：这**只构成"被指认的那条机制已移除"**，不构成"这一族探针已排除抖动"
（§7 里"同等并发下仍全绿"既不支持也不排除那一族，同一口径）。

### 9. 五张图重新入档，逐张看过

`apps/web/evidence/selection-projections/{01-list,02-quadrant,03-timeline,04-switch,05-search}.png`
这五枚相对 HEAD 全变（`126163→126515 / 59257→59675 / 30765→31106 / 126053→126260 / 127781→123530`）。
**来源不是本单**：它们上次入库是 `0c159f7f`（10-03 23:57），此后 `apps/web`+`packages/ui` 有 **15 笔**提交
（W4 高度轴与可收起、W5 复选框描边、W6 计数格、W7 空态、W1c 便签痕迹与 `aria-current`…），
那几笔都没重跑这一族 ⇒ 这次是**把证据追回到当前产物**，顺带证明"截图会随构建漂"这件事在本仓是常态。
逐张读数（人看过）：01 列表里"选中的那条甲"带浅蓝底、乙白底；02 四象限同一条落在"先不做"格且同一种蓝；
03 时间线"未排期（2）"里只有第一条带蓝底（**这块板的选中底色本来就比列表淡**，因为泳道自带底色，
断言比的是同一个值，不是"看起来一样"）；04 换选中后是**第二条**带蓝、第一条回白底；
05 搜索里"要点亮的搜索结果"带蓝、另一条白底（这张相对 HEAD 少 4.2 KB，量出来的是**页面滚动位置差 ~34px**：
顶部"收集箱"标题不在画面内、左下角多出一个帮助图标，不是少画了东西）。

### 10. §1 四道闸门在这一格怎么打勾（12:1x 现量）

| 闸门 | 这一单的读数 |
|---|---|
| 归属门 | 改动 **8 枚源码/文档 + 5 张 png**，全部本单：`scripts/check-selection-single-source.mjs`（F 的三条规则）、`packages/ui/src/timeline/TimelineBoard.tsx`（产品）、`packages/ui/tests/timeline-row-selection-trace.spec.ts`（新增 7 条）、`research/tools/mutation-rigs/{mutate-selection-f,mutate-timeline-face}.mjs`、`e2e/{tests/selection-projections.spec.ts,playwright.detail-pane.config.ts}`、本篇。主检出（`e2e/` 前缀下）有 **6 枚**脏：`auth-journey/auth-journey.spec.ts`、`auth-journey/helpers.ts`、`legal-links/legal-links.spec.ts`、`tests/vault-settings.spec.ts`、`vault/vault-journey.spec.ts`、`windows-shell/auth-journey.spec.ts` —— 逐枚都不是本单判据的输入（本单读的三枚 e2e 文件在它那里干净，`packages/ui`、门禁脚本、本篇也各零脏） |
| 两道余量为 0 的棘轮 | 零 CSS/`ht-*` 改动：`check:l4` rc=0（"三道断言都通过"）、`check:row-single-source` rc=0 —— **两道都没读基线数字，因为没有任何输入进它们** |
| 干净检出复跑 | 判据输入 = 门禁脚本 + 一枚共享组件 + 两份判据文件，全部在本检出内；`check:rn-aria` / `check:layering`（332 文件 9 规则）/ `check:design` / `check:ui-language`（zh 2864 = en 2864）/ `check:selection-single-source` **各 rc=0**，末行逐字未变 |
| `packages` 改完先 build | 🔴 这一格本轮**真的用上了**：`packages/ui` tsup → `apps/web` `tsc -b && vite build` → 才跑 e2e（A/B 两趟各重打一次，`UI_BUILD_RC=0/WEB_BUILD_RC=0` 与 `UI_BUILD2/WEB_BUILD2` 四条都在输出里）。**代价先付过一次**：A/B 第一版中间用 `cd ../apps/web` 换目录，从 `packages/ui` 出发深度不对 ⇒ `WEB_BUILD_RC=1` 而 e2e 照跑，那一趟量的是**上一轮的 dist**（那次失败恰好是真探针故障，所以没被误当成产品缺陷，但这是运气不是纪律） |

**其余读数**：`packages/ui` **27 文件 / 474 passed**（+7）、`apps/web` **1595 passed / 12 skipped**、
`apps/mobile` 607 passed；`tsc --noEmit -p tsconfig.spec.json` 在 `packages/ui` 与 `apps/web` 各 **0 error**；
e2e 详情面整族 **29 passed**（12:2x 电池复跑现量：`detail-column-slot` 3 + `detail-pane-collapse` 7 + `detail-pane-overlay` 2 + `focus-detail-pane` 6 + `keyboard-cursor` K1–K8 共 8 + 本单 `selection-projections` 3）。

### 11. 三条探针错（前两条是"看着像门禁红/看着像绿"那一族，第三条是"同一个数两种取法给两个答案"）

1. 🔴 **门禁脚本文件名拼错时 `rc=1` 长得和"门禁红"一模一样**。我把电池写成 `scripts/check-$g.mjs` 循环，
   `l4` 与 `design` 的真实路径是 `scripts/check-l4-no-style.mjs` 与 `design-system/heyta/check-hardcoded.mjs`
   ⇒ 两格 `rc=1`，末行是 `Node.js v22.22.0`（Node 自己崩的尾巴）。**判据**：跑门禁要看它打印了自己那句结论，
   只读退出码就是把"我命令写错了"记成"产品坏了"。
2. **管道后 `$?` 是 `tail` 的**（§7 老账，本轮又付一次）：`tsc … | tail -5; echo TC_RC=$?` 报了 `TC_RC=0`
   而同一趟日志里明明有一条 `error TS2554`。改成先重定向到文件、再 `echo $?`，那条类型错才现形
   （`expect(x).toMatch(re, '消息')` —— `toMatch` 只收一个实参，消息要挂在 `expect(x, 消息)` 上）。
3. **同一枚集合我用两种取法数出 2 和 4**。数 FACES 有几枚，第一版 `grep -c "    kind:"`（四个空格）给 **2**，
   改成 `awk '/^const FACES = \[/,/^\];/' | grep -cE "kind: '"` 给 **4** —— 原因现量了：那张数组里**两种字面形状并存** —— 两枚是多行对象（`kind:` 在行首、四个空格），另两枚是单行对象（`  { kind: 'note', … }`，`kind:` 前面是 `{ `）。
   ⇒ **按某一种形状数的取法必少算**，而两个读数都"看着合理"：只信第一版就会把"4 面 → 5 面"写成"2 面 → 3 面"。
   📌 正解不是"更小心地写 grep"，是**拿被计数者自己的打印当交叉对照**：门禁那句 `✅ F：5 处渲染面…` 是第三个读数，
   三个里只有它由生产代码维护，所以它才是锚。

### 12. 镜像那一格：递送层不许"一边递、一边自己出痕迹"（12:2x 现量 + 新规则 + 两臂）

同一类错误的另一半。第 4 节那条收紧只挡住"**整个**躲进 RELAYS 免检"，
没有挡住"**既** `p={` 往下递、**又**自己拿 id 上色" —— 后者两张表都各让一步：
递送层判据看见 `p={` 就放行，面判据根本不扫它（它不在 FACES）⇒ **痕迹那一半永远没人要求它说话**。

先现量，再决定要不要写规则（不现量就写 = 给一个不存在的需求加门禁）：

| 登记为递送层的那五处 | 选中 id 出现在哪几行 / 什么形态 | 自己出痕迹？ |
|---|---|---|
| `apps/mobile/src/screens/QuadrantScreen.tsx` | 87 声明 / 99 解构 / 111 `activeTaskId={activeTaskId}` | **无**（三枚 needle 各 0 命中：`styles.*select` / `styles.rowActive` / `aria-current=` 与 `aria-pressed=`） |
| `apps/mobile/src/screens/TimelineScreen.tsx` | 48 / 52 / 63 | 无（同上，各 0 命中） |
| `apps/web/src/features/quadrant/QuadrantBoard.tsx` | 152 / 155 / 277 | 无 |
| `apps/web/src/features/timeline/TimelinePanel.tsx` | 53 / 61 / 76 | 无 |
| `packages/ui/src/quadrant/QuadrantBoard.tsx` | 133 / 315 / 379 | 无 |

⇒ **今天没有缺陷**，所以这一条是**挡未来**的。而"挡未来"的判断本身可能错，
所以它必须带臂（H14 注入 / H15 阴性对照），否则就是一句会慢慢烂掉的装饰 ——
第 1 节那个漏洞的成因正是"看起来不像缺陷的地方没人写判据"。

规则：RELAYS 循环里加一枚 `ownTrace` 扫描（`styles.<…>[Ss]elect` / `styles.rowActive` /
`aria-(current|pressed)={`），命中即红，文案点名出口："递"和"算"同时成立时，
"算"那一半必须按面登记。跑完读数：门禁 **RC=0**（五层各 0 命中），
`mutate-selection-f.mjs` 从 13 臂变 **15 臂，AS_EXPECTED=15 FAIL=0 FINAL_SAME=true POST_RESTORE rc=0**，
其中 `H14 rc=1 断言F行数=1`（在 mobile 四象限那层的转发行旁注入一行 `aria-pressed={activeTaskId !== null}`）、
`H15 rc=0`（同样的字样只写进注释 —— 与 T6 一道构成"两侧规则都跑在剥过注释的源码上"的正反两面）。

⚠️ **边界**：① needle 是**字样**级的，把 `rowActive` 改名会让这一腿静默失效 —— 与第 4 节那条同一个边界，
H11/H14 是它的外部对照；② 它挡"递 + 算并存"，**不**挡"既不递也不算"（那是 `forwards` 那条的射程）；
③ 它不判"该不该有痕迹" —— 哪一层哪天真的开始上色，正确动作是**把它加进 FACES 并写清端与通道**，
而不是把这一腿关掉。

### 13. 边界（别读多）

- 🔴 **RN 那一端仍没有行为级判据**：这一格补的是**源码级** 7 条 + 门禁两条，
  真浏览器腿在 web。触屏端"读屏念不念这一行"要等 iOS/Android 的无障碍实测（`verify:mobile-*` 那一族今天不测 AX 属性），
  **不许把这一节读成"两端都验过"**。
- 门禁的"每处底色配一条通道"分母来自字面 `styles.rowActive`（第 4 节那条边界），改名即静默失效 ——
  所以 T1/H11 那两条外部对照是这条腿的一部分，不是可选附件。
- 类别收紧只覆盖**已登记**的表：新写一个"自己算 + 自己上色"的共享组件而既不进 FACES 也不进 RELAYS，
  挡它的是断言 F 的"表外面"那条（`unlisted.length`），不是本节这两条。
- 本单没动 `check:ai-e2e` 的名单，也没把新 rig 挂进 `pnpm check`（与 `mutation-rigs/` 其余台子同口径：
  原地变异源码，不能进每次 push 的门禁）。

### 14. 整链电池复跑（12:2x，载体 `f2379dec`，25 步 RC=0 / `BATTERY_RESULT=ALL_GREEN`）

这一格是**提交之后**补的，理由是前两节那两条更正只有在"全部改动已进 HEAD"的状态下才量得准：
七道门禁 + token 生成两步 + 六包 typecheck + 六包全量单测 + `apps/web` 重打两步 + e2e 族 typecheck + e2e 族，
逐步 RC=0，`SELF_CHECK log_names=25 unique=25 dupes=[]`（电池自己那条"步骤名不许撞"的自检也在跑）。
其中 `test ui` 这一格现在含本单那 7 条（该包 **27 文件 / 474 passed**）。

🔴 **这一趟顺手量出一件比"截图会漂"更细的事**：电池重跑 e2e 族改写了 **10 枚** evidence png，
其中 3 枚是本单两分钟前刚提交的 `selection-projections/{01-list,03-timeline,04-switch}.png` ——
也就是说 §8.42 第 9 节那句"随构建漂"还**低估**了它：**同一份构建、同一个 spec，两趟之间也会漂**
（`01-list` 126515→126506、`04-switch` 126260→126267）。
而 `03-timeline.png` 是 **字节数完全相同（31106 = 31106）但内容不同** ——
📌 所以"大小一样就没变"这种快捷判据在这批证据上是**错的**，`cmp` 才是；
第 7 节那个 `PIXELS_IDENTICAL=true` 之所以还成立，是因为它是**同一趟里**变异前后两张图直接 `cmp`，
不是"和上一次提交的图比"。措辞边界：这一条不推翻任何结论，它划清的是"逐字节相同"这句话**比的是哪两张图**。
10 枚全部 `git restore` 还原（本单提交的版本是刚看过、且断言全绿那一趟的产物；
别的单的 4 枚由它们的所有者管），还原后 `git status` 只剩别人那枚 `scripts/mutate-closeout-gates.sh` 与两枚软链。

### 15. 合并前把**收紧后的门禁拿到 main 的树上跑一遍**（12:3x，载体 `21c46c35` × main `67049d18`）

为什么做这一趟：本单把门禁改严了，而它合并之后要跑在 **main 的树**上 —— "我这棵树绿"推不出"合起来绿"。
做法零 `.git` 写入（不开新 worktree、不动别人的索引）：

```bash
git archive main | tar -x -C /tmp/heyta-main-preflight      # 84 MB，只含跟踪文件
cp <本检出>/scripts/check-selection-single-source.mjs /tmp/heyta-main-preflight/scripts/
node scripts/check-selection-single-source.mjs              # 在 main 的树里跑我这版
```

| 跑法 | RC | 红集分解 |
|---|---|---|
| **main 自己的门禁 × main 的树** | **0** | main 自洽（它没有断言 G，`grep -c '断言 G'` = 0） |
| **我的门禁 × main 的树** | 1 | A/B/C/D 各 **0** 条 · E **1** 条 · F **7** 条 · G **1** 条 · "表外面"（`没在 F 的任何一张表里`）**0** 条 · "文件不在了" **0** 条 |

逐条判读，三条各有各的主：

1. **F 那 7 条不是账** —— 全部是"main 还没有这批源码"（`TaskRow`/`NotesBoard`/`TimelineBoard` 的通道与谓词）。
   合并把这批源码带进去，它们自己消。
2. **G 那 1 条正是 #16 那两行**，这趟把它们量化了：点名 `apps/web/src/features/trash/TrashView.tsx busyId` 与
   `apps/mobile/src/screens/TrashScreen.tsx busyId`。⚠️ 别读成"日历/回收站那条线欠债" ——
   main 上**根本没有断言 G**（它是我这批改出来的），所以这两处在 main 侧既不是红也不是漏，
   是**我合并时要补的两行登记表**。
3. 🔴 **E 那 1 条两边都不是 —— 是探针假红**，而我差点把它登记成别人的缺陷。
   它点名 `packages/ui/src/calendar/CalendarDayBoard.tsx  onOpenTask`。
   第一反应是"日历那一面真的断线了"（本单 §8.24 刚为四象限修过同形状的洞，太像了）；
   去读那一行才看见：`CalendarDayBoard.tsx:107-113` 写的是
   `const taskListProps = { density, onToggleTask, onOpenTask, busyTaskId, labels }`，
   下面由 `{...taskListProps}` 展开进 `TaskList` —— **接线是对的**。
   机制：main 的 `f37ade5b`（10-04 10:13）给 E 加了一枚 `objectSpreadUseOf(src, name)`
   （"prop 出现在被展开的对象字面量顶层"也算用起来），而本检出从**旧 main** 切出，没有它。
   📌 **登记别人的缺陷之前先读那一行** —— 这条与 §8.39 那三条探针错同族，
   新的是它的方向：**"像我们刚修过的那个洞"不是证据**，相似形状只会让人跳过读本体那一步。

#### 🔴 我试着"提前把它搬进来"，搬出一个更坏的陷阱（已撤销）

想法很自然：既然缺的是 main 的一枚容差，提前搬进本检出，合流时这枚文件就"只有一侧要动"。
搬完当场做三方现量（`git merge-file` 拿 merge-base `f419df75` / 我这侧 / main 那侧）：

| 状态 | merge-file | 产物 |
|---|---|---|
| **搬了容差** | `rc=0`、`markers=0`（**看起来干净**） | 🔴 `node --check` 报 `SyntaxError: Identifier 'objectSpreadUseOf' has already been declared` —— **两份函数定义** |
| **不搬**（撤销后） | `rc=0`、`markers=0` | ✅ `objectSpreadUseOf` **1** 份 · `paintSites`/`ownTrace` 各 **3** 处（我那两条新规则在）· `node --check` OK |

成因：我插的位置（`useOf` 之后）与 main 插的位置不同 ⇒ git 把两处**不重叠的新增**都收下，
文本层"自动合并成功"，语义层整枚门禁脚本**不能解析**。
📌 **这是 §8.40 那条判据的一个新面目**：判"合并要不要人"不能只看 `merge-file` 的 rc 与 marker 数，
**还要看产物能不能解析**（`node --check` 一条命令的成本）。
而"搬过来之后我这棵树绿"完全不构成理由 —— 它证明的是**这一棵树**，不是**合起来那棵树**。
处置：`git restore` 撤销搬运（现量 `grep -c '^function objectSpreadUseOf'` = 0、门禁 `RC=0`），
让这枚文件走自动合并。

⚠️ **边界（三条）**：① "自动合就两侧都在"这句**只在 main 停在 `67049d18` 这一刻成立**，是瞬时读数 ——
合并程序里要留一条：**合完立刻**跑这道门禁 + 两把 rig（`mutate-selection-f` / `mutate-timeline-face`），
不能只跑 `pnpm check`（它不含 rig）；② `git archive` 不含未跟踪文件，主检出里别人在途未提交的改动
不在这份读数里；③ 这趟只对照了**这一枚**门禁，其余 18 道没做同样处理 ——
要不要逐道做，取决于哪几道在本批里被改过（现量：本批改过的常驻门禁只有这一枚）。

## 8.43 回落那一半第一次按"**谁在读**"枚举：任务屏是第三个该喂便签全集的屏（2026-10-04 12:4x）

### 1. 为什么之前看不见：那本账是按"便签功能在哪几个页面"数的

`apps/mobile/tests/selection-single-owner.spec.ts` 的文件头与用例名都写着"**两个**持有实体全集的屏"。
这次换了问法 —— 不问功能位置，问**谁读这一类的选中**。现量（`grep -n "useSelected(" apps/*/src`）：

| 端 | 读方 | 读的是哪一类 | 那一屏喂给回落的类别 |
|---|---|---|---|
| web | `App.tsx:237` / `NotesView.tsx:98` / `HabitsView.tsx:181` | task / note / habit | ✅ 一次三类全覆盖（`lib/selection.ts:48-56`） |
| mobile | `HabitsScreen.tsx:115` | habit | habit ✅ |
| mobile | `NotesSection.tsx:79` | note | note ✅ |
| mobile | `TasksScreen.tsx:417` | task | task ✅ |
| 🔴 mobile | **`TasksScreen.tsx:435`** | **note** | **它自己那一格没喂** —— 改前 `:555` 那次 `pruneSelectionAgainst` 只有 `task:`。⚠️ "没喂"≠"界面上缺回落"，见第 7 节 |

第三个屏不是新长出来的功能，是**原来那本账数错了对象**：`TasksScreen:1179-1181` 由
`editingNoteId` 决定挂不挂 `NoteEditScreen`，所以任务屏自己就"持有便签实体全集"，
而按"便签页 / 搜索页"数位置永远数不到它。

### 2. ⚠️ 症状：本节第一版那句是**推断出来的，没实测**，12:5x 被第 7 节否证

~~从任务屏的搜索里点开一条便签 → 它在另一台设备上被删 → 同步进来 → `dataRevision` 变 → `refresh()` 跑回落。
回落里没有 `note` 这一类 ⇒ 选中不动 ⇒ 编辑层继续挂着，显示 `notes.edit.notFound`。~~
🔴 **这句当时没有任何一条取证支撑**：它是从"任务屏自己的 `pruneSelectionAgainst` 没喂 `note`"
+ "`pruneSelection` 对没给谓词的类别是 `continue`"两条推出来的，而**漏了同一屏上还挂着别人的 effect**。
真实读数与它为什么仍然要改在**第 7 节**。划线留原句是为了让下一个读者认出这个推理形状，不是留一个症状。

读代码确实读出来的两条（这两条不受第 7 节影响）：

- `pruneSelection` 对没给谓词的类别**直接跳过**（`packages/app-host/src/selection.ts:159-161`）
  ⇒ 宿主喂进去的类别集合就是回落的作用域，少喂一类不会报错，只会**安静地不管**。
- `NoteEditScreen` 对读不到的 id 渲染 `notes.edit.notFound`（`:130-134`）
  ⇒ 即使一次回落都没跑，界面也没说谎、也没有路能往已删实体上写。这条决定了这类洞的
  **表现上限是"面板不自己关"**，不是数据损坏 —— 也因此它**不会**在任何报错里现形。

### 3. 修法：宿主侧把事实源补齐，共享层零改动

`TasksScreen` 的 `refresh()` 里多喂一类，动作集与它拿任务/清单同一条纪律（`createNoteActions(host)`）：

```ts
const aliveNotes = noteActions === null ? undefined : noteActions.listNotes();
pruneSelectionAgainst({
  task: aliveTasks.map((task) => task.id),
  ...(aliveNotes === undefined ? {} : { note: aliveNotes.map((note) => note.id) }),
});
```

web 侧**不需要**同款：它一次覆盖三类。⇒ 这个洞只在移动端，根因是移动端的回落**按屏挂**、web 的按 store 挂。

### 4. 判据（先红后绿）与 4 臂

- 先改判据再改产品：把那条从"两个屏"改成"三个屏"，跑一趟 ⇒ **恰好 1 红**（新加那一格），
  修完转绿。这条顺序是 §4 的"判据必须能红"在本单最省力的形态：**产品没改之前它就是红的**。
  ⚠️ 但**"判据红"不等于"产品坏"** —— 本单恰好是反例（第 7 节）：那一红说的是"任务屏自己这一格没登记"，
  界面上当时并没有可见缺陷。两种读数要分开写，混成一句就会把加固记成修 bug。
- 🔴 **反向断言拆成独立一条**。合在一起的代价是现量出来的：R1（摘掉一项）与 R2（换成筛后的一截）
  会红在**同一条用例**上，那等于反向那条从来没人走过 —— 拆开后 R1 只红正向、R2 两条都红。
- 正向形状逐屏**精确**（`task:` 在前 ⇒ 任何"往后找一段"的松匹配都会跨到别处凑一个 `note:`，
  把那一整项删掉照样绿）。第一版我写的就是 `[\s\S]{0,200}?` 那种松匹配，是 R1 把它逼回去的。
- 🔴 补 `stripComments`：这一族此前**裸读原文**，而它含**负向**断言 ——
  下一位作者只要把这条坑写进注释（`// 别写成 note: visible…`），判据就假红。
  main 的门禁 `f37ade5b` 修的是同一件事，本文件落下了。R4 钉它。
- 臂：`research/tools/mutation-rigs/mutate-selection-fallback.mjs`，4 臂**按用例名点名**（不是数红了几条）：
  `CONTROL 14/14` → R1 红"正向"且"反向"必须不红 / R2 两条都红 / R3 红"习惯" / R4 全绿，
  `ARMS=4 AS_EXPECTED=4 FAIL=0 FINAL_SAME=true`、`POST_RESTORE 红=0/14`。
- 读数：`apps/mobile` **38 文件 / 608 passed**（+1 来自这条拆分）、`tsc --noEmit -p tsconfig.json` **0 error**、
  `check:selection-single-source` RC=0、`check:layering`（332 文件 9 规则）RC=0。

### 5. §1 四道闸门

| 闸门 | 这一格的读数 |
|---|---|
| 归属门 | 改动 3 枚 + 本篇：`apps/mobile/src/screens/TasksScreen.tsx`、`apps/mobile/tests/selection-single-owner.spec.ts`、`research/tools/mutation-rigs/mutate-selection-fallback.mjs`（新增）。零 `packages/*`、零样式。🔴 第 7 节那次自我否证的后续提交**只动判据/rig/本篇三枚，零产品源码** —— 加固本身没必要改，要改的是它的**理由叙述** |
| 两道余量为 0 的棘轮 | 没有 CSS/`ht-*` 输入 ⇒ 两道都没读基线数字（`check:l4` 与 `check:row-single-source` 本轮**无输入**） |
| 干净检出复跑 | 判据输入 = 那两枚 mobile 文件（`TasksScreen.tsx`、`selection-single-owner.spec.ts`），在主检出里**逐枚干净**。🔴 但我第一版把这条写成"主检出 `apps/mobile` 零脏"，现量是 **11 枚**：`AuthScreen.tsx`、`ExportScreen.tsx`、`ProfileScreen.tsx`、`VaultSettingsSection.tsx`、`tests/native-reminder-plan.spec.ts`、两枚 `evidence/ios-reminder-*.png` 与 3 枚未跟踪新文件（`lib/device-revocation-guidance.ts`、`lib/vault-session-cleanup.ts`、`tests/device-revocation-behavior.spec.ts`）—— 那是并行的提醒/金库那条线**正在 mobile 里干活**。**"目录干净"与"判据的输入干净"是两句不同的话**，只有后者是这道闸门要回答的 |
| `packages` 改完先 build | 不适用（零 `packages/*` 改动） |

### 6. 边界（别读多）

- 🔴 **本分支的 `docs-link-check` 有两条红，都不是本批引入的，也不是仓库缺陷**：`PROGRESS.md:1362` 指向
  `docs/research/aed-implementation-evidence.md`（那枚文件在本分支基线上还不存在），以及
  `countdown-anniversary.md:1280` 引用 ADR 目录 README 里**一个并不存在的章节号**。
  两条都在**别人那条线的文件**里。归因做了对照而不是推断：临时分离工作树 `/tmp/dp_main_wc`（`main` @ `d43ec875`）
  跑同一脚本 ⇒ **RC=0、"无死链、无失效章节引用"** ⇒ 这两条红是**本分支基线滞后**的产物，合流后自动消失。
  本批不去改别人的文件，也不把它记成"仓库坏了"。
  ⚠️ **而这一条是本批自己造的**：第一版我在描述第二条红的时候把那条坏引用的形状**原样抄了一遍**
  （目标文件 + 章节号），检查器把转述当成**本篇发出的一条引用**报了红 —— 于是"本篇零命中"这句当场变假。
  教训：**转述一条坏引用等于再发一条坏引用**；描述它为什么坏就够了，别复制它的语法形状。
- 🔴 **真机那一格未验**。设备侧确实有"编辑屏关没关"的断言机制（`scripts/verify-mobile-notes.sh:182`
  那句 `bad "点了「X」但编辑屏没关"`），也有"从搜索结果点进编辑屏"那一步（`:514`），
  但**没有**"进编辑屏之后它在另一台被删"这一格 ⇒ 补它要设备窗口，列入四端重装之后的候选，
  **不许把本节读成"设备上验过"**。
- 这条不对称的**根因**（移动端回落按屏挂 / web 按 store 挂）本单**没统一**。
  统一成"移动端也订阅 `dataRevision` 跑一次全类回落"要动 `lib/selection.ts` 的宿主契约，
  而"触屏端的选中到底是什么"是拍板 #1 的题面。
- ⚠️ **探针错（§8.42 第 11 节第 1 条的第二种面目）**：本节那两道门禁我先在 `apps/` 目录下跑 ⇒
  两条 `RC=1`，末行是 Node 的崩溃尾巴。**"文件名拼错"与"跑错目录"在输出上长得一模一样**，
  都只表现为"门禁红了"。判据不变：跑门禁必须看见它打印自己那句结论，只读退出码就是把
  "我命令写错了"记成"产品坏了"。

### 7. 🔴 12:5x 自我否证：那一格**当天并不是空的** —— 浮层无条件挂载，它的 effect 关着也在跑

第 2 节第一版那句症状（划线处）是**推断**出来的，不是实测。把两处源码读完后它站不住了：

| 事实 | 取证 |
|---|---|
| 任务页**无条件**挂 `SearchScreen`（外面没有条件表达式，同一段里 `NoteEditScreen` 那一支 `:1179` 才是有条件的 —— 对比在同一个函数体内） | `apps/mobile/src/screens/TasksScreen.tsx:1156` |
| `visible` 只往下递给那颗 `Modal`，不参与任何数据/effect 逻辑 | `apps/mobile/src/screens/SearchScreen.tsx:150` |
| 它的回落在一个 effect 里，依赖是 `[noteActions, dataRevision]`，实参来自 `noteActions.listNotes()`（**全集**） | `SearchScreen.tsx:117-124` |

⇒ 改前的真实链路是：任务页 → 搜索 → 点开便签 → 另一台删掉 → 同步进来 → `dataRevision` 变 →
**`SearchScreen` 那个 effect 照样跑**（它一直挂在树上）→ note 回落照常执行 → 编辑层自己关。
第 2 节描述的"面板挂着不关"不会发生。

**这一行为什么还是留**（不是"顺手改了"，是移除一条隐式依赖）：任务屏的 `NoteEditScreen` 当时把
自己的正确性**寄在另一个组件的挂载策略上**。这条依赖能不能安静地断掉，我没有停在推理上，跑了一次
反事实（一次性探针 `/tmp/dp_n1_counterfactual.mjs`，仓库根运行；跑完把两枚文件按 md5 复原）：

| 状态 | 内容 | spec | 门禁 | `tsc --noEmit` |
|---|---|---|---|---|
| A | `806fce49~1` 的 `TasksScreen` + 当时的判据 | **13/13 绿**（分母现量） | RC=0 | — |
| B | A + 一次自然重构：把那颗 `<SearchScreen …/>` 改成 `{searchOpen ? ( … ) : null}` | **13/13 绿** | RC=0 | **RC=0** |
| C | 当前树（加固之后） | 14/14 绿 | RC=0 | — |

`RESTORED=true`，前后 md5 逐字相同（`1d6e22378b…` / `274e4bf779…`），`VERDICT=SILENT_NO_LAYER_GOES_RED`。

读法：B 那一趟里 **note 回落已经没有任何宿主在任务页上喂**（浮层一关就没人跑那个 effect），
而**判据、门禁、类型检查三层全绿** —— 症状要等用户碰上才有机会现形，而它一现形就是"删掉的便签还在编辑层里挂着"。
把浮层改成条件挂载是极常见的重构（目的通常是"别在背后一直开着一趟库读取"），所以这条依赖不是假想的脆弱。
加固之后 R1 臂要求任务屏**自己**必须喂 `note`，这条依赖结构上回不来 —— 因此**不需要**、也不该再写一条
"不许条件挂载 `SearchScreen`"的判据：那等于把责任再交回挂载策略。

⚠️ **边界**：探针证的是"**没有一层会红**"（三层读数），不是"运行时面板不关"。后半句是读源码得到的机制，
没有真机/真浏览器执行过那条序列 —— 第 6 节那一格因此也从"复现一个正在坏的行为"**改性质**为
"回归检查：加固后仍要确认设备上面板会自己关"。

可迁移的教训（本单真正的产出）：

1. **"按谁在读这一类枚举"是对的** —— 它确实找出了第三个持有便签全集的屏。**错的是紧接着那句症状**。
   枚举产出的是"**谁该负责**"，不产出"现在坏在哪"；后者要么实测，要么标成推断。
2. 🔴 **"判据能红"与"产品坏了"是两个独立读数**，本单是反例（判据改前就红，产品却没坏）。
   §4 那道"判据必须配变异臂"只管前者，管不了后者 —— 所以加固类改动写理由时**不许沿用"修了个 bug"的叙述**，
   要写成"移除了哪条隐式依赖"，否则下一个读者会拿它去解释一个并没有发生过的现象。
3. 提交信息不重写：`806fce49` 的正文里就是那句被否证的症状（"编辑层不自己关 … 是行为不一致，不是数据缺陷"）。
   共享检出里不改历史，更正只写在本节 —— 读到那条提交的人应以本节为准。

---

## 8.44 合流窗口判据落成一条可跑的命令：`scripts/verify-detail-pane-merge-window.mjs`（2026-10-04 13:0x，零产品源码改动）

### 1. 为什么要有这一份

§8.40 把那条判据**问对了**（"活树交叠"而不是"冲突文件少"），但它是一段带六条手工命令的账 ——
两小时之内每一项都漂了：

| 量 | §8.40（11:1x） | 本节（13:0x 现量；第 5 节是 13:1x 的下一趟） |
|---|---|---|
| 落后 main | 485 | **509** |
| 领先 main | 53 | **63**（13:1x 那趟已经更多 —— 本篇的落账提交也算在内） |
| 活树交叠 | 5 枚 | **7 枚**（两趟都是 7） |
| 提交级冲突（`merge-tree --name-only`） | 10 枚 | **15 枚**（两趟都是 15） |

而 §8.42 第 15 节又给这条判据加了**第四个问题**（合并产物必须**可解析** —— 文本层可以全干净）。
一个每次都要重跑、每次读数都会变、还要四条命令串起来才成立的东西，留在散文里就会一直靠人回忆。
⇒ 落成一条命令；`--base` / `--head` 是旋钮，默认 `main` 与 `HEAD`。

### 2. 它回答什么、明确不回答什么

| 回答 | 判据 |
|---|---|
| Q1 | 主检出的未提交改动里有没有落在**本批触及的 96 枚文件**上（有 ⇒ 现在合会吞别人的活） |
| Q2 | 与 main 合并有几枚冲突，并按类分组（二进制 / 文档台账 / 代码） |
| Q3 🔴 | **候选树里每一枚本批文件能不能解析**：`.ts/.tsx` 走 TS（语法诊断整片收 + 语义只收 2300/2451 重复标识符）、`.mjs/.js` 走 `node --check`（V8 把重复声明当 early error）、`.css` 数**剥过注释的**花括号；外加全类型 marker 扫描 |

🔴 **不回答"要人拍板的有几枚"** —— 那是判断，不是测量。脚本只把 15 枚分成三类摆出来。
全程只读：`merge-tree --write-tree` 拿候选树 + `git show <tree>:<path>` 取内容，**不建工作树、不动任何检出**。
退出码三种，**故意分开**：`0` = 三条全绿；`1` = 被挡住（`REASONS=` 逐条列）；`2` = **探针自己坏了**
（解析器取不到、候选树里一枚都读不出来 = 分母为空、自检臂没过）。"分母为空当绿"是 §4 明令禁止的形状。

`REASONS=` 四个标记各管一件事，**不许并成一个"窗口未开"**：

| 标记 | 含义 | 处置 |
|---|---|---|
| `OWNED(n)` | Q1：**别人有未提交改动**落在本批文件上 | 等对方提交，或在干净检出里合 —— 🔴 **这不是"要人裁决"** |
| `NEED_HUMAN(n)` | Q2：合并有 n 枚冲突 | 逐处判断（分类见输出） |
| `MARKER(n)` | Q3：候选树里 n 枚带 marker | 同上，且合并产物一定不可用 |
| `BROKEN(n)` | Q3：**零 marker、两侧都不坏**而解析不过 | 🔴 绝不能合，文本层读数完全看不出来（§8.42 第 15 节） |

🔴 **`OWNED` 与 `NEED_HUMAN` 分成两条，是为了不违反 §8.40 已经纠正过的那件事**：
交叠枚数衡量的是"文件名撞上没有"，冲突衡量的是"有几处要判断"，把两者数成一个数就是那节否证的错误。
第一版我把 Q1 直接做成"窗口未开"的理由之一并笼统报 `NEEDS_HUMAN_OR_DIRTY` —— 那句话本身就把两件事又粘回去了。

### 3. 🔴 首跑照出的是**我这两个探针 bug**，不是仓库坏了

写脚本时我坚信自己已经知道该数什么 —— 首跑两件事都不是那样：

1. **zsh 把 `$ref:apps/…` 吃掉了**。我用 `git show $ref:apps/web/…` 分辨"两侧各是谁坏的"，zsh 将
   `:a` 当成历史修饰符展开成绝对路径，于是命令报 `ambiguous argument '…HEADpps/web/…'`，
   `$(… | wc -c)` 给出 **`open=0 close=0` 的空读数**。这个形状（文件明明存在，量出来全 0）比红更危险 ——
   它读起来像"这一枚现在平衡了，合并把它修好了"。⇒ 一律写成 `"${ref}:apps/…"`（记忆里这条已在，仍然踩）。
2. **CSS 裸数花括号会把合法文件判坏**。首跑报了 `narrow.css` 不平衡（27 vs 28），而那一枚多出来的 `}`
   来自**我自己写的块注释**（"…源序后者胜 */"）。`git show` 三侧现量：HEAD 与 main 与候选树**同为 27/28** ⇒
   既不是合并造成的，也不是产品缺陷，是探针的解析层坏了。剥掉 `/* … */` 后 27/27。
   ⇒ 修解析层（剥注释），并且**每条 `PARSE_BAD` 立刻回查两侧**打印归属：
   `两侧都不坏 ⇒ 合并本身造出来的` / `本来就坏 ⇒ 不由本批吸收` —— 分辨这两件事的成本从"手工再查一轮"
   降到脚本自己那一行。

📌 这是 §7 元规则第 1 条（先怀疑探针）的又一次实锤，且这次是**同一个探针连坏两次**：第一次坏在语法（shell 层），
第二次坏在解析（CSS 层）。**"能报红"的探针不等于"报得对"的探针。**

### 4. 自检臂（这条判据自己必须能红）

每次运行**先跑**六条，任一不符期望立即 `exit 2` 并印 `CONTROL_FAIL`：
`C1 TS 重复声明 → 红：TS2451`、`C2 mjs 重复声明 → 红：node --check`、`C3 CSS 括号失衡 → 红`、
`C5 TS 半截表达式 → 红：TS1109`、`C6 marker 文本 → 红：TS1185`、`C4 干净样本 → 绿`。
C1/C2 钉的正是 §8.42 第 15 节那次的形状（`SyntaxError: Identifier 'objectSpreadUseOf' has already been declared`）。
🔴 这一族第一次跑就**用得上**：C1 当时是绿的（我把虚拟文件名写成不带扩展名的 `mem`，TS 不把 `export` 当模块处理，
诊断全空），脚本因此 `exit 2` 而没把"绿"交出去 —— 也就是说**自检臂真的挡住了一次假探针**。

### 5. 13:1x 那一趟的实际读数

```
CONTROL_OK ×6
Q1 载体=<主检出> 主检出未提交=129 枚；本批触及=97 枚；交叠=7 枚
Q2 候选树=65b81eea… 冲突=15 枚：二进制 10 / 文档台账 2 / 代码 3
Q3 候选树读到=97 枚 / 读不到=0；marker=5 枚；PARSE_BAD=2（只由 marker 解释=2 / 合并新造成且无 marker=0 / 本来就坏=0）
CONFLICTED=15 OVERLAP=7 MARKERS=5 PARSE_BAD=2 PARSED=97
REASONS=OWNED(7) NEED_HUMAN(15) MARKER(5)
VERDICT=BLOCKED（RC=1）
```

⚠️ **这条命令的读数每趟都在动，而结论没动**：同一族三趟分别打出
`未提交=127 / 130 / 129`，候选树 oid 从 `cafb1763…` 变成 `65b81eea…`（本篇自己的落账提交抬了 HEAD），
`交叠` 与 `冲突` 三趟都是 7 / 15。⇒ 引用这条命令的结论时**必须带趟次与读数原文**，
而"能不能合"这件事要看的恰恰是后两个不漂的数 —— 这正是把判据落成命令的理由。

交叠的 7 枚逐枚列出（这是"现在不能合"的具体对象，不再是抽象数字）：
`apps/web/evidence/detail-column-slot/no-sidebar-view.png`、`apps/web/evidence/selection-projections/03-timeline.png`、
`docs/README.md`、`docs/reference/environment-traps.md`、`packages/app-host/src/index.ts`、
`packages/i18n/src/locales/en.ts`、`packages/i18n/src/locales/zh-CN.ts`。
⚠️ **后五枚是并行那条线正在写的源码/台账**，前两枚 PNG 是"别人此刻在重新出图" ——
§8.40 的 5 枚里那两枚 i18n 词条仍然在列，**两小时没动过**，动的是 main 的提交与两张图。

🔴 本轮**真实产物**里没有出现"文本干净但解析不过"的合并（唯一两枚 `PARSE_BAD` 都由 marker 解释）。
但这不是"没验证过的假设"：那个形状在第 7 节被 `git merge-file` **合成复现出来了**（零冲突、零 marker、`node --check` 红）。
两件事要分开说 —— "这趟没命中" 与 "这一档抓不到东西" 完全不同。

### 6. 边界（别读多）

- Q1 只查**主检出**的未提交改动，不查其他 linked worktree（`/tmp/heyta-*`、`.codex/worktrees/*` 等）里并行会话的工作树。
  那一层按既有裁决由"载体固定 + 哈希对账"管，不由这条命令管。
- Q3 的解析层是**文件级**的：跨文件的坏合并（比如两侧各删了一半的 export）看不出来，那归 `pnpm -r typecheck` 与门禁。
  `noLib` 单文件程序故意不收 2304/2552 那类"找不到名字"，否则每枚真文件都会红。
- 15 枚冲突里的 10 枚二进制按处置就是"重新出图"（生成命令在各节里），不是要人裁决的东西；
  文档台账那 2 枚是并行那条线的台账追加（§8.40 已定：不代改）。
- 这条命令**不挂进 `pnpm check`**：它判的是"现在能不能合"，不是"仓库对不对"。
  每次合流前手工跑一次并**带上它打印的读数**（数字会漂，引用要带那一趟）。

### 7. 🔴 `BROKEN` 那一档不是"以防万一"——它被合成复现出来了

本批真实事故（§8.42 第 15 节）的形状是：把 main 的一个函数**抄进**我的门禁脚本，文本层 rc=0、零 marker，
而产物 `SyntaxError: Identifier 'objectSpreadUseOf' has already been declared`。写完 Q3 后我没有停在"我记得发生过"，
用一次性探针把这个形状**重新造了一遍**（`/tmp/dp_merge_shape.mjs`）：

```
base / ours / theirs 三方，ours 在文件靠前处加 `const objectSpreadUseOf = (x) => x;`，
theirs 在文件靠后处加**同一条声明**（两处相隔足够远，git 认为不是同一块）
→ MERGE_RC=0  MARKER=false  两处同名声明都在=2  其中顶层（行首无缩进）=2
→ node --check RC=1：merged.mjs:12  const objectSpreadUseOf = (x) => x;
→ VERDICT=SHAPE_REACHABLE_PRODUCE_BY_CLEAN_MERGE
```

⇒ **`git merge-file` 在零冲突、零 marker 的情况下就能产出解析不过的文件。** Q3 因此不是装饰性的一档。

⚠️ 第一版这个合成**报的是"未复现"**（`SHAPE_NOT_REPRODUCED`），原因在样本不在判据：我把 theirs 的那一行
插在 `function beta()` 的**闭括号之前**，于是第二条声明落进函数体内 —— 两条同名声明在**不同作用域**，
`node --check` 当然绿。**"合成没造出形状"要先怀疑合成**，这与第 3 节那两个 bug 是同一族，只是这次症状是"假阴性"。
加了一条断言（顶层、行首无缩进的声明数必须 = 2）之后形状才真的成立。

### 8. 本轮自己写坏的第三件（也是最后一件）

删死代码删不干净：把 `notes` 数组删了，漏掉一行 `notes.push(...)` ⇒ 运行到那一行才
`ReferenceError: notes is not defined`。**`node --check` 完全抓不到它**（那是引用解析，不是语法）。
读数是 RC=1 但**停在 Q2 之后**、没有 `REASONS=` 行 —— 也就是说如果我只看退出码，会把"我的脚本崩了"
读成"窗口被挡住了"。⇒ 这条脚本的判据从来看的不是退出码而是**它有没有打印出 `REASONS=` 那一行**；
第 6 节"引用读数要带那一趟"也因此多一条含义：**没有结论行的读数不是读数**。

---

## 8.45 这一轮四笔提交的收口读数，以及**为什么全链电池这一轮没跑**（2026-10-04 13:1x）

四笔：`54f32b65`（§8.43 第 7 节自我否证）· `dfd019a8`（§8.44 判据落成命令）·
`9ae46b30`（§8.44 OWNED/NEED_HUMAN 拆开 + BROKEN 合成复现）· `cb5d7dbc`（调研文档 C1 表逐项对账）。
全部**零产品源码**（改的是判据、rig、脚本、文档），所以 §1 四道闸门里"`packages` 改完先 build"一格不适用。

| 判据/门禁 | 读数 |
|---|---|
| `apps/mobile` 那条判据 | **14 passed / 0 failed**（单文件） |
| `apps/mobile` 全量 | **38 文件 / 608 passed**，`tsc --noEmit` **0 error** |
| `mutate-selection-fallback.mjs` | `ARMS=4 AS_EXPECTED=4 FAIL=0 FINAL_SAME=true`、`POST_RESTORE 红=0/14` |
| `check:selection-single-source` | RC=0，结论行现打："2 份实例…词表 3 类全有消费者（task 10 / habit 7 / note 13），接线声明 17 处全部用起来" |
| `check:layering` | RC=0，"扫描 332 个文件，9 条规则" |
| 文档三项 | 工单表格自检 **398 行零错位**（加进本节之前那一趟是 388 —— 差 10 行就是本节这张表自己）· 调研文档 136 行零错位 · `docs-link-check` 本篇命中 **0**（另两条红在别人文件，归因见 §8.43 第 6 节）· `check-docs-voice` RC=0 |
| 反事实探针（§8.43 第 7 节） | `A 13/13 绿 · B 13/13 绿 + 门禁 RC=0 + tsc RC=0 · C 14/14 绿`，`RESTORED=true`（两枚 md5 逐字相同），`VERDICT=SILENT_NO_LAYER_GOES_RED` |
| 合成形状探针（§8.44 第 7 节） | `MERGE_RC=0 MARKER=false 顶层同名声明=2` → `node --check RC=1` → `SHAPE_REACHABLE_PRODUCE_BY_CLEAN_MERGE` |
| `verify-detail-pane-merge-window.mjs` | `REASONS=OWNED(7) NEED_HUMAN(15) MARKER(5)`，RC=1 |

### 🔴 全链电池（`/tmp/dp_w1b_battery.py`，25 步：门禁 + token 生成 + 六包 typecheck + 六包测试 + web 生产构建 + e2e 整族）这一轮**没跑**

原因不是"忘了"也不是"没必要"，是**现量到的共享资源占用**（AGENTS §8.9 的独占验收）：

```
ps Axo command | grep -F verify-mobile  →  bash …/heyta-wt-batch2/scripts/.verify-mobile-card-export.sh.snap.79671
xcrun simctl list devices booted | grep -c Booted  →  5
adb devices  →  emulator-5554 device
sysctl -n vm.loadavg  →  { 14.34 39.65 66.57 }   （16 核，1 分钟已经越过仓库那道 12 的负载门）
```

⇒ 此刻起"六包全量测试 + `vite build` + Playwright 整族"会把负载再顶上去，而**另一条线正在这台机器上跑设备验收**，
它的判据自带负载门 —— 我把机器压过阈值的后果是**它那趟变成"环境无效"**（不是产品失败，但没人会这么读）。
按 §8.9 与既有裁决：不在别人的设备验收窗口里起自己的重活。

**下一趟的命令与前置**（谁接手都照这个跑，别凭记忆）：

```bash
# 前置两条：verify-mobile 不在跑，且 vm.loadavg 的 1 分钟值 < 12
ps Axo command | grep -F verify-mobile | grep -v grep; sysctl -n vm.loadavg
node /tmp/dp_w1b_battery.py      # 载体必须是当前 HEAD；电池内部按包取 ./node_modules/.bin，不用 pnpm
```

⚠️ 这条"没跑"必须在**这一轮**就写明。**最近一趟全链电池不是在本轮这四个载体上跑的**：
它是 §8.42 第 14 节那趟（12:2x，载体 `f2379dec`，25 步 RC=0 / `BATTERY_RESULT=ALL_GREEN`），
比本轮四笔（`54f32b65`…`cb5d7dbc`）早。本轮四笔里没有一枚动产品源码，所以缺这一格**不改变任何一单的界面结论**，
但它改变"当前载体全链绿"这句话能不能说 —— **不能说**。§8 状态表里 W1–W7 那几行仍然只到"只剩四端重装"，
不许因为本轮又补了判据/文档而往上加"全链已复绿"。

---

## 8.46 断言 H：把"谁读某一类的选中，谁就得把那一类喂进回落"从**人工数屏幕**变成一条门禁（2026-10-04 13:3x）

### 1. 为什么 §8.43 那种"数"不够

§8.43 的产出是一次正确的枚举 —— 按"谁在读这一类"数出任务屏是第三个持有便签全集的宿主。
但**枚举是一次性的**：判据（`apps/mobile/tests/selection-single-owner.spec.ts`）里那张
`cases` 表是手写的三行，下一位新加一个读 `useSelected('habit')` 的屏，
他不在表里的这一格**不会有任何东西变红** —— 症状要等用户碰上才现形。
⇒ 落成 `check:selection-single-source` 的**断言 H**，逐文件扫，不需要人再数一次。

### 2. 🔴 两端必须是两套规则，理由是那两端的回落**挂载方式**不同（现量，不是偏好）

| 端 | 回落怎么跑 | H 的规则 |
|---|---|---|
| `apps/mobile` | 每个屏各自调 `pruneSelectionAgainst({ … })` | **同文件配对**：这一屏读了哪几类，本文件的实参块里就必须有哪几类 |
| `apps/web` | 一份中央回落挂在物化状态上（`lib/selection.ts` 的 `pruneSelectionFromEntities`） | 中央那份**覆盖本宿主读到的每一类**，且**真的被别处调用过** |

写成一条会两种坏法：按"同文件配对"管 web ⇒ 三个视图整片假红（它们本来就不喂）；
按"整棵树里找得到喂就算"管 mobile ⇒ 就是 §8.43 第 7 节那个错误本身
（"别的文件也在喂"不等于"这一屏有人负责"）。

实参块用**大括号配对**取，不用"往后找 N 个字符" —— 同一个调用里 `task:` 在前、`note:` 在 Spread 里，
松匹配会跨到别处凑出一个键来（§8.43 第 4 节那条教训在门禁层的重述）。

现量读数：`✅ H：6 处读选中的宿主文件各自把读到的类别喂进回落…逐类读方数：task 2 / habit 2 / note 3`
（web `App.tsx`/`HabitsView`/`NotesView` 各一读 + mobile `HabitsScreen`/`NotesSection`/`TasksScreen`（读两类）= 6 处）。

### 3. 七臂（`research/tools/mutation-rigs/mutate-selection-h.mjs`）

`ARMS=7 AS_EXPECTED=7 FAIL=0 FINAL_SAME=true CONTROL rc=0`：

| 臂 | 改法 | 预期 | 实测 |
|---|---|---|---|
| H1 | 触屏端新加一处读 `note` 而不接回落 | 红，点名 `CalendarScreen.tsx` 与 `'note'` | ✅ `rc=1 firing=[H]` |
| H2 | 任务屏摘掉实参里的 `note` 那一项（仍读 `note`） | 红，点名 `TasksScreen.tsx` | ✅ |
| H3 | Web 中央回落少一类（摘掉 `habit` 谓词） | 红，点名 `apps/web/src/lib/selection.ts` | ✅ |
| H4 | Web 中央回落存在但没人调用 | 红：`没有任何文件调用` | ✅ |
| H5 | 阴性：同样的字样只写进注释 | **必须绿** | ✅ `rc=0` |
| H6 | 分母自检：把扫描正则改坏到恒不匹配 | 红：`没扫到任何` | ✅ |
| H7 | 阴性：同文件两处 `prune` 调用、`note` 只在其中一处 | **必须绿**（要聚合，不能只看第一处） | ✅ `rc=0` |

💥 **H6 第一版是坏的，而臂的严格性把它抓了出来**：我原本把 `useSelected\(` 换成 `useSelectedZZZ(`
（连转义反斜杠一起摘掉）⇒ 正则变成 `…['"]task['"]\)` —— **未闭合分组**，
`new RegExp` 在扫描之前就抛，门禁**崩**了：`rc=1` 但 `firing=[]`，报错里没有 `断言 H`。
如果判定只写"期望 rc≠0"，这一臂会当成通过 —— 也就是说**它会用一次崩溃冒充一次红**。
判定改成"必须出现 `断言 H` 且报错文案点名到文件与类别"之后它才如实报 `BAD`。
这条形状适用于本仓所有"改脚本让它坏"的臂：**退出码不是判据，判据是它打印了自己那句结论**
（§8.43 第 6 节那条"跑门禁必须看见它打印自己那句结论"的同族）。

### 4. 顺带修掉产品源码里同一句被否证的注释

`apps/mobile/src/screens/TasksScreen.tsx:563-567` 那段还写着
"少递一项的确切症状：…编辑层不会自己关…那两条已经接了回落的屏此刻**没挂载**，替不了它" ——
这正是 §8.43 第 7 节否证掉的那句，它漏在了**产品注释**里。
按"撤回要写进原文所在处"的规则改写成移除隐式依赖的说法，并就地指到 §8.43 第 7 节的 A/B/C 读数。
全仓 sweep：`apps/**` 与 `packages/**` 里再没有"没挂载 / 替不了它 / 不会自己关"这三串
（剩下的命中只有更正句本身）。**零代码行为改动**，只是那段注释在替一个不存在的症状说话。

### 5. §1 四道闸门 + 边界

| 闸门 | 读数 |
|---|---|
| 归属门 | 4 枚：门禁脚本、新臂装置、`TasksScreen.tsx`（**只有注释**）、本篇。零 `packages/*`、零样式、零线协议 |
| 两道余量为 0 的棘轮 | 无输入（没有 CSS / `ht-*` 改动），本轮**没读**基线数字 |
| 干净检出复跑 | 判据输入是 `scripts/` 与两份 `apps/*` 文件；§8.44 那趟 Q1 的交叠 7 枚里**不含**这几枚 ⇒ 它们在 main 检出干净 |
| `packages` 改完先 build | 不适用 |

**读数**：`check:selection-single-source` RC=0（F/G/H/总结四行全打印）；
`apps/mobile` **38 文件 / 608 passed**；H 装置 `AS_EXPECTED=7/7`、`FINAL_SAME=true`、`CONTROL rc=0`。

⚠️ **`apps/web` 那一趟报 1 红，归因为环境而不是产品**：`tests/reminders-panel.spec.tsx`
的"超过每任务上限时把错误显示出来"（2527ms）——**不是本单的文件**（提醒那条线）。
单跑那一枚 **6/6 绿**；而单跑那一趟现量 `vm.loadavg` = **{427.84, 177.16, 99.65}**（16 核）。
⇒ 记为负载抖动，且**没有**在安静窗口里做全量复跑 —— 这句话只能说"单发已复绿"，
不能说"web 全量在本载体复绿"。全链电池同理（§8.45 那条前置在 13:3x 更紧了：另一条线正在跑
`.verify-mobile-card-export-ios.sh.snap.84803`，模拟器 5 台 booted，负载 427）。

### 6. H 与 `apps/mobile/tests/selection-single-owner.spec.ts` 不是重复（别删任何一个）

两条管的是**不同维度**，删掉任一条都会留下另一条挡不住的洞：

| | 管什么 | 挡住的坏法 | 挡不住的坏法 |
|---|---|---|---|
| H（门禁） | **存在性**：读某一类的文件有没有把那一类喂进回落 | 新加一个读 `note` 的屏而根本不接回落 | 接了、但喂的是筛完的那一截 |
| 那条 spec | **形状**：逐屏精确到 `aliveNotes.map(…)` 这一串，外加反向"不许来自筛完/排过序的那一截" | 喂的是筛后的一截；谓词来源换成 `groups`/`visible` | 全新的第六个屏读了某一类而没人往 `cases` 里加 |

⇒ 关系是 **H 兜住"忘了接"，spec 兜住"接错了"**；而 spec 那张手写表**正因为有 H 才不会因为漏一行而无声**。
🔴 H 独立性是**按输入范围读出来的**，不是跑出来的：H 的读方扫描走 `walk(<宿主>/src)`
（`scripts/check-selection-single-source.mjs:275-285`，只收 `.ts/.tsx`），
而这条 spec 住在 `apps/mobile/tests/` —— 不在 `src` 下，**根本不是门禁的输入**。
所以"删掉 spec 后 H 照样红"这句不需要运行就有依据，也不必拿它当一次变异读数。

## 8.47 合并执行顺序（给**有授权**的那一轮）：把现场一次采齐，让接手的人不必重新取证（2026-10-04 13:3x）

### 0. 这一节是什么，以及它明确不是什么

是 runbook：**顺序 + 每一步"过 / 不过"的退出码来源**。
🔴 **不是合并授权** —— 用户指令是"不 push 不 merge 除非明确要求"，§6 六条明文不做里就有这条。
本批到目前为止对合并的所有动作都是**读取**（`merge-tree --write-tree` 写的是 object 库里的候选树，
不碰任何工作树、不产生提交）。

⚠️ 下面第 1 节每一枚数字都是**瞬时读数**（取号趟 13:38）。接手时**先重跑那两条命令**，
不要把这一节的数字当成"当前状态"来引用 —— 这正是 §8.40 立下的规则（台账数字不手抄），
而它对我自己这一节同样生效。

### 1. 现场（2026-10-04 13:38 那一趟的现量）

| 项 | 值 | 现量命令 |
|---|---|---|
| 载体 | `feat/detail-pane` @ `ba2051c3`，worktree `.worktrees/detail-pane` | `git rev-parse --short HEAD` |
| main | `e8645f51`；merge-base `f419df75` | `git rev-parse --short main` / `git merge-base HEAD main` |
| 落后 / 领先 | 落后 **519**、领先 **71**（13:1x 记的是 516/68 —— 三小时里 main 又走了 3 笔） | `git rev-list --count HEAD..main` / `main..HEAD` |
| 候选树 | `b1f7e5d8`（`MT_RC=1`） | `git merge-tree --write-tree --name-only main HEAD` |
| 冲突 | **15 枚** = 二进制 10 + 文档台账 2 + 代码 3 | 同上一条命令的输出 |
| Q1 交叠 | **7 枚**（本批触及 98、主检出未提交 139） | `node scripts/verify-detail-pane-merge-window.mjs` |
| Q3 | marker 5 枚 / 解析不过 2 枚，且**全部由 marker 解释**（合并新造成且无 marker = **0**，本来就坏 = **0**）；PARSED 98 | 同上一条命令 |
| 负载 / 设备 | `vm.loadavg` 1 分钟 **20.58**（16 核，闸门阈值 12）；`ps … \| grep -F verify-mobile` **为空** | `sysctl -n vm.loadavg` |

Q1 那 7 枚交叠：`apps/web/evidence/detail-column-slot/no-sidebar-view.png`、
`apps/web/evidence/selection-projections/03-timeline.png`、`docs/README.md`、
`docs/reference/environment-traps.md`、`packages/app-host/src/index.ts`、
`packages/i18n/src/locales/en.ts`、`packages/i18n/src/locales/zh-CN.ts`。

### 1b. 同一张表的 14:5x 复量（上面那栏不许被它替掉 —— 两栏都是某一趟的现量，合流当时要第三趟重取）

| 项 | 14:5x 值 | 与 13:38 那次相比 |
|---|---|---|
| main / HEAD / merge-base | `0a0b63f6`→`d636b010`（同半小时里走了两次）/ `4d0cbd89` / `f419df75` | merge-base **没动** ⇒ 落后全是 main 那侧 |
| 落后 / 领先 | 532 → **536**、领先 78 → **79** | 两小时涨 17 笔 |
| 冲突 | **17 枚** = 二进制 10 + 文档 3 + 代码 4 | 多出的两枚：`apps/web/src/App.tsx`（要人，§3f）与 `docs/plans/detail-pane-alignment.md`（机械，§3g） |
| 纯 fs 门禁（§8.52 那枚脚本） | 17 道：**合并造成的红 = 1** → 跑完 §8.53 那三条机械处置后 **= 0**；两边都红 0 | 第一次有可复跑的"改完再验"回路 |
| 静默合流 | 10 → **11 枚**（本批新加的预检脚本自己也进了两侧交集） | 逐枚"两侧新增行都在 + 语法过" |
| 要人裁决 | **2 枚**（页头压窄 + 同一格里 AI 面 vs 专注概览） | 13:38 那趟记成 1 枚，是那一刻的面 |

### 2. 步骤 0 —— 门：`OVERLAP=0`，两条不阻塞的走法

`node scripts/verify-detail-pane-merge-window.mjs` 判 `OVERLAP=0`。
不为 0 时有两条**都不需要人签字**的路：

1. **等对方提交**（这 7 枚的所有者各自动手），然后重跑那条命令；
2. **在独立干净检出里合**：`git worktree add ../dp-merge -b merge/detail-pane main`
   再把 `feat/detail-pane` 合进去 —— 主检出的未提交改动根本不参与判定。
   🔴 但合完的产物**不能冒充主检出已验**（AGENTS §8.9：共享检出仍有其他写入者时，
   隔离副本通过不能替代主检出的后续改动）。

🔴 **`OWNED` 不等于"要人"** —— 这 7 枚里没有一枚需要拍板：2 枚 PNG 在 §3e 整片重出，
2 枚文档台账是并行那条线的追加，3 枚（`app-host/src/index.ts` + 两份 i18n 词条）等对方提交就自己消失。
把这个混数犯过一次的地方是 §8.44，它的代价是把"等一等"包装成了"找人"。

### 3. 冲突的逐枚处置（§3a–§3g）

> ⚠️ 枚数是**瞬时读数**：这一节写的时候 15 枚，14:5x 复量涨到 **17 枚**（多出 `apps/web/src/App.tsx`
> 与本单这份工单文档，各 1 枚 hunk）—— 成因与处置见 §8.53 第 2 节，对应到下面的 §3f / §3g。
> 合流当时先跑 `node scripts/verify-detail-pane-merge-preflight.mjs` 取枚数，别照这一节数文件。

#### 3a. `packages/app-host/src/habit-actions.ts`（代码）：取并集，零语义判断

单个 hunk，住在 import 块里：main 侧加 `byCreatedAtOrder, isLive`，HEAD 侧加 `habitLogValue`。
**三条都留。** ✅ 这一条处置在 14:06 被机械执行过：并集产物 `markers=0 / 语法错=0 / 重复导入名=0`
（main 侧 `byCreatedAtOrder` `isLive`，HEAD 侧 `habitLogValue`，独有项 1 个）。详见 §8.50。
合完的判据：`./node_modules/.bin/tsc -b packages/app-host`（RC=0）+ 第 5 步 app-host 全量测试。

#### 3b. `packages/app-host/tests/habit-actions.spec.ts`（代码）：两块都留，另删一行**不是 marker 的**残留

两侧各自在文件末尾 append 了自己的 describe 块 ⇒ 不选边。
🔴 **但"直接拼接"这条处置在 14:06 被执行过一遍，它不成立**：两侧各自的**括号差都是 +2**
（每块打开 2 层、闭合留在共享尾部），而 marker 之后文件只剩共享的那两条闭合 ——
直接拼 ⇒ `TS1005: '}' expected`。正确处置是**在 ours 块之后补 2 条 `});` 再拼 theirs**（条数 = ours 块的括号差，不是写死的 2）。
补 0 / 1 / 2 / 3 条的实测读数（候选树 `8b3240c0`）：`语法错=1 / 1 / 0 / 2`，
补够那一条之后是 **describe 10 个 / 用例 36 条 / 重名 0 条**。
🔴 这三个数是那一趟的现量，合流当时要**重新现取**（main 一直在走），判据形状是"拼接后没有语法错、且用例数 = 两侧之和 − 共有"。
⚠️ main 那一侧的块顶部留着一行 `── 追加到 packages/app-host/tests/habit-actions.spec.ts ──`
—— 那是搬运时的**叙述残留，不是冲突 marker**（命中数实测 1）。把 marker 删干净之后它仍然在文本里，
要单独删；反过来把它跟 marker 一起当作"冲突残留"处理则会删掉一行本来属于 main 的内容。
（这一行是**别人文件里的**，本批不预改；记在这里是因为只有合流那一刻会同时看到两侧。）

#### 3c. `apps/web/src/styles/app/main-area.css`（代码）：只有 **hunk#1** 真的要人

🔴 14:06 把两个 hunk 按 **声明名→值逐条比过**（不是数属性名），结论比 §8.40 当时写的更窄：

| hunk | 形状 | 逐条差 | 要不要人 |
|---|---|---|---|
| **#1**（`.ht-header`） | 同一选择器两侧各写一版 | 只在 main：`flex-shrink: 0`；同名不同值：`gap`（`--ht-space-3` vs `--ht-space-2 --ht-space-3`）、`padding`（`--ht-space-2 --ht-space-6` vs `0 --ht-space-6`） | **要**。拍的是"页头这一条到底许不许被压窄" |
| **#2**（`.ht-header__actions` + 一整条新规则） | **不是同题两次**：main 侧含 HEAD 侧**全部 5 条声明且取值逐字相同**，另多 `align-items: center` + `max-inline-size: 100%`；main 侧还带一条 HEAD 完全没有的新规则 `.ht-header__lang`（9 条声明，2026-10-03 语言切换控件那批） | HEAD 侧独有项 = **0** | **不要**：取 main 侧即不丢任何一方行为（HEAD 独有的只有那段解释性注释，要留就一起抄）。取 HEAD 侧反而会**把别人一条整规则删掉** |

⇒ §8.40 那句"3 枚要人"现在应读成 **1 枚真要人**（`main-area.css` 的 hunk#1），
另两枚机械可解（3a 的 import 并集与 3b 的"拼接 + 补缺合"都已在同一棵候选树上验过语法过、零重复）。
> 🔴 **14:5x 这一句又被现量改了一次：现在要人的是 2 枚。** 合流面从 15 枚涨到 17 枚，涨出来的
> `apps/web/src/App.tsx` 那一枚是"AI 面与专注概览要同一格"（要人，见 §3f），另一枚（本单这份工单文档）机械可解（§3g）。
> 上一条"只剩一枚"不是错，是**过期** —— 它当时量的是那一刻的合流面。

- **承重、哪一侧都不许丢的两条**：`flex-wrap` 与 `min-block-size` —— 实测**两侧都有**（hunk#1 两侧各 1 条），
  所以这两条不需要人来保；需要人的只有 `flex-shrink` 与那两个取值。
  （HEAD 侧注释写明的理由：详情列 + 可拖宽侧栏把主区压到 624px，而日历页头需要 ~918px；
  原来的 `block-size` 固定高度让控件"在 DOM 里、在视口外"，`calendar-cells.spec.ts` 一条断言红、
  另一条 `locator.click` 超时 90s。）
- 🔴 **不要把两套规则手工叠起来** —— 叠会出现两条 `min-block-size` / 两条 `flex-wrap`，后一条赢，
  那不是"两边都保住"，是掷硬币。择一形态保留，然后用承重判据复验。
- 判据：`pnpm check:design`（裸值）+ `pnpm check:row-single-source`（**28/28，余量为 0 —— 红了不许调基线**）
  + `pnpm check:l4`（mobile 内联样式同样余量为 0）+ §5 表第 6 行的重出截图并**人看图**。

#### 3d. `docs/README.md` + `docs/reference/environment-traps.md`（文档台账）：保留双方

都是追加型。traps 是编号台账：**只增不改号、不要插行**，两侧新增的号段按行 splice 到末尾
（同一节里两边各自起的号如果撞了，以"先落 main 的号不动、后到的重排到末尾续号"处理，
并把改号写在条目自己那一行里，不要只写在别处）。
⚠️ 合流当时两件必做的现量（14:1x 执行验真出来的，见 §8.51）：
✅ **15:4x 起这两件有机器判据了** —— 预检的"编号台账"那一行会直接把 同号不同事的组数、续号起点、
   要 sweep 的引用行数（带分母）报出来，见 §8.57。下面两条命令留作手工复算路径，不再是唯一手段。
① **本批的 traps 条目要续号** —— `#215`/`#216` 已被 main 用掉且**同号不同事**（逐字比对 False），
   按"取号方自己挪"续到"当时 main 最大号 +1/+2"，并 sweep 引用（**sweep 集用下面两条命令现取，不要抄这里的数**）：

   ```bash
   # (a) 当时 main 的最大号 —— 别用裸 tr：先把换行删掉再 sort -n 会把全部号拼成一个大数（我这趟就这么坏了一次）
   git show main:docs/reference/environment-traps.md | grep -oE '^[0-9]+\. ' | tr -d '. ' | sort -n | tail -1
   # (b) 要改的引用全集：本仓所有 .md 里出现 #215/#216 的**行**，加上 traps 本体那两条条目行
   grep -rnE '#21[56]' --include='*.md' . | grep -v node_modules
   grep -nE '^(21[56])\. ' docs/reference/environment-traps.md
   ```

   14:40 那一趟的读数：main 最大号 **228**（条目 **237** 条 ⇒ 号数比重复条目少 9）、traps 本体 2 行
   （`:4551` / `:4565`）、引用 **8 行 / 16 处**且**全部在本篇**（`AGENTS.md`、调研文档、其他计划零命中）。
   ⚠️ 这个"8 行"上一版记的是"7 行 / 14 处"，**半小时内就漂了一次** —— 因为写这句话的那一行自己也是一处引用。
   所以：改号时**按命令 (b) 的输出逐行改**，改完复跑 (b) 要求 `#21[56]` 只剩"新号"，并另跑一次
   `grep -c <旧号串>` 同时验"旧串 0 / 新串 1"（只验新串在场会漏掉"旧串还在"）。
   不在本批先挪：号段六小时涨了 14 个，现在挪到 229/230 到合流时可能又撞。
② **跑一遍"同号不同事"探测器**（`§8.51` 里那段 python，按条目形状收窄，别用裸 `^N. `——
   那会把条目正文里的编号列表算成撞号），main 现量已有 4 组真撞号（38/93/94/95），合并产物要按 8 组核对。

判据：`pnpm check:docs`（死链）+ `pnpm check:docs-voice`。
⚠️ 表格列对齐那道自检是 `/tmp/dp_tablecheck4.mjs` 里的**临时探针，没有入库** ——
§5 那张表不要把它写成前置；要么先用 `git show` 目测，要么把这枚装置补进 `research/tools/`（那是另一单）。

#### 3e. 10 枚 PNG（二进制证据）：**不选边，整片重出**

`apps/web/evidence/{detail-column-slot,detail-pane-overlay,selection-projections}/` 下 10 张，
由三个 spec 生成：`e2e/tests/detail-column-slot.spec.ts`、`e2e/tests/detail-pane-overlay.spec.ts`、
`e2e/tests/selection-projections.spec.ts`。
两侧都是各自那一趟 e2e 的产物 ⇒ 选任何一侧都是**拿旧截图冒充新产物**（§7 第 27 / 82 条同一个形状）。

处置：合并时先随便取一侧让 tree 干净（`--ours`/`--theirs` 都行，反正要被覆盖掉），
**合并完成后重跑这三个 spec 重出全部 10 张，逐张看图**：

```bash
pnpm -r build                      # apps/web/dist 是 preview 的输入，不能省
cd e2e && npx playwright test \
  tests/detail-column-slot.spec.ts tests/detail-pane-overlay.spec.ts tests/selection-projections.spec.ts \
  --config playwright.detail-pane.config.ts
```

🔴 这条 config 的边界就是判据本体，**不要换成默认 config 跑**：端口 **4371 + `--strictPort`**、
`vite preview` 服务 `apps/web/dist`、`DP_SWEEP=1` 才放开 testMatch、**不起 4319 假端点**，
且不得占用 3000 / 4318 / 4319 / 4358（别人的）。
判据：重出的 10 张 md5 与合并前**两侧都不同**（说明真的重出过，不是把某一侧搬回来），
且人打开看图。现量命令（不依赖任何未入库脚本）——
⚠️ 路径必须点到那三个目录，`apps/web/evidence/*/*.png` 现在会展开成 **112 张**（整棵证据树），
比"10 枚冲突"多出一百倍，读数会对不上：

```bash
md5 apps/web/evidence/detail-column-slot/*.png apps/web/evidence/detail-pane-overlay/*.png \
    apps/web/evidence/selection-projections/*.png     # 恰好 10 行，与两侧各自的 10 行三列并排比
```

#### 3f. 🔴 `apps/web/src/App.tsx`（**要人**，14:5x 涨出来的第二枚）：AI 面与专注概览要的是同一格

1 枚 hunk。main 侧把这一栏给了 `aiPanels`（`{detailHasRoom ? aiPanels : null}`），HEAD 侧在本单 W7 里
把同一栏在 `contentView === 'focus'` 时给了 `<FocusDetailPane />`。**两边都要，选任何一侧都是删对方的行为。**

- 它背后是一条**已经落了的产品拍板**（2026-10-04「无选中态的时候默认显示 AI Chatbot」），
  原话在 `apps/web/src/App.tsx:2528` 的注释里，配套实现 `:643`/`:1506`/`:2094-2096`/`:2542`，
  判据 `e2e/tests/ai-row-layout.spec.ts:19-20/78/93/98/103`（含"窄档右栏不出现时 AI 面退回中间列"那一档）。
- main 那份工单 W2 行自己划了边界：**"选中某条出详情面"那一半没被推翻，仍等 #1/#8，且它替换的是同一块位置 ——
  不另开第三处**。本单 W7 的理由仍然独立（`§8.21`：滴答在番茄视图里那一栏是常驻概览+记录，与选中无关）。
  ⇒ **两条裁决不冲突，冲突的是同一块 DOM。**
- 可以**推**出的合并形状（⚠️ 推导不是拍板）：
  `{contentView === 'focus' ? <FocusDetailPane /> : detailHasRoom ? aiPanels : null}`，
  且"窄档退回中间列"那条腿只管 `aiPanels`（专注概览在窄档去哪，是这条推导里**唯一没有先例**的一问）。
- 落地必须重跑**两族**判据 + 看图：`e2e/tests/focus-detail-pane.spec.ts`（本单 W7 那六条，含 F5 真产出一条记录）
  与 `e2e/tests/ai-row-layout.spec.ts`（那三条），外加窄档那张图。
  🔴 不许只跑一族就宣布合好了 —— 这枚 hunk 的缺陷形状正是"两侧各自的判据都绿、合起来那一格少了一个东西"。
- ⚠️ **15:0x 把这枚 hunk 的两族判据逐条读完之后，上面那句"两族"不够，是 5 个 spec**（逐条归属见 §8.54 第 3 节）：
  `detail-column-slot` / `detail-pane-overlay` / `focus-detail-pane` / `ai-row-layout` / `detail-pane-collapse`。
  本单 W4 那五条（`detail-pane-collapse.spec.ts` T1/T2/T3a-c/T4）以前没进这张名单，因为 W4 与 AI 面**在 main 上是同一批**、
  而在本分支上是两批 —— 它们要在合并产物里第一次同时成立。
- 🔴 **解这一枚时必须把 main 那个 `ref={detailRef}` 一起搬进合并形状**（`:2539`，它是 `detailHasRoom` 唯一的测量点）。
  留 HEAD 那支裸 `<aside className="ht-app__detail" data-testid="detail-column">` 而忘了 ref ⇒ `detailRef.current` 恒 `null`
  ⇒ `?? 0` ⇒ 布尔恒 `false` ⇒ AI 面**永远**挂中间列，那一格只剩专注概览。
  ✅ 这一种错**是有判据的**：`ai-row-layout.spec.ts:84-100` 宽窗那一腿断言 `ai.x >= detail-column.x` 且整块落在右栏内 ⇒ 会红。
- 🔴 **还有一格两族判据都照不到**（这是静态可证的合并缺陷，不是"可能"）：
  `detailHasRoom` 只在 mount 与 `resize` 时重算（main `:645-655`：`useEffect(..., [])` + `window.addEventListener('resize', sync)`），
  而 HEAD 把"这一栏不出现"的四档**全部**实现成 `display: none`（`base.css:200` 用户收起 + `narrow.css:134/156/198` 三档几何不可行）。
  `display:none` 的盒 `getBoundingClientRect().width` 恒 0（CSS 定义；本单 T2 的承重判据本身就靠这一点），
  而**改 `data-detail` 属性不触发 `resize`** ⇒ 合并后在宽窗点页头那个"收起详情面"：列 `display:none` 了，布尔还是 `true`，
  `aiPanels` 仍挂在那根不可见的列里 ⇒ **AI 助手从界面上消失，且不退回中间列** ——
  正好破掉 main 自己写在 `:637` 的那条判据「功能一个都不少」。
  镜像那一半同样成立：载入时 localStorage 是 `collapsed` ⇒ 布尔 `false` ⇒ AI 面进中间列；点"展开"后端不重算
  ⇒ 右栏出现但**是空的**，"无选中态时右栏默认显示 AI"在收起过的设备上没生效。
  为什么两族都照不到：`detail-pane-collapse.spec.ts` 五条**从不看** `ai-tool-run`，`ai-row-layout.spec.ts` 三条**从不点** `detail-pane-toggle`
  —— 交叉的那一格没有主人。
  ⚠️ **它不是"当场就能修"的一条**：正确行为本身要拍 —— 「收起详情面」到底是"那一栏的东西跟着藏"还是"内容退回中间列"，
  两种答案对应两种改法（前者什么都不用做，后者要把测量从 `resize` 改成跟着 `data-detail` 走）。
  已挂进 #19（要人的那一格），**不在这里替谁选**。
  ✅ **15:2x 这一格补了一手对照**：它升格成调研侧的 **C1 #13 / C1b-Q13**
  （[调研文档](../research/detail-pane-alignment-and-spaced-review.md)），两条官方出处 + 一条明文"Apple HIG 那页没取到正文"，
  带代价的推荐是**跟着藏**，但那一节自己写明：**选了这支仍要改代码**（现状是布尔没重算的副作用，不是意图），
  且要补一条交叉判据。⇒ 引用这一格时给 C1b-Q13，别再给"没人查过"。
- 🔴 **18:4x 补：这一枚现在有一道常驻判据在量它**（此前只有文档里的一句话）。合流当时在产物树上跑
  `node scripts/check-detail-pane-slot.mjs --root <候选树>` 报的就是"槽区域里仍带冲突标记 ⇒ 没能跑（marker 未清）"，
  预检装置的 P2 臂把"文档那枚红消失后，剩下的那一枚必须是它"钉住了。逐字冲突块、另外两种此前没写下来的
  候选写法（两栏叠 / 专注面挪回中间列）与"本批做/没做"见 **§8.75**。⚠️ 分流必须走在配对结论之前，
  否则这一档在真产物树上永远不会被读到（§8.74 第 6 节，那是 18:3x 实测出来的）。

#### 3g. `docs/plans/detail-pane-alignment.md`（机械可解，但**不是整侧取 HEAD**）

1 枚 hunk，就在 §2 那张表里。按**行键**比过：main 侧两行（`W1b` / `W2`）的行键 HEAD 侧全有，HEAD 侧只多一行 `W1c`
⇒ 不是两份不同内容，是"同一行的两个状态"。🔴 **但整侧取 HEAD 会丢掉 main 那侧的两句话**：
把 `W2` 那一格按句段比过，main 侧独有 **2 段**（就是 §3f 那条拍板与"不另开第三处"的边界），HEAD 侧独有 0。

正解：**取 HEAD 那一整行，再把 main 那 2 个句段接回同一格**。
⚠️ 这两句与"独有 0"都是 14:5x 的现量（那一格两边都在长），合流当时要重比一遍再动。

### 4. 步骤 5 —— 合完立刻补的两行豁免，顺序不能反

`ROW_ID_EXEMPT` 里已经有这两枚文件的 `confirmingId` 行（`scripts/check-selection-single-source.mjs:383` 与 `:391`）。
合流后要加的是同两个文件的 **`busyId`（类别 `in-flight`）**：
`apps/web/src/features/trash/TrashView.tsx`、`apps/mobile/src/screens/TrashScreen.tsx`。

- 现量（13:39）：main 侧 `TrashView.tsx:104` 与 `TrashScreen.tsx:89` 各有一处 `busyId`，
  **HEAD 侧 grep 为空** ⇒ 这两枚只存在于 main，所以 G 在本载体是绿的、合并后才会需要。
- 已用两种方法复量枚数 = 2（§8.36）。
- ✅ **14:2x 预演过（§8.52）**：把候选树铺到临时目录跑真门禁，产物上**恰好**点名这两枚，
  补两行之后 `RC=0` 且 `F` 的 5 面表一字未变。现成载体：
  `node scripts/verify-detail-pane-merge-preflight.mjs`（红 = 1 道 = 就是这一条）。
- 🔴 **仍然"先跑、红了才加"**：上面那次是**在临时铺出来的产物上**跑的，不是真分支。
  不该红的时候把这两行写进真分支 = 销账，和"不能失败的检查没有价值"是同一句话的反面。
  不要因为这一节写着"预期 2 枚"就直接加。
- ⚠️ 补行时**同时**改掉 `ROW_ID_EXEMPT` 上方注释里那个"15 处" —— 它是计数的抄件，见 §8.52 第 2.3 条。
- 同一趟复核 **F 的 5 面表**：main 若新增了会"说出选中"的面，`FACES` 要么登记，
  要么那条分母自检（`anyTrace.length < FACES.length`）会红 —— 两种红含义不同，看清是哪一条。
  （§8.52 那一趟的读数是 **F 不需要改**：产物上仍 5 面、豁免 1 处事实基础未变。）

### 5. 步骤 6 —— 合并产物的验真顺序（每步只认退出码）

| # | 动作 | 过 | 为什么排在这个位置 |
|---|---|---|---|
| 0 | `node scripts/verify-detail-pane-merge-preflight.mjs` | "合并造成的红"= 0 且"静默合流丢行"= 0 **且"仍带 marker 的产品文件"= 0**（§8.56：前面两格为 0 而这一格不为 0 时，那一趟的绿量的是一个编不出来的东西，不算验过） | ✅ 已入库（§8.52）。零 VCS 改动地把候选树铺到 `/tmp` 跑**真门禁**，另附一份 main 单独作对照，所以分不清"合并合错了"和"本来就红"的那些情况在这一趟就先解决掉。`--keep` + `--product <目录>` 是"手工处置完冲突后原地复跑"那条路 |
| 1 | 逐枚语法解析：`.mjs` 用 `node --check`，TS/TSX 用 §8.44 那把 in-memory host | 全部无诊断 | 挡 §8.42 第 15 节那个形状（把 main 的函数**抄进**我的门禁脚本：文本层干净、零 marker、解析层两条同名声明）。⚠️ **射程要含"静默合流"那一档**：这一趟 15 枚冲突之外还有 **10 枚两侧都改过而 git 没报冲突**，其中就有那枚门禁脚本本体。第 0 步的脚本对这 10 枚**逐枚跑了语法解析**（`.mjs` 走 `node --check`、`.ts/.tsx` 走 `transpileModule`，读数见 §8.52）⇒ 手工那一步已经不必做。🔴 但**只到语法层**：`transpileModule` 报的是括号/截断这类，"两条同名声明"是语义错，那一档仍然只有第 2 步的 typecheck 抓得住 |
| 2 | `pnpm -r typecheck` | RC=0 | |
| 3 | `pnpm --filter @heyta/app-host test`；mobile 侧 **cd 进 `apps/mobile`** 用 `./node_modules/.bin/vitest` | 各自全量，且 app-host 那趟含 3b 拼接进来的两侧用例 | 根目录**没有** `./node_modules/.bin/vitest`（§8.45 那条 `MOBILE_TEST_RC=127` 就是这么来的） |
| 4 | `node scripts/check-selection-single-source.mjs` | 四行结论都打印（A–H + 总结） | 含 §4 那两行豁免与 F 的复核 |
| 5 | `pnpm check` | RC=0 | 两道余量为 0 的棘轮在这里；红了先查是不是 main 侧带来新的裸值 / 内联样式，**不许调基线** |
| 6 | §3e 那三个 spec + 看图 | 10 张重出、md5 三列两两不同、人看过 | 界面类判据必须截图且人看图（AGENTS §6.2 规定一） |
| 7 | `pnpm reinstall:all` | 四端各自那条判据 | §6.1.1 —— 这是 W1/W2/W3/W5/W6 **唯一仍未闭合的验收格**（#13） |

第 5/6/7 步的负载前置（现量，别凭记忆）：

```bash
ps Axo command | grep -F verify-mobile | grep -v grep    # 期望：空
sysctl -n vm.loadavg                                      # 1 分钟值要低于 12
```

13:38 那一趟：**第一条已过（空）、第二条没过（20.58 > 12）** ⇒ 全链电池、web 全量、e2e 这三样
在当前窗口仍然不该起（§8.45 同一条前置，那趟是负载 427 + 5 台 booted 模拟器）。

### 6. 这一节自己防的两件事

1. **防"数字被当现状读"**：第 1 节标明瞬时并给取号趟，第 2 节把"等一等"和"要人"拆开。
2. **防"顺序被当判据"**：六步每步都有退出码来源；15 枚冲突里我只把**一枚**（`main-area.css`）
   写成要人，并且写清了要人拍的到底是哪五项差异 —— 不是"看着合一下"。
   ⚠️ 这句的枚数在 14:5x 过期（合流面 17 枚、要人 2 枚，见 §3f）—— 过期的是**数**，不是这条自检的本体：
   "要人的每一枚都必须写着题面"仍然成立，§3f 就是照它写的（含那条可推导的形状 + 必须重跑的两族判据）。

⚠️ 两处我原本想写进 runbook、经查证**在本载体不存在**的东西，记下来挡下一次同样的引用：
`scripts/verify-mobile-window-gate.sh` 与 `r17-evidence-md5-check.sh`（那是日历/Profile 那条线的装置，
不在本分支的 `scripts/` 里）；表格列对齐自检 `/tmp/dp_tablecheck4.mjs` 也没入库。
⇒ 第 3e 步的判据换成了仓库里一定有的 `md5` 三列并排比。这正好是 C1b 那条的形状：
**runbook 里引用一个不存在的东西，比引用一个会消失的东西更糟，因为它连"曾经存在"都不留证据。**

状态：第 3 节现在 **7 类处置（§3a–§3g）**。§3a/§3b 与第 4 步**已落成执行器并在候选树上跑出绿**（§8.53，
`node scripts/resolve-detail-pane-merge-mechanical.mjs --apply` ⇒ 回读 marker 0 / 语法 0 诊断 / 门禁复跑 RC=0）；
§3c 与 §3f 是**要人的那两枚**；§3d/§3e/§3g 有精确改法但要在真合并那一刻做。
第 5 步第 2 行往后（typecheck / 全量测试 / `pnpm check` / 重出截图 / 四端重装）**未执行** ——
它们要的载体是真分支，本节不含任何合并动作。

## 8.48 `check:docs` 的章节引用解析器不吃"字母尾巴"：一处假红 + 一处假绿，两侧一起修（2026-10-04 13:5x）

### 1. 触发点不是"想改工具"，是 §8.47 取合流现场时那条红挡在路上

写 runbook 必须跑 `node research/tools/docs-link-check.mjs`（它是第 3d 步的判据）。本载体 RC=1、两枚红，
而 §8.43 第 6 节早就把这两枚各判过一次：① = 分支落后 main 的读数，② = **检查器自己的假阳性，
并明确写了"本单不改检查器"**。本节就是把②改掉，并把"那句不改为什么不成立了"写在原句旁边（而不是新开一节夸它）。

### 2. 同一个截断在两个方向上坏，症状相反 —— 这是本节唯一的新知识

| 方向 | 引用（现量位置） | 目标 | 解析成 | 结局 |
|---|---|---|---|---|
| **假红** | `docs/plans/countdown-anniversary.md:1280` 的 `§1a` | `docs/adr/README.md` 只有 `### 1a.「勘误段」…`（第 31 行）；纯数字 `## 1.` 只出现在"模板"那个代码块里，被 fence 排除 | `1` | 报"该章节号不存在" —— 而**引用本来就是对的** |
| **假绿** | `docs/plans/user-journey-and-auth.md:334` 与 `BLOCKED.md:245` 的 `§4d` | `docs/research/spikes/m2-webview-shell/README.md` **同时**有 `## 4.`（第 80 行）和 `## 4d.`（第 198 行） | `4` | 比的是**错的那一节**；把 `## 4d.` 改名或整节删掉，`check:docs` 一路绿灯 |

现量的规模：仓库里字母尾巴的标题 **25 个**（`grep -rhoE '^#{2,6} [0-9]+[a-z][.、]' --include='*.md' .`），
字母尾巴的跨文档引用 **3 处**。🔴 假绿那一面比假红贵 —— 吵的那枚有人会去查，不吵的那枚只有等
被引用那一节自己漂走才知道，而它已经"检查通过"了很久。

### 3. 改了什么：两处正则 + 六条自检臂，**必须两侧一起**

`SECTION_REF_RE` 与 `sectionNumbers()` 的标题正则各加一个 `[a-z]?`。
🔴 只放宽引用侧 ⇒ 索引里没有 `1a` ⇒ 假红换成一条更响的假红；只放宽索引侧 ⇒ 引用仍被截 ⇒ 新索引永远读不到
⇒ 假绿原样留着。这正是这个文件自己注释里记过的那对"互相掩护"缺陷（两级小数 + 路径解析）的**第三种面目**。

新增**六条** `assertSelfTest` 臂（现量：`eq(` 在 (1b) 那一节里 6 次）：解析侧 2 条
（`§1a`/`§4d` 要整体解析）、索引侧 3 条（字母标题要进索引、`4` 与 `4d` 是两个键、
`## 4d.` 不许替 `4` 占位 = 假绿定向那条）、纯数字那一档 1 条阴性对照（`## 3. 结论` 不受影响）。

### 4. 有牙证据：`research/tools/mutation-rigs/mutate-docs-letter-section.mjs`

```
✅ L1 只回退解析侧 rc=1 命中=2/2
✅ L2 只回退索引侧 rc=1 命中=2/2
✅ L3 两侧一起回退（= 修之前的原状） rc=1 命中=4/4
✅ L5 索引把字母档归一化进数字父节 rc=1 命中=2/2
✅ L4 阴性对照：字样只写进注释 rc=1 命中=0/0
ARMS=5 AS_EXPECTED=5 FAIL=0 FINAL_SAME=true
```

🔴 **L3 是这一节真正承重的一条**：原状是"两侧一致地错"，文档层只暴露那一条假红，
而它对**自检完全隐形** —— 修之前的代码带着这个缺陷跑了很久，没有任何一层会红。
L3 现在把原状直接判红，所以"新臂有牙"不需要靠信仰。
判定**按报错文案点名而不是数 rc**：本载体基线 rc 本来就是 1（那枚落后死链），数 rc 会把环境读成结论。

⚠️ **诚实边界**：假绿那一面**没有活文档上的定向复现** —— 那需要往别人的文档里塞一条写错的字母引用。
现有证据只有两条：L5 那条合成臂，以及第 5 节 main 树上"改前改后输出逐字节相同"。
🔴 也别把 L2/L3 没打红"4d 不许替 4 占位"读成那条臂没牙：索引整个丢掉字母键时 `.has('4')` 仍然是 `false`，
它钉的是"把 `## 4d.` 归一化成 `4`"那一种回归 —— 能打出它的只有 L5（这条写进 rig 的文件头了）。

### 5. 爆炸半径是量出来的，不是推断的

§8.43 第 6 节当时第二条理由是"**会同时影响别的线正在写的引用**"。这现在是一个可测的命题：

```bash
git worktree add --detach /tmp/dp-main-check main      # main 现量 ee85f272（13:5x，比 13:38 的 e8645f51 又走了一笔）
cd /tmp/dp-main-check && node research/tools/docs-link-check.mjs          # 未修版
cp <本分支的 docs-link-check.mjs> 上去 && node research/tools/docs-link-check.mjs   # 换上本版
```

读数：**两趟都 RC=0、输出逐字节相同、"检查 522 处跨文档章节引用"这个数不变** ⇒ 在比本分支大得多的树上
**零新增红**，也没有改变覆盖面。⇒ 那句"会影响别的线"的量是 **0 枚**，它不再构成不改的理由。
临时检出已 `git worktree remove --force` 撤掉（`git worktree list | grep -c dp-main-check` = 0）。

本载体那一趟：改前 1 处失效章节引用 + 1 个死链 → 改后 **只剩那枚死链**（目标在 main 和合并候选树
`b1f7e5d8` 里都有 ⇒ 合流自愈，§8.43 第 6 节①已记，本单不动它）。本分支树检查数 441。

📌 **顺手 sweep 了一遍"这毛病还有第二份吗"**（改一处结论句必 sweep 全仓那条规则）：
按"行里含 `§` 且是正则/`RegExp`"或"含 `#{2,6}` 且带数字且有 `exec`"扫 `scripts/`、`research/tools/`、`e2e/` 全部 `.mjs/.js/.ts`
⇒ **12 处命中，其中只有 `docs-link-check.mjs:320` 一处是真正的解析器**，其余全是注释里的引用叙述
（`check-row-single-source.mjs:63/90`、`verify-email-auth-chain.mjs:3/199` 等）。
⇒ 没有第二份抄件要同步；这一档的单一所有者就是这个文件本身。页内锚点那一档（同一文件报"检查 54 处页内锚点"）
本来就不是按数字解析的，不受影响，改后仍 0 红。

### 6. 四道前置闸门

| 闸门 | 读数 |
|---|---|
| 归属门 | 3 枚：`research/tools/docs-link-check.mjs`（两处正则 + 六条自检臂）、新臂装置（五臂）、本篇。零 `packages/*`、零界面、零线协议 |
| 两道余量为 0 的棘轮 | 无输入（没碰 CSS / `ht-*`），本轮没读基线数字 |
| 干净检出复跑 | 就是第 5 节那趟 main 检出 —— 这一单的"干净检出"不是复跑同一棵树，而是**换了一棵更大的树** |
| `packages` 改完先 build | 不适用（零依赖脚本） |

状态：检查器这一侧**已完成**；那枚落后死链仍是"等合流"，本单不碰。

### 7. 待入 `docs/reference/environment-traps.md`（台账在别人手里，按 §8 第 8 条登记而不插行）

候选一条（现量号取工作树最大值，不按 HEAD）：

> 🔴 **同一个解析缺陷可以在两个方向上坏，而只有其中一个会吵。**
> `check:docs` 的章节引用把 `§1a` 截成 `§1`：目标**没有**纯数字 `1` 时报"章节不存在"（假红，有人会查）；
> 目标**同时**有 `## 4.` 和 `## 4d.` 时静默匹配到 `4`（假绿，`## 4d.` 改名/删掉都不会红）。
> 症状一个是吵的一个是不吵的，所以**修的时候两侧都要放宽**（引用正则 + 标题索引），
> 而**验证的时候两个方向都要臂** —— 只测假红那一侧，下一次重构会把假绿改回去而没人发现。
> 可迁移的做法：给"截断/归一化"类解析器加一条**定向臂**，把归一化真的写进代码（`## 4d.` 造出 `4`）看它红。
> 实例：`research/tools/mutation-rigs/mutate-docs-letter-section.mjs`（五臂，L3 打红"修之前的原状"）。

现量取号命令（谁接手都跑这个，别抄本节写的号）：`grep -oE '^[0-9]+\. ' docs/reference/environment-traps.md | sort -n | tail -1`。
⚠️ 本篇的 13:5x 一趟里**没有**动那本台账（它在合流冲突清单里，且主检出正被并行会话整片重写）。

## 8.49 想把 §6 第 1 行（不许用 emoji/文字字形当图标）升成常驻门禁 —— 量过代价后**决定不建**（2026-10-04 14:0x）

§8.39 数出来"9 行里只有 3 行有常驻载体，🔴 1/2/3/5 只能靠评审"。这一节是把第 1 行那一格的**代价量出来**，
因为"加一道门禁"听起来是零成本动作，而它在这里不是。结论：**本批不建**，且理由带现量。

### 1. 我的第一趟探针报了 0 命中，而那个 0 是 needle 的形状给的

| 趟 | 覆盖的码位 | 结果（扫 `apps/web/src` `apps/mobile/src` `packages/ui/src`，剥块注释与行注释后） |
|---|---|---|
| 第一趟 | `🔴 ⚠️ ✅ ❌` + `U+1F000–U+1FAFF`（emoji 区） | **0 命中** ⇒ 我当时读成"仓库已经干净，门禁是零债棘轮" |
| 第二趟 | 加上 `U+2600–U+27BF`（Misc Symbols / Dingbats） | **3 命中** ⇒ 上面那句作废 |

差的那两枚恰好就是命中的两枚字符：**`✓` = U+2713、`✕` = U+2715**，它们不在 emoji 区，在 Dingbats 区。
📌 这是"断言没有 X"那一族的第 N 次：**`needle 0 命中` 从来不区分"仓库里没有"和"我的模式没覆盖那一档"** ——
一条要挡"用文字字形当图标"的门禁，它的码位表本身就是判据的全部射程。

### 2. 三处现量，以及它们各自在谁手里

| 位置 | 形状 | 归属现量 |
|---|---|---|
| `packages/ui/src/task-list/TaskRow.tsx:333` | `{row.done ? <Text … styles.tick>✓</Text> : null}` —— **勾选框里的对勾就是文字字形** | merge-base `f419df75` 的同一文件第 327 行**已经在**（`git show $MB:… \| grep -n ✓`），引入者是 `59324985`（09-28 共享 UI 那批）⇒ **不是本批造的**；但这一行的邻居（描边＝优先级）正是 W5 改过的地方 |
| `apps/web/src/features/admin/AdminPanel.tsx:523` | `{coupon.enabled ? '✓' : '✕'} · …` | 运营后台那条线（ADR-0038 那批） |
| `apps/web/src/features/admin/AdminPanel.tsx:558` | `{code.disabled ? '✕' : '✓'} · …` | 同上 |

⇒ 一道严格门禁今天就会**红三处**，其中一处位于本批正在改的共享组件。
要让门禁绿只有两条路，都不是"顺手加一道检查"：

1. **往允许清单加三行** —— 本批在 §8.13 刚拒绝过这个修法（"往 `EMPTY_SITES` 加一行 = 把债合法化"）。同一把尺子在这里也成立。
2. **把那三处换成 Lucide 图标** —— 那是**真视觉改动**：共享 `TaskRow` 的对勾一改，任务/日历/四象限/时间线/搜索五个面同时变，
   按 AGENTS §6.2 规定一要重跑 e2e + 逐张看图，而且"勾选框里放 Lucide `Check` 还是放字形"本身是一个设计判断
   （字形跟着 `font-size`/`line-height` 走，图标跟着 `ICON_SIZE` 走，基线与视觉重量都不同）。
   🔴 这不是本批 §6 授权范围内能顺手拍的事 —— 它属于要产品负责人看图的题面。

### 3. 还有一个与"这一行"无关、但决定了任何新门禁都进不了常驻的形状

`pnpm check` 是一条**静态串在根 `package.json` 的 `scripts.check` 里**的链（现量：链里 62 段，其中 57 段是 `pnpm check:*`；根 `package.json` 的 `check:` 键共 58 个），
没有"自动枚举 `scripts/check-*.mjs`"这种消费者 ⇒ 新增门禁**必须改 `package.json`** 才会被跑。
而 `package.json` 此刻在主检出是 **`M`（+6/−1）**。按 §1 归属门与 Goal 第⑤条，本批不改别人在飞的那一枚。
⇒ 就算第 2 节那两个代价我挑一个做掉，这道门禁这一轮也**只能是不被任何人跑的脚本** ——
而"写了没人跑的门禁"正是 §8.13 之后我自己立过的反面（判"有人守"要数两列：判据本身 + 它的自动消费者）。

### 4. 所以本节的产出

- §6 第 1 行的状态从"🔴 无载体、下次靠评审"**改写得更精确**：不是"没人想到加门禁"，而是
  **加之前要先清三处存量（一处是本批正在改的共享组件）并过一次要人看的视觉改动**，且要等 `package.json` 空出来才能接线。
  下一个读 §8.39 那一行的人不会再从零量一遍 —— 代价与三处落点都在上面。
- 探针这一族的教训（码位表就是射程）：**任何"界面里不许出现 X 字形"的门禁，交付时要一起交出它覆盖的码位区间表**
  —— 否则"0 命中"没有可读的含义，而这条门禁的红/绿完全由那张表决定，不由代码决定。
- 本批**没有**新增门禁、**没有**改 `TaskRow` 的对勾、**没有**动 `package.json`；上面所有数来自只读探针（`/tmp`，不入库）。

📌 记这一节的用途和 §8.39 同一条：把"我们没违反"和"永远不会违反"分开，
而这一次多写了一句 —— **"永远不会违反"也不是免费的，它的价格是三处存量 + 一次视觉改动 + 一枚别人手里的 `package.json`。**

## 8.50 §8.47 那三条"处置"被**执行**了一遍：一条成立、一条不成立、一条的前提是错的（2026-10-04 14:0x）

### 1. 为什么要有这一节

§8.47 是我在三小时前写下的 runbook，里面每条处置都是**读冲突块读出来的判断**，没有一条被做过一遍。
"写出来的合并指令"和"做出来的合并产物"是两件事 —— 这一节把三枚代码冲突的处置在候选树上机械执行，
只看产物：还剩几个 marker、语法过不过、有没有重复名/重复用例。
🔴 全程只读 git 对象（`git show <候选树>:<路径>`），**不建工作树、不 merge、不落任何仓库文件**，
所以它不构成任何合并动作，只是把"要人拍的那几项"从三枚缩到一枚。

### 2. 三枚的读数（同一棵候选树 `8b3240c0`，14:06；13:38 那棵是 `b1f7e5d8`，冲突枚数都是 15）

| runbook 那一格 | 当时的写法 | 执行后的产物 | 判定 |
|---|---|---|---|
| 3a `habit-actions.ts` | import 取并集 | `markers=0 / 语法错=0 / 重复导入名=0` | ✅ 成立 |
| 3b `habit-actions.spec.ts` | "两块都留、**拼接即可**" | 直接拼 ⇒ `markers=0` 但 **`TS1005 '}' expected`** | 🔴 **不成立** |
| 3c `main-area.css` | "两族各做了一遍同一道题，差异在五项 ⇒ 择一" | 按 声明名→值 逐条比：hunk#2 的 main 侧含 HEAD 侧**全部 5 条且取值逐字相同**，还多一条 HEAD 完全没有的新规则 | 🔴 **前提是错的** |

**3b 的真实形状**：两侧各自的**括号差都是 +2**，而 marker 之后的共享尾部只有两条闭合（`  });` 与 `});`）。
也就是说单取任一侧都平衡，**拼起来就少两条闭合**。补 0/1/2/3 条的读数：语法错 `1 / 1 / 0 / 2`。
补够之后是 **describe 10 个 / 用例 36 条 / 重名 0 条**。
所以正确处置是"在 ours 块之后补 **等于它括号差** 条 `});` 再拼 theirs"——
写死的"2 条"只对这一棵候选树成立，main 再往前走就可能不是 2 条（这是它为什么必须写成差值而不是常数）。

**3c 的真实形状**（逐条比名字相同的声明的**取值**，不是数属性名）：

| hunk | 只在 main | 只在 HEAD | 同名不同值 | 要不要人 |
|---|---|---|---|---|
| #1（`.ht-header`） | `flex-shrink: 0` | — | `gap`、`padding` | **要**：拍的是"页头这一条许不许被压窄" |
| #2（`.ht-header__actions`） | `align-items: center`、`max-inline-size: 100%` | — | — | **不要**：main 是严格超集 |
| #2 附带（`.ht-header__lang`，9 条声明） | 整条规则 | — | — | **不要**：取 HEAD 侧会**把别人这一整条删掉** |

⇒ §8.40/§8.47 说的"3 枚要人"**现在应读成 1 枚**（`main-area.css` 的 hunk#1）。
> 🔴 **同一趟 14:5x 又改成 2 枚**：合流面涨到 17 枚，多出的 `App.tsx` 那一枚要人（AI 面 vs 专注概览抢同一格，§3f）。
> 这句话在两小时内被现量改写了两次（3 → 1 → 2），**改的不是判断，是那一刻的合流面**。
这不是把债说小 —— 三枚里两枚被验成机械可解，剩下那一枚的题面也从"两套规则择一"缩成
"一条 `flex-shrink` 加两个取值"，而它恰好是 HEAD 那侧用一整段注释推翻过的旧不变量，
拍起来只需要回答一句：**页头这一条许不许被压窄**。

### 3. 这一节里我自己错的那一半，留在原处

写 §8.47 时我把 hunk#2 判成"同题两次"，靠的是**数两侧的属性名**（13 对 5，共有 5）。
属性名相同不代表取值相同，更不代表两块内容同层 —— main 那侧的 13 条里有一整条**别的规则**。
📌 可迁移：**比两块冲突文本是不是"同一道题"，要按 声明名→值 逐条比，并按选择器切开；
只数属性名会把"一侧包含另一侧"读成"两侧并列"，从而把一条本来不必拍板的冲突报成要人拍。**
而"要人拍"是有代价的读数：它会把一整轮合流的进度挂在一个人身上，而这里挂的三枚里两枚根本不用挂。

### 4. 探针本身（不入库，形状记下来）

三枚都从 `git show <候选树>:<路径>` 取带 marker 的原文，按 `<<<<<<< … ======= … >>>>>>>` 切两侧，
机械生成产物后用 **TypeScript 的 `transpileModule(reportDiagnostics:true)`** 收语法诊断
（不需要 CompilerHost，也不需要 node_modules 里的工作树 —— 这一点让"在候选树上验语法"变得零成本），
CSS 则先剥块注释再按 `}` 切规则块。
⚠️ 第一趟我把 `git merge-tree` 的 rc=1 当成失败抛异常，实际**树号照样在 stdout 第一行**；
这条与仓库既有的"rc 非 0 不等于没有读数"同族，记在这里免得下一次又丢树号。

## 8.51 §8.47 剩下两步执行验真：10 枚 PNG 的生产者是闭合的，但台账**两条**撞号（2026-10-04 14:1x）

### 1. 3e（"整片重出那 10 张"）成立，而且是**一对一**成立的

按"哪个 spec 写哪个证据文件"全仓扫（不预设只有那三个 spec），现量：

| 证据目录 | 唯一生产者 | 枚数 |
|---|---|---|
| `apps/web/evidence/detail-column-slot/` | `e2e/tests/detail-column-slot.spec.ts` | 3 |
| `apps/web/evidence/detail-pane-overlay/` | `e2e/tests/detail-pane-overlay.spec.ts` | 2 |
| `apps/web/evidence/selection-projections/` | `e2e/tests/selection-projections.spec.ts` | 5 |

三条都验过才敢写进 runbook：**每枚 PNG 恰好一个生产者**（`UNCOVERED=0`）、
**这三个目录没有被第四个 spec 碰过**（其余 8 份写 `apps/web/evidence/` 的 spec 各写自己的目录）、
**10 个文件名在全仓不重名**（各 1 枚，所以"按文件名找生产者"这一步不是猜的）。
⇒ "重跑那三个 spec 就整片覆盖"没有漏网的孤儿，选边这件事可以完全不做。

### 2. 3d（文档台账）执行时撞到两件事，都发生在 `docs/reference/environment-traps.md`

**(a) 本批那两枚号已经被 main 占了 —— 同号不同事。**

| 号 | 本分支那条的标题起首 | main 那条的标题起首 | 逐字相同 |
|---|---|---|---|
| 215 | 变异/验证脚本读的是产物时，"存活"这个读数要先过一道…… | 把验收搬到隔离检出（worktree）里跑，缺的不止 `node_modules`…… | **False** |
| 216 | "只断言某件事没发生"的用例，正向对照配在端点上等于没配 | 验收脚本在断言失败的那条路径上根本不写产物…… | **False** |

现量号段：`main` 侧条目 **237** 条、最大号 **228**；本分支 **190** 条、最大号 **216**。
06:41 那趟取号时 main 最大号还是 214，**六小时涨了 14 个号** ⇒ §8.22 那条"取号按工作树现量"不是仪式，
它的有效窗只有几小时。
**处置按既有规则（取号方自己挪）**：合流当时把本批这**两枚**续到"当时 main 最大号 +1 / +2"，
并一起 sweep 掉本批文档里指向旧号的引用 —— 现量 `grep -n '#21[56]' docs/plans/detail-pane-alignment.md`：
**8 行 / 16 处**（行号 459、568、607、618、637、1030、1054 + 本节自己那一行）。
   ⚠️ 改这句话本身会让这个数再变（我把它从 8/16 写正的过程中，本节那一行不再匹配，就成了 **7 行 / 14 处**，
   行号 459、568、607、618、637、1030、1054）⇒ 合流当时**重新跑那条 grep**，别引用这里的数。
🔴 **不在今天挪**：号段一小时涨 14，现在挪到 229/230 到合流时可能又是一次撞号 ——
留在原号 + 一条写明的续号规则，比挪两次各留一份歧义好。这一条与 §8.49 不同：
那里的"不做"是因为代价（三处存量 + 视觉改动），这里的"不做"是因为**时机**（现量数会过期）。

**(b) `main` 的台账自己已经有 4 组同号不同事** —— 与本批无关，但比本批那两枚贵：

| 号 | main 里两条的标题（各自都带 🔴 与粗体 ⇒ 都是真条目，不是正文里的编号列表） | 行号 |
|---|---|---|
| 38 | "一个常量当两种单位用：`grace`…" vs "软键盘会把 tap 吞掉，而点工具报的是 `success`…" | 716 / 787 |
| 93 | "手写解析器和写死的外部宿主形状…" vs "Google Prefab CLI 2.1.0 在 JDK 24 下…" | 2455 / 2894 |
| 94 | "macOS 的 `base64 -d` 不认 base64url…" vs "共享验收助手的假设会过时…" | 2496 / 2913 |
| 95 | "新镜像 + 旧 `.env` = 容器 crash-loop…" vs "Expo 原生模块装不进 pnpm monorepo…" | 2524 / 2945 |

⇒ 这四组的后果是**仓库级的**：`AGENTS.md` §7 让人"按 §7 第 N 条"引用陷阱，而 N 现在**不唯一**。
入站引用现量（全仓 `.md`，排除台账自身）：#38 **10 处**（`BLOCKED.md`×5、`AGENTS.md`×1、
`legal-pipl-baseline.md`×2、`motivation-and-progression.md`×1、`phase-2-multi-platform.md`×1）、
#93 3 处、#94 3 处、#95 0 处。
🔴 **本批不修，且写明为什么不修**：修它要给别人的条目改号并 sweep 上面那 16 处入站引用，
其中一处就在 `AGENTS.md` —— 而 AGENTS.md 的规则部分不在本批授权内（§8 第 9 条：不改别人在飞的活；
仓库规则：不擅自改 AGENTS.md）。登记成一条独立工单（#20），并留一条**合流当时能跑的探测器**：

```bash
# 合并产物里"同号不同事"的清单（只认条目形状：行首 N. + 🔴 + 粗体标题）
python3 - <<'PY'
import io,re,collections
t=io.open('docs/reference/environment-traps.md',encoding='utf-8').read().split('\n')
e=collections.defaultdict(list)
for i,l in enumerate(t,1):
    m=re.match(r'^(\d+)\. (?:🔴|⚠️)?\s*\*\*',l)
    if m: e[int(m.group(1))].append((i,l[:60]))
bad={k:v for k,v in e.items() if len(v)>1}
print(f"条目总数={sum(len(v) for v in e.values())} 撞号组={len(bad)}")
for k,v in sorted(bad.items()): print(' ',k,v)
PY
```

⚠️ 这条探针本身有过一次假读数：第一趟用裸 `^(\d+)\. ` 数，main 报"重号 = 1,2,3,4,38,93,94,95"，
而 `1–4` 是**条目正文里的编号列表**（L123–126 才是真条目 1–4，正文里的 `1.` 出现在 L1996 等处）。
按条目形状（行首 + emoji 标记 + 粗体标题）收窄后才是上面那四组。
📌 与 §8.49 同一条教训的第二次命中：**"扫出 N 处命中"要先问这 N 处是不是同一个东西。**

## 8.52 合并**产物**的预检落了载体：17 道纯 fs 门禁 + 10 枚静默合流逐行对账，两档各配一条对照（2026-10-04 14:2x）

§8.47 第 4/5 步此前只有"该跑什么"，没有"在哪儿跑"—— 那两步都要**合并之后的树**，而在真分支上做完再发现红，
代价是回滚一次真合并。现在有一枚脚本能在**不碰任何分支、不做任何 merge** 的前提下先把它们量一遍：

```bash
node scripts/verify-detail-pane-merge-preflight.mjs            # 默认 main × HEAD
node scripts/verify-detail-pane-merge-preflight.mjs --keep     # 把两份临时载体留着，进去手工处置冲突
node scripts/verify-detail-pane-merge-preflight.mjs --product <上一步留下的目录>   # 处置完复跑，不重新铺树
```

机制：`git merge-tree --write-tree` 造候选树 → `git archive | tar -x` 铺到 `/tmp` → 用**真门禁**跑（一条逻辑都不复刻）
→ 再铺一份 **main 单独**当对照载体。只有"候选红而 main 绿"才算**合并造成的红**；两边都红的是环境/载体所致，**不含信息**。
退出码：合并造成的红 + 静默合流的（丢行 ∪ 删文件 ∪ 语法不过 ∪ **语法未判**）= 0 ⇒ 0；有 ⇒ 1；连候选树都造不出来 ⇒ 2（响亮失败，不静默放行）。

### 1. 现量（14:2x，`main` 在 `0a0b63f6`→`73b6df97` 之间走了两次 / HEAD `4d0cbd89` / MB `f419df75` / 落后 532→534 / 领先 78 / 负载 28.11）

| 读数 | 值 |
|---|---|
| 冲突 | 15 枚，其中 **5 枚仍带 marker**（`main-area.css`、`docs/README.md`、`environment-traps.md`、`habit-actions.ts`、`habit-actions.spec.ts`）⇒ §8.47 第 3 节还没做完，这是**预期**读数 |
| 纯 fs 门禁 | 17 道：**合并造成的红 = 1**（只有 `check-selection-single-source`），两边都红 = 0 |
| 那唯一一枚 | `✗ 选中态的所有者不唯一：断言 G：宿主里有 2 处本地 …Id useState 没有语义登记` —— 点名的**恰好**是 §8.47 第 4 节预告的两枚（`apps/web/src/features/trash/TrashView.tsx busyId` / `apps/mobile/src/screens/TrashScreen.tsx busyId`） |
| 对照趟（`--a main --b main`） | 冲突=0、带 marker=无、**合并造成的红=0**、RC=0 ⇒ 这枚脚本不是"每次都红一次"的仪式 |
| 静默合流 | 10 枚，**逐枚两侧新增行全在场**（`App.tsx` 50/107、`i18n/en` 376/23、`i18n/zh-CN` 402/27、`app-host/index.ts` 105/9、`helpers.ts` 12/22、`TasksScreen.tsx` 14/19、`focus/store.ts` 6/31、`NotesBoard.tsx` 3/20、`docs-link-check.mjs` 10/33、`check-selection-single-source.mjs` 61/319），且**逐枚过语法解析**：2 枚 `.mjs` 走 `node --check`、8 枚 `.ts/.tsx` 走 `transpileModule`（解析器从本检出取，产物树不需要 `node_modules`） |
| 静默合流的正对照 ①（丢行档） | 从产物里删掉 main 新增的**一行注释** ⇒ 恰好那一枚报 `丢行：main 侧缺 1 / HEAD 侧缺 0`、其余 9 枚与 17 道门禁读数一字不变 |
| 静默合流的正对照 ②（语法档） | 往 `focus/store.ts` 末尾追加一句 `const dp_broken = ;` ⇒ 恰好那一枚报 `行全在，但语法不过：Expression expected.（共 1 条）`、其余 9 枚不变，且"合并造成的红"仍是 1（那枚已知 G 红）⇒ 两档各自能红，不是同一档重复计数 |
| 补两行豁免之后 | `RC=0`，且 `F：5 处渲染面…` 一字未变（main 没带来新的"会说出选中"的面）、`G：17 处`、`H：6 处`、`接线声明 18 处全部用起来` |

⇒ **§8.47 第 4 节那条"先跑、红了才加"现在有了可执行的形式**，而且第 4 节预告的枚数是准的（2 枚，不多不少）。
第 5 步表格的第 1 行（逐枚语法解析）也从此不必手工：脚本已经对**所有** `.mjs` 静默合流枚跑了 `node --check`。

### 2. 三件只有做这一步才会知道的事

1. 🔴 **"两侧都改过而 merge 没报冲突"这一档此前完全没进 runbook。** §8.47 第 5 步第 1 行写的是"逐枚语法解析"，
   射程是**那 15 枚冲突文件** —— 而 §8.42 那个形状（把 main 的函数抄进同一份脚本 ⇒ 两条同名声明）恰恰发生在
   **没有冲突**的枚上：`scripts/check-selection-single-source.mjs` 两侧都改过（main 侧 `f37ade5b` 的
   `objectSpreadUseOf` 给断言 E 加对象展开识别、本批侧 +319 行的 F/G/H），git 静默拼接、零 marker。
   这一趟量出来是**好读数**（声明 1 处在 `:267`、调用 1 处在 `:419`、HEAD 侧那份 0 处 ⇒ main 那 61 行没被吞），
   但"好"必须是**量出来的**，不是"没报冲突"推出来的。
2. 🟢 **一条旧待办被这条读数关掉了**：本记忆与此前几轮一直挂着"断言 F 的 +79 行还在主检出工作树里没落、
   等它干净再提"。那 79 行的归宿现已定了 —— 它进的是 main 侧的 **E 的对象展开扩展**（`f37ade5b`），
   并且**已经在合并产物里活着**。所以那一格不用再等，也不存在"本批要重提一遍"的动作。
3. ⚠️ **`ROW_ID_EXEMPT` 上方那行注释写着"15 处"** —— 那是**计数的抄件**，而 G 自己打印的是数组实际命中数
   （补两行后 `17 处`）。加豁免行时那行注释必须同时改，否则它先烂掉，而没有任何一层会红。
   处置：合流补那两行时把注释里的数改成不带数的说法（"逐处归类结果，条数看 G 的打印"）。
   这是"抄件一定会漂"那条纪律在**注释**上的第三次命中，形状和前两次一样：**长期对账的值只留指针，不留抄件。**

### 3. 边界（别读多）

- 17 道只是 `pnpm check` 那 57 段里**只读源码**的一批。要 `dist` / `node_modules` / 服务端 / 浏览器的段落一段都不在这里
  ⇒ **这里绿不等于合并后 `pnpm check` 绿**，第 5 步的 2/3/5/6/7 行一步都不能省。
- `check:docs` **刻意不在清单里**：它要 `git ls-files` 判"本机有、仓库里没"那一档，而临时目录不是 git 检出 ——
  两个载体都会红成一样的，那种红不含信息。§8.47 第 3d 步的死链判据仍只能在真合并后跑。
- 静默合流那档判两件事：**行在不在** + **语法过不过**（`.mjs` 与 `.ts/.tsx` 都过）。它**不判语义** ——
  两侧各往同一个函数里加语句、行都在、语法也过，行为仍可能是错的；而"两条同名声明"这种**语义**级重名
  `transpileModule` 也不报（它只做语法解析）。这两样唯一的载体是真跑：第 5 步的 `pnpm -r typecheck` + 全量测试。
- 语法解析器取自**跑脚本这一侧**的检出（按 `node_modules` → `apps/web` → `packages/app-host` 三个候选找）。
  一个都找不到时那一枚报 `🔴 语法**未判**`，**不算通过** —— 没跑成的检查被读成绿，是本项目最贵的一类错。
- `TREE=` 每趟都不同（这一趟内 `main` 就走了两次）⇒ **树号不是复现凭据**。引用读数要带 `main`/`HEAD` 双 sha 与时刻，
  不然下一个人拿一个已经不存在的树号去 `git cat-file`，会读成"那趟没发生过"。
- **不挂 `pnpm check`**：它要两侧真的分叉才有意义（同树跑就是 0/0/0 的空读数，见第 1 节对照趟），
  而且接线要动在别人手里的 `package.json`（同 §8.49 那条判据）。合流当时手工跑，跑法就在本节代码块里。

状态：**已执行、已验真**（脚本入库两笔：`d3c0ee92` 铺树 + 17 道带对照 + 静默合流逐行档；`efb37119` 补 TS/TSX 语法档。
两档各一条正对照，红点互不重叠；§8.47 第 4 节预告的枚数被产物层读数确认）。
趟次记号：14:2x–14:3x，本趟内 `main` 从 `0a0b63f6` 走到 `d636b010`（落后 532→536）⇒ 上面的 `TREE=` 三趟三个号，
**都是同一条合流面的有效读数**，别拿某个树号去否证另一趟。

## 8.53 那三步机械处置落成执行器；跑它的时候合流面从 15 枚涨到 17 枚，而涨出来的那一枚带着**一条新拍板**（2026-10-04 14:5x）

### 1. 新载体：`scripts/resolve-detail-pane-merge-mechanical.mjs`

§8.47 第 3a / 3b / 第 4 步此前是散文（"取并集""补够闭合""红了才加"）。现在它们是一个脚本，
且**前提不成立就拒绝改**，不是替人猜：

```bash
node scripts/resolve-detail-pane-merge-mechanical.mjs            # 只报会怎么改（零写盘）
node scripts/resolve-detail-pane-merge-mechanical.mjs --apply    # 改在它自己铺的临时产物上（仍不碰分支）
node scripts/resolve-detail-pane-merge-mechanical.mjs --product <§8.52 留下的目录> --apply
```

14:5x 那一趟（`TREE=d28258be…`，载体 `/tmp/dp-resolve-fpK1hz`）三条全按预期落地，`--apply` 后的回读验真：

```
✅ packages/app-host/src/habit-actions.ts            marker 0 处 / 语法诊断 0 条      （并集 2+1 ⇒ 3 行，重名 0）
✅ packages/app-host/tests/habit-actions.spec.ts     marker 0 处 / 语法诊断 0 条      （补 2 条 `});`、删叙述残留 1 行、describe 10 / 用例 48 / 重名 0）
✅ scripts/check-selection-single-source.mjs         marker 0 / 语法 0 / 复跑 RC=0   （产物上红了，点名 2 枚全在预审名单 ⇒ 补 2 行 + 把注释里那个计数抄件改成指针）
```

随后 `verify-detail-pane-merge-preflight.mjs --product <同一目录>` ⇒ **合并造成的红 = 0**（上一趟是 1）。
⇒ §8.47 第 3 节的"机械可解"那一半现在有一个**跑得出绿**的载体，不再只是判断。

三条自己写坏又改对的探针故障，都记下来挡下一次：

| # | 症状 | 真因 | 处置 |
|---|---|---|---|
| 1 | 拼接判据报 `describe 10≠2 / 用例 48≠16` | 期望值只数了**冲突块两侧**，漏了 hunk 之外本来就有的 6 个 describe / 32 条用例 | 期望值改成 `pre+post+ours+theirs`；这条**假红反而证明断言有牙**（它挡下了写盘） |
| 2 | `删叙述残留 0 行`（而 §8.50 量到 1 行） | 那行的字面形状是 `// ── 追加到 … ──`，带注释符；按"行首就是 `──`"匹配恒 0 ⇒ 残留会**悄悄留在产物里** | 删除用窄式（两种形状都认），事后核验用**更宽**的串 —— 删的窄、查的宽才挡得住匹配器写窄 |
| 3 | 逐枚数 describe 恒 ≤1 | `String.match` 不带 `g` 时只回第一个匹配，`(m\|\|[]).length` 永远是 0/1 ⇒ "补几条闭合"的**唯一解搜索**会退化成"好几条都算过" | `countOf` 里强制补 `g` |

### 2. 🔴 合流面涨了：15 → 17 枚，其中一枚带着一条**已经落了的产品拍板**

同一趟预检把 §8.47 第 1 节那张表改写了（现量 `TREE=016d773b…`，`main` 在这半小时内又走了）：

- 新增 `apps/web/src/App.tsx`（1 枚 hunk）与 `docs/plans/detail-pane-alignment.md`（1 枚 hunk）。
- 读两侧原文才知道这不是"两个会话各自改了几行"：**产品负责人 2026-10-04 拍板「无选中态的时候默认显示 AI Chatbot」，
  而 web 已经把这条拍板落进 main** —— `apps/web/src/App.tsx:2528`（那句裁决的原话注释）、`:2542 {detailHasRoom ? aiPanels : null}`、
  `:643 const [detailHasRoom] = useState(true)`、`:1506 const aiPanels = (`、`:2094-2096`（窄档退回中间列、两处共用同一份 JSX 不抄第二份），
  判据在 `e2e/tests/ai-row-layout.spec.ts:19-20/78/93/98/103`（"AI 面在哪一栏" + 窄档不许消失）。
  main 侧那份工单 W2 行里同时写着它的边界：**"选中某条出详情面"那一半没被推翻，仍等拍板 #1/#8，且它替换的是同一块位置 —— 不另开第三处**。
- 于是 App.tsx 那枚 hunk 的内容是：main 侧把这一栏给 `aiPanels`，HEAD 侧（本单 W7）在 `contentView === 'focus'` 时给 `<FocusDetailPane />`。
  **两边都要，而且是同一格** ⇒ 选任何一侧都会删掉对方的行为。
- 工单文档那一枚**不要人**：按**行键**比过两侧，main 侧两行（`W1b` / `W2`）的行键 HEAD 侧全有，
  HEAD 侧只多一行 `W1c`；差异是"同一行的两个状态"，不是两份不同内容。
  🔴 但**不能整侧取 HEAD** —— 把 `W2` 那一格按句段比过，main 侧独有 **2 个句段**（就是上面那条拍板与它的边界），
  HEAD 侧独有 0。正解是**取 HEAD 那一整行、再把 main 那 2 个句段接回同一格**。
  ⚠️ 这两句是**这一节记下的现量**，合流当时要重比（`W2` 那一格两边都在长）。

### 3. 那条拍板对本单读到哪一层（不许读多）

1. **它拍的是"无选中那一格放什么"** —— 正好是 C1 #1 的**第一半**。所以 #1 现在不是"整条待拍"，
   剩下的是"选中某条时那一格换成详情面"那一半（main 上那句原话自己就这么划的）。已回写到调研 C1 #1 那一格。
2. **它没拍"专注面那一格"**。W7 那一格的理由仍然独立成立（`§8.21` 记的：滴答在番茄视图里那一栏是常驻概览+记录，与选中无关）。
   两条裁决**不冲突**，冲突的是**同一块 DOM**。
3. 由 1 与 2 可以**推**出一个合并形状（`{contentView === 'focus' ? <FocusDetailPane /> : detailHasRoom ? aiPanels : null}`
   并把窄档退回中间列那条腿只管 `aiPanels`）——⚠️ 这是**推导，不是拍板**：它改变"专注视图里那一格现在画什么"，
   落地要重跑**两族**判据（`e2e/tests/focus-detail-pane.spec.ts` 六条 + `ai-row-layout.spec.ts` 那三条），
   且窄档那一档要重新看图。谁合流谁做，本单不替它拍。
4. 这条涨出来的冲突**不改**"唯一那枚要人"的结论性质，但**改了枚数**：§8.47 第 3c 那枚（页头许不许被压窄）
   之外，现在又多一枚"同一格里 AI 面与专注概览怎么共处"。⇒ 要人裁决的枚数从 **1 变 2**（已回写 §8.47 与 §8.40 那句）。

状态：脚本入库；三条机械处置在候选树上跑出绿（RC=0）；第 2 节那两枚新冲突**已逐枚读回并给出处置**，
其中工单文档那一枚机械可解（附精确改法）、App.tsx 那一枚**要人**（附可推导的形状 + 必须重跑的两族判据）。

## 8.54 把 §3f 那句"重跑两族判据"逐条读完，得到三件事：名单是 5 个 spec、"忘搬 ref"有牙、交叉那一格没主人（2026-10-04 15:0x）

§3f 写"落地必须重跑两族"的时候，那一句话是我按 spec 名字推的，不是读完的。这一轮把它读完（六份 e2e + main 那半的实现），
零代码改动，产出一条常驻判据和两处必须写进拍板材料的结论。

### 1. 判据的机制链（每一环都给了出处，不是"我觉得"）

- main 侧那一栏的**内容开关**是一个测量值：`git show main:apps/web/src/App.tsx` → `:643` 声明、`:645-655` 效应，
  效应依赖 `[]` 且只挂 `window.addEventListener('resize', sync)`，`sync` 读的是
  `detailRef.current?.getBoundingClientRect().width ?? 0 > 0`；两个挂载点 `:2096`（窄档退回中间列）与 `:2542`（右栏）共用同一个布尔。
- HEAD 侧把"这一栏不出现"**四档全部**写成 `display: none`：`apps/web/src/styles/app/base.css:200`（`[data-detail='collapsed']`，W4 用户主动收起）
  + `apps/web/src/styles/app/narrow.css:134 / :156 / :198`（≤768 塌缩 / 769–1023 / ≥1024 且高 <480，W4 ①几何不可行）。
- 两环接起来：`display:none` ⇒ 宽度 0（CSS 定义，本单 T2 的承重判据"`.ht-main` 右边缘 == 视口右边缘"靠的就是轨道归零 + 这一列不渲染），
  而**改 `data-detail` 属性不会派发 `resize`** ⇒ 布尔不重算。
- ⇒ 合并产物上，宽窗点"收起详情面"：列不可见、布尔仍 `true`、`aiPanels` 仍挂在那根不可见的列里 ⇒ **AI 助手消失且不退回**，
  破掉 main 自己在 `:637` 写的判据「功能一个都不少」。反向那一半同样成立（载入即收起 ⇒ 展开后右栏是空的）。
  ⚠️ 这一条是**静态可证**的（链条上每一环都在盘上的源码/定义里），不是实测读数 —— 没有浏览器跑过合并产物，
  因为产物还不存在（§3f 要人）。所以它写在这里的形式是"合完必然成立的机制后果 + 两族判据都照不到"，不是"红了几条"。

### 2. 常驻判据：槽位唯一性（已入库，双臂各跑过一次）

人工解 §3f 时最容易留下的产物形状是**两支都贴上去** —— 那种产物 marker 清了、语法过了、两侧新增的行也都在
（§8.52/§8.53 那三道全绿），但界面里有两根详情列，`getByTestId('detail-column')` 变多命中，
红会落在**别人那一批**用例上（Playwright 严格模式），看起来像"详情列的测试坏了"而不是"合错了"。

加进 `scripts/verify-detail-pane-merge-preflight.mjs`：对 `apps/web/src/App.tsx#detail-column`
先验前提（两侧各自 `=1`，现量 `main=1 / HEAD=1`，merge-base `f419df75` 也 `=1`），再判产物**恰好 1 个**；
产物里那枚文件还带 marker 时打「未判」，不冒充绿也不假红。

| 臂 | 载体 | 读数 | RC |
|---|---|---|---|
| 未变异（对照） | `git archive main` 铺到 `/tmp/dp-slot-arm`，`--a main --b main --product …` | `main=1 main=1 产物=1`，其余 17 道全 0 | 0 |
| 变异 | 同一载体里把那段 `<aside data-testid="detail-column">` 复制一份 | `产物=2 —— 解冲突时把两支都留下了`，红集**只有这一条** | 1 |
| 现量合并载体 | `TREE=d79cb67e`（`main × HEAD`） | `main=1 HEAD=1 产物=2 · 未判（还有 marker）`；同趟 冲突=17 / 合并造成的红=1 / 两边都红=0 / 静默合流=**11** 枚全绿 | 1 |

⚠️ 这条**不许泛化成**"一个文件里不许有重复 testid"：HEAD 现量已有两处合法的（`App.tsx` 的 `task-list`、
`apps/web/src/dev/shell-host.tsx` 的 `shell-host`，217 个 `.ts/.tsx` 里就这 2 个文件有重复）。
通用形状会天天红，然后被人关掉 —— 那比没有判据更糟。

### 3. 名单从"两族"改成 5 个 spec，逐条写谁守哪一侧

| spec | 守的是哪一侧的行为 | 合并里丢了这个会怎样 |
|---|---|---|
| `focus-detail-pane.spec.ts`（F1–F6） | HEAD（本单 W7 专注概览） | 取 main 侧 ⇒ 只有它红 |
| `ai-row-layout.spec.ts`（3 条 + `assertColumn` 两腿 `:84-100`） | main（拍板"无选中态右栏装 AI 面"） | 取 HEAD 侧、或解冲突时丢了 `ref={detailRef}` ⇒ 宽窗那一腿红 |
| `detail-column-slot.spec.ts` | HEAD（W2 槽位 + 右边缘承重） | 两根 aside ⇒ 多命中，严格模式抛 |
| `detail-pane-overlay.spec.ts` | HEAD（W3 浮层覆盖范围） | 轨道变了会红 |
| `detail-pane-collapse.spec.ts`（T1/T2/T3a-c/T4） | HEAD（W4 看高也看宽 + 可收起 + 三条恢复路径） | T1 的 480/479 边界与 T4 的三档不可行**只在这五份里量得到** |

✅ 读过的四份里，本单那三份**不会**被 AI 面本身弄坏（逐条核过断言对象）：
`detail-column-slot.spec.ts:172/:176` 与 `focus-detail-pane.spec.ts` 的 F6（`:180`）断的分别是收起态 `toBeHidden()`
和**按 testid Scoped** 的 `toHaveCount(0)`，不是"那一栏是空的" ⇒ 右栏里多出 AI 面不会把它们变成假绿或假红。

🔴 但**没有一条**判据横跨两侧：`detail-pane-collapse` 五条从不看 `ai-tool-run`，`ai-row-layout` 三条从不点 `detail-pane-toggle`
—— 第 1 节那一格正因为没有主人才活到现在。合并后需要一条交叉用例（宽窗 → 点收起 ⇒ `ai-tool-run` 仍可见且落在中间列、
`.ht-main` 右边缘仍等于视口右边缘 → 再点展开 ⇒ 回到右栏）。
⚠️ **这一条现在不能写**：它的期望值取决于「收起」的语义要拍哪一种（§3f 末尾已把它挂进 #19），
先写断言就是替产品拍板。写在这里的形状是"缺口 + 两种答案"，不是待办清单上的一项。

边界（别读多）：本轮**没有**跑任何 e2e、没有动任何分支、没有解 §3f；
新增的只有 pre-flight 里那一段判据 + 本节与 §3f 的四处更正。§8.52/§8.53 的读数没被本节推翻，
只有"静默合流 10 枚"这一格在本节变成 **11 枚**（`base.css` 在此期间进了这个集合 —— 又是瞬时读数，合流当时要重取）。

## 8.55 在新 HEAD 上把整条合流链重跑一遍，撞出一条**我自己的两个装置互相顶牛**造出来的预期红（2026-10-04 15:1x–15:2x，载体 `167b4ee1`）

§8.53 那句"产物上 合并造成的红 = 0"是 14:5x 那棵树的读数。main 一直在走，所以这一轮把
`预检 --keep → 执行器 --apply → 预检 --product` 整条链在当前 refs 上重跑，得到的不是复现，而是**多一条红**。

### 1. 那条红长什么样，以及它是谁造成的

| 趟 | 载体 TREE | 门禁红 | 静默合流（11 枚） | 备注 |
|---|---|---|---|---|
| 原始候选树（15:1x） | `bba79327` | 合并造成的红 = 1（`check-selection-single-source`） | 丢行 = **1** | 缺的那行逐字查出来了：`/** §8.28 那一趟逐处归类后的 15 处。…*/` |
| 处置后（15:2x，修之后） | `48e0f48c` | **0** | **0** | 执行器第 4 步自己打的话改成了"（那行计数注释已经不在了，无需改）"，整链 RC=0 |

🔴 **成因不是别人，是我这两个脚本对同一行持不同文本**：执行器第 4 步要把表头那行注释重写成不带数的说法
（理由在 §8.52 第 2.3 条：注释里的"15 处"是计数抄件，补两行豁免就过期），
而预检的丢行档按**原文**逐行查"HEAD 新增的行是否还在产物里" ⇒ 每次跑必红一条。
这种红的危险不在多算一条，在于**它会让人开始相信"这条红是正常的"** —— 那正是元规则二说的"一条永远红的判据和一条永远绿的判据一样没有价值"，只是反着长。

### 2. 处置：把改动搬到源头，而不是给预检加豁免

加豁免是错的方向（那等于让丢行档学会睁一只眼）。改在**本分支**上（`scripts/check-selection-single-source.mjs`，我这条线的文件，纯注释零行为变化）：
- 三处计数抄件（`:360` / `:363` / `:375` 里的"15 处"）全部改成指针 —— G 每次跑就打印实时命中数（现量 `15 处`，四类 6/4/4/1），
  常驻值本来就不该被抄进注释。
- 顺手修一处**指向不存在之锚**的引用：原写"取法见本节末那条 `TOTAL=15` 的读数"，而本文件里没有那行
  （现量 `grep -rn 'TOTAL=15'` 只落在本节 §8.28 的文档里，`:2031`/`:2043`）⇒ 指针改指工单 §8.28。
- ⇒ 执行器那步自然匹配不到旧写法，它自己就走到"无需改"分支（`commentWasThere` 那条判断本来就是为这种情况写的），
  预检的丢行档也不再报红。**两个装置不再争同一行。**

读数：`node --check` 过；`node scripts/check-selection-single-source.mjs` **RC=0**（G/H/汇总三条原样）；
整链在新 refs 上 `合并造成的红=0 / 两边都红=0 / 丢行=0 / 槽位重复=0`，RC=0。
🔴 **这句"RC=0"在 §8.56 被自己否证了一次**：那一趟的产物里 `App.tsx` 与 `main-area.css` 还带着冲突 marker，
也就是**没有一个能编译、能运行的状态被量过** —— tally 那四格说的是"文本扫描器没报错"，不是"合好的代码没问题"。
原句留在这里，更正见 §8.56。

### 3. 现在的合流就绪账（15:2x 现量，全部是瞬时读数，合流当时要重取）

- 冲突 **17 枚**；产物上还带 marker 的 **5 个文件**：`App.tsx`（§3f，**要人**）、`main-area.css`（§3c，**要人**）、
  `docs/README.md` + 本工单（§3g）+ `environment-traps.md`（§3d，机械）。
  ⚠️ **RC=0 不等于"合好了"**：预检的退出码只统计"门禁红 / 丢行 / 槽位重复"三档，marker 那一档由
  `带 marker 的门禁脚本=…` 那一行单独报（这是刻意的 —— 有 marker 的产物跑门禁毫无意义，红会全是噪声）。
- 机械那三条（§3a/§3b/第 4 步）在 15:2x 的树上仍**改法 3 / 拒绝 0**，说明形状前提没被 main 的移动破坏。
- 设备窗口仍未开（`loadavg 17.50 / 18.49 / 23.43`，闸门阈值 12）。
- 一条不属于本线的存量红记在这里免得下轮重查：`docs-link-check` 报 `PROGRESS.md:1362 → docs/research/aed-implementation-evidence.md` 死链，
  该目标在 `HEAD` 与 `main` **都没被跟踪**（`PROGRESS.md` 里 main 2 处 / HEAD 1 处）⇒ 别人已提交的债，本单不吸收、不顺手改。

## 8.56 §8.55 那句"RC=0"把 tally 的强度写过了它实际能证的 —— 加了一条探针，而探针配的机制**被自己这趟的 A/B 否证**（2026-10-04 15:3x）

### 1. 我先犯了什么

§8.55 写"整链 RC=0"。那句话字面没错（预检当时确实退 0），但它没说的是：那一趟的产物里
`apps/web/src/App.tsx` 与 `apps/web/src/styles/app/main-area.css` **还带着冲突 marker**。
带 marker 的文件既编不出来也跑不起来 ⇒ 那 17 道门禁量的**不是一个真实存在的状态**，
"合并造成的红=0 / 两边都红=0 / 丢行=0 / 槽位重复=0"四格证明的是**文本扫描器没被绊倒**，
不是"合好的代码没问题"。§1 那两道余量为 0 的棘轮尤其容易被这样读成"合流后还在基线"。

⇒ 预检加一条判据：**产物里还有带 marker 的产品源码/样式（`apps/`、`packages/` 下的 `.ts/.tsx/.css/.mjs`）⇒ 这一趟 tally 不算"合流验过"，计入退出码。**
⚠️ 它**不抄各道门禁的扫描范围**（那是一份会漂的抄件，本仓刚为同样的病修过一轮，见 §8.55 第 2 节）。

### 2. 🔴 我给这条探针配的机制是错的，被本趟自己的 A/B 否证

我第一版写的是"`<<<<<<<` 混进 `.css` 会让那条规则被跳过 / 混进 `.ts` 会让那段被解析成别的东西 ⇒ 棘轮**假绿**"。
在同一枚载体上做 A/B（原样 vs 剥掉 marker 分隔行、两侧内容都留 = "两支都贴上去"那种产物）：

| 门禁 | 带 marker | 剥掉 marker |
|---|---|---|
| `check:row-single-source` | ✅ `ht-*` 前缀族 **28** 个，恰在基线 28 | ✅ 逐字相同 |
| `check:l4-no-style` | ✅ 三道断言通过 | ✅ 逐字相同 |
| `check:ui-language` | ✅ 330 个文件 / 428 处文案 / 词条 zh-CN 3093 · en 3093 | ✅ 逐字相同 |
| `design-system/heyta/check-hardcoded` | ✅ 无硬编码设计变量 | ✅ 逐字相同 |

⇒ 这四道是**文本扫描器**，marker 对它们只是一行普通文本，既不推高命中数也不让整段跳过。
"假绿"这个理由**不成立**，已从脚本注释与打印语里撤掉。
探针留下的真实理由是更前面一件事：**带 marker 的产物不是一个可编译/可运行的状态**，
所以那一趟的绿不能当合流验收；真会被 marker 绊倒的是 §8.47 的**第 2 步 typecheck 与第 5 步测试/e2e**，
而那两步恰恰必须在清完 marker 之后才跑得动。⇒ 措辞改成这个之后，判据的**射程也更窄更真**：
它不说"数错了"，只说"量的对象还不存在"。

📌 **这趟实验本身还有一次差点假通过**：第一版 A/B 我用 `node -e` 内联，脚本里的引号把它弄成语法错、
剥操作**根本没发生**，于是两次"读数相同"其实是**同一个文件量了两遍** —— 而那恰好是 A/B 看起来通过的样子。
第二版改成写盘的脚本文件，并把 `行数 280 → 274` / `2686 → 2683` 打进输出，才确认变量真的被动过。
⇒ **A/B 必须自带"两侧确实不同"的那一行**（行数 / 哈希 / 命中数），否则"读数相同"这个结论可能来自实验没跑。

### 3. 探针自己有没有牙（双臂，各带 TREE 号）

| 臂 | 载体 | 读数 | RC |
|---|---|---|---|
| 阴性对照 | 干净 `main` 单独铺一份（`7707b4b3`） | 冲突 0 · `产物仍带 marker 的产品文件=0（这一趟的 tally 量的是一个可运行状态）` | **0** |
| 阳性 | `main × HEAD` 处置完 §3a/§3b/第 4 步（`6c33f5a9`） | 冲突 17 · 合并造成的红 0 · 两边都红 0 · 丢行 0 · 槽位重复 0 · **仍带 marker 的产品文件=2 枚（`App.tsx` / `main-area.css`）⇒ 本趟 tally 不算"合流验过"** | **1** |
| 原始候选树（对照上一行） | `main × HEAD` 未处置（`19783767`） | 同一句报 **4 枚**（多 `packages/app-host/src/habit-actions.ts` 与其 spec），合并造成的红=1 | 1 |

⚠️ 边界：A/B 只测了上面那四道。`check:design` / `check-layering` 等**没测**，所以探针的措辞**不依赖**"某道会被绊倒"这个未验假设 ——
这正是把理由从"数错了"换成"对象不存在"的另一个好处：后者对没测过的门禁同样成立。

🔴 **对合流流程的实际改变**（谁合流谁按这个走）：`§3c` 与 `§3f` 没解完，预检就**不可能退 0** ——
这不是装置坏了，是它现在拒绝把"半合的状态"报成验过。要拿到那一趟有效的 tally，
顺序是：解完源码冲突（含 §3c/§3f）→ `--apply` 那三条机械处置已在产物里 → **再跑一次预检**，
那一趟的 `合并造成的红 / 丢行 / 槽位重复 / marker` 四格才算数；然后才是 §8.47 第 2 步往后。

## 8.57 台账那一枚从"要人记得去数"变成机器判据：三条腿，外加我自己造的三次探针故障（2026-10-04 15:4x，载体 `docs/reference/environment-traps.md` 判据）

§3d① 一直写着"合流当时两件必做的现量"，但那两句是**给人读的命令**，没有一条判据在守 ——
而这条规矩已经被违反过（`#20`：main 侧 4 组同号不同事）。这一节把它变成预检里的一条常驻判据。

### 1. 先说现状的实测数字（15:4x，`main × HEAD`，`TREE=34a8ae65`）

- `main` 侧 **224 条**、最大号 **228**；`HEAD` 侧 **177 条**、最大号 **216**；merge-base **175 条**。
- 本批新增两号 `#215` / `#216`；`main` 同期新增 **49 条**里**也用了 215 与 216，而且是别的事**
  （逐字比对比出来：`#215` HEAD 那条是"工单 §8.9 实测…"，main 那条是"**gitignore 掉的必需配置**…"）。
- ⇒ §3d① 那句"同号不同事"现在**机器报得出来**：同号不同事 **2 组**，续号起点 **229**，要 sweep 的引用**现量 9 行 / 18 处（命中在 1 个文件 = 本工单，共扫 252 个 `.md`）**。

判据三条腿：**L1 缺号**（两侧各自新增的号在产物里没了）、**L2 号在但这一侧写的正文没留下**（号被另一侧内容占了）、
**L3 同号不同事**（两侧都新起这个号且没有任何一块逐字相同 ⇒ 报红 + 给续号起点 + 现量引用行数）。它**不自动改号** ——
改号要连 sweep 引用，而"要不要顺带修 main 那 4 组"是 #20 那格未拍的裁决。

| 臂 | 构造 | 读数 | RC |
|---|---|---|---|
| 对照 | `--a main --b main`（产物=干净 main） | `main=224 / main=224；新增 +0/+0 · 号与正文都在`，台账 **0 项** | 0 |
| 真实合并载体 | `main × HEAD`（`34a8ae65`） | `新增 main=+49 HEAD=+2 · 号与正文都在`（marker 让两侧都留着）+ 🔴 **同号不同事 2 组** ⇒ 台账 **2 项** | 1 |
| 变异（L2 的牙） | 产物换成 **main 单独一份**，refs 仍按 `main × HEAD` 比 | 🔴 `号在但这一侧写的那条正文没留下：HEAD#215,HEAD#216` | 1 |

### 2. 🔴 三次探针故障，全都在"看起来最干净"的方向上（都是我这趟自己造的）

1. **`git grep -nE '#(215|216)\b'` 恒返回 0 行** —— git grep 的 ERE **不认 `\b`**（同趟实测：带 `\b` **0 行** / 不带 `\b` **9 行**）。
   那条腿第一版就打印了"现量 0 行"，读起来正好是"没有引用要改"。
   ⇒ 改成 node 走 `git ls-files '*.md'` + JS 正则 `(?![0-9])`，并且**空读数必须带分母**：现在打的是
   `9 行 / 18 处（命中在 1 个文件，共扫 252 个 .md）`。
2. **marker 行被并进相邻条目的正文** —— 直接对产物做条目解析时，`<<<<<<< main` / `=======` / `>>>>>>> HEAD`
   三行既不是条目行也不是标题行，就被算进包围它们的那一条 ⇒ 于是"两侧内容其实都在"的产物反而报出
   **假阳性 3 条**（`main#195` / `main#228` / `HEAD#216`"正文没留下"）。
   ⇒ 比对前剥掉那三行分隔符 —— 剥完的形状就是"两支都留"，正是这一档要比的东西。
3. **第一版只查"号在不在"** —— 产物换成 main 单独一份时，`#215/#216` 号还在、内容却是另一件事，
   那条腿**完全没抓到**（是变异臂 A3 把它暴露的：那趟原本只报 collide，不报吞）。
   ⇒ 加 L2。**这就是"判据只查存在性"的通用病**：号存在，被吞掉的内容不会说话。

⚠️ 边界（别读多）：**"同号但双方写的是同一件事"那一支（正文逐字相同 ⇒ 不算红）没有被任何一臂走到**
—— 对照臂是退化的 `+0/+0`，真实臂命中的两组都是不同事。那一支目前只有代码逻辑，没有实测。

📌 与 #20 的关系：#20 要的是"把 main 上那 4 组同号不同事**修掉**"，那要动 AGENTS §7 的号段索引表（未授权，仍挂着）。
本节这条判据管的是**别再新增一组** —— 它不改历史，只在合并当时把新撞的号、续号起点和引用行数一并量出来。





## 8.58 工单第 4 条要求"§8 读数含截图路径"，而那些路径**一条都没有机器消费者**：补一条判据，外加我自己的一趟假红（2026-10-04 15:5x）

### 1. 先记我这条探针的错（原话留在下面，不删）

收口审计跑到"截图证据"这一栏时，我打出来的是：

> `e2e/test-results` 是空的 —— 工单里 9 条截图引用有 6 条现在指向不存在的文件。

**两句都不成立**，错法各不同：

| 我做的 | 实际 | 后果 |
|---|---|---|
| 拿 `.png` 的**basename** 去 `e2e/test-results/` 下面 stat | 工单里的证据**没有一张**落在 `e2e/test-results/`，全在 `apps/web/evidence/<族>/`（那里 250 枚 png 是被仓库跟踪的） | 6 条"缺失"是我自己拼出来的目录 ⇒ 假红 |
| 抽取用 `[A-Za-z0-9./-]+\.png` | 本线证据引用的**主体写法是花括号分组**（`…/keyboard-cursor/{k1-…,k7-…}.png`，全文 11 组） | "9 条提及"本身也是低估：按分组展开是 55 条引用、33 个位置 |

而 `e2e/test-results/` 确实是空的，也确实是 `.gitignore:79` 的 `test-results/` —— 那是 Playwright 的一次性目录，
§8 W1b 边界⑧ 里"想回查时已经被我自己的复跑删掉了"讲的就是它。**把那个目录空当成"证据没了"，是把工作目录认成了证据库。**

### 2. 真缺口：常驻死链门禁对这类引用的射程是 0

`research/tools/docs-link-check.mjs` 在抽链接之前把行内代码**整段抹成空格**（该文件 `:170-171`）：

    out = out.replace(/``[\s\S]*?``/g, (m) => ' '.repeat(m.length));
    out = out.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));

而本线的截图路径**一律**写成 `` `apps/web/evidence/…` ``（行内代码）。也就是说：工单第 4 条要的"读数含截图路径"、
§6.2 规定一要的"截图落盘 + 人看图"，在门禁层是**一句散文**——路径打错、被改名、或者只在本机存在而没入库，
都不会有任何东西失败。§8.51 那句"10 枚 PNG 的生产者是闭合的"当时靠的是我手敲 `md5`，同样没有常驻消费者。

不去改 `docs-link-check.mjs`：它抹行内代码是**有道理的**（行内代码里绝大多数是命令、文件名简写、`file:line`，
不是可解析链接），把它翻过来会在**全仓每一篇文档**上开一轮新检查 —— 那是别人的账，本单不吸收（§8 W1b 边界③同一处置）。

### 3. 落了的判据：`scripts/check-detail-pane-evidence-refs.mjs`

范围**只圈本线两份文档**（`docs/plans/detail-pane-alignment.md`、`docs/research/detail-pane-alignment-and-spaced-review.md`），
可以传参换文档（变异臂就靠这个）。六条腿：

1. **全路径引用必须落盘且被 `git ls-files` 跟踪** —— 后半是重点：`existsSync` 只看本机，
   而"盘上有、库里没"正是 §8 记过的那枚 `PROGRESS.md` → `aed-implementation-evidence.md` 死链的形状
   （干净检出上必然不存在），也是 §7 #196 那一族。
2. **花括号分组先展开再判**（一组 3 项 ⇒ 3 条独立引用，各自判落位）。抽取形状见脚本里那两条 🔴：
   前缀字符类**必须吃 `/`**，否则每条分组引用都掉成裸文件名、腿 1 永远轮不到它们（假绿）；
   **必须吃 `* ? [ ]`**，否则 7 处通配模式会被截成一个 `.png` token 落进"解析不了"（这脚本第一趟的 7 条假红就是它）。
3. **通配模式单列一档**：打印计数并逐条列出、按定义不判落位。**不静默跳过** ——
   跳过等于给"写成星号就不用落位"开了旁路。
4. **绝对路径单列一档**（`/tmp/…` 那类）：库外的东西不在"仓库跟踪"的射程里，同样只打印不判。
5. **"提到这个后缀"和"指一个文件"要分开**：纯扩展名提及（谈的是 `.png` 本身）与组里带省略号的**缩略提及**
   （形状上不可能落位）各归一档、逐条打印。这两档同时也是**旁路** —— 把真引用写成省略号就躲过这条判据。
   处置和通配模式一样：让它出现在打印里、能被数，而不是假装不存在。
6. **展开后引用 0 条 ⇒ 红**（拒绝在抽取形状坏掉时报绿）。

简写引用（`selection-projections/01-list.png`、`f3-empty-records.png` 这类）的处置是**先按带目录的简写配、
配不到才退到纯文件名**，顺序反过来就会把一个简写解析到**另一族同名文件**上（比悬空更坏，它看起来是绿的）。
唯一落位 ⇒ 绿并把落点打出来；0 个或歧义 ⇒ 红。

📌 **本节第一版被自己的判据抓了一次**（不是修辞）：那一版在讲五臂时把反例路径**照抄成字面形状**
（一枚库里不存在的成员名、一枚两族同名的裸文件名），判据把 5 条全报成红。
分两种处置：**形状本身不该入账**的（纯扩展名、省略号）进腿 5 的档；**确实写成了会落位的形状**的三处，
改写成"用哪一枚、不带后缀地指它"，而不是给判据开豁免 —— 反例描述不需要长得像一条真引用。

### 4. 读数（15:5x 第一趟 / 16:0x 六臂跑完后的终读数）

    node scripts/check-detail-pane-evidence-refs.mjs
    图片 token 38 个（其中 7 个是通配模式）⇒ 花括号展开后引用 57 条（全路径 44 / 简写 13）
    计数单位：引用（按出现次数）57 条 → 去重后指向 33 个位置，其中成立 33 个
    · 通配模式 7 个 / 提到后缀但不是引用 5 处（4 处纯扩展名 + 1 处组里带省略号）/ 库外绝对路径 0 个
    · 简写但能唯一落位 13 条（打印落点，不判红）
    结论：本线文档每条截图引用都落在一枚被仓库跟踪的文件上 ✅   RC=0

第一趟（15:5x，腿 4/5 还没建）是 `token 31 ⇒ 引用 55 条（全路径 44 / 简写 11）` 且**带 7 条假红** ——
那 7 条全是通配模式被截成 `.png` 造成的（脚本里第 2 条 🔴 就是它）。

⚠️ 这组数是**自指的**：本节既是被判的对象、又是那 5 处"提到后缀"的产地。改本节任何一个 `.png` 形状，
38/57/13 就会跟着动 ⇒ 引用这些数必须带上"16:0x 那一趟"，不许当基线。
（两份文档里调研那份**零条**图片引用，57 条全来自工单本体。）

### 5. 能不能失败：六臂 + 阳性对照

| 臂 | 注入 | 红/绿在哪条腿 | RC |
|---|---|---|---|
| A1 | 引用一枚不存在的族内文件名 | 腿 1（全路径引用在盘上不存在） | 1 |
| A2 | 把一张**真图**拷进族目录但不 `add`，再引用它 | 腿 1 后半（盘上有、仓库没跟踪） | 1 |
| A3 | 只写一枚**裸文件名**（用 `packaged-first-run` 那一枚，库里有 2 族同名） | 腿"简写歧义"，候选 2 个逐条打出 | 1 |
| A4 | 在同一组里塞一枚库里不存在的成员名（`t9-not-a-real-shot`） | 分组展开后仍走腿 1（证明展开不是装饰） | 1 |
| A5 | 一篇不含图片引用的文档 | 腿 6（引用 0 条，拒绝报绿） | 1 |
| A6 | **分类档**（不是注入档）：1 条真引用 + 1 个库外绝对路径 + 1 个通配模式 + 1 个省略号缩略 + 1 处纯后缀 | 只判那 1 条真引用，其余四档各自打印入账 | 0 |
| 对照 | 恢复干净后的真文档 | 全绿 | 0 |

A2 用完把那枚临时 png 删掉了，`git status --porcelain apps/web/evidence` 复跑为空。
⚠️ **这个做法已作废**（§8.64 第 4 节）：往检出里造未跟踪文件正好落在 AGENTS §6.1.1 那条
"Windows 段送 `git ls-files` + 未跟踪非忽略"的集合里。臂现在整套固化成装置
`research/tools/mutation-rigs/mutate-detail-pane-evidence-refs.mjs`（11/11，多了 A7 中文路径阳性臂、
A8 集合守卫臂，并把 A2 改成在 mkdtemp 的**独立索引**副本里 `git rm --cached` 一枚真引用的 png），
上面这张表留着是为了让"六臂那一趟"仍是可追溯的历史读数，而不是当前跑法。
A6 存在的理由：分档（腿 4/5）如果规则写宽了，会**连真引用一起吃掉**而整趟照样绿 ——
A6 的读数必须停在 `引用 1 条 / 成立 1 个`，一旦变成 `引用 0 条` 就说明分档吃穿了，那时它会撞腿 6 自己报红。

### 6. 边界（别读多）

- **未挂进 `pnpm check`**：主检出的根 `package.json` 此刻是 ` M`（并行会话在飞），
  这一节不往别人的在途文件里加一行。脚本自带独立入口；挂接动作留给合流那一轮（`package.json` 回到干净态之后），**不另立编号** ——
本节第一版在这里写过「登记为 §8.59 待办第 5 项」，而 §8.59 根本不存在：那就是今天 §8.55 末段修过的"指向不存在之锚"那一族，
就地改掉，划线留档在这里而不是悄悄消失。（写完这段我立刻 `grep -n 8\.59` 复核过：全文只剩这一处提及，且它说的就是"这处提及本身是错的"。）
  🔴 **18:1x 更正：上面那档"未挂"已经进链了。** 当时那句理由（不能在别人的在途文件里加一行）站不住 ——
  在我这棵树提交自己的 `package.json` 碰不到别人的工作树，真实代价只是合流多出一枚冲突文件。
  量法与合流时的并集处置规则见 §8.73；原读数留在上面，是为了让下一个人看清我把两件事捏成了一件。
- 它管的是**引用能不能落位**，不管**图对不对**：一张空白图、一张错误屏，腿 1 都会照样绿。
  看图那道仍在 §6.2 规定一（AGENTS §7 第 82 条"主蓝命中"那种判据本线还没做，属于另一件事）。
- 也不管**内容漂移**：并行会话重跑 e2e 会改写同名文件（§8 W1b 边界⑦、另一条线记的"证据 md5 被重写而无人报红"），
  这条判据对那件事没有射程 —— 那是哈希对账，不是路径对账。

## 8.59 目标第 1 条（"每行待拍值都要有外部调研对照节"）此前也是一句散文：补 C1↔C1b 对账门禁（2026-10-04 16:0x）

### 1. 缺口在哪

`docs/research/detail-pane-alignment-and-spaced-review.md` 的 C1 表用的是**封闭句式**——"要拍才能继续的值"共 13 行，
每行都应当有一个 C1b 对照节（别人怎么做的 + 日期 + 出处）。上一节（§8.58）修的是"截图路径没人对账"，
这一格是同一族病的另一张脸：**句式本身是断言，而没有任何一层在守它**。
今天往 C1 加第 14 行、不写对照节，`pnpm check` 不会有任何一道会红 ——
这与 AGENTS §9 里 L' 那条（法务条款"未列出即视为未授权"⇒ 那张表必须有一条对账门禁）是同一个形状。

### 2. 判据：`scripts/check-detail-pane-c1-coverage.mjs`

四条腿 + 两条抽取守卫，默认只圈那一份调研文档（可传参换文档，变异臂靠这个）：

| 腿 | 判什么 | 为什么是这个形状 |
|---|---|---|
| A | C1 每一行 ⇒ 要么被某个 C1b 节的 `= C1 #N` 回指覆盖，要么**在自己那一行**写明属于哪一类例外 | 例外**不在脚本里另立登记表**（那是一份会漂的抄件，本仓刚为同样的病修过一轮，见 §8.55）；理由必须写在被约束的那一行里，读的人看表就知道 |
| B | 例外类别是**封闭词表**（两类：`已核-不需要拍` / `不是要拍的值-已随工单落码`） | 绕过判据最省力的写法恰好就是"随便填一句理由"。填"已处理"不算例外（M2 臂就测这个） |
| C | 每个 C1b 节回指的行号必须能在表里找到 | 挡"研究了一格不存在的题"，也挡标题里的 `#N` 被改错 |
| D | 每个 C1b 节必须含 ≥1 个日期串 且 ≥1 个出处 | 出处 = **URL 或 `file:line` 择一**。这条不是我拍的：`C1b-Q7` 那一节的取证形态是**读源码**（现量 URL=0、`file:line`=1），而同一份文档的未核实清单里早就写着"取证强度不由 URL 数决定，这一点我第一版写反了"。把"必须有 URL"写成判据，只会逼那种节塞链接凑数 —— 那是目标第 1 条的反面 |

两条守卫：C1 区间解析不到 ⇒ 红；行解析出 0 行 / 节解析出 0 个 ⇒ 红（"覆盖数 0"在一张读空的表上长得和"全部已覆盖"一模一样）。

⚠️ **"未核实标记"只打印、不判**：现量 9 节里 **3 节**标了（`Q8` 5 处、`Q4` 1 处、`Q6` 1 处），
其余 6 节（`Q1`/`Q2`/`Q5`/`Q7`/`Q9~Q12`/`Q13`）0 处，而 0 处那几节是**结论全部一手到位**的合法形状。硬要每节都出现这三个字，等于要求作者为了过门去写一句假的话。
所以它进"逐节读数"、不进判据 —— 覆盖面可数，但不构成义务。

### 3. 读数（16:0x）

    取样：docs/research/detail-pane-alignment-and-spaced-review.md（C1 表 61 行区间）
    C1 行 13 行 ⇒ 有对照节 12 / 例外 1 / 未覆盖 0；C1b 节 9 个
      :341 C1b-Q1     覆盖=[1]      日期=1 URL=5  file:line=0  未核实标记=0
      :363 C1b-Q8     覆盖=[8]      日期=2 URL=4  file:line=0  未核实标记=5
      :389 C1b-Q2     覆盖=[2]      日期=3 URL=1  file:line=33 未核实标记=0
      :471 C1b-Q9~Q12 覆盖=[9,10,11,12] 日期=2 URL=8 file:line=0 未核实标记=0
      :499 C1b-Q4     覆盖=[4]      日期=2 URL=15 file:line=0  未核实标记=1
      :528 C1b-Q5     覆盖=[5]      日期=4 URL=9  file:line=2  未核实标记=0
      :562 C1b-Q6     覆盖=[6]      日期=3 URL=9  file:line=1  未核实标记=1
      :591 C1b-Q7     覆盖=[7]      日期=1 URL=0  file:line=1  未核实标记=0
      :617 C1b-Q13    覆盖=[13]     日期=2 URL=4  file:line=2  未核实标记=0
    例外：:269 #3 → 类别「不是要拍的值-已随工单落码」
    结论：C1 每一行要么有对照节、要么写明例外类别；每个对照节都有日期与出处 ✅   RC=0

（`C1b-Q7` 那一行是本节最有用的一条读数：**URL=0 而判据照样绿** —— 它就是腿 D 那个"择一"存在的理由被现量钉住的样子。）

### 4. 能不能失败：六臂 + 阳性对照（每臂断言"红/绿出现在指定的那一条"，不是只看退出码）

| 臂 | 注入 | 期望 | RC |
|---|---|---|---|
| M1 | 表里追加 `#14` 一行，没有对照节、没写理由 | 腿 A 红，且点名 `#14` | 1 |
| M2 | 同一行末尾加"已处理" | **仍红**（封闭词表），且例外档里不许出现 `#14 → 类别` | 1 |
| M3 | 同一行写明"已核，不需要拍" | 绿，且打印命中类别「已核-不需要拍」 | 0 |
| M4 | 把 `C1b-Q13` 标题的 `= C1 #13` 改成 `= C1 #99` | 腿 C 红（研究了不存在的题） | 1 |
| M5 | 把 `C1b-Q1` 节正文里的日期全换成"某日"、URL 全换成"（链接）" | 腿 D 红（缺日期或缺出处） | 1 |
| M6 | 一篇不含 C1 表的空文档 | 守卫红（拒绝报绿），不是"0 行全部覆盖"的绿 | 1 |
| 对照 | 真文档 | 全绿 | 0 |

M3 是**通道档**（证明例外不是永远红的门）；M6 是**反空读数档**。七条 7/7 按预期。

💥 **M2 第一趟"失败"失败在我的臂上，不是判据上**：我那条阴性断言写的是"输出里不许出现 `类别「`"，
而 `类别「` 本来就在**合法例外** `#3` 那一行里打印着 ⇒ 臂自己撞红。改成断言"`#14 → 类别` 不出现"（即指定那一行没被豁免）
之后按预期。这正是本线记过的那条：**阴性对照要指向指定的那个对象，不能指向一类字符串。**

### 5. 边界（别读多）

- 未挂 `pnpm check`：与 §8.58 同一条理由（根 `package.json` 正被并行会话改动），挂接留给合流那一轮。
- 它判的是**结构对账**（每行有没有对照节、每节有没有日期和出处），**不判调研质量**：
  一节里 URL 全指向同一篇博客、或者"别人怎么做"写得对不对，这条判据一个字都不知道。
  目标第 1 条的"一手/多来源"那半边仍然是**人工判读**，§8.58 那条边界同样的话在这里再说一遍。
- 默认只圈调研那一份文档。传参可以指别的文档 —— 但那要把 `## C1` / `### C1b-` 的标题约定一起带过去，
  不是一个通用文档框架。

## 8.60 四端重装的开工窗口：16:0x 现量 **负载这一格已经过了**，卡点换成了另外两格（2026-10-04 16:0x）

本单在 §8.10 那一批读数里记的是 `71.93 / 45.50 / 28.54`（04:58）和 `64.51 / 46.47 / 32.71`，
仓库自带负载门的阈值是 12（16 核）。刚才跑了一次权威读数的闸门（**默认 dry-run，只体检不执行**）：

    cd <主检出> && bash scripts/verify-mobile-window-gate.sh --target b
    ════ 1. 负载门（阈值 = hw.ncpu × 3/4）════
       现量：1 分钟负载 10，阈值 12（16 核）  ✅ 负载达标
    ════ 2. 工作树：有没有别人未提交的源码 ════
       ❌ 101 枚未提交的源码改动（这些会被打进产物，而判据看不出来）
    REDS=src,dev     RC=3（窗口没开：环境状态，不是产品失败）

**读法（这一格最重要）**：负载从 §8.10 那批的 60–72 落到现在的 **10**（门是 12）⇒
"等负载"这件事**已经不需要等了**，但窗口仍然没开，卡点换成了 `src`（主检出里另一个会话正压着 101 枚未提交源码）和 `dev`（设备被占）。
把"负载太高"当阻塞理由一路读下去是不对的 —— 这类前置是瞬时读数，
本仓库为同一件事写过"同一条『负载 16–35』在三小时内变成 73"（`scripts/verify-mobile-window-gate.sh:9`，方向是**变高**）。

闸门脚本自己给的处置我照抄在这里：**下一步不是继续等窗口** ——
`src` 那一格等它是零产出，而那 101 枚的主人随时可能醒过来动设备。
所以 #13 的正确开跑条件是：`REDS=` 里 `src` 与 `dev` 同时消失（即那批在飞的活被它的所有者提交、设备被释放），
**而不是**我拿一枚落后 main 的载体先把包装上 —— 那等于把已装产物降级，本单 §8.10 那批读数量的就是这个形状
（另一条会话的四端重装跑在 `/tmp/heyta-reinstall` 那棵隔离检出上，现量落后 main 20 笔）。

本单不代那批活提交、也不动别人的设备。下一轮要开跑前重跑这一条命令取现量，别引用本节这两个数。

## 8.61 合流面重取：带 marker 的文本文件现在是 **7** 枚，其中 habit 那对是**又回来了**（不是新长出来的）；顺带纠正 #13 的阻塞理由（2026-10-04 16:1x）

### 1. 现量（载体 `main × HEAD`，`TREE=a538420b`，16:1x）

    git rev-list --count HEAD..main ⇒ 落后 main **565** 笔   /   领先 **92** 笔
    合并面 **17 枚** = 二进制 10（evidence png）+ 文本 7（**逐枚都带 marker**）

🔴 **本节真正要记的是这件事：marker 集合不单调增长，它在来回变。** 同一批文件在三个时刻的组成是：

| 时刻 | 带 marker 的文本文件（枚数） |
|---|---|
| 14:2x（§8.52） | `main-area.css`、`docs/README.md`、`environment-traps.md`、`habit-actions.ts`、`habit-actions.spec.ts`（**5**，无 `App.tsx`、无本工单） |
| 15:2x（§8.55） | `App.tsx`、`main-area.css`、`docs/README.md`、本工单、`environment-traps.md`（**5**，habit 那对**不在**） |
| 16:1x（本节） | 上面 5 枚 **+ `habit-actions.ts` + `habit-actions.spec.ts`**（**7**） |

所以"5 涨到 7"这个说法**本身是误导**：habit 那对在 14:2x 就在、15:2x 消失、16:1x 又回来
（main 一直在动那两个文件，两侧改的行距是否重叠跟着变）。
⇒ "合流就绪账"任何一句话的保质期是**几十分钟**，§8.47 第 0 步那句"仍带 marker=0"的开工判据因此只能是现取，
不能引用本节这一行。

### 2. 七枚的逐枚分类（分类依据是 hunk 里实际的形状，不是印象）

| 文件 | hunk | 形状 | 档 |
|---|---|---|---|
| `apps/web/src/App.tsx` | 1 | 同一格里 main 侧是 `{detailHasRoom ? aiPanels : null}` + `ref={detailRef}`，HEAD 侧是 `{contentView === 'focus' ? <FocusDetailPane /> : null}`（无 ref） | 🔴 **要人**（§3f：AI 面与专注概览怎么共处；且 `ref` 那一半不许在合并时丢掉 —— 槽位判据靠它） |
| `apps/web/src/styles/app/main-area.css` | 2 | 两套页头规则：main 侧 `flex-wrap/flex-shrink/gap`，HEAD 侧那段注释写明"挤不下就折行，不压窄不裁" | 🔴 **要人**（§3c 页头许不许被压窄） |
| `docs/README.md` | 1 | ADR 索引表两侧各追加几行，共同行（`0043`）都在 | 机械：**并集 + 保持同序**（共同行贴错对象要逐行看） |
| `docs/plans/detail-pane-alignment.md` | 2 | 同一张 §8 状态表的行（main 侧还是 `W1b ⏸ 未开工`，HEAD 侧是 `🔄 进行中` 并多一行 `W1c`） | 机械：按**行键**取并集（§8.53 已逐行键比过） |
| `docs/reference/environment-traps.md` | 1 | 两侧各自向台账追加编号段：main 侧从 **#178** 起，HEAD 侧从 **#215** 起 | 规则型：**要续号**（#22 那条），不是纯并集 —— 同号不同事就是这枚会造出来的 |
| `packages/app-host/src/habit-actions.ts` | 1 | **只剩 import 列表**：main 侧 `byCreatedAtOrder, isLive`，HEAD 侧 `habitLogValue` | 机械（**并集**） |
| `packages/app-host/tests/habit-actions.spec.ts` | 1 | 两侧各在文件末尾 append 一个顶层 `describe`（main 侧 100 行"习惯进回收站"，HEAD 侧 119 行"打卡量 W6"） | ⚠️ 机械**但不是"拼接即可"**：见下面那段 |

🔴 **并集不是"保险起见都留着"**：三个符号在 import 块**之外**各有引用（现量 `habitLogValue` 4 次、
`byCreatedAtOrder` 3 次、`isLive` 2 次，各含 import 那一次）⇒ 任取一侧都会在 typecheck 上挂。
这条计数是**静态**的：它证明"少一侧会挂"，**不证明**"并起来一定绿"（那要跑）。

⚠️ 那一枚 spec 我这趟第一版写成了"顺序拼接"—— **那是 §8.47 第 3b 格在 14:06 已经否证过的说法**，
我把一个已修过的错重新犯了一次。16:1x 重新量的形状（正是那一格要求的"合流当时重新现取"）：

    main 侧 行数 100 括号差 +2
    HEAD 侧 行数 119 括号差 +2
    共享尾部 行数 3 括号差 −2   （就是 `  });` 与 `});` 两条）
    ⇒ 两块直接拼 = 整文件括号差 +2 ⇒ TS1005；正确处置仍是"在 ours 块之后补 2 条 `});` 再拼 theirs"
      （条数 = ours 块的括号差，不写死）
    ⚠️ main 侧块顶那行 `── 追加到 …habit-actions.spec.ts ──` 是**叙述残留、不是 marker**，要单独删（16:1x 仍在）。

**这一趟没有改变 3b 的处置，只是确认它还没过期** —— 两侧括号差仍是 +2/+2、尾部仍只闭合 2。

### 3. 🔴 #13（四端重装）的阻塞理由之前写错了

§8.60 刚写"负载门已过、现在卡 src+dev"。那是对的**读数**，但把它当成 #13 的前置是**错的因果**：

- 拿**本分支 tip** 打包 ⇒ 落后 main **565 笔**，装出来的就是 §8.10 量的那个"把已装产物降级"的形状；
- 拿**合并产物**打包 ⇒ 上面 7 枚还带 marker，产物**不能编译**（§8.56 已把这条钉成常驻探针），
  而 10 枚 png 冲突只能靠 §8.54 那 5 份 spec 重出。

⇒ **#13 的真实前置是"合流落地 + 截图重出"，不是"设备窗口开着"**。
窗口（`REDS=src,dev`）只是第二道，不是第一道。
之前几轮把 #13 写成"等窗口"，会让下一轮在窗口开的那一刻拿一枚 565 笔落后的载体去装 ——
那正好是全仓为它写过判据的那件事（AGENTS §7 第 27/82 条那一族）。

顺带一条：`App.tsx` 里 main 侧那半带了 `ref={detailRef}`，HEAD 侧没有 ——
合流时若把 HEAD 侧整块留下而丢掉 `ref`，§8.54 的槽位唯一性判据与 `detailHasRoom` 会同时失去载体。
这不是新担心，是 §3f 那句"ref 必须带上"的第三次重申，**因为它每次都在这个 hunk 的边上**。

## 8.62 目标第 2 条的核心主张在 16:1x 重跑了一遍："选中态跨视图通用"不是当年写完就完（载体 `9568e0d1`）

工单第 2 条要的是 W1 那一套**在任务/习惯/便签/清单/标签/回收站/时间线各处是同一个状态与同一套回落规则**，
不许只在任务视图实现一份。这句话此前只有落地当时（08:xx–14:xx 各趟）的读数撑着。
16:1x 在当前 tip 上原样重跑，四条都成立：

| 复跑对象 | 命令（都在本检出，用各包自己的 `.bin`，不在 worktree 装/构建） | 读数 |
|---|---|---|
| 常驻门禁 | `node scripts/check-selection-single-source.mjs` | RC=0，断言 A–H 全过：**词表 3 类全有消费者（task 10 / habit 7 / note 13）**、`宿主内本地选中态 0 处`、`选中态只有一个所有者：2 份实例（apps/web, apps/mobile）`、`接线声明 17 处全部用起来` |
| 规则层 | `packages/app-host` 里 `vitest run tests/selection.spec.ts` | **25 passed** |
| 宿主层（三种投影 + 键盘光标） | `apps/web` 里 `vitest run tests/task-selection.spec.tsx tests/quadrant-row-parity.spec.tsx tests/notes-view.spec.tsx tests/keyboard-cursor.spec.tsx` | **57 passed**（4 个文件：task-selection 16 / quadrant-row-parity 10 / notes-view 6 / keyboard-cursor 25） |
| 第三种投影（时间线） | `apps/web` 里 `vitest run tests/timeline-board.spec.tsx` | **23 passed**（第一版把这一行漏了，写成"三种投影"却只跑了两种 —— 是我这条表格自己的读多） |
| 触屏端单一所有者 | `apps/mobile` 里 `vitest run tests/selection-single-owner.spec.ts` | **14 passed** |

门禁那两行才是"跨视图"这四个字的证据：`2 份实例` 说的是**两端各自只有一份选中态**，
`宿主内本地选中态 0 处` 说的是没有任何视图自己又记了一个，`逐类读方数 task 2 / habit 2 / note 3`（断言 H）
说的是"谁读哪一类的选中"与"谁把那一类喂进回落"逐类对得上。
🔴 这三行**不证明**清单/标签也有选中态 —— 它们没有，而且断言 D 会在有人给它们接上选中而界面不存在时**报红**；
词表只有 3 类是刻意的（§8 的 W1 行记了理由）。把这一栏读成"六类实体都接到选中了"是读多。

### 这一趟顺手抓到一条手抄数字过期

§8 表 W1 那行写的是 "mobile 13 条"，现量 **14**。取代表链：`0815c4d5`（W1 收口）那趟是 13，
第 14 条由 `806fce49`（§8.43「任务屏也持有便签全集」）加进来，**那笔提交改了 spec 却没回头改这行**。
已在本行原地标注（13 保留为"那趟的读数"，旁边给现量命令），没有悄悄改成 14 ——
落地记录里的数字属于它那一趟，改它要留形状，不然读的人不知道当年到底几条。

⚠️ 同类风险还有：这一行里 `web 选中 16 条`、`quadrant 新增 2 条`、`timeline 新增 3 条`、`notes 新增 3 条`
四个数也都是当年手抄。16:1x 我只**逐文件复跑**了（57 passed 是四个文件的合计），
没有做"逐格重新对应到当年那条断言"的账 —— 那要逐格读测试名。谁要清这一格，
判据形状是"每个数字旁边放一条能打出它的命令"，不是"再抄一次新数字"（抄一次就再漂一次）。

## 8.63 §1 那四道前置闸门，对**本批这 5 笔**复验一遍（16:1x，载体 `2413546c`）

前面几节一直在给别人的读数补判据；这一节把判据指向本批自己 —— 因为"这批只是文档 + 新脚本"
这句话本身也是一条断言，而 §1 的四道门就是用来回答它的。

| 闸门 | 取数方式 | 读数 |
|---|---|---|
| 归属门（永远点名路径提交） | `git diff --name-only 8e5a3ff3..HEAD` | 本批 5 笔**总共只碰 4 个文件**：两份文档 + 两枚新脚本；`packages/` 与 `apps/` 命中数 **0** |
| 两道余量为 0 的棘轮不许调高基线 | `git diff … -- check-l4-no-style.mjs check-row-single-source.mjs` 行数 + 实跑 | diff **0 行**（基线常量没被碰）；实跑 `check:l4` RC=0（web 基线 104 / mobile 基线 90）、`check:row-single-source` RC=0（基线 28） |
| packages 改完先 build | 同上第一行 | 本批**没有** `packages/` 改动 ⇒ 这一道对本批是 N/A。写"跑了 build"反而是不实 |
| 干净检出复跑 | `git worktree add --detach /tmp/dp-clean-verify HEAD` → 在那里逐条跑 → `git worktree remove` | 干净检出里 `git status --porcelain` 条目数 **0**；**7 道**门禁全 RC=0：本批两枚新判据、`check:l4`、`check:row-single-source`、`check:selection-single-source`、`check:layering`、`check:ui-language`；另 `check:migrations` RC=0、`check:docs-voice` RC=0 |

🔴 **这一栏里最值钱的那条是 `docs-link-check` 在干净检出里仍然 RC=1**，而唯一的 offender 是
`PROGRESS.md:1362 → docs/research/aed-implementation-evidence.md`（输出里 `detail-pane-alignment` 命中 **0**）。
这正是登记过的那条"不归本单"的债：它**不是**我这台机器的状态造成的，目标文件在任何干净检出上都不存在。
在带别人未提交改动的工作树里跑，这条红看起来像"本机噪声"；在干净检出里跑，它是**确证的仓库事实**。
⇒ 处置仍然是不代改（那一行属于别的线），但**证据等级现在变了**，谁接手谁该按仓库事实对待它。

⚠️ 一处我自己的命令写法又踩了本仓记过的坑，记下来免得再犯：
`node <脚本> | tail -3; echo RC=$?` 取到的是 **`tail` 的退出码**（§7 第 45 条那一族），
第一趟那两道棘轮的"RC=0"因此是假的读数。改成 `node <脚本> > /tmp/x.txt 2>&1; echo $?` 之后才拿到真码。

**不 push、不 merge**：本批 5 笔提交、其中 merge **0** 笔；远端 `feat/detail-pane` 停在 `c14cfe30`，
本地 tip `2413546c`，未推送 98 笔 —— 全部留给明确要求的那一轮。

## 8.64 两枚判据加产物树模式并挂进合流预检 —— 过程中抓到的三个缺陷全在**我自己那枚判据**里（2026-10-04 16:4x）

### 1. 这一步要解决的是"消费者"，不是"再加一条判据"

§8.58（截图引用必须落位）与 §8.59（C1 ↔ C1b 对账）落下来之后，两道的消费者都只有**独立入口**
（人手动 `node scripts/...`）。目标第 4 条要求的是"§8 读数含截图路径"这件事**会自己守住下一次**，
而一条没人跑的判据守不住任何东西（元规则二）。`pnpm check` 那一份要动 root `package.json`
（别人在飞），所以先接的是**合流预检**：`scripts/verify-detail-pane-merge-preflight.mjs` 的 `GATES`。

载体条件是：预检跑在 `git archive` 解出来的裸目录里，**那里没有 git 索引**。
⇒ 两枚判据都加 `--root DIR`（产物树模式），档位由脚本自己打在输出第一行，不假装还在 git 模式。

### 2. 加 `--root` 那一趟，红的全是我自己的探针（四条，逐条记根因）

| # | 症状 | 根因 | 处置 | 现在由哪条臂守着 |
|---|---|---|---|---|
| ① | 输出写"图片文件 **2827** 枚" | 那是**全部跟踪文件**的数，标签在说谎（本判据只关图片） | 集合改成只留图片扩展名 | 读数第一行的枚数（250）与 `git ls-files -z` 现量可比 |
| ② | git 模式 222 枚，树模式遍历同一棵树 **250** 枚 | `core.quotePath=true`：含非 ASCII 的路径被输出成 `"…/row-tail-fold/01-通道-hover-展开态.png"` 这种带引号的转义形状 ⇒ 既不匹配 `.png$` 也匹配不上文档里的引用。**漏收不报错**，它只让"歧义判定"和"没入库判定"双双失灵 | 一律 `ls-files -z`（NUL 分隔、原始字节、不转义），并显式 `maxBuffer: 1<<28` | **A8**（把 `-z` 摘掉 ⇒ 报"集合不完整… 拒绝报绿"） |
| ③ | 我写的完整性守卫自己崩了（rc 129 + usage 文本） | 守卫用了**不存在的选项** `git ls-files --count` —— 按别的 CLI 的习惯猜了工具能力 | 改成对本判据真正依赖的那一片（`apps/web/evidence/`）做独立计数，与全量解析结果对账 | **A8** 同时覆盖（两种成因都撞它） |
| ④ | "引用 0 条"的假读数 | 空集合只**打印**了一句"集合为 0"，没计进退出码 ⇒ 一条永真判据；另一处是抽取形状用 ASCII 白名单，**28 枚中文名的证据文件整条看不见** | `(tracked.length===0?1:0)` 计进红；`TOKEN` 改成反向字符类（排除空白/反引号/竖线/花括号/逗号），逗号只在花括号内允许 | **A5**（0 条引用拒绿）+ **A7**（引用一枚中文路径 ⇒ 必须不红且引用数 +1） |

②和④是同一件事的两面：**探针的集合漏收，输出上长得和"文档干净"一模一样。**

### 3. 计数单位复量（并说明 §8.58 那几个数为什么变了）

```
node scripts/check-detail-pane-evidence-refs.mjs            RC=0
  集合来源：git 索引，图片文件 250 枚
  图片 token 40 个（其中 8 个是通配模式）⇒ 花括号展开后引用 57 条（全路径 44 / 简写 13）
  计数单位：引用 57 条 → 去重后指向 33 个位置，其中成立 33 个
node scripts/check-detail-pane-c1-coverage.mjs              RC=0
  C1 行 13 行 ⇒ 有对照节 12 / 例外 1 / 未覆盖 0；C1b 节 9 个
```

§8.58 那趟写的是 **38 token / 7 通配 / 引用 57（44 / 13）/ 提到后缀但不是引用 5 处**。
上面那趟是**改 `TOKEN` 之后、写本节之前**的复量：**引用那一半逐字没动**（57 / 44 / 13 / 33 全部成立），
动的只有"本就不该入账"那两档（通配 7→8、非引用 5→6），而两条新增都落在**同一行**——
本节下面那张表第 ② 行要描述 `quotePath` 把路径输出成什么形状，旧字符类看不见 `[A-Za-z0-9./-]`
里的方括号，那半句根本不构成 token；widened 之后它构成了 token，再按定义归进"通配模式 / 省略号缩略"。
⇒ **覆盖面变大体现在"未知"变小，而不是"已判"变大** —— 这是引用这组数唯一安全的说法。
（一条判据的读数换了，唯一合法理由就是这种；所以两边都写明是哪一趟、哪个载体：`9568e0d1` → `2413546c`+本批未提交。）

🔴 然后本节被自己的判据抓了一次，和 §8.58 第 3 节那次**同一形状**：第 ② 行初稿把反例照抄成字面路径
（一枚库里不存在的"中文名 png"），判据把它读成一条**简写引用** —— 前导引号让它不以 `apps/` 开头，
于是走简写分支、候选 0 个、报红：

```
🔴 简写引用无法唯一落到一个入库文件（0 个或歧义）（1 条）：
  docs/plans/detail-pane-alignment.md:4454  "…一段带引号的路径" —— 候选 0 个：无
```

处置照 §8.58 已定的那条走：**改写成"用哪一枚、不带后缀地指它"**（写成带省略号的形状 ⇒ 归"非引用"档、
打印入账），**不给判据开豁免**。改完的终读数：

```
图片 token 42 个（其中 8 个是通配模式）⇒ 花括号展开后引用 57 条（全路径 44 / 简写 13）
计数单位：引用 57 条 → 去重后指向 33 个位置，其中成立 33 个        RC=0
· 通配模式 8 个 / 提到后缀但不是引用 8 处（本节占 2 处，都在第 ② 行那一格）/ 库外绝对路径 0 个
```

⚠️ 这组数同样是**自指的**（本节既是判的对象又是"非引用"那一档的产地）：
引用它必须带上"16:4x、本节写完之后的那一趟"，不许当基线。

### 4. 臂固化成装置（§8.58/§8.59 那两趟是手敲的一次性命令，下一轮没人能原样重放）

- `research/tools/mutation-rigs/mutate-detail-pane-evidence-refs.mjs` ⇒ **11/11**
  （A1 悬空全路径 / A2 盘上有没入库 / A3 裸名撞同名 / A4 分组里的假成员 / A5 引用 0 条拒绿 /
  A6 花括号没闭合 / **A7 中文路径阳性臂（必须不红）** / **A8 集合守卫（必须响亮拒绝）** / 复位对照 / 基线对照）
- `research/tools/mutation-rigs/mutate-detail-pane-c1-coverage.mjs` ⇒ **10/10**
  （M1 无节的新行 / M2 词表外的理由 / M3 孤儿节 / M4 缺日期 / M5 缺两种出处 / M6 空表 /
  M7 文档不存在 / **M8 只给 `--root` 必须绿** / 两条对照）

两处装置层的花费，都值得记下来：

1. **A2 不许在检出里造未跟踪文件。** 最省事的写法是往 `apps/web/evidence/` 拷一枚临时 png ——
   而 AGENTS §6.1.1 写着 `reinstall-all.sh` 的 Windows 段送的就是"`git ls-files` + 未跟踪非忽略"，
   那枚临时文件会被当成源码送上打包机。装置改成 `git archive` + `git init` + `git add` 造一份**独立索引**的
   /tmp 副本，再 `git rm --cached` 一枚真被引用的 png ⇒ 仓库工作树、索引、别人的产物全程不动。
2. **M2 的第一版是装饰臂。** 那一行**同时命中两条词表分支**（`不是"要拍的值"` 与 `没有 C1b 对照节`），
   只抹掉一条它照样算例外 —— 症状是"臂没红"，而看起来像"判据没牙"。改成两条都抹 +
   断言**替换真的落了**；`withDoc` 加了一条通用守卫：变异若没改动文档就**抛错拒绝继续**
   （静默 0 命中的替换会让红的原因变成别的东西）。

### 5. 装置自己会不会失效（阳性对照）

把判据的失败求和阉成 `bad = 0`（结果永远 ✅、退出码永远 0）传进装置：
refs 装置报 **6/11 臂红**、c1 装置报 **5/10 臂红**（各自余下几条是守卫臂与阴性臂，它们本来就不该由这条腿触发）。
⇒ 这两台装置不是装饰。

### 6. 进 `GATES` 的第一趟：跑的是**提交态**的判据，不是工作树里的这一份

```
node scripts/verify-detail-pane-merge-preflight.mjs        PREFLIGHT_RC=1
⚠️ check-detail-pane-evidence-refs.mjs 候选=1 main=MISS  fatal: not a git repository
⚠️ check-detail-pane-c1-coverage.mjs   候选=1 main=MISS  fatal: not a git repository
（同趟其余：纯 fs 门禁 19 道，合并造成的红=1 = `check-selection-single-source`，
 两边都红=2 就是这两枚，静默合流 11 枚其中丢行/语法不过=0，槽位重复=0，
 台账同号不同事 2 组（215/216，续号起点 229、要 sweep 现量 15 行 / 27 处），
 产物仍带 marker 的产品文件 4 枚 ⇒ 本趟 tally 不算"合流验过"；TREE=26925154，冲突 17 枚）
```

原因不是判据坏了：**预检跑的是候选树里的脚本，而候选树来自 `git archive`（提交态）**。
本批的 `--root` 支持还没提交 ⇒ 树里那两份是旧版，收到 `--root` 也不认，转去问 `git rev-parse` 就 fatal。

📌 这和 §7 第 27 条（APK 里是旧 bundle）、§8.47 第 5 步是**同一个错的第四种面目**，
而且以前三种都在**产物**上，这一次落在**判据自身**上：任何"从提交态取材"的载体（merge-tree、
干净检出复跑、打包脚本、CI）用的都不是我正在编辑的那份文件。后果分两种 ——
产物那种是"验了旧代码"，判据这种是"**新判据在自己的第一次运行里假装自己不认参数**"。
后者更容易被读成"新判据有 bug"，所以我先把这一趟原样留着，提交后复跑，两趟读数都入账。

### 7. 两种模式各答各的题（别读多）

| 模式 | 集合来自 | 能回答 | 不能回答 |
|---|---|---|---|
| git（默认） | `ls-files -z`（索引） | "本机有、仓库没跟踪"（干净检出上这条引用会悬空） | 合流那一刻的产物状态 |
| `--root` 树 | 目录遍历（archive 只放树内文件） | "引用一枚从没提交过的截图" ⇒ 树里没有 ⇒ 红 —— **恰好是合流要问的那件事** | "本机有但没 `add`"这一半（树里"存在"即"被跟踪"） |

所以两枚判据在 `pnpm check`（工作树）与合流预检（提交态树）里各跑各的，不是同一道题跑两遍。

**状态：已完成。** 判据两枚 + 装置两台 + `GATES` 挂载已落码；#23 也已做掉 ⇒ 本条没有留开口。
（16:5x 那一版这里写的是"**进行中**"，因为它下面挂着 #23 那一格；那句话原文留着：）
待办 #23（挂进 `pnpm check`）曾经"仍然开着 —— 那要动 root `package.json`，在别人手里"。
🔴 **（18:1x 更正：#23 已做掉，三枚别名当场进链 —— 那句"在别人手里"把两件事捏成了一件，量法见 §8.73。）**

## 8.65 提交后复跑合流预检：两枚判据在候选树上都是绿的，而这一趟**顺带证明了合并没把引用合坏**（2026-10-04 16:4x，载体 `9d0a15fa`）

§8.64 第 6 节那条"预检跑的是提交态"的现象，提交之后自己消失了 —— 这就是复跑要拿的东西：

```
node scripts/verify-detail-pane-merge-preflight.mjs        PREFLIGHT_RC=1（不是这两枚造成的）
·  check-detail-pane-evidence-refs.mjs 候选=0 main=MISS  结论：本线文档每条截图引用都落在一枚合并产物树里的文件上 ✅
·  check-detail-pane-c1-coverage.mjs   候选=0 main=MISS  结论：C1 每一行要么有对照节、要么写明例外类别；每个对照节都有日期与出处 ✅
TREE=5b426930  冲突 17 枚  纯 fs 门禁 19 道：合并造成的红=1（`check-selection-single-source`）
两边都红=**0**（上一趟是 2，就是这两枚）  静默合流 11 枚其中丢行/语法不过=0  槽位重复=0
台账同号不同事 🔴 2 组（215/216，续号起点 229、要 sweep 现量 15 行 / 27 处）  产物仍带 marker 的产品文件 4 枚
```

三条读数要分开看，别合成一句：

1. **`main=MISS` 不是红。** 那两个脚本只存在于本线，main 那棵对照树里没有 —— 预检按定义把它记成
   "这一趟没有 A/B 对照"，不记成"合并造成的红"。所以这两行旁边的 `·` 是对的。
2. **候选=0 证明的是引用落位，不证明文档没有待裁决段落。** 同一趟明确打着"产物仍带 marker 的产品文件 4 枚
   ⇒ 本趟 tally 不算合流验过"（`docs/plans/detail-pane-alignment.md` 自己就在 marker 清单里）。
   两件事不冲突：合并把两边的截图引用拼进同一篇文档之后**每一条都还落在树内的文件上**，
   而冲突裁决本身没做。前一句是这两枚判据的射程，后一句是它的边界。
3. **合并造成的红仍然只有 1 条**，这两枚文档判据没有新增红。预检把那行截到 58 字符，只看得到
   `✗ 选中态的所有者不唯一：`，所以我把候选树（`5b426930`）另解一份、直接跑那一门补全读数：

   ```
   断言 G：宿主里有 2 处本地 `…Id` useState 没有语义登记：
     apps/web/src/features/trash/TrashView.tsx  busyId
     apps/mobile/src/screens/TrashScreen.tsx  busyId
   ```

   也就是 §8.36 记过、挂在**待办 #16** 的那两行豁免 —— 不是新问题，也不是这两枚判据造成的。
   📌 顺带一条可复用的：预检表格里 `line` 是被截断的摘要，**要拿全读数就自己 `git archive` 那一枚
   树号再直接跑那一道门禁**，别把摘要当成结论。

📌 这一步真正买到的东西，用一句话能说清：**目标第 4 条那句"§8 读数含截图路径"现在有了两个自动消费者**
（合流预检 + 独立入口），而"合并会把两边各自新写的引用拼进同一篇文档"这种红，
只有在候选树上跑才看得见 —— 在各自的检出里两边都不会红。
挂在 `pnpm check` 上那一份（待办 #23）仍然是开的：那要动 root `package.json`，在主检出里恒为 ` M`。

## 8.66 设备窗口现量：`REDS=src,dev`，而 `dev` 那一条的**诊断词要更正** —— `--wait` 状态下 CPU≈0 是正常形态（2026-10-04 16:4x）

#13/#17 还等这一格，所以重跑了一次窗口闸门（dry-run，不带 `--confirm`；载体：主检出 `scripts/verify-mobile-window-gate.sh`，**本分支没有这把脚本**，见下面边界）：

```
bash scripts/verify-mobile-window-gate.sh --target b      WINDOW_RC=3（环境状态，不是产品失败）
REDS=src,dev
  · src：并行会话的未提交源码
  · dev：另一趟 reinstall-all 在跑（父 pid=93817 → 95477 `package-app.sh` → 98934 `notarytool submit … --wait`）
```

父进程与叶子都现量确认过：

```
ps -p 93817  13:34:59  bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817
ps -p 98934  13:34:02  0:00.03  notarytool submit /tmp/heyta-macos-dist/Heyta-1.0.0.dmg … --wait
```

🔴 **但那句"很可能已经楔住"的取证是不够的，我按现量更正它的解释**：命令行里**确实带着 `--wait`**
（`ps … | grep -c -- '--wait'` ⇒ 1）。`notarytool --wait` 是**轮询式等待**：客户端大部分时间在 sleep，
累计 CPU `0:00.03` 跑了 13.5 小时**正是它在等的样子**，不是它卡住的证据。
⇒ 这条判据用的是 `etime 大 + CPU≈0 ⇒ 楔住`，而它没能区分"正在等远端"与"自己卡死"这两种形态 ——
按 §7 元规则一，那属于**探针够不着**，报出来的词要比现在弱一档（"这趟还在占设备面，未知是否终会完成"）。

处置与边界，都按不越界写：

- **不动它**（那是别的会话的进程，杀/接管都不是本线的权限）。本线只因此继续把 #13/#17 记为受阻。
- **不代改那把脚本**：它在主检出里是未跟踪文件、正被它的所有者用；我这棵树里也没有它（`git ls-files scripts | grep window-gate` ⇒ 空）。
  要更正的那一句是**输出措辞与判据强度**，改动应由所有者做 —— 这里登记成一条待认领，附现量与复现命令。
- ⚠️ 这条不是"窗口什么时候能开"的新前置：`src` 那条（并行未提交源码）与合流落地是同一件事，#13 的真实前置仍是 §8.61 写的那两条。

## 8.67 §8 落地记录表**被自己的单元格截断了**（W1b 以后 15 枚工单行不在表里）—— 修掉，并把这张表钉成一条能失败的判据（2026-10-04 16:5x）

### 1. 怎么发现的（不是设计出来的，是数出来的）

要给 §8 那张表补一条"每行都得有截图路径"的判据，就先数它有几行 —— `| 单 | 状态 | 读数` 之后**只认出 2 枚工单行**。
现量是：W1 那一格把 19 行 prose（含一个 bash 围栏）写在了表格单元里，
而 GFM 的表格遇到第一行非表格文本就结束 ⇒ 表在 W1 处截断，W1b…W12 这 15 行**渲染成正文里的裸竖线**。
后果不是难看：那张表是目标第 4 条的交付物，而"状态写成什么、有没有截图"在截断之后**没有任何东西在看**
（死链门禁 `docs-link-check` 也看不见，它把行内代码整段抹成空格）。

### 2. 修的是什么

| 动作 | 内容 |
|---|---|
| 搬出 | W1 之后那 20 行 prose **一字未动**地搬到表格之后，加一句"为什么搬"（表格单元不许有块级内容） |
| 补闭合 | W1 那一行原来没有闭合竖线（收尾的 `\|` 落在那 20 行的最后一行上）⇒ 补回行尾 |
| 去空行 | 表区间内 3 处空行（同样会截断表格）删掉 |
| 化石 | 搬出块末尾那枚"围栏后再挂一个竖线"改成正常闭合的围栏 |

搬动用一次性脚本做（逐行 splice），脚本自带**四道前置断言**：块首行必须是预期的那一条、
认得出 W12、搬完后表区间内每行都以 `|` 开头、**原文本里任何一行都不许多也不许少**。
📌 前两次试跑都是断言拦下来的：一次把 W1 整行当成要搬走的 prose（块首行对不上），
一次把文档后面另一张表的 `| W12 |` 当成表尾（扫过了头）。**"改文档"的脚本没有断言，就等于没有刹车。**

### 3. 新判据 `scripts/check-detail-pane-status-table.mjs`：五条腿

| 腿 | 判什么 | 钉住的是目标第 4 条的哪半句 |
|---|---|---|
| 1 | 每枚数据行必须有闭合竖线 | "回填"这件事的形状（行被拆开 / 正在往外漏） |
| 2 | 状态那一格必须命中封闭三档 `已完成 / 进行中 / 未开工` | **"状态只允许…，不许写基本完成"**（这条禁词第一次有机器消费者） |
| 3 | 工单 id 不许重复 | 一单记两次 / 另一单没记 |
| 4 | 写了「截图」的行必须真带图片引用（或写明 `无界面格`） | "读数含…截图路径" |
| 5 | 表外不许有孤儿工单行（前一行不是表格行 ⇒ 表被截断） | 这次的事故形状本身 |

🔴 **上面 4 与 5 两行是 16:5x 那一版的定义，两条都已被现量改掉，以本段为准**：
腿 4 的触发词从只认"截图"扩到**一切指图措辞**（`截图/看图/逐张/张图/人眼复核`），因为 §4 的原话是
"必须截图**且人看图**"，只认一个字时下一轮换措辞就把那格移出射程（**§8.71**，臂 N4/N5）；
腿 5 从"前一行不是表格行"改成**按分隔行判**，因为旧写法对一整段掉出来的行只点最前面那一枚，
而按状态词筛那一版又漏掉状态不合规的那一枚（**§8.68 §2**，臂 S8/S9/S10）。
本条 §3 下面那段读数（16:5x）是**当时的输出**，不改 —— 它打的是"五项都成立"，现在打的是六项。
腿 6（已开工的行必须记到变异那一层）是 **§8.69** 加的。

读数（16:5x，本检出）：

```
node scripts/check-detail-pane-status-table.mjs            RC=0
  表区间：第 134 行起，连续 16 枚工单行，列结构 = 单/状态/读数
  逐行读数：W0=已完成 W1=进行中(图✓) W1b=进行中(图✓) W1c=已完成 W2=进行中(图✓) W3=进行中(图✓) W4=进行中(图✓) …
  结论：§8 落地记录表的行闭合、状态词表、id 唯一、截图栏位、表连续性五项都成立 ✅
```

### 4. 这条判据自己是怎么写错的（三处，全部由它自己的臂抓出来）

| 我第一版的写法 | 臂/现量的结果 | 改成什么 |
|---|---|---|
| 判"列数等于表头" | 同一批行先读出 7 列、掩码改对后又读出 2/4/5/4 列 —— 本表读数栏**合法地**出现竖线（`ps … \| grep …`、`a \| b` 式并排列），要靠反引号配对去认，而那个掩码在这种行上会漂 | **撤掉这条腿**，换成"必须有闭合竖线"：一条在它的样本上说不清对错的判据不该用来拦事 |
| 状态取"整行里最早命中的词" | 臂 S2 存活：抹掉「进行中」之后照样绿，因为它读到了同一格后面那句"还不算已完成" | 只取**状态那一格**（单号之后、到第一个 `（` 或下一个 `\|` 为止） |
| 孤儿行豁免"前一行为空" | 臂 S5 存活：插一行普通文字进去都不红（插的就是"文字 + 空行 + 原行"） | 去掉豁免 —— GFM 里空行就是表格的结束，紧跟空行的 `\| W…` 行本来就渲染成正文 |

📌 这三处是同一个病的三个面：**判据写得比样本能证明的更强**。
如果只写判据不写臂，这三条都会以"绿"的样子长期存在（§4 的验收动作要求臂，理由就在这一格）。

### 5. 臂装置与它的防呆对照

`research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs` ⇒ **9/9**
（S1 未闭合 / S2 基本完成 / S3 重复 id / S4 说看过截图却没路径 / S5 事故复现 /
S6 表头没了必须响亮失败 / S7 只给 `--root` 的产物树模式 / 两条对照）。
两处细节：

- **S4 的靶是现选的**（挑第一枚"既写截图又带引用"的行），不写死单号 —— 写死单号时文档一改就静默变成空变异臂；
  `mutate()` 还带一条"变异必须真的改动文档"的通用守卫。
- **防呆对照**：把判据的失败求和阉成 `bad = 0 * (…)` 传进装置 ⇒ **5/9 臂报红**。
  S6/S7 仍过（它们测的是"响亮失败"那两道守卫，阉的不是它们）—— 这个差额是装置读数的诚实部分，别报成"全部抓住"。

### 6. 顺带查出来的两条真缺陷

1. **W2 那一格写着「八张图逐张看过」而没有任何入库产物。** 现量：该格只有 `apps/web/evidence/detail-column-slot/`
   这一族，而目录里**只有 3 枚** png。已把这 3 枚逐条写进那一格，并按原文写明
   "八张"是 09:5x 那趟的**看图数**、其余几张**没有入库产物可对应（未核实它们在哪儿）**，
   不拿"八张"当证据。这正是腿 4 存在的理由：**断言只会验界面写了什么，不会验界面少了什么**。
   补完之后 §8.58 那道的读数（16:5x 同趟）：`图片 token 43 个（其中 8 个是通配模式）⇒ 花括号展开后引用 60 条
   （全路径 47 / 简写 13）→ 去重后指向 33 个位置，其中成立 33 个`，RC=0。
   对照 §8.64 记的那趟（57 条 / 全路径 44）：差的 3 条就是这里补进去的三枚 —— **数变了的原因是文档真多写了三枚引用**，
   不是抽取形状变了（这两种"读数变化"必须分清，后者在本节 §4 那三处里出现过）。
2. **`| 单 | 处置 |` 那张交付对账表（§9 附近）此前也在扫描范围内被误判**（第一版把它的 8 行报成孤儿行）。
   已按"前一行的形状"重定义孤儿，并在臂里保留这条反例 —— 它是判据过严的那一类，不是文档的错。

### 7. 消费者

三枚文档判据（§8.58 / §8.59 / 本条）现在都挂进了合流预检 `scripts/verify-detail-pane-merge-preflight.mjs`
的 `GATES`（走 `--root` 产物树模式），`pnpm check` 那一份仍是待办 #23（要动 root `package.json`，在别人手里）。

**状态：进行中。** 本条这一单（表 + 判据 + 装置 + 挂载）已完成；#5/#7/#8/#9/#10/#11 那六单未闭合的那一格仍是 §6.1.1 的四端重装。

## 8.68 三枚文档判据挂进合流预检之后的**第一趟有内容的红**：main 把修表之前的 13 行旧抄件带回来了（2026-10-04 17:0x）

§8.67 §7 那句"三枚文档判据现在都挂进了合流预检的 `GATES`"当时只是**主张**（写了挂载，没有挂载后的读数）。
本条是那趟读数，以及它顺手照出来的**两个各自独立的缺陷 —— 一个在判据里，一个在载体里**。

### 1. 四趟读数（同一批脚本，四种产物形状）

| 趟 | 载体 | 产物树 | `status-table` 那一行 | 分档 | RC |
|---|---|---|---|---|---|
| A | `41828f03` | `625cc5f5` | `⚠️ 候选=1 main=MISS`，只点名 **1 枚** | 被算进"两边都红（不含合并信息）" | 1 |
| B | 同上（改了载体分档之后） | `625cc5f5` | `🔴 候选=1 main=MISS` | 新档"候选红但 main 侧没有这道脚本"=1，"两边都红"=0 | 1 |
| C | 同上 + `--product`（手工把对面那 13 行丢掉） | 同一棵树处置过 | `· 候选=0 main=MISS` | 新档=0 | 1（仍因 `check-selection-single-source`，即待办 #16） |
| D | `96ca7892`（判据修订提交后复跑） | `9e7b2ccb` | `🔴 候选=1 main=MISS`，**逐枚点名 13 行**（产物第 175–187 行） | 新档=1 | 1 |

C 与 D 是两条腿：**C 证明这一档会归零**（红不是载体所致，也不是判据读不到东西），
**D 证明它读的是当前提交的判据**。只有 D 就说不清"是不是任何处置都摘不掉"，只有 C 就是在验一份
临时目录里的私货。合流时该做的处置已登记成 **§8.16 §4** 那张「合流时才消得掉的**不归本单**清单」的 **⑦**
（那张清单在本篇靠前的位置，不在本节末）。

### 2. 缺陷一（判据）：孤儿腿原来只报边界那一枚，而"按状态词筛"这一版又被现量否证

`check-detail-pane-status-table` 原来的腿 5 写的是"`| W…` 开头且**前一行不是表格行**"。
产物里对面那一整段 13 行**彼此相邻**，于是只有最前面那一枚被点名 —— 红是红了，但它把一个整段的
旧抄件说成"有一行掉出去了"。中途换了一版"**状态格里得带着三档状态词**"，
它被 `| W10 | ⏸ 不在本篇开工 |` 当场否证：那一枚的措辞**不在封闭三档里**，
腿 2 只扫表区间看不见它，腿 5 按状态词又筛不到 —— 两个条件各自合理，合起来让一枚**不合规的状态
完全没有消费者**。这正是"越不合规越不容易被注意到"的形状。
最终判据用**分隔行**（`|---|---|`）：一段连续竖线行里没有任何分隔行 ⇒ 那一段在 GFM 里不是表 ⇒
其中的 `| W…` 行逐枚点名。分隔行不看内容，所以状态措辞怎么写都拦得住。

另一条假红边界在改之前先量了：本篇后面还有一张「单 → 落到哪一步」表，它的行**同样**以 `| W…` 开头
（现量 6 行，含 `| W0、W8a |` 这种一行两个号），只按形状判会把它们全报成孤儿。
它们带着自己的分隔行，所以新判据下不红 —— HEAD 工作树复跑 **0 枚**就是这条边界的读数。

### 3. 缺陷二（载体）：`'MISS' !== 0` 为真

`verify-detail-pane-merge-preflight` 用 `b.rc !== 0` 分"两边都红"，而对照组里**没有这个脚本**时
`runOne` 回的是字符串 `'MISS'`。后果是三重的：本分支新增的门禁在产物里变红时 ——
① 被并进"环境/载体所致，**不含合并信息**"（这句恰好说反了：一侧没有这道脚本、另一侧我们量过是绿的，
那这个红**只能**来自合并）；② 只打 ⚠️；③ **不计入退出码**。
也就是说这三枚文档判据虽然"挂进了 GATES"，它们**在唯一会用到它们的场合**是没有消费者的。
现在单列一档（`候选红但 main 侧没有这道脚本（本分支新增，只能拿本分支读数定性）`）、打 🔴、计入退出码，
并且把门禁**全文**打出来 —— 原来只留最后一行 58 字节，读的人得自己重铺一份产物树才知道红在哪几行，
而那些红正是"要人裁决"的那一档。

### 4. 装置：12/12 + 脱牙对照

`research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs` 加了三条臂（编号接在 S7 后）：

- **S8** 表外插一张**带分隔行**的合法小表，行里状态写"⏸ 暂缓"（三档之外）⇒ 整份必须仍绿、
  孤儿腿 0 条。这条挡假红 —— **§8.16 §4** 那张「单 → 落到哪一步」表在本篇里**真实存在**（6 行以 `| W…` 开头），
  S8 就是它在臂表里的替身：判据不许把"带分隔行的第二张表"读成孤儿。
- **S9** 同一张表**去掉分隔行** ⇒ 同一枚行必须点名。这条证明腿 5 读的是**分隔行**，
  不是状态词 —— 没有它，"按状态词筛"那一版照样能过其余所有臂。
- **S10** 表外一段两行（一合规一不合规）⇒ 两行都点名。
- **S5**（事故复现那条）从"红就行"改成断言 **点名数 = 基线行数 − 2、表只剩 2 行、最后一枚 `W12` 在名单里**。
  原来的写法只要求"表格读数只剩 2 枚"，于是判据退化到只报 1 行它也认。

读数：**12/12 臂符合预期**（基线连续 16 枚工单行）。脱牙对照：把 `bad` 里的 `orphans.length` 乘 0 再跑同一套臂
⇒ 恰好 **S5 / S9 / S10 三条**报"RC=0（判据没红）"，其余臂不受影响 —— 这三条臂确实挂在那条腿上。

判据在四种形状上的现量（复跑命令见下）：HEAD 工作树 **0 枚 / RC=0**；候选树 **13 枚 / RC=1**；
main 单侧 **14 枚 / RC=1**（13 孤儿 + `| W1 |` 那一行未闭合 —— 就是 §8.67 那次事故的原始形状）；
手工处置过的产物 **0 枚 / RC=0**。

```bash
node scripts/check-detail-pane-status-table.mjs                      # 本检出
git show main:docs/plans/detail-pane-alignment.md > /tmp/main-doc.md
node scripts/check-detail-pane-status-table.mjs /tmp/main-doc.md      # 对面单侧
node scripts/verify-detail-pane-merge-preflight.mjs                   # 产物树（本条的 A/B/D）
node scripts/verify-detail-pane-merge-preflight.mjs --product <处置过的目录>   # C
node research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs
```

### 5. 边界（别读多）

- 这一趟**仍不算"合流验过"**：产物里还有 4 枚产品源码/样式带 marker（预检自己把这句打在结论旁边），
  台账的同号不同事 2 组、`check-selection-single-source` 的合并红各归 #22 / #20 / #16。
- 腿 5 有一条**实测接不住**的形状：一枚掉出来的行如果**正好贴在另一张真表的末尾**，它会跟着那张表的分隔行
  被当成合法。2026-10-04 17:2x 现量：把 `| W7 | ✅ 已完成 | …` 插到 §8.16 §4 那张表的最后一行之后
  ⇒ 判据 **RC=0**（腿 3 只扫表区间，看不见别的表里的同名 id）。
  原来这一条写的是"那种情形由腿 3 接住"，**那句是错的，已撤回**。
  为什么不补一条腿去接它：要让"区间外的重复 id"变红，就得同时要求那一格带着状态词 ——
  而 §8.16 §4 那张表的合法行今天写的正是"做掉/改挂"，**改天谁在那一格写"已完成"就成假红**。
  一条在它自己的样本上说不清对错的判据不该用来拦事（同 §8.67 里被撤掉的"列数等于表头"那条）。
  复现形状：把 `| W<已在表区间出现过的号> | ✅ 已完成 | x |` 插到 §8.16 §4 那张表的**最后一行之后**
  （让它成为那一段连续竖线行的一员），再跑 `node scripts/check-detail-pane-status-table.mjs <那份文档>` ⇒ RC=0。
  这一条也写进了判据文件的注释里，代码与文档说的是同一件事。
- 三枚文档判据进 `pnpm check` 仍然是待办 **#23**（要动 root `package.json`，现在在别人手里）。

**状态：进行中。** 本条（四趟读数 + 判据修订 + 载体修订 + 三条臂 + ⑦ 的登记）已完成；
#5/#7/#8/#9/#10/#11 那六单未闭合的那一格仍是 §6.1.1 的四端重装（待办 **#13**，前置是合流落地）。

### 6. §1 那道"干净检出复跑"，对**本条这几笔**（`96ca7892` / `da28773f` / `f1671f3f`）现量

载体：`git archive HEAD | tar -x`（HEAD = `f1671f3f`，无索引、无 node_modules）⇒ 只跑纯 fs 那一批：

| 脚本 | 干净检出 RC |
|---|---|
| `check-detail-pane-status-table.mjs` | 0 |
| `check-detail-pane-evidence-refs.mjs`（**必须带 `--root`**） | 0 |
| `check-detail-pane-c1-coverage.mjs` | 0 |
| `check-selection-single-source.mjs` | 0 |
| `check-l4-no-style.mjs`（mobile 90 = 基线，没调） | 0 |
| `check-row-single-source.mjs`（28 = 基线，没调） | 0 |
| `check-ui-language.mjs` | 0 |

⚠️ 第一趟我在 `evidence-refs` 那一行**没传 `--root`**（那批命令是我用 `[ ] && echo` 现拼的，展开成了空串），
于是它在非 git 的裸树里以 git 模式跑并回了 **1** —— 那是探针够不着载体，不是产物红（同一趟带 `--root`
复跑 = 0，图片 token 43 / 引用 60 / 位置 33 全部成立）。**这条要记住**：非 git 载体上这一道只有
`--root` 一档，预检里那三枚走的就是这一档（§8.64）。

`#23`（把三枚文档判据挂进 `pnpm check`）当时判为"不能做"，现量原因是**主检出的 root `package.json` 此刻是 `M`**
（2026-10-04 17:2x `git status --porcelain -- package.json` ⇒ `M package.json`，最后一次提交是别人的
`39c4ce47`）。这条不写"等它干净"就完事 —— **它是一个瞬时读数**，下一趟要动它得重新现量，
理由与 §9 那条"脏清单每次都要重新现量"相同。
🔴 **18:1x 更正：上面那句"不能做"作废，#23 当场做掉了。** 错法不是那个读数（`M` 是真的），
而是我从它推出来的结论 —— 在我这棵树提交自己的 `package.json` **碰不到**别人的工作树，
两边只在合流那一刻相遇，真实代价是"合流多出一枚冲突文件"，不是"改了别人在飞的活"。
代价的量法（拿 main 自己那条 `check:gate-wiring` 的 `--pkg`/`--root` 旋钮跑对照）与合流时的并集处置规则见 §8.73。

## 8.69 目标第 4 条那句"读数含**变异臂红集**"第一次有了机器消费者（腿 6）—— 一条豁免词把自己藏住的洞，是臂 N3 照出来的（2026-10-04 17:3x，载体 `57e80685`）

§8.67 把表钉成判据时留了一句没做的事：那张判据管的是**形状**（行闭合 / 状态词表 / id 唯一 / 截图引用 / 表外无段），
而目标第 4 条要求的是**内容** —— "读数含判据条数、变异臂红集、截图路径"。三条里截图那条早就有腿 4，
"变异"这一条**全仓没有任何东西在看**：一枚单可以被标成"已完成"而那一格只写覆盖面。
本条补上腿 6：状态不是"未开工"的行，读数里必须出现变异相关字样，或写明 `无变异面：<理由>`。

判"有没有提"而不是"提了几条"（写死数字就是另一份会漂的抄件，同 §8.67 撤掉"列数等于表头"那条的理由）。

### 1. 三个缺陷，全部由我自己的臂照出来

| # | 缺陷 | 症状 | 修法 |
|---|---|---|---|
| ① | **豁免词自己含"变异"** —— `无变异面` 这五个字里就有 needle | 只写光秃秃一个豁免词（不给理由）也照样放行 ⇒ 豁免档变成空白通行证 | 判 needle 之前先把 `无变异面` 从该行挖掉；理由由 `EXC = /无变异面[：:][^\|]{4,}/` 要求 |
| ② | 臂把尾巴接在**闭合竖线之外** | N2 报 `RC=1`、N3 的"别的腿"里出现 `unclosed:1` —— 红落在腿 1，腿 6 根本没被量到 | `withTail` 改成在行尾 `\|` **之内**插入 |
| ③ | 我的一次性审计探针只测 `变异` 一个词形 | 据它点名 W1c 那一格"没记变异读数"，并把这句写进了判据注释 | 逐行现量否证：那一格写的是"四处面 + 九臂见 **§8.37**"。注释已原地改写，词形按表里真实存在的三种写法认（"变异 22 臂全红"／"九臂见 §8.37"／"H 组臂"） |

③ 是本条里最贵的一条：**它是一次"用自己的探针点名别人（这里是没有主的『我上一轮的记录』）"**，
而探针的词形覆盖不足。表里的合法记法有三种形状，只匹配其中一种就会把另外两种读成缺件 ——
与 §7 元规则第 1 条同族，新的是它的方向：**点名别人缺件之前，先数被点名那一格真实的写法有几种**。

### 2. 读数

- 判据在**当前文档**上 `RC=0`：16 枚工单行里每一枚已开工的行都带着变异字样，**没有一行需要动用豁免词**
  （这一点要写明 —— 否则下一轮会以为豁免档已经在用）。
- 装置 `research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs`：**15/15 臂符合预期**
  （N1 换词 ⇒ 恰好点名那一枚；N2 豁免词+理由 ⇒ 放过；N3 只给豁免词不给理由 ⇒ 仍红）。
- 脱牙对照：`bad` 里把 `mutMissing.length` 乘 0 重跑同一套臂 ⇒ 恰好 **N1 与 N3** 报"判据没红"（`2/15 臂不合格`），
  N2 作为断言绿的对照不受影响 —— 那两条臂确实挂在腿 6 上。
- 复跑：
  `node scripts/check-detail-pane-status-table.mjs && node research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs`

### 3. 边界（别读多）

- 腿 6 判的是"**提没提**变异"，不是"做了没有"。一行写"变异：无"也会被放过 ——
  文本判据到这一层为止，再往里就得读代码。写在这里是为了别把它读成"变异做没做有门禁管"。
- 判据条数（"多少条用例"）没有做成腿：各单的单位不同（条 / passed / 步 / 臂），
  任何统一形状都会把某一类读成缺件。这一格仍由评审看。

**状态：已完成。**（本条这一单：判据 + 三条臂 + 脱牙对照 + 三处自己缺陷的当场修正与撤回。
腿 6 也走 `--root` 产物树模式，已在合流预检的 `TREE_ROOT_GATES` 里，无需再挂。）

## 8.70 给载体自己补回归臂，结果它当场照出**修法里第二次同一个字符串坑**（2026-10-04 17:4x，载体 `scripts/verify-detail-pane-merge-preflight.mjs` + 新装置）

§8.68 把 `'MISS'` 那一档分出来之后，"预检怎么分档"这件事本身没有回归测试 —— 也就是说**修好的那个形状可以被人一行改回去而无人报错**。
补装置 `research/tools/mutation-rigs/mutate-detail-pane-merge-preflight.mjs`（默认零写盘到仓库，只在 `/tmp` 铺产物树），四条臂：

| 臂 | 断的是什么 | 现量 |
|---|---|---|
| P1 | 未处置候选树 ⇒ 红落"没有对照组"那一档、那一行打 🔴、且**产物里不缺脚本** | `没有对照组=1 两边都红=0 产物缺脚本=0` ✅ |
| P2 | 把对面那批旧抄件丢掉（= ⑦ 那一步）⇒ 同一档**归零** | `处置前 1 → 处置后 0（丢掉 13 行，从第 175 行起）` ✅ |
| P3 | `--a main --b main` 的对照趟 ⇒ 不许有"合并造成的红"、不许有"候选红但缺对照"，而**必须**报"产物里没这些脚本" | `合并=0 无对照=0 产物缺脚本=3` ✅ |
| P4 | P1 那枚红带着门禁全文（不是探针故障） | `全文命中 表外的孤儿工单行=true` ✅ |

P1/P2 是**成对**的：只有 P1 就不知道那一档是不是恒红（装饰），只有 P2 就不知道它会不会响。

### 1. P3 一跑就把我刚写下的修法打回了一遍

第一版修法只防了**对照组**那一侧的 `'MISS'`：`noControl = p.rc !== 0 && b.rc === 'MISS'`。
可 `runOne` 在**产物**没有这个脚本时回的同样是 `'MISS'`，而 `'MISS' !== 0` 为真 ——
于是 `--a main --b main` 这一趟（两侧都是 main、main 还没有本线那三枚判据）报出 `无对照=3`：
**三道压根没跑的判据被算成三条红**。这跟 §8.68 修掉的是同一个字符串坑，只是换了一侧，
而且是我在写"判档要用类型而不是不等于 0"这句注释的**同一次提交**里又犯了一次。
⇒ 现在第四档 `产物里根本没有这道脚本（这一道没跑）` 单列、打 🔴、计入退出码；
P3 断言它 `>= 1` 且前两档为 `0`，把这个形状钉住。

📌 可迁移的：**修一个"类型混淆"缺陷时，要问"同一个值在这一条链的哪几处还会出现在断言的另一侧"**。
我只问了对照组那一侧。回归臂之所以值钱，就是它按**另一个调用点**去跑，而不是按我当时想到的那一个。

### 2. 装置自己也被抓到两次（都当场改）

- 定位旧抄件段第一版写成"找第一段连续三行 `| W…`" ⇒ 命中的是**修好的那张表自己**（表体本来就是连续 16 行），
  于是删掉 16 行合法行、P2 报"处置后仍是 1"，看着像判据坏、其实是处置没处置到靶。
  改成**从判据的 `表区间：第 N 行起，连续 M 枚` 读数往后再找**（判据说什么就是什么，不自己猜形状）。
- 那一次读判据用裸 `execFileSync` ⇒ 判据在未处置的树上按预期退 1，装置直接崩栈把整趟读数吞掉。
  改成收 `e.stdout`。**"判据在靶上必须红"和"装置要能读到这个红"是两件事**，第二件得写出来。

### 3. 复跑与状态

```bash
node research/tools/mutation-rigs/mutate-detail-pane-merge-preflight.mjs      # 4/4，约 4 分钟（三趟载体各铺一次树）
node scripts/verify-detail-pane-merge-preflight.mjs --a main --b main          # 看第四档的读数
```

**状态：已完成。**（本条这一单：第四档 + 四条臂 + 两次装置自身缺陷的修正；
载体仍然**不挂** `pnpm check` —— 要两侧真的分叉才有意义，同 §8.52 那条理由，挂接仍是待办 **#23**。）

## 8.71 腿 4 的触发词从"只认「截图」"扩到一切指图措辞 —— 射程按**结论的语义**取，不按我当初写过的那个词取（2026-10-04 17:5x，载体续 `98702f50` 之后）

工单 §4 的原话是"界面类必须**截图且人看图**"。腿 4 却只认 `截图` 这一个字样，于是那一格的射程是
**我当年用词的形状**，不是要求的语义：下一轮谁写成"六张图逐张看过""人已看图"而不带"截图"二字，
这一档就静默地不再看那一行 —— 而且它不会报错，只会**没有对象**。

### 1. 先把样本量出来再改判据（这一步不能省）

一次性探针 `node /tmp/audit-868-claim.mjs <文档>`（临时件，不进仓）现量：

| 项 | 读数 |
|---|---|
| 表区间工单行 | 16 枚 |
| 声称看过界面图的行 | **8 枚**（W1 W1b W2 W3 W4 W5 W6 W7） |
| 其中没带图片路径的 | **0 枚** |
| 按旧触发词（只认"截图"）命中的 | 同样这 8 枚 |

⇒ 扩词**今天零假红**，改的只是未来换措辞时的静默失效。选词只收指图的 `截图/看图/逐张/张图/人眼复核`，
**不收裸"看过"**：正文里"没看过那段代码"也会被它选中（表内 8 枚用前者同样命中，实测一个不多）。

### 2. 臂

`research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs` 加两条，共 **17/17**：

- **N4**：把某行的"截图"换成"界面取证图"（"截图"字样清零）**并剥掉全部图路径** ⇒ 腿 4 必须点名那一枚。
  这一臂是"扩词"本身的存在理由：旧判据在这一臂上是绿的（它看不见这行了）。
  臂内三条前提断言：那一行原本"截图 + 路径 + 另一种指图措辞"三件齐；换词后 `截图` 确实没了；
  换词后仍剩指图措辞 —— 少任何一条就 throw，不许臂退化成装饰。
- **N5**（对照）：同一行**只换措辞、路径还在** ⇒ 必须绿。这条挡的是"扩射程带来的假红"，
  没有它 N4 可以被"把所有含'过'字的行都判红"这种写法糊过去。
- 脱牙对照：`bad` 里把 `shotMissing.length` 乘 0 重跑 ⇒ 恰好 **S4 与 N4** 报"判据没红"（`2/17 臂不合格`），
  N5 这类断言绿的臂不受影响 —— 两条臂确实挂在腿 4 上。

### 3. 顺带把 §8.67 §3 那张腿表里两条**过期定义**改回现量

那张表现在写着"写了「截图」的行…"与"前一行不是表格行 ⇒ 孤儿"，两句都是 16:5x 那一版的实现，
分别被本条与 §8.68 §2 改掉。已在表下方标注"以本段为准、上面两行是当时的定义"，
并把 §8.67 那段读数留成**当时的输出**（它打的是"五项都成立"，现在打的是六项）—— 同 §8.29 那条纪律：
更正划线留原句旁，别把历史读数改成现在的样子。

### 4. 边界（别读多）

- 判据仍然只判"**声称看过图却没给路径**"。它不判"这一单该不该有图"，也不判"图里画得对不对" ——
  后者按 §6.2 规定一只能由人看图来完成。
- 指图措辞还是**字样级**的词表。真正封不住的是"用别的说法声称看过界面"（比如"界面确认无误"）；
  那已经是自然语言理解，不是这条文本判据该答的题。**记在这里而不是假装已经解决。**

复跑：`node scripts/check-detail-pane-status-table.mjs && node research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs`（当前 RC=0 / 17/17）。

**状态：已完成。**（本条这一单：射程按语义取词 + 两条臂 + 脱牙对照 + §8.67 那两条过期定义的回改。）

## 8.72 三枚文档判据的**唯一**自动消费者是这趟预检 ⇒ 给载体加名册自检，并让"枚举本身坏了"也响亮报红（2026-10-04 18:0x，载体续 `fb955d9d` 之后）

### 1. 先量"到底有没有人跑它们"，不量"我觉得挂了"

现量（`grep -rl <脚本名>` 全仓，排除 node_modules，18:0x）：

| 脚本 | 出现处 | 其中**会执行**它的 |
|---|---|---|
| `check-detail-pane-status-table.mjs` | 两枚变异装置 + 本篇文档 + 预检载体 | 只有预检载体 |
| `check-detail-pane-c1-coverage.mjs` | 自己的变异装置 + 两篇文档 + 预检载体 | 只有预检载体 |
| `check-detail-pane-evidence-refs.mjs` | 自己的变异装置 + 本篇文档 + 预检载体 | 只有预检载体 |
| `verify-detail-pane-merge-preflight.mjs` | 自己的变异装置 + 两篇文档 + 机械处置脚本 | **没有自动载体**（要人跑） |

⇒ 链条是"人工跑一趟 → 那趟跑三道判据"。**变异装置不算消费者**（它改坏文本再看红不红，不替产品把关）。
所以 §8.68 那句"三枚文档判据现在有真消费者"要读准：那里的"消费者"指的是**分档修好之后它们在合流那趟真的会被跑**，
不是"进了 `pnpm check`"。这一条把那个区别写死，免得下一个人把它读成链内门禁。

`main` 在 2026-10-03 为这条链新写了 `scripts/check-gate-wiring.mjs`（现量：main HEAD 已有该文件，本检出还没有），
它的判据是「**`package.json` 里定义过的 `check:*` 别名，要么在链里，要么进允许表并点名一个行首锚定的载体**」。
🔴 本批这三枚**根本没有 npm 别名** —— 它看的是 `Object.keys(pkg.scripts)`，一个文件名的枚举都不是，
所以它们整个落在 main 那道门禁的**射程之外**：链外、无别名、无自动消费者 —— 三个条件同时成立而没有任何一层会红。
这正是 main 那条门禁的注释里说的"给漏洞上户口"的形状，只是这里连户口都没上。

### 2. 判据：两侧必须**不同源**，模式本身还要一条前提断言

加在预检载体里（不进 `pnpm check`，与载体同档）：

- **主判据**：拿**产物树 `scripts/` 里真实存在的文件名**（文件系统给的）去撞**手写的 `GATES` 名册**；
  有一枚 `check-detail-pane-*.mjs` 不在名册 ⇒ 🔴 报"合流当场一次都不会跑它"，计入退出码。
  ⚠️ 反方向（拿名册自己比自己）只会恒真 —— 那正是"看起来在保护一件事，其实保护的是另一件"。
- **探针自检**：`TREE_ROOT_GATES` 里每一项的 basename 必须命中那个族模式。
  没有这一条，模式一旦写坏（`check-detail-pane-` 打成 `check-detailpane-`），枚举会安静地返回**空集合**，
  而"没有对象"与"全部在册"在输出上逐字相同 —— 这是本项目最贵的一类错（AGENTS §7 元规则 1/2）。
- `readdirSync` 抛异常（产物树没有 `scripts/`）也归进同一档 ⇒ 红。**没跑成的检查不许被读成绿。**
- 对照趟 `--a main --b main` 里这一档必须是 **0**：main 的树里没有本批判据，那是"没有对象"，不是"漏挂"（P3 断着）。

### 3. 臂（装置从 4 条涨到 8 条，条数以输出为准）

```
✅ P1 … 没有对照组=1 两边都红=0 产物缺脚本=0
✅ P2 … 处置前 1 → 处置后 0（丢掉 13 行，从第 175 行起）
✅ P3 … 合并=0 无对照=0 产物缺脚本=3
✅ P1 全文腿 … 命中"表外的孤儿工单行"，无 "not a git repository"
✅ R1 往产物树放一枚真文件 ghost ⇒ 名册=1 且点名 ghost          ← 会响
✅ R3 摘掉 ghost ⇒ 名册归 0，且 P1 的两档读数逐字不变            ← 会归零（成对，R1 不是装饰）
✅ R2 把族模式字面量改坏 ⇒ 名册=3（三枚全数出来）且打"探针坏了"   ← 探针自检有牙
✅ P3 名册=0                                                  ← "没有对象"不许报成红
```

R2 那枚 `名册=3` 是**预期**读数：模式改坏后三枚在册项全部撞不上模式，自检逐条报出来 —— 响亮失败比"只报一条"更好认。

### 4. 本趟的合流面现量（瞬时读数，带 ref 与时刻）

`main=6b710b13` × `HEAD=fb955d9d`，18:0x：落后 **582**／领先 **107**；
预检一趟：冲突 **17** 枚（比 13:38 那趟的 15 枚多，main 又长了）、纯 fs 门禁 **20** 道、
合并造成的红 **1**、候选红而 main 侧没有该脚本 **1**、产物缺脚本 **0**、两边都红 **0**、
**名册漏跑/探针坏 0**、静默合流 11 枚（丢行/语法不过 **0**）、槽位重复 0、台账 🔴 **2 项**、
产物仍带 marker 的产品文件 **4** 枚 ⇒ **本趟 tally 不算"合流验过"**，`RC=1`。
⚠️ 同一天内候选树号在变（本条里出现 `3ca8ab68` 与 `1b7b9cf0` 两个号，来自相隔两分钟的三趟）——
树号不是复现凭据，引用只能带 `main`/`HEAD` 双 sha + 时刻（§8.52 那条纪律在这一趟又成立一次）。

### 5. 边界（别读多）

- 这一档只覆盖 `check-detail-pane-*` **这一个族**。如果下一批新判据起名不带这个前缀
  （比如 `check-note-selection.mjs`），枚举就看不见它 —— **文件名本身是这道的接缝**。
  把它扩成"全仓所有链外判据"需要先把"什么叫本批的判据"变成一个可判定的定义，现在没有。
  ⚠️ 本节第 1 小节那张表与第 5 条这句写于 18:0x：**十几分钟后 #23 当场做掉了**（三枚别名进 `pnpm check`），
  读数留原样、更正指针与量法见下一条。本批这几枚判据在**合流那一趟**的入口（名册自检）不变。
- 它**不**管变异装置（`research/tools/mutation-rigs/`）：那些装置按 §8.52 的决定刻意不进任何自动载体。
- 它**不**等于"这三枚判据从此有人守"：真正的守法仍是 #23（挂进 `pnpm check`），那一步的前置是
  根 `package.json` 干净 —— 18:0x 现量主检出仍是 `M`（别人在飞，见 §8.60 那条纪律：不代改）。
  ⇒ 现在闭合的是"挂在名册上就不能静默漏跑"，没闭合的是"这趟预检自己有没有自动消费者"。

复跑：`node scripts/verify-detail-pane-merge-preflight.mjs`（RC=1 是未处置状态，含 4 枚 marker）
+ `node research/tools/mutation-rigs/mutate-detail-pane-merge-preflight.mjs`（8/8 符合预期，RC=0）。

**状态：已完成。**（本条这一单：消费者现量 + 两侧不同源的名册判据 + 探针自检 + R1/R2/R3 三条臂 + 与 main 那条新门禁的射程差登记）

## 8.73 #23 当场做掉了，不等合流 —— 用 main 自己那条 `check:gate-wiring` 的注入旋钮量过"挂进链"到底贵不贵（2026-10-04 18:1x，载体续 `86cf7c90` 之后）

§8.72 的边界第 5 条当时写的是"真正的守法仍是 #23，那一步的前置是根 `package.json` 干净"。
🔴 那句把**两件不同的事捏成了一件**：我这棵树提交 `package.json` 不会去碰别人工作树里那份脏改动 ——
代价不是"别人的活被改"，而是**合流时多一枚冲突文件**。那个代价是可以量的，量完才发现它比我预估的小。

### 1. 量法：不猜，拿 main 那条门禁自己的旋钮量

`main` 的 `scripts/check-gate-wiring.mjs` 自带两个只为注入验证存在的开关（`--pkg` 指一份候选
`package.json`、`--root` 指消费方文件的解析根），本检出里没有这个文件，所以直接从
`git show main:…` 取到 `/tmp` 跑（**不往仓里落第二份抄件**）。

| 趟 | package.json | 定义数 | 链段数 | 🔴 红集 |
|---|---|---|---|---|
| 基线 | 本检出原样 | 58 | 62 | 3 枚，逐条都是 `check:web-artifact:app` |
| 挂接后 | 加 3 枚别名 + 链里插 3 段 | 61 | 65 | **同样那 3 枚，逐字节相同** |

⇒ 新增红 **0**。那 3 枚基线红不是本批的债，是**载体滞后**：本检出落后 main 582 笔，那条允许表引用的
`docs/runbooks/deployment.md` 行首命令与 `server/Dockerfile` 的 `RUN …` 我这棵树里都还没有，
合流后自然消失（与 §8.13 表里那两枚同一族：分支落后造成的红，不是产物红）。

### 2. 挂法与代价

三枚别名插在 `check:docs-voice` 之后（同一族文档门禁挨着放），链里同样插在它后面。
纯 fs 耗时现量：status-table **96 ms** / c1-coverage **89 ms** / evidence-refs **2289 ms**
（最后一枚慢是它默认走 git 模式列全仓跟踪文件 —— 在合流载体里走 `--root` 树模式）。
真实代价 = `package.json` 从此进入冲突集合（本趟 17 枚 → 18 枚），而且撞的是全仓最容易撞的那一行
（`main` 那条门禁的注释自己就记着：2026-10-03 那次合并**唯一**的冲突文件就是 `package.json`）。
⇒ 处置规则要写在合流那一步里：**两侧别名取并集**，合完立刻跑 `pnpm check:gate-wiring` ——
那条门禁存在的意义正是挡住"并集把某一侧吞掉"，所以这一次并集是**可机器验证的**，
和 2026-10-03 靠一条抓不住的 `grep -c` 核对不是同一件事。

### 3. 一个要提前说清的后果（别在合流当场当成新缺陷）

链里有了 `check:detail-pane-status-table` 之后，合并产物在 ⑦（丢掉 main 带回的那 13 行旧抄件）
做完之前会在 `pnpm check` 里**红**——那是判据在正确地说话，不是合流把门禁搞坏了。
同批已登记的还有 #16 那两行 trash `busyId` 豁免。⚠️ 这两条都是"处置动作没做完"的红，
处置完各自归零（§8.68 的 P2/R3 那两臂量的正是"它会归零"）。

### 4. §8.72 那句"唯一消费者"随之作废

已就地改的是**载体里的注释与红字**（不改判据逻辑）：现在这三枚在链里也跑，这一趟给它们的是
**带对照组的那一趟** —— "这枚红是不是合并造成的"只有这里答得出。
名册自检因此仍然必要，但必要性换了来源：一道判据可以同时在 `pnpm check` 里跑着、
又从这张名册里静默掉出去，而 main 那条门禁看不见这一层。
📌 §8.72 那张消费者表的读数是 18:0x 的**当时**状态（三枚"只有预检载体"、预检"没有自动载体"），
留原样不改成现在这个样子；本条就是它的更正指针。预检载体自己**仍然**没有自动消费者 —— 这一点没变。

### 5. §1 四道前置闸门对本笔的复验

| 闸门 | 读数 |
|---|---|
| 归属门 | `git log main..HEAD -- package.json` 里改这一行的只有本批自己；主检出那份 `M` 属于并行会话，**本笔没有写进它的工作树** |
| 两道余量为 0 的棘轮 | 不涉及（没动样式/内联） |
| 干净检出复跑 | 一次性 detached 检出 `01a36e9b`：三枚判据 `RC=0 / RC=0 / RC=0`，`docs-link-check` 仍只有 PROGRESS.md 那一枚外来死链（⑤，合流自愈）；载体跑完即 `worktree remove` |
| packages 改完先 build | 不适用（本笔零 `packages/`、零 `apps/` 改动） |

挂接动作因此**不是"等谁把 package.json 交出来"**：它是一笔普通提交，代价在合流那一刻付（并集 + 跑一次
`pnpm check:gate-wiring`），而那一趟本来就要过 §8.47。

复跑：`node scripts/check-detail-pane-status-table.mjs && node scripts/check-detail-pane-c1-coverage.mjs && node scripts/check-detail-pane-evidence-refs.mjs`（三枚 RC=0）
+ `node research/tools/mutation-rigs/mutate-detail-pane-merge-preflight.mjs`（臂数与红集以输出为准）。

**状态：已完成。**（本条这一单：#23 的代价现量 + 挂接入链 + 载体注释与红字随批更正 + 合流时的并集处置规则）

## 8.74 §6 第 1/2/3 行第一次有常驻载体：详情列**槽位判据**，射程从代码解析而不是抄一份文件清单（2026-10-04 18:2x，载体续 `82cad45a`）

§8.39 逐行量过 §6 那张表，结论是 9 行里只有 3 行有常驻载体，第 1、2、3 行（不许 emoji 当图标 / 不许空态插画 /
不许空态引导卡）的"账"来自两个 `/tmp` 里的一次性探针。🔴 **一次性探针挡不住下一轮**：它证明的是"本批没做"，
而 §6 那三行是长期约束 —— 六周后有人往槽里加一张插画，没有任何一层会失败，而那三行读起来仍然"有账"。
本条把它们钉成常驻门禁 `scripts/check-detail-pane-slot.mjs`（别名 `check:detail-pane-slot`，已进 `pnpm check`，
也已挂进合流载体的名册）。

### 1. 射程怎么定的 —— 不写文件清单，从代码解析

写死的清单就是下一份会漂的抄件（§8.42 那个形状）。射程这么来：

1. 在 `apps/web/src/App.tsx` 里找带 `data-testid="detail-column"` 的 `<aside>`，按 `<aside` / `</aside>` **配对**算出槽区域
   （不是数行号，也不是"找下一个 `</aside>`"—— 那个假设在有两枚 aside 的树上会静默算错射程）；
2. 槽**里面**出现的每个大写组件标签，回 App.tsx 的 import 语句解析成仓库内文件 ⇒ 这些就是"往槽里画东西的生产者"；
3. 解析不到的（workspace 包里的组件）**大声列在射程外**，不静默当成扫过了。

⇒ 以后新挂一枚生产者进槽，判据一字不改就把它的文件算进射程。这条不是注释里的承诺，装置里 **A5 专门证它**，
**N2 是它的另一半**（新挂一枚**干净**的生产者必须放过，否则 A5 的红只证明"槽里多了一枚组件"、不证明"抓到装饰"）。

### 2. 四条腿各判一件事

| 腿 | 判的 | 对应 §6 |
|---|---|---|
| A 手写标记 | 槽里面出现小写 DOM 标签或裸文本 ⇒ 红。装配处只许放"内容生产者"，"往槽里塞装饰"就是从这儿进来的 | 2、3 |
| B 装饰图形 | 射程内出现 `<img` / `<Image` / `<svg` / 位图资产引用 / `Illustration` / `插画` ⇒ 红。⚠️ **Lucide 图标不在禁止之列**（共享 `EmptyState` 的 `icon` 走的就是它，AGENTS §5 要的也是它） | 2 |
| C emoji | 射程内**剥掉注释后**出现 emoji 码位 ⇒ 红 | 1 |
| D 引导卡 | 射程内出现「引导 / 新手 / onboarding」字样 ⇒ 红 | 3 |

腿 C 只看剥注释之后的部分，这条口径是 §8.39 那次改了三遍才站住的：整行扫命中 **43** 处，全是本仓文档与代码里
我自己写的状态记号 🔴⚠️。被剥掉的条数当**承重数**打在读数里 —— 现量 **9** 处，这既挡住假红，也让人分得清
"没有 emoji"和"探针把 emoji 都当注释剥了"。

### 3. 读数

| 项 | 读数 |
|---|---|
| 判据在干净代码上 | `RC=0`；槽区域（含容器）3 行、生产者 **1** 枚（`FocusDetailPane`）、射程 2 段剥注释后 **103** 行、命中 A=0 B=0 C=0 D=0 |
| 装置 | **13/13** 臂符合预期（A1 手写 `<img>` ⇒ A=1 B=2 且 C=D=0；A2 emoji ⇒ 只有 C；A3「新手引导」⇒ 只有 D；A4 把 `data-testid` 改走 ⇒ 响亮报"找不到那枚 aside"；A5 射程自动到 2 枚并抓到新组件里的 `<img>`；N1 注释里的 emoji 放过；N2 干净生产者放过；A6/A7 见下面第 6 节） |
| 脱牙对照 | ① 把四条腿的命中集合清空后重跑，A1/A2/A3/A5 **四臂全部失能** ⇒ 没有一条臂其实挂在解析崩溃或别的腿上；② 把 marker 分流那个 `if` 摘掉后重跑，A6/A7 **两臂全部失能**（失能判据取"不再报出 marker 那一句"，**不能**取 `rc===0` —— 摘牙后 A7 仍会因配对失败而红，用错判据会把它读成"臂还有牙"） |
| 挂进 `pnpm check` 的代价 | 拿 main 那条 `check:gate-wiring` 离线复跑：定义 61→62、链段 65→66，🔴 红集与挂接前**逐字相同**（仍只有 `check:web-artifact:app` 那 3 枚载体滞后红）⇒ 新增红 **0** |
| §1 闸门"干净检出复跑" | 18:3x 现量：`git archive HEAD \| tar -x` 到 `/tmp/dp-cleantree` 后跑 `node /tmp/dp-cleantree/scripts/check-detail-pane-slot.mjs --root /tmp/dp-cleantree` ⇒ **`CLEANTREE_RC=0`**（判据不依赖工作树里任何未提交文件） |
| 本批改完文档后复跑三道文档判据 | 18:4x：`check:detail-pane-status-table` **RC=0**（16 行、六项成立）、`check:detail-pane-evidence-refs` **RC=0**、`docs-link-check` **RC=1** —— 🔴 那一枚红**不是本批造成的，且与上面"挂进 `pnpm check` 的代价"那行的 3 枚载体滞后红不是同一件事**：`PROGRESS.md:1362 → docs/research/aed-implementation-evidence.md`。逐棵树现量：`main` **有**这个文件 / 本支 `HEAD` **没有** / 候选合并树 `65547382` **有**；并在 main 的**独立 detached worktree** 里实跑了一遍门禁（`node /tmp/dp-mainwt/research/tools/docs-link-check.mjs` ⇒ **`MAIN_LC_RC=0`**，不是推断）⇒ 这是**本支落后**造成的死链，合流当场自愈。⚠️ 第一次取证走错了载体：`git archive main \| tar -x` 那份裸树里跑它会因为 `git ls-files` 失败而整条判据空转（它自己响亮地拒了，这一点值得表扬），**换成 detached worktree 才算量到 main**。本批不代改（不动别人那一行），只把"合流后这一枚必须消失"记在这里 |

### 4. 装置自己第一趟就撞上的坑，值得单独记一笔

`new URL(import.meta.url).pathname` 在**本仓库路径含空格**的情况下会把目录 percent-encode 成 `All%20in%20one%20Data`。
把那个假路径当 `cwd` 传给 spawn，症状是 `spawnSync git ENOENT` —— 读起来像"这台机器的 git 没了"，
其实是装置自己造了一个不存在的目录。修法：`fileURLToPath(import.meta.url)`。
📌 两条一般规律：**报错的 syscall 名字不指向真正的出错层**（ENOENT 报的是 `git`，缺的其实是 cwd）；
以及**装置推仓库根要靠自己的位置，不要靠 spawn 的环境**（同一形状第二次咬我，第一次是 §8.5x 的 `pnpm` deps 预检）。
本仓库路径永远带空格，所以这条对所有用 `new URL(...).pathname` 的脚本都成立 —— 已 sweep 过 `scripts/` 与
`research/tools/`，除本装置外无第二处这种写法。

### 5. 边界（别读多）

- 判据管的是**详情列槽**这一条面，不是全仓的 emoji / 插画政策。全仓那条属于 AGENTS §5，本批不越界去建一道大门禁
  （那会当场红在别人的历史代码上，见 §8.13 那批"外来红只登记不代改"的纪律）。
- 射程**只到生产者文件本身**，不递归进生产者再 import 的下一层。今天 `FocusDetailPane` 用的是共享 `EmptyState`，
  它内部怎么画不在这里判 —— 那是 `check:empty-state` 与 `check:design` 的题面，本条不重复建判据。
- 注释剥离是按 `//` 与 `/* */` 的**字样**剥的：字符串里出现 `//`（例如 URL）会被多剥一截。
  方向是"可能少判"而不是"假红"，且槽的射程内现在没有这种字符串 —— 记在这里而不是假装不存在。
- 腿 A 认"小写标签 = 手写标记"。如果哪天有人把装饰做成大写组件（`<HeroArt />`）挂进槽，腿 A 放过，
  但腿 B 会在**它自己的文件**里抓到图形通道 —— 前提是它的 import 是相对路径（能从 App.tsx 解析到文件）。
  解析不到时它会被**点名在射程外**，不会被当成"扫过了"。
- 🔴 与 §6 那三行的关系：本条把"有账"从一次性探针升级成常驻判据，**不**改变 §6 的口径，也不替拍板 #1 预先决定
  槽里最终放什么 —— 那条产品结论仍然在 C1 的待拍表里。

### 6. 第三档分流：判据跑不了的时候，先说清是**哪一种**跑不了（18:3x 续，载体 `59b7bb93`）

槽的读法本身要两步（配出区域 → 扫四条腿），所以"跑不了"有三种成因，而**处置互不通用**：

| 读数 | 含义 | 处置 |
|---|---|---|
| 找不到带 `data-testid="detail-column"` 的 `<aside>` | 槽被改名/拆走/挪走（腿 A4 的靶） | 看代码：确认是不是有意为之 |
| 槽区域里仍带冲突标记 | §8.47 第 3 节那一枚 App.tsx 冲突还没裁决（**合流当时的真实现场**，见 §8.75） | 清 marker：裁决之后重跑，**不是**产品缺陷 |
| `<aside>` 与 `</aside>` 数不上、且没有 marker | 有人把闭合标签拆走了 | 看代码 |

🔴 **分流必须写在配对结论之前**，这一句是 18:3x 实测出来的，不是排版偏好：真实现场两侧各写一枚
`<aside data-testid="detail-column">` 共用同一个 `</aside>` ⇒ **配对失败正是 marker 造成的**。
第一版把 marker 分流放在配对 `regionEnd === -1` 那个 bail 之后，于是在 `merge-tree main HEAD`
的产物树上永远只会读到"配对解析不出来"那句 —— 这条分流**形同没写**。

取证读数（同一趟，`--root` 注入现铺的产物树 `/tmp/dp-slotcheck`，树号 `ca7bfec8`）：

| 判据版本 | 真产物树上的读数 |
|---|---|
| 已提交版 `82cad45a`（**还没有**分流这一块） | `🔴 …闭合标签配对解析不出来…` —— 红是对的（那棵树确实读不出槽），但它把"要人裁决的冲突"报成了"结构被合坏了" |
| 第一版分流（写在工作树里，放在配对 bail **之后**） | 与上一行**逐字相同**：分流一次都没被执行到 ⇒ 这一档当时是装饰 |
| 分流挪到配对结论**之前**（`59b7bb93`） | `🔴 槽区域里仍带冲突标记 … 结论：详情列槽位判据没能跑（marker 未清）` |

⚠️ **而 A6 没有把这件事照出来** —— 它造的靶是**闭合平衡**的 marker 形状（插一份带 `</aside>` 的假冲突），
所以判据写错顺序时 A6 照样通过。这是本项目那条老纪律的第五种面目：**变异靶必须与真实现场同形状，
否则臂量的是臂自己的想象力**。修法不是把 A6 改严，而是**另立一臂 A7 照真形状造靶**
（两侧各一枚 `<aside>` + 共用一个 `</aside>`，配对必然失败），再加第二把脱牙钉住"两臂都挂在那个 `if` 上"。
读数和两条失能判据的区别见上面第 3 节。

复跑：`node scripts/check-detail-pane-slot.mjs`、`node research/tools/mutation-rigs/mutate-detail-pane-slot.mjs`，
以及现铺一棵真产物树再跑一次（这一条量的是"分流会不会被配对结论抢先"，装置里的 A7 是它的合成版）：

```bash
TREE=$(git merge-tree --write-tree --name-only main HEAD | head -1)
rm -rf /tmp/dp-slotcheck && mkdir -p /tmp/dp-slotcheck && git archive "$TREE" | tar -x -C /tmp/dp-slotcheck
node scripts/check-detail-pane-slot.mjs --root /tmp/dp-slotcheck   # 未裁决时：报 marker 那一档，RC=1
```

**状态：已完成。**

## 8.75 拍板 #1 的题面第一次变成**一枚具体的代码冲突**：详情列那一格两侧各写了一份内容（2026-10-04 18:3x 现量，载体 `82cad45a` × main）

跑槽位判据（§8.74）在合并产物上第一次报红，红的不是产品 —— 它把一件一直只存在于文档里的东西照出来了：

```
2662:<<<<<<< main
       * AI 面在那一档**退回中间列**，不跟着这一栏一起消失（判据见 `detailHasRoom`）。
       */}
      <aside
        ref={detailRef}
        className="ht-app__detail"
        data-testid="detail-column"
      >
        {detailHasRoom ? aiPanels : null}
2671:=======
       * 🔴 **今天它有一格内容是例外的**：专注面（工单 W7）。…（省略中段注释原文，见本批 2531 行）
       */}
      <aside className="ht-app__detail" data-testid="detail-column">
        {contentView === 'focus' ? <FocusDetailPane /> : null}
2679:>>>>>>> HEAD
      </aside>
```

⚠️ 上面这一段是从候选树里 `git show <候选树>:apps/web/src/App.tsx` 抄的（`2662`/`2671`/`2679` 是那一棵树里的行号），
注释中段有一处为省篇幅打了省略号 —— 除那一处之外逐字未改。候选树号不是复现凭据（§8.52 那条），
下一次合流面变了要重新现取。

### 1. 两侧各自在说什么（逐字读 marker 两边的注释，不猜）

- **main 侧**：注释原话是"『默认显示 AI Chatbot』⇒ 任务视图里这一栏装的就是 **AI 面**（`aiPanels`）"，
  并且紧接着写"『选中某条 ⇒ 右边出详情面』那一半**没有**被推翻，它仍属于『详情面本体』那单（阻塞在拍板 #1/#8）；
  **那一单接进来时替换的是这一块位置，不另开第三处**"。⇒ 那一侧是**知道本批要来**的，它还带上了 `ref={detailRef}` + `detailHasRoom`
  （窄屏时 AI 面退回中间列）。
- **本批侧**（W7 落的那格）：`contentView === 'focus'` 时装专注概览 + 记录，其余视图空着。

两者写的是**同一个 JSX children 位点**。git 在这里没有机械解 —— 不是"hunk 挨着"那种可以并排的冲突，
是两个表达式抢同一个位置。

### 2. 这一格要人拍的是什么（= 拍板 #1 的具体化，不是新的待拍）

工单 §3f 与待办 #19 一直把"同一格里 AI 面与专注概览怎么共处"记成一条待拍。现量之后它的形状变了：
它不再是"以后设计时想一想"，而是**合流当场必须回答的一行代码**。三个可写出来的答案（我**不**替产品负责人选）：

| 写法 | 含义 | 代价 |
|---|---|---|
| 条件并排（`contentView === 'focus' ? 专注面 : detailHasRoom ? aiPanels : null`） | 专注视图给 W7 的概览，其余视图仍给 AI 面 | 需要一条"这一格此刻装的是谁"的无障碍名/词条（main 侧注释自己写着"这一栏仍然没有无障碍名，等详情面那单一起定"）⇒ 要新词条，中英成对 |
| 两栏并排（一格里上下叠两块） | 两者都要 | 纵向空间；窄屏塌缩规则要重算（main 侧的 `detailHasRoom` 只算 AI 面那一块） |
| 专注面挪回中间列，这一格整块留给 AI 面 | 本批 W7 的落点被换掉 | 与本批 W7 的截图与判据全部要重出（§6.2 规定一） |

### 3. 本批做了什么、没做什么

- ✅ 给槽位判据加了**第三档分流**：槽区域内带冲突标记 ⇒ 报"仍带冲突标记 / 没能跑（marker 未清）"，
  而不是报"配对失败"或"槽里有装饰"。这三句的处置分别是"去 §8.47 第 3 节裁决"/"看代码"/"改产品"，
  混成一档就是把下一位引到错误的现场。🔴 但**第一版是坏的**：分流写在配对结论之后，而本节这枚冲突
  恰恰**让配对失败**，于是分流在真产物树上一次都没被执行到。修法与取证读数在 §8.74 第 6 节
  （装置臂从 A6 一臂扩成 A6+A7 两臂 + 第二把脱牙；A6 单独不构成牙）。
- ✅ 把预检装置 P2 的期望从"聚合归零"改成"文档那一枚消失 + 剩下的那枚**点名是哪道门禁**（现量取，不写死）
  且全文写着 marker"—— 因为归零条件现在挂在**裁决这一格**上，不挂在 ⑦ 上。读数：**8/8 臂符合预期**，
  `处置后红的门禁=check-detail-pane-slot.mjs；全文含"仍带冲突标记"=true`（候选树 `65547382`，18:3x）。
- 🔴 这一臂改的时候先红了一趟，红的原因值得单独记：**装置断的是"候选树里那道判据的行为"，而候选树来自
  `merge-tree main HEAD` —— 工作树里尚未提交的改动不会进树。** 第一版 P2 断 `仍带冲突标记` 时，
  那一支只在未提交的工作树里，于是红的是装置前提而不是被测判据，症状与"合并造成的红"一模一样。
  修法不是把断言改松，而是①先提交那道判据再跑装置，②给装置加**前提门**：候选树里读不到 marker 分流分支
  就 `exit 2` 拒绝跑，不产出任何"看起来像判据红"的读数。⚠️ 这是"先怀疑探针"的一条新面目：
  **探针的靶可以是过时的，而且过时得很难看——它报的是被测对象的错。**
- ❌ 没有改 main 那侧的任何代码，也没有在本批把 AI 面接进槽里（那是别人的面 + 拍板 #1 的题面）。
- ❌ 没有"先选一个能合的写法"。机械上最省事的那一条（条件并排）恰好需要一条新词条，
  而"这一栏叫什么"正是拍板 #1 要定的事 —— 先抄一个名字就是把拍板偷走（AGENTS §5 中英同步那条纪律也会当场红）。

⇒ §8.47 第 3 节的清单**本来就有这一枚**（§3f，14:5x 记的）。本节不是新增待办，而是给它补三样东西：
① 逐字冲突块（上面那段，带候选树行号）；② 三种可写出来的答案与各自的代价（第 2 节那张表 —— §3f 原来只
推了"条件并排"一种，另两种一直没被写下来过）；③ **一道常驻判据现在会替人守着它**：合流当时
`check:detail-pane-slot` 在产物树上报的就是"marker 未清 ⇒ 没能跑"（§8.74 第 6 节），而预检装置的 P2 臂
断言"文档那枚红消失之后，剩下的那一枚必须是它"。待办 #19 的题面也从"以后要拍"换成本节这个具体形状。

## 8.76 本轮（18:2x–20:4x）待入 traps 清单（**条数不落笔**，现取：`grep -cE '^[0-9]+\. ' ` 作用于本节正文；编号按收口/合流当时的工作树现量续，取号理由同 §8.22 那段与 #22）

下面每一条都是"下一轮一定会再撞一次"的形状，而且每一条的**症状都不是它自己**（这一句以前写的是"这四条"，而清单早就不是四条 —— 同一个成因记在第 6 条）：

1. **分流/顺序类判据：新加的那一档必须写在"会抢先返回的那一档"之前，而变异靶必须与真实现场同形状。**
   槽位判据先判"闭合配对"再判"带冲突标记"，而真实现场（两侧各一枚 `<aside data-testid="detail-column">` 共用一个 `</aside>`）
   **配对失败正是 marker 造成的** ⇒ 后一档在真产物树上永远不执行；我写的 A6 臂靶子是**闭合平衡**的，写错顺序也照样绿。
   取证与修法在 §8.74 第 6 节（三行版本对照表 + A7 + 第二把脱牙）。⇒ **写"分档"之前先问：真现场会先撞上哪一档？**
2. **装置断的是"候选产物里的行为"时，未提交的分支不会进候选树。** 候选树来自 `merge-tree main HEAD`，
   工作树里改了判据而没提交，装置的红**落在装置自己的前提上**，症状与"合并造成的红"逐字相同（P2 实测，§8.75 第 3 节）。
   ⇒ 两条固定动作：① 先提交判据、再跑装置；② 装置加**前提门**（读不到被测分支 ⇒ `exit 2` 拒绝跑，不产出任何读数）。
3. **判"这条约束没有常驻载体"要连测试通道一起数。** 我在 §6 第 5 行写过"既有判据是界面用例、不是门禁 ⇒ 没有常驻载体"，
   而 `apps/web/tests/settings-sheet-ia.spec.tsx` + `search-overlay-ia.spec.tsx`（8 条）走 `pnpm -r test`，
   `pnpm check` 末尾就跑它 —— 每次 check 都在守。⇒ "常驻"的判据是**谁跑它**，不是它叫什么名字（§6 那张表已按此更正）。
4. **取证载体不能是裸解包树：带 `git ls-files` 那半的门禁在 `git archive | tar -x` 的目录里会 fatal 空转**，
   而它 `rc=1` 与"门禁红"同形（这次差点把"本支落后、合流自愈"的一枚死链定性成"别人的存量债"）。
   ⇒ 判"main 红不红"用临时 detached worktree（`git worktree add --detach /tmp/x main`，用完 `worktree remove --force`），
   现量读数：main **RC=0**、本支 **RC=1**、候选合并树里目标文件在场（§8.74 第 3 节那行）。
5. **判据的例外档只准从"结构位置"认（表里那一行 / 节标题），不许扫正文。**
   C1b-Q1 正文里本来就有一句"⇒ 这条可以直接写进 W4 的判据，**不需要拍板**"，讲的是另一件事 ——
   若例外允许在正文里出现，摘掉那一节的推荐段之后这句现成的话就把它豁免了。
   🔴 **绕过判据最省力的写法，永远是把例外词复用成文档里已有的一句**（臂 M13 钉这一条，§8.79）。
   同一条腿还要**两个方向各一臂**：词形只认一种写法 ⇒ 下一轮换措辞静默失去对象（M10）；
   判据写成"整节含该词即算" ⇒ 别人原文的中文转述就能顶我们的那一档（M11）。正解是认**结构性形状**（行首加粗标签）。
6. **把机器读数抄进文档时，同一句里必须带"怎么取的"，否则它下一轮就成了不可复核的断言。**
   本批连撞三次同一个成因：装置臂数抄成 `10/10`（一轮之后是 18）、取证量抄成 `56/55 次` 与 `file:line 5 处`
   （没带口径，复跑读到 55/54 与 38 处）、以及 Goal 第①条那张"收口读数"表 ——
   🔴 19:2x 复量时 **8 行里只有 2 行逐字复现**，其中 Q7 那一行整列对不上（表里 URL=3，那一节今天 `https://` 命中 0）。
   ⇒ 落笔规则：**要么只写指针（"现取：`<那条命令>`"），要么把取法与口径写进同一句**；
   两者都没写的那个数，就不要让它出现在散文里（§8.81）。
   ⚠️ 同一条在本轮又应验两次（都在我自己的落笔里）：腿 9 的承重分母抄成"833/504"，
   而**追加完记录这一节的那两张表**，同一命令已经读到"847/512" —— 分母会随本文件增长而漂的读数**只能写指针**。
7. **判据的"层"要和渲染层的切分规则对齐：同一张表上，行层的坏与单元层的坏长得完全不同，而 N 条腿只守它们各自读的那一层。**
   实测形状：GFM **在解析行内结构之前**先按未转义竖线切单元，所以表格单元里 code span 内的裸竖线会把一格劈成两格
   —— 而行仍然闭合、仍在表区间里、状态格与读数档位一个没动，于是那八条腿（行闭合 / 状态词表 / id 唯一 / 截图栏位 /
   表外段 / 变异读数 / 判据条数 / 臂条数+红集）**一条都不红**（臂 P4 现量：同一份变异喂旧判据 `RC=0`）。
   行层的坏（§8.67 那次：19 行 prose 写进单元 ⇒ 整表从中间截断）与单元层的坏，症状分别是"表没了"和"表还在但列错位、diff 干净"。
   ⇒ 两条动作：**问"这一族有没有人守"要逐条问那 N 条各读哪一层**，不是数腿的条数；
   而**一次性扫描照出来的缺陷转常驻腿时，配一条"旧判据喂同一变异必须绿"的臂**（它同时回答"是不是真缺口"和"是不是顺手加严"）。
   另附本条的书写侧：要在文档里展示"裸竖线"这个坏形状，示例必须写在**表外**——写进表格单元就当场再犯一次同一个错。
8. **zsh 里拼 `<rev>:<路径>` 必须给左侧加花括号**：`git show "$TREE:apps/…"` 会被把 `$TREE:a` 读成
   **绝对路径修饰符**，实际查的是一个不存在的路径，而 `grep -c` 对空输入回 **0** ——
   症状是一个干净的"没有 marker"，恰好支持那个错结论（本批实测：加 `"${TREE}:${f}"` 后同一处读出 3）。
   🔴 同一条还带出一个通用动作：**任何"0 命中"要先证明对象存在**，而 `fatal: ambiguous argument`
   就打在同一个读数里时，它极容易被当噪声略过（§8.85 第 2 节）。
9. **"我的 N 条判据全绿"不等于"这个对象干净"—— 先问还有谁管它。**
   实测：本线九条腿全绿的那一趟，main 上那条**同日 18:1x 就存在的共享门禁** `check:md-tables`
   对同一份文档报 **5 处**真缺陷（折成三个物理行的表行、表内空行造成的"无表头碎片"、两处段首裸竖线）。
   两边判的层不同：它判"这张表在 GFM 里成不成立"（列数 vs 表头 / 折行 / 表头下必须紧跟分隔行），
   本线判"这张表有没有把要求的读数写齐"。⇒ **问"这一族有没有人守"要跑一遍别人的名册**
   （`git show main:package.json` 里那串 `check:*` 就是名册，合流窗口测量顺手就能读到），
   而不是只数自己文件的腿数（§8.87）。
10. **变异臂里"取旧版本作对照"这件事不许按 `HEAD` 取 —— 按内容认。**
   臂写下时 `git show HEAD:判据` 就是"还没有新腿的那版"，而新腿**一提交**，HEAD 立刻变成新版 ⇒
   这条臂在"补完的下一笔"上自己变红（本批实测：19:5x 写下、20:1x 红，红的原因是历史前进了不是判据坏了）。
   正解：沿这个文件的提交往回走，取**最新一版不含新腿标题**的（内容判据），找不到就响亮地抛，
   绝不允许退化成"拿当前版冒充旧版"（§8.87 第 3 节第 2 条）。
11. **匹配式写成"某字符前面必须有一个 Y"时，要问"如果它排在开头呢"。**
    `[^\\]\|` 与 `(^|[^\\])\|` 只差一个 `^` 分支，差出来的正是两处**真写进文档里的**缺陷
    （码段内容就是一根光秃秃的竖线，如"收尾的竖线落在那 20 行的最后一行上"那种句子）（§8.87 第 2 节）。
12. **给"择一即可"那类判据加分支时，要先在对象上量出每一支的样本数**——零样本的分支等于没写。
    实测：外部锚那一条第一版把第三方写成"路径以 `research/` 开头"，跑逐节读数发现本档 33 条第三方引用
    **全部**写成裸文件名或相对路径（`StreakList.kt:48-58`、`cards/OverviewCard.kt:47-50`），零条带那个前缀 ⇒
    那一支永远不命中，"有出处"仍然只靠 URL 那一支。改成**反向认**（以本仓顶层目录开头的算自家，其余算第三方）后
    样本数从 0 变 23（§8.88 第 1 节）。⇒ 新分支落地那一趟就要把"这一支命中几条"打进读数，不能只报合计。



13. **减法臂必须保留"被摘掉那一行所抵消的那个压力源"，否则臂会假绿。**
    实测：修负载 flake（§8.90）时，摘掉承重的 `step += 1` 那一行的第一版探针**在同一次替换里把冻结的时钟解冻了**
    ⇒ 6 条全绿，我差点据此写下"那一行不承重、这次改的是别的东西"。补成"冻结仍在、只摘 step"才照出它红。
    ⇒ 写减法臂时先问：**这一臂摘掉的代码是在抵消哪个压力源？那个压力源在臂里还在不在？**
    "摘掉 A 之后仍绿"有两种成因 —— A 真的不承重，或 A 的症状被探针一起关掉了；**只有一种读数能分辨，就是把压力源留着**（§8.90 第 6 节）。
14. **渲染层会替你重排的东西，源码里的编号就是第二套账 —— 凡按号引用，就要有一条"编号与位置一致"的常驻判据。**
    CommonMark 只认有序列表块内**首项**的字面值，其后一律按 `start + 序号` 重排 ⇒ 把第三条写成 `8.` 在渲染后**完全看不出来**，
    可是本线到处是按源码号在引用（`§8.76 第 8 条`），于是"第 8 条"会指到两条不同的东西 ——
    与 main 侧 traps 台账那 4 组同号不同事（任务 #20）**同一个成因，只是这里更隐蔽**：台账的号是写死的、渲染不会暴露它，
    而列表的号一旦渲染出来看着是"对"的，连看图都照不出来。
    ⇒ 落笔规则：**新增一类"按号索引"的账（台账、清单、规则表）时，同一趟就要问这一族的编号有没有常驻判据**；
    本批的答案是腿 10（§8.91），它上线那一趟就照出我自己那份清单里 6 条错位。

## 8.77 18:5x 合流面整趟复跑读数（**一次性瞬时量**，合流当时必须重取；载体 `78084007` × 实时 `main`）

`node scripts/verify-detail-pane-merge-preflight.mjs` ⇒ `CARRIER_RC=1`（属"处置未做完"，不是新红）：

| 档 | 读数 |
|---|---|
| 候选树 / 冲突 | `f4addfec` ／ **18 枚**（18:0x 是 17，多的那一枚是本批 `package.json` 那四个别名 —— 见 §8.73） |
| 纯 fs 门禁 | **21 道**：合并造成的红 **1**（`check-selection-single-source`，处置是 #16 那两行 trash `busyId` 豁免） |
| 没有对照组那一档 | **2** = `check-detail-pane-status-table`（⑦/#24 未做）+ `check-detail-pane-slot`（§3f 那一格未裁决） |
| 产物缺脚本 / 两边都红 / **名册漏跑** | 0 / 0 / **0**（新加的槽位判据同时进别名、链与名册 ⇒ 名册自检这一趟量到它了） |
| 静默合流 | **11 枚**，其中丢行/删文件/语法不过 **0** |
| 槽位唯一性 | `main=1 HEAD=1 产物=2 · **未判**`（那枚文件还带 marker ⇒ 它拒绝把"没判成"报成绿） |
| 台账 | 🔴 2 项（本批 `#215/#216` 与 main 同号不同事 —— #22 的活，只能在合流当时续号） |
| 仍带 marker 的产品文件 | **4 枚**：`App.tsx`（§3f，**要人**）/ `main-area.css`（§3c，**要人**）/ `habit-actions.ts` + 它的 spec（机械，执行器改法 3 拒绝 0） |

🔴 与 18:0x 那趟唯一的**语义**差别在"没有对照组"那一档的第二枚：同一棵产物树、同一个缺陷，
以前报的是"闭合标签配对解析不出来"（读起来像合并把结构合坏了），现在报的是
"槽区域里仍带冲突标记 ⇒ 没能跑（marker 未清）"（点名到 §3f 那一格）。**判据变好没有改变退出码，改变的是下一位去的现场。**

## 8.78 目标第 4 条点名的三样读数，此前**只有"截图"那一样有机器消费者**（2026-10-04 19:0x，载体续 `6abe4a56`）

§8 那张表的判据（`check:detail-pane-status-table`，工单 §8.67）此前有六条腿，对着目标第 4 条
"读数含**判据条数 / 变异红集 / 截图路径**"逐项比：截图那一档有腿 4，变异那一档只判"提没提到"（腿 6），
**判据条数那一样整个没有消费者**。本轮把后两样补成腿 7 / 腿 8，第一件事就是它照出我自己两格真缺：

| 现量 | 读数 |
|---|---|
| 补腿之后第一次跑 | `🔴 4 处不成立`：判据条数缺 = **W0 / W1c**；臂条数+红集缺 = **W0 / W1c** |
| 按定义处补完之后 | `承重：已开工且未走「无变异面」豁免 10 行｜判据条数命中 10｜臂条数+红集同句命中 10`，`RC=0` |
| 装置 | **23/23**（原 17 臂 + `J1 J2 J3 J4 J5` + 一把脱牙），`RIG_RC=0` |
| §1 闸门"干净检出复跑" | 提交**前**同一棵 `git archive HEAD` 的裸树上跑新脚本 ⇒ `CLEANTREE_RC=1`、红 4 处（那棵树的文档还没有本轮补的两格条数 —— 这正是 S7 那条臂改写期望的原因）；提交**后**再裸铺一份 `git archive HEAD` 跑 ⇒ **`CLEANTREE_RC=0`、承重 10 行 / 判据条数 10 / 臂条数+红集 10** ⇒ 两半（脚本与文档）必须在同一笔里，分两笔就会留一趟"门禁红而没人知道为什么" |

补的读数是**现取的**，不是回忆：W1c = `apps/web/tests/notes-selection-trace.spec.tsx` 9 条 + e2e `K8` 1 条
（`grep -cE 'it(|test(' 该文件` 得 9）；红集那一句的关键不是"九臂全红"，而是 **H4 第一趟存活**
（谓词换成常量 `true` 时门禁当时全绿）⇒ 补裸名分支后才转红，逐臂表在 §8.37。W0 = 判据 **0 条** +
`无变异面：` 带理由（那一格原先那句"这条没有变异臂"本来就是它的读数，写在表里才算被机器看过）。

### 1. 两条 needle 各被现量打回来一次，方向相反

- **窗口放宽 ⇒ 假绿**：判据条数第一版写成"判据与 `N 条` 之间 ≤12 字"，于是 W4 那格
  "三条恢复路径、持久化、判据"被当成有判据条数读数 —— 那一格从未声明过条数。
- **窗口收紧 ⇒ 假红**：收到 ≤6 字之后，W1 的"判据**：共享层 16 条"与 W8a 的
  "判据**：`packages/i18n/tests/habit-total-copy.spec.ts` 4 条"一起掉出射程。**掉的正是真读数那两格。**
- 正解是换判别依据：**按句取语义** —— 以 `。`/`；`/`<br>` 分句，要求**同一句里**既有"判据"又有"N 条/枚"。
  钉住这个决定的臂是 **J5**（把"判据"与"2 条"拆到两个句子，腿 7 仍须点名）；窗口版在 J5 上会直接假绿。
- 腿 8 同理收过窄：结果词只收"全红/各红/存活"时，W3「三臂各红在指定那一条」、W5「… ⇒ `ui` + `e2e` 红」、
  W8a「A1 …→红」三格被误报成没记红集 ⇒ 加一条"箭头 + ≤30 字内出现『红』"的形状。
  ⚠️ 反向也要防：**"逐臂"这种过程词不收**（"逐臂复原"只说明跑了每一臂，不说明每一臂的结果）。

### 2. 新腿把一条**旧臂**的期望打回来了（这一条比新腿本身更值得记）

S7 是"只给 `--root` 的产物树模式"那臂，原先断"提交态那棵树如果红，红必须报在**孤儿行**那一档"。
腿 7/8 一上线它就红：HEAD 那棵树里的 W0/W1c 两格还没有本轮补的条数 ⇒ 红在腿 7/8、孤儿行 0。
🔴 那不是判据坏，是**那条臂把我"还没提交"写成了前提**。改成断它真正要守的事：
**退 1 时必须有某一档点名，不许安静地红**（`sumLegs > 0`），红在哪一档不写死。
这是"判据不许把某一时刻的上游状态写死"这条纪律在本批的第二次应用（第一次是 18:3x 那条
"装置断的是候选产物里的行为，而工作树未提交" ⇒ 靶过时），这次是**期望值过时**。

## 8.79 目标第 1 条那句"把结论**与推荐**写回"，此前只有"结论"那一半有人守（2026-10-04 19:2x，载体续 `885142d1`）

`check:detail-pane-c1-coverage`（§8.59）三条腿判的是：C1 每行有对照节或写明例外、节不许回指不存在的行号、
每节有日期 + 出处。对着目标第 1 条逐项比，缺的正是"**与推荐**"那半句。现量法不是读代码，是**做一次减法**：

```
把 C1b-Q6 的推荐段整段摘掉（节标题、表格、日期、URL 都留着）
  → 旧判据：结论：…每个对照节都有日期与出处 ✅   RC=0     🔴 缺口成立
```

也就是"取证齐全但没有答案"那种文档形状，此前**任何一层都不会失败** —— 与 §8.78 那三样读数是同一个缺口，
只不过长在调研侧。本轮给它补成腿 4。

| 现量 | 读数 |
|---|---|
| 补腿前（减法对照） | 摘掉 Q6 推荐段 ⇒ `RC=0`（缺口） |
| 补腿后同一份减法 | `RC=1`，只红腿 4，点名 `:569 C1b-Q6 —— 行首加粗标签=[三条一手结论]`，其余三腿 0/0/0 |
| 现量文档本身 | `C1b 节 9 个（有推荐 8 / 标题写明不需要拍 1 / 缺推荐 0）`，`RC=0`（**零文档改动**：这一腿钉的是一个已经成立的性质） |
| 装置 | **18/18**（原 10 臂 + `M9a M9 M10 M11 M12 M13` + 两把脱牙），`RIG_RC=0` |
| 合流候选树（`merge-tree` 5e768a04） | 同一腿读数 `缺推荐 0` ⇒ **这条腿不新增"合并造成的红"** |
| main 那一侧 | 没有这枚脚本（`git cat-file -e main:scripts/…` fatal）⇒ 预检里仍归"候选红而 main 无对照"那一档，行为不变 |

### 1. 两个判别形状都是**量出来的**，不是挑的

- **行首加粗标签，而不是"整节含『推荐』二字"**：C1b-Q8 那张表里就有 Apple 原文
  "we recommend using a tertiary button" 的中文转述 —— 按整节含词判，把我们的推荐段摘掉、留着别人的话，
  照样绿。钉住这一条的臂是 **M11**（摘掉推荐段、只往正文塞一句含「推荐」的话 ⇒ 仍须点名）。
- **词形收 `推荐|建议` 两个**：§8.78 腿 7 刚实测过"触发词只认一种字面形状 ⇒ 下一轮换措辞判据静默失去对象"，
  这条臂（**M10**：把 Q6 那节写成「建议」⇒ 必须放过）是先挡**假红**的。现量 8/9 节写的是「推荐」，
  一个「建议」都没有 —— 也就是说 M10 放过的这一支今天是**空集**，它的价值在下一轮。
- **例外只从节标题认，不扫正文**：这条是 M13 逼出来的。C1b-Q1 正文里本来就有一句
  "⇒ 这条可以直接写进 W4 的判据，**不需要拍板**"，讲的是另一件事。若扫正文，摘掉 Q1 的推荐段之后
  那句现成的话就把它豁免了 —— 绕过判据最省力的写法永远是复用文档里已有的一句。
  M13 断的是"正文有那句 + 推荐段没了 ⇒ 仍须点名 Q1，且**例外数不涨**"。

### 2. 一条刻意**没有**补的腿，和它没补的理由

C1b 开头那句承诺是"每条带**出处 + 访问日期 + 一手/二手**，并给一个**带代价**的推荐"。
按上面同一套减法去量"代价"这一档：现量 **5/9 节**出现「代价」二字（Q1/Q2/Q4/Q5/Q13），
另三节写的是"为什么不选另一支"（Q8）、"贵的是产品面"（Q9~Q12）、"有同行依据的最小组合"（Q6），
Q7 是不需要拍的那一档。⇒ **建行首词表会当场造三枚假红**，而这正是本批拒绝的那种判据
（§8.78 那条"在自己的样本上说不清对错的判据不拦事"）。所以这一档留在散文里，并把这件事**写进承诺那句话本身**
（调研文档 §C1b 前言），免得下一轮有人把它当成"已经有人守了"。

### 3. 顺手清掉两份抄件（都在调研文档 §C1b 那两处前言）

- 装置臂数被抄成 `10/10` ⇒ 改成立即可复跑的命令（本轮就漂了一次：10 → 18）。
- 取证量被抄成 `URL 56 次 / 去重 55 条`、`file:line 5 处` 而**没带口径** ⇒ 19:1x 复跑读到
  区段内 `55 / 去重 54`、`file:line 38 处`。差的不是文档，是"5 处"从来没说明排不排 Q2 那张逐行表的 33 处。
  现在那句话换成一条把口径写全的 `node -e` 命令，数不再落在文档里。
- ⚠️ 判据的结论句本轮从"…每个对照节都有日期与出处 ✅"改成"…都有日期、出处与推荐那一档…"，
  所以 **§8.59 与 §8.64 里引的那两行是当时的原文，不是现在的输出**（读的是那一趟，不是当前态）。

## 8.80 19:2x 合流面整趟复跑（新腿 4 在产物树模式下的第一次真实负载；**一次性瞬时读数**，合流当时必须重取；载体 `be9b909c` × 实时 `main`）

补完腿 4 就把整趟预检重跑了一遍，理由不是"顺手"：这条腿读的是**文档结构**，而合流产物里那篇调研文档
是两侧各自的行拼出来的 —— 正是 §8.52 那条"判'合并有没有合错'要问两侧都改过的文件集合"的对象。

| 现量 | 读数 |
|---|---|
| 候选树 | `TREE=847a8321`，冲突 **18 枚**（18:5x 是 18） |
| 21 道纯 fs 门禁 | **合并造成的红 = 1** ｜候选红而 main 侧没有这道脚本（本分支新增，只能拿本分支读数定性）**= 2** ｜产物里根本没这道脚本 = 0 ｜两边都红 = 0 ｜名册漏跑/探针坏 = 0 |
| 那唯一一枚 | `check-selection-single-source` 断言 G：`apps/web/src/features/trash/TrashView.tsx busyId` + `apps/mobile/src/screens/TrashScreen.tsx busyId` 未登记 —— **这正是 #16 那两行 trash 豁免**，§8.47 第 4 节写的"先跑、红了才加"就是它，不是新增缺口 |
| 腿 4 在产物树上 | `check-detail-pane-c1-coverage` 候选=**0**，结论句已带"与推荐那一档" ⇒ **新腿在合并态零假红**（main 那份是旧修订版，拼出来的文档 9 节仍全有推荐/例外） |
| §8 表那一路 | 产物树里 `check-detail-pane-status-table` 报 **13 枚表外孤儿工单行** ⇒ 就是 #24（main 带回的那整段 13 行旧抄件），处置不变：合流时整段丢掉 |
| 带 marker 的产品文件 | 4 枚（`App.tsx` / `main-area.css` / `habit-actions.ts` / 它的 spec）—— 与 18:5x 同一集合 |
| 静默合流 | 11 枚，逐枚"两侧新增行都在"，`App.tsx#detail-column` 那一枚仍标**未判**（它自己还有 marker，按 §8.47 第 3 节解完再跑） |
| 编号台账（#22 那一格的现量） | `environment-traps.md`：条目 main=224 / HEAD=177，两侧各新增 +49 / +2，新增号与各自正文在产物里**都在**；🔴 **同号不同事 2 组（215 / 216）** —— 就是本篇 14:1x 记下的那一格，处置固定为"先落 main 的号不动、后到的续到 main 最大号 228 之后"⇒ **起点 229**，要 sweep 的引用**现量 16 行 / 29 处**（这两个数每趟重取，本篇不抄） |

📌 这一趟值得记的不是数字，是**没有新增要人的格子**：唯一一枚合并造成的红和那 13 枚孤儿行都各自有编号（#16 / #24），
且两条的处置都是"合并当时做"，不需要任何人拍。⚠️ 现场数字全部是瞬时量（`main` 在本批写这一节期间还在走），
合流当时要重取：`node scripts/verify-detail-pane-merge-preflight.mjs`（它自己会重新造候选树、重取名册）。

## 8.81 复量照出 Goal 第①条那份"收口读数"是张**没有口径的手抄表**：8 行只有 2 行逐字复现（2026-10-04 19:2x，零代码改动）

调研文档 C1 下面那张「节 / = C1 / 出处 URL / 日期串 / 未核实标记」表是 13:1x 那趟逐项对账的产物，
标题就写着"Goal 第①条的收口读数"。这一轮补完腿 4、顺手按"出现次数"口径把它重数了一遍（取法与门禁同源：按 `### ` 切节）：

| | |
|---|---|
| 逐字复现 | **2/8** —— Q1 `5/1/0`、Q8 `4/2/5` |
| 差 1–2 | Q2 `1/5/0` vs 表 `1/4/1`、Q4 `15/3/1` vs `15/2/1`、Q5 `9/5/0` vs `9/3/0`、Q6 `9/3/1` vs `9/1/1`、Q9~Q12 `8/2/0` vs `10/1/0` |
| 🔴 整列对不上 | **Q7 表里写 URL=3 / 日期=4 / 未核实=4，那一节今天 `https://` 命中 0**、日期出现 1、`未核实` 0 —— 它的取证全是 `file:line` 与仓库内 md 路径 |

🔴 差 1–2 的那五行我**判不出**是"13:1x 之后又被编辑过"还是"口径不同"（去重 vs 出现次数能解释部分，但不是全部），
所以这一节不写结论式的归因 —— 按老纪律，说不出成因就只登记现象。

要紧的不是这五行，是**这个形状本身**：一张机器读数的抄件，落笔时没带取法、没带口径、没带"哪一趟"，
于是下一轮想复核只能重新猜 —— 而它管的正是 Goal 第①条那句"带日期+出处+未核实标记"的**收口证据**。
处置（写在文档本体，不新开文件）：

- 原行**留着不划**（它是那一趟的记录，划掉等于抹掉一次读数存在过的证据）；
- 表头上方加一段：这张表**已被门禁自己打印的逐节读数取代** ——
  `check-detail-pane-c1-coverage` 的「逐节读数」段打印同样四列，19:2x 起再多一列 `推荐=`，
  且每次跑都是现量的；引用这一格要给门禁输出，不给这张表。
- 本篇 §8.32（13:1x 那次逐节量的记录）不动，它记的是"当时量到了什么、当时改了什么"，不是当前值。

📌 这是本批第三次撞到"抄件一定会漂"（前两次：装置臂数 `10/10`、取证量 `56/55`，都在 §8.79 里清了）。
**三次都同一个成因**：把一条已经有机器消费者的读数又抄了一份进散文/表格，而抄的那份不带"怎么取的"。
可迁移的动作：**写完任何"N 次 / N 条 / N 处"，同一句里必须跟着取法或那条打印它的命令**，否则就只写指针。

## 8.82 🔴 Goal §1 那道"两道余量为 0 的棘轮**不许调高基线**"到今天仍只有散文在守（2026-10-04 19:3x 现量 A/B，零改动）

这一条不是我推断的，是**做了一次 A/B**：把两道棘轮的门禁各拷一份到 /tmp（它们自带
`HEYTA_CHECK_ROOT` 这个旋钮，所以扫描根仍指回真实工作树 ⇒ 载体有效），只把常数 +1，其余字节不动。

| 趟 | 常数 | 退出码 | 它自己打印的那句 |
|---|---|---|---|
| 对照（原常数） | `baseline: 90` / `HT_FAMILY_BASELINE = 28` | **0 / 0** | `✅ … 90 处，恰在基线 90（未新增）` / `✅ … 28 个，恰在基线 28` |
| 变异（各 +1） | `baseline: 91` / `= 29` | **0 / 0** | `✅ … 90 处 ≤ 基线 91（**已降 1 处**）` / `✅ … 28 个 ≤ 基线 29（M3 中**已降 1 个**）` |

🔴 也就是说：调高基线不但不会红，**门禁还会把它打印成一次改进**。
两道棘轮的"只减不增"里，机器守的是"新增不许超"，而"不许把上限本身抬高"这一半**没有任何一层在看** ——
这正是 §1 闸门第 2 条与 §6 第 9 行要拦的动作。⚠️ 顺带一处同族现量：
`apps/web/src/features` 那一档今天是 **98 处 / 基线 104（余量 6）**，门禁只打印一句"建议下调"就退 0 ——
所以"余量为 0"只对 Goal 点名的那两道成立（mobile l4 90/90、`ht-*` 前缀族 28/28），
第三道（web l4）有 6 的余量。**引用"两道余量为 0 的棘轮"时要带这一句**，
否则下一轮会把 web 那一档也读成满的。

### 1. 为什么不在这批直接把它补成门禁（三种形状，两种要动别人）

- **(A) 让基线成为派生值**：把 `count < baseline` 也算红 ⇒ 调高结构上不可能通过，
  减了债不改常数也会红（那正是门禁自己那句"建议下调"的硬化版）。
  代价：这是**改共享门禁的语义** —— 全仓任何一条线减样式都要顺手改常数；
  且 web 那一档若同规则要立刻从 104 降到 98，那个常数不是本批写的。
- **(B) 拿历史当锚**：另建一道门禁，把这两个常数与 `main`（或 merge-base）那一侧的值比，只许 ≤。
  代价：它必须有 git ref；产物树 / 无 `origin/main` 的干净克隆上"取不到锚点"要**响亮失败**，
  那就得先实测 `pnpm check` 在各种形态下都拿得到 ref，否则造出来的是"一条永不开的门"。
- **(C) 只加打印**：等于现状，无牙。

📌 本批**没有**选任何一支，也没有代任何人改常数 —— 这不是"待办漏做"，是一格**要人的裁决**：
(A) 最便宜但动共享语义、(B) 最不动别人但要先验 ref 可得性。已登记成任务，题面就是上面这张表。

### 2. 取证载体那一步差点骗过我

第一版 A/B 是把改过的脚本拷到 /tmp **裸跑**，两趟都 `RC=1` —— 看着像"调高基线确实会红"。
读日志才知道那两枚红分别是 `🔴 找不到扫描根 apps/web/src/features` 与
`ERR_MODULE_NOT_FOUND：/private/tmp/ratchet/lib/jsx-tree.mjs`：**载体没跑起来**，
而它的退出码与"门禁查到红"逐字同形（本批第 N 次撞这一类，traps 里"空测量看着最干净"那条）。
⇒ 用 `HEYTA_CHECK_ROOT` 把扫描根显式指回真实工作树 + 整个 `scripts/` 一起拷（带上 `lib/`）之后，
才是上面那张表；对照趟也补了（原常数在同一载体下 `RC=0`，证明载体有效）。

## 8.83 §1 那四道前置闸门逐道量过**载体形态**：只有第 4 道是结构性守的，第 2 道半有牙，第 1 道只有散文，第 3 道有装置但不在链里（2026-10-04 19:4x 现量，零代码改动）

🔴 **本节第 1 道那句"只有散文"已被 §8.92 取代**（2026-10-04 21:0x）—— 当时判"不建"的理由是
把形状想成了"这一笔的文件集合 ⊆ 本线路径"，那个形状确实会在任何合法合流上假红；
真正可机器化的形状是"**点名要动的这几条路径，此刻在主检出干不干净**"，它不在合流那一趟跑，所以不会假红。
第 2/3/4 道的结论不变。

Goal 第③条要求"每单遵守工单 §1 四道前置闸门"。这一节的任务不是再声明一遍，而是逐道回答
**"这一道要是被违反了，会有什么机器东西失败"**（现量：读链的定义处，不读散文）。

| §1 闸门 | 违反了会怎样 | 载体形态 |
|---|---|---|
| 1 归属门（不代改别人在飞的活） | ~~🔴 **什么都不会失败**~~ ⇒ 现在会红：点名的路径若在主检出有未提交改动 ⇒ `RC=1 BLOCKED=N`；点错名 ⇒ `RC=2` 响亮报探针坏 | **21:0x 起有载体**：`scripts/verify-detail-pane-ownership.mjs`（要点名路径，读主检出活树的未提交集合；§8.92）。本行原来那句"可机器化的形状是『这一笔的文件集合 ⊆ 本线路径』，但那会在任何一次合法合流上假红 ⇒ 不建"，这句**只对那个形状成立**——换一个问法（提交前逐条问"这条路径此刻被谁占着"）就没有那个假红面，因为载体不在合流那一趟跑。教训：**"不建"要连想过的形状一起记，否则下一个人会把整道门读成"建不出来"**。 |
| 2 两道余量为 0 的棘轮不许调高基线 | 🟡 **一半有牙** | "新增不许超基线"有牙（`count > baseline` 退 1）；"不许把 baseline 本身抬高"**无牙** —— 常数 +1 后两枚门禁仍 `RC=0`，还会打印成"已降 1 处"。A/B 与三种候选形状在 §8.82，已登记成要人的裁决（本批没选、没改常数）。 |
| 3 干净检出复跑 | 🟡 **有装置、不是常驻** | `scripts/verify-detail-pane-merge-preflight.mjs` 会把整棵树重铺到 /tmp 再跑 21 道纯 fs 门禁 + 与 main 做对照 —— 但它是**手动那一趟**（§8.77 / §8.80 各跑过），不在 `pnpm check` 里。⇒ 这一道守的是"我这轮跑过没有"，写进 §8 表那一格才算数（腿 7/8 量的正是这件事，§8.78）。 |
| 4 packages 改完先 build | ✅ **对本线判据零暴露面** | 两道证据：① `pnpm check` 的**第一步就是 `pnpm build`**（现量 `scripts.check.split("&&")[0]`），全链跑到底时这一道是**结构性**满足的，不需要谁自觉；② 本线那四枚判据现量只读**文档与源码** —— 前三枚读 `docs/plans/detail-pane-alignment.md` / `docs/research/…`，槽位那枚读 `apps/web/src/App.tsx`（源码不是 `dist`）⇒ 旧构建产物**改变不了它们的读数**，traps #27 那个"门禁绿而 APK 里是旧 bundle"的形状对本线判据不适用。 |

📌 值得记的是第 4 道那个 ✅ 的**取法**：我原本要登记的是"§1 第 4 道只有散文在守"（因为仓库里没有任何门禁比较
`packages/*/dist` 与 `src` 的 mtime —— 这句仍然对）。但把范围收到"本批的判据"再量一遍，
结论就不是缺口了：这些判据**根本不读构建产物**。⚠️ 同一条纪律反过来也成立 —— 这一格**不许**被读成
"packages 改完可以先 build 再跑判据这件事已经有人守了"：守的是**链的顺序**与**本线判据不读 dist**这两件事，
任何一枚 `import` 构建产物的行为判据仍然照旧依赖"先 build"，而且这一批里那种判据**不是少数**：
`apps/web/tests` 下 **92** 枚文件 `import … from '@heyta/'`，`packages/ui/package.json` 的 `exports`
三条全指 `./dist/*`，而 `apps/web/vite.config.ts:17` 自己就写着"Vite 解析到它的真实路径 `packages/ui/dist/`"。
⇒ 那一半今天只有 `pnpm check` 的第一步在管；单独跑 `pnpm --filter @heyta/web test` 时，
**没有任何东西会因为你改了 `packages/ui/src` 而提醒你 dist 是旧的**（traps #27 那个形状）。
这条不归本批修，写在这里是为了下一轮别把它读成"已由链结构性解决"。

## 8.84 Goal 五条**逐条对账**（2026-10-04 19:4x 现量；本轮载体 `79f575d6`→`3faa8232` 共 8 笔，未 push 未 merge）

⚠️ **这一份的覆盖面已被 §8.89（20:2x）取代**：① 多了腿 5（外部锚）、④ 多了腿 9（码段裸竖线）、合流面重量过。
下面那张表**保留当趟读数**（它记录的是 19:4x 那一刻的事实），要现在的答复请读 §8.89。

按 AGENTS §7 第 7 条的口径逐条回答"这一条做到哪一步、由什么守着"，**不重述细节、只给指针与读数**：

| Goal 条 | 现在的机器消费者 | 19:4x 现量读数 | 指针 |
|---|---|---|---|
| ① 五项待拍值做外部调研，带日期+出处+未核实标记，**结论与推荐**写回 C1 | `check:detail-pane-c1-coverage` 四腿（对照节 / 例外类别封闭 / 孤儿节 / 日期+出处+**推荐那一档**）+ 装置 18/18 | C1 **13 行**（有节 12 / 例外 1 / 未覆盖 0）｜C1b **9 节**（有推荐 8 / 标题写明不需要拍 1 / 缺推荐 0）｜"未核实"那一档**刻意不建**（判不了"哪句话缺一手"），`代价` 那一档也刻意不建（5/9 同义形状） | §8.59 / §8.79 / §8.81 |
| ② 执行不依赖拍板的 W0–W8，W1 做成**跨视图通用**机制 | `check:selection-single-source` 断言 A–H（八道，含"谁读某一类选中就得把那一类喂进回落"）+ 五枚装置在 `research/tools/mutation-rigs/`（`…-f` / `…-f-fallback` / `…-g` / `…-h` / `mutate-timeline-face`；**臂数不抄在这里**，现取各 rig 最后一行） | W0–W7 + W1b① + W1c 的代码、判据、变异、截图**闭合**，八行只差 AGENTS §6.1.1 四端重装；**W8 整单阻塞在拍板 #2 的三个口径值**，W1b②③ 阻塞在 #1/#8；"同一套**回落规则**"实测两端形状不同，已量过并判定不动（要统一得先写进 W1 判据修订 = 要拍板） | 本文 §5（1009 行起）、§8.28、§8.32、§8.43 |
| ③ 每单守 §1 四道前置闸门 + §4 验收动作 + §6 六条不做 | §1 逐道量过载体形态；§4 的"判据必须配变异臂"由每单的 rig 读数守；§6 九行逐行量过载体 | §1：**只有第 4 道是结构性守的**（链第一步 = `pnpm build`），第 2 道半有牙（调高 baseline 无消费者，A/B 已做），~~第 1 道只有散文~~（**21:0x 起有载体**，§8.92）；§6：**7 行有常驻载体**（第 1/2/3 行=槽位门禁、第 5 行=8 条界面用例每次 check 都跑、第 7/8/9 行=migrations/layering/棘轮"不许超"那一半），**2 行有裁决指针**（第 4/6 行，§8.39 §1b 写明为什么不建门禁） | §8.82 / §8.83 / §8.39 / §8.74 |
| ④ 每完成一单回填 §8（读数含判据条数 / 变异红集 / 截图路径），状态只许三档 | `check:detail-pane-status-table` **八腿**（行闭合 / 状态三档封闭 / id 唯一 / 提了截图就得有引用 / 表外无工单段 / 变异读数 / **判据条数** / **臂条数+红集同句**）+ 装置 23/23 | 已开工且未走豁免 **10 行**：判据条数命中 10、臂条数+红集命中 10、截图引用另有 `check:detail-pane-evidence-refs` 守；§8 表在产物树里那 13 枚孤儿行 = #24（main 带回的旧抄件，合流当时整段丢） | §8.78 / §8.80 |
| ⑤ 共享工作树点名提交、不代改别人在飞的活、不 push 不 merge | `scripts/verify-detail-pane-ownership.mjs`（§8.92，逐条点名路径 × 主检出活树；提交前跑）+ 每次 `git status` 现量 | 本轮 **8 笔全部 `git commit --only <点名路径>`**；工作树对本轮零残留（只剩恒脏的 `scripts/mutate-closeout-gates.sh` 与两枚 `node_modules` 软链）；**未 push、未 merge**；未改任何别人的基线常数；docs-link-check 那枚红（`PROGRESS.md`→aed）按现量属本支落后，**代改=违规**，只登记 | §8.80 |

### 还欠谁什么（本批不动的格子逐条有主，不许被读成"漏做"）

- **要产品负责人拍**：#1（选中那一格换什么，§3f 已是一枚具体代码冲突）、#2（W8 的三个口径值）、#8、
  #13（收起详情面时格里的东西跟着藏还是搬家，C1b-Q13 给了带代价的推荐）、
  以及 §8.82 那一格（棘轮"不许调高基线"要不要硬化）。
- **要合流当时做**（不需要任何人拍）：#16 两行 trash `busyId` 豁免（19:2x 预检现量它仍会红）、
  #22 traps 续号（起点按当时 main 最大号，19:2x 读到 228 ⇒ 从 229 起）、#24 丢掉 main 带回的 13 行旧表、
  #21 按 5 份 spec 名单重跑 e2e + 槽位唯一性、#13 四端重装（真实前置=合流落地+截图重出）。
- **要授权**：#20（main 台账自己 4 组同号不同事，修它要给别人的条目改号 + 动 AGENTS.md）。
- **要设备窗口**：#17（真机那一格便签编辑层回落；`adb` 现量 0 台 device，iOS 那三台正被并行线用）。

## 8.85 🔴 #21 那张"合流后重跑 5 份 spec"的名单**今天起跑不了**：带 marker 的那四份文件正被 34 枚 web 判据直接吃（2026-10-04 19:5x 现量）

§8.54 把"解完 §3f 那一枚后要重跑哪五份 spec"列成了 #21。这一节量的是它**没写的那一半前提**：那五份
（以及全链 jsdom）在合并产物里**跑不跑得起来**。答案是跑不起来，而且是结构性的：

| 现量对象 | 读数 |
|---|---|
| 候选树里仍带冲突 marker 的产品文件 | **4 枚**：`apps/web/src/App.tsx`（marker 行 3）/ `apps/web/src/styles/app/main-area.css`（6）/ `packages/app-host/src/habit-actions.ts`（3）/ `packages/app-host/tests/habit-actions.spec.ts`（3） |
| 直接 import 这四份的界面判据 | `apps/web/tests` **34 / 119** 枚；`packages/app-host/tests` **3 / 49** 枚（口径：正则 `from '(\.\.)+/App\|src/App\|features/focus\|habit-actions`，只数**直接**引用，传递闭包只会更大） |
| 真实暴露面 | main 还带进它自己的新 spec ⇒ **≥ 34** 是下界不是全量 |

🔴 这与预检自己末尾那句"上面 21 道门禁量的**不是一个能编译、能运行的状态**"是同一件事的**行为层版本** ——
那句话此前只落在文字上，没人量过"那么到底有多少判据吃它"。现在有了：**起跑线是 marker=0，不是"冲突枚数少"**。
⇒ 接上 §8.40 的 v2 判据：v2 逐枚问"要不要人裁"决定的是**人工量**，这一节决定的是**验真的顺序** ——
清 marker 之前跑任何 jsdom / e2e，得到的红**没有一条有信息量**（它们全是同一枚未裁决 hunk 的回声）。

### 1. 不在本批跑它的理由，与将来那条命令

不跑的理由不是"贵"，是**读数不可解释**：`App.tsx` 带 marker ⇒ 34 枚判据一起炸 ⇒ 我无法区分
"合并合坏了"与"marker 还没清"。这正是 §4"不能失败的检查没有价值"的反面 ——
一次**必然失败**的检查同样没有价值。marker 清完之后（即 #19 那一枚要人的裁决落地之后）先断言再跑：

```bash
TREE=$(git merge-tree --write-tree main HEAD | head -1)
for f in apps/web/src/App.tsx apps/web/src/styles/app/main-area.css \
         packages/app-host/src/habit-actions.ts packages/app-host/tests/habit-actions.spec.ts; do
  printf '%-52s %s\n' "$f" "$(git show "${TREE}:${f}" | grep -cE '^<<<<<<< |^=======$|^>>>>>>> ')"
done
# 四行全 0 才去铺产物树跑 vitest（本检出跑不了：linked worktree 没有可用的 node_modules 链）
```

### 2. 取证时我自己踩的那个坑（第 7 条待入 traps）

第一版取证写的是 `git show "$TREE:apps/web/src/App.tsx"` —— **zsh 把 `$TREE:a` 吃成了绝对路径修饰符**，
命令实际查的是 `/…/13026ca2…pps/web/src/App.tsx` 这个不存在的路径，而它 `grep -c` 的结果是 **0**。
症状就是一个干净的假 0："候选树里没有 marker ⇒ 可以直接跑行为判据" —— 恰好是这一节想否证的那个结论。
加花括号 `"${TREE}:${f}"` 之后才读出 3。
⇒ 一般规律：**拼 `<rev>:<路径>` 时冒号左边必须带花括号**；而**任何"0 命中"要先证明对象存在** ——
这次 `fatal: ambiguous argument` 就打在同一个读数里，被我当噪声略过了（traps 里"空测量看着最干净"那一族的又一副面目）。

## 8.86 🔴 本轮**我自己写进表里**的三处"码段裸竖线"，前八条腿一条都没红 —— 补成腿 9，并让 HEAD 那版判据跑同一份变异来证明这不是顺手加严（2026-10-04 20:0x 现量，载体续 `4d5b447f`）

§8.78 那两条新腿上线之后，我继续往这张表里补读数，然后拿一个 7 行的一次性脚本扫了一遍**全文的表格行**
（逐个 code span 找未转义的竖线）。照出三处，全是我这几轮自己写的。**⚠️ 下面三行故意写在表外**——
它们的内容就是"码段里有裸竖线"，把同样一句话放进表格单元会当场再犯一次同一个错（腿 9 会点名它，
而这条判据不该用来抓自己的示例）：

- **139 行**（W1c 那一格，已随 `be9b909c` 提交）：写的是 `` `grep -cE 'it\(|test\(' 该文件` ``。
- **4901 行**（腿序登记表，已随 `dc0bd50f` 提交）：写的是 `` `EXC = /无变异面[：:][^|]{4,}/` ``。
- **5644 行**（§8.85 的合流面读数表，本轮当时还没提交）：写的是 `` `from '(\.\.)+/App|src/App|features/focus|habit-actions` ``。

三处坏在**单元内部**而不是行的边界：行仍然闭合、仍在表区间里、状态格没动、"判据 N 条"与臂条数也都在 ——
所以八条腿问的那八件事**一条都不会变红**。而 GFM 切单元发生在**解析行内结构之前**，反引号护不住竖线：
这三格渲染时各被劈成一格半，列当场错位，纯文本 diff 完全看不出异常 ——
它不是"渲染不好看"，是**这张表的可读性与判据射程从此对不上**。
修法是 GFM 要求的转义式（裸竖线写成反斜杠加竖线，渲染回来就是竖线，命令照抄仍然能用），**不是删竖线**。

### 1. 两条射程决定各钉一臂，一条"旧判据必须绿"钉住缺口本身

腿 9 的形状（`scripts/check-detail-pane-status-table.mjs`）：按 CommonMark 的定界规则配反引号串
（闭合串与开启串**等长**才算闭合，不等长的那一串是码段里的字面反引号），只对**表格行**取码段，
段内出现未被反斜杠转义的竖线即点名。反引号**不成对**的行跳过并单独报数 —— 宁可少判一行，
也不要造出一条说不清对错的假红；跳过数打进承重读数，`K>0` 就是探针没射程的信号。

| 臂 | 变异 | 现量读数 |
|---|---|---|
| P1 | §8 表某一格的码段尾部注入裸竖线 | 🔴 **恰好 1 条红在腿 9**，其余八条腿全 0（"坏在单元内部"的机器版本） |
| P2 | 同一处改写成转义式（反斜杠加竖线） | **RC=0** ⇒ 这条腿判的是"裸"竖线，不是"码段里不许出现竖线"；它挡住"为了让门禁闭嘴把口径正则删短"那种改法 |
| P3 | 靶换到 §8 区间**之外**的另一张表 | 仍须点名且带 `(非§8表)` 标记，**恰好 1 条** ⇒ 钉住"射程 = 整份文档的表格行"这个决定。三处真写坏的里面有两处在 §8 区间外，只扫 §8 等于把三分之二对象排除 |
| P4 | 把 **P1 同一份变异文档**喂 `git show HEAD:` 那版判据 | **RC=0**（它的结论句是"八项都成立"）⇒ ~~这一族此前零消费者~~ 🔴 **这句 20:1x 被否证两次，见 §8.87**：① 范围只对**本支**成立 —— main 上有一条共享门禁 `check:md-tables` 从 18:1x 就在管这一族（它按列数判）；② "按 HEAD 取旧版"这个取法会随我自己的下一笔提交自己变红，已改成**按内容从文件历史里认**（现量取到的是 `79f575d6` 那版，RC=0 仍成立） |
| 脱牙 | 摘掉 `pipeRows` 的命中集合 | P1/P3 两臂**全部失能**（有一条仍红 = 它没挂在这条腿上） |

### 2. 读数（现取，别手抄）

| 现量对象 | 取法 | 读数（2026-10-04 20:0x） |
|---|---|---|
| 门禁本体 | `node scripts/check-detail-pane-status-table.mjs`，读它输出的 `承重(腿9)` 那一行 | `RC=0`，九项都成立；**承重的两个数只有"跳过 0 枚"与"裸竖线 0 处"是这一档的判据** —— 表行总数与含码段行数**故意不抄**：本文件每追加一段它们就涨（写下"833/504"的那一趟，追加完同一命令已经读到"847/512"），抄进表格就是 §8.81 那条纪律第五次应验，而且这次是我自己刚写完就漂 |
| 判据条数 | `grep -c '^dump(' scripts/check-detail-pane-status-table.mjs` | **9 条腿**（八条 → 九条）。这是本线第一次把"腿数"从文件里读出来而不是抄散文里那句"八项"，所以它自己也是一个可复跑的读数 |
| 装置 | `node research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs` | `RIG_RC=0`，**28/28 臂符合预期**（原 23 臂 + `P1 P2 P3 P4` + 一把腿 9 脱牙）；逐臂红集见上面那张表。**无界面格**（纯判据单，不产截图） |
| 干净检出复跑（两半同一笔） | 新判据喂 `git archive HEAD` 铺出来的**旧文档** | `RC=1`，腿 9 点名 **2 处**（139 / 4901；第三处 5644 当时还没提交）。⚠️ 这趟的临时树在 `/tmp`，会随机器没掉，**不作为可复跑凭据** —— 复跑取法就是这一栏左边那一句。提交后再铺一份应 `RC=0`，那一半留给下一位 |
| 同批其它门禁 | `check-detail-pane-c1-coverage` / `-evidence-refs` / `-slot` / `check-docs-voice` / `check-script-snapshot` 各一趟 | 全 `RC=0`。本轮只动文档与这两份判据文件，**无产品源码改动 ⇒ 不涉 build 前置** |

### 3. 一般规律（这条比腿本身值钱）

1. **判据的射程要和渲染层的切分规则对齐。** 八条腿全在"行"这一层找问题（闭合、区间、状态格、档位），
   而 GFM 的破坏可以发生在**单元**这一层。同一个表格，两层出的故障长得完全不同：
   行层坏 ⇒ 表截断、整段掉正文（§8.67 那次事故）；单元层坏 ⇒ 表还是那张表、列错位、diff 干净。
   🔴 所以"这张表已经有 N 条腿了"不构成"这一族有人守"—— 要问的是**这 N 条各读哪一层**。
2. **一次性扫描照出来的缺陷，转常驻腿时要带一条"旧判据喂同一变异必须绿"的臂。**
   它同时回答两个总被质疑的问题："这算不算真缺口"（旧判据 `RC=0` = 当时确实没人管）与
   "这算不算加严"（新判据只在被实测写坏过的那个形状上红）。本批第四次用这个形状
   （腿 4 的 M 组、腿 7/8 的 J 组、S7 的期望改写），它已经把"补判据"从主张变成读数。
3. 我这几轮补读数**本身就是这个缺陷类的生产者**：目标第④条要求读数含"判据条数 / 变异红集"，
   而这类东西天然要写 grep 与正则，正则里就有竖线。
   ⇒ **要求写得越具体，就越要有一条腿管住它的书写形状**，否则"补全读数"这个动作会持续生产新的坏表。

## 8.87 🔴 main 上**早就有一条共享门禁**在管这一族，而且它照出我这九条腿照不到的 5 处（2026-10-04 20:1x 现量，载体续 `3cb6a8d8`）

§8.86 补完腿 9 之后我去量合流窗口（`scripts/verify-detail-pane-merge-window.mjs`，只读），
读数的副作用是看见对面那条链里多了一枚 `check:md-tables`。**同一族的缺陷，对面 18:1x 就已经有常驻门禁了**，
而它不在我的分支上 —— 于是 §8.86 那句"这一族此前零消费者"**只对 `feat/detail-pane` 成立，对整个仓库不成立**。

### 1. 那条共享门禁判什么，本线九条腿判什么（现取：`git show main:scripts/check-md-table-rows.mjs`）

| 它的判据 | 本线腿 9 | 本线其余八条腿 |
|---|---|---|
| 每一行的**列数 vs 该表表头**（按未转义竖线数） | 不判 | 不判 —— 文件头明写"不判列数等于表头"，理由是本表读数栏**合法地**含竖线、而掩码两次实测都漂 |
| 表格行被**折成多个物理行** | 不判 | 部分（腿 1 只问"有没有闭合竖线"，腿 5 只问"这一段是不是表"） |
| 表头下面**必须紧跟分隔行**（否则整块没有可比对象） | 不判 | 不判 |
| code span 里的裸竖线 | **直接命中** | — |
| §8 表的内容档位（状态词表 / 判据条数 / 臂条数+红集 / 截图栏位） | — | **命中**（共享门禁不判这些） |

⇒ 这两条**不是重复**：共享那条管"这张表在 GFM 里成不成立"，本线这九条管"这张表有没有把 Goal 第④条要求的读数写齐"。
但"码段裸竖线"那一格确实重叠了 ⇒ 合并时有一枚要变成指针（登记成 #29，本支不抢着改别人的脚本）。

### 2. 拿它扫我这两份文档：5 处，逐处都是真缺陷

复跑取法（不需要先合并）：`git show main:scripts/check-md-table-rows.mjs` 取到临时文件，把里面的 `FILES`
换成本线这两份文档，`cwd` 设在本 worktree 跑。**20:1x 第一趟 `RC=1` 报 5 处**：

| 处 | 形状 | 为什么九条腿全放过 | 处置 |
|---|---|---|---|
| 本文件 `:2299`（那张四列表「§6 行 / 探针 / 读数 / 这之后有没有常驻载体」的第 5 行） | 一个逻辑表行**折成三个物理行**（2299/2300/2301） | 最后一行结尾**有**闭合竖线 ⇒ 腿 1 不红；这几行不在 §8 表区间 ⇒ 腿 5 也看不见 | 三行并回一行（并回前先断言前两行确实未闭合、第三行确实闭合，且并回后未转义竖线数 = 5 即四格） |
| 本文件 `:2302` | 表中间一个**空行** ⇒ GFM 在此截断，后面 `\| 6 …` 与 `\| 7 …` 两行变成**没有表头的碎片** | 同样不在 §8 区间；而"没有表头"让**列数判据对整个碎片失效** —— 对面文件头写的"第三类"与此**逐字同形** | 删空行，让那两行回到同一张表 |
| 本文件 `:4688` | 码段内容**就是一根裸竖线**（"收尾的竖线落在那 20 行的最后一行上"那个句子） | 🔴 **腿 9 第一版自己放走的**：匹配式写成"竖线前面必须有一个非反斜杠字符"，段首没有前驱字符 ⇒ 读不到 | 文档侧改转义式；判据侧匹配式补 `^` 分支 |
| 本文件 `:4902` | 同一形（另一张表的②那一行） | 同上 | 同上 |
| `docs/research/detail-pane-alignment-and-spaced-review.md` | 0 处 | — | 无需动 |

修完复跑三个读数：**共享门禁 `RC=0`**（两份文档）、**本线九腿门禁 `RC=0`**、**装置 30/30 臂**
（新增 `P5` 钉"段首式必须点名"、`P5e` 钉"同一形的转义式放过"，腿 9 的脱牙臂从 P1/P3 两臂扩成 P1/P3/P5 三臂全部失能）。

### 3. 三条可迁移的（比这 5 处值钱）

1. **"我的 N 条腿全绿"既不等于"这一族有人守"，也不等于"我的文档干净"。**
   九条腿全绿的那一趟，共享门禁对同一份文件报 5 处。先问**"还有谁管这个对象"**，再问"我这几条腿够不够"；
   而"还有谁"这一问在合流窗口测量里顺手就答了 —— `git show main:package.json` 里那串 `check:*` 就是名册。
   🔴 反过来也成立：本线那两条 `check:detail-pane-*` 对面也看不见，所以合流时 `package.json` 只能**取并集**。
2. **对照版本要按内容认，不按 HEAD 取。** P4 那条臂写下时 `git show HEAD:` 就是"还没有腿 9 的那版"，
   而腿 9 一提交，HEAD 立刻变成九腿版 ⇒ 20:1x 这条臂**自己红了**（红的原因是历史前进了，不是判据坏了）。
   改成"沿这个文件的提交往回走，取最新一版**不含腿 9 标题**的"，现量取到 `79f575d6`，`RC=0` 照旧。
   这是"判据不许把某一时刻的上游状态写死"在本批的**第三次**应用（前两次：靶过时、S7 的期望档）。
3. **匹配式对"边界位置"敏感。** `[^\\]\|` 与 `(^|[^\\])\|` 只差一个 `^`，差出来的正是两处真缺陷。
   ⇒ 任何写成"X 前面必须有一个 Y"的形状，落笔时都要问一句**"如果它就排在开头呢"**。

### 4. 同一趟把合流面重量了（20:0x 一次性瞬时读数，合流当时必须重取）

`node scripts/verify-detail-pane-merge-window.mjs --base main --head feat/detail-pane`（跑在**主检出**，
因为 Q1 问的是主检出的未提交改动）：`WINDOW_RC=1`，`CONFLICTED=18 OVERLAP=16 MARKERS=8 PARSE_BAD=3 PARSED=112`，
`REASONS=OWNED(16) NEED_HUMAN(18) MARKER(8)`。

| 数 | #15 那趟记的 | 20:0x 现量 | 差在哪 |
|---|---|---|---|
| 冲突枚数 | 10 | **18** | main 又前进；`packages/app-host/src/habit-actions.ts` 与它的 spec 是**新增的两枚代码冲突**（对面 `00b5065c` 回收站四类实体 + 删除四态 × 本支 `ca2cf606` W6 计数型习惯） |
| 带 marker 的合并产物 | 4 | **8** | 上述两枚 + `package.json` + `App.tsx`（`main-area.css`、三份文档台账仍在） |
| 活树交叠（主检出未提交） | 13 | **16** | 别人在飞的活更多 ⇒ 这一档只回答"现在能不能安全取号/追加"，**不挡合并**（§8.40） |
| 合并产物解析不过 | 未量 | **3** | 三枚**全部由 marker 解释**（两侧各自都不坏）⇒ 没有"合并新造出来的语法洞" |
| 候选树 | — | `1ec67e7b` | 分类：二进制 10 / 文档台账 3 / 代码 5 |

⚠️ **#15 那条"10 枚冲突里 3 枚要人"已经过时**（它记的是 19:2x 那一趟的数），但**它的判据形状不用改**：
窗口 v2 = 逐枚问"这一步要人写裁决吗"，要才数进窗口。按那个形状重做逐枚分类是合流当时的动作（#16/#21/#22/#24/#29），
**本支不代替合并做裁决**，也不 push 不 merge。

### 5. 顺手量到一枚**本支已知的红**，登记不归本批（不代改）

`node research/tools/docs-link-check.mjs` 在本支 `RC=1`：**1 枚死链**，`PROGRESS.md:1362` 指向
`docs/research/aed-implementation-evidence.md`。三条取证把它定成**分支滞后**而不是缺陷：

| 问 | 现量 |
|---|---|
| 本支有没有那枚文档 | `git cat-file -e HEAD:docs/research/aed-implementation-evidence.md` ⇒ **没有** |
| main 有没有 | 同一命令换 `main` ⇒ **有**（由 `c25960cb` 带入，不在本支祖先里） |
| 引用是谁写的 | `git log -S'aed-implementation-evidence' HEAD -- PROGRESS.md` ⇒ **`96f3293d`（10-03 21:13，B52 那条）**，早于本批任何一笔 |
| 分叉点呢 | `git merge-base main HEAD` = `f419df75`，那里也**没有**那枚文档 ⇒ 不是本支删掉的 |

⇒ 关闭判据：**main 并进来之后重跑那条命令应 `RC=0`**（`PROGRESS.md` 是并行会话共用的台账，本批不代它改，
也不为了让这一档变绿而去摘别人的行）。本批入库不变量仍然守住：这一笔带得走的三个文件里零红。


## 8.88 🔴 目标第①条那句"做**外部**调研"此前只有"有没有出处"有人守，而**自家代码的行号也算出处**（2026-10-04 20:2x 现量，载体续 `1a938d20`）

腿 4（§8.79）把"结论**与推荐**"的后半补成了能失败的属性之后，C1 对账门禁还剩一个同族的洞：
weak 那一腿判"每节有日期 + 有出处（URL 或 `file:line` 择一）"，**而它不区分出处是别人的还是我们自己的**。
⇒ 一节可以整节只引 `packages/...:12` 或本仓另一份推导文档，照样报"取证齐了"，
而目标第①条要的是"**别人怎么做的**"。这一档 20:2x 之前同样只有散文在守。

### 1. 口径怎么定的：一次"没有样本的分支"被现量打回来

第一版把第三方写成"路径以 `research/` 开头"。跑一趟**逐节读数**就看出这条分支**一个样本都没有**：
本文档 33 条第三方 `file:line` 引用（Habitica / Loop 的克隆源码）**全部写成裸文件名或相对路径**
（`StreakList.kt:48-58`、`cards/OverviewCard.kt:47-50`、`website/common/script/ops/scoreTask.js:326`），
零条带 `research/` 前缀。一条在它的对象上没有样本的判据等于没写（AGENTS §8.3 那一族的第五次）。

正解是**反向认**：以本仓顶层目录开头的算自家（口径取自 AGENTS §2 那张仓库地图，**不是**一张会漂的文件登记表），
其余都算第三方。现量（**取法：`node scripts/check-detail-pane-c1-coverage.mjs` 输出的「逐节读数」那一段；
下表是 20:2x 那一趟的快照，数字会随文档增删漂，复核请按取法重跑**）：

| 节 | URL | file:line | 其中第三方 | 外部锚 |
|---|---|---|---|---|
| Q1 / Q8 / Q9~Q12 / Q4 / Q5 / Q6 / Q13 | 4–15 | 0–2 | 0 / 0 / 0 / 0 / 0 / 0 / **2** | 有（7 节） |
| Q2 | 1 | 33 | **23** | 有 |
| Q7 | 0 | 1 | **0** | 🔴 无 ⇒ 走"标题写明不需要拍"那档例外 |

⚠️ 本表是**补外部核查之前**的那一趟读数；Q7 随后带上一枚 URL（`有外部锚 8→9 / 标题豁免 1→0`），
而那枚 URL 证明的是"厂商不披露形状"而不是"番茄面不是列表"—— 差别写在第 3 节，别只读合计。

`承重` 那一行因此新增三个可数读数：`有外部锚 8 / 缺外部锚 0 / 标题豁免 1`。

### 2. 臂与减法现量（装置 **22/22 臂**，`RIG_RC=0`）

| 臂 | 变异 | 读数 |
|---|---|---|
| M14 | 把某一节的 URL **全换成自家路径**行号 | **只红腿 5**，点名 C1b-Q1；腿 3 仍绿（`缺外部锚 1｜weak 0｜缺推荐 0`）—— 这条同时是"两档分工"的机器证明：腿 3 问"有没有出处"，腿 5 问"出处是不是别人的" |
| M15 | 同一节零 URL、只留第三方形状的行号（裸文件名） | **放过**（`RC=0`）—— 挡住"必须 URL"那种把口径写窄的改法，它否则会逼着读源码的那节塞链接凑数 |
| M16 | 把 M14 那份文档喂「还没有腿 5 的那版判据」 | **RC=0**（减法现量：这一档此前真的没人管）。旧版**按内容从文件历史认**（取到 `be9b909c` 那版），不按 HEAD 取 —— 这是 §8.87 第 3 节第 2 条**当批就用上了** |
| 脱牙 | 摘掉 `noExt` 命中集合 | M14 不再报出那一句（`RC=0`），其余腿不受影响 |

### 3. C1 #7 的出处链走到底之后：**厂商不披露界面形状**，而这件事腿 5 判不了

Q7 那一行原本引的四行全部落在 `docs/research/dida-view-unification.md`，而那份**全文 URL 命中 0**
（现量：对该文件数 `https?://` 出现次数 = `0`，670 行；最后提交 `f5f823cf`，09-30 18:17）
⇒ 它的"别人怎么做的"是**由本仓另一份推导文档转述的**，不是一手外部出处。

20:2x 就地做了一次**有界的外部核查**并把结果写进 C1b-Q7 那一节：一手取厂商自己的页面
`https://ticktick.com/home` 的 Pomodoro 段落，原文只讲方法（"break tasks into 25-minute intervals…"），
**不讲界面形状**，同页也没有 Focus 帮助中心的链接；另一次尝试（App Store 一条链接）返回 404。
⇒ 该节现在带 `URL=1 未核实标记=1`，并写明承重换了位置：**这条结论由我方代码判据守，厂商侧证据上限只是"官方把它写成计时器方法而非清单功能"**。

🔴 **这里留下一条腿 5 的固有边界，不假装它被补上了**：腿 5 只问"有没有外部锚"，
**不问那枚锚是否支撑这个结论**。Q7 现在过的原因是它带了一个 URL，而那个 URL 证明的是"厂商不披露"——
如果只读门禁读数（`有外部锚 9 / 缺外部锚 0`）就宣布"#7 的外部调研齐了"，那是把判据读成了它回答不了的问题。
⇒ 判"证据对不对口"这一步只有人能做，登记成 **#30**：产品负责人要么维持"这是我们已裁决过的旧结论"（那一行的标题例外就是为此存在），
要么指定一条我方判据之外的依据。**不替它拍**。

### 4. Goal 第①条现在的机器覆盖面（逐档写"由什么守着"）

| 目标原话的档 | 由什么守着 | 臂 |
|---|---|---|
| 每个待拍值都要有对照节 | 腿 1（C1 行 ↔ C1b 节对账 + 封闭例外类别） | M1 / M2 |
| 节不许研究不存在的题 | 腿 2（回指行号必须在表里） | M3 |
| 带日期 | 腿 3（缺日期或缺出处） | M4 |
| 带出处（别人的 或 代码的） | 腿 3 | M5 |
| **外部**（别人怎么做的） | 腿 5（本轮新增） | M14 / M15 / M16 |
| 结论**与推荐**写回 | 腿 4（行首加粗推荐标签；例外只从标题认） | M9–M13 |
| 未核实标记 | **仍只有散文** —— 机器无法从文本判"这句是不是未核实"，只在逐节读数里打印数量 | — |

最后一行是 Goal 第①条**唯一没有机器消费者的档**，写在这里而不是省略。

## 8.89 Goal 五条**再对账**（2026-10-04 20:2x；取代 §8.84 的 19:4x 版本；载体 `79f575d6`→`4b2393c3` 共 **12 笔**，未 push 未 merge）

§8.84 那份对账写完不到一小时就被本轮自己推进的三件事改变了（腿 9、腿 5、合流面重量）。
**留旧句 + 写这份新的**，是因为"对账"这件事本身也有保质期 —— 下一位照旧句行动会读到一个已经过时的覆盖面。
每行都带**现量命令**，不抄数字进表格。

| Goal 原话的那一条 | 现在由什么守着 | 现量取法 | 20:2x 读数 | 还欠谁 |
|---|---|---|---|---|
| ①「外部调研，带日期+出处+未核实标记，结论**与推荐**写回 C1 表」 | `check:detail-pane-c1-coverage` **五档**：对照节 / 回指行号 / 日期+出处 / **外部锚** / 推荐那一档 | `node scripts/check-detail-pane-c1-coverage.mjs`（读"逐节读数"那一段） | `RC=0`；`C1 13 行 ⇒ 有节 12 / 例外 1 / 未覆盖 0`；`C1b 9 节（推荐 8 / 标题例外 1 / 缺推荐 0）（外部锚 9 / 缺 0）`；装置 22 臂全符合预期 | 🔴 **"未核实标记"那一档仍只有散文**（机器判不了"这句话是不是未核实"）；#30 那一行的外部锚证明的是"厂商不披露"，判对口要人 |
| ②「执行不依赖拍板的 W0–W8；W1 选中态要跨视图通用」 | §8 那张表的**逐行状态**由 `check:detail-pane-status-table` 腿 2 钉在封闭三档上 | `node scripts/check-detail-pane-status-table.mjs`（读"逐行读数"那一行） | `W0/W1c/W8a=已完成`；`W1/W1b/W2/W3/W4/W5/W6/W7=进行中`（每一格都只剩 AGENTS §6.1.1 四端重装）；`W8/W9–W12=未开工`（各挂拍板或不在本篇）；W1 的跨视图单一所有者与三种投影在 §8.2/§8.26 | #13（四端重装，前置=合流落地+截图重出）、#17、#5/#7/#8/#9/#10/#11 八格同一前置 |
| ③「§1 四道前置闸门」 | 逐道**载体形态**量过：第 4 道结构性守着、第 2 道半有牙、第 1 道只有散文、第 3 道有装置不在链里 | 见 §8.83（每道都写了读的是哪个文件哪一行） | 两道余量为 0 的棘轮**没被调高**：`check:l4-no-style` 与 `check-row-single-source` 本轮各跑一趟 `RC=0`，基线常数逐字未改 | #28（"不许调高基线"要不要硬化成机器判据 —— 改的是共享门禁语义，要人） |
| ④「回填 §8 落地记录，读数含判据条数 / 变异红集 / 截图路径」 | 同一条门禁的腿 6/7/8/9 | 同上 + `node research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs` | `承重：已开工且未走豁免 10 行｜判据条数命中 10｜臂条数+红集同句命中 10`；`承重(腿9)` 一行给出射程分母与"跳过 0 枚"；装置 30 臂全符合预期 | —（这一条本轮补齐；§8.87 记下共享门禁在本支之外还管着列数/折行/碎片三档） |
| ⑤「点名路径提交、不代改别人在飞的活、不 push 不 merge」 | 纪律（无机器消费者） | `git log --name-only --format= 79f575d6..HEAD`（取并集）/ `git log --format=%h 79f575d6..HEAD -- scripts/mutate-closeout-gates.sh` / `git branch -r --contains HEAD` | 12 笔带过的路径**并集只有 6 枚**，全部在本线范围内（两份文档 + 两枚判据 + 两枚装置）；含那枚恒脏脚本的笔数 = **0**；`branch -r --contains HEAD` 为空 ⇒ 未推；无 merge 提交 | — |

### 与 §8.84 的差额（这一段是给读过旧版的人的）

1. **① 的覆盖面从 4 档变 5 档**（新增外部锚，§8.88），并且 C1 #7 那一节补了一次**有界**外部核查（§8.88 第 3 节）——
   核查的结论是"厂商公开材料不披露界面形状"，不是"这条被外部证实了"。
2. **④ 的覆盖面从 8 档变 9 档**（新增码段裸竖线，§8.86/§8.87），而补它的过程里发现：
   ①我自己写坏的 3+2 处，②main 上 18:1x 就有一条同族共享门禁，③腿 9 第一版还漏了段首那一形。
3. **合流面换了档**：冲突 10→18、marker 4→8、交叠 13→16（§8.87 第 4 节）。
   🔴 #15 那条"10 枚里 3 枚要人"的**数**已过时，但它的**判据形状**（逐枚问要不要人写裁决）不用改。
4. **新增两枚在册的账**：#29（合并时把本线两份文档加进 main 的 `check:md-tables` 名册并给腿 9 定去重口径）、
   #30（C1 #7 的结论对口性只有人能判）。

## 8.90 🔴 §8.12 那条"留给下一轮的负载 flake"当场修掉了：复现从推断升级成 100% 确定性，而用例不再借环境保证（2026-10-04 20:4x 现量，载体续 `2819c7dd`）

### 1. 归属门先量 —— §8.12 那句"不归本单处置"被现量改判

```bash
git -C <主检出> status --porcelain -- apps/web/tests/reminders-panel.spec.tsx   # 空 ⇒ 没人未提交地在改它
git log --oneline -1 -- apps/web/tests/reminders-panel.spec.tsx                # a8f5a9a6（已提交的 countdown W9）
```

归属门的判据是**同一文件的未提交 diff**，不是"提醒那条线最近在碰它"的印象（本篇 14:1x 记过同一个形状：
按"某条线在忙"整条线推断，结果落点逐个都干净）。该文件在主检出里干净、最后一次改动早已提交 ⇒ 本单可以动。

### 2. 机制：从"读循环读出来的推断"变成可 100% 复现

把 `Date.now()` 冻住（= "8 次点击全落进同一毫秒"那一档的极端形态）跑**修复前那一版**：
**恰好 1 红** —— `× 🔴 超过每任务上限时把错误显示出来，不静默吞掉` 2085ms（是 `waitFor` 自己 2s 到点，
不是 vitest 的 5s 掐断），其余 5 条绿；红信息 `等待「超上限的错误被记下」超时` 与 §8.12 记的那次自然红逐字同形。
⇒ §8.12 那段机制当时写的是"读 `:243-256` 那圈循环得到的，不是猜的"，现在它有了**可复跑的证明**。

### 3. 改法：用例自己按点击序号推进时钟

`vi.spyOn(Date, 'now')` 返回"真实 now + step × 1 分钟"，`step` 只在每次点击之前 `+= 1`，`try/finally` 里 `mockRestore()`。
选 1 分钟而不是 1 小时：`triggerAt = now + 1h` 与当时的 now **恒差 1 小时**，八个触发时刻两两不同而**没有一条落到过去**
（`reminderRejection` 的 `in-the-past` 那一档不会被误碰）；也不用 `vi.useFakeTimers` —— 那会把 `setTimeout` 一起假掉，
而这段用例真正要走的正是"点击 → dispatch → op-log → IndexedDB → notify → refresh"那几段宏任务。

🔴 **为什么这不是"为了跑绿改测试"**：两条产品不变量一条没动 —— 幂等分支 `writeNew`（按 `taskId:triggerAt` 认实体，
且它**走在封顶检查之前**，这正是撞不到上限的原因）与 `MAX_REMINDERS_PER_TASK` 封顶都还在原处；
用例断言的仍是"超上限的错误必须看得见"。改掉的只是**制造 8 个不同触发时刻的方式**，
而原方式的前提（两次点击之间墙钟会自己前进）没有任何一层保证 —— 这就是 §8.12 量出来的东西，
也是 §7 第 50 条那一族（"状态对"在"没生效"时也绿；这里是反面：前提没了就偶发红）。

### 4. 四臂（含一把减法、一把承重、一把脱牙）

| 臂 | 动作 | 期望 | 现量 |
|---|---|---|---|
| `A` 压力复现 | 修复前那一版 + 冻住 `Date.now`（循环后立刻复原，`waitFor` 用真时钟） | 恰好这条红、其余绿 | **1 failed / 5 passed**，2085ms ✅ |
| `B` 脱钩证明 | 修复后 + 同样冻住底层时钟 | 全绿（前提与墙钟无关） | **6 passed** ✅ |
| `C` 承重减法 | 修复后 + 冻结仍在、只摘掉 `step += 1` | 这条必须红（否则 step 那行不承重） | 红 ✅（见下面第 6 节：这条第一版**假绿**过） |
| `D` 有牙证明 | 修复后 + 摘掉 `app-host` 的封顶比较（`>=` 改成永假）并**重建 dist** | 这条红 + `app-host` 自己那条也红 | web **1 failed / 5 passed**（2070ms）、app-host **1 failed / 22 passed**（`× 每任务最多 5 条存活提醒`）✅ |
| 脱牙 | 复原 `app-host` 源码 + 重建 | 两套件都回绿，产物无残留变异 | 6 passed；`dist/index.js` 的 md5 与变异前**逐字相同** ✅ |

探针都在 `/tmp`（`dp_freeze_probe.mjs` / `dp_freeze2.mjs` / `dp_cap_probe.mjs`，**不进仓库、会随机器没掉**）；
每把都带命中数断言（靶块命中 ≠1 就 throw），所以"复原成功"是写进脚本的判据而不是我的一句话。

### 5. 读数

| 项 | 命令 | 读数 |
|---|---|---|
| 单跑 ×2 | `cd apps/web && NO_COLOR=1 ./node_modules/.bin/vitest run tests/reminders-panel.spec.tsx` | 两趟都 **6 passed** |
| 全量 web 套件 | 同目录 `vitest run` | `Test Files 115 passed \| 2 skipped`、`Tests 1595 passed \| 12 skipped`、`WEB_SUITE_RC=0`；**起跑 loadavg = 60.1 / 72.4 / 63.5** —— 本节最有分量的读数：红的那一次发生在负载态，修完这一趟也在负载态 |
| 类型 | `cd apps/web && ./node_modules/.bin/tsc --noEmit -p tsconfig.spec.json` | `RC=0` |
| 载体 | 变异前后各取一次 `md5 packages/app-host/dist/index.js` | 复原后与变异前**同一个串** |

### 6. 🔴 可迁移的那条（进 §8.76 待入 traps 第 13 条）

**"摘掉承重行"这一臂必须把被它抵消的那个压力源留着。** `C` 臂第一版在摘 `step += 1` 的同一次替换里
顺手把探针的冻结也解除了 ⇒ **6 条全绿**，我差点据此写下"那一行不承重、这次修的是别的东西"。
补成"冻结仍在、只摘 step"才照出它红。⇒ 减法臂的读数只在**压力源不变**时才有意义；
写臂时要把"这一臂摘掉的是哪一层的抵消"写进臂名，否则臂会假绿，而假绿比没有臂更贵
（它会把一次真修复判成一次伪修复）。

`C` 臂现量是红 **2** 条：目标那条 5003ms，加上**紧跟它的**「提前 30 分钟」那条 3ms 连带 ——
第二条不是新缺陷，是把时钟整条冻住让 `waitFor` 的 deadline 永不过期、跑到 vitest 5s 把 `act` 掐断的连带
（该文件头 `:146-149` 记过这一族"overlapping act ⇒ 空 DOM"）。真实高负载的形态是"多次点击落进同一毫秒"
而不是"时钟不动"，所以 `A` 臂（冻循环内的时钟、`waitFor` 前复原）才是那一档的正确模拟，`C` 臂只用来判承重。

### 7. §8.12 的"活事实"关掉一条

本篇 09:2x 那节写过"两条留给下一轮的活事实：① §8.12 的负载 flake；② 便签面选中没有可见痕迹"。
②随 W1c 已闭合，①本节闭合 ⇒ §8.12 里"下一轮看到它红，先别怀疑是详情面这一族弄坏的"这条**告警用途**同时作废：
它不会再以"偶发红"的形式回来了；若它再红，那是**新的**缺陷，机制不再是"点击落进同一毫秒"。
原句不删，就地加改判指针（保持"当时的读数"可被下一个人复量）。

## 8.91 🔴 腿 10：编号写错在**渲染后看不出来** —— 列表层也补成常驻判据，且射程是"传来的每一份文档"（2026-10-04 20:5x 现量，载体续 `2819c7dd`）

### 1. 触发它的是我自己那份清单，不是设想

给 §8.76 追加一条时，先用一次性扫描（`/tmp/dp_listcheck.mjs`，不进仓、会随机器没掉）量了两份文档，
现量：工单文档 **6 处**字面编号与位置不一致（那个块写成 `… 6, 8, 7, 8, 9, 10, 11`），调研文档 0 处。
也就是说 §8.76 的"第 8 条"在我这份账里**同时指着两条不同的事** —— 而这九条腿（全在表行层）一条都不红。

机制：CommonMark 只认块内**首项**的字面值当 start，其余按 `start + 序号` 重排 ⇒
源码里的 `8.` 渲染出来是 `7.`，**渲染后完全看不出坏**，连"截图 + 看图"那道也照不出来。
坏只在**按源码号引用**时现形（本线到处是 `§8.76 第 N 条` 这种跨文档引用）。
⇒ 这与 main 侧 traps 台账那 4 组同号不同事（任务 #20）同一个成因，但本批这一族更隐蔽：台账那种号渲染后就是它自己，
看图有可能照出重复；列表号渲染后被重排成"对的"，**只有源码层能判**。

### 2. 判据的两条边界（都是量出来的，不是设计的）

- **允许首项不为 1。** 第一版探针写成"编号必须等于位置"，喂进调研文档当场报 **21 处**——
  而那里是两个**合法的续编块**（`7..20`、`21..26`，让编号对上 C1 那张表的项号）。
  改成 CommonMark 的语义"块内等差 1 递增"后：调研文档 **0 处**、工单文档仍是那 **6 处**。
  🔴 这就是"判据先在自己的对象上量出每一支的样本数"（§8.76 第 12 条）在本批的第三次应用：
  写严一档之前先量合法形态有多少条会被它打死。
- **表行与代码围栏不算列表项。** `| 1. not a list | x |` 那种单元格、以及命令输出里的 `1. ` 开头行，
  都必须在块判定之前排除（围栏按"三反引号那一行"交替开合；以竖线开头的行与以井号开头的标题都会结束一个块）。
  第一版没排 `|` 行，把 §8 表里若干行当成了列表块 —— 症状是"违规数突然涨到几十"，
  而不是"0"，所以这次没被判据骗（同 §8.88 那条"多个判据同时爆红 = 共享的解析层坏了"）。

### 3. 射程为什么是"两份文档"而不是一张表所在那份

本线的"第 N 条"引用是**跨文档**的（工单引调研、调研引工单）。只扫有 §8 表的那份，等于把引用面的一半留在散文里。
⇒ 门禁的位置参数改成"传来的每一份都扫"，**默认两份**（工单 + 调研）；表类那九条腿仍只判第一份（它才有那张表）。
装置同步改成显式传两份一次性副本 —— 不传第二份就等于让装置去读仓库真身，别人的改动会把对照趟判成红。

### 4. 读数（本节自己那一条"判据必须配变异臂"）

| 项 | 命令 | 读数 |
|---|---|---|
| 门禁本体 | `node scripts/check-detail-pane-status-table.mjs` | `RC=0`，**十项**都成立；`承重(腿10)` 那行逐份打"块数／条目数／不一致数"两个分母都在场，所以"0 处"与"没扫到"可区分 |
| 旧对象复跑（不是合成变异） | `git show HEAD:docs/plans/… > /tmp/x.md` 后 `node 同一道门禁 /tmp/x.md` | `RC=1`，逐条点名那 6 处并写出"写作 8. 而按首项 1. 应为 7."—— **这一条是本节最硬的读数**：判据抓的是真发生过的坏，不是我造的形状 |
| 装置 | `node research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs` | `RIG_RC=0`，**臂数不抄**（现取：那条命令最后一行自己打 `N/N 臂符合预期`）；本轮在它自己的结论上比上一趟多出的就是 `L1 L2 L2b L3 L4` 五臂 + 一把腿 10 脱牙 + 一把"第二份文档确有射程"的基线对照。逐臂期望见装置文件头那张表。**无界面格**（纯判据单，不产截图） |
| §1 闸门"干净检出复跑" | `git archive HEAD` 铺一份裸树，在里面跑同一道门禁与装置 | 见本节末第 6 节（提交**后**再跑，两半必须在同一笔里） |
| 同线其余门禁一起复跑 | `node scripts/check-detail-pane-c1-coverage.mjs`、`-evidence-refs`、`-slot`、`node scripts/check-docs-voice.mjs`、`node scripts/check-script-snapshot.mjs` | 五道全部 `RC=0`（voice 那句是它自己的结论行：`扫描 site.* 1028 条…禁词表 30 项零命中`；snapshot：`31 个脚本 + .gitignore`）|

⚠️ 上面那一行"同线其余门禁"的**第一版**记了两道红，两道都是我**把脚本名猜错的** ——
`check-detail-pane-docs-voice.mjs` / `check-detail-pane-script-snapshot.mjs` 这两枚文件不存在（真实名不带 `detail-pane` 前缀），
`Cannot find module` 打出 `RC=1`。⇒ 这正是 §8.76 第 10 条（"载体没跑起来"与"门禁查到红"同形）在本批的又一次命中，
而我这一趟的**第一步本该是先读 `package.json` 的别名表**（本批已经写过这条纪律）。改判只花一条命令：
`ls scripts | grep -i detail-pane` 之后重跑就是五道 `RC=0`。

### 5. 顺带修掉的两处自家文档债

- §8.76 的**标题**原来写着"十一条"，引语那句写着"这四条都是"—— 两个都是抄件，且当场就不是真值（清单早已 13 条）。
  ⇒ 标题改成**不落条数**、把现取命令写进标题（与 AGENTS §7 对本仓 traps 台账"本文件不写条数"是同一条纪律）；
  引语那句改成不带数的陈述，并在句里记下它当时错在哪。
- §8.76 那份清单**追加顺序**曾把新条目插在旧条目之前（第 6 条之后先是 `8.` 再是 `7.`），
  即本节第 1 节那 6 处错位的成因 ⇒ 现在 1..14 连续，且由腿 10 守着。

### 6. 提交后的"干净检出复跑"（§1 闸门第 3 道）—— **两种载体不等价**，读数分开记

```bash
# 载体 A：裸解包树（git archive）
T=$(mktemp -d); git archive HEAD | tar -x -C "$T"
cd "$T" && node scripts/check-detail-pane-status-table.mjs; echo "CLEAN_GATE_RC=$?"
node scripts/check-detail-pane-c1-coverage.mjs;           echo "CLEAN_C1_RC=$?"
node research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs; echo "CLEAN_RIG_RC=$?"

# 载体 B：真 git 检出（一次性 detached worktree，用完删）
git worktree add --detach /tmp/dp_detached HEAD
cd /tmp/dp_detached && node research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs
```

| 载体 | 门禁 | 装置 | 为什么 |
|---|---|---|---|
| A 裸解包树 | `CLEAN_GATE_RC=0`（十项都成立）、`CLEAN_C1_RC=0` | **`CLEAN_RIG_RC=1`，`status=128`，`fatal: not a git repository`** | 装置第一行要 `repoRoot`（`git rev-parse --show-toplevel`），而 P4 / L4 两条**对照臂按设计必须沿该文件的提交历史认旧版** —— 裸树里根本没有历史 |
| B detached 检出 | `DET_GATE_RC=0` | `DET_RIG_RC=0`，结论行 `37/37 臂符合预期` | 有 `.git` ⇒ 对照臂取得到旧 blob |

🔴 所以这一族"干净检出复跑"要**分载体写**：门禁类（纯 fs）两种载体都行，装置类只能用真检出。
本次裸树那个 `RC=1` **不是装置红，是装置没跑起来** —— 与 §8.76 第 10 条同形，而这一趟它和第 4 条
（"带 `git ls-files` 那半的门禁在裸树里 fatal 空转"）在同一次复跑里各命中一遍。
⚠️ 诚实记一笔：本节第一版把"门禁与装置都在裸树里跑"当成了承诺写出去，那是**没量过的判据**；
现量之后改成上面这张表，并把用完的 detached 检出 `git worktree remove` 掉。

## 8.92 第 1 道前置闸门（归属门）从"只有散文"补成一条可跑的载体 —— 而且它照出的第一枚真占用不是我的（2026-10-04 21:0x 现量，载体续 `540ce4a9`）

### 1. 缺口是量出来的，不是想出来的

合流窗口判据的 Q1 已经在管"别人有没有未提交改动落在本批文件上"，但它的集合取的是
`git diff --name-only merge-base..HEAD` ⇒ **只含已提交的路径**。所以"这个文件我**现在**能不能动"
这个问题它在动手前答不了。本轮两次都是手查（`git -C 主检出 status --porcelain -- <路径>` 为空才动），
查法稳定、重复出现、判错一次的代价是把别人的未提交改动吸进我这一笔。

⚠️ §8.83 当时把这道门判成"不建"，理由是"可机器化的形状 = 这一笔的文件集合 ⊆ 本线路径，会在任何合法合流上假红"。
那句**只对那一个形状成立**：换成"提交前逐条点名问『这条路径此刻被谁占着』"，载体不参与合流那一趟，
就没有那个假红面。⇒ 记一条：**"建不出来"要连想过的形状一起写进文档**，否则下一个人会把整道门读成死路。

### 2. 判据本体三条 + 退出码

`scripts/verify-detail-pane-ownership.mjs <路径> [<路径>…] [--main <主检出>] [--self <本地检出>]`

| 判 | 形状 | 红法 |
|---|---|---|
| 1 | 点名的每条路径必须在主检出的 `status --porcelain` 里**不出现** | `RC=1` + `BLOCKED=N` + 逐条附状态码（`" M"` / `"??"` 分开标） |
| 2 | 点名的每条路径必须在本地检出**存在或被 git 跟踪** | `RC=2 VERDICT=PROBE_BROKEN` —— 写错路径名会让第 1 条在空集合上恒真，那是最像绿的一种红 |
| 3 | 两个根路径与四个分母都打进输出（`本地检出=` / `主检出=` / `未提交 N｜点名 M｜本地不在场 K｜被占 B`） | 没有这行就区分不了"0 枚被占"与"探针没跑到"；跨树比较不许隐式取同一棵树 |
| 附加 | 一条路径都不点 ⇒ `RC=2`；`--main` 指向非 git 目录 ⇒ `RC=2` | "读不到别人的状态"永远不许被当成"没人占着" |

### 3. 现量（含两枚真占用，都不是我造的）

| 项 | 命令 | 读数 |
|---|---|---|
| 真仓阴性 | `node scripts/verify-detail-pane-ownership.mjs apps/web/tests/reminders-panel.spec.tsx scripts/check-detail-pane-status-table.mjs` | `RC=0`，`被占 0 条` 而 `未提交 9 枚` ⇒ **读到了别人的脏改动，判的才是不重合** |
| 真仓阳性对照 | 同一道判据 `-- docs/plans/README.md`（主检出现量正脏着） | `RC=1` + `主检出状态码 " M"` ⇒ 本单**此刻不许动 README**；这条不是装置造的，是仓库现场 |
| 与 Q1 的分工 | `node scripts/verify-detail-pane-merge-window.mjs` | `Q1 …本批触及=113 枚；交叠=1 枚`、`CONFLICTED=18 MARKERS=8 PARSE_BAD=3（只由 marker 解释=3 / 合并新造成=0 / 本来就坏=0）`、`REASONS=OWNED(1) NEED_HUMAN(18) MARKER(8)` ⇒ 两道判据看的是**不同集合**（提交前的点名 vs 合流时的已提交），互不取代 |
| 装置 | `node research/tools/mutation-rigs/mutate-detail-pane-ownership.mjs` | `RIG_RC=0`，**8 臂全部符合预期**（`R1 R2 R3 R4 R5 R6 R7` + 一把脱牙）；红集：R2/R3 → `RC=1 BLOCKED=1`，R4/R5/R6 → `RC=2`，摘牙后这五臂**全部失能**。夹具是 `git init` 出来的**临时真仓库**，不碰任何真检出（活树状态类判据拿真仓当夹具，第二天读数就不成立，还会给别人制造脏改动） |
| 门禁本体语法 | `node --check` 两份文件 | 都过 |
| §1 第 3 道"干净检出复跑" | `git worktree add --detach /tmp/dp_det2 HEAD` 后在那棵树里跑（用完 `git worktree remove`） | `DET_GATE_RC=0`（§8 表十腿）、`DET_C1_RC=0`、归属装置 **8/8**、§8 表装置 **37/37** ⇒ 本轮新增的两份文件在**只有提交态内容**的载体上同样成立（裸解包树不行，理由见 §8.91 第 6 节） |

⚠️ 第一版把它命名成 `check-detail-pane-ownership.mjs`，随即被预检的名册自检（`OWN_GATE_GLOB = /^check-detail-pane-.*\.mjs$/`）
判成"在产物树却不在名册 ⇒ 合流当场一次都不会跑它"。那不是要挂进去的信号 —— **它读的是活树瞬时状态、又必须要点名参数**，
挂进纯 fs 名册只会在每一趟预检上假红。⇒ 改名 `verify-detail-pane-*`（与 `verify-detail-pane-merge-window` 同族：
活树探针类），并按名册那条信息自己要求的"把这件事记进工单 §8"落在本节。**这条命名分界值得下一个人复用**：
`check-` = 产物/源码的静态判据，`verify-` = 要现场状态的探针。

🔴 **本节自己也被 main 那道共享门禁照出一处真缺陷**：`docs/plans/detail-pane-alignment.md:5647 列数 2（本表表头是 3）`
—— 我改 §8.83 那一行时把中间那个分隔竖线吞了。本线那十条腿**一条都不红**：
腿 1 只判"闭合竖线"，而这张表合法地出现竖线 ⇒ 判列数会被码段里的竖线反咬（判据文件头那条 ⚠️ 写明过）。
取代表：`git show main:scripts/check-md-table-rows.mjs`，把 `FILES` 换成这两份路径再跑，`RC=1` 精确指到那一行。
⇒ 这是任务 **#29** 目前最好的论据：两次实测（20:1x 那 5 处、21:0x 这一处）都是**同一层**——列数与断行——
而本线有意不判那一层、main 判。⚠️ "合流后两把门禁会不会互相判红"仍**没量过**（那是 #29 的另一半，要在合并产物上跑）。

### 4. 边界（别读多）

- 它是**提交前**的闸门，不进 `pnpm check`（链里没人能给它点名参数），也不进合流预检名册（见上一节）。
  ⇒ 它守不住"忘了跑"这一档；防这一档的是每个提交前那一次 `git status` 现量，本节只是把它从"手查"变成"有一条会红的判据"。
- "干净"是**瞬时**读数：主检出随时可能被别人写脏。所以它的答案只在"读完就跑 `git commit --only` 那几条路径"这个窗口内有效，
  窗口外要重量（同 §7 那一族：任何瞬时读数都不许被抄成结论）。
- 它不判"这条路径归谁"，只判"此刻有没有未提交改动" —— 语义上比"归属"弱，也正因如此才是可机械判的那一半。

## 8.93 #29 的那一半"加进名册会不会当场红"，今天就能量 —— 顺带把两把门禁的重叠矩阵做出来（2026-10-04 21:1x 现量，载体续 `329be953`）

任务 #29 原本整条挂在"合并当时"。拆开看它是两件事，**其中一件现在就有载体**：
①"把本线两份文档加进 main 的 `check:md-tables` 名册后会不会当场红"，和 ②"两把门禁要不要去重、以谁为准"。
②需要一张重叠矩阵。两件事都能在**候选树**上做，不需要真的合并。

### 1. 候选树上一枚 marker 没处置时，两把都红——而那红不是结论

`git merge-tree --write-tree main HEAD` 取候选树（本轮 `6e8abd97`，`merge-base=f419df75`），
`git archive | tar -x` 铺到 /tmp，两把门禁各跑一遍：

| 载体状态 | 本线十条腿 | main 的 `check-md-table-rows`（FILES 换成这两份） |
|---|---|---|
| 候选树原样（本工单文档仍带 2 枚 marker） | `RC=1`，红全落在**孤儿行那一档 13 条** | `RC=1`，2 处：`:175 表头下没有分隔行` / `:188 表格行被折成多个物理行` |
| 按 #24 的处置把这两份文档取 **HEAD 侧** | `RC=0` | `RC=0` |
| 同一棵树跑 main **自己那份名册**（9 个文件） | —— | `RC=0`（合并没有把别人那 9 份判红） |

⇒ **#29 的①答案是"不会当场红"**，前提是那两枚 marker 按 §8.47/#24 处置掉；
不处置时的两把红都只证明"marker 区不是合法 markdown"，不证明任何文档质量问题（同 §8.47 第 3 节那条纪律）。

### 2. 重叠矩阵：四类各自独立的坏形状，两把各跑一遍

装置 `research/tools/detail-pane-gate-overlap.mjs`（现跑读数见下，条数会随文档漂，**矩阵的列不会**）：

| 注入的坏形状 | 本线十条腿点名 | main 那把 | 这一格说明什么 |
|---|---|---|---|
| D1 表格单元的码段里有裸竖线 | 腿 9 点名，`RC=1` | `RC=1`（列数错位） | **双报**。同一处坏两把都看得见 |
| D2 表格行折成两个物理行 | `RC=1`，但**级联**到 5 条腿（状态 1／孤儿 15／变异读数 1／判据条数 1／臂读数 1） | `RC=1`，6 处 | 双报，且本线那把在行层失效时会**级联**——两个数不是分歧，是分母不同 |
| D3 有序列表编号与位置不一致 | 腿 10 点名 4 条，`RC=1` | `RC=0` | **只有本线管** ⇒ 加进 main 名册不等于这一族有人守 |
| D4 少一个分隔竖线（列数与表头不符） | 腿 2 报"状态没命中三档"1 条 | `RC=1`，2 处 | 本线**有意**不判列数（判据文件头那条 ⚠️ 写明过），所以它把列错位读成"状态格内容不对"——定位不如 main 那把准 |

⇒ **#29 的②口径**（建议，不是已生效的规则）：两把**都保留**，不做互斥去重；
双报的 D1/D2 类以 main 那把的**行号与列数定位**为准（它判的是"这张表在 GFM 里成不成立"），
本线那十条腿守的是"这张表有没有把工单要求的读数写齐 + 列表层"（D3 那一格是它独有的对象）。
真要合并成一条判据的话，得先把本线的"判据条数/臂读数/截图栏位"那三条腿搬进 main 那把——那不是本批的范围。

### 3. 我自己在这个探针里撞的一次

D3 第一版注入用 `match(/开始行的编号/)` 取文档里**第一个** `N. ` 行 —— 那是代码围栏里面的一行命令输出，
而腿 10 按设计跳过围栏 ⇒ 注入后 `RC=0`。我差点把这一格写成"列表编号这一族 main 与本线都不管"。
改成"只在围栏外找 ≥3 条的块"之后腿 10 点名 4 条。
🔴 可迁移：**减法/注入类探针的靶必须落在被测判据的射程内**，"没红"有两种成因——判据不管，或探针没打中对象；
分辨办法只有一个：把注入形状与判据的跳过规则逐条对一遍（§8.76 第 12、13 条的第三种面目）。

### 4. 任务状态

#29 从"合并当时的动作"降级成：**合并当时只剩"把两份路径追加进 main 的 `FILES`"这一行**；
"会不会当场红 / 要不要去重"两问已在本节量完，且给出可复跑装置（不是我的转述）。
矩阵里 D1/D2 是双报这一事实，也回答了"加了名册之后本线腿 9 会不会变成冗余"——不会，
因为腿 9 的臂集（P1/P2/P3/P4/P5/P5e + 脱牙）钉的是**本线自己那条腿**的形状，名册加了 main 那把并不替换它。
