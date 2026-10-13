#!/usr/bin/env bash
# 在本基线上重跑本线 e2e 那一腿，并**打印驱动的真实出处**（上一趟是 npx 沿目录兜到 ~/node_modules 的）。
# 只在隔离副本 .worktrees/inb-t8 里跑。
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
export NO_COLOR=1
FORCE_COLOR=
LOG=.run-logs/e2e-inbound-newhead.log
: > "$LOG"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }

say "CARRIER_HEAD=$(git rev-parse HEAD)"
say "被跟踪 diff 行数=$(git diff --name-only HEAD | wc -l | tr -d ' ')（要求 0）"

PW=""
for cand in "$ROOT/e2e/node_modules/.bin/playwright" \
            "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/e2e/node_modules/.bin/playwright"; do
  if [ -x "$cand" ]; then PW="$cand"; break; fi
done
if [ -z "$PW" ]; then
  say "PLAYWRIGHT_MISSING 找过：$ROOT/e2e/node_modules/.bin/playwright 与主检出 e2e 那枚 ⇒ 不退化成 npx"
  exit 127
fi
say "驱动逐字路径=$PW"
( cd e2e && "$PW" --version ) > .run-logs/e2e-pw-version.out 2>&1
say "驱动版本=$(cat .run-logs/e2e-pw-version.out)"
say "本仓 e2e 锁定的版本=$(grep -aE '^  playwright@' e2e/pnpm-lock.yaml | head -1)"

say "==== inbound e2e $(date +%H:%M:%S)"
( cd e2e && timeout 1500 "$PW" test -c playwright.inbound.config.ts ) > .run-logs/e2e-inbound-newhead.out 2>&1
say "RC=$?"
grep -aE '^\s*(✓|✘|✗)|passed|failed' .run-logs/e2e-inbound-newhead.out | tail -12 | sed 's/^/  /' | tee -a "$LOG"
say "DONE $(date +%H:%M:%S)"
