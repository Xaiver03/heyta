#!/bin/bash
#
# 装机态**登录腿**：把当前装在 emulator-5554 上的那枚包指到本机 TEST_MODE 栈上并登录。
# ==============================================================================
#
# 为什么单独一枚脚本：台账那一格（"清理数据后系统小组件不继续展示旧任务"）的前半句
# 需要**已登录态**才摸得到「退出登录」，而本线此前判"缺一个能真的登录的本地服务端"。
# 那一判已被现量否证：`scripts/mobile-e2e-up.sh` 一条命令就能起栈（端口/库/pidfile/
# logfile/凭据文件五枚旋钮都是现成的），应用内也有「使用自托管服务器」那一格。
#
# 🔴 复用 lib 的 `configure_sync_credentials` 而不是自己写一遍导航：
#    它带着三段实测过的落点推理（凭据表单在「设置 → 同步与隐私」组里、
#    表单要 `advancedSync` 为真才渲染、折叠线以下的节点整枚不在无障碍树里）。
#    自己重推一遍就是第 21 枚写死「我的」坐标那种重复劳动。
#
# 🔴 **不**装包、**不** `pm clear`：这一趟要的是"装机态"，
#    装的是别线 10-16 那一趟的产物（`lastUpdateTime` 现量在 `login.txt` 第一行）。
#
# 跑法（栈要先起来，见 RESULT.md 的「出处」那一节）：
#   bash login-leg.sh
set -u
export PATH="/opt/homebrew/bin:$PATH"

HERE="$(cd "$(dirname "$0")" && pwd)"
# 逐层往上找到**真正的仓库根**（认 `.git` 而不是数层数）：这枚脚本住在
# `apps/mobile/evidence/<趟号>/<包>/`，按层数写死改一次目录深度就会错，
# 而错的症状是"lib 找不到"——第一趟就是这么死的。
ROOT="$HERE"
while [ "$ROOT" != "/" ] && [ ! -e "$ROOT/.git" ]; do ROOT="$(dirname "$ROOT")"; done
[ -e "$ROOT/.git" ] || { echo "❌ 从 $HERE 退到 / 也没找到仓库根（.git）"; exit 3; }

# 本趟自己的落点 —— 一台共享机器上，默认名是跨树共享的（陷阱 #275 那一族）。
export PORT=4520
export HEYTA_E2E_DB=heyta_uxr117
export HEYTA_E2E_TOKEN_FILE=/tmp/heyta-r117-token.txt
export HEYTA_E2E_EMAIL_FILE=/tmp/heyta-r117-email.txt
export HEYTA_E2E_E2EE_FILE=/tmp/heyta-r117-e2ee.txt
export HEYTA_E2E_UI_XML=/tmp/heyta-r117-ui.xml
export HEYTA_E2E_XY_PY=/tmp/heyta-r117-xy.py

. "$ROOT/scripts/lib/mobile-e2e.sh"

echo "被测包：$(adb -s $E2E_SERIAL shell dumpsys package com.heyta 2>/dev/null \
  | grep -E 'versionName|lastUpdateTime' | tr -d ' \r' | paste -sd' ' -)"
echo "服务端：$HOST_SERVER   账号：$EMAIL"

if [ -n "$(another_mobile_e2e_running)" ]; then
  echo "❌ 有别的移动端验收在同一台模拟器上跑，本趟不起（会互相清对方的现场）："
  another_mobile_e2e_running
  exit 3
fi

step "1. 配凭据（服务器地址 / 访问令牌 / 端到端加密口令）"
# 🔴 先把应用拉到「我的」那一格，再交给 `configure_sync_credentials`。
#    那枚 helper 的第一行是按**写死的坐标**点「我的」（`945 2253`，本线在册的第 21 处，
#    待办 #65/#68 那一族），而它既不 `dismiss_welcome_if_present` 也不回读"切过去了没有"：
#    冷启动如果落在首屏同意层或任务页上，那一下就打在别处，随后
#    `open_settings_section` 在错的滚动流里滚 5 次，报出来是「找不到 profile-entry-settings」
#    —— 形状与"产品没有设置入口"完全一样（§7 元规则一：先怀疑探针）。
#    实测两趟： warm 续用能过（第 1 跑），force-stop 冷启必红（第 2 跑，`login2.txt`）。
launch_app
sleep 4
dismiss_welcome_if_present
close_settings_sheet
if ! tap_tab "我的" "rid:profile-entry-settings"; then
  echo "❌ 冷启动后切不到「我的」那一格（后面的凭据读数都不算）"
  exit 1
fi
if ! configure_sync_credentials; then
  echo "❌ 凭据没落到界面上"
  exit 1
fi

step "2. 回读：界面是否承认已配置 / 已登录"
launch_app
sleep 3
dump
for want in "已登录" "同步已开启" "返回 heyta 官方同步"; do
  if [ "$(has_text "$want")" = "1" ]; then ok "界面上有「${want}」"; fi
done
echo "     当前屏上的文字（前 14 条）：$(python3 "$XY_PY" text 2>/dev/null | head -14 | tr '\n' '|')"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
