#!/bin/bash
#
# "这台设备上还有别的移动端验收在跑吗" 的**唯一实现**
# ================================================================
#
# 消费者（它们要的排除规则是同一条，所以不该各写一份）：
#   - `lib/mobile-e2e.sh` 的 `another_mobile_e2e_running`：各验收脚本在任何
#     破坏性动作（`pm clear` / `install -r` / 按坐标点击）**之前**的门；
#   - `verify-mobile-window-gate.sh` 的设备独占粗筛：只体检窗口开没开的 dry-run，
#     它**不能** source `mobile-e2e.sh`（那个文件尾有会真动设备的 EXIT trap），
#     所以它直接 source 本文件。
#
# 🔴 本文件只许**定义函数**：不许 trap、不许碰设备、不许有副作用。
#    加了副作用，dry-run 那条消费者就会开始改机器状态。
#
# 🔴 本文件只许**定义函数**：不许 trap、不许碰设备、不许有副作用。
#    加了副作用，dry-run 那条消费者就会开始改机器状态。
#
# 🔴 为什么不用 `bash [^ ]*verify-mobile-…\.sh`（本仓旧写法，曾在两处抄件里）：
#    `[^ ]*` **跨不过空格**，而本仓的绝对路径含空格（`All in one Data`），
#    且 36 个 `verify-*.sh` / `reinstall-all.sh` 会把自己快照成
#    `bash <绝对路径>/.<原名>.snap.<pid>` 再 exec（为了被 kill -9 也留得下名字）。
#    ⇒ 旧探针**对这一整类运行者永久隐形**，也就是"不许并行清对方现场"那道门
#    事实上没在守。2026-10-04 实测：把一条真实 argv 喂给旧 awk，输出为空
#    （`bash /Users/…/scripts/.verify-mobile-ios-reminder.sh.snap.66564`）。
#    现在的做法：只认 argv[0] 是 bash 的行，把参数**逐段拼接（空格被丢掉）**
#    之后再匹配脚本名 —— 空格在不在路径里都一样。
#    方向上偏保守也更好：这里**误报只是白等一个窗口，漏报会清掉别人的现场**。
#
# 判据本身：`bash scripts/lib/mobile-e2e-runner-probe.sh --self-check`
#（它喂六行夹具、逐行断言命中/不命中，并且**能失败** —— 把上面那条
#  "逐段拼接"改回 `[^ ]*` 会让第一条夹具转红。）

# 输出那一行进程（没有别的运行者则不输出）。
# $1: 可选，进程表文件（默认：现跑一次 `ps` 写到 /tmp 那份）。
mobile_e2e_runner_lines() {
  local psfile="${1:-/tmp/_heyta_mobile_e2e_ps.txt}"
  if [ "$#" -lt 1 ] || [ ! -f "$1" ]; then
    ps -Ao pid=,ppid=,command= > "$psfile" 2>/dev/null
  fi
  # `$$` 在命令替换的子 shell 里仍是**父 shell 的 pid**（bash 的规定），而子 shell
  # 自己的 pid 不是 `$$` —— 它的 argv 与本脚本逐字相同。所以只排 `$$` 会把**自己**
  # 当成别人（实测踩过：脚本刚启动就报"还有别的验收在跑"）。连带排掉 `$$` 的直接子进程。
  awk -v me="${MOBILE_E2E_PROBE_ME:-$$}" '
    $1 == me { next }
    $2 == me { next }
    # 包装进程（`zsh -c …` / `bash -c …`）的 argv 里可能内嵌脚本名文本，
    # 但它不驱动设备 —— 真正的运行者会被单独匹配到。
    $0 ~ /(zsh|bash) -c/ { next }
    # argv[0] 必须是解释器本体：`bash <脚本>`（也认 `/bin/bash`、`/usr/bin/bash`）。
    $3 !~ /(^|\/)bash$/ { next }
    # `bash -n` 是语法预检，不是运行者。
    $4 == "-n" { next }
    $0 !~ /bash -n/ {
      rest = ""
      for (i = 4; i <= NF; i++) rest = rest $i
      if (rest ~ /verify-mobile-[a-z-]+\.sh/) { print; exit }
    }
  ' "$psfile"
}

# 🔴 只在**被直接执行**时自检：这个文件也会被 source，而 source 它的脚本有自己的
#    `$1`（例如 `bash scripts/verify-mobile-notes.sh --self-check` 会误触发一次自检）。
if [ "${1:-}" = "--self-check" ] && [ "${BASH_SOURCE[0]:-}" = "$0" ]; then
  FIX=/tmp/_heyta_runner_probe_fixtures.txt
  cat > "$FIX" <<'FIXTURES'
11111 73231 bash /Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/scripts/.verify-mobile-ios-reminder.sh.snap.11111
22222 73231 bash scripts/verify-mobile-notes.sh
33333 73231 bash -n scripts/verify-mobile-notes.sh
44444 73231 /bin/zsh -c cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta" && bash scripts/verify-mobile-edit.sh
55555 73231 bash scripts/reinstall-all.sh
66666 73231 node scripts/some-tool.mjs verify-mobile-calendar.sh
FIXTURES
  # 期望：只有前两条是运行者（3 = 预检、4 = 包装、5 = 非 mobile 脚本、6 = 不是 bash）。
  # 用 MOBILE_E2E_PROBE_ME 把"自己"钉成 22222，顺带验证按 pid 排除自己这条规则。
  HIT=$(MOBILE_E2E_PROBE_ME=22222 mobile_e2e_runner_lines "$FIX" | awk '{print $1}')
  NPASS=0; NFAIL=0
  check() {
    if [ "$2" = "$3" ]; then echo "   ✅ $1"; NPASS=$((NPASS + 1));
    else echo "   ❌ $1（期望 '$2'，实得 '$3'）"; NFAIL=$((NFAIL + 1)); fi
  }
  # 一次只准命中一行（探针 `exit` 在第一条命中上），所以逐行单独喂。
  for line in $(seq 1 6); do
    sed -n "${line}p" "$FIX" > /tmp/_heyta_runner_probe_one.txt
    ONE=$(MOBILE_E2E_PROBE_ME=22222 mobile_e2e_runner_lines /tmp/_heyta_runner_probe_one.txt | awk '{print $1}')
    case $line in
      1) want=11111; why="绝对路径含空格的 .snap 运行者（旧写法漏看的那条）" ;;
      2) want="";    why="自己的 pid 要被排除（22222 = 探针调用者）" ;;
      3) want="";    why="bash -n 预检不算运行者" ;;
      4) want="";    why="zsh -c 包装进程不算运行者" ;;
      5) want="";    why="非 mobile 验收脚本不算" ;;
      6) want="";    why="argv[0] 不是 bash 的不算" ;;
    esac
    check "$why" "$want" "$ONE"
  done
  # 阳性对照：同一条 mobile 脚本，换个 pid 当"别人"就必须命中。
  sed -n '2p' "$FIX" > /tmp/_heyta_runner_probe_one.txt
  OTHER=$(MOBILE_E2E_PROBE_ME=99999 mobile_e2e_runner_lines /tmp/_heyta_runner_probe_one.txt | awk '{print $1}')
  check "把 22222 当别人时必须命中（否则上面那些'不命中'可能只是探针根本不读文件）" "22222" "$OTHER"
  echo ""
  echo "自检：$NPASS 绿 / $NFAIL 红"
  [ "$NFAIL" -eq 0 ] || exit 1
  echo "（真实探针当前的读数：'${HIT}' —— 空 = 此刻没有别的移动端验收在跑）"
fi
