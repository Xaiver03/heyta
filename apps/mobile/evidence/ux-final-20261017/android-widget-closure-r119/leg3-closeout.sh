#!/bin/bash
#
# r119 收尾：把这台共享设备与本机回到"没跑过这一趟"的形状。
# 每一步都带现量读数，且**只动本趟创建的对象**（组件实例 27 / 本趟那枚库 / 本趟那个栈）。
set -u
export PATH="/opt/homebrew/bin:$PATH:/Users/rocalight/Library/Android/sdk/platform-tools"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE"; while [ "$ROOT" != "/" ] && [ ! -e "$ROOT/.git" ]; do ROOT="$(dirname "$ROOT")"; done
. "$ROOT/scripts/lib/mobile-e2e.sh" >/dev/null 2>&1 || true
ADB="adb -s emulator-5554"
PREFDB=/data/data/com.heyta/databases/heyta-device-prefs.sqlite
FAV='content://com.google.android.apps.nexuslauncher.settings/favorites'

echo "════ 1. 收掉本趟绑的那枚桌面实例（_id=7 / appWidgetId=27）════"
echo "  删之前：$($ADB shell "content query --uri $FAV --projection _id:appWidgetId" 2>&1 | tr -d '\r' \
  | awk -F'appWidgetId=' 'NF>1{n++; if($2!="-1") w++} END{print "组件行 "w"（共 "n" 行，其余是 appWidgetId=-1 的系统图标）"}')"
$ADB shell "content delete --uri $FAV --where \"_id=7 AND appWidgetId=27\"" 2>&1 | tr -d '\r'
$ADB shell am force-stop com.google.android.apps.nexuslauncher; sleep 4
LEFT=$($ADB shell "content query --uri $FAV --projection _id:appWidgetId" 2>&1 | tr -d '\r' | grep -c "appWidgetId=27")
echo "  删之后 appWidgetId=27 命中 $LEFT（要的是 0）"

echo "════ 2. 把设备级隐私同意恢复到"全新安装后没点过任何一边"那一档 ════"
echo "  注销之后它**还在**（这一条本身是读数，写进 RESULT.md）："
$ADB shell "sqlite3 $PREFDB 'select key,value from device_pref order by key;'" 2>&1 | tr -d '\r' | sed 's/^/     /'
$ADB shell am force-stop com.heyta; sleep 2
$ADB shell "sqlite3 $PREFDB 'delete from device_pref where key in (\"privacy.consent\",\"welcome.hasSeen\");'" 2>&1 | tr -d '\r'
echo "  删行之后 device_pref 行数 = $($ADB shell "sqlite3 $PREFDB 'select count(*) from device_pref;'" 2>&1 | tr -d '\r')"

echo "════ 3. 应用留在冷启动态（下次谁用都和刚装完一样：会先看到同意卡）════"
$ADB shell am start -W -n com.heyta/com.heytamobile.MainActivity 2>&1 | grep -E "Status|Activity" | tr -d '\r' | sed 's/^/     /'
sleep 6
$ADB shell uiautomator dump /sdcard/r119-final.xml >/dev/null 2>&1
$ADB shell cat /sdcard/r119-final.xml 2>/dev/null | tr -d '\r' \
  | grep -o "在使用联网功能之前\|同意并联网\|只用本机\|还没登录" | sort | uniq -c | sed 's/^/     /'

echo "════ 4. 停掉本趟那台栈、删掉本趟那枚库 ════"
export PORT=4520
bash "$ROOT/scripts/mobile-e2e-down.sh" 2>&1 | tail -3 | sed 's/^/     /'
/opt/homebrew/bin/dropdb heyta_uxr119 2>&1 | sed 's/^/     /'
echo "     残留 uxr 库数 = $(/opt/homebrew/bin/psql -lqt 2>/dev/null | grep -c uxr)"
echo "     4520 监听 = $(lsof -nP -iTCP:4520 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
$ADB shell am force-stop com.heyta
echo "     应用进程 pidof = '$($ADB shell pidof com.heyta 2>&1 | tr -d '\r')'（空 = 已停）"
