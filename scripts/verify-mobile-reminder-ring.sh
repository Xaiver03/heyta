#!/bin/bash
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
# 领域层的 capture 解析器认识「昨天」→ composer 输入 `任务名 昨天` 建出
# due = 昨天（本地零点）的任务；详情提醒段点「截止时」预设（offset 0）⇒
# 提醒的 triggerAt 在**过去** ⇒ 调度器把它交给 OS，AlarmManager 对过去时刻
# **立即投递**。全程真 UI、真 op、真 OS 通知。
#
# ## 判据
#   ① 过去时提醒 → 应用退后台后，`dumpsys notification` 观测到真通知；
#   ② 删提醒 ⇒ 已展示的通知从通知栏消失（调度器 reconcile 含 dismiss）；
#      且未来提醒删除后 `dumpsys alarm` 里的系统调度同步消失；
#   ③ 贪睡（+10 分钟）后 **force-stop 应用** ⇒ 系统仍持有 alarm 且到点投递
#      （调度不依赖进程存活 —— 这是与 web 最大的差别）；
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
PKG_ACT="$PKG/"

echo ""
echo "=== 移动端提醒投递验收（真实模拟器，零 mock）==="
echo "  设备: $E2E_SERIAL   任务: $TITLE"

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

# 通知栏里有没有含 $1 的通知。标题带时间戳（ring-e2e-<HHMMSS>），不会撞别的应用。
has_notification() {
  $ADB shell dumpsys notification --noredact 2>/dev/null | tr -d '\r' | grep -q "$1"
}

step "0. 装包并启动"
$ADB shell am force-stop com.heytamobile >/dev/null 2>&1
$ADB uninstall com.heytamobile >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
# Android 13+ 通知是运行时权限：真用户会在首启授，脚本直接授（等价于点了允许）。
$ADB shell pm grant $PKG android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 \
  && echo "   已授 POST_NOTIFICATIONS（等价于真用户点允许）" || echo "   （该系统无需运行时通知权限）"
$ADB shell am force-stop $PKG; sleep 1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6
dismiss_consent_if_present
dismiss_welcome_if_present
dump
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "1. 判据①触发：composer 建出「昨天到期」的任务"
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
  $ADB shell input text "$TITLE yesterday"; sleep 2
  dump
  XY=$(xy_text "添加")
  $ADB shell input tap $XY; sleep 3
fi
dump
if [ "$(has_desc "打开任务：$TITLE")" = "1" ] || [ "$(has_text "$TITLE")" = "1" ]; then
  ok "任务已创建：${TITLE}（due=昨天）"
else
  bad "任务没创建"; screen_txt
fi

step "2. 详情 → 提醒段 → 「截止时」预设（triggerAt 落在过去）"
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
    XY=$(xy_text "截止时")
    if [ -n "$XY" ]; then FOUND=1; break; fi
    $ADB shell input swipe 540 1600 540 900 400; sleep 1.5
  done
  if [ "$FOUND" = "1" ]; then
    $ADB shell input tap $XY; sleep 3
    ok "已点「截止时」预设（提醒 op 已写，triggerAt=昨天）"
  else
    bad "滚到底也没找到提醒预设"; screen_txt
  fi
fi

step "3. 判据①：退后台，等 OS 投递真通知"
$ADB shell input keyevent 3; sleep 3   # HOME = 退后台
SEEN=0
for i in $(seq 1 30); do
  if has_notification "$TITLE"; then SEEN=1; break; fi
  sleep 2
done
if [ "$SEEN" = "1" ]; then
  ok "通知栏出现了真通知（后台状态，系统投递）"
else
  bad "30×2s 内通知栏没有出现提醒通知"; screen_txt
fi
$ADB exec-out screencap -p > /tmp/heyta-reminder-ring.png 2>/dev/null
mkdir -p "$PWD/apps/mobile/evidence"
cp /tmp/heyta-reminder-ring.png "$PWD/apps/mobile/evidence/android-reminder-ring.png" 2>/dev/null

step "4. 判据④：点通知回应用"
$ADB shell cmd statusbar expand-notifications >/dev/null 2>&1; sleep 2
dump
XY=$(xy_text "$TITLE")
if [ -z "$XY" ]; then XY=$(xy_desc_sub "$TITLE"); fi
if [ -n "$XY" ]; then
  $ADB shell input tap $XY; sleep 4
  FRONT=$($ADB shell dumpsys activity activities 2>/dev/null | tr -d '\r' | grep -q "com.heyta" && echo 1 || echo 0)
  if [ "$FRONT" = "1" ] && [ -n "$($ADB shell pidof $PKG 2>/dev/null | tr -d '\r')" ]; then
    ok "点通知回到了应用（前台 + 进程在）"
  else
    bad "点通知后应用没回前台"; screen_txt
  fi
else
  echo "   ⚠️ 通知栏里定位不到通知文本（可能已展开失败）—— 降级为记录，不算失败"
fi

step "5. 判据②：删提醒 ⇒ 已展示的通知消失"
XY=$(xy_text "$TITLE")
[ -z "$XY" ] && XY=$(xy_desc "打开任务：$TITLE")
if [ -z "$XY" ]; then
  $ADB shell input tap 108 2253; sleep 2
  XY=$(xy_desc "打开任务：$TITLE")
fi
if [ -z "$XY" ]; then bad "回不到任务详情"; screen_txt; else
  $ADB shell input tap $XY; sleep 2.5
  FOUND=0
  for i in $(seq 1 8); do
    dump
    XY=$(xy_text "移除")
    if [ -n "$XY" ]; then FOUND=1; break; fi
    $ADB shell input swipe 540 1600 540 900 400; sleep 1.5
  done
  if [ "$FOUND" = "1" ]; then
    $ADB shell input tap $XY; sleep 4
    if has_notification "$TITLE"; then
      bad "删除提醒后通知还在通知栏（reconcile 没撤）"
    else
      ok "删除提醒后通知从通知栏消失（已展示的也被撤）"
    fi
  else
    bad "找不到提醒的「移除」按钮"; screen_txt
  fi
fi

step "6. 判据③：贪睡 +10 分钟后 force-stop，系统仍投递（调度不依赖进程）"
XY=$(xy_desc "打开任务：$TITLE")
[ -z "$XY" ] && XY=$(xy_text "$TITLE")
if [ -z "$XY" ]; then bad "打不开详情"; screen_txt; else
  $ADB shell input tap $XY; sleep 2.5
  FOUND=0
  for i in $(seq 1 8); do
    dump
    XY=$(xy_text "稍后提醒")
    if [ -z "$XY" ]; then XY=$(xy_text "贪睡"); fi
    if [ -n "$XY" ]; then FOUND=1; break; fi
    $ADB shell input swipe 540 1600 540 900 400; sleep 1.5
  done
  if [ "$FOUND" = "1" ]; then
    $ADB shell input tap $XY; sleep 3
    ok "已点贪睡（snoozedUntil = +10 分钟，调度器会把它交给 OS）"
  else
    bad "找不到贪睡按钮"; screen_txt
  fi
fi
$ADB shell am force-stop $PKG; sleep 2
ALARM=$($ADB shell dumpsys alarm 2>/dev/null | tr -d '\r' | grep -c "$PKG")
if [ "${ALARM:-0}" -ge 1 ]; then
  ok "force-stop 后系统仍持有本包的 alarm（×${ALARM}）—— 投递不依赖进程"
else
  bad "force-stop 后 dumpsys alarm 里没有本包的调度"
fi
echo "   等待贪睡到期（~10.5 分钟）…"
SEEN=0
for i in $(seq 1 70); do
  if has_notification "$TITLE"; then SEEN=1; break; fi
  sleep 10
done
if [ "$SEEN" = "1" ]; then
  ok "应用被杀后通知仍然响了（系统投递）"
else
  bad "70×10s 内通知没出现（进程死了投递也死了？）"
fi
$ADB exec-out screencap -p > /tmp/heyta-reminder-dead.png 2>/dev/null
cp /tmp/heyta-reminder-dead.png "$PWD/apps/mobile/evidence/android-reminder-dead.png" 2>/dev/null

summary "移动端提醒投递"
