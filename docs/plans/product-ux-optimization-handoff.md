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
| 第 4 步 四端重装 | ✅ **第六趟（r110）跑完，`REINSTALL_RC=0`**，而且是**本线第一次带着"真的会进包的产品改动"跑**（载体 `../heyta-wt-r110` @ `fd5c2fb1`、起跑 `dirty=0`、`load1=42.18` 没调阈值）。第五趟 r108（`769e6258`）那批读数仍在库。⚠️ r110 的三处偏离必须一起读：**ios 那腿被 `pod install` 改了一行 `Podfile.lock`**、**四端跑出来全是浅色**（"深浅两档都装过"仍不成立）、与 `fd5c2fb1` 的差集是 3 枚非构建输入的台账件 | 台账「2026-10-15 05:5x」那一格；证据包 [`apps/web/evidence/ux-final-20261015/reinstall-r110/`](../../apps/web/evidence/ux-final-20261015/reinstall-r110/RESULT.md)（逐端判据 + 五张人看过的图 + 包内名册）。🔴 全部**不证 `origin/main`**（本地未 push）、**不证小组件卡片在桌面里换了字** |

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
| 19 | ✅ **10-15 06:5x 裁掉：界面没有截，是取证图少了右边一块。** 同一份源码在无头浏览器 1152/1280/1440 三档量：`docScrollWidth == innerWidth`、横向溢出元素数 **0**、标题「对话助手」x=844→915（右侧还有 237px 余量）。而装机图里同一枚标题墨迹在 x=1051→1151 —— 差 212px。差的来源：打包机 125% 缩放，抓取进程没声明 DPI 感知，`GetWindowRect` 与 `CopyFromScreen` 都在虚拟化坐标里自洽 ⇒ png 只是真实窗口（1440×734）的左上 1152×587，**右边 230 CSS px 从没进图**。现量对照证据不必上机：同仓 `apps/desktop-windows/evidence/ux-final-20261008-candidate/auth-legal-frozen/attempt-3-upgraded/installed-dpi-full.json` 记 `1440x734 / dpiAware:true`，常规路径记 `WINDOW_RECT=1152x587`，比值 1.25 | 本线（改的是量具，**第一验点在 Windows**） | 已把 DPI 感知声明与 `WINDOW_DPI=` 读数落进 `apps/desktop-windows/scripts/{install-and-capture,capture-window}.ps1`（形状抄自同仓跑通过的 `capture-installed-dpi.ps1`；两份仍纯 ASCII）。下一趟 windows 腿的判据两条：`WINDOW_DPI=120` 与 png 宽 == 真窗口宽。⚠️ 本机无 pwsh ⇒ 脚本未跑过，别把"改了"读成"修好了"。连带推论已立案到环境陷阱末条：**常规路径抓过的每张 windows 装机图都少右边约 20%**，按它们判过"右侧是否被截"的格子要重看 |


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
  ⇒ 别的会话在飞的量具进了门禁射程；本线名下那 4 处（`verify-mobile-organizer-confirm.sh`）留作下一趟顺带项，
  不在这轮批量修（一次会把 8 份别人名下的脚本拖进 diff）。同批 `check:shell-exit-chain` **RC=0**。
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
