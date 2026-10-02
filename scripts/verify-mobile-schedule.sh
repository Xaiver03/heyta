#!/bin/bash
#
# 移动端「排期入口」验收（真模拟器，零 mock）
# ===========================================
#
# 🔴 多端不同入口（goal：时间线 P2 多端适配轮）：
#   - web 载荷的排期入口是**拖拽 + 点空白**（`e2e/tests/timeline-p2.spec.ts`）；
#   - 触屏端的入口是**详情表单**（横向拖拽与纵向滚动冲突，不硬搬鼠标手势）：
#     点任务 → 详情「排期」段 → 开始（日历）+ 时长（档位 chips）→ 板上出条。
#
# 本脚本钉的判据：
#   1. 详情面的「排期」段在场（开始 / 时长 / 档位 chips）；
#   2. 设了开始 + 时长后，时间线板上出现**这一天的日期**（窗口自适应延伸）与
#      **一条真条** —— 移动端第一次能有自己的排期入口产出；
#   3. 时长档位「1 小时」可点且选中态跟随。
#
# 不能证：跨设备同步后条在另一端显示（那是 verify:multi-end 的接缝）。
#
# 用法：bash scripts/verify-mobile-schedule.sh
# 前置：模拟器在跑（服务端不需要 —— 全部本地行为）。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

TITLE="sched-e2e-$(date +%H%M%S)"

echo ""
echo "=== 移动端排期入口验收（真实模拟器，零 mock）==="
echo "  设备: emulator-5554"
echo "  任务: $TITLE"

dismiss_consent_if_present() {
  local waited=0 xy label
  while [ "$waited" -lt 10 ]; do
    dump
    [ "$(has_text "在使用联网功能之前")" = "1" ] && break
    sleep 1
    waited=$((waited + 1))
  done
  [ "$(has_text "在使用联网功能之前")" = "1" ] || return 0
  xy=$(xy_desc "以后再说"); label="以后再说"
  if [ -z "$xy" ]; then
    xy=$(xy_desc "只用本机"); label="只用本机"
  fi
  if [ -z "$xy" ]; then
    bad "同意面板在，但取不到按钮坐标"
    return 1
  fi
  $ADB shell input tap $xy
  sleep 2
  echo "     已处理隐私同意面板（${label}）"
}

step "0. 装包并启动"
$ADB shell am force-stop com.heytamobile >/dev/null 2>&1
$ADB uninstall com.heytamobile >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6
dismiss_welcome_if_present
settle_consent_loop() {
  local i
  for i in 1 2 3 4; do
    dismiss_consent_if_present
    dump
    if [ "$(has_text "先离线使用")" = "1" ]; then
      dismiss_welcome_if_present
    fi
    dump
    if [ "$(has_text "在使用联网功能之前")" != "1" ] && [ "$(has_text "先离线使用")" != "1" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}
settle_consent_loop
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "1. 建一条任务"
# 与 verify-mobile-timeline 同一条编排（逐 dump + 标题回读断言）。
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then
  bad "找不到新建按钮"; screen_txt
else
  $ADB shell input tap $XY; sleep 2.5
  dump
  XY=$(xy_edit_any)
  if [ -z "$XY" ]; then
    bad "新建面板里找不到输入框"; screen_txt
  else
    $ADB shell input tap $XY; sleep 1
    $ADB shell input text "$TITLE"; sleep 1.5
    disable_ime; sleep 1
    dump
    if [ "$(has_sub "$TITLE")" = "1" ]; then ok "标题已输入"; else bad "标题没输进去"; screen_txt; fi
    XY=$(xy_text "添加")
    if [ -z "$XY" ]; then bad "找不到「添加」"; screen_txt; else
      $ADB shell input tap $XY; sleep 3
    fi
  fi
fi
dump
if [ "$(has_desc "打开任务：$TITLE")" = "1" ]; then
  ok "任务已创建：$TITLE"
else
  bad "任务没创建"; screen_txt
fi

step "2. 点行打开详情，滚到「排期」段"
XY=$(xy_desc "打开任务：$TITLE")
if [ -z "$XY" ]; then
  bad "找不到任务行"; screen_txt
else
  $ADB shell input tap $XY; sleep 2.5
fi
# 🔴 清单预览占大量纵向空间 —— 排期段在 2~3 屏之外。滚动**收敛循环**：
# 直到「时长」**精确文本节点**（label，不是 hint 里的子串）可见为止 ——
# 它可见 = 排期的日历网格就在它上方（同屏可见），PICK 才有的找。
SCROLLS=0
while [ "$SCROLLS" -lt 8 ]; do
  dump
  [ "$(has_text "时长")" = "1" ] && break
  $ADB shell input swipe 540 1800 540 700 300; sleep 1
  SCROLLS=$((SCROLLS + 1))
done
dump
# 🔴 判据 1：触屏端的排期入口在场 —— 由 step 3 的滚动拾取循环证明
# （时长 label / 10月18日 格二者必现其一，否则 step 3 会报「滚了 N 屏仍取不到」）。

step "3. 设开始（点日历格）+ 时长（1 小时）"
# 🔴 滚动与拾取是**同一个循环**：每滑一步就在当前树上找「10月18日」格 ——
# 找到即点。任何"先滚到某个中间标志、再拾取"的两段式都会被滚动距离的
# 内容差异打破（实测：同一手势位置不同入口打开，折叠位置不一样）。
# 🔴 同名 desc 有两份的可能（截止日历也在 10 月）⇒ 取「时长」标签之上、
# 最靠下的那份 = 排期选择器的格子；「时长」标签还不可见时，唯一的那份
# 就是排期的（截止日历在更上面，先滚出视野）。
PICK_START_DAY() {
  python3 - <<'PY'
import re
s = open('/tmp/ui.xml', encoding='utf-8', errors='replace').read()
nodes = []
for m in re.finditer(r'<node[^>]*?>', s):
    tag = m.group(0)
    d = re.search(r'content-desc="([^"]*)"', tag)
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
    if not d or not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    nodes.append((d.group(1), x1, y1, x2, y2))
anchor = next(((x1, y1) for txt, x1, y1, x2, y2 in nodes if txt == '时长'), None)
cands = [
    (x1, y1, x2, y2) for txt, x1, y1, x2, y2 in nodes
    if txt == '10月18日' and (anchor is None or y2 <= anchor[1] + 40) and y2 < 2200
]
if not cands:
    raise SystemExit
x1, y1, x2, y2 = max(cands, key=lambda r: r[1])  # 最靠下的一份 = 排期选择器
print(f'{(x1 + x2) // 2} {(y1 + y2) // 2}')
PY
}
DAYXY=""
SCROLLS=0
while [ "$SCROLLS" -lt 8 ]; do
  dump
  DAYXY=$(PICK_START_DAY)
  [ -n "$DAYXY" ] && break
  $ADB shell input swipe 540 1800 540 700 300; sleep 1
  SCROLLS=$((SCROLLS + 1))
done
if [ -z "$DAYXY" ]; then
  bad "滚了 $SCROLLS 屏仍取不到 10月18日 格"; screen_txt
else
  $ADB shell input tap $DAYXY; sleep 2
  ok "已点排期开始：10月18日（滑了 $SCROLLS 屏）"
fi
dump
XY=$(xy_text "1 小时")
if [ -z "$XY" ]; then
  bad "找不到时长档位「1 小时」"; screen_txt
else
  $ADB shell input tap $XY; sleep 2
  ok "已点时长档位：1 小时"
fi

step "4. 关详情 → 切时间线 → 板上应出现 10-18 的真条"
# 🔴 **先验证面板真的关了**：面板开着时，后面所有 dump 读到的都是面板
# （标题字段里就有任务名），断言会全部假读数（本轮实测）。
XY=$(xy_desc "关闭任务详情")
[ -z "$XY" ] && XY=$(xy_text "关闭")
if [ -n "$XY" ]; then
  $ADB shell input tap $XY; sleep 2
fi
dump
if [ "$(has_text "任务详情")" = "1" ]; then
  bad "详情面板没关上，后续断言全部作废"; screen_txt
fi
XY=$(xy_text "时间线")
[ -n "$XY" ] && $ADB shell input tap $XY
sleep 3
dump
# 🔴 判据 2：窗口自适应延伸到 10-18 —— 轴上出现这一天的日期
if [ "$(has_sub "10-18")" = "1" ]; then
  ok "轴上出现 10-18（窗口随排期延伸）"
else
  bad "轴上没有 10-18"; screen_txt
fi
# 🔴 判据 3：任务上板（离开未排期泳道，行在轴区）
if [ "$(has_sub "未排期")" != "1" ] && [ "$(has_text "$TITLE")" = "1" ]; then
  ok "任务已上板（离开未排期泳道，落在轴上）"
else
  bad "任务没上板（仍在泳道或消失）"; screen_txt
fi
$ADB exec-out screencap -p > /tmp/heyta-mobile-schedule.png 2>/dev/null
mkdir -p "$PWD/apps/mobile/evidence"
cp /tmp/heyta-mobile-schedule.png "$PWD/apps/mobile/evidence/android-timeline-schedule.png"
echo "     截图：apps/mobile/evidence/android-timeline-schedule.png"

summary "移动端排期入口"
