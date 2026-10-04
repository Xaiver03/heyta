# 计划层索引 —— **当前状态只有一个入口**

> 🔴 **本文件是 `docs/plans/` 的唯一入口。** 想知道"现在做到哪了、下一步做什么"，**只看本文件指向的那一份**，不要在本目录里翻。
>
> 建立于 2026-09-28。建立原因：本目录曾有 **30 份 / 25,117 行**计划，其中"多端/桌面"一片就有 6 份 / 13,735 行，**同一个问题在不同文件里各有一个版本的答案** —— 这正是"看到很多功能却不知道做到哪了"的直接原因。

---

## 一、权威入口（按优先级）

| 我想知道 | 看这一份 | 说明 |
|---|---|---|
| **本轮 goal：全量落账 + 分支合并 + 代码质量审计** | [`goal-landing-and-quality-audit.md`](goal-landing-and-quality-audit.md) | ✅ 已完成（2026-10-03）。82 个提交推送远端、`feat/countdown-anniversary` 合并进 main（四处冲突的产品裁决 + 陷阱编号重排 #137–140→#161–164）、验证矩阵全实跑（隔离 worktree build/typecheck/九道门禁/单测）。含 2 处已修类型潜伤、3 条登记发现，与本轮自己两次「管道吞退出码」假绿的照实记录 |
| **当前状态 / 下一步做什么** | [`multi-end-unified-strategy.md`](multi-end-unified-strategy.md) | 🔴 **唯一权威主计划**。它同时取代了 roadmap §5 与 4 份多端计划的路线部分 |
| **本轮 goal：设置的 IA（移动端优先 + 电脑端验证）** | [`goal-settings-ia.md`](goal-settings-ia.md) | ✅ 已完成。§7.1e 的执行 goal。主战场排序由产品负责人拍板：**移动端 + 电脑端，web 不是**；apps/web 的改动算电脑端的（macOS 壳加载共享 UI，`HeytaMacApp.swift:270`） |
| **本轮 goal：逐页排版对齐设计系统** | [`goal-layout-audit.md`](goal-layout-audit.md) | 🔴 进行中（2026-09-29 产品负责人重启）。四象限改 2×2 十字坐标系、AI 工具行重叠、macOS 标题条融入壳；逐页立**布局判据**（此前门禁只管"值从哪来"，不管"排版怎么排"） |
| [countdown-anniversary.md](countdown-anniversary.md) | 🔄 **批次一已落地**（2026-10-03）：倒数纪念日（农历生日 / 传统节日 / 卡片式倒计时 / 钉住与归档 / 纪念卡片导出）。决策 = [ADR-0044](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md)（`EVENT` 实体 / 农历构建期生成+运行时查表 / 节假日 A·B·C 三档分发 / 图片双档）。✅ W1 历法层 + W3「每年」预设 + W4 节假日随包数据（三道反证 + bundle 闸门，变异验证逐例登记在该文 §3.5 那张表里，此处不复制总数）；⏸ W0/W2/W5/W6 未开工（W2 有服务端先行的部署顺序风险，留批次二）。🔴 它**推翻**了 [`goal-layout-audit.md`](goal-layout-audit.md) §4 里"节日标注无数据源 ⇒ 不做"那条判断的理由（勘误已追加在原处） |
| **本轮 goal：时间线重做（P1 诚实 UI → P2 排期面）** | [`goal-timeline-rework.md`](goal-timeline-rework.md) | ✅ **已完成（P1 + P2，2026-10-02）**。P1：一根共轴、行=任务、条/点/未排期泳道三态降级（零 schema 改动，判据 8 条 + 变异三种）；P2：[ADR-0043](../adr/0043-timeline-p2-task-start-date-duration.md) 的字段 / `setSchedule` / 三态生产者 / 拖拽手势全落地，op 形状判据 + 绕过 dispatch 变异 + 真实拖拽 E2E `RESULT=OK`。证据：R-doc §5.4/§5.5 与 goal §8/§9。调研在 [`../research/timeline-view-deep-dive.md`](../research/timeline-view-deep-dive.md)。P3（打磨）登记进 roadmap |
| **本轮 goal：多端入口覆盖 · P0+P1 补齐** | [`goal-multi-end-coverage.md`](goal-multi-end-coverage.md) | 🔴 **进行中（批一、二、四、五 ✅；批三 C 仍在真实边界续验）**。依据[多端入口覆盖审计](../research/multi-end-entry-coverage-audit.md)实施 3 条 P0 + 2 条 P1。批一：web 侧 due 事后编辑；批二：移动端通知中心 + 邀请活动；批四：移动端账号安全包；批五：移动端备份还原。批三已采用 ADR-0051 的 Android `AlarmManager` / iOS `UNUserNotificationCenter` 原生适配并完成 Android 主链、iOS 模拟器回执与未来提醒取消；跨设备 fired、改期/贪睡/每日重复已通过真实 HTTP/PG 及独立 SQLite 验证，原生 OS 仍待复验；仍待 iOS 权限拒绝/重启、不确定回执界面、真实 64 条窗口和当前产物收尾。完整状态以 goal §4 与 ADR-0051 为准，不能再按历史的“合法停批”描述行动。 |
| **看图看出的六条（勾选框缺半 / 没铺满 / 默认中文 / 时间线没有线 / 排序面板被裁 / 进度卡删）** | [`ui-review-fill-zh-timeline.md`](ui-review-fill-zh-timeline.md) | 🟡 进行中（2026-10-01 立，是上一行的续集）。**每条都要求先调研再动手**：R1 已定位到 `-(44-22)/2` 那行负外边距、且发现"44 触控区"从未实现；R2 已排除 Provider 多一层、收窄到 board 没有 `flex: 1`；R3 查清 `B-mac-*` 是 macOS 取证残留而非 fixture；R5 有实测 bounds（三个档位两个点不到）；**R6 已删**做事视图那张 `0/0` 进度卡（宿主接线整删、共享组件留给移动端成长页；e2e/单测翻成能失败的否定判据 + 注入反向对照），"数字放回滴答三个位置"并进 #10：侧栏两节计数已齐（per-tag 取数补进共享层，三层判据 + 变异），回收站计数判定为**不做**（参照图那列没有这一行），剩下的缺口是**清单归属只在 web 的行上**，见 §6.6。做序 R5→R1→R2→R3→R4 与理由在 §7 |
| **日历年视图 + 时刻输入侧 + 移动端 Profile + 日档英文取证（R13–R16）** | [`calendar-year-time-and-mobile-profile.md`](calendar-year-time-and-mobile-profile.md) | 🔴 **进行中（2026-10-03 立）**。是 [`ui-review-fill-zh-timeline.md`](ui-review-fill-zh-timeline.md) 的**下游工单，不取代它**（日历线的历史裁决仍以那份为准）。四项按"移动端是主战场"排序；每批固定动作：登记现状 → 实现（跨端规则一律进 `packages/*`）→ 判据 → **配变异臂证明能红** → 门禁 → 真浏览器/真机截图且人看图 → 记读数。含三条外部阻塞的台账（四端重装 / 证据目录 `git add` / 移动端"读本地文件"的 document-picker 依赖裁决 —— 最后一条与上面 `goal-multi-end-coverage` 的批五是**同一道门**） |
| **详情面（三栏第四段）与复习面：工单分解** | [`detail-pane-alignment.md`](detail-pane-alignment.md) | 🟡 **规划中（2026-10-03 立）**。**是 [`ui-review-fill-zh-timeline.md`](ui-review-fill-zh-timeline.md) 的下游工单，不取代它**，也不取代主计划。补的是 `dida-view-unification.md` §1.3 四段骨架里**早就写着但从没做的第 ④ 段（详情）**。✅ 成本重估：`TaskActions` 16 个写动作已齐、`startDate`/`durationMinutes` 已在模型 ⇒ **缺的是 web 那一栏 + "选中态"这个概念**。W0–W8 **不依赖任何拍板可直接开工**（W1 选中态 → W2 第四列槽位是硬顺序；W6 计数型习惯那一米必须先于 W8 两张完成量卡），W9 起挂在待拍值上，**W10 复习面不在本篇开工**。含四道前置闸门（两道**余量为 0 的棘轮** + 归属门 + 干净检出复现）、六条**明文"不做"**（emoji 图标 / 空态插画 / 侧栏引导卡 / 不许把番茄塞进列表模型 / 不许把设置搜索改路由 / 不许调高棘轮基线）、以及 §7 的**撞车面现量清单**（四条未合并分支 + 正在被整片重写的日历） |
| **本轮 goal：帮助中心扩成 SSOS 式文档中心** | [`help-center-docs-expansion.md`](help-center-docs-expansion.md) | 🔴 进行中（2026-09-30）。**规格真身**：SSOS 八项结构对照（四项已有、四项缺口）、五个分类的内容配额、§4 正面能力（逐条带代码证据）与 §5 **25 条公开文案负面清单**、截图方式（复用 `scripts/screenshots/`，不新造流水线）＋图号与注入器约定、双语沿用现有 i18n 机制、门禁与共享工作树碰撞面 |
| **用户旅程与注册/登录放哪、每端怎么落** |  [`user-journey-and-auth.md`](user-journey-and-auth.md) | 🔴 **各端认证与旅程的唯一事实源**。含"前置"的定义与**为什么不做硬登录墙**、认证的 8 条真实形状（A1–A8，服务端语义与直觉不同）、逐端实施顺序 W0–W8、判据 J1–J7、以及 §10 **认证 UI 共享化的必做收口** |
| **邮箱 + 密码登录（第 3 条认证方法）** | [`email-password-auth.md`](email-password-auth.md) | 🟡 规划中（2026-10-01 立）。**是上一行的下游工单，不取代它** —— A1–A8 语义、宿主形态、J1–J7 仍以 `user-journey-and-auth.md` 为准。本篇只加"密码"这一条：5 条架构裁决（登录密码与 E2EE 口令**解耦**、Argon2id+pepper、令牌只存哈希、爆破禁用的是"密码认证器"而非账号、`tokenVersion` 全设备撤销）、线协议表、UI/UX 规范（含 **passkey 大按钮降级**）、W0 五个探针、本轮会撞红的 8 处既有断言。需新增 **ADR-0040** |
| **备案前要补哪些协议、文本住在哪、还缺什么** | [`legal-compliance-before-filing.md`](legal-compliance-before-filing.md) | 🔴 进行中（2026-10-01 立）。**一句话结论：工信部 APP 备案一个文本字段都不缺，缺文本卡的是备案之后的两道门**（隐私政策 URL 不是备案表单字段，要求它的是 PIPL + 四部门《认定方法》+ Apple 中国区提审）。九份对外文本的唯一事实源是 `packages/legal`（🔴 不在 i18n 里，理由见其 `src/types.ts`）；四条接线 / 缺口登记 G-01–G-20 在本文件 |
| **桌面 UI 走哪条机制、为什么** | 同上 §3.2 / §3.3 / §4.3 / §10-Q1 | 🔴 **2026-09-28 修订过**：由"原生壳 + 内嵌 WebView"改为 **RN 全端（`react-native-windows` 立即 + `react-native-macos` 等 0.84）**。依据是 [`../research/multi-platform-best-practice.md`](../research/multi-platform-best-practice.md)（补上了仓库此前缺失的联网检索） |
| 阶段总览（P0/P1/P2/P3 与 AI / 激励两条并行轨） | [`roadmap.md`](roadmap.md) | 保留为历史阶段账；**§5「下一步」以主计划为准** |
| 某个具体决策的**理由**（不可变） | [`../adr/`](../adr/README.md) | ADR 只增不改。⚠️ **ADR-0034 需重开**（其论证前提已被证伪，见主计划 §6.4-T4） |
| 某件事的**调研证据** | [`../research/`](../research/) | 证据在调研层，结论在 ADR / 主计划 |

---

## 二、主计划取代了什么（读旧文件前先看这一列）

| 文件 | 行数 | 状态 | 与主计划的关系 |
|---|---|---|---|
| [`multi-platform-adaptation.md`](multi-platform-adaptation.md) | 3,584 | 规划中 | 🟡 **判据仍有效**（M0/M1 已完成的结论、M3 的 A+B1–B7 判据、门禁 G1–G5）；**M2 的桌面路线被主计划 §3.3 修订**。剩余量数字（"8 个特性 / 11,100 行"）**已过期** |
| [`desktop-native-migration.md`](desktop-native-migration.md) | 398 | 规划中 | 🟡 **W0/W1 的实测结论保留**（跨语言通道、Jint/JSC 陷阱、编组开销）；**"UI 形态"被主计划 §4.3 取代** |
| [`phase-2-multi-platform.md`](phase-2-multi-platform.md) | 3,715 | ⚠️ 无有效状态行 | 🔴 **已被上面两份取代**，只作历史。⚠️ 其状态行是解不开的口令噪音，不是计划状态 |
| [`site-and-parity-alignment.md`](site-and-parity-alignment.md) | 1,739 | 规划中 | 🟡 **A 轨（站点）已交付**；**B 轨（能力 gap）按主计划 §5.5 重排** —— 原排序是 Web 优先的，与"Web 不是主战场"矛盾 |
| [`desktop-packaging-handoff.md`](desktop-packaging-handoff.md) | 307 | 已交付 | ✅ 三端安装包已交付且实测"装完能起来"；剩余空白见其 §4 |
| [`multi-end-unified-strategy-handoff.md`](multi-end-unified-strategy-handoff.md) | 257 | 交接 | 🔴 **主计划 ①–⑩ + G0/G4 全部做完并验证**；**唯一没绿的是 iOS 真机验收（34/9）**，根因已钉死（兜底凭据路径的自动化走不通）＋已排除的假设清单。**接手先读它 §5** |
| [`desktop-storage-host-handoff.md`](desktop-storage-host-handoff.md) | 246 | 交接 | 🟢 **A（macOS 定案 = M2）已完成**；**B 的 Windows 端已验到绿**（页侧 `STORAGE=shell` + 从壳外扫到载荷与 `ops` 表 + **重启之后还在**，证据在 `apps/desktop-windows/evidence/storage-host/`）。**默认开关已翻**；**macOS 的 WKWebView 接线也已完成**（真应用走壳 SQLite + 从壳外读到数据）。⚠️ **D 也已完成**；macOS 窗口门禁那条缺陷**已修**（判据改到 WebView 快照上）。**四件事 A/B/C/D 全部交付**；唯一待定的是**产品选择**（壳里主鉴权机制，不在四件事内）。**接手先读它 §6** |
| [`calendar-profile-handoff.md`](calendar-profile-handoff.md) | `wc -l docs/plans/calendar-profile-handoff.md` **现取**（10:0x 读数 1965，其中 09:4x 那格是 1923（07:5x 那格是 1731；本线这一轮又补了一段）；此刻别人也在写那份，所以这格只记取数那一秒；这一列反复漂过，原句还记过"漂了几次"—— 那个次数本身也是手抄件，07:4x 起不记 ⇒ **别引用数字，引用命令**） | 交接 | 🟢 **四项代码侧全部交付**（R13 年视图 / R14 + R14c 时刻输入侧 / R15a + R15b 移动端 Profile / R16 日档英文取证），判据与变异臂逐支读数在原台账。**未闭合的不是产品，是收尾**：入库、四端重装、Android 真机腿、一条刷新崩溃（21:0x **已不可复现但没有"已修复"证据**，唯一现量状态差指向"读的是哪一份 `dist`"⇒ 新增 `scripts/dist-freshness.mjs` 体检与一条重开判据）、收尾六项里 **E/F 已闭合**（E 的**可长期引用形状**是属性而不是段数：`git show HEAD:package.json` 解析出链 **74 段**、`pnpm check:md-tables` 恰好 **1 段**，活树 75 段是别人在飞的那道；`check:gate-wiring` rc=**0**），**H 闭合过又烂了一次、05:3x 修回**（README 记的 md5 与盘上字节对不上 —— 01:34 别人那趟 e2e 重写了同名 png、"今天"从 10/3 变 10/4 ⇒ 人按新字节重看、表与指纹改写，并补了常驻对账 `research/tools/r17-evidence-md5-check.sh`：平态 rc=0 / `--selftest` 四臂 rc=0（裸形状与表格形状各一条注入腿都**恰好报 1 枚**）/ "旧 md5 + 当前 png"自然实验腿 rc=1 报 2 枚。**`--all` 扫全仓 12 份证据 README、9 条 md5（⚠️ 那句 9 是 05:3x 那一格的历史读数；00:3x 复跑同一把 `--all` 是 **12 条 / mismatch 0** —— 本线又给两个目录补了字节钉），又查出 4 条已坏**（R16 那三张 + R15b 暗色那张，全是 01:36 那一趟重写所致）⇒ 四张都按新字节重看、指纹与说明改写；顺带把"四张逐字节相同 ⇒ 确定性渲染"那句改成"三张成立、暗色那张不成立"，并登记一条**取证可靠性缺口**（spec 翻主题后那条 `toBeVisible` 恒不阻塞 ⇒ 那一帧没有落位判据），**仍受阻的只剩 B／C／A 三项**，逐条「在谁手里 + 可复跑命令」写在原台账 §5：B 与 C 抢同一张设备面，05:2x 现量两条都被**另一条会话的 `reinstall-all`（pid 93817，已跑 2h15m）**挡着 ⇒ 本线不起第二趟。🔴 **09:0x 这条登记升级了**：那一趟的持有者查明是**自托管分发线的 item #8**（`/tmp/queue-reinstall-all.sh` 从 `feat/self-host-merge-main` 的 worktree 起跑），而它**不是在跑，是楔住** —— 叶子 `notarytool submit Heyta-1.0.0.dmg` 现量 etime **20786s / CPU 0s**，它自己的日志 mtime 停在 03:12 ⇒ "等它跑完"不成立，改成**要持有者拍板**（本线不杀不接管）。为此新增 `scripts/lib/wedged-runner.sh`（推进/楔住/新鲜/取不到四档，**只打印不进红绿与 `REDS=`**）+ 八臂变异 `research/tools/b-wedge-mutation-arms.sh` rc=**0**。A 等别人暂存里的路径清干净（**09:0x 现量 9 枚**，05:5x 那格是 8 枚；另一码账"待入库"由 `research/tools/calendar-line-commit-plan.sh` 每次现量，05:5x 那格 19 枚）。🔴 **窗口闸门本轮长出了它原来没有的一格**：设备独占探针的正则对 `reinstall-all` **永久失明**（它只认 `verify-mobile-*`），而真撞车就在那一刻发生 ⇒ `reinstall_other_pids()` 抽成 b/c 共用 + 六臂基线相对先验 `research/tools/r14c-gate-b-exclusive-arms.sh` rc=0。🔴 C 那一趟的证据强度也补了一层：链新增**第 0 步点名覆盖**，因为载体 `checkout` 只同步提交、而四层判据写在主检出的**工作树**里（原句「要等 A 落笔」已就地撤回）。🔴 **10:0x 把 B 的可选路数了一条**：那趟楔住的重装跑的就是 `pnpm reinstall:all`，可它装的是**它那一批** —— 新增的只读对账 `research/tools/b-batch-reconcile.sh` 现量 mac/ios/android 三段全 `DIFFER`（windows 那格按设计交棒给 `sync_windows_sources()`）⇒ "等别人那趟跑完再接上"不成立，**B 只能本线自己产一次当前源码的产物**（读数与复跑命令在原台账 §3·补 ㉑）。🔴 **10:1x 三项状态换了，都别读成"本线做完了"**：A 的 36 枚待入库被并行会话 `35dbffe9` 整片提交，`calendar-line-commit-plan.sh` 现量 **rc=0 / 命中 0 枚** ⇒ 数字上闭合，但**本会话从未点名副过**（那条归属纪律没被走过一遍，见交接 §6 第 26 条）；B/C 的 `src` 那格红也是别人清掉的，两把现在都停在 `REDS=load,dev[,apk]`；H 的看守**等满 1800s rc=3、60 次判定零趟 e2e**（负载峰值 215）⇒ flaky 仍"未定性"、(a)/(b) 两支判据一支都没被喂到。另：本线撞见并修掉 `scripts/verify-mobile-ios-reminder.sh` 三处 locale 相关展开缺陷（**不代提交**，移交口径同 notes 那枚），并把 `check:shell-unicode` 的前提收窄成一条实测结论 —— **它在 C locale 下不发作**（§6 第 24 条）。🔴 **10:4x 两项新登记**：① H 的取证长出了**第二种过期** —— 字节没动、md5 全对，但支撑"这两枚图画的是当前交付"的现场动了（`39032107` 10:11 把日历 CSS 与这两枚图一起进 HEAD，其后又有 2 笔动 `apps/web`），⇒ 现在只能主张**"图 == `39032107` 的界面"**，重取仍欠且挂在窗口看守上（§5 n 格 / §6 第 28 条；已回写证据 README 本体）；② 第二笔**不属于本线的门禁红**：`check:docs` 活树 rc=**1**，3 条死链全在**未提交**的 `docs/adr/0051-*`（HEAD 里那 3 条链接 0 命中 ⇒ 干净检出仍绿），持有者＝提醒线，本线不代改、不放宽（§5 o 格）。🔴 **11:0x 两笔**：F 的第二条边界落成现量脚本 `research/tools/f-boundary-scope-count.sh`（三臂 selftest rc=0；现量 `处=235 行=234 文件=16 去重键=222 对照=130`，与 03:0x 逐字相同 ⇒ 8 小时未动，**仍不是常驻门禁**）；A 的"索引必须为空"闸门**第一次在真实并行下报红**（别人把 3 枚 `apps/landing/evidence/*.png` 暂存了进来 ⇒ rc=1，本工具不动别人的索引，§5 v 格）。另：`h-flaky-window-watcher.sh` 新增 `--scan`（只扫现成 trace、不开跑），selftest 六臂→**八臂 rc=0**，并修掉两处"扫描自己瞎了却报 `0`"（相对路径子 shell / 本仓绝对路径含空格被拆词）—— 借来的那趟红扫出来是 `connect=6 hotUpdated=0`，所以 **(a) 仍未喂到**，也**不能**写"这台机上红=洪泛"（§5 q/t 格）。🔴 **11:1x–11:2x 三笔**：① 把 traps #110/#113 的自快照机制装到 H 的看守上，**当场炸出这条机制自己的一个坑** —— #113 那套的隐含前提是"脚本不会自己调自己"，而 `--selftest` 的 17 个子臂恰好违反它（无条件 `trap 'rm -f -- "$0"' EXIT` 让子快照退出时删掉父亲正在用的那份 ⇒ selftest 从 rc=0 变 **rc=4 / 17 条臂红 / 子进程 127**，而 `bash -n` 全绿）。改成**清理只归创建者**（快照名尾巴 = 创建者 PID）后 selftest **rc=0（八臂）**、`check:script-snapshot` rc=0、快照残留 0 枚；教训是**引入别人的机制时，它的隐含前提要当成断言来测**（§5 x 格）。⚠️ 这条**待入 traps #113 的补充**、此刻不落台账本体：现量那本台账 **103 增 / 7 删未提交**（索引 0 枚），往里插行会把别人的 WIP 吸进本线这一笔；取号按工作树（编号行 241 / 最大号 232，两数不等=历史重复号）。② C 的闸门 11:2x 复跑 rc=3、`REDS=load,src,dev,apk`，两格旧读数翻了（凭据三件套现量**都在**、模拟器**在线**），`dev` 多一枚 pid 41138，93817/98934 那对仍楔住（etime 28989s / CPU **0s** ⇒ 要持有者拍板，本线不杀不接管）；`src` 那格量化了一次 —— 那条判据是**逐树 M 行**不是**逐消费者源码行**，现量 21 枚里落在 `/evidence/` 的只有 2 枚、其余 19 枚中图片/文档 **0 枚**，**不改闸门**（它不是-binding，且 Windows 的 `git ls-files` 通道确实会把 evidence png 送进打包集合）。③ 本批**刻意不给 C 挂 `r14c-window-retry.sh`**：它开窗即起 `@heyta/ui build` + `build:android`（66 MB APK、数分钟满载），会把 H 等的负载门顶回去 —— 两把抢同一个窗，而 C 的 blocker 是人拍板不是排队，**排队只产生竞争不产生进度**（§5 第 4 条末）。🔴 **11:3x 三笔**：① **§5 第 1 条那条前置从"文档里的祈使句"搬进了看守本体** —— `h-flaky-window-watcher.sh` 每趟开跑前自己打一行 `RUN_<i>_DISTFRESH pkgs=… behind=… missing=…`（范围从 `apps/web/package.json` 现取、不手抄；体检是**记录**不是门禁，因为那把工具自己的文件头就声明"落后在并行改源码时是正常状态"）；现量 13 包 / 落后 1（`app-host` 差 **1 秒**，别人正在写它）/ 缺产物 0。判据两腿：臂1 只钉**形状**不钉值（钉值就是把上游现场写进判据），臂4 用现成的最小树夹具当**负向**（那里没有 `apps/web/package.json` ⇒ 必须自报 `check=unavailable`）；变异读数 **rc=4、红集恰好 1 条**。一般规律（交接 §6 第 32 条）：**一条从没被执行过的前置，输出上和被执行过的逐字相同** —— 文档里每句"开跑前先…"都要问"机器执行过它，还是只被我引用过？"。② 窗口闸门 `src` 那格的红**有多少只是别人的取证图，会整片翻**：11:2x 现量 21 枚里 evidence 2 枚，11:3x 复算 38 枚里 evidence **21** 枚（同一时刻负载 15→109，⚠️ 不写成因果、只记未定性）⇒ "evidence 差集很小"不是性质；**不改判据**的两条真理由是"非-binding"+"正确修法是按 target 分范围（C 的 APK 不装 `apps/web/evidence/**`，B 的 mac/win 载荷确实会带走它们）"，这条已登记成下一批边界，成本现量 = 消费 `REDS=` 的 5 枚文件 / 14 行。③ 本线自己犯了一次**反向的边界事故**：`new_string` 多写一根 `|` 把表格一句话劈成第 5 列（工具不报、渲染只是"多一栏"）；顺带用一次性变异回答"列数门禁能不能失败"⇒ **rc=1**、报的正是 `calendar-profile-handoff.md:485 列数 5（本表表头是 4）`，且共享工作树上这类变异带**回读防自伤阀**（还原前先回读，窗口内有人写过就不覆盖）—— 见交接 §6 第 33 条。🔴 **12:1x 证据锚点规则改写**（交接 §5 bb) 格 + §6 第 34 条）：常驻 md5 **只钉给「同一笔代码下两趟字节相同」的图**（本轮逐像素实测：`view-tabs-year.png`/`day-en-empty.png` 重跑后逐字节相同 ⇒ 有资格；`view-select-closed.png` 差 4982 枚、`day-en-full.png` 差 468 枚且全在随机任务名那一行 ⇒ 每跑必红，降级为记录值），形状主张改钉 **`UIPIN <文件> <提交> <决定形状的路径…>`** 代码锚点（重跑不红、界面代码动了才红）；`r17-evidence-md5-check.sh --selftest` 八臂全跑合成夹具 rc=**0**，`--all` 现量 rc=**1**（五枚 `UISTALE` = 日档那批的重拍欠账，是队列不是事故）。🔴 §0.5 是**本轮 goal 的完整验收范畴**（四项 + 八步固定动作 + 十条硬约束），新开批次照样受它管；接手先读 §5 那条有序清单 |
| [`calendar-profile-reflection.md`](calendar-profile-reflection.md) | 45 | 复盘 | 🔴 **本轮 9 次判断失败**：把「唯一判定在共享层」读成「每个宿主都用了它」（于是移动端没接时刻却收口了）、坏 lsof 探针造成三小时白等并**伪造出一段历史**、把共享索引的瞬时读数写成长期状态句、往表格行尾追加文本连着三次同一种坏法、拿词条表的值当变异臂（恒不红）、复刻旅程时简化了桩的响应形状（差一点把探针的红写成产品结论）、在自己探针里 `reload` 的下一行就取状态（React 还没渲染 ⇒ **假绿**）、把链式命令的 `$?` 记到没跑的那条门禁头上（**假红**）。后四条共同点：**读数是探针/命令产生的，我把它读成产品的** |
| [`multi-end-unified-strategy-reflection.md`](multi-end-unified-strategy-reflection.md) | 49 | 复盘 | 🔴 **判断为何失效**：本轮 6 处「判据看起来在工作、其实什么都没判」（其中 4 处是我在修前一处时写出来的）+ 两次「查错对象」得出**反向结论** |
| [`waytofuture-handoff.md`](waytofuture-handoff.md) | 286 | 已交付 | ✅ **产品第一次跑在自己的域名上**（`heyta.waytofuture.cn` + API 专用 `apiheyta.waytofuture.cn`）；管理后台/邮件/凭据页全部中文化并用设计系统。**交还用户 3 件**（ICP 提交、两处预存在的红）见其 §3 |
| [`waytofuture-reflection.md`](waytofuture-reflection.md) | 120 | 复盘 | 🔴 **本轮 4 次判断失败**：打包覆盖生产 `.env`、脚本放 `<head>` 致按钮无反应（用户报障）、脱敏正则漏匹配、发明的阈值两次误报。四者共同点：**验的是"我产出的中间物"，不是"用户走的那条路径"** |
| [`gate-blindspot-handoff.md`](gate-blindspot-handoff.md) | 224 | 交接 | 🟢 **已闭合**（本轮四项交付全部处理完）。`check:docs` 的"CI 上永远红"死角有 **5 条端到端注入证据**（§3），门禁代码已提交推送。**本文件转成历史**：它原先写着"注入验证与提交留给下一会话"，而那句已经过期（§开头有更正说明）；§7 还更正了本文件自己的一条**归档归属错误**（"非空白/主蓝"那条一直只在 `AGENTS.md` 里、从没进过 traps 文件），由此牵出的 **§7 编号歧义死角**已登记在 [`BLOCKED.md`](../../BLOCKED.md) §5 等裁决。只剩两件**要用户本人**的环境动作（屏幕录制权限、Windows 打包机），见它 §4 |
| [`multi-platform-widgets.md`](multi-platform-widgets.md) | 373 | 规划中 | 🟢 **仍是小组件线的入口**（与主计划正交） |
| [`multi-platform-widgets-progress.md`](multi-platform-widgets-progress.md) | 5,463 | 实施中 | 🟢 **是进度日志，不是计划**。体量最大，按需查、不要通读 |

---

## 三、已完成 —— 只作历史，**不要照它再开工**

| 文件 | 完成依据 |
|---|---|
| [`phase-1-single-client-loop.md`](phase-1-single-client-loop.md) | `pnpm verify:p1` 11 条零 mock E2E 通过 |
| [`activity-categories-and-colors.md`](activity-categories-and-colors.md) | 已并入 `main`（`84cc7f5` / `38cf3a5`） |
| [`motivation-and-progression.md`](motivation-and-progression.md) | L1/L2/L3 三层已实现并并入 `main` |
| [`ai-remediation-module-1-engine.md`](ai-remediation-module-1-engine.md) | ✅ 已执行（文件自己写着"不要再照这份任务书做一遍"） |
| [`ai-remediation-module-2-journey.md`](ai-remediation-module-2-journey.md) | 已并入 `main`（`0614475`） |
| [`ai-remediation-module-3-memory-moat.md`](ai-remediation-module-3-memory-moat.md) | 已并入 `main`（`73b13b2`） |
| [`ai-gap-audit-and-remediation.md`](ai-gap-audit-and-remediation.md) | 三个整改模块均已并入 `main` |
| [`ai-open-decisions.md`](ai-open-decisions.md) | 已决策 |
| [`ai-tool-calling.md`](ai-tool-calling.md) | 🟢 P0–P2 已落地（P3–P4 未开工，见该文件） |
| [`ai-remediation-parallel-runbook.md`](ai-remediation-parallel-runbook.md) | 已落地（`scripts/check-module-boundaries.mjs` 是它的可执行版本） |

---

## 四、AI 线（活跃）

| 文件 | 说明 |
|---|---|
| [`ai-strategy.md`](ai-strategy.md) | 策略入口（被引用最多的一份，13 处）。🔴 **§8 那张"下一步"表已过期**：第 3、4 行（捕获解析、拆解）在 §7.1 里自己标了已完成，只有第 5 行"agent 多步自主 / Pi / 仅桌面"仍有效 |
| [`ai-assistant-closure.md`](ai-assistant-closure.md) | **W1–W4、W7–W9、W12 已落地**（2026-10-03）：AI 能力面补齐的**执行工单**（W1–W14，缺口编号 `AI-G*`）。🔴 它是 `ai-strategy.md` §8 信任阶梯的拆解，**不是第二份策略** —— 冲突时以 `ai-strategy.md` 为准。⚠️ 原文那句"W8+ 挂在三处待决（D-1 / D-1a / D-2）"**已过期**：三处都由产品负责人 2026-10-02–03 拍板（聊天外壳与"末尾一次写提案"放行、授权粒度改成助手侧独立档位、`EVENT` 与 AI 工具同批），逐条状态与**还剩什么**（W5 / W10 / W11 + 四条登记缺口）在它的 §7 与 §7.2。证据在 [`dida-ai-assistant-gap-analysis.md`](../research/dida-ai-assistant-gap-analysis.md) |
| [`ai-event-tool-contract.md`](ai-event-tool-contract.md) | **EVENT 契约已定死 + 覆盖面门禁已落地**（2026-10-03）：倒数日 `EVENT` 的 **AI 工具契约**（D-3 拍板"实体与工具同批"的落点）。定死读 2 / 写 4 个工具、每工具的 `egressFields`、三项刻意不进 AI 的字段及理由、农历的分工（模型不许换算），以及**覆盖面分母的准入判据**（"有用户能**填**或能**按**的编辑面"）。口径两处纠正：`covered` 从"有任一工具"改成"**读写都有**"；`FOCUS_SESSION` 一度被移出分母，**当天被自己那条判据否证并撤回**（开始/中止是用户按的）。现量（10-04）：目录 **26** 个工具（读 12 / 写 14）、覆盖面 **9/9**，缺口台账 `ENTITY_COVERAGE_DEBT` **为空**（⚠️ 同一行今天先后记过 "6 / 2/8" 与 "9 / 3/8"，错法不同：前者是口径错、后者是抄件过期 —— 所以现量请跑 `node scripts/gen-ai-capability-manifest.mjs --check`，别抄这里的数）。门禁在 `scripts/check-ai-coverage.mjs` §9（覆盖面）+ §10（容量），挂在既有 `check:ai-coverage` ⇒ 已在 `pnpm check` 里）；**能失败**已由四次注入（§5.3）+ 六条行为变异（§8，含一条未变异的正向对照）证过。✅ §5.2 那条当初记成"要产品拍的算术冲突"（`local-api.spec.ts:87` 的 `<= 10` vs 每实体一读一写）**同日已解除，且不需要拍板** —— 那条上限的单位写错了，现在按实体判 `MAX_TOOLS_PER_ENTITY = 5`。🔴 覆盖面跑满之后新暴露的一格是**每实体内的动作**：界面有、AI 没有的那些，逐条登记在 §5.4。🔴 编号消歧：本文称覆盖面门禁为 `AI-COV`，因为闭环计划与倒数日计划**各有一个 W10 且是同一件事** |
| [`ai-capability-branches.md`](ai-capability-branches.md) | 能力分支与开发分支策略 |
| [`ai-memory-system.md`](ai-memory-system.md) | 记忆系统 |
| [`ai-tier-pricing-rollout.md`](ai-tier-pricing-rollout.md) | 分档与定价 |
| [`ai-handoff.md`](ai-handoff.md) | 交接（⚠️ 无状态行） |

> 🔴 **两份 AI 审计回答的是两个不同问题，别混**：
> [`ai-feature-completeness-audit.md`](../research/ai-feature-completeness-audit.md)（2026-09-30）问的是
> "**已声明的 AI 功能做完了吗**"（答：本地模式代码层完整）；
> [`dida-ai-assistant-gap-analysis.md`](../research/dida-ai-assistant-gap-analysis.md)（2026-10-02）问的是
> "**用户能使唤 AI 干活吗、和滴答助手差在哪**"（答：今天连不上，且多步被架构锁死）。
> 后者对前者追加了 §8 勘误 —— 包括一条会**把工作量估错方向**的误判（那 3 个需要 `entityId` 的工具
> **已经写好了**，缺的是让它们可达的多步循环，不是再写一遍）。

---

## 五、订阅 / 计费（一簇，**状态只有一处**）

| 文件 | 说明 |
|---|---|
| [`subscription-boundary.md`](subscription-boundary.md) | 产品决定（PM 定稿，待实施） |
| [`subscription-provider-selection.md`](subscription-provider-selection.md) | 选型结论 |
| [`subscription-integration.md`](subscription-integration.md) | 只读调研结论 |
| [`pricing-coupons-handoff.md`](pricing-coupons-handoff.md) | 定价与优惠券 |
| [`subscription-handoff.md`](subscription-handoff.md) / [`subscription-wechat-handoff.md`](subscription-wechat-handoff.md) | 交接 |
| [`notification-and-activity.md`](notification-and-activity.md) | ✅ **已完成**（2026-09-29）：通知中心 + 活动（邀请好友得会员）。🔴 它同时把权益判定从"最新一行"改成"多个来源取并集" —— 那条是邀请奖励能安全上线的前提（否则奖励行会盖掉用户已付的时长，且不报错） |
| [`admin-console.md`](admin-console.md) | ✅ **已完成（首版）**（2026-09-30）：运营管理后台。**抄 SSOS 的模式、不抄它的页面** —— 它那 42 个页面服务的是租户/税务/合规/Mailu，heyta 一个对应模型都没有。范围＝用户/订阅/订单/优惠码/邀请 + 三个不碰钱的支持动作；权限＝单级 `users.is_admin`（默认 false，只能由 CLI 授权）。决策见 [ADR-0038](../adr/0038-admin-console-scope.md) |

> 🔴 **微信支付已按用户指示搁置**（卡点在商户号 KYC，是**外部**流程，不是代码）。
> 状态登记在 [`roadmap.md`](roadmap.md) §5 那一节，**不要在别处再开一份待办**。

---

## 六、其他

| 文件 | 状态 |
|---|---|
| [`i18n-multilingual.md`](i18n-multilingual.md) | 进行中 |
| [`countdown-anniversary.md`](countdown-anniversary.md) | ⚠️ **本行原来把同一个文件的状态又登记了一遍**（"规划中 → 可开工" + 两道前置闸门），而其中"bundle 体积实测"那道闸门已于 2026-10-03 闭合、批次一已落地 ⇒ 这句成了假话。按"改一处必 sweep 全仓"的规矩，两处登记只留一份：**进度看上面那张表的同名行，落地记录看该文 §3.5**。（保留这行是为了让人看见"状态写两遍"是怎么漂的。） |

---

## 七、本目录的纪律（新增文件前先读）

1. **不要新建"同一件事的第二份计划"。** 先在本文件里找，找不到再看 `roadmap.md`，仍找不到才新建 —— 并在本文件登记。
2. **状态行是硬要求**（`docs/README.md` §三）。⚠️ **已有 7 份缺状态行或状态行是噪音**（见上表"无状态行"标注）—— 这是遗留债，修的时候顺手清掉。
3. **不写相对时间**（"最后提交 09-27"这类会立刻腐烂；`desktop-native-migration.md` §10.3 自己已写明这一点）。
4. **不引用行号** 作为定位手段 —— 实测：一次编辑就能让全部行号偏移。引用**小节标题**。
5. 新增/移动文件后跑 `node research/tools/docs-link-check.mjs`。
   ⚠️ **物理归档前必须知道**：本目录原有的 30 份文件中 **零引用的有 0 份**，25 份被 ≥3 个文件引用 —— 移动会打断约 150 处跨文档引用。**所以本文件选择"单一入口 + 权威标注"而不是批量移动文件。**

---

*本索引不记录进度数字 —— 那些会腐烂。进度只有一个来源：[`multi-end-unified-strategy.md`](multi-end-unified-strategy.md) 与 [`roadmap.md`](roadmap.md)。*
