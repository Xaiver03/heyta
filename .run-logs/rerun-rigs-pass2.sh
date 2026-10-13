#!/bin/bash
cd "$(dirname "$0")/.." || exit 9
L=.run-logs/rigs-pass2.log; : > "$L"
say(){ echo "$@" | tee -a "$L"; }
say "CARRIER_HEAD=$(git rev-parse HEAD)"
say "LOAD_BEFORE=$(sysctl -n vm.loadavg)"
ESBUILD=node_modules/.pnpm/esbuild@0.27.7/node_modules/esbuild/bin/esbuild
say "ESBUILD=$($ESBUILD --version 2>/dev/null)"
$ESBUILD research/tools/verify-inbound-plan-audit.ts --bundle --platform=node --format=cjs --outfile=.run-logs/plan-audit.cjs --log-level=error >> "$L" 2>&1
say "ESBUILD_RC=$?"
for TZNAME in Asia/Shanghai America/New_York; do
  timeout 300 env TZ=$TZNAME node .run-logs/plan-audit.cjs > "$L.pa-$TZNAME.out" 2>&1
  say "plan-audit[$TZNAME] RC=$?  TAIL=$(tail -1 "$L.pa-$TZNAME.out")"
done
timeout 3600 python3 research/tools/verify-inbound-worker-identity.py --log "$HOME/.cache/heyta-inbound-rigs/worker-identity-1012.log" > "$L.wi.out" 2>&1
say "worker-identity RC=$?  SELF=$(grep -oE '[0-9]+/[0-9]+' "$L.wi.out" | tail -1)"
tail -6 "$L.wi.out" | sed 's/^/  /' >> "$L"
timeout 5400 python3 research/tools/verify-inbound-dual-host.py --log "$HOME/.cache/heyta-inbound-rigs/dual-host-1012.log" > "$L.dh.out" 2>&1
say "dual-host RC=$?  SELF=$(grep -oE 'Windows: [0-9]+/[0-9]+' "$L.dh.out" | tail -1)"
tail -8 "$L.dh.out" | sed 's/^/  /' >> "$L"
say "LOAD_AFTER=$(sysctl -n vm.loadavg)"
say "PASS2_DONE"
