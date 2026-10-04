# 交接：倒数纪念日 批次二 —— 哪些真闭合了、三条并行线怎么收、合流时有两条义务必须兑现

> 状态：**批次二 10 张工单里 6 张闭合**（W0 / W0b①② / W2 / W5 / W9 web 半 / W10 / L'）。
> 🔴 **22:0x 增量（本段全部做完并验证过，接手者不必重做）**：W4b 服务端半那 4 笔**已挑进**
> `feat/countdown-batch2`（合流义务 §3.2 的 ADR 指针**已逐处核完**，现量是 12 处不是 1 处）；
> 三条并行线合进来的内容**第一次跑了验证** —— `pnpm -r build` rc=0、`pnpm -r typecheck` 从 2 枚红修到 rc=0、
> shared-schema / domain / ui / mobile / local-api / ai / app-host / **服务端全套**都跑过（读数见 §2.2）；
> `check:public-facts` **已立并接进 `pnpm check`**（八臂 8 红 0 存活），`CalendarBoard` 的 `dayMarker` 缝**已开**
> （ADR-0052 §2.6 要的那条默认值等于原值的可选 prop）。
> 🔴 **23:0x 增量**：W4b **客户端拉取那半已落地**（3 笔：storage 的 META 通用读写 / app-host 的
> `public-facts.ts` / web 接线 + i18n 中英），**判据①第一次有了真界面载体**（e2e 三档、3 passed、
> 三张图人已看）；25 臂变异逐臂报红。⇒ W4b 只剩一条：**papers 的后台界面回显**目前只到 API 层。
> 🔴 **仍未做**：
> W7 设备出图那半、W8 原生壳那半与壳级门禁、W9 原生投递（另一条会话）；W6 停放（23:0x 复量仍 14 脏，
> 且撞车面**新增 4 个未跟踪文件** —— 日/年视图与拖拽，见 §5）；
> **收尾四项（§8.3）除第 1 条的两半之外没启动**。
> 🔴 **所有成果都在本地分支，没有 push、没有 merge 进 `main`**。
> 交接日期：**2026-10-03**（CST）
> 给**全新会话**用：不从聊天记录继承任何前提。每条断言都带可复现命令或实测读数。
>
> 🔴 本文只记**当前停在哪**。决策与理由不重复 —— 权威在
> [`countdown-anniversary.md`](countdown-anniversary.md)（工单定义 §3、批次二逐项范围/落点/判据 §8.2、进度总表 §8.4、收尾清单 §8.3）、
> [`../adr/0052-public-facts-are-deployer-supplied.md`](../adr/0052-public-facts-are-deployer-supplied.md)（W4b 那条通道定性）、
> [`../adr/0038-admin-console-scope.md`](../adr/0038-admin-console-scope.md) §5（后台范围的勘误）、
> `AGENTS.md` §9（摘要表）。**本文不替代那些**，只记"接手要用的状态 + 下一步命令"。
>
> ### 🔴 接手先读这五节（其余按需）
> | 要做什么 | 读哪节 |
> |---|---|
> | **知道 Goal 要求做完的全部范畴**（离开聊天也能接着跑） | §0.5 —— 🔴 它是任务书原文，逐项标了当前状态 |
> | **收三条并行线**（W7/W8/W4b → batch2） | §2 —— ✅ **22:0x 已全部收完**；验证读数在 **§2.2**（新） |
> | **合流时的两条硬义务**（法务六位置翻转 / ADR 编号指针） | §3 —— 🔴 这两条**没有门禁兜底**，漏了就变成对外说假话 |
> | **接着写 W4b 剩余半** | §4（有现成形状，附 file:line 与实测的"不要另建一套"的读数） |
> | **跑收尾** | §6（四条，含 `check:docs` 那 33 处红的正确处置） |

---

## 0. 一句话现状

> 🔴 **本节 2026-10-04 03:1x 重写。下面那段"卡点在合流"已经被现量否证，原句留在引用块里划掉，
> 因为它记录的是一种会复现的形状：**"别人什么时候把它合掉的"不在我的读数里，所以"还没合流"这句话的保质期不由我决定。**

> ~~批次二的**代码半基本落地**，卡点不在代码而在**合流**：三条并行线（W7/W8/W4b）的成果还躺在各自
> worktree 的未提交改动里，而 `feat/countdown-batch2` 落后 `main` **24 笔**。~~

**现在的状态**：合流**已经发生**，而且不是我做的。现量（每次引用本条都要重跑，别信这段文字）：

```bash
git log --oneline origin/main..HEAD          # 2026-10-04 03:1x 读数：只剩 e2def90f（W6 那一笔）
git rev-list --count HEAD..origin/main       # 同刻读数：228 —— main 在吸收批次二之后又前进了 228 笔
```

⇒ 三条线（W7 `43e94b32`、W8 `f2d09974`、W4b 那六笔）**都已经是 `origin/main` 的祖先**，
`heyta-wt-w7` / `heyta-wt-w8` 那些 worktree 里的"未提交成果"这个描述整体过期了。
本批剩下的不是"合流"，而是**把 W6 那一笔之外的收尾做完**：判据②的真浏览器读数、W7 的变异臂、
完整 `pnpm check`、四端重装。

🔴 **这条变化改变一件事的判断口径**：凡"本批带来的后果"现在**同时是 main 的后果**，
所以"等合流之后再管"这个念头不再成立。两个当场撞见的例子，**归属不一样**（第二个不是我们的债）：
① `apps/web/src/main.tsx:152 startPublicFacts()` 让**每个** e2e 套件一开机都发一次
  `GET /api/holiday-adjustments`，而假服务端只实现 `/v1/chat/completions` ⇒ 带
  「除已登记缺失外不该有非 2xx」守卫的套件被无关地拖红（`admin-console.spec.ts` 实测一次红五条，
  修法见 `e2e/tests/helpers.ts` 新增的 `stubPublicFacts`，与 `stubLegalRecheck` 同形同因）；
② W9 那半在 main 上声明了 `POST_NOTIFICATIONS` + `SCHEDULE_EXACT_ALARM`，而 `permissions.ts` /
  `third-parties.ts` 那六句"移动端不申请通知权限"没跟着翻、那条闹钟权限也没登记
  ⇒ **`node scripts/check-legal-permissions.mjs` 在干净 main 上就 rc=1，且是 7 条红而不是 2 条**。
  04 03:5x 用门禁自己的 `HEYTA_CHECK_ROOT` 旋钮把七份输入换成**只含 `origin/main` 已提交内容**的一份，
  ⇒ **rc=1 / 7 条红**，与喂 `HEAD` 那次末行逐字相同 —— 所以这句"干净 main 上就红"从推断升级成了实测
  （命令与探针踩坑见 `countdown-anniversary.md` §8.2 L' 第 1b 条；本批不代它翻那六句）。

本轮新增了一条**常驻门禁**：`pnpm check:legal-permissions`（`1d71e75f` + 加固 `017adc3e`，在 batch2 分支），
它把"移动端不申请任何权限"这类**对外承诺**与 manifest / Info.plist / entitlements 的**真实声明面**对账。
13 臂变异全红、0 臂未证。

---

## 0.5 当前 Goal 的完整范畴（任务书原文照录 + 逐项状态）

> Goal `1791011766720-0444bf`，**turn 预算 100**（20:5x 现量：`Progress: 1/100 turns used` —— 每轮注入的
> 计数会被上下文压缩重置，别把它当"只用了 1 轮"的事实来推断；预算用尽时 Goal 自动暂停，**只有用户能
> `/goal resume`**）。目标**尚未完成 ⇒ 不要调用 `update_goal complete`**。

**任务书原文（范畴定义，逐字）**：

> 先对代码现状做一次深度调研，然后在调研结论之上把「倒数纪念日」**批次二全部工单实现完成**（不是只做计划），
> 每完成一项就按计划文档打勾并同步 AGENTS §9。

🔴 **"全部工单实现完成"的判据是"每一项都落到当前产物并通过各自判据"，不是"每一项都动过代码"。**
按这个口径逐项对账：

| # | Goal 要求的范畴（原文，不缩减） | 现在到哪一步 | 还差什么 |
|---|---|---|---|
| W0 | 批次一遗留的登记缺口收掉（`/tmp/ui.xml` 固定名 36 处、`verify-mobile-repeat.sh:243` 硬印库名、**待入台账的两条正文搬运**） | 🟡 **①② done**（`6598703b`，harness 22 绿 0 红） | ③ **台账搬运没做**：`environment-traps.md` 正脏 ⇒ 正文停在计划 §3.5（`:675` 起），任务 #14 |
| W2 | 新实体 `EVENT` 落 `shared-schema` + `domain` + `op-log` reducer + 存储三套适配 + 线协议契约；🔴 部署顺序硬约束"服务端先于客户端"；ADR-0044 已定"闰月生日逢闰过正" | ✅ 已闭合（`bb6c1203` + `05794dc5`），**且服务端那一腿本轮补上了**（`30340fa2`：`EVENT` 认领进 `validation.service.spec.ts` 的手写实体清单） | 无。**但"服务端先于客户端"是部署期义务，`reinstall:all` 那一步要按它排序** |
| W5 | 倒数日卡片网格 + 二级操作（界面） | ✅ 已闭合（`a9529a59` + `94760c82` + `c07df677`），e2e 6 passed、三张图人已看 | 无 |
| W6 | 第二个日期数据源 | ✅ **已闭合**（`e2def90f` @ `feat/countdown-batch2`，2026-10-04 02:5x） | 无。⚠️ 原句"等六个日历路径归零后落地"的载体已经不存在了 —— 那六个路径的未提交 diff 随 main 的推进被各自所有者提交掉，`608fa5b1` 把合并基搬到 batch2 上，落地前重跑了一次关闭判据（`git status --porcelain -- packages/ui/src/calendar apps/web/src/features/calendar apps/mobile/src/screens/CalendarScreen.tsx` 输出为空）。**留了一条编号缺口 W6-G1**：接进「今天」/收集箱要先给共享 `TaskList` 一条"不可交互行"的契约变更（把 EVENT 塞进任务行要么伪造 `completedAt`、违反 §3.4 一个意图一个 op，要么凭空造第三种行形），不属于这一批。**04 06:1x 另关一条本批自己照出来的红（R-1）**：W6 那颗「休/班」把侧栏格子撑高，而格子带 `aspect-ratio: 1` ⇒ **高度绕到宽度**、`repeat(7, 1fr)` 的自动最小允许轨道被撑开 ⇒ 行网格 `37.5px×7=263px` 而容器 189px，**整张迷你月历溢出侧栏一列**、七列与列头逐列错位（实测 −5.25…−68.25px，`e2e/tests/calendar-sidebar.spec.ts:111` 在安静窗口确定性红）。修法三处（`minmax(0, 1fr)` / 删 `aspect-ratio` / 那颗点与状态点**同行**并给槽位 `min-block-size`），修后同一判据 **`RC_E2E_SIDEBAR=0`、`2 passed`**，两张图人已看。取证与"我那条算术否证否错了对象"写在计划 §W6 节 R-1 段 |
| W7 | 纪念卡片导出为**成品图**（设备渲染导出，**零通道、零法务变更**；区别于素材图） | 🟡 **web 半 + Android 设备出图都到最终态**（04 07:41 `RC=0`，成品图入库且人看过），**iOS 那一半未取设备读数、且本轮量出它的原生模块从未编过译**（~~移动端"代码 + 判据在、真机那一趟没跑"~~）（~~✅ 三端都到最终态~~ —— 04 04:3x 改判：那句把"原生模块已写好"读成了"设备上画出来了"，而 Goal 的范畴②要的正是后者）。共享版面 `packages/ui/src/countdown/card-export-layout.ts` + web `<canvas>` 出图 + 移动原生落盘（Android `cacheDir` + `FileProvider`、iOS 写沙盒，两端**都不走相册**）+ 门禁 `check:card-export`。**04 03:1x 现量**：`apps/mobile/tests/card-export.spec.ts` **21 passed**（`MOBILE_RC=0`）、`e2e/tests/countdown-export.spec.ts` **5 passed**（`EXPORT_E2E_RC=0`）、成品图与四张界面图**人已看**且**已进版本库**（`apps/web/evidence/countdown-export/`，含每张"看见了什么"+ 两件事：竖条是 `surface-sunken` 不是主蓝＝夹具没选模板，这是设计；「还有 28 天」与「11月1日」互相自洽＝只有看图才会做的交叉验证） | 🔴 **两臂变异 04 04:2x–04:3x 跑完**（`RC_A1=1` 红 `:268`+`:312`＝同一把尺子的两处使用；`RC_A3=1` 红 `:360`；还原后 `RC_RESTORE_EXPORT=0` / 5 passed），装置已从 `/tmp` 落进版本库 `research/tools/mutate-w7-card-export-arms.mjs`。**剩下的一条**：真机出图读数 —— 装置 `pnpm verify:mobile-card-export`（含探针自检两腿：现成图必须等于契约、3×2 对照必须不等）已落库，排在收尾第 4 项那一趟里。⚠️ 另记一条**因 A1 而失效的旧读数**：`check:card-export` 的 `rc=0` 是 03:1x 量的，而那一臂把 `packages/ui` 的 dist 打过又还原重打过 ⇒ 收尾那趟必须重取。**04 05:1x 已重取：`RC_CARD_EXPORT=0`**（同一趟里 66 段 sweep 也是 0）。🔴 **再登记一条编号缺口 W7-G3**：那台装置是 **adb-only**（`grep -icE "ios\|simctl\|swift"` 在 305 行里命中 **0**）⇒ "设备出图"目前只有 **Android 那一半会有读数**，iOS 那一半停在代码 + node 单测。正文（含"iOS 的读数通道其实更便宜：`simctl get_app_container data`/`tmp/card-export/` 是宿主机直接可读的目录，不需要 `adb root`，缺的只是 UI 驱动"）在 `countdown-anniversary.md` 的 W7 节。<br>🔴 **04 07:2x–07:4x 两条现量改判**：① **W7-G3 的"闭合代价"那句被我自己的现量否证**（登记成债之前先量贵不量贵）—— `ax()` 只是 `verify-mobile-ios.sh:172` 的 3 行包装、真身是仓内文件 `scripts/tools/ios-ax-shim.py`（959 行、CLI 现成），`resolve_idb()` **就在共享 lib** `scripts/lib/mobile-e2e.sh:970`，本地只剩 `press_until`(48 行)/`dismiss_overlays`(32 行) 两个小助手；读数通道三台模拟器 `get_app_container` 全 rc=0 且宿主机可直接 `ls` ⇒ 已转任务 #21。② 🔴 **iOS 原生模块从来没编过译**：第一次真跑 `reinstall-all --only ios` ⇒ `BUILD FAILED`，22 条 error 全在 `HeytaCardExportModule.swift`（`cannot find type 'RCTPromiseResolveBlock'`，缺 `import React`；兄弟模块都有那行）。已修 `7c63411b`，**但"修完能不能建"仍未验**。⇒ 台账里"W7 iOS 侧代码链闭合"这句当时就不成立，正确说法是"代码写完、注册进 target 了、**没编过**"：`check:card-export` 数的是 pbxproj 里有没有那两个文件，TS 单测量的是 JS 折算，**没有一层跑过 Swift 编译器**（§6.1.1"门禁绿 ≠ 能打包"第四次现形）。<br>✅ **Android 那一半的设备读数已到手**（04 07:41，载体 `7c63411b`，`pnpm verify:mobile-card-export` **`RC=0`**）：判据①两腿（正向 `1080×1440` / 反向 `3×2 BLANK=true` ⇒ 读数器会区分）、判据②（点前缓存空 ⇒ 点后出现 `heyta-w7e2e-073853-10月11日 星期日.png`）、判据③（**设备那串字节 `W=1080 H=1440 BYTES=36493 TRANSPARENT=false BLANK=false SMEARED=false`，逐字等于 `shared-schema` 产物里的契约那两个数** ⇒ 关闭 **W7-G1/G2**）、第 6 步零授权弹窗（前台仍是 `com.heyta`，与"不申请照片"那句条款同向）。成品图**已入库** `apps/mobile/evidence/card-export/latest-card.png` + 同目录 `README.md`（**人打开看过**：竖条是 `surface-sunken` 不是主蓝＝没选模板，这是设计；「还有 7 天」与「10月11日 星期日」与当天 10-04 三者互相自洽）。中途卡了两趟都红在**探针**：新鲜度门读不出 dumpsys 的日期形状（`644130c7`，并量了负向臂），底栏目标被 `*-sane` 的 `cy<2100` 守卫结构性地滤空（`80f7be46`，同一份 dump 三种取法同时量）。 🔴 **04 10:0x 现量（链 P，载体 `198603f5`）：iOS 探针第一次走到产品判据并判红，根因既不是探针也不是 react-native-svg，而是我们自己那条桥交给 JS 的名字** —— `RCT_EXTERN_MODULE(a, b)` 展开成 `RCT_EXTERN_REMAP_MODULE(, a, b)`，JS 名那格是**空的**，于是 `NativeModules.HeytaCardExport` 为 `undefined`（Swift 自己那个 `moduleName()` 被分类方法盖掉）。三层只读取证 + 一次**只换 bundle、不重打 app**的实验把它与"RNSVG 不回调"分开：在 hook 挂载处直接调 `writeCardPng` 也不落盘，而同趟界面标题的临时对照真的出现在 AX 树上。已改 `RCT_EXTERN_REMAP_MODULE(HeytaCardExport, HeytaCardExportModule, NSObject)`；同时修掉那条**标题写"模块名三处逐字相同"、body 却比 `.m` 第一个参数 == ObjC 类名**（坏形状恰好满足）的判据 —— 三臂变异各红一次（退回裸宏 / REMAP 两参互换 / JS 名错一位），复原 21 绿。同族两座桥（`HeytaWidget` / `HeytaReminder`）登记为 **W7-G5**，本批不改（各有所有者）。iOS 设备读数等重打 app 后取；逐条读数在计划 §8.4 第 ㊱ 条。 |
| W8 | 三端（web / mobile / 原生壳）接线与壳级门禁 | ✅ **三端代码 + 壳级门禁都在 main 上了**（`f2d09974`）。🔴 这条门禁 04 03:2x 现量曾 rc=1、5 格 4 绿 / 1 红，红的格是 `[web] W5 产物比源码旧`（`dist 18:53 < src 19:40`）—— **是自家提交（`e2def90f` W6 + 后台面板）把这条判据甩下的，不是新缺陷**；同一条命令 03:0x 那次确实 rc=0 / 5 绿，两次都真。**04 04:5x 第三次现量：`pnpm --filter @heyta/web build`（`RC_WEB_BUILD=0`）后重跑 ⇒ `RC_SURFACES=0` / 5 绿 0 红**，回到与 03:0x 一致的读数。未取证 2 栏不变（`desktop-{macos,windows} / countdown · 产物`，macOS 那栏包里 `index.html` sha256 与本工作树 `apps/web/dist` 不符）。门禁自己那句话是判据本体："这份绿说的是**通道在**，**不是**装出来的包里有这一屏" | 那两栏~~只由 Goal 第 ⑤ 条的 `pnpm reinstall:all` 关闭（它顺带把 `apps/web/dist` 打进两端安装包）~~ —— 🔴 **04 07:2x 现量否证了一半，原地改掉**：`reinstall:all --only windows` 这一腿本轮**真跑绿了**（`RC_WINDOWS=0`，远端对账打印 `web-dist/index.html=517c6ba76d00fb25` 与本工作树 dist 逐字相同），可门禁那一栏**照旧报未取证** —— `check-shell-surfaces.mjs:778` 给 desktop-windows 写死 `artifactWebDist: null`，而 `:821` 在 `:831` 读 env 覆盖**之前**就短路 ⇒ windows 这一栏在本机**结构上不可能**转绿，缺的不是取证是把取证搬回本机的通道（登记 **W8-GAP-W1** / 任务 #20，含三臂变异配方）。<br>  ✅ **04 08:2x 通道已就位**：windows 那栏改走**远端取回的事实文件**（`artifactFacts` + `HEYTA_WINDOWS_FACTS`），生产侧 `install-and-capture.ps1` 补发 `PAYLOAD_INDEX_SHA` / `PAYLOAD_CHUNK_TOTAL` / `PAYLOAD_CHUNK_PRESENT` 三行；七臂台架逐臂读数（含「sha 对上而字节里没这一面」那一腿）记在 `countdown-anniversary.md` §8.4 ㉖。<br>~~⚠️ 但那三行还没在 Windows 上真跑过 ⇒ 这一栏现在仍报未取证，本轮不代它宣布关闭~~ —— 🔴 **04 10:4x 原地更正：这一栏已经有真实读数**（链 S，载体 `6105ba3b`，无设备参与）：`RC_SYNC=0` + `RC_PACKAGE=0` + 七条取证齐（`PAYLOAD_INDEX_SHA=517C6BA76D00…`、`PAYLOAD_CHUNK_PRESENT/TOTAL=2/2`）⇒ `check:shell-surfaces` **`RC_SURFACES=0`、5 绿 0 红、未取证从 2 栏降到 1 栏**，D4 那一行打印的是「装进包的字节与本工作树 dist **sha256 逐字相同**，且那份里有 `countdown-view`」。**四臂各量一次**（拿真取证文件改一个值，经 `HEYTA_WINDOWS_FACTS` 注入）：`PAYLOAD_WEBDIST=False`⇒红、`PAYLOAD_CHUNK_PRESENT=1`⇒红、sha 首位 `517C→0000`⇒**转回未取证**（不许拿别人的字节给自己这一轮作证）、删掉那三行⇒**未取证**（生产方没测这些事实）。跑的是 `reinstall-all.sh` 的 **windows 那一腿的两条命令**（`sync_windows_sources` + `package-msix.sh`），**不是整条 `reinstall:all`** —— mac 那一腿的 `/tmp/heyta-macos-dist` 与 `/Applications/Heyta.app` 正被那条 hung 链握着（`notarytool submit --wait` 到 10:36 已 7h22m，`lsof` 现量 27 个 fd 里**零个网络 fd**）。📌 **关闭 W8-GAP-W1 / 任务 #20**。⚠️ 一条限制：取证文件落在 `dist/windows/`（**被 gitignore**）⇒ 它是本机这一趟的读数，不是仓库里的常驻证据，干净检出上这一栏仍会报未取证。👁 打包图 `packaged-first-run.png`（1152×587）**人已看**：头像菜单第一项是高亮的「登录 / 注册」、下面「设置」、**没有**「退出登录」，主区「收集箱」+「未同步」chip，弹层是首装那张「在使用联网功能之前」授权卡，中文零豆腐块。⚠️ 与 Android 那一格同一条边界：这张图证的是「装上的是当前源码的界面」，而「倒数日这一屏在装出来的包里」是由上面那条 sha 逐字相同证的。<br>**macOS 那一栏这句仍然成立**（包落在本机 `/tmp/heyta-macos-dist`，D4 会读它），而它本轮**没装**：`notarytool submit` 已占这一档 4 小时 03 分（07:15:33 现量）。在此之前本行不打勾 —— 这正是 AGENTS §6.1.1 与 §7 第 27/82 条要防的那种"绿了但装的是旧产物"。<br>📌 ~~本行曾写"收尾那趟 check 之前必须先 `pnpm --filter @heyta/web build`，否则这一格必红"~~ —— **04 04:5x 现量作废**：`package.json:58` 的 `check` 串**第一段就是 `pnpm build`**，所以完整收尾那趟结构上不可能在这一格响；那句前置只在**单独跑 `check:shell-surfaces`** 时成立。教训的形状和 §8.4 那条一样：**把"单跑门禁"的条件写成"跑 check"的条件**，就是一个会误导下一个人的前瞻。 |
| W9 | 提醒（含投递路径 —— 现状是全仓零 `new Notification(`） | 🟡 **web 半 + DST ✅**（`a8f5a9a6`，变异 9/9 红）；**原生投递那半没动** | 投递路径 = Goal 明文要求的**没做完**那半（ADR-0051 另立一单）；合流时连带兑现 §3.1 |
| W10 | `EVENT` 必须**同时**进 AI 工具目录与 local-api 工具契约（实体与 AI 工具一起做；不改 `ENTITY_TYPES` 驱动的排期决定） | ✅ 已闭合（`8a595493` + `e2aeedc4`），目录 4 条 EVENT 工具，MCP 与内置 AI 共用同一份 | 无。⚠️ 副作用已被 L' 抓住并修（`ai-and-transfer.ts` 那张表 = 授权面） |
| W4b | 调休/补班的运营录入通道 + 客户端拉取（heyta **第一条服务端→客户端内容通道**，**ADR 必须定性，且回写 ADR-0038 的后台范围表**） | ✅ **代码链闭合，判据②的面板也落了**：服务端半 4 笔 + ADR 定性与 0038 回写（`c28e5f1a`）+ 门禁 `check:public-facts`（八臂 8 红 0 存活）+ `dayMarker` 缝 + 客户端拉取三笔（`6735cc39`/`b05fbc50`/`67fef701`）。**判据①**真界面三档截图已看；**判据②**的后台面板在 `apps/web/src/features/admin/AdminPanel.tsx`（`HolidayPanel`，把 `papers` 渲染成 `<a href>` + `rel="noreferrer noopener"`），e2e 那条用例（`admin-console.spec.ts`「调休/补班那一页把出处回显成可点链接」）**04 03:0x 第一趟跑出来是红的**：五条同因红，报错逐字相同 `除已登记缺失外不该有非 2xx：["/api/holiday-adjustments"]` —— 根因不是面板，是**本批自己的**开机拉取没人登记（见 §0 第 ① 条例外），补了 `e2e/tests/helpers.ts:stubPublicFacts` 之后重跑 | 三条欠账**04 04:1x–04:3x 全部量完**（逐项读数在 `countdown-anniversary.md` W4b 节那条表格）：正常腿 `RC_W4B_OK=0` / **6 passed**、还原后复绿 `RC_RESTORE_ADMIN=0`；两张图**人打开看过**（改前把年份挤成「2026…」，改后 `2026 · 2 天安排 · 国务院办公厅通知` + 两条链接折行），看图还照出我文档里那句"年份被挤没"说轻了、原地改成"整格被挤成 2026…"；三臂变异 `RC_B1=1`/`RC_B2=1`/`RC_B3=1` 各红自己那条（`:887` / `:889` / `:909` 正向对照）。修复两笔已入库 `87109e9e`（提交在变异全部还原**之后**，sha 与基线逐字节相同）。⇒ **只剩 `inbox.spec.ts` 那条先红后绿**（同一批开机拉取的敞口，链条第 [8] 步在量） |
| L 系列 | 法务联动 —— 改 `packages/legal` 那六处现成位置、每处中英双份、落地页文案走生成物不许手改（`check:legal-copy` 已在 `pnpm check`） | 🟡 **判定表已出、唯一真命中已修**（`2d53ea94` + `8996de9d` + `1d71e75f`/`017adc3e`）。🔴 现量读数**只在 §0 第 ② 条与 `countdown-anniversary.md` §8.2 L' 第 1b 条各写一次**（同一对抄件会漂：这两处曾分别写"2 条红"与"6 条红"，04 03:5x 实测都是 **7 条**，且红的是 main 的**已提交状态**——把七份输入换成只含 `origin/main` 内容的探针根复现相同）| ⇒ **归属不在本批**：六句必须一起翻并重跑 `check:legal-copy`，本批代改会造出三方冲突。**关闭判据**：`node scripts/check-legal-permissions.mjs` rc=0（每次引用本条重跑，并写明在哪个载体跑的） |
| 收尾 | Goal 第 7 条 + 计划 §5/§8.3 | 🟡 **第 1 条已**三趟**量完：第三趟一趟跑完 68 段 = **66 绿 / 2 红**（04 06:17:07–06:27:21 @ 载体 `c4332f86`，含 `check:ai-e2e` **352s `rc=0`** —— 本批第一次整条 e2e 零红；两条红逐条对账在计划 §8.4 第 ⑩ 条、整趟读数在第 ⑪ 条），前两趟是逐段量的（66/68 段两趟 + `-r test` 全量 + ~~ai-e2e 一趟但并发~~ **04 06:1x：ai-e2e 已补一趟安静的，`3 failed / 1 passed` 三条红全部复现并全部归因完毕**——两条是本批 W4b 的开机拉取撞上夹具的封闭登记（已按 `inbox`/`admin-console` 同一条纪律登记进去），一条是 W6 的侧栏几何红 R-1（已修，修后 `RC_E2E_SIDEBAR=0`））**、第 2 条 04 06:2x 在本树重取 **`rc=0`**（计划 §8.4 第 ⑫ 条，含那条差点被 `\| tail` 骗过的取码方式）、第 3 条三批图都人已看；只剩第 4 条设备那一趟在排队。**04 02:5x 现量更正**：`node research/tools/docs-link-check.mjs` 在 `heyta-wt-batch2` 隔离检出 ⇒ **rc=0，死链 0 处** —— 上面那句"33 处"是**主检出**（有别人未跟踪文档）的读数，死链数是"仓库 + 本机未跟踪文件"的属性，不是仓库属性。**04 05:3x 补**：~~W4b 判据②待看~~ 已看（`apps/web/evidence/admin-holiday/`，看图照出"整格被挤成 2026…"并把判据改成几何）；`pnpm -r test` 全量现量 **10760 passed / 1 failed / 14 skipped，19/19 个包**，而那一条红在安静窗口两趟 `15 passed / rc=0` ⇒ ~~并发单发不稳，已关闭~~ 🔴 **04 06:1x 这句归因作废并原地改掉**：不是"并发"，是**探针赌时长** —— `DueEditor` 的面板有两副身体， jsdom 27 会在一个宏任务里派发 `toggle`、`rAF` 在 17ms 回调，而用例从 `container` 里找格子； 机器空时等不到 17ms 就绿、负载 31 时等到了就红。修法 = 三处定位改从 `document` 取（同文件 R14 那几条早就是这么写的）， 并把 `DueEditor.tsx` 注释里那句"jsdom 不触发 `toggle`"改成实测结论。修后 `RC_JSDOM=0 / Test Files 2 passed`。🔴 顺带一条**不属于本批但要留的现量**：`AGENTS.md:295` 写着"当前 2592 个通过"，实测差 4 倍多 —— **没有代改**，因为主检出的 `AGENTS.md` 此刻正被另一条会话改着（`git -C <主检出> status --porcelain -- AGENTS.md` = ` M`），改它 = 制造一次没人能干净解的冲突 | 第 4 条 `pnpm reinstall:all` 四端 + `verify:mobile-card-export`：链条已排（`/tmp/batch2-closeout2.sh` 的 B 段：等另一条会话的重装链退出 → 负载门 → 工作树干净 → 装四端 → 设备出图 → 重取两扇门禁）。⚠️ 它此刻等的是**外部**一件事，04 06:3x 现量更新：对方那趟 `reinstall:all` 卡在 macOS 公证的 `notarytool submit --wait` 上**已 3 小时 21 分**（pid 98934；`/tmp/heyta-reinstall-mac.log` 自 03:13 起**零字节增量**、末行停在 `=== ⑥ 公证 ===`），而**那次提交没有超时** ⇒ 它不会自己结束；等满按任务书第 8 条记 **exit 3 = 环境无效而非产品失败**。🔴 并且"对方已经装过一遍"**不算本批的账**：其载体 `d0a81927` **不含**本批 HEAD（`git merge-base --is-ancestor 895ad07c d0a81927` ⇒ rc=1）。✅ 等待口径换掉两处：**① 现场判据改用仓里现成的闸门** `bash scripts/verify-mobile-window-gate.sh --target b`（04 06:3x 首跑 **`RC_WINGATE_B=3`**：工作树 / `reinstall-all.sh` / iOS 三台已启动模拟器三条 ✅，唯一 ❌ 是**负载 18 > 阈值 12**；同趟 `adb devices` **0 台** ⇒ Android 那一端此刻连"可达"都不成立），不再手搓负载探针；**② 上一版那条"别人在跑"的 `pgrep` 探针被现量否证为自匹配**（创建脚本的后台包装 shell 的 argv 带着整份 heredoc 正文，正文里就有那些字符串 ⇒ 永远命中自己；main 上 `dc63cbff` 记的是同一形状的另一种面目），已改成豁免自己这一棵 + 空跑自检（`/tmp/window-wait-E.sh`）。取证与打包脚本那两条形状（公证无超时；`if … \| tail -8 \| awk` 判的是 `awk` 的退出码 ⇒ `🔴 公证失败` 分支不可达）在计划 **§8.4 第 ⑬/⑭ 条**与**待入 #218**。✅ **04 06:5x 再补两件事**：执行链（窗口复量→干净树→装前基线→headless 起 `heyta-*` AVD 并现取序列号→`reinstall:all`→装后配对判据→`verify:mobile-card-export`→重取两扇门禁→还原 evidence）已写好**并证了它第一道判据真的会拦**（现在就跑 ⇒ `RC_F_GUARD=3`）；W7 那条设备判据里**不需要设备的两腿**已经先量了（读数器分得出 1080×1440 与 3×2、`BLANK` 一真一假 ⇒ 那条判据不是恒真断言）—— 全部读数在计划 **§8.4 第 ⑬/⑭/⑰/⑱/⑲ 条** 🔴 **04 08:5x 现量：收尾第 4 项的 mac/windows 两腿被并行那条线自己的 `pnpm reinstall:all` 占着**（`queue-reinstall-all.sh` 03:13 起跑，`notarytool … --wait` 到 08:58 已 5h45m 无超时 ⇒ 同握 `/tmp/heyta-macos-dist` 与 `/Applications/Heyta.app`）；本批**不并发、不代它宣布关闭**，而且他们那趟打的是 `main` 侧载体 `d0a81927` 的产物 —— ⚠️ 本行原先写"里面没有本批三笔"，**09:2x 逐笔 `git merge-base --is-ancestor` 现量后否证**：W4b 的 `c28e5f1a`/`6735cc39`/`b05fbc50`/`67fef701` 四笔**在**他们载体里，`a0d342df`/`87109e9e`/`8e4b5097`/`58cff57f` 四笔不在；⇒ 结论不变但理由换成"装上的必须是当前提交"：那一趟仍然不能替本批关闭任何一格。`/Applications/Heyta.app/…/web-dist/index.html` 现量停在 10-03 23:05 ⇒ "mac 装上当前产物"此刻为假。逐条取证与窗口开放后的关闭判据在原计划 **§8.4 ㉙**。<br>🔴 **04 11:2x 现量把这一格换成"三条链排队 + 一条硬阻塞"**（前面那些 06:3x/08:5x 的等待口径仍然成立，只是读数换了）：**① windows 那一腿已经真跑绿并关上 W8-GAP-W1**（链 S：`RC_SYNC=0` + `RC_PACKAGE=0` + 七条取证齐 ⇒ `check:shell-surfaces` 的未取证从 2 栏降到 **1 栏**，四臂变异各红/各响亮跳过一次，读数在 §8.4 ㊲）；**② iOS 的正式设备读数没取到**（链 R 10:50 负载门开了一格、探针自己的现场门同一秒因主检出有人起 `verify-mobile-ios-reminder.sh` 而拒跑 `RC_IOS_PROBE=3`；链 R2 第 4 次 runner 门开了、卡在负载门等满 900s，11:18 现量 `loadavg 47.72 27.88 22.48`）—— **W7-G3 因此仍不打勾**，逐条在 §8.4 ㊳；**③ Android 那一腿必须重跑**：09:18 那趟之后 `apps/mobile/src/lib/card-export.tsx` 改了（`settleRasterize`）⇒ 模拟器里那枚 APK 的 bundle 已不代表当前提交，这正是 §6.1.1 与 §7 第 27/82 条要防的"绿了但装的是旧产物"；**④ macOS 那一腿不能由本批自己动**（两条硬理由，不是"再等等"）：`package-app.sh:36` 会 `rm -rf "$OUT_DIR"` 而默认 OUT_DIR 正是那条 hung 链**正在公证**的 `/tmp/heyta-macos-dist`；而门禁 mac 那一栏读的是**写死的**这个路径、**没有 env 覆盖**（`check-shell-surfaces.mjs:263` + 它 957 行那段注释就是上一轮"把别人的包读成自己的"之后加的）⇒ 任务 #23 登记了关闭条件。排队的三条链各带自己的前置，互不并发：**链 R2**（重试 iOS 现场门，直到 `RC_IOS_PROBE != 3`）→ **链 U**（`reinstall:all --only android` + `verify:mobile-card-export` 在当前产物上复跑 + 两扇门禁重取，4b 那步会在 `apps/web/dist` 的 sha 被 `pnpm -r build` 改动时**当场重打 windows 那一腿**）→ **链 V**（完整 `pnpm check` + `docs-link-check`，跑前先量 4318/4319 空着，否则不跑）。✅ 同批重取：`docs-link-check` 在当前 HEAD **rc=0**（死链 0），`check-md-table-rows` **rc=0**，`check:card-export` **rc=0**（载体 `ce4bf082`，无设备参与）。 🔴 **04 13:2x–14:0x 原地更新（链 U / V / X）**：第 4 项的 **android 那一腿已在当前提交上重取**（链 U 13:18 `RC_REINSTALL_ANDROID=0` → 13:20 `RC_ANDROID=0`，通过 11 项 / 失败 0 项；成品图换成 13:20 那枚 `BYTES=34360 SHA=2ac31233b2ed`，人已看，字节差是卡片标题不是行为）；**windows 腿不必重跑**（13:20 现量「本地 dist sha == 包内 sha = `517C6BA76D00FB25`」⇒ 上面那份取证对本轮仍成立，链 U 第 4b 步就是这条自愈判据）。第 1 项：**完整 `pnpm check` 在 13:26 停在 `check:ui-provider`**（4 处"消费者在子树之外"），14:0x 现量**否证了我先前"别名误判"的判读**、查出真根因是探针把 `return <X />` 当成 TS 泛型吃（我自己那笔 `b8f39cae` 照出来的盲区，`git show b8f39cae^` 里该形态命中 0）；改一行"紧邻前置字符"判据后 **`check:ui-provider` rc=0**，可达集 mobile 32→36 / web 65→66、**零新增红**，四条变异臂（CONTROL 0/0、tokenizer 退回旧写法⇒恰好那 4 条红、摘掉 mobile 的 Provider⇒响亮报"没挂"、冻结可达性 BFS⇒93 条红）记在计划 §8.4 ㊶ —— 完整 `pnpm check` 的读数因此解锁，排在链 X 之后取（它第一步 `pnpm -r build` 会抢 Metro 的 CPU）。第 4 项的 **iOS 那一腿仍未取到**：链 X 13:46 起在负载门里被连续拒绝（20→39，累计 960s 还没开），按任务书第 8 条那是**环境无效不是产品失败**，等满即 `exit 3`，不为此调低阈值；mac 那一腿的两条硬理由（`package-app.sh` 会 `rm -rf` 别人在飞的 `/tmp/heyta-macos-dist`、`check-shell-surfaces.mjs:263` 把该路径写死且无 env 覆盖）到 14:0x 仍然成立。 |
| 同步 | 每完成一项 → 计划文档打勾 + **同步 AGENTS §9** | 🟡 计划文档已同步（`cd839ec5`）；**AGENTS §9 欠着** | `AGENTS.md` 脏 ⇒ 不能 `--only` 提交（§7 第二条），等干净后补 📌 **04 09:1x 现量（合流义务的三处载体全在别人手里，本批一律不代改）**：主检出 `git status --porcelain \| wc -l` = **240**，其中 `AGENTS.md`、`package.json`、`e2e/tests/helpers.ts`、`e2e/tests/admin-console.spec.ts`、`scripts/lib/mobile-e2e-runner-probe.sh` **逐个都是 ` M`** ⇒ ①AGENTS §9 那句"补上"仍然做不到（`--only` 提交会把别人的未提交内容一起吸进 HEAD），②#18 那两份同义开机拉取夹具的收敛（两条都住在 `helpers.ts` / `admin-console.spec.ts` 里）**同样被挡**，③window-gate 自匹配那条修复也在他们手上。三条都只在他们提交之后才有一步可做，本批不代改、也不把"欠着"写成"已排期"。 |

**硬边界与纪律（任务书原文 7 条，逐条仍在生效）**：

1. 先调研再动手：开工前给出"现状 vs 工单"的差集（带 `file:line` 与可复跑读数），不许凭记忆建计划。
2. **push 与 merge 属共享状态动作，不擅自执行**；本地提交用点名路径。
3. 不干扰主检出与并行会话（他们正在改日历与 AI 线）；`docs/reference/environment-traps.md` 被写脏时不往里追加，
   改投单写者文档并登记"待入 traps #N"（编号按当时工作树现量）。
4. 设备/端口/库只用私有现场（隔离检出 + 私有 AVD + 私有 `PORT` + 私有库名），负载门等满以 `exit 3` 结束 = **环境无效不是产品失败**。
5. 不 bump `CURRENT_SCHEMA_VERSION`；给持久化模型的新字段一律可选并给运行时默认值；不改已接受 ADR 的结论（要变更另写一份）。
6. 每步判据必须带可复跑命令与实际读数；**新增门禁必须先证明它能失败**；界面结论必须有截图且人真的看过。
7. 每完成一项：行为改动与结构改动不混提交，并在 `docs/plans/countdown-anniversary.md` 对应 W 节打勾
   （写成过去式 + 读数），同步 `AGENTS.md` §9 的进度行。

---

## 1. 已闭合的（都已提交，可逐条复跑）

载体：`feat/countdown-batch2` @ `db430cc9`（21:0x 现量：W7/W8 已并进来，见 §2），worktree
`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-batch2`（`git status --porcelain` ⇒ **0 行，干净**）。
分支 `19 ahead / 25 behind main`（21:1x 现量；`main` 在动，这个数每轮都要重取）。

| 工单 | SHA | 一条可复跑的读数 |
|---|---|---|
| W0 锚点弹层算术上提共享层 | `7966857a` | `pnpm --filter @heyta/ui test` ⇒ 448 passed；变异 1 臂转红 |
| W0b ①② 设备验收现场隔离 | `6598703b` | `/tmp/ui.xml` / `_xy.py` / 库名改带默认值旋钮（默认值逐字不变）；harness 22 绿 0 红 |
| W2 `EVENT` 实体整链 | `bb6c1203`(+`05794dc5`) | 20/7/17/41/30 passed；`listEvents` 已进 `READ_PATTERNS` 且**三腿验过能红** |
| W5 卡片网格 + 二级操作 | `a9529a59`(+`94760c82`,`c07df677`) | e2e **6 passed**（整族 15 passed）、三张图**人已看**；看图照出"逾期卡整行不画日期"并修掉 |
| W9 提醒（web 半 + DST） | `a8f5a9a6` @ `feat/countdown-w9` | 42/28/40 passed；变异 **9 臂 9/9 红、0 未证**；移动端那半**没动** |
| W10 AI 工具目录 | `8a595493`(+`e2aeedc4`) @ `feat/countdown-w10` | 130/223/1019 passed；变异第一趟 **3 臂存活** → 补判据 → 第二趟 6/6 红 |
| L' 命中项 + 工具表对账门禁 | `2d53ea94` + `8996de9d` | `check:legal-tools` 四臂变异全红；条款补 4 行、`version 1.0→1.1`（进同意指纹） |
| L' 权限承诺对账门禁 | `1d71e75f` + `017adc3e` | 见 §1.1 |
| W4b 文档半（ADR 定性 + 0038 回写） | `c28e5f1a` @ **`main`** | 死链复核 `node research/tools/docs-link-check.mjs \| grep -E 'adr/0038\|adr/0052\|countdown'` ⇒ 无命中 |
| 计划文档三处自证否证 | `cd839ec5` @ **`main`** | 见 §8（那些 dead end 就是这一笔的内容） |

### 1.1 `check:legal-permissions` 的绿读数（复跑即得）

```bash
cd "…/heyta-wt-batch2" && NO_COLOR=1 node scripts/check-legal-permissions.mjs; echo rc=$?
```

```
✅ 权限承诺对账通过：Android 声明 1 条 [INTERNET]、NS…UsageDescription 0 条、句子项数 zh=9 en=9、
登记表 9 项、REVIEWED_REQUESTED 0 项、通知授权 未声明（六个承诺位置命中 6/6）（声明面与"不申请"那九项逐一对得上，
中英同数量，通知族六个位置与申请面同真假）
rc=0
```

它已接进 `pnpm check`（`check:legal-tools` 与 `check:legal-host` 之间）。
变异清单在 `/tmp/mutate-permission-claims.mjs`（**13 臂，未证伪 0，夹具失效 0，逐字节还原=是**）——
⚠️ `/tmp` 会被清，**臂的语义已在门禁本体里**（每臂对应哪条 `fail()` 可直接读源码），不必依赖那个文件。

---

## 2. 三条并行线的现量（22:0x 已全部收进 batch2；下面的逐文件读数是当时取的，引用前重取）

| worktree | 分支 / HEAD | 未提交 | 状态（21:0x 更新） |
|---|---|---|---|
| `heyta-wt-w7` | `feat/countdown-w7` @ `581bdb99` | **0（已提交）** | ✅ **已并入 batch2**（merge `caf9a48c`） |
| `heyta-wt-w8` | `feat/countdown-w8` @ `b8f39cae` | **0（已提交）** | ✅ **已并入 batch2**（merge `db430cc9`） |
| `heyta-wt-w4b` | `feat/countdown-w4b` @ `e442a3bb` | **0（已提交）** | ✅ **那 4 笔代码提交已挑进 batch2**（`a39f7fa6`/`a2259e5d`/`3708d08c`/`2877dd37`，union 解掉唯一相撞面）；`d4fd01a1` 那笔文档单独处置，未并 |

✅ **21:0x 增量（这一段我做完了，接手者不必重做）**：三条并行线原来 100% 躺在未提交改动里，
现已各自按点名路径落成本地提交（worktree 全部 0 脏），且 W7 / W8 已合进 `feat/countdown-batch2`：

| 动作 | SHA / 读数 |
|---|---|
| W7 提交（3 文件 +158） | `581bdb99`，`card-export-contract.ts` 99 行新 + `ui/src/countdown/model.ts` +42 + `shared-schema/src/index.ts` +17 |
| W8 提交（11 文件） | `b8f39cae`，含 `feature-modules.ts` 77 / `CountdownScreen.tsx` 267 / `feature-entries.spec.ts` 244（新） |
| W4b 服务端半提交（8 文件） | `e442a3bb`；🔴 迁移**确实存在**（`a2313c9a` 带 `server/prisma/migrations/20261009000000_add_holiday_adjustments/migration.sql` 139 行 + `schema.prisma` +78，两张模型 `HolidayAdjustmentYear:996` / `HolidayAdjustmentDay:1024`） |
| merge W7 → batch2 | `caf9a48c`，**合后 tree 与预演 tree `db0d9205…` 逐字相同** |
| merge W8 → batch2 | `db430cc9`，合后 tree 与预演 `b5f3cd2c…` 的差集**恰好是 W7 那三枚文件**（因为基线已含 W7）⇒ 自动合并没有产生第三种形状 |
| batch2 现态 | HEAD `db430cc9`，`git status --porcelain` = 0 脏，`main..HEAD` = **19 笔**（原 15 + 3 笔合并链 + …），**未验证**（见 §6） |

🔴 **这三笔合进去的是"半成品"，不是"验证过的成品"**：W7 只有契约、**没有设备出图那半**；
W8 有移动半与测试但**一行都没跑过**；壳级门禁没做。合流的语义只是"别丢工作"，不改变 §0.5 里两行的状态。

### 2.1 W4b 的并入配方（下一次照着做，别重新推）

- **决策已定：只挑 W4b 那 5 笔，不整支合并。** 那条分支相对 batch2 有 10 笔独有提交，其中 5 笔**不属于本批**：
  `192a516d`（organizer/habits 两端改名删除）、`437e7c1a`（ledgers 文档）、`76cbee51` + `c506953b`（真机脚本别名/自快照登记）、
  `6570e52d`（W0 打勾文档）。那是**别人在 main 线上的工作**，我吸收进本批就等于替他们决定落地时机。
- 要挑的顺序：`981eee43` → `7049bfed` → `a2313c9a` → `e442a3bb`（4 笔代码），`d4fd01a1`（W4b 开工实测的文档笔）**单独处置**——
  它改的 `countdown-anniversary.md` 在 main 上已经走到 `cd839ec5`/`33eea3e5`，直接 cherry-pick 必撞。
- 🔴 **卡点与解法（已复现一次）**：`git cherry-pick -x 981eee43` 在 `packages/shared-schema/src/index.ts` 撞 `UU`——
  HEAD 那侧是我刚合进来的 **W7 导出块**（`EXPORT_CARD_EDGE_PX` 等，带"边长/比例/格式是产品规格所以住契约层"那段注释），
  另一侧是 **holiday-adjustment 的导出块**。两者是**不同文件的各自新增** ⇒ 正确解是 **union（两段都留）**，不是择一。
  我按用户"到此为止"的指令已 `git cherry-pick --abort` 退回 `db430cc9`（脏 0，源提交 `e442a3bb` 仍在，零丢失）。
- 挑完之后：`server/tests/holiday-admin-routes.spec.ts`（351 行新）与 `admin-routes.spec.ts`（+56）**第一次跑**要在 batch2 上，
  并把契约文件头那句不存在的 `ADR-0050` 指针改成 **ADR-0052**（§3.2）。


**冲突来源已定位（省掉下一轮重新推）**：整支合并时唯一真冲突 `scripts/verify-mobile-lists.sh` 来自
`c506953b`（真机脚本别名那笔，**不属于本批**）⇒ 只挑 §2.1 那 4 笔代码提交就**根本碰不到它**。
四笔的落点已逐笔量过：

| 提交 | 文件与尺寸 |
|---|---|
| `981eee43` | `holiday-adjustment-contract.ts` 241 新 / `shared-schema/src/index.ts` +29 / 契约测试 279 新 |
| `7049bfed` | `packages/domain/src/holidays.ts` +224 / `holiday-adjustment-override.spec.ts` 242 新（判据④那三条分支） |
| `a2313c9a` | 迁移 `20261009000000_add_holiday_adjustments/migration.sql` 139 / `schema.prisma` +78 / pglite 迁移测试 363 新 |
| `e442a3bb` | 契约 +177/−43、`server/src/holidays/{day-column,store,routes}`（34/353/126）、`admin.routes.ts` +108、`server.ts` +14、两个测试 |

⇒ 唯一的相撞面是 `packages/shared-schema/src/index.ts`（W7 的导出块 × W4b 的导出块），解法 union。

复跑命令：

```bash
cd "…/heyta" && git merge-tree --write-tree --name-only feat/countdown-batch2 feat/countdown-w4b | head -40
```

---

### 2.2 首次验证读数（22:0x，载体 = `feat/countdown-batch2` @ `509a06cd`）

合进来的东西**第一次真跑**。逐条可复跑：

| 跑的是什么 | 命令 | 读数 |
|---|---|---|
| 全量构建 | `pnpm -r build` | **rc=0**，含 `server build$ prisma generate && tsc` |
| 全量类型 | `pnpm -r typecheck` | 起手 **2 枚红** → 修完 **rc=0**（19 个包；server 没有 typecheck 脚本，它的类型由 `tsc` 在 build 里查） |
| W4b 契约 | `pnpm --filter @heyta/shared-schema test` | **117 passed** |
| W4b 判据④三条分支 | `pnpm --filter @heyta/domain test` | **859 passed**（起手 15 枚红，见下面第 2 条） |
| W7 消费面 | `pnpm --filter @heyta/ui test` | **452 passed**（448 + 新开的 dayMarker 缝 4 条） |
| W8 移动半 | `pnpm --filter @heyta/mobile test` | **547 passed**（起手 4 枚红，同一原因） |
| W10 的两处类型红 | `pnpm --filter @heyta/local-api test` / `@heyta/ai test` | **130 / 223 passed** |
| 服务端全套（**第一次**） | `pnpm --filter @heyta/sync-server test` | 起手 **1 failed**（下面第 3 条）→ 修完那条 spec 单独复跑 **62 passed** |
| 共享组件回归 | `pnpm --filter @heyta/web test` | **1512 passed / 12 skipped** |
| 新门禁 | `pnpm check:public-facts` | rc=0；`GET 路由 20 条，匿名 3 条` |
| 样式与文案 | `check:design` / `check:ui-language` | ✅ 无硬编码 / ✅ 299 文件 379 处文案 |

**三条只能在本轮拿到的事实**（都是"上一轮写成主张、这一轮跑出来"那种）：

1. 🔴 **那 19 枚红没有一枚是产品缺陷，全部是判据读了旧 `dist`。** 起手 `packages/shared-schema/dist/index.js`
   的时间戳是 **17:05**，而 `grep -c EXPORT_CARD_EDGE_PX dist/index.js` = **0** —— 也就是说 W7 的契约
   **从来没被构建过**。`pnpm --filter @heyta/shared-schema build` + `@heyta/domain build` 之后
   15+4 枚一起消失。⇒ AGENTS §7 第 27 条那一族的又一副面孔：**共享包源码变了，任何读 dist 的判据
   都还在测上一个版本**，而它报出来的错长得像真缺陷。
2. 🔴 **交接 §6 那句"沙箱里跑不了 `@heyta/sync-server`（`prisma generate` EPERM）"被现量否证。**
   本轮 `prisma generate` 正常出来（`Generated Prisma Client (v5.22.0) … in 147ms`），服务端 91 个测试文件
   跑起来了。**别把环境主张当常量抄下去** —— 它多半取决于当时谁的进程占着什么。
3. ✅ **服务端那一枚红是真的，而且是 W2 欠的一步**：`validation.service.spec.ts` 的
   `ALLOWED_ENTITY_TYPES` "精确数量"断言红 —— 它对照的 `HEYTA_ENTITY_TYPES` 是一份**手写清单**，
   而清单自己的注释写着"加实体必须是有意识的决定，不能被顺手带过去"。W2 加了 `EVENT` 却没在服务端这侧认领，
   因为当时只跑了 `packages/*`。⇒ 修的是**认领**（`30340fa2`），不是数量断言。
   这条同时说明：**W2 那个 ✅ 原本缺了服务端这一腿**。

**载体事实**：本轮 21:13→21:39 之间这台 Mac **重启过一次**（`uptime` 从 `up 7 days` 变成 `up 8 mins`），
负载随之从 375 掉到 15-25；并行会话的重活被打断过，接手时它们的现场要重新现量。

---


## 3. 🔴 合流时必须兑现的两条义务（没有门禁兜底，漏了就对外说假话）

### 3.1 L' 通知族：六个字面位置要跟着 W9 翻转

`feat/countdown-w9` 那条线把"移动端不产生系统通知"变成了历史。六个承诺位置（权威清单在
`scripts/check-legal-permissions.mjs` 的 `NOTIFICATION_CLAIM_SLOTS`，别在本文里抄第二份 —— 抄件一定漂）：

- `packages/legal/src/documents/permissions.ts` —— Android 行依据（zh + en）、iOS 行依据（zh + en）
- `packages/legal/src/documents/third-parties.ts` —— 推送 SDK 否表行（zh + en）

门禁是**两侧对称**的：`声明了 & 条款仍说不申请` ⇒ 红，`没声明 & 条款已说不申请` ⇒ 也红。
所以**改的顺序只能是"依赖与条款同一笔提交"**，不能先加依赖后改条款。

同时必须做的第二件：W9 会往 Android manifest 加 `SCHEDULE_EXACT_ALARM` 之类的权限 ⇒
**显式登记进 `NON_PRIVACY_ANDROID_PERMISSIONS` 并写理由**（那是"非隐私权限"白名单，
不登记就会红；为把它变绿而放宽判断 = 摘掉门禁）。

复跑：`node scripts/check-legal-permissions.mjs`（改完）+ `pnpm check:legal-copy` +
`pnpm --filter @heyta/legal build`（**条款正文改过必须升 `version`，它进同意指纹**：`packages/legal/src/index.ts:125`）。

### 3.2 ADR 编号撞车：`0050` → `0052` 的指针要改

`packages/shared-schema/src/holiday-adjustment-contract.ts` 文件头引用了**不存在的 ADR-0050**
（0050 已被 E2EE 那条占用、0051 是移动端提醒投递）。本决定实际落在
**ADR-0052**（`c28e5f1a` @ `main`）。⇒ 合流时把那处指针改成 0052。
`AGENTS.md` 里并行会话也写过一行 `0050→0051` 的错引，**不代改**（他们的文件正脏）。

✅ **本义务已于 `1dbe6df6` 兑现**，但现量比这里写的**大一个数量级**：不是"那处"，是 **12 处 / 9 个文件**。
逐处对着 ADR-0052 的正文核过，机械换号会留下三类错：① 章节号错（`§3/§6` 在 0052 里是 §2.1/§2.2，
0052 的 §3 是"为什么不选另外两条路"）；② **两处引用了 0052 里根本没有的话**（"§5 的体积账"、
"§4 明写它不是内容寻址"）—— 已改成引用真实立场（§4 第 4 条"缓存不是正确性来源"），
"体积账"归给契约常量自己推导；③ `holiday-adjustment-contract.ts` 那条链接**少一层 `../`**，
换了号也仍是死的。📌 **`docs-link-check` 只走 `.md`**（实测 `collectMarkdown` 只收 `.md`）⇒
代码注释里的链接**没有任何门禁在看**，所以它能编号和深度同时错而全绿。

---

## 4. W4b 剩下的半（客户端侧，全部从零）

> 🔴 **22:0x 更新**：下面第 1 件（后台录入）随 §2.1 那 4 笔**已经落地**（`admin.routes.ts` 的 GET/PUT/DELETE
> 三端点 + `server/tests/holiday-admin-routes.spec.ts` 351 行）；第 3 件（`dayMarker?`）**缝已开**
> （`509a06cd`，判断在 `calendar/model.ts` 的 `calendarDayMarkerView`，4 条判据 + 三臂变异全红），
> 宿主接线还没人传它。⇒ **本节只剩第 2 件是从零**，加上判据①要在真界面上跑一次。

> 🔴 **23:0x 增量 —— 第 2 件（客户端拉取）与判据①都做完了，读数如下**：
>
> | 落点 | 提交 | 判据与变异 |
> |---|---|---|
> | `OpLogStore` 开出一对 META 通用读写 | `6735cc39` | 契约一条判据覆盖四件事（缺键 `undefined` / 值型不变 / 覆盖生效 / 不碰游标），在 **6 个适配变体**上各跑一次；三臂变异 **6 红 / 6 红 / 2 红** |
> | app-host `public-facts.ts`（匿名拉取 + 缓存 + 装进领域层） | `b05fbc50` | 10 条判据；**8 臂变异逐臂精确报红**（去 `credentials:omit` / 塞 `authorization` / 路径改回手写 / 丢 `papers` / 未配置也发请求 / 坏形状覆盖缓存 / 不发条件请求头 / 无缓存时抛错） |
> | web 接线 + `publicFactsEpoch` + i18n 中英 + 真界面判据 | `67fef701` | 宿主层 7 条判据；**7 臂变异逐臂报红**（其中 W1/W6/W7 各命中 2 条，因为订阅与幂等共用一个守卫） |
>
> 🔴 **判据①第一次有了真界面载体**（`e2e/tests/public-facts.spec.ts`，3 passed，三张图入库
> `e2e/test-results/public-facts-{local-only,self-hosted-404,deployer-supplied}.png`，**人已打开看过**）：
> A 没配服务端 / B 那条通道 404 ⇒ 42 格齐全、随包表的「休」（10-01…10-07）与「班」（10-10）照画、
> 控制台零 error；C 部署方只下发 10-17 ⇒ 那一格出「班」，**而 10-01 的「休」整年替换掉**（这是
> ADR-0052 §2.2 的语义，若实现做成"合并"在界面上完全看不出来，所以两条腿都断言）。
>
> ⚠️ 两条**当场发现、当场没修**的：
> ① 左侧**迷你月历不跟着画标记** —— 它是 `CalendarSidebar` 自己那份网格，不在共享板上，
>    而它正被日历线整片重写（§5）⇒ 由 **W6 复用同一条 `dayMarker` 缝补齐**，不在这里长第二份；
> ② 判据②"papers 在**后台界面**回显"只做到 API 层 —— 后台没有调休面板，`admin-client.ts` 也没有
>    对应方法 ⇒ 已开工补面板（`apps/web/src/features/admin/` + `admin-client` + i18n + 判据），
>    **面板落地并跑过判据之前 W4b 不打勾**。
> 🔴 ③ **一条边界，免得下一个人以为"三端都接了"**：第 2 件的"宿主接线"这轮落的是 **web 那一个宿主**
>    （工单原文点名的接点就是 `apps/web/src/features/calendar/CalendarView.tsx`）。**移动端没接**：
>    `apps/mobile/src/screens/CalendarScreen.tsx:193` 用的是同一块共享板，加那两个可选 prop 就亮，
>    但它缺的是**另一件东西** —— 一次宿主级启动接线（`readSyncConfig()` 的地址 + `openTaskHost()` 的
>    store + `AppState` 回前台），而那个文件正被日历线整片重写（§5 那 14 个里就有它）。
>    ⇒ 与迷你月历**同一笔账、同一个 owner（W6/W8）**。
>    📌 `createPublicFactsWiring` 这个工厂**形状上已经宿主无关**（端口全注入、零 DOM），
>    移动端接时**直接复用，不要复制一份** —— 复制的那一半就是 AGENTS §3.5 记过两次的事故形状。

已落（服务端半，未提交）：两张表 + 1 条迁移（年度录入存 `papers` / 逐日 `day DATE + isOffDay BOOLEAN`）、
线协议契约在 `shared-schema`（**唯一一份**）、`holidays.ts:108 adjustmentOn()` 接上"部署方下发的覆盖表"入口、
`ETag` / `Cache-Control` / 304。

待做四件，按依赖顺序：

1. **后台录入**（照 `/coupons:614` `/invites:670` 的形状，闸门 `admin.middleware.ts:34` 自动覆盖新路由）。
2. **客户端拉取 + 缓存**。🔴 **不要为它论证破边界** —— 我原先写"app-host 没有任何 `fetch(`"是错的，
   实测它有 **5 处 `fetchImpl`**（`admin-client` 1 / `entitlement` 1 / `inbox` 1 / `privacy-consent` 2；
   `host.ts:110`、`hosted-auth.ts:630` 绑 `globalThis.fetch`）⇒ **照 `fetchImpl` 现成形状接，公共事实不许带 token**。
   ✅ **22:2x 补两条现成的落点**（省掉下一轮重新摸）：
   · META 里**放字符串早有先例** —— `host.ts:205-215` 的 `resolveClientId()` 就是
     `adapter.get<{key:string;value:string}>(STORES.META, META_KEYS.CLIENT_ID)` + `adapter.put(...)`，
     而 `DbAdapter` 本体是 `put(store, value: unknown, key?)` / `get<T>(store, key)`（`db.types.ts:164`），
     三套适配都吃得下 ⇒ **不需要为公共事实扩存储 API**，加 `META_KEYS` 两项即可。
   · 🔴 **拉取必须带外做**：`packages/domain/src/holidays.ts` 文件头把"让 `adjustmentOn()` 变 async"
     明确列为**已否证**的方案（理由写在那里："不确定"在日历上就是空白块 = 判据①要防的东西）。
     所以形状只能是 启动/回前台 fetch → 写 META → `installHolidayAdjustmentOverrides()` → 界面重算。
3. **`CalendarBoard` 的 `dayMarker?` 可选 prop**（默认值等于原值 ⇒ 消费者零改动）。
   ⚠️ **W6 落地时复用这条缝，不要另开注入点。**
4. **新门禁 `scripts/check-public-facts.mjs`** 并接进 `pnpm check`，判据四条：
   ①自托管拿不到数据时**不报错、不留空块**，且要在**真界面**跑一次（截图 + 人看）；
   ②`papers` 链接随数据入库并在后台回显；③非法日期 / `isOffDay` 非布尔 ⇒ 录入被拒（变异）；
   ④**接缝本身有判据**：有覆盖用覆盖 / 无覆盖退回随包 / 覆盖里日期非法 ⇒ **整年拒绝**，三条分支分别测。

缓存位置按 ADR-0052 §2.5：`STORES.META` / `META_KEYS`，**不进 op-log、不 bump `CURRENT_SCHEMA_VERSION`**。
迁移纪律（AGENTS §4）：一个文件一条语句、`CONCURRENTLY` 走可恢复形状、需 `ACCESS EXCLUSIVE` 的 DDL 自带
`SET LOCAL lock_timeout`、部署只走 `sh scripts/migrate-deploy.sh`、提交前 `node scripts/check-migrations.mjs`。

---

## 5. W6 的关闭判据：判过两次红、一次归零，归零那次已落地

> ✅ **04 02:5x 收口**：本节标题原来叫"W6 保持停放"。W6 已落地成 `e2def90f` ——
> 判据本体（"一条**没有截止日**的倒数日能上日历"）+ 四个档位 + 侧栏那颗点各有真 DOM 判据，
> 三层 14/8/13 passed + e2e 3 passed 五张图人看过 + 变异 5 臂逐臂只红自己那条。
> 原文留着，是因为**"停放"这个判定当时是对的**，而它对的方式就是下面这条命令。

```bash
cd "…/heyta" && git status --porcelain -- packages/ui/src/calendar apps/web/src/features/calendar \
  apps/mobile/src/screens/CalendarScreen.tsx | wc -l      # 归零才动；每次引用本条都要重跑这一行
```

🔴 **这条判据给的是活树瞬时读数，不是提交属性** —— 下面两段是当时的逐次现量，原样保留：
20:2x 非 0 ⇒ 停；23:0x 复量仍是 14 且**变宽**；04 02:3x 在 `608fa5b1` 把 main 搬进 batch2 之后**归零** ⇒ 落地。
**同一行命令六小时里给出三种答案**，所以"已归零/仍撞车"这类断言离开日期与载体就没有意义。

20:2x 现量的撞车代价：`calendar/model.ts` **+264/−7**（261→518 行，含一处 166 行整块插入）、
`CalendarBoard.tsx` +107、`CalendarScreen.tsx` +153。HEAD 与他们的版本里 `grep -c 'EVENT'` **都是 0**
⇒ 这条**没被别人顺带做掉**，等它归零后由我方落地（复用 §4 第 3 条的 `dayMarker` 缝）。

🔴 **23:0x 复量：没有归零，而且撞车面变宽了** —— 同一命令现量仍是 **14**，但里面**新增了 4 个未跟踪文件**：
`packages/ui/src/calendar/{CalendarDayBoard,CalendarViewTabs,CalendarYearBoard}.tsx` 与
`apps/web/src/features/calendar/{drag-day,useDragDayNav}.*` ⇒ 日历线正在做**日视图 / 年视图 / 拖拽**，
不是收尾中的余波。停放的判定继续成立。

⚠️ **给合流的人的一条硬提醒（原文保留，下面那段是它的结案）**：我方 `509a06cd` 与 `67fef701` 改的
`packages/ui/src/calendar/{model.ts,CalendarBoard.tsx}` 和 `apps/web/src/features/calendar/{CalendarView.tsx,store.ts}`
**逐个都在上面那 14 个里** ⇒ batch2 合回 main 时这四个文件必冲突。冲突解法不是二选一：
`model.ts` 里我方新增的是 `CalendarDayMarker` / `CalendarDayMarkerView` / `calendarDayMarkerView`，
`CalendarBoard.tsx` 里是 `dayMarker?` / `dayMarkerLabels?` 两个**可选** prop 与 DayCell 那一处渲染，
`store.ts` 里是 `publicFactsEpoch` + `bumpPublicFactsEpoch` —— **全部保住**，他们的新板子（日/年视图）
一旦也要标"休/班"，用的就是同一条缝（这正是 §4 第 3 条当初把它做成默认值等于原值的可选 prop 的理由）。

✅ **04 02:5x 结案：合流已经发生，四条锚点在 `origin/main` 上全部保住**。
载体是 `origin/main`（我的分支缺它身上 228 笔：`git rev-list --count HEAD..origin/main`；
它缺我这边的 5 笔：`git rev-list --count origin/main..HEAD`），命令现量：

```bash
cd "…/heyta-wt-batch2" && for spec in \
  "packages/ui/src/calendar/model.ts:calendarDayMarkerView" \
  "packages/ui/src/calendar/CalendarBoard.tsx:dayMarker" \
  "apps/web/src/features/calendar/store.ts:publicFactsEpoch" \
  "apps/web/src/features/calendar/CalendarView.tsx:publicFactsEpoch"; do
  f=${spec%%:*}; n=${spec##*:}; echo "origin/main $f 含 $n: $(git show origin/main:$f | grep -c "$n")"; done
```

读数 **1 / 14 / 4 / 2**。

🔴 **我在这条结案上先写错过一次，错在我的取证命令本身**：上面第一段我曾判成
"它是以**内容**而非**提交**的形式进去的，因为 `git log --oneline HEAD..origin/main | grep -E '509a06cd|67fef701'` 现量 0 行"。
那句 0 行是真的，**结论是假的** —— `HEAD..origin/main` 是**差集**，按定义不打印 HEAD 自己的祖先，
而那两笔本来就是 batch2 分支上的提交、合流后同时是 HEAD 与 `origin/main` 的祖先 ⇒
**这个命令结构上不可能打印出它们**，"合流已完成"这个最强的情形恰好给出 0 行。
换成逐笔判祖先现量：

```bash
for c in 509a06cd 67fef701 6735cc39 b05fbc50 e2def90f; do
  git merge-base --is-ancestor $c origin/main && echo "$c in origin/main=yes" || echo "$c in origin/main=no"; done
```

读数：**`509a06cd` / `67fef701` / `6735cc39` / `b05fbc50` 四笔全 yes**（W4b 服务端那两笔 + `dayMarker` 那条缝 + epoch，
**是以提交的形式进的 main**），只有 **`e2def90f`（今天 02:3x 落的 W6）no** —— 它还在上面那 5 笔里。
⇒ 结案改成：**缝四条全在、提交形式进的 main；缺的不是缝，是缝的那个消费者**
（"一条没有截止日的倒数日能上日历"这条行为还没进 main）。

📌 **可迁移的判据**：判"某笔提交在不在 X 里"只能用 `git merge-base --is-ancestor <c> X`，
不能用 `git log <A>..<B>` 的清单去 grep —— 后者是差集，对"两边共有"的提交恒不打印，
于是"已经合流"会被读成"从没存在过"。这是 §7"0 命中先查 needle 住在哪"的同族：
这里 needle 住的那个集合**根本不在扫的集合里**。

---

## 6. 收尾四项（计划 §8.3）—— 第 1 条的两半已在 22:0x 做完，读数在 §2.2

1. `pnpm -r typecheck && pnpm -r test` → **完整 `pnpm check`**。
   🔴 **`check:docs` 现在必然红：33 处**"本机有、仓库没跟踪"的死链，**全部落在并行会话的未跟踪文档上**
   （`docs/README.md` → `adr/0046`/`0047`/`0048`、`plans/trash-and-archive*`、`research/aed-implementation-evidence.md` 等）。
   **不吸收、不代改**（别人未跟踪的文件不该由我 `git add`）—— 正确处置是写成
   "缺口在哪一段、在谁手里"的现量。本批自己引入的死链：**0**（复核命令见 §8.3 第 1 条）。
   ⚠️ 死链数是别人未跟踪文档的**函数**，不是常量 —— 引用它必须带日期，我曾把"8 处"写成事实。
2. `node research/tools/docs-link-check.mjs` 带读数复核。
3. 界面结论必须截图且**人真的打开看过**；验收不抢前台（`HEYTA_NO_FOCUS=1` / `HEYTA_DESKTOP_NO_FOCUS=1`）。
4. `pnpm reinstall:all` 四端装上当前产物（AGENTS §6.1.1）；真机验收排最后，只用私有现场
   （隔离检出 + 私有 AVD + 私有 `PORT` + 私有库名）。**负载门等满 exit 3 = 环境无效，不是产品失败。**

⚠️ 沙箱里 `pnpm -r test` 跑不了 `@heyta/sync-server`（`prisma generate` EPERM）⇒
用 `pnpm -r --filter '!@heyta/sync-server' test` 复现那 2592 条，两者可比。

---

## 7. 工作区现场（20:5x 现量，接手前先重取）

- **主检出 `280` 个未提交条目**（`git status --porcelain | wc -l`）。正被并行会话整片重写的区域：
  `packages/ui/src/calendar/*`、`apps/web/src/features/calendar/*`、`apps/mobile/src/screens/CalendarScreen.tsx`、
  `server/src/*`（17 脏 + `causal-frontier` 未跟踪）、`packages/reminders/{notify,store,use-reminder-notifications}.ts`、
  `apps/mobile` 的 `AndroidManifest.xml` 与两个 `.plist`、`packages/legal/src/documents/third-parties.ts`、
  **`AGENTS.md`**、**`docs/reference/environment-traps.md`**、**`docs/README.md`**（+12/−1，6 个 hunk）。
- 🔴 **`AGENTS.md` 脏着 ⇒ §9 的同步欠着**（Goal 第 7 条要求每完成一项同步 §9）。
  不要在它脏的时候改它：`git commit --only AGENTS.md` 会把**别人未提交的 12 处**一起吸进我这笔提交。
- 🔴 **`docs/README.md` 脏着 ⇒ 本文的索引行没加**。要加的那一行原文如下，等它干净时补进
  handoff 那一组（`desktop-storage-host-handoff.md` 那行之后）：
  ```
  | [countdown-batch2-handoff.md](plans/countdown-batch2-handoff.md) | **交接：倒数纪念日批次二** —— 6 张闭合、3 条并行线未提交、合流时两条法务/ADR 义务 |
  ```
- 台账 `docs/reference/environment-traps.md`：工作树现量 `grep -cE '^[0-9]+\. '` ⇒ **197** 条（22:0x 重取；
  写过一次"196"几天后就漂了 —— **这类计数每次引用都要重取**）。
  计划 §3.5 里"待入 §7 的两条"正文已写好（`docs/plans/countdown-anniversary.md:675` 起），**编号按执行当时的现量取**，别按 HEAD。
  任务 #14：搬运 + 把 #168 改过去式（等该文件干净）。
- 其他在飞分支（**不属于本批，别并**）：`feat/detail-pane`、`feat/self-host-distribution`、
  `integrate/2026-10-03-closeout`、`feat/ai-entity-coverage`、`feat/assistant-history-local-persistence`、
  `fix/language-switcher`（顶部语言组件那条线，5 笔提交在 `heyta-wt-lang` @ `87b18975`，**未 merge**）。

---

## 8. 防重复踩：本轮被**现量否证**的六条我自己写下的断言

这些不是别人的错，是我先前写进文档/结论里的话。留原文形状是为了让下一轮认出同类错误：

1. **"W8 排后：同 W6，日历线未落地前不动 `CalendarScreen`"** —— 按"整条线在忙"推断。**否证**：W8 的落点
   （`shell/modules.ts`、`nav/TabBar.tsx`、四条 tab 计数测试）在 main 里逐个干净，web 半早已随 W5 落地。
   ⇒ **撞车的判据是同一文件的未提交 diff，不是"那条线很热"的印象。**
2. **"`packages/legal` 有 3 个文件脏 ⇒ 只登记不动"** —— 现量 **6 个**，而命中的那份
   (`documents/ai-and-transfer.ts`) **恰好不在脏集合里** ⇒ 改它零撞车。⇒ **脏清单每次都要重取。**
3. **"全仓 `server/src` 零 `ETag`/`Cache-Control`"** —— 是 **HEAD 读数**，且 W4b 分支已经加上了。
   ⇒ 写"某面全仓没有 X"要标明取的是 HEAD 还是活树。
4. **"`packages/app-host` 没有任何 `fetch(`"** —— 否证：5 处 `fetchImpl`（见 §4 第 2 条）。
   后果比"写错"更贵：它会让 W4b 去为一条**并不存在的边界**写 ADR 论证。
5. **"W9 已于 19:3x 完成"** 那个勾 —— 四十分钟后被另一会话的原生半重写，勾被就地作废（provenance 四条已留）。
6. **计划文档里我写的行号**（`holidays.ts:75/108/121/161` 一类）—— 取自**脏工作树**，HEAD 只有 261 行。
   ⇒ 锚点改按**符号**写，不按行号；行号必须带"哪一棵树"。

元规律：**"写对了再过期"是这类多人活树的常态**。凡是描述别人在飞状态的读数，
要么每次引用重取，要么把它**立成门禁**（本轮的产物就是 `check:legal-permissions` ——
L1 那条"前置闸门"从文档记忆变成常驻检查，踩响它的是 W9，不是 W7）。

---

## 9. 边界（任务书那 7 条在 §0.5；这里只记任务书之外的东西）

任务书那 7 条硬边界的**唯一事实源是本文 §0.5**（不在这里抄第二份 —— 抄件会漂，本仓库已经为此立过门禁）。
下面只记**任务书之外**、来自用户本人在对话里说过的长期指令与一条操作性推论：

- 用户长期指令仍然生效：**「真机收尾放到最后再做，先把代码工作全部做完」**、
  **「我们尽可能不要影响到现在的工作」**、**「不要再向我发任何的需求表单了，你直接做就行了」**
  （⇒ 长时段内一条问句都不要发）。汇报一律中文。「并行用 Agent 去解决」—— 能拆的独立块拆给子 Agent，
  但**共享资源（同一模拟器/同一构建目录/同一台账文件）必须先定所有者与运行窗口**（AGENTS §8 第 9 条）。
- 🔴 **`git commit --only 路径` 提交的是该路径的工作树内容**，会把别人在同一文件里未提交的行一起吸进我这笔提交。
  所以脏文件一律避让，改投单写者文档（本轮实例：根目录的 AGENTS 规则文件、`docs` 文档索引、
  环境陷阱台账 —— 三处的完整路径见 §7，都因此欠着）。
  复跑核对：`git diff --numstat -- 某个文件` 非 0 ⇒ 别 `--only` 它。
- Goal 未完成 ⇒ **不要 `update_goal complete`**；100 轮用尽会自动暂停，只有用户能 `/goal resume`。

---

## 10. 下一条会话的开场（可直接粘贴）

> 接着跑 Goal `1791011766720-0444bf`（倒数纪念日批次二**全部工单实现完成**）。
> 范畴、逐项状态与 7 条硬边界的**唯一入口**是 `docs/plans/countdown-batch2-handoff.md` §0.5 —— 先读它，
> 不要凭这份开场白施工。
>
> 接着跑 Goal `1791011766720-0444bf`（倒数纪念日批次二**全部工单实现完成**）。
> 范畴、逐项状态与 7 条硬边界的**唯一入口**是 `docs/plans/countdown-batch2-handoff.md` §0.5 —— 先读它，
> 不要凭这份开场白施工。
>
> 当前（22:0x，载体 = `feat/countdown-batch2` @ `509a06cd`）：§2.1 的挑配**已做完**（W4b 那 4 笔 =
> `a39f7fa6`→`2877dd37`，唯一相撞面按 union 解、两侧逐字保留）；合进来的东西**第一次跑了验证**，
> 读数与三条只能在本轮拿到的事实在 **§2.2**（那 19 枚红全是"判据读旧 dist"；服务端跑得起来，
> 原先那句"沙箱跑不了 sync-server"被否证；服务端照出一枚真红 = W2 欠的 `EVENT` 认领，已修）；
> §3.2 的 ADR 指针义务**已兑现**（现量 12 处不是 1 处，含两处引用了 ADR 里根本没有的话）；
> `check:public-facts` **已立并接进 `pnpm check`**（八臂 8 红 0 存活）；`CalendarBoard` 的 `dayMarker`
> **缝已开**（默认值等于原值，4 条判据 + 三臂变异全红）。
>
> 还差的，按依赖顺序：**(1) W4b 客户端拉取那半**（§4 第 2 件：照 `fetchImpl` 现成形状、公共事实**不带 token**、
> 落 `STORES.META`；⚠️ `packages/domain` 文件头把"让 `adjustmentOn` 变 async"列为**已否证**的方案 ⇒ 拉取必须带外做）
> → **(2) 宿主接线**（web 的接点 `apps/web/src/features/calendar/CalendarView.tsx:147`；主检出那一带仍 14 个脏文件）
> → **(3) 判据①在真界面跑一次**（截图 + 人真的看过）→ **(4) W7 设备出图那半** → **(5) W8 原生壳那半 + 壳级门禁**
> → **(6) 兑现 §3.1**（挂在 W9 原生投递上，另一条会话在做）→ **(7) §5 看 W6 归零没有** → **(8) §6 收尾**。
>
> **不 push、不 merge 进 main、不发问，直接做。**

