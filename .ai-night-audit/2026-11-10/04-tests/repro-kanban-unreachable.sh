#!/usr/bin/env bash
# 复现 F-01：kanban 视图没有任何入口可达
# -----------------------------------------
# 判据：VIEW_TABS 里每一项都必须**至少有一条**到达路径：
#   ① v.key === 'tasks' | 'search'          （常驻）
#   ② enabledModules.has(v.key)             ⇒ v.key ∈ FEATURE_MODULE_KEYS
#   ③ rail-pref.isViewKey(v.key)            （用户可手动固定）
#   ④ v.key ∈ {'settings','trash'}          （被 visibleMainTabs 显式排除，另有入口）
#
# kanban 四条都不满足 ⇒ 不可达。
#
# 只读：不改任何文件、不跑构建、不联网。
# 用法：bash .ai-night-audit/2026-11-10/04-tests/repro-kanban-unreachable.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

WEB="apps/web/src"
VIEW_TABS="$WEB/features/shell/view-tabs.ts"
MODULES="$WEB/features/shell/modules.ts"
RAIL_PREF="$WEB/features/shell/rail-pref.ts"
APP="$WEB/App.tsx"

echo "仓库：$ROOT"
echo "HEAD：$(git rev-parse --short HEAD)"
echo

# ── 1. 取出 VIEW_TABS 的键 ────────────────────────────────────────────
# VIEW_TABS 是拼装出来的（...ALWAYS_ON + ...MODULE + SEARCH + ...SIDEBAR_TOOL + SETTINGS），
# 所以从各个分量里取，而不是从 VIEW_TABS 那个字面量取。
keys=$(
  node -e '
    const fs=require("fs");
    const src=fs.readFileSync(process.argv[1],"utf8");
    const block=(name)=>{const i=src.indexOf(name);const j=src.indexOf("];",i);return src.slice(i,j+2);};
    const pairs=(d)=>[...d.matchAll(/\{\s*key:\s*'"'"'([^'"'"']+)'"'"'/g)].map(m=>m[1]);
    const out=new Set();
    for(const n of ["const ALWAYS_ON_VIEW_TABS","const MODULE_VIEW_TABS","const SIDEBAR_TOOL_TABS"]) pairs(block(n)).forEach(k=>out.add(k));
    // 单个对象（以 }; 结尾），不能用 block()
    for(const n of ["const SEARCH_VIEW_TAB","const SETTINGS_VIEW_TAB"]){
      const i=src.indexOf(n); const j=src.indexOf("};",i);
      [...src.slice(i,j).matchAll(/key:\s*'"'"'([^'"'"']+)'"'"'/g)].forEach(m=>out.add(m[1]));
    }
    console.log([...out].join(" "));
  ' "$VIEW_TABS"
)

echo "── 1. VIEW_TABS 的键（从各分量拼出）──────────────────────────"
echo "  $keys"
echo

# ── 2. 三条到达路径的来源集合 ─────────────────────────────────────────
FEATURE_KEYS=$(
  node -e '
    const fs=require("fs");
    const s=fs.readFileSync("packages/domain/src/feature-modules.ts","utf8");
    const i=s.indexOf("export const FEATURE_MODULE_KEYS");
    const j=s.indexOf("] as const",i);
    console.log([...s.slice(i,j).matchAll(/'"'"'([a-zA-Z-]+)'"'"'/g)].map(m=>m[1]).join(" "));
  '
)
RAIL_KEYS=$(
  node -e '
    const fs=require("fs");
    const s=fs.readFileSync(process.argv[1],"utf8");
    const i=s.indexOf("function isViewKey");
    const j=s.indexOf("].includes",i);
    console.log([...s.slice(i,j).matchAll(/'"'"'([a-zA-Z-]+)'"'"'/g)].map(m=>m[1]).join(" "));
  ' "$RAIL_PREF"
)

echo "── 2. 三条到达路径的来源集合 ─────────────────────────────────"
echo "  ② FEATURE_MODULE_KEYS        : $FEATURE_KEYS"
echo "  ③ rail-pref.isViewKey 白名单 : $RAIL_KEYS"
echo "  ① 常驻                       : tasks search"
echo "  ④ 显式排除但另有入口         : settings trash"
echo

# ── 3. 逐项判定 ──────────────────────────────────────────────────────
echo "── 3. 逐项判定 ───────────────────────────────────────────────"
printf '  %-12s %-8s %-8s %-8s %-8s %s\n' "key" "常驻" "模块" "可固定" "另有口" "可达?"
UNREACHABLE=()
for k in $keys; do
  a="-"; b="-"; c="-"; d="-"                 # 各路径
  [ "$k" = tasks ] || [ "$k" = search ] && a="✅"
  case " $FEATURE_KEYS " in *" $k "*) b="✅";; esac
  case " $RAIL_KEYS " in *" $k "*) c="✅";; esac
  [ "$k" = settings ] || [ "$k" = trash ] && d="✅"
  if [ "$a$b$c$d" = "----" ]; then
    printf '  %-12s %-8s %-8s %-8s %-8s %s\n' "$k" "$a" "$b" "$c" "$d" "🔴 不可达"
    UNREACHABLE+=("$k")
  else
    printf '  %-12s %-8s %-8s %-8s %-8s %s\n' "$k" "$a" "$b" "$c" "$d" "ok"
  fi
done
echo

# ── 4. 佐证：视图确实定义且确实被渲染 ────────────────────────────────
echo "── 4. 佐证：它确实存在、也真的会渲染 ─────────────────────────"
printf '  view-tabs 里有定义 : %s\n' "$(grep -c "'kanban'" "$VIEW_TABS")"
printf '  App 里有渲染分支   : %s\n' "$(grep -c "contentView === 'kanban'" "$APP")"
printf '  SHELL_MODULES 里有 : %s  (0 ⇒ enabledModules.has 恒 false)\n' \
  "$(sed -n '/const SHELL_MODULES/,/^\];/p' "$MODULES" | grep -c "key: 'kanban'")"
echo

# ── 5. 判定 ──────────────────────────────────────────────────────────
echo "── 5. 判定 ───────────────────────────────────────────────────"
if [ "${#UNREACHABLE[@]}" -eq 0 ]; then
  echo "  ✅ 每个 ViewKey 都至少有一条到达路径"
  exit 0
fi
echo "  🔴 不可达的视图（${#UNREACHABLE[@]} 个）：${UNREACHABLE[*]}"
echo
echo "  ⇒ 这是 F-01。修法三选一（见 03-findings.md F-01「建议修复」）："
echo "     · 加进 FEATURE_MODULE_KEYS + SHELL_MODULES（用户在设置里打开）"
echo "     · 设成常驻（与 tasks/search 并列）"
echo "     · 产品不打算做 ⇒ 删掉 view-tabs 那行与 KanbanView 接线"
echo
echo "  ⚠️ 顺带一条门禁缺口：check:reachability 只管**数据实体**的可达性，"
echo "     视图可达性无人管 —— 所以这个缺陷能长期隐身。"
exit 1
