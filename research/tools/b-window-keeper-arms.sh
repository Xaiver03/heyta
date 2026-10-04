#!/bin/bash
# `b-window-keeper.sh` 的验证台。
# 🔴 **臂数不写在这份文件头**（写了就会漂，本仓库登记过"号段声明行是第二本账"）——
#    收工读数只有最后那行 `pass=… fail=…`，引用时报它现量的数字。
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
# L 臂的基线读数与看守用的是同一份谓词（否则臂在测自己那套 ps 写法）。
. scripts/lib/ps-scan.sh
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
# 🔴 桩必须**收参数**：拆段之后看守会叫两趟（`--only mac,windows` / `--only android,ios`），
#    唯一的分辨器是这两行的**内容与顺序** —— 只数总次数会把"只跑了设备段"读成"跑完了四端"，
#    而那正是这次改动要防的那一格（破坏性段在没有新读数的情况下起跑）。
case "$*" in
  *mac,windows*) echo "REINSTALL desktop args=$* device=${IOS_DEVICE_NAME:-〈没传〉}" >> "$FIX/calls"; exit "${REINSTALL_DESKTOP_RC:-0}" ;;
  *android,ios*) echo "REINSTALL device  args=$* device=${IOS_DEVICE_NAME:-〈没传〉}" >> "$FIX/calls"; exit "${REINSTALL_DEVICE_RC:-0}" ;;
  *) echo "REINSTALL whole   args=$* device=${IOS_DEVICE_NAME:-〈没传〉}" >> "$FIX/calls"; exit "${REINSTALL_RC:-0}" ;;
esac
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
cp scripts/lib/ps-scan.sh "$FIX/ps-scan-lib"

mk_fixture() {
  rm -rf "$FIX/main" "$FIX/heyta-wt-reinstall" "$FIX/home"
  mkdir -p "$FIX/main/research/tools" "$FIX/main/scripts" "$FIX/home"
  ( cd "$FIX/main"
    git init -q -b main . 2>/dev/null || { git init -q .; git checkout -q -b main; }
    git config user.email rig@local; git config user.name rig
    cp "$FIX/keeper" research/tools/b-window-keeper.sh
    echo '#!/bin/bash' > scripts/verify-mobile-window-gate.sh
    # 🔴 看守现在会 `source scripts/lib/ps-scan.sh`（取不到就 exit 4，不冒充"没人在跑"）⇒
    #    一次性夹具必须带上这枚**新增的被依赖文件**，否则整臂一起红在缺文件上而不是红在行为上
    #    （本仓那把 `r14c-carrier-heal.sh` 就是为同一件事存在的）。
    mkdir -p scripts/lib
    cp "$FIX/ps-scan-lib" scripts/lib/ps-scan.sh || \
      { echo "夹具建不起来：一次性载体里没有 scripts/lib/ps-scan.sh"; exit 1; }
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
  # 🔴 这一格踩过的坑（同一族的第三次）：写在函数调用前面的旋钮**不会**进到子进程环境，
  #    必须在这里列进那次 `env` 前缀里才算数 —— 少写一次，臂打的就是真现场。
  ( FIX="$FIX" GSEQ="$FIX/gseq" GATE="$FIX/gate" REINSTALL="$FIX/reinstall" \
    REINSTALL_DESKTOP_RC="${BK_R_DESK:-0}" REINSTALL_DEVICE_RC="${BK_R_DEV:-0}" \
    OPLOG="$FIX/oplog" H_PROBE="$FIX/hprobe" \
    LOG="$FIX/log" STABLE="$FIX/stable" BUDGET="${BK_BUDGET:-30}" INTERVAL=0 \
    GATE2_BUDGET="${BK_GATE2:-0}" \
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
# 拆段之后**总数不再是分辨器**（2 可能是"桌面+设备"，也可能是"设备跑了两次"）⇒ 按段数。
NDESK() { if [ -f "$FIX/calls" ]; then grep -c 'REINSTALL desktop' "$FIX/calls"; else echo 0; fi; }
NDEV() { if [ -f "$FIX/calls" ]; then grep -c 'REINSTALL device  ' "$FIX/calls"; else echo 0; fi; }
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
if [ "$(RCV)" = 0 ] && [ "$(NDESK)" = 1 ] && [ "$(NDEV)" = 1 ] && [ "$(NOPLOG)" = 1 ] && [ "$(NGATE)" = 4 ]; then
  ok "B rc=3,rc=3,rc=0 ⇒ 等两次后起跑：op-log 1 次、桌面段 1 次、设备段 1 次（闸门被叫 4 次 = 等两次 + 开窗 + 设备段前再判一次）"
else no "B rc=$(RCV) desk=$(NDESK) dev=$(NDEV) oplog=$(NOPLOG) gate=$(NGATE)"; fi

# ── I 结构顺序（不是内容判据）：开窗 < 构建 < 桌面段 < 再判 < 设备段 < 收工 ─
W=$(grep -n 'WINDOW=OPEN' "$FIX/log" | cut -d: -f1 | head -1)
O=$(grep -n 'op-log-build' "$FIX/log" | cut -d: -f1 | head -1)
S1=$(grep -n 'STEP reinstall-desktop' "$FIX/log" | cut -d: -f1 | head -1)
G2=$(grep -n 'GATE2=OPEN' "$FIX/log" | cut -d: -f1 | head -1)
S2=$(grep -n 'STEP reinstall-device' "$FIX/log" | cut -d: -f1 | head -1)
D=$(grep -n 'B_DONE' "$FIX/log" | cut -d: -f1 | head -1)
if [ -n "$W" ] && [ -n "$O" ] && [ -n "$S1" ] && [ -n "$G2" ] && [ -n "$S2" ] && [ -n "$D" ] \
   && [ "$W" -lt "$O" ] && [ "$O" -lt "$S1" ] && [ "$S1" -lt "$G2" ] && [ "$G2" -lt "$S2" ] && [ "$S2" -lt "$D" ]; then
  ok "I 顺序成立 WINDOW(${W}) < op-log(${O}) < 桌面段(${S1}) < GATE2(${G2}) < 设备段(${S2}) < B_DONE(${D}) —— 再判**长在两段之间**，不是开头那一次"
else no "I 顺序读不出来 W=${W} O=${O} S1=${S1} G2=${G2} S2=${S2} D=${D}"; fi

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
if [ "$(RCV)" = 0 ] && [ "$(NDESK)" = 1 ] && [ "$(NDEV)" = 1 ]; then
  ok "G2 只把构建桩改回成功 ⇒ 同一组读数一路放行到桌面段与设备段（G 的红确实来自那一步）"
else no "G2 rc=$(RCV) desk=$(NDESK) dev=$(NDEV)"; fi

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
# ── J 变异：摘掉「只有开窗才继续」⇒ 红门下也起跑 ────────────────────────
# 🔴 针脚跟着 `judge` 那次重构换过一次形状（老针 `if [ "$RC" = 0 ]; then` 命中 **0 处**，
#    第一趟就是被那句 assert 拦下来的 —— 变异不落地而 rc=0 什么也不证明，这条规矩救过一次）。
cp "$KEEPER_SRC" "$FIX/keeper_mut"
python3 - "$FIX/keeper_mut" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = 'if [ "$G_OPEN" = 1 ]; then'
assert s.count(old) == 1, "开窗条件形状变了（命中 %d 处）" % s.count(old)
open(p, 'w', encoding='utf-8').write(s.replace(old, 'if : ; then'))
PY
cp "$FIX/keeper_mut" "$FIX/main/research/tools/b-window-keeper.sh"
BK_BUDGET=1; run_keeper "3:load" > "$FIX/out"
if [ "$(NDESK)" = 1 ] && [ "$(NDEV)" = 0 ] && grep -q 'B_DESKTOP_DONE' "$FIX/out" && grep -q 'STOP=device-window-closed' "$FIX/out"; then
  ok "J 摘掉开窗条件 ⇒ 桌面段真的跑了（动了 /Applications），但**设备段被第二次判挡住**（0 次）⇒ 两道门是两道，不是一道抄两遍"
else no "J 变异后 desk=$(NDESK) dev=$(NDEV) —— C 的红不来自开窗条件：$(tail -2 "$FIX/out")"; fi
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
    LOG="$FIX/log2" STABLE="$FIX/stable2" BUDGET=60 INTERVAL=0 DEFER_MAX=0 GATE2_BUDGET=0 \
    IOS_DEVICE_NAME=rig-iphone RUN=1 CARRIER="$FIX/heyta-wt-reinstall" \
    bash "$FIX/main/research/tools/b-window-keeper.sh" ) 2>&1; echo $? > "$FIX/rc" )
KLINE=$(printf '%s\n' "$OUT" | grep -E 'BROKEN=载体里没有重装脚本|STEP reinstall' | head -1)
if [ "$(RCV)" = 4 ] && printf '%s\n' "$KLINE" | grep -q "$FIX/heyta-wt-reinstall/scripts/reinstall-all.sh"; then
  ok "K 不注入重装脚本 ⇒ 默认落在**载体**那份（$(printf '%s\n' "$KLINE" | cut -c1-52)…），夹具里不存在才 BROKEN"
else no "K rc=$(RCV) 默认值那行读不出载体路径：${KLINE}"; fi

# ── L：让路那一格的**默认探针**（不注入桩，让它走真实 `ps` 图案）。
#    K 臂的教训同一族：前面十二臂全用 H_PROBE 桩，真实图案从没被量过 ——
#    而这次改的正是图案本身（从"看守活着"改成"e2e 在跑"），改错了两边都不会响。
#    两腿必须**相反**：在等的看守 ⇒ 不许挡 B；真在跑的 e2e ⇒ 必须挡。恒挡或恒不挡都只红一腿。
mk_fixture
# 🔴 图案里的 `[-]` 不是装饰：第一版这里写的是字面串，基线数出 **1**（后来 3），
#    而真读数是 0 —— grep 把自己的 argv 照进去了（`ps` 拍快照时 grep 还活着），
#    连我敲的那条 `zsh -c` 包装命令行都带着那串。基线假脏 = 这一臂永远判"此刻不能判"，
#    而它看起来像在防"现场真空假设"，实际在防一个不存在的东西。
# 🔴 光挡自匹配还不够（M4 实测）：**调用我的那条命令行**里带着 needle 时，ps 会把它当成现场进程。
#    所以基线必须豁免**自己这一树**（本进程 + 全部祖先）—— 这件事不在这儿重写一遍，
#    走看守同一份 `ht_ps_has`（`scripts/lib/ps-scan.sh`）：臂若自己实现一套 ps 读法，测的就是臂的抄件。
BASE_HIT=$(ht_ps_has 'ht-h-flaky[-]trace' | wc -l | tr -d ' ')
if [ "${BASE_HIT:-0}" != "0" ]; then
  no "L 现场基线不干净（已有 ${BASE_HIT} 行含 ht-h-flaky-trace）⇒ 这一臂此刻判不了，别把它的绿当成证据"
else
  run_L() {
    echo 0 > "$FIX/cnt"; : > "$FIX/calls"; printf '0\n' > "$FIX/gseq"; printf '0\n' > "$FIX/oplog_rc"; : > "$FIX/hpid"
    _sp=""
    if [ -n "$1" ]; then ( exec -a "$1" sleep 25 ) & _sp=$!; sleep 1.2; fi
    OUT=$( ( FIX="$FIX" GSEQ="$FIX/gseq" GATE="$FIX/gate" OPLOG="$FIX/oplog" REINSTALL="$FIX/reinstall" \
        H_PROBE= LOG="$FIX/logL" STABLE="$FIX/stableL" BUDGET=60 INTERVAL=0 DEFER_MAX=0 GATE2_BUDGET=0 \
        IOS_DEVICE_NAME=rig-iphone RUN=1 CARRIER="$FIX/heyta-wt-reinstall" \
        bash "$FIX/main/research/tools/b-window-keeper.sh" ) 2>&1; echo $? > "$FIX/rc" )
    [ -n "$_sp" ] && kill "$_sp" 2>/dev/null
    printf '%s' "$OUT"
  }
  L1=$(run_L "bash research/tools/.h-flaky-window-watcher.sh.snap.99998")
  if [ "$(RCV)" = 0 ] && [ "$(NDESK)" = 1 ] && [ "$(NDEV)" = 1 ] && printf '%s' "$L1" | grep -q '没有 H 的 e2e 在跑'; then
    ok "L1 只在**等门**的看守不再锁住 B（照旧开窗起跑，桌面段与设备段各 1 次）"
  else no "L1 rc=$(RCV) desk=$(NDESK) dev=$(NDEV) ⇒ 一个等待器还在这格上锁着 B"; fi
  L2=$(run_L "node --output=$FIX/ht-h-flaky-trace.999/run1")
  if [ "$(RCV)" = 1 ] && [ "$(NCALLS)" = 0 ] && printf '%s' "$L2" | grep -q '不硬抢'; then
    ok "L2 真在跑的 e2e（argv 带独占 --output）确实挡住了 B（重装 0 次、照实报不硬抢）"
  else no "L2 rc=$(RCV) 重装=$(NCALLS) 次 ⇒ 默认图案认不出「H 真在跑」，两边会在同一窗口同时开火"; fi
fi

# ── M/N/O：`FIRE=src-deferred` 这一格必须**只**在红集恰好是 src 一种时放行。
#    M = 正向（src 单独红 ⇒ 起跑）；N = 反向（src+load 并存 ⇒ 仍等，挡"见 src 就放行"）；
#    O = 闸门没打 REDS ⇒ 仍等（缺机器通道按可疑处理，不许当成"红集为空"）。
mk_fixture; BK_BUDGET=60; run_keeper "3:src" > "$FIX/out"
if [ "$(RCV)" = 0 ] && [ "$(NDESK)" = 1 ] && [ "$(NDEV)" = 1 ] && grep -q 'FIRE=src-deferred' "$FIX/out"; then
  ok "M 红集恰好只有 src ⇒ 载体那一路放行起跑（桌面段与设备段各 1 次）"
else no "M rc=$(RCV) desk=$(NDESK) dev=$(NDEV) ⇒ src-deferred 没接上，B 还在等一格对本路没有因果的读数"; fi
mk_fixture; BK_BUDGET=1; run_keeper "3:src,load" > "$FIX/out"
if [ "$(RCV)" = 3 ] && [ "$(NCALLS)" = 0 ] && ! grep -q 'FIRE=src-deferred' "$FIX/out"; then
  ok "N src 与 load 并存 ⇒ 继续等（重装 0 次）⇒ 那一格不是「见 src 就放行」"
else no "N rc=$(RCV) 重装=$(NCALLS) 次 ⇒ 放行条件被写宽了，负载红会被 src 一起放过"; fi
mk_fixture; BK_BUDGET=1; run_keeper "3:-" > "$FIX/out"
if [ "$(RCV)" = 3 ] && [ "$(NCALLS)" = 0 ]; then
  ok "O 闸门没打 REDS ⇒ 仍等（缺机器通道不当成「红集为空」）"
else no "O rc=$(RCV) 重装=$(NCALLS) 次 ⇒ 没读数被读成没红，这一腿没有牙"; fi
BK_BUDGET=30

# ── P/Q/Q2/R/R2/S：设备段前那一次**重新判**（10-05 01:1x 补，六臂）────────
#    为什么要这一组：端序是 `mac windows android ios`（`reinstall-all.sh:161`），设备面在**最后两段**，
#    而 mac 段会走公证（`HEYTA_NOTARY_TIMEOUT` 默认 900s）、windows 段是远端打包 ⇒ 从闸门放行到第一次
#    `adb uninstall` 隔着 15–25 分钟。"起跑那一刻没人在用"满足的是我的哨兵，不是 AGENTS §8.9 那句话。
#    🔴 两腿必须相反（P 放行 / Q 拦住），Q 还要有 R 这条**摘掉再判**的变异腿才算有牙；
#    Q2 管"门要能开"（先红后开 ⇒ 起跑），否则这一格可能写成一条永不放行的死门（本仓库 614/618 那一族）。
mk_fixture; BK_BUDGET=60; BK_GATE2=0; run_keeper "0:-" > "$FIX/out"
P1LINE=$(grep 'REINSTALL desktop' "$FIX/calls" 2>/dev/null | head -1)
P2LINE=$(grep 'REINSTALL device  ' "$FIX/calls" 2>/dev/null | head -1)
if [ "$(NDESK)" = 1 ] && [ "$(NDEV)" = 1 ] && printf '%s' "$P1LINE" | grep -q -- '--only mac,windows' \
   && printf '%s' "$P2LINE" | grep -q -- '--only android,ios' && grep -q 'GATE2=OPEN' "$FIX/out"; then
  ok "P 两段用的是重装脚本**现成的** --only：第一趟只带 mac,windows、第二趟只带 android,ios，中间那次再判留了痕"
else no "P desk=$(NDESK)[${P1LINE}] dev=$(NDEV)[${P2LINE}] GATE2=$(grep -c 'GATE2=OPEN' "$FIX/out")"; fi

# Q：第二次判红（负载回升 / 别人开始用设备）⇒ 设备段一次都不许起
mk_fixture; BK_BUDGET=60; BK_GATE2=0; run_keeper "0:-
3:dev" > "$FIX/out"
if [ "$(RCV)" = 1 ] && [ "$(NDESK)" = 1 ] && [ "$(NDEV)" = 0 ] && grep -q 'STOP=device-window-closed' "$FIX/out"; then
  ok "Q 桌面段跑完后设备面被占 ⇒ **设备段 0 次**，并大字写出「这轮只装了 mac+windows」（rc=1 不是 0）"
else no "Q rc=$(RCV) desk=$(NDESK) dev=$(NDEV) ⇒ 破坏性段在没有新读数的情况下起了跑"; fi

# Q2：第二次先红后开 ⇒ 设备段照样起跑（这一格不是死门）
mk_fixture; BK_BUDGET=60; BK_GATE2=120; run_keeper "0:-
3:dev
3:load
0:-" > "$FIX/out"
if [ "$(RCV)" = 0 ] && [ "$(NDEV)" = 1 ] && grep -q 'GATE2 try=1 rc=3' "$FIX/out"; then
  ok "Q2 第二次判先红两次、第三次开 ⇒ 设备段起跑（等得来，不是恒拦）"
else no "Q2 rc=$(RCV) dev=$(NDEV) ⇒ 再判那一格开不了（恒拦=下一条永不成立的门）"; fi

# R 变异：摘掉 6b 那次 `judge` ⇒ Q 的红必须消失（设备段在红门下照样起跑）
cp "$KEEPER_SRC" "$FIX/keeper_mut2"
python3 - "$FIX/keeper_mut2" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = 'judge; G2_RC="$G_RC"; G2_REDS="$G_REDS"'
assert s.count(old) == 1, "第二次判的形状变了（命中 %d 处）" % s.count(old)
open(p, 'w', encoding='utf-8').write(s.replace(old, 'G2_RC=0; G2_REDS=""'))
PY
cp "$FIX/keeper_mut2" "$FIX/main/research/tools/b-window-keeper.sh"
BK_BUDGET=60; BK_GATE2=0; run_keeper "0:-
3:dev" > "$FIX/out"
if [ "$(NDEV)" = 1 ]; then
  ok "R 摘掉那一次重新判 ⇒ 设备段**真的起跑了**（Q 拦住的那一趟照样动设备面）⇒ Q 的红长在再判那一行上"
else no "R 变异后 dev=$(NDEV) —— Q 的红不是来自再判，另有别的东西在拦（这条臂没回答它声称的问题）"; fi
cp "$FIX/keeper" "$FIX/main/research/tools/b-window-keeper.sh"
BK_BUDGET=60; BK_GATE2=0; run_keeper "0:-
3:dev" > "$FIX/out"
if [ "$(NDEV)" = 0 ] && grep -q 'STOP=device-window-closed' "$FIX/out"; then
  ok "R2 还原 ⇒ Q 的形状复现（设备段 0 次、大字报「只装了 mac+windows」）"
else no "R2 还原后 dev=$(NDEV) ⇒ 夹具里留了变异体，或这一格本来就不稳定"; fi

# S：设备段自己红 ⇒ 收口行必须把**两个 rc** 都写出来（只抄 B_DONE 会把桌面段的红读成没发生）
mk_fixture; BK_BUDGET=60; BK_GATE2=0; BK_R_DEV=1; run_keeper "0:-" > "$FIX/out"; BK_R_DEV=""
SSEG=$(grep -o 'segments=[^ ]*' "$FIX/out" | head -1)
if [ "$(RCV)" = 1 ] && [ "$(NDESK)" = 1 ] && [ "$(NDEV)" = 1 ] && printf '%s' "$SSEG" | grep -q 'desktop(0)+device(1)'; then
  ok "S 设备段 rc=1 ⇒ keeper rc=1 且收口行写着 ${SSEG}（两段的码各归各，不合并成一个数）"
else no "S rc=$(RCV) segments=${SSEG} desk=$(NDESK) dev=$(NDEV) ⇒ 两趟之和被写回成一个 rc，红会被吞"; fi

echo "b-window-keeper 臂：pass=$PASS fail=$FAIL"
[ "$FAIL" = 0 ] || exit 1
