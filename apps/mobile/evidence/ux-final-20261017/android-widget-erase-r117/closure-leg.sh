#!/bin/bash
#
# 装机态「注销账号 = 连本机数据一起清」这一条产品路径 × 系统小组件读数的腿。
#
# 台账那一格的原话是"**清理数据后**系统小组件不继续展示旧任务"。这一族里"清理数据"
# 在产品上只有一条路径会真的把本机明文数据清掉（`eraseLocalData()`），也就是「注销账号」
# 那条；而「清除本机保存的凭据」只清凭据 + 组件快照。两条都要读数，前一枚的形状
# 已经由 `erase-leg2.sh` 取到（它在冷启动态是 disabled 的，见 RESULT.md）。
#
# 步骤文案与两层确认**直接抄** `scripts/verify-mobile-account-erasure.sh:645-700`
# 那套在册写法（勾选项走 content-desc、同名提交按钮按命中数取最后一枚），
# 不重新推导 —— 那两条都是这条腿历史上真踩过的坑。
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

step "0. 组件存储的初值（注销之前）"
sample "S0 注销前"

step "1. 走到「账号与安全」，进「注销账号」那一屏"
launch_app
sleep 4
dismiss_welcome_if_present
close_settings_sheet
# 🔴 这一枚不能拿 `tap_tab "我的" rid:profile-entry-settings` 当闸门：切过去是成功的
#    （屏上就是「我的」那一页：本周完成任务 / 尚未同步 / 通知 / 我的成长 / 习惯 / AI 助手 /
#    整理与记录 / 清单 / 标签），但「设置」那一格在这一页的**折叠线以下**，
#    而折叠线以下的节点整枚不在无障碍树里（lib 在 `configure_sync_credentials` 那一段
#    就为这件事写过注释）⇒ `tap_tab` 的回读永远"标记没出现"，三次点完还是红，
#    报出来像"进不去我的页"。切 tab 就只管切，找入口交给会滚的 `open_settings_section`。
TAB=$(xy_desc "我的")
if [ -n "$TAB" ]; then $ADB shell input tap $TAB; sleep 3; fi
# 🔴 这一枚入口的**所在层**要在场量里取，不按在册脚本的位置抄：
#    `verify-mobile-account-erasure.sh:645` 那套是在「我的」滚动流上
#    `scroll_to_text "注销账号"`（那时的 `ProfileScreen.tsx:680` 有这条 hint），
#    但设置 IA 收进 `SettingsScreen` + 目录层那一刀之后，实测这一枚落在
#    **设置 → 账号与安全**那一组里（`erase.txt` / `erase3.txt` 两趟的屏面读数都有它），
#    而「我的」滚动流滚 5 次找不到 —— 形状与"产品没有这一条"一模一样。
# 🔴 不用 `open_settings_section`：它内部那枚 `scroll_to_rid` 只滑 **5 下**就返回失败
#    （`scripts/lib/mobile-e2e.sh` 的 `scroll_to_rid`）。这一趟实测冷启动后「我的」页
#    在顶部，「设置」那一格在更下面，5 下不够 ⇒ 报「找不到那一格」，形状与
#    "产品没有设置入口"一模一样。这里把预算放开到 12 下，并把滑到底时的屏面打出来
#    —— 那样"入口在下面"与"这一页根本没有入口"两种结果就分得开了。
row=""
for i in $(seq 1 12); do
  dump
  row=$(xy_rid "profile-entry-settings")
  [ -n "$row" ] && break
  swipe_in_view; sleep 1.5
done
if [ -z "$row" ]; then
  echo "   ❌ 滑到第 ${i} 下仍没有 profile-entry-settings；最后一次屏面：$(texts)"
  exit 1
fi
echo "   第 ${i} 下滑到「设置」入口"
$ADB shell input tap $row; sleep 3
# 进了设置面再按分组定位「账号与安全」（目录层那一格是 settings-section-*）。
dir=""
for i in $(seq 1 8); do
  dump
  dir=$(xy_rid "settings-section-security")
  [ -n "$dir" ] && break
  swipe_in_view; sleep 1.5
done
if [ -z "$dir" ]; then
  echo "   ❌ 设置面目录里没有 settings-section-security；屏面：$(texts)"; exit 1
fi
$ADB shell input tap $dir; sleep 2
XY=$(scroll_to_text "注销账号")
if [ -z "$XY" ]; then
  dump; echo "   ❌「账号与安全」组里没有「注销账号」那一行；屏上：$(texts)"; exit 1
fi
$ADB shell input tap $XY; sleep 3
# 判"这屏真开了"用只有这一屏才有的那句 lead（在册判据，不用两页同名的标题）。
if ! settle_for "注销会永久删除这个账号在服务端的全部数据" 8 2; then
  dump; echo "   ❌ 注销屏没打开（没看到那句 lead）；屏上：$(texts)"; exit 1
fi
ok "注销屏已开"

step "2. 勾确认项（走 content-desc，那一句在本屏还当说明文字渲染过一遍）"
CHK="我确认：这台设备上还没同步出去的数据，连同本机明文存储，也会一起被清除。"
XY=$(xy_desc "$CHK")
[ -z "$XY" ] && XY=$(scroll_to_desc "$CHK")
if [ -z "$XY" ]; then
  dump; echo "   ❌ 勾不到那条确认；屏上：$(texts)"; exit 1
fi
$ADB shell input tap $XY; sleep 1
# 行为判据：提交按钮只在 acked 时才渲染 —— 它把"没勾上"和"产品没有按钮"分开。
if ! settle_for "注销这个账号" 8 2; then
  dump; echo "   ❌ 打勾后提交按钮没出现（那一下没勾上）；屏上：$(texts)"; exit 1
fi
ok "已勾上（提交按钮出现了）"

step "3. 提交 + 第二层确认（同名按钮按命中数取最后一枚 = 模态那一枚）"
XY=$(scroll_to_text "注销这个账号")
$ADB shell input tap $XY; sleep 2
if settle_for "确认注销这个账号？" 8 2; then
  N=$(grep -o 'text="注销这个账号"' "$UI_XML" | wc -l | tr -d ' ')
  IDX=$((N - 1)); [ "$IDX" -lt 0 ] && IDX=0
  XY2=$(python3 "$XY_PY" text "注销这个账号" "$IDX")
  if [ -n "$XY2" ]; then
    $ADB shell input tap $XY2
    echo "   第二层确认：树里 $N 枚同名按钮，点了第 $((IDX + 1)) 枚"
  fi
else
  echo "   没出现第二层确认 —— 继续等结果文案"
fi

step "4. 等结果文案（最多 20 轮 × 2s）"
DONE=0
for i in $(seq 1 20); do
  dump
  if [ "$(has_sub "账号已注销，这台设备上的本地副本也已清除")" = "1" ]; then DONE=1; break; fi
  if [ "$(has_sub "需要你手动处理")" = "1" ]; then DONE=2; break; fi
  sleep 2
done
case "$DONE" in
  1) ok "界面回的是「本地副本也已清除」" ;;
  2) echo "   ⚠️ 界面回的是「需要你手动处理」那一支（部分成功）"; dump; echo "   屏上：$(texts)" ;;
  *) echo "   ❌ 40 秒内没有结果文案"; dump; echo "   屏上：$(texts)" ;;
esac

step "5. 注销之后组件存储与组件卡"
sleep 6
sample "S1 注销后"
$ADB shell input keyevent KEYCODE_HOME; sleep 2
CARD_TAG=closure python3 "$HERE/../../ux-final-20261016/android-widget-click-r115/widget-data-leg.py" \
  "$E2E_SERIAL" "$HERE" readcard
sleep 8
sample "S2 注销后 +卡读数之后再取一次（有没有被重新发布）"
echo "PASS=$PASS FAIL=$FAIL"
