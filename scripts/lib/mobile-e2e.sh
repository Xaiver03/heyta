#!/bin/bash
#
# 移动端验收的公共辅助（由 scripts/verify-mobile-*.sh source）
# ================================================================
#
# 🔴 为什么抽出来：两个验收脚本（冲突闭环、任务编辑）需要**同一套**定位与断言辅助。
# 复制一份的后果不是"多写几个字"，而是两份会漂移 —— 而漂移的辅助会制造**假绿**：
# 一边修好了"在 dump 里 ≠ 可点"，另一边还按旧逻辑点，于是同一个界面状态，
# 一个脚本报通过、另一个报失败，而没人知道该信哪个。
#
# 调用方约定：
#   - 先 `set -u`、把 /opt/homebrew/bin 放进 PATH（`adb`/`psql` 在那里）；
#   - 用 `. "$(dirname "$0")/lib/mobile-e2e.sh"` source 本文件；
#   - 之后再定义自己的 TITLE 之类；
#   - 结束时调 `summary "<验收名>"`（用累计的 PASS/FAIL 决定退出码）。
#
# 🔴 本文件曾被一条写文件的方式写坏过一次：`open(p,'w').write(open(p).read()...)`
# 里外层 `open(p,'w')` **先把文件截断了**，内层读到空字符串，于是变成 0 字节。
# 改脚本文件时先把内容读进变量再写，别在同一个表达式里既开写又开读。

set -u
export PATH="/opt/homebrew/bin:$PATH"

ADB="adb -s emulator-5554"
PKG=com.heytamobile
APK="apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
CLI="apps/node-host/dist/cli.js"
# 允许调用方覆盖（两个验收各用一份笔记本库，否则会互相看到对方的任务）
LAPTOP_DB=${LAPTOP_DB:-/tmp/heyta-conflict-laptop.sqlite}

# 🔴 找一个**可以真正 spawn** 的 node，不要写 `NODE=$(command -v node)`。
#
# 实测（本仓库路径 + DSH 桌面运行时）：
#   `pnpm verify:mobile-ios` 里 `command -v node` 解析到的是
#     .../DSH Desktop/runtime-commands/generations/<hash>/private/node-bin/node
#   —— 一个**不能被 spawn** 的私有垫片。它跑 `node apps/node-host/dist/cli.js sync`
#   没有任何输出。
#
# 后果不是"脚本报错"，而是**最难查的一种**：`laptop()` 把 stderr 丢进 /dev/null，
# `wait_laptop_has` 又整条 `>/dev/null 2>&1`，于是
#   **"探针一次都没跑起来"** 和 **"另一台设备真的没收到数据"** 长得一模一样，
# 而且都表现为"笔记本 300 秒内没读到"。实测两轮验收都卡在这里，
# 而服务端日志证明 300 秒里**笔记本一条请求都没发过**。
#
# 判据要用"命令真的跑通了"，不是"PATH 里有叫 node 的东西"。
resolve_real_node() {
  [ -n "${HEYTA_NODE:-}" ] && { printf '%s' "$HEYTA_NODE"; return 0; }
  local c
  for c in \
    "$HOME/.nvm/versions/node/v22.22.3/bin/node" \
    "$HOME/.nvm/versions/node/v22.22.0/bin/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node; do
    [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done
  # 再退到 PATH，但跳过封装运行时的垫片
  local found
  found=$(which -a node 2>/dev/null | grep -v 'DSH Desktop' | grep -v 'runtime-commands' | head -1)
  if [ -n "$found" ] && [ -x "$found" ]; then printf '%s' "$found"; return 0; fi
  printf '%s' node
}
NODE=$(resolve_real_node)

TOKEN=$(cat /tmp/heyta_mobile_token.txt)
EMAIL=$(cat /tmp/heyta_mobile_email.txt)
E2EE=$(cat /tmp/heyta_mobile_e2ee.txt)
SERVER=http://10.0.2.2:3000
HOST_SERVER=http://127.0.0.1:3000

PASS=0; FAIL=0
ok()   { echo "   ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "   ❌ $1"; FAIL=$((FAIL+1)); }
step() { echo ""; echo "════ $1 ════"; }

# ── UI 辅助 ────────────────────────────────────────────────
# 抓一次界面快照到 /tmp/ui.xml。
#
# 🔴🔴 `uiautomator dump` 在**界面不空闲**时会失败
#     （`ERROR: could not get idle state`），而失败时它**不会覆盖** /sdcard/ui.xml ——
#     于是 `cat` 拿回来的是**上一次**的界面。
#
# 后果不是"少抓一次"，而是**断言读到的是过去的界面**：
#   - 计时器在跑的时候每 250ms 重绘一次，这个失败**必然**发生；
#   - 症状是"点了开始但状态没变"、"倒计时停在 00:00 不走"，而其实一切都正常；
#   - 更糟的是它也能造成**假绿**：上一步失败留下的界面恰好满足这一条的断言。
#     实测：专注验收里「暂停 → 继续」那一步，`继续` 明明生效了，
#     断言却读到了暂停时的快照，于是报"点了继续但状态没变"。
#
# 修法是两条，缺一不可：
#   1. **先删远端文件**，失败时 `cat` 得到空 → `/tmp/ui.xml` 被清空。
#      空快照会让断言**失败**，而不是让它读着过期数据通过。宁可假红，不可假绿。
#   2. 重试几次 —— "界面还在动"通常几秒后就结束了。
dump() {
  local tries
  for tries in 1 2 3 4 5; do
    $ADB shell rm -f /sdcard/ui.xml >/dev/null 2>&1
    $ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    $ADB shell cat /sdcard/ui.xml > /tmp/ui.xml 2>/dev/null
    grep -q '<hierarchy' /tmp/ui.xml 2>/dev/null && return 0
    sleep 1
  done
  echo "   ⚠️ uiautomator dump 连续 5 次都没抓到界面（一直不空闲？）—— 后续断言读的是空快照" >&2
  return 1
}

# 按 content-desc 定位任意节点（按钮、标签）
xy_desc() {
  python3 /tmp/_xy.py desc "$1" 0
}
# 🔴 只认输入框：标签和输入框的 desc 相同，必须靠 class 区分
xy_edit() {
  python3 /tmp/_xy.py edit "$1" 0
}
xy_edit_any() {
  python3 /tmp/_xy.py editany "" 0
}
# 按可见文本定位（第 2 个参数是"第几个"，用于两个同名按钮）
xy_text() {
  python3 /tmp/_xy.py text "$1" "${2:-0}"
}
has_text()  { grep -q "text=\"$1\"" /tmp/ui.xml && echo 1 || echo 0; }
# 安全输入框（`secureTextEntry`）的内容**永远不出现在 dump 里**，节点上只有
# `password="true"`。所以「口令填对了吗」这件事无法用 UI dump 证明。
has_secure(){ grep -q 'password="true"' /tmp/ui.xml && echo 1 || echo 0; }
# 🔴 `has_text` 是**整节点精确匹配**（`text="..."` 后面必须紧跟引号）。
# 状态行是「有 1 处冲突待你选择」这种拼接过的句子，用精确匹配永远查不到 ——
# 那会让一条**已经出现**的冲突被记成"没出现"。
has_sub()   { grep -q "text=\"[^\"]*$1" /tmp/ui.xml && echo 1 || echo 0; }
# 按 content-desc 精确匹配。勾选框、按钮这类节点的可辨识名在 `content-desc` 上，
# 而不是 `text` —— 用 `has_text` 查它们**永远是 0**，于是"没找到"会被误记成"没生效"。
has_desc()  { grep -q "content-desc=\"$1\"" /tmp/ui.xml && echo 1 || echo 0; }

# 等「我的」页出现「已是最新」。
#
# 🔴 首次同步要付一次 Argon2id 密钥派生。Hermes 没有 WebAssembly，走纯 JS ——
# 官方实测 30–40 秒；而**宿主机负载高时会久得多**（实测 load average 45、
# 还有一个 iOS 模拟器抢 CPU 时，超过了 125 秒）。
# 窗口给足是必须的：否则"慢"会被报成"失败"，而失败现场的界面**看起来就像
# 产品坏了**（状态停在"正在上传…"），排查方向会被带到同步协议上去。
wait_synced() {  # <轮数>，每轮 5 秒；默认 60 轮 = 300 秒
  # **成功时回显耗时的秒数**（打印到 stdout，调用方用 $(...) 接）。
  # 为什么要回显：第一次同步要付一次纯 JS 的 Argon2id 派生，而这段耗时
  # **完全取决于宿主机负载** —— 实测同一份代码在 load 3 时约 40 秒，
  # 在 load 43–151 时超过 300 秒。回显耗时让日志能区分"慢"和"卡死"；
  # 不回显的话，两者在日志里长得一模一样。
  local n=${1:-60}
  local i
  for i in $(seq 1 "$n"); do
    sleep 5
    dump
    if [ "$(has_text "已是最新")" = "1" ]; then printf '%s' "$((i * 5))"; return 0; fi
  done
  return 1
}

# 等**另一台设备**真的能拉到某条任务（成功时回显轮数）。
#
# 🔴 为什么不看本机的「已是最新」就下结论：那是本机的一个**内部状态标签**，
# 而这一步要证的是**数据跨了设备**。两者在正常情况下同时发生，但在
# **宿主机负载高、Hermes 没有 JIT** 时，界面标签可能要几分钟才更新，
# 而数据其实早就到了 —— 于是"慢"被报成"失败"，
# 而失败现场（状态停在"正在上传…"）**看起来就像产品坏了**，
# 排查方向会被整体带到同步协议上去。
# 按结果判成功就不受这个影响：数据到了就是到了。
#
# 每次 `laptop sync` 在 V8 上只花约 0.6 秒派生密钥（有 JIT），
# 所以轮询它比轮询手机界面**便宜得多**。
wait_laptop_has() {  # <标题> <轮数>，每轮 5 秒；默认 60 轮 = 300 秒
  # 🔴 返回码区分三件事，**不许合并**：
  #     0 = 读到了（回显轮数）
  #     1 = 探针工作正常，但对端确实没数据（真的失败）
  #     2 = **探针自己坏了**（回显最后一条原始输出）—— 这不是产品缺陷
  #   合并 1 和 2 的后果实测过：`$NODE` 解析成 DSH 的私有垫片时
  #   `laptop sync` 静默失败，300 秒里服务端**一条请求都没收到**，
  #   而报告写的是"笔记本 300 秒内没读到" —— 排查方向被整体带到同步协议上。
  local title="$1" n="${2:-60}" i sync_ok=0 last_err=""
  for i in $(seq 1 "$n"); do
    [ "$i" -gt 1 ] && sleep 5
    local out; out=$(laptop_raw sync)
    if printf '%s' "$out" | grep -q '"ok":true'; then
      sync_ok=$((sync_ok + 1))
    else
      last_err=$(printf '%s' "$out" | tail -1)
    fi
    if laptop list --all | grep -q "$title"; then printf '%s' "$i"; return 0; fi
  done
  if [ "$sync_ok" = "0" ]; then
    printf '%s' "NODE=$NODE；laptop sync 一次都没成功，最后一条输出：${last_err:-（空）}"
    return 2
  fi
  return 1
}

# 按 content-desc 把一个节点**滚进可点区域**并返回坐标（失败返回空）。
# 用于面板里被 ScrollView 裁掉的控件 —— 见 `desc-sane` 的注释。
scroll_to_desc() {
  for _ in 1 2 3 4 5; do
    dump
    XY=$(python3 /tmp/_xy.py desc-sane "$1" 0)
    if [ -n "$XY" ]; then printf '%s' "$XY"; return 0; fi
    $ADB shell input swipe 540 1900 540 1100 300; sleep 1.5
  done
  return 1
}

# 把一个节点**滚进可点区域**并返回坐标（失败返回空）。
scroll_to_text() {
  for _ in 1 2 3 4 5; do
    dump
    XY=$(python3 /tmp/_xy.py text-sane "$1" 0)
    if [ -n "$XY" ]; then printf '%s' "$XY"; return 0; fi
    $ADB shell input swipe 540 1900 540 1100 250; sleep 1.5
  done
  return 1
}

# 按标签点一个控件，成功时回显点到的坐标（失败返回 1，坐标为空）。
#
# 🔴 RN 的 `Button` 到底把标签放在 `text` 还是 `content-desc` 上，
# 取决于它内部有没有设 `accessibilityLabel` —— 用单一方式去找，
# 找不到时会被误记成"按钮没生效"。两种都试，找不到就明确失败。
#
# ⚠️ 原来这个函数**只写在 `verify-mobile-focus.sh` 里**，于是日历验收
# 直接 `tap_label: command not found`，第 3 步（首次同步）静默失败、
# 后面每一步都在错的前提下继续跑。两个脚本要用的东西就放这里 ——
# `mobile-e2e.sh` 的文件头已经写过一次这个教训了（复制一份 = 迟早漂移）。
tap_label() {  # <标签>
  local xy
  xy=$(scroll_to_desc "$1")
  if [ -z "$xy" ]; then xy=$(scroll_to_text "$1"); fi
  if [ -z "$xy" ]; then echo ""; return 1; fi
  $ADB shell input tap $xy; echo "$xy"
}

# ── 软键盘开关 ──────────────────────────────────────────────
# 🔴 **不要用 `keyevent 111`（ESC）来收键盘。** 它会把 RN 的 `Modal` 关掉
# （新建面板直接消失），在根界面甚至会把应用关掉 —— 而凭据**只在内存里**，
# 应用一重启就全没了，表现为"令牌过一会儿自己变空了"，排查方向会完全跑偏。
#
# 正确做法是让软键盘根本不出现：`input text` 是把按键事件**直接注入 InputManager** 的，
# 只要有焦点视图就生效，**不需要 IME 可见**。所以整个验收期间把 IME 关掉，
# 结束时再打开（`trap` 保证异常退出也会恢复）。
IMES=$($ADB shell ime list -s 2>/dev/null | tr -d '\r' | grep -v '^$')
disable_ime() {
  for ime in $IMES; do $ADB shell ime disable "$ime" >/dev/null 2>&1; done
  # AVD 带硬件键盘（hw.keyboard=yes），这条让软键盘不再弹出
  $ADB shell settings put secure show_ime_with_hard_keyboard 0 >/dev/null 2>&1
}
restore_ime() {
  for ime in $IMES; do $ADB shell ime enable "$ime" >/dev/null 2>&1; done
  $ADB shell settings put secure show_ime_with_hard_keyboard 1 >/dev/null 2>&1
}
trap restore_ime EXIT
screen_txt(){
  python3 - <<'PY'
import re
s=open('/tmp/ui.xml',encoding='utf-8',errors='replace').read()
seen=[]
for m in re.finditer(r'<node[^>]*?>', s):
    t=re.search(r'\stext="([^"]*)"',m.group(0))
    if t and t.group(1).strip() and t.group(1).strip() not in seen:
        seen.append(t.group(1).strip())
for v in seen: print('      •',v)
PY
}

clear_and_type() {  # 先全选删除再输入，绝不循环 DEL（会 ANR）
  $ADB shell input keycombination 113 29; sleep 0.6
  $ADB shell input keyevent 67; sleep 0.8
  $ADB shell input text "$1"; sleep 1.5
}

# 🔴 笔记本设备的一条命令。**返回 JSON**，成败由调用方从 `ok` 字段读 ——
# 不用退出码，因为 `... | tail -1` 的退出码永远是 0。
laptop() {
  $NODE "$CLI" "$@" --db "$LAPTOP_DB" --server "$HOST_SERVER" \
    --token "$TOKEN" --password "$E2EE" --json 2>/dev/null | tail -1
}
# 与 `laptop()` 的唯一区别：**不吞 stderr**。
# 用来判断"探针本身能不能跑"，所以必须看得见失败原因 —— 见 `wait_laptop_has`。
laptop_raw() {
  $NODE "$CLI" "$@" --db "$LAPTOP_DB" --server "$HOST_SERVER" \
    --token "$TOKEN" --password "$E2EE" --json 2>&1
}
laptop_ok() {  # <命令...> —— 输出 JSON，成功时返回 0
  local out; out=$(laptop "$@")
  if printf '%s' "$out" | grep -q '"ok":true'; then return 0; fi
  echo "      $out" >&2; return 1
}
laptop_title_of() {  # <id> —— 从 list --all 里取标题
  laptop list --all | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
print(next((t['title'] for t in d.get('tasks',[]) if t['id']=='$1'),''))
"
}

# ── iOS 的 I/O：idb（**从设备内部**驱动）────────────────────────────────────
#
# 🔴 为什么不再用宿主 AX（`axpress.swift` 那套）
#
#    macOS 的 AX **只能看见「当前 Space」上的窗口**（AGENTS §7 第 37 条）。
#    模拟器窗口一到别的桌面，AX 树里就只剩菜单栏 —— 于是"读不到任何控件"，
#    而截图里 App 明明渲染得好好的。
#
#    想"修"它只有两条路：把窗口拽到用户面前（**抢前台**，实测被用户明确叫停），
#    或者干脆**不碰窗口**。后者才是对的：
#
#      `idb`（facebook/idb，MIT）通过 companion 直接和模拟器通信，
#      无障碍树、点击、输入**全部在设备内部完成** ——
#      不需要窗口存在、不需要窗口在哪个 Space、不需要焦点、不需要辅助功能权限。
#
#    实测（iOS 26.5 模拟器窗口 `on=0`，即不在当前 Space）：
#      `idb ui describe-all` 返回完整可访问性树（402x874 设备坐标）
#      `idb ui tap 351 808`  + `idb ui text "MYTOKEN123"` 真的生效
#    对照：`mac click <pid> … bg`（postToPid）**不生效**，页面毫无变化。
#
# 🔴 标签匹配是**子串匹配**，会撞车 —— 不要用 `idb ui tap <标签>`。
#    实测 marker「访问令牌」命中的是那段说明文字（"…但访问令牌会以明文经过网络…"），
#    而不是下面的输入框（AGENTS §7 第 38 条）。所以一律走 `idb-find.py` 自己算坐标。

IDB_BIN=${IDB_BIN:-}
IDB_COMPANION=${IDB_COMPANION:-}
IDB_DUMP_FILE=${IDB_DUMP_FILE:-/tmp/_heyta-idb-dump.json}
IDB_FIND=""
IDB_UDID=${IDB_UDID:-}

# 按候选列表解析**能真的跑**的 idb。不要写死 'idb' ——
# 本仓库已经因为"PATH 上的东西不等于能用的东西"栽过一次（AGENTS §7 第 35 条）。
resolve_idb() {
  [ -n "$IDB_BIN" ] && [ -x "$IDB_BIN" ] && [ -n "$IDB_COMPANION" ] && [ -x "$IDB_COMPANION" ] && return 0
  local c
  for c in "$HOME/.heyta-tools/idb/venv/bin/idb" /tmp/idb/venv/bin/idb; do
    if [ -x "$c" ]; then IDB_BIN="$c"; break; fi
  done
  for c in "$HOME/.heyta-tools/idb/idb_companion" /tmp/idb/idb_companion; do
    if [ -x "$c" ]; then IDB_COMPANION="$c"; break; fi
  done
  if [ -z "$IDB_BIN" ] || [ -z "$IDB_COMPANION" ]; then
    echo "   ❌ 找不到 idb。iOS 验收需要它来**从设备内部**驱动界面" >&2
    echo "      （宿主 AX 只能看见当前 Space 的窗口，不抢前台就用不了）。" >&2
    echo "      安装：bash scripts/install-idb.sh" >&2
    return 1
  fi
  if [ -z "$IDB_FIND" ]; then
    IDB_FIND="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/tools/idb-find.py"
  fi
  return 0
}

idb_ui() { "$IDB_BIN" --companion-path "$IDB_COMPANION" ui "$@" --udid "$IDB_UDID"; }

# 无障碍树只从这一个入口取，落到文件再交给解析器
# （`cmd | python3 - <<'PY'` 的 heredoc 会顶掉管道 —— AGENTS §7 第 36 条）。
idb_dump() { idb_ui describe-all > "$IDB_DUMP_FILE" 2>/dev/null; }

# 元素中心坐标。**精确标签 + 角色约束**，见本段开头那条子串撞车的说明。
idb_center() { python3 "$IDB_FIND" "$IDB_DUMP_FILE" "$1" "$2"; }
idb_field_center() { idb_center field "$1"; }
idb_label_center() { idb_center label "$1"; }
idb_field_value() { python3 "$IDB_FIND" "$IDB_DUMP_FILE" value "$1"; }
idb_has() { python3 "$IDB_FIND" "$IDB_DUMP_FILE" has "$1"; }
idb_enabled() { python3 "$IDB_FIND" "$IDB_DUMP_FILE" enabled "$1"; }

# 点一个输入框并输入。用 `ui text` 而不是 `ui set-value` ——
# 实测 set-value 返回退出码 0 但**值没变**（AGENTS §7 第 38 条）。
# 🔴 要给一个**已经有内容**的输入框赋值，必须**三击全选**再输入。
#
#    实测过的每一条死路（都返回 0，但都不生效）：
#      `ui set-value`（含空串）          → 值纹丝不动
#      `ui key <a> --command`（Cmd+A）   → 没选中
#      `ui key-sequence 42 …`（退格）    → 事件被合并，60 次只删掉 21 个字符
#      `ui key 42` 逐次重试              → 删到一半就永久停住
#
#    最后一条的死因很隐蔽：一旦输入框失去内容，**光标被重置到位置 0**，
#    后面的退格就全落在开头之前，看起来像"退格键坏了"。
#    而 `ui tap` 是**在光标处插入**，不是追加 —— 直接输入会把新 URL 拼进旧 URL 里。
#
#    正确做法：`ui multi-tap --count 3` 是 iOS 的**三击全选**，随后 `ui text` 即替换。
idb_type_into() {  # <标签> <文本>
  local xy
  xy=$(idb_field_center "$1") || return 1
  idb_ui multi-tap $xy --count 3 >/dev/null 2>&1 || return 1
  sleep 1
  idb_ui text "$2" >/dev/null 2>&1 || return 1
  sleep 1
}

# 等一个**精确标签**出现，返回 0/1。
#
# 🔴 为什么必须有这个：本 App 的「立即同步」按钮**会随状态改名** ——
#    空闲时是「立即同步」，同步中变成「正在同步…」，而同步是**带指数退避重试**的
#    （`createRetryScheduler`，2s→60s），所以"上一次失败的后台重试"随时可能把按钮变成 busy。
#    按标签点它就会偶发地找不到 —— 又一次"名字会在同一个会话里变"的坑。
#    所以点之前先**等它回到空闲的那个名字**，而不是假设它一直在。
idb_wait_label() {  # <标签> [超时秒]
  local want=$1 timeout=${2:-60} i=0
  while [ "$i" -lt "$timeout" ]; do
    idb_dump
    idb_has "$want" && return 0
    sleep 3
    i=$((i + 3))
  done
  return 1
}

# 点一个有该标签的按钮/标签项。
#
# 🔴 先等标签出现（默认 90s）——「立即同步」在 busy 时不叫这个名字，
#    直接点会偶发失败，而失败会伪装成"填写/点击失败"，归因完全歪掉。
idb_tap_label() {  # <标签>
  local xy
  idb_wait_label "$1" 90 || return 1
  xy=$(idb_label_center "$1") || return 1
  idb_ui tap $xy >/dev/null 2>&1
}

# ── 目标窗口矩形（iOS 与 Android 的 iOS 侧验收共用）─────────────────────────
#
# 🔴 必须拿到目标设备窗口在**全局屏幕坐标**里的矩形，并传给 axpress 的 `--in`：
#    同一台机器上另一个模拟器可能也开着同一个 App，按钮描述**逐字相同**，
#    不限定就会点到另一个设备的界面上（实测确实如此）。
#
# 🔴 **不要用 `System Events` 取窗口。** 它依赖**辅助功能权限**，而那个权限
#    丢了之后 System Events 对**每一个**应用都返回 `count of windows = 0`
#    （实测连明明开着的 Chrome 也是 0），于是这里报"没有窗口"——
#    看起来像"模拟器窗口没了"，实际是**探针的权限没了**（AGENTS §7 开头那条）。
#    所以改用 `scripts/tools/winrect.swift`（CGWindowListCopyWindowInfo），
#    它只要**屏幕录制**权限（截图本来就要用），不需要辅助功能权限。
#
# 有且只有这一份实现 —— 两个验收脚本都 source 本文件。
WINRECT=${WINRECT:-/tmp/heyta-winrect}
WINRECT_SRC=""
find_window() {  # <设备名前缀>  →  stdout: "x y w h"
  local device=${1:-${DEVICE_NAME:-iPhone 17 Pro}}
  # 仓库根：本文件在 <root>/scripts/lib/ 下
  if [ -z "$WINRECT_SRC" ]; then
    WINRECT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/tools/winrect.swift"
  fi
  if [ ! -x "$WINRECT" ] || [ "$WINRECT_SRC" -nt "$WINRECT" ]; then
    echo "   编译窗口定位工具…" >&2
    swiftc -O -o "$WINRECT" "$WINRECT_SRC" -framework Cocoa >&2 || return 3
  fi
  "$WINRECT" Simulator "$device"
}

# iOS 侧 AX 树的 dump 只从这一个入口取，落到文件再交给解析器。
#
# 🔴 **故意叫 `ax_dump` 而不是 `dump`** —— 本文件上面那个 `dump()` 是 **Android**
#    的 uiautomator 快照（`/tmp/ui.xml`）。两种设备、两种格式、同一个动作名，
#    叫同一个名字就是在制造漂移：改一个会静默影响另一个。
#
# 🔴 为什么必须落文件、不能直接管道：
#    `ax - --dump | python3 - <<'PY'` 里 **heredoc 会顶掉管道**，
#    python 读到的是被当程序吃掉的那段 heredoc，管道里的 dump **一个字节都读不到**
#    （AGENTS §7 第 36 条）。所以数据走文件、程序走 heredoc，两条通道分开。
#
# 依赖调用方定义 `ax()`（各验收脚本都有自己的写法）。
AX_DUMP_FILE=${AX_DUMP_FILE:-/tmp/_heyta-ax-dump.txt}
ax_dump() { ax - --dump > "$AX_DUMP_FILE" 2>/dev/null; }

# 🔴 **AX 只能看见当前 Space 上的窗口。** 这是 macOS 的系统约束。
#    窗口不在当前 Space 时，AX 树里只剩菜单栏 —— 症状是"界面上一无所有 / 一个控件都没有"，
#    而截图里 App 明明渲染得好好的。**这是环境，不是产品缺陷。**
#
#    🔴 **绝不要用 `osascript ... activate` 去"修"它。** 那会把窗口拽到用户面前，
#    等于**跟用户抢前台** —— 实测这样做几次之后用户直接叫停（"别跟我抢前台"）。
#    读不到就**停**，并说清楚原因，让用户/操作者自己决定什么时候让窗口可见。
#
#    用法：require_ax_visible <设备名前缀> <用来确认 AX 树通了的文案>
require_ax_visible() {  # <设备名前缀> <marker 文案>
  local device=$1 marker=$2
  ax_dump
  grep -q "desc=「${marker}」" "$AX_DUMP_FILE" 2>/dev/null && return 0
  echo "   ❌ AX 树里看不到「${marker}」。" >&2
  echo "      最可能的原因：Simulator 的「${device}」窗口**不在当前 Space**，" >&2
  echo "      而 macOS 的 AX **只能看见当前 Space 上的窗口**（系统约束，绕不过去）。" >&2
  echo "      另外也可能是 App 没在跑 / 没渲染完。" >&2
  echo "      → 手动把那个模拟器窗口切到当前桌面再跑，本脚本**不会**替你去抢前台。" >&2
  return 1
}

# 取不到就**大声失败**，而不是让后续断言对着空矩形跑（那会点到别的窗口上）。
require_window() {  # <设备名前缀>
  local rect rc
  rect=$(find_window "$1"); rc=$?
  if [ "$rc" -ne 0 ] || [ -z "$rect" ]; then
    case "$rc" in
      1) echo "   ❌ 找不到「$1」的窗口（模拟器没开？还是窗口被关了？）" >&2 ;;
      2) echo "   ❌ 「$1」匹配到多个窗口，标题要写具体" >&2 ;;
      3) echo "   ❌ 窗口定位工具编译失败" >&2 ;;
      *) echo "   ❌ 取窗口矩形失败（退出码 $rc）" >&2 ;;
    esac
    return 1
  fi
  printf '%s' "$rect"
}

# ── 定位器（写成独立文件，避免在脚本里嵌套 heredoc）────────
cat > /tmp/_xy.py <<'PY'
import re, sys
mode, want, nth = sys.argv[1], sys.argv[2], int(sys.argv[3])
s = open('/tmp/ui.xml', encoding='utf-8', errors='replace').read()

if mode == 'editval':
    # 返回某个输入框的**当前文本**（按 content-desc 找，只认 EditText）。
    # 用来断言"打开的面板绑定的是**这一条**任务"——只断言面板出现了
    # 是拦不住"面板拿到了上一条任务的快照"这种 bug 的。
    vals = []
    for m in re.finditer(r'<node[^>]*?>', s):
        tag = m.group(0)
        if 'class="android.widget.EditText"' not in tag:
            continue
        d = re.search(r'content-desc="([^"]*)"', tag)
        if (d.group(1) if d else None) != want:
            continue
        t = re.search(r'\stext="([^"]*)"', tag)
        vals.append(t.group(1) if t else '')
    print(vals[nth] if len(vals) > nth else '')
    raise SystemExit

hits = []
for m in re.finditer(r'<node[^>]*?>', s):
    tag = m.group(0)
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
    if not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
    is_edit = 'class="android.widget.EditText"' in tag
    d = re.search(r'content-desc="([^"]*)"', tag)
    t = re.search(r'\stext="([^"]*)"', tag)
    desc = d.group(1) if d else None
    text = t.group(1) if t else None
    if mode == 'desc' and desc == want:
        hits.append((cx, cy))
    elif mode == 'edit' and is_edit and desc == want:
        hits.append((cx, cy))
    elif mode == 'editany' and is_edit:
        hits.append((cx, cy))
    elif mode == 'text' and text == want:
        hits.append((cx, cy))
    elif mode == 'desc-sane' and desc == want:
        # 与 text-sane 同一个理由：面板的 ScrollView 会把下半部分**裁掉**，
        # 被裁的节点照样在无障碍树里，但 top > bottom（负高度）。
        # 实测：任务详情面板里的「优先级」芯片是 [426,2141][531,2100]，
        # 按 desc 取到的"中心点"(478,2120) 落在裁掉的区域 —— 点下去什么都不会发生，
        # 而调用方看到坐标拿到了、以为点成功了。
        if y2 > y1 and cy < 2100:
            hits.append((cx, cy))
    elif mode == 'text-sane' and text == want:
        # 🔴 「在 dump 里」不等于「可点」。ScrollView 折叠线以下的节点**仍然会**
        # 出现在无障碍树里，但 `bounds` 的 top 会大于 bottom（负高度）——
        # 它的"中心点"落在**底部标签栏**上，按坐标点下去会切到别的标签页。
        # 实测：「我的」屏的「逐条处理」就是这样，一点就跳去了「专注」。
        # 所以只有高度为正、且中心在标签栏之上（<2100）才算数。
        if y2 > y1 and cy < 2100:
            hits.append((cx, cy))
hits.sort()
if len(hits) > nth:
    print(f"{hits[nth][0]} {hits[nth][1]}")
PY

# ── 流程：填同步凭据 ────────────────────────────────────────
# 填同步凭据（服务器地址 / 访问令牌 / 端到端加密口令）。两个验收脚本都要用，
# 所以放在共享库里 —— 这段里踩过的坑很密（见内注释），复制一份就等于
# 一份修好了、另一份还按旧逻辑跑，而两边都声称自己验过。
configure_sync_credentials() {
  disable_ime; sleep 2
  $ADB shell input tap 945 2253; sleep 3   # 「我的」
  dump
  # 🔴 每填完一个字段**立刻收起键盘**，理由有两条，都实测踩过：
  #
  #   1. 键盘弹起时这一屏会被推挤，「端到端加密口令」的输入框移到了键盘下面。
  #      此时按 dump 拿到的坐标点下去，命中的是键盘而不是输入框。
  #   2. `clear_and_type` 的第一步是 CTRL+A + 删除。**没有焦点时它删的是
  #      当前真正有焦点的那个字段** —— 于是"填口令"这一步把刚填好的**令牌清空了**，
  #      而每步的局部断言都还是 ✅（填的那一刻确实是对的）。
  #
  # 局部断言抓不住这种"后一步破坏前一步"，所以下面还有一条**三个值同时仍在**的终态断言。
  for pair in "服务器地址|$SERVER" "访问令牌|$TOKEN" "端到端加密口令|$E2EE"; do
    desc="${pair%%|*}"; val="${pair#*|}"
    dump
    XY=$(xy_edit "$desc")
    if [ -z "$XY" ]; then bad "找不到输入框：$desc"; continue; fi
    $ADB shell input tap $XY; sleep 1.2
    clear_and_type "$val"
    dump
    if [ "$desc" = "端到端加密口令" ]; then
      # 🔴 口令是 `secureTextEntry`，**内容永远不会出现在 dump 里**
      # （节点只有 `password="true"`）。所以这里不假装能核对它 ——
      # 口令填错/没填的真正证据是后面**首次同步失败**（解不开服务端已有的密文）。
      if [ "$(has_secure)" = "1" ]; then
        ok "已填 $desc（安全字段，dump 看不到内容；由首次同步成功来证明）"
      else bad "$desc 找不到（没有 password=\"true\" 节点）"; fi
    else
      if [ "$(has_text "$val")" = "1" ]; then ok "已填 $desc"
      else bad "$desc 没填进去"; fi
    fi
  done
  dump
  MISSING=""
  [ "$(has_text "$SERVER")" = "1" ] || MISSING="$MISSING 服务器地址"
  [ "$(has_text "$TOKEN")" = "1" ] || MISSING="$MISSING 访问令牌"
  [ "$(has_secure)" = "1" ] || MISSING="$MISSING 端到端加密口令"
  if [ -z "$MISSING" ]; then ok "三个凭据字段同时都在（没有被后一步清掉）"
  else bad "这些字段丢了：$MISSING"; fi
  [ "$(has_text "填好服务器地址与访问令牌后才能同步。")" = "1" ] \
    && bad "界面仍认为未配置（凭据没生效）" || ok "界面认为已配置"
}

# ── 收尾 ────────────────────────────────────────────────────
# 每个脚本自己报验收名，但"通过几项 / 失败几项 / 退出码"只有这一处定义 ——
# 两个脚本各写一份的话，迟早一个是 `-gt 0` 另一个是 `-ne 0`。
summary() {  # <验收名>
  echo ""
  echo "════════════════════════════════════════"
  echo "  通过 $PASS 项，失败 $FAIL 项"
  if [ "$FAIL" -eq 0 ]; then
    echo "  ✅ $1：真机全链路通过"
  else
    echo "  ❌ 有失败项"
  fi
  exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
}
