#!/usr/bin/env bash
# w6 装置自检：`--dry-run` 到底改不改字节。
#
# 为什么存在：这个 rig 的文件头承诺 `--dry-run`「一个字节都不改」，而前置 1 的"本臂残留自愈"
# 那行 `git show HEAD:… > $SRC` 当年写在 DRY 判定**之前** —— 承诺是假的。
# 修完之后必须有一条**能失败**的判据钉住它，否则下一次有人把那行挪回去照样绿。
#
# 六臂（臂 0 是对照，臂 4 是阳性对照，臂 5 是设备窗口那一支）：
#   0  DRY + 源码干净   ⇒ 摘要印「源码干净」，**不**印 OK-WITH-RESIDUE（证明臂 1 那档不是无条件打印）
#   1  DRY + 本臂残留   ⇒ md5 前后逐字相同 + 打印 DRY=HEAL-SKIPPED + 摘要不许出现"源码干净"
#   2  非 DRY + 同样起点 ⇒ 确实从 HEAD 取回（证明臂 1 的"没写"来自 DRY 闸门，而不是那段根本没执行）
#   3  DRY + 别人的改动 ⇒ die3 且不写（证明针脚判别不是"凡脏都当残留"），且不替别人认领归属
#   4  DRY + 本臂残留，但跑 **HEAD 里那版旧脚本** ⇒ md5 必须变（臂 1 的判据真的有牙）
#   5  DRY + 另一趟 verify-mobile-* 在跑 ⇒ die3 且**不打印前置摘要**（adb/curl/ssh 全活着，
#      所以归因只可能是前置 2。这一支以前从来没被测过，而臂 0/1/3/4 曾经因为它没被假化
#      而把宿主机的进程表读进夹具里 —— 见 make_fakebin 上方那段）
#
# 全部在沙盒 git 仓库里跑，绝不碰真检出的工作树；假 adb/curl/ssh/**ps** 让前置 2/3 与设备窗口
# 那一格确定性地通过或失败，因此任何臂都不可能走到构建或安装那一步，也不看这台机器上有没有人在驱动设备。
#
# 用法：bash research/tools/mutation-rigs/w6-dry-run-arms.sh
# 退出码：0 = 全过；1 = 有臂失败（逐臂打印 ARM=，末行 ARMS= 自己数，不硬写）。
set -u

REAL_R="$(cd "$(dirname "$0")/../../.." && pwd)"
RIG_REL="research/tools/mutation-rigs/w6-note-restore-device-arm.sh"
RIG="$REAL_R/$RIG_REL"
WORK="$REAL_R/tmp/w6-dry-arms.$$"
SRCREL="packages/app-host/src/note-actions.ts"

# 三份夹具：干净版含变异锚点；残留版含本臂针脚；别人的版两者都不含。
# 🔴 缩进必须和装置里那两条字面量**逐格**一致（payload 前 8 格、`});` 与 `return true;` 前 6 格）——
#    写成 4 格时针脚判不出"本臂残留"，臂 1/2/4 会一起被归因成"别人的改动"，而那不是装置的判断。
CLEAN='// sandbox fixture
export function restoreNote(id: string) {
  submit({
    type: "UPD",
    entityId: id,
        payload: { deletedAt: null },
      });
      return true;
}
'
RESIDUE='// sandbox fixture
export function restoreNote(id: string) {
  submit({
    type: "UPD",
    entityId: id,
        payload: {},
      });
      return true;
}
'
OTHERS='// sandbox fixture —— 别人的在飞改动，针脚不在里面
export function restoreNote(id: string) {
  submit({ type: "UPD", entityId: id, payload: { deletedAt: null, title: "改了名" } });
}
'

say() { printf '%s\n' "$*"; }
FAILS=0
# 🔴 臂数**自己数**，不许硬写：上一版末行恒印 `ARMS=5`，于是把一臂整块删掉或提前 exit
#    之后，它报的仍是"五臂跑完了"。台账里那句"臂数由它自己打印的 `ARMS=` 为准"依赖的就是这一点。
ARMS=0
arm_start() { ARMS=$((ARMS + 1)); }
ok()  { say "  ✅ $1"; }
bad() { say "  ❌ $1"; FAILS=$((FAILS+1)); }

# 建一枚沙盒仓库。**HEAD 必须是干净版**，起始内容在 commit 之后再覆盖 ——
# 早先写反过一次：把脏内容一起提交了，于是四臂的 git status 全空、臂 1/3/4 一起假失败，
# 而臂 0"通过"其实是"根本没脏"。（这正是 §7 那族"夹具没喂进被测条件"的形状。）
new_sandbox() {
  local tag="$1" content="$2" legacy="${3:-0}" sb="$WORK/$1"
  mkdir -p "$sb/research/tools/mutation-rigs" "$sb/packages/app-host/src"
  printf '{"name":"sandbox"}\n' > "$sb/package.json"
  printf 'packages:\n  - "packages/*"\n' > "$sb/pnpm-workspace.yaml"
  if [ "$legacy" = 1 ]; then
    git -C "$REAL_R" show "HEAD:$RIG_REL" > "$sb/research/tools/mutation-rigs/w6-note-restore-device-arm.sh" \
      || { say "$tag 取不到 HEAD 里那版旧脚本"; return 1; }
  else
    cp "$RIG" "$sb/research/tools/mutation-rigs/"
  fi
  printf '%s' "$CLEAN" > "$sb/$SRCREL"
  ( cd "$sb" && git init -q && git -c user.name=t -c user.email=t@t add -A \
      && git -c user.name=t -c user.email=t@t commit -qm fixture )
  printf '%s' "$content" > "$sb/$SRCREL"
  # 夹具自证：起始状态必须**真的**是脏的（臂 0 除外），否则后面所有臂都在验"没脏"这条路
  local dirty_now; dirty_now=$(cd "$sb" && git status --porcelain -- "$SRCREL")
  if [ "$content" = "$CLEAN" ]; then
    [ -z "$dirty_now" ] || { say "$tag 夹具失败：干净版却报脏"; return 1; }
  else
    [ -n "$dirty_now" ] || { say "$tag 夹具失败：$content 起始却报干净"; return 1; }
  fi
  say "$tag  $sb  START_MD5=$(md5 -q "$sb/$SRCREL")  DIRTY=${dirty_now:+yes}${dirty_now:-no}"
}

# 假工具：mode=ok 让前置 2/3 通过（DRY 摘要才会打印）；mode=fail 让臂停在构建之前；
# mode=busy = **只有设备窗口那一格**不通过（adb/curl/ssh 全部活着，所以 die3 只可能归因到前置 2）。
#
# 🔴 `ps` 必须在假 PATH 里 —— 前置 2 用的是 `ps -eo command | grep -E 'verify-mobile-[a-z]+'`，
#    它读的是**真机进程表**。10-06 实测：这台 Mac 上 `heyta-wt-merge` 那棵检出正在跑
#    `.verify-mobile-ai.sh.snap.21900`，于是臂 0 与臂 1 一起以 RC=3 死在设备窗口那一格，
#    读起来像"装置的两条主干判据坏了"，实际是**自检不封闭**（宿主机状态漏进了夹具）。
#    同一次实测也暴露了另一件事：busy 那一支从来没被测过 ⇒ 现在补成臂 5。
make_fakebin() {
  local m="$1" fb="$WORK/fakebin-$1"
  mkdir -p "$fb"
  printf '#!/bin/sh\n[ "%s" = ok ] || [ "%s" = busy ] && { echo device; exit 0; }\nexit 1\n' "$m" "$m" > "$fb/adb"
  printf '#!/bin/sh\n{ [ "%s" = ok ] || [ "%s" = busy ]; } && exit 0\nexit 7\n' "$m" "$m" > "$fb/curl"
  printf '#!/bin/sh\n{ [ "%s" = ok ] || [ "%s" = busy ]; } && { echo HEYTA_PROBE_OK; exit 0; }\nexit 255\n' "$m" "$m" > "$fb/ssh"
  printf '#!/bin/sh\nexit 1\n' > "$fb/scp"
  printf '#!/bin/sh\n[ "%s" = busy ] && { printf "COMMAND\\n/bin/bash /opt/sbx/scripts/.verify-mobile-ai.sh.snap.4242\\n"; exit 0; }\nprintf "COMMAND\\n/sbin/launchd\\n/usr/sbin/kernel_task\\n"\n' "$m" > "$fb/ps"
  chmod +x "$fb"/*
  printf '%s' "$fb"
}

mkdir -p "$WORK"
FB_OK="$(make_fakebin ok)"
FB_FAIL="$(make_fakebin fail)"
FB_BUSY="$(make_fakebin busy)"
# 假 PATH 自证：busy 那份必须**自己**能被前置 2 那条 grep 命中，ok 那份必须命不中。
# 夹具没喂进被测条件时，臂 5 会以"另一条前置失败"的身份通过 —— 那是一条恒真的判据。
PATH="$FB_BUSY:$PATH" ps -eo command | grep -E 'verify-mobile-[a-z]+' | grep -v -e grep >/dev/null \
  || { say "夹具失败：busy 假 ps 没被前置 2 那条 grep 命中（臂 5 将是假通过）"; exit 1; }
if PATH="$FB_OK:$PATH" ps -eo command | grep -qE 'verify-mobile-[a-z]+'; then
  say "夹具失败：ok 假 ps 也能命中 ⇒ 臂 0/1/3/4 会全被归因成设备窗口占用"; exit 1
fi
say "沙盒根：$WORK"

# ── 臂 0 ────────────────────────────────────────────────────────────────
say "=== 臂 0：DRY + 源码本来干净 ⇒ 摘要该说干净，不该说有残留 ==="
arm_start
new_sandbox a0 "$CLEAN" || exit 1
SB="$WORK/a0"; BEFORE=$(md5 -q "$SB/$SRCREL")
OUT=$(cd "$SB" && PATH="$FB_OK:$PATH" bash "research/tools/mutation-rigs/w6-note-restore-device-arm.sh" --dry-run 2>&1); RC0=$?
[ "$BEFORE" = "$(md5 -q "$SB/$SRCREL")" ] && ok "md5 不变" || bad "臂 0 不该写字节"
if echo "$OUT" | grep -q 'PREFLIGHTS=OK（载体自证 / 源码干净'; then ok "走了「源码干净」那一档"; else bad "干净源码没走正常摘要（RC0=${RC0}）"; fi
echo "$OUT" | grep -q 'OK-WITH-RESIDUE' && bad "无残留却印了 OK-WITH-RESIDUE ⇒ 臂 1 那条断言恒真" || ok "没误报残留"

# ── 臂 1 ────────────────────────────────────────────────────────────────
say "=== 臂 1：--dry-run 遇到本臂残留，必须一个字节都不改 ==="
arm_start
new_sandbox a1 "$RESIDUE" || exit 1
SB="$WORK/a1"; BEFORE=$(md5 -q "$SB/$SRCREL")
OUT=$(cd "$SB" && PATH="$FB_OK:$PATH" bash "research/tools/mutation-rigs/w6-note-restore-device-arm.sh" --dry-run 2>&1); RC1=$?
AFTER=$(md5 -q "$SB/$SRCREL")
[ "$BEFORE" = "$AFTER" ] && ok "md5 前后逐字相同（${AFTER}）" || bad "md5 变了（$BEFORE → ${AFTER}）—— --dry-run 仍在写文件"
echo "$OUT" | grep -q 'DRY=HEAL-SKIPPED' && ok "打印了 DRY=HEAL-SKIPPED" || bad "没打印 DRY=HEAL-SKIPPED（残留被悄悄处理或根本没报告）"
if echo "$OUT" | grep -q '源码干净'; then bad "摘要仍印「源码干净」—— 有残留时这是假的"; else ok "摘要没把残留说成干净"; fi
if echo "$OUT" | grep -q 'PREFLIGHTS=OK-WITH-RESIDUE'; then ok "摘要单独一档 OK-WITH-RESIDUE"; else bad "摘要没有 OK-WITH-RESIDUE 这一档（RC1=${RC1}）"; fi

# ── 臂 2 ────────────────────────────────────────────────────────────────
say "=== 臂 2：同样的起点去掉 --dry-run，必须真的从 HEAD 取回（臂 1 不是空跑）==="
arm_start
new_sandbox a2 "$RESIDUE" || exit 1
SB="$WORK/a2"
OUT=$(cd "$SB" && PATH="$FB_FAIL:$PATH" bash "research/tools/mutation-rigs/w6-note-restore-device-arm.sh" 2>&1); RC2=$?
echo "$OUT" | grep -q 'RESIDUE_HEALED=' && ok "打印了 RESIDUE_HEALED" || bad "没走自愈分支（RC2=${RC2}）：$(echo "$OUT"|head -3)"
if git -C "$SB" show "HEAD:$SRCREL" | diff -q - "$SB/$SRCREL" >/dev/null; then ok "文件内容 == HEAD blob（确实取回了）"; else bad "自愈没落到位"; fi
[ "$RC2" = 3 ] && ok "臂 2 停在环境判据（rc=3，没进构建）" || bad "RC2=$RC2 预期 3"

# ── 臂 3 ────────────────────────────────────────────────────────────────
say "=== 臂 3：DRY 遇到**别人的**改动，必须让路且不写 ==="
arm_start
new_sandbox a3 "$OTHERS" || exit 1
SB="$WORK/a3"; BEFORE=$(md5 -q "$SB/$SRCREL")
OUT=$(cd "$SB" && PATH="$FB_OK:$PATH" bash "research/tools/mutation-rigs/w6-note-restore-device-arm.sh" --dry-run 2>&1); RC3=$?
AFTER=$(md5 -q "$SB/$SRCREL")
[ "$BEFORE" = "$AFTER" ] && ok "md5 不变（${AFTER}）" || bad "动了别人的文件（$BEFORE → ${AFTER}）"
echo "$OUT" | grep -q '不是\*\*本臂那发针脚' && ok "die3 只声明「不是本臂针脚」，并把现量归属的命令一并交出去" || bad "没按非针脚的未提交 diff 拒绝（RC3=${RC3}）：$(echo "$OUT"|head -3)"
echo "$OUT" | grep -q '别人的' && bad "🔴 装置又把归属写死了：它只能判「是不是本臂针脚」，判不出这枚 diff 是谁的 —— 10-06 实测它把**本线自己**未提交的 G-8 批次报成「别人的」，读台账的人会照着等错的人" || ok "没有冒充归属"
echo "$OUT" | grep -q 'DRY=HEAL-SKIPPED' && bad "别人的改动被当成了本臂残留" || ok "没把别人的改动当残留"
[ "$RC3" = 3 ] && ok "RC3=3" || bad "RC3=$RC3 预期 3"

# ── 臂 4：阳性对照 ──────────────────────────────────────────────────────
say "=== 臂 4：拿 HEAD 里那版旧脚本跑臂 1 的同一场景，判据必须能红 ==="
arm_start
if new_sandbox a4 "$RESIDUE" 1; then
  SB="$WORK/a4"; BEFORE=$(md5 -q "$SB/$SRCREL")
  (cd "$SB" && PATH="$FB_OK:$PATH" bash "research/tools/mutation-rigs/w6-note-restore-device-arm.sh" --dry-run >/dev/null 2>&1)
  AFTER=$(md5 -q "$SB/$SRCREL")
  [ "$BEFORE" != "$AFTER" ] && say "  ✅ 旧脚本在同样场景下**改了字节**（$BEFORE → ${AFTER}）⇒ 臂 1 的 md5 判据有牙" \
    || bad "旧脚本也没改字节 ⇒ 臂 1 恒真，这条判据没有价值"
else
  bad "臂 4 没做成（阳性对照缺失 = 前四臂结论不成立）"
fi

# ── 臂 5：设备窗口被占用那一支（前置 2）──────────────────────────────────
say "=== 臂 5：另一趟 verify-mobile-* 在跑 ⇒ 必须让路，且 adb/curl/ssh 全活着（归因只可能是前置 2）==="
arm_start
new_sandbox a5 "$CLEAN" || exit 1
SB="$WORK/a5"; BEFORE=$(md5 -q "$SB/$SRCREL")
OUT=$(cd "$SB" && PATH="$FB_BUSY:$PATH" bash "research/tools/mutation-rigs/w6-note-restore-device-arm.sh" --dry-run 2>&1); RC5=$?
[ "$BEFORE" = "$(md5 -q "$SB/$SRCREL")" ] && ok "md5 不变（让路时不写字节）" || bad "臂 5 不该写字节"
echo "$OUT" | grep -q 'ARM=ENV-INVALID reason=另一趟 verify-mobile' && ok "停在设备窗口独占那一格，并把占用者写进 reason" \
  || bad "没走前置 2 那一支（RC5=${RC5}）：$(echo "$OUT" | head -3)"
# 🔴 这一条才是本臂存在的理由：busy 假 PATH 里 adb/curl/ssh 全部**成功**，所以摘要一旦打印出来，
#    说明 die3 被挪到了后面或根本没执行 ⇒ "窗口不独占会让路"这条承诺没有判据在守。
echo "$OUT" | grep -q 'PREFLIGHTS=' && bad "🔴 窗口被占用却仍打印了前置摘要 ⇒ 前置 2 形同不存在" || ok "没有把占用状态报成前置全过"
[ "$RC5" = 3 ] && ok "RC5=3（环境无效，不是失败）" || bad "RC5=$RC5 预期 3"

say "ARMS=$ARMS FAILS=$FAILS"
[ "$FAILS" = 0 ] && say "ARM=OK" || say "ARM=FAIL"
if [ "$FAILS" = 0 ]; then exit 0; else exit 1; fi
