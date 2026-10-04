#!/bin/bash
# `ask_gate()` 的"负载红给一次落位机会"这条腿的牙（21:49 现量之后加的）。
#
# 现量事故：一发难得开窗的窗口（21:49:47）被链自己刚打的 build 抬起来的负载挡回 ——
#   `REGATE who=pre try=1/2/3 rc=3 REDS=load` 三次用尽 ⇒ `CHAIN_STOPPED_AT=regate`（**没动设备**，
#   判据行为是对的），但整发窗口作废。当时同分钟 `loadavg 16.7 20.8 33.4 / 16 核`
#   （15 分钟均值 33 ⇒ 这台机被打了很久，不是"我刚打完"那一下）。
# 旧形状 `REGATE_TRIES=3` 把"等多久"写成了"等几次"，而那个 3 **不是从被约束的量推出来的**（§8.3）。
# 新形状：按**时间预算**界（`REGATE_LOAD_DEADLINE`，默认 420s），次数只当防死循环的绝对上限。
#
# 退出码：0 = 全绿 / 1 = 有臂红
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CHAIN="$ROOT/research/tools/r14c-carrier-chain.sh"
FIX=$(mktemp -d /tmp/ht-r14c-regate.XXXXXX)
trap 'rm -rf "$FIX"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "   ✅ $*"; }
bad() { FAIL=$((FAIL+1)); echo "   ❌ $*"; }

# 被测函数本体从真文件抽（不复制第二份实现）
awk '/^ask_gate\(\) \{/,/^\}$/' "$CHAIN" > "$FIX/fn.sh"
[ "$(grep -c . "$FIX/fn.sh")" -ge 12 ] || { bad "前提：抽 ask_gate 只抽到 $(grep -c . "$FIX/fn.sh") 行"; exit 1; }
ok "前提：抽到 ask_gate 本体 $(grep -c . "$FIX/fn.sh") 行"

# 桩闸门：按 ${GATE_SEQ} 逐次调用返回的 `rc:REDS` 序列回话，并记调用次数
mkdir -p "$FIX/scripts"
cat > "$FIX/scripts/verify-mobile-window-gate.sh" <<'EOF'
#!/bin/bash
echo call >> "$GATE_COUNT"
N=$(grep -c . "$GATE_COUNT")
LINE=$(sed -n "${N}p" "$GATE_SEQ")
# 🔴 序列用完就**重复最后一答**：不补这一行时第 N+1 次调用 `sed -n "4p"` 回空串，
#    桩于是 `exit ""` 而以 **255** 退出 —— 臂 C 会把那枚 255 读成"闸门回了个非 3 的码"，
#    看起来像等位逻辑坏了，其实是**脚本桩自己断了电**（夹具坏 ≠ 判据坏，先分这一层）。
[ -n "$LINE" ] || LINE=$(tail -1 "$GATE_SEQ")
RC=${LINE%%:*}; REDS=${LINE#*:}
if [ "$REDS" != "-" ]; then echo "REDS=${REDS}"; fi
echo "   窗口判定（桩）"
exit "$RC"
EOF

# 跑一次 ask_gate：$1 = 序列文件内容（每行 `rc:REDS`）
# 🔴 **必须把日志一起回显**：ask_gate 的判决写在 $LOG 里而不是 stdout，
#    所以"只回显 RET="时，臂 C 的正读数量不到东西，而臂 D/E 那两条**负**读数
#    （"不许出现 load-only 行"）**无条件成立** —— 负向断言测错了载体 = 自证（本仓记过这一族）。
#    每次先清空日志，否则上一臂的行会漂到下一臂的读数里。
run_gate() {
  ( cd "$FIX"
    : > "$FIX/count"
    : > "$FIX/log"
    printf '%s\n' "$1" > "$FIX/seq"
    # shellcheck disable=SC2046
    LOG="$FIX/log" GATE_COUNT="$FIX/count" GATE_SEQ="$FIX/seq" \
    CARRIER="$FIX" REGATE_SETTLE=0 REGATE_TRIES="${T:-3}" REGATE_LOAD_DEADLINE="${D:-420}" \
    bash -c 'source "$PWD/fn.sh"; ask_gate pre; echo "RET=$?"'
    echo "LOG::$(tr '\n' '|' < "$FIX/log" 2>/dev/null)" )
}

S1=$(run_gate "0:-")
[ "$(printf '%s' "$S1" | grep -c 'RET=0')" = 1 ] && \
  [ "$(printf '%s' "$S1" | grep -c '^call$')" = 0 ] && ok "A 窗口开着：返回 0（一次即止，不进入等待）" \
  || bad "A 坏了：$(printf '%s' "$S1" | tr '\n' '|' | cut -c1-90)"

S2=$(run_gate "3:load
3:load
0:-")
N2=$(printf '%s' "$S2" | grep -c 'RET=0')
if [ "$N2" = 1 ]; then ok "B 负载红能等：load,load,open ⇒ 最终返回 0（用了 3 次问）"; else bad "B 坏了（RET 行=$(printf '%s' "$S2" | tr '\n' '|' | cut -c1-90)）"; fi

S3=$(run_gate "3:load")
if printf '%s' "$S3" | grep -q 'RET=3' && printf '%s' "$S3" | grep -q 'REGATE=load-only'; then
  ok "C 恒负载红：预算内用尽后**返回 3**（不动设备），且 load-only 那行带'已等 Ns / 预算 M'"
else bad "C 坏了：$(printf '%s' "$S3" | tr '\n' '|' | cut -c1-90)"; fi

S4=$(run_gate "3:dev")
if printf '%s' "$S4" | grep -q 'RET=3' && ! printf '%s' "$S4" | grep -q 'REGATE=load-only'; then
  ok "D 非负载红当场停：REDS=dev 一次都不许再问（这条腿只给 load 开）"
else bad "D 坏了：dev 那形进了等待支 ⇒ $(printf '%s' "$S4" | tr '\n' '|' | cut -c1-90)"; fi

S5=$(run_gate "3:-")
if printf '%s' "$S5" | grep -q 'RET=3' && ! printf '%s' "$S5" | grep -q 'REGATE=load-only'; then
  ok "E REDS 行缺失（闸门版本不对/装置坏）⇒ 当场停，不当成'再等等看'"
else bad "E 坏了：$(printf '%s' "$S5" | tr '\n' '|' | cut -c1-90)"; fi

# F1 正对照：**预算为 0** 时同一串序列必须立刻停（否则 F2 的"摘掉条件"就没有可比对象）
S6=$(D=0 run_gate "3:load
3:load
0:-")
if printf '%s' "$S6" | grep -q 'RET=3'; then
  ok "F1 预算界的正对照：D=0 且序列是 load,load,open ⇒ 第一次问完就返回 3（预算已尽，不再问）"
else bad "F1 坏了：$(printf '%s' "$S6" | tr '\n' '|' | cut -c1-90)"; fi

# F2 变异：把时间预算那一枚条件**整枚删掉** ⇒ 同一串输入必须塌成"照等到开"（RET=0）。
#    ⚠️ 第一版这里用 awk 的 sub() 去删，结果**两份逐字节相同**（模式没命中而 awk 不报错），
#    那一臂于是"绿"得毫无内容 —— 换成 python 的字面替换 + **命中数断言 == 1**（本仓那条老规矩）。
python3 - "$FIX/fn.sh" "$FIX/fn.mut.sh" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
needle = '&& [ $(( $(date +%s) - gstart )) -lt "$REGATE_LOAD_DEADLINE" ] '
assert s.count(needle) == 1, "变异 needle 命中 %d 次（应为 1）" % s.count(needle)
open(dst, 'w').write(s.replace(needle, '', 1))
PY
if cmp -s "$FIX/fn.sh" "$FIX/fn.mut.sh"; then
  bad "F2 变异没生效（两份逐字节相同 ⇒ 这一臂不携带任何信息）"
else
  FM=$( cd "$FIX" && : > "$FIX/count2" && printf '3:load\n3:load\n0:-\n' > "$FIX/seq2" && \
    LOG="$FIX/log2" GATE_COUNT="$FIX/count2" GATE_SEQ="$FIX/seq2" CARRIER="$FIX" \
    REGATE_SETTLE=0 REGATE_TRIES=3 REGATE_LOAD_DEADLINE=0 \
    bash -c 'source "$PWD/fn.mut.sh"; ask_gate pre; echo "RET=$?"' )
  if printf '%s' "$FM" | grep -q 'RET=0'; then
    ok "F2 变异对照：摘掉时间预算那一枚条件 ⇒ 同一串输入从 RET=3 翻成 RET=0（那一枚条件确实在驱动「停」）"
  else bad "F2 变异后仍 RET=3 ⇒ 时间预算那半没有牙：$(printf '%s' "$FM" | tr '\n' '|' | cut -c1-80)"; fi
fi

# G 静态不变量：默认值必须排在 ask_gate 定义之前（set -u 下用到未定义 = 整条链崩在第一次重问）
DL=$(grep -n '^REGATE_LOAD_DEADLINE=' "$CHAIN" | head -1 | cut -d: -f1)
AG=$(grep -n '^ask_gate() {' "$CHAIN" | head -1 | cut -d: -f1)
if [ -n "$DL" ] && [ -n "$AG" ] && [ "$DL" -lt "$AG" ]; then
  ok "G 顺序不变量：REGATE_LOAD_DEADLINE 默认值在第 ${DL} 行，早于 ask_gate（第 ${AG} 行）"
else bad "G 顺序不变量坏了（deadline@${DL:-无} vs ask_gate@${AG:-无}）"; fi

echo "== 结论：ask_gate 的负载落位腿（含非负载红不当等）+ 变异 + 顺序不变量 pass=$PASS fail=$FAIL =="
[ "$FAIL" = 0 ] || exit 1
exit 0
