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
  research/tools/h-flaky-window-watcher.sh
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
  research/tools/calendar-line-commit-plan.sh
  # 这枚**不是**本线创建的文件，但脏的那一行是本线的（文档中心里 calendar-profile 那一行，
  # 现量 `git diff --numstat` = 1/1 即整份只有这一行改动）。共享文档只点自己那一行的归属。
  # 🔴 反例（刻意**不**加）：`scripts/verify-mobile-notes.sh` 那一枚顺带修属 notes 那条线，
  #    代别人提交一行是归属越界 —— 移交口径见交接 §5 第 5 条。
  docs/plans/README.md
)

CONFIRM=0
# 🔴 测试缝：`--confirm` 那一腿会真提交，绝不能拿本仓库当夹具。
#    有 PATHS_OVERRIDE（竖线分隔）时，清单从环境取，其余逻辑一字不改 ——
#    这样"迷你树里跑通 --confirm"证的就是主检出里那一腿的代码。
if [ -n "${PATHS_OVERRIDE:-}" ]; then
  IFS='|' read -r -a PATHS <<<"$PATHS_OVERRIDE"
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
echo "== 1. 现量重取清单（别引用文件里的旧枚数）=="
ST=0; UN=0; NAMES=()
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
NS_RE='^research/tools/(r14c-|r17-|h-flaky-|calendar-line-|b-)|^docs/plans/(calendar-year-time-and-mobile-profile|calendar-profile-handoff)\.md$|^scripts/(verify-mobile-window-gate|verify-mobile-due-time)\.sh$|^scripts/lib/(mobile-e2e-runner-probe|wedged-runner)\.sh$|^apps/web/evidence/(calendar-day|calendar-view-options|profile-panel)/[^/]+\.(md|png)$'
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

if [ "$TOTAL" -eq 0 ]; then
  echo "   ⇒ 本线点名对象全部已在 HEAD 且工作树一致，且 1b 没有漏件 —— A 此刻**无待办**。"
  exit 0
fi

echo "== 2. 索引必须是空的（共享工作树里非空索引 = 一笔吞掉别人的暂存）=="
IDX=$(git diff --cached --name-only | wc -l | tr -d ' ')
if [ "$IDX" != 0 ]; then
  echo "   ❌ 索引里有 $IDX 枚已暂存路径，其中不属于本线的："
  git diff --cached --name-only | grep -vxF -f <(printf '%s\n' "${NAMES[@]}") | sed 's/^/      /'
  echo "   ⇒ 先让那些路径的所有者处理自己的暂存；本工具不在别人的索引上动刀（exit 1）。"
  exit 1
fi
echo "   ✅ 索引为空（$IDX 枚）"

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
  echo "   SHELL_UNICODE_OFFENDERS=${N_OFF} 已跟踪=${N_TRACKED} ignored=${N_IGNORED}（红仍按 exit 3 走，这里只是别把别人的临时夹具读成本线的门）"
fi

if [ "$R1" != 0 ] || [ "$R2" != 0 ]; then
  echo "   ❌ 本线自己的结构门禁红 ⇒ 先修（exit 3）。红读在 $MD_OUT 与 $SH_OUT"
  exit 3
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
echo "   ✅ 点名对象全部进入 HEAD。**没有 push**（推不推是另一个决定，本工具不代做）。"
