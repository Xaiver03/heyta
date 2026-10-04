#!/bin/bash
# `r17-reshoot-keeper.sh` 的十三臂验证台（A–E 顺序与停止、F/G/H2 让路三向、I 失败停住、
# J/J2 默认值与默认图案对照、K 变异）。
# ============================================================================
# 这把 rig 存在的理由：看守是**会在窗口开的那一刻起真浏览器、覆盖取证 png** 的东西。
# "它会不会在红门下起跑"不能靠读代码确认 ⇒ 接到一次性夹具上，逐臂喂一组被守脚本的读数，
# 看它到底叫没叫那一支 `--confirm`（`calls` 里 CONFIRM 的**枚数**是唯一分辨器）。
#
# 三条共同约定（本仓几把 rig 的老规矩）：
#   ① 桩必须实现**真谓词**（按序列退码、把 GATES 打成被守那条命令的字面形状、参数落盘）；
#   ② 断言"没跑"要数枚数，且"到了但失败"与"根本没到"要能分清（B 与 G2 就是这一对）；
#   ③ 反向腿必须与正向腿**方向相反**（E 真在跑⇒挡 / F 只在等⇒不挡），恒挡或恒不挡都只红一腿。
#
# 用法：bash research/tools/r17-reshoot-arms.sh
set -u
cd "$(dirname "$0")/../.." || exit 1
KEEPER_SRC=research/tools/r17-reshoot-keeper.sh
FIX=$(mktemp -d /tmp/ht-r17reshoot.XXXXXX)
# 这台机器上不可能存在的图案：没指定让路对象的臂一律喂它 ⇒ 让路那一格退化成"没人跑"，
# 臂就只测自己那一件事，不会撞上现场真在跑的某枚 reinstall（01:0x 现量 pid 46610）。
TOK_NONE="ht-r17rig-absent-$$-zzz"
export HOME="$FIX/home"; mkdir -p "$FIX/home"
PASS=0; FAIL=0
ok() { PASS=$(( PASS + 1 )); echo "  ✅ $1"; }
no() { FAIL=$(( FAIL + 1 )); echo "  ❌ $1"; }

cat > "$FIX/reshoot" <<'SH'
#!/bin/bash
# 真谓词桩：按 CK_SEQ 逐行退码（`rc:GATES`），行用尽就重复最后一行。
# `--confirm` 那一次单独记进 calls，并可被 CK_CONFIRM_RC 打成失败。
N=$(( $(cat "$FIX/cnt") + 1 )); echo "$N" > "$FIX/cnt"
LINE=$(sed -n "${N}p" "$CK_SEQ"); [ -z "$LINE" ] && LINE=$(tail -1 "$CK_SEQ")
RC=${LINE%%:*}; GS=${LINE#*:}
for a in "$@"; do [ "$a" = "--confirm" ] && echo "CONFIRM range=${ONLY:-all}" >> "$FIX/calls"; done
if [ "$RC" != 0 ]; then
  echo "   ⇒ 前置不达标：GATES=${GS} —— 这是**环境无效**，不是产品失败（exit 3，不降级、不硬跑）。" >&2
  exit "$RC"
fi
if [ "${CK_CONFIRM_RC:-0}" != 0 ] && printf '%s' "$*" | grep -q -- '--confirm'; then
  echo "RESHOOT-FAKE-FAIL" >&2; exit "${CK_CONFIRM_RC}"
fi
exit "$RC"
SH
chmod +x "$FIX/reshoot"
cp "$KEEPER_SRC" "$FIX/keeper"

mk_fixture() {
  rm -rf "$FIX/work"; mkdir -p "$FIX/work/research/tools" "$FIX/work/scripts/lib"
  cp "$FIX/keeper" "$FIX/work/research/tools/r17-reshoot-keeper.sh"
  cp scripts/lib/ps-scan.sh "$FIX/work/scripts/lib/" || { echo "夹具建不起来：缺被依赖的 ps-scan.sh"; exit 1; }
  echo 0 > "$FIX/cnt"; : > "$FIX/calls"
}

run_keeper() {
  local seq="$1"
  echo 0 > "$FIX/cnt"; : > "$FIX/calls"; printf '%s\n' "$seq" > "$CK_SEQ_FILE"
  # 🔴 旋钮必须在这里**接进被守进程**（第一版没接 ⇒ 三条臂撞上现场那枚真在跑的 pid 46610，
  #    报出来的红全是让路，而不是臂想测的那件事 —— 注了旋钮不等于喂给了被测物）。
  #    没指定图案的臂一律喂 `TOK_NONE`（这台机器上不可能存在），让路那一格就退化成"没人跑"。
  ( FIX="$FIX" CK_SEQ="$CK_SEQ_FILE" RESHOOT="$FIX/reshoot" \
    DEFER_REINSTALL_RE="${RK_BRE:-$TOK_NONE}" DEFER_E2E_RE="${RK_HRE:-$TOK_NONE}" \
    LOG="$FIX/log" STABLE_LOG="$FIX/stable" BUDGET="${RK_BUDGET:-3}" INTERVAL=0 DEFER_MAX="${RK_DEFER:-0}" \
    RUN="${RK_RUN:-1}" ONLY="${RK_ONLY:-}" \
    bash "$FIX/work/research/tools/r17-reshoot-keeper.sh" ) > "$FIX/out" 2>&1
  echo $? > "$FIX/rc"
}
RCV() { cat "$FIX/rc"; }
NCONF() { if [ -f "$FIX/calls" ]; then grep -c 'CONFIRM' "$FIX/calls"; else echo 0; fi; }
NDRY() { cat "$FIX/cnt"; }

CK_SEQ_FILE="$FIX/seq"; mk_fixture
[ "$(NCONF)" = 0 ] || no "夹具基线就不干净（calls 初始已有 $(NCONF) 枚）"

# ── A：没给 RUN ⇒ 拒绝动现场，连被守的脚本都没叫 ──────────────────────
mk_fixture; RK_RUN=0 run_keeper "0:〈不该被叫〉"
if [ "$(RCV)" = 1 ] && [ "$(NDRY)" = 0 ] && [ "$(NCONF)" = 0 ]; then
  ok "A 缺 RUN=1 ⇒ rc=1、被守的脚本一次都没被叫（默认不动现场）"
else no "A rc=$(RCV) 叫=$(NDRY) confirm=$(NCONF)"; fi

# ── B：3,3,0 ⇒ 等两次后开窗并 --confirm ───────────────────────────────
mk_fixture; RK_BUDGET=60 run_keeper "3:load
3:load,dist
0:none"
# 叫的枚数是 **4**：三趟干跑 + 那一趟 `--confirm` 走的是同一支桩（它自己也被 `cnt` 数进去）。
# 分辨器是 `calls` 里的 CONFIRM 枚数 —— 拿"被叫几次"当"起跑几次"就是臂在测计数器的形状。
if [ "$(RCV)" = 0 ] && [ "$(NDRY)" = 4 ] && [ "$(NCONF)" = 1 ] && grep -q 'WINDOW=OPEN' "$FIX/out"; then
  ok "B rc=3,rc=3,rc=0 ⇒ 等两次（干跑 3 趟）后开窗并真的 --confirm 一次（总调用 4）"
else no "B rc=$(RCV) 叫=$(NDRY) confirm=$(NCONF)：$(grep -E 'WINDOW|try=' "$FIX/out" | tr '\n' ' ')"; fi

# ── C：门一直红 ⇒ 等到预算用尽，confirm 零次（这就是"不降级"那条腿）───
mk_fixture; RK_BUDGET=1 run_keeper "3:load"
if [ "$(RCV)" = 3 ] && [ "$(NCONF)" = 0 ] && grep -q 'WINDOW=TIMEOUT' "$FIX/out"; then
  ok "C 门一直红 ⇒ rc=3「环境无效」，confirm 腿 0 次（负载门不达标就等，不硬跑）"
else no "C rc=$(RCV) confirm=$(NCONF)"; fi

# ── D：被守的脚本返回 1 ⇒ 装置 rc=4（把用法错当等待，门永远不开也没人知道）
mk_fixture; RK_BUDGET=60 run_keeper "1:weird"
if [ "$(RCV)" = 4 ] && [ "$(NCONF)" = 0 ] && grep -q 'BROKEN=' "$FIX/out"; then
  ok "D 被守脚本 rc=1 ⇒ keeper rc=4 并响亮报 BROKEN（不继续等）"
else no "D rc=$(RCV) $(head -2 "$FIX/out" | tr '\n' ' ')"; fi

# ── E：读 GATES 的那条 sed 真取到值（不是恒〈可疑〉）─────────────────
#    这一臂钉的是"机器通道"本身：桩打的是被守那条命令的**字面形状**，
#    看守必须从中数出 `load,dist`，否则日志里的 `GATES=` 就只是装饰。
mk_fixture; RK_BUDGET=1 run_keeper "3:load,dist"
if grep -q 'GATES=load,dist' "$FIX/out"; then
  ok "E 读数通道成立：日志里 GATES 是从被守脚本那行**取出来的**（load,dist）"
else no "E 没把 GATES 取出来：$(grep 'try=' "$FIX/out" | head -1)"; fi

# ── 让路三臂用**夹具专属图案**（RK_BRE/RK_HRE 注进看守的旋钮），理由写在看守里：
#    这台机器随时可能有别条线真在跑 reinstall（01:0x 现量 pid 46610 就匹配着默认图案），
#    拿默认图案去断言"现场没人跑"= 假设现场真空 ⇒ 同一臂白天绿、深夜红。
#    默认图案本身由 J2 那一臂钉（拿**别的脚本**里的字面串来对照，不是抄我自己的记忆）。
TOK_B="ht-r17rig-b-$$-run"; TOK_H="ht-r17rig-h-$$-run"; TOK_WAIT="ht-r17rig-wait-$$"
rig_base0() { [ "$(pgrep -f "$1" | wc -l | tr -d ' ')" = 0 ] || { no "基线不干净：图案 ${1} 现场已有 $(pgrep -f "$1" | wc -l | tr -d ' ') 枚 ⇒ 这一臂判不了"; return 1; }; return 0; }

# ── F：让路**正向** —— 真在跑的重装 ⇒ 挡（DEFER_MAX=0 ⇒ 照实报 exit 1、confirm 零次）
mk_fixture; rig_base0 "$TOK_B"
( exec -a "$TOK_B" sleep 25 ) & P_B=$!
sleep 1.2
RK_BUDGET=60 RK_DEFER=0 RK_BRE="$TOK_B" RK_HRE="$TOK_H" run_keeper "0:none"
kill "$P_B" 2>/dev/null
if [ "$(RCV)" = 1 ] && [ "$(NCONF)" = 0 ] && grep -q '让路超' "$FIX/out"; then
  ok "F 真在跑的重装挡住了重拍（confirm 0 次、照实报不硬抢）"
else no "F rc=$(RCV) confirm=$(NCONF) ⇒ 让路那一格没生效"; fi

# ── G：让路**反向** —— 只有"在等"的那一枚（图案谁都不匹配）⇒ 不许挡
#    这一腿与 F 方向相反：恒挡会让它红，恒不挡会让 F 与 H2 红。
mk_fixture; rig_base0 "$TOK_WAIT"
( exec -a "$TOK_WAIT" sleep 25 ) & P_W=$!
sleep 1.2
RK_BUDGET=60 RK_DEFER=0 RK_BRE="$TOK_B" RK_HRE="$TOK_H" run_keeper "0:none"
kill "$P_W" 2>/dev/null
if [ "$(RCV)" = 0 ] && [ "$(NCONF)" = 1 ] && grep -q '没有真在跑的重装或 e2e' "$FIX/out"; then
  ok "G 不匹配任何"真在跑"图案的那一枚不锁住重拍（一个等待器不能锁另一个）"
else no "G rc=$(RCV) confirm=$(NCONF) ⇒ 让路在按"有没有人活着"判，不是按"有没有人在跑"判"; fi

# ── H2：让路正向第二形态 —— 真在跑的 e2e ⇒ 必须挡
mk_fixture; rig_base0 "$TOK_H"
( exec -a "$TOK_H" sleep 25 ) & P_E=$!
sleep 1.2
RK_BUDGET=60 RK_DEFER=0 RK_BRE="$TOK_B" RK_HRE="$TOK_H" run_keeper "0:none"
kill "$P_E" 2>/dev/null
if [ "$(RCV)" = 1 ] && [ "$(NCONF)" = 0 ]; then
  ok "H2 真在跑的 e2e 确实挡住了重拍（两个消费者各自一条腿，不是同一个图案）"
else no "H2 rc=$(RCV) confirm=$(NCONF)"; fi

# ── I：confirm 自己红 ⇒ 停在那里、不重试不掩盖（现场没有任何让路对象）
mk_fixture; CK_CONFIRM_RC=1 RK_BUDGET=60 RK_DEFER=0 RK_BRE="$TOK_B" RK_HRE="$TOK_H" run_keeper "0:none"
if [ "$(RCV)" = 1 ] && [ "$(NCONF)" = 1 ] && grep -q 'STOP=reshoot-failed' "$FIX/out"; then
  ok "I --confirm 退 1 ⇒ rc=1 并打 STOP=reshoot-failed（交人看，不自动重试）"
else no "I rc=$(RCV) confirm=$(NCONF)：$(tail -2 "$FIX/out" | tr '\n' ' ')"; fi

# ── J：默认值臂（**跑仓库里那一份**，不注入 RESHOOT ⇒ 守的一定是本仓那支脚本）
#     夹具里 MAIN 是从 $0 推的，所以在夹具里问默认值只能证明"推导成立"，不能证明指向真文件；
#     这一臂直接跑仓库那份（RUN=0 ⇒ 它只打印将要做什么，一次都不执行）。
JLINE=$(RUN=0 LOG="$FIX/logJ" STABLE_LOG="$FIX/stJ" bash research/tools/r17-reshoot-keeper.sh 2>&1 | grep '将会做' | head -1)
case "$JLINE" in
  *research/tools/r17-reshoot-stale.sh*) [ -f research/tools/r17-reshoot-stale.sh ] \
      && ok "J 不注入 ⇒ 默认守的就是仓库里那份 r17-reshoot-stale.sh（文件现量在）" \
      || no "J 默认路径写着它，但文件不在" ;;
  *) no "J 默认值那行读不出预期路径：${JLINE}" ;;
esac

# ── J2：默认图案的字面值与**另两个消费者**逐字相同（不写死我自己的记忆）。
#     图案现在是旋钮，字面量住在 `${X:-默认}` 的默认段里 ⇒ 从那一行抽，而不是从调用点抽。
knob_default(){ sed -nE "s/^$1=\"\\$\{$1:-(.*)\}\".*/\1/p" "$2" | head -1; }
DEF_R=$(knob_default DEFER_REINSTALL_RE research/tools/r17-reshoot-keeper.sh)
DEF_E=$(knob_default DEFER_E2E_RE research/tools/r17-reshoot-keeper.sh)
B_KB=$(grep -o "ht_ps_has '[^']*'" research/tools/b-window-keeper.sh | sed -n '1p' | sed "s/.*'\(.*\)'/\1/")
H_KB=$(knob_default CO_REINSTALL_RE research/tools/h-flaky-window-watcher.sh)
if [ -z "$DEF_R" ] || [ -z "$DEF_E" ] || [ -z "$B_KB" ] || [ -z "$H_KB" ]; then
  no "J2 抽取取空（reinstall=${DEF_R:-〈空〉} e2e=${DEF_E:-〈空〉} B=${B_KB:-〈空〉} H=${H_KB:-〈空〉}）⇒ 形状换了，这一臂此刻没有读数而不是「一致」"
else
  [ "$DEF_E" = "$B_KB" ] && ok "J2 e2e 图案与 B 看守那份逐字相同（=${DEF_E}）" \
    || no "J2 e2e 图案漂了：重拍=${DEF_E} B 看守=${B_KB}"
  [ "$DEF_R" = "$H_KB" ] && ok "J2 重装图案与 H 看守的 CO_REINSTALL_RE 逐字相同（=${DEF_R}）" \
    || no "J2 重装图案漂了：重拍=${DEF_R} H=${H_KB}"
fi

# ── K：变异臂 —— 摘掉让路那一格 ⇒ F/H2 必须变绿（说明它们真的长在那一行上）
mk_fixture
node -e 'const fs=require("fs");const p=process.argv[1];let s=fs.readFileSync(p,"utf8");const from="  if [ -z \"$B_PID\" ] && [ -z \"$H_PID\" ]; then";if(s.split(from).length!==2){console.error("LAND="+(s.split(from).length-1));process.exit(9)}fs.writeFileSync(p,s.replace(from,"  if : ; then"));console.log("MUT_LAND=1");' \
  "$FIX/work/research/tools/r17-reshoot-keeper.sh" || no "K 变异没落地（LAND≠1）⇒ 这一臂不算跑过"
( exec -a "$TOK_B" sleep 25 ) & P_K=$!
sleep 1.2
RK_BUDGET=60 RK_DEFER=0 RK_BRE="$TOK_B" run_keeper "0:none"
kill "$P_K" 2>/dev/null
if [ "$(NCONF)" = 1 ]; then
  ok "K 摘掉让路判定 ⇒ 重装真在跑也照样 confirm（F 那条腿确实长在 [ -z ... ] 那一行）"
else no "K 摘掉让路判定之后仍然挡 ⇒ F 的红不来自那一行，臂在测别的东西"; fi

echo "r17-reshoot-keeper 臂：pass=$PASS fail=$FAIL"
[ "$FAIL" = 0 ] || exit 1
