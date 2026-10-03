#!/usr/bin/env bash
# HEYTA-SNAPSHOT-BOOTSTRAP v1 (environment-traps #110/#113)
case "$(basename "$0")" in
  .*.snap.*) ;;
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT
# Real Android Keystore persistence. Run only while owning the emulator.
# Installs the current Debug + test APK; final delivery still requires Release reinstall.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB_BIN="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb"
SERIAL="${HEYTA_ANDROID_SERIAL:-emulator-5554}"
ADB=("$ADB_BIN" -s "$SERIAL")
APP=com.heyta
TEST_CLASS=com.heytamobile.vault.VaultSecureStorageDeviceTest
EVIDENCE="$ROOT/apps/mobile/evidence/android-vault-storage.txt"
RUN_DIR="$(mktemp -d /tmp/heyta-vault-storage.XXXXXX)"
mkdir -p "$(dirname "$EVIDENCE")"
printf 'Android vault storage: pending\n' > "$EVIDENCE"

(cd "$ROOT/apps/mobile/android" && ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest) > "$RUN_DIR/build.log" 2>&1
APP_APK="$ROOT/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$ROOT/apps/mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
# This dedicated QA device may contain a Release package signed differently.
# Start clean before seeding; never uninstall between persistence phases.
for package in "$APP.test" "$APP"; do
  if "${ADB[@]}" shell pm path "$package" | rg -q '^package:'; then
    "${ADB[@]}" uninstall "$package"
  fi
done
"${ADB[@]}" install -r "$APP_APK"
"${ADB[@]}" install -r "$TEST_APK"
(cd "$ROOT" && shasum -a 256 "${APP_APK#"$ROOT/"}" "${TEST_APK#"$ROOT/"}") >> "$EVIDENCE"

run_case() {
  local method="$1" phase="${2:-}" log="$RUN_DIR/${2:-isolation}.log"
  local args=(-w -r -e class "$TEST_CLASS#$method")
  if [ -n "$phase" ]; then args+=(-e vaultProbePhase "$phase"); fi
  # force-stop here deliberately separates Keystore test processes. This is
  # unrelated to the reminder contract, which must never promise force-stop delivery.
  "${ADB[@]}" shell am force-stop "$APP"
  "${ADB[@]}" shell am instrument "${args[@]}" "$APP.test/androidx.test.runner.AndroidJUnitRunner" > "$log" 2>&1
  if ! rg -q 'OK \(1 test\)' "$log" || rg -q 'FAILURES|INSTRUMENTATION_FAILED|Process crashed' "$log"; then
    cat "$log"
    printf 'FAIL phase=%s\n' "${phase:-isolation}" >> "$EVIDENCE"
    exit 1
  fi
  printf 'PASS phase=%s\n' "${phase:-isolation}" | tee -a "$EVIDENCE"
}

run_case accountScopesAreIsolatedAndRemovalDoesNotTouchAnotherAccount
run_case separateProcessPersistenceAndDeletion seed
run_case separateProcessPersistenceAndDeletion verify
"${ADB[@]}" reboot
"${ADB[@]}" wait-for-device
booted=0
for ((i=0; i<90; i++)); do
  if [ "$("${ADB[@]}" shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; then booted=1; break; fi
  sleep 2
done
[ "$booted" = 1 ] || { printf 'FAIL boot timeout\n' >> "$EVIDENCE"; exit 1; }
"${ADB[@]}" shell input keyevent KEYCODE_WAKEUP
"${ADB[@]}" shell wm dismiss-keyguard
run_case separateProcessPersistenceAndDeletion remove
run_case separateProcessPersistenceAndDeletion clean
printf 'RESULT=OK; process restart + device reboot + scoped deletion verified\nLock-screen authentication is not claimed by Android Keystore policy.\n' | tee -a "$EVIDENCE"
