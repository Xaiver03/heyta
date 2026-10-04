#!/usr/bin/env bash
# `r14c-carrier-chain.sh` 里那格 **verify 回 rc=3 时的有界重跑** 的牙（六臂）。
#
# 🔴 为什么要单独一把 rig：窗口是这台机器上最稀缺的东西（20:03 那一发等了 46 分钟才开成），
#    而那一发**一条判据都没跑到** —— 读数通道死了，脚本以 rc=3 收场。
#    旧形状里链把这一发**整个烧掉**：verify 之后直接收尾还原，没有第二次。
#    新的形状：rc=3 ⇒ 重问**同一条闸门**，还开着才再跑一次，**只一次**；
#    🔴 **rc=1 绝不重试** —— 那是判据集跑完之后的读数，重试等于把产品红当 flaky 洗。
#    "会停"和"不会乱试"这两件事都只能由臂回答（§8.3：不能失败的检查没有价值）。
#
# 六臂（全部在一次性迷你树里跑；闸门与验收都是**计数桩**，不碰设备、不起服务端）：
#   A 正：verify 回 1 ⇒ **不重试**（调用 1 次、final rc=1、日志里没有 VERIFY_INVALID）
#   B   verify 先回 3、重问的闸门回 0、第二趟回 0 ⇒ 调用 2 次、final rc=0、有 VERIFY_ATTEMPTS=2
#   C 🔴 verify 回 3 而**重问的闸门也关着** ⇒ 第二趟一个字都不许跑（调用 1 次）+ gate-closed 那行在
#   D   两趟都回 3 ⇒ **不追第三趟**（调用恰好 2 次）
#   E   前提臂：闸门桩与验收桩"真的被问过"（计数 ≥ 期望），否则本 rig 不作结论
#   F 🔴 变异：把 `while [ "$rc" = 3 ]` 摘成恒真 ⇒ 臂 A 与臂 D 必须转红（少了 F，A 的绿可能是桩自己给的）
#
# 抽原文跑，不重抄（本线既有约定）。用法：bash research/tools/r14c-verify-retry-arms.sh
# 退出码：0 = 六臂如预期；1 = 某一臂不按预期（= 装置或那段重试逻辑坏了，不是仓库坏了）
set -u
cd "$(dirname "$0")/../.." || exit 1
CHAIN="${CHAIN_OVERRIDE:-research/tools/r14c-carrier-chain.sh}"
[ -f "$CHAIN" ] || { echo "❌ 找不到被测脚本：$CHAIN"; exit 1; }

AG=$(grep -n '^ask_gate() {' "$CHAIN" | head -1 | cut -d: -f1)
[ -n "$AG" ] || { echo "❌ 链里没有 ask_gate 函数（那段窗口判据没被收成单一所有者）⇒ 本装置先失效而不是恒绿"; exit 1; }
AGE=$(awk -v from="$AG" 'NR>from && /^\}/ {print NR; exit}' "$CHAIN")
ASK=$(sed -n "${AG},${AGE}p" "$CHAIN")
[ -n "$ASK" ] || { echo "❌ ask_gate 抽出来是空的（第 ${AG}-${AGE:-空} 行）"; exit 1; }
printf '%s\n' "$ASK" | grep -q 'verify-mobile-window-gate.sh' || { echo "❌ 抽出的 ask_gate 里没有闸门调用 ⇒ 抽取范围不对"; exit 1; }

VB=$(grep -n '^run verify env PORT=' "$CHAIN" | head -1 | cut -d: -f1)
VE=$(grep -n '^\[ "\$VI" -gt 1 \] && echo "VERIFY_ATTEMPTS=' "$CHAIN" | head -1 | cut -d: -f1)
[ -n "$VB" ] && [ -n "$VE" ] || { echo "❌ 重试那段的锚点没找到（VB=${VB:-空} VE=${VE:-空}）⇒ 链改了形状，本装置先失效"; exit 1; }
RETRY=$(sed -n "${VB},${VE}p" "$CHAIN")
printf '%s\n' "$RETRY" | grep -q 'rc" = 3' || { echo "❌ 抽出的重试段里没有 rc=3 这个条件 ⇒ 抽取范围不对"; exit 1; }
echo "抽原文：ask_gate 第 ${AG}-${AGE} 行（$(printf '%s\n' "$ASK" | grep -c .) 行有内容）、重试段第 ${VB}-${VE} 行（$(printf '%s\n' "$RETRY" | grep -c .) 行有内容）"

T=$(mktemp -d /tmp/r14c-verify-retry.XXXXXX)
PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); printf '✅ %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '❌ %s\n' "$1"; }
lines_with() { if [ -f "$2" ]; then grep -c "$1" "$2"; else echo 0; fi; }
trap 'rm -rf "$T"' EXIT

# ── 一次性迷你树：闸门与验收都换成**计数桩** ────────────────────────────
mkdir -p "$T/tree/scripts"
cat > "$T/tree/scripts/verify-mobile-window-gate.sh" <<'G_EOF'
#!/usr/bin/env bash
# 桩：按调用序号回 GATE_CODES 里那一枚（形状 `<码>` 或 `<码>:<REDS>`），并打闸门契约里必须有的一行
n=1; [ -f "$HT_GATE_CNT" ] && n=$(($(cat "$HT_GATE_CNT") + 1))
printf '%s' "$n" > "$HT_GATE_CNT"
set -- $GATE_CODES
eval "spec=\$$n"
case "${spec:-3:device}" in
  *:*) rc="${spec%%:*}"; reds="${spec#*:}" ;;
  *)   rc="$spec"; reds="" ;;
esac
echo "REDS=${reds}"
exit "$rc"
G_EOF
cat > "$T/tree/scripts/verify-mobile-due-time.sh" <<'V_EOF'
#!/usr/bin/env bash
# 桩：按调用序号回 VERIFY_CODES 里那一枚码
n=1; [ -f "$HT_VERIFY_CNT" ] && n=$(($(cat "$HT_VERIFY_CNT") + 1))
printf '%s' "$n" > "$HT_VERIFY_CNT"
set -- $VERIFY_CODES
eval "rc=\$${n}"
[ -n "${rc:-}" ] || rc="$VERIFY_FALLBACK"
exit "$rc"
V_EOF
chmod +x "$T/tree/scripts/verify-mobile-window-gate.sh" "$T/tree/scripts/verify-mobile-due-time.sh"

# run_case <臂名> <验收码序列> <闸门码序列(每次两个：码 + 若非 0 则 REDS)> <重试上限> [被测重试段=RETRY]
run_case() {
  local name="$1" vcodes="$2" gcodes="$3" tries="$4" block="${5:-$RETRY}"
  : > "$T/$name.log"
  printf '0' > "$T/$name.gate"; printf '0' > "$T/$name.verify"
  cat > "$T/tree/$name.sh" <<C_EOF
set -u
LOG="$T/$name.log"
PORT=3140
CARRIER="$T/tree"
REGATE_TRIES=3
REGATE_SETTLE=0
VERIFY_TRIES="$tries"
export HT_GATE_CNT="$T/$name.gate" HT_VERIFY_CNT="$T/$name.verify"
export GATE_CODES="$gcodes" VERIFY_CODES="$vcodes" VERIFY_FALLBACK=0
run() { local nm="\$1"; shift; "\$@" >> "\$LOG" 2>&1; local rc="\$?"; echo "STEP \${nm} rc=\${rc}" >> "\$LOG"; return "\$rc"; }
C_EOF
  printf '%s\n' "$ASK" >> "$T/tree/$name.sh"
  printf 'rc=0\n' >> "$T/tree/$name.sh"
  printf '%s\n' "$block" >> "$T/tree/$name.sh"
  # 🔴 内层的 `%s` 必须写成 `%%s`：外层 `printf` 自己会吃掉 `%s`（没实参时替换成**空串**），
  #    生成的那行就成了 `printf "FINAL_RC= ATTEMPTS=\n"` —— 四条臂的 grep 全落空，
  #    症状与"重试逻辑坏了"逐字相同（本仓那条"变异/生成要断言落到被改那一层"的同族）。
  printf 'printf "FINAL_RC=%%s ATTEMPTS=%%s\\n" "$rc" "$VI" >> "$LOG"\n' >> "$T/tree/$name.sh"
  # 🔴 先断言**生成物自己是对的**：那行必须带着 `%s` 两个占位落进夹具。
  #    少了这一步，占位被外层吃掉时臂只会齐刷刷报"不如预期"，读起来像被测逻辑坏了。
  if [ "$(grep -c 'FINAL_RC=%s ATTEMPTS=%s' "$T/tree/$name.sh")" != "1" ]; then
    echo "RIG_SELF_BAD=$name 夹具里那行收尾语句没带上占位" >> "$T/$name.out"
    printf 'self'
    return
  fi
  ( cd "$T/tree" && bash "$name.sh" > "$T/$name.out" 2>&1 )
  printf '%s' "$?"
}
gate_calls() { cat "$T/$1.gate"; }
verify_calls() { cat "$T/$1.verify"; }

# ---------------------------------------------------------------- 臂 A
RC=$(run_case A "1" "0" 2)
VC=$(verify_calls A); GC=$(gate_calls A)
if [ "$VC" = "1" ] && [ "$GC" = "0" ] && grep -q 'FINAL_RC=1 ATTEMPTS=1' "$T/A.log" \
   && ! grep -q 'VERIFY_INVALID' "$T/A.log"; then
  ok "臂 A 正向：verify 回 **1** ⇒ 一次都不重试（验收被调 $VC 次、闸门**一次都没问** $GC 次、final rc=1）—— 产品红不洗"
else
  bad "臂 A 不如预期：验收=$VC 闸门=$GC rc=$RC 日志=$(tr '\n' '|' < "$T/A.log")"
fi

# ---------------------------------------------------------------- 臂 B
RC=$(run_case B "3 0" "0" 2)
VC=$(verify_calls B); GC=$(gate_calls B)
if [ "$VC" = "2" ] && [ "$GC" = "1" ] && grep -q 'FINAL_RC=0 ATTEMPTS=2' "$T/B.log" \
   && grep -q 'VERIFY_INVALID' "$T/B.log"; then
  ok "臂 B：verify 先回 3、重问的闸门还开着 ⇒ 再跑一次并回 0（验收 $VC 次、闸门 $GC 次、VERIFY_ATTEMPTS=2）"
else
  bad "臂 B 不如预期：验收=$VC 闸门=$GC rc=$RC 日志=$(tr '\n' '|' < "$T/B.log")"
fi

# ---------------------------------------------------------------- 臂 C
RC=$(run_case C "3" "3:dev" 2)
VC=$(verify_calls C); GC=$(gate_calls C)
if [ "$VC" = "1" ] && [ "$GC" = "1" ] && grep -q 'VERIFY_RETRY=gate-closed' "$T/C.log"; then
  ok "臂 C 🔴 关键一臂：verify 回 3 而**重问的闸门也关着** ⇒ 第二趟一个字都不跑（验收 $VC 次 / 闸门 $GC 次）—— 不在窗口外动设备"
else
  bad "臂 C 不如预期：验收=$VC 闸门=$GC rc=$RC 日志=$(tr '\n' '|' < "$T/C.log")"
fi

# ---------------------------------------------------------------- 臂 D
RC=$(run_case D "3 3" "0" 2)
VC=$(verify_calls D)
if [ "$VC" = "2" ] && grep -q 'FINAL_RC=3 ATTEMPTS=2' "$T/D.log"; then
  ok "臂 D：两趟都回 3 ⇒ **不追第三趟**（验收恰好 $VC 次）—— 有界，不是循环找 flaky"
else
  bad "臂 D 不如预期：验收=$VC rc=$RC 日志=$(tr '\n' '|' < "$T/D.log")"
fi

# ---------------------------------------------------------------- 臂 E（前提：桩真的被问过）
if [ "$(verify_calls A)" -ge 1 ] && [ "$(verify_calls B)" -ge 2 ] && [ "$(gate_calls C)" -ge 1 ]; then
  ok "臂 E 前提成立：计数桩都被问过（A 验收 $(verify_calls A) / B 验收 $(verify_calls B) 次 ⇒ 重试真的跑了 / C 闸门 $(gate_calls C) 次 ⇒ gate-closed 是桩答出来的）⇒ 上面的绿不是桩没被调用"
else
  bad "臂 E 前提不成立：有桩没被问过（A 验收 $(verify_calls A) / B 验收 $(verify_calls B) / C 闸门 $(gate_calls C)）⇒ A–D 的读数全部作废，先修本 rig"
fi

# ---------------------------------------------------------------- 臂 F（变异腿）
MUT=$(printf '%s\n' "$RETRY" | sed 's/\[ "\$rc" = 3 \]/[ -n "\$rc" ]/')
N_BEFORE=$(printf '%s\n' "$RETRY" | grep -c '\[ "\$rc" = 3 \]')
N_AFTER=$(printf '%s\n' "$MUT" | grep -c '\[ "\$rc" = 3 \]')
if [ "$N_BEFORE" != "1" ] || [ "$N_AFTER" != "0" ]; then
  bad "臂 F 前提不成立：变异应当恰好摘掉那个条件（改前 ${N_BEFORE} / 改后 ${N_AFTER}）⇒ 变异没落在被测段上"
else
  RC=$(run_case F1 "1" "0" 2 "$MUT")
  VC1=$(verify_calls F1)
  RC=$(run_case F2 "3 3 3" "0 0" 3 "$MUT")
  VC2=$(verify_calls F2)
  if [ "$VC1" != "1" ] || [ "$VC2" != "2" ]; then
    ok "臂 F 🔴 有牙证明：条件摘成恒真后，A 形那趟从 1 次变 $VC1 次（rc=1 也被重试），D 形那趟在 tries=3 下从 2 次变 $VC2 次 ⇒ A/D 的计数由那个 rc=3 条件决定，不是桩给的"
  else
    bad "臂 F 不如预期：恒真变异下两趟仍按原次数（${VC1} / ${VC2}）⇒ 重试次数根本不是由那个条件决定的，A/D 测的不是这段"
  fi
fi

echo "== 结论：verify rc=3 的有界重跑 pass=$PASS fail=$FAIL =="
[ "$FAIL" = 0 ] || exit 1
exit 0
