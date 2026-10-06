#!/usr/bin/env bash
#
# 本轮收口新加/换掉的判据，逐条"必须能红"的变异验证
# ===================================================
#
# AGENTS §8.3：**不能失败的检查没有价值。** 这里覆盖的是本轮三件判据改动，
# 每一件都只在"合规输入"上跑过一次是不够的 —— 那只能证明它不误伤，证明不了它有牙齿。
#
#   G1 指纹相符 ⇒ RC=0                                    （正常路径）
#   G2 把清单里的指纹改一位 ⇒ RC=1 且**两把哈希都打出来**   （产物没跟着 lockfile 重渲染）
#      ⚠️ 变异必须**换一位而不是插一位**：插了就成 17 位，判据会走"没有指纹行"那条分支
#         （也红，但不是这一例要抓的东西）。两种形状都红是刻意的 —— 宁可误报也不静默放行。
#   G3 把指纹整行删掉 ⇒ RC=1 且指名"加判据之前渲染的"       （判据被绕过，而不是被满足）
#   G4 **只换 lockfile、清单不动** ⇒ RC=1 报"已过期"        （G-1 那次六天事故的形状）
#   L1 负载恒超标 ⇒ RC=1 + "环境无效"                      （负载门的牙齿）
#   L2 负载达标 ⇒ RC=0                                     （阳性对照：不许误挡）
#   L3 负载 == 阈值 ⇒ RC=0                                 （边界是 ≤ 不是 <）
#   L4 99→99→2 ⇒ 等两轮后第三次读数放行，且不多等           （等待序列与旋钮）
#   P1 起一个 argv 真带着 `verify-mobile-` 的活进程 ⇒ 盲探针报 0（**它看不见真运行**）
#   P2 同一个活进程 ⇒ `pgrep -f 'verify-mobile-'` 命中它，清理后回到改动前的基线
#   S1 负载门只有一个定义处，restore/repeat 各自 source 一次（抽单一所有者之后不许再漂回去）
#
# 🔴 G1–G4 跑在**临时目录**里，且那份临时"检出"里**没有 node_modules** ——
#    这不只是隔离：`--check-stamp` 能上 CI 的全部前提就是"不装任何东西也能判"，
#    所以这条判据必须连"没有 store 也可跑"一起验。
# ⚠️ P1/P2 只 `pkill` 自己那个带 `closeout-fixture` 标签的子进程，
#    **绝不**按 `verify-mobile` 去杀 —— 那是别人正在跑的设备验收。
#
#   node/bash 跑它：bash scripts/mutate-closeout-gates.sh   （非零退出 = 有判据没牙齿）
#
# ⚠️ 本仓库一律按 **bash 3.2**（macOS 自带）写：不用 `declare -A`。

set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
ok() { printf '  ✅ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL + 1)); }
say() { printf '\n--- %s\n' "$1"; }

say "G) 许可证清单新鲜度判据（--check-stamp，无 node_modules 的临时检出）"
T="$(mktemp -d)/stamp"
mkdir -p "$T/research/tools"
cp "$REPO/research/tools/render-license-inventory.mjs" "$T/research/tools/"
cp "$REPO/research/licenses-inventory.generated.md" "$T/research/"
cp "$REPO/pnpm-lock.yaml" "$T/"
[ -d "$T/node_modules" ] && { echo "  🔴 临时检出里居然有 node_modules —— 这一组就不算'CI 形态'了"; FAIL=$((FAIL + 1)); }

stamp() { ( cd "$T" && node research/tools/render-license-inventory.mjs --check-stamp ) 2>&1; }
out="$(stamp)"; r="$?"
if [ "$r" = "0" ] && printf '%s' "$out" | grep -q '对得上当前 lockfile'; then
  ok "G1 相符 ⇒ RC=0（且它没试图去扫 store）"
else
  no "G1 正常路径就红：RC=$r / $out"
fi

perl -pi -e 's/(lockfile 指纹：`)([0-9a-f])/${1}f/' "$T/research/licenses-inventory.generated.md"
out="$(stamp)"; r="$?"
if [ "$r" = "1" ] && printf '%s' "$out" | grep -q '已过期' && printf '%s' "$out" | grep -q '而当前是'; then
  ok "G2 改一位指纹 ⇒ RC=1 且两把哈希都打出来"
else
  no "G2 该红没红：RC=$r / $out"
fi

perl -ni -e 'print unless /lockfile 指纹/' "$T/research/licenses-inventory.generated.md"
out="$(stamp)"; r="$?"
if [ "$r" = "1" ] && printf '%s' "$out" | grep -q '没有 lockfile 指纹行'; then
  ok "G3 整行删掉 ⇒ RC=1 且指名'加判据之前渲染的'（不是静默放行）"
else
  no "G3 该红没红：RC=$r / $out"
fi

cp "$REPO/research/licenses-inventory.generated.md" "$T/research/"
printf '# 一行与清单无关的 lockfile 变化\n' >> "$T/pnpm-lock.yaml"
out="$(stamp)"; r="$?"
if [ "$r" = "1" ] && printf '%s' "$out" | grep -q '已过期'; then
  ok "G4 只换 lockfile、清单不动 ⇒ RC=1（这正是 CDG-1 那次六天过期）"
else
  no "G4 该红没红：RC=$r / $out"
fi
rm -rf "$(dirname "$T")"

say "L) 负载门 wait_for_quiet_host（桩 uptime/sleep/memory_pressure，走的是真函数）"
LIB="$REPO/scripts/lib/wait-for-quiet-host.sh"
gate() { # $1 = uptime 桩函数体（N 递增时用它自己的形态），$2 = 额外 env
  /bin/bash -c "set -u
. '$LIB'
$1
sleep(){ :; }
# 🔴 内存那一格从 2026-10-05 起长在 wait_for_quiet_host 的**放行路径**上 ⇒ 不桩它，
#    L2/L3/L4 的结论就取决于"跑这套臂时这台机还剩多少内存"：机器一紧，负载臂会红在
#    和它无关的事上（这种臂最坏的地方是它红得看起来很有道理）。桩只喂数，判决走真函数、
#    真解析。喂的那一行是**照真输出的字形抄的**（/usr/bin/memory_pressure -Q 实测两行，
#    判决行是第二行）—— 桩自创格式的话，解析器改了也能一直绿。
#    这一格自己的两向 + 探针故障三臂在下面 M) 段，不靠这里的默认放行蒙过去。
memory_pressure(){ echo 'The system has 68719476736 (4194304 pages with a page size of 16384).'; echo 'System-wide memory free percentage: 51%'; }
$2
wait_for_quiet_host; echo RC=\$?" 2>&1
}
out="$(gate 'uptime(){ echo " 03:30:00 up 1, load averages: 99.11 30 20"; }' 'export HEYTA_LOAD_GATE_WAIT=0')"
if printf '%s' "$out" | grep -q 'RC=1' && printf '%s' "$out" | grep -q '环境无效'; then
  ok "L1 恒超标 ⇒ RC=1 并说明是'环境无效'（调用方据此 exit 3，不是产品失败）"
else
  no "L1 该红没红：$out"
fi
out="$(gate 'uptime(){ echo " 03:30:00 up 1, load averages: 2.00 30 20"; }' '')"
if printf '%s' "$out" | grep -q 'RC=0'; then ok "L2 低负载放行（阳性对照）"; else no "L2 误挡：$out"; fi

LIMIT=$(( $(sysctl -n hw.ncpu) * 3 / 4 ))
out="$(gate "uptime(){ echo \" 03:30:00 up 1, load averages: ${LIMIT}.00 3 2\"; }" '')"
if printf '%s' "$out" | grep -q 'RC=0'; then ok "L3 负载 == 阈值（${LIMIT}）放行"; else no "L3 边界误挡：$out"; fi

CNT="$(mktemp)"
out="$(/bin/bash -c "set -u
. '$LIB'
N=0
uptime(){ N=\$(( \$(cat '$CNT') + 1 )); echo \$N > '$CNT'
  if [ \"\$N\" -le 2 ]; then echo ' 03:30:00 up 1, load averages: 99.11 3 2'
  else echo ' 03:30:00 up 1, load averages: 2.00 3 2'; fi; }
sleep(){ :; }
memory_pressure(){ echo 'System-wide memory free percentage: 51%'; }
export HEYTA_LOAD_GATE_INTERVAL=45 HEYTA_LOAD_GATE_WAIT=900
wait_for_quiet_host; echo RC=\$?" 2>&1)"
rm -f "$CNT"
if printf '%s' "$out" | grep -q '累计 0s' && printf '%s' "$out" | grep -q '累计 45s' \
  && ! printf '%s' "$out" | grep -q '累计 90s' && printf '%s' "$out" | grep -q 'RC=0'; then
  ok "L4 等两轮（45s 间隔生效）后第三次读数即放行，且不多等"
else
  no "L4 等待序列不对：$out"
fi

# ── 负载那一格的读数**字形**也必须有牙（traps #168 的落地判据）────────────
# 这一臂不是凑数：`awk '{print int($1)}'` 会把 `junk` 折成 **0**、把 #168 那串
# `31.4729.0034.04` 折成 **31** —— 也就是说"探针整个读不出来"在原实现里**长得像放行**
# （0 ≤ 12）。现在 `host_load_gate` 先验字形，两种坏读数都必须响亮地不放行。
say "M) 负载读数的字形校验：junk 与 #168 粘连串都不许读成一个合法数"
for shape in 'junk' '31.4729.0034.04' ''; do
  out="$(gate "uptime(){ echo \" 03:30:00 up 1, load averages: ${shape:-空} 3 2\"; }" 'export HEYTA_LOAD_GATE_WAIT=0')"
  if printf '%s' "$out" | grep -q '按探针故障处理' && printf '%s' "$out" | grep -q 'RC=1'; then
    ok "M1 读数为〈${shape:-空}〉 ⇒ 判探针故障且不放行（原来这一路会读成 0 或 31）"
  else
    no "M1 坏读数〈${shape:-空}〉没被拦：$out"
  fi
done

say "N) 内存门：两向都有读数，低内存必须挡得住，探针坏不许冒充「内存够」"
memgate(){ # $1 = memory_pressure 桩的那一行，$2 = 额外 env
  /bin/bash -c "set -u
. '$LIB'
uptime(){ echo ' 03:30:00 up 1, load averages: 2.00 3 2'; }
memory_pressure(){ $1; }
$2
host_memory_gate; echo RC=\$?" 2>&1
}
out="$(memgate "echo 'System-wide memory free percentage: 3%'" 'export HEYTA_MEM_GATE_MIN_PCT=10')"
if printf '%s' "$out" | grep -q 'RC=1' && printf '%s' "$out" | grep -q '不达标'; then
  ok "N1 负载已过、内存 free=3% < 阈值 10% ⇒ 判不过（这一格不是装饰）"
else
  no "N1 该红没红：$out"
fi
out="$(memgate "echo 'System-wide memory free percentage: 3%'" 'export HEYTA_MEM_GATE_MIN_PCT=1')"
if printf '%s' "$out" | grep -q 'RC=0'; then
  ok "N2 同一份低读数、阈值放到 1 ⇒ 放行（阳性对照：N1 的红由阈值造成，不是桩坏了）"
else
  no "N2 阳性对照没放行：$out"
fi
out="$(memgate "echo 'The system has 68719476736 (4194304 pages with a page size of 16384).'" '')"
if printf '%s' "$out" | grep -q 'RC=1' && printf '%s' "$out" | grep -q '探针故障'; then
  ok "N3 输出里没有 free 百分比 ⇒ 判**不过**并点名探针故障（不许读成「内存够」）"
else
  no "N3 探针故障没被拦：$out"
fi
out="$(memgate "echo 'System-wide memory free percentage: 3%'" 'export HEYTA_MEM_GATE_MIN_PCT=abc')"
if printf '%s' "$out" | grep -q 'RC=1' && printf '%s' "$out" | grep -q '不是整数'; then
  ok "N4 阈值旋钮给了非整数 ⇒ 按探针故障处理，不放行"
else
  no "N4 坏旋钮被放行了：$out"
fi
# N5：长在 wait_for_quiet_host 里的那一次调用必须有牙 —— 摘掉它，低内存就该放行。
MUTD=$(mktemp -d)
MUTF="$MUTD/wait-for-quiet-host.sh"
cp "$LIB" "$MUTF"
python3 - "$MUTF" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
needle = "    if host_memory_gate; then\n"
n = s.count(needle)
if n != 1:
    print("MUT_NOT_LANDED=%d" % n)
    sys.exit(3)
open(p, "w", encoding="utf-8").write(s.replace(needle, "    if :; then\n"))
print("MUT_LAND=1")
PY
MUT_RC=$?
out=''
if [ "$MUT_RC" = "0" ]; then
  out="$(/bin/bash -c "set -u
. '$MUTF'
uptime(){ echo ' 03:30:00 up 1, load averages: 2.00 3 2'; }
sleep(){ :; }
memory_pressure(){ echo 'System-wide memory free percentage: 3%'; }
export HEYTA_MEM_GATE_MIN_PCT=10
wait_for_quiet_host; echo RC=\$?" 2>&1)"
fi
rm -rf "$MUTD"
if [ "$MUT_RC" != "0" ]; then
  no "N5 变异没落地（rc=${MUT_RC}，见 MUT_NOT_LANDED）⇒ 下面的 rc 什么都不证明"
elif printf '%s' "$out" | grep -q 'RC=0'; then
  ok "N5 摘掉 wait_for_quiet_host 里的那次调用 ⇒ free=3% 也照样起跑（变异转绿正好证明这一格在真代码里是承重的）"
else
  no "N5 🔴 摘掉那次调用后低内存仍然不放行 ⇒ 挡它的不是这一格，上面 N1 那条红另有来源（探针？预算？）"
fi

say "P) 设备占用探针：活的对照组（这条是台账 #180 的正文所依据的实测）"
base="$(pgrep -f 'verify-mobile-' | grep -c . || true)"
bash -c 'sleep 25; echo closeout-fixture verify-mobile-repeat' >/dev/null 2>&1 &
FIX=$!
sleep 1
blind="$(ps Axo command | grep -F 'verify-mobil[e]' | grep -v 'grep -F' | grep -c . || true)"
seen="$(pgrep -f 'verify-mobile-' | grep -c . || true)"
kill "$FIX" 2>/dev/null
wait "$FIX" 2>/dev/null
after="$(pgrep -f 'verify-mobile-' | grep -c . || true)"
if [ "$blind" = "0" ]; then
  ok "P1 有一个 argv 真带着 verify-mobile- 的活进程，而 grep -F 'verify-mobil[e]' 报 0 ⇒ 它看不见真运行（-F 把 [e] 当字面量）"
else
  no "P1 预期盲探针报 0，实际 $blind —— 对照组可能没起来，这一组读数不作数"
fi
if [ "$seen" -ge 1 ] && [ "$after" = "$base" ]; then
  ok "P2 pgrep -f 'verify-mobile-' 命中活对照组（${seen}），清理后回到基线（${base}→${after}）⇒ 既不盲也不数观察者"
else
  no "P2 pgrep 不成立：命中 $seen / 基线 $base → 清理后 $after"
fi

say "S) 单一所有者没有再漂回去"
# 🔴 判据锚在"行首的定义形状"上，而不是 `grep 'wait_for_quiet_host()'`：
#    后者会把**本文件自己那一行 grep 命令**算成第二处定义（门禁命中自己的夹具，实测就发生过）。
# ⚠️ 原来这条还钉死了 `source 语句 == 2 处`。**那个 2 是某一天的消费者数量**，
#    不是不变量 —— 消费者只会越长越多（今天实测 6 处），于是这条臂在第三个人接入的那天
#    就变成了"新接入 = 红"，而红的含义恰恰和它想防的东西相反（正文别存会漂的值，同一条教训）。
#    换成真正不变的那条：**凡是调用这三个谓词的文件，都必须 source 那份 lib**
#    （调用而不 source 只有一种可能 —— 它自带了一份抄件，那才是要拦的事）。
defs=0
for fn in wait_for_quiet_host host_load_gate host_memory_gate; do
  d="$(grep -rlE "^[[:space:]]*${fn}[[:space:]]*\([[:space:]]*\)[[:space:]]*\{" "$REPO/scripts" "$REPO/research/tools" 2>/dev/null | grep -v '\.snap\.' | grep -c . || true)"
  [ "$d" = "1" ] || { no "S ${fn} 定义了 $d 处（期望恰好 1，且在 lib 里）"; continue; }
  defs=$((defs + 1))
done
CALLERS=$(grep -rlE '^[[:space:]]*(if[[:space:]]+[^;]* )?(wait_for_quiet_host|host_load_gate|host_memory_gate)([[:space:]]|[;&]|$)' "$REPO/scripts" "$REPO/research/tools" \
  --include='*.sh' 2>/dev/null | grep -v '\.snap\.' | grep -v 'lib/wait-for-quiet-host.sh' | grep -v 'mutate-closeout-gates.sh' | sort -u)
SRCERS=$(grep -rlE '^[[:space:]]*\. .*lib/wait-for-quiet-host\.sh' "$REPO/scripts" "$REPO/research/tools" --include='*.sh' 2>/dev/null | grep -v '\.snap\.' | sort -u)
ORPHAN=''
while IFS= read -r c; do
  [ -n "$c" ] || continue
  printf '%s\n' "$SRCERS" | grep -Fxq "$c" || ORPHAN="$ORPHAN${c}
"
done <<CALL_BLOCK
$CALLERS
CALL_BLOCK
N_CALL=$(printf '%s\n' "$CALLERS" | grep -c . || true)
N_SRC=$(printf '%s\n' "$SRCERS" | grep -c . || true)
N_ORPHAN=$(printf '%s\n' "$ORPHAN" | grep -c . || true)
if [ "$defs" = "3" ] && [ "$N_CALL" -ge 1 ] && [ "$N_ORPHAN" = "0" ]; then
  ok "S 三个谓词各定义 1 处；$N_CALL 个调用方全部 source 了那份 lib（$N_SRC 处 source）⇒ 没有第二把尺"
else
  no "S 完整度不成立（谓词定义 ${defs}/3，调用方 ${N_CALL}，未 source lib 的调用方 ${N_ORPHAN}）：$(printf '%s' "$ORPHAN" | tr '\n' ' ')"
fi
# 阳性对照：拿一份"把 source 那行摘掉、但仍然调用谓词"的副本喂给上面那个孤儿循环，
# 它必须把这份副本点名成未 source 的调用方（否则"全部 source"是恒值）。
MUTD2=$(mktemp -d)
cp "$REPO/research/tools/r17-reshoot-stale.sh" "$MUTD2/" || { no "S2 副本没建出来"; }
sed -i.bak '/^[[:space:]]*\. scripts\/lib\/wait-for-quiet-host\.sh$/d' "$MUTD2/r17-reshoot-stale.sh" 2>/dev/null
N_SRC_LINE=$(grep -cE '^[[:space:]]*\. scripts/lib/wait-for-quiet-host\.sh$' "$MUTD2/r17-reshoot-stale.sh" || true)
N_CALL_LINE=$(grep -cE '^[[:space:]]*(if [^;]* )?host_(load|memory)_gate' "$MUTD2/r17-reshoot-stale.sh" || true)
MUT_CALLS=$(grep -rlE '^[[:space:]]*(if[[:space:]]+[^;]* )?(wait_for_quiet_host|host_load_gate|host_memory_gate)([[:space:]]|[;&]|$)' "$MUTD2" \
  --include='*.sh' 2>/dev/null | grep -v 'lib/wait-for-quiet-host.sh' | sort -u)
ORPHAN2=''
while IFS= read -r c; do
  [ -n "$c" ] || continue
  printf '%s\n' "$SRCERS" | grep -Fxq "$c" || ORPHAN2="$ORPHAN2${c}
"
done <<MUT_BLOCK
$MUT_CALLS
MUT_BLOCK
N_ORPHAN2=$(printf '%s\n' "$ORPHAN2" | grep -c . || true)
rm -rf "$MUTD2"
if [ "$N_SRC_LINE" != "0" ]; then
  no "S2 变异没落地（副本里 source 那行还在，计数=${N_SRC_LINE}）⇒ 下面什么都不证明"
elif [ "$N_CALL_LINE" = "0" ]; then
  no "S2 变异把调用也一起摘掉了（副本里已经不调谓词）⇒ 测的不是'调用而不 source'那个形状"
elif [ "$N_ORPHAN2" = "1" ]; then
  ok "S2 阳性对照成立：同一套谓词、只摘掉 source 的那份副本被点名成孤儿（$N_ORPHAN2 处），真树里是 0 处"
else
  no "S2 🔴 摘掉 source 的副本没被抓成孤儿（计数=${N_ORPHAN2}）⇒ 上面那条'全部 source'是恒值"
fi

say "U) settle_for 的三种时刻：见到才算、见不到必须红、隔几轮才出现也要等到"
# 🔴 这一组**不碰真的 /tmp/ui.xml**（那台机器上可能正有别人的设备验收在读它）。
#    W0b ① 之后改的是**注入环境变量**而不是改写函数体：lib 里的 `settle_for`
#    读的就是 `"$UI_XML"`，把夹具路径从外面喂进去，测到的就是脚本本体。
#    （原来这里是把函数体里的路径 `sed` 成临时路径 —— 那等于**测的是一份副本**：
#    副本绿不说明本体绿，而本体改成别的变量名时副本照样是绿的。）
UFD=$(mktemp -d); UXML="$UFD/ui.xml"
UFN="$(sed -n '/^settle_for() {/,/^}/p' "$REPO/scripts/lib/mobile-e2e.sh")"
[ -n "$UFN" ] || { no "U0 没从 lib 里取出 settle_for 函数体（形状变了？）"; }
dump_stub='dump(){ :; }; '
printf '<hierarchy><node text="立即同步"/></hierarchy>' > "$UXML"
if UI_XML="$UXML" bash -c "${dump_stub}${UFN}; settle_for '立即同步' 3 0"; then
  ok "U1 界面上就有 → 返回 0"
else
  no "U1 有却说没有（正向对照失败）"
fi
printf '<hierarchy><node text="别的界面"/></hierarchy>' > "$UXML"
if UI_XML="$UXML" bash -c "${dump_stub}${UFN}; settle_for '立即同步' 3 0"; then
  no "U2 🔴 界面上一路都没有却返回 0 —— 这条判据没牙"
else
  ok "U2 一路都没有 → 返回 1（调用方那句 bad 照样会红）"
fi
printf '<hierarchy><node text="别的界面"/></hierarchy>' > "$UXML"
( sleep 0.5; printf '<hierarchy><node text="立即同步"/></hierarchy>' > "$UXML" ) &
if UI_XML="$UXML" bash -c "${dump_stub}${UFN}; settle_for '立即同步' 8 1"; then
  ok "U3 第 1 秒才出现也等到（不是一次性读数）"
else
  no "U3 中途出现的没等到 —— 还是在猜固定 sleep"
fi
wait 2>/dev/null || true
rm -rf "$UFD"

say "V) 第 7 步的逐屏收集：区块在首屏之外必须算数，真缺一个必须报红"
# 🔴 载体：**从脚本里原样抽出收集块**（不另抄一份逻辑 —— 抄的那份迟早和脚本漂移），
#    把它的三个观测函数与 dump 接到"虚拟滚动"夹具上：一屏一个 XML，往下滚=下一屏，
#    往上滚=上一屏。这样测的是脚本本体，而真 `/tmp/ui.xml` 一个字都不碰
#    （那台机器上随时可能正有别人的设备验收在读它）。
#    W0b ① 之后夹具路径经 `UI_XML` 注入，不再改写抽出来的函数体。
VFD=$(mktemp -d); VXML="$VFD/ui.xml"; VSCR="$VFD/screens"; mkdir -p "$VSCR"
HFN="$(grep -E '^has_(text|desc|desc_sub)\(\)' "$REPO/scripts/lib/mobile-e2e.sh")"
[ -n "$HFN" ] || no "V0 没从 lib 里取出那三个观测函数（形状变了？）"
VBLK="$(awk 'f && /^  if \[/{exit} f{print} /^  DOWN=0$/{f=1}' "$REPO/scripts/verify-mobile-repeat.sh")"
[ -n "$VBLK" ] || no "V0 没从第 7 步抽出收集块（形状变了？）"
cat > "$VFD/stubs.sh" <<'VSTUB'
VPOS=0; VDN=0; VUP=0
sleep(){ :; }
dump(){ cat "$VDIR/$VPOS.xml" > "$VXML"; }
ADB=swipe_stub
swipe_stub(){
  if [ "$5" = 1900 ]; then VDN=$((VDN+1)); VPOS=$((VPOS+1)); [ "$VPOS" -gt 2 ] && VPOS=2
  else VUP=$((VUP+1)); VPOS=$((VPOS-1)); [ "$VPOS" -lt 0 ] && VPOS=0; fi
}
VSTUB
run_vcase() {
  cat "$VFD/stubs.sh" > "$VFD/prog.sh"
  printf '%s\n' "$HFN" >> "$VFD/prog.sh"
  printf '%s\n' "$VBLK" >> "$VFD/prog.sh"
  cat >> "$VFD/prog.sh" <<'VTAIL'
echo "HAS=$HAS_HEADING MIS=$MISSING DOWN=$DOWN DN=$VDN UP=$VUP POS=$VPOS"
VTAIL
  VDIR="$VSCR" VXML="$VXML" UI_XML="$VXML" bash "$VFD/prog.sh"
}

# —— V1：真实形状（整块在首屏之外，滚两屏收齐）——
printf '<hierarchy><node text="截止 2026-10-03"/></hierarchy>\n' > "$VSCR/0.xml"
printf '<hierarchy><node text="重复"/><node content-desc="不重复"/><node content-desc="每天"/><node content-desc="每周"/></hierarchy>\n' > "$VSCR/1.xml"
printf '<hierarchy><node content-desc="工作日"/><node content-desc="每月"/><node content-desc="每年"/></hierarchy>\n' > "$VSCR/2.xml"
V1=$(run_vcase)
if [ "$V1" = "HAS=1 MIS=: DOWN=2 DN=2 UP=2 POS=0" ]; then
  ok "V1 区块在首屏之外：滚 2 屏收齐、两个断言都算绿（原来这两条实测三趟全红）"
else
  no "V1 首屏之外收齐没做到？读数是「${V1}」"
fi

# —— V2：六个预设里真的少一个（正是 W3 担心的"产物里没有每年"）——
printf '<hierarchy><node content-desc="工作日"/><node content-desc="每月"/></hierarchy>\n' > "$VSCR/2.xml"
V2=$(run_vcase)
if [ "$V2" = "HAS=1 MIS=:每年: DOWN=5 DN=5 UP=5 POS=0" ]; then
  ok "V2 缺「每年」时照样报缺（收集逻辑不是"滚到就算全有"）"
else
  no "V2 🔴 缺一个却没报出来，读数是「${V2}」—— 这条判据没牙"
fi

# —— V3：整个区块都没接上 ——
printf '<hierarchy><node text="截止 2026-10-03"/></hierarchy>\n' > "$VSCR/1.xml"
printf '<hierarchy><node text="提醒"/></hierarchy>\n' > "$VSCR/2.xml"
V3=$(run_vcase)
if [ "$V3" = "HAS=0 MIS=:不重复:每天:每周:工作日:每月:每年: DOWN=5 DN=5 UP=5 POS=0" ]; then
  ok "V3 整块不存在时两条都红（滚满 5 屏也不会自己变绿）"
else
  no "V3 🔴 整块没有却读出「${V3}」—— 这条判据没牙"
fi
rm -rf "$VFD"

say "W) W0b ①②：现场路径的旋钮与库名默认值漂移守卫"
# 这四条各挡一种真实坏法：
#   W1 默认值被改 → 单轮运行行为变了（本批的立场是"默认值逐字不变"）
#   W2 旋钮没接上 → 环境变量设了个寂寞，并行两轮还在共用同一个现场
#   W3 **半套现场** → grep 类断言切到变量了、python 那几处还读字面量。
#      这一种最阴：设了变量之后看起来隔离了，实际上一半读新的、一半读旧的。
#   W4 漂移守卫自己坏了 → lib 与建库脚本各说一个库名，而横幅只印一个
LIB="$REPO/scripts/lib/mobile-e2e.sh"
UP="$REPO/scripts/mobile-e2e-up.sh"

W1=$(env -u HEYTA_E2E_UI_XML -u HEYTA_E2E_XY_PY bash -c "set -u; . '$LIB'; printf '%s|%s' \"\$UI_XML\" \"\$XY_PY\"" 2>/dev/null || true)
if [ "$W1" = "/tmp/ui.xml|/tmp/_xy.py" ]; then
  ok "W1 不给变量时两个路径**逐字等于原来的字面量**（${W1}）"
else
  no "W1 🔴 默认值变了或读不到，实测「${W1}」—— 单轮运行的行为就不再是不变的"
fi

W2=$(HEYTA_E2E_UI_XML=/tmp/private-run.xml HEYTA_E2E_XY_PY=/tmp/private-run.py bash -c "set -u; . '$LIB'; printf '%s|%s' \"\$UI_XML\" \"\$XY_PY\"" 2>/dev/null || true)
if [ "$W2" = "/tmp/private-run.xml|/tmp/private-run.py" ]; then
  ok "W2 给变量时两个路径跟着走（${W2}）"
else
  no "W2 🔴 旋钮没接上，实测「${W2}」—— 并行两轮仍会共用同一个快照文件"
fi

# 🔴 计数前先确认这把尺子有刻度：同一套过滤喂给一个**必然命中**的样本，必须数出 1。
#    （没有这条正向对照时，"计数为 0"可能只是过滤写坏了 —— 台账里那族空测量。）
W3_PROBE=$(printf '  grep -q foo /tmp/ui.xml\n' | grep -vE '^[[:space:]]*#' | grep -c '/tmp/ui\.xml' || true)
[ "$W3_PROBE" = "1" ] || no "W3a 🔴 过滤器自己坏了（阳性对照应为 1，实测 ${W3_PROBE}）—— 下面那条 0 不作数"
W3=$(grep -vE '^[[:space:]]*#' "$LIB" | grep -v '^UI_XML=' | grep -c '/tmp/ui\.xml' || true)
if [ "$W3_PROBE" = "1" ] && [ "$W3" = "0" ]; then
  ok "W3 lib 里除定义那一行外**没有第三处** /tmp/ui.xml 字面量（不是半套现场）"
else
  no "W3 🔴 lib 的非注释行里还剩 $W3 处 /tmp/ui.xml 字面量 —— 那些位点不认旋钮"
fi

W4FD=$(mktemp -d)
cp "$LIB" "$W4FD/mobile-e2e.sh"
# ① 逐字相同 ⇒ source 成功（正向对照：守卫不许误伤）
cp "$UP" "$W4FD/mobile-e2e-up.sh"
if bash -c "set -u; . '$W4FD/mobile-e2e.sh'" >/dev/null 2>&1; then
  ok "W4a 两处默认值一致时守卫放行"
else
  no "W4a 🔴 一致却报警 —— 守卫会误伤，下一轮就没人信它了"
fi
# ② 改一位 ⇒ 必须响亮失败，且把**两个值**都打出来（只说"不一致"不够定位）
sed 's/heyta_mobile_smoke/heyta_mobile_smokf/' "$UP" > "$W4FD/mobile-e2e-up.sh"
W4ERR=$(bash -c "set -u; . '$W4FD/mobile-e2e.sh'" 2>&1 >/dev/null; printf 'RC=%s' "$?")
case "$W4ERR" in
  *RC=0*) no "W4b 🔴 默认值漂移却放行（${W4ERR}）—— 守卫没有牙" ;;
  *heyta_mobile_smokf*) ok "W4b 漂移被拦下，且把两边的值都打了出来" ;;
  *) no "W4b 拦下了但没指名道姓：$W4ERR" ;;
esac
rm -rf "$W4FD"

printf '\n=== 合计 %d 绿 / %d 红 ===\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] || exit 1
