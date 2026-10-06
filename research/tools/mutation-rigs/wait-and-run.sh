#!/bin/sh
# 等本机测试内存闸门空出来，再跑一条命令；跑不成（读到闸门形状）就重等。
# 用法：wait-and-run.sh <日志> <等待上限秒> <命令...>
LOG="$1"; shift
MAXWAIT="$1"; shift
SLEPT=0
: > "$LOG"
while :; do
  if [ -e /tmp/tfa-test.lock ]; then
    if [ "$SLEPT" -ge "$MAXWAIT" ]; then echo "WAIT=timeout slept=${SLEPT}s（环境无效，不是产品失败）" >> "$LOG"; exit 3; fi
    sleep 20; SLEPT=$((SLEPT + 20)); continue
  fi
  "$@" >> "$LOG" 2>&1
  RC=$?
  if grep -q '拒绝启动\|tfa-test.lock\|失败=-1' "$LOG"; then
    echo "[被闸门顶掉，重等（当前累计 ${SLEPT}s）]" >> "$LOG"
    sleep 20; SLEPT=$((SLEPT + 20)); : > "$LOG"; continue
  fi
  echo "WAITED=${SLEPT}s RC=$RC CMD=$*" >> "$LOG"
  exit $RC
done
