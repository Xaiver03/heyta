#!/usr/bin/env bash
# 「展开自托管表单之后，界面自己把够不着的那一段滚进来」这一格的**真机**读数（`808c1344` 那一改）。
#
# 为什么这条要单独跑：habits 那条完整腿（`run-leg.sh`）填字段用的是 `scroll_to_edit`，
# 它**自己会滚** —— 于是"三个字段都填上了"既可能来自产品补滚、也可能来自探针补滚，
# 那条腿分不出来。这里把探针的滑动能力**关掉**：只用当前那一拍里的坐标点一次展开行，
# 之后一根手指都不动，立刻再拍一拍，量那三格输入框与可滚区的关系。
#
# 判据（任一不满足就 FAIL）：
#   · 展开后那一拍里三格 EditText **全部在树上**
#     —— 旧包同一形状的那拍（同目录 `tree-A1-form-expanded.xml`）只有第一格在树里，
#       「访问令牌」「端到端加密口令」整枚不在无障碍树上；
#   · 每格 `y2 > y1`（没被裁成退化形状）；
#   · 每格中心都在可滚区下沿**之上**（旧包里第一格是 `[84,2125][996,2243]`，贴住 2400 那条边）。
#
# ⚠️ 射程：只证"展开那一下"的可见性。不证同步、不证凭据持久化（那些在完整腿里）。
# ⚠️ 对照那一拍来自**旧 APK** 那一趟（10-14 00:36 打的包），不是同一枚包 ——
#    所以它是"形状对照"，不是同一台机器同一枚产物下的 A/B。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
while [ "$REPO" != "/" ] && [ ! -f "$REPO/scripts/lib/mobile-e2e.sh" ]; do REPO="$(dirname "$REPO")"; done
[ -f "$REPO/scripts/lib/mobile-e2e.sh" ] || { echo "🔴 往上找不到 scripts/lib/mobile-e2e.sh"; exit 1; }
RUN="${HEYTA_R109_RUN:-$HOME/heyta-r109-leg}"
mkdir -p "$RUN"
cd "$REPO" || exit 1
export HEYTA_E2E_UI_XML="$RUN/autoscroll.xml" HEYTA_E2E_XY_PY="$RUN/_xy.py"
# shellcheck disable=SC1091
source scripts/lib/mobile-e2e.sh >/dev/null     # `ADB` 由 lib 给（lib:32-33）
SHOTS="$HERE"

measure() {  # <xml 路径> <那一拍叫什么>
  echo "   ▸ $2"
  python3 - "$1" <<'PY'
import re, sys
s = open(sys.argv[1], encoding='utf-8', errors='replace').read()
def attr(t, a):
    m = re.search(a + r'="([^"]*)"', t)
    return m.group(1) if m else ''
region = sheet = None
for t in re.findall(r'<node[^>]*?>', s):
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', t)
    if not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    if 'resource-id="settings-sheet"' in t:
        sheet = (x1, y1, x2, y2)
    if attr(t, 'scrollable') == 'true' and (region is None or y2 - y1 > region[3] - region[1]):
        region = (x1, y1, x2, y2)
want = ['服务器地址', '访问令牌', '端到端加密口令']
rows = []
for t in re.findall(r'<node[^>]*?>', s):
    if 'class="android.widget.EditText"' not in t:
        continue
    d = attr(t, 'content-desc')
    if d in want:
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', t)
        rows.append((d, *map(int, b.groups())))
rows.sort(key=lambda r: want.index(r[0]))
print(f"     浮层根={sheet} 可滚区={region}")
ok = True
for d, x1, y1, x2, y2 in rows:
    cy = (y1 + y2) // 2
    inside = region is not None and y2 > y1 and cy < region[3]
    print(f"     {d:<7s} bounds=[{x1},{y1}][{x2},{y2}] 高度{'正' if y2 > y1 else '退化'} 中心 y={cy} 在可滚区内={inside}")
    ok = ok and inside
missing = [w for w in want if w not in [r[0] for r in rows]]
if missing:
    ok = False
    print(f"     🔴 这三格整枚不在树里：{missing}")
print(f"     VERDICT={'PASS' if ok else 'FAIL'}")
PY
}

echo "── 0. 从零起点进设置面「同步与隐私」那一组"
$ADB shell am force-stop com.heyta; sleep 1
# 🔴 用 lib 的 `launch_app` + `ensure_app_foreground`，不要裸 `monkey` 之后就走：
#    第一版这里就是 `monkey` + `sleep 6`，冷启动没落地 ⇒ 前台停在**启动器**上，
#    后面每一发 `input tap` 都打在别人的界面上（lib:878 那条注释记的正是这个形状）。
launch_app; sleep 6
ensure_app_foreground || { echo "🔴 heyta 没回到前台，这一趟的读数都不算"; exit 1; }
dismiss_permission_dialog
dismiss_welcome_if_present
$ADB shell input tap 945 2253; sleep 3            # 「我的」
open_settings_section sync || { echo "🔴 进不去那一组"; exit 1; }

# 表单只在 `advancedSync` 为真时画。上一趟腿已经把凭据填过 ⇒ 现在这一面是"已展开"。
# 先把它收起来（这一步允许探针滑动 —— 它是在**找那颗收起键**，不是被测的那一下）。
dump
COLLAPSE=$(scroll_to_text "返回 heyta 官方同步")
if [ -n "$COLLAPSE" ]; then
  $ADB shell input tap $COLLAPSE; sleep 2
  echo "   已收起表单 @ $COLLAPSE"
else
  echo "   这一组里没有「返回 heyta 官方同步」⇒ 表单本来就没展开，直接进下一步"
fi

echo
echo "── 1. 只点一次「使用自托管服务器」，**之后一根手指都不动**"
dump
EXPAND=$(xy_text "使用自托管服务器"); [ -z "$EXPAND" ] && EXPAND=$(xy_desc "使用自托管服务器")
if [ -z "$EXPAND" ]; then
  # 允许滑动**只为找到这颗键**；找到之后就再也不动，被测的是点下去之后的那一拍
  EXPAND=$(scroll_to_text "使用自托管服务器")
fi
[ -z "$EXPAND" ] && { echo "🔴 找不到「使用自托管服务器」那一行，量不了展开那一下"; exit 1; }
$ADB shell input tap $EXPAND
echo "   已点 @ $EXPAND —— 下面这一拍没有任何滑动"
sleep 2.5
dump
cp "$UI_XML" "$SHOTS/tree-expand-no-swipe-current.xml"
measure "$SHOTS/tree-expand-no-swipe-current.xml" "当前包（含 808c1344）：展开后不滑"

echo
echo "── 2. 同一把尺量旧那一拍（同目录 tree-A1-form-expanded.xml，旧包、探针也没滑）"
measure "$HERE/tree-A1-form-expanded.xml" "旧包那一拍：展开后不滑"
