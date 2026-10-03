#!/bin/bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份脚本拷成同目录隐藏快照再 exec 副本 —— 之后对源文件的任何
#    编辑都影响不到本次运行；$0 的 dirname 不变，lib/tools 定位照旧。
#    快照名 .原名.snap.PID（进 .gitignore）；trap 尽力清理，被 kill -9 留下的
#    由下一次运行按 mmin +240 顺带扫掉。
case "$(basename "$0")" in
  .*.snap.*) ;; # 已是快照：正常往下跑
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT
#
# 移动端「提醒投递」验收（真模拟器，零 mock）
# ============================================
#
# 🔴 为什么必须有这个脚本
#
# 多端覆盖审计 P0-1：提醒在两端都能建（数据 op 完整、能同步），web 有到点投递
# （Notification API），移动端是纯数据 op —— **设了提醒什么都不会发生**。
# 本脚本证明：提醒到点时，OS 通知栏里出现**真的系统通知**，且这条链路
# 不依赖应用进程存活（调度在 OS 层）。
#
# ## 触发链（判据①怎么做到"~1 分钟内真响"且零 mock）
#
# 根据设备时钟/时区由宿主 Python 独立计算三分钟内的 ISO 日期与时刻。
# composer 输入后点「截止时」预设。领域层拒绝创建早于过去一分钟的提醒，
# 因此不能用昨天到期任务冒充已错过提醒；本条验证真 UI → op → 定时系统通知。
#
# ## 判据
#   ① 近未来提醒 → 应用退后台后，`dumpsys notification` 观测到真通知；
#   ② 删提醒 ⇒ 已展示的通知从通知栏消失（调度器 reconcile 含 dismiss）；
#      且未来提醒删除后 `dumpsys alarm` 里的系统调度同步消失；
#   ③ 贪睡（+10 分钟）后杀掉普通进程（不使用 force-stop）⇒ 系统仍持有 alarm 且到点投递
#      （Android force-stop 是用户明确阻断，系统会取消/阻止 receiver）；
#   ④ 点通知回应用。
#   ⑤ 变异（goal 硬规则）：拿掉调度调用 ⇒ ① 转红（台账在 goal §7）。
#
# ⚠️ 判据③要等 ~10.5 分钟（贪睡最短档），整个脚本 ~15 分钟。
#
# 用法：bash scripts/verify-mobile-reminder-ring.sh
# 前置：模拟器在跑。提醒是本地 op，本验收**不依赖服务端**（不配凭据）。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

TITLE="ring-e2e-$(date +%H%M%S)"
SNOOZE_TITLE="${TITLE}-snooze"
PKG_ACT="$PKG/"
TEST_MODE="${HEYTA_REMINDER_TEST_MODE:-full}"
case "$TEST_MODE" in full|permission-recovery|restart-recovery|pending-cancel) ;; *) echo "Unknown reminder test mode" >&2; exit 1 ;; esac

echo ""
echo "=== 移动端提醒投递验收（真实模拟器，零 mock）==="
echo "  设备: $E2E_SERIAL   任务: $TITLE"

# 🔴 本验收的隐私决定由这里点名，不让共享的欢迎页 helper 替它选（见 lib 里
#    `CONSENT_GATE_PREFERRED` 那段）。
CONSENT_GATE_PREFERRED=只用本机

dismiss_consent_if_present() {
  # 处理本身在 `lib/mobile-e2e.sh` 的 `handle_privacy_consent`（五个安卓脚本各抄一份
  # 的时代结束了 —— 抄漏那份的症状是整轮"找不到按钮"的假红）。
  # 🔴 本验收选**「只用本机」**：提醒是本地 op，不需要联网许可；替用户点「同意并联网」
  #    等于让一段本地判据的验收顺手做了一个隐私决定。
  handle_privacy_consent "只用本机" "以后再说"
  local rc=$?
  if [ "$CONSENT_GATE_SEEN" = "1" ]; then
    echo "     （提醒是本地 op，本验收不需要联网）"
  fi
  return $rc
}

# 通知栏里有没有含 $1 的**当前活动**通知。标题带时间戳
# （ring-e2e-<HHMMSS>），不会撞别的应用。
#
# `dumpsys notification` 同时输出 Notification List 与 History；对整份文本 grep
# 会把历史通知当成仍在通知栏里。独立 parser 只读活动列表，并按记录隔离包名。
has_notification() {
  local dump
  dump=$($ADB shell dumpsys notification --noredact 2>/dev/null) || return 1
  printf '%s' "$dump" | node "$HEYTA_REPO_ROOT/scripts/mobile-reminder-notification.mjs" "$PKG" "$1"
}

# Locate a notification whose content-desc contains the title. The shared mobile
# helper intentionally exposes exact `xy_desc` only; this one-off prefix lookup
# belongs to this notification-bar flow and must not become a second shared API.
xy_notification_desc_contains() {
  python3 - "$1" <<'PY'
import re
import sys

needle = sys.argv[1]
xml = open('/tmp/ui.xml', encoding='utf-8', errors='replace').read()
for match in re.finditer(r'<node[^>]*?>', xml):
    tag = match.group(0)
    desc = re.search(r'content-desc="([^"]*)"', tag)
    bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
    if desc is None or bounds is None or needle not in desc.group(1):
        continue
    x1, y1, x2, y2 = map(int, bounds.groups())
    if x2 > x1 and y2 > y1:
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
PY
}

# Resolve the installed launcher instead of using monkey: some emulator images
# abort monkey on physical-key validation without ever launching an Activity.
launch_app() {
  local component output rc
  # A previous screenshot may leave the notification shade covering the app.
  # Starting an Activity does not dismiss that system overlay.
  $ADB shell cmd statusbar collapse >/dev/null 2>&1
  component=$($ADB shell cmd package resolve-activity --brief "$PKG" | tr -d '\r' | tail -1)
  case "$component" in "$PKG/"*) ;; *) bad "无法解析已安装应用的启动 Activity"; return 1 ;; esac
  output=$($ADB shell am start -W -n "$component" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ] || printf '%s' "$output" | grep -q 'Error:'; then
    printf '%s\n' "$output" >&2
    return 1
  fi
}

# adb input text may drop characters under load, and literal shell spaces split
# its argument. Verify the real field before submitting; a successful adb exit
# is not proof that the app received the intended text.
fill_capture() {
  local want="$1" current suffix piece attempt
  for attempt in 1 2 3 4 5; do
    dump
    current=$(edit_value "新任务标题")
    [ "$current" = "$want" ] && return 0
    case "$want" in
      "$current"*) suffix="${want:${#current}}" ;;
      *)
        $ADB shell input keycombination 113 29
        $ADB shell input keyevent 67
        sleep 1
        suffix="$want"
        ;;
    esac
    # Short chunks keep React's controlled input updates from losing the tail.
    while [ -n "$suffix" ]; do
      piece="${suffix:0:4}"
      suffix="${suffix:4}"
      $ADB shell input text "${piece// /%s}"
      sleep 0.3
    done
    sleep 1
  done
  bad "新任务标题读回不匹配，拒绝提交不完整夹具"
  return 1
}

step "0. 装包并启动"
$ADB shell am force-stop "$PKG" >/dev/null 2>&1
$ADB uninstall "$PKG" >/dev/null 2>&1
INSTALL_OUTPUT=$($ADB install -r "$APK" 2>&1)
INSTALL_RC=$?
printf '%s\n' "$INSTALL_OUTPUT" | tail -1 | sed 's/^/   /'
if [ "$INSTALL_RC" -ne 0 ]; then
  echo "   ❌ 安装失败（adb install 退出码 ${INSTALL_RC}），立即终止本轮验收。" >&2
  printf '%s\n' "$INSTALL_OUTPUT" >&2
  exit "$INSTALL_RC"
fi
$ADB shell pm clear $PKG >/dev/null 2>&1
# Android 13+ 通知是运行时权限：真用户会在首启授，脚本直接授（等价于点了允许）。
$ADB shell pm grant $PKG android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 \
  && echo "   已授 POST_NOTIFICATIONS（等价于真用户点允许）" || echo "   （该系统无需运行时通知权限）"
$ADB shell appops set "$PKG" SCHEDULE_EXACT_ALARM allow || exit 1
$ADB shell am force-stop $PKG; sleep 1
launch_app || exit 1; sleep 6
dismiss_consent_if_present
dismiss_welcome_if_present
dump
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "1. 判据①触发：composer 建出「三分钟内到期」的任务"
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then
  $ADB shell input tap 108 2253; sleep 2
  XY=$(xy_desc "新建任务")
fi
if [ -z "$XY" ]; then
  bad "找不到新建按钮"; screen_txt
else
  $ADB shell input tap $XY; sleep 2.5
  dump
  XY=$(xy_edit_any)
  $ADB shell input tap $XY; sleep 1
  DEVICE_NOW=$($ADB shell date +%s | tr -d '\r')
  DEVICE_ZONE=$($ADB shell getprop persist.sys.timezone | tr -d '\r')
  NEAR_DATE=$(python3 - "$DEVICE_NOW" "$DEVICE_ZONE" <<'CLOCK'
from datetime import datetime
from zoneinfo import ZoneInfo
import sys
print(datetime.fromtimestamp(int(sys.argv[1])+180, ZoneInfo(sys.argv[2] or 'UTC')).strftime('%Y-%m-%d %H:%M'))
CLOCK
)
  fill_capture "$TITLE $NEAR_DATE" || exit 1
  dump
  XY=$(xy_desc "添加")
  [ -z "$XY" ] && XY=$(xy_text "添加")
  if [ -z "$XY" ]; then
    bad "创建前找不到添加按钮，拒绝点击空坐标"; screen_txt
    exit 1
  fi
  mkdir -p "$HEYTA_REPO_ROOT/apps/mobile/evidence"
  $ADB exec-out screencap -p > "$HEYTA_REPO_ROOT/apps/mobile/evidence/android-reminder-create.png"
  $ADB shell input tap $XY; sleep 3
fi
dump
if [ "$(has_desc "打开任务：$TITLE")" = "1" ] || [ "$(has_text "$TITLE")" = "1" ]; then
  ok "任务已创建：${TITLE}（due=${NEAR_DATE}）"
else
  bad "任务没创建"; screen_txt
  summary "移动端提醒投递" "任务创建前置失败" 1
fi

step "2. 详情 → 提醒段 → 「截止时」预设（triggerAt 为三分钟内）"
XY=$(xy_desc "打开任务：$TITLE")
[ -z "$XY" ] && XY=$(xy_text "$TITLE")
if [ -z "$XY" ]; then
  bad "打不开详情"; screen_txt
else
  $ADB shell input tap $XY; sleep 2.5
  # 滚到提醒段
  FOUND=0
  for i in $(seq 1 8); do
    dump
    XY=$(python3 /tmp/_xy.py text-sane "截止时" 0)
    if [ -n "$XY" ]; then FOUND=1; break; fi
    $ADB shell input swipe 540 1600 540 900 400; sleep 1.5
  done
  if [ "$FOUND" = "1" ]; then
    $ADB shell input tap $XY; sleep 3
    ok "已点「截止时」预设（提醒 op 已写，triggerAt=${NEAR_DATE}）"
  else
    bad "滚到底也没找到提醒预设"; screen_txt
  fi
fi

# The recovery modes reuse the exact same real UI creation path. Database
# inspection below is read-only: it never constructs an op or changes a clock.
assert_fired_receipt() {
  local expected="$1" snapshot
  snapshot=$(mktemp /tmp/heyta-reminder-receipt.XXXXXX)
  $ADB exec-out su 0 cat "/data/user/0/$PKG/databases/heyta.sqlite" > "$snapshot" || return 1
  python3 - "$snapshot" "$TITLE" "$expected" <<'RECEIPT'
import json,sqlite3,sys
with sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True) as db:
    rows=[json.loads(row[0]) for row in db.execute('select data from ops')]
ops=[row.get('op',row) for row in rows]
tasks={op['entityId'] for op in ops if op.get('entityType')=='TASK' and op.get('payload',{}).get('title')==sys.argv[2]}
reminders={op['entityId']:op['payload']['triggerAt'] for op in ops if op.get('entityType')=='REMINDER' and op.get('payload',{}).get('taskId') in tasks}
assert len(reminders)==1, 'Expected exactly one real reminder CREATE'
receipts=[op for op in ops if op.get('entityType')=='REMINDER' and op.get('entityId') in reminders and op.get('payload',{}).get('firedAt') is not None]
if sys.argv[3]=='unfired':
    assert not receipts, 'Denied/stopped notification must not create fired fact'
else:
    assert receipts, 'Delivered notification must persist a fired receipt'
    assert any(op['payload'].get('firedForTriggerAt')==reminders[op['entityId']] for op in receipts), 'Receipt must bind the current occurrence'
RECEIPT
  local result=$?
  rm -f "$snapshot"
  return "$result"
}

if [ "$TEST_MODE" = pending-cancel ]; then
  step "3. 删除尚未到期的提醒，验证系统 pending alarm 真正撤销"
  # The freshly installed app contains exactly this one reminder. Read only
  # active Alarm records, not package names in alarm history/statistics.
  pending_alarm_count() {
    $ADB shell dumpsys alarm | python3 -c '
import re,sys
pattern=r"(?m)^\s*(?:RTC_WAKEUP|RTC|ELAPSED_WAKEUP|ELAPSED)\s+#\d+: Alarm\{[^}\n]* "+re.escape(sys.argv[1])+r"\}"
print(len(re.findall(pattern,sys.stdin.read())))
' "$PKG"
  }
  COUNT=$(pending_alarm_count)
  [ "$COUNT" = 1 ] || { bad "取消前不是恰好一个 pending alarm（${COUNT}），缺正向对照"; summary "提醒取消" "" 1; }
  ok "取消前系统确实持有唯一的未来提醒 alarm"
  XY=$(scroll_to_text "删除提醒")
  [ -n "$XY" ] || { bad "找不到删除提醒按钮"; summary "提醒取消" "" 1; }
  $ADB exec-out screencap -p > "$HEYTA_REPO_ROOT/apps/mobile/evidence/android-reminder-pending-cancel-before.png"
  $ADB shell input tap $XY
  sleep 4
  COUNT=$(pending_alarm_count)
  $ADB exec-out screencap -p > "$HEYTA_REPO_ROOT/apps/mobile/evidence/android-reminder-pending-cancel-after.png"
  [ "$COUNT" = 0 ] || { bad "删除后仍有 pending alarm（${COUNT}）"; summary "提醒取消" "" 1; }
  assert_fired_receipt unfired || { bad "删除未来提醒却产生 fired"; summary "提醒取消" "" 1; }
  ok "删除后 pending alarm 消失，未伪造 fired"
  summary "未来提醒取消"
fi

if [ "$TEST_MODE" != full ]; then
  step "3. 拒绝权限或设备重启跨过触发时刻，再启动补算"
  $ADB shell input keyevent 3
  if [ "$TEST_MODE" = permission-recovery ]; then
    $ADB shell pm revoke "$PKG" android.permission.POST_NOTIFICATIONS || exit 1
  else
    # A deliberate force-stop is a user interruption, not the ordinary death
    # claim tested below. The product must recover after an explicit launch.
    $ADB shell am force-stop "$PKG" || exit 1
    $ADB reboot || exit 1
    $ADB wait-for-device || exit 1
    BOOTED=0
    for i in $(seq 1 90); do
      if [ "$($ADB shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; then BOOTED=1; break; fi
      sleep 2
    done
    [ "$BOOTED" = 1 ] || { bad "设备未完成重启"; summary "提醒恢复" "" 1; }
    $ADB shell input keyevent KEYCODE_WAKEUP
    $ADB shell wm dismiss-keyguard
  fi
  DUE_SECONDS=$(python3 - "$NEAR_DATE" "$DEVICE_ZONE" <<'DUE'
from datetime import datetime
from zoneinfo import ZoneInfo
import sys
print(int(datetime.strptime(sys.argv[1],'%Y-%m-%d %H:%M').replace(tzinfo=ZoneInfo(sys.argv[2] or 'UTC')).timestamp()))
DUE
)
  for i in $(seq 1 120); do
    [ "$($ADB shell date +%s | tr -d '\r')" -ge "$((DUE_SECONDS + 5))" ] && break
    sleep 2
  done
  [ "$($ADB shell date +%s | tr -d '\r')" -ge "$((DUE_SECONDS + 5))" ] || {
    bad "设备时钟尚未跨过触发时刻，拒绝判定未投递"; summary "提醒恢复" "" 1
  }
  $ADB shell cmd statusbar expand-notifications >/dev/null 2>&1
  sleep 2
  $ADB exec-out screencap -p > "$HEYTA_REPO_ROOT/apps/mobile/evidence/android-reminder-${TEST_MODE}-before.png"
  if has_notification "$TITLE" || ! assert_fired_receipt unfired; then
    bad "未允许投递时出现通知或 fired 事实"; summary "提醒恢复" "" 1
  fi
  ok "跨过触发时刻后仍未伪造 fired，系统无活动通知"
  if [ "$TEST_MODE" = permission-recovery ]; then
    $ADB shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || exit 1
  fi
  $ADB shell cmd statusbar collapse >/dev/null 2>&1
  launch_app || exit 1
  sleep 3
  $ADB shell input keyevent 3
  SEEN=0
  for i in $(seq 1 30); do
    if has_notification "$TITLE"; then SEEN=1; break; fi
    sleep 2
  done
  $ADB shell cmd statusbar expand-notifications >/dev/null 2>&1
  sleep 2
  $ADB exec-out screencap -p > "$HEYTA_REPO_ROOT/apps/mobile/evidence/android-reminder-${TEST_MODE}-after.png"
  [ "$SEEN" = 1 ] || { bad "恢复后没有补发通知"; summary "提醒恢复" "" 1; }
  $ADB shell cmd statusbar collapse >/dev/null 2>&1
  launch_app || exit 1
  sleep 3
  assert_fired_receipt fired || { bad "恢复投递没有落库正确回执"; summary "提醒恢复" "" 1; }
  ok "恢复后补发系统通知，前台回收持久化 occurrence 回执"
  summary "提醒恢复：$TEST_MODE"
fi

step "3. 判据①：退后台，等 OS 投递真通知"
$ADB shell input keyevent 3; sleep 3   # HOME = 退后台
SEEN=0
for i in $(seq 1 120); do
  if has_notification "$TITLE"; then SEEN=1; break; fi
  sleep 2
done
# Capture the actual notification shade before asserting, including failures.
# A screenshot of the launcher cannot prove that a notification was visible.
$ADB shell cmd statusbar expand-notifications >/dev/null 2>&1; sleep 2
mkdir -p "$HEYTA_REPO_ROOT/apps/mobile/evidence"
$ADB exec-out screencap -p > "$HEYTA_REPO_ROOT/apps/mobile/evidence/android-reminder-ring.png"
$ADB shell dumpsys notification --noredact > /tmp/heyta-reminder-ring-notifications.txt
if [ "$SEEN" = "1" ]; then
  ok "通知栏出现了真通知（后台状态，系统投递）"
else
  bad "120×2s 内通知栏没有出现提醒通知"; screen_txt
  summary "移动端提醒投递" "触发前置失败" 1
fi

step "4. 从启动器回应用，保留通知用于取消判据"
# Clicking a notification auto-cancels it. Reopen through the launcher so the
# following deletion test cannot pass merely because the click removed it.
$ADB shell cmd statusbar collapse >/dev/null 2>&1
launch_app || exit 1; sleep 4
if ! has_notification "$TITLE"; then
  bad "取消判据缺少仍然活动的通知，不能把空通知栏当作取消成功"
  summary "移动端提醒投递" "取消正向对照失败" 1
fi
ok "应用回前台后通知仍然活动（取消判据正向对照）"
dump

step "5. 判据②：删提醒 ⇒ 已展示的通知消失"
# Launcher resume may leave the detail sheet open; do not try to locate the
# task behind that modal or tap a tab bar covered by it.
if [ "$(has_desc "关闭任务详情")" != "1" ]; then
  XY=$(xy_desc "打开任务：$TITLE")
  [ -z "$XY" ] && XY=$(xy_text "$TITLE")
  if [ -z "$XY" ]; then
    bad "回不到任务详情"; screen_txt
    summary "移动端提醒投递" "取消前置失败" 1
  fi
  $ADB shell input tap $XY; sleep 2
fi
XY=$(scroll_to_text "删除提醒")
if [ -z "$XY" ]; then
  bad "找不到可点击的删除提醒按钮"; screen_txt
  summary "移动端提醒投递" "取消前置失败" 1
fi
$ADB shell input tap $XY; sleep 4
if has_notification "$TITLE"; then
  bad "删除提醒后通知还在通知栏（reconcile 没撤）"
else
  ok "删除提醒后通知从通知栏消失（已展示的也被撤）"
fi

step "6. 判据③：删除已投递提醒后，另建一条提醒再贪睡 +10 分钟"
# 删除后的提醒已经是墓碑，不能继续对它点「稍后提醒」。这里通过真实 composer
# 建一条无截止时间的第二任务，再用绝对时刻入口建立独立提醒，避免把两个实体的
# 生命周期混在一起；这也让本步骤确实覆盖删除之后不能 snooze 同条的边界。
SNOOZE_READY=0
dump
XY=$(xy_desc "关闭任务详情")
[ -n "$XY" ] && { $ADB shell input tap $XY; sleep 2; }
dump
XY=$(xy_desc "新建任务")
[ -z "$XY" ] && { $ADB shell input tap 108 2253; sleep 2; XY=$(xy_desc "新建任务"); }
if [ -z "$XY" ]; then
  bad "找不到新建按钮（无法建立独立的贪睡测试任务）"; screen_txt
else
  $ADB shell input tap $XY; sleep 2.5
  dump
  XY=$(xy_edit_any)
  $ADB shell input tap $XY; sleep 1
  fill_capture "$SNOOZE_TITLE" || exit 1
  dump
  XY=$(xy_desc "添加")
  [ -z "$XY" ] && XY=$(xy_text "添加")
  if [ -z "$XY" ]; then
    bad "独立贪睡测试任务缺少添加按钮"; screen_txt
  else
    $ADB shell input tap $XY; sleep 3
  fi
fi

dump
XY=$(xy_desc "打开任务：$SNOOZE_TITLE")
[ -z "$XY" ] && XY=$(xy_text "$SNOOZE_TITLE")
if [ -z "$XY" ]; then
  bad "打不开独立贪睡测试任务详情"; screen_txt
else
  $ADB shell input tap $XY; sleep 2.5
  FOUND=0
  for i in $(seq 1 8); do
    dump
    XY=$(python3 /tmp/_xy.py text-sane "1 小时后提醒" 0)
    if [ -n "$XY" ]; then FOUND=1; break; fi
    $ADB shell input swipe 540 1600 540 900 400; sleep 1.5
  done
  if [ "$FOUND" = "1" ]; then
    $ADB shell input tap $XY; sleep 3
    FOUND=0
    for i in $(seq 1 8); do
      dump
      XY=$(python3 /tmp/_xy.py text-sane "稍后提醒" 0)
      if [ -z "$XY" ]; then XY=$(xy_text "贪睡"); fi
      if [ -n "$XY" ]; then FOUND=1; break; fi
      $ADB shell input swipe 540 1600 540 900 400; sleep 1.5
    done
    if [ "$FOUND" = "1" ]; then
      $ADB shell input tap $XY; sleep 3
      SNOOZE_READY=1
      ok "已对独立提醒点贪睡（snoozedUntil = +10 分钟，调度器会把它交给 OS）"
    else
      bad "找不到独立提醒的贪睡按钮"; screen_txt
    fi
  else
    bad "找不到「1 小时后提醒」绝对提醒入口"; screen_txt
  fi
fi
if [ "$SNOOZE_READY" != "1" ]; then
  summary "移动端提醒投递" "贪睡提醒前置失败" 1
fi
# SIGKILL 模拟普通进程终止；测试模拟器的 su 仅用于跨 UID 杀进程。
# 不要用 am force-stop，它会阻断后台组件。
$ADB shell input keyevent 3; sleep 2
PID=$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r')
KILL_OK=0
if [ -z "$PID" ]; then
  bad "杀进程前找不到 $PKG 的 pid，无法证明普通进程终止路径"
else
  KILL_OUTPUT=$($ADB shell su 0 kill -9 $PID 2>&1)
  KILL_RC=$?
  if [ "$KILL_RC" -ne 0 ]; then
    bad "SIGKILL $PKG 失败（退出码 $KILL_RC）：$KILL_OUTPUT"
  else
    sleep 2
    if [ -n "$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r')" ]; then
      bad "SIGKILL 返回成功但 $PKG 进程仍存活"
    else
      KILL_OK=1
      ok "已用 SIGKILL 终止普通进程（未使用 force-stop）"
    fi
  fi
fi
if [ "$KILL_OK" != "1" ]; then
  summary "移动端提醒投递" "进程终止前置失败" 1
fi
ALARM=$($ADB shell dumpsys alarm 2>/dev/null | tr -d '\r' | grep -c "$PKG")
if [ "${ALARM:-0}" -ge 1 ]; then
  ok "普通进程终止后系统仍持有本包的 alarm（×${ALARM}）—— 投递不依赖进程"
else
  bad "普通进程终止后 dumpsys alarm 里没有本包的调度"
  summary "移动端提醒投递" "系统调度前置失败" 1
fi
echo "   等待贪睡到期（~10.5 分钟）…"
SEEN=0
for i in $(seq 1 70); do
  if has_notification "$SNOOZE_TITLE"; then SEEN=1; break; fi
  sleep 10
done
$ADB shell cmd statusbar expand-notifications >/dev/null 2>&1; sleep 2
$ADB exec-out screencap -p > "$HEYTA_REPO_ROOT/apps/mobile/evidence/android-reminder-dead.png"
if [ "$SEEN" = "1" ]; then
  ok "普通进程被杀后通知仍然响了（系统投递）"
else
  bad "70×10s 内通知没出现（进程死了投递也死了？）"
fi
step "7. 判据④：点第二条通知回应用"
$ADB shell cmd statusbar expand-notifications >/dev/null 2>&1; sleep 2
dump
XY=$(xy_text "$SNOOZE_TITLE")
if [ -z "$XY" ]; then XY=$(xy_notification_desc_contains "$SNOOZE_TITLE"); fi
if [ -n "$XY" ]; then
  $ADB shell input tap $XY; sleep 4
  FRONT=$($ADB shell dumpsys activity activities 2>/dev/null | tr -d '\r' | awk -v pkg="$PKG" '
    /topResumedActivity|mResumedActivity/ && index($0, pkg "/") { found = 1 }
    END { print found ? 1 : 0 }
  ')
  if [ "$FRONT" = "1" ] && [ -n "$($ADB shell pidof $PKG 2>/dev/null | tr -d '\r')" ]; then
    ok "点通知回到了应用（前台 + 进程在）"
  else
    bad "点通知后应用没回前台"; screen_txt
  fi
else
  bad "通知栏里定位不到当前活动通知，不能完成点通知回应用判据"; screen_txt
  summary "移动端提醒投递" "通知点击前置失败" 1
fi


summary "移动端提醒投递"
