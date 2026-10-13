#!/usr/bin/env bash
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/.worktrees/inb-t8" || exit 9
set -u
echo "CARRIER_HEAD=$(git rev-parse HEAD)"
echo "REINSTALL_BLOB=$(git rev-parse HEAD:scripts/reinstall-all.sh)"
. ./scripts/lib/wait-for-quiet-host.sh
wait_for_quiet_host; GR=$?
echo "GATE_RC=$GR"
if [ "$GR" -ne 0 ]; then echo "REINSTALL=SKIPPED-BY-GATE"; echo "REINSTALL_RC=$GR"; exit "$GR"; fi
IOS_DEVICE_NAME=heyta-iphone-17pro bash scripts/reinstall-all.sh; RC=$?
echo "REINSTALL_RC=$RC"
echo "CARRIER_HEAD_AT_END=$(git rev-parse HEAD)"
git status --porcelain | head -20
