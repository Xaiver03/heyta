#!/usr/bin/env bash
# #76 臂的**结论分岔**离线自检：抽臂本体的第 7 段（结论），用桩喂现场，
# 验三件事：①「没跑」必须排在「没牙」前面判；②**探针读不到**必须排在「没牙」前面判；
# ③"没有牙"这句只有携带装载证据的完整臂趟才有资格说。
#
# 为什么单独验：这台装置被查出来两次读错同一件事——
#   12:06 那趟真实形状是 rc=3 + 腿计数全 0，旧臂读成 `ARM=DEAD`（一句关于产品的假结论）；
#   12:51 那趟判据**真跑了**（summary 报失败 3 项），而 B 的四条计数全 0，
#   旧臂又读成 `ARM=DEAD` —— 这次的原因不是顺序，是我的 needle 取了绿行的字面形状，
#   而红行印的是另一种形状（traps #291）。
#   两次都是"关于产品的假结论"，所以两个分支都得有腿。
#
# 七腿（每腿一个独立进程；载具从真身 awk 抽段；注入的是**六条计数**，
# 不注入 LEG_TOTAL —— 求和本身也要在这台装置眼下跑，否则加了新腿它也不知道）：
#  L1 rc=3、腿全 0                ⇒ NO-RUN / 3   （12:06 那一档）
#  L2 rc=0、腿全 0                ⇒ NO-RUN / 3   （rig 退 0 不等于判据跑过）
#  L3 rc=1、跑过而 B 全绿（完整臂趟） ⇒ DEAD / 1 且带"关于产品的结论"
#  L4 rc=1、跑过而 B 全绿（RECOUNT 趟）⇒ DEAD / 1 但**不许**主张装载过
#  L5 rc=1、B 四计数全 0 而 PREM/C 有读数、summary 报失败 ⇒ NEEDLE-MISMATCH / 3（12:51 那一档）
#  L6 rc=1、只数据腿红、C 绿        ⇒ OK / 0 且带"文件腿这一枚问不到"
#  L7 rc=1、只文件腿红、C 绿        ⇒ OK / 0      （阴性对照：OK 不绑死在某一条腿上）
#
# 🔴 装置纪律（traps #277）：抽段落成一次性脚本文件、桩写进载具头部而不是靠
#    `VAR=x f(){} cmd` 这种不成立的语法、载具必须打印读到的量。
set -uo pipefail
# 根目录由**脚本自己的位置**往上找到 `.git` 为止：
#   `dirname $0/..` 那种写法只在"文件躺在仓库根下一层"时成立（这台上就是 —— 它原来躺在 tmp/），
#   而 `git rev-parse --show-toplevel` 换了一个断法：从**别的目录**调起这台装置时就炸（实测 cwd=/tmp）。
# 两种错法都不响亮，所以取"跟着文件走"的那一条。
_d=$(cd "$(dirname "$0")" && pwd)
while [ "$_d" != "/" ] && [ ! -d "$_d/.git" ]; do _d=$(dirname "$_d"); done
[ -d "$_d/.git" ] || { echo "ROOT=NOT-FOUND（从 $0 往上没找到 .git ⇒ 这台装置不在仓库里，读数不作数）"; exit 1; }
cd "$_d" || exit 1

# 臂本体的默认位置：仓库里那份优先，没有就退回工作区那份并**打印用的是哪一枚**
#（这台装置测的是"结论分支"，读错对象等于自证，所以载体路径必须是读数的一部分）。
if [ -n "${ARM:-}" ]; then ARM_PATH="$ARM"
elif [ -f research/tools/mutation-rigs/ios-erase-arm-b76.sh ]; then ARM_PATH=research/tools/mutation-rigs/ios-erase-arm-b76.sh
elif [ -f tmp/ios-erase-arm-b76.sh ]; then ARM_PATH=tmp/ios-erase-arm-b76.sh
else echo "ARMS=NO-CARRIER（两处都没有臂本体：research/tools/mutation-rigs/ 与 gitignored 的 tmp/）"; exit 1; fi
BLOCK=$(awk '/^  say "7\. 结论/,/^}/' "$ARM_PATH")
[ -n "$BLOCK" ] || { echo "ARMS=EXTRACT-EMPTY（锚点没命中 ${ARM_PATH}）"; exit 1; }
echo "   抽到结论段 $(printf '%s\n' "$BLOCK" | grep -c '') 行（载具：${ARM_PATH}）"

BODY=$(mktemp /tmp/b76-verdict-body.sh.XXXXXX)
RUNLOG=$(mktemp /tmp/b76-verdict-runlog.txt.XXXXXX)
trap 'rm -f "$BODY" "$RUNLOG"' EXIT
{
  echo '#!/usr/bin/env bash'
  echo 'set -uo pipefail'
  echo 'say() { printf "\n--- %s ---\n" "$1"; }'
  printf '%s\n' "$BLOCK"
} > "$BODY"
: > "$RUNLOG"

FAILS=0
# $1=RIG_RC $2=FILE_RED $3=DATA_RED $4=FILE_OK $5=DATA_OK $6=PREM_OK $7=C_OK $8=FAILED $9=MODE_TAG
run_leg() {
  RIG_RC="$1" FILE_RED="$2" DATA_RED="$3" FILE_OK="$4" DATA_OK="$5" PREM_OK="$6" C_OK="$7" \
  FAILED="$8" TALLY="通过 31 项，失败 $8 项" MODE_TAG="$9" RUNLOG="$RUNLOG" bash "$BODY"
}
expect() { # $1=腿名 $2=期望码 $3=期望串 $4=实际码 $5=实际输出
  if [ "$4" = "$2" ] && printf '%s\n' "$5" | grep -q "$3"; then
    echo "   ✓ $1 ⇒ rc=$4 命中「$3」"
  else
    echo "   ✗ $1 ⇒ rc=$4（期望 $2）；输出里找不到「$3」"
    printf '%s\n' "$5" | sed 's/^/        /'
    FAILS=$((FAILS + 1))
  fi
}
FULL="完整臂趟（源与设备产物的 md5 都在上面打印过）"
RCNT="RECOUNT（只重读一份旧日志，不携带装载证据）"

OUT=$(run_leg 3 0 0 0 0 0 0 0 "$FULL"); expect "L1 rc=3+腿全 0 ⇒ NO-RUN" 3 "ARM=NO-RUN" "$?" "$OUT"
OUT=$(run_leg 0 0 0 0 0 0 0 0 "$FULL"); expect "L2 rc=0 但腿全 0 ⇒ 仍算没跑" 3 "ARM=NO-RUN" "$?" "$OUT"
OUT=$(run_leg 1 0 0 1 1 1 1 2 "$FULL"); expect "L3 跑过而 B 全绿（完整臂趟）⇒ DEAD 且主张产品结论" 1 "关于产品的结论" "$?" "$OUT"
OUT=$(run_leg 1 0 0 1 1 1 1 2 "$RCNT"); expect "L4 同形状但 RECOUNT 趟 ⇒ 不许主张装过" 1 "只是「这份日志里 B 没红」" "$?" "$OUT"
OUT=$(run_leg 1 0 0 0 0 1 1 3 "$FULL"); expect "L5 12:51 现场（B 计数全 0 而跑过）⇒ NEEDLE-MISMATCH" 3 "ARM=NEEDLE-MISMATCH" "$?" "$OUT"
OUT=$(run_leg 1 0 1 1 0 1 1 3 "$FULL"); expect "L6 只数据腿红 ⇒ OK 且写明文件腿问不到" 0 "问不到" "$?" "$OUT"
OUT=$(run_leg 1 1 0 0 1 1 1 3 "$FULL"); expect "L7 只文件腿红 ⇒ OK（OK 不绑死一条腿）" 0 "ARM=OK" "$?" "$OUT"

TOTAL=7
if [ "$FAILS" = "0" ]; then echo "ARMS=pass (${TOTAL}/${TOTAL})"; exit 0; fi
echo "ARMS=FAIL（$FAILS 腿不符，共 ${TOTAL} 腿）"; exit 1
