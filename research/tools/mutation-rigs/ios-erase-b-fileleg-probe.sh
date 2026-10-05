#!/usr/bin/env bash
# #90 的答案装置：iOS 判据 B 的**文件腿**到底"能不能红"，以及它在 401 那枚变异下为什么红不了。
#
# 背景（计划 §10.155）：把"任何 HTTP 错误都算账号已注销"装进真机产物后，B 的读数是分岔的 ——
# 数据腿转红（ops 1 ⇒ 0），文件腿仍然绿（`heyta.sqlite` 确实在盘上）。
# 原因是 #87：销毁之后一次普通读会把**空壳**建回来 ⇒ "删库 → 重开空壳"与"什么都没发生"
# 在"文件在不在"这一尺上**逐字同形**。
# ⇒ 于是有一个必须分开回答的问题：**这条腿是坏探针（恒绿），还是好探针问不到这一枚？**
#   两种形状的处置完全不同：前者要修探针，后者要修产品（#87）。
#   只凭"变异下它没红"分不出这两件事，所以这台装置把腿拿到**盘上**去量。
#
# 五腿（每腿一个独立进程；判据本体从真身逐字抽，不在这里重写第二套）：
#  L1 库文件在（路径/库名都按真身的拼法）      ⇒ 绿（现状形状）
#  L2 库文件被 unlink（目录还在）              ⇒ 🔴 红  ← 承重：这条证明它**不是恒绿装置**
#  L3 只剩 `-wal` / `-shm` 旁挂，主文件不在    ⇒ 🔴 红  ← 挡"把旁挂算成库还在"那一侧的假绿
#  L4 同目录只有 `heyta-device-prefs.sqlite`   ⇒ 🔴 红  ← 证明它认的是**整串库名**，不是词干 `heyta`
#                                                            （§10.68.6：按词干数会每趟假红，方向相反）
#  L5 同一把尺量两格：ops 有 1 行 vs ops 0 行的空壳 ⇒ 两格**都绿** ⇒ 打印"这一枚问不到"
#     这一腿断言的是"必须分不开"——分开即装置失效（说明文件腿意外获得了分辨内容的能力，与实测矛盾）。
#
# 🔴 装置纪律（traps #277 / #283 同族）：
#    抽段落成一次性脚本文件（bash 3.2 不许 `$( … case )`）；提取必须非空且含锚点行，否则**不作数**；
#    `ok`/`bad` 桩照 lib 的字面形状打（`✅ ` / `🔴 `），否则 needles 会数出假的 0；
#    每腿的计数现量（各自的 `grep -c`），且**先判这趟跑没跑**（腿计数全 0 ⇒ 没跑，不算结论）。
set -uo pipefail
_d=$(cd "$(dirname "$0")" && pwd)
while [ "$_d" != "/" ] && [ ! -d "$_d/.git" ]; do _d=$(dirname "$_d"); done
[ -d "$_d/.git" ] || { echo "ROOT=NOT-FOUND（从 $0 往上没找到 .git ⇒ 这台装置不在仓库里，读数不作数）"; exit 1; }
cd "$_d" || exit 1

SRC=${SRC:-scripts/verify-mobile-ios-account-erasure.sh}
DB_NAME=heyta.sqlite
LIB_NAME=heyta-device-prefs.sqlite

[ -f "$SRC" ] || { echo "SRC=MISSING（读不到 ${SRC} ⇒ 没有真身可抽，读数不作数）"; exit 1; }

PRED=$(awk '/^db_present\(\)/{print; exit}' "$SRC")
# 🔴 抽**一个 if 块**时，"停在哪"必须是**第一个 `fi`**，不能写成 `(else)?` 这种看着像锚点的正则。
#    上一版的退出条件 `f&&/^(else)?$/&&NR>0&&/^fi$/` 里 `(else)?` 恒等于"任何行都行"，
#    而 `&&/^fi$/` 与它同时成立的机会只有一次，实测：抽出来的是 **188 行**（一直到文件尾），
#    于是载具里混进了后面的 `$UDID` ⇒ `set -u` 当场炸 ⇒ **每条腿的 rc 都是崩溃码 1**，
#    连库在盘上那一腿（本该 rc=0）也一样 ⇒ 这台装置自己就变成了"恒红"，而红的原因是它崩，不是判据。
BLOCK=$(awk '/^if db_present; then$/{f=1} f{print} f&&/^fi$/{exit}' "$SRC")
[ -n "$PRED" ] || { echo "EXTRACT=PRED-EMPTY（${SRC} 里没有以 db_present() 开头的行 ⇒ 锚点漂了）"; exit 1; }
[ -n "$BLOCK" ] || { echo "EXTRACT=BLOCK-EMPTY（没抽到 B 文件腿那段 ⇒ 锚点漂了）"; exit 1; }
BLOCK_LINES=$(printf '%s\n' "$BLOCK" | grep -c '')
[ "$BLOCK_LINES" -le 12 ] || { echo "EXTRACT=BLOCK-TOO-BIG（抽到 ${BLOCK_LINES} 行，B 文件腿那段只有 5 行 ⇒ 锚点没接住，载具里混进了别的执行阶段）"; exit 1; }
MISSING_NEEDLE=0
for n in '判据 B（文件腿）成立' '判据 B 红'; do
  printf '%s\n' "$BLOCK" | grep -q "$n" || MISSING_NEEDLE=$((MISSING_NEEDLE + 1))
done
if [ "$MISSING_NEEDLE" != "0" ]; then
  echo "EXTRACT=NEEDLE-MISMATCH（抽到 ${BLOCK_LINES} 行但缺 ${MISSING_NEEDLE} 条 needles ⇒ 取到的是别的块，读数不作数）"; exit 1
fi
echo "   抽到判据本体：谓词 1 行 + 判据块 ${BLOCK_LINES} 行（含绿/红两条字面 needles；真身：${SRC}）"

BODY=$(mktemp /tmp/b90-body.sh.XXXXXX)
RUNLOG=$(mktemp /tmp/b90-runlog.txt.XXXXXX)
trap 'rm -f "$BODY" "$RUNLOG"' EXIT
: > "$RUNLOG"
{
  echo '#!/usr/bin/env bash'
  echo 'set -uo pipefail'
  echo 'DB_NAME=heyta.sqlite'
  echo 'FAIL=0'
  # 桩的打印形状**照 lib 逐字抄**（`scripts/lib/mobile-e2e.sh:149-150`：`   ✅ ` / `   ❌ `）。
  # 上一版自己拼了个 `printf "✅ %s\n"`，把 lib 的前导三空格和 ❌ 换成 🔴 ⇒ needles 数出来的是桩的形状，
  # 不是真身的形状（traps #277：桩的形状必须是被测形状，否则"命中"只证明桩在）。
  echo 'ok()  { printf "   ✅ %s\n" "$1"; }'
  echo 'bad() { printf "   ❌ %s\n" "$1"; FAIL=$((FAIL + 1)); }'
  printf '%s\n' "$PRED"
  printf '%s\n' "$BLOCK"
  echo 'exit "$FAIL"'
} > "$BODY"

FAILS=0
run_leg() { # 在**当前** $DC 状态下跑一次判据本体；输出同时进日志（日志用来做"跑没跑"的分母）
  OUT=$(DATA_CONTAINER="$DC" bash "$BODY" 2>&1); RC=$?
  printf '%s\n' "$OUT" >> "$RUNLOG"
}
expect() { # $1=腿名 $2=期望码 $3=期望串 $4=实际码 $5=实际输出
  local n=$1 c=$2 t=$3 rc=$4 out=$5
  if printf '%s\n' "$out" | grep -q "$t" && [ "$rc" = "$c" ]; then
    echo "   ✓ ${n} ⇒ rc=${rc} 命中「${t}」"
    printf '%s\n' "$out" | grep -E '^   (✅|❌)' | sed 's/^/        /'
  else
    echo "   ✗ ${n} ⇒ rc=${rc}（期望 ${c}）；输出里找不到「${t}」"
    printf '%s\n' "$out" | sed 's/^/        /'
    FAILS=$((FAILS + 1))
  fi
}

ROOT=$(mktemp -d /tmp/b90-XXXXXX)

# ---- L1：库文件在 ⇒ 绿
DC="$ROOT/L1"; mkdir -p "$DC/Library"; : > "$DC/Library/$DB_NAME"
run_leg; expect "L1 库在 ⇒ 绿" 0 "判据 B（文件腿）成立" "$RC" "$OUT"

# ---- L2：库文件被 unlink ⇒ 必须红（承重腿：这条决定它是"坏探针"还是"问不到"）
DC="$ROOT/L2"; mkdir -p "$DC/Library"; : > "$DC/Library/$DB_NAME"; rm -f "$DC/Library/$DB_NAME"
run_leg; expect "L2 库被 unlink ⇒ 红" 1 "判据 B 红" "$RC" "$OUT"

# ---- L3：只剩旁挂 ⇒ 必须红（挡"把 -wal 算成库还在"）
DC="$ROOT/L3"; mkdir -p "$DC/Library"; : > "$DC/Library/$DB_NAME-wal"; : > "$DC/Library/$DB_NAME-shm"
run_leg; expect "L3 只剩 -wal/-shm ⇒ 红" 1 "判据 B 红" "$RC" "$OUT"

# ---- L4：同目录只有不归 destroy 管的那枚库 ⇒ 必须红（认整串库名，不认词干）
DC="$ROOT/L4"; mkdir -p "$DC/Library"; : > "$DC/Library/$LIB_NAME"
run_leg; expect "L4 只有 heyta-device-prefs.sqlite ⇒ 红" 1 "判据 B 红" "$RC" "$OUT"

# ---- L5：同一把尺量两格（有内容的库 vs 重建的空壳）⇒ 两格都必须绿 ⇒ 文件腿分不开这两种结局
DC="$ROOT/L5a"; mkdir -p "$DC/Library"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DC/Library/$DB_NAME" "CREATE TABLE ops(k TEXT);" "INSERT INTO ops VALUES('one');" >/dev/null 2>&1
else
  : > "$DC/Library/$DB_NAME"
fi
OUT_A=$(DATA_CONTAINER="$DC" bash "$BODY" 2>&1); RC_A=$?
printf '%s\n' "$OUT_A" >> "$RUNLOG"
OPS_A=$(sqlite3 "$DC/Library/$DB_NAME" "SELECT COUNT(*) FROM ops;" 2>/dev/null | tr -d ' ')
DC="$ROOT/L5b"; mkdir -p "$DC/Library"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DC/Library/$DB_NAME" "CREATE TABLE ops(k TEXT);" >/dev/null 2>&1
else
  : > "$DC/Library/$DB_NAME"
fi
OUT_B=$(DATA_CONTAINER="$DC" bash "$BODY" 2>&1); RC_B=$?
printf '%s\n' "$OUT_B" >> "$RUNLOG"
OPS_B=$(sqlite3 "$DC/Library/$DB_NAME" "SELECT COUNT(*) FROM ops;" 2>/dev/null | tr -d ' ')
echo "   L5 现场：A 格 ops=${OPS_A:-读不到}，B 格 ops=${OPS_B:-读不到}（A=有内容，B=销毁后重开的空壳）"
if [ "$RC_A" = "0" ] && [ "$RC_B" = "0" ] && [ "$OPS_A" != "$OPS_B" ]; then
  echo "   ✓ L5 ⇒ 两格**都绿**而内容差了一行（${OPS_A} vs ${OPS_B}）⇒ 这一枚问不到，牙齿在数据腿"
  echo "        结构性结论：文件腿是好的（L2/L3/L4 都能红），但『删库 → 重开空壳』在它这把尺上与『什么都没发生』同形。"
  echo "        ⇒ 恒绿那一格记在 #87（要产品拍板），本装置不替它签字。"
else
  echo "   ✗ L5 ⇒ A rc=$RC_A / B rc=$RC_B / ops ${OPS_A:-?} vs ${OPS_B:-?}（期望：两格都 0 且行数不等）"
  printf '%s\n' "$OUT_A" | sed 's/^/        A /'
  printf '%s\n' "$OUT_B" | sed 's/^/        B /'
  FAILS=$((FAILS + 1))
fi

# ---- 先判"这趟跑没跑"，再判红没红（traps：环境拒绝时所有计数天然为 0，照字面读就是"一条都没红"）
# 分母是**现量的腿数**：L1..L4 各 1 行判据 + L5 的 A/B 两格各 1 行 = 6 行。
TOTAL=$(grep -cE '^   (✅|❌)' "$RUNLOG")
echo "   判据行数=${TOTAL}（期望 6：L1-L4 各一条 + L5 的 A/B 两格各一条；抽自 ${RUNLOG}）"
if [ "$TOTAL" = "0" ]; then
  echo "FILELEG=NO-RUN（一条判据行都没打出来 ⇒ 不是『能红/恒绿』的结论，先修这台装置）"; exit 3
fi
if [ "$TOTAL" != "6" ]; then
  echo "FILELEG=PARTIAL（打了 ${TOTAL}/6 条 ⇒ 有腿没走到被测判据，这一趟的读数不完整，不拿它当结论）"; exit 3
fi

if [ "$FAILS" = "0" ]; then
  echo "FILELEG=RIGID（5/5：L2/L3/L4 各红一次 ⇒ 这条腿不是恒绿装置；L5 两格同绿 ⇒ 401 那一枚它问不到）"
  exit 0
fi
echo "FILELEG=FAIL（$FAILS 腿不符 —— 若 L2 不红，那是探针坏了，不是产品没事）"
exit 1
