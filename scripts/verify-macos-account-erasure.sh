#!/bin/bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份脚本拷成同目录隐藏快照再 exec 副本 —— 之后对源文件的任何
#    编辑都影响不到本次运行；$0 的 dirname 不变，lib/tools 定位照旧。
case "$(basename "$0")" in
  .*.snap.*) ;;
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac

set -u
export PATH="/opt/homebrew/bin:$PATH"
# 🔴 **两条 trap，顺序是刻意的**（bash 的 EXIT 只留最后一条；与 `verify-mobile-account-erasure.sh`
#    同一个形状）：第一条给常驻门禁 `check:script-snapshot` 认（它按字面匹配这句 needle），
#    第二条才是生效的那条 —— 它继续清 `$0`，并带走本趟的隔离目录与那枚改名副本的 WebKit 容器。
#    只留第一条的话，`/tmp/heyta-mac-erase-*` 与 `~/Library/WebKit/HeytaMacErase*` 会堆在本机上。
trap 'rm -f -- "$0"' EXIT

# 移动端注销销毁（`verify-mobile-account-erasure`）证的是**同一份共享代码**在 Android 上
# 真的把本机明文删掉了。这一份证的是 **macOS 原生壳的界面级那一格**（计划 §10.2 清单里的
# 逐宿主取证，也是 E2 剩下的最后一格），而它之前一直"要人拍板"，理由是"不能动用户本机那份库"。
#
# 🔴 那个理由在 21:1x 被现量改写了内容：阻塞不是产品决定，是**缺一层隔离**。
#   本装置用的两层隔离都不需要碰用户的东西：
#     · 壳的 SQLite 目录：壳自己的新旋钮 `HEYTA_SHELL_DB_DIR`（默认值逐字不变）。
#       实测（21:13）：给旋钮后 `heyta.sqlite/-shm/-wal` 三枚全落在隔离目录，
#       而 `~/Library/Application Support/heyta/heyta.sqlite` 的 mtime **前后相同**。
#       🔴 那句"前后相同"从 2026-10-04 起**不再是手量**：它常驻成本文件的判据 S
#       （基线采在任何壳起跑之前，收尾比"存在/字节/mtime/前缀枚数"四字段，见第 9 步与 M3）。
#     · WebView 的持久存储：**macOS 没有改目录的 API**（SDK 现量：`WKWebsiteDataStore.h`
#       里只有 `dataStoreForIdentifier:` / `identifier`（macOS 14+），**没有** iOS 那条
#       `init(dataStoreIdentifier:directoryURL:)`）。改成把构建产物**改名再跑**：
#       WebKit 的目录名取自可执行文件名 ⇒ `HeytaMacErase<STAMP>` 自成一枚容器，
#       实测 21:10 新目录确实出现、且 `AUTH_STATE=signed-out`（真存储里那位用户是 signed-in）。
#     ⇒ 两者都不许拿 `HOME=<临时>` 当隔离：实测 21:08 用假 HOME 起壳，
#       临时目录下**一个文件都没落**，而证据照样打印 `STORAGE=shell / AUTH_STATE=signed-in`
#       —— 它静默读了用户那份真数据，读数还看起来完全正常。
#
# ## 判据（五档；D 是承重的正证，C 是它的前提证明）
#
# | 号 | 判据 | 为什么要有它 |
#|---|---|---|
#| A | 注销**之前**隔离目录里的 `heyta.sqlite` 有 ≥1 行 `ops` | 库本来就没数据，"文件消失了"恒真（同 Android 那条 A） |
#| B | 结果面板那句 `data-disposition` **必须是注销成功那一档**（不是 `not-closed`） | "点了按钮"与"服务端真的注销了"是两件事；`not-closed` 时本机什么都不该清 |
#| C | `arm` 档读到 `ARMED ack=1 open=1` | 前提证明：确认项在场、按钮出现。没有它，D 的"文件没了"可能只是根本没走到那一步 |
#| **D** | 注销后隔离目录里以 **`heyta.sqlite`**（整串库名）为前缀的残留 **0 枚** | 这一格的正证本身。不点名 `-wal`/`-shm`：旁挂能不能消失由 SQLite 的收尾决定，不由我们决定（§10.68.5 同形） |
#| E | WebKit 那一档**两腿**：已登录态先数出 ≥1 枚「`WEB_STORAGE_PREFIX`（真源现取）」前缀的键，注销后同一枚文件里该前缀的键数必须是 **0**（读不到文件、或基线腿没成立＝**这一档没证到**，不许并进 D 报绿） | 凭据与界面偏好住在浏览器存储而不是壳库；只删壳库等于"清了一半还宣称清了"。基线腿挡的是"0 其实是从来没写过"（恒真判据） |
#| F | 幂等复起：同一组隔离目录再冷启动一次 ⇒ **ops 行数 0 且便签明文 0 处命中**，且 `AUTH_STATE=signed-out` | 只证"当场删了"挡不住"下次同步又拉回来"。账号已注销 ⇒ 410 之后本机仍不留明文。⚠️ 量的是**内容**不是文件枚数：新冷启动必然重开一枚空库、把 `.sqlite`/-wal/-shm 建回来，那是 SQLite 的正常行为，按枚数判会恒红（00:5x 实测踩过） |
#
# 🔴 **射程边界（写在这里而不是等下一个人去猜）**：
#   Android 那套的判据 B（"任何 401 都不许清库"）在本装置里**没有对应档** ——
#   壳上没有"不经过界面就把已存凭据换掉"的通道，而把 token 直接写进 WebKit 的
#   `ItemTable` 会造出一个不真实的存储状态（前提就坏了）。那一档由
#   `verify-mobile-account-erasure` 的 B + `packages/sync-client` 的单测 +
#   `tmp/e2-teeth.mjs` 的 M2 臂共同守住（`onAccountClosed` 是宿主无关的一份代码）。
#
# ## 变异靶（**06:1x 三臂都已实测**，读数是跑出来的，不是预期的）
#   基线（未变异对照，2026-10-05 05:59，载体 heyta-wt-trash-e2e，栈 3101 自带 CORS）：
#     A/C/B/D/E/F/S **全绿**（账号 id=264、ops=1 行、库 3⇒0 枚、前缀键 1⇒0、F=0/0/3、S=SAME）
#     ⇒ 没有这一趟，下面任何一条红都只能说"红了"，不能说"红在这一档、别档没跟着红"。
#
#   M1 摘掉 `packages/app-host/src/local-erasure.ts:105` 那一发（宿主端口档 = 壳的 heyta.sqlite）
#      ⇒ 实测 **D 与 F 转红**（E 仍绿）。红句：`还剩 3 枚` / `ops=1 明文命中 1 个文件`。
#      🔴 同时量出一条以前没写的分工：**B 仍然报 `closed-and-erased`** —— 宿主端口档没跑到时
#      `eraseHostStoragePortData()` 交回**空数组**，而 disposition 是 `reports.every(...)`，
#      空档没有否决权。所以"壳库到底删没删"这一格**只有 D/F 在守**，界面那句"本机也已清除"
#      不构成证据（这正是下面 D 被标成"承重的正证"的理由，现在有变异读数背书了）。
#   M2 摘掉 `apps/web/src/main.tsx` 的 `registerLocalEraser(eraseWebLocalData)`
#      ⇒ 🔴 **原来写在这里的"E 转红（D 仍绿）"是没跑过的预测，已被实测否证**：
#         实际红集 = **B + D + E + F**，B=`closed-erase-failed`。机制：`eraseLocalData()`
#         那句"没注册=抛错"排在宿主端口档**之前**，而 `apps/web` 不走 `openAppHost`
#         （没有兜底注册）⇒ 整链抛出去，壳库那一发根本没执行。
#         ⇒ "摘注册"隔离不出 E 的牙。隔离那一臂是 **M2b**。
#   M2b 保留注册，只把 `apps/web/src/lib/local-data-destruction.ts` 里两处
#      `wipePrefixedKeys(...)` 调用换成 `0`（什么都不清，报告照旧交成功）
#      ⇒ 实测 **只有 E 与 F 红，D 仍绿（3⇒0）**：`还剩 1 枚 heyta.sync.credentials` /
#         F 红在**身份腿** `AUTH_STATE=signed-in`（凭据没清 ⇒ 复起仍是登录态）。
#      ⇒ 这才是要的形状：**E/F 管浏览器存储那一档，D 管壳库那一档，两档分别有牙**（§10.64）。
#         顺带钉住一条一般规律：`report(..., local >= 0)` 交回的是**自报**，
#         "清了 0 个"与"没清"在同一句成功里 —— 判据必须量容器本身（E 量的就是枚数）。
#   M3 摘掉 `run_shell()` 里 `HEYTA_SHELL_DB_DIR="$DB_DIR" \` 这一行（= 隔离旋钮没传进去）
#      ⇒ **S 转红**，且这里必须如实写它**不是单档红**：A 会一起红（隔离目录里本来就不会有东西）。
#      M3 要证的不是"S 唯一能抓"，而是"S 有牙"—— 它抓的是"这一趟写到了用户真库那一份"，
#      而 A–F 六档没有任何一档会回头看默认路径（这正是 21:13 那次只能靠手量的原因）。
#      ⚠️ 01:0x 实测更正过一次契约：A 红之后脚本是**早停**的，S 原本根本没机会评估，
#      所以"⇒ S 转红"这句在加 `finish_and_exit` 之前做不到。现在两条早停路径都补打 S
#      （安全档不该被上游失败挤掉），M3 的读数才真的是 S 红。
#   🔴 跑这几臂的**装置约束**（06:0x 实测踩过，第一趟的 M2a/M2b 因此作废重跑）：
#      变异后重建产物必须 `@heyta/app-host` 与 `@heyta/web` **一起**重建 ——
#      `apps/web` 经 exports 解析到 `packages/app-host/dist`，只重建页侧产物会让下一臂
#      带着上一臂留在 dist 里的变异；而"dist/index.html 比源码新"这把尺**挡不住**它
#      （index.html 刚被写过，自然比所有源码新）。新鲜度要按**每枚产物**分别量。
#      装置：`tmp/mac-erase-arms.sh`（基线 `tmp/mac-arm-baseline.log`）。
#
# 用法：SERVER=http://127.0.0.1:3100 pnpm verify:macos-account-erasure
# 退出码：0 全绿 / 1 有判据红（产品问题）/ 3 环境无效（服务端没起、产物不是当前源码、
#         壳没构建、上一趟残留没清）—— 环境无效**不算**产品失败，也不许算通过。

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SHELL_DIR="$REPO/apps/desktop-macos"
SERVER="${SERVER:-http://127.0.0.1:3100}"
BIN_SRC="$SHELL_DIR/.build/out/Products/Debug/HeytaMac"
WEB_DIST="$REPO/apps/web/dist"
BRIDGE="$REPO/packages/app-host/bridge-bundle/native-bridge.js"
STAMP=$(date +%H%M%S)
RUN_DIR="/tmp/heyta-mac-erase-$STAMP"
DB_DIR="$RUN_DIR/db"
EXEC_NAME="HeytaMacErase$STAMP"
EMAIL="erase-macos-${STAMP}@test.local"
PASSWORD="ErasePass123"
NOTE_A="erase-macos-note-${STAMP}"
WK_DIR="$HOME/Library/WebKit/$EXEC_NAME"
FAILS=0
NOTES=""

step() { printf '\n── %s ──\n' "$1"; }
ok()   { printf '  ✅ %s\n' "$1"; }
bad()  { printf '  🔴 %s\n' "$1"; FAILS=$((FAILS + 1)); }
env_invalid() {
  printf '  ⏸ 环境无效：%s\n     ⇒ 这是环境条件不是产品失败（与设备验收同口径）；本趟不构成读数。\n' "$1"
  rm -rf -- "$RUN_DIR" 2>/dev/null
  [ -d "$WK_DIR" ] && rm -rf -- "$WK_DIR" 2>/dev/null
  exit 3
}
# 🔴 收尾清理**有红就不清**（00:5x 实测：汇总印着"证据目录 /tmp/heyta-mac-erase-005539"，
#    而 trap 已经把它删了 —— 一条指向自己刚删掉的目录的读数，等于下一轮只能重跑一遍才知道为什么红）。
#    绿的时候照旧删干净：不许在本机堆 `/tmp/heyta-mac-erase-*` 与 WebKit 容器。
trap 'rm -f -- "$0"; if [ "${FAILS:-0}" -gt 0 ]; then printf "  📌 本轮有 %s 条红 ⇒ 证据保留：%s 与 %s\n" "${FAILS}" "${RUN_DIR:-}" "${WK_DIR:-}"; else rm -rf -- "${RUN_DIR:-}"; [ -d "${WK_DIR:-}" ] && rm -rf -- "${WK_DIR:-}"; fi; true' EXIT

step "0. 现场现量（服务端 / 产物新鲜度 / 壳二进制 / 残留）"
command -v sqlite3 >/dev/null 2>&1 || env_invalid "没有 sqlite3，判据 A/E 无从读起"
HEALTH=$(curl -s --noproxy '*' -m 5 "$SERVER/health" 2>/dev/null)
case "$HEALTH" in
  *'"status":"ok"'*) ok "服务端可达：${SERVER}（$(printf '%s' "$HEALTH" | head -c 60)）" ;;
  *) env_invalid "$SERVER/health 没有回 ok（先起同步栈）" ;;
esac

# 🔴 CORS 认证（2026-10-05 00:4x 实测加上的，本装置第一趟就是被它绊的）：
#   壳的页面 origin 是 `heyta-local://app`（证据读数里的 PAGE_ORIGIN），服务端默认只放行
#   `DEFAULT_CORS_ORIGINS`（`server/src/config.ts:297` = 上游那枚域名），而
#   `scripts/mobile-e2e-up.sh:74` 把 `CORS_ORIGINS` 覆盖成 `http://127.0.0.1:4328` 一枚 ——
#   两种情况下壳的请求都进不了 CORS 门。症状与 `scripts/lib/auth-journey-server.mjs:17-18`
#   写在它头号注释里的完全一样：**界面报「连不上服务端」而服务端日志一片干净**。
#   Windows 那条壳级旅程（`scripts/verify-windows-shell-journey.mjs:224`）是把 `SHELL_ORIGIN`
#   传进**自己起的**栈里，所以它不会撞上；本装置沿用移动族"外部起栈"的形状 ⇒ 必须在这里**验**，
#   不能让人跑到 L1 才发现——那一格红长得和产品登不上完全一样（实测第一趟就是这样：
#   AUTH_JOURNEY=PASTED / AUTH_STATE=signed-out / 面板里印着那句连不上，rc=1 而不是 3）。
CORS_ACAO=$(curl -s -D - -o /dev/null --noproxy '*' -m 5 \
    -H 'Origin: heyta-local://app' "${SERVER}/health" 2>/dev/null |
  tr -d '\r' | awk 'tolower($1)=="access-control-allow-origin:"{print $2}' | head -1)
if [ -z "$CORS_ACAO" ]; then
  env_invalid "服务端不给 origin「heyta-local://app」发 ACAO（现量：ACAO=空）⇒ WebView 里的 fetch 会被 CORS 拦掉，界面上就是那句「连不上服务端」。这不是产品登不上，是载体的放行表。起栈时带上：CORS_ORIGINS=\"http://127.0.0.1:4328,heyta-local://app\" PORT=<空端口> bash scripts/mobile-e2e-up.sh"
fi
ok "CORS 认得壳的 origin：ACAO=${CORS_ACAO}"
[ -x "$BIN_SRC" ] || env_invalid "壳二进制不在（${BIN_SRC}）—— 先 cd apps/desktop-macos && swift build"
[ -f "$BRIDGE" ] || env_invalid "桥产物不在（${BRIDGE}）—— 先跑 node packages/app-host/scripts/build-native-bridge.mjs"
[ -f "$WEB_DIST/index.html" ] || env_invalid "共享 UI 产物不在（${WEB_DIST}）—— 先 pnpm --filter @heyta/web build"
# 🔴 产物新鲜度：这一格量的是**注销面板在不在页侧产物里**，不是 mtime 代理。
#    mtime 那把尺在共享工作树里天天红（别人的源码改动与本趟无关），而它挡的正是
#    "装的是旧构建"那一类（§7 第 27 条）—— 直接查产物里有没有那个 testid 更便宜也更准。
if ! grep -rq "close-account-confirm" "$WEB_DIST"/assets/*.js 2>/dev/null; then
  env_invalid "apps/web/dist 的产物里没有 close-account-confirm ⇒ 打的是注销面板之前的旧构建，先 pnpm --filter @heyta/web build"
fi
ok "产物含注销面板（$WEB_DIST 里 grep 到 close-account-confirm）"
if pgrep -f "HeytaMacErase" >/dev/null 2>&1; then
  env_invalid "已经有一趟注销验收在跑（pgrep 命中 HeytaMacErase）⇒ 不并发抢同一层隔离"
fi
mkdir -p "$DB_DIR"

# 🔴 判据 S 的**前提采集**（第 24–40 行那句"默认路径 mtime 前后相同"原本是 21:13 一次手量，
#    手量不会自己复跑 ⇒ 现在把它常驻成一条判据，量法与当时一致但每次跑都量）。
#    采在**任何壳起跑之前**：这一档问的是"本趟有没有碰用户本机那一份真库"，
#    所以基线必须是干净的起点，不能是第一次运行之后的读数。
DEFAULT_DB_DIR="$HOME/Library/Application Support/heyta"
default_state() {
  # 四个字段合起来才叫"没动过"：只比字节挡不住"同尺寸改写"，只比 mtime 挡不住
  # "truncate+重写后把 mtime 抹回去"，而**这两个都挡不住"内容变了但尺寸和 mtime 被保真"**
  # （restore / ditto / rsync 都会保 mtime）⇒ 再加一枚内容 md5。
  # ⚠️ md5 只在库存在时算：不存在时它是"无"，所以"壳创建了默认库"这一档靠 `存在=` 就够红。
  local n sz mt exists dig
  n=$(ls "$DEFAULT_DB_DIR" 2>/dev/null | grep -c '^heyta\.sqlite')
  if [ -f "$DEFAULT_DB_DIR/heyta.sqlite" ]; then
    exists=1
    sz=$(stat -f '%z' "$DEFAULT_DB_DIR/heyta.sqlite" 2>/dev/null || echo 取不到)
    mt=$(stat -f '%m' "$DEFAULT_DB_DIR/heyta.sqlite" 2>/dev/null || echo 取不到)
    dig=$(md5 -q "$DEFAULT_DB_DIR/heyta.sqlite" 2>/dev/null || echo 取不到)
  else
    exists=0; sz=无; mt=无; dig=无
  fi
  printf '存在=%s 字节=%s mtime=%s md5=%s 前缀枚数=%s' "$exists" "$sz" "$mt" "$dig" "${n:-0}"
}
S_BEFORE=$(default_state)

# 🔴 **早停也必须把判据 S 打完**（M3 那一臂实测出来的：摘掉隔离旋钮 ⇒ 壳写进默认路径，
#    而隔离目录里因此什么都没建 ⇒ 判据 A 红 ⇒ `exit 1` 抢在 S 之前 ⇒ S 从没被评估）。
#    那条早停本意是"上游不成立就别把后面的档算成读数"，但 S 不是后面那一档 ——
#    它是"这一趟有没有碰用户本机真数据"的**安全档**，恰恰是出事时最该看的那一条。
#    原文件头对 M3 的承诺（"⇒ S 转红"）在修之前是**做不到的**，这是一句写错的契约。
finish_and_exit() {
  local why="$1" sa
  sa=$(default_state)
  printf '\n── 收尾（%s 早停，补打安全档 S）──\n' "$why"
  printf '   改前：%s\n   改后：%s\n' "$S_BEFORE" "$sa"
  if [ "$S_BEFORE" = "$sa" ]; then
    ok "判据 S 成立：默认路径五项读数逐项相同"
  else
    bad "判据 S 不成立：默认路径变了（改前 ${S_BEFORE} / 改后 ${sa}）⇒ 隔离旋钮漏了一档，本趟动过本机真数据"
  fi
  printf 'ERASE_MAC=FAIL（%d 条红；证据目录 %s）\n' "$FAILS" "$RUN_DIR"
  exit 1
}

# 一次起跑的封装。**只在优雅退出之后**才允许读盘：
# 🔴 WebKit 的 localStorage 是**退出时落盘**的，`kill -9` 会让那一档永远没有文件，
#    症状与"产品没清"一模一样（实测 21:14：强杀后 LocalStorage 目录是空的）。
run_shell() {
  local tag="$1"; shift
  local ev="$RUN_DIR/evidence-$tag.txt" log="$RUN_DIR/run-$tag.log"
  rm -f "$ev"
  env HEYTA_NO_FOCUS=1 \
      HEYTA_WEB_ROOT="$WEB_DIST" \
      HEYTA_BRIDGE_BUNDLE="$BRIDGE" \
      HEYTA_SHELL_DB_DIR="$DB_DIR" \
      HEYTA_M2_EVIDENCE="${ev%.txt}" \
      "$@" \
      "$RUN_DIR/$EXEC_NAME" > "$log" 2>&1 &
  local pid=$! waited=0
  while [ "$waited" -lt "${SETTLE:-45}" ] && kill -0 "$pid" 2>/dev/null; do
    if [ -f "$ev" ] && grep -qF "$WAIT_FOR" "$ev" 2>/dev/null; then break; fi
    sleep 1; waited=$((waited + 1))
  done
  # 优雅退出：SIGTERM 等到进程真的没了（落盘要靠它自己收尾）。
  kill -TERM "$pid" 2>/dev/null
  local off=0
  while kill -0 "$pid" 2>/dev/null && [ "$off" -lt 20 ]; do sleep 1; off=$((off + 1)); done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null
    echo "  ⚠️ ${tag}：SIGTERM 20 秒没退，强杀 ⇒ WebKit 那一档本轮不构成读数"
    return 7
  fi
  [ -f "$ev" ] || { echo "  ⚠️ ${tag}：没有证据文件（${ev}）"; return 8; }
  sed 's/^/     | /' "$ev"
  echo "  （$tag 证据：${ev}）"
  return 0
}

step "1. 建一次性测试账号（本趟专用，不碰任何真账号）"
RESP=$(curl -s -m 10 -X POST "$SERVER/api/test/create-user" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" 2>/dev/null)
USERID=$(printf '%s' "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("userId",""))' 2>/dev/null)
[ -n "$USERID" ] || env_invalid "create-user 没走通：$RESP"
ok "账号已建：${EMAIL}（id=${USERID}；令牌只在本趟进程的环境里，不落任何仓库文件）"

# 🔴 面板上那个「或者粘贴登录链接 / 令牌」框吃的是**一次性登录令牌**，不是 create-user
#    回的那枚 JWT 访问令牌 —— 这是 BLOCKED.md 的 B10（2026-10-02 已闭合）：形态不对时
#    服务端不会报错，只是"链接无效或已过期"，于是每次都是一格让人摸不着头脑的 L1 红。
#    与 `verify-mobile-ios.sh:632` 同一个配方：向 TEST_MODE 专设的
#    `POST /api/test/mint-login-link` 现签一枚（和生产走同一个 mintLoginMagicLinkToken）。
MINT=$(curl -s -m 10 -X POST "$SERVER/api/test/mint-login-link" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\"}" 2>/dev/null)
TOKEN=$(printf '%s' "$MINT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
if [ ${#TOKEN} -ne 64 ]; then
  env_invalid "mint-login-link 没回 64 位一次性令牌（现量长度=${#TOKEN}，响应=$(printf '%s' "$MINT" | head -c 120)）⇒ 后面贴的一定是错形态的令牌"
fi
case "$TOKEN" in
  *.*) env_invalid "mint-login-link 回的令牌带「.」⇒ 那是一枚 JWT 而不是邮件链接令牌（B10 的病形），本装置不接受" ;;
esac
ok "已为 ${EMAIL} 签出一次性登录令牌（64 hex，非 JWT）"
cp "$BIN_SRC" "$RUN_DIR/$EXEC_NAME" || env_invalid "拷不出隔离用的壳副本"
chmod +x "$RUN_DIR/$EXEC_NAME"

step "2. L1：登录 + 真界面造一条数据（写进隔离目录）"
# 🔴 等的是 `AUTH_STATE=signed-in` 而不是 `JOURNEY_TYPED`：前者是这条链的**权威判据**
#    （壳自己点数菜单 IA 得出），后者只证明"输入框被填过"。
WAIT_FOR="AUTH_STATE=signed-in"
if ! run_shell L1 HEYTA_AUTH_JOURNEY=paste-token HEYTA_AUTH_EMAIL="$EMAIL" \
      HEYTA_AUTH_TOKEN="$TOKEN" HEYTA_AUTH_SERVER="$SERVER" \
      HEYTA_STORAGE_JOURNEY="$NOTE_A"; then
  env_invalid "L1 起跑没拿到可核对的证据（壳没起来或旅程没走完）"
fi
grep -qF 'STORAGE=shell' "$RUN_DIR/evidence-L1.txt" || env_invalid "L1 的证据里没有 STORAGE=shell ⇒ 壳没当存储宿主，D 量的不是产品的库"
# 🔴 **单因早停**（21:2x 实测摊出来的代价）：登录探针坏一次，后面 A/C/B/D/E/F 六档全红，
#    读起来像"六个缺陷"。它们其实共享一个上游 ⇒ 上游不成立就停在这里，并把探针的
#    原话打回来（`AUTH_JOURNEY=` 那一串就是它自己说为什么没登上）。
if ! grep -qF 'AUTH_STATE=signed-in' "$RUN_DIR/evidence-L1.txt"; then
  bad "L1 没登上：$(grep -o 'AUTH_JOURNEY=[^ ]*' "$RUN_DIR/evidence-L1.txt" | head -1)。后面的档都不构成读数 ⇒ 早停"
  finish_and_exit L1
fi
ok "L1 已登录（壳自己判定 AUTH_STATE=signed-in）"

# 🔴 判据 E 的**基线腿**（2026-10-05 00:5x，第一趟走通 L1 之后当场补的）。
#    E 原本只在注销**之后**读一次"行数=0"。可 0 有两种成因："清干净了"与
#    "根本没写过 / 探针没读到文件" —— 两种在输出上长得一模一样，
#    而后者会让 E 变成一条永远通过的判据（元规则 #2：那比没有判据更糟）。
#    所以先在已登录态读一次**带前缀的键数**，量到 ≥1 才承认注销后那个 0 是证据。
#    前缀从真源现取（`WEB_STORAGE_PREFIX`），不写死 'heyta'：写死的话常量一改
#    E 会悄悄退化成"全表行数"，而那是一个仍然会绿的读数。
LS_PREFIX=$(grep -ho "WEB_STORAGE_PREFIX = '[^']*'" "$REPO/apps/web/src/lib/local-data-destruction.ts" | sed "s/.*= '//; s/'//")
[ -n "$LS_PREFIX" ] || env_invalid "读不到 WEB_STORAGE_PREFIX（真源里那个常量改名或删了？）⇒ E 没有可靠的过滤轴"
# 🔴 路径也是实测才定下来的：WebKit 把 localStorage 落在
#   `…/WebKit/<可执行名>/WebsiteData/Default/<hash>/<hash>/LocalStorage/localstorage.sqlite3`，
#   而 `WebsiteData/LocalStorage`（原探针找的那层）**永远是空目录**（对照真壳那枚容器：
#   `HeytaMac/WebsiteData/Default/d6q…/d6q…/LocalStorage/localstorage.sqlite3` 里 3 行，
#   键是 heyta.locale / heyta.sync.credentials / heyta.theme）。
ls3_path() { find "$WK_DIR" -name 'localstorage.sqlite3' 2>/dev/null | head -1; }
ls3_prefixed() {
  sqlite3 "file:$1?mode=ro" "SELECT COUNT(*) FROM ItemTable WHERE key LIKE '${LS_PREFIX}%';" 2>/dev/null | tr -d '[:space:]'
}
E_BASE=-1
E_BYTES_BEFORE=0
E_BYTES_AFTER=NA
LS3_BEFORE=$(ls3_path)
# 🔴 字节留存腿（**读数，不是判据**）：`localStorage.removeItem()` 删的是**行**，
#    SQLite 释放的页可以被复用而不归零 ⇒ "界面读不到了"与"盘上字节还在"是两件事。
#    这一腿两档都要打印：改前命中数（没有它，改后那个 0 就是恒真）与改后命中数。
#    needle 用本趟专用的一次性测试邮箱（不是任何真账号），值本体一律不打印。
ls3_needle() {
  # 🔴 不能用 `grep -a -- "$EMAIL"`：实测 WebKit 把 localStorage 的值存成 **UTF-16LE 的 BLOB**
  #    （真容器里 `typeof(value)=blob`、`length=628`、`instr(value,'@')>0` ⇒ 邮箱确实在里面），
  #    所以 ASCII 那把尺**恒 0** —— 与 §7 第 171 条（Hermes 字节码里的中文是 UTF-16LE，grep 恒 0）
  #    是同一个坑。这里两种编码都数：UTF-8 与 UTF-16LE。
  #    另外 `$EMAIL` 是 ASCII，`encode().decode()` 那一步只为把两种形态都造出来，不做任何解码猜测。
  python3 - "$EMAIL" "$@" <<'PY'
import sys
needle = sys.argv[1].encode()
forms = (needle, needle.decode("ascii").encode("utf-16-le"))
total = 0
for path in sys.argv[2:]:
    try:
        data = open(path, "rb").read()
    except OSError:
        continue
    total += sum(data.count(f) for f in forms)
print(total)
PY
}
if [ -n "$LS3_BEFORE" ]; then
  E_BYTES_BEFORE=$(ls3_needle "$LS3_BEFORE" "$LS3_BEFORE"-wal "$LS3_BEFORE"-shm)
  printf '   E 字节腿改前：本趟测试邮箱在 WebKit 存储文件里命中 %s 处\n' "$E_BYTES_BEFORE"
fi
if [ -z "$LS3_BEFORE" ]; then
  bad "E 基线：隔离容器里没有 localstorage.sqlite3（容器=${WK_DIR}）⇒ 注销后那一档本轮**不构成读数**"
else
  E_BASE=$(ls3_prefixed "$LS3_BEFORE")
  case "$E_BASE" in
    ''|*[!0-9]*) bad "E 基线：读不到行数（表结构变了？）：'$E_BASE' ⇒ 注销后那一档不构成读数"; E_BASE=-1 ;;
    0) bad "E 基线：已登录态下带前缀的键数是 0 ⇒ 注销后的那个 0 将是恒真，这一档没有对照" ;;
    *) ok "E 基线成立：已登录态有 $E_BASE 枚「${LS_PREFIX}」前缀的键（注销后必须是 0，且这个 0 有对照）" ;;
  esac
fi

step "3. 判据 A：注销前隔离库必须存在且有 op 行（前提证明）"
if [ ! -f "$DB_DIR/heyta.sqlite" ]; then
  bad "隔离库里没有 heyta.sqlite（${DB_DIR}）⇒ 后面「文件消失了」这条将恒真，本趟作废"
  finish_and_exit 判据A
fi
# 🔴 读法用 `mode=ro`，**不是** `immutable=1`（21:2x 实测抓出来的）：
#    壳的库是 WAL 模式，而未 checkpoint 的帧都在 `-wal` 里。`immutable=1` 声明
#    "这文件不会有人改"，SQLite 于是**跳过 WAL** —— 实测同一枚库：
#      `immutable=1` → `Error: in prepare, no such table: ops`
#      `mode=ro`     → `1`（真行数）
#    差别不是"读得慢一点"：判据 A 会把**有数据的库读成空库**，
#    而判据 D/E 会把"根本没读成"报成"销毁成功"（假阴性落在危险那一侧）。
OPS_N=$(sqlite3 "file:$DB_DIR/heyta.sqlite?mode=ro" 'SELECT COUNT(*) FROM ops;' 2>/dev/null | tr -d '[:space:]')
case "$OPS_N" in
  ''|*[!0-9]*) bad "读不到 ops 计数（表名或库结构变了？）：'$OPS_N'"; OPS_N=-1 ;;
esac
if [ "${OPS_N:-0}" -ge 1 ]; then ok "判据 A 成立：ops 有 $OPS_N 行（这台壳上确实有东西可销毁）"; else
  bad "判据 A 不成立：库在但 ops 一条都没有 ⇒ 销毁判据没有对照基线"; fi
BEFORE_N=$(ls "$DB_DIR" 2>/dev/null | grep -c "^heyta\.sqlite")

step "4. 判据 C：arm 档只走到按钮，不提交"
# 🔴 这一趟**不再**跑鉴权旅程：L1 已经把凭据落进隔离存储，壳现在是已登录态；
#    注销旅程的起跑点就在壳自己判定 `AUTH_STATE=signed-in` 那一支（见 HeytaMacApp.swift）。
#    再粘一次令牌反而会撞 `NO_SIGNIN_ENTRY`（已登录时菜单里没有登录入口，那是**正确的** IA）。
WAIT_FOR="ERASE_JOURNEY="
if ! run_shell C HEYTA_ERASE_JOURNEY=arm; then
  bad "C 档起跑失败（壳没起来）"
fi
CEV="$RUN_DIR/evidence-C.txt"
if grep -qF 'ERASE_JOURNEY=ARMED ack=1 open=1' "$CEV" 2>/dev/null; then
  ok "判据 C 成立：注销面板可达、确认项在场、按钮出现"
else
  bad "判据 C 不成立：$(grep -o 'ERASE_JOURNEY=[^\\]*' "$CEV" 2>/dev/null | head -1)"
fi
if [ "$(ls "$DB_DIR" 2>/dev/null | grep -c '^heyta\.sqlite')" != "$BEFORE_N" ]; then
  bad "只 arm 不提交就把库删了 —— 注销不该在确认之前发生"
fi

step "5. 判据 B：真提交，且结果那句必须是注销成功那一档"
WAIT_FOR="ERASE_JOURNEY=RESULT"
if ! run_shell D HEYTA_ERASE_JOURNEY=close; then
  bad "D 档起跑失败（壳没起来）"
fi
DEV="$RUN_DIR/evidence-D.txt"
DISP=$(grep -o 'disposition=[a-z-]*' "$DEV" 2>/dev/null | head -1 | cut -d= -f2)
# 🔴 词表**从真源现取**，不凭记忆写（21:2x 差点在这里钉错）：我第一版把成功档写成 `closed`，
#    而 `packages/app-host/src/account-closure.ts` 里那四档是
#    not-closed / closed-erase-failed / closed-erase-partial / closed-and-erased ——
#    一个不存在的值意味着**成功也报红**（比恒绿更好发现，但同样白烧一趟）。
VOCAB=$(grep -ho "disposition: '[a-z-]*'" "$REPO/packages/app-host/src/account-closure.ts" | sed -e 's/^disposition: //' -e "s/'//g" | tr '\n' ' ')
ok "真源词表现量（成功只认第一档）：$VOCAB"
case "$DISP" in
  closed-and-erased) ok "判据 B 成立：data-disposition=${DISP}（服务端注销了，且本机两档销毁器都报告清干净）" ;;
  closed-erase-partial|closed-erase-failed) bad "判据 B 不成立：服务端注销了，但本机销毁自己报 $DISP —— 这一格要拦的正是这个形状" ;;
  not-closed) bad "判据 B 不成立：disposition=not-closed（没注销成）⇒ 后面的 D/E 就不是销毁的证据，只是文件恰好没动" ;;
  '') bad "判据 B 不成立：证据里没有 disposition ⇒ 提交那一步没走到（$(grep -o 'ERASE_JOURNEY=[^\\]*' "$DEV" 2>/dev/null | head -1)）" ;;
  *) bad "判据 B 不成立：disposition=${DISP}（不是注销成功那一档）" ;;
esac

step "6. 判据 D：隔离目录里以 heyta.sqlite 为前缀的残留必须 0 枚"
AFTER_N=$(ls "$DB_DIR" 2>/dev/null | grep -c '^heyta\.sqlite')
RESIDUE=$(ls "$DB_DIR" 2>/dev/null | grep '^heyta\.sqlite' | tr '\n' ' ')
if [ "${AFTER_N:-0}" = "0" ]; then
  ok "判据 D 成立：注销前 $BEFORE_N 枚 ⇒ 现在 0 枚（改前枚数现量，不是写死的 3）"
else
  bad "判据 D 不成立：还剩 $AFTER_N 枚 ⇒ $RESIDUE"
fi

step "7. 判据 E：WebKit 那一档（凭据与界面偏好住在浏览器存储，不在壳库）"
# 量的轴是**带前缀的键数**而不是全表行数：产品那侧 `wipePrefixedKeys` 清的是前缀扫
# （`WEB_STORAGE_PREFIX`）+ 一组不带前缀的 sessionStorage 精确键，不是 `localStorage.clear()`。
# 按全表行数判会把"合法留下了别家的键"读成失败，也会在下一次容器里多了别的东西时变脆。
LS3=$(ls3_path)
if [ -z "$LS3" ]; then
  bad "判据 E **没证到**：隔离的 WebKit 容器里没有 localstorage.sqlite3（容器=${WK_DIR}）。这不是「没有明文所以通过」—— 文件缺席也可能是强杀没落盘；先看上一趟运行日志里有没有那句「SIGTERM 20 秒没退」。"
  E_READ="unverified-no-file"
elif [ "$E_BASE" -lt 1 ]; then
  bad "判据 E **没证到**：基线腿没成立（改前=${E_BASE}），注销后读到什么都不构成销毁的证据"
  E_READ="unverified-no-baseline"
else
  # 与判据 A 同一条读法教训：WebKit 的 localstorage 也是 WAL，`immutable=1` 会跳过它。
  ROWS=$(ls3_prefixed "$LS3")
  LEFT=$(sqlite3 "file:$LS3?mode=ro" "SELECT key FROM ItemTable WHERE key LIKE '${LS_PREFIX}%' LIMIT 5;" 2>/dev/null | tr '\n' ' ')
  E_READ="$ROWS"
  # 字节留存腿的**改后**读数（与改前同一把尺、同一组文件）。这一腿不参与红绿：
  # `removeItem` 之后 SQLite 释放的页能不能归零由 WebKit 的收尾决定，不由我们的代码决定
  # （与判据 D 不点名 `-wal`/`-shm` 同一个理由）。它存在的意义是把"行没了"与"字节还在"
  # 分开记 —— 界面上那句"已清除"覆盖到哪一层，得两个数一起说，不能只报前者。
  E_BYTES_AFTER=$(ls3_needle "$LS3" "$LS3"-wal "$LS3"-shm)
  printf '   E 字节腿：改前命中 %s 处 ⇒ 改后命中 %s 处（needle=本趟一次性测试邮箱）\n' \
    "$E_BYTES_BEFORE" "$E_BYTES_AFTER"
  if [ "${E_BYTES_BEFORE:-0}" = "0" ]; then
    printf '   ⚠️ 这一腿**没有对照**（改前就 0 处）⇒ 改后那个数不构成读数，不许读成"盘上没留字节"。\n'
  fi
  case "$ROWS" in
    ''|*[!0-9]*) bad "判据 E 读不到行数（表名/结构变了？）：'$ROWS'" ;;
    0) ok "判据 E 成立：带前缀的键 $E_BASE 枚 ⇒ 现在 0 枚（基线与结果同一把尺、同一枚文件）" ;;
    *) bad "判据 E 不成立：注销后浏览器存储里还剩 $ROWS 枚「${LS_PREFIX}」前缀的键 ⇒ ${LEFT}（文件=${LS3}）" ;;
  esac
fi

step "8. 判据 F：同一组隔离目录再冷启动一次（幂等 + 不会下次同步又拉回来）"
WAIT_FOR="AUTH_STATE="
if ! run_shell F; then
  bad "F 档起跑失败"
fi
FEV="$RUN_DIR/evidence-F.txt"
# 🔴 这一档原来写的是"D 的枚数仍是 0"，而实测它**永远不可能成立**（00:5x 第一趟就是这个红）：
#    一次全新的冷启动必然把 `heyta.sqlite`/-wal/-shm 重新建出来 —— 那是 SQLite 打开一个
#    空库的正常行为，不是"明文又回来了"。一条恒红的判据和一条恒绿的判据一样坏。
#    判据要问的是产品那句话："复起之后本机仍不留明文" ⇒ 尺子换成**内容**而不是文件数。
F_N=$(ls "$DB_DIR" 2>/dev/null | grep -c '^heyta\.sqlite')
F_OPS=$(sqlite3 "file:$DB_DIR/heyta.sqlite?mode=ro" 'SELECT COUNT(*) FROM ops;' 2>/dev/null | tr -d '[:space:]')
case "$F_OPS" in
  ''|*[!0-9]*) if [ -f "$DB_DIR/heyta.sqlite" ]; then F_OPS=-1; else F_OPS=0; fi ;;
esac
# 明文对照：本趟那条便签的正文不许以任何形态再出现在库目录里（含 -wal 里未 checkpoint 的帧）。
F_PLAIN=0
for f in "$DB_DIR"/heyta.sqlite*; do
  [ -f "$f" ] || continue
  if grep -a -q -- "$NOTE_A" "$f" 2>/dev/null; then F_PLAIN=$((F_PLAIN + 1)); fi
done
if [ "$F_OPS" = "-1" ] && [ -f "$DB_DIR/heyta.sqlite" ]; then
  bad "判据 F 读不到 ops 计数（表结构变了？）⇒ 这一档不构成读数"
elif [ "$F_OPS" -eq 0 ] && [ "$F_PLAIN" -eq 0 ] && grep -qF 'AUTH_STATE=signed-out' "$FEV" 2>/dev/null; then
  ok "判据 F 成立：复起建出 $F_N 枚文件但 ops=0、便签明文 0 处命中、界面回到「没有可登录的账号」"
else
  bad "判据 F 不成立：ops=$F_OPS / 明文命中 $F_PLAIN 个文件 / 身份态 $(grep -o 'AUTH_STATE=[a-z-]*' "$FEV" 2>/dev/null | head -1)"
fi

step "9. 判据 S：默认路径那枚真库整趟没被动过（隔离没漏）"
S_AFTER=$(default_state)
echo "   改前：$S_BEFORE"
echo "   改后：$S_AFTER"
# 🔴 这一条在"本机没有默认库"时**也不是恒真**：那档下相等意味着"壳全程没往默认路径创建过它"，
#    而摘掉 `HEYTA_SHELL_DB_DIR` 的那趟恰恰会创建它（M3）⇒ 两个起点都有牙。
if [ "$S_BEFORE" = "$S_AFTER" ]; then
  ok "判据 S 成立：默认路径五项读数逐项相同 ⇒ 本趟删的是隔离目录那枚，不是用户的真库"
else
  bad "判据 S 不成立：默认路径变了（改前 ${S_BEFORE} / 改后 ${S_AFTER}）⇒ 隔离旋钮漏了一档，本趟动过本机真数据"
fi

step "汇总"
printf '  判据读数：A(ops)=%s  改前枚数=%s  C=%s  B(disposition)=%s  改后枚数=%s  E(前缀键 基线⇒注销后)=%s⇒%s  E字节(命中 改前⇒改后)=%s⇒%s  F(复起 ops/明文命中/文件枚数)=%s/%s/%s  S(默认路径)=%s\n' \
  "$OPS_N" "$BEFORE_N" "$([ -f "$CEV" ] && grep -qF 'ARMED' "$CEV" && echo ARMED || echo NO)" \
  "${DISP:-none}" "${AFTER_N:-?}" "$E_BASE" "$E_READ" "$E_BYTES_BEFORE" "$E_BYTES_AFTER" \
  "${F_OPS:-?}" "${F_PLAIN:-?}" "${F_N:-?}" \
  "$([ "$S_BEFORE" = "$S_AFTER" ] && echo SAME || echo CHANGED)"
NOTES="$RUN_DIR"
if [ "$FAILS" = "0" ]; then
  printf 'ERASE_MAC=PASS  （A/C/B/D/E/F/S 全绿；证据与隔离目录已随本趟清理，目录名=%s 留在这里备查）\n' "$EXEC_NAME"
  exit 0
fi
printf 'ERASE_MAC=FAIL（%d 条红；证据目录 %s）\n' "$FAILS" "$NOTES"
exit 1
