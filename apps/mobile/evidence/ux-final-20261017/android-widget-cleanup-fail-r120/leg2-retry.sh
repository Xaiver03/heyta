#!/bin/bash
#
# r120 第二腿：把第一腿没点成的「重试」补上，量失败能不能翻案。
# =============================================================================
# 第一腿（`leg-fail-injection.sh`）走到第 6 段报「界面上没有『重试』可点」，
# 但那一条**不是产品红，是探针红**：本库的 `has_text` 是整节点精确匹配
# （`scripts/lib/mobile-e2e.sh:410`，411-417 行自己写着这条警告，子串要改用 `has_sub`），
# 而按钮实际标签是 `t('mobile.widgetCleanup.retry')` = 「重试清除小组件」，
# 我按「重试」三个字去定位 ⇒ 永远找不到。所以这一腿只换定位符，不改任何产品代码。
#
# 🔴 判据两头都要有（与第一腿头部同一条理由）：
#   ① 注入态下横幅确实在场（`widget-cleanup-pending` 锚点 + 整句文案 + 按钮 enabled），
#      且组件存储那三个数**没动** ⇒ 那次失败是真的；
#   ② 点完重试后锚点消失、存储变成 `65 B / 键空` ⇒ 那句失败能被翻案。
#
# 这一腿接手时设备已被第一腿留在"注入已撤销、横幅仍在屏上"的状态
# （`pidof` 现量在日志第一行）。权限已回 771（第一腿 `trap … EXIT` 打的），不再改。
set -u
export PATH="/opt/homebrew/bin:$PATH:/Users/rocalight/Library/Android/sdk/platform-tools"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE"; while [ "$ROOT" != "/" ] && [ ! -e "$ROOT/.git" ]; do ROOT="$(dirname "$ROOT")"; done
[ -e "$ROOT/.git" ] || { echo "❌ 退到 / 也没找到仓库根"; exit 3; }

export PORT=4520 HEYTA_E2E_DB=heyta_uxr120
export HEYTA_E2E_TOKEN_FILE=/Users/rocalight/heyta-r120-leg/token.txt
export HEYTA_E2E_EMAIL_FILE=/Users/rocalight/heyta-r120-leg/email.txt
export HEYTA_E2E_E2EE_FILE=/Users/rocalight/heyta-r120-leg/e2ee.txt
export HEYTA_E2E_UI_XML="$HERE/ui.live.xml"
export HEYTA_E2E_XY_PY=/Users/rocalight/heyta-r120-leg/xy.py
. "$ROOT/scripts/lib/mobile-e2e.sh"

DIR=/data/data/com.heyta/shared_prefs
PREFS=$DIR/heyta_widget.xml
BANNER_FULL='已退出登录，但这台设备上的小组件还没有清除。请重试。'
RETRY_LABEL='重试清除小组件'

sample() {
  local tag="$1" meta keys
  meta=$($ADB shell "stat -c '%y|%s' $PREFS" </dev/null 2>/dev/null | tr -d '\r')
  keys=$($ADB shell "grep -o -e snapshot_v1 -e intents_v1 $PREFS" </dev/null 2>/dev/null | tr -d '\r' | sort | uniq | tr '\n' ' ')
  printf '   [%s] %s  键=[%s]\n' "$tag" "${meta:-文件不存在}" "${keys:-（空）}"
}

echo "app 进程：$($ADB shell pidof com.heyta </dev/null 2>/dev/null | tr -d '\r')"
echo "目录权限：$($ADB shell "stat -c '%a %n' $DIR" </dev/null 2>/dev/null | tr -d '\r')（第一腿登记的原始值 771）"

step "1. 重试之前：横幅在场（用 has_sub / 整值，不用第一腿那个碎片）"
dump
cp "$UI_XML" "$HERE/ui.before-retry.xml"
if [ "$(python3 -c "import re,sys;print(1 if re.search(r'resource-id=\"[^\"]*widget-cleanup-pending\"',open(sys.argv[1],encoding='utf-8',errors='replace').read()) else 0)" "$UI_XML")" = "1" ]; then
  ok "注入态留下的锚点 widget-cleanup-pending 仍在场"
else bad "锚点不在场（横幅已经被撤掉了，这一腿没有可重试的对象）"; fi
[ "$(has_sub "小组件还没有清除")" = "1" ] && ok "整句文案用子串探针命中（has_sub）" \
  || bad "整句文案没命中：$BANNER_FULL"
[ "$(has_text "$BANNER_FULL")" = "1" ] && ok "整句文案按整值也命中" || bad "整值不匹配（说明界面上不是这句）"
# 🔴 先把**注入态那一屏**截图存下来：这一腿是接在第一腿留下的现场上跑的，
#    点完重试就再也复现不出"横幅在场"这一屏了（重跑一趟要再注入一次权限）。
$ADB exec-out screencap -p > "$HERE/settings-banner-injected.png" 2>/dev/null
echo "   截图：$HERE/settings-banner-injected.png（$(wc -c < "$HERE/settings-banner-injected.png") 字节）"
RXY=$(xy_text_sane "$RETRY_LABEL")
if [ -z "$RXY" ]; then RXY=$(scroll_to_text "$RETRY_LABEL"); fi
if [ -z "$RXY" ]; then
  bad "找不到可点的「${RETRY_LABEL}」（这一腿停在这里，不改任何现场）"
  echo "PASS=$PASS FAIL=$FAIL"; exit 1
fi
ok "按钮定位到 ${RXY}，节点状态：$(python3 - "$UI_XML" "$RETRY_LABEL" <<'PY'
import re,sys
xml=open(sys.argv[1],encoding='utf-8',errors='replace').read()
for m in re.finditer(r'<node ([^>]*?)/?>',xml):
    a=m.group(1)
    t=re.search(r'text="([^"]*)"',a)
    if not t or t.group(1)!=sys.argv[2]: continue
    g=lambda k:(re.search(k+r'="([^"]*)"',a).group(1) if re.search(k+r'="([^"]*)"',a) else '?')
    print(f"class={g('class').split('.')[-1]} enabled={g('enabled')} clickable={g('clickable')} bounds={g('bounds')}")
PY
)"
sample "S0 重试之前（该还是 500 B / snapshot_v1 还在）"

step "2. 点「重试清除小组件」，等原生那一步回来"
$ADB shell input tap $RXY; sleep 9
dump
cp "$UI_XML" "$HERE/ui.after-retry.xml"

step "3. 重试之后：锚点要消失、存储要变空"
if [ "$(python3 -c "import re,sys;print(1 if re.search(r'resource-id=\"[^\"]*widget-cleanup-pending\"',open(sys.argv[1],encoding='utf-8',errors='replace').read()) else 0)" "$UI_XML")" = "1" ]; then
  bad "重试之后锚点仍在场（失败没被翻案）"
else ok "重试之后锚点消失"; fi
[ "$(has_sub "小组件还没有清除")" = "1" ] && bad "重试之后横幅文案还在" || ok "重试之后横幅文案不在"
sample "S1 重试之后（要 65 B / 键空）"
$ADB shell "stat -c '%s' $PREFS" </dev/null 2>/dev/null | tr -d '\r' | { read -r sz; [ "$sz" = "65" ] && ok "存储大小回到 65 B（空壳）" || bad "存储大小是 ${sz} B，不是 65"; }
[ "$($ADB shell "grep -c snapshot_v1 $PREFS" </dev/null 2>/dev/null | tr -d '\r')" = "0" ] \
  && ok "snapshot_v1 键已消失" || bad "snapshot_v1 键还在"

step "4. 组件卡面读数（翻案后卡片该是空态）"
# 🔴 文件名按**拍到的东西**命名：这一张拍的是设置面（app 还在前台），不是小组件卡。
#    小组件卡只有回到桌面才在画面里，就是下一张。
$ADB exec-out screencap -p > "$HERE/settings-after-retry.png" 2>/dev/null
echo "   截图：$HERE/settings-after-retry.png（$(wc -c < "$HERE/settings-after-retry.png") 字节）"
$ADB shell input keyevent KEYCODE_HOME; sleep 3
$ADB exec-out screencap -p > "$HERE/home-after-retry.png" 2>/dev/null
echo "   截图：$HERE/home-after-retry.png（$(wc -c < "$HERE/home-after-retry.png") 字节）"

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
