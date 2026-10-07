#!/usr/bin/env bash
# ⑦ 欠的那一格：**整条** `pnpm check` 在当前载体上的一次 rc。
#
# 为什么要"整条"而不是逐段：79/80、81–94、95 都已经逐段有 rc（§10.264/§10.265/§10.266），
# 但"整条链的一次 rc"和"每段各有 rc"是两件事 —— 目标要的是前者**也**有读一次。
#
# 🔴 与前面那几趟的区别：这一趟**全程持锁**。
#   B92 记了我两次在别人窗口里跑门禁（读数被污染、也给别人加底噪）。整条链要 1 小时上下，
#   不持锁就必然再撞一次。闸门沿用 chain-tail-gates.sh 那道：等不到就 rc=3，**不绕**。
set -u
R="$(cd "$(dirname "$0")" && pwd)"
while [ ! -f "$R/pnpm-workspace.yaml" ] && [ "$R" != "/" ]; do R="$(dirname "$R")"; done
[ -f "$R/pnpm-workspace.yaml" ] || { echo "FULL=ENV-INVALID reason=没上溯到仓库根"; exit 3; }
cd "$R" || exit 1

RUN_TAG=${RUN_TAG:-$(date '+%m%d-%H%M')}
LOG="$R/tmp/tfa-readings/chain-full-${RUN_TAG}.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null
: > "$LOG" || { echo "FULL=ENV-INVALID reason=日志写不动（${LOG}）"; exit 3; }

LOCK=/tmp/tfa-test.lock
LOAD_LIMIT=${LOAD_LIMIT:-12}
WAIT_MAX=${WAIT_MAX:-3600}
load1() { sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1}'; }
held() { [ -f "$LOCK" ] && tr -d '[:space:]' < "$LOCK"; }
release() {
  if [ "$(held || true)" = "$$" ]; then rm -f "$LOCK"; echo "lock=已释放(我拿的那把)"; else echo "lock=不是我的，未动"; fi
}

t=0
while :; do
  H="$(held || true)"; L=$(load1)
  [ -n "$L" ] || { echo "FULL=ENV-INVALID reason=load1 读不出来（空值不等于低负载，不放行）"; exit 3; }
  if [ -z "$H" ] && ! awk -v a="$L" -v b="$LOAD_LIMIT" 'BEGIN{exit !(a>b)}'; then break; fi
  if [ "$t" -ge "$WAIT_MAX" ]; then
    echo "FULL=NOT_RUN waited=${t}s lock=${H:-free} load1=${L}（阈值 ${LOAD_LIMIT}）—— **没跑成**，不是判据红"
    exit 3
  fi
  sleep 20; t=$((t + 20))
done
echo "$$" > "$LOCK"
trap 'release' EXIT
echo "START=$(date '+%m-%d %H:%M:%S') load1=$(load1) lock=我持有($$) HEAD=$(git rev-parse --short HEAD)" | tee -a "$LOG"

NO_COLOR=1 pnpm check >> "$LOG" 2>&1
RC=$?
# 🔴 断言这一发真跑了（"命令报了个 rc" ≠ "命令跑了"）
grep -aqE 'check|test' "$LOG" || { echo "FULL=ENV-INVALID reason=日志里没有链的输出，RC=${RC} 不许当判据"; exit 3; }
{
  echo "FULL_RC=$RC"
  echo "--- 链里第一段红的落点（pnpm check 是 && 串，停在第一段红）---"
  grep -aE '^\s*(✗|FAIL|Error:|ELIFECYCLE|Command failed)' "$LOG" | head -8
  echo "--- 末 12 行 ---"
  tail -12 "$LOG"
} | tee -a "$LOG"
echo "DONE=$(date '+%m-%d %H:%M:%S') 明细见 $LOG"
