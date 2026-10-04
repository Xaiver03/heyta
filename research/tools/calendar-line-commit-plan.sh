#!/usr/bin/env bash
# 日历 / 移动端 Profile 这条线的"入库最小集"复跑器（§5 第 5 条 A 那条的工具化）。
#
# 为什么存在：A 那份点名清单是**活树瞬时读数，不是提交属性** —— 本会话里它已过期五次
# （别人不断把本线的工作树整片吸进 HEAD，而我又新写装置）。散文清单的保质期是几分钟，
# 所以这里把它落成一条命令：**每次运行都重新量一遍**，再打印可复制的点名动作。
#
# 默认 **dry-run**：只测量与打印，绝不碰索引。真正执行要显式 `--confirm` 且给 `MSG`。
# 🔴 本会话（以及任何没有拿到当场提交授权的人）只该跑到 dry-run 那一层。
#
# 退出码：0 = 干跑完成（或 --confirm 下提交后校验通过）
#         1 = 用法/前提不成立（缺 MSG、载体外路径、索引里有**别人**的暂存…）
#         3 = 静态门禁红（md-tables / shell-unicode 任一非零 ⇒ 先修自己再谈入库）
#
# 用法：
#   bash research/tools/calendar-line-commit-plan.sh                       # 干跑
#   MSG='docs(calendar): …' bash research/tools/calendar-line-commit-plan.sh --confirm
set -u
cd "$(dirname "$0")/../.." || exit 1

# 🔴 点名路径，一条都不许用 `-A` / `.`：共享工作树里 `git add -A` 会把别人的 WIP 一起吞进去
#    （本机实测过一次裸 commit 带走别人 109 枚暂存）。
PATHS=(
  docs/plans/calendar-year-time-and-mobile-profile.md
  docs/plans/calendar-profile-handoff.md
  scripts/lib/mobile-e2e-runner-probe.sh
  # 🔴 10:1x 由新的 OUTSIDE_NS 读数格**当场照出来的漏件**：本线 09:0x 新建的楔住检测 lib，
  #    C 链的覆盖判据与窗口闸门都 source 它，它不在清单里 = A 提交出去的 HEAD 少一枚承重文件。
  scripts/lib/wedged-runner.sh
  scripts/verify-mobile-window-gate.sh
  scripts/verify-mobile-due-time.sh
  research/tools/r14c-carrier-chain.sh
  research/tools/r14c-window-retry.sh
  research/tools/r14c-window-retry-arms.sh
  research/tools/r14c-install-guard-arms.sh
  research/tools/r14c-drift-teeth.sh
  research/tools/r14c-chain-overlay-arms.sh
  # 🔴 与 `scripts/verify-mobile-due-time.sh` 里那对「TIME_EMPTY 自校准 + 归一」**同批落地**：
  #    那把刀写错方向会把假红换成更贵的假绿，而它只有这一把 rig 会红。
  #    少了它，判据改了却没有任何一层能失败那段归一（§8.7：改了判据要能失败它）。
  research/tools/r14c-time-empty-arms.sh
  # 🔴 与 `assert_channel` / 第 1 步那两处 `settle_foreground` **同批落地**：
  #    20:0x 那趟"通道死了却一路收假红"就是缺这道停止条件，而它会不会真的停只能由这把 rig 答
  #    （八臂：A–E 通道自检 + G/H/I 抽共享库 `settle_foreground` 原文跑的三条腿）。
  research/tools/r14c-channel-arms.sh
  # 🔴 与链的 `ask_gate()` + `verify rc=3 有界重跑`**同批落地**：那 22 行窗口判据现在有两个消费者
  #    （开窗前与重跑前），而"rc=3 才重跑、rc=1 绝不重跑、闸门关着就一个字不跑"只能由这把六臂 rig 答。
  research/tools/r14c-verify-retry-arms.sh
  # 🔴 这一批**成对落地的三枚**（链 + 它依赖的两枚共享起栈脚本）：
  #    `r14c-carrier-chain.sh` 新加的 `stack_isolation` 后置断言依赖 `scripts/mobile-e2e-up.sh`
  #    那两枚新旋钮（`HEYTA_E2E_PIDFILE` / `HEYTA_E2E_LOGFILE`），而载体那份取的是**已提交副本**
  #    ⇒ 只提链不提那两枚，下一次开窗就是"链传了没人接的参数"（17:5x 现场照出来的正是这个形状：
  #    载体那份 `PIDFILE=` 仍写死在 `:46`）。
  #    ⚠️ 那两枚**刻意不进 NS_RE**（那张网按"本线自己创建的文件名"反查；共享起栈脚本归设备验收那条线）：
  #    这里点名它们，是因为**此刻脏的那几行是本线的**，不是因为它们是本线的资产。
  scripts/mobile-e2e-up.sh
  scripts/mobile-e2e-down.sh
  research/tools/r14c-stack-isolation-arms.sh
  research/tools/r14c-gate-b-exclusive-arms.sh
  # 🔴 这枚是闸门**第二次**抓到的（06:1x）：它写在闸门之后，写完没进清单就被 1b 拦下 ——
  #    也就是说这条闸门抓的不是"今天那一次遗漏"，而是"以后每一枚新装置"。
  research/tools/r14c-gate-hint-arms.sh
  # B 那条的开工体检器（06:3x 新写）：dry-run + 七格前置 + 三臂自测（格数与形状以脚本头部为准，别从这里推断）
  research/tools/b-reinstall-readiness.sh
  # 🔴 10:1x 补的三枚：它们都在下面那条命名空间**正则**之外（前缀写的是 `b-reinstall-`），
  #    所以 1b 那格报"全部已点名"的同时把它们静默排除了 —— 见 NS_RE 那里改成的 `b-`。
  research/tools/b-arm3-mutation-arms.sh
  research/tools/b-wedge-mutation-arms.sh
  research/tools/b-batch-reconcile.sh
  research/tools/r14c-carrier-heal.sh
  research/tools/r14c-boot-avd-arms.sh
  research/tools/r14c-heal-fire-arms.sh
  research/tools/r14c-signal-trap-arms.sh
  # 🔴 这枚是下面「1b 防漏登记」闸门**第一次运行当场抓出来的**（06:0x）：
  #    它 03:45 就写好了、被同命名空间三枚工具与台账文档引用，却没进清单 ——
  #    也就是说这条清单在我补闸门之前**确实会静默漏件**。
  research/tools/r14c-server-readability-judgment.sh
  research/tools/shell-unicode-independent-scan.py
  research/tools/r14c-bundle-testid-preflight.sh
  research/tools/r17-evidence-md5-check.sh
  # 14:2x 新写：把 --all 报为 UISTALE 的证据目录重拍一遍（默认 dry-run，前置不达标 exit 3）。
  # 🔴 它同样是**这条防漏格自己抓出来的**：文件刚落盘、还没进清单，1b 就报
  #    `❌ 本线命名空间有改动却没点名 [??]：research/tools/r17-reshoot-stale.sh` ⇒ 有牙。
  research/tools/r17-reshoot-stale.sh
  # 15:4x：上面那条 --only 前置被换成后置对账之后，**这一把就是它的牙**（三臂：正向 / 摘掉 --only /
  # 我方路径暂存≠工作树）。同样是 1b 自己抓出来的（落盘即报 `[??]`）—— 第四次。
  research/tools/calendar-line-commit-only-arms.sh
  research/tools/h-flaky-window-watcher.sh
  # 边界 F 第二条的现量清点器（11:0x 新写）：台账里那句"188 处"是一条断言，
  # 落成脚本才有可复跑的读数（03:0x 那次就是靠现拼 `$( )` 把探针弄坏的）。
  research/tools/f-boundary-scope-count.sh
  apps/web/evidence/calendar-view-options/README.md
  # 🔴 这两枚 png 也在清单里，而且**必须由本线一起提交**：06:1x 那趟三连同跑把它们的字节改了
  #    （`52174907…` / `ae8ad61d…`，而 HEAD 里仍是 01:34 那两枚 `d2c5cbfd…` / `6fcbf2aa…`）。
  #    只提 README 不提 png = **HEAD 里的 README 记着一对盘上取不到的指纹**，
  #    下一个人 clone 完跑 `r17-evidence-md5-check.sh` 会当场红，而红因是我这笔提交。
  apps/web/evidence/calendar-view-options/view-select-closed.png
  apps/web/evidence/calendar-view-options/view-tabs-year.png
  apps/web/evidence/calendar-day/README.md
  apps/web/evidence/calendar-day/day-en-empty.png
  apps/web/evidence/calendar-day/day-en-full.png
  apps/web/evidence/calendar-day/day-en-no-timed.png
  apps/web/evidence/profile-panel/README.md
  apps/web/evidence/profile-panel/r15b-1-need-password.png
  apps/web/evidence/profile-panel/r15b-2-ready.png
  apps/web/evidence/profile-panel/r15b-3-ready-dark.png
  apps/web/evidence/profile-panel/r15b-4-after-reload.png
  # 🔴 14:1x 补进清单的五枚：它们都是**本线补的证据锚点**（README 里逐张"人看到的" + UIPIN），
  #    而 13:5x/14:1x 之前**一枚都不在这份清单里** —— 也就是说 A 那格"清单已全"当时是**假绿**：
  #    它只数了清单里点到的那些。下面 NS_RE 同步扩了两条交替式（旧那条 `calendar-day` 后面
  #    紧跟 `/`，所以 `calendar-day-time/` **匹配不到**，不是已经覆盖）。
  #    ⚠️ 只点 `README.md`，**不点这些目录里的 png**：那些字节是别的会话跑 e2e 时写的，
  #    工作树里它们相对 HEAD 干净 ⇒ 本线没有该提交它们的改动。
  apps/web/evidence/calendar-year/README.md
  apps/web/evidence/calendar-day-time/README.md
  apps/web/evidence/calendar-cells/README.md
  apps/web/evidence/calendar-week/README.md
  apps/web/evidence/calendar-capture/README.md
  research/tools/calendar-line-commit-plan.sh
  # 这枚**不是**本线创建的文件，但脏的那一行是本线的（文档中心里 calendar-profile 那一行，
  # 现量 `git diff --numstat` = 1/1 即整份只有这一行改动）。共享文档只点自己那一行的归属。
  # 🔴 反例（刻意**不**加）：`scripts/verify-mobile-notes.sh` 那一枚顺带修属 notes 那条线，
  #    代别人提交一行是归属越界 —— 移交口径见交接 §5 第 5 条。
  docs/plans/README.md
)

# 🔴 「刻意不带」登记册（17:5x 加）。加它的原因不是"想放行"，是**原来没有可达的出口**：
#    §1b 那句"确认不归本线的，就在这里写明为什么不加"对**证据目录里的 png** 做不到 ——
#    NS_RE 连 png 一起反查（那也是刻意的：README 记的就是图的字节，只提 README 不提图 = 自相矛盾的 HEAD）。
#    于是只要它们脏着，就只剩两条路，而两条都是错的：
#      · §1b 判红 ⇒ 把"别人重跑的字节"读成"本线入库被挡住了"（17:4x 现场就是这个读法）；
#      · `--confirm` 带走 ⇒ 提交一个 README 与图字节不同步的 HEAD（交接 §4.05 (11)(12) 警告过的那种）。
#    第三条路写进机器：**挂着、逐枚带理由、每次现量它还在不在**。
# ⚠️ 这不是豁免：在册的枚数照样打印、照样点名，而且下面第 1c 格会**断言每条理由非空**、
#    并对"已经不脏的在册条目"打「待摘」—— 所以这里不许写"永远不归本线"那种话，
#    条目只能跟着现量走（它什么时候被别人提交了 / 被重拍覆盖了，就该从这本册子里划掉）。
# 格式：`<路径>|<为什么不带走 + 处置路>`
UNCARRIED=(
  "apps/web/evidence/calendar-view-options/view-select-closed.png|17:25 别人那趟 e2e 重写的字节，本线没看过它（README 第 11 行那句「盘上此刻」随之过期）⇒ 处置＝交接 §5 的第 11 号那一单（重拍 + 人看 + 重钉）"
  "apps/web/evidence/calendar-day/day-en-empty.png|同一趟 17:25 重写的字节，而 README 把它钉成**常驻 md5**（README=57d2d008… 等于 HEAD，盘上=d64c4994…）⇒ 带走就是提交一个判据自己就会红的 HEAD；处置＝同上那一单"
  "apps/web/evidence/calendar-day/day-en-full.png|同一趟 17:25 重写；该目录 README 第 146–147 行写着它与 day-en-no-timed **是同一屏**（现在连字节都相同：两枚都是 bac2e331…）⇒ 这张在本视口下不构成独立证据，等重拍时一并定"
  "apps/web/evidence/calendar-day/day-en-no-timed.png|同上（与 day-en-full 逐字节相同）；处置＝重拍时决定要不要把这张降级成『窄视口才有意义』的那一张"
)

CONFIRM=0
# 🔴 测试缝：`--confirm` 那一腿会真提交，绝不能拿本仓库当夹具。
#    有 PATHS_OVERRIDE（竖线分隔）时，清单从环境取，其余逻辑一字不改 ——
#    这样"迷你树里跑通 --confirm"证的就是主检出里那一腿的代码。
if [ -n "${PATHS_OVERRIDE:-}" ]; then
  IFS='|' read -r -a PATHS <<<"$PATHS_OVERRIDE"
fi
# 🔴 同一把测试缝的另一半：**在册清单也要能从环境灌**，否则第 1c 格那三条断言（理由非空 /
#    在册必配 PATHS / 已不脏要打「待摘」）在任何夹具里都跑不到 —— 而"跑不到的那一段"
#    就是它坏了也没人知道的那一段（本文件 §2 那次事故的同族：一条没跑过的动作腿 = 没有判据）。
#    条目之间用**换行**分隔 —— 条目内部还有 `路径|理由` 那一层竖线，按 `|` 切会把理由切掉
#    （第一版就是这么写的，症状是"理由全部消失"而不是报错）。
# ⚠️ 判"有没有传"用 `${…+set}` 而不是 `-n`：夹具需要的是**传一枚空的册子**
#    （`UNCARRIED_OVERRIDE=""`），用 `-n` 判空会被当成"没传"⇒ 掉回去用仓库里那 4 枚真路径，
#    而迷你树里根本没有它们 ⇒ 1b 先 exit 1，17:5x 五臂就是这样整片转红的。
if [ "${UNCARRIED_OVERRIDE+set}" = set ]; then
  UNCARRIED=()
  while IFS= read -r u_line; do
    [ -n "$u_line" ] && UNCARRIED+=("$u_line")
  done <<<"$UNCARRIED_OVERRIDE"
fi
for a in "$@"; do
  case "$a" in
    --confirm) CONFIRM=1 ;;
    -h|--help) sed -n '1,25p' "$0"; exit 0 ;;
    *) echo "未知参数：${a}（只认 --confirm / --help）" >&2; exit 1 ;;
  esac
done
if [ "$CONFIRM" = 1 ] && [ -z "${MSG:-}" ]; then
  echo "❌ --confirm 需要 MSG（提交信息）：缺参就 exit 1，不替你编一句。" >&2
  exit 1
fi

echo "仓库根：$(pwd)"
# 在册判定（⚠️ bash 3.2 + `set -u`：空数组的 `"${UNCARRIED[@]}"` 会当场崩 —— 本仓 §7 第 237 条那一族，
#    所以先取枚数、为 0 就直接返回"不在册"，不展开数组）。
U_COUNT=${#UNCARRIED[@]}
is_uncarried() {
  local u
  [ "$U_COUNT" = 0 ] && return 1
  for u in "${UNCARRIED[@]}"; do
    [ "${u%%|*}" = "$1" ] && return 0
  done
  return 1
}
echo "== 1. 现量重取清单（别引用文件里的旧枚数）=="
ST=0; UN=0; NAMES=(); UNC_SEEN=0
for p in "${PATHS[@]}"; do
  if [ ! -e "$p" ]; then
    # 🔴 点名路径不在磁盘上 = 这份清单自己过期了（改名/删除/写错）。
    #    不能把它当"已入库"跳过 —— 那正是"漏点名会静默留在工作树"的反面：静默少一枚。
    echo "   ❌ 点名路径在磁盘上不存在：$p —— 清单过期，先修清单（exit 1）。" >&2
    exit 1
  fi
  line=$(git status --porcelain -- "$p")
  if [ -z "$line" ]; then
    printf '   ✅ 已在 HEAD 且工作树与 HEAD 一致：%s\n' "$p"
  else
    # 🔴 在册的枚数**在这一格就分流**，既不进 NAMES 也不计入"待入库 / 改动"：
    #    先 case 后判在册的那版会打出 `待入库 7 枚（改动 10 / 新增 1）` —— 总数比分项还小，
    #    17:5x 现量到的正是这个自相矛盾读数。一枚文件只许有一个口径。
    #    逐枚理由与状态在下面的第 1c 格，那里也照样看得见它们，不会静默消失。
    if is_uncarried "$p"; then
      UNC_SEEN=$((UNC_SEEN + 1))
      continue
    fi
    # 🔴 porcelain 前两列是 XY（第 1 列 = 索引 vs HEAD，第 2 列 = 工作树 vs 索引）。
    #    `${line%% *}` 对 ' M …' 会切在第一个空格上得到**空串** —— 我第一版就是这么写的，
    #    结果 'M' 那一条 case **永远不会被命中**（一条走不到的分支 = 没有判据）。
    code=${line:0:2}
    case "$code" in
      '??') kind="未跟踪(新文件，需先 add)"; UN=$((UN + 1)) ;;
      ' M'|'M '|'MM'|'AM') kind="已跟踪有改动 [${code}]"; ST=$((ST + 1)) ;;
      *) kind="状态码 [${code}]（原样报出，不归类）"; ST=$((ST + 1)) ;;
    esac
    printf '   🟡 %s：%s\n' "$kind" "$p"
    NAMES+=("$p")
  fi
done
TOTAL=$(( ${#NAMES[@]} ))
# 先把第 1 格的读数打完再进 1b —— 否则「待入库 N 枚」会印在 1b 的标题下面，
# 读日志的人会把第 1 格的量归给第 1b 格（同一份输出里两格的量长得一样）。
if [ "$TOTAL" != 0 ]; then echo "   ⇒ 待入库 $TOTAL 枚（改动 $ST / 新增 ${UN}）"; fi
if [ "$UNC_SEEN" != 0 ]; then echo "   ⇒ 另「刻意不带」$UNC_SEEN 枚（不进这一笔，逐枚理由见第 1c 格）"; fi

echo "== 1b. 防「漏登记」：本线命名空间里改了却没点名的文件 =="
# 🔴 为什么加这一格：PATHS 是我手维护的，而**手维护的清单会漏**——今天实测漏了两枚
#    （`research/tools/h-flaky-window-watcher.sh` 与 `docs/plans/README.md`，两枚都在工作树里
#     ` M`，清单却不含它们）。"枚数归零"那条收尾自检只在**已点名**的范围内归零，
#    漏的那枚永远不会让它变红 ⇒ 这条清单原来是一条**没有牙的清单**。
#    牙的形状：从"本线自己创建的文件名"反查工作树，凡脏而未点名即 exit 1。
# ⚠️ 边界（不写清就会被读成"什么都挡住了"）：
#   · 它按**名字**判归属，不按 author —— 别人若在同一命名空间里改文件会误报，报了由人来核；
#   · 它**挡不住**"我改了别人的文件"（`scripts/verify-mobile-notes.sh` 那一枚顺带修就是），
#     那种只能靠 PATHS 里显式不点名 + 文档写明移交口径。
# 🔴 14:1x 扩证据目录那五条交替式时的两个现量事实，别读成"以前都覆盖了"：
#   ① 旧那条写的是 `(calendar-day|…)/` —— 正则里 `calendar-day` 后面**紧跟一个 `/`**，
#      所以 `apps/web/evidence/calendar-day-time/README.md` **从来就不匹配**（不是被漏在清单里，
#      是命名空间根本没看它）⇒ 1b 那格当时对它是**瞎**的。
#   ② 新加的五个目录**只把 `README.md` 划进本线命名空间，png 不划**：
#      那些字节是别人的 e2e 趟写的，工作树相对 HEAD 干净 ⇒ 划进来会让 1b 去点名不属于本线的文件。
# ⚠️ `docs/reference/environment-traps.md` **刻意不在这里、也不在 PATHS**：那是并行会话共用的台账
#    （14:1x 现量 ` M`、+318/-7；**本线占哪几条不抄在这里** —— 号段会漂而且不连续，唯一现量口径在交接 §4.05 那条 `for n in …grep -cE` 命令），点名它 = 把别人几百行未提交内容
#    一起提交进去。本线条目的可复跑归属口径写在交接 §4.05。
NS_RE='^research/tools/(r14c-|r17-|h-flaky-|calendar-line-|b-|f-boundary-)|^docs/plans/(calendar-year-time-and-mobile-profile|calendar-profile-handoff)\.md$|^scripts/(verify-mobile-window-gate|verify-mobile-due-time)\.sh$|^scripts/lib/(mobile-e2e-runner-probe|wedged-runner)\.sh$|^apps/web/evidence/(calendar-day|calendar-view-options|profile-panel)/[^/]+\.(md|png)$|^apps/web/evidence/(calendar-year|calendar-day-time|calendar-cells|calendar-week|calendar-capture)/README\.md$'
# 🔴 11:0x 加 `f-boundary-`（不写裸 `f-`：那个前缀太短，别的线随时会撞上，撞上了就把别人的文件
#    划进本线的归属）。同一时刻把它加进上面的 PATHS —— **两处一起改**才有效：
#    只改正则 = 它在 1b 里"可见但不被点名"；只改 PATHS = 下次再写一枚新装置照样会被漏（今天已经第三次）。
# 🔴 10:1x 把 `b-reinstall-` 放宽成 `b-`，理由是**实测**：那一格当时报"命名空间命中 35 枚全部已点名"，
#    而本线在同一时刻还脏着三枚 `b-arm3- / b-wedge- / b-batch-` 的装置**在它外面** ——
#    也就是说这条"防漏登记"的闸门自己就是一条手维护的前缀清单，它会漏的和它要防的是同一件事。
#    代价写清楚：别的线若在本机新建 `research/tools/b-xxx.sh` 会被**误报**（报了由人来核，
#    这与本文件头那条边界一致）；误报的方向是"多问一句"，不是"静默放行"。
# 🔴 证据目录那一支**连 png 一起反查**（06:2x 加）：README 记的是图的字节，
#    只提 README 不提图 = 提交出一个自相矛盾的 HEAD（README 里那对指纹在盘上取不到）。
#    代价是噪声：别人一趟 e2e 重写同名图也会让它红 —— 但那种红是**真问题**
#    （要么连图一起提，要么按新字节重看再改 README），不是误报，所以别把这一支摘掉。
ALL_DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
NS_HIT=0; LOST=0
while IFS= read -r st; do
  code=${st:0:2}; f=${st:3}
  case "$f" in *' -> '*) f=${f%%' -> '*} ;; esac     # 重命名的第二列是目标，取目标那侧
  printf '%s\n' "$f" | grep -qE "$NS_RE" || continue
  NS_HIT=$((NS_HIT + 1))
  hit=0
  for p in "${PATHS[@]}"; do
    [ "$p" = "$f" ] && hit=1
  done
  if [ "$hit" = 0 ]; then
    printf '   ❌ 本线命名空间有改动却没点名 [%s]：%s\n' "$code" "$f"
    LOST=$((LOST + 1))
  fi
done < <(git status --porcelain)
# 🔴 10:1x 加的**读数格**（不参与红绿）：上面那条命名空间**本身也是手维护的正则**，
#    它会漏的和它要防的是同一件事 —— 本轮实测漏了三枚 `b-*` 装置（见 NS_RE 那段），
#    而收窄成"未跟踪的新文件"之后**当场又照出一枚真的**：`scripts/lib/wedged-runner.sh`
#    （本线 09:0x 新建、被 C 链的覆盖判据依赖，命名空间里没有它 ⇒ A 会静默漏提）。
#    范围为什么只取"未跟踪 + research/tools/ scripts/"：全目录跑是 91 行噪声（别人每条线的
#    未提交改动都在里面），而"我新建了一枚装置、清单与命名空间都没看到"才是这条闸门要防的那个形状。
#    刻意不据此判红：别人新建的 `scripts/check-legal-*.mjs` 之类会长期出现在这里，
#    拿它判红就把这条闸门变成一条天生红的闸门（AGENTS §8.3）。
OUTSIDE_NS=$(git status --porcelain -- research/tools scripts 2>/dev/null \
  | awk '$1=="??"{print $2}' | grep -vE "$NS_RE" || true)
OUTSIDE_NS_N=$(printf '%s\n' "$OUTSIDE_NS" | grep -c . || true)
echo "   OUTSIDE_NS=${OUTSIDE_NS_N}（命名空间**没看过**的新文件；逐条列出、各自归所有者，不判红）"
if [ "$OUTSIDE_NS_N" != 0 ]; then
  printf '%s\n' "$OUTSIDE_NS" | sed 's/^/      · /'
fi
if [ "$LOST" != 0 ]; then
  echo "   ⇒ 加进 PATHS；确认不归本线的，就在这里写明为什么不加（不能默默留着）。exit 1。"
  exit 1
fi
echo "   ✅ 命名空间命中 $NS_HIT 枚全部已点名（工作树脏行分母 ${ALL_DIRTY}）"

echo "== 1c. 在册「刻意不带」逐枚现量（这不是豁免：理由写在这本册子里，状态每次重取）=="
# 🔴 三条断言，缺一条这本册子就会变成"把带走伪装成已登记"：
#   ① 每条**理由非空**且不是路径本身（忘了写分隔符 `|` 的形状）；
#   ② 每条**同时也在 PATHS**（只在册不在清单 ⇒ §1 根本不会遍历到它，
#      它既不会被带走、也不会出现在"待入库"里 ⇒ 这条登记是装饰）；
#   ③ 每条**现在确实脏**：已经不脏的那枚打「待摘」——
#      在册条目一旦失效还留着，下一位就会照着它写"这枚还挂着"，而对象已经不存在了。
if [ "$U_COUNT" = 0 ]; then
  echo "   （册子空着 ⇒ 这一格无事）"
else
  U_BAD=0; U_STALE=0
  for u in "${UNCARRIED[@]}"; do
    up=${u%%|*}; ur=${u#*|}
    if [ "$ur" = "$u" ] || [ -z "$ur" ]; then
      printf '   ❌ 在册条目没写理由（格式应是 `路径|为什么不带走 + 处置路`）：%s\n' "$up"
      U_BAD=$((U_BAD + 1)); continue
    fi
    named=0
    for pp in "${PATHS[@]}"; do
      [ "$pp" = "$up" ] && named=1
    done
    if [ "$named" = 0 ]; then
      printf '   ❌ 在册却不在 PATHS：%s ⇒ §1 遍历不到它，这条登记是装饰（两处要一起写）\n' "$up"
      U_BAD=$((U_BAD + 1))
    fi
    u_st=$(git status --porcelain -- "$up" 2>/dev/null)
    if [ -z "$u_st" ]; then
      printf '   🟡 在册但工作树已与 HEAD 一致 ⇒ **待摘**（这条登记的对象已经不存在）：%s\n' "$up"
      U_STALE=$((U_STALE + 1))
    else
      printf '   🚫 在册 [%s]：%s\n' "${u_st:0:2}" "$up"
      printf '      理由：%s\n' "$ur"
    fi
  done
  echo "   ⇒ 在册 $U_COUNT 枚；断言不过 $U_BAD 枚；登记对象已消失（待摘）$U_STALE 枚"
  if [ "$U_BAD" != 0 ]; then
    echo "   ⇒ 先修这本册子（exit 1）。一条没理由 / 没配 PATHS 的在册条目比没有登记更危险：它把「带走」读成「已登记」。"
    exit 1
  fi
fi

if [ "$TOTAL" -eq 0 ]; then
  echo "   ⇒ 本线点名对象全部已在 HEAD 且工作树一致，且 1b 没有漏件、1c 的在册断言全过 —— A 此刻**无待办**。"
  exit 0
fi

echo "== 2. 别人的暂存：现量记录，提交后逐字节对账（判据不是「索引必须空」）=="
# 🔴 这一格**原来的前置是错的**，而且错的形态很典型：它把一次**裸 `git commit`** 的事故
#    （实测吞掉别人 109 枚暂存）当成了"非空索引就不能提交"的一般规律，可是下面第 5 格走的是
#    `git commit --only -- <点名路径>` —— 语义是"提交树 = HEAD + 点名路径的工作树内容"，
#    索引里别人那份条目既进不了这笔、也不会被抹掉。
#    15:0x 在一次性小副本里实测（别人暂存 b.txt，我只点名 a.txt + 新建 new.txt）：
#      · `git show --stat HEAD` 只有 a.txt / new.txt 两枚；
#      · 别人那枚的索引 blob 提交前后**逐字相同**（4722149c…），且仍留在索引里是 `M ` 已暂存态。
#    ⇒ 拿"索引必须空"当前置，拦的是一条**本工具已经不走的路径**，而代价是真实的：
#      本机索引长期挂着别人的暂存项，A 那条就被一条不成立的前提**永久挡死**（今天就是 1 枚）。
#    换成后置对账：挡的是真事故（别人的暂存被带走 / 被抹掉），不是"索引脏"这个表象。
# 🔴 15:4x 补一次**同形状的复量**（`research/tools/calendar-line-commit-only-arms.sh` 臂 1，
#    外来暂存枚数 = 1）：`git show --name-only` 里只有点名路径、别人那条 blob 前后逐字相同且仍在索引。
#    上面那句"旧前置不成立"**已被实测否证两次，别改回去**。
#    而 §2 里"本线点名路径已被暂存成另一份内容"那条**不是设想出来的**：同一把 rig 的臂 3 把它
#    造出来了（暂存 ≠ 工作树 ⇒ rc=1 拒绝、没有产生提交、那份暂存原样留着）。
FOREIGN=""   # 换行分隔的 `<path>\t<blob>`，第 5b 格按这份账逐条核
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if printf '%s\n' "${NAMES[@]}" | grep -qxF "$f"; then
    # 本线点名路径被别人暂存成了**另一份内容**：--only 按工作树提交，那份暂存意图会被静默替换掉。
    # 这才是"非空索引"里真正有危险的那一种，所以它单独判红。
    WT=$(git hash-object -- "$f" 2>/dev/null || echo NOFILE)
    IX=$(git ls-files --stage -- "$f" | awk '{print $2}')
    if [ "$WT" != "$IX" ]; then
      echo "   ❌ 本线点名路径已被暂存成另一份内容：${f}（索引 ${IX:-无} ≠ 工作树 ${WT}）"
      echo "      ⇒ --only 会用工作树覆盖那份暂存意图。先与所有者对齐再入库（exit 1）。"
      exit 1
    fi
  else
    FOREIGN="${FOREIGN}${f}	$(git ls-files --stage -- "$f" | awk '{print $2}')
"
  fi
done < <(git diff --cached --name-only)
N_FOREIGN=$(printf '%s\n' "$FOREIGN" | grep -c . || true)
echo "   不属于本线的已暂存路径：$N_FOREIGN 枚（记账待后验，不据此拒绝）"
if [ "$N_FOREIGN" != 0 ]; then
  printf '%s' "$FOREIGN" | sed 's/	/  ← 索引 blob /; s/^/      · /'
fi

echo "== 3. 静态门禁（入库前红着就别把红一起提交）=="
# 🔴 每趟唯一路径：固定 /tmp 名会被另一个会话（或上一趟）的读数顶掉，
#    那时"rc=0"可能只是别人留下的那份日志。
TAG="ht-commit-plan.$(date +%Y%m%d-%H%M%S).$$"
MD_OUT="/tmp/$TAG-md.out"; SH_OUT="/tmp/$TAG-sh.out"; DL_OUT="/tmp/$TAG-dl.out"
node scripts/check-md-table-rows.mjs >"$MD_OUT" 2>&1; R1=$?
node scripts/check-shell-unicode-vars.mjs >"$SH_OUT" 2>&1; R2=$?
NO_COLOR=1 node research/tools/docs-link-check.mjs >"$DL_OUT" 2>&1; R3=$?
echo "   md-tables rc=$R1 / shell-unicode rc=$R2 / docs-link rc=$R3"
if [ "$R3" != 0 ]; then
  echo "   ⚠️ docs-link 红 $(( $(grep -c -- '->' "$DL_OUT") )) 处 —— 按**来源文件**归属（这条 awk 形状是实测跑通的）："
  echo "      awk '/^   [^ ]+\\.md:[0-9]+\$/{print \$1}' $DL_OUT | cut -d: -f1 | sort | uniq -c"
  echo "   （命中文件名只剩 \`tmp/*\` ⇒ 别人那套变异装置的一次性夹具，不归本线；出现 \`calendar-*\` 才轮到本线。"
  echo "     不因此停下：这道门禁量的是工作树；但**别替它放宽判据**）"
fi
# 🔴 10:1x：R2 那条红**先分类再停下**。上一趟它让本工具 exit 3，而三条命中全在 `tmp/*.sh` ——
#    那些是**被 .gitignore 掉的临时件**（现量：`git ls-files --error-unmatch` 全部 NO，
#    `git status --porcelain -- tmp/closing-seq.sh` 输出为空 = 被忽略），
#    本线这笔提交既带不走它们、也不该替别人修它们。
#    "门禁红"与"红会进我这笔提交"是两件事，不分开写就会把别人的临时夹具读成"本线入库被挡住了"。
#    🔺 判据**没有放宽**（仍然 exit 3，绝不放行一次带红的提交），这里只补"红在哪一方"的读数。
OFF=""   # 🔴 必须先初始化：下面第 3 格末尾要按 NAMES 归类时，R2 可能是 0（这一格不进 if），
         #    而脚本是 `set -u` —— 未初始化会在这里直接崩，崩在"红没红"之前。
if [ "$R2" != 0 ]; then
  OFF=$(grep -oE '❌ [^[:space:]]+\.sh' "$SH_OUT" | awk '{print $2}' | sort -u)
  N_OFF=$(printf '%s\n' "$OFF" | grep -c . || true)
  N_TRACKED=0; N_IGNORED=0
  while IFS= read -r one; do
    [ -z "$one" ] && continue
    if git ls-files --error-unmatch "$one" >/dev/null 2>&1; then
      N_TRACKED=$((N_TRACKED + 1)); printf '      · 已跟踪（会进提交）：%s\n' "$one"
    elif git check-ignore -q "$one" 2>/dev/null; then
      N_IGNORED=$((N_IGNORED + 1)); printf '      · 被 gitignore 的临时件（提交不带走）：%s\n' "$one"
    else
      printf '      · 未跟踪且未被忽略：%s\n' "$one"
    fi
  done <<< "$OFF"
  echo "   SHELL_UNICODE_OFFENDERS=${N_OFF} 已跟踪=${N_TRACKED} ignored=${N_IGNORED}（这一格只报归属；会不会拦这一笔，由下面那格「带得走的红」决定）"
fi

if [ "$R1" != 0 ] || [ "$R2" != 0 ]; then
  # 🔴 17:2x 把这一条的**范围**改对（判据没放宽，改的是它量的那个集合）。
  #    原样是"仓库里这两道有任何红 ⇒ exit 3"，可这一腿提交走的是
  #    `git commit --only -- <NAMES>`，**它的提交集合恰好等于 NAMES** ——
  #    也就是说别人工作树里的红**结构上进不了这一笔**，却被这条前置当成了本线的红。
  #    今天现场两趟都是这个形状：第一趟 `scripts/verify-mobile-ios-reminder.sh:867`
  #    （`$IOS_MODE` 后面紧跟那个全角冒号，别人正在编辑的那枚文件；现量
  #    `grep -c verify-mobile-ios-reminder` 在本清单 = 0，带不走）。
  #    ⚠️ 这行注释自己**一开始把全角冒号写在反引号里面**（变量名紧贴冒号），被这把门禁判成 red、
  #    并被上面那格归类成"会进这一笔"而 exit 3 —— 门禁**不跳注释**（注释里变量名紧跟非 ASCII
  #    也算同一种形状）。写说明的时候别把那个形状复制出来。scoped 版上线头两趟抓到的都是这一枚自己。
  #    带不走）；上一趟同一条门禁的红落在 `tmp/*.sh`（被 gitignore，同样带不走）。
  #    真正的不变量只有一句：**这一笔带得走的文件里不许有红**。所以按 NAMES 归类，
  #    带得走的红 ⇒ exit 3（与原来同样响亮），带不走的红 ⇒ 打印归属 + 继续（口径与 docs-link 那格一致）。
  CARRY=""
  MDO=$(grep -oE '^  [^ :]+\.md:[0-9]+' "$MD_OUT" 2>/dev/null | sed 's/^  //; s/:.*//' | sort -u)
  while IFS= read -r one; do
    [ -z "$one" ] && continue
    for p in "${NAMES[@]}"; do
      [ "$p" = "$one" ] && CARRY="$CARRY$one
"
    done
  done <<< "$(printf '%s\n' "$MDO"; printf '%s\n' "$OFF")"
  N_CARRY=$(printf '%s\n' "$CARRY" | grep -c . || true)
  N_REPO=$(printf '%s\n%s\n' "$MDO" "$OFF" | grep -c . || true)
  echo "   仓库内这两道的红：$N_REPO 枚文件；其中**本笔带得走的**：$N_CARRY 枚"
  if [ "$N_CARRY" != "0" ]; then
    printf '%s\n' "$CARRY" | grep . | sort -u | sed 's/^/      ❌ 会进这一笔：/'
    echo "   ⇒ 先修自己那几枚（exit 3）。红读在 $MD_OUT 与 $SH_OUT"
    exit 3
  fi
  printf '%s\n' "$MDO" "$OFF" | grep . | sort -u | sed 's/^/      · 带不走（不是这一笔的树）：/'
  echo "   ✅ 本笔要提交的文件里没有这类红 ⇒ 继续（别人的红留在别人的树上，本工具不代改、也不替它放宽判据）"
fi

echo "== 4. 点名动作（复制即可，本工具不代执行）=="
printf '   git add -- %s\n' "$(printf '"%s" ' "${NAMES[@]}")"
echo "   git commit --only -- ${NAMES[*]}"
echo "   ⚠️ 为什么两步：新文件要先 add 才进得了 --only 的范围；而 --only 只提交**点名**路径，"
echo "      所以收尾必须再跑一次本工具看枚数归零（漏点名的文件会静默留在工作树里）。"

if [ "$CONFIRM" != 1 ]; then
  echo "== dry-run 结束（没碰索引、没提交）。要执行：MSG='…' bash $0 --confirm =="
  exit 0
fi

echo "== 5. --confirm：执行 =="
git add -- "${NAMES[@]}" || { echo "❌ git add 失败" >&2; exit 1; }
git commit --only -m "$MSG" -- "${NAMES[@]}" || { echo "❌ git commit 失败" >&2; exit 1; }
LEFT=$(git status --porcelain -- "${NAMES[@]}" | wc -l | tr -d ' ')
echo "   提交后这些路径的剩余状态行数：$LEFT"
git log -1 --format='   新 SHA=%h  标题=%s'
if [ "$LEFT" != 0 ]; then
  echo "   ❌ 还有 $LEFT 行没归零 —— 逐行看是不是又写入了新改动（本线文档是活文件）。"
  git status --porcelain -- "${NAMES[@]}" | sed 's/^/      /'
  exit 1
fi

# 🔴 5b：第 2 格记的那份"别人的暂存"账在这里逐条对上。
#    这一格是那条前置被换掉之后**唯一的牙** —— 没有它，§2 就退化成"只打印不判定"，
#    而那正是裸 commit 吞掉 109 枚暂存时缺的东西。
if [ "$N_FOREIGN" != 0 ]; then
  BAD=0
  IN_HEAD=$(git show --name-only --format= HEAD)
  while IFS=$'\t' read -r f h; do
    [ -z "$f" ] && continue
    if printf '%s\n' "$IN_HEAD" | grep -qxF "$f"; then
      printf '   ❌ 别人的暂存被本笔带走了：%s\n' "$f"; BAD=1
    fi
    NOW=$(git ls-files --stage -- "$f" | awk '{print $2}')
    if [ "$NOW" != "$h" ]; then
      printf '   ❌ 别人的索引条目被改了：%s（%s → %s）\n' "$f" "$h" "${NOW:-已从索引消失}"; BAD=1
    fi
  done <<< "$FOREIGN"
  if [ "$BAD" != 0 ]; then
    echo "   ⇒ 上面每条都带着原 blob 哈希，恢复口径：git update-index --cacheinfo 100644,<原哈希>,<路径>"
    echo "     🔴 先不要 push。**没有回滚别人暂存项的自动化**（那是跨会话的状态，只能人核对后做）。"
    exit 1
  fi
  echo "   ✅ 后置对账：$N_FOREIGN 枚别人的暂存一条不少、索引 blob 逐字不变、且不在本笔的树里"
fi

echo "   ✅ 点名对象全部进入 HEAD。**没有 push**（推不推是另一个决定，本工具不代做）。"
