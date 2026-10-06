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
# 移动端「便签编辑链」验收（真模拟器，零 mock）
# ==============================================
#
# 🔴 为什么必须有这个脚本
#
# 便签的**写路径**早就在（`createNoteActions` 能建、能钉、能删，op 也真落库），
# 但**改不了正文**：共享组件的 `onEdit` prop 在、动作层的 `updateNoteContent` 在，
# 两端都不传。这种"零件都在、没人接线"的坏法**不会让任何东西变红** ——
# 类型检查绿、构建绿、既有测试绿，界面上就是"没有这个功能"。
# 所以这里验的是**接线之后的一整条链**：摘要点得开 → 编辑屏打得开且初值就是
# 当前正文 → 改正文保存 → 列表摘要真的变了 → 恰好一条 `UPD` 且只带 `content` →
# 没改动时一条都不写 → 搜索里那条便签点得开 → 出得去（服务端数得到）→
# 进得来（笔记本解密后读到同一份新正文）。
#
# 📌 单元测试证明不了后半段：它能证明 `updateNoteContent` 派发了一条什么 op，
#    证明不了界面上那个输入框把字符串交给了它，更证明不了它能穿过
#    op-log → 向量时钟 → E2EE → 服务端 → 另一台设备的物化。
#
# ═════════════════════════════════════════════════════════════════════════
# 四件刻意的"反假绿"设计
#
# 1. **正文带时间戳**，且断言精确相等。写死一句话的话，上一次跑剩的那条便签
#    会让"摘要变了"永远为真。
#
# 2. **`UPD` 条数判"恰好 1"，不是"≥1"**。多一条就是重复保存 / fan-out。
#    载荷的**键集合**判 `['content']`：多带一个键（比如顺手把 `updatedAt` 也写进
#    payload）就违反"一个意图一个 op"（AGENTS §3.4）。
#
# 3. **"点开看了一眼就关"必须一条 op 都不写**（第 7 步，保存与取消各测一次）。
#    `UPD` 会推进 `updatedAt`，而它是列表排序的第二段 —— 闸门没了的话，症状是
#    "我只是看了一眼，这条便签跳到最前"，全程不报错。
#    判的是**条数不变**，不是"界面没变" —— 后者即使闸门没了也照样成立。
#
# 4. **两端读数**：手机本地库（写出去的那条）+ 笔记本（node-host 真 SQLite）
#    **解密后**的 `remote` op（收进来的那条），比 `entityId` 与正文。
#    ⚠️ 服务端只存密文，**不能**按内容断言 —— 那里只数 op 条数（§7 第 52 条）。
#
# ⚠️ 两条已知边界（不假装做了）：
#   · `state` 表在真库里恒为空（状态是 op-log 派生的、不落盘 —— 实测三台旧
#     笔记本库 `count(state)=0` 而 `ops` 有 33 条）。所以"另一台设备**物化之后**
#     在界面上看到新正文"只能在手机界面层验（第 5 步），笔记本侧到此为止判
#     "收到了、解得开、是同一实体同一正文"。
#   · node-host CLI 没有 notes 子命令，而 `apps/node-host/**` 在本轮地界外
#     → 登记 BLOCKED.md。
#
# 用法：
#   bash scripts/verify-mobile-notes.sh
#   PORT=3100 bash scripts/verify-mobile-notes.sh   # 换端口起栈时
#
# 前置：模拟器在跑、服务端在该端口（TEST_MODE）。
#       凭据**不需要预先存在** —— 本脚本自己准备一个专属新账号（见下面 ensure_account）。

set -u
export PATH="/opt/homebrew/bin:$PATH"
# ── 先准备账号，再加载共享库（顺序不能反，见 lib 文件头）────
#
# 🔴 为什么这一条是补上来的，而不是"顺手统一风格"：这一枚脚本原先直接吃外部喂进来的
#    共享三件套（`/tmp/heyta_mobile_{token,email,e2ee}.txt`），而它是八个 `verify-mobile-*`
#    里唯一不建号的。共享件每被别的会话重登一次，服务端就把同账号的旧 token 作废 ——
#    03:0x 实测症状：第 1–8 步全绿（都不依赖同步），第 8b 步第二个宿主同步报
#    `HTTP 401 — Invalid token`，整趟 25 分钟设备时间烧完而跨设备三条腿一条没走到。
#    另一半理由在 lib 文件头：同一账号的 client 数每轮 +2，第 11 轮越过
#    `MAX_VECTOR_CLOCK_SIZE=20` 后时钟被裁，该设备**每一条**写入都被判 CONFLICT_CONCURRENT，
#    而症状长得像"手机没报冲突"。一个会随运行次数漂移的台架本身就是缺陷。
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
heyta_e2e_ensure_account || exit 1
. "$(dirname "$0")/lib/mobile-e2e.sh"
# 负载门与"别人正在用这台设备"的探测，必须在**任何破坏性动作之前**
# （`pm clear` / `install -r` 都算）—— 判据晚了，一轮无效的运行先把别人的现场清掉。
. "$(dirname "$0")/lib/wait-for-quiet-host.sh"

BUSY=$(another_mobile_e2e_running)
if [ -n "$BUSY" ]; then
  echo "❌ 这台设备上还有别的移动端验收在跑：$BUSY"
  echo "   两边都会 pm clear + 装包 + 按坐标点击，并行 = 互相清掉对方的现场，"
  echo "   报出来的满屏「找不到按钮」不是产品缺陷。等它跑完再跑这一条。"
  exit 3
fi
step "负载门"
wait_for_quiet_host || exit 3
# >>> apk-freshness guard begin（自检：`pnpm check:apk-freshness` 的臂 4b 钉的就是下面这两行调用点在不在）
# 🔴 §7 第 27 条（"packages/ 改了、APK 里是旧 JS bundle，验收对旧代码报绿"）的算法抽在
#    `scripts/lib/apk-freshness.sh` 这个单一所有者里，但**会装包的 26 枚脚本只有 2 枚接过线**
#    （10-05 现量：`install -r "$APK"` 命中 26 枚，`heyta_apk_freshness_guard` 命中 2 枚 = trash 与本文件）。
#    ⚠️ 这段标记原来的第一行写着"自检：heyta-apk-guard-fixture.sh 按这两个标记之间抽同一段跑"——
#    那枚夹具**全仓不存在**（`find . -name "*apk-guard*"` 0 命中），所以那句是注释里的声称而不是事实；
#    现在把它换成真的那一臂（臂 4b），要验接线就摘掉下面那行调用，臂 4b 会红。
#    本条验的是手机里的便签，装的就是那枚 APK ⇒ 不接这道门，读数可能属于几小时前的源码
#    （18:39 现量：载体 APK mtime 05:36:40，同树最新源码 14:49:16，落后 33,156 秒）。
#    位置在负载门之后、第 0 步任何破坏性动作（pm clear / install -r）之前 —— 拒绝就要拒在没弄脏设备之前。
. "$(dirname "$0")/lib/apk-freshness.sh"
heyta_apk_freshness_guard "$APK" "verify-mobile-notes" || exit 3
# <<< apk-freshness guard end

# 独立库：与其它验收各用一份，否则会互相看到对方的便签。
LAPTOP_DB=/tmp/heyta-notes-laptop.sqlite
PHONE_DB=/tmp/heyta-notes-phone.sqlite
TAB_Y=2253
EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"

# 🔴 截图证据的**唯一**落盘口：拍之前先问一次"谁在前台"，把答案按文件名记下来。
#    为什么判据不是像素统计（现量 2026-10-04，`apps/mobile/evidence` 67 张真图）：
#    · 主蓝命中有 **14 张是 0**（`android-search-1..6`、`android-reminder-*` 那些人看过的真界面）
#      ⇒ 把 `reinstall-all.sh` 那侧的 `blue ≥ 20` 抄过来会把这些整片判成红 ——
#      那条阈值是从 **mac 共享 UI** 推出来的，不是从手机界面推出来的；
#    · `android-notes-1-editor-open.png` 人眼看是完整编辑屏，`contentRatio` 却只有 **1.8%**，
#      离 `png-stats` 的 `BLANK_CONTENT_RATIO = 1%` 只剩 **0.8pp** ⇒ looksBlank 在这族图上没有余量。
#    ⇒ 两个像素读数**照打不判红**（它们是有用的证据，只是不当阈值用）；
#      判红的那条是"拍的那一刻前台是不是我们" —— 这也是 §7 里
#      "像素统计挡不住「那是别的 App 的界面」"那条的正解。
SHOT_FOCUS=""
shot_evidence() {
  local rel="$1" focus
  focus=$($ADB shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r')
  $ADB exec-out screencap -p > "$EVIDENCE/$rel" 2>/dev/null
  # 🔴 读不到要落成**一个明确的哨兵**，不能落空串也不能落中文描述：
  #    空串会让第 12 步的 `case` 走到 `*)`，把"探针没读到"报成"前台是别的 App" ——
  #    这是夹具照出来的真缺陷（臂 2 当时就是错的归因）。
  SHOT_FOCUS="${SHOT_FOCUS}${rel}=${focus:-FOCUS-UNKNOWN}
"
  printf '   • 截图 %s 那一刻的前台：%s\n' "$rel" "${focus:-FOCUS-UNKNOWN（dumpsys 没读到）}" >&2
}
mkdir -p "$EVIDENCE"
# 🔴 起跑时间戳取在任何破坏性动作之前（第 0 步的 pm clear / install -r 都算）：
#    第 12 步原来只判 `-s`（非空），而**上一趟留下的旧图同样非空** ——
#    产物在、结论也对，只是它不属于这一趟（§7 第 27 条那一族的第三种面目）。
RUN_STARTED=$(date +%s)

# 🔴 **故意用 ASCII 正文**：`adb shell input text` 发不了非 ASCII（实测抛
#    NullPointerException，而它退出码仍可能是 0）。中文便签走 iOS 侧
#    （`verify-mobile-ios.sh` 里 `idb ui set-value` 那条路）。
NOTE_A="note-e2e-$(date +%H%M%S)-read-once"
NOTE_B="note-e2e-$(date +%H%M%S)-edited"

echo ""
echo "=== 移动端便签编辑链验收（真实模拟器，零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $SERVER"
echo "  初文: $NOTE_A"
echo "  新文: $NOTE_B"

if [ "${#TOKEN}" -lt 100 ]; then
  echo "❌ 令牌看起来不对（长度 ${#TOKEN}）—— 先跑建号脚本"; exit 1
fi
rm -f "$LAPTOP_DB" "$PHONE_DB"

# ── 辅助 ────────────────────────────────────────────────────

# 见 `verify-mobile-lists.sh` 的同名函数：release 包不可调试，只能 `adb root` + pull。
phone_db_pull() {
  $ADB root >/dev/null 2>&1; sleep 2
  $ADB pull /data/data/com.heyta/databases/heyta.sqlite "$PHONE_DB" >/dev/null 2>&1
  $ADB unroot >/dev/null 2>&1
}

# NOTE 实体某类 op 的条数。⚠️ 读数拿不到**不当作 0**：空串原样返回，
# 由调用方判"不是数字"并 `bad()` —— 否则"库没拉下来"会被读成"一条都没写"，
# 而后者听起来像产品缺陷（AGENTS §7 元规则 2）。
note_op_count() {  # <sqlite> <opType>
  sqlite3 "$1" \
    "SELECT COUNT(*) FROM ops
      WHERE json_extract(data,'\$.op.entityType')='NOTE'
        AND json_extract(data,'\$.op.opType')='$2';" 2>/dev/null | tr -d ' '
}

# 按载荷正文找 NOTE 的 entityId（那条 CRT）。
phone_note_id_by_content() {  # <sqlite> <content>
  sqlite3 "$1" \
    "SELECT json_extract(data,'\$.op.entityId') FROM ops
      WHERE json_extract(data,'\$.op.entityType')='NOTE'
        AND json_extract(data,'\$.op.payload.content')='$2'
      ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" \
    2>/dev/null | tr -d ' '
}

# 最新一条 NOTE/UPD 的载荷 JSON，落到临时文件交给 python 判键集合
# （不在命令行里传 JSON —— 引号嵌套是 §7 里那种"grep 没跑还说没有残留"的形状）。
phone_latest_upd_payload() {  # <sqlite>
  sqlite3 "$1" \
    "SELECT json_extract(data,'\$.op.payload') FROM ops
      WHERE json_extract(data,'\$.op.entityType')='NOTE'
        AND json_extract(data,'\$.op.opType')='UPD'
      ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" 2>/dev/null
}

# 「从列表进编辑屏」这一步在四个地方要用（第 4/7/7/8 步），抽成一个函数。
#
# 🔴 定位靠的是**无障碍名**，不是 testID：Android 的 uiautomator 里
# `content-desc` 来自 `accessibilityLabel`，而共享组件那一行的名字是
# `notes.a11y.edit` = 「编辑便签「{excerpt}」」。这个名字同时是读屏用户
# 听到的话 —— 用产品真正给出的那个可点性做判据，不另造一个只有测试能看见的钩子。
open_editor_for() {  # <正文（= 无障碍名里那段 excerpt）>
  local xy
  xy=$(scroll_to_desc "编辑便签「${1}」")
  if [ -z "$xy" ]; then
    bad "便签行上没有编辑入口（找不到无障碍名「编辑便签「${1}」」）"
    screen_txt; return 1
  fi
  $ADB shell input tap $xy; sleep 3
  dump
  if [ "$(has_text "编辑便签")" != "1" ]; then
    blame_crash "点摘要进编辑屏" || bad "点了摘要但编辑屏没打开"
    screen_txt; return 1
  fi
  return 0
}

close_editor_with() {  # <保存|取消>
  local xy
  xy=$(xy_desc "$1")
  if [ -z "$xy" ]; then bad "编辑屏上找不到「${1}」按钮"; screen_txt; return 1; fi
  $ADB shell input tap $xy; sleep 3
  dump
  if [ "$(has_text "编辑便签")" = "1" ]; then
    bad "点了「${1}」但编辑屏没关"; screen_txt; return 1
  fi
  return 0
}





step "0. 装包并启动（全新初态）"
# 🔴 先把 crash 缓冲区清空：`blame_crash` 归因的是**本趟**的崩溃，
#    而 `-b crash` 是会留旧的（上一趟 17:04 那条 FATAL 一直到本轮之后还在缓冲里）。
#    不清空的话，第一条"应用没起来"会带着**上一趟**的堆栈报出来 —— 那是假归因。
if $ADB logcat -c -b crash >/dev/null 2>&1; then
  echo "   crash 缓冲区已清空（崩溃归因只认本趟）"
else
  echo "   ⚠️ crash 缓冲区清不掉 —— 下面若报崩溃，可能是上一趟的残留"
fi
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
if ! settle_foreground; then bad "应用起不到前台（6 次拉起后 mCurrentFocus 仍不是 ${PKG}）"; screen_txt; exit 1; fi
dismiss_welcome_if_present
if ! settle_foreground; then bad "点掉欢迎页之后应用不在前台"; screen_txt; exit 1; fi
# 🔴 「我的」在树上是**主界面**的判据，但第一屏能不能读到它取决于三件外部事：
#    ① 系统权限弹窗（`com.google.android.permissioncontroller`）会盖住整个应用窗口，
#       `uiautomator dump` 导出的是**当前活动窗口** —— 那一刻应用节点一条都不在树里
#       （§7 第 63 条同族：无障碍树为空 ≠ 界面没画）；
#    ② 欢迎页还没点掉；
#    ③ 冷启动 + 建库本身要时间。
#    所以这里轮询而不是"dump 一次定生死"，且每轮先收掉弹窗、再补点一次欢迎页。
#    判据本身没放松：最后仍然要求「我的」真的在树上，拿不到就红。
on_main_screen=0
for i in 1 2 3 4 5; do
  dump
  if [ "$(has_text "我的")" = "1" ]; then on_main_screen=1; break; fi
  echo "   ↻ 第 ${i} 次树里没有底部标签「我的」，先收弹窗/补点欢迎页再读"
  if ! dismiss_permission_dialog; then
    echo "   ⚠️ 点了「不允许」弹窗还在（可能连着两问），这一轮先继续等"
  fi
  dismiss_welcome_if_present
  sleep 2
done
if [ "$on_main_screen" != "1" ]; then
  bad "进了前台但没落到主界面（5 轮之后底部标签「我的」仍不在树上）"
  echo "   • 当前前台：$($ADB shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r')"
  echo "   • Hermes 探针：$($ADB logcat -d 2>/dev/null | grep -c 'heyta A/D Hermes probe: PASS') 条 PASS"
  screen_txt; exit 1
fi
ok "应用已启动并停在主界面"

step "1. 配置同步凭据"
require_screen
configure_sync_credentials
# 第一次唤起输入法就可能弹系统权限窗（见 `dismiss_permission_dialog` 的文件头），
# 而它是**这一步**招来的 —— 在这里收掉，下一步读到的才是应用的界面。
dismiss_permission_dialog

# ── 2. 建一条便签（编辑的前提是有东西可编辑）───────────────
step "2. 在「我的 → 便签」建一条便签：$NOTE_A"
# 🔴 坐标现取，不写死 `945 $TAB_Y`：这台模拟器 1080×2400，标签文字实测
# `bounds=[78,2271][137,2308]`，写死的 2253 落在文字**上方**的图标区。
# 这里**不用** `tap_tab`：它的第二个参数要"换页后立刻在树上"的标记，
# 而便签输入框在「我的」页**要滚动才露出来** —— 拿它当标记会让
# 一次成功的换页被读成失败，然后重试三次、点三次同一个标签。
XY=$(xy_desc "我的")
if [ -z "$XY" ]; then bad "底部标签「我的」不在树上（应用没在主界面？）"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
dismiss_permission_dialog
XY=$(scroll_to_desc "写点什么…")
if [ -z "$XY" ]; then
  bad "找不到便签输入框（滚动到「便签」段也没找到）"; screen_txt; exit 1
fi
require_screen
XY=$(scroll_to_desc "写点什么…")
if [ -z "$XY" ]; then
  bad "找不到便签输入框（滚动到「便签」段也没找到）"; screen_txt; exit 1
fi
$ADB shell input tap $XY; sleep 1.2
clear_and_type "$NOTE_A" "写点什么…"
dump
GOT=$(edit_value "写点什么…" 2>/dev/null)
if [ "$GOT" != "$NOTE_A" ]; then
  bad "便签正文不精确（期望「${NOTE_A}」，实际「${GOT}」）—— 带着脏正文往下跑没有意义"
  screen_txt; exit 1
fi
ok "已输入初文：$NOTE_A"
XY=$(scroll_to_desc "添加便签")
if [ -z "$XY" ]; then bad "找不到「添加便签」按钮"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
dump
if [ "$(has_text "$NOTE_A")" != "1" ]; then
  blame_crash "点「添加便签」" || bad "建完之后列表里没有这条便签"
  screen_txt; exit 1
fi
ok "便签已出现在列表里"

step "3. 断言：本地库里有一条 NOTE/CRT，且能按正文查到 entityId"
phone_db_pull
CRT_N=$(note_op_count "$PHONE_DB" CRT)
if ! printf '%s' "$CRT_N" | grep -qE '^[0-9]+$'; then
  bad "读不到手机库的 NOTE/CRT 计数（库没拉下来？）：$PHONE_DB"; exit 1
fi
if [ "$CRT_N" -lt 1 ]; then
  bad "本地库里没有 NOTE/CRT op —— 界面上的便签没走 op-log"; screen_txt; exit 1
fi
ok "本地库里有 $CRT_N 条 NOTE/CRT op"
NOTE_ID=$(phone_note_id_by_content "$PHONE_DB" "$NOTE_A")
if [ -z "$NOTE_ID" ]; then
  bad "按初文查不到 NOTE 的 entityId（正文没进 payload？）"; screen_txt; exit 1
fi
ok "便签落库且能按正文查到 id：$NOTE_ID"

# ── 4. 编辑入口 → 编辑屏 ───────────────────────────────────
step "4. 点摘要那段 → 编辑屏打开，输入框里是**当前正文**"
require_screen
open_editor_for "$NOTE_A"
VAL=$(edit_value "写点什么…" 2>/dev/null)
if [ "$VAL" != "$NOTE_A" ]; then
  blame_crash "点摘要进编辑屏后核对初值" || bad "编辑屏初值不是这条便签的正文（期望「${NOTE_A}」，实际「${VAL}」）"
else
  ok "初值精确相等 —— 不是新建屏复用、也不是空草稿"
fi
shot_evidence "android-notes-1-editor-open.png"

step "5. 改成正文 B 并保存 → 回列表、摘要变了"
XY=$(xy_desc "写点什么…")
if [ -z "$XY" ]; then
  blame_crash "第 5 步开头找输入框" || bad "编辑屏里没有输入框"; screen_txt
else
  $ADB shell input tap $XY; sleep 1.2
  clear_and_type "$NOTE_B" "写点什么…"
  dump
  VAL=$(edit_value "写点什么…" 2>/dev/null)
  if [ "$VAL" != "$NOTE_B" ]; then
    blame_crash "改正文并输入" || bad "新正文没输进编辑框（期望「${NOTE_B}」，实际「${VAL}」）"; screen_txt
  else
    ok "新正文已在编辑框里"
    close_editor_with "保存"
    dump
    if [ "$(has_text "$NOTE_B")" != "1" ]; then
      blame_crash "点「保存」回列表" || bad "列表摘要仍是旧正文 —— 保存没生效到界面上"; screen_txt
    else
      ok "列表摘要已变成新正文：$NOTE_B"
    fi
  fi
fi
shot_evidence "android-notes-2-list-after-edit.png"

step "6. 断言：恰好一条 NOTE/UPD，且载荷只有 content"
phone_db_pull
UPD_N=$(note_op_count "$PHONE_DB" UPD)
if ! printf '%s' "$UPD_N" | grep -qE '^[0-9]+$'; then
  bad "读不到手机库的 NOTE/UPD 计数"
elif [ "$UPD_N" != "1" ]; then
  bad "NOTE/UPD 不是恰好 1 条（实际 ${UPD_N}）—— 多写=重复保存/fan-out，少写=没保存"
else
  ok "恰好 1 条 NOTE/UPD —— 一次意图一条 op"
fi
printf '%s' "$(phone_latest_upd_payload "$PHONE_DB")" > /tmp/heyta-notes-upd-payload.json
python3 - "$NOTE_B" <<'PY' > /tmp/heyta-notes-payload-verdict.txt 2>&1
import json, sys
raw = open('/tmp/heyta-notes-upd-payload.json', encoding='utf-8').read().strip()
want = sys.argv[1]
if not raw:
    print('读数拿不到（载荷为空）—— 不能当"没问题"'); raise SystemExit(3)
d = json.loads(raw)
keys = sorted(d.keys())
if keys != ['content']:
    print(f'载荷键集合是 {keys}，只许 content'); raise SystemExit(2)
if d['content'] != want:
    print(f'载荷里的正文不是新正文（实际「{d["content"]}」）'); raise SystemExit(2)
print(f'键集合 = [content]，值 = 界面上那次改动')
PY
PAY_RC=$?
if [ "$PAY_RC" -eq 0 ]; then
  ok "UPD 载荷的键集合与值都判过（$(cat /tmp/heyta-notes-payload-verdict.txt)）"
else
  bad "UPD 载荷不合格（rc=${PAY_RC}）：$(cat /tmp/heyta-notes-payload-verdict.txt)"
fi

step "7. 反证：一个字不改直接保存、以及点取消 —— 都必须**一条 op 都不多写**"
# 🔴 这一档是本轮唯一一处的**行为**判据（其余都是接线），所以设备层也钉一次：
# 它挡的是变异 M2（拿掉 `packages/app-host/src/note-actions.ts` 里那句
# `if (next === current.content) return`）。只判条数，不判"界面没变"。
require_screen
BEFORE=$(note_op_count "$PHONE_DB" UPD)
# 下面这一档不是形式主义：`note_op_count` 读不到库时返回**空串**（函数注释自己要求调用方判
# "不是数字"，第 6 步判了、这里原来没判）。拉库一失败，`"$AFTER" != "$BEFORE"` 就退化成
# `"" != ""` ⇒ 恒假 ⇒ 打印"没改动 → 一条 op 都没写"。那是一条**永远通过**的判据，
# 而它挡的正是变异 M2（拿掉 note-actions.ts 里 `if (next === current.content) return`）。
if ! printf '%s' "$BEFORE" | grep -qE '^[0-9]+$'; then
  bad "第 7 步起跑前就读不到手机库的 NOTE/UPD 计数（实际「${BEFORE:-空}」）—— 探针没跑成，这一档不作数"
else
  open_editor_for "$NOTE_B"
  close_editor_with "保存"
  phone_db_pull
  AFTER=$(note_op_count "$PHONE_DB" UPD)
  if ! printf '%s' "$AFTER" | grep -qE '^[0-9]+$'; then
    bad "保存后读不到计数（改前=${BEFORE}、改后=「${AFTER:-空}」）—— 不能把'读不到'读成'没多写'"
  elif [ "$AFTER" != "$BEFORE" ]; then
  bad "没改动却多写了 op（${BEFORE} → ${AFTER}）—— 就是「看一眼就把这条顶到列表最前」那个事故形状"
  else
    ok "没改动 → 一条 op 都没写（NOTE/UPD 仍为 ${AFTER}）"
  fi
  open_editor_for "$NOTE_B"
  close_editor_with "取消"
  phone_db_pull
  CANCEL_N=$(note_op_count "$PHONE_DB" UPD)
  if ! printf '%s' "$CANCEL_N" | grep -qE '^[0-9]+$'; then
    bad "点取消后读不到计数（基线=${BEFORE}、取消后=「${CANCEL_N:-空}」）—— 同上，不作数"
  elif [ "$CANCEL_N" != "$BEFORE" ]; then
    bad "点「取消」却写了 op（${BEFORE} → ${CANCEL_N}）"
  else
    ok "点「取消」同样一条 op 都没写"
  fi
fi

step "8. 第二个宿主：任务页搜索里点开这条便签"
# 🔴 这一条是「搜索里点开便签」那个产品断点的设备级判据：`SearchPanel.onOpenNote`
# 在移动端此前**零消费点**，而共享面板对没传的形态是把那一行 `disabled` ——
# 不报错、不消失，只是点了没反应。所以判"点得开、并且开到编辑屏"。
if ! tap_tab "任务" "打开搜索"; then
  bad "切不到任务页（底部标签「任务」点不动，或任务页顶栏没有「打开搜索」入口）"
  screen_txt; exit 1
fi
require_screen
XY=$(xy_desc "打开搜索")
if [ -z "$XY" ]; then bad "任务页没有「打开搜索」入口"; screen_txt; exit 1; fi
ok "任务页顶栏有「打开搜索」入口（坐标现取：${XY}）"
$ADB shell input tap $XY; sleep 3
dump
# 🔴 这一档原来是 `has_sub "输入关键词"` —— 那个字符串**早就不是产品的了**，22:01 实测界面正常开着而判据恒红。
#    移动端这格的现值在 `packages/i18n/src/locales/zh-CN.ts:458`
#    `'web.shell.search.placeholder': '搜索任务'`（aria 值在同文件 :459），needle 自 `0840ab79`
#    （i18n 多入口拆分）之后就再也命中不到 ⇒ 一条恒假判据（§7 元规则二）。
#    改判**结构**：任务页本身没有可编辑输入框，浮层里必有一个（`autoFocus` 那枚）——
#    这件事不随语种与文案改动而漂。屏上的提示文字只作**读数**打印，不再当判决用。
SXY=$(xy_edit_any)
if [ -z "$SXY" ]; then
  bad "搜索浮层没打开（浮层里找不到可编辑输入框）"; screen_txt; exit 1
fi
ok "搜索浮层已打开（输入框坐标现取：${SXY}）"
echo "   读数（不参与判决，只留证据）：屏上出现「搜索任务」提示行 = $(has_sub "搜索任务")"
XY="$SXY"
if [ -z "$XY" ]; then
  bad "搜索浮层里没有输入框"; screen_txt
else
  $ADB shell input tap $XY; sleep 1
  $ADB shell input text "$NOTE_B"; sleep 2
  # 🔴 这里原先是 `dump` 之后直接 `has_text "便签"`，而 run-1（06:2x）现场是
  #    **上一行刚打印完"uiautomator 连续 10 次抓不到界面 … 那是假红"**，
  #    下一行就是 `❌ 搜索结果里没有「便签」这一段`。两件事都要，缺一件就回到那条假红：
  #    · `require_screen` —— 树是空的就把这一趟判成**环境失效（exit 3）**，
  #      不把它记成产品结论（本库对"需要在真实界面上断言的地方"的既有规定）；
  #    · `settle_for` —— 抓到 hierarchy **不等于这一屏画完了**，宿主机有内存压力时
  #      RN 的结果段可能还没渲染。它**不改判据颜色**：轮询到为止，报不出来照样红。
  require_screen
  settle_for "便签" 8 2
  if [ "$(has_text "便签")" != "1" ]; then
    bad "搜索结果里没有「便签」这一段（这个词就在这条便签的正文里）"; screen_txt
  else
    ok "搜索命中便签段"
    XY=$(xy_desc "$NOTE_B")
    if [ -z "$XY" ]; then
      bad "结果里那条便签点不开（那一行的可访问名不是正文，或它被禁用了 —— 宿主没传 onOpenNote）"
      screen_txt
    else
      $ADB shell input tap $XY; sleep 3
      dump
      if [ "$(has_text "编辑便签")" = "1" ]; then
        ok "从搜索结果点进了编辑屏（搜索浮层先关，两层 Modal 没有叠）"
        shot_evidence "android-notes-3-from-search.png"
        close_editor_with "取消"
      else
        bad "点了便签但编辑屏没打开"; screen_txt
      fi
    fi
  fi
fi

step "8b. setup：先让第二个宿主写一条并同步 —— 否则第 9 步的「下载」没有东西可下"
# 🔴 这一步不是为了让第 9 步变绿，是补它缺的那个输入：
#    第 9 步断"手机库里有 ≥1 条 source ≠ local 的 op"，而原来笔记本**第一次出现**
#    在第 11 步 ⇒ 第 9 步那一刻账号里没有任何别的设备写入的 op，手机**正确地**拉到 0 条。
#    红的是编排，读起来却像"下载坏了"。
#    现量（run-1，06:0x 那趟）：同一趟第 10 步服务端 NOTE/UPD=2 ✅、第 11 步笔记本解得开 ✅
#    ⇒ 上行与下行各自都在工作，缺的只是"对端先写一条"这个前置。
#    命令形状取自 `apps/node-host/src/cli.ts` 的 `case 'add'`（返回 {ok,command,id,due}）
#    与 `scripts/lib/mobile-e2e.sh` 的 laptop / laptop_ok 两个 helper —— 不是手搓的调用。
LAPTOP_MARK="notes-e2e-laptop-$$"
LT_ADD=$(laptop add "$LAPTOP_MARK")
LT_ID=$(printf '%s' "$LT_ADD" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
print(d.get('id') or '')
")
if [ -z "$LT_ID" ]; then
  # 探针没跑成 ≠ 对端没写进去。第 9 步从此没有输入，判**环境失效**（3）不判产品失败（1）。
  bad "setup 没拿到任务 id（返回体「${LT_ADD}」）⇒ 第 9 步的下载判据没有输入，本轮不作数"
  exit 3
fi
ok "第二个宿主写入了一条任务（id=${LT_ID}，标题含标记 ${LAPTOP_MARK}）"
if laptop_ok sync; then
  ok "第二个宿主把那条 op 同步上去了"
else
  bad "setup 同步失败 ⇒ 同上，本轮不作数"
  exit 3
fi

step "9. 手机同步（上传 + 下载）"
# 同样走 tap_tab（见那条 helper 的注释）：同步按钮在「我的」页，
# 点了没切过去就会在任务页上找「同步」，两处都有那个按钮 —— 读起来一切正常。
if tap_tab "我的" "同步"; then
  ok "已回到「我的」页"
else
  echo "   ⚠️ 没能确认切到「我的」页，仍按原样继续（下一步的同步判据自己会红）" >&2
fi
if phone_sync; then ok "手机同步完成"; else bad "手机同步没成功"; screen_txt; fi
phone_db_pull
REMOTE_OPS=$(sqlite3 "$PHONE_DB" \
  "SELECT count(*) FROM ops WHERE json_extract(data,'\$.source') <> 'local';" 2>/dev/null | tr -d ' ')
if ! printf '%s' "$REMOTE_OPS" | grep -qE '^[0-9]+$'; then
  bad "读不到手机库的远端 op 条数（不是「0 条」，是**没读到**）"
elif [ "$REMOTE_OPS" -ge 1 ]; then
  ok "手机本地库里有 $REMOTE_OPS 条远端 op —— 下载这一侧真的跑通了"
else
  bad "手机本地库里远端 op 数 = 0 —— 上传可能成了，下载一条都没落地（同步只做了一半）"
  screen_txt
fi
# ② 把这条判据**钉到本轮**：只数条数挡不住"数到的是这台设备自己的历史 op、
#    或上一轮留在服务端账上的别的设备的 op"。第二条要求手机库里正好有
#    8b 那条 entityId 的 op —— 有输入才有下载，两腿各自可失败。
LT_ON_PHONE=$(sqlite3 "$PHONE_DB" \
  "SELECT count(*) FROM ops WHERE json_extract(data,'\$.op.entityId')='${LT_ID}';" 2>/dev/null | tr -d ' ')
if printf '%s' "$LT_ON_PHONE" | grep -qE '^[0-9]+$'; then
  if [ "$LT_ON_PHONE" = "1" ]; then
    ok "手机库里查到本轮第二条宿主写的那条（entityId=${LT_ID}）—— 下载的不是历史数据"
  else
    bad "手机库里该 entityId 的 op 条数 = ${LT_ON_PHONE}（本轮只写了一条，应为 1）"
  fi
else
  bad "读不到手机库对该 entityId 的计数（实际「${LT_ON_PHONE}」）—— 探针没跑成，不能当成「没收到」"
fi

step "10. 直接查 Postgres（服务端数得出那条 UPD 吗）"
# ⚠️ 服务端只存密文，**只能数条数**，不能按正文断言（§7 第 52 条）。
# 连接参数走 env（与 `verify-mobile-lists.sh:386-389` 同一套约定）；
# 读数不是纯数字必须 `bad()` —— "只打印不判定"就是那条判据原来的坏法。
PG_DB="${HEYTA_E2E_DB:-heyta_mobile_smoke}"
PG_USER="${HEYTA_E2E_DB_USER:-$(whoami)}"
PG_HOST="${HEYTA_E2E_DB_HOST:-127.0.0.1}"
PG_PORT="${HEYTA_E2E_DB_PORT:-5432}"
# >>> step10-scoped begin（夹具按这两个标记之间抽同一段文本跑，改这里夹具才会跟着变）
# 🔴 计数必须按**本轮那条 entityId** 收范围。这台库是共享的，实测里面住着两个账号
#   （user 187 与 user 203，各自一条 NOTE 的 CRT+UPD），而 `server_seq` 还是**按用户各自从 1 起**的。
#   原来那句 `count(*) ... entity_type='NOTE'` 判 `>= 1` ⇒ 只要有任何一趟留下过一条 NOTE/UPD，
#   这一趟**一条都没发出去也照样绿** —— 那是一条不能失败的判据（§7 第 50/58 族）。
#   09:38 现量：全库 NOTE/UPD = 2，而本轮这一趟最多贡献 1 ⇒ 差值就是别人的趟。
SRV_PROBE_OK=0
case "$NOTE_ID" in
  # 拼进 WHERE 前先钉住形状。不合法就判红并**跳过查询**：把空串拼进去得到的"0 条"
  # 会被下一条读成"没发出去"，那是把探针故障记成产品失败（§7 第 67 条同一个形状）。
  note-[A-Za-z0-9_-][A-Za-z0-9_-]*) SRV_PROBE_OK=1 ;;
  *)
    bad "NOTE_ID 形状不合法（实际「${NOTE_ID}」）—— 不拿它去查服务端，避免把探针故障记成产品失败"
    ;;
esac
if [ "$SRV_PROBE_OK" = 1 ]; then
  SRV_NOTE_UPD=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
    "SELECT count(*) FROM operations WHERE op_type='UPD' AND entity_type='NOTE' AND entity_id='${NOTE_ID}'" 2>&1)
  # 阳性对照：同一个 entityId 的 CRT 必须也在。它红而 UPD 那条绿 = 连接/表能查但本轮那条编辑没出去；
  # 两条一起红 = 先怀疑探针（连不上、库名错、别人的实例）。
  SRV_NOTE_CRT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
    "SELECT count(*) FROM operations WHERE op_type='CRT' AND entity_type='NOTE' AND entity_id='${NOTE_ID}'" 2>&1)
  if ! printf '%s' "$SRV_NOTE_UPD" | grep -qE '^[0-9]+$'; then
    bad "读不到服务端的 NOTE/UPD 计数（库 ${PG_DB} @ ${PG_HOST}:${PG_PORT}，用户 ${PG_USER}）—— 原始输出：$(printf '%s' "$SRV_NOTE_UPD" | head -3 | tr '\n' ' ')"
  elif ! printf '%s' "$SRV_NOTE_CRT" | grep -qE '^[0-9]+$'; then
    bad "读不到服务端的 NOTE/CRT 计数（同一条连接、同一个 entityId）—— 探针没跑成，不判本轮上传结论"
  elif [ "$SRV_NOTE_CRT" -lt 1 ]; then
    bad "服务端查不到这条 NOTE 的 CRT（entityId=${NOTE_ID}）—— 连建的那条都不在，本轮上传整条路没走通（不是「编辑没生效」，是「一条都没出去」）"
  elif [ "$SRV_NOTE_UPD" -eq 0 ]; then
    bad "服务端没有这条 NOTE 的 UPD（entityId=${NOTE_ID}，CRT 有 ${SRV_NOTE_CRT} 条）—— 界面说保存好了、也说同步了，服务端一条都没收到"
  elif [ "$SRV_NOTE_UPD" -gt 1 ]; then
    bad "服务端这条 NOTE 的 UPD 数 = ${SRV_NOTE_UPD}（本轮只编辑一次，应为 1）—— 同一条被重复上传（第 6 步本地只数出 1 条的话，问题在上传侧）"
  else
    ok "那次编辑真的出去了 —— 服务端按 entityId=${NOTE_ID} 数得出恰 1 条 UPD（同一实体 CRT=${SRV_NOTE_CRT} 条）"
  fi
  # 全库总数**只打印不判定**：它的作用是污染可见（本轮的数与它不等 ⇒ 说明这台库还住着别人），
  # 而不是判据 —— 判据一律在上面那条按 entityId 收范围的分支里。
  SRV_ALL_UPD=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
    "SELECT count(*) FROM operations WHERE op_type='UPD' AND entity_type='NOTE'" 2>&1)
  printf 'INFO 全库 NOTE/UPD（含别的账号/别的趟，不参与判决）= %s\n' \
    "$(printf '%s' "$SRV_ALL_UPD" | grep -qE '^[0-9]+$' && printf '%s' "$SRV_ALL_UPD" || echo '读不到')"
fi
# >>> step10-scoped end

step "11. 笔记本（node-host 真 SQLite）同步后**解得开**这条 UPD"
# >>> step11-scoped begin（牙齿夹具按这两枚标记抽，不按行号 —— 行号会被上面任何一次插入打漂）
# 🔴 标记必须在**取数那一行之前**：抽出来的块要是没有 `LT_SYNC=$(laptop sync)`，
#    守卫读到的是未绑定的变量，四臂一起红而红字写着 BAD 空 —— 那是夹具坏，不是判据有牙。
LT_SYNC=$(laptop sync)
LT_PROBE_RAN=1
# 🔴 `laptop()` 把 stderr 丢进 /dev/null（lib :95-106 记过这个形状）：node 解析到不可 spawn
#    的私有垫片时**零输出**，于是"探针一次都没跑"与"对端真没收到"在输出上逐字相同。
#    空输出必须先按**探针故障**判掉，并且当场把不吞 stderr 的那条命令的原文打出来。
if [ -z "${LT_SYNC// /}" ]; then
  bad "笔记本 CLI 一条输出都没有 —— 探针没跑成，不判跨设备结论；不吞 stderr 的复跑：$(laptop_raw sync 2>&1 | head -3 | tr '\n' ' ')"
  LT_PROBE_RAN=0
else
case "$LT_SYNC" in
  *'"ok":true'*) ok "笔记本 sync 成功" ;;
  *undecryptable-ops*) ok "笔记本 sync 完成（含已知的 undecryptable-ops，见 ADR-0016）" ;;
  *) bad "笔记本 sync 失败：$LT_SYNC" ;;
esac
fi
# 🔴 探针没跑成 ⇒ **整段都不判**：笔记本那个库是上一趟留下的，只跳过 case 的话，
#    下面三条读数会踩在旧库上照样打 OK（夹具实测：摘掉 case 之后仍然 3 条 OK）。
if [ "$LT_PROBE_RAN" = 1 ]; then
if [ ! -f "$LAPTOP_DB" ]; then
  bad "笔记本库不存在：$LAPTOP_DB —— 探针自己没跑成，这**不是**「对端没收到」"
else
  LT_TOTAL=$(sqlite3 "$LAPTOP_DB" 'SELECT count(*) FROM ops;' 2>/dev/null | tr -d ' ')
  LT_ROW=$(sqlite3 "$LAPTOP_DB" \
    "SELECT json_extract(data,'\$.op.entityId') || '|' || json_extract(data,'\$.op.payload.content')
      FROM ops
      WHERE json_extract(data,'\$.op.entityType')='NOTE'
        AND json_extract(data,'\$.op.opType')='UPD'
        AND json_extract(data,'\$.source')='remote'
      ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" 2>/dev/null)
  if [ -z "$LT_ROW" ]; then
    bad "笔记本没读到任何 remote 的 NOTE/UPD —— 便签编辑没跨设备"
    echo "      笔记本 ops 总数 = ${LT_TOTAL}（为 0 说明这台设备一次都没同步成功，与协议无关）"
  else
    LT_ID=$(printf '%s' "$LT_ROW" | cut -d'|' -f1)
    LT_CONTENT=$(printf '%s' "$LT_ROW" | cut -d'|' -f2-)
    ok "笔记本解密后收到一条 remote 的 NOTE/UPD：entityId=$LT_ID"
    if [ "$LT_ID" = "$NOTE_ID" ]; then
      ok "两端 entityId 一致 —— 是同一条便签，不是恰好同正文"
    else
      bad "两端 entityId 不一致（手机=${NOTE_ID} 笔记本=${LT_ID}）"
    fi
    if [ "$LT_CONTENT" = "$NOTE_B" ]; then
      ok "笔记本读到的正文 = 界面上那次改动 —— 「手机改 → 另一台设备读到」全链路无 mock"
    else
      bad "笔记本读到的正文不是新正文（实际「${LT_CONTENT}」）"
    fi
  fi
fi
fi
# <<< step11-scoped end

step "12. 截图证据落库（非空**且本轮新生**）"
# 🔴 这里判两件事，缺一不可：
#    · `-s`（非空）—— 挡"adb 没写出来"；
#    · mtime ≥ 起跑 —— 挡"那是上一趟留下的"。第 8 步那张在很深的成功分支里，
#      那一支没走到时旧图**照样非空**，只判前一条就会把"这一趟没拍到"印成"证据在库"。
for f in android-notes-1-editor-open.png android-notes-2-list-after-edit.png android-notes-3-from-search.png; do
  p="$EVIDENCE/$f"
  if [ ! -s "$p" ]; then
    bad "证据缺失或为空：apps/mobile/evidence/$f"; continue
  fi
  # 🔴 焦点判据：这张图**拍的那一刻**前台必须是本应用。
  #    读不到焦点时不判红也不判绿 —— 记成"未知"并在下一行按不通过处理，
  #    因为"探针没读到"和"前台是别的 App"对**这张图能不能当界面证据**是同一个结论，
  #    但对"本轮是不是环境坏了"不是（所以话要说清是哪种）。
  F=$(printf '%s' "$SHOT_FOCUS" | sed -n "s|^$f=||p" | head -1)
  case "$F" in
    *com.heyta*) ok "  拍 $f 时前台是本应用（${F}）" ;;
    ""|*FOCUS-UNKNOWN*) bad "  拍 $f 时**没读到**前台焦点（探针读数缺失）—— 这张图不能当界面证据，但这不是产品缺陷" ;;
    *)           bad "  拍 $f 时前台**不是**本应用（${F}）—— 那是别的界面，不是产品缺陷也不是证据" ;;
  esac
  # 像素读数：**只打印**，理由见 shot_evidence 的注释（阈值不从手机界面推导）
  node - "$p" <<'JS' 2>/dev/null || echo "      （png-stats 读不了这张图，不影响上面的判据）"
import('./scripts/screenshots/png-stats.mjs').then((m) => {
  const st = m.inspectPng(process.argv[2]);
  console.log(`      像素读数 ${st.width}x${st.height} 内容占比 ${(st.contentRatio * 100).toFixed(1)}%（looksBlank=${m.looksBlank(st)}）主蓝命中 ${m.countBrandBlue(process.argv[2])} —— 不当阈值用，见 shot_evidence`);
}).catch(() => process.exit(1));
JS
  M=$(stat -f %m "$p")
  if [ "$M" -lt "$RUN_STARTED" ]; then
    bad "证据是旧的：apps/mobile/evidence/$f —— mtime $(stat -f '%Sm' -t '%m-%d %H:%M:%S' "$p") 早于本轮起跑 $(date -r "$RUN_STARTED" '+%m-%d %H:%M:%S')（非空不等于本轮拍的）"
  else
    ok "证据在库且本轮新生：apps/mobile/evidence/${f}（$(stat -f %z "$p") bytes）"
  fi
done
echo "   📷 三张截图（**人必须打开看**）：编辑屏初值 / 列表摘要已变 / 从搜索结果进来的编辑屏"

summary "移动端便签编辑链"
