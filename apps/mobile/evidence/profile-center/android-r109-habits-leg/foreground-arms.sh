#!/usr/bin/env bash
# 臂对：证明 `ensure_app_foreground` 现在**真的会红**，而它的绿不是"没人查"查出来的。
#
# 为什么这三条臂值得单独写：这一族的问题不是"函数写错了"，是**它的返回值没有消费者收得到**。
# 改前那一版是"查一次 → 不在前台就拉 → `sleep 2` → `return 0`"，重拉之后**一眼都不再看**，于是：
#   · `scripts/verify-mobile-habits.sh` 的 `ensure_app_foreground || blame_crash`
#   · `scripts/verify-mobile-account-erasure.sh` 的 `if ! ensure_app_foreground; then bad "三次都没到前台"`
# 这两条**写好了等它**的红路径一次都开不了火，后面每一发 `input tap` 打在启动器上，
# 读数长成"字段没填进去 / 导航没进去"。同一形状本线昨夜在自己的探针上撞过一次
# （`monkey` 之后前台是 nexuslauncher，前两格填进了启动器的搜索框）。
#
# 三条臂全部**不碰真设备**：`adb` 换成同名 shell 函数桩，前台字符串由桩给。
# ⚠️ 桩必须是 shell 函数而**不是仓库里的一个可执行文件**：本仓路径含空格，
#    而 lib 是用 `$ADB shell …`（不带引号）调的 ⇒ 换成文件路径会被词分割劈成
#    `/Users/…/Desktop/All`，桩根本没跑，臂 1 会假红（第一版实测就是这个）。
# 臂 2 要真等 12 秒吗？不要 —— 夹具把 `sleep` 定义成空函数，那一圈 4 次重拉瞬间走完。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE"
while [ ! -f "$REPO/scripts/lib/mobile-e2e.sh" ] && [ "$REPO" != "/" ]; do REPO="${REPO%/*}"; done
[ -f "$REPO/scripts/lib/mobile-e2e.sh" ] || { echo "🔴 找不到仓库根（scripts/lib/mobile-e2e.sh 不在上面任何一层）"; exit 1; }
LIB="$REPO/scripts/lib/mobile-e2e.sh"
RUN="$HERE/foreground-arms-run"
mkdir -p "$RUN"
LAUNCH_LOG="$RUN/launches"

# ── 载入 lib（真那份，探针自解析同目录才找得到），再把 adb / sleep 换成桩 ──
export HEYTA_E2E_UI_XML="$RUN/ui.xml" HEYTA_E2E_XY_PY="$RUN/_xy.py"
export E2E_SERIAL="${E2E_SERIAL:-arm-serial}"
cd "$REPO" || exit 1
# shellcheck disable=SC1091
source scripts/lib/mobile-e2e.sh >/dev/null

adb_stub() {
  local a seen_dumpsys=0 seen_start=0 seen_resolve=0
  # ⚠️ 不能在循环里"没匹配就 return"：桩收到的第一枚参数永远是 `shell`，
  #    那样写会在还没看到 `dumpsys`/`start` 之前就把**空输出**当结果返回 ——
  #    于是三条臂全都读成"前台为空"，臂 1 假红、臂 2 一次都不重拉（实测踩过）。
  for a in "$@"; do
    case "$a" in
      dumpsys) seen_dumpsys=1 ;;
      resolve-activity) seen_resolve=1 ;;
      start|monkey) seen_start=1 ;;
    esac
  done
  if [ "$seen_dumpsys" = 1 ]; then
    printf '    topResumedActivity: ActivityRecord{1234 u0 %s t12}\n' "$FAKE_TOP"
    return 0
  fi
  if [ "$seen_resolve" = 1 ]; then
    printf 'com.heyta/com.heytamobile.MainActivity\n'
    return 0
  fi
  if [ "$seen_start" = 1 ]; then
    echo x >> "$LAUNCH_LOG"
  fi
  return 0
}
ADB=adb_stub
sleep() { :; }

# ── 臂 0：桩自己先证明它在说话（否则三条臂读到的"前台为空"是量具坏了，不是被测物坏了）──
export FAKE_TOP="com.heyta/com.heytamobile.MainActivity"
PROBE_OUT=$($ADB shell dumpsys activity activities 2>/dev/null)
case "$PROBE_OUT" in
  *topResumedActivity*com.heyta*) ;;
  *) echo "🔴 桩没给出可读的 topResumedActivity（实得：[${PROBE_OUT:-空}]）—— 三条臂全部作废，先修量具"
     exit 1 ;;
esac
echo "   臂 0（桩自证）              → 给得出 topResumedActivity"

# ── 臂 1：前台就是应用 ⇒ 必须 0，且一次都不该重拉 ──
export FAKE_TOP="com.heyta/com.heytamobile.MainActivity"; : > "$LAUNCH_LOG"
R1=0; ensure_app_foreground >/dev/null 2>&1 || R1=$?
N1=$(wc -l < "$LAUNCH_LOG" | tr -d ' ')

# ── 臂 2：前台一直是启动器 ⇒ 必须 1，并且真重拉过 4 次（不是"看一眼就放人"）──
export FAKE_TOP="com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity"
: > "$LAUNCH_LOG"
R2=0; ensure_app_foreground >/dev/null 2>&1 || R2=$?
N2=$(wc -l < "$LAUNCH_LOG" | tr -d ' ')

# ── 臂 3：**改前**那一版：从 lib 正文里把那段"重拉后再查"摘出来换成 `sleep 2 → return 0`，
#    其余逐字不动 ⇒ 同一夹具、同一形状，这一臂必须仍是 0（这才说明"能红"来自本次改动）──
RB=""
{
  awk '/^ensure_app_foreground\(\) \{$/,/^\}$/' "$LIB" > "$RUN/fn.after.sh"
  grep -c . "$RUN/fn.after.sh" >/dev/null || { echo "🔴 没从 lib 里摘出那枚函数（定义形状变了）"; exit 8; }
  python3 - "$RUN/fn.after.sh" "$RUN/fn.before.sh" <<'PY'
import sys, io
src, dst = sys.argv[1], sys.argv[2]
s = io.open(src, encoding="utf-8").read()
red = '      return 1'
assert s.count(red) == 1, f"施不了这个变异：`return 1` 那一枚函数里出现 {s.count(red)} 次"
# 最小变异：只把那一句报红换成放人，其余逐字不动 ⇒ 这条臂证明的是
# **「报红」这一刀本身在起作用**（改前那版没有这一刀，同一夹具它就是 0）。
io.open(dst, "w", encoding="utf-8").write(s.replace(red, '      return 0'))
PY
  # shellcheck disable=SC1091
  source scripts/lib/mobile-e2e.sh >/dev/null 2>&1
  eval "$(cat "$RUN/fn.before.sh")"
  ADB=adb_stub
  sleep() { :; }
  export LAUNCH_LOG="$RUN/launches-before"
  : > "$LAUNCH_LOG"
  export FAKE_TOP="com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity"
  R3=0; ensure_app_foreground >/dev/null 2>&1 || R3=$?
  N3=$(wc -l < "$LAUNCH_LOG" | tr -d ' ')
  echo "BEFORE_RC=$R3 BEFORE_LAUNCHES=$N3"
} > "$RUN/before.txt" 2>&1
RB=$(sed -n 's/.*BEFORE_RC=\([0-9]*\).*/\1/p' "$RUN/before.txt")
NB=$(sed -n 's/.*BEFORE_LAUNCHES=\([0-9]*\).*/\1/p' "$RUN/before.txt")

echo "── 三条读数 ──"
echo "   臂 1（前台=应用，改后）      → RC=$R1 重拉 $N1 次"
echo "   臂 2（前台=启动器，改后）    → RC=$R2 重拉 $N2 次"
echo "   臂 3（前台=启动器，改前形状）→ RC=${RB:-读不到} 重拉 ${NB:-读不到} 次"

rc=0
[ "$R1" = 0 ] || { echo "🔴 臂 1 红：应用已在前台却判不在 —— 量具对 topResumedActivity 的解析先修"; rc=1; }
[ "$N1" = 0 ] || { echo "🔴 臂 1 重拉过 $N1 次：已在前台还去重拉，会把后台路径上的内存凭据洗掉"; rc=1; }
[ "$R2" != 0 ] || { echo "🔴 臂 2 绿：前台是启动器却返回 0 ⇒ 函数仍然「重拉完不再看一眼」"; rc=1; }
[ "$N2" = 4 ] || { echo "🔴 臂 2 重拉次数不是 4：没走完「拉一次→再看一眼」那一圈，证明不了任何事"; rc=1; }
[ "${RB:-1}" = 0 ] || { echo "🔴 臂 3 没施上：改前那版也报红了 ⇒ 摘出来的不是旧形状"; rc=1; }
[ "$rc" = 0 ] && echo "✅ 三条合预期：应用在前台⇒0 且不重拉；启动器占前台⇒1 且真重拉过 4 次；同一夹具在改前形状下仍返回 0（这一刀就是把红开得了火的那一刀）"
exit "$rc"
