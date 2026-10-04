#!/bin/bash
# B（四端重装）的"等到窗口就自己开工"看守。
# ============================================================================
#
# 🔴 为什么要有它，而不是我每隔几分钟手跑一次闸门：
#    `verify-mobile-window-gate.sh --target b` 的读数**每小时都在变**（今晚实测负载 101→23），
#    而"负载落回个位"这件事没有持有者、也不会有人来通知 —— 手轮询只会把回合烧在读数上。
#    本脚本把"等门开"这件事接管下来，门开的那一刻**按顺序**做完 B 的全部前置并起跑，
#    每一步的 rc 与时刻都落进日志（日志在 `/tmp/ht-b-window.<ts>.<pid>.log`，稳定名 `/tmp/ht-b-window.log`）。
#
# 🔴 负载门**不降级**：`rc=3` 就是等，不"看着差不多就跑"。
#    但载体那一路是**结构上**绕开 `src` 那格的（共享树里别人的 WIP 会被 `reinstall-all` 打包带走，
#    而隔离载体取的是提交态）—— 这不是放宽判据，是换一棵本来就干净的树，理由与实测见
#    docs/plans/calendar-profile-handoff.md §4.05 (9)(10)(26)。
#
# 步骤（门开之后，逐条落账，任何一步非零就停在那里、不许继续）：
#   1 让路：H 那条线的 flaky **那一趟 e2e 正在跑** ⇒ 先不抢同一道负载门（它一趟只跑十几分钟，等得起；
#     只在**等门**的看守不算挡路 —— 10-05 改，理由见下面第 2 段）
#   2 载体必须干净（脏了就停：那意味着有人在载体里写）
#   3 追平到当时的 `main` 尖（**记录追平前后的 sha**：B 的主张是"装的是当前源码"）
#   4 `pnpm --filter @heyta/op-log build` 必须 exit 0
#   5 `IOS_DEVICE_NAME=… bash scripts/reinstall-all.sh`，记 rc 与时长
#
# 用法：
#   RUN=1 bash research/tools/b-window-keeper.sh                 # 起跑（前台；后台由调用方负责）
#   RUN=1 BUDGET=10800 INTERVAL=60 …                             # 旋钮默认见下
#   缺 RUN=1 ⇒ 只打印将要做什么然后 exit 1（默认不动现场）
#
# 退出码：0 = 跑完（reinstall 的 rc 另记在 B_DONE）
#         1 = 前置不成立（没给 RUN / 载体脏 / op-log 构建红 / 重装红）
#         3 = 预算用尽而窗口一直没开（**环境无效，不是产品失败**）
#         4 = 装置或闸门用法坏（gate 返回 1 之类，必须人来看）
#
# 🔴 可注入的桩（`GATE` / `REINSTALL` / `OPLOG` / `H_PROBE`）是给验证台用的
#    （`research/tools/b-window-keeper-arms.sh`）—— 真实路径就是默认值。
#    桩必须实现**真谓词**（会按脚本序列退码、会写标记文件），否则臂在测桩自己。

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

MAIN="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)"
[ -n "$MAIN" ] || { echo "❌ 找不到仓库根（看守不猜路径）"; exit 4; }
# 让路那一格用的谓词与 H 看守、验证台**同一份**（`ht_ps_has`：豁免自己这一树的 ps 读数）。
[ -f "$MAIN/scripts/lib/ps-scan.sh" ] || { echo "❌ 缺 scripts/lib/ps-scan.sh ⇒ 让路判断测不了（不冒充「没人在跑」）"; exit 4; }
. "$MAIN/scripts/lib/ps-scan.sh"

RUN="${RUN:-}"
GATE="${GATE:-$MAIN/scripts/verify-mobile-window-gate.sh}"
OPLOG="${OPLOG:-}"                     # 空 = 真跑 pnpm；给了路径 = 验证台的桩
H_PROBE="${H_PROBE:-}"                 # 空 = 用默认 ps 探针；给了路径 = 桩
CARRIER="${CARRIER:-$(dirname "$MAIN")/heyta-wt-reinstall}"
# 🔴 顺序要紧：`REINSTALL` 的默认值依赖 `CARRIER`（写在 CARRIER 之前会撞上 set -u，
#    更糟的是"顺手写成主检出那份"就等于**在别人的活树上跑 B** —— 载体这一路的全部理由就是它取提交态）。
REINSTALL="${REINSTALL:-$CARRIER/scripts/reinstall-all.sh}"
IOS_DEVICE_NAME="${IOS_DEVICE_NAME:-heyta-iphone-17pro}"
BUDGET="${BUDGET:-10800}"               # 3 小时；今晚这种"别人整片重验证"的节奏要得起
INTERVAL="${INTERVAL:-60}"
DEFER_MAX="${DEFER_MAX:-900}"           # 让路给 H 看守的累计上限，超了就照实报"两边抢同一道门"

TS=$(date +%Y%m%d-%H%M%S)
LOG="${LOG:-/tmp/ht-b-window.${TS}.$$.log}"
# 🔴 稳定名必须可注入：验证台不注入就会把 `/tmp/ht-b-window.log` 指到一次性日志上，
#    下一位读"现场日志"的人拿到的是夹具（本仓 §7 有同族：稳定软链指向已删除的 mktemp）。
STABLE="${STABLE:-/tmp/ht-b-window.log}"
ln -sf "$LOG" "$STABLE" || true
trap 'rm -f -- "$0"' EXIT

say() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$1" | tee -a "$LOG"; }

if [ "$RUN" != 1 ]; then
  say "REFUSE=未给 RUN=1（默认不动现场）。要起跑：RUN=1 bash $0"
  exit 1
fi

say "start 预算=${BUDGET}s 轮询=${INTERVAL}s 载体=${CARRIER} 设备=${IOS_DEVICE_NAME} 日志=${LOG}"

# ── 0. 装置自己的前置 ───────────────────────────────────────────────────
[ -f "$GATE" ] || { say "BROKEN=闸门文件不在：${GATE}"; exit 4; }
[ -d "$CARRIER" ] || { say "BROKEN=载体目录不在：${CARRIER}（取径只认 git worktree list，别猜）"; exit 4; }

# ── 1. 等窗口：只认 rc=0 ───────────────────────────────────────────────
START=$(date +%s)
N=0
while :; do
  N=$(( N + 1 ))
  OUT=$(NO_COLOR=1 bash "$GATE" --target b 2>&1); RC=$?
  REDS=$(printf '%s\n' "$OUT" | grep -E '^REDS=' | tail -1)
  if [ "$RC" = 0 ]; then
    say "WINDOW=OPEN try=${N} ${REDS}"
    break
  fi
  if [ "$RC" = 3 ]; then
    say "try=${N} rc=3 ${REDS:-〈闸门没打 REDS，装置可疑〉}"
  else
    say "BROKEN=闸门 rc=${RC}（不是 0/3 ⇒ 用法或装置坏，不继续等）"
    printf '%s\n' "$OUT" | tail -5 | sed 's/^/      /' >> "$LOG"
    exit 4
  fi
  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -ge "$BUDGET" ]; then
    say "WINDOW=TIMEOUT 等满 ${ELAPSED}s / ${N} 次仍未开（环境无效，不是产品失败）"
    exit 3
  fi
  sleep "$INTERVAL"
done

# ── 2. 让路给 H 的 flaky **那一趟 e2e**（同一道负载门，一趟只几分钟）────────
#    🔴 让的是"真在跑"，不是"在等"（10-05 00:4x 改）。原来只要那把看守**活着**，B 就会让满
#    DEFER_MAX 再 exit 1 —— 一个等待器锁住了另一个等待器（与 H 那侧"让真在跑的 C 链、不让在等的
#    看守"是同一条规则，B 这边当时漏了一半）。代价不对称：B 的窗口还要 `src==0`，比 H 的窗口稀得多，
#    错过一次可能是再等半天，而 H 的一趟 e2e 只有十几分钟。
#    现量依据：H 开跑时 argv 必带它**独占**的 `--output=/tmp/ht-h-flaky-trace.$$`；等门阶段没有这个进程。
#    ⚠️ 已登记的敞口：B 过了这一格之后到真正起跑之间，H 仍可能恰好开火（两边各 30s 轮询）。
H_START=$(date +%s)
while :; do
  if [ -n "$H_PROBE" ]; then
    HPID=$(bash "$H_PROBE" 2>/dev/null | head -1)
  else
    # 现量依据：H 开跑时 argv 必带它**独占**的 `--output=/tmp/ht-h-flaky-trace.$$`；等门阶段没有这个进程。
    # 🔴 走共用的 `ht_ps_has` 而不是裸 pgrep：投这看守起来的那条命令行本身就带着图案时，
    #    裸 pgrep 会把我自己的祖先读成"H 在跑"（M4 实测：白让 1800s 后 exit 1，B 整条脱靶）。
    HPID=$(ht_ps_has 'ht-h-flaky[-]trace' | head -1)
  fi
  if [ -z "$HPID" ]; then
    say "DEFER=没有 H 的 e2e 在跑（那把看守只在等门 ⇒ 不算挡路），不等了"
    break
  fi
  if [ $(( $(date +%s) - H_START )) -ge "$DEFER_MAX" ]; then
    say "DEFER=让路超 ${DEFER_MAX}s 而 H 的 e2e（pid=${HPID}）仍在跑 ⇒ 照实报，不硬抢"
    exit 1
  fi
  say "DEFER=让 H 的 e2e pid=${HPID} 先用这道门，再等 30s"
  sleep 30
done

# ── 3. 载体干净度 ──────────────────────────────────────────────────────
DIRTY=$(git -C "$CARRIER" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "$DIRTY" != 0 ]; then
  say "STOP=carrier-dirty（${DIRTY} 行未提交 ⇒ 有人在载体里写，B 不在别人的现场上跑）"
  git -C "$CARRIER" status --porcelain | head -5 | sed 's/^/      /' >> "$LOG"
  exit 1
fi
FROM=$(git -C "$CARRIER" rev-parse --short HEAD)

# ── 4. 追平当时的 main 尖 ──────────────────────────────────────────────
FULL=$(git -C "$MAIN" rev-parse --verify -q 'main^{commit}' 2>/dev/null)
# 🔴 不用裸 `rev-parse --short main` 判成败：失败时它把**参数本身**回显到 stdout（"main"），
#    非空但不是 sha，而下一格正拿它做等值比较 —— 同族事故是"两次同样失败被读出载体==目标"。
#    而 `cat-file -t main` 也会把分支名解析成 commit，照样骗得过 ⇒ 只认 40 位十六进制。
if [ "${#FULL}" != 40 ]; then
  say "BROKEN=取不到 main 的 commit（读到的是〈${FULL}〉，长度 ${#FULL} 不是 40）"
  exit 4
fi
TIP=$(git -C "$MAIN" rev-parse --short "$FULL")
if [ "$FROM" = "$TIP" ]; then
  say "ALIGN=already at ${TIP}"
else
  git -C "$CARRIER" checkout -q --detach "$TIP" 2>>"$LOG"
  RC=$?
  NOW=$(git -C "$CARRIER" rev-parse --short HEAD 2>/dev/null)
  say "ALIGN rc=${RC} from=${FROM} to=${NOW} 目标=${TIP}"
  [ "$RC" = 0 ] || { say "STOP=align-failed"; exit 1; }
  if [ "$NOW" != "$TIP" ]; then
    say "STOP=align-mismatch（追平后载体是 ${NOW}，要的是 ${TIP}）"
    exit 1
  fi
fi

# ── 5. op-log 构建（B 的前置②）────────────────────────────────────────
if [ -n "$OPLOG" ]; then
  bash "$OPLOG" >> "$LOG" 2>&1; RC=$?
else
  ( cd "$CARRIER" && pnpm --filter @heyta/op-log build ) >> "$LOG" 2>&1; RC=$?
fi
say "STEP op-log-build rc=${RC}"
if [ "$RC" != 0 ]; then
  say "STOP=op-log-build（没继续起 B —— 装一个构建不过的产物不是当前产物）"
  exit 1
fi

# ── 6. 起 B ────────────────────────────────────────────────────────────
# 🔴 在**载体里**跑，且用它自己那份（追平之后就是 main 尖的已提交副本）：
#    主检出那棵树上全是别人未提交的源码，从那里起 B 装出来的就不是"当前源码的产物"。
[ -f "$REINSTALL" ] || { say "BROKEN=载体里没有重装脚本：${REINSTALL}（追平之后应该在）"; exit 4; }
R_START=$(date +%s)
say "STEP reinstall script=${REINSTALL} cwd=${CARRIER}"
( cd "$CARRIER" && IOS_DEVICE_NAME="$IOS_DEVICE_NAME" bash "$REINSTALL" ) >> "$LOG" 2>&1; RC=$?
say "B_DONE rc=${RC} secs=$(( $(date +%s) - R_START )) sha=${TIP} device=${IOS_DEVICE_NAME}"
[ "$RC" = 0 ] || exit 1
exit 0
