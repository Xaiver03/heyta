#!/bin/bash
# 滴答真机取证小工具（adb 驱动，逐步：看屏 → 定位 → 点 → 截）
# 用法：
#   scripts/tt.sh dev            列出设备
#   scripts/tt.sh launch         启动滴答(com.ticktick.task)
#   scripts/tt.sh dump           打印当前屏的「文本 + bounds」清单（用于定位）
#   scripts/tt.sh tap X Y        点击屏幕坐标
#   scripts/tt.sh key KEYCODE    按键（4=返回, 3=Home, 187=最近任务）
#   scripts/tt.sh swipe X1 Y1 X2 Y2 [ms]   滑动（如从左缘拉出抽屉）
#   scripts/tt.sh cap NAME       截图保存到 $OUT/NAME.png
# 环境变量：TT_SER=<序列号> 指定设备；OUT=<目录> 截图目录(默认 docs/research/mobile-live)
set -u
ADB=${ADB:-/opt/homebrew/share/android-commandlinetools/platform-tools/adb}
PKG=${TT_PKG:-cn.ticktick.task}
OUT=${OUT:-.local/ticktick-teardown/live}
SER=${TT_SER:-$("$ADB" devices | awk 'NR>1 && $2=="device"{print $1; exit}')}
if [ -z "${SER:-}" ]; then echo "NO_DEVICE（adb 未认到真机，检查 USB 调试授权）"; exit 3; fi
cmd=${1:-}
case "$cmd" in
  dev) "$ADB" devices -l ;;
  launch)
    "$ADB" -s "$SER" shell am force-stop "$PKG" >/dev/null 2>&1
    "$ADB" -s "$SER" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    sleep 3; echo "launched $PKG on $SER" ;;
  dump)
    "$ADB" -s "$SER" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    "$ADB" -s "$SER" shell cat /sdcard/ui.xml | python3 -c '
import sys,re
t=sys.stdin.read()
for m in re.findall(r"text=\"([^\"]+)\"[^>]*?bounds=\"(\[[^\"]+\])\"", t):
    if m[0].strip(): print(m[0].strip(), "=>", m[1])
for m in re.findall(r"content-desc=\"([^\"]+)\"[^>]*?bounds=\"(\[[^\"]+\])\"", t):
    if m[0].strip(): print("[desc]", m[0].strip(), "=>", m[1])
' ;;
  tap) "$ADB" -s "$SER" shell input tap "$2" "$3"; echo "tap $2 $3" ;;
  key) "$ADB" -s "$SER" shell input keyevent "$2"; echo "key $2" ;;
  swipe) "$ADB" -s "$SER" shell input swipe "$2" "$3" "$4" "$5" "${6:-300}"; echo "swipe" ;;
  cap)
    mkdir -p "$OUT"
    "$ADB" -s "$SER" shell screencap -p /sdcard/c.png >/dev/null 2>&1
    "$ADB" -s "$SER" pull /sdcard/c.png "$OUT/$2.png" >/dev/null 2>&1
    echo "saved $OUT/$2.png" ;;
  *) echo "usage: tt.sh {dev|launch|dump|tap X Y|key K|swipe X1 Y1 X2 Y2 [ms]|cap NAME}" ;;
esac
