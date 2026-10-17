#!/bin/bash
#
# r119 第 1 腿：装机态**登录 + 同意联网 + 造数 + 绑卡**。
# =============================================================================
# 为什么要这一腿：r117 那一趟的「注销账号」被隐私同意闸门挡住了，所以
# `eraseLocalData()` 之后组件到底清不清**没有读数**（那页 RESULT.md 第 4 节 / 不证 #1）。
# 要把那一半量出来，设备必须处在"已同意联网 + 已登录 + 卡上有真实任务"三样同时成立的态。
#
# 🔴 这一趟**故意**让共享导航点「同意并联网」（`dismiss_welcome_if_present` 的默认值，
#    `scripts/lib/mobile-e2e.sh:945`）。r117 那页把它记成一次"没点名的副作用"；
#    这一趟它是被测前提，跑完在 leg3 里按 `consent-side-effect.txt` 那套恢复。
#
# 不装包、不 pm clear：被测的是 r118 那趟装进模拟器的当前产物（`lastUpdateTime` 现量在下面）。
set -u
export PATH="/opt/homebrew/bin:$PATH"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE"
while [ "$ROOT" != "/" ] && [ ! -e "$ROOT/.git" ]; do ROOT="$(dirname "$ROOT")"; done
[ -e "$ROOT/.git" ] || { echo "❌ 退到 / 也没找到仓库根"; exit 3; }

export PORT=4520
export HEYTA_E2E_DB=heyta_uxr119
export HEYTA_E2E_TOKEN_FILE=/Users/rocalight/heyta-r119-leg/token.txt
export HEYTA_E2E_EMAIL_FILE=/Users/rocalight/heyta-r119-leg/email.txt
export HEYTA_E2E_E2EE_FILE=/Users/rocalight/heyta-r119-leg/e2ee.txt
export HEYTA_E2E_UI_XML=/Users/rocalight/heyta-r119-leg/ui.xml
export HEYTA_E2E_XY_PY=/Users/rocalight/heyta-r119-leg/xy.py

. "$ROOT/scripts/lib/mobile-e2e.sh"

PREFS=/data/data/com.heyta/shared_prefs/heyta_widget.xml
PREFDB=/data/data/com.heyta/databases/heyta-device-prefs.sqlite

sample() {
  local tag="$1" meta keys
  meta=$($ADB shell "stat -c '%y|%s' $PREFS" </dev/null 2>/dev/null | tr -d '\r')
  keys=$($ADB shell "grep -o -e snapshot_v1 -e intents_v1 $PREFS" </dev/null 2>/dev/null | tr -d '\r' | sort | uniq | tr '\n' ' ')
  printf '   [%s] %s  键=[%s]\n' "$tag" "${meta:-文件不存在}" "${keys:-（空）}"
}
consent() {
  printf '   [%s] %s\n' "$1" "$($ADB shell "sqlite3 $PREFDB 'select value from device_pref where key=\"privacy.consent';'" </dev/null 2>/dev/null | tr -d '\r')"
}

echo "被测包：$(adb -s $E2E_SERIAL shell dumpsys package com.heyta 2>/dev/null \
  | grep -E 'versionName|lastUpdateTime' | tr -d ' \r' | paste -sd' ' -)"
echo "载体 HEAD（读数当时那枚）：$(git -C "$ROOT" rev-parse --short HEAD)"
echo "服务端：$HOST_SERVER   账号：$EMAIL"

if [ -n "$(another_mobile_e2e_running)" ]; then
  echo "❌ 有别的移动端验收在同一台模拟器上跑，本趟不起："
  another_mobile_e2e_running
  exit 3
fi

step "0. 起点态（同意 = 未决定，存储 = 装机后那份）"
consent "T0 隐私同意"
sample "S0 组件存储"

step "1. 冷启动 → 同意联网（本趟的被测前提，故意点这一边）→ 切到「我的」"
launch_app
sleep 5
dismiss_welcome_if_present
consent "T1 同意之后"
close_settings_sheet
if ! tap_tab "我的" "rid:profile-entry-settings"; then
  echo "❌ 切不到「我的」（后面的凭据读数都不算）"; exit 1
fi

step "2. 配凭据并登录"
if ! configure_sync_credentials; then
  echo "❌ 凭据没落到界面上"; exit 1
fi
ok "已配凭据"

step "3. 造两条今天的任务并把 Today 卡绑上桌面"
LEG_PREFIX=L119 python3 "$ROOT/apps/mobile/evidence/ux-final-20261016/android-widget-click-r115/widget-data-leg.py" \
  "$E2E_SERIAL" "$HERE" seed,bind
sample "S1 绑卡之后"

step "4. 读卡（注销之前的 C1 —— 后面要有东西可清）"
CARD_TAG=before python3 "$ROOT/apps/mobile/evidence/ux-final-20261016/android-widget-click-r115/widget-data-leg.py" \
  "$E2E_SERIAL" "$HERE" readcard
sample "S2 读卡之后"
echo "PASS=$PASS FAIL=$FAIL"
