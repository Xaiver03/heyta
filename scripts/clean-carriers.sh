#!/bin/bash
#
# clean-carriers.sh —— `~/heyta-carriers/`（一次性搬运树）的**清理入口**
# ============================================================================
#
# ## 它为什么存在
#
# carrier = 为了让**别的机器 / 别的 lane** 跑一次构建，把工作树搬过去的那份**一次性目录**：
# 它不是 git 仓库、不是事实源（事实源永远在主仓库）。既然一次性，就没有任何一层有义务清它
# —— 于是它只往一个方向长。2026-10-24 实测：`~/heyta-carriers` 长到 **11 GB**，构成是
# **三份完整的搬运工作副本**，每份都自带一整套**可重建**的依赖与产物：
#
#   | 内容 | 体积 |
#   |---|---|
#   | `collab-m6-ios/DerivedData`（Xcode 中间产物 + 模拟器产物） | 5.3 GB |
#   | 两份 `node_modules`（`heyta-wt-collab-m5`、`head-r128`） | 1.1 GB × 2 |
#   | `e2e/test-results`（Playwright 每跑一次都往这儿落） | 430 MB |
#   | `apps/desktop-macos/.build`（SwiftPM 产物 ×2） | 323 MB + 147 MB |
#   | `apps/mobile/ios/Pods`（CocoaPods 依赖 ×2） | 166 MB × 2 |
#   | 重复的 `apps/*/evidence` 截图归档（主仓库已有同一份） | 1.3 GB |
#   | 旧打包 `heyta-f97013de.tgz` + 几个 `tmp-*` | 138 MB |
#
# 手工清到 675 MB 之后**规则仍然是零** ⇒ 必然长回去。本脚本就是那条规则。
# 约定写在 `docs/agents/multi-end-build.md` §6.1.2，事故读数在
# `docs/reference/environment-traps.md` #546。
#
# ## 🔴 三条安全边界（本脚本的全部价值都在这三条上）
#
# 1. **默认 dry-run**：不加 `--apply` 只**列**"会删什么 + 能释放多少"，一个字节都不动。
#    清理不可逆，默认必须是"先让我看一眼"。
# 2. **形状判据**（`exit 4`）：本脚本第一件事是 `rm -rf`，所以根目录先过形状判据 ——
#    根为空 / 不存在 / 解析后是 `/`、`$HOME`、**仓库根**、或**仓库根的祖先**，一律拒绝。
#    同族判据见 `apps/desktop-macos/scripts/package-app.sh` 的 `OUT_DIR` 那一段
#    （都是"这句 rm -rf 打的是调用方传进来的路径"）。
# 3. **白名单优先于黑名单**：`ios-tf-artifacts` / `*.xcarchive` / `*.ipa` / `*.dSYM` / `.git`
#    命中即**永不删**，而且**整棵子树跳过** —— 所以 `ios-tf-artifacts/node_modules` 也不删。
#    原因不是"整洁"：发布与符号化要用 `xcarchive`/`ipa`/`dSYM`，重建代价不是"再跑一次构建"，
#    而是"这次发布没了"。
#
# ## 为什么可删名单只认**精确目录名**，不用模糊 glob
#
# `node_modules*` / `*dist*` 在 `rm -rf` 面前是灾难：`dist-esm` 是产物、`distribution-notes.md`
# 是文档、`node_modules.bak` 可能是别人正在救的现场。名单里每一项都必须是**能重建**的
# —— 清掉之后重跑构建就长回来。
#
# `evidence` 单列一个开关（`--include-evidence`）：它和主仓库的 `apps/*/evidence` **同名**，
# 而主仓库那一份是**取证**（AGENTS §6.2 规定一），误删代价最高 ⇒ 默认不动，人看过再加开关。
#
# ## 用法
#
#   bash scripts/clean-carriers.sh                     # 干跑：列"会删什么 + 能释放多少"
#   bash scripts/clean-carriers.sh --apply             # 真删
#   bash scripts/clean-carriers.sh --include-evidence  # 连 evidence 一起（默认不动它）
#   bash scripts/clean-carriers.sh --keep my-vendor    # 追加白名单（可重复）
#   bash scripts/clean-carriers.sh --json              # 只往 stdout 吐 JSON（给后续脚本用）
#                                                      # 形状判据那几条 exit 4 时 stdout 为空，原因在 stderr
#   HEYTA_CARRIERS_ROOT=/tmp/fixture bash scripts/clean-carriers.sh   # 换根（自检 / 演练）
#
# 根目录：`$HEYTA_CARRIERS_ROOT`，默认 `$HOME/heyta-carriers`。
#
# ## 退出码
#
#   0 = 干净（无可清项）/ 全部删掉
#   1 = 有 N 项没删掉（逐条已 warn，其余项照常处理完）
#   2 = 参数不认识 / 参数值不合形状
#   4 = 根目录形状不合法（**一个字节都没动**）
#
set -uo pipefail
# 🔴 `set -f`（关掉 pathname expansion）是**承重的**，不是风格：
#    名单里的通配族 `tmp-*` / `*.tgz` 会出现在 `for p in $BL_PATTERNS` 这种词表里，
#    而**词表先做文件名展开、再到 `case` 里当模式用** —— 于是 `tmp-*` 在到达 `case`
#    之前就被替换成当前目录里几个**真实文件名**（本仓根目录正好有
#    `tmp-commit-plan.sh`、`tmp/`、`test-results/`）。后果不是报错，是**静默漏删**：
#    自检第一趟 `--apply` 之后 `tmp-r7` 原地没动，而五条别的规则全对 —— 一条
#    "看起来绿"的判据。`set -f` 不影响 `case` 的模式匹配（那不是文件名生成），
#    所以通配族仍然生效。
set -f

ROOT="${HEYTA_CARRIERS_ROOT:-$HOME/heyta-carriers}"
APPLY=0
INCLUDE_EVIDENCE=0
JSON=0
KEEP=""   # `--keep` 追加的白名单（空格分隔；下面会拒掉带空白的名字）

# ── 名单（**唯一事实源**：分类器、扫描剪枝、文档都从这里派生） ────────────────
# 白名单：永不删，且整棵子树跳过（发布/符号化要用）。
#
# 🔴 `*evidence*.tgz` 这一条不是"顺手多加的"：台账里 r103 的出处就是
#    `r103-clean-e2e-evidence/r103-evidence.tgz` —— 一个**证据包**被"旧打包"判据
#    删掉，等于把一条交付的出处一起删了。所以凡名字里带 evidence 的压缩包一律走白名单。
#    ⚠️ 它只匹配 `.tgz` 结尾，**不会**把 `evidence` 目录本身拉成白名单
#    （那样 `--include-evidence` 就永远失效了 —— 白名单的优先级在 evidence 之上）。
WL_EXACT="ios-tf-artifacts .git"
WL_PATTERNS="*.xcarchive *.ipa *.dSYM *evidence*.tgz"
# 黑名单：按**目录名/文件名精确匹配**，只有两个通配族（`tmp-*`、扩展名）。
BL_EXACT="node_modules Pods DerivedData .build dist dist-types test-results .gradle heyta-ios-release heyta-macos-dist"
BL_PATTERNS="tmp-* *.tgz *.dmg"
# 单独一档：默认不动，`--include-evidence` 才进可删。
EVIDENCE_NAME="evidence"

# ── 参数 ────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --include-evidence) INCLUDE_EVIDENCE=1 ;;
    --json) JSON=1 ;;
    --keep)
      shift
      [ $# -gt 0 ] || { echo "🔴 --keep 要给一个名字（例如 --keep my-vendor）" >&2; exit 2; }
      case "$1" in
        ''|*[[:space:]]*) echo "🔴 --keep 的名字不能为空、也不能含空白（读到：$1）" >&2; exit 2 ;;
      esac
      KEEP="${KEEP} $1"
      ;;
    -h|--help) sed -n '2,72p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "🔴 不认识的参数：$1（--help 看用法）" >&2; exit 2 ;;
  esac
  shift
done

# 输出门：`--json` 时人读的那些行全部闭嘴，stdout 只留 JSON（给后续脚本用）；warn 永远走 stderr。
say() { [ "$JSON" = 1 ] && return 0; printf '%s\n' "$*"; }
# 逐条那行也要走门：**每一条 printf 都是一枚"能绕过 --json 的口子"**，
# 自检第一趟就是被它抓到的 —— `--json` 的 stdout 里混进了人读的列表行，
# `JSON.parse` 当场炸，而脚本自己还以为"只是多打了几行"。
say_row() { [ "$JSON" = 1 ] && return 0; printf '  %10s  %s\n' "$1" "$2"; }
warn() { printf '%s\n' "$*" >&2; }

# ── 形状判据（`rm -rf` 之前必须先过这一关） ─────────────────────────────────
[ -n "$ROOT" ] || { echo "🔴 根目录是空字符串（HEYTA_CARRIERS_ROOT 读成空）—— 拒绝执行" >&2; exit 4; }
[ -d "$ROOT" ] || {
  echo "🔴 根目录不存在：${ROOT}" >&2
  echo "   （本脚本只清已经存在的 carrier 根：没有就没有可清的，不做\"帮你建一个\"）" >&2
  exit 4
}
# 用 `pwd -P` 取真实路径，不用 `realpath`：macOS 自带的 bash 3.2 环境里 `realpath` 不一定在，
# 而这条判据不能因为少一个工具就静默失效（同 `scripts/reinstall-all.sh` 的取法）。
ROOT_REAL="$(cd "$ROOT" 2>/dev/null && pwd -P)" || {
  echo "🔴 根目录无法解析：${ROOT}" >&2; exit 4; }
HOME_REAL="$(cd "$HOME" 2>/dev/null && pwd -P)" || HOME_REAL="$HOME"
REPO_ROOT="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd -P)" || REPO_ROOT=""

unsafe_root() {
  echo "🔴 拒绝执行：$1" >&2
  echo "   本脚本第一件事就是 rm -rf 命中项 —— 形状判据必须比手速快（exit 4，一个字节都没动）。" >&2
  exit 4
}
case "$ROOT_REAL" in
  /) unsafe_root "根解析后是 /（整台机器）" ;;
esac
[ "$ROOT_REAL" = "$HOME_REAL" ] && unsafe_root "根解析后是 \$HOME（${HOME_REAL}）"
if [ -n "$REPO_ROOT" ]; then
  [ "$ROOT_REAL" = "$REPO_ROOT" ] && unsafe_root "根解析后是仓库根（${REPO_ROOT}）"
  # 祖先也拒：根若是仓库的祖先，扫描会直接走进主仓库 —— carrier 根永远不该包含事实源。
  case "$REPO_ROOT" in
    "$ROOT_REAL"/*) unsafe_root "根是仓库根的祖先（${ROOT_REAL} ⊃ ${REPO_ROOT}）" ;;
  esac
fi

# ── 名字判定（自检与实际清理**共用同一份**，否则自检证的是另一套） ─────────────
# 白名单先判：一个名字同时像白名单与黑名单时，白名单赢。这条是本脚本最贵的性质，
# 所以它写在**最前面**，而不是靠调用方记得先问哪一句。
is_whitelisted_name() {
  local n="$1" p
  for p in $WL_EXACT $KEEP; do
    [ "$n" = "$p" ] && return 0
  done
  for p in $WL_PATTERNS; do
    case "$n" in $p) return 0 ;; esac
  done
  return 1
}

is_blacklisted_name() {
  local n="$1" p
  for p in $BL_EXACT; do
    [ "$n" = "$p" ] && return 0
  done
  for p in $BL_PATTERNS; do
    case "$n" in $p) return 0 ;; esac
  done
  return 1
}

# 🔴 下面两个判定**把结果写进全局变量**，而不是 `echo` 出来让调用方 `$(...)` 取。
#    原因不是风格：每条目一次命令替换就是**一次 fork**，而扫描是一万条量级
#    （本机现量：`~/heyta-carriers` 有 9896 条名单外条目）。2026-10-24 实测，
#    `$(classify_name)` + `$(whitelisted_ancestor)` 两枚 fork 把干跑从 ~2 s 拖到 **63 s**
#    （`user 21s sys 44s` —— 时间全花在 fork 上，不在读盘上）。bash 3.2 没有别的
#    返回值通道，所以用全局变量，调用方读完立刻用。

# 结果：`whitelist` / `evidence` / `clean` / `other` 之一。
# 🔴 判定顺序即优先级：白名单 > evidence > 黑名单 > 不动。
CLASSIFY_OUT="other"
classify_name() {
  local n="$1"
  if is_whitelisted_name "$n"; then CLASSIFY_OUT=whitelist; return 0; fi
  if [ "$n" = "$EVIDENCE_NAME" ]; then CLASSIFY_OUT=evidence; return 0; fi
  if is_blacklisted_name "$n"; then CLASSIFY_OUT=clean; return 0; fi
  CLASSIFY_OUT=other
}

# 路径里有没有**白名单组件**（相对根的那一串），结果放进 `ANCESTOR_OUT`（空 = 没命中）。
# 这一支是"白名单优先"的第二道闸：扫描剪枝已经不会走进白名单子树，但判据不能只靠
# find 的表达式 —— 那种依赖一旦被改坏，坏的方向是**删掉不该删的**。
ANCESTOR_OUT=""
whitelisted_ancestor() {
  local rel="$1" comp rest
  ANCESTOR_OUT=""
  rest="$rel"
  while [ -n "$rest" ]; do
    comp="${rest%%/*}"
    if [ "$comp" = "$rest" ]; then rest=""; else rest="${rest#*/}"; fi
    if is_whitelisted_name "$comp"; then ANCESTOR_OUT="$comp"; return 0; fi
  done
  return 0
}

# KB → 人读的体量。`du -k` 两侧都是 1024 字节块（GNU/BSD 同义），所以这里不做平台分支。
human_kb() {
  awk -v kb="$1" 'BEGIN{
    if (kb >= 1048576) printf "%.2f GB", kb / 1048576;
    else if (kb >= 1024) printf "%.1f MB", kb / 1024;
    else printf "%d KB", kb;
  }'
}

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# `--json` 的载荷从**同一批数组**派生，不另建一套账：两套账一定会漂，而漂的那一套
# 正好是后续脚本读的那一套。
emit_json() {
  local i sep
  printf '{\n'
  printf '  "root": "%s",\n' "$(json_escape "$ROOT")"
  printf '  "rootReal": "%s",\n' "$(json_escape "$ROOT_REAL")"
  printf '  "mode": "%s",\n' "$([ "$APPLY" = 1 ] && echo apply || echo dry-run)"
  printf '  "includeEvidence": %s,\n' "$([ "$INCLUDE_EVIDENCE" = 1 ] && echo true || echo false)"
  printf '  "reclaimableKb": %s,\n' "$KB_CLEAN"
  printf '  "reclaimedKb": %s,\n' "$KB_DEL"
  printf '  "deleted": %s,\n' "$N_DEL"
  printf '  "failed": %s,\n' "$N_FAIL"
  printf '  "items": ['
  sep=''
  i=0
  while [ "$i" -lt "${#ITEM_PATH[@]}" ]; do
    printf '%s\n    {"path": "%s", "kind": "%s", "kb": %s, "status": "%s"}' \
      "$sep" "$(json_escape "${ITEM_PATH[$i]}")" "${ITEM_KIND[$i]}" "${ITEM_KB[$i]}" "${ITEM_STATUS[$i]}"
    sep=','
    i=$((i + 1))
  done
  if [ "${#ITEM_PATH[@]}" -gt 0 ]; then printf '\n  '; fi
  printf ']\n}\n'
}

# ── 扫描 ────────────────────────────────────────────────────────────────────
# 🔴 尾随斜杠是承重的：macOS 的 `/tmp` 是 `private/tmp` 的**软链**，BSD `find` **不跟随
#    命令行参数里的软链** ⇒ `find /tmp -maxdepth 1 …` 会**安静地返回 0 项**
#    （`scripts/clean-build-tmp.sh` 里记了这段实测）。同理 `-mindepth 1` 也是承重的：
#    `find <dir>/ -maxdepth 1` 会把 `<dir>` 自己也列出来，根名恰好命中名单时会把根端掉。
SCAN_ROOT="${ROOT%/}/"

# 剪枝表达式：**只**剪"分类器会动手的名字"（白名单 + 黑名单 + evidence）。
# 名单外的名字一律不剪 —— 那样它的子目录还会被扫到，不会因为剪枝过头而漏掉该删的。
FIND_ARGS=()
n_prune=0
for spec in $WL_EXACT $KEEP $BL_EXACT "$EVIDENCE_NAME" $BL_PATTERNS $WL_PATTERNS; do
  if [ "$n_prune" -gt 0 ]; then FIND_ARGS[${#FIND_ARGS[@]}]="-o"; fi
  FIND_ARGS[${#FIND_ARGS[@]}]="-name"
  FIND_ARGS[${#FIND_ARGS[@]}]="$spec"
  n_prune=$((n_prune + 1))
done

# 三个平行数组（bash 3.2 没有 `mapfile`、也不该用关联数组）：路径 / 体量 / 档位 / 状态。
# 不用 `… | while …` 收集：管道右段在**子 shell** 里跑，计数器回来就丢了
# （`scripts/clean-build-tmp.sh` 因此只能在子 shell 里打印、不能累加）。
CLEAN_PATH=(); CLEAN_KB=()
EVID_PATH=();  EVID_KB=()
PROT_PATH=();  PROT_KB=()
ITEM_PATH=();  ITEM_KB=(); ITEM_KIND=(); ITEM_STATUS=()
N_OTHER=0
N_CLEAN=0; N_EVID=0; N_PROT=0
KB_CLEAN=0

add_item() { # <path> <kb> <kind> <status>
  ITEM_PATH[${#ITEM_PATH[@]}]="$1"
  ITEM_KB[${#ITEM_KB[@]}]="$2"
  ITEM_KIND[${#ITEM_KIND[@]}]="$3"
  ITEM_STATUS[${#ITEM_STATUS[@]}]="$4"
}

while IFS= read -r p; do
  [ -n "$p" ] || continue
  # 防御纵深：find 的根是 SCAN_ROOT，命中项必须落在它下面。
  case "$p" in
    "$SCAN_ROOT"*) ;;
    *) warn "⚠️ 跳过不属于根的路径：$p"; continue ;;
  esac
  rel="${p#"$SCAN_ROOT"}"
  base="${p##*/}"

  whitelisted_ancestor "$rel"
  if [ -n "$ANCESTOR_OUT" ]; then
    # 白名单子树里的任何东西都到这里为止 —— 包括 `ios-tf-artifacts/node_modules`。
    kb="$(du -sk "$p" 2>/dev/null | awk 'NR==1{print $1}')"; kb="${kb:-0}"
    PROT_PATH[${#PROT_PATH[@]}]="$p"; PROT_KB[${#PROT_KB[@]}]="$kb"; N_PROT=$((N_PROT + 1))
    add_item "$p" "$kb" protected kept
    continue
  fi

  classify_name "$base"
  # `du` 只对**要动手的条目**算：名单外的条目（一万条量级）不算体量，
  # 否则每个目录一次 `du -sk` 会把整棵树反复量一遍（嵌套目录 = 平方级）。
  case "$CLASSIFY_OUT" in
    other) N_OTHER=$((N_OTHER + 1)); continue ;;
  esac
  kb="$(du -sk "$p" 2>/dev/null | awk 'NR==1{print $1}')"
  kb="${kb:-0}"

  # 这里不可能再出现 `whitelist`：白名单条目**自己**就是那道祖先闸的最后一个组件，
  # 上面那个分支已经把它收走了（写成两处判定才是真正的隐患 —— 一份会漂的重复逻辑）。
  case "$CLASSIFY_OUT" in
    evidence)
      if [ "$INCLUDE_EVIDENCE" = 1 ]; then
        CLEAN_PATH[${#CLEAN_PATH[@]}]="$p"; CLEAN_KB[${#CLEAN_KB[@]}]="$kb"
        N_CLEAN=$((N_CLEAN + 1)); KB_CLEAN=$((KB_CLEAN + kb))
        add_item "$p" "$kb" evidence would-delete
      else
        EVID_PATH[${#EVID_PATH[@]}]="$p"; EVID_KB[${#EVID_KB[@]}]="$kb"; N_EVID=$((N_EVID + 1))
        add_item "$p" "$kb" evidence kept
      fi
      ;;
    clean)
      CLEAN_PATH[${#CLEAN_PATH[@]}]="$p"; CLEAN_KB[${#CLEAN_KB[@]}]="$kb"
      N_CLEAN=$((N_CLEAN + 1)); KB_CLEAN=$((KB_CLEAN + kb))
      add_item "$p" "$kb" clean would-delete
      ;;
  esac
done < <(find "$SCAN_ROOT" -mindepth 1 \( "${FIND_ARGS[@]}" \) -prune -print -o -print 2>/dev/null)

# ── 人读输出 ────────────────────────────────────────────────────────────────
say "════ carrier 一次性搬运树清理 ════"
say "  根目录   = ${ROOT}"
say "  真实路径 = ${ROOT_REAL}"
say "  模式     = $([ "$APPLY" = 1 ] && echo '🔴 APPLY（真删）' || echo 'dry-run（只列，不动任何文件）')"
say "  证据     = $([ "$INCLUDE_EVIDENCE" = 1 ] && echo '纳入清理（--include-evidence）' || echo '保留（evidence 默认不动）')"
say "  白名单   = ${WL_EXACT} ${KEEP} ${WL_PATTERNS}（命中即整棵子树跳过）"
say ""

if [ "$N_CLEAN" -gt 0 ]; then
  say "── 可删（可重建：重跑构建就长回来）──"
  i=0
  while [ "$i" -lt "$N_CLEAN" ]; do
    say_row "$(human_kb "${CLEAN_KB[$i]}")" "${CLEAN_PATH[$i]}"
    i=$((i + 1))
  done
  say "  ────────────────────────────────────────────"
  say "  合计 $(human_kb "$KB_CLEAN") / ${N_CLEAN} 项"
else
  say "没有可清的产物"
fi

if [ "$N_EVID" -gt 0 ]; then
  say ""
  say "── 证据（默认保留；要清加 --include-evidence）──"
  i=0
  while [ "$i" -lt "$N_EVID" ]; do
    say_row "$(human_kb "${EVID_KB[$i]}")" "${EVID_PATH[$i]}"
    i=$((i + 1))
  done
fi

if [ "$N_PROT" -gt 0 ]; then
  say ""
  say "── 🔴 白名单（永不删，即使名字命中可删名单）──"
  i=0
  while [ "$i" -lt "$N_PROT" ]; do
    say_row "$(human_kb "${PROT_KB[$i]}")" "${PROT_PATH[$i]}"
    i=$((i + 1))
  done
fi

say ""
say "  名单外（保守不动）${N_OTHER} 项"

# ── dry-run 到此为止 ────────────────────────────────────────────────────────
N_DEL=0; KB_DEL=0; N_FAIL=0

if [ "$APPLY" != 1 ]; then
  say ""
  say "DRY-RUN：什么都没删，加 --apply 才真删"
  say "可释放 $(human_kb "$KB_CLEAN") / 已释放 0 KB（0 项）"
  if [ "$JSON" = 1 ]; then emit_json; fi
  exit 0
fi

if [ "$N_CLEAN" -eq 0 ]; then
  say ""
  say "可释放 0 KB / 已释放 0 KB（0 项）"
  if [ "$JSON" = 1 ]; then emit_json; fi
  exit 0
fi

# ── 真删 ────────────────────────────────────────────────────────────────────
say ""
say "── 执行删除 ──"
i=0
while [ "$i" -lt "$N_CLEAN" ]; do
  p="${CLEAN_PATH[$i]}"
  kb="${CLEAN_KB[$i]}"
  if rm -rf -- "$p" 2>/dev/null && [ ! -e "$p" ]; then
    say "  🗑 已删 $(human_kb "$kb")  ${p}"
    N_DEL=$((N_DEL + 1)); KB_DEL=$((KB_DEL + kb))
    # 状态回写：JSON 与"逐条打印"要说同一件事（两套账是最容易漂的地方）。
    j=0
    while [ "$j" -lt "${#ITEM_PATH[@]}" ]; do
      if [ "${ITEM_PATH[$j]}" = "$p" ]; then ITEM_STATUS[$j]="deleted"; break; fi
      j=$((j + 1))
    done
  else
    # 🔴 删不掉只 warn、不中断：其余项该删的照删，最后用退出码统一报"有 N 项没删掉"。
    warn "  ⚠️ 删不掉（继续处理其余项）：${p}"
    N_FAIL=$((N_FAIL + 1))
    j=0
    while [ "$j" -lt "${#ITEM_PATH[@]}" ]; do
      if [ "${ITEM_PATH[$j]}" = "$p" ]; then ITEM_STATUS[$j]="failed"; break; fi
      j=$((j + 1))
    done
  fi
  i=$((i + 1))
done

say ""
say "可释放 $(human_kb "$KB_CLEAN") / 已释放 $(human_kb "$KB_DEL")（${N_DEL} 项）"
if [ "$N_FAIL" -gt 0 ]; then
  warn "🔴 有 ${N_FAIL} 项没删掉（其余 $(human_kb "$KB_DEL") 已释放；加 sudo 或手工看那几条 warn）"
fi
if [ "$JSON" = 1 ]; then emit_json; fi
[ "$N_FAIL" -eq 0 ] || exit 1
exit 0
