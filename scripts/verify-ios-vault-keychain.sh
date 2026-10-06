#!/bin/bash
# HEYTA-SNAPSHOT-BOOTSTRAP v1
case "$(basename "$0")" in
  .*.snap.*) ;;
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" >"$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT
set -euo pipefail

# Real iOS simulator runtime probe. The probe code is compiled from the
# production HeytaVaultSecureStorage.swift and invoked through AppDelegate;
# this script never reimplements the Keychain service in a shell helper.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UDID="${IOS_UDID:-$(xcrun simctl list devices --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next((x["udid"] for values in d["devices"].values() for x in values if x.get("state")=="Booted"), ""))')}"
BID="com.heyta"
DERIVED="${HEYTA_IOS_VAULT_DERIVED:-/tmp/heyta-ios-vault-keychain-release}"
BUILD_LOG="${HEYTA_IOS_VAULT_BUILD_LOG:-/tmp/heyta-ios-vault-keychain-build.log}"

[ -n "$UDID" ] || { echo '❌ 没有 Booted iOS 模拟器；请设置 IOS_UDID。' >&2; exit 2; }
xcodebuild -workspace "$ROOT/apps/mobile/ios/Heyta.xcworkspace" -scheme Heyta \
  -configuration Release -sdk iphonesimulator -destination "id=$UDID" \
  -derivedDataPath "$DERIVED" ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  SWIFT_ACTIVE_COMPILATION_CONDITIONS='$(inherited) DEBUG' \
  EXCLUDED_SOURCE_FILE_NAMES='HeytaCardExportModule.swift HeytaCardExportModuleBridge.m' \
  build >"$BUILD_LOG" 2>&1
APP="$DERIVED/Build/Products/Release-iphonesimulator/Heyta.app"
xcrun simctl uninstall "$UDID" "$BID" >/dev/null 2>&1 || true
xcrun simctl install "$UDID" "$APP"
DATA="$(xcrun simctl get_app_container "$UDID" "$BID" data)"
PROBE="$DATA/Library/Application Support/heyta-keychain-probe.json"

run_stage() {
  local stage="$1"
  python3 - "$PROBE" <<'PY'
from pathlib import Path
import sys
try: Path(sys.argv[1]).unlink()
except FileNotFoundError: pass
PY
  xcrun simctl launch "$UDID" "$BID" -HEYTA_KEYCHAIN_PROBE "$stage" >/dev/null
  for _ in $(seq 1 20); do [ -f "$PROBE" ] && break; sleep 1; done
  [ -f "$PROBE" ] || { echo "❌ $stage 没有生成 probe 结果"; exit 1; }
  cp "$PROBE" "/tmp/heyta-keychain-probe-$stage.json"
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
}

run_stage clean
python3 - <<'PY' /tmp/heyta-keychain-probe-clean.json
import json,sys
d=json.load(open(sys.argv[1]))
assert d.get('error') is None, d
assert d['loadLengths']==[32,32], d
assert d['loadMatches']==[True,True], d
assert d['scopeIsolated'] is True, d
assert d['accessible']==['aku', 'aku'], d
print('✅ clean: scope isolation, save/load, kSecAttrAccessible=WhenUnlockedThisDeviceOnly')
PY

run_stage verify
python3 - <<'PY' /tmp/heyta-keychain-probe-verify.json
import json,sys
d=json.load(open(sys.argv[1]))
assert d.get('error') is None, d
assert d['loadMatches']==[True,True], d
assert d['loadLengths']==[32,32], d
print('✅ verify: cross-process restart load preserved both scoped keys')
PY

run_stage invalid
python3 - <<'PY' /tmp/heyta-keychain-probe-invalid.json
import json,sys
d=json.load(open(sys.argv[1]))
assert d.get('error') is None, d
assert d['invalidSaveRejected'] is True, d
print('✅ invalid: production save rejects a non-32-byte root key')
PY

run_stage remove
python3 - <<'PY' /tmp/heyta-keychain-probe-remove.json
import json,sys
d=json.load(open(sys.argv[1]))
assert d.get('error') is None, d
assert d['aMissingAfterRemove'] is True, d
assert d['bRetainedAfterRemove'] is True, d
assert d['cleanAfterRemove'] is True, d
print('✅ remove: A deleted, B isolated/retained, restart cleanup leaves no key')
PY

run_stage empty
python3 - <<'PY' /tmp/heyta-keychain-probe-empty.json
import json,sys
d=json.load(open(sys.argv[1]))
assert d.get('error') is None, d
assert d['loadLengths']==[0,0], d
assert d['loadMatches']==[False,False], d
assert d['accessible']==[None,None], d
print('✅ empty: a fresh process after remove reads neither scoped key')
PY

# Do not turn several stages in one launched process into a fake restart proof.
# The production probe records its own PID; require every stage to have a
# different PID before treating the cross-process claims as evidence.
python3 - <<'PY'
import json
from pathlib import Path

names = ('clean', 'verify', 'invalid', 'remove', 'empty')
rows = [json.loads(Path(f'/tmp/heyta-keychain-probe-{name}.json').read_text()) for name in names]
assert [row.get('stage') for row in rows] == list(names), rows
pids = [row.get('process') for row in rows]
assert all(isinstance(pid, int) and pid > 0 for pid in pids), pids
assert len(set(pids)) == len(pids), pids
print(f'✅ process isolation: {len(pids)} stages used {len(set(pids))} distinct probe processes')
PY

echo "证据：/tmp/heyta-keychain-probe-{clean,verify,invalid,remove,empty}.json"
