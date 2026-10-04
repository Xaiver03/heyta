#!/bin/bash
# `scripts/verify-mobile-window-gate.sh` 第 3b 段（B 专属：设备面独占）的有牙先验。
#
# 为什么存在：b 分支原来**根本没有这道门**（只看 `reinstall-all.sh` 自己干净不干净），
# 而 B 会 `simctl uninstall` + `adb uninstall` + 覆盖 `/Applications/Heyta.app` ——
# 那三条拆的都是别人正在量的现场。04:1x 补上门之后必须立刻回答"它能不能失败"（AGENTS §8.3）。
#
# 🔴 这台机器是共享的 ⇒ 臂**不能假设现场真空**。第一版就是这么写的，结果 04:2x 被现量否证：
#    那一刻另一条会话正在 `/tmp/heyta-reinstall` 里跑真 B
#    （argv：`bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817`），
#    于是"T1 该绿""T4 该绿"两条断言同时红 —— **那是门在对真实撞车报警，不是门坏了**。
#    现在的形状：开跑先取**基线**（外部 verify-mobile 与 reinstall 的 pid 集合，各自排除自己这一棵树），
#    每条臂只断言"**注入的那一枚有没有新出现在输出里**"（增量），不断言"输出为空"。
#    这样现场有别人也在跑时，臂仍然在测它该测的那件事。
#
# 五臂：
#   T1 基线一致性：无注入时 3b 报出的 pid 集合必须**恰好等于基线**（多一个=误报，少一个=漏报）
#   T2 注入外部 verify-mobile 运行者 ⇒ 第一道必须点名到它
#   T3 注入外部 reinstall-all（不带点的普通形态）⇒ 第二道必须点名到它
#   T3b 注入 reinstall-all 的**真实快照形态** `scripts/.reinstall-all.sh.snap.<pid>` ⇒ 第二道必须认得
#       （🔴 这一臂是被"配对判据要造出真实那层 wrapper"逼出来的：第一版正则对快照形态**永久失明**，
#        而快照才是 `reinstall-all.sh` 文件头 14-16 行里的**现场运行形态**）
#   T4 自己这一棵树的 argv 里带着 `scripts/reinstall-all.sh` ⇒ 第二道不许把**自己**算成外部
#       （否则"等窗口就起 B"的看守会把自己锁死，造出一条永远不绿的门）
#
# 假运行者用 `sleep` 脚本扮演：绝不碰设备、绝不装任何包，每臂结束立刻 kill。
# 退出码：0 = 五臂符合预期；1 = 有臂不符（日志留在打印出的目录里，不清）；
#         4 = 前提不成立（闸门/探针缺文件、假进程起不来）。
# 用法：bash research/tools/r14c-gate-b-exclusive-arms.sh
set -u
cd "$(dirname "$0")/../.." || exit 4
GATE=scripts/verify-mobile-window-gate.sh
PROBE=scripts/lib/mobile-e2e-runner-probe.sh
for f in "$GATE" "$PROBE"; do
  [ -f "$f" ] || { echo "❌ 前提不成立：$f 不在" >&2; exit 4; }
done
D=$(mktemp -d /tmp/ht-gate-b-arms.XXXXXX)
mkdir -p "$D/fakescripts" "$D/snapcarrier/scripts"
printf '#!/bin/bash\nsleep 30\n' > "$D/fakescripts/.verify-mobile-fakearm.sh"   # 🔴 名字里不许有数字：探针的正解是 verify-mobile-[a-z-]+ 点 sh
printf '#!/bin/bash\nsleep 30\n' > "$D/fakescripts/reinstall-all.sh"
printf '#!/bin/bash\nsleep 30\n' > "$D/snapcarrier/scripts/.reinstall-all.sh.snap.99999"
# 🔴 快照那一枚的名字以点开头，`*.sh` 这个 glob 匹配不到它（04:2x 实测报 No such file）⇒ 逐枚点名，不用 glob
chmod +x "$D/fakescripts/.verify-mobile-fakearm.sh" "$D/fakescripts/reinstall-all.sh" "$D/snapcarrier/scripts/.reinstall-all.sh.snap.99999"
fail=0

# 祖先链（用于"自己这一棵树"的排除，判据本体在闸门里；这里只是让基线不被自己污染）
my_tree() {
  local p=$$ t=" $$ "
  while [ -n "$p" ] && [ "$p" != "1" ] && [ "$p" != "0" ]; do
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    [ -n "$p" ] || break
    t="$t$p "
  done
  printf '%s' "$t"
}
TREE=$(my_tree)
in_tree() { case "$TREE" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

BASE_VM=""
for pid in $(pgrep -f 'verify-mobile' 2>/dev/null); do in_tree "$pid" || BASE_VM="$BASE_VM$pid "; done
BASE_RI=""
for pid in $(pgrep -f 'scripts/[.]?reinstall-all[.]sh' 2>/dev/null); do in_tree "$pid" || BASE_RI="$BASE_RI$pid "; done
echo "基线（外部，已排除自己这一棵树）：verify-mobile=[${BASE_VM:-无}] reinstall=[${BASE_RI:-无}]"
if [ -n "$BASE_RI" ]; then
  echo "   ⚠️ 此刻**真有**别的 reinstall-all 在跑 —— 第二道的『该红』是现场状态，B 现在不能起（AGENTS §8.9）"
  for pid in $BASE_RI; do ps -p "$pid" -o command= | sed 's/^/      argv: /' | cut -c1-160; done
fi

run_gate() { NO_COLOR=1 bash "$GATE" --target b >"$1" 2>&1; echo $? > "$1.rc"; }
seg3b() { sed -n '/════ 3b\./,/════ 4\./p' "$1"; }
# 从 3b 那一行里把 pid 抽出来（只认那一行自己打印的字段，不认我起的名）
pids_in() { seg3b "$1" | grep "$2" | grep -oE '[0-9]{2,}' | tr '\n' ' '; }

echo "== T1 基线一致性：3b 报的 pid 集合必须恰好等于基线 =="
run_gate "$D/t1"
GOT_VM=$(pids_in "$D/t1" "有移动端验收在跑"); GOT_RI=$(pids_in "$D/t1" "有另一趟 reinstall-all 在跑")
[ -z "$GOT_VM" ] && GOT_VM="(无)"; [ -z "$GOT_RI" ] && GOT_RI="(无)"
EXP_VM=${BASE_VM:-"(无)"}; EXP_RI=${BASE_RI:-"(无)"}
if [ "$(printf '%s' "$GOT_VM" | tr -s ' ' '\n' | sort | tr -d '\n')" = "$(printf '%s' "$EXP_VM" | tr -s ' ' '\n' | sort | tr -d '\n')" ]; then
  echo "   ✅ 第一道报出 [$GOT_VM] == 基线 [$EXP_VM]"
else
  echo "   ❌ 第一道报出 [$GOT_VM] != 基线 [$EXP_VM]"; fail=1
fi
if [ "$(printf '%s' "$GOT_RI" | tr -s ' ' '\n' | sort | tr -d '\n')" = "$(printf '%s' "$EXP_RI" | tr -s ' ' '\n' | sort | tr -d '\n')" ]; then
  echo "   ✅ 第二道报出 [$GOT_RI] == 基线 [$EXP_RI]"
else
  echo "   ❌ 第二道报出 [$GOT_RI] != 基线 [$EXP_RI]"; fail=1
fi

spawn_and_check() {  # $1=臂名 $2=argv $3=匹配关键词 $4=必须新出现的 pid 变量名(由调用方读)
  ( exec bash "$2" ) &
  local fp=$!
  sleep 1
  if ! ps -p "$fp" >/dev/null 2>&1; then echo "❌ 假进程 $1 起不来 ⇒ 装置坏（exit 4）"; exit 4; fi
  ps -p "$fp" -o command= | sed 's/^/   真实 argv: /' | cut -c1-170
  run_gate "$D/$1"
  kill "$fp" 2>/dev/null; wait "$fp" 2>/dev/null
  REPORTED=$(pids_in "$D/$1" "$3")
  case " $REPORTED " in
    *" $fp "*) echo "   ✅ $1：门点名到我注入的那一枚（pid ${fp}）" ;;
    *) echo "   ❌ $1：门没点名 ${fp}（输出里的 pid=[$REPORTED]）"; fail=1 ;;
  esac
}

echo "== T2 注入外部 verify-mobile 运行者 ⇒ 第一道必须点名到它 =="
# 注意：这一臂注入的名字必须能被探针的正解认到（`verify-mobile-[a-z-]+\.sh`），
#       第一版我用了 "fake-e2e"（含数字）不命中，那**是臂坏不是门坏** —— 当时差点据此判门没牙。
spawn_and_check t2 "$D/fakescripts/.verify-mobile-fakearm.sh" "有移动端验收在跑"

echo "== T3 注入外部 reinstall-all（普通形态）⇒ 第二道必须点名到它 =="
spawn_and_check t3 "$D/fakescripts/reinstall-all.sh" "有另一趟 reinstall-all 在跑"

echo "== T3b 注入 reinstall-all 的**真实快照形态** ⇒ 第二道必须认得 =="
spawn_and_check t3b "$D/snapcarrier/scripts/.reinstall-all.sh.snap.99999" "有另一趟 reinstall-all 在跑"

echo "== T5 c 分支必须认得同一形（04:2x 现量补的对称面）=="
# 为什么单独一臂：C 的 §3 原来只问设备独占探针，而那条探针的正则是 `verify-mobile-[a-z-]+\.sh` ——
# 对 `reinstall-all` **永久失明**。04:2x 现量正是这种盲区：探针回"没有别的验收在跑"，
# 而同一台 emulator-5554 上有一趟真 reinstall 正在跑（它的 android 段会 `adb uninstall` 同一枚包）。
# 现在 b/c 共用 `reinstall_other_pids()` ⇒ 共用之后必须**两侧各测一次**，否则"抽成函数"这件事本身没有判据。
( exec bash "$D/snapcarrier/scripts/.reinstall-all.sh.snap.99999" ) &
FAKE5=$!
sleep 1
if ! ps -p "$FAKE5" >/dev/null 2>&1; then echo "❌ T5 假进程起不来 ⇒ 装置坏（exit 4）"; exit 4; fi
NO_COLOR=1 bash "$GATE" --target c >"$D/t5" 2>&1; echo $? > "$D/t5.rc"
kill "$FAKE5" 2>/dev/null; wait "$FAKE5" 2>/dev/null
GOT5=$(sed -n '/════ 3\. C 专属/,/════ 4\./p' "$D/t5" | grep '有另一趟 reinstall-all 在跑' | grep -oE '[0-9]{2,}' | tr '\n' ' ')
case " $GOT5 " in
  *" $FAKE5 "*) echo "   ✅ T5：c 分支也点名到注入的那一枚（pid ${FAKE5}）—— 共用函数在两侧都生效" ;;
  *) echo "   ❌ T5：c 分支没点名 ${FAKE5}（输出=[$GOT5]）⇒ 抽出来的函数只有一侧在用"; fail=1 ;;
esac

echo "== T4 自己这一棵树的 argv 带着那个串 ⇒ 门不许把自己算成外部 =="
bash -c 'echo "看守会执行 scripts/reinstall-all.sh，这是它自己的 argv";
         bash scripts/verify-mobile-window-gate.sh --target b > "'"$D"'/t4" 2>&1; echo $? > "'"$D"'/t4.rc"'
# 🔴 这里不能用 `exec`：exec 会顶掉内层 shell，后面那句 `echo $? > t4.rc` 就永远不执行
#    （本轮实测得到 `cat: t4.rc: No such file or directory`，rc 读成空 ⇒ 断言看着像红又像绿）
GOT_RI4=$(pids_in "$D/t4" "有另一趟 reinstall-all 在跑")
echo "   第二道报出 [$GOT_RI4]（基线 [$EXP_RI]）"
bad=0
for pid in $GOT_RI4; do
  [ "$pid" = "$$" ] && { echo "   ❌ 把自己（$$）算成外部运行者"; bad=1; }
  if in_tree "$pid"; then :; else
    case " $EXP_RI " in *" $pid "*) : ;; *) echo "   ❌ 冒出一个基线外的 pid ${pid}（不是注入的那枚）"; bad=1 ;; esac
  fi
done
WRAP=$(pgrep -f '看守会执行 scripts/reinstall-all' 2>/dev/null | tr '\n' ' ')
if [ "$bad" = 0 ]; then
  echo "   ✅ T4：自己这一棵树没被算成外部（祖先豁免生效）；判据是上面两行比的集合——报出的恰好等于基线，包装进程不在其中"
else
  echo "   ❌ T4 不符 ⇒ 这条门会在看守自己身上变成永远不绿"; fail=1
fi
[ -n "${WRAP:-}" ] || true   # 包装进程此刻已退出，这里只是说明：判据看的是 t4 日志那一行，不是这枚 pid

if [ "$fail" = 0 ]; then
  echo "结论：3b 有牙（真实快照形态认得、注入即点名、自己不冤枉自己），且对『现场本来就有别人在跑』免疫"
  rm -rf "$D"
else
  echo "🔴 有臂不符 ⇒ 日志留在 ${D}（不清，逐臂去读那一段 3b）"
fi
exit $fail
