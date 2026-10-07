# Linux 端适配计划

> 立单：2026-10-06。产品负责人指令：「让这个项目也适配 Linux 系统」，并当场拍了两格：
> **交付边界 = 两批都做、工程侧先**；**Linux 侧构建与门禁载体 = 那台 Ubuntu 24.04 开发机**。
> 操作事实源在 [Linux 载体操作手册](../runbooks/linux-dev-box.md)，本文件只记裁决、状态与判据。

---

## 0. 这一单推翻的是哪条**在册**决策（先说清，别当没人写过）

| 在册说法 | 出处 | 现在的处置 |
|---|---|---|
| Linux「同架构，但不做专项功能」；且"仍然没有 Linux 桌面用户的证据，当初不做它的原理由从未被推翻" | [multi-end-unified-strategy.md](multi-end-unified-strategy.md) §Q2 与它的"未推翻"那句 | **由本次指令推翻定位**：Linux 端升为要交付的一档。驱动不是新出现的用户，是这台载体机 + 自托管诉求 ⇒ 报告里不许写成"有用户证据了" |
| Linux 桌面「没有需求证据」/ 同一文件另一张表里「🔲 未规划」 | [build-matrix.md](../reference/build-matrix.md) §5 与 §构建宿主表 | 两处互相矛盾且都过期，本单收口（见 §4 工单 E5） |
| Linux 不做钥匙串（与鸿蒙并列） | [ADR-0040](../adr/0040-email-password-auth-decoupled-from-e2ee.md) | 仍然有效，**本单不改它**。批二做到凭据落盘那一格时要显式回到这条 |
| Linux 放弃玻璃（GTK4 无 backdrop blur） | [ADR-0042](../adr/0042-glass-material-boundary.md) | 批二把共享 UI 搬进 WebView 之后，"玻璃渲染在哪一层"变了 ⇒ **要重判**，不许默默沿用旧结论 |
| 桌面 UI 走 M2：原生壳 + 壳内 WebView 加载 `react-native-web` 产物；三端手写的业务 UI 是"要删的对象" | [ADR-0037](../adr/0037-desktop-ui-falls-back-to-webview.md)、[multi-end-unified-strategy.md](multi-end-unified-strategy.md) §4.3/§6.3 | **不变**。批二就是让 Linux 补上它唯一没走的那一端，而不是再手写一份 |

🔴 按 AGENTS §8「不改已接受 ADR 的结论，要变更就新写一份」：定位变更要落一枚**新 ADR**，
取号在落盘那一刻现量（`ls docs/adr | sort | tail -1`）—— 2026-10-05 那次两条会话同一天撞号的教训就写在 `check:adr-numbering` 的文件头。

---

## 1. 现状（2026-10-06 实测，全部带出处）

### 1.1 产品侧：Linux 是三个桌面壳里唯一没走 M2 的那端

> ⚠️ **这一节是"开工时（2026-10-06）的现状快照"，不是现状。** 07 03:4x 之后，
> 表里这几行已被本单改掉：链的模块（现在含 `webkitgtk-6.0`）、"没有任何 WebView"、
> "手写 GTK 那一屏是唯一的界面"（现在 M2 优先、手写只在 M2 兑现不了时出现且**带原因打印**）、
> "反向门禁把没有钉成事实"（L2 已改双向，见 P2 那行）、"窗口判据只有非空白"（见 P3 那行）。
> 逐条读数在 §3 的 P2/P3 两行与 runbook §5.7。**留形而不删**，是因为"当时真的没有"
> 正是这一单存在的理由。

| 事实 | 证据 |
|---|---|
| Linux 壳只链 `gtk4 javascriptcoregtk-4.1 sqlite3`，**没有任何 WebView** | `apps/desktop-linux/Makefile:14` |
| 界面是手写 GTK 控件（`gtk_label_new` / `gtk_button_new_with_label`），门面 API 只有 6 个函数 | `apps/desktop-linux/src/main.c:202-242`、`src/heyta_api.h:33-50` |
| 同步未接线：门面故意不传 `serverUrl` ⇒ 不建同步客户端；无登录、无彻底删除 | `apps/desktop-linux/README.md` §6 |
| mac / win 已有 web-dist 通道，Linux 完全没有 | `apps/desktop-macos/scripts/package-app.sh:123`、`HeytaMacApp.swift:1495`、`apps/desktop-windows/HeytaWindows/MainWindow.xaml.cs:71` |
| **有一枚反向门禁把"没有"钉成事实**：`apps/desktop-linux` 下出现 `web-dist` 引用即红 | `scripts/check-shell-surfaces.mjs` 的 **L2 反向核对**（锚点写符号不写行号：这一族在同一批里被改成**双向**，行号早已漂 —— 原来引的 `:1085` 现量落到了 `HEYTA_WEB_DIST_DIR` 那行）。🔴 后续裁决：M2 落地让这句"没有"变成假的，L2 因此从单向变双向（写 `wired-unverified` 而树上**没有**引用同样红），臂 G11/G12b 各测一个方向；台账那行 07 04:4x 已翻 `reachable`（见 P4） |
| 窗口取证判据只有「非空白」，不调主蓝计数 ⇒ 正是 AGENTS §7 第 82 条那个假绿形状 | `apps/desktop-linux/scripts/capture-window.sh`、`package-deb.sh`、`scripts/screenshots/verify-artifacts.mjs:24`（对照 `scripts/reinstall-all.sh:90` 的"非空白且主蓝命中"）。🔴 后续裁决：`package-deb.sh` 那格 ✅（解包态窗口 `PKG_PIXELS=OK`，主蓝现量 3987）；`capture-window.sh` **判据已补但那张图采的是 M2 之前的原生屏**（主蓝现量 **0** ⇒ 重跑它会判红，这是预期而不是缺陷），把它重定向到 M2 要连 `scripts/screenshots/targets.mjs` 的 `methods` 一起改，排在 **E7** |
| 设计 token 这一格**其实已经接上了**（`heyta.gtk.css` + `heyta-tokens.h`，且 C 文件在 `check:native-bare` 射程内） | `packages/design-system/src/generate.ts:838-870`、`main.c:16,172-183`、`scripts/check-native-bare-values.mjs:43` |
| `.deb` 打包脚本已存在，但只能手动 SSH 到远端跑；根 `package.json` **没有 `build:linux`** | `apps/desktop-linux/scripts/package-deb.sh`、`package.json` scripts 段。🔴 后续裁决：两条都闭合（07 04:4x，见 P4）—— `build:linux` 已加且目标机透传，脚本有 `local` 档；同时**默认远端 `sanjiaozhou`（生产机）那一档被拿掉**，改为"参数 > `HEYTA_LINUX_HOST` > 响亮拒绝"（runbook §8） |

现量口径（本文件不写条数）：源文件数 `find apps/desktop-linux/src -name '*.[ch]' | wc -l`。
🔴 **冒烟条数不许用 `grep -c 'check(' src/smoke.c` 取**（我今天先写了这么一条现量命令，它 22 而实跑 13 ——
每条判据旁边配一条 `check(false, …)` 的失败分支，两者互斥，源码计数只是两倍上界）。
真源是**产物自报**那行：`./heyta-smoke` ⇒ `HEYTA_LINUX_SMOKE=OK n/n`。
本单开工时 README 与 AGENTS 写的"12/12"已与代码不符，且 `smoke.c` 成功时**根本不打印条数** —— 工单 E6 已把这两件事一起收掉。

### 1.2 工程侧：整仓**已经**在 Linux 上跑，但"Linux 壳门禁"是一枚永远不执行的判据

| 事实 | 证据 |
|---|---|
| `pnpm check` 的门禁链在 Linux 载体上逐段跑通过（本次实测，读数见 §3） | 载体读数 `docs/runbooks/linux-dev-box.md` §5 |
| 链里只有 1 段会碰到 BSD-only 工具（`check:apk-freshness`），而那枚脚本"有兜底"—— 兜底是**死的**（见 §2 那条机制） | `scripts/lib/apk-freshness.sh:70-90` |
| `check:linux-shell` 在非 Linux 退 0、在 Linux 缺 `pkg-config` 条目时也退 0 ⇒ **在 mac 上和在那枚 alpine gate 容器上都从未真正执行过** | 改前 `scripts/check-linux-shell.mjs:24-47`；对照 `docs/runbooks/ci-and-runner.md` §8 那张点名跳过表里没有它 |
| `reinstall-all.sh` 的固定收尾是四端，Linux 不在内 | `scripts/reinstall-all.sh:182` |
| 没有任何 Linux 载体的 runbook；Linux 壳的操作步骤散在 `multi-platform-build.md` 的 SSH 那一段 | `docs/runbooks/` 目录、`docs/runbooks/multi-platform-build.md:864-883` |

### 1.3 一条**跨载体**的接缝（本单顺带照出来，不属于 Linux 也不属于产品）

`@heyta/landing` 有一条判据要求 `origin/main` 这个 ref 真存在（"工作树里有不算"），
而 `gate-ssh.mjs` 与本次 Linux 载体都是**tar 送源码**（没有 `.git`）⇒ 这条判据在"tar 载体"上必红，
而 `pnpm check` 的链尾恰好就是 `pnpm -r test`。 ⇒ 凡用 tar 送源码的载体都要带上 `.git`，
否则链尾那一段是**载体无效**而不是产品失败。修法与实测在 runbook §4。

---

## 2. 🔴 本单目前最值钱的一条机制发现：GNU 的 `stat -f` 把 `-f` 读成"文件系统状态"，**打一整块垃圾到 stdout**

原先整个仓库的假设是「`stat -f` 是 BSD 专有，Linux 上会失败，所以有 `|| stat -c %Y` 就安全」。
2026-10-06 在 Ubuntu 24.04 实测：

```
GNU stat -f %m <file>  → stdout 打印整个**文件系统**统计（含"块：总计 245573239"），退出码 1
GNU stat -f%z <file>   → stdout 全空，stderr `stat: 无效的选项 -- %`，退出码 1
GNU stat -c %Y <file>  → 1788192000（正确 mtime）
BSD stat -c %Y <file>  → illegal option，退出码 1
BSD stat -f%z <file>   → 字节数，退出码 0
```

🔴 **上面"-f 不报错"这半句是我早上写错的**（当时把管道的 rc 当成了 stat 的 rc —— §7 第 45 条那一族）。
06 15:4x 在同一台机上重量的读数是 **rc=1**，而这恰好把"哪一处真坏"分了开：

⇒ **单文件那条 `v=$(stat -f %m "$1") || v=""`：rc=1 会真的把 `v` 置空 ⇒ 兜底被走到，旧顺序在这里没坏。**
⇒ **坏的是隔了一层管道的那条**：`find … -exec stat -f %m {} + | sort -rn | head -1` ——
命令替换看到的是 `head` 的 rc=0，而 stdout 是那块非空垃圾，于是 `[ -n "$sm" ]` 成立、兜底永不执行，
拿到的不是"读不到"而是**一个看着像数字的错误值**，"APK 比源码新"这类判据在 Linux 上
静默算错（`apk-freshness` 的臂 2/5/8 全坏，而它自己只在 macOS 上校准过）。
📌 可迁移的判据：**判"兜底是不是死代码"要先问被捕获的那个退出码属于谁** ——
同一条 `||` 直挂命令时兜底活着，中间隔一个管道就死了，而两种写法在源码上长得几乎一样。

正确形状是 **GNU 在前、BSD 在后**（`-c` 在 BSD 上真的 rc=1 ⇒ 兜底会触发；两种形状下都对，所以修没白修）。
已按这个形状修掉 `scripts/lib/apk-freshness.sh`（工单 E2）与 `scripts/upload-dist.sh` 的 `stat -f%z`（工单 E3）；
其余 `stat -f` 站点逐枚分类后的实测结论在 E3 那一行，**不一次铺开**。

---

## 3. 工单与状态

### 批一 · 工程侧（Linux 成一等工作机）

| 号 | 做什么 | 判据（怎么算完） | 状态 |
|---|---|---|---|
| E0 | 载体实测：干净检出 + 逐段跑链，取真读数而不是 grep 推断 | 每段一个 rc，行数 == 段数；红段逐条归因为「平台 / 载体形状 / HEAD 级债」三类 | ✅ **两轮都跑完**。第二轮 96 段全部执行、10 段真红，归因表在 runbook §5.2。第一轮的 17 红里有 5 格是"tar 载体没带 `.git` + 树与 HEAD 不一致"造成的假红。🔴 **第三轮（06 16:2–16:4）把自己的一句归因否证了**：那 5 段 e2e 族我在 §5.2 里除了"工作区没装"还顺手提了"再要 Chromium 运行库"—— 实测 `ldd chrome` 里 `not found` 计数是 **0**、真启动 `LAUNCH=OK`、装好工作区后逐段 rc=0（`ai-e2e` **281 passed / 2 skipped**、`privacy-consent-e2e` 7、`landing-e2e` 22，两条 skip 是 Electron 的 `desktop-window.spec.ts` 自己选择跳过）。⇒ **红段的成因只有"工作区没装"一条**，那句环境归因是没取证就写下的。读数是逐段跑的（`scripts/linux/run-gate-segments.sh`），第四轮 `--all` 全量读数回填在 runbook §5.5。✅ **第四轮已闭合（06 17:1x）**：载体树按 §4 的 ①②③ 重钉到 `615253f3`（`git checkout -f --detach` 后跟踪修改 0 行）、只带本线 21 枚自有文件，`SUMMARY segments=96 reds=6`，六段逐条有"载体 rc / mac rc / 归因"三列。⇒ 批一那句"载体能跑整条门禁链"现在的口径是：**96 段全部执行且每段有日志，6 段红里只有 1 段（`check:image-license`）由 Linux 平台本身造成、且红在别线判据自己的平台假设上，1 段（`check:calendar-evidence-rigs`）是 Linux 上的可移植性缺陷（别线探针，§7 第 370 条），其余 4 段与 Linux 无关**（HEAD 级债 / 别线未入库文档 / 在册的 `RTEST-UNHANDLED-01` / 别线的 `$变量（` 写法）。🔴 **07 04:1x 第五轮只针对壳门禁这一枚**，并改掉一个方法论错误：前几轮"钉 SHA"钉的是 `git rev-parse HEAD`，而工作树里一直有别的线未提交的改动 ⇒ SHA **描述不了那棵树**。本轮改成逐文件摘要对账（两侧各 469 枚、清单摘要同为 `5cf96415a6d52c19`、差异 0 处），再在载体上重打全量产物、复跑严格档：`13/13` + M2 窗口 `SHELL_UI=web-dist` / 2 发落定 / 主蓝命中 `3987`，与第一轮逐字相同 ⇒ "装出来的窗口里是同一个 heyta"这句现在描述的是**当前工作树**。全过程与两条新踩的坑（`COPYFILE_DISABLE`、`LC_ALL=C sort`）在 runbook §5.8 |
| E1 | `check:linux-shell` 加严格档 `HEYTA_REQUIRE_LINUX_SHELL=1`：跳过一律变红 | 四臂实测：mac 默认 0 / mac 严格 1 / Linux 缺依赖严格 1 / Linux 缺依赖默认 0 —— 已取到；载体装齐后的第五臂（真跑绿）等 apt | ✅ 已落。**第五臂已在真 Linux 上取到**：那枚 C↔TS 冒烟第一次真执行 = **13/13 全过、rc=0**（宿主：既有的 Linux 打包机，`-Werror` 下 0 警告）。载体 `linux-dev-lan` 那一格仍等 §3.2 的 sudo |
| E2 | `apk-freshness.sh` 的 `stat` 顺序改成 GNU 在前 | 同一枚 `--self-test` 在 macOS 与 Ubuntu 上都 rc=0 且臂数不变 —— **两端实测都 0 通过** | ✅ 已落 |
| E3 | 其余 `stat -f` / `shasum` / `mktemp -t` / `/Applications` 默认值站点 | 按"Linux 该能跑"与"Linux 本不该跑"分组：前者真修并双端验证，后者改成**响亮说明在哪台机跑**，而不是崩在一个不相干的工具错误上 | ✅ **已收口，而且大部分分母被实测否证成"不是缺陷"**（06 15:4x，读数都在那台 Ubuntu 上取的）。**真修两处**：① `scripts/lib/apk-freshness.sh` 管道那一处（E2）—— 它是唯一**静默给错值**的形状；② `scripts/upload-dist.sh:62/97` 的 `stat -f%z`：GNU 上 rc=1、stdout 全空，而这脚本 `set -euo pipefail` ⇒ 上传在第一个产物那里当场死，症状只是一行 `stat: 无效的选项 -- %`，看不出"这脚本没打算在 Linux 跑"。新增 `file_size()`（GNU 在前、BSD 兜底、两边都取不到就点名退出），**双端各测一次**：macOS 与 Ubuntu 上它对同一文件都逐字等于同机 `wc -c`；负面对照（文件不存在）两端都 rc=1，且消息里 `$1` 紧跟全角括号没吞值（`LC_ALL=C` 下量的，§7 第 64 条那一族）。这枚在本单射程里的理由不是整洁：**批二那个 `.deb` 就从这条通道发出去**。⚠️ 但它归分发那条线，改动一笔可回退、macOS 侧运行时形状逐字未变。**实测非缺陷（原列在待办里，量出来不用改）**：`shasum` 那 8 枚文件 —— Ubuntu 24.04 有 `/usr/bin/shasum`，对同一文件的摘要与 `sha256sum` **逐字相同**；`mktemp -t` 那 2 处 —— GNU 与 BSD 都 rc=0 且给出可用路径，只差文件名形状。**不在本单射程**：其余 `stat -f` 站点与 `/Applications` 默认值都在设备腿 / mac 腿脚本里，Android 与签名的载体是 `windows-pc` 而不是这台；它们在这台 Linux 上的形状是**响亮 rc=1**（`无效的选项` / `illegal option`），不是静默假绿。射程现量：`grep -rl 'stat -f' scripts apps/*/scripts \| grep -v '\.snap\.' \| wc -l`。📌 顺带一条**差点做错的事**：`scripts/.*.snap.<pid>` 那批看着像残留垃圾，实际是 `check:script-snapshot` 的自快照 bootstrap 副本（该门禁刚验过 41 个脚本 + `.gitignore` 全在位）—— 按名字清理会把别人的门禁弄红 |
| E4 | 载体 provisioning 脚本 `scripts/linux/setup-build-host.sh` | 幂等；`--step verify` 只读体检且**缺东西会红**（已在真机验过一次 rc=1）；`--step browser` 覆盖 e2e 三族的 Chromium 运行库 | ✅ 脚本已落；`base/gtk/gui/browser` 四步要用户在载体上 `sudo` 跑一次 |
| E5 | 口径收口：`build-matrix.md` 两处互斥的 Linux 行、`desktop-linux/README.md` 的"12/12""`.deb` 未做""不在 JS/TS 门禁里"三句、AGENTS §2 那行的当前摘要 | 每句改后能被一条现量命令复现；`check:docs` / `check:md-tables` 绿 | ✅ **已收口**：`build-matrix.md` 那行改成 🟡（壳已可构建可运行、但没走 M2；定位 2026-10-06 由产品负责人指令改掉；驱动是载体机 + 自托管，**不是**用户证据）；`desktop-linux/README.md` 三句逐句核实后改写（条数 → 产物自报，`.deb` → 已存在，"不在 JS/TS 门禁里" → `check:native-bare` 已覆盖 C）；AGENTS.md §2 那行的**当前摘要**同步（那个漂过的条数从规则文件里拿掉，换成"由产物自报 + 一条现量命令"）。🔴 **两格刻意没动**：AGENTS §3.2 许可门的**措辞**与 §2 表头"能不能改"那一列属规则本体（要明确要求才动），ADR-0057 与 §3.2 的关系写在 [ADR §4 末尾](../adr/0057-native-system-library-linking.md)。⚠️ 顺带查出的一条边界：`check:md-tables` 只扫脚本里硬编码的 `FILES` 清单（现量：读 `scripts/check-md-table-rows.mjs` 的 `const FILES`），本单新增的三份文档**不在那张表里** ⇒ 它们的表格形状现在只由 `check:docs` 与人工兜着；要不要并进去属文档门禁那条线拍 |
| E6 | `smoke.c` 让它自己打印条数 | 判据"12/12"这种住文档的数字必须能从产物里读出来；改完在载体上跑一次 | ✅ **已落**：`smoke.c` 现在自报 `HEYTA_LINUX_SMOKE=OK n/n`，`check-linux-shell.mjs` 读回它并拒绝 `0/0` 与缺行；在那台 Linux 上重编译重跑实测打印 `13/13`。文档里那个漂过的数字已删，改成"以产物自报为准"，见 `apps/desktop-linux/README.md` 文件头（那里同时记了我把 `grep -c check(` 当条数的那次错） |
| E7 | Linux 进 `reinstall-all.sh` 的固定收尾（第五端） | 段判据：从当前源码重打 `.deb` → 装上 → 起窗，且明写它**只回答**"装上了/起得来/是我们的窗口" | 🔴 **要对齐后动**：那枚文件属于四端重装那条线（B76/B78、隔离检出编排、"缺一端就别装其余三端"的闸门语义），加第五端会改他们的起跑资格判定。本单不擅自改 |
| E8 | runbook `docs/runbooks/linux-dev-box.md` | 每条命令都在那台机实跑过；未跑的一律标"未核实" | ✅ **已成文并回填到 §5.10**（§5.1–§5.4 逐段、**§5.5 的 `--all` 全量读数早已回填**：`SUMMARY segments=96 reds=6` 加 6 段逐条归因 —— 原先这行写"§5.5 留给回填"是**本节自己的漂**，07 05:1x 现量否证；§5.6 否证"借生产机跑门禁"；§5.7 M2 运行取证；§5.8 读数钉在当前工作树；§5.9 `.deb` 打包取证六臂；§5.10 玻璃那格的前提读数）。⚠️ 两格边界不抹：① 各节读数各自**属于它那一棵树**，§5.5 那批钉 `615253f3`、§5.8 起改为钉**内容摘要**（`git rev-parse` 描述不了有别的线未提交改动的工作树），引用前先确认是哪一节；② 里面**留了我两句被实测推翻的原句**（划掉的那半句、以及"Chromium 缺库"那一格），按"改结论要留形"的规矩没有抹掉 |
| E9 | 把"逐段跑链 + 取环境读数"从手工循环变成仓库里的两枚脚本 | `scripts/linux/run-gate-segments.sh`（段清单从 `package.json` 的 `check` **现读**，不抄第二份；断言"跑过的段数 == 清单条数"、断言日志真的落盘、退出码先存变量再打印）；`scripts/linux/probe-chromium-libs.sh`（`ldd` 取缺库 + `dpkg -S` 反查包名 + 真启动一次取原话） | ✅ 已落并各跑过一次：前者现读 96 段、默认那族逐段 rc=0；后者打出 `MISSING=0` 与 `LAUNCH=OK`。🔴 探针第一版是**假的**：拿 `require("playwright")` 去探读到 `MODULE_NOT_FOUND`，而 e2e 只声明 `@playwright/test`、`playwright` 没链到顶层 —— 那种读数长得和"这台机缺东西"一模一样，已在脚本里写成注释 |
| E10 | 把"host-specific 工具静默取到空值"这一类收成**债务账本 + 对账判据**（第四轮照出来的那类空转，§7 第 370 条） | 账本按文件 × 类别记站点，只许减不许增、攒旧账也红；取不到 HEAD / HEAD 里 0 枚 `.sh` / 账本被掏空 三条都响亮失败；`--self-test` 逐臂证明能红（**臂数由它自己打印，文档里不许抄**）；消费者是 `check:linux-shell` 的 ⓪ 组 ⇒ 每个平台都执行。现量：`node research/tools/check-shell-portability.mjs`（它自己报扫了多少枚、多少处） | ✅ 已落：`research/tools/check-shell-portability.mjs` + `research/tools/shell-portability-baseline.json`，双端打印**逐字相同**、`check:linux-shell` 两端 rc=0。🔴 过程中被拦下两次，两次都是**账本自己的口径错**，不是产品：① 第一版按 `git ls-files`（索引）取扫描集 —— 共享检出上索引 ⊃ HEAD，别人 `git add` 过而尚未提交的文件会进账本，干净检出里读不到 ⇒ 那台 Ubuntu 当场报"账本还记着 `server/scripts/backup.sh` ⇒ 攒旧账"，它没说错，是账本错；② 第二版扫描集改对了，但生成账本时**读的是盘上文本** ⇒ 把别人在途的一处 `stat -f` 记成了债。⇒ 现在扫描集与内容都按提交物（`git ls-tree HEAD` + `git show HEAD:<path>`）算，工作树的未提交增量只打一行 ⚠️、不改退出码 —— 否则别人一条正常的在途改动就会把共享链染红。这条边界见 §7 第 372 条。⚠️ 一条**已知摩擦**留给落地时看：账本是单一文件，并行会话同时清债会撞车；缓解只有"生成命令幂等 + 只在提交后重生成"，不做分片 |
| E12 | **载体 provisioning 不再等 sudo**：把 §3.2 那条"人跑一次"的命令变成可选 | `scripts/linux/provision-user-prefix.sh`：清单同源（`shell-modules.mjs --debs`）、`--print-uris` 取 URI → `curl` → `dpkg -x` 到用户态前缀 → 重链悬空 `.so` → 写 `env.sh`；判据是 `--verify` 四枚模块全绿 + 脚本自己 `source env.sh` 复验（新 shell 形状） | ✅ **已落并实测**：07 03:05 复用缓存那一趟 94 枚 `.deb` / 118 枚 `.pc` / 重链 92 条 / 复核悬空 0 / 1.8 s，`--verify` rc=0；从零那一趟 72 s、约 53 MB。⇒ 批一那句"等 sudo"不再是阻塞条件，§3.2 降级成"可选的系统装法"。三个坑（多趟重链 + 重数一遍、`PKG_CONFIG_SYSROOT_DIR`、脚本自身不 export）写在 runbook §1.3 |
| E11 | **壳的依赖清单收成一份真源**（P2 会给壳加 WebKitGTK ⇒ 这一格是先修洞，不是顺带整洁） | 模块名从 `apps/desktop-linux/Makefile` 的 `PKGS` 现读；`.pc → -dev 包名` 的映射只住在 `scripts/linux/shell-modules.mjs` 一份；两个消费者（`scripts/check-linux-shell.mjs` 的缺失点名与补救文案、`scripts/linux/setup-build-host.sh` 的 `--step gtk`/`--step verify`）都向它取。判据：锚点缺失 / 解析出 0 枚 / **Makefile 里有模块而映射表没有** ⇒ 各自响亮失败；`--self-test` 逐臂证明（臂数由它自己打印） | ✅ 已落并**双端实测**：macOS 与那台 Ubuntu 上 `--pairs` 给出同样的 3 对；载体上 `--step verify` 现在按 Makefile 点名 3 枚模块（rc=1，红的就是 pkg-config 那格），壳门禁默认档 rc=0、严格档 rc=1，文案已改成"缺的是查询工具本身，不是这三枚包"（上一版三枚都报"缺 -dev 包"，是**会把人引去多装三包**的误导性读数）。自检里 A3/A4 是这一单的核心证据：**给 Makefile 加一枚未登记的 `webkit2gtk-4.1` ⇒ 必须红；补上那一行映射 ⇒ 必须转绿** —— 也就是 P2 那条"Makefile 与装机脚本各改一半"的洞现在有牙了。⚠️ 顺带一枚新踩的坑：这台 mac 的 bash 是 3.2、没有 `mapfile`，脚本原先会把它读成"模块清单 0 条"，现在开头就挡版本并点名"这台机不是目标平台"（§7 第 237 条那一族） |

### 批二 · 产品侧（Linux 桌面用户装上的是同一个 heyta）

| 号 | 做什么 | 前置 | 状态 |
|---|---|---|---|
| P1 | 许可证裁决：原生系统库这一册 | 无 | ✅ **已闭合**。裁决落在 [ADR-0057](../adr/0057-native-system-library-linking.md)（四条判定线：不进产物 / 不静态链 / 不改上游 / 随发行版走）；登记册 [`docs/reference/native-library-licenses.md`](../reference/native-library-licenses.md)（🔴 **同日一次实测更正**：三枚里真踩在 §3.2 禁止面上的**只有 GTK4**；JavaScriptCoreGTK 那份发行版 copyright 的 `Files: *` 写的是 `BSD-2-clause`（我第一版按上游说法登记成了 LGPL），sqlite3 是 public-domain —— 版本与许可都是从那台 Ubuntu 的 `/usr/share/doc/*/copyright` 现量读来，复现命令写在登记册"怎么复现这三行"一节，且**已在该机上逐条跑过**）；判据 `research/tools/check-native-lib-registry.mjs` 由 `pnpm check:linux-shell` 在**所有平台分支之前**调用（它读提交物文本，没理由只在某台机上跑），自检逐臂证明会红（臂数以 `--self-test` 自己打印的为准，本文件不抄）、且每臂先断言"变异体 ≠ 原体"；🔴 其中"许可格开头改成 `GPL-3+` 而散文不动 ⇒ 仍要红"那一臂是**同日补的**：判据第 ④ 条原来写的是"格内 `includes` 任一宽松名"，而登记册现在逐字抄发行版那份聚合写法（GTK4 那格里就有 Apache-2.0 与 BSD-3-clause-Google）⇒ **一枚 GPL-only 的库会被散文里的宽松名洗白成绿**。实测过旧写法在变异体上确实命中两枚宽松名。现在只取**开头那一个标识符**分类。关键判断不是"放行 LGPL"，而是**这三枚库早就随 `.deb` 发出去了而一张登记表都没有** —— §3.2 两句里"逐项登记"那句此前从未满足。⚠️ AGENTS §3.2 的措辞与 ADR-0057 的适用范围不一致，同步它属规则本体改动（要明确要求才动），两份的关系写在 ADR §4 末尾 |
| P2 | Linux 壳走 M2：GTK4 + WebKitGTK 载包内 `web-dist`；同时翻 `check-shell-surfaces.mjs` 里 **L2 反向核对**那一钉与台账里 Linux 那行（`gap` → `reachable`），改成与 mac/win 同构的 D1–D4 | P1 | 🟡 **代码与运行都成立，台账那一格还没翻**（07 03:4x）。运行读数：`check:linux-shell` 新增的第 ④ 档真起窗口 → `SHELL_UI=web-dist` → 2 发落定（`port=1 backend=shell clientId=mux2v846 mounted=1`）→ 快照 900x523 非空白、主蓝命中 3987，**人打开看过图**（`apps/desktop-linux/evidence/linux-m2-webdist.png`）。四个卡点逐条有读数与最小复现装置（`src/webview-load-probe.c`），全部写在 runbook §5.7：① bwrap/userns 致命 abort；② **门面的 JSC 上下文先于 WebView ⇒ WebKit 一次加载信号都不发**（壳因此拆成 `heyta_web_new` → 门面 → `heyta_web_load`）；③ `crossorigin` 的模块脚本要 `Access-Control-Allow-Origin` 响应头 + scheme 声明为 cors-enabled；④ 自定义 scheme 下 module worker 构造即失败 ⇒ 共享层 `migrateLegacyOpfsSqlite` 永久挂死（**这一条是它自己第五条守卫"失败不阻断启动"没兑现**，已按原意修 + 新增判据 `apps/web/tests/legacy-opfs-worker-failure.spec.ts`，变异复现是"超时"）。⚠️ 台账曾留 `wired-unverified` 的**唯一**原因是"装出来的 `.deb` 里那份 web-dist"那一格（P4，不是运行没证）—— 🔴 **07 04:4x 那一格已由 P4 补上，Linux 那行现在是 `reachable`**，与 mac/win 同构走 D1–D4，读数见下面 P4 那行。🔴 07 04:1x **第二轮读数**把那三行钉到当前工作树（逐文件摘要两侧同为 `5cf96415a6d52c19`、差异 0 处，然后在载体上重打全量产物再跑）：`13/13` + `SHELL_UI=web-dist` + 2 发落定 + 主蓝 `3987`，与第一轮逐字相同 ⇒ 过程与两条新坑见 runbook §5.8 |
| P3 | 窗口判据从「非空白」升级成「非空白且主蓝命中」 | 与 P2 **同批** | ✅ **已落，并带一条实测出来的边界**：判据在 `check:linux-shell` 第 ④ 档（复用零依赖的 `scripts/screenshots/png-stats.mjs`：`looksBlank` + `countBrandBlue`）。🔴 但**共享 UI 的启动屏本身就是一块品牌蓝 logo** —— 实测启动屏命中 3858 / 挂载后 3987 ⇒ 在这一端「非空白 + 主蓝」**分不开"卡在启动屏"与"应用真起来了"**（§7 第 82 条那一族的新一面）。承重的是页侧那行 `M2_SETTLED_AFTER`，像素那两条只挡"有结算行但画布是空的"；这条边界写进了门禁输出与代码注释。判据能失败已证：把 `apps/web/dist/index.html` 换成空 `#root` 的桩 ⇒ `MUT_RC=1`（红在"到点没落定"），还原 `cmp` 逐字相同后再跑 rc=0 |
| P4 | `.deb` 进固定流程：`build:linux` 入口、包内 web-dist 的新鲜度对账 | P2 | ✅ **三格全落，且解包态窗口真跑过一次**（07 04:4x，读数与两条产品缺陷在 runbook §5.9）。上一行那段"缺哪一格"的现量是**准的**（旧脚本确实一处都没装 `apps/web/dist`），它列的三格逐条对上了：① **web-dist 进包** —— `cp -R` 到包内 `/usr/share/heyta/web-dist`，安装布局改 FHS + **可重定位**（`/usr/lib/heyta/` 放二进制与 `native-bridge.js`，`/usr/bin/heyta` 那行 wrapper 按 `dirname "$0"` exec，因为写死绝对路径的话**解包态取证就跑不起来**）；② **缺席就红** —— 发起方那侧 `RESULT=WEB_DIST_MISSING` 直接拒绝产出；③ **字节对账** —— 两道：目标机那份 ↔ 发起方那份（`PKG_FRESHNESS=OK`）、包内那份 ↔ 本工作树（`PKG_FRESHNESS_INPACKAGE=OK` + `PKG_INDEX_SHA=bbd08932…68f9a9ef` 与本机 `apps/web/dist/index.html` 逐字相同）。台账因此翻 `reachable` 并进桌面三端的 D1–D4 循环（格数与未取证栏**请现取**：`node scripts/check-shell-surfaces.mjs` 自己打印 `判定 N 条 / M 格…未取证 K 栏`，K 是"本机有没有本轮产物"的属性而非仓库属性；本轮实测的是**包这一侧的未取证从 3 栏降到 2 栏**）。**入口**：根 `package.json` 的 `build:linux`（目标机透传），且**默认远端是生产机那一档被拿掉**（§8）。六臂变异各实测（逐臂读数在 runbook §5.9）：删 `cp -R` 那行 → D1 红；事实行 `PKG_SHELL_UI` 改 `fallback` → D4 红点名；生产方 `FACTS=` 改名 → 断言 A 红（两侧名字对账，G14 那一族）；阳性对照 rc=0；**把事实文件整个挪走** → 未取证 3 栏而 rc=0（响亮跳过不算通过）；再叠 `HEYTA_REQUIRE_PACKAGED_ARTIFACT=1` → rc=1 点名 `[desktop-linux] countdown · 产物`。🔴 同一轮修掉汇总行的一处**分母撒谎**：它把判定**记录数**当**格数**印，而 Linux 一格带两条判定（D 档 + L1/L2），"6 格（面 × 端）"里有一格被数了两遍（现量 distinct = 5）⇒ 改成 `判定 6 条 / 5 格`，红绿仍按记录计（一条红了就是红了，不能被同格另一条绿了摊平）。🔴 **这一格真正产出的两条是产品缺陷**，都藏在"从没被执行过的分支"里（`heyta_web.c` 的 FHS 候选少一层 `..`、`main.c` 的桥默认值是裸相对名 ⇒ 吃 cwd），形状与教训记成陷阱 **#384**。⚠️ 边界三条不包装成完成：装进系统（`dpkg -i`）那格**没做**，取证走 `dpkg-deb -x` 的免 root 临时根；`PKG_BLUE_HITS=3987` 与 P3 那条"启动屏同值"的边界**没被消掉**，承重仍是 `PKG_SETTLED=OK`；沙箱档 `PKG_SANDBOX=on` 仍等 §7 第 1 条那行 sudo |
| P5 | 重判 ADR-0042 的"Linux 放弃玻璃" | P2 | ✅ **重判完成，判的是那句理由而不是结论**（07 05:1x，读数与复现命令在 runbook §5.10，裁决写进 [ADR-0042 §6](../adr/0042-glass-material-boundary.md)）。M2 之后 Linux 的内容面在壳内 **WebKitGTK 6.0** 的 WebView 里，而旧结论的理由写的是"GTK4 无 backdrop blur 能力"—— 主语换了。实测（`webview-load-probe.c` 新增 `PROBE_BACKDROP=1`）：`{"bf":true,"webkitBf":true}` ⇒ 那条**理由**在这一层不再成立。🔴 **六条结论一条没改**：① `CSS.supports` 只答"认不认属性"，真合成在 Xvfb + cairo 软件路径上糊不糊**没取证**；② §4 那条"tint 在最坏背景上 ≥4.5:1"与 `prefers-reduced-transparency` 降级**没做**；③ 另外三条否决项（可读性 88% 事故前科、滚动列表合成开销、端能力协商只许住 `MaterialSurface`）与本读数无关，仍然有效。⇒ 要在 Linux 内容面开玻璃 = **新写一份 ADR 承接**，不在 §3 里动第 5 条（已接受的结论不改，这是本仓的硬纪律）。探针在 `-Werror` 下 0 警告（`BUILD_RC=0`） |
| P6 | 凭据落盘回到 ADR-0040 | P2 | ✅ **这一格已回答完（06 15:5x，不需要等 P2）**，而且答案与"要不要接线"无关：**链上它不违反 ADR-0040**。三条实测/文本依据 —— ① 现量 `apt-cache show libwebkitgtk-6.0-4`：`libsecret-1-0 (>= 0.7)` 是**硬 Depends**（2.52.6 与 2.44.0 两个版本都一样），不是 Recommends ⇒ P2 一接 WebView 它就随闭包进 `.deb`，届时必须连同 webkit 那一行一起登记；② [ADR-0040](../adr/0040-email-password-auth-decoupled-from-e2ee.md) §3.2 那条裁决管的是"**我们自己的口令字节住在哪**"（不得以可读形式落盘；OS 级加密托管属允许类），不是"进程链接了哪些 `.so`"；③ Linux 壳今天**根本没有凭据路径**：`grep -rn 'serverUrl' apps/desktop-linux/src/` 与 `grep -rin 'password\|credential\|secret' apps/desktop-linux/src/` **各 0 处命中**（这是接线后要盯住别上升的基线）。🔴 顺带照出一处**过期理由**：ADR-0040 那行给 Linux 的理由是"定位=同架构但不做专项功能"，那句已被 2026-10-06 的指令改掉 ⇒ **结论（不做）可以维持，但不能再拿那句当论据**；改已接受的 ADR 要新写一份，本单不动它，要重判时写 ADR-00NN 承接 |

### 3.1 P2 开工前必须知道的三条实测约束（2026-10-06 现量）

1. **WebKitGTK 6.0 不是"再加一个 pkg-config 条目"**。`apt-cache show libwebkitgtk-6.0-4`（Ubuntu 24.04，`2.52.6-0ubuntu0.24.04.1`）的 `Depends` 是 **~50 枚运行时包**：`gstreamer1.0-plugins-base/good`、`bubblewrap`、`xdg-dbus-proxy`、`libgles2`、`libenchant-2-2`、`libhyphen0`、wayland 全家，以及 P6 说的 `libsecret-1-0`。`.deb` 的运行时依赖从 3 枚涨到 50 枚 —— 这是要称重的成本，不是接线细节。装 `-dev` 的干跑显示 `1 upgraded, 47 newly installed`（**会顺带升级一枚已有包**）。
2. **能装包的验证载体只剩一枚**。既有的 Linux 打包机 `sanjiaozhou` **是生产机**（Caddy 跑着 litopia/SSOS、postgresql、几十个容器、还挂着 mihomo）⇒ 在它上面"取凭据 / 编译 / Xvfb 起窗截图"是文档化的既有用法（本单那个 13/13 冒烟就是在它上面取的），**往它上面装包不行**。本机 Docker 那条路意味着几百 MB apt 字节要过代理额度，与"跑门禁这件事不再经过 mihomo 额度"那条既定约束冲突（讲当前载体 `gate:ssh` 的那一节**尚未入库**，所以这里不写章节号，否则在干净检出上就是一枚死引用），不作默认。
3. **顺序是刻意的**：`libwebkitgtk-6.0-*` 进 `Depends` 与进登记册那一行**必须同批** —— 由 P1 那枚对账双向钉住（早登记红、漏登记也红）。翻 L2 反向钉也在同一批，否则要么门禁红、要么台账变成一句假声明（G11/G12 两臂就是钉这两格的）。

### 3.2 P2 唯一的起跑前置 = 一条命令（人跑一次）

```bash
ssh -t linux-dev-lan "sudo -b bash -s" -- < <(ssh linux-dev-lan 'cat ~/heyta/scripts/linux/setup-build-host.sh')
# 复验
ssh linux-dev-lan "bash -lc 'cd ~/heyta && bash scripts/linux/setup-build-host.sh --step verify'"
```

回退：`ssh linux-dev-lan 'sudo apt-get remove --autoremove -y libgtk-4-dev libjavascriptcoregtk-4.1-dev libsqlite3-dev xvfb imagemagick'`。
跑完 `--step verify` 全绿 ⇒ `HEYTA_REQUIRE_LINUX_SHELL=1 pnpm check:linux-shell` 第一次真跑，之后 P2/P3/P4 一路验到底。

---

## 4. 边界（读这节，别把上面的表读成"都做完了"）

1. ~~批一不等于"Linux 桌面用户能用"……Linux 用户装到的仍是那条只有任务列表的手写壳。~~
   🔴 **07 05:2x 现量改写**：这一条在批二 P2/P4 落地后**换了内容而不是消失** ——
   装出来的 `.deb` 里现在是共享 UI（`PKG_SHELL_UI=web-dist` + 包内字节 sha256 对账 + 解包态真窗口）。
   仍然成立的边界是：**装进系统**（`dpkg -i`）这一档没做，取证走的是 `dpkg-deb -x` 的免 root 临时根；
   以及"跑起来能用什么"由**共享层的功能模块开关**决定，与 web 端同口径，本端没有单独放行任何一面。
2. **P1 没过，P2 一行都不许动**。给 `.deb` 加 WebKitGTK 是加一条对外承诺的依赖，不是加一个 pkg-config 条目。
3. **E7 是对齐项，不是 TODO**。它改的是另一条线的起跑闸门语义。
4. ~~e2e 那三族门禁在 Linux 载体上要等 apt 装完 Chromium 运行库；那一步要 sudo，由人跑。~~
   ✅ **07 05:2x 现量否证并已改到 §7 第 2 条**：那五段在载体上逐段 rc=0，而 `ldd` 里 `not found`
   计数为 0、真启动 `LAUNCH=OK` ⇒ `--step browser` 那一半**没有被证明是必需的**，更不需要 sudo。
5. **载体读数是"钉住的那一枚 SHA + 本单几枚改动"的读数**，不指当前 main；跨检出引用请写 `origin/main` 并现量。
   ⚠️ 07 04:1x 起这一条换了钉法：**钉的是投送集合的逐文件摘要**（`git rev-parse HEAD` 描述不了
   有别的线未提交改动的工作树），理由与命令在 runbook §5.8。
6. 共享检出仍有其他写入者（本次实测起手 300 个未提交路径，跑链期间 HEAD 从一枚 SHA 漂到另一枚）⇒ 全量验收固定在隔离副本上做，读数带"哪一棵树"的限定语。
   🔴 07 05:2x 这一条**对本轮自己成立**：主检出的 HEAD 在收口期间被并行会话从 `10cf58d3` 推到 `cdcc3415`，
   而本单全部改动仍是未提交工作树 ⇒ 本轮没有重跑整条 `pnpm check` / `pnpm -r test`
   （那要在别人的树里抢 CPU 且结论不可归因）。**逐条重取的是本改动碰到的那八道**：
   `check:shell-surfaces` rc=0、登记册 `--self-test` 8 臂 0 不如预期、A8 `--self-test` 9 枚 0 不如预期、
   `mutate-shell-surfaces-anchor` 10/10、`check:md-tables` / `check:doc-citations` / `check:docs-voice` 各 0、
   `check:layering` 0、`check:native-bare-values` 0；载体侧 `HEYTA_REQUIRE_LINUX_SHELL=1` 严格档 0
   （`13/13` + M2 窗口档成立）与整条 `.deb` 重打 + 事实回传 + 门禁复跑 0。
   ⚠️ 两格红**不属于本单**：`check:shell-unicode`（别线两枚脚本，见 §4.1 那张表）与
   `check:docs` 的"本机有、仓库里没有"（本单未提交文档自身，提交即消）。
7. **`capture-window.sh` 采的是 M2 之前那一屏**，重跑会被新加的主蓝判据判红（现量：旧原生屏 0 / 两张 M2 图 3987）。
   把它重定向到 M2 要连 `scripts/screenshots/targets.mjs` 的 `methods` 与既有证据归属一起改 ⇒ 排在 E7，
   本轮只做了"它不会再把回退屏判成通过"与"默认远端不再是生产机"。

### 4.1 本单照出来、但**归属在别人线上**的格子（只登记，不代改）

> 条数不写在这里（写死就会漂）。现量：`sed -n '/^### 4\.1/,/^## 5\./p' docs/plans/linux-adaptation.md | grep '^|' | awk -F'|' '$2 !~ /^ *(格|-)/ {n++} END{print n}'`（先 `grep '^|'` 是为了把那行现量命令自己排除掉 —— 它里面也有竖线，不排除会把自己数进去）

| 格 | 现象与复现 | 归属 |
|---|---|---|
| `pnpm -r test` 在任何"tar 送源码"的载体上必红 | `@heyta/landing` 那条判据要求 `origin/main` 这个 ref 真存在；`gate-ssh.mjs` 与本次载体都是 tar 形状 ⇒ 链尾那格红的不是产品。**载体侧已修**（带上 `.git`），**判据侧没动** | 落地页那条线 + CI 载体那条线（[ci-and-runner.md](../runbooks/ci-and-runner.md) 讲当前载体形状的那一节该补这一句；那一节尚未入库，故不写章节号） |
| `check:image-license` 在 Linux 上判红：`@node-rs/argon2-linux-x64-gnu@2.2.1` "已经在扫描集里 ⇒ 豁免不再成立" | 复现：那台 Ubuntu 上 `pnpm check:image-license`（macOS 同门禁 rc=0）。根因是**登记的理由本身锚在写它的那台机上** —— `why` 原文是"本机（darwin-arm64）的 pnpm store 里没有它"（`check-image-license-coverage.mjs:90`）。🔴 **而照它打印的补救（"删掉这条登记"）会把 mac 弄红**：快照 `server/image-npm-tree.json` 里有这一条、mac 扫描集里没有 ⇒ 走到 `:512` 那个"覆盖 + 豁免 + 第一方 == 树的总数"的算术恒等式就不闭合（读码推论，未做变异复现）。⇒ 需要的是**按平台分档**，不是删除 | 镜像/许可那条线。这是**判据口径**，本单不代裁 |
| `check:calendar-evidence-rigs` 在 Linux 上自我校验 4 臂红、mac 上三段全 rc=0 | 成因只有一行日志：`research/tools/r17-reshoot-stale.sh: 行 134: md5: 未找到命令` —— `md5` 是 BSD/macOS 命令，Linux 那枚叫 `md5sum`（载体 `command -v md5` 空）。于是每张 png 的摘要都是**空串** ⇒ 前后指纹必然全等 ⇒ "动了哪张图"读成"没动" ⇒ 那枚"零信号必须红"的腿正确地响了。复现：`bash research/tools/r17-reshoot-stale.sh --selftest` | 日历/reshoot 那条线 |
| 🔴 同一枚 `md5` 平台差异在**另一枚臂脚本里方向是反的**：`calendar-line-commit-only-arms.sh` 里那些裸 `md5 -q` 测的是「文件 md5 **前后一致**」，Linux 上两边都是空串 ⇒ **恒等成立 ⇒ 那几臂在这台机上没有牙**，而它照样打印 `合计 pass=36 fail=0`。最大的一处是 `research/tools/r17-evidence-md5-check.sh`，而 `r17-reshoot-stale.sh:105` 明说解析形状"逐字抄"这枚规范裁判 ⇒ **空转面会跟着抄过去**。各处站点数**不抄在这里**，用 runbook §5.5 那条 `uniq -c` 现取（带管道，写进表格单元格会被当成列分隔符 —— `check:md-tables` 判的就是这个）。摘要值两端逐字相同（`9009bb…`，同一节有现量）⇒ 改的是探针不是判据；仓里已有先例形状 `r14c-carrier-chain.sh:74-81`。✅ **06 已加守卫**：`research/tools/check-shell-portability.mjs` + 账本 `research/tools/shell-portability-baseline.json`，挂在 `check:linux-shell` 的 ⓪ 组（每平台都跑），工单见本节 E10 —— 守卫**记的是债、不替各线改**：这些脚本仍属它们的所属线，本单枚都没代改 | 上述几条脚本的所属线（日历/reshoot、规范裁判、以及那条 `uniq -c` 打出来的每一枚）；本单**一枚都没代改** |
| `check:md-tables` 在**干净检出**上红、在这台 Mac 上绿 | `docs/plans/trash-and-archive.md:744` 格内反引号配不成对。Mac 绿只因为那棵树里躺着未提交的修改 | 回收站/归档那条线 |
| `check:docs` 在载体上报 12 死链 + 2 处章节失效，**没有一条是 Linux 缺陷** | 那 12 条目标文件在 Mac 是 `A`/`AM`（已暂存未提交），而链接行本身在 `git show HEAD:docs/README.md`、`HEAD:docs/plans/README.md` 里 **0 命中** ⇒ 只活在 Mac 工作树里。⇒ 那两条 README 一提交，干净检出上这 12 条就会由"本机有仓库没有"变成真死链，**CI 会红**。复现：载体 `pnpm check:docs` 对照 mac 同门禁。**07 04:0x 现量：同一形状、数目变成 24 处"本机有、仓库里没有"，而真死链 0、失效锚点 0**；**07 04:5x 复量 = 26 处；05:2x = 29 处**（每加一条指向本单未入库文档的链接就 +1 —— 这数**会随"谁还没提交"移动，取现量别抄它**：`node research/tools/docs-link-check.mjs | grep -cE '^      -> '`）。 —— 其中若干条的目标正是本单的 `docs/plans/linux-adaptation.md` / `docs/runbooks/linux-dev-box.md` / `docs/adr/0057-*.md` / `docs/reference/native-library-licenses.md`，**本单一提交它们自己就消**；其余属另外那两条线 | 个人中心 / 产品 UX 那两条线（各自的文档入库时顺带消）+ 本单那几枚 |
| 🔴 **跨线口径冲突（本单照出来、但不属本单裁）**：Windows 那侧的许可登记表写着"heyta 自己的界面**不用 WebView**（原生性是本决策的前提）"，而 [ADR-0037](../adr/0037-desktop-ui-falls-back-to-webview.md) 定的 M2 就是"原生壳 + **壳内 WebView** 加载共享 `web-dist`"，Windows 端今天也真的在 WebView2 里跑 `apps/web/dist` | 复现：读 `research/tools/license-policy.mjs` 的 `REVIEWED_LICENSE_FILE_PACKAGES['Microsoft.Web.WebView2']` 那句，与 `scripts/check-shell-surfaces.mjs` 文件头 D1–D4（桌面三端判的就是 web-dist 通道）并排看。那句话当时登记的是"依赖树里的一环"，写下的断言却比登记的更宽 —— **它现在是假话**，但改它等于改许可口径，属镜像/许可那条线 | 许可登记那条线（本单不动它，也不替它改写） |
| `check:shell-unicode` 在 **HEAD 上就红**，且红的不是本单的文件 | 复现：`node scripts/check-shell-unicode-vars.mjs`（红在 `scripts/verify-mobile-habits.sh:138/166/168/169…`，`$label`/`$blue` 紧跟全角括号 ⇒ 证据行丢值，§7 第 64 条那一族）。这枚是 H12 那笔提交（`cd546407`）带进来的，**不是** Linux 适配带来的，而它的 `verify:mobile-habits` 入口在 HEAD 上是**活的**（现量：`git show 615253f3:package.json` 里有这一行、`git show 10cf58d3:package.json` 里没有 ⇒ 是**新增**不是删除）。本单不动它；`upload-dist.sh` 里新加的 `$1（` 是位置参数、只吃数字，故不在这枚的射程内（双端实测打印正常）。🔴 **07 05:1x 复量：红的仍是这两枚**（`verify-mobile-habits.sh` + `scripts/h12-shot-set-arms.sh:43`，后者原先这行没列，补上免得下一个人按本行去找第三枚）。**本单自己那两枚已收清**：`package-deb.sh:360` 一枚、`scripts/linux/provision-user-prefix.sh` 五枚（49/82/120/186/192）⇒ `$x（`/`$x：`/`$x。` 全部改成 `${x}`，`bash -n` 双双 rc=0，门禁复跑不再点名本单文件。顺带同族一条：**`package-deb.sh` 与 `capture-window.sh` 这两枚**（与上面那两枚不是同一对）各有一处**双引号内的反引号**被 bash 当命令替换执行（护栏消息跑了它警告的那条命令），已改掉并入册陷阱 **#386**；同一枚扫描器在全仓还报出若干**别的线的脚本**里的同形状候选，本单没代改，复现命令写在 #386 里。
| `docs/reference/build-matrix.md` §"打包机矩阵"里 **macOS 桌面 / Windows 桌面两行仍写"🔲 未规划 / 选型未定"**，而 AGENTS §2 那两行明明写着两个原生壳都"✅ 可运行" | 复现：并排读 `docs/reference/build-matrix.md` 的 §7 那张五行表与 `AGENTS.md` §2 的 `apps/desktop-macos/` / `apps/desktop-windows/` 两行。本行只把**同表里的 Linux 那一行**改成了当前读数（07 05:1x），另两行属桌面原生化那条线的口径，**没代改** | 桌面原生迁移那条线 | | 习惯/移动端载体那条线（H12） |

## 5. 相关

- 操作与实测读数：[Linux 载体操作手册](../runbooks/linux-dev-box.md)
- 门禁链与 CI 载体：[ci-and-runner.md](../runbooks/ci-and-runner.md)（其中"当前载体 `gate:ssh`"那一节尚未入库，本单不引它的章节号）
- 桌面壳的既定路线：[multi-end-unified-strategy.md](multi-end-unified-strategy.md) §4.3、§6.3
- 壳级通道判据：`scripts/check-shell-surfaces.mjs` 文件头（含 13 臂故障注入配方）
