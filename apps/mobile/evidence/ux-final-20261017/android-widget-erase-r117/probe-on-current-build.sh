#!/bin/bash
#
# 把 r117 那条"清凭据入口在冷启动后够不到"的读数，**在 r118 刚重打的那枚当前包上**再量一次。
#
# 为什么值得再量：r117 整趟的被测物是 10-16 17:08 装进去的那枚包，而第七趟四端重装
# （r118）已经把 emulator-5554 换成"从当前 HEAD 重打的 release APK + 全新安装"。
# 那条缺陷的成因在源码里（`SettingsScreen` 的 `disabled` 判的是表单草稿 + 凭据只放内存），
# 但"成因在源码"不等于"当前包上还是这个形状" —— 装机态要装机态的读数。
#
# 全新安装 ⇒ 应用没有登录态、表单两格必空 ⇒ 只读那一枚 Button 自己的 `enabled`
# （#448 那条：判可点要读控件本体的 `enabled`，不是内层 TextView、也不是 `clickable`）。
set -u
export PATH="/opt/homebrew/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE"; while [ "$ROOT" != "/" ] && [ ! -e "$ROOT/.git" ]; do ROOT="$(dirname "$ROOT")"; done

export HEYTA_E2E_UI_XML=/tmp/heyta-r118-probe-ui.xml
export HEYTA_E2E_XY_PY=/tmp/heyta-r118-probe-xy.py
. "$ROOT/scripts/lib/mobile-e2e.sh"

probe() {
  python3 - "$UI_XML" "$1" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
hits = 0
for m in re.finditer(r'<node ([^>]*?)/?>', xml):
    a = m.group(1)
    t = re.search(r'text="([^"]*)"', a); d = re.search(r'content-desc="([^"]*)"', a)
    lab = " ".join(filter(None, [t.group(1) if t else "", d.group(1) if d else ""]))
    if "清除本机保存的凭据" not in lab:
        continue
    g = lambda k: (re.search(k + r'="([^"]*)"', a).group(1) if re.search(k + r'="([^"]*)"', a) else "?")
    print(f"   [{sys.argv[2]}] class={g('class').split('.')[-1]} enabled={g('enabled')} clickable={g('clickable')}")
    hits += 1
if not hits:
    print(f"   [{sys.argv[2]}] 屏上没有那一枚（说明还没走到「账号与安全」那一组）")
PY
}

step "0. 被测物身份（r118 重装之后）"
adb -s "$E2E_SERIAL" shell dumpsys package com.heyta </dev/null 2>/dev/null | grep -E 'versionName|lastUpdateTime' | tr -d '\r' | sed 's/^/   /'
echo "   HEAD=$(git -C "$ROOT" rev-parse --short HEAD)"
echo "   组件存储：$(adb -s "$E2E_SERIAL" shell "stat -c '%y|%s' /data/data/com.heyta/shared_prefs/heyta_widget.xml" </dev/null 2>/dev/null | tr -d '\r' || echo 不存在)"

step "1. 冷启动走到「账号与安全」，读那一枚 Button 自己的 enabled"
launch_app; sleep 5
dismiss_welcome_if_present
close_settings_sheet
TAB=$(xy_desc "我的"); [ -n "$TAB" ] && { adb -s "$E2E_SERIAL" shell input tap $TAB; sleep 3; }
row=""
for i in $(seq 1 12); do
  dump; row=$(xy_rid "profile-entry-settings"); [ -n "$row" ] && break
  swipe_in_view; sleep 1.5
done
[ -n "$row" ] || { echo "❌ 找不到设置入口（先核对前台是不是本应用）"; exit 1; }
adb -s "$E2E_SERIAL" shell input tap $row; sleep 3
dir=""
for i in $(seq 1 8); do
  dump; dir=$(xy_rid "settings-section-security"); [ -n "$dir" ] && break
  swipe_in_view; sleep 1.5
done
[ -n "$dir" ] || { echo "❌ 目录层没有 settings-section-security"; exit 1; }
adb -s "$E2E_SERIAL" shell input tap $dir; sleep 2
dump
probe "当前包 / 冷启动 / 未登录"
echo "   这一屏的身份锚（有「注销账号」这一行才说明真到了安全组）：$(has_text "注销账号")"
adb -s "$E2E_SERIAL" shell input keyevent KEYCODE_HOME
