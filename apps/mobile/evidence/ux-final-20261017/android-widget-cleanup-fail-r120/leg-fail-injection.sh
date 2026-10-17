#!/bin/bash
#
# r120：把"组件清理真的失败"注进装机态，量 `widget-cleanup-pending` 那一枚横幅与「重试」。
# =============================================================================
# 台账 973 后半句原话是「验证原生拒绝/刷新失败有真实失败结果」。到 r119 为止，
# `widget-cleanup-pending` 从未在装机态被触发过 —— 它的证据只有 vitest + Kotlin/TS 链。
#
# 注入点选在**设备侧文件权限**，不改任何代码：
#   `WidgetStore.clearAll()` 里是 `check(store.commit()) { "Widget storage commit failed" }`
#   （`apps/mobile/android/app/src/main/java/com/heytamobile/widget/WidgetStore.kt`），
#   而 `SharedPreferences.commit()` 在写盘失败时返回 false ⇒ 抛 ⇒ 桥接层把失败传出来 ⇒
#   `wipeCredentialsAndWidgets` 的 `onWidgetError` ⇒ 界面上应该出现失败横幅 + 「重试」。
#   所以把 `shared_prefs/` 改成不可写（`771 → 555`）就是"原生这一步失败"的物理事件。
#
# 🔴 两道防自欺：
#   1. **失败必须留下可数的痕迹**：注入态下点完，存储文件那三个数必须**没动**
#      （动了就说明它其实成功了，那横幅是假的）。
#   2. **重试必须真的能成**：把权限改回 771 之后点「重试」，横幅要消失、存储要变 `65 B / 键空`。
#      只量第一半等于只证明"会喊失败"，不证明"那句失败是真的"。
#
# 🔴 收尾不许依赖脚本走到最后：权限恢复挂在 `trap … EXIT` 上，中途红/退出都会改回来。
set -u
export PATH="/opt/homebrew/bin:$PATH:/Users/rocalight/Library/Android/sdk/platform-tools"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE"; while [ "$ROOT" != "/" ] && [ ! -e "$ROOT/.git" ]; do ROOT="$(dirname "$ROOT")"; done
[ -e "$ROOT/.git" ] || { echo "❌ 退到 / 也没找到仓库根"; exit 3; }

export PORT=4520 HEYTA_E2E_DB=heyta_uxr120
export HEYTA_E2E_TOKEN_FILE=/Users/rocalight/heyta-r120-leg/token.txt
export HEYTA_E2E_EMAIL_FILE=/Users/rocalight/heyta-r120-leg/email.txt
export HEYTA_E2E_E2EE_FILE=/Users/rocalight/heyta-r120-leg/e2ee.txt
export HEYTA_E2E_UI_XML=/Users/rocalight/heyta-r120-leg/ui.xml
export HEYTA_E2E_XY_PY=/Users/rocalight/heyta-r120-leg/xy.py
. "$ROOT/scripts/lib/mobile-e2e.sh"

DIR=/data/data/com.heyta/shared_prefs
PREFS=$DIR/heyta_widget.xml
ORIG_DIR_MODE=771

restore_perms() {
  local now
  now=$($ADB shell "stat -c '%a' $DIR" </dev/null 2>/dev/null | tr -d '\r')
  if [ "$now" != "$ORIG_DIR_MODE" ]; then
    $ADB shell "chmod $ORIG_DIR_MODE $DIR" </dev/null 2>&1 | tr -d '\r'
    now=$($ADB shell "stat -c '%a' $DIR" </dev/null 2>/dev/null | tr -d '\r')
  fi
  echo "   [权限恢复] $DIR 现在是 ${now}（原始登记值 ${ORIG_DIR_MODE}）"
}
trap 'restore_perms' EXIT

sample() {
  local tag="$1" meta keys
  meta=$($ADB shell "stat -c '%y|%s' $PREFS" </dev/null 2>/dev/null | tr -d '\r')
  keys=$($ADB shell "grep -o -e snapshot_v1 -e intents_v1 $PREFS" </dev/null 2>/dev/null | tr -d '\r' | sort | uniq | tr '\n' ' ')
  printf '   [%s] %s  键=[%s]\n' "$tag" "${meta:-文件不存在}" "${keys:-（空）}"
}
banner() {
  local has_pending has_retry has_failed
  has_pending=$(python3 -c "import re,sys;print(1 if re.search(r'resource-id=\"[^\"]*widget-cleanup-pending\"',open(sys.argv[1],encoding='utf-8',errors='replace').read()) else 0)" "$UI_XML" 2>/dev/null)
  has_failed=$(has_text "小组件还没有清除")
  has_retry=$(has_text "重试")
  printf '   [%s] testID=widget-cleanup-pending 命中 %s ｜ 文案「小组件还没有清除」命中 %s ｜ 「重试」命中 %s\n' \
    "$1" "${has_pending:-?}" "$has_failed" "$has_retry"
  [ "$has_failed" = "1" ] && [ "$has_retry" = "1" ]
}
button_state() {
  python3 - "$UI_XML" "$1" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
for m in re.finditer(r'<node ([^>]*?)/?>', xml):
    a = m.group(1)
    t = re.search(r'text="([^"]*)"', a); d = re.search(r'content-desc="([^"]*)"', a)
    lab = " ".join(filter(None, [t.group(1) if t else "", d.group(1) if d else ""]))
    if "清除本机保存的凭据" not in lab: continue
    g = lambda k: (re.search(k + r'="([^"]*)"', a).group(1) if re.search(k + r'="([^"]*)"', a) else "?")
    print(f"   [{sys.argv[2]}] class={g('class').split('.')[-1]} enabled={g('enabled')} clickable={g('clickable')}")
PY
}
goto_security() {
  close_settings_sheet
  local tab row dir xy
  tab=$(xy_desc "我的"); [ -n "$tab" ] && { $ADB shell input tap $tab; sleep 3; }
  row=""
  for i in $(seq 1 12); do dump; row=$(xy_rid "profile-entry-settings"); [ -n "$row" ] && break; swipe_in_view; sleep 1.5; done
  [ -n "$row" ] || { echo "   ❌ 找不到设置入口"; return 1; }
  $ADB shell input tap $row; sleep 3
  dir=""
  for i in $(seq 1 8); do dump; dir=$(xy_rid "settings-section-security"); [ -n "$dir" ] && break; swipe_in_view; sleep 1.5; done
  [ -n "$dir" ] || { echo "   ❌ 目录里没有安全组"; return 1; }
  $ADB shell input tap $dir; sleep 2
  xy=$(scroll_to_text "清除本机保存的凭据"); [ -n "$xy" ] || { echo "   ❌ 安全组里没有那一行"; return 1; }
  TAP_XY="$xy"
}

echo "被测包：$(adb -s emulator-5554 shell dumpsys package com.heyta 2>/dev/null | grep -E 'versionName|lastUpdateTime' | tr -d ' \r' | paste -sd' ' -)"
echo "载体 HEAD：$(git -C "$ROOT" rev-parse --short HEAD)   账号：$EMAIL"
echo "原始权限：$($ADB shell "stat -c '%A %a %U:%G %n' $DIR $PREFS" </dev/null 2>/dev/null | tr -d '\r' | paste -sd' ; ' -)"

step "1. 登录（让表单那两格有值 —— 那一枚按钮在可达态才点得动）"
launch_app; sleep 5
dismiss_welcome_if_present
if ! tap_tab "我的" "rid:profile-entry-settings"; then echo "❌ 切不到「我的」"; exit 1; fi
configure_sync_credentials || echo "     （lib 报了丢字段，可达性以第 2 段那枚 enabled 为准）"

step "2. 走到安全组，读那一枚按钮自己的 enabled（可达性判据）"
TAP_XY=""
goto_security || exit 1
dump
button_state "T0 注入之前"
sample "S0 注入之前"

step "3. 注入：把 shared_prefs 改成不可写（$ORIG_DIR_MODE → 555）"
$ADB shell "chmod 555 $DIR" </dev/null 2>&1 | tr -d '\r'
echo "   现在是 $($ADB shell "stat -c '%a' $DIR" </dev/null 2>/dev/null | tr -d '\r')（要 555）"

step "4. 点「清除本机保存的凭据」，等异步那两步走完"
$ADB shell input tap $TAP_XY; sleep 8
dump
banner "T1 注入态点完" && BANNER_SHOWN=1 || BANNER_SHOWN=0
sample "S1 注入态点完（这三个数**不该动** —— 动了就说明它其实成功了）"

step "5. 撤掉注入，把权限改回来"
restore_perms

step "6. 点「重试」—— 失败要能翻案，才算那句失败是真的"
dump
RXY=$(xy_text "重试"); [ -z "$RXY" ] && RXY=$(scroll_to_text "重试")
if [ -z "$RXY" ]; then
  echo "   ❌ 界面上没有「重试」可点（横幅那一枚 ${BANNER_SHOWN}）"
else
  $ADB shell input tap $RXY; sleep 9
  dump
  banner "T2 重试之后" && echo "   ⚠️ 重试之后横幅还在（没翻案）" || ok "重试之后横幅消失"
  sample "S2 重试之后（要看到 65 B / 键空）"
fi

step "7. 读数汇总"
echo "   BANNER_SHOWN=${BANNER_SHOWN}（1 = 注入态下界面确实报了失败）"
echo "   判读要看第 4/6 段那两行 S1/S2：S1 的键里**还有** snapshot_v1 ⇒ 那次写盘真的失败；"
echo "                                                    S2 变成 65 B / 键空 ⇒ 重试真的把它清掉了。"
echo "PASS=$PASS FAIL=$FAIL"
