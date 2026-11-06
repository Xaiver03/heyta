# 11 格「半有」的逐格取证：heyta 已有什么、缺的是哪一步

> 日期：2026-11-06。对象：本机工作树 `~/heyta-work` 当前内容。
> 来源表：[ticktick-surface-matrix](../ticktick-surface-matrix.md) §1 与 §2 —— §1 的 heyta 列共 **11** 格写作「半有」
> （原文行 `:141 :155 :175 :177 :195 :197 :199 :210 :211 :221 :233`，与 `:367`、`:475` 自称的 11 格对得上）。
> 分工：[decision-surface-granularity](decision-surface-granularity.md) 回答的是**记账口径**（这格算"缺一屏"还是"缺一段"）；
> 本文只回答**代码事实**（这格里现在到底有什么、最后一步在哪一层）。两份不要混读。

---

## 0. 「半有」的判定口径

沿用原表 §0.2 那条定义，本文不加严也不放松：

1. **半有 = 有一部分，但缺一个用户会注意到的半边。** 判据是"用户会注意到的那一半"，不是"代码有没有"。
2. **本文的追证形式**：每格给 ①**已有**（`路径:行号`，全部本轮实测打开过）、②**缺的那一步**（写清落在哪一层：UI / 主机层 / 不可逆层 / 平台）、③**一条能跑的 grep 及其命中**（cwd = 仓库根）。
3. 给不出 ① 的写「未核实」并写明**核它需要什么**，不猜（原表 §0.2 的 `未核实 ≠ 无` 同样适用本文）。

### 0.1 🔴 本轮工作树的取证限制（先读，否则有几格会被误读成"没做"）

这一份工作树**不是完整的**，以下目录是**空目录**（`find -maxdepth 2 -type d -empty` 实测）：
`server/src/*`（14 个域全空）、`server/prisma/migrations/*`（81 个迁移目录全空）、
`packages/app-host/src`、`packages/sync-client/src`、`packages/ai/src`、`packages/widget-core/src`、
`packages/inbound-core/src`、`apps/node-host/src`。
⇒ 凡结论要落到"主机层/服务端已有零件"的，本文一律标**未核实**，并给"需要什么才能核"。

另两处形状提醒：①`apps/src/` 与 `packages/src/` 是 `apps/*` 与 `packages/*` 的**聚合副本**（`stat -c %i` 实测 inode 不同），
原表 §0.4 的探针若不指定 scope 会把同一处代码数两遍；②本文所有引用只写**权威路径**（`apps/web/src`、`apps/mobile/src`、`packages/<名>/src`）。

---

## 1. #7 快捷键一览 / 自定义（`:141`）

- **已有（Web 侧三条全局键，全在 `App.tsx` 的 useEffect 里现写）**：`⌘/Ctrl+Shift+\` 开合详情列 `apps/web/src/App.tsx:1411-1412`；
  `⌘/Ctrl+K` 开合搜索 `apps/web/src/App.tsx:2284-2285`；搜索浮层 `↑↓ / Enter` `apps/web/src/App.tsx:2256-2265`；
  `Esc` 三条出口（批量选择 `:623-624`、次级浮层 `:2340-2342`）。列表光标 `↑↓ + Space` 在 `apps/web/src/lib/keyboard-cursor.ts:244-245`。
- **已有（桌面壳还有一条，原表没记）**：`⌘, / Ctrl+,` 开独立设置窗 `apps/desktop/src/main.ts:320-324`，判定函数 `apps/desktop/src/settings-shortcut.ts:20`。
  ⇒ 原表那句"对照 `shortcut` 仅 1 命中且在 mobile"是探针 scope 太窄造成的低估：**一共四条键、分住三处**（Web 渲染层、桌面主进程、共享壳）。
- **缺的那一步**：**一览**（无词表：`grep -rniI 'shortcut' packages/i18n/src/locales/en.ts` 命中 3 行 = `:1012` 注释、`:4461` 与 `:4512` 的落地页文案，**没有一条是设置界面词条**）与**自定义**（全仓无键位表这一层：`grep -rniIlE 'keymap|keybind|useHotkey|registerShortcut' --include='*.ts*' apps packages/*/src` = 0，对照同 scope 把词换成 `keydown` 命中 `App.tsx` 等 8 个文件）。
- 成本判断：一览 = 把散在四处的手面文案收成一枚数据；自定义 = 先要有那枚数据。**两半都不是"再加一节设置"那么轻**，但也不需要动不可逆层。

## 2. #16 总结 / Summary（`:155`）

- **已有**：成长页的周复盘块（`apps/web/src/features/motivation/GrowthView.tsx:304` → `selectWeeklyReview` → `apps/web/src/features/motivation/selectors.ts:79`）+ 里程碑/身份/热力图/分享卡（同文件 `:305-316`、`:264-274`）。
- **但它是只读投影**：`packages/domain/src/weekly-review.ts:131 computeWeeklyReview(input)` 从表里算数，没有任何"写回"通道；成长页连今日进度块都被裁掉了（`apps/web/src/features/motivation/GrowthView.tsx:379-380` `showToday={false}`，理由写在文件头 `:24-34`）。
- **缺的那一步（两半）**：①"一天/一周收尾"这一屏（可写、可留档）；②"插入总结"——滴答有 `views_summary_insertsummarywindow.baml`，而 heyta 的实体清单里没有 SUMMARY（`packages/shared-schema/src/entity-types.ts:22-97` 逐条数过：TASK…ASSISTANT_TURN，无 SUMMARY）。
- **最省的形态不需要碰不可逆层**：把复盘投影渲染成文本、走现成的 `addNote(content)` 存成 NOTE（`apps/web/src/features/notes/store.ts:52`、调用点 `apps/web/src/features/notes/NotesView.tsx:124`）——NOTE 早在实体清单里（`entity-types.ts:28`）。
- 复量：`grep -rniI 'SUMMARY' packages/shared-schema/src/entity-types.ts` = 0（对照同命令 `NOTE` = 1 命中 `:28`）。

## 3. #31 任务附件（`:175`）

- **已有（零件全在，原表说的"齐备"成立）**：纯函数层 `packages/domain/src/attachments.ts:45`（名称校验）/`:87`（按任务取活附件并排序）/`:103`（容量合计）/`:120`（图片判定）/`:137`（体积格式化）；实体 `packages/domain/src/entities.ts:971`；字节通道契约 `packages/shared-schema/src/attachment-http-contract.ts:45`（`MAX_ATTACHMENT_BYTES = 20 MiB`）与 `:48`（`ATTACHMENT_ROUTES`）。
- 🔴 **原表"界面零处"只在 Web 成立，移动端界面是全的**：`apps/mobile/src/screens/TaskDetailSheet.tsx:764`（`runAddAttachment`）、`:814`（删除 + 二次确认）、`:866`（列行）、`:1440`（渲染那一段），装配点 `apps/mobile/src/screens/TasksScreen.tsx:749-753`（`createAttachmentActions(host, …)`）。
  复量：`grep -rniIlE 'attachment' apps/mobile/src` = 多个文件命中；`grep -rniIc 'attachment' apps/web/src` = **1 文件 6 处**，命中的是 `apps/web/src/features/auth/passkey-browser.ts` 的 `authenticatorAttachment`，与任务附件无关。
- **缺的那一步**：Web/桌面壳没有装配点 —— 在 `apps/web/src/features/tasks/TaskDetailCard.tsx:271` 那格里接一个 `createAttachmentActions`（同形先例就在隔壁：`apps/web/src/features/notes/store.ts:94`），文件读字节可复用现成接缝 `apps/web/src/features/settings/avatar-encode.ts:67`、`apps/web/src/features/ai/image-encode.ts:82`。
- **未核实**：`createAttachmentActions` 本体与 `attachment-http.ts` 本轮取不到（`packages/app-host/src`、`packages/sync-client/src` 为空目录，`find … -path '*/attachment-http.ts'` = 0）⇒ "主机层到底通不通"要一份完整工作树或 `pnpm --filter @heyta/app-host test` 的读数才能核。

## 4. #33 标签管理（增 / 改 / 合并 / 批量）（`:177`）

- **已有**：侧栏内增 `apps/web/src/features/projects/ProjectsPanel.tsx:508`（`projects.addTag`）、改 `:486-487`（`renameTag`）、删 `:489-490`（`deleteTag`）；删除前的"影响 N 条任务"口径在 `packages/ui/src/projects/model.ts:395 liveTaskCountsByTag`（含已完成，理由见 `:380-390`）；单条任务的标签勾选 `apps/web/src/features/tasks/TaskOrganizer.tsx:273-284` → `apps/web/src/features/tasks/store.ts:448 setTags`。
- **无合并（这半是真没有，不是没找到）**：`grep -rniIlE 'mergetag|merge_tag|tagMerge|mergeTags' apps packages/*/src packages/shared-schema/src` = 0；全仓命中只在文档与已构建产物里（本轮实测 3 个文件：两份 docs + `apps/desktop/renderer-dist/assets/index-*.js`）。
- **无批量加标签**：批量工具栏只有三种动作 —— `apps/web/src/App.tsx:634-635` 的 `runBulkAction(kind: 'complete' | 'delete' | 'move')`，三个调用点 `:2812`、`:2832`、`:2865`。
- **已知的孤儿引用是明文立场，不是缺陷**：`packages/ui/src/projects/model.ts:386-388` 写死"`removeTag` 只 DEL 标签实体，不回收任务上的 `tagIds`"，另有 `apps/web/src/features/tasks/TaskOrganizer.tsx:85-87` 教界面容忍查不到的 id。⇒ 做合并时要一并决定这条口径要不要改。
- **缺的那一步**：独立管理页（视图 + 槽口径下只是"一段"）+ 合并 op（把 A 的引用换到 B 再删 A，一次用户意图 = 一个 op，AGENTS §3.4）+ `runBulkAction` 多一档 `tag`。

## 5. #46 习惯打卡记录（按月网格逐日看历史）（`:195`）

- **已有，且比原表记的多**：习惯面单挂了**月档 + 年档**的趋势板 `apps/web/src/features/habits/HabitDetailCard.tsx:350-363`，档位是日历词表的子集（`packages/ui/src/habits/HabitTrendBoard.tsx:43-46`，只有 `'month' | 'year'`），板上可**逐日点格补打卡 / 撤销**（`HabitDetailCard.tsx:355-360`）；口径唯一所有者 `packages/domain/src/habit-streak.ts:335 computeHabitPeriodStats`，逐月调用见 `packages/domain/src/habit-year.ts:87`。
- 🔴 **原表给的两条行号要纠**：`apps/web/src/features/habits/HabitsView.tsx:623` 那一行是**新建习惯对话框里的"可补打卡天数"字段**（`:626` `label = t('web.habits.backfill.label')`），不是"近 90 天热力图"；热力图在成长页（`packages/ui/src/motivation/GrowthBoard.tsx:258-259 ActivityHeatmap`），且它是**跨习惯的年度活动**，不是单条习惯的打卡记录。
- **缺的那一步只剩"能不能被点名"**：这块板只在"选中某条习惯"时渲染（`HabitDetailCard.tsx:349` `selected === undefined ? null : …`），既不能从 rail 直达，也没有深链接可寻址 —— 本轮 Web 只有两类深链：设置 `apps/web/src/lib/settings-deep-link.ts:107`、登录 `apps/web/src/lib/auth-deep-link.ts:31`。
- 复量：`grep -rn 'HabitTrendBoard' apps/web/src packages/ui/src/index.ts` 命中 = `HabitDetailCard.tsx:32/350`、`packages/ui/src/index.ts:1278`（原表记的"没有独立打卡记录窗"，在**内容**意义上已经不成立，只在**窗口**意义上成立）。

## 6. #48 习惯统计图表（完成率 / 仪表）（`:197`）

- **数字侧已有，且不是只在成长页**：单条习惯面板上就有一排"本月打卡 / 本月完成率"（`packages/ui/src/habits/HabitBoard.tsx:553`，词条生产者 `:165-170 monthRate`），年档每格带完成率（`packages/ui/src/habits/HabitYearBoard.tsx:53-54`、`:72`），今日比例来自 `packages/ui/src/habits/model.ts:203 todayRatio: completionRatio(…)`（口径唯一所有者 `packages/domain/src/habit-streak.ts:249`）。⇒ 原表把这半记成"在成长页"是低估。
- **图形侧确实没有**：`grep -rniIlE 'function (Chart|Sparkline|Gauge|BarChart|LineChart|Trend)' packages/ui/src` = **1 命中**，且是同名不同物 `packages/ui/src/timeline/model.ts:236 chartSpan`（时间轴像素跨度）。仓内没有可复用的图表原语。
- **缺的那一步**：单条习惯的时间序列图（周/月完成率折线或仪表）。**数据不用新建 op**：`computeHabitPeriodStats`（`packages/domain/src/habit-streak.ts:335`，含"已到期计划日数"作分母，见 `:277`）已是现成生产者，缺的只是绘图层 + 挂进 `HabitDetailCard` 那块槽。
- 口径提醒：这一格与原表 #48 的差别不在"有没有数"，在"有没有图形"——写差集时别把两者混成一句"统计没做"。

## 7. #50 专注统计 / 记录明细（`:199`）

- **已有**：专注视图右栏**四张概览卡 + 逐条记录列表** `apps/web/src/features/focus/FocusDetailPane.tsx:51-77`（今日轮数 / 今日时长 / …）与 `:79-121`（`focus-records` 那组 `li`，含时长、关联任务、放弃标记 `:113-117`）。文件头 `:5-7` 自证这是后来补的："此前一条专注记录都没被逐条渲染过"。
- **值全部来自单一口径**（组件自己一个数都不算，`FocusDetailPane.tsx:9-11`）：当日 `packages/domain/src/focus.ts:381 focusStatsForDay`、累计 `activityTotalsFromState`、列表 `listSessions()`。
- **缺 ①**：**按日/周/月的图表屏**——领域层只有"某一天"这一档聚合（`packages/domain/src/focus.ts:359 FocusDayStats`、`:381`），没有周/月窗口函数；分桶键已有 `focusSessionDay`（`:338`）。
- **缺 ②**：**补录记录**。没有任何手建 `FOCUS_SESSION` 的写入口（实体在 `packages/shared-schema/src/entity-types.ts:56`，而 `packages/domain/src/focus.ts:354-356 shouldPersistSession` 只放行 `kind === 'work'` 的真跑完会话）。这半与原表 §2.4 里"该明确裁决"的说法一致：要不要接受非计时来源的会话，是产品决定。
- 原表"当日与累计在详情面（`FocusDetailPane.tsx:43`）"这句现在要加一笔：**逐条明细也在了**，仍缺的是"图 + 补录"。

## 8. #56 外观 / 主题 / 应用图标（`:210`）

- **已有（设置 →「外观与语言」这一组共四行）**：截止时间显示模式（日期/倒计时）`apps/web/src/App.tsx:3697-3721`、详情栏默认 `:3724-3758`、语言 `:3762-3765`、主题浅色/深色切换 `:3766-3787`（唯一记账点 `rememberThemeChoice` `:3778`）。词条 `packages/i18n/src/locales/zh-CN.ts:798-800`（原表写 `:797`，行号漂 1）。
- **主题只有两档，且系统偏好只当兜底**：`apps/web/src/lib/theme.ts:9`（`type Theme = 'light' | 'dark'`）、`:15`（键 `heyta.theme`）、`:24-38`（`resolveInitialTheme` 的优先级：用户已选 > 系统）。⇒ 没有"跟随日落自动切暗"这一档，滴答有（`views_theme_autodarksettingwindow.baml`）。
- **没有自定义主题的槽位**：`grep -n "data-theme" packages/design-system/src/tokens.css` 只有 `[data-theme='dark']` 两处覆盖（`:697`、`:818`），即"默认 + 暗色"两套，没有 accent/主题编辑器落点。
- **应用图标：全仓无运行时换图标能力**，`grep -rniIlE 'setIcon|appIcon|alternate.?icon' apps packages/*/src` 在源码里 0 命中（只有 iOS 构建日志与本文）。**界面密度**同理：`grep -rniI 'density' apps/web/src` 只命中 CSS 的 `appearance: none`（`apps/web/src/styles/app/form.css:110` 等），不是密度项。
- 缺的那一步是四件"编辑器深度"（自定义色、自动暗、图标、密度），不是"设置里再加一行"。图标那件还额外受平台约束（MSIX/PWA 图标不是 App 内能改的东西）。

## 9. #57 提醒与通知设置（桌面 Web）（`:211`）

- 🔴 **这一格原表判反了方向，Web 有独立一节**：`apps/web/src/App.tsx:3646` 就是 `settings-group-notifications`（组名词条 `mobile.settings.section.notifications` = 「提醒与通知」`packages/i18n/src/locales/zh-CN.ts:3786`；原表写 `:3776`，那一行其实是「正在读取个人资料…」）。组内四块：系统授权再入口 `<ReminderNotifyPanel />` `App.tsx:3651`、共享清单本地偏好 `:3657`、小组件安装旅程 `:3671`、Web Push 开关 `:3672`。
- **探针为什么没命中**：原表的 grep scope 是 `apps/web/src/features/settings`（`:211`），而 `ReminderNotifyPanel` 住在 `features/reminders/`（`apps/web/src/features/reminders/ReminderNotifyPanel.tsx:31`，由 `App.tsx:138` import、`:3651` 挂载）。复量原探针可复现其误导：`grep -rniIl notification apps/web/src/features/settings` = 1 文件（`WidgetPushPanel.tsx`）。
- **底层能力不是零**：浏览器通知那一条腿是实做的 `apps/web/src/features/reminders/notify.ts:43`（可选 `requestPermission`）、`:56`（非安全上下文 `http://` 会抛，已被判住）。
- **仍缺的半边**（诚实说，这半确实薄）：那一组里没有跨任务的打扰偏好（提前提醒默认、勿扰时段、声音），也没有"提醒在后台要不要响"——`docs/research/legal-dataflow-client.md:92` 明写现状"只在应用开着且发生过 op 时到点响，后台唤醒需一套不泄露内容的协议，未做"。
- **未核实**：移动端的"提醒默认"是否真在里面（`apps/mobile/src/screens/SettingsScreen.tsx:669-684` 只渲染 `ReminderDeliverySection`，其行集来自共享层，而 `packages/app-host/src` 本轮为空）⇒ 需要完整工作树读 `reminderRows` 生产者才能判。

## 10. #62 登录 / 注册 / 二次验证（`:221`）

- **已有（比原表记的多一档）**：认证动作枚举 `apps/web/src/features/auth/AuthPanel.tsx:146-156` 共七档 —— `central-login` / `login-link` / `register` / `passkey-register` / `passkey-login` / `password-register` / **`login-code`**（邮箱验证码登录，词条 `:491-499`，服务端对应迁移目录名 `20261020000000_add_email_login_challenges`）。另有 OIDC 中心登录判定 `:395`、passkey 可用性探测 `:354`；通行密钥管理面 `apps/web/src/features/settings/PasskeyPanel.tsx:142`。
- **无 TOTP/2FA**：`grep -rniIlE 'totp|otpauth|two_factor|twoFactor' packages/shared-schema/src packages/i18n/src/locales/zh-CN.ts` = 0；中文侧同 scope 的 `手机号|短信|二次验证` 也 0，而对照词 `邮箱` 在同一文件命中 **138** 处 ⇒ 这条否定探针是有力度的（有对照、同 scope）。
- **无手机号注册**：`AuthPanel.tsx:146-156` 那七档里没有手机那一档，i18n 里也没有词条；`packages/i18n/src/locales/zh-CN.ts` `手机号` = 0。
- **缺的那一步跨三层**：(a) 服务端凭据列与校验（本轮 `server/src/password`、`server/src/central-auth` **是空目录**，`grep -rniI password server/src` = 0 且**阳性对照同样 0** ⇒ 这条否定不作数，见 §0.1）；(b) 线协议里一档挑战流程（`packages/shared-schema/src/auth-http-contract.ts` 本轮存在但未见 2FA 字段，未逐字核）；(c) 账号与安全组里的绑定/解绑 UI。**不是"补一段 UI"**，三样都得先来。
- 若要判"要不要做 2FA"：它是产品裁决（与 §0.4 的 G7 应用锁同一类），不属于粒度口径能消化的格（`decision-surface-granularity.md:105` 已标 `†`）。

## 11. #69 新手引导 / Web 首启（`:233`）

- **已有（Web 侧唯一"首启主动弹"的一屏）**：隐私同意 —— `apps/web/src/features/privacy/first-launch.ts:25-26`（`armFirstLaunchConsent`：还没问过就开）、启动调用点 `apps/web/src/main.tsx:194` 与 `apps/web/src/App.tsx:771`、判定 `apps/web/src/features/privacy/store.ts:99 shouldAskOnFirstLaunch`、出口枚举 `:23`（`'first-launch' | 'revoked' | 'required-for-action' | 'settings'`）。
- ⇒ "**首启只弹一次**"的记账机制已经存在并可复用（`store.ts:42` 那条 `reason: 'first-launch'` 的默认态），引导屏要新增的不是机制而是内容。
- **已有（相邻的一块引导，别漏算）**：Windows 小组件安装旅程 `apps/web/src/pwa/widget-install.ts:154`（`showInstallGuide: platform === 'windows'`）与 `:204 shouldShowInstallGuide(standalone)`，挂载点 `App.tsx:3671`。
- **Web 确实没有介绍屏**：`grep -rniI 'welcome' apps/web/src` 命中的只有 AI 面板的 CSS 类名（`apps/web/src/styles/app/ai-panels.css:1182/1194/1306/1311`）；原表的探针 `grep -rn 'Welcome' --include='*.tsx' apps/web/src` = 0 也复核成立（阳性对照同 scope 换 `Settings` 命中数十文件）。
- **移动端那一屏长什么样（可搬的形态）**：`apps/mobile/src/screens/WelcomeScreen.tsx:134-147` 三个 props（`initialServerUrl` / `onUseOffline` / `onSignedIn`），轮播与 `reducedMotion` 不自动翻页见 `:157-159` —— 即"离线继续 / 登录"两条出口，Web 侧对应的出口是 `App.tsx` 的 `view === 'search' | 'settings'` 那套浮层出口（`:2338-2346`），**没有同形宿主**。
- 缺的那一步：一屏内容 + 一条"首启未完 → 弹 → 记一次"的接线；顺带值得决定的是首启要不要把导入入口（`apps/web/src/features/settings/TickTickImportPanel.tsx:101`）摆进那一屏。

---

## 汇总：11 格里有 6 格的现状与原表不一致（本文实测）

| # | 原表说法 | 本文实测 | 性质 |
|---|---|---|---|
| 7 | shortcut 仅 1 命中且在 mobile | 四条键分住 Web / 桌面壳 / 共享壳（`main.ts:320`、`App.tsx:1411/2284`、`keyboard-cursor.ts:244`） | 低估 |
| 31 | 界面零处 | 移动端 UI 齐（`TaskDetailSheet.tsx:764/814/1440`），缺的是 **Web 装配点** | 判反端 |
| 46 | 没有独立打卡记录窗 | 月/年网格 + 逐日补打卡已在槽内（`HabitDetailCard.tsx:350`）；缺"可点名 / 可深链"；且原表 `HabitsView.tsx:623` 是补打卡天数字段不是热力图 | 低估 + 行号错 |
| 48 | 习惯内页没有图表 | 完成率数字已在板内（`HabitBoard.tsx:553`、`HabitYearBoard.tsx:53`）；缺的是**图形**（仓内无图表原语） | 措辞过粗 |
| 50 | 当日与累计在详情面 | 逐条记录列表也已在（`FocusDetailPane.tsx:79-121`）；仍缺周/月聚合与补录 | 低估 |
| 57 | 桌面 Web 设置里没有这一段 | 有独立一组 `settings-group-notifications`（`App.tsx:3646`，四块）；缺的是跨任务打扰偏好与后台唤醒；原表 `zh-CN.ts:3776` 应为 `:3786` | 判反 + 行号漂 |

**未被推翻的三格**：#16（只读投影、无 SUMMARY 实体、无插入总结）、#33（无合并、无批量加、无独立页）、#62（无 TOTP、无手机号）—— 这三格的判据本文都拿到了同 scope 的阳性对照。
**成本形状最不一致的一格**：#31 与 #46/#48 —— 原表按"缺一屏"记，代码事实是"缺一处装配 / 缺一个寻址入口"，与 §0.4 的口径裁决（`decision-surface-granularity.md:89-111`）指向同一个结论：**先裁决粒度，再谈这 11 格的成本**。
