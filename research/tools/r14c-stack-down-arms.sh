#!/bin/bash
# R14c 链的**栈收尾**（`stack_down`）的牙。
#
# 为什么需要这把 rig（21:44 现量的事故，不是设想）：
#   链只有 `stack_up`，**从来没有 `stack_down`** —— 而它自己的注释写着
#   "别留一枚没人知道的活进程"（打印了停它的命令，但那条命令一次都没被执行）。
#   三发窗口各留一枚活服务端在候选端口上（现量 pid 75311 / 77431 / 18909，
#   与 `/tmp/heyta-e2e-server.carrier.{73068,75095,17219}.pid` 一一对得上号），
#   第四发就在 `CHAIN_STOPPED_AT=port（候选 3100 3120 3140 3160 全被占）` 上烧掉。
#
# 形状：`stack_down` 从**真文件**按函数名抽本体来测（不复制第二份实现 —— 抄件一定会漂），
#   `scripts/mobile-e2e-down.sh` 用桩顶（桩把"被叫了几次"记进计数文件，这样
#   "STACK_UP=0 时不许动它"是一条**读数**而不是一句推断）。
#
# 退出码：0 = 全绿 / 1 = 有臂红（判据红，不是环境红）
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CHAIN="$ROOT/research/tools/r14c-carrier-chain.sh"
FIX=$(mktemp -d /tmp/ht-r14c-stackdown.XXXXXX)
trap 'rm -rf "$FIX"; kill $(jobs -p) 2>/dev/null' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "   ✅ $*"; }
bad() { FAIL=$((FAIL+1)); echo "   ❌ $*"; }

# ── 抽被测函数本体 ───────────────────────────────────────────────────────────
awk '/^stack_down\(\) \{/,/^\}$/' "$CHAIN" > "$FIX/fn.sh"
FN_LINES=$(grep -c . "$FIX/fn.sh")
if [ "$FN_LINES" -lt 8 ]; then
  bad "前提：从链里抽 stack_down 只抽到 ${FN_LINES} 行（抽成空文件时下面每条臂都会以"函数不存在"失败 —— 那长得像产品坏）"
  echo "== 合计 pass=$PASS fail=$FAIL =="; exit 1
fi
ok "前提：抽到 stack_down 本体 ${FN_LINES} 行（来自真文件，不是第二份实现）"

# 桩：计数 + 真杀 pidfile 里那枚（默认行为）；STUB_NOOP=1 时"成功退出而什么都没停"
mkdir -p "$FIX/scripts"
cat > "$FIX/scripts/mobile-e2e-down.sh" <<'EOF'
#!/bin/bash
echo x >> "$STUB_COUNT"
if [ "${STUB_NOOP:-0}" = 1 ]; then echo "   ⏭  没有 pidfile（假装没找到）"; exit 0; fi
P=$(cat "${HEYTA_E2E_PIDFILE:-/nonexistent}" 2>/dev/null)
[ -n "$P" ] && kill "$P" 2>/dev/null
exit 0
EOF

# 被测环境：LOG / PORT / E2E_PIDFILE / STACK_UP 由每条臂自己给
run_sd() {
  ( cd "$FIX"
    # shellcheck disable=SC1090
    source "$FIX/fn.sh"
    stack_down )
}

# 🔴 计数一律走 `wc -l`，不要 `grep -c . f || echo 0`：空文件时 grep 既打印 0 **又**退出 1，
#    于是 `||` 那一支再补一个 0，读数是 "0\n0" —— B 臂第一跑就是这么红的（夹具坏，不是判据坏）。
count_of() { wc -l < "$1" 2>/dev/null | tr -d '[:space:]'; }

# ── 臂 A：STACK_UP=1 且有一枚活进程 + pidfile ⇒ 桩被叫到、进程真没了 ─────────
sleep 300 & LIVE=$!
printf '%s' "$LIVE" > "$FIX/a.pid"
: > "$FIX/a.count"; export STUB_COUNT="$FIX/a.count"
LOG="$FIX/a.log" PORT=1 STACK_UP=1 E2E_PIDFILE="$FIX/a.pid" run_sd > /dev/null 2>&1
A_CALLED=$(count_of "$FIX/a.count")
kill -0 "$LIVE" 2>/dev/null && A_ALIVE=yes || A_ALIVE=no
grep -q 'STEP stack_down rc=' "$FIX/a.log" && A_STEP=yes || A_STEP=no
if [ "$A_CALLED" = 1 ] && [ "$A_ALIVE" = no ] && [ "$A_STEP" = yes ]; then
  ok "A 正常收尾：down 被叫 1 次、pid $LIVE 真没了、日志有 STEP stack_down"
else
  bad "A 收尾没做到（called=${A_CALLED} alive=${A_ALIVE} step=${A_STEP}）"
fi

# ── 臂 B：STACK_UP=0 ⇒ 一道都不许动（幂等闸门；没起过栈的退出路径不该去停别人的）
: > "$FIX/b.count"; export STUB_COUNT="$FIX/b.count"
LOG="$FIX/b.log" PORT=1 STACK_UP=0 E2E_PIDFILE="$FIX/b.pid" run_sd > /dev/null 2>&1
B_CALLED=$(count_of "$FIX/b.count")
B_LOG=$( [ -s "$FIX/b.log" ] && echo nonempty || echo empty )
if [ "$B_CALLED" = 0 ] && [ "$B_LOG" = empty ]; then
  ok "B 幂等闸门：STACK_UP=0 时 down 一次都没被叫、日志一个字没写"
else
  bad "B 幂等闸门坏了（called=${B_CALLED} log=${B_LOG} ⇒ 没起过栈也在动端口/pidfile）"
fi

# ── 臂 C：down 脚本"退 0 而什么都没停" + 端口上确实还有人听 ⇒ 必须报 still-listening
python3 -m http.server 8641 --bind 127.0.0.1 > /dev/null 2>&1 &
LISTEN=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  lsof -nP -iTCP:8641 -sTCP:LISTEN -t >/dev/null 2>&1 && break; sleep 0.5
done
printf '%s' "$LISTEN" > "$FIX/c.pid"
: > "$FIX/c.count"; export STUB_COUNT="$FIX/c.count"
# 🔴 必须 **export**：桩是**子进程**，而"函数调用前缀赋值"只进当前 shell 的作用域、不进环境 ——
#    写成 `STUB_NOOP=1 run_sd` 时桩读不到它，会真的把那枚 listener 杀掉，
#    于是这一臂量的是"端口空了"而不是"后置断言能认出假绿"（= 无条件绿，没有牙）。
export STUB_NOOP=1
LOG="$FIX/c.log" PORT=8641 STACK_UP=1 E2E_PIDFILE="$FIX/c.pid" run_sd > /dev/null 2>&1
unset STUB_NOOP
if grep -q 'STACK_DOWN=still-listening' "$FIX/c.log" && grep -q "pid=${LISTEN}" "$FIX/c.log"; then
  ok "C 后置断言有牙：桩假绿（rc=0 没停东西）而 :8641 仍被 pid ${LISTEN} 听着 ⇒ 点名 still-listening"
else
  bad "C 后置断言没牙（日志：$(tr '\n' '|' < "$FIX/c.log" 2>/dev/null | cut -c1-90)）"
fi
kill "$LISTEN" 2>/dev/null; wait "$LISTEN" 2>/dev/null

# ── 臂 D：静态不变量 —— 两道 trap 都挂着 stack_down，且它在 restore_carrier **之前**
D_TRAP=$(grep -c "trap 'stack_down; restore_carrier' EXIT" "$CHAIN")
D_TERM=$(grep -c "trap 'stack_down; restore_carrier;" "$CHAIN")
if [ "$D_TRAP" = 1 ] && [ "$D_TERM" = 1 ]; then
  ok "D 退出路径：EXIT 与 TERM/INT 两道 trap 都以 stack_down 开头（顺序=先停栈再还原，down 自己在覆盖清单里）"
else
  bad "D 退出路径缺臂（EXIT=${D_TRAP} TERM=${D_TERM}，各应为 1）"
fi

# ── 臂 E：STACK_UP=1 必须排在 `run stack_up` **之前**（排晚了 = 半途失败那条路上没收尾）
LU=$(grep -n '^run stack_up ' "$CHAIN" | head -1 | cut -d: -f1)
SU=$(grep -n '^STACK_UP=1' "$CHAIN" | head -1 | cut -d: -f1)
if [ -n "$LU" ] && [ -n "$SU" ] && [ "$SU" -lt "$LU" ]; then
  ok "E 顺序不变量：STACK_UP=1 在第 ${SU} 行，早于 run stack_up（第 ${LU} 行）"
else
  bad "E 顺序不变量坏了（STACK_UP=1@${SU:-无} vs run stack_up@${LU:-无}）"
fi

# ── 臂 F：变异 —— 把 EXIT trap 里的 stack_down 摘掉，D 那一格必须转红（证明 D 有牙）
cp "$CHAIN" "$FIX/chain.mut.sh"
python3 - "$FIX/chain.mut.sh" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old="trap 'stack_down; restore_carrier' EXIT"
assert s.count(old)==1, "变异未命中唯一一处"
open(p,'w').write(s.replace(old,"trap 'restore_carrier' EXIT"))
PY
M_TRAP=$(grep -c "trap 'stack_down; restore_carrier' EXIT" "$FIX/chain.mut.sh")
if [ "$M_TRAP" = 0 ]; then
  ok "F 变异对照：摘掉 EXIT 里的 stack_down 后 D 的正读数从 1 变 ${M_TRAP} ⇒ D 真的在数这一件事"
else
  bad "F 变异没生效（仍为 ${M_TRAP}）⇒ 这一格是装饰"
fi

echo "== 结论：stack_down 的三条行为腿 + 两条静态不变量 + 一发变异 pass=$PASS fail=$FAIL =="
[ "$FAIL" = 0 ] || exit 1
exit 0
