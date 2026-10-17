#!/bin/bash
#
# 装机态「清除本机保存的凭据」这一枚按钮的**三方对账腿**。
#
# 前一趟（`erase-leg.sh`）只量到"卡上还留着上一个账号的任务"，而那个形状有三种成因，
# 下一步完全不同，所以这一趟一次把三种都判掉：
#
# | 假设 | 这趟里能看见的证据 |
# |---|---|
# | A 处理器根本没跑（点了个没反应的控件） | 三个计数器一个不动：存储文件不重写、按钮还是可点、同步面还是已配置态 |
# | B 跑了，但原生 `clearWidgetState` 抛了 | 界面上会出现「已退出登录，但这台设备上的小组件还没有清除。请重试。」，且凭据确实清了 |
# | C 跑了、也清了，但之后又重发布了一次 | 存储文件先变空、随后**再被写回**（mtime 比清空那一下更晚且键又出现） |
#
# 🔴 存储文件是这件事的**硬证据**：`WidgetStore.clearAll()` 走的是
#    `remove()` + `check(commit())`，`commit()` 是同步落盘的 —— 清了就一定重写
#    `/data/data/com.heyta/shared_prefs/heyta_widget.xml`。这比"卡上有没有字"强，
#    因为卡上有没有字还要过一层启动器的 RemoteViews 缓存。
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
LOGCAT="$HERE/logcat.txt"

# 存储文件那一格：mtime、字节数、两个键在不在，全部现读。
# ⚠️ `tr -d '\r'` 不是装饰 —— adb shell 在 Linux 目标上回 CRLF，
#    留着 \r 之后两个读数比"相等"会恒假。
sample() {
  local tag="$1" meta keys
  meta=$($ADB shell "stat -c '%y|%s' $PREFS" </dev/null 2>/dev/null | tr -d '\r')
  keys=$($ADB shell "grep -o -e snapshot_v1 -e intents_v1 $PREFS" </dev/null 2>/dev/null | tr -d '\r' | sort | uniq | tr '\n' ' ')
  printf '   [%s] %s  键=[%s]\n' "$tag" "${meta:-文件不存在}" "${keys:-（空）}"
}

# 按钮自身的 enabled —— 这一枚是"处理器跑没跑"的第二个独立计数器：
# `disabled={form.token === '' && form.password === ''}`，真清完就该变灰。
button_state() {
  local tag="$1"
  python3 - "$UI_XML" "$tag" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
for m in re.finditer(r'<node ([^>]*?)/?>', xml):
    a = m.group(1)
    label = re.search(r'text="([^"]*)"', a) or re.search(r'content-desc="([^"]*)"', a)
    if not label or "清除本机保存的凭据" not in label.group(1):
        continue
    def g(k):
        mm = re.search(k + r'="([^"]*)"', a)
        return mm.group(1) if mm else "?"
    print(f"   [{sys.argv[2]}] 按钮 enabled={g('enabled')} clickable={g('clickable')} bounds={g('bounds')}")
    break
else:
    print(f"   [{sys.argv[2]}] 屏上没有「清除本机保存的凭据」这一枚")
PY
}

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
print(" | ".join(out[:30]))
PY
}

step "0. 先把应用杀干净，读一次存储文件的初值"
$ADB shell am force-stop com.heyta; sleep 2
sample "S0 冷启动前"

step "1. 起 logcat（自己起的，收尾自己停）"
$ADB logcat -c
: > "$LOGCAT"
$ADB logcat -v time > "$LOGCAT" 2>&1 &
LOGCAT_PID=$!
ok "logcat 已起（pid=$LOGCAT_PID，落点 $LOGCAT）"

step "2. 走到「账号与安全」，点之前先取三个计数器的初值"
launch_app
sleep 4
dismiss_welcome_if_present
close_settings_sheet
# 🔴 冷启动落在**任务**这一格，而 `open_settings_section` 只会"在当前的滚动流里找
#    `profile-entry-settings`"——在任务流里滚 5 次永远找不到，报出来像"设置入口没了"。
#    上一趟（`erase-leg.sh` 第 3 跑）是从「账号与安全」那层续上的，入口本来就在树里，
#    所以同一段代码那时能过。切 tab 走库里那枚带标记回读的 `tap_tab`，
#    不要按文本瞎点 —— 底栏那枚 `我的` 有可点与不可点两个节点。
if ! tap_tab "我的" "rid:profile-entry-settings"; then
  dump; echo "   切 tab 之后屏上：$(texts)"; kill "$LOGCAT_PID" 2>/dev/null; exit 1
fi
if ! open_settings_section security; then
  dump; echo "   当时屏上：$(texts)"; kill "$LOGCAT_PID" 2>/dev/null; exit 1
fi
dump
button_state "T0 点之前"
sample "S1 点之前（启动器发布之后）"

step "3. 点「清除本机保存的凭据」，等 8 秒让异步那两步都走完"
XY=$(scroll_to_text "清除本机保存的凭据")
if [ -z "$XY" ]; then
  echo "❌ 安全组里没有那一行"; kill "$LOGCAT_PID" 2>/dev/null; exit 1
fi
$ADB shell input tap $XY; sleep 8
dump
echo "   点下去之后屏上：$(texts)"
button_state "T1 点之后"
sample "S2 点之后"
if [ "$(has_text "小组件还没有清除")" = "1" ]; then
  echo "   🔎 界面上出现了「小组件还没有清除」⇒ 处理器跑了、原生那一步报了失败"
else
  echo "   界面上没有「小组件还没有清除」"
fi

step "4. 再等 10 秒，看有没有第二次写回（假设 C 的形状是 空→又填上）"
sleep 10
sample "S3 点之后 +18s"

step "5. 组件卡读数"
$ADB shell input keyevent KEYCODE_HOME; sleep 2
CARD_TAG=wipe2 python3 "$HERE/../../ux-final-20261016/android-widget-click-r115/widget-data-leg.py" \
  "$E2E_SERIAL" "$HERE" readcard

step "6. 停掉自己起的 logcat，把相关行挑出来"
kill "$LOGCAT_PID" 2>/dev/null
wait "$LOGCAT_PID" 2>/dev/null
echo "   logcat 行数=$(wc -l < "$LOGCAT" | tr -d ' ')"
grep -iE "widget|credential|HeytaWidget|ReactNativeJS|heyta" "$LOGCAT" | tail -40

echo "PASS=$PASS FAIL=$FAIL"
