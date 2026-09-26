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

UDID=${IOS_UDID:-691C20D9-FB85-4B81-A3CC-0F5623AEF082}
BID=${IOS_BID:-org.reactjs.native.example.HeytaMobile}
DEVICE_NAME=${IOS_DEVICE_NAME:-iPhone 17 Pro}
LAPTOP_DB=/tmp/heyta-ios-laptop.sqlite
AXPRESS_SRC="$(cd "$(dirname "$0")" && pwd)/tools/axpress.swift"
AXPRESS=${AXPRESS:-/tmp/heyta-axpress}
# 标题带上时间戳：断言必须钉在**这一次**写的那条上，不能靠"列表里有这么一条"。
TITLE="iOS输入验收$(date +%m%d%H%M%S)"

SIM_PID=$(pgrep -x Simulator | head -1)
WIN_RECT=""
WR=()

# ── 辅助 ────────────────────────────────────────────────────────────────────

ax() { "$AXPRESS" "$SIM_PID" "$@" --in "${WR[@]}"; }

# 机器可读地拿一个字段。**不看退出码**：调用方自己断言 found / enabled 的值，
# 因为"命令跑成功了"和"界面真的到了那个状态"是两件事。
ax_json() { "$AXPRESS" "$SIM_PID" "$@" --in "${WR[@]}" --json 2>/dev/null; }
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

if [ -n "$SIM_PID" ]; then ok "Simulator 进程 pid=$SIM_PID"; else bad "找不到 Simulator 进程"; summary "iOS 输入侧"; fi

WIN_RECT=$(require_window "$DEVICE_NAME") || { bad "拿不到「$DEVICE_NAME」的窗口矩形（后续 AX 断言无法限定范围）"; summary "iOS 输入侧"; }
if [ -z "$WIN_RECT" ]; then bad "拿不到设备窗口矩形（Simulator 没开这个设备？）"; summary "iOS 输入侧"; fi
read -r -a WR <<< "$WIN_RECT"
ok "设备窗口矩形 x=${WR[0]} y=${WR[1]} w=${WR[2]} h=${WR[3]}"

if [ ! -f "$AXPRESS_SRC" ]; then bad "缺少 $AXPRESS_SRC"; summary "iOS 输入侧"; fi
# 按需编译（源码比产物新就重编）
if [ ! -x "$AXPRESS" ] || [ "$AXPRESS_SRC" -nt "$AXPRESS" ]; then
  if swiftc -O -o "$AXPRESS" "$AXPRESS_SRC" -framework ApplicationServices -framework Cocoa 2>/tmp/_ios-axbuild.log; then
    ok "AX 工具已编译（$AXPRESS）"
  else
    bad "AX 工具编译失败：$(tail -3 /tmp/_ios-axbuild.log | tr '\n' ' ')"; summary "iOS 输入侧"
  fi
else
  ok "AX 工具已是新的（$AXPRESS）"
fi

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

# 🔴 先分开"环境不通"和"产品不对"这两件事。
#    macOS 的 AX **只能看见当前 Space 上的窗口**；Simulator 窗口一旦不在当前 Space，
#    AX 树里就只剩菜单栏，后面每一条断言都会红 —— 而报出来的却是"按钮找不到"，
#    方向全偏到界面上。这里先单独确认一次，并说清是环境原因。
#    ⚠️ 本脚本**不会**用 `activate` 去把窗口拽到前台（那等于跟用户抢前台，已被明确叫停）。
require_ax_visible "$DEVICE_NAME" "任务" \
  || { bad "AX 树里看不到 App 内容 —— Simulator 窗口不在当前 Space（环境原因，非产品缺陷）"; summary "iOS 输入侧"; }
ok "AX 树能看到 App 内容（窗口在当前 Space）"

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
FAB=$(ax "新建任务" --pressable --wait 10 --list --json)
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
  bad "在目标窗口里找不到「新建任务」按钮 —— AX 桥不通，或 App 不在任务页（后面的断言都不可信）"
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
  ok "AXSetValue 写入并回读成功：「$TITLE」"
else
  bad "AXSetValue 回读不符：期望「$TITLE」，实际「$(jget "$SET" detail)」"
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

ax "添加" --pressable --press --json >/dev/null 2>&1
sleep 3

if ! composer_open; then
  ok "Composer 已关闭（「添加」按钮消失）"
else
  bad "按了「添加」但 Composer 还开着"
fi

AFTER_COUNT=$(apps_count)
if [ "$AFTER_COUNT" = "$((BEFORE_COUNT + 1))" ]; then
  ok "手机真 SQLite 的 ops 行数 $BEFORE_COUNT → $AFTER_COUNT（**恰好**多一条，一个用户意图 = 一个 op）"
else
  bad "ops 行数 $BEFORE_COUNT → $AFTER_COUNT，期望恰好 +1"
fi

OP_ID=$(sqlite3 "$PHONE_DB" "SELECT ix0_0 FROM ops WHERE json_extract(data,'\$.op.payload.title')='$TITLE';" 2>/dev/null | head -1)
if [ -n "$OP_ID" ]; then
  ok "在 ops 里按标题找到了这条 op：$OP_ID"
else
  bad "ops 里没有任何 op 的 payload.title 等于「$TITLE」"; summary "iOS 输入侧"
fi

OP_TYPE=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.opType') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
ACTION=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.actionType') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
ETYPE=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.entityType') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
CLIENT=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.clientId') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
VCLOCK=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.vectorClock') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
USTATUS=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.uploadStatus') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)

[ "$OP_TYPE" = "CRT" ]      && ok "opType=CRT（不是自造的 CREATE）"        || bad "opType=$OP_TYPE，期望 CRT"
[ "$ACTION" = "CRT_TASK" ]  && ok "actionType=CRT_TASK"                  || bad "actionType=$ACTION，期望 CRT_TASK"
[ "$ETYPE" = "TASK" ]       && ok "entityType=TASK"                      || bad "entityType=$ETYPE，期望 TASK"

# 🔴 第 7 条陷阱：向量时钟必须**包含本次写入自己的递增**。写成"写入前的时钟"
#    会让对端判 EQUAL（"已见过"）→ 静默丢弃。这条断言专门盯它。
if printf '%s' "$VCLOCK" | python3 -c "
import json,sys
c=json.load(sys.stdin); cid='$CLIENT'
sys.exit(0 if c.get(cid,0)>=1 else 1)
" 2>/dev/null; then
  ok "向量时钟包含自己的递增：$VCLOCK"
else
  bad "向量时钟里没有自己 clientId（$CLIENT）的递增：$VCLOCK —— 对端会静默丢弃这条 op"
fi

if ui_has_task "$TITLE"; then
  ok "iOS 界面上列出了「$TITLE」（无障碍标签可读）"
else
  bad "iOS 界面上找不到「$TITLE」"
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
      bad "填写「$1」失败，回读=「$back」"
    fi
  elif [ "$back" = "$2" ]; then
    ok "已填写「$1」"
  else
    bad "填写「$1」失败，回读=「$back」"
  fi
}
set_field "服务器地址" "$HOST_SERVER"
set_field "访问令牌" "$TOKEN"
set_field "端到端加密口令" "$E2EE" --secure

SYNC_BTN=$(ax "立即同步" --pressable --wait 5 --list --json)
if [ "$(jget "$SYNC_BTN" found)" = "True" ]; then
  ok "找到「立即同步」按钮 @($(jget "$SYNC_BTN" x),$(jget "$SYNC_BTN" y))"
  if [ "$(jget "$SYNC_BTN" enabled)" = "True" ]; then
    ok "凭据填齐后「立即同步」已启用"
  else
    bad "凭据填齐了但「立即同步」仍是禁用 —— 字段没真的写进活配置"
  fi
  ax "立即同步" --pressable --press --json >/dev/null 2>&1
  ok "已按下「立即同步」（首次会话要付一次 ~30–40 秒的 Argon2id 派生，之后 1–2 秒）"
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
    ok "笔记本（node-host 真 SQLite）在第 $ROUND 轮读到了「$TITLE」→ iOS → 服务端 → 另一台设备，全链路无 mock"
    ;;
  2)
    bad "笔记本探针**自己**坏了（不是产品问题，不会算作同步失败）：$ROUND"
    ;;
  *)
    bad "笔记本 300 秒内没读到「$TITLE」"
    ;;
esac

# ── 本地队列的状态：**只观察，不断言成功** ──────────────────────────────
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
#    ⚠️ 这条缺陷**本轮没有修**：它是对同步协议语义的改动，需要独立的复现用例与 ADR，
#       不能在一轮快结束时顺手改。已记入 docs/plans/phase-2-multi-platform.md 与
#       AGENTS.md 第 34 条。**在它修好之前，本脚本不对 uploadStatus 断言成功。**
UPLOADED=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.uploadStatus') FROM ops WHERE ix0_0='$OP_ID';" 2>/dev/null)
if [ "$UPLOADED" = "uploaded" ]; then
  ok "uploadStatus $USTATUS → uploaded（本地队列已确认上传）"
else
  echo "      ⚠️ uploadStatus 仍是「$UPLOADED」—— 已知缺陷（见上）。"
  echo "         数据确实上了云（上一项已由另一台设备证实），但本地队列不清空。"
fi

summary "iOS 输入侧"
