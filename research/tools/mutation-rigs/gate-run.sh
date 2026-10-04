#!/bin/sh
# 绕开宿主级测试闸门：被挡就等，等到窗口为止；等满就响亮地失败。
# 用法：gate-run.sh <日志文件> <超时秒上限> <命令...>
LOG="$1"; shift
MAX_WAIT="$1"; shift
SLEPT=0
while :; do
  "$@" >"$LOG" 2>&1
  RC=$?
  if grep -q '拒绝启动\|tfa-test.lock' "$LOG"; then
    if [ "$SLEPT" -ge "$MAX_WAIT" ]; then
      echo "GATE=timeout waited=${SLEPT}s cmd=$*" >>"$LOG"
      exit 3
    fi
    sleep 20
    SLEPT=$((SLEPT + 20))
    continue
  fi
  echo "GATE=ok slept=${SLEPT}s rc=${RC}" >>"$LOG"
  exit $RC
done
