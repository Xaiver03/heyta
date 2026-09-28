#!/bin/bash
# Linux 原生壳打包成 .deb：同步 → 构建 → 组装 → dpkg-deb → 安装验证。
#
#   bash apps/desktop-linux/scripts/package-deb.sh [远端主机] [输出目录]
#
# 默认主机 `sanjiaozhou`（Ubuntu 24.04 x86_64，有 gtk4 + javascriptcoregtk-4.1 + dpkg-deb）。
#
# ── 安装布局：为什么不把 exe 直接丢进 /usr/bin ──────────────────────────
#
# Linux 壳找 bundle 的顺序是：`HEYTA_BRIDGE_BUNDLE` → else **exe 同目录的
# `native-bridge.js`**。若把 exe 装到 /usr/bin，那 bundle 也得塞进 /usr/bin
# （污染系统目录、且和别的包撞名风险高）。
# 所以装成：
#
#   /usr/lib/heyta/heyta-linux        真正的二进制
#   /usr/lib/heyta/native-bridge.js   与它同目录 —— 满足"exe 同目录"这条
#   /usr/bin/heyta                    一行 wrapper，exec 真正的二进制
#   /usr/share/applications/heyta.desktop
#   /usr/share/icons/hicolor/512x512/apps/heyta.png
#
# ── 依赖：从 ldd 反查真实包名，不手写 ──────────────────────────────────
#
# 手写 Depends 一定会漂（发行版改名、so 版本变化）。这里用
# `ldd <binary> → 逐个 dpkg -S → 取包名`，只保留非 sysroot 的运行时库。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LINUX_DIR="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$LINUX_DIR/../.." && pwd)"
HOST="${1:-sanjiaozhou}"
OUT_DIR="${2:-$REPO/dist/linux}"
REMOTE_DIR="/tmp/heyta-linux-pkg"
VERSION="${HEYTA_VERSION:-1.0.0}"

mkdir -p "$OUT_DIR"

echo "=== ① 同步源码 + bundle 到 ${HOST} ==="
rsync -az --delete \
  --include='/*' --include='/apps/' --include='/apps/desktop-linux/***' \
  --include='/packages/' --include='/packages/app-host/' --include='/packages/app-host/bridge-bundle/***' \
  --include='/apps/web/' --include='/apps/web/public/' --include='/apps/web/public/icons/***' \
  --exclude='*' \
  "$REPO/" "${HOST}:${REMOTE_DIR}/"
echo "  ✅ 已同步"

echo ""
echo "=== ② 远端构建 + 组装 + 打包 + 安装验证 ==="
ssh "$HOST" "REMOTE_DIR='${REMOTE_DIR}' VERSION='${VERSION}' bash -s" <<'REMOTE' 2>&1 | grep -vE "DRI3|libEGL|Gtk-WARNING|GtkA11y" | awk '{print "  " $0}'
set -e
cd "$REMOTE_DIR/apps/desktop-linux"
export HEYTA_BRIDGE_BUNDLE="$REMOTE_DIR/packages/app-host/bridge-bundle/native-bridge.js"

echo "--- 构建（-Werror）---"
make clean >/dev/null 2>&1 || true
make >/tmp/linux-pkg-build.log 2>&1
grep -E "(error|warning):" /tmp/linux-pkg-build.log && { echo "🔴 构建有警告/错误"; exit 1; } || true
echo "  ✅ 0 警告：$(ls -la heyta-linux | awk '{print $5}') 字节"

echo "--- 组装 .deb 树 ---"
PKG=/tmp/heyta-deb
rm -rf "$PKG"
mkdir -p "$PKG/DEBIAN" \
         "$PKG/usr/lib/heyta" \
         "$PKG/usr/bin" \
         "$PKG/usr/share/applications" \
         "$PKG/usr/share/icons/hicolor/512x512/apps" \
         "$PKG/usr/share/doc/heyta"

install -m 0755 heyta-linux "$PKG/usr/lib/heyta/heyta-linux"
install -m 0644 "$HEYTA_BRIDGE_BUNDLE" "$PKG/usr/lib/heyta/native-bridge.js"

# 图标：用 web 那份已有的品牌图（不另造一份，避免多源漂移）
ICON="$REMOTE_DIR/apps/web/public/icons/icon-512.png"
[ -f "$ICON" ] && install -m 0644 "$ICON" "$PKG/usr/share/icons/hicolor/512x512/apps/heyta.png" \
  || echo "  ⚠️ 没找到 $ICON，跳过图标"

cat > "$PKG/usr/bin/heyta" <<'WRAP'
#!/bin/sh
# 真正的二进制与 bundle 都在 /usr/lib/heyta/ —— 壳默认找"exe 同目录的
# native-bridge.js"，所以这里显式把环境变量指过去，别依赖 cwd。
HEYTA_BRIDGE_BUNDLE=/usr/lib/heyta/native-bridge.js
export HEYTA_BRIDGE_BUNDLE
exec /usr/lib/heyta/heyta-linux "$@"
WRAP
chmod 0755 "$PKG/usr/bin/heyta"

cat > "$PKG/usr/share/applications/heyta.desktop" <<'DESK'
[Desktop Entry]
Type=Application
Name=heyta
Comment=本地优先的任务管理（原生 GTK4 壳）
Exec=/usr/bin/heyta
Icon=heyta
Terminal=false
Categories=Office;Utility;
DESK

cat > "$PKG/usr/share/doc/heyta/copyright" <<'COPY'
heyta —— 本地优先的任务管理。
Desktop shell: GTK4 + JavaScriptCoreGTK。业务逻辑与存储由同一份 TS bundle 提供。
COPY

# 依赖：从 ldd 反查真实包名
echo "--- 反查运行时依赖 ---"
DEPS=$(ldd "$PKG/usr/lib/heyta/heyta-linux" \
  | awk '/=>/ {print $3}' \
  | grep -v '^/lib' \
  | sort -u \
  | while read -r so; do dpkg -S "$so" 2>/dev/null | head -1 | cut -d: -f1; done \
  | sort -u | paste -sd, -)
[ -n "$DEPS" ] || DEPS="libgtk-4-1, libjavascriptcoregtk-4.1-0, libsqlite3-0"
echo "  $DEPS"

SIZE_KB=$(( $(du -sk "$PKG/usr" | cut -f1) ))
cat > "$PKG/DEBIAN/control" <<CTRL
Package: heyta
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: amd64
Depends: ${DEPS}
Installed-Size: ${SIZE_KB}
Maintainer: Xiaoli Creativity Culture Industry Development (beijing) Co., Ltd.
Description: heyta —— 本地优先的任务管理（GTK4 原生壳）
 同一份 TS bundle 驱动 web / mobile / desktop 三端；数据落在本机 SQLite，
 端到端加密后才同步。本包是 Linux 桌面原生壳（GTK4 + JavaScriptCoreGTK）。
CTRL

echo "--- dpkg-deb 打包 ---"
rm -f /tmp/heyta_${VERSION}_amd64.deb
dpkg-deb --build --root-owner-group "$PKG" /tmp/heyta_${VERSION}_amd64.deb >/dev/null
echo "  ✅ $(basename /tmp/heyta_${VERSION}_amd64.deb) $(stat -c%s /tmp/heyta_${VERSION}_amd64.deb) 字节"
echo "--- 包内容 ---"
dpkg-deb -c /tmp/heyta_${VERSION}_amd64.deb | awk '{print "   ", $1, $6, $7}' | head -12

echo "--- 安装 + 启动验证（Xvfb）---"
dpkg -i /tmp/heyta_${VERSION}_amd64.deb >/tmp/heyta-deb-install.log 2>&1 || {
  echo "🔴 安装失败："; tail -5 /tmp/heyta-deb-install.log; exit 1; }
echo "  ✅ 已安装：$(dpkg -s heyta | grep -E '^Version' )"
command -v heyta >/dev/null && echo "  ✅ /usr/bin/heyta 就位"

rm -f /tmp/heyta-deb-window.png
Xvfb :98 -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB=$!
sleep 3
DISPLAY=:98 heyta >/tmp/heyta-deb-run.log 2>&1 &
APP=$!
sleep 8
DISPLAY=:98 import -window root /tmp/heyta-deb-window.png 2>/dev/null
kill $APP 2>/dev/null || true; sleep 1; kill $XVFB 2>/dev/null || true
grep -E "WINDOW_(TITLE|SIZE)" /tmp/heyta-deb-run.log || echo "  ⚠️ 没打印窗口尺寸"
convert /tmp/heyta-deb-window.png -crop 900x560+0+0 +repage /tmp/heyta-deb-window-cropped.png
echo "  已截图并裁到窗口"
REMOTE

echo ""
echo "=== ③ 取回 .deb 与验证截图 ==="
scp -q "${HOST}:/tmp/heyta_${VERSION}_amd64.deb" "$OUT_DIR/"
scp -q "${HOST}:/tmp/heyta-deb-window-cropped.png" "$OUT_DIR/packaged-first-run.png"
ls -la "$OUT_DIR" | awk '{print "  " $0}'

echo ""
echo "=== ④ 校验打包后的界面 ==="
cd "$REPO"
node - "$OUT_DIR/packaged-first-run.png" <<'JS'
import { inspectPng, looksBlank, looksSmeared } from './scripts/screenshots/png-stats.mjs';
const st = inspectPng(process.argv[2]);
console.log(`  ${st.width}x${st.height}  内容 ${(st.contentRatio * 100).toFixed(1)}%  色阶 ${st.colorSpan}  边缘 ${st.edgeOnContent.toFixed(3)}`);
let bad = false;
if (st.hasTransparency) { console.error('  🔴 含实际透明像素'); bad = true; }
if (looksBlank(st)) { console.error('  🔴 疑似空白'); bad = true; }
if (looksSmeared(st)) console.error('  ⚠️ 启发式提示疑似渲染坏了 —— 请人眼看一眼');
if (bad) process.exit(1);
console.log('  ✅ 装完的 .deb 能起来、界面有真实内容');
JS
