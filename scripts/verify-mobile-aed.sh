#!/usr/bin/env bash
# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份自己拷成同目录隐藏快照再 exec 副本；快照运行期间源文件可安全编辑。
case "$(basename "$0")" in
  .*.snap.*) ;;
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT

# A/D Android Hermes + op-sqlite evidence probe.
#
# This is intentionally a standalone probe. It builds a temporary release APK
# with hermes-aed-probe-entry.js as its entry point through a Gradle init script;
# the production apps/mobile/index.js and android/app/build.gradle stay intact.
# The emulator is launched headlessly by the caller, so this script never opens
# a foreground window.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ANDROID_DIR="$ROOT/apps/mobile/android"
ADB=${ADB:-adb}
SERIAL=${ANDROID_SERIAL:-emulator-5554}
EVIDENCE="$ROOT/apps/mobile/evidence"
STAMP=$(date +%Y%m%d-%H%M%S)
BUILD_LOG="$EVIDENCE/hermes-aed-${STAMP}-build.log"
LOG="$EVIDENCE/hermes-aed-${STAMP}.log"
SUMMARY="$EVIDENCE/hermes-aed-latest.txt"
APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"

mkdir -p "$EVIDENCE"

echo "[probe] building release APK with the standalone Hermes entry" | tee "$BUILD_LOG"
echo "[probe] this installs a TEMPORARY probe APK; run 'pnpm reinstall:all' afterwards to restore all four production installs" | tee -a "$BUILD_LOG"
(
  cd "$ANDROID_DIR"
  ./gradlew --no-daemon --console=plain \
    -PreactNativeArchitectures=arm64-v8a \
    -I hermes-aed-probe.init.gradle assembleRelease
) 2>&1 | tee -a "$BUILD_LOG"

test -s "$APK"
echo "[probe] installing $APK on $SERIAL" | tee -a "$LOG"
"$ADB" -s "$SERIAL" install -r "$APK" 2>&1 | tee -a "$LOG"

"$ADB" -s "$SERIAL" logcat -c
"$ADB" -s "$SERIAL" shell am force-stop com.heyta
# `monkey -p` returns -5 on this headless API 36 image after reinstall and may
# only mark the package stopped. Start the known activity explicitly; this is
# deterministic and still does not open a host-side foreground window.
"$ADB" -s "$SERIAL" shell am start -W -n com.heyta/com.heytamobile.MainActivity >/dev/null || true

# Hermes and op-sqlite are synchronous in the probe, but allow a generous
# device-side budget so a slow CI/emulator does not turn a valid run into a
# false timeout. No polling action touches the foreground.
for _ in $(seq 1 90); do
  if "$ADB" -s "$SERIAL" logcat -d -v brief 2>/dev/null | grep -q 'PROBE_PASS\|PROBE_FAIL'; then
    break
  fi
  sleep 1
done

"$ADB" -s "$SERIAL" logcat -d -v threadtime > "$LOG"
{
  echo "heyta Android Hermes A/D probe"
  echo "date=$STAMP"
  echo "serial=$SERIAL"
  echo "apk=$APK"
  echo "artifact=TEMPORARY_PROBE_APK"
  echo "restore=pnpm reinstall:all"
  echo "abi=$("$ADB" -s "$SERIAL" shell getprop ro.product.cpu.abi | tr -d '\r')"
  echo "status=$(grep -o 'PROBE_PASS\|PROBE_FAIL' "$LOG" | tail -1 || true)"
  grep -E 'PROBE_(START|CLOCK_BEFORE_RESTART|CHECKPOINT|DB_CLOSED|RESTART_OK|LEGACY_LIMIT_WARNING_OBSERVED|PASS|FAIL)|向量时钟有' "$LOG" || true
} | tee "$SUMMARY"

if ! grep -q 'PROBE_PASS' "$LOG" || ! grep -q '\[heyta\] 向量时钟有' "$LOG"; then
  echo "[probe] failed; complete log: $LOG" >&2
  exit 1
fi

echo "[probe] PASS; temporary APK installed. Run 'pnpm reinstall:all' to restore production installs; log=$LOG summary=$SUMMARY"
