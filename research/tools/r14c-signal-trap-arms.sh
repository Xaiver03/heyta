#!/bin/bash
# 被测对象是 r14c-carrier-chain.sh 新加的那条 TERM trap —— 这里把它的**形状**复刻成最小rig，
# 用两条腿证明"是这条 trap 让还原发生"，而不是"恰好还原了"。
set -u
ARM_DIR=$(mktemp -d /tmp/trap-arm.XXXXXX)
cat > "$ARM_DIR/child-with-trap.sh" <<'CHILD'
#!/bin/bash
set -u
CARRIER="$1"; LOG="$2"
BAK="$3"; OVERLAY_LIST="$BAK/list"
: > "$OVERLAY_LIST"
RESTORED=0
restore_carrier() {
  [ "${RESTORED:-0}" = 1 ] && return
  RESTORED=1
  [ -s "$OVERLAY_LIST" ] || { echo "RESTORE 无覆盖件可还原" >> "$LOG"; return; }
  while IFS='|' read -r p existed; do
    [ -n "$p" ] || continue
    if [ "$existed" = 1 ]; then
      cp "$BAK/$p" "$CARRIER/$p" && echo "RESTORED ${p}（回到覆盖前字节）" >> "$LOG"
    else
      rm -f "$CARRIER/$p" && echo "REMOVED ${p}（覆盖前不存在）" >> "$LOG"
    fi
  done < "$OVERLAY_LIST"
  echo "RESTORE_DONE $(grep -c . "$OVERLAY_LIST") 枚" >> "$LOG"
}
trap 'restore_carrier' EXIT
trap 'restore_carrier; echo "CHAIN_STOPPED_AT=signal（收到 TERM/INT，已还原覆盖件后以 143 退出）" >> "$LOG"; exit 143' TERM INT
# ── 覆盖动作（与链的第 0 步同形）──
mkdir -p "$BAK/scripts"
cp "$CARRIER/scripts/f.sh" "$BAK/scripts/f.sh"
echo "scripts/f.sh|1" >> "$OVERLAY_LIST"
echo OVERLAY > "$CARRIER/scripts/f.sh"
sleep 30
CHILD
# 🔴 第一版的 sed 锚写的是 `^trap .TERM INT.*$` —— 真行里 TERM INT 在**行尾**，
#    那条 pattern 结构上不可能命中 ⇒ 负向对照副本和正向一模一样（臂 2 白测一次，
#    而且报的是"还原另有原因"这种会把结论带偏的方向）。改成按行尾删整条 trap。
sed '/TERM INT$/d' "$ARM_DIR/child-with-trap.sh" > "$ARM_DIR/child-no-trap.sh"
if grep -c 'TERM INT' "$ARM_DIR/child-no-trap.sh" | grep -qv '^0$'; then
  echo "  ❌ 负向对照副本里 TERM trap 还在 ⇒ 这条腿没测到东西（先修臂）"; exit 4
fi
if ! grep -q "trap 'restore_carrier' EXIT" "$ARM_DIR/child-no-trap.sh"; then
  echo "  ❌ 负向对照把 EXIT trap 也删掉了 ⇒ 两臂差了两件事，不叫对照"; exit 4
fi

run_leg() { # $1=子脚本 $2=carrier 目录
  local child="$1" car="$2" lg bak rc out
  mkdir -p "$car/scripts"; echo ORIG > "$car/scripts/f.sh"
  lg="$car/log"; bak=$(mktemp -d "$car/bak.XXXXXX")
  bash "$child" "$car" "$lg" "$bak" >/dev/null 2>&1 &
  local pid=$!
  # 等覆盖真的发生（否则测的是"没走到被测判据就返回"，本机记过这一族）
  for i in 1 2 3 4 5 6 7 8 9 10; do
    [ "$(cat "$car/scripts/f.sh")" = OVERLAY ] && break
    sleep 0.2
  done
  local reached=0
  [ "$(cat "$car/scripts/f.sh")" = OVERLAY ] && reached=1
  kill -TERM "$pid" 2>/dev/null
  wait "$pid"; rc=$?
  out=$(cat "$car/scripts/f.sh")
  printf '  到达被测点=%s rc=%s 收尾内容=%s trap行=%s\n' "$reached" "$rc" "$out" \
    "$(grep -c 'CHAIN_STOPPED_AT=signal' "$lg" || true)"
  LAST_RC=$rc; LAST_OUT=$out; LAST_REACHED=$reached
  LAST_SIG=$(grep -c 'CHAIN_STOPPED_AT=signal' "$lg" || true)
}

echo "臂 1（有 TERM trap ⇒ 必须还原成 ORIG）"
run_leg "$ARM_DIR/child-with-trap.sh" "$ARM_DIR/car1"
if [ "$LAST_REACHED" = 1 ] && [ "$LAST_OUT" = ORIG ] && [ "$LAST_RC" = 143 ] && [ "$LAST_SIG" = 1 ]; then
  echo "  ✅ 臂 1：覆盖确实发生过、TERM 后回到 ORIG、rc=143 且打了 signal 哨兵行"; P=1
else echo "  ❌ 臂 1 不成立"; P=0
fi

echo "臂 2（去掉 TERM trap ⇒ 必须留在 OVERLAY —— 证明还原是那条 trap 干的）"
run_leg "$ARM_DIR/child-no-trap.sh" "$ARM_DIR/car2"
# 期望按实测来（第一版按推断写"应当留 OVERLAY"，被现量否证）：
#   SIGTERM 在无 TERM trap 时，bash 3.2.57 **照样跑 EXIT trap** ⇒ 还原仍会发生，
#   而 trap 行必须为 0（那才是这条 trap 独有的增量）。
if [ "$LAST_REACHED" = 1 ] && [ "$LAST_OUT" = ORIG ] && [ "$LAST_SIG" = 0 ]; then
  echo "  ✅ 臂 2：去掉 TERM trap 后仍还原（EXIT 接住了 TERM），且没有 signal 哨兵行 ⇒ 增量为 1 行读数 + 确定 143"; Q=1
else echo "  ❌ 臂 2：内容=${LAST_OUT}（期望 ORIG）／哨兵行=${LAST_SIG}（期望 0）"; Q=0
fi

# 臂 3：SIGKILL（-9）—— 这才是"任何 trap 都接不住"那一形，用它来定因残留
run_kill9() { local car="$1" pid lg bak i
  mkdir -p "$car/scripts"; echo ORIG > "$car/scripts/f.sh"
  lg="$car/log"; : > "$lg"; bak=$(mktemp -d "$car/bak.XXXXXX")
  bash "$ARM_DIR/child-with-trap.sh" "$car" "$lg" "$bak" >/dev/null 2>&1 &
  pid=$!
  for i in 1 2 3 4 5 6 7 8 9 10; do [ "$(cat "$car/scripts/f.sh")" = OVERLAY ] && break; sleep 0.2; done
  kill -9 "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  printf '  SIGKILL 后收尾内容=%s trap行=%s\n' "$(cat "$car/scripts/f.sh")" \
    "$(grep -c 'CHAIN_STOPPED_AT=signal' "$lg" || true)"
  K_OUT=$(cat "$car/scripts/f.sh")
  K_SIG=$(grep -c 'CHAIN_STOPPED_AT=signal' "$lg" 2>/dev/null || true); K_SIG=${K_SIG:-0}
}
echo "臂 3（SIGKILL ⇒ trap 一律不跑，这一形才留残留）"
run_kill9 "$ARM_DIR/car3"
if [ "$K_OUT" = OVERLAY ] && [ "$K_SIG" = 0 ]; then
  echo "  ✅ 臂 3：SIGKILL 确实不还原（= 06:5x 现场残留的形状；SIGTERM 会还原）"; R=1
else echo "  ❌ 臂 3：SIGKILL 也还原了 ⇒ 残留另有原因，归因要改"; R=0; fi

rm -rf "$ARM_DIR"
[ "$P" = 1 ] && [ "$Q" = 1 ] && [ "$R" = 1 ] || exit 4
echo "两条腿都成立"
exit 0
