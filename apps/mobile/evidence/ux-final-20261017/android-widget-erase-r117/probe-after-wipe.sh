#!/bin/bash
# 分诊「点了清除本机保存的凭据之后组件卡上还是那两条」这一读数。
# 两种解释的下一步是相反的，所以要一次把它们分开：
#   A 凭据根本没清（那一行没生效 / 点歪了）      ⇒ 症状在界面上，组件是对的
#   B 凭据清了但组件快照没清（D6 破了）          ⇒ 这是台账那一格要抓的缺陷
#   C 快照清了但桌面拿的是上一帧 RemoteViews      ⇒ 强制组件自己重画一次就能分开 B 与 C
set -u
export PATH="/opt/homebrew/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE"
while [ "$ROOT" != "/" ] && [ ! -e "$ROOT/.git" ]; do ROOT="$(dirname "$ROOT")"; done
export PORT=4520 HEYTA_E2E_DB=heyta_uxr117
export HEYTA_E2E_TOKEN_FILE=/tmp/heyta-r117-token.txt
export HEYTA_E2E_EMAIL_FILE=/tmp/heyta-r117-email.txt
export HEYTA_E2E_E2EE_FILE=/tmp/heyta-r117-e2ee.txt
export HEYTA_E2E_UI_XML=/tmp/heyta-r117-ui.xml
export HEYTA_E2E_XY_PY=/tmp/heyta-r117-xy.py
. "$ROOT/scripts/lib/mobile-e2e.sh"

texts() { python3 - "$UI_XML" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
out = []
for m in re.finditer(r'<node ([^>]*?)/?>', xml):
    a = m.group(1)
    t = re.search(r'text="([^"]*)"', a); d = re.search(r'content-desc="([^"]*)"', a)
    s = (t.group(1) if t and t.group(1) else "") or ((d.group(1) + "⟨cd⟩") if d and d.group(1) else "")
    if s: out.append(s)
print(" | ".join(out[:30]))
PY
}

step "A. 同步与隐私那一组现在长什么样（凭据在不在）"
launch_app; sleep 3
close_settings_sheet
ME=$(scroll_to_text "我的"); [ -n "$ME" ] && { $ADB shell input tap $ME; sleep 2; }
open_settings_section sync || { echo "❌ 走不到同步组"; exit 1; }
dump; echo "   $(texts)"

step "B. 组件自己重画一次之后，卡上还剩什么（分开 B 与 C）"
$ADB shell input keyevent KEYCODE_HOME; sleep 2
echo "   重画前：$(CARD_TAG=before-repaint python3 "$HERE/../../ux-final-20261016/android-widget-click-r115/widget-data-leg.py" "$E2E_SERIAL" "$HERE" readcard 2>&1 | grep '读卡')"
$ADB shell am broadcast -n com.heyta/com.heytamobile.widget.TodayWidgetProvider \
  -a android.appwidget.action.APPWIDGET_UPDATE -f 32 | tail -1
sleep 6
$ADB shell input keyevent KEYCODE_HOME; sleep 2
echo "   重画后：$(CARD_TAG=after-repaint python3 "$HERE/../../ux-final-20261016/android-widget-click-r115/widget-data-leg.py" "$E2E_SERIAL" "$HERE" readcard 2>&1 | grep '读卡')"
