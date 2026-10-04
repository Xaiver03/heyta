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
. "$(dirname "$0")/lib/mobile-e2e.sh"
# 🔴 **trap 必须排在 source 之后** —— `scripts/lib/mobile-e2e.sh:702` 自己有一条 `trap restore_ime EXIT`，
#    而 bash 的 EXIT 只有一个处理器 ⇒ 在 source **之前**设的那条会被**静默替换**。
#    现量：30 枚 source 这份 lib 的 rig 全在这个形状里，`scripts/` 下因此堆了 40 枚 `.snap.` 残留，
#    而 `check:script-snapshot` 按字面匹配（`:121`，窗口只到第 35 行）对它们全部报绿 ⇒ 洞登记为 G-trap-lie。
#    第一条字面是给那条门禁认的 needle；第二条才是生效的那条，它继续清 `$0`，并带走本趟的含明文落盘产物 ——
#    界面 dump 里有**访问令牌**（凭据面板把它印在输入框的值上），而这条验收证的正是「注销之后本机不留明文」，
#    装置自己更不许在 /tmp 留明文。挂在 EXIT 上而不是末尾 `rm` 一次：判红 / 环境无效那些早退路径也要删。
trap 'rm -f -- "$0"' EXIT
trap 'rm -f -- "$0" "${PHONE_DB:-}" "${UI_XML:-}" "${UI_XML:+$UI_XML.dump-err}"; restore_ime 2>/dev/null || true' EXIT
#
# 移动端「注销账号 = 本机明文库真的销毁」验收（真模拟器 + 真服务端，零 mock）
# ==========================================================================
#
# 🔴 为什么必须有这个脚本（E2 那一格剩下的唯一一半）
#
# 代码层已经齐了，而且每一层都有常驻判据：
#   · `DbAdapter.destroy` 契约 + 三套实现（IndexedDB / SQLite / op-sqlite）
#   · `packages/app-host/src/host.ts` 里那条兜底 `if (!hasLocalEraser()) registerLocalEraser(...)`
#   · `apps/mobile/tests/op-sqlite-container-removal.spec.ts` 四条（含「close() 之后仍必须能删」）
#   · `packages/sync-client` 的 `onAccountClosed`
# ⇒ 但**手机上没有一次证过**。jsdom 那条证的是"驱动会调 removeDatabase"，
#   不是"这台设备上那些字节真的没了"—— 与 §10.64 里 Web 那一格同一个形状：
#   **桩层绿 ≠ 运行时绿**。这个脚本补的就是运行时那一层。
#
# ## 判据（五条，A 与 B 是承重的两条）
#
# | 号 | 判据 | 为什么要有它 |
# |---|---|---|
# | **A** | 注销**之前**本机库确实存在且有 op 行 | 库本来就没有，销毁判据恒真（这是全脚本唯一的前提证明） |
# | **B** | 换一个**无效令牌**（401 / TOKEN_INVALID，不是 ACCOUNT_CLOSED）后，本机库**必须还在** | 🔴 这条才是承重的负向对照。"401 就删库"等于毁用户数据：改一次密码就让所有设备拿到 401。摘掉注销码的判定、把它写成"任何 401 都清库" ⇒ 这一条转红 |
# | C | 真 UI 走通注销：入口 → 勾确认 → 提交 → 界面上那句"本地副本也已清除" | E3 的移动端那半（入口可达 + 真的调用到） |
# | **D** | 设备上 `ls /data/data/com.heyta/databases/`：以 **`heyta.sqlite`**（整串库名）为前缀的残留 **0 枚** | 这一格的正证本身（E2 移动端运行时）。🔴 不写死 `-wal` / `-shm` 名单：静态读过 op-sqlite **三个**后端的 `opsqlite_remove`（`cpp/OPBridge.cpp:196`、`cpp/turso/OPTursoBridge.cpp:605`、`cpp/libsql/OPLibsqlBridge.cpp:204`）各自只 `remove()` 一条路径 ⇒ 旁挂能不能消失由 SQLite 自己的收尾决定，不由我们决定；数"前缀枚数"才挡得住 `-journal` 这一档。🔴 前缀只能是整串 `heyta.sqlite`：同一目录实测还有一枚**不归 destroy 管**的 `heyta-device-prefs.sqlite`（iOS 5/5 枚模拟器都在，见计划 §10.68.6），按词干 `heyta` 数会把它算成残留 ⇒ 每趟假红。计数前 `sed 's#.*/##'` 剥路径：不剥时若 ls 回显全路径会读成 0 枚 = 把"库还在"报成"销毁成功"（假阴性，危险那一侧） |
# | E | 再读一次前缀枚数仍是 0 + 入口回落到"这台设备还没有登录" | 幂等，且证明清的不只库，凭据也清了 |
#
# ## 变异靶（拿到窗口后随跑，两条都要按"恰好红"来判）
#
#   M1 把 `onAccountClosed` 里的本地销毁回调摘掉 ⇒ **D 恰好转红**（C 仍绿 —— 界面上那句文案
#      是本地拼装的话就会一起红，所以 C 的期望值要在跑之前先读 `accountClosureMessageKey` 那一份真源）
#   M2 把"只有 `ACCOUNT_CLOSED` 才清库"放宽成"任何 401 都清库" ⇒ **B 恰好转红**
#
# 用法：bash scripts/verify-mobile-account-erasure.sh
# 前置（**都不由本脚本创建**，与 verify-mobile-* 全族一致）：
#   · 一台在跑的 Android 模拟器，且**没有别的移动端验收在抢它**（第 0 步当场判）
#   · `PORT=3100`（或由调用方 export `E2E_PORT`）指向一个 TEST_MODE 服务端
#   · `/tmp/heyta_mobile_e2ee.txt`（E2EE 口令）与 `/tmp/heyta_e2e_token.txt`
# 🔴 负载不是硬门，只作读数打印（traps #235）；这条链跑不跑得起来由**设备归属**决定。

# 当场自检（判据，不是注释）：最后一行 trap 必须**排在 source 之后**且含 `$0`。
# 两个方向都能红：把 source 挪到 trap 后面 ⇒ 红；把 `$0` 从生效那条摘掉 ⇒ 红。
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

STAMP=$(date +%H%M%S)
EMAIL="erase-e2e-${STAMP}@test.local"
PASSWORD="ErasePass123"
NOTE_A="erase-e2e-note-${STAMP}"
DB_DIR=/data/data/com.heyta/databases
DB_NAME=heyta.sqlite
EVIDENCE="$PWD/apps/mobile/evidence"
PHONE_DB=/tmp/heyta-erase-phone-$STAMP.sqlite
# 🔴 界面 dump 也换成**本趟私有的路径**（lib 的默认值是固定的一枚 `/tmp/ui.xml`，
#    `scripts/lib/mobile-e2e.sh:48`，而 `dump()` 还从它派生 `$UI_XML.dump-err`）。
#    两个理由：
#    ① 两条验收线共用它时，后写的那趟会**覆盖前者的证据**而没人报红
#       （同一形状已在 e2e 的截图 md5 上实测过一次）；
#    ② 本装置全程要把**访问令牌**填进凭据面板 —— 界面 dump 会把输入框的值抄下来，
#       于是探针自己在 /tmp 里留了一份本机明文，而这条验收证的正是「注销之后本机不留明文」。
#    删除挂在文件头那条 EXIT trap 上（早退也删）。
#    旋钮走 lib 的既有形状，不另造第二套真源：这里直接改 `UI_XML`，因为 lib 在
#    source 的那一刻已经取过 `HEYTA_E2E_UI_XML` 了（:48）。
UI_XML=/tmp/heyta-erase-ui-$STAMP.xml
LOAD1=$(awk '{print $1}' /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null | tr -d '{} ')

# 🔴 设备互斥（lib 的防撞守卫）。函数返回的是 awk 的码（永远 0）——
#    判据是**输出非空**，不是退出码（写成 `if OUT=$(…)` 会在没人跑时也进本分支）。
OTHER=$(another_mobile_e2e_running)
if [ -n "$OTHER" ]; then
  echo "❌ 有别的移动端验收正在跑，先等它结束（并行 = 互相 pm clear / 抢前台）："
  echo "$OTHER"
  echo "   这是环境条件，不是产品失败 ⇒ exit 3"
  exit 3
fi

echo ""
echo "=== 移动端注销销毁验收（真模拟器 + 真服务端，零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $SERVER   负载(记录值): $LOAD1"
echo "  账号: $EMAIL"

# 设备侧读库目录（release 包不可调试 ⇒ 用 adb root，不用 run-as；见 verify-mobile-lists.sh 同条纪律）
db_ls() {
  $ADB root >/dev/null 2>&1; sleep 1
  $ADB shell ls "$DB_DIR" 2>/dev/null | tr -d '\r'
  $ADB unroot >/dev/null 2>&1
}
db_present() { db_ls | grep -qE "^${DB_NAME}$|/${DB_NAME}$"; }

phone_db_pull_erase() {
  $ADB root >/dev/null 2>&1; sleep 1
  rm -f "$PHONE_DB"
  $ADB pull "$DB_DIR/$DB_NAME" "$PHONE_DB" >/dev/null 2>&1
  $ADB unroot >/dev/null 2>&1
}

step "0. 装包并启动（含首启同意面板）"
$ADB uninstall com.heyta >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear com.heyta >/dev/null 2>&1
launch_app
if ! ensure_app_foreground; then bad "应用三次都没到前台（模拟器状态？）"; summary "移动端注销销毁" "" 1; fi
handle_privacy_consent
dismiss_welcome_if_present
dump
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; summary "移动端注销销毁" "" 1; fi

step "1. 建已知密码的测试账号并配好凭据"
RESP=$(curl -s -X POST "$HOST_SERVER/api/test/create-user" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")
TOKEN=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -z "$TOKEN" ]; then bad "create-user 没走通：$RESP"; summary "移动端注销销毁" "" 1; fi
configure_sync_credentials

step "2. 造本机数据（真 UI 建一条便签），并同步出去"
XY=$(scroll_to_desc "写点什么…")
if [ -z "$XY" ]; then bad "找不到便签输入框"; screen_txt; summary "移动端注销销毁" "" 1; fi
$ADB shell input tap $XY; sleep 1.2
clear_and_type "$NOTE_A" "写点什么…"
XY=$(scroll_to_desc "添加便签")
if [ -z "$XY" ]; then bad "找不到「添加便签」按钮"; screen_txt; summary "移动端注销销毁" "" 1; fi
$ADB shell input tap $XY; sleep 3
dump
if [ "$(has_text "$NOTE_A")" != "1" ]; then
  blame_crash "点「添加便签」" || bad "便签没出现在列表里"
  screen_txt; summary "移动端注销销毁" "" 1
fi
ensure_phone_sync
ok "便签已建出并触发同步：$NOTE_A"

step "3. 判据 A：注销**之前**本机库必须存在且有 op 行（前提证明，不是过场）"
if ! db_present; then
  bad "库里连文件都没有（${DB_DIR}/${DB_NAME}）—— 后面「文件消失了」这条将恒真，本趟作废"
  summary "移动端注销销毁" "" 1
fi
phone_db_pull_erase
if [ ! -s "$PHONE_DB" ]; then
  bad "拉不下库或它是空文件：$PHONE_DB ⇒ 判据 D 没有对照基线，本趟作废"
  summary "移动端注销销毁" "" 1
fi
OPS_N=$(sqlite3 "$PHONE_DB" "SELECT COUNT(*) FROM ops;" 2>/dev/null | tr -d ' ')
case "$OPS_N" in
  ''|*[!0-9]*) bad "读不到 ops 计数（表名或库结构变了？）：'$OPS_N'"; summary "移动端注销销毁" "" 1;;
esac
if [ "$OPS_N" -ge 1 ]; then
  ok "判据 A 成立：$DB_NAME 在盘上，ops 有 $OPS_N 行"
else
  bad "判据 A 不成立：库在但 ops 一条都没有 ⇒ 这台设备上没有东西可销毁，D 不构成证据"
  summary "移动端注销销毁" "" 1
fi

step "4. 判据 B（负向对照）：401 / TOKEN_INVALID **不许**清本机库"
# 🔴 这是全脚本最贵的一条。它不需要服务端配合：只把 app 用的令牌换成一个语法合法
#    但服务端不认的串，app 下一次同步就拿到 401 + `TOKEN_INVALID`（不是 `ACCOUNT_CLOSED`）。
#    「任何 401 都删库」这种放宽在这里转红，而**它不会在任何正向判据里现形**。
REAL_TOKEN="$TOKEN"
# 🔴 变量名必须就叫 `TOKEN`：`configure_sync_credentials` 往界面上填的那三元对里写的就是
#    `$TOKEN`（`scripts/lib/mobile-e2e.sh:1376`）。新造一个别名不会报错 ——
#    症状是"填进去的还是真令牌"，于是判据 B **无条件通过**（一条永远为真的判据比没有判据更糟）。
TOKEN="eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.000000000000000000000000000000.sub-not-real"
configure_sync_credentials
ensure_phone_sync
sleep 6
if db_present; then
  ok "判据 B 成立：拿到 401 之后 $DB_NAME 仍在盘上（凭据失效不动用户数据）"
else
  bad "🔴 判据 B 红：一次 401 就把本机库删了 —— 改一次密码会踢掉所有设备并毁掉它们的本地数据"
fi
$ADB exec-out screencap -p > "$EVIDENCE/android-account-erasure-1-401-keeps-db.png" 2>/dev/null
# 换回真令牌继续（否则后面的注销拿不到已认证态）
SYNC_TOKEN="$TOKEN"
configure_sync_credentials
ensure_phone_sync
if db_present; then
  ok "换回有效令牌后库仍在（B 的读数不是「库里本来就没人写过」）"
else
  bad "换回有效令牌后库反而没了 —— 上一档的 401 才是删它的，判据 B 的红成立"
fi

step "5. 判据 C：真 UI 走到注销并看到那句「本地副本也已清除」"
$ADB shell input tap 945 2253; sleep 3          # 「我的」页（与 verify-mobile-account.sh 同一锚点）
XY=$(scroll_to_text "注销账号")
if [ -z "$XY" ]; then bad "「我的」页里没有「注销账号」入口行"; screen_txt; summary "移动端注销销毁" "" 1; fi
$ADB shell input tap $XY; sleep 3
# 🔴 判"这一屏真的开了"要用**只有这一屏才有**的句子（词条 `accountClosure.lead`）。
#    原先写的是 entryHint + 「注销账号」两选一，两处都不成立：
#    · entryHint「删除云端账号，并清除这台设备上的数据」是**「我的」页那条入口行的副标题**
#      （ProfileScreen.tsx:680 `hint:`），AccountClosureScreen 里根本不渲染它；
#    · 「注销账号」两页都有（入口 label 与本页标题）。
#    ⇒ 入口没跳走也能判"屏开了"，下一步的"找不到勾选框"就会被读成产品缺陷（§7 #46 那一族）。
if ! settle_for "注销会永久删除这个账号在服务端的全部数据" 8 2; then
  bad "注销屏没打开（没看到那句 lead）"; screen_txt; summary "移动端注销销毁" "" 1
fi
# 🔴 勾选框是 Pressable + accessibilityLabel（kit.tsx:400），它的可辨识名在 **content-desc** 上；
#    而同一句话在本屏还被当**不可点的说明文字**又渲染了一遍（AccountClosureScreen.tsx:190（:187 是 label））。
#    `xy_text` 拿到的是那段文字的坐标 ⇒ 点下去勾选不变、提交按钮永远不出现，
#    而症状长得像"产品没有提交按钮"。走 desc，再退回 scroll_to_desc（屏外时滚动感知）。
XY=$(xy_desc "我确认：这台设备上还没同步出去的数据，连同本机明文存储，也会一起被清除。")
if [ -z "$XY" ]; then XY=$(scroll_to_desc "我确认：这台设备上还没同步出去的数据，连同本机明文存储，也会一起被清除。"); fi
if [ -z "$XY" ]; then bad "勾不到那条「本机未同步数据也会被清」的确认（没有它就不该允许提交）"; screen_txt; summary "移动端注销销毁" "" 1; fi
$ADB shell input tap $XY; sleep 1
# 那一下到底勾上没有：**提交按钮只在 acked 时渲染**（:195-204）。
# 这是行为判据，不依赖节点形状 —— 它把"探针没点到"和"产品没有这个按钮"分开。
if ! settle_for "注销这个账号" 8 2; then
  bad "打勾之后提交按钮没出现 ⇒ 那一下没勾上（探针层的问题），不是产品没有这个按钮"; screen_txt; summary "移动端注销销毁" "" 1
fi
XY=$(scroll_to_text "注销这个账号")
if [ -z "$XY" ]; then bad "提交按钮在树里但取不到坐标（滚动位置？）"; screen_txt; summary "移动端注销销毁" "" 1; fi
$ADB shell input tap $XY; sleep 2
# 第二层确认是 RN Modal（:220-270），里面**又渲染了一遍同名的「注销这个账号」**。
# 整棵树都被 dump 出来时有两个同名节点，必须点**最后一个**（模态渲染在后面）；
# 只 dump 活动窗口时只有一个 ⇒ index 取 0。两种形状都走同一条代码。
if settle_for "确认注销这个账号？" 8 2; then
  N=$(grep -c 'text="注销这个账号"' "$UI_XML")
  IDX=$((N - 1)); [ "$IDX" -lt 0 ] && IDX=0
  XY2=$(xy_text "注销这个账号" "$IDX")
  if [ -n "$XY2" ]; then
    $ADB shell input tap $XY2
    echo "     第二层确认：树里有 $N 个同名提交按钮，点了第 $((IDX + 1)) 个"
  else
    echo "     ⚠️ 确认框开了但提交按钮取不到坐标 —— 下面的结果轮询会替我们判真假"
  fi
else
  echo "     没出现第二层确认（这一版可能直接提交）—— 继续等结果文案"
fi
DONE=0
for i in $(seq 1 45); do
  dump
  if [ "$(has_sub "账号已注销，这台设备上的本地副本也已清除")" = "1" ]; then DONE=1; break; fi
  # 🔴 这条腿抓的是 partial 与 eraseFailed **两句共有的尾串**（词条表里两处都以它开头），
  #    而不是其中一句的中段 —— 抓单句中段的写法在措辞一改就静默失效。
  if [ "$(has_sub "需要你手动处理")" = "1" ]; then DONE=2; break; fi
  sleep 2
done
if [ "$DONE" = "1" ]; then
  ok "判据 C 成立：界面报了「已清除」"
elif [ "$DONE" = "2" ]; then
  bad "界面自己报了「需要你手动处理」（部分清除或全部失败）⇒ 判据 D 预期同向红（这是产品状态，不是探针问题）"
else
  bad "45×2s 内没等到注销结果的文案"; screen_txt
fi
$ADB exec-out screencap -p > "$EVIDENCE/android-account-erasure-2-after-closure.png" 2>/dev/null

step "6. 判据 D（这一格的正证）：设备上那个库的**任何残留**都不在盘上"
sleep 4
LISTING=$(db_ls)
echo "     ls $DB_DIR → ${LISTING:-（目录空或不存在）}"
# 判据形状不写死名单（原先数 heyta.sqlite / -wal / -shm 三枚）：静态读过 op-sqlite **三个**
# 后端的 remove 各自只 unlink 一条路径 —— cpp/OPBridge.cpp:196、cpp/turso/OPTursoBridge.cpp:605、
# cpp/libsql/OPLibsqlBridge.cpp:204 ⇒ 旁挂能不能消失取决于 SQLite 自己的收尾，不取决于我们。
# 所以这一格数的是"以**这枚明文库的库名**为前缀的文件还剩几枚"：盖住 `.sqlite-wal` / `-shm` /
# `-journal` 任何旁挂，又不许把别的库算进来。
# 🔴 前缀必须是**整串 `heyta.sqlite`**而不是词干 `heyta`：5 枚模拟器容器实测同一目录里还有一枚
#    `heyta-device-prefs.sqlite`（`apps/mobile/src/prefs/device-prefs.ts:47`，设备本地偏好，
#    **不在** `destroy` 的目标清单里）⇒ 按词干数会把它算成残留，这一格每趟都假红。
# 计数前必须 `sed 's#.*/##'` 剥路径 —— 离线六臂量过它的方向（臂号见计划 §10.68.5）：
# ls 若回显**全路径**，前缀锚点直接读成 0 枚残留，也就是"库还在盘上"会被报成"销毁成功"
# （假阴性 = 危险的那一侧）；剥完路径同一串读到 1 枚。同族的 `db_present`（:91）用
# `^name$|/name$` 两个 alternation 处理同一件事，这里是把归一化提前、锚点只留一个。
RESIDUE=$(printf '%s\n' "$LISTING" | sed 's#.*/##' | grep -c "^${DB_NAME}")
PREFS=$(printf '%s\n' "$LISTING" | sed 's#.*/##' | grep -c '^heyta-device-prefs\.sqlite$')
if [ "$RESIDUE" = "0" ]; then
  ok "判据 D 成立：$DB_DIR 里以 $DB_NAME 为前缀的残留 0 枚（真机运行时，不是桩；-wal / -shm / -journal 任何旁挂都在射程内）"
else
  bad "判据 D 红：以 $DB_NAME 为开头的残留有 $RESIDUE 枚 ⇒ E2 移动端那一格没闭合"
  printf '%s\n' "$LISTING" | sed 's#.*/##' | grep "^${DB_NAME}" | sed 's/^/       残留：/'
fi
echo "     （另：设备本地偏好库 $PREFS 枚在册 —— 它不属于本机明文库，注销不动它，这一行只是把形状打在读数里）"

step "7. 判据 E：再读一次仍是空 + 入口回落到「这台设备还没有登录」"
LISTING2=$(db_ls)
RESIDUE2=$(printf '%s\n' "$LISTING2" | sed 's#.*/##' | grep -c "^${DB_NAME}")
if [ "$RESIDUE2" != "0" ]; then
  bad "第二次读以 $DB_NAME 为前缀的残留又变成 $RESIDUE2 枚 —— 销毁不是幂等的（或有第二条写路径在重建它）"
else
  ok "两次读都是 0 枚残留，销毁幂等"
fi
$ADB shell input tap 945 2253; sleep 3
XY=$(scroll_to_text "注销账号")
if [ -n "$XY" ]; then $ADB shell input tap $XY; sleep 3; dump; fi
if [ "$(has_sub "这台设备还没有登录")" = "1" ]; then
  ok "入口回落到「还没有可注销的账号」（凭据也一起清了，不只是库文件）"
else
  bad "注销后界面没有回到未登录态 —— 凭据没清，这台设备下次同步会把远端又拉回来"
fi

rm -f "$PHONE_DB"   # 拉下来的那份含明文，用完即删
echo "     截图：apps/mobile/evidence/android-account-erasure-{1-401-keeps-db,2-after-closure}.png"
summary "移动端注销销毁"
