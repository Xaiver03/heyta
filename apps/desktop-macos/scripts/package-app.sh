#!/bin/bash
# macOS 原生壳打包：构建 → 组装 .app → Developer ID 签名 → 启动验证 → .dmg → 公证 → 装订。
#
#   bash apps/desktop-macos/scripts/package-app.sh [输出目录]
#
# 默认输出到 /tmp/heyta-macos-dist。
#
# ── 这条路能走到哪一步，取决于**证书**，脚本会自己判定并如实说明 ────────────
#
#   Developer ID Application  → 可以签名；**再加 ASC API key 就能公证**
#   只有 Apple Distribution   → 只能签"App Store 分发"，装不进普通 Mac
#   什么都没有                → 只能 ad-hoc（`-`），本机能跑，发出去会被 Gatekeeper 拦
#
# 🔴 「签名」和「公证」是两件事，不要混：
#   签名证明"这个包是谁发的"；公证是 Apple 又扫了一遍并给你一张票据。
#   只签名不公证，别人下载后仍会看到"来自身份不明的开发者"。
#   本脚本**两个都做**，且**分别报告**成功与否 —— 不许把"签了名"说成"能分发"。
#
# ── 为什么需要 entitlements ─────────────────────────────────────────────
#
# hardened runtime（公证的硬性前提）默认禁止 JIT 与可写可执行内存，
# 而 **JavaScriptCore 需要它们**。不给就会在启动时崩、且崩得没有线索。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SHELL_DIR="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$SHELL_DIR/../.." && pwd)"
OUT_DIR="${1:-/tmp/heyta-macos-dist}"
BUNDLE_ID="cloud.finlaw.heyta.desktop"
VERSION="1.0.0"
BUILD_NUM="1"

APP="$OUT_DIR/Heyta.app"
DMG="$OUT_DIR/Heyta-$VERSION.dmg"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# ── ① 构建 ──────────────────────────────────────────────────────────────
echo "=== ① 构建 release ==="
cd "$SHELL_DIR"
swift build -c release --product HeytaMac 2>&1 | grep -E "error:|warning:|Build complete" | awk '{print "  " $0}'
BIN="$(swift build -c release --product HeytaMac --show-bin-path)/HeytaMac"
[ -x "$BIN" ] || { echo "🔴 找不到 release 可执行：$BIN"; exit 1; }
echo "  可执行：$BIN ($(stat -f%z "$BIN") 字节)"

# bridge bundle 必须在 .app 里，否则壳起来了但业务逻辑是空的
BUNDLE="$REPO/packages/app-host/bridge-bundle/native-bridge.js"
[ -f "$BUNDLE" ] || { echo "🔴 缺少 bridge bundle：$BUNDLE（先跑 packages/app-host/scripts/build-native-bridge.mjs）"; exit 1; }

# ── ② 组装 .app ─────────────────────────────────────────────────────────
echo ""
echo "=== ② 组装 Heyta.app ==="
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/HeytaMac"
cp "$BUNDLE" "$APP/Contents/Resources/native-bridge.js"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Heyta</string>
  <key>CFBundleDisplayName</key><string>heyta</string>
  <key>CFBundleExecutable</key><string>HeytaMac</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${BUILD_NUM}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Xiaoli Creativity Culture Industry Development (beijing) Co., Ltd.</string>
</dict>
</plist>
PLIST

cat > "$OUT_DIR/entitlements.plist" <<'ENT'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- JavaScriptCore 需要；hardened runtime 默认禁止，不给会启动即崩 -->
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict>
</plist>
ENT

plutil -lint "$APP/Contents/Info.plist" >/dev/null && echo "  ✅ Info.plist 合法"

# ── ③ 签名（按证书可用性降级，并如实说明降到了哪一档）──────────────────
echo ""
echo "=== ③ 签名 ==="
DEV_ID="$(security find-identity -v -p codesigning 2>/dev/null | grep -o 'Developer ID Application: .*' | head -1 | sed 's/"$//' || true)"
SIGN_KIND=""
if [ -n "$DEV_ID" ]; then
  SIGN_KIND="developer-id"
  echo "  身份：$DEV_ID"
  codesign --force --deep --options runtime --timestamp \
    --entitlements "$OUT_DIR/entitlements.plist" \
    --sign "$DEV_ID" "$APP"
else
  SIGN_KIND="adhoc"
  echo "  ⚠️ 没有 Developer ID Application —— 降级为 **ad-hoc**（本机能跑，发出去会被 Gatekeeper 拦）"
  codesign --force --deep --options runtime \
    --entitlements "$OUT_DIR/entitlements.plist" \
    --sign - "$APP"
fi

codesign --verify --deep --strict --verbose=1 "$APP" 2>&1 | tail -2 | awk '{print "  " $0}'
echo "  --- 展开确认 ---"
codesign -dvvv "$APP" 2>&1 | grep -E "Identifier|Authority|TeamIdentifier|flags" | awk '{print "  " $0}'

# ── ④ 启动验证：打好的 .app 真的能起来并渲染吗 ──────────────────────────
echo ""
echo "=== ④ 启动验证（.app 里那一个，不是 .build 里那个）==="
SELFIE="$OUT_DIR/packaged-first-run.png"
if HEYTA_SELF_CAPTURE="$SELFIE" "$APP/Contents/MacOS/HeytaMac" 2>&1 | awk '{print "  " $0}'; then
  :
fi
[ -f "$SELFIE" ] || { echo "  🔴 打包后的 .app 没能自截屏 —— 它跑不起来或渲染失败"; exit 1; }

cd "$REPO"
node - "$SELFIE" <<'JS'
import { inspectPng, looksBlank, looksSmeared } from './scripts/screenshots/png-stats.mjs';
const st = inspectPng(process.argv[2]);
console.log(`  ${st.width}x${st.height}  内容 ${(st.contentRatio * 100).toFixed(1)}%  色阶 ${st.colorSpan}  边缘 ${st.edgeOnContent.toFixed(3)}`);
let bad = false;
if (st.hasTransparency) { console.error('  🔴 含实际透明像素'); bad = true; }
if (looksBlank(st)) { console.error('  🔴 疑似空白'); bad = true; }
if (looksSmeared(st)) console.error('  ⚠️ 启发式提示疑似渲染坏了 —— 请人眼看一眼');
if (bad) process.exit(1);
console.log('  ✅ 打包后的 .app 能起来、界面有真实内容');
JS

# ── ⑤ .dmg ──────────────────────────────────────────────────────────────
echo ""
echo "=== ⑤ 生成 .dmg ==="
hdiutil create -volname "heyta" -srcfolder "$APP" -ov -format UDZO "$DMG" 2>&1 | tail -2 | awk '{print "  " $0}'
if [ "$SIGN_KIND" = "developer-id" ]; then
  codesign --force --timestamp --sign "$DEV_ID" "$DMG"
  echo "  ✅ .dmg 也已签名"
fi
echo "  $(basename "$DMG")  $(stat -f%z "$DMG") 字节"

# ── ⑥ 公证（只有 Developer ID + ASC key 才可能成功）────────────────────
echo ""
echo "=== ⑥ 公证 ==="
KEY_FILE=""
for candidate in \
  "$HOME/Library/Private/AppStoreConnect/AuthKey_T2H876K8MJ.p8" \
  "$HOME/Desktop/AuthKey_T2H876K8MJ.p8" \
  "$HOME/.appstoreconnect/private_keys/AuthKey_T2H876K8MJ.p8"
do
  [ -f "$candidate" ] && KEY_FILE="$candidate" && break
done
KEY_ID="T2H876K8MJ"
ISSUER="627afa93-122d-4739-a780-0ad593aee505"

if [ "$SIGN_KIND" != "developer-id" ]; then
  echo "  ⏭ 跳过：不是 Developer ID 签名，公证必然被拒"
elif [ -z "$KEY_FILE" ]; then
  echo "  ⏭ 跳过：找不到 ASC API key（试过 ~/Library/Private/AppStoreConnect、~/Desktop、~/.appstoreconnect/private_keys）"
else
  echo "  用 key：$(basename "$KEY_FILE")（内容不打印）"
  if xcrun notarytool submit "$DMG" --key "$KEY_FILE" --key-id "$KEY_ID" --issuer "$ISSUER" --wait 2>&1 | tail -8 | awk '{print "  " $0}'; then
    echo "  ✅ 公证通过，开始装订票据"
    xcrun stapler staple "$DMG" 2>&1 | tail -2 | awk '{print "  " $0}'
    xcrun stapler validate "$DMG" 2>&1 | tail -2 | awk '{print "  " $0}'
  else
    echo "  🔴 公证失败（上面的输出是 Apple 的原话）。包本身已签名可用，但**没通过公证**。"
  fi
fi

echo ""
echo "=== 产物 ==="
ls -la "$OUT_DIR" | awk '{print "  " $0}'
echo ""
echo "  签名档位：$SIGN_KIND"
