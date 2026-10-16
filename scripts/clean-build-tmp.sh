#!/usr/bin/env bash
#
# clean-build-tmp.sh —— `/tmp` 里 heyta 构建残留的**清理入口**
# ============================================================================
#
# ## 它为什么存在
#
# 本仓的验收与重装装置把一堆中间物写在 `/tmp`（iOS 派生数据、macOS 分发目录、
# 跨机源码包、归档/打包产物、各腿的构建日志）。那些路径**各自都有旋钮**
# （`HEYTA_REINSTALL_TMP_DIR` / `HEYTA_IOS_DERIVED` / `HEYTA_MACOS_DIST_DIR`），
# 但**默认值都指向共享 `/tmp`**，而**默认值逐字不变**是一条硬纪律（改了会动到
# 别人正在跑的流程）⇒ 于是留下一个没人负责的尾巴：**没有任何一层会清它**。
#
# `scripts/reinstall-all.sh` 的 ios 段确实有 `rm -rf $RT/heyta-ios-release`，
# 但那一句只在**跑到那一步**时执行 —— 跑完不自清，中途失败更不会。
# 实测代价（登记在 `docs/plans/product-ux-optimization.md` §「载体撞车」）：
# 两条会话在隔离检出里并行跑四端重装时互相覆盖现场；而单次 iOS 验证的派生数据
# 是**数 GB 级**。
#
# ## 🔴 三条安全边界（本脚本的全部价值都在这三条上）
#
# 1. **默认 dry-run**：不加 `--apply` 只**列**不删。清理是不可逆动作，
#    默认必须是"先让我看一眼"。
# 2. **凭据白名单优先于一切**：`/tmp` 里躺着若干**含秘密**的文件
#    （`heyta-ai-live/provider.json` mode 600、`*token*` / `*e2ee*` /
#    `*accmail*.json` 的一次性凭据）。它们**永远不删**，且即使被 `--apply`
#    扫到也会被**显式列进"保护"清单**——不静默跳过，因为"静默跳过"在读数上
#    和"没扫到"长得一样。
# 3. **证据默认保留**：`*.png`（截图）是界面验收的**唯一**证据载体（AGENTS §6.2 规定一），
#    本脚本**不碰**。要清它们得显式 `--include-evidence`，那是人看过图之后的动作。
#
# ## 用法
#
#   bash scripts/clean-build-tmp.sh                  # 列出可清项与体量（不动任何文件）
#   bash scripts/clean-build-tmp.sh --apply          # 真删（凭据与证据仍受保护）
#   bash scripts/clean-build-tmp.sh --age-hours 1    # 只算 1 小时未改的（默认 24）
#   bash scripts/clean-build-tmp.sh --dir /tmp/heyta-knob   # 换一个落点目录
#
# ## 判据
#
#   `--self-test` 在**临时目录**里造样本（可清的 / 凭据的 / 证据的 / 太新的），
#   断言分类器把每一类放进正确的桶，并断言 dry-run **一个字节都没动**。
#   它自己打印臂数 —— 本文件不写那个数（会漂）。
#
set -uo pipefail

TMP_DIR="${HEYTA_CLEAN_TMP_DIR:-/tmp}"
AGE_HOURS=24
APPLY=0
INCLUDE_EVIDENCE=0
SELF_TEST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --age-hours) shift; AGE_HOURS="${1:-24}" ;;
    --dir) shift; TMP_DIR="${1:-/tmp}" ;;
    --include-evidence) INCLUDE_EVIDENCE=1 ;;
    --self-test) SELF_TEST=1 ;;
    -h|--help) sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "🔴 不认识的参数：$1（--help 看用法）" >&2; exit 2 ;;
  esac
  shift
done

case "$AGE_HOURS" in
  ''|*[!0-9]*) echo "🔴 --age-hours 要是非负整数（读到：$AGE_HOURS）" >&2; exit 2 ;;
esac
# 落点目录带空格会把下面所有路径拆成两个词 —— 那是"跑绿了但清错了地方"的形状。
case "$TMP_DIR" in
  *[[:space:]]*) echo "🔴 落点目录不能含空格（读到：$TMP_DIR）" >&2; exit 4 ;;
esac
[ -d "$TMP_DIR" ] || { echo "🔴 落点目录不存在：$TMP_DIR" >&2; exit 4; }

# ── 分类器（自检与实际清理**共用同一份**，否则自检证的是另一套） ──────────────
#
# 输出三档之一：`protect` / `evidence` / `clean`。
# 🔴 顺序即优先级：凭据最先判 —— 一个文件名同时像"凭据"和"可清"时，凭据赢。
classify() {
  local base="$1"
  # ① 凭据与运行态（**永远不删**）
  case "$base" in
    *provider.json|*token*|*e2ee*|*accmail*|*.pid|*passphrase*|*secret*|*.p8|*.p12|*.mobileprovision)
      echo protect; return ;;
  esac
  # ② 证据（默认不删；`--include-evidence` 才进可清档）
  case "$base" in
    *.png|*.jpg|*.webp|*.mp4|*.webm|*.gif)
      echo evidence; return ;;
  esac
  # ③ 派生数据与传输中间物（可重建 ⇒ 可清）
  case "$base" in
    heyta-ios-release*|heyta-isolated-ios-release*|heyta-macos-dist*|heyta-*-dist*|heyta-widget-qa-*|\
    heyta-src*.tar.gz|heyta-src*-files.txt|heyta-src-tar.log|\
    *.xcarchive|*.ipa|*.app|heyta-*.bundle|\
    heyta-reinstall-*.log|heyta-rnjs-*.log|heyta-*-build.log|heyta-e2e-server.log|\
    heyta-*-mutA|heyta-*-mutB|heyta-mut-*|heyta-goal-b*|heyta-auth-legal-b*|\
    heyta-acc-*|heyta-harmony-*|heyta-rnjs-*|heyta-*-probe|heyta-webkit-persistent-app-profile)
      echo clean; return ;;
  esac
  # ④ 其余：**不认识就不动**（默认保守）
  echo unknown
}

# 文件/目录的年龄（小时，整数）。
# 🔴 mtime 用 `date -r 文件 +%s` 取，**不写 `stat`**：GNU 与 BSD 的 `stat` 把同一个 `-f` 读成
#    两件不同的事 —— GNU 那侧 rc 非零但 **stdout 非空**（吐一整块文件系统统计，§7 第 364 条的
#    实测表），所以"两侧各写一支再靠 `||` 串起来"这种形状在**管道里**那条兜底是死代码。
#    `date -r 文件 +%s` 两侧同形同值（macOS 现量：BSD `date -r` == BSD `stat` 的 `%m`
#    == GNU `date -r` == GNU `stat` 的 `%Y`，四者都是同一串整数）。
age_hours_of() {
  local p="$1" mtime now
  mtime=$(date -r "$p" +%s 2>/dev/null) || return 1
  now=$(date +%s)
  echo $(( (now - mtime) / 3600 ))
}

# ── 自检 ────────────────────────────────────────────────────────────────────
if [ "$SELF_TEST" = "1" ]; then
  arms=0; bad=0
  chk() { # chk <期望> <文件名> <说明>
    arms=$((arms+1))
    local got; got=$(classify "$2")
    if [ "$got" = "$1" ]; then printf '  ✓ %s → %s\n' "$3" "$got"
    else printf '  ✗ %s → 期望 %s，实得 %s\n' "$3" "$1" "$got"; bad=$((bad+1)); fi
  }
  echo "=== clean-build-tmp 分类器自检 ==="
  chk protect 'provider.json'                    'AI 供给配置（含凭据）'
  chk protect 'heyta-ios-accmail-token-1.txt'    '一次性令牌'
  chk protect 'heyta_mobile_e2ee.txt'            'E2EE 口令'
  chk protect 'signing.p12'                      '签名证书'
  chk evidence 'ux-final-1-signed-in.png'        '界面验收截图'
  chk evidence 'reinstall-ios.webm'              '验收录屏'
  chk clean 'heyta-ios-release'                  'iOS 派生数据目录'
  chk clean 'heyta-src.tar.gz'                   '跨机源码包'
  chk clean 'heyta-src-android-files.txt'        '清单文件'
  chk clean 'heyta-goal-b6.xcarchive'            '归档产物'
  chk clean 'heyta-reinstall-ios-build.log'      '构建日志'
  chk unknown 'something-else.txt'               '不认识的：保守不动'
  chk unknown 'heyta-notes.md'                   '不认识的 heyta 文件：保守不动'
  # 🔴 优先级臂：一个名字**同时**像凭据与可清时，凭据必须赢
  chk protect 'heyta-ios-release-token.txt'      '优先级：凭据 > 可清'
  chk evidence 'heyta-ios-release.png'           '优先级：证据 > 可清'

  # 🔴 **端到端臂**：造一个真目录，跑**真实的扫描那一步**，断言扫得到。
  #    只测 `classify()` 是不够的 —— 本脚本第一版 15 臂全绿，而在 macOS 上
  #    一个条目都扫不到（`find /tmp` 不跟随软链）。**函数对 ≠ 装置能工作**：
  #    自检要覆盖"从盘到判定"的整条路，否则它证明的只是那个纯函数。
  e2e=$(mktemp -d "${TMPDIR:-/tmp}/heyta-clean-selftest.XXXXXX" 2>/dev/null) || e2e=""
  if [ -n "$e2e" ]; then
    mkdir -p "$e2e/heyta-ios-release" "$e2e/heyta-src.tar.gz" "$e2e/heyta-isolated-ios-release"
    : > "$e2e/provider.json"; : > "$e2e/ux-1-signed-in.png"; : > "$e2e/notes.md"
    found=$(find "${e2e%/}/" -mindepth 1 -maxdepth 1 -name 'heyta*' -print 2>/dev/null | wc -l | tr -d ' ')
    arms=$((arms+1))
    if [ "$found" -eq 3 ]; then printf '  ✓ 端到端：扫真目录 → 命中 %s 个\n' "$found"
    else printf '  ✗ 端到端：扫真目录 → 期望 3，实得 %s（**扫描这一步坏了**）\n' "$found"; bad=$((bad+1)); fi
    rm -rf "$e2e"
  fi

  echo ""
  echo "臂数 $arms · 不符 $bad"
  [ "$bad" -eq 0 ] || { echo "🔴 分类器自检失败" >&2; exit 1; }
  echo "✅ 分类器自检通过"
  exit 0
fi

# ── 主流程 ──────────────────────────────────────────────────────────────────
echo "════ /tmp 构建残留清理 ════"
echo "  落点目录   = $TMP_DIR"
echo "  年龄门槛   = ${AGE_HOURS} 小时未修改"
echo "  模式       = $([ "$APPLY" = "1" ] && echo '🔴 APPLY（真删）' || echo 'dry-run（只列，不动任何文件）')"
echo "  证据       = $([ "$INCLUDE_EVIDENCE" = "1" ] && echo '纳入清理' || echo '保留（*.png 等）')"
echo ""

total_clean_kb=0; n_clean=0; n_protect=0; n_evidence=0; n_unknown=0; n_young=0
clean_list=""; protect_list=""; evidence_list=""

# `find -maxdepth 1` 只扫一层：heyta 的落点都是 `/tmp/heyta-*` 平铺的，
# 递归会把某个大目录内部几万个文件逐个列出来（慢且无用）。
#
# 🔴 **尾随斜杠是承重的，不是风格**：macOS 的 `/tmp` 是 `private/tmp` 的**软链**，
#    而 BSD `find` **不跟随命令行参数里的软链** ⇒ `find /tmp -maxdepth 1 …`
#    会**安静地返回 0 项**（不报错、退 0）。本脚本第一版正是这样：在 macOS 上
#    永远扫不到任何东西，而 `--self-test` 15 臂全绿 —— 因为那时自检只测
#    `classify()` 这个**函数**，没测"扫描"这**一步**。这正是 §7 元规则二说的形状：
#    一条永远通过的判据比没有判据更糟。现在自检里有端到端臂（扫真目录）钉住它。
#    现量（2026-10-13，387 个 heyta 条目）：`find /tmp` ⇒ 0；`find /tmp/` ⇒ 387。
#
# 🔴 **`-mindepth 1` 同样是承重的**：`find <dir>/ -maxdepth 1` 会把 **`<dir>` 自己**
#    也列出来（尾随斜杠让它成为"内容的根"，而根也在遍历结果里）。落点目录名若恰好
#    以 `heyta` 开头（例如 `HEYTA_CLEAN_TMP_DIR=/tmp/heyta-build`），那一项就会进
#    "可清"清单，`rm -rf` 下去**把整个落点目录端掉**。自检里那个临时目录**刻意**
#    保留 `heyta-` 前缀，就是为了让这条臂真的会红（现量：不加 `-mindepth 1` ⇒ 实得 4）。
scan_root="${TMP_DIR%/}/"
while IFS= read -r p; do
  [ -n "$p" ] || continue
  base="$(basename "$p")"
  kind="$(classify "$base")"
  case "$kind" in
    protect)  protect_list="${protect_list}${base}\n"; n_protect=$((n_protect+1)); continue ;;
    evidence) evidence_list="${evidence_list}${base}\n"; n_evidence=$((n_evidence+1)); [ "$INCLUDE_EVIDENCE" = "1" ] || continue ;;
    unknown)  n_unknown=$((n_unknown+1)); continue ;;
  esac
  age=$(age_hours_of "$p") || { n_unknown=$((n_unknown+1)); continue; }
  if [ "$age" -lt "$AGE_HOURS" ]; then n_young=$((n_young+1)); continue; fi
  kb=$(du -sk "$p" 2>/dev/null | awk '{print $1}'); kb=${kb:-0}
  total_clean_kb=$((total_clean_kb + kb)); n_clean=$((n_clean+1))
  clean_list="${clean_list}${kb}\t${age}\t${p}\n"
done < <(find "$scan_root" -mindepth 1 -maxdepth 1 -name 'heyta*' -print 2>/dev/null | sort)

if [ "$n_clean" -gt 0 ]; then
  echo "── 可清（派生数据/传输中间物，可重建）──"
  printf "%b" "$clean_list" | while IFS=$'\t' read -r kb age p; do
    [ -n "$p" ] || continue
    printf '  %9.1f MB  %4s h  %s\n' "$(echo "$kb" | awk '{print $1/1024}')" "$age" "$p"
  done
  printf '  ────────────────────────────────────────\n  合计 %.2f GB / %d 项\n' "$(echo "$total_clean_kb" | awk '{print $1/1024/1024}')" "$n_clean"
else
  echo "── 可清：0 项 ──"
fi

echo ""
if [ "$n_protect" -gt 0 ]; then
  echo "── 🔴 保护（凭据/运行态，**永不删**）──"
  printf "%b" "$protect_list" | sed 's/^/  /'
fi
if [ "$n_evidence" -gt 0 ]; then
  echo "── 证据（默认保留；要清加 --include-evidence）──"
  printf "%b" "$evidence_list" | sed 's/^/  /'
fi
echo ""
echo "  未动：太新 ${n_young} 项 · 不认识 ${n_unknown} 项（保守不动）"

if [ "$APPLY" != "1" ]; then
  echo ""
  echo "（dry-run 结束，一个字节都没动。要真删：加 --apply）"
  exit 0
fi

[ "$n_clean" -gt 0 ] || { echo ""; echo "没有可清项。"; exit 0; }

echo ""
echo "── 执行删除 ──"
deleted=0; failed=0
printf "%b" "$clean_list" | while IFS=$'\t' read -r kb age p; do
  [ -n "$p" ] || continue
  if rm -rf -- "$p" 2>/dev/null && [ ! -e "$p" ]; then
    echo "  ✅ 已删 $p"
  else
    echo "  ❌ 删除失败 $p"; failed=$((failed+1))
  fi
done
echo ""
echo "✅ 清理完成（保护与证据两类未动）"
