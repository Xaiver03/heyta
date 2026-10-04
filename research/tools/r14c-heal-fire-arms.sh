#!/bin/bash
# r14c-window-retry.sh 开窗那一段的臂（载体一律用一次性 worktree，链一律用桩）：
#   臂 5：载体脏的是**独占内容** ⇒ 自愈拒 ⇒ 看守必须 exit 5 且**一次都不碰链**（不打包、不动设备）
#   臂 6：载体脏的内容逐字等于目标提交那一版 ⇒ 自愈成 ⇒ 链被真调用（正向腿，挡"永远 exit 5"）
#   臂 7：闸门 rc=3 且 `REDS=apk` ⇒ 必须开窗（07:2x 那条自锁的正向腿：链自己会打产物）
#   臂 8：闸门 rc=3 且 `REDS=dev,apk` ⇒ 不许开窗（挡"apk-deferred 变成万能钥匙"）
#   臂 9：闸门 rc=3 但**没打 REDS 行** ⇒ exit 4（缺通道按装置坏处理，不当成"没有红"）
set -u
MAIN="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
cd "$MAIN" || exit 4
RETRY=research/tools/r14c-window-retry.sh
NEW=$(git rev-parse HEAD)
OLD=$(git rev-parse 'HEAD~2')
WT=$(mktemp -d /tmp/heyta-healfire.XXXXXX)
MARKER=/tmp/arm-healfire.chain-called
FAIL=0
say() { printf '%s\n' "$1"; }

# 挑一枚两提交之间变过的非产品文件当夹具
F=$(git diff --name-only "$OLD" "$NEW" | grep -E '^(scripts|research|docs)/' | head -1)
[ -n "$F" ] || { say "❌ 装置坏：找不到夹具文件"; exit 4; }
say "夹具文件=${F}"

mk_gates() { # 桩闸门：开窗（rc=0）
  printf '#!/bin/bash\necho "窗口开（桩）"\nexit 0\n' > "$1"; chmod +x "$1";
}
mk_gates_reds() { # 桩闸门：rc=3 并打指定 REDS 行（$2 传〈空〉表示**不打**那一行）
  if [ "${2:-}" = "NONE" ]; then
    printf '#!/bin/bash\necho "窗口没开（桩，故意不打 REDS 行）"\nexit 3\n' > "$1"
  else
    printf '#!/bin/bash\necho "窗口没开（桩）"\necho "REDS=%s"\nexit 3\n' "$2" > "$1"
  fi
  chmod +x "$1";
}
mk_chain() { # 桩链：被调用就留标记
  printf '#!/bin/bash\necho CALLED >> %s\nexit 0\n' "$MARKER" > "$1"; chmod +x "$1";
}

run_once() { # $1=桩闸门 $2=桩链 $3=载体 $4=日志
  env CARRIER="$3" MAIN="$MAIN" BUDGET=0 INTERVAL=1 LOG="$4" BOOT_WAIT=5 \
    SELF_GUARD=0 GATE="$1" CHAIN="$2" \
    bash "$RETRY" >/dev/null 2>&1
  echo $?
}

G=$(mktemp); C=$(mktemp); mk_gates "$G"; mk_chain "$C"
: > "$MARKER"
# 收尾要判的是"**我这枚临时 worktree 没漏**"，而 13 这种全仓数字本身没有判据力
# （别人也有 worktree）⇒ 先取基线，末了比"计数相等 且 临时那枚的路径不在清单里"。
WT_BEFORE=$(git worktree list | wc -l | tr -d ' ')

say "── 臂 5：脏成独占内容 ⇒ 必须拒并 exit 5，链一次都不起 ──"
git worktree add --detach "$WT" "$OLD" >/dev/null 2>&1 || { say "❌ 临时 worktree 建不起来"; exit 4; }
printf '%s\n' '# 只有这棵树里才有的一行（独占信息）' >> "$WT/$F"
N5=$(git -C "$WT" status --porcelain | wc -l | tr -d ' ')
L5=$(mktemp); RC5=$(run_once "$G" "$C" "$WT" "$L5")
CALLED5=$(grep -c CALLED "$MARKER" || true); CALLED5=${CALLED5:-0}
HIT5=$(grep -c 'FIRE=aborted' "$L5" || true); HIT5=${HIT5:-0}
if [ "$N5" = "1" ] && [ "$RC5" = "5" ] && [ "$HIT5" = "1" ] && [ "$CALLED5" = "0" ]; then
  say "  ✅ 臂 5：脏 ${N5} 枚 ⇒ rc=5、打了 FIRE=aborted、桩链调用 0 次"
else
  say "  ❌ 臂 5：脏=${N5} rc=${RC5}（要 5）FIRE=aborted 命中=${HIT5}（要 1）链调用=${CALLED5}（要 0）"
  sed 's/^/      /' "$L5" | tail -12; FAIL=1
fi
git -C "$WT" checkout -- "$F" 2>/dev/null

say "── 臂 6：脏的内容恰好等于目标提交那一版 ⇒ 自愈成、链被真调用 ──"
git -C "$MAIN" show "$NEW:$F" > "$WT/$F"
N6=$(git -C "$WT" status --porcelain | wc -l | tr -d ' ')
: > "$MARKER"
L6=$(mktemp); RC6=$(run_once "$G" "$C" "$WT" "$L6")
# 臂 6 里链是桩，跑完就 exit 0
CALLED6=$(grep -c CALLED "$MARKER" || true); CALLED6=${CALLED6:-0}
HEAL6=$(grep -c 'HEAL rc=0' "$L6" || true); HEAL6=${HEAL6:-0}
if [ "$N6" = "1" ] && [ "$RC6" = "0" ] && [ "$CALLED6" = "1" ] && [ "$HEAL6" = "1" ]; then
  say "  ✅ 臂 6：自愈 rc=0、载体归零后 checkout、桩链调用 1 次（正向腿成立）"
else
  say "  ❌ 臂 6：动前脏=${N6}（要 1）rc=${RC6}（要 0）链调用=${CALLED6}（要 1）HEAL rc=0 命中=${HEAL6}（要 1）"
  sed 's/^/      /' "$L6" | tail -14; FAIL=1
fi

# ── 臂 7/8/9：开窗判据第二版（07:2x 查出的那条自锁，两腿 + 一条防"旧判据"的腿）──
#   自锁形状：载体每 checkout 一次，它自己的源码 mtime 就刷成"现在"，而 APK 还是上一次打的
#   ⇒ 闸门恒回 `REDS=apk`；链只在 rc=0 时才起 ⇒ 看守永远开不了窗、也永远打不出那个 APK。
#   这一族和臂 5/6 那两条不同：不是"该不该动"，是**开窗条件把开窗动作自己造出来的红当成了别人的红**。
say "── 臂 7：rc=3 且只红 APK ⇒ 必须开窗（FIRE=apk-deferred + 链被真调用）──"
G7=$(mktemp); mk_gates_reds "$G7" apk
: > "$MARKER"
N7=$(git -C "$WT" status --porcelain | wc -l | tr -d ' ')
L7=$(mktemp); RC7=$(run_once "$G7" "$C" "$WT" "$L7")
CALLED7=$(grep -c CALLED "$MARKER" || true); CALLED7=${CALLED7:-0}
DEF7=$(grep -c 'FIRE=apk-deferred' "$L7" || true); DEF7=${DEF7:-0}
if [ "$RC7" = "0" ] && [ "$CALLED7" = "1" ] && [ "$DEF7" = "1" ]; then
  say "  ✅ 臂 7：动前脏=${N7}、rc=0、apk-deferred 打了 1 次、桩链调用 1 次（正向腿：只红 APK 能开窗）"
else
  say "  ❌ 臂 7：rc=${RC7}（要 0）链调用=${CALLED7}（要 1）apk-deferred 命中=${DEF7}（要 1）动前脏=${N7}"
  sed 's/^/      /' "$L7" | tail -12; FAIL=1
fi

say "── 臂 8：rc=3 且红 dev,apk ⇒ 不许开窗（挡「把 apk 那一手当成万能钥匙」）──"
G8=$(mktemp); mk_gates_reds "$G8" 'dev,apk'
: > "$MARKER"
L8=$(mktemp); RC8=$(run_once "$G8" "$C" "$WT" "$L8")
CALLED8=$(grep -c CALLED "$MARKER" || true); CALLED8=${CALLED8:-0}
DEF8=$(grep -c 'FIRE=apk-deferred' "$L8" || true); DEF8=${DEF8:-0}
if [ "$RC8" = "3" ] && [ "$CALLED8" = "0" ] && [ "$DEF8" = "0" ]; then
  say "  ✅ 臂 8：rc=3（等满预算）、桩链调用 0 次、没打 apk-deferred（还红 dev 就不许动设备面）"
else
  say "  ❌ 臂 8：rc=${RC8}（要 3）链调用=${CALLED8}（要 0）apk-deferred 命中=${DEF8}（要 0）"
  sed 's/^/      /' "$L8" | tail -10; FAIL=1
fi

say "── 臂 9：rc=3 但闸门没打 REDS 行（旧版判据）⇒ exit 4，不猜开窗条件 ──"
G9=$(mktemp); mk_gates_reds "$G9" NONE
: > "$MARKER"
L9=$(mktemp); RC9=$(run_once "$G9" "$C" "$WT" "$L9")
CALLED9=$(grep -c CALLED "$MARKER" || true); CALLED9=${CALLED9:-0}
NR9=$(grep -c '闸门没打 REDS 行' "$L9" || true); NR9=${NR9:-0}
if [ "$RC9" = "4" ] && [ "$CALLED9" = "0" ] && [ "$NR9" = "1" ]; then
  say "  ✅ 臂 9：rc=4、打了「没打 REDS 行」那条、桩链调用 0 次（缺通道 = 装置坏，不当成「没有红」）"
else
  say "  ❌ 臂 9：rc=${RC9}（要 4）链调用=${CALLED9}（要 0）RedsMissing 命中=${NR9}（要 1）"
  sed 's/^/      /' "$L9" | tail -10; FAIL=1
fi
rm -f "$G7" "$G8" "$G9" "$L7" "$L8" "$L9"

git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
git worktree prune 2>/dev/null
rm -f "$G" "$C" "$MARKER" "$L5" "$L6"
WT_AFTER=$(git worktree list | wc -l | tr -d ' ')
LEAK=$(git worktree list | grep -c "$(basename "$WT")" || true); LEAK=${LEAK:-0}
if [ "$WT_AFTER" = "$WT_BEFORE" ] && [ "$LEAK" = "0" ]; then
  say "  ✅ 收尾：worktree 数回到基线 ${WT_BEFORE}，临时那枚已摘（全仓现量 ${WT_AFTER}）"
else
  say "  ❌ 收尾：基线 ${WT_BEFORE} → 现在 ${WT_AFTER}，清单里还找得到临时枚 ${LEAK} 次"; FAIL=1
fi
[ "$FAIL" = "0" ] || exit 4
say "臂 5–9 逐条读数见上面那五行（每行自己写明了期望值）；FAIL=${FAIL}"
exit 0
