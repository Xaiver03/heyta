#!/usr/bin/env bash
# 隔离副本（产物已重建）上重取 T7 第二腿：pnpm -r --no-bail test 全量 + 覆盖审计
set -u
cd "$(dirname "$0")/.."
export NO_COLOR=1
LOG=.run-logs/rtest-fresh.log
: > "$LOG"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }

say "CARRIER_HEAD=$(git rev-parse HEAD)"
say "main=$(git rev-parse main)"
say "载体与 main 的差异（应只有台账两份文件）:"
git diff --name-only HEAD main | sed 's/^/  /' | tee -a "$LOG"
say "跟踪脏度=[$(git status --porcelain --untracked-files=no)]"
say "产物新旧自检:"
for p in packages/i18n packages/ui packages/design-system packages/app-host packages/domain packages/shared-schema packages/inbound-core; do
  [ -d "$p/dist" ] && say "  $p: $(find "$p/src" -type f -newer "$p/dist" 2>/dev/null | wc -l | tr -d ' ') 枚比 dist 新"
done
say ""
say "==== pnpm -r --no-bail test $(date +%H:%M:%S)"
timeout 3600 pnpm -r --no-bail test > .run-logs/rtest-fresh.out 2>&1
RC=$?
say "RC_RTEST=$RC"
say "==== 覆盖审计"
say "Scope 行: $(grep -a -m1 'Scope:' .run-logs/rtest-fresh.out)"
NPKGS=$(grep -ac 'Test Files' .run-logs/rtest-fresh.out)
say "打印了 Test Files 汇总的行数=$NPKGS"
say "失败的包:"
grep -a -E '^\s*(FAIL|✗|.*failed)' .run-logs/rtest-fresh.out | grep -a -E '^\s*[a-z@/.-]+.*(failed|Test Files)' | tail -30 | sed 's/^/  /' | tee -a "$LOG"
say "每包读数（包名 + Test Files + Tests）:"
grep -a -E '^(packages|apps|server|e2e)/[^ ]+ (test|):|^\s*(Test Files|Tests)\s' .run-logs/rtest-fresh.out | tail -80 | sed 's/^/  /' | tee -a "$LOG"
say "ALL_DONE $(date +%H:%M:%S)"
