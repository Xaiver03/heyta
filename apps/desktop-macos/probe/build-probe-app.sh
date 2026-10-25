#!/bin/bash
# 组装 **macOS 提醒横幅取证探针** 的 .app（不碰产品打包脚本 package-app.sh）。
#
#   bash apps/desktop-macos/probe/build-probe-app.sh [输出目录]
#
# 默认输出 /tmp/heyta-macos-reminder-probe。
#
# ── 为什么要有这么一枚独立探针 ──────────────────────────────────────────
# `apps/desktop-macos` 是 SwiftPM 包、**没有 Xcode 工程**，所以 `swift build` 出来的
# 是裸可执行文件 —— 而 `ReminderPort` 在裸可执行文件里**整体降级为 unsupported**
# （`UNUserNotificationCenter.current()` 会抛 NSException，见该文件头）。
# ⇒ 想看到真横幅，必须有一个**真的 .app 包**（带 CFBundleIdentifier）。
#
# 🔴 探针的 bundle id 与发货 id **刻意不同**：
#    发货 id 是 `cloud.finlaw.heyta.desktop`（见 scripts/package-app.sh）。
#    通知授权是**每个 bundle id 一次性**的，探针不能把它烧掉。
#    这里用 `cloud.finlaw.heyta.macosprobe`。
#
# 🔴 复用**发货的那份编译产物**：链接 `.build/debug/HeytaShellCore.o`
#    （`ReminderPort` / `ReminderLoop` / `ScriptHost` / `AppApi` 全在里面），
#    探针自己不实现任何投递逻辑。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SHELL_DIR="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$SHELL_DIR/../.." && pwd)"
OUT_DIR="${1:-/tmp/heyta-macos-reminder-probe}"
BUNDLE_ID="cloud.finlaw.heyta.macosprobe"
APP="$OUT_DIR/HeytaReminderProbe.app"
BRIDGE="$REPO/packages/app-host/bridge-bundle/native-bridge.js"

# 与发货包同一个判据：不许烧掉产品 id。
[ "$BUNDLE_ID" = "cloud.finlaw.heyta.desktop" ] && { echo "🔴 bundle id 撞了发货 id"; exit 1; }

echo "=== ① 桥产物（与两个壳同一份）==="
[ -f "$BRIDGE" ] || node "$REPO/packages/app-host/scripts/build-native-bridge.mjs"
# 🔴 不用 stat 的 BSD 形状 `-f`：BSD 与 GNU 用它读的是**两件不同的事**（§7 第 364 条），
#    在 Linux 上取到空串而**不报错** —— "前后一致"那类断言会变成恒真。
echo "  $(wc -c < "$BRIDGE" | tr -d ' ') bytes  mtime $(node -p 'require("fs").statSync(process.argv[1]).mtime.toISOString()' "$BRIDGE")"

echo "=== ② 构建 HeytaShellCore（发货源码）==="
cd "$SHELL_DIR"
swift build 2>&1 | tail -3
BUILD="$SHELL_DIR/.build/debug"
[ -f "$BUILD/HeytaShellCore.o" ] || { echo "🔴 缺 $BUILD/HeytaShellCore.o"; exit 1; }

echo "=== ③ 编译探针并链到那份 .o ==="
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
SDK="$(xcrun --show-sdk-path --sdk macosx)"
cp "$BRIDGE" "$APP/Contents/Resources/native-bridge.js"

xcrun swiftc \
  -sdk "$SDK" \
  -target arm64-apple-macos14.0 \
  -I "$BUILD" \
  "$HERE/main.swift" "$BUILD/HeytaShellCore.o" \
  -framework JavaScriptCore -framework UserNotifications -framework AppKit \
  -lsqlite3 \
  -o "$APP/Contents/MacOS/HeytaReminderProbe"
echo "  ✅ 探针可执行文件已生成"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>heyta 提醒取证</string>
  <key>CFBundleDisplayName</key><string>heyta 提醒取证</string>
  <key>CFBundleExecutable</key><string>HeytaReminderProbe</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.0.0-probe</string>
  <key>CFBundleVersion</key><string>1</string>
  <!-- 🔴 §6.2 规定二：探针不许抢前台。LSUIElement ⇒ 无 Dock 图标、无菜单、
       永远不成为活动应用（横幅是系统画的，不需要应用在前台）。 -->
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
plutil -lint "$APP/Contents/Info.plist" >/dev/null && echo "  ✅ Info.plist 合法（CFBundleIdentifier=${BUNDLE_ID}）"

# JavaScriptCore 要 JIT；ad-hoc 签名不带 team，所以**不**给 application-identifier。
cat > "$OUT_DIR/entitlements.plist" <<ENT
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict>
</plist>
ENT

echo "=== ④ ad-hoc 签名（探针不公证、不进 /Applications）==="
codesign --force --entitlements "$OUT_DIR/entitlements.plist" --sign - "$APP"
codesign --verify --verbose=1 "$APP" 2>&1 | tail -1
codesign -dvv "$APP" 2>&1 | grep -E "^(Identifier|CodeDirectory|Signature)" | sed 's/^/  /'

echo ""
echo "✅ 探针 .app：$APP"
echo "   bundle id：$BUNDLE_ID"
echo "   启动（不抢前台）：HEYTA_PROBE_BRIDGE=\"$APP/Contents/Resources/native-bridge.js\" \\"
echo "     HEYTA_PROBE_DB=<db> \"$APP/Contents/MacOS/HeytaReminderProbe\""
