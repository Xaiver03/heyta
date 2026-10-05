#!/bin/bash
# 第 11 号（重拍 UIPIN 过期的取证图）的"等到窗口就自己开工"看守。
# ============================================================================
#
# 🔴 为什么又是一把看守而不是继续登记"等负载"：
#    `r17-reshoot-stale.sh` 已经会自己判前置并 `exit 3`（环境无效 ≠ 产品失败），
#    但它**等人按**。§4.05 (31) 那条教训在这里同样成立：门不是不开，是没人守着它开的那一刻。
#    本脚本把"按一次"变成"守着按"，并且**只按它自己**：所有判据都在 `r17-reshoot-stale.sh` 里，
#    这里一个字都不复刻（复刻一份判据 = 从这一刻开始漂）。
#
# 🔴 不降级任何东西：开窗条件 = 被守的那条命令自己退 0。
#    它退 3 就是等（负载 / 4318 端口 / dist 落后 / 依赖 / 载体不干净，五条都在它那边判）。
#
# 🔴 让路只让**真在跑的**，不让**在等的**（§4.05 (31)(32) 同一条规则第三次应用）：
#    B 的四端重装与 H 的那趟 e2e 都在同一道负载门上，而重拍自己也是重活（起 vite + 真浏览器）。
#    两边都在等的时候不该互相锁死；一边真在跑的时候另一边不该同时开火。
#    读数走 `scripts/lib/ps-scan.sh` 那份共用谓词（豁免自己这一树，理由见那个文件的头）。
#
# 用法：
#   bash research/tools/r17-reshoot-keeper.sh                 # 缺 RUN=1 ⇒ 只打印将要做什么，exit 1
#   RUN=1 BUDGET=5400 INTERVAL=180 bash research/tools/r17-reshoot-keeper.sh
#   ONLY=calendar-day RUN=1 …                                 # 只重拍一枚目录（原样转给被守的那条）
#
# 退出码：0 = 跑完了（重拍本身的 rc 另记在 RESHOOT_DONE）
#         1 = 前置不成立（没给 RUN / 被守的脚本不在）
#         3 = 预算用尽而窗口一直没开（**环境无效，不是产品失败**）
#         4 = 装置或被守的脚本用法坏（它返回非 0/3 ⇒ 必须人来看）

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 按字节偏移增量读脚本，
#    运行中被编辑就从错位字节开始解析；入口先拷成隐藏快照再 exec 副本。
case "$(basename "$0")" in
  .*.snap.*) ;;
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
set -u

MAIN="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$MAIN/scripts/lib/ps-scan.sh" ] || { echo "❌ 缺 scripts/lib/ps-scan.sh ⇒ 让路判断测不了（不冒充「没人在跑」）"; exit 4; }
. "$MAIN/scripts/lib/ps-scan.sh"

RUN="${RUN:-}"
RESHOOT="${RESHOOT:-$MAIN/research/tools/r17-reshoot-stale.sh}"
BUDGET="${BUDGET:-10800}"               # 3h：窗口要"够等"——上限比一趟跑完还短＝静默少一整段交付
INTERVAL="${INTERVAL:-180}"
DEFER_MAX="${DEFER_MAX:-5400}"          # 让路上限要**盖得住被等那件事跑完**：B 的一趟重装实测几十分钟到一小时
# 🔴 让路的两个图案做成旋钮（默认值逐字不变），理由不是"好看"，是**验证台必须能造出可判的现场**：
#    这台机器上随时可能有**别的线**真在跑 reinstall（01:0x 现量 pid 46610 就匹配着默认图案），
#    臂若拿默认图案去断言"现在没人跑"，就是在假设现场真空 ⇒ 同一臂白天绿、深夜红（本仓那条老规矩）。
#    ⇒ 决策逻辑用夹具专属图案跑；默认图案本身由臂 J2 钉字面值。
DEFER_REINSTALL_RE="${DEFER_REINSTALL_RE:-scripts/[.]?reinstall-all}"
DEFER_E2E_RE="${DEFER_E2E_RE:-ht-h-flaky[-]trace}"
ONLY="${ONLY:-}"
MODE="${1:-run}"
if [ -n "${LOG:-}" ]; then STABLE_TIED=0
elif [ "$MODE" = "run" ]; then
  LOG="/tmp/ht-r17-reshoot.$(date +%Y%m%d-%H%M%S).$$.log"
  STABLE_LOG="${STABLE_LOG:-/tmp/ht-r17-reshoot.log}"
  ln -sf "$LOG" "$STABLE_LOG" && STABLE_TIED=1 || STABLE_TIED=0
else STABLE_TIED=0; fi
STABLE_LOG="${STABLE_LOG:-/tmp/ht-r17-reshoot.log}"

say() { printf '%s %s\n' "$(date '+%T')" "$1" >> "$LOG"; printf '%s\n' "$1"; }

if [ "$MODE" = "--selftest-help" ]; then sed -n '1,30p' "$0"; exit 0; fi

if [ "$RUN" != "1" ]; then
  mkdir -p "$(dirname "$LOG")"; : > "$LOG"
  echo "缺 RUN=1 ⇒ 什么都不做（默认不动现场）。要起跑：RUN=1 bash $0"
  echo "将会做：等 $RESHOOT 自己退 0（它退 3 就等），期间让路给真在跑的 B 重装与 H e2e，然后跑它 --confirm"
  exit 1
fi

[ -f "$RESHOOT" ] || { say "BROKEN=被守的脚本不在：$RESHOOT"; exit 4; }
say "start 预算=${BUDGET}s 轮询=${INTERVAL}s 让路上限=${DEFER_MAX}s 范围=${ONLY:-〈全部过期目录〉} 日志=$LOG 稳定名=$STABLE_LOG(挂上=$STABLE_TIED)"

call_reshoot() {
  if [ -n "$ONLY" ]; then bash "$RESHOOT" "$@" --only "$ONLY" 2>&1
  else bash "$RESHOOT" "$@" 2>&1; fi
}

START=$(date +%s)
N=0
while :; do
  N=$(( N + 1 ))
  OUT=$(call_reshoot); RC=$?
  GATES=$(printf '%s\n' "$OUT" | grep -E '前置不达标：GATES=' | tail -1 | sed 's/.*GATES=//; s/ .*//')
  if [ "$RC" = 0 ]; then
    # 🔴 10-05 13:5x 加的判读格。原来这里只看 `RC=0` 就宣布 `WINDOW=OPEN GATES=〈空〉`，
    #    而"退 0"至少有三种来源，其中两种**根本没跑闸门**：
    #      ① 闸门全绿、有活要拍 —— 输出里有 `== 3. 前置门` 那一节（真跑过）；
    #      ② 现量没有过期目录 —— 被守的脚本在 §1 就早退了，第 3 节一个字都没打；
    #      ③ 用法/载体不成立 —— 那是 rc≠0，走下面另一支。
    #    把 ② 读成"门开了"的实际后果（13:48 实测）：它宣布 WINDOW=OPEN 的那一刻
    #    `host_load_gate` 现量是 **红的**（load1=13 对阈值 12）。一声没有闸门背书的"门开了"
    #    比没有这声更糟 —— 下一个人会以为绿过（本仓 §7 第 50 条那一族）。
    if printf '%s\n' "$OUT" | grep -q 'NOTHING_TO_SHOOT=1'; then
      say "NOTHING_TO_SHOOT=1（被守的脚本现量没有过期目录，且**没跑第 3 节前置门**）⇒ 不起 --confirm，收工"
      printf '%s\n' "$OUT" | tail -4 | sed 's/^/      /' >> "$LOG"
      exit 0
    fi
    if printf '%s\n' "$OUT" | grep -q '== 3\. 前置门'; then
      say "WINDOW=OPEN try=${N} GATES=〈空〉（这一趟第 3 节的前置门**跑过且全绿** —— 不是「没跑」）"
      break
    fi
    say "PROBE=SUSPECT：被守的脚本退 0，可输出里既没有「== 3. 前置门」那一节、也没有「NOTHING_TO_SHOOT=1」那枚标记"
    say "  ⇒ 这个 rc=0 分不清「闸门全绿」与「闸门根本没跑」，按装置坏了处理（exit 4），绝不据它起跑"
    printf '%s\n' "$OUT" | tail -8 | sed 's/^/      /' >> "$LOG"
    exit 4
  fi
  if [ "$RC" = 3 ]; then
    say "try=${N} rc=3 GATES=${GATES:-〈被守的脚本没打 GATES，装置可疑〉}"
  else
    say "BROKEN=$RESHOOT rc=${RC}（不是 0/3 ⇒ 用法或装置坏，不继续等）"
    printf '%s\n' "$OUT" | tail -6 | sed 's/^/      /' >> "$LOG"
    exit 4
  fi
  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -ge "$BUDGET" ]; then
    say "WINDOW=TIMEOUT 等满 ${ELAPSED}s / ${N} 次仍未开（环境无效，不是产品失败）"
    exit 3
  fi
  sleep "$INTERVAL"
done

# ── 让路：只在 B/H **真在跑**的那一段等 ─────────────────────────────────
D_START=$(date +%s)
while :; do
  B_PID=$(ht_ps_has "$DEFER_REINSTALL_RE" | head -1)
  H_PID=$(ht_ps_has "$DEFER_E2E_RE" | head -1)
  if [ -z "$B_PID" ] && [ -z "$H_PID" ]; then
    say "DEFER=没有真在跑的重装或 e2e（在等的看守不算），开工"
    break
  fi
  if [ $(( $(date +%s) - D_START )) -ge "$DEFER_MAX" ]; then
    say "DEFER=让路超 ${DEFER_MAX}s 而 B_PID=${B_PID:-无} H_PID=${H_PID:-无} 仍在跑 ⇒ 照实报，不硬抢"
    exit 1
  fi
  say "DEFER=让真在跑的（B=${B_PID:-无} H=${H_PID:-无}）先用这道门，再等 60s"
  sleep 60
done

OUT=$(call_reshoot --confirm); RC=$?
SECS=$(( $(date +%s) - START ))
printf '%s\n' "$OUT" | tail -40 >> "$LOG"
say "RESHOOT_DONE rc=${RC} secs=${SECS} 范围=${ONLY:-〈全部〉}"
[ "$RC" = 0 ] || { say "STOP=reshoot-failed（被守的那条自己红了 ⇒ 交人看，不重试不掩盖）"; exit 1; }
say "NEXT=人必须打开那几张图并在各自 README 写「看见了什么」+ 重钉 UIPIN（§6.2 规定一；被守的脚本刻意不代做这一步）"
exit 0
