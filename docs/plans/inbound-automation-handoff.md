# 交接：付费自动收集（inbound automation）交付收尾

> 这份只记**当前停在哪、下一步按什么顺序做、哪些路已经走死**。
> 决策与理由不在这里：计划 [`inbound-automation.md`](inbound-automation.md)（唯一实施计划，文末是逐格台账）、
> 判据与口径在 `AGENTS.md` 与 [`docs/agents/`](../agents/)、逐条阻塞在 [`../../BLOCKED.md`](../../BLOCKED.md)。
> 写这份的当刻：**2026-10-19 18:0x**；**本节最后一次刷新：2026-10-20 19:5x**（写前先跑 `date`，本轮交付 tip 现量 `git rev-parse --short refs/heads/main` ⇒ 现量为准；本笔落成的合并提交是 `f611b9caa`（父 `606113e10` + `5f27a8705`））。**本线一格都没勾、没 push**（现量见 §6）。
> 🔴 **11:4x 这一戳刷的是"腿 3 那一格已经不再是等机器"**：负责人 11:0x 把打包机开了，腿 3 于 11:16:00→11:39:47 跑完，mac／windows／ios 三腿有"当前产物"判据，**android 腿按 §7 第 7 格的丙显式跳过、留一枚 `⏭` 交下一位**。原件 `~/.heyta-evidence/inb-t7-1017-0902/leg3-1020-1101/`，逐腿读数在计划文末「2026-10-20 11:1x–11:4x · 打包机回来了」那一节与 `PROGRESS.md` 第 152 条。
> 🟢 **19:5x 这一戳刷的是「两格拍板已由负责人交给我做完 + 分支已合并」**：五张装机图逐枚看完（结论在 §5「人真打开看过截图」那一格与 `PROGRESS.md` 第 156 条 ②③），§7 第 7 格的三选一**选甲并已落地**（`scripts/reinstall-all.sh` 的 android 段现在有设备身份判据，七臂读数在 `~/.heyta-evidence/inb-t7-1017-0902/merge-1020/android-gate-arms/`，现量 `grep -c HEYTA_ANDROID_AVD scripts/reinstall-all.sh` 不再是 0）；`feat/paycenter-integration` 的 48 笔已按产品经理口径并入 main（提交 `f611b9caa`）。⚠️ **android 那一端仍然没有「当前产物」读数** —— 判据只能拒绝猜，变不出一台设备：汇总里 `✅=3 ⏭=1 🔴=0` 这个形状没变，§2 那句「四端当前产物齐」还是不能说。
> ⚠️ 上一戳（10:3x）那句"接手人不要重跑电池"**仍然成立**：§1／§4／§5／§7 那批读数仍来自 05:09 那趟 28 腿电池（原件 `~/.heyta-evidence/inb-t7-1017-0902/batt-tip-1020/`）。本戳动的是腿 3 与 Linux 取证，**没碰电池、没碰链**——本线那两把尺的射程各写各的（见 §4「AC 那半」）。

---

## 1. 一句话接手（先读这三行）

1. **这一档功能在代码层是齐的，缺的全是"证据 + 人 + 机器"**：AC-1～AC-8 每格都有可复跑命令与当日读数，
   而且**命令与逐字输出现在都在仓里**（按格分组的命令见下面 §4a；今天那两批的逐字输出搬进计划文末「2026-10-19 21:3x · 完成条件 1 里"贴出的输出"那一半，从家目录搬进仓里」那一节 —— 此前**当日那批**输出只躺在家目录，clone 的人只能看到 10-10／10-11 那两张旧戳）。
   但**勾选权在负责人**，而"四端当前产物"里**只剩 android 那一端复不出来**——windows 端 10-20 11:36 已经有当前产物判据（腿 3 的 mac／windows／ios 三腿 `REINSTALL_RC=0`，见 §5 第一格的 11:0x 改口与计划文末那一节），android 那一腿是本线自己登记的红线（§7 第 7 格），不是机器的问题。
2. **接手第一件事**：§4 那枚原本"在途"的 116 道链**已跑完并写进台账**（末行 `CHAIN ran=116/116 RED=3 steps=[63, 87, 106]`），28 腿电池也已刷到 10-20 05:09 那一戳（结论行 `legs=28 rc0=27 rc_nonzero=1`，唯一非 0 是 B205 那枚范围尺），**腿 3 已于 10-20 11:16–11:39 跑过一趟（三腿绿、android 留 `⏭`）、Linux 取证已在其后重取**（`DEB_RC=0`／`PKG_RESULT=OK`）⇒ 直接从 §8 的第 2 步往下做：**问负责人 §7 现在开着的那六格**，其中**第 7 格（android 三选一）是四端里唯一还缺"当前产物"的那一端**——甲／乙 一条都不落地就还是丙，别把"打包机通了"读成"四腿都能点了"。**别重跑电池、别重跑整条链、也别为纯文档笔重跑腿 3**，除非 §4a／§5 里那两条分母规则说该跑。
3. **不要碰**：判卷口径（B199／B239 那两格等负责人；**B241 已按负责人自己那条旧令的默认支闭合，见 §7 第 1 格**）、`packages/i18n`、别人的红（本戳链内三枚全归他线）、
   别人的载体与提交。

---

## 2. 产品意义上这一档是什么（给零上下文的接手人）

用户流程（计划的「用户流程与信息架构」节）：**设置 → AI 与集成 → 自动收集** 里启用，
建一条规则（来源、目标清单、时区、允许的操作、解析预览、暂停开关），
系统在外面来东西时**自动把它变成待办**——邮件跟进、会议行动项、表单线索、工单、课程表、预约通知、阅读摘录、家庭日程。
付费的是"无人值守 + 服务器替你收"这件事：`hosted-ai-monthly`（¥12／$12）这一档授予的能力含 `automation`。
自托管免费，但同一条权益契约要走通（不能只在前端藏按钮当付费限制）。

**这一轮交付对产品的意义**（不是"写了代码"，是"哪句话现在敢对客户说"）：

| 敢说的 | 凭什么（可复跑） |
|---|---|
| "接收是有凭据的、拿不到明文" | 签发端 Ed25519 一次性票据 + 字节级签名验收；`python3 research/tools/verify-inbound-ac-battery.py --root . --ev <目录> --only AC2` 那几腿（逐腿读数在计划文末台账） |
| "额度用完了不会白扣、也不会偷跑" | AC-1 真库读数：无权益那一面 **402 且零事件落库**（同一趟里额度耗尽是类型化拒绝） |
| "崩了不会留半批、不会重复建" | AC-3 两个独立真实宿主 + 独立数据库跑完全部故障窗口；AC-5 多字段多项只产生**一枚逻辑 op**、中断重启无半批 |
| "同一封邮件在别的时区不会变成别的日期" | AC-4 同一事件跨时区／跨处理日归一化结果相同，DST 与非法日期有界 |
| "用户在界面上能自己走通：启用 → 测试发送 → 等待 → 打开/解锁 → 自动处理" | AC-6 的浏览器腿（`8 passed`，隔离载具读数）+ 界面挂载点已入库（B140 那三点，见 §3 表） |
| "未上线的能力没有被写成上线" | AC-7 那族文档尺（枚数现量：电池 `--list` 里 `AC7-` 前缀那几行） + `pnpm check:docs`、`check:public-facts`（匿名 GET 只有四枚，接收路径不在其中） |

**还不能说的**：不能说"四端当前产物齐"（**三端齐、android 那端 10-20 11:3x 仍复不出来**——它缺的不是机器，是 §7 第 7 格那条设备身份判据／当轮授权）、不能说"公网接收已在生产开通/未开通" 🟡 **19:5x 这一句的后半按负责人授权改口**（旧文留着，因为它那格还有活职能：三端齐这件事没变）：android 那端"复不出来"的原因**已经换了一次**——11:3x 那戳说的是「缺设备身份判据／当轮授权」，而 19:5x 那条判据**已落进脚本**（§7 第 7 格选甲并执行完），所以现在缺的**只剩一台身份可指认的模拟器**（本机 `adb devices` 回 0 台、打包机侧没有 emulator 本体与 system-images）。翻案条件：负责人起一枚属于本线的 AVD，或给乙一句当轮授权，那一端当场能出读数。
（那是运营事实，本线没取过生产侧证据）、不能说"AC 已验收"（一格都没勾）。

---

## 3. 已完成（本轮，全部本地入库）

> 🟢 **10-20 10:3x 刷新时补一句"这一轮最后动的是什么"**（免得接手人以为下面那张表就是最新状态——那张表停在 10-19 18:0x）：
> 之后落了三笔（现量 `git log refs/heads/main --format='%h %ad %s' --date=format:'%m-%d %H:%M' -3`）：**§8 第 3 项那条腿 3 runbook 的两处自纠**（判据那行原本读的是 `tee` 的 rc ⇒ 永远不会红；四端截图原本落脚本默认的 `/tmp` ⇒ 负责人要看的原件第二天就没了，现改成 `HEYTA_REINSTALL_TMP_DIR="$EV"`）＋ 台账第 149 条、**28 腿电池刷到交付 tip**（`legs=28 rc0=27 rc_nonzero=1`，唯一非 0 是 B205 范围尺）＋ §4a 那张表的"最近一次当日读数在哪"整列改指这一戳 ＋ 台账第 150 条、**§8 第 4 项写明 Linux 取证不必为文档提交重跑**（八枚构建输入路径各 0 行，附现量循环）。
> 交接口径：这三笔之后**本线没有待跑的验证**——剩下的全在 §5（等机器）与 §7（等人拍）。
> 🟢 **11:4x 这一轮：上面那句"等机器"那一格已经解掉，动的是腿 3 本体**（写前先 `date` ⇒ `2026-10-20 11:43:43`；现量 `git log refs/heads/main --format='%h %ad %s' --date=format:'%m-%d %H:%M' -1` 看本线最新那笔）。三件事：**腿 3 三腿跑出当前产物判据**（`REINSTALL_RC=0`，11:16:00→11:39:47，汇总 `✅=3 ⏭=1 🔴=0`——那枚 `⏭` 就是 android，按 §7 第 7 格的丙**故意留**的）；**Linux 交付取证在其后重取**（`DEB_RC=0`、包内 `PKG_INDEX_SHA` 与 Windows 包内 `PAYLOAD_INDEX_SHA`、与载具 `apps/web/dist/index.html` 的 sha256 **逐字同一枚** ⇒ 三个壳吃的是同一次 web 构建）；**iOS 段又当了写者并按名还原**（`Podfile.lock` 与 HEAD 差 2 行，diff 归档后 `checkout --` ⇒ 载具 `dirty=0`、tip 未动）。逐腿读数、五枚截图的绝对路径与 md5、两枚新踩的坑都在计划文末那一节与 `PROGRESS.md` 第 152 条。
> 🔴 **这一轮之后剩下的一格变了形状**：不再是"等机器 + 等人拍"，而是**只剩等人拍**——其中 §7 第 7 格（android）是四端里唯一还缺当前产物的那一端，第 4 格与第 7 格都涉及别人的资产或别人脚本的判卷口径。

| 做了什么 | 产品上意味着 | 读数与复跑 |
|---|---|---|
| B140 三点接线：`apps/web/src/App.tsx` 把当前设置节名传给 `<AiSettings>`；`apps/web/src/features/settings/AiSettings.tsx` 的 props 增可选 `active`（默认 true）并转发给 `<InboundAutomationSettings>` | 用户没停在那个页面时，这一面板**不再在后台空跑解析/不自称在接收**——"暂停开关"变成真的 | 现量 `git grep -n 'active={activeSettingsSection' HEAD`、`git grep -n 'active?: boolean' HEAD`；反向证据（摘掉传参那行 ⇒ 用例红）在 `~/.heyta-evidence/inb-t7-1017-0902/b140-mutant-1221/` |
| 28 枚 AC 腿打包成一枚可复跑电池 | 负责人可以**一条命令复量整格验收面**，而不是读一段散文 | `python3 research/tools/verify-inbound-ac-battery.py --root .worktrees/inb-t10 --ev <新目录> --quiet-gate`；逐腿读数在计划文末台账（整片 28 腿最新一戳在 `528b4115`／`36214e3a`，其后至本戳只有台账笔 —— 非文档改动 0 枚的复现命令在 `PROGRESS.md` 第 119 条） |
| AC-7 六枚 + AC-8 三枚尺的读数对象换成「零脏载具 · 已入库态」 | 这两格的证据从"工作树里恰好那份"升成"已入库的代码"，而跑批现场（那批待他拍的取证图）零覆写 | 同一枚 `--only` 名单跑九枚 ⇒ `legs=9 rc0=9 rc_nonzero=0`，原件 `~/.heyta-evidence/inb-t7-1017-0902/batt-ac78-1843/rc.txt`；逐腿 rc、安静门等待轮数与 png 对账在 `PROGRESS.md` 第 121 条、计划第 31 条 |
| 电池的副作用计数拆成两枚（`EVIDENCE_DIRTY=` 只数派生证据目录、`CARRIER_DIRTY=` 数整棵载具），并加一枚喂假输入的臂 | "跑批会把入库证据图改脏"这件事第一次变成**能红的判据**而不是口头声称 | 装置 `research/tools/verify-inbound-ac-battery.py`；`--self-test` 现量 `arms=11 failed=0`；口径改口笔 `833991d5` |
| 链"要不要重跑"这把筛子的分母改成**逐道从被触发物自己的声明现取**，并降到符号级 | 不再出现"筛出一片假空 ⇒ 判不必重跑"这种会把结论建在空读数上的判据 | 环境陷阱 **#494**（含三层规则）；台账 `PROGRESS.md` 第 115／116 条；第 63 道复跑 `STEP= 63/116 RC=1 SEC=1.7`、第 106 道 `STEP=106/116 RC=0 SEC=78.9`（载具 tip `fd46db9ba`／`b29b3f7b6`，原件 `~/.heyta-evidence/inb-t7-1017-0902/step63-1714/`、`…/step106-1726/`） |
| Linux 交付取证 | 这一端的"当前产物"是真的：装进 `.deb` 的就是这枚 tip 重打的 web 产物 | `bash apps/desktop-linux/scripts/package-deb.sh <linux-dev 别名>` ⇒ `LINUX_DEB_RC=0`／`PKG_RESULT=OK`，包内 `PKG_INDEX_SHA` 与载具 `apps/web/dist/index.html` 全串相等 |
| apps/web 单测锚从子集升成**全量 rc=0** | 交付树上"web 面没红"这句有全量支撑 | `cd .worktrees/inb-t10/apps/web && npx --no-install vitest run` ⇒ `180 passed \| 2 skipped (182)`／`2307 passed \| 13 skipped (2320)`（`…/webfull-1705/`） |
| 六格待拍板逐格把**正文**（选项 + 后果 + 推荐）贴给负责人 | 负责人不需要翻文件就能拍板 | 见 §7；正文真身在 `BLOCKED.md` 对应节 |

本轮入库的提交**不在这份文里列清单**（那份清单会漂）——现量取：
`git log refs/heads/main --format='%h %ad %s' --date=format:'%m-%d %H:%M' --grep='自动收集' | head -15`（本线笔的标题都带「自动收集」）。
⚠️ 引用任何一枚读数**必须连着它当时那枚 tip 念**——本仓 `refs/heads/main` 每小时都在被别人推。

---

## 4. 当前状态（此刻的形状，接手时先重测这三条）

```bash
date                                    # 时间戳前先跑
git rev-parse --short refs/heads/main   # 🔴 读主线，别读 HEAD：共享检出 15:02 起被别线切在 feat/paycenter-integration
git -C .worktrees/inb-t10 status --porcelain | wc -l   # 载具应为 0
```

- **那枚"在途"已收掉**：116 道整条链 17:46:12 → 18:21:43 在隔离载具跑完，末行逐字
  `CHAIN ran=116/116 of 116  RED=3  steps=[63, 87, 106]`、`CHAIN_RC=1`（现量 `grep -E '^(CHAIN ran|CHAIN_RC|END)' ~/.heyta-evidence/inb-t7-1017-0902/chain-t10-1746-run.txt`）；
  逐道日志在该目录里是 `NNN.log`（平铺、没有 `logs/` 子层、没有 `chain.txt`；现量 `ls ~/.heyta-evidence/inb-t7-1017-0902/chain-t10-1746 | tail -3`）。
  读数与逐枚归属已写进 `PROGRESS.md`。`RED=3` 比上一枚**整条**读数少一枚——少的是第 49 道，**它绿的原因是本机系统语言被改了，不是修复**（见 §5 那一行）。
  副作用收尾：这趟在载具覆写的 127 枚先整片存档 `~/.heyta-evidence/inb-t7-1017-0902/chain-t10-1746-carrier-dirty/files.tar` 再逐名 `git checkout --` ⇒ 载具脏数现量回 **0**。
  🔵 **下一位若再起整条链，这条省一小时**：它挂在后台进程上，会话一结束进程就被带走 ⇒ 先现量 `pgrep -f verify-inbound-check-chain`，
  回空就说明断了，**不要整条重来**，用 `python3 research/tools/verify-inbound-check-chain.py --repo .worktrees/inb-t10 --logs <同一枚目录> --from <最后一道+1> --to 116` 续跑
  （旋钮存在由 `python3 research/tools/verify-inbound-check-chain.py --help` 现量）；续跑前把目录里已脏的证据件先整片存档再逐名 `git checkout --`
  （形状照 `PROGRESS.md` 第 104 条 ⑧ 与第 108 条 ⑦：先 `ls` 出枚数、存档、逐名还原、再验载具脏数回 0），别在跑批中途还原。
  🔴 **并且：还原之前先把名下未入库的文档笔提交掉** —— 本会话就是没做到这一步，`git checkout --` 把自己那几行没入库的交接书改动一起还原了（见 §9 最后一条）。
- **AC 那半**：28 枚腿逐腿有读数，且**这一戳是打在交付 tip 上的**（10-20 05:09，载具零脏起跑、`sysctl -n vm.loadavg` 回 `{ 5.70 8.72 9.89 }`）⇒ 结论行逐字 `legs=28 rc0=27 rc_nonzero=1`，原件 `~/.heyta-evidence/inb-t7-1017-0902/batt-tip-1020/{batt.txt,batt.rc}`、逐腿日志 `<载具>/.run-logs/inb-ac-battery-1020-0509/`、逐枚读数抄在 `PROGRESS.md` 第 150 条。**为什么这一趟非跑不可**：AC-7 六道与 `AC8-matrix`／`AC8-ac-ticks` 读的输入里含本文件、`inbound-automation.md`、`PROGRESS.md`，而第 149／150 条那两笔只改文档——**文档维输入变了**，这与"八枚构建输入 delta=0 所以 Linux 取证不必重跑"那把尺射程不同，两把尺不许互相顶替（现量：`git diff --name-only b8d3df1d4 refs/heads/main -- server/src server/tests packages apps/web/src apps/mobile/src e2e research/tools scripts | grep -c .` 回 **0**，`git diff --name-only 24d05137b..refs/heads/main -- packages apps/web/src apps/mobile/src apps/desktop/src apps/desktop-linux/src server/src scripts/reinstall-all.sh pnpm-lock.yaml` 各回 **0 行**）。⚠️ 旧句「不必重跑电池」是那一戳的读数，已按上面这条改口。 🟢 **11:58:34–39 这把文档维尺被本线自己兑现了一次**（不是又一次"等下一位"）：11:4x 那一笔改的正是 `inbound-automation.md`／`PROGRESS.md`／本交接书／`docs/reference/environment-traps.md`，前三枚都是 AC-7／AC-8 的输入 ⇒ 按 §8 第 5 项那三层规则**只重跑被读的那九条腿、没重跑整串 28 腿**：`python3 research/tools/verify-inbound-ac-battery.py --root . --ev <新目录> --only AC7-doc-tables,AC7-doc-endpoints,AC7-migrations,AC7-license,AC7-docs-voice,AC7-link,AC8-matrix,AC8-producer-seam,AC8-ac-ticks` ⇒ 结论行逐字 **`legs=9 rc0=9 rc_nonzero=0`**（原件 `~/.heyta-evidence/inb-t7-1017-0902/batt-docs-33e814f4e.run.txt`，逐腿日志在同名目录里；载具 tip 那一戳 `33e814f4e`）。⚠️ **AC-6 那两枚腿不在这串里**，所以 §5 风险格那批入库图这一趟一枚没被覆写（现量 `git -C .worktrees/inb-t10 status --porcelain | wc -l` 在还原 iOS 段那枚写者件之后回 **0**）。🔴 **有一枚自我指涉的账必须连着这串读数一起念**：那九条腿读的是 `33e814f4e` 那棵树，而**把它们写进台账的那一笔改的正是被读的文档**（`PROGRESS.md` 与本件）⇒ 所以"九腿 rc0=9"这句话**从它落库那一刻起就旧了一笔**，下一位在新 tip 上照上面那条命令重取（整串五秒，没有省的理由）。本线不用"只改文档不算变"去断这个循环——那条尺只管**构建输入**，不管文档维输入。
- **完成条件 1**：AC 那半＝达成（每格有命令 + 输出，见 §4a 那张表与第 150 条）；"T7 三条命令在隔离副本 exit 0"＝**未达成，且不由本线闭合**
  （链上本戳三枚红 `steps=[63, 87, 106]` 全在他线地界，第 49 道那枚绿只是因为装机语言被改；腿 3 还等那台打包机，见 §5 第一格）。
- **完成条件 2**：`node research/tools/license-inventory.mjs` 与 `node scripts/check-migrations.mjs` 各 rc=0；
  AC 勾数 0；`BLOCKED.md` 随交付提交。✅ **10-20 06:31:53 在交付 tip `0520c7904` 上重取过**（两枚各 `LICENSE=0`／`MIG=0`，现量 `grep -c '^- \[x\] \*\*AC-' docs/plans/inbound-automation.md` 回 **0**，原件 `~/.heyta-evidence/inb-t7-1017-0902/batt-tip-1020/readback-e150.txt`）。🟢 **10-20 11:43:22–24 在新一轮交付 tip `39588ffeb` 上又取过一组**（全在载体里跑，六对原件都在 `~/.heyta-evidence/inb-t7-1017-0902/leg3-1020-1101/` 那目录里，逐枚是 license／check-migrations／docs／doctables／pointers／scope 各配一枚同名 `gate-<名>.txt` 与 `gate-<名>.rc`）：`node research/tools/license-inventory.mjs` rc=**0**（去重后 964 个包）、`node scripts/check-migrations.mjs` rc=**0**（73 枚迁移、9 枚含 CONCURRENTLY）、`pnpm -s check:docs` rc=**0**（691 处跨文档引用／57 处页内锚点）、表格尺与指针尺各 rc=**0**、AC 勾数现量仍 **0**；范围尺仍 rc=**1**（首行 `本线笔数=348　涉及路径=203　越界=96`，口径挂 **B205**，它不是 AC 腿）。⚠️ 那句 `pnpm check-migrations`（任务书原文）在仓里不存在，真名是 `check:migrations` ⇒ 见 traps #501，别把那条 rc=1 记成门禁红。

---

## 4a. 八格复跑入口（一格一条命令，给负责人也给下一个接手人）

整串前缀固定为下面这行，表里只写要替换的 `--only` 那串（腿标签与枚数都由装置自己打印，别在这里抄：`python3 research/tools/verify-inbound-ac-battery.py --list | tail -1`）：

```bash
python3 research/tools/verify-inbound-ac-battery.py --root .worktrees/inb-t10 --ev <新目录> --quiet-gate --only <下面那串>
```

🔴 **这一串要落在哪枚目录里跑，先前这里没写**（本轮逐格读 runbook 时查出来的）：`--root .worktrees/inb-t10` 这一族的 cwd 是**主检出根**，而仓里另有几处写的是 `--root .`（cwd＝载具里）。两种落点不用记，一条命令分开：`test -d .worktrees/inb-t10 && echo 主检出根 || echo 载具里`（两头现量：主检出那侧回「主检出根」，inb-t10 里回「载具里」）。两头都拿同一枚腿 `AC8-ac-ticks` 真跑过：从主检出根跑 `--root .worktrees/inb-t10` ⇒ **rc=0**，逐腿行读的就是 `docs/plans/inbound-automation.md` 那枚在册文档（原件 `~/.heyta-evidence/inb-t7-1017-0902/evpointers-10arms-0143/from-mainroot.txt`）；坐在 inb-t10 里再抄同一串 ⇒ **rc=1**，traceback 点名那条被拼重复的路径 `…/.worktrees/inb-t10/.worktrees/inb-t10`（原件 `~/.heyta-evidence/inb-t7-1017-0902/evpointers-10arms-0143/wrongroot/run.txt`，`grep -c FileNotFoundError` 回 **1**）⇒ **响亮失败，不会假绿**，这一形本身不危险。⚠️ **真会骗人的是 `--list`**：`--root <不存在的路径> --list` 回 **rc=0** 且照样打出 28 枚在册腿——`--list` 走的是脚本里那张静态 `LEGS` 表，**根本不碰 `--root` 那棵树**（现量 `grep -n 'args.root' research/tools/verify-inbound-ac-battery.py` 只有解析那一行命中，`--list` 分支不读盘）⇒ **「`--list` 绿」不证明 `--root` 选对了**；要证选对，只能看真跑那几腿的 rc 与逐腿行里那个文件路径。

| 格子 | `--only` 那串（逐字） | 最近一次当日读数在哪 |
|---|---|---|
| AC-1 权益与授权 | `AC1-offline11,AC1-entitlement3,AC1-quota-http,AC1-pglite,AC1-worker-identity,AC1-cjs-order` | **10-20 05:09 整串那趟（载具 tip `dd91d1927`，零脏起跑、`sysctl -n vm.loadavg` 回 `{ 5.70 8.72 9.89 }`）：结论行 `legs=28 rc0=27 rc_nonzero=1`**，逐腿读数抄在 `PROGRESS.md` 第 150 条，原件 `~/.heyta-evidence/inb-t7-1017-0902/batt-tip-1020/{batt.txt,batt.rc}`、逐腿日志 `<载具>/.run-logs/inb-ac-battery-1020-0509/`（现量 `ls -1 … | wc -l` 回 **29**＝28 腿＋`rc.txt`）。⚠️ 这一戳**没带 `--ev`**，所以装置自己的日志落在它默认的 `.run-logs/…`，上面那两件是我另指的重定向——两种落点都合法，别以为它们该在同一处。上一戳（10-20 00:46 @ `0bc4e2733`）的读数仍在 `~/.heyta-evidence/inb-t7-1017-0902/battery-1020-0046/`，逐腿抄件在 `docs/plans/inbound-automation.md` 的 T8 那一节与第 137 条 |
| AC-2 接收与队列 | `AC2-inbound-core,AC2-queue-teeth` | 同上 |
| AC-3 领取与提交 | `AC3-dual-host,AC3-sync-authz` | 同上 |
| AC-4 解析 | `AC4-local-date,AC4-app-host,AC4-egress-wire,AC4-mobile-inbound` | 同上；第四枚（10-28 添）是**移动端那格的第一个腿** —— 此前 `apps/mobile` 的 inbound spec 完全不在电池射程里，而 AC-6 那次缺陷藏一天正是因为一条腿被剔出整串：同一个盲区不能再留在移动端 |
| AC-5 批创建与来源记录 | `AC5-shared-schema,AC5-op-log,AC5-batch-actions` | 同上 |
| AC-6 规则界面 | `AC6-web-specs,AC6-browser,AC6-rule-fixture-parity` | 同上；⚠️ `AC6-browser` 会逐名覆写那批待拍的取证图 ⇒ 单跑它前先读 §7 第 4 格。第三枚是 10-28 新添的**不碰浏览器**的防再犯尺（判"线谓词收紧而规则 fixture 没跟上"那一族），它的读数不在"同上"那一戳，见计划文末 10-28 那节 |
| AC-7 文档 | `AC7-doc-tables,AC7-doc-endpoints,AC7-migrations,AC7-license,AC7-docs-voice,AC7-link,AC7-legal-copy-parity` | 同 05:09 那趟（六枚各 rc=0）；第 7 枚 `AC7-legal-copy-parity` 是 2026-10-28 20:3x 新加的（单跑 rc=0，读数与它抓出的那处已登记漂移见计划文末「20:2x–20:3x」那节）；⚠️ **这一格就是"为什么必须重跑"的那一格**：AC7 那一族与 `AC8-matrix`／`AC8-ac-ticks` 读的输入里含本文件、`inbound-automation.md`、`PROGRESS.md` ⇒ 第 149 条那笔**只改文档**也构成判卷输入变化。这与"八枚构建输入 delta=0 所以 Linux 取证不必重跑"那把尺**射程不同**，两把尺不许互相顶替。更早那批「已入库态」读数在 `PROGRESS.md` 第 121 条（00:46 那戳的零脏起跑态凭证是同目录 `prefix.txt` 里 `dirty 0` 那一行） |
| AC-8 验收矩阵 | `AC8-matrix,AC8-producer-seam,AC8-ac-ticks` | 同上（05:09 那戳逐枚：`尺枚=67 有尺行=27 无尺行=7 窗=13/13 平台=10/10 权益=9/9 设备状态=9/9`、`相对导入=237 模块在HEAD=237 尺瞎了=0`、`已勾=0 未勾=8`） |
| 变异臂架（**不是 AC 格**） | `python3 research/tools/verify-inbound-hosted-arms.py` | 判据 3 那几把尺「会红」的证明全在它里：`--list` 末行打**在册枚数**（别抄某一行的数）；`--self-test` 打它自己有没有牙（现量 `self_test arms=18 failed=0`）。🔴 **必须在零脏载具里跑**：共享检出会被载具闸门拒（rc=3）；集成面那几枚还要 `HEYTA_INTEGRATION_DATABASE_URL`，**单元面不要**（`--only 23,24,25,26` 这种纯单元子集直接能跑，闸门已收窄到这一趟点名的臂）。逐臂红了哪几条在 `docs/research/inbound-automation-review.md` 文末附录 |
| 范围尺（**不是 AC 格**） | `SCOPE-commit-scope` | 仍 rc=1，越界笔名归别线（B205）；05:09 同戳现量 `python3 research/tools/verify-inbound-commit-scope.py` 首行 `本线笔数=346　仅正文提及=16　涉及路径=203　越界=96` ⇒ 别把它算进 AC 结论 |

🟢 **这一格今天被"当场重跑"取代了**：10-20 00:46:43–00:47:49 在交付 tip `0bc4e2733` 上把 28 腿整串重跑了一遍（结论行 `legs=28 rc0=27 rc_nonzero=1`，唯一那枚非 0 是 `SCOPE-commit-scope`，即 B205 那一格，不是 AC 结论）。逐腿读数在 `docs/plans/inbound-automation.md` 的 **T8 第 32 条** 与 `~/.heyta-evidence/inb-t7-1017-0902/battery-1020-0046/`（`PROGRESS.md` 第 137 条同戳）。
⚠️ **本格以前写的是另一种东西，留在这里当形状示范**：它原先靠一句代理论证（"从 `528b4115c` 到 `refs/heads/main` 的非文档改动 0 枚 ⇒ 旧读数仍代表当前代码"）。那句**只在写下那一刻成立**（当时是 `5c274f496` 上 23:40:41 复算的），tip 一动就得重算 —— 能当场重跑就别用代理。要复算那半边仍然一条命令：`git diff --name-only 24d05137b $(git rev-parse refs/heads/main) > ~/.heyta-evidence/inb-t7-1017-0902/delta-check.txt; grep -c '^server/\|^packages/\|^apps/' <那份文件`（今天这戳回 **0**；⚠️ 别把清单落 `/tmp`）。
下一位若动了代码，按 **#494** 那三层筛子判要不要重跑整串，别照抄本表第三列。
🟢 **本格又被"当场重跑"顶了一次（10-20 01:51:41–01:52:54，交付 tip `b8d3df1d4`，载具起跑 `dirty=0`）**：结论行仍是 `legs=28 rc0=27 rc_nonzero=1`、唯一非 0 仍是 `SCOPE-commit-scope`（B205），二十七枚 AC 腿逐枚 rc=0；逐腿读数与副作用两枚计数器在 `~/.heyta-evidence/inb-t7-1017-0902/batt-b8d3df1d4-0151/`，正文写在 `docs/plans/inbound-automation.md` 文末那节（`grep -n '^## 2026-10-20' docs/plans/inbound-automation.md` 现量定位，别按行号引）。**为什么这串读数今天还代表当前 tip**：文末那节第 5 条给了三条对账（主力那条数"整棵树里除 `PROGRESS.md`／`BLOCKED.md`／`docs/` 外还有几枚路径被动过"，本戳回 0），引用本格读数请连着它一起引用。
🟢 **本表第二格那八串与装置在册名逐格对账成立**（10-20 01:22:42 现量：两侧集合各 **28** 枚、`comm -3` 回**空**；分桶 `AC1..AC8` ＝ 6/2/2/3/3/2/6/3，另加 `SCOPE` 1 枚＝28）。
复账三条（**零执行，只比名单**；清单别落 `/tmp`）：

```
python3 research/tools/verify-inbound-ac-battery.py --root . --list | awk -F'\t' '$1 ~ /^(AC[1-8]|SCOPE)-/{print $1}' | sort > ~/.heyta-evidence/inb-t7-1017-0902/legs-register.txt
awk -F'|' '/^\| (AC-[1-8] |范围尺)/{gsub(/[ `*_（]/,"",$3); n=split($3,a,","); for(i=1;i<=n;i++) if (a[i] ~ /^(AC[1-8]|SCOPE)-[A-Za-z0-9-]+$/) print a[i]}' docs/plans/inbound-automation-handoff.md | sort -u > ~/.heyta-evidence/inb-t7-1017-0902/legs-in-handoff.txt
comm -3 ~/.heyta-evidence/inb-t7-1017-0902/legs-register.txt ~/.heyta-evidence/inb-t7-1017-0902/legs-in-handoff.txt
```

两向都可能差，含义不同：**少一枚＝那一格的复跑串漏了一腿**（静默少跑，装置自己不会报），**多一枚＝串里写了不在册的名**（那种串真去跑会 `rc=2`，见下面第三段）。
⚠️ **第二行必须按逗号拆，不许按反引号拆**：那一格正文是**一枚 code span 整包着逗号清单**（`` `AC1-offline11,AC1-entitlement3,…` ``），
拿 `` `名` `` 去 grep 只会命中首尾两枚 ⇒ 本会话 01:2x 第一稿就是这么抽的，抽出 **2** 枚、`comm` 报 **26** 枚"缺失"——
**红的是抽法，不是台账**（与 #499 ⑤ 那把按行尾锚的尺同族，第三枚失法）。
🔴 **换好的抽法有两臂**（01:22:42 现量）：从抽出的名单删一枚 ⇒ `comm` 回 **1** 行并点名 `AC7-license`；再补一枚假名 ⇒ 回 **2** 行、两向各点名；未变异 ⇒ 回 **0** 行。
🟢 **串写错时装置自己拦得住**：`--only` 里给一枚不在册的标签 ⇒ **rc=2** ＋ `❌ --only 里这些标签不在册：['AC1-does-not-exist']`（01:20:42 实测；
真名与假名混在同一串也回 **2**、一条都不跑）。⇒ 这八串不存在"拼错名字还静默少跑"的失法，会静默的只有"整腿漏在串外"那一形，所以上面那条集合对账才是有用的。

---

## 5. 阻塞与风险（每条都写"谁能让它消失"）

| 格 | 现量形状 | 谁能解 |
|---|---|---|
| 腿 3：打包机不通 | 🔴 **本格此前那句「四枚在册别名各 rc=255」不是四路证据 —— 2026-10-20 01:0x 逐块读 `~/.ssh/config` 后证据重做（`PROGRESS.md` 第 139 条；traps #499 ⑥＋#500；原件 `~/.heyta-evidence/inb-t7-1017-0902/leg3-1020-0103/host-probe.txt` 的 A–H 段）**：探打包机的只有 `windows-pc` 一枚（config:87–88，那块 96 行注释自记「Windows 打包服务器」，且 `scripts/reinstall-all.sh:335` 的默认 `HEYTA_WIN_HOST` 就是它）；`laptop-5ueuu7ps`／`windows-codex`（config:102–104：同一 IP、`User rayne`、101 行注释「LAPTOP-5UEUU7PS」）是**另一台机器**（与 B225 追记五那句「四枚只指两台宿主」一致，但那两台里只有一台是打包机）；`windows-pc-lan`（config:187–188）的 HostName 与打包机那块自己第 99 行记的局域网地址**差一枚**，且本机 `route -n get` 把它从 en0 默认网关送出去（不经那张虚拟网）⇒ 这枚探不到打包机，**无论哪一处地址才是新的**。 **现在判「对端不在线」的只有这两把尺**（都零副作用、都现量过，01:08:03 那趟）：①**本机链路**——`pgrep -fl -i zerotier` 有 `zerotier-one`，且 那枚虚拟口（`feth*`）的地址落在打包机所在网段（逐口取的 awk 在 #500 ③，本格不整条抄：表格单元里的竖线会顶掉这一行的列数）；②**同链路对照臂**——`ssh linux-dev true` 回 **rc=0**、`ping -c 2` 打它的 HostName 有回声（26–57 ms）。两把都绿时 `ssh windows-pc true` 仍 **rc=255** 且 `ping -c 2` 打它的 HostName **0/2 回声** ⇒ **打包机确实不在线**，这一格照旧只能等负责人开机；**结论一格没动，动的是证据**（旧那些「四枚 255」的戳别再当四路证据用）。 ⚠️ 三条分类红线：**别用 ssh 措辞分类**（同一枚死 peer 五分钟内 `Host is down`→`Operation timed out`，`rc` 不变；路由表里那枚 peer 条目 01:05:01 带 `R`＋`!`、01:06:18 不带、01:08:26 又带，随老化漂（命令在 #500 ②））；**别拿「ping 本机自己在 feth\* 上的地址」当对照**（0.2 ms 必回声＝本机自己答，零信息，#500 ④）；**`Connection refused` 不证明对面 sshd 坏**（#500 ⑤）。此前那枚「敲错名字与关机同 rc」的警告仍然有效，见 #499 ①–⑤ 与下面 §9 那一枚子弹。 🟢 **01:51 又跑了一趟，三样观测量都现量了**（正文见 `PROGRESS.md` 第 143 条 ④；原件 `~/.heyta-evidence/inb-t7-1017-0902/retry-leg3-1020-0151/ssh-probe.txt`）：①守护在（现量 `pgrep -fl zerotier-one` 回 pid 625）、②本机在那张网上的地址在（`10.111.127.246`）、③**同通路另一枚对端的阳性对照** `ssh linux-dev true` 回 rc=0，而同一趟 `windows-pc` 回 rc=255 超时。⇒ 本格上面那句「只有这两把尺」与 §8 第 3 项那句「两把尺（本机链路＋同链路对照臂）」**数的是不同的东西**，别按枚数念——按名字念：**守护、本机地址、同通路对端对照**，三样都在才算把"对端不在线"报出去（对照的终点不能落在本机自己，#500 与那条「拿本机自己当对照＝恒答、零信息」的教训）。 🟢 **04:03:33 又取了一戳、形状没变**（原件 `~/.heyta-evidence/inb-t7-1017-0902/cmd-audit-1020/probe-0402.txt`，三样观测量按名字念齐全）：`ssh -o BatchMode=yes -o ConnectTimeout=8 windows-pc true` 回 **255**，同趟对照臂 `ssh … linux-dev true` 回 **0** ⇒ 本格结论照旧：**等负责人开机**，本线不自决退回本机出包。 🟢 **10-20 11:0x 本格翻面——负责人把机器开了**（写前先 `date` ⇒ `11:00:03`；原件 `~/.heyta-evidence/inb-t7-1017-0902/leg3-1020-1101/lock.txt`）：阳性读数用 `ssh -o BatchMode=yes -o ConnectTimeout=10 windows-pc "echo SSHECHO=OK"` ⇒ **rc=0**、正文 `SSHECHO=OK`；三样观测量按 **#500** 那把尺逐一点名也齐（守护 `pgrep -fl zerotier-one` 回 pid **625**、本机在网上的地址 **`10.111.127.246`**、同通路对照臂 `ssh … linux-dev true` 回 **0**）。⚠️ **一枚新的坏法要认得，别据此报"又关了"**：同一条连接上先发的是 `ssh windows-pc true` ⇒ **rc=1** 加一段 GBK 的「'true' 不是内部或外部命令」——那是**连上了、`cmd.exe` 不认这个 POSIX 命令**，与不可达（**255** 加超时）是两件不同的事；#499 ①–⑤ 那句「rc 相同而正文不同是四件不同的事」在这一戳是**反着用**的（正文相同而 rc 不同也要分）。另取一枚控制台读数（决定 Windows 腿那枚截图是证据还是废纸）：`lock-probe.ps1` 经 scp→`powershell -File` 回 **`LOCKED=no`**、`console 41478 … Active`，同趟 `install-capture.txt` 里 `SessionId=2` 与之相对照 ⇒ 10-05 那格"文本判据全绿而截图拍到锁屏"的失法这趟没有前提。⇒ **本格的"谁能解"这一列现在是已解**；腿 3 于 11:16:00→11:39:47 跑完（三腿有当前产物判据），读数在 §3 顶部那条与计划文末「2026-10-20 11:1x–11:4x」那一节。 | ~~只有负责人~~ 🟢 **已由负责人开机解决（10-20 11:0x）**；本线全程没自决退回本机出包 |
| 腿 3：设备面 | `adb devices` 回 **0 台**、`xcrun simctl list devices` 里 `heyta-multiend-reinstall` 回 **Shutdown**（18:32:09 戳，23:32:20 与 10-20 00:07:48 两戳复探同形；昨天 20:32 那戳 `emulator-5554 device` 已在册）。⚠️ **数设备要数"非空行"**（写法见 PROGRESS 第 122 条 ⑤ 那枚命令，本格不整条抄：表格单元里的竖线会顶掉这一行的列数）—— 空列表时 `adb devices` 末尾仍带一行空行，拿 `wc -l` 数会回 **1**，把"零台"读成"有一台"。⚠️ 第二枚形状（10-20 00:07:48 自曝）：**按「设备名 + Boot」去数会把"存在"与"已启动"混成一格** —— 那台机器上此刻是 `heyta-multiend-reinstall (Shutdown)` 而 `heyta-iphone-17pro (Booted)`（别线的面包器），两种问法要分开：存在性用 `xcrun simctl list devices | grep -c 'heyta-multiend-reinstall'`（回 **1**），启动态用 `xcrun simctl list devices booted | grep -c '('`（回 **1**，但那一枚是别人的）。⇒ 机器通了还得先把这两面起起来。本线**能**起模拟器，但在打包机通之前不起 —— 免得留下"半跑"那种形状，也**不碰别人那枚已启动的**。**02:11:54 又取了一戳**（原件 `~/.heyta-evidence/inb-t7-1017-0902/evpointers-10arms-0143/devices-preflight-0211.txt`）：`adb devices` 的非空行数回 **0**（任务书 10-16 那句「emulator-5554 已在册」是当时的读数，不是现状，别按它点设备）、`emulator -list-avds` 本机仍只有 `heyta-w3-yearly` 这一枚、booted 列表里只有 `heyta-iphone-17pro`（别线的面包器）、`heyta-multiend-reinstall` 存在性回 **1**。⇒ **这一格真正卡着的不只是"没开机"**：起 android 面就等于动那枚并行会话的 AVD，B164 要的脚本内身份判据今天仍不在（取法见 §8 第 3 项）——所以要么等那条判据落地／负责人当轮授权，要么 `--skip android` 并把 `⏭` 原样交下一位，**别让"打包机通了"被读成"四腿都能点了"** 🟢 **10-20 11:1x 本格按新状态重取**（原件 `~/.heyta-evidence/inb-t7-1017-0902/leg3-1020-1101/runmeta.txt` 与同目录 `boot.txt`）：android 面**一格没动**——`adb devices` 的非空行数回 **0**（写法仍照 PROGRESS 第 122 条 ⑤，本格不整条抄：表格单元里的竖线会顶掉列数），`emulator -list-avds` 仍只有 `heyta-w3-yearly` 那一枚，本线没起它、没动它；iOS 面本线自己那枚**已起并被这趟用过**——`xcrun simctl boot "heyta-multiend-reinstall"` 之后照旧分两问回读：存在性回 **1**，启动态原样打印全部行回 `heyta-multiend-reinstall (EAAD1B66-80A3-4A51-957C-298DAF22F057) (Booted)`，而别线那枚 `heyta-iphone-17pro` 全程也在 `(Booted)` 里、**没被传进 `IOS_DEVICE_NAME`**，脚本按准确名字匹配（`scripts/reinstall-all.sh:443`）⇒ 卸装落在自己那枚上。⚠️ **顺带记一枚会伤别人的坑**：窗口闸门 `bash scripts/verify-mobile-window-gate.sh --target b` 打印的那句建议命令行是 `IOS_DEVICE_NAME="<上面现取的名字>" bash scripts/reinstall-all.sh`，而它"现取的名字"取的是**当时唯一 booted 的那台＝别线的** ⇒ 照抄就会把重装装到别人的模拟器上；**用这句之前先现量"这台是不是本线那枚"**。 | 本线能起模拟器，**10-20 11:1x 已起并跑过 iOS 腿**；**android 面仍等 §7 第 7 格（甲＝B164 那条判据落地／乙＝负责人当轮授权）** | 🟢 **19:47 这一戳复探同形 + 判据已落地**：`adb devices` 仍回 **0 台**（非空行口径不变，别再拿 `wc -l` 数）；本线那枚 `heyta-multiend-reinstall` 仍 Shutdown；而 `scripts/reinstall-all.sh` 的 android 段**现在有了设备身份判据**（§7 第 7 格的甲已执行：显式 `HEYTA_E2E_SERIAL` = 人认领、`HEYTA_ANDROID_AVD` = 按名取唯一一枚、两者都没给时多枚**不猜**并列出 `serial<TAB>avd` 候选），身份没定下来时 `rm -f "$APK"` 与构建**一行都不执行** ⇒ 这一格从"要不要动别人的设备"换成"缺一台在册的设备"。
| 链第 49 道 `check:macos-window` | 探针 `HeytaMacApp.swift:625` 用 `input[placeholder^="添加任务"]` 数采集框，界面是英文时恒 0，三条 `NEEDED` 同时判缺（B238，形状见环境陷阱 #480）。⚠️ **本戳那趟它是 `RC=0`（18:21:43 收尾那片，`STEP= 49/116 RC=0 SEC=20.7`）—— 因为 `defaults read -g AppleLanguages` 首项已被改成 `zh-Hans-CN`**（上午 11:08 那戳是 `en`，第 104 条 ⑤），语言写盘时间 `stat -f '%Sm' ~/Library/Preferences/.GlobalPreferences.plist` 回 `Oct 19 18:12:41`。⇒ **别把这次绿读成修好了**：这是一枚同机同探针、只换装机语言的天然对照，门仍随语言翻（判据不该依赖语言），归属仍是 macOS 壳线 | macOS 壳线 |
| 链第 63 道 `check:payment-entry` | `现状：生产 compose 未配支付渠道；客户端里找到 2 处付款入口。`（尺有牙：`--self-test` 四臂全过；10-19 23:57:23 在本载具独立跑 `node scripts/check-payment-entry.mjs` ⇒ rc=**1**、末行同句，23:52 与 23:57 两跑逐字相同，原件 `~/.heyta-evidence/inb-t7-1017-0902/payentry-2357.txt`） | 收款面（B226／B223 同源） |
| 链第 87 道 `check:ai-e2e` | `detail-pane-task.spec.ts` 里 5 枚用例等不到行尾字段控件（窄档收进了「… 更多」）——安静窗内复现同一批、三倍时限对照臂也证明不是超时 | 三栏详情面线（B237） |
| 链第 106 道 `pnpm -r test` | **三枚读数排成一条线**：17:26 独立口径绿（载具 tip `fd46db9ba`）→ 18:21 链内红（先红的包是 `@heyta/mobile`，`ERR_MODULE_NOT_FOUND` 三枚 + `RolldownError`）→ 18:35 独立口径又红（**先红的包换成 `@heyta/web`**，`tests/task-sort.spec.tsx` 那一枚，`SEC=93.5`，原件 `~/.heyta-evidence/inb-t7-1017-0902/step106-1835/106.log`）。三戳之间 `git diff --name-only fd46db9ba 7024e6882` 的非文档改动 **0** 枚 ⇒ 代码没变 ⇒ 仍记"间歇性 + 链内上下文"，**不归因、不许编原因**（逐枚形状在 `BLOCKED.md` 的 B231 追记二） | web 排序那一族 / 移动载体（B229／B231） |
| 「人真打开看过截图」 | 只能由负责人做。**Linux 这一端现在有一枚具名图可看**：`~/.heyta-evidence/inb-t7-1017-0902/leg3-1020-0018/heyta-deb-window-0018.png`（10-20 00:18 那一趟 `.deb` 装进沙箱后启动截的窗口，现量 `sips -g pixelWidth -g pixelHeight <那枚>` ⇒ 900 × 523、`wc -c < <那枚>` ⇒ 108216 字节，与同一趟日志里 `PKG_SNAPSHOT=900x523` 逐字对上；原来只躺在远端 `/tmp/heyta-deb-window.png`，00:41:24 用 `scp linux-dev:… ` 收回本地 —— 见 PROGRESS 第 136 条）。🟢 **腿 3 已于 10-20 11:16–11:39 跑完，这一格现在有五枚具名图可打开看**，绝对路径都在 `~/.heyta-evidence/inb-t7-1017-0902/leg3-1020-1101/`（逐名 md5＋字节数钉在同目录 `shots-md5-labeled.txt`）：`heyta-reinstall-mac-installed.png`（mac 壳窗口，52358 字节）、`heyta-reinstall-mac-installed.png.webview.png`（mac 内嵌 WebView＝共享 UI 那一枚，382422 字节）、`heyta-reinstall-ios.png`（iOS 装机，552500 字节）、`shots/windows-msix-first-run-1136.png`（Windows MSIX 装完首屏，198944 字节）、`shots/linux-deb-window-1141.png`（Linux .deb 解包窗口，108216 字节）。⚠️ 两句限定：Windows 那枚这趟**有** `LOCKED=no` 的前提（§5 第一格 11:0x 那条），所以它不再是"文本全绿而图是锁屏"那一形；Linux 那枚与 00:18 那枚 **md5 相同**，由 `package-deb.sh:278` 的跑前 `rm -f` 与远端时间戳 `11:41:44` 两条读数确认是本趟拍的。⇒ **android 端仍没有图可看**（那腿这趟是 `--skip`）。**本线不替他勾** | 负责人 |" 🟢 **19:5x：这一格负责人当场把"看"这件事交给了我**（原话「你来看图拍板就可以把这两个解决掉吧」⇒ 结论由本线签，不再挂在"只能由负责人做"上）。腿 3 那趟的五枚耐久件逐枚看完，字节数取 `ls -l ~/.heyta-evidence/inb-t7-1017-0902/leg3-1020-1101/`：iOS 552500 ⇒ **屏上时钟 11:39 与本趟收尾同戳**，证的是装上的当前产物；mac webview 382422 ⇒ 过；Linux 108216 ⇒ 过；Windows 198944 ⇒ 过（同趟控制台 `LOCKED=no`，所以不是锁屏图）；`heyta-reinstall-mac-installed.png` 52358 ⇒ **整片空白**，这是 macOS 窗口采集的已知产物（同一轮 webview 那枚同窗口内容是好的），**不读成产品缺陷**，读成"这一端要靠 webview 那枚取证"。🟡 一处看了但**没登记成缺陷**：Windows 那枚左缘一列中文看着像被窗口边界裁字，而我复核用的 `sips -c 734 90 --cropOffset 0 0` 回的是卡片正文而不是左缘条 ⇒ 那把裁刀不可信，这一格只登记**存疑待复核**（复核要换一枚能按像素坐标回读的采集）；`windows-left-edge-crop.png` 19504 是那把刀自己的产物，不当证据。逐枚正文在 `PROGRESS.md` 第 156 条 ②③。

**风险**：证据目录里的入库 png 每次跑 AC-6 会被逐名覆写（±1~4 通道抖动、肉眼不可见、没有任何门为它红）⇒
谁在工作树脏着的时候提交，就会把不可见的字节改动一起带进去。**处置是 §7 的第 4 格**，别自己顺手改。
🔴 **10-20 05:09 那趟又发生了一次，本线照 §7 第 4 格的口径处置，没代拍**：载具脏数从起跑前的 **0** 变 **6**，其中 **5 枚**是被覆写的入库图（现量 `git status --porcelain | wc -l`；名册 `apps/web/evidence/inbound-recovery/{draft-390-dark,form-1280-dark,form-1280-light,retry-1280-dark}.png` ＋ `docs/research/evidence/inbound-automation-review/panel-layout/panel-1280-dark.png`）⇒ 动作两条，顺序别换：先把新字节整片留底 `~/.heyta-evidence/inb-t7-1017-0902/batt-tip-1020/ac6browser-overwrites-0509.tar.gz`（现量 `tar -tzf … | wc -l` 回 **5**），再 `git checkout -- <那两目录>` 把载具恢复到提交态（之后 `git status --porcelain` 只剩当时要提交的那份文档）。**留底不等于入库**：谁拍 §7 第 4 格，这件 tar 就是"该不该让它们继续被覆写"的现场样本。
🟢 **10-20 11:1x 这一趟没有触发它**：跑的是 `pnpm reinstall:all`（腿 3），输入里没有 AC-6 那两枚腿——28 腿电池整串**没重跑**（理由见 §4「AC 那半」那两把尺的射程），所以这批入库图一枚都没被覆写。现量 `git -C .worktrees/inb-t10 status --porcelain | wc -l` 在还原 iOS 段那枚 `Podfile.lock`（写者是 `pod install`，见计划文末那一节第 8 条）之后回 **0**。⇒ §7 第 4 格仍开着，等的是**拍板**，不是又一次覆写事件。

---

## 6. 纪律（违反即返工，本线全程照做，接手请继续照做）

- **只本地提交，绝不 push**；提交一律点名 pathspec，读回 `git show --name-only` 的文件数；**不 amend**。
- 台账提交用 `~/.heyta-evidence/inb-t7-1017-0902/ledger-commit-carrier.py <相对路径,逗号> "message"`：
  正文取**载具**的文件、OLD 取 `refs/heads/main`、CAS 同一枚、**完全不碰共享索引**（旧的 `ledger-commit-main.py`
  会从主检出工作树取正文并把 blob 回写共享索引，检出被别线切走时**两件事都危险**）。
  提交后把载具对齐：`git -C .worktrees/inb-t10 reset "$(git rev-parse refs/heads/main)"`（mixed，工作树字节不动；
  ⚠️ `checkout`/`merge --ff-only` 在这种"已提交但工作树脏着同一份内容"的形状下会被拒）。
- **AC 勾数必须仍是 0**：`grep -c '^- \[x\] \*\*AC-' docs/plans/inbound-automation.md`。
  加 `.skip`/todo、放宽断言、mock 被测对象、删测试、改阈值或验收脚本、`|| true` 一律算作弊。
- 正文**不存会漂的值**：每个数字旁边写现量命令；写时间戳前先 `date`。
- 脱敏在**写盘那一步**（证据文件走生成器；密钥/票据正文/口令不进日志、截图、证据）。
- 浏览器/GUI 取证**不抢前台**；**只对自己创建的对象动手**（载具 `.worktrees/inb-t10`、`~/.heyta-evidence/inb-t7-1017-0902/`）。
- 顺手活（顺手重构、顺手修别线的红）**进 `BLOCKED.md`，不混进本线提交**。
- 判卷口径不改（要改记 `BLOCKED.md` 等负责人）；不动 `packages/i18n`、不改已应用的迁移、不 bump `CURRENT_SCHEMA_VERSION`、不新增依赖。
- 做完或停损都**先报告等点头**，绝不自己把 Goal 标 complete。

---

## 7. 待拍板：还开着六格（第 1 格已按负责人自己的旧令默认支闭合）

真身在 `BLOCKED.md` 对应节，拍板后**由谁做**也写在那节里。**逐格重问过"旧令有没有给默认支"**（别把它们一律读成"等答复"）：

1. ~~**B241**~~ 🟢 **已闭合，不需要答复**：那一格问"要不要按实测改写任务书里那句判据"，而**同一份任务书自己写着「不改判卷口径；要改记 `BLOCKED.md`」** ⇒ 甲支被旧令当场排除，乙支（保留原话 + 三个数各标回它那戳）已入库（现量 `git log refs/heads/main --oneline --grep='判据那句' | head`）。**翻案条件**：只有负责人本人要求把那句改成实测的 8 枚形状，甲支才允许执行。正文与翻案条件逐字在 `BLOCKED.md` 的 B241 追记。
2. **B223**（含追记二那三臂）¥12 档在 AC 未勾这段时间：甲 放回禁售清单（代价：要么门禁红着、要么在唯一数字源写一句今天不成立的话）／乙 接受"卖得出但交付证据按戳念"／丙 另给口径。生产是否真可下单**本线未取生产侧证据**（2026-10-20 00:0x 追记：**仓内配置层那一半已经证了** —— `server/docker-compose.yml:122` 写的是 `- WECHAT_PAY_ENABLED=${WECHAT_PAY_ENABLED:-false}`，尺用 `resolvedValue`（`scripts/check-payment-entry.mjs:184`）把 `:-` 后的默认值抠成 `false` ⇒ 线上只有 noop 通道 ⇒ `server/src/billing/checkout.routes.ts:162` 回 `503 BILLING_PROVIDER_NOT_CONFIGURED` ⇒ **照这份 compose 部署，这一档收得到点击、下不成单**；但尺整件不读任何 `.env`（现量 `grep -n '\.env' scripts/check-payment-entry.mjs | grep -v HEYTA_CHECK_ROOT | grep -c .` 回 0），所以部署主机那枚 env 若写 `=true` 就翻案 —— 那一层只能由运营方跑一句生产侧只读查询。五条现量命令与分母逐枚写在 `BLOCKED.md` 的 **B223 追记三**（⚠️ 那一格的 **⑤ 把「甲／乙／丙」三个字母所指的东西写错了**，正确定义由紧随其后的 **B223 追记四** 更正：甲＝放回禁售清单、代价按追记二 臂 C；乙＝接受"卖得出但交付证据按戳念"；丙＝另给口径 —— 撤付款按钮属 B226，对外措辞属 AC-7，都不在本格）。⇒ **乙今天拿不出证据；甲／丙仍要负责人拍。**）
3. **B110** 界面那格对外措辞（中英两份 locale 都缺 `web.ai.inbound.process.waiting-entitlement`）；也可授权本线按 locale 风格出中英各一枚。
4. **B194／B239** 那批会随机变脏的已入库证据 png：(a) 原样留／(b) 落点改到不入库／(c) 用 `scripts/screenshots/png-diff.mjs` 的形状加一枚像素容差判据。**推荐 (c)，其次 (b)**。
5. **B199** 完成条件里"开工快照"那一格的口径（没开工基线 ⇒ 只能按集合判不能按计数判）。判卷口径，本线不代拍。
6. **B205** 范围尺（读数按戳取，别抄这行的数：`python3 research/tools/verify-inbound-commit-scope.py > 文件 2>&1; echo rc=$?` 再看首行 ⇒ 10-20 00:37:46 那戳是 **rc=1、`越界=96`、本线笔数=326**，OOB 行数现量 `grep -c '^  OOB ' <原件>`）：①「自动收集」这个标题词是不是本线独占归属凭据；② 白名单收不收本线授权过的路径。**推荐**：不收路径，给装置加显式**授权登记表**。⚠️ **这一格今天多了一枚必须一起拍的内容（B205 追记三）**：尺的允许文档清单（`research/tools/verify-inbound-commit-scope.py:56-63`）**没有** `docs/reference/environment-traps.md`（那是 `AGENTS.md` §5 指定的唯一事故落点）与 `docs/plans/inbound-automation-handoff.md`（负责人 10-19 点名要的交接物）—— 照仓规写就得 rc=1，不写就违反 AGENTS，加正则就是改判卷口径（本线不许）。同批还牵出一句**不需要改判据**的歧义：`AGENTS.md` §4「新增子文件后必须回本表登记」讲的是 AGENTS.md 自己的规则地图，而 `docs/agents/environment-traps-index.md` 末行明文「不要写回本文件」——本线 00:14 按前者加了一行、00:21 按后者撤回（`7d76e762`），一句话就能定死。另附：载具 `.worktrees/inb-t10` 留不留（删除不可逆，`git worktree remove .worktrees/inb-t10`）。
   ⚠️ 同一份任务书还列过一枚 `.worktrees/inb-t9 的处置` —— **那格已被盘上事实作废**：23:45:59 现量 `git worktree list` 只剩 inb-t10，`ls .git/worktrees/` 里也没有 `inb-t9` 那枚管理目录 ⇒ 不是"留着但断开"，是连根没了，没有可拍的对象。台账里 212 处旧载具提及逐枚普查过（47 处是命令行形状），判法与替代入口写在计划文末「2026-10-19 23:4x · 三枚旧载具…」那一节，历史行一枚未删。
7. 🔴 **腿 3 的 android 面三选一**（这一格是 10-20 02:1x 现量设备面时新冒出来的，正文在此、不代拍；`BLOCKED.md` 的 **B164** 是它的来路）：
   现量形状——本机 `adb devices` 的非空行数回 **0**、`emulator -list-avds` 只有 `heyta-w3-yearly` 这一枚 AVD，而那枚**属于并行会话正在用的设备**；脚本拿默认序列号动手（`scripts/reinstall-all.sh:367` 的 `SERIAL="${HEYTA_E2E_SERIAL:-emulator-5554}"`，第 **377** 行 `adb -s "$SERIAL" uninstall com.heyta`），B164 要求的那条"设备身份判据"今天仍不在脚本里（现量 `grep -c HEYTA_ANDROID_AVD scripts/reinstall-all.sh` 回 **0**）。上一次越界就是这形状（B62 的 23:5x 段把"读数有效、动作越界"两条一起记了，按 `grep -n '动作越界' PROGRESS.md` 自定位）。
   - **甲：脚本所有者／负责人把身份判据落进 `reinstall-all.sh`**（例如要求显式 `HEYTA_ANDROID_AVD=<名字>`，不等就不猜、响亮失败）。后果：android 腿变成"点得动且点不错"的常驻判据，代价是**改别人的验收脚本判卷口径** ⇒ 本线不代做，只能由 owner 落。
   - **乙：负责人当轮明确授权"这一轮可以动 `heyta-w3-yearly`"**。后果：本轮能出 android 的当前产物，但会 `pm clear`/卸装那台并行会话正在验收的设备；授权必须**逐轮给**，一次授权不扩成下次（同 §6 那条"单次授权不许扩成无人值守重发"）。
   - **丙（本线推荐）：继续 `--skip android`**，把汇总里那一行的 `⏭` 原样交下一位，并在台账大字写明"这端没有验证当前产物"。后果：四端里少一端的当前产物，但**零越界**、形状诚实；`⏭` 那行不计失败（脚本 `:651`），所以判据要按 §8 第 3 项那三枚计数念，别只看 rc。
   ⇒ 拍甲或乙之前，腿 3 那一段的写法已经按这个口径改过（§8 第 3 项那段命令块里带 `--skip android` 的注释就是丙的形状）。
   🟢 **10-20 11:1x：丙 这一支已经原样走过一趟**（负责人开了打包机，但**没给"这一轮可以动 `heyta-w3-yearly`"的当轮授权**，甲那条判据也仍不在脚本里——现量 `grep -c HEYTA_ANDROID_AVD scripts/reinstall-all.sh` 回 **0**，同趟 `adb devices` 的非空行数回 **0**）。⇒ 这一趟按丙点火，汇总逐字打 `⏭ android：本轮显式跳过（--skip）—— 这端**没有**验证当前产物`，三枚计数现量 `awk '/重装汇总/{f=1;next} f' <那趟日志> | grep -c '^  ✅'` 回 **3**、同段 `grep -c '^  ⏭'` 回 **1**、`grep -c '^  🔴'` 回 **0**（原件 `~/.heyta-evidence/inb-t7-1017-0902/leg3-1020-1101/reinstall.log`）⇒ 🔴 **§8 第 3 项那把 `✅=4 ⏭=0 🔴=0` 的尺这一趟判据不成立，而且成立不了**——少的那一腿是登记的，不是跑坏的。**甲／乙 两条路对下一位仍然开着**，`⏭` 这一行现在就交给他。
   🟢 **10-20 19:5x：这一格不再是选择题——甲已执行**（负责人把这两格的拍板交给我，现量 `grep -c HEYTA_ANDROID_AVD scripts/reinstall-all.sh` 从 0 变成非 0；口径三条与**七臂读数**在 `PROGRESS.md` 第 156 条 ⑤⑥，台架件与驱动脚本在 `~/.heyta-evidence/inb-t7-1017-0902/merge-1020/android-gate-arms/`）。**乙**当场不可执行：本机 `adb devices` 回 0 台（19:47），盘上唯一在册的 Android AVD 属并行会话，而打包机侧 `Sdk\emulator` 与 `Sdk\system-images` 两条 `dir` 各回找不到文件 ⇒ 没有"这一轮可以动的那台机"。**丙**已在 11:1x 原样走过一趟，它只把 `⏭` 交下去。⚠️ **甲的射程要说清**：闸门只**拒绝猜**，不产出设备 ⇒ android 端在合并结果上仍无"当前产物"读数，要出读数缺的是负责人起一枚属于本线的 AVD（或给乙一句当轮授权），不是脚本再改一轮。两枚门禁复跑 rc=0：`check:android-build-host`（没在本机新开模拟器入口）、`check:android-gradle-remote`（`APK="…"` 那行逐字未动，G3 对账仍成立）。

---

## 8. 下一步（按顺序；每条自带判据与"失败形状"）

1. ~~**收 §4 那枚在途链**~~ 🟢 **已收完，别重做**：那趟 116 道整串跑完，红集与逐道读数在 §4 那一格与 `PROGRESS.md` 第 118 条（⚠️ 日志形状是扁平 `…/chain-t10-1746/NNN.log`，**没有 `chain.txt`** —— 本条旧句那样写过一次，是错的）。⇒ 接手请直接从第 2 步往下做。
2. **问负责人 §7 现在开着的那六格**（在对话里贴正文，不给他勾；第 7 格是 10-20 新出现的 android 腿三选一）。任一格被拍 ⇒ 按那一节里写的那一步做，改完跑对应尺。
3. ~~**打包机回来之后一次做完腿 3**~~ 🟢 **10-20 11:16:00→11:39:47 已经跑过一趟**（`REINSTALL_RC=0`，mac／windows／ios 三腿有"当前产物"判据，android 按 §7 第 7 格的丙留一枚 `⏭`；逐腿读数与原件在计划文末「2026-10-20 11:1x–11:4x」那一节、`PROGRESS.md` 第 152 条）。**什么时候要再跑它**：只有两档——① 打包输入变了（判法仍是 §8 第 4 项那条**窄清单**差集，别用粗 pathspec）；② §7 第 7 格被拍成甲或乙、要把 android 那一腿补上。🔴 补法只有一种能消掉那枚 `⏭`：**同一趟四腿全跑**（汇总的判据写的就是 `✅=4 ⏭=0 🔴=0`）——单腿 `--only android` 只证 android 自己，那一趟的汇总里其余三腿照样打 `⏭`，别拿它冒充"四端齐了"。下面那整段 runbook **原样留着**，它是这趟真用过的形状：
   ⚠️ **动手前先读这一格，别照下面那两行直接跑**。「机器通了」只解开 **mac + windows** 两腿，**android 腿有一条本线自己登记过的红线**（`BLOCKED.md` B164 主条「要拍的一格」＋那次越界本身记在 B62 的 23:5x 段，本台账里那一行按 `grep -n '动作越界' PROGRESS.md` 自定位，别按行号找）：脚本拿默认序列号 `scripts/reinstall-all.sh:367` 的 `SERIAL="${HEYTA_E2E_SERIAL:-emulator-5554}"`，第 **377** 行就 `adb -s "$SERIAL" uninstall com.heyta`，而**本机唯一那枚 AVD 是并行会话在用的**（现量 `emulator -list-avds` ⇒ `heyta-w3-yearly`；`emulator-5554` 起起来也是它），B164 要的**设备身份判据今天仍不在脚本里**（现量 `grep -c HEYTA_ANDROID_AVD scripts/reinstall-all.sh` 回 **0**）。⇒ 动 android 腿之前只有两条路：**①** 负责人／脚本所有者把那条身份判据落进脚本（这是改验收脚本判据，本线不代改）；**②** 负责人在当轮明确授权"这一轮可以动那枚 AVD"。**两条都没有就先 `--skip android`**，并把汇总里那一行的 `⏭` 原样交给下一位 —— 按 `docs/agents/workflow-rules.md` 第 9 条（旧号 §8.9 共享资源独占验收），不得并行覆盖别人的设备。
   iOS 腿：`xcrun simctl boot` 之后**必须回读**，两问分开（形状见 §5 腿 3 设备面那一格）——存在性 `xcrun simctl list devices | grep -c heyta-multiend-reinstall`、启动态 `xcrun simctl list devices booted | grep '('`；脚本只认 Booted 里的**准确名字**（`scripts/reinstall-all.sh:443`），多台 booted 又没匹配时它**不猜、响亮失败**（同文件 `:457`）。**别用 `|| true` 把 boot 失败盖掉**（本格上一版就是这么写的，已改）。
   🔴 **两件事这一轮才看清（都在下面这段里改了）**：
   ① **落点**：脚本第 **68** 行是 `RT="${HEYTA_REINSTALL_TMP_DIR:-/tmp}"`，四端截图与构建日志全写 `RT`。在册那趟的日志里 `grep -c '/tmp/heyta-reinstall' ~/.heyta-evidence/inb-t7-1017-0902/leg3-t10-1116/reinstall.log` 回 **9**，它还照样打印 `截图证据：/tmp/heyta-reinstall-mac-installed.png（窗口）+ …webview.png（共享 UI）`；而今天 `ls /tmp/heyta-reinstall-*.png | wc -l` 回 **0**（实测 `no matches found`）。那三枚图还在，是因为**有人事后拷进** `~/.heyta-evidence/inb-t7-1017-0902/leg3-t10-1116/shots`（现量 `ls -1 … | wc -l` 回 **3**；mtime 三枚全是 `Oct 18 12:46:36 2026`，比同目录 `runmeta.txt` 里的 `run_end 2026-10-18 11:29:36` 晚 1 小时 17 分 —— 拷贝痕迹就在这两个数的差里）。⇒ **留住"人真打开看过"那格靠的是事后拷贝，不是脚本**，所以这一趟必须显式给 `HEYTA_REINSTALL_TMP_DIR`（另一条线早就这么用了：`docs/plans/product-ux-optimization.md:2453`）。
   ② **判 rc 的那行本身不能失败**：上一版写的是 `pnpm reinstall:all 2>&1 | tee …; echo "REINSTALL_RC=$?"` —— 那是 **`tee` 的 rc**。本机两枚 shell 都实测过：`zsh -c 'false | tee /dev/null; echo $?'` 与 `bash -c 'false | tee /dev/null; echo $?'` 都回 **0**，而 `zsh -c 'false > /dev/null 2>&1; echo $?'` 回 **1**。照旧版跑，`REINSTALL_RC=0` 是**恒真的判据**（等于没判）。⇒ 改成重定向进文件再读 `$?`，要看输出就 `tail` 那个文件。
   ```bash
   adb devices; adb devices | awk 'NR>1 && NF>0' | wc -l          # 数非空行：空列表时 wc -l 会回 1
   xcrun simctl boot "heyta-multiend-reinstall"                    # 起不起来看下一行回读，不看这条的 rc
   xcrun simctl list devices booted | grep '('                      # 必须出现 heyta-multiend-reinstall (Booted)
   EV=~/.heyta-evidence/inb-t7-1017-0902/leg3-$(date +%m%d-%H%M)     # 不给这枚就落进脚本默认的 /tmp，图会自己消失
   mkdir -p "$EV"
   # 🔴 android：上面那一格的 ①/② 一条都没落地时，这里加 `--skip android`——那样汇总里 `⏭` 回 1、判据不成立，
   #    老实把 `⏭` 交下一位，别把 `--skip` 说成"四端跑完"（脚本 :211 收这个参数，:651 打 `⏭`）。
   HEYTA_REINSTALL_TMP_DIR="$EV" IOS_DEVICE_NAME=heyta-multiend-reinstall \
     pnpm reinstall:all > "$EV/reinstall.log" 2>&1; echo "REINSTALL_RC=$?"
   tail -30 "$EV/reinstall.log"
   ls -l "$EV"/heyta-reinstall-*.png        # 交负责人打开看的就是这几枚；少一枚＝那一端没出图，别拿上一趟的冒充
   ```
   **判据（把"整条跑完"换成可查的一行）**：`awk '/重装汇总/{f=1;next} f' <那份日志> | grep -c '^  ✅'` 回 **4**、同一段上 `grep -c '^  ⏭'` 回 **0**、`grep -c '^  🔴'` 回 **0**，同戳 `REINSTALL_RC=0`。⚠️ **光看 rc 不够**：不在 `--only` 范围内／被 `--skip` 掉的端打 `⏭` 而**不计失败**（脚本汇总段就是这么写的），所以"绿着退出的三腿跑"和"四腿跑"在 rc 上长得一样 —— 这三枚计数就是把这两种形状分开的那把尺（拿在册那趟 `~/.heyta-evidence/inb-t7-1017-0902/leg3-t10-1116/reinstall.log` 试过：`✅=2 ⏭=0 🔴=2`，说明这探针既不会恒绿也不会恒红；那趟的日期按 `cat` 同目录 `runmeta.txt` 念 ⇒ `run_start 2026-10-18 11:21:54`、`REINSTALL_RC=1`，本段先前把它写成 10-19，10-20 03:1x 改正）。同戳那枚 `REINSTALL_RC` 现在取自上面重定向那一行，**不再取自 `tee`** —— 旧写法两枚 shell 实测都恒回 0，等于没有这一判。随后把截图**绝对路径**列给负责人（"人打开看过"那格归他），路径就用 `$EV` 里那几枚，别写 `/tmp`。
   失败形状：ssh rc=255 ⇒ 还是那台机器，不要改成"只跑绿的两端"。⚠️ **探之前先核名字**（本线 00:29 因敲了三枚不在册的别名白跑一批，见 #499 与 §9 那一枚子弹）；🔴 **10-20 01:1x 追加改口**：核名字那把尺照旧，但**这四枚不是同一台机的四条路** —— 探打包机只有 `windows-pc` 一枚算数，判「不在线」要配 #500 ③ 那两把尺（本机链路＋同链路对照臂 `ssh linux-dev true`），见 §5 那一格：核法用**按 token 比**的那把 —— `awk -v n=<候选名> '/^Host[ \t]/{for(i=2;i<=NF;i++) if($i==n) f=1} END{print f+0}' ~/.ssh/config` 必须回 **1** 才拿去探（**别用 `grep -cE '^Host .*\b<名>$'`**：那把对同一行里的**第一个**别名恒回 0，`laptop-5ueuu7ps` 与 `ubuntu-jcli` 实测都被它判成"不存在"，见 #499 的 ⑤）。
4. **Linux 交付取证**：这一半**不等打包机**，本会话 10-20 00:18 已在交付 tip 复过一次（`DEB_RC=0`、`PKG_RESULT=OK`、`PKG_FRESHNESS=OK files=26`，逐枚读数与原件路径在 `PROGRESS.md` 第 133 条 ①）。🟢 **腿 3 跑完之后那一取也已在 11:41:36→11:42:03 做过**（`DEB_RC=0`、`PKG_RESULT=OK`、`PKG_FRESHNESS=OK files=26`、`PKG_PIXELS=OK PKG_BLUE_HITS=3987 PKG_SNAPSHOT=900x523`、`.deb` 现量 **2022016** 字节；原件 `~/.heyta-evidence/inb-t7-1017-0902/leg3-1020-1101/{package-deb.log,deb-runmeta.txt}`，判据行抄在 `shots/linux-package-facts-1141.txt`）。
   把包内 `PKG_INDEX_SHA` 与载具 `apps/web/dist/index.html` 现量比对（相等才算"装进去的是这枚 tip 的产物"）—— 🟢 **本戳已比过且逐字相等**：现量 `shasum -a 256 <载具>/apps/web/dist/index.html` 的大写形式与 `PKG_INDEX_SHA`、与 Windows 包内 `PAYLOAD_INDEX_SHA` **同一枚** `5D792EA5…FEA93B61` ⇒ 三个壳吃的是同一次 web 构建。⚠️ 那一趟回传的窗口图与 00:18 那枚 **md5 相同**（`c214a69d…`），先按 #159／#445 那族怀疑过"从远端固定名 `/tmp` 拉回陈件"，两条读数排掉：脚本在跑之前 `rm -f "$SHOT"`（`apps/desktop-linux/scripts/package-deb.sh:278`），远端那枚的时间戳现量回 `2026-10-20 11:41:44.656716748 +0800`，落在本趟起跑窗口内 ⇒ 是本趟拍的（像素相同是因为两趟的 `index.html` 本来就是同一枚）。
   ⚠️ **别为文档提交重跑它**：10-20 04:47 现量，从取证那一戳的 tip `24d05137b` 到当时的交付 tip，八枚构建输入路径各回 **0 行**（现量循环 `for p in packages apps/web/src apps/mobile/src apps/desktop/src apps/desktop-linux/src server/src scripts/reinstall-all.sh pnpm-lock.yaml; do git diff --name-only 24d05137b..refs/heads/main -- "$p" | grep -c .; done`，原件 `~/.heyta-evidence/inb-t7-1017-0902/cmd-audit-1020/linux-forensics-equiv-e149.txt`）⇒ 已入库那件 `package-facts.txt` 的读数对当前 tip 仍适用；要重跑只在**腿 3 整条跑完**之后（那一趟会换 `dist/` 产物，才是这把尺的翻面条件）。
5. **任何"要不要重跑那道门"的判断**按 **#494 的三层规则**做：声明层取分母 → 路径层筛候选 → 符号层问被读的东西变没变；
   做不了第三层就老实只重跑那一道（`python3 research/tools/verify-inbound-check-chain.py --repo .worktrees/inb-t10 --logs <新目录> --only <命令子串> --timeout 1800`），别整条。
6. **收尾**：完成条件 2 那两把尺每次交付都重跑（不带管道尾巴取 rc），`BLOCKED.md` 随交付点名提交，
   最后**报告 + 等点头**（不自己 complete）。

---

## 9. 死胡同（本会话真踩过，别再走一遍）

- 🔴 **别拿手抄的路径清单当"没人动过"的分母**（本轮自己的假空就是它）；也别拿"路径非空"直接当"该重跑"。见 #494 三层规则。
- 🔴 **`grep -c` 数的是行数，不是枚数**：被拼成一行的日志（链装置的 `EXCERPT`）要用 `grep -o … | wc -l`；
  `grep -c '^Host .*windows' ~/.ssh/config` 回 3 是行数、别名是 4 枚（`awk '/^Host .*windows/{for(i=2;i<=NF;i++) c++} END{print c}'`）。已写进 #494 ⑸。
- 🔴 **别按别名的字面形状挑"打包机那一族"**（本会话 18:17:55 戳自己踩的）：我按 `~/.ssh/config` 里 `Host` 行的名字筛了 `win|pc` 再加一枚，把 `wunoos` 算进了分母，它 `ssh … 'uname -s'` 回 **Linux** 却 **rc=0**，差点被报成「打包机回来了」。
  正确分母取自被触发物自己的声明与解析：`scripts/reinstall-all.sh:335` 的 `WIN_HOST="${HEYTA_WIN_HOST:-windows-pc}"` 给默认值，全集按 `BLOCKED.md` B225 追记五 的 `ssh -G` 逐枚解析 ⇒ **四枚别名 = 两台 Windows 宿主**（`windows-pc`／`windows-pc-lan` 同一台，`windows-codex`／`laptop-5ueuu7ps` 同一台）。这是 #494 第一层（分母取自声明）在"换一台机器"这件事上的同一条规则。
- 🔴 **`git log -- <不存在的路径>` 静默回 rc=0、零字节** ⇒ 一片假空（#490）；存在性只能 `test -e`／`ls -d` 直接问盘。
- 🔴 **管道尾巴吃退出码**（`cmd | tail` 之后读 `$?` 读的是 tail）；取 rc 一律不带管道。#45／#179／#184。
- 🔴 **"独立跑绿"≠"链内跑绿"**：两个口径，台账里必须分开引用（本轮第 106 道就是这么处理的）。
- 🔴 **别线那 19 行未提交的 #492 曾与本线条目撞号**：共享检出上写同一枚文件时，先 `git log -1 -- <文件>` 与 `git status --porcelain -- <文件>`，
  号只增不改 ⇒ 宁可留"main 上 491→493 的瞬时空档"（两线合并即连续），也别占别人的号或把别人的活折进自己那笔。
  ⚠️ 读到这里的 `#492` **别去 main 里找**：那枚正文此刻只在共享检出的未提交态里。现量 `grep -c '^492\. ' docs/reference/environment-traps.md` 在**共享检出**回 **1**、在 `refs/heads/main` 那份里回 **0**（两枚读数 23:39 取）。⇒ 交接书里那七枚 `#N` 引用逐枚核过（`#179 #184 #480 #490 #492 #493 #494`），除这一枚外其余六枚都能在 main 那份里查到。
- 🔴 **`pnpm check-migrations` 不存在**（真名 `check:migrations` = `node scripts/check-migrations.mjs`）、
  **`check-docs-voice.mjs` 在 `scripts/` 不在 `research/tools/`**（照裸名拼路径会得到 MODULE_NOT_FOUND + rc=1，形状与"门判红"逐字同形）。
  散文里的工具名会漂，引用前先 `find`/`grep -n package.json`。
- ⚠️ 别把 `docs-link-check` 在主检出上的红读成"本线改坏了"：它读的是共享检出在途态（并行会话未入库件会造红）；
  要"当前提交产物"那一格，就在零脏载具上跑同一条命令。
- ⚠️ 可复现物不要住 `/tmp`（重启就没了，而且复用同名会让提交吃进陈件）：臂、驱动、原件一律落 `~/.heyta-evidence/inb-t7-1017-0902/`。
- 🔴 **整片存档那份名单是"载具当时脏着的全部文件"，不是"跑批弄脏的文件"** —— 本会话 18:23:44 逐名 `git checkout --` 时把**自己名下还没入库的交接书改动**一起还原了（那批名单里既有链覆写的证据件，也有我 18:19–18:20 写下去、当时尚未提交的几处文档笔）。救回来只因为存档 tar 里有它（`tar -tf …/files.tar | grep inbound-automation-handoff` ⇒ 命中，`tar -xf files.tar <路径>` 取回）。**下次顺序必须是：先提交名下文档笔 → 再存档 → 再还原**；只在这三件事都按名点名时才做得动。

- ⚠️ **门名打错时 `pnpm -s` 是"零输出 + rc=1"，长得像门判红**：本会话拿到过两次 —— `check-docs-voice`（真名 `check:docs-voice`）与 `check-migrations`（真名 `check:migrations`，现量 `grep -n 'check:migrations' package.json`）。⇒ **读到 rc≠0 先看输出是不是空的**，空的先怀疑探针自己。
  ⚠️ 顺带一句：任务书完成条件 2 那格写的就是 `pnpm check-migrations` 这串**仓里不存在的名字** —— 本线不改任务书（同 B241 的原则），接手请照 `pnpm check:migrations` 量，交付 tip 上的量到的是 rc=**0**（见 `PROGRESS.md` 第 122 条 ②）。
- ⚠️ `git rev-parse --short A B`（一条两个位置）会直接 `fatal: Needed a single revision` —— 想比两枚 ref 就分两条跑。台账里那条"两行同值"的现量命令第一稿就是这么写的，已改。
- ⚠️ **敲错的 ssh 别名与"机器关机"回同一个 rc**：`ssh -o BatchMode=yes <不在册的名字> true` 走 DNS 解析失败也是 **255**。本会话 23:32:20 那一戳我先用 `win-pc`／`windows`／`packaging` 三枚**不存在的名字**探了一遍，四枚 rc=255 看起来"和记录一致"，其实整批是探针打空 —— ⇒ **腿 3 的复探必须逐字用上面名单里那四枚**（在册证据：`grep -n '^Host ' ~/.ssh/config` 回的四行里有它们）。⚠️ **同一枚坑本会话 10-20 00:29 又踩了一次**（这回是 `windows-lan`／`windows-mdns`／`windows-oob`，逐枚 `grep -cE '^Host .*\b<名>$' ~/.ssh/config` 现量回 **0**，而在册的 `windows-pc`／`windows-pc-lan` 各回 **1**）⚠️ **但这把尺自己也有假阴**：`$` 锚在行尾，同一行 `Host` 里**排第一**的别名恒回 0 —— 现量 `laptop-5ueuu7ps` 回 **0**、`ubuntu-jcli` 回 **0**，`grep -n '^Host .*laptop' ~/.ssh/config` 却显示它就在 102 行。按 token 比才是对的那把：`awk -v n=<名> '/^Host[ \t]/{for(i=2;i<=NF;i++) if($i==n) f=1} END{print f+0}' ~/.ssh/config`（四枚在册各回 **1**、三枚不在册各回 **0**，00:55 现量）⇒ 光把名单写在文件里拦不住，**探之前先把名字过一遍那把尺**。升成环境陷阱 **#499**（含 ⑤ 那条追加改口），里头还有一条本线以前没写的：**rc 相同而正文不同是四件不同的事**（timed out／Host is down／Connection refused／Could not resolve hostname），所以探测命令要 `2>&1` 收 stderr 进证据件，别 `>/dev/null 2>&1` 把它扔掉（00:30:01 那批四枚逐枚正文在 `~/.heyta-evidence/inb-t7-1017-0902/leg3-1020-0030/ssh-probe.txt`）。
- 🔴 **接上一枚：那四枚在册别名根本不代表同一台机器**（10-20 01:0x 现量，#499 ⑥／#500）—— `grep -nE '^Host .*(windows|laptop)'` 把三行同屏只证明「名字撞车」，不证明「同一台机」；归属要逐块读 `HostName`＋`User`＋块上那行注释。腿 3 判打包机只认 `windows-pc`，且必须配**同链路对照臂**（`ssh linux-dev true` ⇒ rc=0）才许写「对端不在线」；对照臂若拿本机自己的虚拟口地址去 ping，那是本机在答，恒绿、零信息。
- ⚠️ **数设备要数非空行**：`adb devices` 在无设备时仍输出表头加一行空行，拿 `wc -l` 数会回 **1**（本会话 23:32 实测就是这个形状），会被读成"有一台"；台账里那条写法是数非空行的（见 PROGRESS 第 122 条 ⑤），本格因为**表格单元里不能写裸竖线**（竖线顶掉列数、写成 `\|` 又粘不回 shell）只在 §5 那格指向条目号。
- ⚠️ **`git log -1` 一次给多枚路径只回其中最新那一枚**（本会话 10-20 00:01 实测：三枚路径一起给，只出 `b56c09357`，另两枚静默消失）⇒ 做"这几个文件各属哪线"的归因必须**一枚一条**，不然归因会少算而看起来"跑成功了"。第 130 条 ② 记了这枚自曝。
- ⚠️ **grep 类分母要把构建产物剔出去**：同一棵树 `grep -rlI hosted-ai-monthly server packages/app-host` 回 **22**，加上 `git ls-files … | grep -vE '/dist/|node_modules'` 那条口径回 **16**，差的 6 枚全在 `server/dist` 与 `packages/app-host/dist`。⇒ 写"这档在哪写了"这类分母时**先声明口径**（在册源件 / 整棵工作树），两个数不是互相打脸。
- ⚠️ **往台账插一格只按整行边界，插完立刻看删列**：本会话第一稿按**字符下标** splice，正则 `\*\*B(?!223)[0-9]{3}[ 追]` 命中的是 `🟢 **B221 闭合…` 那种**行中**形状，把别人那格的标题前缀整片顶掉 —— `git diff --numstat` 当场显出删列 **1**（纯追加应当是 `N 0`）。回退用 `git checkout -- BLOCKED.md` 的前提是**起跑态 clean**（`git status --porcelain | wc -l` 先回 0），且内容能从草稿重放。

- ⚠️ **别拿 `--list` 当 `--root` 的校验**（10-20 02:2x 现量）：`python3 research/tools/verify-inbound-ac-battery.py --root <不存在的路径> --list` 回 **rc=0**、照样打出那 28 枚在册腿——`--list` 只读脚本里那张静态 `LEGS` 表，**不碰 `--root` 那棵树**。同一枚错 root 拿去**真跑**才响亮：`--only AC8-ac-ticks` 那趟回 **rc=1** ＋ `FileNotFoundError` 点名被拼重复的 `…/.worktrees/inb-t10/.worktrees/inb-t10`（原件 `~/.heyta-evidence/inb-t7-1017-0902/evpointers-10arms-0143/wrongroot/run.txt`）。⇒ 判落点用那条零副作用的 `test -d .worktrees/inb-t10 && echo 主检出根 || echo 载具里`，再对照 §4a 里那两族写法。这一形属于「探针自己会造绿」那一族：**装置没判错，是它的某条分支压根不看那个输入**，于是「绿」被下游读成「这个输入已经被检查过」。

- 🔴 **写 runbook 之前先查本文件 §9 与环境陷阱索引 —— 这一枚子弹就是"没查"的代价本身**（10-20 03:3x 自查）：§8 第 3 项上一版同时踩了**本台账已经写下来的两枚坑**。㈠ `pnpm reinstall:all 2>&1 | tee …; echo "REINSTALL_RC=$?"` 拿的是 `tee` 的 rc（本节上面就有「管道尾巴吃退出码」那枚子弹；仓内 canon 是 #45（`cmd | tail -n; echo $?` 读的是 `tail`）、#179（同一件事的反方向：`cmd > log 2>&1; echo EXIT=$? | tee -a log`，那个码是 `tee` 的）、#184（zsh 里 `${PIPESTATUS[0]}` 干脆是空值）。两枚 shell 各实测：`zsh -c 'false | tee /dev/null; echo $?'` 与 `bash -c 'false | tee /dev/null; echo $?'` 都回 **0**）⇒ 那条判据**永远不会红**。㈡ 四端截图落在脚本默认的 `/tmp`（`scripts/reinstall-all.sh:68` 的 `RT="${HEYTA_REINSTALL_TMP_DIR:-/tmp}"`），而 canon 里 #159「`/tmp` 会在你写完引用之后被扫走」、**#445**「reinstall-all.sh 把逐段日志写成固定名 `/tmp/heyta-reinstall-<段>.log`」、#275 早就登记过 ⇒ 今天 `ls /tmp/heyta-reinstall-*.png 2>/dev/null | wc -l` 回 **0**，负责人那一格要看的原件只剩**事后拷进**证据目录的三枚。号数现量：`grep -nE '^(45|179|184|159|275|445)\. ' docs/reference/environment-traps.md` 六行全回。⇒ 两条动作：**判 rc 一律重定向进文件再读 `$?`**；**跑 `reinstall:all` 必带 `HEYTA_REINSTALL_TMP_DIR="<耐久目录>"`**（§8 第 3 项已按这两条改掉）。这一枚不是新坑，是**"坑在册上、runbook 照样写错"**：动笔前先 grep 那一节，别等下一趟复盘才发现。

- 🔴 **给 `pnpm <脚本名>` 传脚本自己的旗标时别补 `--`**（10-20 11:1x 现量，已升**环境陷阱 #502**）：`pnpm reinstall:all -- --skip android` 里那两字面量被 pnpm 11.8.0 **逐字转发**，脚本在参数解析处打 `未知参数：--` 并 **exit 2**——构建、`rm -rf`、装机一次都没开始，但那枚 rc 与"腿判红"逐字同形。正确形状是 `pnpm reinstall:all --skip android`；**自证只看日志头行打印的 argv**（pnpm 会原样打 `$ bash scripts/reinstall-all.sh …`），那行里有 `--skip android` 才算落到脚本上。
- 🔴 **两段回传的截图共用同一个文件名，往同一枚证据目录 `cp` 会静默盖掉前一段**（10-20 11:4x 现量，已升**环境陷阱 #503**）：Windows 段与 Linux 段各自写 `dist/<端>/packaged-first-run.png`，我按同名 `cp` 进 `shots/` 时 Windows 那枚被换掉、`cp` 不报错、枚数看起来没变。露出来靠的是"改名后再取 md5 ⇒ `No such file or directory`"，而那份**只有裸 md5、不带文件名**的清单差点让这枚覆盖进不了账（清单里那一行仍在，只是没人知道它指哪枚）。⇒ **落证据一律带端名＋时刻**，md5 清单逐行带路径与字节数：本线这趟的五枚在 `~/.heyta-evidence/inb-t7-1017-0902/leg3-1020-1101/shots-md5-labeled.txt`。

---

## 10. 相关文件

| 要查什么 | 去哪 |
|---|---|
| 唯一实施计划 + 逐格台账（AC-1～AC-8 的命令与读数、T7 三条腿） | [`inbound-automation.md`](inbound-automation.md) 文末各节；八格的**逐字输出**在「2026-10-19 21:3x · 完成条件 1 里"贴出的输出"那一半，从家目录搬进仓里」那一节，按格复跑命令在本件 §4a |
| **给"从零接手的执行 AI"的缺口开工单**（2026-10-27 按代码与生产现量重盘；它收窄了本件 §1 那句"代码层是齐的"） | [`inbound-automation-work-brief.md`](inbound-automation-work-brief.md) —— 只列缺口、顺序与归人格子；判据与读数仍以计划与本件为准 |
| 台账（末节号现量 `grep -oE '^1[0-9]{2}\.' PROGRESS.md | tr -d '.' | sort -n | tail -1`；纯追加、旧文不删只加带日期的改口） | [`../../PROGRESS.md`](../../PROGRESS.md) |
| 阻塞与待拍板（B207 那张待点头表、B223／B239／B241／B199／B205…） | [`../../BLOCKED.md`](../../BLOCKED.md) |
| 环境陷阱（#490 假空、#493 计数器口径、#494 三层分母、#480 探针语言敏感） | [`../reference/environment-traps.md`](../reference/environment-traps.md) |
| 四端重装与固定收尾的权威口径 | [`../agents/multi-end-build.md`](../agents/multi-end-build.md) §6.1.1 |
| 第二轮严格复审 | [`../research/inbound-automation-review.md`](../research/inbound-automation-review.md) |
| 技术协议 | [`../reference/inbound-automation-protocol.md`](../reference/inbound-automation-protocol.md) |
| 本线装置（在册枚数现量：数 `ls research/tools` 里以 `verify-inbound` 开头的那几枚，别抄这一行的枚数） | 核心七枚：`verify-inbound-ac-battery.py`（28 腿）、`verify-inbound-check-chain.py`（116 道）、`verify-inbound-commit-scope.py`（范围尺）、`verify-inbound-producer-seam.py`、`verify-inbound-ac8-matrix.py`、`verify-inbound-doc-tables.py`、`verify-inbound-ac-ticks.py`。 ⚠️ 这一行原来写的是「本线**全部**装置」，但它只列了七枚而在册是 20 枚（10-20 01:36 现量）——已改成「核心七枚＋现量枚数命令」；**加一枚新装置就回来补这一行**。那 20 枚里 10-20 新加了一枚：`verify-inbound-evidence-pointers.py`——查台账里那些 `~/.heyta-evidence/…` 的**仓外**点名在不在盘上（仓内两把文档尺查不到那一层）。跑法 `python3 research/tools/verify-inbound-evidence-pointers.py`（10-20 01:43 那戳 rc=**0**，六档相加＝分母，已登记死指针逐枚打印；这句只是那一戳的读数，今天要用的现量就是重跑它）；自测臂数**由它自己打印**，别抄进这一行：`… --self-test` 末行须 `SELF_TEST OK`（10-20 01:43 现量含"登记吞掉没登记的那处点名"两臂）；逐枚看未验档加 `--list-unverified`。结论行把"处"与"枚"分开打（`已登记死指针点名=N 处（去重后 M 枚路径）`）——同一枚原件在两份台账各点名一次是**一处还是两枚**这件事以前会被读混，见 `PROGRESS.md` 第 141 条 ⑦。 ⚠️ 它**没有自动消费者**（现量 `grep -c 'verify-inbound' package.json` 回 **0**，本线那批装置同档），要不要升成电池的第 29 腿属「改动验收分母」这一档，**归负责人拍**（`PROGRESS.md` 第 141 条 ⑤） |
| 原件与证据（一次性、勿放 /tmp） | `~/.heyta-evidence/inb-t7-1017-0902/` |
