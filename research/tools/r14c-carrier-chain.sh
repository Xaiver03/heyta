#!/usr/bin/env bash
# R14c 的 Android 真机腿：在**按提交 SHA 切出的干净载体**里跑完整链。
#
# 为什么要在载体里做而不是主检出：00:5x 现量主检出有 22 枚别人未提交的源码，
# 其中 `apps/mobile/src/db/op-sqlite-driver.ts` 正在本线判据的落库路径上 ——
# 从主检出打的 APK 会把别人的 WIP 一起打进去，而判据全绿（AGENTS §7 第 82 条一族）。
#
# 每一步都打 `STEP <名> rc=<码>` 哨兵行；退出码不被管道吃掉（traps #45）。
# 第 5 步的验收脚本自带负载门与设备占用探针：不达标它会 exit 3（环境无效，不是产品失败），
# 那时前面的产物已经备好，直接重跑第 5 步即可。
set -u
CARRIER="${CARRIER:-/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-r14c}"
LOG="${LOG:-/tmp/ht-r14c-chain.log}"
cd "$CARRIER" || { echo "CARRIER 不存在: $CARRIER"; exit 1; }
SHA=$(git rev-parse --short HEAD)
echo "=== chain start $(date '+%F %T') carrier=$CARRIER sha=$SHA" > "$LOG"

run() { # <步骤名> <命令...>
  local name="$1"; shift
  echo "----- STEP ${name} begin $(date '+%T') -----" >> "$LOG"
  "$@" >> "$LOG" 2>&1
  local rc=$?
  echo "STEP ${name} rc=${rc}" >> "$LOG"
  echo "[chain] ${name} rc=${rc}"
  return $rc
}

run install pnpm install --frozen-lockfile || { echo "CHAIN_STOPPED_AT=install" >> "$LOG"; exit 1; }
# 🔴 链接解析必须落在载体里，否则"在载体里打包"打的是别的树（本线 §3·补 ⑭ 记的那条坑）
RESOLVED=$(node -e 'console.log(require("fs").realpathSync(require("path").resolve("apps/mobile/node_modules/@heyta/ui")))' 2>/dev/null)
echo "RESOLVE ui=${RESOLVED}" >> "$LOG"
case "$RESOLVED" in
  "$CARRIER"/*) echo "RESOLVE_OK 载体自洽" >> "$LOG" ;;
  *) echo "CHAIN_STOPPED_AT=resolve（@heyta/ui 解析到别的树：${RESOLVED}）" >> "$LOG"; exit 1 ;;
esac

run build_all pnpm -r build || { echo "CHAIN_STOPPED_AT=build_all" >> "$LOG"; exit 1; }
run stack_up bash scripts/mobile-e2e-up.sh || echo "NOTE stack_up 没起来，验收脚本第 0 步会 exit 3" >> "$LOG"
run build_android pnpm build:android || { echo "CHAIN_STOPPED_AT=build_android" >> "$LOG"; exit 1; }
run verify bash scripts/verify-mobile-due-time.sh
rc=$?
echo "=== chain end $(date '+%F %T') verify_rc=${rc}" >> "$LOG"
echo "[chain] verify rc=${rc}"
exit $rc
