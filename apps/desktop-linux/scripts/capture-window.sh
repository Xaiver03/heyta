#!/bin/bash
# Linux（GTK4）原生壳的窗口取证：同步 → 构建 → 冒烟 → Xvfb 起窗口 → 裁出窗口 → 落 evidence。
#
#   bash apps/desktop-linux/scripts/capture-window.sh <目标机>
#
# 目标机的取法：位置参数 > `HEYTA_LINUX_HOST=<ssh 别名>` > 响亮拒绝。
# 🔴 **没有 `local` 这一档，也没有默认远端。** `local` 要的是"整套远端命令在本地跑"的第二条实现，
#    而本脚本一条都没跑过它 —— 加一个从没执行过的分支正是 §5.9 那两条缺陷的形状，所以宁可不加：
#    在 Linux 载体上取证请直接跑 `pnpm build:linux local`（`package-deb.sh` 有本地模式，
#    它连包内窗口一起证）或 `check:linux-shell` 的 M2 那一档。
# 🔴 这里**不再有"默认远端 `sanjiaozhou`"**那一档。两个理由，都是一手读数：
#   ① 那是生产机（Caddy 在线上、postgres、几十个容器），而本脚本第二行就是 `rsync --delete`；
#   ② 那条路在 `docs/runbooks/linux-dev-box.md` §5.6 / 陷阱 #374 里被实测否证 —— 那台机上
#      打包 TS 门面那步就缺工作区，本脚本从没走到 `make`。
#
# 🔴 **本脚本采的是 M2 之前的原生壳那一屏**（它不同步 `apps/web/dist`，所以壳渲染的是
#    C 侧原生列表，不是共享 web UI）。在当前树上重跑它会落到回退屏，而下面的校验
#    **会判红** —— 这是 07 04:5x 特意加上主蓝判据之后的**预期行为**，不是新缺陷：
#    现量 `window-first-run.png`（旧原生屏）主蓝命中 **0**，
#    而两张 M2 图（`linux-m2-webdist.png` / `linux-deb-packaged-first-run.png`）都是 **3987**。
#    把它重定向到 M2 那条路 = 换采集方式，要连 `scripts/screenshots/targets.mjs` 的
#    `methods` 与既有证据的归属一起改，排在计划 E7（Linux 进 reinstall 第五端）一起做。
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
HOST="${1:-${HEYTA_LINUX_HOST:-}}"
if [ -z "$HOST" ]; then
  echo "🔴 没定目标机。这个脚本会先 rsync --delete 再远端构建，所以目标机必须是显式的："
  echo "   bash apps/desktop-linux/scripts/capture-window.sh <ssh 别名>     （或 HEYTA_LINUX_HOST=<别名>）"
  echo "   Linux 载体上请改走 pnpm build:linux local 或 check:linux-shell 的 M2 那一档（见文件头）。"
  exit 2
fi
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
ssh "$HOST" "REMOTE_DIR='${REMOTE_DIR}' WIN_W='${WIN_W}' WIN_H='${WIN_H}' bash -s" <<'REMOTE' 2>&1 | grep -vE "DRI3|libEGL|Gtk-WARNING|GtkA11y" | awk '{print "  " $0}'
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
import { inspectPng, looksBlank, looksSmeared, countBrandBlue } from './scripts/screenshots/png-stats.mjs';
const st = inspectPng(process.argv[2]);
console.log(`  ${st.width}x${st.height}  内容 ${(st.contentRatio * 100).toFixed(1)}%  色阶 ${st.colorSpan}`);
console.log(`  内容占比(相对主色) ${(st.contentOnModalRatio * 100).toFixed(1)}%  边缘密度 ${st.edgeOnContent.toFixed(3)}`);
// 🔴 「非空白」回答的是"有没有东西"，回答不了"是不是这个界面"（AGENTS §7 第 82 条）。
//    这一档以前只有 looksBlank，所以回退屏（有标题有正文）永远算通过。
//    现量：旧原生屏主蓝命中 0，两张 M2 图都是 3987 ⇒ 这条判据有阳性对照，不是恒真断言。
const blue = countBrandBlue(process.argv[2]);
console.log(`  主蓝(#2563EB)命中 ${blue}`);
let bad = false;
if (st.hasTransparency) { console.error('  🔴 含实际透明像素'); bad = true; }
if (looksBlank(st)) { console.error('  🔴 疑似空白'); bad = true; }
if (looksSmeared(st)) { console.error('  🔴 疑似渲染坏了'); bad = true; }
if (blue === 0) {
  console.error('  🔴 没有一处 heyta 主蓝 ⇒ 画的不是我们的界面（回退屏/空白屏/原生旧屏都会落在这里）');
  bad = true;
}
if (bad) process.exit(1);
console.log('  ✅ 通过');
JS

cat > "$LINUX_DIR/evidence/window-first-run.txt" <<EOF
# Linux（GTK4）原生壳窗口取证记录 —— ⚠️ **这一张是 M2 之前的原生壳那一屏**
#
# 采集命令（可复现）：
#   bash apps/desktop-linux/scripts/capture-window.sh ${HOST}
#
# 🔴 它画的**不是**共享 web UI（本脚本不同步 apps/web/dist ⇒ 壳走原生列表那一支）。
#    当前产物那两张 M2 证据在：
#      apps/desktop-linux/evidence/linux-m2-webdist.png            （开发树，check:linux-shell 的 M2 档）
#      apps/desktop-linux/evidence/linux-deb-packaged-first-run.png （装出来的 .deb，package-deb.sh）
#    判据现量：本张主蓝命中 0，那两张都是 3987 ⇒ 07 04:5x 给本脚本加上主蓝判据后，
#    重跑它会**判红**（预期行为，见脚本文件头）。
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
ls -la "$LINUX_DIR/evidence/" | awk '{print "  " $0}'
