#!/bin/bash
# 给 `research/tools/r14c-install-guard-arms.sh` 第 5 节那条**判据拷贝对账**量牙。
#
# 为什么存在：对账比的是两份真实拷贝（`scripts/verify-mobile-due-time.sh` 里那段与
# `research/tools/r14c-server-readability-judgment.sh`）。它打印 "OK 两份逐字相同" 只说明
# **此刻**两份一致，不说明它抓得住不一致 —— 一条永远不会红的对账比没有对账更糟（AGENTS §8.3）。
#
# 🔴 上一轮（03:4x）的教训：那次也在迷你树里动刀，但刀没落地（替换 needle 的转义与文件实形不符），
#    于是"对账转红"这个结论是**没取证写下的**。所以本装置把"刀落地"本身做成断言：
#    替换前 `count(needle)==1`，替换后回读 `count(repl)==1`，任何一条不成立 ⇒ exit 4（装置坏，不是判据红）。
#
# 全程在 mktemp 迷你树里动副本，真实树只读不写（真实树里 4 个并行会话在改同一片文件）。
#
# 退出码：0 = 对照绿 + 两臂都按预期转红；1 = 有臂没转红 ⇒ 对账没有牙；
#         4 = 装置前提不成立（抽不到 needle / 迷你树建不起来 / 刀没落地）。
# 用法：bash research/tools/r14c-drift-teeth.sh
set -u
cd "$(dirname "$0")/../.." || exit 4
ROOT="$PWD"
RIG=research/tools/r14c-install-guard-arms.sh
SRC=scripts/verify-mobile-due-time.sh
JUDG=research/tools/r14c-server-readability-judgment.sh
for f in "$RIG" "$SRC" "$JUDG"; do
  [ -f "$f" ] || { echo "❌ 前提不成立：$f 不在 $ROOT" >&2; exit 4; }
done

D=$(mktemp -d /tmp/ht-drift-teeth.XXXXXX)   # 每跑唯一，别用固定名（并发那趟会覆盖日志）
trap 'rm -rf "$D"' EXIT
build_tree() {
  rm -rf "$D/tree"; mkdir -p "$D/tree/scripts" "$D/tree/research/tools" || return 1
  cp "$ROOT/$RIG"  "$D/tree/research/tools/" || return 1
  cp "$ROOT/$SRC"  "$D/tree/scripts/"        || return 1
  cp "$ROOT/$JUDG" "$D/tree/research/tools/" || return 1
  return 0
}

# ── 变异：只动**副本**的第二份拷贝（JUDG），needle→repl；两道落地断言
perturb() {   # $1=needle $2=repl
  NEEDLE="$1" REPL="$2" MINI="$D/tree/$JUDG" python3 - <<'PYEOF'
import os, sys
p = os.environ["MINI"]; needle = os.environ["NEEDLE"]; repl = os.environ["REPL"]
src = open(p, encoding="utf-8").read()
n = src.count(needle)
if n != 1:
    print("LANDING=NO count(needle)=%d 期望 1" % n); sys.exit(1)
out = src.replace(needle, repl, 1)
open(p, "w", encoding="utf-8").write(out)
back = open(p, encoding="utf-8").read()
if back.count(repl) != 1 or back.count(needle) != 0:
    print("LANDING=NO 写后回读不符 repl=%d 残留 needle=%d" % (back.count(repl), back.count(needle))); sys.exit(1)
print("LANDING=OK"); sys.exit(0)
PYEOF
}

run_rig() {   # $1=日志名；跑完把 stdout+stderr 落盘，rc 打出来
  ( cd "$D/tree" && bash "$RIG" ) >"$D/$1" 2>&1
  echo $? > "$D/$1.rc"
}

fail=0
echo "== 0. 未变异对照（真实树三枚文件拷进迷你树，不动刀）=="
build_tree || { echo "❌ 迷你树建不起来" >&2; exit 4; }
run_rig ctrl
CTRL_RC=$(cat "$D/ctrl.rc")
echo "   rc=$CTRL_RC"
if [ "$CTRL_RC" != "0" ]; then
  echo "   ❌ 对照没绿（迷你树里整条装置 rc=${CTRL_RC}）—— 先读 $D/ctrl 的尾部再谈臂"
  sed -n '1,6p;/判据拷贝对账/p' "$D/ctrl" | sed 's/^/      /'
  tail -20 "$D/ctrl" | sed 's/^/      /'
  exit 4
fi
grep -q '判据拷贝对账：OK' "$D/ctrl" || { echo "   ❌ 对照绿但对账那行不是 OK ⇒ 抽不到读数"; exit 4; }
echo "   ✅ 对照：整条 rc=0，对账行 = 'OK 两份逐字相同'（这一行是下面两臂的阳性对照基准）"

echo "== 1. 臂 D1：只改第二份的 SQL 串（sync_devices → sync_devicesX）⇒ 期望对账红在 SQL =="
P=$(perturb "(SELECT count(*) FROM sync_devices) AS devices" "(SELECT count(*) FROM sync_devicesX) AS devices")
echo "   落地：$P"
case "$P" in LANDING=OK) ;; *) echo "   ❌ 刀没落地 ⇒ 装置坏（exit 4），不记绿也不记红"; exit 4 ;; esac
run_rig d1
D1_RC=$(cat "$D/d1.rc")
D1_LINE=$(grep '判据拷贝对账' "$D/d1" | head -1)
echo "   rc=$D1_RC  对账行=[$D1_LINE]"
if [ "$D1_RC" = "0" ]; then echo "   ❌ D1 没转红 ⇒ 对账没有牙"; fail=1; fi
case "$D1_LINE" in *"内容漂移在:SQL"*) echo "   ✅ D1 指到 SQL（不是整段/不是形状正则）" ;; *) echo "   ❌ D1 归因不对：$D1_LINE"; fail=1 ;; esac

echo "== 2. 臂 D2：只改第二份的形状正则（\\| 后加 {1,}）⇒ 期望对账红在 形状正则 =="
build_tree || { echo "❌ 重建迷你树失败" >&2; exit 4; }
P=$(perturb "grep -qE '^[0-9]+\\|[0-9]+\$'" "grep -qE '^[0-9]+\\|[0-9]{1,}\$'")
echo "   落地：$P"
case "$P" in LANDING=OK) ;; *) echo "   ❌ 刀没落地 ⇒ 装置坏（exit 4）"; exit 4 ;; esac
run_rig d2
D2_RC=$(cat "$D/d2.rc")
D2_LINE=$(grep '判据拷贝对账' "$D/d2" | head -1)
echo "   rc=$D2_RC  对账行=[$D2_LINE]"
if [ "$D2_RC" = "0" ]; then echo "   ❌ D2 没转红 ⇒ 对账没有牙"; fail=1; fi
case "$D2_LINE" in *"内容漂移在:形状正则"*) echo "   ✅ D2 指到形状正则" ;; *) echo "   ❌ D2 归因不对：$D2_LINE"; fail=1 ;; esac

echo "== 3. 臂 D3：删掉第二份的那个文件（前提不成立）⇒ 期望 rc=4 且说不出'漂移' =="
rm -f "$D/tree/$JUDG"
run_rig d3
D3_RC=$(cat "$D/d3.rc")
echo "   rc=$D3_RC  首行=[$(head -1 "$D/d3")]"
if [ "$D3_RC" != "4" ]; then echo "   ❌ 缺文件没走'前提不成立'那一档（rc=${D3_RC}）⇒ 会把装置坏报成判据红"; fail=1; fi
if grep -q '内容漂移' "$D/d3"; then echo "   ❌ 缺文件被报成了'内容漂移'"; fail=1; fi

if [ "$fail" = "0" ]; then
  echo "结论：对账有牙（D1 只改 SQL→红在 SQL、D2 只改正则→红在形状正则、D3 缺文件→rc=4 不冒充漂移），且对照绿"
fi
exit $fail
