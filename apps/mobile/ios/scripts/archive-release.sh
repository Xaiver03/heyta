#!/bin/bash
# 出 iOS 的**正式发布包**（App Store 分发签名），并把签名证书指纹打出来（备案要用）。
#
#   bash apps/mobile/ios/scripts/archive-release.sh [归档路径]
#
# ## 为什么要有这个脚本
#
# 出包这件事有**五个**容易漏的前提（团队、证书、两个 profile、两个 App ID、App Group），
# 任何一条缺了，报错都发生在 xcodebuild 很后面的位置，而且信息零散。
# 所以这里把前提**前置成一次 preflight**，缺什么就直接说清楚缺什么、去哪儿补。
#
# 🔴 **本轮实测卡住的那一条**：App Group `group.com.heyta.mobile` 必须先在
#    App Store Connect 网页建出来并勾给两个 App ID。
#    Apple 的**公开 API 不提供建 App Group 的能力**（签名域只覆盖
#    bundleIds / capabilities / certificates / profiles / devices），
#    `asc web` 也只有 `sync-app-clip` —— 所以这一步只能人在网页上做。
#    ⚠️ 别试图把 entitlements 里的 app group 删掉绕过：widget 真的在用它
#    （`WidgetContainerFiles.swift` 打开共享容器、`AppGroupWidgetStore` 挂在
#    `HeytaWidgetModule` 上），删了就是**用一个运行时故障换一个绿色构建**。
set -uo pipefail

TEAM="V5S2LT9YV8"
APP_BUNDLE="com.heyta.mobile"
WIDGET_BUNDLE="com.heyta.mobile.WidgetExtension"
APP_PROFILE="heyta App Store"
WIDGET_PROFILE="heyta Widget App Store"
APP_GROUP="group.com.heyta.mobile"
ARCHIVE_PATH="${1:-/tmp/heyta.xcarchive}"

cd "$(dirname "$0")/.." || exit 1
fail() { echo "" >&2; echo "🔴 $1" >&2; exit 1; }

echo "=== preflight ==="

# ① 团队
grep -q "DEVELOPMENT_TEAM = ${TEAM}" HeytaMobile.xcodeproj/project.pbxproj \
  || fail "工程里没有 DEVELOPMENT_TEAM = ${TEAM}"
echo "  ✅ 团队 ${TEAM}"

# ② 两个 profile 都装了，而且**都授予了 app group**
PROFILE_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"
# 用 python/plistlib 读 profile：`security cms -D` 出来的 XML plist 直接喂给它最稳。
# ⚠️ 别用 `plutil -convert json` —— profile 里有 <data>（证书二进制），
#    JSON 表示不了，会报 "Invalid object in plist for JSON format"。
check_profile() {
  local name="$1"
  local result
  result=$(python3 - "$PROFILE_DIR" "$name" <<'PYPROFILE'
import plistlib, pathlib, subprocess, sys
directory, want = sys.argv[1], sys.argv[2]
for f in sorted(pathlib.Path(directory).glob('*.mobileprovision')):
    try:
        plist = plistlib.loads(subprocess.run(['security', 'cms', '-D', '-i', str(f)],
                                              capture_output=True).stdout)
    except Exception:
        continue
    if plist.get('Name') == want:
        groups = plist.get('Entitlements', {}).get('com.apple.security.application-groups', []) or []
        print('FOUND:' + ','.join(groups))
        raise SystemExit(0)
print('MISSING:')
PYPROFILE
)
  case "$result" in
    MISSING:*)
      fail "找不到已安装的 profile「${name}」
    ⇒ 下载并安装：asc profiles download --id <PROFILE_ID> --output /tmp/p.mobileprovision
                  asc profiles local install --path /tmp/p.mobileprovision
      （PROFILE_ID 见 README 的表）" ;;
  esac
  local granted="${result#FOUND:}"
  if ! printf '%s' "$granted" | grep -q "${APP_GROUP}"; then
    fail "profile「${name}」没有授予 ${APP_GROUP}（当前授权：[${granted}]）
    ⇒ 请在 App Store Connect 网页操作（**公开 API 建不了 App Group**）：
       1. Identifiers → App Groups → 新建 ${APP_GROUP}
       2. 把 ${APP_GROUP} 同时勾给 ${APP_BUNDLE} 与 ${WIDGET_BUNDLE}
       3. 删掉旧的两个 profile 重建，再重跑本脚本"
  fi
  echo "  ✅ profile「${name}」已授予 ${APP_GROUP}"
}
check_profile "$APP_PROFILE"
check_profile "$WIDGET_PROFILE"

# ③ 能签名（证书在钥匙串里）
security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Distribution" \
  || fail "钥匙串里没有 Apple Distribution 身份"
echo "  ✅ Apple Distribution 身份在位"

echo ""
echo "=== 归档 ==="
rm -rf "$ARCHIVE_PATH"
xcodebuild -workspace HeytaMobile.xcworkspace -scheme HeytaMobile -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE_PATH" archive \
  DEVELOPMENT_TEAM="$TEAM" 2>&1 | grep -E "BUILD SUCCEEDED|BUILD FAILED|error:" | head -10
[ -d "$ARCHIVE_PATH" ] || fail "归档失败（没有产出 $ARCHIVE_PATH）"

echo ""
echo "=== 从**已签名产物**里读回签名证书（这是备案要的权威值）==="
APP="$ARCHIVE_PATH/Products/Applications/HeytaMobile.app"
[ -d "$APP" ] || fail "归档里没有 HeytaMobile.app"
codesign -dvvv "$APP" 2>&1 | grep -E "Authority|TeamIdentifier|Identifier=" | sed 's/^/  /'

TMP=$(mktemp -d)
codesign -d --extract-certificates "$TMP/cert" "$APP" >/dev/null 2>&1
CERT=$(ls "$TMP"/cert* 2>/dev/null | head -1)
if [ -n "${CERT:-}" ]; then
  python3 - "$CERT" <<'PY'
import hashlib, pathlib, subprocess, sys
der = pathlib.Path(sys.argv[1]).read_bytes()
print("  " + subprocess.run(["openssl","x509","-inform","DER","-in",sys.argv[1],"-noout","-subject"],
                           capture_output=True, text=True).stdout.strip()[:120])
for algo in ("sha1", "md5", "sha256"):
    h = hashlib.new(algo, der).hexdigest().upper()
    print(f"  {algo.upper():6} = " + ":".join(h[i:i+2] for i in range(0, len(h), 2)))
PY
else
  echo "  ⚠️ 没能从产物里提取证书（改用 profile 里的证书指纹）"
fi
rm -rf "$TMP"

echo ""
echo "=== 产物 ==="
ls -la "$ARCHIVE_PATH" | sed 's/^/  /'
