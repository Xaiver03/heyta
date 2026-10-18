#!/usr/bin/env bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份脚本拷成同目录隐藏快照再 exec 副本 —— 之后对源文件的任何
#    编辑都影响不到本次运行；$0 的 dirname 不变，REPO 定位照旧。
case "$(basename "$0")" in
  .*.snap.*) ;; # 已是快照：正常往下跑
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT
#
# macOS 原生壳：**小组件环境识别** + **外链交给浏览器** 两格的壳级取证（后台、不抢前台）。
#
#   bash scripts/verify-macos-widget-help.sh
#   HEYTA_WIDGET_HELP_EVIDENCE_OUT=apps/desktop-macos/evidence/widget-help-dom-<趟号>.txt \
#     bash scripts/verify-macos-widget-help.sh
#
# ## 它闭的是哪一格，为什么不是 AX 那一枚
# 本仓已有的 `scripts/qa/macos-installed-widget-help.sh` 走 macOS Accessibility，
# 而**未被激活的实例不向辅助功能暴露窗口列表** —— 2026-10-10 实测：同一时刻窗口服务器
# 读到 `heyta heyta 1159x754`，System Events 报 `count of windows = 0`。
# ⇒ 那枚装置必须跑在前台实例上，与 AGENTS §6.2 规定二（任何会开窗口的验收都不得抢走
#   用户的输入焦点）直接冲突。本装置改走这个壳**本来就在用**的另一条通道：
#   `evaluateJavaScript`（`HEYTA_WIDGET_HELP_PROBE=1` 启用那条诊断链）。
#   后台跑、不激活、不抢键盘、也不需要录屏权限。
#
# ## 判据住在装置侧，不在壳里（分工是刻意的）
# 壳（`HeytaMacApp.swift` 的 `runWidgetJourneyChain`）只出**原文读数**；
# "哪些行算 PWA 安装引导 / 哪些算原生小组件引导"由 `scripts/qa/macos-widget-help-judge.mjs`
# 按**键名集合**分，键名集合的真源是 `apps/web/src/pwa/widget-install.ts`
# （经 `scripts/qa/widget-step-words.mjs` 读，理由写在那枚文件的文件头：两套键都带
# `.step`、都渲染成带序号的行，所以形状判据会在**产品该有的样子**上报红）。
#
# ## 🔴 这一趟**没有**证到的那一格（不许读成"外链已验证可达"）
# 诊断链里壳故意**不**叫起浏览器（`WIDGET_EXTERNAL_LAUNCH=suppressed`）——
# `NSWorkspace.open` 会把用户的浏览器带到前台并开标签页。所以本趟证的是：
# scheme 判定 + 壳收到哪个 URL + **壳自己没有跟着导航过去**（`BEFORE == AFTER`）。
# "浏览器里真的渲染出那一页"仍归前台 AX 装置。判到会单独印一行 `BOUNDARY=`。
#
# ## 读数自带出处（每一条都现量，不抄）
# `TREE=` 当前 HEAD + 相关路径的未提交状态；`SHELL_BINARY_FRESHNESS=` 壳二进制里
# 那枚 env 门控常量的命中数（不在 = 打的是改动之前的旧构建）；`WEB_DIST_SHA=`。
#
# 退出码：0 两格闭合 / 1 判据红（含壳编不过 = 源码缺陷）/ 3 环境无效
#         （产物不是当前源码、上一趟残留没清）—— 环境无效**不算**产品失败，也不许算通过。
#
# ⚠️ 本仓库一律按 **bash 3.2**（macOS 自带）写：不用 `declare -A`（AGENTS §7 第 40 条）。
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SHELL_DIR="$REPO/apps/desktop-macos"
WEB_DIST="$REPO/apps/web/dist"
BRIDGE="$REPO/packages/app-host/bridge-bundle/native-bridge.js"
JUDGE="$REPO/scripts/qa/macos-widget-help-judge.mjs"
STAMP=$(date +%m%d-%H%M%S)
RUN_TAG="widget-help-$STAMP"

# 🔴 落点：**私有目录**，不是共享 /tmp 里一个按秒命名的固定名。
#    同一台机器上有多个并行会话在跑取证，撞过的现场记在本计划「载体撞车」那一格
#    （四端重装那批固定 /tmp 路径把本线的 iOS 截图吃掉过一回）。
#    要复用就显式给 `HEYTA_WIDGET_HELP_RUN_DIR`（与 `HEYTA_REINSTALL_TMP_DIR` 同一口径）。
RUN_DIR="${HEYTA_WIDGET_HELP_RUN_DIR:-$HOME/heyta-carriers/macos-$RUN_TAG}"
DB_DIR="$RUN_DIR/db"
EV_PREFIX="$RUN_DIR/evidence"
RUN_LOG="$RUN_DIR/run.log"
BUILD_LOG="$RUN_DIR/swift-build.log"
EXEC_NAME="HeytaMacWidgetHelp$STAMP"
SETTLE="${SETTLE:-90}"
EXPECTED_SITE="${HEYTA_HELP_EXTERNAL_URL:-https://heyta.waytofuture.cn}"
# 🔴 **逃生门臂**：调用方设了 `HEYTA_SHELL_STORAGE` 就原样转发给壳（macOS 壳在
#    `apps/desktop-macos/Sources/HeytaMac/ShellStorageHost.swift` 里读它，`=0` 显式关掉宿主端口）。
#    那一臂下**本装置的判据不适用**：判据钉的是"原生形状"（状态行=正在原生桌面应用中运行、
#    安装引导 0 行），而门关掉后界面**按设计**改教"先把 heyta 装成应用"（见
#    `apps/web/src/pwa/widget-install.ts` 那段逃生门注释）⇒ 拿原生判据去量它必然红，而那条红不是缺陷。
#    所以这一臂只出读数、跳过判据，退出码只代表"探针有没有闭合"。
STORAGE_GATE="${HEYTA_SHELL_STORAGE:-}"
GATE_ENV=()
if [ -n "$STORAGE_GATE" ]; then GATE_ENV=("HEYTA_SHELL_STORAGE=$STORAGE_GATE"); fi
# 改这几行的人：判据在装置侧，读数键名在壳侧 —— 两边都要动才配得上"加一格读数"。

fails=0
ok()   { printf '   ✅ %s\n' "$1"; }
bad()  { printf '   🔴 %s\n' "$1"; fails=$((fails + 1)); }
env_invalid() { printf '\n🔴 环境无效：%s\n' "$1"; printf 'RESULT=INVALID_ENV（不是产品失败，也不许算通过）\n'; exit 3; }
step() { printf '\n── %s ──\n' "$1"; }

[ -f "$JUDGE" ] || env_invalid "判据文件不在（${JUDGE}）"
mkdir -p "$RUN_DIR" "$DB_DIR" || env_invalid "建不出私有落点（${RUN_DIR}）"

step "1. 从当前源码构建壳（增量；编不过是**源码缺陷**，按红算不按环境算）"
( cd "$SHELL_DIR" && swift build --product HeytaMac ) >"$BUILD_LOG" 2>&1
BUILD_RC=$?
if [ "$BUILD_RC" -ne 0 ]; then
  bad "swift build rc=$BUILD_RC —— 读 $BUILD_LOG"
  head -20 "$BUILD_LOG" | sed 's/^/     | /'
  printf '\nRESULT=FAIL\n'
  exit 1
fi
BIN="$SHELL_DIR/.build/out/Products/Debug/HeytaMac"
[ -x "$BIN" ] || env_invalid "构建说成功了，可壳二进制不在（${BIN}）—— 这个症状和「压根没构建」逐字一样，所以这一档必须查"
ok "壳已构建（rc=0，二进制 ${BIN}）"

# 🔴 新鲜度按**内容**量，不按 mtime：mtime 在共享工作树里天天因为别人的改动漂移，
#    而它真正要挡的是"跑的是改动之前的旧构建"。这一趟新加的那枚 env 常量
#    只可能来自诊断链那一版源码 ⇒ 命中 0 = 旧二进制 = 后面所有读数都不是这一批的。
if command -v strings >/dev/null 2>&1; then
  PROBE_HITS=$(strings "$BIN" 2>/dev/null | grep -c "HEYTA_WIDGET_HELP_PROBE" || true)
else
  PROBE_HITS=$(grep -c "HEYTA_WIDGET_HELP_PROBE" "$BIN" 2>/dev/null || true)
fi
case "$PROBE_HITS" in
  ''|*[!0-9]*) PROBE_HITS=0 ;;
esac
if [ "$PROBE_HITS" -eq 0 ]; then
  bad "壳二进制里读不到 HEYTA_WIDGET_HELP_PROBE ⇒ 打的是诊断链之前的旧构建，本趟读数全部作废"
  printf '\nRESULT=FAIL\n'
  exit 1
fi
ok "壳产物含诊断链（HEYTA_WIDGET_HELP_PROBE 命中 $PROBE_HITS 处）"

step "2. 页侧产物是当前的（判据按内容，不按 mtime）"
[ -f "$WEB_DIST/index.html" ] || env_invalid "共享 UI 产物不在（${WEB_DIST}）—— 先 pnpm --filter @heyta/web build"
if ! grep -rq "widget-journey-panel" "$WEB_DIST"/assets/*.js 2>/dev/null; then
  env_invalid "apps/web/dist 里读不到 widget-journey-panel ⇒ 打的是小组件面板之前的旧构建，先重建页侧产物"
fi
ok "页侧产物含小组件面板"
[ -f "$BRIDGE" ] || env_invalid "原生桥产物不在（${BRIDGE}）—— 先跑 node packages/app-host/scripts/build-native-bridge.mjs"
ok "原生桥产物在"

step "3. 没有别的同形状会话在跑（共享载体独占）"
if pgrep -f "HeytaMacWidgetHelp" >/dev/null 2>&1; then
  env_invalid "已经有一趟小组件/外链验收在跑（pgrep 命中 HeytaMacWidgetHelp）⇒ 不并发抢同一层隔离"
fi
ok "本形状独占"

# 🔴 安全档 S：这一档问的是"本趟有没有碰用户本机那一份真库"。
#    五项合起来才叫"没动过"（只比 mtime 挡不住抹回时间，只比字节挡不住同尺寸改写）。
DEFAULT_DB_DIR="$HOME/Library/Application Support/heyta"
default_state() {
  local n exists sz mt dig
  n=$(ls "$DEFAULT_DB_DIR" 2>/dev/null | grep -c '^heyta\.sqlite' || true)
  if [ -f "$DEFAULT_DB_DIR/heyta.sqlite" ]; then
    exists=1
    # 🔴 三把尺都写成**两侧同形**的（不写 `stat` / `md5`）：
    #    · 字节数：`wc -c < 文件`（BSD 会补前导空格 ⇒ 去掉，好让两侧读数逐字相同）
    #    · mtime：`date -r 文件 +%s`（BSD 与 GNU 都按文件取；GNU 把 `stat` 的 `-f` 读成
    #      文件系统状态 ⇒ §7 第 364 条）
    #    · md5：`openssl dgst -md5`（BSD 那枚 `md5` 在 GNU 上命令不存在 ⇒ 命令替换静默读成
    #      空串，§7 第 370 条）
    sz=$(wc -c < "$DEFAULT_DB_DIR/heyta.sqlite" 2>/dev/null | tr -d '[:space:]')
    [ -n "$sz" ] || sz=取不到
    mt=$(date -r "$DEFAULT_DB_DIR/heyta.sqlite" +%s 2>/dev/null) || mt=取不到
    dig=$(openssl dgst -md5 < "$DEFAULT_DB_DIR/heyta.sqlite" 2>/dev/null | awk '{print $NF}')
    [ -n "$dig" ] || dig=取不到
  else
    exists=0; sz=无; mt=无; dig=无
  fi
  printf '存在=%s 字节=%s mtime=%s md5=%s 前缀枚数=%s' "$exists" "$sz" "$mt" "$dig" "${n:-0}"
}
S_BEFORE=$(default_state)

step "4. 后台起壳跑诊断链（HEYTA_NO_FOCUS=1，不激活、不抢键盘）"
# 🔴 跑的是**改名副本**：同一台机器上可以有两个 HeytaMac（别的会话的壳、或上一趟没退干净的），
#    而按名字的并发守卫与 WebKit 落点都要靠这枚唯一名字才认得出"这一发是本趟造的"。
#    只清自己造的那一份，不动别人的进程。
EXEC="$RUN_DIR/$EXEC_NAME"
cp "$BIN" "$EXEC" || env_invalid "复制不出改名副本（${EXEC}）"
chmod +x "$EXEC"
rm -f "$EV_PREFIX.txt"
env HEYTA_NO_FOCUS=1 \
    HEYTA_WEB_ROOT="$WEB_DIST" \
    HEYTA_BRIDGE_BUNDLE="$BRIDGE" \
    HEYTA_SHELL_DB_DIR="$DB_DIR" \
    HEYTA_M2_EVIDENCE="$EV_PREFIX" \
    HEYTA_WIDGET_HELP_PROBE=1 \
    ${GATE_ENV[@]+"${GATE_ENV[@]}"} \
    "$EXEC" >"$RUN_LOG" 2>&1 &
SHELL_PID=$!
# 证明它真的在跑（macOS 没有 setsid；先拿 pid 说话，别让"后台"变成一个断言）。
if ! kill -0 "$SHELL_PID" 2>/dev/null; then
  bad "壳进程起来就没了（pid ${SHELL_PID}）—— 读 $RUN_LOG"
  head -20 "$RUN_LOG" | sed 's/^/     | /'
  printf '\nRESULT=FAIL\n'
  exit 1
fi
printf '   … 已起 pid %s，等诊断链写完整读数（上限 %ss）\n' "$SHELL_PID" "$SETTLE"
waited=0
while [ "$waited" -lt "$SETTLE" ] && kill -0 "$SHELL_PID" 2>/dev/null; do
  if [ -f "$EV_PREFIX.txt" ] && grep -q '^WIDGET_WEBVIEW_URL_AFTER=' "$EV_PREFIX.txt" 2>/dev/null; then
    break
  fi
  sleep 1
  waited=$((waited + 1))
done
if ! grep -q '^WIDGET_WEBVIEW_URL_AFTER=' "$EV_PREFIX.txt" 2>/dev/null; then
  bad "等满 ${SETTLE}s 仍没走到外链回读 ⇒ 探针未闭合，读数不能当产品结论（证据：${EV_PREFIX}.txt）"
  [ -f "$EV_PREFIX.txt" ] && sed 's/^/     | /' "$EV_PREFIX.txt"
fi

# 🔴 优雅退出：WebKit 的 localStorage 是**退出时落盘**的，`kill -9` 会让那一档永远没有文件，
#    症状与"界面上什么都没有"一模一样（注销那批装置实测过）。强杀只在等不动时兜底，
#    且兜底了就必须**说出来** —— 那一轮的存储读数不算读数。
kill -TERM "$SHELL_PID" 2>/dev/null
off=0
while kill -0 "$SHELL_PID" 2>/dev/null && [ "$off" -lt 20 ]; do sleep 1; off=$((off + 1)); done
if kill -0 "$SHELL_PID" 2>/dev/null; then
  kill -9 "$SHELL_PID" 2>/dev/null
  bad "壳 SIGTERM 20 秒没退，已强杀 ⇒ 本轮只认写进证据文件的读数"
else
  ok "壳已优雅退出（pid $SHELL_PID 只属于本趟）"
fi

step "5. 判据（装置侧下，键名集合来自真源）"
JUDGE_OUT="$RUN_DIR/judge.txt"
if [ -n "$STORAGE_GATE" ]; then
  # 逃生门臂：判据钉的是原生形状，门关掉后界面按设计不再是那个形状 ⇒ 跳过判据，只出读数。
  printf '   ⚠️ 本趟转发了 HEYTA_SHELL_STORAGE=%s ⇒ 判据（按原生形状下的）不适用，跳过。\n' "$STORAGE_GATE"
  printf '   这一臂要的是读数本身：门一关，壳里那份界面还认不认得自己是壳。\n'
  # 关键四行直接打在屏幕上（判据跳过时，读数就是产物本身）。
  grep -E '^(STORAGE|WIDGET_HOST_SIGNALS|WIDGET_PANEL_ROWS|WIDGET_STATUS_TEXT|WIDGET_CAPABILITY_TEXT)=' \
    "$EV_PREFIX.txt" 2>/dev/null | sed 's/^/     | /' || printf '   （证据文件里连这几行都没有 ⇒ 探针没跑到，见上面的红）\n'
  : >"$JUDGE_OUT"
  # 🔴 记成字符串而不是 0：`JUDGE_RC=0` 会被下一个人读成"判据过了"，而这一臂根本没跑判据。
  JUDGE_RC="skipped(逃生门臂 HEYTA_SHELL_STORAGE=$STORAGE_GATE)"
else
  HEYTA_HELP_EXTERNAL_URL="$EXPECTED_SITE" node "$JUDGE" --from-file "$EV_PREFIX.txt" >"$JUDGE_OUT" 2>&1
  JUDGE_RC=$?
  sed 's/^/   /' "$JUDGE_OUT"
  if [ "$JUDGE_RC" -ne 0 ]; then
    bad "判据 rc=${JUDGE_RC}（读数：$EV_PREFIX.txt；判据：${JUDGE}）"
  fi
fi

step "6. 收尾与安全档 S"
S_AFTER=$(default_state)
printf '   改前：%s\n   改后：%s\n' "$S_BEFORE" "$S_AFTER"
if [ "$S_BEFORE" = "$S_AFTER" ]; then
  ok "判据 S 成立：默认路径五项读数逐项相同（本趟只写私有隔离目录）"
else
  bad "判据 S 不成立：默认路径变了 ⇒ 隔离旋钮漏了一档，本趟动过本机真数据"
fi
# 本趟自己造的 WebKit 残留（按改名后的进程名落点），只清这一枚 —— 不是别人的。
rm -rf "$HOME/Library/WebKit/$EXEC_NAME" 2>/dev/null || true

step "7. 读数出处（每条现量，不抄）"
printf '   TREE=%s\n' "$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo 取不到)"
DIRTY=$(git -C "$REPO" status --porcelain=v1 -- apps/desktop-macos/Sources apps/web/src/features/settings apps/web/src/pwa 2>/dev/null)
if [ -z "$DIRTY" ]; then
  printf '   DIRTY_PATHS=clean（壳源码 / 设置面板 / pwa 三处都只含已提交内容）\n'
else
  printf '   DIRTY_PATHS=未提交改动在场（读数不只含 HEAD）：\n%s\n' "$(printf '%s\n' "$DIRTY" | sed 's/^/     | /')"
fi
printf '   WEB_DIST_SHA=%s\n' "$(shasum -a 256 "$WEB_DIST/index.html" 2>/dev/null | cut -c1-16 || echo 取不到)"
printf '   SHELL_BINARY=%s mtime=%s\n' "$(basename "$BIN")" "$(date -r "$BIN" '+%b %e %T %Y' 2>/dev/null || echo 取不到)"
printf '   RUN_DIR=%s\n' "$RUN_DIR"
printf '   PROVENANCE_FILE=%s\n' "$RUN_DIR/provenance.txt"
{
  printf 'RUN_TAG=%s\n' "$RUN_TAG"
  printf 'TREE=%s\n' "$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo 取不到)"
  printf 'DIRTY_PATHS=%s\n' "${DIRTY:-clean}"
  printf 'WEB_DIST_SHA=%s\n' "$(shasum -a 256 "$WEB_DIST/index.html" 2>/dev/null | cut -c1-16 || echo 取不到)"
  printf 'SHELL_BIN=%s\n' "$BIN"
  printf 'PROBE_HITS=%s\n' "$PROBE_HITS"
  printf 'EXPECTED_SITE=%s\n' "$EXPECTED_SITE"
  printf 'SHELL_STORAGE_GATE=%s\n' "${STORAGE_GATE:-默认（未转发，壳按自己的规则开宿主端口）}"
  printf 'JUDGE_RC=%s\n' "$JUDGE_RC"
  printf 'S_BEFORE=%s\nS_AFTER=%s\n' "$S_BEFORE" "$S_AFTER"
} >"$RUN_DIR/provenance.txt" 2>/dev/null || true

# 可选：把证据与人读的判据输出并排收到仓库里（给下一轮做"图与读数同批"那一格用）。
if [ -n "${HEYTA_WIDGET_HELP_EVIDENCE_OUT:-}" ]; then
  mkdir -p "$(dirname "$HEYTA_WIDGET_HELP_EVIDENCE_OUT")" 2>/dev/null || true
  if cp "$EV_PREFIX.txt" "$HEYTA_WIDGET_HELP_EVIDENCE_OUT" 2>/dev/null; then
    {
      printf '\n# ── 装置判据输出（同一次运行）──\n'
      cat "$JUDGE_OUT"
      printf '\n# ── 出处 ──\n'
      cat "$RUN_DIR/provenance.txt"
    } >>"$HEYTA_WIDGET_HELP_EVIDENCE_OUT" || true
    printf '   📷 证据入库：%s\n' "$HEYTA_WIDGET_HELP_EVIDENCE_OUT"
  else
    bad "证据没能收到 ${HEYTA_WIDGET_HELP_EVIDENCE_OUT}（读原始落点：$EV_PREFIX.txt）"
  fi
fi

if [ "$fails" -gt 0 ]; then
  printf '\nRESULT=FAIL（%d 条红；证据 %s）\n' "$fails" "$EV_PREFIX.txt"
  exit 1
fi
if [ -n "$STORAGE_GATE" ]; then
  # 🔴 这一臂**不许**说"两格闭合"：判据被跳过了，它取到的只是"门关掉后壳里那份界面认不认得自己"的读数。
  printf '\nRESULT=READINGS-ONLY（趟号 %s；逃生门臂 HEYTA_SHELL_STORAGE=%s ⇒ 判据按设计跳过，本趟不主张任何一格闭合）\n' "$RUN_TAG" "$STORAGE_GATE"
  exit 0
fi
printf '\nRESULT=OK（趟号 %s；两格闭合，浏览器渲染那一格见上面 BOUNDARY=）\n' "$RUN_TAG"
