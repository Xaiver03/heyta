#!/bin/bash
# H12 第 ⑨ 条判据 `judge_shot_set` 的**臂台**（工单 H12 / 台账 §9.19）。
#
# 为什么单独有一枚臂台：这条判据管的是"这批证据图各是一屏"这个**集合命题**，
# 而它要挡的那次缺陷是**真实发生过**的 —— 上一趟 `4-checked` 与 `5-list-after-checkin`
# 同一秒、同一 md5，38 项全绿里没有一格会红。所以"红的那一臂"优先喂**真实产出的那九张**
# （归档在 `~/.heyta-window-rigs/h12-green-round3/`），归档不在时才退到合成夹具。
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

echo "════ ARMS=$ARMS FAILS=$FAILS_TOTAL ════"
[ "$FAILS_TOTAL" -eq 0 ] && exit 0 || exit 1
