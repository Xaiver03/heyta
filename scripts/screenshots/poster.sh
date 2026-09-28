#!/bin/bash
# 宣传海报 / 分享图生成：SVG → PNG + PDF（一条命令，可复现）。
#
#   bash scripts/screenshots/poster.sh <input.svg> [输出目录] [PNG 宽度的倍数]
#
# 例：
#   bash scripts/screenshots/poster.sh apps/landing/public/poster.svg outputs/marketing
#
# ── 为什么要有这个脚本 ───────────────────────────────────────────────────
#
# SSOS 那边的海报是**手写 SVG**（`outputs/marketing/*-poster.svg`，1200×1600），
# 但**没有留下生成 PNG/PDF 的脚本** —— 也就是说那一步是手工做的、不可复现，
# 换台机器或换个人就重来不了。这里把它补成一条命令。
#
# ── 做法 ─────────────────────────────────────────────────────────────────
#
# 1. SVG **手写**（用 `<defs>` 里的渐变做视觉分层，见 README「宣传海报」一节）；
# 2. `rsvg-convert` 渲染成 PNG（指定宽度，高度按 viewBox 比例自动）；
# 3. `rsvg-convert -f pdf` 出矢量 PDF（印刷/发邮件用）；
# 4. 🔴 用本仓库的 `png-stats.mjs` **自检**：不能有 alpha、不能是空白。
#    海报最容易出的两种事故是「导出成全透明」和「文字字体缺失导致整块空白」，
#    人工只看一眼 PNG 缩略图是发现不了的。
set -euo pipefail

SVG="${1:-}"
OUT_DIR="${2:-outputs/marketing}"
SCALE="${3:-1}"

[ -n "$SVG" ] || { echo "用法: bash scripts/screenshots/poster.sh <input.svg> [输出目录] [倍数]"; exit 1; }
[ -f "$SVG" ] || { echo "🔴 找不到 SVG：$SVG"; exit 1; }
command -v rsvg-convert >/dev/null || { echo "🔴 需要 rsvg-convert（brew install librsvg）"; exit 1; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
base="$(basename "$SVG" .svg)"
# OUT_DIR 允许是绝对路径（传给别的目录做产物对比时很有用）
case "$OUT_DIR" in
  /*) OUT="$OUT_DIR" ;;
  *)  OUT="$ROOT/$OUT_DIR" ;;
esac
mkdir -p "$OUT"

# viewBox 里拿原始尺寸；拿不到就用 rsvg-convert 的默认
read -r VB_W VB_H < <(python3 - "$SVG" <<'PY'
import re, sys, pathlib
head = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')[:4000]
m = re.search(r'viewBox="\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)', head)
if m:
    print(int(float(m.group(1))), int(float(m.group(2))))
else:
    w = re.search(r'width="([\d.]+)', head)
    h = re.search(r'height="([\d.]+)', head)
    print(int(float(w.group(1))) if w else 1200, int(float(h.group(1))) if h else 1600)
PY
)

PNG_W=$((VB_W * SCALE))
PNG_H=$((VB_H * SCALE))

echo "=== 渲染 PNG（${PNG_W}×${PNG_H}）==="
rsvg-convert -w "$PNG_W" -h "$PNG_H" "$SVG" -o "$OUT/$base.png"

echo "=== 渲染 PDF（矢量）==="
rsvg-convert -f pdf "$SVG" -o "$OUT/$base.pdf"

echo ""
echo "=== 自检（不能有 alpha、不能是空白）==="
cd "$ROOT"
node - "$OUT/$base.png" <<'JS'
import { inspectPng, looksBlank } from './scripts/screenshots/png-stats.mjs';

const file = process.argv[2];
const stats = inspectPng(file);
console.log(`  ${stats.width}×${stats.height}  colorType=${stats.colorType}  hasAlpha=${stats.hasAlpha}`);
console.log(`  内容比例 ${(stats.contentRatio * 100).toFixed(1)}%   色阶差 ${stats.colorSpan}`);

let bad = false;
if (stats.hasAlpha) {
  console.error('  🔴 含透明通道 —— 海报要印/要发，不能带 alpha');
  bad = true;
}
if (looksBlank(stats)) {
  console.error('  🔴 疑似空白 —— 多半是字体缺失或导出失败把内容弄没了');
  bad = true;
}
if (bad) process.exit(1);
console.log('  ✅ 通过');
JS

echo ""
echo "=== 产物 ==="
ls -la "$OUT/$base".* 2>/dev/null | sed 's/^/  /'
