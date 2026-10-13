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
xcodebuild -project "$HERE/../HeytaWidgets.xcodeproj" -scheme HeytaMacWidget \
  -configuration Release -derivedDataPath "$BUILD" DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGNING_ALLOWED=NO build > "$BUILD/build.log" 2>&1 || {
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
