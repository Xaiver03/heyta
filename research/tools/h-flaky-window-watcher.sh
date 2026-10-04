#!/bin/bash
# 有界窗口 watcher：等负载门 + 4318/4319 空闲，然后把 calendar-view-options 连跑三趟
# 目的：解释 23:19 那趟留下的 `1 flaky`（① 首趟红在 spec.ts:114 的 VIEW_SELECT 可见性）。
# 退出码：0 = 三趟全绿（flaky 在本窗口内未复现）；1 = 跑完了但其中至少一趟非零（= flaky 复现，这就是它要抓的东西）；
#         3 = 没等到窗口（环境无效，不是产品失败）；4 = 探针坏了（lsof 对照端口也为空）。
# 🔴 这份装置住在仓内而不是 /tmp：一次重启会把 /tmp 里的臂与等待器全清走，
#    那时"跑过三趟"就只剩一句主张（日志仍是现场，允许在 /tmp）。
set -u
cd "$(dirname "$0")/../.." || exit 4   # 本脚本住在 research/tools/，仓库根就是它的 ../..
. scripts/lib/wait-for-quiet-host.sh

# 🔴 日志名每跑唯一（与 `r14c-window-retry.sh` 同一纪律，本会话前一轮刚为它修过）：
#    原来这里靠 `mv "$LOG" "$LOG.prev"` 保上一趟 —— 只有**一层**，第三次跑就把第二次的现场挤掉了，
#    而台账里"上一趟读数"这种引用一旦落到被挤掉的那份就成死链。
# 🔴 `--selftest` 不许挂这个稳定名：selftest 走的是桩（`PW_CMD` 被换掉、一趟都不真跑），
#    但它仍然会先跑到这一段（`ln` 在 selftest 分支之前）。实测后果就发生在 09:2x：
#    跑完 selftest 后 `/tmp/ht-h-flaky.log` 指向了一份**空文件**，
#    下一位照台账里"稳定名"去读"上一趟三跑读数"就会读到零字节，
#    而那份真读数在它旁边的 `.20261004-060210.25162.log` 里活得好好的。
STABLE_LOG=/tmp/ht-h-flaky.log
if [ "${1:-}" = "--selftest" ]; then STABLE_TIED=0
elif [ -n "${LOG:-}" ]; then STABLE_TIED=0
else LOG="/tmp/ht-h-flaky.$(date +%Y%m%d-%H%M%S).$$.log"; ln -sf "$LOG" "$STABLE_LOG" && STABLE_TIED=1 || STABLE_TIED=0; fi
RUNS="${RUNS:-3}"
STRICT_MAX="${STRICT_MAX:-9}"
BUDGET="${BUDGET:-900}"   # 外层窗口预算
# 🔴 内层 `wait_for_quiet_host` 有自己的预算（HEYTA_LOAD_GATE_WAIT，默认 900s），
#    到点会 return 非零。第二趟实测证明了这一点：外层写 BUDGET=3600，
#    而内层 900s 一到就 `GATE=timeout rc=3` 结束 —— **外层那个旋钮当时是装饰**。
#    ⇒ 要真等到 3600s，内层的等待必须一起放大。
export HEYTA_LOAD_GATE_WAIT="${HEYTA_LOAD_GATE_WAIT:-$BUDGET}"
export HEYTA_LOAD_GATE_INTERVAL="${HEYTA_LOAD_GATE_INTERVAL:-30}"
PORTS="4318 4319"
CONTROLS="4358 5399"   # 阳性对照：这些端口上常有别人的进程，lsof 必须数得出东西才算探针活着

# 🔴 取证留存（2026-10-04 09:1x 加）。默认输出目录是**共享的** `e2e/test-results/`，
#    谁下一趟都会把它清掉 —— 23:19 那次失败的 `trace.zip` 就是这么没的，
#    于是本线这枚 flaky **从来没有自己的取证**（只能借另一条线 §7.4 的同族 trace 实证去推断）。
#    ⇒ 每趟落到本装置独占的目录；有非零趟就保留并把路径打出来，全绿才删。
TRACE_ROOT="${TRACE_ROOT:-/tmp/ht-h-flaky-trace.$$}"
# 跑这一层的 seam 只给 --selftest 用（默认值与原来的命令行逐字等价）。
PW_CMD="${PW_CMD:-npx playwright test}"

# 🔴 trace 才是那条**已被证明**能看见 `[vite]` 的通道（09:3x 现量：另一条线 06:51 那趟留下的
#    `e2e/test-results/list-folder-…/trace.zip` 里数得出 `[vite] connecting...` ×3 与
#    `[vite] connected.` ×3，而**同一种趟**的 stdout 里 `[vite]` 一行都没有）。
#    ⇒ 非零趟不光要把 zip 留下，还要当场把 needle 数出来。
#    `connect` 这一列是**这条扫描自己的阳性对照**：它数不到 ⇒ `hotUpdated=0` 只允许读成
#    "扫描没看见"，不允许读成"这一趟没有洪泛"（和 stdout 侧的 `viteChannel` 是同一条纪律的两层）。
ht_trace_scan() {
  _d="$1"; _lbl="$2"
  _z=$(find "$_d" -name 'trace.zip' 2>/dev/null | head -20)
  if [ -z "$_z" ]; then
    echo "RUN_${_lbl}_TRACE scan=none（这一趟没有 trace.zip ⇒ 要么全绿、要么它没跑到失败）"
    return 0
  fi
  if ! command -v unzip >/dev/null 2>&1; then
    echo "RUN_${_lbl}_TRACE scan=unavailable（本机没有 unzip ⇒ 下面的 0 都不算读数）"
    return 0
  fi
  _x=$(mktemp -d /tmp/ht-h-tr.XXXXXXXX) || { echo "RUN_${_lbl}_TRACE scan=unavailable（建不了临时目录）"; return 0; }
  _n=0
  for _f in $_z; do
    _n=$((_n + 1))
    ( cd "$_x" && unzip -q -o "$_f" '*.trace' >/dev/null 2>&1 )
  done
  _con=$(grep -h -o '\[vite\] connect' "$_x"/*.trace 2>/dev/null | wc -l | tr -d ' '); _con=${_con:-0}
  _hot=$(grep -h -o '\[vite\] hot updated' "$_x"/*.trace 2>/dev/null | wc -l | tr -d ' '); _hot=${_hot:-0}
  _inv=$(grep -h -o 'Could not Fast Refresh' "$_x"/*.trace 2>/dev/null | wc -l | tr -d ' '); _inv=${_inv:-0}
  if [ "$_con" -gt 0 ]; then _v=yes; else _v=no; fi
  echo "RUN_${_lbl}_TRACE scan=ok traces=${_n} connect=${_con} hotUpdated=${_hot} fastRefreshInvalidate=${_inv} viteInTrace=${_v}"
  if [ "$_v" = "no" ]; then
    echo "  （viteInTrace=no ⇒ 扫描本身没看见任何 [vite] 行，hotUpdated=0 不构成「这一趟没有洪泛」的读数）"
  fi
  rm -rf "$_x" 2>/dev/null
  return 0
}

# selftest 只测「跑 + 留证 + 判别式计数」这一层；等窗口那一层的读数在它之前（lsof 阳性对照）。
if [ "${1:-}" = "--selftest" ]; then
  ST=$(mktemp -d /tmp/ht-h-flaky-st.XXXXXXXX) || exit 4
  bad=0
  # 桩必须把 `--output` 的**副作用**也造出来（真 playwright 会建那个目录）：
  # 只回 stdout 的桩会让「绿了要删」与「红了要留」两臂同时读成"目录不存在"⇒ 一条恒真一条恒假。
  cat > "$ST/pw" <<'STUB'
#!/bin/bash
printf '%s\n' "$@" >> "$STUB_ARGV"
for a in "$@"; do
  case "$a" in --output=*) mkdir -p "${a#--output=}" ;; esac
done
case "${STUB_MODE:-green}" in
  # 臂2 是"通道活着"的正向对照：先打一行 **vite 自己才会打**的横幅，再打那条签名。
  opt)   printf '[WebServer]   VITE v7.0.0  ready in 305 ms\n'
         printf '[WebServer] (!) "optimized dependencies changed. reloading"\n' ;;
  # 🔴 臂5 的形状 = **真机日志里出现过的那个**：有 `[WebServer]` 前缀行、但没有 vite 自己的横幅
  #    （那 7 行完全可以全部来自"假端点"那条显式写了 `stdout:'pipe'` 的 webServer）。
  #    这一臂钉的就是我 09:3x 第一版判据的假阳性：拿前缀当"通道活着"。
  prefixonly) printf '[WebServer] 假端点已就绪： http://127.0.0.1:4319/v1\n'
              printf '[WebServer] (node:1) Warning: 某条来自另一进程的转发行\n' ;;
  # 🔴 真 playwright 失败时会往 --output 里写 trace.zip ⇒ 桩也要造出这个副作用，
  #    否则「扫 trace」那一层在自测里从来没有被测到（装置自己假绿）。
  #    `flakyblind` 与 `flaky` 的唯一区别：**zip 里零条 `[vite]`** ⇒ 那一条阳性对照必须转 no。
  flaky|flakyblind)
         printf '  1 flaky\n  1 passed\n'; printf 'STUB_FAIL\n' >&2
         for a in "$@"; do
           case "$a" in
             --output=*) d="${a#--output=}"
               if [ "$STUB_MODE" = flaky ]; then
                 printf '%s\n' '{"type":"console","text":"[vite] connecting..."}' \
                   '{"type":"console","text":"[vite] connected."}' \
                   '{"type":"console","text":"[vite] hot updated: /src/App.tsx"}' \
                   '{"type":"console","text":"Could not Fast Refresh (export is incompatible)"}' > "$d/0-trace.trace"
               else
                 printf '%s\n' '{"type":"console","text":"完全与 vite 无关的一行"}' > "$d/0-trace.trace"
               fi
               ( cd "$d" && python3 -c 'import zipfile; zipfile.ZipFile("trace.zip","w").write("0-trace.trace")' ) >/dev/null 2>&1 ;;
           esac
         done
         exit 1 ;;
esac
printf '  2 passed (4.7s)\n'
exit 0
STUB
  chmod +x "$ST/pw"
  # ── 臂 1：绿趟 ⇒ 命令里必须带 --output（还要带对的值）、必须打判别式计数、目录必须被删
  : > "$ST/argv1"
  LOG="$ST/l1" RUNS=1 BUDGET=1 SKIP_GATE=1 TRACE_ROOT="$ST/t1" \
    STUB_MODE=green STUB_ARGV="$ST/argv1" PW_CMD="$ST/pw" bash "$0" >"$ST/o1" 2>&1
  R1=$?
  [ "$R1" = 0 ] || { echo "❌ 臂1 绿趟应退 0，实际 $R1"; sed -n '1,12p' "$ST/l1" 2>/dev/null; bad=$((bad+1)); }
  grep -qF -- "--output=$ST/t1/run1" "$ST/argv1" \
    || { echo "❌ 臂1 构造的命令里没有 --output=<本装置独占目录>/run1 ⇒ 留证没接上"; bad=$((bad+1)); }
  # 🔴 臂1 的第三层：`--trace=on` 必须在 argv 里。少了它，绿趟根本没有 trace ⇒ 下面那条
  #    `scan=none` 不是"这一趟没洪泛"，而是"这一趟没取证" —— 整条闭合判据 ② 就变成 unreachable。
  grep -qF -- '--trace=on' "$ST/argv1" \
    || { echo "❌ 臂1 的命令里没有 --trace=on ⇒ 绿趟没取证，闭合判据『全绿且无洪泛』那一支永远读不出来"; bad=$((bad+1)); }
  grep -q 'RUN_1_TRACE scan=none' "$ST/l1" \
    || { echo "❌ 臂1 的桩没造 trace.zip（这是**预期**：绿趟桩无 zip），但扫描必须把 scan=none 打出来 ⇒ 否则『没扫』与『扫了没有』分不开"; bad=$((bad+1)); }
  grep -q 'SIG optdeps=0 hotupdated=0' "$ST/l1" \
    || { echo "❌ 臂1 没打判别式计数（绿趟也要打：否则下一位分不开「没数到」与「没跑到」）"; bad=$((bad+1)); }
  # 🔴 臂1 的第二层：桩**没有**打 vite 的横幅 ⇒ 这一趟必须自报 viteChannel=no。
  #    这条是 09:3x 加的：`optdeps=0` 单独看会被读成"排除了重新预打包"，而 vite 那条
  #    `webServer` 没有 `stdout:'pipe'` ⇒ 这一路可能压根没转发。**瞎通道上的 0 不是读数**，
  #    装置必须自己把这件事说出来。
  grep -q 'viteChannel=no' "$ST/l1" \
    || { echo "❌ 臂1 没 vite 横幅却不自报 viteChannel=no ⇒「0」会被误读成「已排除」"; bad=$((bad+1)); }
  [ -d "$ST/t1" ] && { echo "❌ 臂1 全绿却没删临时输出（残留）"; bad=$((bad+1)); }
  grep -q 'TRACE=dropped' "$ST/l1" || { echo "❌ 臂1 没打 TRACE=dropped"; bad=$((bad+1)); }
  # ── 臂 2：判别式必须真数得出来（归因从"靠人记得去 grep"变成装置自动打）
  : > "$ST/argv2"
  LOG="$ST/l2" RUNS=1 BUDGET=1 SKIP_GATE=1 TRACE_ROOT="$ST/t2" \
    STUB_MODE=opt STUB_ARGV="$ST/argv2" PW_CMD="$ST/pw" bash "$0" >"$ST/o2" 2>&1
  R2=$?
  [ "$R2" = 0 ] || { echo "❌ 臂2（有 opt 签名但仍全绿）应退 0，实际 $R2"; bad=$((bad+1)); }
  grep -q 'SIG optdeps=1' "$ST/l2" \
    || { echo "❌ 臂2 数不到 optdeps=1 ⇒ 那条判别式在装置里是装饰（不能失败的判据）"; bad=$((bad+1)); }
  # 臂2 是臂1 那条 viteChannel 的**正向对照**：桩打了 vite 横幅 + 一条签名 ⇒ 两行 `[WebServer]` 都要数到。
  # 没有这一条，`viteChannel=no` 可能只是"恒打 no"，臂1 依旧没有牙。
  # 🔴 `devLines` 这里**故意不做判据**：`[WebServer] ` 前缀是两条 webServer **共用**的
  #    （`e2e/playwright.config.ts:74-93`），拿它当"通道活着"= 假阳性，会把"没转发"读成"已排除"。
  #    判通道只判 vite 自己才会打的横幅。
  grep -q 'viteChannel=yes' "$ST/l2" \
    || { echo "❌ 臂2 有 vite 横幅却没自报 viteChannel=yes ⇒ 通道判别式坏了，臂1 的对照不成立"; bad=$((bad+1)); }
  # ── 臂 5：只有 `[WebServer]` 前缀行、没有 vite 横幅 ⇒ 必须仍报 viteChannel=no（钉假阳性）
  : > "$ST/argv5"
  LOG="$ST/l5" RUNS=1 BUDGET=1 SKIP_GATE=1 TRACE_ROOT="$ST/t5" \
    STUB_MODE=prefixonly STUB_ARGV="$ST/argv5" PW_CMD="$ST/pw" bash "$0" >"$ST/o5" 2>&1
  R5=$?
  [ "$R5" = 0 ] || { echo "❌ 臂5（前缀行但无 vite 横幅，仍全绿）应退 0，实际 $R5"; bad=$((bad+1)); }
  grep -q 'devLines=2 viteChannel=no' "$ST/l5" \
    || { echo "❌ 臂5 把「别人的转发行」当成了「vite 通道活着」⇒ 那条假阳性没被钉住"; sed -n '1,8p' "$ST/l5" 2>/dev/null; bad=$((bad+1)); }
  # ── 臂 3：复现那一趟 ⇒ 必须退 1，且 trace 目录必须**留着**并把路径打出来
  : > "$ST/argv3"
  LOG="$ST/l3" RUNS=1 BUDGET=1 SKIP_GATE=1 TRACE_ROOT="$ST/t3" \
    STUB_MODE=flaky STUB_ARGV="$ST/argv3" PW_CMD="$ST/pw" bash "$0" >"$ST/o3" 2>&1
  R3=$?
  [ "$R3" = 1 ] || { echo "❌ 臂3 复现 flaky 必须退 1（跑完红过却退 0 = 一条永远不会失败的判据），实际 $R3"; bad=$((bad+1)); }
  [ -d "$ST/t3" ] || { echo "❌ 臂3 非零趟却把 trace 目录删了 ⇒ 又回到「那趟没有自己的取证」这个老坑"; bad=$((bad+1)); }
  grep -q 'TRACE=kept' "$ST/l3" || { echo "❌ 臂3 没打出 TRACE=kept 与留存路径"; bad=$((bad+1)); }
  # 🔴 臂3 的第二层：非零趟必须**当场把 trace 里的 needle 数出来** —— 那才叫"留了证"，
  #    而不是"证躺在盘上等下一位记得去开"。
  # 🔴 这里数的是 `RUN_1_TRACE` 而**不是** `RUN_3_TRACE`：那条前缀是**跑次序号**（这一臂 RUNS=1），
  #    跟臂号无关 —— 我自己第一次就把它写成臂号，症状与"扫描没跑"逐字相同。
  grep -q 'RUN_1_TRACE scan=ok traces=1 connect=2 hotUpdated=1 fastRefreshInvalidate=1 viteInTrace=yes' "$ST/l3" \
    || { echo "❌ 臂3 没把留下来的 trace 扫出读数 ⇒ 留证等于没留"; sed -n '1,10p' "$ST/l3" 2>/dev/null; bad=$((bad+1)); }
  # ── 臂 6（负向）：trace 在、但里面**零条 `[vite]`** ⇒ 必须 viteInTrace=no。
  #    没有这一臂，扫描可能"恒打 yes"或"恒打 no"，臂3 那条读数依旧不构成排除性证据。
  : > "$ST/argv6"
  LOG="$ST/l6" RUNS=1 BUDGET=1 SKIP_GATE=1 TRACE_ROOT="$ST/t6" \
    STUB_MODE=flakyblind STUB_ARGV="$ST/argv6" PW_CMD="$ST/pw" bash "$0" >"$ST/o6" 2>&1
  R6=$?
  [ "$R6" = 1 ] || { echo "❌ 臂6 复现失败仍须退 1，实际 $R6"; bad=$((bad+1)); }
  grep -q 'scan=ok traces=1 connect=0 hotUpdated=0 fastRefreshInvalidate=0 viteInTrace=no' "$ST/l6" \
    || { echo "❌ 臂6 zip 里零 [vite] 却没自报 viteInTrace=no ⇒ 扫描是恒值的，臂3 不算排除"; sed -n '1,10p' "$ST/l6" 2>/dev/null; bad=$((bad+1)); }
  [ -d "$ST/t6" ] || { echo "❌ 臂6 非零趟却把 trace 目录删了"; bad=$((bad+1)); }
  # ── 臂 4（负向，行为式）：同一枚桩、同一套参数，跑一份**摘掉 --output 的副本**，
  #    它记下来的 argv 必须没有那个旗标 ⇒ 证明臂 1 的判据两侧都区分得开（不是恒真）。
  #    副本要在最小树里跑：它自己会 cd 到仓库根、source 那道负载 lib、再 `cd e2e`。
  mkdir -p "$ST/x/research/tools" "$ST/x/scripts/lib" "$ST/x/e2e" \
           "$ST/x/apps/web/evidence/calendar-view-options" || bad=$((bad+1))
  cp scripts/lib/wait-for-quiet-host.sh "$ST/x/scripts/lib/" 2>/dev/null
  touch "$ST/x/apps/web/evidence/calendar-view-options/fixture.png"
  cp "$0" "$ST/x/research/tools/w.sh"
  sed 's# --output="\$TRACE_ROOT/run\$i"##' "$ST/x/research/tools/w.sh" > "$ST/x/research/tools/w2.sh" \
    && mv -f "$ST/x/research/tools/w2.sh" "$ST/x/research/tools/w.sh"
  if cmp -s "$ST/x/research/tools/w.sh" "$0"; then
    echo "❌ 臂4 变异没落到字节上（锚点没命中）—— 这一臂是空的"; bad=$((bad+1))
  else
    : > "$ST/argv4"
    LOG="$ST/l4" RUNS=1 BUDGET=1 SKIP_GATE=1 TRACE_ROOT="$ST/t4" \
      STUB_MODE=green STUB_ARGV="$ST/argv4" PW_CMD="$ST/pw" bash "$ST/x/research/tools/w.sh" >"$ST/o4" 2>&1
    if grep -qF -- '--output=' "$ST/argv4"; then
      echo "❌ 臂4 摘掉旗标后副本竟然还传出 --output ⇒ 锚点改错了地方"; bad=$((bad+1))
    else
      echo "   ✅ 臂4 负向：同一套参数下副本的 argv 里没有 --output（臂1 那条判据两侧都分得开）"
    fi
  fi
  rm -rf "$ST" 2>/dev/null
  # 留证这一层的两腿就是臂 1 与臂 3：「恒删」坏在臂 3，「恒留」坏在臂 1。
  [ "$bad" = 0 ] && { echo "✅ selftest 六臂成立（带对的 --output / 判别式数得出来 / 绿删红留 / 摘掉必分得开 / 前缀行不算通道活着 / trace 扫得出来且空 zip 会自报瞎）"; exit 0; }
  echo "selftest 有 $bad 条不成立 ⇒ 装置坏（exit 4），不是产品坏"; exit 4
fi

# 🔴 原来这一行是 `mv "$LOG" "$LOG.prev"`：换成每跑唯一之后**必须删掉** ——
#    它会把本轮刚建的唯一日志搬走，后面的 `>> "$LOG"` 再新建一份空的，等于自己截掉自己的现场。
echo "start $(date '+%T') 连跑=$RUNS 严格负载门≤$STRICT_MAX 总预算=${BUDGET}s 日志=$LOG 稳定名=$STABLE_LOG(挂上=$STABLE_TIED)" >> "$LOG"

START=$(date +%s)
while [ "${SKIP_GATE:-0}" != "1" ]; do
  wait_for_quiet_host >> "$LOG" 2>&1 || { echo "GATE=timeout rc=3" >> "$LOG"; exit 3; }
  LOAD=$(uptime | sed 's/.*load averages: //' | awk '{print int($1)}')
  if [ "$LOAD" -gt "$STRICT_MAX" ]; then
    echo "  严格层：负载 $LOAD > ${STRICT_MAX}，再等" >> "$LOG"
  else
    # 阳性对照：先证明 lsof 数得出"有人在听"，再要求被测端口为空
    CONTROL_HIT=0
    for p in $CONTROLS; do
      if lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then CONTROL_HIT=1; fi
    done
    BUSY=0
    for p in $PORTS; do
      if lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then BUSY=$((BUSY + 1)); fi
    done
    if [ "$CONTROL_HIT" = "0" ] && [ "$BUSY" = "0" ]; then
      echo "  ❌ 对照端口也全部为空 —— lsof 探针不可信（$BUSY 会被误读成'窗口开着'），本轮作废" >> "$LOG"
      exit 4
    fi
    if [ "$BUSY" = "0" ]; then
      # 🔴 让路判据在**开跑的这一刻**现取（不在轮首）：负载门一等就是几十分钟，
      #    轮首取的 pid 到这儿早就过期了。
      #    让的是"真在跑的 C 链"而不是"C 的看守"：C 才是这条线的硬缺口，H 只是收窄一枚已登记的 flaky；
      #    若按"有没有人在等"让路，一个等待器就能把另一个等待器锁住（那种粗粒度在
      #    `r14c-window-retry.sh` 的 CO_PATTERN 那一侧，已登记为待办，不改正在跑的那份）。
      CHAIN_PID=$(pgrep -f 'r14c-carrier-chain[.]sh' 2>/dev/null | tr '\n' ' ')
      if [ -n "$CHAIN_PID" ]; then
        echo "  CO_CHAIN=alive pid=${CHAIN_PID% } —— 让路给设备链，本轮不开 e2e" >> "$LOG"
      else
        echo "  ✅ 负载 $LOAD ≤ ${STRICT_MAX}，4318/4319 无人监听（对照端口有数 = lsof 可信）" >> "$LOG"
        break
      fi
    fi
    echo "  4318/4319 里 $BUSY 个被占，继续等" >> "$LOG"
  fi
  if [ $(( $(date +%s) - START )) -ge "$BUDGET" ]; then
    echo "GATE=预算用尽 rc=3" >> "$LOG"
    exit 3
  fi
  sleep 30
done

cd e2e || exit 4
FLAKY_RUNS=0
for i in $(seq 1 "$RUNS"); do
  echo "----- 第 $i 趟 $(date '+%T') -----" >> "$LOG"
  # 🔴 每趟的输出**单独落一份**再并进主日志：原来那行 `grep … "$LOG" | tail -3` 扫的是
  #    **整份主日志**，第 2 趟的 SUMMARY 会把第 1 趟的计数也捞进来（"点位打当逐点打"那一族）。
  # shellcheck disable=SC2086   # PW_CMD 要词分割（默认值就是三个词）；selftest 用桩替它
  # 🔴 `--trace=on`（09:4x 加）：配置里是 `retain-on-failure` ⇒ **绿趟根本不留 trace**，
#    于是"这一趟有没有 HMR 洪泛"这个问题**只有红趟能答**，而红是抓不抓得到不由我定。
#    洪泛的载体是浏览器 console（进 trace），不是 stdout（见上面 `viteChannel` 那段）
#    ⇒ 想拿"连续几窗全绿且无洪泛"当排除性读数，就必须每趟都收 trace。代价是盘与几秒开销。
  NO_COLOR=1 $PW_CMD tests/calendar-view-options.spec.ts --trace=on --output="$TRACE_ROOT/run$i" > "$LOG.run$i" 2>&1
  RC=$?
  cat "$LOG.run$i" >> "$LOG"
  echo "RUN_${i}_RC=$RC" >> "$LOG"
  SUMMARY=$(grep -E '[0-9]+ (passed|failed|skipped)|flaky' "$LOG.run$i" | tail -3 | tr '\n' ' ')
  echo "RUN_${i}_SUMMARY=${SUMMARY:-（这一趟没打出 summary 行 ⇒ 它可能压根没跑到断言）}" >> "$LOG"
  # 🔴 两条判别式**每趟自动打**（09:1x 加）：收窄到"唯一待观测"之后，读它要靠人记得去 grep，
  #    而人是会忘的 —— 上一轮那枚 flaky 就是因为签名没被自动打出来、trace 又被共享目录清掉，
  #    最后只能借另一条线的同族实证推断。计数为 0 也是一条读数（它排除了一支假设）。
  # 🔴 但"计数为 0"只有在 **vite 那一路通道确实通着** 时才叫读数（09:3x 连着更正两次）。
  #    第一版用 `devLines>0 ⇒ alive` 判通道，**那是错的**：`e2e/playwright.config.ts:74-93` 的两条
  #    `webServer` 共用同一个 `[WebServer] ` 前缀，而假端点那条显式写了 `stdout:'pipe'`、vite 那条没有
  #    ⇒ 那 7 行完全可以全部来自假端点，"alive"就成了一条**会假阳**的判据（假阳比假阴更贵：它会让人以为排除了）。
  #    现在按 **只有 vite 才会打的横幅**判（`VITE v… ready in …` / `Local:  *http`）：数不到就是 `no`，
  #    此时 `optdeps=0` 只允许读成"这一路没转发"，不允许读成"已排除冷启动那一支"。
  OPT=$(grep -c 'optimized dependencies changed' "$LOG.run$i" 2>/dev/null || true); OPT=${OPT:-0}
  HOT=$(grep -c 'hot updated' "$LOG.run$i" 2>/dev/null || true); HOT=${HOT:-0}
  DEVN=$(grep -c '^\[WebServer\]' "$LOG.run$i" 2>/dev/null || true); DEVN=${DEVN:-0}
  if grep -E '^\[WebServer\].*(VITE v|ready in [0-9]|Local: *http)' "$LOG.run$i" >/dev/null 2>&1; then VCH=yes; else VCH=no; fi
  echo "RUN_${i}_SIG optdeps=$OPT hotupdated=$HOT devLines=$DEVN viteChannel=$VCH" >> "$LOG"
  echo "  （optdeps/hotupdated 只有在 viteChannel=yes 时才是排除性读数；viteChannel=no ⇒ 这一路没转发，0 不等于没发生。" >> "$LOG"
  echo "    浏览器侧签名进的是 trace 不是 stdout —— 非零趟的 trace 留在 ${TRACE_ROOT}/run${i}）" >> "$LOG"
  # 每趟都重写那两张证据图 ⇒ 当场记下字节身份，否则下一位又要靠"发现 md5 对不上"才知道跑过
  MD5S=$(cd .. && md5 -r apps/web/evidence/calendar-view-options/*.png | tr '\n' ' ')
  echo "RUN_${i}_EVIDENCE_MD5=${MD5S}" >> "$LOG"
  # 🔴 每趟都扫（配合上面 `--trace=on`）：绿趟也要给出"这一趟的洪泛计数"，
  #    否则闭合判据里"连续 N 窗全绿且无洪泛"那一支永远没有读数可取。
  #    扫描自己的阳性对照是 `connect`（`[vite] connect…` 每趟必有一条）：数不到就是 `viteInTrace=no`。
  ht_trace_scan "$TRACE_ROOT/run$i" "$i" >> "$LOG"
  [ "$RC" = "0" ] || FLAKY_RUNS=$((FLAKY_RUNS + 1))
done
echo "ALL_DONE runs=$RUNS 非零趟=$FLAKY_RUNS $(date '+%T')" >> "$LOG"
# 🔴 退出码语义（05:5x 改，原来是"跑完就 0"）：这台装置的目的就是**抓 flaky**，
#    跑完但其中两趟红过却退 0 = 一条永远不会失败的判据（AGENTS §8.3）。
if [ "$FLAKY_RUNS" = "0" ]; then
  rm -rf "$TRACE_ROOT" 2>/dev/null
  echo "TRACE=dropped（全绿 ⇒ 不留临时输出；要留就显式传 TRACE_ROOT=<自己指定的目录>）" >> "$LOG"
  echo "FLAKY=0（$RUNS 趟全绿 ⇒ 那枚 23:19 的 flaky 在本窗口内未复现）" >> "$LOG"
  exit 0
fi
echo "TRACE=kept ${TRACE_ROOT}（有非零趟 ⇒ trace 留着；§7.4 那一族看的就是它里面的 [vite] hot updated）" >> "$LOG"
echo "FLAKY=$FLAKY_RUNS/$RUNS ⇒ 不稳是真的：先看 RUN_*_SIG，再开 $TRACE_ROOT/run* 里的 trace" >> "$LOG"
exit 1
