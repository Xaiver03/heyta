#!/usr/bin/env bash
# 反向验证：这条消费者 spec 是不是"能红的判据"。两臂各自造失败，再还原。
# 只在隔离副本 .worktrees/inb-t8 里跑；不改任何被跟踪文件的内容（AC 那一臂改的是本线自己那份计划的工作树副本，跑完立刻 checkout 还原）。
set -u
cd "$(dirname "$0")/.."
LOG=.run-logs/teeth-check.log
: > "$LOG"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }

spec() { ( cd server && timeout 900 npx --no-install vitest run tests/inbound-lane-rigs-consumers.spec.ts -t "$1" --maxWorkers=1 ) > ".run-logs/teeth-$2.out" 2>&1; echo $?; }

say "CARRIER_HEAD=$(git rev-parse HEAD)"

say "==== 臂 A：目录里多出一枚没登记的装置 ⇒ 分母自检该红"
cp research/tools/verify-inbound-ac-ticks.py research/tools/verify-inbound-aa-unregistered-probe.py
RC=$(spec 'research/tools 里没有' a)
say "臂 A（造坏后）RC=$RC  要求≠0 ⇒ $( [ "$RC" != 0 ] && echo 成立 || echo 不成立 )"
grep -E 'AssertionError|expected|unaccounted' .run-logs/teeth-a.out | head -3 | sed 's/^/   /' | tee -a "$LOG"
rm -f research/tools/verify-inbound-aa-unregistered-probe.py
RC=$(spec 'research/tools 里没有' a-restore)
say "臂 A（还原后）RC=$RC  要求=0 ⇒ $( [ "$RC" = 0 ] && echo 成立 || echo 不成立 )"

say ""
say "==== 臂 B：把一枚 AC 在工作树副本里勾上 ⇒ ac-ticks 该红并带着 spec 红"
python3 - <<'PY'
import re, pathlib
p = pathlib.Path('docs/plans/inbound-automation.md')
s = p.read_text(encoding='utf-8')
n = s.replace('- [ ] **AC-1 ', '- [x] **AC-1 ', 1)
assert n != s, '没找到 AC-1 那一行，臂 B 不成立'
p.write_text(n, encoding='utf-8')
PY
RC=$(spec 'verify-inbound-ac-ticks.py 退出 0' b)
say "臂 B（勾上后）RC=$RC  要求≠0 ⇒ $( [ "$RC" != 0 ] && echo 成立 || echo 不成立 )"
grep -E '已勾=1|结论：' .run-logs/teeth-b.out | head -3 | sed 's/^/   /' | tee -a "$LOG"
git checkout -- docs/plans/inbound-automation.md
say "还原后现量：未勾=$(grep -c '^- \[ \] \*\*AC-' docs/plans/inbound-automation.md) 已勾=$(grep -c '^- \[x\] \*\*AC-' docs/plans/inbound-automation.md) 计划脏条目=$(git status --porcelain -- docs/plans/inbound-automation.md | wc -l | tr -d ' ')"
RC=$(spec 'verify-inbound-ac-ticks.py 退出 0' b-restore)
say "臂 B（还原后）RC=$RC  要求=0 ⇒ $( [ "$RC" = 0 ] && echo 成立 || echo 不成立 )"
say "TEETH_DONE"
