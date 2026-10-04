#!/bin/bash
# `research/tools/r14c-carrier-chain.sh` 第 0 步（判据脚本点名覆盖）的有牙先验 —— 零设备、零打包。
#
# 为什么存在：第 0 步是"C 那一趟测的是当前判据"这件事的**唯一承重点**（03:5x 现量：
# 载体里第 4 层是 `psql … | sed` 的纯打印版，主检出那段才是带 ok/bad 与退出码的判据版）。
# 它打印 `OVERLAY … md5=` 只说明这次拷对了，不说明它挡得住"没拷对/不该拷"。
#
# 🔴 全程在 `git clone` 出来的隔离副本里动刀，真实载体只在**对照臂**里被读写那批判据脚本
#    （枚数**从链源码里的清单推导**，不写死 —— 原来两处钉着"4"，清单涨到 6 时臂自己变红，
#     症状与"链坏了"逐字相同；那是"把上游当前状态写进断言"那一族，2026-10-04 实测）
#    （由链自己的备份还原负责，本装置额外用覆盖前后 md5 逐枚复核 —— 不还原成功就是本装置红）。
#
# 退出码：0 = 对照 + 三臂都符合预期；1 = 有臂不符合；4 = 装置前提不成立（clone 失败 / needle 不在）。
# 用法：bash research/tools/r14c-chain-overlay-arms.sh
set -u
MAIN="${MAIN:-/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta}"
CAR="${CAR:-/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-r14c}"
CHAIN="$MAIN/research/tools/r14c-carrier-chain.sh"
[ -f "$CHAIN" ] || { echo "❌ 前提不成立：$CHAIN 不在" >&2; exit 4; }
[ -d "$CAR/.git" ] || [ -f "$CAR/.git" ] || { echo "❌ 前提不成立：$CAR 不是检出" >&2; exit 4; }
if [ ! -f "$MAIN/packages/domain/src/index.ts" ]; then
  echo "❌ 前提不成立：A2 臂要用的产品代码路径不存在，换一个真实存在的再跑" >&2; exit 4
fi

D=$(mktemp -d /tmp/ht-r14c-overlay-arms.XXXXXX); trap 'rm -rf "$D"' EXIT
fail=0
md5of() { md5 -q "$1"; }

# ── 期望枚数**从链源码里的清单推导**，不写死（本轮实测：清单从 4 枚涨到 6 枚，
#    而两处断言还钉着 4 ⇒ 臂自己变红，症状长得和"链坏了"逐字相同）。
#    这正是"别把上游当前状态写死进断言"那一族，代价是一行 awk。
list_body() { awk '/^JUDG_PATHS=\(/,/^\)/' "$CHAIN"; }
WANT_N=$(list_body | grep -vE '^[[:space:]]*#' | grep -vE '^[[:space:]]*(JUDG_PATHS=\(|\))' | grep -c '[^[:space:]]')
[ "${WANT_N:-0}" -gt 0 ] || { echo "❌ 从 $CHAIN 推导出的清单枚数为 0 ⇒ 解析坏了，本装置后面的臂全不算读数" >&2; exit 4; }
echo "清单枚数（从链源码推导，非写死）=$WANT_N"

# 🔴 依赖对偶不变式：闸门被覆盖进载体后，它 source 的每枚 lib 必须在**载体里拿得到当前那份**，
#    否则"动设备那一刻"会悄悄少一条读数（闸门只 `set -u` ⇒ 不崩，只打一行 command not found）。
#    两版都栽过：① 第一版扫全文，把注释里那句"刻意不 source `lib/mobile-e2e.sh`"当成依赖 ⇒ 假红；
#      ② 第一版循环里 ❌ 之后还无条件打 ✅ ⇒ 读数自己 contradict 自己（同 §8.3 那一族）。
#    正解：只解析**真正的 source 行**，并且只要求"载体缺失或与主检出工作树不同"的那几枚。
GATE_SRC="$MAIN/scripts/verify-mobile-window-gate.sh"
if list_body | grep -q 'verify-mobile-window-gate.sh'; then
  DEP_BAD=0; DEP_N=0
  for dep in $(grep -vE '^[[:space:]]*#' "$GATE_SRC" \
                 | sed -nE 's/^[[:space:]]*\.[[:space:]]+//p' \
                 | grep -oE '[A-Za-z0-9_./$:-]*lib/[A-Za-z0-9._-]+\.sh' \
                 | sed -E 's#.*lib/#scripts/lib/#' | sort -u); do
    [ -f "$MAIN/$dep" ] || continue          # 变量拼出来的、本仓不存在的形状：跳过而不是编一条红
    if [ -f "$CAR/$dep" ] && cmp -s "$CAR/$dep" "$MAIN/$dep"; then
      continue                                # 载体已有当前那份 ⇒ 不要求并列
    fi
    DEP_N=$((DEP_N + 1))
    if ! list_body | grep -qF -- "$dep"; then
      echo "   ❌ 闸门依赖 ${dep}：载体那份缺失/不同，而覆盖清单没列 ⇒ 那条读数会在开火时悄悄不见"
      fail=1; DEP_BAD=$((DEP_BAD + 1))
    fi
  done
  if [ "$DEP_BAD" = 0 ]; then
    echo "   ✅ 闸门在载体里拿不到的依赖共 $DEP_N 枚，逐枚都已在清单里（判定式：只解析 source 行 + 载体缺失/不同才要求）"
  fi
fi

# ── C0 对照：真实载体 + PORT_ONLY（跑到挑端口就退出，不打包、不动设备）────────
echo "== C0 对照：真实载体，PORT_ONLY=1 =="
BEFORE="$D/before"; : > "$BEFORE"
for p in scripts/verify-mobile-due-time.sh scripts/lib/mobile-e2e-runner-probe.sh; do
  echo "$(md5of "$CAR/$p") $p" >> "$BEFORE"
done
git -C "$CAR" status --porcelain > "$D/status.before"
PORT_ONLY=1 LOG="$D/c0.log" bash "$CHAIN" > "$D/c0.out" 2>&1
C0=$?
NO=$(grep -c '^OVERLAY ' "$D/c0.log")
RD=$(grep -c 'RESTORE_DONE' "$D/c0.log")
echo "   rc=$C0  OVERLAY 行数=$NO  RESTORE_DONE=$RD"
[ "$C0" = 0 ] || { echo "   ❌ 对照没绿（读 $D/c0.log 与 $D/c0.out）"; sed -n '1,8p' "$D/c0.out"; fail=1; }
[ "$NO" = "$WANT_N" ] || { echo "   ❌ 对照的 OVERLAY 行数=${NO}（期望 ${WANT_N} = 从链源码推导的清单枚数）"; fail=1; }
[ "$RD" = 1 ] || { echo "   ❌ 对照没打 RESTORE_DONE ⇒ 还原没跑"; fail=1; }
AFTER="$D/after"; : > "$AFTER"
for p in scripts/verify-mobile-due-time.sh scripts/lib/mobile-e2e-runner-probe.sh; do
  echo "$(md5of "$CAR/$p") $p" >> "$AFTER"
done
if diff -q "$BEFORE" "$AFTER" >/dev/null; then
  echo "   ✅ 覆盖前后逐枚 md5 相同（还原回到覆盖前字节）"
else
  echo "   ❌ 还原后字节与覆盖前不符："; diff "$BEFORE" "$AFTER" | sed 's/^/      /'; fail=1
fi
git -C "$CAR" status --porcelain > "$D/status.after"
if diff -q "$D/status.before" "$D/status.after" >/dev/null; then
  echo "   ✅ 载体 porcelain 逐行相同（没留下覆盖件、没动别人的状态）"
else
  echo "   ❌ 载体状态被改动："; diff "$D/status.before" "$D/status.after" | sed 's/^/      /'; fail=1
fi

# ── 隔离克隆：三臂都在这里跑（真实载体不碰）────────────────────────────────
CLONE="$D/clone"
git clone --quiet --no-hardlinks "$CAR" "$CLONE" 2>"$D/clone.err" || { echo "❌ clone 失败：$(cat "$D/clone.err")" >&2; exit 4; }
[ -f "$CLONE/scripts/verify-mobile-due-time.sh" ] || { echo "❌ clone 里没有判据脚本 ⇒ 对照无意义" >&2; exit 4; }
echo "   克隆就绪 sha=$(git -C "$CLONE" rev-parse --short HEAD)（载体 HEAD $(git -C "$CAR" rev-parse --short HEAD)）"

echo "== A1：清单里点名一枚主检出不存在的文件 ⇒ 期望 rc=5 且说'主检出缺' =="
PORT_ONLY=1 CARRIER="$CLONE" LOG="$D/a1.log" \
  JUDG_PATHS_OVERRIDE="scripts/verify-mobile-due-time.sh|research/tools/这一条不存在.sh" \
  bash "$CHAIN" >"$D/a1.out" 2>&1; A1=$?
echo "   rc=$A1  哨兵=[$(grep -o 'CHAIN_STOPPED_AT=.*' "$D/a1.log" | head -1)]"
[ "$A1" = 5 ] || { echo "   ❌ 没走'主检出缺文件'那一档"; fail=1; }
grep -q '主检出缺' "$D/a1.log" || { echo "   ❌ 归因不对（该指'主检出缺'）"; fail=1; }

echo "== A2：清单里点名一枚**产品代码** ⇒ 期望 rc=5，且覆盖动作根本没发生 =="
PORT_ONLY=1 CARRIER="$CLONE" LOG="$D/a2.log" \
  JUDG_PATHS_OVERRIDE="packages/domain/src/index.ts" \
  bash "$CHAIN" >"$D/a2.out" 2>&1; A2=$?
echo "   rc=$A2  哨兵=[$(grep -o 'CHAIN_STOPPED_AT=.*' "$D/a2.log" | head -1)]  OVERLAY 行数=$(grep -c '^OVERLAY ' "$D/a2.log")"
[ "$A2" = 5 ] || { echo "   ❌ 产品代码没被拒绝"; fail=1; }
[ "$(grep -c '^OVERLAY ' "$D/a2.log")" = 0 ] || { echo "   ❌ 拒绝之前已经动了文件（守卫排在校验之后了）"; fail=1; }
grep -q '产品代码' "$D/a2.log" || { echo "   ❌ 归因不对"; fail=1; }

echo "== A3：载体 packages/ 里有未提交改动 ⇒ 期望 rc=5 carrier_dirty，不打包 =="
printf '\n// ht-r14c-arms A3 注入的一行\n' >> "$CLONE/packages/domain/src/index.ts"
PORT_ONLY=1 CARRIER="$CLONE" LOG="$D/a3.log" bash "$CHAIN" >"$D/a3.out" 2>&1; A3=$?
echo "   rc=$A3  哨兵=[$(grep -o 'CHAIN_STOPPED_AT=.*' "$D/a3.log" | head -1)]"
[ "$A3" = 5 ] || { echo "   ❌ 脏载体没被拦（那就是把别人的 WIP 编进产物还报绿）"; fail=1; }
grep -q 'carrier_dirty' "$D/a3.log" || { echo "   ❌ 归因不对"; fail=1; }
grep -q '仍脏：' "$D/a3.log" || { echo "   ❌ 没把脏的那枚列出来（只有停、没有现场 = 下一个人还得重新找）"; fail=1; }

echo "== A4：对照在克隆里（干净树）也应绿，且 OVERLAY 数 == 推导出的清单枚数 =="
git -C "$CLONE" checkout -- packages/domain/src/index.ts
# 🔴 逐枚期望**从清单 + 跑之前的现量推导**，不钉具体文件名。
#    原来这里钉着两行"这一枚该还在 / 那一枚该被 REMOVED"，而 17:46 看守把载体从 `2ac93e54`
#    同步到 `a5d11125` ⇒ `research/tools/r14c-bundle-testid-preflight.sh` 从"覆盖前不存在"
#    变成"覆盖前就存在"，A4 于是红在一条**过期的前提**上，而链的行为一字未变 ——
#    正是本文件头写的那一族（别把上游当前状态写死进断言）。现在的前置是"跑之前现量每一枚在不在"。
BEFORE_A4="$D/a4-before"; : > "$BEFORE_A4"
for p in $(list_body | grep -vE '^[[:space:]]*#' | grep -vE '^[[:space:]]*(JUDG_PATHS=\(|\))'); do
  if [ -e "$CLONE/$p" ]; then
    printf 'E\t%s\t%s\n' "$p" "$(md5of "$CLONE/$p")" >> "$BEFORE_A4"
  else
    printf 'A\t%s\t-\n' "$p" >> "$BEFORE_A4"
  fi
done
N_EXISTED=$(grep -c '^E' "$BEFORE_A4" || true)
N_ABSENT=$(grep -c '^A' "$BEFORE_A4" || true)
printf '   覆盖前现量：已存在 %s 枚 / 不存在 %s 枚（合计应为 %s）\n' "$N_EXISTED" "$N_ABSENT" "$WANT_N"
[ "$((N_EXISTED + N_ABSENT))" = "$WANT_N" ] || { echo "   ❌ 分母对不上清单枚数 ⇒ 上面的遍历漏了条目"; fail=1; }
PORT_ONLY=1 CARRIER="$CLONE" LOG="$D/a4.log" bash "$CHAIN" >"$D/a4.out" 2>&1; A4=$?
echo "   rc=$A4  OVERLAY 行数=$(grep -c '^OVERLAY ' "$D/a4.log")  RESTORED/REMOVED 行数=$(grep -cE '^(RESTORED|REMOVED) ' "$D/a4.log")"
[ "$A4" = 0 ] || { echo "   ❌ 克隆里的对照没绿"; tail -5 "$D/a4.log" | sed 's/^/      /'; fail=1; }
[ "$(grep -c '^OVERLAY ' "$D/a4.log")" = "$WANT_N" ] || { echo "   ❌ 克隆里 OVERLAY≠${WANT_N}"; fail=1; }
[ "$(grep -cE '^(RESTORED|REMOVED) ' "$D/a4.log")" = "$WANT_N" ] \
  || { echo "   ❌ 还原动作的枚数≠清单枚数（有的那枚没被还原 = 载体会一直脏着挡住下一次 checkout）"; fail=1; }
A4_BAD=0
while IFS=$'\t' read -r kind p h; do
  [ -n "$p" ] || continue
  case "$kind" in
    E) if [ ! -f "$CLONE/$p" ]; then
         echo "   ❌ 覆盖前存在的枚被还原成不存在：${p}（existed 标志位坏了）"; A4_BAD=1
       elif [ "$(md5of "$CLONE/$p")" != "$h" ]; then
         echo "   ❌ 覆盖前存在的枚没回到原字节：$p"; A4_BAD=1
       elif ! grep -q "^RESTORED ${p}" "$D/a4.log"; then
         echo "   ❌ 该枚走了还原动作却没打 RESTORED：$p"; A4_BAD=1
       fi ;;
    A) if [ -e "$CLONE/$p" ]; then
         echo "   ❌ 覆盖前不存在的枚没被 REMOVED：$p"; A4_BAD=1
       elif ! grep -q "^REMOVED ${p}" "$D/a4.log"; then
         echo "   ❌ 该枚被摘掉了却没打 REMOVED：$p"; A4_BAD=1
       fi ;;
  esac
done < "$BEFORE_A4"
[ "$A4_BAD" = 0 ] && echo "   ✅ 逐枚还原对得上跑之前的现量（E 枚回到原字节、A 枚摘干净）"
[ "$A4_BAD" = 0 ] || fail=1

[ "$fail" = 0 ] && echo "结论：第 0 步有牙（缺文件停 / 产品代码停且不动手 / 脏载体停并列出脏行 / 对照绿且逐枚还原）"
exit $fail
