#!/usr/bin/env bash
# 在第 105 道点名的那三个红包 + apps/web + 本线 e2e 上，取当前 HEAD 的读数（串行，一次一条）
set -u
cd "$(dirname "$0")/.."
export NO_COLOR=1
LOG=.run-logs/recheck-105-set.log
: > "$LOG"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }

say "CARRIER_HEAD=$(git rev-parse HEAD)"
say "loadavg: $(sysctl -n vm.loadavg)"
say "vm_stat(前 5 行): $(vm_stat | head -5 | tr '\n' ' ')"

run() {
  local name="$1" tmo="$2" dir="$3"; shift 3
  say "==== $name $(date +%H:%M:%S)"
  say "CMD: (cd $dir && $*)"
  ( cd "$dir" && timeout "$tmo" "$@" ) > ".run-logs/recheck-$name.out" 2>&1
  local rc=$?
  say "RC=$rc"
  grep -E '^(Test Files|Tests|Duration) ' ".run-logs/recheck-$name.out" | tail -3 | sed 's/^/  /' | tee -a "$LOG"
  grep -c '^  FAIL ' ".run-logs/recheck-$name.out" | sed 's/^/  FAIL 行数=/' | tee -a "$LOG"
  say ""
}

run ai 900 packages/ai npx --no-install vitest run --maxWorkers=1
run legal 600 packages/legal npx --no-install vitest run --maxWorkers=1
run shared-schema 600 packages/shared-schema npx --no-install vitest run --maxWorkers=1
say "apps/web 起跑前 loadavg: $(sysctl -n vm.loadavg)"
run web 2400 apps/web npx --no-install vitest run --maxWorkers=1
say "e2e 起跑前 loadavg: $(sysctl -n vm.loadavg)"
run e2e-inbound 1500 e2e npx --no-install playwright test -c playwright.inbound.config.ts
say "ALL_DONE $(date +%H:%M:%S)"
