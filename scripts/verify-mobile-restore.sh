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
# 移动端「自家备份还原」验收（真模拟器 + 真服务端 + 真 web 导出，零 mock）
# =========================================================================
#
# 🔴 为什么必须有这个脚本
#
# 多端覆盖审计 P1-2：手机能导出（系统分享），但 heyta 导出的 JSON 在手机上
# 曾经**导不回** —— 数据安全的对称性缺口。
# 本脚本证明完整闭环：真 web 导出的备份 → 推到设备 → 移动端选文件 →
# 预检（counts）→ 还原到空库 → 界面数得见 → 同步不坏。
#
# ## 备份从哪来（零 mock 且恰好是多端故事）
#
# 同一测试账号在 **web 端**（真浏览器 + 真服务端）建 3 任务/1 清单/1 标签，
# ExportPanel 导出 JSON —— **web 导出的备份手机能还原**正是用户跨端场景本身。
# 备份经 `adb push` + **`scan_file` 登记进媒体库**落到 Downloads（不登记时
# 系统选择器里根本看不到它，见 traps #127），移动端经系统选择器选它。
# 🔴 选完之后"把文件读成文本"这一步**不在 JS 的能力范围内**：RN 0.84.1 在
# Android 上对 `content://` / `file://` 一律读不出字节（机制见 traps #124），
# 所以走本应用自己的原生模块 `HeytaLocalFs.readTextUri`。
#
# ## 判据
#   ① 「从备份还原」入口在（选文件 + 粘贴两条路）；粘贴的非法内容被预检拒绝，
#      且**界面上给出人话**（不是崩溃、不是静默）；
#   ② 选文件 → 预检展示 counts（任务/清单/标签/总数/墓碑/ops）→ 确认 → 成功确认句；
#      随后再选**截断版**文件 ⇒ 同样被预检拒绝（走的是文件路径，不是粘贴路径）；
#   ③ 界面数得见还原的数据（3 条任务都在任务列表里）；
#   ④ 还原没有毒化同步队列：**a** 还原之后同步仍能落定（界面在 300s 内到
#      「已是最新 / 已全部上传」，且**不**出现「同步失败」，也不卡在「正在同步…」）；
#      **b** 还原后在手机上**自己**再建一条任务（标题先读回确认落进去了），
#      服务端出现一个**备份里没有的**新 opId。
#
#   🔴 ④a 以前断的是"备份里的 opId 要出现在服务端"——**那是断错了不变量**：
#   还原走 `OpLogStore.appendImported`，它把导入的 op 标成"不进上传队列"，
#   因为它们带的是**别的设备**的 `clientId`，服务端按 `INVALID_CLIENT_ID` 逐条拒
#   （`packages/storage/src/db-op-log-store.ts:100`/`:161`、`packages/op-log/src/engine.ts:376`）。
#   那条断言永远不会成立 —— 一条因设计而必红的判据不是判据，它只是把设计说成缺陷。
#   备份 opId 的命中数现在只**打印**（设计上=0）不判定：万一将来改成"还原时按本机
#   clientId 重签"，数字会变而这条判据不该跟着翻。
#
#   为什么④b 按"出现备份里没有的新 opId"而不是"服务端总数变大"：web 那台设备
#   **也可能**在同一时刻上传（ADR-0009 幂等），总数会被别人的时序左右。
#
#   🔴 **执行顺序不等于编号顺序**：① 拆成两半 —— 前半（步骤 4）只查两条入口都在，
#   后半（步骤 6，"往粘贴框打字"）排在 ② 之后。原因是往那个多行输入框里打字会把
#   软键盘立起来，而这一屏后面的按钮全在键盘覆盖的下半屏：实测那一下「确认还原」
#   变成往输入框里打了一个 `v`，一条键盘问题连锁出 ②③④ 四条假红（traps #126）。
#   规则：**会立键盘的那一步放在这块屏的最后做**，其余每处下半屏点击前
#   都过一次 `require_keyboard_down`（收不掉就 exit 3，不把探针故障算成产品红）。
#
#   🔴 变异（两条，各自钉一条判据）：
#     M1 拿掉 `handleRestoreText` 里"把拒绝原因说出来"那一步 ⇒ 判据①转红；
#     M2 拿掉 `confirmRestore` 的还原接线（按钮留着，什么都不写） ⇒ 判据③转红。
#
#   为什么④按 opId 而不是"服务端 op 数增加"：web 那台设备**也可能**已经把同一批
#   op 传上去了（opId 相同 ⇒ 服务端按 ADR-0009 幂等接受），那时总数一动不动，
#   而还原与同步其实全都是对的 —— 一条会因别人的时序而红的判据不是判据。
#
# 前置：模拟器在跑（本脚本用 HEYTA_E2E_SERIAL，默认 emulator-5556）、
#       服务端 TEST_MODE :3000、e2e 依赖已装（web 导出助手用 playwright）。
# 🔴 还有一条**环境前置**：宿主机 1 分钟负载 ≤ 核数的 3/4。负载高时 uiautomator
#   抓不到界面、`input text` 会静默丢字符，一轮能报出六七条假红（实测 load 62/18
#   两轮，traps #125）。脚本开头自己等，等不到就以 **exit 3** 结束 ——
#   3 = "这轮在环境上不成立"，与 1 = "有断言失败" 是两件事，不要混着看。

set -u
export PATH="/opt/homebrew/bin:$PATH"
export HEYTA_E2E_SERIAL="${HEYTA_E2E_SERIAL:-emulator-5556}"
. "$(dirname "$0")/lib/mobile-e2e.sh"

STAMP=$(date +%H%M%S)
EMAIL="restore-e2e-${STAMP}@test.local"
RPASS="RestorePass7"
BACKUP_JSON="/tmp/heyta-backup-${STAMP}.json"
BROKEN_JSON="/tmp/heyta-backup-broken-${STAMP}.json"
OPIDS="/tmp/heyta-backup-opids-${STAMP}.txt"
OPS_BEFORE="/tmp/heyta-ops-before-${STAMP}.txt"
OPS_AFTER="/tmp/heyta-ops-after-${STAMP}.txt"
OPS_POST="/tmp/heyta-ops-post-${STAMP}.txt"
TOKEN=""
RUSERID=""

echo ""
echo "=== 移动端备份还原验收（真模拟器 + 真服务端 + 真 web 导出，零 mock）==="
echo "  设备: $HEYTA_E2E_SERIAL   服务端: $SERVER   账号: $EMAIL"

# 🔴 宿主机过载时**不要开始**这一轮：uiautomator 在设备不空闲时抓不到界面，
# `dump` 会把 `/tmp/ui.xml` 截成空文件，之后每条断言都报"找不到 X" ——
# 实测两轮（load 62 / load 18）都是这样把一次环境失效打印成一堆产品缺陷的。
# 判据本身没错，错在跑它的时间。负载不达标就**以退出码 3 结束**（环境无效 ≠ 产品失败，
# 共享库 `require_screen` 用的是同一个约定）。
wait_for_quiet_host() {
  local cores limit waited=0 load
  cores=$(sysctl -n hw.ncpu)
  limit=$((cores * 3 / 4))
  while :; do
    load=$(uptime | sed 's/.*load averages: //' | awk '{print int($1)}')
    [ "$load" -le "$limit" ] && { echo "   负载 $load ≤ ${limit}（$cores 核），开始"; return 0; }
    [ "$waited" -ge "${HEYTA_RESTORE_LOAD_WAIT:-900}" ] && { echo "   ❌ 等满 ${HEYTA_RESTORE_LOAD_WAIT:-900}s 负载仍是 $load —— 本轮不跑（环境无效，不是产品失败）" >&2; return 1; }
    echo "   负载 $load > ${limit}，等 30s（累计 ${waited}s）"
    sleep 30; waited=$((waited + 30))
  done
}
wait_for_quiet_host || exit 3

step "0. 装包并启动（pm clear 即判据里的「清数据重装」）"
$ADB shell am force-stop com.heytamobile >/dev/null 2>&1
$ADB uninstall com.heytamobile >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop com.google.android.googlequicksearchbox >/dev/null 2>&1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 6
FG=$($ADB shell dumpsys activity activities 2>/dev/null | tr -d '\r' | grep -c "topResumedActivity=.*$PKG")
if [ "${FG:-0}" -ge 1 ]; then ok "应用已启动"; else bad "应用没到前台"; screen_txt; fi
# 同意面板：判据④要同步上行，选「同意并联网」。
WAITED=0
while [ "$WAITED" -lt 10 ]; do
  dump
  [ "$(has_text "在使用联网功能之前")" = "1" ] && break
  sleep 1; WAITED=$((WAITED + 1))
done
if [ "$(has_text "在使用联网功能之前")" = "1" ]; then
  XY=$(xy_desc "同意并联网"); [ -z "$XY" ] && XY=$(xy_text "同意并联网")
  [ -n "$XY" ] && { $ADB shell input tap $XY; sleep 2; echo "   已同意联网"; }
fi
dismiss_welcome_if_present
dump
[ "$(has_text "任务")" = "1" ] && ok "欢迎页已过" || bad "欢迎页没过"; :

step "1. 建测试账号（web 导出与移动端同步共用）"
# 🔴 **服务端必须和被测的 APK 出自同一份源码**。这不是仪式，是本轮实测出来的：
# :3000 上那个进程是 18:56 起的，而当前 dist 是 00:53 —— 旧进程里没有
# `/api/account/legal-consent`，而新 APK 里有账号级补签闸门（G-27）。
# 两边一错开，手机侧的闸门就停在拿不到答案的那一态，`syncNow()` 直接不出发，
# 于是判据④ 轮询满 300s 得到 "服务端命中 0/5" —— 读起来像"还原毒化了同步队列"，
# 其实是**验收栈自己的服务端比应用旧**（元规则 1：先怀疑探针）。
# 这里用一次不需要凭据的探测把这件事**在开局**判掉：路由在 = 401（要鉴权），
# 路由不在 = 404。判不了就不要跑 40 分钟再报一条没主的红。
LEGAL_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "$HOST_SERVER/api/account/legal-consent")
case "$LEGAL_CODE" in
  401|403) ok "服务端路由与应用同代（legal-consent = ${LEGAL_CODE}，要鉴权但存在）" ;;
  404) echo "   ❌ 服务端进程比被测应用旧：legal-consent 返回 404。" >&2
       echo "      移动端的账号级补签闸门会因此拿不到裁决，同步一条都出不去 —— " >&2
       echo "      判据④ 必然假红。请重建并从当前 dist 重启验收服务端：" >&2
       echo "        pnpm --filter @heyta/server build && PORT=<端口> scripts/mobile-e2e-up.sh" >&2
       echo "      （库还要跟上迁移：cd server && sh scripts/migrate-deploy.sh）" >&2
       summary "移动端备份还原"; exit 3 ;;
  *) echo "   ❌ 服务端不可达或异常（legal-consent = ${LEGAL_CODE}）" >&2
     summary "移动端备份还原"; exit 3 ;;
esac
RESP=$(curl -s -X POST "$HOST_SERVER/api/test/create-user" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${RPASS}\"}")
TOKEN=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
RUSERID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('userId',''))" 2>/dev/null)
if [ -n "$TOKEN" ] && [ -n "$RUSERID" ]; then
  ok "账号已建（userId=${RUSERID}）"
else
  bad "create-user 没走通：$RESP"; summary "移动端备份还原"; exit 1
fi

step "2. web 端真导出（真浏览器 + 真服务端 → 备份 JSON）"
if [ ! -f /tmp/run-webexport.sh ]; then
  printf '#!/bin/bash\ncd "%s"\nexport PATH="/opt/homebrew/bin:/tmp/pnpm-shim:$PATH"\nnode e2e/restore-export.cjs "$@"\n' "$PWD" > /tmp/run-webexport.sh
  chmod +x /tmp/run-webexport.sh
fi
SERVER_URL="$SERVER" bash /tmp/run-webexport.sh "$EMAIL" "$RPASS" "$TOKEN" "$BACKUP_JSON" > /tmp/webexport.log 2>&1
if [ -f "$BACKUP_JSON" ] && grep -q "formatVersion" "$BACKUP_JSON"; then
  ok "web 导出成功（$(wc -c < "$BACKUP_JSON" | tr -d ' ') 字节）"
else
  bad "web 导出失败："; tail -5 /tmp/webexport.log; summary "移动端备份还原"; exit 1
fi
# 截断版（判据②的后半）：取前 1/3 字节 —— 就是"下载没下完"的形状。
HEAD_BYTES=$(($(wc -c < "$BACKUP_JSON" | tr -d ' ') / 3))
head -c "$HEAD_BYTES" "$BACKUP_JSON" > "$BROKEN_JSON"
ok "截断版已备（${HEAD_BYTES} 字节）"

step "3. 推送到设备 Downloads"
$ADB push "$BACKUP_JSON" /sdcard/Download/heyta-backup.json >/dev/null 2>&1
$ADB push "$BROKEN_JSON" /sdcard/Download/heyta-broken.json >/dev/null 2>&1
# 🔴 push 进去的文件**不在 MediaStore 里**，而系统选择器（DocumentsUI）
# 的默认视图是 Recent —— 实测这一屏写的是 "No items"，
# 于是"选择器里没找到文件"是**没扫描**，不是产品没入口。
# 显式扫一次（`scan_file` 走 MediaProvider，返回 android.intent.extra.STREAM）。
for f in heyta-backup.json heyta-broken.json; do
  $ADB shell "content call --uri content://media/external/file --method scan_file --arg /storage/emulated/0/Download/${f}" >/dev/null 2>&1
done
sleep 2
ok "已推送完整版 + 截断版（并登记进媒体库）"

# 🔴 判据④a 的对照集：备份里的 opId 清单。服务端存的是**密文内容 + 明文 opId**，
# 所以能按 id 对账，不能按内容断言（§7「服务端读不了密文」同一条）。
python3 -c 'import json,sys
d = json.load(open(sys.argv[1]))
print("\n".join(op["id"] for op in d["opLog"]))' "$BACKUP_JSON" > "$OPIDS"
ok "备份 opId 清单已取（共 $(wc -l < "$OPIDS" | tr -d ' ') 条）"

# 服务端的 op 清单（一行一个 opId）。响应形状是 `{ops:[...]}`，而 `take` 默认
# 只有 10 条 —— 不显式给 limit，"命中数"会被静默截断成假红。
read_ops() {
  curl -s "$HOST_SERVER/api/test/user/$RUSERID/ops?limit=500" \
    | python3 -c 'import json,sys
d = json.load(sys.stdin)
ops = d.get("ops") if isinstance(d, dict) else d
print("\n".join(o["id"] for o in (ops or [])))' 2>/dev/null
}

# 🔴 "谁在前台"只能问 `mCurrentFocus`。对整份 `dumpsys window` grep 包名是**坏探针**：
# 系统会把已停止的 Activity 窗口记录留在输出里，于是"选择器还开着"在上一轮用过之后
# **永远为真**（判据② 以为在选文件，点击其实全落在应用界面上）。
#
# 🔴🔴 但**取那一行时也不能截**。上一版写成
# `grep -o "mCurrentFocus=Window{[^ ]* [^ ]*"` —— `Window{` 后面那两段是
# **窗口 id 和 userId**，组件名在第三段，于是取回来的永远是 `Window{174b2bc u0`：
# `focus_is documentsui` 与 `focus_is $PKG` **两条都永远为假**。
# 后果是三条各自独立看起来像产品缺陷的红：②「选择器没开到前台」（其实开着）、
# ③「任务列表 0/3」（没还原成是因为根本没点到文件）、② 尾「焦点没回到应用」。
# 而同一轮里 `current_focus` 用的是 `grep -o "mCurrentFocus=.*"`，**它把 PickActivity
# 原样打进了错误信息** —— 判据自己把矛盾印在了一行里，只是没人去对。
# 一条判据和它的诊断输出用了两种解析 = 红灯时无法归因；现在两者共用同一支取行函数。
focus_line() {
  $ADB shell dumpsys window 2>/dev/null | tr -d '\r' | grep "mCurrentFocus=" | tail -1
}
focus_is() {  # <包名片段>
  focus_line | grep -q "$1"
}

# 红的时候要说清"此刻前台到底是谁"，而不是只说"不是它"。
current_focus() { focus_line; }

# 🔴 软键盘还开着时，脚本里的**滚动 swipe 会从屏幕下半部分划过键盘按键**，
# Android 把手势当成输入打进了当前聚焦的输入框 —— 实测：粘贴框里多了一串
# `GT GT GT … y`，那正是被划过的键。判据于是把"探针在写字"读成"应用没反应"。
# `disable_ime` 换的是默认输入法，**不收已经弹起来的那块键盘**，所以要单独收。
# ⚠️ 这几个 helper 必须定义在**第一次调用之前**：上一版把 `hide_keyboard` 定义在
#    判据① 之后，于是判据① 那条 `command not found` 被 `||` 吞成了"键盘没能收起"
#    的警告 —— 探针自己没跑起来，却报成产品侧的一件事。
keyboard_up() {
  $ADB shell dumpsys input_method 2>/dev/null | tr -d '\r' | grep -q "mInputShown=true"
}
hide_keyboard() {
  for _ in 1 2 3; do
    keyboard_up || return 0
    $ADB shell input keyevent KEYCODE_BACK; sleep 1.2
  done
  ! keyboard_up
}

# 🔴 **要在下半屏点一个节点之前，键盘必须是收着的**，否则那一下打在键盘上。
# 键盘盖住的是屏幕下 ~45%，而这一屏的按钮（确认还原 / 选择备份文件 / 标签栏）
# 恰好都在那一片。节点**仍然在无障碍树里、仍然给得出坐标** —— 于是探针拿到坐标、
# 以为点了，实际是往聚焦中的输入框里打了一个字符（实测：`v`）。
# 收不掉就**终止本轮**（exit 3）：继续跑只会把一次键盘问题打印成一串产品缺陷。
require_keyboard_down() {  # <在哪一步>
  hide_keyboard && return 0
  $ADB shell input keyevent KEYCODE_BACK; sleep 1.5
  hide_keyboard && return 0
  echo "" >&2
  echo "   ❌ 键盘收不掉（$1）—— **本轮结果无效**（探针不成立，不是产品失败）。" >&2
  echo "      此刻前台：$(current_focus)" >&2
  exit 3
}

# 🔴 **一台设备可以被别人家的 app 抢走**（2026-10-03 实测：跑到判据④ 时
# `mCurrentFocus` 变成了 `cloud.finlaw.ssos/…MainActivity` —— 本机另一个项目的
# 会话正在用同一台模拟器）。症状是"找不到输入框：访问令牌"这类**看起来像
# 表单坏了**的红，而我们的应用根本不在前台。
# 所以每次要在自己界面上操作之前先要回前台；要不回来就 **exit 3**
# （设备被占 = 环境不成立，不是产品失败），别把后面的判据一条条算成红。
require_our_app_foreground() {  # <在哪一步>
  focus_is "$PKG" && return 0
  $ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 3
  focus_is "$PKG" && return 0
  echo "" >&2
  echo "   ❌ 设备不在我们应用上（$1）—— **本轮结果无效**（设备被占用）。" >&2
  echo "      此刻前台：$(current_focus)" >&2
  exit 3
}

step "4. 判据①（前半）：两条入口都在"
# 🔴 导出的入口在**「我的」页**（ProfileScreen 的 profile-entry-export 行，
#    词条 `mobile.export.entry` = 「导出数据」），不在任务页。
#    上一版这里少了这一步导航，于是「打不开导出页」是**探针**红了，
#    而不是产品红了 —— 判据红必须先排除探针（元规则 1）。
require_our_app_foreground "判据① 之前"
$ADB shell input tap 945 2253; sleep 3
XY=$(scroll_to_text "导出数据")
if [ -z "$XY" ]; then bad "「我的」页里找不到「导出数据」入口"; screen_txt; else
  $ADB shell input tap $XY; sleep 3
  # 🔴 用 scroll_to_text 而不是"在 dump 里搜到就算"：这一屏在 ScrollView 里，
  #    折叠线以下的节点照样出现在无障碍树里，但中心点落在标签栏上（§7 #81 同族）。
  TITLE_XY=$(scroll_to_text "从备份还原")
  if [ -z "$TITLE_XY" ]; then
    bad "找不到「从备份还原」入口"; screen_txt
  else
    ok "「从备份还原」入口已在（此前为零入口）"
    if [ -n "$(scroll_to_text "选择备份文件")" ]; then
      ok "选文件这条路有入口"
    else
      bad "找不到「选择备份文件」按钮"; screen_txt
    fi

    # 🔴 这里**只定位、不点进去**。点进这个多行输入框 = 键盘立起来，而它在这一屏
    #    之后很难保证不再被划到：实测那一版的「确认还原」坐标落在立着的键盘上，
    #    那一下变成往粘贴框里打了一个 `v`，按钮根本没被按下 ——
    #    一条键盘连锁出 ②「没看到还原成功」、②尾「选择器没开到前台」、
    #    ③「任务列表 0/3」、④「找不到输入框：服务器地址」四条各自像产品缺陷的红。
    #    所以"往粘贴框里打字"整块挪到了判据② **之后**（步骤 6）：
    #    会立键盘的那一步放在这块屏的最后做。
    if [ -n "$(scroll_to_edit "粘贴备份内容（JSON）")" ]; then
      ok "粘贴这条路也有入口（输入框在，不点它）"
    else
      bad "找不到「粘贴备份内容（JSON）」输入框"; screen_txt
    fi
  fi
fi

# 在系统选择器（DocumentsUI）里点中一个文件，并确认回到应用。
#
# 🔴 两条路线，按顺序试，**报告实际走的是哪条**（这一层是系统界面，
#    它的默认视图和根菜单内容都跟着 AVD 的镜像变，不该假装只有一条路）：
#    A) 当前视图（Recent）逐屏找文件名。以前这条被判定"不能用"，是因为
#       那时候还没有 `scan_file` —— 新推的文件根本不在媒体库里。
#       现在（步骤 3 起）刚 push 的两个 JSON 就排在 Recent 最上面。
#    B) 根菜单(Show roots) → Downloads → 找文件名。⚠️ 这台 AVD 的根菜单里
#       **没有 Downloads 这一行**（实测：Images/Audio/Videos/Documents/Recent files），
#       所以 B 只是留给别的镜像的退路，不是主路。
#
# 返回值不是"成功/失败"两态，而是**在哪一态失败**：
#   0 成功 · 2 选择器压根没开 · 3 根菜单入口找不到 · 4 根菜单里没有 Downloads
#   5 两条路线都翻不到那个文件 · 6 点了文件但焦点没回到应用。
pick_file() {  # <显示名>
  # 1) 等选择器**真的**在前台。⚠️ 预算要给到 45s：这台机器负载高时
  #    DocumentsUI 冷启动能超过 15s（实测有"没开到前台"的红其实是还没开到），
  #    而超时那一刻必须把**实际焦点**打出来 —— 只说"不是它"就分不开"还没开"和"开在别处"。
  opened=0
  for _ in $(seq 1 30); do
    focus_is documentsui && { opened=1; break; }
    sleep 1.5
  done
  [ "$opened" = "1" ] || { echo "     45s 后前台仍是：$(current_focus)" >&2; return 2; }
  # 🔴 焦点等到了**必须马上 dump**：`xy_desc`/`xy_text` 读的是 `/tmp/ui.xml`，
  # 不重 dump 就是拿**上一屏**（应用自己的界面）去找节点，于是必然找不到 ——
  # 本轮实测：判据②红成"选择器里找不到根菜单入口"，而入口就在屏上。
  sleep 1
  PICKROUTE=""
  # 2) 路线 A：当前视图
  for _ in 1 2 3 4 5 6; do
    dump
    XY=$(xy_text "$1")
    if [ -n "$XY" ]; then
      PICKROUTE="当前视图(Recent)"
      $ADB shell input tap $XY
      break
    fi
    $ADB shell input swipe 540 1600 540 900 400; sleep 1.2
  done
  # 3) 路线 B：根菜单 → Downloads
  if [ -z "$PICKROUTE" ]; then
    R=$(xy_desc "Show roots"); [ -z "$R" ] && R=$(xy_desc "显示根目录")
    [ -z "$R" ] && return 3
    $ADB shell input tap $R; sleep 2; dump
    D=$(xy_text "Downloads"); [ -z "$D" ] && D=$(xy_desc "Downloads"); [ -z "$D" ] && D=$(xy_text "下载")
    [ -z "$D" ] && return 4
    $ADB shell input tap $D; sleep 3
    for _ in 1 2 3 4 5 6; do
      dump
      XY=$(xy_text "$1")
      if [ -n "$XY" ]; then
        PICKROUTE="根菜单→Downloads"
        $ADB shell input tap $XY
        break
      fi
      $ADB shell input swipe 540 1600 540 900 400; sleep 1.2
    done
  fi
  [ -n "$PICKROUTE" ] || return 5
  sleep 2
  S=$(xy_text "Select"); [ -z "$S" ] && S=$(xy_desc "Select")
  [ -n "$S" ] && { $ADB shell input tap $S; }
  # 4) 回到应用（焦点回到本包 = 选择器已把结果交回来）
  for _ in 1 2 3 4 5 6; do
    focus_is "$PKG" && return 0
    sleep 1.5
  done
  return 6
}

# 选择器还占着前台时，后面每一个坐标都点进 DocumentsUI 里 ——
# 一轮跑完会多出五六条"看起来各自独立"的红（本轮实测：判据②红之后，
# 判据③/④ 跟着红，其中一条是"找不到输入框：服务器地址"）。
# 失败分支统一先把它关掉并把应用抢回前台，让后面的红各自说自己的事。
close_picker() {
  for _ in 1 2 3; do
    focus_is "$PKG" && return 0
    $ADB shell input keyevent KEYCODE_BACK; sleep 1.5
  done
  $ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 3
  focus_is "$PKG"
}

# 把 pick_file 的退出码翻成人话（判据红的时候要说清断在哪一环）。
pick_reason() {  # <码>
  case "$1" in
    2) echo "系统选择器没开到前台（窗口焦点里没有 documentsui）" ;;
    3) echo "选择器里找不到「Show roots / 显示根目录」入口" ;;
    4) echo "根菜单里没有 Downloads" ;;
    5) echo "Downloads 列表里翻不到这个文件" ;;
    6) echo "点了文件但焦点没回到应用（选择器没交回结果）" ;;
    *) echo "未知退出码" ;;
  esac
}

# 🔴 把这一屏滚回**顶部**。`scroll_to_text` 只会朝一个方向滚（向下），
# 而还原卡在上半屏：判据① 滚到底去按「预检备份」之后，
# 上方节点的 text 会**从无障碍树里掉出去**（实测：整棵 dump 里
# 既没有「选择备份文件」也没有「从备份还原」，只剩下方那张卡与错误行）。
# 于是"找不到按钮"是探针红了，不是产品红了 —— 元规则 1。
# 🔴 起止点都留在**软键盘上沿以上**：swipe 从键盘上划过去会被系统当成手势输入，
# 实测把 `GT GT GT … y` 打进了正在聚焦的粘贴框（traps #126）——
# 于是"应用没反应"其实是探针在写字。代价是每次滚得少一点，所以次数 7 → 9。
rewind_scroll() {
  for _ in 1 2 3 4 5 6 7 8 9; do
    $ADB shell input swipe 540 700 540 1250 300; sleep 0.6
  done
  sleep 1
}

# 🔴 逐屏往下找一段**子串**（不是整节点）。这一屏是 ScrollView，
# 折叠线以外的节点**整块掉出无障碍树**（实测：还原卡下半部 —— 「预检备份」
# 按钮与错误/预览行 —— 在页面滚到顶时根本不在 dump 里，
# 于是"没有 counts 也没有错误"这两种完全不同的状态长得一模一样）。
# 只在某一个滚动位置查一次 = 一条会随机红的判据。
scroll_to_sub() {  # <子串>
  rewind_scroll
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    dump
    require_screen
    [ "$(has_sub "$1")" = "1" ] && return 0
    $ADB shell input swipe 540 1250 540 700 400; sleep 1
  done
  dump
  require_screen
  [ "$(has_sub "$1")" = "1" ]
}

step "5. 判据②：选文件 → 预检 counts → 确认还原 → 成功；截断版同样被拒"
hide_keyboard || echo "     ⚠️ 键盘仍在 —— 滚动区间已避开键盘带（traps #126）"
rewind_scroll
XY=$(scroll_to_text "选择备份文件")
if [ -z "$XY" ]; then
  bad "找不到「选择备份文件」按钮"; screen_txt
else
  $ADB shell input tap $XY; sleep 5
  pick_file "heyta-backup.json"; RC=$?
  echo "     选择器路线：${PICKROUTE:-未命中}"
  if [ "$RC" != "0" ]; then
    # 🔴 失败先关选择器（见 `close_picker` 的实测说明）。
    close_picker
    bad "选 heyta-backup.json 失败（$(pick_reason "$RC")）"; screen_txt
  else
    sleep 3
    # 🔴 三种结果都要**逐屏找**（见 `scroll_to_sub` 的实测说明）：
    #    counts 行 / 读失败行 / 本机未就绪行 —— 全在还原卡的下半截。
    if scroll_to_sub "任务 3"; then
      ok "预检展示了 counts（任务条数与备份一致）"
    elif scroll_to_sub "读不到这个文件的内容"; then
      bad "选文件后读失败，界面报的是："; screen_txt
    elif scroll_to_sub "本机数据还没打开"; then
      bad "选文件后 host 为空（应用状态问题）"; screen_txt
    elif scroll_to_sub "读到的内容是空的"; then
      bad "选文件后读回来是空内容"; screen_txt
    else
      bad "选文件后界面既没有 counts 也没有任何错误行（多半是选择器没回结果）"; screen_txt
    fi
    # 🔴 上面那些找 counts 的 swipe 会划过粘贴框（它占这一屏很大一块），
    # 那足以让光标落进去、把键盘立起来 —— 而「确认还原」正好处在键盘覆盖的带里。
    require_keyboard_down "点「确认还原」之前"
    XY=$(scroll_to_text "确认还原")
    if [ -z "$XY" ]; then bad "找不到「确认还原」按钮"; screen_txt;
    else
      $ADB shell input tap $XY; sleep 6
      if scroll_to_sub "还原成功"; then
        ok "还原成功（界面确认）"
        # 🔴 这一条钉的是**文案的真实性**，不是"有没有成功提示"：本轮实测出的真缺陷
        # 是成功语写着"配置同步后会自动上行"，而还原的 op 带原设备署名、服务端逐条拒
        # （traps #138）。只断"还原成功"四个字，那句话改回假的也照样绿。
        rewind_scroll
        if scroll_to_sub "只在这台设备上"; then
          ok "成功语说清了边界（还原的数据不出本机）"
        else
          bad "成功语没有说明这批数据只在本机 —— 文案退回了假承诺"; screen_txt
        fi
      else
        bad "没看到还原成功确认"; screen_txt
      fi
      $ADB exec-out screencap -p > /tmp/heyta-restore-done.png 2>/dev/null
    fi

    # 判据②的后半：截断文件**走选文件路径**同样被拒。
    # 为什么粘贴路径顶替不了它：两条路的读取端不同（本机 URI 读取 vs 界面输入），
    # "半截文件"只在文件路径上出得来。
    rewind_scroll
    require_keyboard_down "第二次点「选择备份文件」之前"
    XY=$(scroll_to_text "选择备份文件")
    if [ -z "$XY" ]; then bad "还原后「选择备份文件」入口消失了"; screen_txt;
    else
      $ADB shell input tap $XY; sleep 5
      pick_file "heyta-broken.json"; RC2=$?
      if [ "$RC2" != "0" ]; then
        close_picker
        bad "选 heyta-broken.json 失败（$(pick_reason "$RC2")）"; screen_txt
      else
        sleep 3
        # 🔴 逐屏找（上一轮这里单次 dump 红了，而错误行就在屏幕下方被折叠掉的位置）
        if scroll_to_sub "这不是有效的 JSON"; then
          ok "截断的备份文件被预检拒绝（一个字节都没写）"
        elif scroll_to_sub "读不到这个文件的内容"; then
          bad "截断文件走选文件路径时读失败，界面报的是："; screen_txt
        else
          bad "截断文件没被拒绝"; screen_txt
        fi
      fi
    fi
  fi
fi

# 🔴 判据① 的后半放在**这里**（而不是和入口检查一起在步骤 4）：
# 往粘贴框里打字必然把键盘立起来，而这一屏后面还要在下半屏点两次按钮。
# 顺序本身就是探针的一部分 —— 会立键盘的那一步放在这块屏的最后做。
step "6. 判据①（后半）：粘贴的非法内容被预检拒绝，且界面说出人话"
# 🔴 **重新导航到导出页**：判据② 的失败分支会走 `close_picker`，而它兜底是用
# monkey 把应用重新拉到前台 —— 那之后界面停在**任务页**，不是导出页。
# M1 变异轮实测：粘贴框因此"找不到"，红字看起来像"面板坏了"，
# 其实是上一段的失败把导航状态复位了。每一步自己站到自己的位置上，
# 不依赖"上一步没失败"。
$ADB shell input tap 945 2253; sleep 3
NXY=$(scroll_to_text "导出数据")
if [ -z "$NXY" ]; then bad "重新进导出页失败：「我的」页里找不到「导出数据」"; screen_txt;
else
  $ADB shell input tap $NXY; sleep 3
fi
EDIT=$(scroll_to_edit "粘贴备份内容（JSON）")
if [ -z "$EDIT" ]; then bad "找不到「粘贴备份内容（JSON）」输入框"; screen_txt;
else
  $ADB shell input tap $EDIT; sleep 1
  # ⚠️ 必须 ASCII：`adb shell input text` 发非 ASCII 会直接抛异常（§7 #43）。
  $ADB shell input text "not-json-garbage"; sleep 1
  disable_ime; sleep 1
  require_keyboard_down "点「预检备份」之前"
  # 粘贴路径的提交按钮 = 「预检备份」（还原要先给出 counts 再让人确认）。
  XY=$(scroll_to_text "预检备份")
  if [ -z "$XY" ]; then bad "找不到「预检备份」按钮"; screen_txt;
  else
    $ADB shell input tap $XY; sleep 2; dump
    if [ "$(has_sub "这不是有效的 JSON")" = "1" ]; then
      ok "垃圾内容被预检拒绝，界面说的是人话（不是崩溃、不是静默）"
    else
      bad "垃圾内容没被拒绝，或拒绝了但没说出来"; screen_txt
    fi
  fi
fi

step "7. 判据③：界面数得见还原的数据"
require_keyboard_down "点「任务」标签之前"
$ADB shell input tap 135 2253; sleep 3
dump
COUNT=0
for t in backup-task-1 backup-task-2 backup-task-3; do
  [ "$(has_text "$t")" = "1" ] && COUNT=$((COUNT + 1))
done
if [ "$COUNT" = "3" ]; then
  ok "任务列表数得见 3 条还原数据"
else
  bad "任务列表只见 $COUNT/3 条"; screen_txt
fi
$ADB exec-out screencap -p > /tmp/heyta-restore-tasks.png 2>/dev/null

# 🔴 变异验证的两条臂（M1 钉判据① 后半、M2 钉判据③）都不需要判据④：
# 那一轮最坏要轮询 300s（这台设备没有 WebAssembly，首同步按分钟计）。
# `HEYTA_RESTORE_STOP_AFTER=7` 让变异那一轮在判据③ 之后收尾 ——
# ⚠️ 它**只**用于变异轮；正式取证必须跑满（否则"④ 没测"会被读成"④ 过了"）。
if [ "${HEYTA_RESTORE_STOP_AFTER:-}" = "7" ]; then
  echo "   ⚠️ 按 HEYTA_RESTORE_STOP_AFTER=7 提前收尾（变异轮：判据④ 未执行）"
  summary "移动端备份还原（变异轮，未跑判据④）"
fi

step "8. 判据④：还原没有毒化同步队列"
require_our_app_foreground "填同步凭据之前"
require_keyboard_down "进「设置」填凭据之前"
read_ops > "$OPS_BEFORE"
ok "同步前服务端 op 数 = $(wc -l < "$OPS_BEFORE" | tr -d ' ')"
EMAIL="$EMAIL" TOKEN="$TOKEN" configure_sync_credentials
$ADB shell input tap 945 2253; sleep 2
XY=$(xy_text "立即同步")
[ -z "$XY" ] && XY=$(xy_desc "立即同步")
if [ -n "$XY" ]; then $ADB shell input tap $XY; fi
ensure_phone_sync
# 🔴 判据④a 断的是**"还原有没有毒化同步队列"**，不是"备份里的 op 有没有传上去"。
#
# 上一版这里断的是"服务端要出现备份里那 5 个 opId"，那是**我把不变量看错了**：
# 还原走的是 `OpLogStore.appendImported`，它把这些 op 标成
# `uploadStatus: 'uploaded'`（= 不进上传队列），而接口注释写着这不是疏漏而是设计 ——
# 导入的 op 带的是**别的设备**的 `clientId`，服务端会按 `INVALID_CLIENT_ID` 逐条拒
# （`packages/storage/src/db-op-log-store.ts:100` 与 `:161`，
#  另有 `packages/op-log/src/engine.ts:376` 同一条）。
# 所以"备份 opId 出现在服务端"这件事**在产品里从来不成立**，一条永远会红的判据
# 不是判据 —— 它只是把设计说成了缺陷。（改这条之前先读了 `appendImported` 的函数体，
# 而不是只 grep 符号；见下"真正的不变量"。）
#
# 真正的不变量有两条，都可失败：
#   a) 还原之后同步**不会进入失败态、也不会卡住**：界面在 300s 内落到
#      「已是最新」或「已全部上传」。出现「同步失败」⇒ 红；一直「正在同步…」⇒ 红。
#      （这台设备没有 WebAssembly，密钥派生纯 JS 逐批算，首同步按分钟计 ——
#       所以必须轮询到落定，不能"同步一次就读"，那是上一轮的假红来源。）
#   b) 本机**自己写的**那条 op 要能上传（见 ④b）—— 队列若被还原卡死，那条必红。
#      这才是"没毒化"的正面证据；a) 只是"没坏到看得见"。
# 备份 opId 的命中数仍然**打印**出来（设计上应为 0），但它不参与判定：
# 万一哪天改成"还原时按本机 clientId 重签"，那条数字会变，而这条判据不该跟着翻。
SECS=0
SYNCSTATE=""
while [ "$SECS" -lt 300 ]; do
  # 🔴 **设备被别的会话抢走**要立刻停：那时界面上的字全都与他无关，
  # 继续轮询只会把一次争用打印成"还原毒化了同步队列"（2026-10-03 实测）。
  focus_is "$PKG" || require_our_app_foreground "判据④a 轮询中"
  # 抓不到界面（宿主机过载）时不能把轮询打断，也不能把读空文件当成"口令没设"。
  if dump; then
    if [ "$(has_sub "还没设置端到端加密口令")" = "1" ]; then
      SYNCSTATE="needs-passphrase"; break
    fi
    if [ "$(has_sub "同步失败")" = "1" ]; then SYNCSTATE="failed"; break; fi
    if [ "$(has_sub "已是最新")" = "1" ] || [ "$(has_sub "已全部上传")" = "1" ]; then
      SYNCSTATE="settled"; break
    fi
  fi
  sleep 10; SECS=$((SECS + 10))
done
read_ops > "$OPS_AFTER"
HIT=$(python3 -c 'import sys
before = set(open(sys.argv[1]).read().split())
backup = set(open(sys.argv[2]).read().split())
after = set(open(sys.argv[3]).read().split())
print(len(backup & after), len(backup), len(after - before))' "$OPS_BEFORE" "$OPIDS" "$OPS_AFTER")
HITS=$(echo "$HIT" | cut -d' ' -f1)
TOTAL=$(echo "$HIT" | cut -d' ' -f2)
UPLIFT=$(echo "$HIT" | cut -d' ' -f3)
echo "     等了 ${SECS}s 落定；服务端备份 opId 命中 ${HITS}/${TOTAL}（设计上应为 0：导入的 op 不进上传队列），服务端净增 ${UPLIFT}"
case "$SYNCSTATE" in
  settled)
    ok "还原没有把同步卡死：${SECS}s 内界面落到「已是最新 / 已全部上传」，且没有失败态" ;;
  failed)
    bad "还原之后同步进入失败态（界面出现「同步失败」）—— 这一条才是「还原毒化了同步队列」"; screen_txt ;;
  needs-passphrase)
    bad "端到端口令没生效（界面说「还没设置端到端加密口令」）—— 判据④a 无法判定"; screen_txt ;;
  *)
    bad "300s 内同步既没落定也没报错（一直停在「正在同步…」或界面读不到）—— 队列可能被卡死"; screen_txt ;;
esac

# ④b：还原之后手机**还能不能写、还能不能推**。
# 按"出现备份里没有的新 opId"判，而不是"总数变大" —— 总数可能被另一台设备的上传影响。
POST_TITLE="post-restore-$STAMP"
# 🔴 逐次点「任务」标签并**验证真的换了页**：上一轮这里红成"找不到新建按钮"，
#    而 dump 显示界面还在「我的」—— Modal 关闭与标签点击之间没有同步点。
TAB=0
for _ in 1 2 3; do
  $ADB shell input tap 135 2253; sleep 2
  dump
  XY=$(xy_desc "新建任务")
  [ -n "$XY" ] && { TAB=1; break; }
done
XY=$(xy_desc "新建任务")
if [ "$TAB" != "1" ]; then bad "点了 3 次「任务」标签仍进不去任务页，判据④b 无法执行"; screen_txt;
else
  # 🔴 **点了 FAB 不等于面板开了**。2026-10-03 实测：第一次 `input tap` 抛了
  #    Java 异常（栈顶 `InputManagerService.onShellCommand`）而面板根本没弹，
  #    `xy_edit_any` 于是抓到任务页的**搜索框**（它的 desc 与面板输入框不同，
  #    但"任意输入框"这个匹配分不开），标题打进搜索框、读回为空，
  #    再往后就是那条"找不到「添加」"。判据必须验**面板真的开了**，
  #    而不是"我点过了"。
  OPEN=0
  for _ in 1 2 3; do
    $ADB shell input tap $XY; sleep 2.5
    dump
    EDIT=$(xy_desc "新任务标题")
    [ -n "$EDIT" ] && { OPEN=1; break; }
  done
  if [ "$OPEN" != "1" ]; then bad "点了 3 次新建入口，面板始终没开（读不到「新任务标题」输入框）"; screen_txt;
  else
    $ADB shell input tap $EDIT; sleep 1
    $ADB shell input text "$POST_TITLE"; sleep 1.5
    disable_ime; sleep 1
    # 🔴 读回**先于提交**：`input text` 在高负载下会静默丢字符而退出码仍是 0（§7 #43），
    # 而这条判据断的是"手机自己写的 op 要能上行" —— 标题没落进去就是"什么都没写"，
    # 那时报"没上传"会把探针故障算成产品缺陷。
    dump
    GOT=$(edit_value "新任务标题")
    if [ "$GOT" != "$POST_TITLE" ]; then
      bad "新建任务的标题没落进输入框（读回「${GOT:-空}」，应为「${POST_TITLE}」）—— 判据④b 无法判定"; screen_txt
    else
    # 🔴 键盘立着的时候「添加」在键盘带里，那一下 `input tap` 会打在键盘上
    #    （判据② 那一轮实测：坐标拿得到、按钮没按下、反而打出一个字符）。
    require_keyboard_down "点「添加」之前"
    XY=$(scroll_to_text "添加")
    if [ -z "$XY" ]; then bad "找不到「添加」"; screen_txt;
    else
      $ADB shell input tap $XY; sleep 3
      # 🔴 提交之后**先回「我的」再谈同步**：`ensure_phone_sync` 问的是那一页的
      #    同步按钮，站在任务页上它当然读不到 —— run22 实测这里先红一条
      #    "同步按钮既不空闲也不在忙"，紧接着把 ④b 也带成红（两条红一个原因）。
      $ADB shell input tap 945 2253; sleep 3
      require_our_app_foreground "④b 触发同步之前"
      ensure_phone_sync
      # 🔴 和 ④a 同一条理由：这条 op 要过纯 JS 的密钥派生才出得去，
      #    "点一次同步就读服务端"会把"还没传完"读成"没传"。轮询到出现为止。
      PSECS=0
      PNEW=0
      while [ "$PSECS" -lt 300 ]; do
        read_ops > "$OPS_POST"
        PNEW=$(python3 -c 'import sys
known = set(open(sys.argv[1]).read().split()) | set(open(sys.argv[2]).read().split())
after = set(open(sys.argv[3]).read().split())
print(len(after - known))' "$OPS_BEFORE" "$OPIDS" "$OPS_POST")
        [ "${PNEW:-0}" -ge 1 ] && break
        sleep 10; PSECS=$((PSECS + 10))
      done
      NEW="$PNEW"
      echo "     等了 ${PSECS}s，服务端新增 ${NEW:-0} 个备份里没有的 opId"
      if [ "${NEW:-0}" -ge 1 ]; then
        ok "还原后手机仍能写入并上行（新增 ${NEW} 个备份里没有的 opId）"
      else
        bad "还原后新建的任务没上到服务端（新增 0 个 opId）—— 队列可能被还原毒化"; screen_txt
      fi
    fi
    fi
  fi
fi

mkdir -p "$PWD/apps/mobile/evidence"
cp /tmp/heyta-restore-done.png "$PWD/apps/mobile/evidence/android-restore-done.png" 2>/dev/null
cp /tmp/heyta-restore-tasks.png "$PWD/apps/mobile/evidence/android-restore-tasks.png" 2>/dev/null
echo "     截图：apps/mobile/evidence/android-restore-{done,tasks}.png"

summary "移动端备份还原"
