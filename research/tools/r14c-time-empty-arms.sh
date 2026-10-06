#!/usr/bin/env bash
# `scripts/verify-mobile-due-time.sh` 里那对 **TIME_EMPTY 自校准 + 归一** 的牙（五臂）。
#
# 🔴 为什么要单独一把 rig：这段是 19:1x 那趟真设备读数被**现场**照出来的 ——
#    ④ 报「填进了 1」而 ② 与 ④b 报「框里是 '时:分'」：无障碍里的 `text` 在**空框**
#    回的是占位符而不是空串，于是判"框为空"的 ② 与判"清空生效"的 ④b **结构上恒红**。
#    修法是自校准（开跑前把当时的读数记成"空"的字面形状），但它本身是新代码：
#      · 归一写错方向 ⇒ 把**真空**吞掉 ⇒ ② 与 ④b 从假红变成**假绿**（更贵）；
#      · 锚点取晚了（框里已经有字）⇒ 同一个假绿。
#    所以这两件事都要臂：一条证归一只吃锚点不吃内容，一条证锚点闸门会拒绝内容值。
#
# 五臂（不起设备、不碰 adb；把抽出来的那段当独立脚本跑，`dump`/`rid_attr` 是桩）：
#   A 归一生效：空框读数是占位符 ⇒ 校准 rc=0，之后读到占位符归一成**空串**（②/④b 变绿）
#   B 不吃内容：锚点是占位符时，框里真有 "1" ⇒ 输出仍是 "1"（归一不许顺手吞掉真空）
#   C 无操作腿：某些设备空框真回空串 ⇒ 锚点是空串、归一成为无操作（两个方向都不引入假绿）
#   D 🔴 锚点闸门：校准那一刻框里已经是 "1"/"16:0"/"16:00" ⇒ 校准必须 **rc=1**
#   E 🔴 变异腿：把归一那一行摘掉（只在副本上、断言恰好摘掉一行）⇒ A 臂必须转红
#        （少了 E，A 那条绿可能是桩自己给的，不是被测那段给的）
#
# 抽原文跑，不重抄（本线既有约定：重抄一份就变成臂在测臂自己抄的那份）。
# 用法：bash research/tools/r14c-time-empty-arms.sh
# 退出码：0 = 五臂如预期；1 = 某一臂不按预期（= 装置或那段判据坏了，不是仓库坏了）
set -u
cd "$(dirname "$0")/../.." || exit 1
S="${SCRIPT_OVERRIDE:-scripts/verify-mobile-due-time.sh}"
[ -f "$S" ] || { echo "❌ 找不到被测脚本：$S"; exit 1; }

B=$(grep -n '^TIME_EMPTY=""' "$S" | head -1 | cut -d: -f1)
C=$(grep -n '^calibrate_time_empty() {' "$S" | head -1 | cut -d: -f1)
# 🔴 抽不到就**响亮退出**，不许"跳过这一臂还照样打印通过"（traps #191 那一族）。
[ -n "$B" ] && [ -n "$C" ] || { echo "❌ 锚点没找到（B=${B:-空} C=${C:-空}）⇒ 被测那段改了形状或已不存在，本装置先失效而不是恒绿"; exit 1; }
E=$(awk -v from="$C" 'NR>=from && /^\}/ {print NR; exit}' "$S")
[ -n "$E" ] || { echo "❌ 找到 calibrate_time_empty 的开头（${C}）却找不到它的闭合 ⇒ 函数被改坏了"; exit 1; }
BLOCK=$(sed -n "${B},${E}p" "$S")
[ -n "$BLOCK" ] || { echo "❌ 锚点找到了但抽出来是空的（B=${B} E=${E}）"; exit 1; }
echo "抽原文：${S}:${B}-${E}（$(printf '%s\n' "$BLOCK" | grep -c .) 行）"
# 🔴 抽取范围必须**同时**含归一那条与校准闸门，缺一臂就只是在测半段。
printf '%s\n' "$BLOCK" | grep -q 'v=""' || { echo "❌ 抽出的段里没有归一那行 ⇒ 锚点范围不对"; exit 1; }
printf '%s\n' "$BLOCK" | grep -q 'return 1' || { echo "❌ 抽出的段里没有锚点闸门 ⇒ 锚点范围不对"; exit 1; }

T=$(mktemp -d /tmp/r14c-time-empty.XXXXXX)
PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); printf '✅ %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '❌ %s\n' "$1"; }
trap 'rm -rf "$T"' EXIT

PLACEHOLDER='时:分'   # 只在臂里当"某个非空字面形状"用；被测脚本里没有这个常量（抄件必漂）

# run_case <臂名> <被测段> <校准时的 text> —— 桩：`dump` 空转，`rid_attr` 回 FAKE_TEXT
run_case() {
  local name="$1" block="$2" cal="$3"
  cat > "$T/$name.sh" <<CASE_EOF
set -u
TIME_HALF="16:0"
TIME_FULL="16:00"
FAKE_TEXT="$cal"
dump() { :; }
rid_attr() { printf '%s' "\$FAKE_TEXT"; }
$block
CASE_EOF
}
# leg_read <臂名.sh> <读 text 时喂的值> —— 在校准之后改喂另一个读数，打印两个量
leg_read() {
  local script="$1" read_val="$2"
  cat >> "$script" <<LEG_EOF
cal_rc=0; calibrate_time_empty || cal_rc=1
FAKE_TEXT="$read_val"
OUT="\$(time_value)"
printf 'CAL_RC=%s OUT=[%s]\\n' "\$cal_rc" "\$OUT"
LEG_EOF
  bash "$script" 2>&1
}

# ---------------------------------------------------------------- 臂 A
run_case A "$BLOCK" "$PLACEHOLDER"
OUT=$(leg_read "$T/A.sh" "$PLACEHOLDER")
if printf '%s' "$OUT" | grep -q 'CAL_RC=0' && printf '%s' "$OUT" | grep -q 'OUT=\[\]'; then
  ok "臂 A：空框回占位符 ⇒ 校准收下它（rc=0），之后读到占位符归一成空串 ⇒ ②/④b 不再恒红"
else
  bad "臂 A 不如预期：$OUT"
fi

# ---------------------------------------------------------------- 臂 B
run_case B "$BLOCK" "$PLACEHOLDER"
OUT=$(leg_read "$T/B.sh" "1")
if printf '%s' "$OUT" | grep -q 'CAL_RC=0' && printf '%s' "$OUT" | grep -q 'OUT=\[1\]'; then
  ok "臂 B 🔴 反向腿：锚点是占位符时，框里真的有 '1' 输出仍是 '1' ⇒ 归一**只吃锚点、不吃内容**（没把真空吞成空）"
else
  bad "臂 B 不如预期：$OUT"
fi

# ---------------------------------------------------------------- 臂 C
run_case C "$BLOCK" ""
OUT=$(leg_read "$T/C.sh" "16:00")
if printf '%s' "$OUT" | grep -q 'CAL_RC=0' && printf '%s' "$OUT" | grep -q 'OUT=\[16:00\]'; then
  ok "臂 C：空框真回空串的那台设备 ⇒ 锚点是空串、归一成为无操作（两个方向都不引入假绿）"
else
  bad "臂 C 不如预期：$OUT"
fi

# ---------------------------------------------------------------- 臂 D
for v in "1" "16:0" "16:00"; do
  # 🔴 夹具文件名要把冒号换掉：`16:0` 直接当文件名的话，臂名里带分隔符会让"哪一臂挂了"
  #    在读日志时歧义（本 rig 的臂名同时出现在文件名、ok/bad 文本里）。
  slug=$(printf '%s' "$v" | tr ':' 'c')
  run_case "D_$slug" "$BLOCK" "$v"
  OUT=$(leg_read "$T/D_$slug.sh" "$v")
  if printf '%s' "$OUT" | grep -q 'CAL_RC=1'; then
    ok "臂 D（喂 '$v'）：校准那一刻框里已经是内容值 ⇒ 闸门以 rc=1 拒绝（锚点取晚了的形状）"
  else
    bad "臂 D（喂 '$v'）不如预期 ⇒ 锚点闸门没有牙，这个值会被当'空'用、②与④b 变假绿：$OUT"
  fi
done

# ---------------------------------------------------------------- 臂 E（变异腿）
MUT=$(printf '%s\n' "$BLOCK" | sed '/v=""/d')
N_BEFORE=$(printf '%s\n' "$BLOCK" | grep -c 'v=""')
N_AFTER=$(printf '%s\n' "$MUT" | grep -c 'v=""')
if [ "$N_BEFORE" != "1" ] || [ "$N_AFTER" != "0" ]; then
  bad "臂 E 前提不成立：变异应当**恰好摘掉一行**（改前 $N_BEFORE 行 / 改后 $N_AFTER 行）⇒ 变异没落在被测那段上，A 臂的绿无从判定"
else
  run_case E "$MUT" "$PLACEHOLDER"
  OUT=$(leg_read "$T/E.sh" "$PLACEHOLDER")
  if printf '%s' "$OUT" | grep -q 'CAL_RC=0' && ! printf '%s' "$OUT" | grep -q 'OUT=\[\]'; then
    ok "臂 E 🔴 有牙证明：把归一那行摘掉后 A 腿读到的是占位符本身（${OUT}）⇒ A 那条绿是被测那段给的，不是桩给的"
  else
    bad "臂 E 不如预期：摘掉归一后 A 腿仍应转红，实际 $OUT ⇒ A 臂可能压根没在测这段"
  fi
fi

echo "== 结论：归一 + 锚点闸门 + 变异对照 pass=$PASS fail=$FAIL =="
[ "$FAIL" = 0 ] || exit 1
exit 0
