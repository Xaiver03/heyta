# 交接：产品体验线（本轮 UX 优化 Goal）

> 状态：**本轮目标五步都交完，且第四那步已重做到第六趟（r110，`REINSTALL_RC=0`；"四端各装的是哪一枚提交"见 §四 第 4 步那一行，它指向台账那张表 —— 趟号会随下一笔漂，所以这里不写）；图与判据同批入库；全部只在本地、未 push。**
> ⚠️ 10-15 06:0x 给"五步都交完"补一句它**不覆盖**什么：§四 末尾那几格是本线可自决、但**要设备或要真壳**的欠项（「拉起 ≠ 在前台」还剩 15 个开火点、21 处写死的 tab 坐标、windows 右栏标题疑似被截；第 18 格那条 mac 窗口图的成因已在 06:1x 量掉并结案）。**每格都带一条现量命令**；欠项枚数现量：`grep -c '^| 1[6-9] |' docs/plans/product-ux-optimization-handoff.md`。**"五步交完"不等于"设备腿与壳级取证没有欠项"。**
> ⚠️ 10-11 19:1x 增一条**本线自造并已自修**的红：整族 e2e 在窄屏那一档红三条，根子是共享装置 `switchView` 只认窄屏 rail 的「更多」面板那一段、不认它的常驻段（产品一行没动）。修完复跑绿，成因/两版修法/读数在台账「窄屏那一档的「更多」换了形状」那一串格子。**它不改 §四 任何一行的归属**，只把「8/19 基线」那一格拆成两半读：工作树上跑过了，干净树上还是没有。（2026-10-11 19:1x 更新）
> 🔴 **10-12 00:4x 本线第一次动产品源码（本轮前 20 多笔全是文档与验收装置）**：修掉「窄屏底部导航第 7 枚（同步状态）被画到视口外、还与通知重叠 21px」那格登记过的在案缺陷（`59c23f40`）。两层：`narrow.css` 把收缩从外层格子落到按钮与标签自身；窄屏那一枚显示稳定的控制名而**整句状态一字不少地留在 `aria-label` 与 live region**（量出来那一档给文字的只有 34px = 两个汉字，整句必然截成「登…」）。新增常驻判据 `e2e/tests/narrow-rail-geometry.spec.ts`（进 `check:ai-e2e` 那一族），两条变异臂各红一次。根因、看图照出的第二层、边界（含一枚**不是本线造成**的 `shell-sync-rail` S3 红与其现量方法）都在台账「窄屏底部导航第 7 枚」那一格下面三子格。
> ⚠️ 给下一位的口径提醒：那一格登记时写着"归属不在本线"，那是**瞬时前提**（别线那批在飞文件 10-10 18:49 已落进 `HEAD` 且逐枚 clean）。凡读到"归别人"的一格，先按它自己写的重量命令重取一次再决定动不动。
> 🔴 **10-13 04:1x 给第一句"五步都交完"补一条边界，别按字面读成"四端仍等于当前产物"**：第 4 步那张表是**逐行 pin 提交**的，而 04:0x 详情面那笔 merge（`4c97b9de`）把 6 枚进包文件带进了 HEAD ⇒ 那句"等价"对四行**同时过期**。现量命令、第五趟的固定顺序（含 `HEYTA_REINSTALL_TMP_DIR` 要先 `mkdir` 那个 RC=4 坑）与本线代拍的理由（排在树冻住之后，不在本轮）都在台账 `04:1x` 那一格。
> ⚠️ 同格还有一条载体事实：今晚设备腿用的隔离副本 `../heyta-wt-r99` **已被别的会话清走**，所以 `--apk ../heyta-wt-r99/…` 那串**不可复跑**；可复跑的是各 `journey.json` 里记下的 `artifact.sha256`。
> 本文件只记「现在停在哪、下一步按什么顺序做、哪些手别再碰」。
> 🔴 **逐格读数与判据形状的事实源**是 [`product-ux-optimization.md`](product-ux-optimization.md) 文末那一串台账格子
> （取最新几格：`tail -60 docs/plans/product-ux-optimization.md`）。这里**不复制数字** —— 抄件一定会漂。

---

## 一、原始目标（别重新定位、别缩范围）

完成 UX 优化计划本轮剩余未完成项（同步与隐私 / 数据管理 / 提醒状态 / 原生小组件环境识别 /
个人资料·账号·AI·帮助的剩余交互回归），文档逐项收口，实际验收深浅主题与各端交互，
**并从最终源码四端构建重装**，诚实记录验证边界。接手顺序原定五步：#38 页眉判据的牙 → #1 Android 设备腿 →
#30 剩余步骤与 #27/#34 壳级窗口取证 → `pnpm reinstall:all` 四端重装 → #25/#26/#29/#31/#35 逐项确认归属。

两条**负责人指令**都要延续：
- 2026-10-10 07:4x：可以占用设备与共享载体做验收，不必逐项回问。
- 2026-10-10 夜：**不要再发任何申请表单、确认表单，不要触发任何需要他交付的东西**（包括会弹"批准"的动作）。
  ⇒ 汇报里不许有"需要你做的"那张表、不许以问句收尾；卡住的格一律写成**「这一格在谁手里 + 一条现量复现命令」**。
  ⇒ 与「关闭 Goal 必须先请示」相撞时的解法是**保持 goal 开着**（到点让系统自动暂停），不是发明一句问话。

---

## 二、本轮已交（一格一句话，出处指向事实源）

| 步 | 结果 | 读数与取证 |
|---|---|---|
| #38 页眉判据的牙 | ✅ 从"1440 恒假"换成"种下去确实生效"的生效断言，两头都能红 | 台账「#38」那格 + `scripts/verify-web-ui-sweep.mjs` 落点 `apps/web/evidence/<趟号>/` |
| #1 Android 设备腿 | ✅ **两半都有当前产物的读数**：中文/英文各一趟（r85/r86，APK 与设备上那份哈希逐字相同），加上 10-15 05:0x 那条**完整 habits 旅程在真机上绿**（第四趟 `LEG_RC=0`，装的是当前 HEAD 重打的包，没用 `HEYTA_ALLOW_STALE_APK`）| `apps/mobile/evidence/profile-center/android-r85-currentproduct/`、`android-r86-currentproduct-en/`、`android-r109-habits-leg/`（含 `leg-attempt4-green.txt` 与两张人看过的图）|
| #30 三形态 | ✅ "命中/跳过/没命中"三种形状各有各的设备读数，不再同形 | 台账「#30 关掉」那格；iOS 那五张在 `apps/mobile/evidence/profile-center/ios-r78-currentproduct/` |
| #27 macOS 空窗定性 | ✅ **不再是"间歇未裁决"**：同实例、同瞬间两张分读第三次量到（r110：窗口那张 content 0.0%／`looksBlank=true`，壳自己 `takeSnapshot` 那张 74.6%／主蓝 997）⇒ 装出来的壳画了，缺的是窗口服务器那张里的 WebView 层。判据一直数的是快照，**没有一行判据依赖窗口图** | 台账「2026-10-15 05:3x」那一格（含三张表的逐枚读数与现量命令，末尾那张**两轴表**把"窗口图为什么有时像空窗"讲死了）。✅ `check:macos-window` 本机实跑 **RC=0**，它自己那张窗口图人已看：**近白空窗 + 三个红绿灯点 + 底部一行诊断标签**，`内容 5.4%` ⇒ 那条 `looksBlank` 的绿是壳自己的 `webNote` 托着的，**不是应用**（所以它判的是"壳连自己的标签都没画"，不是"UI 画出来了"）|
| #34 探针改进 | ✅ 两枚：按 pid 锁死寻址 + 窗口数为 0 时分辨两种成因；顺带去掉一处会冷启动 Safari 抢焦点的写法 | `scripts/qa/macos-installed-widget-help.sh`，提交 `630fb57e` `1f00bb59` |
| #34 壳级两格 | ✅ **闭了**（后台诊断链，零前台激活、零录屏权限） | 提交 `91c6da3a`；读数 `apps/desktop-macos/evidence/widget-help-dom-20261011-r92.txt`；复跑 `bash scripts/verify-macos-widget-help.sh` |
| 第 4 步 四端重装 | ✅ **第六趟（r110）跑完，`REINSTALL_RC=0`**，而且是**本线第一次带着"真的会进包的产品改动"跑**（载体 `../heyta-wt-r110` @ `fd5c2fb1`、起跑 `dirty=0`、`load1=42.18` 没调阈值）。第五趟 r108（`769e6258`）那批读数仍在库。⚠️ r110 的三处偏离必须一起读：**ios 那腿被 `pod install` 改了一行 `Podfile.lock`**、**四端跑出来全是浅色**（"深浅两档都装过"仍不成立）、与 `fd5c2fb1` 的差集是 3 枚非构建输入的台账件 | 台账「2026-10-15 05:5x」那一格；证据包 [`apps/web/evidence/ux-final-20261015/reinstall-r110/`](../../apps/web/evidence/ux-final-20261015/reinstall-r110/RESULT.md)（逐端判据 + 五张人看过的图 + 包内名册）。🔴 全部**不证 `origin/main`**（本地未 push）、**不证小组件卡片在桌面里换了字**。🔴 **10-16 15:3x 第八趟没跑，因为现量证明"跑了也不会改变被测物"**：`git diff --name-only fd5c2fb1..HEAD -- packages apps/mobile/android apps/mobile/src apps/desktop-macos apps/desktop-windows/src apps/desktop-windows/app apps/web/src apps/web/app server/src`⇒ **枚数 0**（同一件事的另一种问法也现量过：`git log --name-only --format= fd5c2fb1..HEAD` 里碰这些路径的提交 **0 枚**，`fd5c2fb1` 是 `HEAD` 的祖先 yes）。也就是说 r110 那一趟装上四端的**打包输入源码**逐字等于当前 HEAD，再跑一趟只能换一枚"由本线命名的载体出处"，换不掉任何一端的被测物。⚠️ 这条差集**只覆盖 git 跟踪的打包源码**：它不证"产物字节等于用 HEAD 重建的字节"（构建工具链、`bridge-bundle/` 与 `Generated/HeytaTokens.swift` 那两枚派生输入、lockfile 之外的隐式输入都不在这把尺的范围里），也不证装机态那枚包就是 r110 那一趟的产物 ——Android 那端磁盘上现在这枚是**别线 10-15 13:39 那一趟**装进去的（`lastUpdateTime` 现量），本线没核过它的载体。⇒ 判据形状：**"要不要再跑一趟重装"先算打包输入差集，别按"距离上一次过了几天"排**（同一族见环境陷阱 #171/#178） |

| 逃生门那一格（§8.2 前提） | ✅ **macOS 半已有真壳读数**（r96 关臂 + r97 默认臂配对，两臂都 `DIRTY_PATHS=clean`）：门关掉后 `storagePort` 与 `heytaStorage` 双双为 false，而 `heytaWidget` 仍在 ⇒ 面板仍是原生形状、0 行安装引导 | 台账「逃生门关掉后还认得壳」那格；两臂各一条命令：`HEYTA_SHELL_STORAGE=0 …` 与去掉前缀的同一句。⚠️ **Windows 真实 WebView2 那一半仍开**（那条 e2e 注入的是合成信号） |
| 第 5 步 归属对账 | ✅ #26/#29/#31 已闭合、#28 留口径、#39 归 inbound-core；🔴 **#35 那句"归 apps/web 在飞那批"已被 10-13 05:1x 的现量取代**（那批落地后按台账指定动作闭合，见第五节第 4 行），第 5 步到这里**没有"仍挂在别人未提交批次上"的欠项** | 台账「第 5 步跑完」「check:image-license」「W5 那格 05:1x 闭合」三格 |

本线那一轮的九笔（都已在 `main` 上，未 push）：
`630fb57e` `1f00bb59` `ce9af5ba` `c4c18f33` `6ff22289` `0d377b2c` `fee660cc` `5a6e593c` `f9c02443`。

---

## 三、当前状态（每次接手先跑这一组现量）

```bash
git -C heyta rev-parse --short HEAD                     # 主检出在动，别照抄本文件写过的任何 SHA
git -C heyta rev-list --count origin/main..HEAD         # 本地领先 origin 多少枚（绝大多数是别线的笔）
git -C heyta status --porcelain | head -30              # 别人的在飞文件——本线不代提交
ps -eo pid,etime,command | grep -E 'reinstall-all\.sh|b-window-keeper' | grep -v grep   # 有人在做同一件事就别起
xcrun simctl list devices booted                        # 现在有几台模拟器、分别是谁的
adb devices                                             # emulator-5554 在不在
df -h /System/Volumes/Data                              # 要不要新开一棵载体
```

⚠️ **本轮量到的形状，写给下一个人省一趟**：
- 主检出**每十几分钟就被别的会话提交一次**，`HEAD` 是移动靶。任何"四端产物"读数必须带**跑的那一棵树 + 那个 commit**。
- 四端批次**两批载体不同，别混读**：r77/r87 跑在隔离载体 `../heyta-wt-reinstall`（只含已提交内容），
  **r93 跑在主检出的工作树上**（`HEAD` + 别线未提交路径），落点是私有目录 `HEYTA_REINSTALL_TMP_DIR` ⇒
  r93 **没有**碰那棵隔离载体，也就没有和 `research/tools/b-window-keeper.sh` 的默认 CARRIER 撞（动那棵之前仍要先 `pgrep -f b-window-keeper`）。
  代价写在台账里：r93 的读数不证"干净检出可复现"。
- 已启动的模拟器有**两棵**：本线那台 `heyta-iphone-17pro`，和别线的 `heyta-ios-isolated`。
  `reinstall-all.sh` 的 ios 段按**名字**选，不会误伤另一台，但**别去动别线那台**。

---

## 四、还欠什么、卡在谁

| # | 欠的那一格 | 在谁手里 | 一条复现/闭合命令 |
|---|---|---|---|
| 1 | ~~iOS 重装后的首屏图~~ ✅ **已补回**（r87：`apps/mobile/evidence/reinstall-20261011-1230-ios-installed.png` + 同戳 `.txt`，两侧 sha256 对过、人看过） | 已闭合 | 重跑：`HEYTA_REINSTALL_TMP_DIR=<私有目录> IOS_DEVICE_NAME=heyta-iphone-17pro bash scripts/reinstall-all.sh --only ios` |
| 2 | #34 macOS 壳级：✅ **两样都闭了**（10-11 14:5x `91c6da3a`，后台、零前台激活）——壳新增 `HEYTA_WIDGET_HELP_PROBE=1` 那条 `runWidgetJourneyChain`，装置 `scripts/verify-macos-widget-help.sh`，判据 `scripts/qa/macos-widget-help-judge.mjs`；**只剩一小格**：浏览器里是否真的渲染出那一页（诊断模式故意不叫 `NSWorkspace.open`，那会抢前台） | 🔴 **那一小格 10-13 01:0x 已闭，且不在负责人手里**：`AGENTS §6.2 规定二` 第 71–74 行（负责人 09-29 拍的）本来就要求 Web UI 默认用**无头外接浏览器**，帮助中心是 Web UI ⇒ 新判据 `e2e/live-site/live-help-link.spec.ts` 零前台把它判了（九条判据 + 四臂判假集合，读数 `apps/web/evidence/help-link-render-1013/`）。**只剩的窄声称**：macOS 上"真的调用了 `NSWorkspace.open`"那一步仍未观测（那才需要前台激活） | 复跑闭合的那两样：`bash scripts/verify-macos-widget-help.sh`（读数自带出处；判据侧另有 `node scripts/qa/macos-widget-help-judge.mjs --self-test`）。复跑渲染那一格：`cd e2e && NO_COLOR=1 npx playwright test --config playwright.live-site.config.ts live-help-link.spec.ts` |
| 3 | #28 定位符门按 pair 还是按 OR-set | **负责人一句话**（判据口径，按边界不代改） | `pnpm check:locator-labels` 现量它现在判的是哪种 |
| 4 | ~~#35 `check:shell-surfaces` 的 W5 产物比源码旧~~ ✅ **10-13 05:1x 按台账那一格自己指定的动作闭合**：那批（协作 web 宿主 `a923f7fa` 等）已落地、`RailNavigation.tsx` 不在 `git status` 里，随后 `NO_COLOR=1 pnpm --dir apps/web build` ⇒ **rc=0**，紧接着 `NO_COLOR=1 pnpm check:shell-surfaces` ⇒ **rc=0**。**没有代改任何人在飞的文件** | **无（已闭合）** | `NO_COLOR=1 pnpm check:shell-surfaces`。⚠️ 那句绿只说**通道在**，不说装出来的包里有什么 —— 3 栏桌面取证那格在第四节四端重装里 |
| 5 | #39 `check:image-license` rc=1（`@noble/hashes` 一处钉死、一处范围） | **`packages/inbound-core` 的所有者**（或运营侧统一 `resolutions`） | `pnpm check:image-license`；两枚声明的现量：`grep -n '@noble/hashes' packages/inbound-core/package.json packages/sync-core/package.json` |
| 6 | r93 当场量到的红：`check:integration-coverage` rc=1 —— 一枚已提交的集成 spec 没被任何入口点名 | **自动收集 / inbound 那一线**（`0eea4c0f` 带进来的那枚） | `pnpm check:integration-coverage`；现量：`grep -c 'inbound-dual-host' server/package.json`（0）对 `node scripts/check-integration-coverage.mjs` 点名的那一行 |
| 7 | ~~`check:verify-script-copy` rc=1，两枚本线欠针~~ ✅ **10-13 19:5x 本线那两处（①②）连同门扫不到的第四处一起换完**：三处现在钉的是 `mobile.profile.sync.notConfigured` 的**当前值**，门 `SUMMARY … 缺失=1`（3→1），剩下的那枚是 `scripts/verify-mobile-ai.sh:1666 "AI 只给建议"` | ③ 托管AI/对外披露那一线（`c8f63370` 改的是语义，**判据口径不代改**）；①②④ 本线已了结 | `NO_COLOR=1 pnpm check:verify-script-copy`。🔴 **上面那一版给的"别直接换新串"的理由要按状态重读**：那句 `notConfigured` 不是"根本不渲染"，而是**只在 `advancedSync && !form.configured` 时渲染**（`SettingsScreen.tsx:515-520` 的 `syncStatusVisible` 决定了外面那层 `syncStatus` 画不画，`ProfileScreen.tsx:1099-1103` 再按 `!form.configured` 决定这句画不画）⇒ r107 那次读到的「登录 heyta 后，任务会自动在设备间同步…」是**同一张卡的另一代文案**（未点开自托管时的那一面），两句都对，只是取读数的状态不同。断言点在"表单开着 + 凭据填过"，所以"这句应当消失"是真的在判事；正对照现量见下一行那格 |
| 8 | ✅ **10-11 20:3x 本线欠的这一格闭合**：干净检出那一档的读数取到了（r102 install + 全量 build、r103 那八枚整族 20 条全绿、r104 三端 + r105 iOS 段四端重装），载体是一棵 `dirty=0` 的隔离检出、`HEAD=3e34ce98`（含本线那笔装置修复 `ff2efe5b`）。🔴 **它不证 `origin/main`**（本地未 push），也不证 `check:ai-e2e` 整族 | **无（已闭合）** | 台账「r102」「r103」「r104」「r105」那四格；四端包 [`apps/web/evidence/clean-carrier-reinstall-20261011/RESULT.md`](../../apps/web/evidence/clean-carrier-reinstall-20261011/RESULT.md) |
| 9 | ~~windows 那一端装的是上一趟的包~~ ✅ **10-13 02:5x 本线自己跑掉了**（`WIN_RC=0`，载体 `25f7bef5` 只含已提交内容，远端 tar sha 逐字对账 + 判据 5 条全在位 + 图人眼看过）。⚠️ 本格原先那句"成本与信息量不成比例"站不住 —— 负责人 10-10 已一次性授权占用共享载体，那是**我能做而没做**，不是等他拍 | **无（已闭合）** | 台账「windows 那一腿也跑了」那格；证据包 `apps/web/evidence/ux-final-20261012/reinstall-r103-windows/`。🔴 四端仍**不证 `origin/main`**（本地未 push） |

| 10 | ~~`values/` 与 `values-en/` 的 `widget_*` 键集合没有一枚门在对账~~ ✅ **10-13 04:0x 已落**：`scripts/check-android-widget-copy-parity.mjs` + `pnpm check:android-widget-copy-parity`，接在 `check` 链第 24/107 段（`check:widgets` 之后）。三条注入臂实测都能红（A 缺键 / B 英文表抄成中文 / C 两表摘空 ⇒ 分母），真树 RC=0，`check:gate-wiring` RC=0 | **无（已闭合）** | 它等的只有"哪条 `check` 链算数"—— 现量根 `package.json` 顶层重复键 = `[]`，那条担心已经不成立。落法与两处口径（为什么不并进 `check:ui-language`、门名为什么不是 `widget-locale-parity`）在台账 02:1x 那格的追认行 |
| 11 | ⚠️ **趟号撞了**：本线 10-13 那三趟用了 `r100/r101/r102`，而上面第 8 格 10-11 那趟也叫过 `r102`（install）。**目录能分开**（`apps/web/evidence/ux-final-20261011/` vs `…-20261012/`），但散文里裸写"r102"会指错。以后要么带日期段，要么换号段 | 本线（下一趟起） | 现量：`ls apps/web/evidence \| grep ux-final` |
| 12 | ~~UX-S9-97「大字体仍待专项验收」~~ ✅ **10-13 03:1x 跑完，结论是没有遮挡**：`font_scale 1.3` 下那枚判据先读 false，而 false 出自旅程探针自己滚不动（nudge 锚在入口中心 y=2210，落进底栏带 `[2169,2337]`）；独立探针一根滑动即达，`1.0` 未滚时同样在带外 ⇒ "要滚一下"两档共有。旅程的 nudge 已改锚内容区并把"滚不动"抛成另一种失败，`artifact_identity()` 加了 `--apk`（隔离载体装的包不在本树）| **无（已闭合）** | 台账 §8 末格；证据 `apps/mobile/evidence/profile-center/android-r104-font13/`（含 `scroll-probe.py` 与两档 JSON）、`…/android-r105-font13/`、`…/android-r105-font10/`。⚠️ 射程只有一台 1080×2400 模拟器与 1.3 一档。⚠️ **第 13 格把这格的成因数量改了**：假红有两个开火点，这格当时只修了 nudge 那一个 |
| 13 | ~~旅程探针"在树里"当成"点得到"这一族只剩一处已修~~ ✅ **10-13 04:3x 整族查过分母并修完第二处**：`scroll_to`（判据是标签在 uiautomator 树里，被裁节点照样带 `content-desc` ⇒ 一次不滚就返回）与 `tap`（坐标取节点自身中心，被裁时手势交给底栏）两处都在 `scripts/qa/profile-settings-android.py`；新增 `tab_band_top(root)` 后二者都以"矩形可见且中心在带上方"为到达判据。同族另外三枚（`tasks-ux-android.py:145/:341`、`ai-assistant-atomic-android.py:290`、`tasks-ux-ios.py:195-232`）滑动起点是屏幕分数，不带这个形状 ⇒ 不是欠项 | **无（已闭合）**；未穷尽的是**浮层遮挡**（守卫只挡"中心落进底栏带"，那种要像素层证据） | 牙：`android-r107-tapprobe/tap-guard.py` RC=0（在 1.3 冷启动那帧开火，`predicate_matches_source=true` 防夹具漂移）；两腿复跑 RC=0（载体换回主检出 `b731fd26…`，`uiLocale` 装置自标 `zh-CN`）。⚠️ 同一小时里设备被别的会话共用，落了一枚外来的 `android-r99-fixed/`（`uiLocale=en`，属 `dfeacee3` 语言开关那一线）—— 本线不代提交、不删 |
| 14 | ~~窄屏从 rail「帮助」进设置，当前分类画在导航可视窗口外（选中态等于白给）~~ ✅ **10-13 04:5x 产品代码改完**，并在 05:0x **按"一类不是一个"把同一族扫完、修掉第二处**（"换一档 ⇒ 浮层回到顶部"同样只挂在 `onSelect` 上；可达性由三行 z-index 现量给出：助手浮层 400 > 设置浮层 200 ⇒ 设置开着时那颗「去授权」点得到）。两处的改法同形：从点击处理器挪成 `activeSettingsSection` 的 effect（一份规则、四条路共用；台账当年写的"本线不代改"的前置条件已消失——两栏 IA 现在在 HEAD 里，现量 `git show HEAD:apps/web/src/App.tsx \| grep -c activeSettingsSection` = 16） | 剩后半句：**可见的"还能滚"提示**没做（要新 token + 那是两栏 IA 那一线的样式；主症状已消，降级成美观问题）。第二处的**真浏览器**场景没跑（要先造 AI 授权态），依据是 jsdom 记录 + z-index 现量 | 两头有牙：`apps/web/tests/settings-nav-reveal.spec.tsx` 5/5 绿，且**不对称读数**取到了 —— 换回上一笔 `App.tsx` 后"程序化换档回顶部"红（`本趟滚到的：[]`）而"点导航回顶部"绿，换完按 sha 还原。几何判据钉进 `e2e/tests/help-entry-ux.spec.ts`，红臂读到 `窗口 x=0..315 / 当前项 x=630.625..736.625`。⚠️ 连带：effect 一挂上，jsdom 里任何打开过设置的用例都崩（**8 枚文件 / 34 条**），已按 `apps/web/tests/setup.ts` 自己的规矩补成"jsdom 补齐之四"（`scrollIntoView` + `scrollTo`），**没有**把宿主代码改成可选调用。全量 `pnpm --dir apps/web test` = 2293 passed / **1 failed**（那枚是别线已登记的 `ai-disclosure-parity`），`typecheck` rc=0 |
| 15 | ~~设备腿在设置面停在目录层~~ ✅ **10-13 19:5x 一族三处一并修完**：`6d868af0` 给设置面加了分组目录（`settings-directory` + 每组一行 `settings-section-<key>`），而导航代码还按"点设置就直接找内容"写 —— 共用 `configure_sync_credentials` 的 **20+ 份**腿、`verify-mobile-ai.sh` 的 AI 设置区块、`verify-mobile-account-email-sessions.sh` 的「更换登录邮箱」三处，全部停在目录层 | **本线的债**（目录层是本线那一刀加的，lib 最后一次动是 10-06），已修完 | 四臂现量在 `apps/mobile/evidence/profile-center/android-r108-syncneedle/`：`ab-before.txt`＝入库那版**四枚红 + 一条恒真的"已配置"**（缺席断言在目录层空转），`ab-after-nav-only.txt`＝补进组后仍缺两枚（折叠线以下的输入框**整枚不在树里** ⇒ 裸 `xy_edit` 拿不到可点坐标），`ab-final.txt`＝最终代码**冷启动整条路 5✅0❌**，`ab-sections.txt`＝五组各按组内独有 testID 落对 + `close_settings_sheet` 每趟关得掉。🔴 第三条成因要记住：`handleRequestClose` 让**一发返回只退到目录**，"按了返回=面关了"这种前提在好几条腿里都成立不了 |
| 16 | 「拉起 ≠ 在前台」这一族**还剩 15 个开火点**：15 份脚本自己写 `adb shell monkey … ; sleep 6` 然后直接往下点，**没有一处**调用 `ensure_app_foreground`（r110 的 android 段日志当场撞上：`⚠️ monkey 之后前台不是 com.heyta`） | **各腿脚本的所有者**（inbox / lists / tags / timeline / task-row / sort-sheet / schedule / capture / account* / repeat-custom / ticktick-import）。本线不代改：**运行时形状不等**（加一次前台判定就是改行为），"代改别线要三条齐"过不了第二条 | 分母现量：`grep -rln 'shell monkey -p' scripts/verify-mobile-*.sh scripts/reinstall-all.sh \| grep -v '\.snap\.'`。可抄的兜底形状在 `scripts/reinstall-all.sh` 的 android 段（`am start -W` + 读 `mCurrentFocus`）与 `scripts/lib/mobile-e2e.sh` 的 `ensure_app_foreground`（现已"拉一次→再看一眼"四圈，红会报出来） |
| 17 | ✅ **10-15 06:3x 量掉，裁决是"两枚都不是缺陷"**：真模拟器上 dump 到底栏五枚 bounds，「我的」= `[864,2169][1080,2337]`，几何中心 (972,2253)；`945` 距左沿 81px、在同一个节点内 ⇒ 那 21 处点击**全部打中同一枚节点**，换常数不改变行为 ⇒ **不 bulk-edit 那 9 份脚本**（一份今天刚被别的会话动过，其余分属注册登录/数据管理两线，零行为收益的跨线改动只有漂移风险）。同一次 dump 还量到：同意面板与欢迎页立着时**底部 tab 栏整条不在无障碍树里**——而这条**早有门在守**（`scripts/check-mobile-first-run-gate.mjs` 文件头就是这句话），不是新缺口 | 本线（已了结） | 三态表与五枚 bounds 在台账「2026-10-15 06:3x」那一格。分母现量：`grep -rn 'input tap 945 2253' scripts/verify-mobile-*.sh \| grep -v '\.snap\.'` 与 `grep -n 'TAB_PROFILE=' scripts/verify-mobile-calendar.sh`。真要把坐标换掉，改法是走 lib 的 desc 定位（`open_settings_section` 那条），不是统一常数 |
| 20 | 在案红（**本线自造**，10-15 已修）：`check:mobile-first-run-gate` 从 2026-10-12 起 RC=1，唯一 offender 是本线 `c018ec0e` 新建的 `scripts/verify-mobile-organizer-confirm.sh` —— 它把隐私处置写成内联 env 前缀那一形（`VAR=x helper`），而门的 `callsFunction()` 是**行首**匹配 ⇒ 读成"没走到共享处置" | 本线（已了结，**判据口径一个字没动** —— 那枚门归注册登录线） | 复跑 `NO_COLOR=1 node scripts/check-mobile-first-run-gate.mjs` ⇒ RC=0。两头有牙：臂 E 删行首调用 ⇒ 红且指名本脚本；臂 F 还原成内联旧形 ⇒ 同样红（证这枚红是形状而非别的原因）。同类分母（内联前缀写法全仓只此一处）在那一格里现量。⚠️ 这枚红在 `pnpm check` 大链里而**重装链不含它**，所以别把"六趟重装绿"读成"`pnpm check` 绿" |
| 18 | ~~`check:macos-window` 那条对**窗口图**打的 `looksBlank` 的绿是靠什么托着~~ ✅ **10-15 06:1x 量掉了，且不改口径**：那条门本机实跑 **RC=0**，它当场那张窗口图是 `2240x1440 / 内容 5.4% / 色阶差 196`，**人打开看过 = 近白空窗 + 三个红绿灯点 + 底部一行 `M2-macOS ✅ …` 诊断标签**（没有应用）。⇒ 托着它的是**壳自己那行 `webNote`**；而打包 `.app` 那一跑 `webNote` 为空 ⇒ 同一把尺读到 `0.0% / looksBlank=true`。所以"macOS 窗口图间歇空白"要拆成**两条轴**读（裸可执行文件＝从不合成、有标签托着；打包＝真的会换），两轴上都没有判据依赖窗口图 | 本线（已了结） | 复跑：`NO_COLOR=1 pnpm check:macos-window`（读数在台账「2026-10-15 05:3x」那一格末尾的两轴表）。⚠️ 别拿 r77 那格的 `contentRatio=1` 与今夜的 `0.0%` 比大小 —— 那两枚数**没连着同一条命令**，不可比 |
| 19 | ✅ **10-15 06:5x 裁掉、07:5x 在 Windows 上验完：界面没有截，是取证图少了右边一块。** 同一份源码在无头浏览器 1152/1280/1440 三档量：`docScrollWidth == innerWidth`、横向溢出元素数 **0**、标题「对话助手」x=844→915（右侧还有 237px 余量）；而旧装机图里同一枚标题墨迹在 x=1051→1151。差的来源不在界面：抓取进程没声明 DPI 感知，`GetWindowRect` 与 `CopyFromScreen` 互相自洽但只覆盖窗口左上角 ⇒ 旧 png 是真实窗口的**裁切**。**r111 现量已修**：`WINDOW_DPI=96 DPI_CTX=True`、`WINDOW_RECT=1440x734`、png 实测 (1440, 734) 逐字相等，标题完整可读 | 本线（已了结；机制归属在 10-16 00:3x 量清） | 证据包 `apps/web/evidence/ux-final-20261015/reinstall-r111/`（`RESULT.md` 有两条判据的读数，以及那枚"125% 缩放"归因**翻了两个来回的全过程**：我先前写"打包机 125% 缩放"，被 r111 的 `GetDpiForWindow=96` 判成不成立，而 00:3x 现量注册表 `AppliedDPI=120` = 96×1.25 ⇒ **125% 那句其实是对的**，那枚 96 量的是取证进程自己会话的桌面（那张是 `WinDisc 1024x768 @96`），不是窗口那张 🔴 读法边界：**别用 `WINDOW_DPI` 推用户机器的缩放**）。🔴 连带推论已立案到环境陷阱末条：**常规路径抓过的每张 windows 装机图都少右边约 20%**，按它们判过"右侧是否被截"的格子要重看。另：这张图右缘还贴着一枚**不属于本应用**的红色小标签 —— 抓取是按窗口矩形抓屏幕区域，压在那块屏幕上的 toast 会进图（r110 左上角那枚「部署探… Pro」同族），读图时带着这条 |
| 21 | ✅ **10-16 00:5x 装机态 Android 四枚组件的明暗复验做完了（台账 912 那一行的前半句）**：10-08/10-09 那两轮复验**都在复用早已绑好的桌面实例**（它们的 RESULT 自己写着「未重新添加实例」），而 10-15 13:39 那趟四端重装把 APK 卸载重装 ⇒ `dumpsys appwidget` 现量 `widgets.size=0` —— 当前包的四组件在 00:4x 之前**一张图都没有**。这一趟逐枚从系统微件面板真的拖到桌面、各取亮/暗两档：四枚 provider 逐个对上（`Habits`/`Focus`/`Today`/`Quadrant`），卡内底色亮 `(255,255,255)`／暗 `(13,21,38)`，逐枚等于 `values/`＋`values-night/` 那对生成 token（`#FFFFFFFF`/`#FF0D1526`）；两张四合一对照表都人眼看过 | 本线（前半句闭合；后半句「其它模板填入非空真实数据」+ 括号里的「四枚同时在场」**也已闭合**，见下面第 22 格 —— 本趟那四枚确实都是 `0/0`／空态，那句话照旧成立） | 证据包 `apps/mobile/evidence/ux-final-20261015/android-widget-pair-r112/`（`RESULT.md` 有跑法、判据两条、以及这趟照出来的两条装置事实：① 模拟器桌面一页放不下两枚 3×2，而 Launcher 对被拒落点**什么都不做**（不挪页不报错）⇒ 只能逐枚绑＋逐枚收；② 收掉走启动器自己那张表 `content delete` 本趟新增的 `_id` + `am force-stop`，只删自己新建的那一行）。⚠️ 装置两处毛病当场认：`cell_of` 第一版把"下方任意说明行"配给第一格 ⇒ 第三枚绑成了 `Habits`，被"provider 只认 `Widgets:` 段"那条判据拦下并响亮失败（`Providers:` 段把四枚全列出来，拿它判会永远为真）；`matrix.json` 是两趟合并的（脚本原先整份覆盖，吃掉过前两枚的记录） |
| 22 | ✅ **10-16 04:0x 台账 912 那行的后半句与括号里那半句都做完了：装机态四枚 Android 组件「填入非空真实数据」+「四枚同时在场」**。数据全走应用自己的界面造（4 条任务分别铺满四象限四个桶 + 1 条习惯 + 一轮专注），一个字节没往 app 存储里写 —— 手写会绕开 `planWidgetPublish` 那条密封链。读数：逐枚绑时四枚分别命中 `专注中`／`○ L114UrgentImportant`+`○ L114Urgent`（表头 `2026-10-16 · 0/2`）／四象限四条**各自落对桶**／`○ L114Habit`，r112 那批空态串一枚不剩；`simult` 档四枚同时绑住（`dumpsys appwidget` 的 `Widgets:` 段 `widgets.size=4` + 四个不同 provider），亮/暗两档各逐页走完，两档都是 `本趟数据缺=[]`、`空态残留=[]`。八张单卡图 + 六张同屏图**一张不剩**都打开看过 | 本线 | 证据包 `apps/mobile/evidence/ux-final-20261016/android-widget-data-r114/`（`RESULT.md` 有跑法、造数据↔判据对应表、八条装置事实、以及这一格仍不证的四项）。🔴 两条形状已入环境陷阱 **#439**（`uiautomator dump` 打 `ERROR: could not get idle state.` 而 **rc=0** ⇒ 只看 rc 会读到上一枚同名文件的陈旧内容，本腿第一次就是这么把一次成功的「开始专注」判成失败的）与 **#440**（这台模拟器 `input text` 把 `-`/`!` 打成全角 `－`/`！`、与 IME 开关无关 ⇒ 造数据只用字母数字、造完按标题回读）。⚠️ 同时把 **#437 末段重述**了：那句「多枚只能逐枚绑」是 r112 那一趟的推论 —— 现量是**同时绑定放得下、同一页放不下**（四枚分在两页、每页两枚），别把两件事混成一件 |
| 23 | ✅ **10-16 15:1x 装机态「用手指点组件卡片那一行」的回写腿跑完了 —— r114 不证清单里那一条现在有了读数**。① 进程活着：点 `○` 那枚符号位（不是标题）⇒ **约 3s 卡上出现 `✓`**，同一屏另一行照旧 `○`（两行的 `PendingIntent` 没串台），表头 `1/2`；两次独立样本都是 3s。② `am force-stop`：**这一档量不到** —— 实例仍然绑定（`id=23`、`widgets.size=1`、`zombie=false`），但桌面上那格渲染成**只有应用图标的空白卡**（无障碍树那一块 0 个文本节点），空白**至少持续 6 分钟**，没有 `○` 可点；点空白走的是卡片整体意图（把应用带起来），那一行仍是 `○`。对照臂（不点只等 +10s/+20s 都读不到行，点一下才回来）已补。③ 换成 `am kill`（只杀进程、不把包放进 stopped 态）：组件**照常渲染、照常可点**，点下去约 5s 出现 `✓`、进程被广播带起（pid `None`→`16164`）、`mCurrentFocus` 全程是启动器 ⇒ **意图队列那一档在装机态上有正面读数：进程被回收时点击不丢** | 本线 | 证据包 `apps/mobile/evidence/ux-final-20261016/android-widget-click-r115/`（`RESULT.md` 有出处四件、三档读数原文、五不证、四条装置事实）。🔴 两条形状已入环境陷阱 **#443**（`am force-stop` 与 `am kill` 在装机态组件上不是同一件事 —— 拿前者当"进程死了"会量出一间空房子）与 **#444**（新写的一次性探针有两种**静默**失法把"读不到"写成"没有"：adb 包装漏 `shell`、`bounds` 字面是 `[346,454][981,500]` 逗号后没空格 ⇒ 正则读成 `[]`，看着完全像组件真空了）。⚠️ 同一趟**更正了 r114 自己两处口径**：那句「本趟造的数已经清掉」当时不成立（14:3x 现量 `8 项待办` 且行里还有 `L114…`），真正删净是 `clean-L114.txt` 那一趟（删 4 行、`8 → 4`，它自己那句"删掉 0 行"是计数器只在"找到确认框"时 +1 写歪了）；「没证点击回写」那一条改成指向本趟。🔴 **仍不证**：force-stop 那一档"点击进不进队列"（没有渲染的行 = 没有可点的意图）、空白卡会不会被下一次 `updatePeriodMillis`（30 分钟）自己救回来（最长只观测 6 分钟）、iOS/macOS/Windows 三端的组件点击（台账 1169 那格照旧开着）、以及**这枚包是 10-15 13:39 那批 —— 本轮 HEAD 之后的 widget 源码改动没进包** |
| 24 | ✅ **10-16 20:2x 台账 UX-S9-143 最后一格的 Android 那一档换成装机态读数了（r116：应用内中英文切换 × 组件一致性）**。走的是应用自己的语言开关（我的 → 设置 → 常规 → 语言），系统语言全程没动 —— 四张截图状态栏下面那行日期一直是中文「10月16日周五」而卡内是英文，这就是"不通过改变整个系统语言规避"那半句的正面凭据。逐档：中文空态「今天没有任务」→ 切英文立刻变「Nothing for today」（英文态残留中文 **0 行**）→ `force-stop` 之后卡上 0 行 → **只给 provider 发一次显式 `APPWIDGET_UPDATE`** 就把卡画回来且是英文 → 切回中文同理（20:21 / 20:22 / 20:23 / 20:24 四张图逐张看过）。冷启动那一档也在这趟里：`force-stop` 之后重新起应用仍读成英文 ⇒ 语言是**持久偏好**，不是内存里那份 | 本线（这一格照旧**不勾**：欠 iOS / macOS / Windows 三端、欠另外三枚 provider 在英文态的卡内文案、欠"30 分钟系统定时器到点自己重画"那一档 —— 本趟是把广播直接送给 provider 的，两者进的是同一段 `BaseWidgetProvider.onUpdate → WidgetRefresh.pushAll`，所以那半句是代码同段推出来的，不是观测到的） | 证据包 `apps/mobile/evidence/ux-final-20261016/android-widget-lang-r116/`（`RESULT.md` 有跑法、六档读数表、收尾两条、四条不证、四条装置事实）。被测包是别线 10-16 傍晚装的那一枚，`lastUpdateTime` 现量在 `run4.txt` 第一行，本线不主张它的构建载体。🔴 三条装置毛病当场修并写进正文：① 正则类 `[㐀-]` 其实是「㐀 或 一个连字符」两元素类 ⇒ 把日期里的 `-` 判成汉字，英文态误报"残留中文"（**#446**）；② 组件卡靠坐标矩形过滤，任何一屏落进那个框的文字都算卡 ⇒ run3 的起点读数把应用登录页读成了卡；③ `focus_owner()` 返回整份 `dumpsys window` ⇒ "前台是不是桌面"**恒真**，一条永远不红的判据（**#447**），修完在"应用正在前台"这个现成状态下当场量到它红 |
| 25 | ✅🔴 **10-17 10:2x 台账 973 那一格（清理数据后组件不继续展示旧任务）在装机态取到读数了 —— 契约本身是通的，但入口在冷启动后够不到（r117）**。为了让这一格真的可跑，本线在共享载体上起了一套**只为本趟**的隔离栈（`PORT=4520`、库 `heyta_uxr117`、TEST_MODE 账号），把装机包登进去再走清理。三条读数：① **可达态 D6 成立** —— 本次会话里刚配完凭据时那一枚是 `Button enabled=true`，点下去存储文件从 `1275 B / [snapshot_v1]` 变成 `65 B / <map />`，卡面退回「打开 Heyta 以显示内容」（图人眼看过），也没冒「小组件还没有清除」；② **冷启动后那一枚必然是灰的** —— 闸门写的是 `disabled={form.token === '' && form.password === ''}`（判的是表单草稿有没有字），而凭据按设计只放内存不落盘，于是实测 `enabled=false` → 点下去 → 存储文件 mtime/字节/键**一个数都没动** → 卡上仍是上一个会话的两条任务，正是 `credential-wipe.ts` 文件头那句"继续显示上一个账号的任务而且没有任何报错"的形状；③ **注销账号那一趟没走到擦除** —— 整条流程点完，界面回「你还没有同意这台设备的隐私规则，所以一个请求都没发 —— 账号还在，本机数据也没动」（未同意时不动数据且说在明面上，这是正面读数；代价是 `eraseLocalData()` 之后组件清不清仍未证）。另量到**冷启动每次会重新发布一次快照**（mtime 序列里两次是在「还没登录」的界面上取的）⇒ "清一次就再也不显示"推不出来 | 本线（这一格照旧**不勾**：② 那条要报的缺陷改点在 `SettingsScreen.tsx`，那枚文件此刻有别的会话在飞（`M`，52 增 19 删，且其 diff 没碰这一行）⇒ 按边界不代改；③ 那一半要把这台设备的隐私同意翻成同意联网，属合规口径，不替负责人翻；还欠 iOS/macOS/Windows 三端与另外三枚 provider） | 证据包 `apps/mobile/evidence/ux-final-20261017/android-widget-erase-r117/`（`RESULT.md` 有出处现量命令、四条读数表、四件事不证、五条装置事实；三条腿 `login-leg.sh` / `erase-leg2.sh` / `closure-leg.sh` / `wipe-reachable-leg.sh` 与 `login*.txt` `erase4.txt` `closure.txt` `wipe-reachable.txt` 同批）。🔴 两条新装置陷阱入库：**#448** 一枚 `disabled` 的 RN 按钮在 uiautomator 里仍 `clickable="true"`、内层 `TextView` 永远 `enabled="true"`，而 `scroll_to_text` 回的正是后者 ⇒ 本线据此把一条正确的"够不到"怀疑作废过，并把可达性缺陷误记成行为缺陷；**#449** 别的应用（那次是 permissioncontroller 的相机权限弹窗）会中途抢前台，此后 dump 回的是弹窗那棵树，"这一页没有设置入口"看着完全像产品缺陷 —— 点掉它重跑后同一枚入口第 1 下就命中。⚠️ 本线先给的归因「`scroll_to_rid` 只滑 5 下不够」被本趟自己的读数否证（放开到 12 下后第 1 下就中），已按假归因登记在 #449 反面那段，别让下一趟照抄 |
| 26 | ✅ **10-17 14:5x 第七趟四端重装（r118）跑完了，`REINSTALL_RC=0`，四端各有两条判据、五张图人眼逐张看过**（`apps/web/evidence/ux-final-20261017/reinstall-r118/RESULT.md` + `provenance.txt`）。载体是隔离 worktree `heyta-wt-r111` 钉在 `25f544bd`、起跑 `dirty=0`；它到收尾时主检出 HEAD 的差集 5 枚**没有一枚是构建输入**（`BLOCKED.md` 在 `apps/packages` 命中 20 个文件，但唯一那枚构建配置 `apps/desktop/vite.config.ts` 里是第 16 行的一句注释，不是 import —— 现量命令写在 `provenance.txt`）。两条偏离都登记在页面上：① ios 那腿**用的不是点名的模拟器**（`IOS_DEVICE_NAME=heyta-iphone-17pro` 没在跑，脚本兜底用了唯一在跑的 `heyta-multiend-reinstall`）⇒ 读数落在另一台设备标识上；② `pod install` 把 `apps/mobile/ios/Podfile.lock` 写脏 1 行 ⇒ 这一腿不是「只含已提交内容」那一档。两条新读数值得单独说：**macOS 窗口那张这一趟里面有完整应用**（内容 74.5%，而 webview 那张 74.6%）—— r110 同一判据下它当时是均匀暗底 + 三个点。两趟合起来才是那条规矩的形状：这张图两种形状都出现过，所以它只能当对照、不能当判据。另一条是 windows 那张右边缘有 **13 列不是应用画的**（主色 `#DDDCDC`、含一枚红字形一枚紫字形，占整图 0.9%，直方图现量写在 RESULT.md 第 5 条不证里）⇒ 那枚内容占比判据含 ≤0.9% 外来像素，本趟不裁决它是什么。**r117 那枚守卫缺陷在当前产物上复验成立**（`lastUpdateTime=2026-10-17 13:26:21` 上仍 `Button enabled=false`，见那包 RESULT.md 第 5 节），同时更正了那页一句写窄了的话：复验探针经 `dismiss_welcome_if_present` 的默认值把设备级隐私同意写成了 `accepted`，已删行恢复并量到同意卡重新立起（`consent-side-effect.txt` 有改前/改后逐字与恢复命令） | **本线已闭**（这一格就是「四端重装」那条步骤本身）。仍挂别人手里的只有：改点在 `apps/mobile/src/screens/SettingsScreen.tsx`（15:0x 现量 ` M`、`git diff --stat` = 77 增 21 删，别线在飞 ⇒ 不代改），以及「未登录时组件该不该显示本机数据」那句产品口径 | `C="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-r111"; RT="$HOME/heyta-r118-reinstall"; mkdir -p "$RT" && git -C "$C" checkout --detach 25f544bd && cd "$C" && NO_COLOR=1 HEYTA_REINSTALL_TMP_DIR="$RT" IOS_DEVICE_NAME=heyta-iphone-17pro bash scripts/reinstall-all.sh > "$RT/reinstall.txt" 2>&1; echo $?` —— 落点不 `mkdir` 会 `RC=4`，路径不许含空格 |
| 27 | ✅🔴 **10-17 15:4x r119 把台账 973 那格欠的那一半量到了**（`apps/mobile/evidence/ux-final-20261017/android-widget-closure-r119/RESULT.md`）：在**已同意联网 + 已同步**的装机态走完整条「注销账号」，四枚独立计数器同时翻面 —— 组件存储 `1269 B / [snapshot_v1]` → **`65 B / 键=（空）`**、本机 `heyta.sqlite` **整枚消失**、服务端 `users=1 tombstones=0` → `users=0 tombstones=1`、卡面退回「打开 Heyta 以显示内容」且**十秒后没有被重新发布**；两张卡图人眼看过（`card-before.png` 15:25 两条 L119 / `card-after.png` 15:43 占位）。⇒ 「清理数据后组件不继续展示旧任务」这半句在**当前产物**（r118 装的那枚包，`lastUpdateTime=2026-10-17 13:26:21`）上成立。三条附带读数：① 注销**不撤回**设备级隐私同意（擦完全套之后 `privacy.consent` 原样在，是不是缺陷属产品口径，只登记形状）；② 「我的」那行在 `operations=9`、「已是最新」的同一时刻仍写「还没登录」⇒ 待查，本趟没证；③ 🔴 `configure_sync_credentials` 那句「✅ 界面认为已配置」被现量否证成**假绿** —— 它判的是 `!form.configured`（表单态），两次跑里它分别与「❌ 访问令牌 没填进去」同时打印、以及在服务端 `operations=0` 时照样报绿；判据已换成**去服务端数 op**（`leg1b` 第 2 段那枚闸门当场红过一次）。三条装置事实进 §7 #452/#453/#454/#455：口令只放内存 ⇒ 造已同步态的腿不许 `force-stop`（杀了之后三个输入框看着都满、同步却停在 `no-encryption-password`）；同步不是填完立刻发生（60 秒窗口内 0，窗口过后才 9 ⇒ 短窗口会误红）；桌面 favorites 不在 `launcher.db` 而在 content provider。收尾逐条有读数：组件实例 27 删→命中 0、`device_pref` 归 0 行、重起应用同意卡再立、栈停、`heyta_uxr119` 已 dropdb、4520 无监听 | **本线已闭**（这一格的前半句）。仍欠的两样：「冷启动态那一枚清凭据够不到」要有人改 `SettingsScreen.tsx`（别线在飞）；后半句"原生拒绝 / 刷新失败有真实失败结果"到 r119 为止 `widget-cleanup-pending` **从未在装机态被触发过** | `bash leg1-login-consent-seed.sh && bash leg1b-relogin-server-gate.sh && bash leg2-closure-consented.sh && bash leg3-closeout.sh`（栈与库的起法在 RESULT.md「复跑」那一节；⚠️ `mobile-e2e-up.sh` 不建库也不迁移，库不存在它直接红） |
| 28 | ✅🔴 **10-17 18:2x r120 把台账 973 那格欠的后半句也量到了 —— `widget-cleanup-pending` 第一次在装机态被真的触发**（`apps/mobile/evidence/ux-final-20261017/android-widget-cleanup-fail-r120/RESULT.md`）。注入点是设备侧文件权限：`chmod 771→555 /data/data/com.heyta/shared_prefs`，于是 `WidgetStore.clearAll()` 里那句 `check(store.commit())` 真的抛，桥接层真的把错误传回 `onWidgetError`。两头判据：注入态点完之后横幅与「重试清除小组件」都在、而组件存储 `500 B / [snapshot_v1]` 三个数**一个没动**（⇒ 那次失败是真的，不是"其实成功了却喊失败"）；改回 `771` 再点重试 ⇒ 锚点消失、存储变 `65 B / 键=（空）`。零代码改动、零重装，收尾腿五条读数证设备侧净改动 = 0（权限 771 / `device_pref` 行数 0 / 冷启动复现同意卡 / 栈停 + 库删 + 凭据文件删）。🔴 顺带否证掉自己两枚探针：`has_text` 是**整值匹配**（lib 411-417 行自己写着这条警告，子串要用 `has_sub`）、裸 `echo` 打的 ❌ **不进 `FAIL` 计数**（那腿末尾照打 `PASS=5 FAIL=0`、退 0）⇒ 见 §7 #456 #457，注入手法本身记在 #458 | 🔴 那一格现在只剩①：冷启动态够不到那枚入口的守卫缺陷，改点在别人在飞的 `SettingsScreen.tsx` 里（`git status --porcelain` 现量 ` M`），本线不代改；另看图登记一枚候选界面毛病（失败横幅渲染在「加密数据钥匙」那张卡内部，与触发它的两枚动作不同卡），**只登记未裁决** | 三腿 `leg-fail-injection.sh` / `leg2-retry.sh` / `leg3-closeout.sh` + 同名 `.txt` + `ui.before-retry.xml` / `ui.after-retry.xml` + 三张图（`settings-banner-injected.png` 红字横幅与重试按钮、`settings-after-retry.png` 收回后、`home-after-retry.png` ⚠️ 桌面已无组件实例，那张**不证卡面**，卡面空态在 r119） |


第 4、5 格都做过**同一枚 A/B**：在只含已提交内容的载体上照样红 ⇒ 是 `main` 上的既有红，不是共享检出被写脏的假红。
第 6、7 格做的是**同一条判据的窄版**（没有另起一棵载体）：这四枚文件 `git diff --stat HEAD -- server/package.json scripts/lib/mobile-e2e.sh scripts/verify-mobile-habits.sh packages/i18n/src/locales/zh-CN.ts` **无输出**（逐字等于 `HEAD`），且 `git show HEAD:packages/i18n/src/locales/zh-CN.ts` 里那句旧文案命中 **0** ⇒ 红不依赖任何未提交改动。⚠️ 那句"无输出"是**当时那一格的 A/B 读数**，不是常驻状态：10-13 19:5x 之后 `scripts/lib/mobile-e2e.sh`、`scripts/verify-mobile-habits.sh`、`scripts/verify-mobile-ios-account-erasure.sh` 三枚已被本线改过（换针 + 目录层导航），要现量请重跑上面那条 `git diff --stat`。

---

## 五、下一步（按顺序，每步都带"动手前先量"的前置）

**1) ✅ 已做完（`63f93a90`）：`scripts/reinstall-all.sh` 的固定 `/tmp` 落点收成一枚 `HEYTA_REINSTALL_TMP_DIR`（默认 `/tmp`，13 枚路径派生）。**
下面这些前置是当时量过的，留着给要改别处落点的人：

- 成员清单现量：`grep -n '/tmp/heyta-reinstall\|/tmp/heyta-ios-release' scripts/reinstall-all.sh`（ ios 段的**派生数据目录 / 构建日志 / 截图**三处是要害，`rm -rf` 那一处最危险）。
- **编辑正在运行的它，是安全的**：这份脚本自带 `HEYTA-SNAPSHOT-BOOTSTRAP`（现量 `grep -n HEYTA-SNAPSHOT-BOOTSTRAP scripts/reinstall-all.sh`），
  入口先把整份拷成 `.reinstall-all.sh.snap.<pid>` 再 `exec` 副本 ⇒ 运行中改源文件不影响那一趟。
- **没有任何门禁钉住这些字面量**（改它们不会让哪道 `check:*` 红），全仓 grep 命中的其余成员都是**记录句子**
  （`BLOCKED.md`、各份计划、`docs/runbooks/android-build-on-windows.md`）。
  ⚠️ 但**有两处代码把它们当默认值消费**：`scripts/verify-mobile-ios.sh` 的 `HEYTA_IOS_DERIVED`，和
  `research/tools/b-batch-reconcile.sh` 的 `IOS_LOCAL_APP`（现量 `grep -n 'IOS_LOCAL_APP' research/tools/b-batch-reconcile.sh`，
  默认值正是 `reinstall-all.sh` 那个 derivedDataPath）。⇒ 两个后果：① **默认值必须逐字不变**；
  ② ios 腿一旦改用私有落点，那次跨产物对账会**响亮地**报"本机没有可比的 iOS 产物"（它 `return 3`、不计入红，
  所以不会假绿），要让它继续可比，就把**同一个旋钮值**一并传给它。
- 命名照仓里**现成的形**：`scripts/verify-mobile-ios.sh` 已经是 `X="${HEYTA_IOS_DERIVED:-/tmp/heyta-ios-release}"` 这一套（现量 `grep -n 'HEYTA_IOS_DERIVED' scripts/verify-mobile-ios.sh`）；
  mac 段也有 `HEYTA_MACOS_DIST_DIR` 的先例，注释里写着"以前是写死的，第一句就是 `rm -rf`，会把别人的现场整个删掉"。
- 引用它**行号**的只有 `research/tools/b-window-keeper*.sh` 里的注释，而且**已经过期**（注释说端序在 `:161`、第 0 步在 `:183`；现量 `grep -n 'ALL="mac windows android ios"\|-r build >' scripts/reinstall-all.sh`）。
  ⇒ 插行不会打断任何可执行判据，但提交信息里要写明"行号引用又漂了 N 行"，别悄悄留下误导。
- 改完的三把尺：`bash -n`、"默认值展开 == 旧字面量"的对照、"给了旋钮就变"的反臂。**能失败的检查才有价值**（AGENTS §8 第 3 条）。

**2) ✅ 载体已选定并留下可复验的形状**：复用 `../heyta-wt-reinstall`（`a195a37f`，只含已提交内容），
这样补出来的 iOS 图与已入库的 mac / windows / android 三张**同属一批**。
装置用主检出新版**逐字复制**过去（`cmp` 报 SAME），而且先确认过 `git diff a195a37f HEAD -- scripts/reinstall-all.sh` **为空**
⇒ 复制过去的只有我自己这一笔，没有夹带别线对同一枚脚本的改动。这一趟的读数因此要写成：**树 `a195a37f` + 装置 `63f93a90`**。
（另一条路——新开一棵到当前 HEAD——本轮没走：那会让这张图与另三端不在同一批，台账就得写两批。）

**3) ✅ 已做完（r87，12:23–12:29，整条 `rc=0`）**：ios 腿在私有落点上跑通，图当场拷进库、两侧 `shasum -a 256` 逐字相同，并**人打开看过**
   （浅色中文首屏同意卡 + 主蓝「同意并联网」）。要点留给下一次：**先拷图再读判据**，别事后回落点取。
   判据继续用 `shot_ok`（非空白 + 主蓝命中），而**主蓝那张是 WebView 快照，不是窗口图** —— 窗口图不能当 UI 证据（#27 那一格的结论）。

**4) ✅ 台账那三句"仍开着"已就地更正**（iOS 图、"要取图得先补旋钮"、"四端里仍有一格没闭合"），并新增一格把 `#34` 改判。
🔴 别只在文末追加成功记录而留着旧句 —— 那会制造两套状态（AGENTS §8 第 8 条）。提交逐笔带明确 pathspec，
新文件先 `git add`，提交后 `git show --name-only` 复验；不 push。文档门：`pnpm check:docs`、`check:md-tables`、
`check:doc-citations`、`check:docs-voice`、`node research/tools/docs-link-check.mjs`。

**5) ✅ 那扇窗已经关掉、三件读数已经入库（10-16 01:2x，`RESULT=OK rig_rc=0`）**：
`apps/web/evidence/sync-privacy-leg-1016-r113-note-sample/`（`wait-and-run.sh` + `waiter.txt` + `report.json` + 42 枚图都在这一格里）。
读法留给下一位用别的窗时照抄：`grep -E 'GO try|NO_GO|RIG_RC|RESULT=' <那枚目录>/waiter.txt`
⇒ 有 `GO` 且有 `RESULT=ran` ⇒ 同一落点里应当长出 `report.json`；只有 `NO_GO` 或 `RESULT=window-closed-without-run`
⇒ **照实登记"没跑"**，不许折进"这一族没红"。🔴 窗**不许住 `/tmp`**（陷阱里"重启清走载体"那条本轮自己踩过），日志与落点都写进库里。
- 起跑条件两条：`load1 < 12` **且** 自动化浏览器进程 = 0；上限 60 × 30 秒。
  🔴 `load1` 取法是 `sysctl -n vm.loadavg | tr -d '{}'`，**删除集里不许带空格**（带了会把三个数粘成一枚 ⇒ `NaN < 12` 恒假 ⇒ 结构上永远等不到，见环境陷阱里 06:43 那一格）。
  本轮实际拦路的是**别的项目的无头批**（`pgrep` 命中 `screenshot-software-copyright` 那一族，不属于本线、本线不动它），14 枚 `NO_GO` 之后自己降下来。
- 三件读数与射程在台账「2026-10-16 01:2x」那一格（页眉两枚判据 / 配对尺反臂 / `carrier.themeRulerSampled` 的第二个值，
  外加 `noteFacts.clientRectCount` 恒为 1 那条**改名后仍然会骗人**的形状）。
  🔴 那一趟 `legs=[sync,reminders]` ⇒ **不是整族读数**，`notJudged` 里那 14 枚是 data/groups/help 三档，别读成"这些判据坏了"。

**6) ✅ 台账 912 那行的后半句「其它模板填入非空真实数据」+ 括号里的「四枚同时在场」都做完了（10-16 04:0x）**
（承接上面第 21 格）：走**应用自己的界面**造出真数据（4 条任务 + 1 条习惯 + 一轮专注），
四枚卡各自渲染出非空内容态，逐枚取亮/暗两档，另外又一档把**四枚同时绑住**逐页取两档。
证据包 `apps/mobile/evidence/ux-final-20261016/android-widget-data-r114/`（`RESULT.md` 有跑法与读数）。
- 🔴 只许走 UI 造数据：快照是 `materializedState(host) + currentFocusState()` 经 `planWidgetPublish` 算出、
  由应用侧密封（`apps/mobile/src/widgets/publish-source.ts`、`apps/mobile/src/widgets/publish.ts`）。
  往 app 存储里手写文件会绕开整条管线，那种图不能叫"装机态非空数据"。这一趟一个字节都没往存储里写。
- 装置分档可重入：`python3 widget-data-leg.py emulator-5554 . seed` / `focus` / `capture` / `simult` / `cleanup`。
  ⚠️ **`capture` 与 `simult` 不许 `fresh` 重启应用**（专注轮的 running 只在内存里；paused 档是持久的）。
- 现成的手（别重推导）：`scripts/qa/tasks-ux-android.py` 已经有 `create_task(title)`、`task_quadrant(...)`、
  `scroll_find`、`tap_label` 这套 uiautomator 定位；绑定/取图/收掉那一段在
  `apps/mobile/evidence/ux-final-20261015/android-widget-pair-r112/widget-theme-matrix.py`。
  这一趟把两段合进了一份脚本，并补了 `find_control`（可点的是 `Button(content-desc)`、可见文字在里面的
  非可点 `TextView` 上）与 `has_text`（相位标签「已暂停」不可点，`find_control` 找不到它）。
- 动手前必查两条：`adb devices -l`（这枚模拟器有没有别的会话在用）与
  `adb -s emulator-5554 shell dumpsys package com.heyta | grep -E 'versionName|lastUpdateTime'`
  （**装机包是不是你以为的那一枚**）。⚠️ 这一格不写具体时刻，因为这台是共享的、别人随时会再装一次：
  本线 r112/r114/r115 那三趟读到过 `10-15 13:39`，10-16 傍晚复量已经变成另一枚 ⇒ **每次现取，别沿用**。
  对账方向是"设备上的 `lastUpdateTime` vs 本机 `app-release.apk` 的 mtime"，谁旧都可能，
  结论只有一句：**别拿旧 APK 静默测非当前产物**。
- 🔴 两条会让人白跑一整趟的形状已入环境陷阱 **#439**（`uiautomator dump` 打 `ERROR: could not get idle state.`
  而 **rc=0** ⇒ 只看 rc 会读到上一枚同名文件的陈旧内容）与 **#440**（这台模拟器 `input text` 把 `-`/`!`
  打成全角 `－`/`！`，与 IME 开关无关 ⇒ 造数据只用字母数字，且造完必须按标题回读）。
- ⚠️ 这一格**仍不证**：行数上限截断、跨零点过期态、习惯"今天已完成"那一档
  （详情里没读到 `habit-checkin-<id>`），以及一条**未裁决**的观察（组件写「专注中」而同一时刻应用页写「已暂停」，
  指向"暂停/继续不重新发布快照"）—— 要判它得先有一条**不依赖无障碍树**的读数。
  （原列在这里的"点卡片回写"已经在 10-16 那趟取到读数了，见上面第 23 格；留在这里会误导下一位。）

---

## 六、死过的手（本轮实测，别再试一遍）

1. **不要拿"`/tmp` 里存在一张 ios 截图"当证据。** 本轮就是这么丢的：那份 20:41 被另一条会话覆盖成
   一张尺寸都不等的黑图。必须当场拷走 + 哈希对账，事后回来取不到就是取不到。
2. **不要为了凑"命中那一支"去 `pm clear` 共享的 `emulator-5554`。** 清数据只有 §6.1.1 重装流程自带那一步授权；
   另起一次就是删别人的现场。
3. **不要 `open -a Heyta` 去抢前台** 来满足 AX 探针 —— 那是 AGENTS §6.2 规定二明确禁的，2026-10-08 那趟绿证的代价就是它。
4. ~~**不要在主检出补 `pnpm --filter @heyta/web build`** 来消 #35 的红~~ —— 🔴 **这条的前提在 10-13 05:1x 消失了，已按现量作废**（原文由：那会把**别人没写完的源码**打成 `apps/web/dist`；实际那批（`a923f7fa` 等）已落地，`RailNavigation.tsx` 与 `apps/web/src` 都不在 `git status` 里，台账那一格指定的闭合动作也正是"那批落地之后跑一次 build"）。**但它后半句还活着，别一起丢掉**：`apps/web/dist` 是 mac / windows 两腿"同一次构建"对账拿的那份产物，所以在主检出 build 之后、四端重装之前，**那两腿的旧读数不再与当前 dist 同批** —— 本轮的四端重装那一格会把它们重打并重新对账，次序不能倒。
5. **不要靠放宽判据消红**（`check:image-license`、`check:locator-labels`、`check:layering` 三处本轮都有人提议过加豁免）。
   本线自己造的紅（CLI help 写成中文被定位符门当界面标签）改的是**自己的字符串落点**，不是门。
6. **不要把门禁报出的"缺失针"直接换成新文案**（10-13 05:1x 差点这么修 `check:verify-script-copy`）：门只验"串在不在词条表里"，
   它**验不到"这句话在被测那一屏渲染不渲染"**。🔴 上面那句"新串不在「同步与隐私」屏上"要按**状态**重读（10-13 19:5x 的
   设备现量把它限死了）：那句 `notConfigured` 只在 `advancedSync && !form.configured` 这一格渲染 —— 表单开着、凭据还没生效。
   未点开自托管那一行时画的是另一句（`sync.officialHint`），所以 r107 那一趟和 r108 这一趟都没错，只是取的屏层不同。
   ⇒ 规则本身仍然成立：**换针之前必须先取"这句话在该断言点的那一屏确实渲染"的正对照**，否则绿门 + 一条永不成立的断言。
   这一条本轮照做后收口了（正对照 `android-r108-syncneedle/probe.json`，bounds `[42,945][1038,993]`）。
   先取真屏读数，再决定换什么。
7. **不要 `git push`。** 本地 main 领先 origin 的枚数现量见第三节，里面绝大多数是别的并行会话未公开的笔。

---

## 七、验证状态（哪些门在哪些树上绿）

- 本轮跑过的：`check:locator-labels` rc=0（五枚脚本全过）、四道文档门绿、`pnpm -r typecheck` 本线范围内绿。
- 🔴 **整条 `pnpm check` 本轮没有在合并态载体上重跑**（负载与 e2e 抢端口那两档原因记在台账），
  所以"全链绿"这句话**不成立**，不许照抄。
- 10-13 07:4x **第五趟四端重装（r108）跑完**：`DESKTOP_RC=0 / MOBILE_RC=0 / IOS_RC=0`，四端重新钉在 `769e6258`；
  证据包 `apps/web/evidence/ux-final-20261013/reinstall-r108/`（含 `RESULT.md` 与 `SHA256.txt`）。
  🔴 一处偏离要一起读：**iOS 腿跑在主检出**（新载体的 `pod install` 撞上一条 567 B/s 的 maven 通道，
  hermes tarball 按树缓存）⇒ 那一腿不是"只含已提交内容的隔离检出"那一档，差集现量写在 `RESULT.md` 里。
- 10-15 05:5x **第六趟四端重装（r110）跑完：`REINSTALL_RC=0`**，载体 `../heyta-wt-r110` @ `fd5c2fb1`、
  起跑 `dirty=0`、`load1=42.18`（没调任何阈值）。证据包 `apps/web/evidence/ux-final-20261015/reinstall-r110/`。
  三处偏离见第四节第 4 步那一行 —— **别把它读成"四端全等当前提交"**（`pod install` 那一行 `Podfile.lock` 是真偏离）。
- 10-15 05:3x–06:0x 本线自己那几把尺的读数：`bash apps/mobile/evidence/profile-center/android-r109-habits-leg/foreground-arms.sh`
  ⇒ **ARMS_RC=0**（四臂，含"桩自证"那一臂）；`NO_COLOR=1 pnpm check:locator-labels` **RC=0**（⚠️ 它只扫 5 份 `scripts/qa/*`，
  不覆盖 `verify-mobile-*.sh`）；`NO_COLOR=1 pnpm check:verify-script-copy` 仍 **RC=1 / `SUMMARY … 缺失=1`**（那枚针的口径不归本线）；
  `NO_COLOR=1 pnpm check:docs` 由红转 **RC=0**（红因是新增链接指向还没入库的证据件，走的是"该入库 ⇒ 入库"那条出路，没放宽判据）。
- 10-15 06:3x 又取到两枚：`NO_COLOR=1 node scripts/check-mobile-first-run-gate.mjs` 由 **RC=1 转 RC=0**（唯一 offender 是本线自己的
  `scripts/verify-mobile-organizer-confirm.sh`，红因是调用形状不是缺处置 —— 两头有牙见第四节第 20 行）；
  🔴 **同一条链的覆盖边界**：这枚门在 `pnpm check` 大链里而**不在重装链里**，所以它红了六趟重装一次都没照出来。
- 10-15 06:5x 边界读数：`NO_COLOR=1 pnpm check:shell-unicode` **RC=1**，点名 9 份脚本（分母现量：那条命令自己 `| grep -c '❌'`），
  🔴 **本趟不是它红的原因**（本趟只动了两行调用形状 + 两份纯 ASCII 的 `.ps1`，两份都不在这枚门射程里）。
  它自己的分母里含一枚**未跟踪**文件 `.run-logs/ac-reeval.sh`（现量 `git ls-files .run-logs` ⇒ 空）
  ⇒ 别的会话在飞的量具进了门禁射程；本线名下那处（`verify-mobile-organizer-confirm.sh`）✅ 已在 10-16 01:0x 清完 —— 现量不是 4 处而是 **17 处**
  （当时只看了门禁打印的前几行，它末尾写着"…还有 12 处"，我没数完分母就写了数）；剩下 6 个文件 + 那枚未跟踪文件仍归别线，不代改。
  同批 `check:shell-exit-chain` **RC=0**。
- 10-15 07:5x **第七趟 r111（只跑 windows 一端）`REINSTALL_RC=0`**：载体 `../heyta-wt-r111` @ `2dbfdba6`、`dirty=0`。
  取证量具那笔 DPI 改动由此拿到运行时读数：`WINDOW_DPI=96 DPI_CTX=True`、`WINDOW_RECT=1440x734`、png 实测 (1440, 734)。
  证据包 `apps/web/evidence/ux-final-20261015/reinstall-r111/`。⚠️ 那枚"125% 缩放"归因在 00:3x 翻回原处（见下一条）；
  另有一枚**不属于本应用**的红标签（toast 进图）记在那包的 `RESULT.md`；**三端不在本趟范围**（汇总段自己写着没有验证）。
- 10-16 00:5x **装机态 Android 四枚组件两档读数入库**：`dumpsys appwidget` 的 `Widgets:` 段逐枚给出 provider（`Habits`/`Focus`/`Today`/`Quadrant` 各一），卡内底色亮 `(255,255,255)` / 暗 `(13,21,38)` 逐枚等于 `values/`＋`values-night/` 生成 token；跑完设备回到空桌面（`widgets.size=0`）。证据包 `apps/mobile/evidence/ux-final-20261015/android-widget-pair-r112/`。⚠️ 这只闭合「四组件实际切换明暗复验」那半句，**非空数据那半仍开**（本次四枚都是空态）。
- 10-16 00:3x **打包机重新在线，把上一格那枚"机制未量清"量清了**（三条现量，都在 windows 那台机上取）：
  注册表 `HKCU:\Control Panel\Desktop\WindowMetrics` 的 `AppliedDPI` = **120** = 96 × **1.25** ⇒ 系统缩放确实是 125%，
  上一格把它判成"被否证"是**射程错**：`WINDOW_DPI=96` 量的是取证进程自己会话的桌面 —— 同一台机、同一个
  `ssh windows-pc`，ad-hoc 那张桌面现量是 `Screen::AllScreens=1024x768 / deviceName=WinDisc / SM_CXSCREEN=1024 / LOGPIXELSX=96`，
  且 `SetProcessDpiAwarenessContext(-4)` 在那里返回 **`False`**（r111 那趟是 `True`）⇒ 两次连进去的桌面可以不同。
  ✅ r111 那张图本身不必重取：图 1440 宽，x=1100/1300/1439 三列各有 14/6/28 种颜色、不是空白 ⇒ 抓在一张 ≥1440 宽的桌面上。
  🔴 新增读法边界（已写进环境陷阱末条与本账 07:5x 那格）：**`WINDOW_DPI` 不能用来推用户机器上的缩放。**
- 10-13 05:1x 另取到三枚读数（都记在台账对应格）：`pnpm --dir apps/web typecheck` **rc=0**、`pnpm --dir apps/web build` **rc=0**、
  `pnpm check:shell-surfaces` **rc=0**；`pnpm check:verify-script-copy` 仍 **rc=1**（3 枚针，见第五节第 7 行）。
- 10-13 19:5x 这三枚重取过：`pnpm check:verify-script-copy` ⇒ **rc=1，`SUMMARY … 缺失=1`**（3→1，本线那两枚 + 门扫不到的第四枚已换完），
  `pnpm check:mobile-settings` ⇒ **rc=0**，`pnpm check:mobile-ai-anchors` ⇒ **rc=2**。最后那枚**不归本趟那笔改动**：
  把 `scripts/verify-mobile-ai.sh` 换成 `HEAD` 那一版复跑同一道门，`SUMMARY … 脚本锚点=19 按字面命中=9 按模式命中=4 未匹配=6`
  与改后**逐字相同**、退出码同为 2，六枚未匹配全在 1678–2078 行（`tool-input / ai-tool-send / breakdown-*`），没一枚在本趟动过的那一段。
- 在册红：#39（`check:image-license`，不在本线射程）、`packages/i18n` 那枚"中文表每条都含汉字"对专名（`macOS`/`iOS`/`Android`）的红、
  根 `package.json` 那对重复 `"check"` 键（口径归所有者）、`check:mobile-ai-anchors` rc=2（那六枚未匹配 + `AssistantScreen` 取不到发送锚点，归对话式 AI 助手那一线）、
  `check:verify-script-copy` 剩下的那枚 `verify-mobile-ai.sh:1666`（`c8f63370` 改了语义，判据口径不代改）；
  🔴 ~~`check:verify-script-copy` 里有两枚针是本线自己的债~~ —— **10-13 19:5x 已了结**（见第五节第 7、15 行），别再照抄这句。

---

## 八、相关文件

- 事实源台账：[`product-ux-optimization.md`](product-ux-optimization.md)（文末各格）
- 跨端交互专项：[`cross-platform-ux-optimization.md`](cross-platform-ux-optimization.md)
- 装置：`scripts/reinstall-all.sh`、`scripts/qa/macos-installed-widget-help.sh`、
  `scripts/qa/profile-settings-android.py`、`scripts/qa/profile-settings-ios.py`、`scripts/verify-web-ui-sweep.mjs`
- 四端重装规则与判据：`AGENTS.md` §6.1.1；产物身份对账：`docs/runbooks/multi-platform-build.md`
- 同类交接的写法参照：[`account-standard-suite-handoff.md`](account-standard-suite-handoff.md)
