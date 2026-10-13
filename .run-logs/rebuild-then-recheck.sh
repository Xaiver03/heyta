#!/usr/bin/env bash
# 判一件事：apps/web 与 apps/mobile 这两格在 7958c18c 上红，是**别线真回归**还是**我这副本的 dist 落后于新检出源码**。
# 做法：先在副本里 `pnpm -r build` 把共享层产物重打到当前基线，再逐字跑那两包的套件。
# 串行（一次一条），只在隔离副本 .worktrees/inb-t8 里跑；不改任何被跟踪文件。
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
export NO_COLOR=1
LOG=.run-logs/rebuild-then-recheck.log
: > "$LOG"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }

vt() {  # 逐字取某包的本地 vitest；找不到响亮返回非 0
  local d="$1"
  for cand in "$d/node_modules/.bin/vitest" "$ROOT/node_modules/.bin/vitest"; do
    [ -f "$cand" ] && [ -x "$cand" ] && { printf '%s' "$cand"; return 0; }
  done
  return 1
}

say "基线 HEAD=$(git rev-parse HEAD)"
say "重建前：源码比 dist 新的文件数（i18n+ui+design-system+app-host+domain）："
for p in packages/i18n packages/ui packages/design-system packages/app-host packages/domain; do
  [ -d "$p/dist" ] && say "  $p: $(find $p/src -newer $p/dist \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | wc -l | tr -d ' ') 枚比 dist 新"
done

say "==== build $(date +%H:%M:%S)  pnpm -r build"
timeout 2400 pnpm -r build > .run-logs/rb-build.out 2>&1
say "RC_BUILD=$?"
tail -4 .run-logs/rb-build.out | sed 's/^/  /' | tee -a "$LOG"

say "重建后：同样的比较（应当为 0，否则 build 没铺到那层）"
for p in packages/i18n packages/ui packages/design-system packages/app-host packages/domain; do
  [ -d "$p/dist" ] && say "  $p: $(find $p/src -newer $p/dist \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | wc -l | tr -d ' ') 枚比 dist 新"
done

for pkg in apps/web apps/mobile; do
  B=$(vt "$ROOT/$pkg") || B=""
  say "==== $pkg $(date +%H:%M:%S)  BIN=${B:-MISSING}"
  if [ -z "$B" ]; then say "RC=127"; say ""; continue; fi
  ( cd "$pkg" && timeout 2400 "$B" run --maxWorkers=1 ) > ".run-logs/rb-$(basename $pkg).out" 2>&1
  say "RC=$?"
  grep -aE '^\s*(Test Files|Tests)\s+' ".run-logs/rb-$(basename $pkg).out" | tail -2 | sed 's/^/  /' | tee -a "$LOG"
  say ""
done

say "ALL_DONE $(date +%H:%M:%S)"
