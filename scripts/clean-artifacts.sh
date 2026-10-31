#!/bin/bash
#
# clean-artifacts.sh —— 本仓**构建产物**的清理入口（先清旧的，再创建新的）
# ============================================================================
#
# ## 它为什么存在
#
# 构建产物（`dist/`、SwiftPM `.build/`、iOS/Android `build/`、Playwright
# `test-results/`、部署暂存 tar）每一份都能重建，所以**没有任何一层有义务清它** ——
# 于是它只往一个方向长。2026-10-31 实测：一次发布 + 四端重装之后，本机可回收产物
# 约 **6.1 GB**（其中 `apps/mobile/ios/build` 5.3 GB），部署机沙箱轮次另攒了 **6.9 GB**。
#
# 同族工具已经各管一段：
#   · `scripts/clean-build-tmp.sh`  —— `/tmp` 里的构建残留（含凭据/证据保护）；
#   · `scripts/clean-carriers.sh`   —— `~/heyta-carriers/` 一次性搬运树；
#   · 本脚本                        —— **仓库内**的构建产物 + 部署暂存 tar。
#
# 三者刻意不合并：它们的根、白名单与危险面完全不同（一个是 `/tmp`，一个是
# 一次性工作树，一个是事实源仓库本身）。本脚本只做最后这一格，并把"有没有超预算"
# 交给 `scripts/check-disk-budget.mjs` 那个门禁去判。
#
# ## 🔴 三条安全边界
#
# 1. **默认 dry-run**：不加 `--apply` 只列"会删什么 + 能释放多少"，一个字节都不动。
# 2. **只认精确名单**：`dist` / `dist-types` / `.build` / `build` / `.gradle` /
#    `test-results` / `playwright-report` 这些**目录名**，不认 `*dist*` 这类模糊 glob。
#    命中项还必须落在**本仓根**里（真实路径前缀判据）—— 越界软链只报不删。
# 3. **依赖与证据永不删**：`node_modules` / `Pods` / `.pnpm-store` / `.worktrees` /
#    `evidence` 既不在名单里，路径里出现这些组件也直接跳过。它们是依赖与取证，
#    不是构建产物。
# 4. **"够旧"才清暂存 tar**：`/tmp/heyta-deploy-*.tar.gz` 默认只清 1 小时前的
#    （`HEYTA_LOCAL_STAGING_KEEP_HOURS`）。多会话共用一个工作树时，另一条会话
#    正在跑的部署，它的 tar 就在 /tmp —— 按文件名删会毁掉在途那一份。
#
# ## 用法
#
#   bash scripts/clean-artifacts.sh                 # 干跑：列可清项与体量
#   bash scripts/clean-artifacts.sh --apply         # 真删
#   bash scripts/clean-artifacts.sh --json          # stdout 只留 JSON（给门禁脚本用）
#   bash scripts/clean-artifacts.sh --self-test     # 在临时树里造样本，验证上列性质
#   HEYTA_ARTIFACTS_ROOT=/tmp/fixture bash scripts/clean-artifacts.sh   # 换根（自检/演练）
#   HEYTA_LOCAL_STAGING_KEEP_HOURS=6 bash scripts/clean-artifacts.sh    # 改暂存 tar 的老化门槛
#
# ## 退出码
#
#   0 = 干净（无可清项）/ 全部删掉
#   1 = 有 N 项没删掉（逐条已 warn，其余项照常处理完）
#   2 = 参数不认识 / 参数值不合形状
#   4 = 根目录形状不合法（**一个字节都没动**）
#
set -uo pipefail

SELF="$0"
APPLY=0
JSON=0
SELF_TEST=0
ROOT_OVERRIDE=""
TMP_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --json) JSON=1 ;;
    --self-test) SELF_TEST=1 ;;
    --root) shift; ROOT_OVERRIDE="${1:-}" ;;
    --tmp-dir) shift; TMP_OVERRIDE="${1:-}" ;;
    -h|--help) sed -n '2,55p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "🔴 不认识的参数：$1（--help 看用法）" >&2; exit 2 ;;
  esac
  shift
done

say() { [ "$JSON" = 1 ] && return 0; printf '%s\n' "$*"; }
say_row() { [ "$JSON" = 1 ] && return 0; printf '  %10s  %s\n' "$1" "$2"; }
warn() { printf '%s\n' "$*" >&2; }

human_kb() {
  awk -v kb="$1" 'BEGIN{
    if (kb >= 1048576) printf "%.2f GB", kb / 1048576;
    else if (kb >= 1024) printf "%.1f MB", kb / 1024;
    else printf "%d KB", kb;
  }'
}

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# `pwd -P` 取真实路径（macOS bash 3.2 不一定有 realpath；同 clean-carriers.sh）。
real_dir() { (cd "$1" 2>/dev/null && pwd -P) || true; }

# ── 自检 ────────────────────────────────────────────────────────────────────
# 在临时树里造样本，然后**再跑这个脚本自己**（子进程），断言：
#   · dry-run 一个字节都不动；
#   · --apply 删掉名单内产物，保留 evidence / node_modules / 越界软链；
#   · 删完再跑，可回收为 0；
#   · 根形状不合法时 exit 4。
run_self_test() {
  local fx outside arms=0 bad=0 out rc kb
  fx="$(mktemp -d "${TMPDIR:-/tmp}/heyta-clean-artifacts-selftest.XXXXXX")" || {
    echo "🔴 self-test: mktemp 失败" >&2; return 1; }
  outside="$(mktemp -d "${TMPDIR:-/tmp}/heyta-clean-artifacts-outside.XXXXXX")" || {
    echo "🔴 self-test: mktemp 失败" >&2; rm -rf "$fx"; return 1; }
  # 🔴 自检在**子 shell**里跑（调用处是 `( run_self_test )`），所以 EXIT trap 只收这一棵；
  #    别用 RETURN —— bash 的 RETURN trap 会在**每一次**函数返回时触发，第一个内层函数
  #    返回就会把夹具删掉，后面几臂读到的是空树。
  trap "rm -rf '${fx}' '${outside}'" EXIT

  mkdir -p "$fx/tmp" \
    "$fx/packages/demo/dist" "$fx/packages/demo/dist-types" \
    "$fx/apps/web/dist" "$fx/apps/web/evidence" \
    "$fx/apps/desktop-macos/.build" \
    "$fx/apps/mobile/ios/build" \
    "$fx/apps/mobile/android/app/build" \
    "$fx/e2e/test-results" \
    "$fx/node_modules/demo" \
    "$fx/packages/escape"
  printf '{"name":"fixture"}\n' > "$fx/package.json"
  printf 'old build\n' > "$fx/packages/demo/dist/index.js"
  printf 'old types\n' > "$fx/packages/demo/dist-types/index.d.ts"
  printf 'old web\n' > "$fx/apps/web/dist/index.html"
  printf 'evidence\n' > "$fx/apps/web/evidence/shot.png"
  printf 'obj\n' > "$fx/apps/desktop-macos/.build/obj"
  printf 'ios\n' > "$fx/apps/mobile/ios/build/log"
  printf 'android\n' > "$fx/apps/mobile/android/app/build/x"
  printf 'results\n' > "$fx/e2e/test-results/r.json"
  printf 'dep\n' > "$fx/node_modules/demo/index.js"
  printf 'staging\n' > "$fx/tmp/heyta-deploy-old.tar.gz"
  # 够旧（1 小时前）才该删；新鲜的可能是另一条会话正在跑的部署，必须留下。
  touch -t 202001010000 "$fx/tmp/heyta-deploy-old.tar.gz"
  printf 'in-flight\n' > "$fx/tmp/heyta-deploy-fresh.tar.gz"
  # 越界软链：名字叫 dist，真实路径在根外 —— 必须只报不删。
  ln -s "$outside" "$fx/packages/escape/dist"
  printf 'outside\n' > "$outside/keep.txt"

  local common=(--root "$fx" --tmp-dir "$fx/tmp")

  # 臂 1：dry-run 不动任何东西，并数得出可回收体积。
  arms=$((arms + 1))
  out="$(bash "$SELF" "${common[@]}" --json 2>/dev/null)"; rc=$?
  kb="$(printf '%s' "$out" | sed -n 's/.*"reclaimableKb": \([0-9][0-9]*\).*/\1/p' | head -1)"
  if [ "$rc" -ne 0 ]; then
    bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（dry-run 退出码）：期望 0，实际 ${rc}" >&2
  elif [ "${kb:-0}" -le 0 ]; then
    bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（dry-run 可回收体积）：期望 >0，实际 '${kb:-空}'" >&2
  elif [ ! -f "$fx/packages/demo/dist/index.js" ] || [ ! -f "$fx/tmp/heyta-deploy-old.tar.gz" ]; then
    bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（dry-run 不许删）：样本被删了" >&2
  fi

  # 臂 2：--apply 删名单内、保名单外。
  arms=$((arms + 1))
  bash "$SELF" "${common[@]}" --apply --json >/dev/null 2>&1; rc=$?
  if [ "$rc" -ne 0 ]; then
    bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（--apply 退出码）：期望 0，实际 ${rc}" >&2
  fi
  local p
  for p in "$fx/packages/demo/dist" "$fx/packages/demo/dist-types" "$fx/apps/web/dist" \
           "$fx/apps/desktop-macos/.build" "$fx/apps/mobile/ios/build" \
           "$fx/apps/mobile/android/app/build" "$fx/e2e/test-results"; do
    [ -e "$p" ] && { bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（该删没删）：$p" >&2; }
  done
  [ -f "$fx/tmp/heyta-deploy-old.tar.gz" ] && { bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（暂存 tar 该删没删）" >&2; }

  # 臂 3：证据 / 依赖 / 越界软链的目标 / 新鲜的暂存 tar 必须仍在。
  arms=$((arms + 1))
  if [ ! -f "$fx/apps/web/evidence/shot.png" ]; then
    bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（evidence 被误删）" >&2
  elif [ ! -f "$fx/node_modules/demo/index.js" ]; then
    bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（node_modules 被误删）" >&2
  elif [ ! -f "$outside/keep.txt" ]; then
    bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（越界软链的目标被误删）" >&2
  elif [ ! -L "$fx/packages/escape/dist" ]; then
    bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（越界软链本身应保留，实际没了）" >&2
  elif [ ! -f "$fx/tmp/heyta-deploy-fresh.tar.gz" ]; then
    bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（新鲜的暂存 tar 可能是别人在途，被误删）" >&2
  fi

  # 臂 4：清完再跑，可回收为 0（证明读数不是常量）。
  arms=$((arms + 1))
  out="$(bash "$SELF" "${common[@]}" --json 2>/dev/null)"
  kb="$(printf '%s' "$out" | sed -n 's/.*"reclaimableKb": \([0-9][0-9]*\).*/\1/p' | head -1)"
  if [ "${kb:-x}" != "0" ]; then
    bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（清完可回收应为 0，实际 '${kb:-空}'）" >&2
  fi

  # 臂 5：根形状不合法 ⇒ exit 4（一个字节都不动）。
  arms=$((arms + 1))
  bash "$SELF" --root "$fx/does-not-exist" --json >/dev/null 2>&1; rc=$?
  if [ "$rc" -ne 4 ]; then
    bad=$((bad + 1)); echo "  ✗ 臂 ${arms}（缺 package.json/不存在应为 4，实际 ${rc}）" >&2
  fi

  echo "self-test: ${arms} 臂，${bad} 处不符"
  [ "$bad" -eq 0 ]
}

if [ "$SELF_TEST" = 1 ]; then
  # 子 shell：EXIT trap 只收自检夹具，不碰外面的任何路径。
  if ( run_self_test ); then exit 0; else exit 1; fi
fi

# ── 根与形状判据 ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)" || {
  echo "🔴 无法定位脚本目录" >&2; exit 4; }
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)" || {
  echo "🔴 无法定位仓库根" >&2; exit 4; }
ROOT="${ROOT_OVERRIDE:-${HEYTA_ARTIFACTS_ROOT:-$DEFAULT_ROOT}}"
TMP_DIR="${TMP_OVERRIDE:-${HEYTA_CLEAN_TMP_DIR:-/tmp}}"
# 部署暂存 tar 的"够旧"门槛。这个仓库允许多会话共用一个工作树，另一条会话可能
# 正在跑部署（它的 tar 就在 /tmp）—— 按文件名删会直接把在途的那份删掉。
# 默认只清 1 小时前的：一场部署是分钟级，1 小时足够把"在途"与"残留"分开。
STAGING_KEEP_HOURS="${HEYTA_LOCAL_STAGING_KEEP_HOURS:-1}"
case "$STAGING_KEEP_HOURS" in
  ''|*[!0-9]*) echo "🔴 HEYTA_LOCAL_STAGING_KEEP_HOURS 要是非负整数（读到：${STAGING_KEEP_HOURS}）" >&2; exit 2 ;;
esac

[ -n "$ROOT" ] || { echo "🔴 根目录是空字符串 —— 拒绝执行" >&2; exit 4; }
[ -d "$ROOT" ] || { echo "🔴 根目录不存在：${ROOT}" >&2; exit 4; }
[ -f "$ROOT/package.json" ] || {
  echo "🔴 根目录里没有 package.json（${ROOT}）—— 本脚本只清事实源仓库的构建产物" >&2
  exit 4
}
ROOT_REAL="$(real_dir "$ROOT")" || { echo "🔴 根目录无法解析：${ROOT}" >&2; exit 4; }
[ -n "$ROOT_REAL" ] || { echo "🔴 根目录无法解析：${ROOT}" >&2; exit 4; }
HOME_REAL="$(real_dir "$HOME")"
TMP_REAL="$(real_dir "$TMP_DIR")" || { echo "🔴 暂存目录无法解析：${TMP_DIR}" >&2; exit 4; }

unsafe_root() {
  echo "🔴 拒绝执行：$1" >&2
  echo "   本脚本会 rm -rf 命中项 —— 形状判据必须比手速快（exit 4，一个字节都没动）。" >&2
  exit 4
}
case "$ROOT_REAL" in
  /) unsafe_root "根解析后是 /（整台机器）" ;;
esac
[ -n "$HOME_REAL" ] && [ "$ROOT_REAL" = "$HOME_REAL" ] && unsafe_root "根解析后是 \$HOME"

# ── 名单（唯一事实源） ──────────────────────────────────────────────────────
# ① 每个 workspace 包/应用下的 dist 与 dist-types（tsup/tsc 产物）。
WS_NAMES="dist dist-types"
# ② 不在 dist 约定里的构建目录（逐项精确路径）。
EXTRA_DIRS="
apps/desktop/renderer-dist
apps/desktop-macos/.build
apps/mobile/ios/build
apps/mobile/ios/DerivedData
apps/mobile/android/app/build
apps/mobile/android/app/.cxx
apps/mobile/android/build
apps/mobile/android/.gradle
e2e/test-results
e2e/playwright-report
server/dist
server/dist-types
"
# ③ /tmp 里由本仓部署装置产生的暂存归档（只认文件名形状，不碰别的）。
TMP_FILE_PATTERN='heyta-deploy-*.tar.gz'
TMP_FILE_EXACT="heyta-server-src.tar.gz"

# 依赖 / 证据 / 工作树：名字或路径组件命中即**永不删**。
PROTECTED_COMPONENTS="node_modules Pods .pnpm-store .worktrees .git evidence"

is_protected_path() {
  local rel="$1" comp rest
  rest="$rel"
  while [ -n "$rest" ]; do
    comp="${rest%%/*}"
    if [ "$comp" = "$rest" ]; then rest=""; else rest="${rest#*/}"; fi
    local p
    for p in $PROTECTED_COMPONENTS; do
      [ "$comp" = "$p" ] && return 0
    done
  done
  return 1
}

# 答案写进全局变量：扫描是逐项调用，命令替换的 fork 会把大仓拖慢。
PATH_OK=0
guard_path() {
  # <path> <expected-root-real>
  local p="$1" root="$2" real
  PATH_OK=0
  [ -L "$p" ] && return 0                 # 软链本身不动，也不跟随
  [ -e "$p" ] || return 0
  real="$(real_dir "$p")"
  [ -n "$real" ] || return 0
  case "$real" in
    "$root"/*) PATH_OK=1 ;;
  esac
}

# ── 扫描 ────────────────────────────────────────────────────────────────────
ITEM_PATH=(); ITEM_KB=(); ITEM_KIND=(); ITEM_STATUS=()
CAND_PATH=(); CAND_KB=(); CAND_KIND=()
KB_CLEAN=0
N_SKIP=0

add_item() { # <path> <kb> <kind> <status>
  ITEM_PATH[${#ITEM_PATH[@]}]="$1"
  ITEM_KB[${#ITEM_KB[@]}]="$2"
  ITEM_KIND[${#ITEM_KIND[@]}]="$3"
  ITEM_STATUS[${#ITEM_STATUS[@]}]="$4"
}

add_candidate() { # <path> <kind> <expected-root>
  local p="$1" kind="$2" root="$3" rel kb
  [ -e "$p" ] || [ -L "$p" ] || return 0
  rel="${p#"$root"/}"
  if is_protected_path "$rel"; then
    N_SKIP=$((N_SKIP + 1)); return 0
  fi
  guard_path "$p" "$root"
  if [ "$PATH_OK" != 1 ]; then
    warn "⚠️ 跳过（真实路径越界或无法解析）：$p"
    N_SKIP=$((N_SKIP + 1)); return 0
  fi
  kb="$(du -sk "$p" 2>/dev/null | awk 'NR==1{print $1}')"
  kb="${kb:-0}"
  CAND_PATH[${#CAND_PATH[@]}]="$p"; CAND_KB[${#CAND_KB[@]}]="$kb"; CAND_KIND[${#CAND_KIND[@]}]="$kind"
  KB_CLEAN=$((KB_CLEAN + kb))
  add_item "$p" "$kb" "$kind" would-delete
}

# ① 工作区包/应用的 dist 与 dist-types。
for base in "$ROOT_REAL"/packages/* "$ROOT_REAL"/apps/*; do
  [ -d "$base" ] || continue
  for name in $WS_NAMES; do
    add_candidate "$base/$name" "workspace-$name" "$ROOT_REAL"
  done
done
# ② 精确路径。
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  add_candidate "$ROOT_REAL/$rel" "build-dir" "$ROOT_REAL"
done <<EOF
$EXTRA_DIRS
EOF
# ③ /tmp 暂存归档（只删文件，不删目录；且只删"够旧"的）。
NOW_S="$(date +%s)"
add_tmp_candidate() { # <path>
  local p="$1" kb mtime
  [ -f "$p" ] && [ ! -L "$p" ] || return 0
  mtime="$(date -r "$p" +%s 2>/dev/null)" || { N_SKIP=$((N_SKIP + 1)); return 0; }
  if [ $(((NOW_S - mtime) / 3600)) -lt "$STAGING_KEEP_HOURS" ]; then
    N_SKIP=$((N_SKIP + 1)); return 0   # 可能是另一条会话正在跑的部署
  fi
  kb="$(du -sk "$p" 2>/dev/null | awk 'NR==1{print $1}')"; kb="${kb:-0}"
  CAND_PATH[${#CAND_PATH[@]}]="$p"; CAND_KB[${#CAND_KB[@]}]="$kb"; CAND_KIND[${#CAND_KIND[@]}]="tmp-staging"
  KB_CLEAN=$((KB_CLEAN + kb))
  add_item "$p" "$kb" "tmp-staging" would-delete
}
if [ -d "$TMP_REAL" ]; then
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    add_tmp_candidate "$p"
  done < <(find "$TMP_REAL/" -maxdepth 1 -type f -name "$TMP_FILE_PATTERN" -print 2>/dev/null)
  add_tmp_candidate "$TMP_REAL/$TMP_FILE_EXACT"
fi

# ── 输出 ────────────────────────────────────────────────────────────────────
say "════ 构建产物清理（仓库内 + 部署暂存） ════"
say "  根目录   = ${ROOT}"
say "  真实路径 = ${ROOT_REAL}"
say "  暂存目录 = ${TMP_REAL}"
say "  模式     = $([ "$APPLY" = 1 ] && echo '🔴 APPLY（真删）' || echo 'dry-run（只列，不动任何文件）')"
say "  保护     = node_modules / Pods / .pnpm-store / .worktrees / .git / evidence（命中即跳过）"
say ""

if [ "${#CAND_PATH[@]}" -gt 0 ]; then
  say "── 可删（可重建：重跑构建就长回来）──"
  i=0
  while [ "$i" -lt "${#CAND_PATH[@]}" ]; do
    say_row "$(human_kb "${CAND_KB[$i]}")" "${CAND_PATH[$i]}"
    i=$((i + 1))
  done
  say "  ────────────────────────────────────────────"
  say "  合计 $(human_kb "$KB_CLEAN") / ${#CAND_PATH[@]} 项"
else
  say "没有可清的构建产物"
fi
[ "$N_SKIP" -gt 0 ] && say "  （另有 ${N_SKIP} 项因保护/越界被跳过）"
say ""

emit_json() {
  local i sep=''
  printf '{\n'
  printf '  "root": "%s",\n' "$(json_escape "$ROOT")"
  printf '  "rootReal": "%s",\n' "$(json_escape "$ROOT_REAL")"
  printf '  "tmpDir": "%s",\n' "$(json_escape "$TMP_REAL")"
  printf '  "mode": "%s",\n' "$([ "$APPLY" = 1 ] && echo apply || echo dry-run)"
  printf '  "reclaimableKb": %s,\n' "$KB_CLEAN"
  printf '  "reclaimedKb": %s,\n' "${KB_DEL:-0}"
  printf '  "deleted": %s,\n' "${N_DEL:-0}"
  printf '  "failed": %s,\n' "${N_FAIL:-0}"
  printf '  "skipped": %s,\n' "$N_SKIP"
  printf '  "items": ['
  i=0
  while [ "$i" -lt "${#ITEM_PATH[@]}" ]; do
    printf '%s\n    {"path": "%s", "kind": "%s", "kb": %s, "status": "%s"}' \
      "$sep" "$(json_escape "${ITEM_PATH[$i]}")" "${ITEM_KIND[$i]}" "${ITEM_KB[$i]}" "${ITEM_STATUS[$i]}"
    sep=','
    i=$((i + 1))
  done
  [ "${#ITEM_PATH[@]}" -gt 0 ] && printf '\n  '
  printf ']\n}\n'
}

N_DEL=0; KB_DEL=0; N_FAIL=0

if [ "$APPLY" != 1 ]; then
  say "DRY-RUN：什么都没删，加 --apply 才真删"
  say "可释放 $(human_kb "$KB_CLEAN") / 已释放 0 KB（0 项）"
  [ "$JSON" = 1 ] && emit_json
  exit 0
fi

if [ "${#CAND_PATH[@]}" -eq 0 ]; then
  say "可释放 0 KB / 已释放 0 KB（0 项）"
  [ "$JSON" = 1 ] && emit_json
  exit 0
fi

say "── 执行删除 ──"
i=0
while [ "$i" -lt "${#CAND_PATH[@]}" ]; do
  p="${CAND_PATH[$i]}"
  kb="${CAND_KB[$i]}"
  # 删除前再验一次：扫描与删除之间别人可能把它换成了软链（共享检出的常见形状）。
  if [ -L "$p" ]; then
    warn "  ⚠️ 跳过（删除前变成了软链）：${p}"
    N_SKIP=$((N_SKIP + 1)); i=$((i + 1)); continue
  fi
  if rm -rf -- "$p" 2>/dev/null && [ ! -e "$p" ]; then
    say "  🗑 已删 $(human_kb "$kb")  ${p}"
    N_DEL=$((N_DEL + 1)); KB_DEL=$((KB_DEL + kb))
    j=0
    while [ "$j" -lt "${#ITEM_PATH[@]}" ]; do
      [ "${ITEM_PATH[$j]}" = "$p" ] && { ITEM_STATUS[$j]="deleted"; break; }
      j=$((j + 1))
    done
  else
    warn "  ⚠️ 删不掉（继续处理其余项）：${p}"
    N_FAIL=$((N_FAIL + 1))
    j=0
    while [ "$j" -lt "${#ITEM_PATH[@]}" ]; do
      [ "${ITEM_PATH[$j]}" = "$p" ] && { ITEM_STATUS[$j]="failed"; break; }
      j=$((j + 1))
    done
  fi
  i=$((i + 1))
done

say ""
say "可释放 $(human_kb "$KB_CLEAN") / 已释放 $(human_kb "$KB_DEL")（${N_DEL} 项）"
[ "$N_FAIL" -gt 0 ] && warn "🔴 有 ${N_FAIL} 项没删掉（其余已释放；手工看那几条 warn）"
[ "$JSON" = 1 ] && emit_json
[ "$N_FAIL" -eq 0 ] || exit 1
exit 0
