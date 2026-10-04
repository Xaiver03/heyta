#!/usr/bin/env bash
# 提交前「这一笔里的每一枚 hunk 是谁写的」对账器（§5 第 5 条 A 那格的归属腿）。
#
# 🔴 为什么存在（现量事故：`9de0e545`）：本线入库工具的三道闸门
#    （1b 防漏登记 / OUTSIDE_NS / UNCARRIED）**判据的单位都是「路径」**，
#    而 `git commit --only -- <路径>` 的语义是「提交树 = HEAD + 点名路径的工作树内容」
#    ⇒ 一枚**在清单里**的共享文件（`scripts/verify-mobile-due-time.sh`）带着**别人那一行**
#    被我这笔带走时，三道闸门全绿。**路径级检查在结构上答不了「谁的 hunk」，再多道也是零。**
#
#    这里补的就是那一个问题：每轮提交前把「这一轮我确实写过的标识符 / 独有串」当锚点传进来，
#    逐枚 hunk 问一句「它的新增行里有没有出现任一锚点」。
#    **答不出来的 hunk 不是我的，就必须当场被看见**，而不是变成提交信息里的错误归属。
#
# 锚点匹配不了「我的每一行」（我可能只改了一行注释），所以误红是**设计内的摩擦**：
# 要么补锚点，要么显式 ALLOW_ORPHAN=1 承认「这几枚不是我写的，我仍要把它们提进去」——
# 后者会在输出里大字列出，并要求把它们写进提交信息的理由，绝不静默。
#
# 退出码：0 = 全部 hunk 有归属（或根本没有 hunk）
#         1 = 用法不成立（缺 ANCHORS / 缺路径 / 路径不存在）或有孤儿 hunk 且未放行
#
# 用法：
#   ANCHORS='ask_gate stack_down' bash research/tools/calendar-line-hunk-ownership.sh <路径> [路径…]
set -u
# 🔴 **故意不 `cd` 到仓库根**：本工具判的是"调用者所在那一棵树"，路径按调用方的 cwd 解析。
#    写死 `cd "$(dirname "$0")/../.."` 会带来两个后果：从别的目录调用时静默换了树，
#    而验证台（把它拷进一次性仓库跑）会直接找不到被检文件 —— 后者是"探针瞎"，不是"归属红"。
#    真需要仓库根的是 `calendar-line-commit-plan.sh`，它在调用前已经 cd 过去了。
[ -d .git ] || [ -f .git ] || [ -e .git ] || echo "   ⚠️ cwd 不像 git 树：$(pwd)（判不出 diff 就是判不出，不静默放行）"

ANCHORS="${ANCHORS:-}"
ALLOW_ORPHAN="${ALLOW_ORPHAN:-0}"

if [ -z "$ANCHORS" ]; then
  echo "❌ 缺 ANCHORS —— 没有锚点就没有归属判据，这条工具就退化成一堆永远绿的装饰。"
  echo "   传法：ANCHORS='这一轮新增或改动的标识符、函数名、独有串' bash $0 <路径…>"
  echo "   为什么强制：见 docs/plans/calendar-profile-handoff.md §4.05 (25)"
  exit 1
fi
if [ "$#" -lt 1 ]; then
  echo "❌ 没给路径（本工具不猜范围；猜就等于把没点名的文件留在外面）"
  exit 1
fi

# 锚点表：空格分隔，逐枚落进 ANCHOR_1..N（bash 3.2 没有关联数组，只能这样存）
ANCHOR_N=0
for a in $ANCHORS; do
  [ -z "$a" ] && continue
  ANCHOR_N=$(( ANCHOR_N + 1 ))
  eval "ANCHOR_${ANCHOR_N}=\$a"
done
if [ "$ANCHOR_N" = 0 ]; then
  echo "❌ ANCHORS 传了却切出 0 枚锚点（全是空白？）—— 判不了归属"
  exit 1
fi
echo "锚点 $ANCHOR_N 枚：$ANCHORS"

matched_hunk() {
  # $1 = 该 hunk 触及的全部行（新增 + 删除，已去掉前导 +/-）。命中任一锚点即算「有归属」。
  # 🔴 为什么把**删除行**也算进匹配集：只认新增行的话，「我删掉 foo()」这一枚 hunk 里
  #    一个字都没有，会被判成孤儿 —— 而纯删除是日常改动（本文件 §4.05 (25) 那笔就带着 3 行删除）。
  #    语义因此是「这枚 hunk 碰过的东西里，有没有一件是我这轮申报的」，不是「这枚 hunk 加了什么」。
  # grep -F：锚点是字面量不是正则。
  _i=1
  while [ "$_i" -le "$ANCHOR_N" ]; do
    eval "_a=\$ANCHOR_${_i}"
    if printf '%s\n' "$1" | grep -qF -- "${_a}"; then
      return 0
    fi
    _i=$(( _i + 1 ))
  done
  return 1
}

TOTAL_HUNKS=0
ORPHAN_HUNKS=0

# 当前 hunk 的累积状态（flush 要在遇到下一个 @@ 与文件结束时各调一次）
CUR_HDR=""
CUR_ADD=""
PH=0
PO=0
CUR_PATH=""

flush() {
  [ -n "$CUR_HDR" ] || return 0
  PH=$(( PH + 1 ))
  if ! matched_hunk "$CUR_ADD"; then
    PO=$(( PO + 1 ))
    echo "   ❌ 孤儿 hunk @ ${CUR_PATH} :: ${CUR_HDR}"
    printf '%s\n' "$CUR_ADD" | grep . | head -3 | sed 's/^/        + /'
  fi
  CUR_HDR=""
  CUR_ADD=""
}

for p in "$@"; do
  [ -e "$p" ] || { echo "❌ 路径不存在：${p}（判不了就是判不了，不许跳过）"; exit 1; }
  CUR_PATH="$p"
  PH=0
  PO=0
  if git ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then
    DIFF=$(git diff HEAD -U0 -- "$p")
  else
    # 未跟踪的新文件：整份都是新增行，`git diff HEAD` 看不见它
    DIFF=$(git diff --no-index -U0 -- /dev/null "$p" 2>/dev/null)
  fi
  if [ -z "$(printf '%s\n' "$DIFF" | grep .)" ]; then
    echo "   ${p}：无新增行（这一枚不带 hunk）"
    continue
  fi
  # herestring 而非 <<EOF：EOF 会展开载荷里的 $ 与反引号，把 diff 内容当命令跑
  while IFS= read -r line; do
    case "$line" in
      '@@'*) flush; CUR_HDR="$line" ;;
      '+++'*|'---'*) ;;
      '+'*|'-'*) CUR_ADD="${CUR_ADD}${line#+}
" ;;
    esac
  done <<< "$DIFF"
  flush
  TOTAL_HUNKS=$(( TOTAL_HUNKS + PH ))
  ORPHAN_HUNKS=$(( ORPHAN_HUNKS + PO ))
  echo "   ${p}：hunk $PH 枚，有归属 $(( PH - PO )) 枚，孤儿 $PO 枚"
done

echo "合计：hunk $TOTAL_HUNKS 枚 / 孤儿 $ORPHAN_HUNKS 枚"
if [ "$ORPHAN_HUNKS" != 0 ]; then
  if [ "$ALLOW_ORPHAN" = 1 ]; then
    echo "🔴 ALLOW_ORPHAN=1：这 $ORPHAN_HUNKS 枚**不是这一轮写的**，仍被放行进这一笔。"
    echo "   ⇒ 提交信息里必须写清「哪几枚属于谁那条线」，否则这笔的归属就是错的（事故原文 §4.05 (25)）。"
    exit 0
  fi
  echo "⇒ 停下来对齐：补锚点，或与所有者分开提交。"
  exit 1
fi
echo "✅ 每一枚 hunk 都能指认到本轮锚点"
