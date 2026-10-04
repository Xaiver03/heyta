#!/bin/bash
# `b-window-keeper.sh` 的十二臂验证台。
# ============================================================================
# 这把 rig 存在的理由：看守是**会在窗口开的那一刻动设备面**的东西（reinstall-all 会
# 卸装模拟器里的包、覆盖 /Applications/Heyta.app、往 iOS 模拟器装新产物）。
# "它会不会在红门下起跑"不能靠读代码确认 ⇒ 把它接到一次性夹具上，逐臂喂一组闸门读数，
# 看它到底叫没叫那一动现场的腿（`calls` 里 REINSTALL 的**枚数**就是唯一分辨器）。
#
# 🔴 三条共同约定（本仓几把 rig 的老规矩）：
#   ① 桩必须实现**真谓词**（按序列退码、把收到的参数落盘），不是 `exit 0`；
#   ② 断言"没跑"要数枚数，且"到了但失败"与"根本没到"要能分清（G 与 G2 就是这一对）；
#   ③ J 是变异臂：摘掉开窗条件 ⇒ 臂 C 必须在红门下起跑；J2 还原 ⇒ C 的形状必须复现。
#
# 载体用的是**真 linked worktree**（不是 clone）：真实结构里载体与主检出共享对象库，
# clone 出来的副本拿不到 main 刚前进的那枚 commit ⇒ 追平那一步会假失败（第一版就踩在这）。
#
# 用法：bash research/tools/b-window-keeper-arms.sh
set -u
cd "$(dirname "$0")/../.." || exit 1
KEEPER_SRC=research/tools/b-window-keeper.sh
FIX=$(mktemp -d /tmp/ht-bkeeper.XXXXXX)
trap 'rm -rf -- "$FIX"' EXIT
mkdir -p "$FIX/home"
export HOME="$FIX/home"

PASS=0; FAIL=0
ok() { PASS=$(( PASS + 1 )); echo "  ✅ $1"; }
no() { FAIL=$(( FAIL + 1 )); echo "  ❌ $1"; }

cat > "$FIX/gate" <<'SH'
#!/bin/bash
# 真谓词：按 GSEQ 逐行退码，行用尽就重复最后一行（与 r14c 那把闸门桩同一约定 ——
# 用 `exit ""` 会退 255，把"序列用尽"读成"装置坏"）。
N=$(( $(cat "$FIX/cnt") + 1 )); echo "$N" > "$FIX/cnt"
LINE=$(sed -n "${N}p" "$GSEQ")
[ -z "$LINE" ] && LINE=$(tail -1 "$GSEQ")
RC=${LINE%%:*}; REDS=${LINE#*:}
[ "$REDS" != "-" ] && echo "REDS=${REDS}"
echo "gate ${N} rc=${RC}" >> "$FIX/gate_calls"
exit "$RC"
SH
cat > "$FIX/reinstall" <<'SH'
#!/bin/bash
echo "REINSTALL device=${IOS_DEVICE_NAME:-〈没传〉}" >> "$FIX/calls"
exit "${REINSTALL_RC:-0}"
SH
cat > "$FIX/oplog" <<'SH'
#!/bin/bash
echo "OPLOG" >> "$FIX/calls"
exit "$(cat "$FIX/oplog_rc")"
SH
cat > "$FIX/hprobe" <<'SH'
#!/bin/bash
cat "$FIX/hpid" 2>/dev/null
SH
cp "$KEEPER_SRC" "$FIX/keeper"

mk_fixture() {
  rm -rf "$FIX/main" "$FIX/heyta-wt-reinstall" "$FIX/home"
  mkdir -p "$FIX/main/research/tools" "$FIX/main/scripts" "$FIX/home"
  ( cd "$FIX/main"
    git init -q -b main . 2>/dev/null || { git init -q .; git checkout -q -b main; }
    git config user.email rig@local; git config user.name rig
    cp "$FIX/keeper" research/tools/b-window-keeper.sh
    echo '#!/bin/bash' > scripts/verify-mobile-window-gate.sh
    git add -A; git commit -q -m base )
  git -C "$FIX/main" worktree add -q --detach "$FIX/heyta-wt-reinstall" HEAD
}
advance_main() {
  ( cd "$FIX/main"; echo "x$RANDOM" > new.txt; git add -A; git commit -q -m adv )
}

run_keeper() {
  local seq="$1"
  echo 0 > "$FIX/cnt"; : > "$FIX/calls"; : > "$FIX/gate_calls"
  # 桩的默认是"这一步会成功"：基线必须一路走得通，臂才是**加一个失败**才红
  # （第一版默认构建桩 rc=1 ⇒ B/G2/I 三臂假红，红在一个我没测的东西上）。
  printf '%s\n' "${BK_OPLOG_RC:-0}" > "$FIX/oplog_rc"
  printf '%s\n' "${BK_HPID:-}" > "$FIX/hpid"
  printf '%s\n' "$seq" > "$FIX/gseq"
  ( FIX="$FIX" GSEQ="$FIX/gseq" GATE="$FIX/gate" REINSTALL="$FIX/reinstall" \
    OPLOG="$FIX/oplog" H_PROBE="$FIX/hprobe" \
    LOG="$FIX/log" STABLE="$FIX/stable" BUDGET="${BK_BUDGET:-30}" INTERVAL=0 \
    DEFER_MAX="${BK_DEFER:-0}" IOS_DEVICE_NAME=rig-iphone RUN="${BK_RUN:-1}" \
    CARRIER="$FIX/heyta-wt-reinstall" \
    bash "$FIX/main/research/tools/b-window-keeper.sh" ) 2>&1
  echo $? > "$FIX/rc"
}
RCV() { cat "$FIX/rc"; }
# 🔴 `grep -c` 在**文件不存在**时一个字都不打印（它报错），`|| true` 只压掉退码 ⇒
#    数出来是空串，而空串既不是 0 也不是 1 —— 三臂就是被这一点假红的
#    （本仓 §7 同族：`grep -c . f || echo 0` 在空文件上打出两行）。先判在不在。
NCALLS() { if [ -f "$FIX/calls" ]; then grep -c 'REINSTALL' "$FIX/calls"; else echo 0; fi; }
NOPLOG() { if [ -f "$FIX/calls" ]; then grep -c 'OPLOG' "$FIX/calls"; else echo 0; fi; }
NGATE() { if [ -f "$FIX/gate_calls" ]; then grep -c 'gate ' "$FIX/gate_calls"; else echo 0; fi; }

mk_fixture
[ "$(NCALLS)" = 0 ] || no "夹具基线就不干净（calls 初始已有 $(NCALLS) 枚）"

# ── A：没给 RUN ⇒ 拒绝动现场 ───────────────────────────────────────────
BK_RUN=0; BK_BUDGET=30; run_keeper "0:-" > "$FIX/out"
if [ "$(RCV)" = 1 ] && grep -q 'REFUSE=' "$FIX/out" && [ "$(NCALLS)" = 0 ] && [ "$(NGATE)" = 0 ]; then
  ok "A 缺 RUN=1 ⇒ rc=1、留痕、连闸门都没叫（默认不动现场）"
else no "A rc=$(RCV) calls=$(NCALLS) gate=$(NGATE)"; fi
BK_RUN=1

# ── B：红两次、第三次开 ⇒ 等到窗口才跑 ─────────────────────────────────
mk_fixture; BK_BUDGET=60; run_keeper "3:load
3:load
0:-" > "$FIX/out"
if [ "$(RCV)" = 0 ] && [ "$(NCALLS)" = 1 ] && [ "$(NOPLOG)" = 1 ] && [ "$(NGATE)" = 3 ]; then
  ok "B rc=3,rc=3,rc=0 ⇒ 等两次（闸门被叫 3 次）后起跑：op-log 1 次、重装 1 次"
else no "B rc=$(RCV) calls=$(NCALLS) oplog=$(NOPLOG) gate=$(NGATE)"; fi

# ── I 结构顺序（不是内容判据）：开窗 < 构建 < 收工 ─────────────────────
W=$(grep -n 'WINDOW=OPEN' "$FIX/log" | cut -d: -f1 | head -1)
O=$(grep -n 'op-log-build' "$FIX/log" | cut -d: -f1 | head -1)
D=$(grep -n 'B_DONE' "$FIX/log" | cut -d: -f1 | head -1)
if [ -n "$W" ] && [ -n "$O" ] && [ -n "$D" ] && [ "$W" -lt "$O" ] && [ "$O" -lt "$D" ]; then
  ok "I 顺序成立 WINDOW(${W}) < op-log-build(${O}) < B_DONE(${D})"
else no "I 顺序读不出来 W=${W} O=${O} D=${D}"; fi

# ── C：预算用尽 ⇒ 门一直红就是不跑，且这是 rc=3（环境无效）不是 rc=1 ───
mk_fixture; BK_BUDGET=1; run_keeper "3:load" > "$FIX/out"
if [ "$(RCV)" = 3 ] && [ "$(NCALLS)" = 0 ] && grep -q 'WINDOW=TIMEOUT' "$FIX/out"; then
  ok "C 门一直红 ⇒ rc=3「环境无效」，重装腿 0 次（这就是「负载门不达标就等」那条腿）"
else no "C rc=$(RCV) calls=$(NCALLS)"; fi

# ── D：闸门用法坏（rc=1）⇒ 装置停，不许混进"再等一次" ──────────────────
mk_fixture; BK_BUDGET=60; run_keeper "1:-" > "$FIX/out"
if [ "$(RCV)" = 4 ] && grep -q 'BROKEN=闸门' "$FIX/out" && [ "$(NCALLS)" = 0 ]; then
  ok "D 闸门 rc=1 ⇒ keeper rc=4 且不起跑（把用法错当等待，门永远不开也没人知道）"
else no "D rc=$(RCV) calls=$(NCALLS)"; fi

# ── E：H 的 flaky 看守还活着 ⇒ 不抢同一道门 ────────────────────────────
mk_fixture; BK_HPID=4242; BK_BUDGET=60; run_keeper "0:-" > "$FIX/out"; BK_HPID=""
if [ "$(RCV)" = 1 ] && grep -q '让路' "$FIX/out" && [ "$(NCALLS)" = 0 ]; then
  ok "E H 看守在跑 ⇒ 让路、不硬抢（重装 0 次）"
else no "E rc=$(RCV) calls=$(NCALLS) out=$(grep -c . "$FIX/out")"; fi

# ── F：载体脏 ⇒ 不在别人的现场上跑 ─────────────────────────────────────
mk_fixture; echo dirt > "$FIX/heyta-wt-reinstall/dirty.txt"; BK_BUDGET=60; run_keeper "0:-" > "$FIX/out"
if [ "$(RCV)" = 1 ] && grep -q 'STOP=carrier-dirty' "$FIX/out" && [ "$(NCALLS)" = 0 ]; then
  ok "F 载体有未提交文件 ⇒ STOP=carrier-dirty、不起跑"
else no "F rc=$(RCV) calls=$(NCALLS)"; fi

# ── G / G2：构建这一步「到了但失败」与「没到」要分得开 ─────────────────
mk_fixture; BK_OPLOG_RC=1; BK_BUDGET=60; run_keeper "0:-" > "$FIX/out"
if [ "$(RCV)" = 1 ] && grep -q 'STOP=op-log-build' "$FIX/out" && [ "$(NCALLS)" = 0 ] && [ "$(NOPLOG)" = 1 ]; then
  ok "G op-log 构建 rc=1 ⇒ 停在那里（构建被叫 1 次、重装 0 次）"
else no "G rc=$(RCV) reinstall=$(NCALLS) oplog=$(NOPLOG)"; fi
BK_OPLOG_RC=""; BK_BUDGET=60; run_keeper "0:-" > "$FIX/out"
if [ "$(RCV)" = 0 ] && [ "$(NCALLS)" = 1 ]; then
  ok "G2 只把构建桩改回成功 ⇒ 同一组读数一路放行到重装（G 的红确实来自那一步）"
else no "G2 rc=$(RCV) calls=$(NCALLS)"; fi

# ── H：main 前进 ⇒ 载体必须追平到那一枚，且逐字对得上 ──────────────────
mk_fixture; advance_main; BK_BUDGET=60; run_keeper "0:-" > "$FIX/out"
FROM=$(grep -o 'from=[0-9a-f]*' "$FIX/out" | head -1)
if grep -q 'ALIGN rc=0' "$FIX/out" && ! grep -q 'ALIGN=already' "$FIX/out"; then
  OK=$(git -C "$FIX/heyta-wt-reinstall" rev-parse --short HEAD)
  WANT=$(git -C "$FIX/main" rev-parse --short main)
  if [ "$OK" = "$WANT" ] && [ -n "$FROM" ] && [ "$FROM" != "from=${OK}" ]; then
    ok "H main 前进一笔 ⇒ 载体从 ${FROM#from=} 追到 ${WANT}（B 主张的「当前源码」就是这一枚）"
  else no "H 追平后载体 ${OK} / 目标 ${WANT} / ${FROM}"; fi
else no "H 没追平：$(grep ALIGN "$FIX/out" | head -2)"; fi

# ── J 变异：摘掉「只有 rc=0 才开窗」⇒ 红门下也起跑 ─────────────────────
cp "$KEEPER_SRC" "$FIX/keeper_mut"
python3 - "$FIX/keeper_mut" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = 'if [ "$RC" = 0 ]; then'
assert s.count(old) == 1, "开窗条件形状变了（命中 %d 处）" % s.count(old)
open(p, 'w', encoding='utf-8').write(s.replace(old, 'if : ; then'))
PY
cp "$FIX/keeper_mut" "$FIX/main/research/tools/b-window-keeper.sh"
BK_BUDGET=1; run_keeper "3:load" > "$FIX/out"
if [ "$(NCALLS)" = 1 ] && grep -q 'B_DONE' "$FIX/out"; then
  ok "J 摘掉开窗条件 ⇒ **红门下也真的起跑了重装**（C 臂那条腿确实长在 rc=0 这一行）"
else no "J 变异后 calls=$(NCALLS) —— C 的红不来自开窗条件：$(tail -2 "$FIX/out")"; fi
cp "$FIX/keeper" "$FIX/main/research/tools/b-window-keeper.sh"   # 还原，别把变异体留在夹具里
BK_BUDGET=1; run_keeper "3:load" > "$FIX/out"
if [ "$(RCV)" = 3 ] && [ "$(NOPLOG)" = 0 ] && [ "$(NCALLS)" = 0 ]; then
  ok "J2 还原 ⇒ 臂 C 的形状复现（rc=3、构建与重装都 0 次）"
else no "J2 还原后 rc=$(RCV) oplog=$(NOPLOG) calls=$(NCALLS)"; fi

# ── K：默认值臂（不注入 REINSTALL ⇒ 取的一定是**载体**那份，不是主检出那份）──
# 这一臂是我**修完之后补的**：第一版把重装脚本默认成主检出那棵树的 `scripts/reinstall-all.sh`
# —— 那等于在别人的活树上跑 B，正是载体这一路要避免的事，而前十二臂全都注入桩、没量到默认值。
mk_fixture; BK_BUDGET=60
echo 0 > "$FIX/cnt"; : > "$FIX/calls"; printf '0\n' > "$FIX/gseq"; printf '0\n' > "$FIX/oplog_rc"; : > "$FIX/hpid"
printf '%s\n' "0:-" > "$FIX/gseq"
OUT=$( ( FIX="$FIX" GSEQ="$FIX/gseq" GATE="$FIX/gate" OPLOG="$FIX/oplog" H_PROBE="$FIX/hprobe" \
    LOG="$FIX/log2" STABLE="$FIX/stable2" BUDGET=60 INTERVAL=0 DEFER_MAX=0 \
    IOS_DEVICE_NAME=rig-iphone RUN=1 CARRIER="$FIX/heyta-wt-reinstall" \
    bash "$FIX/main/research/tools/b-window-keeper.sh" ) 2>&1; echo $? > "$FIX/rc" )
KLINE=$(printf '%s\n' "$OUT" | grep -E 'BROKEN=载体里没有重装脚本|STEP reinstall' | head -1)
if [ "$(RCV)" = 4 ] && printf '%s\n' "$KLINE" | grep -q "$FIX/heyta-wt-reinstall/scripts/reinstall-all.sh"; then
  ok "K 不注入重装脚本 ⇒ 默认落在**载体**那份（$(printf '%s\n' "$KLINE" | cut -c1-52)…），夹具里不存在才 BROKEN"
else no "K rc=$(RCV) 默认值那行读不出载体路径：${KLINE}"; fi

echo "b-window-keeper 臂：pass=$PASS fail=$FAIL"
[ "$FAIL" = 0 ] || exit 1
