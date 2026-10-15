#!/bin/bash
# 有界等待窗：等本机安静下来，然后跑那一趟欠着的浏览器读数（两枚页眉判据 + 配对尺反臂 + themeRulerSampled 第二个值）。
#
# 起跑条件两条（现量，不猜）：
#   1) 没有任何自动化浏览器 / 别线的 playwright 类跑批进程
#   2) load1 < 12 —— 🔴 取法沿用 06:43 那格修好的那一版：`tr -d '{}'`，**不许删空格**
#      （删了空格会把三个数粘成 "9.1410.4915.44" ⇒ Number() 得 NaN ⇒ NaN<12 恒假 ⇒ 结构上永远等不到，
#       那是环境陷阱里"探针自己坏的"那一族。）
# 上限 60 × 30s = 30 分钟；到点没等到就照实记 NO_GO，不改判成读数。
set -u
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
LOG="$(dirname "$0")/waiter.txt"
EVID="$(cd "$(dirname "$0")" && pwd)"
LIMIT=60
i=0
echo "waiter start $(date '+%F %T') pid=$$" >"$LOG"
while [ "$i" -lt "$LIMIT" ]; do
  i=$((i + 1))
  busy=$(pgrep -fl 'chrome-headless-shell|playwright|screenshot-software-copyright|verify-web-ui-sweep|reminders-data-responsive' 2>/dev/null | grep -v "^$$ " | wc -l | tr -d ' ')
  load1=$(sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1}')
  if awk -v l="$load1" 'BEGIN{exit !(l<12)}' && [ "$busy" = "0" ]; then
    echo "GO try=$i load1=$load1 auto=0 $(date '+%T')" >>"$LOG"
    cd "$ROOT" || exit 2
    NO_COLOR=1 HEYTA_RESPONSIVE_LEGS=sync,reminders HEYTA_WEB_UI_SWEEP_EVIDENCE="$EVID" \
      node scripts/verify-web-ui-sweep.mjs >>"$LOG" 2>&1
    echo "RIG_RC=$? $(date '+%F %T')" >>"$LOG"
    echo "RESULT=ran" >>"$LOG"
    exit 0
  fi
  echo "NO_GO try=$i load1=$load1 busy=$busy $(date '+%T')" >>"$LOG"
  sleep 30
done
echo "RESULT=window-closed-without-run $(date '+%F %T')" >>"$LOG"
exit 1
