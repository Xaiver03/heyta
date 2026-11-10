#!/usr/bin/env bash
# 复现：apps/landing 形状登记处 ⟷ apps/web 真源的 4 处漂移
# ---------------------------------------------------------------
# 用途：证明这 4 处漂移**不是"测试写错了"**，而是 4 次已提交的产品改动
#       各自动了 apps/web，而**没有任何一次**同步过 apps/landing。
#
# 只读：不改任何文件、不跑构建、不联网。
# 用法：bash .ai-night-audit/2026-11-10/04-tests/repro-landing-drift.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

LANDING="apps/landing"
WEB="apps/web"

echo "仓库：$ROOT"
echo "HEAD：$(git rev-parse --short HEAD)"
echo

# ── 1. 四处漂移的引入提交 ────────────────────────────────────────────
# 每一项 = "引入该真源符号的那个提交"
declare -a CASES=(
  "web.shell.nav.tomorrow|69fa5352|R10「明天」智能清单"
  "history-notice|5bc42d31|R19 ⌘Z 撤销栈"
  "manage-tags-open|e69f08f5|B 包 标签管理页"
  "detail-pane-open|829272f8|R14 B5 裁决（删掉 ⋯ 里那枚）"
)

echo "── 1. 每次改动动了 apps/web，却没动 apps/landing ──────────────"
printf '%-28s %-10s %-8s %-8s %s\n' "真源符号" "提交" "web行数" "landing行数" "说明"
FAIL=0
for row in "${CASES[@]}"; do
  IFS='|' read -r sym commit desc <<<"$row"
  web_lines=$(git show --stat "$commit" 2>/dev/null | grep -c "^ ${WEB}/" || true)
  landing_lines=$(git show --stat "$commit" 2>/dev/null | grep -c "^ $LANDING/" || true)
  printf '%-28s %-10s %-8s %-8s %s\n' "$sym" "$commit" "$web_lines" "$landing_lines" "$desc"
  if [ "$landing_lines" -ne 0 ]; then
    echo "  ⚠️  预期 landing=0，实测 $landing_lines —— 漂移前提不成立，需重新核对"
    FAIL=1
  fi
done
echo

# ── 2. 真源侧现量：这些符号在不在？ ──────────────────────────────────
echo "── 2. 真源（${WEB}）现量 ────────────────────────────────────────"
printf '  PRIMARY_NAV 条数            : %s\n' \
  "$(sed -n '/const PRIMARY_NAV/,/^];/p' ${WEB}/src/features/shell/view-tabs.ts | grep -c 'labelKey:')"
for sym in "web.shell.nav.tomorrow" "history-notice" "manage-tags-open" "detail-pane-open"; do
  n=$(grep -roF "$sym" ${WEB}/src 2>/dev/null | wc -l | tr -d ' ')
  printf '  %-26s : %s\n' "$sym" "$n"
done
echo "  ⚠️ detail-pane-open 必须为 0 —— R14 已裁决删除它；若不为 0，修复方向要反过来。"
echo

# ── 3. 登记处侧现量 ──────────────────────────────────────────────────
echo "── 3. 登记处（${LANDING}）现量 ─────────────────────────────────"
printf '  SHELL_PRIMARY_NAV 条数      : %s\n' \
  "$(sed -n '/const SHELL_PRIMARY_NAV/,/^];/p' ${LANDING}/src/mockup/app-shell-shape.ts | grep -c 'labelKey:')"
for sym in "web.shell.nav.tomorrow" "history-notice" "manage-tags-open" "detail-pane-open"; do
  n=$(grep -roF "'$sym'" ${LANDING}/src/mockup/app-shell-shape.ts 2>/dev/null | wc -l | tr -d ' ')
  printf "  %-26s : %s\n" "$sym" "$n"
done
echo

# ── 4. 判据本身 ──────────────────────────────────────────────────────
echo "── 4. 判据（${LANDING}/tests/mockup-shell-shape.spec.tsx）────────"
echo "  跑法：cd $LANDING && npx vitest run tests/mockup-shell-shape.spec.tsx"
echo "  修前：3 failed | 19 passed (22)"
echo "  修后：22 passed (22)"
echo

# ── 5. 判定 ──────────────────────────────────────────────────────────
echo "── 5. 判定 ────────────────────────────────────────────────────"
r_nav_src=$(sed -n '/const PRIMARY_NAV/,/^];/p' ${WEB}/src/features/shell/view-tabs.ts | grep -c 'labelKey:')
r_nav_reg=$(sed -n '/const SHELL_PRIMARY_NAV/,/^];/p' ${LANDING}/src/mockup/app-shell-shape.ts | grep -c 'labelKey:')
if [ "$r_nav_src" -eq "$r_nav_reg" ]; then
  echo "  ✅ 主导航条数一致（${r_nav_src} = ${r_nav_reg}）"
else
  echo "  🔴 主导航条数不一致（真源 $r_nav_src ≠ 登记处 $r_nav_reg）"
  FAIL=1
fi
if [ "$(grep -E '^\s*anchors:' ${LANDING}/src/mockup/app-shell-shape.ts | grep -c 'detail-pane-open')" -eq 0 ]; then
  echo "  ✅ 登记处的 anchors 已不含 detail-pane-open"
  echo "     （注：文件里仍会出现这个词 —— 在说明那格真缺陷的注释里，那是**记录**不是登记）"
else
  echo "  🔴 登记处的 anchors 仍含 detail-pane-open"
  FAIL=1
fi
echo
[ "$FAIL" -eq 0 ] && echo "结论：漂移已闭合。" || echo "结论：仍有未闭合项（见上）。"
exit "$FAIL"
