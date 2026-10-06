#!/bin/bash
# B90 那 8 枚红的**归因对照**：它们现在绿，是因为详情面线那一刀（`selectedTaskId !== null`），
# 还是因为我这一单的 H11 改动顺带让它们绿了？两种读法对"这一格该记在谁头上"完全不同。
# 做法：在隔离载体里把 H11 的四枚源码文件摘回 `86d00c4c`（= 我的提交之前），
# 跑同一批 5 份 spec，再逐字节还原回 `1cbcbf34`。
#
# 用法（仓库根）：bash scripts/b90-attribution-control.sh
# ⚠️ 只在隔离载体里跑（它会改工作树源码）。还原用 md5 对账，不靠"应该还原了"。
set -u
CARRIER="$HOME/heyta-carriers/heyta-reinstall-1006"
PATHS=(apps/web/src/styles/app/base.css apps/web/src/styles/app/main-area.css
       apps/web/src/styles/app/material.css apps/web/src/features/tasks/TaskOrganizer.tsx)
SPECS="tests/ai-assistant.spec.ts tests/ai-row-layout.spec.ts tests/ai-tool-run.spec.ts tests/calendar-sidebar.spec.ts tests/glass-materials.spec.ts"
BK=/tmp/b90-control
mkdir -p "$BK"
cd "$CARRIER" || exit 1

for p in "${PATHS[@]}"; do
  n=$(basename "$p")
  git show "1cbcbf34:$p" > "$BK/$n.after"   # 带 H11（= 当前提交）
  cp "$p" "$BK/$n.live"                     # 载体此刻那份 = 还原的目标
  # 🔴 比对容忍**一枚结尾换行**：`86d00c4c` 起的 `base.css` 就没有行尾换行，
  #    而两棵工作树里那份都有（别线编辑时带上的）⇒ 提交 blob 与工作树差 1 字节，
  #    逐字 cmp 会在这里报 PRECOND_FAIL。第一版就是这么撞上的，不是猜的。
  #    容忍的是"只差一个末尾换行"，不是"差不多"：其余差异照旧响亮。
  if ! cmp -s "$BK/$n.live" "$BK/$n.after"; then
    if [ "$n" = base.css ] && [ "$(printf '%s' "$(cat "$BK/$n.live")")" = "$(printf '%s' "$(cat "$BK/$n.after")")" ]; then
      echo "  note: base.css 只差一枚行尾换行（提交 blob 无、工作树有），按容忍处理"
    else
      echo "PRECOND_FAIL 载体里的 $n 与 1cbcbf34 不一致，先别跑"; exit 1
    fi
  fi
  git show "86d00c4c:$p" > "$BK/$n.before"  # 摘掉 H11
done

restore() {
  for p in "${PATHS[@]}"; do cp "/tmp/b90-control/$(basename "$p").live" "$p"; done
  bad=0
  for p in "${PATHS[@]}"; do
    n=$(basename "$p")
    [ "$(md5 -q "$p")" = "$(md5 -q "$BK/$n.live")" ] || { echo "RESTORE_MISMATCH $n"; bad=1; }
  done
  [ "$bad" = 0 ] || exit 1
  echo "RESTORED_OK"
}
trap restore EXIT

echo "── 摘掉 H11（四枚源码回到 86d00c4c）"
for p in "${PATHS[@]}"; do cp "$BK/$(basename "$p").before" "$p"; done
( cd e2e && NO_COLOR=1 npx playwright test --reporter=line $SPECS > "$BK/without-h11.log" 2>&1; echo "RC=$?" >> "$BK/without-h11.log" )
echo "WITHOUT-H11 -> $(grep -o 'RC=[0-9]*' "$BK/without-h11.log" | tail -1) | $(grep -E '^ +[0-9]+ (passed|failed)' "$BK/without-h11.log" | tr '\n' ' ')"
grep -E '^\s+✘' "$BK/without-h11.log" | grep -v retry | sed 's/^/    RED /'
restore
trap - EXIT

echo "── 带 H11（还原后复跑一次，作为同树对照）"
( cd e2e && NO_COLOR=1 npx playwright test --reporter=line $SPECS > "$BK/with-h11.log" 2>&1; echo "RC=$?" >> "$BK/with-h11.log" )
echo "WITH-H11 -> $(grep -o 'RC=[0-9]*' "$BK/with-h11.log" | tail -1) | $(grep -E '^ +[0-9]+ (passed|failed)' "$BK/with-h11.log" | tr '\n' ' ')"
grep -E '^\s+✘' "$BK/with-h11.log" | grep -v retry | sed 's/^/    RED /'
echo "CONTROL_DONE"
