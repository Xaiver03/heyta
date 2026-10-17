#!/bin/bash
#
# D6 那条"清凭据必须连组件一起清"的**可达态**腿。
#
# 为什么要单独一趟：`erase-leg2.sh` 量到的是"点了没反应"，而那一枚按钮的
# `disabled={form.token === '' && form.password === ''}` 在**冷启动后必然成立**
# （凭据刻意只放内存，`apps/mobile/src/sync/config.ts` 文件头那条取舍）⇒ 界面上
# 拿到的是 `android.widget.Button enabled=false`。那种状态下 D6 根本没法被走通，
# 所以"组件还留着旧任务"既不能算 D6 成立、也不能算 D6 失败。
#
# 这一趟把前提换掉：**在本次会话里刚配完凭据、表单三个字段还有值**（表单态挂在
# ProfileScreen 上，只要不杀进程就一直在）⇒ 那一枚应该是 enabled=true。
# 于是这一次点下去读到的才是 D6 那条契约自己的行为：
#   存储文件应该被 `clearAll()` 同步重写（键消失），组件卡应该回落到占位态。
#
# 读数还是那三个独立计数器：存储文件的 mtime/大小/键、界面上有没有「小组件还没有清除」、
# 卡上还剩什么。
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

PREFS=/data/data/com.heyta/shared_prefs/heyta_widget.xml

sample() {
  local tag="$1" meta keys
  meta=$($ADB shell "stat -c '%y|%s' $PREFS" </dev/null 2>/dev/null | tr -d '\r')
  keys=$($ADB shell "grep -o -e snapshot_v1 -e intents_v1 $PREFS" </dev/null 2>/dev/null | tr -d '\r' | sort | uniq | tr '\n' ' ')
  printf '   [%s] %s  键=[%s]\n' "$tag" "${meta:-文件不存在}" "${keys:-（空）}"
}

# 打印**这一枚按钮自己**的形状 —— 历史教训：内层 TextView 永远是 enabled=true /
# clickable=false，拿它当"可点"读数会把 disabled 的按钮读成能点（见 RESULT.md 装置事实）。
button_state() {
  local tag="$1"
  python3 - "$UI_XML" "$tag" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
for m in re.finditer(r'<node ([^>]*?)/?>', xml):
    a = m.group(1)
    t = re.search(r'text="([^"]*)"', a)
    d = re.search(r'content-desc="([^"]*)"', a)
    lab = " ".join(filter(None, [t.group(1) if t else "", d.group(1) if d else ""]))
    if "清除本机保存的凭据" not in lab:
        continue
    g = lambda k: (re.search(k + r'="([^"]*)"', a).group(1) if re.search(k + r'="([^"]*)"', a) else "?")
    print(f"   [{sys.argv[2]}] class={g('class').split('.')[-1]} enabled={g('enabled')} clickable={g('clickable')} bounds={g('bounds')}")
PY
}

step "1. 在本次会话里配好凭据（让表单那两格有值，D6 那一枚才可达）"
if ! configure_sync_credentials; then
  echo "❌ 凭据没落到界面上（后面的可达态读数都不算）"; exit 1
fi
ok "已配凭据"

step "2. 进「账号与安全」，先读那一枚按钮自己的 enabled"
close_settings_sheet
TAB=$(xy_desc "我的")
[ -n "$TAB" ] && { $ADB shell input tap $TAB; sleep 3; }
row=""
for i in $(seq 1 12); do
  dump
  row=$(xy_rid "profile-entry-settings")
  [ -n "$row" ] && break
  swipe_in_view; sleep 1.5
done
[ -n "$row" ] || { echo "❌ 找不到设置入口"; exit 1; }
$ADB shell input tap $row; sleep 3
# 目录层那一格也要滚：设置面刚开时落在顶部，「账号与安全」排在折叠线以下时
# 整枚不在树里（与上面那条同一族），一次 dump 就判"没有这一行"会读成产品缺这一组。
dir=""
for i in $(seq 1 8); do
  dump
  dir=$(xy_rid "settings-section-security")
  [ -n "$dir" ] && break
  swipe_in_view; sleep 1.5
done
if [ -z "$dir" ]; then
  echo "❌ 目录层滚 8 下也没有 settings-section-security；屏上：$(python3 - "$UI_XML" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
print(" | ".join([m.group(1) for m in re.finditer(r'content-desc="([^"]+)"', xml) if m.group(1)][:18]))
PY
)"
  exit 1
fi
$ADB shell input tap $dir; sleep 2
XY=$(scroll_to_text "清除本机保存的凭据")
[ -n "$XY" ] || { echo "❌ 安全组里没有那一行"; exit 1; }
dump
button_state "T0 点之前"
sample "S1 点之前"

step "3. 点下去，等异步那两步（清存储 + pushAll）走完"
$ADB shell input tap $XY; sleep 8
dump
button_state "T1 点之后"
sample "S2 点之后"
if [ "$(has_text "小组件还没有清除")" = "1" ]; then
  echo "   🔎 出现「小组件还没有清除」⇒ 原生那一步报了失败"
else
  echo "   没有出现「小组件还没有清除」"
fi

step "4. 组件卡与在场实例（D6 的主读数）"
$ADB shell input keyevent KEYCODE_HOME; sleep 2
CARD_TAG=reachable python3 "$HERE/../../ux-final-20261016/android-widget-click-r115/widget-data-leg.py" \
  "$E2E_SERIAL" "$HERE" readcard
sample "S3 收尾再读一次（有没有被重新发布）"
echo "PASS=$PASS FAIL=$FAIL"
