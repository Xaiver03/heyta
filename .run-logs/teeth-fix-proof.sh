set -u
W="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/.worktrees/inb-t8"
M="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
cd "$W" || exit 9
LOG="$W/.run-logs/teeth-fix-proof.log"
: > "$LOG"
{
echo "CARRIER_HEAD=$(git rev-parse HEAD)"
echo "起跑 loadavg: $(sysctl -n vm.loadavg)"
for f in queue quota ticket; do
  cp "$M/research/tools/verify-inbound-$f-teeth.py" "$W/research/tools/verify-inbound-$f-teeth.py"
done
for f in queue quota ticket; do
  R="research/tools/verify-inbound-$f-teeth.py"
  echo "########## $f --self-test ##########"
  timeout 900 python3 "$R" --self-test; echo "RC_SELF_$f=$?"
  echo "########## $f 全部变异臂（真跑） ##########"
  timeout 3600 python3 "$R"; echo "RC_FULL_$f=$?"
  echo "跑完后目标源码脏条目（须空）："
  git status --porcelain -- server/src/automation/inbound.routes.ts server/src/automation/ai-metering.ts server/src/entitlement.ts server/src/api.ts
  echo "(以上为空=已还原)"
done
echo "还原装置文件"
git checkout -- research/tools/verify-inbound-queue-teeth.py research/tools/verify-inbound-quota-teeth.py research/tools/verify-inbound-ticket-teeth.py
echo "RC_RESTORE=$?"
echo "副本脏条目数（跟踪文件，只该剩我先前那批证据图）: $(git status --porcelain | grep -vc '^??')"
echo "收尾 loadavg: $(sysctl -n vm.loadavg)"
} >> "$LOG" 2>&1
echo "ALL_DONE rc=$?"
