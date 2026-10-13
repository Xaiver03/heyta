#!/bin/bash
# T8 复账：在当前 HEAD 的隔离副本上逐枚复跑本线装置 + 四道静态门。
# 一条一条串行跑；每枚的退出码紧跟其命令之后 echo（AGENTS §7：管道尾巴会吞 rc）。
# 不跑 verify-inbound-check-chain.py —— 那是整条 106 步链，读数已在「第 105 道」那节记过，
# 且它会在本趟里把 e2e 那一道的 3000s 上限再撞一次；要在链上取新读数请单独起一趟。
cd "$(dirname "$0")/.." || exit 9
LOG=.run-logs/rigs.log
: > "$LOG"
say() { echo "$@" | tee -a "$LOG"; }

say "CARRIER=$(pwd)"
say "CARRIER_HEAD=$(git rev-parse HEAD)"
say "REINSTALL_DONE_MARKER=$(grep -c '^REINSTALL_RC=' .run-logs/reinstall.log 2>/dev/null)"
say "LOAD_BEFORE=$(sysctl -n vm.loadavg)"

run() { # run <名字> <超时秒> <命令...>
  local name="$1"; shift
  local tmo="$1"; shift
  say "─── $name"
  say "CMD: $*"
  timeout "$tmo" "$@" >> "$LOG.$name.out" 2>&1
  local rc=$?
  say "RC=$rc"
  say "SELF=$(grep -oE '(Windows: [0-9]+/[0-9]+|[0-9]+/[0-9]+|OK=[0-9]+ BAD=[0-9]+|全部 [0-9]+ 臂|PASS|FAIL)' "$LOG.$name.out" | tail -3 | tr '\n' ' ')"
  say "TAIL: $(tail -2 "$LOG.$name.out" | tr '\n' ' | ')"
  return 0
}

# 1) 纯静态、秒级
run ac-ticks        120 python3 research/tools/verify-inbound-ac-ticks.py
run ac-ticks-self   120 python3 research/tools/verify-inbound-ac-ticks.py --self-test
run doc-tables      120 python3 research/tools/verify-inbound-doc-tables.py
run doc-tables-self 120 python3 research/tools/verify-inbound-doc-tables.py --self-test
run commit-scope    300 python3 research/tools/verify-inbound-commit-scope.py
run cjs-order      1200 python3 research/tools/verify-inbound-cjs-require-order.py
run cjs-order-self 1200 python3 research/tools/verify-inbound-cjs-require-order.py --self-test

# 2) 牙齿类（自带反向验证）
run queue-teeth      900 python3 research/tools/verify-inbound-queue-teeth.py
run queue-self-test  900 python3 research/tools/verify-inbound-queue-teeth.py --self-test
run quota-teeth     1800 python3 research/tools/verify-inbound-quota-teeth.py
run quota-self-test 1800 python3 research/tools/verify-inbound-quota-teeth.py --self-test
run ticket-teeth    1800 python3 research/tools/verify-inbound-ticket-teeth.py
run ticket-self-test 1800 python3 research/tools/verify-inbound-ticket-teeth.py --self-test

# 3) 切片类（要 packages/*/dist）
run producer-seam     1800 python3 research/tools/verify-inbound-producer-seam.py
run producer-self     1800 python3 research/tools/verify-inbound-producer-seam.py --self-test
run api-slice         1800 python3 research/tools/verify-inbound-api-slice.py
run api-slice-self    1800 python3 research/tools/verify-inbound-api-slice.py --self-test
run host-options      1800 python3 research/tools/verify-inbound-host-options-slice.py
run host-options-self 1800 python3 research/tools/verify-inbound-host-options-slice.py --self-test

# 4) 真库 / 真宿主
run worker-identity 3600 python3 research/tools/verify-inbound-worker-identity.py --log ~/.cache/heyta-inbound-rigs/worker-identity-1012.log
run dual-host       5400 python3 research/tools/verify-inbound-dual-host.py --log ~/.cache/heyta-inbound-rigs/dual-host-1012.log
run dual-host-self  1200 python3 research/tools/verify-inbound-dual-host.py --self-test

# 5) 反例件（esbuild 打成人能跑的 cjs，两个时区各跑一次）
pnpm exec esbuild research/tools/verify-inbound-plan-audit.ts --bundle --platform=node --format=cjs \
  --outfile=.run-logs/plan-audit.cjs --log-level=error >> "$LOG" 2>&1
say "ESBUILD_RC=$?"
if [ -f .run-logs/plan-audit.cjs ]; then
  run plan-audit-sh   300 env TZ=Asia/Shanghai node .run-logs/plan-audit.cjs
  run plan-audit-ny   300 env TZ=America/New_York node .run-logs/plan-audit.cjs
fi

# 6) 完成条件里点名的静态门
run license-inventory 1800 node research/tools/license-inventory.mjs
run check-migrations   300 node scripts/check-migrations.mjs
run check-docs-voice   300 node scripts/check-docs-voice.mjs
run docs-link-check    600 node research/tools/docs-link-check.mjs

say "LOAD_AFTER=$(sysctl -n vm.loadavg)"
say "RIG_COUNT=$(grep -c '^RC=' "$LOG")"
say "RED_COUNT=$(grep -c '^RC=0' "$LOG" | awk '{print $1}')"
say "ALL_DONE"
