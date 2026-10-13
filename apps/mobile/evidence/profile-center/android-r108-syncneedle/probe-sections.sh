#!/usr/bin/env bash
# 逐组验证共享库的 `open_settings_section` / `close_settings_sheet`。
# 只读导航：不改任何设置值、不点任何会出门的按钮，收尾把面关干净。
set -u
ROOT=$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)
RUN="${HEYTA_AB_RUN:-$HOME/heyta-r108-tmp/ab-sections}"
mkdir -p "$RUN"
printf 'AB-DUMMY-TOKEN\n' > "$RUN/token.txt"
printf 'ab-dummy@example.invalid\n' > "$RUN/email.txt"
printf 'AB-DUMMY-E2EE\n' > "$RUN/e2ee.txt"
export HEYTA_E2E_TOKEN_FILE="$RUN/token.txt" HEYTA_E2E_EMAIL_FILE="$RUN/email.txt" \
       HEYTA_E2E_E2EE_FILE="$RUN/e2ee.txt" \
       HEYTA_E2E_UI_XML="$RUN/ui.xml" HEYTA_E2E_XY_PY="$RUN/_xy.py"
# shellcheck source=/dev/null
. "$ROOT/scripts/lib/mobile-e2e.sh"

echo "HEAD=$(git -C "$ROOT" rev-parse --short HEAD) SERIAL=$E2E_SERIAL"
$ADB shell am force-stop $PKG; launch_app; sleep 4
handle_privacy_consent; dismiss_welcome_if_present
$ADB shell input tap 945 2253; sleep 3          # 「我的」

# 每组各一枚"这组里独有的 testID"，用来证明点进去的不是别的组。
for pair in "general|profile-language" "sync|privacy-consent-section" "ai|ai-settings-section" \
            "data|settings-data-actions" "security|settings-security-actions"; do
  key="${pair%%|*}"; anchor="${pair#*|}"
  open_settings_section "$key"
  dump   # `xy_rid` 读的是 $UI_XML 那份快照，不自己 dump
  row_in_tree=0; [ -n "$(xy_rid "settings-section-$key")" ] && row_in_tree=1
  anchor_in_tree=0; [ -n "$(xy_rid "$anchor")" ] && anchor_in_tree=1
  sheet=0; [ -n "$(xy_rid "settings-sheet")" ] && sheet=1
  echo "KEY=$key dir_row_found=$row_in_tree anchor=$anchor anchor_in_tree=$anchor_in_tree sheet_open=$sheet"
  close_settings_sheet && echo "  SHEET_CLOSED" || echo "  SHEET_STILL_OPEN"
  dump
  sheet=0; [ -n "$(xy_rid "settings-sheet")" ] && sheet=1
  echo "  sheet_open_after_close=$sheet"
  $ADB shell input tap 945 2253; sleep 2
done
