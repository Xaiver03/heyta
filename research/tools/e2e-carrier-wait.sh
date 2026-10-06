#!/bin/bash
# 用法: bash /tmp/wait-then-e2e.sh <spec 文件名> <输出日志>
# 有界等 4371 空出来（**不 kill 任何东西**），再跑；完整输出落盘（上一版在这里
# `| tail -40` 把前两条用例的报错截掉了 —— 包装命令吃掉证据，同 §7 第 179 条那一族）。
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/e2e" || exit 9
export PATH="$HOME/.tfa-shield/bin:$PATH"
LOG="$2"
: > "$LOG"
for i in $(seq 1 180); do
  LISTENERS=$(lsof -nP -iTCP:4371 -sTCP:LISTEN -t | tr '\n' ' ')
  OTHERS=$(ps -eo command | grep -c "[w]orktrees/.*e2e/node_modules/.*playwright")
  if [ -z "$LISTENERS" ] && [ "$OTHERS" -eq 0 ]; then echo "CARRIER_FREE_after=${i}s" >> "$LOG"; break; fi
  if [ "$i" -eq 180 ]; then echo "CARRIER_BUSY_BUDGET=360s listeners=[$LISTENERS] other_runners=$OTHERS —— **没跑成**，不是判据红" >> "$LOG"; exit 3; fi
  sleep 2
done
NO_COLOR=1 node_modules/.bin/playwright test -c playwright.detail-pane.config.ts "tests/$1" >> "$LOG" 2>&1
echo "E2E_RC=$?" >> "$LOG"
