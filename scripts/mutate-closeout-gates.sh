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

say "L) 负载门 wait_for_quiet_host（桩 uptime/sleep，走的是真函数）"
LIB="$REPO/scripts/lib/wait-for-quiet-host.sh"
gate() { # $1 = uptime 桩函数体（N 递增时用它自己的形态），$2 = 额外 env
  /bin/bash -c "set -u
. '$LIB'
$1
sleep(){ :; }
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
export HEYTA_LOAD_GATE_INTERVAL=45 HEYTA_LOAD_GATE_WAIT=900
wait_for_quiet_host; echo RC=\$?" 2>&1)"
rm -f "$CNT"
if printf '%s' "$out" | grep -q '累计 0s' && printf '%s' "$out" | grep -q '累计 45s' \
  && ! printf '%s' "$out" | grep -q '累计 90s' && printf '%s' "$out" | grep -q 'RC=0'; then
  ok "L4 等两轮（45s 间隔生效）后第三次读数即放行，且不多等"
else
  no "L4 等待序列不对：$out"
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
defs="$(grep -rlnE '^[[:space:]]*wait_for_quiet_host[[:space:]]*\([[:space:]]*\)[[:space:]]*\{' "$REPO/scripts" 2>/dev/null | grep -v '\.snap\.' | grep -c . || true)"
srcs="$(grep -rlE '^[[:space:]]*\. .*lib/wait-for-quiet-host\.sh' "$REPO/scripts"/*.sh 2>/dev/null | grep -c . || true)"
if [ "$defs" = "1" ] && [ "$srcs" = "2" ]; then
  ok "定义 1 处（就是 lib），restore 与 repeat 恰好各 source 一次（$srcs 个调用方）"
else
  no "定义 $defs 处 / source 语句 $srcs 处 —— 期望 1 与 2"
fi

printf '\n=== 合计 %d 绿 / %d 红 ===\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] || exit 1
