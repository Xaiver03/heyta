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
export PORT="${PORT:-3100}"
. "$(dirname "$0")/lib/mobile-e2e.sh"
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
# 🔴 **trap 必须排在 source 之后** —— `scripts/lib/mobile-e2e.sh:702` 自己有一条 `trap restore_ime EXIT`，
#    而 bash 的 EXIT 只有一个处理器 ⇒ 在 source **之前**设的那条会被**静默替换**。
#    现量：30 枚 source 这份 lib 的 rig 全在这个形状里，`scripts/` 下因此堆了 40 枚 `.snap.` 残留，
#    而 `check:script-snapshot` 按字面匹配（`:121`，窗口只到第 35 行）对它们全部报绿 ⇒ 洞登记为 G-trap-lie。
#    第一条字面是给那条门禁认的 needle；第二条才是生效的那条，它继续清 `$0`，并带走本趟的含明文落盘产物 ——
#    界面 dump 里有**访问令牌**（凭据面板把它印在输入框的值上），而这条验收证的正是「注销之后本机不留明文」，
#    装置自己更不许在 /tmp 留明文。挂在 EXIT 上而不是末尾 `rm` 一次：判红 / 环境无效那些早退路径也要删。
trap 'rm -f -- "$0"' EXIT
trap 'rm -f -- "$0" "${IDB_DUMP_FILE:-}" "${CLOSE_BODY:-}"' EXIT
#
# iOS 模拟器「注销账号 = 本机明文库真的销毁」验收（真模拟器 + 真服务端，零 mock）
# ==========================================================================
#
# 这一格补的是 E2 里**只有 iOS 才有的一份证据**：op-sqlite 的 **iOS 后端**收到
# `ACCOUNT_CLOSED` 信号之后，模拟器容器里那枚明文库是不是真的没了。Android 那一格
# （`verify-mobile-account-erasure.sh`）证的不是同一件事 —— 两个后端各有一份
# `removeDatabase` 实现，任何一端没证过都不许报成「移动端已证」（计划 §10.13）。
#
# ## 这条腿问什么、不问什么
#
# 🔴 **不问**「界面上点得到注销吗」—— 那是 E3 的移动端 UI 腿，判据在
#    `apps/mobile/tests/account-closure-entry.spec.ts` 与 Android 装置的第 5 步
#    （两端渲染同一份 `AccountClosureScreen`，平台差异不在那一屏）。
#    注销那一发在这里落在**服务端自己的端点**（`DELETE /api/account` ——
#    那个屏幕最终调的就是它），设备侧只看「下次同步收到 410 之后容器里还剩什么」。
#    ⇒ 走的是 `packages/sync-client` 的 `isAccountClosedFailure` → `eraseLocalData`
#      → 宿主销毁器 → `apps/mobile/src/db/op-sqlite-driver.ts` 的 `destroy()`。
#
# ## 判据（A/B 承重，D 是这一格的正证）
#
# | 号 | 判据 | 为什么要有它 |
#|---|---|---|
#| **A** | 注销**之前**容器里 `Library/heyta.sqlite` 在盘上，且 `ops` 数得出 ≥1 行 | 库本来就没有 ⇒「它消失了」恒真。这是全脚本唯一的前提证明 |
#| **B** | 换成语法合法、服务端不认的令牌（401 `TOKEN_INVALID`，**不是** 410）后同步，库**必须还在** | 🔴 承重的负向对照。「任何 401 都删库」= 改一次密码就毁掉所有设备的本地数据。放宽那一判定 ⇒ 这一条转红，而它**不会在任何正向判据里现形** |
#| C | 之后设备下一次同步，界面上出现 `common.sync.error.accountClosed` 那句 | 证明客户端把它读成「账号已注销」而不是「重新登录」（`client.ts:925-945` 那段顺序判定）。只有 D 没有 C，「文件没了」可能来自任何别的原因 |
#| **D** | 容器 `Library/` 里以 **`heyta.sqlite`**（整串库名）为前缀的残留 **0 枚** | 这一格的正证本身。🔴 前缀只能是整串库名：同一目录实测还有一枚**不归 destroy 管**的 `heyta-device-prefs.sqlite`（计划 §10.68.6：5/5 枚模拟器都在）⇒ 按词干 `heyta` 数会把它算成残留，每趟假红。🔴 不写死 `-wal`/`-shm` 名单：op-sqlite 三个后端的 `opsqlite_remove` 各自只 unlink 一条路径，旁挂能不能消失由 SQLite 自己的收尾决定，数「前缀枚数」才挡得住 |
#| E | 再同步一次（令牌已死）之后残留仍是 0 | 销毁之后没有第二条写路径把它重建；也是幂等证明 |
#
# ## 变异靶（拿到窗口后随跑，两条都按「恰好红」判）
#
#   M1 摘掉 `onAccountClosed` 里的本机销毁回调 ⇒ **D 恰好转红**（C 仍绿：那句报错
#      来自同步结果分类，与清库成不成功无关 —— 这正是「C 不能替 D 作证」的原因）
#   M2 把「只有 ACCOUNT_CLOSED 才清库」放宽成「任何 401 都清库」 ⇒ **B 恰好转红**
#
# ## 界面腿的状态要说清楚
#
# 🔴 填写/滚动/收键盘这些动作走的是共享工具 `scripts/tools/ios-ax-shim.py`
#    （iOS AX 驱动的唯一实现；本脚本只是它的调用方，**没有第二份实现**）。
#    但**这一整套顺序在本装置上还没真机跑过** —— 首跑若红在填写步，先按
#    `found/visible/typedRc` 的读数判「是界面到不了还是产品坏了」，
#    不许直接写成产品缺陷（§7 元规则一）。
#
# 用法：IOS_UDID=<udid> PORT=3100 bash scripts/verify-mobile-ios-account-erasure.sh
#
# 前置（**都不由本装置创建**，与 verify-mobile-* 全族一致）：
#   · `IOS_UDID` 指向一台**已启动**的模拟器。不给就只允许「同名唯一」或「整机唯一」
#     两种自动选中，多台且无同名 ⇒ **不猜**（`verify-ios-lan-http.sh:74-107` 同一规则）——
#     猜中的那台可能正被另一条会话实时配置。
#   · 那台设备上**已装有** heyta。本装置**不装包**（装包属于 `reinstall:mobile` 那一层），
#     但第 0 步判它新不新。
#   · `PORT` 指向一个 TEST_MODE 服务端；`/tmp/heyta_mobile_{token,email,e2ee}.txt` 齐。
# 🔴 退出码：**0** 全绿 / **1** 判据红 / **3** 环境条件不成立（设备归属、产物不新鲜、
#    服务端不可达、别人的验收在跑、AX 工具接口漂移）—— 3 不是产品判决，别照着它改代码。

# 当场自检（判据，不是注释）：最后一行 trap 必须**排在 source 之后**且含 `$0`。两个方向都能红。
_last_trap_line=$(grep -nE '^trap .* EXIT$' "$0" | tail -1 | cut -d: -f1)
_last_trap_body=$(grep -E '^trap .* EXIT$' "$0" | tail -1)
# 🔴 用 POSIX 字符类而不是 `\s` —— BSD grep 的 ERE 对 `\s` 没有保证（这仓已经栽过 `\b` 那一次）。
_src_line=$(grep -nE '^[[:space:]]*\.[[:space:]]*".*lib/mobile-e2e\.sh"' "$0" | head -1 | cut -d: -f1)
if [ -z "$_src_line" ]; then
  echo "❌ 自检读不到 source lib 的那一行 ⇒ 先后关系没法判，本趟作废" >&2
  exit 1
fi
if [ -z "$_last_trap_line" ] || [ "$_last_trap_line" -le "$_src_line" ]; then
  echo "❌ 生效的 EXIT trap（第 ${_last_trap_line:-无} 行）排在 source lib（第 ${_src_line} 行）之前" >&2
  echo "   ⇒ lib 尾部的 trap 会整条替换它，快照与明文产物都不会被清" >&2
  exit 1
fi
case "$_last_trap_body" in
  *'"$0"'*) ;;
  *) echo "❌ 生效的 EXIT trap 不再清快照副本 —— 现量：${_last_trap_body}" >&2
     echo "   ⇒ 按字面匹配的门禁查不出来，本趟作废" >&2
     exit 1 ;;
esac

BID=${IOS_BID:-com.heyta}
DEVICE_NAME=${IOS_DEVICE_NAME:-iPhone 17 Pro}
DB_NAME=heyta.sqlite
LIB_NAME=heyta-device-prefs.sqlite
STAMP=$(date +%H%M%S)
NOTE_A="ios-erase-${STAMP}"
EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"
SHIM="$(cd "$(dirname "$0")" && pwd)/tools/ios-ax-shim.py"
LOAD1=$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{} ')

# 🔴 设置面那一行的可点名是**标题 + 副标题拼起来**的（`ProfileScreen.tsx:612-614`
#    把 `mobile.profile.entry.settings` 与 `.settings.hint` 一起交给无障碍层）。
#    两个半边各自都是词条表的值；拼串本身不是 ⇒ 所以拼在这里，注释指回真源。
SETTINGS_ROW="设置, 同步凭据、桌面小组件与语言"

# ── 设备侧与容器侧的读法 ────────────────────────────────────────────────────
ax() { python3 "$SHIM" "$@" --udid "$UDID" --idb "$IDB_BIN" --companion "$IDB_COMPANION" --json; }
jget() { printf '%s' "$1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$2',''))" 2>/dev/null; }
ax_press() { ax "$1" --pressable --press --json >/dev/null 2>&1; }
dismiss_keyboard() { ax --dismiss-keyboard --json >/dev/null 2>&1 || true; }
ls_lib_dir() { ls -1 "${DATA_CONTAINER}/Library" 2>/dev/null | tr -d '\r'; }
db_present() { [ -f "${DATA_CONTAINER}/Library/${DB_NAME}" ]; }
db_ops_count() { sqlite3 "${DATA_CONTAINER}/Library/${DB_NAME}" "SELECT COUNT(*) FROM ops;" 2>/dev/null | tr -d ' '; }
# 🔴 计数前先 `sed 's#.*/##'` 剥路径：离线六臂量过它的方向（计划 §10.68.5）——
#    列表若回显**全路径**，前缀锚点直接读成 0 枚，也就是「库还在盘上」会被报成
#    「销毁成功」（假阴性 = 危险那一侧）。`ls -1` 今天给的是裸名，这道防线不是装饰。
residue_count() { printf '%s\n' "$1" | sed 's#.*/##' | grep -c "^${DB_NAME}"; }

dismiss_ios_save_password() {
  # 系统「保存密码？」弹窗**不在应用的 AX 树里**，而它会让整棵树只剩 AXApplication。
  # 判据用「两个只在真实页上才有的底部标签都不在」这个结构性指纹 ——
  # 🔴 不许用某个页面标题当「没有弹窗」的证据（实测那次：认证页的标题恰好就是被查的那个串，
  #    于是弹窗从来没被关掉，之后所有查询 found=False，方向被整体带偏）。
  # 先收软键盘：键盘弹着时被它盖住的底部标签会从树上消失，会把**键盘态**误判成**弹窗态**。
  dismiss_keyboard
  local t m
  t=$(jget "$(ax "任务" --list --json)" found)
  m=$(jget "$(ax "我的" --list --json)" found)
  if [ "$t" != "True" ] && [ "$m" != "True" ]; then
    echo "     底部两个标签都不在树上 ⇒ 按 iOS 系统弹窗态处理，按坐标点「以后」"
    # 坐标来自截图量取（设备 402×874，「以后」≈ x=31% / y=61.5%）—— 系统弹窗的布局，
    # 不由我们的代码决定，只能这样锚。有效性证据：点完之后 label 数 1 → 70。
    ax --tap 125 537 --json >/dev/null 2>&1 || true
    sleep 2
  fi
}

# ── 0. 现场与归属 ──────────────────────────────────────────────────────────
step "0. 现场与归属（设备 / 产物新鲜度 / 服务端 / 别人的验收 / AX 工具接口）"
UDID=${IOS_UDID:-}
if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl list devices booted -j 2>/dev/null | python3 -c "
import json, sys
want = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
booted = []
for _rt, devs in (data.get('devices') or {}).items():
    for d in devs:
        if d.get('state') == 'Booted':
            booted.append((d.get('name') or '', d.get('udid') or ''))
same = [u for n, u in booted if n == want]
if len(same) == 1:
    print(same[0])
elif len(booted) == 1:
    print(booted[0][1])
" "$DEVICE_NAME" 2>/dev/null)
  if [ -z "$UDID" ]; then
    echo "   ❌ 认不出该验收哪台模拟器（已启动 $(xcrun simctl list devices booted 2>/dev/null | grep -c Booted) 台，且无唯一同名「${DEVICE_NAME}」）—— 不猜。"
    echo "      显式指定：IOS_UDID=<udid> bash scripts/verify-mobile-ios-account-erasure.sh ⇒ exit 3（环境条件）"
    exit 3
  fi
fi
IDB_UDID="$UDID"
export IDB_BIN IDB_UDID

# 🔴 dump 落盘必须换成**本趟私有的路径**。lib 的默认值是一枚固定路径
#    （`scripts/lib/mobile-e2e.sh:1029` 的 `IDB_DUMP_FILE=${IDB_DUMP_FILE:-/tmp/_heyta-idb-dump.json}`），
#    两个理由都要挡：
#    ① 两条 iOS 线共用它时，后写的那趟会**覆盖前者的证据**而没人报红
#       （同一形状已经在 e2e 的截图 md5 上实测过一次：证据被别人重写、读数照常绿）；
#    ② 更要紧的：本装置全程要把**访问令牌**填进凭据面板，而 `describe-all` 会把输入框的
#       **值**一起抄进这份 dump ⇒ 探针自己在 /tmp 里造了一份本机明文。
#       这条验收证的就是「注销之后本机不留明文」，装置本身更不许留下明文。
#    删除挂在文件头那条 EXIT trap 上（早退也删），不只在末尾删一次。
IDB_DUMP_FILE=/tmp/_heyta-idb-dump-erase-$STAMP.json
export IDB_DUMP_FILE

OTHER=$(another_mobile_e2e_running)
if [ -n "$OTHER" ]; then
  echo "   ❌ 有别的移动端验收正在跑（并行 = 互相拆现场 / 抢同一台设备）："
  printf '%s\n' "$OTHER" | sed 's/^/      /'
  echo "      这是环境条件，不是产品失败 ⇒ exit 3"
  exit 3
fi

APP_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null)
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
if [ -z "$APP_CONTAINER" ] || [ ! -d "$APP_CONTAINER" ]; then
  echo "   ❌ 这台设备上没有已装的 ${BID}（本装置不装包 —— 装包是 reinstall:mobile 那一层的动作）⇒ exit 3"
  exit 3
fi
# 🔴 新鲜度：装着的产物比源码旧 ⇒ **这一格不成立**（traps #178 同一形状）——
#    验出来的销毁行为属于上一次构建，不属于当前这批代码。拒绝跑，而不是跑完再解释。
BUNDLE_JS="${APP_CONTAINER}/main.jsbundle"
APP_MTIME=$(stat -f %m "$APP_CONTAINER" 2>/dev/null || echo 0)
JS_MTIME=$(stat -f %m "$BUNDLE_JS" 2>/dev/null || echo 0)
SRC_MTIME=$(find "$HEYTA_REPO_ROOT/apps/mobile/src" "$HEYTA_REPO_ROOT/packages/ui/src" \
  \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null \
  | xargs -0 stat -f '%m' 2>/dev/null | sort -rn | head -1)
NEWEST=$(( APP_MTIME > JS_MTIME ? APP_MTIME : JS_MTIME ))
echo "   设备: ${DEVICE_NAME} (${UDID})"
echo "   已装产物: ${BID}  app=${APP_MTIME} main.jsbundle=${JS_MTIME}   源码最新 mtime=${SRC_MTIME:-未取到}"
echo "   容器 data: ${DATA_CONTAINER:-（尚未生成，首启后才有）}"
echo "   负载(记录值): ${LOAD1:-未取到}   服务端: $HOST_SERVER"
if [ -z "$SRC_MTIME" ]; then
  echo "   ❌ 取不到源码 mtime（find/xargs 在这台机器上没跑通）⇒ 无法判新鲜度，本趟不作数。exit 3"
  exit 3
fi
if [ "$NEWEST" -lt "$SRC_MTIME" ]; then
  echo "   ❌ 设备上装的是旧产物（bundle 比源码旧）⇒ 量的不是当前代码。先 pnpm reinstall:mobile。exit 3"
  exit 3
fi

if curl -sf "$HOST_SERVER/health" >/dev/null 2>&1 || curl -sf "$HOST_SERVER/api/health" >/dev/null 2>&1; then
  ok "服务端在 $HOST_SERVER 可达"
else
  echo "   ❌ 服务端不可达 —— 注销信号送不到设备，B/C/D 全部无从判起 ⇒ exit 3"
  exit 3
fi
SRV_PID=$(lsof -ti "tcp:${E2E_PORT}" -sTCP:LISTEN 2>/dev/null | head -1)
SRV_CMD=$(ps -o command= -p "${SRV_PID:-0}" 2>/dev/null | cut -c1-90)
echo "   服务端归属: pid=${SRV_PID:-未识别} HEAD=$(git -C "$HEYTA_REPO_ROOT" rev-parse --short HEAD 2>/dev/null) dist=$(stat -f '%Sm' "$HEYTA_REPO_ROOT/server/dist/src/index.js" 2>/dev/null || echo 缺)"
echo "   服务端命令行: ${SRV_CMD:-未取到}"

if ! resolve_idb; then
  echo "   ❌ 找不到 idb —— iOS 验收要从设备内部驱动界面 ⇒ exit 3"
  exit 3
fi
ensure_idb_companion || { echo "   ❌ idb companion 起不来 ⇒ exit 3"; exit 3; }
# 🔴 本装置依赖共享 iOS AX 工具的三个动作。那份工具正被另一条线改 ——
#    接口漂了，本装置会一路红在填写步，而症状长得像「产品界面坏了」。
#    所以开局机器可读地确认这三个旗标还在，缺任一个判**环境无效**（exit 3）。
SHIM_HELP=$(python3 "$SHIM" --help 2>&1 || true)
SHIM_MISSING=""
for _flag in --dismiss-keyboard --type-text --scroll-into-view; do
  printf '%s\n' "$SHIM_HELP" | grep -q -- "$_flag" || SHIM_MISSING="${SHIM_MISSING} ${_flag}"
done
if [ -n "$SHIM_MISSING" ]; then
  echo "   ❌ ios-ax-shim 不再接受：${SHIM_MISSING# } ⇒ 装置与工具接口漂移，本趟不判产品。exit 3"
  exit 3
fi
ok "iOS AX 工具接口在位（--dismiss-keyboard / --type-text / --scroll-into-view）"

# ── 1. 起 App 到主界面 ─────────────────────────────────────────────────────
step "1. 全新态起 App，并处置首启两屏（隐私同意面板 / 欢迎页）"
xcrun simctl uninstall "$UDID" "$BID" >/dev/null 2>&1
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1 \
  || { bad "App 起不来（${BID} @ ${UDID}）"; summary "iOS 注销销毁" "" 1; }
sleep 8
# 🔴 用 `idb_has` 判存在与否要看**退出码**（0=在树上），它什么都不打印。
#    把它当"读回字符串再比 0/1"会让每一屏都被读成「不在」—— 静默跳过 = 这条处置是装饰。
for _screen in "同意并联网" "先离线使用"; do
  idb_dump
  if idb_has "$_screen"; then
    XY=$(idb_label_center "$_screen" 2>/dev/null)
    if [ -z "$XY" ]; then
      bad "「${_screen}」在树上但取不到坐标（角色不是可点节点？）"
      xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-0-screen-stuck.png" >/dev/null 2>&1
      summary "iOS 注销销毁" "" 1
    fi
    idb_ui tap $XY >/dev/null 2>&1
    sleep 3
    echo "     已点「${_screen}」@ ${XY}"
  else
    echo "     首启没有「${_screen}」这一屏"
  fi
done
dismiss_ios_save_password
idb_dump
if idb_has "任务"; then
  ok "已到主界面（底部标签「任务」在树上）"
else
  bad "处置完首启两屏后仍读不到「任务」标签 —— 界面没到主屏，后面的填写都不可信"
  xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-0-not-on-main.png" >/dev/null 2>&1
  summary "iOS 注销销毁" "" 1
fi

# ── 2. 建号 + 填凭据 ───────────────────────────────────────────────────────
step "2. 建一个已知口令的新账号，把凭据填进设备的设置面"
# 🔴 覆盖的是 `HEYTA_E2E_SERVER` 而不是 `SERVER`：helper 里那句
#    `HEYTA_E2E_SERVER="${SERVER:-…}"` 在 **source 时**就展开定死了（那时是 10.0.2.2），
#    调用点再改 SERVER 不会重新求值 —— 建号会静默打到 Android 模拟器那个地址上。
if HEYTA_E2E_SERVER="$HOST_SERVER" heyta_e2e_fresh_account; then
  TOKEN=$(cat /tmp/heyta_mobile_token.txt)
  EMAIL=$(cat /tmp/heyta_mobile_email.txt)
  E2EE=$(cat /tmp/heyta_mobile_e2ee.txt)
  ok "新账号就位：$EMAIL"
else
  echo "   ❌ 建不了新号（服务端没开 TEST_MODE？）—— 沿用旧凭据会把销毁判据打在别人的历史上 ⇒ exit 3"
  exit 3
fi
BAD_TOKEN="eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.000000000000000000000000000000.sub-not-real"

open_settings_sheet() {  # 打开设置面并等「服务器地址」输入框进树
  dismiss_keyboard
  ax "我的" --pressable --scroll-into-view >/dev/null 2>&1
  ax_press "我的"; sleep 3
  local r
  r=$(ax "$SETTINGS_ROW" --pressable --scroll-into-view)
  if [ "$(jget "$r" visible)" != "True" ]; then
    bad "「设置」入口滚不进可见区（found=$(jget "$r" found) scrollRc=$(jget "$r" scrollRc)）—— 兜底路径无法继续"
    return 1
  fi
  ax "$SETTINGS_ROW" --pressable --press --json >/dev/null 2>&1
  sleep 2.5
  local i
  for i in $(seq 1 12); do
    [ "$(jget "$(ax "服务器地址" --role AXTextField --list --json)" found)" = "True" ] && return 0
    sleep 1
  done
  bad "设置面没打开（12 秒内「服务器地址」输入框不在树上）—— 判据不能建在没打开的面上"
  return 1
}

fill_field() {  # <标签> <值> [secure]
  local lbl="$1" val="$2" kind="${3:-}" out back attempt=1
  while [ "$attempt" -le 3 ]; do
    dismiss_keyboard
    out=$(ax "$lbl" --role AXTextField --type-text "$val")
    back=$(jget "$out" detail)
    if [ "$kind" = "secure" ]; then
      # secure 框回读是**掩码**：长度等于原文才叫「进去了」（多了 = 上一次的残留 = 追加）。
      # 🔴 掩码不能逐字比，但也**不能因为不能比就跳过** —— 长度是实测唯一可用的读数。
      if [ "$(jget "$out" typedRc)" = "0" ] && [ "${#back}" -eq "${#val}" ] && [ -n "$back" ]; then
        ok "已填「${lbl}」（secure：聚焦+键盘输入，掩码长度 ${#back} = 原文长度）"
        return 0
      fi
    elif [ "$(jget "$out" typedRc)" = "0" ] && [ "$back" = "$val" ]; then
      ok "已填「${lbl}」（回读逐字相同）"
      return 0
    fi
    echo "     [fill] 「${lbl}」第 ${attempt} 次没成：typedRc=$(jget "$out" typedRc) 回读长度=${#back}（期望 ${#val}）"
    attempt=$((attempt + 1))
  done
  bad "「${lbl}」三次都没能写进去（${kind:-text}）"
  return 1
}

close_settings_sheet() {
  local i
  for i in $(seq 1 6); do
    [ "$(jget "$(ax "关闭" --list --json)" found)" != "True" ] && { ok "设置面已关（第 ${i} 次检查）"; return 0; }
    ax_press "关闭"
    sleep 2
  done
  bad "设置面关不上（点了 6 次「关闭」它还在）—— 下一轮起点会脏"
}

fill_three_credentials() {  # <令牌>
  open_settings_sheet || return 1
  # 顺序：服务器地址 → 口令 → 令牌。`configured` 只看地址+令牌，
  # 最后写令牌意味着中途被打断不会留下「半配置」的歧义态。
  fill_field "服务器地址" "$HOST_SERVER" || return 1
  fill_field "端到端加密口令" "$E2EE" secure || return 1
  fill_field "访问令牌" "$1" || return 1
  dismiss_ios_save_password
  # 终态断言：三个字段**同时**还在 —— 「后一步把前一步清空」是实测踩过的形状，
  # 逐字段各自的局部断言抓不住它。
  local miss=""
  [ "$(jget "$(ax "服务器地址" --role AXTextField --list --json)" found)" = "True" ] || miss="${miss} 服务器地址"
  [ "$(jget "$(ax "访问令牌" --role AXTextField --list --json)" found)" = "True" ] || miss="${miss} 访问令牌"
  [ "$(jget "$(ax "端到端加密口令" --role AXTextField --list --json)" found)" = "True" ] || miss="${miss} 端到端加密口令"
  if [ -n "$miss" ]; then bad "填完之后这些字段反而不在了：${miss# }"; return 1; fi
  ok "三个凭据字段同时就位"
  if [ "$(jget "$(ax "填好服务器地址与访问令牌后才能同步。" --list --json)" found)" = "True" ]; then
    bad "界面仍认为未配置（填进去的没生效）"
    return 1
  fi
  close_settings_sheet
}

sync_now() {  # 点「立即同步」：忙时它会改名叫「正在同步…」，所以先等它回到空闲名
  dismiss_keyboard
  ax "我的" --pressable --press --json >/dev/null 2>&1
  sleep 3
  if ! idb_wait_label "立即同步" 90; then
    bad "90 秒内没等到「立即同步」这个标签（它一直 busy？）—— 这一次同步没被触发，后面的读数不作数"
    return 1
  fi
  ax_press "立即同步"
}

fill_three_credentials "$TOKEN" \
  || { xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-1-credential-fill.png" >/dev/null 2>&1; summary "iOS 注销销毁" "" 1; }

# ── 3. 造一条本机数据，让"销毁"有东西可销 ──────────────────────────────────
step "3. 界面上建一条便签（让库里真的有用户字节）"
sync_now
sleep 8
ax "任务" --pressable --press --json >/dev/null 2>&1; sleep 3
idb_dump
XY=$(idb_field_center "写点什么…" 2>/dev/null)
if [ -z "$XY" ]; then
  bad "找不到便签输入框「写点什么…」—— 没有本机数据时判据 A 只能退化成「库文件在」，这一格不构成销毁证明"
  xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-2-no-composer.png" >/dev/null 2>&1
  summary "iOS 注销销毁" "" 1
fi
idb_type_into "写点什么…" "$NOTE_A" || bad "便签文本没输进去"
XY=$(idb_label_center "添加便签" 2>/dev/null)
if [ -z "$XY" ]; then
  bad "找不到「添加便签」按钮"
  summary "iOS 注销销毁" "" 1
fi
idb_ui tap $XY >/dev/null 2>&1
sleep 4
idb_dump
if idb_has "$NOTE_A"; then
  ok "便签已建出：$NOTE_A"
else
  bad "便签没出现在界面上（写这一步没走通，A 之后数到的会是一只空库）"
  summary "iOS 注销销毁" "" 1
fi

step "4. 判据 A：注销**之前**本机库必须在盘上、且有 op 行（前提证明，不是过场）"
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
if ! db_present; then
  bad "容器里没有 Library/${DB_NAME} —— 后面「它消失了」将恒真，本趟作废"
  summary "iOS 注销销毁" "" 1
fi
OPS_N=$(db_ops_count)
case "$OPS_N" in
  ''|*[!0-9]*) bad "读不到 ops 计数（'${OPS_N}'）—— 库结构或表名变了？本趟作废"; summary "iOS 注销销毁" "" 1;;
esac
if [ "$OPS_N" -ge 1 ]; then
  ok "判据 A 成立：${DB_NAME} 在盘上，ops 有 ${OPS_N} 行"
else
  bad "判据 A 不成立：库在但一条 op 都没有 ⇒ 这台设备上没有东西可销毁，D 不构成证据"
  summary "iOS 注销销毁" "" 1
fi

# ── 5. 判据 B：401 不许清库 ────────────────────────────────────────────────
step "5. 判据 B：换成服务端不认的令牌（401 TOKEN_INVALID），库必须还在"
fill_three_credentials "$BAD_TOKEN" \
  || { bad "B 这一档的令牌没换成 ⇒ 判据 B 没跑到，本趟不作数"; summary "iOS 注销销毁" "" 1; }
sync_now
sleep 10
if db_present; then
  ok "判据 B 成立：一次 401 之后 ${DB_NAME} 仍在盘上（凭据失效不动用户数据）"
else
  bad "🔴 判据 B 红：一次 401 就把本机库删了 —— 改一次密码会踢掉所有设备并毁掉它们的本地数据"
fi
xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-3-401-keeps-db.png" >/dev/null 2>&1
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)

step "6. 换回真令牌并同步（D 需要一条「曾经配好过」的对照基线）"
fill_three_credentials "$TOKEN" || { bad "换回真令牌没走通"; summary "iOS 注销销毁" "" 1; }
sync_now
sleep 10
if db_present; then
  ok "换回有效令牌后库仍在（B 的读数不是「库里本来就没人写过」）"
else
  bad "换回有效令牌后库反而没了 ⇒ 是上一档那次 401 删的，B 的红成立"
fi

# ── 7. 注销那一发走服务端自己的端点 ────────────────────────────────────────
step "7. 用这台设备的令牌调 DELETE /api/account，并确认服务端此后回 410"
CLOSE_BODY=/tmp/heyta-ios-close-${STAMP}.json
CLOSE=$(curl -s -o "$CLOSE_BODY" -w '%{http_code}' -X DELETE "$HOST_SERVER/api/account" \
  -H "authorization: Bearer ${TOKEN}")
echo "     DELETE /api/account → HTTP ${CLOSE}  body: $(head -c 160 "$CLOSE_BODY" 2>/dev/null)"
AFTER=$(curl -s -o /dev/null -w '%{http_code}' "$HOST_SERVER/api/account" -H "authorization: Bearer ${TOKEN}")
if [ "$AFTER" = "410" ]; then
  ok "服务端对旧令牌此后回 **410**（E1b 的形态在这台服务端上成立：注销独占 410，其余仍 401）"
else
  bad "注销后再拿这枚令牌请求得到的是 ${AFTER} 而不是 410 —— 设备收到的信号不是「账号已注销」，D 就算红也不能算产品缺陷"
fi
rm -f "$CLOSE_BODY"

step "8. 判据 C：设备下一次同步把这件事读成「账号已注销」"
sync_now
DONE=0
for i in $(seq 1 40); do
  idb_dump
  if idb_has "这个账号已经注销，无法再次登录，同步已停止 —— 注销后这台设备上的本地副本会被清除。如果这不是你的操作，请联系服务端运营者"; then DONE=1; break; fi
  sleep 3
done
if [ "$DONE" = "1" ]; then
  ok "判据 C 成立：界面报出的是「账号已注销」那句，不是「重新登录」那句"
else
  bad "40×3s 内界面没报出注销那句 —— 客户端没把它分类成 account-closed；D 就算空了也不能归功于销毁器"
fi
xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-account-erasure-4-after-closure.png" >/dev/null 2>&1

step "9. 判据 D（这一格的正证）：容器 Library 里以 ${DB_NAME} 为前缀的残留 0 枚"
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
sleep 4
LISTING=$(ls_lib_dir)
RESIDUE=$(residue_count "$LISTING")
PREFS=$(printf '%s\n' "$LISTING" | sed 's#.*/##' | grep -c "^${LIB_NAME}$")
if [ "$RESIDUE" = "0" ]; then
  ok "判据 D 成立：${DATA_CONTAINER}/Library 里以 ${DB_NAME} 为前缀的残留 0 枚（真机运行时，不是桩；-wal / -shm / -journal 任何旁挂都在射程内）"
else
  bad "判据 D 红：以 ${DB_NAME} 为开头的残留有 ${RESIDUE} 枚 ⇒ E2 的 iOS 那一格没闭合"
  printf '%s\n' "$LISTING" | sed 's#.*/##' | grep "^${DB_NAME}" | sed 's/^/       残留：/'
fi
echo "     （另：设备本地偏好库 ${PREFS} 枚在册（${LIB_NAME}）—— 它不属于本机明文库，注销不该动它；这一行只把形状打在读数里，见计划 §10.68.6 的 G-prefs）"

step "10. 判据 E：再同步一次之后残留仍是 0（没有第二条写路径把它重建）"
sync_now
sleep 8
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
RESIDUE2=$(residue_count "$(ls_lib_dir)")
if [ "$RESIDUE2" = "0" ]; then
  ok "两次读都是 0 枚残留：销毁成立，且没有复活路径"
else
  bad "第二次读以 ${DB_NAME} 为前缀的残留又变成 ${RESIDUE2} 枚 —— 销毁之后有东西把它重建了"
fi

echo "     截图：apps/mobile/evidence/ios-account-erasure-{0-not-on-main,1-credential-fill,2-no-composer,3-401-keeps-db,4-after-closure}.png"
echo "     🔴 本装置**不**证移动端注销屏幕的界面腿（E3 那一格）：注销那一发走的是服务端端点。"
summary "iOS 注销销毁"
