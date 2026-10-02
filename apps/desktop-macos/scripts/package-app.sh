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
# 🔴 构建期同步设计系统生成物 —— `Sources/HeytaMac/Generated/HeytaTokens.swift` 是
#    **派生物且已 gitignore**，SwiftPM 只编译目标目录内的源码，所以缺了它就报
#    `cannot find 'HeytaTokens' in scope`。此前**只有门禁** `check-macos-shell.mjs` 调这条
#    同步，于是"跑过 pnpm check 的机器能打包、干净检出打不出包"（实测：隔离 worktree
#    从 HEAD 直接跑本脚本 ⇒ 构建失败）。打包路径必须自带这一步，不能依赖别人先跑过门禁。
bash "$SHELL_DIR/scripts/sync-tokens.sh" || { echo "🔴 同步设计系统生成物失败"; exit 1; }
swift build -c release --product HeytaMac 2>&1 | grep -E "error:|warning:|Build complete" | awk '{print "  " $0}'
BIN="$(swift build -c release --product HeytaMac --show-bin-path)/HeytaMac"
[ -x "$BIN" ] || { echo "🔴 找不到 release 可执行：$BIN"; exit 1; }
echo "  可执行：$BIN ($(stat -f%z "$BIN") 字节)"

# bridge bundle 必须在 .app 里，否则壳起来了但业务逻辑是空的
BUNDLE="$REPO/packages/app-host/bridge-bundle/native-bridge.js"
# 🔴 与上面 sync-tokens 同一族：`bridge-bundle/` 已 gitignore（根 `.gitignore:131`），
#    此前**只有三条壳门禁**会跑这个生成器，打包脚本只检查存在并"报一句让你自己去跑"。
#    于是干净检出上 `pnpm reinstall:all` 必然停在这里 —— 打包路径要自己把输入备齐，
#    复用的是同一个生成器（不另写一份），下面那条存在检查保留为**断言**。
node "$REPO/packages/app-host/scripts/build-native-bridge.mjs" || { echo "🔴 生成 bridge bundle 失败"; exit 1; }
[ -f "$BUNDLE" ] || { echo "🔴 生成器跑完了但产物不存在：${BUNDLE}"; exit 1; }

# 🔴 共享 UI 产物必须打进 .app 的 **Contents/Resources/web-dist/**
#    （HeytaMacApp.swift 的 webRoot 解析：环境变量优先，否则就是这里）。
#    2026-09-30 实测事故：此前**从来没打过**，装出来的 .app 永远渲染
#    "找不到共享 UI 产物"错误屏 —— 而打包自验的"非空白"判据拦不住错误屏
#    （它有标题有正文，contentRatio 99.6%），四轮截图统计全绿，
#    最后是产品负责人人眼看窗口才发现。
#    ⚠️ 也不能放 bundle 根（`Heyta.app/web-dist`）：code signing 只封 Contents/，
#    根下散目录让 codesign 报 "unsealed contents present in the bundle root"（实测）。
WEB_DIST="$REPO/apps/web/dist"
[ -f "$WEB_DIST/index.html" ] || { echo "🔴 缺少共享 UI 产物：$WEB_DIST/index.html（先 pnpm -r build）"; exit 1; }

# ── ② 组装 .app ─────────────────────────────────────────────────────────
echo ""
echo "=== ② 组装 Heyta.app ==="
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/HeytaMac"
cp "$BUNDLE" "$APP/Contents/Resources/native-bridge.js"

# web-dist 进包（Contents/Resources —— 在签名**之前**，让 --deep 把它封进签名）。
cp -R "$WEB_DIST" "$APP/Contents/Resources/web-dist"
[ -f "$APP/Contents/Resources/web-dist/index.html" ]   && echo "  ✅ web-dist 已进包（$(du -sh "$APP/Contents/Resources/web-dist" | cut -f1)）"

# 🔴 应用图标（2026-09-30 安装包审查：装出来的 Dock 里是通用图标）。
#    源用 PWA 的 512 图标（apps/web/public/icons，与浏览器/各端同一份品牌素材），
#    按 Apple 的 iconset 尺寸表生成 .icns。必须在签名**之前** —— 图标也是被封的内容。
APP_ICON_SRC="$REPO/apps/web/public/icons/icon-512.png"
[ -f "$APP_ICON_SRC" ] || { echo "🔴 缺少图标源：$APP_ICON_SRC"; exit 1; }
ICONSET="$OUT_DIR/Heyta.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for spec in "16 icon_16x16" "32 icon_16x16@2x" "32 icon_32x32" "64 icon_32x32@2x" \
            "128 icon_128x128" "256 icon_128x128@2x" "256 icon_256x256" "512 icon_256x256@2x" \
            "512 icon_512x512" "1024 icon_512x512@2x"; do
  set -- $spec
  sips -z "$1" "$1" "$APP_ICON_SRC" --out "$ICONSET/$2.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Heyta.icns" \
  && rm -rf "$ICONSET" \
  && echo "  ✅ 应用图标已生成（Heyta.icns，$(stat -f%z "$APP/Contents/Resources/Heyta.icns") 字节）" \
  || { echo "🔴 iconutil 生成 .icns 失败"; exit 1; }

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Heyta</string>
  <key>CFBundleIconFile</key><string>Heyta</string>
  <key>CFBundleDisplayName</key><string>heyta</string>
  <key>CFBundleExecutable</key><string>HeytaMac</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${BUILD_NUM}</string>
  <!-- 🔴 桌面壳反向授权要用它（ADR-0039 §2.3）：系统浏览器登录完回跳 heyta://auth#token=…
       ⚠️ 这是壳**第一次**对外承诺一个 URL scheme —— 改它是破坏性变更，
       且必须与 apps/web/src/features/auth/desktop-handoff.ts 的 DESKTOP_CALLBACK_SCHEME 一致。 -->
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>${BUNDLE_ID}.auth</string>
      <key>CFBundleURLSchemes</key>
      <array><string>heyta</string></array>
    </dict>
  </array>
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
# 🔴 §6.2 规定二：任何会开窗口的验证都必须**不抢前台**。macOS 上光靠"后台启动"不够 ——
#    窗口只要可聚焦就会被激活，所以壳认 `HEYTA_NO_FOCUS=1`（`reinstall-all.sh` 的启动段
#    早就带了，这一行漏了；G4 那轮实测过带着它照样能取自截屏）。
if HEYTA_NO_FOCUS=1 HEYTA_SELF_CAPTURE="$SELFIE" "$APP/Contents/MacOS/HeytaMac" 2>&1 | awk '{print "  " $0}'; then
  :
fi
[ -f "$SELFIE" ] || { echo "  🔴 打包后的 .app 没能自截屏 —— 它跑不起来或渲染失败"; exit 1; }

cd "$REPO"
node - "$SELFIE" "$SELFIE.webview.png" <<'JS'
import { existsSync } from 'node:fs';
import { inspectPng, looksBlank, looksSmeared, countBrandBlue } from './scripts/screenshots/png-stats.mjs';
const st = inspectPng(process.argv[2]);
console.log(`  ${st.width}x${st.height}  内容 ${(st.contentRatio * 100).toFixed(1)}%  色阶 ${st.colorSpan}  边缘 ${st.edgeOnContent.toFixed(3)}`);
let bad = false;
if (st.hasTransparency) { console.error('  🔴 含实际透明像素'); bad = true; }
if (looksBlank(st)) { console.error('  🔴 疑似空白'); bad = true; }
if (looksSmeared(st)) console.error('  ⚠️ 启发式提示疑似渲染坏了 —— 请人眼看一眼');
// 🔴 UI 特征判据（2026-09-30）：错误屏"非空白"（contentRatio 99.6%），只有
//    "界面里数得出主蓝"才分得清是真 UI 还是"找不到共享 UI 产物"那张错误屏。
//    ⚠️ 必须两套主题都数：应用外观跟随系统，深色下 `--ht-color-primary` 是
//    `#60A5FA` 而不是 `#2563EB`，只数浅色的会把**真界面判成红的**（同日实测）。
//    ⚠️ 必须数 **WebView 快照**而不是窗口截图：本文件上面那段壳代码规定了两份产物
//    各证一件事，而"WebView 内容没合成进窗口"在这台机器上是**常态**（实测同一秒
//    窗口 48 KB / 主蓝 0，快照 286 KB / 主蓝 79）。窗口截图仍负责"是不是真窗口"。
const brandShot = existsSync(process.argv[3]) ? process.argv[3] : process.argv[2];
const blue = countBrandBlue(brandShot);
console.log(`  主蓝采样命中 ${blue}（数的是 ${brandShot.split('/').pop()}）`);
if (blue < 20) { console.error('  🔴 截图里没有 heyta 主蓝 —— 这是错误屏/别的界面，不是共享 UI'); bad = true; }
if (bad) process.exit(1);
console.log('  ✅ 打包后的 .app 能起来、界面有真实内容（且确实是共享 UI）');
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
