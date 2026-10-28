#!/usr/bin/env bash
#
# Android **设备侧**的载体入口：模拟器起在 `linux-dev` 上，本机只用它的 adb。
# =============================================================================
#
# 为什么是"转发 adb server"而不是"把每条 adb 包进 ssh"：
#   既有的设备腿脚本（`research/tools/mutation-rigs/w6-note-restore-device-arm.sh` 那一类）
#   里 adb 调用有十几处，逐条包 ssh 会把每条的退出码与输出形状都改一遍（§7 那条
#   "抽出来的收尾动作是删掉旧的那份并加门禁"的反面：抄二十遍）。转发一次端口之后
#   它们只需要一枚 `ADB_SERVER_SOCKET`，adb 子命令一个字都不用改。
#
# 用法：
#   bash scripts/android-carrier-device.sh up        # 起载体上的 AVD（幂等），打印 serial
#   bash scripts/android-carrier-device.sh tunnel    # 开本机→载体的 adb server 隧道（后台）
#   bash scripts/android-carrier-device.sh env       # 打印该 export 的那一行（给 eval）
#   bash scripts/android-carrier-device.sh status    # 载体上的设备 + 隧道在不在
#   bash scripts/android-carrier-device.sh down      # 只收**本脚本起过的那台** AVD 与隧道
#
# ⚠️ `down` 按 PID 文件与 AVD 名收，**不按名字 pkill**：这台机器上还有别的项目的模拟器
#    （litopia / ssos 各有一台在册），按 `pkill -f emulator` 会一起打掉。
# ⚠️ 装机语言由**这个包**的 per-app locale 决定（本镜像系统 locale 是 en-US）：
#      adb shell cmd locale set-app-locales com.heyta --locales zh-CN
#    漏这一步的症状是"界面读回英文"，会被误判成词条没落。
# ⚠️ 跨机服务端地址：设备在载体机上，`127.0.0.1` 在那一头指的是载体机自己；
#    模拟器里访问宿主机用 `10.0.2.2`（这条在册，见手册 §七）。

set -uo pipefail

# 载体默认值与 `scripts/lib/sync-build-sources.sh` 顶部那几行**必须逐字相同**
# （由 `check:android-gradle-remote` 的 G11 当场对账）。
HOST="${HEYTA_ANDROID_HOST:-linux-dev}"
SDK="${HEYTA_ANDROID_SDK_ON_HOST:-/home/xaiver/.local/opt/android-sdk}"
AVD="${HEYTA_ANDROID_AVD:-heyta_carrier_api36}"
LOCAL_ADB_PORT="${HEYTA_ANDROID_ADB_LOCAL_PORT:-15038}"
PIDFILE="${TMPDIR:-/tmp}/heyta-android-adb-tunnel-${LOCAL_ADB_PORT}.pid"

die() { printf '🔴 %s\n' "$1" >&2; exit 1; }

case "${1:-}" in
  up)
    # heredoc 里那一行 `emulator -avd` 是**在载体上**执行的 —— H1 的载体豁免按
    # "这一行是否处在 ssh <载体> 那枚 heredoc 的体内"判，不是按文件名放行。
    ssh -o ConnectTimeout=15 "$HOST" "AVD='$AVD' SDK='$SDK' bash -s" <<'REMOTE'
set -uo pipefail
export ANDROID_HOME="$SDK"; export ANDROID_SDK_ROOT="$SDK"
export PATH="$SDK/emulator:$SDK/platform-tools:$SDK/cmdline-tools/latest/bin:$PATH"
command -v emulator >/dev/null 2>&1 || { echo "EMULATOR=MISSING"; exit 1; }
if adb devices 2>/dev/null | grep -q 'emulator-'; then
  echo "ALREADY=ON"; adb devices | grep 'emulator-' | head -2; exit 0
fi
if ! avdmanager list avd 2>/dev/null | grep -q "Name: $AVD"; then
  avdmanager create avd -n "$AVD" -k 'system-images;android-36;google_apis;x86_64' -d pixel_5 <<< 'no' >/dev/null 2>&1 || {
    echo "AVD_CREATE=FAIL"; exit 1; }
  echo "AVD=created"
fi
nohup emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect \
  > "/tmp/heyta-${AVD}-emu.log" 2>&1 &
adb wait-for-device
S=0
for i in $(seq 1 120); do
  S=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  [ "$S" = "1" ] && break
  sleep 2
done
[ "$S" = "1" ] || { echo "BOOT=$S"; tail -5 "/tmp/heyta-${AVD}-emu.log"; exit 1; }
echo "BOOT=1 SERIAL=$(adb get-serialno | tr -d '\r') 轮询=${i}次"
REMOTE
    ;;
  tunnel)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "TUNNEL=已在位 pid=$(cat "$PIDFILE") port=$LOCAL_ADB_PORT"
      exit 0
    fi
    # -f 让 ssh 自己进后台；-N 不执行远端命令；ExitOnForwardFailure 保证
    # "端口没转成功"是一条**看得见**的失败，而不是一个连上去却读不到设备的假绿。
    ssh -f -N -o ConnectTimeout=15 -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 \
      -o ServerAliveCountMax=6 -L "${LOCAL_ADB_PORT}:127.0.0.1:5037" "$HOST" ||
      die "开不了本机 ${LOCAL_ADB_PORT} → ${HOST}:5037 的隧道（载体可达？端口被占？）"
    pgrep -f "ssh -f -N -o ConnectTimeout=15 -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=6 -L ${LOCAL_ADB_PORT}:127.0.0.1:5037" \
      > "$PIDFILE" 2>/dev/null || true
    ADB_SERVER_SOCKET="tcp:127.0.0.1:${LOCAL_ADB_PORT}" \
      adb devices 2>/dev/null | grep -q 'emulator-' ||
      echo "  ⚠️ 隧道开了但读不到设备 —— 先跑 $0 up（模拟器可能还没起）"
    echo "TUNNEL=OK port=$LOCAL_ADB_PORT"
    ;;
  env)
    echo "export ADB_SERVER_SOCKET=tcp:127.0.0.1:${LOCAL_ADB_PORT}"
    ;;
  status)
    printf '载体=%s 隧道端口=%s\n' "$HOST" "$LOCAL_ADB_PORT"
    [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null \
      && echo "TUNNEL=在位 pid=$(cat "$PIDFILE")" || echo "TUNNEL=没开"
    ADB_SERVER_SOCKET="tcp:127.0.0.1:${LOCAL_ADB_PORT}" timeout 20 adb devices 2>/dev/null | tail -n +2 | sed 's/^/  /'
    ;;
  down)
    # 🔴 只收**本脚本起过的那台**：远端按 argv 里的独有 AVD 名匹配，本机按 PID 文件收。
    #    这台载体机上还有 litopia / ssos 各一台在册模拟器，按 `pkill -f emulator` 会一起打掉。
    ssh -o ConnectTimeout=15 "$HOST" "AVD='$AVD' SDK='$SDK' bash -s" <<'REMOTE' 2>/dev/null || true
set -uo pipefail
PIDS=$(ps -eo pid,args | grep -- "-avd $AVD" | grep -v grep | awk '{print $1}')
if [ -z "$PIDS" ]; then echo "AVD=本来没在跑 $AVD"; exit 0; fi
# shellcheck disable=SC2086
kill $PIDS 2>/dev/null
sleep 5
LEFT=$(ps -eo pid,args | grep -- "-avd $AVD" | grep -v grep | awk '{print $1}')
if [ -n "$LEFT" ]; then
  # shellcheck disable=SC2086
  kill -9 $LEFT 2>/dev/null; sleep 2
fi
 STILL=$(ps -eo pid,args | grep -- "-avd $AVD" | grep -v grep | wc -l)
echo "AVD_STOPPED=$AVD 残留=$STILL"
"$SDK/platform-tools/adb" kill-server >/dev/null 2>&1 || true
REMOTE
    if [ -f "$PIDFILE" ]; then
      TP=$(cat "$PIDFILE" 2>/dev/null || true)
      [ -n "$TP" ] && kill "$TP" 2>/dev/null || true
      rm -f "$PIDFILE"
      echo "TUNNEL=收掉了${TP:+（pid=${TP}）}"
    else
      echo "TUNNEL=没有本脚本的 PID 文件，不动别人的 ssh"
    fi
    ;;
  *)
    sed -n '3,30p' "$0" | grep -E '^#( |$)' | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
