#!/bin/bash
# 生成 iOS App 图标（从 `apps/web/public/icons/icon.svg` 派生）。
#
#   bash apps/mobile/ios/scripts/generate-app-icons.sh
#
# ## 为什么用「单尺寸 universal 1024」而不是老的 9 槽写法
#
# 本工程的 `TARGETED_DEVICE_FAMILY = "1,2"`（**iPhone + iPad 都支持**）。
# 老的 9 槽写法只声明 iPhone 条目 ⇒ 构建出来**只有 iPhone 图标、iPad 没有**
# （实测：归档里只有 `AppIcon60x60@2x.png`，缺 `AppIcon76x76@2x~ipad.png`）。
# 单尺寸 universal 写法由 Xcode 自动派生全部尺寸与设备族，实测同时产出
# `AppIcon60x60@2x.png` **和** `AppIcon76x76@2x~ipad.png`。
# 而且 Xcode 27 的模板本来就是这三种 appearance（默认 / dark / tinted）。
#
# ## 🔴 iOS 图标的两个约定（和 Web 图标不一样，最容易搞错）
#
# 1. **artwork 必须是直角满幅** —— 圆角由 iOS **自己**加。
#    Web 的 `icon.svg` 自带 `rx="112"` 圆角，直接拿来会变成"圆角套圆角"
#    （一个圆角蓝块浮在方形里）。所以这里**重画一个方形版**：底色铺满，标记居中。
# 2. **App Store 的 1024 不能有 alpha 通道** —— 带透明通道会被拒。
#    每张都要去 alpha，并且生成后**逐个校验**。
#
# ## 实测过的工具事实
#
# - `sips -d hasAlpha` / `sips -s hasAlpha no` **在本机报错不可用**；
#   `sips --resampleHeightWidth` **会保留 alpha**。
# - 可用的是 `magick -alpha remove -alpha off`（本机 `/opt/homebrew/bin/magick`）。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
IOS_DIR="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$IOS_DIR/../../.." && pwd)"
SRC_SVG="$REPO/apps/web/public/icons/icon.svg"
ICONSET="$IOS_DIR/HeytaMobile/Images.xcassets/AppIcon.appiconset"

[ -f "$SRC_SVG" ] || { echo "🔴 找不到源 SVG: $SRC_SVG"; exit 1; }
command -v rsvg-convert >/dev/null || { echo "🔴 需要 rsvg-convert（brew install librsvg）"; exit 1; }
command -v magick >/dev/null || { echo "🔴 需要 ImageMagick 的 magick"; exit 1; }

BLUE="#2563eb"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "=== 从 Web SVG 派生「直角满幅」方形版 ==="
python3 - "$SRC_SVG" "$TMP/square.svg" "$BLUE" <<'PYSVG'
import re, sys, pathlib
src, out, blue = sys.argv[1], sys.argv[2], sys.argv[3]
text = pathlib.Path(src).read_text(encoding='utf-8')
body = ''.join(re.findall(r'<rect [^>]*fill="#ffffff"[^>]*/>', text))
if body.count('<rect') != 3:
    raise SystemExit('源 SVG 里不是 3 个白色矩形，先确认设计没变')
svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512">\n'
    f'  <rect width="512" height="512" fill="{blue}"/>\n'
    f'  <g>{body}</g>\n'
    '</svg>\n'
)
pathlib.Path(out).write_text(svg, encoding='utf-8')
print("  ✅ 方形版已生成（满幅底色，无 rx）")
PYSVG

echo ""
echo "=== 清掉旧的 9 槽产物（改用单尺寸后它们不再被引用）==="
find "$ICONSET" -name 'icon-*.png' -delete
echo "  已清空 icon-*.png"

echo ""
echo "=== 渲染 1024 并去 alpha ==="
rsvg-convert -w 1024 -h 1024 "$TMP/square.svg" -o "$TMP/icon-1024.png"
magick "$TMP/icon-1024.png" -background "$BLUE" -alpha remove -alpha off "$ICONSET/icon-1024.png"
sips -g pixelWidth -g pixelHeight -g hasAlpha "$ICONSET/icon-1024.png" 2>/dev/null | sed 's/^/  /'

echo ""
echo "=== 写 Contents.json（Xcode 27 单尺寸模板：默认/dark/tinted）==="
cat > "$ICONSET/Contents.json" <<'JSON'
{
  "images" : [
    {
      "filename" : "icon-1024.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "appearances" : [
        {
          "appearance" : "luminosity",
          "value" : "dark"
        }
      ],
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "appearances" : [
        {
          "appearance" : "luminosity",
          "value" : "tinted"
        }
      ],
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
JSON
python3 -c "import json,sys; d=json.load(open('$ICONSET/Contents.json')); print('  ✅ Contents.json 可解析，条目数 =', len(d['images']))"

echo ""
echo "=== 校验：1024 必须无 alpha ==="
a=$(sips -g hasAlpha "$ICONSET/icon-1024.png" 2>/dev/null | awk '/hasAlpha/{print $2}')
if [ "$a" = "no" ]; then echo "  ✅ hasAlpha=no"; else echo "  🔴 hasAlpha=$a"; exit 1; fi

echo ""
echo "=== 产物 ==="
ls -la "$ICONSET" | sed 's/^/  /'
