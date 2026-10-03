# 日历（年视图 + 时刻输入侧）与移动端 Profile —— 第八轮（R13–R16）

> 状态：🟢 **四项代码侧全部交付**（2026-10-03 立，同日 04:12 起执行）；🔴 **收尾未闭合**，
> 现场读数、六件未闭合事项与有序下一步全部搬进 [`calendar-profile-handoff.md`](calendar-profile-handoff.md)，
> 本轮判断失败的横向归因在 [`calendar-profile-reflection.md`](calendar-profile-reflection.md)。
> 本篇继续是**唯一的过程账**（判据与变异臂读数只在这里）；交接文档不复述它。
> 触发：产品负责人 2026-10-03 明确"要继续往下推"，并指定**必须先有一份详细计划、按计划实施、按计划随实际情况迭代、且计划里要逐条记录执行情况**。
> 上一轮：[`ui-review-fill-zh-timeline.md`](ui-review-fill-zh-timeline.md)（R9–R12）。本篇接它剩下的四项，**不取代它** —— 日历线的历史裁决（§9.3 档位立场、§9.4 分批、§9.12/§9.13 已交付部分）仍以那份为准。

---

## 0. 这份文档怎么用（防它变成第二份真相）

1. **每批开工前**先把 §2 那张表里对应那一段的"现状事实"补齐并**现量**（带 `file:line`），不许凭上一轮的记忆写。
2. **每批收口时**在 §3 的执行记录表里追加一行，写的是**读数**（多少条判据、变异臂逐支红在哪、门禁 exit 码），不是"已完成"。
3. **计划被现实推翻时**：不删原句，在原句旁边写 ⚠️ 更正 + 为什么 + 现量证据，并登记进 §4 计划变更记录。本仓的账证明过：被删掉的错误判断会以"没人记得为什么不许那样做"的形式回来。
4. 🔴 **凡是"做不了/不闭合"的，一律写成"在谁手里 + 一条可复跑命令"**（§5）。不许出现"以后再说"这种没有主语的登记。

---

## 1. 全程硬约束（每一步都受它管，不是脚注）

| 约束 | 为什么（不是偏好，是踩过的账） |
|---|---|
| 不 `git add` / `git commit` / `git stash` | 共享工作树里有另一条会话的在飞改动（2026-10-03 现量：`packages/op-log` 的 `engine.ts` / `state.ts` / `tests/engine.spec.ts` 为 `M`，`tests/semantic-invariants.spec.ts` 未跟踪，diff 规模 145+/93-）。裸 `commit` 提交的是**整个索引** |
| 不代改、不吸收别人在飞的文件；别人 WIP 造成的红只登记 + 给现量命令 | `apps/web` 的 `tests/trash.spec.tsx` 那条红就是这么来的（机制证据在 R11 台账 §9.13 验证台账第 2 条）。为它改判据 = 把别人的半成品焊进仓库 |
| 不新增第三方依赖，除非过 AGENTS §3.1 可维护性 + §3.2 许可证两道门并**逐项登记** | 门禁 `node research/tools/license-inventory.mjs` 扫的是实际安装树，且已验证能失败 |
| 不 bump `CURRENT_SCHEMA_VERSION`、不改已应用迁移；新增持久化字段一律可选 + 运行时默认 | 磁盘与服务端库里已经写进去的数据会长期存在；TypeScript 只保护新数据，构建会绿、炸在运行时 |
| 界面文案一律走 `packages/i18n`，中英同步，改完必须 `pnpm --filter @heyta/i18n build` | §7 #79：不重建则门禁读的是旧 dist |
| 组件内不许裸 hex/px/ms；跨端规则（游标、文案、判断）一律进 `packages/*` | `check:design` + `check:layering`；AGENTS §3.5"同形状的第二次就是漂移的开始" |
| 验收不抢前台；e2e 前**现量** `lsof -ti tcp:4318 -sTCP:LISTEN` 与 `4319` 为空；**不跑** `check:ai-e2e` / 全量 `pnpm check` / `pnpm reinstall:all` | 那些前置脚本会 `SIGKILL` 端口占有者的 dev server（§7 #87） |
| 界面结论只有截图算证据，且**人必须真的打开那张图**；不许拿 jsdom 图冒充移动端证据 | AGENTS §6.2 规定一 + §7 #82 |
| 不发需求表单、不发问句，直接做 | 产品负责人 2026-10-03 睡前原话 |

---

## 2. 四项批次：目标 / 现状事实 / 落点 / 判据 / 变异臂 / 会撞谁

### R13 日历**年视图**（§9.4 批四的另一半）

**她点名的形状**：滴答那张"12 个月缩略"。
**做序理由**：它最便宜（复用月格），而且它是"档位下拉里最后一块假的空白" —— §9.3 那条"不摆点了没反应的菜单项"目前是靠**不画年**来兑现的；画了真的年，这条立场才第一次被测试到"能不能守住"。

| 项 | 内容 |
|---|---|
| 现状事实 | 已现量（不是记忆）：档位类型 `CalendarViewKind = 'month' \| 'week' \| 'day'` 在 `packages/ui/src/calendar/model.ts:150`；月与周共用 `CalendarBoard` 的那一段 `weeks` 映射（`CalendarBoard.tsx:318-321`），日档是 `:353` 的独立分支 —— 所以年档的落点形状与**日档同构**（新分支 + 新板子），而不是把月格参数化。格子数学全在 domain：`monthGrid` `packages/domain/src/date.ts:266`（固定 6×7、周一开头）、`startOfMonth` `:224`、`addMonths` `:236`（带跨月夹紧）。🔴 domain 里**没有** `startOfYear`／`yearGrid`／`monthsOfYear`：三个名字在 `packages/domain/src`+`packages/ui/src`+`apps/*/src` 现量命中 **0 行** ⇒ 年档要新增的只有"年内 12 个月首日序列"这一条数学。可直接复用的两件：`calendarDayTone`（`model.ts:126`，plain／primary／danger／subtle 四档 —— 正是缩略格一个点要的颜色语义）与 `groupTasksByDueDate`（`:413`）。仓内唯一的"年度"视图是**滚动 365 天的热力图**（`packages/ui/src/motivation/ActivityHeatmap.tsx`，53 列×7 行），可借鉴的只有"月份标签只在变化处打"，**不是**网格 |
| 落点 | ① domain 新增 `monthsOfYear(date)`（1 月首日起 12 个 `startOfMonth`，就放在 `monthGrid` 那一节）；② `CalendarViewKind` 加 `'year'`；③ `stepCalendarCursor` 加**显式** `case 'year'` 走 12 个月 —— 🔴 不写就掉进 `default` 按月静默走，那正是 `CalendarToolbar.tsx:87-90` 警告的"切过去了但没换"，而且**没有任何一层会报错**；④ `calendarCursorFor` 年档返回 `date` 本身（与周／日同构：归一化交给网格函数）；⑤ `calendarSelectedForCursor` 年档**不跟**；⑥ 新组件 `packages/ui/src/calendar/CalendarYearBoard.tsx`：12 张缩略月卡，每格一个点（`calendarDayTone`），**不重画**当天标题与当天清单（与日档同一取舍）；⑦ 列数走 `QuadrantBoard.tsx:153-163` 那条**已拍过的**纪律：共享层不猜视口，宿主传 `columns`（web 读 token 判、移动端不传 ⇒ 单列）—— 那里还明写过为什么不能用 `useWindowDimensions`（RNW 0.21 取的是物理屏 1728 而不是视口）|
| 交互裁决 | ✅ 已定：**点某月 = 切到那一月的「月」档**（档位变、游标落进那个月、**选中那天不动**）。理由：年档是总览，总览点下去必须有去处，否则它是一条死胡同（只能 ±1 年）；而"翻去看别的月，不等于改选中的那天"这条已有裁决（`apps/web/src/features/calendar/store.ts:66-76`）在这里照用。🔴 宿主没接这个回调时**月卡整块不可点**（不渲染成按钮）—— 这是 §9.3「不摆点了没反应的菜单项」在年档的落地形状：宁可少一个交互，也不摆一个按下去没反应的格子。实现上复用两条既有规则（`setView('month')` + `setCursor`），**不新增 store 原语** |
| 判据 | 7 条，数字一律从常量推导、句子一律从词条表读，不许抄：① 年档恰好 `MONTHS_IN_YEAR` 张月卡；② 12 张卡的月份名序列**跟着语言走**（期望串从 `packages/i18n` 现读，读不到就响亮失败 —— 照 `e2e/tests/calendar-day.spec.ts` 里 `hoursInDay()` 那条纪律）；③ 点 `›` 之后标题的**年** +1 而月份那一段不变（这条就是 `case 'year'` 的牙：写成按月走的变异必须让它红）；④ 点某月 → 档位真的变成 `month` 且游标落进那个月；⑤ 宿主不接回调时月卡上**没有**按钮角色（守 §9.3）；⑥ 年档不画当天清单／页脚那两块（与日档同一取舍，防"同一屏两份当天的账"）；⑦ 档位列表变成 4 项、顺序是 月／周／日／年，且**没有**第五种 |
| 会撞谁 | 现量到行（改档位数**必须**一起改期望值，否则第一趟就是红的）：`apps/web/tests/calendar-view.spec.tsx:405-421`（用例标题就叫「下拉里只有真的能用的档位」，注释原文写着"**年还不存在**，所以不许出现第四种日历档位" ⇒ 🔴 这条的**注释**比断言更要紧：它记的是立场，年档进来后必须改成"年于 R13 进来 ⇒ 四种，第五种不许"，否则后来者会照着旧注释把年档撤掉）；`calendar-view-family.spec.tsx:146`（`['月','周','日','时间线']`）与 `:171`（模块关掉时 `['月','周','日']`）与 `:159`（`toContain` 的白名单）；`apps/web/tests/calendar-view-tabs.spec.tsx:81,97,98,105,116,125,132,133`（`toHaveLength(3)` + 逐档遍历）；`apps/mobile/tests/calendar-view-entry.spec.ts:70`（`toEqual(['month','week','day'])`，标题原文"不含还不存在的年"）；`e2e/tests/calendar-week.spec.ts:265-279`（档位枚数 + 列表）。⚠️ 顺带一条已存在的死引用：`model.ts:68` 指向 `apps/web/tests/calendar-week-view.spec.tsx`，现量 `ls` = **No such file**（真名 `calendar-view.spec.tsx`）⇒ 本批一并修，它是指向不存在文件的注释，不改就会有人去新建那个文件 |
| 取证 | `e2e/tests/calendar-year.spec.ts` + 截图入 `apps/web/evidence/calendar-year/`，人看图 |

### R14 给任务一个**时刻**的输入侧

**为什么排第二**：R11 批四交付的 24 小时轴，在真实数据下**长期是空的** —— 这不是缺陷（轴上那句说明就是为它写的），但"能看不能填"是整套里唯一一处**界面比数据先行**。而且它有一处现成的欠账可以当场还掉：`e2e/tests/calendar-day.spec.ts` 文件头第 19–25 行明写着"这里播不了带时刻的任务"，所以"带时刻的任务真的挂在自己那一小时"这句话目前**只有 jsdom 读数**。

| 项 | 内容 |
|---|---|
| 现状事实 | 已现量：`dueDate?: number`（epoch ms、**本来就可选**）在 `packages/domain/src/entities.ts:128`。"本地零点"那句约定写在 `packages/domain/src/capture.ts:536-543` 的 TSDoc 里，函数本体 `:544-546` 就是 `parseLocalDate(date).getTime()`。`parseCapture` 在 `capture.ts:430-534`，规则表 `RULES:248-419` 里 14 条 `field:'dueDate'` + 3 组 priority，`CaptureField` 现量只有 `'dueDate' \| 'priority'`（`:47`）—— **没有任何规则认领 `16:00`**，且 `:376-379` 显式拒绝前导 `:`，所以 `明天16:00 X` 的标题留着"16:00"（取证就在 R11 台账 `:2298`）。依赖"零点"假设的读方现量：`isAllDayMs`（`packages/ui/src/timeline/board-model.ts:87-90`，本体是 h/m/s/ms 全为 0）—— 调用点只有 `:102 markerMs`、`:109-111 isOverdue`、`:245 dueText`、`calendar/model.ts:262` 四处；提醒 `reminders.ts:178-182` 是**纯 ms**（`dueDate - offsetMs`），四象限 `quadrant.ts:41-46` 已是 ms 级 ⇒ 这两处**本来就**期待时刻 |
| 落点 | ✅ 已回填（07:49，与开工预判一致）：`packages/domain/src/capture.ts`（规则表 +1 条 `HH:MM`、`parseCapture` 末尾的 `dueTimeNeedsDate` 闸门、`dueDateToEpoch(date, time?)`）· `packages/domain/src/date.ts`（`isAllDayDueMs` / `localTimeOf` / `parseLocalTime` / `timeOfDayMs` —— **"到日还是到分钟"全仓只有这一份判定）· `packages/ui/src/capture/model.ts`（`CaptureChip.dueTime` + `captureChipTimeLabel` + `toCaptureSubmitPlan`）· `packages/ui/src/date-picker/DatePicker.tsx`（时刻栏：草稿与提交分离，没到 `HH:MM` 不提交）· `packages/ui/src/calendar/CalendarDayBoard.tsx`（两条空态各说各的范围 + 时刻列 testID 与列宽）· `apps/web/src/features/tasks/DueEditor.tsx`（时刻栏接线 + 换日子搬运时刻）· 两端 `valueLabel`（`apps/web/.../CaptureComposer.tsx`、`apps/mobile/src/lib/capture-labels.ts`）· 词条 `common.calendar.dayAllDayEmpty`（中英各一份）· `packages/app-host/src/export-dump.ts`（导出不再静默丢时刻）。写入仍走 `createTaskActions` 的既有方法，**没有新 op 形状** |
| 🔴 必须先过的判断 | ① ✅ 已确认：**零新字段**。`dueDate` 已是 epoch ms，"零点／非零点"是同一个数字的两种取值，而仓内**早已有两处写入非零点**（`ticktick-import.ts:393-396` 与 `packages/ui/tests/capture-model.spec.ts:267`）⇒ 不 bump `CURRENT_SCHEMA_VERSION`、不加可选字段都成立，旧数据零点继续落「全天」带。② ✅ 已查完：**没有一张 ADR 否决它**。搜过 `docs/adr/*`（时刻／dueDate／datetime／不做／否决）与 `docs/plans/*`，命中的全是**待决产品问题**：`ai-handoff.md:278-283` 说"「下午三点」无处可放…需要一次产品决策"—— 🔴 它的前提"没有字段能装"已被 ① 推翻；`ui-review-fill-zh-timeline.md:2320` 否掉的是"**必须**先给任务加时刻才能做日视图"，不是"加时刻"本身；反向支持：`ADR-0043:31` 明写 `startDate` 可与"某天"**或时刻**并存。③ ✅ 已定：清除写 **`null`**（既有语义，`actions.ts:550-551` 与判据 `apps/web/tests/due-date-edit.spec.tsx:168`），而"只留日期、把时刻归零"**必须**是共享层的一条具名规则 —— 仓内已有先例说明时刻是**要保留的**：`actions.ts:565-566` `postponeToToday` 用 `dueDate - startOfDay(dueDate)` 主动搬运时分。🔴 真正的代价不是崩，是**有损**：`export-dump.ts:281` 与 `local-api-host.ts:236-244` 的 `YYYY-MM-DD` 口径会静默丢时刻 ⇒ 同批扩 |
| 判据 | 候选清单：设了时刻的任务在日档挂进它自己那一小时（真浏览器，补掉上面那句欠账）· 没设时刻的仍在「全天」带 · `明天16:00 X` 解析出 `dueDate` 带 16:00 且标题不再留着"16:00" · 跨设备读到同一时刻（`dueDate` 是密文 payload，判据要在两端各读一次）· 提醒/时间线/今日视图对这些任务**不因时刻而错位**（回归面） |
| 变异臂 | 每条判据一支，逐支记"红在哪条、断言原文" |
| 会撞谁 | `isAllDayMs` 四个调用点见上（时间线那三处是**期待**时刻的，不会撞红，但判据要重跑）；`packages/domain/tests/capture.spec.ts` 有 **61** 个 `it`（`parseCapture` 的期望值全在这里，改了规则表就要逐条对）；`apps/web/tests/due-date-edit.spec.tsx:209-241` 与 `e2e/tests/due-date-edit.spec.ts:80-97` 那两条浮层判据量的是面板的 `getBoundingClientRect` ⇒ 🔴 **面板里新增一栏会被同一条量到**（`PANEL_HEIGHT_ESTIMATE = 500` 在 `DueEditor.tsx:52` 也要跟着改）；`task-order.ts:75-77` 同日内的排序会因时刻而变（这是**期望的**行为，但要有判据说清）。⚠️ 待现量后补：`e2e/tests/timeline-p2.spec.ts` 是否靠"标题里留着 16:00"当夹具 —— 这条我上一轮写的是"我记得"，**未取证不算事实**，开工 R14 前先 `grep -n "16:00" e2e/tests/*.ts`。**06:17 现量结果**（原句留着，因为它记录的是一条该守的纪律）：`timeline-p2.spec.ts:47-48` **确实**用 `'明天16:00 写时间线的验收报告'` / `'后天12:00 整理 P2 的判据清单'` 当夹具，但它**不断言标题文字** —— 全篇只数 `timeline-point-*` / `timeline-bar-*` / `timeline-row-*` 的个数 ⇒ R14 不会把它打红，只会让它**语义变了**（那两条任务从"标题里留着 16:00"变成"真的挂在 16:00"）。另外两处**注释会变成假话**，改完 `parseCapture` 必须同步改写：`e2e/tests/calendar-day.spec.ts:19-20`、`e2e/tests/calendar-view-family.spec.ts:43-44`（两处都写着"实测 `明天16:00 X` 的标题是「16:00 X」"）。 |
| R14c 移动端输入侧（**2026-10-03 19:1x 现量开工登记**） | 🔴 先记一条本台账之前的**假完整性**：R14 那行收口写着「DatePicker 时刻栏」已落地、读数全绿，但**移动端没有时刻的入口**。现量：`grep -rn "dueTime" apps/mobile/src` = **0 行**，`grep -c "time=" apps/mobile/src/screens/TaskDetailSheet.tsx` = **0**，而 `packages/ui/src/date-picker/DatePicker.tsx:72-73` 自己写着「整个 prop 可选 —— 不传就一个节点都不画，所以现有消费者（移动端任务详情）渲染出来的东西与改动前逐字节相同」。⇒ R14 交付的是**共享层的能力 + web 的接线**，移动端那一半一直没人接 ——「唯一判定在共享层」不等于「每个宿主都用上了它」。**落点四处**：① `TaskDetailSheet.tsx:687`（截止那张 `DatePicker`；`:730` 那张是**排期起点**，它要不要时刻是另一个产品判断，本批不动）传 `time={{ value, enabled, labels, onChange }}`，`onChange` 复用既有那条 `actions.setDueDate(task.id, dueDateToEpoch(dueLocal, next))` ⇒ **零新 op 形状、零新字段**；② 同文件把 `onChange` 里现算的那次 `localTimeOf(task.dueDate)` 换成上面同一个 `timeValue`（一次渲染里「这条有没有时刻」只许读一处）；③ `apps/mobile/src/lib/date-picker-labels.ts` 新增 `datePickerTimeLabels(t, title)`，与 `datePickerLabels` 同文件同纪律（措辞只在注入处）；④ 🔴 **词条改名、不新写**：`web.due.{timeLabel,allDay,timePlaceholder,timeAria}` 四键 → `common.due.*`。理由与 R15a 的 `common.profile.*` 完全同一：新写一份 `mobile.due.*` 就是第 2 份抄件，而「全天」必须与时间线那条带同源（`zh-CN.ts:1318` 的注释早就写着这句）。现量消费者**只有** `apps/web/src/features/tasks/DueEditor.tsx:205-208` 四行 ⇒ 改名比抄一份便宜。本会话 R15a 那条判据（`apps/mobile/tests/profile-nickname-entry.spec.ts`：移动端不许读 `web.*` 命名空间的键）与这条一致，不冲突 |
| R14c 会撞谁（现量） | ① `apps/mobile/tests/**` 是**源码级**通道（node 环境，无 RTL / 无 jsdom —— 理由原文在 `profile-nickname-entry.spec.ts` 文件头），所以本批钉的是「接的是共享那一处、判定只有一份、文案全走 i18n」，行为本身归设备脚本（`verify:mobile-edit` 那一族，已在 §5 第 1 条外部阻塞里）。② 🔴 `check:l4` 的 mobile 段基线**零余量**（R15a 现量过：90 恰在 90）⇒ 新增 JSX 里**一个 `style={{` 都不许出现**；时刻栏整块住在共享层，移动端只传一个对象，天然为零。③ 撞车面澄清（别读成「在别人正改的文件里下手」）：`packages/i18n/src/locales/{zh-CN,en}.ts`、`apps/web/src/features/tasks/DueEditor.tsx`、`apps/mobile/src/screens/TaskDetailSheet.tsx`、`packages/ui/src/date-picker/DatePicker.tsx` 的未提交 diff **是本会话自己的**（R14 / R15b 那几笔；现量 `git diff --stat`：DueEditor 56+/10-、TaskDetailSheet 23+/1-）⇒ 接着自己的改动往下写，不是覆盖别人的 WIP。④ 改名要同时重跑的消费面：`apps/web/tests/due-date-edit.spec.tsx`、`e2e/tests/due-date-edit.spec.ts`、`e2e/tests/calendar-day-en.spec.ts`（期望串从表里现读、不写字面量 ⇒ 键名变了它自己跟着变）。⑤ 边界一条：`common.due.allDay` 与既有的 `common.calendar.dayAllDay` **值同键异**（两块面各自的标签）。不并键 —— 键名说的是「哪块面的标签」，并了会让日历去读任务编辑器的键。改成配一条**等值判据**：两份表里这两键在 zh 与 en 下必须逐字相同，漂移即红 |
| R14c 判据 + 变异臂 | 判据（源码级，与 R15a 同形状，每条负向都配正向对照）：**T1** 截止那张 `DatePicker` 传了 `time=`，且 `enabled` 读的是「有没有日子」而不是别的；**T2** `onChange` 走的是 `dueDateToEpoch(日子, 时刻)` 这一条共享数学，移动端**没有**自己写 `getHours()` / `setHours()`；**T3** 时刻标签四句全部来自词条表（`common.due.*`），源码里**零**硬编码文案；**T4** 一次渲染里「这条有没有时刻」只读一处（`timeValue`），`onChange` 里不出现第二次 `localTimeOf`；**T5** 中英两份表都有这四键、且 `common.due.allDay == common.calendar.dayAllDay`（zh 与 en 各比一次）。变异臂：**M1** 不传 `time=` ⇒ T1 红；**M2** `enabled` 改成恒 `true` ⇒ T1 红；**M3** `onChange` 换成 `setHours(...)` 形状 ⇒ T2 红；**M4** `timeLabel` 写成裸中文 ⇒ T3 与 `check:ui-language` 红；**M5** 在 `onChange` 里再算一次 `localTimeOf` ⇒ T4 红；**M6** 只改 zh 表里那一句「全天」让两键漂 ⇒ T5 红。逐支读数写在下面 §3 |

### R15 移动端 **Profile**（昵称 + 头像）

**为什么排第三**：R10 的 web 端已交付，移动端是台账 §8 明写的"剩下的那半"。它排在年视图与时刻之后，是因为**它可能卡在一道依赖门上**（见下面第 3 行）—— 卡住的部分要尽早暴露，而不是排在第一个才发现做不完。

| 项 | 内容 |
|---|---|
| 现状事实 | 已现量：`ProfileScreen.tsx` 有账号卡 `:446-473`、同步状态卡 `:480-515`、入口行 `:521-525`、清单／标签／便签三段 `:529-531`，**零资料字段**。web 那套全部走 `packages/app-host/src/hosted-auth.ts`：`getAccountProfile:1042`／`updateAccountDisplayName:1063-1069`（**明文列**）／`uploadAccountAvatar:1092-1098`（先 `encodeAvatarCipher:982-985` 把 `{contentType,dataBase64}` 整体加密）／`fetchAccountAvatar:1139-1145`／`deleteAccountAvatar:1155`。🔴 这条链**不是 op、不进 op-log**：它是专用 HTTP 路由，密文 blob 落在服务端 Postgres 的 `model UserAvatar`（`server/prisma/schema.prisma:909-926`，`cipher Bytes`）—— 所以移动端做这件事**零领域改动、零 schema 风险**，函数已全部在 app-host 里 |
| 🔴 先要判的一件事 | **移动端怎么拿到一张图**。⚠️ 原判断已被现量否证，原句留在这里：~~`apps/mobile` 没有 image/document picker，这件事卡在一道待裁决的依赖门~~。**现量**：`apps/mobile/package.json:31` 就有 `"@react-native-documents/picker": "12.0.2"`，而且 `apps/mobile/src/screens/ExportScreen.tsx:67` 已经在用（`import { keepLocalCopy, pick }`），`:224` 注释原文"批五依赖裁决" ⇒ **那道门已经在另一条线上过完了**（MIT、已装、已在生产代码里）。所以 R15b 卡的**不是依赖**，是三件具体的事：① 字节通道 —— `apps/mobile/android/app/src/main/java/com/heytamobile/fs/LocalFsModule.kt:49` 把 `out.toByteArray()` 用 `Charsets.UTF_8` 强转字符串，**对图片是损坏**（文本备份才刚好能用），要加一条 `readBase64Uri`；② iOS 侧没有对应原生模块（现况走 XHR-blob 兜底且**未实测**）；③ 全仓 mobile 源码**零** RN `Image` 组件（搜 `\bImage\b` 只命中 locale.ts 的一句注释）⇒ 连"把头像画出来"都要新写 |
| 因此的拆法 | **R15a 昵称**：零新能力（文本输入 + app-host 既有端口 + 跨设备读回），本批做完。<br>**R15b 头像**：阻塞条件按上面三件事重写 —— 🔴 它不是"等裁决"，是"等一次原生改动 + 一次 iOS 实测"。⚠️ 另有一条**尚未取证**的开放问题（不许当事实用）：documents picker 在 iOS 上能不能真的选到**相册里的照片**（`src/fileTypes.ts:11,29` 证明它**声明了** image 类型过滤：Android `image/*` / iOS `public.image`，但 iOS 的文档选择器默认 browse 的是"文件"而不一定是照片库）。定它的命令：`grep -rn "PHPickerViewController\|UIDocumentPickerViewController" <picker 包>/ios`；若只有后者，那"从相册选头像"在 iOS 上就是**另一个能力缺口**，要按 §5 单独立一条 |
| 判据 | R15a 候选：改昵称 → 落库 → 另一台设备读到（`verify:mobile-*` 那条形状）· 昵称清空写的是"清除"语义不是空串 · 界面文案全走 i18n · 暗色实际切过 |
| 取证 | 真机/模拟器截图（浅色 + 深色）。⚠️ 前置条件：`pnpm -r build` 必须绿（当前被 `packages/op-log` 在飞红挡着，见 §5 第 1 条） |
| R15a 落点（实施时现量，2026-10-03 08:2x） | ① **共享层新接缝**：`planDisplayNameWrite` 落 `packages/app-host/src/hosted-auth.ts`（"发不发 / 发 null 还是发值"这一判定原本**只活在** `apps/web/.../ProfilePanel.tsx:190-203`，移动端要复用就必须搬出来 —— AGENTS §3.5 的正面执行）；② 🔴 **词条命名空间**：`web.settings.profile.*`（19 个键）**改名** `common.profile.*`。第一版打算新写一份 `mobile.profile.nickname.*`，现量后否证：那是**第 5 份抄件**，而这 19 个键的消费者只有 1 个文件（`ProfilePanel.tsx`，24 处），改名比抄一份便宜得多；`common.` 是表里既有前缀（168 键），不是新造的词表；③ **同批修掉一个真缺陷**：`saveNickname` 的失败分支复用了 `avatar.failed` ⇒ 昵称没存上时界面说"头像没有传上去"（见 §4 08:3x 行）；④ kit `TextField` 加 `onSubmitEditing` / `testID` 两个**默认无值的可选 prop**（`apps/mobile/src/ui/kit.tsx` 不在 l4 扫描范围内，且默认值等于原行为 ⇒ 其余调用点零改动。现量：`grep -rn "<TextField" apps/mobile/src \| wc -l` = **18**，其中本批新增 1 处） |
| R15a 会撞谁（现量） | 🔴 **`check:l4` 的 mobile 段 90 恰在基线 90、零余量** ⇒ 昵称那一块必须**一个 `style={{ }}` 都不出现**：行走共享 `SettingsRow`（`kind:'value'` + `onPress`），输入框/按钮走 kit，说明行走 `<Text variant="caption">`。其余撞点：`packages/i18n` 两份表正在被并行会话（便签 `NoteEditor`）同时改；`apps/web` 全量跑时 `packages/op-log` 的在飞改动会影响时序（见下面 §5 第 1 条与 §6 第 4 条）|
| R15b 落点（实施时现量，2026-10-03 09:3x） | ① **共享层三条新接缝**：`packages/shared-schema` 里加 `base64DecodedBytes` / `isAvatarContentType` / `avatarOutputContentType` / `planAvatarUpload`（字节量法 + "这张图能不能当头像"的唯一裁决）、`avatarInitialFromEmail` / `avatarDataUri`（头像在界面上的两个字节形状）；`packages/app-host` 里加 **`resolveAccountAvatarImage`**（"这台设备现在该显示什么"的唯一裁决，五枚状态）。② **Android 原生二进制通道**：`LocalFsModule.kt` 新增 `prepareAvatarBase64(uri, edgePx, format)` —— `openInputStream` → `BitmapFactory.decodeStream` → 短边居中裁 → `createScaledBitmap(512)` → `compress(PNG 无损 / JPEG 86)` → `Base64.NO_WRAP`。**不能复用 `readTextUri`**：它按 `Charsets.UTF_8` 强转，对图片字节是**有损**的，结局是"上传成功而服务端解不开"。③ **mobile 平台层**：`src/lib/avatar-prepare.ts`（与 web 的 `avatar-encode.ts` 同位）+ `src/ui/avatar.tsx`（🔴 全 mobile 第一个 RN `<Image>`；它落在 `ui/` 是因为 `check:l4` 只扫 `screens/` —— 现量：`scripts/check-l4-no-style.mjs:37` 把 `apps/mobile/src/ui/**` 豁免）。屏幕那侧新增 `style={{` 行数 **0**。④ 🔴 **同批查出并修掉 web 三处"界面在讲另一件事"**：(a) `GET profile` 失败时把 `avatar.failed` 写进**昵称**那句（→ 新键 `common.profile.loadFailed` + 独立一行 `profile-load-notice`）；(b) **上传成功**复用 `nickname.saved`（→ 新键 `common.profile.avatar.uploaded`）；(c) 最贵的一处：`decoded.ok ? dataUri : undefined` 把**五种解码失败并成一个"没有头像"** ⇒ 口令不对的人被告知"你还没有头像"，他接着点「换一张」就**把自己原来那张覆盖掉**，而服务端全程只回 2xx、没有任何一层会报错（→ 五枚状态各一句）。⑤ **首字母从两份并成一份**：`AccountMenu.tsx` 原来是 `local.trim().charAt(0)`（emoji 邮箱会取出孤立半代理 `\ud83d`，屏幕上是一个方块），`ProfilePanel.tsx` 是另一套且返回空串 —— 两处现在都读 `avatarInitialFromEmail` |
| R15b 会撞谁（现量） | ① **iOS 没有对应原生模块** ⇒ "没有通道"必须是**单独一句**（`mobile.profile.avatar.noChannel`）：折叠成 `undecryptable` 会让界面说"这张图解不开"，而真相是这台设备暂时读不了本机图片 —— 后者用户还能等版本，前者只会让他反复换照片。② 🔴 **`packages/ui/dist` 此刻没有 `index.d.ts`**（并行会话 17:21 重建产物时 dts 段没出文件；同时 `packages/ui/src/projects/model.ts:118` 的 `archivedProjects` 也还没进 dist）⇒ `--filter @heyta/mobile typecheck` 现量 **209 error**，全部由那一条 `TS7016 Could not find a declaration file for module '@heyta/ui'` 级联，本批三个新/改文件除那一行 import 外**零错误**；`apps/web/tests/account-profile-entry.spec.tsx` 三条红是 `ProjectsPanel.tsx:125` 的 `TypeError: archivedProjects is not a function`，**归属已在 `docs/plans/trash-and-archive.md:660-663` 写明**。不代改、不替他重建 dist（那会把他的 WIP 打进产物）。⚠️ **本条已在 17:46 被并行会话自己的一次重建解除**（现量：`packages/ui/dist/index.d.ts` 存在、mtime 17:46，`grep -c archivedProjects packages/ui/dist/index.js` = **2**；`mobile typecheck` **rc=0**（那 209 条整片消失）、`shared-schema`/`app-host`/`web` 三段 **rc=0**、web 全量 **0 failed**）。**原句留在这里正是为了让下一位看见它的保质期只有 20 分钟** —— 这类"被别人在飞的产物挡着"的登记项，收尾时必须重量一次，不能把 20 分钟前的读数当现状（§4 里 09:5x 那一行）。③ 微行为变更一处（要如实写明）：emoji 邮箱的首字母从半代理变成完整码点 ⇒ `AccountMenu` 那圈里显示的字符会变，这是**修**而不是回归，判据是 shared-schema 那条码点用例 |

### R16 日档**英文界面**的真浏览器取证

**为什么还要做**：§9.12 登记的边界 3 —— `check:ui-language` 只保证中英**键集对等**，而日档那句说明在英文下**明显更长**（`Nothing on this day has a specific time — they are all in the "All day" band above.`），换行与挤压没验过。这是"键集对等 ≠ 被覆盖"那一类。

| 项 | 内容 |
|---|---|
| 落点 | `e2e/tests/calendar-day.spec.ts` 加一条 `/?lang=en` 用例（现量：`APP_ZH = '/?lang=zh-CN'` 就在这个文件第 33 行，同一条 helper `openApp(page, path)` 直接可用） |
| 🔴 落点·实测更正 | ⚠️ **上面那格是坏的**（18:3x 逐条读了 `e2e/tests/helpers.ts` 才撞出来的）。`openApp` 第 289 行调 `pinChineseUi(page)` ⇒ 一条 init script 往 `localStorage` 写 `heyta.locale='zh-CN'`，而那是解析链**第 1 层**，胜过 `?lang=`（第 2 层）—— 所以「同一条 helper 直接可用」这句不成立：真要用它，界面会是**中文**，判据测的不是英文。更响的是它下一行：`openApp` 用 `input[placeholder^="添加任务"]` 当「应用起来了」的锚 —— 拿中文句子当锚，在英文会话里**当场红在 helper 里**，红的是探针不是产品。仓库里已有先例：`language-first-launch.spec.ts` 就**不走** `openApp`（它自己的注释写明理由）。✅ 实际落点改成两处：① 新建 `e2e/tests/calendar-day-en.spec.ts`（自带 `openAppEnglish()` —— 复用中立件 `enableAllModules` / `installMissingProducerShims` / `decidePrivacyConsent`，只把 `pinChineseUi` 换成不钉，锚点用 testID `language-option-en`，再断言 `<html lang>="en"` 确认是**应用自己**按解析结果写的那一行）；② 🔴 等端口期间发现「那三句英文逐字来自词条表」这件事**不需要浏览器**，另在 `apps/web/tests/calendar-day-view.spec.tsx` 加了一条 jsdom 英文会话腿（见 §3 R16 行）—— 浏览器那一半只剩「几何/换行没被截断」，而那正是 §9.12 边界 3 里唯一还开着的部分 |
| 判据 | 英文下：「全天」带标题、那句说明、`All day` 与小时刻度都在 DOM 上且**读得出**（不是截断）；控制台零报错；截图入 `apps/web/evidence/calendar-day/`（同一目录，README 补一行"这张是 en"） |
| 🔴 判据强度 | 期望串**从词条表读**（照这个文件里 `hoursInDay()` 那条"不抄数字、从源码读、读不到就响亮失败"的既有纪律），不在测试里手抄英文句子 —— 手抄的抄件一定会漂 |
| 变异臂 | 把 `dayNoTimed` 的英文值改掉一个词 ⇒ 那条必须红（证明它比的是真词条而不是"有没有文字"） |
| 🔴 变异臂·实测更正 | ⚠️ **这支臂结构上没有牙齿**：判据的期望串与界面读的是**同一本表**（这正是上一格刻意要的"不抄句子"），改表 ⇒ 两边一起变 ⇒ **永远不会红**。它能证的只有"测试没抄句子"，而那件事由 code review 就能看，不需要一条变异臂。真正的牙齿在**消费侧**：组件写死中文字面量 / 换错词条键。已按这个换成 E1–E3 三支并逐支跑出读数，见 §3 下面「R16 的三支变异臂」那节（E2 是关键那支：改成与 zh 表逐字相同的**中文字面量** ⇒ **只有英文那条腿红，中文腿全绿**）。原句留在这里不删，为的是让后来者看清"期望从表读"与"变异改表"这两条纪律放一起时，后者会自己失效 |
| R17（收口后追加的一批） | 把「哪些档位存在 + 每档叫什么」收成**共享层一份**（§6 第 7 行那条边界）。为什么现在做：goal 第①项的立场是「下拉里只有真的能用的档位」，而这张表现在有**两份** —— web 的 `CalendarHeaderToolbar.tsx:50`（`{kind,key}[]`）与 mobile 的 `CalendarScreen.tsx:75`（`CalendarViewKind[]`）加 `:293` 的 `viewLabels.name` 那张 档位→键 表；R13 加年档时**两边都靠人记着改**。立场由两份抄件共同承重，正是本仓反复登记过的那一类。⚠️ 这一批不是新界面功能，是把第①项的接缝搬到 AGENTS §3.5 要求的位置 |
| 形状（两条轴分开，各自带守卫） | `packages/ui/src/calendar/model.ts` 加 ① `CALENDAR_VIEW_LABEL_KEYS: Record<CalendarViewKind, CalendarViewLabelKey>` —— **`Record` 本身就是守卫**：往 `CalendarViewKind` 添一档而不给它键名 ⇒ 两端**编译不过**（这是 mobile 作者在 `:297-301` 注释里刻意换来的形状，搬到共享层后两端同时拿到）；② `CALENDAR_VIEW_ORDER: readonly CalendarViewKind[]` —— 下拉与切换器里的**顺序**，「由细到粗、年在日之后」那条理由从 web 搬来说一次。🔴 共享的仍是**关名，不是文案值**：共享层不 import `@heyta/i18n`（会拖进第二份 React），所以值仍然只在 `packages/i18n` 那一本表里 |
| 会撞谁 | ① 我自己这两处未提交改动里就含着这两张表（web 24 行 / mobile 156 行那批）⇒ 不与并行会话相撞；② 判据三处：`apps/web/tests/calendar-view-tabs.spec.tsx`、`apps/mobile/tests/calendar-view-entry.spec.ts`、`packages/ui/tests/calendar-view-step.spec.ts`；③ `check:l4` —— 本批**只删常量、不碰样式**，所以做完要现量它的读数与改前一致（不能只声称）；④ 改了 `packages/ui` 源码 ⇒ 判据读的是 `dist`，**必须 build 之后再跑**（§7 第 27 条那一族；本轮那枚刷新崩溃就是同一形状） |
| 判据（写之前先答「这在什么别的情况下也会成立」） | ① 集合一致：`CALENDAR_VIEW_ORDER` 去重之后 == `Object.keys(CALENDAR_VIEW_LABEL_KEYS)`，且顺序里无重复 —— 从共享表**自己推导**，不在测试里写死四档字面量（写了就是第三份抄件）；② 「真的能用」的词条腿：表里每个键在 **zh 与 en 两本表里都取得到值**，且两语的值**不相同**（不相同才证明英文不是抄中文，与 §7 那条双语两层判据同形）；③ 🔴 反抄件腿（本批真正的产出）：**两份宿主源码里档位键字面量必须 0 命中** —— 谁再在宿主里补一张本地表，这条当场红 |
| 变异臂（**六支全部跑过**，逐支读数在 §3 末「R17 的六支变异臂」） | V1 从 `CALENDAR_VIEW_ORDER` 删 `year` ⇒ 🔴 红在集合一致那条腿；V2 把 mobile 那张本地表加回去 ⇒ 🔴 **两端各红一条**（宿主形状腿 + 目录 0 命中腿），同趟正向对照腿保持绿；V3 往 `CalendarViewKind` 添一档而不给键名 ⇒ 🔴 **typecheck 红**（`TS2741: Property 'quarter' is missing`，不是测试红）；V4/V4b 把某一档的值抄成另一种语言 ⇒ 这条腿红**且 `check:ui-language` 也 rc=1** ⇒ ⚠️ 把我原来那句「那条门禁只比键集」否证（§4 22:1x 那两行）；V4c（跑的过程中补的）给键名联合添一条两本表里都没有的键 ⇒ 🔴 **门禁 rc=0**、判据红 ⇒ 这一维度只有判据在守；V5（同样补的）把中文字面量写死进宿主源码 ⇒ 门禁 **rc=0** ⇒ E2 那句「门禁也失明」**结论成立、理由要换**。🔴 每支臂跑完立刻还原，还原一律按 md5 逐字节比对（六支全等） |

---

## 3. 执行记录（逐批逐条，写读数不写结论）

| 时间 | 批 | 动作 | 读数 |
|---|---|---|---|
| 2026-10-03 22:2x | R17 的门禁与类型面（八步里的第 6 步） | 九条门禁逐条跑、三条 typecheck 逐条跑、四个受影响套件复跑（改注释之后重跑，证明注释没有把判据改哑） | **门禁**：design **rc=0**、layering **rc=0**、ui-language **rc=0**、rn-aria **rc=0**、empty-state **rc=0**、row-single-source **rc=0**、ui-provider **rc=0**、`check-md-table-rows` **rc=0**（4 个文件）；🔴 **l4 rc=1** 与 🔴 **docs rc=1** —— 两条都不归本批（l4 的红点是别人 22:18:52 刚落盘的未跟踪文件 `VaultSettingsPanel.tsx`，docs 的 45 站里 12 条的目标是本线三份**未跟踪**文档、关闭动作是一句被明令不许的 `git add`）→ §5 第 13 / 2 条。**typecheck**：ui **rc=0**、web **rc=0**、mobile **rc=0**（⚠️ §5 第 8 行那个"mobile rc=2"由对方在这三小时内关闭，已原地标注）。**套件**：`@heyta/ui` `calendar-view-step` **13 passed**、`@heyta/web` `calendar-view-tabs`+`calendar-day-view`+`calendar-view-family` **29 passed**、`@heyta/mobile` `calendar-view-entry` **11 passed**。**载体**：`node scripts/dist-freshness.mjs --only ui,i18n` ⇒ 落后 **0** 个（六支臂每次还原后都重建过一次，所以这条是"判据读的是当前产物"的现量而非声称） |
| 2026-10-03 22:1x | R17（档位表单一事实源） | `packages/ui/src/calendar/model.ts` 新增 `CALENDAR_VIEW_LABEL_KEYS`（`Record<CalendarViewKind, CalendarViewLabelKey>` —— **`Record` 本身就是守卫**）与 `CALENDAR_VIEW_ORDER`（顺序，年在最后）并从 `src/index.ts` 导出；`apps/web/.../CalendarHeaderToolbar.tsx` 删掉本地 `VIEW_OPTIONS`，`<option>` 改遍历共享那两份常量；`apps/mobile/src/screens/CalendarScreen.tsx` 删掉本地 `VIEW_OPTIONS` 与 `viewLabels.name` 里那张 档位→键 内联表，改 `options={CALENDAR_VIEW_ORDER}` + `t(CALENDAR_VIEW_LABEL_KEYS[kind])`；`TIMELINE_VALUE='timeline'` **留在宿主**（它是外壳视图不是日历档位，进共享表等于把「真的能用的档」重新定义歪）；判据三处（共享套件加「档位表的单一事实源」一节：集合一致 / 无重复 / 不含 timeline / `key === `common.calendar.view.${kind}`；web tabs 加「档位表只有一份」一节：正向对照 ≥4 + 两个宿主目录 0 命中 + 逐档双语值；mobile entry 两条形状腿换成「取自共享那份」）。🔴 本批**只删常量、不碰样式** | **判据**：`packages/ui` `tests/calendar-view-step.spec.ts` **13 passed**；`apps/web` `calendar-view-tabs.spec.tsx` **11 passed**、`calendar-view-family.spec.tsx`+`calendar-day-view.spec.tsx` **18 passed**；`apps/mobile` `calendar-view-entry.spec.ts` **11 passed**。**六支变异臂全部有读数**（V1/V2/V3/V4/V4b/V4c/V5 —— 后三支是跑的过程中发现原设计不够才补的，见 §4），每支还原后 md5 与基线逐字节相等（`model.ts 8f75fbd0…` / `CalendarScreen.tsx 5b7e4855…` / `en.ts 9addd82b…` / `zh-CN.ts 8f362719…` / `useCalendarLabels.ts 06781739…`）。**门禁**：`check:ui-language` rc=0，现量 **zh-CN 2875 条 / en 2875 条** —— ⚠️ 本篇与交接稿里那个 2851 已经漂（涨的 39 条里本线与并行那条线都有）；`check-md-table-rows` rc=0（4 个文件）；`pnpm --filter @heyta/ui build` rc=0；`node scripts/dist-freshness.mjs --only ui,i18n` ⇒ **落后于源码的产物：0 个（⇒ 本机判据读的都是当前产物）** |
| 2026-10-03 19:3x | R14c（批次②剩下的那一半：**移动端的时刻输入**） | 把共享层那根一直没人接的线接上：`TaskDetailSheet.tsx` 截止那张 `DatePicker` 传 `time={{ value: dueTimeValue, enabled: dueLocal !== undefined, labels: dueTimeText, onChange }}`；`onChange` 走既有的 `dueDateToEpoch(dueLocal, next)` ⇒ **零新 op、零新字段、零新判定**；换日子那条从"当场再算一次 `localTimeOf`"改成读同一个 `dueTimeValue`；`lib/date-picker-labels.ts` 新增 `datePickerTimeLabels(t, title)`；🔴 词条 `web.due.*` 四键**改名**进 `common.due.*`（不新写 `mobile.due.*`），web 那 4 行引用同步换；两张选择器各补一个宿主 `testID`（`task-due` / `task-schedule-start`）—— 此前两张都吃共享层默认值 `date-picker`，于是 `date-picker-time-input` 在同一屏出现两次，设备脚本按 testID 找元素时**点哪一张都可能**（现量：`grep -rn date-picker scripts/` = 0 命中 ⇒ 加前缀不破坏任何现有脚本） | **判据**：新文件 `apps/mobile/tests/task-due-time.spec.ts` **8 passed / 0 failed**（单跑 rc=0）。**变异臂 12 支**：M1 摘掉 time prop ⇒ failed=**4**；M2 `enabled` 恒 true ⇒ 1；M3 绕开 `dueDateToEpoch` ⇒ 1；M3b 引入 `getHours()`（给那条负向断言装牙）⇒ 1；M4 措辞写成裸中文 ⇒ 1；M5 再算一次 `localTimeOf` ⇒ **2**；M6 只漂 zh 那句「全天」⇒ 1；M7 只往 zh 留旧键 ⇒ **臂无效**（红在 i18n 的 DTS 构建，不是判据，见 §4）；M7b 往**两份**表同时留旧键 ⇒ 1；M8 移动端改读 `web.due.*` ⇒ 1；M9 摘掉 testID ⇒ 1；M10 两张同名 ⇒ 1。🔴 每支还原后按 sha256 逐文件比对，四个文件全等（`digest_match: true`）。新文件 `apps/mobile/tests/task-due-time.spec.ts` **未被跟踪**（本会话被明令不许 `git add`）⇒ 入库动作与证据 png 同一归属，见下面 §5 第 2 条。**门禁 17 条 rc=0**：design / layering / ui-language / rn-aria / empty-state / row-single-source / ui-provider / l4 / docs / docs-voice / calendar / theme / crosslang-contract / journey-coverage / script-snapshot / mobile-settings / mobile-first-run-gate（未入库的那条 `scripts/check-md-table-rows.mjs` 也 rc=0）。**typecheck**：web **rc=0（0 error）**，shared-schema / domain / ui / app-host / i18n **各 rc=0**；🔴 mobile **rc=2、1 条 error，不是本批的**（`TrashScreen.tsx:180` 往 `<Text>` 传 `testID` 而 `TextProps` 没有这个属性；该文件正被另一条会话改：同一句报错在两趟运行之间从 176 行漂到 180 行）→ §5 第 8 条。**全量**：web **1564 passed \| 13 skipped**（0 failed）、ui **473**、i18n **22**、app-host **1002**、mobile **633 passed \| 2 failed** —— 那 2 条都在同一枚 `tests/trash-display.spec.ts`（「便签 / 笔记」叫法），而**同一枚文件在 19:18 那趟还是"收集失败"**（Rolldown 解析 `react-native/index.js` 的 Flow 源码）⇒ 一条会话正在动它，本批不代改、不吸收 → §5 第 9 条 |
| 2026-10-03 19:2x | R14c·闸门本身 | `check:ui-language` 的词条表解析器**把两种病报成同一种**：它比的是"看起来像词条的行数 vs `Map.size`"，而**重复键**会让 `Map.size` 变小 —— 于是它报「词条表必须保持一行一条、引号转义的形状」，把读者往"有人写了多行词条 / 漏了转义"那边带；真实原因是同一个键写了两遍（后者 TS、构建、原门禁**都不报**，只有运行时知道用了哪一句）。改成两种病分开报：重复键逐条点名（键名 + 两处行号 + "后一条覆盖前一条"），漏行仍走原句；`parseCatalog` 的返回值**保持"键 → 句子"的原契约**（规则 2/3/4 直接比 value，把它改成对象会让别的规则比对不上 —— 那是另一种假绿） | 🔴 **活树上的一次真实读数**（不是我造的夹具）：19:27:23 那趟 **rc=1**，点名 `web.trash.confirm.notErasure` 第 613 / 618 行、`web.trash.error` 第 617 / 619 行（两份表都有；现量 `git show HEAD:` 对这两键 = **0 命中** ⇒ 全是未提交的新键）。一分钟后复跑 **rc=0**（"词条表 zh-CN 2869 条 / en 2869 条"）—— 那条会话自己把重复删了，本会话没动他们那 4 行。**新分支会不会红只靠夹具**：把 `parseCatalog` **原文**从脚本里取出来执行，四个输入 clean → exit 0 且 entries=2；dup → exit 1 报"重复键"；triple → exit 1；shape（value 用双引号）→ exit 1 仍报"无法解析"（证明我没把老判据改哑）。另：仓里**没有** `.prettierrc`、`package.json` 里没有 lint / format 脚本，而**没碰过的** `apps/web/src/App.tsx` 在 `prettier --check` 下同样 warn ⇒ 默认配置的 prettier 不是本仓的格式权威，本批不重排任何文件 |
| 2026-10-03 04:12 | — | 立本篇 + 三路只读调研（年视图可复用件与撞点 / 时刻输入侧现状与历史否决 / 移动端 Profile 与取图能力） | 派活时现量：`packages/op-log` 仍 3 改 1 未跟踪；`vm.loadavg` 308.93（本机极重 ⇒ 本小时只写文档与读码，**不跑测试与 e2e**，避免把负载压到别人验收的闸门上） |
| 2026-10-03 18:2x | R16 | **内容那一半已在 jsdom 落地并配了三支变异臂；几何那一半仍在端口后面**（§5 第 5 条）。做法：① 新写 `e2e/tests/calendar-day-en.spec.ts`（2 条，浏览器 + 截图）；② 🔴 等端口期间发现"内容"这件事其实**不需要浏览器** —— 把 `apps/web/tests/calendar-day-view.spec.tsx` 的本地 `mount()` 加一个可选 `locale` 参数（走产品自己的 `applyLocale`，不在测试里抄 storage key）、`openCalendar()` 的 tab 名从表取，然后加一条**英文会话**用例：那三句逐字等于 `en` 表 + 三条对照（en≠zh、`dayNoTimed`≠`dayEmpty`、`dayAllDay` 两语不等）+ 整块日档**零中文残留**（TreeWalker）；③ 把原来那句 `toContain('全天')` 的弱断言升级成 `toBe(zhCN['common.calendar.dayNoTimed'])` | **判据**：`apps/web/tests/calendar-day-view.spec.tsx` **13 passed**（R14 那轮是 12，多的一枚就是英文腿）。**typecheck**：`@heyta/web` **rc=0**（`tsc --noEmit -p tsconfig.spec.json`，不带管道）。**门禁**：journey-coverage / script-snapshot / docs-voice / layering / design / ui-language **六条 rc=0**（本轮新加的 `scripts/check-md-table-rows.mjs` 也 rc=0）。**变异三支逐支红**（见下面"R16 的三支变异臂"，读数是本轮最值钱的一条：**E2/E3 只有英文那条腿会红**，中文那条腿对着中文字面量永远绿）。**e2e**：18:2x 那一趟现量端口被占（62/68 个 PID），**18:24 端口空出来跑掉了** —— 读数与看图结论在下一行 |
| 2026-10-03 18:4x | R16 + R15b · **e2e 那一半（看图与取证）** | `cd e2e && npx playwright test tests/calendar-day-en.spec.ts tests/profile-avatar-e2ee.spec.ts` —— 🔴 这条实际是 **18:24 / 18:33 分两趟**跑掉的，本轮**没有重跑**（18:3x 起端口又被占满：18:35 现量 4318/4319 各 **57** 个 PID）。本轮补的是不需要端口的那一半：**七张图逐张打开看**（§6.2 规定一第 4 条），结论与 **md5** 写进两份证据 README（`apps/web/evidence/calendar-day/README.md`「R16 追加的三张」、`apps/web/evidence/profile-panel/README.md`「R15b 追加的四张」）| **七张都在盘上**：`day-en-{full,no-timed,empty}.png` mtime 18:24:15–17（1280×720）、`r15b-{1-need-password,2-ready,3-ready-dark,4-after-reload}.png` mtime 18:33:15–17（1280×900）。**退出码那一趟没留下**：`/tmp/r15b-r16-e2e.out` 不存在（那两趟是内联输出跑的，压缩把读数带走了）。改从 Playwright 自己写的 `e2e/test-results/.last-run.json` 恢复 ⇒ `{"status":"passed","failedTests":[]}`，mtime **18:33:17**（正好是 r15b 那四张的落盘时刻）。🔴 **这条恢复有三个边界，别读多**：① 它只说"最后一趟"，不说跑了哪些 spec；② 18:39 起同一检出里又一趟在跑（落了 `web-storage-backend.png` / `web-migration.png`），跑完会覆盖这枚文件 ⇒ 要带退出码的读数只能自己重跑；③ 它证明"这一趟没红"，**不证明**"这七张图是这一趟拍的"（那是 mtime + 文件名形状两条合起来的间接证据）。看图看出的三条（两支降级、一支反被否证成最硬的正面证据）逐条在 §4 的 18:4x 三行。⚠️ **18:5x 更正（同一条 18:4x 行写完后 15 分钟）**：上面那句「本轮没有重跑」**作废** —— §4 的 18:5x 那行查出「端口被占」是一枚**坏探针**（见下面那条），4318/4319 其实一直空着，于是 18:53 重跑了一趟，**这一次退出码留下了**：`3 passed (9.1s)`、`rc=0`、日志 `/tmp/r15b-r16-e2e.out`（三条用例名逐条 ✓，含头像那条 4.1s）。七张图重拍于 18:53:16–21，两份 README 里的 md5 已换成这一趟的；r15b 四张与 18:33 那趟**逐字节相同**（确定性渲染），day-en 三张不同（标题带 STAMP）⇒ §5 第 5 条就此关闭 |
| 2026-10-03 18:5x | 端口探针修好之后，把**不需要端口的**与**需要端口的**分别重跑：① `pnpm --filter @heyta/web exec vitest run tests/calendar-day-view.spec.tsx tests/calendar-year-board.spec.tsx tests/due-date-edit.spec.tsx tests/calendar-view-family.spec.tsx`；② mobile 三个 profile/档位入口文件；③ app-host 两个（含本轮新加的 E2EE 格式判据）；④ `@heyta/ui` 全量；⑤ 日历 e2e 家族 7 个文件（`calendar-day` / `calendar-day-en` / `calendar-week` / `calendar-year` / `calendar-view-family` / `calendar-cells` / `profile-avatar-e2ee`）| **①–④ 四条 rc=0**：web 定向 **4 文件 / 46 passed**、mobile **3 文件 / 33 passed**、app-host **2 文件 / 26 passed**、ui 全量 **26 文件 / 473 passed**。🔴 **⑤ 没跑成，而且它的失败方式正是这条线一直在防的那一种**：`rc=1`，日志只有 2 行 —— `Error: http://127.0.0.1:4319/__requests is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer.` ⇒ **0 条用例执行**（不是产品红，是环境被占）。18:58 现量 `lsof -nP -iTCP:4318 -sTCP:LISTEN` 与 `4319` 各 **1** 个监听者（18:53 那一趟跑之前两枚都是空的，两趟之间被另一条会话占上）。✅ 顺带量到一条**好消息**：Playwright 在这种情况下是**响亮拒绝**而不是把对方的 server 杀掉 （`/tmp/cal-family.out` 全文就是那两行，没有 SIGKILL 的痕迹）—— 与 §7 第 87 条「`check:ai-e2e` 会 SIGKILL 别人的 dev server」不是同一个形状，值得让后来者知道（区别在 `check:ai-e2e` 走的是 `pnpm check` 那条全量链，会先自己清场）| 读数：`/tmp/t-web.out` `/tmp/t-mobile.out` `/tmp/t-apphost.out` `/tmp/t-ui.out` `/tmp/cal-family.out`（各带 `Test Files` / `Tests` 汇总行）|
| 2026-10-03 05:51 | R13 | 实现（domain 1 条数学 + 共享层 5 处 + 两端接线 + 4 条新词条）→ 判据 3 份新/改文件 → 10 支变异臂 → 门禁 11 条 → 三端测试 + typecheck | **判据**：`packages/domain` 31 文件 / **827 passed**（含新增 `date-year.spec.ts` 6 条）；`packages/ui` 26 文件 / **467 passed**（含新增 `calendar-year-model.spec.ts`）；`apps/web` 全量 **1 failed \| 1542 passed \| 12 skipped**（那 1 枚红 = `trash.spec.tsx`，见下面「本批唯一红归因」）；`apps/mobile` 35 文件 / **549 passed**；新增 `apps/web/tests/calendar-year-board.spec.tsx` **12 passed**、`calendar-view-family.spec.tsx` **5 passed**。**typecheck**：domain/ui/mobile/web 四段均 exit 0（mobile 与 web 各先报过一段**是我自己写的**错，见 §4 第 5、6 行）。**门禁**：design/l4/rn-aria/row-single-source/empty-state/ui-provider/layering/ui-language/calendar/theme **10 条 rc=0**，`check:docs` **rc=1**（3 处"本机有、仓库里没有"的链接 = 本会话被明令不许 `git add`，登记在 §5 第 4 条）。**变异臂**：10 支全部把对应判据打红，逐支读数见下一节 |
| 2026-10-03 06:15 | R13·补 | 看截图抓出"卡里面 31 天挤一行"→ 改用 `monthGrid` 按周分行 → 再看截图 + 量位置，抓出**行与行差 2~4px** → 补白格改用与格子同一份样式 → 两条新判据 + 4 支变异臂 → 门禁 10 条 | **判据**：新增 `🔴 格子是按周分行的：每张卡 6 行、每行 7 个槽位`（jsdom，钉结构）与 `①c 格子必须落在星期表头那一列`（真浏览器，钉位置，容差 1.5px）。**现量**：`apps/web/tests/calendar-year-board.spec.tsx` **13 passed**、`family` **5 passed**、`tabs` 全过；`packages/ui` 26 文件全过、`packages/domain` 31 文件全过、mobile `calendar-view-entry` 全过；`e2e/tests/calendar-year.spec.ts` **3 passed (8.0s)**；typecheck ui/web/mobile 三段 Done；**门禁 design/l4/rn-aria/row-single-source/empty-state/ui-provider/layering/ui-language/calendar/theme 10 条 rc=0**。**取证**：`apps/web/evidence/calendar-year/year.png` + `year-bottom.png`（**人已打开看**：4×3 张卡、每卡 7 列对齐表头、10 月的 3 号带主色边框 + 主色数字 + 状态点，月末那行的 26…31 不再左移）|
| 2026-10-03 07:49 | R14 | 实现（domain：规则表 +1 条 `HH:MM` + `dueTimeNeedsDate` 闸门 + `dueDateToEpoch(date, time?)` + `isAllDayDueMs`/`localTimeOf` 一份判定；共享层：`CaptureChip.dueTime` + `captureChipTimeLabel` + `DatePicker` 时刻栏（草稿/提交分离）+ `CalendarDayBoard` 两条空态分范围；web：`DueEditor` 时刻栏 + 换日子搬运时刻；app-host：导出行带 `dueTime`、markdown 同一格不新加列）→ 判据 5 份 → 13 支变异臂 → 门禁 11 条 + 三端测试 + 五段 typecheck → 真浏览器重拍两张图**并人已看** | **判据**：`packages/domain/tests/capture.spec.ts` **72 passed**（原 61，+11）· `packages/ui/tests/capture-model.spec.ts` **36 passed** · `apps/web/tests/due-date-edit.spec.tsx` **15 passed** · `apps/web/tests/calendar-day-view.spec.tsx` **12 passed** · `packages/app-host/tests/export-dump.spec.ts` **12 passed** · `e2e/tests/calendar-day.spec.ts` **5 passed (9.4s)**。**三端全量**：ui **472 passed**、web **1551 passed \| 12 skipped**、mobile **549 passed**，🔴 **本轮 web 全量 0 红** —— 上一批登记的那枚 `trash.spec.tsx` 红**不是本批修的**，是并行会话重建 `packages/op-log/dist` 之后自行解除（现量见 §5 第 1 条）。**门禁**：design/layering/ui-language/rn-aria/empty-state/row-single-source/ui-provider/l4/calendar/theme **10 条 rc=0**；`check:docs` **rc=1**（现量 4 处"本机有、仓库里没有"，全部是本会话被明令不许 `git add` 的新文档/新证据目录 → §5 第 2 条已把 `calendar-day-time/` 记进去）。**typecheck**：domain/ui/app-host/web/mobile **五段 rc=0**。**零 schema 变更**（本轮不 bump `CURRENT_SCHEMA_VERSION`、不新增持久化字段：时刻是同一个 `dueDate?: number` 的另一种取值，判"到日/到分钟"用的是 `isAllDayDueMs` 那一份）|
| 2026-10-03 08:01 | R14·补 | **本机 API（MCP / 脚本）那一侧的时刻** —— R14 收口时把它登记成"同批扩"，这一笔补上：`fromLocalDateString` 收 `YYYY-MM-DDTHH:MM`（带秒/带 `Z`/空格分隔一律拒，反查多比时分两项）、新增 `toLocalApiDueString`（有时刻就带 `T16:00`）、`taskToItem` 换用它、格式说明与两处 `invalid` 报错收成**一份** `LOCAL_API_DUE_FORMAT_HINT` 抄件、MCP 工具描述两处跟着改 | 🔴 **刻意不新增 `dueTime` 字段**：`dueDate` 这一个键已经在两个工具的 `egressFields` 出境披露清单（`tools.ts:97`/`:109`）、两处白名单投影（`tools.ts:411`/`:448`）与 MCP 输出 schema（`mcp.ts`）里 —— 加字段要同时改**五处**，少改最后一处就是"把没披露过的字段送出去"。同一个键多带一段 `T16:00` 一次绕开这五处。**判据**：`packages/app-host/tests/local-api-host.spec.ts` **32 passed**（原 27，+5 条：投影带/不带 `T`、`taskToItem` 真的接上、`T16:00` 落在本地那一分钟 + 往返、7 种非法形状被拒、create-task 载荷与报错文案）。**变异臂 A14–A18** 五支全红：failed=3 / failed=3 / failed=1 / failed=1 / failed=1（逐支见下面那张表）。**改了一条既有判据的口径**（不是为跑绿）：`local-api-host-due-filter.spec.ts:285` 的 `dueDate` 断言从"整串等于 `2026-03-15`"改成"前 10 位等于 `2026-03-15`" —— 这一条量的是**按日筛**，而 23:30 那条现在如实带时刻；时刻本身钉在另一个文件里，不重复钉（口径变更的完整论证见 §4 里 08:01 那一行）。**门禁**：`check:ai-tools` **rc=0**、`check:ai-coverage` **rc=0**（工具契约的目录/授权/披露三本账都没被这次改动绕开）、layering/design/ui-language **rc=0**、app-host + local-api typecheck **rc=0**。**全量**：`@heyta/local-api` **103 passed**；`@heyta/app-host` **980 passed / 0 failed**；`@heyta/web` **1551 passed \| 12 skipped**（与 R14 那轮逐字相同 ⇒ 这一笔没有动到 web） |
| 2026-10-03 08:30 | R15a | **移动端 Profile 的昵称读写**（R10 剩下的那半）。实现：`planDisplayNameWrite` 进 `packages/app-host/src/hosted-auth.ts`（"要不要发这一发昵称写入"的**唯一**裁决：`no-credential`/`too-long`/`unchanged` 三种"不发"各对应一种真实失败形状，`write` 分支带收窄后的 `token`），`index.ts` 导出函数与类型；web `ProfilePanel.saveNickname` 改成**消费**它（原来那半套判断留在壳里）；mobile `ProfileScreen` 加昵称三态（还没读到 ⇒ 整行不出现 / 读到 ⇒ 值行可点 / 点 ⇒ 行内 `TextField` + 保存 + 取消），读取走出境闸门；`apps/mobile/src/ui/kit.tsx` 的 `TextField` 加两个**默认值等于原值**的可选 prop（`onSubmitEditing` ⇒ 顺带 `returnKeyType:'done'`、`testID`），本屏新增 `style={{` 行数 **0**（`check:l4` 的 mobile 段基线 **90 恰在 90，零余量**）。i18n：`web.settings.profile.*` → `common.profile.*`（**19 个键改名 / 24 处引用 / 1 个消费者文件**）+ 新增 `common.profile.nickname.failed`、`mobile.profile.nickname.hint`；表计数 zh **2851** / en **2851** | 判据：`packages/app-host/tests/display-name-plan.spec.ts` **11 passed**（新）、`apps/mobile/tests/profile-nickname-entry.spec.ts` **9 passed**（新，node 源码级通道 —— 本仓 mobile 没有 RTL/jsdom）、`apps/web/tests/profile-panel.spec.tsx` **11 → 12 passed**。🔴 顺带查出一条真缺陷并修掉：**昵称保存失败时界面上说的是"头像"那句**（`ProfilePanel` 的失败分支复用了 `avatar.failed` 文案），新那条用例钉的就是"说的是昵称那句、`notice` 里不出现「头像」二字"。门禁：design / layering / ui-language / rn-aria / empty-state / row-single-source / ui-provider / l4 **全 rc=0**；`--filter @heyta/app-host typecheck` rc=0。变异：**11 支逐支红**（见下面"R15a 的 11 支变异臂"）。⚠️ 三条实现路上的否证与两处脚手架红记在 §4 |
| 2026-10-03 09:4x | R15b | **移动端 Profile 的头像读写**（R10 剩下的那半的另一半）。实现分四层：共享层三条新接缝（`base64DecodedBytes`/`isAvatarContentType`/`avatarOutputContentType`/`planAvatarUpload`/`avatarInitialFromEmail`/`avatarDataUri` + `resolveAccountAvatarImage` 五枚状态）→ Android 原生 `prepareAvatarBase64`（PNG 无损 / JPEG 86、`Base64.NO_WRAP`）→ mobile 平台层 `lib/avatar-prepare.ts` + 全 mobile **第一个** RN `<Image>`（`ui/avatar.tsx`）→ 屏幕接线（读取闸门 / 口令闸门 / picker / 上传 / 删除 / 五句各读各的）。🔴 同批修掉 web 三处"界面在讲另一件事"，其中最贵的一处是**五种解码失败并成"没有头像"**（详见 §2 R15b 落点 ④(c)） | **判据（当轮复跑读数，17:4x 本机）**：`packages/app-host/tests/hosted-account-profile.spec.ts` 所在包全量 **48 文件 / 999 passed / 0 failed**（🔴 **18:1x 复跑 1000 passed** —— 多出的那一条就是下面 M15a/M15b 钉的 E2EE 判据）；`packages/shared-schema` 全量 **6 文件 / 106 passed / 0 failed**（本批新文件 `account-avatar-plan.spec.ts` **15 passed**）；`apps/web/tests/profile-panel.spec.tsx` 单跑 **15 passed**、web **全量 114 文件 passed \| 2 skipped → 1562 passed \| 13 skipped，0 failed**；`apps/mobile` 两份 profile spec 单跑 **2 文件 / 22 passed**、mobile 全量 **38 文件 / 586 passed / 0 failed**。**门禁**：design / layering / ui-language / rn-aria / empty-state / row-single-source / ui-provider / l4 **八条 rc=0**。**零 schema、零领域改动**（这条链不是 op：密文 blob 走专用 HTTP 路由，`CURRENT_SCHEMA_VERSION` 未动、没加任何持久化字段）。变异：**16 支逐支红**（原 14 支 + 18:1x 补的 M15a/M15b，见下面"R15b 的变异臂"。🔴 M15a 那一支顺带照出一个**判据缺口**：把已作废的明文 `content_type` 加回出站 body，当时那 13 条 E2EE 判据**一条都不会红**）。🔴 两处**探针自身**的错都在 §4 里留了字（一次把我的 spec 清成空文件、一次 `lsof` 用法写错得到假 0）。**typecheck 四段 rc=0**（`shared-schema` / `app-host` / `web` / `mobile`，🔴 每条都是**不带管道**重跑取的一次退出码 —— 第一版写成 `… \| tail -20; echo rc=$?` 量到的是 `tail` 的 0，§7 第 45 条那一族我自己又踩了一次，见 §4 09:5x 行）。§2 会撞谁 ② 那条 `packages/ui/dist` 的阻塞**在同一次收口里被并行会话的重建解除**（`index.d.ts` 已存在、`archivedProjects` 已在产物、mobile 那 209 条整片消失），所以**没有**新增 §5 条目；四端重装与本批真机取证仍被 §5 第 1 条挡着 |

### R14 的 18 支变异臂（逐支：改哪一行 → 红了几条 → 该红的是哪条结论）

> 打的是**活树上的原地变异**（脚本 `python3 /tmp/r14-arms.py <起> <止>`，A13 在 `/tmp/arm13.py`）。
> 每支跑完 `finally` 里按字节还原 + 重建；**开头有一道锚点门**：任何一支的锚点在文件里
> 不唯一，整批一支都不跑（跑到一半才发现锚错，前面的臂已经把源码与 `dist` 换过一轮了）。
> 收尾现量（三支变异 needle 回查）：`grep -c "(?!)/" packages/domain/src/capture.ts` = **0**、
> `grep -c "dueTimeXX" packages/ui/src/capture/model.ts` = **0**、
> `grep -c "true === true" packages/app-host/src/export-dump.ts` = **0**、
> `space.12` 命中 1 / `space.8` 残留 0 —— 🔴 这条**必须带形状**才复现得出来：
> `grep -c "tokens\['space.12'\]"` = 1、`grep -c "tokens\['space.8'\]"` = 0，
> 而裸 `grep -c "space.8"` = **3**（那三处是记录旧取值的注释）。⚠️ 原句只写"残留 0"、
> 没写命令形状，下一位照字面量会得到相反的数字。
> A14–A18 五支后：`grep -c "(?!:" packages/app-host/src/local-api-host.ts` = **0**、
> 正则那一行（`:117`）现读回仍是 `(?:T(\d{2}):(\d{2}))?$`（秒那一支没留在树上）。
> 🔴 每支都**先重建再跑**：判据读的是共享包的 `dist`，只改 src 不 build 得到的"没红"什么都不证明。

| 支 | 改的那一行 | 读数 | 该红的是 |
|---|---|---|---|
| A1 | `capture.ts` 时刻规则的正则 → `/(?!)/`（永不匹配） | `capture.spec` **failed=5** passed=67 | `明天16:00 交周报` 解析出 `dueTime` |
| A2 | `if (dueTimeNeedsDate) firstOfField.delete('dueTime')` 的键改成不存在的字段（= 闸门失效） | **failed=1** passed=71 | 没有日子的 `16:00` **不单独成立**、原文留在标题 |
| A3 | `dueDateToEpoch` 的 `timeOfDayMs(time)` 乘 `0` | **failed=2** passed=70 | 带时刻时落在那一分钟，不是零点 |
| A4 | `isAllDayDueMs` 去掉秒/毫秒两项（只判时分） | **failed=1** passed=71 | 零点 + 30 秒**不是**"只到日"（与 `localTimeOf` 互斥那组） |
| A5 | `toCaptureSubmitPlan` 传 `dueDateToEpoch(dueDate, undefined)` | **failed=1** passed=35 | 提交计划带着解析出的时刻 |
| A6 | `captureChipTimeLabel` 的字段比较改成不存在的字段 | **failed=3** passed=33 | 芯片念「16:00」而不是「不设置」 |
| A7 | `CalendarDayBoard` 全天带选句三元 `> 0` → `=== 0` | **failed=2** passed=10 | 两句空态各说各的范围 |
| A8 | `DueEditor` 换日子时 `dueDateToEpoch(date, timeValue)` → `(..., undefined)` | **failed=1** passed=14 | 换日子**搬运时刻**（不搬 = 提醒提前一整天） |
| A9 | `DueEditor` 时刻栏 `enabled: value !== undefined` → `enabled: true` | **failed=1** passed=14 | 没有日子就没有"几点" |
| A10 | `DatePicker` 的 `if (parsed !== undefined) time.onChange(parsed)` → 半截/非法也提交 | **failed=1** passed=14 | 非法形状（`25:00`）一条 op 都不产生 |
| A11 | `export-dump` 的 `...(dueTime === undefined ? {} : { dueTime })` 改成永不带 | **failed=1** passed=11 | 人工导出不静默丢时刻 |
| A12 | markdown 那格的 `row.dueTime === undefined` 条件改成恒真 | **failed=1** passed=11 | 「截止」那一格写 `2026-03-15 16:00` |
| A13 | 🔴 **界面几何臂**：时刻列宽退回出事那一版 `space.8` | `e2e calendar-day` **exit=1**，红在结论不是红在探针：`这些时刻标签折行或溢出：「10:00」42/21 overflow=false \| 「11:00」42/21 …` | 时刻列不许把 `16:00` 折成两行 |
| — | ↓ **A14–A18 打的是本机 API 那一侧**（`local-api-host.ts`，见下面「R14·补」行）| | |
| A14 | `toLocalApiDueString` 的 `return time === undefined ? day : …` → `time === undefined \|\| time === time ? day` （= 永远只报日） | `local-api-host.spec` **failed=3** passed=29 | 投影带时刻：MCP 眼里"16:00 那条"和"只到日那条"不再是同一个值 |
| A15 | 正则的时刻捕获组改成不捕获 `(?:T\d{2}:\d{2})?` | **failed=3** passed=29 | `T16:00` 落在**本地那一分钟**（不是零点）+ create-task 载荷带分钟 |
| A16 | 规范形放宽到允许秒 `(?:T(\d{2}):(\d{2})(?::\d{2})?)?` | **failed=1** passed=31 | `2026-03-15T16:00:00` 被拒 —— **规范形只有一份**，不接受"等价写法" |
| A17 | 写入路径 `fromLocalDateString(intent.dueDate)` → `…(intent.dueDate.slice(0, 10))` | **failed=1** passed=31 | 非法形状**被拒**，而不是尽力而为地截出一个日子 |
| A18 | 报错文案退回写死 `格式应为 YYYY-MM-DD` | **failed=1** passed=31 | 报错说出**两种都收**（工具作者才知道时刻能写）|

⚠️ **A6 与 R13 的 A6 同族**：它的 `pnpm --filter @heyta/ui build` 在 **dts 阶段先红**
（`types 'CaptureField' and '"dueTimeXX"' have no overlap`），但 JS 产物在 dts 之前已写出，
所以那一支的判据读数（failed=3）有效 —— 红在真变异体上，不是红在旧 `dist` 上。


### R13 的 14 支变异臂（逐支：改哪一行 → 红了哪几条 → 断言原文）

> 打的是**活树上的原地变异**，每支跑完立刻用改前字节备份 `cmp` 还原（不走 git，共享工作树里
> 裸 `add`/`stash` 会把别人卷进来）。收尾复查：10/10 支 `SAME`、`MUTATED-13` 残留 0 个文件、
> `git diff --stat` 与基线逐字相同（`19 files changed, 981 insertions(+), 98 deletions(-)`）。

| 支 | 改的那一行 | 红了哪些 | 断言原文（首条） |
|---|---|---|---|
| A1 | `model.ts` 年档步进 `segments * MONTHS_PER_YEAR` → `segments` | `calendar-year-model` **4 红** + `calendar-view-family` **1 红** | `expected '2026-11-03' to be '2027-10-03'` |
| A2 | 删掉"往下取到能整除 12 的列数"那一行 | `calendar-year-model` **2 红** | `5 列时给了 5: expected 2 to be +0`；`expected 5 to be 4` |
| A3 | web `drillIntoMonth` 顺手 `selected: monthFirstDay` | `calendar-view-family` **1 红** | `点月卡把选中的那天也换掉了 —— 那不是钻取，是劫持: expected '2026-03-01' to be '2026-10-03'` |
| A4 | 没接回调那一支也补上 `accessibilityRole="button"` | `calendar-year-board` **1 红** | `没接回调却画出了可点的月卡: expected [ … ] to have a length of +0 but got 12` |
| A5 | `monthsOfYear` 循环上界 `- 1` | `date-year` **2 红** + `calendar-year-board` **3 红** | `expected [ '2026-01-01', … ] to have a length of 12 but got 11`；`第 12 张卡没有月份名` |
| A6 | 合并分支条件里漏掉 `view === 'year'` | `calendar-year-board` **9 红** + `family` **2 红**，**且 `pnpm --filter @heyta/ui build` 在 dts 阶段先红** | `TS2367: types '"day"' and '"year"' have no overlap`；`expected [] to have a length of 12` |
| A7 | mobile `VIEW_OPTIONS` 撤掉 `'year'` | `calendar-view-entry` **1 红** | `expected [ 'month', 'week', 'day' ] to deeply equal [ 'month', 'week', 'day', 'year' ]` |
| A8 | 工具栏年档标题退回 `labels.monthTitle(cursor)` | `calendar-year-board` **1 红** + `family` **1 红** | `expected '2026年10月' to be '2026年'`；`to match /^\\d{4}年$/u` |
| A9 | 英文表漏 `'common.calendar.view.year'` | `pnpm check:ui-language` **rc=1**、`@heyta/i18n build` **rc=1**（类型层就拦中英对等）、`calendar-view-entry` **1 红** | `en 缺 common.calendar.view.year: expected '…' to contain ''common.calendar.view.year''` |
| A10 | 今天那一格的 `aria-current` 改成恒 `undefined` | `calendar-year-board` **1 红** | `一年里没有任何一格标了"今天" —— 找今天只能靠肉眼: expected [] to have a length of 1` |
| A11 | 补白格从 `styles.day` 改成 `null`（每行不再 7 个槽位） | `calendar-year-board` **1 红** | `2026-01 有一行不是 7 个槽位（列会错位）: expected 4 to be 7` |
| A12 | 补白格换回"三个 flex 值同形、但没有边框"的另一套样式 | `e2e calendar-year` **1 红**，且**只有 ①c 那条红**（"7 个横位"在 6px 容差下仍绿） | `格子 x=656.4 离最近那列表头差 3.4px ⇒ 行与行没对齐（表头：572.0 601.3 630.6 659.9 689.2 718.4 747.7）` |
| A13 | 🔴 **探针变异**（不是产品变异）：去掉选择器里的 `:not([data-testid$="-dot"])` | `e2e calendar-year` **1 红** | `本月格子只占 8 个横位`，多出来的那一列 x=729.1 正是今天那颗 8px 的点 |
| A14 | `dayGrid` 退回出事那一版的 `flexDirection:'row' + flexWrap:'wrap'` | `e2e calendar-year` **1 红** | `本月格子只占 10 个横位`，x 序列里同一行以 6.7px 间隔排开 31 格 —— 就是那张截图的形状 |

> **A11–A14 这一轮**（`bash /tmp/r13-mutants-2.sh`，日志 `/tmp/heyta-r13-mutants-2.log`）：
> 4/4 支红在预期的那一条上，逐支 `已还原（cmp 一致）`，收尾 `git diff --stat -- packages/ui apps/web e2e`
> = `16 files changed, 749 insertions(+), 87 deletions(-)`，与本支基线**逐字相同**。
> ⚠️ 这组数字的路径集与上面那 10 支不同（那 10 支量的是 `packages/ui packages/domain packages/i18n apps/web apps/mobile`），
> **不是同一把尺**，别拿来互相对账。

🔴 **A12 + A13 合起来说明一件事**：那一次"8 个横位"的红里**同时**藏着两个结论 ——
探针把状态点当成了格子（A13 证的），以及行与行之间真的差 4px（A12 证的）。
只修任何一个，红都还在，但归因会指错地方。所以这一支的处置是先**打全几何**
（未取整的 x + 逐节点身份）再决定改哪边，而不是照着"少一个横位"去改组件。

🔴 **A6/A9 那两支额外量到一件事**：它们的"红"不止落在判据上，**编译期先红**（dts / `satisfies`）。
JS 产物在 dts 失败**之前**已写出，所以判据读数是有效的（红在真变异体上，不是红在旧 dist 上）——
这一点必须写清，否则"build rc=1"会被下一个人读成"这支作废"。

### 本批唯一红归因（`apps/web/tests/trash.spec.tsx`）

不是本批造成的，也不由本批修：同工作树里 `packages/op-log` 正被并行会话改
（现量 `git status --porcelain` = `src/engine.ts` / `src/state.ts` / `tests/engine.spec.ts` 三处 `M`、
`tests/semantic-invariants.spec.ts` 未跟踪；`git diff --stat` = 145+/93- → 现在已是 **207+/152-**，
比早上派活时又长了），而症状正是他那半条链的形状 —— 已删除任务的 `title` 不再被物化，
回收站因此落进"空态"那一支（打印出 `恢复：{title}` 这种**没被插值的模板**）。
本批碰过的路径全在日历与 i18n 的四条新键上，**没有一处**读回收站或字段合并。

现量命令（谁都能复跑）：
```bash
git diff --stat -- packages/op-log            # 规模在长 = 他还在写
cd apps/web && NO_COLOR=1 npx vitest run tests/trash.spec.tsx --reporter=dot
```
处置：不代改、不吸收、不为它改判据（本篇 §1 第 3 行）。

### R15a 的 11 支变异臂（逐支：改哪一行 → 红了哪几条 → 该红的是哪条结论）

> 打的是**活树上的原地变异**（脚本 `python3 /tmp/r15a-arms.py <起> <止>`）。开头一道**锚点门**：
> 任何一支的锚点在文件里不唯一 ⇒ 整批一支都不跑（这一批 11 支的锚点全部命中 1 次）。
> 🔴 共享包那几支（`app-host` / `i18n`）**改完必须重建 `dist` 再跑判据** —— 判据读的是产物，
> 不重建的话"没红"什么都不证明（§7 那一族）。每支 `finally` 里按字节还原 + 重建。
> 跑的这一趟在 **16:33–16:4x（本机）**；复跑命令在下面最后一行，但**现在不能跑**：
> 并行会话正拿 4318 跑 e2e，而那几支臂要重建 `packages/*/dist`（§5 第 4 条）。
> 复绿凭据不是"我记得红过"：臂后整链 `app-host 991 passed` / `web 1552 passed | 12 skipped（0 failed）`
> / `mobile 573 passed` / 八道门禁 rc=0，且还原复查逐条过
> （`grep -c "input.token === undefined)"` = 0、`planDisplayNameWrite({` 在 `ProfileScreen` = 1、
> `common.profile.nickname.failed` 回到 web、`Tap this row…` 回到 `en.ts:2443`）。

| 支 | 改的那一行 | 红了哪些 | 该红的结论 |
|---|---|---|---|
| M1 | `planDisplayNameWrite` 的空令牌判据退回只看 `undefined`（丢掉 `.trim() === ''`） | app-host `display-name-plan` **failed=1** | 没有可用凭据的**三种形状**都不发 |
| M2 | `write` 分支的 `value` 从"空串→`null`"退回原稿直传 | app-host **failed=2** | 空框发的是 `null`；只填空白与留空同义（`''` 与 `null` 不是同义词） |
| M3 | `unchanged` 那一条的比较对象换成永不可能的串 | app-host **failed=1** | 内容没改 ⇒ 不发这一发 |
| M4 | 超长阈值 `> MAX` 放宽成 `> MAX * 100` | app-host **failed=1** | 超长不发，且**上限从契约常量推导**（不写死 32） |
| M4b | 同一处放宽，但量的是 **web 那一端** | web `profile-panel` **failed=1** | 「超过 32 个码点 ⇒ 当场说清、并且不发请求」—— 证明这条在壳侧也有牙，不只是共享层自证 |
| M5 | 失败文案退回 `common.profile.avatar.failed` | web **failed=1** | 🔴 本轮查出的真缺陷：昵称失败不许说成头像；界面上不出现「头像」二字 |
| M6 | `ProfileScreen` 里把 `planDisplayNameWrite(` 改成不存在的符号 | mobile `profile-nickname-entry` **failed=1** | 读 / 判 / 写三个函数**都来自共享层**（负向那半：不许在壳里各写一遍） |
| M7 | 三态判定 `savedName === undefined` 退成 `=== null` | mobile **failed=2** | 还没读到 ⇒ 整行不出现；读到 `null` ⇒ 显示占位那句（两态合并会把"加载中"和"没昵称"说成同一句话） |
| M8 | 摘掉读取前面的 `privacyConsent.networkAllowed()` | mobile **failed=1** | 没同意出境 ⇒ **一个请求都不发**（闸门语义，不是"发出去再失败"） |
| M9 | 往本屏塞一个 `t('web.settings.profile.nickname.label')` | mobile **failed=1** | 本屏一个 `web.*` 键都不读 —— 🔴 这一支是那条**负向断言的阳性对照**：它证明"命中 0"来自扫描真跑到了那一段，不是正则空的 |
| M10 | 删掉 `en.ts` 里新增的那条英文键 | `pnpm --filter @heyta/i18n build` **exit=1**（非 vitest） | 中英键集对等**在类型层就红**（`satisfies Record<MessageKey, string>`），所以这条不需要运行时判据 |

现量复跑：`python3 /tmp/r15a-arms.py 0 11`（前提：`lsof -ti tcp:4318 tcp:4319` 为空，且没有别的会话在读 `packages/*/dist`）。

### R15b 的变异臂（逐支：改哪一行 → 红了哪几条 → 该红的是哪条结论）

> ⚠️ **标题原来写着「14 支」，本轮加了两支（M15a/M15b）之后就不写了** —— 那个数字本身
> 就是一条会漂的抄件，而它漂的原因恰恰是"又补了判据"这种好事。条数要现量（**带范围的**一条命令，
> 18:1x 读数 **16**；同一命令切到 R13 那张表 = **0**，所以它数的是这一张而不是整篇）：
> `awk '/^### R15b 的变异臂/,/^## 4\./' <本文件> | grep -c '^| [B-M][0-9a-z]'`

> 脚本 `python3 /tmp/r15b-arms.py <起> <止>`，打的同样是**活树上的原地变异**。三道自检都写在
> 脚本文件头，而且每一道都是这轮**实际踩过**才加的：
> ① **锚点门** —— 14 支的锚点逐一 `count == 1` 才开跑（本轮实测 14/14 命中 1 次）；
> ② **写盘门** —— 先在内存里 `encode()` 成功再落地（临时文件 + `os.replace`）。这一道是因为
> 上一轮我的一次 `open(path,'w')` **先截断、编码在后**，把一份 10 条判据的 spec 清成了空文件
> （§4 里 09:4x 那一行）；
> ③ **还原门** —— `finally` 里按字节还原并把文件读回来比对，不一致立刻退出 3。
> 🔴 B14 那支打完必须在还原后**再构建一次 i18n**（那次失败的 `build` 会把 `dist` 留在
> "dts 没写完"的形态，而下游判据读的就是 `dist`）—— 脚本里这条是硬编码的，读数：`exit=0`。
> 跑的这一趟在 **17:3x–17:4x（本机）**。臂后复绿凭据（不是"我记得红过"）：
> app-host **999 passed / 0 failed**、shared-schema **106 passed**、web 全量 **1562 passed \| 13 skipped / 0 failed**、
> mobile **586 passed**、八道门禁 rc=0，另加逐文件 needle 回查（`hosted-auth.ts` 的 `resolveAccountAvatarImage` = 3、
> `account-profile-contract.ts` 的 `avatarDataUri` = 2、`en.ts` 的 `avatar.uploaded` = 2、
> `ProfilePanel.tsx` = 9、`ProfileScreen.tsx` = 7）—— 证明 14 支一支都没在树上留下痕迹。

| 支 | 改的那一行 | 读数 | 该红的是 |
|---|---|---|---|
| B1 | `resolveAccountAvatarImage` 里摘掉 `avatarHash === null ⇒ absent` 的早退 | app-host `hosted-account-profile` **failed=2** | 服务端说"没有头像"时**一个请求都不发**（契约前提：`fetchAccountAvatar` 只在 `avatarHash !== null` 时调） |
| B2 | 摘掉 `no-password ⇒ needs-password` 那一支（并给 `unreadable`） | app-host **failed=2** | 「要先填一次端到端口令」与「暂时读不到」是**两句不同的话**、两种不同的用户动作 |
| B3 | 摘掉 `undecryptable ⇒ undecryptable`（并给 `unreadable`） | app-host **failed=1** | 口令不对要单独成句 —— 它决定的是"去补口令"，不是"过会儿再试" |
| B4 | `ready` 那支的 `dataUri` 改成空串 | app-host **failed=1** | `ready` 的字节形状就是契约那一枚（`data:<type>;base64,<b64>`） |
| B5 | `avatarInitialFromEmail` 的 `Array.from(...)[0]` 退回 `.charAt(0)` | shared-schema `account-avatar-plan` **failed=2** | emoji 邮箱给的是**整个码点**，不是半个孤立代理对（`AccountMenu` 那个方块就是这么来的） |
| B6 | `avatarDataUri` 的两处插值**拼反**（base64 当 MIME、MIME 当数据） | shared-schema **failed=1** | dataUri 的精确形状 + "互换两半必须不同"那条对照 |
| B7 | web 读失败句退回复用 `avatar.failed` | web `profile-panel` **failed=1** | `GET profile` 失败说的是「个人信息没读到」，界面上**不出现「头像」** |
| B8 | web 上传成功句改成复用 `nickname.saved` | web **failed=1** | 换完照片说的是头像那句（这是本轮查出的三处缺陷之一） |
| B9 | web 把非 `ready` 的解码状态一律渲染成 `absent` | web **failed=1** | 🔴 本轮最贵的一支：口令解不开时要说「解不开」，而不是沉默地显示"你还没有头像" —— 后者会让用户点「换一张」**把自己原来那张覆盖掉**，而服务端全程只回 2xx |
| B10 | mobile 的 hash 闸门从 `undefined \|\| null` 退回只判 `undefined` | mobile `profile-avatar-entry` **failed=1** | 服务端说没有 ⇒ 一个请求都不发（`null` 那一支正是"没有"） |
| B11 | mobile 上传成功句改成复用 `nickname.saved` | mobile **failed=1** | 成功句说的是头像 |
| B12 | mobile 把「这台设备读不了本机图片」折进 `avatar.failed` | mobile **failed=1** | `noChannel` 单独成句 —— 折进"上传失败"会让人**反复重拍**，而真相是等版本 |
| B13 | 给新增的头像段塞一个 `style={{ flexGrow: 1 }}` | mobile **failed=1** | 本屏新增 `style={{` 行数 **0**（`check:l4` 的 mobile 段基线 90 恰在 90，零余量） |
| B14 | 删掉 `en.ts` 里新增的 `common.profile.avatar.uploaded` | `pnpm --filter @heyta/i18n build` **exit=1**（非 vitest），还原后重建 **exit=0** | 中英键集对等**在类型层就红**（`satisfies Record<MessageKey, string>`），所以这条不需要运行时判据 |
| M15a | `uploadAccountAvatar` 的出站 body 从 `{ cipherBase64 }` 改成 `{ cipherBase64, contentType: image.contentType }`（= 把 `hosted-auth.ts:976-979` 记过的**第一版明文 `content_type` 设计加回去**） | app-host `hosted-account-profile` **failed=1**，🔴 而**其余 13 条全绿**（含"往返能解开""错口令解不开""原图不在里面"三条 E2EE 判据） | 服务端除了密文**不该再知道任何一件事**，包括这张图是 PNG 还是 JPEG —— 而这正是本轮查出来的**判据缺口**：那三条老判据对这个回归一律无声 |
| M15b | `encodeAvatarCipher` 的 `encrypt(JSON.stringify(image), password)` 换成 `Buffer.from(JSON.stringify(image)).toString('base64')`（明文载荷出门） | app-host **failed=5**（新那条 + 往返 + 错口令 + `ready` 的 dataUri 形状 + "五种来源给五种状态"），还原后 **failed=0** | 新判据的③（密文原始字节里 `contentType` / `image/` / `dataBase64` / 原图 base64 四枚 needle 一枚都不许有）**有牙**，且不是靠"base64 套 base64 天然不含子串"那种永真弱断言（该文件 168-181 行记过一次臂存活） |

🔴 **M15a 的读数是本轮最值钱的一行**：它证明"能通过的检查也可能没有牙齿"。
新判据 `packages/app-host/tests/hosted-account-profile.spec.ts` 的三段结构 = ① 出站 body 的键**恰好**
`['cipherBase64']` → ② **正向对照**（四枚 needle 在明文载荷 `JSON.stringify(IMAGE)` 里逐枚找得到，
否则③的"找不到"只是探针没跑到） → ③ 反向（用 `Buffer.includes` 而不是先 `toString('utf8')` 再比 ——
密文不是合法 UTF-8，解码会插替换字符、跨界那枚 needle 会被无声吃掉，那是假绿的方向）。
复跑：`python3 /tmp/e2ee-arms.py`（**不需要 4318/4319**：它只跑 app-host 单文件、原地变异
`packages/app-host/src/hosted-auth.ts`、按字节还原并比对 sha256。18:1x 读数已记上表，
还原后 app-host 全量 **48 文件 / 1000 passed / 0 failed**、typecheck **rc=0**）

现量复跑：`python3 /tmp/r15b-arms.py 0 14`（前提同上：4318/4319 为空、无人读 `packages/*/dist`；本轮 **17:4x 现量 4318 与 4319 各有 59 个 PID** ⇒ 这一条此刻只能由下一轮跑）。

---

### R16 的三支变异臂（jsdom 那一层；不需要端口）

> 脚本 `python3 /tmp/r16-arms.py`：锚点 `count == 1` 才开跑、encode-then-mkstemp 原子写、
> `finally` 逐字节还原并比 sha256（不一致直接 exit 3）。改的是 **`apps/web/src`**（宿主自己的
> 源码，vitest 直接读，不经过任何 `dist`）⇒ 不需要重建共享包产物，也就不会碰到别人正在读的
> `packages/*/dist`。18:2x 那一趟三支都 `还原 逐字节相同`。

| 支 | 改的那一行 | 读数 | 该红的是 |
|---|---|---|---|
| E1 | `useCalendarLabels.ts:72` `dayNoTimed: t('common.calendar.dayNoTimed')` ⇒ 指到 `t('web.calendar.dayEmpty')` | **failed=2**（中文那条逐字断言 + 英文那条整腿） | 「每块区域只说自己那一份」—— 轴空白那句被换成了整天空态那句，同屏两句互相打脸（R14 之后带里有任务是常态） |
| E2 | 同一行改成**中文字面量**（就是表里那条 zh 的句子，逐字相同） | 🔴 **failed=1，红的只有英文那条腿**；中文那条**全绿** | 「中英键集对等但值没换过去」那一类缺陷。**这就是本轮最值钱的一支**：它证明只有中文判据的套件对"界面把中文写死"是**结构性失明**的 —— `check:ui-language` 也失明（它只比键集）。要守住英文那一档，必须有一条**用英文跑**的判据 |
| E3 | `dayAllDay: t('common.calendar.dayAllDay')` ⇒ 写成中文字面量「全天」 | **failed=1**（英文腿），断言原文：**`expected '全天' to be 'All day'`** —— 红在②那枚「全天」带名字上（它在⑤"零中文残留"之前，所以 ⑤ 没轮到） | 同上，另一枚被写死的串 |
| 还原后复跑 | 全部拿掉 | **rc=0**（`13 passed / 0 failed`） | 判据回到绿，树上不留痕迹 |

⚠️ **原计划那支臂是坏的**（§2 那格原写"把 `dayNoTimed` 的**英文值**改掉一个词 ⇒ 那条必须红"）。
现在这套判据的期望串与界面**读的是同一本表**，所以改表 ⇒ 两边一起变 ⇒ **永远不红**。
那条臂能证明的只有"测试没有抄句子"，而它证不了任何产品结论 —— 真正的牙齿在**消费侧**
（组件写死 / 换错键），也就是上面 E1–E3。读数记在这里，原句留在 §2 旁边不删。

📌 我这份臂脚本自己的 `passed=` 计数在**绿的那趟**读成 `passed=1`：正则 `"(\d+) passed"`
先命中了汇总行里的 `Test Files  1 passed (1)`。红的那趟因为 `Tests  N failed | M passed`
在前，所以数对了。**退出码才是判据**（`rc=0/1` 两支都对得上），计数只是装饰 —— 与 §7 第 45、
163 条同一族（先怀疑探针，且探针的"好看字段"不参与裁决）。

### R17 的六支变异臂（逐支：改哪一行 → 红了哪几条 → 该红的是哪条结论）

> 🔴 载体：V1/V2/V3 改的是**源码**，V4/V4b 改的是**词条表**，而读 dist 的判据在 `@heyta/i18n` 那一侧
> ⇒ V4/V4b/V4c 每支都要重建一次（i18n 或 ui），跑完**立刻**还原并再重建。
> 三支"改表"的臂各跑了两趟（变异态 + 还原态）；**还原态那一趟的读数证明的不是"测试能红"，
> 是我没有把 dist 留在变异态**给后面的判据用（§7 第 27 条那一族）。

| 支 | 改的那一行 | 读数 | 该红的是 |
|---|---|---|---|
| V1 | `CALENDAR_VIEW_ORDER` 去掉 `'year'` | `packages/ui` 套件 **1 failed \| 12 passed**，红的只有「顺序表与键表的集合**互为子集**」（vitest diff 打印 `- "year"`）；还原 md5 `8f75fbd0…` 相等 | 「有哪些档」只有一份答案 —— 顺序表与键表谁多谁少都是两份在漂 |
| V2 | mobile 宿主补回 `const VIEW_OPTIONS = [{ kind, key }…]` | 🔴 **两端各红一条**：`apps/mobile` **1 failed \| 10 passed**（`calendar-view-entry.spec.ts:74` 的 `not.toMatch(/const VIEW_OPTIONS/)`）+ `apps/web` **1 failed \| 10 passed**（原文「`apps/mobile/src` 里 1 个文件写回了档位键：4 处: expected 4 to be +0」）；🔴 同一趟**正向对照腿保持绿**（共享层 ≥4 命中）⇒ 正则不是空的、扫描真跑到了那一段；还原 md5 `5b7e4855…` 相等 | 「档位清单被抄回宿主」—— 打的正是"修完又长回来"，而形状与内容两层同时守 |
| V3 | `CalendarViewKind` 加 `'quarter'` 而不给键名 | 🔴 **不是测试红，是编译红**：`pnpm --filter @heyta/ui typecheck` ⇒ `src/calendar/model.ts(180,14): error TS2741: Property 'quarter' is missing in type { month; week; day; year } but required in type 'Record<CalendarViewKind, CalendarViewLabelKey>'`，pnpm 打印 `Exit status 2`。⚠️ 我那行命令尾巴的 `exit=0` 是 `\| tail` 的退出码（§7 第 45 条那一族）⇒ 真实码只在看 pnpm 自己那一行 | 加一档忘配键名 ⇒ **写不出来**，而不是"年念成日"那一类静默错位 |
| V4 | `en.ts` 的 `'common.calendar.view.year'` 值改成 `'年'`（与 zh 逐字相同）+ 重建 i18n | `apps/web` tabs **1 failed \| 10 passed**，原文「`common.calendar.view.year` 的英文值里出现汉字（英文表抄了中文）: expected '年' not to match /[㐀-鿿]/u」；🔴 **同趟 `pnpm check:ui-language` rc=1**，点名「文案：common.calendar.view.year = 年」⇒ **我原来给这条腿写的理由（「门禁只比键集」）被这支臂当场否证**；还原+重建后套件 **11 passed**、门禁 rc=0、md5 `9addd82b…` 相等 | 值层语言方向 —— 结论改写成：**这条腿在这一维是第二层**，不是唯一层 |
| V4b | 反方向：`zh-CN.ts` 那条值改成 `'Year'` + 重建 | 门禁 rc=1「zh-CN 词条里没有汉字 —— 很可能是拿别的语言占位」**且**套件 1 failed（「中文值里没有汉字」那条腿）；还原+重建后门禁 rc=0、md5 `8f362719…` 相等 | 同上另一侧 —— 两个方向门禁都管，所以这条腿的定位是**第二层** |
| V4c | 给 `CalendarViewLabelKey` 联合**添一条两本表里都不存在的键** `'…view.yaar'` 并把 `year` 指过去 + 重建 ui | 🔴 **`check:ui-language` rc=0（真的看不见）**，红的只有判据：web tabs **2 failed**（「逐档比」与「双语值」两条腿）+ `packages/ui` **1 failed**（「`key === common.calendar.view.${kind}`」那条，原文 `expected 'common.calendar.view.yaar' to be 'common.calendar.view.year'`）。另一条事实：`translate()` 对缺键是**抛** `[@heyta/i18n] 词条不存在：zh-CN / common.calendar.view.yaar`（`node -e` 直接量到），**不是把键名原样返回**；还原+重建后 ui 套件 **13 passed** | 🔴 这才是这条腿**唯一的独立维度**：代码引用的键名 ↔ 词条表 的耦合，编译期（共享层不许 import i18n）、门禁（只比两本表之间）、类型层（`Record<MessageKey,…>` 只在 i18n 内部）三层**都不守** |
| V5 | 宿主源码写死中文：`apps/web/src/features/calendar/useCalendarLabels.ts:72` ⇒ 换成与 zh 表**逐字相同**的那句中文（只改宿主源码，不碰任何 dist） | 🔴 **`check:ui-language` rc=0** —— 尽管它自己的汇总行印着「已迁移：apps/web/src、…」（这一支的载体是 vitest **不读**的那一侧，所以红不红与判据无关，量的纯粹是门禁的覆盖面）；还原 md5 `06781739…` 相等 | R16 那节 E2/E3 的结论「只有英文腿会红」**成立**，但它附的理由错了：门禁看不见的是**源码写死**与**键名不存在**，值层它管 |

## 3·补 22:4x 新会话接手：§5 第 1 步体检的现量读数（含两处对交接的更正）

> 载体：新会话（接手交接稿那条线）。本节目的**只写读数**，按 §0「写读数不写结论」。
> 每条都带可复跑命令；引用前先复跑 —— 共享工作树里别人一直在提交。

**① 体检本身（§5 第 1 步，两趟）**

- `NO_COLOR=1 node scripts/dist-freshness.mjs` ⇒ 14 个包里**只有 `i18n` 的运行时产物比自己的源码旧 115s**（`src/locales/zh-CN.ts` 22:16:32 vs `dist/index.js` 22:14:37），其余 13 个包的产物都比源码新。
- 收范围那一趟：`node scripts/dist-freshness.mjs --only ui,domain,i18n,app-host,shared-schema,storage,op-log,sync-client` ⇒ 8 个包里同样只有 `i18n` 落后。范围是按"**H 那条判据真的消费了谁**"取的（脚本文件头写的就是这条理由），不是按目录列表。
- 交接 §3 那行 21:1x 记的三个落后包（`app-host` 444s / `domain` 157s / `ui` 2718s）**此刻已全部追平**（14s / 13s / 2s）—— 印证了那行自己写的"这张表本身就在漂"。

**② `i18n` 那 115s 落后到底影不影响 H —— 量的是值层，不是"键名在不在 dist 里"**

交接 §4 H 留了一句"不要用 dist 里 grep 到键名当新鲜度判据"，这里按那句话的正解做了一次全量值对照（`/tmp/ht-i18n-value-sweep.mjs`，只读）：

- `src/locales/zh-CN.ts` 顶层键 **2858** 个，`translate('zh-CN', key)` 对 **2858 个全部解得出**（缺失 0）。
- 值层不一致**只有 1 处**：`site.docs.reminders.s2p3` —— src 是"Android 与 iOS 都使用系统本地通知中心…"，dist 还是旧的"目前**没有接入系统本地通知**…"。那是**落地页文档文案**、由 W9 提醒投递那条线改的，**不在本线任何判据的断言路径上**。
- 四档标签 src/dist 逐字相同（`common.calendar.view.aria/month/week/day/year` = 视图/月/周/日/年）。
- 🔴 **旧键名 `web.calendar.view.month|week|aria` 与 `web.settings.profile.title` 在 dist 里已经解不出** ⇒ 22:14:37 那次构建发生在**本线 rename 之后**，dist 是 rename 后的那一版。这一条把"落后 115s 会不会让 H 读到 rename 前的表"这个担心直接关掉。
- 两次阳性对照都在同一趟里：垃圾键 `zzz.definitely.not.a.key` 确实解不出（否则"缺失 0"是假绿），构造的一对不相等值确实命中 1（否则"值不一致 1"是假绿）。

⇒ 结论口径：**H 可以在这份 dist 上跑，期望串（读 src）与渲染（读 dist）在四档上没有分叉**。"落后"这件事的实质只是别人那一行落地页文案没进产物，与本题无关。

**③ H 那条**从没跑过**的 spec，静态可运行性预验（不需要端口、零写盘）**

动机是 `e2e/tests/helpers.ts:352` 那段注释自己写着的事实：**Playwright 走 esbuild，只转译、不做类型检查** ⇒ `--list` 绿不保证调用形状对。

- `cd e2e && npx playwright test tests/calendar-view-options.spec.ts --list` ⇒ **Total: 2 tests in 1 file**（在收集范围内，与那条 `_probe` 的 0 命中是反面对照）。
- testID 逐条在源码里：`calendar-view-select` = `apps/web/src/features/calendar/CalendarHeaderToolbar.tsx:123`；`calendar-board-year*` = `packages/ui/src/calendar/CalendarYearBoard.tsx`；`calendar-board-day` = `packages/ui/src/calendar/CalendarDayBoard.tsx`。
- 调用形状：`openApp(page, APP_ZH)` 对 `openApp(page, path='/', consent='local-only')`；`switchView(page, '日历')` 里 `'日历'` 确实在 label 联合的第 2 项，且同一形状已被 `calendar-day.spec.ts:77`、`calendar-year.spec.ts:103`、`motivation.spec.ts:234` 三条在跑的 spec 用过。
- 三段"从真源现读"用同一个正则离线复刻：`CALENDAR_VIEW_ORDER` ⇒ `[month,week,day,year]`；`CALENDAR_VIEW_LABEL_KEYS` ⇒ 四档各指对键；`MONTHS_PER_YEAR` ⇒ 12。spec 里那句"两个集合对不上就 throw"自带对照。
- 宿主侧没有重新长出第二张档位表：`CalendarHeaderToolbar.tsx` 里 `VIEW_LABEL` 形状的本地常量 **0 处**（R17 的重复没回流）。

**④ 🔴 我自己的探针第一版是坏的（记下来防它被当成产品读数）**

上面③那三段复刻，我第一版给 `CALENDAR_VIEW_LABEL_KEYS` 写的正则是 `^(\w+|\w+:\s*)['"]?…` 这种带空捕获组的交替，结果把键名解析成 `{h,k,y,r}` —— **红的是我的探针，不是 spec**。spec 自己用的是 `/(\w+):\s*'([^']+)'/g`，逐对读是真源。这是 AGENTS §7 元规则第 1 条（先怀疑探针）在本轮的第六次命中，也是"照着交接复现时，先把交接里那条命令和自造命令分开"的又一个例子。

**⑤ ⚠️ 更正交接里两处现场读数（都是"当时对、现在漂"，不是写错）**

- 交接 §3 那行「`adb devices` 列表是空的 = 模拟器根本没起」到 22:4x **不再成立**：`emulator-5554 device` 已 attach，`qemu-system-aarch64-headless` 在跑（pid 36840）。C 那条的阻塞性质从"载体不存在"变回"载体在、但被正在打 Android 包的那一侧占着"（同趟 `clang` NDK 工具链 98.7% CPU、两枚 node 153%/134%）。两枚 iOS 模拟器 Booted：`heyta-ios-isolated` 与 `iPhone Duo heyta` —— B 那条重装要用的 `heyta-iphone-17pro` **不在此列**，引用前用 `xcrun simctl list devices booted` 现取。
- 交接把"会 SIGKILL 别人的 dev server"整条挂在 `check:ai-e2e` 上，本轮第一次指到行：**kill 在 `scripts/check-ai-e2e-preflight.mjs:83`**（`process.kill(Number(pid), 'SIGKILL')`，文件里第 18 行还专门写了一段"为什么敢 kill"）。`e2e/playwright.config.ts` 与 `e2e/tests/helpers.ts` 里 kill/pkill **0 处**，且 4318 的 vite 是 `reuseExistingServer: false` + `--strictPort`。⚠️ 由此**不能**推出"直接 `npx playwright test` 一定不伤人"—— 端口被占时那份配置具体怎么失败**本轮未实测**，写成待验证；§4 H prescribed 的跑法照做即可，但开工判据（端口空 + 负载个位）一条都不许省。

## 3·补 ⑥ 我差点写进交接的一条**假纠正**（记形状，不记结论）

C 的判据 testID `task-due-time-input` / `task-due-time-all-day`，我按字面串全仓 grep ⇒ **0 命中**，
于是准备写"交接 §4 C 写的 testID 根本不存在"。**那句话是错的**，错在探针形状：

- 真源是拼装出来的：`packages/ui/src/date-picker/DatePicker.tsx:337` 的
  `testID={`${testID ?? 'date-picker'}-time-input`}`、`:361` 的 `…-time-all-day`，
  而宿主在 `apps/mobile/src/screens/TaskDetailSheet.tsx:709` 传的是 `testID="task-due"`
  （那里 705-709 的注释正是在解释"为什么不传前缀会让两张 DatePicker 派生出同一个 testID"）。
- ⇒ 设备上真实存在的标识 = `task-due` + `-time-input` = 交接写的那个串。**交接没错，我的 grep 方法不能用于拼装值。**

可迁移的那条：**判"某个 testID/键名/串不存在"之前，要先问这个值是"字面写在某处"还是"由前缀拼出来的"** ——
和 §7 里"needle 0 命中先查属性住在哪"是同一条规矩的又一副面目。这一条留着，是因为
按字面 grep 得到的假阴性会让人**主动把正确的交接改错**，比不改更贵。

## 3·补 ⑦ 🔴 B（四端重装）的前置在交接里**写少了**，现量证据在 22:5x

交接 §4 B 写的前置只有两条（`packages/op-log` 干净 + `@heyta/op-log build` exit 0）。
但 `reinstall:all` 打的是**工作树**，而 22:5x 现量到工作树里别人未提交的源码远不止 op-log：

- `git status --porcelain apps/mobile` ⇒ **19 个文件 `M`**，含 `src/screens/ProfileScreen.tsx`（+404/−3）、
  `SettingsScreen.tsx`、`metro.config.js`、`AndroidManifest.xml`、`MainActivity.kt`、`AppDelegate.swift`、`project.pbxproj`；
  其中 `VaultSettingsSection.tsx` mtime **22:50:01**、`SettingsScreen.tsx`/`ProfileScreen.tsx` **22:49:49**
  ⇒ **vault 那条线一分钟前还在写移动壳**（不是历史遗留的脏文件，是正在写的活）。
- `packages/i18n/src/locales/{zh-CN,en}.ts` 两份都在别人手里（+258/−74）。
- `packages/ui/src` 与 `packages/storage` 等同理 ⇒ 此刻 `pnpm -r build` 出来的 `dist` 是**别人 WIP 的产物**。

⇒ 按 AGENTS §6.1.1 的不变量（"四端都装上了**当前源码**的产物"）和 §7 第 82 条那一族，
B 的真实前置应当是 **整仓没有别人未提交的源码**，而不是只看 op-log 那一个包。
⚠️ 这不是"装了旧树"（第 82 条那一版），也不是"包里没打 web-dist"（第 80 条那一版），
是**第三种**：**装进去的是别人写到一半的树** —— 症状同样是"四端全绿"，因为它确实装上了、起来了、非空白、还带主蓝。

**B/C 的开工判据（本线采用，比交接原来那条严）**：
`git status --porcelain packages apps/mobile apps/web` 里**没有不属于本线的 `M`**，
且 `pgrep -fl "verify-mobile"` 为空，且 canonical 负载门过（`scripts/lib/wait-for-quiet-host.sh`，阈值 `hw.ncpu×3/4`）。
现量（22:5x）：`pgrep` 命中 **2 条活的移动端提醒验收**（`scripts/.verify-mobile-ios-reminder.sh.snap.40852`、
`.verify-mobile-reminder-ring.sh.snap.50463`，属 W9 那条线）⇒ **C 此刻按 AGENTS §8.9 不许碰设备**。

## 3·补 ⑧ H 的**第一次真跑**（22:52:16 窗口）：一条过、一条红，红的是 spec 自己的选择器

窗口是怎么等的（读数照抄看守日志 `/tmp/ht-h-run.log`）：
`负载 14 > 12 等 30s → 12 ≤ 12 但 12 > 9 再等 → 10 > 9 再等 → 9 ⇒ 22:52:16 开跑`，
同刻 `4318 行=0 / 4319 行=0 / 阳性对照行=2`。
🔴 这里刻意**两层门分开**：canonical `wait_for_quiet_host` 的阈值是 `hw.ncpu×3/4 = 12`，
而本线 §5 要"落回个位"是更严的那一层 —— 只过 canonical 不开跑（那三次 `12 > 9`、`10 > 9` 就是它挡下来的）。

结果：`1 passed (2.1s) / 1 failed (16.6s) / RUN_RC=1`。

- ✅ **① 档位下拉里画的就是共享那份表** 过了，并出图 `view-select-closed.png`（md5 `f096b90d…`）。
  这条是 R17 真正要的那张：顺序/键/词条文本三样都从真源现读，浏览器里对上了。
- 🔴 ** 四档都点得动** 红在 `spec.ts:189`：
  `expect(locator('[data-testid="calendar-board-year-month-"][role="button"]')).toHaveCount(12)` ⇒ **Received: 0**（34 次轮询全 0）。

**根因是那条 spec 自己写坏了，不是产品**：月卡的 testID 是**拼出来的**
（`packages/ui/src/calendar/CalendarYearBoard.tsx:327,338` 的 `${testID}-month-${suffix}`，`suffix` = `YYYY-MM`，
宿主把 `testID` 传成 `calendar-board-year`）⇒ 真名是 `calendar-board-year-month-2026-10`，
而选择器写成 `[data-testid="…-month-"]` 是**精确等值**，永远匹配不到任何东西。
修：改成前缀 `^=` 并保留 `[role="button"]`（只有外层 `Pressable` 带 `accessibilityRole="button"`，见同文件 335-339）。

**并且把"这一维是不是承重的"写成判据本身**（不是注释）：新增一条对照断言
`[data-testid^="calendar-board-year-month-"]`（**不带** role）的数量 **必须 > 12** ——
同前缀的 `-body` / `-title` / `-weekdays` / `-week-N` 都在里面。
少了这条，把选择器写宽也一样绿；有了它，"数到 12"只能是被 `role=button` 筛出来的。

 **这一支给 §5 第 1 步补了一条边界**：上面 ③ 那套静态预验（`--list` 收集 / testID 在源码 / 调用形状 /
真源正则离线复刻）**全过**，却**挡不住选择器语义** —— `=` 与 `^=` 在源码里长得一样，只有真浏览器会告诉你差一个字符。
所以"§5 第 1 步 + 静态预验"是**降低**白跑概率，不是**免检**；§6.2 规定一那句"必须真跑"仍然不能被任何静态东西替代。

⚠️ 复跑读数在下面 ⑨（同一趟里补，别引用这一节里的"修完就绿"）。

## 3·补 ⑧·附 待入 `docs/reference/environment-traps.md` 的两条（本会话**不**直接追加共享台账）

为什么不现在写进 traps：22:58 现量 `git status --porcelain docs/reference/environment-traps.md` = **`M`**、
mtime **22:20:05**、**4695 行** —— 它正被并行会话写着。往一个别人正在整片改的文件里追加，
最可能的结果要么是被他们那笔覆盖，要么是我替他们把未提交内容一起带走（本机今天实测过这个形状）。
所以下面是**可直接粘贴的正文 + 目标编号**，谁接手谁一次搬两条。

现量编号（引用前重跑）：`grep -oE '^[0-9]+\. ' docs/reference/environment-traps.md | tr -d '. ' | sort -n | tail -1` ⇒ **189**，
而 `grep -cE '^[0-9]+\. ' …` ⇒ **198** —— 🔴 **行数比最大号多 9**，说明号段里有重复号。
所以"traps 已经写到 #N"这种宣布**必须同时报两个数**（最大号 + 行数），只报一个都会误导下一个人；
这一条本身也值得并进去（与 `BLOCKED.md` 那条"读两份再宣布 B 号到 N"同族）。

**待入 #190 🔴 判"某个 testID / 键名 / 串不存在"之前，先问这个值是字面写的还是拼出来的。**
`apps/mobile` 与全仓 grep 字面串 `task-due-time-input` ⇒ **0 命中**，据此几乎写进交接一句
"§4 C 的判据 testID 根本不存在"。真相是 `packages/ui/src/date-picker/DatePicker.tsx:337,361` 用
`` testID={`${testID ?? 'date-picker'}-time-input`} ``拼装，宿主 `TaskDetailSheet.tsx:709` 传 `testID="task-due"`
⇒ 设备上那个标识**确实叫** `task-due-time-input`。
🔴 这类假阴性的代价不是"少一条证据"，是**把写对了的交接改成错的**。
配方：值可能由前缀+后缀拼出来时，判"不存在"要**同时**读被调方那一行的模板，或干脆在真载体上打印一次实际值。
同族：`CalendarYearBoard.tsx:327,338` 的月卡 testID 也是拼的（见 ⑧）。

**待入 #191 🔴 静态预验能挡"形状"，挡不住"选择器语义"——`[data-testid="x"]` 与 `[data-testid^="x"]` 在源码里长得几乎一样。**
③ 那一整套预验（`--list` 收集 / testID 在源码里存在 / helper 调用形状 / 三段真源正则离线复刻）**全过**，
第一次真跑仍然红在 `Received: 0`（⑧）。
所以 §6.2 规定一那句"必须真跑真浏览器 + 人看图"**不能**被任何静态清单替代；
反过来也成立：真跑之前做静态预验仍然划算，它把"白烧一个难得的载体窗口"的概率从"形状类错误"上摘掉了，
只是**别把"预验全过"读成"这一趟会绿"**。

⚠️ **00:3x：上面两条预留的号（#190/#191）已经被别人占了** ——
现量 `grep -oE '^[0-9]+\.' docs/reference/environment-traps.md | sort -n | tail -1` = **190**，
而那一号写的是 Xcode 27.1 / idb companion 的 socket 失败（回收站/提醒那条线）。
⇒ 编号**不预约**：贴入时按当时现量最大号往后排。下面这批同样按那条命令现取。

**待入 🔴 带 `--only` / `--filter` / 白名单的参数如果匹配不上，必须响亮失败；否则"范围缩成零"会打印成"全部通过"并退 0。**
00:1x 实测命中我自己本轮的第 1 步：`dist-freshness.mjs --only @heyta/ui,…`（正确形状是目录名 `ui`）
五个名字一个都没命中 ⇒ 输出 `0 个包` + `落后于源码的产物：0 个（⇒ 本机判据读的都是当前产物）` + **rc=0**。
那句话随后被我引用进了两份文档。
形状：**空测量的输出与"检查通过"长得一模一样**（traps 里已有这一族的通用句，这是它在**参数解析层**的面目 ——
不是判据坏了，是判据一条都没跑）。
配套修法（已落在 `scripts/dist-freshness.mjs`）：两种写法都认（目录名 + `@heyta/<目录名>`），
匹配不上 ⇒ exit 1 并打印可选清单，表头加"请求 N / 命中 N"这个前提断言。
同族：`for f in $FILES` 在 zsh 里不做词分割 ⇒ 循环只跑一次、把 27 个名字当一个字符串，
报出"未跟踪 1 / 脏 0"。同一趟里第二次拿到假读数，症状都是**数字少得离谱却没有任何东西失败**。

**待入 🔴 linked worktree 之间软链 `node_modules`，会让 workspace 包解析到**另一个树**的源码 —— "在 X 检出里打包"实际打的是 Y 的代码。**
00:3x 实测：`heyta-wt-verify-integration/node_modules -> …/heyta-wt-ai-closeout/node_modules`，
而 pnpm 的 workspace 链接是**相对**路径（`linkWorkspacePackages: true`）⇒ `@heyta/*` 落到**链接所有者那棵树**。
对本线要做的 B/C（"从干净检出打包，只含已提交代码"）这是**归属上的静默失效**：
产物里混的是另一个 SHA 的源码，而所有判据照样绿（§7 第 82 条一族）。
⇒ 载体必须真跑 `pnpm install`，**不许软链 node_modules**。
验收配方（**这条已实测**，另一种写法实测不可用）：
```bash
node -e 'const p=require("path"),fs=require("fs");
console.log(fs.realpathSync(p.resolve("apps/mobile/node_modules/@heyta/ui")))'
```
打出的路径必须落在**这棵检出**里。
00:4x 在 `heyta-wt-verify-integration` 跑出的正是失效形态：
`…/heyta-wt-verify-integration/apps/mobile/node_modules/@heyta/ui` ⇒
realpath = **`…/heyta-wt-ai-closeout/packages/ui`**（另一棵树）。
⚠️ 不要用 `require.resolve("@heyta/ui")`：主检出里它当场报错（该包 `package.json` 无 `main`，
只有 `exports`，CJS 解析够不着）—— **配方要按"链接真实存在的位置"验，不按解析器能不能解析验**。
根因是 `pnpm-workspace.yaml` 的 `linkWorkspacePackages: true` 造的是**相对**软链
（`apps/mobile/node_modules/@heyta/ui -> ../../../../packages/ui`），软链一跨树，相对路径就跟过去了。

**待入 🔴 "仓库里有没有"这道判据如果读 `git ls-files`，它读的是**索引**——别人一次 `git add` 就能让一处死链判绿。**
`check:docs` 的那半句原文是"本机有、仓库里没有 ⇒ 它们在**干净检出（CI 的唯一形态）**上是死链"，
实现用 `git ls-files`（`research/tools/docs-link-check.mjs:119`）。
00:38→00:41 实测到一整段假闭合：四枚 `apps/web/evidence/vault-panel/pg-*.png` 从红里消失，
而 HEAD 一个提交都没多（`f6478fad` 仍是 HEAD），逐枚复核 `git ls-files` 命中 4 / **`git ls-tree HEAD` 命中 0**
—— 只是被 `git add` 进了索引。
⇒ 判据要问"CI 上会不会死"，集合必须取 `git ls-tree -r HEAD`（或 `git show HEAD:<路径>`）；
⇒ 引用任何"N 枚已在 HEAD"的读数，要写明它是 ls-files 还是 ls-tree（本线那 19 枚两种都取过，**19/19 一致**）。
同族：AGENTS 记忆里那条"裸 `git commit` 吞掉别人 109 枚暂存"是同一件事的**写侧**，这条是**读侧**。

## 3·补 ⑦·附 C 开工前必须先知道的三件事实（22:5x–23:0x 现量，每件带命令）

**其一 🔴 仓里**没有**覆盖"时刻那一腿"的移动端验收脚本 —— C 的交付物是一条新脚本，不是跑一条现成的。**
⚠️ **23:5x 原地更正：这句已被现量否证** —— `scripts/verify-mobile-due-time.sh` 已写出并登记进
`check-script-snapshot.mjs` 的 MANIFEST（见 §3·补 ⑩ 与 ⑫），C 的交付物因此**不再是脚本**，
只剩"跑它的前置"。原句留着，因为它当时是真的、且它解释了新脚本为什么会存在。
`ls scripts/ | grep -c '^verify-mobile'` = **26** 条，而
`grep -rln "task-due-time\|due-time" scripts/` = **0 个文件**（这条 0 命中是"字面串在脚本里没出现"，
配合上一条"26 条按功能命名"才构成"没有这一腿"的证据；单靠 0 命中不算，见 ⑥）。
`verify:mobile-edit` 实际指向 `scripts/verify-mobile-task-edit.sh`（`grep '"verify:mobile-edit"' package.json`），
它是交接说的"四层形状"的样板，**不是**时刻那一腿。

**其二 🔴 新脚本不是"写个 .sh"就完了**：`scripts/check-script-snapshot.mjs` 的文件头写明
所有长跑 `verify-*.sh` 必须在**前 15 行**自带自快照 bootstrap（case 守卫 + `exec bash "$_snap"` + trap 清理），
并把文件名加进它的 `MANIFEST`。理由是真事故（traps #110/#113）：bash 按字节偏移增量读脚本，
一份正在跑的长脚本被编辑，后半段从错位字节开始解析 ⇒ 报**假语法错误**（2026-10-02 实测 `line 1610`）。
⚠️ 而 `MANIFEST` 那个文件此刻是 **`M`**（`git status --porcelain scripts/check-script-snapshot.mjs`），
本会话不往别人正在改的文件里加行 ⇒ **登记为待办**：脚本落地后补 `MANIFEST` 一行，
补完用 `node scripts/check-script-snapshot.mjs; echo rc=$?` 确认 rc=0。
（该门禁**不查漏登记**，所以漏了不会红 —— 这正是它必须写进文档而不能靠门禁的原因。）

**其三 🔴 B 现在跑的是别人写到一半的脚本**：`scripts/reinstall-all.sh` 本身在 `git status` 里是 **`M`**。
交接 §4 B 的前置只看了 `packages/op-log`，没看**被执行的脚本自己**干不干净 ——
这是同一类缺口的又一副面目（判据只查输入、不查载体）。⇒ B 的开工判据再加一条：
`git status --porcelain scripts/reinstall-all.sh scripts/verify-mobile-*.sh` 为空。
现量（23:03）：`scripts/` 下 **7 个 `M` + 11 个 `??`**。
`M` 的七枚逐枚列出，因为其中三枚直接卡住本线的 B/C：
`reinstall-all.sh`（B 的**载体**）、`check-script-snapshot.mjs`（新 verify 脚本要改的 MANIFEST 宿主）、
`verify-mobile-reminder-ring.sh`（同目录并发验收），另有
`check-ui-language.mjs`、`check-shell-unicode-vars.mjs`、`mutate-closeout-gates.sh`、`tools/ios-ax-shim.py`。

## 3·补 ⑧·附三 🔴 A 那份 `git add` 清单**漏了 18 枚判据文件**（23:04 现量）

交接 §4 A 的清单是「三份文档 + 两条脚本 + 四个证据目录」。但本线**判据本身**大多还没进过仓库：

- `git ls-files e2e/tests | grep -c '\.spec\.ts$'` = **40**（⇒ `e2e/tests` 是正常受版本控制的目录，
  且 `git check-ignore e2e/tests/calendar-view-options.spec.ts` rc=1 ⇒ 没被忽略），
  而 `calendar-day.spec.ts`、`calendar-year.spec.ts`、`calendar-day-en.spec.ts`、
  `calendar-view-options.spec.ts`、`profile-avatar-e2ee.spec.ts` **五枚都是 `??`**。
- 测试目录同理：`apps/mobile/tests/{task-due-time, profile-nickname-entry, profile-avatar-entry, calendar-view-entry}.spec.ts`、
  `apps/web/tests/{calendar-day-view, calendar-drag-day, calendar-view-tabs, calendar-year-board}.spec.tsx`、
  `packages/ui/tests/{calendar-year-model, calendar-day-buckets}.spec.ts`、
  `packages/domain/tests/date-year.spec.ts` = **11 枚 `??`**。
- 加探针两件：`e2e/_probe/probe-reload-crash.spec.ts`、`e2e/playwright.probe.config.ts` = **2 枚**。
- **不归本线**的一枚要挑出来，别顺手带走：`e2e/tests/vault-settings.spec.ts`（vault 那条线）。

合计 **18 枚本线判据文件不在仓库里**。

🔴 为什么这条比"少一个文件"严重：**照原来那份清单执行 `git add`，会得到"描述判据的文档已入库、被描述的判据还在工作树外"**。
而这一档**恰好没有门禁守** —— 但我第一版把理由写错了，写成了"`check:docs` 不查文件在不在 HEAD"。
⚠️ **那句是错的，23:17 实测否证**（读 `research/tools/docs-link-check.mjs:9-11` 与 `:507`：它有两支，
第二支专门判"**本机有、仓库里没有**"，理由是"干净检出 = CI 的唯一形态"）。现量：
`node research/tools/docs-link-check.mjs` rc=1，**31 处红里 31 处都是"未跟踪"那一半、死链 0**，
其中指向本线三份文档的 **13 处**（与 §4 A 记的那个 13 是同一批）。

⇒ 真正的边界比"门禁不管"更窄、也更有意思：**`check:docs` 只把 markdown 链接当链接**。
那 18 枚判据文件在文档里是以 `` `apps/web/tests/calendar-view-tabs.spec.tsx` `` 这种**反引号路径**提到的，
不是 `[文字](路径)` —— 所以它们落在 `TRACKED` 那一支的**射程之外**。
📌 这就是 §6 死路 12 那条配方（"判据的存在理由里凡提到别的门禁的覆盖面，那一句本身就是一支臂"）**当场又生效一次**：
我抄了交接里那句关于门禁覆盖面的断言、没喂臂，结果把**一个比现实更弱的描述**写进了两份文件。

**由此得出一条候选判据 —— 但它的分母我第一版选错了，23:21 实测否证**：
⚠️ 本节第一版写的是"扫文档里反引号包裹的 spec 路径，今晚应当**恰好红在这 18 枚**上"。**那句是错的**，
而且错法很典型：我拿一个**没跑过的推断**去替换另一个**没验的断言**。实测（`comm -23` 集合差，
先把 `git ls-files` 落盘再比，避免 `while read` 循环里 git 吃 stdin 那个坑 —— 我第一版就是这么得到假 0 的）：

- 三份文档里反引号提到的 `*.spec.ts(x)` 共 **58** 条，其中**带路径形状**的 39 条、裸文件名 19 条（裸名无法定位，必须排除）。
- 带路径且**未入库**的 **24** 条；按本线关键字（`calendar|due-time|profile|date-year|probe`）筛出 **16** 条。
- 🔴 这 16 条**不等于**上面那 18 枚：它**漏了** `apps/mobile/tests/profile-avatar-entry.spec.ts` 与
  `apps/web/tests/calendar-drag-day.spec.tsx`（文档提到它们时没写成路径），又**多算了**
  `tests/calendar-view-step.spec.ts`（文档里那串路径本身写得不完整，真身 `packages/ui/tests/calendar-view-step.spec.ts` 是已跟踪的）。

⇒ 结论要改口：**"把 `check:docs` 的 `TRACKED` 那一支搬到 code 引用上"这道候选门禁，分母是"文档引用了什么"，
不是"本线产出了什么"** —— 它会漏掉没被按路径引用的判据，所以**不能**当成"判据都入库了"的证据。
真正有牙的形状应当是**从仓库侧枚举**：`git status --porcelain -uall <本线的测试目录>` 逐条点名，
也就是 §4 A 那份清单本身；门禁能做的最多是"清单里的路径每一条都在 `git ls-files` 里"。
现量命令（两条都要跑，它们的差集就是"文档承诺 vs 仓库现实"）：

```bash
git status --porcelain -uall apps/mobile/tests apps/web/tests packages/ui/tests packages/domain/tests e2e/tests e2e/_probe | grep '^??'
git ls-files apps/web/tests/calendar-view-tabs.spec.tsx   # 空 = 没入库
```
⚠️ 本会话不建这道门禁：`scripts/` 里多枚门禁脚本正被别人 `M` 着，而且按 §0.5 固定动作，新门禁要先登记再实现。

可重跑的枚举命令（引用前重跑，别抄本节的数）：

```bash
git status --porcelain -uall e2e/tests e2e/_probe e2e/playwright.probe.config.ts \
  apps/mobile/tests apps/web/tests packages/ui/tests packages/domain/tests \
  | grep '^??' | grep -E 'calendar|due-time|profile-(nickname|avatar)|date-year|probe'
```

⚠️ 本会话仍不执行 `git add`（明令未解除）。**闭合动作 = 有提交权的那一轮把上面 18 枚并进 §4 A 那份清单**，
并保留"逐条点名、不用 `-A`/`.`"这条纪律 —— 因为同一批目录里还有别人的 `M`（如 `e2e/tests/calendar-week.spec.ts`、
`apps/web/tests/calendar-view.spec.tsx`），glob 会把它们的未提交改动一起暂存。

## 3·补 ⑧·附四 「行数」格子待回写（`docs/plans/README.md` 此刻是 `M`，所以不在本会话改）

§6 第 11 条那条纪律（改完交接物最后一步回写 README 的行数列）本会话**执行不了**：
`git status --porcelain docs/plans/README.md` = **`M`**、mtime **22:34:43** —— 它正被并行会话改，
而本机今天已经实测过"我在他们正在整文件提交的文件里改一行，结果被他们那笔覆盖"。
与 traps 那条同一个处置：**不追加、改登记**，把现量值留在这里。

23:14 现量（`wc -l`）：

- `docs/plans/calendar-year-time-and-mobile-profile.md` = **660**
- `docs/plans/calendar-profile-handoff.md` = **402**（README 那一格现在写着 **315**，差 87）
- `docs/plans/calendar-profile-reflection.md` = **45**（与 README 一致）

闭合命令（等 README 干净之后，且**在这三份文档都改完的最后一步**再取数）：
`wc -l docs/plans/calendar-year-time-and-mobile-profile.md docs/plans/calendar-profile-handoff.md docs/plans/calendar-profile-reflection.md`
→ 把三个数写进 `docs/plans/README.md` 第 21 / 45 / 46 行的那一列。
🔴 这条纪律本身也值得记一句，而且这次是**量过**的（原来那句"仓里没有门禁守行数"是从交接抄的，没验）：
`grep -rln "行数" scripts/*.mjs scripts/*.sh` 命中 **13 个文件**，逐个看过上下文，
它们拿"行数"说的是**别的单位** —— `check-l4-no-style.mjs:133` 是内联样式棘轮的上限单位、
`check-native-bare-values.mjs:92` 与 `check-l4-no-style.mjs:264` 是"剥注释时保留行号"、
`check-ui-language.mjs:563` 是"解析到的条数 == 像词条的行数"、`check-row-single-source.mjs:16` 是"净行数下降"这个反例论证。
**没有一条把 `docs/plans/README.md` 那一格与实际 `wc -l` 相对账**。
唯一提到 `docs/plans/README` 的门禁脚本是 `check-md-table-rows.mjs`，而它守的是表格列数，
且 README **刻意不在它的清单里**（原因见交接 §4.1：那张表第 17 行是一枚错位行，先修行再加门）。
⇒ 所以"行数"是一个**纯靠人执行的抄件** —— 这就是它每半小时漂一次的原因，也是本节为什么把现量值留在本文件、
而不是只在聊天里说一次。

## 3·补 ⑨ H 的复跑读数（23:19 那一趟）：**RUN_RC=0，但 summary 是 `1 flaky / 1 passed`**

窗口与门（同一份 `/tmp/ht-h-run.log`）：第三次看守在 23:19 命中，`load=9`、`4318/4319` 各 0 行 LISTEN、阳性对照 2 行。
前两次（23:03、23:12）都是**等满没窗口**（`负载 41/28/22/25/31/34/27/16/12… 全程 >9`）—— 那是环境无效，不是产品失败，也没有降级判据去挤进去。

```
✘  1 calendar-view-options.spec.ts:119 › 🔴 档位下拉里画的就是共享那份表 (17.7s)     ← 第一次
✓  2 calendar-view-options.spec.ts:119 › 🔴 档位下拉里画的就是共享那份表 (retry #1) (1.8s)
✓  3 calendar-view-options.spec.ts:170 › 🔴 四档都点得动，而且标题四档各说各的那一段 (2.1s)
1 flaky / 1 passed (24.2s)   ⇒ RUN_RC=0
```

- ✅ **② 修完真的过了**（2.1s，不是靠重试）：`toHaveCount(12)` 与那条 `> 12` 的 role 对照一起成立 ⇒ ⑧ 那处修复有效。
- ✅ 两张图都在 `apps/web/evidence/calendar-view-options/`，**人都打开看过**，写了 README：
  `view-select-closed.png` md5 `bf594d6a…`、`view-tabs-year.png` md5 `def6cc66…`。
  看图看出的两件"图证不到"的事也照原样写进 README 了：
  ① 原生 `<select>` 展开层是 OS 画的 ⇒ 四档存在只有 DOM 断言在守；
  ② 年档那张在 1280×720 视口里**只完整画出 1–8 月**，9–12 月被裁在折叠线下 ⇒ "12 张"也只有断言在守。
- ⚠️ **① 是 flaky，没有被解释**：第一次红在 `spec.ts:114` 的 `VIEW_SELECT` 可见性（等 17.7s 报 "element(s) not found"），
  重试 1.8s 就过。两张图都出自重试那次，所以**图是当前态**；但"点 `日历` tab 之后下拉 17.7s 都没出现"这一件
  在本机负载 9–18 下发生过一次，**不能读成"偶发无关"** —— 它要么是 dev 冷启动 + 负载下的挂载慢（环境），
  要么是 `switchView` 之后缺一条"等下拉就位"的显式等待（脚手架/产品）。
  **重查命令**（安静窗口里连跑三趟，看 ① 是否再 flake）：
  `cd e2e && for i in 1 2 3; do NO_COLOR=1 npx playwright test tests/calendar-view-options.spec.ts --grep '共享那份表'; done`
  ⚠️ 不在本会话改 `e2e/tests/helpers.ts` 的 `switchView`：它是**多条在跑的日历 spec 共用**的载体，
  而别的会话此刻正在浏览器上点这套界面（AGENTS §8.9 + 本机既有纪律）。
- 📌 这条 flaky 与 §7 里"套件跑着时不要改那套界面"是同一族：**判据绿不等于判据稳**，
  而 `retries: 1` 会把"不稳"折叠成"绿" —— 所以 summary 里那个 `1 flaky` 必须进账，不能只记 `RUN_RC=0`。

## 3·补 ⑦·附二 23:24 复测：B/C 的阻塞**在加深**，不是"等一下就好"

同一批旋钮的第二次现量（对照 22:5x 那一列）：

- `git status --porcelain packages | grep -c '^ M'` = **85**（22:5x 时本线只看了 op-log 的 6 枚 —— 差 14 倍）
- `apps/mobile`：**30 枚 `M` + 25 枚 `??`**（22:5x 记的是 19 枚，一小时内涨到 55 枚条目）
- `scripts/reinstall-all.sh` 仍是 **`M`**（B 的载体本身没落地）
- `pgrep -f 'verify-mobile|reinstall-all|gradle'` = **7 个活进程** —— 按 AGENTS §8.9，
  同一模拟器/同一构建目录**必须协调所有者与运行窗口**，此刻有七条并行验收在跑
- `adb devices` = 1 台在线（`emulator-5554`）—— 载体在，但**不属于本会话的运行窗口**
- `vm.loadavg` = `{46.09 27.24 25.15}`

⇒ 判定写清楚：**B 与 C 今晚不可执行**，且不可执行的原因是"别人正在写这些包、正在跑这些验收"，
不是"我们这边还差一步"。硬去跑会得到两种最坏的读数：
① 装进四端的是别人 WIP 的产物而判据全绿（§7 第 82 条那一族的第三种面目，见 ⑦）；
② 与七条并行验收抢同一台设备，双方都拿到负载造成的假红。
**闭合归属**：等并行会话提交 ⇒ 由那几条线（vault / 提醒 W9 / notes / 回收站）各自落地；
本线的动作是"复跑下面三条命令，全空/全绿才开跑"，命令原样抄在 §3·补 ⑦ 与 ⑦·附。

## 3·补 ⑩ 23:5x：C 的**脚本本体已经写完**，并做了离线先验；卡它的东西从"一条没写的脚本"变成七条现量前置

§3·补 ⑦·附 里那条"C 不是一条现成命令，仓里没有覆盖时刻那一腿的验收脚本，要先写一条"——
**这一条现在闭合了**：`scripts/verify-mobile-due-time.sh`（604 行 / 14 个 step / 11 条判据 + 3 条对照）。
bootstrap 标记在**第 3 行**（门禁要求 ≤15），`.gitignore:184` 的 `scripts/.*.snap.*` 覆盖快照名，
所以 §3·补 ⑦·附 要求的"必须带自快照 bootstrap + 进 MANIFEST"里，**bootstrap 这条已经落地**；
MANIFEST 那一行**没有代它加**（理由见下面"没做的两件事"）。

### 判据形状是读源码读出来的，不是照着"应该有"写的

三条否证，每条都改变了判据：

1. 🔴 **行上看不到时刻**。原本准备写"行上出现 16:00"。读 `packages/domain/src/date.ts:430`
   （`formatCompactDate` 只输出 `MM-DD`）+ 全仓 `localTimeOf` 的消费点**只有** `TaskDetailSheet`
   ⇒ 那条断言恒红，而且红得像是产品的错。时刻的可见证据只剩两处：详情面板输入框的读回、
   另一台设备上的绝对 epoch。文件头把这条写成了"不许在这里写行上出现 16:00"。
2. 🔴 **判据 ② 从属性名改成行为**。第一版判 `enabled="false"`，但 RN 把 `editable`
   落到哪个无障碍属性上**本机没实测过** —— 赌错得到的是一条恒红判据，原因跟产品无关。
   改成"未设日期时敲字敲不进去"（用的还是 ④⑤⑥ 同一条读回通道），`enabled` 只打印作诊断。
   ②/④ 因此配成**双向**：同一通道既不能恒空也不能恒满。④ 之后强制清空并读回，
   否则"清空没生效"会把 ⑤ 那条"半截不提交"建立在脏框上 —— 恒绿。
3. 🔴 **`「全天」按钮是条件渲染**（`DatePicker.tsx:354`）⇒ 它的**出现**就是"提交发生了"的读数，
   于是"框里是我刚敲的字"和"这个字真的进了 dueDate"被拆成两条独立判据（⑥a/⑥b、⑪a/⑪b）。

### 离线先验：把**装运版**代码抽出来跑，不重打一遍（重打一遍就是第二套实现）

`awk` 从脚本里原样切出定位器与两个 epoch helper 再执行 —— 验的就是将来跑的那一份。

定位器 9 臂（夹具 `/tmp/_rid_fixture.xml`，含裸 `task-due` 与 `com.heyta:id/...` 两种序列化形态）：

| # | 输入 | 读数 | 这条在验什么 |
|---|---|---|---|
| 1 | `count task-due-time-input` | `1` | 两种 resource-id 形态都认 |
| 2 | `count task-due-time-nonsense` | `0` | **负向对照**：匹配器没在过度匹配 |
| 3 | `count task-due-time-all-day` | `1` | — |
| 4 | `xy task-due-time-input` | `412 1340` | 中心点算对 |
| 5 | `xy task-schedule-start-time-input` | 空 | sane 守卫（中心 2540 > TAB_Y 2253）挡得住 |
| 6 | `attr text task-clipped-input` | `CLIPPED-TEXT` | 🔴 读属性**不许**走 sane 门（见下） |
| 7 | `attr enabled task-due-time-input` | `true` | — |
| 8 | `attr text no-such-id` | 空，不报错 | 缺节点不抛 |
| 9 | `bogus` 模式 | `UNKNOWN_MODE:bogus` | 拼错模式响亮失败，不静默返回空 |

臂 6 是这一轮改出来的一条真错：第一版 `attr` 也走 `sane`（高度为正、中心在标签栏之上），
于是**被 ScrollView 裁掉的输入框会读成空串** —— 而 `text=""` 正是"未设日期时填不进字"的**通过**读数。
那会得到一条**因为探针位置而恒绿**的判据。改完之后"读值"用全部命中、"点它"才用 sane。

epoch helper 三条：

- `local_to_epoch(明天 16:00, Asia/Shanghai)` = `1791100800000`，
  与 `TZ=Asia/Shanghai date -j -f "%Y-%m-%d %H:%M:%S" … +%s`（**另一条独立实现**）逐位相同；
  `epoch_to_local` 折回 `2026-10-04 16:00:00`。
- 🔴 顺带量出一条**真缺陷**（登记，不在本轮改）：`dueDateToEpoch` 是「本地零点 ms + 时刻 ms」的
  朴素相加（`capture.ts:604`）。`America/Los_Angeles / 2026-11-01`（回拨那天）：
  用户输入的 16:00 = `1793577600000`，而产品的零点+16h = `1793574000000` → 折回墙上时钟 **15:00**，
  差 **3 600 000 ms**；`Asia/Shanghai` 同一天差 `0`。本机模拟器 `persist.sys.timezone=Asia/Shanghai`
  ⇒ 今晚不触发。判据 ⑩ 断的是**产品结论**（写几点就是几点），所以它在该时区的那天**应该**红 ——
  那是缺陷现形，不是 flaky，不许为了跑绿去改断言。
- `check-script-snapshot.mjs` rc=**0**（"34 个脚本 + .gitignore"），`bash -n` rc=**0**。
- `check-shell-unicode-vars.mjs`：先 rc=**1** 点名本文件 `:69`（一行**注释**里的 `$PORT（`），
  修成 `${PORT}（` 后 rc=**0**（"扫了 76 个 .sh"）。同批把 9 行展开位的 `$VAR` 紧跟全角标点都括了起来。
  ⚠️ 但这条要记两条：① **我又踩了 §7 第 45 条** —— 第一次跑写成 `… | tail -6; echo rc2=$?`，
  拿到的是 `tail` 的 0，而真 rc 一直是 1；② 本机 A/B 里 `"$SCREEN，"` 与 `"${SCREEN}，"` **打印完全一样**
  （没复现吞字符），所以这次改动是"照仓库既有纪律与门禁做"，**不是**"修掉了一条本机观测到的乱码"。

### 现量：C 的七条前置，此刻两条满足

| 前置 | 现量（23:5x） | 满足 | 可复跑命令 |
|---|---|---|---|
| 脚本本体 | `scripts/verify-mobile-due-time.sh` 604 行 | ✅ | `wc -l scripts/verify-mobile-due-time.sh` |
| 设备独占 | `another_mobile_e2e_running` 输出空 | ✅ | `bash scripts/verify-mobile-due-time.sh` 第 0 步（`HEYTA_LOAD_GATE_WAIT=0` 只体检） |
| 负载门 | `73`（门槛 12 = 16 核 × 3/4） | ❌ | `uptime \| sed 's/.*load averages: //'` |
| 服务端 | `:3000` 与 `:3100` **都没人监听**，`/health` 空 | ❌ | `lsof -nP -iTCP -sTCP:LISTEN \| grep -E ':(3000\|3100)'` |
| 凭据三件套 | `/tmp/heyta_mobile_*` **一个都不存在**（lib 里 `cat` 已在报 No such file） | ❌ | `ls /tmp/heyta_mobile_*` |
| APK 新鲜度 | APK `23:24:49` < 最新源码 `23:46:47` → 脚本会 exit 3 | ❌ | 脚本第 0 步那条 `find … -exec stat -f %m` |
| 工作树 | `apps/mobile` 30 `M` + 25 `??`、`packages` 85 `M` | ❌ | `git status --porcelain -- packages \| grep -c '^ M'` |

⇒ **C 今晚仍然不可执行**，但性质变了：不再是"缺一件东西要造"，而是"七条里有五条环境前置没到"。
后四条是同一条命令能一起补的：`bash scripts/mobile-e2e-up.sh`（它同时起服务端并 source
`lib/mobile-e2e-fresh-account.sh` 建号写凭据）→ `pnpm --filter @heyta/ui build && pnpm build:android`
→ 负载落回个位。**且必须等并行会话把 `apps/mobile` 与 `packages` 提交之后**再做，
否则打出来的 APK 是别人 WIP，而判据会照样全绿（§7 第 82 条那一族）。

### 没做的两件事，以及为什么

1. **没往 `scripts/check-script-snapshot.mjs` 的 MANIFEST 加这一行**。该文件正被并行会话 `M` 着，
   而本线记过一条同形状的事故（自己 plumbing 提进多人台账的段落被别人整文件 `git add` 抹回去）。
   待插的行与锚点（放在 `'scripts/verify-mobile-conflict.sh',` 之后即保持近似字母序）：
   `'scripts/verify-mobile-due-time.sh',`
   ⚠️ 漏登记**不会**让任何门禁变红 —— 该文件头第 31-33 行自己写明"本门禁不查漏登记"，
   它只查"清单里的文件存在且有 bootstrap"（反向漂移）。所以这是一条**已知的敞口**而不是被挡住的工作。
2. **没改 `scripts/lib/mobile-e2e.sh` 加 resource-id 定位器**。写这条时现量看到并行会话
   正在把 `settle_foreground / dismiss_permission_dialog / tap_tab / blame_crash` 往那个 lib 里搬
   （`ps` 里一条 `bash -n scripts/verify-mobile-notes.sh` + `git diff --stat -- scripts/lib/mobile-e2e.sh`）。
   ⇒ 定位器落在本脚本私有的 `/tmp/_heyta_rid_$$.py`（带 `$$`，两并发不互踩），
   并且 `trap` 把 lib 的 `restore_ime` 一起接上 —— 覆盖 `EXIT` trap 而不接回它，
   会把这台模拟器的软键盘永久留在关闭状态，下一个用的人拿到的是改过的设备。

## 3·补 ⑪ 00:0x：E 落地、A 被别人那笔提交整片吸走，加三条我自己的错

### E（把 `check:md-tables` 接进 `pnpm check`）—— ✅ 已做，且当场证明它有牙

前置是**别人那笔 `2f735392` 替我们满足的**（提交之后 `package.json` 干净），不是等来的。改动只有两行：

1. `"check:md-tables": "node scripts/check-md-table-rows.mjs"`（插在 `check:docs` 条目之后）；
2. `pnpm check` 链里 `pnpm check:docs &&` 之后插 `pnpm check:md-tables &&`。

读数：`require('./package.json')` 解析通过；链 **63 段**；该条目在链里出现 **1 次**；
`pnpm check:md-tables` 平态 rc=**0**（"4 个文件，列数、断行与'是不是表'都一致"）。
🔴 变异臂：往台账第 664 行注入一枚错位表行 ⇒ rc=**1** 并指到行号，报的是
"这一块的表头下面没有分隔行（GFM 当裸文字渲染 ⇒ 列数判据对整个碎片失效）"
—— ⚠️ **不是**列数那一档。两条都是这个门禁自己的判据，但这里如实写清是哪一条接住的，
别让下一次的人以为"列数那一档刚被验过"（那一档的读数仍只有 §3·补 里 M9/M10 那两次）。
复原走 `cp` + `cmp -s`：字节级相同（md5 `fd896a58…` 前后一致），复跑 rc=0。
🟢 **01:5x 现量收口：这一条从"未提交"变成"在 HEAD"，而那笔提交不是本线的。** `package.json`
`git status --porcelain` 为空、`git diff --quiet HEAD` 通过；`git show HEAD:package.json` 里
`check:md-tables` 命中 **2 行**（定义行 + 链内那一处）。上面 00:0x 那三个数**复跑一个都没漂**：
链段数现量仍是 **63**、链内出现仍是 **1 次**、位置仍是 `pnpm check:docs` 之后 `pnpm check:pricing` 之前。
两枚脚本 `scripts/check-md-table-rows.mjs` 与 `scripts/dist-freshness.mjs` 现量都在 `git ls-tree HEAD` 里
⇒ §5 第 6 行那条"接进 `check` 之前必须先把两枚脚本 `git add`"的前置**已闭合**。
落地那笔是 **`102d064f`（10-04 00:46，vault 那条线）**：它提交 `package.json` 时把本线那两行**整行吸了进去**，
所以归属记在那笔名下。平态现量：`node scripts/check-md-table-rows.mjs` ⇒ rc=**0**（「4 个文件…都一致」）。

### A（入库）—— 现在的事实是"大部分已被别人提交"，不是"我们入库了"

`git ls-files` 现量：本线 19 枚判据文件里 **17 枚在 HEAD**（含 23:5x 刚写完的 `verify-mobile-due-time.sh`
和本台账的 §3·补 ⑩ 整段），五张证据目录合计 **29 枚 png 在 HEAD**，
`check:docs` 指向本线的红 **从 12 处归零**（现量 2 红都在 `countdown-anniversary.md:1091/1295`）。
仍在仓库外的两枚：`e2e/_probe/probe-reload-crash.spec.ts`、`e2e/playwright.probe.config.ts`。
而 **handoff 自己是 ` M`** —— 我 23:5x/00:0x 写的 §0 三段、§4 A 的 19 枚清单、§4.1 的 H 条、§5 第 5/6 行都还没进 HEAD。
🔴 `MANIFEST` 里**没有**本线那条脚本（`git show HEAD:scripts/check-script-snapshot.mjs | grep -c verify-mobile-due-time` = **0**）。

复现命令（谁接手都一条量得回）：
```bash
git show --stat 2f735392 | head
git ls-files --error-unmatch e2e/_probe/probe-reload-crash.spec.ts e2e/playwright.probe.config.ts 2>&1 | head -2
git show HEAD:scripts/check-script-snapshot.mjs | grep -c verify-mobile-due-time
git status --porcelain -- docs/plans/calendar-profile-handoff.md
```

### 三条我自己的错（都改完了，留原句旁）

1. 🔴 **`| tail -6; echo rc=$?` 今天第二次踩**。第一次拿到的 `rc2=0` 是 `tail` 的退出码，
   而 `check-shell-unicode-vars` 的真实 rc 一直是 **1**（它点名的是本脚本一行**注释**里的 `$PORT（`）。
   同一条 §7 第 45 条我在 22:5x 刚写过一遍，隔三小时又中 —— 说明"管道后的 `$?`"这条在我的默认动作里还没扎根。
   已改成"先看全文输出，再单独 `>/dev/null; echo rc=$?`"两次独立取码。
2. ⚠️ **本机 A/B 没复现乱码**：`"$SCREEN，"` 与 `"${SCREEN}，"` 在这台机上打印**完全一样**。
   所以那次括起来是"照既有纪律与门禁的判据做"，**不是**"修掉一条本机观测到的缺陷"。
   文档里两种说法不能混写。
3. 🔴 **我差点登记一条假缺口**：先说"凭据三件套的生成脚本 `mobile-e2e-fresh-account.sh` 仓里没有"，
   依据是 `ls scripts/ | grep fresh-account` = 空。真身在 **`scripts/lib/`** 下且早已被跟踪
   （`git ls-files | grep fresh-account` 一条就纠正了）。**`ls` 不递归**，而"某文件不存在"这种断言
   必须用 `git ls-files` 或 `find` 取 —— 又一条"断言'没有 X'的取证门槛"。

## 3·补 ⑫ 00:1x：MANIFEST 那一行补上了，并把"等窗口"做成了一条可复跑的命令

### 1) `scripts/check-script-snapshot.mjs` 的 MANIFEST —— ✅ 已插

23:5x 写"待插"的理由是那个文件当时正被别人 `M`。00:0x 复测它**干净了**（别人那两笔提交把整片吸走），
所以按 `conflict` 与 `focus` 之间的字母序插了一行 `'scripts/verify-mobile-due-time.sh',`。
读数：门禁 `✅ 自快照 bootstrap 全部在位（36 个脚本 + .gitignore）`，rc=**0**；
`git diff -- scripts/check-script-snapshot.mjs` 只有那一行。
🔴 依赖关系要写明白：**这一行与那条脚本必须一起落地**。脚本本身已在 HEAD（00:0x 现量 `IN`），
所以单独提交这一行不会触发门禁的反向漂移检查（"清单里的文件不存在"）；反过来若那两枚探针被丢弃、
脚本却被回退，门禁就会红在这里 —— 那是对的，不是噪音。

### 2) `scripts/verify-mobile-window-gate.sh` —— 新写的一条**开工窗口闸门**

动机不是多加一个脚本，是**"B/C 到底能不能开跑"这件事每小时都在变，写进文档就过期**
（本线实测：同一条"负载 16–35"三小时内变成 73，再变成 19）。所以判据落成命令，谁接手谁跑。

- 参数化：`--target b|c`，缺参 **exit 1**（并打印用法），默认 **dry-run**，`--confirm` 才执行；
  退出码 **0 = 窗口开 / 1 = 用法错 / 3 = 现场不成立（环境无效，不是产品失败）** 三者分开。
- 两条刻意的设计：
  ① **不 source `lib/mobile-e2e.sh`** 做设备独占粗筛 —— 该 lib 文件尾挂着 `trap restore_ime EXIT`，
     source 它等于让一次只读体检去 `ime enable` + 改 `show_ime_with_hard_keyboard`，
     那是**动设备状态**，而下一个用这台模拟器的人不会知道是谁改的。粗筛规则与权威实现一致
     （只认 `bash …verify-mobile-*.sh`，`bash -n` 那种预检不算运行者），权威判据仍在那条脚本的第 0 步。
  ② 负载解析**用规范实现**（`scripts/lib/wait-for-quiet-host.sh` 的阈值 `hw.ncpu × 3/4`），
     但**不阻塞等人** —— 这个脚本是给调用者读现量的，不替调用者睡觉。
- 它自己**不进 MANIFEST**（已想清楚"会不会跑很久"）：`--confirm` 执行的是子脚本，
  两条子脚本各自有 bootstrap；父脚本在被调子脚本之后没有任何待解析行了。

实测四条（都跑过）：

| 调用 | 结果 |
|---|---|
| 不带 `--target` | rc=**1** |
| `--target z` | rc=**1**（`只认 b 或 c，收到的是 'z'`）|
| `--target c`（dry） | rc=**3**，5 条前置不成立 |
| `--target b`（dry） | rc=**3**，2 条不成立 |

00:12 那趟的现场读数（`--target c`）：**26 枚**未提交源码，整片是 vault 密钥迁移那条线
（`packages/app-host/{vault-key-package-store,vault-migration,vault-session,host}.ts`、
`server/src/sync/*` 四条、两份 i18n 词条表、`packages/ui/src/{index.ts,projects/*}`、
`packages/storage/src/stores.ts`、`apps/mobile/*` 三枚、`apps/web/*` 两枚）；
凭据三件套缺、`:3000` 无服务端、APK `23:24:49` < 最新源码 `00:11:50`、设备在线且无人抢、
MANIFEST 那一行 ✅。`--target b` 那趟：`scripts/reinstall-all.sh` ✅ 干净、
booted 模拟器 = **`heyta-iphone-17pro`**（⚠️ 22:5x 记的"没有这个名字"此刻已过期，但这个名字仍然是**现取**的）。

⇒ **B/C 的阻塞源已经收敛成一件事**：vault 那条线的 26 枚提交。其余四条是环境（服务端/凭据/APK/负载），
一条 `mobile-e2e-up.sh` + 一次 `build:android` 就能补齐。

### 3) 顺手否证掉自己写进文档的一条"过期读数"

交接 §5 第 3 行原话是"booted 的是 `heyta-ios-isolated` 与 `iPhone Duo heyta`，**没有** `heyta-iphone-17pro`"。
00:1x 现量 booted 就是 `heyta-iphone-17pro`。**这条更正原地写回原句旁边**（见 §5 第 3 步的 🟢 段），
不改写原句 —— 那条判据的价值恰恰是"它当时是真的"：它阻止了那个人照抄一个当时不存在的设备名。

## 3·补 ⑬ 00:2x：步骤 1 那句"体检读数"原来是一句空测量，而它退 0

这一轮开头做的事只有一件有价值：**把上一节引用过的那个读数重取了一遍，发现它是假的**。

### 1) `dist-freshness.mjs --only` 的 `--only` 吃目录名，不吃包名 —— 传错形状它会报"0 个包"并退 0

上一节（以及交接 §5 第 1 步）引用的那句
`落后于源码的产物：0 个（⇒ 本机判据读的都是当前产物）` 是我用
`--only @heyta/ui,@heyta/i18n,@heyta/domain,@heyta/app-host,@heyta/storage` 跑出来的。
脚本里 `--only` 直接当 `packages/` 下的**目录名**用（`packages/ui`），
五个名字**一个都没匹配上** ⇒ `rows` 为空 ⇒ 打印"0 个包 / 0 个落后 / 缺产物 0 个"，
**退出码 0**。也就是说那一轮"读的都是当前产物"这句话的根据是**一次范围被拼错缩成零的遍历**。

这正是本篇反复写的那一族的第 N 种面目：**空测量输出上长得像"全部通过"**（§7 的"不能失败的检查"）。
而这次不是别人写的判据，是**我自己本轮第 1 步的工具**。

修的是**参数语义**，不是我的调用习惯（下一轮还会犯）：

| 臂 | 命令 | 期望 | 现量 |
|---|---|---|---|
| 1 | `--only ui,i18n,domain,app-host,storage` | 5 个包，逐包读数 | rc=0，`5 个包：--only 请求 5 个，命中 5 个` |
| 2 | `--only @heyta/ui,@heyta/domain` | 规范包名也认 | rc=0，`2 个包：请求 2，命中 2` |
| 3 | `--only @heyta.ui,notapkg` | **响亮失败** | rc=1，逐个指名并打印可选目录名清单 |
| 4 | `--only`（后面没参数） | rc=1 带用法 | rc=1（原来是 TypeError 崩栈） |
| 5 | 不带 `--only` | 14 个包全量 | rc=0，`14 个包：packages/ 下全部带 src 的包` |

"请求 N / 命中 N"这一句是**新增的前提断言**：范围由调用方指定时，报告必须自己说清指定了几个、命中了几个。
原来只有 `${rows.length} 个包` 一个数，它既可能是"我请求的都被命中"也可能是"一个都没命中"。

### 2) 修完之后步骤 1 的真读数（00:2x，载体 HEAD `f6478fad`）

- `ui` 产物比源码旧 35s、`app-host` 旧 337s —— 两条都是**别人正在改**：
  `packages/ui/src/projects/{OrganizerList,model}.ts(x)`（回收站/W4b 那条线）与
  `packages/app-host/src/vault-session.ts`（vault 那条线）。
- `i18n` / `domain` / `storage` 产物比源码新 ⇒ 这三包本线读的是当前产物。
- 🔴 但"整包落后"这条线**答不了本线真正要问的那一句**（"我改过的那些源进产物了吗"），
  因为整包的最新源码是别人的文件。所以另取一次**按本线自有作用域**的读数
  （一次性探针 `/tmp/ht-own-fresh.mjs`，不进仓库）：
  `packages/ui/src/calendar`、`packages/ui/src/date-picker`、`domain/src/date.ts`、`domain/src/capture.ts`、
  `packages/i18n/src`、`shared-schema/src/account-profile-contract.ts`、`app-host/src/hosted-auth.ts`
  ⇒ **7 个作用域全部已进当前产物，落后 0**。
  ⚠️ 这份清单第一版是**凭记忆写的**，里面 `packages/ui/src/calendar/DatePicker.tsx`、
  `packages/i18n/src/entries.ts`、`packages/app-host/src/profile.ts` 三枚**路径根本不成立**
  （真身是 `ui/src/date-picker/DatePicker.tsx` 与 `app-host/src/hosted-auth.ts`）。
  探针把它们打成 `MISSING` 而不是当成"落后 0"的一部分 —— 这一条要留着：**消费清单必须现取，不能回忆**。

⇒ 步骤 1 从这一刻起才**真的有读数**；上一节那句 0 个包作废（原句留在 ⑫，旁边指到这里）。

### 3) 本线 15 枚判据在 `f6478fad` 之后复跑（"旧读数引用前必须复跑"）

`NO_COLOR=1`，逐组、每组单独取退出码（不带管道 —— 见下面第 5 条）：

| 组 | 文件 | 现量 | rc |
|---|---|---|---|
| ui | `calendar-year-model` + `calendar-day-buckets` | 2 files / 21 passed | 0 |
| domain | `date-year` | 1 / 6 | 0 |
| app-host | `hosted-account-profile` | 1 / 14 | 0 |
| web | `calendar-day-view` `calendar-drag-day` `calendar-view-tabs` `calendar-year-board` | 4 / 48 | 0 |
| mobile | `task-due-time` `profile-nickname-entry` `profile-avatar-entry` `calendar-view-entry` | 4 / 41 | 0 |

合计 **15 枚判据文件 / 130 passed / 0 failed**，单组 1–3 秒。
⚠️ 这 130 条只覆盖 **jsdom/单元那一层**；R14c 的真机腿（§4 C）与 R17 的复测（§4 H）不在里面，
它们仍然各自卡在环境窗口上 —— **判据文件全绿不等于这两项已交付**。

### 4) B/C 的前置换了人：⑫ 那句"阻塞收敛成 vault 的 26 枚提交"被现量否证

00:2x 现量（每条都带复跑命令）：

- `git status --porcelain packages/op-log` = **空**，`-- scripts/reinstall-all.sh` = **空**
  ⇒ ⑫ 写的那个收敛点**已经过去了**（那 26 枚的一部分已入库，HEAD 从 `2f735392` 走到 `f6478fad`）。
- 🔴 新的阻塞是另一件事，而且**对 B 和 C 不是同一件**：
  - **B**：`git status --porcelain packages apps` = **28 枚 `M` + 7 枚 `??`**
    （apps/web 11 / app-host 7 / apps/mobile 7 / ui 5 / sync-client 2 / i18n 2 / storage 1）。
    在共享检出里跑 `reinstall-all.sh` 就是**把这些 WIP 装进四端**而判据照样全绿（§7 第 82 条那一族）。
    负载 `40.59`（阈值 12）、`apps/mobile/android` 有活着的 Gradle/Kotlin 守护进程
    （同一构建目录，§8.9）。三台 booted iOS 里 `heyta-iphone-17pro` 在，**归属没协调过**。
    ⇒ 可执行形态只有一个：**在按提交 SHA 切出的干净检出里跑**（本线已有先例，见记忆
    「四端重装改在隔离检出里跑」），且要等负载与设备窗口。
  - **C**：`curl :3100/health` 与 `:3000/health` 都 **rc=7（连接被拒，无服务）**；
    APK mtime `10-03 23:24` 而 `apps/mobile/src/screens/{TagsSection,VaultSettingsSection}.tsx`、
    `lib/vault-secure-storage.ts`、`packages/ui/src/projects/*` 都比它新。
    🔴 **但这里有一条真正的更正**：`git diff HEAD` 对本线那三枚源文件
    （`apps/mobile/src/screens/TaskDetailSheet.tsx`、`packages/ui/src/date-picker/DatePicker.tsx`、
    `apps/mobile/src/lib/date-picker-labels.ts`）**零差异**，且 HEAD 里
    `TaskDetailSheet.tsx:709/713` 有 `testID="task-due"` + `time={{…}}`、
    `DatePicker.tsx` 有 `-time-row` / `-time-input` / `-time-all-day` 三个合成 testID。
    ⇒ **C 验的那个东西全部是已提交代码，不需要任何人的 WIP**。
    C 的剩余阻塞因此从"等别人提交"变成三件纯环境的事：起服务端、重打 APK、拿到设备窗口。
    比 ⑫ 记录的**轻**，而且可复跑命令不变：
    `bash scripts/verify-mobile-window-gate.sh --target c`（干跑）→ `--confirm`。

### 5) 我自己这一趟又踩了 §7 第 45 条，而且是在同一趟命令里两次

第一次（本轮开头之前已记）：`… | tail -6; echo rc=$?`。
第二次（00:2x）：为了测服务端在不在，写了
`curl -s -m 3 http://127.0.0.1:3100/health | head -c 120; echo "  [rc=$?]"` ——
`$?` 是 `head` 的。输出 `[rc=0]` 而 body 为空，**读起来像"服务在但 /health 返回空"**，
实际是连接被拒。改成不带管道重取才得到 `rc=7`。

⇒ 这条坑的形状是"**只要判据取的是退出码，管道里就不能有任何东西**"，
而不是"某一次写法要记住"。同一趟里第二次出现，说明把它记成"注意别用 tail"是不够的。

### 6) F 那两条边界的复测（00:4x）：mobile 那一笔逐字复现，但**它不是全部范围**

用 §4 那行登记的**原样命令**跑（不是另写一条正则）：

- `grep -rho "'web\.[a-zA-Z0-9._-]*'" apps/mobile/src | wc -l` = **188** ✅ 与 23:06 那趟逐字相同
- 同趟阳性对照 `common\.` = **111** ✅（19:3x 记的那个数也没漂），文件 **13** 个，去重键 **180** 个
- 🔴 **增量：同一笔债在共享层里还有一份，而旧句子只写了 mobile 那一半**
  `packages/ui/src` = **63 处 / 32 个去重键**，`packages/app-host/src` = **12 处 / 4 个键**，
  `packages/domain/src` = **0**。
  ⇒ 改名那一单的真实范围是 **263 处 / 三个树**，不是 188 处 / 一个壳。
  而共享层读 `web.*` 比移动壳读它更违反 AGENTS §3.5 —— 那等于让 `@heyta/ui` 说某一个宿主的话。
  ⚠️ 这条**不是新边界**，是 F 第二条的**范围更正**（§5 第 7 步那句"不写条数"仍然成立：数只能现跑）。
- 英文规则表那一条：`packages/domain/src/capture.ts` 里 `今天\|今日` / `明天\|明日` 这类中文词形仍在，
  英文形态**一条都没有**（全文件提到英文的只有一行注释：`:567` "英文形状（`tomorrow meeting`）不存在这个连接词"）
  ⇒ 边界仍然开着，读数不变。

⚠️ 这一节开头我还踩了第三条命令坑：`echo "…界面里 \`web.*\` 键引用…"` 里的**反引号被 shell 当命令替换执行**了
（zsh 当场报 `no matches found: web.*`，那句 echo 输出里那个词直接消失）。
这条在记忆里是"双引号里的 pattern 含反引号会被命令替换 ⇒ 报'没有残留'其实 grep 没跑"——
本次它只是吞了一个词，但它完全可以在下一次吞掉一条判据。

## 3·补 ⑭ 00:4x–00:5x：我起了一次四端重装，40 秒内自己停掉 —— 这一段是本线最贵的一页

先给结论，再给时间线。**B 没有完成，但我这趟拿到了 B 的第四条开工判据，而且是被现场教出来的。**

### 1) 时间线（每条都可复跑核对）

| 时刻 | 事 | 读数 |
|---|---|---|
| 00:46–00:47 | 并行会话连落三笔提交（`102d064f` / `9ed68e9e` / `ad9dce8e`） | HEAD 从 `f6478fad` 走到 `ad9dce8e` |
| 00:47:53 | `ad9dce8e` 修掉共享设备探针：旧写法 `bash [^ ]*verify-mobile-…` **跨不过本仓路径里的空格**，且对 `.snap.<pid>` 形态的运行者**永久隐形** | 该提交自己的现场证据：修好后当场抓到 `88869 bash …/scripts/.verify-mobile-ios-reminder.sh.snap.88869`，旧写法读数是**空** |
| 00:48:27 | 我跑 `verify-mobile-window-gate.sh --target c`（干跑） | 它打印 **✅ 粗筛没有别的移动端验收在抢 emulator-5554** —— 这句当时是**瞎的**（我自己文件里那份同形状抄件，`ad9dce8e` 点名了但没替我改） |
| 00:48:37 | 现量：`git status --porcelain packages apps` = **0 枚**；`:3000/health` = `{"status":"ok","db":"connected"}`；凭据三件套**都在**；APK mtime `00:36:59`（别人 11 分钟前重打的） | ⇒ ⑫/⑬ 记的 B/C 前置**在这一分钟内全部成立**（只剩负载 29 > 12） |
| 00:49:10 | 我据此起 **B**（`IOS_DEVICE_NAME=heyta-iphone-17pro bash scripts/reinstall-all.sh`，后台，HEAD `ad9dce8e`） | 段 0 `pnpm -r build` ✅ |
| 00:49:3x | 我读 `ad9dce8e` 正文，意识到 00:48 那句 ✅ 来自瞎探针；直接 `ps` 一看：**88869 正在跑 iOS 设备验收** | ⇒ reinstall-all 的 ios 段是 `simctl uninstall`，android 段是 `adb uninstall`/清数据 —— **会当场清掉对方现场** |
| 00:49:4x | **停掉 B** | 日志末行停在段 1 的 `package-app.sh`（`Terminated: 15`），**没有任何设备侧动作执行过**：`/Applications/Heyta.app` 仍在（mtime 23:05，是上一轮装的），`adb shell pm list packages \| grep -c heyta` = **2**（没被卸），88869 那个进程没受影响 |
| 00:48:55 / 00:50 | 并行会话把我那份瞎抄件接上共用探针并提交为 **`eb03420a`** | 现跑 `--target c` 的段 3：**❌ 有移动端验收在跑（pid：16583）** ⇒ 这道门现在有牙了 |

### 2) 三条要留给下一轮的判据

- 🔴 **B 的开工判据原来只有三条（无别人脏源码 / `reinstall-all.sh` 干净 / 负载门），不够。**
  缺的第四条是：**设备与模拟器上没有别人的验收在跑**（权威判据 = `scripts/lib/mobile-e2e-runner-probe.sh` 的
  `mobile_e2e_runner_lines`）。`reinstall-all.sh` **自己不查这一条** —— 它的前置是"工作树干净"，
  而"干净"与"没人正在用这台设备"是两件不同的事。
  形状：**§8.9 的共享资源独占，在"打包输入"那一侧有门禁，在"设备状态"那一侧没有。**
- ⚠️ **我起了这一次的成本要如实记两笔**：段 0 把共享检出的**全部 `packages/*/dist` 重建了一遍**（约 00:49:2x）。
  源码没动、产物与提交后的源码一致，但**同一时间正在读 dist 的并行会话读到的是我刷新的那一份**。
  ⇒ 在共享工作树里跑 `pnpm -r build` 不是"只影响自己"的动作，起之前就该把设备与 dist 两条都查了。
- 🔴 **别把"闸门打印 ✅"当成"现场成立"**：这道门 00:48 打印的 ✅ 与 00:50 之后的 ❌ 是同一台设备、
  同一条判据、相隔两分钟 —— 差别只在**判据的实现被修过一次**。
  ⇒ 引用一条判据的读数时，顺带确认它那次修复在不在读数之前。

### 3) 现场仍然开放的动作（负载 45 且在落，别人仍在跑设备验收）

```bash
bash scripts/verify-mobile-window-gate.sh --target b   # 干跑：现在会数出设备上的运行者
bash scripts/verify-mobile-window-gate.sh --target c
# 三条同时绿才开跑：
IOS_DEVICE_NAME="$(xcrun simctl list devices booted | sed -n 's/.*(\([A-Za-z0-9 -]*\)) (Booted)/\1/p' | head -1)" \
  bash scripts/reinstall-all.sh; echo "EXIT=$?"
```

## 3·补 ⑮ 00:5x：C 的载体落成了一条链，两套装置从 /tmp 搬进仓内

### 1) 为什么 C 必须在按 SHA 切的载体里跑，而不是主检出

00:58 现量主检出 `git status --porcelain packages apps` = **22 枚**别人未提交源码，
其中 **`apps/mobile/src/db/op-sqlite-driver.ts` 正在本线判据的落库路径上**（C 的 ⑩"跨设备读到同一个绝对 epoch"
那条要经过它）。从主检出打 APK 就是把别人的 WIP 一起打进去而判据全绿（§7 第 82 条）。
而本篇 ⑭ 已经证明**软链 `node_modules` 那种"载体"更糟** —— 它会静默地把 `@heyta/*` 解析到别的树。
⇒ 载体 `heyta-wt-r14c`（detached **`93113e30`**）**真跑 `pnpm install`**，并在 install 之后加一步
**解析自证**：`realpath apps/mobile/node_modules/@heyta/ui` 必须落在载体里，否则整条链以
`CHAIN_STOPPED_AT=resolve` 退出 —— 这一行就是防 ⑭ 那个坑的，不是装饰。

链：`research/tools/r14c-carrier-chain.sh`（`STEP <名> rc=<码>` 哨兵逐步骤打；
日志 `/tmp/ht-r14c-chain.log`）
`install → 解析自证 → pnpm -r build → scripts/mobile-e2e-up.sh → pnpm build:android → scripts/verify-mobile-due-time.sh`。
第 5 步自带负载门与设备探针，不达标它自己 `exit 3`；那时前四步的产物已经备好，只需重跑第 5 步。

### 2) 两套装置从 /tmp 搬进仓内（并行会话刚为这件事付过学费）

`research/tools/h-flaky-window-watcher.sh`（H 那枚 flaky 的有界窗口看守，`BUDGET` 是旋钮）与
`research/tools/calendar-line-judgment-rerun.sh`（本线 15 枚判据的复跑器）。
搬的过程中 `check:shell-unicode` **当场把我搬进去的那份照红**（两处 `$LOAD ≤ $STRICT_MAX，`
—— 变量名被中文吞掉），自动修好后 rc=0。⇒ 这条门的覆盖面**含 `research/tools/*.sh`**（现量"扫了 82 个 .sh"），
不是只管 `scripts/`。

⚠️ 我为了找这条门的脚本文件猜了 `scripts/check-shell-unicode.mjs`，node 直接崩栈 ——
真实文件是 `check-shell-unicode-vars.mjs`。**pnpm 脚本别名与文件名不同名是本仓的常态**，
先 `node -e '…Object.keys(pkg.scripts)…'` 再调用（这条早就在我的记忆里，本次又犯）。

### 3) 引用行号在新载体上复验（HEAD 一小时内动了两次：`f6478fad` → `ad9dce8e` → `93113e30`）

C 脚本头部那七处 `file:line` 在 `93113e30` 上逐条再看，**没有一处漂移**：
`DatePicker.tsx:146`（`editTimeText`）`:354`（`time.value !== undefined` 那个条件渲染）
`date.ts:430`（`formatCompactDate`）`:58`（`parseLocalTime`）`capture.ts:604`（`dueDateToEpoch(date, time?)`）
`TaskDetailSheet.tsx:709`（`testID="task-due"`）`:716`（`enabled: dueLocal !== undefined`）。

### 4) 这一段顺带量到的、与本线无关但会咬人的两条

- **`:3000` 上那个"服务端就绪"是十分钟的临时状态**：00:48 现量 `{"status":"ok","db":"connected"}`，
  00:59 同一命令 `rc=7`（连接被拒），而 `docker ps` 报 OrbStack 的 socket 不存在。
  ⇒ 环境类前置的读数**有效期以分钟计**，链里每一步都重新量，不许拿上一条命令的结论开跑下一条。
- **`lsof` 与 `curl` 对同一个端口给相反答案**：00:59 `lsof -nP -iTCP:3000 -sTCP:LISTEN` 空、
  `curl` 也空 —— 这一对是一致的；但我在 00:2x 见过 lsof 报空而 curl 通的组合，
  所以**判"服务在不在"以 `curl` 的退出码为准**（不带管道，见 ⑬ 第 5 节），lsof 只用来看归属。

## 3·补 ⑯ 01:0x：载体链五步全绿、APK 出来了，而设备门当场抓出别人那一趟

### 1) ⑮ 那笔编辑的结构自检（两道文档门禁 + 一条我自己工具的假阳性）

- `node scripts/check-md-table-rows.mjs` → **rc=0**（「4 个文件，列数、断行与"是不是表"都一致」）；
  `node research/tools/docs-link-check.mjs` → **rc=0**（「无死链、无"本机有仓库里没有"的链接、无失效章节引用、无失效锚点」）。
- 标题序列现量：`## 3.` 之后到 `## 4. 计划变更记录`（第 1111 行）、`## 5.`（1187）、`## 6.`（1211）**都在** ——
  ⑮ 没有吃掉任何一节（这条自检是固定的，因为我在这个文件上已经错过四次）。
- 🔴 **但自检工具自己有一类假阳性，这次现形了**：我用 `grep -nE '^#{1,2} '` 列标题，它把
  第 1061 行 `# 三条同时绿才开跑：` 报成了一个 H1 —— 那**是 ```bash 围栏里的一行注释**。
  ⇒ 标题类自检必须先剥围栏，否则每次都会为一条假 H1 去"修结构"。
- 另一个同族：`grep -oE '[①②③④⑤]' | sort | uniq -c` 在这台机器上输出一堆乱码计数（字节级切分），
  换成 `node` 读全文才给出正确答案：**带圈号标题 ⑥–⑮ 无缺号、正文引用的 ⑦/⑩ 都有对应标题**。
  （同一道坑在 §7 记过：中文计数要先看 locale。）

### 2) C 的载体链读数：前五步全绿，卡第六步的不是代码，是别人那一趟

`research/tools/r14c-carrier-chain.sh`，载体 `heyta-wt-r14c`（detached `93113e30`），日志 `/tmp/ht-r14c-chain.log`：

| 步 | 哨兵 | 读数 |
|---|---|---|
| install | `STEP install rc=0` | 载体里真装依赖 |
| 解析自证 | `RESOLVE ui=…/heyta-wt-r14c/packages/ui` + `RESOLVE_OK 载体自洽` | `@heyta/ui` 落在**载体内**，不是软链到主检出（⑭ 那条事故的反向证明） |
| 全量构建 | `STEP build_all rc=0` | `pnpm -r build` 通过 |
| 起栈 | `STEP stack_up rc=0` | 服务端 + 凭据 |
| 打 APK | `STEP build_android rc=0` | `app-release.apk` **66 785 752 B**，mtime 01:05:18 |
| 设备验收 | `STEP verify rc=3` | **没开跑** —— 第 0 节载体体检拦下 |

拦下的原文（这一条是本线最想要的那种"闸门有牙"的证据）：

```
❌ 同一台模拟器上还有别的移动端验收在跑：
     2227  2953 bash …/heyta/scripts/.verify-mobile-auth.sh.snap.2227
```

- 01:05 现量 `ps` 里那枚 snap 正在跑（etime 43s），而我这一趟**只跑了 0 步设备动作就退出**，
  设备状态没被我动过。⇒ 运行者探针（`mobile_e2e_runner_lines`）**第一次抓到的是别人的趟**，
  而不是 ⑭ 那次我自己那份盲副本 —— 它的阳性对照这次是现场给的，不是我造的。
- 同一条闸门对**载体**跑 dry-run（`--target c --repo <载体>`）：**rc=3，6 ✅ / 2 ❌**，
  红的两条是负载 49 > 12 与设备上有运行者；而 **`APK 不比源码旧` 这条从红转绿**
  （APK 01:05:18 / 最新源码 01:00:54）。⇒ 这条判据量的是"打包这件事做没做"，
  因为载体里真打了一次包它就翻绿 —— 这是它在自己测的东西。

### 3) "等窗口"不该由我重新实现一遍

新增 `research/tools/r14c-window-retry.sh`：它**不含任何一条前置判据**，只做一件事 ——
反复调仓库自带的 `scripts/verify-mobile-window-gate.sh --target c --repo <载体> --confirm`，
直到退出码不是 3。理由写进文件头：闸门已经是负载门/设备独占/凭据/APK 新鲜度/MANIFEST 的
唯一权威实现，**我再抄一份就是第二份真相，它一定会漂**（§3.5 那条教训的同族）。

四臂自测（先证明它能失败，再让它上岗）：

| 臂 | 期望 | 现量 |
|---|---|---|
| `CARRIER=/nonexistent/path` | 响亮失败 | `❌ 载体目录不存在…`，**rc=1** |
| `BUDGET=0`（窗口确实没开） | 判成"没等到" | **rc=3** + `WINDOW=timeout 预算 0s 用尽，共 1 次` |
| 桩闸门退 0 | 透传 | **rc=0** + `WINDOW=open 验收已执行 rc=0` |
| 桩闸门退 7 | 不被洗成 0 | **rc=7** + `final_rc=7` |

`node scripts/check-shell-unicode-vars.mjs` 加它之后 **rc=0（83 个 .sh）**。

### 4) 我自己的第三条同类错：`${PIPESTATUS[0]}` 在 zsh 里是空值（本会话第二次）

第一次是 `for f in $FILES` 的词分割；这次是给闸门取退出码：
`… | tail -32; echo "GATE_RC=${PIPESTATUS[0]}"` 打出 **`GATE_RC=`（空）**，而真实码是 **3**。
空值比 0 更危险的地方是它**看起来像"没测到"而不像"测错了"** —— 差点就写成"闸门退出码未知"。
改法与上次同一条：`sh -c '… > file 2>&1; echo rc=$?'`，取到 **rc=3、6 ✅ / 2 ❌**。
⇒ 凡是"先过滤输出再取码"的命令，一律把重定向写进文件、码单独 echo，别在 zsh 里用管道。

## 3·补 ⑰ 01:2x：C 的产物级判据（不靠设备就能立的那一段）+ 在我自己脚本里抓出一处能假绿的缺陷

### 1) 载体那枚 APK 里到底有没有时刻那一腿 —— 三条腿一起量

产物：`app-release.apk` **66 785 752 B**，`sha256=3f3a65121dddc3948d146f99cfb139414cff36d0b60712de34f8223052ce9c71`；
内层 `assets/index.android.bundle` **5 763 992 B**，头 8 字节 `c61fbc03c103191f`（Hermes 魔数，§7 #71 那一族，这次是真验了）。

- **腿 1（把 needle 钉到"年代"上）**：`git show 5e23b7bf^:packages/ui/src/date-picker/DatePicker.tsx`
  对 `-time-input` / `-time-all-day` / `-time-row` 各命中 **0**，`5e23b7bf`（R14 那笔）各命中 **1**。
  ⇒ 这三条不是"代码里有这个串"，是**只有 R14c 之后的 DatePicker 才会带的串**。
- **腿 2（计数单位）**：bundle 里按**出现次数**数（`grep -a -o -F … | wc -l`）：
  `task-due` 1、`-time-input` 1、`-time-all-day` 1、`-time-row` 1、`editTimeText` 1、
  `common.due.timeAria` 1、阴性对照 `xyzzy-not-a-real-needle` **0**。
  🔴 第一版我用的是 `grep -c`，它数的是**行**不是**次**（二进制整块常算一行）⇒ hits=1 那时只能读成"≥1 次"。
- **腿 3（先杀掉"探针恒真"这个可能）**：我怀疑词条表整本进 bundle —— 那样 `common.due.timeAria`
  就是**恒命中**、零区分力。拿三个只在 web 用的 key 试：
  `web.shell.nav.aria` / `web.shell.nav.quadrantSection` / `web.shell.nav.scopeAria`
  在 mobile 源码命中 **0** 且 **bundle 命中也是 0** ⇒ 词条表**没有整本打进来**，
  `common.due.timeAria` 的出现是真的来自引用它的那段代码。年代侧也对：
  `git grep -l common.due.timeAria 5e23b7bf^ -- apps/mobile` = **0 个文件**，`5e23b7bf` = **2 个**。

🔴 **这条判据答的是什么、不答什么要写清**：它证明的是**"R14c 的模块与它的 import 进了这枚产物"**
（也就是把 §7 #27"APK 里是旧 bundle"这一类排除了）；它**不**证明"界面上渲染出了那一行"——
Metro 对一个"被 import 但没被调用"的导出同样会打进来。后者是设备腿的活，不许拿这五条命中顶替。

### 2) 🔴 在 C 自己的脚本里发现一处能假绿的缺陷（当场修，不登记成待办）

原第 1 步那一行是：

```bash
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
```

- 管道的退出码是 `sed` 的（**§7 #45 在我自己写的验收脚本里第二次命中**），装失败**什么都不会说**；
- 后面只查"屏幕上有没有『任务』二字"，而**设备上残留的旧包恰好也有**——
  于是"装失败 + 旧包在"= 一整轮判据对着旧产物打绿。这正是 §7 #27 与 #82 那一族的入口。
- 原脚本还**没有产物指纹**：只报 mtime 比较，事后无法回答"这轮装进去的是哪个字节集合"。

改成三件事：记 `sha256`+size（取不到就 exit 3，不许静默缺字段）、`INSTALL_RC` 单独取、
`Success` 必须出现。三臂变异（把真实行区间 336–348 抽出来配桩跑，不是重打一份逻辑）：

| 臂 | 桩输出 / rc | 期望 | 现量 |
|---|---|---|---|
| 装失败且 rc≠0 | `Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]` / 1 | 红并停 | **rc=1**，`BAD: adb install 退出码 1 ⇒ 停…`，没走到结尾 |
| rc=0 但没 Success | 同上 / 0 | 红并停 | **rc=1**，`BAD: …不能把「命令没报错」当「装上了」` |
| 真装上了 | `Success` / 0 | 不许误杀 | **rc=0**，`OK: 安装成功（… sha256=…）`，`REACHED_END` |

门禁：`bash -n` 过、`check:shell-unicode` **rc=0（83 个 .sh）**、`check:script-snapshot` **rc=0（36 个脚本）**。

### 3) 载体与 HEAD 的偏离，现在**只有 1 枚**，而且它不是构建输入

修完把脚本同步进载体：`cmp -s` **逐字节相同**、载体侧 `bash -n` OK。
`git -C heyta-wt-r14c status --porcelain` = **` M scripts/verify-mobile-due-time.sh`**（唯一一枚），
而 `grep -rl verify-mobile-due-time apps/mobile/android` = **0** ⇒ 它不进 gradle 输入，
01:05 打出的那枚 APK 仍然等于 HEAD 的应用代码，这一笔偏离**不影响产物的归因**。
⚠️ 顺带照出闸门的一条**边界**：`verify-mobile-window-gate.sh` 第 2 节的脏文件扫描范围是
`packages/ apps/ server/`，**不含 `scripts/`** —— 所以"harness 可以是脏的而闸门照样报干净"。
这条我认为是对的取舍（验收装置不是产品输入），但它**没说出口过**，写在这里；
同一趟 01:2x 读数：负载从 71 落到 **13.79**（阈值 12），H 看守已等 1710/2400s，C 重试仍 rc=3。

## 3·补 ⑱ 01:2x：B 的现量复跑撞出三件事 —— 一处是我的装置坏了、一处是别人树上真的有红、一处是我造了副作用

### 1) 先说我坏在哪：抽行配桩的装置把"最后一行"真执行了

我给 iOS 目标选择逻辑做三臂测试时，用 `sed -n '229,235p'` 抽真实行再包桩。
**抽多了**：区间最后一行是 `IOS_DEVICE_NAME="$IOS_NAME" bash scripts/reinstall-all.sh` ——
它不是断言对象，是**真的把主检出里的四端重装脚本跑了两遍**。
🔴 这条教训的形状值得记：**"抽取真实行区间来测"比"重打一份逻辑"可信，但它抽到的是整段，
包括段尾那个动手的调用**。以后抽行必须先 `cat` 出区间确认末行是不是副作用，或者把区间收到判据行为止。

后果实测（这三条都是现取的，不是推演）：
- **没有动到安装态**：`/Applications/Heyta.app` mtime 仍是 **Oct 3 23:05**（与 ⑭ 记录的同一个值）、
  `adb shell pm list packages | grep -c heyta` 仍是 **2**、焦点仍是 `com.heyta/com.heytamobile.MainActivity`、
  booted 模拟器仍 **3 台**。它两臂都停在 `reinstall-all.sh` 自己的第 0 步（前置）就退了 rc=1。
- **但我重写了 7 枚 dist 入口**（01:24–01:25，"0 分钟前"实测）：
  `ai / app-host / design-system / i18n / local-api / shared-schema / sync-core` 的 `dist/index.js`。
  🔴 其中 **`packages/i18n/dist` 是从"带重复键的未提交源码"打出来的**（见 2)），
  JS 语义下重复键是**后者覆盖前者**，所以现在读 i18n 产物的任何一方，英文那一句取的是第 74 行的版本。
  这与 ⑭ 那笔同类，但比它更具体：**我没有改源码，却让别人的源码状态被固化成了"当前产物"**。

### 2) 那两臂顺出的一件真红（不是我的，也不是环境的）

`pnpm -r build` 此刻在主检出**是红的**：

```
packages/i18n build: src/locales/en.ts(74,3): error TS1117: An object literal cannot have multiple properties with the same name.
```

只读扫描（`/tmp/ht-guard/dupkeys.js`，扫两格缩进的键、跳过注释行）现量：

| 文件 | 键数 | 重复 | 具体 |
|---|---|---|---|
| 工作树 `en.ts` | 2982 | **1** | 🔴 `common.sync.error.accountClosed` 首次第 **73** 行 / 重复第 **74** 行（相邻两行） |
| 工作树 `zh-CN.ts` | 2982 | **0** | —— |
| `git show HEAD:` 两本表（阴性对照） | 各 2980 | **0 / 0** | 建得出产物，与"HEAD 那趟 build_all rc=0"对得上 |

- **探针有牙**：它报出的行号与 TS1117 报的 `(74,3)` 同一行；HEAD 版本 0 重复。
- ⚠️ 构建日志里那条 `zh-CN.ts(97,3)` **已经过期**：现在第 97 行是一句注释 ——
  对方在这一分钟内又改了那本表。⇒ 引用别人的红必须带**哪一趟**，且别把日志行号当稳定值。
- 🔴 **我上面一度写下"只有 tsup 的 dts 阶段会报、typecheck 放过"—— 这句被夹具否证，撤回。**
  决定性实验（一次性夹具 `/tmp/ht-dupfix/dup-es2022.ts`，内容就是相邻两个同名键，不碰真文件）：
  `npx tsc --noEmit --target ES2022 …` ⇒ **`error TS1117` 照样报**。
  ⇒ 仓库的 `pnpm -r typecheck` **覆盖这一类**，我原本的推理（"ES2015 之后重复键合法所以 tsc 不管"）
  是把语言规范和记忆当成了测量 —— 而它只差一步就能免费验掉。
  所以 01:27/01:28 两次 `pnpm --filter @heyta/i18n typecheck` 都 **rc=0** 的正确读法是：
  **那枚重复键在那之前已被所有者改掉了**（01:28 现量扫描：en **0** 处、zh-CN **0** 处，两本表各 2982 键，
  第 74 行现在是唯一那份，正文还扩写了"注销会抹掉本机副本"那句）。
  ⇒ **B 的"第五条前置"有效期只有四分钟。** 全量 `pnpm -r build` 此刻**没有重测** ——
  重测的代价是再重写一遍 7 枚 dist（本会话刚为这件事道过歉），所以把它留给 B 自己的第 0 步去量，
  那本来就是它的岗位。
- ⚠️ 同一趟另一件不属于本线、但门禁**响亮抓到**的事：`pnpm check:ui-language` **rc=1**，
  6 处全在 `apps/web/src/lib/local-data-destruction.ts`（诊断字段里写整句中文，会渗进已翻译句子）。
  那枚文件现量是 **`??` 未跟踪**（HEAD 里没有它）⇒ 别人的在飞文件，**不由本会话改**（§8.2）。
  记它的理由是正面的一半：**新落地的文件第一趟就被拦下来，说明这道门有牙**。
- 归属：`common.sync.error.*` 是 vault/账号关闭那条线的词条，两本表此刻都是 `M`（别人在飞）。
  **不由我改**（AGENTS §8.2：不为跑绿动别人的半成品），登记为 B 的第五道前置。

### 3) B 的前置从四条变成五条（现量，01:2x）

`sh -c 'NO_COLOR=1 bash scripts/verify-mobile-window-gate.sh --target b > /tmp/x 2>&1; echo rc=$?'`
⇒ **`GATE_B_rc=3`**，红的两条是**负载 89**（中途 75、13.79 只是两次运行之间的谷底，随即弹回 61）与
**45 枚未提交源码**（00:2x 是 28 枚，涨到 45，含 `packages/i18n` 两本表、`app-host/vault-*`、
`storage/*`、6 枚 `apps/web/evidence/vault-panel/*.png`、`server/tests/*`）。✅ `reinstall-all.sh` 干净、✅ 有 booted 模拟器。
🔴 新第五条 = 上面那枚 TS1117：**B 的第 0 步就是 `pnpm -r build`，它红则 B 连前置都过不去**（这次不是我猜的，是那两臂撞出来的）。
⚠️ **就地更正这句的适用范围（01:28 现量）**：那枚重复键**在那四分钟内就被所有者修掉了**（en/zh 各 2982 键、重复 0），
所以"五条"只对 **01:24–01:28** 成立；写在这里是为了让下一个人认出这个形状 ——
**别人树上的红是有保质期的，登记阻塞必须带"哪一趟"**，否则会有人拿着它去找已经修完的人。

### 4) 这轮顺手修掉的闸门自身两处（都不是为了跑绿）

- **显示分词**：`pass "…$(printf '%s; ' $BOOTED)"` 里 `$BOOTED` 没加引号，
  一台叫 `iPhone Duo heyta` 的模拟器被打成 `iPhone; Duo; heyta`（看着像六台）。
  赋值那一侧（`printf '%s\n' "$BOOTED" | head -1`）是带引号的、**没坏** —— 所以这不是选错目标，
  是"打印出来的东西与真正用的东西长得不一样"，而人会去怀疑错的那一侧。改后现量：
  `✅ 有已启动的模拟器：heyta-iphone-17pro; heyta-ios-isolated; iPhone Duo heyta`。
- **静默选目标 → 可否认**：三台 booted 时 `--confirm` 原来默默取第一台，而 ios 段会 `simctl uninstall`。
  现在外部传的 `IOS_DEVICE_NAME` 优先、没传才回落，并把**取到的整名与来源**打出来；列表为空则 exit 3 不猜。
  三臂配桩（抽真实行 229–234，这次**确认过末行不是副作用**）：
  三台 booted 无外部 ⇒ `[heyta-iphone-17pro]（来源：booted 列表第一台）`；
  外部传带空格名 ⇒ `[iPhone Duo heyta]（来源：外部显式传入…）`；空列表无外部 ⇒ `❌ iOS 目标取不到设备名` 且 **rc=3**。
  ⚠️ 我第一版把这条做成了 `warn`，**它进了 FAIL 计数**，前置从 2 条变 3 条 ——
  而"三台 booted"是这台机器的常态，那等于让 B 永远开不了跑（AGENTS §8.3 天生红的门禁＝没有门禁）。
  已改成纯提示行不计数，复跑确认回到 **2 条前置不成立**。

`bash -n` 过、`check:shell-unicode` **rc=0（83 个 .sh）**。

## 3·补 ⑲ 01:3x：H 的三趟连排第三次没等到窗口；顺手把我自己差点读错的一条日志钉住

### 1) 旧读数按规矩复跑了一遍：H 那两张图仍然站得住

`ls apps/web/evidence/calendar-view-options/` + `git ls-files` + 逐枚 md5 对账：
两张 png（`view-select-closed.png` 72 282 B、`view-tabs-year.png` 96 101 B）与 `README.md` **三枚都在 HEAD**，
盘上现量 md5 与 README 里登记的**逐条相等**（`对账：盘上 2 枚，与 README 登记不一致 0 枚`）。
README 的"看见了什么"两栏都写了**这张图证明不了的**那一半（原生 `<select>` 那层画在操作系统里、
视口只装得下 1–8 月）—— 所以 §6.2 规定一的那一半（人真的看了图）现在是有物证的，不是一句主张。

### 2) 追 flaky 这件事本身第三次没等到窗口（这是环境的读数，不是测试的读数）

`research/tools/h-flaky-window-watcher.sh` 上一趟（预算 2400s）**整趟没开跑一次**，负载轨迹：
`45 → 34 → 25 → 19 → 23 → 21 → 18 → 20 → 16 → 19 → 17 → 15 → 19 → 16`，
收笔行 `❌ 等满 2400s 负载仍是 16 —— 本轮不跑（环境无效，不是产品失败）` + `GATE=timeout rc=3`。
加上此前两趟（00:33 的 900s、00:5x 的），**同一条 flaky 已连续三次拿不到 ≤9 的窗口**，
而这三个小时里负载最高到过 119/255。⇒ 关于那枚 `1 flaky`，本轮**新增的证据是零**，
既没证实也没否证"冷启动付 vite 预打包的代价"这个假设 —— 不许把它写成"排除了"，也不许写成"确认了"。
第四趟已起（预算 3600s，内层 `HEYTA_LOAD_GATE_WAIT` 跟着放大，见 ⑫/⑬ 那条"外层旋钮是装饰"的教训）。

### 3) 🔴 一条差点把我骗过去的日志顺序：死人的尾巴落进了活人的文件

新看守 01:31:53 起，`tail` 出来长这样：
```
start 01:31:53 连跑=3 严格负载门≤9 总预算=3600s
   负载 17 > 12，等 30s（累计 0s）
GATE=timeout rc=3          ← 看着像"新看守一上来就判没窗口"
   负载 14 > 12，等 30s（累计 30s）   ← 而它明明还在 poll
```
我据此准备去修"看守一开机就伪造超时"。真因是：**脚本第 24 行的 `mv "$LOG" "$LOG.prev"` 不等上一趟收笔**——
上一趟（预算到点）在我 mv 之后才把自己的最后两行 `>> "$LOG"` 写进**新文件**（`>>` 按名字打开）。
`pgrep` 现量新进程 **92881 活着**、行序里"累计 30s"还在涨 ⇒ 新看守没坏，坏的是**两根笔共用一个文件**。
📌 形状：**"日志在说 X"之前先确认写这行的是谁**。这次如果我直接改脚本，就会去修一个不存在的缺陷。

⇒ 该改的确实有一处，但**不是现在改**：`bash` 是**边执行边读脚本**的，
对一个正在跑的循环脚本做原地编辑，可能让它从错位的字节偏移接着读。
所以守卫这一笔留到这一趟收笔之后再落（写在这里是为了它不被忘掉）：
默认 `LOG` 带启动时间戳（或开工前 `pgrep` 到同类就响亮退出），
并让 mv 之前先确认上一趟已经不写盘了。

### 4) 两道数的现量 + 一条**不属于本线**的门禁红（按老规矩：登记，绝不代改）

- **§6 第 5 行那条边界重跑**（活树与载体各一趟，同一脚本 `/tmp/ht-guard/webkeys.sh`，三本键一起量）：
  `web.*` **188 处 / 13 文件 / 180 去重键**（两棵树**完全一致** ⇒ 179→188 那笔漂移已经进了 HEAD，
  台账 19:3x 那一行今天仍然对得上）；阳性对照 `common.*` = **111 处 / 11 / 96**；
  `mobile.*` = 活树 **589** vs 载体 **588** —— 多的那 1 处正是别人未提交的一行，
  等于顺手把"活树 ≠ HEAD"量了出来。`ProfileScreen.tsx` 两趟都是 **0**（本屏那条作用域判据仍然成立）。
  ⚠️ 夹具自己一处小坏：`grep -c … || echo 0` 在计数为 0 时**会打两行 0**
  （`grep -c` 无命中时退非零，`||` 那半又补一个）—— 读数没错，但输出看着像量了两次，别误读。
- 🔴 `node research/tools/docs-link-check.mjs` **rc=1**，一处：
  `docs/adr/0050-e2ee-key-lifecycle-and-recovery.md:108` →
  `../../apps/web/evidence/vault-panel/pg-commit-restart-recovery.png`（本机有、git 没跟踪）。
  逐条现量证明**这条红不在 HEAD、也不在本线**：ADR 状态 ` M`（那行链接是未提交改动加的）、
  png 状态 `??`、`git ls-files` 该 png = **0**、`git show HEAD:` 那份 ADR 里这条链接出现 **0** 次、
  同目录另有 **7** 枚未跟踪 png。⇒ **归属 = vault 那条线**，闭合动作是把那笔 ADR 改动与它的证据 png
  一起**点名** `git add`。本会话**不代改，也不替它写进 `UNTRACKED_LINK_OK`**
  （那等于替别人宣称"这些图刻意不进仓库"）。
  ⚠️ 时间戳要说清：01:33 同一命令还是 **rc=0**，01:35 变 **rc=1** —— 这十分钟内没人提交任何东西，
  变的只是别人工作树里的两个未提交对象。⇒ **`check:docs` 量的是索引/工作树，不是 HEAD**（本篇 ⑪ 已记过一次，
  这是它第二次以另一种面目出现：上一次是"别人提交了所以我的红归零"，这一次是"别人写了所以别人的红冒出来"）。
  复跑与判归属：`node research/tools/docs-link-check.mjs`，再
  `git status --porcelain -- docs/adr/0050-e2ee-key-lifecycle-and-recovery.md apps/web/evidence/vault-panel/`。


  ⚠️ **结局（01:36 复跑）：这一处红自己消失了，但不是走我上面写的那条路** ——
  对方把 ADR 第 108 行的链接**改指到另一枚已跟踪的证据图**（`pg-resume-after-…`），png 本身仍 `??`、仍不在 HEAD。
  ⇒ 我那句"闭合动作是 git add 它"只是**三种出路之一**（工具自己打印的就是①入库/②删链/③登记豁免三条），
  把它写成唯一出路就是替别人拍板。同一分钟里 `git log` 还多了三笔**不属于本线**的 docs 提交
  （HEAD 走到 `ae025bad`），而本线那八枚对象**一枚都没被卷进去**
  （`git show HEAD:` 里 ⑲=0、安装守卫=0；工作树里分别是 1 与 2）—— 这次是好事，但它是**现量**不是常态：
  本线历史上被别人的整文件 `git add` 抹回去过一次（⑪ 那节记着）。

### 5) HEAD 走了 7 笔之后，载体那枚 APK 还管不管用（量过，不是假定）

01:39 现量：`git rev-list --count 93113e30..HEAD` = **7**，
`git diff --name-only 93113e30..HEAD` **只列出 1 个文件**（`docs/plans/multi-end-coverage-handoff.md`，别人的交接稿），
命中 C 的源码路径（`apps/mobile/src`、`packages/ui/src/date-picker|calendar`、`packages/domain/src/date|capture`）= **0**，
命中 C 的判据文件（`verify-mobile-due-time`、`task-due-time`）= **0**。
⇒ **01:05 打出的那枚 APK 仍然等于"当前已提交的应用代码"**，窗口一到就射，不必重打（重打要花 ~7 分钟 gradle，
而且会给已经在抢 CPU 的机器再加一份）。这条是 §7 #27 那一族的正面用法：**"产物新不新"要靠"输入差集"判，不靠时间戳。**
同时 `docs/plans/README.md` 现量已**干净**（`git status --porcelain` 为空）⇒ ⑧·附四 那笔"行数回写"的前置
从"README 在别人手里"变成"只等本会话这三份文档改完"，所以仍**不在这一刻执行**（现在写了下一笔编辑就又漂）。

## 3·补 ⑳ 01:4x：窗口没到（负载 454），就把 C 的定位器本体离线预飞了一遍

### 1) 现场读数

`uptime` = **454.88 / 179.55 / 95.12**，设备上有 `.verify-mobile-ios-reminder.sh.snap.21249`（W9 原生投递那条线，
另有两枚同名子进程 40733）在跑；C 的重试装置已累计 **32+ 次 rc=3**，H 看守在 360/3600s 处读到 348–454。
⇒ 这一段时间窗**更远**，所以本轮的动作全部是零设备、零共享路径的离线活。
🔴 有一条纪律在这一步救了我：**没有为了"看看设备现在长什么样"去 `uiautomator dump`** ——
`dump` 写的是**共享的 `/tmp/ui.xml`**（见下面第 3 节），别人那一趟正在读它，
我这一刻 dump 一次就等于把对方的无障碍树换成我的（§7 #83 那个"探针污染状态"的形状）。

### 2) 预飞方法：抽脚本里那 53 行 Python 本体，喂私有夹具

`sed -n '104,156p' scripts/verify-mobile-due-time.sh > /tmp/ht-guard/rid.py`（**不是重打一份逻辑**），
`python3 -c compile(...)` 先证语法，再用一份自己写的 fixture XML（四个节点：带包名前缀的 `task-due`、
裸名的 `task-due-time-input`、带前缀的 `all-day`、以及一枚**负高度**的同名节点模拟被 ScrollView 裁掉的那份）
驱动它的三种模式。夹具路径是私有的，全程没碰 `/tmp/ui.xml`。11 条读数：

| 探针 | 期望 | 现量 |
|---|---|---|
| `count task-due`（写成 `com.heyta:id/task-due`） | 1 | **1** |
| `count task-due-time-input`（裸名，2 枚同名） | 2 | **2** |
| `count task-due-time-all-day`（查裸名、fixture 里是带前缀的） | 1 | **1** ⇒ 两种序列化写法确实都吃 |
| `count task-due-time-nonsense` | 0 | **0**（阴性对照在场） |
| `xy task-due-time-input`，`TAB_Y=900` | 取正高度那枚的中心 | **`255 330`** |
| `xy`，`TAB_Y=330` | 空（中心点 330 不严格小于 330） | **空** ⇒ 折叠线守卫按 `<` 生效 |
| `attr … text` | 第一枚的值 | **`16:0`** |
| `attr … enabled`（input / all-day） | `false` / `true` | **`false` / `true`** |
| `count`/`attr` 打在**空文件**上 | `0` / 空 | **`0` / 空** |
| 未知模式 | 响亮 | **`UNKNOWN_MODE:bogus`** |

🔴 **最有价值的是空文件那一行**：高负载下 `uiautomator dump` 会写成空文件，而"空 dump + 恰好设备上还留着上一次界面"
这两种状态在 `rid_count` 上都长成 `0`。这条判据没有单独的守卫，但它被脚本第 4 节那条**阳性对照**接住了
（连 `task-due` 都看不见 ⇒ 直接判"本轮读数无效"并退出，而不是把后面十一条都记成红）。
所以窗口一到，最坏情形是**早停**，不是**假红**——这正是那条对照存在的理由，现在它有了量过的证据。

### 3) 顺手照出来的一处**半个修复**（登记，不动 lib）

脚本文件头第 89–95 行把定位器 Python 挪成了**进程私有**路径 `RID_PY="/tmp/_heyta_rid_$$.py"`，理由写得很清楚
（共享库被两轮并发互相覆盖）。**但三个包装函数仍然硬编码 `/tmp/ui.xml`**：

```bash
rid_count() { python3 "$RID_PY" count "$1" /tmp/ui.xml; }
rid_xy()     { python3 "$RID_PY" xy "$1" /tmp/ui.xml "$TAB_Y"; }
rid_attr()   { python3 "$RID_PY" attr "$1" /tmp/ui.xml "$TAB_Y" "$2"; }
```

⇒ 同一台模拟器上两趟并发跑，读的是**对方 dump 出来的无障碍树**（比定位器被覆盖更难归因，因为它"看起来是有内容的"）。
今天没暴露，是因为 §8.9 那道设备门已经把同机并发排除了 —— **它被门挡住了，不是被设计挡住了**。
为什么现在不改：`dump` 住在 `lib/mobile-e2e.sh`，而那条文件正被并行会话整片重构（本篇 ⑮ 记过一次现量），
而且把三个包装改成私有路径必须连 `dump` 的写出位置一起改，那是**跨文件改共享装置**，
不属于日历收尾这一批。⇒ 挂 §6 边界（第 10 行），并把闭合动作写成一条可复跑命令。

### 4) 我自己这两把看守的一条相互风险（登记 + 事后核得回来的办法）

`h-flaky-window-watcher.sh`（要负载 ≤9 且 4318/4319 空闲）和 `r14c-window-retry.sh`（要负载 ≤12 且设备独占）
**互不知情**：同一次谷底可能同时开火。这对 C 无所谓（两条资源不撞），
但对 H 那一问是实质污染 —— 我要判的是"`VIEW_SELECT` 首趟 17.7s 不可见是不是冷启动/争用"，
如果那一趟同时有 adb/gradle 在打机器，红与绿都解释不了。
🔴 修法**不在这一刻做**：两把看守都正在跑，而 bash 是边执行边按偏移读脚本的（⑲ 第 3 节那条），
原地编辑可能让它从错位处继续。已落成待办（任务 #7：`mkdir` 锁 + 两侧先查锁），
**过渡期的事后核实**是免费且可判定的：拿 H 日志里每趟 `----- 第 N 趟 HH:MM:SS -----` 的起始时刻，
去 C 日志里找有没有 `ATTEMPT rc=` **不等于 3** 的同一时刻（rc≠3 才说明验收真在跑），
重叠 ⇒ 那一趟**明确写"不作数"**，不拿它算 flaky 计数。
## 4. 计划变更记录（现实推翻预判时才写）

| 时间 | 原判断 | 现在 | 证据 |
|---|---|---|---|
| 22:1x | 「`check:ui-language` **只比键集**，所以值层（英文那条到底翻译了没有）只有我这双语腿在守」—— 这句我当时写进了 `apps/mobile/tests/calendar-view-entry.spec.ts` 的用例标题、`e2e/tests/calendar-day-en.spec.ts` 的文件头，以及本篇 §2 R16 那格与 §3 R16 那节 | 🔴 **前半被现量否证**：V4（把 en 的 `common.calendar.view.year` 抄成 `'年'`）与 V4b（把 zh 那条写成 `'Year'`）两趟，**门禁自己就 rc=1 并指名那一条**。⇒ 值层语言方向**两层都在守**，那条腿在这一维是第二层。而**结论本身没变**（"只有英文腿会红"确实成立），变的是理由：门禁真正的盲区是 ① **代码引用的键名在两本表里根本不存在**（V4c ⇒ rc=0）、② **宿主源码写死中文字面量**（V5 ⇒ rc=0）。三处原句都留在原地，旁边补 ⚠️ 更正（`calendar-view-entry.spec.ts` 的用例标题已改写、`calendar-day-en.spec.ts` 文件头与本篇 §2/§3 已就地标注） | V4：门禁输出「文案：common.calendar.view.year = 年」；V4b：「zh-CN 词条里没有汉字」；V4c：`check:ui-language` rc=0 而 web tabs 2 failed / ui 1 failed；V5：rc=0。🔴 教训形状：**我把一个没量过的门禁覆盖面写成了判据存在的理由** —— 一句"它只比键集"读起来像事实、写出来就是断言 |
| 22:1x | R17 原设计只排了 V1–V4 四支臂，其中 V4 是为了"证明双语腿有牙" | 🔴 四支不够，跑的过程中补出 **V4b/V4c/V5** 三支：V4 红之后我无法回答"那门禁到底管不管这件事"，而这个问题只有把**同一种病在门禁那一侧**跑一遍才有答案。⇒ 变异臂的清单不该在写判据时一次封死：**一支臂红了以后，下一个问题（"还有谁会红？"）本身就是一支新臂**。补的三支里 V4c 才是那条腿唯一的独立维度，V5 顺手把 R16 那节的理由修正了 | 三支的读数都在上面那张表；本篇 §2 的 R17 变异臂那格已改写成"六支全部跑过"并逐支带结论 |
| 22:2x | （不是判断被否证，是**门禁在本批新增的内容上抓到真错位**）我新写的「R17 的六支变异臂」那张表里，V3 那一行的代码段写了个裸 `\| tail` | `node scripts/check-md-table-rows.mjs` **rc=1** 点名 `calendar-year-time-and-mobile-profile.md:338 列数 5（本表表头是 4）` —— 与前两次（M9/M10）都是**人为注入**的臂不同，这一支是它自己在我刚写的内容上红的。修成转义后 rc=0 | 这是那道门"有牙"的**第三条**证据，也是唯一一条非自造的一条：code span 里的裸竖线会加出一整列，而 GFM 会把它渲染成多一个单元格 ⇒ 表在界面上悄悄变形 |
| 19:1x | 台账里「R14 交付了时刻输入侧」这句读起来像**两端都接上了**（那一行的落点列同时写着 `DatePicker 时刻栏` 与 web `DueEditor` 接线，读数全绿） | 🔴 **移动端根本没接**。现量三条：`grep -rn dueTime apps/mobile/src` = **0 行**；`grep -c "time=" apps/mobile/src/screens/TaskDetailSheet.tsx` = **0**；而 `packages/ui/src/date-picker/DatePicker.tsx:72-73` 自己写着「整个 prop 可选 —— 不传就一个节点都不画，所以现有消费者（移动端任务详情）渲染出来的东西与改动前逐字节相同」。⇒ 这不是"忘了做"，是**判据的形状**：R14 的判据全打在共享层与 web，移动端那条线**没有任何一层会报缺失**，而"唯一判定在共享层"这句话被当成"每个宿主都用上了它"读。批次②的收口因此重开为 R14c，R14 那行原句不动 | 两处 `<DatePicker>` 调用点在 `TaskDetailSheet.tsx:687` / `:730`；上面那句注释在 `:72-73` |
| 19:2x | 时刻那一行的四句措辞，我原本按 mobile 的既有惯例准备**新写一份 `mobile.due.*`** | 🔴 改成把 `web.due.{timeLabel,allDay,timePlaceholder,timeAria}` **改名**进 `common.due.*`，两端读同一份。三条现量把方向定死：① 本会话 R15a 的判据（`profile-nickname-entry.spec.ts` 第 3 条）明写「移动端不许读 `web.*` 命名空间的键」；② 台账 §6 第 5 行登记的正是这笔债，而它**没有门禁、只有台账里的一个数**（R15a 写的是 179 处，R14c 重跑同一条命令 = **188 处 / 13 个文件**，`common.*` 从 76 涨到 111 ⇒ 只会涨）；③ 改名比抄一份便宜：这四键的消费者只有 `DueEditor.tsx:205-208` 四行 | 全仓正则 `web\.due\.(timeLabel\|allDay\|timePlaceholder\|timeAria)`（排除 dist）= 4 行引用 + 两份表各 4 行定义；`pnpm --filter @heyta/web typecheck` **rc=0** ⇒ 没有第五个消费者藏在类型里 |
| 19:3x | 变异臂 M7「往表里留一份 `web.due.timeLabel` 旧抄件」我按"只改 zh 一处"写了 | 🔴 那一支红的不是判据，是**构建**：`en` 表是 `satisfies Record<MessageKey, string>` 而 MessageKey 来自 zh，只改 zh 会让 en **缺属性**，tsup 的 DTS 阶段直接 rc=1（真实报错原文：`src/locales/en.ts(1228,3): error TS2353: ... web.due.timeLabel does not exist in type ...`）。结论要分开写：**键集对等由类型层守着**（已够用），而"值层留双份同义键"是类型层放行的一种漂移，所以反抄件判据必须打在**两份表同时留旧键**上 = 新臂 M7b，实测红在判据那一条 | M7：`build_rc=1` ⇒ 臂标"无效"，没算进红数；M7b：`build_rc=0` + `Tests 1 failed` + 断言原文「表里还留着 web.due.timeLabel」，还原 `digest_match: true` |
| 19:3x | 变异脚本第 1 版：跑完全部臂**才**打印结果，还原写在读数之后（没进 `finally`） | 🔴 M7 那支 build 失败 → assert 抛出 → 进程终止，于是 ① 9 支读数**全丢**（什么都没落盘），② `en.ts` **被留在变异态**（事后单独查：`stale_mutation_hits 1`）—— 如果不是下一趟 build 恰好因它而红，那行旧键会跟着我后面所有读数走。第 2 版三条硬化：还原进 `finally`、每支臂跑完**立刻**写 JSON、先跑一次基线并断言它是 0 failed（基线不绿就不许开始数红） | 第 2 版 9 支全部有读数、`digest_match: true`；事后单独把那一行删掉并重建（`build rc=0`）|
| 19:3x | 「`grep -c "time=" 某文件` 报了个空」我就当成"命令跑过了、结果是 0" | 🔴 在 `A && B && C` 这种链里，`grep -c` 命中 0 时 **exit 1** ⇒ 链当场断、后面的命令**根本没跑**，而"没有输出"和"跑了但 0 命中"长得一模一样。这一批我差点把两条 0 命中写成没取证的事实。改法：数 0 的读数写成**独立命令**并自带标签前缀（`echo -n "occ: "`），或者用 node 打印计数 | 断链那次的退出码 1 来自 `grep -c`，不是来自后面的语法检查 —— 输出里根本没出现后一条的标签，那是线索 |
| 19:3x | §6 第 5 行那句「179 处」 | ⚠️ 已过期：**188 处 / 13 个文件**（R14c 逐字重跑同一条命令）。这不是"数字写错了"，是那条边界**没有门禁**，所以台账里的数只会落后于现场。下次动它的代价（已量形状）：照 `check:l4` 的做法把"只减不增"钉成基线 —— 基线取当前 188，红了就要么真减、要么显式改基线 | `grep -rho "'web\.[a-zA-Z0-9._-]*'" apps/mobile/src \| wc -l` = **188**；同趟阳性对照 `common\.` = **111**（原句里那个 76 也一起漂了 ⇒ 两个数都该重跑，不能只跑一个）|
| 04:24 | §5 第 3 条"R15b 卡在 document-picker 依赖裁决" | 该门**已由另一条线过完**；R15b 的真实成本换成了"原生 base64 读通道 + iOS 模块 + 相册可达性" | `apps/mobile/package.json:31`（12.0.2 已装）· `ExportScreen.tsx:67,224`（已 import 并在生产用，注释原文"批五依赖裁决"）· `LocalFsModule.kt:49`（`Charsets.UTF_8` 强转字节） |
| 04:24 | §2 R14 那格原先写"docs 里有没有明文否决过（调研中，不许跳过）" | 查完：**没有 ADR 否决**；`ai-handoff.md:278-283` 那句"需要一次产品决策"的前提（"没有字段能装"）已被否证 | `entities.ts:128` `dueDate?: number` 本就是 epoch ms · `ticktick-import.ts:393-396` 与 `packages/ui/tests/capture-model.spec.ts:267` **早就写入非零点** |
| 04:24 | 立篇时对 R13 的预判"复用月格" | 复用点在**数据形状**（`monthGrid` + `calendarDayTone`），但 `DayCell` 不参数化 —— 它的 props 全是"日"形状、格子尺寸硬编码、`testIDOf` 写死 `calendar-cell-<日期>`，而年格是 `YYYY-MM` | `CalendarBoard.tsx:135-288`（`DayCell`）、`:291`（`testIDOf`）· `:654-660`（单一 `cell` 尺寸） |
| 05:52 | §2 R13 判据第 ⑥ 条"年档**不画**页脚那两块" | **写反了**：页脚那句（"未设截止时间的任务不在日历上"）在年档同样必要，撤掉它才会让"任务没设时间"被读成"任务丢了"。判据改成**正向断言它在** | `CalendarBoard.tsx:573` —— `labels.footnote` 挂在根上、在四个档位分支**之外**；变异臂把它撤掉时 `calendar-year-board` 那条由红转绿的是**反向**的 |
| 05:52 | §2 R13 落点第 ⑦ 条"web 读 token 判列数、移动端不传 ⇒ 单列" | 列数规则**整条搬进共享层**（`calendarYearColumns(fits)`），宿主只负责量宽度。理由：`fits → 列数`是"该分几行"的判断，不是平台差异（AGENTS §3.5）；而 jsdom 从不触发 `onLayout` ⇒ 这条规则在单测里**只能**按函数测，按渲染测会得到恒假判据 | `packages/ui/src/calendar/model.ts`（`calendarYearColumns`）· 判据 `packages/ui/tests/calendar-year-model.spec.ts`（A2 那支红证明它有牙）· 真浏览器那一份在 `e2e/tests/calendar-year.spec.ts` 第一条 |
| 05:52 | 第一版把年档"今天有标记"写成**比 `style` 属性**（探针），并把标签夹具在测试里**手拼一份** + `as unknown as CalendarBoardLabels` | 两件都换掉：① 今天改由平铺 `aria-current="date"` 承载（读屏本来念不到"哪天是今天"，这是真缺的不是脚手架），判据比属性不比样式；② 标签走宿主自己那份 `useCalendarLabels()`（经探针组件 + `LocaleHost`），强转整个删掉 —— 强转把标签契约的类型检查关掉了，判据就只是在对着自己的夹具打分 | ① 实测 `getAttribute('style')` 两格都是空串（RNW 把静态样式落到 **className**）；② `pnpm --filter @heyta/web typecheck` 在删掉强转后立刻报出模板字面量键不匹配 `MessageKey` —— 那条红本来就是强转压住的 |
| 05:52 | 我以为"档位名那张表只有移动端要改" | 移动端 `viewLabels.name` 与 web 测试夹具 `calendar-view-tabs` 的 `name` 是**同一个三层嵌套三元**的两份，兜底那一支都是「日」：加一档不改进去，**年会念成「日」**（类型合法、词条都在、界面看着正常）。两处都换成按键取值映射，并各加一条判据钉住 | `apps/mobile/src/screens/CalendarScreen.tsx:300-308` · `apps/web/tests/calendar-view-tabs.spec.tsx` 的 `render()` 与「档位名来自词条表」那条（现在**四档逐档**比） |
| 05:52 | 预判"`check:ui-language` 是中英对等唯一守卫" | 英文表少一条键时 **`@heyta/i18n build` 本身就红**（类型层），门禁只是第二道。A9 那支同时打红三处 | 变异臂 A9 读数：`build rc=1` + `check:ui-language rc=1` + `calendar-view-entry` 1 红 |
| 06:16 | 以为"12 张卡分了行"这条判据（量卡的位置）足够保证**卡里面**也摊开 | 不够。第一张截图里 12 张卡排成 4×3 全对，而每张卡里 31 个数字挤在一行互相压字 —— jsdom 那 12 条数的是**节点数**，真浏览器前 3 条只量卡的位置。判 UI 必须有 UI 特征，"格子在不在"不等于"格子摆对了" | 修：`monthGrid` + 显式行容器；两条新判据分别钉结构与位置，A14（退回 `flexWrap` 老写法）读数 `本月格子只占 10 个横位`、同一行以 6.7px 间隔排开 31 格 = 那张截图的形状 |
| 06:16 | 以为"补白格与格子用同一套 flex 值就等宽" | 不等宽。`flexBasis: 0` 在 `box-sizing: border-box` 下**不能小于边框宽** ⇒ 带 1px 边框的格子基宽 2px、无边框的补白 0px，同一行里两者差约 2px，缺格越多整行差得越多（月初那行差 4px）。改成**补白格直接用同一份 `styles.day`**（空的那一份），让"两套同形样式"根本没有第二套可漂 | A12 读数 `格子 x=656.4 离最近那列表头差 3.4px ⇒ 行与行没对齐`；修后 e2e 3/3，`year-bottom.png` 里 10 月月末那行不再左移 |
| 06:16 | 把"8 个横位"那一枚红读成**组件坏了** | 一半是**探针**：`-day-YYYY-MM-` 前缀同时吃掉 `-dot`，那颗 8px 的点居中落在 x=729.1，被数成第 8 列。排掉点之后红仍在，但差的是另一档（上一条的 4px）⇒ 两条判据分工：数横位（容差 6px）挡"挤成一行"，比表头（容差 1.5px）挡"行与行错位" | A13（探针变异：去掉 `:not([data-testid$="-dot"])`）读数 `本月格子只占 8 个横位`；容差为什么取 6px 写在 `clusterCount` 注释里 |
| 06:16 | 猜"侧栏迷你月历大概有同一个 4px 毛病"（§6 第 2 条那对'同形状的第二次'） | 现量后**不成立**：侧栏把上/下月的日子**也画出来**，每行 7 个**同样**的格子，没有"无边框补白"这一档 ⇒ 无此缺陷，不修。§6 第 2 条那笔登记照旧（它说的是可点粒度不同，不是宽度） | `apps/web/src/features/calendar/CalendarSidebar.tsx:113` —— `inMonth` 只切 `ht-sidebar__day--outside` 这个**淡化 class**，不切节点结构 |
| 07:05 | `e2e/tests/calendar-day.spec.ts` 文件头第 19–25 行那句"这里播不了带时刻的任务：`parseCapture` 不解析 `16:00`…所以小时轴在真数据下本来就是空的" | **被现量否证**（两件事都反了）。原句留在原地加 ⚠️ 更正，因为它是"注释会过期"的活样本；这一档从此**必须**验"轴上画了东西" | `packages/domain/tests/capture.spec.ts` 的「时刻」那组（72 passed）· 新判据 `e2e/tests/calendar-day.spec.ts` 第 4 条（读数：5 passed / 9.4s） |
| 07:05 | `DueEditor` 的面板估高在判据里手抄了一份 `500` | 抄件**一定会漂**（这就是 §7 元规则那一族）。改成从生产方导出 `DUE_PANEL_HEIGHT_ESTIMATE = 540`，判据 `import` 它并把算术写在注释里 | `apps/web/tests/due-date-edit.spec.tsx` 的 `const PANEL = DUE_PANEL_HEIGHT_ESTIMATE;` + ⚠️ 更正；改后 15 passed |
| 07:22 | 我给时刻标签起的 testID 用 `-hour-label-NN`，理由是"它就在小时那一行里" | **前缀是别人的判据名**：`^calendar-board-day-hour-` 数的是"轴上有 `HOURS_IN_DAY` 行"，加上标签之后当场 24→48。时刻列改名 `-clock-NN`、那一小时的任务列表改名 `-timed-NN`（原名 `-hour-list-`，同一处撞号、零消费者所以直接改），并把"前缀归属"写进两条判据的注释 | 变异前那次真红读数：`Locator: '[data-testid^="calendar-board-day-hour-"]' Expected: 24 Received: 48`（34 × 48，重试两次同形） |
| 07:22 | `hourLabel` 注释里那句"定宽 `space.8`，与月档周次列同一档位，不新造 token" | **理由成立、取值不成立**：32px 装不下 14px 的 `23:00`，两字小时全部折成两行。换成 `space.12`（48px，同一族既有 token，仍不新造），并且不取刚好够的 40 —— 那列不该依赖"刚好够" | 真浏览器实测 `height 42 / lineHeight 21`、`overflow=false`，命中 14 行（10:00–23:00）；单行的 0–9 不受影响 = 那张截图的形状 |
| 07:30 | 🔴 「敲 16:00 之后一条 op 都没有」我第一反应判成**产品坏了**（而且时间点上正好撞上并行会话在重建 `packages/op-log`） | 不是。真原因是**判据读得太早**：`onSetDueDate` 里写的是 `void setDueDate(...)`，然后靠"await 一次 engine 查询"把写入链冲完 —— 那是赌引擎在一个微任务里落盘。op-log 那边给 `dispatch` 加了串行队列（`serialize()`），落盘多排一个 tick，赌注就输了 | **两条独立证据**：① 只读探针（复制一份判据、在每次读 op 前加一次 `setTimeout` 排空）⇒ 6 红里**恰好 3 条转绿**，剩下 3 条只是因为我的 R14 用例用了别的变量名、探针没插进去；② 改成**拿着 store 返回的凭据 await**（`drainWrites()`）后同一文件 **15 passed**。⇒ 反向结论已写进判据注释：**判"0 条"的用例必须先排空写入，否则那个 0 可能只是"还没写完"**（假绿，比假红贵） |
| 07:12 | 「敲 16:00 ⇒ 恰好一条 UPD」第一次跑出 3 op 而不是 4 | React 的 `task` prop 是**快照**：播种那次写入之后不重渲染，组件还以为时刻是 16:00，于是"再敲 16:00"是写同一个值 ⇒ op 层判重、没有新 op。这条**不是**产品缺陷，是判据自己造了一个 dedupe 场景 | 修法与理由写在 `apps/web/tests/due-date-edit.spec.tsx` 那条用例里（重新 `renderEditor` + 重开面板再打字） |
| 07:12 | 提交一次之后继续在 `container` 里找时刻输入框 | 面板有**两副身体**（`<details>` 内的在流卡 / Portal 的 fixed 卡），提交后元素离开 `container` ⇒ `querySelector` 得到 `null`，看起来像"那一栏消失了"。改从 `document` 找 | 同文件 `typeTime` / `clickByTestId` 的注释（两处都点名"两副身体"） |
| 07:15 | 「非法形状不写库」原本断言**框里显示什么**（`expected '09:30' to be '25:00'`） | 那是**显示形态**，而且实测它会被面板换身体时的重挂载牵动 —— 拿它当判据会测到脚手架。改成产品结论（**一条新 op 都不产生** + `disabled === false` 证明通道是通的），"打字真送到组件"这件事交给同 `describe` 里那条正向用例 | 该用例的注释原文 + A10 变异臂读数（`failed=1`，红在"非法形状"这条而不是红在探针） |
| 08:01 | 「本机工具只报日」这件事的**修法**：我原本按 R14 现场那条注释的思路走「给 `LocalApiItem` 加一个 `dueTime`」 | 🔴 **不加字段**。同一个 `dueDate` 键多带一段 `T16:00`。原思路要同时改五处（两处白名单投影 `tools.ts:411`/`:448`、MCP 输出 schema `mcp.ts`、两份 `egressFields` 出境披露清单 `tools.ts:97`/`:109`），**少改最后一处就是"把没披露过的字段送出去"**；同键方案一次绕开这五处，代价只是格式说明要改（已收成一份 `LOCAL_API_DUE_FORMAT_HINT`）。判据补在投影与非法形状两层，披露层由 `check:ai-tools`/`check:ai-coverage` 现量 rc=0 守住 | `grep -n "egressFields" packages/local-api/src/tools.ts` 共 9 行，其中**含 `task.dueDate` 的恰好 2 行**（`:97`/`:109`）⇒ 字段级披露确实存在；`local-api-host.spec` 32 passed 中新增 5 条，A14–A18 五支变异逐支红 |
| 08:55 | 产品负责人给了一张 macOS 壳的截图并问"有的内容超出容器范围之外了" ⇒ 我第一版判断是**月格里第一行日期跑到星期表头上方**（凭印象读图） | 🔴 **读图读错了**，且真因不在当前源码。重新逐行看图：顺序是 表头 → 9周…14周，**没有错位**；真正跑到容器外的是**当天那张卡**（底部越过窗口下沿，脚注那行完全看不见）。然后在真浏览器里量当前源码同一状态：视口 1280×720、zh-CN、2026 年 3 月（6 行月），卡片 `[328,80,928,359]`、表头 y=93、第一行 y=122、**溢出到卡片上方的元素 0 个**、脚注 y=697 < 720 ⇒ **当前源码放得下**。差的是产物：装进 .app 的 `web-dist` 与本机 `apps/web/dist` 是**两次构建**（9 个 chunk 里 4 个哈希不同），且 `now-line`/`clock-` 两个标记在包内 JS **0 命中**、本机产物各 1 命中 ⇒ 包里那份**早于 R13/R14**：日历工具栏还在卡片里（多占一行）、行更高，于是把当天卡顶出下沿 | `/Applications/Heyta.app/Contents/Resources/web-dist/index.html` mtime 14:12 vs `apps/web/dist/index.html` 16:36；`diff <(ls …/app assets) <(ls apps/web/dist/assets)` 四条差异；两次真浏览器量取的 rect（探针在 /tmp，读数抄在上面） |
| 08:56 | 「这条不是判据的锅，重装一遍就好」 | 不成立 —— **已有判据全绿**：mac 段的"截图非空白 + 主蓝命中"量的是"有没有界面"，回答不了"是不是这份源码的界面"（AGENTS §7 第 82 条的第四次露面，前三次是 .app 没打 web-dist、APK 里旧 bundle、Windows 装了旧树）。所以当场补了两条**会判定**的：① `package-app.sh` 在拷 `web-dist` 前比**产物的输入**（`apps/web/{src,public,index.html}` 与 `packages/*/src`、`packages/*/dist` 任一文件比 `dist/index.html` 新 ⇒ `exit 1`，且**刻意不顺手重建** —— 打包脚本替并行会话重建共享 dist 会把他们的 WIP 打进产品包）；② `reinstall-all.sh` mac 段装完后比 `.app 内 assets 文件名集合 == apps/web/dist/assets`（Vite 文件名是内容寻址哈希 ⇒ 集合相等即构建相等），并把 `MAC_DIST_OK=1` **并进 `RESULT_mac=OK` 的条件**，否则又是一条"只打印、不判定" | 五组在位读数（用 `sed -n '85,106p'` / `'209,223p'` 抽脚本原文跑，不抄副本）：A1 当前真树 **exit=1**（点名 `packages/domain/src/search.ts` + 6 个 domain dist 文件）；A2 阳性对照（把产物 mtime 设到未来）**exit=0** ⇒ 这条不是恒红；B1 集合相同 `MAC_DIST_OK=1`；B2 本机多一个 chunk `=0` 并打印 `1a2 > index-DDD.js`；B3 包里没有 assets `=0` 且报"对账没有分母"。两脚本 `bash -n` 通过 |
| 08:12 | 原计划「给移动端新增一套 `mobile.profile.nickname.*` 键」（web 那份留着不动） | 🔴 否证：改名爆炸半径实测**只有 1 个消费者文件、24 处引用、零测试引用、零服务端引用** ⇒ 直接改命名空间比再抄一套便宜。改成 `web.settings.profile.*` → `common.profile.*`（**19 个键**）。理由不是好看：`web.*` 描述的是"哪个壳画的"，移动壳读它 = 界面上的话由另一个产品来说，而且同一句话两份事实源必漂 | `grep -rn "web\.settings\.profile\." apps packages server \| wc -l` 改名前后对照；改后 `check:ui-language` rc=0、表计数 zh/en 各 **2851** |
| 08:18 | 想顺手写一条常驻判据「全仓 `apps/mobile` 不许读 `web.*` 键」 | 🔴 否证：现量 **179 处 / 11 个文件 / 172 个去重键**（`grep -rho -- "'web\.[a-zA-Z0-9._-]*'" apps/mobile/src \| wc -l`，同趟阳性对照 `'common\.'` = 76 处 ⇒ 不是正则没跑）。这条判据一写出来就是红的，而红的全是别人家的既有代码。收窄成**作用域限在 `ProfileScreen.tsx`**（本屏命中 0）+ 同形状阳性对照，整片改名挂 §6 第 5 行登记 | 上面那条命令的三个数；`profilescreen_hits=0`； 我**第一次**跑这条命令时把 pattern 放进双引号的 `$( )` 里，`\"` 变成字面 `"` ⇒ 输出 **0** —— 一个假 0。台账里的数是换成 `-- "$PAT"` 传参重测的第二次读数 |
| 08:22 | 「词条中英同步了 `check:ui-language` 就会绿」 | 该门禁 rc=1，而原因不是漏翻译：英文值我写成双引号 `"Couldn't save…"`，而它要求**一行一条、key 与 value 都用单引号、内部引号转义**（`'Couldn\'t …'`）。它的失败形态是"看起来像一条词条但解析不了"，报的是形状不是语义 | 改成房式形状 + `pnpm --filter @heyta/i18n build` 后 rc=0 |
| 08:24 | 我自己在 mobile spec 里写的 `["\'][^"\']*nickname["\']` 恒 0 命中，第一反应是"键没进表" | 探针坏了：英文值里有撇号（`Couldn't`），正则从 `'Couldn` 就截断。改成按行的 `/^  'key':.*nickname/imu` 后命中 | 该文件里这条注释原文；改后 9 passed |
| 08:26 | mobile 新 spec 用仓库相对路径 `apps/mobile/src/...` 读源码，ENOENT | `pnpm --filter @heyta/mobile` 下 vitest 的 cwd 就是 `apps/mobile` ⇒ 一律改 `new URL('../src/...', import.meta.url)`（本仓既有 mobile spec 全是这个形状） | 该 spec 文件头注释 |
| 08:32 | 「R14 已经把 `due-date-edit` 改成等 store 返回的 promise（`drainWrites`），落盘时序问题就结了」 | 🔴 不够。全量套件红 1 条（「清除」按钮不存在）而**单跑 15/15 全绿** —— 不是 flake，是时序：`setDueDate` 在**入队之后**就 resolve，组件读的是**已物化**快照；全量里前面几百个用例压满 CPU，物化被推到 tick 之后。修法是**等条件**不等 tick：新增 `waitUntil(label, done, limit=200)` + `seedDue(due)`，把**全部 4 处**播种点换掉 | 换完全量 `web 1552 passed \| 12 skipped`、**0 failed**；抄件家族的最新读数与终点判据（四个数全为 0）写在 §6 第 4 行的追加里 |
| 09:1x | 「移动端要新写一份首字母与 dataUri 的拼法」（第一版计划里这就是两行壳内代码） | 🔴 否证：web 里**已经有两份**首字母实现（`AccountMenu.tsx` 的 `local.trim().charAt(0)` 与 `ProfilePanel.tsx` 的另一套），dataUri 也有两份（`ProfilePanel` 与 `avatar-encode` 侧）⇒ 在移动端再写就是**第 3/4 份抄件**。改法：`avatarInitialFromEmail` / `avatarDataUri` 进 `packages/shared-schema`，两个壳都改成消费它（首字母从**两份并成一份**，不是"从一份变两份"） | `apps/web/src/features/shell/AccountMenu.tsx` 里那段本地 IIFE 已删除；`profile-avatar-entry.spec.ts` 用 `not.toMatch(/\.split\('@'\)/u)` 钉住"壳里不许自己算首字母"，B5 那支变异红在该判定上 |
| 09:2x | 🔴 **我自己把一份判据文件清成了空文件**：变异/改写脚本里 `io.open(path,'w')` **先截断**、`encode()` 在后面，而 Python 非 raw 字符串里的 `'\ud83d'` 是合法 `\uXXXX` 转义 ⇒ 产生**孤立半代理** ⇒ `UnicodeEncodeError` 在文件已被截断**之后**才抛。`packages/shared-schema/tests/account-avatar-plan.spec.ts` 当场变 0 字节 | 这条**不是产品的坑是脚手架的坑**，所以两处都修了：① 该 spec 从零重写（10 条 → 15 条，新增的两个家族正是 B5/B6 打的对象）；② 变异脚本的写盘改成 `write_atomic()` —— **先 `body.encode('utf-8')` 成功**、再 `mkstemp` + `os.replace`，编码失败时目标文件逐字节保持原样。📌 一般规律：**截断式写入 + 后置编码 = 一次抛错就毁文件**；写源码一律走"临时文件 + rename"，emoji/中文测试数据尤其危险 | 事故当场输出 `UnicodeEncodeError: 'utf-8' codec can't encode character '\ud83d'`；`ls -l` 时该文件 0 字节；重写后 15 passed；`/tmp/r15b-arms.py` 文件头第 2 道自检就是这条 |
| 09:3x | 我给 R15a 写的那条判据 `saveBody()`（取到文件结尾）里断言"不出现 `avatar.failed`"，被**本批**加头像段照红 | 判据**测的不是它声称的东西**：它想钉的是"昵称失败别说成头像"，实际钉的是"这个文件从那一行往后永远不许出现 `avatar.failed`"。邻座功能（头像）加进来是**合法改动**，红是判据越界。改成把切片**收尾在明确的边界**（`const [avatarHash`），并把这句理由写进注释 | 改后 `profile-nickname-entry` 9 passed 复原；本批没有为了让它绿而删掉任何头像代码 |
| 09:4x | 两处**探针自身**的错（症状都是"读数看起来很像回事"）：① `lsof -ti tcp:4318 tcp:4319` —— lsof 不认第二个裸参数，它打印 usage 后退出，`wc -l` 量到的是 **0**，于是"端口空闲"是个假 0；② `pnpm --filter X test -- profile-panel` —— vitest 的过滤参数**没有生效**（app-host 实际跑了 48 个文件、mobile 跑了 38 个），我以为是单文件 | ① 正确形状是 `lsof -ti -i tcp:4318 -i tcp:4319`（每个端口各带一个 `-i`），改后现量 **4318: 59 / 4319: 59** ⇒ 别人**正在**跑 e2e，本批的真浏览器取证与 dist 重建因此都排在后面；🔴 这类"空闲判定"写错的方向是**危险的假绿**（它决定我敢不敢重建 dist）。② 整包全量跑反而是更强的读数（0 failed 覆盖面更大），但**成本是别人的负载**（当时 loadavg 30.46）⇒ 后续单文件一律 `pnpm --filter X exec vitest run tests/<file>`（这条形状在本文件里到处在用，本来就该照它） | 假 0 那次输出的是 lsof 4.91 的 usage 文本 + `0`；改后两个数分别 59/59；`/tmp/r15b-readings-a.txt` 里留着那 12 行 usage。⚠️ **18:5x 追加更正：上面「改后现量 4318: 59 / 4319: 59 ⇒ 别人正在跑 e2e」这句也是坏的**（坏在第二个探针上，不是第一个）—— 见下面 18:5x 那行。方向是**假红**（把空闲报成被占），代价是本批的真浏览器取证白等了三个多小时，而不是放行了一次危险的重建 |
| 09:5x | §2「R15b 会撞谁 ②」在 09:3x 写下的是**当时**的产物状态（`packages/ui/dist` 缺 `index.d.ts` ⇒ mobile typecheck 209 error） | 🔴 **20 分钟后自己过期了**：并行会话 17:46 重建了 `packages/ui`，`index.d.ts` 出现、`archivedProjects` 进产物、`mobile typecheck` **rc=0**、web 全量 **0 failed**。原句留原处加 ⚠️ 更正，不删。**一般规律：登记"被别人在飞的东西挡着"时，那句话的保质期取决于对方什么时候重建**，所以收口必须重量一次再决定要不要立 §5 条目 —— 这次就没有新增阻塞条目（差点把一条已经关闭的事写成长期债） | `ls -l packages/ui/dist/index.d.ts`（mtime 17:46）· `grep -c archivedProjects packages/ui/dist/index.js` = 2 · 四段 `pnpm --filter … typecheck` 全部 **rc=0**（不带管道重跑） |
| 18:1x | R16 那条 spec 的**文件头**写着 `common.calendar.dayNoTimed` 是「zh 25 字 / en 101 字符」 | 🔴 **那两个数字是我凭记忆写的，表里查不到**。现量（`node -e` 按词条表那一行取 `m[1].length`）：zh **29** / en **83**。文件头已改成实测值，并把原句留在旁边当反面教材 —— 它不是判据，但它是一条**写进仓库的断言** | `grep -n "dayNoTimed" packages/i18n/src/locales/en.ts` 那一行整句 83 字符 · `grep -rn "101" docs/plans/` 只命中 `check:l4` 的**内联样式行数**（`apps/mobile/src/screens` = 101），与文案无关 ⇒ 那个 101 是从另一件事串门过来的 |
| 18:1x | 我那条"确认 testID 在不在"的 shell 探针（`grep -rl "\"$t\"\|…"`，引号在 zsh 里被拆坏）报 `calendar-board-day`、`…-no-timed`、`language-option-en`、`profile-avatar-file` 等 **files=0** | 🔴 **探针坏了，不是元素不存在**。改看两处独立证据后全部命中：`CalendarBoard.tsx:406` 是 `testID={`${testID}-day`}` 而 web 给 `CalendarBoard` 的基名是 `calendar-board`；同一个前缀在**已经跑绿**的 `e2e/tests/calendar-day.spec.ts` 里逐条在用。`language-option-en` 在 `LanguageSwitcher.tsx:67`，`profile-avatar-*` 五枚在 `ProfilePanel.tsx:276/289/317/321/328` | `grep -rho "data-testid=\"[a-z0-9-]*calendar[a-z0-9-]*\"" e2e/tests \| sort -u` → **19 条**，我用的每一条都在里面。⚠️ 记这行的原因有**两层**：① 它差点变成一条假的"日档没有 testID"缺口写进 §5（§7 元规则 1 的第五种面目，而且发生在我自己的探针上）；② 🔴 **我在这同一分钟里犯了两次同一个错** —— 上一行刚写完"数字要么当场量要么别写"，下一行就凭印象写了"20 条"（现量 19）。所以这条纪律不能靠"我记得要量"，只能靠**把数字写成一条可重跑的命令**（本行就是） |
| 18:1x | 「头像这条 E2EE 已经有判据了」（往返能解开 / 错口令解不开 / 原图字节不在里面） | 🔴 那三条**拦不住把明文 `content_type` 加回出站 body** —— 而那正是 `hosted-auth.ts:976-979` 记过的、已经作废的第一版设计。M15a 实测：**failed=1，而那 1 条是本轮新写的**，其余 13 条全绿。缺口已补成常驻单测（`packages/app-host/tests/hosted-account-profile.spec.ts`：① 出站键集恰好 `['cipherBase64']` ② 四枚 needle 在明文载荷里逐枚找得到（正向对照） ③ 用 `Buffer.includes` 在密文**原始字节**里一枚都不许有 —— 不先 `toString('utf8')`，因为密文不是合法 UTF-8，解码插替换字符会把跨界那枚 needle 无声吃掉）| 读数见 §3 臂表 M15a/M15b（b 那支 **failed=5**，证明③不是永真弱断言）。还原后 app-host 全量 **48 文件 / 1000 passed / 0 failed**、typecheck **rc=0**、两支臂 sha256 逐字节还原 |
| 18:2x | 「台账写坏了，下一个会话会看出来」—— 我按这个前提写了三小时 | 🔴 **没有任何门禁看得见 markdown 表格的结构**：`grep -rl "列数" scripts/` **本轮之前**为空（现在它唯一命中就是我刚加的那份 —— 所以这条只能在加它之前读，读法：`git show HEAD:scripts/` 里查），而 `check:docs` 是**死链**检查器（`research/tools/docs-link-check.mjs`）—— 它问"链接指向的文件在不在"，不问"这一行渲染出来是不是它自己"。机器一查就是 **7 处**（本篇 4：三行少一个分隔符 + 一行代码段里的竖线没转义；`ui-review-fill-zh-timeline.md` 3：两处把长行折成物理续行 + 一处未转义），已全部修掉并补了一条常驻检查 | 新脚本 `scripts/check-md-table-rows.mjs`（零依赖、不需要构建）。🔴 **它能失败**，三支臂各验一次、每支都逐字节还原：T1 拿掉一个分隔符 ⇒ rc=1「错位 1 处」；T2 把 `view?: 'month'` 后面那枚联合竖线的转义拿掉（写成裸竖线） ⇒ rc=1「错位 1 处」；T3 把一行折成两个物理行 ⇒ rc=1「错位 **2** 处」（前半行的列数也跟着变 —— 一个缺陷两种症状，一次报出）。三支还原后都 rc=0 |
| 18:2x | 「我写的台账是干净的 —— 上面那 7 处是别人的」 | 🔴 **新门禁上岗第一趟就抓到我自己刚写下的两处**：§4 那行把一枚裸竖线写进了代码段（列数 4→5），§5 第 6 行把"在谁手里"和"解锁判据"合成了一格（4→3）。两处都已修，修完 rc=0。⚠️ 这条不是自嘲，是**这条门禁为什么必须常驻**的证据：同一类缺陷我在 18:1x 那三行里修了 4 处，接着自己又造了 2 处 —— 靠"写的时候小心"挡不住，只有机器能挡 | 读数：`node scripts/check-md-table-rows.mjs` 首次跑 ⇒「错位 2 处」逐行带 `文件:行号`；改后 ⇒ rc=0。同时 §3 臂表的条数命令仍报 **16**（改文档没有碰到臂表） |
| 18:2x | §5 第 2 行那条给下一个人的入库命令（`git add … apps/web/evidence/profile-avatar`）我一直以为它是对的 | 🔴 **那个目录根本不存在**：`ls -d apps/web/evidence/profile-avatar` 报 `No such file or directory`，真实落点是 `profile-panel`（§2 R10 那格与 spec 里的 `SHOT()` 写的都是它）。**交接物里的命令写错路径，症状不是本轮红，而是下一个人跑一条永远失败的命令** —— 而且失败信息看起来像"证据没了"。已改成正确路径并把现量补进那一行（`calendar-day` 磁盘 9/跟踪 1、`calendar-day-time` 4/0、`profile-panel` 6/5；三处未跟踪 png 共 **16** 枚） | 写进文档的路径要逐条 `ls -d`：`for d in calendar-day calendar-day-time profile-panel profile-avatar; do ls -d apps/web/evidence/$d; done` —— 前三条返回目录，第四条报不存在。这是"命令要能跑"的最低成本核对 |
| 09:5x | 「R16 只要在 `calendar-day.spec.ts` 里加一条 `/?lang=en` 用例，共用 `openApp` 就行」 | 🔴 两处不成立，都在写下去之前现量掉：① **`openApp` 走不得** —— 它第一件事就是 `pinChineseUi()`（往 `localStorage['heyta.locale']` 写 `zh-CN`，那是解析链**第 1 层，胜过 `?lang=`**），第二件事是等中文 placeholder 锚点 ⇒ 用它开英文界面必然被打回中文。改照 `language-first-launch.spec.ts` 的"中立启动"形状（`enableAllModules` + `installMissingProducerShims` + 等 `language-option-en` 那个 testID）。② 🔴 **播种不能用英文的 `today`** —— `packages/domain/src/capture.ts` 的 `RULES` 目前**只有中文那一套**（`今天\|今日`、`明天\|明日`、`下下(?:周\|星期\|礼拜)…`），界面语言换成 en **不会**同时把输入语法换成英文。所以英文那一腿仍然输「今天 en-day-…」，并把标题本体写成 ASCII（那个词会被确定性吃掉），否则下面"内容区零中文残留"那条判据会被**我自己的种子**打到 —— 那不是产品结论 | ① `e2e/tests/helpers.ts:283-294`（`openApp` 里 `pinChineseUi` 在 `goto` 之前）与 `:227-231`（写 `heyta.locale`）；② `packages/domain/src/capture.ts:264-295` 规则表逐条都是中文词形。两条新 e2e（`calendar-day-en.spec.ts`、`profile-avatar-e2ee.spec.ts`）`--list` 现量 **3 tests in 2 files**（语法与 import 都通）；跑还排在端口后面（17:5x 现量 4318/4319 各 **64**） |
| 2026-10-03 18:4x | 「`day-en-no-timed.png` 是把那句说明单独拍进来的那张」（spec 第 284 行我自己写的注释）| 🔴 **1280×720 下它不构成独立证据**：两张人眼看是同一屏（md5 不同、内容相同），因为 `day-en-full` 里那句说明**本来就在视口内**。它只在"视口矮到把说明挤出去"时才有意义。没有改判据（那条断言有牙，E1/E2/E3 红过），只是把这张图的**证据身份**降级写进 README —— 一张被命名成"专门证据"却与另一张同屏的图，下一个读它的人会以为有两份证据 | `md5 apps/web/evidence/calendar-day/day-en-*.png`（`4add2ae…` vs `9ce7c77…`）+ 两张并排打开看 |
| 2026-10-03 18:4x | 「`r15b-4-after-reload.png` 与 `r15b-1-need-password.png` 逐字节相同 ⇒ 一定是截图 bug」（我第一反应就是这个）| ✅ **反被否证，而且它是最硬的一条正面证据**：四张各是一条独立的 `page.screenshot`（spec 242/290/297/318 行），不是复制粘贴；相同的是**产品结论** —— 刷新 + 口令不在本机 ⇒ 界面回到"首字母 D + 要先填口令"，**一个像素都没变**：刚上传的那张图解不出来，界面也**不谎称**"你还没有头像"。📌 一般形状：**两张图相同**有两种成因（截图没重拍 / 状态真的没变），区分它们的是"拍图那几行是不是各自独立的调用" + 同一趟里的断言（这里两条都齐：`AVATAR_IMG` count 0、`store.cipher` not null、读侧那句不含"还没有头像"）| `cmp -s` 判等 + `grep -n "page.screenshot" e2e/tests/profile-avatar-e2ee.spec.ts` 四行不同路径 |
| 2026-10-03 18:4x | 「设置浮层把底下那条捕获框透出来了，这是缺陷，当场修」| ⚠️ **差点误修**：读 `apps/web/src/styles/app/sheets.css:20-27` 才确认那层 5% 透明度是**刻意的信息架构**（对照滴答实测的"下层还在"），而且 95% 这个数本身就是一次"文字压文字"实测之后钉的（曾为 88%）。改成不透明会把 `settings-sheet-ia.spec` 那条 IA 判据弄红。**没改**，但把一条真实边界写进 README：95% 只保证"退成隐约一层"，**不保证不与本层文字同行重叠** —— 这次 ghost 恰好压在「个人信息」标题那一行上，要治得给浮层第一条内容留避让带（设计改动，登记给下一轮界面批，不在本批顺手做）。📌 这是"撞见的 bug 当场修完"的一条**反例**：先读那段样式自己怎么说，再决定修不修 | `sed -n '14,29p' apps/web/src/styles/app/sheets.css` |
| 2026-10-03 18:5x | 「§5 第 2 行是 4 列的表里一行正常的长文本」| 🔴 **`check:md-table-rows` 在我给那一行补上结尾竖线之后立刻报 5 列** —— 也就是说 18:2x 那轮我追加的「⚠️ 18:2x 复跑更正」前面那枚竖线（它当时写在代码段里，没转义）**一直是一枚没转义的分隔符**，那一行从写下的那一刻起就是 5 列，只是**缺了结尾竖线所以没人看出来**（GFM 对短行的容忍把错位藏住了）。已并回第 4 列（改成 `。⚠️`）。📌 一般形状：**"缺一个结尾"会让"多一个分隔"变得不可见** —— 两条结构缺陷互相抵消，是门禁要成对写的原因（列数 + 断行在同一趟里各查一次）| `node scripts/check-md-table-rows.mjs`（rc 从 1 回到 0）|
| 2026-10-03 18:5x | 「`lsof -ti -i tcp:4318` 是端口空闲判据的正确形状」（09:4x 那行刚把它当「修正」写进台账）| 🔴 **它仍然坏，而且坏得比第一版更隐蔽**：这条命令**对任何端口都返回同一个数**。现量六档 —— `4318` → 59、`4319` → 59、`3100` → 59、`4322` → 59、`5432` → 59、**`65000`（不可能有监听）→ 59**，前三个 PID 是 `identityservicesd` / `rapportd` / 一个 VPN 进程 ⇒ 端口选择器被整个忽略，量的是「本机所有网络进程」。🔴 **它不报错、数字看着合理、还跨端口稳定** —— 这是最坏的一类探针：它给的不是「被占」，是**一个恒不等于 0 的常数**，于是「等端口空出来」这个条件**永远不会满足**，谁照它等谁就无限期停摆 | 正解：`lsof -nP -iTCP:4318 -sTCP:LISTEN`（**带 `LISTEN` 约束**）。同一趟做了双向对照：起一个 `python3 -m http.server 4599` 当**阳性对照** ⇒ 该形状精确打印出那一条 `Python ... 127.0.0.1:4599 (LISTEN)`；对 4318 输出空 ⇒ 空闲。⚠️ 顺带否证掉另一种 tempting 写法：`(exec 3<>/dev/tcp/127.0.0.1/4599)` 对**活着的**监听回 `closed` —— 这个 shell 里 `/dev/tcp` 根本不可用，它比坏 lsof 更糟（恒「空闲」= 假绿方向）。🔴 本仓 `docs/reference/environment-traps.md` 正被并行会话脏着（48 行未提交追加），**这条不往它里面塞**，登记为待入条目：**「端口空闲判据要带 `-sTCP:LISTEN`，且必须拿一个已知在听的端口做阳性对照」** |
| 2026-10-03 18:5x | 「18:24 / 18:33 那两趟 e2e 是别人帮我跑的（因为我以为端口被占、自己没跑）」| ⚠️ **归因错了，成因就是上面那枚坏探针**：端口一直空着，那两趟是本会话自己在 18:2x 前跑掉的（记录被压缩带走了），我在 18:4x 那行把它写成「别人那一趟」。📌 一般形状：**一个坏探针会顺带伪造出一段历史** —— 它让「我没做」看起来像「别人做了」，于是那条读数既没被复核也没被认领。修法不是改措辞，是**当场重跑一遍拿到退出码**（已做：`3 passed (9.1s)` / `rc=0`）| `cat /tmp/r15b-r16-e2e.out` 末两行 |
| 2026-10-03 19:0x | 「往 markdown 表格行**末尾**追加一段更正」这个动作（本轮做了三次）| 🔴 **三次都同一种坏法**：表格行本来以行尾竖线收尾，我把新句直接拼在竖线**后面**，于是那一行凭空多出一列。第一次（§5 第 2 条 18:2x）它**没有被立刻发现**，因为那一行同时缺了结尾竖线 —— 两条结构缺陷互相抵消；后两次都是 `check:md-table-rows` 当场报 5 列（表头 4）才拦住的。📌 一般形状：**往行尾追加文本的正确动作是「先剥掉行尾竖线、接完再补回去」**，不是「在行尾拼一段话」。已把这条写进本轮的追加脚本（`append_cell()`），后续再往这张表里追加就不该重犯 | `node scripts/check-md-table-rows.mjs`（三次红 → 现在 rc=0）|
| 2026-10-03 19:4x | 「R14 收口 = 批次②做完」，以及那句「小时级排程的界面在时间线板（`App.tsx:2125-2135`）」 | 🔴 **两句都要更正，第二句是引用形状坏了**。(a) R14 关掉的是共享层 + web，移动端那半**从没在它的交付清单里** —— 而它"零新增字段"的形状让"没接"读起来像"做完了"：接缝是 `DatePicker` 上一个**默认不画任何节点**的可选 prop，宿主不接 ⇒ 零节点 ⇒ 零断言 ⇒ 门禁全绿。开工否证命令 `grep -rn "dueTime" apps/mobile/src` = **0 命中**，接口注释 `packages/ui/src/date-picker/DatePicker.tsx:72-73` 原文就写着"不传就一个节点都不画…与改动前逐字节相同"。📌 一般形状：**"默认值等于原行为的可选 prop"是共享层最好的形状，也是把"没接"伪装成"完成"最省事的形状** —— 所以接线的判据必须写成**存在性**（宿主确实传了），不能写成"共享层可用"。(b) 那句引用**漏了包名**：`apps/mobile/src/App.tsx` 整文件 **285 行**（`grep -c ""`），2125 根本不存在；拖拽排程在 **`apps/web/src/App.tsx:2125-2128`**。顺带把"移动端没有那个界面"从印象变成现量：`setSchedule` 在 `apps/mobile/src` 命中 **4** 处，全在 `TaskDetailSheet.tsx`（三处时长 + 一处 `dueDateToEpoch(date)` 的日精度）⇒「开始于」那张选择器不接时刻是**范围裁决**，不是漏做，已钉成一条存在性判据（同屏两张里只有「截止」带 `time`，另一张带正向对照）| `grep -c "" apps/mobile/src/App.tsx`（285）· `grep -rn "setSchedule" apps/mobile/src`（4 处）· `grep -rn "dueTime" apps/mobile/src`（R14c 后 **6** 处；把注入 helper 一起数进去是 8 = 6 + `datePickerTimeLabels` 那 2 处，**两个数对应两条命令，别混用**）· 判据 `apps/mobile/tests/task-due-time.spec.ts` 8 passed |
| 2026-10-03 20:1x | 「台账 §4 这张表是干净的（上一轮修完 rc=0），而 `check:md-table-rows` 那两道判据（列数 + 断行）已经覆盖了表格结构」 | 🔴 **两道都不成立，而且第三条盲区是这轮现量出来的**：① §4 里夹着 **5 枚空行**（18:2x 那次错锚插入留下的），它们把一张表切成多块 —— 而脚本比较的是「每一行 vs 它所在连续块的第一行」，所以**一块只有一行数据的碎片永远没有可比对象**，那道列数判据对它整个失效；② 就藏在这两块碎片里的两行，各自带一枚没转义的裸竖线（写进了代码段），实际是 5 列而表头是 4 列 —— 前一道判据看不见它们，因为它们是各自那块唯一的行；③ 更难看的一点：**记录这类缺陷的那一行自己就带着这个缺陷**（19:0x 那行讲的正是「凭空多出一列」，而它本身就是 5 列）。修法两条一起：空行删掉把表并回一块、代码段里的竖线改成词（不用字形，免转义）；脚本补第三道判据「连续竖线块的表头下面必须紧跟分隔行，否则这块不是表」。📌 一般形状：**门禁的作用域如果是「块」，那「块被静默切碎」就是它的一种失明模式** —— 补的不该是「更严的列数比较」，而是一句「这块到底算不算一张表」。另一条：拿字形当内容写进表里（竖线本身就是列分隔符）时，优先改用词描述 | 三条读数：(a) 新判据的牙 —— 往台账尾部接一段「两条数据行、无表头无分隔行」的碎片 ⇒ 新脚本报 `:414 这一块的表头下面没有分隔行`，而同趟**复刻的旧列数判据报 0 处**（证明新那条不是把旧的重说一遍）；(b) 反向对照 —— 接一张合法迷你表（表头 + 分隔行 + 一行）⇒ 新脚本仍 rc=0，它不是假红机器；(c) 两臂跑完都还原，sha256 与跑前逐字节相同（`restored_sha_match: true`），基线 rc=0。读数落 `/tmp/mdrows3-arms.json` |
| 20:5x | 「`e2e/_probe/probe-reload-crash.spec.ts` 的 B 腿红了 ⇒ 产品在刷新之前就坏了」 | 🔴 **红的是我自己的桩**：复刻旅程时我把 `GET /api/account/avatar` 简化成回 `{avatar: null}`，而真 spec 那份会回载荷并同步 `store.hash` ⇒ 界面停在`profile-avatar-img` 不出现，B 腿**根本没走到 reload**。📌 复刻旅程就逐字复用真用例的桩，只把断言段换成探针；自写桩的第一条红先怀疑桩（与 §7 那一族「验证台的桩会自己造红」同形） | 读数：`1 failed（B，红在 _probe:116 的 toBeVisible）/ 1 flaky（A）/ rc=1`，日志 `/tmp/probe-crash.out`；同一趟 A 腿两条 `dumpState` 都是 `crashed:false` ⇒ **B 的失败在上传步，与崩溃屏无关** |
| 20:5x | 「§5 第 11 条那句『要走完第 ② 段才出现』已经说明了范围」 | ✅ **方向收窄了一格，而且收窄是靠 A 腿**：只填口令 + 保存并同步 ⇒ `page.reload()` 之后**不崩**，IndexedDB 是 `heyta@2`（前后同名同版本，不是版本号被顶高）。所以崩溃至少还需要「头像那次写」或它触发的后续写。⚠️ 仍未定性 —— 拿到 `[data-testid="error-message"]` 的原文之前不写归因（那串文字在 `<details>` 里，折叠时 a11y 快照读不到、`textContent` 读得到） | A 腿两条读数都在 `/tmp/probe-crash.out` 第 13-14 行；探针已挪出 e2e 收集范围：`npx playwright test --list` 现在 **0** 命中 `_probe`（`testDir: './tests'`，文件在 `e2e/_probe/`） |
| 20:5x | 「`page.reload()` 会把挂在半路的 route 处理器弄坏这件事，是我这条用例独有的麻烦」 | ⚠️ **不是**：`e2e/tests/shims.ts:127` 在 reload 时抛 `apiResponse.text: Response has been disposed`，把一条本来绿的用例判成 **flaky**（重跑一次就过）。这是共享脚手架的性质，不是产品缺陷 —— 以后看到 `A 腿 flaky + 报错在 shims.ts` 这个组合，别去查界面。📌 顺带把 §3 那批现场读数重取了一遍：端口 4318/4319 各 **0** 条 LISTEN（18:0x 那个 59 是坏探针造的假红）、负载 `23.31/41.28/52.84`（19:33 是 108/126/101）、`package.json` 仍 **3+/1-**、`packages/op-log` 仍 3 个 `M` + 3 个未跟踪 ⇒ §5 第 1/4/6 条的解锁条件**一条都没成立**，只有第 7 条（等端口）在 20:1x 成立过 | 命令：`for p in 4318 4319; do lsof -nP -iTCP:$p -sTCP:LISTEN; done`（两条都空）· `sysctl -n vm.loadavg` · `git diff --stat -- package.json` · `git status --porcelain packages/op-log` |
| 20:5x | 「`check:docs` 那 27 处里本会话占 11 处」 | ⚠️ 这个数因为我新写了两份交接文档而涨了，必须重报：**现量 42 处，本会话 13 / 其他 29**（本会话 = 台账 10 + `calendar-profile-handoff.md` 1 + `calendar-profile-reflection.md` 1 + `apps/web/evidence/calendar-day/README.md` 1）。📌 这**不是回归**，是同一件事的分母变了：这 13 处的解锁动作和那 11 处是同一个 `git add`（本会话不许执行），加完 13 处一起归零 | 分归属：`grep -o "解析到 [^，]*" /tmp/docs-after.out \| sort \| uniq -c \| sort -rn` |
| 21:0x | 「§5 第 11 条那枚红已经排除三件事，剩下的是产品或别人的代码坏了」 | 🔴 **两件事都得推翻，而且那枚红不见了**：同一批七文件在 20:1x 是 `19 passed / 1 failed`，21:05 复跑是 **20 passed / 0 failed / rc=0**；单跑那条用例 21:04 是 `1 passed / rc=0`；复刻了完整旅程的探针两条腿都不崩（`heyta@2` 前后同名同版本）。所以不能写「已修复」，只能写**当前这套产物下不可复现**。现量到的唯一状态差：`packages/op-log/dist/index.js` 在 **21:00:41 被重建**（此前它比自己的 `src/engine.ts`(19:01) 旧），而 `packages/storage` 有 5 个文件是 `M` ⇒ 崩的那一趟跑在「新 storage + 旧 op-log 产物」这种**任何一次提交都不存在的组合**上。📌 这是 §7 第 27 条那一族的第五次露面。上一行我写的『未定性，不写因果』是对的动作，但**未定性不等于不去取那个取得到的状态差** —— 机制从此有了方向（读的是哪一份产物），只是还没有被证明 | 三趟读数分列：`/tmp/cal-family.out`（20:1x，1 failed）· `/tmp/cal-family2.out`（21:05，20 passed / rc=0）· `/tmp/r15b-recheck.out`（21:04，1 passed / rc=0）· `/tmp/probe4.out`（探针两腿）。状态差：`ls -lT packages/op-log/dist/index.js packages/op-log/src/engine.ts` |
| 21:0x | 探针在 `page.reload()` 之后**立刻** dump，得到 `crashed:false` 就当「不崩」 | 🔴 **探针自己第二次犯同一批的错**：`page.reload()` 在 load 事件就 resolve，而 React 首屏在它之后，于是那一步读到的是 `crashed:false` + `capture:false` + `rootLen:0` 的组合 —— 它的意思不是「没有崩」，是**还没渲染**。补了 `settle()`（等 `[role=alert]` 或捕获框任一出现）之后才拿到有内容的读数。📌 「等条件不等 tick」这条我今天在**产品判据**上修过一轮（08:32 那行），不到三小时在**自己的探针**上又犯一次 ⇒ 这条纪律的作用域不是「判据」而是**任何我用来读世界的东西** | 第一趟（没等落位）：`PROBE[A-after] crashed:false capture:false` ⇒ 什么也证明不了；第二趟（加了 settle）：`settle 命中` 有值 + `capture:true` + `rootLen:277`。两趟都在 `/tmp/probe3.out` 与 `/tmp/probe4.out` |
| 21:0x | 探针文件挪到 `e2e/_probe/` 之后照样能用 `npx playwright test ../_probe/x.spec.ts` 跑 | 🔴 **`No tests found`**：`playwright.config.ts` 的 `testDir` 是 `./tests`，而命令行参数是**对 testDir 内的文件做正则匹配**，不接受目录外的相对路径。但探针也**不能**放回 `tests/` —— 那里是别人套件的收集范围，一个已知会红的临时文件混进去，下一次整族复跑就多一枚不属于任何产品的红（§7 那一族「探针污染状态」）。正解是一份**专用配置**：`e2e/playwright.probe.config.ts` 展开主配置、只把 `testDir` 换成 `./_probe`、`retries` 设 0（探针要的是第一趟的形态，不是被重试救回来的绿） | 现量：`npx playwright test -c playwright.probe.config.ts --list` = **2 tests in 1 file**，而主配置对同一个文件 `--list` 是 **0** 命中（两边都要量，才叫对照） |
| 21:0x | 新增的 `scripts/dist-freshness.mjs`「读 `package.json` 的 `main` 就够了」 | 🔴 **只看 `main` 会瞎在最要命的地方**：`@heyta/ui` 的 package.json **没有 `main`**，入口只写在 `exports['.']` 里，而它恰好是本轮判据消费最多的包 ⇒ 第一版把它报成 `no-main`（等于不报）。改成按**运行时条件**解析（`import` > `require` > `default`，再退回 `module`/`main`），且**刻意不碰 `types`** —— 那是 `.d.ts`，它新不代表运行时产物新。顺带纠正出 `shared-schema` 与 `sync-core` 的真实入口是 `dist/index.mjs`（此前按 `index.js` 找，量的不是消费者读的那一份） | 改前那一趟打印 `⚪ ui no-main`；改后同一趟打印 `🔴 ui 产物比源码旧 2718s —— src packages/ui/src/trash/model.ts`（21:1x 现量，回收站那条线正在改 `packages/ui`） |
| 21:0x | 体检脚本的注释里写 `packages/*/dist` 没问题 | 🔴 **块注释被自己提前关掉**：`/*` 注释里出现 `*/` 那个序列 ⇒ 注释从 `packages/` 那里就结束了，后面整段中文变成代码，`node --check` 当场报 `SyntaxError: Unexpected strict mode reserved word`。改成 `packages/<pkg>/dist` 之后通过。📌 一般规律：**任何会被解析的载体里，分隔序列本身就是内容** —— 这与 markdown 表格里写裸竖线（18:5x 那两行）是同一条错的第三种面目。⚠️ 也是这一趟让我把「`mdrows_rc=1`」差点记成门禁红：那个 1 来自前面 python 脚本的 assert，`&&` 链断了、node 根本没跑（单独复跑 rc=0） | 命令：`node --check scripts/dist-freshness.mjs`（改前 rc=1 并打印出中文行号）；改后 rc=0；`node scripts/dist-freshness.mjs` rc=0 而 `--strict` rc=1（ ⇒ 它能失败），`--strict --only storage,shared-schema` rc=0（⇒ 它不是恒红机器） |
| 21:4x | 「`check:md-table-rows` 守住了这张表，所以本轮写的表格结构都有人看着」 | 🔴 **清单里只有两份文件，而本轮新写的交接与复盘两份全是表格 —— 它们从没被看过**。把 `FILES` 从 2 扩到 4（过程账 + 上级台账 + 交接 + 复盘），现量 rc=0。📌 形状：**加一条门禁时如果只把它指向"已经出过事的那个文件"，那它守的是昨天，不是这条线**。第二件事更值钱：拿同一套判据顺手跑了一下 `docs/plans/README.md`（文档索引），命中 **1 处在第 17 行** —— 那张「权威入口」表表头是 3 列，倒数纪念日那条索引行只有 **2** 列 ⇒ GFM 补一个空单元格，长状态整段落在「看这一份」列、说明列空。`git show HEAD:docs/plans/README.md` 里**同样命中** ⇒ 它不是别人未提交的半成品，是已提交状态里就坏的缺陷。🔴 **刻意没顺手修，也没把它加进清单**：那条行不归本线、而 README 正被并行会话改动（`check:docs` 那 29 处就在他们手里），在他们可能整文件提交的文件里改第 17 行最可能的结果是被覆盖（本机今天实测过这个形状）；把一枚已知会红的文件加进清单 = 造一条天生红的门禁（AGENTS §8.3）。⇒ 登记成交接 §4.1 G，带可复跑命令与那一个单元格的修法。另一条读数：这脚本的报错在 **stderr**，变异臂 rc=1 时 `stdout` 是空串 ⇒ `> /tmp/out.txt` 留下的空文件与「跑了且干净」不可区分（记进交接 §6 第 10 条） | 四文件基线：`node scripts/check-md-table-rows.mjs` ⇒ 「4 个文件…都一致」rc=0。两支臂：M9 往交接 §3 那张 4 列表插一枚 2 列行 ⇒ rc=1；M10 往复盘那张 5 列表插一枚 3 列行 ⇒ rc=1 且报「列数 3（本表表头是 5）」—— 两臂跑完都还原且**逐字节相同**（`RESTORED byte-identical = True`，复盘文件另读 `== orig` 为 True）。README 现量命令已按文档里那份原文执行过一遍，复现 `rc = 1 / 行 17 / 列数 2（本表表头是 3）` |

---

## 5. 外部阻塞台账（逐条带主语与现量命令；⚠️ 本文件**不写条数** —— 写过一次就会漂）

| # | 事项 | 在谁手里 | 解锁判据 / 现量命令 |
|---|---|---|---|
| 1 | 四端重装（§6.1.1 固定收尾）与移动端真机取证 | 改 `packages/op-log` 的那条会话（checkpoint / 串行队列 / 字段合并 WIP） | `git status --porcelain packages/op-log` 为空 **且** `pnpm --filter @heyta/op-log build` exit 0 ⇒ 才能 `IOS_DEVICE_NAME="heyta-iphone-17pro" bash scripts/reinstall-all.sh; echo "EXIT=$?"`。**R14 收口现量（07:51）**：`src/engine.ts`、`src/state.ts`、`tests/engine.spec.ts` 三处 `M` + `tests/checkpoint-recovery.spec.ts`、`tests/semantic-invariants.spec.ts` 两处未跟踪，`git diff --stat` = **651+/199-**（R13 收口时是 207+/152-，还在长）|
| 1b | ⚠️ 上一条的一个**前提**，写出来免得下一个人拿它当"已经干净了"：R14 这轮 web 全量 0 红，量的是 `packages/op-log/dist/index.js`（mtime **15:20:43**），而他的 `src/engine.ts` 最后改于 **15:23:14** ⇒ **磁盘上的 dist 比他的源码旧**。这不是"他修好了"的证明，只是"当前这份编译产物下 web 全量绿"。R13 那轮登记的 `trash.spec.tsx` 红因此**不能宣布为已解决**，只能宣布为"本轮复跑不再出现"（现量命令见下面 §3 那行 R14 的读数） | 同上 | `ls -lT packages/op-log/dist/index.js packages/op-log/src/engine.ts` 两个 mtime 一比就知道读的是哪一份；`cd apps/web && NO_COLOR=1 npx vitest run tests/trash.spec.tsx --reporter=dot` |
| 2 | **`check:docs` 报的"本机有、仓库里没有"的链接**。⚠️ **R15b 收口重量（18:0x）：本会话那部分已经关闭** —— 现量 `git ls-files --error-unmatch` 逐个查过：`docs/plans/calendar-year-time-and-mobile-profile.md`、`docs/plans/README.md`、`docs/adr/0046-*`、`docs/adr/0047-*`、`docs/plans/trash-and-archive.md`、`docs/research/trash-and-archive-best-practice.md` **六个全部已跟踪**（并行会话 18:0x 那笔 `192a516d` 带进去的）。现在 `check:docs` 仍 **rc=1**，但只剩**两个目标、都不是本会话写的**：`docs/research/detail-pane-three-column-alignment.md`、`docs/research/spaced-repetition-and-recitation.md`（历史读数：R11 时 1 处 → R13 后 3 处 → R14 收口 4 处 → R15a 收口 7 个目标 → 现在 **2 个**）。⚠️ 原句"本会话写的只有 2 个"里剩下的那一件仍然成立：**证据 png 一张都没入库**（现量：`apps/web/evidence/calendar-day` 磁盘 6 / 跟踪 **1**（只有 README，而且它在**索引里**是 `A` = 别人刚暂存的，不是我加的）；`apps/web/evidence/calendar-day-time` 磁盘 4 / 跟踪 **0**；新目录 `profile-avatar/` 还没生成） | 两个未跟踪的 research 文件归**写下它们的那条会话**（本会话不知道是谁，也不替它们认领）。⚠️ 顺带现量到它们那侧的一个真缺口：`docs/research/detail-pane-three-column-alignment.md` 与 `docs/research/spaced-repetition-and-recitation.md` **磁盘上有**，而 `grep -n "detail-pane\|spaced-repetition" docs/plans/README.md` = **0 命中** ⇒ 它们既没入库、也没进 `docs/plans/README.md` 那张表（这条只**登记**，不归本批去补 —— 表的条目要由那条线按自己的分层规则写）；证据 png 归**有提交权的那一轮**（本会话被明令不许 `git add`） | 现量（🔴 **必须不带管道**：`… \| tail` 之后的 `echo $?` 量到的是 `tail` 的 0 —— §7 第 45 条那一族，本轮又踩过一次，见 §4 09:4x 行）：`NO_COLOR=1 pnpm -s check:docs > /tmp/docs.out 2>&1; echo rc=$?` → **rc=1**；分归属：`grep -o "解析到 [^，]*" /tmp/docs.out \| sort -u`。入库（🔴 点名路径、不用 `-A`；本会话不执行）：`git add apps/web/evidence/calendar-day apps/web/evidence/calendar-day apps/web/evidence/calendar-day-time apps/web/evidence/profile-panel`。⚠️ **18:2x 复跑更正**：`NO_COLOR=1 pnpm -s check:docs > /tmp/docs3.out 2>&1; echo rc=$?` 现在是 **rc=0** —— 上面那句「仍 rc=1、只剩两个目标」已经被那两个文件的所有者入库关掉了，本会话没有为它改过任何东西。🔴 但**本行后半段仍然成立，而且它不在 `check:docs` 的判据范围里**：证据 png 依旧没入库（18:2x 现量：`apps/web/evidence/calendar-day` 磁盘 9 / 跟踪 1（只有 README）/ png 跟踪 **0**；`calendar-day-time` 磁盘 4 / 跟踪 **0**；`profile-panel` 磁盘 6 / 跟踪 5（其中 png 4，是 R10 那批的）；三个目录里未跟踪的 png 共 **16** 枚）。⚠️ 别把「`check:docs` 绿了」读成「证据入库了」—— 它只查链接，链接查的是文件在不在磁盘上，两本账。⚠️ **18:4x 复跑又红了，但这次红在别人那侧**：`NO_COLOR=1 pnpm -s check:docs > /tmp/g-docs.out 2>&1; echo rc=$?` → **rc=1**，唯一一处是 `docs/plans/README.md:22` 指向 **`detail-pane-alignment.md`**，而 `git status --porcelain docs/plans/detail-pane-alignment.md` = `??`（未跟踪）。`git diff -U0 -- docs/plans/README.md` 现量：README 里未提交的是**两行**（21 行 = 本会话那条 R13–R16 指针、22 行 = 详情面那条），红的只有 22 行那处。🔴 **本会话不代它 `git add`、也不替它写进 `UNTRACKED_LINK_OK`**（那等于替别人拍板"这份文档只活在本机"）。闭合在**写下 `detail-pane-alignment.md` 的那条会话**手里：`git add docs/plans/detail-pane-alignment.md` 之后 `pnpm -s check:docs` 回 rc=0。✅ **19:0x 复跑：rc=0**（`git status --porcelain docs/plans/detail-pane-alignment.md` 现在是 `A ` = 那条会话把它暂存了，本会话没有为它执行过任何 git 动作）。🔴 **本行后半段那件（证据 png 未入库）仍然开着**，而且这一趟又多了 7 张未跟踪的（`day-en-*` 3 张 + `r15b-*` 4 张，18:53 重拍）。📊 **19:0x 现量（文件级，`git status --porcelain -uall`）**：`calendar-day` 磁盘 9 / 跟踪 1 / 未跟踪 **8**；`calendar-day-time` 磁盘 4 / 跟踪 0 / 未跟踪 **4**；`calendar-year` 磁盘 4 / 跟踪 0 / 未跟踪 **4**；`profile-panel` 磁盘 9 / 跟踪 5 / 未跟踪 **4** ⇒ 四个目录合计未跟踪 **20 个文件，其中 19 枚 png**。⚠️ **数法要说清**：默认 `git status --porcelain`（不带 `-uall`）对**整目录未跟踪**的两处各只报 **1 行**（按目录折叠），于是同一件事会量出 14 与 20 两个数 —— 都对，但**只有文件级那个能用来核对入库是否齐全** ⚠️ **20:1x 复跑：这条又开回去了，而且这次红里有一本账是我自己的** —— `node research/tools/docs-link-check.mjs` → **rc=1、27 处**，逐目标归因（命令在取证列）：**11 处指向本会话的文件**（`docs/plans/calendar-year-time-and-mobile-profile.md` 10 处 + `apps/web/evidence/calendar-day/README.md` 1 处），**16 处**指向并行那几条线的未跟踪文档（`trash-and-archive` 那条 7 处、ADR `0046/0047/0048` 6 处、`performance-hotpaths-audit.md` 2 处、`aed-implementation-evidence.md` 1 处）。🔴 **上面 18:0x 那句「六个全部已跟踪」被现量否证**：同一份台账现在 `git ls-files --` 命中 **0**、`git ls-tree -r HEAD --` 命中 **0**、`git status --porcelain` = 未跟踪 ⇒ 它从「别人替我暂存」被退回未跟踪，而我一行链接都没动。**成因是这条判据的「仓库里有没有」那一轴读的是索引**（`research/tools/docs-link-check.mjs` 用 `git ls-files`），而索引是共享的 —— 别人一次 `git reset` 就能把我写的文档重新变成「本机有、仓库没有」，而我被明令不许 `git add`，所以**这道红既不由我关掉，也不该由我豁免掉**（往 `UNTRACKED_LINK_OK` 里登记等于替所有人宣称「这份台账刻意不进仓库」）。📌 一般形状：**门禁的某一根输入轴住在共享状态里时，它的读数只属于那一趟** —— 同趟第二条佐证：HEAD 在本会话期间从 `a633183c` 前进到 `544fa408`（并行提交），而 `check:docs` 从 19:0x 的 rc=0 变成现在的 rc=1，中间我改的全是文档内容与一条脚本，没碰任何链接。闭合分两条，都不在本会话执行：本会话这 11 处 ⇒ `git add docs/plans/calendar-year-time-and-mobile-profile.md apps/web/evidence/calendar-day/README.md`；其余 16 处 ⇒ 各自的所有者 ⚠️ **22:2x 复跑现量**（R17 之后）：`check:docs` 仍 rc=1，**45 个站点**。归属拆开：🔴 **12 条的"目标"是本线那三份未跟踪文档**（来源分布 `docs/plans/ui-review-fill-zh-timeline.md` 8、`docs/plans/README.md` 3、`docs/plans/detail-pane-alignment.md` 1 —— 最后那条链接是别人把他表里指向我这份的条目补上去的），而**本线三份文档自己作为来源的站点 = 0**（我写的链接都落在受跟踪的目标上）；其余 33 条不归本线（`docs/README.md` 12、`docs/research/performance-hotpaths-audit.md` 8、`docs/reference/environment-traps.md` 3、`docs/adr/0008-…` 2、AGENTS.md 1、PROGRESS.md 1…）。⇒ 关闭动作仍然只有那一句 `git add`（本会话被明令不许），复跑 `NO_COLOR=1 node research/tools/docs-link-check.mjs > /tmp/docs.out 2>&1; echo rc=$?`。 |
| 3 | ~~移动端"读一个本地文件"的依赖裁决（document-picker）~~ ⚠️ **本条已被现量否证，不再是阻塞**：`@react-native-documents/picker@12.0.2` 已在 `apps/mobile/package.json:31` 且已在 `ExportScreen.tsx:67` 生产使用 ⇒ 门已有人过完。**改写后的 R15b 真实阻塞**：① Android 缺 `readBase64Uri`（现有 `LocalFsModule.kt:49` 的 UTF-8 强转对二进制是损坏）；② iOS 缺对应原生模块且兜底路径未实测；③ mobile 零 `Image` 渲染先例；④ iOS 能否从**相册**取图未取证（命令见 §2 R15 那格）。⚠️ **R15b 收口时（09:4x）再更正一次**：①②③ 的**代码已全部落地**（`prepareAvatarBase64` 进 Kotlin、`lib/avatar-prepare.ts`、`ui/avatar.tsx` 是 mobile 第一个 RN `<Image>`），本条**剩下的只是取证**，不是实现 —— ① 的 Android 真机腿要**重装 APK**（被上面第 1 条挡），② 的 iOS 腿按产品裁决**只做界面句**（`noChannel`）而不是补原生模块，④ 仍是开放问题 | 责任在**做移动端壳的这一段**（本会话可做，但要动 Kotlin 与 ObjC/Swift 两侧并需要模拟器取证） | 现量命令：`grep -n "readTextUri\|readBase64Uri" apps/mobile/android/app/src/main/java/com/heytamobile/fs/LocalFsModule.kt` 与 `grep -rn "\bImage\b" apps/mobile/src --include=*.tsx --include=*.ts \| wc -l` |
| 4 | **已装到 `/Applications/Heyta.app` 的那份是早于 R13/R14 的构建**（产品负责人 08:5x 那张"内容超出容器范围"的截图就是它）。⚠️ 修复**不是**"重装一遍"就完事：新加的 `package-app.sh` 新鲜度闸门现在**红着**，红在 `packages/domain/dist` 有 6 个文件比 `apps/web/dist/index.html` 新（⇒ 当前 web 产物不是对着当前 domain dist 打的），必须先 `pnpm -r build && pnpm --filter @heyta/web build` 才能打包 | 有提交权的那一轮（且**要等并行会话的 e2e 跑完** —— 08:55 现量：`lsof -ti tcp:4318` = 3 个 PID，其中一个是别人的 `vite --port 4318`、一个是 playwright、一个是 chromium-headless-shell，起跑 3 分 41 秒前。在他们读 `packages/*/dist` 的时候重建 dist 就是制造下一次"产物与判据对不上"） | 现量：`lsof -ti tcp:4318 tcp:4319 \| wc -l` 为 0 **且** `git status --porcelain packages/*/src` 为空 ⇒ 才跑 `pnpm -r build && pnpm --filter @heyta/web build && bash apps/desktop-macos/scripts/package-app.sh /tmp/heyta-macos-dist`。⚠️ 本会话**不**跑 `pnpm reinstall:all`（明令禁止，它会 SIGKILL 别人的 dev server）；上面这条只重打 mac 端、不装 |
| 5 | 🔴 **两条新 e2e 已写好、已跑过（18:24 / 18:33 两趟，七张图都看了），缺的是"这一趟的退出码留不下"**（R16 的 `e2e/tests/calendar-day-en.spec.ts` 2 条 + R15b 的 `e2e/tests/profile-avatar-e2ee.spec.ts` 1 条）。现量：`cd e2e && npx playwright test --list tests/calendar-day-en.spec.ts tests/profile-avatar-e2ee.spec.ts` → **Total: 3 tests in 2 files**（这条只证明语法与 import 通，**不证明任何界面结论**）。挡路的是**端口**而不是代码：`playwright.config.ts:59/88` 把 `baseURL` 与 vite 都钉在 **4318**（`--strictPort`、`reuseExistingServer: false`），而 18:0x 现量 `lsof -ti -i tcp:4318` / `tcp:4319` 各 **59** 个 PID ⇒ 别人正在跑 e2e。🔴 本会话**不**为此另起一个 dev server：vite 的依赖预打包缓存在 `node_modules/.vite` 是**共享**的，第二个实例会引发对方那一轮重新优化/重载 —— 那就是"我的取证把别人的验收弄红"，与 §5 第 1 条同一类越界 | 端口在**正在跑 e2e 的那条会话**手里（不是 op-log 那条，是另一条） | 解锁即跑（🔴 不带管道取退出码；两条一起跑，一条命令）：`lsof -ti -i tcp:4318 -i tcp:4319 \| wc -l` 为 **0** ⇒ `cd e2e && NO_COLOR=1 npx playwright test tests/calendar-day-en.spec.ts tests/profile-avatar-e2ee.spec.ts > /tmp/r15b-r16-e2e.out 2>&1; echo rc=$?`；截图落点固定：`apps/web/evidence/calendar-day/day-en-{full,no-timed,empty}.png` 与 `apps/web/evidence/profile-panel/r15b-{1-need-password,2-ready,3-ready-dark,4-after-reload}.png` —— 🔴 **人必须打开那七张图**（§6.2 规定一第 4 条）—— ✅ **18:4x 已做完**：七张逐张结论 + md5 在两份证据 README（`calendar-day/README.md`「R16 追加的三张」、`profile-panel/README.md`「R15b 追加的四张」），台账读数在 §3 的 18:4x 行。✅ **18:53 关闭**：`NO_COLOR=1 npx playwright test tests/calendar-day-en.spec.ts tests/profile-avatar-e2ee.spec.ts > /tmp/r15b-r16-e2e.out 2>&1; echo rc=$?` → **`3 passed (9.1s)` / `rc=0`**（三条用例名逐条 ✓）。⚠️ 而「等端口」这个前提本身是**坏探针造出来的**（见 §4 18:5x 那行：`lsof -ti -i tcp:PORT` 对任何端口恒返回 59）⇒ 本条从写下到关闭，真正挡着它的只有那条错判据。🔴 **第 2 条里「证据 png 一张都没入库」那部分与本条无关，仍然开着** |
| 6 | **`scripts/check-md-table-rows.mjs` 已写好、已验它能红，但没接进 `pnpm check`** —— 接它要改 `package.json`，而那个文件此刻**别人有未提交改动**：`git diff package.json` = 4+/1-，里面是 `check:op-log-semantics`（改 op-log 那条会话加的，还挂在她的 `check` 长串里）与 `verify:mobile-notes` / `verify:mobile-aed` 三条。🔴 我往同一行里插我的脚本 ⇒ 两条线在同一行上互相覆盖（那正是 §7 第 88 条"半个文件的索引尾巴"那一族），而且我**不许** `git add` | 归**下一个能干净提交 `package.json` 的会话**（或这两条线都收口之后）。 | 补丁是一行，两处：`"check:md-tables": "node scripts/check-md-table-rows.mjs",` 加在 `"check:docs": …` 旁边，并在 `check` 长串里 `pnpm check:docs &&` 之后插 `pnpm check:md-tables &&`。改完的现量判据：`node scripts/check-md-table-rows.mjs; echo rc=$?` → **rc=0**（18:2x 读数），而 §6 第 8 行那 73 处**不在**它的范围内。🔴 **21:4x 补一条前置**：这条脚本自己现在也是 `??`（未跟踪），连同本轮另一条 `scripts/dist-freshness.mjs` 一起，**接进 `check` 之前必须先把两个文件 `git add`** —— 否则 `pnpm check` 会在别人那侧响亮失败（门禁指向不存在的脚本）。点名命令在交接 §4 A 🟢 **01:5x 已闭合**：两枚脚本现量都在 `git ls-tree HEAD` 里，`package.json` 工作树干净且 HEAD 那版带着两行（链复跑仍是 63 段、链内仍是 1 次），落地那笔是 `102d064f`（10-04 00:46，vault 那条线提交 `package.json` 时把本线那两行整行吸了进去）⇒ 归属不记本线；平态现量 rc=**0**。 |
| 7 | **日历 e2e 家族 7 个文件的整批复跑**（本轮只跑成 `calendar-day-en` + `profile-avatar-e2ee` 两条，其余 5 个文件的家族复跑在 18:58 因端口被占**一条都没执行**）| 端口在**18:58 之后占用它的那条会话**手里（不是 op-log 那条）。⚠️ 本条以前登记的"等端口"全部建立在坏探针上（§4 18:5x 那行），所以这条的**解锁判据换成实测过阳性对照的形状** | `for p in 4318 4319; do lsof -nP -iTCP:$p -sTCP:LISTEN \| awk 'NR>1'; done` **两枚都为空** ⇒ `cd e2e && NO_COLOR=1 npx playwright test tests/calendar-day.spec.ts tests/calendar-day-en.spec.ts tests/calendar-week.spec.ts tests/calendar-year.spec.ts tests/calendar-view-family.spec.ts tests/calendar-cells.spec.ts tests/profile-avatar-e2ee.spec.ts --reporter=list > /tmp/cal-family.out 2>&1; echo rc=$?`（🔴 不带管道取退出码；`rc=1` 且日志只有 `already used` 那两行 = 环境无效，不是产品失败） ✅ **20:1x 已执行（端口现量为空 ⇒ 解锁条件成立）**：`cd e2e && NO_COLOR=1 npx playwright test tests/calendar-day.spec.ts tests/calendar-day-en.spec.ts tests/calendar-week.spec.ts tests/calendar-year.spec.ts tests/calendar-view-family.spec.ts tests/calendar-cells.spec.ts tests/profile-avatar-e2ee.spec.ts --reporter=list` ⇒ **19 passed、1 failed、rc=1**（读数在 `/tmp/cal-family.out`）。日历那 6 个文件**全绿**（含年档 4 条、日档「今天 16:00 X 挂在 16 那一格」那条、英文那条），所以本批在真浏览器里的判据读数第一次是齐的；唯一那枚红是 `profile-avatar-e2ee.spec.ts:213` 的第 ③ 段（刷新之后），**另立一条记在本节末行（第 11 条）** —— 它不是「这条判据没过」，而是「界面在刷新后崩了」，两件事必须分开记账 |
| 8 | 🔴 **`pnpm --filter @heyta/mobile typecheck` rc=2**（1 条 error：`src/screens/TrashScreen.tsx(180,47) TS2322 —— `<Text>` 收到 `testID`，而 `TextProps` 没有这个属性）。本批的 mobile 判据读数**不受它影响**（我的用例单跑 8 passed），但"mobile typecheck rc=0"这一格**没法由本会话宣布** | 正在改 `apps/mobile/src/screens/TrashScreen.tsx` 的那条会话（现量：19:08 那次 `git status` 没列这个文件、19:24 起出现 `M`；同一句报错在两趟运行之间从 176 行漂到 180 行 ⇒ 文件在动）。🔴 本会话不代改：要么他们给 `Text` 补 `testID`，要么去掉那个属性 —— 我 R15a 只给 `TextFieldProps` 加过 `testID`，替他们把 `TextProps` 也补上等于把他们的界面挂在我的属性上 | 现量：`NO_COLOR=1 pnpm --filter @heyta/mobile typecheck; echo rc=$?` → 期望 **rc=0**。归属现量：`git status --porcelain apps/mobile/src/screens/TrashScreen.tsx` 为空 ⇒ 那条会话已收口 ✅ **22:2x 由对方关闭**：`pnpm --filter @heyta/mobile typecheck` 现量 **rc=0**（同一趟 ui rc=0、web rc=0）。这句"rc=2"的保质期是三个小时 —— 它正好印证本篇反复登记的那条形状：**关于活树的读数不是关于代码的结论**，所以关闭判据要写成命令，不是写成一个数。 |
| 9 | 🔴 **`pnpm -r test` 末尾的全量测试整体红**，两枚红都在 `apps/mobile/tests/trash-display.spec.ts`（19:36 现量：**633 passed \| 2 failed**，失败标题是那组 `trashKindLabel` 的「便签 / 笔记」叫法）。⚠️ 同一枚文件 **19:18 那趟是"收集失败"**：`RolldownError: Flow is not supported` on `node_modules/react-native/index.js` —— 因为该用例在**运行时**从 `'@heyta/ui'` import 了 `entityLabelOf`，而 `packages/ui/dist/index.js` 里有 **44 处 `from "react-native"`**。仓里对这个形状已有两份现成解法：`tests/projects-sections.spec.ts:18-19`（源码级、不 import 组件桶）与 `tests/sync-status-text.spec.ts:32`（`'vi.mock(@heyta/ui, () => import(../../../packages/ui/src/sync/model))'`，而 `entityLabelOf` 正好住在 `packages/ui/src/sync/model.ts`） | 回收站那条线（同一枚文件在 19:18→19:36 之间被改过；`lib/trash-display.ts` 在 HEAD 里就是这个 import 形状）。本批不代改、不为跑绿改他们的断言 | 复现：`NO_COLOR=1 pnpm --filter @heyta/mobile test`。闭合判据：`Test Files 41 passed (41)` 且 `Tests` 那行不再出现 `failed`。与本批无关的证据：`NO_COLOR=1 npx vitest run tests/task-due-time.spec.ts` = **8 passed / rc=0** |
| 10 | **R14c 的移动端真机腿**（时刻栏在 Android 上真的画出来、填 16:00 真的落库并同步到另一台设备）没跑 | **环境，不是人**：现量 19:33 三条同时成立 —— ① `adb devices` 有 `emulator-5554`，且 `dumpsys window` 的 `mCurrentFocus` 是 `com.heyta/com.heytamobile.MainActivity`（界面被占着）；② `ps` 里正在跑 `node ./scripts/verify-mobile-design-tokens.mjs`（另一条会话的设备验收）；③ `uptime` 的 load average = **108.78 / 125.97 / 101.09** ⇒ 这种负载下跑出来的设备读数属于"环境无效"，不是产品结论。另外当前装的 APK 里**没有**本批的改动，跑之前必须重打包 | 前置：`uptime` 三段都 < 12 **且** `pgrep -f verify-mobile` 为空 **且** 5554 没被别的会话占用。然后：`pnpm --filter @heyta/ui build && pnpm build:android && adb -s emulator-5554 install -r <apk>`；判据走刚分开的 testID（`task-due-time-input` / `task-due-time-all-day`），断言产品结论而不是显示形态：填 `16:00` 后 `dueDate` 落在**本地那一分钟**，且 node-host 那台设备读到同一个分钟（照 `pnpm verify:mobile-edit` 的四层形状）|
| 11 | ⭐ **`e2e/tests/profile-avatar-e2ee.spec.ts` 第 ③ 段「口令缺失 → 真上传 → 刷新之后仍说要先填口令」现在确定性地红**：`page.reload()` 之后界面不是任务页，而是崩溃屏「无法初始化本地存储」（`web.error.storage.title`，hint 落在通用那一档 ⇒ 失败分类是 `open-failed`/`request-failed`/`transaction-failed` 之一），于是 `:304` 等捕获框那条判据拿不到元素。🔴 **已排除三件事**（各带命令）：① **不是「刷新」这件事坏了** —— 临时探针（跑完即删）走「首启→刷新」两条腿：不带凭据 `firstBoot=true afterReload=true`、带 `heyta.sync.credentials` 同样 `2 passed`；② **不是本会话写的代码** —— 崩溃发生在 React 渲染之前的启动 catch（`apps/web/src/main.tsx:194-221`），本会话在启动路径上零改动；③ **不是端口或环境** —— 4318/4319 现量为空，同一趟另外 19 条判据全过。⚠️ **未定性，不写因果**：能确定的只有「要第 ② 段那串动作之后才出现」（填口令 → 保存并同步 → 真上传 → 切暗色 → 刷新）。此刻活树正躺着这条路径的改写：`git diff --stat packages/op-log` = engine **+341**／state **+508**／tests +168，另有 `apps/web/src/features/{tasks,projects,notes,reminders}/store.ts` 四个未提交改动。同一趟 `language-first-launch.spec.ts` 与 `task-organize.spec.ts` 各红 2 条，但症状是 `language-option-en` 找不到，**与崩溃屏不是同一个** ⇒ 只能说「现在这套 e2e 量不出干净读数」，不能说「op-log 那批把它改坏了」。📌 **探针自己记一笔**：第一版探针调了个不存在的 `installMissingProducerShimsSafe`，158ms 死在 setup —— 当时收工就会把「探针坏了」读成「刷新就崩」。归因之前先把探针跑通。 | 归**改 `packages/op-log` 与那四个 store 的那条会话**（本会话不代改、不吸收、不为它改判据）。⚠️ 证据载体是易失的：崩溃屏正文与截图落在 `e2e/test-results/profile-avatar-e2ee-*-chromium/`，下一趟同目录运行会覆盖 ⇒ 要留证据先把它复制出去 | **下一条动作序列**：① 那批 WIP 落地或撤掉之后重跑同一条命令，看这枚红是否随之消失；② 若仍红，把探针升级成「完整照抄第 ② 段动作 + `page.locator('body').textContent()` 打印崩溃屏里的原始 `error.message`」——消息本体在 `ErrorScreen` 的 details 里，折叠时 a11y 快照读不到而 `textContent` 读得到；③ 拿到 message 之前不许写归因。复现：`cd e2e && NO_COLOR=1 npx playwright test tests/profile-avatar-e2ee.spec.ts --workers=1` ⇒ `1 failed（:213）/ rc=1`；整族：`NO_COLOR=1 npx playwright test tests/calendar-day.spec.ts …（第 7 行那串七个文件）` ⇒ `19 passed / 1 failed / rc=1`。✅ **21:0x 复跑：这一枚红不再出现**（同一批七文件 `20 passed / rc=0`、单文件 `1 passed / rc=0`、复刻完整旅程的探针两条腿都不崩，`heyta@2` 前后同名同版本）。🔴 但**不写成「已修复」**：现量到的唯一状态差是 `packages/op-log/dist/index.js` 在 21:00:41 被重建（此前它比自己的 `src/engine.ts` 旧），而 `packages/storage` 五个文件正 `M` ⇒ 崩的那一趟跑在「新 storage + 旧 op-log 产物」这种任何一次提交都不存在的组合上；机制是**假设**，不是结论。📌 由此新增一条**体检命令**（刻意不是门禁：并行会话正在改源码时「落后」是正常态，一条天生红的门禁等于没有门禁）：`node scripts/dist-freshness.mjs` 打印每个包**实际被消费的运行时产物**比源码新/旧多少秒，`--strict` 才判定，`--only ui,storage` 把范围收到「我这次判据真的读了哪些包」。**重开判据**：任何 e2e 再报「无法初始化本地存储」，先跑它；有落后的包就先重建，再看那枚红是否随之消失 —— 别再猜并发。21:1x 现量：三个包的产物落后（`app-host` 444s、`domain` 157s、`ui` 2718s），`--strict` 全量 rc=1、限定 `--only storage,shared-schema` rc=0（两臂都验过，它不是恒红机器）。探针与专用配置在 `e2e/_probe/` 与 `e2e/playwright.probe.config.ts`，都在主收集范围之外 |
| 12 | 🔴 **`docs/plans/README.md` 第 17 行是一张错位行**（21:4x 现量，本轮新发现）：「一、权威入口」那张表表头是 3 列（我想知道 / 看这一份 / 说明），而倒数纪念日那条索引行只有 **2** 列 ⇒ GFM 给它补一个空单元格，**整段状态文字落在「看这一份」列、「说明」列是空的**。不是报错，是静默错位 —— 正是本轮那条门禁存在的理由。⚠️ **它不是别人未提交的半成品**：`git show HEAD` 里同样命中，也就是已提交状态里就坏。🔴 **本会话不顺手修，两个理由**：① 那条行不归本线（AGENTS §8「不代改别人正在写的」）；② README 当前正被并行会话改动（`check:docs` 那 29 处就在他们手里），在他们可能整文件提交的文件里改第 17 行，最可能的结果是被覆盖 —— 这个形状本机今天已经实测过。**同样刻意不把它加进门禁清单**：加一枚已知会红的文件 = 造一条天生红的门禁（AGENTS §8.3），这条理由已写进脚本头，防止下一个人在读完 README 之前误加 | 写下倒数纪念日那条索引行的那条会话（批次一收口时加的这行） | 现量（本轮已按文档原文实跑过，读数 `rc = 1` 与 `docs/plans/README.md:17 列数 2（本表表头是 3）`）：命令原文在 `docs/plans/calendar-profile-handoff.md` §4.1 G 那个 bash 块。修法是一个单元格：把那行拆成「主题名 / 链接 / 状态说明」三列。修完之后才允许把 `docs/plans/README.md` 追加进 `scripts/check-md-table-rows.mjs` 的 `FILES`（现量基线：`node scripts/check-md-table-rows.mjs` ⇒ 「4 个文件…都一致」/ rc=0；能不能红由 M9、M10 两支臂现量，见 §4 21:4x 那行） ⚠️ **01:5x 复跑：仍在**。把工作树那份与 `git show HEAD:docs/plans/README.md` 那份各喂一遍同一套判据（临时副本改 `FILES`，没动清单）⇒ **两版都 rc=1** 点名 `:17` ⇒ 依旧不代改、也依旧不加进 `FILES`（加了就是一条天生红的门禁）。 |
| 13 | 🔴 **`check:l4` rc=1，红点不在本线**：`apps/web/src/features（L4 视图）：内联样式 110 处 > 基线 104（多了 6 处）`。归因是一条**未跟踪的新文件** —— `apps/web/src/features/sync/VaultSettingsPanel.tsx`（`stat` mtime **22:18:52**，我 22:19 跑门禁**前半分钟**才出现；它 import `@heyta/app-host` 的 `VaultKeySession` / `getWebVaultRemote`，是**口令库 / vault 那条线**的面）里 12 行 `style={{…}}`。同趟 `apps/mobile/src/screens` 仍是 **90 恰在基线** ⇒ 本批零内联样式 | 那条线的会话（未提交、未跟踪）。🔴 **不代改、不调基线**（脚本文件头自己写着"不要为了变绿直接把 baseline 调高"） | 🔴 **这条红只在混合工作树成立**：照门禁自己的单位（含 `style={{` 的**行数**、排除 `/shell/`）现量 `git grep -c 'style={{' HEAD -- apps/web/src/features \| grep -v /shell/ \| awk -F: '{s+=$NF} END {print s}'` = **100 ≤ 104** ⇒ 干净检出是绿的。复跑 `NO_COLOR=1 pnpm check:l4; echo rc=$?`。⚠️ 我自己第一版探针数的是**出现次数**（106）而不是**行数**，两个单位差 4~10，先对齐单位再谈归因 |
| 14 | **R17 的真浏览器截图（§6.2 规定一）没跑** —— 载体被占：22:18 现量 `lsof -nP -iTCP:4318 -sTCP:LISTEN` = node **74885** `vite --host 127.0.0.1 --port 4318 --strictPort`（ELAPSED 00:24，正是别人的一趟 Playwright），`4319` = node **56995** `stub-provider.mjs`（ELAPSED 05:20，AI 那条线的假端点），`require('os').loadavg()` = **22.43 / 48.54 / 64.09** | **环境**（端口 + 负载），不是产品。🔴 硬约束明令不许 SIGKILL 别人的 dev server ⇒ 只能等窗口 | 两个端口都空、负载落回来之后：写/跑一条"页头下拉数得出四个 `<option>`，第四个的文本 == `t('common.calendar.view.year')"的 Playwright 用例，截图落 `apps/web/evidence/calendar-view/view-tabs-4-options.png`，同目录 README 补一句"看见了什么"+ md5。探针：`lsof -nP -iTCP:4318 -iTCP:4319 -sTCP:LISTEN`。jsdom 那层已把**内容**钉住（web 29 passed），浏览器这层欠的是**它长什么样** 🔴 **22:3x 现场更新**：用例**已写好** —— 新文件 `e2e/tests/calendar-view-options.spec.ts`（两条：档位序列/词条文本从真源现读 + 四档逐个点过去比标题与板子），**但一次都没跑过**：22:33 现量 4318 又被别人的 Playwright 占回（22:29 那个空窗只几十秒），而 `e2e/playwright.config.ts` 把 4318 写死、无环境变量旋钮 ⇒ 不改他的配置，等窗口。跑法 `cd e2e && npx playwright test tests/calendar-view-options.spec.ts`；`apps/web/evidence/calendar-view-options/` 目录与 README 此刻**还不存在**（要跑成功才有）。 |

⚠️ 本篇**不新增**"等本批做完再说"式的第四类缺口：做不到的事情要么在上面这张表里有行，要么就是已经做完了 —— 没有第三种。

---

## 6. 本批登记的已知边界（不是阻塞，是"知道却没顺手改"的 —— ⚠️ 标题原本写着"两件"，R14·补 之后是四件；这个数字本身就是一条会漂的抄件，改成不写条数）

| # | 边界 | 为什么本轮不动 | 下次要动的代价（已量） |
|---|---|---|---|
| 1 | **月份名的命名空间名不副实**：年档短月份名复用 `web.board.month.1..12`（仓里唯一一份月份名），可这批把它搬进了 `packages/ui` 的 `CalendarDateKey`，而移动端时间线标签本来也在读同一组 —— `web.*` 前缀的键被共享层读，与 AGENTS §5「语义名，不用外观名」是同一条规矩的反例 | 这是**纯改名**，不改变任何界面输出；把它和"新增一档"混进同一次改动，下一次红就分不清来自哪个。宁可留一行登记，也不要"顺手一起改" | 新增 `common.date.monthShort.1..12` 并搬：词条表两份 + `check:ui-language` 的键集判据 + 三处消费者（`date-text.ts` 的 `monthMessageKey`、`CalendarSidebar`/时间线标签、web 月档格标题）。⚠️ 反例提醒：**不开第三套抄件** —— 本轮刻意复用而不是新写一份月份名，就是因为第三套一定会漂 |
| 2 | **年档月卡 ↔ 侧栏迷你月历是"同形状的第二次"**：两处都在小格子里回答"这天有没有事"（`packages/ui/src/calendar/CalendarYearBoard.tsx` 的点 vs `apps/web/src/features/calendar/CalendarSidebar.tsx:123,221` 的 `calendar-mini-day-*`），而且**共用同一条判色规则** `calendarDayTone` | 两者**故意不同**：侧栏那格是**可点的完整月格**（点下去=选日），年档那格是**只读缩略 + 点整月**。合并要么给 `DayCell` 加"尺寸 / 可点粒度"两套参数，要么把侧栏从手写 HTML 重写成 `@heyta/ui` 组件 —— 后者的形状变化会被 `check:l4` 的"内联样式只减不增"当场拦下（现量：mobile 段 **90 恰在基线 90，零余量**；脚本还在建议把某段基线**下调到 98**，也就是说 web 段基线同样是收紧中的） | 要合就先准备 l4 的余量（**消掉**净增，不是加净增），且这属于"共享 UI 收敛"那条线（`docs/plans/multi-end-unified-strategy.md` §4.3），不属于日历批次。🔴 登记在此是为了下一个人**别再判成"顺手合并"** |
| 3 | **现在线横穿时刻标签那一列**：`nowLine` 是 `position:absolute; left:0; right:0`（`CalendarDayBoard.tsx:265-270`），而小时标签就在同一行的左侧（`space.12` 列宽）⇒ 线压在"16:00"那几个字上。参考图里那条线是从标签**右侧**起的 | R14 判的是"时刻能不能输入、能不能呈现"，线画到哪儿是另一条视觉规则；而且这条**没有任何判据覆盖**（`now` 只在真界面有，e2e 夹具里线不出现 ⇒ 截图取证也照不到它）。把它和输入侧混进同一批，下一次红就分不清来自哪一个 | 改法很小：`left` 从 `0` 换成 `tokens['space.12']`（同一份宽度，不新造 token）。**但必须配一条几何判据**才不算"改完没人守"：真浏览器里量 `-now-line` 的 `x` 起点 ≥ 任一 `-clock-` 标签的 `right`；并且要让夹具真的传 `now`（现在它不传，所以这条判据现在写出来会红在"没有线"上） |
| 4 | **测试脚手架里那份"等写入落盘"的助手有一族抄件**：`function flush` 在 `apps/web/tests` 里 **16 个文件各写一份**、`function waitFor` **9 个文件**（其中 **6 个文件两个都有**）。⚠️ 本行第一版写的是"5 份抄件"，那是拿"注释里出现 `void store.` 的文件"当分母量的 —— 那个 grep 数的是**注释**，不是助手，所以系统性偏小（4 个里逐个读过注释：确实都是为"界面回调不等待、落盘要穿过 op-log"写的：`reminders-panel.spec.tsx:136/151`、`notes-view.spec.tsx:92/107`、`category-colors-flow.spec.tsx:38/76`、`habits-list-pane.spec.tsx:65`）。R14 这轮又添了一种新写法 `drainWrites()`（`due-date-edit.spec.tsx`，等的是 store **返回的 promise** 而不是轮询）| 这是**判据的管道**不是产品代码：`check:layering` 管的是 `apps/*` 不许长业务，管不到测试内部重复。把它抽成共享助手要动 5 个文件，其中 4 个正被别的会话的路由改动牵动（同一批里 `trash.spec.tsx` 已经因 `packages/op-log` 的 WIP 漂过一轮）。R14 只把自己那一处做到"不等 tick"，因为**再等固定 tick 是已知的 flake 源**（那两个文件的注释自己写着） | 抽 `apps/web/tests/helpers/settle.ts`（一个 `drainWrites` + 一个 `waitFor`），5 处消费者改 import；🔴 只减不增：抽完必须**删掉那 4 份本地副本**，否则就是 AGENTS §3.5 里"抽出来但旧的那份还活着"的原样重演。现量命令：`grep -rln "function flush" apps/web/tests \| wc -l` 与 `grep -rln "function waitFor" apps/web/tests \| wc -l`（🔴 用 `-l` 数**文件**，`-n` 数的是行、会把一个文件里的多处算成多份）。抽完之后这两个数都要是 **0**（搬进共享助手、本地副本删净），而不是"应为 1"—— 共享那份该在 `apps/web/tests/helpers/`，不在这两个 grep 的 `apps/web/tests` 根下才算搬走。**⚠️ R15a 追加（同一族的第五种写法，而且是它把我自己的用例照红的）**：R14 那处 `drainWrites()` 等的是**写入返回的 promise**，可"先播种一条任务、再渲染界面"的测试里，`setDueDate` 也在**入队之后**就 resolve，而组件读的是**已物化的快照** ⇒ 播种完成 ≠ 界面看得见那条截止时间。表现是本文件单跑 **15/15 全绿**、全量跑红 1 条（「清除」按钮不存在）—— 这种"单跑绿、全跑红"不是 flake，是**时序依赖**：全量里前面几百个用例把 CPU 压满，物化被推到了 tick 之后。修法：`due-date-edit.spec.tsx` 新增 `waitUntil(label, done, limit=200)`（在 `act` 内**轮询条件**、宏任务推进）与 `seedDue(due)`，把**全部 4 处**播种点从 `await setDueDate(...)` 换成 `await seedDue(...)`。现量：`grep -rln "function flush" apps/web/tests \| wc -l` = **16**、`function waitFor` = **9**、`function drainWrites` = **1**、`function waitUntil` = **1**（`-l` 数文件、`-n` 数行，这两个数不可混用）。🔴 搬走时的**终点判据**因此是这四个数全为 0，而不是只盯 `flush` 那一列 —— 漏掉 `drainWrites`/`waitUntil` 就等于留下两份"看起来不一样所以不会撞"的抄件，而它们违反的是同一条规矩（不许等固定 tick） |
| 5 | 🔴 **`web.*` 命名空间的键被移动壳读 179 处**（R15a 现量）。`grep -rho -- "'web\.[a-zA-Z0-9._-]*'" apps/mobile/src \| wc -l` = **179 处**，分布在 **11 个文件 / 178 行**（`grep -c` 逐文件相加 = 178 ⇒ 有 1 行含两个键），去重后 **172 个键**。最多的三个：`lib/timeline-labels.ts` 51、`lib/habits-display.ts` 38、`screens/ExportScreen.tsx` 21。阳性对照（同一趟、同一形状）：`'common\.\…'` 在 `apps/mobile/src` = **76 处** ⇒ 不是正则没跑，是真的在这么读。本屏（`ProfileScreen.tsx`）命中 **0** | 这不是"命名不好看"：`web.*` 描述的是**哪个壳画的**，所以移动壳读它 = 界面上的话由另一个产品来说 —— AGENTS §5「语义名，不用外观名」的反例。但**改它 = 一次跨 11 个文件的纯改名**，词条表两份 + 每个消费者都要动，而这一批的产物是"移动端能改昵称"。**把 179 处改名和新增功能混进同一次改动，下一次红就分不清来自哪一个**（本轮已经付过一次这个学费：`web.settings.profile.*` → `common.profile.*` 只有 1 个文件 24 处，红的时候一眼能归因）。🔴 只登记、不顺手改 | 一次性搬 172 个键到 `common.*`（或 `mobile.*` 中真正属于移动壳的那部分）。**顺序有讲究**：先把 `web.*` 里被跨壳读的键挪到 `common.*`（语义命名空间），再谈"移动壳自己的新键叫什么"。常驻守卫已就位：`apps/mobile/tests/profile-nickname-entry.spec.ts` 里"本屏一个 `web.*` 键都不读"这条**作用域限在 `ProfileScreen.tsx`**，并配同形状阳性对照（同屏 `t('common\|mobile.` 命中 >6）—— 对照的作用是证明"0"来自扫描真的跑到了那一段，而不是正则是空的。🔴 **本行第一版的取证命令是错的，抄它的人会拿到 0**：我先写成 `grep -rho \"'web\…'\"` 放在双引号的 `$( )` 里，`\"` 变成字面 `"` ⇒ grep 找的是**带双引号**的串 ⇒ 输出 `mobile_web_keys=0`。把一个假 0 记进台账比不记更糟，所以这里的数是**把 pattern 放进变量、以 `-- "$PAT"` 传参**重测的第二次读数 |
| 6 | 🔴 **捕获语法目前只有中文那一套**：`packages/domain/src/capture.ts` 的 `RULES` 逐条都是中文词形（`今天\|今日`、`明天\|明日`、`后天`、`下下(?:周\|星期\|礼拜)…`、`M月D日`），而**界面语言与输入语法是两件不同的事** —— 界面切成 en 之后用户打 `tomorrow 4pm` 不会被解析，标题原样留着，症状长得像『输入框没反应』。R16 那条英文 e2e 因此刻意仍用「今天」播种（并把落库标题写成 ASCII），完整理由在 §4 的 09:5x 那一行 | 这不是『翻译』能解决的：英文相对日要有自己的规则表（`next wednesday` / `in 3 days` / `tue` 的歧义、序数词、`eom`），而**规则表的语言归属**要先拍 —— 它属领域层（`packages/domain`）而不是 i18n 词条，因为规则产出的是 `LocalDate`、不是文案。和本批混在一起，下一次红分不清来自哪一边 | 代价先给**形状**不给工时：`RULES` 是 `{field, re, resolve}` 的数组、顺序即优先级。加英文那一档只有两条路 —— ① 按语言选表（`parseCapture(input, {locale})` ⇒ 签名要改，调用点要先枚：`grep -rn "parseCapture(" packages apps`）；② 两套规则并排 ⇒ 🔴 `16:00` 那条是**语言中立**的，并排就等于存在两条『时刻』规则，那是 AGENTS §3.5 那一族（同一个判断写两遍 = 两套裁决）。⇒ 先拍归属再动手。现量（18:00）：`grep -c "^\\s*re: /" packages/domain/src/capture.ts` = **17** 条规则，其中 pattern 里含 CJK 的 = **12** 条 —— 那 12 条就是"英文用户说不出来"的那一部分（剩下 5 条是语言中立的，`16:00` 与 `!1` 这类） |
| 7 | **"哪些档位存在"仍声明在两处**：web 是 `CalendarHeaderToolbar.tsx:50` 的 `{value, labelKey}[]`，移动端是 `CalendarScreen.tsx:75` 的 `CalendarViewKind[]` —— 值同、键同、表两份（R13 落地时**两边都**加到了四档，靠的是人记着改两处） | 台账 `ui-review-fill-zh-timeline.md` §9.13 第 3 行原话是"等年视图落地时一起判"，而**年视图已落地** ⇒ 时机到了，但那一判**不属于日历批次**：它要动的是两端的档位表与 `check:rn-aria`/`check:l4` 的余量，混进 R13/R14 会让下一次红分不清来自哪一边。⚠️ 这条是**登记**，不是"已裁决" | 收成一份的去处是共享层（`packages/ui/src/calendar/model.ts` 已经在管 `CalendarViewKind`，加一份 `CALENDAR_VIEWS: readonly {kind, labelKey}[]` 即可）；🔴 撞点是 `check:l4` 的 mobile 段基线**零余量**（上面第 2 行量过）⇒ 只能"消掉净增"。判据的形状：两端各自断言"档位集合 == 共享那份"（而不是各写一份字面量清单 —— 那会是第三份抄件）。现量：`grep -n "VIEW_OPTIONS" apps/web/src/features/calendar/CalendarHeaderToolbar.tsx apps/mobile/src/screens/CalendarScreen.tsx` ✅ **R17 已闭合**（2026-10-03 22:1x）：那两份合成 `packages/ui/src/calendar/model.ts` 里的 `CALENDAR_VIEW_LABEL_KEYS`（`Record<CalendarViewKind, CalendarViewLabelKey>` —— 加一档不给键名是**编译不过**，V3 实测 `TS2741: Property 'quarter' is missing`）+ `CALENDAR_VIEW_ORDER`（顺序），web 与 mobile 各自**删掉**本地那张表。判据三处与六支臂读数在上面 §3「R17 的六支变异臂」。🔴 这一行原句留着，是为了让后来者看清它当时的性质是"知道却没顺手改"，而闭合后的判据有牙 —— V2 那支就是"把表加回去"，它**两端同时红**。 |
| 8 | 🔴 **全仓 markdown 表格的结构仍然没人守**：同一套判据跑 `docs/` 全目录 = **179 个 `.md` 里 27 个有问题、共 73 处**（最集中的三个：`docs/plans/multi-platform-widgets-progress.md` 9、`docs/plans/goal-multi-end-coverage.md` 8、`docs/runbooks/icp-app-filing.md` 7） | 新那条检查**刻意只圈本线两份文档**（`scripts/check-md-table-rows.mjs` 里 `FILES` 是显式清单）。**一条天生红的门禁等于没有门禁**（AGENTS §8.3），而把 27 个文件一次抹平就是替别的条线改他们正在写的台账 —— 与 §5 第 1 条同一类越界。⚠️ 也别读成"那 73 处都是别人的"：`ui-review-fill-zh-timeline.md` 那 7 处里有一部分是本线自己写的，已在本轮修掉 | 现量口径写在脚本文件头。别的条线认领时**把自己的文档名加进 `FILES`**（加一个验一个，别一次加 27 个 —— 一次加完就跑不起来了） ⚠️ 22:2x 现量更新：圈的范围已从"本线两份"扩到 **4 个文件**（加进本批新写的交接稿与纠错账，前提是"归本线写、且现量干净"），而且它**第一次是在我自己刚写的内容上红的** —— V3 那一行的代码段里一个裸竖线（`\| tail`）多加出一整列，rc=1 点名 `:338`。⇒ "这道门有牙"现在有三条证据，而这一条不是自造夹具。 |
| 9 | 🔴 **`common.due.allDay` 与 `common.calendar.dayAllDay` 是同一句「全天」而两个键**（en 同理两个 `All day`；另外 `common.calendar.dayNoTimed` / `dayAllDayEmpty` 两句里还各嵌一次「全天」） | 不并键：键名说的是"哪块面的标签"，并了会让日历去读任务编辑器的键（或反过来），那比两份同值句子更难追。本轮改成**有牙的等值判据**：`apps/mobile/tests/task-due-time.spec.ts` 的 T5 逐语言断言这两个键的值必须逐字相同（变异臂 M6 实测：只漂 zh 那句 → failed=1，红的就是这条） | 真要收成一份，去处是共享层的一份**键名常量**而不是新增键：`packages/ui/src/calendar/date-text.ts` 已经在做"两端共用同一个键名"这件事，加一个 `ALL_DAY_MESSAGE_KEY` 让两块面各引用它即可。代价：两块面的措辞从此必须同步改 —— 而这正是等值判据已经在强制的约束，所以收益只是少一个键名 ⇒ 低优先，先让判据守着 |
| 10 | 🔴 **C 脚本的三个包装函数硬编码共享 dump 路径 `/tmp/ui.xml`**：`rid_count / rid_xy / rid_attr`（`scripts/verify-mobile-due-time.sh:159-161`）都读同一个文件，而定位器 Python 自己**已经**改成进程私有（`RID_PY="/tmp/_heyta_rid_$$.py"`，文件头 89–95 行写着理由）⇒ 这是**半个修复**：同机两趟并发时读的是对方的无障碍树，而"有内容但不是我的树"比"空文件"更难归因 | 今天不暴露是因为 §8.9 那道设备门（`mobile_e2e_runner_lines`）已经把同机并发排除了 —— **它被门挡住，不是被设计挡住**。真要改得连 `dump` 的写出位置一起改，而 `dump` 住在 `lib/mobile-e2e.sh`，那条文件正被并行会话整片重构（⑮ 有现量），跨文件改共享装置不属于日历收尾这一批 | 把 `dump` 的目标路径收成一个变量（`UI_XML="${UI_XML:-/tmp/ui.xml}"`，默认值**逐字不变**，与本批 W0b 对 `/tmp/_xy.py` 的做法同一形状），三个包装函数与 `lib` 的 `dump` 都改读它；闭合判据：`grep -c '/tmp/ui.xml' scripts/verify-mobile-due-time.sh` 从现量 **3** 变 **0**（`:159`/`:160`/`:161` 那三行）；同形状的全仓基线现量 = **30 处 / 28 个 `scripts/verify-mobile-*.sh`**（`grep -rc` 相加），改完之后这个总数只减不增 |
