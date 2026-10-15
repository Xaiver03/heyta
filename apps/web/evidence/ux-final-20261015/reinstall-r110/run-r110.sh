#!/usr/bin/env bash
# 第六趟四端重装（r110）：在**只含已提交内容**的隔离载体上，从当前 HEAD 重打并四端重装。
#
# 为什么这一趟非跑不可（判据是上一格写下的那条尺，不是"再跑一遍看着安心"）：
#   git diff --name-only 769e6258..HEAD -- apps/web/src apps/mobile/src packages server/src \
#     apps/desktop-macos apps/desktop-windows scripts/reinstall-all.sh pnpm-lock.yaml | wc -l
#   ⇒ 现量 1，那一枚是 `apps/mobile/src/screens/SettingsScreen.tsx`（`808c1344`，会进包的产品源码）。
#
# 两件事分开看：
#   ① 载体是 `dirty=0` 的隔离 worktree ⇒ 这一趟的读数**证**"干净检出可复现"（主检出的读数不证这件事）；
#   ② 落点是私有目录（`HEYTA_REINSTALL_TMP_DIR`）⇒ 不碰 `/tmp` 上别人的现场，
#      也不碰 `research/tools/b-window-keeper.sh` 那棵默认 CARRIER。
set -uo pipefail
CARRIER="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-r110"
RT="$HOME/heyta-r110-reinstall"
mkdir -p "$RT"
cd "$CARRIER" || exit 1

{
  echo "=== 出处（跑之前）==="
  date -u '+%Y-%m-%dT%H:%M:%SZ'
  echo "carrier=$(pwd)"
  echo "HEAD=$(git rev-parse HEAD)"
  echo "dirty=$(git status --porcelain | wc -l | tr -d ' ')"
  echo "load1=$(sysctl -n vm.loadavg)"
  echo "落点=$RT"
} > "$RT/provenance.txt" 2>&1
cat "$RT/provenance.txt"

echo "==== 步骤 1：pnpm install --frozen-lockfile（干净检出，不借主检出的 node_modules）===="
NO_COLOR=1 pnpm install --frozen-lockfile > "$RT/install.txt" 2>&1
INSTALL_RC=$?
echo "INSTALL_RC=$INSTALL_RC" | tee -a "$RT/install.txt"
[ "$INSTALL_RC" -eq 0 ] || { tail -30 "$RT/install.txt"; exit "$INSTALL_RC"; }

echo "==== 步骤 2：reinstall-all（mac → windows → android → ios）===="
NO_COLOR=1 HEYTA_REINSTALL_TMP_DIR="$RT" IOS_DEVICE_NAME=heyta-iphone-17pro \
  bash scripts/reinstall-all.sh > "$RT/reinstall.txt" 2>&1
RC=$?
echo "REINSTALL_RC=$RC" | tee -a "$RT/reinstall.txt"
{
  echo "=== 出处（跑之后）==="
  date -u '+%Y-%m-%dT%H:%M:%SZ'
  echo "REINSTALL_RC=$RC"
} >> "$RT/provenance.txt" 2>&1
tail -60 "$RT/reinstall.txt"
exit "$RC"
