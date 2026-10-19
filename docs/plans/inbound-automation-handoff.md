# 交接：付费自动收集（inbound automation）交付收尾

> 这份只记**当前停在哪、下一步按什么顺序做、哪些路已经走死**。
> 决策与理由不在这里：计划 [`inbound-automation.md`](inbound-automation.md)（唯一实施计划，文末是逐格台账）、
> 判据与口径在 `AGENTS.md` 与 [`docs/agents/`](../agents/)、逐条阻塞在 [`../../BLOCKED.md`](../../BLOCKED.md)。
> 写这份的当刻：**2026-10-19 18:0x**（写前先跑 `date`）。**本线一格都没勾、没 push**（现量见 §6）。

---

## 1. 一句话接手（先读这三行）

1. **这一档功能在代码层是齐的，缺的全是"证据 + 人 + 机器"**：AC-1～AC-8 每格都有可复跑命令与当日读数，
   而且**命令与逐字输出现在都在仓里**（按格分组的命令见下面 §4a；今天那两批的逐字输出搬进计划文末「2026-10-19 21:3x · 完成条件 1 里"贴出的输出"那一半，从家目录搬进仓里」那一节 —— 此前**当日那批**输出只躺在家目录，clone 的人只能看到 10-10／10-11 那两张旧戳）。
   但**勾选权在负责人**，且"四端当前产物"里 windows／android 两端的当前产物复不出来，因为它依赖的那台打包机不通。
2. **接手第一件事**：§4 那枚原本"在途"的 116 道链**已跑完并写进台账**（末行 `CHAIN ran=116/116 RED=3 steps=[63, 87, 106]`）⇒ 直接从 §8 的第 2 步往下做：问负责人 §7 还开着的那五格；打包机回来后一次做完腿 3。**别重跑整条链之外的任何重步**，除非 §5 那条分母规则说该跑。
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
| "未上线的能力没有被写成上线" | AC-7 六枚文档尺 + `pnpm check:docs`、`check:public-facts`（匿名 GET 只有四枚，接收路径不在其中） |

**还不能说的**：不能说"四端当前产物齐"（windows／android 复不出来）、不能说"公网接收已在生产开通/未开通"
（那是运营事实，本线没取过生产侧证据）、不能说"AC 已验收"（一格都没勾）。

---

## 3. 已完成（本轮，全部本地入库）

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
- **AC 那半**：28 枚腿逐腿有读数（计划文末台账），且**代码自那片戳以来一字未变 —— 这句现在是量出来的**：
  `git diff --name-only 36214e3a refs/heads/main | wc -l` 回 **7**（全是文档），
  `git diff --name-only 36214e3a refs/heads/main | grep -vcE '^(docs/|PROGRESS\.md|BLOCKED\.md|AGENTS\.md|README)'` 回 **0**
  （读数写在 `PROGRESS.md` 末节那片 ①）。⇒ 不必重跑电池；要重跑也只用按 §5 那把三层筛子判。
- **完成条件 1**：AC 那半＝达成（每格有命令 + 输出）；"T7 三条命令在隔离副本 exit 0"＝**未达成，且不由本线闭合**
  （链上本戳三枚红 `steps=[63, 87, 106]` 全在他线地界，第 49 道那枚缺陷只是被装机语言被改而暂时盖住 —— 见 §5；外加打包机不通）。
- **完成条件 2**：`node research/tools/license-inventory.mjs` 与 `node scripts/check-migrations.mjs` 各 rc=0；
  AC 勾数 0；`BLOCKED.md` 随交付提交。✅ 本戳成立（引用连 tip）。

---

## 4a. 八格复跑入口（一格一条命令，给负责人也给下一个接手人）

整串前缀固定为下面这行，表里只写要替换的 `--only` 那串（腿标签现量：`python3 research/tools/verify-inbound-ac-battery.py --list` ⇒ `legs=28`）：

```bash
python3 research/tools/verify-inbound-ac-battery.py --root .worktrees/inb-t10 --ev <新目录> --quiet-gate --only <下面那串>
```

| 格子 | `--only` 那串（逐字） | 最近一次当日读数在哪 |
|---|---|---|
| AC-1 权益与授权 | `AC1-offline11,AC1-entitlement3,AC1-quota-http,AC1-pglite,AC1-worker-identity,AC1-cjs-order` | `PROGRESS.md` 第 111 条那片（15:50 载具 tip `528b4115c`） |
| AC-2 接收与队列 | `AC2-inbound-core,AC2-queue-teeth` | 同上 |
| AC-3 领取与提交 | `AC3-dual-host,AC3-sync-authz` | 同上 |
| AC-4 解析 | `AC4-local-date,AC4-app-host,AC4-egress-wire` | 同上 |
| AC-5 批创建与来源记录 | `AC5-shared-schema,AC5-op-log,AC5-batch-actions` | 同上 |
| AC-6 规则界面 | `AC6-web-specs,AC6-browser` | 同上；⚠️ `AC6-browser` 会逐名覆写那批待拍的取证图 ⇒ 单跑它前先读 §7 第 4 格 |
| AC-7 文档 | `AC7-doc-tables,AC7-doc-endpoints,AC7-migrations,AC7-license,AC7-docs-voice,AC7-link` | `PROGRESS.md` 第 121 条（18:53 零脏载具、已入库态） |
| AC-8 验收矩阵 | `AC8-matrix,AC8-producer-seam,AC8-ac-ticks` | 同上 |
| 范围尺（**不是 AC 格**） | `SCOPE-commit-scope` | 仍 rc=1，越界笔名归别线（B205）⇒ 别把它算进 AC 结论 |

⚠️ **那两批读数凭什么还代表"当前已入库代码"**：从 `528b4115c` 到 `refs/heads/main` 的全部改动里，非文档／非台账的是 **0** 枚（这一枚 0 只代表写下那一刻：`5c274f496` 上 23:40:41 复算仍是 0，交付 tip 再往前动过**代码**就得重跑下面那条并按 `#494` 判要不要重取）——
现量 `git diff --name-only 528b4115c refs/heads/main > /tmp/d.txt; grep -vcE '^(docs/|PROGRESS\.md|BLOCKED\.md|AGENTS\.md|README)' < /tmp/d.txt`。
下一位若在这之后又动了代码，就按 #494 那三层筛子判要不要重跑，别照抄本表第三列。

---

## 5. 阻塞与风险（每条都写"谁能让它消失"）

| 格 | 现量形状 | 谁能解 |
|---|---|---|
| 腿 3：打包机不通 | `for a in windows-pc laptop-5ueuu7ps windows-codex windows-pc-lan; do ssh -o ConnectTimeout=8 -o BatchMode=yes "$a" true; echo "$a RC=$?"; done` ⇒ 四枚各 **rc=255**（本会话最后三戳 19:03:30、20:35:26、23:32:20 同形）。⚠️ **别名要逐字用这四枚**：随手敲 `win-pc`／`windows`／`packaging` 这种不在册的名字，ssh 会走 DNS 解析失败、同样回 **rc=255**，与"机器关机"逐字同形（在册名单现量 `grep -n '^Host ' ~/.ssh/config` ⇒ 这四枚在 87／102／102／187 行）。17:44:53 与 18:18:35 两戳的形状是（`windows-pc`→`10.111.127.237` Operation timed out、`windows-pc-lan`→`192.168.1.2` Connection refused、`windows-codex`／`laptop-5ueuu7ps`→`10.111.127.151` 一次超时一次 Host is down）。四枚别名其实只指**两台** Windows 宿主（`ssh -G` 取证见 B225 追记五），`scripts/reinstall-all.sh` 的 `HEYTA_WIN_HOST` 旋钮没有第三枚可指 | **只有负责人**能开机；本线按已定口径不自决退回本机出包 |
| 腿 3：设备面 | `adb devices` 回 **0 台**、`xcrun simctl list devices` 里 `heyta-multiend-reinstall` 回 **Shutdown**（18:32:09 戳，23:32:20 复探同形；昨天 20:32 那戳 `emulator-5554 device` 已在册）。⚠️ **数设备要数"非空行"**（写法见 PROGRESS 第 122 条 ⑤ 那枚命令，本格不整条抄：表格单元里的竖线会顶掉这一行的列数）—— 空列表时 `adb devices` 末尾仍带一行空行，拿 `wc -l` 数会回 **1**，把"零台"读成"有一台"。⇒ 机器通了还得先把这两面起起来。本线**能**起模拟器，但在打包机通之前不起 —— 免得留下"半跑"那种形状 | 本线能起模拟器，但要在打包机通之后一次做完 |
| 链第 49 道 `check:macos-window` | 探针 `HeytaMacApp.swift:625` 用 `input[placeholder^="添加任务"]` 数采集框，界面是英文时恒 0，三条 `NEEDED` 同时判缺（B238，形状见环境陷阱 #480）。⚠️ **本戳那趟它是 `RC=0`（18:21:43 收尾那片，`STEP= 49/116 RC=0 SEC=20.7`）—— 因为 `defaults read -g AppleLanguages` 首项已被改成 `zh-Hans-CN`**（上午 11:08 那戳是 `en`，第 104 条 ⑤），语言写盘时间 `stat -f '%Sm' ~/Library/Preferences/.GlobalPreferences.plist` 回 `Oct 19 18:12:41`。⇒ **别把这次绿读成修好了**：这是一枚同机同探针、只换装机语言的天然对照，门仍随语言翻（判据不该依赖语言），归属仍是 macOS 壳线 | macOS 壳线 |
| 链第 63 道 `check:payment-entry` | `现状：生产 compose 未配支付渠道；客户端里找到 2 处付款入口。`（尺有牙：`--self-test` 四臂全过；10-19 23:57:23 在本载具独立跑 `node scripts/check-payment-entry.mjs` ⇒ rc=**1**、末行同句，23:52 与 23:57 两跑逐字相同，原件 `~/.heyta-evidence/inb-t7-1017-0902/payentry-2357.txt`） | 收款面（B226／B223 同源） |
| 链第 87 道 `check:ai-e2e` | `detail-pane-task.spec.ts` 里 5 枚用例等不到行尾字段控件（窄档收进了「… 更多」）——安静窗内复现同一批、三倍时限对照臂也证明不是超时 | 三栏详情面线（B237） |
| 链第 106 道 `pnpm -r test` | **三枚读数排成一条线**：17:26 独立口径绿（载具 tip `fd46db9ba`）→ 18:21 链内红（先红的包是 `@heyta/mobile`，`ERR_MODULE_NOT_FOUND` 三枚 + `RolldownError`）→ 18:35 独立口径又红（**先红的包换成 `@heyta/web`**，`tests/task-sort.spec.tsx` 那一枚，`SEC=93.5`，原件 `~/.heyta-evidence/inb-t7-1017-0902/step106-1835/106.log`）。三戳之间 `git diff --name-only fd46db9ba 7024e6882` 的非文档改动 **0** 枚 ⇒ 代码没变 ⇒ 仍记"间歇性 + 链内上下文"，**不归因、不许编原因**（逐枚形状在 `BLOCKED.md` 的 B231 追记二） | web 排序那一族 / 移动载体（B229／B231） |
| 「人真打开看过截图」 | 只能由负责人做；截图绝对路径清单已交（`~/.heyta-evidence/…` 下各批，以及四端那批装机件） | 负责人 |

**风险**：证据目录里的入库 png 每次跑 AC-6 会被逐名覆写（±1~4 通道抖动、肉眼不可见、没有任何门为它红）⇒
谁在工作树脏着的时候提交，就会把不可见的字节改动一起带进去。**处置是 §7 的第 4 格**，别自己顺手改。

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

## 7. 待拍板：还开着五格（第 1 格已按负责人自己的旧令默认支闭合）

真身在 `BLOCKED.md` 对应节，拍板后**由谁做**也写在那节里。**逐格重问过"旧令有没有给默认支"**（别把它们一律读成"等答复"）：

1. ~~**B241**~~ 🟢 **已闭合，不需要答复**：那一格问"要不要按实测改写任务书里那句判据"，而**同一份任务书自己写着「不改判卷口径；要改记 `BLOCKED.md`」** ⇒ 甲支被旧令当场排除，乙支（保留原话 + 三个数各标回它那戳）已入库（现量 `git log refs/heads/main --oneline --grep='判据那句' | head`）。**翻案条件**：只有负责人本人要求把那句改成实测的 8 枚形状，甲支才允许执行。正文与翻案条件逐字在 `BLOCKED.md` 的 B241 追记。
2. **B223**（含追记二那三臂）¥12 档在 AC 未勾这段时间：甲 放回禁售清单（代价：要么门禁红着、要么在唯一数字源写一句今天不成立的话）／乙 接受"卖得出但交付证据按戳念"／丙 另给口径。生产是否真可下单**本线未取生产侧证据**（2026-10-20 00:0x 追记：**仓内配置层那一半已经证了** —— `server/docker-compose.yml:122` 写的是 `- WECHAT_PAY_ENABLED=${WECHAT_PAY_ENABLED:-false}`，尺用 `resolvedValue`（`scripts/check-payment-entry.mjs:184`）把 `:-` 后的默认值抠成 `false` ⇒ 线上只有 noop 通道 ⇒ `server/src/billing/checkout.routes.ts:162` 回 `503 BILLING_PROVIDER_NOT_CONFIGURED` ⇒ **照这份 compose 部署，这一档收得到点击、下不成单**；但尺整件不读任何 `.env`（现量 `grep -n '\.env' scripts/check-payment-entry.mjs | grep -v HEYTA_CHECK_ROOT | grep -c .` 回 0），所以部署主机那枚 env 若写 `=true` 就翻案 —— 那一层只能由运营方跑一句生产侧只读查询。五条现量命令与分母逐枚写在 `BLOCKED.md` 的 **B223 追记三**。⇒ **乙今天拿不出证据；甲／丙仍要负责人拍。**）
3. **B110** 界面那格对外措辞（中英两份 locale 都缺 `web.ai.inbound.process.waiting-entitlement`）；也可授权本线按 locale 风格出中英各一枚。
4. **B194／B239** 那批会随机变脏的已入库证据 png：(a) 原样留／(b) 落点改到不入库／(c) 用 `scripts/screenshots/png-diff.mjs` 的形状加一枚像素容差判据。**推荐 (c)，其次 (b)**。
5. **B199** 完成条件里"开工快照"那一格的口径（没开工基线 ⇒ 只能按集合判不能按计数判）。判卷口径，本线不代拍。
6. **B205** 范围尺 `越界=92`：①「自动收集」这个标题词是不是本线独占归属凭据；② 白名单收不收本线授权过的路径。**推荐**：不收路径，给装置加显式**授权登记表**。另附：载具 `.worktrees/inb-t10` 留不留（删除不可逆，`git worktree remove .worktrees/inb-t10`）。
   ⚠️ 同一份任务书还列过一枚 `.worktrees/inb-t9 的处置` —— **那格已被盘上事实作废**：23:45:59 现量 `git worktree list` 只剩 inb-t10，`ls .git/worktrees/` 里也没有 `inb-t9` 那枚管理目录 ⇒ 不是"留着但断开"，是连根没了，没有可拍的对象。台账里 212 处旧载具提及逐枚普查过（47 处是命令行形状），判法与替代入口写在计划文末「2026-10-19 23:4x · 三枚旧载具…」那一节，历史行一枚未删。

---

## 8. 下一步（按顺序；每条自带判据与"失败形状"）

1. ~~**收 §4 那枚在途链**~~ 🟢 **已收完，别重做**：那趟 116 道整串跑完，红集与逐道读数在 §4 那一格与 `PROGRESS.md` 第 118 条（⚠️ 日志形状是扁平 `…/chain-t10-1746/NNN.log`，**没有 `chain.txt`** —— 本条旧句那样写过一次，是错的）。⇒ 接手请直接从第 2 步往下做。
2. **问负责人 §7 还开着的那五格**（在对话里贴正文，不给他勾）。任一格被拍 ⇒ 按那一节里写的那一步做，改完跑对应尺。
3. **打包机回来之后一次做完腿 3**（不许半跑、不许只跑一端）：
   ```bash
   adb devices; xcrun simctl boot "heyta-multiend-reinstall" 2>/dev/null || true   # 设备面先补齐，缺就别起
   IOS_DEVICE_NAME=heyta-multiend-reinstall pnpm reinstall:all                      # 在 .worktrees/inb-t10 里，整条
   ```
   判据：`REINSTALL_RC=0` 且四端各自带"当前产物"判据；随后把截图**绝对路径**列给负责人（"人打开看过"那格归他）。
   失败形状：ssh rc=255 ⇒ 还是那台机器，不要改成"只跑绿的两端"。
4. **Linux 交付取证在腿 3 完成后重取一次**（`bash apps/desktop-linux/scripts/package-deb.sh <别名>`），
   把包内 `PKG_INDEX_SHA` 与载具 `apps/web/dist/index.html` 现量比对（相等才算"装进去的是这枚 tip 的产物"）。
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
- ⚠️ **敲错的 ssh 别名与"机器关机"回同一个 rc**：`ssh -o BatchMode=yes <不在册的名字> true` 走 DNS 解析失败也是 **255**。本会话 23:32:20 那一戳我先用 `win-pc`／`windows`／`packaging` 三枚**不存在的名字**探了一遍，四枚 rc=255 看起来"和记录一致"，其实整批是探针打空 —— ⇒ **腿 3 的复探必须逐字用上面名单里那四枚**（在册证据：`grep -n '^Host ' ~/.ssh/config` 回的四行里有它们）。
- ⚠️ **数设备要数非空行**：`adb devices` 在无设备时仍输出表头加一行空行，拿 `wc -l` 数会回 **1**（本会话 23:32 实测就是这个形状），会被读成"有一台"；台账里那条写法是数非空行的（见 PROGRESS 第 122 条 ⑤），本格因为**表格单元里不能写裸竖线**（竖线顶掉列数、写成 `\|` 又粘不回 shell）只在 §5 那格指向条目号。
- ⚠️ **`git log -1` 一次给多枚路径只回其中最新那一枚**（本会话 10-20 00:01 实测：三枚路径一起给，只出 `b56c09357`，另两枚静默消失）⇒ 做"这几个文件各属哪线"的归因必须**一枚一条**，不然归因会少算而看起来"跑成功了"。第 130 条 ② 记了这枚自曝。
- ⚠️ **grep 类分母要把构建产物剔出去**：同一棵树 `grep -rlI hosted-ai-monthly server packages/app-host` 回 **22**，加上 `git ls-files … | grep -vE '/dist/|node_modules'` 那条口径回 **16**，差的 6 枚全在 `server/dist` 与 `packages/app-host/dist`。⇒ 写"这档在哪写了"这类分母时**先声明口径**（在册源件 / 整棵工作树），两个数不是互相打脸。
- ⚠️ **往台账插一格只按整行边界，插完立刻看删列**：本会话第一稿按**字符下标** splice，正则 `\*\*B(?!223)[0-9]{3}[ 追]` 命中的是 `🟢 **B221 闭合…` 那种**行中**形状，把别人那格的标题前缀整片顶掉 —— `git diff --numstat` 当场显出删列 **1**（纯追加应当是 `N 0`）。回退用 `git checkout -- BLOCKED.md` 的前提是**起跑态 clean**（`git status --porcelain | wc -l` 先回 0），且内容能从草稿重放。

---

## 10. 相关文件

| 要查什么 | 去哪 |
|---|---|
| 唯一实施计划 + 逐格台账（AC-1～AC-8 的命令与读数、T7 三条腿） | [`inbound-automation.md`](inbound-automation.md) 文末各节；八格的**逐字输出**在「2026-10-19 21:3x · 完成条件 1 里"贴出的输出"那一半，从家目录搬进仓里」那一节，按格复跑命令在本件 §4a |
| 台账（末节号现量 `grep -oE '^1[0-9]{2}\.' PROGRESS.md | tr -d '.' | sort -n | tail -1`；纯追加、旧文不删只加带日期的改口） | [`../../PROGRESS.md`](../../PROGRESS.md) |
| 阻塞与待拍板（B207 那张待点头表、B223／B239／B241／B199／B205…） | [`../../BLOCKED.md`](../../BLOCKED.md) |
| 环境陷阱（#490 假空、#493 计数器口径、#494 三层分母、#480 探针语言敏感） | [`../reference/environment-traps.md`](../reference/environment-traps.md) |
| 四端重装与固定收尾的权威口径 | [`../agents/multi-end-build.md`](../agents/multi-end-build.md) §6.1.1 |
| 第二轮严格复审 | [`../research/inbound-automation-review.md`](../research/inbound-automation-review.md) |
| 技术协议 | [`../reference/inbound-automation-protocol.md`](../reference/inbound-automation-protocol.md) |
| 本线全部装置 | `research/tools/verify-inbound-ac-battery.py`（28 腿）、`verify-inbound-check-chain.py`（116 道）、`verify-inbound-commit-scope.py`（范围尺）、`verify-inbound-producer-seam.py`、`verify-inbound-ac8-matrix.py`、`verify-inbound-doc-tables.py`、`verify-inbound-ac-ticks.py` |
| 原件与证据（一次性、勿放 /tmp） | `~/.heyta-evidence/inb-t7-1017-0902/` |
