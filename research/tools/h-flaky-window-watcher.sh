#!/bin/bash
# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 按字节偏移增量读取脚本：
#    运行中被编辑，后半段就从错位字节开始解析。本装置是**等几十分钟的等待器**，
#    而 11:0x 实测就发生过"边等边改它"（我先改了源文件、才想起 pid 32016 在跑旧偏移，只能停掉重挂）。
#    入口先把自己拷成同目录隐藏快照再 exec —— 之后对源文件的任何编辑都影响不到本次运行。
#    快照名 .原名.snap.PID（`.gitignore` 里加了 `research/tools/.*.snap.*`）；trap 尽力清理。
case "$(basename "$0")" in
  .*.snap.*) ;; # 已是快照：正常往下跑
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
# 🔴 清理必须**只清自己创建的那份**：本装置会在 selftest 里 `bash "$0"` 递归调自己，
#    子进程跳过 bootstrap 时 `$0` 就是**父进程那份快照**的名字 —— 无条件 `trap rm -f "$0"`
#    会让第一个子进程退出时把父亲的脚本删掉（11:0x 实测：17 条臂当场变 127，
#    而 `bash -n` 与"脚本文件在不在"全都看不出来，因为文件是在运行中途消失的）。
#    快照名尾巴是创建者的 PID ⇒ 只有 PID 对得上的那个进程才挂这个 trap。
case "$0" in
  *.snap.*) [ "${0##*.snap.}" = "$$" ] && trap 'rm -f -- "$0"' EXIT ;;
esac
# 有界窗口 watcher：等负载门 + 4318/4319 空闲，然后把 calendar-view-options 连跑三趟
# 目的：解释 23:19 那趟留下的 `1 flaky`（① 首趟红在 spec.ts:114 的 VIEW_SELECT 可见性）。
# 退出码：0 = 三趟全绿（flaky 在本窗口内未复现）；1 = 跑完了但其中至少一趟非零（= flaky 复现，这就是它要抓的东西）；
#         3 = 没等到窗口（环境无效，不是产品失败）；4 = 探针坏了（lsof 对照端口也为空）。
# 🔴 这份装置住在仓内而不是 /tmp：一次重启会把 /tmp 里的臂与等待器全清走，
#    那时"跑过三趟"就只剩一句主张（日志仍是现场，允许在 /tmp）。
set -u
cd "$(dirname "$0")/../.." || exit 4   # 本脚本住在 research/tools/，仓库根就是它的 ../..
. scripts/lib/wait-for-quiet-host.sh
# 让路那一层的 ps 读数与 B 看守**同一份谓词**（豁免自己这一树，理由见 lib 文件头）。
. scripts/lib/ps-scan.sh

# 🔴 日志名每跑唯一（与 `r14c-window-retry.sh` 同一纪律，本会话前一轮刚为它修过）：
#    原来这里靠 `mv "$LOG" "$LOG.prev"` 保上一趟 —— 只有**一层**，第三次跑就把第二次的现场挤掉了，
#    而台账里"上一趟读数"这种引用一旦落到被挤掉的那份就成死链。
# 🔴 `--selftest` 不许挂这个稳定名：selftest 走的是桩（`PW_CMD` 被换掉、一趟都不真跑），
#    但它仍然会先跑到这一段（`ln` 在 selftest 分支之前）。实测后果就发生在 09:2x：
#    跑完 selftest 后 `/tmp/ht-h-flaky.log` 指向了一份**空文件**，
#    下一位照台账里"稳定名"去读"上一趟三跑读数"就会读到零字节，
#    而那份真读数在它旁边的 `.20261004-060210.25162.log` 里活得好好的。
STABLE_LOG="${STABLE_LOG:-/tmp/ht-h-flaky.log}"
# 🔴 从"排除名单"改成**允许名单**（10:5x，我自己刚复犯之后）：
#   原来这里是 `if [ "$1" = --selftest ]` ⇒ 后来加 `--scan` 时我照抄进分支，忘了它同样会先跑到这段 `ln`，
#   于是 `/tmp/ht-h-flaky.log` 被我那次 `--scan` 指到一份近乎空的日志，**正在等的看守（pid 32016）的现场被摘走**
#   —— 这是第 15–17 行那起 09:2x 事故的第二次，肇事者换成新加的那一档。
#   排除名单的每一栏都要有人**记得**加；允许名单只有一个 `run`，以后再加档位默认就摘不走。
MODE="${1:-run}"
if [ -n "${LOG:-}" ]; then STABLE_TIED=0
elif [ "$MODE" = "run" ]; then LOG="/tmp/ht-h-flaky.$(date +%Y%m%d-%H%M%S).$$.log"; ln -sf "$LOG" "$STABLE_LOG" && STABLE_TIED=1 || STABLE_TIED=0
else STABLE_TIED=0; fi
RUNS="${RUNS:-3}"
# 🔴 规范门是 `hw.ncpu × 3/4`（本机 12）。**这个数从 `host_load_gate` 要，不在这里推**：
#    原来这里是第三份 `ncpu × 3/4` 的抄件（闸门 / lib / 本装置），而臂 9 只能靠"比对三个
#    文件里的分数字面"防漂 —— 比对抄件是补丁，**删掉抄件才是修**。
#    本装置在它之上**还有一层严格层**，值来自 §5 H 那格写死的开工判据
#    「4318/4319 为空 **且** 负载落回个位」⇒ `HT_PLAN_LIMIT=9`。
# 🔴 **这一层不许在这台看守里放宽**（硬约束原话：负载门不达标就登记等待，不降级判据）。
#    10-05 实测它的代价并把代价打进日志：规范门过了 **4 次**（负载 12 三次、负载 10 一次）全被这层退回
#    ⇒ 差距是 **1–3** 而不是"从没落下来过"，但改这个值要改**那一格判据**（要人拍板），不是改这里。
#    想临时按规范门跑：显式传 `STRICT_MAX=12`，日志首行会照实写明它与规范门的关系。
host_load_gate >/dev/null 2>&1 || true   # 这里只要它导出的**阈值**，判定不在这一行
HT_NORM_LIMIT="${HOST_LOAD_LIMIT:-}"
[ -n "$HT_NORM_LIMIT" ] || { echo "❌ 规范门的数取不到（host_load_gate 没给出 HOST_LOAD_LIMIT）⇒ 探针坏了，不在这里猜一个" >&2; exit 4; }
HT_PLAN_LIMIT=9
STRICT_MAX="${STRICT_MAX:-$HT_PLAN_LIMIT}"
BUDGET="${BUDGET:-900}"   # 外层窗口预算
# 🔴 内层 `wait_for_quiet_host` 有自己的预算（HEYTA_LOAD_GATE_WAIT，默认 900s），
#    到点会 return 非零。第二趟实测证明了这一点：外层写 BUDGET=3600，
#    而内层 900s 一到就 `GATE=timeout rc=3` 结束 —— **外层那个旋钮当时是装饰**。
#    ⇒ 要真等到 3600s，内层的等待必须一起放大。
export HEYTA_LOAD_GATE_WAIT="${HEYTA_LOAD_GATE_WAIT:-$BUDGET}"
export HEYTA_LOAD_GATE_INTERVAL="${HEYTA_LOAD_GATE_INTERVAL:-30}"
PORTS="4318 4319"
CONTROLS="4358 5399"   # 阳性对照：这些端口上常有别人的进程，lsof 必须数得出东西才算探针活着
# 🔴 让路图案做成旋钮（默认值就是原来写死的那串，逐字等价），理由是要让 selftest 能对着**真进程**
#    验这两条正则认不认得"快照运行形态"：`reinstall-all` 跑起来时 argv 是
#    `scripts/.reinstall-all.sh.snap.<pid>`（闸门 §3b 同一读数），只写原文件名会读成"没人在跑"。
#    图案里的 `[.]` 是挡 pgrep 自匹配（本进程 argv 里就带着这串字面）。
CO_CHAIN_RE="${CO_CHAIN_RE:-r14c-carrier-chain[.]sh}"
CO_REINSTALL_RE="${CO_REINSTALL_RE:-scripts/[.]?reinstall-all}"
# 🔴 走共用的 `ht_ps_has`（`scripts/lib/ps-scan.sh`）而不是裸 pgrep：投这看守起来的那条命令行
#    里只要带着同一串图案，裸 pgrep 就把**我自己的祖先**读成"别人在跑"，于是恒让路。
#    与 B 看守那次 M4 实测是同一个坑（那次它白让 1800s 后 exit 1）。
ht_pgrep(){ ht_ps_has "$1" | tr '\n' ' '; }

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
  # 🔴 两条都必须守：① 用 `-d` 解到目标目录，不 `( cd && unzip )`；② 逐行 `read -r` 取路径，不 `for f in $_z`。
  #   ①（10:4x 实测）：`find` 交回**相对**路径时，子 shell 一换 cwd 就找不到文件，而 `-q`+`2>/dev/null`
  #     把失败完全吞掉 ⇒ 解包 0 个 ⇒ `connect=0` ⇒ `viteInTrace=no`，看着像"那趟没有洪泛"。
  #   ②（同刻实测）：**本仓的绝对路径里就有空格**（`Desktop/All in one Data/…`）⇒
  #     一枚 `trace.zip` 被空白拆成 4 个"文件"，unzip 四次全失败同样被吞 ⇒ 又一个恒 0 的瞎扫描。
  #   两种都是 AGENTS §8.3 那一族：**永远走不到的判据不报错，只报"没有"**。
  while IFS= read -r _f; do
    [ -z "$_f" ] && continue
    _n=$((_n + 1))
    unzip -q -o "$_f" '*.trace' -d "$_x" >/dev/null 2>&1
  done <<ZLST
$_z
ZLST
  if ! ls "$_x"/*.trace >/dev/null 2>&1; then
    echo "RUN_${_lbl}_TRACE scan=unavailable（traces=${_n} 枚但一个 .trace 都没解出来 ⇒ 下面三列 0 都不是读数）"
    rm -rf "$_x" 2>/dev/null
    return 0
  fi
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

# 🔴 §5 第 1 条那次「任何读 dist 的判据开跑前先体检新鲜度」由装置**自己打**，不靠谁记得（11:2x 加）。
#    为什么是**记录**而不是门禁：`scripts/dist-freshness.mjs` 的文件头自己写明"默认永远 exit 0 ——
#    并行会话正在改源码时『落后』是正常状态"，把它变成红等于本线摘走一条不属于本线的判据（AGENTS §8.3）。
#    但它必须每趟留下读数，否则"这两张图是当前源码的界面"又是一句没有现场的主张（交接 §6 第 28 条：主张过期）。
#    包清单**不手抄**：从 `apps/web/package.json` 现取 —— 抄一份就会漂，而漂了的体检只覆盖子集，
#    打印出来却长得像"全新鲜"。取不到一律明确打 `check=unavailable`，绝不打成 `behind=0`。
ht_dist_report() {
  _lbl="$1"
  if [ -z "${HT_DIST_PKGS:-}" ]; then
    echo "RUN_${_lbl}_DISTFRESH check=unavailable（取不到 apps/web 的 @heyta/* 依赖清单 ⇒ 这一趟没有新鲜度读数，不是「全新鲜」）"
    return 0
  fi
  _out=$(cd "$REPO_ROOT" && node scripts/dist-freshness.mjs --only "$HT_DIST_PKGS" 2>&1)
  _behind=$(printf '%s\n' "$_out" | grep -F '落后于源码的产物：' | head -1 | tr -cd '0-9')
  _miss=$(printf '%s\n' "$_out" | grep -F '缺产物：' | head -1 | tr -cd '0-9')
  if [ -z "$_behind" ] || [ -z "$_miss" ]; then
    echo "RUN_${_lbl}_DISTFRESH check=unavailable（体检没打那两行汇总 ⇒ 读数取不到，别读成 0）"
    printf '%s\n' "$_out" | sed 's/^/    DF /'
    return 0
  fi
  echo "RUN_${_lbl}_DISTFRESH pkgs=${HT_DIST_N} behind=${_behind} missing=${_miss}"
  # 有落后就把**是哪几个包**留在现场：只留汇总数字的话，下一位还得重跑一次才知道影响的是哪条腿
  if [ "$_behind" != "0" ] || [ "$_miss" != "0" ]; then
    printf '%s\n' "$_out" | grep -E '产物比源码旧|package.json 的 main' | sed 's/^/    DF /'
  fi
}

# 🔴 只扫现成的 trace，不开跑、不等窗口（2026-10-04 10:4x 加）。
#   为什么要这一档：判据 (a)「机制存在」要的是**一趟非零趟的 trace**，而本机 `e2e/test-results/` 里
#   就躺着别人 06:51 那趟红跑的 trace —— 没有这一档，要么重跑（抢窗）、要么手抄一遍 needle 数（第二套实现，等它漂）。
#   这一档和看守主体用的是**同一个 `ht_trace_scan`**，读数形状逐字相同（`scan=ok traces=… viteInTrace=…`）。
#   exit：扫到 ≥1 枚 trace 且 viteInTrace=yes ⇒ 0；扫了但没看见 vite 行 ⇒ 2（"扫描没看见"，不是"没有洪泛"）；
#   目录里根本没有 trace.zip / 没有 unzip ⇒ 3（够不着，不是读数）。
if [ "${1:-}" = "--scan" ]; then
  shift
  if [ "$#" -eq 0 ]; then
    echo "用法：bash research/tools/h-flaky-window-watcher.sh --scan <trace 目录>[ <更多目录>…]"
    exit 1
  fi
  seen_any=0; seen_vite=0
  _i=0
  for d in "$@"; do
    _i=$((_i + 1))
    if [ ! -d "$d" ]; then
      echo "SCAN_${_i} dir=$d scan=unavailable（目录不存在 ⇒ 这一格不是读数）"
      continue
    fi
    seen_any=1
    line=$(ht_trace_scan "$d" "SCAN_${_i}")
    printf '%s\n' "$line"
    case "$line" in *viteInTrace=yes*) seen_vite=1 ;; esac
  done
  if [ "$seen_any" = 0 ]; then echo "SCAN 没有任何目录可扫 ⇒ exit 3"; exit 3; fi
  if [ "$seen_vite" = 1 ]; then exit 0; fi
  echo "SCAN 扫到了 trace 但没看见任何 [vite] 行 ⇒ 这只否证「扫描看见了」，不否证「那趟没有洪泛」（exit 2）"
  exit 2
fi

# 🔴 `--co-probe <pgrep -f 正则>`：把"让路那一层"的读数拿出来单独验（臂 10 靠它）。
#    它**不建日志、不挂稳定名**（MODE 允许名单的形状：只有 run 档才挂），所以拿它做探针
#    不会摘走正在等的那趟看守的现场 —— 这正是 09:2x 与 10:5x 两起事故的判据。
if [ "${1:-}" = "--co-probe" ]; then
  if [ -z "${2:-}" ]; then echo "用法: bash $0 --co-probe '<pgrep -f 正则>'" >&2; exit 1; fi
  ht_pgrep "$2"
  exit 0
fi

# selftest 测「跑 + 留证 + 判别式计数」那一层，外加让路那一层的**图案识别**（臂 10）；
# 等窗口的完整循环（负载门 + 端口对照）不在 selftest 里，它的读数在真看守的日志里。
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
  # 🔴 臂1 的第四层（11:2x）：新鲜度体检必须**每趟自动打**，且形状里三个数都是现取的。
  #    这里刻意**不断具体值**（`pkgs` 有几个、有没有落后都由现场决定 —— 那是别人正在改不改源码的事），
  #    钉的是"这一趟留了可读的体检行"。取不到时装置打的是 `check=unavailable`（臂4 验那一路）。
  grep -qE 'RUN_1_DISTFRESH pkgs=[0-9]+ behind=[0-9]+ missing=[0-9]+' "$ST/l1" \
    || { echo "❌ 臂1 没打体检行（§5 第 1 条又被退回「靠人记得」）"; sed -n '1,6p' "$ST/l1" 2>/dev/null; bad=$((bad+1)); }
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
    # 🔴 臂4 的第二层 = 体检那条的**负向腿**（行为式，不需要测试专用开关）：
    #    最小树里没有 `apps/web/package.json` ⇒ 范围取不到 ⇒ 装置必须自报 `check=unavailable`，
    #    绝不能把"取不到范围"打成一个看起来像读数的 `behind=0`（今天已经为这一族修过两处）。
    grep -q 'RUN_1_DISTFRESH check=unavailable' "$ST/l4" \
      || { echo "❌ 臂4 的最小树里没有 apps/web/package.json，体检却报了具体数字或整行没打 ⇒「取不到」被伪装成了读数"; sed -n '1,8p' "$ST/l4" 2>/dev/null; bad=$((bad+1)); }
  fi
  rm -rf "$ST" 2>/dev/null
  # ── 臂 7（正向 + 负向，钉 10:4x 那两次扫描自己瞎了）：**路径里带空格**的 trace 必须照样解出来。
  #    起因（都是当场实测到的，不是推的）：`for _f in $_z` 把
  #    `/Users/…/Desktop/All in one Data/…`（**本仓绝对路径本来就有空格**）拆成 4 个"文件"，
  #    而 `( cd && unzip )` 在相对路径下找不到文件 —— 两种失败都被 `-q`+`2>/dev/null` 吞掉，
  #    症状与"那一趟没有洪泛"逐字相同（connect=0 / viteInTrace=no）。
  #    ⇒ 这一臂不靠活树，靠**自造夹具**：一枚含三条 needle 的 zip，放在带空格的目录里。
  FD="$ST/dir with space"; mkdir -p "$FD/yes" "$FD/no"
  if ! command -v zip >/dev/null 2>&1; then
    echo "   ⚠️ 臂7 未执行（本机没有 zip）⇒ 这一臂此刻没有牙，别把 selftest 的 ✅ 读成「空格路径也验过」"
  else
    printf '[vite] connecting...\n[vite] hot updated: /src/foo.ts\nCould not Fast Refresh (invalidation failed)\n' \
      > "$FD/yes/1-trace.trace"
    printf 'nothing to see\n' > "$FD/no/1-trace.trace"
    ( cd "$FD/yes" && zip -q trace.zip 1-trace.trace ) && ( cd "$FD/no" && zip -q trace.zip 1-trace.trace )
    R7=$(bash "$0" --scan "$FD/yes" >/dev/null 2>&1; echo $?)
    L7=$(bash "$0" --scan "$FD/yes" 2>&1)
    [ "$R7" = 0 ] || { echo "❌ 臂7 带空格路径的正向夹具应退 0，实际 $R7"; bad=$((bad+1)); }
    printf '%s\n' "$L7" | grep -q 'connect=1 hotUpdated=1 fastRefreshInvalidate=1 viteInTrace=yes' \
      || { echo "❌ 臂7 带空格的路径没把三条 needle 数出来 ⇒ 扫描又是恒 0 的了"; printf '%s\n' "$L7" | sed 's/^/      /'; bad=$((bad+1)); }
    R7N=$(bash "$0" --scan "$FD/no" >/dev/null 2>&1; echo $?)
    L7N=$(bash "$0" --scan "$FD/no" 2>&1)
    [ "$R7N" = 2 ] || { echo "❌ 臂7 负向夹具（zip 里零条 [vite]）应退 2，实际 $R7N"; bad=$((bad+1)); }
    printf '%s\n' "$L7N" | grep -q 'scan=ok' \
      || { echo "❌ 臂7 负向腿解不出 .trace ⇒ 它报的 no 是「扫描瞎」不是「没有洪泛」，两腿分不开"; bad=$((bad+1)); }
    [ "$bad" = 0 ] && echo "   ✅ 臂7：空格路径正向三条 needle 全数到 / 空 zip 负向仍走 scan=ok（两种「0」分得开）"
  fi
  # ── 臂 8（正负两腿，钉 10:5x 我新加 `--scan` 时复犯的那起"摘走别人的现场"）：
  #    负向 = `--scan` 不许动稳定名；正向 = 默认 run 档确实会挂上（没有正向，"不许动"可能只是恒不动）。
  SL="$ST/stable.lnk"; LT="$ST/live-run.log"; printf 'LIVE-READING\n' > "$LT"; ln -sf "$LT" "$SL"
  STABLE_LOG="$SL" bash "$0" --scan "$ST/dir with space/yes" >/dev/null 2>&1
  if [ "$(readlink "$SL")" = "$LT" ]; then
    echo "   ✅ 臂8 负向：--scan 跑完之后稳定名仍指向 run 那份（新档位摘不走看守的现场）"
  else
    echo "❌ 臂8 负向：--scan 把稳定名摘走了（$(readlink "$SL")）⇒ 正在等的那趟现场读不到了"; bad=$((bad+1))
  fi
  SL2="$ST/stable2.lnk"; printf 'PLACEHOLDER\n' > "$ST/ph.log"; ln -sf "$ST/ph.log" "$SL2"
  STABLE_LOG="$SL2" SKIP_GATE=1 RUNS=0 BUDGET=1 PW_CMD=true bash "$0" >/dev/null 2>&1
  T2=$(readlink "$SL2")
  if [ -n "$T2" ] && [ "$T2" != "$ST/ph.log" ] && [ -f "$T2" ]; then
    echo "   ✅ 臂8 正向：默认 run 档仍会新建每跑唯一的日志并挂上稳定名（⇒ 上面那条「不动」不是恒不动）"
  else
    echo "❌ 臂8 正向：run 档没有挂稳定名（${T2}）⇒ 装置与真实看守的行为已经不一样，负向那条不算证据"; bad=$((bad+1))
  fi
  # ── 臂 9（10-05 00:5x 立；10-05 17:5x 改形）。方向**不是**"把严格层放宽到规范门"，而是：
  #    ① 严格层的默认值必须仍然是 §5 H 那格写死的开工判据（个位 9）——
  #    这台机器上"窗口一直没开"是真的（规范门过了 4 次全被这层退回），但**降级判据不在这里做**；
  #    ② 它比规范门严多少必须**打进日志**，否则下一位只能从"零趟 e2e"反推是谁挡的（我 00:0x 就是这么撞上的）。
  # 🔴 第三腿原来是"对账三份 `ncpu×3/4` 抄件的分数字面"。本装置里那两行抄件刚刚删掉了
  #    （规范门的数改从 `host_load_gate` 要）—— 如果对账腿**不改**，它会变成恒真：
  #    抽取器 `.*[lL][iI][mM][iI][tT]=\$\(\(` 照样能从下面 9b 那句 `EXP_LIM=$((...))` 里取出一个分数，
  #    而那个分数是**这条臂自己算的**，不是本装置的判据（"文本里出现过"挡不住"其实没人用它"）。
  #    ⇒ 比对抄件的腿换成**钉委托**：本装置必须问 lib 要那个数和那次读数，
  #      并且留一条变异（把委托换回抄件）证明这条腿会红。
  #    ⚠️ 谓词按**行首赋值**取，不按"文件里出现过这串"：这一臂自己的文本里就有那几个串，
  #       按子串匹配的话它会一直读到自己（#191 那一族）。
  ht_frac(){ sed -nE 's/.*[lL][iI][mM][iI][tT]=\$\(\(.*\* *([0-9]+) *\/ *([0-9]+).*$/\1\/\2/p' "$1" 2>/dev/null | head -1; }
  ht_assign(){ sed -nE "/^[[:space:]]*$2=/p" "$1" 2>/dev/null | head -1; }
  delegation_ok(){ # $1 = 文件；0 = 这一份是把"规范门的数"和"那次读数"都**问 lib 要**的
    local n l
    n=$(ht_assign "$1" HT_NORM_LIMIT)
    l=$(ht_assign "$1" LOAD)
    case "$n" in *'HOST_LOAD_LIMIT'*) ;; *) return 1 ;; esac
    case "$l" in *'HOST_LOAD_VALUE'*) ;; *) return 1 ;; esac
    # 赋值右边**不许再带命令替换**：带了就是本装置自己算了一遍（第二把尺长回来了）。
    case "$n" in *'$('* | *'`'*) return 1 ;; esac
    case "$l" in *'$('* | *'`'*) return 1 ;; esac
    return 0
  }
  FR_G=$(ht_frac scripts/verify-mobile-window-gate.sh)
  FR_L=$(ht_frac scripts/lib/wait-for-quiet-host.sh)
  if ! delegation_ok research/tools/h-flaky-window-watcher.sh; then
    echo "❌ 臂9 本装置没在问 host_load_gate 要负载的数（HT_NORM_LIMIT/LOAD 的赋值形状不对，或又长出自己那份推导）⇒ 严格层与规范门可能重新变成两把尺"; bad=$((bad+1))
  elif [ -z "$FR_G" ] || [ -z "$FR_L" ]; then
    echo "❌ 臂9 闸门/lib 的分数抽取取空（g=${FR_G} l=${FR_L}）⇒ 装载式换了形状，这一臂此刻**没有读数**，不是「一致」"; bad=$((bad+1))
  elif [ "$FR_G" != "$FR_L" ]; then
    echo "❌ 臂9 闸门=${FR_G} 与 lib=${FR_L} 漂了 ⇒ 共享资源上那两把尺不是同一个裁判（闸门那份还没删，见台账登记的下一批）"; bad=$((bad+1))
  else
    printf 'limit=$((cores * 1 / 2))\n' > "$ST/frac-bad.sh"
    if [ "$(ht_frac "$ST/frac-bad.sh")" = "$FR_L" ]; then
      echo "❌ 臂9 抽取器把 1/2 也读成 ${FR_L} ⇒ 上面那条「一致」是恒值，没有牙"; bad=$((bad+1))
    fi
    # 变异（阳性对照 B）：把委托**换回**抄件 ⇒ delegation_ok 必须判不过。
    # 不落地就红：先数副本里那行确实变了，再判变异结果 —— 否则 rc=0 什么也不证明。
    sed 's|^HT_NORM_LIMIT="\${HOST_LOAD_LIMIT:-}"$|HT_NORM_LIMIT=$(( $(sysctl -n hw.ncpu) * 3 / 4 ))|' \
      research/tools/h-flaky-window-watcher.sh > "$ST/watcher-copy.sh"
    N_MUT=$(grep -c '^HT_NORM_LIMIT=\$(( ' "$ST/watcher-copy.sh" || true)
    if [ "$N_MUT" != "1" ]; then
      echo "❌ 臂9 变异没落地（副本里被换的行数=${N_MUT}，期望 1）⇒ 上面的 delegation_ok 没被测到"; bad=$((bad+1))
    elif delegation_ok "$ST/watcher-copy.sh"; then
      echo "❌ 臂9 变异存活：把委托换回 ncpu×3/4 抄件后 delegation_ok 照样放行 ⇒ 这条腿是装饰"; bad=$((bad+1))
    else
      echo "   ✅ 臂9a 本装置向 lib 要规范门的数与那次读数；闸门与 lib 的分数仍逐字相同（=${FR_L}）；"
      echo "      抽取器分得开 1/2，且把委托换回抄件的变异会被判红"
    fi
  fi
  EXP_LIM=$(( $(sysctl -n hw.ncpu) * 3 / 4 ))
  # 9b：默认必须还是 §5 H 那格写的"个位"（这里**故意写死 9** —— 它的权威是那一格判据，不是本脚本；
  #     谁把默认改成规范门，这一腿就红，逼他先去改那一格并留拍板人）。
  LOG="$ST/a9-def.log" env -u STRICT_MAX SKIP_GATE=1 RUNS=0 BUDGET=1 PW_CMD=true bash "$0" >/dev/null 2>&1
  grep -q "严格负载门≤9（规范门≤${EXP_LIM}）" "$ST/a9-def.log" 2>/dev/null \
    || { echo "❌ 臂9b 默认严格层不再是 §5 H 开工判据的个位 9（日志首行：$(sed -n '1p' "$ST/a9-def.log" 2>/dev/null)）⇒ 判据被这台看守悄悄放宽了"; bad=$((bad+1)); }
  grep -q "严格层 9 比规范门 ${EXP_LIM} 严 $(( EXP_LIM - 9 ))" "$ST/a9-def.log" 2>/dev/null \
    || { echo "❌ 臂9b 默认档没在日志里点名与规范门的差额 ⇒ 下一位仍旧要从「零趟 e2e」反推是谁挡的"; bad=$((bad+1)); }
  # 9b′：反向对照 —— 显式按规范门传值时那句差额警告**必须不打**（否则它是恒打，9b 那条不算证据）。
  LOG="$ST/a9-norm.log" STRICT_MAX="$EXP_LIM" SKIP_GATE=1 RUNS=0 BUDGET=1 PW_CMD=true bash "$0" >/dev/null 2>&1
  if grep -q '比规范门' "$ST/a9-norm.log" 2>/dev/null; then
    echo "❌ 臂9b′ 按规范门跑还打「比规范门严」⇒ 那句话不再携带信息"; bad=$((bad+1))
  else
    echo "   ✅ 臂9b 默认仍是个位 9 且点名差额；9b′ 按规范门传值时不打警告"
  fi
  LOG="$ST/a9-strict.log" STRICT_MAX=0 SKIP_GATE=1 RUNS=0 BUDGET=1 PW_CMD=true bash "$0" >/dev/null 2>&1
  grep -q "比规范门 ${EXP_LIM} 严 ${EXP_LIM}" "$ST/a9-strict.log" 2>/dev/null \
    || { echo "❌ 臂9c 显式 STRICT_MAX=0 没打出与规范门的差额 ⇒ 更严的那层再次隐形"; bad=$((bad+1)); }
  [ "$bad" = 0 ] && echo "   ✅ 臂9c 更严的显式值会在日志里点名差额"
  # ── 臂 10（10-05 00:3x）：让路那一层**只验过形状不够** —— 那两条 pgrep 正则必须真的认得
  #    重装的两个形态（源码名 `reinstall-all.sh` / 快照名 `.reinstall-all.sh.snap.<pid>`），
  #    而"认得"要有对照：现场基线先量（不假设真空），再各起一枚真进程数增量，
  #    并钉住**字面图案本身不算**（`[.]?` 若被当字面匹配，探针会把自己数成别人）。
  BASE_RE=$(bash "$0" --co-probe "$CO_REINSTALL_RE" 2>/dev/null | wc -w | tr -d ' ')
  ( exec -a "scripts/reinstall-all.sh" sleep 25 ) & P1=$!
  ( exec -a "scripts/.reinstall-all.sh.snap.$P1" sleep 25 ) & P2=$!
  ( exec -a "scripts/[.]?reinstall-all" sleep 25 ) & P3=$!
  sleep 1.2
  HITLIST=$(bash "$0" --co-probe "$CO_REINSTALL_RE" 2>/dev/null)
  HIT=$(printf '%s' "$HITLIST" | wc -w | tr -d ' ')
  if [ "$HIT" != "$(( BASE_RE + 2 ))" ]; then
    echo "❌ 臂10 基线 ${BASE_RE} → 起两枚后 ${HIT}（应 $(( BASE_RE + 2 ))）：[${HITLIST}] ⇒ 让路图案没认全这两个形态"; bad=$((bad+1))
  fi
  case " $HITLIST " in *" $P1 "*) ;; *) echo "❌ 臂10 源码形态（pid ${P1}）没被数到 ⇒ B 真在跑时 H 会当成没人跑"; bad=$((bad+1));; esac
  case " $HITLIST " in *" $P2 "*) ;; *) echo "❌ 臂10 快照形态（pid ${P2}）没被数到 ⇒ 同上一格，只是换了运行形态就失明"; bad=$((bad+1));; esac
  case " $HITLIST " in *" $P3 "*) echo "❌ 臂10 把**字面图案串**（pid ${P3}）当成了重装 ⇒ 这条正则会自匹配，读数不可信"; bad=$((bad+1));; *) echo "   ✅ 臂10 两个运行形态都数到、字面图案串没被误数";; esac
  SL3="$ST/stable3.lnk"; printf 'KEEPME\n' > "$ST/keep.log"; ln -sf "$ST/keep.log" "$SL3"
  bash "$0" --co-probe "$CO_REINSTALL_RE" >/dev/null 2>&1
  [ "$(readlink "$SL3")" = "$ST/keep.log" ] \
    || { echo "❌ 臂10 --co-probe 摘走了稳定名 ⇒ 又一档「新档位偷现场」（09:2x/10:5x 同族）"; bad=$((bad+1)); }
  kill $P1 $P2 $P3 2>/dev/null
  # 留证这一层的两腿就是臂 1 与臂 3：「恒删」坏在臂 3，「恒留」坏在臂 1。
  [ "$bad" = 0 ] && { echo "✅ selftest 十臂成立（带对的 --output / 判别式数得出来 / 绿删红留 / 摘掉必分得开 / 前缀行不算通道活着 / trace 扫得出来且空 zip 会自报瞎 / 空格路径与空夹具两种「0」分得开 / 新档位摘不走稳定名而 run 档照挂 / 严格层默认仍按 §5 H 的个位 9、且点名与规范门的差额 / 让路图案认得重装的两个运行形态且不自匹配）"; exit 0; }
  echo "selftest 有 $bad 条不成立 ⇒ 装置坏（exit 4），不是产品坏"; exit 4
fi

# 🔴 原来这一行是 `mv "$LOG" "$LOG.prev"`：换成每跑唯一之后**必须删掉** ——
#    它会把本轮刚建的唯一日志搬走，后面的 `>> "$LOG"` 再新建一份空的，等于自己截掉自己的现场。
echo "start $(date '+%T') 连跑=$RUNS 严格负载门≤${STRICT_MAX}（规范门≤${HT_NORM_LIMIT}） 总预算=${BUDGET}s 日志=$LOG 稳定名=$STABLE_LOG(挂上=$STABLE_TIED)" >> "$LOG"
if [ "$STRICT_MAX" -lt "$HT_NORM_LIMIT" ]; then
  echo "  ⚠️ 严格层 ${STRICT_MAX} 比规范门 ${HT_NORM_LIMIT} 严 $(( HT_NORM_LIMIT - STRICT_MAX ))（值来自 §5 H 那格的开工判据「负载落回个位」；要按规范门跑得显式传 STRICT_MAX=${HT_NORM_LIMIT}）" >> "$LOG"
fi

START=$(date +%s)
while [ "${SKIP_GATE:-0}" != "1" ]; do
  wait_for_quiet_host >> "$LOG" 2>&1 || { echo "GATE=timeout rc=3" >> "$LOG"; exit 3; }
  # 🔴 严格层要的是**规范门刚过之后的一次新读数**，所以这里再问一次 `host_load_gate`，
  #    而不是自己 `uptime | sed | awk`（那第三份抄件已经在上面删掉了；这里当时漏删）。
  #    判定不在 host_load_gate 那一层（它按规范门判），这一层拿它导出的现量自己比 STRICT_MAX。
  host_load_gate >> "$LOG" 2>&1 || true
  LOAD="${HOST_LOAD_VALUE}"
  [ -n "$LOAD" ] || { echo "GATE=probe-broken 负载读数取不到（HOST_LOAD_VALUE 为空）⇒ 探针坏了，不把它读成「负载为 0」" >> "$LOG"; exit 4; }
  if [ "$LOAD" -gt "$STRICT_MAX" ]; then
    echo "  严格层：负载 ${LOAD} > ${STRICT_MAX}（规范门≤${HT_NORM_LIMIT}），再等" >> "$LOG"
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
      CHAIN_PID=$(ht_pgrep "$CO_CHAIN_RE")
      # 🔴 让路那一格原来只认 C 链，而 B 的四端重装跑起来是 30 分钟量级、会把这道门的负载
      #    整个抬走（10-05 00:2x 补）：B 看守那边让的是"H 看守在**等**"，H 这边让的是"别人在**跑**"，
      #    两边各缺一格时会在同一个窗口里同时开火 —— 重装和 e2e 的读数互相污染。
      RE_PID=$(ht_pgrep "$CO_REINSTALL_RE")
      if [ -n "$CHAIN_PID" ]; then
        echo "  CO_CHAIN=alive pid=${CHAIN_PID% } —— 让路给设备链，本轮不开 e2e" >> "$LOG"
      elif [ -n "$RE_PID" ]; then
        echo "  CO_REINSTALL=alive pid=${RE_PID% } —— 让路给四端重装，本轮不开 e2e" >> "$LOG"
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
REPO_ROOT=$(cd .. && pwd)
# 新鲜度体检的**范围**现取（见 ht_dist_report：手抄的包清单会漂）
HT_DIST_PKGS=$(node -e 'try{var p=require(process.argv[1]),d=Object.assign({},p.dependencies,p.devDependencies);console.log(Object.keys(d).filter(function(x){return x.indexOf("@heyta/")===0}).map(function(x){return x.split("/")[1]}).join(","))}catch(e){}' "$REPO_ROOT/apps/web/package.json" 2>/dev/null)
HT_DIST_N=$(printf '%s' "${HT_DIST_PKGS:-}" | tr ',' '\n' | grep -c .)
FLAKY_RUNS=0
for i in $(seq 1 "$RUNS"); do
  echo "----- 第 $i 趟 $(date '+%T') -----" >> "$LOG"
  ht_dist_report "$i" >> "$LOG"
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
