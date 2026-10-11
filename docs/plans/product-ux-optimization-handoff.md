# 交接：产品体验线（本轮 UX 优化 Goal）

> 状态：**本轮目标五步都交完，四端一趟跑齐、图与判据同批入库（r93）；剩四格各有归属，全部只在本地、未 push。**（2026-10-11 15:5x 更新）
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
| #1 Android 设备腿 | ✅ 当前产物上中文、英文各一趟；APK 与设备上那份哈希逐字相同 | `apps/mobile/evidence/profile-center/android-r85-currentproduct/`、`android-r86-currentproduct-en/` |
| #30 三形态 | ✅ "命中/跳过/没命中"三种形状各有各的设备读数，不再同形 | 台账「#30 关掉」那格；iOS 那五张在 `apps/mobile/evidence/profile-center/ios-r78-currentproduct/` |
| #27 macOS 空窗定性 | 🔴 **改成"间歇"**：r77 那张窗口图主蓝 0，r93 同一枚装置的窗口图主蓝 994（人打开看过=完整共享 UI）。判据一行没动 ⇒ **不能写成已修** | 台账「r93」那格末尾带一条现量命令；两张图都在库 |
| #34 探针改进 | ✅ 两枚：按 pid 锁死寻址 + 窗口数为 0 时分辨两种成因；顺带去掉一处会冷启动 Safari 抢焦点的写法 | `scripts/qa/macos-installed-widget-help.sh`，提交 `630fb57e` `1f00bb59` |
| #34 壳级两格 | ✅ **闭了**（后台诊断链，零前台激活、零录屏权限） | 提交 `91c6da3a`；读数 `apps/desktop-macos/evidence/widget-help-dom-20261011-r92.txt`；复跑 `bash scripts/verify-macos-widget-help.sh` |
| 第 4 步 四端重装 | ✅ **一趟四端全绿**（r93，`REINSTALL_RC=0`），四端**图与读数同批**收在一个包 | [`apps/web/evidence/ux-final-20261011/reinstall/RESULT.md`](../../apps/web/evidence/ux-final-20261011/reinstall/RESULT.md)；🔴 载体是**主检出工作树** ⇒ 不证干净检出 |
| 逃生门那一格（§8.2 前提） | ✅ **macOS 半已有真壳读数**（r96 关臂 + r97 默认臂配对，两臂都 `DIRTY_PATHS=clean`）：门关掉后 `storagePort` 与 `heytaStorage` 双双为 false，而 `heytaWidget` 仍在 ⇒ 面板仍是原生形状、0 行安装引导 | 台账「逃生门关掉后还认得壳」那格；两臂各一条命令：`HEYTA_SHELL_STORAGE=0 …` 与去掉前缀的同一句。⚠️ **Windows 真实 WebView2 那一半仍开**（那条 e2e 注入的是合成信号） |
| 第 5 步 归属对账 | ✅ #26/#29/#31 已闭合、#35 归 apps/web 在飞那批、#28 留口径、#39 归 inbound-core | 台账「第 5 步跑完」与「check:image-license」那两格 |

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
| 2 | #34 macOS 壳级：✅ **两样都闭了**（10-11 14:5x `91c6da3a`，后台、零前台激活）——壳新增 `HEYTA_WIDGET_HELP_PROBE=1` 那条 `runWidgetJourneyChain`，装置 `scripts/verify-macos-widget-help.sh`，判据 `scripts/qa/macos-widget-help-judge.mjs`；**只剩一小格**：浏览器里是否真的渲染出那一页（诊断模式故意不叫 `NSWorkspace.open`，那会抢前台） | 那两样已由本线做完；剩下那一小格**在负责人手里**（允许一次前台激活去跑 AX） | 复跑闭合的那两样：`bash scripts/verify-macos-widget-help.sh`（读数自带出处；判据侧另有 `node scripts/qa/macos-widget-help-judge.mjs --self-test`）。剩那一小格：`HEYTA_MAC_PID=<pid> bash scripts/qa/macos-installed-widget-help.sh` |
| 3 | #28 定位符门按 pair 还是按 OR-set | **负责人一句话**（判据口径，按边界不代改） | `pnpm check:locator-labels` 现量它现在判的是哪种 |
| 4 | #35 `check:shell-surfaces` 的 W5 产物比源码旧 | **apps/web 在飞那批的所有者** | `node scripts/check-shell-surfaces.mjs`（主检出红 / 干净载体不红 —— 差的就是那批未提交源码） |
| 5 | #39 `check:image-license` rc=1（`@noble/hashes` 一处钉死、一处范围） | **`packages/inbound-core` 的所有者**（或运营侧统一 `resolutions`） | `pnpm check:image-license`；两枚声明的现量：`grep -n '@noble/hashes' packages/inbound-core/package.json packages/sync-core/package.json` |
| 6 | r93 当场量到的红：`check:integration-coverage` rc=1 —— 一枚已提交的集成 spec 没被任何入口点名 | **自动收集 / inbound 那一线**（`0eea4c0f` 带进来的那枚） | `pnpm check:integration-coverage`；现量：`grep -c 'inbound-dual-host' server/package.json`（0）对 `node scripts/check-integration-coverage.mjs` 点名的那一行 |
| 7 | r93 当场量到的红：`check:verify-script-copy` rc=1 —— 两枚旧针钉着一句**已从词条表消失**的文案 | **`scripts/lib/mobile-e2e.sh` 与 `scripts/verify-mobile-habits.sh` 的所有者**（或改那句同步设置文案的人跟着收） | `pnpm check:verify-script-copy`；现量：`grep -c '填好服务器地址与访问令牌后才能同步' packages/i18n/src/locales/zh-CN.ts`（0）、旧针在 `scripts/lib/mobile-e2e.sh:1475` 与 `scripts/verify-mobile-habits.sh:631` |

第 4、5 格都做过**同一枚 A/B**：在只含已提交内容的载体上照样红 ⇒ 是 `main` 上的既有红，不是共享检出被写脏的假红。
第 6、7 格做的是**同一条判据的窄版**（没有另起一棵载体）：这四枚文件 `git diff --stat HEAD -- server/package.json scripts/lib/mobile-e2e.sh scripts/verify-mobile-habits.sh packages/i18n/src/locales/zh-CN.ts` **无输出**（逐字等于 `HEAD`），且 `git show HEAD:packages/i18n/src/locales/zh-CN.ts` 里那句旧文案命中 **0** ⇒ 红不依赖任何未提交改动。

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
4. **不要在主检出补 `pnpm --filter @heyta/web build`** 来消 #35 的红：那会把别人没写完的源码打成 `apps/web/dist`，
   而 mac / windows 两腿的"同一次构建"对账拿的正是这份 dist。
5. **不要靠放宽判据消红**（`check:image-license`、`check:locator-labels`、`check:layering` 三处本轮都有人提议过加豁免）。
   本线自己造的紅（CLI help 写成中文被定位符门当界面标签）改的是**自己的字符串落点**，不是门。
6. **不要 `git push`。** 本地 main 领先 origin 的枚数现量见第三节，里面绝大多数是别的并行会话未公开的笔。

---

## 七、验证状态（哪些门在哪些树上绿）

- 本轮跑过的：`check:locator-labels` rc=0（五枚脚本全过）、四道文档门绿、`pnpm -r typecheck` 本线范围内绿。
- 🔴 **整条 `pnpm check` 本轮没有在合并态载体上重跑**（负载与 e2e 抢端口那两档原因记在台账），
  所以"全链绿"这句话**不成立**，不许照抄。
- 在册红（都不在本线射程）：#35、#39、`packages/i18n` 那枚"中文表每条都含汉字"对专名（`macOS`/`iOS`/`Android`）的红、
  根 `package.json` 那对重复 `"check"` 键（口径归所有者）。

---

## 八、相关文件

- 事实源台账：[`product-ux-optimization.md`](product-ux-optimization.md)（文末各格）
- 跨端交互专项：[`cross-platform-ux-optimization.md`](cross-platform-ux-optimization.md)
- 装置：`scripts/reinstall-all.sh`、`scripts/qa/macos-installed-widget-help.sh`、
  `scripts/qa/profile-settings-android.py`、`scripts/qa/profile-settings-ios.py`、`scripts/verify-web-ui-sweep.mjs`
- 四端重装规则与判据：`AGENTS.md` §6.1.1；产物身份对账：`docs/runbooks/multi-platform-build.md`
- 同类交接的写法参照：[`account-standard-suite-handoff.md`](account-standard-suite-handoff.md)
