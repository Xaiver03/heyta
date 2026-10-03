#!/bin/bash
# R14c 的 Android 腿：等到窗口，再"同步载体 → 打产物 → 跑验收"整条射出去。
#
# 🔴 为什么第二版要先同步载体（第一版不做这件事，02:0x 被现量否证）：
#   第一版只在窗口开时叫 `--confirm`，装的是载体里 **01:05 打好的那个 APK**。
#   现量：主检出 HEAD 已从载体的 `93113e30` 走到更新，而 `93113e30..HEAD` 之间有
#   **33 个 APK 输入面文件**变了（`packages/i18n/src/locales/*`、`packages/app-host/*`、
#   `packages/storage/*`、`packages/sync-client/src/client.ts`、`apps/mobile/src/{db,screens,sync}/*`、
#   `packages/ui/src/sync/model.ts`）。⇒ 那一趟如果绿了，绿的是**旧 bundle**，
#   正是 AGENTS §7 第 27 条（"packages/ 改了、APK 里是旧 JS bundle，验收对旧代码报绿"）。
#   更阴的一点：**闸门自己看不见这件事** —— 它比的 mtime 是"载体里的 APK vs 载体里的源码"，
#   载体落后于主检出时两边一起旧，判据照样 ✅。⇒ 补这条：把载体指到主检出的当前提交再打。
#
# 退出码：0 = 开窗且整条链跑完（链自己的 rc 决定成败，见 CHAIN rc= 行）
#         3 = 没等到窗口（环境不成立，不是产品失败）
#         4 = 装置前提不成立（载体/闸门/链脚本缺文件、self-test 不过）
# 硬约定：**不在窗口之外动设备**；不自建第二套前置判据（前置一律问 `verify-mobile-window-gate.sh`）。
# 日志：每次跑一个唯一文件，再把稳定名指过来 —— 稳定名给台账引用，唯一名防并发互相覆盖
#       （本机实测过"同一个路径先后出现两种内容"那件事）。
set -u

MAIN="${MAIN:-/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta}"
CARRIER="${CARRIER:?❌ 必须传 CARRIER=<干净载体路径>（本装置不猜，避免在带别人 WIP 的主检出里打包）}"
BUDGET="${BUDGET:-3600}"
INTERVAL="${INTERVAL:-60}"
STABLE_LOG="${STABLE_LOG:-/tmp/ht-r14c-window.log}"
LOG="${LOG:-/tmp/ht-r14c-window.$(date +%Y%m%d-%H%M%S).$$.log}"
ln -sf "$LOG" "$STABLE_LOG" 2>/dev/null
GATE="$CARRIER/scripts/verify-mobile-window-gate.sh"
CHAIN="$CARRIER/research/tools/r14c-carrier-chain.sh"

# ── 前提（缺一样就 exit 4，不带着坏装置进窗口）
for f in "$GATE" "$CHAIN"; do
  [ -f "$f" ] || { echo "❌ 载体里缺文件：$f" >&2; exit 4; }
done

# ── self-test：等待条件里的 pgrep 模式必须能"看得见东西"，否则那条让路判据永远不触发。
#    反例形状（本机踩过两次）：模式匹配到装置自己的命令行 ⇒ 恒"有人在跑"；或漏了 -f ⇒ 恒 0。
CO_PATTERN='h-flaky-window-watche[r]'
if pgrep -f "$CO_PATTERN" >/dev/null 2>&1; then
  SELFTEST=sees_other   # 此刻真有别的看守在跑（正常）
else
  # 阳性对照：临时起一枚带该串的睡眠进程，模式必须数得出它
  ( exec -a "h-flaky-window-watcher-SELFTEST" sleep 2 ) &
  SPID=$!
  sleep 0.4
  if pgrep -f "$CO_PATTERN" >/dev/null 2>&1; then SELFTEST=positive_ok; else SELFTEST=BROKEN; fi
  kill "$SPID" 2>/dev/null
fi
[ "$SELFTEST" = BROKEN ] && { echo "❌ 让路判据的 pgrep 模式自测不过 ⇒ 装置坏，不开跑" >&2; exit 4; }

echo "start $(date '+%T') 窗口预算=${BUDGET}s 间隔=${INTERVAL}s 载体=$CARRIER 日志=$LOG selftest=$SELFTEST" >> "$LOG"
cat >> "$LOG" <<HDR
本装置第二版：开窗后先 `git checkout <主检出当前提交>` 再打产物（原因见文件头那条 33 文件的现量否证）。
HDR

START=$(date +%s)
N=0
while :; do
  N=$((N + 1))
  {
    echo "----- 第 $N 次 $(date '+%T') -----"
    MAIN_SHA=$(git -C "$MAIN" rev-parse --short HEAD 2>/dev/null)
    CAR_SHA=$(git -C "$CARRIER" rev-parse --short HEAD 2>/dev/null)
    echo "载体 sha=${CAR_SHA:-取不到} / 主检出 sha=${MAIN_SHA:-取不到} / 需要同步=$( [ "$CAR_SHA" != "$MAIN_SHA" ] && echo yes || echo no)"
  } >> "$LOG" 2>&1

  # 让路：另一条重验证看守还活着就继续等（Playwright 与设备腿都算重活，AGENTS §8.9 + 本机"串行"纪律）
  CO_PIDS=$(pgrep -f "$CO_PATTERN" 2>/dev/null | tr '\n' ' ')
  if [ -n "$CO_PIDS" ]; then
    echo "CO_RUNNER=alive pid=${CO_PIDS% } —— 让路，本轮不起设备腿" >> "$LOG"
  else
    # 问权威闸门：窗口开没开（dry-run，不加 --confirm，绝不让它替我动手）
    NO_COLOR=1 bash "$GATE" --target c --repo "$CARRIER" > "$LOG.tmp.$$" 2>&1
    GATE_RC=$?
    cat "$LOG.tmp.$$" >> "$LOG"; rm -f "$LOG.tmp.$$"
    echo "ATTEMPT rc=$GATE_RC" >> "$LOG"
    if [ "$GATE_RC" -eq 0 ]; then
      echo "WINDOW=open $(date '+%T') —— 开始整条链" >> "$LOG"
      if [ "$CAR_SHA" != "$MAIN_SHA" ]; then
        git -C "$CARRIER" checkout --detach "$MAIN_SHA" >> "$LOG" 2>&1
        echo "SYNC rc=$?（目标 $MAIN_SHA）" >> "$LOG"
        git -C "$CARRIER" status --porcelain -- packages apps server scripts | sed 's/^/   仍脏：/' >> "$LOG"
      else
        echo "SYNC rc=0（载体已在 $MAIN_SHA，无需同步）" >> "$LOG"
      fi
      CARRIER="$CARRIER" LOG="/tmp/ht-r14c-chain.$$.log" bash "$CHAIN" >> "$LOG" 2>&1
      CHAIN_RC=$?
      echo "CHAIN rc=$CHAIN_RC" >> "$LOG"
      echo "ALL_DONE final_rc=$CHAIN_RC" >> "$LOG"
      exit $CHAIN_RC
    elif [ "$GATE_RC" -ne 3 ]; then
      echo "ALL_DONE final_rc=$GATE_RC（闸门回了非 0 非 3 的码 —— 不洗白，原样交出去）" >> "$LOG"
      exit $GATE_RC
    fi
  fi

  NOW=$(date +%s)
  if [ $((NOW - START)) -ge "$BUDGET" ]; then
    echo "WINDOW=timeout（${BUDGET}s 用尽，共 $N 次）$(date '+%T')" >> "$LOG"
    echo "ALL_DONE final_rc=3" >> "$LOG"
    exit 3
  fi
  sleep "$INTERVAL"
done
