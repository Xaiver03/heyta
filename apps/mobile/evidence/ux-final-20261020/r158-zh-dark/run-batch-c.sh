#!/usr/bin/env bash
# r158：把四面 + 提醒块搬到「中文 × 暗」这一格上重跑，凑齐同一枚件上的 2×2。
# 件身份仍现量两头发（跑前 / 跑后各一次哈希）。
# 暗档必须先 shutdown + boot（#471）；`profile-settings-ios.py` 这趟不传 `--language`，
# 因为它默认就是 `zh`，而这一格要的就是中文档（r157 那两格红是因为英文档没传 `en`）。
set -u
UDID=FE195661-B021-4A71-AAD1-1F2F7AE3A102
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
HERE="$ROOT/apps/mobile/evidence/ux-final-20261020/r158-zh-dark"
cd "$ROOT" || exit 1

bundle_hash() {
  local app
  app=$(xcrun simctl get_app_container "$UDID" com.heyta 2>/dev/null) || return 1
  shasum -a 256 "$app/main.jsbundle" | cut -c1-16
}

restore() {
  mkdir -p "$HERE/restore"
  xcrun simctl ui "$UDID" appearance light >>"$HERE/restore/restore.log" 2>&1
  echo "appearance=$(xcrun simctl ui "$UDID" appearance 2>&1)" >>"$HERE/restore/restore.log"
}
trap restore EXIT

leg() { # leg <name> <script> <dir> [extra args...]
  local name="$1" script="$2" dir="$3"; shift 3
  mkdir -p "$dir"
  python3 "$script" --udid "$UDID" --evidence-dir "$dir" "$@" >"$dir/run.out" 2>&1
  echo "LEG $name rc=$?" | tee -a "$HERE/batch.log"
}

: >"$HERE/batch.log"
echo "HASH_BEFORE=$(bundle_hash)" | tee -a "$HERE/batch.log"

xcrun simctl ui "$UDID" appearance dark >>"$HERE/batch.log" 2>&1
xcrun simctl shutdown "$UDID" >>"$HERE/batch.log" 2>&1
xcrun simctl boot "$UDID" >>"$HERE/batch.log" 2>&1
for _ in $(seq 1 30); do
  xcrun simctl list devices | grep -q "($UDID) (Booted)" && break
  sleep 2
done
echo "APPEARANCE_AFTER_REBOOT=$(xcrun simctl ui "$UDID" appearance 2>&1)" | tee -a "$HERE/batch.log"

leg "zh-dark/settings"       scripts/qa/profile-settings-ios.py "$HERE/settings-zh-dark"
leg "zh-dark/account"        scripts/qa/account-face-ios.py     "$HERE/account-zh-dark"
leg "zh-dark/ai-and-help"    scripts/qa/ai-face-ios.py          "$HERE/ai-face-zh-dark"
leg "zh-dark/reminder-block" scripts/qa/reminder-block-ios.py   "$HERE/reminder-block-zh-dark"

echo "HASH_AFTER=$(bundle_hash)" | tee -a "$HERE/batch.log"
