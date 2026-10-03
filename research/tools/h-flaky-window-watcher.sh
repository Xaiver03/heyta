#!/bin/bash
# 有界窗口 watcher：等负载门 + 4318/4319 空闲，然后把 calendar-view-options 连跑三趟
# 目的：解释 23:19 那趟留下的 `1 flaky`（① 首趟红在 spec.ts:114 的 VIEW_SELECT 可见性）。
# 退出码：0 = 三趟都跑完（flaky 计数见日志）；3 = 没等到窗口（环境无效，不是产品失败）；4 = 探针坏了。
# 🔴 这份装置住在仓内而不是 /tmp：一次重启会把 /tmp 里的臂与等待器全清走，
#    那时"跑过三趟"就只剩一句主张（日志仍是现场，允许在 /tmp）。
set -u
cd "$(dirname "$0")/../.." || exit 4   # 本脚本住在 research/tools/，仓库根就是它的 ../..
. scripts/lib/wait-for-quiet-host.sh

LOG=/tmp/ht-h-flaky.log
RUNS=3
STRICT_MAX=9
BUDGET="${BUDGET:-900}"   # 外层窗口预算
# 🔴 内层 `wait_for_quiet_host` 有自己的预算（HEYTA_LOAD_GATE_WAIT，默认 900s），
#    到点会 return 非零。第二趟实测证明了这一点：外层写 BUDGET=3600，
#    而内层 900s 一到就 `GATE=timeout rc=3` 结束 —— **外层那个旋钮当时是装饰**。
#    ⇒ 要真等到 3600s，内层的等待必须一起放大。
export HEYTA_LOAD_GATE_WAIT="${HEYTA_LOAD_GATE_WAIT:-$BUDGET}"
export HEYTA_LOAD_GATE_INTERVAL="${HEYTA_LOAD_GATE_INTERVAL:-30}"
PORTS="4318 4319"
CONTROLS="4358 5399"   # 阳性对照：这些端口上常有别人的进程，lsof 必须数得出东西才算探针活着

mv "$LOG" "$LOG.prev" 2>/dev/null   # 上一趟的读数留着（台账要引用它，不能被本轮截掉）
echo "start $(date '+%T') 连跑=$RUNS 严格负载门≤$STRICT_MAX 总预算=${BUDGET}s" >> "$LOG"

START=$(date +%s)
while :; do
  wait_for_quiet_host >> "$LOG" 2>&1 || { echo "GATE=timeout rc=3" >> "$LOG"; exit 3; }
  LOAD=$(uptime | sed 's/.*load averages: //' | awk '{print int($1)}')
  if [ "$LOAD" -gt "$STRICT_MAX" ]; then
    echo "  严格层：负载 $LOAD > ${STRICT_MAX}，再等" >> "$LOG"
  else
    # 阳性对照：先证明 lsof 数得出"有人在听"，再要求被测端口为空
    CONTROL_HIT=0
    for p in $CONTROLS; do
      if lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then CONTROL_HIT=1; fi
    done
    BUSY=0
    for p in $PORTS; do
      if lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then BUSY=$((BUSY + 1)); fi
    done
    if [ "$CONTROL_HIT" = "0" ] && [ "$BUSY" = "0" ]; then
      echo "  ❌ 对照端口也全部为空 —— lsof 探针不可信（$BUSY 会被误读成'窗口开着'），本轮作废" >> "$LOG"
      exit 4
    fi
    if [ "$BUSY" = "0" ]; then
      echo "  ✅ 负载 $LOAD ≤ ${STRICT_MAX}，4318/4319 无人监听（对照端口有数 = lsof 可信）" >> "$LOG"
      break
    fi
    echo "  4318/4319 里 $BUSY 个被占，继续等" >> "$LOG"
  fi
  if [ $(( $(date +%s) - START )) -ge "$BUDGET" ]; then
    echo "GATE=预算用尽 rc=3" >> "$LOG"
    exit 3
  fi
  sleep 30
done

cd e2e || exit 4
for i in $(seq 1 "$RUNS"); do
  echo "----- 第 $i 趟 $(date '+%T') -----" >> "$LOG"
  NO_COLOR=1 npx playwright test tests/calendar-view-options.spec.ts >> "$LOG" 2>&1
  RC=$?
  echo "RUN_$i_RC=$RC" >> "$LOG"
  SUMMARY=$(grep -E 'passed|failed|flaky' "$LOG" | tail -3 | tr '\n' ' ')
  echo "RUN_$i_SUMMARY=$SUMMARY" >> "$LOG"
done
echo "ALL_DONE $(date '+%T')" >> "$LOG"
