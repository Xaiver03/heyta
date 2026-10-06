#!/bin/bash
# `scripts/lib/wedged-runner.sh --self-check` 的变异臂：证明那批读数**能失败**。
# 条数不写死在这里（写死就会漂）：现量看 `自检 N 条` 那行 —— 12:5x 是 **29**。
#
# 纪律（与 b-arm3-mutation-arms.sh 同一套，理由在那份文件头）：
#   · 变异只做在一次性副本上，末了断原件 md5 逐字节未动；
#   · 每臂的期望是"自检输出里恰好出现 N 条 ❌ 且带指定期望串"—— 针是**失败串**，不是成功串；
#   · 内层 `unbound variable` 命中必须为 0（撞 set -u 把跑炸是装置坏，不是判据红）；
#   · 任一臂读数不对 ⇒ 保留副本与日志并把路径打在输出里（不许无条件 rm 掉证据）。
# 用法：bash research/tools/b-wedge-mutation-arms.sh
set -u

REPO="${REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO" || exit 1
LIB="scripts/lib/wedged-runner.sh"
[ -f "$LIB" ] || { echo "❌ 缺 $LIB" >&2; exit 1; }

ORIG_MD5=$(md5 -q "$LIB")
TMP=$(mktemp -d /tmp/b-wedge-arms.XXXXXX)
echo "载体：$TMP  原件 md5=${ORIG_MD5}"

BAD=0
LOGS=''

# arm <标签> <期望❌条数> <期望针(可空)>  —— 第三个参数起是 sed 表达式（按顺序作用于副本）
arm() {
  local label="$1" want_red="$2" needle="$3"; shift 3
  local cp="$TMP/$label.sh" out="$TMP/$label.out"
  cp "$LIB" "$cp" || { echo "❌ $label 建副本失败"; BAD=$((BAD + 1)); return; }
  local i
  for i in "$@"; do
    sed -E "$i" "$cp" > "$cp.tmp" && mv -f "$cp.tmp" "$cp" || { echo "❌ $label sed 失败：$i"; BAD=$((BAD + 1)); return; }
  done
  # 变异没落到字节上 = 这一臂什么都没测（静默假绿）
  if cmp -s "$cp" "$LIB"; then
    echo "❌ ${label}：变异后字节未变 ⇒ 锚点没命中，这一臂是空的"
    BAD=$((BAD + 1)); LOGS="$LOGS $out"; return
  fi
  bash "$cp" --self-check > "$out" 2>&1
  local rc=$?
  local n ub
  n=$(grep -c '^  ❌' "$out" 2>/dev/null || true); n=${n:-0}
  ub=$(grep -c 'unbound variable' "$out" 2>/dev/null || true); ub=${ub:-0}
  local ok=1 why=''
  [ "$n" = "$want_red" ] || { why="${why}❌条数=$n 期望=$want_red "; ok=0; }
  [ "$ub" = 0 ] || { why="${why}装置炸(unbound=$ub) "; ok=0; }
  if [ "$want_red" != 0 ] && [ "$rc" != 1 ]; then why="${why}退出码=$rc 期望=1 "; ok=0; fi
  if [ -n "$needle" ]; then
    grep -q -- "$needle" "$out" || { why="${why}缺针[$needle] "; ok=0; }
  fi
  if [ "$ok" = 1 ]; then
    printf '✅ %-34s %s 条 ❌（rc=%s）\n' "$label" "$n" "$rc"
  else
    printf '❌ %-34s %s\n' "$label" "$why"
    BAD=$((BAD + 1)); LOGS="$LOGS $out"
  fi
}

# 对照：未变异必须 0 条 ❌ 且 rc=0（否则下面所有臂的"红"都不构成读数）
bash "$LIB" --self-check > "$TMP/control.out" 2>&1
CTL=$?
CTL_N=$(grep -c '^  ❌' "$TMP/control.out" || true); CTL_N=${CTL_N:-0}
if [ "$CTL" = 0 ] && [ "$CTL_N" = 0 ]; then
  printf '✅ %-34s 0 条 ❌（rc=0，%s 条 ✅）\n' "对照(未变异)" "$(grep -c '^  ✅' "$TMP/control.out")"
else
  printf '❌ %-34s rc=%s ❌=%s ⇒ 基线就是坏的，后面的臂全部不可信\n' "对照(未变异)" "$CTL" "$CTL_N"
  BAD=$((BAD + 1)); LOGS="$LOGS $TMP/control.out"
fi

# ── 五臂的期望条数由判据真值表推出来。**第一版推导错了三处**，错因比读数值钱，留在下面：
#
# A（`-lt` → `-le`，龄到阈值就落进 fresh）⇒ **3 条**。
#    失效格 = 三条"龄恰好 == 阈值"的（`龄==阈值`、`CPU==阈值`、`CPU==阈值+1` 三臂的龄都是 3600）。
#    ✗ 第一版推成 1：只数了名字里带"阈值"那一条，忘了另外两条边界臂**也把龄写成 3600**。
#
# B（解析失败回 `0` 而不是空串）⇒ **3 条**。
#    文件里 `[ -n "$s" ] || { printf ''; return; }` 有两枚（入口 / 去小数秒后），sed 逐行都命中
#    ⇒ `''` 与 `'1-'` 两条期望失效；**第三条是意外收获**：`不存在的 pid 竟然有叶子`。
#    ⇒ 原来"解析失败不许当 0"不只服务那两条针，它还有一枚**消费者** `ht_wedge_leaf`：
#      叶子判据靠"取不到 ⇒ 空"来拒绝给死进程编读数；一旦空串变 0，`0 > -1` 就成立 ⇒ 编出来了。
#    ✗ 第一版推成 2（后来又推成 4）：只顺着"哪几条针的字面变了"想，没问"这条性质谁在吃"。
#
# C（把 bash 3.2 那处拆行改回一行 ⇒ 叶子取不到）⇒ **4 条**（两层夹具 + 端到端判定 +
#    管道夹具 + 只有消费者那两条；`report` 那一臂允许打"不宣布"档，不算失效）。
#    ✗ 这条期望**随判据一起漂过**：12:4x 给比较器加两条腿之后它从 2 变 4 ——
#      那两条新腿都是"取不到叶子就算红"，正是这条变异该有的暴露面。臂的期望值不是常量，
#      它是"这次变异能打死几条断言"的函数，加断言就要重推一遍（这里推的是失效格，抄输出不算推）。
#
# D（CPU `-le` → `-ge`）⇒ **4 条**：`(19929,0)`→busy、`(19929,60)`→wedged、
#    `(3600,0)`→busy、`(3600,3)`→wedged 全翻；只有 `(3600,2)` 两版都判 wedged 所以不红。
#    ✗ 第一版推成 2：漏了"龄远离阈值"那两格同样吃这条方向。
#
# E（**两枚** case 的 unknown 一起降级成 fresh）⇒ **3 条**（取不到 etime / 取不到 CPU /
#    CPU 含非数字）。锚点故意选跨两行的短式：它一次改掉 `$e` 与 `$c` 两枚 case，
#    测的是"算不出就不宣布"这条承诺被整体摘掉，不是某一枚写错。
arm A-thr-le 3 "龄 == 阈值" 's/if \[ "\$e" -lt "\$WEDGE_AGE_S" \]/if [ "$e" -le "$WEDGE_AGE_S" ]/'
arm B-bad-as-zero 3 "不存在的 pid" "s/^  \[ -n \"\\\$s\" \] \|\| \{ printf ''; return; \}/  [ -n \"\$s\" ] || { printf '0'; return; }/"
arm C-local-one-line 4 "两层夹具" \
  's/^  local root="\$1"$/  local root="$1" frontier="$root"/' \
  's/^  local frontier="\$root" p k kids es i=0$/  local p k kids es i=0/'
arm D-cpu-ge 4 "5.5h 龄" 's/elif \[ "\$c" -le "\$WEDGE_CPU_S" \]/elif [ "$c" -ge "$WEDGE_CPU_S" ]/'
arm E-unknown-as-fresh 3 "取不到 etime" "s/printf 'unknown'; return/printf 'fresh'; return/"
# ── G/H：12:4x 那处"同层兄弟点名会翻脸"的比较器，两级各一条臂 ──
# G（摘掉"非消费者优先"那一级 ⇒ 退回纯按龄、同龄按 pgrep 返回序）⇒ **2 条**：
#    管道夹具（真现场那条形状：`notarytool … | tail -8 | awk` 三枚同龄，旧实现点名 tail）
#    + 比较器纯函数腿（③④ 两格翻转 ⇒ 期望串 0101 变 0110）。
#    ⚠️ 只有纯函数腿能打死"把消费者整枚剔除"那种写反 —— 真进程腿测的是优先级，
#      剔除那种写法会让两条真进程腿一条红一条"没有叶子"，也算暴露，但归因不如串清晰。
arm G-no-filter-class 2 "管道夹具" \
  's/^  if \[ "\$f" != "\$best_f" \]; then \[ "\$f" = 0 \] && return 0; return 1; fi$/  : # 消费者那一级的优先被摘掉/'
# H（摘掉第三级 pid tie-break）⇒ **1 条**（只有比较器纯函数腿的 r1 格会红）。
#    真进程那两条腿**打不死它**：`pgrep -P` 本来就按升序返回，现场永远"先来者=小 pid"，
#    于是这一级在真进程上是隐形的 —— 这正是纯函数腿存在的理由（臂能覆盖到隐形那一格）。
arm H-no-pid-tier 1 "比较器" \
  's/^  \[ "\$p" -lt "\$best_p" \] && return 0$/  return 1/'

# ── F：source 守卫（这一臂不是"改判据"，是改"入口偷宿主参数"那处修复）──
# 🔴 现场成因：第一版文件底直接写 `case "${1:-}"`，被 source 时 `$1` 是**宿主**的参数
#    ⇒ `b-reinstall-readiness.sh --selftest` 被 lib 截走、打完 lib 自己那批（当时 26 条）就 `exit 0`，
#    宿主自己的四臂自检**一条没跑还报绿**。这是本装置本轮最贵的一处缺陷，必须有臂挡着。
# 姿势：造一枚最小宿主（source 本 lib 后必须走到 echo PROBE_REACHED）。
mk_host() { printf '#!/bin/bash\nset -u\n. "%s"\necho PROBE_REACHED\n' "$1" > "$2"; chmod +x "$2"; }
F_HOST="$TMP/host-real.sh"; F_HOSTMUT="$TMP/host-mut.sh"
mk_host "$REPO/$LIB" "$F_HOST"
bash "$F_HOST" --selftest > "$TMP/F1.out" 2>&1
F1_RC=$?
if grep -q PROBE_REACHED "$TMP/F1.out" && [ "$F1_RC" = 0 ]; then
  printf '✅ %-34s 宿主走到了一行自己的语句（rc=%s）\n' "F1 source 守卫(未变异)" "$F1_RC"
else
  printf '❌ %-34s 宿主被 lib 截走：rc=%s 输出末行 [%s]\n' "F1 source 守卫(未变异)" "$F1_RC" "$(tail -1 "$TMP/F1.out")"
  BAD=$((BAD + 1)); LOGS="$LOGS $TMP/F1.out"
fi
# F2：摘掉守卫的副本 ⇒ 同一姿势下 PROBE_REACHED **必须不出现**（出现就说明这臂没牙）
CP2="$TMP/F2-lib.sh"
cp "$LIB" "$CP2"
sed -E 's/^if \[ "\$\{BASH_SOURCE\[0\]:-\}" = "\$0" \]; then$/if [ 1 = 1 ]; then/' "$CP2" > "$CP2.t" && mv -f "$CP2.t" "$CP2"
if cmp -s "$CP2" "$LIB"; then
  printf '❌ %-34s 变异后字节未变 ⇒ 锚点没命中，这一臂是空的\n' "F2 摘掉守卫"
  BAD=$((BAD + 1))
else
  mk_host "$CP2" "$F_HOSTMUT"
  bash "$F_HOSTMUT" --selftest > "$TMP/F2.out" 2>&1
  if grep -q PROBE_REACHED "$TMP/F2.out"; then
    printf '❌ %-34s 摘了守卫宿主还是走到了 ⇒ 这臂没有牙（守卫其实是多余的？）\n' "F2 摘掉守卫"
    BAD=$((BAD + 1)); LOGS="$LOGS $TMP/F2.out"
  elif grep -q '两层夹具' "$TMP/F2.out"; then
    printf '✅ %-34s 宿主被截走（读到的是 lib 自己的自检），正是第一版的真症状\n' "F2 摘掉守卫"
  else
    printf '❌ %-34s 宿主既没走到自己、也没打出 lib 自检 ⇒ 中间还有第三种失败\n' "F2 摘掉守卫"
    BAD=$((BAD + 1)); LOGS="$LOGS $TMP/F2.out"
  fi
fi

echo
MD5_NOW=$(md5 -q "$LIB")
if [ "$MD5_NOW" = "$ORIG_MD5" ]; then
  echo "✅ 原件逐字节未动（md5 ${MD5_NOW}）"
else
  echo "❌ 原件被改了！${ORIG_MD5} → ${MD5_NOW}"
  BAD=$((BAD + 1))
fi

if [ "$BAD" != 0 ]; then
  echo "有 $BAD 臂读数不对 ⇒ 保留副本与日志：$LOGS"
  exit 1
fi
echo "十条读数都成立（对照 + A–E 五条判据变异臂 + G/H 两条比较器臂 + F1/F2 那对 source 守卫臂：阈值边界、解析失败不许当 0、bash 3.2 那行赋值、CPU 方向、unknown 不许降级、同层兄弟点名确定（消费者优先 / pid tie-break 各一级）、入口不许偷宿主参数）"
rm -rf "$TMP"
exit 0
