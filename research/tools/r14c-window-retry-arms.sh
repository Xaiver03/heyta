#!/bin/bash
# r14c-window-retry.sh 第二版的四臂自测（含"开窗那一趟真的会先同步载体"这条性质）。
# 🔴 第四臂的同步用一枚一次性迷你 git 仓库当"载体"，真实载体全程不动；MAIN 也指它，
#    否则装置会去 checkout 一个不在迷你仓库对象库里的真实 SHA。
set -u
# 自定位：本装置住在 research/tools/，仓库根就是它的 ../..（同仓内其它 rig 的形状）。
MAIN=$(cd "$(dirname "$0")/../.." && pwd)
RIG="$MAIN/research/tools/r14c-window-retry.sh"
D=/tmp/ht-rigtest
rm -rf "$D"; mkdir -p "$D"

# 🔴 整套臂一律把"稳定软链"改到夹具目录里（本轮真的差点把真 rig 的日志指针挪走：
#    臂走的是同一个默认名，而两份文件格式一模一样，读的人分辨不出）。
#    这条是"臂不许拥有生产路径"的那半边；另外半边在下面第 9 臂 —— 装置本身在显式传 LOG 时
#    根本不该碰稳定名，那一臂用夹具内的 STABLE_LOG 来判，因此不会被这半边掩盖。
export STABLE_LOG="$D/stable"
STABLE_REAL=/tmp/ht-r14c-window.log
STABLE_BEFORE=$(readlink "$STABLE_REAL" 2>/dev/null || echo "<none>")

# 🔴 07:5x：闸门 07:2x 起在结论处打一行机器可读的 `REDS=<红集>`（load/src/dev/cred/apk 的子集），
#   而装置把"rc=3 却没有这一行"按**旧版判据/装置坏**处理（exit 4，不猜开窗条件）。
#   所以桩默认必须打这一行；`STUB_REDS_NONE=1` 专门用来测"缺通道"那一臂（臂 10）。
cat > "$D/gate" <<'EOF'
#!/bin/bash
echo "STUB_GATE args=$*"
if [ "${STUB_REDS_NONE:-0}" != 1 ]; then echo "REDS=${STUB_REDS-load}"; fi
exit "${STUB_RC:-3}"
EOF
chmod +x "$D/gate"

cat > "$D/chain" <<'EOF'
#!/bin/bash
echo "STUB_CHAIN_RAN carrier=$CARRIER"
exit "${STUB_CHAIN_RC:-0}"
EOF
chmod +x "$D/chain"

# 迷你"载体"：v1 -> 分支上 v2，然后 detached 停在 v1（模拟载体落后于主检出）
FAKE=$D/fake-carrier
mkdir -p "$FAKE/scripts" "$FAKE/research/tools"
git -C "$FAKE" init -q
git -C "$FAKE" config user.email t@t; git -C "$FAKE" config user.name t
# 🔴 07:5x 补第三枚：装置在进窗口循环**之前**会检查 GATE/CHAIN/HEAL 三份文件都在
#   （HEAL 是本线开窗后"载体有界自愈"那一手，默认取 $MAIN/research/tools/r14c-carrier-heal.sh）。
#   迷你仓库里没有它 ⇒ 六条臂全变成 exit 4「载体里缺文件」—— 红在夹具过期，不在被测装置。
cat > "$FAKE/research/tools/r14c-carrier-heal.sh" <<'HEALSTUB'
#!/bin/bash
echo "STUB_HEAL args=$*"
exit "${STUB_HEAL_RC:-0}"
HEALSTUB
chmod +x "$FAKE/research/tools/r14c-carrier-heal.sh"
: > "$FAKE/scripts/verify-mobile-window-gate.sh"; : > "$FAKE/research/tools/r14c-carrier-chain.sh"
echo v1 > "$FAKE/marker"; git -C "$FAKE" add -A; git -C "$FAKE" commit -qm v1
V1=$(git -C "$FAKE" rev-parse HEAD)
git -C "$FAKE" checkout -qb br; echo v2 > "$FAKE/marker"; git -C "$FAKE" add -A; git -C "$FAKE" commit -qm v2
V2=$(git -C "$FAKE" rev-parse HEAD)
git -C "$FAKE" checkout -q --detach "$V1"
# 🔴 MAIN 必须是"另一条路径但同一个对象库"（linked worktree）—— 与生产同形：
#    真实世界里载体是主检出的 linked worktree，共享 .git 对象，所以载体能 checkout 主检出的 SHA。
#    上一版把 MAIN 也指回载体自己 ⇒ 两边 SHA 恒相等，"先同步"那条性质根本没被走到（假绿）。
git -C "$FAKE" worktree add -q "$D/fake-main" br
FAKE_MAIN="$D/fake-main"

pass=0; failn=0
chk() { # <标签> <期望rc> <实际rc> <日志> <必须出现的串>
  if [ "$2" = "$3" ] && grep -q "$5" "$4"; then
    echo "✅ 臂 $1：rc=$3，日志含「$5」"; pass=$((pass + 1))
  else
    echo "❌ 臂 $1：期望 rc=$2 / 串「$5」，实到 rc=$3"; tail -3 "$4" | sed 's/^/     /'; failn=$((failn + 1))
  fi
}

# 臂 1：缺 CARRIER ⇒ 拒绝开跑
bash -c "cd '$MAIN'; unset CARRIER; LOG=$D/l1 bash '$RIG'" > "$D/o1" 2>&1; rc1=$?
chk 缺载体 1 "$rc1" "$D/o1" 'CARRIER'

# 臂 2：预算 0 ⇒ 试一次就判没窗口（exit 3 且写 WINDOW=timeout）
STUB_RC=3 SELF_GUARD=0 CO_PATTERN=zz-none-match-Q MAIN="$FAKE_MAIN" LOG="$D/l2" CARRIER="$FAKE" GATE="$D/gate" CHAIN="$D/chain" BUDGET=0 INTERVAL=1 \
  bash "$RIG" >/dev/null 2>&1; rc2=$?
chk 预算用尽 3 "$rc2" "$D/l2" 'WINDOW=timeout'

# 臂 3：闸门回 7（既不是 0 也不是 3）⇒ 原样交出去，不洗白
STUB_RC=7 SELF_GUARD=0 CO_PATTERN=zz-none-match-Q MAIN="$FAKE_MAIN" LOG="$D/l3" CARRIER="$FAKE" GATE="$D/gate" CHAIN="$D/chain" BUDGET=60 INTERVAL=1 \
  bash "$RIG" >/dev/null 2>&1; rc3=$?
chk 非零码不洗白 7 "$rc3" "$D/l3" 'final_rc=7'

# 臂 4：闸门回 0 ⇒ 先把"载体"同步到 MAIN 的当前提交，之后才叫链
STUB_RC=0 STUB_CHAIN_RC=0 SELF_GUARD=0 CO_PATTERN=zz-none-match-Q MAIN="$FAKE_MAIN" LOG="$D/l4" CARRIER="$FAKE" GATE="$D/gate" CHAIN="$D/chain" BUDGET=60 INTERVAL=1 \
  bash "$RIG" >/dev/null 2>&1; rc4=$?
echo "   现量：迷你载体停在 $(git -C "$FAKE" rev-parse --short HEAD)（V1=${V1:0:7}，目标 V2=${V2:0:7}），marker=$(cat "$FAKE/marker")"
chk 开窗先同步 0 "$rc4" "$D/l4" 'SYNC rc=0'
if grep -q 'STUB_CHAIN_RAN' "$D/l4"; then
  echo "✅ 臂 4b：同步之后才叫链（日志里有 STUB_CHAIN_RAN）"; pass=$((pass + 1))
else
  echo "❌ 臂 4b：链没被叫"; failn=$((failn + 1))
fi
[ "$(git -C "$FAKE" rev-parse HEAD)" = "$V2" ] && { echo "✅ 臂 4c：载体确实落在目标提交上，marker=v2"; pass=$((pass + 1)); } || { echo "❌ 臂 4c：checkout 没落到 V2"; failn=$((failn + 1)); }

# 臂 5：同步会被拒时**绝不继续打包**（这一臂是给"假绿"上的锁：载体脏着、目标提交要覆盖它）
# 🔴 臂 4 已经把载体同步到 V2，所以这里必须**先复位**再弄脏，而且要断言每一步的码 ——
#    上一版这里写的是 `checkout --detach V1 2>/dev/null` 且没取码：那次 checkout 被拒（工作树脏着），
#    载体其实仍停在 V2 ⇒ 装置走了"无需同步"分支，失败路径根本没被走到（**臂 5 是假红，红在测试自己**）。
git -C "$FAKE" checkout -q -- . || { echo "❌ 臂 5 setup：丢弃工作树改动失败"; exit 4; }
git -C "$FAKE" checkout -q --detach "$V1" || { echo "❌ 臂 5 setup：退回 V1 失败"; exit 4; }
echo carrier-dirty > "$FAKE/marker"        # 与 V2 里的 marker=v2 冲突 ⇒ 装置的 checkout 必须被拒
[ "$(git -C "$FAKE" rev-parse HEAD)" = "$V1" ] || { echo "❌ 臂 5 setup：载体没退回 V1"; exit 4; }
[ "$(cat "$FAKE/marker")" = "carrier-dirty" ] || { echo "❌ 臂 5 setup：marker 没弄脏"; exit 4; }
STUB_RC=0 STUB_CHAIN_RC=0 SELF_GUARD=0 CO_PATTERN=zz-none-match-5Q MAIN="$FAKE_MAIN" LOG="$D/l5" CARRIER="$FAKE" GATE="$D/gate" CHAIN="$D/chain" BUDGET=60 INTERVAL=1 \
  bash "$RIG" >/dev/null 2>&1; rc5=$?
chk 同步失败不起链 5 "$rc5" "$D/l5" 'SYNC rc=[1-9]'
if grep -q 'STUB_CHAIN_RAN' "$D/l5"; then
  echo "❌ 臂 5b：同步失败之后链仍然被叫了（那就是在旧树上打包）"; failn=$((failn + 1))
else
  echo "✅ 臂 5b：同步失败 ⇒ 链没被叫、没动设备"; pass=$((pass + 1))
fi

# ── 臂 9：装置在**显式传 LOG** 时不许挪稳定名（两条腿都要，缺一条就是没牙）
#    这一臂换来的东西很具体：本轮差点把真 rig 的日志指针读成臂的输出（臂真的印了 FIRE 与 final_rc）。
#    🔴 STABLE_LOG 用夹具内的名字，所以这里判的是"装置的行为"，不是"生产软链的运气"。
rm -f "$D/stable9" "$D/l9"
STUB_RC=3 SELF_GUARD=0 CO_PATTERN=zz-none-match-9Q MAIN="$FAKE_MAIN" LOG="$D/l9" CARRIER="$FAKE" GATE="$D/gate" CHAIN="$D/chain" \
  STABLE_LOG="$D/stable9" BUDGET=2 INTERVAL=1 bash "$RIG" >/dev/null 2>&1
if [ -e "$D/stable9" ]; then
  echo "❌ 臂 9：显式传了 LOG，装置仍然创建了稳定名 $D/stable9（→ $(readlink "$D/stable9")）"; failn=$((failn + 1))
else
  echo "✅ 臂 9：显式 LOG ⇒ 稳定名没被装置占用"; pass=$((pass + 1))
fi
# 腿 9b：不传 LOG 时**必须**建稳定名 —— 少了这条，"永远不 ln"也能骗过臂 9
rm -f "$D/stable9b"
DEFAULT_LOG_PATH=$(STUB_RC=3 SELF_GUARD=0 CO_PATTERN=zz-none-match-9bQ MAIN="$FAKE_MAIN" CARRIER="$FAKE" GATE="$D/gate" CHAIN="$D/chain" \
  STABLE_LOG="$D/stable9b" BUDGET=1 INTERVAL=1 bash "$RIG" >/dev/null 2>&1; readlink "$D/stable9b" 2>/dev/null || echo "<none>")
if [ "$DEFAULT_LOG_PATH" = "<none>" ]; then
  echo "❌ 臂 9b：没传 LOG 时稳定名也没建 —— 装置把'默认路径 + 稳定名'这半边删掉了（台账引用会断）"; failn=$((failn + 1))
else
  echo "✅ 臂 9b：默认 LOG ⇒ 稳定名指向 $DEFAULT_LOG_PATH"; pass=$((pass + 1))
  rm -f "$DEFAULT_LOG_PATH"   # 只删这一臂自己刚建的那一枚，绝不 glob /tmp/ht-r14c-window.*.log（那是真 rig 的活日志）
fi
rm -f "$D/stable9b"
# 收尾守卫：整套臂跑完，生产那枚稳定软链必须还在它原来的地方
STABLE_AFTER=$(readlink "$STABLE_REAL" 2>/dev/null || echo "<none>")
if [ "$STABLE_AFTER" = "$STABLE_BEFORE" ]; then
  echo "✅ 臂 9c：生产稳定软链全程未被臂挪动（${STABLE_BEFORE}）"; pass=$((pass + 1))
else
  echo "❌ 臂 9c：生产稳定软链被挪走了（${STABLE_BEFORE} → ${STABLE_AFTER}）—— 立刻 ln -s 指回去"; failn=$((failn + 1))
  [ "$STABLE_BEFORE" = "<none>" ] || ln -sf "$STABLE_BEFORE" "$STABLE_REAL"
fi

# ── 臂 10：闸门回 3 却**没打 REDS 行**（旧版判据）⇒ 装置 exit 4，且不叫链
#    这一臂挡的是"把缺通道读成没有红"：没有红集就无法判断该不该开窗，硬猜等于摘掉判据。
git -C "$FAKE" checkout -q -- . || { echo "❌ 臂 10 setup：工作树没清干净"; exit 4; }
git -C "$FAKE" checkout -q --detach "$V1" || { echo "❌ 臂 10 setup：载体没能退回 V1"; exit 4; }
[ -z "$(git -C "$FAKE" status --porcelain | tr -d '[:space:]')" ] || { echo "❌ 臂 10 setup：载体仍脏"; exit 4; }
STUB_RC=3 STUB_REDS_NONE=1 SELF_GUARD=0 CO_PATTERN=zz-none-match-10Q MAIN="$FAKE_MAIN" LOG="$D/l10" CARRIER="$FAKE" \
  GATE="$D/gate" CHAIN="$D/chain" BUDGET=60 INTERVAL=1 bash "$RIG" >/dev/null 2>&1; rc10=$?
chk 缺REDS通道按装置坏 4 "$rc10" "$D/l10" 'final_rc=4'
if grep -q 'STUB_CHAIN_RAN' "$D/l10"; then
  echo "❌ 臂 10b：缺红集通道还是起了链"; failn=$((failn + 1))
else
  echo "✅ 臂 10b：缺 REDS 行 ⇒ 链没被叫（不猜开窗条件）"; pass=$((pass + 1))
fi
rm -f "$D/l10"

echo "===== 合计：过 $pass 条 / 红 $failn 条 ====="
[ "$failn" = 0 ] || exit 1
