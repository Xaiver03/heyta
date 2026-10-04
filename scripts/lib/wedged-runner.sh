#!/bin/bash
# 一道纯读数：那个"还在跑"的运行者是**在推进**还是**已经楔住**。
#
# 🔴 为什么需要它（2026-10-04 08:5x 现量教出来的）：
#   两道前置门（`verify-mobile-window-gate.sh` / `b-reinstall-readiness.sh`）原来都只回答
#   "有没有人在占" —— 而"有"这一档下面藏着两种完全相反的下一步：
#     ① 它在推进 ⇒ 等它跑完，窗口会自己开；
#     ② 它卡在外部服务上不动 ⇒ **等不到**，继续挂着看守是零产出。
#   现场证据：那趟 reinstall 的 macOS 段子进程是
#   `notarytool submit Heyta-1.0.0.dmg`，etime **05:32:09**（=19929s）而累计 CPU **0:00.03**，
#   它自己的日志自 03:12 起一个字没写。那一刻两道的读数都还只是"有另一趟在跑"。
#   ⇒ 一个永远不会开的窗口，在输出上长得和"再等 20 分钟"一模一样。
#
# 🔴 本文件的边界（越界就会变成第二套开窗判据）：
#   - **只打印，不决定**：调用方的红/绿、退出码、`REDS=` 机器通道一条都不经由这里。
#     楔住 ≠ 可以让窗（那一趟随时可能醒过来继续 uninstall 设备）；楔住也不是"可以杀它"，
#     它不是本线的进程。它只改变**登记方式**：从"等窗口"改成"这一条要人拍板"。
#   - **算不出就不宣布**（unknown 档）：取不到 etime/CPU 时绝不说"楔住"，也不说"没楔住"。
#   - 阈值从"这一趟已经活了多久"推，不从"我预期它多久跑完"来 —— 后者是要人拍的。
#
# 依赖：零（纯 bash + ps/pgrep）。bash 3.2 可用（不用关联数组 / 不用 read -a）。

# ── 旋钮（默认值就是判据本体，改它等于改判据）──
WEDGE_AGE_S="${WEDGE_AGE_S:-3600}"   # 活着 ≥1h 才有资格被判楔住
WEDGE_CPU_S="${WEDGE_CPU_S:-2}"      # 而累计 CPU ≤2s ⇒ 这一小时它没在算东西

# ps 的两种时长形状都长成 [[DD-][hh:]mm:ss][.hh]
#   etime= 05:32:09 / 32:09 / 09 / 1-02:03:04
#   time=  0:00.03 / 12:34.56 / 1:02:03.45
# 解不出来一律回**空串**（调用方必须把空串当"不知道"，不能当 0 —— 0 会落进"很新鲜"）。
ht_hms_to_s() {
  local s="$1" d='' h='' m='' sec='' part ncol
  s="${s//[[:space:]]/}"
  [ -n "$s" ] || { printf ''; return; }
  case "$s" in *-*) d="${s%%-*}"; s="${s#*-}" ;; esac
  s="${s%%.*}"                                  # 丢掉 .hh 小数秒
  [ -n "$s" ] || { printf ''; return; }
  case "$d" in ''|*[!0-9]*) [ -n "$d" ] && { printf ''; return; } ;; esac
  ncol=$(printf '%s' "$s" | tr -cd ':' | wc -c | tr -d ' ')
  case "$ncol" in
    0) sec="$s" ;;
    1) m="${s%%:*}"; sec="${s#*:}" ;;
    2) h="${s%%:*}"; part="${s#*:}"; m="${part%%:*}"; sec="${part##*:}" ;;
    *) printf ''; return ;;
  esac
  for part in "$h" "$m" "$sec"; do
    case "$part" in '') : ;; *[!0-9]*) printf ''; return ;; esac
  done
  case "$sec" in ''|*[!0-9]*) printf ''; return ;; esac
  # ⚠️ 不写成 `$(( 10#$sec + ${m:+…} + ${h:+…} ))`：三段都缺时那会变成 `$(( 9 + + + ))`
  #    —— 语法错，且**只在一段的输入上**才触发（正是 `etime=09` 这一档，自检抓到了它）。
  local total=$((10#$sec))
  [ -n "$m" ] && total=$((total + 10#$m * 60))
  [ -n "$h" ] && total=$((total + 10#$h * 3600))
  [ -n "$d" ] && total=$((total + 10#$d * 86400))
  printf '%s' "$total"
}

# 三档读数 + 一档"不知道"。只有 wedged 会被打印成 🔴。
ht_wedge_verdict() {
  local e="$1" c="$2"
  case "$e" in ''|*[!0-9]*) printf 'unknown'; return ;; esac
  case "$c" in ''|*[!0-9]*) printf 'unknown'; return ;; esac
  if [ "$e" -lt "$WEDGE_AGE_S" ]; then printf 'fresh'
  elif [ "$c" -le "$WEDGE_CPU_S" ]; then printf 'wedged'
  else printf 'busy'
  fi
}

# 找"最深、活得最久的那个叶子"：真正卡住的东西总在叶子（父进程只是在 wait）。
# 结果写进 HT_LEAF_*（不打包成一行：命令行里可能有空格与竖线，解析会切错）。
# 一个都取不到 ⇒ HT_LEAF_PID 为空。
#
# 🔴 同层兄弟之间的取序是一枚**必须写死的比较器**，不是"谁先返回"（2026-10-04 12:4x 现量教的）：
#   同一趟 `notarytool submit … --wait | tail -8 | awk` 管道里三枚叶子的 etime **逐秒相同**，
#   而旧实现只有 `es -gt best_e`（同龄 ⇒ 先来者赢），先来者是 `pgrep -P` 返回的那一枚 ——
#   于是"卡在什么上"这句话在两趟之间翻脸：12:41:57 那趟打的是 `tail -8`，
#   12:42:42 同一处打的是 `notarytool submit …`。差的不只是措辞：
#   **`tail -8` 楔住 = 没有东西可拍板，`notarytool` 楔住 9h29m = 要持有者决定要不要放弃这一次公证**，
#   而这句话正是"登记方式从等窗口改成要人拍板"的唯一依据。
#   ⇒ 排序三级：① **不是管道消费者**（消费者只是在等上游，它从来不是阻塞点）
#      ② 龄更大 ③ pid 更小。三级都显式比 ⇒ 同场两趟必点名同一枚。
HT_FILTER_NAMES=' tail head cat awk grep sed sort uniq wc cut tr tee xargs jq '
ht_leaf_is_filter() {
  local w="${1%% *}"
  w="${w##*/}"
  [ -n "$w" ] || return 1
  case "$HT_FILTER_NAMES" in *" $w "*) return 0 ;; esac
  return 1
}

# 候选 (是否消费者, 龄, pid) 比当前最优 (best_f, best_e, best_p) 更该被点名吗？
# 读的是调用方的 best_*（bash 是动态作用域）—— 不许改成实参传递：那三枚在循环里演进。
ht_leaf_better() {
  local f="$1" es="$2" p="$3"
  [ -n "${best_p:-}" ] || return 0
  if [ "$f" != "$best_f" ]; then [ "$f" = 0 ] && return 0; return 1; fi
  if [ "$es" != "$best_e" ]; then [ "$es" -gt "$best_e" ] && return 0; return 1; fi
  [ "$p" -lt "$best_p" ] && return 0
  return 1
}

ht_wedge_leaf() {
  # 🔴 bash 3.2：**同一条 local 里后面的赋值看不到前面的**（`set -x` 现量印出
  #    `local root=31694 frontier=` —— frontier 是空串），于是循环第一跳就 break，
  #    症状是"取不到叶子"，长得和"现场根本没有子进程"一模一样。
  #    bash 4+ 是左到右可见的 ⇒ 这条只在 macOS 自带的那台 3.2 上才会翻。
  local root="$1"
  local frontier="$root" p k kids es i=0
  local best_p='' best_e='' best_f=''
  local c f
  HT_LEAF_PID=''; HT_LEAF_AGE_S=''; HT_LEAF_CPU=''; HT_LEAF_CMD=''
  while [ -n "$frontier" ] && [ "$i" -lt 8 ]; do
    i=$((i + 1))
    kids=''
    for p in $frontier; do
      k=$(pgrep -P "$p" 2>/dev/null | tr '\n' ' ')
      if [ -n "${k// /}" ]; then kids="${kids}${k} "; else
        es=$(ht_hms_to_s "$(ps -p "$p" -o etime= 2>/dev/null | tr -d ' ')")
        if [ -n "$es" ]; then
          c=$(ps -p "$p" -o command= 2>/dev/null)
          f=0; ht_leaf_is_filter "$c" && f=1
          if ht_leaf_better "$f" "$es" "$p"; then
            best_p="$p"; best_e="$es"; best_f="$f"
            HT_LEAF_PID="$p"
            HT_LEAF_AGE_S="$es"
            HT_LEAF_CPU=$(ps -p "$p" -o time= 2>/dev/null | tr -d ' ')
            HT_LEAF_CMD=$(printf '%s' "$c" | cut -c1-90)
          fi
        fi
      fi
    done
    frontier="${kids% }"
    [ -n "$frontier" ] || break
  done
  [ -n "$HT_LEAF_PID" ] && printf '%s' "$HT_LEAF_PID" || printf ''
}

# 调用方唯一该用的一行：拿 pid 打一条读数。**永远 return 0**，不参与判定。
# $1 = pid，$2 = 人话标签（"重装" / "移动端验收"），$3 = 缩进前缀（默认 6 空格）
ht_wedge_report() {
  local pid="$1" label="${2:-运行者}" ind="${3:-      }" es cs cmd v raw_e raw_c
  ht_wedge_leaf "$pid" >/dev/null
  if [ -z "$HT_LEAF_PID" ]; then
    printf '%sℹ️ %s pid=%s 取不到叶子/时长 ⇒ **不宣布**楔住（也不算它新鲜）\n' "$ind" "$label" "$pid"
    return 0
  fi
  es="$HT_LEAF_AGE_S"; cs=$(ht_hms_to_s "$HT_LEAF_CPU"); cmd="$HT_LEAF_CMD"
  v=$(ht_wedge_verdict "$es" "$cs")
  case "$v" in
    wedged)
      printf '%s🔴 这一趟**很可能已经楔住**：叶子 pid=%s 已活 %ss 而累计 CPU=%ss，卡在：\n' "$ind" "$HT_LEAF_PID" "$es" "${cs:-?}"
      printf '%s      %s\n' "$ind" "$cmd"
      printf '%s   ⇒ 下一步**不是**继续等窗口：等它是零产出，而它随时可能醒过来动设备。\n' "$ind"
      printf '%s   ⇒ 本装置不杀、不接管（那不是本线的进程）；要人拍板。现量复跑：\n' "$ind"
      printf '%s      ps -p %s -o pid=,etime=,time=,command=; pgrep -P %s\n' "$ind" "$HT_LEAF_PID" "$pid"
      ;;
    busy)  printf '%sℹ️ %s 在推进（叶子 %ss 龄、CPU %ss）⇒ 等它跑完是自洽的下一步\n' "$ind" "$label" "$es" "${cs:-?}" ;;
    fresh) printf '%sℹ️ %s 起跑未久（叶子 %ss < %ss）⇒ 先按"还在跑"处理\n' "$ind" "$label" "$es" "$WEDGE_AGE_S" ;;
    *)
      raw_e=$(ps -p "$HT_LEAF_PID" -o etime= 2>/dev/null | tr -d ' ')
      raw_c=$(ps -p "$HT_LEAF_PID" -o time= 2>/dev/null | tr -d ' ')
      printf '%sℹ️ %s 的时长/CPU 有一个解析不出（etime=%s cpu=%s 原形）⇒ **不宣布**楔住\n' "$ind" "$label" "$raw_e" "$raw_c" ;;
  esac
  return 0
}

# ── 自检：判据必须能红（AGENTS §8.3）。期望值全部手算过，不是抄输出。──
ht_wedge_self_check() {
  local bad=0 n=0 leaf
  ck() { # $1 = 期望 $2 = 实际 $3 = 说明
    n=$((n + 1))
    if [ "$1" = "$2" ]; then printf '  ✅ %s ⇒ %s\n' "$3" "$2"
    else printf '  ❌ %s ⇒ 期望 [%s]，实际 [%s]\n' "$3" "$1" "$2"; bad=$((bad + 1)); fi
  }
  # 手算：05:32:09 = 18000+1920+9；1-02:03:04 = 86400+7200+180+4
  ck 19929 "$(ht_hms_to_s '05:32:09')" "etime 05:32:09 → 秒"
  ck 1929 "$(ht_hms_to_s '32:09')" "etime 32:09 → 秒"
  ck 9 "$(ht_hms_to_s '09')" "etime 09 → 秒"
  ck 93784 "$(ht_hms_to_s '1-02:03:04')" "带天数的 etime → 秒"
  ck 0 "$(ht_hms_to_s '0:00.03')" "CPU 0:00.03 → 秒（小数秒丢掉）"
  ck 754 "$(ht_hms_to_s '12:34.56')" "CPU 12:34.56 → 秒"
  ck 3723 "$(ht_hms_to_s '1:02:03.45')" "CPU 三段 → 秒"
  ck '' "$(ht_hms_to_s 'ab:cd:ef')" "非法串 → 空串（不许当 0）"
  ck '' "$(ht_hms_to_s '')" "空串 → 空串"
  ck '' "$(ht_hms_to_s '1-')" "只剩天数前缀 → 空串"
  ck '' "$(ht_hms_to_s '1:2:3:4')" "四段 → 空串"
  ck wedged "$(ht_wedge_verdict 19929 0)" "5.5h 龄 & CPU≈0 → wedged"
  ck busy "$(ht_wedge_verdict 19929 60)" "5.5h 龄但 CPU 60s → busy"
  ck fresh "$(ht_wedge_verdict 120 0)" "2 分钟龄 → fresh（起跑未久）"
  ck unknown "$(ht_wedge_verdict '' 0)" "取不到 etime → unknown"
  ck unknown "$(ht_wedge_verdict 19929 '')" "取不到 CPU → unknown"
  ck unknown "$(ht_wedge_verdict 19929 'x1')" "CPU 含非数字 → unknown"
  # 阈值边界：等于阈值算"够老"，差 1 秒不算（挡"阈值写成 >"那一档漂移）
  ck wedged "$(ht_wedge_verdict "$WEDGE_AGE_S" 0)" "龄 == 阈值 → wedged"
  ck fresh "$(ht_wedge_verdict "$((WEDGE_AGE_S - 1))" 0)" "龄 == 阈值-1 → fresh"
  ck wedged "$(ht_wedge_verdict "$WEDGE_AGE_S" "$WEDGE_CPU_S")" "CPU == 阈值 → 仍算楔住"
  ck busy "$(ht_wedge_verdict "$WEDGE_AGE_S" "$((WEDGE_CPU_S + 1))")" "CPU == 阈值+1 → busy"
  # 🔴 比较器三级各一条**纯函数腿**（不靠真进程同龄 —— 跨一秒就漂，那是会自己失效的夹具）。
  #    期望串 0101 = ①同类同龄 ⇒ 小 pid 赢(0) ②大 pid 不赢(1)
  #    ③非消费者压过**更老**的消费者(0) ④消费者哪怕更老也不压过非消费者(1)。
  #    ③④ 合起来才是那处现场翻脸的更正：只写 ③ 的话，"把消费者整枚剔除"那种写反也能过。
  n=$((n + 1))
  ( best_p=100; best_e=500; best_f=0; ht_leaf_better 0 500 90 ) && r1=0 || r1=1
  ( best_p=100; best_e=500; best_f=0; ht_leaf_better 0 500 110 ) && r2=0 || r2=1
  ( best_p=100; best_e=999; best_f=1; ht_leaf_better 0 10 101 ) && r3=0 || r3=1
  ( best_p=100; best_e=10; best_f=0; ht_leaf_better 1 999 101 ) && r4=0 || r4=1
  ck 0101 "$r1$r2$r3$r4" "比较器：pid tie-break + 非消费者优先（双向）"
  # 🔴 正向对照**不许从 `$$` 往下走**（第一版就是这么写的，结果这条恒红）：
  #    从自己出发时 `pgrep -P` 会数到本函数自己的临时子 shell（每一处 `$( … )` 都是一枚），
  #    而那些 subshell 到 `ps` 那一刻已经退出 ⇒ 叶子"找到了又取不到时长"。
  #    这是"探针改变被测对象"那一族（§7 #83 同族），不是现场没有子进程。
  #    正解：起一枚**两层**的独立夹具（外层 shell + 内层 sleep），从外层出发走，
  #    断言叶子是内层那枚而不是外层 ⇒ 一次同时验"取得到"与"真的往下走了一层"。
  ( ( exec -a ht-wedge-fixture-sleep sleep 25 ) & wait ) >/dev/null 2>&1 &
  ROOT=$!
  # ⚠️ 从作业表里摘掉：否则收尾那句 `kill` 会让 bash 把 `Terminated: 15 …` 打进 stdout，
  #    混在 ✅ 行里 —— 装置的输出是要给人和臂 grep 的，噪声也是一种假读数。
  disown "$ROOT" 2>/dev/null
  sleep 0.6
  # 🔴 不能用 `leaf=$(ht_wedge_leaf …)`：结果同时走 stdout 和 HT_LEAF_* 全局，
  #    而命令替换在 **subshell** 里跑 ⇒ 全局回不到父 shell（第一版就栽在这里：
  #    pid 拿得到、cmd/龄/CPU 全空，看起来像"函数坏了"，其实是取用的姿势错）。
  ht_wedge_leaf "$ROOT" >/dev/null
  leaf="$HT_LEAF_PID"
  n=$((n + 1))
  if [ -n "$leaf" ] && [ "$leaf" != "$ROOT" ] && printf '%s' "$HT_LEAF_CMD" | grep -q 'ht-wedge-fixture-sleep'; then
    printf '  ✅ 两层夹具：走到底且拿的是叶子（root=%s → leaf=%s，cmd 含 sleep）\n' "$ROOT" "$leaf"
  else
    printf '  ❌ 两层夹具：root=%s leaf=[%s] cmd=[%s]（期望拿到内层那枚 sleep）\n' "$ROOT" "$leaf" "$HT_LEAF_CMD"
    bad=$((bad + 1))
  fi
  # 端到端：真 ps 串走完 解析 → 判定，夹具刚起必是 fresh（挡"解析对但判据永远同一档"）
  n=$((n + 1))
  if [ "$(ht_wedge_verdict "$HT_LEAF_AGE_S" "$(ht_hms_to_s "$HT_LEAF_CPU")")" = fresh ]; then
    printf '  ✅ 端到端判定：夹具龄 %ss / CPU [%s] → fresh\n' "$HT_LEAF_AGE_S" "$HT_LEAF_CPU"
  else
    printf '  ❌ 端到端判定：夹具刚起却是 %s/%s ⇒ 有一环坏了\n' "$HT_LEAF_AGE_S" "$HT_LEAF_CPU"
    bad=$((bad + 1))
  fi
  # 整条 report 在同一条真进程上必须打得出来且退 0（它是纯读数，不许影响判定）
  ht_wedge_report "$ROOT" "自检" "  " > /tmp/ht-wedge-selfreport.$$.txt 2>&1
  local rc=$?   # 🔴 必须紧跟着一行就取：$? 后面隔一句赋值就被读成那句的码（§7 #45 那一族）
  n=$((n + 1))
  if [ "$rc" = 0 ] && grep -q 'fresh\|推进\|未久\|不宣布' /tmp/ht-wedge-selfreport.$$.txt; then
    printf '  ✅ ht_wedge_report 真进程：退 0 且打出一档读数\n'
  else
    printf '  ❌ ht_wedge_report 真进程 rc=%s，输出：\n' "$rc"; sed 's/^/      /' /tmp/ht-wedge-selfreport.$$.txt
    bad=$((bad + 1))
  fi
  rm -f /tmp/ht-wedge-selfreport.$$.txt
  # 夹具收尾：内层那枚是 subshell 的孩子，直接杀 root 会留孤儿 ⇒ 两层各杀一次
  pkill -f 'ht-wedge-fixture-sleep' 2>/dev/null
  kill "$ROOT" 2>/dev/null
  n=$((n + 1))
  if [ -z "$(pgrep -f 'ht-wedge-fixture-sleep' 2>/dev/null)" ]; then printf '  ✅ 夹具已收干净（无残留）\n'
  else printf '  ❌ 夹具残留：%s\n' "$(pgrep -f 'ht-wedge-fixture-sleep' | tr '\n' ' ')"; bad=$((bad + 1)); fi
  # 🔴 同层兄弟的点名必须**确定**（12:4x 现场翻脸那处的直接更正，理由写在 ht_wedge_leaf 头上）：
  #    夹具 = 真管道的形状，**消费者比真等的那枚更老** ⇒ 必须点名年轻的那枚。
  #    旧实现只有 `es -gt best_e`（同龄 ⇒ 先来者赢），在这种形状下点名 `tail` ——
  #    现场就是这么把 `notarytool submit … --wait` 说成 `tail -8` 的（同层三枚 etime 逐秒相同）。
  #    ⚠️ 消费者那枚**不许 exec -a 改名**：分类器读的是 argv[0]，改名会让它看起来不是消费者。
  FIXSH="/tmp/ht-wedge-pipe-fixture.$$.sh"
  printf '#!/bin/bash\ntail -f /dev/null &\nsleep 1\n( exec -a ht-wedge-pipe-fixture-sleep sleep 25 ) &\nwait\n' > "$FIXSH"
  ( bash "$FIXSH" >/dev/null 2>&1 ) &
  FIX=$!
  disown "$FIX" 2>/dev/null
  i=0   # 等第二枚真起来（这台机上 `sleep 1` 可能被压到 >1.5s，那时只有 tail ⇒ 臂会假红）
  while [ "$i" -lt 30 ] && [ -z "$(pgrep -f 'ht-wedge-pipe-fixture-sleep' 2>/dev/null)" ]; do
    sleep 0.15; i=$((i + 1))
  done
  ht_wedge_leaf "$FIX" >/dev/null
  FIXBASH=$(pgrep -P "$FIX" 2>/dev/null | head -1)
  n=$((n + 1))
  if printf '%s' "$HT_LEAF_CMD" | grep -q 'ht-wedge-pipe-fixture-sleep'; then
    printf '  ✅ 管道夹具：更老的消费者 tail 没被点名，点名的是真在等的那枚（leaf=%s）\n' "$HT_LEAF_PID"
  else
    printf '  ❌ 管道夹具：点名了 [%s] ⇒ 比较器退化成"先来者赢"（leaf=%s 同层=%s）\n' \
      "$HT_LEAF_CMD" "$HT_LEAF_PID" "$(pgrep -P "${FIXBASH:-0}" 2>/dev/null | tr '\n' ' ')"
    bad=$((bad + 1))
  fi
  # 反向腿：**全场只有消费者**时不许变成"没有叶子"（挡"把消费者整枚剔除"那种写反 ——
  # 优先级降级 ≠ 剔除，剔除了就等于把那趟运行说成"取不到叶子"）。
  ONLYSH="/tmp/ht-wedge-onlytail.$$.sh"
  printf '#!/bin/bash\ntail -f /dev/null &\nwait\n' > "$ONLYSH"
  ( bash "$ONLYSH" >/dev/null 2>&1 ) &
  ONLY=$!
  disown "$ONLY" 2>/dev/null
  i=0
  while [ "$i" -lt 20 ] && [ -z "$(pgrep -P "$(pgrep -P "$ONLY" 2>/dev/null | head -1)" 2>/dev/null)" ]; do
    sleep 0.15; i=$((i + 1))
  done
  ht_wedge_leaf "$ONLY" >/dev/null
  ONLYBASH=$(pgrep -P "$ONLY" 2>/dev/null | head -1)
  n=$((n + 1))
  if [ -n "$HT_LEAF_PID" ] && printf '%s' "$HT_LEAF_CMD" | grep -q 'tail -f /dev/null'; then
    printf '  ✅ 只有消费者的一层：仍然点名它（leaf=%s，降级 ≠ 剔除）\n' "$HT_LEAF_PID"
  else
    printf '  ❌ 只有消费者的一层：leaf=[%s] cmd=[%s]（期望点名那枚 tail）\n' "$HT_LEAF_PID" "$HT_LEAF_CMD"
    bad=$((bad + 1))
  fi
  for p in $(pgrep -P "${FIXBASH:-0}" 2>/dev/null) $(pgrep -P "${ONLYBASH:-0}" 2>/dev/null); do kill "$p" 2>/dev/null; done
  kill "$FIXBASH" "$ONLYBASH" "$FIX" "$ONLY" 2>/dev/null
  pkill -f 'ht-wedge-pipe-fixture-sleep' 2>/dev/null
  rm -f "$FIXSH" "$ONLYSH"
  # 不存在的 pid ⇒ 必须是空（不许编一个读数出来）
  n=$((n + 1))
  if [ -z "$(ht_wedge_leaf 999999)" ]; then printf '  ✅ 不存在的 pid → 空（不编读数）\n'
  else printf '  ❌ 不存在的 pid 竟然有叶子\n'; bad=$((bad + 1)); fi
  printf '自检 %d 条：%s\n' "$n" "$([ "$bad" = 0 ] && echo '全绿' || echo "有 $bad 条不成立 ⇒ 装置坏")"
  [ "$bad" = 0 ]
}

# 🔴 只在**被直接执行**时才是入口；被 source 时必须一个字都不做。
#    第一版这里直接写 `case "${1:-}" …`，而**被 source 时 `$1` 是调用方的参数** ——
#    现量后果：`b-reinstall-readiness.sh --selftest` 被本文件截走，打完自己的那批（当时 26 条）就 `exit 0`，
#    就 `exit 0`，四臂自检一条没跑还报绿（sourced 文件里的 `exit` 会杀掉宿主）。
#    这类"入口偷了宿主的参数"是 §8.3 那一族里最贵的：它把"没跑"伪装成"跑过了"。
if [ "${BASH_SOURCE[0]:-}" = "$0" ]; then
  case "${1:-}" in
    --self-check|--selftest) ht_wedge_self_check; exit $? ;;
  esac
fi
