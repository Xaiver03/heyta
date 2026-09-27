#!/bin/bash
#
# iOS 输入侧验收（真模拟器 + 真服务端 + 真笔记本设备，零 mock）
# ==================================================================
#
# 🔴 为什么必须有这个脚本
#
# 在它存在之前，iOS 被验证到的只有**输入侧以外**的一切：
# Release 构建、安装、启动、真图标、真中文、真 SQLite 建库、
# 以及"真实读取并物化别的设备传来的 op"。
#
# **没有任何一条断言碰过「在 iOS 界面上点一下、能写进一条任务」。**
# 这不是"少测一个用例"，而是整整一半的链路没有见证：
#
#   - FAB 点开 Composer 的那一下，走的是 RN 的 `Pressable` → `onPress` → `createTaskActions`；
#   - 输入框里的中文经 `TextInput` 回到 op 载荷；
#   - 「添加」按钮由灰变亮，取决于 RN 对 `disabled` 的渲染。
#
# 这一段里每一环的失效方式都是**静默**的：按钮看起来在、点下去没反应、
# 或者写进去了一条标题是空字符串的任务。而原来的验收对这三种情况一律报绿。
#
# ── 为什么以前做不到，以及现在凭什么能做到
#
# 做不到的原因不是"没写脚本"，是**三个工具层的问题叠在一起**：
#
#   1. **全局事件流点击会被上层窗口吃掉。** 目标窗口
#      `iPhone 17 Pro – iOS 26.5`（456x972 @ (636,43)）被另一个无关项目的
#      `Litopia-Gate-Duo-Final`（1696x992 @ (14,47)）整块盖住；屏幕上还叠着
#      七八个同样盖满屏幕的 Simulator 窗口，**没有一块空地能把窗口挪过去**。
#      `mac clickin` 的遮挡闸直接拒绝（`遮挡=BLOCK`）。
#   2. **AXRaise 掀不动它。** `perform action "AXRaise"`（含完整标题）返回成功；
#      把 Simulator 激活成前台 app 之后再 raise 也返回成功 —— 遮挡关系**不变**
#      （Xcode 27 的 Simulator 用 window set，菜单里就有 `Arrange in Front`、
#      `Remove Window from Set`）。**"工具返回成功"在这里是假的。**
#   3. **`mac type` 的 postToPid 投递不到模拟设备的输入框。** 它返回
#      `typed 9 chars`，但截图回读里 placeholder 还在、提交按钮仍是禁用色。
#      那条工具自己也写着"返回值不代表生效，必须回读"。
#
# 走通的办法是 `scripts/tools/axpress.swift`：iOS 模拟器把「模拟设备里那个 App」的
# 无障碍节点**桥接进了宿主的 AX 树**，所以那些按钮/输入框在宿主这边是**真实的
# AX 元素**，可以 `AXPress` / `AXSetValue`。这条路**不需要坐标、不需要 z-order、
# 不需要焦点**（实测在 Simulator 不是前台 app 时也能点开 Composer）。
#
# ── 证据分几级（这也是本脚本的断言顺序）
#
#   L1 控件被激活    「新建任务」的 AXPress 返回 success
#   L2 界面真的变了   Composer 出现（AX 树里多出一个文本控件）
#   L3 **状态指示器** 「添加」按钮 `AXEnabled` 由 false 变 true
#                    ← 这一级才证明**输入真的进了应用**，不是只进了 AX 属性
#   L4 副作用         本地 SQLite `ops` 表真的多一条 op，且标题逐字相符
#   L5 跨设备         按下「同步」后，**另一台设备**（node-host 笔记本）读到了它
#
# 🔴 L3 是本脚本最容易被省掉、但最不该省的一步。L1/L2 都可能被"控件激活了但
#    应用没理会"骗过；而「添加」按钮的启用态是 RN 根据输入内容算出来的 ——
#    它变亮，等于应用亲口说"我收到了这段文字"。
#
# 🔴 另一条必须记住的：**不要按 AX role 筛可点元素。** 同一个「添加」按钮的角色
#    会在 `AXButton` 与 `AXGenericElement` 之间变（同一台设备、同一个 Composer，
#    只是输入框里的内容不同），按 role 过滤会时灵时不灵，症状是"找不到按钮"，
#    看起来像界面没渲染出来。用 `--pressable`（该元素支持 AXPress 动作）才是稳的。
#
# ── 前置条件
#
#   - 模拟器已启动（默认 691C20D9-FB85-4B81-A3CC-0F5623AEF082，iPhone 17 Pro）
#   - 该模拟器上已装好 Release 版 HeytaMobile，且已配置好服务器地址与令牌
#   - 宿主机服务端在 127.0.0.1:3000，且 /tmp/heyta_mobile_{token,email,e2ee}.txt 存在
#   - Xcode 命令行工具（`swiftc`）—— 用于按需编译 AX 工具
#
# 可覆盖的环境变量：IOS_UDID / IOS_BID / IOS_DEVICE_NAME
#
set -u
. "$(dirname "$0")/lib/mobile-e2e.sh"

DEVICE_NAME=${IOS_DEVICE_NAME:-iPhone 17 Pro}
BID=${IOS_BID:-org.reactjs.native.example.HeytaMobile}

# 🔴 UDID 默认值是**陈旧**的陷阱：原来写死 691C20D9-FB85-4B81-A3CC-0F5623AEF082，
#    而这个 UDID 在本机**根本不存在** —— 不显式覆盖就指向一个不存在的设备，
#    症状是一堆莫名其妙的失败。
#    改成从当前 Booted 的设备里挑，并**优先挑名字对得上的**（本机同时跑着别的项目的模拟器）。
if [ -n "${IOS_UDID:-}" ]; then
  UDID="$IOS_UDID"
else
  UDID="$(xcrun simctl list devices 2>/dev/null | grep Booted | grep -F "$DEVICE_NAME" \
          | head -1 | sed -nE 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/p')"
  if [ -z "$UDID" ]; then
    UDID="$(xcrun simctl list devices 2>/dev/null | grep Booted \
            | head -1 | sed -nE 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/p')"
  fi
  if [ -z "$UDID" ]; then
    echo "   ❌ 没有任何已启动的模拟器，且没给 IOS_UDID。" >&2
    echo "      先起一个：xcrun simctl boot \"$DEVICE_NAME\"" >&2
    exit 1
  fi
fi
LAPTOP_DB=/tmp/heyta-ios-laptop.sqlite
# 标题带上时间戳：断言必须钉在**这一次**写的那条上，不能靠"列表里有这么一条"。
TITLE="iOS输入验收$(date +%m%d%H%M%S)"

# ── I/O 层：idb（**从设备内部**驱动），不再用宿主 AX ─────────────────────────
#
# 🔴 这里原先走的是 `tools/axpress.swift` + `Simulator.app` 窗口的宿主 AX 树。
#    那条路要求 **GUI 开着 + 窗口可见没被盖住**，而"把窗口拽到前台"是被明确叫停的
#    （等于跟用户抢前台）。所以它在当前环境下**不可能通过** —— 实测第 0 步就红在
#    「找不到 Simulator 进程」，而那个进程**根本不需要存在**。
#
#    改成 idb 之后有两点根本不同：
#      1. 不需要任何窗口，不需要 `pgrep -x Simulator`；
#      2. 坐标是**设备坐标**，**窗口遮挡再也不是问题**。
#
#    命令行契约保持不变（见 scripts/tools/ios-ax-shim.py 的文件头），
#    所以下面那十几个 `ax ...` 调用点一行都不用改。

IS_AX_SHIM="$(cd "$(dirname "$0")" && pwd)/tools/ios-ax-shim.py"

IDB_BIN=${IDB_BIN:-}
IDB_COMPANION=${IDB_COMPANION:-}
IDB_UDID="$UDID"

# 🔴🔴 **绝对不要 `export IDB_COMPANION`。**
#
# 实测：同一句 `idb --companion-path <二进制> ui describe-all`，
#   不 export          → 11774 字节，正常；
#   export IDB_COMPANION → **0 字节**，报
#     Failed to connect to companion at address
#       DomainSocketAddress(path='.../idb_companion'): [Errno 38] Socket operation on non-socket
#
# 原因在 idb 自己的源码里（`idb/cli/command_tree.py`）：
#     --companion       default=os.environ.get("IDB_COMPANION")   # "HOSTNAME:PORT 形式的连接地址"
#     --companion-path  ...                                       # ← 二进制路径，是**另一个** flag
#
# 也就是说 **`IDB_COMPANION` 是 `--companion`（socket 地址）的环境变量形式**，
# 不是 `--companion-path`。把**二进制路径**塞进去，idb 就会拿它当地址去连 → Errno 38。
#
# 这个坑的形状特别坏：报错说的是"连不上 companion"，于是排查方向会全跑到
# "companion 坏了 / 没起来 / 换路径" 上，而真相是**我们自己把参数喂串了**。
# 它也正是"同一命令手工绿、脚本红"的全部原因。
#
# 结论：`IDB_BIN` / `IDB_UDID` 可以 export（实测无害）；**`IDB_COMPANION` 不行**。
export IDB_BIN IDB_UDID

if ! resolve_idb; then
  echo "   ❌ 找不到 idb —— iOS 验收需要它来从设备内部驱动界面" >&2
  exit 1
fi

# ── 辅助 ────────────────────────────────────────────────────────────────────

ax() {
  python3 "$IS_AX_SHIM" "$@" \
    --udid "$UDID" --idb "$IDB_BIN" --companion "$IDB_COMPANION" --json
}

# 机器可读地拿一个字段。**不看退出码**：调用方自己断言 found / enabled 的值，
# 因为"命令跑成功了"和"界面真的到了那个状态"是两件事。
ax_json() { ax "$@"; }
jget() { printf '%s' "$1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$2',''))" 2>/dev/null; }

# 模拟器容器里的真 SQLite（不是内存态、不是 mock）
phone_db() { echo "$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)/Library/heyta.sqlite"; }

apps_count() { sqlite3 "$PHONE_DB" "SELECT COUNT(*) FROM ops;" 2>/dev/null | tr -d ' '; }

# 某条 op 的载荷字段。
# 🔴 op 的 id 在 **ix0_0**，不是 pk0 —— pk0 是数字主键（实测值形如 `2`、`1.0`）。
#    按 pk0 去查会查不到，于是 `json_extract` 全部返回空字符串，
#    症状是"四条断言同时说字段是空的"，看起来像 op 写坏了，其实只是查错了列。
op_payload() {  # <op_id> <字段名>
  sqlite3 "$PHONE_DB" \
    "SELECT json_extract(data,'\$.op.payload.$2') FROM ops WHERE ix0_0='$1';" 2>/dev/null
}

# 界面上是否列出了这条任务（RN 的无障碍标签，等价于 Android 的 content-desc）
ui_has_task() {  # <标题>
  local out; out=$(ax "打开任务：$1" --pressable --list --json)
  [ "$(jget "$out" found)" = "True" ]
}

# ── 0. 前置条件 ─────────────────────────────────────────────────────────────
step "0. 前置条件"

if xcrun simctl list devices 2>/dev/null | grep -q "$UDID.*Booted"; then
  ok "模拟器 $UDID 已启动"
else
  bad "模拟器 $UDID 未启动 —— 先 xcrun simctl boot $UDID"; summary "iOS 输入侧"
fi

# 🔴 这里原先查的是 `pgrep -x Simulator`（Simulator.app 这个 GUI）。
#    那是个**根本不需要存在**的东西：idb 从设备内部驱动，不需要任何窗口。
#    实测就是它让整个脚本在第 0 步红掉的 —— 一个"检查了不该检查的东西"的失败。
if [ -x "$IDB_BIN" ] && [ -x "$IDB_COMPANION" ]; then
  ok "idb 可用（设备内部驱动，不需要 Simulator.app 窗口）"
else
  bad "idb 不可用 —— iOS 验收需要它"; summary "iOS 输入侧"
fi

if [ ! -f "$IS_AX_SHIM" ]; then bad "缺少 $IS_AX_SHIM"; summary "iOS 输入侧"; fi

# ── companion 热启动 ────────────────────────────────────────────────────────
#
# 🔴 实测踩到：`idb ui describe-all` 返回**空**，stderr 是
#      Failed to connect to companion at address DomainSocketAddress(path='.../idb_companion'):
#      [Errno 38] Socket operation on non-socket
#    也就是 **companion 连接是坏的**（idb 把一个二进制路径当 socket 去连）。
#    这**不是** App 的问题，也**不是**时序问题 —— 但报出来的是"读不到 App 内容"，
#    方向会被整条带偏。
#
#    这里显式先连一次。连不上就**换另一个 companion 路径**再试
#    （`resolve_idb` 认识两个：~/.heyta-tools 和 ~/.local/share）。
# 🔴 判据是"**companion 有没有响应**"，**不是**"树里有没有 App"。
#    第一版 grep 的是 `"AXLabel"` —— 但这段跑在 `xcrun simctl launch` **之前**，
#    App 还没起来，describe-all 返回的是**主屏**（里面没有 AXLabel）。
#    于是 companion 明明是好的，却被判成"连不上" ——
#    一个把"App 没起"错报成"工具链坏了"的误诊，方向完全反了。
companion_ok() {
  local out
  out=$("$IDB_BIN" --companion-path "$1" ui describe-all --udid "$UDID" 2>/dev/null)
  # 只要有合法的 JSON 输出就算通（`[` 开头即可 —— 主屏、App、锁屏都是 JSON 数组）
  case "$out" in
    \[*\]) return 0 ;;
    *) return 1 ;;
  esac
}

# 🔴 先**保证 socket 在**。idb 自己不会拉 companion —— 它只连
#    `/tmp/idb/<UDID>_companion.sock`，没人起就是
#      Failed to connect to companion at address DomainSocketAddress(path='...sock'): [Errno 2]
#    而这一段的旧版只做"连得上吗"的判断，于是报出来的是"AX 桥不通"，
#    方向偏到 App 上（实测：整轮验收就卡在这儿）。
ensure_idb_companion || true

if companion_ok "$IDB_COMPANION"; then
  ok "idb companion 已连上（${IDB_COMPANION}）"
else
  ALT="$HOME/.local/share/idb-companion-1.6.2/idb_companion"
  if [ -x "$ALT" ] && companion_ok "$ALT"; then
    # 🔴 **不要 export。** `IDB_COMPANION` 是 `--companion`（**socket 地址**）的
    #    环境变量形式，而这里拿的是**二进制路径** —— 一旦 export，idb 就会把
    #    路径当地址去连，报 `[Errno 38] Socket operation on non-socket`，
    #    症状看起来像"companion 坏了"。详见上面那段长注释。
    #    shim 是通过**显式参数**拿到这个值的，不需要环境变量。
    IDB_COMPANION="$ALT"
    ok "换用备用 companion 成功（${IDB_COMPANION}）"
  else
    # ⚠️ 这里是**警告**而不是 `summary`/退出。理由：本判据本身还在被怀疑
    #    （见 §3.14）—— 它已经误诊过一次（把"App 没起"报成"companion 连不上"）。
    #    一个**判据本身没验干净**的检查，不该有权终止整轮验收。
    #    真正的判据仍然是下面那条"树里能不能读到 App 内容"。
    echo "      ⚠️ companion 自检未通过（试过 $IDB_COMPANION${ALT:+ 和 $ALT}）—— 继续跑，由后面的树检查定性"
    # ⚠️ 同样**不 export**（理由同上：这是二进制路径，不是 socket 地址）。
  fi
fi

# ⚠️ 这里**不能**查"树里有没有「任务」"：App 要到下面 `xcrun simctl launch` 之后才起来。
#    第一版把这条放在这儿，结果它跑在 App 之前 —— 红出来的话是"树拉不到"，
#    而真因只是**查得太早**。树能不能读，在第 1 步（App 起来并切回任务页之后）再验。

if curl -sf "$HOST_SERVER/health" >/dev/null 2>&1 || curl -sf "$HOST_SERVER/api/health" >/dev/null 2>&1; then
  ok "服务端在 $HOST_SERVER 上活着"
else
  bad "服务端 $HOST_SERVER 不可达 —— 跨设备那一步会假红，但没有它就不是零 mock"; summary "iOS 输入侧"
fi

PHONE_DB=$(phone_db)
if [ -f "$PHONE_DB" ]; then ok "手机真 SQLite：$PHONE_DB"; else bad "手机 SQLite 不存在（App 没装或没启动过）"; summary "iOS 输入侧"; fi

# 启动 App（**不 terminate**：会话内已派生过 Argon2 密钥，terminate 会白白再花 30–40 秒）
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1
sleep 5

# ── 1. AX 桥是否通 + App 是否在任务页 ───────────────────────────────────────
step "1. AX 桥与初始界面"

# 🔴 先切回「任务」标签，再做任何判断。"界面里有没有文本控件"这个判据**只在任务页成立** ——
#    「我的」页常驻三个输入框（服务器地址 / 访问令牌 / 端到端加密口令），拿它当
#    "Composer 开着"的证据会直接假红，而症状是"按了取消但面板还开着"，方向全偏。
#    同样地，上一次运行会把界面停在「我的」（同步那步切过去），不切回来 FAB 就查不到，
#    症状却是"AX 桥不通"。
ax "任务" --pressable --press --json >/dev/null 2>&1
sleep 2

# ── 1.0 无障碍树就绪：**先证明工具在说话，再判断界面** ──────────────────────
#
# 🔴 这一段是实测踩出来的，代价是整整一轮验收卡在第 1 步：
#
#   现象：报「在目标窗口里找不到「新建任务」按钮 —— AX 桥不通，或 App 不在任务页」，
#         而**截屏显示 App 好好地停在任务页、FAB 就在那儿**。
#
#   一路排掉的东西（**全都不是**原因）：
#     · companion 没起来？      —— describe-all 返回的是合法 JSON，连得上。
#     · companion 馊了？        —— 换新的也一样，而且主屏能读出 11 个 label。
#     · App 崩了？              —— 没崩（无崩溃报告），界面对点击有响应。
#     · 整树被无障碍隐藏？      —— 源码里没有那种写法（查过 accessibilityElementsHidden 等）。
#
#   真因：**模拟器跑久了（实测 13 小时），App 的无障碍注册会卡死** ——
#   App 在渲染、在响应，但对 AX 只暴露一个**零尺寸的 Application 节点**（label 数 0）。
#   **重启模拟器立刻恢复**：同一台设备、同一个 App，label 数 **0 → 42**。
#
#   所以判据是"**App 起来之后**树里有没有内容"，而不是"companion 连不连得上"。
#   ⚠️ 而"主屏有没有 label"**不能**当对照 —— 卡死期间主屏一直读得出 11 个 label。
# ⚠️ **必须轮询，不能"看一眼"。** 冷启动后 AX 树要几十秒才交出来：
#    实测同一次重启，第 15 秒采样到 **0**（于是报"仍是空的"——**假红**），
#    再等约 45 秒就是 **48**。一次采样会把"还没交出来"误判成"交不出来"。
#    （这正是本项目那条纪律的反面教材：假红比假绿更贵。）
ax_ready() {  # [最多等几秒，默认 20]
  local limit=${1:-20} waited=0 n
  while [ "$waited" -lt "$limit" ]; do
    n=$(idb_ax_label_count)
    if [ "${n:-0}" -gt 0 ] 2>/dev/null; then return 0; fi
    sleep 3; waited=$((waited + 3))
  done
  return 1
}

# 🔴 **变异缝**：这条路径（"模拟器无障碍卡死"）平时只有在模拟器**碰巧**卡死时才走得到，
#    也就是**永远没被验证过**。`HEYTA_IOS_FORCE_AX_EMPTY=1` 让计数在**头 N 秒**
#    （默认 30，`HEYTA_IOS_FORCE_AX_EMPTY_SECS` 可调）里返回 0，从而能随时复现它，
#    验证这条检查 (a) 真的会红、(b) 红完的自愈真的能修好。
#    用法： cd scripts && HEYTA_IOS_FORCE_AX_EMPTY=1 bash verify-mobile-ios.sh
#
#    🔴 写这个缝时踩的两个坑，都不是风格问题：
#
#    ① **必须按时长，不能"只变异一次"。** `ax_ready 20` 会**轮询**，只变异一次
#       会被它直接吸收掉（第 2 次就真了），**根本走不到自愈分支** ——
#       那样"变异跑绿了"什么也没证明。
#    ② **状态不能用变量记。** `n=$(idb_ax_label_count)` 是**命令替换**，赋值落在
#       **子 shell** 里，永远回不到父 shell；于是"只第一次为 0"会变成"**永远是 0**"，
#       看起来和"变异把工具弄坏了"一模一样（正是 §7 陷阱 58 的形状）。
#       这里用**时间戳**，不依赖任何跨进程状态。
if [ "${HEYTA_IOS_FORCE_AX_EMPTY:-}" = "1" ]; then
  _HEYTA_MUT_UNTIL=$(( $(date +%s) + ${HEYTA_IOS_FORCE_AX_EMPTY_SECS:-30} ))
  idb_ax_label_count() {
    if [ "$(date +%s)" -lt "$_HEYTA_MUT_UNTIL" ]; then echo 0; return 0; fi
    _idb_ax_count_raw
  }
  echo "      ⓜ 变异生效：HEYTA_IOS_FORCE_AX_EMPTY=1 —— 头 ${HEYTA_IOS_FORCE_AX_EMPTY_SECS:-30} 秒 label 计数恒为 0"
fi

if ! ax_ready 20; then
  echo "      ⚠️ App 在跑，但无障碍树是空的（label 数 0）——**模拟器的无障碍注册卡死了**，不是 App 的问题"
  echo "         证据：同一台设备重启前 label 数 0、重启后 42；这期间截屏里界面一直是好的"
  echo "         → 重启模拟器再试（约 30–60 秒）"
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1
  pkill -f "idb_companion --udid $UDID" 2>/dev/null
  rm -f "/tmp/idb/${UDID}_companion.sock"
  sleep 3
  xcrun simctl boot "$UDID" >/dev/null 2>&1
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1
  sleep 3
  ensure_idb_companion || true
  # ⚠️ 重启后 App 是**全新进程**，会话内的 E2EE 凭据没了 —— 下面还会重新填，
  #    代价是**再付一次约 50 秒的 Argon2id 派生**。这只在卡死这条路上发生。
  xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1
  sleep 10
  ax "任务" --pressable --press --json >/dev/null 2>&1
  sleep 2
  if ax_ready 90; then
    ok "模拟器重启后无障碍树恢复（label 数 $(idb_ax_label_count)）"
  else
    bad "模拟器重启后无障碍树仍是空的 —— **先怀疑工具链，别先怀疑产品**"
    echo "         对照：同一 companion 读主屏能不能拿到 label（能 → 说明是 App 侧的无障碍没交出来）"
    summary "iOS 输入侧"
  fi
else
  ok "无障碍树就绪（label 数 $(idb_ax_label_count)）"
fi

# 🔴 先分开"环境不通"和"产品不对"这两件事。
#    macOS 的 AX **只能看见当前 Space 上的窗口**；Simulator 窗口一旦不在当前 Space，
#    AX 树里就只剩菜单栏，后面每一条断言都会红 —— 而报出来的却是"按钮找不到"，
#    方向全偏到界面上。这里先单独确认一次，并说清是环境原因。
#    ⚠️ 本脚本**不会**用 `activate` 去把窗口拽到前台（那等于跟用户抢前台，已被明确叫停）。
# 🔴 这里原先调 `require_ax_visible`（验"Simulator 窗口在当前 Space"）—— 那是**宿主 AX
#    路线才有的约束**，idb 从设备内部读树，根本没有窗口。
#
# 🔴 也**不要**改成查「任务」—— 那是我第一版写的，**是个假绿**：
#    **tab bar 在任何页面都有「任务」**，所以"找到了「任务」"证明不了页面真的在任务页。
#    当时的表现是：这条绿了，紧接着的 FAB 检查却红 —— 一条会骗人的绿比没有更糟。
#
#    真正的判据是**下面那条 FAB 检查**（「新建任务」只存在于任务页），所以这里只作说明，
#    不再放一条自欺欺人的断言。

# Composer 的**唯一**可靠标记是「添加」按钮 —— 它只存在于新建面板里。
composer_open() { [ "$(jget "$(ax "添加" --pressable --list --json)" found)" = "True" ]; }

if composer_open; then
  echo "      ⚠️ 发现上次运行留下的 Composer，先按「取消」收起（这不是失败，是自愈）"
  ax "取消" --pressable --press --json >/dev/null 2>&1
  sleep 2
fi
if composer_open; then
  bad "按了「取消」Composer 仍然开着 —— 界面卡住了，后面的断言不可信"
  summary "iOS 输入侧"
fi
ok "初始状态干净：Composer 关着（没有「添加」按钮）"

# 🔴 这一条必须在**收掉 Composer 之后**才查。面板打开时「新建任务」同时是
#    底部的 FAB 和面板标题，先查就会匹配到标题（370x23），却打出一句
#    "任务页的按钮可见" —— 一个**误导性的绿**：它证明不了 FAB 存在。
# 🔴 兜底：切不回任务页时**先收软键盘重试**，最后才重启 App。
#
# ⚠️ **本节原来写的"产品的真实缺陷：内容层盖住了 tab bar"是错的（已证伪）。**
#    原文的三条观察是：idb 报 tap 成功、树里确有 `GenericElement '任务'`
#    frame=(0,776,100,64)、页面不切换，且"不是键盘遮挡（树里没有键盘）"。
#    前三条都是真的，第四条是**误判**，于是结论被写成产品缺陷。
#
#    实测（同一台设备、同一个 tab、同一份状态，A/B 只差键盘）：
#
#      | 键盘   | shim 判据                                          | 结果         |
#      |--------|----------------------------------------------------|--------------|
#      | 立着   | `tap-blocked-by-keyboard` (keyboardTop=539,cy=808)  | 仍停在「我的」|
#      | 收起   | `success`                                           | 切到任务页   |
#
#    键盘在 y=539..874，而 tab 中心 y=808 —— **那一下点在了键盘上**。
#    与「立即同步」那次（§3.18a）是**同一个**形状。
#
#    至于"树里没有键盘"：当时是用 `desc='q'/'shift'` 这类**标签**去猜的。
#    键盘的按键标签随语言/输入法变，而且这一步本来就在**上一次运行的收尾之后**，
#    那时键盘可能已经收起 —— 这条检查本身无论真假都推不出"不是键盘遮挡"。
#    （正确的结构性判据是 `KeyboardKey` trait + 贴边的候选/自动填充条，
#      已收进 `scripts/tools/ios-ax-shim.py` 的 `--keyboard`。）
#
#    所以**不重启 App**：重启的代价是凭据只存内存、要**再付一次 ~50 秒的 Argon2id 派生**，
#    而收一次键盘只要一次 tap。宁可少花一分钟，也不要为了绕开一个误诊去付这份钱。
FAB=$(ax "新建任务" --pressable --wait 10 --list --json)
if [ "$(jget "$FAB" found)" != "True" ]; then
  # 收键盘（点顶部空白处），再按一次「任务」tab。--pressable 会选中 tab 那个可点的
  # `GenericElement`，而不是页面标题里同名的 StaticText。
  ax --tap 200 150 >/dev/null 2>&1
  sleep 2
  ax "任务" --pressable --press --json >/dev/null 2>&1
  sleep 2
  FAB=$(ax "新建任务" --pressable --wait 10 --list --json)
  if [ "$(jget "$FAB" found)" = "True" ]; then
    # 这一条是**产品行为**的正面证据，不是"脚本自愈"：它证明 tab 栏本身是好的，
    # 挡住它的一直是软键盘。留着它，下次再有人怀疑"tab 坏了"时这里有反证。
    ok "收软键盘后「我的」→「任务」切换成功（tab 栏本身是好的，挡住它的是键盘）"
  fi
fi
if [ "$(jget "$FAB" found)" != "True" ]; then
  echo "      ⚠️ 收键盘重试后仍切不回任务页 —— 重启 App 兜底，会再付一次 Argon2id 派生"
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1
  sleep 2
  xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1
  sleep 8
  FAB=$(ax "新建任务" --pressable --wait 60 --list --json)
fi
if [ "$(jget "$FAB" found)" = "True" ]; then
  FW=$(jget "$FAB" width); FH=$(jget "$FAB" height)
  ok "AX 桥已通：任务页的「新建任务」按钮可见 @($(jget "$FAB" x),$(jget "$FAB" y)) 尺寸 ${FW}x${FH}"
  # 顺带钉住设计系统的触摸目标规则（≥44x44），以及它是方的（FAB 不是一行文字）
  if [ "$FW" -ge 44 ] && [ "$FH" -ge 44 ] && [ "$FW" = "$FH" ]; then
    ok "FAB 满足 44x44 触摸目标且为方形（${FW}x${FH}）"
  else
    bad "「新建任务」命中的不是 FAB（${FW}x${FH}）—— 可能是面板标题，后面的点击会打偏"
    summary "iOS 输入侧"
  fi
else
  bad "找不到「新建任务」按钮 —— 但无障碍树本身是好的（见 1.0），所以这**是产品侧**：Composer 收不掉，或 App 真的不在任务页"
  summary "iOS 输入侧"
fi

BEFORE_COUNT=$(apps_count)
ok "写入前 ops 行数 = $BEFORE_COUNT"

# ── 2. 点开 Composer（L1 + L2）──────────────────────────────────────────────
step "2. 点 FAB 打开 Composer"

PRESS=$(ax "新建任务" --pressable --press --json)
if [ "$(jget "$PRESS" result)" = "success" ]; then
  ok "AXPress「新建任务」→ success（L1 控件被激活）"
else
  bad "AXPress「新建任务」失败：$(jget "$PRESS" result)"
fi

FIELD=$(ax - --field --wait 10 --list --json)
if [ "$(jget "$FIELD" found)" = "True" ]; then
  ok "Composer 已出现：文本控件在 ($(jget "$FIELD" x),$(jget "$FIELD" y)) 尺寸 $(jget "$FIELD" width)x$(jget "$FIELD" height)（L2 界面真的变了）"
else
  bad "点了 FAB 但没有任何文本控件出现 —— Composer 没打开"
  summary "iOS 输入侧"
fi

# ── 3. 状态指示器：添加键的启用态（L3）──────────────────────────────────────
step "3. 「添加」按钮的启用态（这一级才证明输入进了应用）"

# 🔴 必须先**清空**输入框再做这个断言。实测「取消」不会清掉草稿：上一次运行
#    留在框里的文字会让「添加」一开始就是启用的，于是"空输入时应当禁用"这条
#    会假红 —— 而更危险的反向情况是它**假绿**：不清空就永远测不到禁用态。
ax - --field --set "" --json >/dev/null 2>&1
sleep 1

ADD_BEFORE=$(ax "添加" --pressable --wait 5 --list --json)
if [ "$(jget "$ADD_BEFORE" found)" != "True" ]; then
  bad "找不到「添加」按钮"; summary "iOS 输入侧"
fi
if [ "$(jget "$ADD_BEFORE" enabled)" = "False" ]; then
  ok "清空后「添加」enabled=false（禁用态）"
else
  bad "清空后「添加」却是 enabled=$(jget "$ADD_BEFORE" enabled) —— 状态指示器不可信，后面的断言都不成立"
  summary "iOS 输入侧"
fi

SET=$(ax - --field --set "$TITLE" --json)
if [ "$(jget "$SET" detail)" = "$TITLE" ]; then
  ok "AXSetValue 写入并回读成功：「${TITLE}」"
else
  bad "AXSetValue 回读不符：期望「${TITLE}」，实际「$(jget "$SET" detail)」"
fi

ADD_AFTER=$(ax "添加" --pressable --list --json)
if [ "$(jget "$ADD_AFTER" enabled)" = "True" ]; then
  ok "「添加」enabled 由 false → true（L3 应用亲口确认收到了这段文字）"
else
  bad "写入文字后「添加」仍是 disabled —— 文字只进了 AX 属性，没进应用"
  summary "iOS 输入侧"
fi

# ── 4. 提交（L4 副作用）────────────────────────────────────────────────────
step "4. 提交并核对 op-log"

# 🔴 与第 5 步同一条纪律：**看 result，不看"我调用了 tap"**。
#    实测踩到：这里原来是 `>/dev/null 2>&1` 加一句无条件的 ok，于是
#    "点击被键盘吞掉"和"提交成功"在报告里长得一模一样。
ADD_PRESS=$(ax "添加" --pressable --press)
case "$(jget "$ADD_PRESS" result)" in
  success) : ;;
  tap-blocked-by-keyboard)
    bad "「添加」被键盘挡住，点击**没有到达按钮**（keyboardTop=$(jget "$ADD_PRESS" keyboardTop), cy=$(jget "$ADD_PRESS" cy)）"
    ;;
  *) bad "按下「添加」失败：$(jget "$ADD_PRESS" result)" ;;
esac
sleep 3

if ! composer_open; then
  ok "Composer 已关闭（「添加」按钮消失）"
else
  bad "按了「添加」但 Composer 还开着"
fi

AFTER_COUNT=$(apps_count)
if [ "$AFTER_COUNT" = "$((BEFORE_COUNT + 1))" ]; then
  ok "手机真 SQLite 的 ops 行数 $BEFORE_COUNT → ${AFTER_COUNT}（**恰好**多一条，一个用户意图 = 一个 op）"
else
  bad "ops 行数 $BEFORE_COUNT → ${AFTER_COUNT}，期望恰好 +1"
fi

OP_ID=$(sqlite3 "$PHONE_DB" "SELECT ix0_0 FROM ops WHERE json_extract(data,'\$.op.payload.title')='$TITLE';" 2>/dev/null | head -1)
if [ -n "$OP_ID" ]; then
  ok "在 ops 里按标题找到了这条 op：$OP_ID"
else
  bad "ops 里没有任何 op 的 payload.title 等于「${TITLE}」"; summary "iOS 输入侧"
fi

OP_TYPE=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.opType') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
ACTION=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.actionType') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
ETYPE=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.entityType') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
CLIENT=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.clientId') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
VCLOCK=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.vectorClock') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
USTATUS=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.uploadStatus') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)

[ "$OP_TYPE" = "CRT" ]      && ok "opType=CRT（不是自造的 CREATE）"        || bad "opType=${OP_TYPE}，期望 CRT"
[ "$ACTION" = "CRT_TASK" ]  && ok "actionType=CRT_TASK"                  || bad "actionType=${ACTION}，期望 CRT_TASK"
[ "$ETYPE" = "TASK" ]       && ok "entityType=TASK"                      || bad "entityType=${ETYPE}，期望 TASK"

# 🔴 第 7 条陷阱：向量时钟必须**包含本次写入自己的递增**。写成"写入前的时钟"
#    会让对端判 EQUAL（"已见过"）→ 静默丢弃。这条断言专门盯它。
if printf '%s' "$VCLOCK" | python3 -c "
import json,sys
c=json.load(sys.stdin); cid='$CLIENT'
sys.exit(0 if c.get(cid,0)>=1 else 1)
" 2>/dev/null; then
  ok "向量时钟包含自己的递增：$VCLOCK"
else
  bad "向量时钟里没有自己 clientId（${CLIENT}）的递增：$VCLOCK —— 对端会静默丢弃这条 op"
fi

if ui_has_task "$TITLE"; then
  ok "iOS 界面上列出了「${TITLE}」（无障碍标签可读）"
else
  bad "iOS 界面上找不到「${TITLE}」"
fi

# ── 5. 跨设备（L5）────────────────────────────────────────────────────────
step "5. 按下「同步」，让另一台设备读到它"

# 🔴 任务页头部那个「同步」按钮**不是网络同步**。实测
#    `TasksScreen.tsx:483` 它的 onPress 是 `refresh`，即 `listTasks()` ——
#    本地重读物化状态。真正的网络同步在「我的」页的「立即同步」
#    （`ProfileScreen.tsx` → `onSync` → `writeSyncConfig` + `syncNow`）。
#    我先按了任务页那个，结果等了 300 秒、op 一条都没上去，而按钮的标签写着「同步」。
#    **按标签猜行为 —— 这是"看名字"而不是"看接线"，和 §7 那些坑同形。**
ax "我的" --pressable --press --json >/dev/null 2>&1
sleep 3

# 「服务器地址」/「访问令牌」/「端到端加密口令」的 desc 就是它们的 label
set_field() {  # <label> <值> [--secure]
  local out; out=$(ax "$1" --role AXTextField --set "$2" --json)
  local back; back=$(jget "$out" detail)
  if [ "${3:-}" = "--secure" ]; then
    # 🔴 `secure` 输入框的 AX 回读是**掩码**（一串 •），永远不等于原文。
    #    按逐字比较会报"填写失败"，而它其实成功了 —— 提示词是"回读不符"，
    #    方向会被带到"AX 写不进 secure 框"上去。
    #
    # 🔴 也**不要**用 `grep -q '^••*$'` 去认这串掩码：脚本没有 UTF-8 locale 时
    #    `•` 按 3 个字节处理，`*` 只绑定到**最后一个字节**，于是 20 个掩码匹配不上
    #    —— 症状和"写不进去"一模一样。能不能读到原文本身不是我们该断言的事
    #    （掩码是**对的**），能断言的是"它非空"。
    if [ "${#back}" -ge 8 ]; then
      ok "已填写「$1」（secure 框回读为掩码，长度 ${#back}）"
    else
      bad "填写「$1」失败，回读=「${back}」"
    fi
  elif [ "$back" = "$2" ]; then
    ok "已填写「$1」"
  else
    bad "填写「$1」失败，回读=「${back}」"
  fi
}
set_field "服务器地址" "$HOST_SERVER"
set_field "访问令牌" "$TOKEN"
set_field "端到端加密口令" "$E2EE" --secure

# ── 收键盘：**必须先收**，否则下面点的不是按钮 ────────────────────────────
#
# 🔴 真实事故（iPhone 17 Pro 模拟器 / iOS 26.5）：
#    三个输入框填完之后软键盘是**弹着的**，而「立即同步」按钮的中心 (201,589)
#    正好被键盘盖住 —— 键盘首行 y=590，其上还有 AutoFill「Passwords」条
#    539..583。那次 tap 落在了键盘上，**同步一次都没跑**。
#    而当时 shim 报的是 `result=success`（tap 这个系统调用确实成功了），
#    服务端则一条 Upload 都收不到 —— 于是"iOS 只拉不推"这个**假根因**
#    被写进了文档，还按它排查了整整一轮。
#
#    现在 shim 会显式判定遮挡并报 `tap-blocked-by-keyboard`（结构性判据：
#    键盘按键节点带 `KeyboardKey` trait，不靠标签猜），这里负责把它收掉。
#    教训与 §7 那些坑同形：**"命令成功" ≠ "点到了那个元素"**。
for _ in 1 2 3; do
  if [ "$(jget "$(ax --keyboard)" present)" != "True" ]; then break; fi
  # 点页面标题区（非输入控件）—— RN 的 ScrollView 会把键盘收起来。
  ax --tap 200 150 >/dev/null 2>&1
  sleep 1
done
if [ "$(jget "$(ax --keyboard)" present)" = "True" ]; then
  bad "软键盘收不起来 —— 下面的「立即同步」会点到键盘上（这一条曾造成一整轮假红）"
else
  ok "软键盘已收起（否则「立即同步」的点击会被键盘吞掉）"
fi

SYNC_BTN=$(ax "立即同步" --pressable --wait 5 --list --json)
if [ "$(jget "$SYNC_BTN" found)" = "True" ]; then
  ok "找到「立即同步」按钮 @($(jget "$SYNC_BTN" x),$(jget "$SYNC_BTN" y))"
  if [ "$(jget "$SYNC_BTN" enabled)" = "True" ]; then
    ok "凭据填齐后「立即同步」已启用"
  else
    bad "凭据填齐了但「立即同步」仍是禁用 —— 字段没真的写进活配置"
  fi
  # 🔴 按下之后必须看 **result**，不能只"按下就算成功"。
  #    这一条以前是 `>/dev/null 2>&1` 加一句无条件的 ok —— 那正是上面那轮
  #    假红的入口：点击被键盘吞掉，脚本却报"已按下"。
  SYNC_PRESS=$(ax "立即同步" --pressable --press)
  case "$(jget "$SYNC_PRESS" result)" in
    success)
      ok "已按下「立即同步」（Hermes 无 WebAssembly，纯 JS Argon2id 首次派生实测约 50 秒）"
      ;;
    tap-blocked-by-keyboard)
      bad "「立即同步」被键盘挡住，点击**没有到达按钮**（keyboardTop=$(jget "$SYNC_PRESS" keyboardTop), cy=$(jget "$SYNC_PRESS" cy)）"
      ;;
    *)
      bad "按下「立即同步」失败：$(jget "$SYNC_PRESS" result)"
      ;;
  esac
else
  bad "找不到「立即同步」按钮 —— 无法验证跨设备"
  summary "iOS 输入侧"
fi

# 轮询笔记本：每次 sync 在 V8 上只花约 0.6 秒派生密钥，比轮询手机界面便宜得多
#
# 🔴 退出码必须分开处理：2 = **探针自己坏了**，不是产品缺陷。
#    实测过一整轮：`$NODE` 解析成封装运行时的私有垫片，`laptop sync` 静默失败，
#    300 秒里服务端**一条请求都没收到**，而报告写的是"笔记本 300 秒内没读到"
#    —— 排查方向被整体带到同步协议上。**把"探针坏了"报成"对端没有"，是最贵的假红。**
ROUND=$(wait_laptop_has "$TITLE" 60); WAIT_RC=$?
case "$WAIT_RC" in
  0)
    ok "笔记本（node-host 真 SQLite）在第 $ROUND 轮读到了「${TITLE}」→ iOS → 服务端 → 另一台设备，全链路无 mock"
    ;;
  2)
    bad "笔记本探针**自己**坏了（不是产品问题，不会算作同步失败）：$ROUND"
    ;;
  *)
    bad "笔记本 300 秒内没读到「${TITLE}」"
    ;;
esac

# ── 本地队列的状态：**必须离开队列**（ADR-0019 之后这是真断言）──────────
#
# 🔴 这里原本断言"上传后 uploadStatus 应从 pending 变成 uploaded"。**那个断言是错的，
#    而且错得有价值** —— 它逼出了一个真实的 P0：
#
#     实测（iPhone 17 Pro 模拟器，服务端 127.0.0.1:3000）：
#       应用自己的「状态」区写着「同步失败」，任务页角标是 5，而
#       **跨设备那一路是通的**（笔记本读到了这条任务）。AX 树里应用的原始报错：
#
#         服务端拒绝了 5/5 条 op：
#           other-device-x-…-1     INVALID_CLIENT_ID（不是本机 clientId）
#           muhmhxil-…-1/-2/-3/-4  DUPLICATE_OPERATION（服务端早已有这 4 条）
#
#     `packages/sync-client/src/client.ts` 在发现硬拒绝时**直接 throw**，而这个 throw
#     发生在 `markUploaded(...)` 与 `setLastServerSeq(...)` **之前**。后果是一条链：
#
#       同批里已被服务端接受的 op 永远不落"已上传"
#         → 下次同步重传整批 → 变成 DUPLICATE_OPERATION → 继续 throw
#         → **这台设备的同步被永久卡死**（数据在云上没丢，但它再也同步不动了）
#
#     也就是说：**一条坏 op 就能废掉一台设备的同步，而且它自愈不了。**
#     与被拒的 op 同类的东西本仓库已经处理过两次（第 8、12 条），
#     但 `DUPLICATE_OPERATION` 被当成了致命错误，而它的真实含义是
#     "服务端已经有了" —— 那正是上传想要的结果。
#
#    ✅ **已修（ADR-0019，2026-09-27）**。原话说"需要独立的复现用例与 ADR"，
#       现在两样都有了：`pnpm verify:sync-recovery` 是零 mock 复现用例，
#       `docs/adr/0019-upload-rejection-does-not-block-download.md` 是那份 ADR。
#
#       修法：① 上传的失败**永不**阻断下载（原来那个 throw 在 `download()` **之前**，
#       于是一条过不去的 op 升级成"这台设备失去下载能力"）；② 永久拒绝的 op
#       走 `markRejected` **移出队列**，状态是第三种 `rejected` —— **不是** `uploaded`
#       （并进去等于说"它在云上"，而服务端刚拒绝了它）。
#
#       ⚠️ 因此下面**恢复断言**：好 op 必须离开待上传队列。
UPLOADED=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.uploadStatus') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
# 🔴 ADR-0019 之后这是一条**真断言**（原先因为那个缺陷只能"只观察、不断言成功"）：
#    好 op 必须离开待上传队列。还停在 pending，说明那条"上传失败挡住下载"的链又回来了。
if [ "$UPLOADED" = "uploaded" ]; then
  ok "uploadStatus $USTATUS → uploaded（本地队列已确认上传）"
else
  bad "uploadStatus 仍是「${UPLOADED}」—— 好 op 没有离开待上传队列（ADR-0019 的链又回来了）"
fi

# ── 6. 🔴 自动同步（iOS 侧）：**不点任何同步按钮**，写入也必须自己出去 ──────
#
# 为什么必须单独验：
#   第 4 步确实建了任务、第 5 步确实让它跨了设备 —— 但第 5 步是**点了
#   「立即同步」**才出去的。所以"同步能跨设备"一直是绿的，而
#   **"不点按钮它会不会自己出去"这个问句从来没被问过**。
#   Android 侧就是这么整整漏掉自动同步的（AGENTS §7 第 66 条）：
#   每一条验收都点了那个按钮，于是"**按钮**有效"被当成了"**链路**有效"。
#
# 为什么不能用第 4 步那条任务来验：
#   凭据是到第 5 步才填的，而**写入信号在第 4 步就发出了** ——
#   那一刻 `ready()` 还不成立（它要求地址与令牌同时具备）。
#   ⚠️ 而且**不能**为了这条去加"凭据刚配好就同步"这个触发点：
#   `verify-mobile-conflict.sh` 的首次同步断言是"点按钮 → 等结算"，
#   加了那个触发点会让它**恒真**（一条不可能失败的检查）。
#   所以这里在**凭据配好之后**再写一条。
step "6. 自动同步：凭据配好后再写一条，**一下都不点**，它必须自己出去"

SERVER_LOG="${HEYTA_SERVER_LOG:-/tmp/heyta-e2e-server.log}"
LOG_BASE=$(wc -l < "$SERVER_LOG" 2>/dev/null | tr -d ' ')
LOG_BASE=${LOG_BASE:-0}
TITLE2="ios-autosync-$(date +%H%M%S)"
# 🔴 `$VAR` 后面紧跟全角字符时必须加花括号 —— 见 AGENTS §7 第 69 条。
#    bash 3.2 + UTF-8 locale 会把 `（` 的首字节并进变量名，报
#    `TITLE2\xef: unbound variable`，而**同一行在没有 LANG 时完全正常**。
echo "     第二条任务：${TITLE2}（服务端日志基线行 = ${LOG_BASE}）"

# 回「任务」页，然后走与第 2/3/4 步**完全相同**的路径：FAB → 输入 → 添加
ax "任务" --pressable --press --json >/dev/null 2>&1
sleep 3
FAB2=$(ax "新建任务" --pressable --press --json)
if [ "$(jget "$FAB2" result)" = "success" ]; then
  ok "再次打开 Composer"
else
  bad "打不开 Composer：$(jget "$FAB2" result)"
fi
FIELD2=$(ax - --field --wait 10 --list --json)
if [ "$(jget "$FIELD2" found)" = "True" ]; then
  ax - --field --set "$TITLE2" --json >/dev/null 2>&1
  sleep 1
  ADD2=$(ax "添加" --pressable --press)
  case "$(jget "$ADD2" result)" in
    success) ok "第二条任务已提交：$TITLE2" ;;
    tap-blocked-by-keyboard) bad "「添加」被键盘挡住，第二条没提交" ;;
    *) bad "提交第二条失败：$(jget "$ADD2" result)" ;;
  esac
else
  bad "Composer 没出现（没有文本控件）"
fi

# 判据 (a)：**服务端自己收到了 Upload** —— 我们一下都没点。
# 🔴 只数 `[user:N] Upload` 行，绝不数 `wc -l`：服务端日志里全是
#    `prisma:query` 噪音，任何一次数据库活动都会看起来像"同步发生了"。
UPLOAD_SEEN=0
for _i in $(seq 1 24); do
  sleep 5
  _n=$(sed -n "$((LOG_BASE + 1)),\$p" "$SERVER_LOG" 2>/dev/null | grep -cE '\[user:[0-9]+\] Upload')
  if [ "${_n:-0}" -ge 1 ]; then UPLOAD_SEEN=$_i; break; fi
done
if [ "$UPLOAD_SEEN" -ge 1 ]; then
  ok "服务端在第 $UPLOAD_SEEN 轮（约 $((UPLOAD_SEEN * 5)) 秒）收到 Upload —— **全程没点过任何同步按钮**"
else
  bad "120 秒内服务端一条 Upload 都没有 —— 写入没有自动同步出去"
fi

# 判据 (b)：另一台设备真的读得到（把"上传了"补成"全链路")
ROUND2=$(wait_laptop_has "$TITLE2" 30); WAIT_RC2=$?
case "$WAIT_RC2" in
  0) ok "笔记本（node-host 真 SQLite）在第 $ROUND2 轮读到了「${TITLE2}」—— 没点按钮也走完了全链路" ;;
  2) bad "笔记本探针**自己**坏了（不是产品问题，不算同步失败）：$ROUND2" ;;
  *) bad "笔记本 150 秒内没读到第二条「${TITLE2}」" ;;
esac

summary "iOS 输入侧"
