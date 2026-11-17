#!/usr/bin/env bash
# 把 heyta 装到**已连接的 iOS 真机**上（开发签名，一台机器一份产物两处可装）。
#
# 用法：
#   bash scripts/ios-device-install.sh                # 只有一台在线设备时直接用它
#   bash scripts/ios-device-install.sh iPhone          # 按名字/UDID 片段挑设备
#   bash scripts/ios-device-install.sh --list          # 只列在线设备与可用 profile
#
# 为什么要这个脚本（2026-11-16 实测的三件事）：
#
# 1. **App Store profile 装不进设备。** 仓库里 Release 配置写死的是
#    `heyta App Store`（分发用），装设备会报
#    `This provisioning profile cannot be installed on this device` 或
#    `Attempted to install a Beta profile without the proper entitlement`。
#    真机必须用 `IOS_APP_DEVELOPMENT` profile。
#
# 2. **开发 profile 要逐台把 UDID 加进去。** 现有的 `heyta Dev iPad` 只含 iPad。
#    现在有 `heyta Dev iPad+XR` / `heyta Widget Dev iPad+XR` 两份，同时含
#    iPad A16（`00008120-001E6C1C00A14032`）与 iPhone XR（`00008020-001A599A0AF3002E`）。
#    换新设备时要先 `asc devices create`，再重建 profile（`asc profiles create`
#    **不能改设备列表**，只能新建）：
#
#      asc profiles create --name "heyta Dev iPad+XR+新机型" \
#        --profile-type IOS_APP_DEVELOPMENT --bundle N4UC5QM39L \
#        --certificate GSFRN8Q8P6 --device <ID1>,<ID2>,<ID3>
#      asc profiles create --name "heyta Widget Dev iPad+XR+新机型" \
#        --profile-type IOS_APP_DEVELOPMENT --bundle JNYNN25N4C \
#        --certificate GSFRN8Q8P6 --device <ID1>,<ID2>,<ID3>
#      asc profiles download --id <PROFILE_ID> --output x.mobileprovision
#      asc profiles local install --path x.mobileprovision
#
# 3. **签名配置是临时改的，必须无条件还原。** `project.pbxproj` 是共享文件，
#    另一个会话随时可能在改它。脚本用 `trap` 还原，并在动它之前核对 sha256。
#
# 判据：装完之后 `devicectl device process launch` 能启动，且截图非空。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$REPO_ROOT/apps/mobile/ios"
PBX="$IOS_DIR/Heyta.xcodeproj/project.pbxproj"
APP_PROFILE="heyta Dev iPad+XR"
WIDGET_PROFILE="heyta Widget Dev iPad+XR"
DERIVED="$IOS_DIR/build-device"
ARTIFACT="$DERIVED/Build/Products/Release-iphoneos/Heyta.app"

# 这两个值只用来核对 profile 已装好；不是密钥。
BUNDLE_ID="com.heyta"

say() { printf '%s\n' "$*"; }
die() { printf '🔴 %s\n' "$*" >&2; exit 1; }

list_devices() {
  xcrun devicectl list devices 2>/dev/null \
    | awk 'NR>2 && NF {print $0}' \
    | grep -vi 'simulated' \
    | sed -e 's/[[:space:]]\+/ /g'
}

profiles_installed() {
  local d=~/Library/MobileDevice/Provisioning\ Profiles
  local missing=0
  for name in "$APP_PROFILE" "$WIDGET_PROFILE"; do
    local found=0
    for f in "$d"/*.mobileprovision; do
      [ -e "$f" ] || continue
      local n
      n=$(security cms -D -i "$f" 2>/dev/null | plutil -extract Name raw -o - - 2>/dev/null || true)
      [ "$n" = "$name" ] && { found=1; break; }
    done
    if [ "$found" = "0" ]; then
      say "   缺 profile：$name"
      missing=1
    else
      say "   ✅ $name"
    fi
  done
  return "$missing"
}

if [ "${1:-}" = "--list" ]; then
  say "在线设备："
  list_devices
  say ""
  say "本机已装的开发 profile："
  profiles_installed || true
  exit 0
fi

FILTER="${1:-}"

[ -d "$IOS_DIR" ] || die "找不到 $IOS_DIR"

say "① 在线设备"
DEVICES="$(list_devices)"
[ -n "$DEVICES" ] || die "没有在线的 iOS 设备。插上线、解锁、信任这台电脑。"
say "$DEVICES"

if [ -n "$FILTER" ]; then
  MATCHES="$(printf '%s\n' "$DEVICES" | grep -i -- "$FILTER" || true)"
  [ -n "$MATCHES" ] || die "没有设备匹配「${FILTER}」。"
  COUNT="$(printf '%s\n' "$MATCHES" | wc -l | tr -d ' ')"
  [ "$COUNT" = "1" ] || die "「${FILTER}」匹配到 $COUNT 台，请写更具体一点：\n$MATCHES"
  DEVICE_LINE="$MATCHES"
else
  COUNT="$(printf '%s\n' "$DEVICES" | wc -l | tr -d ' ')"
  [ "$COUNT" = "1" ] || die "有多台设备在线，请指定名字片段（例如 iPhone / iPad）：\n$DEVICES"
  DEVICE_LINE="$DEVICES"
fi

UDID="$(printf '%s' "$DEVICE_LINE" | grep -oE '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16,}' | head -1)"
[ -n "$UDID" ] || die "从这一行里没解析出 UDID：$DEVICE_LINE"
say "   目标设备 UDID：$UDID"

say ""
say "② 开发 profile"
profiles_installed || die "先按脚本头部注释里的 asc 命令把 profile 建好并 local install。"

say ""
say "③ 临时切到开发签名（结束后无条件还原）"
PBX_SHA_BEFORE="$(shasum -a 256 "$PBX" | awk '{print $1}')"
cp "$PBX" /tmp/heyta-pbxproj.$$.bak
restore_pbx() {
  if [ -f /tmp/heyta-pbxproj.$$.bak ]; then
    cp /tmp/heyta-pbxproj.$$.bak "$PBX"
    rm -f /tmp/heyta-pbxproj.$$.bak
    local now
    now="$(shasum -a 256 "$PBX" | awk '{print $1}')"
    if [ "$now" = "$PBX_SHA_BEFORE" ]; then
      say "   ✅ project.pbxproj 已还原（sha256 ${PBX_SHA_BEFORE:0:12}）"
    else
      say "   🔴 project.pbxproj 还原后 sha256 不一致：$PBX_SHA_BEFORE -> $now"
      say "      备份在 /tmp/heyta-pbxproj.$$.bak.（不该发生，请人工核对）"
    fi
  fi
}
trap restore_pbx EXIT INT TERM

python3 - "$PBX" "$APP_PROFILE" "$WIDGET_PROFILE" <<'PY'
import sys
pbx, app_profile, widget_profile = sys.argv[1:4]
s = open(pbx, encoding='utf-8').read()
before = s
s = s.replace('PROVISIONING_PROFILE_SPECIFIER = "heyta App Store";',
              f'PROVISIONING_PROFILE_SPECIFIER = "{app_profile}";', 1)
s = s.replace('PROVISIONING_PROFILE_SPECIFIER = "heyta Widget App Store";',
              f'PROVISIONING_PROFILE_SPECIFIER = "{widget_profile}";', 1)
s = s.replace('CODE_SIGN_IDENTITY = "Apple Distribution";',
              'CODE_SIGN_IDENTITY = "iPhone Developer";')
assert s != before, "签名项一个都没替换到 —— pbxproj 的形状变了，先核对再改"
open(pbx, 'w', encoding='utf-8').write(s)
PY
say "   已切到 $APP_PROFILE / $WIDGET_PROFILE"

say ""
say "④ 构建（Release，真机 SDK）"
( cd "$IOS_DIR" && xcodebuild \
    -workspace Heyta.xcworkspace -scheme Heyta \
    -configuration Release -sdk iphoneos \
    -derivedDataPath "$DERIVED" build ) > /tmp/heyta-ios-build.log 2>&1 \
  || die "构建失败，日志 /tmp/heyta-ios-build.log（末尾 20 行见下）"$'\n'"$(tail -20 /tmp/heyta-ios-build.log)"
[ -d "$ARTIFACT" ] || die "构建成功但产物不在 $ARTIFACT"
say "   ✅ $ARTIFACT"

say ""
say "⑤ 安装到 $UDID"
xcrun devicectl device install app --device "$UDID" "$ARTIFACT" \
  || die "安装失败。若报 profile 不匹配，说明这台设备的 UDID 不在 profile 里 —— 按脚本头部注释重建 profile。"

say ""
say "⑥ 启动"
xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" >/dev/null \
  && say "   ✅ 已启动 $BUNDLE_ID" \
  || say "   ⚠️ 启动命令返回非 0（应用可能已在运行，不影响安装结果）"

say ""
say "完成。截图核对："
say "  xcrun devicectl device capture screenshot --device $UDID --destination /tmp/x.png"
