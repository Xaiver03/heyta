#!/bin/bash
# 取住本机测试锁（`/tmp/tfa-test.lock`）再跑被包的命令，退出时放锁。
#
# 用法（仓库根）：bash research/tools/hold-test-lock.sh <输出日志> -- <命令...>
#   例：bash research/tools/hold-test-lock.sh /tmp/chain.log -- pnpm check
#
# 🔴 为什么还要再写一枚：`research/tools/with-test-lock.sh` 的名字里有 lock，但它只做
#    **等**（循环到锁空就 break，然后 `"$@"`），**从不写自己的 pid**。所以用它包一条
#    27 分钟的长链，链跑起来之后锁是空的 —— 别人照旧规则看"锁空"就会同时开跑，
#    两边互相把对方的读数污染成红，而两边都以为自己独占。那枚脚本对它自己做的事
#    没有说错（它只承诺等），错的是把"等过了"当成"占住了"。这一枚补的是**占**这一半。
# 约定与既有各 rig 逐字相同：锁文件首行 = 持有者 pid，pid 活着 = 持有；陈旧锁（pid 已不在）
#    判给新来者，但**绝不动它、绝不 kill 任何东西**。
# 等不到（默认 900s）⇒ 响亮 rc=3 = "没跑成"，与"跑出来是红的"是两个态，不许互相顶替。
set -u
LOCK=/tmp/tfa-test.lock
BUDGET="${HEYTA_LOCK_BUDGET:-900}"   # 秒

# 首行 pid 活着 → 打印它；不存在/陈旧/内容不像 pid → 什么都不打印（= 无人持有）。
lock_holder() {
  [ -f "$LOCK" ] || return 0
  local first
  first=$(head -n1 "$LOCK" 2>/dev/null | tr -d '[:space:]')
  case "$first" in
    ''|*[!0-9]*) return 0 ;;
    0|1) return 0 ;;
  esac
  # `kill -0` 对**别人的**活进程会回 EPERM 而不是 0，所以还要问一次 ps；
  # 两把尺都说"不在"才敢判陈旧 —— 判错的代价是把别人的锁抢走。
  if kill -0 "$first" 2>/dev/null || ps -p "$first" >/dev/null 2>&1; then
    printf '%s' "$first"
  fi
  return 0
}

if [ "${1:-}" = "--self-test" ]; then
  # 🔴 自测会往 `/tmp/tfa-test.lock` 写东西，所以**别人持锁时一律不许开自测**：
  #    没有这条守卫，臂 A 那句 `rm -f "$LOCK"` 会把别人正占着的锁删掉，
  #    于是第三个会话以为锁空就开跑 —— 一个自测装置反过来制造了它要防的那种撞车。
  HELD=$(lock_holder)
  if [ -n "$HELD" ]; then
    echo "SELF_TEST=REFUSED reason=测试锁正被 pid=${HELD} 持有（自测要动这把锁，不绕）"
    exit 3
  fi
  SDIR=$(mktemp -d); trap 'rm -rf "$SDIR"' EXIT
  PASS=0; FAIL=0
  # 臂 A：锁空 ⇒ 取到、内部命令跑了、退出后锁被自己清掉
  rm -f "$LOCK"
  bash "$0" "$SDIR/a.out" -- true > "$SDIR/a.log" 2>&1; rcA=$?
  { [ "$rcA" = 0 ] && grep -q 'INNER_RC=0' "$SDIR/a.out" && [ ! -e "$LOCK" ]; } && aA=OK || aA=BAD
  # 臂 B：别人（我 spawn 的一枚 sleep）持锁 ⇒ 拒绝，且**不覆盖锁、不跑内部命令**
  sleep 60 & FAKE=$!
  echo "$FAKE" > "$LOCK"
  HEYTA_LOCK_BUDGET=6 bash "$0" "$SDIR/b.out" -- false > "$SDIR/b.log" 2>&1; rcB=$?
  holderStill=$(head -n1 "$LOCK" 2>/dev/null || echo NONE)
  grep -q 'INNER_RC' "$SDIR/b.out" 2>/dev/null && ranB=YES || ranB=NO
  kill "$FAKE" 2>/dev/null; wait "$FAKE" 2>/dev/null
  { [ "$rcB" = 3 ] && [ "$holderStill" = "$FAKE" ] && [ "$ranB" = NO ]; } && aB=OK || aB=BAD
  # 臂 C：陈旧锁（pid 已不在）⇒ 判给新来者，并**当场印出 LOCK_STALE**（不许静默覆盖）
  STALE=999999
  while kill -0 "$STALE" 2>/dev/null || ps -p "$STALE" >/dev/null 2>&1; do STALE=$((STALE + 1)); done
  echo "$STALE" > "$LOCK"
  bash "$0" "$SDIR/c.out" -- true > "$SDIR/c.log" 2>&1; rcC=$?
  { [ "$rcC" = 0 ] && grep -q 'LOCK_STALE' "$SDIR/c.log"; } && aC=OK || aC=BAD
  cur=$(head -n1 "$LOCK" 2>/dev/null | tr -d '[:space:]')
  [ "$cur" = "$$" ] && rm -f "$LOCK"
  for a in A B C; do
    eval "v=\$a$a"; echo "ARM$a=$v"
    [ "$v" = OK ] && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))
  done
  echo "SELF_TEST pass=$PASS fail=$FAIL rcA=$rcA rcB=$rcB rcC=$rcC"
  [ "$FAIL" = 0 ] || exit 1
  exit 0
fi

LOG="${1:?用法: hold-test-lock.sh <日志> -- <命令...>（或 --self-test）}"
shift
[ "${1:-}" = "--" ] && shift
mkdir -p "$(dirname "$LOG")"; : > "$LOG"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }

waited=0
while : ; do
  HOLDER=$(lock_holder)
  if [ -z "$HOLDER" ]; then
    [ -e "$LOCK" ] && say "LOCK_STALE pid=$(head -n1 "$LOCK" 2>/dev/null)（进程已不在，判给本会话；本脚本不动它）"
    say "LOCK_FREE_after=${waited}s"
    break
  fi
  [ "$waited" = 0 ] && say "LOCK_HELD pid=${HOLDER} who=$(ps -o command= -p "$HOLDER" 2>/dev/null | cut -c1-140)"
  if [ "$waited" -ge "$BUDGET" ]; then
    say "LOCK_BUSY_BUDGET=${BUDGET}s holder=${HOLDER}"
    say "  —— **没跑成**，不是判据红。这条读数不许记进任何一单的判据。"
    exit 3
  fi
  sleep 5; waited=$((waited + 5))
done

echo "$$" > "$LOCK"
HELD_BY=$(head -n1 "$LOCK" 2>/dev/null | tr -d '[:space:]')
if [ "$HELD_BY" != "$$" ]; then
  say "LOCK_TAKE_FAILED 写进去的是 ${HELD_BY:-空}，不是本会话 $$"
  exit 4
fi
say "LOCK_TAKEN pid=$$ held_by_me=YES"
# 放锁只放**自己那一枚**：中途若被别人的 rig 改写了，不许替它清。
cleanup() {
  cur=$(head -n1 "$LOCK" 2>/dev/null | tr -d '[:space:]')
  [ "$cur" = "$$" ] && rm -f "$LOCK"
  return 0
}
trap cleanup EXIT INT TERM

"$@" >> "$LOG" 2>&1
rc=$?
say "INNER_RC=$rc"
exit "$rc"
