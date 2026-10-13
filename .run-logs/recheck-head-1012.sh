#!/usr/bin/env bash
# 在**当前 HEAD** 上重取"第 105 道点名的红包 + apps/web + 本线 e2e"的读数，再补全量 `-r test`（--no-bail）
# 与那条非测试层的红门（check:reachability）。
# 与 recheck-105-set.sh 的唯一差别：二进制**逐字指定**，不走 npx（af190b92 / 44749ddd 两笔的教训）。
# 只在隔离副本 .worktrees/inb-t8 里跑；不改任何被跟踪文件。
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
export NO_COLOR=1
LOG=.run-logs/recheck-head-1012.log
: > "$LOG"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }

# 逐字解析某目录（或仓根）下的本地二进制；找不到就响亮返回 127，绝不退化成 npx
bindir() {  # $1=工具名 $2=包目录
  for cand in "$2/node_modules/.bin/$1" "$ROOT/node_modules/.bin/$1"; do
    if [ -f "$cand" ] && [ -x "$cand" ]; then printf '%s' "$cand"; return 0; fi
  done
  return 1
}

run() {
  local name="$1" tmo="$2" dir="$3" bin="$4"; shift 4
  say "==== $name $(date +%H:%M:%S)"
  if ! command -v "$bin" >/dev/null 2>&1 && [ ! -x "$bin" ]; then
    say "BIN_MISSING $bin"; say "RC=127"; say ""; return
  fi
  say "BIN=$bin"
  say "CMD: (cd $dir && timeout $tmo $bin $*)"
  ( cd "$dir" && timeout "$tmo" "$bin" "$@" ) > ".run-logs/rh-$name.out" 2>&1
  local rc=$?
  say "RC=$rc"
  grep -E '^(Test Files|Tests|Duration)' ".run-logs/rh-$name.out" | tail -3 | sed 's/^/  /' | tee -a "$LOG"
  say "  FAIL 行数=$(grep -c '^  FAIL ' ".run-logs/rh-$name.out")"
  say ""
}

say "CARRIER_HEAD=$(git rev-parse HEAD)"
say "被跟踪 diff 行数=$(git diff --name-only HEAD | wc -l | tr -d ' ')（要求 0）"
say "未跟踪条目=$(git status --porcelain | grep -c '^??')"
say "loadavg: $(sysctl -n vm.loadavg)"

VT_S=$(bindir vitest "$ROOT/packages/ai")        || VT_S=""
run ai 900 packages/ai "${VT_S:-MISSING}" run --maxWorkers=1
run legal 600 packages/legal "$(bindir vitest "$ROOT/packages/legal" || echo MISSING)" run --maxWorkers=1
run shared-schema 600 packages/shared-schema "$(bindir vitest "$ROOT/packages/shared-schema" || echo MISSING)" run --maxWorkers=1
say "apps/web 起跑前 loadavg: $(sysctl -n vm.loadavg)"
run web 2400 apps/web "$(bindir vitest "$ROOT/apps/web" || echo MISSING)" run --maxWorkers=1
PW=$(bindir playwright "$ROOT/e2e") || PW=""
say "e2e 起跑前 loadavg: $(sysctl -n vm.loadavg)"
run e2e-inbound 1500 e2e "${PW:-MISSING}" test -c playwright.inbound.config.ts

say "==== full_r_test $(date +%H:%M:%S)  （pnpm -r --no-bail test：取全红集，不只第一个失败）"
say "loadavg: $(sysctl -n vm.loadavg)"
timeout 5400 pnpm -r --no-bail test > .run-logs/rh-full-rtest.out 2>&1
say "RC=$?"
grep -E '^(Test Files|Tests)' .run-logs/rh-full-rtest.out | sed 's/^/  /' | tail -40 | tee -a "$LOG"
say "  失败包标记数=$(grep -c 'Failed' .run-logs/rh-full-rtest.out)"
say ""

say "==== reachability $(date +%H:%M:%S)  （非测试层的那条红门）"
timeout 900 pnpm check:reachability > .run-logs/rh-reachability.out 2>&1
say "RC=$?"
tail -12 .run-logs/rh-reachability.out | sed 's/^/  /' | tee -a "$LOG"
say ""
say "ALL_DONE $(date +%H:%M:%S)"
