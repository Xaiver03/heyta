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
CANCEL_BEFORE_SCREENSHOT=${HEYTA_IOS_CANCEL_BEFORE_SCREENSHOT:-$ROOT/apps/mobile/evidence/ios-reminder-pending-before.png}
CANCEL_AFTER_DELETE_SCREENSHOT=${HEYTA_IOS_CANCEL_AFTER_DELETE_SCREENSHOT:-$ROOT/apps/mobile/evidence/ios-reminder-pending-after-delete.png}
CANCEL_AFTER_SCREENSHOT=${HEYTA_IOS_CANCEL_AFTER_SCREENSHOT:-$ROOT/apps/mobile/evidence/ios-reminder-pending-after.png}
IOS_DISPLAY=${HEYTA_IOS_DISPLAY:-primary}
IOS_MODE=${HEYTA_IOS_REMINDER_MODE:-full}
# `probe` is a read-only Release build feature. Keep it opt-in so the normal
# delivery run remains the same artifact that users would receive. The four
# boundary modes require it because a JS return value or the local ledger is
# not evidence about UNUserNotificationCenter.
case "$IOS_MODE" in
  full|pending-cancel) ;;
  permission-recovery|restart-recovery|uncertain|window) HEYTA_IOS_REMINDER_PROBE=1 ;;
  *) echo "❌ 未知 iOS 提醒模式：$IOS_MODE" >&2; exit 2 ;;
esac
MODE_BEFORE_SCREENSHOT=${HEYTA_IOS_MODE_BEFORE_SCREENSHOT:-$ROOT/apps/mobile/evidence/ios-reminder-${IOS_MODE}-before.png}
MODE_AFTER_SCREENSHOT=${HEYTA_IOS_MODE_AFTER_SCREENSHOT:-$ROOT/apps/mobile/evidence/ios-reminder-${IOS_MODE}-after.png}
WINDOW_AFTER_SCREENSHOT=${HEYTA_IOS_WINDOW_AFTER_SCREENSHOT:-$ROOT/apps/mobile/evidence/ios-reminder-window-after.png}
PROBE_PATH=""
PROBE_DELAY_MS=${HEYTA_IOS_PROBE_DELAY_MS:-500}
COMPANION_PID=""
APP_CONSOLE_PID=""
APP_CONSOLE_LOG="/tmp/heyta-ios-reminder-console.$$"
APP_CONSOLE_RC="${APP_CONSOLE_LOG}.rc"
cleanup() {
  if [ -n "$COMPANION_PID" ]; then kill "$COMPANION_PID" >/dev/null 2>&1 || true; fi
  if [ -n "$APP_CONSOLE_PID" ] && kill -0 "$APP_CONSOLE_PID" >/dev/null 2>&1; then
    kill "$APP_CONSOLE_PID" >/dev/null 2>&1 || true
  fi
  rm -f -- "$APP_CONSOLE_LOG" "$APP_CONSOLE_RC"
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

if [ -n "${IOS_UDID:-}" ]; then
  UDID="$IOS_UDID"
else
  UDID="$(xcrun simctl list devices 2>/dev/null | grep Booted | grep -F "$DEVICE_NAME" | head -1 \
    | sed -nE 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/p')"
  [ -n "$UDID" ] || UDID="$(xcrun simctl list devices 2>/dev/null | grep Booted | head -1 \
    | sed -nE 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/p')"
fi
[ -n "${UDID:-}" ] || { echo "❌ 没有 Booted iOS 模拟器；请设置 IOS_UDID。" >&2; exit 2; }

# 发现同一台 iOS 模拟器的另一轮验收时立即失败，避免卸载/重装和系统
# 通知状态互相污染。不要按脚本名全局拦截：多台专用模拟器可以并行，且
# 另一台设备的 AX companion 正在运行不应阻塞当前目标。
if ps -Ao pid=,ppid=,command= 2>/dev/null | awk -v me="$$" -v udid="$UDID" '
  $1 == me || $2 == me { next }
  $0 ~ /(zsh|bash) -c/ { next }
  $0 ~ /ios-ax-shim\.py/ && index($0, udid) { print; found=1 }
  END { exit(found ? 0 : 1) }
'; then
  echo "❌ 已有另一轮 iOS 验收正在运行于目标模拟器；不要在同一模拟器上并行。" >&2
  exit 2
fi

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
  local label="$1" occurrence="${2:-0}" out _i
  # 长详情页首次展开后，目标节点可能要几个 AX 帧才出现；每次调用
  # shim 都会复测树，避免把瞬时未挂载判成产品失败。
  for _i in 1 2 3 4 5; do
    out=$(ax "$label" --scroll-into-view --pressable --exact --occurrence "$occurrence" --json)
    if [ "$(jget "$out" found)" = "True" ] && [ "$(jget "$out" visible)" = "True" ]; then
      out=$(ax "$label" --pressable --press --exact --occurrence "$occurrence" --json)
      [ "$(jget "$out" result)" = "success" ] && return 0
    fi
    sleep 1
  done
  return 1
}
detail_marker_present() {
  local out
  out="$(ax "${TIME_LABEL:-}" --field --scroll-into-view --exact --json 2>/dev/null || true)"
  [ -n "${TIME_LABEL:-}" ] && [ "$(jget "$out" found)" = "True" ]
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
dismiss_keyboard_coaching() {
  local _label
  # A fresh simulator may show Apple's first-use QuickType coaching sheet.
  # It sits above the RN AX tree and makes the search keyboard look stuck.
  for _label in "Continue" "继续"; do
    if has "$_label"; then
      press "$_label" >/dev/null 2>&1 || true
      sleep 1
      return 0
    fi
  done
  return 0
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
idb_current() {
  # --companion-path names an executable, never a TCP endpoint. Keep direct
  # screenshot/HID calls on the same transport as the AX shim.
  case "$IDB_COMPANION" in
    *:*) "$IDB_BIN" --companion "$IDB_COMPANION" "$@" ;;
    *) "$IDB_BIN" --companion-path "$IDB_COMPANION" "$@" ;;
  esac
}
notification_title_visible() {
  # The OS AX button includes app, elapsed time and the notification body.
  # A task-detail text field with the same title is not a notification.
  idb_current ui describe-all --udid "$UDID" --json | python3 -c '
import json, sys
try:
    nodes = json.load(sys.stdin)
except (ValueError, TypeError):
    raise SystemExit(1)
if not isinstance(nodes, list):
    raise SystemExit(1)
title = sys.argv[1]
found = any(isinstance(n, dict) and n.get("type") == "Button"
    and str(n.get("AXLabel", "")).endswith(", " + title) for n in nodes)
raise SystemExit(0 if found else 1)
' "$TASK_TITLE"
}
snapshot() {
  local path="${1:-$SCREENSHOT}"
  mkdir -p "$(dirname "$path")"
  # A multi-display iOS 27 simulator may default simctl to a secondary LCD
  # (the file is valid PNG but all black). Prefer idb, then fall back to the
  # explicitly selected primary display. A non-empty file is not enough:
  # reject a blank PNG before the caller records a successful evidence step.
  # A failed capture must not pass by inspecting a previous run's PNG.
  rm -f -- "$path"
  idb_current screenshot --udid "$UDID" "$path" >/dev/null 2>&1 || true
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
probe_path() {
  local container
  container="$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null || true)"
  # simctl returns the app's Data container root; Application Support lives
  # below Library, just like the production reminder ledger and SQLite file.
  # Keep this path derived from the container instead of guessing a sandbox
  # sibling, otherwise a probe can log success while the polling loop watches
  # a file that can never exist.
  [ -n "$container" ] && printf '%s/Library/Application Support/heyta-reminder-probe.json\n' "$container"
}
run_probe() {
  local delay="${1:-$PROBE_DELAY_MS}" path _i
  PROBE_PATH="$(probe_path)"
  [ -n "$PROBE_PATH" ] || return 1
  rm -f -- "$PROBE_PATH"
  # The probe is started as a fresh process so its snapshot is taken after the
  # OS has settled. It only calls get* APIs and writes a diagnostic file; it
  # never schedules, removes, acknowledges, or writes an op.
  xcrun simctl launch --terminate-running-process "$UDID" "$BID" \
    -HEYTA_REMINDER_PROBE "$delay" >/dev/null 2>&1 || return 1
  # iOS 27 may take ~30s to reconnect the scene/notification XPC service after
  # a simulator reboot. Five seconds falsely reported a missing snapshot even
  # though the probe later wrote it (confirmed in unified log). Keep this a
  # bounded wait, but long enough to distinguish cold launch from failure.
  # After an iOS 27 simulator reboot, the notification XPC service can be
  # available only after the app has launched once and the container has
  # unlocked.  A 120s bound was observed to expire just before the probe
  # wrote its file (the later unified log proved that the probe itself ran).
  # Keep this bounded, but allow the cold post-reboot path enough time to
  # distinguish a missing probe from a slow notification service.
  local max_wait="${HEYTA_IOS_PROBE_WAIT_SECONDS:-240}"
  for _i in $(seq 1 $((max_wait * 4))); do
    [ -s "$PROBE_PATH" ] && { cat "$PROBE_PATH"; return 0; }
    sleep 0.25
  done
  return 1
}
probe_field() {
  local field="$1" json="$2"
  printf '%s' "$json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$field" 2>/dev/null
}
window_first_pending() {
  python3 - "$1" <<'PY'
import json
import sys
from datetime import datetime

items = json.loads(sys.argv[1]).get('pending', [])
items = [(str(item.get('id')), str(item.get('triggerDate'))) for item in items]
items = [item for item in items if item[1] not in ('None', 'null', '')]
items.sort(key=lambda item: item[1])
if items:
    print(f"{items[0][0]}|{int(datetime.fromisoformat(items[0][1].replace('Z', '+00:00')).timestamp())}")
PY
}
window_matches_offset() {
  python3 - "$1" "$2" "$3" <<'PY'
import json
import sqlite3
import sys

db, raw, offset = sys.argv[1], sys.argv[2], int(sys.argv[3])
snapshot = json.loads(raw)
rows = sqlite3.connect(db).execute(
    "SELECT json_extract(data,'$.op.entityId'), json_extract(data,'$.op.payload.triggerAt') "
    "FROM ops WHERE json_extract(data,'$.op.entityType')='REMINDER' "
    "AND json_extract(data,'$.op.opType')='CRT'"
).fetchall()
ordered = [f'{entity}|{int(trigger)}' for entity, trigger in sorted(rows, key=lambda row: (int(row[1]), row[0]))]
expected = set(ordered[offset:offset + 64])
actual = {str(item['id']) for item in snapshot.get('pending', [])}
if len(actual) != 64 or len(expected) != 64 or actual != expected:
    raise SystemExit(f'offset={offset} expected={len(expected)} actual={len(actual)}')
PY
}
probe_count() {
  local field="$1" json="$2"
  printf '%s' "$json" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get(sys.argv[1], [])))' "$field" 2>/dev/null
}
probe_contains() {
  local field="$1" value="$2" json="$3"
  printf '%s' "$json" | python3 -c 'import json,sys; print("True" if sys.argv[2] in json.load(sys.stdin).get(sys.argv[1], []) else "False")' "$field" "$value" 2>/dev/null
}
sqlite_fired_count() {
  sqlite3 "$PHONE_DB" "SELECT COUNT(*) FROM ops WHERE json_extract(data,'\$.op.entityType')='REMINDER' AND json_extract(data,'\$.op.entityId')='${REMINDER_ENTITY_ID}' AND json_extract(data,'\$.op.payload.firedAt') IS NOT NULL AND json_extract(data,'\$.op.payload.firedForTriggerAt')=${REMINDER_TRIGGER_MS};" 2>/dev/null | tr -d ' '
}
deny_notification_permission() {
  local label
  # The first authorization request is the only supported way to create a
  # denied state in the simulator. Do not use TCC database writes or simctl
  # privacy shortcuts: those are not available on current iOS runtimes.
  for label in "不允许" "不允许通知" "Don't Allow" "Don’t Allow"; do
    if has "$label"; then
      press "$label" >/dev/null 2>&1 || return 1
      sleep 2
      return 0
    fi
  done
  return 1
}
restore_notification_permission() {
  local label out detail
  # Navigate the real Settings hierarchy. App-Prefs deep links are not stable
  # on iOS 27 and may leave the root page visible while returning success.
  xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null 2>&1 || return 1
  sleep 2
  for label in "App" "heyta" "通知、横幅、声音、标记"; do
    if ! press_scroll "$label"; then
      return 1
    fi
    sleep 2
  done
  out="$(ax "允许通知" --pressable --list --exact --json 2>/dev/null || true)"
  [ "$(jget "$out" found)" = "True" ] || return 1
  detail="$(jget "$out" detail)"
  if [ "$detail" != 1 ]; then
    press "允许通知" >/dev/null 2>&1 || return 1
    sleep 2
  fi
  out="$(ax "允许通知" --pressable --list --exact --json 2>/dev/null || true)"
  [ "$(jget "$out" detail)" = 1 ]
}
assert_probe_state() {
  local json="$1" auth="$2" pending="$3" delivered="$4"
  [ "$(probe_field authorization "$json")" = "$auth" ] || return 1
  [ "$(probe_count pending "$json")" = "$pending" ] || return 1
  [ "$(probe_count delivered "$json")" = "$delivered" ] || return 1
}
launch_app() {
  if [ "$IOS_MODE" = full ] && [ -z "$APP_CONSOLE_PID" ]; then
    rm -f -- "$APP_CONSOLE_LOG" "$APP_CONSOLE_RC"
    (
      xcrun simctl launch --console "$UDID" "$BID" >"$APP_CONSOLE_LOG" 2>&1
      printf '%s\n' "$?" >"$APP_CONSOLE_RC"
    ) &
    APP_CONSOLE_PID=$!
    # On this simulator runtime `simctl launch --console` prints the
    # `bundle-id: PID` line only when the console session closes. At launch
    # time, the reliable readiness signal is that the wrapper is still alive;
    # the PID line and RC are checked after terminate below.
    sleep 1
    if [ -f "$APP_CONSOLE_RC" ] || ! kill -0 "$APP_CONSOLE_PID" >/dev/null 2>&1; then
      return 1
    fi
    return 0
  fi
  xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1
}
assert_app_console_exited() {
  local _i _rc
  for _i in $(seq 1 20); do
    [ -f "$APP_CONSOLE_RC" ] && break
    sleep 0.25
  done
  if [ -f "$APP_CONSOLE_RC" ]; then
    _rc="$(cat "$APP_CONSOLE_RC" 2>/dev/null || true)"
    if [ "$_rc" = 0 ] && grep -Eq "^${BID}: [0-9]+$" "$APP_CONSOLE_LOG" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}
terminate_before_trigger() {
  local trigger_ms="$1" lead_ms=$(( ${HEYTA_IOS_TERMINATE_LEAD_SECONDS:-20} * 1000 )) now_ms remaining_ms sleep_for
  while :; do
    now_ms="$(python3 -c 'import time; print(int(time.time() * 1000))')"
    remaining_ms=$((trigger_ms - now_ms))
    [ "$remaining_ms" -le "$lead_ms" ] && break
    sleep_for=$(( (remaining_ms - lead_ms) / 1000 ))
    [ "$sleep_for" -gt 5 ] && sleep_for=5
    [ "$sleep_for" -lt 1 ] && sleep_for=1
    sleep "$sleep_for"
  done
  now_ms="$(python3 -c 'import time; print(int(time.time() * 1000))')"
  remaining_ms=$((trigger_ms - now_ms))
  if [ "$remaining_ms" -le 0 ]; then
    return 1
  fi
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || return 1
  TERMINATED_AT_MS="$(python3 -c 'import time; print(int(time.time() * 1000))')"
  if [ -n "$APP_CONSOLE_PID" ] && ! assert_app_console_exited; then
    return 1
  fi
  echo "   进程已在 trigger 前终止（剩余 ${remaining_ms}ms；console 会话已退出）"
  while :; do
    now_ms="$(python3 -c 'import time; print(int(time.time() * 1000))')"
    remaining_ms=$((trigger_ms - now_ms))
    [ "$remaining_ms" -le 0 ] && break
    if [ "$remaining_ms" -gt 5000 ]; then sleep 5
    elif [ "$remaining_ms" -gt 1000 ]; then sleep 1
    else sleep 0.1
    fi
  done
  TRIGGER_WAITED_AT_MS="$(python3 -c 'import time; print(int(time.time() * 1000))')"
}
shutdown_before_trigger() {
  local trigger_ms="$1" lead_ms=$(( ${HEYTA_IOS_TERMINATE_LEAD_SECONDS:-20} * 1000 )) now_ms remaining_ms sleep_for
  while :; do
    now_ms="$(python3 -c 'import time; print(int(time.time() * 1000))')"
    remaining_ms=$((trigger_ms - now_ms))
    [ "$remaining_ms" -le "$lead_ms" ] && break
    sleep_for=$(( (remaining_ms - lead_ms) / 1000 ))
    [ "$sleep_for" -gt 5 ] && sleep_for=5
    [ "$sleep_for" -lt 1 ] && sleep_for=1
    sleep "$sleep_for"
  done
  now_ms="$(python3 -c 'import time; print(int(time.time() * 1000))')"
  remaining_ms=$((trigger_ms - now_ms))
  [ "$remaining_ms" -gt 0 ] || return 1
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || return 1
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || return 1
  echo "   设备已在 trigger 前关机（剩余 ${remaining_ms}ms），保持关机跨过 occurrence"
  while :; do
    now_ms="$(python3 -c 'import time; print(int(time.time() * 1000))')"
    remaining_ms=$((trigger_ms - now_ms))
    [ "$remaining_ms" -le 0 ] && break
    if [ "$remaining_ms" -gt 5000 ]; then sleep 5
    elif [ "$remaining_ms" -gt 1000 ]; then sleep 1
    else sleep 0.1
    fi
  done
  TRIGGER_WAITED_AT_MS="$(python3 -c 'import time; print(int(time.time() * 1000))')"
  xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || return 1
  echo "   设备已重新启动（boot 后 ${TRIGGER_WAITED_AT_MS}，未改动模拟器时钟）"
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
  # macOS 自带 Bash 3.2 在 `set -u` 下展开空数组会直接报
  # unbound variable；用单个可选参数保持默认构建路径可移植。
  BUILD_OVERRIDE=""
  if [ "${HEYTA_IOS_EXCLUDE_CARD_EXPORT:-0}" = "1" ]; then
    BUILD_OVERRIDE="EXCLUDED_SOURCE_FILE_NAMES=HeytaCardExportModule.swift HeytaCardExportModuleBridge.m"
  fi
  PROBE_BUILD_OVERRIDE=""
  if [ "${HEYTA_IOS_REMINDER_PROBE:-0}" = "1" ]; then
    PROBE_BUILD_OVERRIDE=1
  fi
  if [ -n "$BUILD_OVERRIDE" ] && [ -n "$PROBE_BUILD_OVERRIDE" ]; then
    xcodebuild -workspace "$ROOT/apps/mobile/ios/Heyta.xcworkspace" -scheme Heyta \
      -configuration Release -sdk iphonesimulator -destination "id=$UDID" \
      -derivedDataPath "$DERIVED" "$BUILD_OVERRIDE" \
      SWIFT_ACTIVE_COMPILATION_CONDITIONS='RELEASE HEYTA_REMINDER_PROBE' build >"$BUILD_LOG" 2>&1
  elif [ -n "$BUILD_OVERRIDE" ]; then
    xcodebuild -workspace "$ROOT/apps/mobile/ios/Heyta.xcworkspace" -scheme Heyta \
      -configuration Release -sdk iphonesimulator -destination "id=$UDID" \
      -derivedDataPath "$DERIVED" "$BUILD_OVERRIDE" build >"$BUILD_LOG" 2>&1
  elif [ -n "$PROBE_BUILD_OVERRIDE" ]; then
    xcodebuild -workspace "$ROOT/apps/mobile/ios/Heyta.xcworkspace" -scheme Heyta \
      -configuration Release -sdk iphonesimulator -destination "id=$UDID" \
      -derivedDataPath "$DERIVED" \
      SWIFT_ACTIVE_COMPILATION_CONDITIONS='RELEASE HEYTA_REMINDER_PROBE' build >"$BUILD_LOG" 2>&1
  else
    xcodebuild -workspace "$ROOT/apps/mobile/ios/Heyta.xcworkspace" -scheme Heyta \
      -configuration Release -sdk iphonesimulator -destination "id=$UDID" \
      -derivedDataPath "$DERIVED" build >"$BUILD_LOG" 2>&1
  fi
  if [ "$?" -eq 0 ]; then
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
  if [ "$IOS_MODE" = window ] && [ "${HEYTA_IOS_WINDOW_PRESERVE_DATA:-0}" = 1 ]; then
    echo "   保留 window fixture 的现有应用数据（HEYTA_IOS_WINDOW_PRESERVE_DATA=1）"
  else
    xcrun simctl uninstall "$UDID" "$BID" >/dev/null 2>&1 || true
  fi
  if xcrun simctl install "$UDID" "$APP"; then ok "已卸载旧包并安装当前 Release 包"; else bad "simctl install 失败"; fi
else
  bad "找不到 Release app：$APP"
fi
INSTALLED="$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null)"
SRC_MTIME="$(newest_src)"
BUNDLE_MTIME="$(stat -f '%m' "$INSTALLED/main.jsbundle" 2>/dev/null || echo 0)"
BUILT_BUNDLE_SHA="$(shasum -a 256 "$APP/main.jsbundle" 2>/dev/null | awk '{print $1}')"
INSTALLED_BUNDLE_SHA="$(shasum -a 256 "$INSTALLED/main.jsbundle" 2>/dev/null | awk '{print $1}')"
if [ "$BUILD_STARTED" -gt 0 ] && [ -n "$BUILT_BUNDLE_SHA" ] && [ "$BUILT_BUNDLE_SHA" = "$INSTALLED_BUNDLE_SHA" ]; then
  ok "已安装 main.jsbundle 与本轮 Release 构建产物 hash 一致"
elif [ "$BUILD_STARTED" -eq 0 ] && [ -n "$INSTALLED" ] && [ "${SRC_MTIME:-0}" -gt 0 ] \
    && [ "${BUNDLE_MTIME:-0}" -ge "$SRC_MTIME" ]; then
  ok "已安装 main.jsbundle 不旧于当前源码"
else
  bad "安装包新鲜度无法证明（src=${SRC_MTIME} bundle=${BUNDLE_MTIME} built=${BUILT_BUNDLE_SHA} installed=${INSTALLED_BUNDLE_SHA} app=${INSTALLED}）"
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
if launch_app; then :; else bad "App console 会话未能建立，无法证明进程终止"; summary; exit 1; fi
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

if [ "$IOS_MODE" = window ]; then
  # The 65-request case is fixture-backed. Creating 65 reminders by writing
  # SQLite or injecting REMINDER ops would test the wrong boundary; the
  # fixture must have arrived through the normal authenticated sync path.
  if [ "${HEYTA_IOS_WINDOW_PRESERVE_DATA:-0}" != 1 ]; then
    bad "window 模式必须设置 HEYTA_IOS_WINDOW_PRESERVE_DATA=1，保留真实同步夹具"
    echo "   先用 Node host/真实 HTTP 同步至少 65 条 REMINDER CRT，再运行本模式。" >&2
    summary
    exit 1
  fi
  CRT_COUNT="$(sqlite3 "$PHONE_DB" "SELECT COUNT(*) FROM ops WHERE json_extract(data,'\$.op.entityType')='REMINDER' AND json_extract(data,'\$.op.opType')='CRT';" 2>/dev/null | tr -d ' ')"
  if [ "${CRT_COUNT:-0}" -lt 65 ]; then
    bad "真实 SQLite 中 REMINDER CRT 少于 65 条（${CRT_COUNT:-0}）"
    summary
    exit 1
  fi
  if launch_app; then sleep 6; else bad "window fixture App 无法启动"; summary; exit 1; fi
  dismiss_privacy_gate || true
  WINDOW_JSON="$(run_probe 1000 || true)"
  if [ -z "$WINDOW_JSON" ]; then
    bad "无法取得 UNUserNotificationCenter 只读快照"
  else
    WINDOW_PENDING="$(probe_count pending "$WINDOW_JSON")"
    if [ "$WINDOW_PENDING" = 64 ]; then
      ok "iOS 系统 pending 数量严格为 64"
    else
      bad "iOS 系统 pending 数量不是 64（${WINDOW_PENDING:-unknown}）"
    fi
    if python3 - "$PHONE_DB" "$WINDOW_JSON" <<'PY'
import json
import sqlite3
import sys

db, raw = sys.argv[1:]
snapshot = json.loads(raw)
rows = sqlite3.connect(db).execute(
    "SELECT json_extract(data,'$.op.entityId'), json_extract(data,'$.op.payload.triggerAt') "
    "FROM ops WHERE json_extract(data,'$.op.entityType')='REMINDER' "
    "AND json_extract(data,'$.op.opType')='CRT'"
).fetchall()
expected = {f'{entity}|{int(trigger)}' for entity, trigger in sorted(rows, key=lambda row: (int(row[1]), row[0]))[:64]}
actual = {str(item['id']) for item in snapshot.get('pending', [])}
if len(expected) != 64 or actual != expected:
    raise SystemExit(
        f'expected={len(expected)} actual={len(actual)} '
        f'missing={sorted(expected - actual)[:2]} extra={sorted(actual - expected)[:2]}'
    )
PY
    then
      ok "pending 集合正好是 SQLite 中按 triggerAt 排序的最早 64 个 occurrence"
    else
      bad "pending 集合不是最早 64 个 occurrence"
    fi
    if snapshot "$MODE_BEFORE_SCREENSHOT"; then
      ok "window 初始 64 条已保存固定截图：$MODE_BEFORE_SCREENSHOT"
    else
      bad "window 初始截图为空白或不可解析：$MODE_BEFORE_SCREENSHOT"
    fi
    ROLL_INFO="$(window_first_pending "$WINDOW_JSON" || true)"
    ROLL_FIRST_ID="${ROLL_INFO%%|*}"
    ROLL_FIRST_EPOCH="${ROLL_INFO#*|}"
    if [ -n "$ROLL_FIRST_ID" ] && [ "${ROLL_FIRST_EPOCH:-0}" -gt 0 ]; then
      echo "   等待最早 pending occurrence 到期以触发窗口滚动：$ROLL_FIRST_ID"
      for _i in $(seq 1 "${HEYTA_IOS_WINDOW_ROLL_WAIT_SECONDS:-300}"); do
        NOW_EPOCH="$(date +%s)"
        [ "$NOW_EPOCH" -ge "$ROLL_FIRST_EPOCH" ] && break
        sleep 1
      done
      NOW_EPOCH="$(date +%s)"
      if [ "$NOW_EPOCH" -lt "$ROLL_FIRST_EPOCH" ]; then
        bad "window 最早 occurrence 在等待窗口内未到期"
      else
        xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
        xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1 || true
        sleep 8
        WINDOW_ROLLED_JSON="$(run_probe 1000 || true)"
        if [ -n "$WINDOW_ROLLED_JSON" ]; then
          if window_matches_offset "$PHONE_DB" "$WINDOW_ROLLED_JSON" 1; then
            ok "最早 occurrence 到期并完成窗口滚动：第 65 条进入 pending"
          else
            bad "窗口滚动后 pending 没有移除最早 occurrence 并补入下一条"
          fi
          if snapshot "$WINDOW_AFTER_SCREENSHOT"; then
            ok "window 滚动后已保存固定截图：$WINDOW_AFTER_SCREENSHOT"
          else
            bad "window 滚动后截图为空白或不可解析：$WINDOW_AFTER_SCREENSHOT"
          fi
        else
          bad "窗口滚动后无法取得 OS 快照"
        fi
      fi
    else
      bad "初始 pending 没有可解析的 triggerDate，无法做真实窗口滚动"
    fi
  fi
  echo "   window 模式只读快照：$PROBE_PATH"
  summary
  exit "$([ "$FAIL" -eq 0 ] && echo 0 || echo 1)"
fi

# The notification-center assertion is title-bound. Include the shell PID so a
# rapid rerun cannot match a same-second notification left by the previous run.
# Do not use BSD `date +%N`: macOS does not provide nanoseconds there.
TITLE="ios-reminder-delivery-$(date +%H%M%S)-$$"
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
dismiss_keyboard_coaching
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
TASK_ENTITY_ID="$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.entityId') FROM ops WHERE json_extract(data,'\$.op.entityType')='TASK' AND json_extract(data,'\$.op.opType')='CRT' AND json_extract(data,'\$.op.payload.title')='${TASK_TITLE}' ORDER BY pk0 DESC LIMIT 1;" 2>/dev/null | tr -d '\n')"
if [ -n "$TASK_ENTITY_ID" ]; then
  ok "真 SQLite 回读本轮任务 entityId：${TASK_ENTITY_ID}"
else
  bad "真 SQLite 没有本轮任务 CRT，不能绑定提醒 occurrence"
  summary
  exit 1
fi

# 日期与时刻由宿主 Python 计算成 ISO/HH:mm，再映射成当前中文界面的真实
# 无障碍标签。提醒领域拒绝早于当前一分钟的 trigger，因此这里等待一个真实的
# 未来 occurrence，到了时刻后再终止进程，验证系统投递与启动回收。
DUE_ISO="${DUE_PAIR%%|*}"
_REST="${DUE_PAIR#*|}"
echo "   宿主计算的未来日期：${DUE_ISO} ${DUE_HM}（CaptureComposer：${DUE_MD} ${DUE_HM}）"
# 任务详情有两张 DatePicker：第 0 个「今天」属于截止日期，第 1 个属于
# 排期起点。显式选第 0 个，不能让滚动后第一个节点暂时离树导致 shim 改按
# 第二张或把重复标签误报成不可达。
if press_scroll "今天" 0; then
  ok "通过任务详情 UI 设置今天的截止日期"
else
  bad "任务详情 UI 的「今天」快捷项不可达"
fi
TIME_LABEL="任务「${TITLE}」的截止时刻（留空表示全天）"
TIME_RESULT="$(ax "$TIME_LABEL" --field --scroll-into-view --exact --json 2>/dev/null || true)"
if [ "$(jget "$TIME_RESULT" found)" = "True" ]; then
  # 这是普通 TextInput，不是 secure field：set-value 会直接触发 RN 的
  # onChangeText；HID type-text 在 iOS 27 的时刻栏可能只改变键盘/AX 草稿，
  # 不提交领域状态。写入后仍必须重新拉树回读，不能信任 idb 的 rc。
  ax "$TIME_LABEL" --field --set "$DUE_HM" --exact --json >/dev/null 2>&1 || true
  sleep 1
  TIME_RESULT="$(ax "$TIME_LABEL" --field --list --exact --json 2>/dev/null || true)"
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
if [ "$IOS_MODE" = permission-recovery ]; then
  if deny_notification_permission; then
    ok "permission-recovery 首次授权弹窗选择拒绝"
  else
    bad "permission-recovery 未找到首次授权弹窗的拒绝按钮"
  fi
else
  for _label in "允许" "允许通知" "Allow" "Allow Notifications"; do
    if has "$_label"; then press "$_label" >/dev/null 2>&1; sleep 2; break; fi
  done
fi

AUTH_JSON=$(xcrun simctl spawn "$UDID" launchctl print system 2>/dev/null | head -1 || true)
echo "   权限提示处理后保留 UI/SQLite 证据；系统级授权没有可伪造的 shell 旁路。" >&2
sleep 2

# The reducer's persisted CRT is the source of truth for the actual occurrence
# being tested. Do not derive the killed-process deadline from the input string:
# read the target entity and triggerAt back from the real SQLite op.
REMINDER_ENTITY_ID=""
REMINDER_TRIGGER_MS=""
for _i in $(seq 1 10); do
  REMINDER_ENTITY_ID="$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.entityId') FROM ops WHERE json_extract(data,'\$.op.entityType')='REMINDER' AND json_extract(data,'\$.op.opType')='CRT' AND json_extract(data,'\$.op.payload.taskId')='${TASK_ENTITY_ID}' ORDER BY pk0 DESC LIMIT 1;" 2>/dev/null | tr -d '\n')"
  REMINDER_TRIGGER_MS="$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.payload.triggerAt') FROM ops WHERE json_extract(data,'\$.op.entityId')='${REMINDER_ENTITY_ID}' AND json_extract(data,'\$.op.opType')='CRT' ORDER BY pk0 DESC LIMIT 1;" 2>/dev/null | tr -d '\n')"
  [ -n "$REMINDER_ENTITY_ID" ] && [[ "$REMINDER_TRIGGER_MS" =~ ^[0-9]+$ ]] && break
  sleep 1
done
case "$REMINDER_ENTITY_ID" in
  "${TASK_ENTITY_ID}:") : ;;
  "${TASK_ENTITY_ID}:"*) : ;;
  *) REMINDER_ENTITY_ID="" ;;
esac
if [ -n "$REMINDER_ENTITY_ID" ] && [[ "$REMINDER_TRIGGER_MS" =~ ^[0-9]+$ ]]; then
  ok "真 SQLite 回读提醒 occurrence：${REMINDER_ENTITY_ID}，triggerAt=${REMINDER_TRIGGER_MS}"
else
  bad "真 SQLite 没有可验证的 REMINDER CRT/triggerAt"
  summary
  exit 1
fi

if [ "$IOS_MODE" = permission-recovery ] || [ "$IOS_MODE" = restart-recovery ]; then
  step "2. ${IOS_MODE}：跨过 trigger 后只用真实 OS 状态判定恢复"
  if [ "$IOS_MODE" = permission-recovery ]; then
    PRE_TRIGGER_JSON="$(run_probe 500 || true)"
    if [ -n "$PRE_TRIGGER_JSON" ] && [ "$(probe_field authorization "$PRE_TRIGGER_JSON")" = denied ]; then
      ok "只读 OS 快照确认通知权限为 denied"
    else
      bad "只读 OS 快照没有确认 denied 权限"
    fi
  fi
  TRIGGER_NOW_MS="$(python3 -c 'import time; print(int(time.time() * 1000))')"
  if [ "$REMINDER_TRIGGER_MS" -le "$TRIGGER_NOW_MS" ]; then
    bad "恢复模式的 SQLite triggerAt 已经过期，拒绝用过期夹具判定"
    summary
    exit 1
  fi
  if [ "$IOS_MODE" = restart-recovery ]; then
    if shutdown_before_trigger "$REMINDER_TRIGGER_MS"; then
      ok "已在设备关机状态跨过真实 triggerAt，再重新启动"
    else
      bad "未能在设备关机状态跨过 triggerAt"
      summary
      exit 1
    fi
  else
    if terminate_before_trigger "$REMINDER_TRIGGER_MS"; then
      ok "已在真实 triggerAt 前终止 App，并等待跨过 trigger"
    else
      bad "未能在 triggerAt 前终止 App"
      summary
      exit 1
    fi
  fi
  BEFORE_RECOVERY_JSON="$(run_probe 500 || true)"
  if [ -n "$BEFORE_RECOVERY_JSON" ]; then
    [ "$(probe_count delivered "$BEFORE_RECOVERY_JSON")" = 0 ] && ok "恢复前 OS delivered 为空" || bad "恢复前 OS 已有 delivered 通知"
  else
    bad "恢复前无法读取 OS 快照"
  fi
  if snapshot "$MODE_BEFORE_SCREENSHOT"; then
    ok "恢复前已保存固定截图：$MODE_BEFORE_SCREENSHOT"
  else
    bad "恢复前截图为空白或不可解析：$MODE_BEFORE_SCREENSHOT"
  fi
  [ "$(sqlite_fired_count)" = 0 ] && ok "跨过 trigger 前未伪造 firedAt" || bad "跨过 trigger 后已有 firedAt"
  # run_probe deliberately leaves its probe process alive so the delayed file
  # cannot be mistaken for a stale artifact. Stop that read-only process before
  # starting the real RN app for recovery.
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
  if [ "$IOS_MODE" = permission-recovery ]; then
    if restore_notification_permission; then
      ok "通过系统设置真实恢复通知权限"
    else
      bad "无法在系统设置中恢复通知权限；不能把授权状态单独当作恢复通过"
      summary
      exit 1
    fi
  fi
  xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1 || {
    bad "恢复阶段无法启动 App"; summary; exit 1;
  }
  sleep 8
  # Startup reconcile may schedule a missed occurrence for immediate delivery,
  # but iOS can publish that request after the first probe snapshot.  Poll the
  # OS boundary first; the probe itself is deliberately non-RN and must not be
  # treated as the process that writes the fired op.
  AFTER_RECOVERY_JSON=""
  for _i in $(seq 1 12); do
    AFTER_RECOVERY_JSON="$(run_probe 500 || true)"
    if [ -n "$AFTER_RECOVERY_JSON" ] && [ "$(probe_contains delivered "${REMINDER_ENTITY_ID}|${REMINDER_TRIGGER_MS}" "$AFTER_RECOVERY_JSON")" = "True" ]; then
      ok "恢复后 OS delivered 已出现目标 occurrence"
      break
    fi
    sleep 5
  done
  if [ -n "$AFTER_RECOVERY_JSON" ]; then
    if [ "$(probe_field authorization "$AFTER_RECOVERY_JSON")" = granted ]; then
      ok "恢复后只读 OS 快照确认权限 granted"
    else
      bad "恢复后 OS 快照没有确认 granted 权限"
    fi
  else
    bad "恢复后无法取得只读 OS 快照"
  fi
  if snapshot "$MODE_AFTER_SCREENSHOT"; then
    ok "恢复后已保存固定截图：$MODE_AFTER_SCREENSHOT"
  else
    bad "恢复后截图为空白或不可解析：$MODE_AFTER_SCREENSHOT"
  fi
  # run_probe terminates the RN process by design. Once the OS has delivered
  # the request, launch the production app again so its normal reconcile pass
  # can consume the receipt and write the single firedAt op.
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
  xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1 || true
  PHONE_DB="$(phone_db)"
  FIRED=""
  for _i in $(seq 1 30); do
    FIRED="$(sqlite_fired_count)"
    [ "${FIRED:-0}" -ge 1 ] && break
    sleep 2
  done
  if [ "${FIRED:-0}" -ge 1 ]; then
    ok "恢复后真 SQLite 有目标 occurrence 的 firedAt + exact firedForTriggerAt"
  else
    bad "恢复后没有目标 occurrence 回执"
  fi
  summary
  exit "$([ "$FAIL" -eq 0 ] && echo 0 || echo 1)"
fi

if [ "$IOS_MODE" = uncertain ]; then
  step "2. uncertain：清除系统通知后保留不确定视图"
  TRIGGER_NOW_MS="$(python3 -c 'import time; print(int(time.time() * 1000))')"
  if [ "$REMINDER_TRIGGER_MS" -le "$TRIGGER_NOW_MS" ]; then
    bad "uncertain 模式的 SQLite triggerAt 已经过期"
    summary
    exit 1
  fi
  if terminate_before_trigger "$REMINDER_TRIGGER_MS"; then
    ok "已在 triggerAt 前终止 App，并等待自然投递"
  else
    bad "未能在 triggerAt 前终止 App"
    summary
    exit 1
  fi
  # Bring up the real notification center, then clear the current notification
  # through its OS button. If the runtime exposes no clear control, fail closed
  # instead of converting a visible notification into an uncertain receipt.
  idb_current ui swipe 180 1 180 600 --duration 1.0 --udid "$UDID" >/dev/null 2>&1 || true
  sleep 2
  CLEARED=0
  for _label in "清除" "Clear" "清除全部" "Clear All"; do
    if has "$_label"; then
      press "$_label" >/dev/null 2>&1 && CLEARED=1 && break
    fi
  done
  if [ "$CLEARED" = 1 ]; then
    ok "通过系统通知中心清除本轮通知"
  else
    bad "系统通知中心没有可点击的清除按钮"
    summary
    exit 1
  fi
  if snapshot "$MODE_BEFORE_SCREENSHOT"; then
    ok "清除通知后已保存固定截图：$MODE_BEFORE_SCREENSHOT"
  else
    bad "清除通知后截图为空白或不可解析：$MODE_BEFORE_SCREENSHOT"
  fi
  UNCERTAIN_JSON="$(run_probe 500 || true)"
  if [ -n "$UNCERTAIN_JSON" ] && [ "$(probe_count pending "$UNCERTAIN_JSON")" = 0 ] && [ "$(probe_count delivered "$UNCERTAIN_JSON")" = 0 ]; then
    ok "清除后 OS snapshot 同时没有 pending/delivered"
  else
    bad "清除后 OS snapshot 仍有通知状态，不能判定 uncertain"
  fi
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
  xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1 || {
    bad "无法启动正常 RN App 读取不确定投递视图"; summary; exit 1;
  }
  sleep 8
  PHONE_DB="$(phone_db)"
  [ "$(sqlite_fired_count)" = 0 ] && ok "不确定回执没有伪造 firedAt" || bad "不确定回执产生了 firedAt"
  if has "无法确认本机是否已提醒" || has "Delivery on this device is unconfirmed"; then
    ok "启动后 UI 显示不确定投递说明"
  else
    bad "启动后 UI 没有显示不确定投递说明"
  fi
  if snapshot "$MODE_AFTER_SCREENSHOT"; then
    ok "不确定视图已保存固定截图：$MODE_AFTER_SCREENSHOT"
  else
    bad "不确定视图截图为空白或不可解析：$MODE_AFTER_SCREENSHOT"
  fi
  summary
  exit "$([ "$FAIL" -eq 0 ] && echo 0 || echo 1)"
fi

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
  if detail_marker_present; then
    ok "取消前截图确认仍在本轮任务详情（截止时刻字段可回读）"
  else
    bad "取消前截图缺少本轮任务详情标记"
  fi
  snapshot "$CANCEL_BEFORE_SCREENSHOT" || bad "取消前截图为空白或不可解析"
  # The capture input uses `10/4`, while the rendered reminder accessibility
  # label uses the zero-padded `MM-DD` formatter (`10-04`). Match the UI's
  # actual label; using the input spelling makes AX report no target and can
  # be mistaken for a failed delete implementation.
  REMINDER_LABEL_DATE="${DUE_ISO:5:2}-${DUE_ISO:8:2}"
  REMINDER_DELETE_LABEL="删除 ${REMINDER_LABEL_DATE} ${DUE_HM} 的提醒"
  # Use the scroll-aware AX path only: the plain press can report a stale
  # element success while the underlying Pressable did not receive the event.
  if press_scroll "$REMINDER_DELETE_LABEL"; then
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
    DEL_COUNT="$(sqlite3 "$PHONE_DB" "SELECT COUNT(*) FROM ops WHERE json_extract(data,'\$.op.entityType')='REMINDER' AND json_extract(data,'\$.op.opType')='DEL' AND json_extract(data,'\$.op.entityId')='${REMINDER_ENTITY_ID}';" 2>/dev/null | tr -d ' ')"
    [ "${DEL_COUNT:-0}" -ge 1 ] && ok "SQLite 有目标 occurrence 的 REMINDER DEL op" || bad "SQLite 没有目标 occurrence 的 REMINDER DEL op"
    if detail_marker_present; then
      ok "删除后截图确认仍在本轮任务详情（截止时刻字段可回读）"
    else
      bad "删除后截图缺少本轮任务详情标记"
    fi
    snapshot "$CANCEL_AFTER_DELETE_SCREENSHOT" || bad "删除后同一详情页截图为空白或不可解析"
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
  if snapshot "$CANCEL_AFTER_SCREENSHOT"; then
    cp "$CANCEL_AFTER_SCREENSHOT" "$CANCEL_SCREENSHOT"
  else
    bad "取消后截图为空白或不可解析"
  fi
  PHONE_DB="$(phone_db)"
  FIRED="$(sqlite3 "$PHONE_DB" "SELECT COUNT(*) FROM ops WHERE json_extract(data,'\$.op.entityType')='REMINDER' AND json_extract(data,'\$.op.entityId')='${REMINDER_ENTITY_ID}' AND json_extract(data,'\$.op.payload.firedAt') IS NOT NULL;" 2>/dev/null | tr -d ' ')"
  [ "${FIRED:-0}" = 0 ] && ok "future cancel 未伪造 firedAt" || bad "future cancel 产生了 firedAt"
  summary
  exit "$([ "$FAIL" -eq 0 ] && echo 0 || echo 1)"
fi

TRIGGER_NOW_MS="$(python3 -c 'import time; print(int(time.time() * 1000))')"
if [ "$REMINDER_TRIGGER_MS" -le "$TRIGGER_NOW_MS" ]; then
  bad "SQLite triggerAt 已经过期（trigger=${REMINDER_TRIGGER_MS}, now=${TRIGGER_NOW_MS}）"
  summary
  exit 1
fi
echo "   SQLite triggerAt：${REMINDER_TRIGGER_MS}（距现在 $((REMINDER_TRIGGER_MS - TRIGGER_NOW_MS))ms）"
step "2. trigger 前终止进程，再等待 iOS 自然投递"
if terminate_before_trigger "$REMINDER_TRIGGER_MS"; then
  if [ "${TERMINATED_AT_MS:-0}" -lt "$REMINDER_TRIGGER_MS" ] && [ "${TRIGGER_WAITED_AT_MS:-0}" -ge "$REMINDER_TRIGGER_MS" ]; then
    ok "已在真实 triggerAt 前终止 App（terminate=${TERMINATED_AT_MS} < trigger=${REMINDER_TRIGGER_MS}），并等待到 triggerAt=${TRIGGER_WAITED_AT_MS}"
  else
    bad "terminate 时间不早于 SQLite triggerAt，不能宣称 killed-process 投递"
    summary
    exit 1
  fi
else
  bad "未能在 triggerAt 前终止 App，不能宣称 killed-process 投递"
  summary
  exit 1
fi

step "3. 终止进程后等待 iOS 系统投递（先截图，再断言）"
# 通知中心的 UI 由系统管理，尝试从屏顶下拉；先保存独立 OS 证据，不能用任务详情图替代。
if ! idb_current ui swipe 180 1 180 600 --duration 1.0 --udid "$UDID"; then
  bad "通知中心手势失败，不能用主屏截图冒充通知中心"
fi
sleep 2
if snapshot "$NOTIFICATION_SCREENSHOT"; then
  ok "已在投递断言前保存通知中心截图：$NOTIFICATION_SCREENSHOT"
else
  bad "通知中心截图为空白或不可解析（display=${IOS_DISPLAY}）：$NOTIFICATION_SCREENSHOT"
fi
if notification_title_visible; then
  ok "系统通知 AX 包含本轮任务标题（截图仍须人工复核）"
else
  bad "系统通知 AX 没有本轮任务标题，不能以非空白截图判定投递可见"
fi

# 重新启动触发 startup reconcile；不要把进程终止本身当 fired 证据。
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1
sleep 8
dismiss_privacy_gate || true
if snapshot "$RECONCILE_SCREENSHOT"; then
  ok "已保存回应用 reconcile 截图：$RECONCILE_SCREENSHOT"
else
  bad "回应用 reconcile 截图为空白或不可解析（display=${IOS_DISPLAY}）：$RECONCILE_SCREENSHOT"
fi
PHONE_DB="$(phone_db)"
FIRED="$(sqlite3 "$PHONE_DB" "SELECT COUNT(*) FROM ops WHERE json_extract(data,'\$.op.entityType')='REMINDER' AND json_extract(data,'\$.op.entityId')='${REMINDER_ENTITY_ID}' AND json_extract(data,'\$.op.payload.firedAt') IS NOT NULL AND json_extract(data,'\$.op.payload.firedForTriggerAt')=${REMINDER_TRIGGER_MS};" 2>/dev/null | tr -d ' ')"
if [ "${FIRED:-0}" -ge 1 ]; then
  ok "启动 reconcile 后真 SQLite 在目标 occurrence 出现 firedAt + exact firedForTriggerAt"
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
  bad "取消边界截图为空白或不可解析（display=${IOS_DISPLAY}）：$CANCEL_SCREENSHOT"
fi

step "5. 人工查看证据"
for _shot in "$NOTIFICATION_SCREENSHOT" "$RECONCILE_SCREENSHOT" "$CANCEL_SCREENSHOT"; do
  echo "   请查看：$_shot"
  if [ -s "$_shot" ]; then ok "截图文件存在且非空：$_shot"; else bad "截图为空：$_shot"; fi
done

summary
