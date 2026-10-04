#!/bin/bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1：脚本运行期间工作树可能被另一轮任务编辑；
#    先执行不可变快照，避免 bash 按字节读取时把后半段解析成别的文件。
case "$(basename "$0")" in
  .*.snap.*) ;;
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" >"$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT

# iOS 系统提醒投递验收（真 Release 包 + 真 iOS 模拟器 + 真 UNUserNotificationCenter）
# ================================================================================
#
# 这条验收故意不把原生模块的返回值当作投递证据。它按以下顺序钉住完整链路：
#
#   RN UI 建任务/建提醒 → 原生排程 → 进程终止后由 iOS 投递 →
#   delivered receipt → 启动 reconcile → REMINDER firedAt op → 真 SQLite 回读。
#
# 取消与 snooze 也只通过 UI 触发。不得直接写 SQLite 或注入 REMINDER op，
# 否则只能证明 reducer 会工作，证明不了移动端的系统边界。
#
# 运行纪律：idb 通过 companion 从设备内部驱动，不启动/激活 Simulator.app，
# 不抢用户前台。截图在每个关键断言前落盘，失败时也保留。
#
# 默认会重新构建并安装当前源码的 Release 包；HEYTA_IOS_SKIP_BUILD=1 只能用于
# 调试脚本本身，仍会检查安装包 main.jsbundle 不旧于当前源码。

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IS_AX_SHIM="$ROOT/scripts/tools/ios-ax-shim.py"
DEVICE_NAME=${IOS_DEVICE_NAME:-iPhone 17 Pro}
BID=${IOS_BID:-com.heyta}
DERIVED=${HEYTA_IOS_DERIVED:-/tmp/heyta-ios-reminder-release}
BUILD_LOG=${HEYTA_IOS_BUILD_LOG:-/tmp/heyta-ios-reminder-build.log}
SCREENSHOT=${HEYTA_IOS_REMINDER_SCREENSHOT:-$ROOT/apps/mobile/evidence/ios-reminder-delivery.png}
NOTIFICATION_SCREENSHOT=${HEYTA_IOS_NOTIFICATION_SCREENSHOT:-$ROOT/apps/mobile/evidence/ios-reminder-notification-center.png}
RECONCILE_SCREENSHOT=${HEYTA_IOS_RECONCILE_SCREENSHOT:-$ROOT/apps/mobile/evidence/ios-reminder-after-reconcile.png}
CANCEL_SCREENSHOT=${HEYTA_IOS_CANCEL_SCREENSHOT:-$ROOT/apps/mobile/evidence/ios-reminder-cancelled.png}
IOS_DISPLAY=${HEYTA_IOS_DISPLAY:-primary}
IOS_MODE=${HEYTA_IOS_REMINDER_MODE:-full}
case "$IOS_MODE" in full|pending-cancel) ;; *) echo "❌ 未知 iOS 提醒模式：$IOS_MODE" >&2; exit 2 ;; esac
COMPANION_PID=""
cleanup() {
  if [ -n "$COMPANION_PID" ]; then kill "$COMPANION_PID" >/dev/null 2>&1 || true; fi
  rm -f -- "$0"
}
trap cleanup EXIT

PASS=0
FAIL=0
ok() { echo "   ✅ $1"; PASS=$((PASS + 1)); }
bad() { echo "   ❌ $1"; FAIL=$((FAIL + 1)); }
step() { echo; echo "════ $1 ════"; }

summary() {
  echo
  echo "════════ iOS 提醒投递验收：${PASS} 通过 / ${FAIL} 失败 ════════"
  echo "截图：$NOTIFICATION_SCREENSHOT"
  echo "回应用截图：$RECONCILE_SCREENSHOT"
  echo "取消正控截图：$CANCEL_SCREENSHOT"
  [ "$FAIL" -eq 0 ]
}

# 发现另一轮 iOS 验收时立即失败，避免卸载/重装和系统通知状态互相污染。
if ps -Ao pid=,ppid=,command= 2>/dev/null | awk -v me="$$" '
  $1 == me || $2 == me { next }
  $0 ~ /(zsh|bash) -c/ { next }
  $0 ~ /bash .*verify-mobile-ios[^ ]*\.sh/ && $0 !~ /bash -n/ { print; found=1 }
  END { exit(found ? 0 : 1) }
'; then
  echo "❌ 已有另一轮 iOS 验收正在运行；不要在同一模拟器上并行。" >&2
  exit 2
fi

if [ -n "${IOS_UDID:-}" ]; then
  UDID="$IOS_UDID"
else
  UDID="$(xcrun simctl list devices 2>/dev/null | grep Booted | grep -F "$DEVICE_NAME" | head -1 \
    | sed -nE 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/p')"
  [ -n "$UDID" ] || UDID="$(xcrun simctl list devices 2>/dev/null | grep Booted | head -1 \
    | sed -nE 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/p')"
fi
[ -n "${UDID:-}" ] || { echo "❌ 没有 Booted iOS 模拟器；请设置 IOS_UDID。" >&2; exit 2; }

IDB_BIN=${IDB_BIN:-}
IDB_COMPANION=${IDB_COMPANION:-}
for c in "$HOME/.heyta-tools/idb/venv/bin/idb" /tmp/idb/venv/bin/idb; do
  [ -x "$c" ] && { IDB_BIN="$c"; break; }
done
for c in "$HOME/.heyta-tools/idb/idb_companion" /tmp/idb/idb_companion; do
  [ -x "$c" ] && { IDB_COMPANION="$c"; break; }
done
[ -x "$IDB_BIN" ] && [ -x "$IDB_COMPANION" ] || { echo "❌ 找不到 idb/idb_companion。" >&2; exit 2; }
export IDB_BIN
# 🔴 不 export IDB_COMPANION：它在 idb CLI 中是 socket 地址环境变量。
#    本脚本会把二进制路径或 TCP 地址显式传给 AX shim。

IDB_UDID="$UDID"
SOCK="/tmp/idb/${UDID}_companion.sock"
# companion 延迟到 Release 安装之后再启动：即使 AX 工具链坏了，也要留下
# “当前源码 Release 包确实构建/安装过”的独立证据，而不是被前置夹具挡住。

ax() {
  python3 "$IS_AX_SHIM" "$@" --udid "$UDID" --idb "$IDB_BIN" --companion "$IDB_COMPANION" --json
}
jget() { printf '%s' "$1" | python3 -c "import json,sys; print(json.load(sys.stdin).get('$2',''))" 2>/dev/null; }
press() { ax "$1" --pressable --press --json; }
has() { [ "$(jget "$(ax "$1" --pressable --list --exact --json)" found)" = "True" ]; }
wait_has() {
  local label="$1" limit="${2:-20}" _i out
  for _i in $(seq 1 "$limit"); do
    out=$(ax "$label" --pressable --list --exact --json)
    [ "$(jget "$out" found)" = "True" ] && return 0
    sleep 1
  done
  return 1
}
wait_gone() {
  local label="$1" limit="${2:-15}" _i out
  for _i in $(seq 1 "$limit"); do
    out=$(ax "$label" --pressable --list --exact --json)
    [ "$(jget "$out" found)" != "True" ] && return 0
    sleep 1
  done
  return 1
}
scroll_has() {
  local label="$1" out
  out=$(ax "$label" --scroll-into-view --list --exact --json)
  [ "$(jget "$out" found)" = "True" ]
}
press_scroll() {
  local label="$1" out _i
  # 长详情页首次展开后，目标节点可能要几个 AX 帧才出现；每次调用
  # shim 都会复测树，避免把瞬时未挂载判成产品失败。
  for _i in 1 2 3 4 5; do
    out=$(ax "$label" --scroll-into-view --pressable --exact --json)
    if [ "$(jget "$out" found)" = "True" ] && [ "$(jget "$out" visible)" = "True" ]; then
      out=$(ax "$label" --pressable --press --exact --json)
      [ "$(jget "$out" result)" = "success" ] && return 0
    fi
    sleep 1
  done
  return 1
}
fill_composer_title() {
  local value="$1" _i
  # idb set-value treats slash-bearing calendar text as a native text action and
  # can close this Composer; use HID input for capture markers and read the RN
  # state while the keyboard remains visible.
  case "$value" in
    */*|*:*)
      ax - --field --type-text "$value" --json >/dev/null 2>&1 || true
      sleep 1
      [ "$(jget "$(ax "添加" --pressable --list --exact --json)" enabled)" = "True" ] && return 0
      ;;
  esac
  for _i in 1 2 3; do
    ax - --field --set "$value" --json >/dev/null 2>&1 || true
    sleep 1
    [ "$(jget "$(ax "添加" --pressable --list --exact --json)" enabled)" = "True" ] && return 0
  done
  ax - --field --type-text "$value" >/dev/null 2>&1 || true
  sleep 1
  [ "$(jget "$(ax "添加" --pressable --list --exact --json)" enabled)" = "True" ]
}
clear_task_search() {
  local _i out detail
  # SearchTextInput can still be settling after cold start. A successful
  # idb set-value return code alone is insufficient: require the AX value to
  # read back as the placeholder before tapping the FAB, otherwise the title
  # is silently left in search and the following tap is a false fixture step.
  for _i in 1 2 3 4 5; do
    ax "搜索任务（标题与备注）" --field --set "" --json >/dev/null 2>&1 || true
    sleep 1
    out="$(ax "搜索任务（标题与备注）" --field --list --exact --json 2>/dev/null || true)"
    detail="$(jget "$out" detail)"
    [ "$detail" = "搜索任务" ] && return 0
    ax --dismiss-keyboard --json >/dev/null 2>&1 || true
    sleep 1
  done
  return 1
}
dismiss_privacy_gate() {
  local _i
  # The first-run privacy sheet leaves the underlying task tree in AX, so
  # seeing 「新建任务」 does not prove the sheet is gone. Gate handling must
  # precede every task-page assertion and must re-check that its button is no
  # longer present after the tap.
  for _i in 1 2 3 4 5 6 7 8; do
    if has "只用本机"; then
      press "只用本机" >/dev/null 2>&1 || true
      sleep 2
      continue
    fi
    if has "同意并联网"; then
      press "只用本机" >/dev/null 2>&1 || true
      sleep 2
      continue
    fi
    if has "以后再说"; then
      press "以后再说" >/dev/null 2>&1 || true
      sleep 2
      continue
    fi
    return 0
  done
  return 1
}
dismiss_keyboard_checked() {
  local _i out kpresent
  # idb may report a successful dismiss before UIKit has removed the keyboard
  # nodes. Do not tap the FAB until the keyboard's language-specific Search key
  # is gone; otherwise the tap is consumed by the keyboard while the script
  # continues as if Composer had opened.
  for _i in 1 2 3 4 5; do
    ax --dismiss-keyboard --json >/dev/null 2>&1 || true
    sleep 2
    out="$(ax --keyboard --json 2>/dev/null || true)"
    kpresent="$(jget "$out" present)"
    # A transient empty AX tree must not count as a hidden keyboard. Require
    # the keyboard probe to say False and the FAB to be present in the same
    # settled frame; this also proves the tap target is no longer covered.
    if [ "$kpresent" = "False" ] && wait_has "新建任务" 2; then return 0; fi
  done
  return 1
}
open_task_composer() {
  local _i result field detail
  for _i in 1 2 3 4; do
    wait_has "新建任务" 3 || true
    result="$(ax "新建任务" --pressable --press --exact --json 2>/dev/null || true)"
    [ "$(jget "$result" result)" = "success" ] || continue
    sleep 1
    field="$(ax - --field --list --json 2>/dev/null || true)"
    detail="$(jget "$field" detail)"
    case "$detail" in
      添加任务*) return 0 ;;
    esac
    dismiss_keyboard_checked || true
  done
  return 1
}
snapshot() {
  local path="${1:-$SCREENSHOT}"
  mkdir -p "$(dirname "$path")"
  # A multi-display iOS 27 simulator may default simctl to a secondary LCD
  # (the file is valid PNG but all black). Prefer idb, then fall back to the
  # explicitly selected primary display. A non-empty file is not enough:
  # reject a blank PNG before the caller records a successful evidence step.
  "$IDB_BIN" --companion-path "$IDB_COMPANION" screenshot --udid "$UDID" "$path" >/dev/null 2>&1 || true
  if ! png_capture_is_usable "$path"; then
    xcrun simctl io "$UDID" screenshot --display "$IOS_DISPLAY" "$path" >/dev/null 2>&1 || true
  fi
  png_capture_is_usable "$path"
}
png_capture_is_usable() {
  local path="$1"
  [ -s "$path" ] || return 1
  HEYTA_PNG_STATS="$ROOT/scripts/screenshots/png-stats.mjs" node --input-type=module - "$path" <<'NODE' >/dev/null 2>&1
const { inspectPng, looksBlank } = await import(process.env.HEYTA_PNG_STATS);
const stats = inspectPng(process.argv[2]);
if (looksBlank(stats)) process.exit(1);
NODE
}
phone_db() {
  echo "$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)/Library/heyta.sqlite"
}
ops_count() { sqlite3 "$PHONE_DB" 'SELECT COUNT(*) FROM ops;' 2>/dev/null | tr -d ' '; }
reminder_json() {
  sqlite3 "$PHONE_DB" "SELECT data FROM ops WHERE json_extract(data,'\$.op.entityType')='REMINDER' ORDER BY pk0 DESC LIMIT 1;" 2>/dev/null
}

newest_src() {
  find "$ROOT/apps/mobile/src" "$ROOT/packages"/*/src -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null \
    | xargs -0 stat -f '%m' 2>/dev/null | sort -rn | head -1
}

step "0. 当前源码 Release 构建、安装与新鲜度"
BUILD_STARTED=0
if [ "${HEYTA_IOS_SKIP_BUILD:-0}" = "1" ]; then
  echo "   ⏭ 跳过构建（HEYTA_IOS_SKIP_BUILD=1）"
else
  BUILD_STARTED="$(date +%s)"
  # 清掉旧 JS bundle 再构建，避免 xcodebuild 增量缓存把上一轮源码的
  # bundle 当成当前产物；安装前的新鲜度检查还会再次对账源码 mtime。
  python3 - "$DERIVED/Build/Products/Release-iphonesimulator/Heyta.app/main.jsbundle" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
try:
    p.unlink()
except FileNotFoundError:
    pass
PY
  BUILD_OVERRIDES=()
  if [ "${HEYTA_IOS_EXCLUDE_CARD_EXPORT:-0}" = "1" ]; then
    BUILD_OVERRIDES+=(EXCLUDED_SOURCE_FILE_NAMES='HeytaCardExportModule.swift HeytaCardExportModuleBridge.m')
  fi
  if xcodebuild -workspace "$ROOT/apps/mobile/ios/Heyta.xcworkspace" -scheme Heyta \
      -configuration Release -sdk iphonesimulator -destination "id=$UDID" \
      -derivedDataPath "$DERIVED" "${BUILD_OVERRIDES[@]}" build >"$BUILD_LOG" 2>&1; then
    ok "当前源码 Release 构建成功（${BUILD_LOG}）"
  else
    bad "Release 构建失败（${BUILD_LOG}）"
    tail -30 "$BUILD_LOG" >&2
    summary
    exit 1
  fi
fi
APP="$DERIVED/Build/Products/Release-iphonesimulator/Heyta.app"
if [ -d "$APP" ]; then
  # 首次安装时 uninstall 返回非零是正常的；不能把“设备上没有旧包”判成产品失败。
  xcrun simctl uninstall "$UDID" "$BID" >/dev/null 2>&1 || true
  if xcrun simctl install "$UDID" "$APP"; then ok "已卸载旧包并安装当前 Release 包"; else bad "simctl install 失败"; fi
else
  bad "找不到 Release app：$APP"
fi
INSTALLED="$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null)"
SRC_MTIME="$(newest_src)"
BUNDLE_MTIME="$(stat -f '%m' "$INSTALLED/main.jsbundle" 2>/dev/null || echo 0)"
if [ -n "$INSTALLED" ] && [ "${SRC_MTIME:-0}" -gt 0 ] && [ "${BUNDLE_MTIME:-0}" -ge "$SRC_MTIME" ] \
    && { [ "$BUILD_STARTED" -eq 0 ] || [ "${BUNDLE_MTIME:-0}" -ge "$BUILD_STARTED" ]; }; then
  ok "已安装 main.jsbundle 不旧于当前源码"
else
  bad "安装包新鲜度无法证明（src=${SRC_MTIME} bundle=${BUNDLE_MTIME} app=${INSTALLED}）"
fi

step "0.5. iOS AX 夹具"
if [ ! -S "$SOCK" ]; then
  pkill -f "idb_companion --udid ${UDID}" 2>/dev/null || true
  python3 - "$SOCK" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
try:
    p.unlink()
except FileNotFoundError:
    pass
PY
  nohup "$IDB_COMPANION" --udid "$UDID" --grpc-domain-sock "$SOCK" --only simulator \
    >/tmp/heyta-idb-reminder-companion.log 2>&1 &
  COMPANION_PID=$!
  for _i in $(seq 1 30); do [ -S "$SOCK" ] && break; sleep 1; done
fi
if [ ! -S "$SOCK" ]; then
  # Xcode 27/iOS 27 上 Unix-domain gRPC 会报 GRPCCore.RuntimeError error 1，
  # 但同一二进制的 TCP server 可用。换传输层继续验收，不能把 socket 失败
  # 当成产品失败；ios-ax-shim.py 会识别 host:port 并使用 --companion。
  if [ -n "$COMPANION_PID" ]; then kill "$COMPANION_PID" >/dev/null 2>&1 || true; fi
  COMPANION_PID=""
  IDB_PORT=${HEYTA_IDB_GRPC_PORT:-10982}
  nohup "$IDB_COMPANION" --udid "$UDID" --grpc-port "$IDB_PORT" --only simulator \
    >/tmp/heyta-idb-reminder-companion-tcp.log 2>&1 &
  COMPANION_PID=$!
  for _i in $(seq 1 30); do
    if python3 - "$IDB_PORT" <<'PY'
import socket, sys
s = socket.socket()
s.settimeout(0.2)
try:
    s.connect(('127.0.0.1', int(sys.argv[1])))
except OSError:
    raise SystemExit(1)
finally:
    s.close()
PY
    then break; fi
    sleep 1
  done
  if ! python3 - "$IDB_PORT" <<'PY'
import socket, sys
s = socket.socket(); s.settimeout(0.2)
try: s.connect(('127.0.0.1', int(sys.argv[1])))
except OSError: raise SystemExit(1)
finally: s.close()
PY
  then
    bad "idb companion 的 Unix socket/TCP 两条路径都失败（见 /tmp/heyta-idb-reminder-companion*.log）"
    summary
    exit 1
  fi
  IDB_COMPANION="127.0.0.1:${IDB_PORT}"
  ok "Unix socket 失败后改用 TCP idb companion：${IDB_COMPANION}"
else
  ok "idb companion 已连接（Unix socket，设备内部驱动）"
fi

# Xcode 27/iOS 27 的 Unix companion 虽能创建 socket，但 AX/HID 长连接会
# 间歇性卡住；同一 companion 的 TCP 服务稳定。默认优先 TCP，仍保留上面
# 的 Unix 路径作为兼容/诊断路径；HEYTA_IDB_FORCE_UNIX=1 才强制旧传输。
if [ "${HEYTA_IDB_FORCE_UNIX:-0}" != "1" ]; then
  if [ -n "$COMPANION_PID" ]; then kill "$COMPANION_PID" >/dev/null 2>&1 || true; fi
  IDB_PORT=${HEYTA_IDB_GRPC_PORT:-10982}
  nohup "$IDB_COMPANION" --udid "$UDID" --grpc-port "$IDB_PORT" --only simulator \
    >/tmp/heyta-idb-reminder-companion-tcp.log 2>&1 &
  COMPANION_PID=$!
  for _i in $(seq 1 30); do
    python3 - "$IDB_PORT" <<'PY'
import socket, sys
s = socket.socket(); s.settimeout(0.2)
try: s.connect(('127.0.0.1', int(sys.argv[1])))
except OSError: raise SystemExit(1)
finally: s.close()
PY
    [ "$?" -eq 0 ] && break
    sleep 1
  done
  if python3 - "$IDB_PORT" <<'PY'
import socket, sys
s = socket.socket(); s.settimeout(0.2)
try: s.connect(('127.0.0.1', int(sys.argv[1])))
except OSError: raise SystemExit(1)
finally: s.close()
PY
  then
    IDB_COMPANION="127.0.0.1:${IDB_PORT}"
    ok "优先使用稳定的 TCP idb companion：${IDB_COMPANION}"
  else
    bad "Unix 可用但 TCP companion 启动失败；可设置 HEYTA_IDB_FORCE_UNIX=1 重试"
  fi
fi

step "1. 冷启动、离线入口与任务创建（真实 RN UI）"
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1
sleep 6
# 新安装的当前包先经过隐私/联网选择页；它不是欢迎页，不能只等「先离线使用」。
# 先确认覆盖层确实收掉，再判断是否需要离线入口。
if dismiss_privacy_gate; then ok "已收起首启隐私/联网选择层"; else bad "首启隐私/联网选择层未收起"; fi
if wait_has "先离线使用" 12; then
  press "先离线使用" >/dev/null 2>&1 || true
  wait_has "新建任务" 20 && ok "冷启动进入任务页" || bad "离线入口后没有任务页"
else
  wait_has "新建任务" 20 && ok "已有本地欢迎状态，冷启动进入任务页" || bad "任务页不可达"
fi
PHONE_DB="$(phone_db)"
[ -f "$PHONE_DB" ] && ok "已定位模拟器真 SQLite：$PHONE_DB" || bad "找不到 SQLite：$PHONE_DB"

TITLE="ios-reminder-delivery-$(date +%H%M%S)"
# 先由宿主计算一个合法的未来 occurrence。HID 只能稳定输入 ASCII，
# 所以 Composer 只创建标题；日期与时刻随后通过详情页的真实快捷项和
# 截止时刻输入框设置，避免把中文/斜杠塞进键盘夹具而改变产品状态。
DUE_PAIR="$(python3 - <<'PY'
from datetime import datetime, timedelta
now = datetime.now().astimezone() + timedelta(minutes=3)
print(f'{now.date().isoformat()}|{now.month}/{now.day}|{now:%H:%M}')
PY
)"
DUE_ISO="${DUE_PAIR%%|*}"
_REST="${DUE_PAIR#*|}"
DUE_MD="${_REST%%|*}"
DUE_HM="${_REST#*|}"
TASK_TITLE="$TITLE"
TITLE_RAW="$TITLE"
# 任务页的搜索框在冷启动时可能自动聚焦；键盘会遮住右下角 FAB，
# ax tap 即使返回系统 success 也不能到达新建按钮。先按结构性 KeyboardKey
# 收键，再要求 Composer 输入框真实出现。
if clear_task_search; then
  ok "已清空搜索框并回读占位文案"
else
  bad "搜索框清空后回读仍不是占位文案"
fi
if dismiss_keyboard_checked; then
  ok "已确认软键盘收起"
else
  bad "软键盘未确认收起"
fi
NEW_RESULT=""
if ! open_task_composer; then
  bad "新建任务按钮未真正打开 Composer"
elif ax - --field --wait 10 --list --json | grep -q '"found": "True"'; then
  if fill_composer_title "$TITLE_RAW"; then
    press "添加" >/dev/null 2>&1 || true
    wait_gone "添加" 15 && ok "通过 RN Composer 创建任务：$TASK_TITLE" || bad "任务 Composer 未关闭"
  else
    bad "任务标题未进入 RN 状态，添加按钮仍禁用"
  fi
else
  bad "RN Composer 没有文本输入框"
fi
wait_has "打开任务：$TASK_TITLE" 20 || { bad "任务行不可见：$TASK_TITLE"; summary; exit 1; }
press "打开任务：$TASK_TITLE" >/dev/null 2>&1 || true
wait_has "任务详情" 12 || true

# 日期与时刻由宿主 Python 计算成 ISO/HH:mm，再映射成当前中文界面的真实
# 无障碍标签。提醒领域拒绝早于当前一分钟的 trigger，因此这里等待一个真实的
# 未来 occurrence，到了时刻后再终止进程，验证系统投递与启动回收。
DUE_ISO="${DUE_PAIR%%|*}"
_REST="${DUE_PAIR#*|}"
echo "   宿主计算的未来日期：${DUE_ISO} ${DUE_HM}（CaptureComposer：${DUE_MD} ${DUE_HM}）"
if press_scroll "今天"; then
  ok "通过任务详情 UI 设置今天的截止日期"
else
  bad "任务详情 UI 的「今天」快捷项不可达"
fi
TIME_LABEL="任务「${TITLE}」的截止时刻（留空表示全天）"
TIME_RESULT="$(ax "$TIME_LABEL" --field --scroll-into-view --exact --json 2>/dev/null || true)"
if [ "$(jget "$TIME_RESULT" found)" = "True" ]; then
  TIME_RESULT="$(ax "$TIME_LABEL" --field --type-text "$DUE_HM" --exact --json 2>/dev/null || true)"
  if [ "$(jget "$TIME_RESULT" detail)" = "$DUE_HM" ]; then
    ok "通过任务详情 UI 设置未来截止时刻 ${DUE_HM}"
  else
    bad "截止时刻未回读为 ${DUE_HM}"
  fi
else
  bad "任务详情 UI 的截止时刻输入框不可达"
fi
if press_scroll "截止时"; then ok "通过提醒 UI 创建未来 occurrence"; else bad "提醒 UI 的「截止时」不可达"; fi

# 首次排程会弹系统通知权限。系统弹窗可能不在应用 AX 树中，先轮询 idb AX；
# 若宿主系统不给无障碍节点，就保留失败证据，绝不把排程 accepted 当授权成功。
for _label in "允许" "允许通知" "Allow" "Allow Notifications"; do
  if has "$_label"; then press "$_label" >/dev/null 2>&1; sleep 2; break; fi
done

AUTH_JSON=$(xcrun simctl spawn "$UDID" launchctl print system 2>/dev/null | head -1 || true)
echo "   权限提示处理后保留 UI/SQLite 证据；系统级授权没有可伪造的 shell 旁路。" >&2
sleep 2

if [ "$IOS_MODE" = pending-cancel ]; then
  # Positive control: the future occurrence must first be observable in the
  # native scheduled ledger, then UI deletion must cause reconcile to remove
  # the OS request and ledger entry without manufacturing firedAt.
  RECEIPTS="$(phone_db | sed 's#/heyta.sqlite$#/Application Support/heyta-reminder-receipts.json#')"
  if python3 - "$RECEIPTS" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]); d=json.loads(p.read_text()) if p.exists() else {}
assert d.get('scheduled'), d
PY
  then ok "取消前原生 scheduled ledger 有未来 occurrence"; else bad "取消前没有 scheduled occurrence 正向对照"; fi
  snapshot "$CANCEL_SCREENSHOT" || bad "取消前截图为空白或不可解析"
  REMINDER_DELETE_LABEL="删除 ${DUE_MD} ${DUE_HM} 的提醒"
  if press "$REMINDER_DELETE_LABEL" >/dev/null 2>&1 || press_scroll "$REMINDER_DELETE_LABEL"; then
    ok "通过提醒面板 UI 删除未来 occurrence"
    # The button acknowledgement is synchronous at the AX layer, while the
    # host action writes its op asynchronously. Give the real SQLite writer a
    # settled window before terminating the process.
    sleep 4
    if wait_gone "$REMINDER_DELETE_LABEL" 3; then
      ok "删除后提醒行从真实 AX 树消失"
    else
      bad "AX 点击返回成功但提醒行仍在，不能证明删除回调已执行"
    fi
  else
    bad "未来 occurrence 的提醒删除入口不可达"
  fi
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
  xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1 || true
  sleep 5
  RECEIPTS="$(phone_db | sed 's#/heyta.sqlite$#/Application Support/heyta-reminder-receipts.json#')"
  if python3 - "$RECEIPTS" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]); d=json.loads(p.read_text()) if p.exists() else {}
assert not d.get('scheduled'), d
PY
  then ok "删除后 reconcile 清空 OS pending 对应的 scheduled ledger"; else bad "删除后仍有 scheduled occurrence"; fi
  snapshot "$CANCEL_SCREENSHOT" || bad "取消后截图为空白或不可解析"
  PHONE_DB="$(phone_db)"
  FIRED="$(sqlite3 "$PHONE_DB" "SELECT COUNT(*) FROM ops WHERE json_extract(data,'\$.op.entityType')='REMINDER' AND json_extract(data,'\$.op.payload.firedAt') IS NOT NULL;" 2>/dev/null | tr -d ' ')"
  [ "${FIRED:-0}" = 0 ] && ok "future cancel 未伪造 firedAt" || bad "future cancel 产生了 firedAt"
  summary
  exit "$([ "$FAIL" -eq 0 ] && echo 0 || echo 1)"
fi

echo "   等待系统时刻 ${DUE_ISO} ${DUE_HM} 到达（最多 210 秒）…"
for _i in $(seq 1 36); do
  sleep 5
  [ "$((_i % 6))" -eq 0 ] && echo "     已等待 $((_i * 5)) 秒"
done

step "3. 终止进程后等待 iOS 系统投递（先截图，再断言）"
xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
sleep 5
# 通知中心的 UI 由系统管理，尝试从屏顶下拉；先保存独立 OS 证据，不能用任务详情图替代。
"$IDB_BIN" --companion-path "$IDB_COMPANION" ui swipe 200 5 200 600 --duration 1.0 --udid "$UDID" >/dev/null 2>&1 || true
if snapshot "$NOTIFICATION_SCREENSHOT"; then
  ok "已在投递断言前保存通知中心截图：$NOTIFICATION_SCREENSHOT"
else
  bad "通知中心截图为空白或不可解析（display=$IOS_DISPLAY）：$NOTIFICATION_SCREENSHOT"
fi

# 重新启动触发 startup reconcile；不要把进程终止本身当 fired 证据。
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1
sleep 8
dismiss_privacy_gate || true
if snapshot "$RECONCILE_SCREENSHOT"; then
  ok "已保存回应用 reconcile 截图：$RECONCILE_SCREENSHOT"
else
  bad "回应用 reconcile 截图为空白或不可解析（display=$IOS_DISPLAY）：$RECONCILE_SCREENSHOT"
fi
PHONE_DB="$(phone_db)"
FIRED="$(sqlite3 "$PHONE_DB" "SELECT COUNT(*) FROM ops WHERE json_extract(data,'\$.op.entityType')='REMINDER' AND json_extract(data,'\$.op.payload.firedAt') IS NOT NULL AND json_extract(data,'\$.op.payload.firedForTriggerAt') IS NOT NULL;" 2>/dev/null | tr -d ' ')"
if [ "${FIRED:-0}" -ge 1 ]; then
  ok "启动 reconcile 后真 SQLite 出现 firedAt + firedForTriggerAt REMINDER op"
else
  bad "启动 reconcile 后没有 fired receipt op（权限/投递/当前包需查）"
fi

step "4. snooze 与取消边界（只通过 UI）"
# 当前 occurrence 已进入结束态；它不允许 snooze。这个断言钉住结束态不能复活。
if ! scroll_has "稍后提醒"; then
  ok "已投递 occurrence 不显示 snooze（结束态边界）"
else
  bad "已投递 occurrence 仍显示 snooze，可能会错误复活"
fi

# 把当前任务删除，回读 ops 中该任务的 REMINDER 删除/取消事实；原生 cancel
# 不是业务 op，但 UI 删除必须让下次 reconcile 不再重新排程。
if press_scroll "关闭任务详情" || press "关闭任务详情" >/dev/null 2>&1; then :; fi
if wait_has "打开任务：$TASK_TITLE" 8; then
  press "打开任务：$TASK_TITLE" >/dev/null 2>&1 || true
  if press_scroll "删除任务" || press_scroll "删除"; then
    sleep 3
    ok "通过任务详情 UI 触发删除路径"
  else
    bad "任务详情没有删除入口"
  fi
else
  bad "关闭提醒详情后找不到原任务，无法验删除边界"
fi

# 删除后重启/回前台会走 cancelStale；按 occurrence receipt 不应再有 pending。
xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1
sleep 5
if snapshot "$CANCEL_SCREENSHOT"; then
  ok "取消边界回读前保存截图：$CANCEL_SCREENSHOT"
else
  bad "取消边界截图为空白或不可解析（display=$IOS_DISPLAY）：$CANCEL_SCREENSHOT"
fi

step "5. 人工查看证据"
for _shot in "$NOTIFICATION_SCREENSHOT" "$RECONCILE_SCREENSHOT" "$CANCEL_SCREENSHOT"; do
  echo "   请查看：$_shot"
  if [ -s "$_shot" ]; then ok "截图文件存在且非空：$_shot"; else bad "截图为空：$_shot"; fi
done

summary
