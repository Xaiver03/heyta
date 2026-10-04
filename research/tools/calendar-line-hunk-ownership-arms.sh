#!/usr/bin/env bash
# `calendar-line-hunk-ownership.sh` 的十三臂验证台（§4.05 (25) 那笔事故的牙）。
#
# 为什么必须有它：那道闸门是**加在提交路径上的**，它如果只能证明「会绿」，
# 就等于给 A 那条加了一枚永远通过的判据 —— 本仓库的规矩是「不能失败的检查没有价值」。
# J 臂是那把刀：把锚点匹配那一步摘掉，无锚点的 hunk 必须**从红变绿**；
# 若摘掉匹配它仍然红，拦住它的就是别的东西，归属判据其实是装饰。
#
# K 臂用的是 `9de0e545` 里那枚**真事故 hunk** 的原文（从 git 现取，不手抄）。
# L/M 臂钉住"删除也算归属"这条语义：删掉我申报过的东西 = 有归属，删掉别人的 = 孤儿。
#
# 🔴 夹具一律「按行替换 / 按行删除」，不整份重写：整份重写会把后面 8 行变成**纯删除 hunk**，
#    第一次跑就在 A 臂造出一枚假红（验证台自己造红比被测方造红更贵 —— 它会让人以为判据坏了）。
#
# 用法：bash research/tools/calendar-line-hunk-ownership-arms.sh
set -u
cd "$(dirname "$0")/../.." || exit 1
TOOL=research/tools/calendar-line-hunk-ownership.sh
FIX=$(mktemp -d /tmp/ht-hunk-ownership.XXXXXX)
# 🔴 这里**不许**写 `rm -f -- "$0"`：本脚本没有快照自举，$0 就是仓库里那枚真文件，
#    写了就等于每跑一次把自己删一遍。
trap 'rm -rf -- "$FIX"' EXIT

PASS=0; FAIL=0
ok() { PASS=$(( PASS + 1 )); echo "  ✅ $1"; }
no() { FAIL=$(( FAIL + 1 )); echo "  ❌ $1"; }

mk_repo() {
  rm -rf "$FIX/repo" "$FIX/home"; mkdir -p "$FIX/repo" "$FIX/home"
  ( cd "$FIX/repo"
    export HOME="$FIX/home"           # 不继承全局 hooksPath / user 配置
    git init -q .
    git config user.email rig@local; git config user.name rig
    printf 'A1\nB1\nC1\nD1\nE1\nF1\nG1\nH1\nI1\nJ1\nK1\n' > f.sh
    git add -A; git commit -q -m base )
}
patch_line() {
  local n="$1"; shift
  awk -v n="$n" -v t="$*" 'NR==n{print t; next} {print}' "$FIX/repo/f.sh" > "$FIX/repo/.f" && mv "$FIX/repo/.f" "$FIX/repo/f.sh"
}
del_line() {
  local n="$1"
  awk -v n="$n" 'NR==n{next} {print}' "$FIX/repo/f.sh" > "$FIX/repo/.f" && mv "$FIX/repo/.f" "$FIX/repo/f.sh"
}

# run <锚点> <ALLOW_ORPHAN> <路径…>
run() {
  local anchors="$1" allow="$2"; shift 2
  ( cd "$FIX/repo" && export HOME="$FIX/home" \
    && ANCHORS="$anchors" ALLOW_ORPHAN="$allow" bash "$FIX/tool" "$@" ) 2>&1
}

cp "$TOOL" "$FIX/tool"   # 拷进 FIX：J 臂的变异只改副本，绝不碰真文件

MINE='stack_down ask_gate 9de0e545'

# ── A：我的 hunk（含锚点）⇒ 有归属、rc 0 ────────────────────────────────
mk_repo; patch_line 6 'MINE stack_down 一枚新函数'
OUT=$(run "$MINE" 0 f.sh); RC=$?
if [ "$RC" = 0 ] && printf '%s\n' "$OUT" | grep -q 'hunk 1 枚，有归属 1 枚，孤儿 0 枚'; then
  ok "A 有锚点的 hunk ⇒ rc=0 且计入有归属（1/1/0）"
else no "A rc=${RC}：$(printf '%s\n' "$OUT" | tail -2)"; fi

# ── B：别人的 hunk（无锚点）⇒ 孤儿、rc 1 ────────────────────────────────
mk_repo; patch_line 6 'trap 里加了 rm 快照自删 trash-and-archive'
OUT=$(run "$MINE" 0 f.sh); RC=$?
if [ "$RC" = 1 ] && printf '%s\n' "$OUT" | grep -q '孤儿 hunk'; then
  ok "B 无锚点的 hunk ⇒ rc=1 且点名孤儿"
else no "B rc=${RC}：$(printf '%s\n' "$OUT" | tail -2)"; fi

# ── C：混着两枚 hunk ⇒ 逐枚判，只认下孤儿那一枚 ────────────────────────
mk_repo; patch_line 2 'MINE ask_gate 改了这里'; patch_line 10 '别人的东西 trash-and-archive'
OUT=$(run "$MINE" 0 f.sh); RC=$?
if [ "$RC" = 1 ] && printf '%s\n' "$OUT" | grep -q 'hunk 2 枚，有归属 1 枚，孤儿 1 枚'; then
  ok "C 两枚 hunk（一枚我的一枚别人的）⇒ 计数 2/1/1，不是整文件一票"
else no "C rc=${RC}：$(printf '%s\n' "$OUT" | tail -3)"; fi

# ── D：ALLOW_ORPHAN=1 放行，但必须大字留痕 ─────────────────────────────
mk_repo; patch_line 6 '别人的东西 trash-and-archive'
OUT=$(run "$MINE" 1 f.sh); RC=$?
if [ "$RC" = 0 ] && printf '%s\n' "$OUT" | grep -q 'ALLOW_ORPHAN=1'; then
  ok "D 放行腿 rc=0 且留下「不是这一轮写的」警告"
else no "D rc=${RC}：$(printf '%s\n' "$OUT" | tail -2)"; fi

# ── E：缺锚点 ⇒ 必须 rc=1，不能退化成「全部有归属」─────────────────────
mk_repo; patch_line 6 '随便改一行'
OUT=$(run "" 0 f.sh); RC=$?
if [ "$RC" = 1 ] && printf '%s\n' "$OUT" | grep -q '永远绿的装饰'; then
  ok "E 缺锚点 ⇒ rc=1（探针瞎了要响，不许静默判绿）"
else no "E rc=${RC}：$(printf '%s\n' "$OUT" | tail -2)"; fi

# ── F：锚点全是空白 ⇒ 切出 0 枚也要 rc=1 ───────────────────────────────
OUT=$(run "   " 0 f.sh); RC=$?
if [ "$RC" = 1 ] && printf '%s\n' "$OUT" | grep -q '切出 0 枚'; then
  ok "F 空白锚点 ⇒ rc=1，而不是「零枚锚点、每枚都命中」"
else no "F rc=${RC}：$(printf '%s\n' "$OUT" | tail -2)"; fi

# ── G：文件干净（零 hunk）⇒ rc=0 且明说「不带 hunk」────────────────────
mk_repo
OUT=$(run "$MINE" 0 f.sh); RC=$?
if [ "$RC" = 0 ] && printf '%s\n' "$OUT" | grep -q '无新增行'; then
  ok "G 无改动 ⇒ rc=0 且报「不带 hunk」（不是「全部有归属」那种空集话术）"
else no "G rc=${RC}：$(printf '%s\n' "$OUT" | tail -2)"; fi

# ── H：未跟踪的新文件（`git diff HEAD` 看不见它，走 --no-index 那一腿）──
mk_repo; printf '新文件里有 stack_down 这个名字\n' > "$FIX/repo/new.sh"
OUT=$(run "$MINE" 0 new.sh); RC=$?
if [ "$RC" = 0 ] && printf '%s\n' "$OUT" | grep -q '孤儿 0 枚'; then
  ok "H1 未跟踪新文件带锚点 ⇒ 被量到且有归属"
else no "H1 rc=${RC}：$(printf '%s\n' "$OUT" | tail -2)"; fi
mk_repo; printf '新文件里谁都不是我的\n' > "$FIX/repo/new.sh"
OUT=$(run "$MINE" 0 new.sh); RC=$?
if [ "$RC" = 1 ] && printf '%s\n' "$OUT" | grep -q '孤儿 hunk'; then
  ok "H2 未跟踪新文件不带锚点 ⇒ rc=1（这条腿不是空跑）"
else no "H2 rc=${RC}：$(printf '%s\n' "$OUT" | tail -2)"; fi

# ── I：路径不存在 ⇒ rc=1，不许「跳过这一枚」────────────────────────────
mk_repo
OUT=$(run "$MINE" 0 没有这个文件.sh); RC=$?
if [ "$RC" = 1 ] && printf '%s\n' "$OUT" | grep -q '路径不存在'; then
  ok "I 路径不存在 ⇒ rc=1（判不了就响）"
else no "I rc=${RC}：$(printf '%s\n' "$OUT" | tail -2)"; fi

# ── J 变异：摘掉锚点匹配 ⇒ B 那枚必须从红变绿 ──────────────────────────
cp "$TOOL" "$FIX/tool_mut"
python3 - "$FIX/tool_mut" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = "    if printf '%s\\n' \"$1\" | grep -qF -- \"${_a}\"; then"
assert s.count(old) == 1, "匹配行形状变了（命中 %d 处）" % s.count(old)
open(p, 'w', encoding='utf-8').write(s.replace(old, "    if : ; then"))
PY
mk_repo; patch_line 6 '别人的东西 trash-and-archive'
OUT=$(run "$MINE" 0 f.sh); RC_OK=$?   # 真工具在此必须是红，否则 J 的比较没有基准
OUT=$( cd "$FIX/repo" && export HOME="$FIX/home" && ANCHORS="$MINE" ALLOW_ORPHAN=0 bash "$FIX/tool_mut" f.sh 2>&1 ); RC=$?
if [ "$RC_OK" = 1 ] && [ "$RC" = 0 ] && printf '%s\n' "$OUT" | grep -q '每一枚 hunk 都能指认'; then
  ok "J 摘掉锚点匹配 ⇒ 同一枚无锚点 hunk 由红转绿（牙确实长在 grep 那一行；基准腿 rc=1 也当场量了）"
else no "J 基准 rc=${RC_OK} / 变异 rc=${RC} —— B 的红不来自锚点匹配，归属判据是装饰：$(printf '%s\n' "$OUT" | tail -2)"; fi

# ── K：真事故原文（从 git 现取，不手抄）必须被判成孤儿 ──────────────────
REAL=$(git show 9de0e545 -- scripts/verify-mobile-due-time.sh 2>/dev/null | grep '^+' | grep -v '^+++' | sed 's/^+//' | head -4)
NREAL=$(printf '%s\n' "$REAL" | grep -c . || true)
if [ "${NREAL:-0}" -lt 1 ]; then
  no "K 取不到 9de0e545 的新增行（探针瞎了，这条不算过）"
else
  mk_repo
  { printf 'A1\n'; printf '%s\n' "$REAL"; printf 'C1\n'; } > "$FIX/repo/f.sh"
  OUT=$(run "$MINE" 0 f.sh); RC=$?
  if [ "$RC" = 1 ] && printf '%s\n' "$OUT" | grep -q '孤儿 hunk'; then
    ok "K 那笔事故真实的 $NREAL 行新增（含它引用的那条别的线的计划）被判成孤儿 ⇒ 同一形状当场就会被拦"
  else no "K rc=${RC} —— 真事故没被抓住：$(printf '%s\n' "$OUT" | tail -3)"; fi
fi

# ── L：纯删除，但删的是我申报过的东西 ⇒ 有归属 ─────────────────────────
# 🔴 这一臂就是"删除行也进匹配集"那条语义的理由：只认新增行的话，`我删掉 D1` 这枚 hunk
#    一个字都没有，会被判成孤儿 —— 而纯删除是日常改动。
mk_repo; del_line 4
OUT=$(run "$MINE D1" 0 f.sh); RC=$?
if [ "$RC" = 0 ] && printf '%s\n' "$OUT" | grep -q '有归属 1 枚'; then
  ok "L 删掉申报过的 D1 ⇒ 有归属（删除行参与匹配，不是只看新增行）"
else no "L rc=${RC}：$(printf '%s\n' "$OUT" | tail -2)"; fi

# ── M：纯删除别人的东西 ⇒ 孤儿（这一手挡住"别人删一行被我一起带走"）─────
mk_repo; del_line 4
OUT=$(run "$MINE" 0 f.sh); RC=$?
if [ "$RC" = 1 ] && printf '%s\n' "$OUT" | grep -q '孤儿 hunk'; then
  ok "M 删掉没申报的 D1 ⇒ rc=1（删除同样是归属问题，不是只防新增）"
else no "M rc=${RC}：$(printf '%s\n' "$OUT" | tail -2)"; fi

echo "hunk-ownership 臂：pass=$PASS fail=$FAIL"
[ "$FAIL" = 0 ] || exit 1
