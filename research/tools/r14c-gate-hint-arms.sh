#!/usr/bin/env bash
# 「下一步只列真红的那几条」这条改动的变异臂（交接 §5 第 3/4 条 B/C 那两格）。
#
# 为什么单独成臂而不是靠现场等：这条判据的内容是**建议清单与现场失败集对应**。
# 现场此刻只红两条（源码 + 并发重装），负载是绿的 ⇒ 只能证"绿的不打印"这一半；
# "红的那半真的会打印"要造得出红才能证，而设备门禁的红不能靠真把机器压满来造。
#
# 做法：把**真文件里那五行**用 sed 原样抽出来在子 shell 里跑，只换旗标。
# 🔴 抽原文而不是重写一遍 —— 重写一遍就变成"臂在测臂自己抄的那份"，
#    真文件改了而臂还绿，是这条线今天已经踩过三次的那个形状。
#
# 退出码：0 = 两臂各恰好命中预期的那条（且预期缺席的确实缺席）
#         4 = 探针坏了（抽不出那段原文 —— 文件被改写过形状，先修探针）
set -u
cd "$(dirname "$0")/../.." || exit 4

BEGIN='下一步（只列真红的这几条）：'
END='     · 重跑本脚本（不带 --confirm）确认全绿'
SRC=scripts/verify-mobile-window-gate.sh

BODY=$(awk -v b="$BEGIN" -v e="$END" 'index($0,b){f=1;next} f&&index($0,e){exit} f' "$SRC")
N=$(printf '%s\n' "$BODY" | grep -c 'WHY_')
if [ "$N" != 5 ]; then
  echo "❌ 探针坏了：从 $SRC 抽出 $N 行带 WHY_ 的建议行，预期 5 行（先读文件再动判据）" >&2
  exit 4
fi
echo "抽到 ${N} 行建议原文（来源：${SRC}）"

# 单臂：给定五个旗标，跑原文那段，把输出交回调用方
run_hint() {
  ( LOAD1=99; LIMIT=12
    WHY_LOAD=$1; WHY_SRC=$2; WHY_DEV=$3; WHY_CRED=$4; WHY_APK=$5
    echo "   下一步（只列真红的这几条）："
    eval "$BODY"
    echo "$END" )
}

# 🔴 每臂都要一条**正向命中** + 一条**反向缺席**：
#    只断正向，"五行无条件全打印"的退化版照样过（那是这条改动原本要修的缺陷）。
ARMS='load src dev apk'
FAIL=0
for a in $ARMS; do
  case "$a" in
    load) OUT=$(run_hint 1 0 0 0 0); WANT='等负载落回'; ABSENT='reinstall-all' ;;
    src)  OUT=$(run_hint 0 1 0 0 0); WANT='把上面列出的文件提交'; ABSENT='等负载落回' ;;
    dev)  OUT=$(run_hint 0 0 1 0 0); WANT='reinstall-all'; ABSENT='pnpm build:android' ;;
    apk)  OUT=$(run_hint 0 0 0 0 1); WANT='pnpm build:android'; ABSENT='等负载落回' ;;
  esac
  HIT=$(printf '%s\n' "$OUT" | grep -cF -- "$WANT")
  MISS=$(printf '%s\n' "$OUT" | grep -cF -- "$ABSENT")
  # 恒等式"命中 1 且缺席 0"才是臂的形状；任何一边不对就红
  if [ "$HIT" = 1 ] && [ "$MISS" = 0 ]; then
    echo "   ✅ 臂 ${a}：正向命中 1 / 反向缺席 0"
  else
    echo "   ❌ 臂 ${a}：正向命中 ${HIT}（要 1）/ 反向缺席 ${MISS}（要 0）"
    printf '%s\n' "$OUT" | sed 's/^/        /'
    FAIL=$((FAIL + 1))
  fi
done

# 全绿旗标（没有任何一条红）时，清单应当只剩"重跑"这一行 —— 那是今天现场的真实形状
OUT=$(run_hint 0 0 0 0 0)
EXTRA=$(printf '%s\n' "$OUT" | grep -cE '·')
if [ "$EXTRA" = 1 ]; then
  echo "   ✅ 臂 none：五旗标全 0 时只留收尾那一条（共 $EXTRA 行）"
else
  echo "   ❌ 臂 none：五旗标全 0 却打印 $EXTRA 条建议（要 1）⇒ 清单又变成无条件了"
  printf '%s\n' "$OUT" | sed 's/^/        /'
  FAIL=$((FAIL + 1))
fi

if [ "$FAIL" != 0 ]; then
  echo "❌ $FAIL 臂红"
  exit 1
fi
echo "✅ 五臂全过：清单与失败集一一对应（正向命中、反向缺席、全绿时只剩收尾）"
