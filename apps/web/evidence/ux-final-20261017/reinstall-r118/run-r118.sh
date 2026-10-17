#!/bin/bash
# 第七趟四端重装（r118）的实际跑法，一条命令可复跑
C="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-r111"
RT="$HOME/heyta-r118-reinstall"
git -C "$C" checkout --detach 25f544bd
mkdir -p "$RT"
cd "$C" && NO_COLOR=1 HEYTA_REINSTALL_TMP_DIR="$RT" IOS_DEVICE_NAME=heyta-iphone-17pro \
  bash scripts/reinstall-all.sh > "$RT/reinstall.txt" 2>&1
echo "REINSTALL_RC=$?"
