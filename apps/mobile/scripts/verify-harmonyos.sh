#!/bin/bash
# 鸿蒙端取证：起应用 → snapshot_display → 取回 → 校验。
#
#   bash apps/mobile/scripts/verify-harmonyos.sh
#
# ⚠️ 设备上装的目前是**小组件测试页**（见 evidence/harmonyos.txt），
#    它证明"鸿蒙壳能起来并渲染"，**不**证明主产品界面可用。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MOBILE="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$MOBILE/../.." && pwd)"
HDC="${HDC:-/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc}"
PKG="${HEYTA_HARMONY_PACKAGE:-com.heyta.mobile}"

[ -x "$HDC" ] || { echo "🔴 找不到 hdc：$HDC"; exit 1; }
"$HDC" list targets | grep -q . || { echo "🔴 没有连接的鸿蒙设备（hdc list targets 为空）"; exit 1; }

echo "=== 起应用 ==="
"$HDC" shell aa force-stop "$PKG" >/dev/null 2>&1 || true
sleep 1
"$HDC" shell aa start -a EntryAbility -b "$PKG" | sed 's/^/  /'
sleep 15

echo ""
echo "=== 截图 ==="
"$HDC" shell snapshot_display -f /data/local/tmp/heyta.jpeg 2>&1 | tail -1 | sed 's/^/  /'
"$HDC" file recv /data/local/tmp/heyta.jpeg /tmp/harmony-app.jpeg | tail -1 | sed 's/^/  /'

mkdir -p "$MOBILE/evidence"
magick /tmp/harmony-app.jpeg "$MOBILE/evidence/harmonyos.png"

echo ""
echo "=== 校验 ==="
cd "$REPO"
node - "$MOBILE/evidence/harmonyos.png" <<'JS'
import { inspectPng, looksBlank, looksSmeared } from './scripts/screenshots/png-stats.mjs';
const st = inspectPng(process.argv[2]);
console.log(`  ${st.width}x${st.height}  内容 ${(st.contentRatio * 100).toFixed(1)}%  色阶 ${st.colorSpan}`);
let bad = false;
if (st.hasTransparency) { console.error('  🔴 含实际透明像素'); bad = true; }
if (looksBlank(st)) { console.error('  🔴 疑似空白'); bad = true; }
if (looksSmeared(st)) console.error('  ⚠️ 启发式提示疑似渲染坏了 —— 请人眼看一眼');
if (bad) process.exit(1);
console.log('  ✅ 通过');
JS
