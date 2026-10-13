#!/usr/bin/env bash
# 隔离副本：升到当前 main → 重建产物（防载体伪红）→ 三枚变异牙臂 → check-chain 的本线那几道（带 --logs）
set -u
cd "$(dirname "$0")/.."
export NO_COLOR=1
ROOT="$PWD"
LOG=.run-logs/carrier-teeth.log
: > "$LOG"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }

say "== 切基线前的跟踪状态自检（必须为空）"
DIRTY=$(git status --porcelain --untracked-files=no)
say "dirty=[${DIRTY}]"
if [ -n "$DIRTY" ]; then say "ABORT：载体上有未提交的跟踪改动，不动它"; exit 9; fi

TARGET=$(git rev-parse main)
say "载体旧 HEAD=$(git rev-parse HEAD)"
say "目标 main=$TARGET"
git checkout --detach "$TARGET" >>"$LOG" 2>&1
say "切后 HEAD=$(git rev-parse HEAD)  跟踪脏度=[$(git status --porcelain --untracked-files=no)]"

say ""
say "== 重建前：逐包 src 比 dist 新的文件数"
for p in packages/i18n packages/ui packages/design-system packages/app-host packages/domain packages/shared-schema packages/inbound-core; do
  [ -d "$p/dist" ] && say "  $p: $(find "$p/src" -type f -newer "$p/dist" 2>/dev/null | wc -l | tr -d ' ')"
done
say "==== build $(date +%H:%M:%S)  pnpm -r build"
timeout 2400 pnpm -r build > .run-logs/ct-build.out 2>&1
say "RC_BUILD=$?"
say "== 重建后：同样的计数（必须全 0 才继续）"
STALE=0
for p in packages/i18n packages/ui packages/design-system packages/app-host packages/domain packages/shared-schema packages/inbound-core; do
  if [ -d "$p/dist" ]; then n=$(find "$p/src" -type f -newer "$p/dist" 2>/dev/null | wc -l | tr -d ' '); say "  $p: $n"; [ "$n" != "0" ] && STALE=1; fi
done
if [ "$STALE" != "0" ]; then say "ABORT：产物仍落后，不量"; exit 9; fi

say ""
for rig in queue quota ticket; do
  say "==== teeth-$rig $(date +%H:%M:%S)"
  timeout 1500 python3 "research/tools/verify-inbound-${rig}-teeth.py" > ".run-logs/ct-teeth-${rig}.out" 2>&1
  say "RC=$?"
  grep -a -E '臂|成立|PASS|FAIL|变异|还原|rc=' ".run-logs/ct-teeth-${rig}.out" | tail -10 | sed 's/^/  /' | tee -a "$LOG"
  say ""
done

say "==== check-chain（只跑命令里含 inbound 的那些道） $(date +%H:%M:%S)"
timeout 2400 python3 research/tools/verify-inbound-check-chain.py --repo "$ROOT" --logs "$ROOT/.run-logs/chain-inbound" --only inbound > .run-logs/ct-chain-inbound.out 2>&1
say "RC_CHAIN=$?"
grep -a -E '^CHAIN |^STEP=|REDS|reds' .run-logs/ct-chain-inbound.out | tail -20 | sed 's/^/  /' | tee -a "$LOG"
say ""

say "==== 载体上的 AC8 与 cjs 两腿（重建后再取一次，确认不是产物问题） $(date +%H:%M:%S)"
timeout 900 python3 research/tools/verify-inbound-ac8-matrix.py --quiet > .run-logs/ct-ac8.out 2>&1; say "AC8_RC=$?"
timeout 900 python3 research/tools/verify-inbound-cjs-require-order.py > .run-logs/ct-cjs.out 2>&1; say "CJS_RC=$?"
say "ALL_DONE $(date +%H:%M:%S)"
