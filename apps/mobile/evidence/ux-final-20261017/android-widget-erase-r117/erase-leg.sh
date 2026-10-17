#!/bin/bash
#
# 装机态**退出登录腿**：在已登录的装机包上走「我的 → 设置 → 账号与安全 → 退出登录」，
# 然后把组件卡再读一次 —— 台账那一格问的就是"清理数据之后组件还展不展示旧任务"。
#
# 🔴 每一步都**先把屏打出来再点**：这一族的失败形状是"找不到那一行"，
#    而"找不到"有三种完全不同的下一步（面没打开 / 那一行在折叠线以下 / 产品真没有这一行）。
#    只报"没点到"就把三种混成一种。
set -u
export PATH="/opt/homebrew/bin:$PATH"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE"
while [ "$ROOT" != "/" ] && [ ! -e "$ROOT/.git" ]; do ROOT="$(dirname "$ROOT")"; done
[ -e "$ROOT/.git" ] || { echo "❌ 退到 / 也没找到仓库根"; exit 3; }

export PORT=4520
export HEYTA_E2E_DB=heyta_uxr117
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
    t = re.search(r'text="([^"]*)"', a)
    d = re.search(r'content-desc="([^"]*)"', a)
    c = re.search(r'clickable="true"', a)
    s = (t.group(1) if t and t.group(1) else "") or ((d.group(1) + "⟨可点⟩") if (c and d and d.group(1)) else "")
    if s:
        out.append(s)
print(" | ".join(out[:26]))
PY
}

step "1. 走到「账号与安全」那一组"
launch_app
sleep 3
dismiss_welcome_if_present
# 🔴 先把设置面**整个**关掉再走导航：上一趟停在「账号与安全」那一层时，
#    `open_settings_section` 的两条前置都不成立 —— 树上既没有 `profile-entry-settings`
#    （入口在设置面里），也没有 `settings-directory`（那是目录层，比当前这层浅一级），
#    于是它"滚 5 次找入口"，而那 5 下滚的是面里的内容。现量在 `erase.txt` 那一趟。
close_settings_sheet
# 回到「我的」那一页（`open_settings_section` 的入口在这一页的滚动流上）。
# 按文本找而不是按写死的坐标 —— 那枚 `945 2253` 是本线在册的第 21 处写死坐标（待办 #68）。
ME=$(scroll_to_text "我的")
if [ -n "$ME" ]; then $ADB shell input tap $ME; sleep 2; fi
if ! open_settings_section security; then
  dump; echo "   当时屏上：$(texts)"; exit 1
fi
dump; echo "   安全组里读到：$(texts)"

# 🔴 这一组里**没有**「退出登录」那一行 —— 第一趟的屏面读数点出来了实际有哪几枚：
#    「账号与安全」「注销账号（删除云端账号，并清除这台设备上的数据）」
#    「加密数据钥匙（提示"请先登录，再管理这个账号的加密数据钥匙"）」
#    「清除本机保存的凭据」。
#    台账那一格要的是 D6 那条（清凭据必须连组件一起清）⇒ 点的是**最后一枚**，
#    不是「注销账号」（那一步会真的删云端账号，是另一格的题）。
XY=$(scroll_to_text "清除本机保存的凭据")
if [ -z "$XY" ]; then
  echo "❌ 安全组里没有「清除本机保存的凭据」那一行（上面那行屏面就是证据）"
  exit 1
fi
ok "找到「清除本机保存的凭据」"
$ADB shell input tap $XY; sleep 3
dump; echo "   点下去之后（确认框？）：$(texts)"

# 确认框的按钮文案按现量挑，不按猜。
CONF=""
for want in 清除 确认 退出 Sign Confirm; do
  c=$(scroll_to_text "$want")
  [ -n "$c" ] && CONF="$c" && break
done
if [ -z "$CONF" ]; then
  echo "   ⚠️ 没有单独的确认按钮 —— 那一枚可能就是直接生效的（继续读屏面）"
else
  $ADB shell input tap $CONF; sleep 8
fi
dump; echo "   清理之后屏上：$(texts)"
if [ "$(has_text "清除本机保存的凭据")" = "1" ]; then
  echo "   ℹ️ 「清除本机保存的凭据」那一行还在 —— 它是常驻入口，不代表没清；主读数看组件卡"
fi

step "2. 组件卡再读一次（这一趟的主读数）"
$ADB shell input keyevent KEYCODE_HOME; sleep 2
CARD_TAG=after-signout python3 "$HERE/../../ux-final-20261016/android-widget-click-r115/widget-data-leg.py" \
  "$E2E_SERIAL" "$HERE" readcard
echo "PASS=$PASS FAIL=$FAIL"
