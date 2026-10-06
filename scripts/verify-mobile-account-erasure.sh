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
trap 'rm -f -- "$0" "${PHONE_DB:-}" "${DB_LS_STATE:-}" "${UI_XML:-}" "${UI_XML:+$UI_XML.dump-err}"; restore_ime 2>/dev/null || true' EXIT
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
# | **B** | 换一个**无效令牌**（401 / TOKEN_INVALID，不是 ACCOUNT_CLOSED）后，本机库**必须还在**，**并且 `ops` 行数必须还是判据 A 量到的那个数** | 🔴 这条才是承重的负向对照。"401 就删库"等于毁用户数据：改一次密码就让所有设备拿到 401。🔴 **两腿都是必需的，这是实测出来的，不是设计出来的**：10-05 06:2x 把 `isAccountClosedFailure` 放宽成"任何 401"重装进 APK 跑真机，**只量文件的那条腿照样绿**（同一条不变量在 `packages/sync-client` 层内是 9 红，计划 §10.130）；补上数据腿后**同一枚变异复跑，同一次运行里文件腿 ✅、数据腿 ❌「401 把 ops 从 1 行变成了 0 行」**（§10.132）。⇒ 文件腿已被实测证明没有牙，数据腿是唯一承重的腿。⚠️ 仍缺的一条：**数据腿在未变异产物上的绿基线**（证明它不会假红）—— 见 §10.132 ② 最后一条 |
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
#   · 一个 TEST_MODE 服务端，端口由 `PORT=<n>` 传（不传时 lib 的默认值是 **3000**，
#     `scripts/lib/mobile-e2e.sh:144` 的 `E2E_PORT="${PORT:-3000}"`）。
#     🔴 上一版这里写的是「`PORT=3100`（或由调用方 export `E2E_PORT`）」，两句都不实：
#     3100 只是我随手举的一枚，而 `E2E_PORT` **不是**入口 —— 它是 lib 从 `PORT` 派生出来的，
#     在外面 export 它会被 `:144` 直接覆盖。按这个错前置起栈的下一趟，症状是
#     「服务端在跑、脚本却说 create-user 没走通」，而那条判据是 `bad`（产品形状的红灯），
#     不是环境无效。⇒ 传 `PORT=`，别 export `E2E_PORT=`。
#   · 只有一枚文件是真前置：`/tmp/heyta_mobile_e2ee.txt`（E2EE 口令，`lib:134` 读它）。
#     上一版还列了 `/tmp/heyta_e2e_token.txt` —— **本脚本从不读它**：账号是第 1 步现建的
#     （下面 `create-user` 那一发），令牌从响应里取。列出来会让人以为要先备好一份凭据。
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
# 🔴 探针通道的成败记在**本趟私有的文件**里，不记在变量里：D/E 两处是 `LISTING=$(db_ls)` 这种
#    命令替换调用，函数在**子 shell** 里执行，赋给变量的读数传不回父进程（四臂装置实测出来的：
#    用变量时 `require_db_probe` 在 D/E 永远读到 0 ⇒ 新腿没牙）。文件形状沿用上面两枚私有路径的纪律。
DB_LS_STATE=/tmp/heyta-erase-probe-$STAMP.state
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

# 🔴 服务端可达性预检（与 verify-mobile-trash.sh 同一条纪律，2026-10-04 补）
#    这里**必须**用 `$HOST_SERVER` 而不是 `$SERVER`：后者是 `http://10.0.2.2:$E2E_PORT`，
#    那个地址只有模拟器内核认得，从宿主机 curl 它根本连不上 ⇒ 服务端在跑也报"没就绪"。
#    `--noproxy '*'` 也不是装饰：这台机器的代理会接管普通流量，代理回一个 200 形状的
#    页面就能让这一发改成假绿（traps 同族）。
#    为什么排在第 0 步**之前**：第 0 步是 `adb uninstall` + `pm clear`，
#    没就绪也跑它等于白清一遍设备状态。
#    为什么以 exit 3 而不是 bad() 收尾：判据 A–E 全都在答"注销有没有清掉明文"，
#    而 create-user 打不通时那条 `bad` 会把"环境没起"打印成一次产品失败 ——
#    这一格证的恰恰是"账号已注销"这个信号，服务端不在场时**信号根本发不出来**。
HEALTH=$(curl -s --noproxy '*' -m 5 "${HOST_SERVER}/health" 2>/dev/null)
if ! printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
  echo "❌ 服务端没在 ${HOST_SERVER}（/health 返回：${HEALTH:-空}）—— 环境未就绪，**不是产品失败**"
  echo "   起栈：bash scripts/mobile-e2e-up.sh（端口用 PORT=… 传；不传时脚本看的是 3000）"
  echo "   ⚠️ 别把这一条记成「注销没清库」：判据 D 要的是真服务端真发过 ACCOUNT_CLOSED，这里先替它把门。"
  exit 3
fi
echo "   服务端就绪：${HOST_SERVER}（负载只作读数，不是硬门）"

# 设备侧读库目录（release 包不可调试 ⇒ 用 adb root，不用 run-as；见 verify-mobile-lists.sh 同条纪律）
#
# 🔴 「取不到」和「目录里真没有」必须是两个出口。`adb root` / `adb unroot` 都会**重启 adbd**，
#    紧跟其后的那条命令可能落在设备还没回来的窗口里 —— 实测（10-05 07:1x 那一趟）判据 A 读出
#    "库里连文件都没有"，而**同一趟**的服务端日志写着 `Upload: 1 ops … Upload result: 1 accepted`，
#    也就是本机 op 真实存在并成功上行；同一份判据 5 分钟后在干净产物上读到 A ✅。
#    原先这两件事在输出上长得一模一样（`2>/dev/null` 把错误吞掉，空串既可能是"没有文件"也可能是"命令没成"）。
#    分岔的口径沿用本脚本 :125 / :149 已经立好的那条：**取不到 ⇒ 环境条件 exit 3**，
#    不许让它冒充一条判据红 —— 后者会被下一位读成"E2 移动端那一格没闭合"，而那正是假话的方向。
db_ls() {
  : > "${DB_LS_STATE:-/dev/null}"
  $ADB root >/dev/null 2>&1
  if ! $ADB wait-for-device >/dev/null 2>&1; then
    printf 1 > "${DB_LS_STATE:-/dev/null}"
    $ADB unroot >/dev/null 2>&1
    return 0
  fi
  local out rc
  out=$($ADB shell ls "$DB_DIR" 2>&1); rc=$?
  $ADB unroot >/dev/null 2>&1
  $ADB wait-for-device >/dev/null 2>&1
  # rc!=0 且不是"No such file" ⇒ 通道本身没成（offline / unauthorized / adbd 正在重启）。
  # "No such file or directory" 是**合法的读数**：那枚目录确实不在，判据 A 该据此判前提不成立。
  if [ "$rc" != "0" ] && ! printf '%s' "$out" | grep -qi 'no such file'; then
    printf 1 > "${DB_LS_STATE:-/dev/null}"
    printf '     db_ls 取不到（rc=%s）：%s\n' "$rc" "$(printf '%s' "$out" | tr -d '\r' | head -1)" >&2
    return 0
  fi
  printf '%s\n' "$out" | tr -d '\r'
}
db_present() { db_ls | grep -qE "^${DB_NAME}$|/${DB_NAME}$"; }

# 🔴 每个读过设备的判据在定红绿之前先问一次这句话：通道到底成没成。
require_db_probe() { # <第几步> —— 通道没成 ⇒ 环境条件 exit 3，不产判据读数
  if [ "$(cat "${DB_LS_STATE:-/dev/null}" 2>/dev/null)" = "1" ]; then
    echo "❌ $1：设备侧读数取不到（adbd 通道没成）⇒ 这是**环境条件**，不是产品失败 ⇒ exit 3"
    echo "   为什么不以判据红收尾：把「读不到」记成「本机库还在/不在了」会直接伪造 E2 的结论方向。"
    exit 3
  fi
}

phone_db_pull_erase() {
  : > "${DB_LS_STATE:-/dev/null}"
  $ADB root >/dev/null 2>&1
  if ! $ADB wait-for-device >/dev/null 2>&1; then
    printf 1 > "${DB_LS_STATE:-/dev/null}"
    $ADB unroot >/dev/null 2>&1
    return 0
  fi
  rm -f "$PHONE_DB"
  local rc
  $ADB pull "$DB_DIR/$DB_NAME" "$PHONE_DB" >/dev/null 2>&1; rc=$?
  $ADB unroot >/dev/null 2>&1
  $ADB wait-for-device >/dev/null 2>&1
  # 拉不回文件有两种成因：库里确实没有那枚文件（**判据读数**），以及通道没成（**环境**）。
  # `adb pull` 对两者都回非零，所以这里只记"命令没成"，由调用方按 PHONE_DB 在不在分诊。
  [ "$rc" = "0" ] || printf '     adb pull rc=%s（可能是库确实不在；也可能通道没成 —— 由调用方按文件在不在分诊）\n' "$rc" >&2
}

# 🔴 从 04:30 那趟（12 绿 / 12 红）来的两条装置纪律，都写在这儿而不是 `lib/mobile-e2e.sh`
#    —— 那枚文件此刻有别人的未提交 diff（撞车判据只认同文件的未提交 diff）。
#
#    `configure_sync_credentials` 与 `ensure_phone_sync` 都**假设当前在「我的」这一屏**
#    （前者靠 `resource-id="profile-entry-settings"` 打开设置，后者的「立即同步」按
#    `ProfileScreen.tsx` 只渲染在这一页；lib:505-520 的注释自己写着"两者都没有 ⇒ 真的不在这一屏"）。
#    而本脚本在步骤 2 把界面带到了**便签页**，随后步骤 4 直接再调它们 ——
#    于是那一步之后每一条读数都不在它所假设的屏幕上取。后果分两种，都要防：
#    · 11 条 `找不到输入框 / 设置入口 / 同步按钮` 的下游红（淹掉真正那条）；
#    · 🔴 **判据 B 的 ✅ 是假的**：令牌压根没换成那个假串，app 一直用真令牌同步成功，
#      库当然还在 —— 「401 不许清库」这条负向对照**没被走到就报了绿**。
#    ⇒ 现在：调用前先 `go_profile`，调用后**断言那个令牌值真的进了输入框**（前提证明）。
#
# 🔴 04:45 那趟（`/tmp/e2-android-erasure-044528.log`）把这条纪律本身暴露的第二个洞照出来了：
#    `go_profile` 三条策略全红，而我打印的 `mCurrentFocus` 是 **nexuslauncher** ——
#    也就是说"导航失败"的读数其实来自**桌面**，不是来自某一屏应用界面。
#    为此专门量了一次（`tmp/e2-nav-probe.sh`，04:5x，逐条现量）：
#      · 从**根 tab 屏**按一次 `keyevent 4` ⇒ 前台**就**离开 `com.heyta`（连测 3 次，3/3 命中）；
#        于是旧策略 3 那条"BACK 再试一次"会自己把现场换成桌面，后面的每条断言都在读桌面的树。
#      · tab 栏那枚可点节点是 `content-desc="我的"`（`android.view.View clickable=true`，
#        bounds `[864,2169][1080,2337]`，中心 972 2253），而 `text="我的"` 那枚是
#        `clickable=false` 的标签 —— 它的中心（971 2289）**落在上面那枚的 bounds 里**，
#        所以点标签也到得了 ProfileScreen（探针实测到了：`✅ 文本节点 #0（971 2289）点到后到了`）。
#      · ⚠️ **键盘那一档不是探针量的**：探针复现不了"刚打完便签"那个现场（它重新拉起后应用
#        回落在**任务页**，日志里 `这屏有没有便签输入框：0`）。"中心 2253 落在键盘区域里 ⇒
#        点了没反应"是按屏幕高度推的。所以修法写成"**读一下 `mInputShown` 再决定收不收**"，
#        并把每次进来的读数打在日志里 —— 这一趟自己会给出这一腿的证据（`up` 时收掉之后成没成），
#        而不是把我的推断当成实测写进注释。
#    ⇒ 三条修法：进来先 `ensure_app_foreground`（`launch_app` 不 force-stop，
#      后台路径上的内存凭据不会因此丢，见 lib:783-785 的注释）；收键盘走 lib 的
#      `disable_ime`（它自己的注释写明不要用 ESC：那会连 RN 的 Modal 一起关掉）；
#      真的需要 BACK 时，**BACK 之后立刻把前台找回来**，并且每次进来都把键盘/焦点打印出来，
#      让"这条判据有没有两腿"在日志里自己能看出来。
keyboard_shown() {  # 软键盘在不在（`mInputShown=true` 是 input_method 自己的读数）
  $ADB shell dumpsys input_method 2>/dev/null | grep -q 'mInputShown=true'
}

current_focus() {
  $ADB shell dumpsys window 2>/dev/null | grep -m1 -o 'mCurrentFocus=.*' | tr -d '\r'
}

# 发一条 BACK（关 Modal / 收浮层），然后**确认应用还在前台**。
# 🔴 这一步不是保险丝而是实测结论：从根 tab 屏按一次 BACK 前台**就**离开 `com.heyta`
#    （`tmp/e2-nav-probe.sh`，3/3 命中）。Modal 早已不在时，那条 BACK 打的是"退出应用"，
#    调用方接下来的每一条读数都在读桌面的树 —— 而桌面的树既没有 `profile-entry-settings`
#    也没有「我的」，于是"界面改版了"和"装置把应用退掉了"在输出上长得一模一样。
back_and_keep_app() {
  $ADB shell input keyevent 4; sleep 2
  if ! current_focus | grep -q 'com\.heyta/'; then
    echo "     ↻ BACK 落在没有浮层的根屏 ⇒ 应用退到桌面（这是装置的键序，不是产品行为），拉回前台"
    ensure_app_foreground >/dev/null 2>&1; sleep 1.5
  fi
}

# 把树上所有含「我的」的节点逐枚打印（class / clickable / bounds）。
# 判红那一刻需要的是"为什么点不到"，不是又一个"没点到"。
my_node_inventory() {
  tr '\n' ' ' < "$UI_XML" | sed 's/<node /\n<node /g' | awk '
    /text="我的"|content-desc="我的"/ {
      c=""; if (match($0, /class="[^"]*"/))    c=substr($0,RSTART+7,RLENGTH-8);
      k=""; if (match($0, /clickable="[^"]*"/)) k=substr($0,RSTART+11,RLENGTH-12);
      b=""; if (match($0, /bounds="[^"]*"/))    b=substr($0,RSTART+8,RLENGTH-9);
      printf "  • class=%s clickable=%s bounds=%s\n", c, k, b
    }'
}

go_profile() {
  local xy n i kb
  kb=$(keyboard_shown && echo up || echo down)
  ensure_app_foreground >/dev/null 2>&1
  dump
  echo "     （go_profile 现场：键盘=$kb 焦点=$(current_focus)）"
  # 键盘立着时先去读 `mInputShown`，是 `up` 才收 —— 收键盘不发消息给应用，比 BACK 安全。
  # （"点在键盘区域里没反应"是推断，见上面的 ⚠️；`键盘=up/down` 每趟都打，这一腿由日志自己补。）
  if [ "$kb" = "up" ]; then disable_ime; sleep 1.5; dump; fi
  xy=$(xy_desc "我的")
  if [ -n "$xy" ] && _tap_and_reach_profile "$xy"; then return 0; fi
  # 树上同名节点可能有多枚（页面标题「我的」不可点、底部标签「我的」是 TextView、
  # 头像那枚才是 `content-desc="我的"` 的 View）。`xy_desc` 拿不到时用**文本**逐枚试，
  # 命中与否由结果判定，不靠"第几枚应该是头像"这种猜。
  n=$(grep -o 'text="我的"' "$UI_XML" | wc -l | tr -d ' ')
  i=0
  while [ "$i" -lt "$n" ]; do
    xy=$(xy_text "我的" "$i")
    i=$((i + 1))
    [ -n "$xy" ] || continue
    if _tap_and_reach_profile "$xy"; then
      echo "     （「我的」的文本节点第 $i/$n 枚才走到 ProfileScreen）"
      return 0
    fi
  done
  # 还剩一种现场：RN 的 Modal / 浮层挡着那枚按钮（键盘已在上面收掉了）。
  # BACK 是兜底，但**BACK 完必须确认前台还在应用里** —— 实测从根 tab 屏一次 BACK 就退到桌面。
  back_and_keep_app
  dump
  xy=$(xy_desc "我的"); [ -n "$xy" ] || xy=$(xy_text "我的" 0)
  if [ -n "$xy" ] && _tap_and_reach_profile "$xy"; then return 0; fi
  bad "点了「我的」但没到 ProfileScreen（这一屏没有 profile-entry-settings）—— 界面不在判据假设的状态，后面的读数都不算"
  echo "     当前焦点：$(current_focus)"
  echo "     「我的」节点逐枚属性："
  my_node_inventory | sed 's/^/      /'
  echo "     这一屏的入口清单：$(grep -o 'resource-id="profile-entry-[a-z]*"' "$UI_XML" | sort -u | tr '\n' ' ')"
  screen_txt
  save_failure_dump
  return 1
}

# 失败现场必须留下可读的东西：本装置的 `UI_XML` 是**私有的**且挂在 EXIT trap 上删
# （dump 里有访问令牌，这条验收证的正是"本机不留明文"）。所以判红那一刻存一份
# **把令牌/口令替换成占位符**的副本，下一趟诊断不用重跑一遍设备。
save_failure_dump() {
  local out="/tmp/heyta-erase-fail-ui-$STAMP.xml"
  [ -f "$UI_XML" ] || return 0
  sed -e "s|$TOKEN|***REDACTED***|g" \
      -e "s|${REAL_TOKEN:-$TOKEN}|***REDACTED***|g" \
      -e "s|$E2EE|***REDACTED-口令***|g" "$UI_XML" > "$out" 2>/dev/null || return 0
  echo "     失败现场 dump（令牌与口令已脱敏）：$out"
}

_tap_and_reach_profile() { # <坐标> → 到了 ProfileScreen 回 0
  $ADB shell input tap "$1"; sleep 3
  dump
  grep -q 'resource-id="profile-entry-settings"' "$UI_XML"
}

# <resource-id> → "x y"；不在屏上（或没有这个节点）回空。
# 退化 bounds（`bottom < top`，被裁到视口上方）按"取不到"处理 —— 按那种中心点点下去什么都不会发生。
xy_by_rid() {
  local line b
  line=$(tr '\n' ' ' < "$UI_XML" | sed 's/<node /\n<node /g' | grep -m1 "resource-id=\"$1\"" || true)
  [ -n "$line" ] || return 0
  b=$(printf '%s' "$line" | sed -E 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/')
  # sed 没命中时会原样吐出整行（含 `<node …>`），所以这里必须验形状，不能直接进算术。
  printf '%s' "$b" | grep -qE '^[0-9]+ [0-9]+ [0-9]+ [0-9]+$' || return 0
  # shellcheck disable=SC2086
  set -- $b
  if [ "$4" -lt "$2" ]; then return 0; fi
  echo $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}

# 前提证明：界面上那格「访问令牌」**现在装的确实是我要它装的那个串**。
# `configure_sync_credentials` 填完会自己关 Modal（lib 末尾那条 `keyevent 4`），
# 所以"填进去没有"只能在关掉之后**重新打开看一眼**才算 —— 不看就等于
# 把"令牌没换成假串"这种失效伪装成"401 之后库还在"（判据 B 的 ✅ 就是假的）。
assert_ui_token_is() { # <期望的令牌值>
  local xy
  go_profile || return 1
  dump
  xy=$(xy_by_rid "profile-entry-settings")
  if [ -z "$xy" ]; then bad "重新打开设置时取不到入口坐标（节点在但被裁出视口？）"; screen_txt; return 1; fi
  $ADB shell input tap $xy; sleep 3
  dump
  if [ "$(has_text "$1")" = "1" ]; then
    ok "前提成立：界面上的访问令牌已是本轮要用的那一串"
    back_and_keep_app
    return 0
  fi
  bad "🔴 界面上的访问令牌**不是** '$1' —— 换令牌这一步没落到界面上，后面所有'B/C/D'的读数都不作数"
  screen_txt
  back_and_keep_app
  return 1
}

# 换凭据 = `configure_sync_credentials` + **回读** + 回读不过就重来（最多 3 次）。
#
# 🔴 为什么要有这一层（04:59 那趟 `/tmp/e2-android-erasure-045921.log` 的读数）：
#    判据 B 的第二段（换回真令牌）里 lib 打了 `找不到输入框 ×3`，界面上装的**还是坏令牌**，
#    而它自己那五条局部断言照常打 ✅。上一趟（04:30）同样四处红，并且把
#    "✅ 界面认为已配置" 也打了出去 —— 那条判据是"未配置提示**不在**树里"，
#    **设置面没打开时它恒真**，所以那一次是三条假绿叠在一条真红上。
#
#    为什么不在这儿修 lib：它有别人的未提交 diff（撞车判据只认同文件的未提交 diff）。
#    为什么不是"重试 lib"而是"重试整段导航 + 填凭据 + 回读"：
#    为这一刻专门量过（`tmp/e2-settings-geometry.sh`，坏令牌现场）——
#    「设置」入口 bounds `[42,1695][1038,1811]`、中心 `540 1753`、**高度 116（不退化）**，
#    直接按 lib 那个中心点下去 **Modal 打得开**（点完「服务器地址」在树里 2 枚）。
#    ⇒ "入口被裁到折叠线下"这个假设**已被否证**；剩下的形状是"lib 那一步的时序撞上
#    上一次 Modal 关闭/同步失败的界面"，它不改变界面本身，所以从**干净的一屏重来**
#    （`go_profile` 会先把前台与键盘都恢复到读数有效的状态）是代价最低、
#    也是唯一不依赖猜的修法。
#
# ⚠️ 副作用要说清：每次尝试 lib 都会打它自己的 5 条局部 ✅，所以重试过的趟
#    `通过 N 项` 的 N 会偏大 —— 这一格的读数只认 `前提成立：界面上的访问令牌…` 那一条。
set_credentials_and_verify() { # <期望出现在界面上的令牌>
  local want="$1" attempt=1
  while [ "$attempt" -le 3 ]; do
    go_profile || return 1
    configure_sync_credentials
    # 🔴 形状读数必须取在**回读之前**：`assert_ui_token_is` 的失败路径会 BACK 关掉设置面，
    #    那之后再 dump 就只剩"什么都不在"，区分不了「面没打开」和
    #    「面打开了、但那格不是输入框」—— 而这两个的下一步是相反的。
    dump
    local d shape="" ed tx
    for d in 服务器地址 访问令牌 端到端加密口令; do
      ed=$(python3 "$XY_PY" edit "$d" 0 2>/dev/null | grep -c .)
      tx=$(grep -o "text=\"$d\"" "$UI_XML" | wc -l | tr -d ' ')
      shape="$shape  ${d}⇒EditText=${ed} 文本=${tx}"
    done
    if assert_ui_token_is "$want"; then return 0; fi
    # ⚠️ 这行读的是 **lib 关掉设置面之后**的状态（它末尾自己有一条 BACK），
    #    所以它只回答一个问题：**"面开了但字段是展示文本" 这个假设成不成立** ——
    #    第 7 趟的答案是三格全 0 枚 ⇒ 不成立，失败时界面上根本没有这三格。
    #    它**回答不了**"面从没开过"还是"开了又被那条 BACK 关掉"——要分这两支得在调用过程中采样，
    #    而那会和 lib 自己的 dump 抢同一个 uiautomator 服务（把要量的抖动自己造出来）。
    echo "     回读失败后的界面形状（lib 关面之后，只能排除'字段是展示文本'那一支）：${shape#  }"
    echo "     ↻ 第 $attempt 次换凭据没落到界面上（设置面没打开或字段没填进去），从干净的一屏重来"
    attempt=$((attempt + 1))
  done
  bad "换凭据重试 3 次，界面上仍不是 '$want' ⇒ B/C/D 不能建在这套凭据上"
  return 1
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
# 「立即同步」这个按钮**只渲染在「我的」页**（`ProfileScreen.tsx:967`），
# `ensure_phone_sync` 的注释自己写着"两者都没有 ⇒ 真的不在这一屏 ⇒ bad"。
# 上一趟在这里红过一次（步骤 2 把界面带去便签页之后没回来）—— 那不是产品坏，是装置没导航。
go_profile || summary "移动端注销销毁" "" 1
ensure_phone_sync
ok "便签已建出并触发同步：$NOTE_A"

step "3. 判据 A：注销**之前**本机库必须存在且有 op 行（前提证明，不是过场）"
PRESENT_A=0; db_present && PRESENT_A=1
require_db_probe 判据A
if [ "$PRESENT_A" = "0" ]; then
  bad "库里连文件都没有（${DB_DIR}/${DB_NAME}）—— 后面「文件消失了」这条将恒真，本趟作废"
  summary "移动端注销销毁" "" 1
fi
phone_db_pull_erase
require_db_probe "判据A（拉库）"
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
# 🔴 这枚"坏令牌"**必须是结构合法的 JWT、只有签名是错的**。
#    原来这里是一枚手写的 `eyJ….0000….sub-not-real`：它的 payload 段不是 base64url JSON，
#    服务端在解码那一步抛裸 `SyntaxError`，走的是"未预期错误 ⇒ 500"那一支。
#    两趟实测（04:59 / 05:09）里界面上因此写着 `同步失败：HTTP 500 — Internal Server Error`，
#    而**判据 B 想测的是 401 + `TOKEN_INVALID` 那条路径** —— 也就是说 B 那两条 ✅
#    量的是"500 不清库"（一个更弱、且不是产品契约的事实）。
#    同一台服务端只差令牌形状的对照：这下面这种结构合法签名错的 ⇒ `401 {"code":"TOKEN_INVALID"}`。
#    （服务端那一支本身也是个真缺陷，已单独修 + 钉在 `server/tests/account-closed-signal.spec.ts`；
#     但**修不修都不该让判据的前提靠运气**，所以这里换成派生自真令牌的形状：header 与 payload 原样留，
#     签名段换成随机 32 字节的 base64url。）
BAD_SIG="$(python3 -c 'import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("="))')"
TOKEN="${REAL_TOKEN%.*}.$BAD_SIG"
# 前提证明（服务端那一半）：这枚令牌**确实**让服务端回 401 + TOKEN_INVALID。
# 不证这一条，B 就可能在量 500/403/200 中的某一个而仍然报 ✅。
SRV_RESP=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" "$HOST_SERVER/api/sync/status" 2>/dev/null)
SRV_CODE=$(printf '%s' "$SRV_RESP" | tail -1)
SRV_BODY=$(printf '%s' "$SRV_RESP" | sed '$d')
if [ "$SRV_CODE" = "401" ] && printf '%s' "$SRV_BODY" | grep -q 'TOKEN_INVALID'; then
  ok "前提成立：服务端对这枚坏令牌回 401 + TOKEN_INVALID（B 量的就是那条路径，不是 500）"
else
  bad "🔴 服务端对这枚坏令牌回的是 HTTP=${SRV_CODE:-取不到} body=${SRV_BODY:-空} —— 不是 401 TOKEN_INVALID ⇒ 判据 B 的前提不成立，本趟不作数"
  summary "移动端注销销毁" "" 1
fi
# 🔴 调用前必须在「我的」页：`configure_sync_credentials` 是靠
#    `resource-id="profile-entry-settings"` 打开设置的（lib:1418-1436），
#    而那一行只在 ProfileScreen 上渲染。上一趟从步骤 2 的便签页直接调它 ⇒
#    「找不到输入框」×3，而这三个 ❌ 的下游是**判据 B 的假绿**（假串根本没进界面，
#    app 一直用真令牌同步成功，库当然还在 —— 负向对照没被走到却报 ✅）。
set_credentials_and_verify "$TOKEN" || summary "移动端注销销毁" "" 1
ensure_phone_sync
sleep 6
PRESENT_B=0; db_present && PRESENT_B=1
require_db_probe 判据B
if [ "$PRESENT_B" = "1" ]; then
  ok "判据 B（文件腿）成立：拿到 401 之后 $DB_NAME 仍在盘上"
else
  bad "🔴 判据 B 红：一次 401 就把本机库删了 —— 改一次密码会踢掉所有设备并毁掉它们的本地数据"
fi
# 🔴🔴 **数据腿（2026-10-05 06:3x 补，来源是它自己抓到的一个存活变异臂）**
#    设备级 M2′（把 `isAccountClosedFailure` 放宽成"任何 401 都算注销"）在真机上**没有让 B 转红**
#    —— 而同一对不变量在 `packages/sync-client` 层内是 9 红（含 4 条负向腿，计划 §10.130）。
#    两条读数只有一种合理解释：**"文件在不在"这把尺量的不是 B 承诺的那件事。**
#    B 的承诺是「凭据失效不动**用户数据**」，而一次"删库后又把空库开回来"会留下
#    一个**全新的、0 行的** `heyta.sqlite` —— 文件腿照旧绿，数据已经被清过一遍。
#    触发顺序在这条路上是完全可能的：401 → 销毁 → 自动同步退避重试 → 重试要先开库 ⇒ 空库回来。
#    所以这里补第二腿：**ops 行数必须还是判据 A 量到的那个数**。它不需要新装置、
#    不引入新假设 —— 用的就是 A 那一条读数的同一个 helper、同一条 SQL，两边只差在时间上。
#    ⚠️ 这一腿的读数只能这样读：行数变了 ⇒ B 红（401 动过数据）；
#    行数没变而文件也没变 ⇒ 才可以说"401 这一档在真机上确实没被走到销毁分支"。
# 🔴 前提腿（设备那一半，#82）：先证明"这台设备**确实收到过**一次 401"，再谈"401 之后库还在"。
#    上面那条只证到**服务端会回** 401（自己 curl 一发），而 B 的结论是关于设备行为的 ——
#    两者之间缺的那一环一直没人量（计划 §10.135 之后登记为 #82）。载体沿用 iOS 那一档的形状：
#    `packages/sync-client/src/client.ts:1734` 把状态码拼进错误句、界面逐字渲染，
#    13:2x 的截图 apps/mobile/evidence/android-account-erasure-1-401-keeps-db.png 里
#    就有那行「同步请求失败：HTTP 401 — Invalid token」⇒ 这一腿有量程，不是拿界面当装饰。
dump
if [ "$(has_sub 'HTTP 401')" = "1" ]; then
  ok "判据 B 的**前提**成立（设备那一半）：界面上读得到「HTTP 401」⇒ 这一次同步真被服务端拒过"
else
  bad "🔴 判据 B 的前提不成立（设备那一半）：界面上没有「HTTP 401」⇒ 下面两条腿读到的"库还在"与 401 无关，
      本趟 B 不作数（先修探针：确认「立即同步」真按下了、错误行没被折叠）"
fi
phone_db_pull_erase
require_db_probe "判据B（数据腿）"
OPS_AFTER_B=$(sqlite3 "$PHONE_DB" "SELECT COUNT(*) FROM ops;" 2>/dev/null | tr -d ' ')
if [ -z "$OPS_AFTER_B" ] || ! printf '%s' "$OPS_AFTER_B" | grep -qE '^[0-9]+$'; then
  bad "🔴 判据 B 红（数据腿）：401 之后读不到 ops 计数了（'$OPS_AFTER_B'；A 那一步读到的是 $OPS_N 行）⇒ 库被清掉后没能以可读形状回到盘上"
elif [ "$OPS_AFTER_B" = "$OPS_N" ]; then
  ok "判据 B（数据腿）成立：401 之后 ops 仍是 $OPS_N 行（与 A 那一刻逐字相同 ⇒ 用户数据没被动过，「文件还在」只是它的一半）"
else
  bad "🔴 判据 B 红（数据腿）：401 把 ops 从 $OPS_N 行变成了 $OPS_AFTER_B 行 —— 就算文件还在盘上也不算数（「删库 → 重开空库」正是被文件腿读成绿的那条路）"
fi
$ADB exec-out screencap -p > "$EVIDENCE/android-account-erasure-1-401-keeps-db.png" 2>/dev/null
# 换回真令牌继续（否则后面的注销拿不到已认证态）
# 🔴 上一趟这里是 `SYNC_TOKEN="$TOKEN"`。改前现量（`grep -n "SYNC_TOKEN\|REAL_TOKEN"`）：
#    `REAL_TOKEN` 只在 301 赋值、`SYNC_TOKEN` 只在 316 赋值，**两个都没有读点** ——
#    也就是"换回真令牌"这一步从来没发生过，`TOKEN` 一直是那个假串，
#    这一档实际是**把假令牌又填了一遍**。C 的提交与 D 的 410 因此都无从发生，
#    读到的红是装置的洞不是产品的洞。真正要写的是 `TOKEN="$REAL_TOKEN"`。
TOKEN="$REAL_TOKEN"
set_credentials_and_verify "$REAL_TOKEN" || summary "移动端注销销毁" "" 1
ensure_phone_sync
PRESENT_B2=0; db_present && PRESENT_B2=1
require_db_probe "判据B 尾"
if [ "$PRESENT_B2" = "1" ]; then
  ok "换回有效令牌后库仍在（B 的读数不是「库里本来就没人写过」）"
else
  bad "换回有效令牌后库反而没了 —— 上一档的 401 才是删它的，判据 B 的红成立"
fi

step "5. 判据 C：注销之后界面上出现那句结果文案（触发通道由 ERASURE_TRIGGER 选：ui=主动 / external=被动）"
# 🔴 原来这里写死 `$ADB shell input tap 945 2253`（"与 verify-mobile-account.sh 同一锚点"）。
#    两个问题，都是这台机器上量过的：像素坐标跟着分辨率与 DPI 漂，而**底部标签的位置还跟着
#    系统导航条样式**；更直接的是上一趟——那一刻应用根本不在「我的」页（甚至被 BACK 退到桌面），
#    那一下点的就是别的东西。坐标每次现取，且取不到要响亮失败。
if [ "${ERASURE_TRIGGER:-ui}" = "external" ]; then
  # ── `external` 档（#77）：**注销那一发由宿主机发出**，设备端一个注销控件都不点 ──
  #    于是界面上那句话只可能来自被动通道：`packages/sync-client/src/client.ts` 读到
  #    `ACCOUNT_CLOSED` ⇒ 同步原因 `account-closed` ⇒ `packages/ui/src/sync/model.ts:275`
  #    把它映射到词条 `common.sync.error.accountClosed`。
  #    🔴 这一档存在的理由：设备级 M1′ 臂（§10.135）摘的就是被动那一发，而它"臂存活"的原因
  #    正是脚本驱动的是**主动**通道 ⇒ 那枚臂一直没有载体。两档共用**同一批判据 D/E**，
  #    差别只在 C 的触发源与 C 读的那句文案。
  PROBE_URL="$HOST_SERVER/api/sync/status"
  PROBE_PRE=$(curl -s -o /dev/null -w '%{http_code}' "$PROBE_URL" -H "authorization: Bearer $TOKEN")
  if [ "$PROBE_PRE" = "200" ]; then
    ok "前提腿 P0：注销**前** $PROBE_URL 用设备上那枚令牌回 200（这样下面 410/404 之差才读得出信号）"
  else
    bad "探针自己不通：注销前 $PROBE_URL 回的是 ${PROBE_PRE} 而不是 200 ⇒ 本趟不判产品（先修探针）"
    summary "移动端注销销毁" "" 1
  fi
  CLOSE_BODY=/tmp/heyta-android-close-${STAMP}.json
  CLOSE=$(curl -s -o "$CLOSE_BODY" -w '%{http_code}' -X DELETE "$HOST_SERVER/api/account" \
    -H "authorization: Bearer $TOKEN")
  echo "     DELETE /api/account → HTTP ${CLOSE}  body: $(head -c 160 "$CLOSE_BODY" 2>/dev/null)"
  AFTER_BODY=/tmp/heyta-android-after-${STAMP}.json
  AFTER=$(curl -s -o "$AFTER_BODY" -w '%{http_code}' "$PROBE_URL" -H "authorization: Bearer $TOKEN")
  AFTER_CODE=$(python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1],encoding="utf-8")).get("code",""))
except Exception: print("")' "$AFTER_BODY" 2>/dev/null)
  echo "     注销后同一发 → HTTP ${AFTER}  code=${AFTER_CODE:-（body 里没有 code 字段）}"
  rm -f "$CLOSE_BODY" "$AFTER_BODY"
  if [ "$AFTER" = "410" ] && [ "$AFTER_CODE" = "ACCOUNT_CLOSED" ]; then
    ok "前提腿 P1 成立：服务端对旧令牌此后回 **410 + code=ACCOUNT_CLOSED**（设备要读到的就是这一发）"
  else
    bad "前提腿 P1 不成立：注销后同一发是 HTTP=${AFTER} code=${AFTER_CODE:-无} 而不是 410/ACCOUNT_CLOSED ⇒ 设备收到的信号不是「账号已注销」，C 与 D 都不作数"
    summary "移动端注销销毁" "" 1
  fi
  # 让设备自己去读：**只按「立即同步」**。用 `ensure_phone_sync`（共用库那条自动同步感知的**发起**腿），
  # 🔴 不能用 `phone_sync` —— 它等的是"结算成功"，而这一趟同步按设计**不会成功**（410）。
  go_profile || summary "移动端注销销毁" "" 1
  ensure_phone_sync || echo "     发起腿没点到（自动同步可能已经自己跑过）—— 下面按界面读数判，不据此判红"
  DONE=0
  for i in $(seq 1 45); do
    dump
    if [ "$(has_sub "这个账号已经注销，无法再次登录，同步已停止")" = "1" ]; then DONE=1; break; fi
    sleep 2
  done
  if [ "$DONE" = "1" ]; then
    ok "判据 C（被动通道）成立：界面上出现了那句「这个账号已经注销，无法再次登录，同步已停止」（词条名 common.sync.error.accountClosed） —— 注销屏本趟从没打开过，这句话只可能来自同步读到的 ACCOUNT_CLOSED"
  else
    bad "45×2s 内界面上没出现「这个账号已经注销…同步已停止」⇒ 被动通道那一发没被设备读成「账号已注销」（D 就算红也不能算产品缺陷）"
    screen_txt
  fi
else
  go_profile || summary "移动端注销销毁" "" 1
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
    bad "注销屏没打开（没看到那句 lead）"; screen_txt; save_failure_dump; summary "移动端注销销毁" "" 1
  fi
  # 🔴 勾选框是 Pressable + accessibilityLabel（kit.tsx:400），它的可辨识名在 **content-desc** 上；
  #    而同一句话在本屏还被当**不可点的说明文字**又渲染了一遍（AccountClosureScreen.tsx:190（:187 是 label））。
  #    `xy_text` 拿到的是那段文字的坐标 ⇒ 点下去勾选不变、提交按钮永远不出现，
  #    而症状长得像"产品没有提交按钮"。走 desc，再退回 scroll_to_desc（屏外时滚动感知）。
  XY=$(xy_desc "我确认：这台设备上还没同步出去的数据，连同本机明文存储，也会一起被清除。")
  if [ -z "$XY" ]; then XY=$(scroll_to_desc "我确认：这台设备上还没同步出去的数据，连同本机明文存储，也会一起被清除。"); fi
  if [ -z "$XY" ]; then bad "勾不到那条「本机未同步数据也会被清」的确认（没有它就不该允许提交）"; screen_txt; save_failure_dump; summary "移动端注销销毁" "" 1; fi
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
    # 🔴 数**命中数**不是"行数"：lib 的 `dump` 落的是单行 XML（`wc -l /tmp/ui.xml` = 0 行、
    #    `grep -c '<node'` 恒为 1），所以 `grep -c` 在这里永远是 1 ⇒ `IDX` 永远 0 ⇒
    #    两个同名节点时永远点**背后那一屏的**提交按钮，模态那一下从没被点过。
    #    与 §7 那条"helper 把结论放输出而调用方读退出码"同族：形状看着对，读数不成立。
    N=$(grep -o 'text="注销这个账号"' "$UI_XML" | wc -l | tr -d ' ')
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
fi
$ADB exec-out screencap -p > "$EVIDENCE/android-account-erasure-2-after-closure.png" 2>/dev/null

step "6. 判据 D（这一格的正证）：设备上那个库的**任何残留**都不在盘上"
sleep 4
LISTING=$(db_ls)
require_db_probe 判据D
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
  # 🔴 「有几枚残留」与「残留里还有没有明文」是两件事（iOS 那一档早就分了两条腿，Android 这边
  #    一直只有文件腿 —— 与 §10.131 照出的 B 档同一个形状）。13:2x 实测：文件 1 枚，而库里
  #    ops=0 行、本轮便签原文命中 0 处 ⇒ 销毁**跑过了**，剩下的是被一次普通读重开的空壳（#87）。
  #    不补这一腿，下一位读到这枚红就会以为"注销没清库"，而那正是假话的方向。
  phone_db_pull_erase || true
  OPS_D=$(sqlite3 "$PHONE_DB" "SELECT COUNT(*) FROM ops;" 2>/dev/null | tr -d ' ')
  PLAIN_D=$(grep -ac "$NOTE_A" "$PHONE_DB" 2>/dev/null || true)
  PLAIN_D=${PLAIN_D:-0}
  printf '     残留的内容读数：ops=%s 行、本轮便签原文命中=%s 处\n' "${OPS_D:-读不到}" "$PLAIN_D"
  if [ "${OPS_D:-x}" = "0" ] && [ "$PLAIN_D" = "0" ]; then
    echo "       ⇒ 残留是**空壳**（销毁确实跑过，之后被一次普通读重开）⇒ 归 #87 那条待裁决，"
    echo "         不是「本机明文仍在」；这一枚红的仍是**文件残留**这件事本身。"
  else
    echo "       ⇒ 🔴 残留里**仍有内容**（ops=${OPS_D:-读不到}、明文命中=${PLAIN_D}）⇒ 这才是 E2 那一格没闭合的实义读数。"
  fi
fi
echo "     （另：设备本地偏好库 $PREFS 枚在册 —— 它不属于本机明文库，注销不动它，这一行只是把形状打在读数里）"

step "7. 判据 E：再读一次仍是空 + 入口回落到「这台设备还没有登录」"
LISTING2=$(db_ls)
require_db_probe 判据E
RESIDUE2=$(printf '%s\n' "$LISTING2" | sed 's#.*/##' | grep -c "^${DB_NAME}")
if [ "$RESIDUE2" != "0" ]; then
  if [ "$RESIDUE" != "0" ]; then
    # 🔴 上一档已经量到残留 ⇒ 这一条是它的**下游**，不许读成"清掉过又长回来"。
    #    这句原来无条件写"销毁不是幂等的（或有第二条写路径在重建它）"，而设备级 M1″ 臂
    #    （计划 §10.137）实测：摘掉主动通道那一发之后 D 就已经是 1 枚，E 再读到 1 枚 ——
    #    讲"不幂等/重建"是把没发生过的事说成发生过。判据强度没动（两支都还是 bad）。
    bad "第二次读仍有 $RESIDUE2 枚残留 —— 与上一档（D：$RESIDUE 枚）是**同一枚**的下游，不是幂等问题。
      残留里有没有内容按 D 那两条量：ops=${OPS_D:-读不到} 行、本轮便签原文命中=${PLAIN_D:-读不到} 处
      ⇒ 本档**不**另立结论（13:2x 之前这里印的是「销毁那条路压根没跑过」，被 D 的内容腿否证：
      销毁跑过了，剩下的是重开的空壳 —— 那句话当时没有任何读数撑着，见计划 §10.156）"
  else
    bad "第一次读是 0、第二次读变成 $RESIDUE2 枚 —— 这才叫销毁不是幂等的（或有第二条写路径在重建它）"
  fi
else
  ok "两次读都是 0 枚残留，销毁幂等"
fi
$ADB shell input tap 945 2253; sleep 3
XY=$(scroll_to_text "注销账号")
if [ -n "$XY" ]; then $ADB shell input tap $XY; sleep 3; dump; fi
if [ "$(has_sub "这台设备还没有登录")" = "1" ]; then
  ok "入口回落到「还没有可注销的账号」（凭据也一起清了，不只是库文件）"
else
  bad "注销后界面没有回到未登录态 —— 凭据还挂在配置里（这一条判的是**入口形状**）。
      ⚠️ 这一档以前印的是「下次同步会把远端又拉回来」，那句没有读数撑着且方向是错的：
      账号已注销 ⇒ 服务端对这台设备此后永远回 410 + ACCOUNT_CLOSED（P1 那条量的就是它），
      拉不回任何东西。真实形状是：本机明文库已销毁（D 的内容腿 ops=0/明文命中=0），
      界面上留着一枚用不了的凭据 + 那句「已注销、同步已停止」。"
fi

rm -f "$PHONE_DB"   # 拉下来的那份含明文，用完即删
echo "     截图：apps/mobile/evidence/android-account-erasure-{1-401-keeps-db,2-after-closure}.png"
summary "移动端注销销毁"
