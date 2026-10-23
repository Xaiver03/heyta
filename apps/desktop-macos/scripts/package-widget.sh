#!/bin/bash
# Embeds a native WidgetKit extension; all shared rendering is built from the iOS/macOS Swift package.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="${1:?host .app required}"
BUILD="${2:?build directory required}"
IDENTITY="${3:?signing identity required}"
TEAM="${4:?team required}"
PROFILE="$(python3 "$HERE/find-signing-profile.py" cloud.finlaw.heyta.desktop.widgets "$TEAM")"
mkdir -p "$BUILD" "$APP/Contents/PlugIns"
# 🔴 xcodebuild 解析 SwiftPM 包图时要编译 manifest，SwiftPM 的 manifest 编译走
#    sandbox-exec；**已有沙箱里**再套会被内核拒（sandbox_apply: Operation not
#    permitted）⇒ `error: Could not resolve package dependencies`。2026-10-23 在本机
#    （agent 运行时的 Seatbelt 沙箱，会继承给子孙进程）实测必现，与工具链版本无关
#    —— 报错指向"包依赖解析"，实际是环境（与 storage-host 取证记的 Invalid manifest 同族）。
#    ⚠️ `SWIFTPM_DISABLE_SANDBOX=1` 对它**无效**（同日实测）；正解是 xcodebuild 的两个
#    argv 开关（它们是 NSUserDefaults，只能经 argv 传，`defaults write` 到不了）：
#      -IDEPackageSupportDisableManifestSandbox / -IDEPackageSupportDisablePluginExecutionSandbox
#    与 `package-app.sh` 同一策略：先探，探得过就照旧带内层沙盒跑（一根头发都不动），
#    探不过才加。这不是放宽安全边界的选择题 —— 不能用的环境里不加就没有 mac 安装包。
SWIFTPM_SANDBOX_ARGS=""
if ! sandbox-exec -p '(version 1)(deny default)(allow file-read*)' /bin/echo >/dev/null 2>&1; then
  SWIFTPM_SANDBOX_ARGS="-IDEPackageSupportDisableManifestSandbox=1 -IDEPackageSupportDisablePluginExecutionSandbox=1"
  echo "  ⚠️ 本环境套不上限制性 sandbox profile（sandbox_apply EPERM）⇒ xcodebuild 关掉 SwiftPM 内层 manifest 沙盒"
fi
xcodebuild -project "$HERE/../HeytaWidgets.xcodeproj" -scheme HeytaMacWidget \
  -configuration Release -derivedDataPath "$BUILD" DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGNING_ALLOWED=NO $SWIFTPM_SANDBOX_ARGS build > "$BUILD/build.log" 2>&1 || {
    tail -80 "$BUILD/build.log"; exit 1;
  }
EXT="$APP/Contents/PlugIns/HeytaMacWidget.appex"
ditto "$BUILD/Build/Products/Release/HeytaMacWidget.appex" "$EXT"
cp "$PROFILE" "$EXT/Contents/embedded.provisionprofile"
sed "s/\$(DEVELOPMENT_TEAM)/$TEAM/g" "$HERE/../WidgetExtension/HeytaMacWidget.entitlements" > "$BUILD/widget.entitlements"
codesign --force --options runtime --timestamp --entitlements "$BUILD/widget.entitlements" --sign "$IDENTITY" "$EXT"
codesign --verify --strict "$EXT"
[ -f "$EXT/Contents/Resources/Metadata.appintents/extract.actionsdata" ] || {
  echo '🔴 Widget AppIntents metadata missing'; exit 1;
}
echo 'WIDGET_EXTENSION=embedded-native-macos'
