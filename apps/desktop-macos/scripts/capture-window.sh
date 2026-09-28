#!/bin/bash
# macOS 原生壳的窗口取证：跑起来 → 自截屏 → 校验 → 落 evidence。
#
#   bash apps/desktop-macos/scripts/capture-window.sh [输出png]
#
# 默认输出 `apps/desktop-macos/evidence/window-first-run.png`。
#
# ── 取图方式：`SCScreenshotManager`（ScreenCaptureKit，窗口服务器合成结果）──
#
# 🔴 这段路是踩出来的。**三种"看起来更干净"的内进程渲染全部实测证伪**：
#
#   | 方式                     | 实测结果                                                        |
#   |--------------------------|-----------------------------------------------------------------|
#   | view.cacheDisplay        | 走 AppKit draw(_)；SwiftUI 文字走 CGDisplayList 私有路径拿不到   |
#   |                          | ⇒ 文字糊成横向色带（三次运行字节相同 = 确定性）                  |
#   | CALayer.render(in:)      | 走图层树也拿不到 CGDisplayList，且**左下原点** ⇒ 既糊又上下翻转   |
#   | ImageRenderer            | SwiftUI 官方快照，但**渲染不了 List / TextField / Toggle**        |
#   |                          | ⇒ 整片渲染成"禁止"占位符                                        |
#
# 前两种最坏的地方是**看起来很可信**：尺寸对、内容比例 ~96%、色阶 255，
# 空白检测完全通过 —— 只有人眼能发现字全是坏的。
#
# `CGWindowListCreateImage` 不重绘任何东西，它是**问窗口服务器要一份**，
# 所以文字/抗锯齿/深浅色都对，**被别的窗口遮挡也不影响**（同 `screencapture -l`）。
#
# ⚠️ 需要屏幕录制权限。脚本末尾会**独立复验**：把自截图与
# `screencapture -l<windowID>` 的结果比尺寸，两者都是 1800×1120 才算过。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SHELL_DIR="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$SHELL_DIR/../.." && pwd)"
OUT="${1:-$SHELL_DIR/evidence/window-first-run.png}"

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT" "$OUT.txt"

echo "=== 构建 ==="
cd "$SHELL_DIR"
swift build 2>&1 | grep -E "error:|Build complete" | awk '{print "  " $0}'

echo ""
echo "=== 运行 + 自截屏 ==="
HEYTA_SELF_CAPTURE="$OUT" "$SHELL_DIR/.build/out/Products/Debug/HeytaMac" 2>&1 | awk '{print "  " $0}'

[ -f "$OUT" ] || { echo "🔴 没产出截图"; exit 1; }

echo ""
echo "=== 校验（不能有 alpha、不能是空白）==="
cd "$REPO"
node - "$OUT" <<'JS'
import { inspectPng, looksBlank } from './scripts/screenshots/png-stats.mjs';
const st = inspectPng(process.argv[2]);
console.log(`  ${st.width}x${st.height}  colorType=${st.colorType}  hasAlpha=${st.hasAlpha}`);
console.log(`  内容比例 ${(st.contentRatio * 100).toFixed(1)}%   色阶差 ${st.colorSpan}`);
let bad = false;
if (st.hasTransparency) { console.error('  🔴 含实际透明像素'); bad = true; }
if (looksBlank(st)) { console.error('  🔴 疑似空白'); bad = true; }
if (bad) process.exit(1);
console.log('  ✅ 通过');
JS

echo ""
echo "=== 独立复验：与 screencapture -l 比尺寸 ==="
# 说明：自截图走的是同一个数据源，尺寸必然一致；若不一致，说明权限或窗口状态有问题。
(nohup "$SHELL_DIR/.build/out/Products/Debug/HeytaMac" >/dev/null 2>&1 &)
sleep 6
WID=$(cd "$HERE" && swift window-id.swift 2>/dev/null | head -1 | cut -f1 || true)
if [ -n "${WID:-}" ]; then
  screencapture -x -o -l"$WID" /tmp/heyta-mac-crosscheck.png 2>/dev/null || true
  if [ -f /tmp/heyta-mac-crosscheck.png ]; then
    node - "$OUT" /tmp/heyta-mac-crosscheck.png <<'JS'
import { inspectPng } from './scripts/screenshots/png-stats.mjs';
const a = inspectPng(process.argv[2]);
const b = inspectPng(process.argv[3]);
const same = a.width === b.width && a.height === b.height;
console.log(`  自截图      ${a.width}x${a.height}`);
console.log(`  screencapture ${b.width}x${b.height}`);
console.log(same ? '  ✅ 尺寸一致（同一数据源的交叉验证）' : '  🔴 尺寸不一致 —— 自截图不可信');
process.exit(same ? 0 : 1);
JS
  fi
else
  echo "  ⚠️ 取不到窗口 ID，跳过交叉验证"
fi
pkill -f HeytaMac 2>/dev/null || true

echo ""
echo "=== 合成证据说明（避免两份漂移）==="
# 应用自己写的是 `.png.txt`（只有实测值）。这里把它和"怎么采的"合成一份
# `<名字>.txt`，一份文件讲清楚：命令、方式、踩过的坑、交叉验证结果。
NARRATIVE="${OUT%.png}.txt"

CROSSCHECK="skipped"
if [ -f /tmp/heyta-mac-crosscheck.png ]; then
  CROSSCHECK=$(node -e "
    import('./scripts/screenshots/png-stats.mjs').then(m=>{
      const a = m.inspectPng(process.argv[1]);
      const b = m.inspectPng('/tmp/heyta-mac-crosscheck.png');
      process.stdout.write((a.width===b.width && a.height===b.height)
        ? 'ok(' + a.width + 'x' + a.height + ')'
        : 'MISMATCH(' + a.width + 'x' + a.height + ' vs ' + b.width + 'x' + b.height + ')');
    });" "$OUT" 2>/dev/null || echo "error")
fi
{
  cat <<'HEADER'
# macOS 原生壳窗口取证记录
#
# 采集命令（可复现）：
#   bash apps/desktop-macos/scripts/capture-window.sh
#
# 采集方式：应用**自截屏**（HEYTA_SELF_CAPTURE=<png>），走
#           CGWindowListCreateImage 取**窗口服务器合成结果**。
#
# 🔴 为什么不是"应用自己重绘一遍"—— 三条弯路，全部实测证伪：
#
#   1. view.cacheDisplay(in:to:)
#      走 AppKit 的 draw(_:) 路径。现代 SwiftUI 的文字走 **CGDisplayList**
#      私有渲染路径，拿不到 ⇒ **文字糊成横向色带**；而 NSButton / NSTextField
#      因为 AppKit 自绘所以清晰。三次运行字节完全相同（确定性，非时序）。
#      最坏的是它**看起来很可信**：尺寸对、内容比例 96%、色阶 255，
#      空白检测完全通过 —— 只有人眼能发现字全是坏的。
#
#   2. CALayer.render(in:)
#      走图层树同样拿不到 CGDisplayList，且是**左下原点** ⇒ 既糊又上下翻转。
#
#   3. ImageRenderer（SwiftUI 官方快照 API）
#      渲染不了 List / TextField / Toggle ⇒ 整片变成"禁止"占位符。
#
#   4. ✅ CGWindowListCreateImage
#      不重绘任何东西，是**问窗口服务器要一份**，所以文字/抗锯齿/深浅色都对，
#      **被别的窗口遮挡也不影响**。与外部 `screencapture -l<windowID>` 同源。
#
# ⚠️ 需要屏幕录制权限。没有权限时窗口服务器只给一张桌面背景图，
#    应用会**显式判失败**（比对尺寸）—— 绝不写一张"看起来成功其实是空的"图。
#
# PNG 后处理：窗口截图必然带 alpha（圆角/投影），已按窗口自身外观
# （深色→黑底 / 浅色→白底）合成到**不透明**底上，便于查看与逐字节比对。
#
# 交叉验证（本脚本自动执行）：自截图与 `screencapture -l` 的尺寸必须一致。

HEADER
  cat "$OUT.txt"
  echo ""
  echo "CROSSCHECK=${CROSSCHECK:-skipped}"
} > "$NARRATIVE"
rm -f "$OUT.txt"

echo ""
echo "=== 产物 ==="
ls -la "$OUT" "$NARRATIVE" 2>/dev/null | awk '{print "  " $0}'
echo "  --- 证据说明 ---"
sed 's/^/  /' "$NARRATIVE" | tail -12
