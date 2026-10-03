#!/bin/bash
#
# C（截止时刻设备验收）的**有界窗口重试**：轮询仓库自带的开工闸门，窗口一开就跑。
#
# 为什么不手写等待条件：`scripts/verify-mobile-window-gate.sh` 已经是这条线所有前置的
# 唯一权威实现（负载门用规范库 hw.ncpu*3/4、设备独占探针、凭据/服务端/APK 新鲜度、
# 自快照 MANIFEST），而它的 `--confirm` 只在**全部前置绿**时才执行、否则退 3。
# 所以"等窗口"= 反复调它直到退出码不再是 3，本脚本自己不重复实现任何一条判据 ——
# 重复实现的那一份一定会漂（AGENTS 同族教训）。
#
# 退出码：
#   0 = 闸门执行了验收且验收自己退 0
#   3 = 没等到窗口（环境不成立，**不是产品失败**）
#   其它 = 被测验收的退出码原样透出
#
# 旋钮：CARRIER / BUDGET / INTERVAL
set -u

CARRIER="${CARRIER:-/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-r14c}"
BUDGET="${BUDGET:-3600}"
INTERVAL="${INTERVAL:-60}"
LOG="${LOG:-/tmp/ht-r14c-window.log}"

[ -d "$CARRIER" ] || { echo "❌ 载体目录不存在：$CARRIER" >&2; exit 1; }
GATE="$CARRIER/scripts/verify-mobile-window-gate.sh"
[ -f "$GATE" ] || { echo "❌ 载体里没有闸门：$GATE" >&2; exit 1; }

mv "$LOG" "$LOG.prev" 2>/dev/null || true
: > "$LOG"
echo "start $(date '+%T') 载体=$CARRIER 预算=${BUDGET}s 间隔=${INTERVAL}s" >> "$LOG"

START=$(date +%s)
ATTEMPT=0
FINAL=3
while :; do
  ATTEMPT=$((ATTEMPT + 1))
  echo "----- 第 $ATTEMPT 次 $(date '+%T') -----" >> "$LOG"
  # 🔴 不用管道：管道后的 $? 是 tail 的（§7 第 45 条），退出码会被读成 0。
  NO_COLOR=1 bash "$GATE" --target c --repo "$CARRIER" --confirm >> "$LOG" 2>&1
  RC=$?
  echo "ATTEMPT rc=$RC" >> "$LOG"
  if [ "$RC" != 3 ]; then
    FINAL=$RC
    echo "WINDOW=open 验收已执行 rc=$RC" >> "$LOG"
    break
  fi
  NOW=$(date +%s)
  if [ $((NOW - START)) -ge "$BUDGET" ]; then
    echo "WINDOW=timeout 预算 ${BUDGET}s 用尽，共 $ATTEMPT 次" >> "$LOG"
    FINAL=3
    break
  fi
  sleep "$INTERVAL"
done

echo "ALL_DONE $(date '+%T') final_rc=$FINAL attempts=$ATTEMPT" >> "$LOG"
exit "$FINAL"
