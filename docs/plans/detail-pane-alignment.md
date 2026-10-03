# 详情面对齐与复习面：工单分解

> 状态：**规划中**（2026-10-03 立）
> 🔴 **它是 [`ui-review-fill-zh-timeline.md`](ui-review-fill-zh-timeline.md) 的下游工单，不取代它** —— 那张表里 R1–R16 的历史裁决仍以那份为准；本篇只新增"详情面 / 常驻右栏 / 复习面"这一段。同理**不取代** [`goal-layout-audit.md`](goal-layout-audit.md)（逐页排版判据）、[`calendar-year-time-and-mobile-profile.md`](calendar-year-time-and-mobile-profile.md)（日历与移动端）、[`multi-end-unified-strategy.md`](multi-end-unified-strategy.md)（**唯一权威主计划**，其 §5.2 / §5.3 / §5.4 / §7.1e 是本篇的对账基准）。
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
| **W8 习惯六卡的读侧** | 调研 A5：六个数里**四个连函数都没有**（月打卡天数 / 月完成率 / 月完成量 / 总完成量），且"总打卡"我们口径是"次" | `packages/domain/src/habit-streak.ts`、`habit-resilience.ts`，出口走 `packages/app-host/src/motivation.ts` | 每个数一条单测，期望值来自**手算夹具**（照 `activity-categories` 那套 fixture 纪律）；🔴 **口径由 W-P1 拍板后才写判据**（见 §5） | 未拍板前**不开这单** —— 见 §5 的阻塞映射 |

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
| **3** | 计数型习惯先修 `value` 那一米 | 已拆成 **W6**，不拍也能做（它是缺陷不是选择） | — |
| **8** | 详情面里"无数据的区块"**空即隐藏** 还是 **chip 常驻** | 任务详情面本体 | 两种哲学混用 ⇒ 同一屏两套披露规则，下一单必然撞 |
| **9–12** | 背诵做不做 / 挂谁身上 / 免费付费 / 允许哪些科学宣称 | **W10** | 不动。⚠️ 其中 #12 是**对外话术的合规边界**，不是工程问题 |

🔴 本表**不替产品负责人拍**。W1–W7 与 W0 不依赖任何一拍，可以先跑；拍板只影响 W2/W3 的验收内容与 W8 起的批次。

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
| W1 | 🔄 进行中 | **已落地**：单一所有者收拢完成 —— 新增 `packages/app-host/src/selection.ts`（封闭词表 6 类 + `createSelectionStore` + 纯函数 `pruneMissingSelection` / `pruneSelection`），四份本地 `useState` **全删**（web 任务侧原本没有、web `HabitsView`、mobile `TasksScreen` 的 `detailTaskId`、mobile `HabitsScreen` 的 `selectedId`），两端各只留一份宿主胶水 `apps/{web,mobile}/src/lib/selection.ts`。**判据**：共享层 **16 条**（`packages/app-host/tests/selection.spec.ts`）+ web **12 条**（`apps/web/tests/task-selection.spec.tsx`）+ mobile **9 条**（`apps/mobile/tests/selection-single-owner.spec.ts`）+ 新门禁 `check:selection-single-source`（三条断言，已挂进 `pnpm check` 链）。**变异臂红集**：共享层 7 臂 **7/7 转红**（摘掉"重复选不通知" / 快照不缓存 / 直接迭代 live listener 集合 / 回落判据摘掉 / 无差别清空 / `clear(kind)` 变空操作 / 没变化也通知）；web 4 臂 **4/4 转红**（只接一条渲染路径 / 回落改喂筛后集合 / 点行不写选中 / 光标改第二个来源）；mobile 4 臂 **4/4 转红**；门禁 A/B/B2/C/D 注入各红 + "字样只写进注释"的负向对照绿。🔴 **两条真实读数**：① 第一版 `snapshot()` 每次新建对象，会让宿主的 `useSyncExternalStore` 进死循环 —— 是接线前自查出来的，已改成缓存并钉成判据；② 门禁第一版把 setter 写成必需，注入"只读不写"的选中态时**存活**，补了 B2 臂才有牙。**全量套件**（隔离工作树，载体 `feat/detail-pane` = `9a9920d7`）：app-host 990 passed、mobile 601 passed、web 1512 passed \| 12 skipped，零失败。**未闭合的两件**：ⓐ 截图 + 人看图（行体从"不可点"变"可点"是视觉/交互变化，§4 要求真浏览器取证 —— 本机负载与他人 e2e 占用，未跑；跑法是 `PORT=3100` + 自己的 preview 端口，不用 :3000/:4318）；ⓑ 四端重装（AGENTS §6.1.1 的固定收尾，本轮只在隔离检出里做了 build+typecheck+单测，**没装**） |
| W1b 键盘光标 | ⏸ 未开工 | 原 W1 判据 ③「↑↓ 移动选中」**拆到这一行**，理由不是省事：`TaskList` 的 `activeTaskId` 是**展示槽**，而"往哪走"要有目的地才有意义 —— 详情列（W2）没开之前，回车没有可去的地方。解锁条件：W2 落地后一起做，判据是"↑↓ 改选中 + 详情面跟着换 + Enter 打开焦点" |
| W2 | ⏸ 未开工 | |
| W3 | ⏸ 未开工 | |
| W4 | ⏸ 未开工 | |
| W5 | ⏸ 未开工 | |
| W6 | ⏸ 未开工 | |
| W7 | ⏸ 未开工 | |
| W8 | ⏸ 未开工（阻塞于 C1#2） | |
| W9 | ⏸ 未开工（阻塞于补打卡窗口决定） | |
| W10 | ⏸ 不在本篇开工（阻塞于 C1#9–12） | |
| W11 | ⏸ 未开工（阻塞于是否重开"不做删除"） | |
| W12 | ⏸ 未开工（阻塞于是否要做正计时） | |
