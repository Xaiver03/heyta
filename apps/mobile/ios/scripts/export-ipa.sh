#!/bin/bash
# 从 `.xcarchive` 导出 App Store 分发的 IPA。
#
#   bash apps/mobile/ios/scripts/export-ipa.sh [归档路径] [输出目录]
#
# 前置：`archive-release.sh` 已经成功出过归档（它会顺带校验 profile 里的 app group）。
#
# ## 🔴 两个必须显式设置的键，否则会莫名其妙失败
#
# 1. **`manageAppVersionAndBuildNumber` 必须显式设 `false`**。
#    它默认是 `true`，会在导出时"自动管理版本号" —— 而在**还没有 App 记录**或
#    与已有记录对不上时，它会多出一个失败点。实测：设 false 后导出一次通过。
# 2. **`signingStyle = manual` + 逐 bundle 指定 profile**。
#    本工程走手动签名（`CODE_SIGN_STYLE = Manual`），导出时要把两个 bundle
#    （主 App + 小组件）各自映射到对应的 App Store profile，
#    否则小组件会因为找不到 profile 而导出失败。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
ARCHIVE="${1:-/tmp/heyta.xcarchive}"
OUT_DIR="${2:-/tmp/heyta-ipa}"
TEAM="V5S2LT9YV8"

[ -d "$ARCHIVE" ] || { echo "🔴 找不到归档：${ARCHIVE}（先跑 archive-release.sh）"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PLIST="$TMP/ExportOptions.plist"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>signingStyle</key><string>manual</string>
  <key>teamID</key><string>${TEAM}</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>provisioningProfiles</key>
  <dict>
    <key>com.heyta</key><string>heyta App Store</string>
    <key>com.heyta.WidgetExtension</key><string>heyta Widget App Store</string>
  </dict>
</dict>
</plist>
PLISTEOF
plutil -lint "$PLIST" >/dev/null && echo "  ✅ ExportOptions.plist 合法"

rm -rf "$OUT_DIR"
echo ""
echo "=== 导出 IPA ==="
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$PLIST" \
  -exportPath "$OUT_DIR" \
  -allowProvisioningUpdates 2>&1 | grep -E "^\*\*|error:|Exported|warning: .*(profile|icon)" | head -12

IPA=$(find "$OUT_DIR" -name '*.ipa' | head -1)
[ -n "$IPA" ] || { echo "🔴 没产出 .ipa"; exit 1; }

echo ""
echo "=== 产物 ==="
ls -la "$OUT_DIR" | sed 's/^/  /'
echo "  IPA: $IPA  ($(stat -f%z "$IPA") 字节)"

echo ""
echo "=== 开包确认图标与小组件都在 ==="
unzip -l "$IPA" | grep -E "AppIcon|Assets.car|PlugIns/.*appex|embedded.mobileprovision" | head -10 | sed 's/^/  /'
