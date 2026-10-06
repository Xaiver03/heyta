#!/usr/bin/env bash
# `b-reinstall-readiness.sh` 第 7 条（载体新鲜度 = 打包输入面差集）的变异腿。
# 判据形状本轮改了（从"sha 是否相等"改成"输入面差集是否非空 + 算不出就 fail-closed"），
# 所以三个分支各问一次"恒成立"和"恒不成立"两种坏形状，六种坏法都得被某条腿抓住：
#   对照 —— 臂 3 四条腿全绿
#   A sha 恒相等（凡是载体都算新鲜）        ⇒ 腿 1、腿 2、腿 4 该红
#   B sha 恒不等（同提交也进差集分支）      ⇒ 只有腿 3 该红
#   C 差集判据恒成立（过严：只动文档也拦）  ⇒ 腿 1 该红（这条就是本轮改掉旧形状的理由）
#   F 差集判据恒不成立（过松：落后输入面读成同形）⇒ 腿 2 该红
#   D fail-closed 恒成立（凡是不同提交都算取不到）⇒ 腿 1、腿 2 该红
#   E 摘掉 fail-closed（算不出差异被当成没差异）  ⇒ 腿 4 该红
#   G 窗口恒「没开」（永久拒启）⇒ 只有臂 1b 抓得住（臂 1 对这种坏法完全无感）
#   H 体检失效（红着也照样执行）⇒ 臂 1 与臂 2 同时该红（两道门共用同一个 FAILS 判据）
# 🔴 变异一律在一次性副本上做（不改原件），末了比 md5 证明原件逐字节没动。
# 🔴 有坏读数时**保留副本与日志**（只看 tail 抓不到根因）：上一版无条件 rm，
#    两条臂的读数对不上时证据已经被删了，只能重跑一遍才知道差在哪。
# 退出码：0 = 九条读数都成立；4 = 有坏读数（装置坏，不是产品坏）。
set -u
MAIN="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
SRC="$MAIN/research/tools/b-reinstall-readiness.sh"
BASE_MD5=$(md5 -q "$SRC")
FAIL=0
say() { printf '%s\n' "$1"; }

mutate() { # $1=副本 $2=原文 $3=替换文
  python3 - "$1" "$2" "$3" <<'PY'
import io, sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8").read()
if s.count(old) != 1:
    sys.exit("ABORT: 变异点命中 %d（要 1）：%r" % (s.count(old), old))
io.open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
}
run() { # $1=脚本 $2=日志
  NO_COLOR=1 bash "$1" --selftest >"$2" 2>&1
  echo $?
}
red_count() { # $1=日志 $2=腿号
  local n
  n=$(grep -c "❌ 腿 $2" "$1" 2>/dev/null || true); printf '%s' "${n:-0}"
}

report() { # $1=臂名 $2=rc $3=日志  之后：$4..=「腿号:期望红条数」（0 = 该腿必须全绿）
  local name="$1" rc="$2" log="$3"; shift 3
  local bad=0 detail="" CR pair leg got
  CR=$(grep -c 'unbound variable' "$log" 2>/dev/null || true); CR=${CR:-0}
  for pair in "$@"; do
    leg=${pair%%:*}; want=${pair##*:}
    case "$leg" in
      臂1b) needle='❌ 臂 1b' ;;
      臂1)  needle='❌ 臂 1（' ;;
      臂2)  needle='❌ 负向腿' ;;
      *)    needle="❌ 腿 $leg" ;;
    esac
    got=$(grep -c "$needle" "$log" 2>/dev/null || true); got=${got:-0}
    detail="${detail} ${leg}红${got}/要${want}"
    if [ "$got" != "$want" ]; then bad=1; fi
  done
  if [ "$CR" != "0" ]; then
    say "  ❌ ${name}：内层撞了 set -u（unbound ${CR}）—— 那是装置炸，不是判据红"
    FAIL=1
  elif [ "$bad" = "0" ] && [ "$rc" = "0" ] && [ "$name" = "对照" ]; then
    say "  ✅ ${name}：rc=0$detail"
  elif [ "$bad" = "0" ] && [ "$rc" = "4" ]; then
    say "  ✅ ${name}：rc=4$detail"
  else
    say "  ❌ ${name}：rc=${rc}$detail —— 逐腿读数（从 $log 现取）："
    grep -E '[✅❌] 腿 [0-9]' "$log" | sed 's/^/      /'
    FAIL=1
  fi
}

# ── 对照 ──
CT=$(mktemp); cp "$SRC" "$CT"
RCC=$(run "$CT" /tmp/b-mut-control.out)
report "对照" "$RCC" /tmp/b-mut-control.out 1:0 2:0 3:0 4:0 臂1b:0 臂1:0 臂2:0

# ── A：sha 判据恒相等 ──
MA=$(mktemp); cp "$SRC" "$MA"
mutate "$MA" '  if [ "$CAR_SHA" = "$MAIN_SHA" ]; then' '  if [ -n "$CAR_SHA" ]; then'
RCA=$(run "$MA" /tmp/b-mut-a.out)
report "A（sha 恒相等＝凡是载体都算新鲜）" "$RCA" /tmp/b-mut-a.out 1:1 2:2 3:0 4:1 臂1b:0 臂1:0 臂2:0

# ── B：sha 恒不等（字面量，不碰 set -u）──
MB=$(mktemp); cp "$SRC" "$MB"
mutate "$MB" '  if [ "$CAR_SHA" = "$MAIN_SHA" ]; then' '  if [ "$CAR_SHA" = "MAIN_SHA_NEVER_MATCHES" ]; then'
RCB=$(run "$MB" /tmp/b-mut-b.out)
report "B（sha 恒不等＝同提交也进差集分支）" "$RCB" /tmp/b-mut-b.out 1:0 2:0 3:1 4:0 臂1b:0 臂1:0 臂2:0

# ── C：差集判据恒成立（过严）──
MC=$(mktemp); cp "$SRC" "$MC"
mutate "$MC" '    elif [ "$NDIFF" != "0" ]; then' '    elif [ "$NDIFF" != "999999" ]; then'
RCC2=$(run "$MC" /tmp/b-mut-c.out)
report "C（差集恒判红＝过严，只动文档也拦）" "$RCC2" /tmp/b-mut-c.out 1:2 2:0 3:0 4:0 臂1b:0 臂1:0 臂2:0

# ── F：差集判据恒不成立（过松）──
MF=$(mktemp); cp "$SRC" "$MF"
mutate "$MF" '    elif [ "$NDIFF" != "0" ]; then' '    elif [ "$NDIFF" != "$NDIFF" ]; then'
RCF=$(run "$MF" /tmp/b-mut-f.out)
report "F（差集恒不判红＝过松，落后输入面也读成同形）" "$RCF" /tmp/b-mut-f.out 1:0 2:2 3:0 4:0 臂1b:0 臂1:0 臂2:0

# ── D：fail-closed 恒成立 ──
MD=$(mktemp); cp "$SRC" "$MD"
mutate "$MD" '    if [ "$D_RC" != "0" ]; then' '    if [ "$D_RC" != "999999" ]; then'
RCD=$(run "$MD" /tmp/b-mut-d.out)
report "D（恒走 fail-closed＝凡是不同提交都算取不到）" "$RCD" /tmp/b-mut-d.out 1:2 2:1 3:0 4:0 臂1b:0 臂1:0 臂2:0

# ── E：fail-closed 被摘掉 ──
ME=$(mktemp); cp "$SRC" "$ME"
mutate "$ME" '    if [ "$D_RC" != "0" ]; then' '    if [ "0" != "0" ]; then'
RCE=$(run "$ME" /tmp/b-mut-e.out)
report "E（摘掉 fail-closed＝算不出差异被当成没差异）" "$RCE" /tmp/b-mut-e.out 1:0 2:0 3:0 4:1 臂1b:0 臂1:0 臂2:0

# ── G：窗口恒「没开」（永久拒启）── 臂 1 对这种坏法完全无感，只有臂 1b 抓得住
MG=$(mktemp); cp "$SRC" "$MG"
mutate "$MG" 'if [ "$FAILS" != "0" ]; then' 'if [ "$FAILS" != "999999" ]; then'
RCG=$(run "$MG" /tmp/b-mut-g.out)
report "G（永久拒启＝窗口永远算没开）" "$RCG" /tmp/b-mut-g.out 1:0 2:0 3:0 4:0 臂1b:1 臂1:0 臂2:0

# ── H：体检失效（红着也照样执行）── 臂 1b 无感，只有臂 1 抓得住
MH=$(mktemp); cp "$SRC" "$MH"
mutate "$MH" 'if [ "$FAILS" != "0" ]; then' 'if [ "0" != "0" ]; then'
RCH=$(run "$MH" /tmp/b-mut-h.out)
report "H（体检失效＝红着也照样执行）" "$RCH" /tmp/b-mut-h.out 1:0 2:0 3:0 4:0 臂1b:0 臂1:1 臂2:1

COPIES="$CT $MA $MB $MC $MF $MD $ME $MG $MH"
LOGS="/tmp/b-mut-control.out /tmp/b-mut-a.out /tmp/b-mut-b.out /tmp/b-mut-c.out /tmp/b-mut-f.out /tmp/b-mut-d.out /tmp/b-mut-e.out /tmp/b-mut-g.out /tmp/b-mut-h.out"
if [ "$FAIL" = "0" ]; then
  rm -f $COPIES $LOGS
else
  say "  ⚠️ 有坏读数 ⇒ 副本与日志都留着（不删证据）：$LOGS"
fi
NOW_MD5=$(md5 -q "$SRC")
if [ "$NOW_MD5" = "$BASE_MD5" ]; then
  say "  ✅ 原件逐字节未动（md5 ${BASE_MD5}）"
else
  say "  ❌ 原件被改动了（$BASE_MD5 → ${NOW_MD5}）"; FAIL=1
fi
[ "$FAIL" = "0" ] || exit 4
say "九条读数都成立（对照 + 八条变异臂：新鲜度三分支各问恒成立/恒不成立，拒启与执行两道门各问一次）"
exit 0
