#!/bin/bash
# 验证 iOS / Android 的 **release** 包能进入产品界面（不依赖 Metro）。
#
#   bash apps/mobile/scripts/verify-release-builds.sh [ios|android|both]
#
# ── 🔴 为什么必须单独验 release ────────────────────────────────────────────
#
# 调试包**依赖 Metro 打包服务器**：没起 Metro 时 iOS 直接红屏
# `No script URL provided ... unsanitizedScriptURLString = (null)`。
# 实测过：那个红屏的内容比例高达 98.8%、色阶 255 ——
# **空白检测完全通过**，看起来像"界面渲染好了"。所以"能进界面"
# 这件事对 debug 包根本不成立，必须用 release 包验。
#
# 本脚本的关键动作是**先确认 8081 无监听**，再启动应用 ——
# 这样"能起来"才等价于"JS bundle 真的内嵌在包里"。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MOBILE="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$MOBILE/../.." && pwd)"
EVIDENCE="$MOBILE/evidence"
TARGET="${1:-both}"

IOS_UDID="${HEYTA_IOS_UDID:-1B785D80-049E-4BB0-9267-3A8A37EAADBC}"
ANDROID_SERIAL="${HEYTA_ANDROID_SERIAL:-emulator-5554}"
IOS_BUNDLE="com.heyta.mobile"
# Keep this in sync with the manifest's real applicationId. A stale package
# name makes uninstall/launch silently target nothing and can leave an old
# screenshot looking like a successful release verification.
ANDROID_PACKAGE="com.heyta"

mkdir -p "$EVIDENCE"

# ── 关键前置：Metro 必须停 ──────────────────────────────────────────────
echo "=== 🔴 确认 Metro（8081）没有监听 ==="
if lsof -nP -iTCP:8081 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  🔴 8081 还在监听 —— 先停掉 Metro，否则验不出 release 是否自足"
  lsof -nP -iTCP:8081 -sTCP:LISTEN | tail -n +2 | sed 's/^/     /'
  exit 1
fi
echo "  ✅ 无监听"

validate() {
  local png="$1" label="$2"
  [ -f "$png" ] || { echo "  🔴 没产出截图：$png"; return 1; }
  node - "$png" "$label" <<'JS'
import { inspectPng, looksBlank, looksSmeared } from './scripts/screenshots/png-stats.mjs';
const [file, label] = process.argv.slice(2);
const st = inspectPng(file);
console.log(`  ${label}: ${st.width}x${st.height}  内容 ${(st.contentRatio * 100).toFixed(1)}%  色阶 ${st.colorSpan}`);
let bad = false;
if (looksBlank(st)) { console.error(`  🔴 ${label}: 疑似空白`); bad = true; }
if (looksSmeared(st)) { console.error(`  🔴 ${label}: 疑似渲染坏了`); bad = true; }
if (bad) process.exit(1);
console.log(`  ✅ ${label}: 有真实内容且渲染正常`);
JS
}

verify_ios() {
  echo ""
  echo "=== iOS release ==="
  local app
  app="$(find /tmp/heyta-ios-release -name 'Heyta.app' -path '*Release-iphonesimulator*' 2>/dev/null | head -1)"
  [ -n "$app" ] || { echo "  🔴 找不到 Release 产物。先构建："; \
    echo "     xcodebuild -workspace apps/mobile/ios/Heyta.xcworkspace -scheme Heyta \\"; \
    echo "       -configuration Release -sdk iphonesimulator -destination 'id=$IOS_UDID' \\"; \
    echo "       -derivedDataPath /tmp/heyta-ios-release build"; exit 1; }

  # 内嵌 bundle 是 release 自足的前提，先查
  if [ ! -f "$app/main.jsbundle" ]; then
    echo "  🔴 $app 里没有 main.jsbundle —— 这个包会依赖 Metro，不是自足的"; exit 1
  fi
  echo "  ✅ 内嵌 main.jsbundle：$(stat -f%z "$app/main.jsbundle") 字节"

  xcrun simctl uninstall "$IOS_UDID" "$IOS_BUNDLE" >/dev/null 2>&1 || true
  xcrun simctl install "$IOS_UDID" "$app"
  xcrun simctl launch "$IOS_UDID" "$IOS_BUNDLE" | awk '{print "  " $0}'
  sleep 15
  local png="$EVIDENCE/ios-release.png"
  xcrun simctl io "$IOS_UDID" screenshot "$png" >/dev/null 2>&1
  validate "$png" "iOS release"

  cat > "$EVIDENCE/ios-release.txt" <<EOF
# iOS release 包进入产品界面的取证
#
# 复现：bash apps/mobile/scripts/verify-release-builds.sh ios
#
# 🔴 前置条件是**先确认 8081（Metro）无监听**再启动 —— 见脚本开头。
#   debug 包没 Metro 会红屏 "No script URL provided"，而那个红屏
#   内容比例 98.8%、色阶 255，**空白检测完全通过**，看起来像渲染好了。
#
# 构建：xcodebuild -workspace apps/mobile/ios/Heyta.xcworkspace \\
#         -scheme Heyta -configuration Release -sdk iphonesimulator \\
#         -destination 'id=$IOS_UDID' -derivedDataPath /tmp/heyta-ios-release build
# 产物内嵌 main.jsbundle = 自足（不依赖 Metro）
# 设备：iPhone 17 Pro 模拟器（${IOS_UDID}）

CAPTURE_METHOD=simctl-screenshot
EOF
}

verify_android() {
  echo ""
  echo "=== Android release ==="
  local apk="$MOBILE/android/app/build/outputs/apk/release/app-release.apk"
  [ -f "$apk" ] || { echo "  🔴 找不到 ${apk}。先构建：pnpm --filter @heyta/mobile build:android"; exit 1; }
  echo "  APK: $(stat -f%z "$apk") 字节"

  adb -s "$ANDROID_SERIAL" uninstall "$ANDROID_PACKAGE" >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" install "$apk" | tail -1 | awk '{print "  " $0}'
  adb -s "$ANDROID_SERIAL" reverse --remove-all >/dev/null 2>&1 || true
  adb -s "$ANDROID_SERIAL" shell am force-stop "$ANDROID_PACKAGE" >/dev/null 2>&1 || true
  # `monkey -p` returns result code -5 on this API 36 emulator when the
  # installed component retains a disabled-state override, even though the
  # real launcher activity is resolvable and starts correctly. Use the
  # resolved component explicitly and require ActivityTaskManager to report a
  # successful launch so a stale screenshot cannot make this green.
  launch_output="$(adb -s "$ANDROID_SERIAL" shell am start -W -n "$ANDROID_PACKAGE/com.heytamobile.MainActivity" 2>&1)"
  printf '%s\n' "$launch_output" | grep -q 'Status: ok' || {
    printf '%s\n' "$launch_output" >&2
    echo "  🔴 Android activity failed to launch" >&2
    return 1
  }
  sleep 25
  local png="$EVIDENCE/android-release.png"
  adb -s "$ANDROID_SERIAL" exec-out screencap -p > "$png"
  validate "$png" "Android release"

  cat > "$EVIDENCE/android-release.txt" <<EOF
# Android release 包进入产品界面的取证
#
# 复现：bash apps/mobile/scripts/verify-release-builds.sh android
#
# 🔴 前置条件是**先确认 8081（Metro）无监听**，并 \`adb reverse --remove-all\`
#   撤销端口转发 —— 这样"能起来"才等价于"JS bundle 真的内嵌在包里"。
#
# 构建：pnpm --filter @heyta/mobile build:android（assembleRelease）
# 签名：正式发布签名（见 docs/runbooks/multi-platform-build.md §1.5.1）
# 设备：emulator-5554

CAPTURE_METHOD=adb-screencap
EOF
}

case "$TARGET" in
  ios) verify_ios ;;
  android) verify_android ;;
  both) verify_ios; verify_android ;;
  *) echo "用法: $0 [ios|android|both]"; exit 1 ;;
esac

echo ""
echo "=== 产物 ==="
ls -la "$EVIDENCE" | awk '{print "  " $0}'
