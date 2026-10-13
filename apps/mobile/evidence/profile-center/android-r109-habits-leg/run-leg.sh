#!/usr/bin/env bash
# habits 设备腿的一次可复现现场。
#
# 为什么要单独留这枚脚本：这一腿是 `open_settings_section` / `close_settings_sheet`
# 那三个共享导航助手（`scripts/lib/mobile-e2e.sh`）第一次在**完整腿**上被走一遍，
# 读数必须能被人原样重放，而不是一句"我跑过"。
#
# 三条前置都是现量撞出来的，缺一条就跑不到第二步（正文见 RESULT.md）：
#   · 服务端连的库必须是当前 schema —— `scripts/mobile-e2e-up.sh` 的默认库
#     `heyta_mobile_smoke` 现量缺 27 张表（含 `access_sessions`），会在建号那一步红，
#     而它的 fail 文案指向 TEST_MODE（§7 #435）。这里用的是私有库 heyta_ux_r109。
#   · APK 必须由当前源码重打 —— 主检出那枚 Oct-12 的包里还没有 `settings-section-*`
#     锚点（strings 命中 0），拿它跑出来的红是包旧不是产品。
#   · 端口走私有 3111 —— 3000 上有另一会话的服务常驻，而且它连的就是那枚过期默认库。
set -uo pipefail

REPO="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
RUN="${HEYTA_R109_RUN:-$HOME/heyta-r109-leg}"
mkdir -p "$RUN"

PORT=3111 \
HEYTA_E2E_DB=heyta_ux_r109 \
HEYTA_E2E_PIDFILE="$RUN/server.pid" \
HEYTA_E2E_LOGFILE="$RUN/server.log" \
HEYTA_E2E_TOKEN_FILE="$RUN/token.txt" \
HEYTA_E2E_EMAIL_FILE="$RUN/email.txt" \
HEYTA_E2E_E2EE_FILE="$RUN/e2ee.txt" \
  bash "$REPO/scripts/mobile-e2e-up.sh" 2>&1 | tee "$RUN/up.txt"

cd "$REPO" || exit 1
PORT=3111 \
HEYTA_E2E_DB=heyta_ux_r109 \
HEYTA_E2E_TOKEN_FILE="$RUN/token.txt" \
HEYTA_E2E_EMAIL_FILE="$RUN/email.txt" \
HEYTA_E2E_E2EE_FILE="$RUN/e2ee.txt" \
HEYTA_E2E_UI_XML="$RUN/ui.xml" \
HEYTA_E2E_XY_PY="$RUN/_xy.py" \
  bash scripts/verify-mobile-habits.sh 2>&1 | tee "$RUN/leg.txt"
LEG_RC=${PIPESTATUS[0]}
echo "LEG_RC=$LEG_RC" | tee -a "$RUN/leg.txt"

# 栈是自己起的就自己停（按 PIDFILE 里那一枚 pid，绝不按名字 kill）。
if [ -f "$RUN/server.pid" ]; then
  HEYTA_E2E_PIDFILE="$RUN/server.pid" HEYTA_E2E_DB=heyta_ux_r109 PORT=3111 \
    bash "$REPO/scripts/mobile-e2e-down.sh" 2>&1 | tee "$RUN/down.txt"
fi
exit "$LEG_RC"
