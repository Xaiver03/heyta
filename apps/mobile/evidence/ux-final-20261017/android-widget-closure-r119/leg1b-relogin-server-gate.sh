#!/bin/bash
#
# r119 第 1b 腿：**重填凭据**，并把"到底登录成没成"的判据从界面回读换成**服务端有没有收到东西**。
# =============================================================================
# 为什么要有这一腿：`leg1` 里 `configure_sync_credentials` 报了
#   ❌ 访问令牌 没填进去 / ❌ 这些字段丢了： 访问令牌 / ✅ 界面认为已配置
# 两行同时出现 —— 前者是真红（令牌那格是明文可读的，`has_text "$TOKEN"` 读得到就是读得到），
# 后者是 lib 那枚"界面认为已配置"的**假绿**：它判的是表单态，不是"有没有真的同步上"。
# 现量的服务端：`select count(*) from operations` = 0、`sync_devices` = 0 ⇒ 这台设备一个字都没推上去。
# ⇒ 未登录的态**不能**用来跑注销腿（那条路要先有一个真的会话）。
#
# 🔴 这一腿的收口判据只看服务端：`operations` 行数从 0 变成 >0。
#    界面回读只当辅助证据，不再当闸门。
set -u
export PATH="/opt/homebrew/bin:$PATH"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE"
while [ "$ROOT" != "/" ] && [ ! -e "$ROOT/.git" ]; do ROOT="$(dirname "$ROOT")"; done
[ -e "$ROOT/.git" ] || { echo "❌ 退到 / 也没找到仓库根"; exit 3; }

export PORT=4520
export HEYTA_E2E_DB=heyta_uxr119
export HEYTA_E2E_TOKEN_FILE=/Users/rocalight/heyta-r119-leg/token.txt
export HEYTA_E2E_EMAIL_FILE=/Users/rocalight/heyta-r119-leg/email.txt
export HEYTA_E2E_E2EE_FILE=/Users/rocalight/heyta-r119-leg/e2ee.txt
export HEYTA_E2E_UI_XML=/Users/rocalight/heyta-r119-leg/ui.xml
export HEYTA_E2E_XY_PY=/Users/rocalight/heyta-r119-leg/xy.py

. "$ROOT/scripts/lib/mobile-e2e.sh"

srv() { /opt/homebrew/bin/psql -d "$HEYTA_E2E_DB" -At -c "$1" 2>&1 | head -1; }

step "0. 起点：服务端收到多少东西"
echo "     operations=$(srv 'select count(*) from operations')  sync_devices=$(srv 'select count(*) from sync_devices')"

step "1. 走到「设置 → 同步与隐私」并重填三枚凭据"
launch_app
sleep 4
close_settings_sheet
if ! tap_tab "我的" "rid:profile-entry-settings"; then
  echo "❌ 切不到「我的」"; exit 1
fi
if ! configure_sync_credentials; then
  echo "     （lib 报了丢字段 —— 继续，判据在下一步的服务端上）"
fi

step "2. 服务端判据：等 operations 从 0 涨起来（最多 12 轮 × 5s）"
SEEN=0
for i in $(seq 1 12); do
  sleep 5
  N=$(srv 'select count(*) from operations')
  echo "     第 ${i} 轮：operations=$N"
  case "$N" in ''|*[!0-9]*) ;; 0) ;; *) SEEN="$N"; break ;; esac
done
if [ "$SEEN" = "0" ]; then
  echo "   ❌ 60 秒内服务端一枚 op 都没收到 ⇒ 这台设备**没有真的登录上**。"
  echo "   界面上现在有什么：$(python3 "$XY_PY" text 2>/dev/null | head -12 | tr '\n' '|')"
  exit 1
fi
ok "服务端收到 $SEEN 枚 op ⇒ 会话是真的"
echo "     sync_devices=$(srv 'select count(*) from sync_devices')"
echo "PASS=$PASS FAIL=$FAIL"
