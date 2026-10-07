#!/usr/bin/env bash
# 95 段（`pnpm -r test`）在 apps/web 报的 3 枚红全是 `Test timed out in 5000ms`。
# 要分开的两件事：**负载把边界用例顶过阈值**，还是**用例本身走不完**。
# 这两者在整链输出上长得一样（都只有一句 timed out），只有"安静窗口里单跑这两份"能分开。
#
# 🔴 三道自闸沿用 chain-tail-gates.sh 的写法（那两道被我在 B92 里违反过两次，这里有痕迹）：
#   1. `/tmp/tfa-test.lock` 被别人持有 ⇒ 有界等待，不绕；等不到就 rc=3 记"没跑成"。
#   2. load1 > 阈值 ⇒ 同上。阈值从链自己的 12 抄来，不是新拍的。
#   3. 仓库根靠 `pnpm-workspace.yaml` 上溯，不写死层数（B92 里固定深度把日志和锁搬走过）。
#
# 锁只在"确认是我拿的"之后删（比对 pid），不碰别人的持有。
# 腿 B 只在腿 A 红的时候才跑：给 30s 超时再跑一次 —— 若转绿就是"慢"，不是"走不完"。
set -u
R="$(cd "$(dirname "$0")" && pwd)"
while [ ! -f "$R/pnpm-workspace.yaml" ] && [ "$R" != "/" ]; do R="$(dirname "$R")"; done
[ -f "$R/pnpm-workspace.yaml" ] || { echo "SOLO=ENV-INVALID reason=没上溯到仓库根（缺 pnpm-workspace.yaml）"; exit 3; }
cd "$R" || exit 1

# 🔴 LOG 必须是绝对路径：这里有一处 `cd apps/web`，相对路径会让重定向失败，
#    而失败的重定向会让那一发命令**根本不执行**，`$?` 记的是重定向的错（本装置第一趟就踩了：
#    LEG_A=1 其实是 `tmp/...: No such file or directory`，vitest 一个字都没跑）。
LOG="$R/tmp/tfa-readings/web-two-specs-solo.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null
: > "$LOG" || { echo "SOLO=ENV-INVALID reason=日志写不动（${LOG}）—— 别当读数"; exit 3; }

LOCK=/tmp/tfa-test.lock
LOAD_LIMIT=${LOAD_LIMIT:-12}
WAIT_MAX=${WAIT_MAX:-1800}
SPECS="tests/calendar-sidebar.spec.tsx tests/nav-next7-days.spec.tsx"

load1() { sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1}'; }
held() { [ -f "$LOCK" ] && tr -d '[:space:]' < "$LOCK"; }

t=0
while :; do
  H="$(held || true)"
  L=$(load1)
  # 🔴 读不到负载 ≠ 负载低。上面那条臂（PATH 里没有 sysctl）实测：L 是空串，
  #    而 `awk -v a="" 'BEGIN{exit !(a>b)}'` 把空串当 0 ⇒ 闸门**自己放行**（假绿）。
  #    这与 traps 里"等负载的 vm.loadavg 解析自己坏了 15 轮"是同一族。
  [ -n "$L" ] || { echo "SOLO=ENV-INVALID reason=load1 读不出来（sysctl 不在 PATH？）—— 空值不等于低负载，不放行"; exit 3; }
  if [ -z "$H" ] && ! awk -v a="$L" -v b="$LOAD_LIMIT" 'BEGIN{exit !(a>b)}'; then break; fi
  if [ "$t" -ge "$WAIT_MAX" ]; then
    echo "SOLO=NOT_RUN waited=${t}s lock=${H:-free} load1=${L}（阈值 ${LOAD_LIMIT}）—— 这是**没跑成**，不是判据红"
    exit 3
  fi
  sleep 15; t=$((t + 15))
done
echo "$$" > "$LOCK"
echo "START=$(date '+%m-%d %H:%M:%S') load1=$(load1) lock=我持有($$) specs=$(echo $SPECS)" | tee -a "$LOG"

release() {
  if [ "$(held || true)" = "$$" ]; then rm -f "$LOCK"; echo "lock=已释放(我拿的那把)"; else echo "lock=不是我的，未动"; fi
}
# 任何从这里往后的退出路径都必须先放锁 —— 否则 ENV-INVALID 会把锁留成死锁，
# 而下一个等窗口的人会一直等到自己的 WAIT_MAX 才发现问题（本装置上一版就漏在这一条）。
trap 'release; exit' EXIT

cd apps/web || exit 1
NO_COLOR=1 pnpm exec vitest run $SPECS >> "$LOG" 2>&1
RC_A=$?
# 🔴 "命令报了个 rc"不等于"命令跑了"。这一行挡的就是第一趟那个形状：
#    重定向失败 ⇒ vitest 一字没跑，而 RC_A 仍是 1（看着像"用例红"）。
grep -aq 'Test Files' "$LOG" || { echo "SOLO=ENV-INVALID reason=日志里没有 vitest 汇总行 —— 这一发根本没执行，RC_A=${RC_A} 不许当判据"; exit 3; }
grep -aE '^\s*(✓|×|❯)' "$LOG" | tail -25
echo "LEG_A(default 5000ms) RC=$RC_A" | tee -a "$LOG"

RC_B=-
if [ "$RC_A" -ne 0 ]; then
  NO_COLOR=1 pnpm exec vitest run $SPECS --testTimeout=30000 >> "$LOG" 2>&1
  RC_B=$?
  echo "LEG_B(testTimeout=30000) RC=$RC_B" | tee -a "$LOG"
fi

if [ "$(held || true)" = "$$" ]; then rm -f "$LOCK"; echo "lock=已释放(我拿的那把)" | tee -a "$LOG"; else echo "lock=不是我的，未动" | tee -a "$LOG"; fi
echo "SOLO=DONE RC_A=$RC_A RC_B=$RC_B 明细见 $LOG"
