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
| W1b 键盘光标 | 🔄 **进行中**（三层判据、22 条变异臂全红、七张图逐张看过、九道门禁 RC=0；但**原判据三条腿只落了第一条** —— "详情面跟着换"阻塞在拍板 #1、"Enter 打开焦点"阻塞在拍板 #8，四端重装也未做 ⇒ 不算已完成） | 原 W1 判据 ③「↑↓ 移动选中」**拆到这一行**，理由不是省事：`TaskList` 的 `activeTaskId` 是**展示槽**，而"往哪走"要有目的地才有意义 —— 详情列（W2）没开之前，回车没有可去的地方。判据是"↑↓ 改选中 + 详情面跟着换 + Enter 打开焦点"。<br>载体 `feat/detail-pane` = `6c3c1ecd`。<br>**分层与裁决**：规则在 `packages/app-host/src/selection.ts` 的 `moveSelectionInList`（四条：方向进列表 / 夹住不环绕 / 不猜位置 / 可返回同值），宿主只回答"当前哪个视图、那一串 id 现在在 DOM 里的顺序、什么时候不该响应、要不要滚进视野"。🔴 **顺序从渲染出来的那一串行取，不再算一遍**：列表顺序今天有四个所有者（`groupTasksByDate` + `collapsedGroups` / `QuadrantBoard` 的格子序 / `TimelinePanel` / 习惯与便签各一份），宿主自己算就是**第五个**，症状是"眼睛在第 3 行、选中跳到第 5 行"而两边都不报错。`search` 与 `trash` **刻意不进表**（前者自己有一条走结果数组的光标，两边都响应同一个键 = 一次跳两格；后者的 ↑↓ 是"选恢复还是删除"，语义完全不同）。<br>**三道"不响应"，第三道是看图看出来的缺陷**：① 正在打字；② 有浮层（今天**三个真浮层分两种形状**：设置 `.ht-sheet`、搜索 `role="dialog"`+`aria-modal="false"`、法务二次确认 `role="dialog"` 且**不带**裸 `.ht-sheet` ⇒ 选择器只认一种就会漏）；③ 🔴 焦点落在 `[role="menu"]` / `[aria-haspopup="menu"]` 上。第三条的来路：K3 那张图的第一版里**账号菜单是开着的** —— Esc 关设置浮层时焦点按既有设计回到头像（`App.tsx:473-479`），而头像那颗按钮自己把 ↓ 用作"打开菜单"（`AccountMenu.tsx:299`），于是同一次按键**既弹菜单又把底下那栏的选中挪走**；菜单展开时同理，它的面板既不是 `.ht-sheet` 也不是 `role="dialog"`，第 ② 道挡不住。裁决是**焦点归谁、键就归谁**（反过来让列表光标赢会弄坏 `AccountMenu` 那条既有、且有用例的键盘入口）。<br>**判据 40 条分三层**：规则层 +9（空列表 / 没选中时两个方向各进列表 / 中间 / 两端夹住 / 单条 / 当前不在列表 / "只按传入顺序不自己排序"用故意倒序夹具钉 / 连按五次轨迹 / 纯函数不通知），该文件现 25 passed；宿主层 `apps/web/tests/keyboard-cursor.spec.tsx` **24 条**；真浏览器 `e2e/tests/keyboard-cursor.spec.ts` **K1–K7**（生产构建载体 `vite build` + `vite preview` 端口 4371）。<br>💥 **变异 22 臂全红**：jsdom 层 15 臂（B1–B15）红集**逐条点名** —— B1 环绕 2 红 / B2 进列表 2 红 / B3 自己排序 1 红 / B4 摘打字闸门 2 红 / B5 摘浮层闸门 2 红 / **B11 把浮层选择器缩到只剩 `.ht-sheet` ⇒ 恰好 1 红**（新加的 dialog 腿单独红，证明它不是把 B5 又量了一遍）/ **B12 摘"焦点归控件"闸门 2 红** / B6 去重 1 红 / B7 端点吞键 1 红 / B8 滚进视野 1 红 / B9 绑 `view` 1 红 / B10 摘掉 habits 那一行 1 红 / **B13 把真生产者（`packages/ui/src/notes/NotesBoard.tsx:294` 的 `testID`）改名 ⇒ 恰好 1 红，只红“前缀 ↔ 生产者”那一条** / **B14 把表里的 `note-row` 写成 `note-card` ⇒ 2 红**（那条 + notes 那一圈循环 —— 这一臂顺手把新判据存在的理由钉住了：**插出来的 DOM 抓不住表错**，它注入的是测试自己那份 `cases` 字面量） / **B15 把表里五处 `prefix: '…'` 的单引号换成双引号（运行时逐字等价）⇒ 恰好 1 红，且红在“解析出 0 项也算红”那句守卫上**（没有那句，前缀表一改写法这条判据就静默变成永真）。浏览器层 7 臂（C1 摘浮层 ⇒ K3 红 / C4 摘焦点闸门 ⇒ K5 红 / C5 摘打字闸门 ⇒ K2 红 / C2 端点环绕 ⇒ K1 红，C2 那条证明 e2e 这层走的确实是 app-host 的规则而不是宿主又算了一遍 / **C6 表里 `habit-row` 写成 `habit-card` ⇒ K6 红** / **C7 把 `notes` 那一行整个摘掉 ⇒ K7 红** / **C8 把便签编辑器当成浮层（往第②道闸门的选择器里加 `[data-testid^="notes-editor"]`）⇒ K7 红** —— C8 才是 K7 那句关键前提（“编辑器不算浮层，所以闸门不挡它”）的靶子：没有它，K7 只是在描述一个巧合）。每臂复原后 sha256 逐字节比对、`dist/` 目录摘要回到干净态（`BACK_TO_CLEAN=True`，干净摘要 `e0c768102d639a5e`），每臂都先打 `REACHED_ARTIFACT=True` 才有资格判红；并各跑一次"不复位也全绿"的阴性对照（jsdom 24 passed / e2e 7 passed）。<br>🔴 **两条"存活"要分开记，一条是判据缺口、一条本来就不该有牙**：① C5 头两趟存活 = 判据缺口，全过程与改法在 **§8.9 第 2 条**；② **C3（把绑定从 `contentView` 换成 `view`）预期存活且确实存活** —— 绑 `view` 时开着设置面板根本没人绑，K3 的负向腿白过，两道机制在浏览器上**不可区分**。所以"`contentView` 那条绑定"只有 B9 一处消费者（源码级断言），**不许声称浏览器层有它的牙**。它是真冗余还是真必要，取决于第②道闸门哪天被简化掉 —— 那之前这一行就是它的现状。<br>**门禁 9 道 RC=0**：`check:layering`（332 文件 9 规则）/ `check:selection-single-source`（词表 3 类全有消费者 task 10 / habit 7 / note 13，宿主内本地选中态 0 处）/ `check:l4`（web 98≤104、mobile **90 = 基线 90**，没动基线）/ `check:row-single-source`（**28 = 基线 28**，本单没新增顶层 `ht-*` 族）/ `check:design` / `check:ui-language`（zh 2864 = en 2864）/ `check:migrations` / token 生成物两步（tsup → `--check`，8 文件 204 token）。typecheck：电池里那六条**改成从各包自己的 `package.json` 取 `typecheck` 脚本**（五个包是 `tsconfig.spec.json`、`apps/mobile` 是 `tsconfig.json`），六条 RC=0、各日志里 `error TS` 计数 0；spec 版曾抓到一条真错误（见 §8.9 第 3 条）。🔴 上一轮记的“六包 `tsconfig.json` 与 spec 各 RC=0”里，**电池那六条其实是恒绿的虚检查**（命令字面量抄成了 `-p tsconfig.json`），本轮修的是电池本身，不是读数。另加两步 `apps/web` 重打（`tsc -b` + `vite build`）再跑 e2e 那一族 —— 该配置的 `webServer` 只有 `vite preview`、**不建**，不重打就是在验上一轮的产物（§7 第 212 条那一族）。电池因此从 24 步变 25 步（多一条 `typecheck e2e family`），整条电池 25 步 RC=0、`BATTERY_RESULT=ALL_GREEN`。全量单测 domain 834 / app-host 1020 / i18n 26 / ui 459 / web **1585 passed \| 12 skipped** / mobile 607；e2e 详情面整族 **25 passed**。<br>🔴 **`check:docs`（`docs-link-check`）RC=1，而那一条死链不在本单**：`PROGRESS.md:1362` → `docs/research/aed-implementation-evidence.md`。现量三件：那一行是 `96f3293d`（别的线）已提交的、目标文件**此刻只存在于主检出且未被跟踪**（`ls` 有 / `git show HEAD:` 无）⇒ 在任何干净检出里它必然是死链。处置是**登记不代改**（两种改法分别是"替别人提交他的在途文档"和"动他那一行"，都不归本单）。本单自己的文档改动零死链，复跑：`node research/tools/docs-link-check.mjs 2>&1 | grep -c detail-pane-alignment` ⇒ `0`。<br>**截图 7 张，逐张打开看过**（`apps/web/evidence/keyboard-cursor/{k1-first-row-highlighted,k2-typing-row-unchanged,k3-cursor-back-after-closing-sheet,k4-quadrant-same-selection,k5-avatar-owns-arrow,k6-habits-cursor-aria-current,k7-notes-editor-follows-cursor}.png`）：k1 只有第一行带浅蓝底；k2 输入框里是"正在打字"且带焦点环、高亮停在**中间**那一行；k3 关掉浮层后**菜单没弹**、第二行带蓝（= 光标回来了）；k4 切到四象限还是同一条；k5 是那条缺陷的**修复后**读数 —— 菜单开着、头像带焦点环，而底下第一行仍带着高亮（= 一次按键只发生一件事）；k6 里三行习惯只有第一行「光标甲」带**蓝框 + 浅蓝底**、右窗格开的正是它（两种线索同一行，且那是夹住后的第 0 行）；k7 里编辑器开在板子**上方**（不是浮层），内容是「便签光标乙」，而下面两张便签卡**没有任何选中痕迹**。看图另照出一件**拍不出来**的事：`.ht-sheet` 的底色是 `color-mix(in srgb, var(--ht-color-background) 95%, transparent)`（`sheets.css:27`，那里自己写明"下层可见"的判据是 DOM 里标记仍在），95% 浓度下"浮层底下那一行没动"在像素上量不出来 ⇒ K3 的前半由断言证，图证只给它配套的那一半（关掉之后还在）。<br>**边界（别读多）**：① 三条腿只落了第一条，另两条等拍板 #1 / #8（`App.tsx:2532` 今天只有 `contentView === 'focus'` 一支，任务/习惯/便签那一栏里**没有可换的东西**）；② **接线只落了 web** —— 规则在 app-host，触屏端仍走"点一行"，移动端目前没有键盘光标这回事，别把这一行读成三端都接了；③ 🔴 **本轮闭合**（载体 `4b17213a`）：新增 `e2e/tsconfig.detail-pane.json`，编译器**借 `../apps/web/node_modules/.bin/tsc`** —— 不在 e2e 里装 typescript（那要过 AGENTS §3.1/§3.2 两道门，还会写进主检出那份**共享的** `e2e/node_modules`）。它第一趟就抓到本单自己的一处类型谎：`onlyHighlighted` 声明返回 `{at, title}` 而 `return` 里塞着 `id`，调用方靠 `as` 硬掰 —— 而跨投影那条判据（K4）比的正是 `id`。`include` 只圈本单六个文件：同一趟对 `tests/*.ts` 全量跑现量 **13 条错误分布在另外 6 个文件**（`calendar-cells` 5 / `calendar-week` 3 / `quadrant-fill` 2 / `task-row-touch-target` 1 / `search-overlay` 1 / `due-date-edit` 1），那是别的线在飞的活，**不吸收进来凑绿**（收进来只会得到“这道检查天生是红的”）。能不能失败也量了：真代码 RC=0 / 0 条错误，注入一句 `press(page, 'ArrowRight')` ⇒ RC=2 且精确报在那一行；④ 未做四端重装；⑤ ⚠️ 本 worktree 的 `node_modules` 与 `e2e/node_modules` 是指向主检出的**软链**，而 `.gitignore` 写的是 `node_modules/`（带斜杠只匹配目录）⇒ 它们在 `git status` 里是 `??`，**在这个检出里永远不要 `git add -A`**；⑥ 🔴 **上一轮这条边界写错了，撤回**：它写的是“web 上没有建习惯、建便签的入口，本轮做不到”，现量两处都在 —— `HabitsView.tsx:275` 的新建 `<input>`（`<form>` 在 268）与共享 `NotesBoard` 的 `notes-input` / `notes-submit`（`packages/ui/src/notes/NotesBoard.tsx:241-264`）。**错法值得记**：那句是按“模块开关默认关掉便签”的印象写的，没去读那两个视图的组件本体 —— 与 §8.9 第 4 条同族，新的是它的方向：**“没有某个入口”也是一条断言**，写它要过和写 `file:line` 同样的门槛。补上的是 K6 / K7 两条真浏览器判据（载体 `1dd23d25`，三臂 C6/C7/C8 各红在指定那一条），所以这一栏现在写的是**已证**而不是边界；⑦ e2e 那一族重跑会**改写别的单的三张 evidence png**（本轮：`detail-column-slot/no-sidebar-view.png`、`focus-detail-pane/f1-four-cards.png`、`focus-detail-pane/f5-aborted-record.png`，各差几字节），已 `cmp` 后 `git restore` 还原 —— 记下来是让下一轮别把它们当成自己的改动提交；⑧ 🔴 **K4 有一次只在并行时红过**（“切到四象限后高亮行数 = 2”），单独跑 3 次、整份文件再跑 4 次都没复现 —— **未定性**，不写成因也不改松判据；处置是把每行的 `{bg, near}` 读数打进断言消息（`test-results` 每次重跑会被清掉，快照不是可留存的证据 —— 这一次想回查时已经被我自己的复跑删掉了）。下一轮再红就直接读消息里的容器；⑨ **便签面上的选中没有可见痕迹**（K7 看图照出来的，不是推断）：`NotesBoard` 的行不带 `aria-current`、也没有换底色，光标每按一次的唯一可见后果是**上方编辑器换内容**。这条**不在本单动手** —— “选中该在便签面上产生什么”正是拍板 #1 的题面（`selection.select('note', id)` 今天同时就是“打开编辑器”），改法已量过：给共享 `NotesBoard` 加一个默认值等于原行为的可选 prop（`selectedId?`），与本仓 mobile 侧那条正解同形，代价是零消费者改动。 |
| W2 | 🔄 **进行中**（槽位、判据、五臂变异、八张图逐张看过、十道门禁都闭合；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | 载体 `feat/detail-pane` = `0c159f7f`（前置那笔 `0de58095` 是探针修复）。**落点与裁决**：详情列是 `.ht-app` 的**第四个轨道**、与 `<main>` 平级，不是 `.ht-content` 里的第二栏 —— `.ht-content` 自带 `max-inline-size` + `margin-inline: auto`，挂进去的列永远贴不到窗口右边缘，观感就不是"三栏 + 右详情"。轨道 `--ht-detail-track` **只在 `.ht-app` 上算一次**，两轨/四轨两条 `grid-template-columns` 各自拼它（抄两遍就会漂），塌缩态覆盖这个变量而不是重抄声明。**今天这一列是空的**，这是设计不是半成品（原话："即使没东西也空在那里"），往里放什么阻塞在拍板 #1/#8。token 三枚新增（`--ht-layout-detail-{width,min-width,max-width}` = 22/18/30rem）+ `--ht-layout-content-max` 的**语义**改成"中间列上限"（值没动），5 份生成产物同步。⚠️ 上下限今天**只是 `clamp()` 的两端，没有拖拽手柄** —— 别以为已经能拖。<br>**判据 3 条**（`e2e/tests/detail-column-slot.spec.ts`，生产构建载体 `vite build` + `vite preview` 端口 4358）：① 右边缘 == 视口右边缘（±1px）**且**中间列不贴边（只断言前者挡不住"两边一起缩进去"）；② 它是 `.ht-app` 的直接子项（几何成立的那条机制）；③ 宽度**等于** token 给的像素值 —— 阈值由 `pxOfCssVar` 从页面现读，不抄 rem→px，且先断言区间非退化。🔴 第一版这里写的是"落在 [min,max] 区间内"，那是**恒真判据**：轨道就是 `clamp(min,width,max)` 算出来的，任何越界值都被夹回区间。换成等值判据才有牙。<br>💥 **变异 5 臂，每臂复原后逐字节比对并复跑回 3 passed**：M1 把列搬回 `.ht-content` ⇒ **2 红**（两条视图各红在右边缘，读数 `904 没贴到 1280`）；M2 两轨那条不走 token 写 `24rem` ⇒ **1 红**（`384 ≠ 352`）；M5 共用的 `--ht-detail-track` 整体不走 token ⇒ **2 红**而窄档那条**仍绿**；M3 摘 769–1023 收起 ⇒ 红在 900 那一句；M4 摘 ≤768 收起 ⇒ 红在 700 那一句、900 仍绿。🔴 **M2 的第一版是存活的（2 passed）**：那时两条用例都停在带侧栏那一面，生效的是四轨声明，**两轨那行零判据** —— "两条都绿"读起来像"宽度判据有牙"，其实是同一行声明量了两遍。第三条用例就是这条存活臂换来的（§8.3 第 4 条）。<br>**门禁 10 道 RC=0**：`check:design` / `check:row-single-source`（`ht-*` 前缀族 **28 = 基线 28，未新增** ⇒ 命名走 `.ht-app__detail` 而不是新起一族，先例 `.ht-content__calendar-host`）/ `check:l4`（web 98≤104、mobile 90=90，**没调基线**）/ `check:layering` / `check:ui-language` / `check:selection-single-source` / token 产物 `--check`（8 文件 204 token）/ design-system 489 tests / `check:server-design`（41 个，布局 token 不上服务端）/ `check:arkts`（真编译器过）。<br>**截图**：新增 3 张（`desktop-with-detail` / `no-sidebar-view` / `back-to-desktop`）+ W1 那 5 张因布局多了 352px 而整体重跑，**八张逐张打开看过**：详情列在两张视图里都是窗口右边那条带发丝分隔边的空白列；选中那条在列表/四象限/时间线/搜索里仍是唯一带浅蓝底的一行。看图另照出一件断言看不见的事：`parkCursor` 第一版落点 `(640,40)` **恰好压在顶栏「同步」按钮上**，那张证据图里那个按钮带着 hover 环 ⇒ 改成按视口算右下角并移进 `helpers.ts`（`0de58095`）。<br>**边界（别读多）**：窄档今天只有**宽度**条件，"看高也看宽 + 收起按钮 + 三条恢复路径 + 持久化"是 W4；这一列里放什么是"详情面本体"那一单（拍板 #1/#8）。⚠️ 未做四端重装，窗口判据同 W1 那行。⚠️ 本 worktree 的 `node_modules` 与 `e2e/node_modules` 是指向主检出的**软链**，而 `.gitignore` 写的是 `node_modules/`（带斜杠只匹配目录）⇒ 它们在 `git status` 里是 `??`，**在这个检出里永远不要 `git add -A`** |
| W3 | 🔄 **进行中**（决定已钉死、三臂各红在指定那一条、两张图人看过；只剩 §6.1.1 四端重装） | **零 CSS 改动** —— 这不是没做，是量出来的结果就是工单取的默认值："设置浮层不盖第四列"（几何上根本不相交），"搜索浮层盖满视口但透出下层"。决定本身分**三种机制**达成，所以判据也必须写成三种：<br>① `.ht-sheet` = `absolute; inset:0` 挂在 `.ht-content` 里 ⇒ 与详情列**盒子不相交**（第四列是 `.ht-app` 的直接子项，在它外面）；② `.ht-search-overlay` = `fixed; inset:0`（2026-10-01 为"一开搜索列表跳回顶部"那个缺陷改的）⇒ **相交**，靠 `--ht-material-scrim` = `rgb(15 23 42 / .32)` 半透明透出；③ 模态层 `.ht-sheet__reconfirm` / `.ht-trash__overlay` 也是 `fixed; inset:0` ⇒ 盖一切，**这是对的，不判**（登记在下面那条枚举里）。<br>🔴 **判据一律写成盒子相交，不写 `toBeVisible()`**：被浮层整个盖住的元素照样 visible（Playwright 的 visible = 有盒子且非 `visibility:hidden`），那条会绿在"详情列已被盖死"的界面上。<br>**判据 2 条**（`e2e/tests/detail-pane-overlay.spec.ts`）：每条都配**正向对照**（设置那条先断"浮层确实盖住了 `.ht-main`"，否则"不盖详情列"在浮层压根没渲染时也成立 = 恒真）；搜索那条同时钉"它盖到详情列"（决定变更要回来改判据并说明理由）与"scrim 的 alpha **在 0 与 1 之间**"（下界不是凑数：alpha=0 等于没有 scrim，"透出"就成了空话），外加列宽仍等于 token、右边缘仍贴视口。<br>**变异三臂**（每臂重新 `vite build` 再跑、复原后逐字节比对、复跑回 2 passed）：N1 `.ht-sheet` 改 `fixed; inset:0` ⇒ 1 红，读数 `sheet 右边缘 1280 vs 详情列左边缘 928`；N2 scrim 的 alpha 改 1 ⇒ 1 红 `alpha=1 不小于 1`；🔴 **N3 打的是防作弊机制自己** —— 把浮层缩成左上角 4rem 小块 ⇒ 红在**正向对照**那句（`连中间列都没盖住…这条就成了空判据`）。三臂里未触碰的那条用例每臂都仍绿。<br>**既有判据继续绿**：`apps/web/tests/settings-sheet-ia.spec.tsx` + `search-overlay-ia.spec.tsx` = **8 passed / 0 failed**（W2 改布局之后重跑的）。<br>**整屏/浮起层的完整枚举**（`grep position: fixed apps/web/src/styles/`，6 处，别再重新推一遍）：整屏非模态 1（`.ht-search-overlay`）、内容区内 1（`.ht-sheet`，是 `absolute`）、模态 2（reconfirm / trash overlay，`fixed; inset:0` + `--ht-z-modal`，**盖一切是对的**）、锚定小面板 3（`.ht-inbox__panel` / `.ht-accountmenu__panel` / `.ht-rail__label`，不参与"盖不盖列"这个问题）。<br>**截图 2 张**（`apps/web/evidence/detail-pane-overlay/{settings-sheet,search-overlay}.png`）**都打开看过**：前者设置面盖住中间列、下层"收集箱"字样淡淡透出、**右侧详情列完全不被染色**（发丝分隔边清楚）；后者整屏被 scrim 压暗，rail / 侧栏 / 详情列一起变灰但仍读得出来，卡片贴顶居中。⚠️ 未做四端重装。 |
| W4 | 🔄 **进行中**（出现条件、收起、三条恢复路径、持久化、判据、十一臂变异、十一张图逐张看过、八道门禁都闭合；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | 载体 `feat/detail-pane` = `dbb3a297`。<br>**落点与裁决**：① 出现条件从"只看宽度"补成**两根轴** —— 高度档按调研 A1 引的 Android 窗口尺寸类取"Compact = 高 < 480dp"（`narrow.css` 新增 `@media (min-width:1024px) and (max-height:479px)`），且**不可行时开关与列一起 `display:none`**（留一颗点不动的按钮 = 界面在说谎）。🔴 第一版把阈值写成 600 并配了一句看起来最有道理的理由，被回读原文否证 —— 全过程与纪律写在 **§8.6**。② 收起态是**设备本地**偏好，不进 op-log（把笔记本的收起状态同步给手机是错的）；词表与读写收在 `apps/web/src/features/shell/detail-pane-pref.ts` 一处，`'open' \| 'collapsed'` 之外的值退回默认、`localStorage` 抛异常时不抛给用户。③ 恢复留**三条各自独立**的路：页头那颗按钮 / 设置里那一项 / ⌘Ctrl+Shift+`\`（选 `\` 不选字母：字母档已被 ⌘K、⌘N 一类占掉）。<br>💥 **本单载体照出一个 W2 就存在、当时没有任何一层在量的缺陷**：`.ht-header__actions` 是 `flex: 0 0 auto`（"不许压窄"），往里加一颗按钮就把最右边顶出视口 —— 1280 宽日历面实测 `scrollWidth 870 > clientWidth 624`，而**症状不是报错，是那颗按钮在 DOM 里点不到**（90s 超时）。两版失败尝试都记在注释里：只在 `.ht-header` 加 `flex-wrap` ⇒ 溢出 922→870 仍在；两处都加 ⇒ **读数一字没变**。卡住的是同一个机制：**不可收缩的 flex 子项，已用宽度 = max-content，它自己那一层的 `flex-wrap` 永远不会触发** ⇒ 三件一起改（`0 1 auto` + `min-inline-size:0` + `wrap`）。既有门 `calendar-cells.spec.ts:107` 从这轮起才真的站在这条修法上。<br>**判据 23 条**：`apps/web/tests/detail-pane-collapse.spec.tsx` 16 条（A 词表模块：默认值/往返/7 个非法值/`getItem` 抛异常仍退默认**且恢复后正向对照读到值**/存储形状；B 页头开关的 aria 方向与"DOM 属性 + 存储"同时变；C 设置项播种后读回、选中的必须是那一只、说明句含"太窄/太矮/快捷键"；D 真 `KeyboardEvent` 四条负对照：缺 shift / 缺修饰键 / 键换成 `x` / 带 alt；E **存储单一所有者**：全树扫 `src` 只许那一个文件碰这个键）+ `e2e/tests/detail-pane-collapse.spec.ts` 7 条（T1 高度边界**两侧都量**、T2 承重那句"收起后 `.ht-main` 右边缘 == 视口右边缘"再叠一次刷新、T3a/b/c 三条恢复路径各走各的（T3c 从真键盘发两次 = 双向）、T4 三种不可行视口里开关与列一起消失且每档都先正向对照"应用渲染出来了"、T5 页头不溢出 + 开关 `toBeInViewport()` + **每只页头控件保住自己的自然宽度**）。<br>💥 **变异 11 臂**：M1 高度那块永不匹配 / M2 479→480 / M3 收起态选择器改名（轨道没归零）/ M4 快捷键键名永不匹配 / M5 `saveDetailPane(value)` → `void value` / M6 M7 从高度块与 769–1023 块里各摘掉 toggle 那一半 / M8 `data-detail` 改名 / M9 去掉词表成员校验 ⇒ **红 9/9**，红集逐臂为 M1–M3 e2e、M4/M5/M8 e2e+web、M6/M7 e2e、M9 web。<br>🔴 **M10、M11 是页头那处修法的两条腿，而 M11 第一趟存活**：M10（动作排改回 `0 0 auto`）红在**两扇门**（本单 T5 + 既有门 calendar-cells 2 红，读数 `870 > 624`）；M11（允许收缩但不折行）**collapse 7 passed + calendar-cells 4 passed —— 全绿**。那一趟它确实该活：不折行时既不溢出、开关也在视口里，三句判据一句都碰不到，而被压扁的是图标按钮 **52→32px**、语言 chip **40→29px**。⇒ 这一行 `flex-wrap` 当时是**一行没人守也没人摘的声明**。处置不是"记成债"，是先量它承不承重：在同一次加载里用 CSSOM 原地切 `flex-wrap` 做 A/B（不重建 dist，逐控件读 `rendered` vs 临时 `width:max-content` 的 `natural`），读数坐实"压扁"之后补了 T5 第三句（**宁可换行，不许把点击区压窄**；阈值不抄常量 —— 抄 44 会既挡不住 32 又误杀 40 那只 chip），**复跑 M11 才红在 `日历面 1280×720：这些页头控件被压扁了`**（1 failed | 6 passed，CSS 逐字节复原 + 干净重建）。教训落在 **§8.7**。<br>**门禁 8 道 RC=0**：`check:design`（无硬编码）/ `check:l4`（web 98≤104、mobile **90 = 基线 90**，没动基线）/ `check:row-single-source`（`ht-*` 族 **28 = 基线 28**，新类名挂进既有族 `.ht-app__detail-toggle`）/ `check:layering`（330 文件 9 规则）/ `check:ui-language`（zh 2855 = en 2855，逐条中英同步）/ `check:selection-single-source` / token 产物 `--check`（8 文件 204 token）/ i18n 26 tests。`apps/web` 全量单测 **1552 passed \| 12 skipped**（112 文件），e2e 详情面整族 **12 passed**、`calendar-cells` **4 passed**。<br>**截图**：新增 6 张（`apps/web/evidence/detail-pane-collapse/{t1-height-boundary-back,t2-collapsed-no-gutter,t2-still-collapsed-after-reload,t3b-settings-option,t4-toggle-gone-when-infeasible,t5-header-with-toggle}.png`）+ W2/W3 那 5 张因页头多一颗按钮而整体重跑，**十一张逐张打开看过**：收起态右边**没有那道 22rem 死空白**（内容铺到窗口右边缘）、479 高那一档开关与列一起没了、设置里"常驻/收起"两只单选跟着说明句一起出现。看图另照出两件断言看不见的事：① `t2-collapsed-no-gutter` 与 `t2-still-collapsed-after-reload` **md5 逐字节相同** —— 刷新前后长得一样正是"持久化生效"该有的样子，但这也说明这两张里只有前一张在证"渲染"、后一张只证"没被重置"；② **1024 那一档页头要吃三行**（实测 182px 高，占 720 视口的 25%）—— 不溢出、点得到，但"详情列在 1024 就常驻"这个档选得是不是太早，登记给拍板 #1（它决定这一栏里放什么，也就决定它值不值 352px）。<br>**边界（别读多）**：dp→CSS px 取 1:1 是**刻意的近似**（浏览器没有 dp）；`data-detail` 只表达**用户选择**，不表达几何可行性（两件事分两层，混起来就会出现"用户没关而它没了"）；未做四端重装；⚠️ 本 worktree 的 `node_modules` 与 `e2e/node_modules` 是指向主检出的**软链**且 `.gitignore` 写的是 `node_modules/`（带斜杠只匹配目录）⇒ `git status` 里是 `??`，**在这个检出里永远不要 `git add -A`** |

| W5 | 🔄 **进行中**（代码链、三层判据、六臂变异、三张图逐张看过、十七道 RC=0 都闭合；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | 载体 `feat/detail-pane` = `84d5bd86`（15 文件 / +705）。**这一单真正搬走的是"颜色"那半边判断，不是新加一个控件。** 之前 `priorityColorToken` 在 `apps/web/src/features/tasks/priority-display.ts` 与 `apps/mobile/src/lib/priority.ts` 各有一份**逐字相同**的实现，两份的文件头都写着"`packages/ui` 依赖不了 `@heyta/i18n` ⇒ 共享不了" —— **那句话只对文案那半边成立**：档位 → 色 token 名只需要 `Priority`（`@heyta/domain`，`packages/ui` 早就依赖）。于是"复选框描边即优先级"（调研 A2 那条"最值得抄"）一直没人能落地，因为**行组件够不到那份映射**。现在唯一所有者在 `packages/ui/src/task-list/priority-color.ts`，`TaskRow` 用 `row.source.priority` 查它给 `box` 上色，两份镜像**删掉**（AGENTS §3.5：抽取的收尾是删旧那份 + 加门禁，不是再写一份更好的）。<br>🔴 **预期差在哪**（这条改了视觉，所以判据里不许出现"改前后逐字节相同"那类零视觉断言）：高 `color.border-strong`(slate-300) → **`color.priority-high`**(light #dc2626 / dark #f87171)、中 → `priority-medium`(#b45309 / #fbbf24)、低 → `priority-low`(#0284c7 / #38bdf8)、**无优先级/字段缺失** → `priority-none`(#94a3b8 / #64748b，比原来那圈略深，仍是中性灰)、**已完成不变**（主色实心 + 主色描边 + 白勾）。<br>**判据 15 条，分三层**：① `packages/ui/tests/task-row-priority.spec.ts` **11 条** —— 映射穷尽（含 `undefined` 与 `None` 同值、档位清单从 `Priority` 现取不抄字面量）、四个 token 名在 light/dark 两张表里**真的存在**、三档取值两两不同 × 两个主题、`none` 不与任何一档撞色、dark 与 light 四枚全不同值（"暗色实际切了看"的数据层证据）、源码级（`TaskRow` 必须 `priorityColorToken(row.source.priority)` 且 `styles.box` 里**不许**再有 `color.border-strong`）、逐行色排在 `box` 之后 `boxDone` 之前、**全仓只有一份定义**（遍历 `apps/`+`packages/` 源码，跳过 `node_modules`/`dist`/`dist-types`；刻意不用点名清单 —— 点名挡不住"在第四个文件里再写一份"）；② `apps/web/tests/row-meta-shared.spec.tsx` 的 A 组换了一条**行元信息画的是共享映射的取值、而且不串档**（jsdom 里 `cssColor()` 探针把 token 取值过一遍这台 jsdom 自己的序列化，不拿 hex 去 `toContain`），D 组那条"两边 token 名一致"**原地改写成新不变量**（原来那句在抽取后**不可能失败**，留着就是装饰）：宿主里不许再有 `color.priority-*` 与 `function priorityColorToken`，三个消费者必须从 `@heyta/ui` 取；③ `e2e/tests/task-priority-checkbox.spec.ts` **3 条**真浏览器 —— 优先级经**真的在捕获框里打 `!1/!2/!3`** 写进去（输入框占位文案就写着「可写『明天』『下周三』『!1』」），每条先断**徽章在场**（那是载体前提，不是产品判据），再断四行描边**各等于该 token 在当前主题下的解析值**（`colorOfCssVar` 页内探针，不抄色值）**且两两不同**，第三条 `data-theme==='dark'` 正对照后同样量一遍。<br>💥 **变异 6 臂，逐臂复原 + 字节比对 + 收尾重建两个 dist**：A1 描边写死回中性色（工单点名的那条）⇒ `ui` + `e2e` 红；A2 `undefined` 改投 High ⇒ `ui` 红；A3 摘掉 `boxDone` 的描边 ⇒ `ui` + `e2e` 红；A4 在 web 宿主里再写一份定义 ⇒ `ui` + `web` 红（两道"抽取收尾"门各抓一次）；A5 逐行色排到 `boxDone` 之后 ⇒ `ui` 红；A6 `High` 指向 `medium` 的 token ⇒ `ui` + `web` + `e2e` 红。**如实记哪层没抓到**：A1/A2/A3/A5 在 `apps/web` 那一趟**是绿的** —— 那一份判据量的是徽章那条通道，勾选框不在它范围内，这不是漏判，是分层；勾选框的渲染层读数只有 `e2e` 那一层有。<br>**门禁与测试 17 项 RC=0**：`check:design` / `check:row-single-source`（`ht-*` 族 **28 = 基线 28**）/ `check:l4`（web 98≤104、mobile **90 = 90**，**没调基线**；`packages/ui` 本来就在 L4 门外，见该脚本第 24 行）/ `check:layering` / `check:ui-language` / `check:selection-single-source` / `check:ui-provider` / `check:rn-aria` / `check:licenses` / `check:docs-voice` / token 生成 + `--check` / 全量测试 **ui 453 · web 1524（12 skipped）· mobile 604 · design-system 489，零失败**；`packages/ui` 改完先 `tsup` 再跑判据（工单 §1 闸门 4）。<br>**截图 3 张**（`apps/web/evidence/task-priority-checkbox/{light-four-tiers,dark-four-tiers,light-done-overrides-priority}.png`）**逐张打开看过**：亮色四行的圈分别是红/琥珀/天蓝/中性灰，且**只有前三行带徽章**（"没有优先级不是信息"那条纪律没被破坏）；暗色同样四色且都读得出来（`#f87171`/`#fbbf24`/`#38bdf8`/`#64748b`）；完成那张是**实心主蓝 + 白勾**，优先级没有盖过"做完了没有"。<br>🔴 **看图照出、断言看不见的一件事**：默认 720 高的那张图里**只有三行** —— 第四行"无优先级"在折叠线下面（AI 面板占了半屏，那是 `enableAllModules` 的结果）。判据量四行而证据图只有三行 = 图与读数不对齐，所以本套件自己 `test.use({ viewport: 1280×1000 })`。<br>**边界（别读多）**：① 描边**不是也不许变成唯一通道** —— 颜色对色觉障碍用户不成立，所以行内那枚**带文字**的徽章必须留着（描边管"扫一眼"，徽章管"读得准"）；删徽章是另一个产品决定，不是这一单的副产品。② 移动端与桌面三壳用的是**同一个** `TaskRow` ⇒ 四端同时受益，但 `apps/mobile/tests/` 里 **0 个用例 render 组件**，所以 RN 侧没有渲染级判据，那一层的证据只有 §6.1.1 的四端重装 + 模拟器截图，**本轮未跑**。③ 未 push 未 merge。 |
| W6 | 🔄 **进行中**（代码链、六层判据、十一臂变异、三张图逐张看过、七道门禁 RC=0 都闭合；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | 载体 `feat/detail-pane` = **`ca2cf606`**（17 文件 / +1101 −24）+ **`577c0f3e`**（判断层那 6 条被我第一笔点名路径漏掉了，单独补了一笔 —— ⚠️ 记下来是为了让后来者别把"提交过了"读成"那一笔就是全部"）。<br>**这一单真正动的是"几格"这个数从数据走到界面再走回数据的那条通道**。`HabitLog.value` 在数据层无处不在（reducer 物化它、`isAchieved` 按它判达成、AI 那侧也能传），唯独**没有任何界面能写出 5**：主按钮一键记满 `target` ⇒ "每天 8 页、今天读 5 页"只能记 8，而界面长得和"做完了"一模一样。<br>💥 **抽取时照出来的两个真缺陷**（不是重构副产物，是先已存在的错）：① "这条记录算几格"有**三份断面**（`isAchieved` 缺省落 `target`、`completionRatio` 缺省落 **0**、移动端详情自己写 `?? target ?? 1`），症状是同一条没写量的记录**同时**"算达成"和"完成度 0%"，两边都不报错 ⇒ 唯一所有者现在是 `packages/domain/src/habit-streak.ts#habitLogValue`，两个领域函数都读它，第三份断面删掉（AGENTS §3.5 的收尾是删旧的，不是再写一份更好的）；② `target: 0`（"一次都不碰"那档）的缺省原来是 **0**，而 `atMost` 按 `value <= target` 判 ⇒ **破戒被记成守戒**，缺省改成 1 并钉成判据。<br>**工单三条判据的读数**：① 目标 8、界面点出 5 ⇒ 落盘 UPD `value=5` 且显示 `今天 5/8 杯`，`page.reload()` 后仍是 5（这条才是"落盘"，不是"状态变了"）；② 不传 value **逐字旧行为** —— 主按钮调用处仍是 `onCheckIn(row.habit.id)` 一个实参，已打卡且没给新值 ⇒ **零 op**（幂等纪律没被削弱，且比较的是 `habitLogValue` 的**有效值**不是原始键：先用 `engine.dispatch` 直接塞一条没写量的 HABIT_LOG，再 `checkIn(id, DAY1, 8)` 必须仍返回 false）；③ 撤销仍走 `OpType.Delete` 而不是记一条 0（「−」减到 ≤0 时改调 `onUndoCheckIn`）。<br>**判据 47 条，分六层**：`packages/domain/tests/habit-amount.spec.ts` **13**（缺省表 + `target∈{1,8}×三种 goalType` 的"两个函数读成同一个数"穷举循环 + 源级不许出现第二个缺省）；`packages/app-host/tests/habit-actions.spec.ts` **+10**（套件 42）；`packages/ui/tests/habits-model.spec.ts` **+6**（36，`todayValue` 四张表 + `hasCountableGoal` 六种合法组合）；`apps/web/tests/habits-board.spec.tsx` **F 组 12**（27，含源码级：主按钮必须单实参、步进必须带 `row.todayValue + 1`、不许用 `Math.round(todayRatio*…)` 反算格数）；`apps/mobile/tests/habits-display.spec.ts` **+3**（18，含与 web 的 `common.habits.amount.*` **键集对等**）；`e2e/tests/habit-counted-amount.spec.ts` **3**（真浏览器，含暗色腿）。<br>💥 **变异 11 臂（W6-M1…M11），红 11/11，每臂复原后逐字节比对 + 收尾重建四个 dist**：M1 摘掉"缺省落 target"（**工单点名的那一条**）⇒ `app-host` 红；M2 同值也发 UPD ⇒ `app-host`；M3 比较键不比较有效值 ⇒ `app-host`；M4 写入侧校验摘掉（0/负数/NaN 静默落盘）⇒ `app-host`；M5 缺省落 1 不落 target ⇒ `domain`+`app-host`+`ui`；M6 `completionRatio` 自己写回 `?? 0` ⇒ `domain`；M7 数量行对所有习惯都出现（默认那条会长出「1/1」）⇒ `ui`+`web`；M8 判据写回 `> 1` ⇒ `ui`+`web`；M9 主按钮开始带值 ⇒ `web`；M10 宿主漏透传第三参（步进器画出来了、点了没反应）⇒ `web`；M11 新词条 zh 变纯占位符 ⇒ `check:ui-language` 那道层红。<br>🔴 **如实记哪层没抓到**：M1 在 `apps/web` 那一趟**是绿的** —— jsdom 层永远传显式 value，缺省那条路只有 `app-host` 与 e2e 真走；M10 只红 `web` 不红 `mobile`，因为 `apps/mobile/tests/` 里 **0 个用例 render 组件**（同 W5 那行登记过的边界）。<br>🔴 **我这把判据自己被照出来的两个洞**（都当场改掉并把原因写进注释）：① `hasCountableGoal` 第一版写成 `target > 1` ⇒ `target: 0.5` 那类小数目标**整行不显示**，被 F5b 那条界面用例抓红（"按钮不存在 ⇒ 点击没反应"会让断言双双假绿，所以 F5b 里加了 `expect(row).not.toBeNull()` 正对照）⇒ 判据改成 `!== 1`，合法域由 `setHabitGoal` 决定（它只拦负数与非有限数）；② e2e T2 第一版写 `toHaveAttribute('aria-disabled','false')` ⇒ 真浏览器红，因为 RNW 在**启用**时根本不写这个属性（缺席 ≠ false）⇒ 改 `not.toHaveAttribute('aria-disabled','true')`；③ 还有一条假红是我自己的：源级判据把 `completionRatio` 的 **docblock** 里引用禁令字面量那句话当成了违规 ⇒ 判据前先剥注释。<br>**截图三张**（`apps/web/evidence/habit-counted-amount/{light-five-of-eight,light-after-undo-and-full,dark-counted-row}.png`）**逐张打开看过**：第一张那行是 `今天 5/8 杯` 且**只有这一条习惯带数量行**（默认那条纯打卡习惯没长出「1/1」）；第二张是减到 0（回到"今天没做"、主按钮重新可读）再一键记满后的 `8/8 杯`；暗色那张字是前景色、`−`/`+` 两个步进按钮各有带习惯名的无障碍名。<br>**门禁七道 RC=0**（回填时刚复跑，2026-10-04 现量）：`check:layering`（329 文件 / 9 规则）· `check:row-single-source`（`ht-*` 族 **28 = 基线 28**）· `check:selection-single-source`（词表 3 类全有消费者）· `check:l4`（web **98 ≤ 104**、mobile **90 = 90**，**两道余量为 0 的棘轮都没调基线**）· `check:ui-language`（zh 2849 / en **2849** 条，中英同步）· `check:design` · token 产物 `--check`（8 文件 204 token，本单**没动 tokens.css**）。<br>⚠️ **提交信息里那句"判据 34 条"是过期读数**（写于 F 组补齐之前），现量是 **47 条 / 六层**，按上面那行拆开对账 —— 以本行为准。<br>**边界（别读多）**：① 步进是**固定 1 格**、加不封顶（记 10/目标 8 就显示 10，比例那条腿仍被 `Math.min(1,…)` 截断 —— 两个字段刻意不等价）；② 单位为空时句子回落到既有 `web.habits.goal.defaultUnit`，没有新造词条；③ `HabitGoalEditor` 提交后不收面板 = **既有行为**，本单没动；④ 真机/模拟器**未跑**（RN 侧无渲染级判据，那一层的证据只有 §6.1.1 的四端重装）；⑤ 未 push 未 merge。 |
| W7 | 🔄 **进行中**（读侧出口、四层判据、十二臂变异、三张图逐张看过、九道门禁 + 六包 typecheck/全量测试 RC=0 都闭合（🔴 **那句"九道门禁"是 9/56，不是全部门禁**：2026-10-04 的全量扫描当场照出第 10 道 `check:empty-state` 红在**本单自己新写的手写空态**上，已修 `edd9971b`，逐项归属与三臂读数见 §8.13）；只剩 AGENTS §6.1.1 的**四端重装**，所以还不算已完成） | 载体 `feat/detail-pane` = **`9bdab17e`**（24 文件 / +1258 −85）。**这一单动的是"记录从来没有被逐条画过"这件事**：`listSessions()` 唯一的消费者只做当日汇总，所以专注页右边一块记录都没有；而"今日专注时长"web 没有、mobile 有 ⇒ 判据 ③ 要的是**同一个出口**，不是两份长得一样的实现。新增 `packages/app-host/src/focus-overview.ts` 一个函数：当日 → `focusStatsForDay`、累计 → `activityTotalsFromState`（与里程碑/分享摘要同一个）、列表 → `listSessions()`（滤墓碑与排序的唯一所有者），界面拿到什么画什么。<br>🔴 **拆掉的两处会繁殖的东西**：① `ActivityTotals` 缺 `focusCount` —— 补上并钉住**段数不能由时长推出**（同样 50 分钟，一段与两段是两个读数），且与 `FocusDayStats.completedWorkCount` 同一条口径（只数 `completed === true`）；② `focus.ts` 里那个返回**写死中文**、零界面消费者的 `formatFocusDuration` 删掉（时长分档唯一所有者是 `durationParts`，词归 i18n）。web 新增 `FocusDetailPane`（四张卡 + 记录列表 + 空态一句话），mobile `FocusScreen` 改读同一个 `focusOverview` 并**删掉自己那份 sessions 状态**。<br>**判据 27 条 / 四层**：`packages/app-host/tests/focus-overview.spec.ts` **11**（真 `OpLogEngine` + `:memory:` SQLite；判据② 写成"条数 == `listSessions()` 里工作段条数"并带 `> 0` 正对照；新到旧、`endedAt` 归属、`actualMs` 退回 `plannedMs`、标题解析/缺失/任务删后仍在/幽灵 id）；`apps/web/tests/focus-detail-pane.spec.tsx` **9**（A 值随出口、B 行数==出口条数 + 空态 + 未关联 + 中途放弃只出现在未完成行、C **挂整个 App** 按可见文本点 rail 进专注面、D 源码级：剥注释后不许出现 `.reduce(` / `focusStatsForDay` / `computeActivityTotals` / `listSessions`）；`packages/domain/tests/motivation.spec.ts` **+1**（`completed` 整个缺失不算一个番茄）；`e2e/tests/focus-detail-pane.spec.ts` **6**（四张卡都在详情列**那一格的矩形内**、`tabular-nums` 取 computed style、空态那句话、与 W4 那颗开关收起/展开的接缝、**F5 真点「开始」→「中止」产出一条真 `FOCUS_SESSION` op ⇒ 界面多一行"中途放弃"而「今日番茄」仍是 0**、日历/习惯/时间线不许借这一格）。<br>💥 **变异 12 臂（W7-M1…M12），红 12/12，每臂复原后 sha256 逐字节比对 + 收尾重建 dist/产物**：M1 摘 `shouldPersistSession` 过滤 ⇒ 1 红（**工单点名的判据②**）；M2 `focusCount = round(focusMs/60000)` ⇒ 3 红（**工单点名的判据①**）；M3 去 `.reverse()` ⇒ 4 红（含"新到旧"）；M4 归属改 `createdAt` ⇒ 4 红；M5 `actualMs` 不退回 `plannedMs` ⇒ 4 红；M6 标题不解析 ⇒ 5 红；M7 `completed` 恒真 ⇒ 3 红；M8 `completed !== false` ⇒ **第一趟存活**（§8.8 第 4 条）；M9 摘掉 `contentView === 'focus'` ⇒ 1 红（C 组"默认那一面是空的"）；M10 界面自己 `reduce` ⇒ 1 红（D 组源码级）；M11 删 `font-variant-numeric` ⇒ 1 红（F2，量的是 computed style 不是源码里那行字）；M12 把 `.ht-rail__tab--active` 改到没人命中 ⇒ 1 红（F1 那条"视觉上高亮的格子必须就是当前视图"）。<br>**门禁九道 + 六包 typecheck + 六包全量测试 RC=0**：`check:design` / `check:l4`（web 98≤104、mobile **90 = 90**，**两道余量为 0 的棘轮都没调基线**）/ `check:row-single-source`（**28 = 28**）/ `check:layering`（331 文件 9 规则）/ `check:ui-language`（zh **2864** = en **2864**，9 条新词条中英同步）/ `check:materialized-reads`（26 屏）/ `check:selection-single-source` / `check:rn-aria` / token 产物 `--check`（8 文件 204 token，本单**没动 tokens.css**）；测试 domain 834 · app-host 1011 · i18n 26 · ui 459 · web 1561（12 skipped）· mobile 607，零失败。<br>🔴 **`check:design` 抓到我两处自拼排版**（xs+regular / sm+regular）：正解不是往 `PAIRED_TYPOGRAPHY_ALLOW` 加两行（那张表"只许删不许加"，加行就是繁殖第二套排版），而是回 `TEXT_STYLES` 找语义档位 —— `sm+regular+normal` 就是 `row-meta`、小标签就是 `caption`；顺手把同块里另外两条"只写字号+行高"的也整条消费掉，避免一个块里两种写法并存。<br>**截图 3 张**（`apps/web/evidence/focus-detail-pane/{f1-four-cards,f3-empty-records,f5-aborted-record}.png`）**逐张打开看过**，md5 各不相同：f5 那一行是 `10/4 04:02 · 0 分钟 / 未关联任务 / 中途放弃`，而四张卡是 `0 / 0 分钟 / 0 / 0 分钟` —— 判据 ① 那两套口径在同一张图里同时成立。<br>**边界（别读多）**：① 时长设置仍是 **web 特有**入口（mobile 用领域默认值），没搬进共享层，理由写在 `FocusTimer.tsx` 文件头那段；② `records` 每次现算不缓存（同步回来的对端记录因此自动进数），**没有为此加缓存**；③ 移动端**没有**记录列表 —— 这一单只要求两端的"今日专注时长"同源，把列表搬到 RN 是另一单；④ 真机/模拟器未跑（§6.1.1 的四端重装留到合并载体）；⑤ 未 push 未 merge；⑥ 🔴 **`check:docs` 现在是红的，两处死链都不在本单**（`PROGRESS.md:1362` → 不存在的 `docs/research/aed-implementation-evidence.md`，来自 `96f3293d`；`countdown-anniversary.md:1280` 引用的那份 ADR 台账里对应章节编号不存在（⚠️ 第一版这里照抄了那条坏引用的字面形状，结果被同一个检查器读成第三条坏链 —— **描述坏链要说形状，不要照抄那串**），来自 `33eea3e5`）—— 两个文件在 HEAD 里都是**干净的**（不是别人在飞的活），但正确的目标只有那两条线自己知道，**不代改、不吸收凑绿**。现量命令：`node research/tools/docs-link-check.mjs`。 |


| W8 | ⏸ 未开工（阻塞于 C1#2 **拍板**，不再阻塞于证据） | 一手对照已落调研 [C1b-Q2](../research/detail-pane-alignment-and-spaced-review.md)（2026-10-03 19:27 到齐）：Loop / Habitica 给了逐行 `file:line`，Streaks / 滴答 / Apple / Google 给了一手文档。**推荐与代价都写好了**，剩的是拍"天 vs 次 / 自然月 vs 滚动 / 日历 vs 韧性"这三个值。🔴 拍板前必读那节末尾的**依赖声明**：凡期望值涉及"一天打 N 次"的，W6 落地前不可达 —— ✅ **这条依赖已解除**（W6 落在 `ca2cf606`：`HabitLog.value` 现在可写、可读、可落盘），所以 W8 现在**只差拍板 #2 那三个值**，证据侧没有欠账 |
| W8a 值与词同源 | ✅ 已完成（2026-10-03，载体 `feat/detail-pane` = `9fc414b5`） | 它是缺陷不是选择，所以从 C1#2 拆出来先做。`resilience.total` = **达成天数**（`habit-resilience.ts:197`），七个键却印成"累计 N 次"（en `{count} check-ins`）⇒ 全改在**句子**侧：zh `web.habits.streak.total{,One}` / `row.aria` / `freshStart` / `mobile.growth.streak.{total,freshStart,a11y}` + en 两条 chip（`Total {count} days`，与同族 `Streak {count} days` 同形）；生产者侧四条**注释**同一个谎（`habit-resilience.ts:74/272`、`HabitBoard.tsx:145`、`HabitStreakList.tsx:6`）一并改；`ui/src/habits/model.ts:89` 那句"`count` 是那天打了几次"与 `:279` 的 `count = done ? 1 : 0` 自相矛盾，按后者改。**判据**：`packages/i18n/tests/habit-total-copy.spec.ts` 4 条。**变异六臂**：A1 row.aria 说回"次"→红 / A2 两条 chip 说回"次"→红 / A3 en 说回 check-ins→红 / A4 把 `累计 {total}` 搬进未登记的键→红（漏登记门）/ A5 把 `{total}` **改名**→红 / C0 负向对照"打卡 N 天"→**仍绿**（认语义不认字面）。🔴 **A5 是这单真正产出的判据**：第一版写 `if (!value.includes('{total}')) continue`，占位符一改那条被**静默跳过**，实测**整套 26 条全绿** —— 即"跟着数据走的循环用 `continue` 做前提校验"这个形状本身就是一个洞。另两条顺手账：`habits-board.spec.tsx` 那条把句子写成字面量 ⇒ 改成"字面量 + 与词条的漂移自检"（第一版自检因两侧空格不同而假红，去空白后再比）；`packages/ui/tests/projects-model.spec.ts` **从 `192a516d` 起就是红的**（那笔提交给 `OrganizerNode` 加了承重的 `archived`，没同步白名单）⇒ 补齐清单、判据强度不变，**归属在别人那笔提交，这里只修断言不动行为**。**读数**：i18n 26 / ui 442 / domain 821 / app-host 990 / mobile 601 / web 1512 passed \| 12 skipped，零失败；九道门禁 rc=0（含余量为 0 的 `check:l4`、`check:row-single-source`，**没调基线**）。⚠️ 未做四端重装（本单只改词条与注释，无产物形态变化；固定收尾留到 W1/W2 那批界面单一起跑） |
| W9 | ⏸ 未开工（阻塞于补打卡窗口决定） | |
| W10 | ⏸ 不在本篇开工（阻塞于 C1#9–12） | |
| W11 | ⏸ 未开工（阻塞于是否重开"不做删除"） | |
| W12 | ⏸ 未开工（阻塞于是否要做正计时） | |

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

不归本单处置 —— 两条改法都住在提醒那条线手上（把触发时刻按点击序号推，例如 `i * 60_000`；
或给这一条装假时钟）。登记在此的理由只有一个：**下一轮看到它红，先别怀疑是详情面这一族弄坏的**。
复现读数：`cd apps/web && NO_COLOR=1 ./node_modules/.bin/vitest run tests/reminders-panel.spec.tsx`（单独跑必绿）。


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
| `check:docs` | `node research/tools/docs-link-check.mjs` | ① `docs/plans/countdown-anniversary.md:1280` → `docs/adr/README.md` 的 §1（该章节号不存在）；② `PROGRESS.md:1362` → `docs/research/aed-implementation-evidence.md` 死链 | 别的线（倒数纪念日 + AED）。现量：`git log main..HEAD -- docs/plans/countdown-anniversary.md PROGRESS.md` **为空**（本分支没动过这两个宿主文件），且死链目标在 merge-base 的 `docs/research` 里 **0 命中**。登记不代改 |
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
| W11 | **改挂**"是否重开不做删除" |
| W12 | **改挂**"是否做正计时" |

🔴 合流时才消得掉的**不归本单**清单（逐条带出处，别读成"本单漏做"）：
① `habit-actions.ts` 的语义冲突（§8.11 合流面现量）；
② `reminders-panel.spec.tsx` 上限用例的负载 flake（§8.12，单独跑必绿）；
③ e2e 那 13 条类型错误分布在另外 6 个 spec（§8 W1b 边界 ③，`include` 因此只圈本单六个文件）；
④ `check:shell-unicode` 在 HEAD 上红（本节第 3 小节）；
⑤ `check:docs` 的两处引用（`countdown-anniversary.md` 的章节号 + `PROGRESS.md` 的 AED 死链，§8.13 表）；
⑥ traps 台账里与本轮三条探针错**撞号**的同名条目（§8.10 的取号纪律：按工作树取号，本单不插行）。

⇒ 工单 §1 四道闸门 + §4 验收动作 + §6 六条不做，在**不依赖拍板的 W0–W8 范围内**逐项有账；
剩下的一步（四端重装）不在本单手里。

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
- **没有截图**：这一趟纯文档与台账编号，无界面产物 —— 按 §6 那六条不做的口径如实写明，不补一张不相干的图充数。

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
