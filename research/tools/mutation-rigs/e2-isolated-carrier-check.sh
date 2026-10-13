#!/bin/bash
# 批次 E 收尾格 ②：在**隔离载体**里对"主检出当前工作树"跑满 `pnpm check`（含三段 Playwright + 壳类门禁）。
#
# 为什么要载体：主检出被多条会话共写，直接在那里跑 = 读数不知道属于谁。
# 为什么要"整片未提交改动"而不是"我这批的文件"：只叠自己那几枚会造出一棵
# **谁都不有的树**（i18n 词条、mobile 界面与 apps/web 的在飞改动互相引用），
# 那种读数红在任何一格都没法归因。所以载体的定义写死为：
#   main HEAD + 主检出的**全部**未提交改动（跟踪脏 + 未跟踪非忽略，排除 node_modules）
# 红格归因留给读数那一步逐文件做，不在起跑前替别人决定。
#
# 用法：nohup bash tmp/e2-carrier-check.sh > /dev/null 2>&1 & disown
#      收口：cat ~/.heyta-evidence/<EV>/rc.txt   与   grep -E '^(CARRIER_SHA|SEGMENTS|CHECK_RC|QUEUE|REDS)' <LOG>
set -u

MAIN="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
CARRIER="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-tfa-e2"
TS=$(date +%m%d-%H%M%S)
EV="$HOME/.heyta-evidence/tfa-e2-carrier-$TS"
LOG="$MAIN/tmp/e2-carrier-check-$TS.log"
CAP_WAIT="${CAP_WAIT:-90}"        # 最多等 90 轮 × 40s = 60 分钟窗口
LOAD_MAX=12                       # 阈值取自仓库那道 scripts/lib/wait-for-quiet-host.sh，不是自造
mkdir -p "$EV"
say() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
exec >>"$LOG" 2>&1

say "══ 0. 载体与证据 ══"
say "MAIN_SHA=$(git -C "$MAIN" rev-parse HEAD)"
say "EV=$EV LOG=$LOG"

# ══ 1. 有界等窗口 ══
# 三个条件缺一不可：① 没有别人的 vitest（内存闸门锁的 pid 真活着）
# ② 三段 e2e 会 SIGKILL 的端口全空（4318/4319 由 check-ai-e2e 的 DEFAULT_PORTS 现读，
#    4320 是 landing、4322 是 privacy-consent；清单来源与 traps #87 同一件事）
# ③ 1min 负载 ≤ 阈值（这台机器常年被常驻 booted 模拟器顶着，等不到就如实报环境无效）
i=0
while [ "$i" -lt "$CAP_WAIT" ]; do
  LOCK_PID=$(cat /tmp/tfa-test.lock 2>/dev/null || true)
  if [ -n "${LOCK_PID:-}" ] && ps -p "$LOCK_PID" >/dev/null 2>&1; then
    say "窗口被占：别人的 vitest pid=${LOCK_PID}，继续等"
    sleep 40; i=$((i+1)); continue
  fi
  BUSY=''
  for p in 4318 4319 4320 4322; do
    [ "$(lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | grep -c LISTEN)" -gt 0 ] && BUSY="$BUSY $p"
  done
  [ -n "$BUSY" ] && { say "端口被占：${BUSY}（那些 e2e 前置会 SIGKILL 它们），继续等"; sleep 40; i=$((i+1)); continue; }
  RUNNER=$(ps Axo command | grep -E 'verify-mobile|reinstall-all|\.sh\.snap' | grep -vc grep || true)
  [ "${RUNNER:-0}" -gt 0 ] && { say "有验收/重装在跑（$RUNNER 条），继续等"; sleep 40; i=$((i+1)); continue; }
  # `{ 82.31 76.22 71.48 }` 的三个数分别是 1/5/15 min；只取第一个（1 min）。
  # 用 tr 去掉花括号会把三个数粘成一串（上一版就是这么坏的：印出 `166.30123.3291.63`）。
  LOAD=$(sysctl -n vm.loadavg | awk '{print $2}')
  # awk 比较而不是 [ ] 小数比较：bash 的整数测试会吞小数
  if awk -v l="$LOAD" -v m="$LOAD_MAX" 'BEGIN{exit !(l<=m)}'; then
    say "窗口开：load=$LOAD"
    break
  fi
  say "负载 $LOAD > ${LOAD_MAX}，继续等"
  sleep 40; i=$((i+1))
done
if [ "$i" -ge "$CAP_WAIT" ]; then
  say "QUEUE=EXPIRED reason=窗口没在 ${CAP_WAIT} 轮内开（环境无效，不是产品失败）"
  echo "QUEUE=EXPIRED" > "$EV/rc.txt"
  exit 3
fi
echo "QUEUE=OPEN" > "$EV/rc.txt"

# ══ 2. 建载体：HEAD 的干净树 + 主检出的全部未提交改动 ══
say "══ 1. 建载体 $CARRIER ══"
if [ ! -d "$CARRIER" ]; then
  git -C "$MAIN" worktree add --detach "$CARRIER" HEAD || { say "CARRIER=ADD-FAILED"; exit 4; }
else
  say "载体已存在，复用它（不删：里面有上一次的 node_modules）"
fi
git -C "$CARRIER" checkout --detach HEAD 2>/dev/null || true
git -C "$CARRIER" reset --hard HEAD >/dev/null 2>&1 || true
say "CARRIER_SHA=$(git -C "$CARRIER" rev-parse HEAD)"

# 未提交集合：跟踪脏 + 未跟踪非忽略，显式排除 node_modules（traps #196：带尾斜杠的
# `node_modules/` 只匹配目录，软链挡不住 ⇒ 不排就会把一堆指向主检出的软链当未跟踪送出去）
say "══ 2. 叠未提交改动 ══"
cd "$MAIN" || exit 1
git ls-files -m > "$EV/dirty-tracked.txt"
git ls-files -co --exclude-standard | grep -v 'node_modules/' > "$EV/untracked.txt"
OVERLAY="$EV/overlay.txt"
# `-m` 会把"工作树里已删除"也算进来，那种路径 tar 打不开（整包直接失败）⇒ 只留真存在的
cat "$EV/dirty-tracked.txt" "$EV/untracked.txt" | grep -v 'node_modules/' | sort -u | while read -r f; do
  [ -f "$MAIN/$f" ] && printf '%s\n' "$f"
done > "$OVERLAY"
N=$(wc -l < "$OVERLAY" | tr -d ' ')
say "OVERLAY_FILES=${N}（跟踪脏 $(wc -l < "$EV/dirty-tracked.txt" | tr -d ' ') / 未跟踪非忽略 $(wc -l < "$EV/untracked.txt" | tr -d ' ')）"
# tar 从主检出解到载体：整包一次搬，别用循环（循环里一条 cp 失败会被后面的盖住）
tar cf - -T "$OVERLAY" | tar xf - -C "$CARRIER" || { say "OVERLAY=TAR-FAILED"; exit 5; }
# 内容对账：随机抽 8 枚比 md5（AGENTS §7 第 82 条：送到另一棵树的字节必须对账，不能只看退出码）
MISM=0
for f in $(shuf -n 8 "$OVERLAY" 2>/dev/null || head -8 "$OVERLAY"); do
  [ -f "$CARRIER/$f" ] || { say "载体里缺 $f"; MISM=$((MISM+1)); continue; }
  a=$(md5 -q "$MAIN/$f"); b=$(md5 -q "$CARRIER/$f")
  [ "$a" != "$b" ] && { say "md5 不一致：$f"; MISM=$((MISM+1)); }
done
say "OVERLAY_MISMATCH=$MISM"
[ "$MISM" -gt 0 ] && { say "OVERLAY=DIRTY-COPY（不带着脏副本跑 check）"; exit 6; }

# ══ 3. 装依赖 + 构建 + 跑满 check ══
export PATH="/opt/homebrew/bin:$PATH" NO_COLOR=1 FORCE_COLOR=0
say "══ 3. pnpm install ══"
cd "$CARRIER" || exit 1
pnpm install --frozen-lockfile > "$EV/install.log" 2>&1
say "INSTALL_RC=$?"
# 软链必须指向载体自己那棵树（判断方法来自本仓实测：realpath 比前缀，不是数软链条数）
LINK=$(realpath "apps/web/node_modules/@heyta/domain" 2>/dev/null || echo none)
say "DOMAIN_LINK=$LINK in-carrier=$(case $LINK in *heyta-wt-tfa-e2*) echo yes;; *) echo no;; esac)"
say "══ 4. pnpm -r build ══"
pnpm -r build > "$EV/build.log" 2>&1
say "BUILD_RC=$?"
SEGMENTS=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("package.json","utf8")).scripts.check.split(" && ").length)')
say "SEGMENTS=${SEGMENTS}（分母现量，不是抄来的段数）"
say "══ 5. pnpm check 跑满 ══"
# 🔴 占住**同一枚**内存闸门锁：载体的 vitest 不走 `.tfa-shield`，不登记就会与别会话的套件并发跑，
# 而这台 64G 的机器被常驻模拟器 + 本仓 e2e 一起吃干（那是有实测死亡读数的）。按协议占锁、退出时只删自己那枚。
ME=$$
touch /tmp/tfa-test.lock 2>/dev/null && printf '%s' "$ME" > /tmp/tfa-test.lock
trap '[ "$(cat /tmp/tfa-test.lock 2>/dev/null)" = "$ME" ] && rm -f /tmp/tfa-test.lock' EXIT
say "LOCK_HELD_BY_ME=$(cat /tmp/tfa-test.lock)"
pnpm check > "$EV/check.log" 2>&1
RC=$?
say "CHECK_RC=$RC"
grep -E '^\s+(×|✗|FAIL)' "$EV/check.log" | head -40 > "$EV/red-candidates.txt"
say "RED_LINES=$(wc -l < "$EV/red-candidates.txt" | tr -d ' ')"
say "══ 6. 载体收尾（不删；留着复跑与逐格归因）══"
say "CARRIER_DIRTY_TRACKED=$(git -C "$CARRIER" diff --name-only | wc -l | tr -d ' ')"
say "DONE ts=$TS carrier=$CARRIER ev=$EV log=$LOG"
echo "CHECK_RC=$RC" >> "$EV/rc.txt"
