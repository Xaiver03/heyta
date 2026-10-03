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

# 「别的验收在跑吗」的探针。用 BASH_SOURCE 而不是 `$0` 的 dirname：本文件是被
# source 的，`$0` 是**调用方脚本**的路径（可能是绝对路径、也可能从 scripts/ 下起）。
. "$(dirname "${BASH_SOURCE[0]:-$0}")/mobile-e2e-runner-probe.sh"

# 🔴 设备号**只有一个住处**：`$E2E_SERIAL`。打印它的脚本一律引用这个变量，
#    不要再抄一遍字面量 —— 实测 9 个 `verify-mobile-*.sh` 的横幅硬编码
#    `emulator-5554`，而设备换到 5556 时它们照打 5554：跑的是对的机器，
#    取证输出里写的是另一台（下次换设备时这份输出会把人引去查一台根本没跑的机器）。
E2E_SERIAL="${HEYTA_E2E_SERIAL:-emulator-5554}"
ADB="adb -s $E2E_SERIAL"
PKG=com.heyta
# 🔴 这两个**必须**是绝对路径，不能是"仓库根相对"。
#
#    实测：脚本一旦不是从仓库根跑（例如 `cd scripts && bash verify-mobile-ios.sh`），
#    `apps/node-host/dist/cli.js` 就解析成 `scripts/apps/...` —— node 直接
#    `Cannot find module` 崩掉。而笔记本探针只把**错误的最后一行**报上来，
#    正好是 `Node.js v22.22.3`（node 崩溃横幅的尾巴），看起来像"探针自己坏了"。
#
#    那次的表现是：同一份脚本、同一台设备，从仓库根跑 32/32 全绿，从 `scripts/`
#    跑就"笔记本探针坏了"。探针的 rc=2 分类（探针坏了 ≠ 对端没有）恰好把方向
#    挡在了同步协议之外，所以没有误导成产品缺陷 —— **但根因是路径，不是探针**。
HEYTA_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APK="$HEYTA_REPO_ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
CLI="$HEYTA_REPO_ROOT/apps/node-host/dist/cli.js"
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

# 🔴 这三个路径以前是**写死的**，而生产它们的那份库（`mobile-e2e-fresh-account.sh:49-51`）
#    早就把它们参数化成 `HEYTA_E2E_*_FILE` 了 —— 写者可换、读者不可换，
#    于是"给这一轮开一份私有凭据"会得到一次**静默的脑裂**：号建到私有文件里，
#    验收脚本仍从 `/tmp/heyta_mobile_token.txt` 读**别人那一轮的**令牌。
#    症状不是报错，是"用错了账号"：`pm clear`、op 数、跨设备断言全都落在别人的身份上。
#    默认值与原字面量逐字相同 ⇒ 不给变量时行为一字不变。
TOKEN=$(cat "${HEYTA_E2E_TOKEN_FILE:-/tmp/heyta_mobile_token.txt}")
EMAIL=$(cat "${HEYTA_E2E_EMAIL_FILE:-/tmp/heyta_mobile_email.txt}")
E2EE=$(cat "${HEYTA_E2E_E2EE_FILE:-/tmp/heyta_mobile_e2ee.txt}")
# 🔴 端口**必须**跟 `mobile-e2e-up.sh` 的 `PORT` 走，不能写死 3000。
#
# 那个脚本早就支持 `PORT` 了，而这里写死 —— 于是"换个端口起栈"会得到一个
# **极具误导性**的失败：验收脚本去连 3000 上**别人的进程**（本机实测有一个
# 别的项目的 vite 占着 3000），拿到的是它的 HTML 而不是 heyta 的 JSON。
# 症状会分成两层，两层都指向错误的方向：
#   - 建号失败 → 报"服务端是否以 TEST_MODE 运行？"（而真正的问题是**连错了服务端**）；
#   - 同步步骤失败 → 看起来像同步协议坏了。
# `10.0.2.2` 是模拟器眼里的宿主机，所以两处端口必须同时改。
E2E_PORT="${PORT:-3000}"
SERVER=http://10.0.2.2:${E2E_PORT}
HOST_SERVER=http://127.0.0.1:${E2E_PORT}

PASS=0; FAIL=0
ok()   { echo "   ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "   ❌ $1"; FAIL=$((FAIL+1)); }
step() { echo ""; echo "════ $1 ════"; }

# 有没有**别的**移动端验收正在跑（排除自己）。输出那一行进程（没有则输出空）。
#
# 🔴 为什么需要它：这些脚本都会 `pm clear` + 装包 + 按坐标点击，
#    **同一台模拟器上并行跑两个 = 互相把对方的应用状态清掉**。症状是
#    满屏"找不到按钮""应用没起来" —— 看起来像产品坏了，其实只是撞车。
#    这种"环境造成的假红"必须能被**说出来**，而不是让人去猜。
#
# 🔴 匹配规则**不在这里**：唯一实现在 `lib/mobile-e2e-runner-probe.sh`。
#    那个文件没有 trap，所以 dry-run 类的消费者（`verify-mobile-window-gate.sh`）
#    可以 source 它 —— 而它们**不能** source 本文件（本文件尾的 EXIT trap 会真动设备）。
#    旧写法用 `bash [^ ]*…`，跨不过本仓路径里的空格，对被快照成 `.snap.<pid>` 的
#    运行者**永久隐形**；原因、夹具与自检写在那个文件头。
#
# ⚠️ `$$` 在命令替换的子 shell 里仍是**父 shell 的 pid**（bash 的规定），
#    但那个子 shell **自己的 pid 却不是** `$$` —— 而它的 argv 与本脚本逐字相同
#    （`ps` 里就是一行 `bash scripts/verify-mobile-auth.sh`）。所以只排除 `$$`
#    会把**自己**当成"别人"（实测踩过：脚本刚启动就报"还有别的验收在跑"）。
#    因此探针同时排除 `$$` 的**直接子进程**（`ppid == me`）。
another_mobile_e2e_running() {
  mobile_e2e_runner_lines
}

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
  # 🔴 5 次不够：同步进行中界面一直在动，实测要等好几秒才会安静下来。
  # 代价只是变慢，而"抓不到"的代价是整轮结论作废。
  for tries in 1 2 3 4 5 6 7 8 9 10; do
    $ADB shell rm -f /sdcard/ui.xml >/dev/null 2>&1
    $ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    $ADB shell cat /sdcard/ui.xml > /tmp/ui.xml 2>/dev/null
    if grep -q '<hierarchy' /tmp/ui.xml 2>/dev/null; then
      # 🔴 **系统 ANR 弹窗要当场关掉，否则整轮验收都在看弹窗。**
      #
      # 实测（2026-09-26，宿主机 load average 66~233）：模拟器的 System UI
      # 会 ANR，弹出一个 "System UI isn't responding / Close app / Wait" 的
      # **系统对话框**盖住应用。此时 dump 是成功的、`<hierarchy` 也在 ——
      # 但里面**一个输入框都没有**，于是脚本报"找不到输入框：服务器地址"，
      # 方向被引去怀疑界面改版，而真正的原因跟应用毫无关系。
      #
      # 这类"探针成功、内容是被别的东西盖住的"最费时间，所以在这里统一处理：
      # 认出 ANR 弹窗 → 点「Wait」→ 重新抓一次，让调用方拿到真正的界面。
      if grep -q "isn't responding\|is not responding\|无响应" /tmp/ui.xml 2>/dev/null; then
        local anr_xy
        anr_xy=$(python3 /tmp/_xy.py text "Wait" 0 2>/dev/null)
        [ -z "$anr_xy" ] && anr_xy=$(python3 /tmp/_xy.py text "等待" 0 2>/dev/null)
        [ -z "$anr_xy" ] && anr_xy=$(python3 /tmp/_xy.py text "Close app" 0 2>/dev/null)
        if [ -n "$anr_xy" ]; then
          echo "   ⚠️ 检测到系统 ANR 弹窗（宿主机过载），点掉它再重抓界面" >&2
          $ADB shell input tap $anr_xy >/dev/null 2>&1
          sleep 3
          # 🔴 **点掉弹窗之后必须把应用拉回前台。**
          #
          # 实测（2026-09-26）：ANR 弹窗关掉后，前台会落到**别的应用**上
          # （那次是 Google 搜索）。后续的 `input text` 就全部打进了那个应用的
          # 输入框 —— 日志里能看到口令被重复输入 7 次、旁边还跟着
          # `• Search Google`。脚本报的是"口令没填进去"，
          # 而真相是**它在给另一个应用打字**。
          #
          # 这类错误最坏的地方是它会**污染后面的步骤**：应用状态没变，
          # 但屏幕上全是垃圾输入。所以这里必须纠正前台，不能只关弹窗。
          ensure_app_foreground
          sleep 2
          continue
        fi
      fi
      return 0
    fi
    sleep 1
  done
  # 🔴 **抓不到界面时不要在这里 `exit` —— 有些"不空闲"是正常的。**
  #
  # 实测（2026-09-27）：`wait_synced` 会在**同步进行中**反复 dump，而同步时
  # 界面上的 `ActivityIndicator` 一直在动 → 窗口永远不空闲 → dump 连续失败。
  # 一次清单验收的 12 次 dump 失败**全部**落在"手机同步"那一步，就是这个原因。
  # 在那里退出会把一个**预期内**的状态判成环境故障，把好轮次也毙掉。
  #
  # 但也**不能让它静静地失败**：`cat` 会把 `/tmp/ui.xml` **截成空文件**，
  # 于是后面每条断言都在读空快照、全都报"找不到 X"。一次 run 因此出现过
  # **13 条失败**，日志读起来像一堆产品缺陷，真正的原因却只有一个、且与应用无关。
  #
  # 所以分工是：
  #   - `dump` 自己：软失败（返回 1）+ 提高重试预算，并**大声**说清后果；
  #   - 调用方：在"必须在真实界面上断言"的地方用 `require_screen`，
  #     由**它**决定是否终止整轮（退出码 3 = 这轮在环境上不成立，不是产品失败）。
  echo "" >&2
  echo "   ⚠️ uiautomator 连续 10 次抓不到界面（设备不空闲 / 宿主机过载）。" >&2
  echo "      **/tmp/ui.xml 已被截成空文件** —— 接下来任何断言都会报「找不到 X」，" >&2
  echo "      那是假红，不是产品缺陷。需要在真实界面上断言的地方请用 require_screen。" >&2
  echo "      本机负载：$(uptime | sed 's/.*load averages: //')" >&2
  return 1
}

# 🔴 **要求此刻拿到的是一张真实界面**，否则终止整轮。
#
# 用在"下一步要在界面上找东西/点数"之前。抓到空快照时**必须**停下来：
# 继续跑只会把一次环境问题伪装成一长串产品缺陷。
#
# 退出码 3（**不是** 1）：1 = "有断言失败"，3 = "这轮在环境上就不成立"。
# 两者的处置完全不同，不能混成一个数字。
require_screen() {
  if grep -q '<hierarchy' /tmp/ui.xml 2>/dev/null; then return 0; fi
  echo "" >&2
  echo "   ❌ 拿不到真实界面 —— **本轮结果无效**（环境失败，不是产品失败）。" >&2
  echo "      本机负载：$(uptime | sed 's/.*load averages: //')。等空闲后重跑。" >&2
  exit 3
}

# 反复 dump 直到界面上出现这个串（找不到就返回 1，**不改判据的颜色** ——
# 调用方后面那句 `bad` 照样会报，只是它报之前已经给过界面这么多秒）。
#
# 🔴 为什么需要：`dump()` 自己会重试到"抓到 hierarchy"为止，但 hierarchy 抓到了
#    **不等于那已经不是上一屏**。实测两处：
#      · 切换标签后固定 `sleep 3` 再 dump —— RN 在宿主机有内存压力时渲染不完，
#        于是"找不到「立即同步」按钮"红了，而手点同一个坐标再 dump 按钮就在屏上；
#      · 有一步**根本没 dump**，读的是上一步留下的界面 —— 那就不是概率问题，是恒红。
#    固定 sleep 是在猜时间；这里改成"看到为止"，最多 `轮数 × 间隔` 秒。
settle_for() {  # <界面上应当出现的串> [轮数=8] [间隔秒=2]
  local needle=$1 tries=${2:-8} gap=${3:-2} i
  for ((i = 0; i < tries; i++)); do
    dump
    grep -qF -- "$needle" /tmp/ui.xml 2>/dev/null && return 0
    sleep "$gap"
  done
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
# 🔴 只认**在可点区域里**的输入框（与 `desc-sane` / `text-sane` 同一条理由）：
#    ScrollView 折叠线以下的节点**仍然在无障碍树里**，但 `bounds` 的 top > bottom
#    （负高度），它的"中心点"落在键盘或标签栏上 —— 按坐标点下去会点到别的东西，
#    而调用方看到坐标拿到了、以为点成功了。
#    注册/登录面板比一屏长（三个字段 + 同意项 + 六个动作），必然会用到它。
xy_edit_sane() {
  python3 /tmp/_xy.py edit-sane "$1" 0
}
# 读某个输入框**当前实际内容**。
#
# 🔴 为什么必须有这个：`input text` 在宿主机高负载时会**静默丢字符**。
#    实测（2026-09-26，load average 66~233 / 16 核）：225 字符的令牌只落地
#    28~33 个字符，而 `input text` 的**退出码仍然是 0**。
#    于是脚本报"没填进去"，方向被引去怀疑应用 —— 而应用没问题，是输入没送到。
#    有了读回，才能"发现少了什么、把缺的补上"，而不是赌它一次成功。
edit_value() {  # <标签>
  python3 /tmp/_xy.py editval "$1" 0
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
# content-desc 的**前缀**匹配。与 `has_sub` 同理，只是查 desc。
# 用于"文案尾部会变"的节点（例如同步按钮在 busy 时是「正在同步…」）。
has_desc_sub() { grep -q "content-desc=\"[^\"]*$1" /tmp/ui.xml && echo 1 || echo 0; }

# 等「我的」页出现「已是最新」。
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
  #
  # 🔴 两种**都算同步跑完了**的终态，不能只认第一种：
  #
  #   1. 「已是最新」—— 全都同步到了；
  #   2. 「……已跳过 —— 其余数据已同步」—— 这是 ADR-0016 规定的**如实上报**：
  #      历史里混着别的口令写的 op，读得了的都应用了，读不了的被点名列出。
  #      这**不是失败**，设备的数据已经是完整的（在该口令下能拿到的部分）。
  #
  # 只认第一种的后果是：一台**已经修好、行为完全正确**的设备被验收判红。
  # 而"假红"比"假绿"更贵 —— 它会让人去改本来正确的东西。
  #
  # ⚠️ 这里刻意**不**匹配宽泛的「同步」二字：那会把「同步失败」也放进来，
  # 于是一条**不能失败**的判据就把"半瘫"判成了通过。匹配的是**只在这个
  # 降级成功态里才出现**的短语。
  #
  # 🔴 而且必须用 `has_sub`，**不能用 `has_text`**：状态行是拼接出来的整句
  # （`有部分历史数据用当前口令解不开（…），已跳过 —— 其余数据已同步`），
  # 而 `has_text` 是**整节点精确匹配**（`text="…"` 后面必须紧跟引号）。
  # 本轮第一版就是这么写错的：判据永远为假，于是**手机已经同步成功**
  # （界面上的状态行就写着"其余数据已同步"），`wait_synced` 却空转到 180 轮。
  # 本文件里 `has_sub` 上面那段注释早就记录过同一个坑 —— 状态行不要用精确匹配。
  local n=${1:-60}
  local i
  for i in $(seq 1 "$n"); do
    sleep 5
    dump
    if [ "$(has_sub "已是最新")" = "1" ]; then printf '%s' "$((i * 5))"; return 0; fi
    if [ "$(has_sub "其余数据已同步")" = "1" ]; then printf '%s' "$((i * 5))"; return 0; fi
  done
  return 1
}

# 触发一次手机同步：按「立即同步」再等结果。
#
# 🔴 **这一步一度写在 `verify-mobile-lists.sh` 里**，而标签验收要的是同一件事
#    （同一个按钮、同一个等待、同一条"按坐标点的是**上一次** dump 的树"的坑）。
#    放在共用库里的理由是它**不是清单的业务语义** —— 它纯粹是"驱动这台设备"，
#    与 `wait_synced` / `dump` / `require_screen` 是同一类东西。
#    各写一份的话，"按钮改了位置"这种改动会只修一处。
#
# ⚠️ `xy_text` 读的是**上一次 dump 的树**。不重新 dump 就会拿着别的页面的
#    坐标去点 —— 清单验收的第一版就在这里报过"找不到「立即同步」"。
phone_sync() {
  dump
  local ax_xy; ax_xy=$(xy_text "立即同步")
  if [ -z "$ax_xy" ]; then bad "找不到「立即同步」"; return 1; fi
  $ADB shell input tap $ax_xy; sleep 5
  wait_synced 180
}

# 发起一次手机同步（**自动同步感知**）。只负责"让它开始"，**不等结算** ——
# 各调用点的等待逻辑不同（有的数 900 秒、有的要判冲突）。
#
# 🔴 为什么不能写 `XY=$(xy_text "立即同步"); $ADB shell input tap $XY`：
#
#   1. **空坐标**。自动同步上线后，busy 时按钮的文案是「正在同步…」
#      （`ProfileScreen` 里 `label={busy ? … : …}`）。此时 locator 返回空，
#      而 `input tap` 拿空参数去执行 → adb 抛
#      `Argument expected after "tap"`。**脚本一行都不报** ——
#      它没点到任何东西，而验收照样绿（实测：3 次，最终 35/35 全绿）。
#      这正是本仓库最忌讳的那种**不能失败的检查**：
#      "点了一下同步"和"什么都没点"在报告里长得一样。
#   2. **重复点没有意义**。`syncNow()` 在 `busy` 时直接返回当前状态（不排队），
#      所以"已经在跑"时该做的是**等**，不是再点一下。
#
# 🔴 **必须查 `content-desc`，不能查 `text`。** 这是实测踩到的第二层：
#
#    `Button` 在 `loading` 时渲染的是
#        `{loading ? <ActivityIndicator/> : <><Icon/><RNText>{label}</RNText></>}`
#    —— **只有菊花，没有文字节点**。于是同步进行中时：
#        · `text="立即同步"`     → 不存在
#        · `text="正在同步…"`    → **也不存在**（busy 文案只挂在 accessibilityLabel 上）
#    所以"查不到按钮"这件事本身**不能推出**"按钮不在这一屏"。
#    第一版就是因为查 `text` 而误报了三条 `bad`（同步其实正在正常进行）。
#    （本库 `has_desc` 上面那条注释早就写了这条规矩 —— 我写这个函数时违反了它。）
#
# 三种情况，**没有一种是静默的**：
#   · desc 里有「立即同步」   → 真的点下去（先确认坐标非空）
#   · desc 里有「正在同步…」 → 自动同步抢先了，不重复点，打印一行说明
#   · 两者都没有               → 真的不在这一屏 → `bad` + 返回 1
#
# ⚠️ 这也意味着：在自动同步已经抢跑的情形下，"首次同步成功"这条断言
#    验的是**自动同步**而不是那个按钮。日志会明确打印是哪一种，
#    不会让读者以为按钮被测过。
ensure_phone_sync() {
  dump
  if [ "$(has_desc "立即同步")" = "1" ]; then
    local xy; xy=$(xy_desc "立即同步")
    if [ -z "$xy" ]; then bad "「立即同步」的 desc 在但取不到坐标"; return 1; fi
    $ADB shell input tap $xy
    echo "     已点「立即同步」@ $xy"
    return 0
  fi
  if [ "$(has_desc_sub "正在同步")" = "1" ]; then
    echo "     （自动同步已经在跑：按钮处于 loading，只渲染菊花 —— 所以这里查的是 content-desc）"
    return 0
  fi
  bad "同步按钮既不空闲也不在忙（desc 里既没有「立即同步」也没有「正在同步…」）"
  return 1
}

# 等手机报出冲突。**返回三态**，不是布尔。
#
# 用法：wait_conflict <轮数>；每轮 4 秒。回显 "conflict" / "uploading" / "none"。
#
# 🔴 为什么必须是三态：
#   第一版（两个调用点都）只轮询 12×4=48 秒，然后
#       [ 有冲突 ] && ok || bad "没报冲突"
#   于是**超时被当成了"冲突没触发"**。而失败现场的屏幕是
#       • 正在上传…   • 待上传 1 项
#   —— 同步**根本还没跑完**。这台模拟器跑一次同步实测 160–220 秒
#   （Hermes 无 WebAssembly，Argon2id 走纯 JS，再叠加宿主机高负载），
#   48 秒差得远。结果是把**环境慢**误判成**并发检测有 bug**，
#   然后去改一段本来正确的代码。
#
#   区分开之后：
#     conflict  → ✅ 真的触发了
#     uploading → ⏳ 还在跑，判不了（环境问题，不是产品结论）
#     none      → ❌ 同步**已结算**却没有冲突，这才是真的失败
wait_conflict() {  # <轮数>，每轮 4 秒；默认 90 轮 = 360 秒
  local n=${1:-90}
  local i
  local saw_uploading=0
  for i in $(seq 1 "$n"); do
    sleep 4
    dump
    if [ "$(has_sub "处冲突待你选择")" = "1" ]; then printf '%s' "conflict"; return 0; fi
    # 没有冲突、也不在上传 → 同步已结算，冲突就是不存在的
    if [ "$(has_sub "正在上传")" = "0" ]; then printf '%s' "none"; return 0; fi
    saw_uploading=1
  done
  if [ "$saw_uploading" = "1" ]; then printf '%s' "uploading"; else printf '%s' "none"; fi
  return 0
}

# 当前是否**真的**还有未解决的冲突。回显 1 / 0。
#
# 🔴 为什么不能直接 `has_sub "处冲突待你选择"`：
#    冲突提示挂在**「我的」页**上。如果调用时屏幕停在「任务」或「日历」页，
#    这段文字当然**不存在** —— 于是"冲突已解决"会在**没看对屏幕**的情况下判为真。
#
#    实测（2026-09-26 冲突验收）：步骤 8 因此报了 `✅ 冲突已解决`，
#    而同一步的下一句是 `❌ 手机没显示笔记本那一版`，7b 的屏幕又明确是
#    `• 有 1 处冲突待你选择` —— 三条证据互相矛盾，真相是**那次解决根本没生效**，
#    `✅` 是假阳性。
#
#    更贵的是它会**级联**：后面所有步骤都建立在一个不存在的前提上，
#    于是连爆一串看不懂的失败，排查方向被彻底带偏。
#
#    所以判据必须**先导航到承载该提示的屏幕**，再判存在性。
conflict_pending() {  # 回显 1（还有冲突）/ 0（没有）
  $ADB shell input tap 945 2253 >/dev/null 2>&1   # 「我的」tab
  sleep 3
  dump
  has_sub "处冲突待你选择"
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
    # 🔴 "跑起来了"不等于"全绿"。`undecryptable-ops` 是一次**真的执行了**的同步：
    #    它把能读的 op 都应用了、游标也推进了，只是服务端上有几条是**别的口令**
    #    写下的、永远读不了（详见 sync-client 的 `download()`）。
    #    这里如果只认 `"ok":true`，那么服务端上只要存在一条这种历史 op，
    #    这个探针就会永远判成"探针自己坏了"（rc=2）—— 而它其实完全正常，
    #    真正的判据在下面那行"标题读没读到"。
    #    这正是"一个没验干净的判据不该有权定性整轮验收"的同一条纪律。
    if printf '%s' "$out" | grep -qE '"ok":true|undecryptable-ops'; then
      sync_ok=$((sync_ok + 1))
    else
      last_err=$(printf '%s' "$out" | tail -1)
    fi
    if laptop list --all | grep -q "$title"; then printf '%s' "$i"; return 0; fi
  done
  if [ "$sync_ok" = "0" ]; then
    printf '%s' "NODE=${NODE}；laptop sync 一次都没成功，最后一条输出：${last_err:-（空）}"
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

# 把一个**输入框**滚进可点区域并返回坐标（失败返回空）。
# 与 `scroll_to_text` 同一形状，只是限定 EditText（标签和输入框的 desc 相同，
# 不限定就会点到那行标签文字上 —— `xy_edit` 上面那条注释记着这件事）。
scroll_to_edit() {
  for _ in 1 2 3 4 5; do
    dump
    XY=$(xy_edit_sane "$1")
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
# 🔴 探针必须带超时（traps #114，2026-10-02 实测）：模拟器 adbd 挂死时
#    `adb shell` 会**无限挂**，而这条在 **source 期**执行 —— 一台卡住的
#    Android 模拟器能把所有 source 这份 lib 的验收（**包括 iOS 那份**）
#    都钉死在 0 输出，症状完全不像"模拟器坏了"。超时 ⇒ IMES 为空 ⇒
#    下面的 disable/restore 对空集是无操作，不放大伤害。
ADB_TIMEOUT_CMD="$(command -v timeout >/dev/null 2>&1 && echo 'timeout 10' || true)"
IMES=$(${ADB_TIMEOUT_CMD} $ADB shell ime list -s 2>/dev/null | tr -d '\r' | grep -v '^$')
disable_ime() {
  for ime in $IMES; do ${ADB_TIMEOUT_CMD} $ADB shell ime disable "$ime" >/dev/null 2>&1; done
  # AVD 带硬件键盘（hw.keyboard=yes），这条让软键盘不再弹出
  ${ADB_TIMEOUT_CMD} $ADB shell settings put secure show_ime_with_hard_keyboard 0 >/dev/null 2>&1
}
restore_ime() {
  for ime in $IMES; do ${ADB_TIMEOUT_CMD} $ADB shell ime enable "$ime" >/dev/null 2>&1; done
  ${ADB_TIMEOUT_CMD} $ADB shell settings put secure show_ime_with_hard_keyboard 1 >/dev/null 2>&1
}
trap restore_ime EXIT

# 启动应用（冷启动或已经在后台都能用）。
#
# 🔴 为什么**不能**写 `am start -n $PKG/.MainActivity`：改名之后
#    `applicationId`（`com.heyta`）与 `namespace`（`com.heytamobile`）**不是同一个**，
#    而 `.MainActivity` 会被 `am` 按**命令里给的那个包名**展开 ——
#    于是它去找 `com.heyta.MainActivity`，真正的类却是
#    `com.heyta/com.heytamobile.MainActivity`（由 `namespace` 决定）。
#
#    后果不是"报错"，而是**更难查的那一种**：`am start` 失败、输出被
#    `>/dev/null` 吞掉，而模拟器上装过的**改名前的 `com.heytamobile`** 还留在前台 ——
#    它长得一模一样。于是脚本报"应用没起来"或"找不到新建按钮"，
#    而截图里明明有一个界面在跑。
#
# `launch_app` 让**系统自己**解析启动项，与包名/命名空间无关。
# ⚠️ 它**不** force-stop：调用方要冷启动时自己先 force-stop（现有脚本都这样做）。
#    在这里顺手杀进程会把"从后台拉回前台"变成"冷启动"，而后台路径上的
#    内存凭据会一起没掉（见下面 `ensure_app_foreground` 的注释）。
launch_app() {
  local component
  component=$($ADB shell cmd package resolve-activity --brief "$PKG" 2>/dev/null | tail -1 | tr -d '\r')
  case "$component" in
    "$PKG"/*) $ADB shell am start -n "$component" >/dev/null 2>&1 ;;
    *) $ADB shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 ;;
  esac
}

# 把 heyta 拉回前台。
#
# 🔴 为什么需要它：系统 ANR 弹窗关掉之后，前台**不一定**回到应用 ——
#    实测落到了 Google 搜索上，后续 `input text` 全部打进了那个搜索框
#    （日志里口令被重复 7 次，旁边跟着 `• Search Google`）。
#    脚本报"字段没填进去"，而真相是**在给别的应用打字**。
#
# 用 `launch_app`（它先解析出**真正的组件名**，`am start` 是确定的）——
# 而不是 `am start -n $PKG/.MainActivity`，后者在改名之后指向一个不存在的类。
ensure_app_foreground() {
  local cur
  cur=$($ADB shell dumpsys activity activities 2>/dev/null | grep -m1 topResumedActivity | sed 's/.*u0 //;s/ .*//')
  case "$cur" in
    "$PKG"/*) return 0 ;;
  esac
  echo "   ↻ 前台是 ${cur}，把 $PKG 拉回来" >&2
  # 🔴 用 `monkey`（见 `launch_app` 的注释）：`am start -n "$PKG/.MainActivity"`
  #    在改名之后指向一个不存在的类，会**静默失败**并把前台留在旧包上。
  launch_app

  sleep 2
  return 0
}

# 欢迎页（首次启动覆盖层，规范 §3.1）—— 点「先离线使用」离开它。
#
# 🔴 为什么每个验收脚本装完包都要先过这一步
#
#   `pm clear` 等价于**全新安装**，而全新安装的第一次冷启动会显示欢迎页，
#   它**盖住整个主界面**（包括底部标签栏）。不点掉的话：
#
#     · `input tap 945 $TAB_Y`（点「我的」）点到的是欢迎页 —— 什么都不会发生；
#     · 于是 `configure_sync_credentials` 报「找不到输入框：服务器地址」，
#       排查方向被引去怀疑设置页改版；
#     · 更坏的是有些脚本**看起来是绿的**：欢迎页的说明文字里也含「任务」二字，
#       于是「应用已启动」那条断言假通过。
#
# ⚠️ 这与"加登录墙"是**两件不同的事**（规范 §0 专门澄清过）：欢迎页有两个
#    同级出口，点「先离线使用」一步就进主界面，未登录的全部本地功能照常。
#    所以这一步不是绕过被测功能，而是把设备恢复成"用户已经做过首次选择"的初态。
#
# 幂等：不在欢迎页时什么都不做（主界面里根本没有这两个按钮）。
#
# 🔴 它现在**先把首启的隐私同意面板收掉**，再处理欢迎页 —— 顺序就是屏幕上的顺序
#    （隐私面板是一块盖住整屏的 RN Modal，它立着的时候欢迎页的节点根本不在
#    无障碍树里，"点先离线使用"会点进遮罩）。
#
# ⚠️ 默认走**「同意并联网」**，这条决定是有代价的，写清楚：
#   · 本 lib 的调用方（`verify-mobile-*`）**绝大多数**后面就要配同步凭据、看另一台
#     设备读不读得到 —— 选「只用本机」或「以后再说」会让出口闸把每一个请求拦在
#     本地（`consent-gate.ts` 的职责），后面所有网络判据红。那**不是产品坏了**，
#     但会把一轮验收变成十几次"找不到按钮"的假红（2026-10-03 实测：`verify-mobile-auth.sh`
#     整轮 17 条红，全是这一块面板）。
#   · 真用户要走通那条旅程**也必须**点这一边，所以这不是"绕过被测行为"，
#     是替被测行为做一次它自己要求的前置选择。
#   · 被测的是**本地**行为的脚本，在调用本函数之前先 `export CONSENT_GATE_PREFERRED=只用本机`
#     （或「以后再说」），本函数就按那个走 —— 已经有三个这么做了
#     （`reminder-ring` / `schedule` / `timeline`，它们各在自己的处理里点名了按钮）。
#   · ⚠️ 选「以后再说」**不等于处理完了**：决定仍是"没问过"，面板会在下一次冷启动
#     或下一次撞上门闸时再弹（`startup.ts` 判的是 `undecided()`）。`schedule` 与
#     `timeline` 外面那圈 `settle_*` 循环就是在处理这个后果，不是界面"随机换序"。
dismiss_welcome_if_present() {
  # 首启隐私同意面板（先它，因为它在最上面）。
  handle_privacy_consent "${CONSENT_GATE_PREFERRED:-同意并联网}" "只用本机"
  dump
  if [ "$(has_desc "先离线使用")" != "1" ] && [ "$(has_text "先离线使用")" != "1" ]; then
    return 0
  fi
  local xy
  xy=$(xy_desc "先离线使用")
  [ -z "$xy" ] && xy=$(xy_text "先离线使用")
  if [ -z "$xy" ]; then
    bad "欢迎页在，但取不到「先离线使用」的坐标（按钮文案改了？）"
    return 1
  fi
  $ADB shell input tap $xy
  sleep 3
  echo "     已离开欢迎页（点「先离线使用」@ ${xy}）"
  return 0
}

# 首启的**隐私同意面板**（`common.privacy.consent.title` =「在使用联网功能之前」）。
#
# 🔴 它是一块**盖住整屏的 RN Modal**（`accessibilityViewIsModal`），所以它立着的
#    时候，欢迎页 / 主界面的节点**根本不在无障碍树里**。不处理它，后面每一条基于
#    界面的断言得到的都是"找不到按钮""冷启动第一屏没有注册/登录"——
#    看起来像产品坏了，其实只是验收载体没处理一次法定前置询问。
#    （实测：`verify-mobile-auth.sh` 就是这么整轮全红的，2026-10-03。）
#
# 为什么放在共享库里而不是各脚本各写一份
# ------------------------------------------------
# 这条要求落地后，五个安卓脚本**各自**抄了一份 `dismiss_consent_*`，
# 各自处理的按钮不一样、等待时长不一样、有的还**没有**复验面板真的走了。
# 第六个要用的脚本（本文件头列的那批之外新加的）没有抄到 ⇒ 整轮假红。
# **抄件一定会漂，漂的症状就是这种"什么都没坏但全屏找不到按钮"。**
#
# 用法：
#   handle_privacy_consent <优先按钮> [备选按钮…]
#     · 要验联网/注册/同步的脚本传「同意并联网」在前（选「只用本机」会让出口闸
#       拦掉每一个请求，后面所有网络判据红 —— 那是闸门在正确地工作，不是产品坏了）；
#     · 只验本地行为的传「只用本机」或「以后再说」在前。
#
# 置三个变量给调用方**断言用**（本函数自己不改 PASS/FAIL —— 判据归调用方，
# 否则"要不要把这次豁免算成一条检查"就由库代码替脚本决定了）：
#   CONSENT_GATE_SEEN   1 = 面板确实出现过（没出现 ⇒ 调用方那条"首启必须问"会红）
#   CONSENT_GATE_CHOSEN 实际点掉的按钮标签
#   返回码 0 = 面板不在，或已被点掉；1 = 面板在却点不掉
#
# ⚠️ 三条实测形状，都写进来了，别再让下一个脚本重新踩：
#   · 面板有**入场动画延迟**，启动后立刻 dump 常常还没有它 ⇒ 轮询等（≤10s），
#     不是"看一眼没有就当没弹"。
#   · RN 的 `Button` 可辨识名在 **content-desc**，不在 text ⇒ 先 `xy_desc`；
#     「只用本机」这类标签**正文 bullet 里也出现一次**，所以 `xy_text` 兜底
#     取的是**第 2 个**匹配（第 1 个是那句说明文字，点它什么都不会发生）。
#   · 点一次**未必收下**（动画/焦点），所以复验还在就再点一次；仍在才算失败。
CONSENT_GATE_SEEN=0
CONSENT_GATE_CHOSEN=""

privacy_gate_present() {
  [ "$(has_text "在使用联网功能之前")" = "1" ]
}

handle_privacy_consent() {
  local waited=0 xy label attempt
  CONSENT_GATE_SEEN=0
  CONSENT_GATE_CHOSEN=""

  while [ "$waited" -lt 10 ]; do
    dump
    privacy_gate_present && break
    sleep 1
    waited=$((waited + 1))
  done
  privacy_gate_present || return 0
  CONSENT_GATE_SEEN=1

  attempt=0
  while [ "$attempt" -lt 2 ]; do
    attempt=$((attempt + 1))
    label=""
    xy=""
    local want
    for want in "$@"; do
      xy=$(xy_desc "$want")
      [ -z "$xy" ] && xy=$(xy_text "$want" 1)
      if [ -n "$xy" ]; then label="$want"; break; fi
    done
    if [ -z "$label" ]; then
      echo "     隐私同意面板在，但取不到候选按钮的坐标（文案改了？候选：$*）"
      return 1
    fi
    $ADB shell input tap $xy
    sleep 2
    dump
    if ! privacy_gate_present; then
      CONSENT_GATE_CHOSEN="$label"
      echo "     已处理隐私同意面板（点「${label}」@ ${xy}）"
      return 0
    fi
    echo "     点了「${label}」但面板还在，再点一次"
  done
  echo "     ❌ 隐私同意面板点不掉"
  return 1
}

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

clear_and_type() {  # <值> [标签] —— 先全选删除再输入，绝不循环 DEL（会 ANR）
  local want=$1 label=${2:-} i=0 cur
  $ADB shell input keycombination 113 29; sleep 0.6
  $ADB shell input keyevent 67; sleep 0.8

  # 🔴 **分块发送，不要一次甩一整个长字符串。**
  #
  # 实测（2026-09-26，load average 66~233 / 16 核）：一次发 225 字符的令牌，
  # 只有 28~33 个字符落地 —— 而 `input text` **退出码是 0**，没有任何报错。
  # 分块 + 每块之间让系统喘一口，丢字符的概率显著下降。
  # 分块**不能保证**不丢，所以下面还有读回补齐；两层都要有。
  local n=${#want} chunk=40 off=0 piece
  while [ "$off" -lt "$n" ]; do
    piece=$(python3 -c "import sys;print(sys.argv[1][int(sys.argv[2]):int(sys.argv[2])+40])" "$want" "$off")
    $ADB shell input text "$piece"
    off=$((off + chunk))
    sleep 0.7
  done
  sleep 1

  # 🔴 **读回补齐：缺什么补什么。**
  #
  # 没有标签就没法读回（调用方没给），此时只能返回 0 —— 但**必须让调用方知道**
  # 它没拿到校验，而不是假装成功了。调用方用 `has_text` 再断言一次。
  [ -z "$label" ] && return 0

  while [ "$i" -lt 6 ]; do
    dump
    cur=$(edit_value "$label" 2>/dev/null)
    # 已经正确
    [ "$cur" = "$want" ] && return 0
    # 是目标值的**前缀**（丢的是尾巴）→ 把剩下的补上
    case "$want" in
      "$cur"*)
        # 用 python 算后缀，**不能用 `${want:${#cur}}`** ——
        # `${#中文}` 在非 UTF-8 locale 下数的是**字节**（8 个汉字报 24），
        # 于是偏移量错位、补上去的是乱码，而且看不出原因。
        piece=$(python3 -c "import sys;print(sys.argv[1][len(sys.argv[2]):])" "$want" "$cur")
        $ADB shell input text "$piece" >/dev/null 2>&1
        ;;
      *)
        # 不是前缀（中间丢了、或残留了旧值）→ 全选重来，别在脏状态上叠加。
        #
        # 🔴 **重来之前必须重新点一下这个字段。**
        #    实测（2026-09-26）：如果焦点已经不在这个字段上（ANR 弹窗把前台
        #    带去了别的应用），CTRL+A 全选的就不是它、DEL 删的也不是它 ——
        #    而 `input text` 会**追加**到别处。日志里出现过口令被重复输入 7 次
        #    （`mobile-e2e-e2ee-pass` × 7），原因就是这一条。
        #    断言只看"最终对不对"，中间这 6 次重试把界面搞得更脏。
        local refocus
        refocus=$(xy_edit "$label" 2>/dev/null)
        if [ -n "$refocus" ]; then
          $ADB shell input tap $refocus >/dev/null 2>&1
          sleep 1
        else
          # 连字段都定位不到 → 前台大概不在应用上，先纠正再继续
          ensure_app_foreground
        fi
        $ADB shell input keycombination 113 29; sleep 0.6
        $ADB shell input keyevent 67; sleep 0.8
        $ADB shell input text "$want" >/dev/null 2>&1
        ;;
    esac
    sleep 1.5
    i=$((i + 1))
  done
  return 1
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

# ── companion 存在性 + 无障碍树健康度 ────────────────────────────────────────
#
# 🔴 这两件事**必须分开**，理由是实测踩出来的（一整轮验收的代价）：
#
#   · companion 在不在  → 决定 idb 能不能说话；
#   · 树里有没有内容    → 决定 App 有没有把自己交出来。
#
#   把两者混成一句"AX 桥不通"，排查方向会整条偏到 App 上，而真相可能是：
#
#   ① **companion 根本不是脚本起的**。idb 不会自动拉它，只连
#      `/tmp/idb/<UDID>_companion.sock`；没人起就 `[Errno 2] No such file`。
#   ② **模拟器跑久了，App 的无障碍注册会卡死**（实测 13 小时）：App 在渲染、
#      在响应点击，但对 AX 只暴露一个**零尺寸的 Application 节点**（label 数 0）。
#      **重启模拟器立刻恢复**（同一台设备、同一个 App：0 → 42 个 label）。
#      而该期间**主屏一直能读出 11 个 label** —— 所以"主屏有 label"**不能**
#      当作"App 的树是好的"的对照。别拿它当判据。
# 真正的查询体单独起个名字，**故意**不让它和 `idb_ax_label_count` 同名：
# 这样验收脚本里的"变异缝"可以直接包一层去调它，而**不需要 `eval` + `declare -f`**
# 那套把戏 —— 实测那套会把函数体里的引号/续行打散，包出来的函数**永远返回 0**，
# 于是"变异生效了"和"变异把工具弄坏了"看起来一模一样（正是 §7 陷阱 58 的形状）。
_idb_ax_count_raw() {
  "$IDB_BIN" --companion-path "$IDB_COMPANION" ui describe-all --udid "$IDB_UDID" 2>/dev/null \
    | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(0); raise SystemExit
n=0
def w(x):
    global n
    if isinstance(x,dict):
        if x.get('AXLabel'): n+=1
        for k in ('children','nodes'):
            for y in (x.get(k) or []): w(y)
    elif isinstance(x,list):
        for y in x: w(y)
w(d); print(n)
" 2>/dev/null || echo 0
}

idb_ax_label_count() { _idb_ax_count_raw; }

# 确保 socket 在、companion 能应答。**能应答 ≠ 树有内容**，后者由调用方判断。
ensure_idb_companion() {
  local sock="/tmp/idb/${IDB_UDID}_companion.sock"
  if [ -S "$sock" ] && [ -n "$("$IDB_BIN" --companion-path "$IDB_COMPANION" ui describe-all --udid "$IDB_UDID" 2>/dev/null)" ]; then
    return 0
  fi
  echo "   ⚠️ companion 不在（socket ${sock} 不存在）—— 按官方参数把它拉起来"
  pkill -f "idb_companion --udid ${IDB_UDID}" 2>/dev/null
  rm -f "$sock"
  sleep 1
  nohup "$IDB_COMPANION" --udid "$IDB_UDID" \
    --grpc-domain-sock "$sock" --only simulator >/tmp/heyta-idb-companion.log 2>&1 &
  local waited=0
  while [ ! -S "$sock" ] && [ "$waited" -lt 30 ]; do sleep 1; waited=$((waited+1)); done
  if [ ! -S "$sock" ]; then
    echo "   ❌ companion 30 秒内没起来：$sock" >&2
    return 1
  fi
  sleep 2
  echo "   ✅ companion 已拉起（${waited}s）"
  return 0
}

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
      *) echo "   ❌ 取窗口矩形失败（退出码 ${rc}）" >&2 ;;
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
    elif mode == 'edit-sane' and is_edit and desc == want:
        # 与 desc-sane 同一条守卫（理由见上面）—— 只是限定在 EditText 上。
        if y2 > y1 and cy < 2100:
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
  # 🔴 凭据表单在「设置」Modal 里，不在「我的」滚动流上（设置 IA 收进
  #    `SettingsScreen` 那一刀搬进去的）。旧写法直接在我的页找输入框，
  #    三个字段全部"找不到"，而页面明明就在 —— 实测卡过 verify-mobile-inbox
  #    的每一轮。先按**稳定锚点**（resource-id，不走文字）打开 Modal 再填。
  dump
  local settings_xy
  settings_xy=$(python3 - <<'PY'
import re, sys
try:
    s = open('/tmp/ui.xml').read()
except OSError:
    sys.exit(0)
m = re.search(r'resource-id="profile-entry-settings"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', s)
if m:
    print((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
PY
)
  if [ -n "$settings_xy" ]; then
    $ADB shell input tap $settings_xy; sleep 3
  else
    echo "   ⚠️ 没找到「设置」入口（profile-entry-settings）—— 若凭据表单已在本页可见则继续"
  fi
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
    # 传标签进去 → `clear_and_type` 会读回、把丢掉的字符补上（高负载下会丢）。
    clear_and_type "$val" "$desc"
    dump
    if [ "$desc" = "端到端加密口令" ]; then
      # 🔴 口令是 `secureTextEntry`，**内容永远不会出现在 dump 里**
      # （节点只有 `password="true"`）。所以这里不假装能核对它 ——
      # 口令填错/没填的真正证据是后面**首次同步失败**（解不开服务端已有的密文）。
      if [ "$(has_secure)" = "1" ]; then
        ok "已填 ${desc}（安全字段，dump 看不到内容；由首次同步成功来证明）"
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
  # 关掉设置 Modal，回到「我的」—— 调用方的下一步（建任务/点入口）都从这页出发。
  $ADB shell input keyevent 4; sleep 2
}

# ── 收尾 ────────────────────────────────────────────────────
# 每个脚本自己报验收名，但"通过几项 / 失败几项 / 退出码"只有这一处定义 ——
# 两个脚本各写一份的话，迟早一个是 `-gt 0` 另一个是 `-ne 0`。
summary() {  # <验收名> [结尾语] [退出码]
  # ⚠️ 结尾语可传。原先是写死的「真机全链路通过」—— 那对**移动端**脚本准确，
  # 但三端同步验收（`verify-multi-end-sync.sh`）里没有"真机"参与，照抄会
  # 让输出说一句不成立的话。默认值保持原样，移动端脚本的输出一个字符都不变。
  #
  # 🔴 第三个参数 = **这一轮应当以什么码结束**。它必须存在，因为下面这些中止点
  #    原本写成 `summary "X"; exit 3` —— 而 summary 自己就 `exit`，那句 `exit N`
  #    是**死代码**。后果不是"退出码不对"这么轻：`FAIL` 为 0 时 summary 会打印
  #    「✅ X：真机全链路通过」并以 **0** 结束，于是"环境不成立 / 中途放弃"在输出上
  #    与"全部判据跑完且通过"**逐字相同**。
  #    2026-10-03 05:48 实测到一条活的：开局探测发现验收服务端比被测应用旧
  #    （`legal-consent` 回 404），脚本只跑了 2 项就放弃，而日志最后一行是
  #    「通过 2 项，失败 0 项 / ✅ 移动端备份还原：真机全链路通过」，**exit 0**。
  #    这就是元规则 2 说的"一条永远通过的判据比没有判据更糟"，只不过这次被欺骗的
  #    不是断言，是**整个脚本的成败**。
  local verdict="${2:-真机全链路通过}"
  local code
  if [ "$FAIL" -ne 0 ]; then
    code=1
  elif [ -n "${3:-}" ]; then
    code="$3"
  else
    code=0
  fi
  echo ""
  echo "════════════════════════════════════════"
  echo "  通过 $PASS 项，失败 $FAIL 项"
  case "$code" in
    0) echo "  ✅ $1：$verdict" ;;
    3) echo "  ⏭ $1：**本轮在环境上不成立**（不是产品失败）—— 上面最后一条说明就是原因" ;;
    1) if [ "$FAIL" -ne 0 ]; then
         echo "  ❌ 有失败项"
       else
         # 中止点只 echo 了原因、没走 bad() 时到这儿：FAIL 是 0，
         # 说"有失败项"是假话，说"全链路通过"更是 —— 两句话都不许出现。
         echo "  ❌ $1：**未跑完就中止**（上面最后一条说明就是原因）"
       fi ;;
    *) echo "  ❌ $1：以退出码 $code 结束" ;;
  esac
  exit "$code"
}

# ── 移动端「界面状态」类 helper（单点所有者）──────────────────────────────
#
# 原先只住在 verify-mobile-notes.sh 里。现在有两个消费者（notes / trash），
# 再复制一份就是 AGENTS §3.5 点名的那个反面教材：抽出了共享实现，
# 旧的那份却没删。四条都只碰**探针**（系统弹窗 / 前台归属 / 换页 /
# 崩溃归因），不碰任何产品语义。
# 走底部标签页：**坐标现取** + **点完必须验界面真的换了**。
#
# 🔴 这条 helper 是本脚本自己那次假红逼出来的，不是讲究：
# 原先第 8 步写的是 `input tap 135 2253` 然后 `require_screen`，而
# `require_screen` **只检查 /tmp/ui.xml 里有没有 `<hierarchy`，不重新抓界面**
# —— 于是它读的是上一步（「我的」页）遗留的快照，报出
# 「任务页没有「打开搜索」入口」。事后手动 dump 证明：**界面早就切过去了、
# 入口也在**（content-desc="打开搜索" 就在任务页顶栏）。
# 「没观测到 X」被当成了「X 没发生」（§7 元规则一）。
#
# 坐标现取的另一半理由：这台模拟器 1080×2400，标签文字下沿实测
# `bounds=[78,2271][137,2308]`，写死的 2253 落在文字**上方**的图标区。
tap_tab() {  # <标签无障碍名> <切过去之后应当出现的无障碍名>
  local name=$1 marker=$2 i xy
  for i in 1 2 3; do
    dump || true
    xy=$(xy_desc "$name")
    if [ -n "$xy" ]; then
      $ADB shell input tap $xy; sleep 3
      dump || true
      if [ -n "$(xy_desc "$marker")" ]; then return 0; fi
    fi
    echo "   ↻ 没切到「${name}」（第 ${i} 次，标记「${marker}」没出现）" >&2
  done
  return 1
}

# 🔴 **冷启动不保证一次落进前台**，而判据不能读界面文字。
#
# 实测（2026-10-03，本脚本首跑）：`pm clear` 之后 `monkey` 拉一次，6 秒后前台
# 仍然是启动器（`mCurrentFocus` = nexuslauncher），于是第 2 步之后每一次点击都
# 打在桌面图标上，报出来的是「找不到便签输入框」—— 听着像产品缺陷，其实是
# 根本没进应用（§7 元规则一：先怀疑探针）。
#
# 原来那句 `has_text "任务"` 判「应用已启动」同时是**假绿**：欢迎页的说明文字里
# 也有「任务」二字。窗口归属只能读 `mCurrentFocus`（§7 那条「截图判 UI 先读
# mCurrentFocus」是同一件事）。
# 系统的**权限弹窗**会盖在应用上面，而 `uiautomator dump` 导出的是**当前活动窗口**
# 的树 —— 弹窗在时读到的是弹窗的节点，应用的一个都不在。
#
# 🔴 实测（2026-10-03，本脚本第二跑）：填完凭据、第一次唤起中文输入法时，
# Google 输入法弹了「Allow Google to take pictures and record video?」。
# 于是第 2 步报「找不到便签输入框（滚动到「便签」段也没找到）」—— 听着像产品缺陷，
# 其实应用根本没被读到（§7 元规则一：先怀疑探针）。
#
# 只认那对**拒绝**按钮，而且**先证明弹窗在**才点：无条件按坐标点下去，
# 点的会是应用自己的按钮（那才是真事故）。选「不允许」而不是"允许"：
# 本验收不需要相机，而权限一旦授了就在这台镜像上留着。
dismiss_permission_dialog() {
  local xy
  dump || true
  xy=$(xy_text "Don’t allow")
  if [ -z "$xy" ]; then xy=$(xy_text "不允许"); fi
  if [ -z "$xy" ]; then return 0; fi
  echo "   ⤷ 收掉系统权限弹窗（点「不允许」@ ${xy}）—— 那不是本应用的界面"
  $ADB shell input tap $xy; sleep 2
  dump || true
  if [ -n "$(xy_text "Don’t allow")" ] || [ -n "$(xy_text "不允许")" ]; then
    echo "   ⚠️ 点了「不允许」弹窗还在（可能连着两问）" >&2
    return 1
  fi
  return 0
}

# 🔴 **崩了要当场说清是崩了。**
#
# 实测（2026-10-03）：便签 composer 提交时**整个应用进程没了**（两份 react-native
# 进同一个 bundle ⇒ `Unsupported top level event type "topSelectionChange"`），
# 而当时的脚本报的是「建完之后列表里没有这条便签」—— 那句会把排查带去
# "产品没写入本地库"，而真相是**根本没有产品在跑**。
# 判据不仅要会红，还要红在对的位置上。
blame_crash() {  # <在哪一步之后>；返回 0 = 本趟确实有崩溃
  local fatal
  fatal=$($ADB logcat -d -b crash 2>/dev/null | grep -m2 -A1 'FATAL EXCEPTION' | tr '\n' ' ')
  if [ -n "$fatal" ]; then
    bad "「${1}」之后应用进程崩了（本趟 crash 缓冲区有内容）：${fatal}"
    return 0
  fi
  return 1
}

settle_foreground() {
  local i cur
  for i in 1 2 3 4 5 6; do
    cur=$($ADB shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r' | sed 's/.*u0 //;s/\/.*//')
    [ "$cur" = "$PKG" ] && return 0
    echo "   ↻ 前台是「${cur:-空}」，重新拉起 ${PKG}（第 ${i} 次）"
    launch_app
    sleep 3
  done
  return 1
}
