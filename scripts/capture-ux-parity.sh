#!/usr/bin/env bash
# UX 对照截图 + 读数归档
# ========================
#
# 用户要求（2026-11-14）：「尽可能截图保存，各种截图都保存下来，方便后续比对分类。」
#
# 为什么截图和 dump **必须成对**：
#   · 截图给人和能看图的模型看（形状、间距、层级）；
#   · `uiautomator dump` 给读数用（bounds ÷ 3 = dp，可复算、可回归）。
#   只存图 ⇒ 下次只能靠眼看；只存 xml ⇒ 对不出视觉。两者同名同目录才能对上。
#
# 用法：
#   scripts/capture-ux-parity.sh ticktick tasks
#   scripts/capture-ux-parity.sh heyta   calendar
#
# 产物（仓内，遵循 check:evidence-hygiene 的预算）：
#   apps/mobile/evidence/ux-parity-20261114/<side>-<module>.png
#   apps/mobile/evidence/ux-parity-20261114/<side>-<module>.xml
#
# ⚠️ 只拍**当前屏**，不点击。导航由调用方负责 —— 脚本里塞点击流程会让
#    每一张图都依赖上一张的落点，一处偏移后面全错（这类事故在 CAPTURE-LOG 里记过）。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/apps/mobile/evidence/ux-parity-20261114"

side="${1:?用法: capture-ux-parity.sh <ticktick|heyta> <module>}"
module="${2:?用法: capture-ux-parity.sh <ticktick|heyta> <module>}"

mkdir -p "$OUT"
name="$side-$module"

# 🔴 前台校验：这一条是血的教训。2026-11-14 一次 `back` 按多了把应用退回桌面，
# 我看都没看就拍了，于是 `heyta-profile.png/xml` 变成了**手机桌面**的截图
#（里面是「微信」「相机」「冷宫」这些 app 图标）。污染的证据比没有证据更糟：
# 下一次拿它算读数，算出来的是桌面的行高。
case "$side" in
  heyta)    want="com.heyta" ;;
  ticktick) want="ticktick" ;;
  *)        want="" ;;
esac
if [ -n "$want" ]; then
  fg=$(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | sed 's/.*u0 //;s/}.*//')
  case "$fg" in
    *"$want"*) : ;;
    *)
      echo "拒绝保存：前台是 $fg，不是 $want（$side）" >&2
      exit 4
      ;;
  esac
fi

adb shell screencap -p "/sdcard/uxcap.png" >/dev/null
adb pull "/sdcard/uxcap.png" "$OUT/$name.png" >/dev/null 2>&1
adb shell uiautomator dump "/sdcard/uxcap.xml" >/dev/null 2>&1
adb pull "/sdcard/uxcap.xml" "$OUT/$name.xml" >/dev/null 2>&1

# 打印这一屏的"五条读数"里能量化的三条（行高 / 行距 / 对齐轴），
# 让人在拍完之后立刻看见数字，而不是等下次回头再算。
python3 - "$OUT/$name.xml" "$name" <<'PY'
import re, sys, xml.etree.ElementTree as ET

path, name = sys.argv[1], sys.argv[2]
try:
    root = ET.parse(path).getroot()
except Exception as exc:  # noqa: BLE001 - 这里就是要把它报出来
    print(f"[{name}] xml 解析失败：{exc}")
    raise SystemExit(0)

rows = []
for node in root.iter():
    box = node.get('bounds') or ''
    m = list(map(int, re.findall(r'\d+', box)))
    if len(m) != 4:
        continue
    text = (node.get('text') or node.get('content-desc') or '').strip()
    if not text or m[3] - m[1] <= 0:
        continue
    clickable = node.get('clickable') == 'true'
    rows.append((m[1], m[0], m[3] - m[1], m[2] - m[0], text, clickable))

rows.sort()
heights = sorted({h for _, _, h, _, _, c in rows if c and h >= 60})
lefts = sorted({x for _, x, _, _, _, _ in rows})
steps = []
prev = None
for y, _, _, _, _, c in rows:
    if not c:
        continue
    if prev is not None and 60 <= y - prev <= 400:
        steps.append(y - prev)
    prev = y

print(f"[{name}] 节点(带文字)={len(rows)}")
if heights:
    print(f"  可点行高档位: {[f'{h}px={h//3}dp' for h in heights[:6]]}")
if steps:
    uniq = sorted(set(steps))
    print(f"  相邻可点行距: {[f'{s}px={s//3}dp' for s in uniq[:6]]}")
print(f"  文字左缘种类: {len(lefts)} 条 → {lefts[:8]}")
PY

echo "已存档：$OUT/$name.{png,xml}"
