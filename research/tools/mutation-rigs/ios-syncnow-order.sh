#!/usr/bin/env bash
# §10.143 ⑦ 那枚修复（摘掉系统弹窗之后**必须重新导航**）的离线判据。
#
# 判的不是"有没有这一行"，是**调用顺序**：第一轮等不到 ⇒ 摘弹窗 ⇒ **重按一次「我的」** ⇒ 才许等第二轮。
# 少了中间那一下重按，第二轮就是在任务页上等一个永不出现的标签 ⇒ 恒红，且症状与产品缺陷同形。
#
# 载具：`sync_now` 的函数体从真身按锚点 awk 出来（不手抄 ⇒ 抄件一定会漂）。
# 变异对照：`RIG=<HEAD 版副本>` 跑同一条，**必须 fail**（证明这台装置有牙）。
set -uo pipefail
# RIG 从**本文件自己的位置**推到仓库根，不依赖调用时的 cwd。
RIG="${RIG:-$(cd "$(dirname "$0")/../../.." && pwd)/scripts/verify-mobile-ios-account-erasure.sh}"
BODY=$(awk '/^sync_now\(\) \{/,/^\}$/' "$RIG")
[ -n "$BODY" ] || { echo "ORDER=EXTRACT-EMPTY（锚点没命中，别把取空读成通过）"; exit 1; }
echo "   提取到 sync_now $(printf '%s\n' "$BODY" | grep -c '') 行（载体：${RIG}）"

# 🔴 桩与 eval 不能写在 `$( … )` 里：macOS 的 /bin/bash 是 **3.2.57**，命令替换内部的
#    `case … )` 会让它报 `syntax error near unexpected token ';;'`（本轮实测）。
#    ⇒ 载具落成一次性脚本文件，跑它，读它的输出文件。
HARNESS=$(mktemp /tmp/ios-syncnow-harness.sh.XXXXXX)
OUTFILE=$(mktemp /tmp/ios-syncnow-out.txt.XXXXXX)
BODY_FILE=$(mktemp /tmp/ios-syncnow-body.txt.XXXXXX)
RECFILE=$(mktemp /tmp/ios-syncnow-rec.txt.XXXXXX)
trap 'rm -f "$HARNESS" "$OUTFILE" "$BODY_FILE" "$RECFILE"' EXIT
printf '%s\n' "$BODY" > "$BODY_FILE"

cat >"$HARNESS" <<'HARNESS_EOF'
set -u
BODY=$(cat "$1")
REC="$2"
SEQ=0
# 🔴 真身里 `ax … >/dev/null 2>&1` 会把标准输出**和**错误输出都吞掉，所以桩不能靠 stdout 传读数
#    （第一版就是这样：中间那一下重按明明在代码里，序列里却看不见 ⇒ 差点判成"修复没生效"）。
#    ⇒ 桩的产出统一写进一个带全局序号的记录文件，顺序与"有没有被重定向"无关。
mark() { SEQ=$(( SEQ + 1 )); printf '%03d %s\n' "$SEQ" "$*" >> "$REC"; }
echo() { mark "ECHO|$*"; }
dismiss_keyboard() { echo "CALL|dismiss_keyboard"; }
dismiss_ios_save_password() { echo "CALL|dismiss_sheet"; return 0; }
sleep() { :; }
ax() { echo "CALL|ax|$*"; }
ax_press() { echo "CALL|ax_press|$*"; }
idb_dump() { :; }
jget() { printf 'success'; }   # 用 printf 不用 echo：echo 已被桩成"只写记录文件"，
# 而 jget/sync_signature 的产出是**被命令替换捕获**的，必须走 stdout
ok() { echo "JUDGE|ok|$*"; }
bad() { echo "JUDGE|bad|$*"; }
step() { :; }
sync_signature() { printf 'sig'; }
WAIT_N=0
# 桩里写死：第一轮超时、第二轮成功 —— 这正是 09:00 那一趟的形状（弹窗吃掉第一下导航）
idb_wait_label() {
  WAIT_N=$(( WAIT_N + 1 ))
  if [ "$WAIT_N" = "1" ]; then echo "CALL|wait1|$1|=>timeout"; return 1; fi
  if [ "$WAIT_N" = "2" ]; then echo "CALL|wait2|$1|=>found"; return 0; fi
  echo "CALL|wait$WAIT_N|$1|=>unexpected"; return 1
}
eval "$BODY"
# 🔴 `eval` 一个函数定义只是**定义**了它，不调用就等于什么都没测（第一版栽在这里：
#    序列只有 `WAIT_CALLS=0`，四条判据三条红 —— 看着像"修复没生效"，其实是装置没走到被测代码）。
sync_now
mark "WAIT_CALLS=$WAIT_N"
HARNESS_EOF

: >"$OUTFILE"
bash "$HARNESS" "$BODY_FILE" "$RECFILE" >"$OUTFILE" 2>&1
HARNESS_RC=$?
ORDER=$(sort "$RECFILE" | cut -d' ' -f2-)
printf '%s\n' "$ORDER" | sed 's/^/   /'
if [ -s "$OUTFILE" ]; then echo "   （载具 stdout/stderr，退出码 ${HARNESS_RC}）"; sed 's/^/   ! /' "$OUTFILE"; else echo "   （载具无 stdout/stderr，退出码 ${HARNESS_RC}）"; fi

FAIL=0
# 判据 1：第一轮超时之后、第二轮等待之前，必须有一次 `ax "我的" … --press`
SEG=$(printf '%s\n' "$ORDER" | sed -n '/CALL|wait1/,/CALL|wait2/p')
if printf '%s\n' "$SEG" | grep -q 'CALL|ax|我的 --pressable --press'; then
  echo "   ✔ 两轮之间重按过一次「我的」"
else
  echo "   ✘ 两轮之间**没有**重新导航 ⇒ 第二轮等的是当前页上不会出现的标签"; FAIL=$(( FAIL + 1 ))
fi
# 判据 2：载具确实走到了「摘弹窗」那一腿（否则是在测一条没被执行过的路径，traps #176）
if printf '%s\n' "$ORDER" | grep -q 'CALL|dismiss_sheet'; then
  echo "   ✔ 摘弹窗那一腿被走到"
else
  echo "   ✘ 没走到摘弹窗（载具没造出第一轮超时）"; FAIL=$(( FAIL + 1 ))
fi
# 判据 3：第二轮成功 ⇒ 不许判红（挡「摘完就直接 return 1」那种假修法）
if printf '%s\n' "$ORDER" | grep -q 'JUDGE|bad|'; then
  echo "   ✘ 第二轮已成功却仍打了 bad"; FAIL=$(( FAIL + 1 ))
else
  echo "   ✔ 第二轮成功 ⇒ 没有误判红"
fi
# 判据 4：等待腿恰好 2 次
if printf '%s\n' "$ORDER" | grep -qE '^(ECHO\|)?WAIT_CALLS=2$'; then
  echo "   ✔ 等待腿共 2 次"
else
  echo "   ✘ 等待次数不是 2"; FAIL=$(( FAIL + 1 ))
fi

echo ""
[ "$FAIL" = "0" ] && { echo "ORDER=pass"; exit 0; }
echo "ORDER=fail=$FAIL"; exit 1
