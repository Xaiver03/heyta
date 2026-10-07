#!/bin/bash
# 有界等内存闸门（`/tmp/tfa-test.lock`）空出来，再跑被包的那条测试命令。
#
# 用法（仓库根）：bash research/tools/with-test-lock.sh <输出日志> -- <命令...>
#   例：bash research/tools/with-test-lock.sh /tmp/x.log -- \
#         pnpm --filter @heyta/web exec vitest run tests/foo.spec.tsx
#
# 🔴 为什么等而不是抢：这台机器的内存闸门（`~/.tfa-shield`）拒绝并发测试，因为并发会把
#    某些进程推到 1.8–26GB，整机「内存不足」弹窗就是这么来的。硬抢
#    （`TFA_ALLOW_CONCURRENT_TEST=1`）是把**别人的运行**换成自己的红，明令禁止。
# ⚠️ 这里**不 kill 任何东西**：锁主哪怕十秒前是我自己，那也是另一个进程。
#    等不到就响亮失败（rc=3）并把持有者点名 —— "没跑成"与"跑出来是红的"必须能区分。
# ⚠️ 锁是**一个 pid 文件**：pid 已经不在了 = 上一位崩了没清，那种陈旧锁可以直接判给新来者
#    （这里仍然不动它，只报出来让人知道）。
set -u
LOG="${1:?用法: with-test-lock.sh <日志> -- <命令...>}"
shift
[ "${1:-}" = "--" ] && shift
: > "$LOG"
LOCK=/tmp/tfa-test.lock
BUDGET="${HEYTA_LOCK_BUDGET:-900}"   # 秒；默认 15 分钟

waited=0
while [ "$waited" -lt "$BUDGET" ]; do
  if [ ! -f "$LOCK" ]; then
    echo "LOCK_FREE_after=${waited}s" >> "$LOG"
    break
  fi
  HOLDER=$(tr -d '[:space:]' < "$LOCK")
  if [ -n "$HOLDER" ] && ! kill -0 "$HOLDER" 2>/dev/null; then
    echo "LOCK_STALE pid=${HOLDER}（进程已不在，锁没清 —— 本脚本不动它）" >> "$LOG"
    echo "LOCK_STALE_NOT_KILLED=1" >> "$LOG"
    break
  fi
  if [ "$waited" -eq 0 ]; then
    echo "LOCK_HELD pid=${HOLDER} who=$(ps -o command= -p "$HOLDER" 2>/dev/null | cut -c1-140)" >> "$LOG"
  fi
  sleep 5
  waited=$((waited + 5))
done

if [ -f "$LOCK" ] && [ "$waited" -ge "$BUDGET" ]; then
  HOLDER=$(tr -d '[:space:]' < "$LOCK")
  echo "LOCK_BUSY_BUDGET=${BUDGET}s holder=${HOLDER} who=$(ps -o command= -p "$HOLDER" 2>/dev/null | cut -c1-140)" >> "$LOG"
  echo "  —— **没跑成**，不是判据红。这条读数不许记进任何一单的判据。" >> "$LOG"
  exit 3
fi

"$@" >> "$LOG" 2>&1
echo "INNER_RC=$?" >> "$LOG"
tail -6 "$LOG"
