# 用途：批次 E（回收站/注销/销毁）那 ② 格里，被 `&&` 短路挡掉、一次没执行过的**具名门禁**，
# 在隔离载体里逐条取第一次读数。
#
# 为什么逐条而不是再跑整链：上一趟（§10.198/§10.199）第 34/86 段红 ⇒ 后面 52 段**包括目标点名的
# landing-e2e / ai-e2e / 四枚壳类**一次没跑。整链再跑一遍，任何一段红就又全盲 ——
# 那是把"装置盲"复制第二次。这里每段独立 rc 落盘，红不吞掉别人。
#
# 🔴 前提按**道**分，不按整趟分：壳类八段只有负载门；两枚 e2e 才有负载+端口+同侪三门。
#    （第一版把三门套到全部十段 ⇒ 别人占 3000 时白挡八格，这是装置自己的形状错。）
# 🔴 缺前提就写"这一道没有读数"，绝不降级成"跳过=通过"、也绝不折算成 n/10：
#   1. 负载门（阈值取自仓库自己那道 wait-for-quiet-host.sh 的 12，不是我新发明的数）
#   2. 端口门：check:ai-e2e / check:landing-e2e 的 e2e 前置会 **SIGKILL** 5173/3000 上的
#      别人进程（traps #87，已在共享台账）。所以端口非空 = 不起跑，而不是"先杀了再说"。
#   3. 同侪门：已有别的会话在跑同一批 check:*/reinstall-all 时不并行抢（AGENTS §8.9）。
#
# 载体不重建：沿用 §10.198 那只（`heyta-wt-tfa-e2` @ e372a3f0 + 19:34 的未提交叠层），
# 只把我改过的那一枚共享契约文件**增量搬过去**并 md5 对账；
# 同时打印载体与主检出的未提交差集 —— 那是这一趟读数的**归属边界**，不是噪声。
#
# 不碰设备、不碰 reinstall:all（那一格要两台设备面同时空，见 §10.156/#104）。
# 退出码：0=全部拿到读数（可以有红，红是产品结论）／3=前提没成立、没有读数／非 0 其它=装置自己坏了。
set -uo pipefail

REPO="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
CARRIER="$REPO/../heyta-wt-tfa-e2"
CARRIER="$(cd "$CARRIER" 2>/dev/null && pwd || echo '')"
LOAD_MAX="${LOAD_MAX:-12}"
CAP_ROUNDS="${CAP_ROUNDS:-150}"          # 150 × 40s = 100 min 上限
# 🔴 端口按**门禁自己声明的**取，不是我猜的（上一版写 5173/3000 是错的：
# 那两枚是 Vite/Next 的默认端口，而这两个套件的 webServer 用的是 4320 / 4318+4319，
# 前置脚本 `scripts/check-ai-e2e-preflight.mjs` 里 `DEFAULT_PORTS = [4318, 4319]`、
# `playwright.landing.config.ts` 里 `const PORT = 4320`。
# ⇒ 上一轮那一小时排的是**不相干的端口**，而真正的门（仓库的内存闸门锁）压根没检查。
LOCK=/tmp/tfa-test.lock
LANDING_PORTS=(4320)
AI_PORTS=(4318 4319)
# 🔴 两道门，别拧在一起（第一版的形状错，记在计划 §10.201）：
# 八段壳类**不碰** 5173/3000，把它们和两枚 e2e 共用一条端口门 = 让别人占着的 3000 白挡八格。
GATES_LOAD=(check:macos-shell check:macos-window check:windows-shell check:linux-shell
            check:shell-surfaces check:shell-unicode check:shell-exit-chain check:shell-erasure-parity)
GATES_E2E=(check:landing-e2e check:ai-e2e)
MINE=(packages/storage/tests/contract/adapter.contract.ts research/tools/mutation-rigs/e2-remaining-gates.sh apps/node-host/tests/cli-account.spec.ts apps/web/src/features/settings/CloseAccountPanel.tsx apps/web/tests/close-account-pending.spec.tsx)
TS="$(date +%H%M%S)"
EV="$HOME/.heyta-evidence/tfa-e2-remaining-$TS"
LOG="$REPO/tmp/e2-remaining-gates-$TS.log"
mkdir -p "$EV"

say() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }

[ -n "$CARRIER" ] && [ -d "$CARRIER/node_modules" ] || { say "BLOCKED reason=载体不在或没装依赖（${CARRIER}）"; exit 3; }
[ -d "$REPO/tmp" ] || { say "BLOCKED reason=主检出 tmp 不存在，日志无处落"; exit 3; }

# 端口上有没有监听 —— 只要 LISTEN 就算占，不看是谁（归属查不出来时保守）
port_busy() {          # 用法：port_busy "4320 4318"（空格分隔）
  local busy="" p n
  for p in $1; do
    n=$(lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
    [ "${n:-0}" -gt 0 ] && busy="$busy $p=$n"
  done
  printf '%s' "${busy# }"
}
lock_busy() {          # 仓库的内存闸门：锁在就是有人在跑测试，**不绕过、不 kill**
  [ -e "$LOCK" ] || return 0
  local holder; holder=$(head -c 200 "$LOCK" 2>/dev/null | tr '\n' ' ')
  printf '%s' "${holder:-$LOCK}"
}

peers_busy() {
  ps Axo command 2>/dev/null | grep -E 'check:ai-e2e|check:landing-e2e|reinstall-all|cli\.js test|playwright test' | grep -v grep | wc -l | tr -d ' '
}

wait_load() {          # 只要负载门：壳类八段用这条
  local i=0 LOAD
  while [ "$i" -lt "$CAP_ROUNDS" ]; do
    i=$((i+1))
    LOAD=$(sysctl -n vm.loadavg | awk '{print $2}')
    if awk -v l="$LOAD" -v m="$LOAD_MAX" 'BEGIN{exit !(l<=m)}'; then say "负载窗开：load=$LOAD"; return 0; fi
    say "负载 $LOAD > ${LOAD_MAX}，继续等"; sleep 30
  done
  return 1
}
wait_gate() {          # 用法：wait_gate <名字> "<该门禁自己的端口串>"
  local name="$1" ports="$2" i=0 LOAD PB LB PEER
  while [ "$i" -lt "$CAP_ROUNDS" ]; do
    i=$((i+1))
    LB=$(lock_busy)
    if [ -n "$LB" ]; then say "$name 等内存闸门：${LB}（不绕过、不 kill）"; sleep 40; continue; fi
    PB=$(port_busy "$ports")
    if [ -n "$PB" ]; then say "$name 等端口：$PB"; sleep 40; continue; fi
    PEER=$(peers_busy)
    if [ "${PEER:-0}" -gt 0 ]; then say "$name 等同侪（$PEER 条验收在跑）"; sleep 40; continue; fi
    LOAD=$(sysctl -n vm.loadavg | awk '{print $2}')
    if awk -v l="$LOAD" -v m="$LOAD_MAX" 'BEGIN{exit !(l<=m)}'; then say "$name 窗开：load=$LOAD"; return 0; fi
    say "$name 等负载：$LOAD > $LOAD_MAX"; sleep 40
  done
  return 1
}
run_lane() {           # 逐段独立 rc + "真跑过"前提腿；一处红不吞掉后面的段
  # 🔴 本机 /bin/bash 是 3.2.57 ⇒ **不能用 `local -n`（nameref 是 4.3+）**。
  #    第一版写了 nameref，语法过了、真跑会当场 `unsupported option`，
  #    而那种红会被读成"门禁红"——装置坏在产品结论前面，正是要防的那一档。
  #    改成把段名当位置参数传进来（3.2 支持，且空数组在 nounset 下的坑与此无关：这里传的是非空串）。
  local g out rc ran
  while [ $# -gt 0 ]; do
    g="$1"; shift
    out="$EV/${g//:/-}.log"
    ( cd "$CARRIER" && NO_COLOR=1 pnpm -s "$g" >"$out" 2>&1 )
    rc=$?
    ran=NO; [ -s "$out" ] && ran=YES
    printf 'GATE %s rc=%s ran=%s bytes=%s\n' "$g" "$rc" "$ran" "$(wc -c <"$out" | tr -d ' ')" | tee -a "$LOG" >> "$EV/rc.txt"
    if [ "$rc" -ne 0 ]; then
      grep -m3 -E '✗|FAIL|rror' "$out" | sed 's/^/    /' | tee -a "$LOG"
    fi
  done
}

say "CARRIER_HEAD=$(git -C "$CARRIER" rev-parse --short HEAD)"
say "MAIN_HEAD=$(git -C "$REPO" rev-parse --short HEAD)"
for f in "${MINE[@]}"; do
  cp "$REPO/$f" "$CARRIER/$f"
  a=$(md5 -q "$REPO/$f"); b=$(md5 -q "$CARRIER/$f")
  [ "$a" = "$b" ] && say "SYNC_OK $f" || say "SYNC_FAIL ${f}（$a vs ${b}）"
done

# SKIP_LOAD=1：壳类那道已经闭合（§10.206 八枚 rc=0），别再为了重取读数
# 把负载压到正在跑 e2e 的那条线上（AGENTS §8.9 的重负载串行）。
if [ "${SKIP_LOAD:-0}" = 1 ]; then
  # 🔴 主动跳过要印成 SKIPPED，**不许**落到 else 里印成 EXPIRED（"没有读数"）：
  #    上一版 `SKIP_LOAD=1` 走的就是 else，于是那道明明已闭合（§10.206 八枚 rc=0）的读数
  #    被记成 EXPIRED —— 一个状态被映射成另一个状态，正是 traps #301/#307 那一族。
  say "LANE_LOAD=SKIPPED（这道已闭合，SKIP_LOAD=1 是为了不把负载压到正在跑 e2e 的那条线）"
  printf 'LANE_LOAD=SKIPPED\n' >> "$EV/rc.txt"
elif wait_load; then
  printf 'LANE_LOAD=OPEN\n' >> "$EV/rc.txt"; run_lane "${GATES_LOAD[@]}"
else
  say "LANE_LOAD=EXPIRED rounds=$CAP_ROUNDS —— 这八段**没有读数**，不许记成 n/8"
  printf 'LANE_LOAD=EXPIRED\n' >> "$EV/rc.txt"
fi

# 🔴 起跑前先自证"我要调的函数真的存在"：上一版 `wait_gate` 的定义没替换上，
# 于是 `if wait_gate …` 直接 command-not-found 走 else，
# rc.txt 里落下两句看着完全权威的 `LANE_*=EXPIRED` —— 装置坏了冒充前提未成立，读数差一点就被我抄进台账。
for fn in wait_gate wait_load run_lane port_busy lock_busy peers_busy say; do
  if ! typeset -f "$fn" >/dev/null 2>&1; then
    say "RIG_BROKEN reason=函数 $fn 没定义（这一趟没有任何读数，别把后面任何行当读数）"
    printf 'RIG_BROKEN=%s\n' "$fn" >> "$EV/rc.txt"; exit 4
  fi
done

# 两道 e2e 各自按自己的前提排队：landing 只要 4320，ai 要 4318/4319。
# 合成一道的话，别人占着 4318 就会把 landing 也一起挡死（同一类过宽门）。
if [ "${SKIP_LANDING:-0}" = 1 ]; then
  say "LANE_LANDING=SKIPPED（§10.210 已闭合，重跑只为了整链）"
  printf 'LANE_LANDING=SKIPPED\n' >> "$EV/rc.txt"
elif wait_gate landing "${LANDING_PORTS[*]}"; then
  printf 'LANE_LANDING=OPEN\n' >> "$EV/rc.txt"; run_lane check:landing-e2e
else
  say "LANE_LANDING=EXPIRED —— 这一段**没有读数**，不许记成 0/1 的通过"
  printf 'LANE_LANDING=EXPIRED\n' >> "$EV/rc.txt"
fi
if [ "${SKIP_AI:-0}" = 1 ]; then
  say "LANE_AI=SKIPPED（§10.212 读数已到手：rc=1 / 161 passed，红属 B79 ③）"
  printf 'LANE_AI=SKIPPED\n' >> "$EV/rc.txt"
elif wait_gate ai-e2e "${AI_PORTS[*]}"; then
  printf 'LANE_AI=OPEN\n' >> "$EV/rc.txt"; run_lane check:ai-e2e
else
  say "LANE_AI=EXPIRED —— 这一段**没有读数**"
  printf 'LANE_AI=EXPIRED\n' >> "$EV/rc.txt"
fi
# 🔴 这两枚具名段之外，**整链 `pnpm check` 才是 §10.199 欠的那件事**：
# 载体上一趟红在第 34/86 段 ⇒ 后面 52 段（含末尾 `pnpm -r test`）一次没跑。
# 具名单段挡不住"整链跑满"这个要求，所以第三道单独跑、单独落盘。
if [ "${SKIP_FULL:-0}" = 1 ]; then
  say "LANE_FULL=SKIPPED（显式跳过，不是没有读数）"
  printf 'LANE_FULL=SKIPPED\n' >> "$EV/rc.txt"
else
  # 🔴 整链的窗口不是"起跑那一刻空"就算数：链跑到中途时，别人的测试可以**中途**拿到内存闸门锁，
  # 于是链里那一枚会自己起 vitest 的段（`mutate-op-log-semantics.mjs`）被拒掉。
  # 那枚拒掉的退出码在日志里长得和"语义变异真红了"**一模一样**（都是 rc=1 + "missing assertion report"），
  # 所以这里把"被闸门拒启动"单独量出来标成 env_refusal=YES，并**重排队再跑一趟**，
  # 而不是把这一趟当成产品结论（traps #309 那一族：五种状态必须分得开）。
  FULL_DONE=0
  attempt=1
  while [ "$attempt" -le "${FULL_ATTEMPTS:-3}" ]; do
    if ! wait_gate "full-check-$attempt" "${AI_PORTS[*]} ${LANDING_PORTS[*]}"; then
      say "LANE_FULL=EXPIRED attempt=$attempt —— 这一趟整链**没有读数**，不许记成 n/86"
      printf 'LANE_FULL=EXPIRED attempt=%s\n' "$attempt" >> "$EV/rc.txt"
      break
    fi
    printf 'LANE_FULL=OPEN attempt=%s\n' "$attempt" >> "$EV/rc.txt"
    out="$EV/full-check.$attempt.log"
    ( cd "$CARRIER" && NO_COLOR=1 pnpm check >"$out" 2>&1 )
    rc=$?
    seg=$(node -e 'process.stdout.write(String(require("./package.json").scripts.check.split(" && ").length))' 2>/dev/null || echo 0)
    red=$(grep -cE '✗|failed|ELIFECYCLE' "$out" 2>/dev/null || true)
    echoed=$(grep -cE '^\$ ' "$out" 2>/dev/null || true)
    ran=NO; [ -s "$out" ] && ran=YES
    refusal=NO
    if grep -q '内存闸门拒绝启动' "$out" 2>/dev/null; then refusal=YES; fi
    printf 'FULL_CHECK attempt=%s rc=%s ran=%s env_refusal=%s commands_echoed=%s segments_denominator=%s red_lines=%s bytes=%s\n' \
      "$attempt" "$rc" "$ran" "$refusal" "$echoed" "$seg" "$red" "$(wc -c <"$out" | tr -d ' ')" | tee -a "$LOG" >> "$EV/rc.txt"
    grep -E '✗|ELIFECYCLE' "$out" 2>/dev/null | head -12 | tee -a "$LOG" | sed 's/^/  /' >> "$EV/red-candidates.txt"
    if [ "$refusal" = NO ]; then FULL_DONE=1; break; fi
    say "第 $attempt 趟整链被仓库自己的内存闸门**半路拒掉** ⇒ 这一趟不记成读数，回去重新排队"
    attempt=$((attempt + 1))
  done
  if [ "$FULL_DONE" = 0 ]; then
    say "LANE_FULL=NO_CLEAN_RUN —— 没有任何一趟拿到过"闸门没插手"的整链读数"
    printf 'LANE_FULL=NO_CLEAN_RUN\n' >> "$EV/rc.txt"
  fi
fi

# 🔴 第四道：整链是 `&&` 串起来的 ⇒ 任何一段红，后面所有段**一次都没跑**（10-05 那一趟红在第 41/86 段）。
#    这一道把尾部段**逐段独立**跑，每段自己的 rc 落盘，一处红不吞掉别人。
#    段名从 package.json 的 check 串现取（不是我手抄的一份清单 —— 抄的那份会漂），TAIL_FROM 是 0 基下标。
if [ -n "${TAIL_FROM:-}" ]; then
  printf 'LANE_TAIL=OPEN from=%s\n' "$TAIL_FROM" >> "$EV/rc.txt"
  node -e 'const s=require("./package.json").scripts.check.split(" && ");for(let i=Number(process.env.TAIL_FROM);i<s.length;i++)process.stdout.write(s[i]+"\n")' > "$EV/tail-segments.txt"
  n=0; greenn=0; redn=0; skipn=0
  while IFS= read -r cmd; do
    n=$((n+1))
    name=${cmd#pnpm }
    case " ${SKIP_SEG:-} " in *" $name "*)
      say "SEG $n SKIPPED_BY_KNOB（已闭合：${name}）"
      printf 'SEG %02d rc=SKIPPED cmd=%s\n' "$n" "$cmd" | tee -a "$LOG" >> "$EV/rc.txt"
      skipn=$((skipn+1)); continue ;;
    esac
    out="$EV/tail-$n.log"
    ( cd "$CARRIER" && NO_COLOR=1 sh -c "$cmd" ) >"$out" 2>&1
    rc=$?
    if [ "$rc" -eq 0 ]; then greenn=$((greenn+1)); else redn=$((redn+1)); fi
    printf 'SEG %02d rc=%s cmd=%s bytes=%s\n' "$n" "$rc" "$cmd" "$(wc -c <"$out" | tr -d ' ')" | tee -a "$LOG" >> "$EV/rc.txt"
  done < "$EV/tail-segments.txt"
  printf 'TAIL_SUMMARY from=%s listed=%s green=%s red=%s skipped=%s\n' \
    "$TAIL_FROM" "$n" "$greenn" "$redn" "$skipn" | tee -a "$LOG" >> "$EV/rc.txt"
else
  say "LANE_TAIL=SKIPPED（没给 TAIL_FROM —— 尾部段没有读数，别当成跑满 86 段）"
  printf 'LANE_TAIL=SKIPPED\n' >> "$EV/rc.txt"
fi

say "DONE load=${#GATES_LOAD[@]} e2e=2 full=1"
