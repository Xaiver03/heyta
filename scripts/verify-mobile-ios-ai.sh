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
trap 'rm -f -- "$0"; declare -F cleanup_stub >/dev/null && cleanup_stub' EXIT
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
# ⚠️ 它的 EXIT 挂**不在这里**，在文件头第 18 行那条自快照 trap 里（`declare -F` 现查）。
#   理由不是风格：`lib/mobile-e2e.sh` 的 `heyta_chain_exit` 只能救"rig 的 trap 排在
#   source **之前**"那一半 —— 在 source 之后再写一条裸 `trap … EXIT` 会**整体替换**掉
#   串好的那条（bash 不报错），症状是"该删的自快照没删"。`check:shell-exit-chain` 判的就是它。
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
# 🔴 底部标签**不许**走 scroll-into-view。shim 的"可见"是给滚动区里的元素算的，
#   标签栏不在滚动区里 ⇒ 它回 `visible≠True`、按压被整句跳过、界面停在原地，
#   而下一句读到的"入口不在树里"就被报成"产品没渲染那一格"。
#   rig47b 第 2 步现量：`我的` 用 `--pressable` 找得到（321,776 80×64）、直接 `--press`
#   回 `success`、按下之后 `id:profile-entry-settings` 立刻 found=True ——
#   三件事一起证明那一格从头到尾都在，缺的只是这一次按压。
#   同一条教训在 Android 侧记在 verify-mobile-ios.sh 的底部标签那段头上（#339 那族：
#   同一个缺陷只修一枚 helper 等于没修）。
press_tab() {  # <标签> → 0 = 这次按压真的送进了设备
  local r
  r=$(jget "$(ax "$1" --pressable --press --json)" result)
  [ "$r" = "success" ] || { echo "   · 按底部标签「$1」没落地（result=${r:-空}）" >&2; return 1; }
  return 0
}
# 🔴 **iOS 没有"块内那一指"这一档**：`--within` 要的是块锚点的矩形，而块是容器、
#   iOS 不发容器节点（见上面导航段那条实测），所以 Android 的 `xy_in_rid` 在这一端
#   没有对应物。替代方案不是在探针里发明几何，而是让**chip 自己带身份**：
#   `ai-route-<功能>-<下标>`（kit.tsx 的 Chip 现在把 testID 透到 Pressable 那一层）。
#   下标 = 这一排从左到右的可见次序；端点的随机 id 载体拿不到，所以不用它。
#   shim 的 `--within` 几何臂（门禁 ㉑ 那几臂）原样留着 —— 那是探针自身正确性的证据，
#   不再被本载体调用；哪天 iOS 上真需要块内几何时，从那里接回来。
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
# 🔴 iOS 这一侧中文**只能走 AXSetValue（`set_id`），HID 那条路结构上送不进中文**
#   （rig49 现量：`idb ui text` 走的是 HID 键码表，`text_to_events` 对每个字符查键码，
#    非 ASCII 直接 `Exception: No keycode found for 列` ⇒ 打字这一步恒失败）。
#    HID 只在 **secure 输入框**上才是必需的（`verify-mobile-ios.sh:1298` 那条实测：
#    set-value 对 secure 框 rc=0、AXValue 回读成掩码而 onChangeText 不触发）。
#    普通 TextInput 上中文走 set-value 是被 `verify-mobile-ios.sh` 证过的：
#    它的任务标题就是中文（`TITLE="iOS输入验收…"`），第 1156 行按**逐字**去 ops 表里找那条 op，
#    找不到就 bad —— 也就是"中文进了 RN 状态并写进了 op 载荷"有库级读数，不是界面级印象。
#    写进来的字这里判两层：`set_id` 回读逐字（AX 层）+ 调用方判「运行」按钮的启用态（RN 层）。
enabled_id() {  # <testID> → 0 = enabled=True
  [ "$(jget "$(ax "id:$1" --list --json)" enabled)" = "True" ]
}

# ── 导航（与 Android 那趟同一套形状，只是逐条按 iOS 的通道实现）──────────
# 🔴 iOS 的锚点词表**只有**「带无障碍特性的宿主视图」那一档：普通 `<View testID=…>`
#   容器在 `idb describe-all` 里**根本不发出节点**（rig47c 现量：设置面 137 枚节点、
#   31 枚 `AXUniqueId` 全在 Button/TextField 上，`settings-sheet`/`ai-settings-section`/
#   `ai-feature-*`/`assistant-screen` 一枚都不在）。
#   它们在 Android 上是真节点（resource-id 挂在 ViewGroup 上），所以**同一枚锚名在两端
#   有与没有是两件事** —— 拿 Android 的词表去 iOS 上读，症状与"界面没渲染"逐字相同。
#   ⇒ 本载体的每个锚点都必须落在会被发出的那一层：容器缺席时改用它内部那枚控件
#   （`ai-gate-*` 现在是勾选框本体、`ai-route-<档>-<下标>` 是 chip 本体、
#   `<前缀>retry` 是失败面里那枚按钮），而不是给容器加 `accessible`（那会把子节点
#   并成一个 VoiceOver 元素，伤的是真用户）。
goto_me_page() {  # 只负责按下并留渲染时间；到没到由调用方的锚点判
  press_tab "$TAB_ME" || return 1
  sleep 2
}
leave_assistant() {
  found_id "assistant-back" || return 0   # 没立着 ⇒ 不用收（这一条不报错）
  echo "   · 助手层还立着 ⇒ 走它自己的出口收掉（立着时底部标签不在树里）"
  press_id "assistant-back" || return 1
  sleep 1
  absent_id "assistant-back"
}
leave_settings() {
  # 「设置面开没开」在 iOS 上唯一的读法 = 它内部那枚勾选框在不在（`settings-sheet`
  # 是容器，不发节点）。这句话只对 iOS 成立，不要抄回 Android。
  found_id "ai-gate-enabled" || return 0
  ax --dismiss-keyboard --json >/dev/null 2>&1
  echo "   · 设置面还开着 ⇒ 点它自己的关闭键（关它不丢刚存的端点：提交发生在点「添加」那一刻）"
  press_label "$CLOSE_SETTINGS" || return 1
  sleep 1
  absent_id "ai-gate-enabled"
}
open_ai_settings() {
  leave_assistant || { echo "   ❌ 助手层收不掉：点了 assistant-back 而它自己已从树上消失不了" >&2; return 1; }
  leave_settings || { echo "   ❌ 设置面收不掉 ⇒ 重开等于叠两层" >&2; return 1; }
  goto_me_page || { echo "   ❌ 切不到「我的」那一页" >&2; return 1; }
  press_id "profile-entry-settings" || { echo "   ❌ 点不到「我的 → 设置」那一格（testID=profile-entry-settings）" >&2; return 1; }
  wait_id "ai-gate-enabled" 15 || { echo "   ❌ 设置面里读不到「启用 AI 功能」那枚勾选框（AI 段整块没渲染，或设置面根本没开起来）" >&2; return 1; }
  return 0
}
open_assistant() {
  leave_settings || { echo "   ❌ 设置面收不掉 ⇒ 底部标签不在树里" >&2; return 1; }
  leave_assistant || return 1
  goto_me_page || { echo "   ❌ 切不到「我的」那一页" >&2; return 1; }
  press_id "profile-entry-assistant" || { echo "   ❌ 点不进助手屏" >&2; return 1; }
  wait_id "assistant-back" 12 || { echo "   ❌ 助手屏没起来（它自己的出口按钮不在树里；assistant-screen 是容器，iOS 不发节点，不作为锚点）" >&2; return 1; }
  return 0
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
# 逐工具授权位（`localApi.grants`）。🔴 层与 `endpoint_count` 同一条纪律：grants 住在
# `localApi` 下面，不在顶层；走错层会得到"一个都没授权"，而那与"真没授权"输出上一样。
grants_reading() {  # → "list_tasks=1 create_task=0"；读不到打印 NOFILE/BAD:*
  local db
  db=$(prefs_db)
  if [ -z "$db" ] || [ ! -s "$db" ]; then printf 'NOFILE'; return 1; fi
  HEYTA_DB="$db" python3 - <<'PYG'
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
local = v.get("localApi") or {}
grants = local.get("grants") or {}
for k in ("list_tasks", "create_task"):
    print(f"{k}={1 if grants.get(k) is True else 0}", end=" ")
print()
PYG
}
# 🔴 设备级隐私同意住在**另一个 key**（`privacy.consent`，不是 `heyta.ai.settings`）。
#   这一枚读的是"决定真落盘了没有"，不是"按钮点住了"（§7 第 25 条那一族）。
consent_reading() {  # → accepted / local-only / NOFILE / BAD:*
  local db
  db=$(prefs_db)
  if [ -z "$db" ] || [ ! -s "$db" ]; then printf 'NOFILE'; return 1; fi
  HEYTA_DB="$db" python3 - <<'PYC'
import json, os, sqlite3, sys
try:
    con = sqlite3.connect(f"file:{os.environ['HEYTA_DB']}?mode=ro", uri=True)
    row = con.execute("SELECT value FROM device_pref WHERE key='privacy.consent'").fetchone()
except sqlite3.Error as e:
    print(f"BAD:{type(e).__name__}"); sys.exit(0)
if not row:
    print("BAD:no-row"); sys.exit(0)
try:
    print(json.loads(row[0]).get("decision") or "BAD:no-decision")
except Exception:
    print("BAD:json")
PYC
}
# 把设备的联网决定从「只用本机」改成「同意并联网」——**正向对照的前置**。
# 闸门是绝对的（`apps/mobile/src/privacy/consent-gate.ts`：没有同意一个字节都不出这台设备，
# 回环端点也不例外），所以"计数会涨"这一条在闸门关着时**结构上取不到**。
# rig52 现量：第 10 步那两条红（回环这一趟 0→0、等 40 秒没有提案卡）就是这个 sequencing
# 问题，不是产品问题 —— 而它同时让第 7 步那条"0→0 没动"失去分母（traps #335 那一族）。
# 这一格没有 testID 锚点：`privacy-consent-section` 是裸 `<Stack>`，iOS 不发节点（#348），
# 而「重新选择」那颗按钮是共享 `Button` ⇒ 按可见标签点。
flip_consent_to_network() {
  # 🔴 走既有的 `open_ai_settings`，不许自己拼"点「我的」再点「设置」"：rig54 现量就是这么拼的，
  # 而第 8 步结束时屏幕上立着的是**助手层**（失败面）—— 它立着时底部标签整条不在 AX 树里
  # （#348 那一族的同源事实），于是 `profile-entry-settings` 滚不进可见区
  # （`scrollRc=element-left-tree`），读起来像"合规区块被摘掉了"。
  # `open_ai_settings` 里那两条 `leave_assistant` / `leave_settings` 才是这一格的必要前置。
  open_ai_settings || { echo "   ❌ 进不去设置面 ⇒ 改不了联网决定" >&2; return 1; }
  # 隐私同意就在设置面**第一段**（合规位置，`SettingsScreen.tsx:305` 那段注释）。
  # 🔴 那两颗按钮**互斥**，由产品的状态机决定（`SettingsScreen.tsx:330` 那个三元）：
  #   consentRecord !== null（已同意 **或** 明确选了「只用本机」）⇒ 屏上只有「撤回同意」
  #   consentRecord === null（没决定过 / 刚撤回）⇒ 屏上只有「重新作出选择」
  # 走到这里时设备停在「只用本机」= **有记录** ⇒ 屏上是「撤回同意」，不是「重新作出选择」。
  # Android 那一侧在 rig34/rig35 就是假定后者存在而两次取空，报成"合规区块被摘掉了"
  # （traps #335 那一族：期望值要由产品自己的状态机推，不能挑一颗按钮写死）。
  if found_label "$(zh common.privacy.settings.revoke)"; then
    press_label "$(zh common.privacy.settings.revoke)" || { echo "   ❌ 点不到「撤回同意」（这一档屏上有的那颗）" >&2; return 1; }
    sleep 2
    found_label "$(zh common.privacy.settings.chooseAgain)" \
      || { echo "   ❌ 撤回之后没换成「重新作出选择」⇒ 状态机或措辞变了，下一指没有落点" >&2; return 1; }
  fi
  press_label "$(zh common.privacy.settings.chooseAgain)" || { echo "   ❌ 点不到「重新选择」那颗按钮" >&2; return 1; }
  sleep 2
  found_label "$CONSENT_TITLE" || { echo "   ❌ 按了「重新选择」而那张面板没再出现" >&2; return 1; }
  press_label "$(zh common.privacy.consent.accept)" || { echo "   ❌ 点不到「同意并联网」" >&2; return 1; }
  sleep 3
  found_label "$CONSENT_TITLE" && { echo "   ❌ 面板还立着 ⇒ 这一指没落地" >&2; return 1; }
  [ "$(consent_reading)" = "accepted" ] || { echo "   ❌ 库里读到的决定不是 accepted（实际：$(consent_reading)）" >&2; return 1; }
  return 0
}
endpoint_count() {  # → 库里的端点条数（整数）；读不到打印 NOFILE/BAD:*
  # 🔴 端点住在 **`routing.endpoints`** 那一层，不是顶层（写入侧：`packages/app-host`
  #   的 `defaultAiSettingsState()` / `sanitizeRouting()`）。rig49 现量：这一枚读成
  #   `v["endpoints"]` ⇒ 库里明明有 1 条（且三档能力都勾上了）却报「端点条数读成 0」。
  #   症状是"存进去没有"，成因是探针走错了层 —— 而"回读=0"与"真没存"在输出上长得一样
  #   （§7 元规则一）。同一次的 `routes_reading` 走的是对的那一层，两者现在口径一致。
  local db
  db=$(prefs_db)
  if [ -z "$db" ] || [ ! -s "$db" ]; then printf 'NOFILE'; return 1; fi
  HEYTA_DB="$db" python3 - <<'PYE'
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
if not isinstance(v, dict):
    print("BAD:not-object"); sys.exit(0)
routing = v.get("routing")
if not isinstance(routing, dict):
    # 读不出这一层与"库里没有端点"是两种事实：这里必须分开，否则第 3 步会把探针坏
    # 读成"用户那一下没存进去"。
    print("BAD:no-routing-layer"); sys.exit(0)
print(len(routing.get("endpoints") or []))
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
# 「这批源码最后一次被**改变**」的时刻 —— 尺住在 `lib/apk-freshness.sh`（单一所有者），
#   本载体只是消费者。为什么不能是裸 mtime（rig47b 现量，记在 traps #346）：变异门禁
#   "写完再把字节原样写回"的复原、以及 checkout / rsync，都会把 mtime 顶到"刚刚"而内容
#   等于 HEAD —— 那把这道门变成一把**恒红的尺**，而恒红的尺最坏处不是碍眼，是人会去绕它。
#   真要被 #27 抓住的那种"改了 packages/ 而产物里是旧 JS"，一定是**内容**变了。
if [ ! -f "$HEYTA_REPO_ROOT/scripts/lib/apk-freshness.sh" ]; then
  echo "❌ 载不进 scripts/lib/apk-freshness.sh ⇒ 新鲜度门没有尺，本轮无效（不拿「没有判据」冒充「判过了」）"; exit 3
fi
# shellcheck source=lib/apk-freshness.sh
. "$HEYTA_REPO_ROOT/scripts/lib/apk-freshness.sh"
DIRTY_SRC=$(git -C "$HEYTA_REPO_ROOT" status --porcelain -- apps/mobile/src packages 2>/dev/null | wc -l | tr -d ' ')
JSB_M=$(stat -f %m "$JSB")
SRC_M=$(newest_src)
SRC_C=$(heyta_src_content_stamp "$HEYTA_REPO_ROOT") || { echo "❌ 内容章取不到（git log 没有该路径集的提交？）⇒ 本轮无效"; exit 3; }
[ -n "$SRC_M" ] || { echo "❌ 新鲜度门没有输入（源码目录扫不到 .ts/.tsx？）⇒ 本轮无效"; exit 3; }
echo "   新鲜度门输入：bundle ${JSB_M}（$(date -r "$JSB_M" '+%m-%d %H:%M:%S')）／内容章 ${SRC_C}（$(date -r "$SRC_C" '+%m-%d %H:%M:%S')）／裸 mtime 章 ${SRC_M}／未提交 $DIRTY_SRC 枚"
if [ "$SRC_C" -gt "$JSB_M" ]; then
  echo "   ❌ 装的是旧产物：源码内容章 $SRC_C > bundle $JSB_M"
  echo "      先 pnpm reinstall:mobile（或 --only ios）。**不许**为了跑绿而绕这道门 —— 那等于把"
  echo "      \"验的是旧代码\"写进取证（§7 第 27 条）。"
  exit 3
fi
if [ "$SRC_M" -gt "$JSB_M" ]; then
  echo "   ⓘ 有文件的裸 mtime 晚于产物，而它们的内容与 HEAD 逐字相同（未提交 $DIRTY_SRC 枚）"
  echo "     ⇒ 那是门禁 touch-复原／checkout 留下的时间，不是源码变了；这道门判的是内容。"
fi
# 「装的就是这次打的那份」：本轮要装的那一枚的字节指纹在这里取，**对账在第 1 步装完之后**。
#   内容章回答"产物不落后于源码"，那一条只能在装之前判（它判的是将要装的那枚产物）；
#   而"跑的就是刚打的那一枚"判的是**安装这个动作**，放在 install 之前会退化成
#   "上一轮装的那份 == 这一轮构建的那份" —— rig48 现量：构建目录 13:34 的 bundle 与容器里
#   rig47c 装的那份当然不同，于是每次重打之后第一趟必红，而红的原因不是"装错了"，
#   是"还没装"。判据钉在动作之前，量到的就是别的时刻的状态（§7 那一族"钉错层"的时间版）。
SHA_WILL_INSTALL=$(shasum -a 256 "$JSB" | cut -d' ' -f1)
if [ -d "$IOS_APP_DIR" ] && [ -f "$IOS_APP_DIR/main.jsbundle" ]; then
  echo "   ⓘ 将安装的 bundle 来自构建目录（sha256 ${SHA_WILL_INSTALL:0:12}）；装完后再与容器里那份逐字节对账"
else
  echo "   ⓘ 构建目录不在 $IOS_APP_DIR ⇒ 本轮装的是已装产物的快照（同一批字节，但没有新构建可对账）"
fi
ok "将要安装的是当前源码的产物"

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
# 🔴 「跑的就是刚打的那一枚」在这里判，不是在第 0b 步判：容器路径每次安装都会变，
#    所以要**重新解析**一次，再与本轮将要安装的那指纹逐字节对账。
#    （rig48 的读数就是这条判据钉错时刻的产物：它在 install 之前比"上一轮装的 vs 这一轮打的"，
#     于是每次重打之后第一趟必红，而红的不是产品、也不是安装，是判据自己量的那一刻。）
INSTALLED_APP=$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null | tr -d '\r')
if [ -z "$INSTALLED_APP" ] || [ ! -f "$INSTALLED_APP/main.jsbundle" ]; then
  echo "❌ 装完之后按 BID=$BID 读不到容器里的 main.jsbundle ⇒ 无法证明跑的是哪一批字节，本轮无效"; exit 3
fi
SHA_INST=$(shasum -a 256 "$INSTALLED_APP/main.jsbundle" | cut -d' ' -f1)
if [ "$SHA_INST" != "$SHA_WILL_INSTALL" ]; then
  echo "   ❌ 容器里那份 main.jsbundle 与本轮安装的那一枚不是同一批字节（will=${SHA_WILL_INSTALL:0:12} inst=${SHA_INST:0:12}）"
  echo "      ⇒ 装上去的不是将要打的那份（§7 #82：simctl install 退出码 0 不等于内容对上了）"
  exit 3
fi
ok "已装产物与本轮安装的那一枚逐字节相同（sha256 ${SHA_INST:0:12}，容器 $INSTALLED_APP）"
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1 || { echo "❌ simctl launch 失败 ⇒ 本轮无效"; exit 3; }
sleep 6
# 🔴 树就绪的判据是"label 数 ≥ 2 且三个候选屏之一在树里"，**不是**"某个标签在不在"：
#    RN 的 modal 会把底部标签栏整块摘出树（实测），拿标签当条件会把"面板立着"读成"桥坏了"。
CONSENT_TITLE=$(zh common.privacy.consent.title)
WELCOME=$(zh mobile.welcome.offline)
TAB_ME=$(zh mobile.tab.profile)
# 设置面是 RN Modal，而它自己的关闭键**没有 testID**（SettingsScreen 那枚 IconButton
# 只写了 icon+label）⇒ 这一格只能按标签走。它是词条原文，进判据 ㉑b 的键对账面。
CLOSE_SETTINGS=$(zh mobile.settings.close)
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
# 切到「我的」：底部标签走 press_tab（**不滚**，理由写在那枚 helper 头上）。
#   rig47b 现量：这句原来调的是 press_label ⇒ 滚动判据把标签栏判成"不可见"、按压被跳过，
#   于是三条邻锚全空，报出来的是"探针没落到这一页"（那一格自己救了自己）。
goto_me_page || echo "   · 底部标签没按下 —— 下面的同帧邻锚就是唯一能分辨「停在哪儿」的证据"
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
open_ai_settings || { bad "进不去设置面的 AI 段（导航见 open_ai_settings）"; summary "iOS 助手真机验收"; }
ok "设置面里的 AI 段在树里（读的是它内部那枚「启用 AI 功能」勾选框 —— ai-settings-section 是容器，iOS 不发节点）"
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
# 🔴 先收设置面：第 3 步就停在那一层里，而 Modal 立着的时候底部标签与「我的」页的
#    条目都不在树上 —— 直接按「我的」会读成"点了没反应"。
leave_settings || { bad "设置面收不掉（点了关闭而它内部那枚「启用 AI 功能」勾选框还在树里）⇒ 后面的屏无从判定"; summary "iOS 助手真机验收"; }
goto_me_page || { bad "切不到「我的」那一页"; summary "iOS 助手真机验收"; }
if wait_id "profile-entry-assistant" 12; then
  ok "「AI 助手」这一格进了树（同一枚锚点：第 2 步不在、这一步在 ⇒ 成对成立）"
else
  bad "配好端点后「AI 助手」入口仍不在树里 —— 与第 2 步的对照断掉（aiEntryVisible 没跟着配置变）"
  summary "iOS 助手真机验收"
fi
press_id "profile-entry-assistant" || { bad "点不进助手屏"; summary "iOS 助手真机验收"; }
wait_id "assistant-back" 12 || { bad "助手屏没起来（它自己的出口按钮不在树里）"; summary "iOS 助手真机验收"; }
shot "ios-ai-1-assistant.png" "assistant-back"

step "5. 判据②③：五档 chips 与「只给建议」常驻脚注"
# 🔴 逐枚读 id（ai-mode-<功能>），不读标签：`Chip` 是无障碍名 = 标签唯一稳定的那一层，
#   而标签字符串在两端的合成规则不同（#345），换措辞就会把这条判据读成"界面缺那一档"。
#   id 这一层的正确性由门禁 ㉑ 的字面臂在无设备时守着。
MISS=""
for f in capture breakdown prioritize duration-estimate tool-calling; do
  found_id "ai-mode-$f" || MISS="$MISS ai-mode-$f"
done
if [ -n "$MISS" ]; then
  bad "这几档 chip 的锚点不在树里：$MISS"
else
  ok "助手屏五档 chips 全在（逐枚 id 现读；check:ai-coverage 在 iOS 设备上的对应物）"
fi
FOOT=$(zh mobile.ai.proposalNeverAuto)
if found_label "$FOOT"; then
  ok "「只给建议」那句常驻脚注在屏上（它是唯一对用户承诺「确认前不写」的文案）"
else
  bad "常驻脚注不在屏上（那句承诺消失了，而它是这套体系的免责基础）"
fi

step "6. 五档路由绑到回环端点（每档点名它自己那一枚 chip）"
# 🔴 五块 `ai-feature-<f>` 住在**设置面**的 AI 段里，不在助手屏上 —— 第 4/5 步停在
#   助手层，直接在那儿点会读到"锚点取不到"，而那是导航没做完，不是界面缺那一格。
#   块锚点在 iOS 上根本没有节点（见导航段），所以这里按 `ai-route-<档>-<下标>` 逐枚点：
#   下标 0 = 这一排第一枚 = 本轮唯一配的那枚端点（回环）。
open_ai_settings || { bad "进不去设置面的 AI 段 ⇒ 这一格没有输入"; summary "iOS 助手真机验收"; }
for f in capture breakdown prioritize duration-estimate tool-calling; do
  press_id "ai-route-$f-0" || bad "$f 那一档的端点 chip 点不到（ai-route-$f-0）"
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

step "6b. 逐工具授权（规则前门的必要输入）"
# 🔴 规则表的候选集 = **用户逐枚授权过**的那些工具（ADR-0011 §3.1：默认全关）。
#   一枚都没勾时 `resolveToolSelection` 得到 `no-tool-granted`，任何句子都到不了规则那一支
#   —— rig51 第 7 步那两条红就是这个形状（界面报"还没有授权任何工具"，载体把它读成
#   "规则没有先跑"）。授权位从库里回读，不拿"勾过了"当数。
press_id "ai-tool-grant-list_tasks" || bad "勾不上逐工具授权 ai-tool-grant-list_tasks ⇒ 第 7 步没有输入"
sleep 1
GR=$(grants_reading)
case "$GR" in
  NOFILE|BAD*)
    bad "库回读没拿到（$GR）—— 授权到底写进去没有，不许拿「勾了」当已通过"
    ;;
  *)
    echo "   · 设备库回读（localApi.grants）：$GR"
    case "$GR" in
      *'list_tasks=1'*) ok "库里 list_tasks 的授权位 = 1（读的是被写那一侧）" ;;
      *) bad "库里 list_tasks 仍是未授权（$GR）⇒ 第 7 步的规则前门没有候选集" ;;
    esac
    ;;
esac

step "6c. 种一条真任务（第 9/10 步的输入：拆解那一档从任务列表里选一条）"
# 🔴 `breakdown-start` 的 disabled 表达式是 `selectedId === undefined || route.target === undefined`
#   —— 拆解的对象是**已存在的任务**，全新安装的设备上列表是空的 ⇒ 恒禁用。
#   rig51 第 9/10 步那三条红（按钮禁用 / 计数不动 / 没有提案卡）都是这一个原因，
#   不是产品缺功能。种任务走真 UI（FAB → 输入 → 「添加」），与 verify-mobile-ios 同一条通道。
leave_settings || { bad "设置面收不掉 ⇒ 种任务没有屏"; summary "iOS 助手真机验收"; }
press_tab "$(zh mobile.tab.tasks)" || bad "切不到「任务」那一页 ⇒ 种任务没有屏"
sleep 2
TASK_TITLE="AI验收任务$(date +%m%d%H%M%S)"
BASE_OPS=$(ops_count)
ax "新建任务" --pressable --press --json >/dev/null 2>&1
sleep 1
ax - --field --set "$TASK_TITLE" --json >/dev/null 2>&1
sleep 1
if [ "$(jget "$(ax "添加" --pressable --exact --list --json)" enabled)" != "True" ]; then
  ax - --field --type-text "$TASK_TITLE" >/dev/null 2>&1
  sleep 1
fi
if [ "$(jget "$(ax "添加" --pressable --exact --list --json)" enabled)" = "True" ]; then
  ok "「添加」由空输入禁用变成启用 ⇒ 标题真进了应用状态（${TASK_TITLE}）"
else
  bad "写进 Composer 后「添加」仍禁用 ⇒ 标题没进应用状态，第 9/10 步没有输入"
  summary "iOS 助手真机验收"
fi
# 🔴 「添加」必须**逐字**匹配：退化子串会命中「排序：按添加时间」那枚 chip（陷阱 #109
#   的同一条），于是"Composer 还开着"会被读成永远开着，而重试全打在排序面板上。
add_btn_present() { [ "$(jget "$(ax "添加" --pressable --exact --list --json)" found)" = "True" ]; }
for _t in 1 2 3; do
  ax "添加" --pressable --exact --press --json >/dev/null 2>&1
  sleep 2
  add_btn_present || break
  ax --dismiss-keyboard --json >/dev/null 2>&1
done
if add_btn_present; then
  bad "按了「添加」而 Composer 还开着 ⇒ 那条任务没落库，第 9/10 步没有输入"
  summary "iOS 助手真机验收"
fi
AFTER_OPS=$(ops_count)
case "$AFTER_OPS" in (''|*[!0-9]) bad "op-log 条数读不出（$AFTER_OPS）" ;; esac
if [ "$AFTER_OPS" -gt "$BASE_OPS" ]; then
  ok "种下的任务落了库（ops ${BASE_OPS}→${AFTER_OPS}）—— 拆解那一档现在有得选"
else
  bad "种完任务而库里一条 op 都没多（${BASE_OPS}→${AFTER_OPS}）⇒ 第 9/10 步的输入不成立"
  summary "iOS 助手真机验收"
fi

step "7. 判据⑦（Goal-D 那一格）：本机规则命中 ⇒ 零外发"
open_assistant || { bad "回不到助手屏 ⇒ 这一格没有输入"; summary "iOS 助手真机验收"; }
# 切到「AI 工具调用」那一档：规则前门只在这条链路上跑。
press_id "ai-mode-tool-calling" || bad "切不到「AI 工具调用」那一档"
sleep 2
# 🔴 Goal-D 的全部内容在这一行：规则表 12 条的**谓词头全是中文**，所以这一格在 Android
#   载体上是不可达的（三条输入通道都送不进中文，记在 verify-mobile-ai.sh 第 5 步 5d）。
#   iOS 这一侧中文走 **AXSetValue**（rig49 现量否证了"HID 是唯一路"那句假设：
#   `idb ui text` 按 HID 键码表逐字符查码，非 ASCII 直接抛 "No keycode found for 列"），
#   而"中文经 set-value 真进了 RN 状态"在 verify-mobile-ios.sh 里早已被**库级**判据证过
#   （它按逐字去 ops 表里找那条中文标题的 op）。⇒ 这一格第一次有设备读数。
RULE_PROMPT="列出我的任务"
set_id "tool-input" "$RULE_PROMPT" || summary "iOS 助手真机验收"
ax --dismiss-keyboard --json >/dev/null 2>&1
sleep 1
stub_reset
BEFORE=$(stub_count)
if enabled_id "tool-start-single"; then
  press_id "tool-start-single" || bad "「运行」点不动"
  sleep 2
  # 🔴 规则命中时**不该有披露步**（披露讲的是"哪些字段要出门"，而这一趟压根不出门），
  #   所以"没看到 ai-tool-send"不能当失败 —— 上一次这里写的是"既没披露也没结果"，
  #   那条会把正确行为读成屏上什么都没有。出现披露步仍然按下发送，让闸门那一侧的读数也取到。
  if found_id "ai-tool-send"; then
    echo "   · 出现了披露步（这一发准备出门）⇒ 仍按发送，让界面对它做一次判断"
    press_id "ai-tool-send" || bad "披露步的「发送」点不动"
  else
    echo "   · 没有披露步：本机规则直接给答案（这正是零外发该有的形状）"
  fi
  sleep 6
  AFTER=$(stub_count)
  # 🔴 界面自己盖的章：结果卡上那行脚注在 `via==='rule'` 时是「本机规则命中 —— 没有联网」，
  #   走模型时是「由模型选择」（AssistantScreen.tsx:1448）。**这条才是这一格的正向对照**：
  #   没有它，"计数没动"与"那一发压根没打出去（输入没落地 / 按钮没按动）"在输出上长得一模一样
  #   （§7 元规则一），而第 8 步那句 ASCII 句子 misses 规则后的 0→0 也与这一格无法区分。
  if found_label "$(zh web.ai.tools.viaRule)"; then
    ok "结果卡上盖着「本机规则命中 —— 没有联网」⇒ 本机路径真的跑到了头，答案落地了"
  else
    bad "结果卡没有那句规则章 —— 这一格的零外发无从归因（没发？发了没回来？还是走了模型？）"
  fi
  if found_label "$(zh web.ai.tools.viaModel)"; then
    bad "同一张卡上出现「由模型选择」—— 规则命中的那一发其实出门了"
  fi
  if [ "$BEFORE" = "$AFTER" ]; then
    ok "本机规则命中那一趟：假端点计数 ${BEFORE}→${AFTER} 一次没动"
  else
    bad "本机规则该零外发，而假端点计数 ${BEFORE}→${AFTER} 动了 —— 短路没生效"
  fi
  # 🔴 命中之后界面上应当是**答案**，不是那句闸门拒绝。
  #    失败面/披露面那两个 `<Stack testID>` 容器在 iOS 上不发节点，所以读它们各自内部
  #    那枚按钮：失败面 = 「重试」（ai-tool-retry），披露面 = 「发送」（ai-tool-send）。
  if absent_id "ai-tool-retry"; then
    ok "那一趟没落到失败面（没有 privacy-consent-not-granted 那一屏）"
  else
    bad "规则命中却被闸门拦下（失败面的「重试」在树里）⇒ 规则没有先跑，短路是假的"
  fi
  if found_id "ai-tool-send"; then
    bad "规则命中之后还停在披露步 —— 本机答案没有直接落地"
  else
    ok "规则命中后披露步已收掉（走的是本机执行，不是\"先看一眼再发\"）"
  fi
else
  bad "「运行」按钮是禁用态（输入框没写进去 / 路由没绑上）⇒ 这一格没有读数"
fi

step "8. 判据④：只用本机档 —— 闸门拒绝原文 + 点名端点 + 计数不动"
press_id "ai-mode-capture" || bad "切不回「一句话捕获」"
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
# 🔴 rig51 现量更正：这一格读的是**失败面**上那句拒绝（`web.ai.failure.cause.egressNotAuthorized`
#   —— Android rig46 那张 `android-ai-2-egress-blocked.png` 上的红字逐字就是它），
#   不是披露步里的 consentLead。目的地是回环时 consentLead **按设计不渲染**（与第 6 步
#   "回环端点不索取逐功能授权"同一个口径），拿它当"拒绝原文"就是一条恒不成立的判据 ——
#   而恒红比恒绿更贵：它把载体的期望错拼进产品结论里（rig51 那条红就是这么来的）。
# 🔴 rig52 现量更正（这一条把一条真缺陷照了出来）：闸门拒绝原先在界面上渲染的是
#   `web.ai.failure.cause.network` 那句「连不上端点。检查网络，以及端点地址是否可达。」，
#   而真相是设备级同意没给、一个字都没发。根因在 `packages/ai` 的 catch 一律归成
#   `network`（见 `egress.ts` 末尾那段与 `routing.ts` 的 `attemptOnce`），
#   副作用还包括给没被访问过的端点记熔断锅（设备库实测 consecutiveFailures=2 /
#   lastError=network）。现在归 `consent-not-granted`，判据读的就是那句新词条。
REJECT=$(zh web.ai.failure.cause.consentNotGranted)
if found_label "$REJECT"; then
  ok "只用本机档：发送在本机闸门处被拦下，界面给出拒绝原文（逐字取自词条表）"
else
  bad "没看到那句拒绝原文（「${REJECT}」不在树里）—— 静默失败或静默成功都算这一条红"
  # 取证：把"界面上到底是哪一句"带进日志，下一轮不必再靠猜（§7 元规则一：先修探针）。
  echo "   · 取证：树里含「同意并联网」=$(found_label "同意并联网" && echo 是 || echo 否) 含「检查网络」=$(found_label "检查网络" && echo 是 || echo 否) 含「只用本机」=$(found_label "只用本机" && echo 是 || echo 否)"
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
if found_id "capture-retry"; then
  ok "失败面给出「重试」—— 不确定态可重试，不是把用户钉死在一屏"
  # 截图挂在**判据成立之后**：锚点没成立就拍一张，等于给一张不知道对应哪条判据的图。
  shot "ios-ai-2-local-only-blocked.png" "capture-retry"
else
  bad "失败面没有「重试」出口（capture-retry 不在树里）"
fi

step "9. 判据⑤：非回环目的地 ⇒ 授权入口出现、逐字段披露点名"
# 🔴 先开设备级同意闸，**再**做这一格。它是绝对的（`consent-gate.ts`：没有同意一个字节
#   都不出这台设备，回环也不例外），闸门关着时下面那句"未授权就发出去 ⇒ 计数会涨"
#   恒不成立、而"零外发"那条恒成立 —— 两条都会被读成"授权面在起作用"，其实读到的是
#   另一道闸。第 8 步必须在**关着**的时候跑（它判的就是那道闸），所以翻转放在这里。
CONSENT_BEFORE=$(consent_reading)
flip_consent_to_network || { bad "改不成「同意并联网」（改之前 = ${CONSENT_BEFORE}）⇒ 判据⑤⑥与 Goal-D 那一格都没有分母"; summary "iOS 助手真机验收"; }
ok "设备级同意已改成「同意并联网」（库里回读 = $(consent_reading)，读的是被写那一侧）"
# 先开「允许远程端点」，再存一枚 https 的非回环端点，然后把「拆解任务」那档指过去。
open_ai_settings || { bad "进不去设置面的 AI 段 ⇒ 这一格没有输入"; summary "iOS 助手真机验收"; }
press_id "ai-gate-remote" || bad "开不了「允许远程端点」"
sleep 1
set_id "ai-endpoint-label" "$EP_REMOTE" || summary "iOS 助手真机验收"
set_id "ai-endpoint-url" "$DEVICE_REMOTE_URL" || summary "iOS 助手真机验收"
set_id "ai-endpoint-model" "stub-model" || summary "iOS 助手真机验收"
# 🔴 能力必须**声明**，否则这一枚端点永远进不了「拆解任务」的候选集：
#   `requiredCapabilities.breakdown = ['structured_output','long_context']`（`routing.ts`），
#   而"没声明"按 ADR-0010 等于保守 = 没能力。rig52 那两条红（「拆解」禁用态 ⇒
#   判据⑤⑥没有读数）根因就在这里，不在产品 —— 第 3 步那枚回环端点勾了三档，
#   这一枚一枚都没勾。
for cap in structured_output long_context; do
  press_id "ai-endpoint-cap-$cap" || bad "勾不上能力 chip ai-endpoint-cap-$cap（非回环那枚）"
done
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
# 第 6 步之后有两枚端点：下标 0 = 回环、下标 1 = 这一轮新存的 https 端点。
press_id "ai-route-breakdown-1" || bad "把「拆解任务」指向远程端点这一指没落地"
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
# 🔴 上一段是在**设置面（RN Modal）**里点的，此刻底部标签根本不在树里 —— 直接
#   `press_label "$TAB_ME"` 会得到"按压失败"，而那既不是产品红也不是导航红。
open_assistant || { bad "点不进助手屏"; summary "iOS 助手真机验收"; }
press_id "ai-mode-breakdown" || bad "切不到「拆解任务」"
sleep 2
# 🔴 拆解的对象是从任务列表里**选**的一条（`breakdown-start` 的 disabled =
#   `selectedId === undefined || route.target === undefined`）。rig51 那两条红
#   不是产品缺功能，是载体没选行、而 6c 之前列表压根是空的。
press_label "$TASK_TITLE" || bad "选不中第 6c 步种下的那条任务（「${TASK_TITLE}」）⇒ 拆解那一档没有输入"
sleep 1
stub_reset
B4=$(stub_count)
if enabled_id "breakdown-start"; then
  press_id "breakdown-start" || bad "「拆解」点不动"
  sleep 2
  # 🔴 披露面那个 `<Stack testID>` 容器在 iOS 不发节点 ⇒ 读它内部那枚「发送」（ai-send）。
  if found_id "ai-send"; then
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
    shot "ios-ai-3-disclosure.png" "ai-send"
    press_id "ai-send" || bad "披露步的「发送」点不动"
    sleep 6
    AF=$(stub_count)
    if [ "$B4" = "$AF" ]; then
      ok "未授权时点发送仍然零外发（计数 ${B4}→${AF}），界面给的是 egressNotAuthorized 那一族"
    else
      bad "没给逐功能授权就发出去了（计数 ${B4}→${AF}）—— 授权面形同虚设"
    fi
  else
    bad "按了「拆解」之后没有披露步（ai-send 不在树里）⇒ 判据⑤没有输入"
  fi
else
  bad "「拆解」按钮是禁用态（路由没绑上 / 输入没写进去）⇒ 判据⑤没有读数"
fi
# 逐功能授权点下去。
# 🔴 rig55 唯一那条红的定源（**载体时序，不是产品**）：这一指原先写在上面那段
#   「未授权 ⇒ 零外发」**之后**，而那段早已把界面切到助手屏的失败面 ——
#   `ai-consent-breakdown` 住在**设置面**（`AiSettingsSection.tsx:448`），此刻不在树上，
#   `press_id` 的 scroll-into-view 报 `found=False / element-left-tree`。
#   "点不动"与"界面把入口摘掉了"在探针输出上长得一样（§7 元规则一），而后者才是
#   这句 bad 文案说的意思 —— 它会把人引向一条不存在的产品缺陷。
#   修法不是放宽判据，是**回到它住的那个面**再点；点后还要从库里回读授权位：
#   按到了 ≠ 存住了（§7 第 25 条那一族，读的是被写那一侧）。
#   放在零外发那段**之后**是有意的：先证明没授权时一发都不出去，再给授权。
#   换回回环那一档时它不影响 —— `needs = requiresEgressConsent(destination)` 只看地址类别，
#   授权位只翻转按钮文案（「授权」↔「撤回」），所以下一步那条"入口消失"的成对判据照旧成立。
open_ai_settings || bad "回不进设置面 ⇒ 这一档「点得动」没有读数"
press_id "ai-consent-breakdown" || bad "非回环那档的授权入口点不动（此刻设置面开着、地址仍是非回环 ⇒ 这一回才是真红）"
sleep 1
READ_GRANT=$(routes_reading)
if printf '%s' "$READ_GRANT" | grep -q 'breakdown=1/1'; then
  ok "逐功能授权点下去并落进设备库（库里回读：breakdown 那一档 路由=1 / 同意=1）"
else
  bad "按了授权位而库里读到的不是「已授权」（$READ_GRANT）⇒ 点住了没存住"
fi
sleep 1

step "10. 判据⑥：提案卡出现，且没点确认 ⇒ 本机库一条都不多（同趟带正向对照）"
# 10b：闸门**开着**再跑一遍第 7 句那条规则句。第 7 步那一趟闸门还关着，它的 0→0 与
#      "压根发不出去"在输出上长得一样；这一趟才是 Goal-D 那一格要的读数。
open_assistant || { bad "回不到助手屏 ⇒ Goal-D 那一格没有读数"; summary "iOS 助手真机验收"; }
press_id "ai-mode-tool-calling" || bad "切不到「AI 工具调用」那一档"
sleep 2
set_id "tool-input" "$RULE_PROMPT" || summary "iOS 助手真机验收"
ax --dismiss-keyboard --json >/dev/null 2>&1
sleep 1
stub_reset
B_RULE=$(stub_count)
if enabled_id "tool-start-single"; then
  press_id "tool-start-single" || bad "「运行」点不动（联网开着也一样）"
  sleep 6
  A_RULE=$(stub_count)
  if found_label "$(zh web.ai.tools.viaRule)"; then
    ok "联网开着时结果卡上仍是规则章 ⇒ 下面那条 0→0 归因给规则短路，而不是归因给闸门"
  else
    bad "联网开着时结果卡没有规则章 ⇒ 这一趟的 0→0 无法归因给规则短路"
  fi
  if [ "$B_RULE" = "$A_RULE" ]; then
    ok "🔴 Goal-D 那一格（闸门开着的版本）：规则命中 ⇒ 假端点计数 ${B_RULE}→${A_RULE} 一次没动"
  else
    bad "联网开着而规则命中那一趟计数动了（${B_RULE}→${A_RULE}）—— 短路没生效"
  fi
else
  bad "「运行」按钮是禁用态（联网开着也一样）⇒ Goal-D 那一格没有读数"
fi
# 把「拆解任务」换回**回环**假端点：这一发该真打出去，而假端点返回确定内容 ⇒ 提案卡出得来。
# 🔴 这一趟同时是第 7/9 步那句「计数没动」的**分母**：同一次运行里计数会 +1，
#   说明那两条 0→0 不是"压根没人数"（traps #335 那一族：否定判据必须出示分母）。
open_ai_settings || { bad "进不去设置面"; summary "iOS 助手真机验收"; }
press_id "ai-route-breakdown-0" || bad "把「拆解任务」换回回环这一指没落地"
sleep 1
if found_id "ai-consent-breakdown"; then
  bad "路由换回回环后那一档的授权入口还在 —— 与第 9 步的「出现」配不成对"
else
  ok "路由换回回环后，那一档的授权入口**消失**（成对的另一半）"
fi
open_assistant || { bad "点不进助手屏"; summary "iOS 助手真机验收"; }
press_id "ai-mode-breakdown" || bad "切不到「拆解任务」"
sleep 2
# 重新进面板会丢掉上一次的选中行 ⇒ 这里再选一次（选中态不是持久状态，别假设它跨挂载）。
press_label "$TASK_TITLE" || bad "第 10 步选不中那条任务 ⇒ 提案卡判据没有输入"
sleep 1
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
