#!/usr/bin/env bash
# 第七趟（r111，只跑 windows 那一端）：验的是 de7b5493 那笔取证量具改动 ——
# 装机图从"真实窗口的左上角裁切"变成"整个窗口"。
#
# 为什么这一趟非跑不可：那两枚 .ps1 改动**本机跑不了**（没有 pwsh，也没有 Windows），
# 而它挂在重装链的 windows 段上，是所有人下一张 windows 图的来源。
# "脚本改了"不等于"图修好了"，判据只有两条，都要从这趟的读数里取：
#   ① install-capture.txt 里出现 `WINDOW_DPI=120`（打包机 125% 缩放）与 `DPI_CTX=True`；
#   ② 那张 png 的宽 == `WINDOW_RECT` 报的宽，且**比值不再是 1.25**（旧图 1152 vs 真窗口 1440）。
#
# 载体是只含已提交内容的隔离 worktree（dirty=0），落点是私有目录，不碰 /tmp 上别人的现场。
set -uo pipefail
CARRIER="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-r111"
RT="$HOME/heyta-r111-reinstall"
mkdir -p "$RT"
cd "$CARRIER" || exit 1

{
  echo "=== 出处（跑之前）==="
  date -u '+%Y-%m-%dT%H:%M:%SZ'
  echo "carrier=$(pwd)"
  echo "HEAD=$(git rev-parse HEAD)"
  echo "dirty=$(git status --porcelain | wc -l | tr -d ' ')"
  echo "load1=$(sysctl -n vm.loadavg)"
  echo "落点=$RT   只跑：--only windows"
} > "$RT/provenance.txt" 2>&1
cat "$RT/provenance.txt"

echo "==== 步骤 1：pnpm install --frozen-lockfile ===="
NO_COLOR=1 pnpm install --frozen-lockfile > "$RT/install.txt" 2>&1
INSTALL_RC=$?
echo "INSTALL_RC=$INSTALL_RC" | tee -a "$RT/install.txt"
[ "$INSTALL_RC" -eq 0 ] || { tail -30 "$RT/install.txt"; exit "$INSTALL_RC"; }

echo "==== 步骤 2：reinstall-all --only windows ===="
NO_COLOR=1 HEYTA_REINSTALL_TMP_DIR="$RT" \
  bash scripts/reinstall-all.sh --only windows > "$RT/reinstall.txt" 2>&1
RC=$?
echo "REINSTALL_RC=$RC" | tee -a "$RT/reinstall.txt"
{
  echo "=== 出处（跑之后）==="
  date -u '+%Y-%m-%dT%H:%M:%SZ'
  echo "REINSTALL_RC=$RC"
} >> "$RT/provenance.txt" 2>&1
tail -60 "$RT/reinstall.txt"
exit "$RC"
