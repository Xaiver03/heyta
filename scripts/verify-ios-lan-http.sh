#!/usr/bin/env bash
#
# iOS 局域网明文 HTTP 验收：证明 heyta 在 iOS 上**能连自建服务器**
# （`http://<私有IP>:3000` 这种地址），而不是只能连 localhost。
#
# ── 为什么需要这个脚本
#
# heyta 是自建优先的：用户的服务器在 NAS / 树莓派 / 家里的小主机上，
# 手机连的就是**局域网私有的明文 HTTP 地址**。这个场景一旦不可用，
# iOS 端的自建能力直接为零 —— 这不是学术问题。
#
# ── 🔴 这个脚本曾经把结论归错因，记在这里
#
# 第一版写的是"证明 **ATS** 允许私有 IP 字面量"，并且暗示
# `NSAllowsLocalNetworking = true` 是承重的那一项。**这是错的。**
#
# 反证过程：把这个键改成 `false`（`NSAllowsArbitraryLoads` 保持 `false`）重装再跑 ——
# **依然成功**，而且用一个**只绑在 `192.168.1.5:3100` 上的监听器**抓到请求：
#
#     GET /api/sync/ops?...  client=192.168.1.5:65102  host_header=192.168.1.5:3100
#                            ua=HeytaMobile/1 CFNetwork/3860.600.12 Darwin
#
# 即：**私有 IP 字面量的明文 HTTP 本来就不受 ATS 拦**，与 `NSAllowsLocalNetworking` 取值无关。
# 那个键对"用 `.local` / link-local 主机名"的场景可能仍然有用 —— 但**没有验证过，不要外推**。
#
# 教训（与 AGENTS §7 开头"先怀疑探针"同源）：**一个绿，不等于你解释它的那个原因是真原因。**
# 把它变成可失败的验收，才逼出了这个反证。
#
# ── 判据设计（三个地址，单变量对照 —— 这是本脚本的全部价值）
#
#   2a 对照：`http://<LAN_IP>:<错端口>`   → 必须**失败**（排掉"忽略端口"）
#   2b 对照：`http://<同网段错IP>:<真端口>` → 必须**失败**（排掉"忽略主机、其实在连 127.0.0.1"）
#   3  实验：`http://<LAN_IP>:<真端口>`    → 必须**成功**（状态「已是最新」，
#                                            且「上次成功同步」前进）
#
# 🔴 **2a 和 2b 缺一不可。** 只有 2a 时，"应用其实一直在连 127.0.0.1" 这条假设
# **依然活着**，而它会伪造出与真实成功**完全一样**的绿。
# （第一版就只写了 2a，这正是归因错误的另一半原因。）
#
# ⚠️ 第 3 步失败时，脚本不替你猜原因（需要人看服务端日志 / 抓包）：
#   - 服务端**没收到**请求 → 客户端侧被拦（ATS、或地址写错）
#   - 服务端**收到了**但失败 → 问题在服务端/载荷，与客户端可达性无关
#
# ── 前置条件
#
#   - 模拟器已启动（默认 691C20D9-FB85-4B81-A3CC-0F5623AEF082，iPhone 17 Pro）
#   - 该模拟器上已装好 Release 版 HeytaMobile
#   - 宿主机服务端**绑在 0.0.0.0**（不是 127.0.0.1），且能从 LAN IP 访问
#   - /tmp/heyta_mobile_{token,e2ee}.txt 存在（凭据；口令只在内存里，重启应用后必须重填）
#   - Xcode 命令行工具（`swiftc`）
#
# 可覆盖的环境变量：IOS_UDID / IOS_BID / IOS_DEVICE_NAME / SERVER_PORT / LAN_IP
#
set -u
. "$(dirname "$0")/lib/mobile-e2e.sh"

# 🔴 UDID **不要写死**。写死过一个，然后那台设备被删掉了 ——
#    验收的失败长相是"模拟器没在启动状态"，看起来像环境问题，其实是我们指向了幽灵。
#    规则：显式 `IOS_UDID` 优先；否则取**同名且已启动**的那台；只有一台已启动就用它；多台且无同名时**不猜**。
UDID=${IOS_UDID:-}
BID=${IOS_BID:-org.reactjs.native.example.HeytaMobile}
DEVICE_NAME=${IOS_DEVICE_NAME:-iPhone 17 Pro}
PORT=${SERVER_PORT:-3000}
TOKEN_FILE=/tmp/heyta_mobile_token.txt
E2EE_FILE=/tmp/heyta_mobile_e2ee.txt

if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl list devices booted -j 2>/dev/null | python3 -c "
import json, sys
want = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
booted = []
for _runtime, devices in (data.get('devices') or {}).items():
    for d in devices:
        if d.get('state') == 'Booted':
            booted.append((d.get('name') or '', d.get('udid') or ''))
same = [u for n, u in booted if n == want]
if len(same) == 1:
    print(same[0])
elif len(booted) == 1:
    print(booted[0][1])
" "$DEVICE_NAME" 2>/dev/null)
  if [ -z "$UDID" ]; then
    echo "   ❌ 认不出要验收哪台模拟器（已启动 $(xcrun simctl list devices booted 2>/dev/null | grep -c Booted) 台）。" >&2
    echo "      显式指定：IOS_UDID=<udid> bash scripts/verify-ios-lan-http.sh" >&2
    exit 1
  fi
  echo "   （自动选中 UDID=${UDID}，设备名「${DEVICE_NAME}」）"
fi

ACCEPT_NAME="iOS 局域网明文 HTTP（私有 IP 字面量）"

# ── I/O 层：idb，**从设备内部**驱动 ─────────────────────────────────────────
#
# 🔴 这里原来用的是宿主 AX（`axpress.swift`）。换成 idb 的原因是**硬约束**：
#
#    macOS 的 AX **只能看见「当前 Space」上的窗口**。模拟器窗口一到别的桌面，
#    AX 树里就只剩菜单栏 —— 读不到任何控件，而截图里 App 明明渲染得好好的。
#    唯一的"修法"是把窗口拽到用户面前，那等于**跟用户抢前台**（实测被明确叫停）。
#
#    `idb`（facebook/idb，MIT，2026-09-25 仍在提交）绕开了整件事：
#    它通过 companion 直接和模拟器通信，无障碍树 / 点击 / 输入**全在设备内部完成**。
#    **不需要窗口存在、不需要窗口在哪个 Space、不需要焦点、不需要辅助功能权限。**
#
# 实测对照（窗口 `on=0`，即不在当前 Space）：
#     `idb ui describe-all`  → 完整无障碍树（402x874 设备坐标）
#     `idb ui tap 351 808` + `idb ui text "MYTOKEN123"` → 真的生效
#     `mac click <pid> … bg`（postToPid） → **不生效**，页面毫无变化
#
# 🔴 定位一律走 `idb-find.py` 自己算坐标，**不要用 `idb ui tap <标签>`**：
#    那个是**子串匹配**，marker 传「访问令牌」命中的是那段说明文字
#    （"…但访问令牌会以明文经过网络…"），不是下面的输入框。见 AGENTS §7 第 38 条。

IDB_UDID="$UDID"
resolve_idb || { echo "   ❌ idb 不可用，iOS 验收无法进行" >&2; exit 1; }

# 读「我的」页状态区。返回三行：状态 / 待上传 / 上次成功同步
#
# 🔴 值的取法靠**几何**：标签是 AXStaticText，「状态」的值在它下面那一行，
#    「待上传」「上次成功同步」的值在同一行右侧。idb 给的 frame 是设备坐标。
read_status() {
  idb_dump
  python3 - "$IDB_DUMP_FILE" <<'PY'
import json, sys
try:
    els = json.load(open(sys.argv[1], encoding='utf-8'))
except Exception as e:
    print(f"# dump 读不出来: {e}", file=sys.stderr); raise SystemExit(2)
if isinstance(els, dict): els = [els]

def txt(e):
    v = (e.get('AXValue') or '').strip()
    return v if v else (e.get('AXLabel') or '').strip()

texts = []
for e in els:
    t = txt(e)
    f = e.get('frame') or {}
    if t and f.get('width'):
        texts.append((t, f.get('x', 0), f.get('y', 0)))

LABELS = ('状态', '待上传', '上次成功同步')
def is_label(t):
    return t[0] in LABELS

def value_of(label):
    lab = [t for t in texts if t[0] == label and is_label(t)]
    if not lab: return None
    _, lx, ly = lab[0]
    # 形状 1：同一行、在标签右边
    same = [t for t in texts if abs(t[2] - ly) < 6 and t[1] > lx and not is_label(t)]
    if same: return sorted(same, key=lambda t: t[1])[0][0]
    # 形状 2：标签下面（「状态」的值是单独一行的）
    below = [t for t in texts if 0 < t[2] - ly <= 70 and not is_label(t)]
    if below: return sorted(below, key=lambda t: (t[2], t[1]))[0][0]
    return None

for lb in LABELS:
    v = value_of(lb)
    print(f'{lb}={v if v is not None else ""}')
PY
}

status_line() { printf '%s\n' "$1" | sed -n 's/^状态=//p'; }
lastsync_line() { printf '%s\n' "$1" | sed -n 's/^上次成功同步=//p'; }

# 软件键盘立着吗？idb 的树里键盘按键是 AXButton，标签是单个字母。
keyboard_up() {
  idb_dump
  python3 - "$IDB_DUMP_FILE" <<'PY'
import json, sys
try: els = json.load(open(sys.argv[1], encoding='utf-8'))
except Exception: raise SystemExit(1)
if isinstance(els, dict): els = [els]
letters = {'q','w','e','r','t','y','u','i','o','p','a','s','d','f','g','h','j','k','l','z','x','c','v','b','n','m'}
for e in els:
    if (e.get('role') or '') == 'AXButton' and (e.get('AXLabel') or '').strip().lower() in letters:
        raise SystemExit(0)
raise SystemExit(1)
PY
}

# 收键盘。
#
# 🔴 旧写法（宿主 AX）要**逐个试候选键名**：「换行」/`return`/「完成」…… 因为那个键
#    会在同一个会话里改名（中文键盘「换行」、英文键盘 `return`、数字键盘「完成」）。
#    **idb 没这个问题** —— `ui key 40` 是 HID 键码（Return），和设备上显示什么字无关。
#    写死键名这条坑因此**从根上消失了**，而不是被绕过去。
dismiss_keyboard() {
  keyboard_up || return 0
  idb_ui key 40 >/dev/null 2>&1
  sleep 1
  keyboard_up || return 0
  idb_ui key 40 >/dev/null 2>&1
  sleep 1
  keyboard_up || return 0
}

# 切到「我的」页。
goto_profile() {
  # 标签栏四个标签按**精确标签**找；不按 role（role 会漂）。
  idb_tap_label "我的" || return 1
  sleep 3
  # 确认真的切过去了：只按一下、不验证，后续会在别的地方报"写入失败"，
  # 而真因是"根本没在那一页"。**按了 ≠ 到了。**
  idb_dump
  idb_has "服务器地址"
}

# 🔴 **写完必须读回来核对。** 只看 `idb ui text` 的退出码是不够的 ——
#    那是**工具的回执**，不是事实。实测两种它会"成功但没生效"的样子：
#      `ui text` 是**在光标处插入**（点在字段中间就插到中间），不是替换，也不是追加；
#      `ui set-value`（含空串）与 `ui key`（Cmd+A / 退格）**全部无效**，却都返回 0。
#    所以：核对读回值；对不上就带着**实际读到的东西**失败，别让下游去猜。
#
#    「端到端加密口令」是 SecureTextField，读回来只有掩码点 —— 比**长度**。
set_field() {  # <标签> <值> [--secure]
  local label=$1 val=$2 mode=${3:-}
  local xy cur i=0 want_len got_len

  xy=$(idb_field_center "$label" 2>/dev/null) || {
    echo "      ↳ set_field「${label}」失败：界面上没有这个输入框" >&2; return 1
  }
  # 三击全选（不是单击）—— 单击是在**光标处插入**，会把新值拼进旧值里。
  # 这条踩得很实：2a 曾把地址写成 `http://10.0.2.2:3000http://192.168.1.5:3007`。
  idb_ui multi-tap $xy --count 3 >/dev/null 2>&1 || { echo "      ↳ set_field「${label}」失败：三击选不中 @$xy" >&2; return 1; }
  sleep 1
  idb_ui text "$val" >/dev/null 2>&1 || { echo "      ↳ set_field「${label}」失败：输入没被接受" >&2; return 1; }

  # 🔴 **读回要轮询，不能睡一下就下结论。**
  #    实测：225 字符的令牌输入后立刻读，会读到只有 ~157 字符的**前缀** ——
  #    看起来像"输入被截断"，其实是**读回早于输入落地**。
  #    同一段字符串单独测（10/30/50/64/65/100 字符）读回全都精确一致，
  #    所以这不是 `ui text` 的长度上限，是**时序**。
  #    这类假红最坏的地方在于：它会把人引去怀疑一个根本不存在的长度限制。
  while [ "$i" -lt 10 ]; do
    sleep 1
    i=$((i + 1))
    idb_dump
    cur=$(idb_field_value "$label" 2>/dev/null)
    if [ "$mode" = "--secure" ]; then
      # 比长度要用 **python 数**，不能用 bash 的 `${#v}` ——
      # 实测 `${#中文}` 在非 UTF-8 locale 下返回**字节数**（8 个汉字报 24），
      # 于是"长度相等"会变成永远不成立的条件，而失败原因完全看不出来。
      want_len=$(python3 -c "import sys;print(len(sys.argv[1]))" "$val")
      got_len=$(python3 -c "import sys;print(len(sys.argv[1]))" "$cur")
      [ "$want_len" = "$got_len" ] && return 0
    else
      [ "$cur" = "$val" ] && return 0
    fi
  done

  if [ "$mode" = "--secure" ]; then
    echo "      ↳ set_field「${label}」失败（等了 ${i}s）：期望 $want_len 位，读回 $got_len 位" >&2
  else
    echo "      ↳ set_field「${label}」失败（等了 ${i}s）：期望 '$val'，读回 '$cur'" >&2
  fi
  return 1
}

# 设置地址 → 收键盘 → 按「立即同步」。三步都必须成功，否则后续断言没有意义。
trigger_sync() {  # <地址>
  # 每一步都要能**指名道姓地**失败。只报"无法触发同步"的话，
  # 真因可能是没填进去、可能是键盘没收掉、也可能是按钮不叫那个名字了 —— 三种方向完全不同。
  set_field "服务器地址" "$1" || { echo "      ↳ trigger_sync：地址没写进去" >&2; return 1; }
  sleep 1
  dismiss_keyboard
  # 「立即同步」在同步中叫「正在同步…」（后台还有指数退避重试），
  # 所以这里由 idb_tap_label 负责**等它回到空闲**再点。等不到就把当前按钮名打出来。
  if ! idb_tap_label "立即同步"; then
    idb_dump
    echo "      ↳ trigger_sync：等不到「立即同步」。当前可点按钮有：" >&2
    python3 - "$IDB_DUMP_FILE" <<'PY' >&2
import json, sys
try: els = json.load(open(sys.argv[1], encoding='utf-8'))
except Exception: raise SystemExit(0)
if isinstance(els, dict): els = [els]
for e in els:
    if (e.get('role') or '') == 'AXButton':
        lbl = (e.get('AXLabel') or '').strip()
        if lbl: print(f"          「{lbl}」")
PY
    return 1
  fi
}

wait_status() {  # <超时秒> <期望状态>
  local timeout=$1 want=$2 i=0 s
  while [ "$i" -lt "$timeout" ]; do
    sleep 5
    i=$((i + 5))
    dismiss_keyboard >/dev/null 2>&1
    s=$(status_line "$(read_status)")
    if [ -n "$want" ] && [ "$s" = "$want" ]; then
      echo "$i"
      return 0
    fi
    if [ -z "$want" ] && [ -n "$s" ] && [ "$s" != "已是最新" ]; then
      echo "$i"
      return 0
    fi
  done
  echo "$i"
  return 1
}

# ── 0. 前置条件 ─────────────────────────────────────────────────────────────

echo
echo "════ 0. 前置条件 ════"

if ! xcrun simctl list devices | grep -q "$UDID.*Booted"; then
  bad "模拟器 $UDID 没在启动状态"
  summary "$ACCEPT_NAME"
fi
ok "模拟器 $UDID 已启动"

# 🔴 **不需要 Simulator 进程、窗口、窗口矩形、也不需要在哪个 Space。**
#    idb 从设备内部读无障碍树 / 发点击，全都不依赖宿主的窗口系统。
#    这正是本次换路的目的：以前那套要求窗口在当前 Space，而"让它在当前 Space"
#    等于跟用户抢前台 —— 被明确禁止。
#
# 🔴 但必须**确认 idb 真的能读到 App**，不能只看"二进制存在"：
#    装上了 ≠ 能用。读不到就停在这里，并说清是本机环境问题还是产品问题。
idb_dump || { bad "idb 取不到无障碍树（companion 没连上？）"; summary "$ACCEPT_NAME"; }
if idb_has "任务"; then
  ok "idb 能从设备内部读到 App 界面（不需要窗口/Space/焦点）"
else
  bad "idb 读到的界面里没有「任务」—— App 可能没在前台，或装错了 target"
  summary "$ACCEPT_NAME"
fi

[ -f "$TOKEN_FILE" ] || { bad "缺 ${TOKEN_FILE}（访问令牌）"; summary "$ACCEPT_NAME"; }
[ -f "$E2EE_FILE" ] || { bad "缺 ${E2EE_FILE}（端到端加密口令）"; summary "$ACCEPT_NAME"; }
TOKEN=$(tr -d '\n' < "$TOKEN_FILE")
E2EE=$(tr -d '\n' < "$E2EE_FILE")
ok "凭据已读入（令牌 ${#TOKEN} 字符，口令 ${#E2EE} 字符）"

# LAN IP：不是 localhost 的私有地址。它的存在就是本验收的前提。
LAN_IP=${LAN_IP:-$(ipconfig getifaddr en0 2>/dev/null || true)}
[ -z "$LAN_IP" ] && LAN_IP=$(ipconfig getifaddr en1 2>/dev/null || true)
if [ -z "$LAN_IP" ]; then
  bad "拿不到本机 LAN IP（en0/en1 都没有地址）—— 本验收必须连非 localhost 的地址"
  summary "$ACCEPT_NAME"
fi
case "$LAN_IP" in
  127.*) bad "LAN IP 解析成了环回地址 ${LAN_IP}，本验收无效"; summary "$ACCEPT_NAME" ;;
esac
ok "本机 LAN IP = ${LAN_IP}（既不是 localhost，也不是 127.0.0.1）"

# 服务端必须真的从这个地址可达 —— **否则实验 B 失败会被误判成 ATS 拦截**。
if ! curl -s -m 5 -o /dev/null "http://$LAN_IP:$PORT/health"; then
  bad "服务端在 http://$LAN_IP:$PORT 上不可达（先解决这个，否则 B 的失败无法归因）"
  summary "$ACCEPT_NAME"
fi
ok "服务端在 http://$LAN_IP:$PORT 上可达（ATS 之外的因素已排除）"

# App 没在跑就自己拉起来 —— 让它成为一个手工前置只会让验收变得不可重复。
# ⚠️ 冷启动后 E2EE 口令必然不在内存里（下面第 1 步会重新填），所以这不会掩盖问题。
# 🔴 **每次都从冷启动开始。**
#
#    凭据只放内存（`apps/mobile/src/sync/config.ts`：口令落盘就等于作废"服务端看不到明文"
#    这个承诺），所以**冷启动 = 空字段**。而"上一轮跑完留下的脏字段"是真实会发生的：
#    实测第二次跑时，「访问令牌」里还留着上一轮的 `MYTOKEN123…`，而那会让令牌**失效**，
#    失败却在下游伪装成"网络不通"。
#    与其想办法清空字段（`set-value`/`key`/Cmd+A 实测**全都清不掉**），不如从干净状态开始。
xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
sleep 2
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1
sleep 12
if ! pgrep -f HeytaMobile >/dev/null 2>&1; then
  bad "HeytaMobile 启动失败（Bundle ID $BID 装在这台模拟器上了吗？）"
  summary "$ACCEPT_NAME"
fi
ok "HeytaMobile 已冷启动（凭据只在内存里，所以字段必然是空的）"

# ── 1. 进「我的」页并填齐凭据 ───────────────────────────────────────────────

echo
echo "════ 1. 填齐凭据（对照与实验都必须在同一套凭据下） ════"

goto_profile || { bad "没切到「我的」页（按了 ≠ 到了）"; summary "$ACCEPT_NAME"; }
# 🔴 这里**故意不检查"字段是不是空的"**。
#
#    试过，判不了：React Native 在字段为空时把**占位符塞进 AXValue**，
#    而 idb 的 `describe-all` **不导出单独的 placeholder 字段** ——
#    于是「空的令牌框」和「真的填了『登录服务端后获得』」在读回上**一模一样**。
#    （「端到端加密口令」没有占位符，所以它读回是干净的空串，两者行为还不一致。）
#
#    不去猜它，而是靠 `set_field` 的**读回核对**：字段若有旧值，
#    `ui text` 的插入语义会让结果 != 期望值，那时会连**实际读到的东西**一起报出来。
#    这比"先证明前提成立"更直接，也不会因为占位符文案改动而失效。

set_field "访问令牌" "$TOKEN" || { bad "「访问令牌」写入失败"; summary "$ACCEPT_NAME"; }
set_field "端到端加密口令" "$E2EE" --secure || { bad "「端到端加密口令」写入失败"; summary "$ACCEPT_NAME"; }
dismiss_keyboard
ok "令牌与口令已写入（口令框只存内存，重启应用后必须重填）"

# 填完凭据后「立即同步」应当可用 —— 它不可用的话后面的点击是**空点**，
# 而空点的失败会在下游伪装成"网络不通"，归因就全歪了。
#
# 🔴 判据用 **enabled 位**，不是"按钮在不在"：按钮一直在，只是按不动。
#    这是 idle 状态**机器可读**的唯一可靠信号（iOS 的 AXEnabled）。
idb_dump
ENABLED=$(idb_enabled "立即同步")
if [ "$ENABLED" != "true" ]; then
  bad "「立即同步」没启用（enabled='${ENABLED}'）—— 凭据可能没真的进去"
  echo "      当前两个输入框的值：令牌='$(idb_field_value "访问令牌" 2>/dev/null)' 口令长度=$(idb_field_value "端到端加密口令" 2>/dev/null | wc -c | tr -d ' ')" >&2
  summary "$ACCEPT_NAME"
fi
ok "「立即同步」已启用（enabled=true，凭据真的进去了）"

# ── 2. 两个对照组：都必须失败 ───────────────────────────────────────────────
#
# 🔴 **两个都要，一个都不能省** —— 它们排掉的是两种不同的"假绿"：
#   2a 错端口 → 排掉"应用忽略端口、偷偷用了 localhost:3000"
#   2b 错 IP   → 排掉"应用忽略主机、偷偷用了 127.0.0.1"
# 只有 2a 时，"应用其实一直在连 127.0.0.1" 这条假设**依然活着**，
# 而它会伪造出完全一样的绿。上一轮我正好漏了 2b，差点据此得出一个错结论。

BEFORE=$(read_status)
BEFORE_LAST=$(lastsync_line "$BEFORE")
[ -n "$BEFORE_LAST" ] || {
  bad "上一步之前在界面上读不到「上次成功同步」的值（键盘立着？见 §7 第 34 条）"
  summary "$ACCEPT_NAME"
}
echo "    对照前：上次成功同步=「${BEFORE_LAST}」"

# 2a) 对的主机、错的端口
echo
echo "════ 2a. 对照：$LAN_IP 的**错误端口** → 必须失败 ════"
trigger_sync "http://$LAN_IP:$((PORT + 7))" || { bad "无法触发同步（填写/点击失败）"; summary "$ACCEPT_NAME"; }
if T=$(wait_status 90 ""); then
  ok "错端口在 ${T}s 内进入失败态：「$(status_line "$(read_status)")」"
else
  bad "错端口居然没失败（90s 后仍为「$(status_line "$(read_status)")」）—— 对照不成立，后面的实验无法归因"
  summary "$ACCEPT_NAME"
fi

AFTER=$(read_status)
AFTER_LAST=$(lastsync_line "$AFTER")
if [ "$AFTER_LAST" = "$BEFORE_LAST" ]; then
  ok "失败没有刷新「上次成功同步」（仍为「${AFTER_LAST}」）—— 时间戳是承重判据"
else
  bad "失败路径居然刷新了「上次成功同步」（「${BEFORE_LAST}」→「${AFTER_LAST}」）—— 这个时间戳不可信"
  summary "$ACCEPT_NAME"
fi

# 2b) 错的主机、对的端口
#
# 挑一个**同网段但不存在**的私有地址：它走的是和真实地址一模一样的代码路径，
# 唯一区别就是主机。所以它必须失败 —— 一旦它成功，只能说明应用没用输入框里的主机。
echo
echo "════ 2b. 对照：$LAN_IP 之外的**另一个私有 IP**（同端口）→ 必须失败 ════"
echo "    （这一步排掉'应用忽略主机、其实一直在连 127.0.0.1'）"
DECOY_IP=$(python3 -c "a,b,c,_='$LAN_IP'.split('.'); print(f'{a}.{b}.{c}.99')")
echo "    诱饵地址：$DECOY_IP:${PORT}（本机地址是 $LAN_IP:${PORT}）"
if curl -s -m 3 -o /dev/null "http://$DECOY_IP:$PORT/health"; then
  bad "诱饵地址 $DECOY_IP:$PORT 竟然可达 —— 这台机器上真有这个地址，换一个诱饵再跑"
  summary "$ACCEPT_NAME"
fi
ok "诱饵地址 $DECOY_IP:$PORT 确实不可达（对照前提成立）"

trigger_sync "http://$DECOY_IP:$PORT" || { bad "无法触发同步（填写/点击失败）"; summary "$ACCEPT_NAME"; }
if T=$(wait_status 90 ""); then
  ok "错 IP 在 ${T}s 内进入失败态：「$(status_line "$(read_status)")」"
else
  bad "错 IP 居然成功了 —— **应用没有用输入框里的主机**，本验收的全部结论都不成立"
  summary "$ACCEPT_NAME"
fi

AFTER2=$(read_status)
AFTER2_LAST=$(lastsync_line "$AFTER2")
if [ "$AFTER2_LAST" = "$AFTER_LAST" ]; then
  ok "错 IP 也没有刷新「上次成功同步」（仍为「${AFTER2_LAST}」）"
else
  bad "错 IP 竟然刷新了「上次成功同步」（「${AFTER_LAST}」→「${AFTER2_LAST}」）"
  summary "$ACCEPT_NAME"
fi

# ── 3. 实验组：真实 LAN 地址 → 必须成功（这一条就是 ATS 的判据） ─────────────

echo
echo "════ 3. 实验：指向真实的 http://$LAN_IP:$PORT → 必须成功 ════"
echo "    🔴 这一步失败 = ATS 拦了私有 IP 字面量（ADR-0007 §6 的结论被推翻）"
echo "       或服务端/网络不可达 —— 两者必须靠服务端日志区分，脚本不替你猜"

# 🔴 「上次成功同步」显示的是**同步发生的时刻**，而且只到分钟。
#    所以"上一次成功"与"这一次成功"落在同一分钟时，那个显示值**永远不会变** ——
#    等多久都没用。断言"时间戳必须前进"因此会**随机变红**
#    （AGENTS §7 第 25 条：会随机失败的测试比没有测试更糟）。
#    刻意用一个**确定**的写法：等到当前分钟 != 上一次成功的分钟，再发起同步。
PREV_HM=$(printf '%s' "$AFTER_LAST" | sed -n 's/.* \([0-9][0-9]*:[0-9][0-9]\)$/\1/p')
if [ -n "$PREV_HM" ]; then
  WAITED=0
  while [ "$(date +%H:%M)" = "$PREV_HM" ] && [ "$WAITED" -lt 65 ]; do
    sleep 2
    WAITED=$((WAITED + 2))
  done
  echo "    等到新的分钟再同步（上次成功在 ${PREV_HM}，现在 $(date +%H:%M)，等了 ${WAITED}s）"
else
  echo "    ⚠️ 解析不出「${AFTER_LAST}」里的时刻，时间戳前进这条断言将不可靠"
fi

trigger_sync "http://$LAN_IP:$PORT" || { bad "无法触发同步（填写/点击失败）"; summary "$ACCEPT_NAME"; }
if T=$(wait_status 180 "已是最新"); then
  ok "真实 LAN 地址在 ${T}s 内同步成功：「已是最新」"
else
  bad "真实 LAN 地址 180s 内**没有**成功（当前状态「$(status_line "$(read_status)")」）"
  echo "        → 先看服务端有没有收到请求：没收到 = ATS 在客户端拦掉了；"
  echo "          收到了 = 问题在服务端/载荷，与 ATS 无关。"
  summary "$ACCEPT_NAME"
fi

FINAL=$(read_status)
FINAL_LAST=$(lastsync_line "$FINAL")
if [ "$FINAL_LAST" != "$AFTER_LAST" ]; then
  ok "「上次成功同步」前进了：「${AFTER_LAST}」→「${FINAL_LAST}」"
else
  bad "「上次成功同步」没前进（仍为「${FINAL_LAST}」）—— 状态文字可能是假的"
  summary "$ACCEPT_NAME"
fi

echo
echo "════ 结论 ════"
echo "  ✅ iOS 上的 heyta 能连**私有 IP 字面量**的明文 HTTP：$LAN_IP:$PORT 同步成功，"
echo "     而错端口（排掉忽略端口）与错 IP（排掉回落 127.0.0.1）都失败 —— 单变量对照成立。"
echo "  ℹ️ 归因：这**不是** ATS 放行的结果。把 NSAllowsLocalNetworking 关掉重装实测**照样成功**，"
echo "     所以私有 IP 字面量的明文 HTTP 本来就不受 ATS 拦（见脚本头部）。"
echo "  ⚠️ 本验收**没有**覆盖："
echo "     - 公网 IP / 普通域名 + 明文 HTTP（需要真实可达的公网服务端）"
echo "     - `.local` / link-local 主机名（NSAllowsLocalNetworking 真正管的可能就是这类，未验证）"
echo "     - 真机（只有模拟器）。不要外推。"

summary "$ACCEPT_NAME"
