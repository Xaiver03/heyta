#!/usr/bin/env bash
# 单独调用共享 lib 里的 `configure_sync_credentials`，取「改前 / 改后」两臂的设备读数。
#
# 为什么要有这么一枚驱动器：这条函数被 20 多份设备腿共用，而它到底能不能在当前产品的
# 设置面上走到凭据表单，只有真设备上跑一次才知道 —— 读代码只能看出"它期望什么"。
#
# 安全边界（都是刻意的）：
#   · 凭据用假值，且把 `HEYTA_E2E_*_FILE` 指到私有目录 —— 真令牌根本不会被读到；
#   · 现场路径（ui.xml / _xy.py）也指到私有目录，不覆盖并行会话正在读的那份；
#   · 全程不点「立即同步」，所以没有任何动作会离开设备。
set -u
ROOT=$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)
RUN="${HEYTA_AB_RUN:-$HOME/heyta-r108-tmp/ab-configure}"
mkdir -p "$RUN"
printf 'AB-DUMMY-TOKEN-0123456789\n' > "$RUN/token.txt"
printf 'ab-dummy@example.invalid\n'  > "$RUN/email.txt"
printf 'AB-DUMMY-E2EE\n'             > "$RUN/e2ee.txt"
export HEYTA_E2E_TOKEN_FILE="$RUN/token.txt" HEYTA_E2E_EMAIL_FILE="$RUN/email.txt" \
       HEYTA_E2E_E2EE_FILE="$RUN/e2ee.txt" \
       HEYTA_E2E_UI_XML="$RUN/ui.xml" HEYTA_E2E_XY_PY="$RUN/_xy.py"

# shellcheck source=/dev/null
. "$ROOT/scripts/lib/mobile-e2e.sh"

ARM="${1:-?}"
echo "ARM=$ARM HEAD=$(git -C "$ROOT" rev-parse --short HEAD) \
LIB_BLOB=$(git -C "$ROOT" rev-parse HEAD:scripts/lib/mobile-e2e.sh | cut -c1-12) \
LIB_DIRTY=$(git -C "$ROOT" status --porcelain -- scripts/lib/mobile-e2e.sh | wc -l | tr -d ' ') \
SERIAL=$E2E_SERIAL"
echo "APK_SHA_ON_DEVICE=adb shell sha256sum -> $($ADB shell sha256sum \
  /data/app/*com.heyta*/base.apk 2>/dev/null | head -1 | cut -d' ' -f1)"

# `fresh` 臂：冷启动 + 过首屏两道闸，再从「我的」页把整条导航走一遍 ——
# 这一臂证的才是设备腿每次真正走的那条路（前两臂是在会话中途的界面上起跑的）。
if [ "$ARM" = "fresh" ]; then
  $ADB shell am force-stop $PKG
  launch_app; sleep 4
  handle_privacy_consent
  dismiss_welcome_if_present
fi

configure_sync_credentials
echo "RESULT arm=$ARM pass=$PASS fail=$FAIL needle_after=$(has_text "登录 heyta，让任务在设备间自动同步。")"

# 收尾：把表单退回官方同步那一代，设备上不留假凭据；再把软键盘恢复回去。
dump
if [ "$(has_text "返回 heyta 官方同步")" != "1" ]; then
  $ADB shell input tap 945 2253; sleep 3
  XY=$(xy_rid "profile-entry-settings"); [ -n "$XY" ] && { $ADB shell input tap $XY; sleep 3; }
  XY=$(xy_text "同步与隐私"); [ -n "$XY" ] && { $ADB shell input tap $XY; sleep 2; }
  dump
fi
XY=$(xy_text "返回 heyta 官方同步"); [ -n "$XY" ] && { $ADB shell input tap $XY; sleep 2; }
$ADB shell input keyevent 4; sleep 1
restore_ime
echo "CLEANUP_DONE"
