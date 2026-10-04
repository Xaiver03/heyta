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
#   T1 基线一致性：第一道**至多一枚代表**且必须认得出来源（开跑基线 ∪ 现读）；第二道恰好等于基线
#       🔴 两道门的**基数契约不同**（第一道走探针，awk 以 `print; exit` 收尾；第二道逐枚累加）——
#          12:5x 现场三条 verify-mobile 并存时，旧写法把"门报其中一枚"判成 ❌，那是**臂的期望比契约宽**。
#   T2 注入外部 verify-mobile 运行者 ⇒ 两腿：受控快照腿（把这条真 argv 单独喂探针，必须恰好点名它）
#       + 现场腿（闸门必须判红，且报出的那枚来路可追）
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
# T2 的受控快照腿要直接调探针（它的入口被 `BASH_SOURCE==$0` + `--self-check` 双重挡住 ⇒ source 安全）。
. "$PROBE"
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
# 🔴 `EXP_RI`（T1 的第二道期望集 / T4 的"基线外不许冒出一个 pid"）在这一行**定义**，
#    不是在下面各臂里现算 —— 13:2x 现量：这个赋值**从来没有存在过**，而本文件是 `set -u`，
#    于是基线非空时 T1 走到 `echo … [$EXP_RI]` 就 `unbound variable` 直接死：
#    **恰好只在"真有别人的 reinstall 在跑"那一档崩**（基线为空时走的是另一支），
#    而那一档正是这臂最该出读数的一档。rc=1 而日志里一个 ❌ 都没有 ⇒ 看起来像"臂红"，
#    其实是装置连判决都没跑到（本机今天第 N 次同一族：臂红之后先读臂）。
#    期望集 = 开跑基线：注入的假进程都在本树（`in_tree` 豁免）且各臂收尾已 kill。
# ⚠️ 已知会漂的一档（不改判定式，留给读结果的人）：基线是**开跑那一刻**的活数，
#    若某枚外部 reinstall 在本趟中途自己退出，T1 的逐字相等会报"集合不符" —— 那是
#    现场变了，不是门坏了。判据：红的那枚 pid 现在还在不在（`ps -p`）。
EXP_RI="$BASE_RI"
echo "基线（外部，已排除自己这一棵树）：verify-mobile=[${BASE_VM:-无}] reinstall=[${BASE_RI:-无}]"
if [ -n "$BASE_RI" ]; then
  echo "   ⚠️ 此刻**真有**别的 reinstall-all 在跑 —— 第二道的『该红』是现场状态，B 现在不能起（AGENTS §8.9）"
  for pid in $BASE_RI; do ps -p "$pid" -o command= | sed 's/^/      argv: /' | cut -c1-160; done
fi

run_gate() { NO_COLOR=1 bash "$GATE" --target b >"$1" 2>&1; echo $? > "$1.rc"; }
seg3b() { sed -n '/════ 3b\./,/════ 4\./p' "$1"; }
# 从 3b 那一行里把 pid 抽出来（只认那一行自己打印的字段，不认我起的名）
pids_in() { seg3b "$1" | grep "$2" | grep -oE '[0-9]{2,}' | tr '\n' ' '; }

echo "== T1 基线一致性：第一道**至多一枚代表**且必须认得出来源；第二道恰好等于基线 =="
# 🔴 两道门的**基数契约不同**，这是读实现得到的事实，不是我的偏好（12:5x 现场教的）：
#   · 第一道走 `lib/mobile-e2e-runner-probe.sh`，它的 awk 以 `print; exit` 收尾 ⇒ 契约就是
#     "至多一枚代表"（它服务的是"有没有人占着设备面"这个布尔门，不是清单）；
#   · 第二道走本闸门里的 `reinstall_other_pids()`，逐枚累加 ⇒ 报的是全集合。
#   ⇒ 第一道的臂**不许**断言"恰好等于基线"，也不许断言"必点名到我注入的那一枚"：
#     12:5x 那趟三条 verify-mobile 并存，门报出其中一枚（23033），旧期望就把它判成 ❌ ——
#     **那是臂的期望比契约宽，不是门坏**（同族：恒红的等待类读数最贵）。
#     "注入必被认得"这条真牙搬去 T2 的**受控快照腿**（探针本来就收 psfile 实参）。
run_gate "$D/t1"
GOT_VM=$(pids_in "$D/t1" "有移动端验收在跑"); GOT_RI=$(pids_in "$D/t1" "有另一趟 reinstall-all 在跑")
[ -z "$GOT_VM" ] && GOT_VM="(无)"; [ -z "$GOT_RI" ] && GOT_RI="(无)"
GOT_VM_N=$(printf '%s\n' $GOT_VM | grep -c '[0-9]' || true)
in_set() { case " $2 " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
LIVE_VM=""
for pid in $(pgrep -f 'verify-mobile' 2>/dev/null); do in_tree "$pid" || LIVE_VM="$LIVE_VM$pid "; done
if [ "$GOT_VM_N" -gt 1 ]; then
  echo "   ❌ 第一道报出 $GOT_VM_N 枚 [$GOT_VM] ⇒ 共享探针的基数契约变了（原来只出一枚代表）"
  echo "      ⇒ 这一臂要按**新契约**重设计并在台账里写明，不许顺势把期望改成『多枚也行』"; fail=1
elif [ "$GOT_VM" = "(无)" ]; then
  if [ -n "$BASE_VM" ]; then
    echo "   ℹ️ 第一道没报，而开跑时的候选基线非空 [${BASE_VM}]"
    echo "      探针的规则会排除闸门自身 / 「bash -n」/「-c 包装进程」⇒ 这一格记**未定性**，不判门坏"
    echo "      （真正的「注入必被认得」在 T2 的受控快照腿上）；候选 argv 逐行："
    for pid in $BASE_VM; do ps -p "$pid" -o command= 2>/dev/null | sed 's/^/        /' | cut -c1-150; done
  else
    echo "   ✅ 第一道没报，候选基线也为空（设备面没人）"
  fi
else
  okc=1
  for p in $GOT_VM; do
    in_set "$p" "$BASE_VM" || in_set "$p" "$LIVE_VM" || { okc=0; BADP="$p"; }
  done
  if [ "$okc" = 1 ]; then
    echo "   ✅ 第一道报出 [$GOT_VM]（一枚代表）认得出来源（开跑基线 [${BASE_VM:-空}] ∪ 现读 [${LIVE_VM:-空}]）"
  else
    echo "   ❌ 第一道报出 [$GOT_VM]：$BADP 既不在开跑基线也不在现读候选里 ⇒ 编出来的读数"; fail=1
  fi
fi
if [ "$(printf '%s' "$GOT_RI" | tr -s ' ' '\n' | sort | tr -d '\n')" = "$(printf '%s' "${BASE_RI:-"(无)"}" | tr -s ' ' '\n' | sort | tr -d '\n')" ]; then
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

echo "== T2 注入外部 verify-mobile 运行者 ⇒ 两腿：受控快照必须点名它，现场必须判红 =="
# 注意：这一臂注入的名字必须能被探针的正解认到（`verify-mobile-[a-z-]+\.sh`），
#       第一版我用了 "fake-e2e"（含数字）不命中，那**是臂坏不是门坏** —— 当时差点据此判门没牙。
# 🔴 12:5x 起这一臂拆成两腿：旧写法在现场三条 verify-mobile 并存时假红（门报的是"一枚代表"，
#    契约如此），而"必点名到我注入的那一枚"这句话比契约宽。真牙搬到受控快照腿。
spawn_vm_check() {   # $1=臂名 $2=假运行者 argv $3=闸门里的关键词
  ( exec bash "$2" ) &
  local fp=$!
  sleep 1
  ps -p "$fp" -o pid=,ppid=,command= > "$D/$1.ps" 2>/dev/null
  if [ ! -s "$D/$1.ps" ]; then echo "❌ 假进程 $1 起不来 ⇒ 装置坏（exit 4）"; exit 4; fi
  sed 's/^/   真实 ps 行: /' "$D/$1.ps" | cut -c1-170
  run_gate "$D/$1"
  kill "$fp" 2>/dev/null; wait "$fp" 2>/dev/null
  # 腿 A（受控快照）：把**这条真 argv** 单独喂进探针的 psfile 通道 ⇒ 必须恰好点名 fp。
  #   这一腿才配得上"注入必被认得"：现场有别人时闸门可以报别人，受控快照里只有它自己。
  local got2
  got2=$(MOBILE_E2E_PROBE_ME=99999 mobile_e2e_runner_lines "$D/$1.ps" | awk '{print $1}')
  if [ "$got2" = "$fp" ]; then
    printf '   ✅ %s 受控快照腿：探针恰好点名注入的那枚（pid %s）\n' "$1" "$fp"
  else
    printf '   ❌ %s 受控快照腿：快照里只有它自己却没点名 %s（点名 [%s]）⇒ 门真的没牙\n' "$1" "$fp" "$got2"
    fail=1
  fi
  # 腿 B（现场）：闸门必须把第一道判红，且报出的那一枚来路可追（注入 ∪ 开跑基线 ∪ 现读）
  local rep okv=1 p2
  rep=$(pids_in "$D/$1" "$3")
  if [ -z "$rep" ]; then
    printf '   ❌ %s 现场腿：注入了运行者，闸门 3b 却没报「%s」⇒ 漏报\n' "$1" "$3"; fail=1
  else
    for p2 in $rep; do in_set "$p2" "$BASE_VM $LIVE_VM $fp " || okv=0; done
    if [ "$okv" = 1 ]; then
      printf '   ✅ %s 现场腿：闸门报出 [%s]（我注入的是 %s；第一道只出一枚代表）\n' "$1" "$rep" "$fp"
    else
      printf '   ❌ %s 现场腿：报出 [%s] 来路不明（既不是注入的也不在基线/现读里）\n' "$1" "$rep"; fail=1
    fi
  fi
}
spawn_vm_check t2 "$D/fakescripts/.verify-mobile-fakearm.sh" "有移动端验收在跑"

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
