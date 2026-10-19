# 交接：付费自动收集（inbound automation）交付收尾

> 这份只记**当前停在哪、下一步按什么顺序做、哪些路已经走死**。
> 决策与理由不在这里：计划 [`inbound-automation.md`](inbound-automation.md)（唯一实施计划，文末是逐格台账）、
> 判据与口径在 `AGENTS.md` 与 [`docs/agents/`](../agents/)、逐条阻塞在 [`../../BLOCKED.md`](../../BLOCKED.md)。
> 写这份的当刻：**2026-10-19 18:0x**（写前先跑 `date`）。**本线一格都没勾、没 push**（现量见 §6）。

---

## 1. 一句话接手（先读这三行）

1. **这一档功能在代码层是齐的，缺的全是"证据 + 人 + 机器"**：AC-1～AC-8 每格都有可复跑命令与当日读数，
   但**勾选权在负责人**，且"四端当前产物"里 windows／android 两端的当前产物复不出来，因为它依赖的那台打包机不通。
2. **接手第一件事**：读 §4 那枚"在途"的链复跑落点（此刻正在跑第 87 道），把它的 `CHAIN … RED=… steps=[…]`
   读回 `PROGRESS.md` 追加一条，再往下做。**别重跑整条链之外的任何重步**，除非 §5 那条分母规则说该跑。
3. **不要碰**：判卷口径（B241／B199／B239 那三格等负责人）、`packages/i18n`、别人的红（四枚链红全归他线）、
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
| 28 枚 AC 腿打包成一枚可复跑电池 | 负责人可以**一条命令复量整格验收面**，而不是读一段散文 | `python3 research/tools/verify-inbound-ac-battery.py --root .worktrees/inb-t10 --ev <新目录> --quiet-gate`；逐腿读数在计划文末台账（最新一片戳在 `528b4115`／`36214e3a`，本线之后的提交全是 docs-only） |
| 电池的副作用计数拆成两枚（`EVIDENCE_DIRTY=` 只数派生证据目录、`CARRIER_DIRTY=` 数整棵载具），并加一枚喂假输入的臂 | "跑批会把入库证据图改脏"这件事第一次变成**能红的判据**而不是口头声称 | 装置 `research/tools/verify-inbound-ac-battery.py`；`--self-test` 现量 `arms=11 failed=0`；口径改口笔 `833991d5` |
| 链"要不要重跑"这把筛子的分母改成**逐道从被触发物自己的声明现取**，并降到符号级 | 不再出现"筛出一片假空 ⇒ 判不必重跑"这种会把结论建在空读数上的判据 | 环境陷阱 **#494**（含三层规则）；台账 `PROGRESS.md` 第 115／116 条；第 63 道复跑 `STEP= 63/116 RC=1 SEC=1.7`、第 106 道 `STEP=106/116 RC=0 SEC=78.9`（载具 tip `fd46db9ba`／`b29b3f7b6`，原件 `~/.heyta-evidence/inb-t7-1017-0902/step63-1714/`、`…/step106-1726/`） |
| Linux 交付取证 | 这一端的"当前产物"是真的：装进 `.deb` 的就是这枚 tip 重打的 web 产物 | `bash apps/desktop-linux/scripts/package-deb.sh <linux-dev 别名>` ⇒ `LINUX_DEB_RC=0`／`PKG_RESULT=OK`，包内 `PKG_INDEX_SHA` 与载具 `apps/web/dist/index.html` 全串相等 |
| apps/web 单测锚从子集升成**全量 rc=0** | 交付树上"web 面没红"这句有全量支撑 | `cd .worktrees/inb-t10/apps/web && npx --no-install vitest run` ⇒ `180 passed \| 2 skipped (182)`／`2307 passed \| 13 skipped (2320)`（`…/webfull-1705/`） |
| 六格待拍板逐格把**正文**（选项 + 后果 + 推荐）贴给负责人 | 负责人不需要翻文件就能拍板 | 见 §7；正文真身在 `BLOCKED.md` 对应节 |

本轮入库的提交（全部本地、未 push）：`833991d5`、`528b4115`、`36214e3a`、`8bb12a37`、`95e8cb75`、`c0dbd925`、`fd46db9ba`、`b29b3f7b6`。
⚠️ 引用这些读数**必须连着当时的 tip 念**——本仓 HEAD 每小时都在被别人推。

---

## 4. 当前状态（此刻的形状，接手时先重测这三条）

```bash
date                                    # 时间戳前先跑
git rev-parse --short refs/heads/main   # 🔴 读主线，别读 HEAD：共享检出 15:02 起被别线切在 feat/paycenter-integration
git -C .worktrees/inb-t10 status --porcelain | wc -l   # 载具应为 0
```

- **在途**：116 道整条链在隔离载具复跑，驱动日志 `~/.heyta-evidence/inb-t7-1017-0902/chain-t10-1746-run.txt`
  与逐道 `…/chain-t10-1746/{chain.txt,logs/NNN.log}`；18:06 那一戳读到第 86 道，**第 87 道（`check:ai-e2e`，预算 1800 s）正在跑**。
  跑完要做的：把末行 `CHAIN ran=… RED=… steps=[…]` 与逐枚 RC 读回 `PROGRESS.md` 追加一条（纯追加、判卷口径零处），点名提交。
- **AC 那半**：28 枚腿逐腿有读数（计划文末台账），代码自那片戳以来没变（`git log --oneline 36214e3a..refs/heads/main` 只回本线 docs 笔）。
- **完成条件 1**：AC 那半＝达成（每格有命令 + 输出）；"T7 三条命令在隔离副本 exit 0"＝**未达成，且不由本线闭合**
  （四枚链红全在他线地界 + 打包机不通）。
- **完成条件 2**：`node research/tools/license-inventory.mjs` 与 `node scripts/check-migrations.mjs` 各 rc=0；
  AC 勾数 0；`BLOCKED.md` 随交付提交。✅ 本戳成立（引用连 tip）。

---

## 5. 阻塞与风险（每条都写"谁能让它消失"）

| 格 | 现量形状 | 谁能解 |
|---|---|---|
| 腿 3：打包机不通 | `for a in windows-pc laptop-5ueuu7ps windows-codex windows-pc-lan; do ssh -o ConnectTimeout=8 -o BatchMode=yes "$a" true; echo "$a RC=$?"; done` ⇒ 四枚各 **rc=255**（17:44:53 戳）。四枚别名其实只指**两台** Windows 宿主（`ssh -G` 取证见 B225 追记四），`scripts/reinstall-all.sh` 的 `HEYTA_WIN_HOST` 旋钮没有第三枚可指 | **只有负责人**能开机；本线按已定口径不自决退回本机出包 |
| 腿 3：设备面 | `adb devices` 回 **0 台**（17:47 戳；昨天 20:32 那戳 `emulator-5554 device` 已在册）、`xcrun simctl list` 里 `heyta-multiend-reinstall` 是 **Shutdown** ⇒ 机器通了还得先把这两面起起来 | 本线能起模拟器／模拟器，但要在打包机通之后一次做完 |
| 链第 49 道 `check:macos-window` | 探针 `HeytaMacApp.swift:625` 用 `input[placeholder^="添加任务"]` 数采集框，本机是英文装机态 ⇒ 恒 0，三条 `NEEDED` 同时判缺（B238，形状见环境陷阱 #480） | macOS 壳线 |
| 链第 63 道 `check:payment-entry` | `现状：生产 compose 未配支付渠道；客户端里找到 2 处付款入口。`（尺有牙：`--self-test` 四臂全过） | 收款面（B226／B223 同源） |
| 链第 87 道 `check:ai-e2e` | `detail-pane-task.spec.ts` 里 5 枚用例等不到行尾字段控件（窄档收进了「… 更多」）——安静窗内复现同一批、三倍时限对照臂也证明不是超时 | 三栏详情面线（B237） |
| 链第 106 道 `pnpm -r test` | 链内口径曾红（web `task-sort.spec.tsx` 一枚 + 移动侧 `ERR_MODULE_NOT_FOUND`），**独立口径本戳绿**；落点零改动 ⇒ 记为"间歇性 + 链内上下文"，不归因 | web 排序那一族 / 移动载体（B229／B231） |
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

## 7. 待拍板的六格（正文已贴给负责人；**别替他勾，也别登记成"他没答"**）

真身在 `BLOCKED.md` 对应节，拍板后**由谁做**也写在那节里：

1. **B241** 第 1 步那条判据原话的三个枚数分属三戳（`4 failed` 今天复现不出来）⇒ (A) 按实测改写／(B) 保留原话当方向性判据。**推荐 (A)**。判卷口径，不动。
2. **B223**（含追记二那三臂）¥12 档在 AC 未勾这段时间：甲 放回禁售清单（代价：要么门禁红着、要么在唯一数字源写一句今天不成立的话）／乙 接受"卖得出但交付证据按戳念"／丙 另给口径。生产是否真可下单**本线未取生产侧证据**。
3. **B110** 界面那格对外措辞（中英两份 locale 都缺 `web.ai.inbound.process.waiting-entitlement`）；也可授权本线按 locale 风格出中英各一枚。
4. **B194／B239** 那批会随机变脏的已入库证据 png：(a) 原样留／(b) 落点改到不入库／(c) 用 `scripts/screenshots/png-diff.mjs` 的形状加一枚像素容差判据。**推荐 (c)，其次 (b)**。
5. **B199** 完成条件里"开工快照"那一格的口径（没开工基线 ⇒ 只能按集合判不能按计数判）。判卷口径，本线不代拍。
6. **B205** 范围尺 `越界=92`：①「自动收集」这个标题词是不是本线独占归属凭据；② 白名单收不收本线授权过的路径。**推荐**：不收路径，给装置加显式**授权登记表**。另附：载具 `.worktrees/inb-t10` 留不留（删除不可逆，`git worktree remove .worktrees/inb-t10`）。

---

## 8. 下一步（按顺序；每条自带判据与"失败形状"）

1. **收 §4 那枚在途链**：读 `…/chain-t10-1746-run.txt` 末行 + `chain.txt` 的逐道 RC，写 `PROGRESS.md` 追加一条
   （格式照第 116 条：每个数旁边有现量命令），点名提交。判据：红集若仍是他线那几枚 ⇒ 归属表照抄 §5，**不代改**。
2. **问负责人 §7 那六格**（在对话里贴正文，不给他勾）。任一格被拍 ⇒ 按那一节里写的那一步做，改完跑对应尺。
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
- 🔴 **`git log -- <不存在的路径>` 静默回 rc=0、零字节** ⇒ 一片假空（#490）；存在性只能 `test -e`／`ls -d` 直接问盘。
- 🔴 **管道尾巴吃退出码**（`cmd | tail` 之后读 `$?` 读的是 tail）；取 rc 一律不带管道。#45／#179／#184。
- 🔴 **"独立跑绿"≠"链内跑绿"**：两个口径，台账里必须分开引用（本轮第 106 道就是这么处理的）。
- 🔴 **别线那 19 行未提交的 #492 曾与本线条目撞号**：共享检出上写同一枚文件时，先 `git log -1 -- <文件>` 与 `git status --porcelain -- <文件>`，
  号只增不改 ⇒ 宁可留"main 上 491→493 的瞬时空档"（两线合并即连续），也别占别人的号或把别人的活折进自己那笔。
- 🔴 **`pnpm check-migrations` 不存在**（真名 `check:migrations` = `node scripts/check-migrations.mjs`）、
  **`check-docs-voice.mjs` 在 `scripts/` 不在 `research/tools/`**（照裸名拼路径会得到 MODULE_NOT_FOUND + rc=1，形状与"门判红"逐字同形）。
  散文里的工具名会漂，引用前先 `find`/`grep -n package.json`。
- ⚠️ 别把 `docs-link-check` 在主检出上的红读成"本线改坏了"：它读的是共享检出在途态（并行会话未入库件会造红）；
  要"当前提交产物"那一格，就在零脏载具上跑同一条命令。
- ⚠️ 可复现物不要住 `/tmp`（重启就没了，而且复用同名会让提交吃进陈件）：臂、驱动、原件一律落 `~/.heyta-evidence/inb-t7-1017-0902/`。

---

## 10. 相关文件

| 要查什么 | 去哪 |
|---|---|
| 唯一实施计划 + 逐格台账（AC-1～AC-8 的命令与读数、T7 三条腿） | [`inbound-automation.md`](inbound-automation.md) 文末各节 |
| 台账（本会话写到第 116 条，纯追加、旧文不删只加带日期的改口） | [`../../PROGRESS.md`](../../PROGRESS.md) |
| 阻塞与待拍板（B207 那张待点头表、B223／B239／B241／B199／B205…） | [`../../BLOCKED.md`](../../BLOCKED.md) |
| 环境陷阱（#490 假空、#493 计数器口径、#494 三层分母、#480 探针语言敏感） | [`../reference/environment-traps.md`](../reference/environment-traps.md) |
| 四端重装与固定收尾的权威口径 | [`../agents/multi-end-build.md`](../agents/multi-end-build.md) §6.1.1 |
| 第二轮严格复审 | [`../research/inbound-automation-review.md`](../research/inbound-automation-review.md) |
| 技术协议 | [`../reference/inbound-automation-protocol.md`](../reference/inbound-automation-protocol.md) |
| 本线全部装置 | `research/tools/verify-inbound-ac-battery.py`（28 腿）、`verify-inbound-check-chain.py`（116 道）、`verify-inbound-commit-scope.py`（范围尺）、`verify-inbound-producer-seam.py`、`verify-inbound-ac8-matrix.py`、`verify-inbound-doc-tables.py`、`verify-inbound-ac-ticks.py` |
| 原件与证据（一次性、勿放 /tmp） | `~/.heyta-evidence/inb-t7-1017-0902/` |
