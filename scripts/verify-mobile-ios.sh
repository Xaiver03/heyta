#!/bin/bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份脚本拷成同目录隐藏快照再 exec 副本 —— 之后对源文件的任何
#    编辑都影响不到本次运行；$0 的 dirname 不变，lib/tools 定位照旧。
#    快照名 .原名.snap.PID（进 .gitignore）；trap 尽力清理，被 kill -9 留下的
#    由下一次运行按 mmin +240 顺带扫掉。
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
#   - 该模拟器上已装好 Release 版 Heyta，且已配置好服务器地址与令牌
#   - 宿主机服务端在 127.0.0.1:3000，且 /tmp/heyta_mobile_{token,email,e2ee}.txt 存在
#   - Xcode 命令行工具（`swiftc`）—— 用于按需编译 AX 工具
#
# 可覆盖的环境变量：IOS_UDID / IOS_BID / IOS_DEVICE_NAME
#
set -u
. "$(dirname "$0")/lib/mobile-e2e.sh"

DEVICE_NAME=${IOS_DEVICE_NAME:-iPhone 17 Pro}
BID=${IOS_BID:-com.heyta}

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

# 🔴🔴 **关掉 iOS 的「保存密码？」系统弹窗 —— 它会盖住整个页面。**
#
# 实测（2026-09-29，第 36 轮，**截图才看出来**）：在 `secure` 输入框里填过字之后，
# iOS 会弹一个系统对话框：
#
#     保存密码？
#     安全储存密码，以便下次需要时自动填充。
#     [以后]  [保存]
#
# 它的两个后果**没有任何一个会在日志里留下痕迹**：
#   1. 它**盖住整个页面** —— 包括「粘贴邮件里的链接或令牌」那个字段，
#      于是按坐标写的 `set-value` 报 `found no element at (201.0, 1018.0)`；
#   2. 它让 **AX 树只剩 `AXApplication` 一个节点** —— 所有查询都 `found: False`，
#      看起来像"AX 桥断了"或"页面没渲染"。
#
# ⇒ 这一条同时解释了本轮追了很久的三件事：**字段够不到、树偶尔全空、以及它为什么时红时绿**
#   （弹窗只在"填过 secure 字段 + 系统决定要问"时出现）。
#   ⚠️ 而它**不在**应用的无障碍树里 —— 它是**系统**对话框，只能按标签去点。
dismiss_ios_save_password() {
  local _l _r
  # 先按标签试（万一它哪天进了应用树）
  for _l in "以后" "Not Now" "Later" "以后再说"; do
    _r=$(ax "$_l" --pressable --list --json)
    if [ "$(jget "$_r" found)" = "True" ]; then
      ax "$_l" --pressable --press --json >/dev/null 2>&1
      sleep 1.5
      ok "已关掉 iOS「保存密码？」系统弹窗（标签命中）"
      return 0
    fi
  done
  # 🔴 **按标签找不到是正常的 —— 它是系统对话框，不在应用的无障碍树里。**
  #    判据用"树是不是只剩 Application"来认它（那是它的**结构性指纹**），
  #    然后**按坐标点「以后」**。
  #
  #    实测（2026-09-29，第 37 轮）：坐标点 `(125, 537)` 之后，
  #    `describe-all` 的 label 数从 **1 → 70** —— 这就是它有效的证据。
  #
  #    ⚠️ 坐标来自截图量取（设备 402×874；「以后」约在 x=31%、y=61.5%）。
  #       它是**系统**弹窗的布局，不由我们的代码决定，所以只能这样锚。
  # 🔴🔴 **守卫不能用「注册 / 登录」当"没有弹窗"的证据 —— 那个标签可能就是当前页的标题！**
  #
  # 实测（2026-09-29，第 42 轮）：认证页的**页面标题**正是「注册 / 登录」，
  # 于是这个守卫在"弹窗盖着"的时候**照样认为没有弹窗** ⇒
  # **弹窗从来没被关掉** ⇒ 之后整棵树只剩 `AXApplication` ⇒ 所有查询 `found=False`。
  # 而症状看起来是"按了「我的」没反应""三个框不在树上"——**方向被整体带偏**。
  #
  # ⇒ 判据改成"**两个只在真实页面上才有的标签都不在**"：
  #   · 「任务」是底部标签（主界面必有）；
  #   · 「我的」也是底部标签（**连认证页上都还在**，因为标签栏画在它下面）。
  #   弹窗态下这两个**都不在**。
  local _t _m
  # 🔴 **先收软键盘再看树**（2026-10-02 第 6 轮实测）：键盘弹着时被它盖住的
  #    元素（含底部标签）会从树上消失 —— "任务/我的都不在"的判据会把
  #    **键盘态**误判成**弹窗态**，然后按一组写死坐标乱点，把软键盘又敲出来，
  #    之后一连串字段写入全部误报。先收键盘，两个底部标签就该回来。
  ax --dismiss-keyboard --json >/dev/null 2>&1 || true
  _t=$(jget "$(ax "任务" --list --json)" found)
  _m=$(jget "$(ax "我的" --list --json)" found)
  if [ "$_t" != "True" ] && [ "$_m" != "True" ]; then
    if true; then
      # 两个底部标签都不在 ⇒ 树是退化的 ⇒ 几乎可以断定是它盖着。
      _IW=$(xcrun simctl io "$UDID" screenshot /tmp/_heyta-save-pw.png >/dev/null 2>&1; echo ok)
      # 🔴 坐标**必须从本机屏幕尺寸推**：旧版写死 402×874 的 31%/61.5%，
      #    折叠屏 Duo（466×678）上那一下点进了页面控件。它是**系统**弹窗的
      #    布局，不由我们的代码决定，所以只能按比例锚 —— 但比例要乘自己的屏。
      local _app _aw _ah
      _app=$(ax - --list --json 2>/dev/null)
      _aw=$(jget "$_app" width); _ah=$(jget "$_app" height)
      case "${_aw}" in ''|*[!0-9]*) _aw=402 ;; esac
      case "${_ah}" in ''|*[!0-9]*) _ah=874 ;; esac
      local _sx _sy
      _sx=$(python3 -c "print(int(${_aw}*0.31))" 2>/dev/null || echo 125)
      _sy=$(python3 -c "print(int(${_ah}*0.615))" 2>/dev/null || echo 537)
      "$IDB_BIN" --companion-path "$IDB_COMPANION" ui tap "$_sx" "$_sy" --udid "$UDID" >/dev/null 2>&1
      sleep 1.5
      if [ "$(jget "$(ax "任务" --list --json)" found)" = "True" ] || [ "$(jget "$(ax "注册 / 登录" --list --json)" found)" = "True" ]; then
        ok "已按坐标关掉 iOS「保存密码？」系统弹窗（它不在应用树里，只能按坐标点）"
        return 0
      fi
    fi
  fi
  return 1
}

# 🔴🔴 **按一下，然后回读"它到底生效了没有"。**
#
# 这是本仓那条最贵的教训（**"工具返回成功不等于生效"**）在**夹具自己**身上的应用：
# `ax <label> --press` 返回 `result=success` 只说明**系统调用成功了**，
# 不代表那个控件收到了事件。
#
# 实测（2026-09-29，第 41 轮）这一条**反复咬人**，而且每轮咬在不同地方：
#   · composer：press 走 `success` 分支，而面板**还开着**；
#   · 认证页：`ax "返回"` 调用过，而**页面没切回去**；
#   · 欢迎页：`ax "先离线使用"` 调用过，而 app **还停在欢迎页**（第 1 步的 `label 数 6`）。
#
# ⇒ 判据必须是**外部的、结构性的**：**点完之后，另一件事真的发生了吗。**
#   （`AGENTS §7` 的 `tap-blocked-by-keyboard` 就是这种 —— 它查键盘按键的
#   `KeyboardKey` trait，所以可信；"按坐标点没反应"此前**没有**结构性判据。）
#
# 用法：`press_until <要按的> <应出现的> [尝试次数]`
#   返回 0 = 回读到了；1 = 试满仍未生效（**调用方据此判"夹具不可信"**）
press_until() {
  local do_lbl="$1" want_lbl="$2" tries="${3:-3}" i
  for i in $(seq 1 "${tries}"); do
    if [ "$(jget "$(ax "${want_lbl}" --list --json)" found)" = "True" ]; then return 0; fi
    ax "${do_lbl}" --pressable --press --json >/dev/null 2>&1
    sleep 2
  done
  if [ "$(jget "$(ax "${want_lbl}" --list --json)" found)" = "True" ]; then return 0; fi
  return 1
}

# 🔴🔴 **"它消失了吗" —— 比"某样东西出现了吗"更可靠。**
#
# 实测（2026-09-29，第 41 轮）：`press_until "先离线使用" "任务"` 给出了**假绿** ——
# 因为它一进来就 `found("任务") = True`：**欢迎页背后就是底部标签栏**，
# 于是**它一次都没按**就返回成功，app 还停在欢迎页（第 1 步只看到 6 个 label）。
#
# ⚠️ 这正是本仓反复出现的那类错：**判据的条件在动作之前就已经成立**。
# ⇒ 对"离开某个屏"这种动作，判据必须是"**那个屏的标志消失了**"。
press_until_gone() {  # <要按的> <应消失的> [尝试次数]
  local do_lbl="$1" gone_lbl="$2" tries="${3:-3}" i
  for i in $(seq 1 "${tries}"); do
    if [ "$(jget "$(ax "${gone_lbl}" --list --json)" found)" != "True" ]; then return 0; fi
    ax "${do_lbl}" --pressable --press --json >/dev/null 2>&1
    sleep 2
  done
  if [ "$(jget "$(ax "${gone_lbl}" --list --json)" found)" != "True" ]; then return 0; fi
  return 1
}

# 🔴 **滚动只活在 shim 里**（`scripts/tools/ios-ax-shim.py` 的
#    `--scroll-into-view`）—— 这里**不再保留第二份 bash 实现**。
#
#    为什么删掉：本文件曾有一份 `scroll_into_view()`，它的 swipe 起点
#    `屏高-60` 在折叠屏 Duo（逻辑屏 678）上正好落在**底部标签栏里**
#    （tab 行 y=580..644）—— 第 5 轮验收它一挥手就把认证页切到了「专注」，
#    四个凭据字段随之从树上消失、全部被"不在树上就跳过"吞掉。
#    滚动需要"从树里找死区起点 + 按方向分段拖拽 + 每步复测"，这是
#    结构逻辑不是一两行 shell —— 与其留两份会漂移的实现，不如只有一份。
#    同一轮在 shim 里另两个实测结论：`--duration` 的单位是**秒**
#    （300 = 三百秒的慢动作，这才是"挂死只挪 30px"的真因）；
#    `--duration 1.0` = 直接操纵，滚多少就是拖多少，无惯性过冲。


# 模拟器容器里的真 SQLite（不是内存态、不是 mock）
phone_db() { echo "$(xcrun simctl get_app_container "$UDID" "${BID}" data 2>/dev/null)/Library/heyta.sqlite"; }

apps_count() { sqlite3 "${PHONE_DB}" "SELECT COUNT(*) FROM ops;" 2>/dev/null | tr -d ' '; }

# 某条 op 的载荷字段。
# 🔴 op 的 id 在 **ix0_0**，不是 pk0 —— pk0 是数字主键（实测值形如 `2`、`1.0`）。
#    按 pk0 去查会查不到，于是 `json_extract` 全部返回空字符串，
#    症状是"四条断言同时说字段是空的"，看起来像 op 写坏了，其实只是查错了列。
op_payload() {  # <op_id> <字段名>
  sqlite3 "${PHONE_DB}" \
    "SELECT json_extract(data,'\$.op.payload.$2') FROM ops WHERE ix0_0='$1';" 2>/dev/null
}

# 界面上是否列出了这条任务（RN 的无障碍标签，等价于 Android 的 content-desc）
ui_has_task() {  # <标题>
  local out; out=$(ax "打开任务：$1" --pressable --list --json)
  [ "$(jget "$out" found)" = "True" ]
}

# 🔴 往 Composer 塞文字的**稳妥路径**（2026-10-02）：
#    AXSetValue 偶发静默失败（回读空、应用状态没收到），而"按添加"不会替你
#    检查 —— 空输入时添加是禁用态，press 照样返回 success 但什么都没提交
#    （16:24 截图铁证：空 Composer 开着、添加禁用，日志却写"已提交"）。
#    ⇒ 三层：AXSetValue 重试 3 次 → HID 键盘输入兜底（secure 框同款路径）→
#    **最终裁决 = 「添加」启用态**（应用亲口确认文字进了它的状态）。
fill_composer_title() {  # <标题>
  local val="$1" i tp
  for i in 1 2 3; do
    ax - --field --set "$val" --json >/dev/null 2>&1
    sleep 1
    if [ "$(jget "$(ax "添加" --pressable --list --json)" enabled)" = "True" ]; then
      return 0
    fi
  done
  tp=$(ax - --field --type-text "$val")
  sleep 1
  [ "$(jget "$(ax "添加" --pressable --list --json)" enabled)" = "True" ]
}

# 关掉一切已知的浮层/键盘 —— 每段导航判据前的**归一化**。
# 🔴 「关闭排序选择」必须在内：traps #109 的子串撞车会让重试的"添加"
#    落到「排序：按添加时间」chip 上，把排序面板点开 —— 全屏模态一盖，
#    任务行、标签栏全部从树上消失，后面 8 条判据连锁假红（run8/9/10 实测）。
dismiss_overlays() {
  ax --dismiss-keyboard --json >/dev/null 2>&1 || true
  for _m in "关闭排序选择" "关闭" "取消" "以后再说" "完成" "返回"; do
    ax "$_m" --pressable --press --json >/dev/null 2>&1
  done
  sleep 1
}

# ── 0. 前置条件 ─────────────────────────────────────────────────────────────
step "0. 前置条件"

# 🔴🔴 **先构建并安装当前源码 —— 否则这个脚本可能在验一个旧二进制。**
#
# 2026-09-29 实测撞到：本脚本**只验证、不构建**（前置写着"该模拟器上已装好
# Release 版"，而全仓没有一处 `simctl install`）。于是它跑的是模拟器上
# **上一次打的那个包** —— 我为实时通道改的代码**根本没上设备**，
# 而脚本照样给出了 36 项结论。这正是本仓自己记过的那条：
# **"测试全绿 ≠ 这是当前产物"**。
#
# ⇒ 默认**构建 + 安装**。`HEYTA_IOS_SKIP_BUILD=1` 可以跳过（改脚本本身时用），
#    但那时仍然会**断言产物比源码新** —— 旧产物要么被重建，要么**响亮地失败**。
IOS_APP_DIR="/tmp/heyta-ios-release/Build/Products/Release-iphonesimulator/Heyta.app"

# 源码的最新修改时间（只扫会进 bundle 的地方：宿主 src + 四个共享包 src）
# ⚠️ **不要写 `-newer /dev/null`。** 第一版那么写，而它在 macOS 上**匹配不到任何文件**：
#    `/dev/null` 是设备文件，它的 mtime 是**当下**（实测 `stat` 给的是刚才那一刻），
#    于是 `-newer /dev/null` 恒假 ⇒ `SRC_MTIME=0` ⇒ 新鲜度判据**恒真**。
#    一个"永远绿"的判据比没有判据更坏，因为它会让人以为这一段被守住了。
# ⚠️ **必须 `-print0` + `xargs -0`。** 本仓库的路径里有**空格**
#   （`All in one Data/01_PROJECTS/heyta`），而 `xargs` 默认按空白切分 ——
#    于是 `stat` 收到一堆不存在的路径、`2>/dev/null` 把错误吞掉、**输出 0 行**。
#    实测：`find | wc -l` 是 282，而 `find | xargs stat | wc -l` 是 **0**。
newest_src() {
  find "$HEYTA_REPO_ROOT/apps/mobile/src" "$HEYTA_REPO_ROOT/packages"/*/src \
    -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null \
    | xargs -0 stat -f '%m' 2>/dev/null | sort -rn | head -1
}

if [ "${HEYTA_IOS_SKIP_BUILD:-0}" = "1" ]; then
  echo "   ⏭  跳过构建（HEYTA_IOS_SKIP_BUILD=1）"
else
  echo "   正在构建 Release 版（会重新打 JS bundle，数分钟）…"
  if xcodebuild -workspace "$HEYTA_REPO_ROOT/apps/mobile/ios/Heyta.xcworkspace" \
      -scheme Heyta -configuration Release -sdk iphonesimulator \
      -destination "id=$UDID" -derivedDataPath /tmp/heyta-ios-release build \
      >/tmp/heyta-ios-build.log 2>&1; then
    ok "xcodebuild Release 构建成功（日志 /tmp/heyta-ios-build.log）"
  else
    bad "xcodebuild 失败 —— 先看 /tmp/heyta-ios-build.log（末尾 20 行）"
    tail -20 /tmp/heyta-ios-build.log | sed 's/^/     /'
    summary "iOS 输入侧"
  fi
  if [ -d "$IOS_APP_DIR" ]; then
    xcrun simctl install "$UDID" "$IOS_APP_DIR" >/dev/null 2>&1 \
      && ok "已把**当前源码**构建的 app 装进模拟器" \
      || bad "simctl install 失败：$IOS_APP_DIR"
  else
    bad "找不到构建产物 $IOS_APP_DIR"
  fi
fi

# 无论跳不跳过，都断言"**我们验的正是刚装上去的那个包**"。
#
# 🔴 这一段是 2026-09-29 那次事故的直接产物，而那次的形状值得完整记下来：
#
#   1. 工程的 bundle id 是 **`com.heyta`**，而本脚本的 `BID` 默认值还是 RN 模板的
#      `org.reactjs.native.example.Heyta`（**过期的默认值**）；
#   2. 于是 `simctl install` 装的是 `com.heyta`（**exit 0**），
#      而脚本查的、启动的、读 SQLite 的都是**另一个 app**；
#   3. 设备上积了**三个**容器（09-27 / 09-28 / 09-29），`get_app_container`
#      解析到最旧的那个 —— 脚本跑了整整几轮，验的是**两天前的代码**，
#      而每一轮都报"通过 N 项"。**"测试全绿 ≠ 这是当前产物"** 这条教训，
#      本仓在 `mobile-e2e-up.sh` 的文件头写过一次，这里是它的第二次。
#
# ⇒ 所以判据不是"有没有装"，而是"**解析得到、且比源码新**"。两个条件缺一不可。
INSTALLED_APP="$(xcrun simctl get_app_container "$UDID" "${BID}" app 2>/dev/null)"
if [ -z "$INSTALLED_APP" ]; then
  bad "按 BID=${BID} 解析不到已安装的 app —— 装了别的 bundle id，或没装上。这一轮验的会是别的东西。"
fi
BUNDLE_MTIME=0
[ -n "$INSTALLED_APP" ] && BUNDLE_MTIME=$(stat -f '%m' "$INSTALLED_APP/main.jsbundle" 2>/dev/null || echo 0)
SRC_MTIME=$(newest_src)
# 🔴 **判据算不出输入时必须红，不能默默放过。**
#    上一版就是 `SRC_MTIME` 算成了 0，于是 `BUNDLE_MTIME >= 0` 恒真 —— 一个**永远绿的判据**。
if [ "${SRC_MTIME:-0}" -le 0 ]; then
  bad "算不出源码的最新修改时间（newest_src 返回 ${SRC_MTIME:-空}）—— 新鲜度判据**没在运行**，不是通过"
elif [ "${BUNDLE_MTIME:-0}" -le 0 ]; then
  bad "读不到已安装 app 的 main.jsbundle（容器为空或没有这个文件）—— 这一轮验的不是当前产物"
elif [ "$BUNDLE_MTIME" -ge "$SRC_MTIME" ]; then
  ok "已安装的包（${BID}）比源码新 —— 这一轮验的是当前产物"
else
  bad "已安装的包**比源码旧** —— 这一轮验的会是旧代码。先构建。"
fi

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

# 🔴🔴 **每轮必须换新号**（2026-10-02 接入，理由与 Android 侧同一份）：
# `scripts/lib/mobile-e2e-fresh-account.sh` 的文件头写了整条因果链 —— 向量时钟
# 上限 20，每轮 +2 个 client，历史账号迟早越过阈值，之后每条写入都被判
# CONFLICT_CONCURRENT 永久拒绝。本机这份凭据文件从 09-29 用到现在，还叠着
# **第二层实测代价**：旧账号拖着 ~200 条 op 的历史，iOS 模拟器（Hermes 无
# WebAssembly，Argon2id 纯 JS + 逐条解密）的**首轮同步要跑好几分钟** ——
# 第 6/7 步的自动同步窗口（120/60 秒）全被它吃掉，红得一模一样。
# 换新号后首轮同步只有本机那一条 op，窗口回到设计值。
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
# 🔴 建号必须走宿主机地址：mobile-e2e.sh 把 `SERVER` 设成 10.0.2.2
#    （Android 模拟器看宿主机的地址），而建号是**宿主机侧的 curl**
#    —— 10.0.2.2 从 macOS 根本不可达（第 7 轮实测：建号静默失败，
#    悄悄落回旧账号，首轮同步又慢回解放前）。
# 🔴 必须覆盖 `HEYTA_E2E_SERVER` 而不是 `SERVER`：helper 的
#    `HEYTA_E2E_SERVER="${SERVER:-…}"` 在 **source 时**就已展开定死
#    （当时全局 SERVER 是 10.0.2.2），调用点再覆盖 SERVER 不会让它重新求值
#    —— 前 8 轮建号一直静默失败、落回旧账号（首轮同步几分钟，吃光 6/7 步窗口），
#    症状却指向"服务端没跑 TEST_MODE"。
if HEYTA_E2E_SERVER="$HOST_SERVER" heyta_e2e_fresh_account; then
  # mobile-e2e.sh 在 **source 时**就把三个凭据读进了变量 —— 换号后必须重读，
  # 否则手机填的是新号、笔记本用的还是旧号，跨设备判据必红。
  TOKEN=$(cat /tmp/heyta_mobile_token.txt)
  EMAIL=$(cat /tmp/heyta_mobile_email.txt)
  E2EE=$(cat /tmp/heyta_mobile_e2ee.txt)
  rm -f "$LAPTOP_DB"
  ok "笔记本库已随新号重置：${LAPTOP_DB}"
else
  bad "建不了新号（服务端没跑 TEST_MODE？）—— 沿用旧凭据继续：首轮同步会很慢，第 6/7 步的窗口可能不够"
fi

# 🔴 B10 收口（2026-10-02）：主路径贴的必须是**邮件链接形态的一次性令牌**，
#    不是 JWT 访问令牌 —— 服务端 test 端点已补上签发能力
#    （POST /api/test/mint-login-link，与生产走同一个 mintLoginMagicLinkToken，
#    仅把"发邮件"换成"直接返回令牌"）。拿不到就如实报红：主路径从此
#    **没有**"夹具缺口"这层降级借口 —— 前面 12+ 轮的红就是这个缺口造的。
ONETIME_TOKEN=""
if [ -n "${EMAIL:-}" ]; then
  _mint=$(curl -sf -X POST "$HOST_SERVER/api/test/mint-login-link" \
    -H 'content-type: application/json' -d "{\"email\":\"${EMAIL}\"}" 2>/dev/null || true)
  ONETIME_TOKEN=$(jget "$_mint" token)
fi
if [ -n "$ONETIME_TOKEN" ]; then
  ok "已为 ${EMAIL} 签发一次性登录链接令牌（贴令牌主路径专用，64 hex）"
else
  bad "签发不了一次性登录令牌（/api/test/mint-login-link）—— 主路径会真红：查服务端 TEST_MODE 与账号新鲜度"
fi

# 启动 App（**不 terminate**：会话内已派生过 Argon2 密钥，terminate 会白白再花 30–40 秒）
xcrun simctl launch "$UDID" "${BID}" >/dev/null 2>&1
sleep 5

# 🔴 **SQLite 的存在性必须在"启动之后"查。**
#    原来这个检查在 `launch` 之前，于是在**全新安装 / erase 过**的设备上必然红 ——
#    因为库是 app 第一次跑起来时才建的（实测：erase 之后第一轮就报
#    "App 没装或没启动过"，而 app 装得好好的）。
#    ⚠️ 这类"检查了不该检查的东西"的失败，本脚本的文件头已经记过一次
#    （`pgrep -x Simulator` —— 一个根本不需要存在的进程）。
PHONE_DB=$(phone_db)
if [ -f "${PHONE_DB}" ]; then
  ok "手机真 SQLite：${PHONE_DB}"
else
  bad "启动之后仍找不到手机 SQLite（${PHONE_DB}）—— app 没跑起来，或 BID 不对"
  summary "iOS 输入侧"
fi

# 🔴 **首次启动的欢迎页（规范 §3.1）会盖住整个主界面**，包括 FAB 与标签栏。
#    它是"装完包的第一次冷启动"才有的一屏，而这一步之后所有断言都假设
#    主界面在前面 —— 不先离开它，第 1 步会报"找不到「新建任务」按钮，
#    AX 桥不通或 App 不在任务页"，把方向引到无障碍桥上去。
#
# ⚠️ 与"登录墙"无关：这一屏有「先离线使用」这个同级出口，点一下就进主界面。
#    幂等：不在欢迎页时什么都不做。
idb_dump
if idb_has "先离线使用"; then
  WELCOME_XY=$(idb_label_center "先离线使用" 2>/dev/null)
  if [ -n "$WELCOME_XY" ]; then
    idb_ui tap $WELCOME_XY >/dev/null 2>&1
    echo "     已离开欢迎页（点「先离线使用」@ ${WELCOME_XY}）"
    sleep 3
  else
    echo "     ⚠️ 欢迎页在，但取不到「先离线使用」的坐标" >&2
  fi
fi

# ── 1. AX 桥是否通 + App 是否在任务页 ───────────────────────────────────────
# 🔴🔴 **在共享 lib 的 `summary` 之上包一层：夹具自身不可信时，先把话说清楚。**
#
# 理由（第 41 轮的结论，见 handoff §5.1n）：这个脚本的红**不是产品判决** ——
# 同一份代码连续几轮红在**不同**的地方（第 4 / 第 5 / 第 1 步），
# 而共同的病是**坐标点击与滑动在这个应用上不可靠**。
# 一份"看起来像产品判决"的红，比一句"我验不了"更危险 —— 它会让人去改错的东西。
#
# ⚠️ **不改共享 lib**：`summary` 被全部移动端脚本用，改它对别人是破坏。
#    这里用 `declare -f` 把原函数改名保留，再包一层，**只影响本脚本**。
eval "$(declare -f summary | sed '1s/^summary ()/summary_lib ()/')"
summary() {
  if [ "${FIXTURE_UNRELIABLE:-0}" = "1" ]; then
    echo ""
    echo "  ⚠️⚠️ **本轮夹具自身不可信** —— 上面的通过/失败都**不是产品判决**。"
    echo "       触发点：一个'按了却回读不到预期变化'的动作（见 §5.1n 与 press_until）。"
    echo "       要把它当成产品缺陷之前，先回答：**是产品做不到，还是这套夹具做不到？**"
  fi
  summary_lib "$@"
}

FIXTURE_UNRELIABLE=0

# ── 0.5. 🔴 冷启动**前置性**：全新安装 → 欢迎页第一屏 ─────────────────────
#
# 🔴 **为什么必须是"全新安装 + 第一屏"，而不是"在「我的」页找到入口"**
#
# 目标那句是：「**每一端冷启动后**都要能先注册/登录再使用，**不能把认证藏在设置里**」。
# 从「我的」页上找到入口**证明不了前置** —— 它只证明"它在某个地方"。
#
# 实测（2026-09-29，第 35 轮）：`simctl terminate` + `launch` 之后，app **直接进任务页** ——
# 因为欢迎页由**设备本地偏好** `welcome.hasSeen` 门控（`apps/mobile/src/prefs/device-prefs.ts`），
# 而这台模拟器上早就"看过"了。⇒ 要验它，就必须**全新安装**（清掉那个偏好）。
# Android 那份 `scripts/verify-mobile-auth.sh` 的 §0 正是这么做的（"全新安装 = 全新设备身份"）。
#
# 判据与它 **J1** 对齐，**含反证**：
#   · 第一屏**看得见**「注册 / 登录」（0 次点击）；
#   · 第一屏有出口「先离线使用」（不登录也能用 —— 这是同一份规范的另一半）；
#   · 此刻**还没有**邮箱输入框（否则"点一下才叫出表单"会**自动成立**，什么也没验到）。
step "0.5 🔴 冷启动前置性：全新安装 → 欢迎页第一屏"

if [ -d "${IOS_APP_DIR}" ]; then
  xcrun simctl uninstall "$UDID" "${BID}" >/dev/null 2>&1
  sleep 1
  xcrun simctl install "$UDID" "${IOS_APP_DIR}" >/dev/null 2>&1
  ok "已全新安装（清掉 welcome.hasSeen 等设备本地偏好）"
else
  bad "没有构建产物可装 —— 0.5 步的判据不可信"
fi
xcrun simctl launch "$UDID" "${BID}" >/dev/null 2>&1
sleep 8

# 🔴 **先清掉上一轮可能残留的系统弹窗。** 它是**系统**对话框，**跨应用重启存活** ——
#    实测（第 36 轮）：上一轮在认证页填过 `secure` 字段之后 iOS 弹了「保存密码？」，
#    那一轮结束时它还在，于是**这一轮**一进来 AX 树就只剩 `AXApplication` 一个节点，
#    而症状看起来像"AX 桥断了"。⇒ 起点必须先清。
dismiss_ios_save_password || true

W_ENTRY=$(ax "注册 / 登录" --list --json)
if [ "$(jget "$W_ENTRY" found)" = "True" ]; then
  ok "🔴 **冷启动第一屏**就有「注册 / 登录」（0 次点击看得见 —— 前置性成立）"
else
  bad "冷启动第一屏**看不到**「注册 / 登录」—— 认证没有前置到第一屏"
fi
W_OFFLINE=$(ax "先离线使用" --list --json)
if [ "$(jget "$W_OFFLINE" found)" = "True" ]; then
  ok "同一屏还有出口「先离线使用」（不登录也能继续用 —— 规范的另一半）"
else
  bad "第一屏没有「先离线使用」出口 —— 要么欢迎页没渲染，要么出口被去掉了"
fi
W_EMAIL=$(ax "邮箱" --role AXTextField --list --json)
if [ "$(jget "$W_EMAIL" found)" = "True" ]; then
  bad "第一屏**已经**有邮箱输入框 —— 后面「点击才叫出表单」那条判据会**自动成立**，什么也没验到"
else
  ok "此刻还看不到邮箱输入框（说明「注册 / 登录」那一下点击是真的把表单叫出来的）"
fi

# 点出口进主界面 —— 后面几步（FAB / Composer / op-log）的前提是"在应用里"。
# 🔴 **必须回读**：这一下**点了没生效**正是第 1 步 `label 数 6` 那次红的根因。
# ⚠️ 判据是**「先离线使用」消失**，不是"「任务」出现" ——
#    后者在欢迎页上就已经成立（标签栏在它背后），会给**假绿**（第 41 轮实测）。
if press_until_gone "先离线使用" "先离线使用" 4; then
  ok "「先离线使用」真的把 app 带进了主界面（**判据是欢迎页的标志消失**）"
else
  bad "「先离线使用」按了 4 次都没离开欢迎页 —— **以下所有判据都不可信**（夹具问题，不是产品问题）"
  FIXTURE_UNRELIABLE=1
fi
sleep 1

# 🔴 **全新安装换了应用数据容器，`PHONE_DB` 必须重算。**
# 实测（2026-09-29）：0.5 步插进来之后，第 4 步报 `ops 行数  →`（**两个都空**）——
# 因为 `PHONE_DB` 是在 `uninstall/install` **之前**算的，指向那个已经不在的容器。
# 症状（"ops 数读不出来"）看起来像数据库坏了，其实是**路径过期**。
PHONE_DB=$(phone_db)
if [ -f "${PHONE_DB}" ]; then
  ok "全新安装后的数据容器：${PHONE_DB}"
else
  bad "全新安装后仍找不到 SQLite（${PHONE_DB}）—— 后面所有基于 ops 的判据都会读空"
fi

step "1. AX 桥与初始界面"

# 🔴 先切回「任务」标签，再做任何判断。"界面里有没有文本控件"这个判据**只在任务页成立** ——
#    「我的」页常驻三个输入框（服务器地址 / 访问令牌 / 端到端加密口令），拿它当
#    "Composer 开着"的证据会直接假红，而症状是"按了取消但面板还开着"，方向全偏。
#    同样地，上一次运行会把界面停在「我的」（同步那步切过去），不切回来 FAB 就查不到，
#    症状却是"AX 桥不通"。
# 🔴🔴 **先关掉任何开着的 modal，再切标签 —— 否则这个脚本不可重跑。**
#
# 实测（2026-09-29，第 34 轮）：上一轮结束时 app 停在**认证页**（那一轮主路径失败、
# `返回` 没把页面切回来），于是这一轮第 4 步红在「按了『添加』但 Composer 还开着」——
# **而那一轮我根本没改第 4 步**。app 的状态**跨轮残留**，而模态盖住标签栏时
# `ax "任务"` 是**点不到的**（它返回 not-found，而症状看起来像"界面不对"）。
#
# ⚠️ 脚本刻意**不 terminate**（会话内已派生过 Argon2 密钥，terminate 会白花 30–40 秒），
#    所以起点是不可控的 —— **必须归一化**。判据是"任务标签点得到"，不是"关掉了几个东西"。
# 🔴 「以后再说」/「同意并联网」（2026-10-02 加）：首启隐私同意面板
#    （G-11）会盖住欢迎页 —— 它比上一轮留下的 Composer 更早出现。
#    不先收掉它，0.5 步对「注册 / 登录」的点击全部打在遮罩上，症状是
#    "冷启动前置性整段假红"。验收走「以后再说」：后续判据不需要联网
#    （同步段有自己的凭据配置路径），也避免把"同意"这个法律决定
#    塞进自动化 —— 它应由真人作出。
for _modal in "以后再说" "同意并联网" "取消" "关闭新建面板" "返回"; do
  for _try in 1 2 3; do
    if [ "$(jget "$(ax "任务" --pressable --list --json)" found)" = "True" ]; then break 3; fi
    if [ "$(jget "$(ax "$_modal" --pressable --list --json)" found)" = "True" ]; then
      ax "$_modal" --pressable --press --json >/dev/null 2>&1
      sleep 1.5
    else
      break
    fi
  done
done

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
  xcrun simctl terminate "$UDID" "${BID}" >/dev/null 2>&1
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
  xcrun simctl launch "$UDID" "${BID}" >/dev/null 2>&1
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
# 🔴 必须**精确匹配**（2026-10-02 加 --exact）：主界面的排序 chip 是
#    「排序：按添加时间」，shim 的退化子串匹配会命中它 ⇒ composer_open 恒真
#    ⇒ "按了取消还开着"的假卡住（实测两轮验收都红在同一处）。
#    真 Composer 的提交按钮 label 恰是「添加」两字，精确匹配打得中、chip 打不中。
composer_open() { [ "$(jget "$(ax "添加" --pressable --list --exact --json)" found)" = "True" ]; }

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
  xcrun simctl terminate "$UDID" "${BID}" >/dev/null 2>&1
  sleep 2
  xcrun simctl launch "$UDID" "${BID}" >/dev/null 2>&1
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

fill_composer_title "$TITLE"
ADD_AFTER=$(ax "添加" --pressable --list --json)
if [ "$(jget "$ADD_AFTER" enabled)" = "True" ]; then
  ok "「添加」enabled 由 false → true（L3 应用亲口确认收到了这段文字）"
else
  bad "写入后「添加」仍 disabled —— AXSetValue 与 HID 键盘双路径都没把文字送进应用"
  summary "iOS 输入侧"
fi

# ── 4. 提交（L4 副作用）────────────────────────────────────────────────────
step "4. 提交并核对 op-log"

# 🔴 与第 5 步同一条纪律：**看 result，不看"我调用了 tap"**。
#    实测踩到：这里原来是 `>/dev/null 2>&1` 加一句无条件的 ok，于是
#    "点击被键盘吞掉"和"提交成功"在报告里长得一模一样。
# 🔴 **按下之后必须回读，而且允许一次重试。**
#
# 实测（2026-09-29，第 35 轮）：这一条**时红时绿**（同一份代码，一次过、两次红），
# 而红的时候走的是 `success` 分支 —— 也就是 **shim 报"点击成功"、而应用没收到**。
# 那正是本仓那条最贵的教训（"工具返回成功不等于生效"），也是 §7 里
# `tap-blocked-by-keyboard` 那条判据**没能兜住**的情形。
#
# ⇒ 判据从"tap 返回了什么"改成"**composer 真的关了吗**"，关不上就收键盘再试一次。
ADD_OK=0
for _try in 1 2; do
  # 🔴 --exact（traps #109）：重试时 Composer 可能已关，精确名消失后
  #    子串退化会命中「排序：按添加时间」chip —— 把排序面板点开。
  #    🔴 not-found 有时序抖动（run11 实测：fill 刚确认 enabled，紧接的
  #    树快照却找不到按钮，下一击就成功）—— 给 3×2 秒的找按钮窗口。
  ADD_PRESS='{"result":"not-found"}'
  for _p in 1 2 3; do
    ADD_PRESS=$(ax "添加" --pressable --exact --press)
    [ "$(jget "$ADD_PRESS" result)" != "not-found" ] && break
    sleep 2
  done
  # 🔴 应用事实裁决（2026-10-02）：按钮 find 不到但 Composer 已关 = 按钮其实
  #    按上了、树快照输了竞态 —— 提交是否生效只看 Composer 状态，不看工具视线。
  if [ "$(jget "$ADD_PRESS" result)" = "not-found" ] && ! composer_open; then
    ADD_PRESS='{"result":"success"}'
    echo "     （按钮不在树上但 Composer 已关 —— 提交生效，树快照竞态）"
  fi
  case "$(jget "$ADD_PRESS" result)" in
    success) : ;;
    tap-blocked-by-keyboard)
      bad "「添加」被键盘挡住，点击**没有到达按钮**（keyboardTop=$(jget "$ADD_PRESS" keyboardTop), cy=$(jget "$ADD_PRESS" cy)）"
      ;;
    *) bad "按下「添加」失败：$(jget "$ADD_PRESS" result)" ;;
  esac
  sleep 3
  if ! composer_open; then ADD_OK=1; break; fi
  # 没关成：先把键盘收掉再来一次（键盘是这一步最主要的干扰源）。
  ok "第 $_try 次「添加」没让 Composer 关闭 —— 收键盘后重试"
  for _k in 1 2 3; do
    if [ "$(jget "$(ax --keyboard)" present)" != "True" ]; then break; fi
    ax --tap 200 150 >/dev/null 2>&1
    sleep 1
  done
done

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

OP_ID=$(sqlite3 "${PHONE_DB}" "SELECT ix0_0 FROM ops WHERE json_extract(data,'\$.op.payload.title')='$TITLE';" 2>/dev/null | head -1)
if [ -n "$OP_ID" ]; then
  ok "在 ops 里按标题找到了这条 op：$OP_ID"
else
  bad "ops 里没有任何 op 的 payload.title 等于「${TITLE}」"; summary "iOS 输入侧"
fi

OP_TYPE=$(sqlite3 "${PHONE_DB}" "SELECT json_extract(data,'\$.op.opType') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
ACTION=$(sqlite3 "${PHONE_DB}" "SELECT json_extract(data,'\$.op.actionType') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
ETYPE=$(sqlite3 "${PHONE_DB}" "SELECT json_extract(data,'\$.op.entityType') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
CLIENT=$(sqlite3 "${PHONE_DB}" "SELECT json_extract(data,'\$.op.clientId') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
VCLOCK=$(sqlite3 "${PHONE_DB}" "SELECT json_extract(data,'\$.op.vectorClock') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
USTATUS=$(sqlite3 "${PHONE_DB}" "SELECT json_extract(data,'\$.uploadStatus') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)

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

# 🔴 列表渲染/树快照有延迟：给 5×2 秒的重试窗口再判红（任务此刻必然已落库，
#    红只可能是"树还没看到"，不是"任务不存在"）。
dismiss_overlays
UI_FOUND=0
for _try in 1 2 3 4 5; do
  if ui_has_task "$TITLE"; then UI_FOUND=1; break; fi
  [ "$_try" = "2" ] && dismiss_overlays
  sleep 2
done
if [ "$UI_FOUND" = "1" ]; then
  ok "iOS 界面上列出了「${TITLE}」（无障碍标签可读）"
else
  bad "iOS 界面上找不到「${TITLE}」（重试 5 次）"
fi

# ── 5. 跨设备（L5）────────────────────────────────────────────────────────
step "5a. 🔴 **前置的注册/登录入口在真机上可达**（本次目标里的硬要求）"
#
# 这一条**从来没被端到端验过**：本脚本一直走的是「手动填写凭据」那条**兜底路径**，
# 而产品自己的主路径 —— 「注册 / 登录」 —— 只在别处的单测里出现过。
#
# 本次目标里写得很明确：「**注册/登录必须前置**：每一端冷启动后都要能先注册/登录再使用，
# **不能把认证藏在设置里**」。所以它必须有一条**真机上的**判据。
#
# 实测（2026-09-29）：「我的」页顶部有 `AXButton '注册 / 登录'`；
# 点开之后出现 `服务器地址 / 邮箱 / 端到端加密口令 / 注册新账号 /
# 用通行密钥登录 / 粘贴邮件里的链接或令牌` —— 三条路都在。
# ⚠️ 这里只验"入口在「我的」页可达"。**真正的"前置性"判据在 0.5 步** ——
#    它必须在**全新安装后的冷启动第一屏**上判，而不是在导航之后（见 0.5 步的说明）。
dismiss_overlays
if press_until "我的" "注册 / 登录" 3; then
  ok "已切到「我的」页（**回读到入口才判成功**）"
else
  bad "切不到「我的」页 —— 下面的入口判据不可信"
  FIXTURE_UNRELIABLE=1
fi

AUTH_ENTRY=$(ax "注册 / 登录" --pressable --list --json)
if [ "$(jget "$AUTH_ENTRY" found)" = "True" ]; then
  ok "「我的」页上有「注册 / 登录」入口（冷启动后一眼可见，不在设置里）"
else
  bad "找不到「注册 / 登录」入口 —— 认证被藏起来了，这正是本次目标禁止的形态"
fi

ax "注册 / 登录" --pressable --press --json >/dev/null 2>&1
sleep 2.5

# 三条路各自断言一次：它们是**不同的登录方式**，缺一条就是缺一种能力。
AUTH_OK=0
for _lbl in "注册新账号" "用通行密钥登录" "粘贴邮件里的链接或令牌" "邮箱"; do
  _r=$(ax "${_lbl}" --list --json)
  if [ "$(jget "$_r" found)" = "True" ]; then
    AUTH_OK=$((AUTH_OK + 1))
    ok "认证页上有「${_lbl}」"
  else
    bad "认证页上缺「${_lbl}」"
  fi
done
if [ "$AUTH_OK" -ge 4 ]; then
  ok "🔴 前置的认证入口：**邮箱注册 + 通行密钥 + 粘贴令牌**三条路都在真机上可达"
fi
# 退回「我的」，下面第 5 步继续用它的凭据表单。
# 🔴 2026-10-02：**不能按「返回」** —— 认证页的「返回」Link（x=406..450,
#    y=6..50）正压在这台折叠屏的**灵动岛底下**，点它 = 点岛：AX 报成功、
#    页面纹丝不动（实测连点多次无效）。可靠的离开方式是**标签往返**，
#    认证页随切标签一起收起。
ax "任务" --pressable --press --json >/dev/null 2>&1
sleep 2
ax "我的" --pressable --press --json >/dev/null 2>&1
sleep 3

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
  # 🔴🔴 **2026-10-02 收紧：字段定位不到 = 报红，不再"跳过填写"。**
  #
  # 旧版的"不在树上（可能已经设好、被页面收起）—— 跳过"是为**已配置过凭据**
  # 的设备设计的容错。第 5 轮实测把它的漏洞照了出来：**全新安装**的模拟器上
  # 四个字段全部"不在树上"、全部被这句跳过 —— 而真正的原因是滚动 swipe 的
  # 起点**落在底部标签栏上，把整个认证页切走了**（见 tools/ios-ax-shim.py
  # 的 scroll_into_view 说明）。"页面状态不对"在这里被完美伪装成"已设好"，
  # 下游凭据判据红的时候已经查不到现场了。
  #
  # ⇒ 现在的纪律：先归一化（收键盘 —— 键盘弹着时下半屏元素会从树上消失），
  #    再 --scroll-into-view（滚进可见区），仍拿不到就 `bad`。
  #    **报告事实，不让容错分支吞掉状态机漂移。**
  local lbl="$1" val="$2" secure="${3:-}" attempt=1 pre out back rc
  while [ "${attempt}" -le 4 ]; do
    # 🔴 归一化放**每一次尝试里**：键盘弹着时被它盖住的元素直接从 AX 树上
    #    消失（第 6 轮实测），上一轮写完留下的键盘会让下一轮定位必败。
    ax --dismiss-keyboard --json >/dev/null 2>&1
    pre=$(ax "$lbl" --role AXTextField --scroll-into-view)
    if [ "$(jget "$pre" visible)" = "True" ]; then break; fi
    echo "     [set_field] 「${lbl}」第 ${attempt} 次定位失败：found=$(jget "$pre" found) visible=$(jget "$pre" visible) scrollRc=$(jget "$pre" scrollRc)"
    attempt=$((attempt + 1))
    sleep 1.5
  done
  if [ "$(jget "$pre" visible)" != "True" ]; then
    bad "「${lbl}」输入框经 4 次定位（含滚进可见区）仍不可达 —— 全新安装语境下这不是「已设好」，是页面状态不对"
    return 1
  fi
  if [ "${secure}" = "--secure" ]; then
    # 🔴 secure 框**不能信 set-value**：2026-10-02 实测它 rc=0、AXValue 也回读成
    #    掩码，但 **RN 的 onChangeText 没被触发** —— 界面一串圆点，表单状态还是
    #    空（症状：同步停在「还没设置端到端加密口令」）。
    #    唯一实测能进 RN 状态的路：**聚焦 + HID 键盘输入**（shim 的 --type-text，
    #    内部先滚进可见区、tap 聚焦、等键盘、再 `ui text`）。
    #    掩码长度 == 原文长度：多了说明是**追加**（上次残留），也是失败。
    attempt=1
    while [ "${attempt}" -le 3 ]; do
      local tp; tp=$(ax "$lbl" --role AXTextField --type-text "$val")
      back=$(jget "$tp" detail)
      if [ "$(jget "$tp" typedRc)" = "0" ] && [ "${#back}" -eq "${#val}" ]; then
        ok "已填写「${lbl}」（secure 框经聚焦+键盘输入，掩码长度 ${#back} = 原文长度）"
        return 0
      fi
      echo "     [set_field] 「${lbl}」secure 框第 ${attempt} 次输入失败：typedRc=$(jget "$tp" typedRc)，掩码 ${#back} ≠ 原文 ${#val}"
      attempt=$((attempt + 1))
      ax --dismiss-keyboard --json >/dev/null 2>&1
      sleep 1
    done
    bad "填写「${lbl}」失败（secure 框 3 次：typedRc=$(jget "$tp" typedRc)，掩码长度 ${#back} ≠ 原文长度 ${#val}）"
    return 1
  fi
  # 🔴 **idb 的 `set-value` 时好时坏，必须重试**（2026-09-29 实测四次两败）。
  #    🔴 而**重试的判据是"回读一致"，不是"rc=0"** —— 第 6 轮实测 rc=0 而
  #    回读为空（写入没发生，或回读那一次树读空了）。按 rc 判会把这些全放行。
  attempt=0
  while [ "${attempt}" -lt 4 ]; do
    attempt=$((attempt + 1))
    out=$(ax "$lbl" --role AXTextField --set "$val")
    back=$(jget "$out" detail)
    rc=$(jget "$out" setRc)
    if [ "$back" = "$val" ]; then break; fi
    sleep 0.8
  done
  if [ "$back" = "$val" ]; then
    ok "已填写「${lbl}」"
    return 0
  fi
  bad "写「${lbl}」连续 ${attempt} 次都失败（最后 idb rc=${rc}，回读 ${#back} 字符 ≠ 期望 ${#val}）：$(jget "$out" setErr)"
  return 1
}
# ℹ️ 历史注记（2026-09-29）：旧版在这里先按「清除本机保存的凭据」拿确定初态，
#    因为旧「我的」页会把已设好的字段**藏起来**。2026-10-02 起表单在设置面里、
#    三个字段**任何状态下都在树上**，清凭据挪进了下面的兜底路径（按钮为禁用态
#    = 全新设备，直接填）。
# ── 5b. 🔴 **走产品自己的主路径**：「注册 / 登录」 ────────────────────────────
#
# 🔴 **为什么必须搬到这条路上来**
#
# 下面那段「手动填写凭据」是页面**自己标注的兜底路径**（原文：「下面是手动填写凭据的
# 兜底路径」）。实测（2026-09-29，见交接 §3）它**不是为逐字段自动化写的**：
# 任何一次**写成功**都会把这一段收起，于是"写失败"与"写完被收起"在输出上**完全一样**。
# 继续修它 = 修错了对象。
#
# 而主路径（本步）有三个好处：
#   1. 它是**产品的主路径**，验它才有意义；
#   2. 它**正好是本次目标那条硬要求** ——「注册/登录必须前置，不能把认证藏在设置里」；
#   3. 它的字段**接受写入**（实测 服务器地址/邮箱/口令 rc=0）。
#
# 认证页实测形状（点「注册 / 登录」之后）：
#   返回 / 服务器地址 / 邮箱 / 端到端加密口令 / 注册新账号 /
#   用通行密钥登录 / 用通行密钥注册 / 粘贴邮件里的链接或令牌
# 贴了令牌之后出现提交按钮：**「验证并登录」**。
# 🔴🔴 **首启隐私同意门（G-11）：任何要联网的动作第一次都会被它拦下。**
#
# 2026-10-02 实测：全新安装（第 0.5 步会卸载重装）后第一次按「立即同步」，
# 弹出「在使用联网功能之前」面板，原文写着"刚才那一步需要与服务器通信，
# 而还没有同意隐私规则，所以 heyta 一个请求都没有发"。**它不红、不报错、
# 装作什么都没发生** —— 第 5 轮的"好 op 没有离开待上传队列"有它一份。
#
# 第 1 步的归一化刻意选「以后再说」（那一步不需要联网，也不把"同意"这个
# 法律决定塞进自动化）。而**本步要验的就是跨设备同步** —— 不同意联网，
# 服务端一个请求都收不到，这条验收在结构上不可能通过。
# 所以这里**明确地、留痕地**代按「同意并联网」，并在日志里说明为什么。
grant_network_consent_if_asked() {
  if [ "$(jget "$(ax "同意并联网" --pressable --list --json)" found)" = "True" ]; then
    ax "同意并联网" --pressable --press --json >/dev/null 2>&1
    sleep 2.5
    ok "已代按「同意并联网」—— 本步验收的是跨设备同步，不同意联网它结构性不可能通过（实测：不同意时服务端一个请求都收不到）"
    return 0
  fi
  return 1
}

CREDS_OK=0

# 🔴 **回读"认证页真的出现了吗"**（判据是「邮箱」框，不是 press 的返回值）。
#    5 次：这台折叠屏上 RN 的按压**时灵时不灵**（第 8 轮实测 3 次全落空，
#    第 9 轮第一次即中）—— 3 次的预算在它上面不够分辨"夹具抖"和"产品坏了"。
if press_until "注册 / 登录" "邮箱" 5; then
  ok "已进入认证页（**回读到「邮箱」才判成功**）"
else
  bad "「注册 / 登录」按了 5 次都没进认证页 —— 夹具问题，不是产品问题"
  FIXTURE_UNRELIABLE=1
fi

if [ "$(jget "$(ax "验证并登录" --pressable --list --json)" found)" = "True" ] \
   || [ "$(jget "$(ax "粘贴邮件里的链接或令牌" --list --json)" found)" = "True" ]; then
  ok "已进入认证页（主路径）"
  # 🔴 2026-10-02 适配认证页改版（现在是 邮箱/登录密码/加密口令/服务器地址
  #    表单 + 底部「粘贴令牌 + 验证并登录」，页面比 678 的屏高约一倍）：
  #   · 「加密口令」「服务器地址」在**首屏**（y≈429/554）—— 先填；滚到页底
  #     之后它们就够不着了；
  #   · 🔴 「服务器地址」被新 UI 预填成 **10.0.2.2:3000 —— 那是 Android
  #     模拟器的宿主机地址**。iOS 模拟器与宿主机共用网络栈，必须用
  #     **127.0.0.1**；带着默认值同步实测报「当前离线」。
  #   · 「粘贴令牌」在折叠线以下（content y≈1265 > 678）—— 用
  #     `--scroll-into-view` 滚进可见区再填（第 5 轮的 swipe 起点落在
  #     tab 栏上、把页面切走的灾难见 shim 文件头）。
  #   · 「验证并登录」紧贴令牌框下方，滚完令牌它就在屏上。
  dismiss_ios_save_password || true
  set_field "加密口令" "$E2EE" --secure
  dismiss_ios_save_password || true
  set_field "服务器地址" "$HOST_SERVER"
  ax --dismiss-keyboard --json >/dev/null 2>&1
  SR=$(ax "粘贴邮件里的链接或令牌" --role AXTextField --scroll-into-view)
  if [ "$(jget "$SR" visible)" = "True" ]; then
    ok "「粘贴邮件里的链接或令牌」已滚进可见区（y=$(jget "$SR" y)，滚了 $(jget "$SR" swipes) 次）"
    set_field "粘贴邮件里的链接或令牌" "$ONETIME_TOKEN"
    dismiss_ios_save_password || true
    ax --dismiss-keyboard --json >/dev/null 2>&1
    SUB=$(ax "验证并登录" --pressable --scroll-into-view)
    if [ "$(jget "$SUB" visible)" != "True" ]; then
      bad "「验证并登录」滚不进可见区（scrollRc=$(jget "$SUB" scrollRc)）—— 退回兜底路径"
    fi
  else
    bad "「粘贴令牌」滚不进可见区（scrollRc=$(jget "$SR" scrollRc)）—— 退回兜底路径"
  fi
  if [ "$(jget "$(ax "验证并登录" --pressable --list --json)" found)" = "True" ]; then
    ok "认证页上有提交按钮「验证并登录」"
    # 🔴 先代按同意再提交（2026-10-02）：新账号的条款版本与设备已接受版本不同
    #    ⇒ 登录过程中会再弹一次同意面板（G-12 的设计行为）。它若在 Argon2id
    #    派生（~50 秒）的中途弹出，登录链被打断，120 秒窗口就不够了。
    #    提前清掉，让"派生 → 登录 → 同步" uninterrupted 地跑完。
    grant_network_consent_if_asked || true
    ax "验证并登录" --pressable --press --json >/dev/null 2>&1
    # 首次同步含纯 JS Argon2id 派生，实测约 50 秒 —— 给足时间，并轮询而不是定长 sleep。
    # 🔴 轮询期间**顺路处理两个会悄悄盖住页面的东西**：
    #    · 首启隐私同意门（登录也要联网）；
    #    · iOS「保存密码？」系统弹窗（填过 secure 字段后稍后弹出，见 dismiss 的注释）。
    # 🔴 「正在同步」busy = 凭据已进活配置、自动同步已开跑 —— 也是走通（第 6 轮实测：
    #    登录成功后自动同步抢先启动，按钮整个等待期都在 busy，按"空闲才算走通"
    #    会把成功的登录判成失败）。
    # 🔴 210 秒（2026-10-02，原 120）：派生 ~50s + 条款再确认 + 首轮同步，
    #    实测 120s 恰好被吃穿而登录其实随后完成（run11：兜底段 48s 后按钮已可用）。
    for _i in $(seq 1 70); do
      sleep 3
      _back=$(ax "立即同步" --pressable --list --json)
      if [ "$(jget "$_back" found)" = "True" ] && [ "$(jget "$_back" enabled)" = "True" ]; then
        CREDS_OK=1
        ok "🔴 主路径走通了：贴令牌 → 验证并登录 → 回到「我的」且「立即同步」已可用（等了 $((_i * 3)) 秒）"
        break
      fi
      if [ "$(jget "$(ax "正在同步" --pressable --list --json)" found)" = "True" ]; then
        CREDS_OK=1
        ok "🔴 主路径走通了：贴令牌 → 验证并登录 → 「正在同步」busy（凭据已进活配置，自动同步开跑；等了 $((_i * 3)) 秒）"
        break
      fi
      grant_network_consent_if_asked || true
      dismiss_ios_save_password || true
    done
    if [ "$CREDS_OK" -ne 1 ]; then
      # 🔴 真红（B10 已收口，2026-10-02）：现在贴的是真·邮件链接形态的一次性
      #    令牌（/api/test/mint-login-link 签发），走不通就是产品/夹具的真问题，
      #    不再有"令牌形态不匹配"这层降级借口。兜底路径仍会继续，凭据链路
      #    的判据不丢，但 summary 的失败计数里会如实记下这一条。
      bad "主路径未走通：贴一次性令牌 → 「验证并登录」后 210 秒内没回到可用状态 —— 真红，不是夹具缺口"
    fi
  else
    bad "认证页上找不到「验证并登录」—— 令牌可能没贴进去，退回兜底路径"
  fi
  if [ "$CREDS_OK" -ne 1 ]; then
    # 🔴 离开认证页**不能按「返回」**：它是 Link（frame x=406..450, y=6..50），
    #    在折叠屏 Duo 上正压在**灵动岛底下** —— 点它 = 点岛，AX 报成功而页面
    #    不动（2026-10-02 实测连点多次无效）。可靠的办法是**标签往返**：
    #    认证页随切标签一起收起，切回「我的」就是它的根页。
    ax "任务" --pressable --press --json >/dev/null 2>&1
    sleep 2
    ax "我的" --pressable --press --json >/dev/null 2>&1
    sleep 2
  fi
else
  bad "进不了认证页 —— 「注册 / 登录」点了没反应，退回兜底路径"
fi

# 🔴🔴 **兜底路径（2026-10-02 改版适配）：凭据表单已经整个搬进「设置」面。**
#
# 「我的」页上**已经没有**任何凭据输入框 —— 页面自己的提示原文：
# 「不登录也可以继续用；手动填写凭据的兜底路径在**「设置」**里。」
# 第 5 轮的四个"不在树上就跳过"正是按旧布局在「我的」页上找字段找出来的：
# **页面改版了，夹具还在按旧地图找路。**
#
# 另外两个第 5 轮实测出的坑，都修在下面：
#   · 「已离开认证页并到达『我的』」那条判据是**双重假绿**：「邮箱」早已
#     不在树上（切页造成的）→"离开"恒真；「服务器地址」在**认证页上也有**
#     （StaticText 标题）→"到达"假真。两件事都不该用"某标签在/不在"判。
#   · 「返回」Link 压在灵动岛底下点不到（见主路径同一段说明）→ 用
#     **标签往返**离开认证页。
dismiss_ios_save_password || true

if [ "${CREDS_OK}" -eq 1 ]; then
  ok "主路径已经把凭据配好 —— **跳过兜底路径的手动填写**"
else
  # ── 到达「我的」根页（判据：设置入口按钮，登不登录都在）─────────────
  if ! press_until "我的" "设置, 同步凭据、桌面小组件与语言" 3; then
    bad "切不回「我的」根页 —— 兜底填写一定失败，而它会伪装成「字段写不进去」"
    echo "   ── 现场：当时树上的标签 ──"
    for _l in "任务" "我的" "注册 / 登录" "返回" "立即同步" "新建任务" "先离线使用" "服务器地址" "邮箱"; do
      [ "$(jget "$(ax "${_l}" --list --json)" found)" = "True" ] && echo "     ✅ ${_l}"
    done
    FIXTURE_UNRELIABLE=1
  fi
  # ── 打开设置面（按钮本体在折叠线下，先滚进来再按）───────────────────
  SETB=$(ax "设置, 同步凭据、桌面小组件与语言" --pressable --scroll-into-view)
  if [ "$(jget "$SETB" visible)" != "True" ]; then
    bad "「设置」入口滚不进可见区（scrollRc=$(jget "$SETB" scrollRc)）—— 兜底路径无法继续"
  else
    ax "设置, 同步凭据、桌面小组件与语言" --pressable --press --json >/dev/null 2>&1
    sleep 2.5
    # 判据 = 表单里的「服务器地址」输入框出现（不能按「关闭」试错 —— 那会把面关掉）。
    SHEET_OK=0
    for _i in $(seq 1 10); do
      if [ "$(jget "$(ax "服务器地址" --role AXTextField --list --json)" found)" = "True" ]; then
        SHEET_OK=1; break
      fi
      sleep 1
    done
    if [ "$SHEET_OK" = "1" ]; then
      ok "已打开设置面（判据：表单里的「服务器地址」输入框在树上）"
      CLEAR_BTN=$(ax "清除本机保存的凭据" --pressable --list --json)
      if [ "$(jget "$CLEAR_BTN" found)" = "True" ] && [ "$(jget "$CLEAR_BTN" enabled)" = "True" ]; then
        ax "清除本机保存的凭据" --pressable --press --json >/dev/null 2>&1
        # 🔴 **等三个字段都出现，不要固定 `sleep`。**（原注释的实测仍成立：
        #    点完清除页面在重渲染，固定 sleep 会读到中间态，症状是
        #    "找不到『访问令牌』"，看着像"页面把框收起来了"。）
        FIELD_ROUND=0
        for _i in $(seq 1 15); do
          _f1=$(ax "服务器地址" --role AXTextField --list --json)
          _f2=$(ax "访问令牌" --role AXTextField --list --json)
          _f3=$(ax "端到端加密口令" --role AXTextField --list --json)
          if [ "$(jget "$_f1" found)" = "True" ] && [ "$(jget "$_f2" found)" = "True" ] && [ "$(jget "$_f3" found)" = "True" ]; then
            FIELD_ROUND=$_i; break
          fi
          sleep 1
        done
        if [ "$FIELD_ROUND" -ge 1 ]; then
          ok "已清除本机凭据，三个字段都就位（等了 $FIELD_ROUND 秒）—— 下面按确定初态填"
        else
          bad "15 秒内没有同时看到三个凭据字段 —— 页面状态不对，后面的填写会误报"
        fi
      else
        # 新 UI 的清除按钮**常驻**但空凭据时是禁用态 —— 禁用 = 全新设备的"没有可清除"。
        ok "本机没有可清除的凭据（全新设备，按钮为禁用态）—— 直接填"
      fi
      # 🔴 顺序：服务器地址 → 口令 → 令牌。旧 UI 的"口令必须在令牌之前"
      #    是因为写成功会把框收起；新 UI 不收起了，但把**令牌放最后**仍是
      #    最稳的 —— `configured` 只看 服务器地址+令牌，最后写令牌意味着
      #    中间任何一步被打断都不会留下"半配置"的歧义态。
      set_field "服务器地址" "$HOST_SERVER"
      set_field "端到端加密口令" "$E2EE" --secure
      set_field "访问令牌" "$TOKEN"
      # ── 关闭设置面（「关闭」在左上角，不在灵动岛底下，点得到）─────────
      press_until_gone "关闭" "关闭" 3 \
        || bad "设置面关不上 —— 「立即同步」的状态判据仍能在其上层判，但下一轮起点会脏"
    else
      bad "设置面没打开（找不到「服务器地址」表单）—— 兜底路径无法继续"
    fi
  fi
fi

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
#    🔴 收的方式改成 shim 的 `--dismiss-keyboard`（按 return 键）：
#       旧法"点页面标题区"在认证页/设置面上**不生效**（2026-10-02 实测），
#       且 return 键的标签随输入法语言变（中文「换行」/英文 'return'），
#       shim 内部按 trait + 候选标签组匹配。
for _ in 1 2 3; do
  KB=$(ax --dismiss-keyboard)
  [ "$(jget "$KB" present)" != "True" ] && break
  sleep 1
done
if [ "$(jget "$(ax --keyboard)" present)" = "True" ]; then
  bad "软键盘收不起来 —— 下面的「立即同步」会点到键盘上（这一条曾造成一整轮假红）"
else
  ok "软键盘已收起（否则「立即同步」的点击会被键盘吞掉）"
fi

# 🔴 **等到按钮回到空闲态，而不是只等 5 秒。**
#
# 按钮的文案是 `busy ? '正在同步…' : '立即同步'`（`ProfileScreen.tsx`）。
# 所以**只要有同步在跑，就找不到「立即同步」** —— 而首次同步含纯 JS Argon2id
# 派生，实测约 50 秒。只等 5 秒会在"刚好有同步在跑"时**假红**。
#
# 实测：这一条在 2026-09-29 的一轮里 **3 次红 2 次**，而每次的失败信息都只有
# "找不到按钮" —— 完全不可归因。等 + 打印现场之后才看清是 busy 态。
# ⚠️ **等的是 `found && enabled`，不是 `found`。**
#    这个按钮**一直都在**（`disabled={!configured}`）—— 变的只是 `enabled`。
#    所以"等它出现"等于没等：第一版就是这么写的，于是它立刻返回、
#    然后下面那条 `enabled` 断言红掉（`凭据填齐了但「立即同步」仍是禁用`）。
#    ⇒ 等待的**条件**本身写错了，这类错比超时更难发现 —— 因为它不超时。
SYNC_BTN='{"found":"False","enabled":"False"}'
SYNC_WAIT_ROUND=0
BUSY_SEEN=0
# 🔴 上限 40×3=120 秒**不够**：凭据一配好，自动同步就抢跑（notifyConfigured →
#    syncNow），而首次同步 = Argon2id 纯 JS 派生 + **全量历史下载解密** ——
#    第 6 轮实测远超 120 秒，等待超时的时候按钮还 busy 着。
# 🔴 「正在同步」busy **不是失败，是成功的前半段**：busy 只在凭据已写进活配置
#    后才会出现（按钮的 busy 分支本身要求同步已启动）。所以看到 busy 就记住
#    （BUSY_SEEN=1），超时也放行 —— 同步到底成没成，由下面的笔记本判据裁定。
for _i in $(seq 1 40); do
  SYNC_BTN=$(ax "立即同步" --pressable --list --json)
  if [ "$(jget "$SYNC_BTN" found)" = "True" ] && [ "$(jget "$SYNC_BTN" enabled)" = "True" ]; then
    SYNC_WAIT_ROUND=$_i; break
  fi
  if [ "$(jget "$(ax "正在同步" --pressable --list --json)" found)" = "True" ]; then
    if [ "$BUSY_SEEN" = "0" ]; then
      echo "     （「正在同步」busy 中 —— 凭据已生效，自动同步已开跑；继续等它跑完）"
    fi
    BUSY_SEEN=1
  fi
  sleep 3
done
if [ "$(jget "$SYNC_BTN" found)" = "True" ]; then
  ok "找到「立即同步」按钮 @($(jget "$SYNC_BTN" x),$(jget "$SYNC_BTN" y))（等了 $((SYNC_WAIT_ROUND * 3)) 秒）"
  if [ "$(jget "$SYNC_BTN" enabled)" = "True" ]; then
    ok "凭据填齐后「立即同步」已启用"
  else
    bad "凭据填齐了但「立即同步」仍是禁用 —— 字段没真的写进活配置"
  fi
  # 🔴 按下之后必须看 **result**，不能只"按下就算成功"。
  #    这一条以前是 `>/dev/null 2>&1` 加一句无条件的 ok —— 那正是上面那轮
  #    假红的入口：点击被键盘吞掉，脚本却报"已按下"。
  SYNC_PRESS=$(ax "立即同步" --pressable --press)
  # 🔴 首启隐私同意门：全新安装（0.5 步卸载重装）后第一次同步必被它拦 ——
  #    面板原文"还没有同意隐私规则……一个请求都没有发"。它**不报错、不红**，
  #    第 5 轮"好 op 没有离开待上传队列"的另一半根因就是它。
  #    本步验收的就是跨设备同步 ⇒ 不同意联网结构性不可能通过，代按并留痕。
  if grant_network_consent_if_asked; then
    SYNC_PRESS=$(ax "立即同步" --pressable --press)
  fi
  case "$(jget "$SYNC_PRESS" result)" in
    success)
      ok "已按下「立即同步」（Hermes 无 WebAssembly，纯 JS Argon2id 首次派生实测约 50 秒）"
      ;;
    tap-blocked-by-keyboard)
      bad "「立即同步」被键盘挡住，点击**没有到达按钮**（keyboardTop=$(jget "$SYNC_PRESS" keyboardTop), cy=$(jget "$SYNC_PRESS" cy)）"
      ;;
    *)
      # 🔴 not-found 有一个**良性的成因**：等待循环看到 enabled 的那一刻，
      #    自动同步可能抢先开跑 —— busy 时按钮文案变「正在同步…」，
      #    按旧标签就找不到了（第 8 轮实测）。同步已经自己在跑，不是失败。
      if [ "$(jget "$(ax "正在同步" --pressable --list --json)" found)" = "True" ]; then
        ok "按下时按钮已进入 busy（自动同步抢跑）—— 不需要再点，由笔记本判据裁定"
      else
        bad "按下「立即同步」失败：$(jget "$SYNC_PRESS" result)"
      fi
      ;;
  esac
elif [ "$BUSY_SEEN" = "1" ]; then
  # 🔴 整个等待期按钮都在 busy —— **不是失败**：busy 只在同步真的启动后才
  #    会出现，说明凭据已写进活配置、自动同步已在跑（第 6 轮实测，首次同步
  #    含全量历史下载，120 秒远远不够它跑完）。不再重复按按钮（syncNow 在
  #    busy 时直接返回当前状态，按了也没用），同步到底成没成由下面的
  #    笔记本判据裁定 —— 那才是端到端的判据。
  ok "「立即同步」整个等待期都在 busy（凭据已生效，自动同步在跑）—— 跳过按按钮，交给笔记本判据"
else
  bad "120 秒内「立即同步」既没空闲可用也没 busy（凭据没写进活配置）—— 无法验证跨设备"
  # 🔴 现场必须能回答"按钮在不在、在的话是什么文案"。
  #    ⚠️ shim **没有 `--dump`**（`ax - --dump` 会走 argparse 报错、静默输出空），
  #       所以这里改用宽泛 label 去问 —— 找得到就说明它在，只是**正忙**。
  echo "   ── 现场：按宽泛 label「同步」找 ──"
  ax "同步" --pressable --list --json 2>/dev/null | sed 's/^/     /' || true
  echo "   ── 现场：按宽泛 label「正在同步」找 ──"
  ax "正在同步" --pressable --list --json 2>/dev/null | sed 's/^/     /' || true
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
UPLOADED=$(sqlite3 "${PHONE_DB}" "SELECT json_extract(data,'\$.uploadStatus') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
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
# 🔴 不能赌"一次点击必然成功"（2026-10-02 实测红在这里）：第 5 步兜底路径
#    走完后 app 停在「我的」+ 可能残留设置面/键盘 —— 模态盖着标签栏时
#    "任务"点不到（第 1 步注释记过同一机制），而那一下的失败还被
#    >/dev/null 吞了。用与第 1 步同款的归一化循环：切 tab → 找 FAB，
#    失败则收键盘/收模态再试；FAB 的 press 结果才是判据。
FAB2="{}"
for _try in 1 2 3; do
  ax "任务" --pressable --press --json >/dev/null 2>&1
  sleep 2
  FAB2=$(ax "新建任务" --pressable --press --json)
  [ "$(jget "$FAB2" result)" = "success" ] && break
  ax --dismiss-keyboard --json >/dev/null 2>&1 || true
  for _modal in "关闭排序选择" "关闭" "取消" "以后再说" "返回" "完成"; do
    ax "$_modal" --pressable --press --json >/dev/null 2>&1
  done
  sleep 1
done
if [ "$(jget "$FAB2" result)" = "success" ]; then
  ok "再次打开 Composer"
else
  bad "打不开 Composer：$(jget "$FAB2" result)（归一化 3 轮后）"
fi
FIELD2=$(ax - --field --wait 10 --list --json)
if [ "$(jget "$FIELD2" found)" = "True" ]; then
  # 🔴 提交前先确保文字**真的进了应用**（fill_composer_title：AXSetValue 重试
  #    → HID 键盘兜底 → 「添加」启用态裁决）。原先 set 完就按，set 静默失败时
  #    按的是禁用态按钮 —— press 返回 success 而 nothing 提交（16:24 截图铁证）。
  if ! fill_composer_title "$TITLE2"; then
    bad "第二条没写成：文字没进 Composer（添加仍禁用，AXSetValue+HID 双路径）"
    summary "iOS 输入侧"
  fi
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
# 🔴 2026-10-02 两条修正：
#    1. 窗口 120 秒 → 360 秒：写入信号若撞上**一轮还在跑的同步**，op 要等
#       那轮结束才出去（auto-sync-core 的 gen 检查保证它不会丢，但会晚）；
#    2. 判据加一条**直接信号**：这条 op 自己的 uploadStatus 翻成 uploaded
#       （查手机真 SQLite，与第 5 步末尾同一个查法）。服务端日志是代理判据，
#       op 离开队列才是"它自己出去了"的本体。
UPLOAD_SEEN=0
for _i in $(seq 1 72); do
  sleep 5
  _n=$(sed -n "$((LOG_BASE + 1)),\$p" "$SERVER_LOG" 2>/dev/null | grep -cE '\[user:[0-9]+\] Upload')
  _up=$(sqlite3 "${PHONE_DB}" \
    "SELECT COUNT(*) FROM ops WHERE json_extract(data,'\$.op.payload.title')='$TITLE2' AND json_extract(data,'\$.uploadStatus')='uploaded';" 2>/dev/null | tr -d ' ')
  if [ "${_n:-0}" -ge 1 ] || [ "${_up:-0}" -ge 1 ]; then UPLOAD_SEEN=$_i; break; fi
done
if [ "$UPLOAD_SEEN" -ge 1 ]; then
  ok "第 $UPLOAD_SEEN 轮（约 $((UPLOAD_SEEN * 5)) 秒）确认写入自己出去了（服务端 Upload 日志或 op uploadStatus=uploaded）—— **全程没点过任何同步按钮**"
else
  bad "360 秒内服务端没有 Upload、op 也没离开待上传队列 —— 写入没有自动同步出去"
fi

# 判据 (b)：另一台设备真的读得到（把"上传了"补成"全链路")
ROUND2=$(wait_laptop_has "$TITLE2" 30); WAIT_RC2=$?
case "$WAIT_RC2" in
  0) ok "笔记本（node-host 真 SQLite）在第 $ROUND2 轮读到了「${TITLE2}」—— 没点按钮也走完了全链路" ;;
  2) bad "笔记本探针**自己**坏了（不是产品问题，不算同步失败）：$ROUND2" ;;
  *) bad "笔记本 150 秒内没读到第二条「${TITLE2}」" ;;
esac

# ── 7. 🔴 实时通道（**入站**方向）：服务端推，这台**不点也收到** ─────────────
#
# 第 6 步验的是**出站**（本地写入 → 上传）。实时通道的另一半从来没在设备上验过：
# **服务端主动推 → app 不点也收到、并把那条任务落进自己的库**。
#
# 🔴 为什么这一条**只能是设备上的端到端**：
# `buildRealtimeUrl` 的路径曾经是错的（`/ws`，而服务端注册在 `/api/sync/ws`），
# 而客户端测试用的是**假 WebSocket**（任何 URL 都接受），
# `packages/sync-client/tests/realtime.spec.ts` 还把那个**错路径逐字断言**了下来
# ⇒ **测试与实现一起错、14 道门禁全绿**。只有"对着真服务端连一次"才看得见。
# 协议层那条判据现在在 `scripts/verify-realtime-push.mjs`；**这一条验的是 app 自己**。
#
# 🔴 归因是干净的，不是"看起来像"：
# `auto-sync-core.ts` 的触发只有 `notifyLocalWrite` / `notifyForeground` /
# `notifyConfigured` 三处，**没有定时轮询**（它的注释写着"等 notifyForeground
# 或 notifyConfigured 再把它带出去"）。所以 app 在**前台闲置**时库里自己多出
# 那条任务，**只可能**来自推送。
step "7. 实时通道入站：app 前台闲置，笔记本上传，这台必须自己收到"

# (a) app 的 WebSocket **真的连上了** —— 由**服务端自己**数。
#     ⚠️ 不看 app 的内部状态：那只能证明"它以为自己连上了"。
WS_CONN=0
for _i in $(seq 1 12); do
  _raw=$(curl -s --noproxy '*' -m 4 "$HOST_SERVER/health" 2>/dev/null)
  _n=$(printf '%s' "$_raw" | grep -o '"wsConnections":[0-9]*' | head -1 | cut -d: -f2)
  if [ "${_n:-0}" -ge 1 ]; then WS_CONN=1; break; fi
  sleep 2
done
if [ "$WS_CONN" -ge 1 ]; then
  ok "服务端报告 wsConnections≥1 —— **app 的实时通道真的连上了**（那个 404 毁掉的正是这一条）"
else
  bad "服务端 wsConnections 一直是 0 —— app 的实时通道没连上（端点 / 令牌 / 订阅时机）"
fi

# (b) 让**另一台设备**（笔记本）写一条并上传。这段时间 app **一直前台、没人碰它**。
TITLE3="ios-realtime-$(date +%H%M%S)"
if laptop_ok add "$TITLE3" >/dev/null; then
  ok "笔记本建了一条：$TITLE3"
else
  bad "笔记本 add 失败 —— 入站这条判据没法继续"
fi
if laptop_ok sync >/dev/null; then
  ok "笔记本 sync 成功（服务端会向**其他客户端**广播 new_ops）"
else
  bad "笔记本 sync 失败 —— 服务端不会广播，这条判据会假红"
fi

# (c) 🔴 最强的那条：**那条任务**必须出现在 app 自己的库里，而没人碰过它。
#     只数"op 数涨了"是不够的 —— 涨的可能是一条无关的 op。
#     按 `payload.title` 找（与第 4 步同一个查法，那里的列名踩过坑：op id 在
#     `ix0_0` 而不是 `pk0`）。
INBOUND_ROUND=0
for _i in $(seq 1 45); do
  sleep 2
  _hit=$(sqlite3 "${PHONE_DB}" \
    "SELECT COUNT(*) FROM ops WHERE json_extract(data,'\$.op.payload.title')='$TITLE3';" 2>/dev/null | tr -d ' ')
  if [ "${_hit:-0}" -ge 1 ]; then INBOUND_ROUND=$_i; break; fi
done
if [ "$INBOUND_ROUND" -ge 1 ]; then
  ok "app 在第 $((INBOUND_ROUND * 2)) 秒**自己**收到了「${TITLE3}」—— 服务端推 → 收到 → 拉取落库，全程没人碰它"
else
  bad "90 秒内 app 库里没有「${TITLE3}」—— 推送没到，或到了没触发同步（两个都是真的失效）"
fi

summary "iOS 输入侧"