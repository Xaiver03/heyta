#!/bin/bash
#
# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 按字节偏移增量读取脚本：
#    运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。入口先把整份脚本拷成
#    同目录隐藏快照再 exec 副本；$0 的 dirname 不变，lib 定位照旧。
#    ⚠️ 这一块必须在**前 15 行**：`check:script-snapshot` 判的正是"标记在头部"，
#    把块挪到长注释之后 = 标记还在、门禁红（本文件的登记表条目即按此摆放）。
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
trap 'rm -f -- "$0"' EXIT
#
# iOS「AI 助手」真机验收（真模拟器 + 确定性假端点，零 mock 产品代码）
# =====================================================================
#
# 🔴 为什么要有这个脚本（而不是把助手段并进 `verify-mobile-ios.sh`）
#
# 在它存在之前，**iOS 侧的助手面一条设备读数都没有**。Android 那 14 步跑通之后，
# 很容易把"移动端 AI 已验"当成既成事实 —— 而两端各自有一整套只在自家设备上才现形的
# 失效面：iOS 的 AX 标签同样被 RN 合成（实测 `设置` 的 AXLabel 是
# `"设置, 同步凭据、桌面小组件与语言"` ⇒ 按整串精确匹配恒取空）、软键盘会把下半屏
# 元素整块摘出树、`--press` 报 success 只代表 HID tap 被设备接受。
# 🔴 **不许拿 Android 的读数冒充 iOS**（这条是本脚本存在的全部理由）。
#
# 为什么不并进 `verify-mobile-ios.sh`：那份是**输入侧全链路**（凭据 → 写入 → 跨设备 →
# 自动同步 → 实时入站），跑一趟二十几分钟，而它**不配 AI 端点**。并进那里等于让
# "助手面的六个判据"每次都要先付一次全链路的钱，而且任何一段红都会把 AI 读数一起带走。
# 这里走的是仓库已有的那个形状：`verify-mobile-card-export-ios.sh` —— 一台设备、
# 一个判据族、复用 `lib/mobile-e2e.sh` 的 iOS 通道（`resolve_idb` / `ensure_idb_companion` /
# `idb_ax_label_count`），**不抄第二份载体**。
#
# ── 判据清单（编号即顺序，逐条要设备读数）────────────────────────────────
#   ① 「AI 助手」入口按本机配置**出现/消失成对**：配端点前整行不在树里（同帧邻锚证明
#      不是裁切、不是桥坏），配好之后进树。反向那一半必须有正向对照，否则"读不到"
#      与"没渲染"在输出上长得一模一样。
#   ② 助手屏**五档 chips** 全在（一句话捕获／拆解任务／优先级建议／预估耗时／AI 工具调用）。
#   ③ 「AI 只给建议…」那句**常驻脚注**在屏上（它是唯一对用户承诺"确认前不写"的文案）。
#   ④ 「只用本机」档：闸门拒绝**原文** + 点名它本来要去的端点 + 假端点计数一次没动。
#   ⑤ 非回环目的地：**逐字段披露**（将发往／将发送这些字段／数据会离开设备）与
#      **逐功能授权入口按地址类别出现/消失**（回环那档不索取，非回环那档必须出现）。
#   ⑥ **提案卡出现，且没点确认 ⇒ 本机库一条都不多**。
#   ⑦（Goal-D 那一格）**本机规则命中 ⇒ 零外发**：中文句子在 iOS 上打得进去，
#      判据仍是假端点计数不动 + **同一趟**里正向对照会涨。Android 已按三条输入通道
#      现量证成不可达，这一格就是为换载体而写的。
#
# 🔴 与 Android 那一趟的两条实质差别（不是风格差异）：
#   1. **不需要端口转发**：模拟器与宿主共享网络栈，`127.0.0.1:<port>` 直接就是宿主机。
#      Android 那套 `adb reverse` 在这里没有对应物，也**不该**被抄一份假的"隧道已证"。
#      通道有没有通，由"真发一次之后计数涨了"这一格回答（正向对照），不由探针自证。
#   2. **中文打得进去**：`--type-text` 走 HID 键盘（`verify-mobile-ios.sh` 里那条
#      secure 框唯一实测能进 RN 状态的路），所以 ⑦ 在这一端可达。
#
# 前置（缺任何一条都是 **exit 3 = 环境不成立**，不记产品失败、也不记判据通过）：
#   · 一台**已启动**且装着**当前源码产物**的模拟器，且必须显式指名
#     （`IOS_UDID` 或 `IOS_DEVICE_NAME`）—— 本机常年有别人的模拟器在跑，
#     而这一趟会 `uninstall` + 改屏幕状态（AGENTS §8.9）。
#   · idb + companion 能应答（`bash scripts/install-idb.sh`）。
#   · 宿主机负载与内存闸门（`lib/wait-for-quiet-host.sh`）。
#   · 假端点端口上坐着的是**本轮自己起的那一枚**（借别人的桩 = 读数不属于本轮）。
#
# 用法：
#   IOS_DEVICE_NAME=heyta-iphone-17pro bash scripts/verify-mobile-ios-ai.sh
#
# 退出码：0 = 判据全过；1 = 有断言失败（产品或判据问题）；3 = 环境不成立。三个不混。

set -u
export PATH="/opt/homebrew/bin:$PATH"

. "$(dirname "$0")/lib/mobile-e2e.sh"
. "$(dirname "$0")/lib/wait-for-quiet-host.sh"
. "$(dirname "$0")/lib/card-export-probe.sh"

# 🔴 收尾：假端点是本脚本自己 spawn 的，必须自己关掉 —— Android 那一趟第 14 步的教训
#   （rig39 现量：上一轮泄漏的桩坐在端口上，本轮借用它照常跑，读数全是别人的）。
cleanup_stub() {
  local sp=""
  [ -n "${STUB_PIDFILE:-}" ] && [ -f "$STUB_PIDFILE" ] || return 0
  sp=$(head -1 "$STUB_PIDFILE" | tr -dc '0-9')
  if [ -n "$sp" ] && ps -o args= -p "$sp" 2>/dev/null | grep -q "e2e/stub-provider.mjs"; then
    kill "$sp" >/dev/null 2>&1 || true
    echo "   · 收尾：关掉本轮起的假端点 pid=${sp}（只关这一枚）" >&2
  fi
  rm -f "$STUB_PIDFILE"
}
trap cleanup_stub EXIT

# ── 旋钮 ────────────────────────────────────────────────────────────────
UDID=${IOS_UDID:-}
DEVICE_NAME=${IOS_DEVICE_NAME:-}
BID=${IOS_BID:-com.heyta}
IS_AX_SHIM="$HEYTA_REPO_ROOT/scripts/tools/ios-ax-shim.py"
IOS_DERIVED="${HEYTA_IOS_DERIVED:-/tmp/heyta-ios-release}"
IOS_APP_DIR="$IOS_DERIVED/Build/Products/Release-iphonesimulator/Heyta.app"
EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"
RUN_STARTED=$(date +%s)
STAMP=$(date +%H%M%S)

STUB_PORT="${HEYTA_IOS_AI_STUB_PORT:-4399}"
STUB_HOST_URL="http://127.0.0.1:${STUB_PORT}"
# 模拟器与宿主共享网络栈 ⇒ 设备看到的就是宿主机那个端口，没有 reverse 这一档。
DEVICE_LOOPBACK_URL="http://127.0.0.1:${STUB_PORT}/v1"
# RFC 5737 TEST-NET-1：永不路由。存得进配置（https），但永远连不上 —— ⑤ 要的就是"点名目的地"。
DEVICE_REMOTE_URL="https://192.0.2.1/v1"
STUB_LOG="/tmp/heyta-ios-ai-stub.$$.log"
STUB_PIDFILE="/tmp/heyta-ios-ai-stub.$$.pid"
IDB_BIN=${IDB_BIN:-}
IDB_COMPANION=${IDB_COMPANION:-}

# 🔴 端点名一律 ASCII：它们会变成界面上的 chip 与行标题，但**不是词条** ——
#   混进 needle 集合会被 `check:verify-script-copy` 报成"缺失词条"（假缺陷）。
EP_LOOPBACK="stub-loopback"
EP_REMOTE="stub-remote"

# ── 探针助手（全部按 testID 定位；断言文案才用中文）─────────────────────
ax() {
  python3 "$IS_AX_SHIM" "$@" \
    --udid "$UDID" --idb "$IDB_BIN" --companion "$IDB_COMPANION" --json
}
jget() { printf '%s' "$1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$2',''))" 2>/dev/null; }

found_id() {  # <testID> → 0 = 在树里
  [ "$(jget "$(ax "id:$1" --list --json)" found)" = "True" ]
}
absent_id() {  # <testID> → 0 = 不在树里（🔴 调用方必须先出示同帧的正向对照，否则这句话没有内容）
  [ "$(jget "$(ax "id:$1" --list --json)" found)" != "True" ]
}
found_label() {  # <标签>（子串语义：shim 先精确后退化）
  [ "$(jget "$(ax "$1" --list --json)" found)" = "True" ]
}
wait_id() {  # <testID> [秒]
  local _i
  for _i in $(seq 1 "${2:-12}"); do
    found_id "$1" && return 0
    sleep 1
  done
  return 1
}
# 🔴 「按过了」不等于「按到了」：shim 的文件头记着 tap 对屏外坐标是**静默空操作**。
#   所以每次按压都先滚进可见区，滚不进去就把失败返回给调用方，由它 bad()。
press_id() {  # <testID>
  local v
  v=$(ax "id:$1" --pressable --scroll-into-view --json)
  [ "$(jget "$v" visible)" = "True" ] || {
    echo "   · id:$1 滚不进可见区（found=$(jget "$v" found) scrollRc=$(jget "$v" scrollRc) detail=$(jget "$v" detail)）" >&2
    return 1
  }
  ax "id:$1" --pressable --press --json >/dev/null 2>&1
}
press_label() {  # <标签>
  local v
  v=$(ax "$1" --pressable --scroll-into-view --json)
  [ "$(jget "$v" visible)" = "True" ] || {
    echo "   · 「$1」滚不进可见区（found=$(jget "$v" found) scrollRc=$(jget "$v" scrollRc)）" >&2
    return 1
  }
  ax "$1" --pressable --press --json >/dev/null 2>&1
}
# 一枚**块内**的 chip：五档功能块里各有一枚同名端点 chip（端点标签），
# 只按标签会打到第一次出现的那一枚 ⇒ `--within` 按锚点矩形收窄（与 Android 的
# `xy_in_rid` 同一个语义，两端共用一份锚点词表对账）。
press_in_id() {  # <块 testID> <标签>
  local v
  v=$(ax "$2" --pressable --within "id:$1" --scroll-into-view --json)
  case "$(jget "$v" detail)" in
    within-anchor-missing*|within-anchor-zero-frame*)
      echo "   · 块锚点 $1 取不到（$(jget "$v" detail)）⇒ 这一条判据没有输入，是探针够不着" >&2
      return 2 ;;
  esac
  [ "$(jget "$v" visible)" = "True" ] || {
    echo "   · $1 里的「$2」滚不进可见区（found=$(jget "$v" found) scrollRc=$(jget "$v" scrollRc)）" >&2
    return 1
  }
  ax "$2" --pressable --within "id:$1" --press --json >/dev/null 2>&1
}
# 输入框：先收键盘（键盘弹着时被它盖住的元素**整块从树上消失**，实测），再滚进可见区，
# 再写；判"写进去没有"的是**回读**，不是 rc（`verify-mobile-ios.sh` 第 6 轮那条纪律）。
set_id() {  # <testID> <值>
  local id="$1" val="$2" attempt=1 out back
  while [ "$attempt" -le 4 ]; do
    ax --dismiss-keyboard --json >/dev/null 2>&1
    out=$(ax "id:$id" --role AXTextField --scroll-into-view --json)
    [ "$(jget "$out" visible)" = "True" ] && break
    out=$(ax "id:$id" --scroll-into-view --json)
    [ "$(jget "$out" visible)" = "True" ] && break
    attempt=$((attempt + 1))
    sleep 1.2
  done
  if [ "$(jget "$out" visible)" != "True" ]; then
    bad "输入框 id:$id 经 ${attempt} 次定位仍不可达 —— 页面状态不对，不是\"已经填过\""
    return 1
  fi
  attempt=0
  while [ "$attempt" -lt 4 ]; do
    attempt=$((attempt + 1))
    out=$(ax "id:$id" --set "$val" --json)
    back=$(jget "$out" detail)
    [ "$back" = "$val" ] && break
    sleep 0.8
  done
  if [ "$back" = "$val" ]; then
    return 0
  fi
  bad "写 id:$id 四次都没回读出「$val」（最后回读：${back:-空}，setRc=$(jget "$out" setRc)）"
  return 1
}
# 中文只能走 HID 键盘（`set-value` 对 RN 的 onChangeText 不可信，实测过两次）。
type_id() {  # <testID> <值>
  local out
  ax --dismiss-keyboard --json >/dev/null 2>&1
  out=$(ax "id:$1" --type-text "$2" --json)
  if [ "$(jget "$out" typedRc)" != "0" ]; then
    bad "中文送不进 id:$1（typedRc=$(jget "$out" typedRc)）—— 这一格在 Android 上就是死在这里"
    return 1
  fi
  return 0
}
enabled_id() {  # <testID> → 0 = enabled=True
  [ "$(jget "$(ax "id:$1" --list --json)" enabled)" = "True" ]
}

# ── 假端点：确定性、只绑回环、可数请求 ──────────────────────────────────
stub_count() {
  local raw
  raw=$(curl -s --noproxy '*' -m 5 "${STUB_HOST_URL}/__requests")
  printf '%s' "$raw" | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin)["count"])
except Exception:
    print("READ-FAIL")' 2>/dev/null
}
stub_reset() { curl -s --noproxy '*' -m 5 "${STUB_HOST_URL}/__reset" >/dev/null; }

# ── 设备库回读（"存进去没有"只能由被写那一侧回答）───────────────────────
DATA_DIR=""
prefs_db() {
  [ -n "$DATA_DIR" ] || DATA_DIR=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null | tr -d '\r')
  find "$DATA_DIR" -maxdepth 3 -name 'heyta-device-prefs.sqlite' 2>/dev/null | head -1
}
# → 每档一行 "feature=绑定数/同意数"；读不到打印 NOFILE / BAD:*（**不按 0 处理**）
routes_reading() {
  local db
  db=$(prefs_db)
  if [ -z "$db" ] || [ ! -s "$db" ]; then printf 'NOFILE'; return 1; fi
  HEYTA_DB="$db" python3 - <<'PYR'
import json, os, sqlite3, sys
try:
    con = sqlite3.connect(f"file:{os.environ['HEYTA_DB']}?mode=ro", uri=True)
    row = con.execute("SELECT value FROM device_pref WHERE key='heyta.ai.settings'").fetchone()
except sqlite3.Error as e:
    print(f"BAD:{type(e).__name__}"); sys.exit(0)
if not row:
    print("BAD:no-row"); sys.exit(0)
try:
    v = json.loads(row[0])
except json.JSONDecodeError:
    print("BAD:json"); sys.exit(0)
routing = v.get("routing") or {}
routes = routing.get("routes") or {}
consents = v.get("consents") or []
granted = {c.get("feature") for c in consents if isinstance(c, dict) and c.get("granted") is not False}
for f in ["capture", "breakdown", "prioritize", "duration-estimate", "tool-calling"]:
    print(f"{f}={len(routes.get(f) or [])}/{1 if f in granted else 0}", end=" ")
print()
PYR
}
endpoint_count() {  # → 库里的端点条数（整数）；读不到打印 NOFILE/BAD:*
  local db
  db=$(prefs_db)
  if [ -z "$db" ] || [ ! -s "$db" ]; then printf 'NOFILE'; return 1; fi
  HEYTA_DB="$db" python3 - <<'PYE'
import json, os, sqlite3
try:
    con = sqlite3.connect(f"file:{os.environ['HEYTA_DB']}?mode=ro", uri=True)
    row = con.execute("SELECT value FROM device_pref WHERE key='heyta.ai.settings'").fetchone()
    v = json.loads(row[0]) if row else {}
    print(len(v.get("endpoints") or []))
except Exception as e:
    print(f"BAD:{type(e).__name__}")
PYE
}
ops_count() {  # → op-log 里的 op 条数（整数）；读不到打印 NOFILE/BAD:*
  local db
  db=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null | tr -d '\r')
  db="$db/Library/heyta.sqlite"
  if [ ! -s "$db" ]; then printf 'NOFILE'; return 1; fi
  sqlite3 "$db" "SELECT COUNT(*) FROM ops;" 2>&1 | head -1
}

# ── 截图取证（AGENTS §6.2 规定一：先截图再断言，图必须属于本轮）──────────
SHOTS=""           # 每枚 "文件名|锚点" —— 锚点 = 那一刻在树里的那个 testID
shot() {  # <文件名> <那一刻必须在树里的锚点 testID>
  local name="$1" anchor="$2" png
  png="$EVIDENCE/$name"
  rm -f "$png" 2>/dev/null
  if ! xcrun simctl io "$UDID" screenshot "$png" >/dev/null 2>&1; then
    bad "$name 截图失败（simctl io 非零）—— 不沿用旧图"
    return 1
  fi
  SHOTS="${SHOTS}${name}|${anchor}
"
  echo "   • 截图 $name（那一刻 $anchor 在树里）"
}

step "0. 现场门：设备显式指名、已启动、没有别的 iOS 验收、宿主机负载"
if [ -z "$UDID" ]; then
  if [ -z "$DEVICE_NAME" ]; then
    echo "❌ 没给 IOS_UDID 也没给 IOS_DEVICE_NAME —— 本机常年有别人的模拟器在跑，"
    echo "   而这一趟会 uninstall 应用并改屏幕状态 ⇒ **不猜**（AGENTS §8.9）。"
    xcrun simctl list devices booted 2>/dev/null | sed 's/^/     /'
    exit 3
  fi
  UDID=$(xcrun simctl list devices booted 2>/dev/null | grep -F "$DEVICE_NAME" \
    | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/' | head -1)
  [ -n "$UDID" ] || { echo "❌ 没有**已启动**且名字含「${DEVICE_NAME}」的模拟器 ⇒ 本轮无效（不是产品失败）"; exit 3; }
fi
xcrun simctl list devices booted 2>/dev/null | grep -qF "$UDID" \
  || { echo "❌ $UDID 不在 Booted 列表里 ⇒ 先 xcrun simctl boot $UDID"; exit 3; }
ok "设备已指名且已启动：$UDID"

IOSBUSY=$(ps -eo pid,etime,command | grep -E 'xcodebuild|verify-mobile-ios|simctl (install|uninstall|erase)|reinstall-all\.sh --only ios' \
  | grep -vE "verify-mobile-ios-ai|grep -E" | cut -c1-90)
if [ -n "$IOSBUSY" ]; then
  echo "❌ 这一档有别人在写 ⇒ 不硬挤（§8.9）：$(printf '%s' "$IOSBUSY" | head -2 | tr '\n' ';')"
  exit 3
fi
ok "没有别的 iOS 验收 / 构建在跑"

if ! resolve_idb; then echo "❌ 找不到 idb —— iOS 验收要从设备内部驱动界面（bash scripts/install-idb.sh）"; exit 3; fi
IDB_UDID="$UDID"
# 🔴 `IDB_COMPANION` 是 `--companion`（HOST:PORT）的环境变量形式，**不是** `--companion-path`
#    （二进制路径）。喂串了的报错是"连不上 companion"，会把排查全带到工具链上去。
IDB_COMPANION_BIN="$IDB_COMPANION"
ensure_idb_companion || { echo "❌ idb companion 起不来 ⇒ 探针没有驱动通道"; exit 3; }
[ -f "$IS_AX_SHIM" ] || { echo "❌ AX shim 不在 $IS_AX_SHIM ⇒ 探针没有驱动通道"; exit 3; }
wait_for_quiet_host || exit 3

step "0b. 产物新鲜度：装上的 app 不许比源码旧（§6.1.1、§7 #27/#82）"
INSTALLED_APP=$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null | tr -d '\r')
if [ -z "$INSTALLED_APP" ] || [ ! -d "$INSTALLED_APP" ]; then
  echo "❌ 按 BID=$BID 在这台上解析不到已安装的 app ⇒ 没装上，或装的是别的 bundle id"; exit 3
fi
# 全新安装要有可装的源：优先构建目录，否则把**已装的那一份**快照出来
# （快照的是同一批字节，新鲜度由下面那道门判 —— 不是"拿旧包继续跑"）。
if [ -d "$IOS_APP_DIR" ]; then
  APP_SRC="$IOS_APP_DIR"
else
  APP_SRC="/tmp/heyta-ios-ai-app.$$"
  rm -rf "$APP_SRC"
  cp -R "$INSTALLED_APP" "$APP_SRC" || { echo "❌ 快照已装产物失败 ⇒ 本轮无法做全新安装"; exit 3; }
  echo "   · 构建目录不在 $IOS_APP_DIR ⇒ 用已装产物的快照做全新安装（同一批字节，sha 见下）"
fi
JSB="$APP_SRC/main.jsbundle"
[ -f "$JSB" ] || { echo "❌ $JSB 不在（装了个没有 bundle 的东西？）⇒ 本轮无效"; exit 3; }
newest_src() {
  find "$HEYTA_REPO_ROOT/apps/mobile/src" "$HEYTA_REPO_ROOT/packages"/*/src \
    -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null \
    | xargs -0 stat -f '%m' 2>/dev/null | sort -rn | head -1
}
JSB_M=$(stat -f %m "$JSB"); SRC_M=$(newest_src)
[ -n "$SRC_M" ] || { echo "❌ 新鲜度门没有输入（源码目录扫不到 .ts/.tsx？）⇒ 本轮无效"; exit 3; }
echo "   新鲜度门输入：bundle ${JSB_M}（$(date -r "$JSB_M" '+%m-%d %H:%M:%S')）／源码最新 $SRC_M"
if [ "$SRC_M" -gt "$JSB_M" ]; then
  echo "   ❌ 装的是旧产物：源码最新 $SRC_M > bundle $JSB_M"
  echo "      先 pnpm reinstall:mobile（或 --only ios）。**不许**为了跑绿而绕这道门 —— 那等于把"
  echo "      \"验的是旧代码\"写进取证（§7 第 27 条）。"
  exit 3
fi
ok "装的是当前源码的产物"

step "0c. 假端点：确定性、只绑回环、可数请求"
rm -f "$STUB_PIDFILE"
STUB_PORT="$STUB_PORT" nohup "$NODE" "$HEYTA_REPO_ROOT/e2e/stub-provider.mjs" >"$STUB_LOG" 2>&1 &
STUB_PID=$!
echo "$STUB_PID" > "$STUB_PIDFILE"
STUB_READY=0
for _i in $(seq 1 20); do
  if curl -s --noproxy '*' -m 2 "${STUB_HOST_URL}/__requests" | grep -q '"count"'; then STUB_READY=1; break; fi
  sleep 1
done
[ "$STUB_READY" = 1 ] || { echo "   ❌ 假端点 20 秒内没起来（日志 tail：）"; tail -5 "$STUB_LOG"; exit 3; }
STUB_OWNER=$(lsof -nP -tiTCP:"${STUB_PORT}" -sTCP:LISTEN 2>/dev/null | tr -d '\r' | head -1)
if [ "${STUB_OWNER:-无}" != "$STUB_PID" ]; then
  echo "   ❌ ${STUB_PORT} 上的监听者不是本轮起的假端点（owner=${STUB_OWNER:-无}，本轮 pid=${STUB_PID}）"
  echo "      借用别人的桩 ⇒ 计数不属于本轮。不硬跑。"
  tail -3 "$STUB_LOG" 2>/dev/null
  summary "iOS 助手真机验收" "假端点端口坐着上一轮遗留的进程 —— 环境不成立" 3
fi
C0=$(stub_count)
case "$C0" in (''|*[!0-9]*) echo "   ❌ 假端点计数读不出（${C0:-空}）⇒ 这一族判据没有输入"; exit 3 ;; esac
ok "假端点在 ${STUB_HOST_URL}（当前计数 ${C0}，绑定仍是 127.0.0.1）"

step "1. 全新安装 + 隐私门（先选「只用本机」）"
xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
xcrun simctl uninstall "$UDID" "$BID" >/dev/null 2>&1 || true
xcrun simctl install "$UDID" "$APP_SRC" >/dev/null 2>&1 \
  || { echo "❌ simctl install 失败：$APP_SRC ⇒ 本轮无效"; exit 3; }
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1 || { echo "❌ simctl launch 失败 ⇒ 本轮无效"; exit 3; }
sleep 6
# 🔴 树就绪的判据是"label 数 ≥ 2 且三个候选屏之一在树里"，**不是**"某个标签在不在"：
#    RN 的 modal 会把底部标签栏整块摘出树（实测），拿标签当条件会把"面板立着"读成"桥坏了"。
CONSENT_TITLE=$(zh common.privacy.consent.title)
WELCOME=$(zh mobile.welcome.offline)
TAB_ME=$(zh mobile.tab.profile)
TREE_N=0
for _i in 1 2 3 4 5 6 7 8; do
  TREE_N=$(idb_ax_label_count)
  if [ "${TREE_N:-0}" -ge 2 ] \
    && { found_label "$CONSENT_TITLE" || found_label "$WELCOME" || found_id "profile-entry-settings"; }; then
    break
  fi
  sleep 3
done
[ "${TREE_N:-0}" -ge 2 ] || { echo "❌ AX 树读不到 App 内容（label 数 ${TREE_N:-?}）⇒ 探针未到位，本轮无效"; exit 3; }
ok "无障碍树能读到 App 内容（label 数 ${TREE_N}）"
if found_label "$CONSENT_TITLE"; then
  press_label "$(zh common.privacy.consent.localOnly)" || true
  sleep 3
  found_label "$CONSENT_TITLE" && { echo "❌ 隐私面板没被收掉 ⇒ 后面每一步的屏都不成立"; exit 3; }
fi
if found_label "$WELCOME"; then
  press_label "$(zh mobile.welcome.offline)" || true
  sleep 3
fi
ok "已离开首启面板，进入主屏"

step "2. 判据①（反向那一半）：配端点之前「AI 助手」入口整行不在树里"
# 切到「我的」：底部标签不在 shim 的"可见"定义里（它给滚动区让位），走直接按压。
press_label "$TAB_ME" || true
sleep 3
# 🔴 反向判据必须有**同帧**的正向对照，否则"读不到"与"没渲染"在输出上长得一模一样。
#   这里同时当两件事用：① 桥与 `AXUniqueId` 通道是通的（整棵树没有一枚 AXUniqueId 时
#   `id:` 前缀会恒取空，那条反向判据就变成装饰）；② 页面确实停在「我的」。
NEIGH=""
for n in profile-entry-settings profile-entry-habits profile-entry-trash; do
  found_id "$n" && NEIGH="$NEIGH $n"
done
if [ -z "$NEIGH" ]; then
  echo "   ❌ 同帧一枚邻锚都没取到（$NEIGH 空）⇒ 这一条反向判据没有输入：不是\"入口没渲染\"，是探针没落到这一页"
  bad "判据①的反向那一半无从判定（桥 / 页面 / AXUniqueId 通道三者之一不成立）"
  summary "iOS 助手真机验收"
fi
ok "邻锚同帧成立：$NEIGH —— 它们之间那一格的缺席才是\"没渲染\""
if absent_id "profile-entry-assistant"; then
  ok "未配置时「AI 助手」入口整行不在 AX 树里（同帧邻锚已证：不是通道没读到）"
else
  bad "未配置端点时「AI 助手」入口就已经在树里 —— aiEntryVisible 的反向那一半不成立"
fi

step "3. 开总开关 + 配一枚回环假端点（仍处「只用本机」）"
press_id "profile-entry-settings" || { bad "进不去设置面"; summary "iOS 助手真机验收"; }
wait_id "ai-settings-section" 15 \
  || { bad "设置面里没有 ai-settings-section（AI 段整块没渲染？）"; summary "iOS 助手真机验收"; }
ok "设置面里的 AI 段在树里（ai-settings-section）"
press_id "ai-gate-enabled" || bad "开不了「启用 AI 功能」"
sleep 2
# 🔴 开关的效果**不看开关自己**（RN 的 Switch 在 AX 上的取值这一端没验过），
#   看它应当带出来的那一格：配好端点之后入口进树（第 4 步）。这里只确认按钮点得住。
# 🔴 表单是**常驻**的（`AiSettingsSection.tsx:345` 起三个 TextField 直接渲染，
#   `ai-endpoint-add` 就是提交钮且 `disabled=url 空`）⇒ 不许"先点开表单"。
set_id "ai-endpoint-label" "$EP_LOOPBACK" || summary "iOS 助手真机验收"
set_id "ai-endpoint-url" "$DEVICE_LOOPBACK_URL" || summary "iOS 助手真机验收"
set_id "ai-endpoint-model" "stub-model" || summary "iOS 助手真机验收"
# 能力要**声明**：不勾 tool_calling，工具调用那一档永远选不到端点（rig41 定源过）。
for cap in structured_output long_context tool_calling; do
  press_id "ai-endpoint-cap-$cap" || bad "勾不上能力 chip ai-endpoint-cap-$cap"
done
ax --dismiss-keyboard --json >/dev/null 2>&1
press_id "ai-endpoint-add" || { bad "端点表单的保存点不下去"; summary "iOS 助手真机验收"; }
sleep 2
EP_N=$(endpoint_count)
case "$EP_N" in
  1) ok "回环假端点已落进设备库（端点条数 = 1，读的是被写那一侧）" ;;
  NOFILE|BAD*) bad "设备库回读没拿到（$EP_N）⇒ \"存进去没有\"无从判定，不拿\"点过了\"当已通过" ;;
  *) bad "端点条数读成 $EP_N（期望恰好 1）" ;;
esac

step "4. 判据①（正向那一半）：配好端点后入口进树 —— 与第 2 步的缺席成对"
press_label "$TAB_ME" || true
sleep 3
if wait_id "profile-entry-assistant" 12; then
  ok "「AI 助手」这一格进了树（同一枚锚点：第 2 步不在、这一步在 ⇒ 成对成立）"
else
  bad "配好端点后「AI 助手」入口仍不在树里 —— 与第 2 步的对照断掉（aiEntryVisible 没跟着配置变）"
  summary "iOS 助手真机验收"
fi
press_id "profile-entry-assistant" || { bad "点不进助手屏"; summary "iOS 助手真机验收"; }
wait_id "assistant-screen" 12 || { bad "助手屏没起来（assistant-screen 不在树里）"; summary "iOS 助手真机验收"; }
shot "ios-ai-1-assistant.png" "assistant-screen"

step "5. 判据②③：五档 chips 与「只给建议」常驻脚注"
MISS=""
for f in capture breakdown prioritize duration-estimate tool-calling; do
  case "$f" in
    duration-estimate) key='web.ai.feature.duration' ;;
    tool-calling) key='web.ai.feature.toolCalling' ;;
    *) key="web.ai.feature.$f" ;;
  esac
  lbl=$(zh "$key")
  if found_label "$lbl"; then
    echo "   · 一档 chip「$lbl」在树里"
  else
    MISS="$MISS $lbl"
  fi
done
if [ -n "$MISS" ]; then
  bad "这几档 chips 不在树里：$MISS"
else
  ok "助手屏五档 chips 全在（check:ai-coverage 在 iOS 设备上的对应物）"
fi
FOOT=$(zh mobile.ai.proposalNeverAuto)
if found_label "$FOOT"; then
  ok "「只给建议」那句常驻脚注在屏上（它是唯一对用户承诺「确认前不写」的文案）"
else
  bad "常驻脚注不在屏上（那句承诺消失了，而它是这套体系的免责基础）"
fi

step "6. 五档路由绑到回环端点（块内那一指落在哪一层由 --within 判）"
for f in capture breakdown prioritize duration-estimate tool-calling; do
  press_in_id "ai-feature-$f" "$EP_LOOPBACK"
  case $? in
    0) : ;;
    2) bad "块 $f 的锚点取不到 ⇒ 绑定这一格没有输入"; ;;
    *) bad "$f 里的端点 chip 点不到";;
  esac
done
RR=$(routes_reading)
case "$RR" in
  NOFILE|BAD*) bad "库回读没拿到（$RR）—— 绑定到底写进去没有，不许拿\"点了\"当已通过" ;;
  *)
    echo "   · 设备库回读（routes/同意，键 heyta.ai.settings）：$RR"
    MISS2=""
    for line in $RR; do
      n=${line#*=}; n=${n%%/*}
      case "$n" in (''|*[!0-9]) MISS2="$MISS2 $line(读不出)" ;; *) [ "$n" -ge 1 ] || MISS2="$MISS2 $line" ;; esac
    done
    if [ -n "$MISS2" ]; then
      bad "库里这些档仍然没绑上端点：$MISS2"
    else
      ok "五档在库里各有 ≥1 枚端点（读的是被写那一侧，不是手指）"
    fi
    ;;
esac
# 🔴 期望值由**这一趟真的配了哪个端点**推：回环字面量 ⇒ requiresEgressConsent=false
#   ⇒ `ai-consent-<feature>` 按设计不渲染。拿"应该出现"去逐档 reveal 会白花五次滚动
#   并打出五条读起来像"载体坏了"的红（rig28~34 那条恒不成立的判据）。
CONSENT_HIT=""
for f in capture breakdown prioritize duration-estimate tool-calling; do
  found_id "ai-consent-$f" && CONSENT_HIT="$CONSENT_HIT $f"
done
if [ -n "$CONSENT_HIT" ]; then
  bad "目的地是回环（${DEVICE_LOOPBACK_URL}）却渲染了逐功能授权入口：$CONSENT_HIT —— 在\"内容不会离开本机\"的档位上索取授权"
else
  ok "回环端点下界面不索取逐功能授权（五档逐枚查过）—— 与 destination='none' 同一口径"
fi

step "7. 判据⑦（Goal-D 那一格）：本机规则命中 ⇒ 零外发"
# 切到「AI 工具调用」那一档：规则前门只在这条链路上跑。
press_label "$(zh web.ai.feature.toolCalling)" || bad "切不到「AI 工具调用」那一档"
sleep 2
set_id "tool-input" "列出我的任务" || summary "iOS 助手真机验收"
RULE_PROMPT="列出我的任务"
stub_reset
BEFORE=$(stub_count)
if enabled_id "tool-start-single"; then
  press_id "tool-start-single" || bad "「运行」点不动"
  sleep 2
  if found_id "ai-tool-send"; then
    press_id "ai-tool-send" || bad "披露步的「发送」点不动"
  else
    bad "按了「运行」之后既没有披露步也没有结果（屏上什么都没有）"
  fi
  sleep 6
  AFTER=$(stub_count)
  if [ "$BEFORE" = "$AFTER" ]; then
    ok "本机规则命中那一趟：假端点计数 ${BEFORE}→${AFTER} 一次没动"
  else
    bad "本机规则该零外发，而假端点计数 ${BEFORE}→${AFTER} 动了 —— 短路没生效"
  fi
  # 🔴 命中之后界面上应当是**答案**，不是那句闸门拒绝。
  if absent_id "ai-tool-failed"; then
    ok "那一趟没落到失败面（没有 privacy-consent-not-granted 那一屏）"
  else
    bad "规则命中却被闸门拦下（失败面在树里）⇒ 规则没有先跑，短路是假的"
  fi
  if found_id "ai-tool-disclosure"; then
    bad "规则命中之后还停在披露步 —— 本机答案没有直接落地"
  else
    ok "规则命中后披露步已收掉（走的是本机执行，不是\"先看一眼再发\"）"
  fi
else
  bad "「运行」按钮是禁用态（输入框没写进去 / 路由没绑上）⇒ 这一格没有读数"
fi

step "8. 判据④：只用本机档 —— 闸门拒绝原文 + 点名端点 + 计数不动"
press_label "$(zh web.ai.feature.capture)" || bad "切不回「一句话捕获」"
sleep 2
set_id "capture-input" "buy milk" || summary "iOS 助手真机验收"
stub_reset
B4=$(stub_count)
press_id "capture-start" || bad "「AI 捕获」点不动"
sleep 2
if found_id "capture-send"; then
  press_id "capture-send" || bad "披露步的「发送」点不动"
fi
sleep 5
AF=$(stub_count)
LEAD=$(zh web.ai.settings.consentLead); LEAD_TAIL="${LEAD##*」}"
if found_label "$LEAD_TAIL"; then
  ok "只用本机档：发送在本机闸门处被拦下，界面给出拒绝原文"
else
  bad "没看到那句拒绝原文（尾部「${LEAD_TAIL}」不在树里）—— 静默失败或静默成功都算这一条红"
fi
if found_label "127.0.0.1"; then
  ok "那句拒绝点名了它本来要去哪个端点（含 127.0.0.1 的 URL）⇒ 下面那条「计数没动」不是压根没走传输边界"
else
  bad "拒绝没有点名端点（界面上读不到 127.0.0.1）—— 用户无从知道被拦下的是哪一发"
fi
if [ "$B4" = "$AF" ]; then
  ok "假端点计数 ${B4}→${AF} 一次没动（只用本机档：任何一次 AI 发送都不会打到端点）"
else
  bad "「只用本机」档下假端点计数动了（${B4}→${AF}）—— 这是隐私边界的红线，不是措辞问题"
fi
if found_label "$(zh web.ai.action.retry)"; then
  ok "失败面给出「重试」—— 不确定态可重试，不是把用户钉死在一屏"
  # 截图挂在**判据成立之后**：锚点没成立就拍一张，等于给一张不知道对应哪条判据的图。
  shot "ios-ai-2-local-only-blocked.png" "capture-failed"
else
  bad "失败面没有「重试」出口"
fi

step "9. 判据⑤：非回环目的地 ⇒ 授权入口出现、逐字段披露点名"
# 先开「允许远程端点」，再存一枚 https 的非回环端点，然后把「拆解任务」那档指过去。
press_label "$TAB_ME" || true
sleep 3
press_id "profile-entry-settings" || { bad "进不去设置面"; summary "iOS 助手真机验收"; }
wait_id "ai-settings-section" 12 || { bad "设置面的 AI 段没在树里"; summary "iOS 助手真机验收"; }
press_id "ai-gate-remote" || bad "开不了「允许远程端点」"
sleep 1
set_id "ai-endpoint-label" "$EP_REMOTE" || summary "iOS 助手真机验收"
set_id "ai-endpoint-url" "$DEVICE_REMOTE_URL" || summary "iOS 助手真机验收"
set_id "ai-endpoint-model" "stub-model" || summary "iOS 助手真机验收"
ax --dismiss-keyboard --json >/dev/null 2>&1
press_id "ai-endpoint-add" || bad "远程端点存不下去"
sleep 2
EP_N2=$(endpoint_count)
if [ "$EP_N2" = "2" ]; then
  ok "非回环 https 端点已落进设备库（端点条数 1→2）"
else
  bad "端点条数读成 $EP_N2（期望 2）—— 新增那枚没存进去，后面的判据都没有输入"
  summary "iOS 助手真机验收"
fi
press_in_id "ai-feature-breakdown" "$EP_REMOTE" || bad "把「拆解任务」指向远程端点这一指没落地"
sleep 1
if found_id "ai-consent-breakdown"; then
  ok "路由指向非回环地址时，「拆解任务」这一档出现逐功能授权入口（ai-consent-breakdown 在树里）"
else
  bad "非回环目的地却没有授权入口 —— 这一档永远无法被点亮，那是产品的洞"
fi
if found_id "ai-consent-capture"; then
  bad "对照失败：目的地是回环的「一句话捕获」那一档也在索取授权"
else
  ok "对照成立：目的地是回环的那一档**没有**索取授权（挡的是「授权面永远显示」）"
fi
# 未授权时披露步就该索取批准，而**此刻一发都不该出去**（这一条与第 7 步共用同一枚计数尺）。
press_label "$TAB_ME" || true
sleep 2
press_id "profile-entry-assistant" || { bad "点不进助手屏"; summary "iOS 助手真机验收"; }
press_label "$(zh web.ai.feature.breakdown)" || bad "切不到「拆解任务」"
sleep 2
stub_reset
B4=$(stub_count)
if enabled_id "breakdown-start"; then
  press_id "breakdown-start" || bad "「拆解」点不动"
  sleep 2
  if found_id "ai-disclosure"; then
    DEST=$(zh web.ai.disclosure.destinationLead)
    FLD=$(zh web.ai.disclosure.fieldsLead)
    REM=$(zh web.ai.disclosure.remote)
    MISSD=""
    found_label "$DEST" || MISSD="$MISSD 目的地行"
    found_label "$FLD" || MISSD="$MISSD 字段清单"
    found_label "$REM" || MISSD="$MISSD 性质行「数据会离开设备」"
    if [ -n "$MISSD" ]; then
      bad "披露步缺这些元素：$MISSD（逐字段披露是红线，不是形容词）"
    else
      ok "披露步元素齐：目的地行 + 字段清单 + 性质行"
    fi
    if found_label "192.0.2.1"; then
      ok "目的地那行点名的是那条非回环地址（192.0.2.1），不是悄悄换成别的"
    else
      bad "披露没点名端点地址 ⇒ 用户看不出这一发要去哪"
    fi
    shot "ios-ai-3-disclosure.png" "ai-disclosure"
    press_id "ai-send" || bad "披露步的「发送」点不动"
    sleep 6
    AF=$(stub_count)
    if [ "$B4" = "$AF" ]; then
      ok "未授权时点发送仍然零外发（计数 ${B4}→${AF}），界面给的是 egressNotAuthorized 那一族"
    else
      bad "没给逐功能授权就发出去了（计数 ${B4}→${AF}）—— 授权面形同虚设"
    fi
  else
    bad "按了「拆解」之后没有披露步（ai-disclosure 不在树里）⇒ 判据⑤没有输入"
  fi
else
  bad "「拆解」按钮是禁用态（路由没绑上 / 输入没写进去）⇒ 判据⑤没有读数"
fi
# 逐功能授权点下去（下一步换回回环时它不影响，但这一档"点得动"本身就是判据的一部分）
press_id "ai-consent-breakdown" || bad "非回环那档的授权入口点不动"
sleep 1

step "10. 判据⑥：提案卡出现，且没点确认 ⇒ 本机库一条都不多（同趟带正向对照）"
# 把「拆解任务」换回**回环**假端点：这一发该真打出去，而假端点返回确定内容 ⇒ 提案卡出得来。
# 🔴 这一趟同时是第 7/9 步那句「计数没动」的**分母**：同一次运行里计数会 +1，
#   说明那两条 0→0 不是"压根没人数"（traps #335 那一族：否定判据必须出示分母）。
press_label "$TAB_ME" || true
sleep 2
press_id "profile-entry-settings" || { bad "进不去设置面"; summary "iOS 助手真机验收"; }
wait_id "ai-settings-section" 12 || { bad "设置面的 AI 段没在树里"; summary "iOS 助手真机验收"; }
press_in_id "ai-feature-breakdown" "$EP_LOOPBACK" || bad "把「拆解任务」换回回环这一指没落地"
sleep 1
if found_id "ai-consent-breakdown"; then
  bad "路由换回回环后那一档的授权入口还在 —— 与第 9 步的「出现」配不成对"
else
  ok "路由换回回环后，那一档的授权入口**消失**（成对的另一半）"
fi
press_label "$TAB_ME" || true
sleep 2
press_id "profile-entry-assistant" || { bad "点不进助手屏"; summary "iOS 助手真机验收"; }
press_label "$(zh web.ai.feature.breakdown)" || bad "切不到「拆解任务」"
sleep 2
BASE=$(ops_count)
case "$BASE" in (''|*[!0-9]*) bad "op-log 基线读不出（$BASE）⇒ \"不写库\"这一条没有输入"; summary "iOS 助手真机验收" ;; esac
stub_reset
B5=$(stub_count)
press_id "breakdown-start" || bad "「拆解」点不动"
sleep 2
if found_id "ai-send"; then
  press_id "ai-send" || bad "披露步的「发送」点不动"
fi
PROP=0
for _i in $(seq 1 20); do
  sleep 2
  if found_id "breakdown-apply"; then PROP=1; break; fi
done
AFTER5=$(stub_count)
if [ "$B5" != "$AFTER5" ]; then
  ok "回环这一趟确实打到了假端点（计数 ${B5}→${AFTER5}）—— 下面那条「没点确认不写库」有分母"
else
  bad "回环这一趟没打到假端点（计数 ${B5}→${AFTER5}）⇒ 提案卡无从谈起，而第 7/9 步那两条 0→0 也失去了分母"
fi
if [ "$PROP" = 1 ]; then
  ok "提案卡出来（breakdown-apply 在树里）"
  shot "ios-ai-4-proposal.png" "breakdown-apply"
  AFTER=$(ops_count)
  if [ "$BASE" = "$AFTER" ]; then
    ok "只看了提案、没点确认 ⇒ 本机库条数不变（${BASE}→${AFTER}）—— 这是「只产出提案」的 iOS 设备级判据"
  else
    bad "没点确认而库里多了 op（${BASE}→${AFTER}）—— AI 在类型上产不出 op 这条红线破了"
  fi
else
  bad "等 40 秒没有提案卡（breakdown-apply 不在树里）⇒ 判据⑥没有读数"
fi

step "11. 取证对账：截图必须属于本轮"
SHOTS_LIST="/tmp/heyta-ios-ai-shots.$$.list"
printf '%s' "$SHOTS" > "$SHOTS_LIST"
SHOT_N=0
SHOT_BAD=0
if [ ! -s "$SHOTS_LIST" ]; then
  bad "本轮一张图都没拍 ⇒ 取证面为空（不是\"没问题\"）"
else
  # 🔴 循环**不能**挂在管道上：`printf | while` 的 while 在子 shell 里跑，
  #    里面的 bad() 把 FAIL 加在子 shell 上，父进程一条都不知道（traps #344 的第三种面目）。
  while IFS='|' read -r name anchor; do
    [ -n "$name" ] || continue
    png="$EVIDENCE/$name"
    if [ ! -s "$png" ]; then bad "$name 没落盘"; SHOT_BAD=1; continue; fi
    m=$(python3 -c 'import os,sys;print(int(os.path.getmtime(sys.argv[1])))' "$png" 2>/dev/null)
    case "$m" in
      ''|*[!0-9]*) bad "$name 的 mtime 读不出来（${m:-空}）⇒ 是尺坏了不是图旧"; SHOT_BAD=1 ;;
      *) if [ "$m" -lt "$RUN_STARTED" ]; then
           bad "$name 比本轮起跑还旧（mtime $m < 起跑 $RUN_STARTED）—— 它属于上一趟（§7 第 27 条那一族）"
           SHOT_BAD=1
         else SHOT_N=$((SHOT_N + 1)); fi ;;
    esac
    # 那一刻的锚点也要**现在**还判得动：锚点没了 = 这张图对应的屏已经不成立
    found_id "$anchor" || echo "   ↷ 现量：$name 对应的锚点 $anchor 此刻已不在树里（只作读数，不判红）"
  done < "$SHOTS_LIST"
fi
rm -f "$SHOTS_LIST"
if [ "$SHOT_BAD" = 0 ] && [ "$SHOT_N" -gt 0 ]; then
  ok "截图归属本轮：${SHOT_N} 张的 mtime 都落在起跑之后（逐张判，不数总数）"
fi
echo "   ↷ 图在这里，**人要打开看**（AGENTS §6.2 规定一）：$EVIDENCE/ios-ai-*.png"

summary "iOS 助手真机验收"
