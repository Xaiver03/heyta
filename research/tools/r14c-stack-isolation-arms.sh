#!/usr/bin/env bash
# `r14c-carrier-chain.sh` 里那格 **stack_isolation 后置断言** 的牙（四臂）。
#
# 🔴 为什么要单独一把 rig：这一格是 17:5x 被**现场**照出来的，不是设计出来的 ——
#    链给 `scripts/mobile-e2e-up.sh` 传了新旋钮 `HEYTA_E2E_PIDFILE/LOGFILE`，
#    而载体跑的是**已提交副本**（现量：载体那份 `PIDFILE=` 写死在 `:46`）⇒ 旋钮被静默忽略，
#    那一趟起栈照样覆盖了跨树共享的 `/tmp/heyta-e2e-server.{pid,log}`
#    （pidfile 从死 pid 95105 变成我的 34466，共享日志被我的启动输出续写）。
#    "传了参数"与"接住参数的代码被跑了"是两件事，而后者没有任何门禁会红 ——
#    所以这一格必须能红，且要红在**对的读数**上。
#
# 四臂（都不起服务端、不动设备；用一个自造的监听者 + 两枚假 pidfile 把这段纯逻辑量出来）：
#   A 正：pidfile 里的 pid **就是**那枚监听者 ⇒ 期望 STACK_ISOLATION_OK、本臂 rc=0
#   B    pidfile 里是一枚**不存在**的 pid（监听者活着）⇒ 期望 sentinel + rc=1
#   C    pidfile **不存在** ⇒ 期望 sentinel + rc=1（"没记下"不等于"隔离住了"）
#   D 🔴 pidfile 里是一枚**活着但不是监听者**的 pid ⇒ 期望 sentinel + rc=1
#        （这一臂才分得开"只判 pidfile 存在"和"判它就是那个端口的主人"；
#         少了它，B/C 两臂用"文件在不在"一个条件就能同时糊过去）
#
# 抽原文跑，不重抄（本线既有约定：重抄一份就变成臂在测臂自己抄的那份）。
# 用法：bash research/tools/r14c-stack-isolation-arms.sh
# 退出码：0 = 四臂如预期；1 = 某一臂不按预期（= 装置或那段判据坏了，不是仓库坏了）
set -u
cd "$(dirname "$0")/../.." || exit 1
CHAIN="${CHAIN_OVERRIDE:-research/tools/r14c-carrier-chain.sh}"
[ -f "$CHAIN" ] || { echo "❌ 找不到被测脚本：$CHAIN"; exit 1; }

B=$(grep -n '^ISO_PID=""' "$CHAIN" | head -1 | cut -d: -f1)
E=$(grep -n '^echo "STACK_ISOLATION_OK' "$CHAIN" | head -1 | cut -d: -f1)
# 🔴 抽不到就**响亮退出**，不许"跳过这一臂还照样打印通过"（traps #191 那一族）。
[ -n "$B" ] && [ -n "$E" ] || { echo "❌ 锚点没找到（B=${B:-空} E=${E:-空}）⇒ 链里那段改了形状，本装置先失效而不是恒绿"; exit 1; }
BLOCK=$(sed -n "${B},${E}p" "$CHAIN")
[ -n "$BLOCK" ] || { echo "❌ 锚点找到了但抽出来是空的（B=${B} E=${E}）"; exit 1; }
echo "抽原文：${CHAIN}:${B}-${E}（$(printf '%s\n' "$BLOCK" | grep -c .) 行）"

T=$(mktemp -d /tmp/r14c-isolation.XXXXXX)
PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); printf '✅ %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '❌ %s\n' "$1"; }

# 挑一枚空端口，用 python 起一个**只在本 rig 生命周期内**的监听者
PPORT=""
for c in 3901 3911 3921 3931 3941; do
  lsof -nP -iTCP:"$c" -sTCP:LISTEN -t >/dev/null 2>&1 || { PPORT="$c"; break; }
done
[ -n "$PPORT" ] || { echo "❌ 候选端口全被占，本 rig 不硬抢（换了再跑）"; exit 1; }
python3 -c "import socket,time,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
s.bind(('127.0.0.1', int(sys.argv[1]))); s.listen(5)
print('LISTEN_READY', flush=True); time.sleep(120)" "$PPORT" > "$T/lister.out" 2>&1 &
LISTER=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do grep -q LISTEN_READY "$T/lister.out" 2>/dev/null && break; sleep 0.5; done
# 🔴 前提断言：监听者没起来就别往下跑 —— 否则四臂读的是同一个空集，看起来"全都不如预期"，
#    而那既不是这段判据的功劳也不是它的失败。
LISTEN_PID=$(lsof -nP -iTCP:"$PPORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
[ -n "$LISTEN_PID" ] || { echo "❌ 前提不成立：:${PPORT} 上没有监听者（自造的 python 没起）⇒ 四臂全部作废"; kill "$LISTER" 2>/dev/null; rm -rf "$T"; exit 1; }
echo "夹具监听者：:${PPORT} → pid ${LISTEN_PID}"

# 一枚活着、但**不监听**那个端口的 pid（D 臂用）
sleep 120 > /dev/null 2>&1 &
SLEEP_PID=$!

cleanup() {
  kill "$LISTER" "$SLEEP_PID" 2>/dev/null
  # 🔴 收掉之后必须 `wait` 把它们**收割**，否则作业结束报告会在脚本**外面**打出来（18:0x 现量：
  #    rig rc=0、四臂全绿，尾巴上却挂两行 `Terminated: 15` —— 读日志的人会当成某一臂挂了）。
  wait "$LISTER" 2>/dev/null
  wait "$SLEEP_PID" 2>/dev/null
  rm -rf "$T"
}
trap cleanup EXIT

# run_case <臂名> <pidfile 内容|"ABSENT">  —— 把抽出来的那段当独立脚本跑
run_case() {
  local name="$1" content="$2"
  : > "$T/$name.log"
  if [ "$content" = "ABSENT" ]; then rm -f "$T/$name.pid"; else printf '%s\n' "$content" > "$T/$name.pid"; fi
  cat > "$T/$name.sh" <<CASE_EOF
set -u
PORT="$PPORT"
E2E_PIDFILE="$T/$name.pid"
LOG="$T/$name.log"
$BLOCK
echo REACHED_END
CASE_EOF
  bash "$T/$name.sh" > "$T/$name.out" 2>&1
  printf '%s' "$?"
}

# ---------------------------------------------------------------- 臂 A
RC=$(run_case A "$LISTEN_PID")
A_LOG=$(cat "$T/A.log" 2>/dev/null)
if [ "$RC" = "0" ] && printf '%s' "$A_LOG" | grep -q 'STACK_ISOLATION_OK' \
   && ! printf '%s' "$A_LOG" | grep -q 'CHAIN_STOPPED_AT'; then
  ok "臂 A 正向：pidfile 里的 pid 就是 :${PPORT} 的监听者 ⇒ STACK_ISOLATION_OK、rc=0"
else
  bad "臂 A 不如预期：rc=$RC 日志=$(printf '%s\n' "$A_LOG" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------- 臂 B
RC=$(run_case B 999999)
B_LOG=$(cat "$T/B.log" 2>/dev/null)
if [ "$RC" = "1" ] && printf '%s' "$B_LOG" | grep -q 'CHAIN_STOPPED_AT=stack_isolation' \
   && printf '%s' "$B_LOG" | grep -q 'pid=999999'; then
  ok "臂 B：pidfile 里是不存在的 pid ⇒ 以 rc=1 停在哨兵上，且读数里带着那枚 pid（不是含糊的「失败了」）"
else
  bad "臂 B 不如预期：rc=$RC 日志=$(printf '%s\n' "$B_LOG" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------- 臂 C
RC=$(run_case C ABSENT)
C_LOG=$(cat "$T/C.log" 2>/dev/null)
if [ "$RC" = "1" ] && printf '%s' "$C_LOG" | grep -q 'CHAIN_STOPPED_AT=stack_isolation' \
   && printf '%s' "$C_LOG" | grep -q 'pid=〈空〉'; then
  ok "臂 C：pidfile 根本不在 ⇒ 同样停在哨兵上（「没记下」不等于「隔离住了」）"
else
  bad "臂 C 不如预期：rc=$RC 日志=$(printf '%s\n' "$C_LOG" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------- 臂 D
RC=$(run_case D "$SLEEP_PID")
D_LOG=$(cat "$T/D.log" 2>/dev/null)
if [ "$RC" = "1" ] && printf '%s' "$D_LOG" | grep -q 'CHAIN_STOPPED_AT=stack_isolation'; then
  ok "臂 D 🔴 关键一臂：pidfile 里是**活着但不是监听者**的 pid ${SLEEP_PID}（监听者是 ${LISTEN_PID}）⇒ 仍然停住 —— 只判「文件在不在」糊不过这一臂"
else
  bad "臂 D 不如预期 ⇒ 这段可能只判了「pidfile 存在 / pid 活着」，没判「它就是那个端口的主人」：rc=$RC 日志=$(printf '%s\n' "$D_LOG" | tr '\n' ' ')"
fi

echo "== 合计 pass=$PASS fail=$FAIL =="
[ "$FAIL" = 0 ] || exit 1
exit 0
