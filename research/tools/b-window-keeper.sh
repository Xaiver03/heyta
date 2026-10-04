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
#   5a 桌面段：`reinstall-all.sh --only mac,windows`（不动设备面），记 rc 与时长
#   5b **再过一次闸门**（不复用 5a 之前那次读数 —— 中间隔 15~25 分钟，效力早就过期）
#   5c 设备段：`reinstall-all.sh --only android,ios`（`adb uninstall` / `simctl uninstall` /
#      覆盖 /Applications 都在这两段里 ⇒ AGENTS §8.9 要的"不动别人正在用的设备"由这一次再判守着）
#
#    🔴 为什么拆两段而不是整趟跑：端序是 `mac windows android ios`（`reinstall-all.sh:161`），
#    设备面在**最后两段**，而 mac 段会走公证（`HEYTA_NOTARY_TIMEOUT` 默认 900s）、windows 段是远端打包
#    ⇒ 从闸门放行到第一次动设备之间隔着 15–25 分钟。"起跑那一刻没人在用"满足的是我的哨兵，
#    不是 §8.9 那句话。拆分用的是重装脚本**自己现成的** `--only`（`package.json` 的
#    `reinstall:desktop` / `reinstall:mobile` 就是这两条），没有自造参数形状。
#
# 用法：
#   RUN=1 bash research/tools/b-window-keeper.sh                 # 起跑（前台；后台由调用方负责）
#   RUN=1 BUDGET=10800 INTERVAL=60 …                             # 旋钮默认见下
#   缺 RUN=1 ⇒ 只打印将要做什么然后 exit 1（默认不动现场）
#
# 退出码：0 = 四端都跑完（两段的 rc 另记在 B_DESKTOP_DONE / B_DEVICE_DONE）
#         1 = 前置不成立（没给 RUN / 载体脏 / op-log 构建红 / 某一段重装红 / 设备段窗口没开）
#         3 = 预算用尽而窗口一直没开（**环境无效，不是产品失败**）
#         4 = 装置或闸门用法坏（gate 返回 1 之类，必须人来看）
#    ⚠️ **这两行要一起抄**：`B_DONE rc=` 只等于**设备段**那一趟的 rc，桌面段的 rc 在
#       `B_DESKTOP_DONE`。只抄 `B_DONE` 会把"mac 段红、android 段绿"读成全绿。
#       整趟的收口判据是"两段都 exit 0 且汇总里没有跳过端"，不是单一 rc。
#       （三段行的名字是故意**不**共用 `B_DONE` 前缀的，理由见第 6 段那条评论。）
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
# 第二段（设备面）前那一次**重新判**的等待预算。给得有界而不是"判一次就走"：
# 桌面段跑完那一刻设备面可能正被别人临时用一下，几分钟通常就让开了；
# 但绝不允许"等满就硬起"—— 那等于把这一格降级成装饰（§8.3）。
GATE2_BUDGET="${GATE2_BUDGET:-900}"

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
# 🔴 开窗判据**只写一次**：第 1 步（起跑前）与第 6 步（设备段前）共用这一个 `judge`。
#    同一个判断抄两遍是本仓库登记过的漂移起点（§3.2 那段"失败判据抄了三遍、三遍都漏"）。
judge() {
  G_OUT=$(NO_COLOR=1 bash "$GATE" --target b 2>&1); G_RC=$?
  G_REDS=$(printf '%s\n' "$G_OUT" | grep -E '^REDS=' | tail -1)
  G_OPEN=0
  [ "$G_RC" = 0 ] && G_OPEN=1
  # ⚠️ 只放行"红集**恰好**是 src 一种"：`load`/`dev`/`apk`/任何别的红（或**没打 REDS**）都不算开。
  #    负载门与设备门一个字没动（硬约束那句"负载门不达标就登记等待，不降级判据"仍然成立）。
  if [ "$G_RC" = 3 ] && [ "$G_REDS" = "REDS=src" ]; then G_OPEN=2; fi
}
START=$(date +%s)
N=0
while :; do
  N=$(( N + 1 ))
  judge
  if [ "$G_OPEN" = 1 ]; then
    say "WINDOW=OPEN try=${N} ${G_REDS}"
    break
  fi
  if [ "$G_OPEN" = 2 ]; then
    # 载体这一路**不吃 `src` 这一格**（下面是读脚本本体的现量，不是印象）：
    #   · `scripts/reinstall-all.sh:183` 第 0 步就是 `pnpm -r build`，而看守是 `( cd "$CARRIER" && … )` 起它的
    #     ⇒ 构建读的是**载体**那棵树；
    #   · `:214-225` 再把 `.app` 里的 `web-dist` 与"本机 `apps/web/dist` 是同一次构建"逐 chunk 对账；
    #   · 本脚本第 2 步要求载体工作树干净、第 3 步把它追平到 `main` 的**提交**尖并记 from/to sha。
    #   ⇒ 主检出里别人那几枚未提交字节**进不了产物**，而 `src` 这一格防的正是"把别人 WIP 打进产物"
    #     （§7 第 82 条）。所以等它 = 等一个对本路没有因果的读数 —— 与 C 链那条例子 `FIRE=apk-deferred` 同形。
    say "FIRE=src-deferred try=${N} ${G_REDS}（载体那一路结构性不吃 src；理由见本段注释与台账 (32)）"
    break
  fi
  if [ "$G_RC" = 3 ]; then
    say "try=${N} rc=3 ${G_REDS:-〈闸门没打 REDS，装置可疑〉}"
  else
    say "BROKEN=闸门 rc=${G_RC}（不是 0/3 ⇒ 用法或装置坏，不继续等）"
    printf '%s\n' "$G_OUT" | tail -5 | sed 's/^/      /' >> "$LOG"
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

# ── 6. 起 B：拆成"桌面段 → 再过一次闸门 → 设备段"───────────────────────
# 🔴 在**载体里**跑，且用它自己那份（追平之后就是 main 尖的已提交副本）：
#    主检出那棵树上全是别人未提交的源码，从那里起 B 装出来的就不是"当前源码的产物"。
[ -f "$REINSTALL" ] || { say "BROKEN=载体里没有重装脚本：${REINSTALL}（追平之后应该在）"; exit 4; }

# 6a 桌面段（不动设备面）
D_START=$(date +%s)
say "STEP reinstall-desktop script=${REINSTALL} cwd=${CARRIER} only=mac,windows"
( cd "$CARRIER" && IOS_DEVICE_NAME="$IOS_DEVICE_NAME" bash "$REINSTALL" --only mac,windows ) >> "$LOG" 2>&1; D_RC=$?
# 🔴 行名写的是 `B_DESKTOP_DONE` 而不是 `B_DONE_DESKTOP`：后者以 `B_DONE` 开头，
#    于是任何 `grep B_DONE` 的读法（台账、看守交接、下一位的手抄）先撞上的都是**桌面段**那一行，
#    而收口判据要的那条含 segments 的行在后面。前缀冲突是装置缺陷，不是排版问题（臂 I 当场照出来的）。
say "B_DESKTOP_DONE rc=${D_RC} secs=$(( $(date +%s) - D_START )) sha=${TIP}"
if [ "$D_RC" != 0 ]; then
  say "STOP=desktop-segment（桌面段红 ⇒ 不再动设备面；这一轮的「四端当前产物」不成立，两段 rc 都要抄）"
  exit 1
fi

# 6b 设备段前**重新判一次**闸门。不复用 6a 之前那次读数：端序 `mac windows android ios`，
#    从放行到第一次 `adb uninstall` 隔着 mac 段公证（默认 900s）+ windows 段远端打包 = 15–25 分钟，
#    那一段时间里别人完全可以把设备用上 —— "起跑那一刻没人在用"满足的是哨兵，不是 §8.9。
#    开窗判据与第 1 步**同一个 `judge`**（含 `src` 那一格对载体这一路无因果的放行），不抄第二遍。
G2_START=$(date +%s)
G2_N=0
while :; do
  G2_N=$(( G2_N + 1 ))
  judge; G2_RC="$G_RC"; G2_REDS="$G_REDS"
  if [ "$G_OPEN" = 1 ] || [ "$G_OPEN" = 2 ]; then
    say "GATE2=OPEN try=${G2_N} rc=${G2_RC} ${G2_REDS}（距第一次放行 $(( G2_START - START ))s）"
    break
  fi
  if [ "$G2_RC" != 3 ]; then
    say "BROKEN=第二次闸门 rc=${G2_RC}（装置或用法坏；桌面段已跑完，设备段没动）"
    printf '%s\n' "$G_OUT" | tail -5 | sed 's/^/      /' >> "$LOG"
    exit 4
  fi
  say "GATE2 try=${G2_N} rc=3 ${G2_REDS:-〈闸门没打 REDS，装置可疑〉} —— 设备段不起跑"
  if [ $(( $(date +%s) - G2_START )) -ge "$GATE2_BUDGET" ]; then
    say "STOP=device-window-closed 等满 ${GATE2_BUDGET}s 设备面仍不让开 ⇒ **这轮只装了 mac+windows**，android/ios 是当前产物这件事**不成立**"
    exit 1
  fi
  sleep "$INTERVAL"
done

# 6c 设备段（真正会 `adb uninstall` / `simctl uninstall` 的两段）
R_START=$(date +%s)
say "STEP reinstall-device script=${REINSTALL} cwd=${CARRIER} only=android,ios"
( cd "$CARRIER" && IOS_DEVICE_NAME="$IOS_DEVICE_NAME" bash "$REINSTALL" --only android,ios ) >> "$LOG" 2>&1; RC=$?
say "B_DEVICE_DONE rc=${RC} secs=$(( $(date +%s) - R_START )) sha=${TIP}"
say "B_DONE rc=${RC} secs=$(( $(date +%s) - R_START )) sha=${TIP} device=${IOS_DEVICE_NAME} segments=desktop(${D_RC})+device(${RC})"
[ "$RC" = 0 ] || exit 1
exit 0
