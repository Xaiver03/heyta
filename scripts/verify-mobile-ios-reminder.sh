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
# Recovery modes perform a cold OS probe and may spend time traversing Settings;
# keep the occurrence comfortably in the future while retaining a short default
# for the ordinary full journey. The value is test-only timing, never reminder
# semantics or a relaxed success condition.
# ⚠️ 这一档要盖住**拒绝态那一整段**的耗时：答弹窗（墙钟有界等待，实测最晚一次比请求晚了
# 十几分钟）→ 那一行滚进可见区并复测 → 只读探针（冷启后 usernoted 的 XPC 可能要几分钟，见 §7 #266）。
# 实测被吃到"trigger 已过期"两次：6 分钟与 8 分钟各一次（2026-10-25，两次的真因都在弹窗那侧）。
TRIGGER_OFFSET_MINUTES=${HEYTA_IOS_TRIGGER_OFFSET_MINUTES:-45}
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
  local label="$1" limit="${2:-15}" _end
  # 🔴 有界等待一律按**墙钟**算，不按轮数算：2026-10-25 这台机器上同时挂着五枚模拟器，
  # 一枚 `ax` 往返要 8~10 秒，"90 轮"实测是十几分钟 —— 既会把夹具自己拖到吃掉 trigger，
  # 又让日志上"第 N 秒"那句失真。
  _end=$(( $(date +%s) + limit ))
  while :; do
    if [ "$(jget "$(ax "$label" --pressable --list --exact --json 2>/dev/null || true)" found)" != "True" ]; then
      return 0
    fi
    [ "$(date +%s)" -ge "$_end" ] && return 1
    sleep 1
  done
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
      local scrolled="$out"
      out=$(ax "$label" --pressable --press --exact --occurrence "$occurrence" --json)
      [ "$(jget "$out" result)" = "success" ] && return 0
      # iOS Settings can reset the sidebar scroll position between two AX
      # requests. The first response is nevertheless a fresh, fully-visible
      # frame; tap that exact frame once instead of reusing an old coordinate
      # or guessing a new one. This path is still bounded by the shim's
      # on-screen geometry checks.
      local cx cy tap sx sy sw sh
      sx="$(jget "$scrolled" x)"; sy="$(jget "$scrolled" y)"
      sw="$(jget "$scrolled" width)"; sh="$(jget "$scrolled" height)"
      cx=$((sx + sw / 2)); cy=$((sy + sh / 2))
      if [ -n "$cx" ] && [ -n "$cy" ]; then
        tap="$(ax --tap "$cx" "$cy" --json 2>/dev/null || true)"
        [ "$(jget "$tap" result)" = "success" ] && return 0
      fi
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
press_or_axbridge() {  # $1=label
  # 🔴 HID 那一发**点了不等于界面收到**：2026-10-25 11:12 那一趟里，首启同意层完整渲染、
  # 「只用本机」在屏上、`press` 也回了 found=True，而八轮下来页面纹丝不动（截图 11:31 还是那一层）。
  # 同一族失法在设置页是常态（§7 #557），在 RN 侧是整机被五枚模拟器压住时的偶发。
  # 所以这里在"按完还在"时补一发**精确框中心 + axbridge**，而不是把偶发读成产品失败。
  local label="$1" out cx cy
  press "$label" >/dev/null 2>&1 || true
  has "$label" || return 0
  out="$(ax "$label" --pressable --list --exact --json 2>/dev/null || true)"
  [ "$(jget "$out" found)" = "True" ] || return 1
  cx=$(( $(jget "$out" x) + $(jget "$out" width) / 2 ))
  cy=$(( $(jget "$out" y) + $(jget "$out" height) / 2 ))
  idb_current ui tap "$cx" "$cy" --api axbridge --udid "$UDID" >/dev/null 2>&1 || true
  return 0
}
privacy_destination_visible() {
  # A fresh installation reaches Welcome before Tasks. Require an observable
  # destination and the absence of both consent actions in the settled tree.
  (has "先离线使用" || has "新建任务") &&
    ! has "只用本机" && ! has "同意并联网"
}
dismiss_privacy_gate() {
  local _i
  # The first-run privacy sheet leaves the underlying task tree in AX, so
  # seeing 「新建任务」 does not prove the sheet is gone. Gate handling must
  # precede every task-page assertion and must re-check that its button is no
  # longer present after the tap.
  for _i in 1 2 3 4 5 6 7 8; do
    if has "只用本机"; then
      press_or_axbridge "只用本机" || true
      sleep 2
      # A transient empty AX tree can make the consent button look gone while
      # the modal is still on screen. Require the destination task page in the
      # same settled window before accepting the dismissal.
      privacy_destination_visible && return 0
      continue
    fi
    if has "同意并联网"; then
      press_or_axbridge "只用本机" || true
      sleep 2
      privacy_destination_visible && return 0
      continue
    fi
    if has "以后再说"; then
      press_or_axbridge "以后再说" || true
      sleep 2
      privacy_destination_visible && return 0
      continue
    fi
    # No consent button is not enough: the page must be observable.
    privacy_destination_visible && return 0
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
    if [ -s "$PROBE_PATH" ]; then
      cat "$PROBE_PATH"
      # The probe keeps its process alive briefly after writing so the delayed
      # callback can finish. Stop that diagnostic process before the next real
      # RN launch; otherwise simctl launch may reuse it and leave a black
      # screen, making the recovery journey observe the probe rather than the
      # product.
      xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
      return 0
    fi
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
  local label hit out _round _start _wait
  # The first authorization request is the only supported way to create a
  # denied state in the simulator. Do not use TCC database writes or simctl
  # privacy shortcuts: those are not available on current iOS runtimes.
  #
  # 🔴 必须**有界地等**那枚弹窗：`requestAuthorization` 的弹窗由 usernoted 排队呈现，
  # 模拟器刚重启过的那一轮里它可以晚到几十秒（§7 #266 量过同一族延迟）。
  # 2026-10-25 就是按"按一下就该在"跑法的：`has` 只查一次就判"没找到拒绝按钮"，
  # 于是权限停在 `default`，后面那一行降级状态与 OS 快照三条一起判红 ——
  # 那是**夹具**的红，不是产品的红（截图上根本没有弹窗）。
  #
  # 🔴 反过来也红过一次，成因不同：同一天 01:49 那一趟 `press` 报了成功、函数当场 return 0，
  # 而 2a 的截图上弹窗还压着任务详情（`ios-reminder-denied-visible.png`）—— 于是三条几何判据
  # 全 `found=False`、整棵树上没有一枚 `AXUniqueId`（读的是弹窗那层窗口，不是 RN 树），
  # OS 快照也停在 `default`。**"按下过"不等于"弹窗没了"**，所以这里以弹窗消失为收口判据，
  # 没消失就换一枚 transport 重按（系统控件走 axbridge 在本脚本里已被 restore_* 验证过）。
  #
  # ⚠️ 还有第三种失法（09:16 那一趟）：弹窗**整趟压根没出现** —— 通知授权状态是系统侧的，
  # 不随 `simctl uninstall` 复位，`requestAuthorization` 直接回了已决状态。
  # 所以调用面把这条当**首选**而不是**唯一**：它失败就回落到真 Settings 开关（§7 #554）。
  for _round in 1 2 3; do
    hit=""
    # 只有第一轮值得等满（弹窗本来就晚到）；后面几轮是"按了没动"的重试，等 6s 就够。
    _wait="${HEYTA_IOS_DENY_WAIT_SECONDS:-1200}"
    [ "$_round" = 1 ] || _wait=6
    _start="$(date +%s)"
    while [ "$(date +%s)" -lt $(( _start + _wait )) ]; do
      for label in "不允许" "不允许通知" "Don't Allow" "Don’t Allow"; do
        if has "$label"; then hit="$label"; break; fi
      done
      [ -n "$hit" ] && break
      sleep 1
    done
    if [ -z "$hit" ]; then
      [ "$_round" = 1 ] && return 1
      echo "   弹窗已不再出现（第 ${_round} 轮等待 ${_wait}s 超时）—— 上一发的按下已生效" >&2
      return 0
    fi
    echo "   弹窗在第 $(( $(date +%s) - _start )) 秒出现（等待上限 ${_wait}s），第 ${_round} 次按下" >&2
    press "$hit" >/dev/null 2>&1 || true
    wait_gone "$hit" 20 && return 0
    out="$(idb_current ui tap "$hit" --api axbridge --udid "$UDID" 2>/dev/null || true)"
    wait_gone "$hit" 20 && { echo "   第一枚 transport 没按动，改走 axbridge 后弹窗已消失" >&2; return 0; }
    echo "   ⚠️ 第 ${_round} 次按下后弹窗仍在（$(printf '%s' "$out" | head -c 80)）" >&2
  done
  return 1
}
settings_press() {  # $1=label —— 设置页里的行
  # 🔴 iOS 27 的设置页**不吃 HID 坐标点**：`press_scroll` 那套（shim 的 `--press` 走坐标）
  # 在这里返回 found=True、几何也对，而页面根本不动 —— 2026-10-25 09:40 手走时现量到
  # （点 "App" 那行：`{"found":"True","visible":"True"}` 之后树里还是侧栏原样）。
  # 换成"精确框中心 + `--api axbridge`"同一枚行就进去了；而 marker 直点会把 "App"
  # 匹配到「主屏幕与App资源库」，所以坐标必须由 shim 按精确标签算出来再交给 axbridge。
  local label="$1" out cx cy _i
  for _i in 1 2 3 4 5; do
    # 🔴 取框与按下必须是**同一次精确解析**（§7 #555）：shim 的 `--scroll-into-view`
    # 内部把 `exact_only` 硬写成 False，"App" 会命中「主屏幕与App资源库」那行。
    # 所以这里只用 `--list --exact` 拿框，不在同一发里请求滚动；框不在屏上就先滚一发改**精确**重取。
    out="$(ax "$label" --pressable --list --exact --json 2>/dev/null || true)"
    if [ "$(jget "$out" found)" = "True" ]; then
      cx=$(( $(jget "$out" x) + $(jget "$out" width) / 2 ))
      cy=$(( $(jget "$out" y) + $(jget "$out" height) / 2 ))
      idb_current ui tap "$cx" "$cy" --api axbridge --udid "$UDID" >/dev/null 2>&1 || true
      sleep 2
      return 0
    fi
    idb_current ui scroll down --udid "$UDID" >/dev/null 2>&1 || true
    sleep 1
  done
  return 1
}
open_heyta_notification_settings() {
  local label out
  # Navigate the real Settings hierarchy. App-Prefs deep links are not stable
  # on iOS 27 and may leave the root page visible while returning success.
  xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null 2>&1 || return 1
  sleep 2
  # iOS 27 presents the Settings sidebar at its previous scroll offset. The
  # Apps row is below the first viewport and may not be discoverable by an AX
  # query until the sidebar has received a real downward gesture.
  for _i in 1 2 3 4 5 6 7 8; do
    idb_current ui scroll down --udid "$UDID" >/dev/null 2>&1 || true
  done
  for label in "App" "heyta"; do
    if ! settings_press "$label"; then return 1; fi
    sleep 2
  done
  # The iOS 27 Settings row is width-truncated in the AX tree on some
  # simulator sizes (`通知、关`), while older runtimes expose the full label.
  # Both labels are the same real notification settings row; accept only an
  # exact match to one of these observed labels.
  if ! settings_press "通知、横幅、声音、标记" && ! settings_press "通知、关"; then
    return 1
  fi
  sleep 2
  out="$(ax "允许通知" --pressable --list --exact --json 2>/dev/null || true)"
  [ "$(jget "$out" found)" = "True" ]
}
set_notification_switch() {  # $1 = 目标读数：1 开 / 0 关
  local want="$1" out _i
  open_heyta_notification_settings || return 1
  for _i in 1 2 3; do
    out="$(ax "允许通知" --pressable --list --exact --json 2>/dev/null || true)"
    [ "$(jget "$out" detail)" = "$want" ] && return 0
    # The Settings switch is a system AXCheckBox. HID coordinate taps return
    # rc=0 on iOS 27 but do not toggle it; use the companion's AX bridge for
    # this system control and read its value back before proceeding.
    idb_current ui tap "允许通知" --api axbridge --udid "$UDID" >/dev/null 2>&1 || return 1
    sleep 2
  done
  out="$(ax "允许通知" --pressable --list --exact --json 2>/dev/null || true)"
  [ "$(jget "$out" detail)" = "$want" ]
}
restore_notification_permission() {
  set_notification_switch 1
}
ensure_notification_denied_via_settings() {
  # 🔴 这一条**不能**从"从没问过"造出 denied：2026-10-25 09:44 现量 —— 应用已经发过请求、
  # 而弹窗还没被答（状态仍是 `notDetermined`）时，设置里的 heyta 页只有
  # Siri / 搜索 / 蜂窝数据三行，**「通知」那一组根本不挂出来**（`ui describe-all` 7 枚节点，
  # 与截图逐条对过）。所以它的适用面是"状态已决而本轮拿不到弹窗"
  # （最常见：上一趟按了「允许」，系统从此不再弹，本轮请求直接回 `granted`）。
  # 造拒绝态的正路仍然是那一次弹窗。
  #
  # 🔴 为什么原来想用它：那枚弹窗由 usernoted 排队呈现，实测最晚一次比请求晚了十几分钟
  # （§7 #554），而 2a 要证的从来是「系统当前不允许通知时，那一行在不在屏上」这个**状态**，
  # 不是「用户刚刚点了不允许」这个**动作**。全程走真设置界面，没有任何可伪造的 shell 旁路，
  # 最后仍由只读 OS 快照那一发（`authorization=denied` 那条判据）验它确实落成了 denied。
  #
  # ⚠️ 为什么先开再关而不是"看着是关就不动"：`notDetermined`（从没问过）与 `denied`
  # 在 Settings 那一枚开关上**长得一模一样**，都是关。先开（若系统肯直接放行就会变 1）
  # 再关，才能把"没决定过"变成"确实拒绝过"。开不动（读数回不来 1）就整条判失败，
  # 由调用面回落到弹窗那条路 —— 回落是**降级**，日志里会说清走的哪条。
  if set_notification_switch 1 && set_notification_switch 0; then
    return 0
  fi
  return 1
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
  # 🔴 "已经没什么可终止"不是失败，但也不能读成"我们终止了它"。
  # 只读探针那一发按设计读完快照就 terminate（否则下一发 RN 启动会复用它、留下黑屏），
  # 所以走到这里进程常常已经不在 —— 要证的从来只是**跨过 trigger 那一刻进程不在**。
  # 分三种情况各说一句：主动终止成功 / 已不在跑（说明是谁让它停的）/ 进程还在而终止失败（真失败）。
  if xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1; then
    echo "   已主动终止 App"
  elif [ "$(xcrun simctl spawn "$UDID" launchctl list 2>/dev/null | grep -c "$BID")" = "0" ]; then
    echo "   App 在本轮更早处就已不在跑（只读探针按设计终止过它）⇒ 仍满足「跨 trigger 时进程不在」"
  else
    return 1
  fi
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

# 🔴 不用 BSD 独有的 stat 那个 `-f` 形状：GNU 上它读的是**另一件事**、取到空串而不报错，
#    于是"源码比包新"那条判据会变成恒真（§7 第 364/370 条）。
#    node 两边都有，语义同一：拿 mtime 的秒。
newest_src() {
  node -e '
    const {readdirSync,statSync}=require("fs");const {join}=require("path");
    const roots=process.argv.slice(1);let max=0;
    const walk=(d)=>{for(const n of readdirSync(d,{withFileTypes:true})){const f=join(d,n.name);
      if(n.isDirectory()){walk(f);continue;}
      if(!/\.tsx?$/.test(n.name))continue;
      const m=statSync(f).mtimeMs/1000;if(m>max)max=m;}};
    for(const r of roots){try{walk(r);}catch{}}
    console.log(Math.floor(max));' "$ROOT/apps/mobile/src" "$ROOT"/packages/*/src 2>/dev/null || echo 0
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
BUNDLE_MTIME="$(node -e 'try{process.stdout.write(String(Math.floor(require("fs").statSync(process.argv[1]).mtimeMs/1000)))}catch{process.stdout.write("0")}' "$INSTALLED/main.jsbundle" 2>/dev/null || echo 0)"
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

# 🔴 上面那条是**全集**判据，而在一枚被人并行编辑的共享工作树上它赢不了赛跑 ——
# 2026-10-25 现量：09:37 / 10:38 / 10:43 / 11:03 / 11:31 一路都有人在改
# `packages/{app-host,ui,i18n,op-log}` 与 `apps/mobile`，构建窗口（这台机器上 2~60 分钟）
# 里几乎必然落进别人的编辑。所以本线那一行真正依赖的口径要**单独判**：
# 提醒面这一行所需的源码，是否全部早于装机包。别人在飞的改动不在这条判据的口径里。
FEATURE_SRC=()
for _f in packages/ui/src/reminders/ReminderList.tsx \
          apps/mobile/src/screens/TaskDetailSheet.tsx \
          apps/mobile/src/lib/reminder-delivery-display.ts \
          apps/mobile/src/lib/use-reminder-delivery.ts \
          apps/mobile/src/lib/native-reminder-scheduler.ts \
          apps/mobile/src/lib/reminder-native.ts \
          packages/i18n/src/locales/zh-CN.ts \
          packages/i18n/src/locales/en.ts; do
  [ -f "$ROOT/$_f" ] && FEATURE_SRC+=("$ROOT/$_f")
done
FEATURE_NEWEST="$(node -e 'let max=0;for(const f of process.argv.slice(1)){try{const m=require("fs").statSync(f).mtimeMs/1000;if(m>max)max=m;}catch{}}process.stdout.write(String(Math.floor(max)))' "${FEATURE_SRC[@]}" 2>/dev/null || echo 0)"
if [ "${#FEATURE_SRC[@]}" -eq 0 ]; then
  bad "本轮口径的源码清单为空 —— 判不了装机包含不含这一行，别把这条读成通过"
elif [ -n "$FEATURE_NEWEST" ] && [ "${BUNDLE_MTIME:-0}" -ge "$FEATURE_NEWEST" ]; then
  ok "提醒面这一行所需的 ${#FEATURE_SRC[@]} 枚源码全部早于装机包（最晚 $(date -r "$FEATURE_NEWEST" '+%H:%M:%S')，包 $(date -r "$BUNDLE_MTIME" '+%H:%M:%S')）"
else
  bad "装机包**不含**这一行的当前源码（最晚所需 $(date -r "${FEATURE_NEWEST:-0}" '+%H:%M:%S')，包 $(date -r "${BUNDLE_MTIME:-0}" '+%H:%M:%S')）—— 这一帧不能算当前产物的证据"
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

step "0.6. 屏幕归属预检：本轮开始前设备上不许有滞留的系统授权弹窗"
# 🔴 §7 #552 那一族的**提前判决点**：上一趟没被按掉的授权弹窗会跨 uninstall 留在这台设备上，
# 而它压在第一层之上 —— 2026-10-25 02:47 那一趟步骤 1 的六条红（首启层未收起 → 任务页不可达
# → 搜索框 → 键盘 → Composer → 任务行）真因只有这一句，而当时要等六条全红再看截图才发现。
# 判红要早、要带 cure：uninstall / killall / launchctl kickstart 都撤不掉它，只有重启设备。
STALE_ALERT=""
for _label in "不允许" "不允许通知" "Don't Allow" "Don’t Allow"; do
  if has "$_label"; then STALE_ALERT="$_label"; break; fi
done
if [ -n "$STALE_ALERT" ]; then
  bad "本轮开始前设备上滞留着一枚系统授权弹窗（命中「${STALE_ALERT}」）—— 它会吃掉后面每一次 tap"
  echo "   cure：xcrun simctl shutdown $UDID && xcrun simctl boot $UDID" >&2
  summary
  exit 1
fi
ok "屏幕归本轮所有（没有滞留的系统授权弹窗）"

# ⚠️ 这里**没有**"先用真 Settings 开关把拒绝态钉住"这一步 —— 2026-10-25 09:42 实测否证：
# 全新安装的包在**第一次真正发出请求之前**，设置里的 heyta 页只有 Siri / 搜索 / 蜂窝数据三行，
# **根本没有「通知」那一组**（`ui describe-all` 现量 7 枚节点，逐条对过截图）。
# 所以开关那条路只能在"应用已经问过"之后走（就是下面拒绝那一格里的回落），不能提前。

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
DUE_PAIR="$(python3 - "$TRIGGER_OFFSET_MINUTES" <<'PY'
import sys
from datetime import datetime, timedelta
now = datetime.now().astimezone() + timedelta(minutes=int(sys.argv[1]))
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
if press_scroll "截止时"; then
  ok "通过提醒 UI 创建未来 occurrence"
else
  bad "提醒 UI 的「截止时」不可达"
  # 判红时先分清两种失法：**树上根本没有这枚按钮**（产品/接线问题）与
  # **有，但滚不进可视区**（夹具/几何问题）。不打印这一行，下一位只能重跑一遍再猜。
  ax "截止时" --pressable --list --json 2>/dev/null | head -c 300
  echo
fi

# 首次排程会弹系统通知权限。系统弹窗可能不在应用 AX 树中，先轮询 idb AX；
# 若宿主系统不给无障碍节点，就保留失败证据，绝不把排程 accepted 当授权成功。
if [ "$IOS_MODE" = permission-recovery ]; then
  # 首选真用户那条路（答掉那枚一次性弹窗）。它一天里失过三种法（§7 #552、#554）：
  # 晚到几十秒、按下不消失、以及**晚了十几分钟**才出现在屏上（09:16 请求、09:32 才见）。
  # 所以等待按墙钟给足；等不到才回落到真 Settings 开关 —— 回落点放在这里而不是旅程之前，
  # 是因为全新安装的包在应用第一次真正发出请求之前，设置里连「通知」那一组都没有
  # （2026-10-25 09:42 现量：heyta 页只有 Siri / 搜索 / 蜂窝数据）。
  # 两条路**都不许静默**：日志必须说清这一轮的 denied 是谁给的，
  # 因为下面那条只读 OS 快照判据只认状态、不认路线。
  if deny_notification_permission; then
    DENIED_ROUTE="alert"
    ok "permission-recovery 首次授权弹窗选择拒绝"
  else
    echo "   弹窗这一轮等不到（或按不动），回落到真 Settings 的「允许通知」开关" >&2
    if ensure_notification_denied_via_settings; then
      DENIED_ROUTE="settings"
      ok "拒绝态由真 Settings 的「允许通知」开关钉住（先开再关，两次都回读过读数）"
    else
      DENIED_ROUTE=""
      bad "permission-recovery 拿不到拒绝态：弹窗没答成，Settings 回落也没把开关拨到关"
    fi
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
    # 🔴 目标 1 的界面那一半：**拒绝之后必须当场看得见**，而且当场给得出回头路。
    # 读的是设备真实 AX 树（不是 JS 返回值、也不是本地库里那条 op —— 那两样都证不了
    # 屏幕上有一行字）。必须在 `run_probe` 之前跑：那一发按设计会终止 RN 进程。
    step "2a. permission-recovery：拒绝态在提醒面上看得见，且给得出再授权入口"
    # 遮挡归因：那一枚弹窗自己就是一层窗口，它在场时下面三条几何判据必然 `found=False`
    # 且整棵树没有一枚 `AXUniqueId`（§7 #554）—— 不写这一句，读日志的人会去改产品代码。
    if has "不允许"; then
      echo "   🔴 屏幕上正压着系统授权弹窗 ⇒ 下面几条读的是弹窗那层窗口，不是 RN 树" >&2
    fi
    # 🔴 "在 AX 树上"不等于"看得见"（AGENTS §6.2 规定一）。RN 把整个 ScrollView 的
    # 内容都留在树上，所以只查 found 会抓到一屏之外的节点 —— 上一轮就是这样：
    # 三条命中全绿，而截图停在面板顶部，那一行根本不在屏上。
    # 这里要的是 shim **复测过几何**的那个 `visible=True`（中心 y 在可视区内），
    # 而且截图必须紧跟在复测之后，中间不再做任何可能把滚动位置弄回去的动作。
    notice_probe() {  # $1=needle $2=pressable(1/0) $3=tries；stdout="x y w h swipes"
      local needle="$1" kind="${2:-0}" _i out
      for _i in $(seq 1 "${3:-25}"); do
        if [ "$kind" = 1 ]; then
          out="$(ax "$needle" --pressable --scroll-into-view --json 2>/dev/null || true)"
        else
          out="$(ax "$needle" --scroll-into-view --json 2>/dev/null || true)"
        fi
        [ "$(jget "$out" found)" = "True" ] && [ "$(jget "$out" visible)" = "True" ] \
          && { printf '%s %s %s %s %s\n' "$(jget "$out" x)" "$(jget "$out" y)" "$(jget "$out" width)" "$(jget "$out" height)" "$(jget "$out" swipes)"; return 0; }
        sleep 1
      done
      return 1
    }
    CAPTION=""
    CAPTION_FRAME=""
    for _copy in "到点不会响" "will not ring"; do
      if CAPTION_FRAME="$(notice_probe "$_copy" 0)"; then CAPTION="$_copy"; break; fi
    done
    if [ -n "$CAPTION" ]; then
      ok "降级说明在提醒面上**看得见**（「${CAPTION}」，frame=${CAPTION_FRAME}）"
    else
      bad "拒绝通知后提醒面上看不见那句降级说明（found 但不在可视区也算没看见）"
      ax "到点不会响" --json 2>/dev/null | head -c 400
    fi
    ENTRY=""
    ENTRY_FRAME=""
    for _entry in "去系统设置" "Open system settings"; do
      if ENTRY_FRAME="$(notice_probe "$_entry" 1 8)"; then ENTRY="$_entry"; break; fi
    done
    if [ -n "$ENTRY" ]; then
      ok "拒绝态当场给得出跳系统设置的再授权入口（「${ENTRY}」可点且可见，frame=${ENTRY_FRAME}）"
    else
      bad "拒绝态没有可见的跳系统设置入口 —— 只说\"不会响\"而不给回头路"
    fi
    # 那一行与那一跳必须**是同一条**：入口的 y 落在说明文字那一行的带内。
    # 只各自"在屏上"不够 —— 屏上别处也可能有一枚同名按钮。
    if [ -n "$CAPTION_FRAME" ] && [ -n "$ENTRY_FRAME" ]; then
      # 🔴 两个 y 只有在**同一份滚动位置**上取到才可比。`--scroll-into-view` 会自己滚，
      # 2026-10-25 09:50 实测：说明行读到 y=718、入口读到 y=574（差 144pt 判红），
      # 而同一时刻的截图上两者只差约 30pt —— 那 144pt 是第二发读数自己滚出来的，
      # 量的是"两次滚动的差"而不是布局。shim 会把这一发真的划了几次 `swipes` 报回来，
      # 所以判据改成：**后一发没有再滚动（swipes=0）时才允许比 y**；还在动就重取一对读数。
      pair_settled=""
      for _settle in 1 2 3; do
        [ "$(printf '%s' "$ENTRY_FRAME" | cut -d' ' -f5)" = "0" ] && { pair_settled=1; break; }
        CAPTION_FRAME="$(notice_probe "$CAPTION" 0 || true)"
        ENTRY_FRAME="$(notice_probe "$ENTRY" 1 8 || true)"
        [ -n "$CAPTION_FRAME" ] && [ -n "$ENTRY_FRAME" ] || break
      done
      if [ -z "$pair_settled" ]; then
        bad "两次读数之间列表一直在滚 ⇒ 这两个 y 不可比，判不了那一行的归属（读数问题，不是布局问题）"
      else
      caption_y="$(printf '%s' "$CAPTION_FRAME" | cut -d' ' -f2)"
      entry_y="$(printf '%s' "$ENTRY_FRAME" | cut -d' ' -f2)"
      dy=$((caption_y > entry_y ? caption_y - entry_y : entry_y - caption_y))
      if [ "$dy" -le 80 ]; then
        ok "入口与那句说明在同一行带内（纵向相差 ${dy}pt ≤ 80，两次读数之间列表未再滚动）—— 这一行确实是"那句话 + 那个回头路""
      else
        bad "入口与那句说明不在同一行带内（${dy}pt）—— 不能算那一行给得出回头路"
      fi
      fi
    fi
    # 锚点（testID 通道）是第三把尺：它证明屏幕上那一枚"去系统设置"确实是共享
    # `ReminderList` 打出来的，而不是别处同名按钮。
    # 🔴 锚点必须挂在**可点元素**上：2026-10-25 实测，同一棵树上 `AXUniqueId` 通道是通的
    # （shim 没有报 `tree-has-no-AXUniqueId`），而 `reminder-delivery-blocked-text`
    # 那枚挂在 `Text` 上的 testID 取不到 —— RN 的 Text 不进这棵树。
    # 那句话的可见性由上面那条几何判据 + 截图承担，不靠这一枚。
    ANCHOR_JSON="$(ax "id:reminder-delivery-open-settings" --pressable --scroll-into-view --json 2>/dev/null || true)"
    if [ "$(jget "$ANCHOR_JSON" found)" = "True" ]; then
      ok "那一跳的锚点在本轮树里（id:reminder-delivery-open-settings，共享提醒列表内部）"
    elif [ "$(jget "$ANCHOR_JSON" detail)" = "tree-has-no-AXUniqueId" ]; then
      echo "   ⚠️ 锚点通道本轮不可用（这棵树上没有任何 AXUniqueId）⇒ 那一行的归属只由上面两条几何判据 + 截图承担"
    else
      bad "锚点通道可用而这一枚取不到 —— 那一枚入口不是共享提醒列表打出来的"
    fi
    if snapshot "$ROOT/apps/mobile/evidence/ios-reminder-denied-visible.png"; then
      ok "拒绝态截图已落盘：apps/mobile/evidence/ios-reminder-denied-visible.png"
    else
      bad "拒绝态截图为空白或不可解析"
    fi
  fi
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
  # Ensure the diagnostic process is stopped before starting the real RN app.
  # run_probe normally terminates it after reading the fresh snapshot.
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
