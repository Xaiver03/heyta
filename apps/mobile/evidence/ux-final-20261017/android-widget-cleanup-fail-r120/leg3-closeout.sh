#!/bin/bash
#
# r120 收尾：把这台共享设备与本机回到"没跑过这一趟"的形状。
# 每一步都带现量读数，且**只动本趟创建/改动的对象**（本趟那枚库 / 本趟那台栈 /
# 本趟被共享 helper 顺手点掉的设备级隐私同意 / 本趟登记过原始值的 shared_prefs 目录）。
set -u
export PATH="/opt/homebrew/bin:$PATH:/Users/rocalight/Library/Android/sdk/platform-tools"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE"; while [ "$ROOT" != "/" ] && [ ! -e "$ROOT/.git" ]; do ROOT="$(dirname "$ROOT")"; done
[ -e "$ROOT/.git" ] || { echo "❌ 退到 / 也没找到仓库根"; exit 3; }
ADB="adb -s emulator-5554"
DIR=/data/data/com.heyta/shared_prefs
PREFS=$DIR/heyta_widget.xml
PREFDB=/data/data/com.heyta/databases/heyta-device-prefs.sqlite
FAV='content://com.google.android.apps.nexuslauncher.settings/favorites'

echo "════ 1. 注入用的那枚权限：必须回到登记的原始值 771 ════"
echo "     目录 = $($ADB shell "stat -c '%A %a %U:%G' $DIR" </dev/null 2>/dev/null | tr -d '\r')"
echo "     文件 = $($ADB shell "stat -c '%A %a|%s' $PREFS" </dev/null 2>/dev/null | tr -d '\r')"
[ "$($ADB shell "stat -c '%a' $DIR" </dev/null 2>/dev/null | tr -d '\r')" = "771" ] \
  && echo "   ✅ 权限已还原（这趟留下的唯一设备侧改动是写盘权限，且只在注入那 8 秒）" \
  || { echo "   ❌ 权限不是 771，当场改回"; $ADB shell "chmod 771 $DIR"; }

echo "════ 2. 桌面绑定：这趟没绑新实例，读数证一下（r119 收尾时已解绑）════"
$ADB shell "content query --uri $FAV --projection _id:appWidgetId" 2>&1 | tr -d '\r' \
  | awk -F'appWidgetId=' 'NF>1{n++; if($2!="-1") w++} END{print "     组件行 "w+0"（favorites 共 "n" 行，其余 appWidgetId=-1 是图标）"}'

echo "════ 3. 设备级隐私同意：本趟又被共享 helper 点成 accepted，按 r119 同一档恢复 ════"
echo "  恢复前 device_pref："
$ADB shell "sqlite3 $PREFDB 'select key,value from device_pref order by key;'" 2>&1 | tr -d '\r' | sed 's/^/     /'
$ADB shell am force-stop com.heyta; sleep 2
$ADB shell "sqlite3 $PREFDB 'delete from device_pref where key in (\"privacy.consent\",\"welcome.hasSeen\");'" 2>&1 | tr -d '\r'
echo "  删行之后 device_pref 行数 = $($ADB shell "sqlite3 $PREFDB 'select count(*) from device_pref;'" 2>&1 | tr -d '\r')"

echo "════ 4. 应用留在冷启动态（下次谁用都和刚装完一样：先看到同意卡）════"
$ADB shell am start -W -n com.heyta/com.heytamobile.MainActivity 2>&1 | grep -E "Status|Activity" | tr -d '\r' | sed 's/^/     /'
sleep 6
$ADB shell uiautomator dump /sdcard/r120-final.xml >/dev/null 2>&1
$ADB shell cat /sdcard/r120-final.xml 2>/dev/null | tr -d '\r' \
  | grep -o "在使用联网功能之前\|同意并联网\|只用本机\|还没登录" | sort | uniq -c | sed 's/^/     /'
$ADB shell am force-stop com.heyta
echo "     应用进程 pidof = '$($ADB shell pidof com.heyta 2>&1 | tr -d '\r')'（空 = 已停）"

echo "════ 5. 停掉本趟那台栈、删掉本趟那枚库与本趟那批凭据文件 ════"
export PORT=4520
bash "$ROOT/scripts/mobile-e2e-down.sh" 2>&1 | tail -3 | sed 's/^/     /'
/opt/homebrew/bin/dropdb heyta_uxr120 2>&1 | sed 's/^/     /'
echo "     残留 uxr 库数 = $(/opt/homebrew/bin/psql -lqt 2>/dev/null | grep -c uxr)"
echo "     4520 监听 = $(lsof -nP -iTCP:4520 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
# 令牌随那枚库一起作废，但文件是本趟造的，留在本机没理由。
ls -1 /Users/rocalight/heyta-r120-leg 2>/dev/null | sed 's/^/     待删：/'
rm -rf /Users/rocalight/heyta-r120-leg
echo "     /Users/rocalight/heyta-r120-leg 还在吗：$([ -d /Users/rocalight/heyta-r120-leg ] && echo 在 || echo 已删)"
