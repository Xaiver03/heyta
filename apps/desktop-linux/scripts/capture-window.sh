#!/bin/bash
# Linux（GTK4）原生壳的窗口取证：同步 → 构建 → 冒烟 → Xvfb 起窗口 → 裁出窗口 → 落 evidence。
#
#   bash apps/desktop-linux/scripts/capture-window.sh [远端主机]
#
# 默认远端 `sanjiaozhou`（那里有 gtk4 4.14.5 + javascriptcoregtk-4.1 2.52.6 + sqlite3）。
#
# ── 为什么要"裁到窗口" ───────────────────────────────────────────────────
#
# Xvfb 的整屏是 1280x800，而窗口只占左上 900x560 —— **其余 50.8% 是纯黑桌面**。
# 那片黑区内部**零边缘**，会把「每个内容像素摊到的跃变数」稀释到阈值以下，
# 于是**清晰的界面被启发式判成"糊"**（实测：整屏 edge=0.134 判糊；
# 裁到窗口 edge=0.994 判正常）。
#
# 这既是**更好的证据**（画面里只有窗口、没有无关桌面），
# 也顺手消除了那个误报源。GTK4 在 Xvfb 里没有 GPU，会从 ngl 退回 cairo
# 软件渲染 —— 那**不是错误**，日志里会有 libEGL/DRI3 的警告。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LINUX_DIR="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$LINUX_DIR/../.." && pwd)"
HOST="${1:-sanjiaozhou}"
REMOTE_DIR="/tmp/heyta-linux"
WIN_W=900
WIN_H=560

echo "=== 同步到 ${HOST}:${REMOTE_DIR} ==="
rsync -az --delete \
  --include='/*' --include='/apps/' --include='/apps/desktop-linux/***' \
  --include='/packages/' --include='/packages/app-host/' --include='/packages/app-host/bridge-bundle/***' \
  --exclude='*' \
  "$REPO/" "${HOST}:${REMOTE_DIR}/"
echo "  ✅ 已同步（排除 node_modules 等）"

echo ""
echo "=== 远端构建 + 冒烟 + 起窗口截图 ==="
# 用**加引号的** heredoc：让远端自己展开 $ 与 $(...)，
# 变量通过 ssh 的环境传入（未加引号的话 $(ls ...) 会在本地先跑，那是错的）
ssh "$HOST" "REMOTE_DIR='${REMOTE_DIR}' WIN_W='${WIN_W}' WIN_H='${WIN_H}' bash -s" <<'REMOTE' 2>&1 | grep -vE "DRI3|libEGL|Gtk-WARNING|GtkA11y" | sed 's/^/  /'
set -e
cd "$REMOTE_DIR/apps/desktop-linux"
export HEYTA_BRIDGE_BUNDLE="$REMOTE_DIR/packages/app-host/bridge-bundle/native-bridge.js"
make clean >/dev/null 2>&1 || true
make >/tmp/linux-build.log 2>&1
if grep -qE "(^|: )(error|warning):" /tmp/linux-build.log; then
  echo "🔴 -Werror 构建有警告/错误："; grep -E "(error|warning):" /tmp/linux-build.log | head -5; exit 1
fi
echo "-Werror 构建通过：$(ls -la heyta-linux heyta-smoke | awk '{print $9" "$5}' | tr '\n' ' ')"

./heyta-smoke 2>&1 | tail -2

rm -f /tmp/linux-window.png /tmp/linux-window-cropped.png
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB=$!
sleep 3
DISPLAY=:99 HEYTA_BRIDGE_BUNDLE="$HEYTA_BRIDGE_BUNDLE" ./heyta-linux >/tmp/linux-app.log 2>&1 &
APP=$!
sleep 8
DISPLAY=:99 import -window root /tmp/linux-window.png 2>/dev/null
kill $APP 2>/dev/null || true; sleep 1; kill $XVFB 2>/dev/null || true

# 🔴 裁到窗口：整屏里 50.8% 是黑桌面，会把边缘密度稀释成误报
convert /tmp/linux-window.png -crop "${WIN_W}x${WIN_H}+0+0" +repage /tmp/linux-window-cropped.png
grep -E "WINDOW_(TITLE|SIZE)" /tmp/linux-app.log || true
ls -la /tmp/linux-window-cropped.png
REMOTE

echo ""
echo "=== 取回证据 ==="
mkdir -p "$LINUX_DIR/evidence"
scp -q "${HOST}:/tmp/linux-window-cropped.png" "$LINUX_DIR/evidence/window-first-run.png"
scp -q "${HOST}:/tmp/linux-window.png" /tmp/linux-window-full.png

echo ""
echo "=== 校验 ==="
cd "$REPO"
node - "$LINUX_DIR/evidence/window-first-run.png" <<'JS'
import { inspectPng, looksBlank, looksSmeared } from './scripts/screenshots/png-stats.mjs';
const st = inspectPng(process.argv[2]);
console.log(`  ${st.width}x${st.height}  内容 ${(st.contentRatio * 100).toFixed(1)}%  色阶 ${st.colorSpan}`);
console.log(`  内容占比(相对主色) ${(st.contentOnModalRatio * 100).toFixed(1)}%  边缘密度 ${st.edgeOnContent.toFixed(3)}`);
let bad = false;
if (st.hasTransparency) { console.error('  🔴 含实际透明像素'); bad = true; }
if (looksBlank(st)) { console.error('  🔴 疑似空白'); bad = true; }
if (looksSmeared(st)) { console.error('  🔴 疑似渲染坏了'); bad = true; }
if (bad) process.exit(1);
console.log('  ✅ 通过');
JS

cat > "$LINUX_DIR/evidence/window-first-run.txt" <<EOF
# Linux（GTK4）原生壳窗口取证记录
#
# 采集命令（可复现）：
#   bash apps/desktop-linux/scripts/capture-window.sh sanjiaozhou
#
# 目标机：${HOST}（Ubuntu，x86_64）
# 工具链：gtk4 4.14.5 · javascriptcoregtk-4.1 2.52.6 · sqlite3 3.45.1
#
# 构建：make（-Werror）→ 0 警告
# 窗口：Xvfb :99 -screen 0 1280x800x24 → GTK4 无 GPU 时从 ngl 退回 cairo 软件渲染
#       （日志里的 libEGL / DRI3 警告**不是错误**）
# 截图：DISPLAY=:99 import -window root
#
# 🔴 为什么裁到 ${WIN_W}x${WIN_H}：
#   Xvfb 整屏 1280x800，窗口只占左上 ${WIN_W}x${WIN_H}，**其余 50.8% 是纯黑桌面**。
#   那片黑区内部零边缘，会把「每个内容像素摊到的跃变数」稀释到阈值以下 ——
#   实测整屏 edge=0.134（被判"糊"），裁到窗口 edge=0.994（正常）。
#   裁切既是更好的证据（画面里只有窗口），也消除了这个误报源。
#
# 窗口里那行「还没有任务。上面写一条试试。」不是硬编码 —— 它是 listTasks()
# 穿过 JavaScriptCore → @heyta/app-host → SqliteAdapter → C 同步驱动 → SQLite
# 之后返回的空列表被渲染出来。底部是真实数据（库路径 + 从 SQLite 读出的 clientId）。

CAPTURE_METHOD=xvfb-import-crop
EOF

echo ""
echo "=== 产物 ==="
ls -la "$LINUX_DIR/evidence/" | sed 's/^/  /'
