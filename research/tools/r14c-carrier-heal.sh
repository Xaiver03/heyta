#!/usr/bin/env bash
# 载体（detached worktree）在开窗那一刻**不许带未提交内容** ——
# `git checkout --detach <目标提交>` 对"未提交且两提交之间会变"的文件是直接拒（06:53 实跑 rc=1）。
# 而被拒的代价不是报错，是**看守 exit 5、设备面整趟白等**（本线 06:5x 现场就是靠手工收拾过去的）。
# 这一条把手工那一步变成有界机制。
#
# 🔴 承重判据只有一条，而且它是**可证的**：一枚脏文件的工作树字节 **逐字等于目标提交里那个 blob**
#    ⇒ 这份"未提交"里没有一分独占信息（git 随时能再生它），所以 `git checkout --` 不会毁任何东西。
#    对不上就拒。这不是"看起来危险就不动"，是**按信息量判**：
#    实测过一形"内容恰好等于目标版本也照样被拒"，所以判据必须是字节相等，不是"改过就得保"。
#
# 另外三条护栏（各自都测过腿，见 --selftest）：
#   ① 脏在产品代码（packages/ apps/ server/）里 ⇒ 一律拒，不静默自愈产品代码；
#   ② 脏行数 > MAX（默认 12）⇒ 拒（"整棵树都脏"不是本装置该收拾的形状）；
#   ③ 动手前先把原件字节备份到 /tmp 并核 md5 —— 备份失败就不动那一枚。
#
# 退出码：0 = 本来就干净，或 --confirm 下自愈成功（载体脏行数归 0）
#         1 = 用法错（参数不认识 / 没给 CARRIER、TARGET）
#         3 = **拒绝自愈**（有独占信息 / 落在产品代码 / 超上限）—— 环境不成立，不是产品失败
#         4 = 装置坏（CARRIER 不是 git 工作树、TARGET 解析不到、备份核不上）
#
# 用法：
#   CARRIER=<载体> TARGET=<目标提交> bash research/tools/r14c-carrier-heal.sh            # 干跑，只报能不能
#   CARRIER=… TARGET=… bash research/tools/r14c-carrier-heal.sh --confirm                 # 真动
#   bash research/tools/r14c-carrier-heal.sh --selftest                                   # 四臂
set -u

CONFIRM=0
SELFTEST=0
for a in "$@"; do
  case "$a" in
    --confirm) CONFIRM=1 ;;
    --selftest) SELFTEST=1 ;;
    -h|--help) sed -n '1,40p' "$0"; exit 0 ;;
    *) echo "❌ 未知参数：${a}（只认 --confirm / --selftest / --help）" >&2; exit 1 ;;
  esac
done

CARRIER="${CARRIER:-}"
TARGET="${TARGET:-}"
MAX="${MAX:-12}"
PROTECT_RE='^(packages|apps|server)/'

if [ "$SELFTEST" = 1 ]; then
  # ── 四臂：全部在**临时 worktree** 上跑，绝不碰本线那块真载体 ──
  MAIN="${MAIN:-/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta}"
  cd "$MAIN" || { echo "❌ 装置坏：进不去主检出 $MAIN" >&2; exit 4; }
  NEW=$(git rev-parse HEAD)
  # 夹具要的是**两枚"区间内变过"的文件**：一枚非产品的（臂 1/2/4 用）、一枚产品代码的（臂 3 用）。
  # 第一版把区间写死 HEAD~3，结果区间里没有产品代码文件 ⇒ 臂 3 只能"跳过"，
  # 而跳过的原因其实是我挑的区间太小 —— 区间是夹具参数，不是被测事实，要按需要放大。
  OLD=''; F=''; PF=''
  for back in 3 12 25 60 120 240; do
    cand=$(git rev-parse "HEAD~${back}" 2>/dev/null) || continue
    nf=$(git diff --name-only "$cand" "$NEW" | grep -E '^(scripts|research|docs)/' | head -1)
    pf=$(git diff --name-only "$cand" "$NEW" | grep -E '^(packages|apps|server)/' | head -1)
    if [ -n "$nf" ] && [ -n "$pf" ]; then OLD="$cand"; F="$nf"; PF="$pf"; break; fi
  done
  { [ -n "$OLD" ] && [ -n "$F" ] && [ -n "$PF" ]; } \
    || { echo "❌ 装置坏：找不到同时含产品与非产品变更的提交区间，四臂无从可测" >&2; exit 4; }
  TMPWT=$(mktemp -d /tmp/heyta-heal-selftest.XXXXXX)
  git worktree add --detach "$TMPWT" "$OLD" >/dev/null 2>&1 \
    || { echo "❌ 装置坏：临时 worktree 建不起来" >&2; exit 4; }
  A=0; B=0; C=0; D=0
  echo "== 臂 1：脏成「目标提交那一版」（零独占信息）⇒ 干跑必须判可自愈，--confirm 必须真归零 =="
  git -C "$MAIN" show "$NEW:$F" > "$TMPWT/$F"
  # 干跑那一趟只该**报可自愈并且一个字都不动**（rc=3 = 还没 --confirm），
  # 承重读数在下一句：动前必须仍脏 1 枚。
  CARRIER="$TMPWT" TARGET="$NEW" bash "$0" >/tmp/heal-a1-dry.out 2>&1
  RC1DRY=$?
  printf '%s\n' "$(cat /tmp/heal-a1-dry.out)" | sed 's/^/   /'
  DRYBAD=0
  if [ "$RC1DRY" != "3" ] || ! grep -q '可自愈' /tmp/heal-a1-dry.out; then
    echo "   ❌ 干跑应当 rc=3 并报可自愈，实得 rc=${RC1DRY}"; DRYBAD=1
  fi
  N1=$(git -C "$TMPWT" status --porcelain | wc -l | tr -d ' ')
  CARRIER="$TMPWT" TARGET="$NEW" bash "$0" --confirm >/tmp/heal-a1.out 2>&1; RC1b=$?
  N1b=$(git -C "$TMPWT" status --porcelain | wc -l | tr -d ' ')
  if [ "$N1" = "1" ] && [ "$RC1b" = "0" ] && [ "$N1b" = "0" ] && [ "$DRYBAD" = "0" ]; then
    echo "   ✅ 臂 1：干跑 rc=3 且没动手、动前脏 1 枚、--confirm 后脏 0 枚（rc=${RC1b}）"; A=1
  else
    echo "   ❌ 臂 1：动前脏 ${N1}／--confirm rc=${RC1b} 后脏 ${N1b}"; cat /tmp/heal-a1.out | sed 's/^/      /'
  fi

  echo "== 臂 2：脏的是**独占内容**（任何提交里都没有）⇒ 必须拒，且一个字都不许动 =="
  printf '%s\n' '# 本会话新写的一行，不在任何提交里' >> "$TMPWT/$F"
  N2=$(git -C "$TMPWT" status --porcelain | wc -l | tr -d ' ')
  BEFORE=$(md5 -q "$TMPWT/$F")
  CARRIER="$TMPWT" TARGET="$NEW" bash "$0" --confirm >/tmp/heal-a2.out 2>&1; RC2=$?
  AFTER=$(md5 -q "$TMPWT/$F")
  if [ "$RC2" = "3" ] && [ "$BEFORE" = "$AFTER" ]; then
    echo "   ✅ 臂 2：rc=3 且那枚文件逐字节没被动过（拒绝是真拒绝）"; B=1
  else
    echo "   ❌ 臂 2：rc=${RC2}（要 3）/ 前后 md5 ${BEFORE:0:8}→${AFTER:0:8}"; cat /tmp/heal-a2.out | sed 's/^/      /'
  fi
  git -C "$TMPWT" checkout -- "$F" 2>/dev/null   # 复位，供臂 3 用

  echo "== 臂 3：脏在产品代码里 ⇒ 哪怕内容等于目标 blob 也一律拒 =="
  # 🔴 臂 3 不需要"两提交之间变过"的文件 —— 那条护栏是**按路径前缀**判的，
  #    所以随便拿一枚目标提交里存在的产品代码文件脏成它自己那一版就够测。
  #    第一版去 OLD/NEW 的差集里找，找不到就"跳过并记成功"，于是最后一行报的是
  #    "四臂全部成立"而实际只跑了三臂 —— 那是这条 rig 自己的假读数（本机同族第四次）。
  # PF 已由上面那个循环在同区间里选好（必须区间内变过，否则写进去也不会脏）
  if [ -z "$PF" ]; then
    echo "   ❌ 臂 3 无从可测：目标提交里找不到一枚产品代码文件（装置坏，不记成功）"
    C=0
  else
    git -C "$MAIN" show "$NEW:$PF" > "$TMPWT/$PF"
    CARRIER="$TMPWT" TARGET="$NEW" bash "$0" --confirm >/tmp/heal-a3.out 2>&1; RC3=$?
    STILL=$(git -C "$TMPWT" status --porcelain -- "$PF" | wc -l | tr -d ' ')
    if [ "$RC3" = "3" ] && [ "$STILL" = "1" ]; then
      echo "   ✅ 臂 3：产品代码那枚没被自愈（rc=3，仍脏 $STILL 枚；夹具=${PF}）"; C=1
    else
      echo "   ❌ 臂 3：rc=${RC3}（要 3）/ 该产品文件仍脏=${STILL}（要 1）"; cat /tmp/heal-a3.out | sed 's/^/      /'
    fi
    git -C "$TMPWT" checkout -- "$PF" 2>/dev/null
  fi

  echo "== 臂 4：超上限（MAX=0）⇒ 拒，不许批量顺手清 =="
  git -C "$MAIN" show "$NEW:$F" > "$TMPWT/$F"
  CARRIER="$TMPWT" TARGET="$NEW" MAX=0 bash "$0" --confirm >/tmp/heal-a4.out 2>&1; RC4=$?
  N4=$(git -C "$TMPWT" status --porcelain | wc -l | tr -d ' ')
  if [ "$RC4" = "3" ] && [ "$N4" = "1" ]; then
    echo "   ✅ 臂 4：MAX=0 时拒绝且没动（仍脏 $N4 枚）"; D=1
  else
    echo "   ❌ 臂 4：rc=${RC4}（要 3）/ 仍脏=${N4}（要 1）"
  fi

  git worktree remove --force "$TMPWT" >/dev/null 2>&1 || rm -rf "$TMPWT"
  rm -f /tmp/heal-a1.out /tmp/heal-a2.out /tmp/heal-a3.out /tmp/heal-a4.out
  # 汇总按**实测形状**报：每条臂各占一格，不写"全部成立"这种把跳过也算进去的话。
  echo "臂读数：1=${A}（零独占信息⇒可自愈并真归零）2=${B}（独占信息⇒拒且不动）3=${C}（产品代码⇒拒）4=${D}（超上限⇒拒）"
  if [ "$A" = 1 ] && [ "$B" = 1 ] && [ "$C" = 1 ] && [ "$D" = 1 ]; then
    echo "四臂各自成立（临时载体已删除，本线真载体一个字节没碰）"; exit 0
  fi
  exit 4
fi

[ -n "$CARRIER" ] || { echo "❌ 必须给 CARRIER=<载体工作树路径>（本装置不猜，避免误清别人的树）" >&2; exit 1; }
[ -n "$TARGET" ] || { echo "❌ 必须给 TARGET=<目标提交>（「逐字等于那一版」是唯一的放行依据）" >&2; exit 1; }
git -C "$CARRIER" rev-parse --git-dir >/dev/null 2>&1 \
  || { echo "❌ 装置坏：$CARRIER 不是 git 工作树" >&2; exit 4; }
git -C "$CARRIER" rev-parse --verify "$TARGET^{commit}" >/dev/null 2>&1 \
  || { echo "❌ 装置坏：TARGET=$TARGET 在载体里解析不到提交" >&2; exit 4; }

DIRTY=$(git -C "$CARRIER" status --porcelain | cut -c4- )
N=$(printf '%s\n' "$DIRTY" | grep -c '[^[:space:]]' || true); N=${N:-0}
RAW=$(git -C "$CARRIER" status --porcelain | wc -l | tr -d ' ')
# 🔴 解析数与原始行数必须相等，否则"0 枚脏"可能是解析坏了（本机 06:3x 刚因此把三台已启动
#    模拟器读成 0 台）。这一条不等就直接 exit 4，不许把"干净"当成现场事实。
if [ "$N" != "$RAW" ]; then
  echo "❌ 探针坏：解析出 $N 枚脏，而 status --porcelain 原始 $RAW 行 —— 不拿这个读数判" >&2
  exit 4
fi
if [ "$N" = "0" ]; then echo "✅ 载体本来就干净（0 枚未提交）：$CARRIER"; exit 0; fi
if [ "$N" -gt "$MAX" ]; then
  echo "❌ 拒绝：载体脏 ${N} 枚 > 上限 ${MAX} —— 这不是一块干净载体该有的形状，交给人看"
  printf '%s\n' "$DIRTY" | sed 's/^/      /' | head -20
  exit 3
fi

ELIGIBLE=1; WHY=''
while IFS= read -r p; do
  [ -n "$p" ] || continue
  case "$p" in
    /*|*..*) echo "❌ 拒绝：脏路径形状不认识（${p}）"; exit 3 ;;
  esac
  if printf '%s' "$p" | grep -qE "$PROTECT_RE"; then
    ELIGIBLE=0; WHY="落在产品代码：$p"
    echo "❌ 拒绝：$p 是产品代码 —— 本装置永不自愈产品代码"
    break
  fi
  if [ ! -f "$CARRIER/$p" ]; then
    ELIGIBLE=0; WHY="不是普通文件（删除/未跟踪目录等）：$p"
    echo "❌ 拒绝：${p} 在工作树里不是普通文件（这一形没有逐字节相等可对）"
    break
  fi
  WT=$(md5 -q "$CARRIER/$p")
  # 🔴 blob 侧的 md5 要用**同一个算法**算同一串字节：git show 输出即 blob 内容，
  #    但工作树文件若带/不带结尾换行差一个字节就差一整枚 —— 这正是"独占信息"的判据本体。
  TB=$(git -C "$CARRIER" show "$TARGET:$p" 2>/dev/null | md5 -q)
  if [ "$WT" != "$TB" ]; then
    ELIGIBLE=0; WHY="有独占信息：$p"
    echo "❌ 拒绝：$p 的工作树字节 ≠ 目标提交那一版（md5 ${WT:0:8} vs ${TB:0:8}）—— 里面有只有这份树才有的内容"
    break
  fi
  echo "   零独占信息：${p}（md5 ${WT:0:8} 与 $TARGET 那一版逐字相同）"
done <<< "$DIRTY"

if [ "$ELIGIBLE" != "1" ]; then
  echo "结论：拒绝自愈（${WHY}）。exit 3 —— 交回看守，它会按原计划 exit 5 而不是硬清。"
  exit 3
fi

echo "✅ 全部 ${N} 枚都逐字等于目标提交那一版 ⇒ 可自愈（零独占信息损失）"
if [ "$CONFIRM" != "1" ]; then
  echo "== dry-run 结束（没动载体）。要执行加 --confirm；等价手工命令："
  echo "   git -C \"$CARRIER\" checkout -- $(printf '%s ' $DIRTY)"
  exit 3
fi

BAK=$(mktemp -d /tmp/ht-r14c-heal-bak.XXXXXX) || { echo "❌ 装置坏：备份目录建不起来" >&2; exit 4; }
while IFS= read -r p; do
  [ -n "$p" ] || continue
  mkdir -p "$BAK/$(dirname "$p")"
  cp "$CARRIER/$p" "$BAK/$p" || { echo "❌ 装置坏：备份失败 ${p}（不动这一枚）" >&2; exit 4; }
  A=$(md5 -q "$BAK/$p"); B=$(md5 -q "$CARRIER/$p")
  [ "$A" = "$B" ] || { echo "❌ 装置坏：备份与原件不一致 $p" >&2; exit 4; }
done <<< "$DIRTY"
RC=0
while IFS= read -r p; do
  [ -n "$p" ] || continue
  git -C "$CARRIER" checkout -- "$p" || RC=$?
done <<< "$DIRTY"
if [ "$RC" != "0" ]; then echo "❌ 装置坏：git checkout 回 ${RC}（备份留在 ${BAK}）" >&2; exit 4; fi
LEFT=$(git -C "$CARRIER" status --porcelain | wc -l | tr -d ' ')
if [ "$LEFT" != "0" ]; then
  echo "❌ 自愈没归零：还剩 ${LEFT} 枚脏（备份留在 ${BAK}）" >&2
  git -C "$CARRIER" status --porcelain | sed 's/^/      /' | head -10
  exit 4
fi
echo "✅ 自愈完成：$N 枚已回到载体自己的版本，脏行数归 0；原件备份留在 $BAK"
exit 0
