#!/usr/bin/env bash
# r157：把四面 + 提醒块那批装置搬到「英文 × 浅」与「英文 × 暗」两格上重跑，
# 件 = 共享模拟器上现装的 main.jsbundle（跑前后各现量一次哈希，两次数不一样这批读数就不属于那一件）。
# 暗档必须先 shutdown + boot 一次才到达那枚包（环境陷阱 #471），
# 🔴 落点**末级**目录名必须带档名 —— `require_appearance` 只看末级名，写成 `en-light/settings` 就没有牙（#472）。
# 收尾一定还原：appearance=light + 应用内语言=zh —— 这台载体是共享的。
set -u
UDID=FE195661-B021-4A71-AAD1-1F2F7AE3A102
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
HERE="$ROOT/apps/mobile/evidence/ux-final-20261020/r157-en-grid"
cd "$ROOT" || exit 1

bundle_hash() {
  local app
  app=$(xcrun simctl get_app_container "$UDID" com.heyta 2>/dev/null) || return 1
  shasum -a 256 "$app/main.jsbundle" | cut -c1-16
}

restore() {
  mkdir -p "$HERE/restore"
  xcrun simctl ui "$UDID" appearance light >>"$HERE/restore/restore.log" 2>&1
  python3 scripts/qa/ios-app-language.py --udid "$UDID" --to zh \
    --evidence-dir "$HERE/restore/zh" >>"$HERE/restore/restore.log" 2>&1
  echo "RESTORE_LANGUAGE_RC=$? appearance=$(xcrun simctl ui "$UDID" appearance 2>&1)" \
    >>"$HERE/restore/restore.log"
}
trap restore EXIT

leg() { # leg <name> <script> <dir>
  mkdir -p "$3"
  python3 "$2" --udid "$UDID" --evidence-dir "$3" >"$3/run.out" 2>&1
  echo "LEG $1 rc=$?" | tee -a "$HERE/batch.log"
}

faces() { # faces <mode-suffix>
  leg "$1/settings"        scripts/qa/profile-settings-ios.py "$HERE/settings-$1"
  leg "$1/account"         scripts/qa/account-face-ios.py     "$HERE/account-$1"
  leg "$1/ai-and-help"     scripts/qa/ai-face-ios.py          "$HERE/ai-face-$1"
  leg "$1/reminder-block"  scripts/qa/reminder-block-ios.py   "$HERE/reminder-block-$1"
}

: >"$HERE/batch.log"
echo "HASH_BEFORE=$(bundle_hash)" | tee -a "$HERE/batch.log"

mkdir -p "$HERE/lang-en"
python3 scripts/qa/ios-app-language.py --udid "$UDID" --to en \
  --evidence-dir "$HERE/lang-en" >"$HERE/lang-en/run.out" 2>&1
echo "LEG lang-to-en rc=$?" | tee -a "$HERE/batch.log"

faces en-light

xcrun simctl ui "$UDID" appearance dark >>"$HERE/batch.log" 2>&1
xcrun simctl shutdown "$UDID" >>"$HERE/batch.log" 2>&1
xcrun simctl boot "$UDID" >>"$HERE/batch.log" 2>&1
for _ in $(seq 1 30); do
  xcrun simctl list devices | grep -q "($UDID) (Booted)" && break
  sleep 2
done
echo "APPEARANCE_AFTER_REBOOT=$(xcrun simctl ui "$UDID" appearance 2>&1)" | tee -a "$HERE/batch.log"

faces en-dark

echo "HASH_AFTER=$(bundle_hash)" | tee -a "$HERE/batch.log"
