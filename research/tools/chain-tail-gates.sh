#!/usr/bin/env bash
# `pnpm check` 链尾那 17 段里，**不需要浏览器、不需要全量测试**的那 14 段逐段取 rc。
#
# 为什么单独取：链在第 78 段（`check:ai-e2e`）红掉就停了，79 之后一律没有 rc。
# 「整条链 rc」与「每段都有 rc」是两件事 —— 目标要的是后者里能拿的那部分。
#
# 🔴 三道自闸（故意做成"默认跑不了"）：
#   1. `/tmp/tfa-test.lock` 在 = 别的会话正在跑测试 ⇒ 直接 rc=3 退出。
#      这些门禁**本身**很轻，但 `pnpm <gate>` 会起 node/子进程；在别人的窗口里加这 14 次
#      就是给别人造底噪（本台账里已经有一条间歇红是这么来的）。
#   2. `load1 > 12` 同样拒跑（阈值与链自己那条一致）。
#   3. 逐段之间睡 2s，避免连发把 CPU 顶成一个尖峰。
# 逃生门 `HEYTA_TAIL_FORCE=1` 只把闸门 1/2 的检查改成**打印**，不改判定，
# 且必须在读数里留下"这一趟是强开的"那一行 —— 它不是"绕过"，是"带着痕迹地走"。
#
# 用法（仓库根）：bash research/tools/chain-tail-gates.sh
# ⚠️ 读数落在 `tmp/tfa-readings/`（被 .gitignore 忽略，重启即清）⇒ 逐段 rc 必须抄进台账，
#    这里只是生成器；本脚本自身住在 `research/tools/`（一次性脚本的指定落点），别放回 tmp/。
set -u
# 🔴 仓库根**按标记上溯**取，不写死层数：本脚本被人拷到别处做自检时，固定层数会把 R 算成
#    拷贝所在的中间目录，于是 LOG/LOCK 这些相对路径全部搬家 —— 实测后果是"假锁根本没被看见，
#    14 段门禁真跑了"（10-06 07:23 我自己踩的）。
R="$(cd "$(dirname "$0")" && pwd)"
while [ ! -f "$R/pnpm-workspace.yaml" ] && [ "$R" != "/" ]; do R="$(dirname "$R")"; done
[ -f "$R/pnpm-workspace.yaml" ] || { echo "TAIL=ENV-INVALID reason=没上溯到仓库根（缺 pnpm-workspace.yaml）—— 一段都没跑"; exit 3; }
cd "$R" || exit 1
LOG="tmp/tfa-readings/chain-tail-${TAIL_TAG:-static14}.log"
# 🔴 目录不存在时 `: > $LOG` 只是**这一条**命令失败（没有 set -e），脚本会继续往下跑，
#    于是后面每一行 `rec` 都静默丢弃 ⇒ 跑完了、14 段都执行了、日志却是空的。
#    缺目录先建；建完还写不动就响亮退出，不让人把"没记上"读成"没跑"。
mkdir -p "$(dirname "$LOG")" 2>/dev/null
: > "$LOG" || { echo "TAIL=ENV-INVALID reason=日志写不动（${LOG}）—— 一段都没记，别当读数"; exit 3; }
[ -w "$LOG" ] || { echo "TAIL=ENV-INVALID reason=日志不可写（${LOG}）"; exit 3; }
LOCK=/tmp/tfa-test.lock
LOAD_LIMIT=12
say() { printf '%s\n' "$*"; }
rec() { printf '%s\n' "$*" >> "$LOG"; }

load1() { sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1}'; }

STEPS="check:shell-unicode
check:shell-exit-chain
check:selfhost-entry-command
check:web-storage
check:web-migration
check:web-artifact
check:script-snapshot
check:ios-ax-shim
check:verify-script-copy
check:android-gradle-remote
check:apk-freshness
check:shell-erasure-parity
check:mobile-first-run-gate
screenshot:verify"

# 旋钮：同一套自闸（锁 + 负载 + 逐段 rc）也可以服务别的段集合。
# 链尾还剩 79/80 两段 Playwright，它们缺的是**窗口**而不是装置，所以复用这里而不是再写一个跑手。
# 只认**单个词**的段名（`-r test` 那种两段词的不在这里，那条直接走 with-test-lock.sh）。
if [ -n "${TAIL_STEPS_OVERRIDE:-}" ]; then
  STEPS="$TAIL_STEPS_OVERRIDE"
fi

if [ "${HEYTA_TAIL_FORCE:-0}" = 1 ]; then
  rec "FORCE=1 ⇒ 自闸 1/2 只打印不判红（这一趟是强开的）"
else
  if [ -f "$LOCK" ]; then
    H=$(tr -d '[:space:]' < "$LOCK")
    say "TAIL=NOT_RUN reason=锁被持有 pid=${H} who=$(ps -p "$H" -o command= 2>/dev/null | cut -c1-120)"
    say "  —— 这是**没跑成**，不是 14 段全过。等窗口空了重跑本脚本。"
    exit 3
  fi
  L=$(load1)
  if awk -v a="$L" -v b="$LOAD_LIMIT" 'BEGIN{exit !(a>b)}'; then
    say "TAIL=NOT_RUN reason=load1=${L} 超过阈值 ${LOAD_LIMIT}（**没跑成**，不是判据红）"
    exit 3
  fi
fi

rec "START=$(date '+%m-%d %H:%M:%S') load1=$(load1) lock=$([ -f "$LOCK" ] && echo held || echo free)"
# 🔴 DRY 是给**自检**用的：它照样走完循环、照样落日志，只是不调 `pnpm`。
#    没有这一档，"证明闸门过了会往下走"那一臂就只能真的把 14 段门禁跑一遍 ——
#    10-06 07:23 我正是这样误跑了（假锁路径没被看见，因为拷贝把 R 搬走了）。
if [ "${HEYTA_TAIL_DRY:-0}" = 1 ]; then
  rec "DRY=1 ⇒ 走循环但不调 pnpm"
fi
n=0
for s in $STEPS; do
  n=$((n + 1))
  if [ "${HEYTA_TAIL_DRY:-0}" = 1 ]; then
    rec "STEP[$n] $s RC=DRY"
    continue
  fi
  NO_COLOR=1 pnpm "$s" >> "$LOG" 2>&1
  rc=$?
  rec "STEP[$n] $s RC=$rc"
  sleep 2
done
rec "STEPS_RUN=$n"
say "TAIL=DONE steps=$n 明细见 $LOG"
grep '^STEP\[' "$LOG"
