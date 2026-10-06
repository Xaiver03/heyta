#!/bin/bash
# H12 第 ⑨ 条判据 `judge_shot_set` 的**臂台**（工单 H12 / 台账 §9.19）。
#
# 为什么单独有一枚臂台：这条判据管的是"这批证据图不许有重复采集"这个**集合命题**，
# 而它要挡的那次缺陷是**真实发生过**的 —— 上一趟 `4-checked` 与 `5-list-after-checkin`
# 同一秒、同一 md5，38 项全绿里没有一格会红。所以"红的那一臂"优先喂**真实产出的那九张**
# （归档在 `~/.heyta-window-rigs/h12-green-round3/`），归档不在时才退到合成夹具。
#
# 🔴 臂 6/7 是 07 03:1x 人逐张看图之后加的：那条判据原先写成"九张各自是不同的一屏"，
#    而 `5-list-after-checkin` ↔ `6-list-after-restart`（⑥ 重启前后）**按设计就应当同屏** ——
#    那两张的字节差只是状态栏时钟 3:08→3:09。口径过强 = 同一分钟内完成重启就会假红，
#    所以豁免按**具体的一对**写。臂 6 证明豁免生效（该绿），臂 7 证明它不是"允许重复"的
#    口子（豁免对之外再撞一对 ⇒ 该红）。
#
# 只喂真实函数文本：`awk '/^judge_shot_set\(\)/,/^}/'` 从被测脚本里抽出来 eval，
# 不复制第二份实现（复制的那份红了不代表真判据会红）。
#
# 跑法（仓库根）：bash scripts/h12-shot-set-arms.sh
# 末行 `ARMS=n FAILS=m` 由本脚本自己数，**不要抄进任何文档**。
set -u
ROOT="${1:-$PWD}"
cd "$ROOT" || exit 1
CARRIER_DIR="$HOME/.heyta-window-rigs/h12-green-round3"

eval "$(grep -E '^SHOT_EQUIV_[AB]=' scripts/verify-mobile-habits.sh)"
eval "$(awk '/^judge_shot_set\(\)/,/^}/' scripts/verify-mobile-habits.sh)"
type judge_shot_set >/dev/null 2>&1 || { echo "被测函数没抽出来（scripts/verify-mobile-habits.sh 里找不到 judge_shot_set）"; exit 1; }

WORK=$(mktemp -d)
FAILS=0
trap 'rm -rf -- "$WORK"' EXIT
FAILS_TOTAL=0
ARMS=0

bad() { echo "   ❌ $*"; FAILS=$((FAILS + 1)); }
ok() { echo "   ✅ $*"; }

arm() {  # <名字> <期望 red|green> <账单...>
  local name=$1 want=$2 out rc
  shift 2
  ARMS=$((ARMS + 1))
  SHOT_FILES=$(printf '%s\n' "$@")
  echo "── $name（期望 $want）──"
  out=$(judge_shot_set 2>&1); rc=$?
  printf '%s\n' "$out"
  if [ "$want" = "red" ] && [ "$rc" -eq 0 ]; then
    echo "   ⚠️ 这一臂该红却没红 ⇒ 判据没有牙"; FAILS_TOTAL=$((FAILS_TOTAL + 1))
  elif [ "$want" = "green" ] && [ "$rc" -ne 0 ]; then
    echo "   ⚠️ 这一臂该绿却红了"; FAILS_TOTAL=$((FAILS_TOTAL + 1))
  fi
}

# ── 臂 1：真实缺陷的那九张（上一趟真产出的图）──
if ls "$CARRIER_DIR"/android-habits-*.png >/dev/null 2>&1; then
  arm "臂 1 真实缺陷：上一趟归档的那九张" red "$CARRIER_DIR"/android-habits-*.png
else
  echo "── 臂 1 跳过：归档 $CARRIER_DIR 不在了（改跑臂 2 的合成夹具）──"
fi

# ── 臂 2：合成重复（同一份字节挂两个名字）──
cp apps/mobile/evidence/android-habits-1-empty.png "$WORK/a.png"
cp apps/mobile/evidence/android-habits-1-empty.png "$WORK/b.png"
cp apps/mobile/evidence/android-habits-2-list.png "$WORK/c.png"
cp apps/mobile/evidence/android-habits-3-detail.png "$WORK/d.png"
arm "臂 2 合成重复：a/b 同一份字节" red "$WORK/a.png" "$WORK/b.png" "$WORK/c.png"

# ── 臂 3：阳性对照（同一批去掉重复的那一张）──
arm "臂 3 阳性对照：三张各不同" green "$WORK/a.png" "$WORK/c.png" "$WORK/d.png"

# ── 臂 4：空账单 ──
arm "臂 4 空账单：一张都没入账" red ""

# ── 臂 5：探针坏了（PATH 上没有 python3 ⇒ 必须响亮失败，不能当通过）──
mkdir -p "$WORK/nopython"
ARMS=$((ARMS + 1))
FAILS=0
echo "── 臂 5 探针坏了：PATH 上没有 python3（期望 red）──"
( PATH="$WORK/nopython"; SHOT_FILES="$WORK/c.png"; judge_shot_set )
if [ $? -eq 0 ]; then echo "   ⚠️ 探针坏了却被当成通过 ⇒ 判据没有牙"; FAILS_TOTAL=$((FAILS_TOTAL + 1)); fi

# ── 臂 6：豁免对逐字节相同 ⇒ 该绿（⑥ 重启前后按设计同屏，不能报成重复交证据）──
# 🔴 夹具的两个坑，都是这一臂第一版踩到的：
#    ① 两臂各用**自己的目录**，且不能拿和别的臂同字节的那份当来源 ——
#       `c.png` 就是 `2-list.png` 的副本，拿它当豁免对的来源会让"豁免对 + c"撞成一组三个，
#       于是这一臂测的不再是豁免，红得毫无道理。
#    ② 豁免成员 A 的文件名**就是** `5-list-after-checkin`，所以臂 7 里"再造一对缺陷"
#       不许复用这个名字（复用 = 同一个路径进账单两次 + 后一次 cp 覆盖前一次）。
mkdir -p "$WORK/p6" "$WORK/p7"
cp apps/mobile/evidence/android-habits-2-list.png "$WORK/p6/android-habits-$SHOT_EQUIV_A.png"
cp apps/mobile/evidence/android-habits-2-list.png "$WORK/p6/android-habits-$SHOT_EQUIV_B.png"
arm "臂 6 豁免对相同：$SHOT_EQUIV_A ↔ $SHOT_EQUIV_B 同一份字节" green \
  "$WORK/p6/android-habits-$SHOT_EQUIV_A.png" "$WORK/p6/android-habits-$SHOT_EQUIV_B.png" \
  "$WORK/a.png" "$WORK/d.png"

# ── 臂 7：豁免对**之外**再撞一张 ⇒ 该红（豁免不是"允许重复"的口子）──
# 形状取的是真实发生过的那一种：4-checked / 5 / 6 三张同一份字节（两张之间没有导航），
# 豁免规则只认"恰好 A 与 B 这一对"，多进来一张就不满足 all() ⇒ 整组入账。
cp apps/mobile/evidence/android-habits-3-detail.png "$WORK/p7/android-habits-4-checked.png"
cp apps/mobile/evidence/android-habits-3-detail.png "$WORK/p7/android-habits-$SHOT_EQUIV_A.png"
cp apps/mobile/evidence/android-habits-3-detail.png "$WORK/p7/android-habits-$SHOT_EQUIV_B.png"
cp apps/mobile/evidence/android-habits-1-empty.png "$WORK/p7/other.png"
arm "臂 7 豁免对 + 4-checked 三张同字节" red \
  "$WORK/p7/android-habits-$SHOT_EQUIV_A.png" "$WORK/p7/android-habits-$SHOT_EQUIV_B.png" \
  "$WORK/p7/android-habits-4-checked.png" "$WORK/p7/other.png"

echo "════ ARMS=$ARMS FAILS=$FAILS_TOTAL ════"
[ "$FAILS_TOTAL" -eq 0 ] && exit 0 || exit 1
