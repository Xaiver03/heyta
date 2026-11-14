#!/usr/bin/env bash
# 按可见文字点一下（先 dump 拿真实坐标，不猜）
# =============================================
#
# 为什么要这个：2026-11-14 的一轮里，我连续三次按"我以为的行位置"点，结果落到
# 了隔壁那一行（语言 → 功能与 AI → AI 工具箱 → AI 设置），每次都要重来。
# 原因不是坐标算错，是**行位置会变**（删掉一句页头说明，整个列表就上移 54px）。
#
# 所以导航一律：dump → 按文字找节点 → 取 bounds 中心 → 点 → 校验落点。
#
# 用法：
#   scripts/tap-by-text.sh "倒数纪念日"
#   scripts/tap-by-text.sh --desc "打开任务：TESTUX"     # 按 content-desc 找
#   scripts/tap-by-text.sh --require heyta "设置"         # 点完校验前台仍是 heyta
#
# 退出码：找不到 ⇒ 2；点完前台不对 ⇒ 3。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mode="any"
require=""
while [ $# -gt 0 ]; do
  case "$1" in
    --desc) mode="desc"; shift ;;
    --text) mode="text"; shift ;;
    --require) require="$2"; shift 2 ;;
    *) break ;;
  esac
done
needle="${1:?用法: tap-by-text.sh [--desc] [--require <pkg>] <文字>}"

adb shell uiautomator dump /sdcard/tap-probe.xml >/dev/null 2>&1
adb pull /sdcard/tap-probe.xml "$ROOT/.tap-probe.xml" >/dev/null 2>&1

read -r cx cy found < <(python3 - "$ROOT/.tap-probe.xml" "$needle" "$mode" <<'PY'
import re, sys, xml.etree.ElementTree as ET

path, needle, mode = sys.argv[1], sys.argv[2], sys.argv[3]
root = ET.parse(path).getroot()

best = None
for node in root.iter():
    text = node.get('text') or ''
    desc = node.get('content-desc') or ''
    # 默认**两者都查**：同一个入口在有的屏上只有 text（列表行），有的屏上只有
    # content-desc（图标按钮，如「打开搜索」）。只查一种就会「找不到」，
    # 而那个「找不到」看起来像界面变了，实际是我查错了字段。
    if mode == 'desc':
        hay = desc
    elif mode == 'text':
        hay = text
    else:
        hay = text + '\x00' + desc
    if needle not in hay:
        continue
    box = list(map(int, re.findall(r'\d+', node.get('bounds') or '')))
    if len(box) != 4:
        continue
    x0, y0, x1, y1 = box
    if x1 <= x0 or y1 <= y0:
        continue
    # 排序键：**可点的优先**，其次面积小的优先。
    # 🔴 第一版只按面积排，于是点「功能与 AI」时命中了**页面标题**那几像素
    # （它比列表行面积小），点下去什么也没发生。标题不可点，列表行才可点。
    clickable = 0 if node.get('clickable') == 'true' else 1
    area = (x1 - x0) * (y1 - y0)
    key = (clickable, area)
    if best is None or key < best[0]:
        best = (key, (x0 + x1) // 2, (y0 + y1) // 2)

if best is None:
    print("-1 -1 0")
else:
    print(f"{best[1]} {best[2]} 1")
PY
)

rm -f "$ROOT/.tap-probe.xml"

if [ "$found" != "1" ]; then
  echo "找不到「${needle}」（mode=${mode}）" >&2
  exit 2
fi

adb shell input tap "$cx" "$cy" >/dev/null 2>&1
sleep 1.8

if [ -n "$require" ]; then
  fg=$(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | sed 's/.*u0 //;s/}.*//')
  case "$fg" in
    *"$require"*) : ;;
    *) echo "点完前台不是 ${require}，而是 ${fg}" >&2; exit 3 ;;
  esac
fi

echo "已点「${needle}」 @ ${cx},${cy}"
