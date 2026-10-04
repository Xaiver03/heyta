#!/usr/bin/env bash
# C 那条真机腿的**产物内容**预检：APK 里的 JS bundle 到底带不带那两枚 testID 的拼装碎片。
#
# 为什么不是"看 mtime"就够了：窗口闸门 §4 现在那条绿的是
# `APK mtime ≥ 最新源码 mtime`，而 mtime 只证"打的时间在后面"，不证"里面确实有这次判据的选择器"。
# 本线踩过的正是这一族（§7 #27：packages/ 改了、APK 里是旧 bundle 而一切判据全绿）。
#
# 🔴 为什么不直接 grep 拼装后的整串 `task-due-time-input`：那是**假阴性**（traps 待入 #190 那一族）。
#    真实源码里它是拼出来的 —— `TaskDetailSheet.tsx` 给 base `task-due`，
#    `packages/ui/src/date-picker/DatePicker.tsx:346/370` 给后缀 `-time-input` / `-time-all-day`。
#    所以这里判的是**三个碎片同时在场** + 一枚**不该在场的负对照**必须 0 命中，
#    负对照不为 0 就说明探针坏了（比如 bundle 根本没解出来），而不是"产物有问题"。
#
# 退出码：0 = 三枚碎片都在、负对照缺席 ⇒ 这份产物**能**跑出 C 的四层判据
#         1 = 有碎片不在场 ⇒ 这份 APK 带不了这次判据（先重打，别开设备窗口）
#         2 = 用法/输入不成立（APK 不存在、bundle 解不出、缺参数）
#         3 = 探针失效（负对照命中 = 什么都"命中"，读数不可信）
#
# 用法：
#   bash research/tools/r14c-bundle-testid-preflight.sh                      # 用默认 release APK
#   APK=… bash research/tools/r14c-bundle-testid-preflight.sh
#   NEEDLE_MISSING=task-due bash research/tools/r14c-bundle-testid-preflight.sh   # 自检：这一枚必须让它 exit 1
set -u
cd "$(dirname "$0")/../.." || exit 2

APK="${APK:-apps/mobile/android/app/build/outputs/apk/release/app-release.apk}"
BUNDLE_ENTRY="${BUNDLE_ENTRY:-assets/index.android.bundle}"

# 拼装三碎片（base + 两个后缀）。允许环境覆盖，用于自检与变异。
FRAGMENTS_DEFAULT=("task-due" "-time-input" "-time-all-day")
if [ -n "${FRAGMENTS:-}" ]; then
  IFS='|' read -r -a FRAGMENTS_ARR <<<"$FRAGMENTS"
else
  FRAGMENTS_ARR=("${FRAGMENTS_DEFAULT[@]}")
fi
# 负对照：一个**绝不该**出现在产物里的串。它命中 = 探针在"什么都命中"。
NEG="${NEG_CONTROL:-task-due-time-inputZZz}"

if [ ! -f "$APK" ]; then
  echo "❌ APK 不存在：$APK" >&2
  exit 2
fi

TAG="ht-r14c-preflight.$(date +%Y%m%d-%H%M%S).$$"
BUNDLE="/tmp/$TAG.bundle"
trap 'rm -f "$BUNDLE"' EXIT

BYTES=$(unzip -p "$APK" "$BUNDLE_ENTRY" 2>/dev/null | wc -c | tr -d ' ')
if [ "${BYTES:-0}" -lt 100000 ]; then
  echo "❌ 从 $APK 解不出 ${BUNDLE_ENTRY}（拿到 $BYTES 字节）—— 输入不成立，不是判据红。" >&2
  exit 2
fi
unzip -p "$APK" "$BUNDLE_ENTRY" > "$BUNDLE" 2>/dev/null || { echo "❌ 解包失败" >&2; exit 2; }

# 🔴 出现**次数**用 `grep -o | wc -l`，不用 `grep -c`：minified bundle 是一行，
#    `grep -c` 只会给"命中行数"（恒 0 或 1），那把"存在性"和"数量"混成一档。
count_of() { grep -a -o -F -- "$1" "$BUNDLE" 2>/dev/null | wc -l | tr -d ' '; }

echo "APK：$APK"
echo "   mtime=$(stat -f '%Sm' -t '%F %T' "$APK")  sha256 前 12=$(shasum -a 256 "$APK" | cut -c1-12)"
echo "   bundle 条目=$BUNDLE_ENTRY  字节=$BYTES"
echo   "== 1. 探针自身有效性（先看负对照，再看总命中）=="
NEG_N=$(count_of "$NEG")
if [ "$NEG_N" != 0 ]; then
  echo "   ❌ 负对照 '$NEG' 命中 $NEG_N 次 —— 探针在'什么都命中'，本趟读数不可信（exit 3）。"
  exit 3
fi
echo "   ✅ 负对照 '$NEG' 命中 0 次（说明这几条 grep 有牙）"

MISS=0
echo   "== 2. 拼装碎片（base + 两个后缀必须同时在场）=="
for f in "${FRAGMENTS_ARR[@]}"; do
  n=$(count_of "$f")
  if [ "$n" -ge 1 ]; then
    printf '   ✅ %-16s 出现 %s 次\n' "$f" "$n"
  else
    printf '   ❌ %-16s 出现 0 次\n' "$f"
    MISS=$((MISS + 1))
  fi
done

echo   "== 3. 拼装等式（把找到的碎片接成设备上该出现的两条 resource-id）=="
BASE="${FRAGMENTS_ARR[0]}"
for suf_idx in 1 2; do
  suf="${FRAGMENTS_ARR[$suf_idx]}"
  joined="${BASE}${suf}"
  # 🔴 这一枚碎片自己没在场时**不打印等式**：第一版照样打印了"靠上面碎片在场"，
  #    那是一行在缺件时会说谎的话（结论行是对的，但那行会让人以为碎片找到了）。
  sn=$(count_of "$suf")
  if [ "$sn" -eq 0 ]; then
    printf '   ⏭️ %s 跳过（后缀 %s 出现 0 次，等式无从谈起）\n' "$joined" "$suf"
    continue
  fi
  direct=$(count_of "$joined")
  if [ "$direct" -ge 1 ]; then
    # 整串直接在场：说明某处是**写死**的，拼装判据在这里反而不适用
    printf '   ⚠️ %s 以整串出现 %s 次（不是拼出来的 —— 有字面量，直接判整串）\n' "$joined" "$direct"
  else
    printf '   %s = %s + %s ⇒ 运行时拼装，产物里只有碎片，靠上面两条碎片在场\n' "$joined" "$BASE" "$suf"
  fi
done

if [ "$MISS" -ne 0 ]; then
  echo "结论：❌ 缺 $MISS 枚碎片 —— 这份产物带不了 C 的判据，先 pnpm --filter @heyta/ui build && pnpm build:android（exit 1）。"
  exit 1
fi
echo "结论：✅ 三枚碎片都在、负对照 0 —— 这份 APK 里确实有 C 那两枚 resource-id 的拼装材料。"
echo "⚠️ 它证明的是**产物**，不是**界面**：设备上画没画出来仍只有真机腿能答（§6.2 规定一）。"
exit 0
