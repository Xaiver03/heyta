#!/usr/bin/env bash
# 本线判据复跑（"旧读数引用前必须复跑"）。逐组、逐枚报 pass/fail，不合并成一句"全绿"。
# 用法：bash /tmp/ht-rerun-judgments.sh
set -u
cd "$(dirname "$0")/../.." || exit 1   # 住在 research/tools/，仓库根 = ../..
export NO_COLOR=1
LOG=/tmp/ht-rerun.log
: > "$LOG"

run() { # <标签> <filter> <spec...>
  local label="$1"; shift
  local filter="$1"; shift
  echo "===== ${label} (${filter}) :: $*" >> "$LOG"
  local start; start=$(date +%s)
  pnpm --filter "$filter" exec vitest run "$@" >> "$LOG" 2>&1
  local rc=$?
  local dur=$(( $(date +%s) - start ))
  local pass; pass=$(grep -oE '[0-9]+ passed' "$LOG" | tail -1)
  local fail; fail=$(grep -oE '[0-9]+ failed' "$LOG" | tail -1)
  echo "RESULT ${label} rc=${rc} dur=${dur}s ${pass:-0 passed} ${fail:-no-failed}" >> "$LOG"
  echo "--- ${label} rc=${rc} ${dur}s ${pass:-} ${fail:-}"
}

run "ui"        @heyta/ui        tests/calendar-year-model.spec.ts tests/calendar-day-buckets.spec.ts
run "domain"    @heyta/domain    tests/date-year.spec.ts
run "app-host"  @heyta/app-host  tests/hosted-account-profile.spec.ts
run "web"       @heyta/web       tests/calendar-day-view.spec.tsx tests/calendar-drag-day.spec.tsx tests/calendar-view-tabs.spec.tsx tests/calendar-year-board.spec.tsx
run "mobile"    @heyta/mobile    tests/task-due-time.spec.ts tests/profile-nickname-entry.spec.ts tests/profile-avatar-entry.spec.ts tests/calendar-view-entry.spec.ts

echo "ALL DONE" >> "$LOG"
