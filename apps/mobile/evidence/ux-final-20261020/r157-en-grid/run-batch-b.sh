#!/usr/bin/env bash
# r157b：补跑设置面那两格英文档。
# 第一趟红在**驱动脚本没传 `--language en`**（`profile-settings-ios.py` 该参数默认 `zh`），
# 而装置那枚 #488 守卫把真因写进了失败原文（它列出屏幕上在场的是 `en` 那一整组标签）⇒ 不是界面缺陷。
# 失败那次的 run.out 先改名留在同一目录里，再重跑，落点仍是每格一个目录。
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
  mkdir -p "$HERE/restore-b"
  xcrun simctl ui "$UDID" appearance light >>"$HERE/restore-b/restore.log" 2>&1
  python3 scripts/qa/ios-app-language.py --udid "$UDID" --to zh \
    --evidence-dir "$HERE/restore-b/zh" >>"$HERE/restore-b/restore.log" 2>&1
  echo "RESTORE_LANGUAGE_RC=$? appearance=$(xcrun simctl ui "$UDID" appearance 2>&1)" \
    >>"$HERE/restore-b/restore.log"
}
trap restore EXIT

settings() { # settings <dir>
  if [ -f "$HERE/$1/run.out" ] && ! grep -q '"status": "passed"' "$HERE/$1/run.out"; then
    mv "$HERE/$1/run.out" "$HERE/$1/failed-default-zh-run.out"
  fi
  python3 scripts/qa/profile-settings-ios.py --udid "$UDID" --language en \
    --evidence-dir "$HERE/$1" >"$HERE/$1/run.out" 2>&1
  echo "LEG $1 rc=$?" | tee -a "$HERE/batch-b.log"
}

: >"$HERE/batch-b.log"
echo "HASH_BEFORE=$(bundle_hash)" | tee -a "$HERE/batch-b.log"

mkdir -p "$HERE/lang-en-b"
python3 scripts/qa/ios-app-language.py --udid "$UDID" --to en \
  --evidence-dir "$HERE/lang-en-b" >"$HERE/lang-en-b/run.out" 2>&1
echo "LEG lang-to-en rc=$?" | tee -a "$HERE/batch-b.log"

settings settings-en-light

xcrun simctl ui "$UDID" appearance dark >>"$HERE/batch-b.log" 2>&1
xcrun simctl shutdown "$UDID" >>"$HERE/batch-b.log" 2>&1
xcrun simctl boot "$UDID" >>"$HERE/batch-b.log" 2>&1
for _ in $(seq 1 30); do
  xcrun simctl list devices | grep -q "($UDID) (Booted)" && break
  sleep 2
done
echo "APPEARANCE_AFTER_REBOOT=$(xcrun simctl ui "$UDID" appearance 2>&1)" | tee -a "$HERE/batch-b.log"

settings settings-en-dark
echo "HASH_AFTER=$(bundle_hash)" | tee -a "$HERE/batch-b.log"
