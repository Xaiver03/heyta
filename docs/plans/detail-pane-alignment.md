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
| **W11 专注记录补录与删除** | 调研 A4：滴答桌面端做法是"可补记不可删"，我们**连删除动作都没有** | 是否重开 `trash-and-archive.md` 里"FOCUS_SESSION 不做删除"那条已拍决定 |
| **W12 番茄正计时** | 不是加控件，是**先加数据模型**（`FocusSessionKind` 无该值）⇒ 牵动 `EntityModelMap` 与线协议 | 是否要做。⚠️ 成本参照：并行分支 `feat/countdown-batch2` 的 W2 实测"`ENTITY_TYPES` 加一项即穿过整链，**存储三套适配与线协议零改动**" —— 那是**同类改动**的现量读数，但**该分支未合并**，数字要重新现量 |

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
| 为让 W2/W3 过而**调高两道棘轮基线** | 见 G2。这条是本仓库反复付过学费的纪律 |

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
| W0 | ✅ 已完成（2026-10-03） | 两处过期都改在**文档本体**：① `docs/reference/architecture.md` 的实体清单里 `FocusSession` 原写 `mode(pomo/stopwatch), duration` —— 三个字段**都不存在**，真实形状是 `kind(work/shortBreak/longBreak) + plannedMs + actualMs? + completed? + startedAt? + endedAt?`（逐字段核对 `packages/domain/src/entities.ts` 的 `FocusSessionKind` 与 `interface FocusSession`）；② `docs/README.md` 对 ADR-0043 那句「⚠️ 代码未开工」改成已落地并留了更正痕迹（指向调研 A0.8 的取证）。**判据**：`docs-link-check` 无死链 + 两份文档不再与代码冲突（人工核对，无自动判据 —— 按 §2 那一行写明的"允许只做人工核对并在此登记"，这条**没有**变异臂，别把它当成有牙的）。⚠️ 归属：`docs/README.md` 同一文件里另有别人 7 行未提交的改动，所以我**没有**单独提交那一行，改动作废在工作树里，由下一次整文件提交带进去 |
| W1 | 🔄 **进行中**（接线、判据、**真浏览器截图 + 人看图**都已闭合；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | **已落地**：单一所有者收拢 —— `packages/app-host/src/selection.ts`（封闭词表 + `createSelectionStore` + 纯函数 `pruneMissingSelection`/`pruneSelection`），四份本地 `useState` 全删，两端各只留一份宿主胶水 `apps/{web,mobile}/src/lib/selection.ts`。🔴 **词表从 6 类改成 3 类**（`task|habit|note`）：`project`/`tag`/`event` 是**投机项** —— 两侧的 prune 谓词照着写了 project/tag，而**没有任何一处界面会选中一条清单或标签**（它们在两端都是筛选/导航），"支持六类"读起来像已完成、实际只有三类活着。这条被升级成常驻门禁的**断言 D**（逐类扫宿主有没有 `select/useSelected`，零消费者即红；词表从数组字面量现读，解析出 0 项也算红）。💥 **本轮现场抓出的两个真缺陷**：① `apps/web/src/features/quadrant/QuadrantBoard.tsx` 把 `onOpenTask`/`activeTaskId` **声明了、解构了、没往共享板子传** ⇒ "三种投影接同一个选中"实际只有两种接上，而两个 prop 都是可选的 ⇒ **typecheck 全绿、当时四条门禁全绿**，症状只是"四象限不跟随选中"（→ §7 #179）；② `openNoteFromSearch` **签名里不收 id** ⇒ 搜索结果点便签只换视图、什么都不打开。③ 顺手补掉一条既有的端间不一致：web 时间线的行体此前**根本不可点**，而触屏端早能。**判据**：共享层 16 条（`packages/app-host/tests/selection.spec.ts`）+ web 选中 16 条（`task-selection.spec.tsx`）+ mobile 13 条（`selection-single-owner.spec.ts`）+ 三种投影各自的行为判据（`quadrant-row-parity.spec.tsx` 新增 2 条、`timeline-board.spec.tsx` 新增 3 条、`notes-view.spec.tsx` 新增 3 条）+ 门禁 `check:selection-single-source` **五条断言 A–E**（E 是本轮新增：同文件内比"声明"与"使用"）。🔴 **载体发现（写进 §7 #178）**：RNW 在 jsdom 里把样式编译成 class（`r-backgroundColor-*`），`el.style.backgroundColor` **恒为 `''`** —— 用它当判据第一次就得到"三种投影全都没底色"这种**看起来像三个真缺陷**的空读数；底色一律走 `getComputedStyle`（未选中是 `rgba(0, 0, 0, 0)`，不是空串）。**变异臂（两趟 rig 共 18 臂，每臂跑完复原并复跑回到绿；终态 Z2 = web/mobile/门禁三处 RC=0）**：14 条正臂按设计转红（门禁 A/B/B2/B3/C/A2/D/E/E2/E3-分母自检 + TaskList 底色 + TimelineBoard 两处底色 + 两处 `onPress` + NotesView 退回本地态 + 搜索丢 id + web 四处投影断一处 + mobile 回落摘一处 + mobile 三处投影全摘）；🔴 **一条第一次跑活了**：把 web 便签换回**裸名** `const [editingId] = useState(null)` 时门禁**全绿** —— 而文档块里当时写着"仍未覆盖：不带实体名的 editingId"，即这条缺口我**登记过但没验证**。补上裸名分支（`detailId|selectedId|editingId`，刻意不含 `active`/`open`：四象限的 `activeId` 是 dnd-kit 正在拖哪一颗）后重跑**转红**；为此把 `PasskeyPanel` 那份行内改名编辑器的状态改名 `editingRowId`（第一次我改成 `renamingId`，撞上 store 里已有的"请求在途那条"——两个概念不能并成一个名字，断言把它挡在写盘前）。两条负向对照绿：字样只写进注释、以及树上活着的 `activeId`/`editingRowId` 不被误伤。**读数**：门禁绿（`词表 3 类全有消费者（task 10 / habit 7 / note 13）、接线声明 17 处全部用起来`）；本轮直接跑的 `task-selection + timeline-board + quadrant-row-parity + notes-view` = **55 passed / 0 failed**；web/mobile/app-host/ui 四包 typecheck RC=0；`check:docs` 归因见 §8.1（三处死链指向**别人未提交**的在途文档，已把链接改成带状态的指针）。**真浏览器取证已闭合（2026-10-03 22:4x，载体 `feat/detail-pane` = `d5b835b5`）**：新增 `e2e/tests/selection-projections.spec.ts` **3 条**，跑法与读数：生产构建载体（`vite build` + `vite preview`，端口 4358）上 **3 passed / 0 failed**；截图五张落在 `apps/web/evidence/selection-projections/{01-list,02-quadrant,03-timeline,04-switch,05-search}.png`，**五张都逐张打开看过**：列表与搜索那两张里选中那条带浅蓝底、另一条白底；四象限那张选中那条落在"先不做"格里且带同一种蓝；时间线那张"未排期（2）"里只有第一条带蓝；换选中那张是**第二条**带蓝、第一条回到白底。看图还照出一件断言看不见的事：`switchView` 用鼠标点 rail，**rail 的 tooltip 会留在下一张图上**，第一版 `03-timeline.png` 里那句"四象限"正好压在选中那条的标题上 ⇒ 截图前 `parkCursor`（把鼠标挪开），这不是美化，§6.2 要的是"人能看懂的那张图"。🔴 **23:5x 两处更正（载体 `0de58095` + `0c159f7f`）**：① 那五张图已随 W2 的第四列整体重跑并**逐张重看**（选中态在四种投影里读数不变）；② 更要紧的是读底色的探针里有一条**会假绿**的机制被照出来了 —— Chromium 对**已从文档分离**的节点 `getComputedStyle` 返回空串，而判据写的是"选中那条 ≠ 同屏没选中的那条"，空串永远不等于任何真实底色 ⇒ **"根本没读到值"会被判成"画上选中色了"**。症状先以一次假红出现（两遍连跑全绿、第三遍红），所以这类"偶发红"要按**探针故障**查，不要按产品抖动放过。现在探针先等到算得出来为止，自检臂（把读数改成恒返回空串）实测 3 条全红。
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
``` |
| W1b 键盘光标 | ⏸ 未开工 | 原 W1 判据 ③「↑↓ 移动选中」**拆到这一行**，理由不是省事：`TaskList` 的 `activeTaskId` 是**展示槽**，而"往哪走"要有目的地才有意义 —— 详情列（W2）没开之前，回车没有可去的地方。解锁条件：W2 落地后一起做，判据是"↑↓ 改选中 + 详情面跟着换 + Enter 打开焦点" |
| W2 | 🔄 **进行中**（槽位、判据、五臂变异、八张图逐张看过、十道门禁都闭合；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | 载体 `feat/detail-pane` = `0c159f7f`（前置那笔 `0de58095` 是探针修复）。**落点与裁决**：详情列是 `.ht-app` 的**第四个轨道**、与 `<main>` 平级，不是 `.ht-content` 里的第二栏 —— `.ht-content` 自带 `max-inline-size` + `margin-inline: auto`，挂进去的列永远贴不到窗口右边缘，观感就不是"三栏 + 右详情"。轨道 `--ht-detail-track` **只在 `.ht-app` 上算一次**，两轨/四轨两条 `grid-template-columns` 各自拼它（抄两遍就会漂），塌缩态覆盖这个变量而不是重抄声明。**今天这一列是空的**，这是设计不是半成品（原话："即使没东西也空在那里"），往里放什么阻塞在拍板 #1/#8。⚠️ **这半句在 2026-10-04 过期**：产品负责人拍板「无选中态的时候默认显示 AI Chatbot」，web 已把 AI 面（单步工具 + 对话助手）搬进这一栏（判据在 `e2e/tests/ai-row-layout.spec.ts` 的"AI 面在哪一栏"两条，裁决记在主计划 §5.4 末尾）；"选中某条出详情面"那一半**没被推翻**，仍等拍板 #1/#8，且它替换的是同一块位置 —— 不另开第三处。token 三枚新增（`--ht-layout-detail-{width,min-width,max-width}` = 22/18/30rem）+ `--ht-layout-content-max` 的**语义**改成"中间列上限"（值没动），5 份生成产物同步。⚠️ 上下限今天**只是 `clamp()` 的两端，没有拖拽手柄** —— 别以为已经能拖。<br>**判据 3 条**（`e2e/tests/detail-column-slot.spec.ts`，生产构建载体 `vite build` + `vite preview` 端口 4358）：① 右边缘 == 视口右边缘（±1px）**且**中间列不贴边（只断言前者挡不住"两边一起缩进去"）；② 它是 `.ht-app` 的直接子项（几何成立的那条机制）；③ 宽度**等于** token 给的像素值 —— 阈值由 `pxOfCssVar` 从页面现读，不抄 rem→px，且先断言区间非退化。🔴 第一版这里写的是"落在 [min,max] 区间内"，那是**恒真判据**：轨道就是 `clamp(min,width,max)` 算出来的，任何越界值都被夹回区间。换成等值判据才有牙。<br>💥 **变异 5 臂，每臂复原后逐字节比对并复跑回 3 passed**：M1 把列搬回 `.ht-content` ⇒ **2 红**（两条视图各红在右边缘，读数 `904 没贴到 1280`）；M2 两轨那条不走 token 写 `24rem` ⇒ **1 红**（`384 ≠ 352`）；M5 共用的 `--ht-detail-track` 整体不走 token ⇒ **2 红**而窄档那条**仍绿**；M3 摘 769–1023 收起 ⇒ 红在 900 那一句；M4 摘 ≤768 收起 ⇒ 红在 700 那一句、900 仍绿。🔴 **M2 的第一版是存活的（2 passed）**：那时两条用例都停在带侧栏那一面，生效的是四轨声明，**两轨那行零判据** —— "两条都绿"读起来像"宽度判据有牙"，其实是同一行声明量了两遍。第三条用例就是这条存活臂换来的（§8.3 第 4 条）。<br>**门禁 10 道 RC=0**：`check:design` / `check:row-single-source`（`ht-*` 前缀族 **28 = 基线 28，未新增** ⇒ 命名走 `.ht-app__detail` 而不是新起一族，先例 `.ht-content__calendar-host`）/ `check:l4`（web 98≤104、mobile 90=90，**没调基线**）/ `check:layering` / `check:ui-language` / `check:selection-single-source` / token 产物 `--check`（8 文件 204 token）/ design-system 489 tests / `check:server-design`（41 个，布局 token 不上服务端）/ `check:arkts`（真编译器过）。<br>**截图**：新增 3 张（`desktop-with-detail` / `no-sidebar-view` / `back-to-desktop`）+ W1 那 5 张因布局多了 352px 而整体重跑，**八张逐张打开看过**：详情列在两张视图里都是窗口右边那条带发丝分隔边的空白列；选中那条在列表/四象限/时间线/搜索里仍是唯一带浅蓝底的一行。看图另照出一件断言看不见的事：`parkCursor` 第一版落点 `(640,40)` **恰好压在顶栏「同步」按钮上**，那张证据图里那个按钮带着 hover 环 ⇒ 改成按视口算右下角并移进 `helpers.ts`（`0de58095`）。<br>**边界（别读多）**：窄档今天只有**宽度**条件，"看高也看宽 + 收起按钮 + 三条恢复路径 + 持久化"是 W4；这一列里放什么是"详情面本体"那一单（拍板 #1/#8）。⚠️ 未做四端重装，窗口判据同 W1 那行。⚠️ 本 worktree 的 `node_modules` 与 `e2e/node_modules` 是指向主检出的**软链**，而 `.gitignore` 写的是 `node_modules/`（带斜杠只匹配目录）⇒ 它们在 `git status` 里是 `??`，**在这个检出里永远不要 `git add -A`** |
| W3 | 🔄 **进行中**（决定已钉死、三臂各红在指定那一条、两张图人看过；只剩 §6.1.1 四端重装） | **零 CSS 改动** —— 这不是没做，是量出来的结果就是工单取的默认值："设置浮层不盖第四列"（几何上根本不相交），"搜索浮层盖满视口但透出下层"。决定本身分**三种机制**达成，所以判据也必须写成三种：<br>① `.ht-sheet` = `absolute; inset:0` 挂在 `.ht-content` 里 ⇒ 与详情列**盒子不相交**（第四列是 `.ht-app` 的直接子项，在它外面）；② `.ht-search-overlay` = `fixed; inset:0`（2026-10-01 为"一开搜索列表跳回顶部"那个缺陷改的）⇒ **相交**，靠 `--ht-material-scrim` = `rgb(15 23 42 / .32)` 半透明透出；③ 模态层 `.ht-sheet__reconfirm` / `.ht-trash__overlay` 也是 `fixed; inset:0` ⇒ 盖一切，**这是对的，不判**（登记在下面那条枚举里）。<br>🔴 **判据一律写成盒子相交，不写 `toBeVisible()`**：被浮层整个盖住的元素照样 visible（Playwright 的 visible = 有盒子且非 `visibility:hidden`），那条会绿在"详情列已被盖死"的界面上。<br>**判据 2 条**（`e2e/tests/detail-pane-overlay.spec.ts`）：每条都配**正向对照**（设置那条先断"浮层确实盖住了 `.ht-main`"，否则"不盖详情列"在浮层压根没渲染时也成立 = 恒真）；搜索那条同时钉"它盖到详情列"（决定变更要回来改判据并说明理由）与"scrim 的 alpha **在 0 与 1 之间**"（下界不是凑数：alpha=0 等于没有 scrim，"透出"就成了空话），外加列宽仍等于 token、右边缘仍贴视口。<br>**变异三臂**（每臂重新 `vite build` 再跑、复原后逐字节比对、复跑回 2 passed）：N1 `.ht-sheet` 改 `fixed; inset:0` ⇒ 1 红，读数 `sheet 右边缘 1280 vs 详情列左边缘 928`；N2 scrim 的 alpha 改 1 ⇒ 1 红 `alpha=1 不小于 1`；🔴 **N3 打的是防作弊机制自己** —— 把浮层缩成左上角 4rem 小块 ⇒ 红在**正向对照**那句（`连中间列都没盖住…这条就成了空判据`）。三臂里未触碰的那条用例每臂都仍绿。<br>**既有判据继续绿**：`apps/web/tests/settings-sheet-ia.spec.tsx` + `search-overlay-ia.spec.tsx` = **8 passed / 0 failed**（W2 改布局之后重跑的）。<br>**整屏/浮起层的完整枚举**（`grep position: fixed apps/web/src/styles/`，6 处，别再重新推一遍）：整屏非模态 1（`.ht-search-overlay`）、内容区内 1（`.ht-sheet`，是 `absolute`）、模态 2（reconfirm / trash overlay，`fixed; inset:0` + `--ht-z-modal`，**盖一切是对的**）、锚定小面板 3（`.ht-inbox__panel` / `.ht-accountmenu__panel` / `.ht-rail__label`，不参与"盖不盖列"这个问题）。<br>**截图 2 张**（`apps/web/evidence/detail-pane-overlay/{settings-sheet,search-overlay}.png`）**都打开看过**：前者设置面盖住中间列、下层"收集箱"字样淡淡透出、**右侧详情列完全不被染色**（发丝分隔边清楚）；后者整屏被 scrim 压暗，rail / 侧栏 / 详情列一起变灰但仍读得出来，卡片贴顶居中。⚠️ 未做四端重装。 |
| W4 | ⏸ 未开工 | |
| W5 | 🔄 **进行中**（代码链、三层判据、六臂变异、三张图逐张看过、十七道 RC=0 都闭合；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | 载体 `feat/detail-pane` = `84d5bd86`（15 文件 / +705）。**这一单真正搬走的是"颜色"那半边判断，不是新加一个控件。** 之前 `priorityColorToken` 在 `apps/web/src/features/tasks/priority-display.ts` 与 `apps/mobile/src/lib/priority.ts` 各有一份**逐字相同**的实现，两份的文件头都写着"`packages/ui` 依赖不了 `@heyta/i18n` ⇒ 共享不了" —— **那句话只对文案那半边成立**：档位 → 色 token 名只需要 `Priority`（`@heyta/domain`，`packages/ui` 早就依赖）。于是"复选框描边即优先级"（调研 A2 那条"最值得抄"）一直没人能落地，因为**行组件够不到那份映射**。现在唯一所有者在 `packages/ui/src/task-list/priority-color.ts`，`TaskRow` 用 `row.source.priority` 查它给 `box` 上色，两份镜像**删掉**（AGENTS §3.5：抽取的收尾是删旧那份 + 加门禁，不是再写一份更好的）。<br>🔴 **预期差在哪**（这条改了视觉，所以判据里不许出现"改前后逐字节相同"那类零视觉断言）：高 `color.border-strong`(slate-300) → **`color.priority-high`**(light #dc2626 / dark #f87171)、中 → `priority-medium`(#b45309 / #fbbf24)、低 → `priority-low`(#0284c7 / #38bdf8)、**无优先级/字段缺失** → `priority-none`(#94a3b8 / #64748b，比原来那圈略深，仍是中性灰)、**已完成不变**（主色实心 + 主色描边 + 白勾）。<br>**判据 15 条，分三层**：① `packages/ui/tests/task-row-priority.spec.ts` **11 条** —— 映射穷尽（含 `undefined` 与 `None` 同值、档位清单从 `Priority` 现取不抄字面量）、四个 token 名在 light/dark 两张表里**真的存在**、三档取值两两不同 × 两个主题、`none` 不与任何一档撞色、dark 与 light 四枚全不同值（"暗色实际切了看"的数据层证据）、源码级（`TaskRow` 必须 `priorityColorToken(row.source.priority)` 且 `styles.box` 里**不许**再有 `color.border-strong`）、逐行色排在 `box` 之后 `boxDone` 之前、**全仓只有一份定义**（遍历 `apps/`+`packages/` 源码，跳过 `node_modules`/`dist`/`dist-types`；刻意不用点名清单 —— 点名挡不住"在第四个文件里再写一份"）；② `apps/web/tests/row-meta-shared.spec.tsx` 的 A 组换了一条**行元信息画的是共享映射的取值、而且不串档**（jsdom 里 `cssColor()` 探针把 token 取值过一遍这台 jsdom 自己的序列化，不拿 hex 去 `toContain`），D 组那条"两边 token 名一致"**原地改写成新不变量**（原来那句在抽取后**不可能失败**，留着就是装饰）：宿主里不许再有 `color.priority-*` 与 `function priorityColorToken`，三个消费者必须从 `@heyta/ui` 取；③ `e2e/tests/task-priority-checkbox.spec.ts` **3 条**真浏览器 —— 优先级经**真的在捕获框里打 `!1/!2/!3`** 写进去（输入框占位文案就写着「可写『明天』『下周三』『!1』」），每条先断**徽章在场**（那是载体前提，不是产品判据），再断四行描边**各等于该 token 在当前主题下的解析值**（`colorOfCssVar` 页内探针，不抄色值）**且两两不同**，第三条 `data-theme==='dark'` 正对照后同样量一遍。<br>💥 **变异 6 臂，逐臂复原 + 字节比对 + 收尾重建两个 dist**：A1 描边写死回中性色（工单点名的那条）⇒ `ui` + `e2e` 红；A2 `undefined` 改投 High ⇒ `ui` 红；A3 摘掉 `boxDone` 的描边 ⇒ `ui` + `e2e` 红；A4 在 web 宿主里再写一份定义 ⇒ `ui` + `web` 红（两道"抽取收尾"门各抓一次）；A5 逐行色排到 `boxDone` 之后 ⇒ `ui` 红；A6 `High` 指向 `medium` 的 token ⇒ `ui` + `web` + `e2e` 红。**如实记哪层没抓到**：A1/A2/A3/A5 在 `apps/web` 那一趟**是绿的** —— 那一份判据量的是徽章那条通道，勾选框不在它范围内，这不是漏判，是分层；勾选框的渲染层读数只有 `e2e` 那一层有。<br>**门禁与测试 17 项 RC=0**：`check:design` / `check:row-single-source`（`ht-*` 族 **28 = 基线 28**）/ `check:l4`（web 98≤104、mobile **90 = 90**，**没调基线**；`packages/ui` 本来就在 L4 门外，见该脚本第 24 行）/ `check:layering` / `check:ui-language` / `check:selection-single-source` / `check:ui-provider` / `check:rn-aria` / `check:licenses` / `check:docs-voice` / token 生成 + `--check` / 全量测试 **ui 453 · web 1524（12 skipped）· mobile 604 · design-system 489，零失败**；`packages/ui` 改完先 `tsup` 再跑判据（工单 §1 闸门 4）。<br>**截图 3 张**（`apps/web/evidence/task-priority-checkbox/{light-four-tiers,dark-four-tiers,light-done-overrides-priority}.png`）**逐张打开看过**：亮色四行的圈分别是红/琥珀/天蓝/中性灰，且**只有前三行带徽章**（"没有优先级不是信息"那条纪律没被破坏）；暗色同样四色且都读得出来（`#f87171`/`#fbbf24`/`#38bdf8`/`#64748b`）；完成那张是**实心主蓝 + 白勾**，优先级没有盖过"做完了没有"。<br>🔴 **看图照出、断言看不见的一件事**：默认 720 高的那张图里**只有三行** —— 第四行"无优先级"在折叠线下面（AI 面板占了半屏，那是 `enableAllModules` 的结果）。判据量四行而证据图只有三行 = 图与读数不对齐，所以本套件自己 `test.use({ viewport: 1280×1000 })`。<br>**边界（别读多）**：① 描边**不是也不许变成唯一通道** —— 颜色对色觉障碍用户不成立，所以行内那枚**带文字**的徽章必须留着（描边管"扫一眼"，徽章管"读得准"）；删徽章是另一个产品决定，不是这一单的副产品。② 移动端与桌面三壳用的是**同一个** `TaskRow` ⇒ 四端同时受益，但 `apps/mobile/tests/` 里 **0 个用例 render 组件**，所以 RN 侧没有渲染级判据，那一层的证据只有 §6.1.1 的四端重装 + 模拟器截图，**本轮未跑**。③ 未 push 未 merge。 |
| W6 | ⏸ 未开工 | |
| W7 | ⏸ 未开工 | |
| W8 | ⏸ 未开工（阻塞于 C1#2 **拍板**，不再阻塞于证据） | 一手对照已落调研 [C1b-Q2](../research/detail-pane-alignment-and-spaced-review.md)（2026-10-03 19:27 到齐）：Loop / Habitica 给了逐行 `file:line`，Streaks / 滴答 / Apple / Google 给了一手文档。**推荐与代价都写好了**，剩的是拍"天 vs 次 / 自然月 vs 滚动 / 日历 vs 韧性"这三个值。🔴 拍板前必读那节末尾的**依赖声明**：凡期望值涉及"一天打 N 次"的，W6 落地前不可达 |
| W8a 值与词同源 | ✅ 已完成（2026-10-03，载体 `feat/detail-pane` = `9fc414b5`） | 它是缺陷不是选择，所以从 C1#2 拆出来先做。`resilience.total` = **达成天数**（`habit-resilience.ts:197`），七个键却印成"累计 N 次"（en `{count} check-ins`）⇒ 全改在**句子**侧：zh `web.habits.streak.total{,One}` / `row.aria` / `freshStart` / `mobile.growth.streak.{total,freshStart,a11y}` + en 两条 chip（`Total {count} days`，与同族 `Streak {count} days` 同形）；生产者侧四条**注释**同一个谎（`habit-resilience.ts:74/272`、`HabitBoard.tsx:145`、`HabitStreakList.tsx:6`）一并改；`ui/src/habits/model.ts:89` 那句"`count` 是那天打了几次"与 `:279` 的 `count = done ? 1 : 0` 自相矛盾，按后者改。**判据**：`packages/i18n/tests/habit-total-copy.spec.ts` 4 条。**变异六臂**：A1 row.aria 说回"次"→红 / A2 两条 chip 说回"次"→红 / A3 en 说回 check-ins→红 / A4 把 `累计 {total}` 搬进未登记的键→红（漏登记门）/ A5 把 `{total}` **改名**→红 / C0 负向对照"打卡 N 天"→**仍绿**（认语义不认字面）。🔴 **A5 是这单真正产出的判据**：第一版写 `if (!value.includes('{total}')) continue`，占位符一改那条被**静默跳过**，实测**整套 26 条全绿** —— 即"跟着数据走的循环用 `continue` 做前提校验"这个形状本身就是一个洞。另两条顺手账：`habits-board.spec.tsx` 那条把句子写成字面量 ⇒ 改成"字面量 + 与词条的漂移自检"（第一版自检因两侧空格不同而假红，去空白后再比）；`packages/ui/tests/projects-model.spec.ts` **从 `192a516d` 起就是红的**（那笔提交给 `OrganizerNode` 加了承重的 `archived`，没同步白名单）⇒ 补齐清单、判据强度不变，**归属在别人那笔提交，这里只修断言不动行为**。**读数**：i18n 26 / ui 442 / domain 821 / app-host 990 / mobile 601 / web 1512 passed \| 12 skipped，零失败；九道门禁 rc=0（含余量为 0 的 `check:l4`、`check:row-single-source`，**没调基线**）。⚠️ 未做四端重装（本单只改词条与注释，无产物形态变化；固定收尾留到 W1/W2 那批界面单一起跑） |
| W9 | ⏸ 未开工（阻塞于补打卡窗口决定） | |
| W10 | ⏸ 不在本篇开工（阻塞于 C1#9–12） | |
| W11 | ⏸ 未开工（阻塞于是否重开"不做删除"） | |
| W12 | ⏸ 未开工（阻塞于是否要做正计时） | |

---

## 8.1 W1 收口时的归因与登记（2026-10-03 现量）

**`pnpm check:docs` 报的四处死链，逐条问过"文件在谁手里"**（判据是同一文件的未提交 diff，
不是"某条线在忙"的印象）：

| 出处 | 指向 | 现量 | 处置 |
|---|---|---|---|
| 本篇第 4 行 | `calendar-year-time-and-mobile-profile.md` | 主检出里 `??`（**未跟踪**），`git log --all --diff-filter=A` 查不到 | 已改：链接 → 带状态的路径指针 |
| 调研第 101 行 ×2 | `trash-and-archive-best-practice.md`、`../plans/trash-and-archive.md` | 同上，`??` | 已改：链接 → 路径 + "那条决定归回收站线自己提交" |
| `PROGRESS.md:1362`（**已提交**的那一行） | `docs/research/aed-implementation-evidence.md` | 该文件在主检出里**存在但是未跟踪**（`??`，`git log --all --diff-filter=A` 查不到）⇒ 干净检出上是死链 | **只登记不代改**：那行属于回收站/A-E-D 那条线，由他们提交目标文档来关 |
| `docs/plans/countdown-anniversary.md:1280` | ADR 索引的**第 1 节**（那个章节号不存在） | 倒数纪念日那条线的文档 | **只登记不代改** |

改成"路径而不是链接"而不是删掉引用：那两份文档里的裁决是**真前提**（`FOCUS_SESSION` 不做删除），
删掉引用会让那句结论没有出处；但**干净检出不该有死链**，所以指针要带上"它现在活在哪"。

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
NO_COLOR=1 node research/tools/docs-link-check.mjs; echo RC=$?
git log --all --diff-filter=A -- docs/research/aed-implementation-evidence.md | head -1   # 空 = 从未被提交
cd "$(git rev-parse --show-toplevel)/.." && git status --porcelain docs/research | head  # ?? = 未跟踪
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

## 8.54 2026-10-04 AI 面搬进右栏这一轮的三条（**待入 traps**，编号按追加时的活树现量取，别照这里写死的号走）

> ⚠️ **本节原本写的是 `§8.5`，撞号了，07:0x 现量后自己挪到 8.54**：本篇的权威增长发生在
> 分支 `feat/detail-pane`（工作树 `.worktrees/detail-pane`），那里已经排到 **§8.53**（`git show
> feat/detail-pane:docs/plans/detail-pane-alignment.md | grep -c '^## 8\.'` = **53**），
> 而 main 上这份副本只到 §8.4 ⇒ 我在主检出按"末尾 +1"取的 8.5/8.6 **正好压在分支的 §8.5（W6 五条）
> 与 §8.6（W4 更正）上**。处置按既有裁决：**取号方自己挪**，不动别人那一节。
> 📌 一般规律：**"按本副本的末尾 +1 取号"只在单一写者副本里成立**；同一文件在分支上更长时，
> 取号前必须 `git show <branch>:<file>` 量一次，而不是量工作树。


1. 🔴 **把内容搬进一个"由 CSS 条件隐藏"的容器，症状不是报错，是某一档宽度上功能凭空消失。**
   产品负责人要求 AI 面搬到 `.ht-app__detail`（最右那一栏），而这一栏在 ≤1023px 是
   `display:none` 的（规则在 `styles/app/narrow.css`）。照字面搬完，平板档和小窗用户的
   两个 AI 面板**一起没了** —— DOM 里没东西可断言失败，控制台一条错都没有，
   套件在默认 1440 宽上跑照样全绿。
   ⇒ 凡是"往某个容器里搬"的工单，开工前先查**那个容器自己受什么条件摆布**
   （`display:none` / `content-visibility` / 媒体查询 / 被 `overflow:hidden` 裁掉），
   并把"另一档宽度上这份内容在哪"写成一条**正向存在性**判据，不是"没报错"。

2. 🔴 **断点的真源在 CSS；在 JS 里再写一遍 `1024` 就是一份会漂的抄件。**
   上面的回退分支没有写成 `window.innerWidth >= 1024`，而是量那一栏**实际有没有宽度**
   （`getBoundingClientRect().width > 0`）。改 CSS 的人不会被告知 JS 里藏着同一个数字，
   而两处不一致的表现正是第 1 条那种"看不见但存在"。
   ⚠️ 依赖 `box-sizing: border-box` 全局生效（`design-system/src/reset.css`）——
   否则 padding 会让"有没有宽度"读错。

3. ✅ **判据的非虚假性这次是靠"两条互斥断言"证的，不是靠变异臂。**
   宽档（1280）断 AI 面**必须在右栏那个框里**、窄档（660）断**必须在 `.ht-main` 里**，
   同一份 JSX 只有一个挂载点时这两条**不可能同时成立** ⇒ 至少一条必然抓住放错地方。
   变异臂只做了"把「收集箱」那行加回 `PRIMARY_NAV`"（web 1 红 / landing 1 红，复原后逐字节相同）；
   **第二臂（拿掉 rail「任务」那格的重置分支）刻意没做** —— 它要原地改 `App.tsx`，
   而该文件当时带着并行会话未提交的 hunk。那条臂的牙暂靠 delta 结构
   （先挪走筛选再验"回来位置保留"与"再点回收集箱"），**登记为待补，不算已验证**。

> 📌 取号事实（2026-10-04 06:5x 现量）：`docs/reference/environment-traps.md` 此刻被别人
> **+355/−7 未提交**占着，活树最大号 **246**（HEAD 只到 228）。按"目标台账正脏着几百行时
> 不往它追加"的纪律，这三条不落本体，落在本节；追加时**先重新现量尾号**再取号。

## 8.55 落地记录：AI 面进右栏 + 删重复的「收集箱」行（2026-10-04，载体 `78cdff67` + `ff22777c`）

（这一节原写 `§8.6`，与分支 `feat/detail-pane` 的 §8.6「W4 第一条更正」撞号，
挪号理由与现量见上面 §8.54 开头那块。）

产品负责人两条界面指令的落地行（它不属于 W1–W12 任何一单，但改的是 W2 那一列的内容，
所以记在本篇，而不是另建一个"记忆"文件）。

| 面 | 读数 |
|---|---|
| 改动 | `apps/web`：`PRIMARY_NAV` 去掉 `{ kind: 'all' }`、`navCounts` 去掉 `all`、rail「任务」那格按"是否已停在任务视图"分叉、`aiPanels` 一份实现两个挂载点、`.ht-app__detail` 装 AI 面 + `padding-inline`。`apps/landing`：mockup 的 `SHELL_PRIMARY_NAV` 同步减一项（对账门禁逼的，见下）。 |
| typecheck | `apps/web` rc=0、`apps/landing` rc=0 |
| 单元测试 | `apps/web/tests/app-mount.spec.tsx` **23 条**（改写的那条在内）、`apps/landing` 全套 **1317 条** |
| 真浏览器 | `e2e/tests/ai-row-layout.spec.ts` + `inbox-dida.spec.ts` 等 **21 条**，两张关键图**人已打开看**：1280 ⇒ 右栏是「AI 工具调用」+「对话助手」、侧栏只剩 今天/最近 7 天/已完成、页头写「收集箱」；660 ⇒ AI 面退回中间列。<br>07:0x 端口空出来后补跑 `ai-assistant` + `ai-tool-run`（这两条是搬动唯一的剩余回归面）⇒ **3 passed / 0 failed**，含"写工具只出提案：确认前不落库、确认后一次都不再多出境"那条。合计 **24 条**，载体都是主检出工作树 + dev 服务（4318/4319） |
| 门禁（**提交后**复跑） | `check:design` / `check:ui-language`（329 文件、zh 3103 = en 3103 词条）/ `check:row-single-source`（`ht-*` 族未新增，走 `.ht-app__detail`）/ `check:layering`（361 文件 9 规则）/ `docs-link-check` 无死链 —— 全绿 |
| 变异 | **半臂**：把「收集箱」加回 `PRIMARY_NAV` ⇒ web **1 红** / landing **1 红**，复原后 `cmp` 逐字节相同。第二臂（拿掉 rail「任务」的重置分支）**未做** —— 要原地改带别人未提交 hunk 的 `App.tsx` ⇒ 登记为待补 |
| 未闭合 | **AGENTS §6.1.1 四端重装**：06:5x 现量 `notarytool` pid 98934 已跑 **11h42m**（别人那趟公证的 `--wait`，不动它），`vm.loadavg` **31.60**（仓库负载门阈值 12）⇒ 按红线记为**环境无效**，不起装、不放宽判据、不 push。<br>🔴 **07:0x 第二次读数把性质改了**：`queue-reinstall-all.sh`（pid 81007 / 93771）已活 **11h57m**，`/tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817` 同批 **11h54m** —— **四端重装那把槽位本身被一趟 ~12h 没动的运行占着**（`notarytool` 仍在、5 台 Booted 模拟器、1 台 adb 设备、负载 16）。⇒ 不是"等窗口空出来"，是**需要持有者介入或由产品负责人决定停掉那趟**；我现在起它 = 用 `adb uninstall` / `simctl uninstall` 清掉别人的设备现场。另一个结构性原因同 W1/W2 那行：**唯一有意义的重装时机在合流之后**。 |

两条顺带钉住的机制（不是这次的选择，是现量）：

- **落地页那枚对账门禁是真的会挡人**：`apps/landing/tests/mockup-shell-shape.spec.tsx`
  从源码里解析 `PRIMARY_NAV` 与 `SHELL_PRIMARY_NAV` **逐项同 key、同序**比对 ⇒ 删掉侧栏那一行
  必须同时改 mockup，否则 landing 套件红。这条正是"同一结论抄两处"的常驻哨兵。
- **隐私五条不变量零改动**：搬动的是同一段 JSX（`contentView === 'tasks'` 那道闸、
  `grants` / `tier` / `consents` / `secrets` / `onHealth` 逐个 prop 原样），
  没有新词条、没有新的授权前端、写工具仍然只出提案。

📌 **待入 PROGRESS.md**（本篇这行就是那条台账内容）：`PROGRESS.md` 此刻被并行会话
**+41/−1 未提交**占着，且项目记忆已记下"两种提交办法都不许用"（整文件 `git add` 会带走别人的行；
临时索引构造 HEAD+我的 EOF 追加会在别人随后整文件提交时被抹回去）。等该文件干净时由收口的人
把本节搬过去，**不要**在这里插队提交。

📌 **两件没闭合的，各自写明在谁手里**（下一个跑全链的人不要替它们代改）：

1. ~~`e2e/tests/ai-assistant.spec.ts` 与 `ai-tool-run.spec.ts` **本轮没复跑**：06:5x 现量
   `lsof -nP -iTCP:4318 -sTCP:LISTEN` = pid 53715、`4319` = 53701 —— 并行会话那趟浏览器套件
   正在跑，而 `playwright.config.ts` 是 `--strictPort` + `reuseExistingServer: false`，
   起不来也不去抢（那把按端口 SIGKILL 的刀在仓库 `check:ai-e2e` 的包装里，不在配置里）。
   按"环境占用如实记录"处理，**不算**这两条已过。风险面读过：两条用例全部走 `data-testid`，
   不含列几何 ⇒ 位置改动理论上够不着它们，但"理论上"不是证据。~~
   ✅ **07:0x 端口空出来后复跑，3 passed / 0 failed（15.0s）**：载体是**主检出工作树 + dev 服务**
   （`vite --port 4318` + 假端点 4319），三条分别是助手那条多轮旅程、单步"规则命中零出境→披露后出境"、
   以及**"写工具只出提案：确认前不落库、确认后一次都不再多出境"** —— 最后这条正是隐私那条
   在界面上的读数，搬动之后仍然成立。这一格至此不再是缺口。
2. `docs-link-check` 在 06:5x 复跑时变成 **1 红**：`docs/adr/0050-…:83` 新增的
   `../../apps/mobile/evidence/ios-node-vault-interop-20261004.txt` **本机存在、git 未跟踪**
   （那枚证据 14:57 刚生成）。**归属 = Vault 那条线**（ADR-0050 在他们手里 +66/−10 未提交）；
   `git show HEAD:docs/adr/0050-e2ee-key-lifecycle-and-recovery.md` 的第 83 行**没有**这个链接
   ⇒ 干净检出是绿的，这条红**只在混合工作树成立**，由他们下一次提交（带那枚证据的 `git add`）关闭。
   上面"门禁全绿"那一格读的是 06:5x 那趟，当时确实绿。

📌 **本批给合流面添了 2 枚，逐枚写清落点与意图**（07:0x 现量：
`git merge-tree --write-tree feat/detail-pane 23bbf2f1` = **15** 枚，`… HEAD` = **17** 枚，
差集恰是 `apps/web/src/App.tsx` 与本篇；其余 15 枚与 10 枚证据 PNG 不是我添的）：

- **`apps/web/src/App.tsx`**：两边在**同一个锚点附近各插一块状态**（分支 `feat/detail-pane` 在
  `f419df75` 之后对该文件 **+135/−2**，其中 43 行插在旧 line 613 处 = 工单 **W4「用户主动收起详情列」**
  的 `data-detail` 状态与三条恢复路径；我那 30 行插在 621 处 = `detailHasRoom`）。
  解法意图：**两边都要**，不是择一 —— 而且他们那段注释里那句"两处不许合成一个布尔"正好说的是这件事：
  几何（本档）与用户选择（他们的 `data-detail`）必须是两个量。
  🔴 **合流后天然成立的一件事，实测取自他们的 CSS**：`base.css:98` 写的是
  `.ht-app[data-detail='collapsed'] { --ht-detail-track: 0 }` ⇒ 用户收起时那一栏宽度归零，
  我这句 `width > 0` 自动读成假 ⇒ **AI 面自己退回中间列，一行代码都不用加**。
  这正是"量实际宽度"换回来的东西：如果当初在 JS 里抄 `1024`，他们的收起功能会**需要有人记得**
  来这边加一个 `|| collapsed` —— 而没人会想起要加，症状依旧只是"面板不见了"。
  ⚠️ 别把中间列那行 `{detailHasRoom ? null : aiPanels}` 当重复代码删掉，那是唯一的回退。
- **本篇**：纯文本撞末尾 + 我这次的两节序号（见 §8.54 开头那块），**无语义冲突**，
  两边小节全部保留、按各自分支内的相对顺序排在最后即可。
