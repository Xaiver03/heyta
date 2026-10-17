#!/bin/bash
#
# r119 第 2 腿：**已同意联网 + 已同步**的态下走「注销账号」，量组件与本机数据到底清没清。
# =============================================================================
# 这一腿要补的是 r117 那页的"不证 #1"：那条路当时被隐私同意闸门挡住，
# `eraseLocalData()` 之后组件清不清**没有设备读数**。
#
# 起点态由 leg1 + leg1b 造好，并且**每一项都有独立计数器**（不靠界面回读）：
#   · 隐私同意 = accepted（`device_pref.privacy.consent` 现读，决定于 07:14:54Z）
#   · 会话是真的（`access_sessions`=1）
#   · **同步推上去了**（`operations` 从 0 涨到 9、`user_sync_state`=1、我的页那行变成「已是最新」）
#   · 卡上有真任务（`[读卡 before] 卡上文字=['2026-10-17 · 0/2', '○ L119UrgentImportant', '○ L119Urgent']`）
#   · 组件存储 1278 B / [snapshot_v1]
#
# 🔴 这一腿**不 force-stop、不 pm clear**：端到端口令按设计只放内存
#    （界面那行原话「只存在内存里，应用重启后需要重新输入」），杀进程就等于把被测前提抹掉。
set -u
export PATH="/opt/homebrew/bin:$PATH"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE"; while [ "$ROOT" != "/" ] && [ ! -e "$ROOT/.git" ]; do ROOT="$(dirname "$ROOT")"; done
[ -e "$ROOT/.git" ] || { echo "❌ 退到 / 也没找到仓库根"; exit 3; }

export PORT=4520 HEYTA_E2E_DB=heyta_uxr119
export HEYTA_E2E_TOKEN_FILE=/Users/rocalight/heyta-r119-leg/token.txt
export HEYTA_E2E_EMAIL_FILE=/Users/rocalight/heyta-r119-leg/email.txt
export HEYTA_E2E_E2EE_FILE=/Users/rocalight/heyta-r119-leg/e2ee.txt
export HEYTA_E2E_UI_XML=/Users/rocalight/heyta-r119-leg/ui3.xml
export HEYTA_E2E_XY_PY=/Users/rocalight/heyta-r119-leg/xy.py
. "$ROOT/scripts/lib/mobile-e2e.sh"

PREFS=/data/data/com.heyta/shared_prefs/heyta_widget.xml
DB=/data/data/com.heyta/databases/heyta.sqlite
LEG=apps/mobile/evidence/ux-final-20261016/android-widget-click-r115/widget-data-leg.py

sample() {
  local tag="$1" meta keys
  meta=$($ADB shell "stat -c '%y|%s' $PREFS" </dev/null 2>/dev/null | tr -d '\r')
  keys=$($ADB shell "grep -o -e snapshot_v1 -e intents_v1 $PREFS" </dev/null 2>/dev/null | tr -d '\r' | sort | uniq | tr '\n' ' ')
  printf '   [%s] %s  键=[%s]\n' "$tag" "${meta:-文件不存在}" "${keys:-（空）}"
}
localdb() {
  printf '   [%s] 本机库 %s\n' "$1" "$($ADB shell "stat -c 'mtime=%y size=%s' $DB" </dev/null 2>/dev/null | tr -d '\r')"
}
srv() { printf '   [%s] %s\n' "$1" "$(/opt/homebrew/bin/psql -d "$HEYTA_E2E_DB" -At \
  -c "select 'operations='||(select count(*) from operations)||' sync_state='||(select count(*) from user_sync_state)||' users='||(select count(*) from users)||' tombstones='||(select count(*) from account_tombstones)" 2>&1 | head -1)"; }
texts() { python3 - "$UI_XML" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
print(" | ".join([m.group(1) for m in re.finditer(r'text="([^"]{2,})"', xml)][:26]))
PY
}

step "0. 注销之前：三枚独立计数器"
sample "S0 组件存储"; localdb "S0 本机库"; srv "S0 服务端"

step "1. 走到「账号与安全」→「注销账号」那一屏"
launch_app; sleep 4; close_settings_sheet
TAB=$(xy_desc "我的"); [ -n "$TAB" ] && { $ADB shell input tap $TAB; sleep 3; }
row=""
for i in $(seq 1 12); do dump; row=$(xy_rid "profile-entry-settings"); [ -n "$row" ] && break; swipe_in_view; sleep 1.5; done
[ -n "$row" ] || { echo "   ❌ 找不到设置入口；屏上：$(texts)"; exit 1; }
$ADB shell input tap $row; sleep 3
dir=""
for i in $(seq 1 8); do dump; dir=$(xy_rid "settings-section-security"); [ -n "$dir" ] && break; swipe_in_view; sleep 1.5; done
[ -n "$dir" ] || { echo "   ❌ 目录里没有安全组；屏上：$(texts)"; exit 1; }
$ADB shell input tap $dir; sleep 2
XY=$(scroll_to_text "注销账号")
[ -n "$XY" ] || { echo "   ❌ 安全组里没有「注销账号」；屏上：$(texts)"; exit 1; }
$ADB shell input tap $XY; sleep 3
settle_for "注销会永久删除这个账号在服务端的全部数据" 8 2 || { echo "   ❌ 注销屏没开；屏上：$(texts)"; exit 1; }
ok "注销屏已开"

step "2. 勾确认项 → 提交 → 第二层确认（写法抄在册脚本）"
CHK="我确认：这台设备上还没同步出去的数据，连同本机明文存储，也会一起被清除。"
XY=$(xy_desc "$CHK"); [ -z "$XY" ] && XY=$(scroll_to_desc "$CHK")
[ -n "$XY" ] || { echo "   ❌ 勾不到确认项；屏上：$(texts)"; exit 1; }
$ADB shell input tap $XY; sleep 1
settle_for "注销这个账号" 8 2 || { echo "   ❌ 打勾后提交按钮没出现；屏上：$(texts)"; exit 1; }
XY=$(scroll_to_text "注销这个账号"); $ADB shell input tap $XY; sleep 2
if settle_for "确认注销这个账号？" 8 2; then
  N=$(grep -o 'text="注销这个账号"' "$UI_XML" | wc -l | tr -d ' ')
  IDX=$((N - 1)); [ "$IDX" -lt 0 ] && IDX=0
  XY2=$(python3 "$XY_PY" text "注销这个账号" "$IDX")
  [ -n "$XY2" ] && { $ADB shell input tap $XY2; echo "   第二层确认：树里 $N 枚同名，点第 $((IDX + 1)) 枚"; }
fi

step "3. 等结果文案（最多 20 轮 × 2s）"
DONE=0
for i in $(seq 1 20); do
  dump
  [ "$(has_sub "账号已注销，这台设备上的本地副本也已清除")" = "1" ] && { DONE=1; break; }
  [ "$(has_sub "需要你手动处理")" = "1" ] && { DONE=2; break; }
  [ "$(has_sub "你还没有同意这台设备的隐私规则")" = "1" ] && { DONE=3; break; }
  sleep 2
done
case "$DONE" in
  1) ok "界面回的是「本地副本也已清除」" ;;
  2) echo "   ⚠️ 回的是「需要你手动处理」那一支（部分成功）"; echo "   屏上：$(texts)" ;;
  3) echo "   ❌ 仍被隐私同意闸门挡住 —— 那 leg1 的同意态没生效"; echo "   屏上：$(texts)" ;;
  *) echo "   ❌ 40 秒内没有结果文案"; echo "   屏上：$(texts)" ;;
esac

step "4. 注销之后：同样那三枚计数器 + 卡面"
sleep 6
sample "S1 注销后"; localdb "S1 注销后"; srv "S1 服务端"
$ADB shell input keyevent KEYCODE_HOME; sleep 2
CARD_TAG=after python3 "$ROOT/$LEG" "$E2E_SERIAL" "$HERE" readcard
sleep 10
sample "S2 再读一次（有没有被重新发布）"; localdb "S2 本机库"; srv "S2 服务端"
echo "DONE_BRANCH=$DONE"
echo "PASS=$PASS FAIL=$FAIL"
